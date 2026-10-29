// K16: scripts/route-replay.mjs `usage` reports M1 (§4.2), the observed
// tokens per subscription pool, and per task and pool whether that
// consumption is complete; scripts/quota-replay.py reads it for the labelled
// M2/M3 estimates and the M4-only 15% verdict. Unknown usage stays unknown
// (never zero, never a max), a verified_not_dispatched attempt is verified
// zero, an undelivered task's tokens count. Synthetic records, temp files and
// a real durable Core with temp SQLite and a fake executor: no provider,
// model, network, real HOME or installed app.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRCCRuntime, hostContextFingerprint } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import { canonicalJSON, replayUsage, usageState } from '../route-replay.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = join(scripts, 'route-replay.mjs');
const quotaReplay = join(scripts, 'quota-replay.py');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-route-replay-usage-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
const jsonl = records => records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '');
const use = (input, read, write, output, metric = 'native_usage_observation') => ({input_tokens: input,
  output_tokens: output, cache_read_tokens: read, cache_write_tokens: write, provider_calls: 1, duration_ms: 10, metric});
const T = (uncached, cache_read, cache_write, output) => ({uncached, cache_read, cache_write, output});
// One synthetic ledger record (today's schema-1 keys); `patch` overrides.
function rec(patch = {}) {
  return {schema: 1, task_id: randomUUID(), node_id: 'node_0', attempt_id: randomUUID(), family: 'deep:read_only:agent',
    route_class: 'deep', scope: 'read_only', surface_kind: 'agent', surface: 'codex', quota_pool: 'openai_codex',
    model: 'gpt-6-astra', effort: 'max', route_kind: 'reference', host_route_kind: null, reference_effort: 'max',
    ladder: null, tier: 'frontier', escalated: false, usage: use(1000, 400, 0, 50), quota_remaining_fraction: 0.7,
    execution_verified: true, task_quality: 'execution_only', verifier_outcome: 'not_registered',
    attempt_state: 'completed', escalation_outcome: null, dispatched_failure: null, dispatched_at_ms: 1,
    settled_at_ms: 2, ...patch};
}
// A task snapshot whose children list exactly these records as attempts.
function snap(records, state = 'completed', extra = {}) {
  const taskID = extra.task_id ?? records[0].task_id;
  const nodes = new Map();
  for (const r of records) nodes.set(r.node_id, [...(nodes.get(r.node_id) ?? []), r]);
  const children = [...nodes].map(([id, list]) => ({id, state: 'completed', attempts: list.length,
    attempt_id: list.at(-1).attempt_id, instruction: 'PRIVATE-INSTRUCTION', output: 'PRIVATE-OUTPUT',
    attempt_history: list.map(r => ({attempt_id: r.attempt_id, candidate_id: 'c', state: r.attempt_state,
      native_receipt: null, usage: r.usage, ledger: {quota_pool: r.quota_pool, surface: r.surface},
      selected_config: {surface: r.surface, quota_pool: r.quota_pool}}))}));
  const snapshot = {task: {task_id: taskID, request: 'PRIVATE-REQUEST'}, state, children,
    result: ['completed', 'returned_unverified'].includes(state) ? {output: 'PRIVATE-OUTPUT'} : null,
    resource_events: [], plan_provenance: 'host_exact_request', ...extra};
  delete snapshot.task_id;
  return {task_id: taskID, snapshot};
}
const replay = (records, snapshots = null, events = null, ledgers = null) =>
  replayUsage({ledgers: ledgers ?? [{path: 'fixture', text: jsonl(records)}], snapshots, events});
const row = (report, taskID) => report.tasks.find(t => t.task_id === taskID);
const keysOf = value => Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === 'object' ?
  Object.entries(value).flatMap(([key, item]) => [key, ...keysOf(item)]) : [];

