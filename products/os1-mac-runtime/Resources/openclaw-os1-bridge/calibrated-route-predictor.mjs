/** Conditional P7 -> existing-selector projection. No model, fit, dispatch,
 * admission or quality certificate. Only the host loader's live capability can
 * supply evidence. Its protected, pre-outcome host record supplies features and
 * harness/capacity observations; native model names never fill missing fields.
 * The arithmetic projection is pure after that source/custody boundary.
 */
import {readCalibratedRouteEvidence} from './calibrated-route-evidence.mjs';
import {frozenRouteData} from './frozen-route-artifacts.mjs';
import {frozenRouteFeatureBucket} from './frozen-route-predictor.mjs';
import {digest, stableJSON, exactConfigFingerprint, candidatePoolFingerprint,
  RESOURCE_COMPONENTS, RESOURCE_UNIT, SCORE_SPACE, estimateTotalResources, selectJointRoute}
  from './joint-route-selector.mjs';

const predictors = new WeakSet(), inferences = new WeakSet();
const HASH = /^[a-f0-9]{64}$/;
const hash = x => typeof x === 'string' && HASH.test(x);
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const count = x => Number.isSafeInteger(x) && x >= 0;
const probability = x => Number.isFinite(x) && x >= 0 && x <= 1;
const need = (x, code) => {if (!x) throw Object.assign(new Error(code), {code});};
const freeze = x => {if (x && typeof x === 'object') {Object.values(x).forEach(freeze); Object.freeze(x);} return x;};
const equal = (a, b) => stableJSON(a) === stableJSON(b);
const CONFIG_KEYS = ['surface', 'transport', 'account_id', 'model', 'effort', 'tools', 'scope',
  'permission_profile', 'quota_pool', 'allowed_paths', 'configuration_sha256'];
const INPUT_KEYS = ['schema', 'now_ms', 'task', 'candidates', 'selection_policy', 'quality_reference',
  'execution_fallback', 'calibration', 'forecasts', 'host_evidence'];
const PREPARED_KEYS = ['selector_input', 'current_bindings', 'features', 'original_r0', 'task_boundary'];
const NATIVE_KEYS = ['config_sha256', 'harness_sha256', 'native_binary_sha256', 'native_instructions_sha256'];
const BINDING_KEYS = ['rcc_source_sha256', 'policy_sha256', 'environment_sha256', 'verifier_sha256',
  'reference_descriptor_sha256', 'candidate_pool_sha256', 'coverage_discriminator_sha256',
  'projection_instructions_sha256', 'workload_class', 'feature_schema_version', 'scope', 'native_harnesses'];
const CURRENT_KEYS = ['rcc_source_sha256', 'coverage_discriminator_sha256', 'native_harnesses'];
const configOf = c => Object.fromEntries(CONFIG_KEYS.map(k => [k, c[k]]));
const configHash = c => exactConfigFingerprint(configOf(c));

