// Independent integration audit proposal only. Fake executor; no provider/network/model calls.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRCCRuntime,hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
async function fixture(t,{certified=false,alwaysFail=false,unknown=false,effects='none',ended=true,budget=3}={}) {
 const root=await mkdtemp(join(tmpdir(),'rcc-resource-407-')); await chmod(root,0o700);
 for (const dir of ['quality-witnesses','native-receipts']) await mkdir(join(root,dir),{mode:0o700});
 t.after(()=>rm(root,{recursive:true,force:true}));
 const text='Read workload.json and return one feasible non-preemptive schedule.';
 const host={workspace:root,context:null,provider_preference:'auto',codex_session_id:null,claude_session_id:null,require_read_only:true,owner_policy:null};
 const req={schema:1,task_id:randomUUID(),request:text,objective:text,request_sha256:sha(text),source_fingerprint:hostContextFingerprint(host),policy_sha256:sha('policy'),mode:'auto',material_refs:[],host_context:host,policy:{source_sha256:sha('source'),projection_sha256:sha('policy'),text:'policy'},budget:{max_parallel:1,max_attempts:2,max_native_dispatches:budget,max_duration_ms:20000,max_cost_units:null}};
 function row(id,model,effort){const now=Date.now();return{id,surface:'codex',transport:'codex_app_server',account_id:'fixture',model,effort,tools:['read'],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:sha(id),availability:'available',availability_observed_at_ms:now-1,availability_valid_until_ms:now+60000,quota_remaining_fraction:.8,quota_observed_at_ms:now-1,quota_valid_until_ms:now+60000,quality_state:'policy_admitted',estimated_cost_units:1};}
 const tickets=[]; let decisions=0,verifications=0;
 const rt=await createRCCRuntime({stateDir:root,maximumWorkers:1,hostAutoPlan:true,
 // K4: a sound_full node verifier (registration probes it: it must reject its refutation and the Core nonce).
 ...(certified?{verifierRegistry:new Map([['fixture-sound',{id:'fixture-sound',scope:'read_only',surfaces:['agent'],soundness:'sound_full',applies:()=>true,
   verify:async input=>{verifications++;return{passed:['valid but partial reference','preserved invalid candidate'].includes(input.output)};},
   refutations:[{instruction:'fixture instruction',output:'fixture wrong answer'}]}]])}:{}),
 catalog:async task=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,candidates:[row('ref','gpt-6-astra','ultra'),row('cheap','gpt-6-luna','low')],model_tiers:{'gpt-6-astra':'frontier','gpt-6-luna':'fast'},native_reference_efforts:{codex:{'gpt-6-astra':'ultra','gpt-6-luna':'low'}},owner_scope:'read_only',chat_lane_eligible:false,request_class:'readonly_lookup'}),
 execute:async ticket=>{
   tickets.push(ticket); const failed=alwaysFail||tickets.length===1;
   const witnessPath=join(root,'quality-witnesses',ticket.attempt_id+'.json');
   await writeFile(witnessPath,JSON.stringify({check:'partial.schedule.capacity',failed:!unknown&&failed}),{mode:0o600,flag:'wx'});
   const q={schema:1,coverage:'partial',assessment_state:unknown?'unverified':failed?'mismatch':'unverified',contract_sha256:sha('contract'),witness_path:witnessPath,witness_sha256:sha(await readFile(witnessPath)),artifact_sha256:sha(ticket.attempt_id),workspace_after_sha256:sha('tree'),failed_check_ids:!unknown&&failed?['partial.schedule.capacity']:[],corrective_attempts:0,local_only_verified:false};
   const result={schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:effects,execution_verified:true,native_turn_terminated:ended,task_verified:false,task_quality:unknown?'unverified':failed?'failed':'execution_only',parity_state:'unverified',output:failed?'preserved invalid candidate':'valid but partial reference',native_receipt:join(root,'native-receipts',ticket.attempt_id+'.json'),operational_quality:q,...(unknown?{error:'native_operational_quality_unverified'}:{})};
   await writeFile(result.native_receipt,JSON.stringify(result),{mode:0o600,flag:'wx'}); return result;
 },decideOperationalQuality:async()=>{decisions++;throw Error('writer callback must not run');},verifyTask:async({task})=>({schema:1,task_id:task.task_id,task_verified:false,parity_state:'unverified',output:null,reason:'partial only'})});
 t.after(()=>rt.close()); await rt.submit(req);
 const done=await rt.wait({schema:1,task_id:req.task_id},{timeoutMs:5000});
 return{rt,req,done,tickets,decisions,verifications,root};
}
const configs=f=>f.tickets.map(t=>[t.selected_config.model,t.selected_config.effort]);
const child=f=>f.rt._load(f.req.task_id).children[0];
function disclosure(f,{checker=false}={}) {assert.equal(f.done.state,'returned_unverified');assert.equal(f.done.result.task_verified,false);assert.equal(f.done.result.parity_state,'unverified');assert.equal(child(f).state,'completed');assert.deepEqual(f.done.children[0].quality_disclosure.failed_check_ids,checker?[]:['partial.schedule.capacity']);if(checker)assert.equal(f.done.children[0].quality_disclosure.checker,'unavailable');}
test('R0: partial known mismatch alone cannot admit cheaper; reference once disclosed under R6',async t=>{const f=await fixture(t);assert.deepEqual(configs(f),[['gpt-6-astra','ultra']]);disclosure(f);assert.equal(f.done.result.output,'preserved invalid candidate');assert.equal(f.decisions,0);assert.equal(f.rt._load(f.req.task_id).native_dispatches,1);});
test('R9: independently certified cheap mismatch escalates once and preserves immutable failed receipt/witness',async t=>{const f=await fixture(t,{certified:true});assert.deepEqual(configs(f),[['gpt-6-luna','low'],['gpt-6-astra','ultra']]);assert(f.tickets.every(t=>t.instruction===f.req.request&&!t.quality_continuation));assert.equal(f.decisions,0);assert.equal(f.done.state,'returned_unverified');assert.equal(f.done.result.output,'valid but partial reference');assert.equal(f.done.result.task_verified,false);assert.equal(f.done.result.parity_state,'unverified');assert.equal(child(f).attempt_history.length,2);const raw=JSON.parse(await readFile(child(f).attempt_history[0].native_receipt));assert.equal(raw.output,'preserved invalid candidate');assert.equal(raw.operational_quality.failed_check_ids[0],'partial.schedule.capacity');assert.equal(sha(await readFile(raw.operational_quality.witness_path)),raw.operational_quality.witness_sha256);});
test('R6: second reference mismatch is disclosed, never a third provider call',async t=>{const f=await fixture(t,{certified:true,alwaysFail:true});assert.equal(f.tickets.length,2);disclosure(f);assert.equal(f.done.result.output,'preserved invalid candidate');assert.equal(child(f).attempt_history.length,2);assert.equal(f.rt._load(f.req.task_id).native_dispatches,2);});
test('R6: unavailable partial checker at reference is disclosed, no replay',async t=>{const f=await fixture(t,{unknown:true});assert.equal(f.tickets.length,1);disclosure(f,{checker:true});assert.equal(f.decisions,0);});
test('reported read-only effects cannot authorize replay or completed/disclosed child',async t=>{const f=await fixture(t,{effects:'possible'});assert.equal(f.tickets.length,1);assert.equal(f.done.state,'effects_uncertain');assert.equal(f.done.children[0].quality_disclosure,undefined);});
test('unterminated native turn quarantines instead of escalating or disclosing',async t=>{const f=await fixture(t,{ended:false});assert.equal(f.tickets.length,1);assert.equal(f.done.state,'effects_uncertain');assert.equal(f.done.children[0].quality_disclosure,undefined);});
test('native dispatch budget still blocks certified reference escalation',async t=>{const f=await fixture(t,{certified:true,budget:1});assert.equal(f.tickets.length,1);assert.equal(f.rt._load(f.req.task_id).native_dispatches,1);assert.equal(f.done.state,'held');assert.equal(f.done.result,null);});
