/**
 * P2: pure, advisory joint native model/effort selection. NOT wired to dispatch.
 * Mechanism: Microsoft BEST-Route Algorithm 1 (Ding et al., ICML 2025),
 * https://arxiv.org/html/2506.22716v1 ; source reference
 * https://github.com/microsoft/best-route-llm/tree/b13c5bdaaf9a87af7587a9a83afc9b7219c2509d .
 * Adapted from the independently implemented OS-1 selector laboratory. MIT
 * notice is retained below. No hosted weights, API adapter or entitlement.
 *
 * Input is an acyclic JSON value supplied by the trusted host, not model JSON.
 * Hash/status consistency does NOT prove that artifacts were actually read,
 * training happened, splits are disjoint, or an attestation is authentic. The
 * caller must independently validate those artifacts before invoking this
 * module. In this first, unwired version even a candidate_proposal cannot grant
 * admission: existing Core authority, live reference, reservation, native source
 * and result-adoption checks remain mandatory. No I/O, clock, model, reservation,
 * retry, execution or result verification occurs here.
 *
 * API: selectJointRoute({schema:1, now_ms, task, candidates, selection_policy,
 * quality_reference, execution_fallback, calibration, forecasts, host_evidence}).
 * quality_reference is the frozen comparison descriptor; execution_fallback is
 * an independently prebound current catalog candidate. They are never merged.
 * Initial sample budget is exactly one. Read-only no-live-fallback extensions
 * and operational calibrated-policy admission are deliberately NOT implemented.
 *
 * K10 (§2.4): selectCertifiedDescent is a separate pure ranking in the score
 * space check_acceptance_probability_v1, over a frozen per-stratum cost
 * policy (prepareCertifiedDescentPolicy). Core calls it per node, inside a set
 * F it has ALREADY admitted (the escalation reference fixed at bind plus that
 * pool's dispatchable certified rows); it never grants admission, never adds
 * a row, never accepts an answer, and returns only the id of an element it was
 * given. selectJointRoute above stays advisory.
 */
import {createHash} from 'node:crypto';

export const SCORE_SPACE = 'reference_match_probability_v1';
export const RESOURCE_UNIT = 'observed_token_estimate_v1';
const HASH = /^[a-f0-9]{64}$/;
const SCOPES = new Set(['read_only', 'workspace_write']);
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']);
const TRANSPORT_PAIRS = new Set([
  'local|local|none', 'codex|codex_app_server|openai_codex',
  'gpt-chat|codex_app_server|openai_codex',
  'claude|claude_cli|anthropic_shared', 'claude-chat|claude_cli|anthropic_shared',
]);
const CONFIG_KEYS = ['surface', 'transport', 'account_id', 'model', 'effort', 'tools',
  'scope', 'permission_profile', 'quota_pool', 'allowed_paths', 'configuration_sha256'];
export const RESOURCE_COMPONENTS = Object.freeze([
  'routing_tokens', 'input_tokens_per_sample', 'output_tokens_per_sample',
  'native_child_tokens_per_sample', 'tool_context_tokens_per_sample',
  'verification_tokens_per_sample', 'ranking_tokens', 'integration_tokens',
  'retry_reserve_tokens', 'queue_timeout_overhead_tokens',
]);
const TASK_HASHES = ['request_sha256', 'source_snapshot_sha256', 'feature_sha256',
  'policy_sha256', 'plan_sha256', 'environment_sha256', 'instructions_sha256', 'verifier_sha256'];
const CAL_HASHES = ['train_dataset_sha256', 'calibration_dataset_sha256', 'holdout_dataset_sha256',
  'split_audit_sha256', 'coverage_policy_sha256', 'uncertainty_policy_sha256', 'ood_policy_sha256'];
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const string = x => typeof x === 'string' && x.length > 0 && !x.includes('\0');
const hash = x => typeof x === 'string' && HASH.test(x);
const finite = x => typeof x === 'number' && Number.isFinite(x);
const nonnegative = x => finite(x) && x >= 0;
const probability = x => finite(x) && x >= 0 && x <= 1;
const strings = x => Array.isArray(x) && x.every(string) && new Set(x).size === x.length;
const contains = (a, b) => b.every(x => a.includes(x));
const sameSet = (a, b) => a.length === b.length && contains(a, b);
const exact = (x, keys) => plain(x) && sameSet(Object.keys(x), keys);
const copy = x => JSON.parse(JSON.stringify(x));
const ordered = (a, b) => a < b ? -1 : a > b ? 1 : 0;

