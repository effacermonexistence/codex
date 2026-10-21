// Actual durable Core, synthetic host artifacts and fake native executor ONLY.
// Mock .99 forecasts are software fixtures, never measured model performance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRCCRuntime, hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {digest, exactConfigFingerprint, candidatePoolFingerprint, selectJointRoute, SCORE_SPACE, RESOURCE_UNIT}
  from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
const H = x => createHash('sha256').update(x).digest('hex');
const policyText = 'Original request and source boundaries are the floor. Shadow grants no route authority.';
const referencePolicySHA = H('synthetic-fixed-reference-policy');
function task(dir) {
  const request = 'Describe the supplied definition and preserve its conditions.';
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: randomUUID(), request, objective: request, request_sha256: H(request),
    source_fingerprint: hostContextFingerprint(host), policy_sha256: H(policyText), mode: 'auto', material_refs: [],
    budget: {max_attempts: 1, max_parallel: 4, max_duration_ms: 10000, max_cost_units: null}, host_context: host,
    policy: {source_sha256: H('synthetic-full-source'), projection_sha256: H(policyText), text: policyText}};
}
function policy(patch = {}) {
  return {schema: 1, mode: 'shadow', policy_id: 'joint-shadow-fixture', version: '1', rcc_source_sha256: H('synthetic-full-source'),
    projection_sha256: H(policyText), reference_policy_sha256: referencePolicySHA,
    allowed_workload_classes: ['readonly_lookup'], max_nodes: 2, max_parallel: 1, max_plan_revisions: 0,
    max_planner_calls: 1, planner_input_bytes: 64000, planner_output_tokens: 512,
    requires_live_reference_fallback: true, adoption_manifest_sha256: null, ...patch};
}
function catalog(q) {
  const now = Date.now(), row = (id, model, effort) => ({id, surface: 'codex', transport: 'codex_app_server',
    account_id: 'synthetic-account', model, effort, tools: ['read'], scope: 'read_only', permission_profile: 'read_only',
    quota_pool: 'openai_codex', allowed_paths: [], configuration_sha256: H('cfg:' + id), availability: 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 60000,
    quota_remaining_fraction: .8, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 60000,
    quality_state: 'policy_admitted', estimated_cost_units: 1});
  return {schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, owner_scope: 'read_only',
    request_class: 'readonly_lookup', chat_lane_eligible: false,
    model_tiers: {'gpt-6-astra': 'frontier', 'gpt-6-luna': 'fast'},
    candidates: [row('current-reference', 'gpt-6-astra', 'ultra'), row('cheap-fixture', 'gpt-6-luna', 'low')]};
}
const CFG_KEYS = ['surface', 'transport', 'account_id', 'model', 'effort', 'tools', 'scope', 'permission_profile',
  'quota_pool', 'allowed_paths', 'configuration_sha256'];
