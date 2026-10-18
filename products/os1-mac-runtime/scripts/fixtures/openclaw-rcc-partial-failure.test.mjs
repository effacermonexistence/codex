// Partial native outcomes survive a terminal sibling failure without claiming
// parent quality, inventing failed answers, or retrying authentication errors.
// Actual SQLite runtime; synthetic adapters only. No provider/model calls.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createRCCRuntime, hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
async function until(predicate) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) { if (predicate()) return; await sleep(10); }
  throw Error('fixture condition timeout');
}
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'os1-partial-failure-'));
  await chmod(path, 0o700);
  t.after(() => rm(path, {recursive: true, force: true}));
  return path;
}
function task(workspace, attempts = 1, parallel = 1) {
  const request = 'Send two independent arithmetic requests to the specified native routes';
  const text = 'Fixture RCC policy: preserve supported state, no invented authority';
  const host = {workspace, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: randomUUID(), request, objective: request,
    request_sha256: sha(request), source_fingerprint: hostContextFingerprint(host),
    policy_sha256: sha(text), mode: 'auto', material_refs: [], host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(text), text},
    budget: {max_attempts: attempts, max_parallel: parallel, max_cost_units: null, max_duration_ms: 20_000}};
}
function row(id) {
  const now = Date.now();
  return {id, surface: 'codex', transport: 'codex_app_server', account_id: 'synthetic',
    model: 'synthetic-model', effort: 'low', tools: [], scope: 'read_only',
    permission_profile: 'read_only', quota_pool: 'openai_codex', allowed_paths: [],
    configuration_sha256: sha(id), availability: 'available',
    availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.8, quota_observed_at_ms: now - 1,
    quota_valid_until_ms: now + 30_000, quality_state: 'policy_admitted', estimated_cost_units: 1};
}
const node = (id, candidateID, dependencies = []) => ({id, candidate_id: candidateID,
  instruction: id === 'first' ? 'Return the first route arithmetic answer' : 'Return the second route arithmetic answer',
  dependencies, kind: 'agent', scope: 'read_only', owned_paths: [], context_refs: []});
// Named default fixture pipeline ends at second; independent sibling test opts into null below.
const plan = (request, nodes, finalNodeID = 'second') => ({schema: 1, task_id: request.task_id,
  request_sha256: request.request_sha256, nodes, final_node_id: finalNodeID});
const result = (ticket, overrides = {}) => ({schema: 1, task_id: ticket.task_id, node_id: ticket.node_id,
  attempt_id: ticket.attempt_id, candidate_id: ticket.candidate_id,
  configuration_sha256: ticket.configuration_sha256, selected_config: ticket.selected_config,
  acknowledged_config: ticket.selected_config, observed_config: ticket.selected_config,
  status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output: '2',
  execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
  native_receipt: '/private/synthetic/' + ticket.attempt_id,
  native_summary: JSON.stringify({node: ticket.node_id, synthetic: true}),
  native_turn_terminated: true, ...overrides});
const failure = (ticket, error) => result(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
  output: 'failure text is not a mathematical answer', error, execution_verified: false,
  task_verified: false, task_quality: 'failed', observed_config: null, native_summary: null});

function assertPartial(answer, error, state = 'failed') {
  assert.equal(answer.state, state);
  assert.equal(answer.error, error);
  assert.equal(answer.result?.output, 'first: 2');
  assert.equal(answer.result.execution_verified, true, 'only the returned subset has execution evidence');
  assert.equal(answer.result.task_verified, false);
  assert.equal(answer.result.task_quality, 'execution_only');
  assert.equal(answer.result.parity_state, 'unverified');
  assert.equal(answer.result.native_summaries.length, 1);
  assert.equal(JSON.parse(answer.result.native_summaries[0]).node, 'first');
  assert.equal(answer.children.find(child => child.id === 'second').output_summary, null);
  assert.ok(!answer.result.output.includes('second'));
  assert.ok(!answer.result.output.includes('failure text'));
}
async function fixture(t, request, execute, options = {}) {
  const candidates = [row('a'), row('b'), row('alternative')];
  let plans = 0, catalogCalls = 0;
  const runtime = await createRCCRuntime({stateDir: request.host_context.workspace,
    maximumWorkers: 2, maximumReadWorkersPerPool: 2,
    catalog: async q => { catalogCalls++; return {schema: 1, task_id: q.task_id,
      request_sha256: q.request_sha256, candidates}; },
    plan: async ({task: q, repair}) => { plans++;
      return plan(q, options.nodes ?? [node('first', 'a'), node('second', repair ? 'alternative' : 'b', ['first'])], options.finalNodeID); },
    execute,
    verifyTask: () => { throw Error('a partial task must not request parent quality adoption'); }});
  t.after(() => runtime.close());
  return {runtime, counts: () => ({plans, catalogCalls})};
}