// Deterministic JSON hashing, not an evidence authenticity mechanism. Reject
// values that JSON would silently turn into null/omit, including NaN/undefined.
export function stableJSON(value) {
  const seen = new Set();
  let nodes = 0;
  const visit = (v, depth) => {
    if (++nodes > 100_000 || depth > 64) throw new TypeError('bounded_json_required');
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (finite(v)) return JSON.stringify(v);
    if ((!plain(v) && !Array.isArray(v)) || seen.has(v) ||
        (Array.isArray(v) && (v.length > 100_000 || Object.keys(v).length !== v.length ||
          !Array.from({length: v.length}, (_, i) => Object.hasOwn(v, i)).every(Boolean))))
      throw new TypeError('plain_finite_json_required');
    seen.add(v);
    const result = Array.isArray(v) ? '[' + v.map(x => visit(x, depth + 1)).join(',') + ']' :
      '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + visit(v[k], depth + 1)).join(',') + '}';
    seen.delete(v);
    return result;
  };
  return visit(value, 0);
}
export function digest(value) { return createHash('sha256').update(stableJSON(value)).digest('hex'); }
export function exactConfigFingerprint(config) {
  if (!exact(config, CONFIG_KEYS)) throw new TypeError('exact_config_keys_required');
  return digest(Object.fromEntries(CONFIG_KEYS.map(k => [k, config[k]])));
}
export function candidatePoolFingerprint(candidates) {
  return digest(candidates.map(c => ({id: c.id, config_sha256: exactConfigFingerprint(c.config)}))
    .sort((a, b) => ordered(a.id, b.id)));
}
function fresh(x, now) {
  return plain(x) && Number.isSafeInteger(x.observed_at_ms) && x.observed_at_ms >= 0 &&
    Number.isSafeInteger(x.valid_until_ms) && x.observed_at_ms <= now &&
    x.valid_until_ms > now && x.valid_until_ms > x.observed_at_ms;
}
function validConfig(c) {
  return exact(c, CONFIG_KEYS) &&
    [c.surface, c.transport, c.account_id, c.model, c.quota_pool].every(string) &&
    EFFORTS.has(c.effort) && SCOPES.has(c.scope) && c.permission_profile === c.scope &&
    strings(c.tools) && strings(c.allowed_paths) && hash(c.configuration_sha256) &&
    TRANSPORT_PAIRS.has(`${c.surface}|${c.transport}|${c.quota_pool}`) &&
    (!['gpt-chat', 'claude-chat'].includes(c.surface) || (c.scope === 'read_only' && !c.tools.length));
}
function validTask(t) {
  if (!plain(t) || !string(t.id) || !string(t.node_id) || !TASK_HASHES.every(k => hash(t[k])) ||
      !string(t.feature_schema_version) || !string(t.workload_class) || !SCOPES.has(t.scope) ||
      !strings(t.required_tools) || !strings(t.allowed_tools) || !contains(t.allowed_tools, t.required_tools) ||
      !strings(t.allowed_paths) || !strings(t.required_capabilities) || !strings(t.allowed_transports) ||
      !Number.isSafeInteger(t.context_tokens) || t.context_tokens < 0 ||
      (t.samples !== undefined && t.samples !== 1)) return false;
  const o = t.owner_constraints;
  return o === undefined || (exact(o, ['allowed_surfaces', 'required_model', 'required_effort']) &&
    strings(o.allowed_surfaces) && o.allowed_surfaces.length > 0 &&
    (o.required_model === null || string(o.required_model)) &&
    (o.required_effort === null || EFFORTS.has(o.required_effort)));
}
function eligibility(candidate, task, now) {
  if (!validConfig(candidate?.config)) return ['invalid_exact_config_or_transport'];
  const c = candidate.config, reasons = [];
  if (!task.allowed_transports.includes(c.transport)) reasons.push('transport_not_permitted');
  if (c.scope !== task.scope) reasons.push('scope_mismatch');
  if (!contains(c.tools, task.required_tools) || !contains(task.allowed_tools, c.tools)) reasons.push('tools_mismatch');
  // This module does not canonicalize paths or infer subdirectory authority.
  if (!sameSet(c.allowed_paths, task.allowed_paths)) reasons.push('path_scope_mismatch');
  const owner = task.owner_constraints;
  if (owner && (!owner.allowed_surfaces.includes(c.surface) ||
      (owner.required_model !== null && owner.required_model !== c.model) ||
      (owner.required_effort !== null && owner.required_effort !== c.effort))) reasons.push('owner_constraint_mismatch');
  const cap = candidate.capabilities;
  if (!fresh(cap, now)) reasons.push('capability_snapshot_missing_stale_or_future');
  else {
    if (cap.supported !== true || cap.config_sha256 !== exactConfigFingerprint(c)) reasons.push('exact_config_unsupported');
    if (!strings(cap.features) || !contains(cap.features, task.required_capabilities)) reasons.push('required_capability_missing');
    if (!Number.isSafeInteger(cap.max_context_tokens) || cap.max_context_tokens < task.context_tokens)
      reasons.push('context_capacity_unknown_or_insufficient');
  }
  if (!fresh(candidate.availability, now) || candidate.availability.state !== 'available')
    reasons.push('availability_unknown_stale_or_unavailable');
  else if (candidate.availability.account_id !== c.account_id ||
      candidate.availability.config_sha256 !== exactConfigFingerprint(c) ||
      !hash(candidate.availability.observation_sha256)) reasons.push('availability_account_config_or_source_mismatch');
  // Neither unknown nor absent quota grants capacity. Local has no subscription
  // pool; all native proposals require fresh observed capacity and still need
  // the existing atomic host reservation immediately before dispatch.
  if (c.quota_pool !== 'none') {
    if (!fresh(candidate.quota, now)) reasons.push('quota_observation_missing_stale_or_future');
    else if (candidate.quota.account_id !== c.account_id || candidate.quota.quota_pool !== c.quota_pool ||
        !hash(candidate.quota.observation_sha256)) reasons.push('quota_account_pool_or_source_mismatch');
    else if (candidate.quota.state === 'exhausted') reasons.push('quota_exhausted');
    else if (candidate.quota.state !== 'sufficient') reasons.push('quota_unknown_or_invalid');
  }
  return reasons;
}
function validReference(r) {
  return exact(r, ['schema', 'id', 'version', 'policy_sha256', 'config_sha256', 'harness_sha256', 'metric_id', 'metric_version']) &&
    r.schema === 1 && [r.id, r.version, r.metric_id, r.metric_version].every(string) &&
    [r.policy_sha256, r.config_sha256, r.harness_sha256].every(hash);
}
function validPredictor(p) {
  return exact(p, ['id', 'version', 'artifact_sha256']) && string(p.id) && string(p.version) && hash(p.artifact_sha256);
}
function calibrationProblem(cal, task, reference, poolHash, now) {
  if (!plain(cal) || cal.schema !== 1 || !string(cal.id) || !string(cal.version) || cal.status !== 'calibrated')
    return 'calibration_missing_or_unmeasured';
  if (cal.score_space !== SCORE_SPACE || !probability(cal.threshold)) return 'calibration_score_or_threshold_invalid';
  if (!fresh(cal, now)) return 'calibration_stale_or_future';
  if (!validPredictor(cal.predictor) || !CAL_HASHES.every(k => hash(cal[k])) ||
      new Set([cal.train_dataset_sha256, cal.calibration_dataset_sha256, cal.holdout_dataset_sha256]).size !== 3)
    return 'calibration_provenance_invalid';
  if (cal.allowed_quality_gap !== 0) return 'calibration_allows_quality_regression';
  if (cal.reference_descriptor_sha256 !== digest(reference) || cal.quality_metric_id !== reference.metric_id ||
      cal.metric_version !== reference.metric_version) return 'calibration_reference_changed';
  if (cal.policy_sha256 !== task.policy_sha256 || cal.workload_class !== task.workload_class || cal.scope !== task.scope ||
      cal.feature_schema_version !== task.feature_schema_version || cal.environment_sha256 !== task.environment_sha256 ||
      cal.instructions_sha256 !== task.instructions_sha256 || cal.verifier_sha256 !== task.verifier_sha256)
    return 'calibration_task_regime_mismatch';
  if (cal.candidate_pool_sha256 !== poolHash) return 'calibration_candidate_pool_changed';
  return null;
}
function forecastsProblem(f, cal, taskHash, referenceHash, poolHash, now) {
  if (!plain(f) || f.schema !== 1 || !Array.isArray(f.rows) || !fresh(f, now)) return 'forecasts_missing_stale_or_future';
  if (!validPredictor(f.predictor) || f.calibration_sha256 !== digest(cal) || stableJSON(f.predictor) !== stableJSON(cal.predictor))
    return 'forecast_calibration_or_predictor_mismatch';
  if (f.task_sha256 !== taskHash || f.reference_descriptor_sha256 !== referenceHash || f.candidate_pool_sha256 !== poolHash)
    return 'forecast_task_reference_or_pool_mismatch';
  if (new Set(f.rows.map(r => r?.candidate_id)).size !== f.rows.length) return 'duplicate_forecast_tuple';
  return null;
}
function hostProblem(e, cal, forecasts, taskHash, referenceHash, poolHash, now) {
  if (!plain(e) || e.schema !== 1 || e.source !== 'host_artifact_validation' || e.status !== 'validated' ||
      !hash(e.receipt_sha256) || !fresh(e, now)) return 'host_evidence_missing_stale_or_unvalidated';
  if (e.calibration_sha256 !== digest(cal) || e.forecasts_sha256 !== digest(forecasts) ||
      e.task_sha256 !== taskHash || e.reference_descriptor_sha256 !== referenceHash || e.candidate_pool_sha256 !== poolHash)
    return 'host_evidence_binding_mismatch';
  if (e.dataset_split_status !== 'disjoint_verified' || e.rights_status !== 'cleared' ||
      e.holdout_status !== 'accepted' || e.predictor_execution_status !== 'observed')
    return 'host_evidence_provenance_not_validated';
  return null;
}

