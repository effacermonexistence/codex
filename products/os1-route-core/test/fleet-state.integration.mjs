import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const wr = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wr.resolve('miniflare')));
const esbuild = await import(pathToFileURL(wr.resolve('esbuild')));
const source = `import { FleetState } from './src/fleet-state.ts'; export { FleetState };
export default {async fetch(request, env) {const b=await request.json(); return Response.json(await env.FLEETS.getByName(b.name)[b.op](...b.args));}};`;
const bundled = await esbuild.build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,
  format:'esm',platform:'neutral',external:['cloudflare:workers']});
const mf = new Miniflare(convertV4MiniflareOptions({name:'fleet-recovery-test',compatibilityDate:'2026-09-01',
  modules:[{type:'ESModule',path:'index.mjs',contents:bundled.outputFiles[0].text}],
  durableObjects:{FLEETS:{className:'FleetState',useSQLite:true}},telemetry:{enabled:false},logRequests:false}));
let checks=0;
async function call(op,args,name='fleet') {
  const r=await mf.dispatchFetch('https://local/test',{method:'POST',body:JSON.stringify({op,args,name})});
  assert.equal(r.status,200);return r.json();
}
function equal(a,b){assert.deepEqual(a,b);checks++;}
const now=1000000;
const node={device_id:'air',role:'air',hostname:'air',zerotier_ip:'10.215.90.216',cpu_logical_count:10,
  load_average_1m:1,memory_total_mib:16384,memory_available_mib:12000,queue_depth:0,has_codex:true,
  has_claude:true,exo_ready:true,exo_nodes:2,last_seen_ms:now};
const spec={job_id:'first',submitter_device_id:'pro',profile:'codex',task:'Run pwd',workspace_repository:'owner/repo',
  workspace_revision:'a'.repeat(40),workspace_subpath:'',requirements:{min_memory_mib:2048,cpu_weight:50,prefer_device_id:null},
  created_at_ms:now,expires_at_ms:now+3600000,request_nonce:'stable'};
try {
  equal((await call('heartbeat',[node])).status,'online');
  const first=await call('submit',[spec]);equal(first.status,'queued');
  const replays=await Promise.all(Array.from({length:12},(_,i)=>call('submit',[{...spec,job_id:'lost-ack-'+i,created_at_ms:now+2000}])));
  for(const replay of replays) equal(replay,first);
  equal(await call('submit',[{...spec,task:'different task'}]),{status:'rejected'});
  const claim=await call('claim',['air',now+1,'claim-one']);equal(claim.status,'claimed');
  equal(await call('claim',['air',now+2,'claim-one']),claim);
  equal(await call('claim',['air',now+3,'other-claim']),{status:'idle'});
  equal(await call('jobStatus',['wrong','first',now+4]),null);
  equal(await call('complete',['wrong','first','complete','output','hash',now+4]),{status:'rejected'});
  equal(await call('complete',['air','first','complete','output','hash',now+4]),{status:'stored'});
  equal(await call('complete',['air','first','complete','output','hash',now+5000]),{status:'stored'});
  equal(await call('complete',['air','first','complete','changed','changedhash',now+5]),{status:'rejected'});
  equal(await call('complete',['air','first','failed','output','hash',now+5]),{status:'rejected'});
  equal((await call('jobStatus',['pro','first',now+6])).result,'output');
  equal((await call('jobStatus',['air','first',now+6])).result,'output');
  equal((await call('snapshot',[now+6])).nodes[0].queue_depth,0);
  // Recovered submission remains attached to the completed result, not a new execution.
  equal(await call('submit',[{...spec,job_id:'after-complete',created_at_ms:now+90000000}]),first);
  equal(await call('submit',[spec],'empty'),{status:'no_capacity'});
  await call('heartbeat',[node],'empty');
  equal(await call('submit',[spec],'empty'),{status:'no_capacity'});
  const second=await call('submit',[{...spec,job_id:'second',request_nonce:'new-intent'}],'empty');equal(second.status,'queued');
  // Identity isolation and crash/claim acknowledgement recovery do not transfer ownership.
  equal(await call('claim',['other',now+1,'claim-one'],'empty'),{status:'idle'});
  const c=await call('claim',['air',now+2,'claim-one'],'empty');equal(c.assignment.job_id,'second');
  equal(await call('claim',['air',now+3,'claim-one'],'empty'),c);
  equal((await call('jobStatus',['pro','second',now+3600001],'empty')).state,'expired');
  equal(await call('complete',['air','second','complete','late','hash',now+3600002],'empty'),{status:'rejected'});
  // Placement preference survives the real SQLite submit/claim/receipt boundary.
  for (const profile of ['codex','claude','exo']) {
    const fleetName='preferred-'+profile;
    await call('heartbeat',[{...node,load_average_1m:20,memory_available_mib:2048,queue_depth:8}],fleetName);
    await call('heartbeat',[{...node,device_id:'pro',role:'pro',hostname:'pro',load_average_1m:0,
      cpu_logical_count:14,memory_total_mib:36864,memory_available_mib:36864}],fleetName);
    const preferredSpec={...spec,job_id:'preferred-'+profile,profile,request_nonce:'private-nonce-'+profile,
      requirements:{...spec.requirements,prefer_device_id:'air'}};
    const placed=await call('submit',[preferredSpec],fleetName);
    equal(placed.status,'queued');equal(placed.assignment.executor_device_id,'air');
    equal(placed.assignment.execution_mode,profile==='exo'?'distributed_exo':'single_node');
    equal(Object.hasOwn(placed.assignment,'request_nonce'),false);
    equal(JSON.stringify(placed).includes(preferredSpec.request_nonce),false);
    equal(await call('claim',['pro',now+1,'pro-claim'],fleetName),{status:'idle'});
    equal((await call('claim',['air',now+2,'air-claim'],fleetName)).assignment,placed.assignment);
    equal(await call('jobStatus',['foreign-owner',preferredSpec.job_id,now+3],fleetName),null);
    equal(await call('jobStatus',['pro',preferredSpec.job_id,now+3],'other-fleet'),null);
    // Changed resource conditions must not reassign an already accepted objective.
    await call('heartbeat',[{...node,has_codex:false,has_claude:false,exo_ready:false,last_seen_ms:now+31001}],fleetName);
    await call('heartbeat',[{...node,device_id:'pro',role:'pro',last_seen_ms:now+31001}],fleetName);
    equal(await call('submit',[{...preferredSpec,job_id:'replay',created_at_ms:now+31001}],fleetName),placed);
    const fallback=await call('submit',[{...preferredSpec,job_id:'fallback',request_nonce:'fallback',created_at_ms:now+31001}],fleetName);
    equal(fallback.assignment.executor_device_id,'pro');
    equal(await call('submit',[{...preferredSpec,requirements:{...preferredSpec.requirements,prefer_device_id:'pro'}}],fleetName),{status:'rejected'});
  }
  console.log(`Fleet SQLite recovery: ${checks} checks passed; submit/claim/result replay creates no duplicate work.`);
} finally {await mf.dispose();}