test('usage: an attempt with null usage in a dispatched state is unknown; its task is incomplete, never filled', () => {
  for (const state of ['completed', 'ladder_not_returned', 'failed', 'held', 'effects_uncertain', 'interrupted']) {
    const complete = rec();
    const known = rec({usage: use(300, 0, 0, 30)});
    const blind = rec({task_id: known.task_id, node_id: 'node_1', attempt_state: state, usage: null});
    const report = replay([complete, known, blind], [snap([complete]), snap([known, blind])]);
    const pool = report.pools.openai_codex;
    assert.deepEqual(pool.consumption_complete_tasks, T(600, 400, 0, 50), state);
    assert.deepEqual(pool.known_subtotal_incomplete_tasks, T(300, 0, 0, 30), `${state}: nothing backfilled`);
    assert.deepEqual([pool.complete_tasks, pool.incomplete_tasks], [1, 1], state);
    assert.deepEqual(pool.incomplete_reasons, {usage_null: 1}, state);
    assert.deepEqual(row(report, known.task_id).pools.openai_codex.attempts, {observed: 1, verified_zero: 0, unknown: 1});
    assert.equal(row(report, known.task_id).pools.openai_codex.complete, false);
    assert.equal(row(report, known.task_id).parity, 'agree', 'the runtime reducer agrees: unknown');
    assert.deepEqual([report.accounting_complete, report.verdict, report.exit_code], [false, 'INCOMPLETE', 2], state);
  }
});

test('usage: a verified_not_dispatched attempt with null usage is verified zero (the documented parity difference)', () => {
  const free = rec({attempt_state: 'verified_not_dispatched', usage: null});
  const ran = rec({task_id: free.task_id, usage: use(500, 100, 0, 20)});
  const report = replay([free, ran], [snap([free, ran])]);
  assert.deepEqual([report.verdict, report.exit_code, report.accounting_complete], ['COMPLETE', 0, true]);
  assert.deepEqual(report.attempts, {observed: 1, verified_zero: 1, unknown: 0});
  assert.deepEqual(report.pools.openai_codex.consumption_complete_tasks, T(400, 100, 0, 20));
  const task = row(report, free.task_id);
  assert.deepEqual([task.parity, task.runtime_native_accounting_complete], ['verified_not_dispatched_zero', false]);
  assert.deepEqual(report.parity.disagreements, {verified_not_dispatched_zero: 1});
  // Any other null usage in any state other than verified_not_dispatched stays unknown.
  assert.deepEqual(usageState(rec({attempt_state: 'cancelled', usage: null})), {state: 'unknown', reason: 'usage_null'});
});

test('usage: undelivered tasks are counted like any other; a retained partial result is delivered', () => {
  const held = rec();
  const cancelled = rec({usage: use(10, 0, 0, 1)});
  const uncertain = rec({usage: use(20, 0, 0, 2)});
  const partial = rec({usage: use(30, 0, 0, 3)});
  const shown = rec({usage: use(40, 0, 0, 4)});
  const report = replay([held, cancelled, uncertain, partial, shown], [snap([held], 'held'), snap([cancelled], 'cancelled'),
    snap([uncertain], 'effects_uncertain'), snap([partial], 'held', {result: {output: 'kept'}}),
    snap([shown], 'returned_unverified')]);
  assert.equal(report.verdict, 'COMPLETE');
  assert.deepEqual(report.pools.openai_codex.consumption_complete_tasks, T(700, 400, 0, 60));
  const undelivered = report.by_delivery.undelivered;
  assert.deepEqual([undelivered.tasks, undelivered.complete_tasks, undelivered.by_state],
    [3, 3, {cancelled: 1, effects_uncertain: 1, held: 1}]);
  assert.deepEqual(undelivered.consumption, {openai_codex: T(630, 400, 0, 53)});
  assert.deepEqual(report.by_delivery.delivered.by_state, {held: 1, returned_unverified: 1});
  assert.deepEqual(report.by_delivery.delivered.consumption, {openai_codex: T(70, 0, 0, 7)});
  // Only the held task: its whole consumption is undelivered.
  const alone = replay([held], [snap([held], 'held')]);
  assert.deepEqual([alone.by_delivery.undelivered.tasks, alone.by_delivery.undelivered.consumption],
    [1, {openai_codex: T(600, 400, 0, 50)}]);
  assert.deepEqual(alone.pools.openai_codex.consumption_complete_tasks, T(600, 400, 0, 50));
});