/** Non-overlapping token-equivalent observations, not dollars or quota credit.
 * Input/output already include their cached/reasoning subsets; do not add those
 * subsets again. native_child/tool/verification components must be disjoint from
 * them. This declaration still needs an actual host accounting receipt. */
export function estimateTotalResources(estimate, {samples = 1, now_ms, config_sha256, task_sha256} = {}) {
  const fail = reason => ({known: false, total: null, unit: RESOURCE_UNIT, reason});
  if (samples !== 1) return fail('initial_sample_budget_must_be_one');
  if (!plain(estimate) || estimate.unit !== RESOURCE_UNIT || estimate.basis !== 'observed_history' ||
      estimate.accounting_scope !== 'disjoint_remaining_node_total_v1' || !hash(estimate.basis_artifact_sha256) ||
      !Number.isSafeInteger(estimate.basis_sample_count) || estimate.basis_sample_count < 1 ||
      !Number.isSafeInteger(now_ms) || !fresh(estimate, now_ms)) return fail('resource_observation_missing_stale_or_invalid');
  if (!hash(config_sha256) || !hash(task_sha256) || estimate.config_sha256 !== config_sha256 || estimate.task_sha256 !== task_sha256)
    return fail('resource_binding_mismatch');
  if (!exact(estimate.components, RESOURCE_COMPONENTS) || !RESOURCE_COMPONENTS.every(k => nonnegative(estimate.components[k])))
    return fail('resource_component_unknown_or_invalid');
  const total = RESOURCE_COMPONENTS.reduce((sum, k) => sum + estimate.components[k], 0);
  if (!finite(total)) return fail('resource_overflow');
  return {known: true, total, unit: RESOURCE_UNIT, samples: 1, prompt_charged_times: 1,
    basis_artifact_sha256: estimate.basis_artifact_sha256,
    reason: 'observed_history_estimate_not_actual_usage_quota_or_dollars'};
}

