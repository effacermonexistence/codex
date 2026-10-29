// K8: the first dispatch of a fresh single-node host plan reuses the catalog
// it was just bound with (no second full native catalog build). Everything
// else keeps the pre-dispatch refresh: a planner call after bind, an owner
// collection, a task contract, a calibrated pending dispatch, a second node,
// an injected plan, any retry, repair, re-resolution or spread, and a restart.
// admissionCurrent, _recheckCalibratedRoute and _candidate still run.
// Real durable runtime with fake catalog/executor callbacks: no provider,
// model, network or HOME state, and no paid call.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRCCRuntime, hostContextFingerprint } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const policyText = 'RCC bind-catalog reuse fixture policy: candidates do not grant authority.';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-bind-reuse-fixture-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request, {write = false, mode = 'auto', routes = null} = {}) {
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: !write, owner_policy: null, ...(routes ? {explicit_routes: routes} : {})};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode, material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, surface, model, effort, scope = 'read_only', validMs = 30_000) {
  const now = Date.now();
  const codex = surface === 'codex';
  return {id, surface, transport: codex ? 'codex_app_server' : 'claude_cli', account_id: 'account-1', model, effort,
    tools: scope === 'read_only' ? ['read', 'execute'] : ['read', 'write', 'execute'],
    scope, permission_profile: scope, quota_pool: codex ? 'openai_codex' : 'anthropic_shared',
    allowed_paths: scope === 'workspace_write' ? ['**'] : [], configuration_sha256: sha('config:' + id),
    availability: 'available', availability_observed_at_ms: now - 100, availability_valid_until_ms: now + validMs,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + validMs,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
const ROWS = (validMs) => [row('luna-low', 'codex', 'gpt-6-luna', 'low', 'read_only', validMs),
  row('astra-ultra', 'codex', 'gpt-6-astra', 'ultra', 'read_only', validMs),
  row('astra-ultra-w', 'codex', 'gpt-6-astra', 'ultra', 'workspace_write', validMs),
  row('fable-max', 'claude', 'claude-fable-5-1', 'max', 'read_only', validMs),
  row('fable-max-w', 'claude', 'claude-fable-5-1', 'max', 'workspace_write', validMs)];
const TIERS = {'gpt-6-luna': 'fast', 'gpt-6-astra': 'frontier', 'claude-fable-5-1': 'frontier'};
function catalog(request, {validMs = 30_000} = {}) {
  const cls = request.mode === 'explicit_routing_test' ? 'explicit_route' :
    !request.host_context.require_read_only ? 'writer' : 'readonly_lookup';
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, candidates: ROWS(validMs),
    model_tiers: TIERS, owner_scope: cls === 'writer' ? 'workspace_write' : 'read_only', chat_lane_eligible: false,
    request_class: cls};
}
function execution(ticket, patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output: 'answer for ' + ticket.node_id,
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: JSON.stringify({node: ticket.node_id}), ...patch};
}
const refusal = (ticket, error) => execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
  output: null, execution_verified: false, task_quality: 'failed', usage: null, error});
const verdict = ({task: value}) => ({schema: 1, task_id: value.task_id,
  task_verified: false, output: null, parity_state: 'unverified', reason: 'fixture_no_parent_checker'});
