// All data/labels below are SYNTHETIC software fixtures, not measured training.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {syncBuiltinESMExports} from 'node:module';
import {spawnSync} from 'node:child_process';
import {loadFrozenRouteArtifacts, isFrozenRouteArtifacts, frozenRouteData, frozenRouteFileCustody,
  FROZEN_ROUTE_FORMAT, FROZEN_ROUTE_FEATURE_SCHEMA, FROZEN_ROUTE_LIMITS}
  from '../../Resources/openclaw-os1-bridge/frozen-route-artifacts.mjs';
import {createFrozenRoutePredictor, isFrozenRoutePredictor, isFrozenRouteInference, frozenRouteFeatureBucket}
  from '../../Resources/openclaw-os1-bridge/frozen-route-predictor.mjs';
import {digest, exactConfigFingerprint, candidatePoolFingerprint, RESOURCE_COMPONENTS, selectJointRoute}
  from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
const H = x => createHash('sha256').update(x).digest('hex');
const copy = x => JSON.parse(JSON.stringify(x));
const NOW = 100000;
const moduleRoot = fileURLToPath(new URL('../../Resources/openclaw-os1-bridge/', import.meta.url));
function fixtureData() {
  const config = (name, effort) => ({surface: 'codex', transport: 'codex_app_server', account_id: 'SYNTHETIC-account',
    model: name, effort, tools: ['read'], scope: 'read_only', permission_profile: 'read_only',
    quota_pool: 'openai_codex', allowed_paths: [], configuration_sha256: H(name)});
  const cs = [config('gpt-6-astra', 'ultra'), config('gpt-6-luna', 'low')];
  const fresh = {observed_at_ms: NOW - 1000, valid_until_ms: NOW + 50000};
  const candidates = cs.map((c, i) => ({id: i ? 'candidate' : 'reference', config: c,
    capabilities: {supported: true, config_sha256: exactConfigFingerprint(c), features: ['text'], max_context_tokens: 32000, ...fresh},
    availability: {state: 'available', account_id: c.account_id, config_sha256: exactConfigFingerprint(c), observation_sha256: H('availability'), ...fresh},
    quota: {state: 'sufficient', account_id: c.account_id, quota_pool: c.quota_pool, observation_sha256: H('quota'), ...fresh}}));
  const task = {id: 'SYNTHETIC-task', node_id: 'node', request_sha256: H('request'), source_snapshot_sha256: H('host-context-not-source-body'),
    feature_sha256: H('temporary'), policy_sha256: H('policy'), plan_sha256: H('plan'), environment_sha256: H('environment'),
    instructions_sha256: H('owner-projection-not-full-native-instructions'), verifier_sha256: H('verifier'),
    feature_schema_version: FROZEN_ROUTE_FEATURE_SCHEMA, workload_class: 'text_operation', scope: 'read_only',
    required_tools: ['read'], allowed_tools: ['read'], allowed_paths: [], required_capabilities: ['text'],
    allowed_transports: ['codex_app_server'], context_tokens: 100};
  const features = {schema: 1, version: FROZEN_ROUTE_FEATURE_SCHEMA, semantic_family_id: 'SYNTHETIC-transform',
    context_tokens: 100, material_count: 1, requirement_count: 2, dependency_count: 0, source_state: 'provided',
    constraints_sha256: digest({scope: task.scope, required_tools: task.required_tools, allowed_tools: task.allowed_tools,
      allowed_paths: task.allowed_paths, required_capabilities: task.required_capabilities,
      allowed_transports: task.allowed_transports, owner_constraints: null})};
  task.feature_sha256 = frozenRouteFeatureBucket(features, task);
  const reference = {schema: 1, id: 'SYNTHETIC-fixed-reference', version: '1', policy_sha256: H('reference-policy'),
    config_sha256: exactConfigFingerprint(cs[0]), harness_sha256: H('native-harness'), metric_id: 'synthetic_reference_match', metric_version: '1'};
  const selector = {schema: 1, now_ms: NOW, task, candidates,
    selection_policy: {schema: 1, id: 'SYNTHETIC-policy', version: '1', policy_sha256: task.policy_sha256,
      requires_live_reference_fallback: true, max_samples: 1}, quality_reference: reference,
    execution_fallback: {candidate_id: 'reference', config_sha256: reference.config_sha256,
      quality_reference_sha256: digest(reference), resource_estimate: null}, calibration: null, forecasts: null, host_evidence: null};
  const current = {rcc_source_sha256: H('rcc-full-source'), harness_sha256: reference.harness_sha256,
    native_binary_sha256: H('native-binary'), native_instructions_sha256: H('full-native-instructions'), coverage_discriminator_sha256: H('fixture-discriminator')};
  const configs = cs.map(exactConfigFingerprint);
  const sample = (name, c, match, success) => ({id: H(name), origin: 'synthetic_fixture', split: 'development',
    source_sha256: H(name + 'source'), template_sha256: H('shared-template'), project_sha256: H('shared-project'),
    raw_attempt_sha256: H(name + 'raw'), final_lock_sha256: H(name + 'final'), label_evidence_sha256: H(name + 'label'),
    feature_bucket_sha256: task.feature_sha256, config_sha256: configs[c], outcome: 'completed',
    reference_match: match, task_success: success,
    resource: {accounting_scope: 'disjoint_remaining_node_total_v1', token_basis: 'input_output_include_cache_reasoning_subsets',
      components: Object.fromEntries(RESOURCE_COMPONENTS.map((k, i) => [k, i + c]))}});
  const samples = [sample('reference', 0, true, true), sample('candidate-a', 1, true, false), sample('candidate-b', 1, false, true)];
  const table = {schema: 1, kind: FROZEN_ROUTE_FORMAT, cells: configs.map(c => ({feature_bucket_sha256: task.feature_sha256,
    config_sha256: c, sample_ids: samples.filter(s => s.config_sha256 === c).map(s => s.id)}))};
  const lineage = {schema: 1, kind: 'development_lineage_v1', dataset_sha256: H('SYNTHETIC-DATASET-NOT-TRAINING'),
    label_schema: 'separate_reference_match_and_task_success_v1', samples};
  const manifest = {schema: 1, kind: FROZEN_ROUTE_FORMAT, id: 'SYNTHETIC-artifact', version: '1', proof_mode: 'synthetic_fixture',
    issued_at_ms: NOW - 1000, valid_until_ms: NOW + 40000,
    runtime: {algorithm: FROZEN_ROUTE_FORMAT, node_major: 24,
      loader_sha256: H(fs.readFileSync(join(moduleRoot, 'frozen-route-artifacts.mjs'))),
      predictor_sha256: H(fs.readFileSync(join(moduleRoot, 'frozen-route-predictor.mjs')))},
    bindings: {...current, policy_sha256: task.policy_sha256, reference_descriptor_sha256: digest(reference),
      environment_sha256: task.environment_sha256, verifier_sha256: task.verifier_sha256,
      candidate_pool_sha256: candidatePoolFingerprint(candidates), config_sha256s: configs, workload_classes: [task.workload_class], scope: 'read_only'},
    feature_schema_version: FROZEN_ROUTE_FEATURE_SCHEMA, minimum_samples: 1,
    rights: {status: 'cleared', evidence_sha256: H('SYNTHETIC-RIGHTS-DECLARATION-NOT-INDEPENDENT-REVIEW')},
    split_audit: {status: 'not_performed'}, calibration: {status: 'unmeasured'}, holdout: {status: 'not_performed'}, files: []};
  return {manifest, table, lineage, request: {selector_input: selector, current_bindings: current, features}};
}
function bundle(t, change = () => {}, transforms = {}) {
  const data = fixtureData(); change(data);
  const stateDir = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'os1-frozen-dev-'))); fs.chmodSync(stateDir, 0o700);
  t.after(() => fs.rmSync(stateDir, {recursive: true, force: true}));
  const root = join(stateDir, 'routing-artifacts'); fs.mkdirSync(root, {mode: 0o700});
  const text = (role, value) => transforms[role]?.(JSON.stringify(value)) ?? JSON.stringify(value);
  const table = Buffer.from(text('table', data.table)), lineage = Buffer.from(text('lineage', data.lineage));
  data.manifest.files = [{name: 'table.json', sha256: H(table), bytes: table.length}, {name: 'lineage.json', sha256: H(lineage), bytes: lineage.length}];
  const manifest = Buffer.from(text('manifest', data.manifest)); const hash = H(manifest), dir = join(root, hash); fs.mkdirSync(dir, {mode: 0o700});
  for (const [name, bytes] of [['manifest.json', manifest], ['table.json', table], ['lineage.json', lineage]]) fs.writeFileSync(join(dir, name), bytes, {mode: 0o600});
  const registration = {schema: 1, manifest_sha256: hash, manifest_bytes: manifest.length,
    loader_sha256: data.manifest.runtime.loader_sha256, predictor_sha256: data.manifest.runtime.predictor_sha256};
  return {stateDir, dir, registration, data, load: (patch = {}) => loadFrozenRouteArtifacts({stateDir, mode: 'shadow', registration, now_ms: NOW, ...patch})};
}

