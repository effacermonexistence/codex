// New Codex read-only branches may overlap inside ONE durable parent fence.
// Actual SQLite and barriers; fake backends only, no model/account/HOME access.
import assert from 'node:assert/strict';
import{createHash,randomUUID}from'node:crypto';
import{mkdtemp,chmod,rm}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';import test from'node:test';
import{createRCCRuntime,hostContextFingerprint}from'../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function until(fn){const end=Date.now()+5000;while(Date.now()<end){if(fn())return;await sleep(10);}throw Error('condition timeout');}
async function root(t){const p=await mkdtemp(join(tmpdir(),'os1-read-pool-'));await chmod(p,0o700);t.after(()=>rm(p,{recursive:true,force:true}));return p;}
function task(workspace,extra={}){const text='Run independent source checks';const host={workspace,context:null,provider_preference:'codex',codex_session_id:extra.resume??null,claude_session_id:null,require_read_only:extra.write!==true,owner_policy:null};return{schema:1,task_id:randomUUID(),request:text,objective:text,request_sha256:hash(text),source_fingerprint:hostContextFingerprint(host),policy_sha256:hash('fixture policy'),mode:'auto',material_refs:[],host_context:host,policy:{source_sha256:hash('fixture source'),projection_sha256:hash('fixture policy'),text:'fixture policy'},budget:{max_parallel:extra.parallel??4,max_attempts:1,max_cost_units:null,max_duration_ms:20000}};}
function row(id='ro',write=false){const now=Date.now();return{id,surface:'codex',transport:'codex_app_server',account_id:'fixture',model:'fixture',effort:'low',tools:[],scope:write?'workspace_write':'read_only',permission_profile:write?'workspace_write':'read_only',quota_pool:'openai_codex',allowed_paths:write?['one.txt']:[],configuration_sha256:hash(id),availability:'available',availability_observed_at_ms:now-1,availability_valid_until_ms:now+30000,quota_remaining_fraction:0.8,quota_observed_at_ms:now-1,quota_valid_until_ms:now+30000,quality_state:'policy_admitted',estimated_cost_units:1};}
const node=(id,c,dependencies=[])=>({id,instruction:'Read source for '+id,dependencies,kind:'agent',candidate_id:c.id,scope:c.scope,owned_paths:c.allowed_paths,context_refs:[]});
const plan=(t,nodes)=>({schema:1,task_id:t.task_id,request_sha256:t.request_sha256,nodes});
const result=(t,extra={})=>({schema:1,task_id:t.task_id,node_id:t.node_id,attempt_id:t.attempt_id,candidate_id:t.candidate_id,configuration_sha256:t.configuration_sha256,selected_config:t.selected_config,acknowledged_config:t.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',output:t.node_id+' ok',execution_verified:true,task_verified:true,task_quality:'task_verified',parity_state:'unverified',native_receipt:'/private/fixture/'+t.attempt_id,native_summary:JSON.stringify({fixture:true}),native_turn_terminated:true,...extra});
const verdict=({task,children})=>({schema:1,task_id:task.task_id,task_verified:true,output:children.map(x=>x.output).join('\n'),parity_state:'unverified',reason:'fixture_only'});
const fence=rt=>rt.db.prepare('select * from quota_leases').all();
async function runtime(t,dir,request,nodes,execute,extra={}){const rt=await createRCCRuntime({stateDir:dir,maximumWorkers:4,maximumReadWorkersPerPool:4,catalog:async q=>({schema:1,task_id:q.task_id,request_sha256:q.request_sha256,candidates:[row(),row('wr',true)]}),plan:async({task:q})=>plan(q,nodes),execute,verifyTask:verdict,...extra});t.after(()=>rt.close());return rt;}

test('same-parent Codex readers overlap; first result retains the fence for its sibling',async t=>{const dir=await root(t),q=task(dir),c=row(),a=gate(),b=gate(),started=[];const rt=await runtime(t,dir,q,[node('a',c),node('b',c)],async ticket=>{started.push(ticket.node_id);assert.equal(ticket.native_resume_session_id,null);await(ticket.node_id==='a'?a.promise:b.promise);return result(ticket);});t.after(()=>{a.resolve();b.resolve();});await rt.submit(q);await until(()=>started.length===2);assert.equal(rt.activeWorkers,2);assert.equal(fence(rt).length,1);a.resolve();await until(()=>rt.status({schema:1,task_id:q.task_id}).children.find(n=>n.id==='a').state==='completed');assert.equal(fence(rt).length,1);assert.equal(rt.poolReservations.size,1);b.resolve();const done=await rt.wait({schema:1,task_id:q.task_id},{timeoutMs:5000});assert.equal(done.state,'completed');await until(()=>fence(rt).length===0);assert.equal(rt.activeWorkers,0);});

test('existing conversation history still uses independent fresh sessions for a multi-node DAG',async t=>{const dir=await root(t),q=task(dir,{resume:randomUUID()}),c=row(),hold=gate(),tickets=[];const rt=await runtime(t,dir,q,[node('a',c),node('b',c)],async x=>{tickets.push(x);await hold.promise;return result(x);});t.after(hold.resolve);await rt.submit(q);await until(()=>tickets.length===2);assert.ok(tickets.every(x=>x.native_resume_session_id===null));hold.resolve();assert.equal((await rt.wait({schema:1,task_id:q.task_id},{timeoutMs:5000})).state,'completed');});

for(const [name,opts]of[['parent max_parallel=1',{parallel:1}],['legacy factory default',{limit:1}],['writer never shares a read slot',{write:true}]])test(name,async t=>{const dir=await root(t),q=task(dir,opts),c=row(),w=opts.write?row('wr',true):c;let active=0,peak=0;const rt=await runtime(t,dir,q,[node('a',w),node('b',c)],async x=>{active++;peak=Math.max(peak,active);await sleep(50);active--;return result(x);},opts.limit?{maximumReadWorkersPerPool:opts.limit}:{});await rt.submit(q);assert.equal((await rt.wait({schema:1,task_id:q.task_id},{timeoutMs:5000})).state,'completed');assert.equal(peak,1);});

test('another parent remains outside the pool fence, including a shared resumed native thread',async t=>{const dir=await root(t),resume=randomUUID(),a=task(dir,{resume}),b=task(dir,{resume}),c=row(),hold=gate(),started=[];const rt=await runtime(t,dir,a,[node('only',c)],async x=>{started.push(x);assert.equal(x.native_resume_session_id,resume);if(x.task_id===a.task_id)await hold.promise;return result(x);});t.after(hold.resolve);await rt.submit(a);await until(()=>started.length===1);await rt.submit(b);await sleep(100);assert.equal(started.length,1);hold.resolve();assert.equal((await rt.wait({schema:1,task_id:a.task_id},{timeoutMs:5000})).state,'completed');assert.equal((await rt.wait({schema:1,task_id:b.task_id},{timeoutMs:5000})).state,'completed');assert.equal(started.length,2);});

test('cancellation stays conservative and settles each child before releasing the sibling fence',async t=>{const dir=await root(t),q=task(dir),c=row(),acks={a:gate(),b:gate()},started=[];const rt=await runtime(t,dir,q,[node('a',c),node('b',c)],async(x,signal)=>{started.push(x.node_id);await new Promise(r=>signal.addEventListener('abort',r,{once:true}));await acks[x.node_id].promise;return result(x,{status:'failed',error:'fixture_cancelled_after_dispatch',execution_verified:false,task_verified:false,task_quality:'execution_only'});});t.after(()=>{acks.a.resolve();acks.b.resolve();});await rt.submit(q);await until(()=>started.length===2);await rt.cancel({schema:1,task_id:q.task_id});acks.a.resolve();await sleep(50);assert.equal(fence(rt).length,1);acks.b.resolve();const done=await rt.wait({schema:1,task_id:q.task_id},{timeoutMs:5000});assert.equal(done.state,'effects_uncertain');assert.ok(done.children.every(x=>x.state==='effects_uncertain'));await until(()=>fence(rt).length===0);});

for (const malformed of [false, true]) test(malformed ?
  'a malformed executor record quarantines its pool but never discards a settled sibling' :
  'a valid unsettled reader quarantines its pool but preserves a settled sibling and fences foreign parents', async t => {
  const dir = await root(t), q = task(dir, {parallel: 2}), c = row(), a = gate(), b = gate(), started = [];
  const rt = await runtime(t, dir, q, [node('a', c), node('b', c), node('c', c)], async x => {
    started.push({task: x.task_id, node: x.node_id});
    await (x.node_id === 'a' ? a.promise : b.promise);
    return x.node_id === 'a' ? result(x, {status: 'failed',
      // "possible" is a valid uncertain native outcome. "unknown" is
      // deliberately malformed and covers the separate validation-throw path.
      side_effects: malformed ? 'unknown' : 'possible', execution_verified: false,
      task_verified: false, task_quality: 'execution_only', native_turn_terminated: false,
      error: 'transport_lost'}) : result(x);
  }, {maximumReadWorkersPerPool: 2});
  t.after(() => { a.resolve(); b.resolve(); });
  await rt.submit(q); await until(() => started.length === 2);
  a.resolve();
  await until(() => rt.status({schema: 1, task_id: q.task_id}).children.find(x => x.id === 'a').state === 'effects_uncertain');
  const pending = rt.status({schema: 1, task_id: q.task_id});
  assert.equal(pending.state, 'running', 'parent remains observable until already-running sibling reconciles');
  assert.equal(pending.children.find(x => x.id === 'b').state, 'running');
  await sleep(60); assert.deepEqual(started.map(x => x.node), ['a', 'b']);
  assert.equal(fence(rt).length, 1);
  b.resolve();
  const done = await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000});
  assert.equal(done.state, 'effects_uncertain');
  const stored = rt._load(q.task_id), settled = stored.children.find(x => x.id === 'b');
  assert.equal(settled.state, 'completed'); assert.equal(settled.output, 'b ok');
  assert.ok(settled.native_receipt.startsWith('/private/fixture/'));
  assert.equal(settled.attempt_history.at(-1).state, 'completed');
  assert.equal(settled.attempt_history.at(-1).native_receipt, settled.native_receipt);
  const uncertain = stored.children.find(x => x.id === 'a');
  assert.equal(uncertain.state, 'effects_uncertain');
  if (!malformed) assert.equal(uncertain.attempt_history.at(-1).native_turn_terminated, false);
  assert.equal(fence(rt).length, 1, 'unsettled reader is never auto-unquarantined');
  assert.equal(rt.activeWorkers, 0); assert.equal(rt.readPoolReservations.size, 0);
  assert.ok(!started.some(x => x.node === 'c'));
  const foreign = task(dir, {parallel: 2}); await rt.submit(foreign);
  const held = await rt.wait({schema: 1, task_id: foreign.task_id}, {timeoutMs: 5_000});
  assert.equal(held.state, 'held'); assert.equal(held.error, 'quota_pool_effects_uncertain');
  assert.ok(!started.some(x => x.task === foreign.task_id)); assert.equal(fence(rt).length, 1);
});

