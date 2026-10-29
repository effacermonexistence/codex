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

test('OFF/unregistered paths perform no artifact IO and do not inspect registration getters', () => {
  let getters = 0; const bad = {get manifest_sha256() {getters++; throw Error('must not inspect');}};
  for (const x of [loadFrozenRouteArtifacts(), loadFrozenRouteArtifacts({mode: 'off', stateDir: '/not/a/real/path', registration: bad}),
    loadFrozenRouteArtifacts({mode: 'shadow', stateDir: '/not/a/real/path', registration: null})]) {
    assert.equal(x.status, 'not_registered'); assert.equal(x.io_performed, false); assert.equal(x.file_reads, 0); assert.equal(x.artifacts, null);
  }
  assert.equal(getters, 0);
});
test('exact private frozen development files load immutably without scientific authority', t => {
  const h = bundle(t), got = h.load(); assert.equal(got.status, 'loaded_development'); assert.equal(got.file_reads, 5);
  assert(isFrozenRouteArtifacts(got.artifacts)); assert(Object.isFrozen(got.artifacts.lineage.samples[0]));
  assert.equal(isFrozenRouteArtifacts(copy(got.artifacts)), false); assert.equal(got.calibration_validated, false);
  assert.equal(got.holdout_accepted, false); assert.equal(got.source_receipt.rights_independently_verified, false);
  assert.equal(got.source_receipt.manifest_sha256, h.registration.manifest_sha256);
  assert.equal(got.source_receipt.table_bytes_sha256, H(fs.readFileSync(join(h.dir, 'table.json'))));
  assert.throws(() => {got.artifacts.lineage.samples[0].task_success = true;}, TypeError);
});
for (const mode of ['empty', 'unmeasured']) test(`${mode} registry data remains non-calibrated and empty`, t => {
  const h = bundle(t, d => {d.manifest.proof_mode = mode; d.table.cells = []; d.lineage.samples = [];});
  const x = h.load(); assert.equal(x.status, 'loaded_development'); assert.equal(x.artifacts.table.cells.length, 0);
  assert.equal(x.source_receipt.calibration_validated, false);
});
for (const name of ['manifest.json', 'table.json', 'lineage.json']) {
  test(`modified exact registered bytes rejected: ${name}`, t => {
    const h = bundle(t); fs.appendFileSync(join(h.dir, name), ' ');
    assert.equal(h.load().status, 'quarantined');
  });
  test(`same-count renamed inventory rejected: ${name}`, t => {
    const h = bundle(t); fs.renameSync(join(h.dir, name), join(h.dir, 'renamed.json')); assert.equal(h.load().status, 'quarantined');
  });
  test(`symbolic alias rejected before reading foreign target: ${name}`, t => {
    const h = bundle(t), p = join(h.dir, name), target = join(h.stateDir, 'retained-' + name); fs.renameSync(p, target); fs.symlinkSync(target, p);
    assert.equal(h.load().status, 'quarantined');
  });
  test(`single-link custody required: ${name}`, t => {
    const h = bundle(t); fs.linkSync(join(h.dir, name), join(h.stateDir, 'extra-link')); assert.equal(h.load().reason, 'fr_file_custody');
  });
}
for (const mode of [0o644, 0o700]) test(`private non-executable artifact mode enforced: ${mode.toString(8)}`, t => {
  const h = bundle(t); fs.chmodSync(join(h.dir, 'table.json'), mode); assert.equal(h.load().reason, 'fr_file_custody');
});
test('nonregular FIFO is rejected without waiting on it', t => {
  const h = bundle(t), p = join(h.dir, 'table.json'); fs.unlinkSync(p);
  const r = spawnSync('mkfifo', [p]); assert.equal(r.status, 0); fs.chmodSync(p, 0o600);
  assert.equal(h.load().reason, 'fr_file_custody');
});
test('private canonical parent and bounded closed inventory required', t => {
  const h = bundle(t); fs.writeFileSync(join(h.dir, 'extra.json'), '{}', {mode: 0o600}); assert.equal(h.load().reason, 'fr_extra_file');
  fs.unlinkSync(join(h.dir, 'extra.json')); fs.chmodSync(join(h.stateDir, 'routing-artifacts'), 0o755); assert.equal(h.load().reason, 'fr_directory_private');
});
test('symlink root/relative stateDir cannot create a registered read path', t => {
  const h = bundle(t), alias = join(h.stateDir, 'alias'); fs.symlinkSync(h.dir, alias);
  assert.equal(h.load({stateDir: alias}).status, 'quarantined'); assert.equal(h.load({stateDir: 'relative/path'}).status, 'quarantined');
});
test('foreign UID and special bits execute the exact production fstat predicate, without privileged chown', () => {
  const fake = {isFile: () => true, nlink: 1n, size: 32n, uid: 1000n, mode: 0o100600n};
  assert.equal(frozenRouteFileCustody(fake, {uid: 1000}), true);
  assert.equal(frozenRouteFileCustody({...fake, uid: 1001n}, {uid: 1000}), false);
  assert.equal(frozenRouteFileCustody({...fake, mode: 0o104600n}, {uid: 1000}), false);
  assert.equal(frozenRouteFileCustody({...fake, isFile: () => false}, {uid: 1000}), false);
});
for (const transform of [s => s.replace('"schema":1', '"schema":1,"schema":1'),
  s => s.replace('"schema":1', '"schema":1,"\\u0073chema":1'), s => s + ' trailing',
  s => s.replace('"minimum_samples":1', '"minimum_samples":1e999')]) {
  test('closed JSON rejects duplicate/escaped duplicate/trailing/nonfinite even with correct outer SHA', t => {
    const h = bundle(t, () => {}, {manifest: transform}); assert.equal(h.load().status, 'quarantined');
  });
}
test('duplicate nested sample keys and raw NUL are not normalized away', t => {
  const a = bundle(t, () => {}, {lineage: s => s.replace('"reference_match":true', '"reference_match":true,"reference_match":false')});
  assert.equal(a.load().reason, 'fr_duplicate_key');
  const b = bundle(t, d => {d.manifest.id = 'bad\0id';}); assert.equal(b.load().reason, 'fr_string_bound');
});
test('accessors/cycles/sparse values rejected BEFORE getter execution', () => {
  let calls = 0; assert.throws(() => frozenRouteData({get value() {calls++; return 'no';}}), /fr_accessor_or_key/);
  assert.equal(calls, 0); const cycle = {}; cycle.loop = cycle; assert.throws(() => frozenRouteData(cycle));
  assert.throws(() => frozenRouteData([, 1])); assert.throws(() => frozenRouteData({x: NaN}));
});
for (const [name, change] of [
  ['calibrated', d => {d.manifest.calibration.status = 'calibrated';}],
  ['holdoutaccepted', d => {d.manifest.holdout.status = 'accepted';}],
  ['approvedflag', d => {d.manifest.approved = true;}],
  ['trainedflag', d => {d.manifest.trained = true;}],
  ['splitdisjointflag', d => {d.manifest.split_audit.status = 'disjoint_verified';}],
  ['holdoutrow', d => {d.lineage.samples[0].split = 'holdout';}],
  ['duplicatecell', d => {d.table.cells.push(copy(d.table.cells[0]));}],
  ['unreferencedsample', d => {d.table.cells[0].sample_ids = [];}],
  ['wrongcellconfig', d => {d.table.cells[0].config_sha256 = H('notcurrent');}],
  ['authnotqualityfailure', d => {d.lineage.samples[0].outcome = 'auth';}],
  ['overlapclaim', d => {d.manifest.split_audit.evidence_sha256 = H('notverified');}],
  ['implicitrights', d => {d.manifest.rights.evidence_sha256 = null;}],
  ['resourcecash', d => {d.lineage.samples[0].resource.components.cash_usd = 0;}],
]) test(`no scientific authority/unknown-field/identity substitution: ${name}`, t => {
  assert.equal(bundle(t, change).load().status, 'quarantined');
});
test('expired/future timestamps and wrong actual code hash/runtime reject', t => {
  const h = bundle(t); assert.equal(h.load({now_ms: NOW + 40000}).reason, 'fr_artifact_stale_or_future');
  assert.equal(h.load({now_ms: 0}).reason, 'fr_artifact_stale_or_future');
  const a = bundle(t, d => {d.manifest.runtime.loader_sha256 = H('foreign code');}); assert.equal(a.load().reason, 'fr_code_hash_mismatch');
  const b = bundle(t, d => {d.manifest.runtime.node_major = 25;}); assert.equal(b.load().reason, 'fr_runtime_mismatch');
});
test('bounded sizes reject oversized regular file without reading arbitrary bytes', t => {
  const h = bundle(t); fs.writeFileSync(join(h.dir, 'table.json'), Buffer.alloc(FROZEN_ROUTE_LIMITS.table_bytes + 1, 32));
  assert.equal(h.load().reason, 'fr_file_custody');
});
test('stable read detects same-inode mutation after the real read; no product hook added', t => {
  const h = bundle(t), target = join(h.dir, 'table.json'), inode = fs.statSync(target).ino, before = fs.readFileSync(target);
  const original = fs.readSync; let mutated = false;
  fs.readSync = function(fd, ...args) {
    const n = original.call(this, fd, ...args);
    if (!mutated && fs.fstatSync(fd).ino === inode) {mutated = true; const bytes = Buffer.from(before); bytes[bytes.length - 1] = 32; fs.writeFileSync(target, bytes);}
    return n;
  }; syncBuiltinESMExports();
  try {assert.equal(h.load().reason, 'fr_file_changed'); assert.equal(mutated, true);}
  finally {fs.readSync = original; syncBuiltinESMExports();}
});
test('frozen in-memory data never silently reloads edited files or gains live authority', t => {
  const h = bundle(t), x = h.load(); const before = digest(x.artifacts);
  fs.appendFileSync(join(h.dir, 'lineage.json'), ' '); assert.equal(digest(x.artifacts), before);
  assert.equal(h.load().status, 'quarantined'); assert.equal(x.calibration_validated, false);
});
test('unsupported live mode and descriptor path/URL substitutions reject without foreign reads', t => {
  const h = bundle(t); assert.equal(h.load({mode: 'covered_live'}).reason, 'fr_shadow_only');
  for (const leaf of ['../outside.json', '/outside.json', 'https://example.invalid/a.json']) {
    const x = bundle(t, () => {}, {manifest: s => s.replace('"name":"table.json"', '"name":' + JSON.stringify(leaf))});
    assert.equal(x.load().status, 'quarantined');
  }
});
test('invalid UTF8 bytes and special directory mode do not become normalized trusted data', t => {
  const h = bundle(t, () => {}, {manifest: s => {const b = Buffer.from(s); b[b.indexOf('SYNTHETIC-artifact')] = 255; return b;}});
  assert.equal(h.load().reason, 'fr_utf8');
  // Sticky is owner-settable even under /private/tmp's inherited wheel group;
  // macOS can silently clear a requested setgid bit for that foreign group.
  const x = bundle(t); fs.chmodSync(x.dir, 0o1700);
  assert.equal(fs.lstatSync(x.dir).mode & 0o7000, 0o1000, 'real negative mode established before loader call');
  assert.equal(x.load().reason, 'fr_directory_private');
});
test('manifest expected bytecount is externally bound and not replaced from the file', t => {
  const h = bundle(t); assert.equal(h.load({registration: {...h.registration, manifest_bytes: h.registration.manifest_bytes + 1}}).reason, 'fr_manifest_hash_or_size');
});
