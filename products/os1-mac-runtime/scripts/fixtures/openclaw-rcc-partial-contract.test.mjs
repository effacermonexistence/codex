// K12 partial result contract v2 (RT-08). A host opts in per task with
// result_contract_version 2; only then does Core type a partial outcome on
// the wire: coverage (completed vs unresolved nodes), the parent task it
// belongs to, and per carried node its attempt and output digest. A v1 task
// keeps today's whole-answer contract: a failed task is a typed failure with
// no result on the wire (its partial stays durable for the inspector), and a
// held-with-retained-output task stays returned_unverified with no `partial`.
// Actual SQLite runtime; synthetic adapters and a registered fixture verifier
// only. No provider, model, network or HOME state.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createRCCRuntime, hostContextFingerprint, registerNodeVerifiers} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) { if (predicate()) return; await sleep(10); }
  throw Error('fixture condition timeout');
}
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'os1-partial-contract-'));
  await chmod(path, 0o700);
  t.after(() => rm(path, {recursive: true, force: true}));
  return path;
}
const POLICY = 'Fixture RCC policy: preserve supported state, no invented authority';
function task(workspace, {version, attempts = 1, parallel = 2, nativeCap = null,
  request = 'Send independent arithmetic requests'} = {}) {
  const host = {workspace, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: randomUUID(), request, objective: request,
    request_sha256: sha(request), source_fingerprint: hostContextFingerprint(host),
    policy_sha256: sha(POLICY), mode: 'auto', material_refs: [], host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(POLICY), text: POLICY},
    budget: {max_attempts: attempts, max_parallel: parallel, max_cost_units: null, max_duration_ms: 20_000,
      ...(nativeCap === null ? {} : {max_native_dispatches: nativeCap})},
    ...(version === undefined ? {} : {result_contract_version: version})};
}
function row(id, overrides = {}) {
  const now = Date.now();
  return {id, surface: 'codex', transport: 'codex_app_server', account_id: 'synthetic',
    model: 'synthetic-model', effort: 'low', tools: [], scope: 'read_only',
    permission_profile: 'read_only', quota_pool: 'openai_codex', allowed_paths: [],
    configuration_sha256: sha(id), availability: 'available',
    availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.8, quota_observed_at_ms: now - 1,
    quota_valid_until_ms: now + 30_000, quality_state: 'policy_admitted', estimated_cost_units: 1, ...overrides};
}
const node = (id, candidateID, dependencies = []) => ({id, candidate_id: candidateID,
  instruction: 'Return the ' + id + ' arithmetic answer', dependencies, kind: 'agent', scope: 'read_only',
  owned_paths: [], context_refs: []});
const answers = {first: '2', second: '4', third: '6'};
const result = (ticket, overrides = {}) => ({schema: 1, task_id: ticket.task_id, node_id: ticket.node_id,
  attempt_id: ticket.attempt_id, candidate_id: ticket.candidate_id,
  configuration_sha256: ticket.configuration_sha256, selected_config: ticket.selected_config,
  acknowledged_config: ticket.selected_config, observed_config: ticket.selected_config,
  status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output: answers[ticket.node_id] ?? '2',
  execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
  native_receipt: '/private/synthetic/' + ticket.attempt_id,
  native_summary: JSON.stringify({node: ticket.node_id, synthetic: true}),
  native_turn_terminated: true, ...overrides});
const failure = (ticket, error) => result(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
  output: 'failure text is not a mathematical answer', error, execution_verified: false,
  task_verified: false, task_quality: 'failed', observed_config: null, native_summary: null});
// One private runtime state directory per task (one owner per directory).
const stateDirOf = request => join(request.host_context.workspace, 'state-' + request.task_id);
async function fixture(t, request, {nodes, execute, ...options}) {
  const runtime = await createRCCRuntime({stateDir: stateDirOf(request),
    maximumWorkers: 3, maximumReadWorkersPerPool: 3,
    catalog: async q => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
      candidates: [row('a'), row('b'), row('c')]}),
    // A chain ends at its last node; independent units are a collection.
    plan: async ({task: q}) => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
      nodes, final_node_id: nodes.some(n => n.dependencies.length) ? nodes.at(-1).id : null}),
    execute, verifyTask: () => { throw Error('a partial task must not request parent quality adoption'); },
    ...options});
  t.after(() => runtime.close());
  return runtime;
}
const wait = (runtime, request) => runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
const failSecond = error => async ticket => ticket.node_id === 'second' ? failure(ticket, error) : result(ticket);

