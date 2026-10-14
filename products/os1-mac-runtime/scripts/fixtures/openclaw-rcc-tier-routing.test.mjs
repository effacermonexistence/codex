// Dynamic tier routing (build 378): the planner grades, the host binds the
// cheapest tier/effort for the grade, REVAS escalates a failed read-only
// answer once to the reference. Pure resolver checks plus real durable-runtime
// fixtures with a fake executor: no provider, model, network or HOME state.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRCCRuntime, hostContextFingerprint, MODEL_TIERS, resolveRoutePlan, routingAvailability,
  TIER_ROUTES } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-tier-fixture-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request, extras = {}) {
  const policyText = 'RCC tier fixture policy: candidates do not grant authority.';
  const host = {workspace: dir, context: null, provider_preference: 'auto',
    codex_session_id: extras.codexSession ?? null, claude_session_id: extras.claudeSession ?? null,
    require_read_only: extras.write !== true, owner_policy: null};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: extras.attempts ?? 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000},
    host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, pool, model, effort, options = {}) {
  const now = Date.now();
  const surface = options.surface ?? (pool === 'openai_codex' ? 'codex' : 'claude');
  const scope = options.scope ?? 'read_only';
  return {id, surface, transport: surface === 'codex' ? 'codex_app_server' : 'claude_cli',
    account_id: 'account-1', model, effort, tools: surface.endsWith('-chat') ? [] : ['read', 'execute'],
    scope, permission_profile: scope, quota_pool: pool,
    allowed_paths: scope === 'workspace_write' ? ['**'] : [], configuration_sha256: sha('config:' + id),
    availability: options.availability ?? 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: options.quota === undefined ? 0.7 : options.quota,
    quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
// The provider-stated tiers (Swift ModelTiers, observed 2026-10-14).
const TIERS = {'gpt-6-astra': 'frontier', 'gpt-6.1-sol': 'workhorse', 'gpt-6-luna': 'fast',
  'claude-fable-5-1': 'frontier', fable: 'frontier', 'claude-opus-5-5': 'workhorse', opus: 'workhorse',
  'claude-sonnet-5-5': 'efficient', sonnet: 'efficient'};
// The signed production profiles, in the order the native builder emits them:
// pool first, then the strongest tier first. gpt-6-sol (previous generation)
// and daybreak (specialized) have no tier.
const CODEX = [['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6.1-sol', ['low', 'medium', 'high', 'xhigh', 'max']], ['gpt-6-luna', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6-sol', ['low', 'medium', 'high', 'xhigh', 'max']], ['gpt-daybreak-blue-latest', ['low', 'max']]];
const CLAUDE = [['claude-fable-5-1', ['low', 'xhigh', 'max']], ['fable', ['low', 'xhigh', 'max']],
  ['claude-opus-5-5', ['low', 'xhigh', 'max']], ['opus', ['xhigh', 'max']],
  ['claude-sonnet-5-5', ['low', 'xhigh', 'max']], ['sonnet', ['medium']]];
const key = (model, effort, scope, surface) =>
  `${surface}-${model}-${effort}${scope === 'workspace_write' ? '-w' : ''}`.replace(/[^A-Za-z0-9_-]/g, '_');
function poolRows(pool, models, {write = false, chat = false, change = () => ({})} = {}) {
  const rows = [];
  for (const [model, efforts] of models) for (const effort of efforts)
    for (const scope of write ? ['read_only', 'workspace_write'] : ['read_only'])
      for (const surface of pool === 'anthropic_shared' && scope === 'read_only' && chat ? ['claude-chat', 'claude'] :
        [pool === 'openai_codex' ? 'codex' : 'claude']) {
        rows.push(row(key(model, effort, scope, surface), pool, model, effort,
          {surface, scope, ...change(model, effort, scope, surface)}));
      }
  return rows;
}
function tierCatalog(request, {first = 'codex', write = false, chat = false, codex = CODEX, claude = CLAUDE,
                               change, intent, tiers = TIERS} = {}) {
  const codexRows = poolRows('openai_codex', codex, {write, change});
  const claudeRows = poolRows('anthropic_shared', claude, {write, chat, change});
  const candidates = first === 'codex' ? [...codexRows, ...claudeRows] : [...claudeRows, ...codexRows];
  const models = new Set(candidates.map(c => c.model));
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, candidates,
    model_tiers: Object.fromEntries(Object.entries(tiers).filter(([model]) => models.has(model))),
    ...(intent ? {routing_intent: intent} : {})};
}
const graded = (id, routeClass, options = {}) => ({id, instruction: options.instruction ?? 'Do one bounded task',
  dependencies: [], kind: 'agent', ...(routeClass === undefined ? {} : {route_class: routeClass}),
  scope: options.scope ?? 'read_only', owned_paths: options.scope === 'workspace_write' ? ['**'] : [], context_refs: []});
const plan = (request, nodes) => ({schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, nodes});
function execution(ticket, overrides = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none',
    output: `answer from ${ticket.selected_config.model}/${ticket.selected_config.effort}`,
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: JSON.stringify({node: ticket.node_id}), ...overrides};
}
const taskVerdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
  parity_state: 'unverified', reason: 'fixture_deterministic_coverage'});
const wait = (runtime, request) => runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
const route = (decision) => `${decision.quota_pool}/${decision.model}/${decision.effort}`;
function resolve(request, catalog, routeClass, options = {}) {
  return resolveRoutePlan(plan(request, [graded('n', routeClass, options)]), request, catalog, Date.now());
}