export function selectJointRoute(input) {
  const audit = {schema: 1, advisory_only: true, execution_authorized: false, execution_performed: false,
    reservation_performed: false, quality_certificate: false, task_quality: 'unverified', parity: 'unverified',
    predictor_executed: false, evidence_consistency_only: true, live_route_change_authorized: false,
    requires_live_reference_fallback: true, samples: 1,
    integration_required: 'existing_core_admission_reference_pool_native_and_result_adoption_gates',
    decision: 'hold', reason: null, selected: null, rejected: [], eligible: []};
  const hold = reason => ({...audit, decision: 'hold', reason, selected: null});
  // This bounded JSON scan also prevents malformed numeric values being
  // silently hashed as null, or omitted fields inheriting an old identity.
  try { stableJSON(input); } catch { return hold('plain_finite_json_input_required'); }
  if (!plain(input) || input.schema !== 1 || !Number.isSafeInteger(input.now_ms) || input.now_ms < 0 ||
      !validTask(input.task) || !Array.isArray(input.candidates)) return hold('invalid_task_clock_or_candidates');
  const {task, candidates, quality_reference: reference, execution_fallback: fallback,
    selection_policy: policy, calibration, forecasts, host_evidence: evidence, now_ms: now} = input;
  if (validReference(reference)) audit.quality_reference = copy(reference);
  else return hold('invalid_quality_reference_descriptor');
  if (!exact(policy, ['schema', 'id', 'version', 'policy_sha256', 'requires_live_reference_fallback', 'max_samples']) ||
      policy.schema !== 1 || !string(policy.id) || !string(policy.version) || policy.policy_sha256 !== task.policy_sha256 ||
      policy.max_samples !== 1) return hold('invalid_initial_selection_policy');
  if (policy.requires_live_reference_fallback !== true) return hold(task.scope === 'workspace_write' ?
    'staged_writer_live_reference_required' : 'read_only_no_live_fallback_policy_not_implemented');
  if (!candidates.length || candidates.some(c => !plain(c) || !string(c.id)) ||
      new Set(candidates.map(c => c.id)).size !== candidates.length) return hold('empty_or_ambiguous_candidate_catalog');
  // Invalid rows are rejected, not allowed to contaminate a pool fingerprint.
  if (candidates.some(c => !exact(c.config, CONFIG_KEYS))) return hold('invalid_candidate_catalog_config_shape');
  const poolHash = candidatePoolFingerprint(candidates), taskHash = digest(task), referenceHash = digest(reference);
  Object.assign(audit, {candidate_pool_sha256: poolHash, task_sha256: taskHash,
    quality_reference_sha256: referenceHash, selection_policy_sha256: digest(policy)});
  if (!exact(fallback, ['candidate_id', 'config_sha256', 'quality_reference_sha256', 'resource_estimate']) ||
      !string(fallback.candidate_id) || !hash(fallback.config_sha256) || fallback.quality_reference_sha256 !== referenceHash)
    return hold('invalid_prebound_execution_fallback');
  audit.execution_fallback = {candidate_id: fallback.candidate_id, config_sha256: fallback.config_sha256,
    quality_reference_sha256: fallback.quality_reference_sha256};
  // Initial policy preserves the existing actual reference path. A different
  // execution fallback needs a separately adopted equivalence policy, not a
  // high forecast or a quality-reference descriptor silently overwritten.
  if (fallback.config_sha256 !== reference.config_sha256) return hold('fallback_not_bound_to_current_reference');
  const byId = new Map(candidates.map(c => [c.id, c])), ref = byId.get(fallback.candidate_id);
  if (!ref || !validConfig(ref.config) || exactConfigFingerprint(ref.config) !== fallback.config_sha256)
    return hold('prebound_execution_fallback_missing_or_changed');
  const admissible = new Map();
  for (const c of candidates) {
    const reasons = eligibility(c, task, now);
    if (reasons.length) audit.rejected.push({candidate_id: c.id, reasons});
    else admissible.set(c.id, c);
  }
  if (!admissible.has(ref.id)) return hold('live_reference_unavailable_or_incompatible');
  const resourceFor = (value, configHash) => estimateTotalResources(value, {
    now_ms: now, samples: 1, config_sha256: configHash, task_sha256: taskHash});
  const referenceResource = resourceFor(fallback.resource_estimate, fallback.config_sha256);
  const referenceOption = {candidate_id: ref.id, config: copy(ref.config), samples: 1, predicted_match: null,
    predicted_lower_bound: null, resource: referenceResource,
    quality_basis: 'prebound_reference_not_a_quality_guarantee', quota_state: ref.quota?.state ?? 'not_applicable'};
  const preserve = reason => ({...audit, decision: 'preserve_reference', reason, selected: referenceOption});
  let problem = calibrationProblem(calibration, task, reference, poolHash, now);
  if (problem) return preserve(problem);
  Object.assign(audit, {calibration_sha256: digest(calibration), threshold: calibration.threshold, score_space: SCORE_SPACE});
  problem = forecastsProblem(forecasts, calibration, taskHash, referenceHash, poolHash, now);
  if (problem) return preserve(problem);
  problem = hostProblem(evidence, calibration, forecasts, taskHash, referenceHash, poolHash, now);
  if (problem) return preserve(problem);
  audit.host_validation_receipt_sha256 = evidence.receipt_sha256;
  if (!referenceResource.known) return preserve('reference_resource_unknown_cannot_rank');
  const options = [referenceOption];
  for (const row of forecasts.rows) {
    const reject = reason => audit.rejected.push({candidate_id: row?.candidate_id ?? null, reasons: [reason]});
    if (!plain(row) || !string(row.candidate_id)) { reject('invalid_forecast_candidate_id'); continue; }
    if (row.samples !== undefined && row.samples !== 1) { reject('initial_sample_budget_must_be_one'); continue; }
    if (row.candidate_id === ref.id) { reject('reference_is_fixed_not_learned'); continue; }
    const candidate = admissible.get(row.candidate_id);
    if (!candidate) { reject('candidate_missing_or_hard_gate_rejected'); continue; }
    const configHash = exactConfigFingerprint(candidate.config);
    if (row.config_sha256 !== configHash) { reject('forecast_exact_config_changed'); continue; }
    if (row.score_space !== SCORE_SPACE) { reject('forecast_wrong_score_space'); continue; }
    if (!probability(row.match_probability)) { reject('quality_forecast_unknown_or_invalid'); continue; }
    if (!plain(row.uncertainty) || row.uncertainty.state !== 'bounded' ||
        row.uncertainty.policy_sha256 !== calibration.uncertainty_policy_sha256 ||
        !probability(row.uncertainty.lower_bound) || row.uncertainty.lower_bound > row.match_probability)
      { reject('forecast_uncertainty_unknown_or_invalid'); continue; }
    if (!plain(row.coverage) || row.coverage.state !== 'covered' ||
        row.coverage.policy_sha256 !== calibration.coverage_policy_sha256 || !hash(row.coverage.evidence_sha256))
      { reject('forecast_coverage_unknown_or_uncovered'); continue; }
    if (!plain(row.ood) || row.ood.state !== 'in_distribution' ||
        row.ood.policy_sha256 !== calibration.ood_policy_sha256 || !hash(row.ood.evidence_sha256))
      { reject('forecast_out_of_distribution_or_unknown'); continue; }
    if (row.uncertainty.lower_bound < calibration.threshold) { reject('quality_lower_bound_below_threshold'); continue; }
    const resource = resourceFor(row.resource_estimate, configHash);
    if (!resource.known) { reject(resource.reason); continue; }
    const option = {candidate_id: candidate.id, config: copy(candidate.config), samples: 1,
      predicted_match: row.match_probability, predicted_lower_bound: row.uncertainty.lower_bound,
      resource, quota_state: candidate.quota?.state ?? 'not_applicable',
      quality_basis: 'host_bound_calibrated_forecast_not_verified_output'};
    options.push(option);
    audit.eligible.push({candidate_id: candidate.id, config_sha256: configHash, samples: 1,
      predicted_match: option.predicted_match, predicted_lower_bound: option.predicted_lower_bound,
      total_resource_estimate: resource.total});
  }
  options.sort((a, b) => a.resource.total - b.resource.total ||
    Number(b.candidate_id === ref.id) - Number(a.candidate_id === ref.id) || ordered(a.candidate_id, b.candidate_id));
  const selected = options[0];
  return {...audit, decision: selected.candidate_id === ref.id ? 'preserve_reference' : 'candidate_proposal',
    reason: selected.candidate_id === ref.id ? 'no_quality_eligible_lower_total_resource_tuple' :
      'minimum_observed_total_resource_estimate_after_quality_threshold', selected};
}