/** The host contract (CT validate(Snapshot)) restated for a v2 partial. */
function assertWirePartial(answer, request, durable) {
  const partial = answer.result.partial;
  assert.ok(['failed', 'held', 'cancelled', 'returned_unverified'].includes(answer.state));
  assert.equal(answer.install_handoff, null);
  assert.equal(answer.result.task_verified, false); assert.equal(answer.result.parity_state, 'unverified');
  assert.equal(answer.result.task_quality, 'execution_only');
  assert.deepEqual(Object.keys(partial).sort(), ['coverage', 'nodes', 'parent']);
  assert.deepEqual(Object.keys(partial.coverage).sort(), ['completed_node_ids', 'unresolved_node_ids']);
  assert.deepEqual(Object.keys(partial.parent).sort(), ['request_sha256', 'revision', 'task_id']);
  assert.equal(partial.parent.task_id, request.task_id);
  assert.equal(partial.parent.request_sha256, request.request_sha256);
  assert.ok(Number.isSafeInteger(partial.parent.revision) && partial.parent.revision > 0 &&
    partial.parent.revision <= answer.revision, 'bound to a revision this task has reached');
  const {completed_node_ids: completed, unresolved_node_ids: unresolved} = partial.coverage;
  assert.ok(unresolved.length > 0, 'a partial always names what it did not resolve');
  assert.deepEqual([...completed, ...unresolved].sort(), answer.children.map(c => c.id).sort());
  assert.equal(new Set([...completed, ...unresolved]).size, answer.children.length, 'disjoint and complete');
  for (const id of completed) assert.equal(answer.children.find(c => c.id === id).state, 'completed', id);
  for (const id of unresolved) assert.notEqual(answer.children.find(c => c.id === id).state, 'completed', id);
  const carried = partial.nodes.map(n => n.node_id);
  assert.equal(new Set(carried).size, carried.length);
  for (const id of completed) assert.ok(carried.includes(id), 'every completed node is carried');
  for (const entry of partial.nodes) {
    assert.deepEqual(Object.keys(entry).sort(), ['attempt_id', 'native_receipt_sha256', 'node_id', 'output_sha256']);
    const child = durable.children.find(c => c.id === entry.node_id);
    assert.equal(entry.attempt_id, child.attempt_id);
    assert.equal(entry.output_sha256, sha(child.output));
    assert.equal(entry.native_receipt_sha256, null, 'Core keeps no receipt digest; never a guess');
    assert.ok(answer.result.output.includes(`${entry.node_id}: ${child.output}`));
  }
  assert.equal(answer.result.output, partial.nodes.map(n => `${n.node_id}: ${durable.children
    .find(c => c.id === n.node_id).output}`).join('\n\n'), 'the output is exactly the carried nodes');
}

test('result_contract_version: absent, null, 1 or 2 only; part of the submit fingerprint', async t => {
  const dir = await directory(t);
  const runtime = await fixture(t, task(dir), {nodes: [node('first', 'a')], execute: async ticket => result(ticket)});
  for (const bad of [0, 3, -1, 1.5, '2', '1', true, false, {}, [2]])
    await assert.rejects(() => runtime.submit(task(dir, {version: bad})), /result_contract_version_invalid/, String(bad));
  for (const good of [undefined, null, 1, 2]) {
    const request = task(dir, {version: good});
    await runtime.submit(request);
    assert.equal((await wait(runtime, request)).state, 'returned_unverified', String(good));
    assert.equal(runtime._load(request.task_id).task.result_contract_version, good, 'stored as sent');
  }
  // The version is part of the fingerprint: a host never re-sends a task ID
  // under another version (absent, 1 and 2 are each a different task).
  const v2 = task(dir, {version: 2});
  await runtime.submit(v2);
  for (const other of [undefined, 1]) {
    const changed = structuredClone(v2);
    if (other === undefined) delete changed.result_contract_version; else changed.result_contract_version = other;
    await assert.rejects(() => runtime.submit(changed), /idempotency_conflict/, String(other));
  }
  await wait(runtime, v2);
  assert.equal((await runtime.submit(v2)).task_id, v2.task_id, 'the identical v2 task is idempotent');
});