for (const error of ['synthetic_outage', 'synthetic_auth_refusal'])
  test('completed output survives terminal retry exhaustion: ' + error, async t => {
    const dir = await directory(t), request = task(dir), calls = [];
    const {runtime} = await fixture(t, request, async ticket => {
      calls.push(ticket.candidate_id);
      return ticket.node_id === 'first' ? result(ticket) : failure(ticket, error);
    });
    await runtime.submit(request);
    const answer = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5_000});
    assertPartial(answer, 'verified_not_dispatched_retry_exhausted');
    assert.deepEqual(calls, ['a', 'b']);
    assert.equal(runtime._load(request.task_id).children[1].attempts, 1);
    await until(() => runtime.activeWorkers === 0);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) AS n FROM quota_leases').get().n, 0);
    await until(() => runtime.runningTasks.size === 0);
    await runtime.close();
    const reopened = await createRCCRuntime({stateDir: dir});
    t.after(() => reopened.close());
    assertPartial(reopened.status({schema: 1, task_id: request.task_id}),
      'verified_not_dispatched_retry_exhausted');
  });

for (const error of ['native_pre_dispatch_failed', 'pre_dispatch_failed',
  'native_configuration_or_authorization_unavailable', 'native_authorization_refused'])
  test('opaque pre-dispatch refusal holds the same row without retry: ' + error, async t => {
    const dir = await directory(t), request = task(dir, 3), calls = [];
    const {runtime, counts} = await fixture(t, request, async ticket => {
      calls.push(ticket.candidate_id);
      return ticket.node_id === 'first' ? result(ticket) : failure(ticket, error);
    });
    await runtime.submit(request);
    const answer = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5_000});
    assertPartial(answer, error, 'returned_unverified');
    assert.deepEqual(calls, ['a', 'b'], 'no alternate candidate or second native attempt');
    assert.equal(counts().plans, 1, 'no repair planner');
    const second = runtime._load(request.task_id).children[1];
    assert.equal(second.candidate_id, 'b'); assert.equal(second.attempts, 1);
    assert.equal(second.repair_needed, false); assert.equal(second.state, 'held');
    assert.equal(second.attempt_history[0].error, error);
    assert.equal(second.attempt_history[0].state, 'verified_not_dispatched');
    // An older persisted queued repair remains held before probing any fresh
    // catalog or selecting another native row. No hidden retry after restart.
    await until(() => runtime.runningTasks.size === 0);
    runtime._update(request.task_id, 'synthetic_legacy_queued_repair', snapshot => {
      snapshot.state = 'running'; snapshot.result = null; snapshot.error = null;
      snapshot.children[1].state = 'queued'; snapshot.children[1].repair_needed = true;
    });
    const before = counts();
    await runtime._replanSubset(request.task_id, 'second');
    assert.deepEqual(counts(), before);
    await runtime._scheduleDAG(request.task_id);
    assertPartial(runtime.status({schema: 1, task_id: request.task_id}), error, 'returned_unverified');
    assert.deepEqual(calls, ['a', 'b']);
  });

test('a failed pre-dispatch sibling waits for an already running completed answer', async t => {
  const dir = await directory(t), request = task(dir, 1, 2), release = gate(), started = [];
  const {runtime} = await fixture(t, request, async ticket => {
    started.push(ticket.node_id);
    if (ticket.node_id === 'first') { await release.promise; return result(ticket); }
    await until(() => started.includes('first'));
    return failure(ticket, 'synthetic_outage');
  }, {nodes: [node('first', 'a'), node('second', 'b')], finalNodeID: null});
  t.after(release.resolve);
  await runtime.submit(request);
  await until(() => runtime._load(request.task_id).children[1]?.state === 'failed');
  assert.equal(runtime.status({schema: 1, task_id: request.task_id}).state, 'running');
  release.resolve();
  assertPartial(await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5_000}),
    'verified_not_dispatched_retry_exhausted');
  assert.deepEqual(started, ['first', 'second']);
});

test('opaque refusal with no supported child output does not invent a partial answer', async t => {
  const dir = await directory(t), request = task(dir, 3), calls = [];
  const {runtime} = await fixture(t, request, async ticket => {
    calls.push(ticket.candidate_id); return failure(ticket, 'native_pre_dispatch_failed');
  }, {nodes: [node('second', 'b')]});
  await runtime.submit(request);
  const answer = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5_000});
  assert.equal(answer.state, 'held'); assert.equal(answer.error, 'native_pre_dispatch_failed');
  assert.equal(answer.result, null); assert.deepEqual(calls, ['b']);
});

test('verified native catalog unsupported tuple still permits bounded existing configuration repair', async t => {
  const dir = await directory(t), request = task(dir), calls = [];
  const {runtime, counts} = await fixture(t, request, async ticket => {
    calls.push(ticket.candidate_id);
    return ticket.candidate_id === 'b' ? failure(ticket, 'native_configuration_unavailable') :
      result(ticket, {output: ticket.node_id === 'first' ? '2' : '4'});
  });
  await runtime.submit(request);
  const answer = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5_000});
  assert.deepEqual(calls, ['a', 'b', 'alternative']);
  assert.equal(counts().plans, 2, 'only verified unsupported tuple allows a subset repair plan');
  assert.equal(answer.state, 'returned_unverified');
  assert.equal(answer.children[1].candidate_id, 'alternative');
  assert.equal(answer.children[1].output_summary, '4');
  assert.equal(answer.result.task_verified, false); assert.equal(answer.result.parity_state, 'unverified');
});
