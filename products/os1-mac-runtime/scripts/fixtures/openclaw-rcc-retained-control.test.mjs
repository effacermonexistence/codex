// SYNTHETIC fake-backend recovery regressions only. Zero provider/SDK/model
// calls; not public proof, actual contract authority, or quality comparison.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp,chmod,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRCCRuntime,hostContextFingerprint,ownerCollectionOutput,ownerCollectionFor}
 from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {registerRCCRuntime} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
const H=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const clone=x=>structuredClone(x);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function fixture(t,{controlPatch=null,parentPatch=null,controlWait=null,parentWait=null,emit=null}={}) {
 const root=await realpath(await mkdtemp(join(tmpdir(),'os1-retained-control-')));await chmod(root,0o700);
 for(const d of ['native-receipts','quality-witnesses'])await mkdir(join(root,d),{mode:0o700});
 const paragraphs=['Retain source A status and source citation as one JSON object.','Retain source B notice time and unknown internal timestamp as one JSON object.'];
 const request='Return independent source obligations as an ordered JSON array.\n\n'+paragraphs.join('\n\n');
 const h={workspace:root,context:null,provider_preference:'auto',codex_session_id:null,claude_session_id:null,require_read_only:true,owner_policy:null};
 const q={schema:1,task_id:randomUUID(),request,objective:request,request_sha256:H(request),source_fingerprint:hostContextFingerprint(h),
 policy_sha256:H('policy'),policy:{source_sha256:H('original'),projection_sha256:H('policy'),text:'policy'},mode:'auto',material_refs:[],
 routing_intent_policy_version:'r10_joint_selection_v2',budget:{max_attempts:2,max_parallel:4,max_cost_units:null,max_duration_ms:20000,max_native_dispatches:4},host_context:h};
 const row=(id,model,effort)=>({id,surface:'codex',transport:'codex_app_server',account_id:'synthetic',model,effort,tools:['read'],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:H(id),availability:'available',availability_observed_at_ms:Date.now()-1,availability_valid_until_ms:Date.now()+60000,quota_remaining_fraction:1,quota_observed_at_ms:Date.now()-1,quota_valid_until_ms:Date.now()+60000,quality_state:'policy_admitted',estimated_cost_units:id==='cheap'?1:10});
 const c={schema:1,task_id:q.task_id,request_sha256:q.request_sha256,owner_scope:'read_only',chat_lane_eligible:false,request_class:'readonly_lookup',
 routing_intent_v2:{version:'r10_joint_selection_v2',allowed_surfaces:[],exact_model:null,model_family:null,effort:null,require_native_ceiling:false,quality_target:null,state:'resolved'},native_reference_efforts:{codex:{'frontier-model':'ultra','fast-model':'low'}},model_tiers:{'frontier-model':'frontier','fast-model':'fast'},candidates:[row('ref','frontier-model','ultra'),row('cheap','fast-model','low')],
 task_contract:{coverage:'full',scope:'read_only',objective_sha256:q.request_sha256,contract_sha256:H('parent'),context_sha256:H(''),start_tree_sha256:H('tree'),reference_policy_sha256:q.policy_sha256,valid_until_ms:Date.now()+60000,bindings_checked:true,source_sha256:null,execution_isolation:'codex_fresh_local_effects_v1',execution_isolation_sha256:H('synthetic-native-profile')}};
 c.task_contract.owner_collection={schema:1,kind:'independent_readonly_json_v1',manifest_sha256:H('synthetic-manifest'),obligations:paragraphs.map((instruction,i)=>{const start=Buffer.byteLength(request.slice(0,request.indexOf(instruction)));return{id:`source-${i}`,instruction,request_utf8_start:start,request_utf8_end:start+Buffer.byteLength(instruction),source_paths:[`source-${i}.txt`],source_sha256s:[H(`source-${i}`)],contract_sha256:H(`child-${i}`),verifier_sha256:H(`checker-${i}`),required_check_ids:[`source${i}.exact`],valid_until_ms:Date.now()+60000};})};
 const originals=new Map(),calls={execute:0,catalog:0,control:0,parent:0};let sealed=false;
 const forbidden=()=>{throw Error('recovery reached an execution/planning callback');};
 const runtime=await createRCCRuntime({stateDir:root,hostAutoPlan:true,maximumReadWorkersPerPool:4,
 catalog:async()=>{if(sealed)forbidden();calls.catalog++;return c;},plan:forbidden,resolveIntent:undefined,
 execute:async ticket=>{if(sealed)forbidden();calls.execute++;await new Promise(r=>setTimeout(r,15));const i=Number(ticket.node_id.slice(-1));
 const output=JSON.stringify({source:i?'B':'A',state:i?'notified':'waiting',internal_time:null});const path=join(root,'native-receipts',randomUUID()+'.json');
 const witness=join(root,'quality-witnesses',ticket.attempt_id+'.json'),wb=JSON.stringify({synthetic:true,original_task_id:q.task_id,attempt_id:ticket.attempt_id});await writeFile(witness,wb,{mode:0o600});
 const record={schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',native_turn_terminated:true,execution_verified:true,task_verified:true,task_quality:'task_verified',parity_state:'unverified',output,native_receipt:path,native_summary:JSON.stringify({steps:[{native_record:{turn_id:'turn-'+ticket.attempt_id}}]}),usage:{input_tokens:100,output_tokens:8,cache_read_tokens:0,cache_write_tokens:0,provider_calls:1,duration_ms:10,metric:'native_usage_observation'},operational_quality:{schema:1,coverage:'full',assessment_state:'task_contract_verified',contract_sha256:c.task_contract.owner_collection.obligations[i].contract_sha256,witness_path:witness,witness_sha256:H(wb),artifact_sha256:H(output),workspace_after_sha256:H('tree'),failed_check_ids:[],corrective_attempts:0,local_only_verified:true}};
 await writeFile(path,JSON.stringify(record),{mode:0o600});originals.set(ticket.node_id,record);
 return{...record,task_verified:false,task_quality:'unverified',error:'owner_collection_control_unverified',operational_quality:{...record.operational_quality,assessment_state:'unverified'}};},
 executeContinuation:forbidden,decideOperationalQuality:forbidden,stageSelfUpdate:forbidden,
 verifyRetainedOwnerControl:async request=>{calls.control++;assert.deepEqual(Object.keys(request).sort(),['task','child_id','expected_native_receipt','expected_native_receipt_sha256','expected_witness_sha256','historical_runtime',...(Object.hasOwn(request,'adoption_permit')?['adoption_permit']:[])].sort());if(controlWait)await controlWait(request);const record=clone(originals.get(request.child_id));const control={schema:1,task_id:q.task_id,node_id:request.child_id,attempt_id:record.attempt_id,request_sha256:q.request_sha256,output_sha256:H(record.output),control_verified:true,observation:{sourceKind:'codex_owned_turn_rollout_v1',sourceSHA256:H('synthetic owned log'),turnID:'turn-'+record.attempt_id,completed:true,toolRequests:0}};const result={schema:1,record,control};if(controlPatch)controlPatch(result,request);return result;},
 emit,verifyTask:async evidence=>{calls.parent++;assert.deepEqual(evidence.historical_runtime,input.historical_runtime);assert.deepEqual(evidence.adoption_permit,input.adoption_permit);if(parentWait)await parentWait(evidence);const result={schema:1,task_id:q.task_id,task_verified:true,output:canonical(JSON.parse(ownerCollectionOutput(evidence.plan,evidence.children))),parity_state:'unverified',reason:'synthetic full parent checker'};if(parentPatch)parentPatch(result);return result;}});
 t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});await runtime.submit(q);const held=await runtime.wait({schema:1,task_id:q.task_id},{timeoutMs:6000});assert.equal(held.state,'held');assert.equal(calls.execute,2);while(runtime.runningTasks.has(q.task_id))await new Promise(r=>setTimeout(r,5));sealed=true;
 const storedRow=runtime.db.prepare('SELECT fingerprint,snapshot FROM tasks WHERE task_id=?').get(q.task_id),snapshot=JSON.parse(storedRow.snapshot);
 const input={schema:1,recovery_id:randomUUID(),task_id:q.task_id,request_sha256:q.request_sha256,expected_revision:snapshot.revision,expected_fingerprint:storedRow.fingerprint,expected_snapshot_sha256:H(storedRow.snapshot),historical_runtime:{app_path:join(root,'historical.app'),bundle_inventory_receipt:join(root,'inventory.json'),bundle_inventory_receipt_sha256:H('inventory'),install_receipt:join(root,'install.json'),install_receipt_sha256:H('install'),cli_sha256:H('historical CLI')},children:[]};
 for(const n of snapshot.plan.nodes){const r=originals.get(n.id);input.children.push({id:n.id,attempt_id:r.attempt_id,native_receipt:r.native_receipt,native_receipt_sha256:H(await readFile(r.native_receipt)),witness_sha256:r.operational_quality.witness_sha256});}
 return{runtime,q,c,root,calls,input,originals,before:snapshot,ledgerBefore:await readFile(join(root,'routing-ledger/routing-ledger.jsonl'))};
}
async function assertUnchanged(r){assert.equal(r.runtime._load(r.q.task_id).state,'held');assert.equal(r.runtime._load(r.q.task_id).revision,r.before.revision);assert.deepEqual(r.runtime._load(r.q.task_id).children,r.before.children);assert.deepEqual(await readFile(join(r.root,'routing-ledger/routing-ledger.jsonl')),r.ledgerBefore);assert.equal(r.calls.execute,2);assert.equal(r.runtime.ownerControlRecoveries.size,0);}
test('retained two-child proof completes SAME Core task, exact usage/history/raw receipts, no execution and idempotent',async t=>{
 const r=await fixture(t);const calls=clone(r.calls),result=await r.runtime.recoverOwnerControl(r.input);assert.equal(result.state,'completed');assert.equal(result.result.task_verified,true);assert.equal(result.result.parity_state,'unverified');assert.equal(r.calls.control,2);assert.equal(r.calls.parent,1);assert.equal(r.calls.catalog,calls.catalog);assert.equal(r.calls.execute,calls.execute);
 const after=r.runtime._load(r.q.task_id);assert.equal(after.revision,r.before.revision+1);assert.equal(after.native_dispatches,2);assert.deepEqual(after.children.map(c=>c.attempt_history),r.before.children.map(c=>c.attempt_history));assert.deepEqual(after.children.map(c=>c.usage),r.before.children.map(c=>c.usage));assert.deepEqual(after.children.map(c=>c.output),r.before.children.map(c=>c.output));assert.equal(after.owner_control_recovery.native_generation_calls,0);assert.equal(after.owner_control_recovery.prior_reason,'owner_collection_control_unverified');assert.deepEqual(await readFile(join(r.root,'routing-ledger/routing-ledger.jsonl')),r.ledgerBefore);
 for(const [id,original]of r.originals)assert.deepEqual(JSON.parse(await readFile(original.native_receipt)),original);
 const again=await r.runtime.recoverOwnerControl(r.input);assert.deepEqual(again,result);assert.equal(r.calls.control,2);assert.equal(r.calls.parent,1);assert.equal(r.runtime.ownerControlRecoveries.size,0);
 await assert.rejects(r.runtime.recoverOwnerControl({...r.input,expected_revision:r.input.expected_revision+1}),/idempotency_conflict/);
});
for(const [name,patch]of Object.entries({tool:r=>r.control.observation.toolRequests=1,unknown:r=>r.control.control_verified=false,wrongTurn:r=>r.control.observation.turnID='foreign',wrongOutput:r=>r.control.output_sha256=H('foreign'),foreignAttempt:r=>r.control.attempt_id=randomUUID(),mutatedRecord:r=>r.record.output='{}',wrongModel:r=>r.record.selected_config.model='foreign',notFull:r=>r.record.operational_quality.coverage='partial',notLocal:r=>r.record.operational_quality.local_only_verified=false,unsettled:r=>r.record.native_turn_terminated=false}))test(`retained ${name} rejects, stays held without model fallback`,async t=>{const r=await fixture(t,{controlPatch:patch});await assert.rejects(r.runtime.recoverOwnerControl(r.input));await assertUnchanged(r);assert.equal(r.calls.parent,0);});
for(const [name,patch]of Object.entries({staleRevision:r=>r.input.expected_revision++,staleSnapshot:r=>r.input.expected_snapshot_sha256=H('stale'),foreignFingerprint:r=>r.input.expected_fingerprint=H('other'),foreignRequest:r=>r.input.request_sha256=H('other'),swapped:r=>r.input.children.reverse(),foreignReceipt:r=>r.input.children[0].native_receipt_sha256=H('other'),foreignWitness:r=>r.input.children[0].witness_sha256=H('other'),missingHistory:r=>delete r.input.historical_runtime}))test(`recovery input ${name} rejects before host operation`,async t=>{const r=await fixture(t);patch(r);await assert.rejects(r.runtime.recoverOwnerControl(r.input));await assertUnchanged(r);assert.equal(r.calls.control,0);});
test('failed parent or parent value rewrite stays held, no partial quality publication',async t=>{
 for(const patch of [r=>r.task_verified=false,r=>r.output='[{},{}]',r=>r.parity_state='reference_equivalent']){const r=await fixture(t,{parentPatch:patch});await assert.rejects(r.runtime.recoverOwnerControl(r.input));await assertUnchanged(r);assert.equal(r.calls.parent,1);}
});
test('second-child control failure preserves first proof but no child adoption or repeat execution',async t=>{const r=await fixture(t,{controlPatch:(v,q)=>{if(q.child_id==='owner_1')v.control.control_verified=false;}});await assert.rejects(r.runtime.recoverOwnerControl(r.input));await assertUnchanged(r);assert.equal(r.calls.control,2);assert.equal(r.calls.parent,0);});
test('concurrent recovery is rejected, first operation alone may complete',async t=>{const wait=deferred(),entered=deferred();const r=await fixture(t,{controlWait:async()=>{entered.resolve();await wait.promise;}});const first=r.runtime.recoverOwnerControl(r.input);await entered.promise;await assert.rejects(r.runtime.recoverOwnerControl(r.input),/unavailable/);wait.resolve();assert.equal((await first).state,'completed');assert.equal(r.calls.control,2);assert.equal(r.calls.parent,1);});
test('cancel while native proof awaits blocks adoption and cleans mutex, no generation or uncertain effect fiction',async t=>{const wait=deferred(),entered=deferred();const r=await fixture(t,{controlWait:async()=>{entered.resolve();await wait.promise;}});const first=r.runtime.recoverOwnerControl(r.input);await entered.promise;r.runtime.cancel({schema:1,task_id:r.q.task_id});wait.resolve();await assert.rejects(first,/cancelled/);assert.equal(r.runtime._load(r.q.task_id).state,'cancelled');assert.equal(r.calls.parent,0);assert.equal(r.calls.execute,2);assert.equal(r.runtime.ownerControlRecoveries.size,0);});
test('revision/policy/source authority change while parent awaits fails CAS, cannot overwrite newer task',async t=>{
 const wait=deferred(),entered=deferred();const r=await fixture(t,{parentWait:async()=>{entered.resolve();await wait.promise;}});const pending=r.runtime.recoverOwnerControl(r.input);await entered.promise;r.runtime._update(r.q.task_id,'synthetic_authority_changed',s=>{s.catalog.task_contract.owner_collection.obligations[0].source_sha256s=[H('new source')];});const rev=r.runtime._load(r.q.task_id).revision;wait.resolve();await assert.rejects(pending,/snapshot_changed/);assert.equal(r.runtime._load(r.q.task_id).revision,rev);assert.equal(r.runtime._load(r.q.task_id).state,'held');assert.equal(r.calls.execute,2);assert.equal(r.runtime.ownerControlRecoveries.size,0);
});
test('host rejects account/policy/source/checker drift without fallback; source handler owns actual filesystem/account proof',async t=>{
 for(const label of ['account','policy','source','checker']){const r=await fixture(t,{controlWait:async()=>{throw Object.assign(Error(label+' changed'),{code:'synthetic_'+label+'_changed'});}});await assert.rejects(r.runtime.recoverOwnerControl(r.input),new RegExp(label));await assertUnchanged(r);assert.equal(r.calls.control,1);}
});
test('receipt mutation while parent awaits is detected even without task revision change',async t=>{const wait=deferred(),entered=deferred();const r=await fixture(t,{parentWait:async()=>{entered.resolve();await wait.promise;}});const pending=r.runtime.recoverOwnerControl(r.input);await entered.promise;await writeFile(r.input.children[0].native_receipt,'{}',{mode:0o600});wait.resolve();await assert.rejects(pending,/evidence_changed/);await assertUnchanged(r);});
test('proof-only recovery never asks _allowModelGeneration; original hard-zero authority remains intact',async t=>{const r=await fixture(t);r.runtime._update(r.q.task_id,'synthetic_no_new_generation',s=>{s.effective_task=clone(s.task);s.effective_task.budget.forbid_model_generation=true;});const row=r.runtime.db.prepare('SELECT fingerprint,snapshot FROM tasks WHERE task_id=?').get(r.q.task_id);r.input.expected_revision=JSON.parse(row.snapshot).revision;r.input.expected_snapshot_sha256=H(row.snapshot);r.runtime._allowModelGeneration=()=>{throw Error('proof-only called generation gate');};assert.equal((await r.runtime.recoverOwnerControl(r.input)).state,'completed');assert.equal(r.runtime._load(r.q.task_id).effective_task.budget.forbid_model_generation,true);assert.equal(r.calls.execute,2);});
for(const kind of ['codex_owned_turn_rollout_v1','codex_owned_turn_rollout_9394_v1'])test(`recovery admits ONLY reviewed native control grammar ${kind}`,async t=>{const r=await fixture(t,{controlPatch:p=>p.control.observation.sourceKind=kind});assert.equal((await r.runtime.recoverOwnerControl(r.input)).state,'completed');});
for(const kind of ['codex_owned_turn_rollout_future_v1','codex_owned_turn_rollout_9394_v1_extra','claude_owned_turn_v1'])test(`unknown control grammar ${kind} stays held`,async t=>{const r=await fixture(t,{controlPatch:p=>p.control.observation.sourceKind=kind});await assert.rejects(r.runtime.recoverOwnerControl(r.input),/control_unverified/);await assertUnchanged(r);});
test('live current lease/controller blocks recovery without any host call',async t=>{
 for(const kind of ['write_leases','controller']){const r=await fixture(t);if(kind==='write_leases')r.runtime.db.prepare('INSERT INTO write_leases(workspace,task_id,acquired_ms) VALUES(?,?,?)').run(r.root,r.q.task_id,Date.now());else r.runtime.controllers.set(randomUUID(),{taskID:r.q.task_id,controller:new AbortController()});await assert.rejects(r.runtime.recoverOwnerControl(r.input),/unsettled/);assert.equal(r.calls.control,0);assert.equal(r.runtime.ownerControlRecoveries.size,0);if(kind==='controller')r.runtime.controllers.clear();else r.runtime.db.prepare('DELETE FROM write_leases WHERE task_id=?').run(r.q.task_id);}
});
test('changed original immutable task cannot inherit the old fingerprint',async t=>{const r=await fixture(t);r.runtime._update(r.q.task_id,'synthetic_bad_original',s=>s.task.objective='foreign original');const row=r.runtime.db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(r.q.task_id);r.input.expected_revision=JSON.parse(row.snapshot).revision;r.input.expected_snapshot_sha256=H(row.snapshot);await assert.rejects(r.runtime.recoverOwnerControl(r.input),/state_invalid/);assert.equal(r.calls.control,0);});
test('expired authority or changed collection scope/dependency/final-owner is not restored by a recovery label',async t=>{
 for(const mutate of [s=>s.catalog.task_contract.valid_until_ms=1,s=>s.catalog.task_contract.scope='workspace_write',s=>s.plan.nodes[1].dependencies=['owner_0'],s=>s.plan.final_node_id='owner_1',s=>s.error='unrelated_hold']){const r=await fixture(t);r.runtime._update(r.q.task_id,'synthetic_authority_drift',mutate);const row=r.runtime.db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(r.q.task_id);r.input.expected_revision=JSON.parse(row.snapshot).revision;r.input.expected_snapshot_sha256=H(row.snapshot);await assert.rejects(r.runtime.recoverOwnerControl(r.input));assert.equal(r.calls.control,0);assert.equal(r.runtime._load(r.q.task_id).state,'held');assert.equal(r.calls.execute,2);}
});
test('quiesce while proof awaits cannot declare safe-to-stop or adopt after abort',async t=>{const wait=deferred(),entered=deferred();const r=await fixture(t,{controlWait:async()=>{entered.resolve();await wait.promise;}});const pending=r.runtime.recoverOwnerControl(r.input);await entered.promise;const q=r.runtime.quiesce({schema:1,request_id:randomUUID()});assert.equal(q.safe_to_stop,false);assert.equal(q.active_dispatches,1);wait.resolve();await assert.rejects(pending,/cancelled/);await assertUnchanged(r);assert.equal(r.runtime.quiesce({schema:1,request_id:randomUUID()}).safe_to_stop,true);});
test('close aborts proof, preserves the held durable state and does not resurrect on restart',async t=>{const wait=deferred(),entered=deferred();const r=await fixture(t,{controlWait:async()=>{entered.resolve();await wait.promise;}});const pending=r.runtime.recoverOwnerControl(r.input);await entered.promise;const rejection=assert.rejects(pending,/cancelled/);const closing=r.runtime.close();wait.resolve();await rejection;await closing;const reopened=await createRCCRuntime({stateDir:r.root,catalog:()=>{throw Error('restart catalog replay');},execute:()=>{throw Error('restart model replay');}});t.after(()=>reopened.close());assert.equal(reopened.status({schema:1,task_id:r.q.task_id}).state,'held');assert.equal(r.calls.execute,2);assert.deepEqual(await readFile(join(r.root,'routing-ledger/routing-ledger.jsonl')),r.ledgerBefore);});