function contextBinding(prepared, context) {
  need(exact(prepared, PREPARED_KEYS) && exact(prepared.selector_input, INPUT_KEYS), 'cp_prepared_record_shape');
  const q = prepared.selector_input, t = q.task, c = context;
  need(exact(c, ['task', 'node', 'baseline_plan', 'catalog', 'baseline_candidate', 'reference_candidate', 'now_ms']) &&
    count(c.now_ms) && c.task?.mode === 'auto' && Array.isArray(c.task.material_refs) && c.task.material_refs.length === 0 &&
    c.node?.scope === 'read_only' && c.node.instruction === c.task.request &&
    Array.isArray(c.node.dependencies) && c.node.dependencies.length === 0 &&
    Array.isArray(c.node.owned_paths) && c.node.owned_paths.length === 0 &&
    Array.isArray(c.baseline_plan?.nodes) && c.baseline_plan.nodes.length === 1 &&
    c.baseline_plan.nodes[0].id === c.node.id && c.node.candidate_id === c.baseline_candidate?.id,
  'cp_original_readonly_auto_boundary');
  need(exact(prepared.task_boundary, ['mode', 'turn_index', 'plan_shape', 'source_policy', 'samples']) &&
    equal(prepared.task_boundary, {mode:'auto',turn_index:0,plan_shape:'single_original_request',
      source_policy:'no_external_material',samples:1}), 'cp_task_boundary_unsupported');
  need(t?.id === c.task.task_id && t.node_id === c.node.id && t.request_sha256 === c.task.request_sha256 &&
    t.source_snapshot_sha256 === c.task.source_fingerprint && t.policy_sha256 === c.task.policy_sha256 &&
    t.instructions_sha256 === c.task.policy_sha256 && t.plan_sha256 === digest(c.baseline_plan) &&
    t.scope === 'read_only' && (t.samples === undefined || t.samples === 1), 'cp_current_task_binding');
  need(exact(prepared.original_r0, ['candidate_id', 'config_sha256']) &&
    prepared.original_r0.candidate_id === c.baseline_candidate.id &&
    prepared.original_r0.config_sha256 === configHash(c.baseline_candidate) &&
    q.execution_fallback?.candidate_id === c.reference_candidate?.id &&
    q.quality_reference?.config_sha256 === configHash(c.reference_candidate) &&
    q.execution_fallback.config_sha256 === q.quality_reference.config_sha256,
  'cp_original_r0_or_frontier_binding');
  // Independent roles may name the same actual tuple; that does not waive
  // either source/resource binding or authorize aliasing a different tuple.
  need(Array.isArray(q.candidates) && q.candidates.length > 0 && q.candidates.length <= 32 &&
    Array.isArray(c.catalog?.candidates), 'cp_current_catalog_missing');
  // The host record cannot add, remove or reinterpret a catalog tuple.
  const actual = c.catalog.candidates.map(x => ({id:x.id,config_sha256:configHash(x)})).sort((a,b)=>a.id.localeCompare(b.id));
  const projected = q.candidates.map(x => ({id:x.id,config_sha256:exactConfigFingerprint(x.config)})).sort((a,b)=>a.id.localeCompare(b.id));
  need(equal(actual, projected), 'cp_current_catalog_changed');
  need(q.schema === 1 && count(q.now_ms) && q.now_ms <= c.now_ms &&
    q.calibration === null && q.forecasts === null && q.host_evidence === null,
  'cp_preoutcome_record_required');
  return q;
}

function prepareFromBundle(bundle, context) {
  need(Array.isArray(bundle.host_records), 'cp_host_record_missing');
  const matches = [];
  for (const r of bundle.host_records) {
    if (!exact(r, ['record_sha256', 'captured_at_ms', 'prepared']) || !hash(r.record_sha256) ||
        !count(r.captured_at_ms) || digest({captured_at_ms:r.captured_at_ms,prepared:r.prepared}) !== r.record_sha256 ||
        r.prepared?.selector_input?.now_ms !== r.captured_at_ms || r.captured_at_ms > context.now_ms) continue;
    try {contextBinding(r.prepared, context); matches.push(r.prepared);} catch { /* Other tasks are not this task. */ }
  }
  need(matches.length === 1, matches.length ? 'cp_host_record_ambiguous' : 'cp_host_record_missing_or_changed');
  return matches[0];
}

/** Real default host preparation: only the loader's protected record, never a
 * task-provided record, catalog-derived capacity or token-count approximation.
 * Missing records are a normal R0-preserving result. */
export function prepareCalibratedRouteRequest(evidence, context) {
  try {
    context = frozenRouteData(context);
    const bundle = readCalibratedRouteEvidence(evidence, {now_ms:context.now_ms});
    if (bundle === null) return null;
    return prepareFromBundle(bundle, context);
  } catch {return null;}
}
export function isCalibratedRoutePredictor(value) {return predictors.has(value);}
export function isCalibratedRouteInference(value) {return inferences.has(value);}