test('usage: a ladder descent and its escalated reference are both summed into the task', () => {
  const tier = rec({model: 'gpt-6-luna', effort: 'low', route_kind: 'tier', attempt_state: 'ladder_not_returned',
    usage: use(200, 0, 0, 20)});
  const reference = rec({task_id: tier.task_id, escalated: true});
  const report = replay([tier, reference], [snap([tier, reference])]);
  assert.equal(report.verdict, 'COMPLETE');
  const pool = row(report, tier.task_id).pools.openai_codex;
  assert.deepEqual([pool.consumption, pool.attempts.observed], [T(800, 400, 0, 70), 2]);
  assert.deepEqual(pool.by_model, {'gpt-6-astra': T(600, 400, 0, 50), 'gpt-6-luna': T(200, 0, 0, 20)});
  assert.deepEqual(report.pools.openai_codex.by_model_complete_tasks, pool.by_model);
});

test('usage: the cache split is exact; inconsistent, partial or unknown-basis counters are unknown', () => {
  assert.deepEqual(usageState(rec({usage: use(1000, 600, 100, 9)})), {state: 'observed', tuple: T(300, 600, 100, 9)});
  const without = use(1000, 600, 0, 9); delete without.cache_write_tokens;
  const cases = [[use(100, 60, 50, 1), 'usage_invalid'], [without, 'usage_partial'],
    [{...use(1, 0, 0, 1), cache_read_tokens: null}, 'usage_partial'], [{...use(1, 0, 0, 1), input_tokens: -1}, 'usage_invalid'],
    [{...use(1, 0, 0, 1), output_tokens: 1.5}, 'usage_invalid'], [{...use(1, 0, 0, 1), metric: undefined}, 'usage_basis_unknown'],
    [{...use(1, 0, 0, 1), metric: 'local_model_usage_observation'}, 'usage_basis_unknown'],
    // A later child-receipt or usage-incomplete marker is never ignored.
    [{...use(1, 0, 0, 1), child_receipts_incomplete: true}, 'usage_invalid'],
    [{...use(1, 0, 0, 1), provider_calls: -2}, 'usage_invalid'], ['42', 'usage_invalid']];
  for (const [usage, reason] of cases)
    assert.deepEqual(usageState(rec({usage: JSON.parse(JSON.stringify(usage))})), {state: 'unknown', reason},
      JSON.stringify(usage));
  const noUsage = rec(); delete noUsage.usage;
  assert.deepEqual(usageState(noUsage), {state: 'unknown', reason: 'usage_missing'});
  const bad = rec({usage: use(100, 60, 50, 1)});
  const report = replay([bad], [snap([bad])]);
  assert.deepEqual([report.verdict, report.pools.openai_codex.incomplete_reasons], ['INCOMPLETE', {usage_invalid: 1}]);
  assert.deepEqual(report.pools.openai_codex.known_subtotal_incomplete_tasks, T(0, 0, 0, 0));
});

test('usage: two ledger generations: an identical copy counts once, a conflicting copy is unknown', () => {
  const one = rec();
  const same = replay(null, [snap([one])], null, [{text: jsonl([one])}, {text: jsonl([{...one, settled_at_ms: 9}])}]);
  assert.deepEqual([same.verdict, same.ledger.duplicate_identical, same.ledger.records], ['COMPLETE', 1, 1]);
  assert.deepEqual(same.pools.openai_codex.consumption_complete_tasks, T(600, 400, 0, 50));
  const conflict = replay(null, [snap([one])], null, [{text: jsonl([one])}, {text: jsonl([{...one, usage: use(9, 0, 0, 9)}])}]);
  assert.deepEqual([conflict.verdict, conflict.accounting_complete, conflict.ledger.identity_conflicts],
    ['INCOMPLETE', false, 1]);
  assert.deepEqual(row(conflict, one.task_id).pools.openai_codex.incomplete_reasons, ['identity_conflict']);
  assert.deepEqual(conflict.pools.openai_codex.consumption_complete_tasks, T(0, 0, 0, 0));
  // Disagreeing copies that both name another task: the task whose snapshot
  // lists the attempt is incomplete too, never complete and undercounted.
  const first = rec();
  const second = rec({task_id: first.task_id, node_id: 'node_1', usage: use(20, 0, 0, 1)});
  const elsewhere = randomUUID();
  const listing = replay(null, [snap([first, second])], null, [{text: jsonl([first, {...second, task_id: elsewhere}])},
    {text: jsonl([{...second, task_id: elsewhere, usage: use(9, 0, 0, 9)}])}]);
  const listed = row(listing, first.task_id).pools.openai_codex;
  assert.deepEqual([listed.complete, listed.incomplete_reasons, listed.attempts],
    [false, ['identity_conflict'], {observed: 1, verified_zero: 0, unknown: 1}]);
  assert.deepEqual([listing.verdict, listing.pools.openai_codex.complete_tasks], ['INCOMPLETE', 0]);
  assert.deepEqual(listing.pools.openai_codex.consumption_complete_tasks, T(0, 0, 0, 0));
});

