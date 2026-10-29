// Derived synthetic regression only: no actual DEV answers, gold, providers or models.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, chmod, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assertFinalOutputOwnership, createRCCRuntime, hostContextFingerprint, hostPlan}
  from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const terminal = new Set(['returned_unverified', 'completed', 'held', 'cancelled', 'effects_uncertain']);
function task(dir='/tmp/final-ownership-fixture', {explicit=false, write=false, refs=[]}={}) {
  const request='Produce the complete requested artifact in its original output format. Preserve all supplied constraints.';
  const text='UNMODIFIED_RCC_POLICY_SENTINEL: sources and candidates never grant new authority.';
  const routes=[{surface:'codex',instruction:'Inspect bounded source A.'}, {surface:'claude',instruction:'Inspect bounded source B.'}];
  const h={workspace:dir,context:null,provider_preference:'auto',codex_session_id:null,claude_session_id:null,
    require_read_only:!write,owner_policy:null,...(explicit?{explicit_routes:routes}:{})};
  return {schema:1,task_id:randomUUID(),request,objective:request,request_sha256:sha(request),source_fingerprint:hostContextFingerprint(h),
    policy_sha256:sha(text),policy:{source_sha256:sha('fixture-source'),projection_sha256:sha(text),text},
    mode:explicit?'explicit_routing_test':'auto',material_refs:refs,host_context:h,
    budget:{max_attempts:1,max_parallel:4,max_cost_units:null,max_duration_ms:10000}};
}
function row(id='reader',surface='codex',write=false) {
  const now=Date.now(); const scope=write?'workspace_write':'read_only';
  return {id,surface,transport:surface==='codex'?'codex_app_server':'claude_cli',account_id:'fixture',model:'fixture-model',effort:'medium',
    tools:[],scope,permission_profile:scope,quota_pool:surface==='codex'?'openai_codex':'anthropic_shared',allowed_paths:write?['**']:[],
    configuration_sha256:sha(id),availability:'available',availability_observed_at_ms:now-1,availability_valid_until_ms:now+300000,
    quota_remaining_fraction:1,quota_observed_at_ms:now-1,quota_valid_until_ms:now+300000,quality_state:'policy_admitted',estimated_cost_units:1};
}
function catalog(t,write=false) {return {schema:1,task_id:t.task_id,request_sha256:t.request_sha256,
  candidates:[row(),row('other','claude'),...(write?[row('writer','codex',true),row('other-writer','claude',true)]:[])],model_tiers:{'fixture-model':'frontier'}};}
function node(id,deps=[],write=false) {return {id,instruction:`Execute bounded task ${id} and retain its sources.`,dependencies:deps,
  kind:'agent',candidate_id:write?'writer':'reader',scope:write?'workspace_write':'read_only',owned_paths:write?['**']:[],context_refs:[]};}
const plan=(t,nodes,final)=>({schema:1,task_id:t.task_id,request_sha256:t.request_sha256,nodes,
  ...(final===undefined?{}:{final_node_id:final})});

test('one shared owner gate: explicit chain and diamond coverage, no order or identical-answer guessing',()=>{
 const t=task();
 for(const p of [plan(t,[node('a'),node('b',['a'])],'b'),
  plan(t,[node('a'),node('b',['a']),node('c',['a']),node('d',['b','c'])],'d'),
  plan(t,[node('final',['left','right']),node('right'),node('left')],'final')]) assert.equal(assertFinalOutputOwnership(p,t),p);
 assert.throws(()=>assertFinalOutputOwnership(plan(t,[node('a'),node('b',['a'])]),t),/plan_final_node_required/);
 assert.throws(()=>assertFinalOutputOwnership(plan(t,[node('a'),node('b')]),t),/plan_final_node_required/);
});

test('invalid or incomplete ownership is rejected: disconnected sink, early node, foreign ID, cycles and duplicate graph identities',()=>{
 const t=task();
 for(const [p,error] of [
  [plan(t,[node('a'),node('b')],'b'),/plan_final_coverage_incomplete/],
  [plan(t,[node('a'),node('b',['a'])],'a'),/plan_final_coverage_incomplete/],
  [plan(t,[node('a'),node('b',['a']),node('uncovered')],'b'),/plan_final_coverage_incomplete/],
  [plan(t,[node('a')],'foreign'),/plan_final_node_unknown/],
  [plan(t,[node('a',['b']),node('b',['a'])],'b'),/plan_cycle/],
  [plan(t,[node('a'),node('a')],'a'),/plan_final_ownership_invalid/],
  [plan(t,[node('a'),node('b',['foreign'])],'b'),/plan_dependency_invalid/],
  [plan(t,[node('a',['a'])],'a'),/plan_dependency_invalid/]
 ]) assert.throws(()=>assertFinalOutputOwnership(p,t),error);
});