test('reader limit two bounds a three-child parent without releasing its durable fence early', async t => {
  const dir = await root(t), q = task(dir), c = row(), gates = {a: gate(), b: gate(), c: gate()};
  const started = []; let active = 0, peak = 0;
  const rt = await runtime(t, dir, q, [node('a', c), node('b', c), node('c', c)], async x => {
    started.push(x.node_id); active++; peak = Math.max(peak, active);
    await gates[x.node_id].promise; active--; return result(x);
  }, {maximumReadWorkersPerPool: 2});
  t.after(() => Object.values(gates).forEach(x => x.resolve()));
  await rt.submit(q); await until(() => started.length === 2); await sleep(60);
  assert.deepEqual(started, ['a', 'b']); assert.equal(peak, 2); assert.equal(fence(rt).length, 1);
  gates.a.resolve(); await until(() => started.length === 3);
  assert.equal(peak, 2); assert.equal(fence(rt).length, 1);
  gates.b.resolve(); gates.c.resolve();
  assert.equal((await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000})).state, 'completed');
  await until(() => fence(rt).length === 0); assert.equal(rt.activeWorkers, 0);
});

test('legacy native_sessions metadata conservatively disables same-parent reader sharing', async t => {
  const dir = await root(t), q = {...task(dir), native_sessions: {codex: randomUUID()}}, c = row();
  let active = 0, peak = 0;
  const rt = await runtime(t, dir, q, [node('a', c), node('b', c)], async x => {
    active++; peak = Math.max(peak, active); await sleep(50); active--; return result(x);
  });
  await rt.submit(q);
  assert.equal((await rt.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 5_000})).state, 'completed');
  assert.equal(peak, 1);
});

