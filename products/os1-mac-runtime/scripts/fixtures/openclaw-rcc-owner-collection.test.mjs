// SYNTHETIC SOURCE/FAKE-BACKEND REGRESSIONS. No provider/model/network call,
// no live contracts, quality comparison, training or public proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,chmod,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRCCRuntime,hostContextFingerprint,hostPlan,resolveRoutePlan,ownerCollectionFor,ownerCollectionOutput}
 from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
const H=x=>createHash('sha256').update(x).digest('hex');
import {executeOwnerCollectionChild} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
const LETTERS='abcdefgh';
function fixture(root='/tmp/synthetic-owner-collection',n=2){
 const paragraphs=['Read source A, retain the declared status and its source citation as a JSON object.','Read source B, retain the recorded notice time, not an inferred internal creation time, as a JSON object.',
  ...Array.from({length:Math.max(0,n-2)},(_,i)=>`Read source ${LETTERS[i+2].toUpperCase()}, retain its declared status as a JSON object.`)].slice(0,n);
 const request='Return the following independent source obligations as one JSON array in order.\n\n'+paragraphs.join('\n\n');
 const h={workspace:root,context:null,provider_preference:'auto',codex_session_id:null,claude_session_id:null,require_read_only:true,owner_policy:null};
 const q={schema:1,task_id:randomUUID(),request,objective:request,request_sha256:H(request),source_fingerprint:hostContextFingerprint(h),
  policy_sha256:H('policy'),policy:{source_sha256:H('original'),projection_sha256:H('policy'),text:'policy'},mode:'auto',material_refs:[],
  routing_intent_policy_version:'r10_joint_selection_v2',budget:{max_attempts:2,max_parallel:4,max_cost_units:null,max_duration_ms:20000,max_native_dispatches:4},host_context:h};
 const row=(id,model,effort)=>({id,surface:'codex',transport:'codex_app_server',account_id:'synthetic',model,effort,tools:['read'],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:H(id),availability:'available',availability_observed_at_ms:Date.now()-1,availability_valid_until_ms:Date.now()+60000,quota_remaining_fraction:1,quota_observed_at_ms:Date.now()-1,quota_valid_until_ms:Date.now()+60000,quality_state:'policy_admitted',estimated_cost_units:id==='cheap'?1:10});
 const c={schema:1,task_id:q.task_id,request_sha256:q.request_sha256,owner_scope:'read_only',chat_lane_eligible:false,request_class:'readonly_lookup',
  routing_intent_v2:{version:'r10_joint_selection_v2',allowed_surfaces:[],exact_model:null,model_family:null,effort:null,require_native_ceiling:false,quality_target:null,state:'resolved'},
  native_reference_efforts:{codex:{'frontier-model':'ultra','fast-model':'low'}},model_tiers:{'frontier-model':'frontier','fast-model':'fast'},
  candidates:[row('ref','frontier-model','ultra'),row('cheap','fast-model','low')],task_contract:{coverage:'full',scope:'read_only',objective_sha256:q.request_sha256,contract_sha256:H('parent'),context_sha256:H(''),start_tree_sha256:H('tree'),reference_policy_sha256:q.policy_sha256,valid_until_ms:Date.now()+60000,bindings_checked:true,source_sha256:null,execution_isolation:'codex_fresh_local_effects_v1',execution_isolation_sha256:H('fixture-local-profile')}};
 let end=0; const obligations=paragraphs.map((instruction,i)=>{const start=Buffer.byteLength(request.slice(0,request.indexOf(instruction))); end=start+Buffer.byteLength(instruction);return{id:`source-${LETTERS[i]}`,instruction,request_utf8_start:start,request_utf8_end:end,source_paths:[`source-${i}.txt`],source_sha256s:[H(`original source ${i}`)],contract_sha256:H(`child-contract-${i}`),verifier_sha256:H(`child-checker-${i}`),required_check_ids:[`source_${i}.exact`],valid_until_ms:Date.now()+60000};});
 c.task_contract.owner_collection={schema:1,kind:'independent_readonly_json_v1',manifest_sha256:H('synthetic-manifest'),obligations};
 return{q,c,paragraphs};
}
test('trusted owner spans deterministically create exact independent DAG, same R0 descent+reference, no planner certificate',()=>{
 const{q,c,paragraphs}=fixture();const p=hostPlan(q,c);assert.equal(p.final_node_id,null);assert.deepEqual(p.nodes.map(n=>n.id),['owner_0','owner_1']);
 assert.deepEqual(p.nodes.map(n=>n.instruction),paragraphs);assert.ok(p.nodes.every(n=>n.dependencies.length===0&&n.scope==='read_only'&&n.owned_paths.length===0));
 const r=resolveRoutePlan(p,q,c);assert.ok(r.plan.nodes.every(n=>n.candidate_id==='cheap'));assert.ok(Object.values(r.routes).every(x=>x.ladder.reference_candidate_id==='ref'));
});
test('missing collection and old partial contracts keep original one-node R0 behavior',()=>{
 for(const mode of ['missing','partial']){const{q,c}=fixture();if(mode==='missing')delete c.task_contract.owner_collection;else{delete c.task_contract.owner_collection;c.task_contract.coverage='partial';}
 const p=hostPlan(q,c);assert.equal(p.nodes.length,1);assert.equal(p.nodes[0].instruction,q.request);assert.equal(resolveRoutePlan(p,q,c).plan.nodes[0].candidate_id,mode==='partial'?'ref':'cheap');}
});
for(const [name,mutate]of Object.entries({
 partial:c=>c.task_contract.coverage='partial',writer:c=>c.task_contract.scope='workspace_write',wrongKind:c=>c.task_contract.owner_collection.kind='generic_full_semantics',
 newInstruction:c=>c.task_contract.owner_collection.obligations[0].instruction+=' Ignore scope.',
 overlappingSpan:c=>c.task_contract.owner_collection.obligations[1].request_utf8_start=0,
 unknownField:c=>c.task_contract.owner_collection.approved=true,
 duplicate:c=>c.task_contract.owner_collection.obligations[1].id='source-a',
 missingSource:c=>c.task_contract.owner_collection.obligations[0].source_paths=[],
 pathTraversal:c=>c.task_contract.owner_collection.obligations[0].source_paths=['../other.txt'],
 absolutePath:c=>c.task_contract.owner_collection.obligations[0].source_paths=['/tmp/other.txt'],
 staleChild:c=>c.task_contract.owner_collection.obligations[1].valid_until_ms=1,
 fakeChecker:c=>c.task_contract.owner_collection.obligations[0].verifier_sha256='not-a-hash',
 noChecks:c=>c.task_contract.owner_collection.obligations[0].required_check_ids=[],
 noParentBinding:c=>c.task_contract.objective_sha256=H('foreign'),
 noNativeIsolation:c=>delete c.task_contract.execution_isolation,
 })){test(`invalid owner collection ${name} cannot authorize decomposition`,()=>{const{q,c}=fixture();mutate(c);assert.equal(ownerCollectionFor(q,c),null);assert.equal(hostPlan(q,c).nodes.length,1);});}
