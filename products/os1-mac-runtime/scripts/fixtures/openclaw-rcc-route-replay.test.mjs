// K9: the routing ledger names each attempt's delivery basis and its check
// (delivery_basis, check_id, check_outcome, check_label), and
// scripts/route-replay.mjs `delivery` audits delivery_policy_valid offline
// (§2.2): a certified basis needs its source's pass on THIS attempt; a
// reference, escalated reference or owner tuple needs none. Synthetic
// records, temp files and a real durable Core with temp SQLite and a fake
// executor: no provider, model, network, real HOME or installed app.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LOCAL_WORKER_MODEL, checkIdOf, createRCCRuntime, deliveryBasisOf, hostContextFingerprint, openRoutingLedger,
  registerNodeVerifiers } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import { LOCAL_WORKER_MODEL as REPLAY_LOCAL_WORKER_MODEL, NON_DELIVERY_STATES, auditDeliveryPolicy, canonicalJSON,
  parseLedgerText } from '../route-replay.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'route-replay.mjs');
const sha = text => createHash('sha256').update(text).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-route-replay-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + '\n';
const audit = (records, options = {}) => auditDeliveryPolicy({ledgers: [{path: 'fixture', text: jsonl(records)}], ...options});
const rules = report => report.violations.map(v => `${v.rule}:${v.attempt_id}`).sort();
// One synthetic K9 record; `patch` overrides any field.
function record(basis, patch = {}) {
  const certified = basis.startsWith('certified:');
  const source = certified ? basis.slice('certified:'.length) : null;
  const checkID = source === null ? null : source === 'exact' ? 'exact_arithmetic_v1' :
    source === 'contract' ? 'contract:' + sha('contract') : source.startsWith('class:') ? source + ':nonempty_text' : source;
  const label = certified && !source.startsWith('class:') ?
    {score_space: 'check_acceptance_v1', check_id: checkID, soundness: 'sound_full', outcome: 'pass'} : null;
  return {schema: 1, task_id: 'task-' + randomUUID(), node_id: 'node_0', attempt_id: randomUUID(),
    family: 'trivial:read_only:agent', route_class: certified ? 'trivial' : 'deep', scope: 'read_only',
    surface_kind: 'agent', surface: 'codex', quota_pool: 'openai_codex', model: 'gpt-6-luna', effort: 'low',
    route_kind: certified ? 'tier' : 'reference', host_route_kind: null, reference_effort: 'ultra',
    ladder: certified ? {cheap_effort: 'low', reference_effort: 'ultra', cheap_model: 'gpt-6-luna',
      reference_model: 'gpt-6-astra'} : null,
    tier: 'fast', escalated: basis === 'reference_escalated', usage: {input_tokens: 4, output_tokens: 2},
    quota_remaining_fraction: 0.7, execution_verified: true, task_quality: 'execution_only',
    verifier_outcome: 'not_registered', attempt_state: 'completed', escalation_outcome: null, dispatched_failure: null,
    dispatched_at_ms: 1, settled_at_ms: 2, delivery_basis: basis, check_id: checkID,
    check_outcome: certified ? 'pass' : null, check_label: label,
    stratum: {request_class: 'readonly_lookup', turn: 'first', has_materials: false, context_bytes: 10}, ...patch};
}
// A pre-K9 record: no delivery_basis or check fields.
function legacy(patch = {}) {
  const value = record('reference', patch);
  for (const key of ['delivery_basis', 'check_id', 'check_outcome', 'check_label', 'stratum']) delete value[key];
  return value;
}
const VALID = () => [
  record('reference'),
  record('reference_escalated'),
  record('owner_words', {route_kind: 'explicit'}),
  record('certified:contract'),
  record('certified:exact', {route_kind: 'explicit_route', host_route_kind: 'tier'}),
  record('certified:exact', {check_outcome: 'not_returned', attempt_state: 'ladder_not_returned',
    escalation_outcome: 'escalated', check_label: {score_space: 'check_acceptance_v1', check_id: 'exact_arithmetic_v1',
      soundness: 'sound_full', outcome: 'not_returned'}}),
  record('certified:class:c1', {check_label: null}),
  record('certified:verifier:family-a'),
];