test('cancel from adoption emit cannot downgrade an already-completed proof recovery',async t=>{let runtime;const r=await fixture(t,{emit:event=>{if(event.kind==='owner_control_recovery_adopted')runtime.cancel({schema:1,task_id:event.snapshot.task_id});}});runtime=r.runtime;const result=await runtime.recoverOwnerControl(r.input);await new Promise(resolve=>setImmediate(resolve));const after=runtime._load(r.q.task_id);assert.equal(result.state,'completed');assert.equal(after.state,'completed');assert.equal(after.cancel_requested,false);assert.equal(after.result.task_verified,true);assert.equal(r.calls.execute,2);assert.equal(runtime.ownerControlRecoveries.size,0);});
async function reboundSyntheticOutput(r,text){const record=r.originals.get('owner_0');record.output=text;record.operational_quality.artifact_sha256=H(text);await writeFile(record.native_receipt,JSON.stringify(record),{mode:0o600});r.runtime._update(r.q.task_id,'synthetic_numeric_fixture',s=>{s.children[0].output=text;s.children[0].operational_quality.artifact_sha256=H(text);});const row=r.runtime.db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(r.q.task_id);r.input.expected_revision=JSON.parse(row.snapshot).revision;r.input.expected_snapshot_sha256=H(row.snapshot);r.input.children[0].native_receipt_sha256=H(await readFile(record.native_receipt));}
for(const literal of ['9007199254740993','9007199254740991.1','0.99999999999999999','1.0','1e0','1e999'])test(`numeric lexeme ${literal} cannot be rounded into retained value equivalence`,async t=>{const r=await fixture(t);await reboundSyntheticOutput(r,'{"n":'+literal+'}');await assert.rejects(r.runtime.recoverOwnerControl(r.input),/number_unproven/);assert.equal(r.calls.parent,0);assert.equal(r.runtime._load(r.q.task_id).state,'held');assert.equal(r.calls.execute,2);assert.equal(r.runtime.ownerControlRecoveries.size,0);});
test('safe integer values are accepted, but a different safe parent value is not',async t=>{for(const rewrite of [false,true]){const r=await fixture(t,{parentPatch:v=>{if(rewrite)v.output=v.output.replace('9007199254740991','9007199254740990');}});await reboundSyntheticOutput(r,'{"n":9007199254740991,"zero":0,"negative":-12}');if(rewrite)await assert.rejects(r.runtime.recoverOwnerControl(r.input),/parent_unverified/);else assert.equal((await r.runtime.recoverOwnerControl(r.input)).state,'completed');assert.equal(r.calls.execute,2);}});

