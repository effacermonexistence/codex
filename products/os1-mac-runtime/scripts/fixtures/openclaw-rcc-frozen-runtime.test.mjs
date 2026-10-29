// P7 integration only: real private SQLite Core, SYNTHETIC development tables,
// canned planner/native callbacks. No provider, HTTP, native agent or model calls.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRCCRuntime, hostContextFingerprint, hostPlan, resolveRoutePlan}
  from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {adaptiveRuntimeOptions} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {loadFrozenRouteArtifacts, FROZEN_ROUTE_FORMAT, FROZEN_ROUTE_FEATURE_SCHEMA}
  from '../../Resources/openclaw-os1-bridge/frozen-route-artifacts.mjs';
import {createFrozenRoutePredictor, frozenRouteFeatureBucket, isFrozenRouteInference}
  from '../../Resources/openclaw-os1-bridge/frozen-route-predictor.mjs';
import {digest, exactConfigFingerprint, candidatePoolFingerprint, RESOURCE_COMPONENTS}
  from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
const H = x => createHash('sha256').update(x).digest('hex');
const policyText = 'Preserve original source, conditions and unknowns. Synthetic shadow is not admission.';
const sourceSHA = H('SYNTHETIC-full-source'), referencePolicySHA = H('SYNTHETIC-reference-policy');
const moduleRoot = fileURLToPath(new URL('../../Resources/openclaw-os1-bridge/', import.meta.url));
const copy = x => JSON.parse(JSON.stringify(x));
function privateRoot(t) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'os1-frozen-core-fixture-')));
  fs.chmodSync(root, 0o700); t.after(() => fs.rmSync(root, {recursive: true, force: true})); return root;
}
function task(root) {
  const request = 'Explain the supplied definition without dropping its condition.';
  const host = {workspace: root, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: randomUUID(), request, objective: request, request_sha256: H(request),
    source_fingerprint: hostContextFingerprint(host), policy_sha256: H(policyText), mode: 'auto', material_refs: [],
    budget: {max_attempts: 1, max_parallel: 1, max_cost_units: null, max_duration_ms: 10000}, host_context: host,
    policy: {source_sha256: sourceSHA, projection_sha256: H(policyText), text: policyText}};
}
function policy() {
  return {schema: 1, mode: 'shadow', policy_id: 'SYNTHETIC-frozen-runtime', version: '1',
    rcc_source_sha256: sourceSHA, projection_sha256: H(policyText), reference_policy_sha256: referencePolicySHA,
    allowed_workload_classes: ['readonly_lookup'], max_nodes: 2, max_parallel: 1, max_plan_revisions: 0,
    max_planner_calls: 1, planner_input_bytes: 64000, planner_output_tokens: 512,
    requires_live_reference_fallback: true, adoption_manifest_sha256: null};
}
const CFG_KEYS = ['surface', 'transport', 'account_id', 'model', 'effort', 'tools', 'scope',
  'permission_profile', 'quota_pool', 'allowed_paths', 'configuration_sha256'];