test('deliveryBasisOf and checkIdOf name the admitting source, never a model or text', () => {
  const ladder = (admitted_by, extra = {}) => ({source: 'tier', admitted_by, certificate_id: null, format_check: null,
    escalated: false, ...extra});
  const cases = [
    [{routeClass: 'trivial', routeKind: 'tier', ladder: ladder('contract')}, 'certified:contract'],
    [{routeClass: 'trivial', routeKind: 'tier', ladder: ladder('exact', {exact_answer: '4'})}, 'certified:exact'],
    [{routeClass: 'trivial', routeKind: 'tier', ladder: ladder('verifier', {certificate_id: 'family-a'})},
      'certified:verifier:family-a'],
    [{routeClass: 'trivial', routeKind: 'tier', ladder: ladder('class', {certificate_id: 'c1'})}, 'certified:class:c1'],
    // An older build's descent without its admitting source, or a verifier
    // without its certificate: never certified by the record alone.
    [{routeClass: 'trivial', routeKind: 'tier', ladder: {source: 'tier', cheap_effort: 'low'}}, 'certified:unrecorded'],
    [{routeClass: 'trivial', routeKind: 'tier', ladder: ladder('verifier')}, 'certified:unrecorded'],
    [{routeClass: 'trivial', routeKind: 'tier', ladder: null}, 'certified:unrecorded'],
    [{routeClass: 'trivial', routeKind: 'reference', ladder: ladder('contract', {escalated: true})}, 'reference_escalated'],
    [{routeClass: 'deep', routeKind: 'reference', reason: 'resolver;route_reference;admitted_reference_owner_words;tier_frontier'},
      'owner_words'],
    [{routeClass: 'deep', routeKind: 'explicit', reason: 'resolver;route_explicit'}, 'owner_words'],
    [{routeClass: 'deep', routeKind: 'reference', reason: 'resolver;route_reference;admitted_reference_uncertified'}, 'reference'],
    [{routeClass: null, explicitRoute: true}, 'owner_words'],
    [{routeClass: null}, 'unbound'],
    [{routeClass: 'deep', routeKind: 'execution_only'}, 'unclassified'],
    [{routeClass: 'trivial', routeKind: 'tier', ladder: ladder('verifier', {certificate_id: 'bad:id'})}, 'unclassified'],
  ];
  for (const [input, expected] of cases) assert.equal(deliveryBasisOf(input), expected, JSON.stringify(input));
  assert.equal(checkIdOf('certified:exact'), 'exact_arithmetic_v1');
  assert.equal(checkIdOf('certified:contract', {contractSHA256: sha('c')}), 'contract:' + sha('c'));
  assert.equal(checkIdOf('certified:contract', {contractSHA256: 'not a hash'}), 'contract');
  assert.equal(checkIdOf('certified:verifier:family-a'), 'verifier:family-a');
  assert.equal(checkIdOf('certified:class:c1', {formatCheck: 'nonempty_text'}), 'class:c1:nonempty_text');
  assert.equal(checkIdOf('certified:class:c1'), null);
  for (const basis of ['reference', 'reference_escalated', 'owner_words', 'unbound', 'certified:unrecorded', 'x'])
    assert.equal(checkIdOf(basis), null, basis);
});

test('route-replay delivery: one valid record of each basis passes; owner tuples are counted apart', () => {
  const report = audit(VALID());
  assert.equal(report.verdict, 'PASS', canonicalJSON(report.violations));
  assert.equal(report.exit_code, 0);
  assert.deepEqual(report.violations, []);
  assert.equal(report.counts.k9_records, 8);
  assert.deepEqual(report.owner_words, {attempts: 1, possibly_delivered: 1});
  assert.equal(report.by_basis['certified:exact'].attempts, 2);
  assert.equal(report.by_basis['certified:exact'].possibly_delivered, 1);
  assert.equal(report.delivery_population, 'attempt_state_fail_closed');
  assert.equal(report.claim_boundary, 'policy enforcement only; not accepted_B, quality parity or quota saving');
  // Deterministic: the same input gives byte-identical output.
  assert.equal(canonicalJSON(audit(VALID().map((r, i) => ({...r, attempt_id: `a-${i}`, task_id: 't'})))),
    canonicalJSON(audit(VALID().map((r, i) => ({...r, attempt_id: `a-${i}`, task_id: 't'})))));
});

test('route-replay delivery: an unchecked cheaper delivery fails (the synthetic row of K9)', () => {
  for (const basis of ['certified:class:c1', 'certified:exact', 'certified:contract', 'certified:verifier:family-a']) {
    const bad = record(basis, {check_outcome: 'not_run', check_label: null});
    const report = audit([...VALID(), bad]);
    assert.equal(report.verdict, 'FAIL', basis);
    assert.equal(report.exit_code, 1, basis);
    assert.deepEqual(rules(report), [`certified_delivery_without_pass:${bad.attempt_id}`], basis);
    assert.equal(report.violations[0].delivery_basis, basis);
    assert.equal(report.violations[0].check_outcome, 'not_run');
  }
  // A certifier gone at adoption, a failed check or a missing outcome is no pass.
  for (const outcome of ['certifier_unavailable', 'fail', 'not_returned', null])
    assert.equal(audit([record('certified:verifier:family-a', {check_outcome: outcome, check_label: null})]).verdict,
      'FAIL', String(outcome));
});

test('route-replay delivery: a cheaper route cannot be laundered as a reference, and a label cannot overclaim', () => {
  const laundered = record('reference', {route_kind: 'tier'});
  const named = record('owner_words', {route_kind: 'explicit_route', host_route_kind: 'tier'});
  const notEscalated = record('reference', {escalated: true});
  const escalatedTier = record('certified:contract', {escalated: true});
  const referenceTier = record('certified:contract', {route_kind: 'reference', ladder: null});
  const report = audit([laundered, named, notEscalated, escalatedTier, referenceTier]);
  assert.equal(report.verdict, 'FAIL');
  assert.deepEqual(rules(report), [
    `certified_basis_route_mismatch:${escalatedTier.attempt_id}`, `certified_basis_route_mismatch:${referenceTier.attempt_id}`,
    `escalation_basis_mismatch:${notEscalated.attempt_id}`,
    `tier_route_without_certified_basis:${laundered.attempt_id}`, `tier_route_without_certified_basis:${named.attempt_id}`,
  ].sort());
  // §4.3: a class format check never carries a sound_full label; a label
  // must name the record's own check and outcome; a reference has no check.
  const classLabel = record('certified:class:c1', {check_label: {score_space: 'check_acceptance_v1',
    check_id: 'class:c1:nonempty_text', soundness: 'sound_full', outcome: 'pass'}});
  const wrongOutcome = record('certified:contract', {check_label: {score_space: 'check_acceptance_v1',
    check_id: 'contract:' + sha('contract'), soundness: 'sound_full', outcome: 'fail'}});
  const referenceCheck = record('reference', {check_outcome: 'pass'});
  const labels = audit([classLabel, wrongOutcome, referenceCheck]);
  assert.deepEqual(rules(labels), [`check_fields_on_uncertified_basis:${referenceCheck.attempt_id}`,
    `check_label_invalid:${classLabel.attempt_id}`, `check_label_invalid:${wrongOutcome.attempt_id}`].sort());
});

