// SYNTHETIC SOFTWARE CONTRACTS ONLY. No provider/model execution, real training
// result, production promotion, quota saving or externally certified quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeCalibratedRouteFixture} from './calibrated-route-evidence.synthetic.mjs';
import {readCalibratedRouteEvidence} from '../../Resources/openclaw-os1-bridge/calibrated-route-evidence.mjs';
import {createCalibratedRoutePredictor,prepareCalibratedRouteRequest,isCalibratedRoutePredictor,isCalibratedRouteInference}
  from '../../Resources/openclaw-os1-bridge/calibrated-route-predictor.mjs';
import {digest,exactConfigFingerprint,RESOURCE_UNIT,selectJointRoute} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
import {frozenRouteFeatureBucket} from '../../Resources/openclaw-os1-bridge/frozen-route-predictor.mjs';

const NOW=100_000, H=x=>digest('SYNTHETIC:'+x), copy=x=>structuredClone(x);
function fixture(t,{three_configs=true,recordChange=()=>{},contextChange=()=>{},floor='default',...options}={}) {
  const stateDir=fs.realpathSync(fs.mkdtempSync(join(tmpdir(),'os1-calibrated-predictor-')));fs.chmodSync(stateDir,0o700);
  t.after(()=>fs.rmSync(stateDir,{recursive:true,force:true}));
  let context,prepared;
  const result=writeCalibratedRouteFixture({stateDir,now_ms:NOW,three_configs,...options,prepareRecords:data=>{
    const {fit,bindings:b,features,referenceConfig,routedConfig}=data;
    const baselineConfig=floor==='routed'?routedConfig:floor==='reference'?referenceConfig:data.baselineConfig??referenceConfig;
    const configurations=[referenceConfig,routedConfig,...(data.baselineConfig?[data.baselineConfig]:[])];
    const unique=[...new Map(configurations.map(c=>[exactConfigFingerprint(c),c])).values()];
    const idFor=c=>c.model;
    const fresh={observed_at_ms:NOW-10,valid_until_ms:fit.valid_until_ms};
    const required=data.input.samples[0].projection.task;
    const candidates=unique.map(config=>({id:idFor(config),config,
      capabilities:{supported:true,config_sha256:exactConfigFingerprint(config),features:required.required_capabilities,
        max_context_tokens:1000,...fresh},availability:{state:'available',account_id:config.account_id,
        config_sha256:exactConfigFingerprint(config),observation_sha256:H('available-'+config.model),...fresh},
      quota:{state:'sufficient',account_id:config.account_id,quota_pool:config.quota_pool,observation_sha256:H('quota'),...fresh}}));
    const original={task_id:'SYNTHETIC-current-task',mode:'auto',request:'SYNTHETIC original request',
      request_sha256:H('current-request'),source_fingerprint:H('current-source'),policy_sha256:b.policy_sha256,
      material_refs:[],policy:{source_sha256:b.rcc_source_sha256}};
    const node={id:'SYNTHETIC-current-node',kind:'agent',candidate_id:idFor(baselineConfig),instruction:original.request,
      scope:'read_only',owned_paths:[],dependencies:[]};
    const baseline_plan={schema:1,nodes:[node]};
    context={task:original,node,baseline_plan,catalog:{candidates:candidates.map(c=>({id:c.id,...c.config}))},
      baseline_candidate:{id:idFor(baselineConfig),...baselineConfig},reference_candidate:{id:idFor(referenceConfig),...referenceConfig},now_ms:NOW};
    const task={...copy(required),id:original.task_id,node_id:node.id,request_sha256:original.request_sha256,
      source_snapshot_sha256:original.source_fingerprint,plan_sha256:digest(baseline_plan),instructions_sha256:b.projection_instructions_sha256};
    task.feature_sha256=frozenRouteFeatureBucket(features,task);
    const part=data.resource_partitions.find(p=>p.config_sha256===exactConfigFingerprint(referenceConfig));
    assert(part,'fixture must actually provide a verified frontier partition');
    const resource={unit:RESOURCE_UNIT,basis:'observed_history',accounting_scope:'disjoint_remaining_node_total_v1',
      basis_artifact_sha256:part.basis_artifact_sha256,basis_sample_count:part.basis_sample_count,
      config_sha256:part.config_sha256,task_sha256:digest(task),observed_at_ms:fit.assessed_at_ms,
      valid_until_ms:data.valid_until_ms??fit.valid_until_ms,components:part.components};
    const selector_input={schema:1,now_ms:NOW-1,task,candidates,
      selection_policy:{schema:1,id:'SYNTHETIC-selector',version:'1',policy_sha256:task.policy_sha256,
        requires_live_reference_fallback:true,max_samples:1},quality_reference:data.quality_reference,
      execution_fallback:{candidate_id:idFor(referenceConfig),config_sha256:exactConfigFingerprint(referenceConfig),
        quality_reference_sha256:digest(data.quality_reference),resource_estimate:resource},calibration:null,forecasts:null,host_evidence:null};
    prepared=copy({selector_input,current_bindings:{rcc_source_sha256:b.rcc_source_sha256,
      coverage_discriminator_sha256:b.coverage_discriminator_sha256,native_harnesses:b.native_harnesses},features,
      original_r0:{candidate_id:idFor(baselineConfig),config_sha256:exactConfigFingerprint(baselineConfig)},
      task_boundary:{mode:'auto',turn_index:0,plan_shape:'single_original_request',source_policy:'no_external_material',samples:1}});
    recordChange(prepared,data,context);
    contextChange(context);
    const captured_at_ms=prepared.selector_input.now_ms;
    return [{captured_at_ms,prepared,record_sha256:digest({captured_at_ms,prepared})}];
  }});
  context.now_ms=result.now_ms;
  return {...result,stateDir,context,prepared,predictor:createCalibratedRoutePredictor({evidence:result.capability})};
}
const preserved=r=>{
  assert.equal(r.status,'unmeasured');assert.equal(r.decision,'preserve_original_r0');
  assert.equal(r.selector_input,null);assert.equal(r.receipt,null);assert.equal(r.predictor_inference_observed,false);
  assert.equal(r.execution_authorized,false);assert.equal(r.live_route_change_authorized,false);assert.equal(r.quality_certificate,false);
  assert.equal(r.model_calls,0);assert.equal(isCalibratedRouteInference(r),false);
};