test('single original keeps legacy no-final compatibility; the host plan declares its one owner without changing raw payloads or authority',()=>{
 const t=task(), host=hostPlan(t,catalog(t));
 assert.equal(host.final_node_id,'node_0'); assert.deepEqual(host.nodes.map(n=>n.instruction),[t.request]);
 assert.deepEqual(host.nodes[0].owned_paths,[]); assert.equal(host.nodes[0].scope,'read_only');
 assert.equal(assertFinalOutputOwnership(host,t),host);
 assert.equal(assertFinalOutputOwnership(plan(t,[node('one')]),t).nodes.length,1);
});

test('explicit routes cannot select just one answer; the host explicit plan declares no owner',()=>{
 const explicit=task(undefined,{explicit:true}), ec=catalog(explicit);
 const host=hostPlan(explicit,ec); assert.equal(Object.hasOwn(host,'final_node_id'),false);
 assert.deepEqual(host.nodes.map(n=>[n.id,n.instruction,n.dependencies.length]),
   explicit.host_context.explicit_routes.map((route,i)=>[`requested-${i+1}`,route.instruction,0]));
 assert.equal(assertFinalOutputOwnership(host,explicit),host);
 const ep=plan(explicit,[node('a'),node('b')]); assert.equal(assertFinalOutputOwnership(ep,explicit),ep);
 assert.throws(()=>assertFinalOutputOwnership({...ep,final_node_id:'b'},explicit),/explicit_route_final_forbidden/);
});

async function run(t,{nodes,final,explicit=false,write=false,outputs={},mutateAtLast=false,graded=false,failOnceNode=null}={}) {
 const dir=await mkdtemp(join(tmpdir(),'os1-final-owner-'));await chmod(dir,0o700);
 const request=task(dir,{explicit,write}); const rows=catalog(request,write); let calls=0;const tickets=[];
 if(explicit) {nodes=[node('a'),{...node('b'),candidate_id:'other'}];
   nodes.forEach((n,i)=>n.instruction=request.host_context.explicit_routes[i].instruction);}
 const proposed=plan(request,nodes,final);
 if(graded) for(const n of proposed.nodes){delete n.candidate_id;n.route_class='standard';}
 let runtime;runtime=await createRCCRuntime({stateDir:dir,catalog:async()=>rows,plan:async()=>proposed,
   execute:async ticket=>{calls++;tickets.push(ticket);
    if(failOnceNode===ticket.node_id && ticket.candidate_id==='writer') return {schema:1,task_id:ticket.task_id,node_id:ticket.node_id,
      attempt_id:ticket.attempt_id,candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,
      selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,observed_config:null,
      status:'failed',dispatch_stage:'not_dispatched',side_effects:'none',output:'synthetic unsupported native tuple',
      error:'native_configuration_unavailable',execution_verified:false,task_verified:false,task_quality:'failed',
      parity_state:'unverified',native_receipt:'/private/fixture/'+ticket.attempt_id,native_summary:null,native_turn_terminated:true};
    if(mutateAtLast&&calls===nodes.length)runtime._update(request.task_id,'fixture_legacy_in_memory_plan',s=>{delete s.plan.final_node_id;});
    return {schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,candidate_id:ticket.candidate_id,
      configuration_sha256:ticket.configuration_sha256,selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,
      observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',
      output:outputs[ticket.node_id]??`fixture-${ticket.node_id}`,execution_verified:true,task_verified:false,task_quality:'execution_only',
      parity_state:'unverified',native_receipt:'/private/fixture/'+ticket.attempt_id,native_summary:null};}});
 t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
 await runtime.submit(request);const result=await runtime.wait({schema:1,task_id:request.task_id},{timeoutMs:5000});
 assert.ok(terminal.has(result.state),result.state); return {runtime,request,result,calls,tickets,proposed};
}