test('route-replay delivery: fail closed on states that may still deliver, and on unadmitted bases', () => {
  for (const state of ['handback_returned', 'source_candidate_returned', 'held', 'operational_checker_held',
    'quality_mismatch', 'node_verifier_pending', 'a_state_a_later_build_adds']) {
    const value = record('certified:contract', {attempt_state: state, check_outcome: 'not_run', check_label: null});
    assert.deepEqual(rules(audit([value])), [`certified_delivery_without_pass:${value.attempt_id}`], state);
  }
  for (const basis of ['certified:unrecorded', 'unbound', 'unclassified', 'zero_model', 'certified:verifier:']) {
    const delivered = record('reference', {delivery_basis: basis});
    assert.deepEqual(rules(audit([delivered])), [`unadmitted_delivery:${delivered.attempt_id}`], basis);
    for (const state of NON_DELIVERY_STATES)
      assert.equal(audit([record('reference', {delivery_basis: basis, attempt_state: state})]).verdict, 'PASS',
        `${basis} in ${state} delivered nothing`);
  }
  // A certified attempt that provably delivered nothing needs no pass.
  for (const state of NON_DELIVERY_STATES)
    assert.equal(audit([record('certified:contract', {attempt_state: state, check_outcome: 'not_run', check_label: null})]).verdict,
      'PASS', state);
  assert.equal(audit([record('zero_model:deterministic_no_model', {route_kind: 'adapter_bound'})]).verdict, 'PASS');
});

test('route-replay delivery: legacy records are counted, never proof', () => {
  const report = audit([legacy({route_kind: 'execution_only'}),
    legacy({route_kind: 'explicit_route', host_route_kind: 'tier'}),
    legacy({route_kind: 'tier', verifier_outcome: 'pass'}),
    legacy({route_kind: 'tier', attempt_state: 'ladder_not_returned'}), legacy()]);
  assert.equal(report.verdict, 'NO_EVIDENCE');
  assert.equal(report.exit_code, 2);
  assert.deepEqual([report.legacy.records, report.legacy.unprovable_lower_tuple_delivery,
    report.legacy.explicit_exact_inferred], [5, 2, 1]);
  assert.match(report.legacy.note, /inference/);
  const strict = auditDeliveryPolicy({ledgers: [{text: jsonl([legacy({route_kind: 'execution_only'})])}], includeLegacy: true});
  assert.equal(strict.verdict, 'FAIL');
  // Legacy beside valid K9 records: PASS unless --include-legacy.
  assert.equal(audit([...VALID(), legacy({route_kind: 'tier'})]).verdict, 'PASS');
  assert.equal(audit([...VALID(), legacy({route_kind: 'tier'})], {includeLegacy: true}).verdict, 'FAIL');
});

test('route-replay delivery: a torn, foreign or conflicting ledger is incomplete, never PASS', () => {
  const lines = jsonl(VALID());
  const torn = lines.slice(0, -1) + '\n{"schema":1,"attempt_id"';
  const cases = {
    'torn last line': torn,
    'no final newline': lines.slice(0, -1),
    'garbage in the middle': lines.replace('\n', '\n{not json\n'),
    'schema 2': lines + JSON.stringify({...record('reference'), schema: 2}) + '\n',
    'an array line': lines + '[]\n',
  };
  for (const [name, text] of Object.entries(cases)) {
    const report = auditDeliveryPolicy({ledgers: [{path: 'x', text}]});
    assert.equal(report.verdict, 'INCOMPLETE', name);
    assert.equal(report.exit_code, 2, name);
    assert.ok(report.counts.unreadable_lines >= 1, name);
  }
  assert.deepEqual(parseLedgerText(Buffer.from([0xff, 0xfe, 0x0a])), {records: [], lines: 1, unreadable: 1});
  // The same attempt in two generations: identical counts once, conflicting
  // copies are no evidence at all.
  const one = record('certified:contract');
  const same = auditDeliveryPolicy({ledgers: [{text: jsonl([one])}, {text: jsonl([one])}]});
  assert.equal(same.verdict, 'PASS'); assert.equal(same.counts.duplicate_identical, 1); assert.equal(same.counts.k9_records, 1);
  const conflict = auditDeliveryPolicy({ledgers: [{text: jsonl([one])}, {text: jsonl([{...one, check_outcome: 'not_run'}])}]});
  assert.equal(conflict.verdict, 'INCOMPLETE'); assert.equal(conflict.counts.identity_conflicts, 1);
  // A real violation is still reported as FAIL beside unreadable lines.
  assert.equal(auditDeliveryPolicy({ledgers: [{text: torn + '\n' + JSON.stringify(record('unbound')) + '\n'}]}).verdict, 'FAIL');
});