const tuple = ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}/${ticket.selected_config.effort}`;

// One durable runtime. Counts every catalog build and spies (without changing
// them) on the refresh, the reuse predicate and the calibrated recheck.
async function host(t, dir, {hostAutoPlan = true, catalogFor = value => catalog(value),
                              execute = ticket => execution(ticket), stateDir = null} = {}) {
  const tickets = [], reuse = [];
  let catalogCalls = 0, refreshCalls = 0, rechecks = 0;
  const runtime = await createRCCRuntime({stateDir: stateDir ?? join(dir, 'state-' + randomUUID()),
    maximumWorkers: 4, maximumReadWorkersPerPool: 4, hostAutoPlan,
    ...(hostAutoPlan ? {} : {plan: async ({task: value}) => ({schema: 1, task_id: value.task_id,
      request_sha256: value.request_sha256, nodes: [{id: 'n', instruction: value.request, dependencies: [],
        kind: 'agent', scope: 'read_only', owned_paths: [], context_refs: []}]})}),
    catalog: async value => { catalogCalls++; return catalogFor(value, catalogCalls); },
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); },
    verifyTask: verdict});
  t.after(async () => { await runtime.close(); });
  const refresh = runtime._refreshCatalog.bind(runtime);
  runtime._refreshCatalog = (...args) => { refreshCalls++; return refresh(...args); };
  const predicate = runtime._bindCatalogReusable.bind(runtime);
  runtime._bindCatalogReusable = (snapshot, node) => {
    const value = predicate(snapshot, node);
    reuse.push({value, snapshot: structuredClone(snapshot), node: structuredClone(node)});
    return value;
  };
  const recheck = runtime._recheckCalibratedRoute.bind(runtime);
  runtime._recheckCalibratedRoute = taskID => { rechecks++; return recheck(taskID); };
  const run = async request => {
    await runtime.submit(request);
    return runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 20_000});
  };
  const kinds = request => runtime.events({schema: 1, task_id: request.task_id}).map(event => event.kind);
  return {runtime, tickets, reuse, run, kinds, predicate,
    catalogCalls: () => catalogCalls, refreshCalls: () => refreshCalls, rechecks: () => rechecks};
}

test('a fresh single-node host plan dispatches on its bind-time catalog: one catalog build, no pre-dispatch refresh', async t => {
  const dir = await fixture(t);
  for (const [name, request, expected] of [
    ['a read-only question', task(dir, 'What does the interval rule in this workspace mean?'), 'codex:gpt-6-astra/ultra'],
    ['a writer', task(dir, 'Rename the interval helper in this workspace.', {write: true}), 'codex:gpt-6-astra/ultra'],
  ]) {
    const h = await host(t, dir);
    let boundAt = null;
    const update = h.runtime._update.bind(h.runtime);
    h.runtime._update = (taskID, kind, mutate) => {
      const snapshot = update(taskID, kind, mutate);
      if (kind === 'catalog_bound') boundAt = snapshot.catalog_bound_at_ms;
      return snapshot;
    };
    const done = await h.run(request);
    assert.equal(done.state, 'returned_unverified', `${name}: ${done.error}`);
    assert.equal(h.catalogCalls(), 1, `${name}: the bind build is the only catalog build`);
    assert.equal(h.refreshCalls(), 0, name);
    assert.deepEqual(h.tickets.map(tuple), [expected], name);
    assert.deepEqual(h.reuse.map(entry => entry.value), [true], `${name}: one first dispatch, once`);
    // Control: the same task with reuse refused takes the legacy refresh.
    // Every admission recheck (scheduler and node) runs on both paths.
    const control = await host(t, dir);
    control.runtime._bindCatalogReusable = () => false;
    const legacy = await control.run({...request, task_id: 'task-' + randomUUID()});
    assert.equal(legacy.state, 'returned_unverified', `${name}: ${legacy.error}`);
    assert.equal(control.catalogCalls(), 2, `${name}: the legacy path builds the catalog twice`);
    assert.deepEqual(control.tickets.map(tuple), [expected], name);
    assert.ok(h.rechecks() >= 1, `${name}: the calibrated recheck still runs on the reuse path`);
    assert.equal(h.rechecks(), control.rechecks(), `${name}: no recheck is skipped by the reuse`);
    const kinds = h.kinds(request);
    assert.ok(kinds.includes('catalog_bound'), name);
    assert.equal(kinds.includes('catalog_refreshed_before_dispatch'), false, name);
    assert.ok(Number.isSafeInteger(boundAt), name);
    assert.equal(h.runtime._load(request.task_id).catalog_bound_at_ms, boundAt,
      `${name}: the dispatch observation is the bind observation`);
    // The dispatched exact row is the one the plan bound: no other config.
    const state = h.runtime._load(request.task_id);
    assert.equal(h.tickets[0].candidate_id, state.plan.nodes[0].candidate_id, name);
    assert.deepEqual(h.tickets[0].selected_config, state.children[0].selected_config, name);
  }
});

test('an observation that expired after bind is refreshed before the first dispatch', async t => {
  const realNow = Date.now; let offset = 0; Date.now = () => realNow() + offset;
  t.after(() => { Date.now = realNow; });
  const dir = await fixture(t);
  // Rows valid for 1 s; planning time is advanced 5 s after the bind.
  const h = await host(t, dir, {catalogFor: value => catalog(value, {validMs: 1_000})});
  const observe = h.runtime._observeAdaptivePlan.bind(h.runtime);
  h.runtime._observeAdaptivePlan = async (...args) => { offset += 5_000; return observe(...args); };
  const request = task(dir, 'What does the interval rule in this workspace mean?');
  const done = await h.run(request);
  assert.equal(done.state, 'returned_unverified', done.error);
  assert.equal(h.catalogCalls(), 2, 'the expired bind observation is never dispatched on');
  assert.equal(h.refreshCalls(), 1);
  assert.ok(h.kinds(request).includes('catalog_refreshed_before_dispatch'));
  assert.deepEqual(h.tickets.map(tuple), ['codex:gpt-6-astra/ultra']);
  // The binding still matched and the predicate held: only the row's own
  // availability/quota window at Date.now() refused the reuse.
  assert.deepEqual(h.reuse.map(entry => entry.value), [true]);
});

test('only a fresh single-node host plan qualifies: every other state keeps the pre-dispatch refresh', async t => {
  const dir = await fixture(t);
  const h = await host(t, dir);
  const request = task(dir, 'What does the interval rule in this workspace mean?');
  assert.equal((await h.run(request)).state, 'returned_unverified');
  const [{snapshot: original, node}] = h.reuse;
  assert.equal(h.predicate(original, node), true);
  const before = JSON.stringify(original);
  const child = x => x.children[0];
  const cases = [
    ['cancel requested', x => { x.cancel_requested = true; }],
    ['terminal', x => { x.state = 'held'; }],
    ['planner invoked after bind', x => { x.adaptive_routing = {state: 'observed', planner_invoked: true}; }],
    ['owner collection', x => { x.owner_collection = {obligations: []}; }],
    ['task contract', x => { x.catalog.task_contract = {contract_sha256: sha('contract')}; }],
    ['calibrated pending dispatch', x => { x.calibrated_route = {state: 'pending_dispatch', node_id: child(x).id}; }],
    ['two nodes', x => { x.plan.nodes.push({...x.plan.nodes[0], id: 'other'}); }],
    ['not dispatched yet', x => { child(x).state = 'running'; }],
    ['an attempt', x => { child(x).attempts = 1; }],
    ['attempt history', x => { child(x).attempt_history = [{state: 'verified_not_dispatched'}]; }],
    ['repair', x => { child(x).repair_needed = true; }],
    ['continuation', x => { child(x).continuation = {state: 'pending'}; }],
    ['staging', x => { child(x).stage = {state: 'pending'}; }],
    ['re-resolution', x => { child(x).re_resolutions = 1; }],
    ['spread counter', x => { child(x).spreads = 1; }],
    ['spread flag', x => { child(x).spread = true; }],
  ];
  for (const [name, mutate] of cases) {
    const copy = structuredClone(original); mutate(copy);
    assert.equal(h.predicate(copy, copy.plan.nodes[0]), false, name);
  }
  assert.equal(h.predicate(original, {...node, kind: 'deterministic'}), false, 'a deterministic node');
  // An injected plan callback may take any time between bind and dispatch.
  h.runtime.hostAutoPlan = false;
  assert.equal(h.predicate(original, node), false, 'an injected plan');
  h.runtime.hostAutoPlan = true;
  h.runtime.stopping = true;
  assert.equal(h.predicate(original, node), false, 'a stopping owner');
  h.runtime.stopping = false;
  assert.equal(h.predicate(original, node), true);
  assert.equal(JSON.stringify(original), before, 'the predicate never mutates the authority snapshot');
});

test('an injected plan callback keeps the pre-dispatch refresh', async t => {
  const dir = await fixture(t);
  const h = await host(t, dir, {hostAutoPlan: false});
  const request = task(dir, 'What does the interval rule in this workspace mean?');
  const done = await h.run(request);
  assert.equal(done.state, 'returned_unverified', done.error);
  assert.equal(h.catalogCalls(), 2);
  assert.equal(h.refreshCalls(), 1);
  assert.deepEqual(h.reuse.map(entry => entry.value), [false]);
  assert.ok(h.kinds(request).includes('catalog_refreshed_before_dispatch'));
});

test('a task contract the native loader bound keeps the pre-dispatch refresh', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'What does the interval rule in this workspace mean?');
  const contract = value => ({coverage: 'full', scope: 'read_only', objective_sha256: value.request_sha256,
    contract_sha256: sha('contract'), context_sha256: sha(''), start_tree_sha256: sha('tree'),
    reference_policy_sha256: value.policy_sha256, valid_until_ms: Date.now() + 60_000, bindings_checked: true,
    source_sha256: null});
  const h = await host(t, dir, {catalogFor: value => ({...catalog(value), task_contract: contract(value)})});
  const done = await h.run(request);
  assert.equal(done.state, 'returned_unverified', done.error);
  assert.equal(h.reuse[0].value, false, 'the contract is re-observed before the first dispatch');
  assert.ok(h.catalogCalls() >= 2 && h.refreshCalls() >= 1);
  const kinds = h.kinds(request);
  assert.ok(kinds.indexOf('catalog_refreshed_before_dispatch') > kinds.indexOf('plan_admitted'));
  // The kept refresh decides the outcome. A contract that no longer binds
  // this request when the dispatch re-observes it holds the task before any
  // native call; the bind observation would have dispatched on it.
  const changed = await host(t, dir, {catalogFor: (value, call) => ({...catalog(value),
    task_contract: call === 1 ? contract(value) : {...contract(value), objective_sha256: sha('another request')}})});
  const stale = task(dir, 'What does the interval rule in this workspace mean?');
  const held = await changed.run(stale);
  assert.equal(held.state, 'held');
  assert.equal(held.error, 'catalog_binding_invalid');
  assert.equal(changed.tickets.length, 0, 'no native call on the bind-time contract');
  assert.equal(changed.catalogCalls(), 2);
  assert.deepEqual(changed.reuse.map(entry => entry.value), [false]);
  // A withdrawn contract: the first dispatch runs on the re-observed catalog,
  // which no longer carries the bind-time contract.
  const atDispatch = [];
  let withdrawn = null;
  withdrawn = await host(t, dir, {catalogFor: (value, call) =>
    call === 1 ? {...catalog(value), task_contract: contract(value)} : catalog(value),
  execute: ticket => {
    atDispatch.push(withdrawn.runtime._load(ticket.task_id).catalog.task_contract ?? null);
    return execution(ticket);
  }});
  const plain = task(dir, 'What does the interval rule in this workspace mean?');
  assert.equal((await withdrawn.run(plain)).state, 'returned_unverified');
  assert.deepEqual(withdrawn.reuse.map(entry => entry.value), [false]);
  assert.ok(atDispatch.length >= 1);
  assert.equal(atDispatch[0], null, 'the first dispatch sees the withdrawn contract, never the bind-time one');
});

test('a two-node host plan still refreshes before its first dispatch', async t => {
  const dir = await fixture(t);
  const h = await host(t, dir);
  const routes = [{surface: 'codex', instruction: 'Explain the interval rule.'},
    {surface: 'claude', instruction: 'Explain the split rule.'}];
  const request = task(dir, 'Codex한테 interval, Claude Code한테 split.', {mode: 'explicit_routing_test', routes});
  const done = await h.run(request);
  assert.equal(done.state, 'returned_unverified', done.error);
  assert.equal(h.tickets.length, 2);
  assert.ok(h.reuse.length >= 1 && h.reuse.every(entry => entry.value === false), 'a second node never reuses');
  assert.ok(h.catalogCalls() >= 2 && h.refreshCalls() >= 1);
  const kinds = h.kinds(request);
  assert.ok(kinds.indexOf('catalog_refreshed_before_dispatch') > kinds.indexOf('plan_admitted'));
});

test('cancel between plan admission and the reused first dispatch never dispatches', async t => {
  const dir = await fixture(t);
  const h = await host(t, dir);
  const request = task(dir, 'What does the interval rule in this workspace mean?');
  const spied = h.runtime._bindCatalogReusable;
  h.runtime._bindCatalogReusable = (snapshot, node) => {
    const value = spied(snapshot, node);
    h.runtime.cancel({schema: 1, task_id: request.task_id});
    return value;
  };
  const done = await h.run(request);
  assert.equal(done.state, 'cancelled');
  assert.deepEqual(h.reuse.map(entry => entry.value), [true], 'the reuse was admitted, then admissionCurrent held');
  assert.equal(h.tickets.length, 0);
  assert.equal(h.catalogCalls(), 1);
});

test('a native pre-dispatch refusal of the reused first dispatch is uncharged and re-resolves under the law', async t => {
  const dir = await fixture(t);
  for (const error of ['provider_quota_rejected_before_execution', 'native_configuration_unavailable']) {
    const h = await host(t, dir, {execute: (ticket, count) => count === 1 ? refusal(ticket, error) : execution(ticket)});
    const request = task(dir, 'What does the interval rule in this workspace mean?');
    const done = await h.run(request);
    assert.equal(done.state, 'returned_unverified', `${error}: ${done.error}`);
    assert.deepEqual(h.reuse.map(entry => entry.value), [true], `${error}: only the first dispatch reused`);
    // The reference of the other pool, never a cheaper row of either pool.
    assert.deepEqual(h.tickets.map(tuple), ['codex:gpt-6-astra/ultra', 'claude:claude-fable-5-1/max'], error);
    assert.ok(h.refreshCalls() >= 1, `${error}: the re-resolved dispatch runs on a refreshed catalog`);
    const child = h.runtime._load(request.task_id).children[0];
    assert.match(child.routing_decision.reason, new RegExp(`^re_resolved_after:${error};`), error);
    assert.deepEqual(child.attempt_history.map(entry => [entry.state, entry.error ?? null]),
      [['verified_not_dispatched', error], ['completed', null]], `${error}: the refusal is uncharged`);
  }
});

test('a stop and restart never dispatch on the earlier bind catalog', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'restart-state');
  const first = await host(t, dir, {stateDir});
  const request = task(dir, 'What does the interval rule in this workspace mean?');
  let token = null;
  // The owner stops after plan admission, before its scheduler runs.
  first.runtime._scheduleDAG = async (taskID, bindReuse) => { token = bindReuse; };
  await first.runtime.submit(request);
  const deadline = performance.now() + 10_000;
  while (token === null && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  const admitted = first.runtime._load(request.task_id);
  assert.equal(admitted.state, 'running');
  assert.equal(token.binding, first.runtime._readyWaveBinding(admitted), 'the token binds the plan_admitted snapshot');
  // The stop settles the admitted, undispatched task; the restarted owner
  // never resumes it (the token lived only in the stopped owner's _runTask).
  await first.runtime.close();
  const second = await host(t, dir, {stateDir});
  const done = await second.runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5_000});
  assert.equal(done.state, 'held');
  assert.equal(done.error, 'owner_stopped_before_dispatch');
  assert.equal(first.tickets.length + second.tickets.length, 0);
  assert.equal(second.catalogCalls(), 0);
  assert.equal(second.reuse.length, 0);
});