// ---- K10 (§2.4): certified-descent cost ranking inside an admitted F ----
export const CHECK_ACCEPTANCE_SCORE_SPACE = 'check_acceptance_probability_v1';
const CHECK_LABEL_SPACE = 'check_acceptance_v1'; // the K9 per-attempt label space a producer fits
const CONTEXT_BUCKET_RULE = 'instruction_plus_context_utf8_bytes_v1';
const DESCENT_POLICY_KEYS = ['schema', 'score_space', 'label_score_space', 'id', 'version', 'resource_unit',
  'valid_from_ms', 'valid_until_ms', 'context_bucket_rule', 'context_bucket_upper_bytes', 'rows', 'policy_sha256'];
const DESCENT_ROW_KEYS = ['request_class', 'scope', 'admitted_by', 'check_id', 'turn', 'has_materials',
  'context_bucket', 'surface', 'quota_pool', 'model', 'effort', 'role', 'p_lower', 'basis_sample_count',
  'basis_artifact_sha256', 'components'];
const DESCENT_SOURCES = new Set(['contract', 'verifier']);
const TURNS = new Set(['first', 'not_first']);
// 2048 rows (about 27 JSON nodes each) stay inside stableJSON's 100,000-node
// bound, so every admissible policy can be hashed.
const MAX_DESCENT_POLICY_ROWS = 2048;
const MAX_CONTEXT_BUCKETS = 16;
const MAX_DESCENTS = 256;
// Prepared policy -> its stratum index. Module-private: a copy, a hand-built
// object or a later change to the caller's value never ranks anything.
const PREPARED_DESCENT_POLICIES = new WeakMap();
const optionalString = x => x === null || string(x);
const stratumKey = s => stableJSON([s.request_class, s.scope, s.admitted_by, s.check_id, s.turn, s.has_materials,
  s.context_bucket]);