// A checkpointed copy of the Core store with the given task snapshots.
function snapshotsDB(path, snapshots) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE tasks (task_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL)');
  for (const snapshot of snapshots)
    db.prepare('INSERT INTO tasks VALUES(?,?,?)').run(snapshot.task.task_id, 'f', JSON.stringify(snapshot));
  db.close();
}
function snapshotOf(taskID, state, children, extra = {}) {
  return {task: {task_id: taskID, request: 'PRIVATE-REQUEST-TEXT'}, state, children,
    result: ['completed', 'returned_unverified'].includes(state) ? {output: 'PRIVATE-OUTPUT-TEXT'} : null, ...extra};
}
const child = (value, output = 'PRIVATE-OUTPUT-TEXT', state = 'completed') => ({id: value.node_id, state,
  attempt_id: value.attempt_id, attempt_history: [{attempt_id: value.attempt_id}], instruction: 'PRIVATE-INSTRUCTION',
  output});
function cli(args, options = {}) {
  try {
    return {status: 0, stdout: execFileSync(process.execPath, [script, ...args], {encoding: 'utf8', stdio: 'pipe', ...options})};
  } catch (error) { return {status: error.status, stdout: error.stdout, stderr: error.stderr}; }
}

test('route-replay delivery CLI: exit codes, read-only inputs, an exclusive --out and snapshot delivery', async t => {
  const dir = await fixture(t);
  const ledger = join(dir, 'routing-ledger.jsonl');
  const valid = VALID();
  await writeFile(ledger, jsonl(valid), {mode: 0o600});
  const before = await stat(ledger);
  const passed = cli(['delivery', '--ledger', ledger]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(JSON.parse(passed.stdout).verdict, 'PASS');
  assert.equal(JSON.parse(passed.stdout).inputs.ledgers[0].sha256, sha(await readFile(ledger)));
  const after = await stat(ledger);
  assert.deepEqual([after.size, after.mtimeMs, after.mode], [before.size, before.mtimeMs, before.mode], 'input untouched');
  const failing = join(dir, 'failing.jsonl');
  await writeFile(failing, jsonl([...valid, record('certified:class:c1', {check_outcome: 'not_run', check_label: null})]));
  assert.equal(cli(['delivery', '--ledger', failing]).status, 1);
  const legacyOnly = join(dir, 'legacy.jsonl');
  await writeFile(legacyOnly, jsonl([legacy({route_kind: 'execution_only'})]));
  assert.equal(cli(['delivery', '--ledger', legacyOnly]).status, 2);
  assert.equal(cli(['delivery', '--ledger', legacyOnly, '--include-legacy']).status, 1);
  // Two generations, rotated first.
  assert.equal(cli(['delivery', '--ledger', legacyOnly, '--ledger', ledger]).status, 0);
  // Usage and input errors: 64.
  const link = join(dir, 'link.jsonl');
  await symlink(ledger, link);
  for (const args of [[], ['no-such-subcommand'], ['delivery'], ['delivery', ledger], ['delivery', '--ledger'],
    ['delivery', '--ledger', join(dir, 'missing.jsonl')], ['delivery', '--ledger', link], ['delivery', '--ledger', dir],
    ['delivery', '--ledger', ledger, '--bogus'], ['delivery', '--ledger', ledger, '--out', ledger]])
    assert.equal(cli(args).status, 64, JSON.stringify(args));
  // --out: a new 0600 file with the same report; never overwritten.
  const out = join(dir, 'report.json');
  const written = cli(['delivery', '--ledger', ledger, '--out', out]);
  assert.equal(written.status, 0); assert.equal(written.stdout, '');
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  assert.equal(await readFile(out, 'utf8'), passed.stdout);
  assert.equal(cli(['delivery', '--ledger', ledger, '--out', out]).status, 64);

  // --snapshots: the delivered population comes from task results.
  const [, , , contract] = valid;
  const zeroTask = snapshotOf('task-zero', 'completed', [{id: 'local-core', state: 'completed', attempt_id: null,
    attempt_history: [], output: '4'}], {plan_provenance: 'deterministic_no_model'});
  const db = join(dir, 'copy.sqlite');
  snapshotsDB(db, [snapshotOf(contract.task_id, 'completed', [child(contract)]), zeroTask,
    snapshotOf(valid[0].task_id, 'held', [child(valid[0])])]);
  const snap = cli(['delivery', '--ledger', ledger, '--snapshots', db]);
  assert.equal(snap.status, 0, snap.stderr);
  const report = JSON.parse(snap.stdout);
  assert.equal(report.delivery_population, 'task_result_and_attempt_state');
  assert.deepEqual([report.delivery.tasks_read, report.delivery.delivered_tasks, report.delivery.delivered_children],
    [3, 2, 2]);
  assert.deepEqual(report.delivery.by_basis, {'certified:contract': 1, 'zero_model:deterministic_no_model': 1});
  assert.equal(report.inputs.snapshots.sha256, sha(await readFile(db)));
  for (const secret of ['PRIVATE-REQUEST-TEXT', 'PRIVATE-OUTPUT-TEXT', 'PRIVATE-INSTRUCTION'])
    assert.ok(!snap.stdout.includes(secret), secret);
  // A certified output retained in a partial result is delivered: its record
  // needs the pass even in a state the ledger alone counts as undelivered.
  const retained = record('certified:contract', {attempt_state: 'ladder_not_returned', check_outcome: 'not_run',
    check_label: null});
  const partial = join(dir, 'partial.jsonl');
  await writeFile(partial, jsonl([retained]));
  const partialDB = join(dir, 'partial.sqlite');
  snapshotsDB(partialDB, [snapshotOf(retained.task_id, 'returned_unverified', [child(retained, 'kept', 'held')])]);
  assert.equal(cli(['delivery', '--ledger', partial]).status, 0, 'the ledger alone cannot see the partial');
  const partialReport = cli(['delivery', '--ledger', partial, '--snapshots', partialDB]);
  assert.equal(partialReport.status, 1);
  assert.deepEqual(rules(JSON.parse(partialReport.stdout)), [`certified_delivery_without_pass:${retained.attempt_id}`]);
  // A delivered child whose attempt record is missing from a task the ledger
  // covers is incomplete; a task outside the ledger's window is counted.
  const missingDB = join(dir, 'missing.sqlite');
  snapshotsDB(missingDB, [snapshotOf(contract.task_id, 'completed', [child({...contract, attempt_id: randomUUID()})]),
    snapshotOf('task-older', 'completed', [child({node_id: 'n', attempt_id: randomUUID()})])]);
  const missing = JSON.parse(cli(['delivery', '--ledger', ledger, '--snapshots', missingDB]).stdout);
  assert.equal(missing.verdict, 'INCOMPLETE');
  assert.deepEqual([missing.delivery.missing_attempt_records, missing.delivery.tasks_outside_ledger_window], [1, 1]);
  // An attemptless delivered child outside the zero-model path: FAIL.
  const strayDB = join(dir, 'stray.sqlite');
  snapshotsDB(strayDB, [snapshotOf('task-stray', 'completed', [{id: 'x', attempt_id: null, attempt_history: [],
    output: 'y'}])]);
  assert.equal(cli(['delivery', '--ledger', ledger, '--snapshots', strayDB]).status, 1);
  // A store with a -wal or -shm beside it may be live: refused.
  await writeFile(db + '-wal', '');
  assert.equal(cli(['delivery', '--ledger', ledger, '--snapshots', db]).status, 64);
  await rm(db + '-wal');
  await writeFile(join(dir, 'not-a-store.sqlite'), 'not sqlite');
  assert.equal(cli(['delivery', '--ledger', ledger, '--snapshots', join(dir, 'not-a-store.sqlite')]).status, 64);
});

test('route-replay delivery: a held, failed or cancelled task\'s partial result delivers; a gap there is never PASS', () => {
  for (const state of ['held', 'failed', 'cancelled']) {
    // The failed node's record exists; the retained child's record is lost.
    const failedNode = record('reference', {attempt_state: 'failed'});
    const kept = {node_id: 'node_1', attempt_id: randomUUID()};
    const partial = (children, result = {output: 'PRIVATE-OUTPUT-TEXT'}) => [{task_id: failedNode.task_id,
      snapshot: {...snapshotOf(failedNode.task_id, state, children), result}}];
    const gap = audit([failedNode], {snapshots: partial([child(failedNode, null, 'failed'), child(kept)])});
    assert.deepEqual([gap.verdict, gap.delivery.delivered_tasks, gap.delivery.delivered_children,
      gap.delivery.missing_attempt_records], ['INCOMPLETE', 1, 1, 1], state);
    // Without a retained result nothing was delivered.
    const none = audit([failedNode], {snapshots: partial([child(failedNode, null, 'failed'), child(kept)], null)});
    assert.deepEqual([none.verdict, none.delivery.delivered_tasks], ['PASS', 0], state);
    // A certified output retained there needs its pass on THIS attempt.
    const unchecked = record('certified:contract', {task_id: failedNode.task_id, node_id: 'node_1',
      check_outcome: 'not_run', check_label: null});
    const fail = audit([failedNode, unchecked], {snapshots: partial([child(failedNode, null, 'failed'), child(unchecked)])});
    assert.equal(fail.verdict, 'FAIL', state);
    assert.deepEqual(rules(fail), [`certified_delivery_without_pass:${unchecked.attempt_id}`], state);
  }
});

test('route-replay delivery: a completed deterministic DAG node is zero_model, any other attemptless child FAILs', async t => {
  assert.equal(REPLAY_LOCAL_WORKER_MODEL, LOCAL_WORKER_MODEL, 'the audit mirrors the runtime local model execution row');
  // A real durable runtime: a v2 plan of two deterministic nodes on a
  // host-computed local exact row. No attempt, no ledger record, no model.
  const dir = await fixture(t), text = 'Send independent arithmetic requests', policy = 'Deterministic node fixture policy';
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  const request = {schema: 1, task_id: randomUUID(), request: text, objective: text, request_sha256: sha(text),
    source_fingerprint: hostContextFingerprint(host), policy_sha256: sha(policy), mode: 'auto', material_refs: [],
    host_context: host, policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policy), text: policy},
    budget: {max_attempts: 1, max_parallel: 2, max_cost_units: null, max_duration_ms: 20_000}, result_contract_version: 2};
  const now = Date.now();
  const local = {id: 'local-exact', surface: 'local', transport: 'local', account_id: 'fixture', model: 'exact',
    effort: 'none', tools: [], scope: 'read_only', permission_profile: 'read_only', quota_pool: 'none', allowed_paths: [],
    configuration_sha256: sha('local-exact'), availability: 'available', availability_observed_at_ms: now - 1,
    availability_valid_until_ms: now + 30_000, quota_remaining_fraction: null, quota_observed_at_ms: null,
    quota_valid_until_ms: null, quality_state: 'policy_admitted', estimated_cost_units: 1};
  const deterministic = (id, instruction) => ({id, candidate_id: local.id, instruction, dependencies: [],
    kind: 'deterministic', scope: 'read_only', owned_paths: [], context_refs: []});
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state'), maximumWorkers: 2, maximumReadWorkersPerPool: 2,
    catalog: async q => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, candidates: [local]}),
    plan: async ({task: q}) => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
      nodes: [deterministic('d', '1+1'), deterministic('e', '2+2')], final_node_id: null}),
    execute: async () => { throw Error('a deterministic node never executes a model'); },
    verifyTask: () => { throw Error('no parent adoption'); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
  assert.equal(done.state, 'returned_unverified', done.error);
  const stored = runtime._load(request.task_id);
  assert.ok(stored.plan_provenance !== 'deterministic_no_model', 'a DAG plan, not the task-level zero-model path');
  assert.deepEqual(stored.children.map(c => [c.id, c.state, c.attempt_id, c.attempt_history.length]),
    [['d', 'completed', null, 0], ['e', 'completed', null, 0]]);
  // The ledger holds other tasks' valid records; this task has none.
  const ledgers = [{path: 'fixture', text: jsonl(VALID())}];
  const auditOne = snapshot => auditDeliveryPolicy({ledgers,
    snapshots: [{task_id: request.task_id, snapshot: JSON.stringify(snapshot)}]});
  const report = auditOne(stored);
  assert.equal(report.verdict, 'PASS', JSON.stringify(report.violations));
  assert.deepEqual(report.delivery.by_basis, {'zero_model:deterministic_node': 2});
  // Fail closed: the same attemptless child is a violation unless it is a
  // completed deterministic plan node on a host-computed local exact row.
  const variants = {
    not_completed: s => { s.children[0].state = 'held'; },
    agent_plan_node: s => { s.plan.nodes[0].kind = 'agent'; },
    not_in_plan: s => { s.plan.nodes = s.plan.nodes.filter(n => n.id !== 'd'); },
    remote_row: s => { Object.assign(s.children[0].selected_config, {surface: 'codex', transport: 'codex_app_server'}); },
    quota_pool: s => { s.children[0].selected_config.quota_pool = 'openai_codex'; },
    tools: s => { s.children[0].selected_config.tools = ['read']; },
    local_model_row: s => { s.children[0].selected_config.model = LOCAL_WORKER_MODEL; },
    no_config: s => { s.children[0].selected_config = null; }};
  for (const [label, mutate] of Object.entries(variants)) {
    const snapshot = structuredClone(stored);
    mutate(snapshot);
    const failed = auditOne(snapshot);
    assert.equal(failed.verdict, 'FAIL', label);
    assert.deepEqual(failed.violations.map(v => `${v.rule}:${v.node_id}`), ['delivered_without_attempt:d'], label);
  }
});