function partition(bundle, cell, config, task, now) {
  const rows = bundle.resource_partitions.filter(r => r.stratum_sha256 === cell.stratum_sha256 && r.config_sha256 === config);
  need(rows.length === 1, 'cp_resource_partition_missing_or_ambiguous');
  const p = rows[0];
  need(exact(p, ['stratum_sha256','config_sha256','components','basis_artifact_sha256','basis_sample_count']) &&
    exact(p.components, RESOURCE_COMPONENTS) && RESOURCE_COMPONENTS.every(k => Number.isFinite(p.components[k]) && p.components[k] >= 0) &&
    hash(p.basis_artifact_sha256) && count(p.basis_sample_count) && p.basis_sample_count > 0,
  'cp_resource_partition_invalid');
  // No allocation from the P7 scalar total, not even a presumed zero. These
  // complete component means were independently source-checked by the loader.
  const estimate = {unit:RESOURCE_UNIT,basis:'observed_history',accounting_scope:'disjoint_remaining_node_total_v1',
    basis_artifact_sha256:p.basis_artifact_sha256,basis_sample_count:p.basis_sample_count,
    config_sha256:config,task_sha256:digest(task),observed_at_ms:bundle.fit.assessed_at_ms,
    valid_until_ms:Math.min(bundle.valid_until_ms,bundle.policy.valid_until_ms),components:p.components};
  const result = estimateTotalResources(estimate,{samples:1,now_ms:now,config_sha256:config,task_sha256:digest(task)});
  need(result.known, 'cp_resource_partition_unmeasured');
  return {estimate,total:result.total};
}

