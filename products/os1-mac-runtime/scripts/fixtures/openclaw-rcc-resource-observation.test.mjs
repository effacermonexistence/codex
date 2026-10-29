// Real Core SQLite + production intent resolver, synthetic completions only.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRCCRuntime, hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {routingIntentResolver} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
const sha = x => createHash('sha256').update(x).digest('hex');
const policy = 'Synthetic test policy; original request and source authority remain fixed.';
const usage = {inputTokens: 10, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 0, totalTokens: 16};
const reply = u => ({provider:'ollama', model:'qwen3.5:4b', text:'{"kind":"ordinary"}',
  execution:{mode:'direct-provider',owner:{kind:'provider',id:'ollama'}},stopReason:'stop',usage:u});
const pause = ms => new Promise(r => setTimeout(r, ms));
async function setup(t, {needed=false, complete=async()=>reply(usage), prompt='Read the supplied fixture and explain its state.'}={}) {
 const dir=await mkdtemp(join(tmpdir(),'os1-resource-observation-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));
 const old=process.env.OS1_RCC_PUBLIC_POLICY;process.env.OS1_RCC_PUBLIC_POLICY=policy;
 t.after(()=>{if(old===undefined)delete process.env.OS1_RCC_PUBLIC_POLICY;else process.env.OS1_RCC_PUBLIC_POLICY=old;});
 const host={workspace:dir,context:null,provider_preference:'auto',codex_session_id:null,claude_session_id:null,require_read_only:true,owner_policy:null,explicit_routes:null};
 const task={schema:1,task_id:randomUUID(),request:prompt,request_sha256:sha(prompt),objective:prompt,policy_sha256:sha(policy),source_fingerprint:hostContextFingerprint(host),mode:'auto',material_refs:[],budget:{max_attempts:1,max_parallel:1,max_cost_units:null,max_duration_ms:20000},host_context:host,policy:{source_sha256:sha('source'),projection_sha256:sha(policy),text:policy}};
 const calls={model:0,native:0,catalog:0,execute:0};
 const native=async(_,{task:t,answer})=>{calls.native++;const base={schema:1,task_id:t.task_id,request_sha256:t.request_sha256,policy_sha256:t.policy_sha256,source_fingerprint:t.source_fingerprint,kind:needed&&!answer?'needs_model':'ordinary',routes:[],best_effort:false,notices:[],reason:null};return base.kind==='ordinary'?base:{...base,model_prompt:'Classify only.',model_input:'synthetic source',model_schema:{type:'object'},model_schema_json:'{"type":"object"}'};};
 const resolver=routingIntentResolver({native,complete:async p=>{calls.model++;return complete(p);}});
 const runtime=await createRCCRuntime({stateDir:dir,hostAutoPlan:true,resolveIntent:resolver,catalog:async t=>{calls.catalog++;const now=Date.now();return{schema:1,task_id:t.task_id,request_sha256:t.request_sha256,candidates:[{id:'fixture',surface:'codex',transport:'codex_app_server',account_id:'fixture',model:'fixture',effort:'medium',tools:[],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:sha('fixture'),availability:'available',availability_observed_at_ms:now-1,availability_valid_until_ms:now+60000,quota_remaining_fraction:1,quota_observed_at_ms:now-1,quota_valid_until_ms:now+60000,quality_state:'policy_admitted',estimated_cost_units:1}]};},execute:async ticket=>{calls.execute++;return{schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',output:'fixture answer',execution_verified:true,task_verified:false,task_quality:'execution_only',parity_state:'unverified',native_receipt:'/private/fixture/'+ticket.attempt_id,native_summary:null,usage:{input_tokens:100,output_tokens:5,cache_read_tokens:60,cache_write_tokens:0,provider_calls:1,duration_ms:1,metric:'native_usage_observation'}};}});
 t.after(()=>runtime.close());
 const stored=()=>{const db=new DatabaseSync(join(dir,'rcc-runtime.sqlite'),{readOnly:true});try{return JSON.parse(db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(task.task_id).snapshot);}finally{db.close();}};
 return {runtime,task,calls,stored};
}
async function run(f){await f.runtime.submit(f.task);return f.runtime.wait({schema:1,task_id:f.task.task_id},{timeoutMs:10000});}
test('production compiler bypass records zero local calls, keeps original request and native inclusive accounting',async t=>{
 const f=await setup(t),original=structuredClone(f.task),s=await run(f);assert.equal(s.state,'returned_unverified');assert.equal(f.calls.model,0);assert.equal(f.calls.execute,1);assert.deepEqual(f.stored().task,original);assert.equal(s.resource_usage.local_calls_started,0);assert.equal(f.stored().resource_events.filter(x=>x.state==='not_needed').length,1);assert.equal(s.resource_usage.plan_model_calls,0);assert.equal(s.resource_usage.total_tokens_observed,105);assert.equal(s.resource_usage.accounting_complete,true);
});
test('actual resolver callback lifecycle includes net local input plus cache exactly once',async t=>{
 const f=await setup(t,{needed:true}),s=await run(f);assert.equal(f.calls.model,1);assert.equal(f.calls.native,2);assert.deepEqual(f.stored().resource_events.map(x=>x.state),['started','completed']);assert.equal(s.resource_usage.local_tokens_observed,16);assert.equal(s.resource_usage.native_tokens_observed,105);assert.equal(s.resource_usage.total_tokens_observed,121);
});
test('failed local call stays unknown and never dispatches a native worker',async t=>{
 const f=await setup(t,{needed:true,complete:async()=>{throw Error('synthetic failure');}}),s=await run(f);assert.equal(s.state,'held');assert.equal(f.calls.execute,0);assert.deepEqual(f.stored().resource_events.map(x=>x.state),['started','failed']);assert.equal(s.resource_usage.local_calls_started,1);assert.equal(f.stored().resource_events.filter(x=>x.state==='failed'&&x.usage===null).length,1);assert.equal(s.resource_usage.total_tokens_observed,null);
});
test('valid answer with malformed telemetry is preserved while accounting becomes unavailable',async t=>{
 const f=await setup(t,{needed:true,complete:async()=>reply({...usage,inputTokens:-1})}),s=await run(f);assert.equal(s.state,'returned_unverified');assert.equal(f.calls.execute,1);assert.equal(s.resource_usage.total_tokens_observed,null);assert.equal(s.resource_usage.accounting_complete,false);assert.deepEqual(f.stored().resource_accounting_errors,['local_usage_observation_unavailable']);
});
test('late cancelled local return records consumed tokens without reviving the task',async t=>{
 let release;const p=new Promise(r=>release=r);const f=await setup(t,{needed:true,complete:()=>p});await f.runtime.submit(f.task);for(let i=0;i<100&&f.calls.model===0;i++)await pause(5);assert.equal(f.calls.model,1);f.runtime.cancel({schema:1,task_id:f.task.task_id});release(reply(usage));for(let i=0;i<100&&f.stored().resource_events.length<2;i++)await pause(5);const s=f.runtime.status({schema:1,task_id:f.task.task_id});assert.equal(s.state,'cancelled');assert.equal(f.calls.execute,0);assert.deepEqual(f.stored().resource_events.map(x=>x.state),['started','cancelled']);assert.equal(s.resource_usage.local_tokens_observed,16);
});
test('deterministic exact path proves zero model work without even invoking the compiler',async t=>{
 const f=await setup(t,{prompt:'1+1'}),s=await run(f);assert.equal(s.result.output,'2');assert.deepEqual(f.calls,{model:0,native:0,catalog:0,execute:0});assert.equal(s.resource_usage.total_tokens_observed,0);assert.equal(s.resource_usage.accounting_complete,true);assert.equal(f.stored().plan_provenance,'deterministic_no_model');
});