// ---- Core: the records a real durable runtime writes. ----
const policyText ='RCC route replay fixture policy: candidates do not grant authority.';
const LOOKUP = 'What does the interval rule in this workspace mean?';
function task(dir, request = LOOKUP) {
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, model, effort) {
  const now = Date.now();
  return {id, surface: 'codex', transport: 'codex_app_server', account_id: 'account-1', model, effort,
    tools: ['read', 'execute'], scope: 'read_only', permission_profile: 'read_only', quota_pool: 'openai_codex',
    allowed_paths: [], configuration_sha256: sha('config:' + id), availability: 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
function catalog(request, facts = {}) {
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    candidates: [row('astra', 'gpt-6-astra', 'max'), row('luna', 'gpt-6-luna', 'low')],
    model_tiers: {'gpt-6-astra': 'frontier', 'gpt-6-luna': 'fast'}, owner_scope: 'read_only',
    chat_lane_eligible: false, request_class: 'readonly_lookup', ...facts};
}
const contract = request => ({coverage: 'full', scope: 'read_only', objective_sha256: request.request_sha256,
  contract_sha256: sha('contract'), context_sha256: sha(''), start_tree_sha256: sha('tree'),
  reference_policy_sha256: request.policy_sha256, valid_until_ms: Date.now() + 600_000, bindings_checked: true});
function execution(ticket, output = 'answer', patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output,
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: null, native_turn_terminated: true, ...patch};
}
const contractVerified = (stateDir, ticket) => execution(ticket, 'answer', {task_verified: true, task_quality: 'task_verified',
  operational_quality: {schema: 1, coverage: 'full', assessment_state: 'task_contract_verified',
    contract_sha256: sha('contract'), witness_path: join(stateDir, 'quality-witnesses', ticket.attempt_id + '.json'),
    witness_sha256: sha('witness'), artifact_sha256: sha(ticket.attempt_id), workspace_after_sha256: sha('tree'),
    failed_check_ids: [], corrective_attempts: 0, local_only_verified: false}});
const verdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
  parity_state: 'unverified', reason: 'fixture_deterministic_coverage'});
const ledgerFile = stateDir => join(stateDir, 'routing-ledger', 'routing-ledger.jsonl');
const ledgerOf = async stateDir => (await readFile(ledgerFile(stateDir), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const auditOf = async stateDir => auditDeliveryPolicy({ledgers: [{path: 'ledger', bytes: await readFile(ledgerFile(stateDir))}]});
const familyA = 'Fixture family A: answer one question';
const soundEntry = verify => ({id: 'family-a', scope: 'read_only', surfaces: ['agent'], soundness: 'sound_full',
  applies: node => node.instruction.startsWith('Fixture family A:'), verify,
  refutations: [{instruction: familyA, output: 'beta'}]});
async function core(t, stateDir, {facts = {}, execute, verifierRegistry, catalogOf = null}) {
  const runtime = await createRCCRuntime({stateDir, hostAutoPlan: true, ...(verifierRegistry ? {verifierRegistry} : {}),
    catalog: async value => catalogOf ? catalogOf(value) : catalog(value, typeof facts === 'function' ? facts(value) : facts),
    plan: async () => { throw Error('Auto must not call plan()'); },
    execute: async ticket => execute(ticket, runtime), verifyTask: verdict});
  t.after(async () => { await runtime.close(); });
  const run = async request => {
    await runtime.submit(request);
    return runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
  };
  return {runtime, run};
}

test('Core: a certifier gone at adoption is certifier_unavailable, never a failure of the route', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'state');
  const {run} = await core(t, stateDir, {
    verifierRegistry: await registerNodeVerifiers(new Map([['family-a', soundEntry(async input =>
      ({passed: input.output === 'alpha'}))]])),
    execute: (ticket, runtime) => {
      if (ticket.selected_config.model === 'gpt-6-astra') return execution(ticket, 'reference alpha');
      runtime._update(ticket.task_id, 'fixture_certifier_gone', snapshot => {
        snapshot.children.find(c => c.id === ticket.node_id).ladder.certificate_id = 'gone';
      });
      return execution(ticket, 'alpha');
    }});
  const done = await run(task(dir, familyA));
  assert.equal(done.state, 'completed', done.error);
  assert.equal(done.result.output, 'reference alpha');
  const [descent, reference] = await ledgerOf(stateDir);
  assert.deepEqual([descent.delivery_basis, descent.check_id, descent.check_outcome, descent.check_label,
    descent.verifier_outcome, descent.attempt_state, descent.escalation_outcome],
  ['certified:verifier:family-a', 'verifier:family-a', 'certifier_unavailable', null, 'certifier_unavailable',
    'ladder_not_returned', 'escalated']);
  assert.deepEqual([reference.delivery_basis, reference.check_outcome, reference.escalated], ['reference_escalated', null, true]);
  // The never-rotated failure index does not count a configuration fault.
  const index = JSON.parse(await readFile(join(stateDir, 'routing-ledger', 'routing-ledger-failures.json'), 'utf8'));
  assert.deepEqual(index.failures, {});
  assert.equal((await auditOf(stateDir)).verdict, 'PASS');
});