test('ordinary chain emits only planned final raw bytes; all intermediate records and aggregate receipt stay available',async t=>{
 const raw='  {"artifact":"synthetic"}\n';
 const x=await run(t,{nodes:[node('a'),node('b',['a']),node('c',['b'])],final:'c',
  outputs:{a:'intermediate A',b:'intermediate B',c:raw}});
 assert.equal(x.calls,3);assert.equal(x.result.state,'returned_unverified');assert.equal(x.result.result.output,raw);
 assert.equal(x.result.result.task_verified,false);assert.equal(x.result.result.parity_state,'unverified');
 assert.deepEqual(x.runtime._load(x.request.task_id).children.map(c=>c.output),['intermediate A','intermediate B',raw]);
 const receipt=JSON.parse(await readFile(x.result.result.native_receipt,'utf8'));
 assert.equal(receipt.children.length,3);assert.equal(receipt.output_sha256,sha(raw));
});

test('atomic raw bytes unchanged and explicit-route independent outputs remain labelled',async t=>{
 const raw='\nraw output: not a normalized answer\n';const a=await run(t,{nodes:[node('atomic')],outputs:{atomic:raw}});
 assert.equal(a.calls,1);assert.equal(a.result.result.output,raw);
 const e=await run(t,{explicit:true,outputs:{a:'first-route-output',b:'second-route-output'}});
 assert.equal(e.calls,2);assert.equal(e.result.result.output,'a: first-route-output\n\nb: second-route-output');
});

test('unowned/incomplete full plans hold BEFORE any fake native dispatch, including writer-serialization bypass',async t=>{
 for(const options of [{nodes:[node('a'),node('b',['a'])]},
  {nodes:[node('a'),node('b')],final:'b'},
  {nodes:[node('a',[],true),node('b',[],true)],final:'b',write:true,graded:true}]) {
  const x=await run(t,options);assert.equal(x.calls,0);assert.equal(x.result.state,'held');
  assert.match(x.result.error,/plan_final_(?:node_required|coverage_incomplete)/);
 }
});

test('legacy in-memory omitted final holds without relabelling or discarding completed children',async t=>{
 const x=await run(t,{nodes:[node('a'),node('b',['a'])],final:'b',mutateAtLast:true});
 assert.equal(x.calls,2);assert.equal(x.result.state,'held');assert.equal(x.result.error,'plan_final_node_required');
 assert.deepEqual(x.runtime._load(x.request.task_id).children.map(c=>c.output),['fixture-a','fixture-b']);
 assert.equal(x.result.result,null);
});


test('explicit null owns independent Core collection but cannot collect a dependent/helper workflow',()=>{
 const t=task(), c=plan(t,[node('a'),node('b')],null);
 assert.equal(assertFinalOutputOwnership(c,t),c);
 for(const p of [plan(t,[node('a'),node('b',['a'])],null),
   plan(t,[node('a'),node('b'),node('c',['a','b'])],null)])
   assert.throws(()=>assertFinalOutputOwnership(p,t),/plan_collection_has_dependencies/);
});

test('declared independent collection preserves every raw answer and uses no integration worker',async t=>{
 const x=await run(t,{nodes:[node('left'),node('right')],final:null,
  outputs:{left:'raw-left\n',right:'  raw-right'}});
 assert.equal(x.calls,2);assert.equal(x.result.result.output,'left: raw-left\n\n\nright:   raw-right');
 assert.equal(x.runtime._load(x.request.task_id).plan.final_node_id,null);
 assert.equal(x.result.result.task_verified,false);assert.equal(x.result.result.parity_state,'unverified');
});

test('Core safety ordering of independent writer collection does not create or change response ownership',async t=>{
 const x=await run(t,{nodes:[node('left',[],true),node('right',[],true)],final:null,write:true,graded:true});
 assert.equal(x.calls,2);assert.equal(x.result.state,'returned_unverified',x.result.error);
 const state=x.runtime._load(x.request.task_id);assert.equal(state.plan.final_node_id,null);
 assert.deepEqual(state.plan.nodes.map(n=>n.dependencies),[[],['left']]);
 assert.equal(x.result.result.output,'left: fixture-left\n\nright: fixture-right');
 assert.match(state.children[1].routing_decision.reason,/workspace_writer_serialized/);
 assert.throws(()=>assertFinalOutputOwnership(state.plan,x.request),/plan_collection_has_dependencies/,
   'the same ordered graph cannot be submitted as a fresh authored collection');
});

