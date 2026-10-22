// Actual same durable Core, real protected-loader/projector, explicit SYNTHETIC
// P7/P8/resource premises and fake executor only. Never production authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createRCCRuntime,hostContextFingerprint,hostPlan,resolveRoutePlan} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {createCalibratedRoutePredictor} from '../../Resources/openclaw-os1-bridge/calibrated-route-predictor.mjs';
import {writeCalibratedRouteFixture} from './calibrated-route-evidence.synthetic.mjs';
import {digest,exactConfigFingerprint,candidatePoolFingerprint,stableJSON,RESOURCE_UNIT} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
const H=x=>createHash('sha256').update(x).digest('hex');
const policyText='SYNTHETIC:policy',version='r10_joint_selection_v2';
function request(root,policyBody=policyText){
 const conversation=randomUUID(),text='Give the exact source-free fixture definition.';
 const envelope={format:'os1-session-handoff-v3',transcript:'',priorMessageCount:0,
   taskContext:{schemaVersion:1,conversationID:conversation,objectiveID:randomUUID(),createdAt:'2026-10-22T00:00:00Z',updatedAt:'2026-10-22T00:00:00Z',contextRevision:0,
     project:{projectID:'synthetic',workspace:root},objective:{requestText:text,kind:'other',scope:'read_only',prohibitions:[],pendingDecisions:[],completionConditions:[]},
     facts:[],sources:[],bindings:[],executions:[],decisions:[],blockers:[],nextSteps:[]}};
 const host={workspace:root,context:JSON.stringify(envelope),provider_preference:'auto',codex_session_id:null,claude_session_id:null,require_read_only:false,owner_policy:null,conversation_id:conversation};
 return {schema:1,task_id:randomUUID(),request:text,request_sha256:H(text),objective:text,policy_sha256:H(policyBody),source_fingerprint:hostContextFingerprint(host),mode:'auto',material_refs:[],
   routing_intent_policy_version:version,budget:{max_attempts:2,max_parallel:1,max_cost_units:null,max_duration_ms:10000},host_context:host,
   policy:{source_sha256:H('SYNTHETIC:rcc'),projection_sha256:H(policyBody),text:policyBody}};
}
function catalog(q,configs,at,originalR0='SYNTHETIC-floor'){
 const rows=configs.map(c=>({id:c.model,...c,availability:'available',availability_observed_at_ms:at-1,availability_valid_until_ms:at+60000,
   quota_remaining_fraction:.8,quota_observed_at_ms:at-1,quota_valid_until_ms:at+60000,quality_state:'policy_admitted',estimated_cost_units:1}));
 return {schema:1,task_id:q.task_id,request_sha256:q.request_sha256,owner_scope:'read_only',request_class:'readonly_lookup',chat_lane_eligible:false,
   routing_intent_v2:{version,allowed_surfaces:[],exact_model:null,model_family:null,effort:null,require_native_ceiling:false,quality_target:null,state:'resolved'},
   model_tiers:{'SYNTHETIC-reference':'frontier','SYNTHETIC-floor':originalR0==='SYNTHETIC-floor'?'fast':'efficient','SYNTHETIC-routed':originalR0==='SYNTHETIC-routed'?'fast':'efficient'},
   native_reference_efforts:{codex:Object.fromEntries(configs.map(c=>[c.model,c.effort]))},candidates:rows,
   task_contract:{coverage:'full',scope:'read_only',objective_sha256:q.request_sha256,contract_sha256:H('task-contract'),context_sha256:H(q.host_context.context??''),
     start_tree_sha256:H('start-tree'),reference_policy_sha256:q.policy_sha256,valid_until_ms:at+60000,bindings_checked:true,source_sha256:null}};
}
function prepared(q,cat,metadata){
 const {bindings:b,quality_reference:reference,features}=metadata,now=metadata.now_ms;
 const baseline=resolveRoutePlan(hostPlan(q,cat),q,cat,now),node=baseline.plan.nodes[0];
 assert(['SYNTHETIC-floor','SYNTHETIC-routed'].includes(node.candidate_id));
 const times={observed_at_ms:now-1,valid_until_ms:now+60000};
 const candidates=cat.candidates.map(c=>{
  const config=Object.fromEntries(['surface','transport','account_id','model','effort','tools','scope','permission_profile','quota_pool','allowed_paths','configuration_sha256'].map(k=>[k,c[k]]));
  return {id:c.id,config,capabilities:{supported:true,config_sha256:exactConfigFingerprint(config),features:[],max_context_tokens:32000,...times},
    availability:{state:'available',account_id:c.account_id,config_sha256:exactConfigFingerprint(config),observation_sha256:H('synthetic-availability:'+c.id),...times},
    quota:{state:'sufficient',account_id:c.account_id,quota_pool:c.quota_pool,observation_sha256:H('synthetic-quota:'+c.id),...times}};
 });
 const t={id:q.task_id,node_id:node.id,request_sha256:q.request_sha256,source_snapshot_sha256:q.source_fingerprint,feature_sha256:digest(features),policy_sha256:q.policy_sha256,
   plan_sha256:digest(baseline.plan),environment_sha256:b.environment_sha256,instructions_sha256:q.policy_sha256,verifier_sha256:b.verifier_sha256,
   feature_schema_version:b.feature_schema_version,workload_class:b.workload_class,scope:'read_only',required_tools:[],allowed_tools:[],allowed_paths:[],required_capabilities:[],allowed_transports:['codex_app_server'],context_tokens:10};
 // Explicitly choose an existing source-qualified reference partition;
 // NEVER divide the scalar P7 parent mean or fill an unknown component.
 const part=metadata.resource_partitions.find(p=>p.config_sha256===reference.config_sha256);
 assert(part);
 const referenceEstimate={unit:RESOURCE_UNIT,basis:'observed_history',accounting_scope:'disjoint_remaining_node_total_v1',
  basis_artifact_sha256:part.basis_artifact_sha256,basis_sample_count:part.basis_sample_count,config_sha256:reference.config_sha256,
  task_sha256:digest(t),observed_at_ms:metadata.fit.assessed_at_ms,
  valid_until_ms:Math.min(metadata.valid_until_ms??now+3600000,metadata.input.policy.valid_until_ms),components:part.components};
 const c={selector_input:{schema:1,now_ms:now,task:t,candidates,selection_policy:{schema:1,id:'synthetic-selection',version:'1',policy_sha256:q.policy_sha256,requires_live_reference_fallback:true,max_samples:1},
   quality_reference:reference,execution_fallback:{candidate_id:'SYNTHETIC-reference',config_sha256:reference.config_sha256,quality_reference_sha256:digest(reference),resource_estimate:referenceEstimate},calibration:null,forecasts:null,host_evidence:null},
   current_bindings:{rcc_source_sha256:b.rcc_source_sha256,coverage_discriminator_sha256:b.coverage_discriminator_sha256,native_harnesses:b.native_harnesses},features,
   original_r0:{candidate_id:node.candidate_id,config_sha256:exactConfigFingerprint(candidates.find(c=>c.id===node.candidate_id).config)},
   task_boundary:{mode:'auto',turn_index:0,plan_shape:'single_original_request',source_policy:'no_external_material',samples:1}};
 assert.equal(candidatePoolFingerprint(candidates),b.candidate_pool_sha256);
 return {captured_at_ms:now,prepared:c,record_sha256:digest({captured_at_ms:now,prepared:c})};
}
function completion(ticket,{fail=false,stateDir}={}){
 const output=fail?'invalid cheap answer':'checked original definition';
 return {schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,
   selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',native_turn_terminated:true,
   execution_verified:true,task_verified:!fail,task_quality:fail?'failed':'task_verified',parity_state:'unverified',output,native_receipt:'/private/SYNTHETIC/'+ticket.attempt_id,native_summary:null,
   operational_quality:{schema:1,coverage:'full',assessment_state:fail?'mismatch':'task_contract_verified',contract_sha256:H('task-contract'),witness_path:join(stateDir,'quality-witnesses',ticket.attempt_id+'.json'),
     witness_sha256:H('witness'),artifact_sha256:H(output),workspace_after_sha256:H('workspace'),failed_check_ids:fail?['fixture-check']:[],corrective_attempts:0,local_only_verified:false}};
}
async function done(runtime,q){
 const start=performance.now();
 while(performance.now()-start<6000){const r=runtime.status({schema:1,task_id:q.task_id});if(['completed','returned_unverified','held','failed','cancelled','effects_uncertain'].includes(r.state))return r;await new Promise(r=>setTimeout(r,10));}
 throw Error('synthetic Core did not reach terminal state');
}
async function harness(t,{fixture=true,missing=false,failCheap=false,unknown=false,mutateTask,mutateCatalog,beforeRefresh,p7_options={},mutatePrepared,afterCreate,policyBody=policyText,originalR0='SYNTHETIC-floor'}={}){
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'os1-calibrated-admission-'))),stateDir=join(parent,'core'),evidenceDir=join(parent,'evidence');mkdirSync(stateDir,{mode:0o700});mkdirSync(evidenceDir,{mode:0o700});
 let runtime;
 t.after(async()=>{await runtime?.close();rmSync(parent,{recursive:true,force:true});});
 const q=request(stateDir,policyBody),tickets=[],at=Date.now();let cat,packet,predictor=null,catalogCalls=0;
 packet=writeCalibratedRouteFixture({stateDir:evidenceDir,now_ms:at,three_configs:true,p7_options,policy_text:policyBody,prepareRecords:metadata=>{
   cat=catalog(q,[metadata.referenceConfig,metadata.routedConfig,metadata.baselineConfig],at,originalR0);const record=prepared(q,cat,metadata);mutatePrepared?.(record,metadata);return [record];
 }});
 predictor=missing?null:createCalibratedRoutePredictor({evidence:packet.capability});
 if(mutateTask){
  mutateTask(q);q.source_fingerprint=hostContextFingerprint(q.host_context);
  // Fresh HOST R0 facts for the changed input, never rehash the protected
  // statistical record to make it match that different task/context.
  cat.request_sha256=q.request_sha256;cat.task_contract.objective_sha256=q.request_sha256;
  cat.task_contract.context_sha256=H(q.host_context.context??'');
 }
 if(mutateCatalog)mutateCatalog(cat,q);
 const baseline=resolveRoutePlan(hostPlan(q,cat),q,cat,Date.now());
 const execute=async ticket=>{tickets.push(structuredClone(ticket));if(unknown)throw Error('synthetic lost ACK');return completion(ticket,{stateDir,fail:failCheap&&ticket.candidate_id==='SYNTHETIC-routed'});};
 runtime=await createRCCRuntime({stateDir,hostAutoPlan:true,calibratedRoutePredictor:predictor,
   ...(fixture&&predictor?{calibratedRouteFixtureExecutor:execute}:{}),catalog:async()=>{catalogCalls++;if(catalogCalls>1)beforeRefresh?.({packet,q,cat,catalogCalls,runtime});return structuredClone(cat);},execute});
 afterCreate?.({runtime,q,cat,packet});
 const original=structuredClone(q);await runtime.submit(q);const result=await done(runtime,q);
 assert.deepEqual(q,original);assert.deepEqual(runtime._load(q.task_id).task,original);
 return {runtime,q,result,tickets,baseline,packet,cat};
}
test('protected fixture capability selects an actually different cheaper R0-certified tuple and full checker adopts',async t=>{
 const h=await harness(t);assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-routed']);
 const s=h.runtime._load(h.q.task_id);assert.equal(s.calibrated_route.state,'dispatched');assert.equal(s.plan_provenance,'host_calibrated_original_v1');assert.equal(s.children[0].ladder.admitted_by,'contract');assert.equal(s.children[0].ladder.reference_candidate_id,'SYNTHETIC-reference');
 assert.equal(s.plan.nodes[0].instruction,h.q.request);assert.equal(h.result.result.parity_state,'unverified');assert.equal(s.native_dispatches,1);
});
test('failed cheap full checker escalates once to independently bound reference, never adopts cheap failure',async t=>{
 const h=await harness(t,{failCheap:true});assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-routed','SYNTHETIC-reference']);
 assert.equal(h.result.result.output,'checked original definition');assert.equal(h.runtime._load(h.q.task_id).children[0].attempt_history.length,2);
});
test('missing evidence keeps the exact original R0 plan, and synthetic qualification is rejected in production mode',async t=>{
 for(const options of [{missing:true},{fixture:false}]){
  const h=await harness(t,options);assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
  assert.equal(stableJSON(h.runtime._load(h.q.task_id).plan),stableJSON(h.baseline.plan));assert.equal(h.runtime._load(h.q.task_id).calibrated_route,undefined);
 }
});
test('revoked private evidence before dispatch restores exact R0 without an attempted cheaper submit',async t=>{
 const h=await harness(t,{beforeRefresh:({packet})=>rmSync(join(packet.root,'promotion-review.json'),{force:true})});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 const s=h.runtime._load(h.q.task_id);assert.equal(s.calibrated_route.state,'restored_r0');assert.equal(stableJSON(s.plan),stableJSON(h.baseline.plan));assert.equal(s.children[0].attempt_history.length,1);
});
test('unknown already-dispatched selected outcome is never replayed as either candidate or reference',async t=>{
 const h=await harness(t,{unknown:true});assert.equal(h.result.state,'effects_uncertain');assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-routed']);
 await h.runtime.submit(h.q);await new Promise(r=>setTimeout(r,30));assert.equal(h.tickets.length,1);assert.equal(h.runtime._load(h.q.task_id).native_dispatches,1);
});
test('history or mismatched original source stays with R0, never borrows a protected record',async t=>{
 for(const mutateTask of [q=>{const x=JSON.parse(q.host_context.context);x.priorMessageCount=1;q.host_context.context=JSON.stringify(x);},q=>{q.request+=' Extra requirement.';q.request_sha256=H(q.request);q.objective=q.request;}] ){
  const h=await harness(t,{mutateTask});assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);assert.equal(h.runtime._load(h.q.task_id).calibrated_route,undefined);
 }
});
test('plain callback cannot mint a Core calibrated predictor before any durable owner exists',async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'os1-calibrated-untrusted-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 await assert.rejects(createRCCRuntime({stateDir:join(root,'state'),calibratedRoutePredictor:()=>({status:'qualified',execution_authorized:false})}),e=>e.code==='calibrated_predictor_not_host_factory');
});
test('source-bearing full task contract cannot borrow the source-free calibrated family',async t=>{
 const h=await harness(t,{mutateCatalog:c=>{c.task_contract.source_sha256=H('SYNTHETIC-external-source');}});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 assert.equal(h.runtime._load(h.q.task_id).calibrated_route,undefined);
});
test('unknown task-contract source state is not silently treated as an explicit source-free observation',async t=>{
 const h=await harness(t,{mutateCatalog:c=>{delete c.task_contract.source_sha256;}});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 assert.equal(h.runtime._load(h.q.task_id).calibrated_route,undefined);
});
test('changed current workload before dispatch restores exact original R0 rather than borrowing a covered stratum',async t=>{
 const h=await harness(t,{beforeRefresh:({cat})=>{cat.request_class='text_operation';cat.chat_lane_eligible=true;}});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 const s=h.runtime._load(h.q.task_id);assert.equal(s.calibrated_route.state,'restored_r0');assert.equal(stableJSON(s.plan),stableJSON(h.baseline.plan));
});
test('loss of host capability before dispatch restores original R0, not the statistical frontier fallback',async t=>{
 const h=await harness(t,{beforeRefresh:({runtime})=>{runtime.calibratedRoutePredictor=null;}});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 assert.equal(h.runtime._load(h.q.task_id).calibrated_route.state,'restored_r0');
 assert.equal(stableJSON(h.runtime._load(h.q.task_id).plan),stableJSON(h.baseline.plan));
});
test('factory-branded unmeasured evidence replacement before dispatch preserves R0',async t=>{
 const h=await harness(t,{beforeRefresh:({runtime})=>{runtime.calibratedRoutePredictor=createCalibratedRoutePredictor({evidence:null});}});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 assert.equal(h.runtime._load(h.q.task_id).calibrated_route.state,'restored_r0');
});
test('an already-cheapest current R0 tuple is not replaced by a proposal with no resource improvement',async t=>{
 // The same actual qualified tuple may occupy R0 and lowest-cost roles.
 // Its whole-route episode costs are unchanged; no source means are edited.
 const h=await harness(t,{originalR0:'SYNTHETIC-routed'});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-routed']);
 assert.equal(h.runtime._load(h.q.task_id).calibrated_route,undefined);assert.equal(stableJSON(h.runtime._load(h.q.task_id).plan),stableJSON(h.baseline.plan));
});
test('explicit material, handoff source, unknown context and native resume do not borrow first-turn qualification',async t=>{
 const mutations=[q=>{q.material_refs=['SYNTHETIC-source-reference'];},
  q=>{const x=JSON.parse(q.host_context.context);x.source={state:'present',sha256:H('SYNTHETIC-source')};q.host_context.context=JSON.stringify(x);},
  q=>{q.host_context.context='';},q=>{q.host_context.codex_session_id=randomUUID();},
  q=>{const x=JSON.parse(q.host_context.context);x.taskContext.sources=[{state:'unknown'}];q.host_context.context=JSON.stringify(x);}];
 for(const mutateTask of mutations){const h=await harness(t,{mutateTask});
  assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);assert.equal(h.runtime._load(h.q.task_id).calibrated_route,undefined);
 }
});
test('new task source-hash field cannot be injected into the existing wire schema',async t=>{
 await assert.rejects(harness(t,{mutateTask:q=>{q.source_sha256=H('SYNTHETIC-source');}}),e=>e.code==='task_shape_invalid');
});
test('fresh protected but uncovered feature stratum before dispatch restores byte-original R0',async t=>{
 let swapped=false;
 const h=await harness(t,{beforeRefresh:({runtime,q,cat,packet})=>{
  if(swapped)return;swapped=true;
  const next=writeCalibratedRouteFixture({stateDir:join(dirname(packet.stateDir),'evidence-ood'),now_ms:packet.now_ms-3,three_configs:true,
   prepareRecords:metadata=>{const r=prepared(q,cat,metadata);r.prepared.features.requirement_count+=1;
    r.prepared.selector_input.task.feature_sha256=digest(r.prepared.features);
    r.record_sha256=digest({captured_at_ms:r.captured_at_ms,prepared:r.prepared});return [r];}});
  const predictor=createCalibratedRoutePredictor({evidence:next.capability});
  const baseline=resolveRoutePlan(hostPlan(q,cat),q,cat,Date.now());
  const outcome=predictor(runtime._calibratedContext(q,baseline,cat,Date.now()));
  assert.equal(outcome.status,'unmeasured');assert.equal(outcome.reason,'cp_exact_stratum_uncovered');
  runtime.calibratedRoutePredictor=predictor;
 }});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 const s=h.runtime._load(h.q.task_id);assert.equal(s.calibrated_route.state,'restored_r0');assert.equal(stableJSON(s.plan),stableJSON(h.baseline.plan));
});
test('revocation after reservation is caught at the final pre-intent checkpoint and releases reservation',async t=>{
 let revoked=false;
 const h=await harness(t,{afterCreate:({runtime,packet})=>{
  const reserve=runtime._tryReserve.bind(runtime);
  runtime._tryReserve=(...args)=>{const reservation=reserve(...args);if(reservation&&!revoked){revoked=true;rmSync(join(packet.root,'promotion-review.json'),{force:true});}return reservation;};
 }});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 const s=h.runtime._load(h.q.task_id);assert.equal(s.calibrated_route.state,'restored_r0');assert.equal(s.native_dispatches,1);
 assert.equal(h.runtime.activeWorkers,0);assert.equal(h.runtime.poolReservations.size,0);
});
test('loss of independent runnable reference never dispatches the statistically selected row',async t=>{
 const h=await harness(t,{beforeRefresh:({cat})=>{cat.candidates.find(c=>c.id==='SYNTHETIC-reference').availability='unavailable';}});
 assert.equal(h.result.state,'held');assert.deepEqual(h.tickets,[]);
 const s=h.runtime._load(h.q.task_id);assert.equal(s.native_dispatches,0);assert.equal(s.children[0].candidate_id,'SYNTHETIC-floor');
 assert.equal(s.calibrated_route.state,'restored_r0');assert.equal(s.calibrated_route.reason,'current_r0_unavailable');assert.equal(s.calibrated_route.current_r0_runnable,false);
 assert.equal(stableJSON(s.plan),stableJSON(h.baseline.plan));assert.equal(s.children[0].attempt_history.length,0);
 assert.equal(s.bound_rows['SYNTHETIC-reference'].availability,'available');assert.equal(s.catalog.candidates.find(c=>c.id==='SYNTHETIC-reference').availability,'unavailable');
});
test('insufficient attempt or native-dispatch fallback headroom keeps the unchanged R0 tuple',async t=>{
 for(const mutateTask of [q=>{q.budget.max_attempts=1;},q=>{q.budget.max_native_dispatches=1;}]){
  const h=await harness(t,{mutateTask});assert.equal(h.result.state,'completed',h.result.error);
  assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);assert.equal(h.runtime._load(h.q.task_id).calibrated_route,undefined);
 }
});
test('already committed native-dispatch headroom is not refunded by optional calibrated admission',async t=>{
 let committed=false;
 const h=await harness(t,{mutateTask:q=>{q.budget.max_native_dispatches=2;},beforeRefresh:({runtime,q})=>{
  if(committed)return;committed=true;
  // Explicit synthetic durable-budget premise, not a claimed provider call.
  runtime._update(q.task_id,'synthetic_committed_budget_premise',s=>{s.native_dispatches=1;});
 }});
 assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-floor']);
 const s=h.runtime._load(h.q.task_id);assert.equal(s.calibrated_route.state,'restored_r0');assert.equal(s.native_dispatches,2);
 assert.equal(stableJSON(s.plan),stableJSON(h.baseline.plan));
});
test('explicit provider, model, effort and ceiling pins retain their original host R0 semantics',async t=>{
 const mutations=[c=>{c.routing_intent_v2.allowed_surfaces=['codex'];},
  c=>{c.routing_intent_v2.exact_model='SYNTHETIC-routed';},
  c=>{c.routing_intent_v2.effort='ultra';},c=>{c.routing_intent_v2.require_native_ceiling=true;}];
 for(const mutateCatalog of mutations){const h=await harness(t,{mutateCatalog});
  assert.equal(h.result.state,'completed',h.result.error);assert.deepEqual(h.tickets.map(t=>t.candidate_id),[h.baseline.plan.nodes[0].candidate_id]);
  assert.equal(h.runtime._load(h.q.task_id).calibrated_route,undefined);assert.equal(stableJSON(h.runtime._load(h.q.task_id).plan),stableJSON(h.baseline.plan));
 }
});
test('large source-bound policy body is retained byte-exact while the same Core conditionally adopts the cheaper tuple',async t=>{
 const policyBody='SYNTHETIC large current RCC instructions.\n'.repeat(400);
 assert(Buffer.byteLength(policyBody)>8192);
 const h=await harness(t,{policyBody});assert.equal(h.result.state,'completed',h.result.error);
 assert.deepEqual(h.tickets.map(t=>t.candidate_id),['SYNTHETIC-routed']);
 const s=h.runtime._load(h.q.task_id);assert.equal(s.plan_provenance,'host_calibrated_original_v1');assert.equal(s.task.policy.text,policyBody);
 assert.equal(s.task.policy_sha256,H(policyBody));assert.equal(h.tickets[0].policy_sha256,H(policyBody));
 assert.equal(h.tickets[0].instruction,h.q.request);assert.equal(h.tickets[0].original_request,h.q.request);
});
