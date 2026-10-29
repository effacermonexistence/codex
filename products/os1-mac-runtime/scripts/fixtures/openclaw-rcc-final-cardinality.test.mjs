// Derived grammar/decoder regressions. Synthetic text only; no native/model/RPC.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {LOCAL_PLAN_RESPONSE_FORMAT, LOCAL_PLAN_KERNEL, LOCAL_PLAN_KERNEL_VERSION,
 LOCAL_PLAN_KERNEL_SHA256, createLocalPlanPlanner} from '../../Resources/openclaw-os1-bridge/local-plan-planner.mjs';
import {decodeLocalPlanProposal} from '../../Resources/openclaw-os1-bridge/local-plan-proposal.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const schema=LOCAL_PLAN_RESPONSE_FORMAT.properties.final_output_proposal;
// Generic test-only JSON-schema subset evaluator. Not imported by runtime,
// not a replacement for the existing grammar provider or strict P1 decoder.
function accepts(s,v){
 if(s.anyOf)return s.anyOf.some(b=>accepts(b,v));
 if(Object.hasOwn(s,'const')&&v!==s.const)return false;
 if(s.enum&&!s.enum.includes(v))return false;
 if(s.type==='null')return v===null;
 if(s.type==='object')return v!==null&&typeof v==='object'&&!Array.isArray(v)&&(s.required??[]).every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>Object.hasOwn(s.properties??{},k)?accepts(s.properties[k],v[k]):s.additionalProperties!==false);
 if(s.type==='array')return Array.isArray(v)&&(s.minItems===undefined||v.length>=s.minItems)&&(s.maxItems===undefined||v.length<=s.maxItems)&&(!s.uniqueItems||new Set(v.map(x=>JSON.stringify(x))).size===v.length)&&v.every(x=>accepts(s.items,x));
 if(s.type==='string')return typeof v==='string'&&(!s.pattern||new RegExp(s.pattern).test(v))&&(s.maxLength===undefined||v.length<=s.maxLength)&&(s.minLength===undefined||v.length>=s.minLength);
 return true;
}
function node(id,deps=[]){return{proposal_node_id:id,instruction:'Preserve the source boundary.',requirement_refs:['r1'],dependencies:deps,material_refs:[],proposed_candidate_id:null,proposed_scope:'read_only',proposed_owned_paths:[],required_output:'One source-grounded result.',check_refs:[],reason_code:'independent_work'};}
function proposal(mode='direct_child',count=1){const ids=Array.from({length:count},(_,i)=>'n'+i);const nodes=ids.map((id,i)=>node(id,mode==='integration_node'&&i===count-1?ids.slice(0,-1):[]));return{schema:2,kind:'untrusted_local_plan_proposal',nodes,final_output_proposal:{mode,node_ids:mode==='ordered_collection'?ids:[ids.at(-1)]}};}
test('disjoint complete final-mode branches match existing strict cardinality',()=>{
 assert.equal(schema.anyOf.length,3);assert.equal(Object.hasOwn(schema,'properties'),false);
 assert.deepEqual(schema.anyOf.map(s=>s.properties.mode.const),['direct_child','integration_node','ordered_collection']);
 for(const branch of schema.anyOf){assert.equal(branch.type,'object');assert.equal(branch.additionalProperties,false);assert.deepEqual(branch.required,['mode','node_ids']);assert.equal(branch.properties.node_ids.minItems,1);assert.equal(branch.properties.node_ids.maxItems,branch.properties.mode.const==='ordered_collection'?8:1);assert.equal(branch.properties.node_ids.uniqueItems,true);}
});
test('A3 failure-derived direct_child naming two nodes is rejected, not normalized',()=>{
 const p=proposal('ordered_collection',2);p.final_output_proposal={mode:'direct_child',node_ids:['n0','n1'],host_finalizer_candidate_id:null};const raw=JSON.stringify(p);
 assert.equal(accepts(schema,p.final_output_proposal),false);assert.throws(()=>decodeLocalPlanProposal(raw),{code:'final_cardinality'});assert.equal(JSON.stringify(p),raw);
});
for(const mode of['direct_child','integration_node','ordered_collection'])test('valid '+mode+' one-final form is unambiguous and decoder-compatible',()=>{
 const p=proposal(mode);assert.equal(accepts(schema,p.final_output_proposal),true);assert.equal(schema.anyOf.filter(b=>accepts(b,p.final_output_proposal)).length,1);assert.equal(JSON.stringify(decodeLocalPlanProposal(JSON.stringify(p))),JSON.stringify(p));
});
test('integration sink may cover dependent nodes but still names exactly one final ID',()=>{const p=proposal('integration_node',3);assert(accepts(schema,p.final_output_proposal));assert.equal(JSON.stringify(decodeLocalPlanProposal(JSON.stringify(p))),JSON.stringify(p));p.final_output_proposal.node_ids=['n1','n2'];assert.equal(accepts(schema,p.final_output_proposal),false);assert.throws(()=>decodeLocalPlanProposal(JSON.stringify(p)),{code:'final_cardinality'});});
for(const count of[1,2,8])test('ordered collection generation permits '+count+' independent IDs',()=>{const p=proposal('ordered_collection',count);assert(accepts(schema,p.final_output_proposal));assert.equal(JSON.stringify(decodeLocalPlanProposal(JSON.stringify(p))),JSON.stringify(p));});
for(const mode of['direct_child','integration_node','ordered_collection'])test('same optional finalizer hint shape retained for '+mode,()=>{for(const hint of[undefined,null,'writer_hint']){const f={mode,node_ids:['n0'],...(hint===undefined?{}:{host_finalizer_candidate_id:hint})};assert(accepts(schema,f));}for(const hint of[false,1,{},[], 'with spaces'])assert.equal(accepts(schema,{mode,node_ids:['n0'],host_finalizer_candidate_id:hint}),false);});
test('zero/nine/duplicate IDs, unknown mode and unknown authority fields remain invalid',()=>{for(const f of[{mode:'direct_child',node_ids:[]},{mode:'integration_node',node_ids:['a','b']},{mode:'ordered_collection',node_ids:Array.from({length:9},(_,i)=>'n'+i)},{mode:'ordered_collection',node_ids:['a','a']},{mode:'other',node_ids:['a']},{mode:'direct_child',node_ids:['a'],approved:true}])assert.equal(accepts(schema,f),false);});
test('generation cardinality does not loosen ordered all-independent host-order semantics',()=>{for(const mutate of[p=>p.nodes[1].dependencies=['n0'],p=>p.final_output_proposal.node_ids.reverse(),p=>p.final_output_proposal.node_ids.pop()]){const p=proposal('ordered_collection',2);mutate(p);assert(accepts(schema,p.final_output_proposal));assert.throws(()=>decodeLocalPlanProposal(JSON.stringify(p)),{code:'collection_requires_all_independent_in_host_order'});}});
function input(){const request='Preserve both independent outputs.';const policy='RCC original source and scope remain authoritative.';const binding={task_id:'task1',request_sha256:sha(request),source_fingerprint:sha('source'),policy_sha256:sha(policy),catalog_sha256:sha('catalog'),nonce:'nonce1'};return{hostProjection:{binding,request,objective:request,scope:'read_only',allowed_owned_paths:[],requirement_ids:['r1'],material_aliases:{},candidate_ids:['cfg1'],check_ids:[]},expectedBinding:structuredClone(binding),ownerPolicy:{source_sha256:sha('full-source'),projection_sha256:sha(policy),text:policy},projection:{requirements:[{id:'r1',text:request,status:'explicit'}],materials:[]}};}
test('real helper forwards exact conditional responseFormat to existing completion callback',async()=>{let called=0;const p=proposal('ordered_collection',2),f=input();const planner=createLocalPlanPlanner({complete:async q=>{called++;assert.equal(q.responseFormat.properties.nodes.items.properties.proposed_scope.const,'read_only');assert.deepEqual(q.responseFormat.required,LOCAL_PLAN_RESPONSE_FORMAT.required);assert.deepEqual(q.responseFormat.properties.final_output_proposal,schema);assert.equal(q.reasoning,'off');assert.equal(Object.hasOwn(q,'tools'),false);return{provider:'ollama',model:'qwen3.5:4b',responseModel:'qwen3.5:4b',stopReason:'stop',text:JSON.stringify(p),execution:{mode:'direct-provider',owner:{kind:'provider',id:'ollama'}}};}});const r=await planner(f);assert.equal(called,1);assert.equal(r.status,'proposal');assert.equal(JSON.stringify(r.proposal),JSON.stringify(p));assert.equal(r.execution_authorized,false);assert.equal(r.quality_parity_verified,false);});
test('invalid actual-shaped reply remains raw failed state after generation, never repaired',async()=>{const p=proposal('ordered_collection',2);p.final_output_proposal.mode='direct_child';const raw=JSON.stringify(p);const planner=createLocalPlanPlanner({complete:async()=>({provider:'ollama',model:'qwen3.5:4b',responseModel:'qwen3.5:4b',stopReason:'stop',text:raw,execution:{mode:'direct-provider',owner:{kind:'provider',id:'ollama'}}})});const r=await planner(input());assert.equal(r.status,'fallback_required');assert.equal(r.reason,'final_cardinality');assert.equal(r.raw_model_output,raw);assert.equal(r.raw_output_sha256,sha(raw));assert.equal(r.automatic_retry,false);});
test('kernel V4 and exact cardinality guidance have separate fixed identity from owner policy',()=>{assert.equal(LOCAL_PLAN_KERNEL_VERSION,'rcc-local-plan-kernel-v4');assert.equal(LOCAL_PLAN_KERNEL_SHA256,sha(LOCAL_PLAN_KERNEL));assert.match(LOCAL_PLAN_KERNEL,/direct_child or integration_node names exactly ONE node ID/);assert.match(LOCAL_PLAN_KERNEL,/ALL independent nodes in plan order/);const plugin=readFileSync(new URL('../../Resources/openclaw-os1-bridge/rcc-plugin.mjs',import.meta.url),'utf8');assert.match(plugin,/complete: request => plannerScope.runInAsyncScope\(\(\) => api\.runtime\.llm\.complete\(request\)\)/);});