test('usage: legacy records are read; an unreadable line makes the whole replay incomplete', () => {
  const legacy = rec({route_kind: 'execution_only', cost_gate: {state: 'legacy'}, routing_outcome: {schema: 1}});
  const later = rec({delivery_basis: 'reference', check_id: null, check_outcome: null, check_label: null,
    stratum: {request_class: null, turn: 'first', has_materials: false, context_bytes: 1}});
  const records = [legacy, later];
  const snapshots = [snap([legacy]), snap([later])];
  assert.equal(replay(records, snapshots).verdict, 'COMPLETE');
  for (const extra of ['{not json\n', JSON.stringify({...rec(), schema: 2}) + '\n', JSON.stringify(rec({attempt_id: 'a-1'})) + '\n',
    JSON.stringify(rec({quota_pool: 7})) + '\n', JSON.stringify(rec()).slice(0, 40)]) {
    const report = replay(null, snapshots, null, [{text: jsonl(records) + extra}]);
    assert.deepEqual([report.ledger.unreadable_lines, report.accounting_complete, report.verdict], [1, false, 'INCOMPLETE'],
      extra);
    assert.equal(report.inputs.ledgers[0].unreadable_lines, 1);
  }
});

test('usage: local worker rows stay in the local pool none and never touch a subscription pool', () => {
  const local = rec({quota_pool: 'none', surface: 'local', surface_kind: 'local', model: 'ollama/qwen3.5:4b',
    usage: use(100, 30, 0, 5, 'local_model_usage_observation')});
  const native = rec({task_id: local.task_id, node_id: 'node_1'});
  const report = replay([local, native], [snap([local, native])]);
  assert.equal(report.verdict, 'COMPLETE');
  // A local worker's input excludes its cache counters.
  assert.deepEqual(report.pools.none.consumption_complete_tasks, T(100, 30, 0, 5));
  assert.deepEqual(report.pools.openai_codex.consumption_complete_tasks, T(600, 400, 0, 50));
  assert.deepEqual([report.pools.none.subscription, report.pools.none.usage_basis], [false, 'local_input_excludes_cache']);
  assert.deepEqual(Object.keys(row(report, local.task_id).pools).sort(), ['none', 'openai_codex']);
  // Unknown local usage is local incompleteness only.
  const blind = rec({quota_pool: 'none', surface: 'local', usage: null});
  const mixed = replay([blind, native], [snap([blind]), snap([native])]);
  assert.deepEqual([mixed.verdict, mixed.accounting_complete, mixed.local_accounting_complete], ['COMPLETE', true, false]);
});