test('no registered artifact capability -> no inference, IO, fallback data, model or fake receipt', () => {
  for (const f of [createFrozenRoutePredictor(), createFrozenRoutePredictor({artifacts: {approved: true}})]) {
    assert(isFrozenRoutePredictor(f)); const x = f(); assert.equal(x.status, 'not_registered');
    assert.equal(x.predictor_inference_observed, false); assert.equal(x.inference_receipt, null);
    assert.equal(x.artifact_manifest_sha256, null); assert.equal(x.calibration, null); assert.equal(x.model_calls, 0);
  }
  assert.equal(isFrozenRoutePredictor(() => ({observed: true})), false);
});
test('actual finite lookup computes declared empirical fractions/resource means, not calibration', t => {
  const h = bundle(t), a = h.load(), f = createFrozenRoutePredictor({artifacts: a.artifacts});
  const x = f(h.data.request), candidate = x.predictions.find(r => r.candidate_id === 'candidate');
  assert.equal(x.status, 'development_prediction'); assert.equal(x.predictor_inference_observed, true);
  assert(isFrozenRouteInference(x)); assert.equal(isFrozenRouteInference(copy(x)), false);
  assert.equal(candidate.observations, 2); assert.equal(candidate.reference_match_fraction, .5);
  assert.equal(candidate.task_success_fraction, .5); assert.equal(candidate.resource_mean_total, 55);
  assert.equal(candidate.predicted_lower_bound, null); assert.equal(x.artifact_manifest_sha256, h.registration.manifest_sha256);
  assert.equal(x.calibration, null); assert.equal(x.forecasts, null); assert.equal(x.host_evidence, null);
  assert.equal(x.selector_result.decision, 'preserve_reference'); assert.equal(x.selector_result.predictor_executed, false);
  assert.equal(x.execution_authorized, false); assert.equal(x.quality_certificate, false);
  assert.equal(x.inference_receipt.source_records_independently_verified, false);
  assert.equal(x.inference_receipt.native_instructions_sha256, h.data.request.current_bindings.native_instructions_sha256);
  assert.equal(x.inference_receipt.projection_instructions_sha256, h.data.request.selector_input.task.instructions_sha256);
  assert.notEqual(x.inference_receipt.native_instructions_sha256, x.inference_receipt.projection_instructions_sha256);
  assert.deepEqual(f(h.data.request), x); assert(Object.isFrozen(candidate));
});
test('correctness and reference match stay distinct even when both outputs were wrong', t => {
  const h = bundle(t, d => {const s = d.lineage.samples[0]; s.reference_match = true; s.task_success = false;});
  const x = createFrozenRoutePredictor({artifacts: h.load().artifacts})(h.data.request), r = x.predictions.find(r => r.candidate_id === 'reference');
  assert.equal(r.reference_match_fraction, 1); assert.equal(r.task_success_fraction, 0);
  assert.equal(x.calibration_validated, false); assert.equal(x.holdout_accepted, false);
});
test('brand identity cannot be reconstructed from JSON flags/hashes', t => {
  const h = bundle(t), artifacts = h.load().artifacts;
  const x = createFrozenRoutePredictor({artifacts: copy(artifacts)})(h.data.request);
  assert.equal(x.artifact_loaded, false); assert.equal(x.predictor_inference_observed, false);
});
test('missing current native metadata remains unmeasured; no ctx-to-capacity fabrication', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts});
  for (const x of [f(), f({selector_input: null, current_bindings: null, features: null}), f({task: {}, catalog: {}})]) {
    assert.equal(x.status, 'unmeasured'); assert.equal(x.predictor_inference_observed, false);
    assert.equal(x.inference_receipt, null); assert.equal(x.artifact_manifest_sha256, h.registration.manifest_sha256);
  }
});
for (const key of ['rcc_source_sha256', 'harness_sha256', 'native_binary_sha256', 'native_instructions_sha256', 'coverage_discriminator_sha256'])
  test(`actual current host binding cannot inherit artifact state: ${key}`, t => {
    const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts}), q = copy(h.data.request);
    q.current_bindings[key] = H('foreign'); const x = f(q);
    assert.equal(x.reason, 'fr_current_regime_changed'); assert.equal(x.predictor_inference_observed, false);
  });