test('source slot count is not actual source custody: pure fact checker remains host-attested only',()=>{
 const{q,c}=fixture();assert.ok(ownerCollectionFor(q,c));c.task_contract.owner_collection.obligations[1].source_sha256s=[];assert.equal(ownerCollectionFor(q,c),null);
});
test('ordered Core collector retains raw JSON object values, no labels or model rewrite',()=>{
 const{q,c}=fixture(),p=hostPlan(q,c);const children=[{id:'owner_1',state:'completed',output:'{"internal_change_time":null,"source":"B"}'},{id:'owner_0',state:'completed',output:'{"status":"waiting","source":"A"}'}];
 assert.deepEqual(JSON.parse(ownerCollectionOutput(p,children)),[{status:'waiting',source:'A'},{internal_change_time:null,source:'B'}]);
 for(const bad of [[children[0]],children.concat(children[0]),[{...children[0],output:'[1,2]'},children[1]],[{...children[0],state:'running'},children[1]]])assert.throws(()=>ownerCollectionOutput(p,bad));
});
function native(ticket,root,contractSHA,output){return{schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',native_turn_terminated:true,execution_verified:true,task_verified:true,task_quality:'task_verified',parity_state:'unverified',output,native_receipt:'/private/synthetic/'+ticket.attempt_id,native_summary:null,operational_quality:{schema:1,coverage:'full',assessment_state:'task_contract_verified',contract_sha256:contractSHA,witness_path:join(root,'quality-witnesses',ticket.attempt_id+'.json'),witness_sha256:H('witness'),artifact_sha256:H(output),workspace_after_sha256:H('workspace'),failed_check_ids:[],corrective_attempts:0,local_only_verified:false}};}
async function run(t,{wrongChildContract=false,changeAuthority=false,failParent=false,revokeBeforeDispatch=false,planPatch=null}={}){
 const root=await mkdtemp(join(tmpdir(),'os1-owner-collection-'));await chmod(root,0o700);const{q,c}=fixture(root);let inFlight=0,peak=0,calls=[],planners=0,parents=0;
 let catalogCalls=0;
 const runtime=await createRCCRuntime({stateDir:root,hostAutoPlan:planPatch===null,maximumReadWorkersPerPool:4,
 catalog:async()=>{catalogCalls++;if(revokeBeforeDispatch&&catalogCalls>1){const x=structuredClone(c);delete x.task_contract.owner_collection;return x;}return c;},
 plan:async()=>{planners++;if(planPatch){const p=hostPlan(q,c);planPatch(p);return p;}throw Error('must not call model plan');},
 execute:async ticket=>{inFlight++;peak=Math.max(peak,inFlight);calls.push(ticket);await new Promise(r=>setTimeout(r,30));inFlight--;const i=Number(ticket.node_id.slice(-1));const contract=wrongChildContract&&ticket.candidate_id==='cheap'?H('wrong'):c.task_contract.owner_collection.obligations[i].contract_sha256;
 const output=JSON.stringify(i===0?{source:'A',status:'waiting'}:{source:'B',internal_change_time:null});if(changeAuthority)delete c.task_contract.owner_collection;
 return native(ticket,root,contract,output);},
 verifyTask:async({task,plan,children})=>{parents++;return{schema:1,task_id:task.task_id,task_verified:!failParent,output:ownerCollectionOutput(plan,children),parity_state:'unverified',reason:failParent?'synthetic_parent_failed':'synthetic_parent_checked'};}});
 t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});await runtime.submit(q);const status=await runtime.wait({schema:1,task_id:q.task_id},{timeoutMs:6000});return{status,runtime,q,c,calls,peak,planners,parents,catalogCalls:()=>catalogCalls};
}
test('same durable Core executes two independent source children with bounded parallelism and one parent verifier',async t=>{
 const r=await run(t);assert.equal(r.status.state,'completed');assert.equal(r.calls.length,2);assert.equal(r.planners,0);assert.equal(r.parents,1);
 // Existing same-parent read-only DAG capability (_claimsConflict) permits
 // these two readers; this patch adds no cross-parent/write sharing authority.
 assert.equal(r.peak,2);assert.equal(r.runtime._load(r.q.task_id).plan_provenance,'host_owner_collection_v1');assert.equal(JSON.parse(r.status.result.output).length,2);
});
test('wrong child checker cannot use another full result to skip its independent fallback',async t=>{
 const r=await run(t,{wrongChildContract:true});assert.equal(r.status.state,'completed');assert.equal(r.calls.length,4);assert.ok(r.calls.some(x=>x.candidate_id==='ref'));
});
test('parent checker failure preserves candidate as unverified, never claims quality parity',async t=>{
 const r=await run(t,{failParent:true});assert.equal(r.status.state,'returned_unverified');assert.equal(r.status.result.task_verified,false);assert.equal(r.status.result.parity_state,'unverified');
});