test('usage: zero-model and never-dispatched tasks are complete and zero; their events are cross-checked', () => {
  const zero = {task_id: 'task-zero', snapshot: {task: {task_id: 'task-zero', request: '2+2'}, state: 'completed',
    plan_provenance: 'deterministic_no_model', result: {output: '4'}, children: [{id: 'local-core', state: 'completed',
      attempt_id: null, attempts: 0, attempt_history: [], output: '4'}]}};
  const held = {task_id: 'task-held', snapshot: {task: {task_id: 'task-held'}, state: 'held', result: null, children: []}};
  const report = replay([], [zero, held], [{task_id: 'task-zero', kind: 'deterministic_arithmetic'}]);
  assert.deepEqual([report.verdict, report.exit_code, report.zero_model_tasks], ['COMPLETE', 0, 2]);
  assert.deepEqual(report.snapshots.zero_model, {deterministic_no_model: 1, no_attempt_dispatched: 1,
    zero_model_event_with_attempts: 0});
  assert.deepEqual([row(report, 'task-zero').zero_model, row(report, 'task-zero').pools], ['deterministic_no_model', {}]);
  assert.deepEqual(report.pools, {});
  // An arithmetic event on a task with model attempts is counted, never zeroed.
  const ran = rec();
  const odd = replay([ran], [snap([ran])], [{task_id: ran.task_id, kind: 'local_checkin'}]);
  assert.deepEqual([odd.snapshots.zero_model.zero_model_event_with_attempts, odd.zero_model_tasks], [1, 0]);
  // An empty ledger and no snapshots: no evidence.
  assert.deepEqual([replay([]).verdict, replay([]).exit_code], ['NO_EVIDENCE', 2]);
});

test('usage: the attempt population comes from the snapshot; a gap on either side is incomplete', () => {
  const kept = rec();
  const lost = {...rec({task_id: kept.task_id, node_id: 'node_1'})};
  const missing = replay([kept], [snap([kept, lost])]);
  assert.deepEqual(row(missing, kept.task_id).pools.openai_codex.incomplete_reasons, ['ledger_record_missing']);
  assert.equal(missing.verdict, 'INCOMPLETE');
  assert.equal(row(missing, kept.task_id).parity, 'replay_stricter');
  // A record the task's snapshot does not list, a ledger task with no
  // snapshot, and the ledger alone: never complete.
  const extra = rec({task_id: kept.task_id, node_id: 'node_2'});
  const unlisted = replay([kept, extra], [snap([kept])]);
  assert.deepEqual(row(unlisted, kept.task_id).pools.openai_codex.incomplete_reasons, ['snapshot_attempt_missing']);
  assert.deepEqual(row(unlisted, kept.task_id).pools.openai_codex.consumption, T(1200, 800, 0, 100));
  const other = rec();
  assert.deepEqual(row(replay([kept, other], [snap([kept])]), other.task_id).pools.openai_codex.incomplete_reasons,
    ['task_snapshot_missing']);
  const ledgerOnly = replay([kept]);
  assert.deepEqual([ledgerOnly.verdict, ledgerOnly.attempt_coverage, ledgerOnly.parity],
    ['INCOMPLETE', 'ledger_records_only', null]);
  assert.deepEqual(row(ledgerOnly, kept.task_id).pools.openai_codex.incomplete_reasons, ['attempt_coverage_unverified']);
  assert.deepEqual(ledgerOnly.pools.openai_codex.known_subtotal_incomplete_tasks, T(600, 400, 0, 50));
  // An attempt of unknown pool taints the task's other subscription pools.
  const unpooled = snap([kept, lost]);
  delete unpooled.snapshot.children[1].attempt_history[0].ledger;
  delete unpooled.snapshot.children[1].attempt_history[0].selected_config;
  const tainted = replay([kept], [unpooled]);
  assert.deepEqual(row(tainted, kept.task_id).pools.openai_codex.incomplete_reasons, ['attempt_pool_unknown']);
  assert.deepEqual(row(tainted, kept.task_id).pools.unknown.incomplete_reasons, ['ledger_record_missing']);
  // Fewer listed attempts than the child counted; a record filed under
  // another node; a snapshot usage that disagrees with its record.
  const short = snap([kept]); short.snapshot.children[0].attempts = 2;
  assert.ok(row(replay([kept], [short]), kept.task_id).pools.openai_codex.incomplete_reasons
    .includes('snapshot_attempt_history_short'));
  const moved = snap([kept]); moved.snapshot.children[0].id = 'node_9';
  assert.deepEqual(row(replay([kept], [moved]), kept.task_id).pools.openai_codex.incomplete_reasons, ['identity_conflict']);
  const differs = snap([kept]); differs.snapshot.children[0].attempt_history[0].usage = use(1, 0, 0, 1);
  assert.deepEqual(row(replay([kept], [differs]), kept.task_id).pools.openai_codex.incomplete_reasons,
    ['usage_record_conflict']);
  // Unreadable or foreign snapshot rows.
  const foreign = snap([kept]); foreign.task_id = 'someone-else';
  const unreadable = replay([kept], [foreign, {task_id: 'x', snapshot: '{not json'}]);
  assert.deepEqual([unreadable.snapshots.unreadable_snapshots, unreadable.verdict], [2, 'INCOMPLETE']);
});