const tupleKey = t => stableJSON([t.surface, t.quota_pool, t.model, t.effort]);
const componentSum = components => RESOURCE_COMPONENTS.reduce((sum, k) => sum + components[k], 0);

/** K10: validate a frozen check-acceptance cost policy v1 once (the caller
 * keeps the result; nothing is re-hashed per routing call). Pure. Returns a
 * frozen, module-branded {status:'active', sha256, id, version,
 * valid_from_ms, valid_until_ms, bounds, rows} or a frozen
 * {status:'inactive', reason}. A row is one tuple {surface, quota_pool,
 * model, effort} in one stratum {request_class, scope, admitted_by
 * (contract | verifier), check_id, turn, has_materials, context_bucket}: a
 * 'reference' row (p_lower null, no check cost) or a 'descent' row whose
 * verification_tokens_per_sample is its check's cost and whose p_lower is the
 * lower bound of that check accepting its answer. retry_reserve_tokens is
 * always 0: the ranking derives it. policy_sha256 is the digest of the policy
 * without that key (self-integrity, not provenance). */
export function prepareCertifiedDescentPolicy(raw) {
  const inactive = reason => Object.freeze({status: 'inactive', reason});
  if (!plain(raw)) return inactive('policy_missing_or_not_plain');
  if (!exact(raw, DESCENT_POLICY_KEYS)) return inactive('policy_shape_invalid');
  if (!Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > MAX_DESCENT_POLICY_ROWS)
    return inactive('policy_rows_count_invalid');
  try { stableJSON(raw); } catch { return inactive('policy_not_plain_finite_json'); }
  if (raw.score_space !== CHECK_ACCEPTANCE_SCORE_SPACE) return inactive('policy_score_space_invalid');
  if (raw.schema !== 1 || raw.label_score_space !== CHECK_LABEL_SPACE || !string(raw.id) || !string(raw.version) ||
      raw.resource_unit !== RESOURCE_UNIT || raw.context_bucket_rule !== CONTEXT_BUCKET_RULE || !hash(raw.policy_sha256))
    return inactive('policy_header_invalid');
  if (!Number.isSafeInteger(raw.valid_from_ms) || raw.valid_from_ms < 0 || !Number.isSafeInteger(raw.valid_until_ms) ||
      raw.valid_from_ms >= raw.valid_until_ms) return inactive('policy_window_invalid');
  const bounds = raw.context_bucket_upper_bytes;
  if (!Array.isArray(bounds) || bounds.length < 1 || bounds.length > MAX_CONTEXT_BUCKETS ||
      !bounds.every((b, i) => Number.isSafeInteger(b) && b >= 0 && (i === 0 || b > bounds[i - 1])))
    return inactive('policy_context_buckets_invalid');
  const index = new Map();
  for (const row of raw.rows) {
    if (!exact(row, DESCENT_ROW_KEYS) || !optionalString(row.request_class) || !SCOPES.has(row.scope) ||
        !DESCENT_SOURCES.has(row.admitted_by) || !optionalString(row.check_id) || !TURNS.has(row.turn) ||
        typeof row.has_materials !== 'boolean' || !Number.isSafeInteger(row.context_bucket) ||
        row.context_bucket < 0 || row.context_bucket > bounds.length ||
        ![row.surface, row.quota_pool, row.model].every(string) || !EFFORTS.has(row.effort) ||
        !['reference', 'descent'].includes(row.role) || !Number.isSafeInteger(row.basis_sample_count) ||
        row.basis_sample_count < 1 || !hash(row.basis_artifact_sha256) || !exact(row.components, RESOURCE_COMPONENTS) ||
        !RESOURCE_COMPONENTS.every(k => nonnegative(row.components[k])) || !finite(componentSum(row.components)))
      return inactive('policy_row_invalid');
    if (row.components.retry_reserve_tokens !== 0) return inactive('policy_row_retry_reserve_nonzero');
    if (row.role === 'reference' && (row.p_lower !== null || row.components.verification_tokens_per_sample !== 0))
      return inactive('policy_reference_row_invalid');
    if (row.role === 'descent' && !probability(row.p_lower)) return inactive('policy_descent_row_invalid');
    const stratum = stratumKey(row), tuple = tupleKey(row);
    if (!index.has(stratum)) index.set(stratum, new Map());
    if (index.get(stratum).has(tuple)) return inactive('policy_duplicate_row');
    index.get(stratum).set(tuple, Object.freeze({role: row.role, p_lower: row.p_lower,
      components: Object.freeze({...row.components})}));
  }
  const {policy_sha256: claimed, ...body} = raw;
  if (digest(body) !== claimed) return inactive('policy_hash_mismatch');
  const prepared = Object.freeze({status: 'active', sha256: claimed, id: raw.id, version: raw.version,
    valid_from_ms: raw.valid_from_ms, valid_until_ms: raw.valid_until_ms, bounds: Object.freeze([...bounds]),
    rows: raw.rows.length});
  PREPARED_DESCENT_POLICIES.set(prepared, index);
  return prepared;
}
export function isPreparedCertifiedDescentPolicy(value) { return PREPARED_DESCENT_POLICIES.has(value); }

