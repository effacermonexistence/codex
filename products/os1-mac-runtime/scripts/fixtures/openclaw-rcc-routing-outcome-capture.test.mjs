// Actual PRIVATE synthetic files, never a provider/native invocation. Capture
// does not read the fake provider JSONL pointer or execute a checker.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, realpathSync, symlinkSync, linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {captureRoutingOutcome as capture} from '../../Resources/openclaw-os1-bridge/routing-outcome-capture.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
function setup(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'os1-capture-fixture-')); chmodSync(root, 0o700);
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const stateDir = join(root, 'state'), dir = join(stateDir, 'native-receipts');
  mkdirSync(stateDir, {mode: 0o700}); mkdirSync(dir, {mode: 0o700});
  const config = {surface: 'codex', transport: 'codex_app_server', account_id: 'synthetic-account', model: 'gpt-fixture',
    effort: 'low', tools: ['read_file'], scope: 'read_only', permission_profile: 'read_only', quota_pool: 'openai_codex',
    allowed_paths: ['/synthetic-owned-workspace'], configuration_sha256: sha('config')};
  const identity = {task_id: 'task-fixture', node_id: 'node-fixture', attempt_id: randomUUID(), candidate_id: 'candidate-fixture',
    request_sha256: sha('request'), source_fingerprint: sha('source'), policy_sha256: sha('policy'),
    configuration_sha256: config.configuration_sha256, quality_contract_sha256: null};
  const path = join(dir, randomUUID() + '.json');
  const result = {schema: 1, task_id: identity.task_id, node_id: identity.node_id, attempt_id: identity.attempt_id,
    candidate_id: identity.candidate_id, configuration_sha256: identity.configuration_sha256,
    selected_config: config, acknowledged_config: structuredClone(config), observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'Synthetic visible answer',
    native_receipt: path, usage: {input_tokens: 100, output_tokens: 20, cache_read_tokens: 80, metric: 'native_usage_observation'},
    native_turn_terminated: true, error: null,
    native_summary: JSON.stringify({status: 'returned_unverified', steps: [{provider: 'codex', model: config.model, effort: config.effort,
      session_id: 'explicit-session', native_record: {turn_id: 'explicit-turn', record_path: '/forbidden-must-not-read/provider.jsonl', persistence: 'verified'}}]})};
  const save = (bytes = Buffer.from(JSON.stringify(result))) => { writeFileSync(path, bytes, {mode: 0o600}); chmodSync(path, 0o600); return bytes; };
  save(); const args = {stateDir, identity, selectedConfig: config, result, attemptState: 'completed', origin: 'synthetic_fixture', now_ms: 1000};
  return {root, dir, path, config, identity, result, save, args, run: () => capture(args)};
}
test('exact synthetic adapter receipt is captured, SHA is raw adapter bytes not guessed provider JSONL', t => {
  const f = setup(t), raw = readFileSync(f.path), r = f.run();
  assert.equal(r.status, 'captured'); assert.equal(r.capture.adapter_receipt_sha256, sha(raw));
  assert.equal(r.capture.adapter_receipt_path, f.path); assert.equal(r.capture.adapter_receipt_bytes, raw.length);
  assert.equal(r.capture.record_basis, 'native_adapter_execution_record_not_provider_jsonl');
  assert.equal(r.capture.provider_native_record_read, false);
  assert.equal(r.record.native.execution_id, f.identity.attempt_id);
  assert.equal(r.capture.native_identity_basis, 'adapter_execution_envelope_attempt_id_not_provider_execution_id');
  assert.equal(r.record.native.session_id, 'explicit-session'); assert.equal(r.record.native.turn_id, 'explicit-turn');
  assert.equal(r.record.native.record_sha256, sha(raw)); assert.equal(r.record.result.output_sha256, sha(f.result.output));
  assert.equal(r.record.observed_config, null); assert.equal(r.record.attribution.actual_config, null);
  assert.equal(r.record.learning.correctness_label, null); assert.equal(r.record.learning.eligible, false);
  assert.equal(r.record.usage.total_tokens_observed, null); assert.equal(r.record.usage.quota_consumption, 'unknown');
  assert.equal(r.record.usage.cash_cost, 'unknown'); assert.equal(r.record.parity_state, 'unverified');
  assert.equal(r.task_adoption_changed, false); assert.equal(r.execution_authorized, false);
  assert.ok(Buffer.byteLength(JSON.stringify(r.record)) + 1 <= 8192);
  assert.equal(JSON.stringify(r.record).includes(f.path), false); assert.equal(JSON.stringify(r.record).includes(f.result.output), false);
  assert.notEqual(f.path, join(f.dir, f.identity.attempt_id + '.json'));
});
test('observed config is recorded ONLY when actual exact receipt supplies it', t => {
  const f = setup(t); f.result.observed_config = structuredClone(f.config); f.save(); const r = f.run();
  assert.equal(r.status, 'captured'); assert.equal(r.record.observed_config.model, f.config.model);
  assert.equal(r.record.learning.correctness_label, null);
});
test('missing ACK is never manufactured; failed unacknowledged attempt remains an observation', t => {
  const f = setup(t); delete f.result.acknowledged_config; f.result.execution_verified = false; f.result.status = 'failed';
  f.result.task_quality = 'failed'; f.save(); const r = f.run(); assert.equal(r.status, 'captured');
  assert.equal(r.record.acknowledged_config, null); assert.equal(r.record.learning.correctness_label, null);
});
test('execution-verified claim without ACK quarantines instead of restoring requested config', t => {
  const f = setup(t); delete f.result.acknowledged_config; f.save(); assert.equal(f.run().status, 'quarantined');
});
test('requested provider without ACK/observed/explicit summary remains unknown', t => {
  const f = setup(t); f.result.acknowledged_config = null; f.result.native_summary = null;
  f.result.execution_verified = false; f.result.status = 'failed'; f.result.task_quality = 'failed'; f.save();
  const r = f.run(); assert.equal(r.status, 'captured'); assert.equal(r.record.native.provider, 'unknown');
  assert.ok(r.unknown_fields.includes('actual_provider_origin_unavailable'));
});
test('partial/full adapter checker claims are not independently loaded or promoted', t => {
  const f = setup(t); f.result.operational_quality = {coverage: 'partial', witness_path: '/forbidden/checker.json'};
  f.save(); const r = f.run(); assert.equal(r.status, 'captured'); assert.equal(r.capture.reported_checker_coverage, 'partial');
  assert.equal(r.record.quality.kind, 'unknown'); assert.equal(r.record.learning.correctness_label, null);
  f.result.operational_quality.coverage = 'full'; f.result.task_verified = true; f.result.task_quality = 'task_verified'; f.save();
  assert.equal(f.run().record.learning.correctness_label, null);
});
test('default unknown origin stays unknown even with private receipt and adapter task_verified', t => {
  const f = setup(t); delete f.args.origin; f.result.task_verified = true; f.result.task_quality = 'task_verified'; f.save();
  const r = f.run(); assert.equal(r.record.origin, 'unknown'); assert.equal(r.record.learning.eligible, false);
});
test('missing or ambiguous summary IDs stay null, not path/request guesses', t => {
  const f = setup(t); f.result.native_summary = JSON.stringify({steps: [{provider: 'codex', model: 'wrong', effort: 'low', session_id: 'wrong'}]}); f.save();
  let r = f.run(); assert.equal(r.status, 'captured'); assert.equal(r.record.native.session_id, null); assert.equal(r.record.native.turn_id, null);
  f.result.native_summary = JSON.stringify({steps: [{session_id: 'one'}, {session_id: 'two'}]}); f.save();
  r = f.run(); assert.equal(r.record.native.session_id, null); assert.equal(r.record.native.turn_id, null);
  f.result.native_summary = null; delete f.result.native_turn_terminated; f.save(); assert.equal(f.run().record.native.turn_terminated, null);
});
for (const [name, mutate] of [
  ['foreign body attempt', f => { const body = {...f.result, attempt_id: randomUUID()}; f.save(Buffer.from(JSON.stringify(body))); }],
  ['foreign Core task', f => { f.args.identity = {...f.identity, task_id: 'foreign'}; }],
  ['selected config mismatch', f => { f.args.selectedConfig = {...f.config, model: 'other'}; }],
  ['ACK model mismatch', f => { f.result.acknowledged_config.model = 'other'; f.save(); }],
  ['observed effort mismatch', f => { f.result.observed_config = {...f.config, effort: 'ultra'}; f.save(); }],
  ['result differs from actual body', f => { f.result.output = 'not in receipt'; }],
  ['file mode public', f => chmodSync(f.path, 0o644)],
  ['directory mode public', f => chmodSync(f.dir, 0o755)],
  ['state root mode public', f => chmodSync(f.args.stateDir, 0o755)],
  ['hardlink receipt', f => linkSync(f.path, join(f.root, 'other-link'))],
  ['receipt directory as file', f => { rmSync(f.path); mkdirSync(f.path, {mode: 0o700}); }],
  ['empty receipt', f => f.save(Buffer.alloc(0))],
  ['oversize receipt', f => f.save(Buffer.alloc(2 * 1024 * 1024 + 1, 32))],
  ['invalid JSON', f => f.save(Buffer.from('{broken'))],
  ['invalid UTF8', f => f.save(Buffer.from([0x7b, 0xff, 0x7d]))],
  ['duplicate JSON key', f => f.save(Buffer.from(JSON.stringify(f.result).replace('"schema":1', '"schema":1,"schema":1')))],
  ['escaped duplicate JSON key', f => f.save(Buffer.from(JSON.stringify(f.result).replace('"schema":1', '"schema":1,"sch\\u0065ma":1')))],
  ['missing receipt', f => rmSync(f.path)],
]) test('quarantine capture only: ' + name, t => {
  const f = setup(t); mutate(f); const r = f.run(); assert.equal(r.status, 'quarantined'); assert.equal(r.record, null);
  assert.equal(r.task_adoption_changed, false); assert.equal(r.execution_authorized, false);
});
test('leaf symlink and parent symlink are rejected without reading their targets', t => {
  const f = setup(t), target = join(f.root, 'private-outside.json'); writeFileSync(target, JSON.stringify(f.result), {mode: 0o600});
  rmSync(f.path); symlinkSync(target, f.path); assert.equal(f.run().status, 'quarantined');
  rmSync(f.path); rmSync(f.dir, {recursive: true}); const outsideDir = join(f.root, 'outside'); mkdirSync(outsideDir, {mode: 0o700});
  symlinkSync(outsideDir, f.dir); assert.equal(f.run().status, 'quarantined'); assert.equal(readFileSync(target, 'utf8'), JSON.stringify(f.result));
});
test('outside, nested, non-UUID, relative and alias pointer cannot trigger scanning or arbitrary read', t => {
  const f = setup(t);
  for (const path of [join(f.root, 'outside.json'), join(f.dir, 'nested', randomUUID() + '.json'),
    join(f.dir, 'not-a-uuid.json'), './relative.json', `${f.dir}/../native-receipts/${f.path.split('/').at(-1)}`]) {
    const result = {...f.result, native_receipt: path}; const r = capture({...f.args, result}); assert.equal(r.status, 'quarantined');
  }
});
test('caller objects remain unchanged and capture does not mutate receipt bytes or permissions', t => {
  const f = setup(t), args = JSON.stringify(f.args), before = readFileSync(f.path); const r = f.run();
  assert.equal(r.status, 'captured'); assert.equal(JSON.stringify(f.args), args); assert.deepEqual(readFileSync(f.path), before);
  assert.ok(Object.isFrozen(r.record));
});