test('usage: the runtime reducer is a parity check that fails closed', () => {
  // The ledger has the usage; the snapshot lost it (an attempt settled after a
  // stop): the reducer cannot account for it, so neither does the replay.
  const record = rec();
  const lost = snap([record]); lost.snapshot.children[0].attempt_history[0].usage = null;
  const report = replay([record], [lost]);
  const task = row(report, record.task_id);
  assert.deepEqual([task.parity, task.pools.openai_codex.complete, task.pools.openai_codex.incomplete_reasons],
    ['runtime_reducer_stricter', false, ['runtime_reducer_native_incomplete']]);
  assert.deepEqual(report.parity.disagreements, {runtime_reducer_stricter: 1});
  assert.equal(report.verdict, 'INCOMPLETE');
});

test('usage: the report holds no request, instruction or output text, no saving figure, and is deterministic', () => {
  const a = rec({task_id: 'task-a', attempt_id: '00000000-0000-4000-8000-000000000001'});
  const b = rec({task_id: 'task-b', attempt_id: '00000000-0000-4000-8000-000000000002', usage: null,
    attempt_state: 'failed'});
  const first = canonicalJSON(replay([a, b], [snap([a]), snap([b], 'failed')]));
  assert.equal(first, canonicalJSON(replay([a, b], [snap([a]), snap([b], 'failed')])));
  for (const secret of ['PRIVATE-REQUEST', 'PRIVATE-INSTRUCTION', 'PRIVATE-OUTPUT']) assert.ok(!first.includes(secret), secret);
  const keys = keysOf(JSON.parse(first));
  assert.deepEqual(keys.filter(key => /saving|ratio|percent/i.test(key)), []);
  const report = JSON.parse(first);
  assert.deepEqual([report.kind, report.metric, report.label, report.schema], ['os1_route_replay_usage',
    'M1_observed_tokens', 'recorded', 1]);
  assert.match(report.claim_boundary, /not a price \(M2\), a counterfactual \(M3\), a quota-window observation \(M4\)/);
});

