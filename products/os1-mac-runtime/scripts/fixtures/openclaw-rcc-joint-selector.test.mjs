// All inputs below are synthetic contract fixtures. Mock probabilities and
// attestation hashes are NOT measured model performance or real host receipts.
// No native/model/provider calls, task execution, training or reservation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digest, stableJSON, exactConfigFingerprint, candidatePoolFingerprint,
  selectJointRoute, estimateTotalResources, SCORE_SPACE, RESOURCE_UNIT, RESOURCE_COMPONENTS}
  from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';

const NOW = 1_000_000;
const times = () => ({observed_at_ms: NOW - 100, valid_until_ms: NOW + 1000});
const h = x => digest(`synthetic-only:${x}`);
const scope = 'read_only';
function config(model, effort = 'low', surface = 'codex', taskScope = scope) {
  const local = surface === 'local', claude = ['claude', 'claude-chat'].includes(surface);
  return {surface, transport: local ? 'local' : claude ? 'claude_cli' : 'codex_app_server',
    account_id: local ? 'synthetic-local' : claude ? 'synthetic-anthropic' : 'synthetic-openai',
    model, effort, tools: [], scope: taskScope, permission_profile: taskScope,
    quota_pool: local ? 'none' : claude ? 'anthropic_shared' : 'openai_codex',
    allowed_paths: [], configuration_sha256: h({model, effort, surface, taskScope})};
}
function candidate(id, model, effort = 'low', surface = 'codex', taskScope = scope) {
  const c = config(model, effort, surface, taskScope);
  return {id, config: c, capabilities: {supported: true, config_sha256: exactConfigFingerprint(c),
    features: ['text'], max_context_tokens: 32000, ...times()},
    availability: {state: 'available', account_id: c.account_id, config_sha256: exactConfigFingerprint(c),
      observation_sha256: h(`availability-${id}`), ...times()}, quota: {state: 'sufficient',
      account_id: c.account_id, quota_pool: c.quota_pool, observation_sha256: h(`quota-${c.account_id}-${c.quota_pool}`), ...times()}};
}
function resource(c, task, n = 1) {
  return {unit: RESOURCE_UNIT, basis: 'observed_history', accounting_scope: 'disjoint_remaining_node_total_v1',
    basis_artifact_sha256: h(`mock-history-${n}`), basis_sample_count: 20, ...times(),
    config_sha256: exactConfigFingerprint(c.config), task_sha256: digest(task), components: {
      routing_tokens: 2, input_tokens_per_sample: 100 * n, output_tokens_per_sample: 20 * n,
      native_child_tokens_per_sample: 7 * n, tool_context_tokens_per_sample: 10 * n,
      verification_tokens_per_sample: 5 * n, ranking_tokens: 1, integration_tokens: 3,
      retry_reserve_tokens: 4, queue_timeout_overhead_tokens: 5,
    }};
}
function row(c, task, cal, p, n = 1) {
  return {candidate_id: c.id, config_sha256: exactConfigFingerprint(c.config), samples: 1,
    score_space: SCORE_SPACE, match_probability: p,
    uncertainty: {state: 'bounded', lower_bound: p - .001, policy_sha256: cal.uncertainty_policy_sha256},
    coverage: {state: 'covered', policy_sha256: cal.coverage_policy_sha256, evidence_sha256: h('coverage')},
    ood: {state: 'in_distribution', policy_sha256: cal.ood_policy_sha256, evidence_sha256: h('ood')},
    resource_estimate: resource(c, task, n)};
}
function hostRebind(f) {
  Object.assign(f.host_evidence, {calibration_sha256: digest(f.calibration), forecasts_sha256: digest(f.forecasts),
    task_sha256: digest(f.task), reference_descriptor_sha256: digest(f.quality_reference),
    candidate_pool_sha256: candidatePoolFingerprint(f.candidates)});
  return f;
}
function forecastRebind(f) {
  Object.assign(f.forecasts, {calibration_sha256: digest(f.calibration), predictor: {...f.calibration.predictor},
    task_sha256: digest(f.task), reference_descriptor_sha256: digest(f.quality_reference),
    candidate_pool_sha256: candidatePoolFingerprint(f.candidates)});
  return hostRebind(f);
}
function poolRebind(f) {
  f.calibration.candidate_pool_sha256 = candidatePoolFingerprint(f.candidates);
  return forecastRebind(f);
}
function fixture() {
  const candidates = [candidate('reference', 'opaque-native-reference', 'ultra'),
    candidate('cheap', 'opaque-small', 'low'), candidate('other-provider', 'opaque-native-other', 'high', 'claude')];
  const task = {id: 'synthetic-task', node_id: 'node-1', request_sha256: h('original-request'),
    source_snapshot_sha256: h('host-verified-source'), feature_sha256: h('material-context'),
    policy_sha256: h('rcc-policy'), plan_sha256: h('host-plan'), environment_sha256: h('environment'),
    instructions_sha256: h('rcc-full-instructions'), verifier_sha256: h('existing-verifier'),
    feature_schema_version: 'fixture-features-v1', workload_class: 'fixture-text', scope,
    required_tools: [], allowed_tools: [], allowed_paths: [], required_capabilities: ['text'],
    allowed_transports: ['codex_app_server', 'claude_cli', 'local'], context_tokens: 1000};
  const quality_reference = {schema: 1, id: 'frozen-reference-policy', version: '1',
    policy_sha256: h('quality-reference-policy'), config_sha256: exactConfigFingerprint(candidates[0].config),
    harness_sha256: h('owner-full-reference-harness'), metric_id: 'fixture-completeness', metric_version: '1'};
  const selection_policy = {schema: 1, id: 'joint-shadow-v1', version: '1', policy_sha256: task.policy_sha256,
    requires_live_reference_fallback: true, max_samples: 1};
  const execution_fallback = {candidate_id: candidates[0].id, config_sha256: exactConfigFingerprint(candidates[0].config),
    quality_reference_sha256: digest(quality_reference), resource_estimate: resource(candidates[0], task, 10)};
  const calibration = {schema: 1, id: 'mock-calibration', version: '1', status: 'calibrated',
    score_space: SCORE_SPACE, threshold: .98, allowed_quality_gap: 0, ...times(),
    predictor: {id: 'mock-predictor-not-real-weights', version: '1', artifact_sha256: h('mock-predictor')},
    train_dataset_sha256: h('train'), calibration_dataset_sha256: h('calibrate'), holdout_dataset_sha256: h('holdout'),
    split_audit_sha256: h('split-audit'), coverage_policy_sha256: h('coverage-policy'),
    uncertainty_policy_sha256: h('uncertainty-policy'), ood_policy_sha256: h('ood-policy'),
    quality_metric_id: quality_reference.metric_id, metric_version: quality_reference.metric_version,
    reference_descriptor_sha256: digest(quality_reference), policy_sha256: task.policy_sha256,
    workload_class: task.workload_class, scope: task.scope, feature_schema_version: task.feature_schema_version,
    environment_sha256: task.environment_sha256, instructions_sha256: task.instructions_sha256,
    verifier_sha256: task.verifier_sha256, candidate_pool_sha256: candidatePoolFingerprint(candidates)};
  const forecasts = {schema: 1, ...times(), calibration_sha256: digest(calibration), predictor: {...calibration.predictor},
    task_sha256: digest(task), reference_descriptor_sha256: digest(quality_reference),
    candidate_pool_sha256: candidatePoolFingerprint(candidates),
    rows: [row(candidates[1], task, calibration, .99), row(candidates[2], task, calibration, .995, 3)]};
  const host_evidence = {schema: 1, source: 'host_artifact_validation', status: 'validated', receipt_sha256: h('MOCK-receipt'),
    dataset_split_status: 'disjoint_verified', rights_status: 'cleared', holdout_status: 'accepted',
    predictor_execution_status: 'observed', ...times()};
  return hostRebind({schema: 1, now_ms: NOW, task, candidates, quality_reference, selection_policy,
    execution_fallback, calibration, forecasts, host_evidence});
}
const selected = f => selectJointRoute(f).selected?.candidate_id;
const reasons = r => r.rejected.flatMap(x => x.reasons);
const unknown = reason => r => assert.equal(r.reason, reason);
function nativeOption(f, index, change) {
  const c = f.candidates[index];
  change(c.config);
  c.capabilities.config_sha256 = exactConfigFingerprint(c.config);
  Object.assign(c.availability, {account_id: c.config.account_id, config_sha256: exactConfigFingerprint(c.config)});
  if (c.quota) Object.assign(c.quota, {account_id: c.config.account_id, quota_pool: c.config.quota_pool,
    observation_sha256: h(`quota-${c.config.account_id}-${c.config.quota_pool}`)});
  const r = f.forecasts.rows.find(r => r.candidate_id === c.id);
  if (r) {
    r.config_sha256 = exactConfigFingerprint(c.config);
    r.resource_estimate.config_sha256 = r.config_sha256;
  }
  return poolRebind(f);
}