test('Core: a restart records a pending attempt with the basis it dispatched with; an older pending route stays legacy', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'state');
  const started = Promise.withResolvers();
  const first = await createRCCRuntime({stateDir, hostAutoPlan: true,
    catalog: async value => catalog(value, {task_contract: contract(value)}),
    plan: async () => { throw Error('Auto must not call plan()'); },
    execute: async () => { started.resolve(); return new Promise(() => {}); }, verifyTask: verdict});
  const lost = task(dir);
  await first.submit(lost);
  await started.promise;
  await first.close({timeoutMs: 50});
  // A second pending attempt, as an older build pended it: no basis fields.
  const db = new DatabaseSync(join(stateDir, 'rcc-runtime.sqlite'));
  const [pending] = db.prepare('SELECT attempt_id,task_id,node_id,route FROM ledger_pending').all();
  const older = JSON.parse(pending.route);
  for (const key of ['delivery_basis', 'check_id', 'stratum']) delete older[key];
  const olderID = randomUUID();
  db.prepare('INSERT INTO ledger_pending(attempt_id,task_id,node_id,route) VALUES(?,?,?,?)')
    .run(olderID, pending.task_id, pending.node_id, JSON.stringify(older));
  db.close();
  const second = await createRCCRuntime({stateDir, catalog: async value => catalog(value)});
  t.after(async () => { await second.close(); });
  const records = await ledgerOf(stateDir);
  const reconciled = records.find(r => r.attempt_id === pending.attempt_id);
  assert.equal(reconciled.delivery_basis, 'certified:contract');
  assert.equal(reconciled.check_id, 'contract:' + sha('contract'));
  assert.equal(reconciled.check_outcome, 'not_run'); assert.equal(reconciled.check_label, null);
  assert.ok(NON_DELIVERY_STATES.has(reconciled.attempt_state), reconciled.attempt_state);
  assert.deepEqual(reconciled.stratum, {request_class: 'readonly_lookup', turn: 'first', has_materials: false,
    context_bytes: Buffer.byteLength(LOOKUP)});
  const legacyRecord = records.find(r => r.attempt_id === olderID);
  for (const key of ['delivery_basis', 'check_id', 'check_outcome', 'check_label', 'stratum'])
    assert.equal(Object.hasOwn(legacyRecord, key), false, key);
  const report = await auditOf(stateDir);
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual([report.counts.k9_records, report.legacy.records], [1, 1]);
});