test('proof recovery gateway is operator.write and registration alone dispatches nothing',async()=>{const methods=new Map();registerRCCRuntime({on(){},registerService(){},registerGatewayMethod(name,handler,options){methods.set(name,{handler,options});}});const method=methods.get('os1.rcc.recoverOwnerControl');assert.deepEqual(method.options,{scope:'operator.write',profileAccess:'independent'});let reply;await method.handler({params:{},respond(...args){reply=args;}});assert.equal(reply[0],false);assert.equal(reply[2].message,'rcc_request_rejected');});

// Retrospective tests exercise Core's transactional permit boundary with fake
// host proofs. The Swift extracted tests independently cover saved-time/lease
// validation. No real expired contract, SDK, model, or registry is touched.
function adoptionPermitFor(r, now=Date.now()) {
 const p=r.c.task_contract,owner=r.q.host_context.owner_policy;
 return {schema:1,kind:'retained_owner_collection_adoption_only',permit_id:r.input.recovery_id,
 task_id:r.input.task_id,request_sha256:r.input.request_sha256,expected_revision:r.input.expected_revision,
 expected_fingerprint:r.input.expected_fingerprint,expected_snapshot_sha256:r.input.expected_snapshot_sha256,
 issued_at_ms:now-1,expires_at_ms:now+120000,parent_contract_sha256:p.contract_sha256,
 parent_checker_sha256:H('parent-checker'),context_sha256:p.context_sha256,start_tree_sha256:p.start_tree_sha256,
 reference_policy_sha256:r.q.policy_sha256,source_fingerprint:r.q.source_fingerprint,
 owner_policy_source_sha256:owner?.sourceSHA256??null,owner_policy_projection_sha256:owner?.projectionSHA256??null,
 collection_manifest_sha256:p.owner_collection.manifest_sha256,historical_runtime_sha256:H(canonical(r.input.historical_runtime)),
 native_generation_calls:0,dispatch_calls:0,retry_calls:0,parity_state:'unverified',
 children:r.input.children.map((row,i)=>({id:row.id,attempt_id:row.attempt_id,native_receipt_sha256:row.native_receipt_sha256,
 witness_sha256:row.witness_sha256,contract_sha256:p.owner_collection.obligations[i].contract_sha256,
 verifier_sha256:p.owner_collection.obligations[i].verifier_sha256}))};
}
async function expiredClock(body) {
 const original=Date.now,now=original()+120000;
 Date.now=()=>now;
 try{return await body(now, original);}finally{Date.now=original;}
}
test('expired original collection plus fresh exact operator adoption permit can recover with no generation',async t=>{
 const r=await fixture(t);const originalContracts=clone(r.before.catalog.task_contract);
 await expiredClock(async now=>{
  r.input.adoption_permit=adoptionPermitFor(r,now);
  const v=await r.runtime.recoverOwnerControl(r.input);
  assert.equal(v.state,'completed');assert.equal(v.result.parity_state,'unverified');
  const s=r.runtime._load(r.q.task_id);assert.deepEqual(s.catalog.task_contract,originalContracts);
  assert.equal(s.native_dispatches,2);assert.equal(s.owner_control_recovery.native_generation_calls,0);
  assert.equal(s.owner_control_recovery.dispatch_calls,0);assert.equal(s.owner_control_recovery.retry_calls,0);
  assert.equal(s.owner_control_recovery.adoption_permit_sha256,H(canonical(r.input.adoption_permit)));
  assert.equal(r.calls.control,2);assert.equal(r.calls.parent,1);assert.equal(r.calls.execute,2);
 });
});
test('expired original without a fresh adoption permit stays held before any host proof',async t=>{
 const r=await fixture(t);await expiredClock(async()=>{await assert.rejects(r.runtime.recoverOwnerControl(r.input));});
 await assertUnchanged(r);assert.equal(r.calls.control,0);assert.equal(r.calls.parent,0);
});
for(const [name,change]of Object.entries({
 expired:p=>p.expires_at_ms=p.issued_at_ms, future:p=>{p.issued_at_ms+=10000;p.expires_at_ms+=10000;},
 tooLong:p=>p.expires_at_ms=p.issued_at_ms+300001, wrongID:p=>p.permit_id=randomUUID(),
 task:p=>p.task_id=randomUUID(), revision:p=>p.expected_revision++, request:p=>p.request_sha256=H('other'),
 fingerprint:p=>p.expected_fingerprint=H('other'), snapshot:p=>p.expected_snapshot_sha256=H('other'),
 contract:p=>p.parent_contract_sha256=H('other'), context:p=>p.context_sha256=H('other'),
 tree:p=>p.start_tree_sha256=H('other'), policy:p=>p.reference_policy_sha256=H('other'),
 source:p=>p.source_fingerprint=H('other'), owner:p=>p.owner_policy_source_sha256=H('other'),
 manifest:p=>p.collection_manifest_sha256=H('other'), archive:p=>p.historical_runtime_sha256=H('other'),
 child:p=>p.children[0].contract_sha256=H('other'), checker:p=>p.children[0].verifier_sha256=H('other'),
 receipt:p=>p.children[0].native_receipt_sha256=H('other'), witness:p=>p.children[0].witness_sha256=H('other'),
 generation:p=>p.native_generation_calls=1, dispatch:p=>p.dispatch_calls=1,retry:p=>p.retry_calls=1,
 parity:p=>p.parity_state='reference_equivalent', boolean:p=>p.issued_at_ms=true,extra:p=>p.approved=true,
 missing:p=>delete p.parent_checker_sha256
}))test(`retrospective permit ${name} is rejected without any host/model operation`,async t=>{
 const r=await fixture(t);await expiredClock(async now=>{r.input.adoption_permit=adoptionPermitFor(r,now);change(r.input.adoption_permit);await assert.rejects(r.runtime.recoverOwnerControl(r.input),/adoption_permit_invalid/);});
 await assertUnchanged(r);assert.equal(r.calls.control,0);assert.equal(r.calls.parent,0);
});
test('permit expiring during parent verification blocks final CAS without partial adoption',async t=>{
 let now=Date.now()+120000;const original=Date.now,wait=deferred(),entered=deferred();
 const r=await fixture(t,{parentWait:async()=>{entered.resolve();await wait.promise;}});Date.now=()=>now;
 try{r.input.adoption_permit=adoptionPermitFor(r,now);const pending=r.runtime.recoverOwnerControl(r.input);const rejection=assert.rejects(pending,/adoption_permit_invalid/);await entered.promise;now=r.input.adoption_permit.expires_at_ms;wait.resolve();await rejection;}finally{Date.now=original;}
 await assertUnchanged(r);assert.equal(r.calls.parent,1);
});
test('ordinary current execution collection remains expired even while retrospective permit exists',async t=>{
 const r=await fixture(t);await expiredClock(async now=>{r.input.adoption_permit=adoptionPermitFor(r,now);assert.equal(ownerCollectionFor(r.q,r.c),null);assert.equal(ownerCollectionFor(r.q,r.c,now),null);});
 await assertUnchanged(r);assert.equal(r.calls.control,0);
});
