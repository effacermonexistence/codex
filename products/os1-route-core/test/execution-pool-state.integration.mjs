import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const wr = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wr.resolve('miniflare')));
const esbuild = await import(pathToFileURL(wr.resolve('esbuild')));
const source = `import { ExecutionPoolState } from './src/execution-pool-state.ts';
export { ExecutionPoolState };
export default {async fetch(request, env) {const b=await request.json(); return Response.json(await env.EXECUTION_POOLS.getByName('startup-v1')[b.op](b.input));}};`;
const bundled = await esbuild.build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,
  format:'esm',platform:'neutral',external:['cloudflare:workers']});
const mf = new Miniflare(convertV4MiniflareOptions({name:'execution-test', compatibilityDate:'2026-09-01',
  modules:[{type:'ESModule',path:'index.mjs',contents:bundled.outputFiles[0].text}],
  durableObjects:{EXECUTION_POOLS:{className:'ExecutionPoolState',useSQLite:true}}, telemetry:{enabled:false},logRequests:false}));
let checks=0;
const ids=new Map();
function id(name){if(!ids.has(name))ids.set(name,`00000000-0000-4000-8000-${String(ids.size+1).padStart(12,'0')}`);return ids.get(name);}
async function call(op,input,name='lease') {
  input={...input,execution_id:id(name)};
  const r=await mf.dispatchFetch('https://local/test',{method:'POST',body:JSON.stringify({op,input,name})});
  assert.equal(r.status,200); return r.json();
}
function equal(a,b){assert.deepEqual(a,b);checks++;}
const t=1_000_000;
const base={execution_id:'test',subject_hash:'a',device_id:'device',sequence:1,nonce:'nonce',expires_at:t+300_000,phase:'active'};
const command={subject_hash:'a',device_id:'device',sequence:1,nonce:'nonce',now:t};
const result={...command,result_hash:'hash',now:t+335_000};
try {
  equal(await call('ready',{}),true);
  equal(await call('startAttempt',command),null);
  equal(await call('permitsArtifact',result),false);
  equal(await call('begin',base),'created');
  equal(await call('startAttempt',{...command,device_id:'other'}),null);
  const lease=await call('startAttempt',command);
  equal(lease,{execution_deadline:t+14_400_000,submission_deadline:t+100_800_000});
  equal(await call('startAttempt',{...command,now:t+1000}),lease);
  equal(await call('permitsArtifact',result),true);
  equal(await call('permitsArtifact',{...result,device_id:'other'}),false);
  const first=await call('claim',result); equal(first.kind,'claimed');
  equal(await call('claim',result),{kind:'pending',retry_after_ms:60_000});
  equal(await call('claim',{...result,result_hash:'changed',now:t+400_000}),{kind:'rejected'});
  const recovered=await call('claim',{...result,now:t+400_000}); equal(recovered.kind,'claimed');
  equal(await call('finalize',{sequence:1,result_hash:'hash',response_json:'{"status":"complete"}',next:null,claim_token:first.claim_token}),{kind:'rejected'});
  equal((await call('finalize',{sequence:1,result_hash:'hash',response_json:'{"status":"complete"}',next:null,claim_token:recovered.claim_token})).kind,'stored');
  equal(await call('claim',{...result,now:t+90_000_000}),{kind:'completed',response_json:'{"status":"complete"}'});
  equal(await call('claim',{...result,subject_hash:'other',now:t+90_000_000}),{kind:'rejected'});
  equal(await call('begin',base,'late'),'created');
  equal(await call('startAttempt',{...command,now:t+300_001},'late'),null);
  equal(await call('permitsArtifact',result,'late'),false);
  equal(await call('begin',base,'expiry'),'created');
  await call('startAttempt',command,'expiry');
  equal(await call('startAttempt',{...command,now:t+1_800_001},'expiry'),lease);
  equal(await call('startAttempt',{...command,now:t+14_400_001},'expiry'),null);
  equal(await call('claim',{...result,now:t+100_800_001},'expiry'),{kind:'rejected'});
  // A three-hour attempt that kept working is still accepted.
  equal(await call('begin',base,'long'),'created');
  await call('startAttempt',command,'long');
  equal((await call('claim',{...result,now:t+10_800_000},'long')).kind,'claimed');
  // All groups share one DO but retain independent rows, claims and completion state.
  equal(await call('begin',{...base,device_id:'device-A'},'A'),'created');
  equal(await call('begin',{...base,device_id:'device-B'},'B'),'created');
  const a={...command,device_id:'device-A'},b={...command,device_id:'device-B'};
  await Promise.all([call('startAttempt',a,'A'),call('startAttempt',b,'B')]);
  equal(await call('startAttempt',a,'B'),null);
  equal(await call('permitsArtifact',{...result,device_id:'device-A'},'B'),false);
  const ar={...result,device_id:'device-A'},br={...result,device_id:'device-B'};
  const [ac,bc]=await Promise.all([call('claim',ar,'A'),call('claim',br,'B')]);
  equal(ac.kind,'claimed');equal(bc.kind,'claimed');
  equal(await call('finalize',{sequence:1,result_hash:'hash',response_json:'{"status":"complete"}',next:null,claim_token:ac.claim_token},'B'),{kind:'rejected'});
  equal((await call('finalize',{sequence:1,result_hash:'hash',response_json:'{"status":"complete"}',next:null,claim_token:ac.claim_token},'A')).kind,'stored');
  equal(await call('claim',br,'B'),{kind:'pending',retry_after_ms:60_000});
  // Concurrent duplicated delivery acquires exactly one owner token.
  equal(await call('begin',base,'concurrent'),'created');await call('startAttempt',command,'concurrent');
  const parallel=await Promise.all(Array.from({length:12},()=>call('claim',result,'concurrent')));
  equal(parallel.filter(x=>x.kind==='claimed').length,1);equal(parallel.filter(x=>x.kind==='pending').length,11);
  equal(await call('begin',base,'steps'),'created');await call('startAttempt',command,'steps');
  const sc=await call('claim',result,'steps');equal(sc.kind,'claimed');
  const retry='{"sequence":2,"status":"step"}';
  equal((await call('finalize',{sequence:1,result_hash:'hash',response_json:retry,claim_token:sc.claim_token,
    next:{sequence:2,nonce:'next',expires_at:t+900_000}},'steps')).kind,'stored');
  equal(await call('startAttempt',command,'steps'),null);
  equal(await call('claim',result,'steps'),{kind:'completed',response_json:retry});
  const second={...command,sequence:2,nonce:'next',now:t+400_000};
  const lease2=await call('startAttempt',second,'steps');equal(lease2.execution_deadline,t+400_000+14_400_000);
  equal(await call('startAttempt',{...second,nonce:'nonce'},'steps'),null);
  const sr={...second,result_hash:'second-hash'};equal((await call('claim',sr,'steps')).kind,'claimed');
  // Duplicated begin admissions cannot overwrite the original identity or nonce.
  const admissions=await Promise.all(Array.from({length:12},()=>call('begin',base,'begin-once')));
  equal(admissions.filter(x=>x==='created').length,1);equal(admissions.filter(x=>x==='exists').length,11);
  equal(await call('begin',{...base,device_id:'replacement'},'begin-once'),'exists');
  equal(await call('startAttempt',{...command,device_id:'replacement'},'begin-once'),null);
    console.log(`Execution Pool SQLite integration: ${checks} checks passed; 335s and 3h results accepted; stale starts, identity changes, hash changes and unfenced finalization rejected.`);
} finally { await mf.dispose(); }