// ---- Pure resolver --------------------------------------------------------

test('tier lists are the owner contract: ordered (tier, effort) per class, deep is the reference only', () => {
  assert.deepEqual(MODEL_TIERS, ['frontier', 'workhorse', 'efficient', 'fast']);
  assert.deepEqual(TIER_ROUTES, {
    trivial: [['fast', 'low'], ['efficient', 'low'], ['workhorse', 'low']],
    standard: [['workhorse', 'medium'], ['efficient', 'medium'], ['workhorse', 'high'], ['workhorse', 'xhigh'],
      ['frontier', 'reference']],
    deep: [['frontier', 'reference']]});
  assert.ok(Object.isFrozen(TIER_ROUTES) && Object.isFrozen(TIER_ROUTES.standard));
});

test('trivial, standard and deep bind the cheapest tier for the grade in the first pool that can serve it', () => {
  const request = task('/tmp', 'Answer one question');
  const codexFirst = tierCatalog(request), claudeFirst = tierCatalog(request, {first: 'claude'});
  // Trivial: fast/low (Codex luna); Claude has no routable fast model (no
  // Haiku profile), so its efficient sonnet runs at low.
  const trivial = resolve(request, codexFirst, 'trivial').decisions.n;
  assert.equal(route(trivial), 'openai_codex/gpt-6-luna/low');
  assert.equal(trivial.tier, 'fast');
  assert.equal(trivial.reason, 'resolver;route_tier;class_trivial;tier_list_0;tier_fast;pool_rank_0;effort_low;' +
    'escalation_reference_same_pool;agent_surface');
  assert.deepEqual(trivial.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'gpt-6-astra'});
  const claudeTrivial = resolve(request, claudeFirst, 'trivial').decisions.n;
  assert.equal(route(claudeTrivial), 'anthropic_shared/claude-sonnet-5-5/low');
  assert.equal(claudeTrivial.tier, 'efficient');
  assert.match(claudeTrivial.reason, /;tier_list_1;tier_efficient;/);
  assert.deepEqual(claudeTrivial.ladder, {cheap_effort: 'low', reference_effort: 'max',
    cheap_model: 'claude-sonnet-5-5', reference_model: 'claude-fable-5-1'});
  // Standard: workhorse/medium (Codex 6.1-sol); Claude opus has no medium
  // profile, so efficient sonnet/medium runs.
  const standard = resolve(request, codexFirst, 'standard').decisions.n;
  assert.equal(route(standard), 'openai_codex/gpt-6.1-sol/medium');
  assert.equal(standard.tier, 'workhorse');
  assert.match(standard.reason, /^resolver;route_tier;class_standard;tier_list_0;tier_workhorse;/);
  const claudeStandard = resolve(request, claudeFirst, 'standard').decisions.n;
  assert.equal(route(claudeStandard), 'anthropic_shared/sonnet/medium');
  assert.match(claudeStandard.reason, /;tier_list_1;tier_efficient;/);
  // Deep: the frontier reference at max, never the workhorse.
  const deep = resolve(request, codexFirst, 'deep');
  assert.equal(route(deep.decisions.n), 'openai_codex/gpt-6-astra/max');
  assert.equal(deep.decisions.n.tier, 'frontier');
  assert.equal(deep.decisions.n.reason, 'resolver;route_reference;class_deep;tier_list_0;tier_frontier;pool_rank_0;' +
    'effort_max;agent_surface');
  assert.equal(Object.hasOwn(deep.decisions.n, 'ladder'), false, 'the reference itself has nothing to escalate to');
  assert.deepEqual(deep.routes.n, {kind: 'reference', reference_effort: 'max', ladder: null});
  const claudeDeep = resolve(request, claudeFirst, 'deep').decisions.n;
  assert.equal(route(claudeDeep), 'anthropic_shared/claude-fable-5-1/max');
  for (const decision of [deep.decisions.n, claudeDeep])
    assert.ok(!['gpt-6.1-sol', 'claude-opus-5-5', 'opus'].includes(decision.model));
  // A model with no tier is never chosen by tier: gpt-6-sol and daybreak
  // never run, whatever the class.
  for (const routeClass of ['trivial', 'standard', 'deep'])
    assert.ok(!['gpt-6-sol', 'gpt-daybreak-blue-latest'].includes(resolve(request, codexFirst, routeClass).decisions.n.model));
});

test('deterministic resolution and a graded writer: trivial writes run standard and never carry an escalation', () => {
  const request = task('/tmp', 'Change one file', {write: true});
  const catalog = tierCatalog(request, {write: true});
  const proposed = plan(request, [graded('w', 'trivial', {scope: 'workspace_write'})]);
  const first = resolveRoutePlan(structuredClone(proposed), request, catalog, 1_000_000);
  assert.deepEqual(first, resolveRoutePlan(structuredClone(proposed), request, catalog, 1_000_000));
  const write = first.decisions.w;
  assert.equal(route(write), 'openai_codex/gpt-6.1-sol/medium');
  assert.equal(write.route_class, 'standard', 'the decision records the class it was routed at');
  assert.match(write.reason, /^resolver;route_tier;class_standard;write_promoted_from_trivial;tier_list_0;/);
  assert.equal(Object.hasOwn(write, 'ladder'), false);
  assert.deepEqual(first.routes.w, {kind: 'tier', reference_effort: 'max', ladder: null});
  assert.equal(first.plan.nodes[0].candidate_id, key('gpt-6.1-sol', 'medium', 'workspace_write', 'codex'));
});

