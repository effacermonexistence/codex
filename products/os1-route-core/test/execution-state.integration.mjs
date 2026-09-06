import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const wr = createRequire(require.resolve('wrangler'));
const { Miniflare, convertV4MiniflareOptions } = await import(pathToFileURL(wr.resolve('miniflare')));
const esbuild = await import(pathToFileURL(wr.resolve('esbuild')));
const source = `import { ExecutionState } from './src/execution-state.ts';
export { ExecutionState };
export default {async fetch(request, env) {const b=await request.json(); return Response.json(await env.EXECUTIONS.getByName(b.name)[b.op](b.input));}};`;
const bundled = await esbuild.build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,
  format:'esm',platform:'neutral',external:['cloudflare:workers']});
const mf = new Miniflare(convertV4MiniflareOptions({name:'execution-test', compatibilityDate:'2026-09-01',
  modules:[{type:'ESModule',path:'index.mjs',contents:bundled.outputFiles[0].text}],
  durableObjects:{EXECUTIONS:{className:'ExecutionState',useSQLite:true}}, telemetry:{enabled:false},logRequests:false}));
let checks=0;
async function call(op,input,name='lease') {
  const r=await mf.dispatchFetch('https://local/test',{method:'POST',body:JSON.stringify({op,input,name})});
  assert.equal(r.status,200); return r.json();
}
function equal(a,b){assert.deepEqual(a,b);checks++;}
const t=1_000_000;
const base={execution_id:'test',subject_hash:'a',device_id:'device',sequence:1,nonce:'nonce',expires_at:t+300_000,phase:'active'};
const command={subject_hash:'a',device_id:'device',sequence:1,nonce:'nonce',now:t};
const result={...command,result_hash:'hash',now:t+335_000};
try {
  equal(await call('begin',base),'created');
  equal(await call('startAttempt',{...command,device_id:'other'}),null);
  const lease=await call('startAttempt',command);
  equal(lease,{execution_deadline:t+1_800_000,submission_deadline:t+88_200_000});
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
  equal(await call('startAttempt',{...command,now:t+1_800_001},'expiry'),null);
  equal(await call('claim',{...result,now:t+88_200_001},'expiry'),{kind:'rejected'});
  console.log(`Execution SQLite integration: ${checks} checks passed; 335s result accepted; stale starts, identity changes, hash changes and unfenced finalization rejected.`);
} finally { await mf.dispose(); }