test('v2 failed task: a typed partial (coverage, parent, nodes) on the wire, identical after restart', async t => {
  const dir = await directory(t), request = task(dir, {version: 2});
  const runtime = await fixture(t, request, {nodes: [node('first', 'a'), node('second', 'b', ['first'])],
    execute: failSecond('synthetic_outage')});
  await runtime.submit(request);
  const answer = await wait(runtime, request);
  assert.equal(answer.state, 'failed'); assert.equal(answer.error, 'verified_not_dispatched_retry_exhausted');
  const durable = runtime._load(request.task_id);
  assertWirePartial(answer, request, durable);
  assert.deepEqual(answer.result.partial.coverage, {completed_node_ids: ['first'], unresolved_node_ids: ['second']});
  assert.equal(answer.result.output, 'first: 2');
  assert.equal(answer.children.find(c => c.id === 'second').output_summary, null);
  // The durable event stream carries the same typed partial at its revision.
  const failed = runtime.events({schema: 1, task_id: request.task_id}).find(e => e.kind === 'task_failed');
  assert.deepEqual(failed.snapshot.result, answer.result);
  assert.equal(failed.snapshot.result.partial.parent.revision, failed.revision);
  await until(() => runtime.runningTasks.size === 0);
  await runtime.close();
  const reopened = await createRCCRuntime({stateDir: stateDirOf(request)});
  t.after(() => reopened.close());
  assert.deepEqual(reopened.status({schema: 1, task_id: request.task_id}).result, answer.result);
});

test('three independent units, one fails: two completed and carried, one unresolved', async t => {
  const dir = await directory(t);
  for (const version of [undefined, 2]) {
    const request = task(dir, {version, parallel: 3}), started = [];
    // The failing unit returns only after both others are running, so both
    // complete (a failure stops new dispatch, never a running sibling).
    const runtime = await fixture(t, request, {nodes: [node('first', 'a'), node('second', 'b'), node('third', 'c')],
      execute: async ticket => {
        started.push(ticket.node_id);
        if (ticket.node_id !== 'second') return result(ticket);
        await until(() => started.includes('first') && started.includes('third'));
        return failure(ticket, 'synthetic_outage');
      }});
    await runtime.submit(request);
    const answer = await wait(runtime, request);
    assert.equal(answer.state, 'failed', String(version));
    const durable = runtime._load(request.task_id);
    assert.equal(durable.result.output, 'first: 2\n\nthird: 6', 'the durable record keeps both completed units');
    if (version !== 2) { assert.equal(answer.result, null, 'v1: a typed failure, no result on the wire'); continue; }
    assertWirePartial(answer, request, durable);
    assert.deepEqual(answer.result.partial.coverage,
      {completed_node_ids: ['first', 'third'], unresolved_node_ids: ['second']});
    assert.deepEqual(answer.result.partial.nodes.map(n => n.node_id), ['first', 'third']);
    assert.equal(answer.result.output, 'first: 2\n\nthird: 6');
  }
});

test('held path: v1 result is unchanged (no partial key); v2 types the same answer', async t => {
  const dir = await directory(t);
  const results = {};
  for (const version of [undefined, 2]) {
    const request = task(dir, {version, attempts: 3});
    const runtime = await fixture(t, request, {nodes: [node('first', 'a'), node('second', 'b', ['first'])],
      execute: failSecond('native_pre_dispatch_failed')});
    await runtime.submit(request);
    const answer = await wait(runtime, request);
    assert.equal(answer.state, 'returned_unverified'); assert.equal(answer.error, 'native_pre_dispatch_failed');
    assert.equal(answer.result.output, 'first: 2');
    results[version ?? 'v1'] = answer.result;
    if (version === 2) {
      assertWirePartial(answer, request, runtime._load(request.task_id));
      assert.deepEqual(answer.result.partial.coverage, {completed_node_ids: ['first'], unresolved_node_ids: ['second']});
    }
  }
  assert.deepEqual(Object.keys(results.v1).sort(), ['execution_verified', 'native_receipt', 'native_summaries',
    'native_summary', 'output', 'parity_state', 'task_quality', 'task_verified'], 'v1 golden key set');
  const {partial, ...rest} = results[2];
  assert.ok(partial);
  assert.deepEqual({...rest, native_receipt: null}, {...results.v1, native_receipt: null},
    'v2 is the v1 answer plus its typed partial');
});