for (const key of ['policy_sha256', 'environment_sha256', 'verifier_sha256', 'scope', 'feature_schema_version', 'workload_class'])
  test(`task-regime mismatch is not OOD/default probability: ${key}`, t => {
    const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts}), q = copy(h.data.request);
    q.selector_input.task[key] = key.endsWith('sha256') ? H('changed') : 'changed';
    const x = f(q); assert.equal(x.predictor_inference_observed, false); assert.equal(x.predictions.length, 0);
  });
test('changed exact effort/model/account/pool/nativeconfig invalidates old table heads', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts});
  for (const [k, v] of [['effort', 'high'], ['model', 'new-model'], ['account_id', 'other'], ['quota_pool', 'anthropic_shared'], ['configuration_sha256', H('different')]]) {
    const q = copy(h.data.request); q.selector_input.candidates[1].config[k] = v;
    assert.equal(f(q).reason, ['account_id', 'quota_pool'].includes(k) ?
      'fr_multiple_native_cohorts_unsupported' : 'fr_current_config_reference_or_harness_changed');
  }
});
test('reference descriptor or available reference cannot be replaced by successful DEV statistics', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts});
  const a = copy(h.data.request); a.selector_input.quality_reference.metric_version = 'other'; assert.equal(f(a).predictor_inference_observed, false);
  const b = copy(h.data.request); b.selector_input.candidates[0].quota.state = 'exhausted';
  assert.equal(f(b).reason, 'fr_host_selector_preconditions_missing'); assert.equal(f(b).predictor_inference_observed, false);
});
test('missing capability/availability/quota evidence never gets defaulted or fetched', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts});
  for (const k of ['capabilities', 'availability', 'quota']) {
    const q = copy(h.data.request); q.selector_input.candidates[0][k] = null;
    assert.equal(f(q).reason, 'fr_host_selector_preconditions_missing');
  }
  const q = copy(h.data.request); q.selector_input.candidates[1].quota = null;
  const row = f(q).predictions.find(x => x.candidate_id === 'candidate'); assert.equal(row.reason, 'current_candidate_ineligible');
  assert.equal(row.reference_match_fraction, null);
});
test('input accessors are rejected before execution, and do not produce an inference receipt', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts}); let getters = 0;
  const x = f({get selector_input() {getters++; throw Error('bad');}, current_bindings: {}, features: {}});
  assert.equal(getters, 0); assert.equal(x.predictor_inference_observed, false);
});
test('fresh call time cannot extend an expired frozen artifact', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts}), q = copy(h.data.request);
  q.selector_input.now_ms = NOW + 40000; const x = f(q); assert.equal(x.reason, 'fr_artifact_stale_or_future');
  assert.equal(x.inference_receipt, null);
});
test('empty registry data never pretends inference, even with complete current host evidence', t => {
  const h = bundle(t, d => {d.manifest.proof_mode = 'empty'; d.table.cells = []; d.lineage.samples = [];});
  const x = createFrozenRoutePredictor({artifacts: h.load().artifacts})(h.data.request);
  assert.equal(x.reason, 'frozen_table_empty'); assert.equal(x.predictor_inference_observed, false);
});
for (const [reason, change] of [
  ['development_sample_count_insufficient', d => {d.manifest.minimum_samples = 3;}],
  ['development_labels_incomplete', d => {d.lineage.samples[1].reference_match = null;}],
  ['development_resource_components_unknown', d => {d.lineage.samples[1].resource.components.retry_reserve_tokens = null;}],
  ['declared_rights_not_cleared', d => {d.manifest.rights.status = 'unknown'; d.manifest.rights.evidence_sha256 = null;}],
]) test(`unknown evidence remains unknown, not .5/.99/zero/certified: ${reason}`, t => {
  const h = bundle(t, change), x = createFrozenRoutePredictor({artifacts: h.load().artifacts})(h.data.request);
  const r = x.predictions.find(r => r.candidate_id === 'candidate'); assert.equal(r.reason, reason);
  assert.equal(r.resource_mean_total, null); assert.equal(x.execution_authorized, false); assert.equal(x.calibration, null);
});
test('unseen feature bucket/source state/constraint change cannot inherit a prior empirical cell', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts});
  const q = copy(h.data.request); q.features.material_count++; q.selector_input.task.feature_sha256 = frozenRouteFeatureBucket(q.features, q.selector_input.task);
  assert(f(q).predictions.every(r => r.reason === 'feature_or_config_out_of_table'));
  const u = copy(h.data.request); u.features.source_state = 'unknown'; u.selector_input.task.feature_sha256 = frozenRouteFeatureBucket(u.features, u.selector_input.task);
  assert(f(u).predictions.every(r => r.reason === 'source_state_unknown'));
  const c = copy(h.data.request); c.selector_input.task.allowed_paths = ['/foreign']; assert.equal(f(c).predictor_inference_observed, false);
});
test('receipt binds exact current task/request/source/plan/feature; merely copying observed true is not execution', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts}), q = copy(h.data.request);
  const a = f(q); q.selector_input.task.id = 'another-current-task'; q.selector_input.task.request_sha256 = H('another-request');
  const b = f(q); assert.notEqual(a.inference_receipt.receipt_sha256, b.inference_receipt.receipt_sha256);
  assert.equal(b.inference_receipt.task_id, q.selector_input.task.id); assert.equal(b.inference_receipt.request_sha256, q.selector_input.task.request_sha256);
  assert.equal(b.inference_receipt.feature_bucket_sha256, q.selector_input.task.feature_sha256);
  assert.equal(isFrozenRouteInference({predictor_inference_observed: true, ...copy(b)}), false);
});
test('no disk reads or mutation occur during repeated pure inference', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts}), before = JSON.stringify(h.data.request);
  const original = fs.openSync; fs.openSync = () => assert.fail('inference attempted IO'); syncBuiltinESMExports();
  try {const a = f(h.data.request); assert.equal(a.status, 'development_prediction'); assert.deepEqual(f(h.data.request), a);}
  finally {fs.openSync = original; syncBuiltinESMExports();}
  assert.equal(JSON.stringify(h.data.request), before);
});
test('one global native binary/instruction witness cannot cover mixed executable/account cohorts', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts});
  for (const change of [c => {c.surface = 'claude'; c.transport = 'claude_cli'; c.quota_pool = 'anthropic_shared';},
    c => {c.account_id = 'different-account';}, c => {c.quota_pool = 'openai_chat';}]) {
    const q = copy(h.data.request); change(q.selector_input.candidates[1].config);
    assert.equal(f(q).reason, 'fr_multiple_native_cohorts_unsupported'); assert.equal(f(q).predictor_inference_observed, false);
  }
});
test('answer/scorer/selected-outcome/raw-source fields cannot be smuggled into pre-outcome inputs', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts});
  for (const key of ['answer', 'gold', 'scorer_result', 'current_result', 'raw_source_body']) {
    const q = copy(h.data.request); q.selector_input.task[key] = 'SYNTHETIC-FORBIDDEN';
    const r = f(q); assert.equal(r.reason, 'fr_preoutcome_task_shape'); assert.equal(r.predictor_inference_observed, false);
  }
  const q = copy(h.data.request); q.selector_input.candidates[0].capabilities.gold = 'SYNTHETIC';
  assert.equal(f(q).reason, 'fr_preoutcome_observation_shape');
});
test('unmeasured input and forged artifacts do not gain scientific/rights/split or inference status', t => {
  const h = bundle(t), f = createFrozenRoutePredictor({artifacts: h.load().artifacts});
  const x = f(h.data.request); assert.equal(x.proof_mode, 'synthetic_fixture'); assert.equal(x.rights_independently_verified, false);
  assert.equal(x.split_disjoint_verified, false); assert.equal(x.inference_receipt.declared_rights_status, 'cleared');
  assert.equal(x.inference_receipt.source_records_independently_verified, false);
  const q = copy(h.data.request); q.selector_input.host_evidence = {approved: true};
  assert.equal(f(q).predictor_inference_observed, false); assert.equal(f(q).calibration, null);
});