test('a missing or invalid route_class routes as standard', () => {
  const request = task('/tmp', 'Answer one question');
  const catalog = tierCatalog(request);
  for (const value of [undefined, 'flagship', null, 7]) {
    const proposed = plan(request, [value === undefined ? graded('n') : {...graded('n', 'trivial'), route_class: value}]);
    const decision = resolveRoutePlan(proposed, request, catalog, Date.now()).decisions.n;
    assert.equal(route(decision), 'openai_codex/gpt-6.1-sol/medium', String(value));
    assert.equal(decision.route_class, 'standard');
    assert.match(decision.reason, /^resolver;route_tier;class_standard;route_class_defaulted;/);
  }
  // Older catalogs (no model_tiers) default too, then bind their reference.
  const legacy = {...catalog}; delete legacy.model_tiers;
  const decision = resolveRoutePlan(plan(request, [graded('n')]), request, legacy, Date.now()).decisions.n;
  assert.equal(decision.route_class, 'standard');
  assert.equal(route(decision), 'openai_codex/gpt-6-astra/max');
  assert.equal(decision.reason, 'resolver;route_reference;route_class_defaulted;pool_rank_0;effort_max;agent_surface');
  // A node with other unknown keys is still refused.
  assert.throws(() => resolveRoutePlan(plan(request, [{...graded('n'), guess: 1}]), request, catalog, Date.now()),
    /plan_node_invalid/);
});

test('an explicit effort keeps the class tier at the owner effort; an explicit family is the model; neither escalates', () => {
  const request = task('/tmp', '최대 리즈닝으로 해줘');
  // The native builder already kept only the max rows for "최대 리즈닝".
  const maxOnly = (model, effort) => effort === 'max';
  const filtered = (models, keep) => models.map(([model, efforts]) => [model, efforts.filter(e => keep(model, e))])
    .filter(([, efforts]) => efforts.length);
  const maxCatalog = tierCatalog(request, {codex: filtered(CODEX, maxOnly), claude: filtered(CLAUDE, maxOnly),
    intent: {effort: 'max', model_family: null}});
  const decide = (catalog, routeClass) => resolve(request, catalog, routeClass);
  // The rule (build 378): the owner's effort replaces the effort; the class
  // still picks the tier. So max on the class's own model, frontier for deep.
  assert.equal(route(decide(maxCatalog, 'trivial').decisions.n), 'openai_codex/gpt-6-luna/max');
  assert.equal(route(decide(maxCatalog, 'standard').decisions.n), 'openai_codex/gpt-6.1-sol/max');
  assert.equal(route(decide(maxCatalog, 'deep').decisions.n), 'openai_codex/gpt-6-astra/max');
  const explicit = decide(maxCatalog, 'standard');
  assert.match(explicit.decisions.n.reason, /^resolver;route_explicit;intent_effort_max;class_standard;tier_list_0;tier_workhorse;/);
  assert.equal(Object.hasOwn(explicit.decisions.n, 'ladder'), false);
  assert.deepEqual(explicit.routes.n, {kind: 'explicit', reference_effort: 'max', ladder: null});
  // An explicit family: rows are only that family; the class picks the effort.
  const opus = tierCatalog(request, {codex: [], claude: CLAUDE.filter(([model]) => ['claude-opus-5-5', 'opus'].includes(model)),
    intent: {effort: null, model_family: 'opus'}});
  assert.equal(route(decide(opus, 'trivial').decisions.n), 'anthropic_shared/claude-opus-5-5/low');
  assert.equal(decide(opus, 'standard').decisions.n.effort, 'xhigh');
  assert.equal(decide(opus, 'deep').decisions.n.effort, 'max');
  assert.match(decide(opus, 'trivial').decisions.n.reason, /^resolver;route_explicit;intent_family_opus;class_trivial;/);
  // A named family with no tier (daybreak) is usable only because the owner named it.
  const daybreak = tierCatalog(request, {claude: [], codex: CODEX.filter(([model]) => model === 'gpt-daybreak-blue-latest'),
    intent: {effort: null, model_family: 'daybreak'}});
  const named = decide(daybreak, 'deep').decisions.n;
  assert.equal(route(named), 'openai_codex/gpt-daybreak-blue-latest/max');
  assert.equal(named.tier, null);
  // Both an effort and a family: exactly that tuple.
  const exact = tierCatalog(request, {codex: [], claude: [['claude-opus-5-5', ['xhigh']], ['opus', ['xhigh']]],
    intent: {effort: 'xhigh', model_family: 'opus'}});
  assert.equal(decide(exact, 'trivial').decisions.n.effort, 'xhigh');
});

