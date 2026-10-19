// Build 407-g host plans (R7, R8): Core builds every plan itself. Auto runs
// ONE agent node whose instruction is the owner's request byte-exact; an
// explicit route test runs one node per route that still runs, keyed by its
// original ordinal, with that route's own text. No model plans, grades or
// rewrites either, and a repair re-resolves rows instead of re-planning.
// Real durable runtime with a fake executor: no provider, model, network or
// HOME state.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRCCRuntime, hostContextFingerprint } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const policyText = 'RCC host-plan fixture policy: candidates do not grant authority.';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-host-plan-fixture-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request, {write = false, mode = 'auto', materials = [], routes = null, bestEffort = false} = {}) {
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: !write, owner_policy: null,
    ...(routes ? {explicit_routes: routes} : {}), ...(bestEffort ? {explicit_routes_best_effort: true} : {})};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode, material_refs: materials,
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, surface, model, effort, scope = 'read_only') {
  const now = Date.now();
  const codex = surface === 'codex';
  return {id, surface, transport: codex ? 'codex_app_server' : 'claude_cli', account_id: 'account-1', model, effort,
    tools: surface.endsWith('-chat') ? [] : scope === 'read_only' ? ['read', 'execute'] : ['read', 'write', 'execute'],
    scope, permission_profile: scope, quota_pool: codex ? 'openai_codex' : 'anthropic_shared',
    allowed_paths: scope === 'workspace_write' ? ['**'] : [], configuration_sha256: sha('config:' + id),
    availability: 'available', availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
const ROWS = () => [row('luna-low', 'codex', 'gpt-6-luna', 'low'), row('astra-ultra', 'codex', 'gpt-6-astra', 'ultra'),
  row('astra-ultra-w', 'codex', 'gpt-6-astra', 'ultra', 'workspace_write'),
  row('haiku', 'claude', 'claude-haiku-4-5', 'none'), row('fable-max', 'claude', 'claude-fable-5-1', 'max'),
  row('fable-max-w', 'claude', 'claude-fable-5-1', 'max', 'workspace_write'),
  row('chat-fable-max', 'claude-chat', 'claude-fable-5-1', 'max')];
const TIERS = {'gpt-6-luna': 'fast', 'gpt-6-astra': 'frontier', 'claude-haiku-4-5': 'fast', 'claude-fable-5-1': 'frontier'};
// As the native builder emits it: chat-lane rows only for a route that names
// that lane (these requests are not chat-lane eligible).
function catalog(request, {rows = ROWS().filter(c => c.surface !== 'claude-chat' || request.mode === 'explicit_routing_test'),
                           facts = null} = {}) {
  const models = new Set(rows.map(c => c.model));
  const cls = request.mode === 'explicit_routing_test' ? 'explicit_route' :
    !request.host_context.require_read_only ? 'writer' : request.material_refs.length ? 'readonly_material' : 'readonly_lookup';
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, candidates: rows,
    model_tiers: Object.fromEntries(Object.entries(TIERS).filter(([model]) => models.has(model))),
    ...(facts ?? {owner_scope: cls === 'writer' ? 'workspace_write' : 'read_only', chat_lane_eligible: false,
      request_class: cls})};
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
const verdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: false, output: null, parity_state: 'unverified', reason: 'fixture_no_parent_checker'});
const tuple = ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}/${ticket.selected_config.effort}`;

// One durable runtime. `plan` counts every planner call (production passes
// none: hostAutoPlan with no plan callback at all).
async function host(t, dir, {catalogFor = request => catalog(request), execute = ticket => execution(ticket),
                              withPlanner = true} = {}) {
  const tickets = [];
  let planCalls = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state-' + randomUUID()), hostAutoPlan: true,
    maximumWorkers: 4, maximumReadWorkersPerPool: 4,
    ...(withPlanner ? {plan: async () => { planCalls++; throw Error('a host plan never calls the planner'); }} : {}),
    catalog: async value => catalogFor(value),
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); },
    verifyTask: verdict});
  t.after(async () => { await runtime.close(); });
  const run = async request => {
    await runtime.submit(request);
    return runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
  };
  return {runtime, tickets, run, planCalls: () => planCalls};
}

test('Auto never calls the planner: every request runs as one host node, byte-exact, at the reference (R7, R8)', async t => {
  const dir = await fixture(t);
  // A 3-bullet single-site spec: one writer session owning the workspace,
  // never split into per-bullet nodes.
  const site = 'Build a one-page site for the bakery:\n- a hero with the logo\n- the menu with prices\n- a contact form\n';
  // A big multi-deliverable request still runs as one reference session (R8).
  const big = 'Ship the release:\n' + Array.from({length: 24}, (_, index) =>
    `${index + 1}. Update module ${index + 1} and its tests, then document the change in CHANGELOG.md.`).join('\n');
  // Leading and trailing whitespace, tabs and blank lines are the owner's bytes.
  const spaced = '  \n\tWhat does the interval rule in this workspace mean?\n\n';
  const cases = [
    ['a question', task(dir, 'What does the interval rule in this workspace mean?'), 'codex:gpt-6-astra/ultra', 'read_only', []],
    ['material', task(dir, 'Summarize the attached notes.', {materials: ['material-1', 'material-2']}),
      'codex:gpt-6-astra/ultra', 'read_only', []],
    ['a 3-bullet single-site spec', task(dir, site, {write: true}), 'codex:gpt-6-astra/ultra', 'workspace_write', ['**']],
    ['a 24-part request', task(dir, big, {write: true}), 'codex:gpt-6-astra/ultra', 'workspace_write', ['**']],
    ['whitespace kept', task(dir, spaced), 'codex:gpt-6-astra/ultra', 'read_only', []],
  ];
  for (const withPlanner of [true, false]) {
    const runtime = await host(t, dir, {withPlanner});
    for (const [name, request, expected, scope, owned] of cases) {
      const fresh = {...request, task_id: 'task-' + randomUUID()};
      const before = runtime.tickets.length;
      const done = await runtime.run(fresh);
      assert.equal(done.state, 'returned_unverified', `${name}: ${done.error}`);
      const tickets = runtime.tickets.slice(before);
      assert.equal(tickets.length, 1, `${name}: exactly one node, one session`);
      const [ticket] = tickets;
      assert.equal(ticket.node_id, 'node_0', name);
      assert.equal(ticket.instruction, request.request, `${name}: the owner request byte-exact`);
      assert.equal(tuple(ticket), expected, name);
      assert.equal(ticket.selected_config.scope, scope, name);
      const plan = runtime.runtime._load(fresh.task_id).plan;
      assert.deepEqual(plan.nodes.map(node => [node.id, node.instruction, node.kind, node.scope, node.owned_paths,
        node.dependencies, node.context_refs]),
      [['node_0', request.request, 'agent', scope, owned, [], request.material_refs]], name);
      assert.equal(plan.final_node_id, 'node_0', `${name}: the one node owns the final output`);
      assert.equal(done.result.output, 'answer for node_0', name);
    }
    assert.equal(runtime.planCalls(), 0, 'no planner call, with or without a planner callback');
  }
});

test('hostAutoPlan is what production passes: the default still runs an injected plan, and holds without one', async t => {
  const dir = await fixture(t);
  const request = () => task(dir, 'What does the interval rule in this workspace mean?');
  // Without hostAutoPlan and without a planner (the fixture default), Auto
  // cannot plan: a typed hold, never a silent host plan.
  const bare = await createRCCRuntime({stateDir: join(dir, 'bare'), catalog: async value => catalog(value),
    execute: async ticket => execution(ticket), verifyTask: verdict});
  t.after(async () => { await bare.close(); });
  const held = request();
  await bare.submit(held);
  const out = await bare.wait({schema: 1, task_id: held.task_id}, {timeoutMs: 10_000});
  assert.equal(out.state, 'held');
  assert.equal(out.error, 'planner_unavailable');
  // An injected plan (fixtures) is still bound by the same admission law.
  const injected = await createRCCRuntime({stateDir: join(dir, 'injected'), catalog: async value => catalog(value),
    plan: async ({task: value}) => ({schema: 1, task_id: value.task_id, request_sha256: value.request_sha256,
      nodes: [{id: 'n', instruction: value.request, dependencies: [], kind: 'agent', scope: 'read_only',
        owned_paths: [], context_refs: []}]}),
    execute: async ticket => execution(ticket), verifyTask: verdict});
  t.after(async () => { await injected.close(); });
  const planned = request();
  await injected.submit(planned);
  const done = await injected.wait({schema: 1, task_id: planned.task_id}, {timeoutMs: 10_000});
  assert.equal(done.state, 'returned_unverified', done.error);
  assert.equal(done.children[0].id, 'n');
  assert.equal(done.children[0].selected_config.model, 'gpt-6-astra');
  await assert.rejects(createRCCRuntime({stateDir: join(dir, 'invalid'), hostAutoPlan: 'yes'}), /host_auto_plan_invalid/);
});

test('explicit routes produce one host node per route with that route\'s own text; a dropped or skipped route keeps the others\' ordinals', async t => {
  const dir = await fixture(t);
  const routes = [{surface: 'codex', instruction: 'Explain the interval rule.'},
    {surface: 'gpt-chat', instruction: 'Explain the merge rule.'},
    {surface: 'claude', instruction: 'Explain the split rule.'},
    {surface: 'claude-chat', instruction: 'What does co mean?'}];
  const request = task(dir, 'Codex한테 interval, GPT한테 merge, Claude Code한테 split, Claude한테 co.',
    {mode: 'explicit_routing_test', routes, bestEffort: true});
  // Claude's chat lane cannot run now: route-all skips it visibly.
  const runtime = await host(t, dir, {catalogFor: value => catalog(value,
    {rows: ROWS().filter(c => c.surface !== 'claude-chat')})});
  const done = await runtime.run(request);
  assert.equal(done.state, 'returned_unverified', done.error);
  assert.equal(runtime.planCalls(), 0);
  assert.deepEqual(runtime.tickets.map(ticket => [ticket.node_id, ticket.instruction, tuple(ticket)]).sort(),
    [['requested-1', 'Explain the interval rule.', 'codex:gpt-6-astra/ultra'],
      ['requested-3', 'Explain the split rule.', 'claude:claude-fable-5-1/max']]);
  assert.deepEqual(done.skipped_routes, [{surface: 'claude-chat', instruction: 'What does co mean?', reason: 'unavailable'}]);
  assert.deepEqual(done.children.map(child => child.requested_surface), ['codex', 'claude']);
  const plan = runtime.runtime._load(request.task_id).plan;
  assert.equal(Object.hasOwn(plan, 'final_node_id'), false, 'Core collects every route; no route owns the answer');
  assert.ok(plan.nodes.every(node => node.dependencies.length === 0 && node.kind === 'agent'));
  assert.equal(done.result.output, 'requested-1: answer for requested-1\n\nrequested-3: answer for requested-3');
  // Every route named GPT: held before any catalog probe or plan.
  const gptOnly = task(dir, 'GPT한테 1+1.', {mode: 'explicit_routing_test', routes: [routes[1]]});
  const dropped = await runtime.run(gptOnly);
  assert.equal(dropped.state, 'held');
  assert.equal(dropped.error, 'explicit_route_surface_dropped:gpt-chat');
  assert.equal(runtime.planCalls(), 0);
});

test('a repair re-resolves the host node and never re-plans: a pre-execution quota rejection moves to the other reference', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'What does the interval rule in this workspace mean?');
  const runtime = await host(t, dir, {execute: (ticket, count) => count === 1 ? execution(ticket, {status: 'failed',
    dispatch_stage: 'not_dispatched', output: null, execution_verified: false, task_quality: 'failed',
    error: 'provider_quota_rejected_before_execution'}) : execution(ticket)});
  const done = await runtime.run(request);
  assert.equal(done.state, 'returned_unverified', done.error);
  assert.equal(runtime.planCalls(), 0, 'the repair never asks a planner');
  assert.deepEqual(runtime.tickets.map(tuple), ['codex:gpt-6-astra/ultra', 'claude:claude-fable-5-1/max']);
  assert.deepEqual(runtime.tickets.map(ticket => [ticket.node_id, ticket.instruction]),
    [['node_0', request.request], ['node_0', request.request]], 'the same host node, the same owner words');
  assert.match(done.children[0].routing_decision.reason,
    /^re_resolved_after:provider_quota_rejected_before_execution;other_pool;route_reference;admitted_reference_uncertified;/);
  assert.equal(runtime.runtime.events({schema: 1, task_id: request.task_id})
    .some(event => event.kind === 'safe_subset_replanned'), false);
});