test('Core: a restart records a settled descent\'s check as it was: the source\'s pass, or certifier_unavailable', async t => {
  const dir = await fixture(t);
  // The live append fails (the ledger directory is not private), so only the
  // restart's reconcile records these attempts, from their stored verdicts.
  const ledgerDir = stateDir => join(stateDir, 'routing-ledger');
  const breakLedger = async stateDir => {
    await mkdir(ledgerDir(stateDir), {recursive: true, mode: 0o700});
    await chmod(ledgerDir(stateDir), 0o755);
  };
  const runOnce = async (stateDir, options, request) => {
    const logged = [];
    const runtime = await createRCCRuntime({stateDir, hostAutoPlan: true, ledgerLog: code => logged.push(code),
      plan: async () => { throw Error('Auto must not call plan()'); }, verifyTask: verdict, ...options(() => runtime)});
    await runtime.submit(request);
    const done = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
    await runtime.close();
    assert.ok(logged.includes('routing_ledger_directory_not_private'), JSON.stringify(logged));
    await chmod(ledgerDir(stateDir), 0o700);
    const reopened = await createRCCRuntime({stateDir, catalog: async value => catalog(value)});
    t.after(async () => { await reopened.close(); });
    return done;
  };
  // (1) A contract descent the contract accepted: its pass and sound_full label.
  const contractDir = join(dir, 'contract');
  const accepted = await runOnce(contractDir, () => ({catalog: async value => catalog(value, {task_contract: contract(value)}),
    execute: async ticket => { await breakLedger(contractDir); return contractVerified(contractDir, ticket); }}), task(dir));
  assert.equal(accepted.state, 'completed', accepted.error);
  const [passed] = await ledgerOf(contractDir);
  assert.deepEqual([passed.delivery_basis, passed.check_outcome, passed.attempt_state, passed.model],
    ['certified:contract', 'pass', 'completed', 'gpt-6-luna']);
  assert.deepEqual(passed.check_label, {score_space: 'check_acceptance_v1', check_id: 'contract:' + sha('contract'),
    soundness: 'sound_full', outcome: 'pass'});
  assert.equal((await auditOf(contractDir)).verdict, 'PASS');
  // (2) A verifier descent whose certifier was gone at adoption: a
  // configuration fault, never a failure of the route.
  const verifierDir = join(dir, 'verifier');
  const registry = await registerNodeVerifiers(new Map([['family-a', soundEntry(async input =>
    ({passed: input.output === 'alpha'}))]]));
  const escalated = await runOnce(verifierDir, runtime => ({verifierRegistry: registry,
    catalog: async value => catalog(value),
    execute: async ticket => {
      await breakLedger(verifierDir);
      if (ticket.selected_config.model === 'gpt-6-astra') return execution(ticket, 'reference alpha');
      runtime()._update(ticket.task_id, 'fixture_certifier_gone', snapshot => {
        snapshot.children.find(c => c.id === ticket.node_id).ladder.certificate_id = 'gone';
      });
      return execution(ticket, 'alpha');
    }}), task(dir, familyA));
  assert.equal(escalated.state, 'completed', escalated.error);
  assert.equal(escalated.result.output, 'reference alpha');
  const records = await ledgerOf(verifierDir);
  const descent = records.find(r => r.model === 'gpt-6-luna');
  assert.deepEqual([descent.delivery_basis, descent.check_outcome, descent.verifier_outcome, descent.check_label,
    descent.attempt_state], ['certified:verifier:family-a', 'certifier_unavailable', 'certifier_unavailable', null,
    'ladder_not_returned']);
  assert.deepEqual(records.find(r => r.model === 'gpt-6-astra').delivery_basis, 'reference_escalated');
  assert.equal(openRoutingLedger(verifierDir).stats(descent.family, descent.model, descent.effort).verifier_failures, 0);
  const index = await readFile(join(ledgerDir(verifierDir), 'routing-ledger-failures.json'), 'utf8').catch(() => null);
  if (index !== null) assert.deepEqual(JSON.parse(index).failures, {});
  assert.equal((await auditOf(verifierDir)).verdict, 'PASS');
});

test('Core end to end: a closed store audits PASS with snapshots; a forged unchecked copy fails', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'state');
  const {runtime, run} = await core(t, stateDir, {facts: value => value.request === LOOKUP ? {task_contract: contract(value)} : {},
    execute: ticket => contractVerified(stateDir, ticket)});
  const accepted = await run(task(dir));
  assert.equal(accepted.state, 'completed', accepted.error);
  const plain = await run(task(dir, 'Explain this workspace in a sentence.'));
  assert.equal(plain.state, 'completed', plain.error);
  await runtime.close();
  const records = await ledgerOf(stateDir);
  assert.deepEqual(records.map(r => [r.delivery_basis, r.check_outcome, r.model]),
    [['certified:contract', 'pass', 'gpt-6-luna'], ['reference', null, 'gpt-6-astra']]);
  assert.deepEqual(records[0].check_label, {score_space: 'check_acceptance_v1', check_id: 'contract:' + sha('contract'),
    soundness: 'sound_full', outcome: 'pass'});
  const copy = join(dir, 'copy.sqlite');
  await copyFile(join(stateDir, 'rcc-runtime.sqlite'), copy);
  const result = cli(['delivery', '--ledger', ledgerFile(stateDir), '--snapshots', copy]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.delivery.by_basis, {'certified:contract': 1, reference: 1});
  const forged = join(dir, 'forged.jsonl');
  await writeFile(forged, (await readFile(ledgerFile(stateDir), 'utf8')).replace('"check_outcome":"pass"',
    '"check_outcome":"not_run"'));
  assert.equal(cli(['delivery', '--ledger', forged, '--snapshots', copy]).status, 1);
});
