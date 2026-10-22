// Synthetic source-contract tests only. None is a provider call, calibration,
// raw receipt review, held-out proof, or permission to enable covered_live.
// SYNTHETIC ONLY. Source-shaped examples are not actual provider measurements.
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {digest} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
import {normalizeRoutingOutcome} from '../../Resources/openclaw-os1-bridge/routing-outcome.mjs';
import {produceOfflineRouteCalibration as produce, OFFLINE_CALIBRATION_FORMAT} from '../../Resources/openclaw-os1-bridge/offline-route-calibration.mjs';
import {frozenRouteFeatureBucket} from '../../Resources/openclaw-os1-bridge/frozen-route-predictor.mjs';
import {stableJSON} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
const blobs = new Map();
const blob = x => {const utf8 = typeof x === 'string' ? x : stableJSON(x); const sha256 = createHash('sha256').update(utf8).digest('hex'); blobs.set(sha256, {sha256, utf8}); return sha256;};

const H = x => blob(`SYNTHETIC:${x}`);
const UUID = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const policy = H('policy'), contract = H('contract');
function config(model, effort) {
  return {surface: 'codex', transport: 'codex_app_server', account_id: 'synthetic-account',
    model, effort, tools: ['read_file'], scope: 'read_only', permission_profile: 'read_only',
    quota_pool: 'openai_codex', allowed_paths: ['/synthetic-owned'],
    configuration_sha256: H(`${model}:${effort}:config`)};
}
const referenceConfig = config('SYNTHETIC-reference', 'ultra');
const routedConfig = config('SYNTHETIC-routed', 'low');
function arm(c) {
  return {candidate_id: c.model, configuration_sha256: c.configuration_sha256,
    config_sha256: digest(c), surface: c.surface, transport: c.transport, account_id: c.account_id,
    model: c.model, effort: c.effort, tools_sha256: digest(c.tools), instructions_sha256: H(`${c.model}:instructions`)};
}
function usage(n, total = 0) {
  if (total === null) return null;
  return {schema: 1, metric: 'native_usage_observation', source_receipt_sha256: H(`usage:${n}`),
    parent_scope: 'includes_children', children_coverage: 'complete_disjoint',
    parent: {execution_id: `execution-${n}`, parent_execution_id: null, basis: 'attempt_total',
      input_basis: 'includes_cache', output_basis: 'includes_reasoning', source_receipt_sha256: H(`usage-parent:${n}`),
      input_tokens: total, output_tokens: 0, reasoning_tokens: 0, cache_read_tokens: 0,
      cache_write_tokens: 0, provider_calls: 1, duration_ms: 10}, children: []};
}
function outcome(c, rawConfig, n, total, observedAt) {
  const attempt = UUID(n);
  const source = {schema: 1, origin: 'actual_execution', identity: {task_id: c.task_id, node_id: c.node_id,
    attempt_id: attempt, candidate_id: rawConfig.model, request_sha256: c.request_sha256,
    source_fingerprint: c.source_fingerprint, policy_sha256: policy,
    configuration_sha256: rawConfig.configuration_sha256, quality_contract_sha256: contract},
  provenance: {source_kind: 'core_settled_attempt', source_sha256: H(`receipt:${n}`), host_validated: true,
    observed_at_ms: observedAt},
  configs: {selected: rawConfig, acknowledged: structuredClone(rawConfig), observed: structuredClone(rawConfig)},
  native: {provider: 'openai', execution_id: `execution-${n}`, session_id: UUID(n+100), turn_id: UUID(n+200),
    record_sha256: H(`native:${n}`), turn_terminated: true},
  result: {status: 'succeeded', attempt_state: 'completed', dispatch_stage: 'dispatched', side_effects: 'none',
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    output_sha256: H(`output:${n}`), artifact_sha256: H(`artifact:${n}`), error_code: null,
    failure_category: null, http_status: null},
  adoption: {state: 'unknown', scope: 'task', final_for_scope: null}, checker: null, usage: usage(n, total)};
  if (source.usage) blob(source.usage);
  const r = normalizeRoutingOutcome(source); assert.equal(r.status, 'normalized', r.reason);
  return r;
}
function binding(r, a) {
  return {outcome_id: r.outcome_id, normalized_sha256: r.normalized_sha256,
    task_id: r.identity.task_id, node_id: r.identity.node_id, attempt_id: r.identity.attempt_id,
    candidate_id: r.identity.candidate_id, configuration_sha256: r.identity.configuration_sha256,
    config_sha256: r.selected_config.config_sha256, instructions_sha256: a.instructions_sha256,
    tools_sha256: a.tools_sha256, source_fingerprint: r.identity.source_fingerprint,
    execution_witness_sha256: r.native.record_sha256};
}
function build(specs, {proofMode = 'candidate_goldblind', rights = 'cleared', lineage = 'disjoint_verified',
  calibrated = false, origin = 'actual_execution', prefix = 'train', frozenAt = 1000, invalidSettlement = false, outcomeOffset = 0, settlementOffset = 50} = {}) {
  const case_manifest = specs.map((s, i) => ({case_id: `${prefix}-case-${i}`, split: s.split, origin,
    task_id: `${prefix}-task-${i}`, node_id: `${prefix}-node-${i}`, request_sha256: H(`${prefix}-request-${i}`),
    source_fingerprint: H(`${prefix}-source-fingerprint-${i}`), source_sha256: H(`${prefix}-source-${i}`),
    template_sha256: H(`${prefix}-template-${i}`), project_sha256: H(`${prefix}-project-${i}`)}));
  const card = {schema: 1, id: `SYNTHETIC-${prefix}`, source_commit: 'a'.repeat(40), frozen_at_ms: frozenAt,
    proof_mode: proofMode, policy_sha256: policy, quality_contract_sha256: contract,
    reference_policy_sha256: H('reference-policy'), candidate_pool_sha256: H('candidate-pool'),
    feature_schema_version: 'host_preoutcome_counts_v1', arms: {reference: arm(referenceConfig), routed: arm(routedConfig)},
    case_manifest, calibration: calibrated ? {status: 'externally_verified', artifact_sha256: H('calibration-artifact'), frozen_at_ms: 1500} :
      {status: 'unmeasured', artifact_sha256: null, frozen_at_ms: null},
    thresholds: {minimum_calibration_cases: 2, minimum_heldout_cases: 2, maximum_accepted_B: 0,
      maximum_task_failures: 0, require_complete_token_accounting: true},
    rights: {status: rights, evidence_sha256: rights === 'cleared' ? H('rights') : null},
    lineage_audit: {status: lineage, evidence_sha256: lineage === 'disjoint_verified' ? H('lineage') : null},
    gold_visible_before_final_lock: false, scorer_visible_before_final_lock: false};
  const records = [], results = [], cardHash = digest(card);
  for (let i = 0; i < specs.length; i++) {
    const c = case_manifest[i], s = specs[i], ref = outcome(c, referenceConfig, (i+outcomeOffset)*2+1+(prefix === 'train' ? 0 : 1000), s.refTokens ?? 100, invalidSettlement?1050:frozenAt+settlementOffset),
      routed = outcome(c, routedConfig, (i+outcomeOffset)*2+2+(prefix === 'train' ? 0 : 1000), s.routeTokens ?? 20, invalidSettlement?1050:frozenAt+settlementOffset);
    records.push(ref, routed);
    const choice = s.choice ?? 'routed', chosen = choice === 'reference' ? ref : routed,
      finalSuccess = choice === 'reference' ? s.ref : s.route, lockTime = frozenAt + 100;
    const adoption_reason = choice === 'reference' ? 'routed_rejected_fallback' : 'routed_accepted';
    const lockBody = {run_card_sha256: cardHash, case_id: c.case_id, choice, adoption_reason,
      chosen_outcome_id: chosen.outcome_id, chosen_artifact_sha256: chosen.result.artifact_sha256,
      locked_at_ms: lockTime};
    results.push({case_id: c.case_id, attempts: {reference: binding(ref, card.arms.reference),
      routed: binding(routed, card.arms.routed)},
      final_lock: {choice, adoption_reason, chosen_outcome_id: chosen.outcome_id, chosen_artifact_sha256: chosen.result.artifact_sha256,
        final_lock_sha256: digest(lockBody),
        lock_witness_sha256: H(`lock-witness-${i}`), locked_at_ms: lockTime,
        gold_visible_before_lock: false, scorer_visible_before_lock: false},
      grade: {source_kind: 'independent_final_evaluator', host_validated: true,
        evidence_sha256: H(`grade-${i}`), final_lock_sha256: digest(lockBody), task_id: c.task_id, assessed_at_ms: lockTime+10,
        reference_task_success: s.ref, routed_task_success: s.route,
        final_task_success: finalSuccess, reference_match: s.match ?? s.ref === s.route}});
  }
  return {schema: 1, run_card: card, run_card_sha256: cardHash, results,
    outcome_state: {schema: 1, records, quarantined: []}};
}