function projection(bundle, prepared, context) {
  const q = contextBinding(prepared,context), now = context.now_ms, b = bundle.bindings, p = bundle.policy;
  need(['actual_evidence','synthetic_fixture'].includes(bundle.data_mode) &&
    bundle.fit?.data_mode === bundle.data_mode && bundle.fit.assessment === 'meets_preregistered_statistical_policy' &&
    bundle.fit.holdout_status === 'not_evaluated_by_producer' &&
    bundle.issued_at_ms <= now && now < bundle.valid_until_ms && now < p.valid_until_ms,
  'cp_evidence_not_qualified_or_stale');
  need(exact(b,BINDING_KEYS) && exact(prepared.current_bindings,CURRENT_KEYS) &&
    prepared.current_bindings.rcc_source_sha256 === b.rcc_source_sha256 &&
    prepared.current_bindings.rcc_source_sha256 === context.task.policy?.source_sha256 &&
    prepared.current_bindings.coverage_discriminator_sha256 === b.coverage_discriminator_sha256 &&
    equal(prepared.current_bindings.native_harnesses,b.native_harnesses) &&
    Array.isArray(b.native_harnesses) && b.native_harnesses.every(h=>exact(h,NATIVE_KEYS) && NATIVE_KEYS.every(k=>hash(h[k]))) &&
    new Set(b.native_harnesses.map(h=>h.config_sha256)).size === b.native_harnesses.length,
  'cp_current_native_or_source_binding');
  const t=q.task, reference=q.quality_reference, pool=candidatePoolFingerprint(q.candidates), referenceHash=digest(reference);
  need(t.policy_sha256 === b.policy_sha256 && t.environment_sha256 === b.environment_sha256 &&
    t.verifier_sha256 === b.verifier_sha256 && t.instructions_sha256 === b.projection_instructions_sha256 &&
    t.workload_class === b.workload_class && t.scope === b.scope && t.feature_schema_version === b.feature_schema_version &&
    referenceHash === b.reference_descriptor_sha256 && equal(reference,bundle.quality_reference) &&
    pool === b.candidate_pool_sha256 && bundle.fit.reference_descriptor_sha256 === referenceHash,
  'cp_current_regime_reference_or_pool_changed');
  const bucket=frozenRouteFeatureBucket(prepared.features,t);
  need(t.feature_sha256===bucket && prepared.features.source_state==='none' && prepared.features.material_count===0 &&
    prepared.features.dependency_count===0 && prepared.features.semantic_family_id===t.workload_class,
  'cp_sourcefree_feature_binding');
  need(exact(bundle.projection_policy,['point','lower','coverage_policy_sha256','uncertainty_policy_sha256','ood_policy_sha256']) &&
    bundle.projection_policy.point==='training_mle_v1' && bundle.projection_policy.lower==='minimum_training_point_and_calibration_bound_v1' &&
    ['coverage_policy_sha256','uncertainty_policy_sha256','ood_policy_sha256'].every(k=>hash(bundle.projection_policy[k])) &&
    p.ood_policy==='abstain_outside_exact_strata_v1', 'cp_projection_policy_unsupported');
  const native=new Map(b.native_harnesses.map(h=>[h.config_sha256,h]));
  const cells=bundle.fit.cells.filter(cell=>cell.feature_bucket_sha256===bucket &&
    cell.reference.config_sha256===reference.config_sha256 &&
    equal(cell.native_harness.reference,native.get(cell.reference.config_sha256)) &&
    equal(cell.native_harness.routed,native.get(cell.routed.config_sha256)) &&
    cell.regime.rcc_source_sha256===b.rcc_source_sha256 && cell.regime.policy_sha256===b.policy_sha256 &&
    cell.regime.environment_sha256===b.environment_sha256 && cell.regime.verifier_sha256===b.verifier_sha256 &&
    cell.regime.reference_descriptor_sha256===referenceHash && cell.regime.quality_metric_id===reference.metric_id &&
    cell.regime.metric_version===reference.metric_version);
  need(cells.length>0, 'cp_exact_stratum_uncovered');
  for(const cell of cells) {
    need(digest({feature_bucket_sha256:cell.feature_bucket_sha256,reference:cell.reference,routed:cell.routed,
      native_harness:cell.native_harness,regime:cell.regime})===cell.stratum_sha256 &&
      cell.train_count>=p.minimum_train_per_stratum && cell.calibration_count>=p.minimum_calibration_per_stratum &&
      cell.calibration_accepted_B===0, 'cp_cell_identity_or_floor_failed');
    for(const [label,target] of [['match',p.minimum_reference_match_lower_bound],['success',p.minimum_task_success_lower_bound]]) {
      const a=cell.calibration_assessment[label];
      need(probability(cell.fitted_bernoulli_mle[label]) && probability(a.one_sided_lower_bound) && a.one_sided_lower_bound>=target &&
        probability(a.brier_score) && a.brier_score<=p.maximum_brier_score && Number.isFinite(a.bias) && Math.abs(a.bias)<=p.maximum_absolute_bias,
      'cp_cell_calibration_policy_failed');
    }
  }
  // The frontier estimate is already explicitly selected in the protected host
  // record. Require exact matching source-qualified partition, not a guessed
  // cheapest reference mean or an invented ten-way split.
  const referenceEst=q.execution_fallback.resource_estimate;
  const frontierMatches=cells.map(cell=>partition(bundle,cell,reference.config_sha256,t,now))
    .filter(x=>equal(x.estimate,referenceEst));
  need(frontierMatches.length>=1,'cp_frontier_resource_not_source_bound');
  const frontier=frontierMatches[0];
  const r0cells=cells.filter(c=>c.routed.config_sha256===prepared.original_r0.config_sha256);
  // Only exact actual tuple identity permits the same qualified observation
  // to cover both roles. A third R0 tuple needs its own qualified cell/partition.
  const r0=prepared.original_r0.config_sha256===reference.config_sha256?frontier:
    r0cells.length===1?partition(bundle,r0cells[0],prepared.original_r0.config_sha256,t,now):null;
  need(r0!==null,'cp_original_r0_cost_uncovered');
  const expiry=Math.min(bundle.valid_until_ms,p.valid_until_ms), pp=bundle.projection_policy;
  const calibration={schema:1,id:'p7-'+bundle.manifest_sha256,version:'exact-stratum-projection-v1',status:'calibrated',
    score_space:SCORE_SPACE,threshold:p.minimum_reference_match_lower_bound,allowed_quality_gap:0,
    observed_at_ms:bundle.fit.assessed_at_ms,valid_until_ms:expiry,
    predictor:{id:bundle.fit.kind,version:'2',artifact_sha256:bundle.fit.training_model_sha256},
    ...bundle.lineage,coverage_policy_sha256:pp.coverage_policy_sha256,uncertainty_policy_sha256:pp.uncertainty_policy_sha256,
    ood_policy_sha256:pp.ood_policy_sha256,quality_metric_id:reference.metric_id,metric_version:reference.metric_version,
    reference_descriptor_sha256:referenceHash,policy_sha256:t.policy_sha256,workload_class:t.workload_class,scope:t.scope,
    feature_schema_version:t.feature_schema_version,environment_sha256:t.environment_sha256,instructions_sha256:t.instructions_sha256,
    verifier_sha256:t.verifier_sha256,candidate_pool_sha256:pool};
  const rows=[];
  for(const cell of cells) {
    const candidates=q.candidates.filter(c=>exactConfigFingerprint(c.config)===cell.routed.config_sha256);
    need(candidates.length===1,'cp_cell_candidate_missing_or_ambiguous');
    const candidate=candidates[0], cost=partition(bundle,cell,cell.routed.config_sha256,t,now);
    if(!(cost.total<r0.total && cost.total<frontier.total)) continue;
    const point=cell.fitted_bernoulli_mle.match;
    const lower=Math.min(point,cell.calibration_assessment.match.one_sided_lower_bound);
    const evidence=digest({manifest_sha256:bundle.manifest_sha256,stratum_sha256:cell.stratum_sha256,
      current_feature_bucket_sha256:bucket,reference_descriptor_sha256:referenceHash,candidate_pool_sha256:pool});
    rows.push({candidate_id:candidate.id,config_sha256:cell.routed.config_sha256,samples:1,score_space:SCORE_SPACE,
      match_probability:point,uncertainty:{state:'bounded',lower_bound:lower,policy_sha256:pp.uncertainty_policy_sha256},
      coverage:{state:'covered',policy_sha256:pp.coverage_policy_sha256,evidence_sha256:evidence},
      ood:{state:'in_distribution',policy_sha256:pp.ood_policy_sha256,evidence_sha256:evidence},resource_estimate:cost.estimate});
  }
  need(rows.length>0,'cp_no_supported_resource_improvement');
  const forecasts={schema:1,observed_at_ms:now,valid_until_ms:expiry,predictor:calibration.predictor,
    calibration_sha256:digest(calibration),task_sha256:digest(t),reference_descriptor_sha256:referenceHash,candidate_pool_sha256:pool,rows};
  const body={schema:1,manifest_sha256:bundle.manifest_sha256,data_mode:bundle.data_mode,proof_mode:bundle.proof_mode,
    training_model_sha256:bundle.fit.training_model_sha256,fit_sha256:digest(bundle.fit),
    p8_review_sha256:bundle.p8_review.evidence_sha256,promotion_review_sha256:bundle.promotion_review.evidence_sha256,
    task_sha256:digest(t),request_sha256:t.request_sha256,source_snapshot_sha256:t.source_snapshot_sha256,
    plan_sha256:t.plan_sha256,feature_bucket_sha256:bucket,reference_descriptor_sha256:referenceHash,candidate_pool_sha256:pool,
    calibration_sha256:digest(calibration),forecasts_sha256:digest(forecasts),observed_at_ms:now,valid_until_ms:expiry,
    original_r0:{...prepared.original_r0,resource_total:r0.total},
    frontier:{candidate_id:q.execution_fallback.candidate_id,config_sha256:reference.config_sha256,resource_total:frontier.total},
    score_semantics:'frozen_exact_stratum_empirical_estimate_not_per_task_guarantee',
    resource_scope:'single_native_attempt_including_children_plus_disjoint_host_overheads_v1',
    cell_assessments:cells.filter(c=>rows.some(r=>r.config_sha256===c.routed.config_sha256)).map(c=>({
      stratum_sha256:c.stratum_sha256,config_sha256:c.routed.config_sha256,
      task_success_mle:c.fitted_bernoulli_mle.success,task_success_lower_bound:c.calibration_assessment.success.one_sided_lower_bound,
      calibration_both_wrong:c.calibration_both_wrong,calibration_accepted_B:c.calibration_accepted_B})),
    predictor_inference_observed:true,model_calls:0};
  const receipt={...body,receipt_sha256:digest(body)};
  const host_evidence={schema:1,source:'host_artifact_validation',status:'validated',receipt_sha256:receipt.receipt_sha256,
    dataset_split_status:'disjoint_verified',rights_status:'cleared',holdout_status:'accepted',predictor_execution_status:'observed',
    observed_at_ms:now,valid_until_ms:expiry,calibration_sha256:digest(calibration),forecasts_sha256:digest(forecasts),
    task_sha256:digest(t),reference_descriptor_sha256:referenceHash,candidate_pool_sha256:pool};
  const selector_input={...q,now_ms:now,calibration,forecasts,host_evidence}, selection=selectJointRoute(selector_input);
  need(!selection.rejected.some(x=>x.candidate_id===prepared.original_r0.candidate_id),'cp_original_r0_ineligible');
  need(selection.decision==='candidate_proposal' && selection.selected.resource.known &&
    selection.selected.resource.total<r0.total && selection.selected.resource.total<frontier.total,
  'cp_selector_preserves_or_holds');
  return {selector_input,selection,receipt};
}