async function capturedGeneration(f=input()){
 let request;const planner=createLocalPlanPlanner({complete:async q=>{request=q;return{provider:'ollama',model:'qwen3.5:4b',responseModel:'qwen3.5:4b',stopReason:'stop',text:JSON.stringify(proposal()),execution:{mode:'direct-provider',owner:{kind:'provider',id:'ollama'}}};}});
 await planner(f);assert(request);return request.responseFormat;
}
test('actual writer-failure-derived write scope/path/invented checks cannot be generated in RO preparation',async()=>{
 const s=await capturedGeneration(),p=s.properties.nodes.items.properties;
 assert.deepEqual(p.proposed_scope,{const:'read_only'});assert.equal(p.proposed_owned_paths.maxItems,0);assert.equal(p.check_refs.maxItems,0);
 assert.equal(accepts(p.proposed_scope,'workspace_write'),false);assert.equal(accepts(p.proposed_owned_paths,['workspace']),false);assert.equal(accepts(p.check_refs,['check_0','check_1','check_2']),false);
 assert(accepts(p.proposed_scope,'read_only'));assert(accepts(p.proposed_owned_paths,[]));assert(accepts(p.check_refs,[]));
});
test('per-request requirement/material/check generation enums are exact host IDs, never arbitrary labels',async()=>{
 const f=input();f.hostProjection.material_aliases={m1:'opaque:material'};f.hostProjection.check_ids=['c1','c2'];f.projection.materials=[{id:'m1',kind:'source',read_status:'unknown',label:'source label, not alias',authority_scope:'task_data',required:'unknown'}];
 const p=(await capturedGeneration(f)).properties.nodes.items.properties;
 assert.deepEqual(p.requirement_refs.items,{enum:['r1']});assert.deepEqual(p.material_refs.items,{enum:['m1']});assert.deepEqual(p.check_refs.items,{enum:['c1','c2']});
 assert.equal(accepts(p.requirement_refs,['invented']),false);assert.equal(accepts(p.material_refs,['source label, not alias']),false);assert.equal(accepts(p.check_refs,['check_0']),false);assert(accepts(p.check_refs,['c2']));
});
test('legacy write host retains authorized read/write scope and only exact admitted path hints',async()=>{
 const f=input();f.hostProjection.scope='workspace_write';f.hostProjection.allowed_owned_paths=['src/one.swift','docs/one.md'];const p=(await capturedGeneration(f)).properties.nodes.items.properties;
 assert.deepEqual(p.proposed_scope.enum,['read_only','workspace_write']);assert(accepts(p.proposed_scope,'workspace_write'));assert.deepEqual(p.proposed_owned_paths.items,{enum:['src/one.swift','docs/one.md']});assert(accepts(p.proposed_owned_paths,['src/one.swift']));assert.equal(accepts(p.proposed_owned_paths,['workspace']),false);
});
test('per-call schema is detached; narrower request cannot mutate global template or next host',async()=>{
 const original=JSON.stringify(LOCAL_PLAN_RESPONSE_FORMAT);const a=await capturedGeneration();assert(Object.isFrozen(a));const f=input();f.hostProjection.scope='workspace_write';f.hostProjection.allowed_owned_paths=['src/other.swift'];const b=await capturedGeneration(f);assert.deepEqual(b.properties.nodes.items.properties.proposed_scope.enum,['read_only','workspace_write']);assert.equal(JSON.stringify(LOCAL_PLAN_RESPONSE_FORMAT),original);assert.equal(a.properties.nodes.items.properties.proposed_scope.const,'read_only');
});
test('invalid generated reply still rejected by unchanged P1, not repaired to allowed host enums',async()=>{
 const p=proposal();p.nodes[0].proposed_scope='workspace_write';p.nodes[0].proposed_owned_paths=['workspace'];p.nodes[0].check_refs=['check_0'];const raw=JSON.stringify(p);const planner=createLocalPlanPlanner({complete:async()=>({provider:'ollama',model:'qwen3.5:4b',responseModel:'qwen3.5:4b',stopReason:'stop',text:raw,execution:{mode:'direct-provider',owner:{kind:'provider',id:'ollama'}}})});const r=await planner(input());assert.equal(r.status,'fallback_required');assert.equal(r.raw_model_output,raw);assert.equal(r.automatic_retry,false);assert.equal(r.execution_authorized,false);
});