const cfg = row => Object.fromEntries(CFG_KEYS.map(k => [k, copy(row[k])]));
function catalog(q) {
  const now = Date.now(), row = (id, model, effort) => ({id, surface: 'codex', transport: 'codex_app_server',
    account_id: 'SYNTHETIC-account', model, effort, tools: ['read'], scope: 'read_only', permission_profile: 'read_only',
    quota_pool: 'openai_codex', allowed_paths: [], configuration_sha256: H(id), availability: 'available',
    availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 60000,
    quota_remaining_fraction: .8, quota_observed_at_ms: now - 1, quota_valid_until_ms: now + 60000,
    quality_state: 'policy_admitted', estimated_cost_units: 1});
  return {schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, owner_scope: 'read_only',
    request_class: 'readonly_lookup', chat_lane_eligible: false,
    model_tiers: {'gpt-6-astra': 'frontier', 'gpt-6-luna': 'fast'},
    candidates: [row('reference', 'gpt-6-astra', 'ultra'), row('cheap', 'gpt-6-luna', 'low')]};
}
function evidence({task: q, node, plan, catalog: cat, candidate}) {
  const now = Date.now(), fresh = {observed_at_ms: now - 1, valid_until_ms: now + 60000};
  const candidates = cat.candidates.map(c => ({id: c.id, config: cfg(c),
    capabilities: {supported: true, config_sha256: exactConfigFingerprint(cfg(c)), features: ['text'], max_context_tokens: 32000, ...fresh},
    availability: {state: 'available', account_id: c.account_id, config_sha256: exactConfigFingerprint(cfg(c)), observation_sha256: H('SYNTHETIC-availability'), ...fresh},
    quota: {state: 'sufficient', account_id: c.account_id, quota_pool: c.quota_pool, observation_sha256: H('SYNTHETIC-quota'), ...fresh}}));
  const st = {id: q.task_id, node_id: node.id, request_sha256: q.request_sha256,
    source_snapshot_sha256: q.source_fingerprint, policy_sha256: q.policy_sha256, plan_sha256: digest(plan),
    feature_sha256: H('pending'), environment_sha256: H('SYNTHETIC-environment'), instructions_sha256: q.policy_sha256,
    verifier_sha256: H('SYNTHETIC-verifier'), feature_schema_version: FROZEN_ROUTE_FEATURE_SCHEMA,
    workload_class: cat.request_class, scope: node.scope, required_tools: ['read'], allowed_tools: ['read'],
    allowed_paths: [...node.owned_paths], required_capabilities: ['text'], allowed_transports: ['codex_app_server'], context_tokens: 100};
  const features = {schema: 1, version: FROZEN_ROUTE_FEATURE_SCHEMA, semantic_family_id: 'SYNTHETIC-text-transform',
    context_tokens: 100, material_count: 0, requirement_count: 1, dependency_count: 0, source_state: 'none',
    constraints_sha256: digest({scope: st.scope, required_tools: st.required_tools, allowed_tools: st.allowed_tools,
      allowed_paths: st.allowed_paths, required_capabilities: st.required_capabilities,
      allowed_transports: st.allowed_transports, owner_constraints: null})};
  st.feature_sha256 = frozenRouteFeatureBucket(features, st);
  const ref = {schema: 1, id: 'SYNTHETIC-reference', version: '1', policy_sha256: referencePolicySHA,
    config_sha256: exactConfigFingerprint(cfg(candidate)), harness_sha256: H('SYNTHETIC-harness'),
    metric_id: 'SYNTHETIC-reference-match', metric_version: '1'};
  const current_bindings = {rcc_source_sha256: sourceSHA, harness_sha256: ref.harness_sha256,
    native_binary_sha256: H('SYNTHETIC-native'), native_instructions_sha256: H('SYNTHETIC-full-native-instructions'),
    coverage_discriminator_sha256: H('SYNTHETIC-discriminator')};
  return {schema: 1, now_ms: 0, task: st, candidates, quality_reference: ref,
    selection_policy: {schema: 1, id: 'SYNTHETIC-selection', version: '1', policy_sha256: q.policy_sha256,
      requires_live_reference_fallback: true, max_samples: 1},
    execution_fallback: {candidate_id: candidate.id, config_sha256: ref.config_sha256,
      quality_reference_sha256: digest(ref), resource_estimate: null},
    calibration: null, forecasts: null, host_evidence: null, frozen_predictor_input: {current_bindings, features}};
}
function bundle(t, seed) {
  const stateDir = privateRoot(t), now = Date.now(), {current_bindings, features} = seed.frozen_predictor_input;
  const configurations = seed.candidates.map(c => exactConfigFingerprint(c.config));
  const samples = configurations.map((c, i) => ({id: H('SYNTHETIC-sample-' + i), origin: 'synthetic_fixture', split: 'development',
    source_sha256: H('SYNTHETIC-source-' + i), template_sha256: H('SYNTHETIC-template'), project_sha256: H('SYNTHETIC-project'),
    raw_attempt_sha256: H('SYNTHETIC-raw-' + i), final_lock_sha256: H('SYNTHETIC-final-' + i), label_evidence_sha256: H('SYNTHETIC-label-' + i),
    feature_bucket_sha256: seed.task.feature_sha256, config_sha256: c, outcome: 'completed', reference_match: true, task_success: false,
    resource: {accounting_scope: 'disjoint_remaining_node_total_v1', token_basis: 'input_output_include_cache_reasoning_subsets',
      components: Object.fromEntries(RESOURCE_COMPONENTS.map(k => [k, i + 1]))}}));
  const table = {schema: 1, kind: FROZEN_ROUTE_FORMAT, cells: configurations.map(c => ({feature_bucket_sha256: seed.task.feature_sha256,
    config_sha256: c, sample_ids: samples.filter(s => s.config_sha256 === c).map(s => s.id)}))};
  const lineage = {schema: 1, kind: 'development_lineage_v1', dataset_sha256: H('SYNTHETIC-DATASET'),
    label_schema: 'separate_reference_match_and_task_success_v1', samples};
  const file = (name, value) => {const bytes = Buffer.from(JSON.stringify(value)); return {name, bytes, sha256: H(bytes)};};
  const data = [file('table.json', table), file('lineage.json', lineage)];
  const manifest = {schema: 1, kind: FROZEN_ROUTE_FORMAT, id: 'SYNTHETIC-runtime-table', version: '1', proof_mode: 'synthetic_fixture',
    issued_at_ms: now - 1, valid_until_ms: now + 60000,
    runtime: {algorithm: FROZEN_ROUTE_FORMAT, node_major: 24, loader_sha256: H(fs.readFileSync(join(moduleRoot, 'frozen-route-artifacts.mjs'))),
      predictor_sha256: H(fs.readFileSync(join(moduleRoot, 'frozen-route-predictor.mjs')))},
    bindings: {...current_bindings, policy_sha256: seed.task.policy_sha256, reference_descriptor_sha256: digest(seed.quality_reference),
      environment_sha256: seed.task.environment_sha256, verifier_sha256: seed.task.verifier_sha256,
      candidate_pool_sha256: candidatePoolFingerprint(seed.candidates), config_sha256s: configurations,
      workload_classes: [seed.task.workload_class], scope: seed.task.scope},
    feature_schema_version: FROZEN_ROUTE_FEATURE_SCHEMA, minimum_samples: 1,
    rights: {status: 'cleared', evidence_sha256: H('SYNTHETIC-declaration-not-independent-rights-review')},
    split_audit: {status: 'not_performed'}, calibration: {status: 'unmeasured'}, holdout: {status: 'not_performed'},
    files: data.map(x => ({name: x.name, bytes: x.bytes.length, sha256: x.sha256}))};
  const m = file('manifest.json', manifest), parent = join(stateDir, 'routing-artifacts'), dir = join(parent, m.sha256);
  fs.mkdirSync(parent, {mode: 0o700}); fs.mkdirSync(dir, {mode: 0o700});
  for (const x of [m, ...data]) fs.writeFileSync(join(dir, x.name), x.bytes, {flag: 'wx', mode: 0o600});
  const loaded = loadFrozenRouteArtifacts({stateDir, mode: 'shadow', now_ms: now,
    registration: {schema: 1, manifest_sha256: m.sha256, manifest_bytes: m.bytes.length,
      loader_sha256: manifest.runtime.loader_sha256, predictor_sha256: manifest.runtime.predictor_sha256}});
  assert.equal(loaded.status, 'loaded_development', loaded.reason);
  return {loaded, infer: createFrozenRoutePredictor({artifacts: loaded.artifacts}), dir};
}
function completion(ticket) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256, selected_config: ticket.selected_config,
    acknowledged_config: ticket.selected_config, observed_config: null, status: 'succeeded', dispatch_stage: 'dispatched',
    side_effects: 'none', output: 'SYNTHETIC-canned-answer', execution_verified: true, task_verified: false,
    task_quality: 'execution_only', parity_state: 'unverified', native_receipt: '/private/SYNTHETIC/' + ticket.attempt_id,
    native_summary: null, usage: {provider_calls: 0}};
}
async function harness(t, options = {}, mutateEvidence = x => x) {
  const root = privateRoot(t), q = task(root), cat = catalog(q);
  const plan = resolveRoutePlan(hostPlan(q, cat), q, cat).plan;
  const seed = evidence({task: q, plan, node: plan.nodes[0], catalog: cat, candidate: cat.candidates[0]});
  const assets = bundle(t, seed), tickets = []; let plannerCalls = 0, evidenceCalls = 0;
  const runtime = await createRCCRuntime({stateDir: root, hostAutoPlan: true, catalog: async () => cat,
    execute: async ticket => {tickets.push(copy(ticket)); return completion(ticket);},
    adaptiveRoutingPolicy: policy(), proposeLocalPlan: () => {plannerCalls++; throw Error('canned no-model proposal skip');},
    frozenRoutePredictor: assets.infer,
    jointRouteEvidence: args => {evidenceCalls++; const input = evidence(args); return mutateEvidence(input) ?? input;}, ...options});
  t.after(() => runtime.close());
  const done = await (async () => {await runtime.submit(q); return runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});})();
  assert.equal(done.state, 'returned_unverified', done.error); assert.equal(tickets.length, 1);
  assert.equal(tickets[0].candidate_id, 'reference'); assert.equal(tickets[0].selected_config.model, 'gpt-6-astra');
  assert.equal(tickets[0].selected_config.effort, 'ultra'); assert.equal(tickets[0].instruction, q.request);
  assert.equal(done.result.task_verified, false); assert.equal(done.result.parity_state, 'unverified');
  return {root, q, cat, plan, seed, assets, runtime, tickets, done, saved: runtime._load(q.task_id), plannerCalls, evidenceCalls};
}