test('a node whose attempt or output changed before attach drops the v2 partial; the failure stands', async t => {
  const dir = await directory(t);
  for (const [name, change] of [['output', child => { child.output = '3'; }],
    ['attempt', child => { child.attempt_id = 'replaced-attempt'; }]]) {
    const request = task(dir, {version: 2});
    const runtime = await fixture(t, request, {nodes: [node('first', 'a'), node('second', 'b', ['first'])],
      execute: failSecond('synthetic_outage')});
    const original = runtime._partialResult.bind(runtime);
    runtime._partialResult = async (...args) => {
      const value = await original(...args);
      runtime._update(request.task_id, 'synthetic_race', state => change(state.children.find(c => c.id === 'first')));
      return value;
    };
    await runtime.submit(request);
    const answer = await wait(runtime, request);
    assert.equal(answer.state, 'failed', name);
    assert.equal(answer.error, 'verified_not_dispatched_retry_exhausted', name);
    assert.equal(answer.result, null, name + ': never a stale partial');
    assert.equal(runtime._load(request.task_id).result, null, name);
  }
  // The held path drops the whole result: held, not returned_unverified.
  const request = task(dir, {version: 2, attempts: 3});
  const runtime = await fixture(t, request, {nodes: [node('first', 'a'), node('second', 'b', ['first'])],
    execute: failSecond('native_pre_dispatch_failed')});
  const original = runtime._partialResult.bind(runtime);
  runtime._partialResult = async (...args) => {
    const value = await original(...args);
    runtime._update(request.task_id, 'synthetic_race', state => { state.children.find(c => c.id === 'first').output = '3'; });
    return value;
  };
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held'); assert.equal(held.error, 'native_pre_dispatch_failed'); assert.equal(held.result, null);
});

test('a completed deterministic node is carried with no attempt; failed and held paths keep their answer', async t => {
  const dir = await directory(t);
  // A deterministic node runs on the host-computed exact local row: it
  // completes with no attempt id, beside model-backed siblings.
  const local = row('local', {surface: 'local', transport: 'local', model: 'exact', effort: 'none',
    quota_pool: 'none', quota_remaining_fraction: null, quota_observed_at_ms: null, quota_valid_until_ms: null});
  const nodes = [{...node('d', 'local'), kind: 'deterministic', instruction: '1+1'}, node('first', 'a'),
    node('second', 'b', ['d', 'first'])];
  for (const [path, attempts, error] of [['failed', 1, 'synthetic_outage'], ['held', 3, 'native_pre_dispatch_failed']])
  for (const version of [undefined, 2]) {
    const request = task(dir, {version, attempts, parallel: 3}), label = `${path} v${version ?? 1}`;
    const runtime = await fixture(t, request, {nodes, execute: failSecond(error),
      catalog: async q => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
        candidates: [row('a'), row('b'), local]})});
    await runtime.submit(request);
    const answer = await wait(runtime, request);
    const durable = runtime._load(request.task_id);
    assert.equal(durable.children.find(c => c.id === 'd').attempt_id, null, label);
    assert.equal(durable.result.output, 'd: 2\n\nfirst: 2', label + ': the durable answer is kept');
    if (path === 'failed') {
      assert.equal(answer.state, 'failed', label);
      assert.equal(answer.error, 'verified_not_dispatched_retry_exhausted', label);
      if (version !== 2) { assert.equal(answer.result, null, label); continue; }
    } else {
      // Never `partial_contract_invalid` in place of the hold reason.
      assert.equal(answer.state, 'returned_unverified', label); assert.equal(answer.error, error, label);
      assert.equal(answer.result.output, 'd: 2\n\nfirst: 2', label);
      if (version !== 2) { assert.equal(answer.result.partial, undefined, label); continue; }
    }
    assertWirePartial(answer, request, durable);
    assert.deepEqual(answer.result.partial.coverage,
      {completed_node_ids: ['d', 'first'], unresolved_node_ids: ['second']}, label);
    assert.deepEqual(answer.result.partial.nodes.map(n => [n.node_id, n.attempt_id === null]),
      [['d', true], ['first', false]], label + ': only the deterministic node has no attempt');
  }
});

