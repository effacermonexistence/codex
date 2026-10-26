// Exact Core + temp SQLite, deterministic virtual Date/setTimeout only.
// No real wait, provider/model/native/SDK/RPC call or real HOME mutation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, chmod, rm, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setImmediate as turn} from 'node:timers/promises';
import {createRCCRuntime, hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
const H=x=>createHash('sha256').update(x).digest('hex');
const policyText='Preserve source and scope. A plan is not quality authority.';
const proposal=()=>JSON.stringify({schema:2,kind:'untrusted_local_plan_proposal',nodes:['a','b'].map(id=>({
 proposal_node_id:id,instruction:'Explain the supplied boundary.',requirement_refs:['owner_objective'],dependencies:[],material_refs:[],
 proposed_candidate_id:'reference',proposed_scope:'read_only',proposed_owned_paths:[],required_output:'Source-grounded explanation',check_refs:[],reason_code:'independent_read'})),
 final_output_proposal:{mode:'ordered_collection',node_ids:['a','b']}});
const reply=()=>({status:'proposal',raw_proposal:proposal(),completion_outcome_unknown:false});
function completed(t){return{schema:1,task_id:t.task_id,node_id:t.node_id,attempt_id:t.attempt_id,candidate_id:t.candidate_id,
 configuration_sha256:t.configuration_sha256,selected_config:t.selected_config,acknowledged_config:t.selected_config,observed_config:null,
 status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',execution_verified:true,task_verified:false,task_quality:'execution_only',
 parity_state:'unverified',output:'canned fixture output',native_receipt:'/private/fixture/'+t.attempt_id,native_summary:null};}
// K3: bounded Auto never asks the local planner until an applicable sound_full
// check and a plan-shape certificate (K11b) exist, so its 120 s Core deadline
// is wired but unreachable; the deadline, cancel, quiesce and stale-row
// controls below run on the legacy shadow observer (20 s). K11b restores the
// bounded-deadline cases when it reopens the gate.
async function until(f,label){for(let i=0;i<2000;i++){if(f())return;await turn();}throw Error('fixture did not settle: '+label);}
async function harness(t,{duration=240000,bounded=false,catalogChange=null,ignoreAbort=false,awaitPlanner=true}={}){
 const dir=await realpath(await mkdtemp(join(tmpdir(),'os1-planner-deadline-')));await chmod(dir,0o700);
 const initial=Date.now();t.mock.timers.enable({apis:['Date','setTimeout'],now:initial});
 const host={workspace:dir,context:null,provider_preference:'auto',codex_session_id:null,claude_session_id:null,require_read_only:true,owner_policy:null};
 const q={schema:1,task_id:randomUUID(),request:'Explain the supplied source boundary.',objective:'Explain the supplied source boundary.',
 request_sha256:H('Explain the supplied source boundary.'),policy_sha256:H(policyText),source_fingerprint:hostContextFingerprint(host),
 mode:'auto',material_refs:[],budget:{max_attempts:1,max_parallel:4,max_cost_units:null,max_duration_ms:duration},host_context:host,
 policy:{source_sha256:H('source'),projection_sha256:H(policyText),text:policyText}};
 const tickets=[];let args,resolve,reject,plannerCalls=0,catalogCalls=0;
 const baseCatalog=()=>({schema:1,task_id:q.task_id,request_sha256:q.request_sha256,owner_scope:'read_only',request_class:'readonly_lookup',chat_lane_eligible:false,
 model_tiers:{'gpt-6-astra':'frontier'},candidates:[{id:'reference',surface:'codex',transport:'codex_app_server',account_id:'fixture',model:'gpt-6-astra',effort:'ultra',
 tools:['read','execute'],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:H('config'),availability:'available',
 availability_observed_at_ms:Date.now()-1,availability_valid_until_ms:Date.now()+180000,quota_remaining_fraction:0.8,quota_observed_at_ms:Date.now()-1,quota_valid_until_ms:Date.now()+180000,
 quality_state:'policy_admitted',estimated_cost_units:1}]});
 const runtime=await createRCCRuntime({stateDir:dir,hostAutoPlan:true,boundedAutoPlanning:bounded,
 ...(bounded?{}:{adaptiveRoutingPolicy:{schema:1,mode:'shadow',policy_id:'legacy-shadow',version:'1',rcc_source_sha256:H('source'),projection_sha256:H(policyText),reference_policy_sha256:null,
 allowed_workload_classes:['readonly_lookup'],max_nodes:4,max_parallel:2,max_plan_revisions:0,max_planner_calls:1,planner_input_bytes:64000,planner_output_tokens:1536,requires_live_reference_fallback:true,adoption_manifest_sha256:null}}),
 catalog:async()=>{catalogCalls++;const c=baseCatalog();catalogChange?.(c,catalogCalls,initial);return c;},
 proposeLocalPlan:async a=>{args=a;plannerCalls++;return new Promise((yes,no)=>{resolve=yes;reject=no;if(!ignoreAbort)a.signal.addEventListener('abort',()=>no(a.signal.reason),{once:true});});},
 execute:async ticket=>{tickets.push(ticket);return completed(ticket);}});
 t.after(async()=>{resolve?.(reply());t.mock.timers.reset();await runtime.close();await rm(dir,{recursive:true,force:true});});
 await runtime.submit(q);if(awaitPlanner)await until(()=>args!==undefined,'planner started');
 return{runtime,q,tickets,get args(){return args;},get plannerCalls(){return plannerCalls;},get catalogCalls(){return catalogCalls;},finish:()=>resolve(reply()),tick:n=>t.mock.timers.tick(n),
 done:async()=>{await until(()=>['returned_unverified','held','failed','cancelled','effects_uncertain'].includes(runtime._load(q.task_id)?.state),'terminal');return runtime._load(q.task_id);}};
}

test('K3 bounded Auto: no admissible check or plan shape, so no planner and no deadline wait; the reference dispatches at once',async t=>{
 const h=await harness(t,{bounded:true,awaitPlanner:false});const s=await h.done();
 assert.equal(s.state,'returned_unverified');assert.equal(h.plannerCalls,0);assert.equal(h.tickets.length,1);assert.equal(h.tickets[0].instruction,h.q.request);
 assert.equal(s.adaptive_routing.reason,'no_admissible_check_or_shape');assert.equal(s.adaptive_routing.planner_invoked,false);
 assert(s.resource_events.some(e=>e.stage==='plan_proposal'&&e.state==='not_needed'&&e.reason==='no_admissible_check_or_shape'));
 await h.runtime.submit(h.q);assert.equal(h.plannerCalls,0);assert.equal(h.tickets.length,1,'no replay');
});
test('shadow: total remaining15s caps20s; expired task holds without native dispatch',async t=>{
 const h=await harness(t,{duration:15000});h.tick(14999);assert.equal(h.args.signal.aborted,false);h.tick(1);assert.equal(h.args.signal.aborted,true);
 const s=await h.done();assert.equal(s.state,'held');assert.equal(h.tickets.length,0);assert.equal(s.adaptive_routing.live_plan_changed,false);
});
test('shadow: explicit cancellation during prefill remains authoritative and never dispatches',async t=>{
 const h=await harness(t);h.tick(10000);h.runtime.cancel({schema:1,task_id:h.q.task_id});assert.equal(h.args.signal.aborted,true);
 const s=await h.done();assert.equal(s.state,'cancelled');assert.equal(h.tickets.length,0);h.finish();await turn();assert.equal(h.tickets.length,0);
});
test('shadow: same owner quiescence during planning aborts without dispatch or replay',async t=>{
 const h=await harness(t);h.tick(10000);const stopping=h.runtime.quiesce({schema:1,request_id:"fixture_maintenance"});await until(()=>h.args.signal.aborted,'quiescence abort');assert.equal(stopping.safe_to_stop,false);await h.done();
 assert.equal(h.tickets.length,0);const s=h.runtime._load(h.q.task_id);assert.notEqual(s.state,'running');assert.equal(h.plannerCalls,1);
});
test('legacy shadow deadline stays20s',async t=>{
 const h=await harness(t);h.tick(19999);assert.equal(h.args.signal.aborted,false);h.tick(1);assert.equal(h.args.signal.aborted,true);
 const s=await h.done();assert.equal(h.tickets.length,1);assert.equal(s.adaptive_routing.live_plan_changed,false);assert.equal(h.plannerCalls,1);
});
test('shadow: late proposal cannot authorize rows whose native availability expired during planning',async t=>{
 const h=await harness(t,{catalogChange:(c,_,initial)=>{for(const r of c.candidates){r.availability_observed_at_ms=initial-1;r.availability_valid_until_ms=initial+10000;}}});
 h.tick(15000);h.finish();const s=await h.done();assert.equal(h.tickets.length,0,'stale native route cannot dispatch');assert.equal(s.state,'held');assert.equal(s.adaptive_routing.live_plan_changed,false);
});
test('shadow: fresh pre-dispatch exhausted quota after planning blocks dispatch',async t=>{
 const h=await harness(t,{catalogChange:(c,n)=>{if(n>1)c.candidates[0].quota_remaining_fraction=0;}});h.tick(10000);h.finish();const s=await h.done();
 assert.equal(h.tickets.length,0);assert.equal(s.state,'held');assert(h.catalogCalls>=2);assert.equal(h.plannerCalls,1);
});
test('shadow: abort-ignoring backend stays pending/unknown and late answer cannot re-adopt a plan',async t=>{
 const h=await harness(t,{ignoreAbort:true});h.tick(20000);await until(()=>h.runtime._load(h.q.task_id).adaptive_routing?.reply_settled_after_abort!==undefined||h.runtime._load(h.q.task_id).adaptive_routing?.callback_pending===true,'pending');
 await turn();h.tick(1000);await until(()=>h.runtime._load(h.q.task_id).adaptive_routing?.state==='observed','timeout observed');
 const before=h.runtime._load(h.q.task_id);assert.equal(before.adaptive_routing.callback_pending,true);assert.equal(before.adaptive_routing.backend_completion_unknown,true);
 assert.equal(h.runtime.quiesce({schema:1,request_id:'pending_actual_backend'}).safe_to_stop,false,'pending callback is not no-effect proof');
 h.finish();await until(()=>h.runtime._load(h.q.task_id).adaptive_routing?.callback_pending===false,'late completion settled');
 const after=h.runtime._load(h.q.task_id);assert.equal(after.adaptive_routing.live_plan_changed,false);assert.equal(h.plannerCalls,1);
 assert(h.tickets.every(x=>x.instruction===h.q.request));
});