const cfg = c => Object.fromEntries(CFG_KEYS.map(k => [k, structuredClone(c[k])]));
function evidence({task: q, node, plan, catalog: cat, candidate}, calibrated = true) {
  const now = Date.now(), times = {observed_at_ms: now - 100, valid_until_ms: now + 60000};
  const candidates = cat.candidates.map(c => {
    const config = cfg(c);
    return {id: c.id, config, capabilities: {supported: true, config_sha256: exactConfigFingerprint(config),
      features: ['text'], max_context_tokens: 32000, ...times},
      availability: {state: 'available', account_id: c.account_id, config_sha256: exactConfigFingerprint(config),
        observation_sha256: H('synthetic-availability:' + c.id), ...times},
      quota: {state: 'sufficient', account_id: c.account_id, quota_pool: c.quota_pool,
        observation_sha256: H('synthetic-quota:' + c.id), ...times}};
  });
  const t = {id: q.task_id, node_id: node.id, request_sha256: q.request_sha256, source_snapshot_sha256: q.source_fingerprint,
    feature_sha256: digest({request: q.request, source: q.source_fingerprint, policy: q.policy_sha256}),
    policy_sha256: q.policy_sha256, plan_sha256: digest(plan), environment_sha256: H('synthetic-environment'),
    instructions_sha256: q.policy_sha256, verifier_sha256: H('synthetic-verifier'), feature_schema_version: 'fixture-v1',
    workload_class: cat.request_class, scope: node.scope, required_tools: ['read'], allowed_tools: ['read'],
    allowed_paths: [...node.owned_paths], required_capabilities: ['text'], allowed_transports: ['codex_app_server'], context_tokens: 100};
  const ref = {schema: 1, id: 'synthetic-reference', version: '1', policy_sha256: referencePolicySHA,
    config_sha256: exactConfigFingerprint(cfg(candidate)), harness_sha256: H('synthetic-harness'),
    metric_id: 'fixture-quality', metric_version: '1'};
  function resource(c, n) {
    return {unit: RESOURCE_UNIT, basis: 'observed_history', accounting_scope: 'disjoint_remaining_node_total_v1',
      basis_artifact_sha256: H('synthetic-history:' + c.id), basis_sample_count: 20,
      config_sha256: exactConfigFingerprint(c.config), task_sha256: digest(t), ...times,
      components: {routing_tokens: 2, input_tokens_per_sample: 100 * n, output_tokens_per_sample: 10 * n,
        native_child_tokens_per_sample: 0, tool_context_tokens_per_sample: 2, verification_tokens_per_sample: 2,
        ranking_tokens: 0, integration_tokens: 0, retry_reserve_tokens: 1, queue_timeout_overhead_tokens: 0}};
  }
  const fallback = candidates.find(c => c.id === candidate.id), pool = candidatePoolFingerprint(candidates);
  const input = {schema: 1, now_ms: 0, task: t, candidates, quality_reference: ref,
    selection_policy: {schema: 1, id: 'synthetic-p2', version: '1', policy_sha256: q.policy_sha256,
      requires_live_reference_fallback: true, max_samples: 1},
    execution_fallback: {candidate_id: candidate.id, config_sha256: ref.config_sha256,
      quality_reference_sha256: digest(ref), resource_estimate: resource(fallback, 10)},
    calibration: null, forecasts: null, host_evidence: null};
  if (!calibrated) return input;
  const cal = {schema: 1, id: 'SYNTHETIC-NOT-MEASURED', version: '1', status: 'calibrated',
    score_space: SCORE_SPACE, threshold: .98, allowed_quality_gap: 0, ...times,
    predictor: {id: 'mock-predictor', version: '1', artifact_sha256: H('mock-weights')},
    train_dataset_sha256: H('mock-train'), calibration_dataset_sha256: H('mock-calibrate'), holdout_dataset_sha256: H('mock-holdout'),
    split_audit_sha256: H('mock-split'), coverage_policy_sha256: H('mock-coverage'), uncertainty_policy_sha256: H('mock-uncertainty'),
    ood_policy_sha256: H('mock-ood'), quality_metric_id: ref.metric_id, metric_version: ref.metric_version,
    reference_descriptor_sha256: digest(ref), policy_sha256: t.policy_sha256, workload_class: t.workload_class,
    scope: t.scope, feature_schema_version: t.feature_schema_version, environment_sha256: t.environment_sha256,
    instructions_sha256: t.instructions_sha256, verifier_sha256: t.verifier_sha256, candidate_pool_sha256: pool};
  const cheap = candidates.find(c => c.id === 'cheap-fixture');
  const forecasts = {schema: 1, ...times, calibration_sha256: digest(cal), predictor: {...cal.predictor},
    task_sha256: digest(t), reference_descriptor_sha256: digest(ref), candidate_pool_sha256: pool,
    rows: [{candidate_id: cheap.id, config_sha256: exactConfigFingerprint(cheap.config), samples: 1, score_space: SCORE_SPACE,
      match_probability: .995, uncertainty: {state: 'bounded', lower_bound: .99, policy_sha256: cal.uncertainty_policy_sha256},
      coverage: {state: 'covered', policy_sha256: cal.coverage_policy_sha256, evidence_sha256: H('mock-coverage-proof')},
      ood: {state: 'in_distribution', policy_sha256: cal.ood_policy_sha256, evidence_sha256: H('mock-ood-proof')},
      resource_estimate: resource(cheap, 1)}]};
  input.calibration = cal; input.forecasts = forecasts;
  input.host_evidence = {schema: 1, source: 'host_artifact_validation', status: 'validated', receipt_sha256: H('MOCK-not-actual-attestation'),
    dataset_split_status: 'disjoint_verified', rights_status: 'cleared', holdout_status: 'accepted', predictor_execution_status: 'observed',
    ...times, calibration_sha256: digest(cal), forecasts_sha256: digest(forecasts), task_sha256: digest(t),
    reference_descriptor_sha256: digest(ref), candidate_pool_sha256: pool};
  return input;
}
function completion(ticket) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256, selected_config: ticket.selected_config,
    acknowledged_config: ticket.selected_config, observed_config: null, status: 'succeeded', dispatch_stage: 'dispatched',
    side_effects: 'none', execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    output: 'fake-executor-answer', native_receipt: '/private/synthetic/' + ticket.attempt_id, native_summary: null};
}
function rebindSyntheticForecast(x) {
  // Adversarially consistent synthetic evidence: simple internal hash
  // consistency must not replace Core's independent current-task binding.
  const taskHash = digest(x.task);
  x.calibration.instructions_sha256 = x.task.instructions_sha256;
  x.forecasts.calibration_sha256 = digest(x.calibration);
  x.forecasts.task_sha256 = taskHash;
  x.execution_fallback.resource_estimate.task_sha256 = taskHash;
  for (const row of x.forecasts.rows) row.resource_estimate.task_sha256 = taskHash;
  x.host_evidence.calibration_sha256 = digest(x.calibration);
  x.host_evidence.forecasts_sha256 = digest(x.forecasts);
  x.host_evidence.task_sha256 = taskHash;
  return x;
}
async function harness(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'os1-joint-shadow-fixture-')); await chmod(directory, 0o700);
  const tickets = []; let plannerCalls = 0;
  const runtime = await createRCCRuntime({stateDir: directory, hostAutoPlan: true,
    catalog: async q => catalog(q), execute: async ticket => {tickets.push(ticket); return completion(ticket);},
    adaptiveRoutingPolicy: policy(), proposeLocalPlan: async () => {plannerCalls++; throw Error('joint test has no planner call');}, ...options});
  t.after(async () => {await runtime.close(); await rm(directory, {recursive: true, force: true});});
  const q = task(directory);
  await runtime.submit(q); const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});
  assert.equal(done.state, 'returned_unverified', done.error); assert.equal(tickets.length, 1);
  assert.equal(tickets[0].candidate_id, 'current-reference'); assert.equal(tickets[0].selected_config.model, 'gpt-6-astra');
  assert.equal(tickets[0].selected_config.effort, 'ultra'); assert.equal(tickets[0].instruction, q.request);
  return {runtime, q, done, tickets, saved: runtime._load(q.task_id), plannerCalls};
}
test('shadow without host artifacts records unmeasured and never invents a forecast', async t => {
  const h = await harness(t); const row = h.saved.joint_route_shadow[0];
  assert.equal(row.state, 'unmeasured'); assert.equal(row.reason, 'joint_host_artifacts_not_registered');
  assert.equal(row.selection, null); assert.equal(row.predictor_executed, false); assert.equal(h.plannerCalls, 0);
});
test('valid injected context with missing calibration calls strict selector and preserves prebound reference', async t => {
  let calls = 0; const h = await harness(t, {jointRouteEvidence: args => {calls++; return evidence(args, false);}});
  const row = h.saved.joint_route_shadow[0]; assert.equal(calls, 1); assert.equal(row.state, 'observed');
  assert.equal(row.selection.decision, 'preserve_reference'); assert.equal(row.reason, 'calibration_missing_or_unmeasured');
  assert.equal(row.selection.selected.candidate_id, 'current-reference');
});
test('synthetic cheaper forecast is observed only; actual native ticket stays admitted reference', async t => {
  let supplied; const h = await harness(t, {jointRouteEvidence: args => (supplied = evidence(args))});
  const row = h.saved.joint_route_shadow[0]; assert.equal(supplied.now_ms, 0);
  assert.equal(row.state, 'observed'); assert.equal(row.selection.decision, 'candidate_proposal');
  assert.equal(row.selection.selected.candidate_id, 'cheap-fixture'); assert.equal(row.model_selection_changed, false);
  assert.equal(row.source_snapshot_basis, 'exact_core_host_context_fingerprint_not_source_body_hash');
  assert.equal(row.live_route_change_authorized, false); assert.equal(row.execution_authorized, false);
  assert.equal(row.quality_certificate, false); assert.equal(row.selection.task_quality, 'unverified');
  assert.equal(h.saved.plan.nodes[0].candidate_id, 'current-reference');
});
for (const field of ['source_snapshot_sha256', 'instructions_sha256']) {
  test(`consistently rebound foreign ${field} is rejected by independent Core binding`, async t => {
    const h = await harness(t, {jointRouteEvidence: args => {
      const x = evidence(args); x.task[field] = H('foreign-current-state');
      x.task.feature_sha256 = H('foreign-consistently-rebound-features');
      const rebound = rebindSyntheticForecast(x);
      assert.equal(selectJointRoute({...rebound, now_ms: Date.now()}).decision, 'candidate_proposal',
        'internally consistent synthetic hashes alone do not prove current host state');
      return rebound;
    }});
    const row = h.saved.joint_route_shadow[0]; assert.equal(row.state, 'rejected');
    assert.equal(row.reason, 'joint_shadow_evidence_invalid'); assert.equal(row.selection, null);
  });
}
for (const [name, mutate] of [
  ['task', x => {x.task.id = 'foreign-task';}], ['node', x => {x.task.node_id = 'foreign-node';}],
  ['request', x => {x.task.request_sha256 = H('foreign');}], ['policy', x => {x.task.policy_sha256 = H('foreign');}],
  ['plan', x => {x.task.plan_sha256 = H('foreign');}], ['scope', x => {x.task.scope = 'workspace_write';}],
  ['quality reference policy', x => {x.quality_reference.policy_sha256 = H('foreign');}],
  ['fallback candidate', x => {x.execution_fallback.candidate_id = 'cheap-fixture';}],
  ['fallback config', x => {x.execution_fallback.config_sha256 = H('foreign');}],
  ['current config', x => {x.candidates[0].config.model = 'not-in-current-catalog';}],
  ['injected catalog ID', x => {x.candidates[0].id = 'not-in-current-catalog';}],
]) test(`foreign ${name} evidence is rejected without changing actual route`, async t => {
  const h = await harness(t, {jointRouteEvidence: args => {const x = evidence(args); mutate(x); return x;}});
  const row = h.saved.joint_route_shadow[0]; assert.equal(row.state, 'rejected');
  assert.equal(row.reason, 'joint_shadow_evidence_invalid'); assert.equal(row.selection, null);
});
test('async evidence callback is rejected instead of starting another planner/controller', async t => {
  const h = await harness(t, {jointRouteEvidence: async args => evidence(args)});
  assert.equal(h.saved.joint_route_shadow[0].state, 'rejected');
  assert.equal(h.saved.joint_route_shadow[0].reason, 'joint_shadow_evidence_invalid');
});
test('oversize callback output and callback exception preserve actual admitted route', async t => {
  for (const jointRouteEvidence of [args => ({...evidence(args), padding: 'x'.repeat(240001)}), () => {throw Error('fixture');}]) {
    const h = await harness(t, {jointRouteEvidence}); assert.equal(h.saved.joint_route_shadow[0].state, 'rejected');
  }
});
test('OFF never calls host artifact callback or records a joint shadow result', async t => {
  let calls = 0;
  const h = await harness(t, {adaptiveRoutingPolicy: null, jointRouteEvidence: () => {calls++; throw Error('off');}});
  assert.equal(calls, 0); assert.equal(h.saved.joint_route_shadow, undefined);
});
test('foreign source policy stops before host evidence callback but keeps current route', async t => {
  let calls = 0;
  const h = await harness(t, {adaptiveRoutingPolicy: policy({rcc_source_sha256: H('foreign')}),
    jointRouteEvidence: args => {calls++; return evidence(args);}});
  assert.equal(calls, 0); assert.equal(h.saved.joint_route_shadow[0].reason, 'joint_shadow_policy_binding_mismatch');
});