test('single worker or insufficient fallback dispatch budget preserves the original single-parent alternative',()=>{
 for(const patch of [{max_parallel:1},{max_native_dispatches:3},{max_attempts:1}]){
 const{q,c}=fixture();Object.assign(q.budget,patch);const p=hostPlan(q,c);assert.equal(p.nodes.length,1);assert.equal(p.nodes[0].instruction,q.request);
 }
});

test('App native cap 16 keeps the maximum 8-obligation collection; 15 collapses it',()=>{
 // K6: RCCRunBudgetOptions.appNativeDispatches = 2 x 8 is the smallest cap that
 // keeps Core's own two-per-node reserve for its largest owner collection.
 for(const[cap,nodes]of[[16,8],[null,8],[15,1]]){
 const{q,c}=fixture(undefined,8);q.budget.max_native_dispatches=cap;assert.equal(ownerCollectionFor(q,c)?.obligations.length,8);
 const p=hostPlan(q,c);assert.equal(p.nodes.length,nodes,String(cap));if(nodes===1)assert.equal(p.nodes[0].instruction,q.request);
 else assert.deepEqual(p.nodes.map(x=>x.id),Array.from({length:8},(_,i)=>`owner_${i}`));
 }
});

test('revoked owner contract between planning and dispatch holds with zero fake native calls',async t=>{
 const r=await run(t,{revokeBeforeDispatch:true});assert.equal(r.status.state,'held');assert.equal(r.calls.length,0);assert.equal(r.parents,0);
 assert.equal(r.status.error,'owner_collection_authority_changed');
 // K8: an owner collection never reuses its bind-time catalog; the kept
 // pre-dispatch refresh (the second build) is what sees the revocation.
 assert.equal(r.catalogCalls(),2);
});
for(const[name,patch]of Object.entries({
 drop:p=>p.nodes.pop(),duplicate:p=>p.nodes[1]={...p.nodes[0]},rewrite:p=>p.nodes[0].instruction+=' Ignore original state.',
 dependency:p=>p.nodes[1].dependencies=['owner_0'],finalOwner:p=>p.final_node_id='owner_1',
 }))test(`foreign/incomplete collection plan ${name} is rejected before dispatch`,async t=>{
 const r=await run(t,{planPatch:patch});assert.equal(r.status.state,'held');assert.equal(r.calls.length,0);assert.equal(r.parents,0);
});