/** K10: rank F by expected total tokens after the per-answer check. Pure.
 * F = `reference` (the escalation reference Core fixed at bind) plus
 * `descents` (Core's dispatchable certified rows of the pool R11 chose, in
 * TIER_ROUTES then catalog order), each {candidate_id, surface, quota_pool,
 * model, effort}. `stratum` = {request_class, scope, admitted_by, check_id,
 * turn, has_materials, context_bytes}. Inactive unless the policy is a
 * prepared active one, valid_from_ms <= now_ms < valid_until_ms, and EVERY
 * member of F has a row of its role in this stratum's bucket: an uncovered
 * tuple is never costed as zero nor dropped, the caller keeps TIER_ROUTES.
 * c_ref is the reference row's component sum; a descent's total is its
 * components (its check's cost included) with retry_reserve_tokens =
 * (1 - p_lower) * c_ref, the one escalation its check can still demand. The
 * smallest total wins; a tie keeps the reference, then input order. No
 * quality threshold: the check accepts each answer, this ranks only cost, and
 * the result is always an input id. */
export function selectCertifiedDescent({now_ms, policy, stratum, reference, descents} = {}) {
  const fixed = {execution_authorized: false, quality_certificate: false};
  const inactive = reason => ({decision: 'inactive', reason, ...fixed});
  const index = PREPARED_DESCENT_POLICIES.get(policy);
  if (index === undefined) return inactive(policy?.status === 'inactive' && typeof policy.reason === 'string' &&
    /^[a-z0-9_]{1,64}$/.test(policy.reason) ? policy.reason : 'policy_not_prepared');
  if (!Number.isSafeInteger(now_ms) || now_ms < policy.valid_from_ms || now_ms >= policy.valid_until_ms)
    return inactive('policy_outside_validity_window');
  if (!plain(stratum) || !optionalString(stratum.request_class) || !SCOPES.has(stratum.scope) ||
      !DESCENT_SOURCES.has(stratum.admitted_by) || !optionalString(stratum.check_id) || !TURNS.has(stratum.turn) ||
      typeof stratum.has_materials !== 'boolean' || !Number.isSafeInteger(stratum.context_bytes) ||
      stratum.context_bytes < 0) return inactive('stratum_invalid');
  const member = x => plain(x) && string(x.candidate_id) && [x.surface, x.quota_pool, x.model].every(string) &&
    EFFORTS.has(x.effort);
  if (!member(reference) || !Array.isArray(descents) || descents.length < 1 || descents.length > MAX_DESCENTS ||
      !descents.every(member) || new Set([reference, ...descents].map(x => x.candidate_id)).size !== descents.length + 1)
    return inactive('certified_set_invalid');
  const found = policy.bounds.findIndex(bound => stratum.context_bytes <= bound);
  const bucket = found === -1 ? policy.bounds.length : found;
  const rows = index.get(stratumKey({...stratum, context_bucket: bucket}));
  const rowOf = (x, role) => { const row = rows?.get(tupleKey(x)); return row?.role === role ? row : null; };
  const referenceRow = rowOf(reference, 'reference');
  if (referenceRow === null) return inactive('policy_reference_uncovered');
  const descentRows = descents.map(x => rowOf(x, 'descent'));
  if (descentRows.includes(null)) return inactive('policy_descent_uncovered');
  const cRef = componentSum(referenceRow.components);
  const totals = [{candidate_id: reference.candidate_id, role: 'reference', p_lower: null,
    components: {...referenceRow.components}, total: cRef}];
  descents.forEach((x, i) => {
    const row = descentRows[i];
    const components = {...row.components, retry_reserve_tokens: (1 - row.p_lower) * cRef};
    totals.push({candidate_id: x.candidate_id, role: 'descent', p_lower: row.p_lower, components,
      total: componentSum(components)});
  });
  if (!totals.every(option => finite(option.total))) return inactive('policy_total_overflow');
  // Strictly smaller only: the reference (first) wins a tie, then input order.
  const best = totals.reduce((a, b) => b.total < a.total ? b : a);
  const descent = best.role === 'descent';
  return {decision: descent ? 'descent' : 'reference',
    reason: descent ? 'lowest_expected_total_after_check' : 'certified_descent_not_cost_effective',
    candidate_id: best.candidate_id, policy_sha256: policy.sha256, score_space: CHECK_ACCEPTANCE_SCORE_SPACE,
    unit: RESOURCE_UNIT, context_bucket: bucket, totals, ...fixed};
}

/*
 * Copyright (c) Microsoft Corporation.
 * MIT License
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