test('pure proposal selects minimum total resource only after quality threshold', () => {
  const f = fixture(), r = selectJointRoute(f);
  assert.equal(r.decision, 'candidate_proposal'); assert.equal(r.selected.candidate_id, 'cheap');
  assert.equal(r.selected.config.model, 'opaque-small'); assert.equal(r.selected.config.effort, 'low');
  assert.equal(r.eligible.length, 2); assert.equal(r.selected.samples, 1);
});
test('low point forecast cannot pass quality even with the lowest resources', () => {
  const f = fixture(); f.forecasts.rows[0].match_probability = .4; f.forecasts.rows[0].uncertainty.lower_bound = .3;
  hostRebind(f); assert.equal(selected(f), 'other-provider');
});
test('point .99 alone cannot substitute for calibrated uncertainty lower bound', () => {
  const f = fixture(); f.forecasts.rows[0].uncertainty.lower_bound = .7; hostRebind(f);
  assert.equal(selected(f), 'other-provider');
});
test('quality-target descriptor is separate and unchanged when fallback is unavailable', () => {
  const f = fixture(), original = structuredClone(f.quality_reference);
  f.candidates[0].quota.state = 'exhausted'; const r = selectJointRoute(f);
  assert.equal(r.decision, 'hold'); assert.equal(r.reason, 'live_reference_unavailable_or_incompatible');
  assert.deepEqual(r.quality_reference, original); assert.deepEqual(f.quality_reference, original);
});
test('no prebound fallback holds even if a cheaper alternative qualifies', () => {
  const f = fixture(); f.execution_fallback = null;
  assert.equal(selectJointRoute(f).reason, 'invalid_prebound_execution_fallback');
});
test('the selector never chooses a replacement fallback by name or high forecast', () => {
  const f = fixture(); f.execution_fallback.candidate_id = 'other-provider';
  f.execution_fallback.config_sha256 = exactConfigFingerprint(f.candidates[2].config);
  assert.equal(selectJointRoute(f).reason, 'fallback_not_bound_to_current_reference');
});
test('quality reference cannot be rewritten to fit exhausted capacity', () => {
  const f = fixture(); f.quality_reference.policy_sha256 = h('different-reference-policy');
  assert.equal(selectJointRoute(f).reason, 'invalid_prebound_execution_fallback');
});
test('read-only false-live-fallback extension is explicitly not implemented', () => {
  const f = fixture(); f.selection_policy.requires_live_reference_fallback = false;
  assert.equal(selectJointRoute(f).reason, 'read_only_no_live_fallback_policy_not_implemented');
});
test('workspace writer always requires live fallback even with calibrated self claims', () => {
  const f = fixture(); f.task.scope = 'workspace_write'; f.selection_policy.requires_live_reference_fallback = false;
  assert.equal(selectJointRoute(f).reason, 'staged_writer_live_reference_required');
});
test('missing calibration preserves the existing actual reference, not a guessed cheapest route', () => {
  const f = fixture(); f.calibration = null; const r = selectJointRoute(f);
  assert.equal(r.decision, 'preserve_reference'); assert.equal(r.selected.candidate_id, 'reference');
  assert.equal(r.reason, 'calibration_missing_or_unmeasured');
});
test('missing actual forecasts preserves reference', () => {
  const f = fixture(); f.forecasts = null;
  assert.equal(selectJointRoute(f).reason, 'forecasts_missing_stale_or_future');
});
test('missing actual host-validation witness does not accept a mock .99', () => {
  const f = fixture(); f.host_evidence = null;
  assert.equal(selectJointRoute(f).reason, 'host_evidence_missing_stale_or_unvalidated');
});
for (const [field, value] of [['dataset_split_status', 'unknown'], ['rights_status', 'unknown'],
  ['holdout_status', 'dev_only'], ['predictor_execution_status', 'self_reported']]) {
  test(`host provenance ${field}=${value} cannot promote a forecast`, () => {
    const f = fixture(); f.host_evidence[field] = value;
    assert.equal(selectJointRoute(f).reason, 'host_evidence_provenance_not_validated');
  });
}
for (const [name, change] of [
  ['unmeasured', f => { f.calibration.status = 'unmeasured'; }],
  ['same train/holdout', f => { f.calibration.holdout_dataset_sha256 = f.calibration.train_dataset_sha256; }],
  ['missing split audit', f => { delete f.calibration.split_audit_sha256; }],
  ['nonzero regression allowance', f => { f.calibration.allowed_quality_gap = .01; }],
  ['wrong probability score space', f => { f.calibration.score_space = 'p0_minus_p1'; }],
]) test(`invalid calibration ${name} preserves reference`, () => {
  const f = fixture(); change(f); forecastRebind(f); assert.equal(selected(f), 'reference');
});
for (const kind of ['calibration', 'forecasts', 'host_evidence']) {
  for (const [state, field, value] of [['expired', 'valid_until_ms', NOW], ['future', 'observed_at_ms', NOW + 1]]) {
    test(`${state} ${kind} cannot authorize descent`, () => {
      const f = fixture(); f[kind][field] = value;
      if (kind === 'calibration') forecastRebind(f);
      else if (kind === 'forecasts') hostRebind(f);
      assert.equal(selected(f), 'reference');
    });
  }
}
for (const field of ['request_sha256', 'source_snapshot_sha256', 'feature_sha256', 'plan_sha256',
  'instructions_sha256', 'verifier_sha256', 'environment_sha256', 'policy_sha256']) {
  test(`changed task ${field} invalidates old forecast or regime evidence`, () => {
    const f = fixture(); f.task[field] = h(`changed-${field}`); assert.notEqual(selected(f), 'cheap');
  });
}
test('same task but different node cannot reuse a prior node forecast', () => {
  const f = fixture(); f.task.node_id = 'another-node'; assert.equal(selected(f), 'reference');
});
test('changed candidate pool requires fresh calibration', () => {
  const f = fixture(); f.candidates.push(candidate('new', 'unseen', 'max'));
  assert.equal(selectJointRoute(f).reason, 'calibration_candidate_pool_changed');
});
test('changed instructions on an exact candidate invalidate the pool evidence', () => {
  const f = fixture(); f.candidates[1].config.configuration_sha256 = h('new-instructions');
  f.candidates[1].capabilities.config_sha256 = exactConfigFingerprint(f.candidates[1].config);
  assert.equal(selectJointRoute(f).reason, 'calibration_candidate_pool_changed');
});
test('changed effort cannot reuse a different effort row', () => {
  const f = fixture(); f.candidates[1].config.effort = 'medium';
  f.candidates[1].capabilities.config_sha256 = exactConfigFingerprint(f.candidates[1].config);
  f.candidates[1].availability.config_sha256 = exactConfigFingerprint(f.candidates[1].config); poolRebind(f);
  const r = selectJointRoute(f); assert.equal(r.selected.candidate_id, 'other-provider');
  assert.ok(reasons(r).includes('forecast_exact_config_changed'));
});
test('provider, model and effort are flat joint tuples without name/tier authority', () => {
  const f = fixture();
  // A max Anthropic tuple beats a low OpenAI tuple only because total resources
  // and measured-contract forecasts favor it, not because max has a fixed tier.
  nativeOption(f, 2, c => { c.effort = 'max'; c.model = 'the-same-name'; });
  nativeOption(f, 1, c => { c.effort = 'low'; c.model = 'the-same-name'; });
  f.forecasts.rows[1].resource_estimate = resource(f.candidates[2], f.task, .5); hostRebind(f);
  const r = selectJointRoute(f); assert.equal(r.selected.candidate_id, 'other-provider');
  assert.equal(r.selected.config.effort, 'max'); assert.equal(r.selected.config.transport, 'claude_cli');
});
test('all native tuple combinations can win from evidence, not fixed model tier', () => {
  for (const surface of ['codex', 'claude']) for (const effort of ['none', 'low', 'high', 'max', 'ultra']) {
    const f = fixture(); nativeOption(f, 1, c => {
      Object.assign(c, config(`arbitrary-${surface}-${effort}`, effort, surface));
    });
    const r = selectJointRoute(f); assert.equal(r.selected.candidate_id, 'cheap');
    assert.equal(r.selected.config.surface, surface); assert.equal(r.selected.config.effort, effort);
  }
});
test('native exact support witness, not effort vocabulary, decides support', () => {
  const f = fixture(); f.candidates[1].capabilities.supported = false;
  assert.equal(selected(f), 'other-provider');
});
for (const [name, change] of [
  ['expired capability', c => { c.capabilities.valid_until_ms = NOW; }],
  ['future capability', c => { c.capabilities.observed_at_ms = NOW + 1; }],
  ['capability hash mismatch', c => { c.capabilities.config_sha256 = h('other'); }],
  ['required feature missing', c => { c.capabilities.features = []; }],
  ['unknown context', c => { c.capabilities.max_context_tokens = null; }],
  ['insufficient context', c => { c.capabilities.max_context_tokens = 1; }],
  ['unknown availability', c => { c.availability.state = 'unknown'; }],
  ['stale availability', c => { c.availability.valid_until_ms = NOW; }],
  ['wrong availability account', c => { c.availability.account_id = 'different-account'; }],
  ['wrong availability config', c => { c.availability.config_sha256 = h('different'); }],
  ['missing availability config', c => { delete c.availability.config_sha256; }],
  ['missing availability source', c => { delete c.availability.observation_sha256; }],
  ['exhausted quota', c => { c.quota.state = 'exhausted'; }],
  ['unknown quota', c => { c.quota.state = 'unknown'; }],
  ['absent quota', c => { delete c.quota; }],
  ['stale quota', c => { c.quota.valid_until_ms = NOW; }],
  ['wrong quota account', c => { c.quota.account_id = 'another-account'; }],
  ['wrong quota pool', c => { c.quota.quota_pool = 'another-pool'; }],
  ['missing quota source receipt', c => { delete c.quota.observation_sha256; }],
]) test(`${name} excludes candidate, never assumes free or unlimited`, () => {
  const f = fixture(); change(f.candidates[1]); assert.equal(selected(f), 'other-provider');
});
test('unknown quota on the required live reference holds rather than substituting', () => {
  const f = fixture(); f.candidates[0].quota.state = 'unknown';
  assert.equal(selectJointRoute(f).decision, 'hold');
});
for (const [name, change] of [
  ['scope mismatch', c => { c.scope = c.permission_profile = 'workspace_write'; }],
  ['extra tool', c => { c.tools = ['shell']; }],
  ['extra path', c => { c.allowed_paths = ['/synthetic-unapproved']; }],
  ['API transport', c => { c.transport = 'openai_compatible'; }],
  ['separate ChatGPT pool fiction', c => { c.surface = 'gpt-chat'; c.quota_pool = 'free_chat'; }],
  ['Claude chat separate pool fiction', c => { c.surface = 'claude-chat'; c.transport = 'claude_cli'; c.quota_pool = 'claude_chat'; }],
]) test(`${name} cannot be granted by a forecast`, () => {
  const f = fixture(); nativeOption(f, 1, change); assert.equal(selected(f), 'other-provider');
});
test('gpt-chat through native Codex transport is explicitly still Codex funded', () => {
  const f = fixture(); nativeOption(f, 1, c => { c.surface = 'gpt-chat'; });
  assert.equal(selectJointRoute(f).selected.config.quota_pool, 'openai_codex');
});
test('foreign availability plus valid source hash cannot pass exact tuple binding', () => {
  const f = fixture(); Object.assign(f.candidates[1].availability, {
    account_id: 'DIFFERENT_ACCOUNT', config_sha256: exactConfigFingerprint(f.candidates[2].config),
    observation_sha256: h('foreign-availability-artifact')});
  const r = selectJointRoute(f); assert.equal(r.selected.candidate_id, 'other-provider');
  assert.ok(reasons(r).includes('availability_account_config_or_source_mismatch'));
});
test('changed exact config cannot inherit earlier availability under a recalibrated pool', () => {
  const f = fixture(); f.candidates[1].config.configuration_sha256 = h('changed-native-settings');
  f.candidates[1].capabilities.config_sha256 = exactConfigFingerprint(f.candidates[1].config);
  f.forecasts.rows[0].config_sha256 = exactConfigFingerprint(f.candidates[1].config); poolRebind(f);
  assert.ok(reasons(selectJointRoute(f)).includes('availability_account_config_or_source_mismatch'));
});
test('owner surface/model/effort constraints narrow both candidate and fallback', () => {
  const f = fixture(); f.task.owner_constraints = {allowed_surfaces: ['codex'], required_model: null, required_effort: null};
  // Rebind only actual task identities; no invented forecast remains eligible.
  forecastRebind(f);
  assert.equal(selected(f), 'reference'); // old estimate task binding is stale.
  f.execution_fallback.resource_estimate = resource(f.candidates[0], f.task, 10);
  f.forecasts.rows[0].resource_estimate = resource(f.candidates[1], f.task); hostRebind(f);
  assert.equal(selected(f), 'cheap');
  f.task.owner_constraints.required_effort = 'high';
  assert.equal(selectJointRoute(f).decision, 'hold');
});
for (const [name, change, reason] of [
  ['OOD', r => { r.ood.state = 'out_of_distribution'; }, 'forecast_out_of_distribution_or_unknown'],
  ['unknown OOD', r => { r.ood = null; }, 'forecast_out_of_distribution_or_unknown'],
  ['uncovered', r => { r.coverage.state = 'uncovered'; }, 'forecast_coverage_unknown_or_uncovered'],
  ['missing uncertainty', r => { delete r.uncertainty; }, 'forecast_uncertainty_unknown_or_invalid'],
  ['wrong coverage policy', r => { r.coverage.policy_sha256 = h('different'); }, 'forecast_coverage_unknown_or_uncovered'],
  ['lower bound exceeds point', r => { r.uncertainty.lower_bound = 1; }, 'forecast_uncertainty_unknown_or_invalid'],
  ['null prediction', r => { r.match_probability = null; }, 'quality_forecast_unknown_or_invalid'],
  ['wrong score space', r => { r.score_space = 'p0_minus_p1'; }, 'forecast_wrong_score_space'],
]) test(`${name} remains ineligible despite plausible point forecast`, () => {
  const f = fixture(); change(f.forecasts.rows[0]); hostRebind(f); const r = selectJointRoute(f);
  assert.equal(r.selected.candidate_id, 'other-provider'); assert.ok(reasons(r).includes(reason));
});
test('every resource component, retry and integration counts toward total', () => {
  const f = fixture(), e = f.forecasts.rows[0].resource_estimate;
  const r = estimateTotalResources(e, {now_ms: NOW, samples: 1,
    config_sha256: exactConfigFingerprint(f.candidates[1].config), task_sha256: digest(f.task)});
  assert.equal(r.total, 157); assert.equal(r.prompt_charged_times, 1);
  assert.equal(r.reason, 'observed_history_estimate_not_actual_usage_quota_or_dollars');
});
test('cheap direct result loses when retry/integration overhead is larger', () => {
  const f = fixture(); f.forecasts.rows[0].resource_estimate.components.retry_reserve_tokens = 500;
  f.forecasts.rows[0].resource_estimate.components.integration_tokens = 500; hostRebind(f);
  assert.equal(selected(f), 'other-provider');
});
for (const key of RESOURCE_COMPONENTS) test(`unknown ${key} is never zero`, () => {
  const f = fixture(); f.forecasts.rows[0].resource_estimate.components[key] = null; hostRebind(f);
  const r = selectJointRoute(f); assert.equal(r.selected.candidate_id, 'other-provider');
  assert.ok(reasons(r).includes('resource_component_unknown_or_invalid'));
});
for (const [name, change] of [
  ['no provenance', e => { delete e.basis_artifact_sha256; }],
  ['no observations', e => { e.basis_sample_count = 0; }],
  ['self estimate', e => { e.basis = 'model_confidence'; }],
  ['expired estimate', e => { e.valid_until_ms = NOW; }],
  ['cash unit', e => { e.unit = 'dollars'; }],
  ['unknown accounting scope', e => { e.accounting_scope = 'provider_total_plus_caches'; }],
  ['wrong config estimate', e => { e.config_sha256 = h('different'); }],
  ['wrong task estimate', e => { e.task_sha256 = h('other'); }],
  ['double-counted cache component', e => { e.components.cached_input_tokens = 50; }],
]) test(`resource ${name} cannot rank savings`, () => {
  const f = fixture(); change(f.forecasts.rows[0].resource_estimate); hostRebind(f);
  assert.equal(selected(f), 'other-provider');
});
test('unknown reference total preserves reference without a fake savings denominator', () => {
  const f = fixture(); f.execution_fallback.resource_estimate = null; const r = selectJointRoute(f);
  assert.equal(r.reason, 'reference_resource_unknown_cannot_rank'); assert.equal(r.selected.resource.total, null);
});
test('resource ties preserve existing reference instead of gratuitous switching', () => {
  const f = fixture(); f.forecasts.rows[0].resource_estimate = resource(f.candidates[1], f.task, 10);
  f.forecasts.rows[1].resource_estimate = resource(f.candidates[2], f.task, 10); hostRebind(f);
  assert.equal(selected(f), 'reference');
});
test('catalog order does not create a preferred provider or change fingerprint', () => {
  const f = fixture(), a = selectJointRoute(f); f.candidates.reverse(); const b = selectJointRoute(f);
  assert.equal(a.selected.candidate_id, b.selected.candidate_id);
  assert.equal(a.candidate_pool_sha256, b.candidate_pool_sha256);
});
test('missing forecasts preserve reference without inventing samples', () => {
  const f = fixture(); f.forecasts.rows = []; hostRebind(f); assert.equal(selected(f), 'reference');
});
test('multisampling is explicitly excluded in initial read-only and writer contracts', () => {
  const f = fixture(); f.forecasts.rows[0].samples = 2; hostRebind(f);
  assert.equal(selected(f), 'other-provider');
  f.task.samples = 2; assert.equal(selectJointRoute(f).decision, 'hold');
  f.task.samples = 1; f.selection_policy.max_samples = 2;
  assert.equal(selectJointRoute(f).reason, 'invalid_initial_selection_policy');
});
test('same config with a changed metric/harness/reference requires fresh evidence', () => {
  for (const field of ['metric_id', 'metric_version', 'harness_sha256']) {
    const f = fixture(); f.quality_reference[field] = field.endsWith('sha256') ? h('changed') : 'changed';
    f.execution_fallback.quality_reference_sha256 = digest(f.quality_reference);
    assert.equal(selectJointRoute(f).reason, 'calibration_reference_changed');
  }
});
test('changed predictor version cannot reuse previously generated forecasts', () => {
  const f = fixture(); f.forecasts.predictor.version = '2'; hostRebind(f);
  assert.equal(selectJointRoute(f).reason, 'forecast_calibration_or_predictor_mismatch');
});
test('missing forecast predictor is a typed preserve, not a crash', () => {
  const f = fixture(); delete f.forecasts.predictor; hostRebind(f);
  assert.equal(selectJointRoute(f).reason, 'forecast_calibration_or_predictor_mismatch');
});
test('changed host witness cannot inherit validation of a different forecast', () => {
  const f = fixture(); f.forecasts.rows[0].match_probability = .999;
  assert.equal(selectJointRoute(f).reason, 'host_evidence_binding_mismatch');
});
test('duplicate candidate IDs hold and duplicate forecast tuples preserve reference', () => {
  const f = fixture(); f.forecasts.rows.push(structuredClone(f.forecasts.rows[0])); hostRebind(f);
  assert.equal(selectJointRoute(f).reason, 'duplicate_forecast_tuple');
  f.candidates.push(structuredClone(f.candidates[1])); assert.equal(selectJointRoute(f).decision, 'hold');
});
test('unknown config authority fields cannot be smuggled into an exact tuple', () => {
  const f = fixture(); f.candidates[1].config.ignore_permissions = true;
  assert.equal(selectJointRoute(f).reason, 'invalid_candidate_catalog_config_shape');
});
test('malformed and non-JSON values fail closed, including NaN and undefined', () => {
  for (const value of [null, [], undefined, {schema: 1}, {...fixture(), now_ms: NaN}])
    assert.equal(selectJointRoute(value).decision, 'hold');
  const f = fixture(); f.forecasts.rows[0].match_probability = NaN;
  assert.equal(selectJointRoute(f).reason, 'plain_finite_json_input_required');
  const cycle = {}; cycle.self = cycle;
  assert.equal(selectJointRoute(cycle).reason, 'plain_finite_json_input_required');
  const sparse = fixture(); sparse.candidates = Array(1);
  assert.equal(selectJointRoute(sparse).reason, 'plain_finite_json_input_required');
});
test('JSON hashing is deterministic and never coerces unknown to zero or null', () => {
  assert.equal(stableJSON({b: 2, a: 1}), stableJSON({a: 1, b: 2}));
  assert.throws(() => digest({x: undefined}), /plain_finite_json/);
  assert.throws(() => digest({x: Infinity}), /plain_finite_json/);
  assert.throws(() => stableJSON(Array(100_001).fill(null)), /plain_finite_json/);
});
test('input and selected descriptor/config are independent snapshots', () => {
  const f = fixture(), before = JSON.stringify(f), r = selectJointRoute(f);
  assert.equal(JSON.stringify(f), before);
  f.candidates[1].config.tools.push('later'); f.quality_reference.id = 'later';
  assert.deepEqual(r.selected.config.tools, []); assert.equal(r.quality_reference.id, 'frozen-reference-policy');
});
test('proposal is never an execution authorization, reservation or quality certificate', () => {
  const r = selectJointRoute(fixture());
  for (const key of ['execution_authorized', 'execution_performed', 'reservation_performed',
    'quality_certificate', 'predictor_executed', 'live_route_change_authorized']) assert.equal(r[key], false);
  assert.equal(r.task_quality, 'unverified'); assert.equal(r.parity, 'unverified');
  assert.equal(r.advisory_only, true); assert.equal(r.evidence_consistency_only, true);
  assert.equal(r.requires_live_reference_fallback, true);
});
test('pure selector source contains no filesystem, network, execution or implicit clock imports', () => {
  const src = readFileSync(new URL('../../Resources/openclaw-os1-bridge/joint-route-selector.mjs', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(m => m[1]);
  assert.deepEqual(imports, ['node:crypto']);
  assert.doesNotMatch(src, /\b(?:fetch|setTimeout|setInterval|spawn|execFile|Date\.now)\s*\(/);
  assert.match(src, /Copyright \(c\) Microsoft Corporation/);
  assert.match(src, /MIT License/);
});
