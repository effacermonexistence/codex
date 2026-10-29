// Real Core/tempSQLite and canned planner/native receipts only. No provider,
// installed App, real HOME state, network, native SDK or model is executed.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,chmod,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRCCRuntime,hostContextFingerprint,hostPlan,admitBoundedAutoPlan,assertOwnerExplicitParallelPlan,resolveRoutePlan,registerNodeVerifiers} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {adaptiveRuntimeOptions} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {createPlannerHostProjection,compileFreshPlannerProposal} from '../../Resources/openclaw-os1-bridge/adaptive-plan-host.mjs';
import {deriveExplicitParallelOwnerContract} from '../../Resources/openclaw-os1-bridge/local-plan-proposal.mjs';
const H=s=>createHash('sha256').update(s).digest('hex');
const policy='Keep exact owner scope and source. Candidate generation does not authorize execution.';
const english='Process A and B as independent tasks in parallel. Return each result unchanged.\n\nA — Return the supplied number only: 19.\n\nB — Return the supplied word only: orchard.';
const korean='아래 A와 B는 서로 독립된 작업이므로 각각 별도 하위 작업으로 나눠 병렬로 처리하세요. 도구·파일·웹을 사용하지 말고 각 결과를 구분해 전달하세요.\n\nA — 제공된 단어만 답하세요: 귤.\n\nB — 제공된 숫자만 답하세요: 23.';
function task(workspace,request=english){const host={workspace,context:null,provider_preference:'auto',codex_session_id:null,claude_session_id:null,require_read_only:true,owner_policy:null};return{schema:1,task_id:randomUUID(),request,objective:request,request_sha256:H(request),policy_sha256:H(policy),source_fingerprint:hostContextFingerprint(host),mode:'auto',material_refs:[],budget:{max_attempts:1,max_parallel:4,max_cost_units:null,max_duration_ms:20000},host_context:host,policy:{source_sha256:H('source'),projection_sha256:H(policy),text:policy}};}
function catalog(q){const now=Date.now();const base={surface:'codex',transport:'codex_app_server',account_id:'fixture',tools:[],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],availability:'available',availability_observed_at_ms:now-1,availability_valid_until_ms:now+60000,quota_remaining_fraction:.8,quota_observed_at_ms:now-1,quota_valid_until_ms:now+60000,quality_state:'policy_admitted'};return{schema:1,task_id:q.task_id,request_sha256:q.request_sha256,owner_scope:'read_only',request_class:'readonly_lookup',chat_lane_eligible:false,model_tiers:{'gpt-6-astra':'frontier','gpt-6-luna':'fast'},candidates:[{...base,id:'reference',model:'gpt-6-astra',effort:'ultra',configuration_sha256:H('ref'),estimated_cost_units:8},{...base,id:'cheap',model:'gpt-6-luna',effort:'low',configuration_sha256:H('cheap'),estimated_cost_units:1}]};}
function proposal(ids=['A']){return JSON.stringify({schema:2,kind:'untrusted_local_plan_proposal',nodes:ids.map(id=>({proposal_node_id:id,instruction:'MODEL_PARAPHRASE_MUST_NOT_REPLACE_OWNER_UNITS',requirement_refs:['owner_objective'],dependencies:[],material_refs:[],proposed_candidate_id:'cheap',proposed_scope:'read_only',proposed_owned_paths:[],required_output:'unit output',check_refs:[],reason_code:'canned_hint'})),final_output_proposal:{mode:ids.length===1?'direct_child':'ordered_collection',node_ids:ids}});}
function result(t,output=`raw-${t.node_id}-🙂\n`){return{schema:1,task_id:t.task_id,node_id:t.node_id,attempt_id:t.attempt_id,candidate_id:t.candidate_id,configuration_sha256:t.configuration_sha256,selected_config:t.selected_config,acknowledged_config:t.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',execution_verified:true,task_verified:false,task_quality:'execution_only',parity_state:'unverified',output,native_receipt:'/private/canned/'+t.attempt_id,native_summary:null};}
async function harness(t,{proposeLocalPlan:custom=null,...options}={}){const dir=await realpath(await mkdtemp(join(tmpdir(),'os1-owner-parallel-core-')));await chmod(dir,0o700);const tickets=[];let plannerCalls=0;const rt=await createRCCRuntime({stateDir:dir,hostAutoPlan:true,boundedAutoPlanning:true,maximumWorkers:4,maximumReadWorkersPerPool:4,catalog:async q=>catalog(q),proposeLocalPlan:async a=>{plannerCalls++;return custom?custom(a):{status:'proposal',raw_proposal:proposal(),completion_outcome_unknown:false};},execute:async ticket=>{tickets.push(ticket);return result(ticket);},...options});t.after(async()=>{await rt.close();await rm(dir,{recursive:true,force:true});});return{dir,rt,tickets,get plannerCalls(){return plannerCalls;},async run(q){await rt.submit(q);const done=await rt.wait({schema:1,task_id:q.task_id},{timeoutMs:5000});assert(rt._load(q.task_id).plan,JSON.stringify({state:done.state,error:done.error}));return done;}};}
function assertOwnerGraph(saved,q){const contract=deriveExplicitParallelOwnerContract(q.request,{scope:'read_only',maxNodes:4});assert(contract,'fixture owner syntax supported');assert.equal(saved.plan.nodes.length,contract.units.length);assert.equal(saved.plan.final_node_id,null);assert.deepEqual(saved.plan.nodes.map(n=>n.id),contract.units.map(n=>n.id));for(const[node,i]of saved.plan.nodes.map((n,i)=>[n,i])){assert.equal(node.scope,'read_only');assert.deepEqual(node.owned_paths,[]);assert.deepEqual(node.dependencies,[]);assert.deepEqual(node.context_refs,q.material_refs);assert(node.instruction.includes(contract.global_prefix.text));assert(node.instruction.includes(contract.units[i].exact_instruction));assert(!node.instruction.includes('MODEL_PARAPHRASE'));}assert.equal(saved.owner_explicit_parallel.structural_owner_unit_coverage_verified,true);assert.equal(saved.owner_explicit_parallel.semantic_coverage_verified,false);assert.equal(saved.owner_explicit_parallel.quality_certificate,false);}

test('K3/K5: owner topology needs no planner; every unit binds by the law, never a cheap row, and raw ordered output is retained',async t=>{const h=await harness(t),q=task(h.dir),before=JSON.stringify(q);const done=await h.run(q),s=h.rt._load(q.task_id);assertOwnerGraph(s,q);assert.equal(h.plannerCalls,0);assert.equal(h.tickets.length,2);assert.equal(done.state,'returned_unverified');assert.equal(s.plan_provenance,'host_owner_explicit_parallel_v1');assert(s.children.every(c=>c.selected_config.model==='gpt-6-astra'&&c.selected_config.effort==='ultra'&&c.route_kind==='reference'));assert.equal(s.result.output,'A: raw-owner_parallel_0-🙂\n\n\nB: raw-owner_parallel_1-🙂\n');assert(h.tickets.every(x=>x.original_request===q.request&&x.original_objective===q.objective));assert(h.tickets.every(x=>x.allow_native_subagents!==true&&x.native_resume_session_id===null));assert(h.tickets.every(x=>x.instruction.includes('Do not plan, spawn, delegate, or schedule sibling units.')));assert.equal(s.owner_explicit_parallel.local_proposal_admitted,false);assert.equal(s.owner_explicit_parallel.model_tuple_hints_adopted,undefined);const plans=s.resource_events.filter(e=>e.stage==='plan_proposal');assert.equal(plans.length,1);assert.equal(plans[0].state,'not_needed');assert.equal(plans[0].reason,'owner_explicit_parallel_partition');assert.equal(s.adaptive_routing,undefined,'K5: the partition early return owns the plan; no bounded skip record');assert.equal(done.resource_usage.plan_model_calls,0,'a skipped planner is an observed zero');assert(!done.resource_usage.issues.includes('plan_model_calls_unobserved'),JSON.stringify(done.resource_usage));assert.equal(JSON.stringify(q),before);await h.rt.submit(q);assert.equal(h.tickets.length,2,'same request cannot replay');});

test('Korean owner source is inherited unchanged for every explicit unit',async t=>{const h=await harness(t),q=task(h.dir,korean);await h.run(q);assertOwnerGraph(h.rt._load(q.task_id),q);assert.equal(h.tickets.length,2);});

test('omitted, merged, extra and ambiguous label hints cannot change host graph cardinality: none is asked for (K3)',async t=>{for(const ids of [['merged'],['A','B','extra'],['A','owner_parallel_0']]){const h=await harness(t,{proposeLocalPlan:async()=>({status:'proposal',raw_proposal:proposal(ids),completion_outcome_unknown:false})}),q=task(h.dir);await h.run(q);assertOwnerGraph(h.rt._load(q.task_id),q);assert.equal(h.tickets.length,2);assert.equal(h.plannerCalls,0);}});

test('a malformed/duplicate proposal is never asked for (K3): supported host topology holds without repairing model JSON',async t=>{for(const raw of ['not JSON',proposal(['A','A'])]){const h=await harness(t,{proposeLocalPlan:async()=>({status:'proposal',raw_proposal:raw,completion_outcome_unknown:false})}),q=task(h.dir);await h.run(q);const s=h.rt._load(q.task_id);assertOwnerGraph(s,q);assert.equal(h.tickets.length,2);assert.equal(h.plannerCalls,0);assert.notEqual(s.adaptive_routing?.live_plan_changed,true);assert.notEqual(s.adaptive_routing?.quality_certificate,true);assert(h.tickets.every(x=>x.selected_config.model==='gpt-6-astra'),'old reference fallback retained, not model-selected cheap authorization');}});

test('unavailable/foreign tuple hints cannot bypass current admission while preserving all owner units',async t=>{const p=JSON.parse(proposal());p.nodes[0].proposed_candidate_id='foreign';const h=await harness(t,{proposeLocalPlan:async()=>({status:'proposal',raw_proposal:JSON.stringify(p),completion_outcome_unknown:false})}),q=task(h.dir);await h.run(q);assertOwnerGraph(h.rt._load(q.task_id),q);assert.equal(h.tickets.length,2);assert(!h.tickets.some(x=>x.candidate_id==='foreign'));assert.equal(h.plannerCalls,0);});

test('host context write ceiling cannot turn owner read units into writers; original materials remain',async t=>{const h=await harness(t,{catalog:async q=>({...catalog(q),owner_scope:'workspace_write'})}),q=task(h.dir);q.host_context.require_read_only=false;q.source_fingerprint=hostContextFingerprint(q.host_context);q.material_refs=['source:immutable'];await h.run(q);assertOwnerGraph(h.rt._load(q.task_id),q);assert(h.tickets.every(x=>x.selected_config.scope==='read_only'&&x.context_refs[0]==='source:immutable'));});

test('existing scheduler executes two owner nodes concurrently, not merely sequential double dispatch',async t=>{let started=0,release,peak=0,inflight=0;const barrier=new Promise(r=>release=r);let h;h=await harness(t,{execute:async ticket=>{h.tickets.push(ticket);started++;inflight++;peak=Math.max(peak,inflight);if(started===2)release();let timer;try{await Promise.race([barrier,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owner nodes never overlapped')),1000);})]);}finally{clearTimeout(timer);inflight--;}return result(ticket);}});const q=task(h.dir);await h.run(q);assert.equal(peak,2);assertOwnerGraph(h.rt._load(q.task_id),q);assert.equal(h.tickets.length,2);});

test('unsupported/quoted/ambiguous owner text retains original indivisible route, not fake host partition',async t=>{for(const request of ['Explain how parallel task queues work.','Do not process A and B in parallel.\n\nA — Answer one.\n\nB — Answer two.','The document says "Process A and B as independent tasks in parallel".\n\nA — Report one.\n\nB — Report two.']){const h=await harness(t),q=task(h.dir,request);await h.run(q);const s=h.rt._load(q.task_id);assert.equal(s.owner_explicit_parallel,undefined);assert.equal(h.tickets.length,1);assert.equal(h.tickets[0].instruction,request);}});

test('K5: the owner partition is decoupled from certificates, the native ceiling and contracts in hostPlan; a contract is the caller\'s hold',()=>{const q=task('/private/synthetic');for(const modify of [c=>c.task_contract={coverage:'full'},c=>c.class_certificates={cert:{}},c=>c.routing_intent_v2={require_native_ceiling:true}]){const c=catalog(q);modify(c);const plan=hostPlan(q,c,{ownerExplicitParallel:true});assert.equal(plan.nodes.length,2);assert.equal(plan.final_node_id,null);}const contracted={...catalog(q),task_contract:{coverage:'full'}};assert.throws(()=>assertOwnerExplicitParallelPlan(hostPlan(q,contracted,{ownerExplicitParallel:true}),q,contracted),{code:'owner_partition_contract_conflict'});const noFlag=hostPlan(q,catalog(q));assert.equal(noFlag.nodes.length,1);assert.equal(noFlag.nodes[0].instruction,q.request);const noFacts={...catalog(q)};delete noFacts.owner_scope;assert.equal(hostPlan(q,noFacts,{ownerExplicitParallel:true}).nodes.length,1,'an older catalog without admission facts keeps the indivisible request');});

test('source contract graph resists forged instruction, dependency, final owner and dropped-node mutation',()=>{const q=task('/private/synthetic'),c=catalog(q),prep=createPlannerHostProjection({task:q,catalog:c,scope:'read_only',nonce:'fixed_nonce'}),compiled=compileFreshPlannerProposal(proposal(),prep,prep,{max_nodes:4});assert.throws(()=>admitBoundedAutoPlan(compiled,q,c),{code:'bounded_owner_partition_not_planner_owned'},'K5: owner topology is never planner-owned');const checked=resolveRoutePlan(hostPlan(q,c,{ownerExplicitParallel:true}),q,c);assertOwnerExplicitParallelPlan(checked.plan,q,c);assert.equal(checked.plan.nodes.length,2);const first=checked.plan.nodes[0];assert(first.instruction.includes('A — Return'));assert.equal(checked.plan.final_node_id,null);assert.equal(checked.routes[first.id].kind,'reference');assert.equal(first.candidate_id,'reference');assert.equal(compiled.plan.nodes.length,1,'untrusted model graph is not rewritten or falsely certified');assert.equal(compiled.coverage.semantic_coverage_verified,false);
for(const mutate of [p=>p.nodes.pop(),p=>p.final_node_id=p.nodes[0].id,p=>p.nodes[1].dependencies=[p.nodes[0].id],p=>p.nodes[0].instruction='rewritten',p=>p.nodes[0].owned_paths=['evil'],p=>p.nodes[0].scope='workspace_write',p=>p.nodes.reverse(),p=>p.nodes[0].context_refs=['foreign']]){const forged=structuredClone(checked.plan);mutate(forged);assert.throws(()=>assertOwnerExplicitParallelPlan(forged,q,c),{code:'owner_explicit_parallel_contract_mismatch'});}
});


test('a terminal failed owner unit preserves the completed sibling without pretending all-unit completion or retrying',async t=>{let h;h=await harness(t,{execute:async ticket=>{h.tickets.push(ticket);return ticket.node_id==='owner_parallel_0'?result(ticket):{...result(ticket),status:'failed',dispatch_stage:'not_dispatched',output:'FAILURE_NOT_AN_ANSWER',error:'synthetic_outage',execution_verified:false,task_quality:'failed'};}});const q=task(h.dir);const done=await h.run(q),saved=h.rt._load(q.task_id);assertOwnerGraph(saved,q);assert.equal(h.tickets.length,2);assert.notEqual(done.state,'completed');assert.equal(saved.children[0].output,'raw-owner_parallel_0-🙂\n');assert(saved.result.output.includes('raw-owner_parallel_0-🙂'));assert(!saved.result.output.includes('FAILURE_NOT_AN_ANSWER'));assert.equal(saved.result.task_verified,false);});

test('K3: cancel before planning does not authorize source partition dispatch, a planner call or a local replay',async t=>{let entered,release;const began=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const h=await harness(t,{catalog:async q=>{entered();await gate;return catalog(q);}}),q=task(h.dir);await h.rt.submit(q);await began;h.rt.cancel({schema:1,task_id:q.task_id});release();const done=await h.rt.wait({schema:1,task_id:q.task_id},{timeoutMs:2000});assert.equal(done.state,'cancelled');assert.equal(h.tickets.length,0);assert.equal(h.plannerCalls,0);await h.rt.submit(q);await new Promise(r=>setTimeout(r,50));assert.equal(h.tickets.length,0,'no replay');assert.equal(h.plannerCalls,0);});

test('an old owner_parallel_ name is not provenance: feature-off/FULL/cert custom plans keep prior behavior',async t=>{
 for(const kind of ['legacy','full','cert']){
  const h=await harness(t,{hostAutoPlan:false,boundedAutoPlanning:false,
   catalog:async q=>{const c=catalog(q);if(kind==='full')c.task_contract={coverage:'full',scope:'read_only',objective_sha256:q.request_sha256,contract_sha256:H('contract'),context_sha256:H(''),start_tree_sha256:H('tree'),reference_policy_sha256:q.policy_sha256,valid_until_ms:Date.now()+60000,bindings_checked:true};if(kind==='cert')c.class_certificates={readonly_lookup:{certificate_id:'fixture_cert',provider:'codex',model:'gpt-6-luna',effort:'low',format_check:'plain_text',measurement_sha256:H('measurement')}};return c;},
   plan:async({task:q})=>({schema:1,task_id:q.task_id,request_sha256:q.request_sha256,nodes:[{id:'owner_parallel_0',instruction:q.request,dependencies:[],kind:'agent',candidate_id:'reference',scope:'read_only',owned_paths:[],context_refs:[]}],final_node_id:'owner_parallel_0'})});
  const q=task(h.dir);await h.run(q);const s=h.rt._load(q.task_id);assert.equal(h.tickets.length,1,kind);assert.equal(s.owner_explicit_parallel,undefined,kind);assert.equal(s.plan.nodes[0].id,'owner_parallel_0');assert.equal(s.plan.nodes[0].instruction,q.request);
 }
});

test('actual ticket preparation rechecks Core-owned source contract, not a coincidental node prefix',async t=>{
 const h=await harness(t),q=task(h.dir);await h.run(q);const saved=h.rt._load(q.task_id),node=saved.plan.nodes[0],candidate=saved.catalog.candidates.find(c=>c.id===node.candidate_id);
 for(const mutate of [s=>s.plan.nodes.pop(),s=>s.plan.nodes[0].instruction='foreign instruction',s=>s.owner_explicit_parallel.contract.request_sha256=H('other')]){const tampered=structuredClone(saved);mutate(tampered);assert.throws(()=>h.rt._ticket(tampered,node,candidate,randomUUID()),e=>['owner_explicit_parallel_contract_mismatch','owner_explicit_parallel_source_changed'].includes(e.code));}
 assert.equal(h.tickets.length,2,'pure rejected ticket checks did not dispatch');
});


test('actual node arguments cannot replace source-owned ticket fields while candidate-only rebind remains valid',async t=>{
 const h=await harness(t),q=task(h.dir);await h.run(q);const snapshot=h.rt._load(q.task_id),node=snapshot.plan.nodes[0],candidate=snapshot.catalog.candidates.find(c=>c.id===node.candidate_id),saved=JSON.stringify(snapshot);
 const valid=h.rt._ticket(snapshot,node,candidate,randomUUID());assert.equal(valid.instruction,node.instruction);
 for(const mutate of [n=>n.instruction='FOREIGN_INSTRUCTION_NOT_OWNER_UNIT',n=>n.scope='workspace_write',n=>n.kind='deterministic',n=>n.dependencies=[snapshot.plan.nodes[1].id],n=>n.owned_paths=['foreign.txt'],n=>n.context_refs=['foreign:source'],n=>n.id='foreign_unit']){const actual=structuredClone(node);mutate(actual);assert.throws(()=>h.rt._ticket(snapshot,actual,candidate,randomUUID()),{code:'owner_explicit_parallel_ticket_node_mismatch'});}
 for(const patch of [{scope:'workspace_write'},{permission_profile:'workspace_write'}])assert.throws(()=>h.rt._ticket(snapshot,node,{...candidate,...patch},randomUUID()),{code:'owner_explicit_parallel_ticket_node_mismatch'});
 const rebound=snapshot.catalog.candidates.find(c=>c.id!==candidate.id),ticket=h.rt._ticket(snapshot,{...node,candidate_id:rebound.id},rebound,randomUUID());assert.equal(ticket.candidate_id,rebound.id);assert.equal(ticket.instruction,node.instruction);assert.equal(ticket.original_request,q.request);assert.equal(ticket.original_objective,q.objective);assert.equal(JSON.stringify(snapshot),saved);assert.equal(h.tickets.length,2,'pure ticket checks cannot dispatch or mutate the snapshot');
});

// K5: the owner's explicit partition is task topology, decoupled from the
// bounded planner flag, adaptive mode, verifier registry, class certificates
// and the native ceiling. Each unit binds by the one law; a partition next to
// a task contract holds, typed, before any plan write. Canned rows only.
const uuid='019a0000-0000-7000-8000-000000000001';
function k5task(workspace,{codex=null,v2=false}={}){const q=task(workspace);q.host_context.codex_session_id=codex;q.source_fingerprint=hostContextFingerprint(q.host_context);if(v2)q.routing_intent_policy_version='r10_joint_selection_v2';return q;}
function providerRow(id,model,effort,provider){const now=Date.now();return{id,surface:provider,transport:provider==='codex'?'codex_app_server':'claude_cli',account_id:'fx-'+provider,tools:[],scope:'read_only',permission_profile:'read_only',quota_pool:provider==='codex'?'openai_codex':'anthropic_shared',allowed_paths:[],availability:'available',availability_observed_at_ms:now-1,availability_valid_until_ms:now+60000,quota_remaining_fraction:.8,quota_observed_at_ms:now-1,quota_valid_until_ms:now+60000,quality_state:'policy_admitted',model,effort,configuration_sha256:H(id),estimated_cost_units:null};}
function providersCatalog(q,providers,extra={}){const c=[];if(providers.includes('codex'))c.push(providerRow('reference','gpt-6-astra','ultra','codex'),providerRow('cheap','gpt-6-luna','low','codex'));if(providers.includes('claude'))c.push(providerRow('fable','claude-fable-5-1','max','claude'));return{...catalog(q),model_tiers:Object.fromEntries(c.map(r=>[r.model,r.model==='gpt-6-luna'?'fast':'frontier'])),candidates:c,...extra};}
const fullContract=q=>({task_contract:{coverage:'full',scope:'read_only',objective_sha256:q.request_sha256,contract_sha256:H('contract'),context_sha256:H(''),start_tree_sha256:H('tree'),reference_policy_sha256:q.policy_sha256,valid_until_ms:Date.now()+60000,bindings_checked:true}});
const classCert={class_certificates:{readonly_lookup:{certificate_id:'fixture_cert',provider:'codex',model:'gpt-6-luna',effort:'low',format_check:'plain_text',measurement_sha256:H('measurement')}}};
const ceiling={routing_intent_v2:{version:'r10_joint_selection_v2',allowed_surfaces:[],exact_model:null,model_family:null,effort:null,require_native_ceiling:true,quality_target:null,state:'resolved'},native_reference_efforts:{codex:{'gpt-6-astra':'ultra','gpt-6-luna':'low'}}};
// Overlap observer: each ticket waits a little so units that may share a pool overlap.
function overlapping(h,patch=()=>({})){let inflight=0;h.peak=0;return async ticket=>{h.tickets.push(ticket);inflight++;h.peak=Math.max(h.peak,inflight);await new Promise(r=>setTimeout(r,30));inflight--;return{...result(ticket),...patch(ticket)};};}
async function k5harness(t,{catalog:cat=q=>catalog(q),executor=overlapping,...options}={}){let calls=0,h,run=null;h=await harness(t,{catalog:async q=>cat(q,++calls),execute:async ticket=>(run??=executor(h))(ticket),...options});return h;}
async function k5run(h,q){await h.rt.submit(q);const done=await h.rt.wait({schema:1,task_id:q.task_id},{timeoutMs:8000});return{done,s:h.rt._load(q.task_id)};}

test('K5: bounded off, shadow and an App-shaped bounded config all keep the owner partition with no planner call',async t=>{
 const shadow={schema:1,mode:'shadow',policy_id:'test-shadow',version:'1',rcc_source_sha256:H('source'),projection_sha256:H(policy),reference_policy_sha256:null,allowed_workload_classes:['readonly_lookup'],max_nodes:4,max_parallel:2,max_plan_revisions:0,max_planner_calls:1,planner_input_bytes:64000,planner_output_tokens:2048,requires_live_reference_fallback:true,adoption_manifest_sha256:null};
 for(const [name,options] of [['bounded off',{boundedAutoPlanning:false}],['shadow',{boundedAutoPlanning:false,adaptiveRoutingPolicy:shadow}]]){
  const h=await k5harness(t,options),q=task(h.dir);const {done,s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.tickets.length,2,name);assert.equal(h.plannerCalls,0,name);assert.equal(done.state,'returned_unverified',name);
  assert.equal(s.plan_provenance,'host_owner_explicit_parallel_v1',name);assert(s.children.every(c=>c.route_kind==='reference'),name);
  assert.deepEqual(s.resource_events.filter(e=>e.stage==='plan_proposal').map(e=>[e.state,e.reason]),[['not_needed','owner_explicit_parallel_partition']],name);
 }
 // The real App bounded options: the local compiler is never asked and no unchecked row binds.
 let completions=0;const h=await k5harness(t,{...adaptiveRuntimeOptions({pluginConfig:{bounded_auto:true},complete:async()=>{completions++;throw Error('local planner must not be asked for owner topology');}})}),q=task(h.dir);const {s}=await k5run(h,q);
 assertOwnerGraph(s,q);assert.equal(completions,0);assert.equal(h.plannerCalls,0);assert.equal(h.tickets.length,2);
 assert.equal(s.children.filter(c=>c.route_kind==='execution_only').length,0);assert(s.children.every(c=>c.route_kind==='reference'&&c.selected_config.model==='gpt-6-astra'));
});

test('K5: a resumed Codex conversation with a new A/B runs fresh overlapping units; Claude-only waits; mixed providers spread',async t=>{
 {const h=await k5harness(t),q=k5task(h.dir,{codex:uuid});const {done,s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(done.state,'returned_unverified');assert.equal(h.tickets.length,2);assert.equal(h.peak,2,'fresh units share the read pool');
  assert(h.tickets.every(x=>x.native_resume_session_id===null),'units never resume the owner thread');}
 {const h=await k5harness(t,{catalog:q=>providersCatalog(q,['claude'])}),q=task(h.dir);const {s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.tickets.length,2);assert.equal(h.peak,1,'no shared Claude pool: units wait, topology kept');
  assert(h.tickets.every(x=>x.selected_config.model==='claude-fable-5-1'&&x.native_resume_session_id===null));}
 {const h=await k5harness(t,{catalog:q=>providersCatalog(q,['codex','claude'])}),q=task(h.dir);const {s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.tickets.length,2);assert.equal(h.peak,2);assert(s.children.every(c=>c.route_kind==='reference'));
  assert.match(s.children[1].routing_decision.reason,/^spread_for_parallelism;other_pool;route_reference/);}
});

test('K5: a class certificate never certifies a unit (reference); the owner\'s maximum words bind the ceiling per unit',async t=>{
 {const h=await k5harness(t,{catalog:q=>({...catalog(q),...classCert})}),q=task(h.dir);const {s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.tickets.length,2);assert.equal(h.plannerCalls,0);
  assert(s.children.every(c=>c.route_kind==='reference'&&c.selected_config.model==='gpt-6-astra'&&/admitted_reference_uncertified/.test(c.routing_decision.reason)),JSON.stringify(s.children.map(c=>c.routing_decision)));}
 {const h=await k5harness(t,{catalog:q=>({...catalog(q),...ceiling})}),q=k5task(h.dir,{v2:true});const {s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.tickets.length,2);
  assert(s.children.every(c=>c.route_kind==='explicit'&&/admitted_reference_owner_words/.test(c.routing_decision.reason)&&c.selected_config.model==='gpt-6-astra'&&c.selected_config.effort==='ultra'),JSON.stringify(s.children.map(c=>c.routing_decision)));}
});

test('K5: a partition next to a full task contract holds owner_partition_contract_conflict before any planner call or plan write',async t=>{
 const h=await k5harness(t,{catalog:q=>({...catalog(q),...fullContract(q)})}),q=task(h.dir);const {done,s}=await k5run(h,q);
 assert.equal(done.state,'held');assert.equal(done.error,'owner_partition_contract_conflict');
 assert.equal(h.tickets.length,0);assert.equal(h.plannerCalls,0);assert.equal(s.plan??null,null,'no plan persisted');assert.equal(s.owner_explicit_parallel,undefined);
 await h.rt.submit(q);await new Promise(r=>setTimeout(r,50));assert.equal(h.tickets.length,0,'no replay');
});

test('K5: a catalog refresh that gains a certificate keeps running the units; one that gains a contract holds at ticket',async t=>{
 {const h=await k5harness(t,{catalog:(q,n)=>({...catalog(q),...(n>1?classCert:{})})}),q=task(h.dir);const {done,s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.tickets.length,2);assert.equal(done.state,'returned_unverified');assert(s.children.every(c=>c.state==='completed'));}
 {const h=await k5harness(t,{catalog:(q,n)=>({...catalog(q),...(n>1?fullContract(q):{})})}),q=task(h.dir);const {done,s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.tickets.length,0,'no unit runs beside a contract');assert.equal(done.state,'held');assert.equal(done.error,'owner_partition_contract_conflict');
  assert(s.children.some(c=>c.state==='held'&&c.hold_reason==='owner_partition_contract_conflict'),JSON.stringify(s.children.map(c=>[c.state,c.hold_reason])));}
});

test('K5: with a registered sound_full verifier each unit is a certified descent with its fixed reference; a rejected descent escalates, never delivers',async t=>{
 // K4 (D2): a registered sound_full entry; it rejects its refutation and the Core nonce.
 const registry=await registerNodeVerifiers(new Map([['owner-unit',{id:'owner-unit',scope:'read_only',surfaces:['agent','chat'],soundness:'sound_full',applies:()=>true,verify:async input=>({passed:/^raw-owner_parallel_\d-🙂\n$/.test(input.output),reason:'fixture'}),refutations:[{instruction:'Return the supplied number only: 19.',output:'20'}]}]]));
 {const h=await k5harness(t,{verifierRegistry:registry}),q=task(h.dir);const {s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.plannerCalls,0);assert.deepEqual(h.tickets.map(x=>x.candidate_id),['cheap','cheap']);
  assert(s.children.every(c=>c.route_kind==='tier'&&c.ladder.reference_candidate_id==='reference'&&c.ladder.certificate_id==='owner-unit'&&/admitted_certified_verifier/.test(c.routing_decision.reason)));
  assert.equal(s.result.output,'A: raw-owner_parallel_0-🙂\n\n\nB: raw-owner_parallel_1-🙂\n');}
 // The cheap row answers wrongly: each unit escalates once to its reference and only the checked reference answer is delivered.
 {const h=await k5harness(t,{verifierRegistry:registry,executor:h=>overlapping(h,x=>x.candidate_id==='cheap'?{output:`UNCHECKED-${x.node_id}`}:{})}),q=task(h.dir);const {s}=await k5run(h,q);
  assertOwnerGraph(s,q);assert.equal(h.tickets.length,4);assert.deepEqual(h.tickets.map(x=>x.candidate_id).sort(),['cheap','cheap','reference','reference']);
  assert(s.children.every(c=>c.state==='completed'&&c.route_kind==='reference'&&c.ladder.escalated===true));
  assert.equal(s.result.output,'A: raw-owner_parallel_0-🙂\n\n\nB: raw-owner_parallel_1-🙂\n');assert(!JSON.stringify(s.result).includes('UNCHECKED'),'no unchecked cheaper answer is delivered');}
});

test('K5: read-pool eligibility takes the prospective plan, not only the persisted one',async t=>{
 const h=await harness(t),q=k5task(h.dir,{codex:uuid}),candidate=catalog(q).candidates[0];
 assert.equal(h.rt._load(q.task_id),null,'nothing persisted');
 assert.equal(h.rt._readPoolEligible(candidate,q,{plan:{nodes:[{id:'a'},{id:'b'}]},children:[]}),true,'a detached multi-node plan shares the pool');
 assert.equal(h.rt._readPoolEligible(candidate,q,{plan:{nodes:[{id:'a'}]},children:[]}),false,'one node on a resumed thread stays exclusive');
 assert.equal(h.rt._readPoolEligible(candidate,q),false,'default: the persisted (absent) plan');
});

test('K5: a pre-upgrade partition task persisted mid-proposal is held at restart, never replayed or re-planned',async t=>{
 let entered,release;const began=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const h=await harness(t,{catalog:async q=>{entered();await gate;return catalog(q);}}),q=task(h.dir);
 await h.rt.submit(q);await began;
 h.rt._update(q.task_id,'fixture_pre_upgrade_started_proposal',s=>{s.adaptive_routing={schema:1,mode:'bounded_auto',state:'started',planner_invoked:true,live_plan_changed:false,quality_certificate:false};});
 await h.rt.close({timeoutMs:0});
 let calls=0;const restarted=await createRCCRuntime({stateDir:h.dir,hostAutoPlan:true,boundedAutoPlanning:true,maximumWorkers:4,maximumReadWorkersPerPool:4,catalog:async v=>{calls++;return catalog(v);},proposeLocalPlan:async()=>assert.fail('interrupted proposal replayed'),execute:async()=>assert.fail('interrupted predispatch task replayed')});
 t.after(()=>restarted.close());
 const held=restarted.status({schema:1,task_id:q.task_id});assert.equal(held.state,'held');assert.equal(held.error,'owner_stopped_before_dispatch');
 await restarted.submit(q);release();await new Promise(r=>setTimeout(r,50));
 assert.equal(calls,0);assert.equal(h.tickets.length,0);assert.equal(restarted._load(q.task_id).plan??null,null);
});