test('a second parent stays fenced while any reader of the first parent remains active', async t => {
  const dir = await root(t), first = task(dir), foreign = task(dir), c = row(), a = gate(), b = gate(), started = [];
  const rt = await runtime(t, dir, first, [node('a', c), node('b', c)], async x => {
    started.push({task: x.task_id, node: x.node_id});
    if (x.task_id === first.task_id) await (x.node_id === 'a' ? a.promise : b.promise);
    return result(x);
  }, {plan: async ({task: q}) => plan(q, q.task_id === first.task_id ? [node('a', c), node('b', c)] : [node('foreign', c)])});
  t.after(() => { a.resolve(); b.resolve(); });
  await rt.submit(first); await until(() => started.length === 2); await rt.submit(foreign);
  a.resolve(); await until(() => rt.status({schema: 1, task_id: first.task_id}).children.find(x => x.id === 'a').state === 'completed');
  await sleep(60); assert.ok(!started.some(x => x.task === foreign.task_id)); assert.equal(fence(rt).length, 1);
  b.resolve(); assert.equal((await rt.wait({schema: 1, task_id: first.task_id}, {timeoutMs: 5_000})).state, 'completed');
  assert.equal((await rt.wait({schema: 1, task_id: foreign.task_id}, {timeoutMs: 5_000})).state, 'completed');
  assert.equal(started.filter(x => x.task === foreign.task_id).length, 1);
  await until(() => fence(rt).length === 0);
});