test('a partial the contract cannot type falls back to the v1 result; the reason stands', async t => {
  const dir = await directory(t);
  for (const [path, attempts, error] of [['failed', 1, 'synthetic_outage'], ['held', 3, 'native_pre_dispatch_failed']]) {
    const request = task(dir, {version: 2, attempts});
    const runtime = await fixture(t, request, {nodes: [node('first', 'a'), node('second', 'b', ['first'])],
      execute: failSecond(error)});
    // A model-backed child with no attempt is not typeable (synthetic).
    const original = runtime._partialResult.bind(runtime);
    runtime._partialResult = (taskID, returned, snapshot) =>
      original(taskID, returned.map(c => ({...c, attempt_id: null})), snapshot);
    await runtime.submit(request);
    const answer = await wait(runtime, request);
    assert.equal(runtime._load(request.task_id).result.output, 'first: 2', path + ': the answer is never lost');
    assert.equal(runtime._load(request.task_id).result.partial, undefined, path);
    if (path === 'failed') {
      assert.equal(answer.state, 'failed'); assert.equal(answer.error, 'verified_not_dispatched_retry_exhausted');
      assert.equal(answer.result, null, 'an untyped failed partial stays durable, off the wire');
    } else {
      assert.equal(answer.state, 'returned_unverified'); assert.equal(answer.error, error);
      assert.equal(answer.result.output, 'first: 2'); assert.equal(answer.result.partial, undefined);
    }
  }
});

test('projection gate: no result on an unfinished task or a v1 failed one; an older stored row too', async t => {
  const dir = await directory(t);
  for (const version of [undefined, 2]) {
    const request = task(dir, {version});
    const runtime = await fixture(t, request, {nodes: [node('first', 'a'), node('second', 'b', ['first'])],
      execute: failSecond('synthetic_outage')});
    await runtime.submit(request);
    const answer = await wait(runtime, request);
    await until(() => runtime.runningTasks.size === 0);
    const stored = runtime._load(request.task_id).result;
    assert.ok(stored);
    const view = state => {
      runtime._update(request.task_id, 'synthetic_state', snapshot => { snapshot.state = state; });
      return runtime.status({schema: 1, task_id: request.task_id}).result;
    };
    // A partial whose parent is not finished is never shown.
    for (const state of ['running', 'planning', 'queued', 'cancelling', 'effects_uncertain'])
      assert.equal(view(state), null, `${version ?? 'v1'} ${state}`);
    for (const state of ['failed', 'held', 'cancelled'])
      assert.deepEqual(view(state), version === 2 ? answer.result : null, `${version ?? 'v1'} ${state}`);
    // A whole answer shows as before, whatever the version.
    assert.deepEqual(view('returned_unverified'), stored);
    runtime._update(request.task_id, 'synthetic_state', snapshot => { snapshot.state = 'failed'; });
  }
  // An older build's stored failed task with a result: the wire hides it, the
  // durable row (inspector) keeps it, across a restart.
  const request = task(dir);
  const runtime = await fixture(t, request, {nodes: [node('first', 'a')], execute: async ticket => result(ticket)});
  await runtime.submit(request);
  assert.equal((await wait(runtime, request)).state, 'returned_unverified');
  await until(() => runtime.runningTasks.size === 0);
  runtime._update(request.task_id, 'synthetic_pre_k12_failed', snapshot => {
    snapshot.state = 'failed'; snapshot.error = 'child_failed';
  });
  assert.equal(runtime.status({schema: 1, task_id: request.task_id}).result, null);
  await runtime.close();
  const reopened = await createRCCRuntime({stateDir: stateDirOf(request)});
  t.after(() => reopened.close());
  assert.equal(reopened.status({schema: 1, task_id: request.task_id}).result, null);
  assert.equal(reopened._load(request.task_id).result.output, '2');
});