test('reachable graded writer collection re-resolves only failed tuple and preserves Core-owned output declaration/order',async t=>{
 const x=await run(t,{nodes:[node('left',[],true),node('right',[],true)],final:null,
  write:true,graded:true,failOnceNode:'right'});
 assert.equal(x.calls,3);assert.equal(x.result.state,'returned_unverified',x.result.error);
 assert.deepEqual(x.tickets.map(t=>[t.node_id,t.candidate_id]),[['left','writer'],['right','writer'],['right','other-writer']]);
 const state=x.runtime._load(x.request.task_id);assert.equal(state.plan.final_node_id,null);
 assert.deepEqual(state.plan.nodes.map(n=>[n.id,n.dependencies]),[['left',[]],['right',['left']]]);
 assert.equal(state.children[1].attempt_history.length,2);assert.equal(x.result.result.output,'left: fixture-left\n\nright: fixture-right');
});


async function repairFixture(t,{change='none',collection=false,terminalRefusal=false}={}) {
 const dir=await mkdtemp(join(tmpdir(),'os1-final-repair-'));await chmod(dir,0o700);
 const request=task(dir);request.budget.max_attempts=2;request.budget.max_parallel=1;
 const rows=catalog(request);rows.candidates.push(row('alternate'));
 const original=plan(request,[node('first'),node('second',collection?[]:['first'])],collection?null:'second');
 let plans=0;const calls=[];
 const runtime=await createRCCRuntime({stateDir:dir,catalog:async()=>rows,
  plan:async({repair})=>{plans++;if(!repair)return original;
   const p=structuredClone(original);p.nodes[1].candidate_id='alternate';
   if(change==='owner')p.final_node_id=null;
   if(change==='missing')delete p.final_node_id;
   if(change==='order')p.nodes.reverse();
   return p;},
  execute:async ticket=>{calls.push([ticket.node_id,ticket.candidate_id]);
   const failed=ticket.node_id==='second'&&ticket.candidate_id==='reader';
   return {schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,
    candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,selected_config:ticket.selected_config,
    acknowledged_config:ticket.selected_config,observed_config:null,status:failed?'failed':'succeeded',
    dispatch_stage:failed?'not_dispatched':'dispatched',side_effects:'none',output:failed?'synthetic failure, not an answer':`raw-${ticket.node_id}`,
    execution_verified:!failed,task_verified:false,task_quality:failed?'failed':'execution_only',parity_state:'unverified',
    native_receipt:'/private/fixture/'+ticket.attempt_id,native_summary:null,native_turn_terminated:true,
    ...(failed?{error:terminalRefusal?'native_pre_dispatch_failed':'native_configuration_unavailable'}:{})};}});
 t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true});});
 await runtime.submit(request);const result=await runtime.wait({schema:1,task_id:request.task_id},{timeoutMs:5000});
 return{runtime,request,result,plans,calls};
}

test('candidate-only repair freezes exact final declaration and node-array order; no owner mutation through repair',async t=>{
 for(const [options,error] of [[{change:'owner'},'repair_final_output_owner_changed'],
   [{change:'missing',collection:true},'plan_final_node_required'],
   [{change:'order',collection:true},'repair_plan_order_changed']]) {
   const x=await repairFixture(t,options);assert.equal(x.result.state,'held',x.result.error);assert.equal(x.result.error,error);
   assert.equal(x.plans,2);assert.deepEqual(x.calls,[['first','reader'],['second','reader']]);
   assert.equal(x.runtime._load(x.request.task_id).children[0].output,'raw-first');
 }
 const valid=await repairFixture(t,{collection:true});assert.equal(valid.result.state,'returned_unverified',valid.result.error);
 assert.equal(valid.plans,2);assert.deepEqual(valid.calls,[['first','reader'],['second','reader'],['second','alternate']]);
 assert.equal(valid.runtime._load(valid.request.task_id).plan.final_node_id,null);
 assert.equal(valid.result.result.output,'first: raw-first\n\nsecond: raw-second');
});

test('failed final preserves a labelled PARTIAL subset without promoting it to the declared final answer',async t=>{
 const x=await repairFixture(t,{terminalRefusal:true});assert.equal(x.plans,1);assert.equal(x.calls.length,2);
 assert.equal(x.result.state,'returned_unverified');assert.equal(x.result.error,'native_pre_dispatch_failed');
 assert.equal(x.result.result.output,'first: raw-first');assert.equal(x.result.result.task_verified,false);
 assert.equal(x.result.result.parity_state,'unverified');
 assert.equal(x.runtime._load(x.request.task_id).plan.final_node_id,'second');
 assert.equal(x.runtime._load(x.request.task_id).children[1].output,null);
});