test('a pool that cannot serve the class is skipped; inside a pool the first dispatchable entry wins', () => {
  const request = task('/tmp', 'Answer one question');
  // Codex offers only its frontier model: no trivial entry there, so Claude serves it.
  const astraOnly = tierCatalog(request, {codex: CODEX.filter(([model]) => model === 'gpt-6-astra')});
  const skipped = resolve(request, astraOnly, 'trivial').decisions.n;
  assert.equal(route(skipped), 'anthropic_shared/claude-sonnet-5-5/low');
  assert.match(skipped.reason, /;pool_rank_1;skipped_pool_rank_0_trivial_unavailable;effort_low;/);
  // Inside Codex an exhausted luna falls to the next entry of the same pool
  // (workhorse/low), not to the other pool.
  const lunaOut = tierCatalog(request, {change: model => model === 'gpt-6-luna' ? {quota: 0} : {}});
  const next = resolve(request, lunaOut, 'trivial').decisions.n;
  assert.equal(route(next), 'openai_codex/gpt-6.1-sol/low');
  assert.match(next.reason, /;tier_list_2;tier_workhorse;pool_rank_0;/);
  // Deep with no dispatchable Codex frontier: the Claude reference, never sol.
  const astraOut = tierCatalog(request, {change: model => model === 'gpt-6-astra' ? {availability: 'unavailable'} : {}});
  const deep = resolve(request, astraOut, 'deep').decisions.n;
  assert.equal(route(deep), 'anthropic_shared/claude-fable-5-1/max');
  assert.match(deep.reason, /;pool_rank_1;skipped_pool_rank_0_reference_undispatchable;/);
  // Deep with no frontier model in Codex at all: reference_unavailable there.
  const noAstra = tierCatalog(request, {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')});
  assert.match(resolve(request, noAstra, 'deep').decisions.n.reason, /;skipped_pool_rank_0_reference_unavailable;/);
  // A trivial node whose own pool has no frontier escalates to the other pool's.
  assert.deepEqual(resolve(request, noAstra, 'trivial').decisions.n.ladder, {cheap_effort: 'low',
    reference_effort: 'max', cheap_model: 'gpt-6-luna', reference_model: 'claude-fable-5-1'});
  assert.match(resolve(request, noAstra, 'trivial').decisions.n.reason, /;escalation_reference_other_pool;/);
});

test('deep work holds as reference_unavailable when no pool offers a frontier model; untiered models never run by tier', () => {
  const request = task('/tmp', 'Prove one hard property');
  const noFrontier = tierCatalog(request, {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra'),
    claude: CLAUDE.filter(([model]) => !['claude-fable-5-1', 'fable'].includes(model))});
  assert.throws(() => resolve(request, noFrontier, 'deep'), /no_dispatchable_candidate:read_only:reference_unavailable/);
  // Trivial and standard still run: lower tiers are not withheld.
  assert.equal(route(resolve(request, noFrontier, 'standard').decisions.n), 'openai_codex/gpt-6.1-sol/medium');
  assert.equal(Object.hasOwn(resolve(request, noFrontier, 'trivial').decisions.n, 'ladder'), false,
    'no reference anywhere: nothing to escalate to');
  // Only untiered models: nothing can run by tier; availability says so.
  const untiered = tierCatalog(request, {claude: [], codex: CODEX.filter(([model]) =>
    ['gpt-6-sol', 'gpt-daybreak-blue-latest'].includes(model))});
  assert.deepEqual(untiered.model_tiers, {});
  assert.throws(() => resolve(request, untiered, 'trivial'), /no_dispatchable_candidate:read_only:trivial/);
  assert.deepEqual(routingAvailability(request, untiered).scopes, []);
  assert.deepEqual(routingAvailability(request, tierCatalog(request)).providers, ['claude', 'codex']);
});

test('read-only work takes the chat row of the same model and effort, and escalates to the chat reference', () => {
  const request = task('/tmp', 'Answer briefly');
  const catalog = tierCatalog(request, {first: 'claude', chat: true});
  const resolved = resolve(request, catalog, 'trivial');
  assert.equal(resolved.decisions.n.surface, 'claude-chat');
  assert.equal(route(resolved.decisions.n), 'anthropic_shared/claude-sonnet-5-5/low');
  assert.match(resolved.decisions.n.reason, /;chat_lane_same_route$/);
  assert.equal(resolved.routes.n.ladder.reference_candidate_id, key('claude-fable-5-1', 'max', 'read_only', 'claude-chat'));
});

// ---- Durable runtime: REVAS escalation --------------------------------------

async function run(t, dir, name, {routeClass = 'trivial', execute, extras = {}, catalog = {}, verifierRegistry,
                                  refresh = null} = {}) {
  const request = task(dir, 'Answer one question: ' + name, extras);
  const tickets = [];
  let refreshes = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, name.replace(/\W+/g, '-')),
    ...(verifierRegistry ? {verifierRegistry} : {}),
    catalog: async value => { refreshes++; return refresh ? refresh(value, refreshes) : tierCatalog(value, catalog); },
    plan: async () => plan(request, [graded('n', routeClass, extras.write ? {scope: 'workspace_write'} : {})]),
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  return {request, runtime, tickets, done,
    tuples: tickets.map(ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`)};
}
const ledger = async (dir, name) => (await readFile(join(dir, name.replace(/\W+/g, '-'), 'routing-ledger',
  'routing-ledger.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

test('a cheap read-only answer that passes is adopted; nothing escalates', async t => {
  const dir = await fixture(t);
  const ok = await run(t, dir, 'adopted', {execute: ticket => execution(ticket)});
  assert.equal(ok.done.state, 'completed', ok.done.error);
  assert.deepEqual(ok.tuples, ['gpt-6-luna/low']);
  assert.equal(ok.done.result.output, 'answer from gpt-6-luna/low');
  const records = await ledger(dir, 'adopted');
  assert.deepEqual(records.map(record => [record.tier, record.effort, record.route_kind, record.escalated]),
    [['fast', 'low', 'tier', false]]);
  assert.deepEqual(records[0].ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'gpt-6-astra'});
});

test('every failure signal escalates a read-only tier answer exactly once to the reference, uncharged', async t => {
  const dir = await fixture(t);
  const signals = [
    ['failed after dispatch, no effects', {status: 'failed', execution_verified: false, task_quality: 'failed',
      output: null, error: 'native_outcome_uncertain_preserved'}],
    ['execution not verified', {execution_verified: false, task_quality: 'unverified'}],
    ['empty output', {output: ''}],
    ['whitespace output', {output: ' \n\t '}],
    ['failed task quality', {task_quality: 'failed'}],
    // What os1 rcc-execute records beside a finished read-only answer whose
    // own tool calls failed (RCCNativeAttemptOutcome.toolFailureError).
    ['native tool failure recorded by the adapter', {error: 'native_tool_failed'}],
    ['recorded failure beside a finished attempt', {error: 'source_scope_breach_preserved_no_stage'}]];
  for (const [name, failure] of signals) {
    const result = await run(t, dir, name, {extras: {attempts: 1},
      execute: (ticket, count) => count === 1 ? execution(ticket, failure) : execution(ticket)});
    assert.equal(result.done.state, 'completed', `${name}: ${result.done.error}`);
    assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max'], name);
    assert.equal(result.done.result.output, 'answer from gpt-6-astra/max', `${name}: the failed output is never adopted`);
    const decision = result.done.children[0].routing_decision;
    assert.equal(route(decision), 'openai_codex/gpt-6-astra/max', name);
    assert.equal(decision.tier, 'frontier', name);
    assert.match(decision.reason, /^tier_escalated_after_failure_signal;route_reference;tier_frontier;same_pool;effort_max;/, name);
    assert.deepEqual(decision.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
      reference_model: 'gpt-6-astra'}, name);
    assert.equal(result.runtime.events({schema: 1, task_id: result.request.task_id})
      .filter(event => event.kind === 'ladder_escalated_to_reference').length, 1, name);
  }
  const records = await ledger(dir, signals[0][0]);
  assert.deepEqual(records.map(record => [record.model, record.tier, record.route_kind, record.escalated,
    record.attempt_state]), [['gpt-6-luna', 'fast', 'tier', false, 'ladder_not_returned'],
    ['gpt-6-astra', 'frontier', 'reference', true, 'completed']]);
});

test('a registered verifier failing escalates once; a failing reference is never escalated again', async t => {
  const dir = await fixture(t);
  const verifierRegistry = new Map([['trivial:read_only:agent', async input =>
    ({passed: input.selected_config.model === 'gpt-6-astra', reason: 'fake'})]]);
  const verified = await run(t, dir, 'verifier', {verifierRegistry, execute: ticket => execution(ticket)});
  assert.equal(verified.done.state, 'completed', verified.done.error);
  assert.deepEqual(verified.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.match(verified.done.children[0].routing_decision.reason, /^tier_escalated_after_verifier_failure;/);
  // Never twice: the reference fails too and is held, not escalated again.
  const twice = await run(t, dir, 'twice', {extras: {attempts: 1},
    execute: ticket => execution(ticket, {execution_verified: false, task_quality: 'unverified'})});
  assert.deepEqual(twice.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.notEqual(twice.done.state, 'completed');
  assert.equal(twice.runtime.events({schema: 1, task_id: twice.request.task_id})
    .filter(event => event.kind === 'ladder_escalated_to_reference').length, 1);
});

test('a write is never escalated: its failure keeps the existing no-replay semantics', async t => {
  const dir = await fixture(t);
  const write = await run(t, dir, 'write', {extras: {write: true}, catalog: {write: true},
    execute: ticket => execution(ticket, {status: 'failed', execution_verified: false, task_quality: 'failed',
      output: null, side_effects: 'possible', error: 'native_outcome_uncertain_preserved'})});
  assert.deepEqual(write.tuples, ['gpt-6.1-sol/medium'], 'trivial write runs standard and once');
  assert.equal(write.done.state, 'effects_uncertain');
  assert.equal(write.runtime.events({schema: 1, task_id: write.request.task_id})
    .some(event => event.kind === 'ladder_escalated_to_reference'), false);
  // An empty answer from a writer is held, not escalated either.
  const empty = await run(t, dir, 'write empty', {extras: {write: true}, catalog: {write: true},
    execute: ticket => execution(ticket, {output: '', side_effects: 'confirmed'})});
  assert.deepEqual(empty.tuples, ['gpt-6.1-sol/medium']);
  assert.ok(['held', 'returned_unverified'].includes(empty.done.state), empty.done.state);
  assert.equal(empty.runtime.events({schema: 1, task_id: empty.request.task_id})
    .some(event => event.kind === 'ladder_escalated_to_reference'), false);
});

test('a discardable cheap attempt never runs in the owner thread; the escalated reference resumes that thread untouched', async t => {
  const dir = await fixture(t);
  // The cheaper answer may be discarded: it runs in a fresh native session,
  // so the owner's thread never ends with a failed turn, and the reference
  // that is delivered continues the owner's thread (not a failed turn).
  const result = await run(t, dir, 'session', {extras: {codexSession: 'owner-codex-thread'},
    execute: (ticket, count) => count === 1 ? execution(ticket, {output: ''}) : execution(ticket)});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tickets.map(ticket => [ticket.selected_config.model, ticket.native_resume_session_id]),
    [['gpt-6-luna', null], ['gpt-6-astra', 'owner-codex-thread']]);
  // An escalation to the other pool resumes the owner's thread of THAT provider.
  const other = await run(t, dir, 'session other pool', {extras: {codexSession: 'owner-codex-thread',
    claudeSession: 'owner-claude-thread'},
    refresh: (value, count) => tierCatalog(value, {change: model => count >= 2 && model === 'gpt-6-astra' ? {quota: 0} : {}}),
    execute: (ticket, count) => count === 1 ? execution(ticket, {output: ''}) : execution(ticket)});
  assert.equal(other.done.state, 'completed', other.done.error);
  assert.deepEqual(other.tickets.map(ticket => [ticket.selected_config.model, ticket.native_resume_session_id]),
    [['gpt-6-luna', null], ['claude-fable-5-1', 'owner-claude-thread']]);
  // A passing cheap answer is delivered from its fresh session; the
  // reference, an explicit route and a write (never escalated) keep resuming.
  const passed = await run(t, dir, 'session pass', {extras: {codexSession: 'owner-codex-thread'},
    execute: ticket => execution(ticket)});
  assert.deepEqual(passed.tickets.map(ticket => ticket.native_resume_session_id), [null]);
  const deep = await run(t, dir, 'session deep', {routeClass: 'deep', extras: {codexSession: 'owner-codex-thread'},
    execute: ticket => execution(ticket)});
  assert.deepEqual(deep.tickets.map(ticket => ticket.native_resume_session_id), ['owner-codex-thread']);
  const write = await run(t, dir, 'session write', {extras: {write: true, codexSession: 'owner-codex-thread'},
    catalog: {write: true}, execute: ticket => execution(ticket, {side_effects: 'confirmed'})});
  assert.deepEqual(write.tickets.map(ticket => ticket.native_resume_session_id), ['owner-codex-thread']);
});

test("when this pool's reference cannot dispatch, the escalation runs the other pool's reference", async t => {
  const dir = await fixture(t);
  // Codex astra is exhausted by the refresh before the cheap dispatch (the
  // plan bound astra as the escalation target): the escalation itself moves.
  const result = await run(t, dir, 'other pool', {
    refresh: (value, count) => tierCatalog(value, {change: model => count >= 2 && model === 'gpt-6-astra' ? {quota: 0} : {}}),
    execute: (ticket, count) => count === 1 ? execution(ticket, {output: ''}) : execution(ticket)});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'claude-fable-5-1/max']);
  const decision = result.done.children[0].routing_decision;
  assert.equal(decision.quota_pool, 'anthropic_shared');
  assert.deepEqual(decision.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'claude-fable-5-1'});
  assert.match(decision.reason, /^tier_escalated_after_failure_signal;route_reference;tier_frontier;other_pool;effort_max;/);
  assert.equal(result.runtime.events({schema: 1, task_id: result.request.task_id})
    .some(event => event.kind === 'candidate_re_resolved'), false);
});

test('an escalated node whose reference vanished re-resolves to a reference only, never a lower tier', async t => {
  const dir = await fixture(t);
  // The refresh before the escalated dispatch drops every Codex frontier row.
  let escalated = false;
  const result = await run(t, dir, 'vanished reference', {
    refresh: value => tierCatalog(value, escalated ? {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')} : {}),
    execute: (ticket, count) => { if (count === 1) { escalated = true; return execution(ticket, {output: ''}); }
      return execution(ticket); }});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'claude-fable-5-1/max']);
  const decision = result.done.children[0].routing_decision;
  assert.match(decision.reason, /^re_resolved_after:candidate_missing;other_pool;route_reference;class_deep;/);
  assert.equal(decision.tier, 'frontier');
  assert.deepEqual(decision.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'claude-fable-5-1'});
});

test('a pre-execution quota rejection re-resolves a tier node at its own class in the other pool', async t => {
  const dir = await fixture(t);
  const result = await run(t, dir, 'quota rejected', {
    execute: (ticket, count) => count === 1 ? execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
      output: "You've hit your weekly limit", execution_verified: false, task_quality: 'failed',
      error: 'provider_quota_rejected_before_execution'}) : execution(ticket)});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'claude-sonnet-5-5/low']);
  const child = result.done.children[0];
  assert.match(child.routing_decision.reason, /^re_resolved_after:provider_quota_rejected_before_execution;other_pool;route_tier;/);
  assert.equal(child.routing_decision.ladder.reference_model, 'claude-fable-5-1');
});

test('deep work with no frontier model holds before any dispatch; model_tiers is strictly shaped', async t => {
  const dir = await fixture(t);
  const noFrontier = {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra'),
    claude: CLAUDE.filter(([model]) => !['claude-fable-5-1', 'fable'].includes(model))};
  const held = await run(t, dir, 'deep held', {routeClass: 'deep', catalog: noFrontier,
    execute: () => { throw Error('must not dispatch'); }});
  assert.equal(held.done.state, 'held');
  assert.equal(held.done.error, 'no_dispatchable_candidate:read_only:reference_unavailable');
  assert.equal(held.tickets.length, 0);
  for (const [name, tiers] of [['unknown tier', {'gpt-6-luna': 'flagship'}], ['absent model', {'gpt-9': 'fast'}],
    ['not an object', ['fast']]]) {
    const bad = await run(t, dir, name, {refresh: value => ({...tierCatalog(value), model_tiers: tiers}),
      execute: () => { throw Error('must not dispatch'); }});
    assert.equal(bad.done.state, 'held', name); assert.equal(bad.done.error, 'catalog_binding_invalid', name);
  }
  // Nothing tiered: held before planning with the per-pool reason.
  const untiered = await run(t, dir, 'untiered', {catalog: {claude: [],
    codex: CODEX.filter(([model]) => model === 'gpt-6-sol')}, execute: () => { throw Error('must not dispatch'); }});
  assert.equal(untiered.done.error, 'no_dispatchable_candidate:openai_codex=no_tiered_model');
});

// ---- Review round: guards, budgets, availability and upward fallback ---------

test('no frontier reference in any pool: a cheap read-only answer is still guarded and a failure signal holds it', async t => {
  const dir = await fixture(t);
  // gpt-6-astra exhausted (the builder dropped its rows) and no Claude pool.
  const codexOnly = {claude: [], codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')};
  const request = task('/tmp', 'Answer one question');
  const resolved = resolve(request, tierCatalog(request, codexOnly), 'trivial');
  assert.equal(route(resolved.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.match(resolved.decisions.n.reason, /;escalation_reference_unavailable;agent_surface$/);
  assert.equal(Object.hasOwn(resolved.decisions.n, 'ladder'), false, 'no target, so the public decision has no ladder');
  assert.deepEqual(resolved.routes.n.ladder, {source: 'tier', cheap_model: 'gpt-6-luna', cheap_effort: 'low',
    reference_model: null, reference_effort: null, reference_candidate_id: null});
  const failures = [['whitespace answer', {output: '  \n '}],
    ['failed after dispatch, no effects', {status: 'failed', dispatch_stage: 'dispatched', side_effects: 'none',
      execution_verified: false, task_quality: 'failed', output: null, error: 'native_outcome_uncertain_preserved'}],
    ['native tool failure', {error: 'native_tool_failed'}]];
  for (const [name, failure] of failures) {
    const held = await run(t, dir, 'no frontier ' + name, {catalog: codexOnly, execute: ticket => execution(ticket, failure)});
    assert.deepEqual(held.tuples, ['gpt-6-luna/low'], name);
    assert.equal(held.done.state, 'held', `${name}: never adopted, never effects_uncertain`);
    assert.equal(held.done.error, 'ladder_reference_unavailable', name);
    assert.equal(held.done.result, null, name);
    assert.equal(held.done.children[0].output_summary, null, `${name}: the cheaper output is never shown`);
  }
  // A passing cheap answer is adopted as before.
  const ok = await run(t, dir, 'no frontier pass', {catalog: codexOnly, execute: ticket => execution(ticket)});
  assert.equal(ok.done.state, 'completed', ok.done.error);
  assert.equal(ok.done.result.output, 'answer from gpt-6-luna/low');
  // When a frontier row is back by the time the cheap attempt fails, the
  // guard escalates to it (re-resolved at that time).
  const back = await run(t, dir, 'no frontier then back', {
    refresh: (value, count) => tierCatalog(value, count >= 2 ? {claude: []} : codexOnly),
    execute: (ticket, count) => count === 1 ? execution(ticket, {output: ' '}) : execution(ticket)});
  assert.equal(back.done.state, 'completed', back.done.error);
  assert.deepEqual(back.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
});

test('parallel escalations exempt the UNION of their cheap attempts: a dependent node still meets the duration budget', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Two short answers, then a summary');
  request.budget.max_duration_ms = 1_000;
  const tickets = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const cheap = new Set(['gpt-6-luna', 'claude-sonnet-5-5']);
  const runtime = await createRCCRuntime({stateDir: join(dir, 'union'),
    catalog: async value => tierCatalog(value),
    plan: async () => plan(request, [graded('a', 'trivial'), graded('b', 'trivial'),
      {...graded('d', 'trivial'), dependencies: ['a', 'b']}]),
    execute: async ticket => {
      tickets.push(ticket);
      if (ticket.node_id === 'd') return execution(ticket);
      // Both cheap attempts run at the same time in different pools (b is
      // spread to Claude) and fail; both escalations then run in parallel.
      if (cheap.has(ticket.selected_config.model)) { await sleep(800); return execution(ticket, {output: ' '}); }
      await sleep(1_300); return execution(ticket);
    },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  const byNode = node => tickets.filter(ticket => ticket.node_id === node)
    .map(ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`);
  assert.deepEqual(byNode('a'), ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.deepEqual(byNode('b'), ['claude-sonnet-5-5/low', 'claude-fable-5-1/max']);
  // ~800 ms of overlapping cheap time is exempt once (not ~1600 ms), so by
  // the time both escalations finish the real budget is spent.
  assert.deepEqual(byNode('d'), [], 'the dependent node must not dispatch on double-counted exempt time');
  assert.equal(done.state, 'held');
  assert.equal(done.error, 'task_duration_budget_exhausted');
});

test('a reference or explicit answer with a recorded tool failure is delivered unchanged (only a cheaper tier escalates)', async t => {
  const dir = await fixture(t);
  const deep = await run(t, dir, 'deep tool failed', {routeClass: 'deep',
    execute: ticket => execution(ticket, {error: 'native_tool_failed'})});
  assert.equal(deep.done.state, 'completed', deep.done.error);
  assert.deepEqual(deep.tuples, ['gpt-6-astra/max']);
  assert.equal(deep.done.result.output, 'answer from gpt-6-astra/max');
});

test('availability counts only rows some reachable class can bind: a fast-tier writer is never offered', () => {
  const request = task('/tmp', 'Change one file', {write: true});
  // Only gpt-6-luna remains (astra and 6.1-sol quota_zero, dropped by the builder).
  const lunaOnly = tierCatalog(request, {write: true, claude: [], codex: CODEX.filter(([model]) => model === 'gpt-6-luna')});
  assert.deepEqual(routingAvailability(request, lunaOnly).scopes, ['read_only'],
    'a writer is at least standard and no standard/deep entry is fast');
  assert.throws(() => resolve(request, lunaOnly, 'trivial', {scope: 'workspace_write'}),
    /no_dispatchable_candidate:workspace_write:standard/);
  // Read-only work still runs there (trivial binds the fast tier).
  assert.equal(route(resolve(request, lunaOnly, 'trivial').decisions.n), 'openai_codex/gpt-6-luna/low');
  // The full production catalog still offers both scopes.
  assert.deepEqual(routingAvailability(request, tierCatalog(request, {write: true})).scopes, ['read_only', 'workspace_write']);
  // Under an explicit effort word the same mapping applies (writer at max
  // binds standard's tiers at max, never the fast tier).
  const intentLuna = tierCatalog(request, {write: true, claude: [], codex: [['gpt-6-luna', ['max']]],
    intent: {effort: 'max', model_family: null}});
  assert.deepEqual(routingAvailability(request, intentLuna).scopes, ['read_only']);
});

test('a task whose only runnable rows no class can bind is held before planning, with the per-pool cause', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Change one file', {write: true});
  let planned = 0;
  // Writer rows of the fast tier only: nothing read-only, nothing a writer binds.
  const runtime = await createRCCRuntime({stateDir: join(dir, 'fast-writer'),
    catalog: async value => {
      const catalog = tierCatalog(value, {write: true, claude: [], codex: CODEX.filter(([model]) => model === 'gpt-6-luna')});
      return {...catalog, candidates: catalog.candidates.filter(c => c.scope === 'workspace_write')};
    },
    plan: async () => { planned++; return plan(request, [graded('w', 'trivial', {scope: 'workspace_write'})]); },
    execute: async () => { throw Error('must not dispatch'); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'held');
  assert.equal(done.error, 'no_dispatchable_candidate:openai_codex=no_bindable_tier');
  assert.equal(planned, 0, 'no wasted planner call');
});

test('trivial work falls back upwards when no pool offers a trivial entry: the stronger tier runs, never a hold', () => {
  const request = task('/tmp', 'what is 1+1');
  // Sonnet and Opus on quota_backoff: only the Claude frontier rows remain.
  const fableOnly = tierCatalog(request, {first: 'claude', chat: true, codex: [],
    claude: CLAUDE.filter(([model]) => ['claude-fable-5-1', 'fable'].includes(model))});
  assert.deepEqual(routingAvailability(request, fableOnly).scopes, ['read_only']);
  const trivial = resolve(request, fableOnly, 'trivial');
  assert.equal(route(trivial.decisions.n), 'anthropic_shared/claude-fable-5-1/max');
  assert.equal(trivial.decisions.n.surface, 'claude-chat');
  assert.equal(trivial.decisions.n.route_class, 'trivial', 'the grade is kept; the fallback is in the reason');
  assert.equal(trivial.decisions.n.reason, 'resolver;route_reference;class_trivial;class_fallback_trivial_to_standard;' +
    'tier_list_4;tier_frontier;pool_rank_0;effort_max;chat_lane_same_route');
  assert.equal(Object.hasOwn(trivial.decisions.n, 'ladder'), false, 'the reference itself never escalates');
  assert.deepEqual(trivial.routes.n, {kind: 'reference', reference_effort: 'max', ladder: null});
  // Codex with only its frontier model: the same.
  const astraOnly = tierCatalog(request, {claude: [], codex: CODEX.filter(([model]) => model === 'gpt-6-astra')});
  assert.equal(route(resolve(request, astraOnly, 'trivial').decisions.n), 'openai_codex/gpt-6-astra/max');
  // A fallback that lands below the reference keeps its escalation guard.
  const solMedium = tierCatalog(request, {claude: [], codex: [['gpt-6-astra', ['max']], ['gpt-6.1-sol', ['medium']]]});
  const lower = resolve(request, solMedium, 'trivial').decisions.n;
  assert.equal(route(lower), 'openai_codex/gpt-6.1-sol/medium');
  assert.match(lower.reason, /^resolver;route_tier;class_trivial;class_fallback_trivial_to_standard;tier_list_0;tier_workhorse;/);
  assert.deepEqual(lower.ladder, {cheap_effort: 'medium', reference_effort: 'max', cheap_model: 'gpt-6.1-sol',
    reference_model: 'gpt-6-astra'});
  // A trivial entry in ANY pool wins over the fallback in the first pool.
  const mixed = tierCatalog(request, {codex: CODEX.filter(([model]) => model === 'gpt-6-astra')});
  assert.equal(route(resolve(request, mixed, 'trivial').decisions.n), 'anthropic_shared/claude-sonnet-5-5/low');
  // Deep is never relaxed and nothing falls back downwards.
  const noFrontier = tierCatalog(request, {claude: [], codex: CODEX.filter(([model]) => model === 'gpt-6-luna')});
  assert.throws(() => resolve(request, noFrontier, 'deep'), /no_dispatchable_candidate:read_only:reference_unavailable/);
  assert.throws(() => resolve(request, noFrontier, 'standard'), /no_dispatchable_candidate:read_only:standard/);
});

test('a trivial question on a frontier-only pool completes on the frontier model', async t => {
  const dir = await fixture(t);
  const fableOnly = {first: 'claude', codex: [], claude: CLAUDE.filter(([model]) => ['claude-fable-5-1', 'fable'].includes(model))};
  const result = await run(t, dir, 'frontier only trivial', {catalog: fableOnly, execute: ticket => execution(ticket)});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['claude-fable-5-1/max']);
  assert.match(result.done.children[0].routing_decision.reason, /;class_fallback_trivial_to_standard;/);
});