test('one law: an unaccepted certified descent is never carried; it is unresolved', async t => {
  const dir = await directory(t);
  const passes = async input => ({passed: input.output === answers[input.node_id], reason: 'fixture'});
  const registry = await registerNodeVerifiers(new Map([['fixture-sound', {id: 'fixture-sound', scope: 'read_only',
    surfaces: ['agent', 'chat'], soundness: 'sound_full', applies: () => true, verify: passes,
    refutations: [{instruction: 'Return the first arithmetic answer', output: 'fixture wrong answer'}]}]]));
  const tiered = (id, model, effort) => row(id, {model, effort, configuration_sha256: sha(id + model + effort)});
  const unbound = id => ({id, instruction: 'Return the ' + id + ' arithmetic answer', dependencies: [], kind: 'agent',
    scope: 'read_only', owned_paths: [], context_refs: []});
  for (const version of [undefined, 2]) {
    // Both nodes bind the certified fast descent (K4 registered sound_full
    // verifier) with the frontier reference fixed at bind. 'first' answers
    // wrong; its one escalation needs a third native dispatch, which the cap
    // of two refuses (a typed hold of that child, K6) while 'second' is still
    // running. 'second' then passes its check: the task settles with one
    // accepted answer and one unaccepted descent.
    const request = task(dir, {version, attempts: 2, nativeCap: 2});
    const tickets = [];
    let runtime = null;
    runtime = await createRCCRuntime({stateDir: stateDirOf(request), verifierRegistry: registry,
      maximumWorkers: 2, maximumReadWorkersPerPool: 2,
      catalog: async q => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
        candidates: [tiered('astra-max', 'gpt-6-astra', 'max'), tiered('luna-low', 'gpt-6-luna', 'low')],
        model_tiers: {'gpt-6-luna': 'fast', 'gpt-6-astra': 'frontier'}}),
      plan: async ({task: q}) => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
        nodes: [unbound('first'), unbound('second')], final_node_id: null}),
      execute: async ticket => {
        tickets.push(ticket);
        if (ticket.node_id === 'first') {
          await until(() => tickets.some(other => other.node_id === 'second'));
          return result(ticket, {output: 'an unchecked wrong answer'});
        }
        await until(() => runtime._load(request.task_id).children.find(c => c.id === 'first')?.state === 'held');
        return result(ticket);
      },
      verifyTask: () => { throw Error('no parent adoption'); }});
    t.after(() => runtime.close());
    await runtime.submit(request);
    const answer = await wait(runtime, request);
    assert.deepEqual(tickets.map(ticket => ticket.selected_config.model), ['gpt-6-luna', 'gpt-6-luna'],
      'both nodes ran the descent; nothing else dispatched');
    const durable = runtime._load(request.task_id);
    const first = durable.children.find(c => c.id === 'first');
    assert.equal(first.state, 'held'); assert.equal(first.hold_reason, 'native_dispatch_budget_exhausted');
    assert.equal(first.output, null, 'the failed descent output is discarded');
    assert.equal(answer.state, 'returned_unverified', answer.error);
    assert.equal(answer.error, 'native_dispatch_budget_exhausted');
    assert.equal(answer.result.output, 'second: 4');
    assert.ok(!JSON.stringify(answer).includes('an unchecked wrong answer'));
    assert.equal(answer.children.find(c => c.id === 'first').output_summary, null);
    if (version === 2) {
      assertWirePartial(answer, request, durable);
      assert.deepEqual(answer.result.partial.coverage, {completed_node_ids: ['second'], unresolved_node_ids: ['first']});
      assert.deepEqual(answer.result.partial.nodes.map(n => n.node_id), ['second']);
    } else assert.equal(answer.result.partial, undefined);
  }
});

test('a derived intent task keeps the version; the partial binds the original task', async t => {
  const dir = await directory(t), request = task(dir, {version: 2, request: '다 넘겨봐 1+1 2+2'});
  const routes = [{surface: 'codex', instruction: '1+1'}, {surface: 'codex', instruction: '2+2'}];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'intent'), maximumWorkers: 2, maximumReadWorkersPerPool: 2,
    resolveIntent: async ({task: q}) => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
      policy_sha256: q.policy_sha256, source_fingerprint: q.source_fingerprint, kind: 'routes', routes,
      best_effort: false, notices: ['Core interpreted the original routing request.'], reason: null, model_answer: null}),
    catalog: async q => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
      candidates: [row('codex-fixture', {effort: 'medium'})]}),
    plan: async ({task: q}) => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256,
      nodes: q.host_context.explicit_routes.map((route, index) => ({id: `node-${index + 1}`,
        instruction: route.instruction, dependencies: [], kind: 'agent', candidate_id: 'codex-fixture',
        scope: 'read_only', owned_paths: [], context_refs: []}))}),
    execute: async ticket => ticket.instruction === '2+2' ? failure(ticket, 'synthetic_outage') :
      result(ticket, {output: '2'}),
    verifyTask: () => { throw Error('no parent adoption'); }});
  t.after(() => runtime.close());
  await runtime.submit(request);
  const answer = await wait(runtime, request);
  const durable = runtime._load(request.task_id);
  assert.equal(durable.effective_task.result_contract_version, 2, 'deriveIntentTask keeps the version');
  assert.equal(durable.effective_task.mode, 'explicit_routing_test');
  assert.equal(answer.state, 'failed', answer.error);
  assertWirePartial(answer, request, durable);
  assert.equal(answer.result.partial.parent.task_id, request.task_id);
  assert.equal(answer.result.partial.parent.request_sha256, request.request_sha256);
});