test('no capability, JSON copy or raw approved flag can produce a qualified forecast',()=>{
  for(const evidence of [null,{approved:true},{status:'validated',data_mode:'actual_evidence'}]) {
    const f=createCalibratedRoutePredictor({evidence});assert(isCalibratedRoutePredictor(f));preserved(f({now_ms:NOW}));
  }
  assert.equal(isCalibratedRoutePredictor(()=>{}),false);
});
test('real default preparation -> protected synthetic capability -> nonnull forecasts -> existing selector chooses strictly cheaper tuple',t=>{
  const f=fixture(t), r=f.predictor(f.context);
  assert.equal(r.status,'qualified_synthetic_fixture',r.reason);
  assert(isCalibratedRouteInference(r));assert.equal(isCalibratedRouteInference(copy(r)),false);
  assert.equal(r.data_mode,'synthetic_fixture');assert.equal(r.execution_authorized,false);assert.equal(r.quality_certificate,false);
  assert(r.selector_input.calibration);assert(r.selector_input.forecasts);assert(r.selector_input.host_evidence);
  assert.equal(digest(prepareCalibratedRouteRequest(f.capability,f.context)),digest(f.prepared));
  const again=selectJointRoute(r.selector_input);assert.equal(again.decision,'candidate_proposal');
  assert.notEqual(again.selected.candidate_id,r.receipt.original_r0.candidate_id);
  assert.notEqual(again.selected.candidate_id,r.receipt.frontier.candidate_id);
  assert(again.selected.resource.total<r.receipt.original_r0.resource_total);
  assert(again.selected.resource.total<r.receipt.frontier.resource_total);
  assert.equal(again.selected.samples,1);assert.equal(again.predictor_executed,false);
  for(const row of r.selector_input.forecasts.rows)assert(row.uncertainty.lower_bound<=row.match_probability);
  assert.equal(r.receipt.score_semantics,'frozen_exact_stratum_empirical_estimate_not_per_task_guarantee');
  assert(r.receipt.cell_assessments.every(x=>x.calibration_accepted_B===0));
  assert.equal(r.model_calls,0);assert(Object.isFrozen(r.selector_input.forecasts.rows[0]));
});
test('independent R0/frontier roles may share exact actual tuple, not arbitrary equivalence',t=>{
  const f=fixture(t,{three_configs:false,floor:'reference'}),r=f.predictor(f.context);
  assert.equal(r.status,'qualified_synthetic_fixture',r.reason);
  assert.equal(r.receipt.original_r0.config_sha256,r.receipt.frontier.config_sha256);
  assert(r.selection.selected.resource.total<r.receipt.original_r0.resource_total);
});
test('a no-op current cheapest tuple is not a resource improvement',t=>{
  const f=fixture(t,{three_configs:false,floor:'routed'});preserved(f.predictor(f.context));
});
test('custom host callback is real only when it returns the protected exact record',t=>{
  const f=fixture(t);
  const good=createCalibratedRoutePredictor({evidence:f.capability,prepare:()=>f.prepared});
  assert.equal(good(f.context).status,'qualified_synthetic_fixture');
  for(const prepare of [()=>null,async()=>f.prepared,()=>({...f.prepared,features:{...f.prepared.features,context_tokens:999}})])
    preserved(createCalibratedRoutePredictor({evidence:f.capability,prepare})(f.context));
});
test('serialized capability cannot retain source authority',t=>{
  const f=fixture(t);preserved(createCalibratedRoutePredictor({evidence:copy(f.capability)})(f.context));
});
for(const [name,change] of [
  ['different request',c=>c.task.request_sha256=H('changed-request')],
  ['different source',c=>c.task.source_fingerprint=H('changed-source')],
  ['different original plan',c=>c.baseline_plan.extra='changed'],
  ['next task UUID',c=>c.task.task_id='SYNTHETIC-new-task'],
  ['writer',c=>c.node.scope='workspace_write'],
  ['explicit task',c=>c.task.mode='explicit_routing_test'],
  ['external material',c=>c.task.material_refs=['private-source']],
  ['dependency',c=>c.node.dependencies=['other-node']],
  ['catalog model change',c=>c.catalog.candidates[1].model='SYNTHETIC-new-model'],
  ['baseline candidate change',c=>c.baseline_candidate.effort='ultra'],
  ['frontier config change',c=>c.reference_candidate.effort='low'],
])test(`exact protected record cannot be reused after ${name}`,t=>{
  const f=fixture(t),c=copy(f.context);change(c);preserved(f.predictor(c));
  assert.equal(prepareCalibratedRouteRequest(f.capability,c),null);
});
for(const [name,change] of [
  ['source unknown',p=>p.features.source_state='unknown'],
  ['post-outcome forged calibration',p=>p.selector_input.calibration={status:'calibrated'}],
  ['multi-sample',p=>p.task_boundary.samples=2],
  ['future turn',p=>p.task_boundary.turn_index=1],
  ['native harness changed',p=>p.current_bindings.native_harnesses[0].native_binary_sha256=H('foreign-binary')],
  ['missing quota',p=>p.selector_input.candidates[0].quota=null],
  ['stale capability',p=>p.selector_input.candidates[0].capabilities.valid_until_ms=NOW-1],
  ['frontier cost silently increased',p=>p.selector_input.execution_fallback.resource_estimate.components.routing_tokens++],
  ['frontier cost incomplete',p=>p.selector_input.execution_fallback.resource_estimate.components.retry_reserve_tokens=null],
  ['source/constraints feature mismatch',p=>p.features.requirement_count++],
])test(`source-bound record still cannot bypass projection gate: ${name}`,t=>{
  const f=fixture(t,{recordChange:change});preserved(f.predictor(f.context));
});
test('input getter is rejected without invocation or leaked error text',t=>{
  const f=fixture(t);let called=0;
  const c={...f.context,get task(){called++;throw Error('PRIVATE-SENTINEL');}};
  const r=f.predictor(c);preserved(r);assert.equal(called,0);assert(!JSON.stringify(r).includes('PRIVATE-SENTINEL'));
});
test('freshness recheck does not extend an expired artifact',t=>{
  const f=fixture(t),bundle=readCalibratedRouteEvidence(f.capability,{now_ms:f.context.now_ms});assert(bundle);
  preserved(f.predictor({...f.context,now_ms:bundle.valid_until_ms}));
});