// A checkpointed copy of the Core store with these snapshots and events.
function storeCopy(path, snapshots, events = []) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE tasks (task_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL);
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, revision INTEGER NOT NULL,
      kind TEXT NOT NULL, at_ms INTEGER NOT NULL, payload TEXT NOT NULL)`);
  for (const {task_id, snapshot} of snapshots) db.prepare('INSERT INTO tasks VALUES(?,?,?)').run(task_id, 'f', JSON.stringify(snapshot));
  for (const {task_id, kind} of events) db.prepare('INSERT INTO events(task_id,revision,kind,at_ms,payload) VALUES(?,?,?,?,?)')
    .run(task_id, 1, kind, 1, '{}');
  db.close();
}
function run(command, args) {
  try {
    return {status: 0, stdout: execFileSync(command, args, {encoding: 'utf8', stdio: 'pipe'})};
  } catch (error) { return {status: error.status, stdout: error.stdout, stderr: error.stderr}; }
}
const cli = args => run(process.execPath, [script, ...args]);
const quota = args => run('python3', ['-I', quotaReplay, ...args]);

test('usage CLI and quota-replay: read-only inputs, exit codes, and incomplete tasks kept out of M2/M3', async t => {
  const dir = await fixture(t);
  const done = rec({model: 'gpt-6-luna'});
  const blind = rec({usage: null, attempt_state: 'held'});
  const ledger = join(dir, 'routing-ledger.jsonl');
  await writeFile(ledger, jsonl([done, blind]), {mode: 0o600});
  const db = join(dir, 'copy.sqlite');
  const zero = {task_id: 'task-zero', snapshot: {task: {task_id: 'task-zero'}, state: 'completed',
    plan_provenance: 'deterministic_no_model', result: {output: '4'}, children: []}};
  storeCopy(db, [snap([done]), snap([blind], 'held'), zero], [{task_id: 'task-zero', kind: 'deterministic_arithmetic'}]);
  const before = await stat(ledger);
  const out = join(dir, 'm1.json');
  const result = cli(['usage', '--ledger', ledger, '--snapshots', db, '--out', out]);
  assert.equal(result.status, 2, result.stderr);
  const after = await stat(ledger);
  assert.deepEqual([after.size, after.mtimeMs, after.mode], [before.size, before.mtimeMs, before.mode], 'input untouched');
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  const m1 = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual([m1.verdict, m1.zero_model_tasks, m1.inputs.snapshots.sha256, m1.inputs.ledgers[0].sha256],
    ['INCOMPLETE', 1, sha(await readFile(db)), sha(await readFile(ledger))]);
  assert.equal(m1.snapshots.zero_model_events, 1);
  assert.equal(cli(['usage', '--ledger', ledger, '--snapshots', db, '--out', out]).status, 64, '--out is never overwritten');
  // Only the complete task: COMPLETE, exit 0; the ledger alone: exit 2.
  const one = join(dir, 'one.jsonl');
  await writeFile(one, jsonl([done]));
  const oneDB = join(dir, 'one.sqlite');
  storeCopy(oneDB, [snap([done])]);
  const complete = cli(['usage', '--ledger', one, '--snapshots', oneDB]);
  assert.equal(complete.status, 0, complete.stderr);
  assert.equal(JSON.parse(complete.stdout).verdict, 'COMPLETE');
  assert.equal(cli(['usage', '--ledger', one]).status, 2);
  // Usage and input errors: 64.
  const link = join(dir, 'link.jsonl');
  await symlink(ledger, link);
  await writeFile(oneDB + '-wal', '');
  for (const args of [['usage'], ['usage', ledger], ['usage', '--ledger', link], ['usage', '--ledger', dir],
    ['usage', '--ledger', ledger, '--bogus'], ['usage', '--ledger', ledger, '--snapshots', oneDB],
    ['usage', '--ledger', ledger, '--include-legacy']])
    assert.equal(cli(args).status, 64, JSON.stringify(args));
  await rm(oneDB + '-wal');

  // quota-replay reads the pinned M1: no M4 is NOT_RUN (2); the incomplete
  // (held, null usage) task is excluded from M2 and counted; a bad pin is 64.
  const m1SHA = sha(await readFile(out));
  const base = ['--m1', out, '--m1-sha256', m1SHA];
  const notRun = quota(base);
  assert.equal(notRun.status, 2, notRun.stderr);
  const plain = JSON.parse(notRun.stdout);
  assert.deepEqual([plain.verdict.verdict, plain.m2.status, plain.m3.status], ['NOT_RUN', 'not_computed', 'not_computed']);
  assert.deepEqual(plain.m1.pools.openai_codex.incomplete_reasons, {usage_null: 1});
  const card = join(dir, 'price.json');
  await writeFile(card, JSON.stringify({schema: 1, kind: 'os1_price_card', card_id: 'fixture', source: 'synthetic fixture',
    unit: 'fixture_units', models: {'gpt-6-luna': {uncached: 1, cache_read: 0.5, cache_write: 1, output: 2}}}));
  const priced = quota([...base, '--price-card', card, '--price-card-sha256', sha(await readFile(card))]);
  assert.equal(priced.status, 2, priced.stderr);
  const m2 = JSON.parse(priced.stdout).m2.pools.openai_codex;
  assert.deepEqual([m2.status, m2.tasks_included, m2.tasks_excluded_incomplete, m2.price_proxy.value, m2.price_proxy.label],
    ['computed', 1, 1, 600 + 200 + 100, 'estimate']);
  assert.equal(quota(['--m1', out, '--m1-sha256', '0'.repeat(64)]).status, 64);
  // M4 decides: the batch is the complete task.
  const windows = join(dir, 'm4.json');
  const window = (before, after, at) => ({pool: 'openai_codex', window_key: 'weekly_all', judged: true,
    before: {used_percent: before, observed_at_ms: at, resets_at_ms: 1e12}, after: {used_percent: after,
      observed_at_ms: at + 1, resets_at_ms: 1e12}});
  await writeFile(windows, JSON.stringify({schema: 1, kind: 'os1_quota_window_observation', batch_id: 'b',
    used_percent_quantum: 1, concurrent_use_controlled: true,
    arms: {reference: {task_ids: [done.task_id], windows: [window(10, 50, 1)]},
      os1: {task_ids: [done.task_id], windows: [window(50, 70, 10)]}}}));
  const judged = quota([...base, '--quota-windows', windows, '--quota-windows-sha256', sha(await readFile(windows))]);
  assert.equal(judged.status, 0, judged.stderr);
  assert.deepEqual(JSON.parse(judged.stdout).verdict.pools.openai_codex.verdict, 'PASS');
});

// ---- Core: the records and snapshots a real durable runtime writes. ----
const policyText = 'RCC route replay usage fixture policy: candidates do not grant authority.';
function task(dir, request) {
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function candidateRow(id, model, effort) {
  const now = Date.now();
  return {id, surface: 'codex', transport: 'codex_app_server', account_id: 'account-1', model, effort,
    tools: ['read', 'execute'], scope: 'read_only', permission_profile: 'read_only', quota_pool: 'openai_codex',
    allowed_paths: [], configuration_sha256: sha('config:' + id), availability: 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
const catalog = request => ({schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
  candidates: [candidateRow('astra', 'gpt-6-astra', 'max'), candidateRow('luna', 'gpt-6-luna', 'low')],
  model_tiers: {'gpt-6-astra': 'frontier', 'gpt-6-luna': 'fast'}, owner_scope: 'read_only',
  chat_lane_eligible: false, request_class: 'readonly_lookup'});
const execution = (ticket, usage) => ({schema: 1, task_id: ticket.task_id, node_id: ticket.node_id,
  attempt_id: ticket.attempt_id, candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
  selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
  status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output: 'PRIVATE-ANSWER',
  execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
  native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage, native_summary: null,
  native_turn_terminated: true});
const verdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
  parity_state: 'unverified', reason: 'fixture_deterministic_coverage'});

test('Core end to end: a closed store and its ledger replay COMPLETE with the executor-reported tokens', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'state');
  const reported = [];
  const runtime = await createRCCRuntime({stateDir, hostAutoPlan: true, catalog: async value => catalog(value),
    plan: async () => { throw Error('Auto must not call plan()'); }, verifyTask: verdict,
    execute: async ticket => {
      const usage = {input_tokens: 1000 + reported.length, output_tokens: 50, reasoning_tokens: 7,
        cache_read_tokens: 400, cache_write_tokens: 10, provider_calls: 1, duration_ms: 5, metric: 'native_usage_observation'};
      reported.push(usage);
      return execution(ticket, usage);
    }});
  t.after(async () => { await runtime.close(); });
  for (const request of ['Explain this workspace in a sentence.', 'Summarize the PRIVATE-REQUEST notes.']) {
    const value = task(dir, request);
    await runtime.submit(value);
    const done = await runtime.wait({schema: 1, task_id: value.task_id}, {timeoutMs: 10_000});
    assert.equal(done.state, 'completed', done.error);
  }
  await runtime.close();
  const copy = join(dir, 'copy.sqlite');
  await copyFile(join(stateDir, 'rcc-runtime.sqlite'), copy);
  const result = cli(['usage', '--ledger', join(stateDir, 'routing-ledger', 'routing-ledger.jsonl'), '--snapshots', copy]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual([report.verdict, report.attempts, report.parity.agree, report.parity.disagreements],
    ['COMPLETE', {observed: 2, verified_zero: 0, unknown: 0}, 2, {}]);
  assert.deepEqual(report.pools.openai_codex.consumption_complete_tasks, T(1180 + 1, 800, 20, 100));
  assert.deepEqual(report.by_delivery.delivered.tasks, 2);
  for (const secret of ['PRIVATE-ANSWER', 'PRIVATE-REQUEST']) assert.ok(!result.stdout.includes(secret), secret);
});