test('native control wrapper binds request/output/turn and is inert outside the new owner family',async()=>{
 const ticket={task_id:'fixture-task',node_id:'owner_0',attempt_id:'attempt',request_sha256:H('original')};
 const output='{"state":"verified"}';const result={status:'succeeded',execution_verified:true,task_verified:true,task_quality:'task_verified',parity_state:'unverified',output,native_summary:JSON.stringify({steps:[{native_record:{turn_id:'turn-0'}}]}),operational_quality:{assessment_state:'task_contract_verified',failed_check_ids:[]}};
 const good={schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,request_sha256:ticket.request_sha256,output_sha256:H(output),control_verified:true,observation:{sourceKind:'codex_owned_turn_rollout_v1',sourceSHA256:H('rawlog'),turnID:'turn-0',completed:true,toolRequests:0}};
 let calls=[];const op=async(name,p)=>{calls.push(name);return name==='rcc-adapter'?result:good;};
 assert.equal(await executeOwnerCollectionChild(ticket,null,{operation:op}),result);assert.deepEqual(calls,['rcc-adapter','rcc-owner-control']);
 calls=[];assert.equal(await executeOwnerCollectionChild({...ticket,node_id:'node_0'},null,{operation:op}),result);assert.deepEqual(calls,['rcc-adapter']);
 for(const patch of [{request_sha256:H('foreign')},{output_sha256:H('foreign')},{attempt_id:'other'},{observation:{...good.observation,turnID:'foreign'}},{observation:{...good.observation,toolRequests:1}},{observation:{...good.observation,completed:false}}]){
 const r=await executeOwnerCollectionChild(ticket,null,{operation:async name=>name==='rcc-adapter'?result:{...good,...patch}});
 assert.equal(r.task_verified,false);assert.equal(r.task_quality,'unverified');assert.equal(r.output,output);assert.equal(r.error,'owner_collection_control_unverified');
 }
});
test('unknown native control protocol holds with output preserved and no reference replay',async t=>{
 const root=await mkdtemp(join(tmpdir(),'os1-owner-control-'));await chmod(root,0o700);const{q,c}=fixture(root);let calls=0;
 const runtime=await createRCCRuntime({stateDir:root,hostAutoPlan:true,maximumReadWorkersPerPool:4,catalog:async()=>c,
 execute:async ticket=>{calls++;const i=Number(ticket.node_id.slice(-1));const r=native(ticket,root,c.task_contract.owner_collection.obligations[i].contract_sha256,'{"source":"fixture"}');r.usage={input_tokens:100,output_tokens:8,cache_read_tokens:0,cache_write_tokens:0,provider_calls:1,duration_ms:10,metric:'native_usage_observation'};return{...r,task_verified:false,task_quality:'unverified',error:'owner_collection_control_unverified',operational_quality:{...r.operational_quality,assessment_state:'unverified'}};},
 verifyTask:()=>{throw Error('control unknown cannot adopt parent');}});
 t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});await runtime.submit(q);const result=await runtime.wait({schema:1,task_id:q.task_id},{timeoutMs:6000});
 assert.equal(result.state,'held');assert.equal(result.error,'owner_collection_control_unverified');assert.ok(calls<=2);assert.ok(runtime._load(q.task_id).children.some(x=>x.output==='{"source":"fixture"}'));
 assert.equal(runtime._load(q.task_id).children.some(x=>x.attempt_history.some(a=>a.candidate_id==='ref')),false);
 const before=runtime._load(q.task_id);assert.equal(result.resource_usage.native_tokens_observed,calls*108);
 assert.equal(result.resource_usage.native_attempts,calls);assert.equal(result.resource_usage.plan_model_calls,0);
 assert.equal(runtime.ledger.attemptIDs().size,calls);assert.equal(runtime.ledgerInflight.size,0);
 const ledger=(await readFile(join(root,'routing-ledger','routing-ledger.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(ledger.length,calls);assert.ok(ledger.every(x=>x.verifier_outcome==='unverified_control'&&x.task_quality==='unverified'&&x.attempt_state==='owner_collection_control_unverified'));
 assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM quota_leases').get().n,0);
 assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM pool_claims WHERE phase='active'").get().n,0);
 await runtime.close();let replay=0;
 const reopened=await createRCCRuntime({stateDir:root,hostAutoPlan:true,catalog:async()=>c,execute:async()=>{replay++;throw Error('held source must not replay');}});
 t.after(()=>reopened.close());await reopened.startQueued();
 const persisted=reopened.status({schema:1,task_id:q.task_id});assert.equal(persisted.state,'held');assert.equal(replay,0);
 assert.deepEqual(reopened._load(q.task_id).children,before.children);assert.equal(reopened.ledger.attemptIDs().size,calls);

});

test('an earlier held sibling never unmasks a later control-unknown descent output; the task holds with no result',async t=>{
 // The settle path names the first held child; a control-unknown later in the
 // plan is still a hold, and a certified descent's unaccepted raw output never
 // rides in a partial (owner law: no unchecked cheaper delivery).
 for(const n of [2,3]){
 const root=await mkdtemp(join(tmpdir(),'os1-owner-unmask-'));await chmod(root,0o700);const{q,c}=fixture(root,n);q.budget.max_native_dispatches=2*n;
 const calls=[];let started1,held0;const owner1Started=new Promise(r=>started1=r),owner0Held=new Promise(r=>held0=r);
 const gate=p=>Promise.race([p,new Promise(r=>setTimeout(r,5000))]);let runtime;
 runtime=await createRCCRuntime({stateDir:root,hostAutoPlan:true,maximumReadWorkersPerPool:4,catalog:async()=>c,
 plan:async()=>{throw Error('must not call model plan');},
 execute:async ticket=>{calls.push([ticket.node_id,ticket.candidate_id]);const i=Number(ticket.node_id.slice(-1));
  const r=native(ticket,root,c.task_contract.owner_collection.obligations[i].contract_sha256,i===1?'{"source":"UNACCEPTED"}':'{"source":"C"}');
  if(i===0){await gate(owner1Started);setImmediate(function poll(){runtime._load(ticket.task_id)?.children.find(x=>x.id==='owner_0')?.state==='held'?held0():setTimeout(poll,5);});
   return{...r,status:'failed',dispatch_stage:'not_dispatched',execution_verified:false,task_verified:false,task_quality:'failed',output:null,error:'native_pre_dispatch_failed',operational_quality:null};}
  if(i===1){started1();await gate(owner0Held);return{...r,task_verified:false,task_quality:'unverified',error:'owner_collection_control_unverified',operational_quality:{...r.operational_quality,assessment_state:'unverified'}};}
  return r;},
 verifyTask:()=>{throw Error('a held collection cannot adopt a parent');}});
 t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});await runtime.submit(q);
 const status=await runtime.wait({schema:1,task_id:q.task_id},{timeoutMs:8000}),saved=runtime._load(q.task_id);
 assert.equal(status.state,'held',JSON.stringify(status));assert.equal(status.error,'native_pre_dispatch_failed');assert.equal(status.result,null);
 assert.deepEqual(saved.children.slice(0,2).map(x=>[x.state,x.hold_reason,x.route_kind]),[['held','native_pre_dispatch_failed','tier'],['held','owner_collection_control_unverified','tier']]);
 assert.equal(saved.children[1].output,'{"source":"UNACCEPTED"}','raw output stays in durable custody');
 if(n===3)assert.equal(saved.children[2].state,'completed');
 assert.equal(calls.length,n);assert.ok(calls.every(([,candidate])=>candidate==='cheap'),'no reference replay');
 }
});

test('normal owner child gate shares closed legacy/current parser kinds; unknown future grammars remain held',async()=>{
 const ticket={task_id:'synthetic-task',node_id:'owner_0',attempt_id:'synthetic-attempt',request_sha256:H('source')};
 const output='{"source":"synthetic"}',result={status:'succeeded',execution_verified:true,task_verified:true,task_quality:'task_verified',parity_state:'unverified',output,native_summary:JSON.stringify({steps:[{native_record:{turn_id:'owned-turn'}}]})};
 for(const [kind,pass]of [['codex_owned_turn_rollout_v1',true],['codex_owned_turn_rollout_9394_v1',true],['codex_owned_turn_rollout_9394_v1_extra',false],['codex_owned_turn_rollout_future_v1',false]]){
  const control={schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,request_sha256:ticket.request_sha256,output_sha256:H(output),control_verified:true,observation:{sourceKind:kind,sourceSHA256:H('synthetic log'),turnID:'owned-turn',completed:true,toolRequests:0}};
  const got=await executeOwnerCollectionChild(ticket,null,{operation:async name=>name==='rcc-adapter'?result:control});assert.equal(got.task_verified,pass,kind);
 }
});