test('frozen training outcomes actually change derived forecast, not a constant probability',t=>{
  const all=fixture(t),mixed=fixture(t,{p7_options:{trainSuccess:[true,false,true,false,true,false]}});
  const a=all.predictor(all.context),b=mixed.predictor(mixed.context);
  assert.equal(a.status,'qualified_synthetic_fixture',a.reason);assert.equal(b.status,'qualified_synthetic_fixture',b.reason);
  assert.equal(a.selection.selected.predicted_match,1);assert.equal(b.selection.selected.predicted_match,.5);
  assert.notEqual(a.receipt.training_model_sha256,b.receipt.training_model_sha256);
  assert.equal(b.receipt.cell_assessments[0].task_success_mle,.5);
  assert.equal(b.receipt.cell_assessments[0].calibration_accepted_B,0);
  assert(b.selection.selected.predicted_lower_bound<=.5);
});
test('source replacement after capability load revokes rather than using cached authority',t=>{
  const f=fixture(t);assert.equal(f.predictor(f.context).status,'qualified_synthetic_fixture');
  fs.appendFileSync(join(f.root,'resource-partitions.json'),'\n');
  preserved(f.predictor(f.context));assert.equal(prepareCalibratedRouteRequest(f.capability,f.context),null);
});
test('conservative projection clips a calibration bound above the frozen training point',t=>{
  const f=fixture(t,{p7_options:{trainSuccess:[true,false,false,false,false,false]}}),r=f.predictor(f.context);
  assert.equal(r.status,'qualified_synthetic_fixture',r.reason);
  const cell=f.fit.cells.find(c=>c.routed.config_sha256===exactConfigFingerprint(r.selection.selected.config));
  assert(cell);const point=cell.fitted_bernoulli_mle.match,cal=cell.calibration_assessment.match.one_sided_lower_bound;
  assert(cal>point);assert.equal(r.selection.selected.predicted_match,point);
  assert.equal(r.selection.selected.predicted_lower_bound,point);
});