test('raw predictor callbacks and JSON flags reject BEFORE Core ownership/database creation', async t => {
  for (const value of [() => ({}), {predictor_inference_observed: true}, {approved: true}]) {
    const root = join(privateRoot(t), 'not-created');
    await assert.rejects(createRCCRuntime({stateDir: root, catalog: async () => {}, execute: async () => {},
      frozenRoutePredictor: value}), /adaptive_frozen_predictor_not_host_factory/);
    assert.equal(fs.existsSync(root), false);
  }
});
test('OFF has no artifact IO, planner or predictor observation and keeps original execution', async t => {
  let calls = 0;
  const opts = adaptiveRuntimeOptions({pluginConfig: {adaptive_routing: {schema: 1, mode: 'off'},
    frozen_route_artifacts: {schema: 1, manifest_sha256: H('missing')}}, stateDir: '/nonexistent/SYNTHETIC',
    complete: () => {calls++; throw Error('no model');}, lifetimeSignal: () => null});
  assert.equal(opts.frozenRoutePredictor, undefined);
  const h = await harness(t, opts); assert.equal(calls, 0); assert.equal(h.plannerCalls, 0);
  assert.equal(h.saved.joint_route_shadow, undefined); assert.equal(h.saved.adaptive_routing, undefined);
});
test('native catalog without prepared metadata stays typed unmeasured, original route unchanged', async t => {
  const h = await harness(t, {jointRouteEvidence: null});
  const row = h.saved.joint_route_shadow[0]; assert.equal(row.state, 'unmeasured');
  assert.equal(row.frozen_predictor.status, 'unmeasured'); assert.equal(row.frozen_predictor.predictor_inference_observed, false);
  assert.equal(row.frozen_predictor.inference_receipt, null); assert.equal(h.evidenceCalls, 0);
});
test('optional malformed/unavailable artifacts cannot fail task or manufacture inference', async t => {
  const opts = adaptiveRuntimeOptions({pluginConfig: {adaptive_routing: policy(), frozen_route_artifacts: {
    schema: 1, manifest_sha256: H('missing'), manifest_bytes: 10, loader_sha256: H('bad'), predictor_sha256: H('bad')}},
    stateDir: '/nonexistent/SYNTHETIC', complete: () => assert.fail('no model')});
  assert.equal(typeof opts.frozenRoutePredictor, 'function');
  const h = await harness(t, {...opts, proposeLocalPlan: () => {throw Error('fixture skip');}});
  const f = h.saved.joint_route_shadow[0].frozen_predictor;
  assert.equal(f.status, 'not_registered'); assert.equal(f.artifact_loaded, false); assert.equal(f.predictor_inference_observed, false);
});
test('loaded SYNTHETIC finite table produces actual branded DEV inference but NEVER calibration/route authority', async t => {
  const h = await harness(t), row = h.saved.joint_route_shadow[0], f = row.frozen_predictor;
  assert.equal(row.state, 'observed'); assert.equal(row.selection.decision, 'preserve_reference');
  assert.equal(row.selection.reason, 'calibration_missing_or_unmeasured'); assert.equal(row.predictor_executed, false);
  assert.equal(f.status, 'development_prediction'); assert.equal(f.predictor_inference_observed, true);
  assert.equal(f.inference_receipt.manifest_sha256, h.assets.loaded.artifacts.manifest_sha256);
  assert.equal(f.inference_receipt.task_id, h.q.task_id); assert.equal(f.inference_receipt.node_id, 'node_0');
  assert.equal(f.inference_receipt.request_sha256, h.q.request_sha256); assert.equal(f.inference_receipt.plan_sha256, digest(h.saved.plan));
  assert.equal(f.inference_receipt.source_snapshot_sha256, h.q.source_fingerprint);
  assert.equal(f.inference_receipt.proof_mode, 'synthetic_fixture'); assert.equal(f.inference_receipt.source_records_independently_verified, false);
  assert.equal(f.inference_receipt.model_calls, 0); assert.equal(f.calibration_validated, false);
  assert.equal(f.holdout_accepted, false); assert.equal(f.execution_authorized, false); assert.equal(f.live_route_change_authorized, false);
  assert.equal(f.quality_certificate, false); assert.equal(Object.hasOwn(f, 'predictions'), false);
  assert.equal(Object.hasOwn(row.selection, 'calibration'), false);
});
test('serialized inference flags do not survive WeakSet authority in Core defense-in-depth', async t => {
  const h = await harness(t), input = evidence({task: h.q, plan: h.saved.plan, node: h.saved.plan.nodes[0],
    catalog: h.cat, candidate: h.cat.candidates[0]});
  const genuine = h.assets.infer({selector_input: {...Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'frozen_predictor_input')), now_ms: Date.now()},
    ...input.frozen_predictor_input});
  assert.equal(isFrozenRouteInference(genuine), true);
  // Deliberate private-host mutation tests the secondary receipt check only;
  // constructor admission above independently rejects raw public callbacks.
  h.runtime.frozenRoutePredictor = () => copy(genuine);
  const f = h.runtime._frozenPredictorShadow(h.q, h.saved.plan.nodes[0], h.saved.plan, input);
  assert.equal(f.status, 'rejected'); assert.equal(f.predictor_inference_observed, false);
  assert.equal(f.inference_receipt, undefined);
});
for (const [name, change] of [
  ['request', x => {x.task.request_sha256 = H('foreign-request');}],
  ['plan', x => {x.task.plan_sha256 = H('foreign-plan');}],
  ['source', x => {x.task.source_snapshot_sha256 = H('foreign-context');}],
  ['projection instruction', x => {x.task.instructions_sha256 = H('foreign-policy');}],
]) test(`foreign ${name} fails independent Core binding before optional lookup`, async t => {
  const h = await harness(t, {}, change), row = h.saved.joint_route_shadow[0];
  assert.equal(row.state, 'rejected'); assert.equal(row.reason, 'joint_shadow_evidence_invalid');
  assert.equal(row.selection, null); assert.equal(row.frozen_predictor, undefined);
});
test('foreign current full-engine source cannot become current merely by artifact agreement', async t => {
  const h = await harness(t, {}, x => {x.frozen_predictor_input.current_bindings.rcc_source_sha256 = H('foreign');return x;});
  const f = h.saved.joint_route_shadow[0].frozen_predictor;
  assert.equal(f.status, 'rejected'); assert.equal(f.predictor_inference_observed, false);
});