/** `prepare` is an optional trusted HOST constructor callback, not task JSON.
 * Omission uses the real protected-host-record path above. It never fabricates
 * a capacity, tokenizer, harness, dynamic quota observation or cost partition.
 * Core still rechecks this result before dispatch and owns original-R0 fallback.
 */
export function createCalibratedRoutePredictor(options={}) {
  const descriptors=plain(options)?Object.getOwnPropertyDescriptors(options):{};
  const evidence=Object.hasOwn(descriptors.evidence??{},'value')?descriptors.evidence.value:null;
  const prepare=Object.hasOwn(descriptors.prepare??{},'value')?descriptors.prepare.value:null;
  const infer=context=>{
    const finish=(reason,data=null,bundle=null)=>freeze({schema:1,status:data===null?'unmeasured':
      bundle.data_mode==='actual_evidence'?'qualified':'qualified_synthetic_fixture',reason,
      data_mode:bundle?.data_mode??null,proof_mode:bundle?.proof_mode??null,
      decision:data===null?'preserve_original_r0':'candidate_proposal',selector_input:data?.selector_input??null,
      selection:data?.selection??null,receipt:data?.receipt??null,predictor_inference_observed:data!==null,
      execution_authorized:false,live_route_change_authorized:false,quality_certificate:false,model_calls:0});
    try {
      context=frozenRouteData(context);
      const bundle=readCalibratedRouteEvidence(evidence,{now_ms:context.now_ms});
      need(bundle!==null,'cp_evidence_not_registered_or_fresh');
      need(prepare===null || typeof prepare==='function','cp_host_prepare_not_callable');
      const raw=prepare===null?prepareFromBundle(bundle,context):prepare(context);
      need(raw!==null && !raw?.then,'cp_host_preoutcome_record_missing');
      const prepared=frozenRouteData(raw);
      // Even a trusted callback cannot substitute an unregistered record.
      const protectedRecord=prepareFromBundle(bundle,context);
      need(equal(prepared,protectedRecord),'cp_host_record_not_protected_source');
      const data=projection(bundle,prepared,context), result=finish('exact_stratum_supported_lower_resource_projection',data,bundle);
      inferences.add(result); return result;
    } catch(error) {return finish(/^cp_[a-z0-9_]+$/.test(error?.code??'')?error.code:'cp_input_or_projection_invalid');}
  };
  predictors.add(infer);return Object.freeze(infer);
}