export function syntheticInput({n = 6, trainCases = n, calibrationCases = n, trainSuccess = true, calSuccess = true, calMatch = true, calReferenceSuccess = calSuccess, policyOverrides = {}, invalidCalibrationSettlement = false, calibrationCaptureOffset = 50, skipFitLock = false} = {}) {
  blobs.clear();
  const train = build(Array.from({length:trainCases}, (_,i) => ({split:'development', ref:true, route:Array.isArray(trainSuccess)?trainSuccess[i]:trainSuccess})),
    {proofMode:'internal_dev', prefix:'train', frozenAt:1000});
  // These are original synthetic run cards, not a retrospective rehash/split
  // of an already-frozen historical source run.
  const calibrationCards=[];
  for(let offset=0;offset<calibrationCases;offset+=32) calibrationCards.push(build(
    Array.from({length:Math.min(32,calibrationCases-offset)},()=>({split:'calibration',ref:calReferenceSuccess,route:calSuccess,match:calMatch})),
    {proofMode:'candidate_goldblind',prefix:offset===0?'cal':`cal-${offset}`,frozenAt:2000,
      invalidSettlement:invalidCalibrationSettlement,outcomeOffset:offset,settlementOffset:calibrationCaptureOffset}));
  const reference = {schema:1,id:'SYNTHETIC-reference',version:'1',policy_sha256:train.run_card.reference_policy_sha256,
    config_sha256:train.run_card.arms.reference.config_sha256,harness_sha256:H('reference-harness'),metric_id:'synthetic-quality',metric_version:'1'};
  const referenceSHA = blob(reference);
  const regime = {rcc_source_sha256:H('rcc'),policy_sha256:policy,environment_sha256:H('environment'),
    verifier_sha256:H('verifier'),quality_metric_id:'synthetic-quality',metric_version:'1',reference_descriptor_sha256:referenceSHA};
  const p = {schema:1,id:'SYNTHETIC-statistical-policy',version:'1',algorithm:OFFLINE_CALIBRATION_FORMAT,
    frozen_at_ms:900,fit_at_ms:1500,assessed_at_ms:2200,valid_until_ms:5000,feature_schema_version:'host_preoutcome_counts_v1',
    reference_descriptor_sha256:referenceSHA,minimum_train_per_stratum:2,minimum_calibration_per_stratum:2,
    minimum_reference_match_lower_bound:0,minimum_task_success_lower_bound:0,maximum_brier_score:1,maximum_absolute_bias:1,maximum_calibration_accepted_B:0,
    familywise_alpha:0.05,uncertainty_method:'one_sided_hoeffding_union_bound_v1',ood_policy:'abstain_outside_exact_strata_v1',
    iid_assumption_review_sha256:H('iid-review'),regime_sha256:digest(regime),...policyOverrides};
  const members=[], samples=[];
  for (const e of [train,...calibrationCards]) for (const c of e.run_card.case_manifest) {
    const row=e.results.find(r=>r.case_id===c.case_id);
    const constraints={scope:'read_only',required_tools:['read_file'],allowed_tools:['read_file'],allowed_paths:['/synthetic-owned'],
      required_capabilities:['read_file'],allowed_transports:['codex_app_server'],owner_constraints:null};
    const task={id:c.task_id,node_id:c.node_id,request_sha256:c.request_sha256,feature_schema_version:'host_preoutcome_counts_v1',
      source_snapshot_sha256:H(`${c.case_id}-snapshot`),policy_sha256:policy,plan_sha256:H(`${c.case_id}-plan`),
      instructions_sha256:H(`${c.case_id}-projection-instructions`),workload_class:'SYNTHETIC-family',context_tokens:10,environment_sha256:regime.environment_sha256,verifier_sha256:regime.verifier_sha256,...constraints};
    delete task.owner_constraints;
    const features={schema:1,version:'host_preoutcome_counts_v1',semantic_family_id:'SYNTHETIC-family',context_tokens:10,
      material_count:1,requirement_count:1,dependency_count:0,source_state:'provided',constraints_sha256:digest(constraints)};
    task.feature_sha256=frozenRouteFeatureBucket(features,task);
    const native_harness={}, resource={}, execution_windows={};
    for(const a of ['reference','routed']) {
      const record=e.outcome_state.records.find(r=>r.outcome_id===row.attempts[a].outcome_id);
      native_harness[a]={config_sha256:e.run_card.arms[a].config_sha256,harness_sha256:H(`${a}-harness`),
        native_binary_sha256:H(`${a}-binary`),native_instructions_sha256:e.run_card.arms[a].instructions_sha256};
      resource[a]={schema:1,scope:'single_native_attempt_including_children_plus_disjoint_host_overheads_v1',
        native_outcome_id:record.outcome_id,native_tokens:record.usage.total_tokens_observed,host_retry_count:0,
        overheads:{routing_tokens:3,verification_tokens:2,integration_tokens:1,other_disjoint_tokens:0},source_sha256:null};
      const {source_sha256,...resourceBody}=resource[a]; resource[a].source_sha256=blob(resourceBody);
      const window={schema:1,kind:'offline_native_execution_window_v1',task_id:record.identity.task_id,node_id:record.identity.node_id,
        attempt_id:record.identity.attempt_id,outcome_id:record.outcome_id,config_sha256:record.observed_config.config_sha256,
        configuration_sha256:record.identity.configuration_sha256,execution_id:record.native.execution_id,session_id:record.native.session_id,
        turn_id:record.native.turn_id,native_record_sha256:record.native.record_sha256,clock_basis:'source_observed_unix_epoch_ms',
        started_at_ms:e.run_card.frozen_at_ms+20,ended_at_ms:e.run_card.frozen_at_ms+40};
      execution_windows[a]={...window,source_sha256:blob(window)};
    }
    members.push({run_card_sha256:e.run_card_sha256,case_id:c.case_id,role:c.split==='development'?'train':'calibration',original_split:c.split});
    samples.push({run_card_sha256:e.run_card_sha256,case_id:c.case_id,projection:{features,task},captured_at_ms:e.run_card.frozen_at_ms-100,
      native_harness,regime,actual_task_evidence_sha256:blob({kind:'offline_preoutcome_task_binding_v1',case_id:c.case_id,task_id:c.task_id,node_id:c.node_id,
        request_sha256:c.request_sha256,source_fingerprint:c.source_fingerprint,projection_task_sha256:digest(task)}),feature_evidence_sha256:blob({schema:1,kind:'offline_preoutcome_feature_capture_v1',captured_at_ms:e.run_card.frozen_at_ms-100,projection:{features,task}}),
      review_sha256:H(`${c.case_id}-review`),resource,execution_windows});
  }
  const input={schema:1,kind:'os1_offline_calibration_input_v2',data_mode:'synthetic_fixture',operation:'assess',now_ms:2300,fit_lock:null,
    policy:p,assignment:{schema:1,policy_sha256:digest(p),frozen_at_ms:800,members,source_sha256:blob({schema:1,policy_sha256:digest(p),frozen_at_ms:800,members})},
    evidence:[train,...calibrationCards],samples,sources:[...blobs.values()]};
  if(skipFitLock)return input;
  const fitInput=structuredClone(input); fitInput.operation='fit'; fitInput.evidence=[train];
  fitInput.samples=fitInput.samples.filter(s=>s.run_card_sha256===train.run_card_sha256);
  fitInput.assignment.members=fitInput.assignment.members.filter(m=>m.role==='train');
  {const {source_sha256,...body}=fitInput.assignment;fitInput.assignment.source_sha256=blob(body);fitInput.sources=[...blobs.values()];}
  const r=produce(fitInput);
  if(r.status==='unsupported_policy_capacity')return input;
  assert(r.training_model_sha256,JSON.stringify(r));
  input.fit_lock={training_model_sha256:r.training_model_sha256,locked_at_ms:1500,witness_sha256:blob({kind:'offline_training_model_lock_v1',training_model_sha256:r.training_model_sha256,policy_sha256:digest(p),locked_at_ms:1500})};
  input.sources=[...blobs.values()]; return input;
}
