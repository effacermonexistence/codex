// Dynamic tier routing (build 378): the planner grades, the host binds the
// cheapest tier/effort for the grade, REVAS escalates a failed read-only
// answer once to the reference. Pure resolver checks plus real durable-runtime
// fixtures with a fake executor: no provider, model, network or HOME state.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { COST_GATE_CONFIDENCE, COST_GATE_DRAWS, COST_GATE_MIN_SAMPLES, costGateExploreDraw, costGateRandom,
  costGateRecord, costSummary,
  createRCCRuntime, hostContextFingerprint, MODEL_TIERS, openRoutingLedger, resolveRoutePlan, routingAvailability,
  sampleBeta, sampleGamma, TIER_ROUTES, tierCostEvidence, tierCostGate } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

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
  // A fixed task id (extras.taskID) makes a cost-gate exploration draw,
  // which is seeded per task and node, reproducible in a fixture.
  return {schema: 1, task_id: extras.taskID ?? 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
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

test('an explicit effort keeps the class tier at the owner effort; an explicit family is the model; a host-chosen dimension below the owner reference is guarded', () => {
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
  // The owner fixed only the effort: the MODEL (luna, sol) is the host's
  // choice, below the reference the owner's words leave (the frontier at
  // max). It is a tier route guarded by that reference, not an explicit one.
  const effortOnly = decide(maxCatalog, 'standard');
  assert.match(effortOnly.decisions.n.reason, /^resolver;route_tier;intent_effort_max;class_standard;tier_list_0;tier_workhorse;/);
  assert.deepEqual(effortOnly.decisions.n.ladder, {cheap_effort: 'max', reference_effort: 'max',
    cheap_model: 'gpt-6.1-sol', reference_model: 'gpt-6-astra'});
  assert.equal(effortOnly.routes.n.kind, 'tier');
  assert.equal(effortOnly.routes.n.ladder.reference_candidate_id, 'codex-gpt-6-astra-max');
  const trivialMax = decide(maxCatalog, 'trivial');
  assert.equal(trivialMax.routes.n.kind, 'tier');
  assert.equal(trivialMax.routes.n.ladder.reference_model, 'gpt-6-astra');
  // The owner's effort on the frontier IS the owner's reference: explicit.
  const deepMax = decide(maxCatalog, 'deep');
  assert.match(deepMax.decisions.n.reason, /^resolver;route_explicit;intent_effort_max;class_deep;/);
  assert.deepEqual(deepMax.routes.n, {kind: 'explicit', reference_effort: 'max', ladder: null});
  // An explicit family: rows are only that family; the class picks the effort
  // (the host's choice), guarded by the family at its highest effort up to max.
  const opus = tierCatalog(request, {codex: [], claude: CLAUDE.filter(([model]) => ['claude-opus-5-5', 'opus'].includes(model)),
    intent: {effort: null, model_family: 'opus'}});
  const opusTrivial = decide(opus, 'trivial');
  assert.equal(route(opusTrivial.decisions.n), 'anthropic_shared/claude-opus-5-5/low');
  assert.match(opusTrivial.decisions.n.reason, /^resolver;route_tier;intent_family_opus;class_trivial;/);
  assert.equal(opusTrivial.routes.n.kind, 'tier');
  assert.equal(opusTrivial.routes.n.ladder.reference_effort, 'max');
  assert.ok(['opus', 'claude-opus-5-5'].includes(opusTrivial.routes.n.ladder.reference_model));
  assert.equal(decide(opus, 'standard').decisions.n.effort, 'xhigh');
  assert.equal(decide(opus, 'standard').routes.n.kind, 'tier');
  const opusDeep = decide(opus, 'deep');
  assert.equal(opusDeep.decisions.n.effort, 'max');
  assert.equal(opusDeep.routes.n.kind, 'explicit', 'the named family at its reference effort is the owner route');
  // A named family with no tier (daybreak) is usable only because the owner named it.
  const daybreak = tierCatalog(request, {claude: [], codex: CODEX.filter(([model]) => model === 'gpt-daybreak-blue-latest'),
    intent: {effort: null, model_family: 'daybreak'}});
  const named = decide(daybreak, 'deep').decisions.n;
  assert.equal(route(named), 'openai_codex/gpt-daybreak-blue-latest/max');
  assert.equal(named.tier, null);
  // Both an effort and a family: exactly that tuple, explicit, never escalated.
  const exact = tierCatalog(request, {codex: [], claude: [['claude-opus-5-5', ['xhigh']], ['opus', ['xhigh']]],
    intent: {effort: 'xhigh', model_family: 'opus'}});
  assert.equal(decide(exact, 'trivial').decisions.n.effort, 'xhigh');
  assert.deepEqual(decide(exact, 'trivial').routes.n, {kind: 'explicit', reference_effort: 'xhigh', ladder: null});
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

// ---- Review round 2: explicit fan-outs, owner words, stale guards, ledger, quota -

// The owner's own fan-out test: "1+1 Codex chat한테. 3+3 Claude Code한테.
// 4+4 Claude한테." (RouteFanout: Codex chat -> codex, Claude Code -> claude,
// Claude -> claude-chat). The planner only grades each named route; the host
// binds model AND effort by that grade, on that route's own surface.
const FANOUT = [{surface: 'codex', instruction: '1+1'}, {surface: 'claude', instruction: '3+3'},
  {surface: 'claude-chat', instruction: '4+4'}];
function explicitTask(dir, routes, extras = {}) {
  const request = task(dir, '1+1 Codex chat한테. 3+3 Claude Code한테. 4+4 Claude한테.', extras);
  request.mode = 'explicit_routing_test';
  request.host_context = {...request.host_context, explicit_routes: routes};
  request.source_fingerprint = hostContextFingerprint(request.host_context);
  return request;
}
// The production profiles plus the above-max efforts an explicit route test
// keeps in its catalog (the builder withholds nothing there).
const WITH_ULTRA = CODEX.map(([model, efforts]) => [model,
  ['gpt-6-astra', 'gpt-6.1-sol'].includes(model) ? [...efforts, 'ultra'] : efforts]);
const routeNode = (index, routeClass, routes = FANOUT, extras = {}) => ({id: `requested-${index + 1}`,
  instruction: routes[index].instruction, dependencies: [], kind: 'agent', route_class: routeClass,
  scope: 'read_only', owned_paths: [], context_refs: [], ...extras});

test('an explicit fan-out binds model and effort by grade on each named surface: "1+1" never runs on astra, fable, opus or max', async t => {
  const dir = await fixture(t);
  const request = explicitTask(dir, FANOUT);
  const catalog = tierCatalog(request, {codex: WITH_ULTRA, chat: true});
  // Pure: every route trivial.
  const resolved = resolveRoutePlan(plan(request, FANOUT.map((_, index) => routeNode(index, 'trivial'))), request,
    catalog, Date.now());
  assert.deepEqual(Object.values(resolved.decisions).map(d => `${d.surface}:${d.model}/${d.effort}`),
    ['codex:gpt-6-luna/low', 'claude:claude-sonnet-5-5/low', 'claude-chat:claude-sonnet-5-5/low']);
  assert.match(resolved.decisions['requested-1'].reason,
    /^resolver;route_tier;explicit_route_surface_codex;class_trivial;tier_list_0;tier_fast;/);
  // The escalation guard stays on the named surface (claude-chat's own
  // reference, never the agent surface or another pool).
  assert.equal(resolved.routes['requested-3'].ladder.reference_candidate_id,
    key('claude-fable-5-1', 'max', 'read_only', 'claude-chat'));
  assert.equal(resolved.routes['requested-2'].ladder.reference_candidate_id,
    key('claude-fable-5-1', 'max', 'read_only', 'claude'));
  assert.equal(resolved.routes['requested-1'].ladder.reference_candidate_id, key('gpt-6-astra', 'max', 'read_only', 'codex'));
  // Deep work on a named route runs that surface's frontier at max, never ultra.
  const deep = resolveRoutePlan(plan(request, [routeNode(0, 'deep'), routeNode(1, 'standard'), routeNode(2, 'trivial')]),
    request, catalog, Date.now()).decisions;
  assert.deepEqual([deep['requested-1'], deep['requested-2']].map(d => `${d.surface}:${d.model}/${d.effort}`),
    ['codex:gpt-6-astra/max', 'claude:sonnet/medium']);
  // A planner that names no route, a changed payload or a dropped GPT route
  // never gets a surface from the host.
  for (const [name, node] of [['unknown ordinal', {...routeNode(0, 'trivial'), id: 'requested-7'}],
    ['changed payload', {...routeNode(0, 'trivial'), instruction: '9+9'}],
    ['free id', {...routeNode(0, 'trivial'), id: 'route-1'}]])
    assert.throws(() => resolveRoutePlan(plan(request, [node]), request, catalog, Date.now()),
      /explicit_route_binding_mismatch/, name);

  // Durable runtime: three tickets, each on its named surface, all cheap.
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'fanout'),
    catalog: async value => tierCatalog(value, {codex: WITH_ULTRA, chat: true}),
    plan: async () => plan(request, FANOUT.map((_, index) => routeNode(index, 'trivial'))),
    execute: async ticket => { tickets.push(ticket); return execution(ticket); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.deepEqual(tickets.map(ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}/` +
    ticket.selected_config.effort).sort(),
  ['claude-chat:claude-sonnet-5-5/low', 'claude:claude-sonnet-5-5/low', 'codex:gpt-6-luna/low']);
  assert.ok(tickets.every(ticket => !['gpt-6-astra', 'claude-fable-5-1', 'fable', 'opus', 'claude-opus-5-5']
    .includes(ticket.selected_config.model) && !['max', 'ultra'].includes(ticket.selected_config.effort)));
  assert.deepEqual(done.children.map(child => child.requested_surface), FANOUT.map(route => route.surface));
  assert.ok(done.children.every(child => child.routing_decision.route_class === 'trivial'));
  // The ledger keeps the class, tier and guard of an explicit route as evidence.
  const records = (await readFile(join(dir, 'fanout', 'routing-ledger', 'routing-ledger.jsonl'), 'utf8')).trim()
    .split('\n').map(line => JSON.parse(line));
  assert.ok(records.every(record => record.route_kind === 'explicit_route' && record.route_class === 'trivial' &&
    record.ladder !== null && record.escalation_outcome === null));
});

test('a failed cheap answer on an explicit route escalates once to the reference of THAT surface only', async t => {
  const dir = await fixture(t);
  const request = explicitTask(dir, [FANOUT[0], FANOUT[2]]);
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'explicit-escalation'),
    catalog: async value => tierCatalog(value, {codex: WITH_ULTRA, chat: true}),
    plan: async () => plan(request, [routeNode(0, 'trivial', [FANOUT[0], FANOUT[2]]),
      routeNode(1, 'trivial', [FANOUT[0], FANOUT[2]])]),
    execute: async ticket => { tickets.push(ticket);
      const cheap = ['gpt-6-luna', 'claude-sonnet-5-5'].includes(ticket.selected_config.model);
      return execution(ticket, cheap ? {output: ' '} : {}); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  const bySurface = surface => tickets.filter(ticket => ticket.selected_config.surface === surface)
    .map(ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`);
  assert.deepEqual(bySurface('codex'), ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.deepEqual(bySurface('claude-chat'), ['claude-sonnet-5-5/low', 'claude-fable-5-1/max']);
  assert.deepEqual(bySurface('claude'), [], 'never another surface than the one the owner named');
  assert.deepEqual(done.children.map(child => child.selected_config.surface), ['codex', 'claude-chat']);
  // With no reference on the named surface the guard holds, never another surface.
  const noAstra = explicitTask(dir, [FANOUT[0]]);
  const held = await createRCCRuntime({stateDir: join(dir, 'explicit-held'),
    catalog: async value => tierCatalog(value, {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')}),
    plan: async () => plan(noAstra, [routeNode(0, 'trivial', [FANOUT[0]])]),
    execute: async ticket => execution(ticket, {output: ''}), verifyTask: taskVerdict});
  t.after(async () => { await held.close(); });
  await held.submit(noAstra);
  const heldDone = await wait(held, noAstra);
  assert.equal(heldDone.state, 'held');
  assert.equal(heldDone.error, 'ladder_reference_unavailable');
});

test("an explicit route's own effort or model words bind that route only; ultra only when that route asked", () => {
  const request = explicitTask('/tmp', [FANOUT[0], FANOUT[1]]);
  const base = tierCatalog(request, {codex: WITH_ULTRA});
  const routes = [FANOUT[0], FANOUT[1]];
  const bind = (intents, classes = ['trivial', 'trivial']) => Object.values(resolveRoutePlan(plan(request,
    classes.map((routeClass, index) => routeNode(index, routeClass, routes))), request,
  {...base, explicit_route_intents: intents}, Date.now()).decisions).map(d => `${d.model}/${d.effort}`);
  assert.deepEqual(bind([null, null]), ['gpt-6-luna/low', 'claude-sonnet-5-5/low']);
  // "최대 리즈닝으로 1+1": that route runs max on its graded tier; the other is untouched.
  assert.deepEqual(bind([{effort: 'max', model_family: null}, null]), ['gpt-6-luna/max', 'claude-sonnet-5-5/low']);
  // A route word naming astra ("astra로 돌려 1+1"; a bare "astra로 1+1" parses to
  // nothing): that family, effort by grade.
  assert.deepEqual(bind([{effort: null, model_family: 'astra'}, null]), ['gpt-6-astra/low', 'claude-sonnet-5-5/low']);
  // Ultra only on the route whose own words asked for it.
  assert.deepEqual(bind([{effort: 'ultra', model_family: 'astra'}, null], ['deep', 'trivial']),
    ['gpt-6-astra/ultra', 'claude-sonnet-5-5/low']);
  assert.deepEqual(bind([null, null], ['deep', 'deep']), ['gpt-6-astra/max', 'claude-fable-5-1/max']);
  // Without any route word an explicit test never binds ultra, at any grade.
  assert.ok(['trivial', 'standard', 'deep'].every(routeClass =>
    bind([null, null], [routeClass, routeClass]).every(tuple => !tuple.endsWith('/ultra'))));
  // A route whose family has no row on its surface holds: never a substitute.
  assert.throws(() => bind([{effort: null, model_family: 'fable'}, null]), /no_dispatchable_candidate:read_only:trivial/);
});

test('an effort-only owner word on a cheaper tier is guarded: a failed luna/max answer escalates to astra/max in a fresh session', async t => {
  const dir = await fixture(t);
  const maxOnly = models => models.map(([model, efforts]) => [model, efforts.filter(effort => effort === 'max')])
    .filter(([, efforts]) => efforts.length);
  const result = await run(t, dir, 'effort only guarded', {extras: {codexSession: 'owner-codex-thread'},
    refresh: value => tierCatalog(value, {codex: maxOnly(CODEX), claude: maxOnly(CLAUDE),
      intent: {effort: 'max', model_family: null}}),
    execute: (ticket, count) => count === 1 ? execution(ticket, {output: '  '}) : execution(ticket)});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tickets.map(ticket => [`${ticket.selected_config.model}/${ticket.selected_config.effort}`,
    ticket.native_resume_session_id]), [['gpt-6-luna/max', null], ['gpt-6-astra/max', 'owner-codex-thread']]);
  assert.equal(result.done.result.output, 'answer from gpt-6-astra/max');
  // A route the owner's words fix exactly (family AND effort) stays explicit:
  // it resumes the owner's thread and is never escalated.
  const exact = await run(t, dir, 'effort and family', {extras: {codexSession: 'owner-codex-thread'},
    refresh: value => tierCatalog(value, {claude: [], codex: [['gpt-6-luna', ['max']]],
      intent: {effort: 'max', model_family: 'luna'}}),
    execute: ticket => execution(ticket, {output: ' '})});
  assert.deepEqual(exact.tickets.map(ticket => ticket.native_resume_session_id), ['owner-codex-thread']);
  assert.equal(exact.runtime.events({schema: 1, task_id: exact.request.task_id})
    .some(event => event.kind === 'ladder_escalated_to_reference'), false);
});

test('a guard whose catalog rows expired during a long cheap attempt still escalates to a reference that can run', async t => {
  const dir = await fixture(t);
  const codexOnly = {claude: [], codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')};
  const shortLived = (catalog, ms) => ({...catalog, candidates: catalog.candidates.map(c => ({...c,
    availability_valid_until_ms: c.availability_observed_at_ms + ms, quota_valid_until_ms: c.quota_observed_at_ms + ms}))});
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Plan time: no frontier anywhere (null target). The refresh before the
  // cheap dispatch has astra back, valid for ~400 ms; the cheap attempt runs
  // 700 ms and fails. The reference observed then still runs.
  const stale = await run(t, dir, 'stale bound catalog', {
    refresh: (value, count) => count === 1 ? tierCatalog(value, codexOnly) : shortLived(tierCatalog(value, {claude: []}), 400),
    execute: async (ticket, count) => { if (count === 1) { await sleep(700); return execution(ticket, {output: ' '}); }
      return execution(ticket); }});
  assert.equal(stale.done.state, 'completed', stale.done.error);
  assert.deepEqual(stale.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  // The bound catalog never had a frontier row, but one is back when the
  // cheap attempt fails: the guard refreshes once and escalates to it.
  const back = await run(t, dir, 'refreshed at failure', {
    refresh: (value, count) => tierCatalog(value, count <= 2 ? codexOnly : {claude: []}),
    execute: (ticket, count) => count === 1 ? execution(ticket, {output: ''}) : execution(ticket)});
  assert.equal(back.done.state, 'completed', back.done.error);
  assert.deepEqual(back.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.ok(back.runtime.events({schema: 1, task_id: back.request.task_id})
    .some(event => event.kind === 'catalog_refreshed_before_dispatch'));
});

test('the routing ledger records what each cheaper attempt escalation did: escalated, or why it was held', async t => {
  const dir = await fixture(t);
  await run(t, dir, 'ledger escalated', {execute: (ticket, count) => count === 1 ? execution(ticket, {output: ''}) :
    execution(ticket)});
  const escalated = await ledger(dir, 'ledger escalated');
  assert.deepEqual(escalated.map(record => [record.model, record.attempt_state, record.escalation_outcome]),
    [['gpt-6-luna', 'ladder_not_returned', 'escalated'], ['gpt-6-astra', 'completed', null]]);
  await run(t, dir, 'ledger held', {catalog: {claude: [], codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')},
    execute: ticket => execution(ticket, {output: ''})});
  const held = await ledger(dir, 'ledger held');
  assert.deepEqual(held.map(record => [record.model, record.attempt_state, record.escalation_outcome]),
    [['gpt-6-luna', 'ladder_not_returned', 'ladder_reference_unavailable']]);
  await run(t, dir, 'ledger adopted', {execute: ticket => execution(ticket)});
  assert.deepEqual((await ledger(dir, 'ledger adopted')).map(record => record.escalation_outcome), [null]);
});

test('pools are ranked by the quota of the model a node actually binds, not by the frontier model', () => {
  const request = task('/tmp', 'Answer one question');
  // Codex leads the catalog (its frontier has more room), but its workhorse
  // and fast models are nearly exhausted; Claude's lower tiers have room.
  const scores = {'gpt-6-astra': 300_000_000, 'gpt-6.1-sol': 2_000_000, 'gpt-6-luna': 2_000_000,
    'claude-fable-5-1': 100_000_000, fable: 100_000_000, 'claude-opus-5-5': 900_000_000, opus: 900_000_000,
    'claude-sonnet-5-5': 900_000_000, sonnet: 900_000_000};
  const catalog = {...tierCatalog(request), quota_scores: scores};
  const standard = resolve(request, catalog, 'standard').decisions.n;
  assert.equal(route(standard), 'anthropic_shared/sonnet/medium');
  assert.match(standard.reason, /;pool_rank_1;outscored_pool_rank_0;effort_medium;pool_scored_by_bound_model;/);
  assert.equal(route(resolve(request, catalog, 'trivial').decisions.n), 'anthropic_shared/claude-sonnet-5-5/low');
  // Deep work binds the frontier: Codex's astra has more room than fable.
  assert.equal(route(resolve(request, catalog, 'deep').decisions.n), 'openai_codex/gpt-6-astra/max');
  // Unknown scores keep the catalog order; an older catalog has none.
  assert.equal(route(resolve(request, tierCatalog(request), 'standard').decisions.n), 'openai_codex/gpt-6.1-sol/medium');
  assert.equal(route(resolve(request, {...tierCatalog(request), quota_scores: {'gpt-6.1-sol': 5}}, 'standard')
    .decisions.n), 'openai_codex/gpt-6.1-sol/medium', 'a model with a score outranks one with none');
  assert.equal(route(resolve(request, {...tierCatalog(request), quota_scores: {sonnet: 5}}, 'standard')
    .decisions.n), 'anthropic_shared/sonnet/medium');
});

test('quota_scores and explicit_route_intents are strictly shaped catalog fields', async t => {
  const dir = await fixture(t);
  for (const [name, change] of [['negative score', {quota_scores: {'gpt-6-luna': -1}}],
    ['fractional score', {quota_scores: {'gpt-6-luna': 0.5}}],
    ['score above one', {quota_scores: {'gpt-6-luna': 1_000_000_001}}],
    ['score for a model not offered', {quota_scores: {'gpt-9': 1}}],
    ['route intents outside an explicit test', {explicit_route_intents: [null]}]]) {
    const bad = await run(t, dir, name, {refresh: value => ({...tierCatalog(value), ...change}),
      execute: () => { throw Error('must not dispatch'); }});
    assert.equal(bad.done.state, 'held', name); assert.equal(bad.done.error, 'catalog_binding_invalid', name);
  }
});

// ---- Cost gate: tier or reference, decided from the routing ledger --------
// The derivation: a guarded read-only tier route costs mu_C + p*mu_R, the
// reference mu_R, so the tier costs more iff p > 1 - mu_C/mu_R. In tokens the
// gate may only act on escalation spend: P_more = Pr[mu_C < mu_R and
// mu_C + p*mu_R > mu_R]; reference only when P_more >= 0.9, and then a task
// still tries the tier with probability 1 - P_more.

const evidence = (trials, escalations, cheapCosts, referenceCosts, level = 'family') =>
  ({cheap: {trials, escalations, cost: costSummary(cheapCosts)}, reference: {level, cost: costSummary(referenceCosts)}});
// n costs around a centre, deterministic and spread (no randomness in tests).
// A whole number of cycles of five (n = 5, 10, 20) has its mean at the centre.
const around = (centre, spread, n) => Array.from({length: n}, (_, i) => centre + spread * ((i % 5) - 2) / 2);
// Regularized incomplete beta for integer a, b: Pr[Beta(a, b) <= x].
function betaCDF(x, a, b) {
  const n = a + b - 1;
  let total = 0, choose = 1;
  for (let j = 0; j <= n; j++) {
    if (j >= a) total += choose * x ** j * (1 - x) ** (n - j);
    choose = choose * (n - j) / (j + 1);
  }
  return total;
}
// The numbers a routing reason's gate token wrote (null when it has none).
function writtenGate(reason) {
  const match = /;cost_gate_[a-z_]+:p_mean=[0-9.]+:cost_ratio=[0-9.]+:p_more=([0-9.]+):conf=([0-9.]+)(?::explore=([0-9.]+))?:/
    .exec(reason);
  return match && {p_more: Number(match[1]), conf: Number(match[2]), explore: match[3] === undefined ? null : Number(match[3])};
}
// The count of posterior draws behind an exact p_more.
const moreOf = gate => Math.round(gate.p_more * gate.draws);
// A task label whose node's exploration draw keeps the tier (explore) or not,
// for a gate decision at this P_more. Deterministic: the draw is a hash.
function exploreLabel(prefix, taskID, nodeID, gate, explore) {
  for (let i = 0; i < 10_000; i++) {
    const label = `${prefix}-${i}`;
    if ((costGateExploreDraw(`${taskID(label)}\n${nodeID}`) >= moreOf(gate)) === explore) return label;
  }
  throw new Error('no label');
}

test('cost gate: the confidence is the one tunable; no or too little evidence keeps the tier', () => {
  assert.equal(COST_GATE_CONFIDENCE, 0.9);
  assert.equal(COST_GATE_DRAWS, 4000);
  assert.equal(COST_GATE_MIN_SAMPLES, 2);
  const none = tierCostGate(tierCostEvidence([], {}));
  assert.equal(none.route, 'tier');
  assert.equal(none.reason, 'cost_gate_insufficient');
  assert.deepEqual([none.trials, none.escalations, none.cheap_n, none.reference_n, none.p_more], [0, 0, 0, 0, null]);
  // One cost sample in either arm: its spread is undefined, so no decision.
  for (const [cheap, reference] of [[[500], [1000, 1100]], [[500, 520], [1000]]])
    assert.equal(tierCostGate(evidence(10, 10, cheap, reference)).reason, 'cost_gate_insufficient');
  // A zero mean cost is no usable evidence either.
  assert.equal(tierCostGate(evidence(4, 4, [0, 0], [1000, 1000])).reason, 'cost_gate_insufficient');
  // Malformed evidence or options are unavailable / refused, never a decision.
  for (const bad of [null, {}, {cheap: {trials: 2, escalations: 3, cost: costSummary([1, 2])},
    reference: {level: 'family', cost: costSummary([1, 2])}},
    {...evidence(2, 1, [1, 2], [3, 4]), reference: {level: 'everywhere', cost: costSummary([3, 4])}}])
    assert.deepEqual([tierCostGate(bad).route, tierCostGate(bad).reason], ['tier', 'cost_gate_unavailable']);
  for (const options of [{confidence: 0}, {confidence: 1.5}, {draws: 0}, {exploreKey: ''}, {exploreKey: 7}])
    assert.throws(() => tierCostGate(evidence(4, 2, [1, 2], [3, 4]), options), /cost_gate_options_invalid/);
});

test('cost gate: a clear escalation rate goes to the reference; a rare one on a far cheaper route stays tier', () => {
  // Every cheap attempt failed and the cheap route costs a fifth of the
  // reference: break-even p is 0.8, the posterior is Beta(21, 1).
  const failing = tierCostGate(evidence(20, 20, around(200, 20, 20), around(1000, 100, 10)));
  assert.equal(failing.route, 'reference');
  assert.equal(failing.reason, 'cost_gate_reference');
  assert.equal(failing.p_mean, round(21 / 22));
  assert.equal(failing.cost_ratio, 0.2);
  assert.ok(failing.p_more >= COST_GATE_CONFIDENCE, String(failing.p_more));
  // Close to the closed form 1 - 0.8^21 (the costs barely spread).
  assert.ok(Math.abs(failing.p_more - (1 - 0.8 ** 21)) < 0.01, String(failing.p_more));
  // One escalation in 20 on a route at a twentieth of the cost: never more.
  const cheap = tierCostGate(evidence(20, 1, around(50, 5, 20), around(1000, 100, 10)));
  assert.equal(cheap.route, 'tier');
  assert.equal(cheap.reason, 'cost_gate_tier');
  assert.equal(cheap.p_mean, round(2 / 22));
  assert.equal(cheap.p_more, 0);
  // A cheap route costing 90% of the reference with 4 escalations in 10:
  // break-even p is only 0.1, so the reference is cheaper with confidence.
  const close = tierCostGate(evidence(10, 4, around(900, 30, 10), around(1000, 30, 10)));
  assert.equal(close.route, 'reference');
  assert.equal(close.cost_ratio, 0.9);
  assert.ok(close.p_more >= COST_GATE_CONFIDENCE, String(close.p_more));
});
function round(value) { return Math.round(value * 1000) / 1000; }

test('cost gate: tokens overstate the cheaper attempt, so only escalation spend can move a node to the reference', () => {
  // Twenty cheaper attempts, none failed, each spending ~1.6% MORE tokens
  // than a reference attempt (an agentic cheaper model re-reading context).
  // In tokens mu_C + p*mu_R > mu_R even at p = 0, but a cheaper model's token
  // does not spend more quota: nothing observed says the tier costs more.
  const neverFailed = tierCostGate(evidence(20, 0, around(32500, 3000, 20), around(32000, 3000, 10)));
  assert.deepEqual([neverFailed.route, neverFailed.reason, neverFailed.cost_ratio, neverFailed.p_more],
    ['tier', 'cost_gate_no_escalation', 1.016, null]);
  // Escalations, but the cheaper attempts' mean token cost is not below the
  // reference's: tokens cannot rank the arms, at any confidence.
  for (const confidence of [0.9, 0.01]) {
    const unidentified = tierCostGate(evidence(20, 2, around(32500, 3000, 20), around(32000, 3000, 10)), {confidence});
    assert.deepEqual([unidentified.route, unidentified.reason, unidentified.p_more], ['tier', 'cost_gate_unidentified', null]);
  }
  // A cheaper mean 0.4% below the reference's with wide spread: only the
  // posterior draws where the cheaper attempt is cheaper can count, so even
  // twenty escalations in twenty are not confident.
  for (const escalations of [2, 20]) {
    const barely = tierCostGate(evidence(20, escalations, around(31900, 3000, 20), around(32000, 3000, 10)));
    assert.equal(barely.reason, 'cost_gate_tier', String(escalations));
    assert.equal(barely.cost_ratio, 0.996);
    assert.ok(barely.p_more > 0.3 && barely.p_more < 0.75, `${escalations}: ${barely.p_more}`);
  }
  // The same gap, measured precisely: the cheaper attempt is credibly
  // cheaper, and the escalations make the tier cost more.
  const precise = tierCostGate(evidence(20, 2, around(31900, 30, 20), around(32000, 30, 10)));
  assert.equal(precise.route, 'reference');
});

test('cost gate: P_more never depends on the confidence, so the decision is monotone in it', () => {
  // The reported reproduction: when the confidence was part of the seed,
  // 0.9 sent this to the reference and 0.89 kept the tier.
  const reported = evidence(10, 9, [290, 330, 310], [980, 1020, 1000]);
  const at = (confidence, exploreKey = null) => tierCostGate(reported, {confidence, exploreKey});
  const pMore = at(0.9).p_more;
  assert.equal(at(0.89).p_more, pMore);
  assert.ok(pMore > 0.85 && pMore < 0.95, String(pMore));
  for (const exploreKey of [null, 'task-a\nn', 'task-b\nn', 'task-c\nn']) {
    let tier = false;
    for (let step = 1; step <= 200; step++) {
      const confidence = step / 200, gate = at(confidence, exploreKey);
      assert.equal(gate.p_more, pMore, String(confidence));
      assert.equal(gate.confidence, confidence);
      if (gate.p_more < confidence) assert.equal(gate.reason, 'cost_gate_tier');
      if (exploreKey === null) assert.equal(gate.route === 'reference', gate.p_more >= confidence);
      if (gate.route === 'tier') tier = true;
      else assert.equal(tier, false, `a higher confidence (${confidence}) went back to the reference`);
    }
    assert.equal(tier, true);
  }
});

test('cost gate: the recorded p_more is the exact fraction the rule compared, never rounded across it', () => {
  // Evidence whose rounded P_more read 0.9 beside a tier decision.
  const request = task('/tmp', 'Answer one question', {taskID: 'task-gate-exact-fraction'});
  const catalog = tierCatalog(request);
  for (const value of [evidence(3, 3, [435, 445, 440], [980, 1020, 1000]), evidence(7, 2, [890, 910], [1000, 1040]),
    evidence(13, 6, [720, 740], [1000, 1040]), evidence(4, 3, [611, 651, 581], [1000, 1100, 950]),
    evidence(8, 8, [240, 280, 210], [1000, 1100, 950]), evidence(10, 9, [290, 330, 310], [980, 1020, 1000])]) {
    const gate = tierCostGate(value);
    assert.equal(gate.draws, COST_GATE_DRAWS);
    assert.equal(gate.p_more, moreOf(gate) / gate.draws, 'an exact count over the draws');
    assert.equal(gate.route === 'reference', gate.p_more >= COST_GATE_CONFIDENCE);
    // The routing reason and the route's ledger field carry the same exact
    // numbers, and the documented rule reproduces the bound route.
    const resolved = resolveRoutePlan(plan(request, [graded('n', 'trivial')]), request, catalog, Date.now(),
      {costEvidence: () => value});
    const written = writtenGate(resolved.decisions.n.reason);
    assert.deepEqual([written.p_more, written.conf], [gate.p_more, COST_GATE_CONFIDENCE]);
    assert.deepEqual([resolved.routes.n.cost_gate.p_more, resolved.routes.n.cost_gate.confidence,
      resolved.routes.n.cost_gate.draws, resolved.routes.n.cost_gate.explore],
    [written.p_more, written.conf, COST_GATE_DRAWS, written.explore]);
    const rule = written.p_more >= written.conf && (written.explore === null || written.explore < written.p_more);
    assert.equal(resolved.decisions.n.model === 'gpt-6-astra', rule, resolved.decisions.n.reason);
    assert.equal(written.explore !== null, gate.route === 'reference', 'the exploration draw is shown when it decided');
  }
});

test('cost gate: identical evidence gives the identical decision and P_more', () => {
  const make = () => evidence(7, 3, [400, 420, 390, 450, 410, 430, 405], [900, 1100, 1000, 950]);
  const first = tierCostGate(make()), second = tierCostGate(make());
  assert.deepEqual(first, second);
  first.p_more = -1; // a caller mutating its copy never changes the next answer
  assert.deepEqual(tierCostGate(make()), second);
  // The same evidence with more draws converges on the same probability.
  const precise = tierCostGate(make(), {draws: 40_000});
  assert.ok(Math.abs(precise.p_more - second.p_more) < 0.03, `${precise.p_more} ${second.p_more}`);
  // Another confidence: the same P_more, the same rule.
  for (const confidence of [0.01, 0.5, 1]) {
    const gate = tierCostGate(make(), {confidence});
    assert.equal(gate.p_more, second.p_more);
    assert.equal(gate.route, second.p_more >= confidence ? 'reference' : 'tier');
  }
  // The same task node explores the same way every time.
  const keyed = evidence(2, 2, [801, 803], [1002, 1004]);
  for (const exploreKey of ['task-x\nn', 'task-y\nrequested-1'])
    assert.deepEqual(tierCostGate(keyed, {exploreKey}), tierCostGate(keyed, {exploreKey}));
});

test('cost gate: Monte Carlo agrees with the closed form when costs are exact', () => {
  // Zero spread: P_more = Pr[p > 1 - mu_C/mu_R] = 1 - I_{1-ratio}(a, b).
  for (const [trials, escalations, cheapCost, referenceCost] of [[20, 19, 200, 1000], [2, 2, 800, 1000],
    [2, 1, 500, 1000], [12, 3, 700, 1000]]) {
    const gate = tierCostGate(evidence(trials, escalations, [cheapCost, cheapCost], [referenceCost, referenceCost]));
    const exact = 1 - betaCDF(1 - cheapCost / referenceCost, 1 + escalations, 1 + trials - escalations);
    // Monte Carlo standard error is at most 0.008 at 4000 draws: 3 SE.
    assert.ok(Math.abs(gate.p_more - exact) < 0.025, `${trials}/${escalations}: ${gate.p_more} vs ${exact}`);
  }
});

test('cost gate: the Beta, Gamma and exploration draws have the right distributions', () => {
  const random = costGateRandom('5'.repeat(64));
  const n = 40_000;
  const moments = draw => { let sum = 0, squares = 0;
    for (let i = 0; i < n; i++) { const x = draw(); sum += x; squares += x * x; }
    return [sum / n, squares / n - (sum / n) ** 2]; };
  const [betaMean, betaVar] = moments(() => sampleBeta(random, 3, 7));
  assert.ok(Math.abs(betaMean - 0.3) < 0.005, String(betaMean));
  assert.ok(Math.abs(betaVar - 21 / 1100) < 0.002, String(betaVar));
  for (const shape of [0.5, 1, 4.5]) {
    const [mean, variance] = moments(() => sampleGamma(random, shape));
    assert.ok(Math.abs(mean - shape) < 0.03 * Math.max(1, shape), `${shape}: ${mean}`);
    assert.ok(Math.abs(variance - shape) < 0.08 * Math.max(1, shape), `${shape}: ${variance}`);
  }
  const uniform = costGateRandom('0'.repeat(64)); // an all-zero seed still runs
  for (let i = 0; i < 1000; i++) { const u = uniform(); assert.ok(u > 0 && u < 1); }
  assert.throws(() => costGateRandom('not hex'), /cost_gate_seed_invalid/);
  assert.throws(() => sampleGamma(random, 0), /cost_gate_gamma_shape_invalid/);
  // Exploration draws: integers in [0, draws), deterministic per key, uniform
  // over keys (mean (draws - 1) / 2, variance (draws^2 - 1) / 12).
  let index = 0;
  const [drawMean, drawVar] = moments(() => costGateExploreDraw(`task-${index++}\nn`));
  assert.ok(Math.abs(drawMean - 1999.5) < 30, String(drawMean));
  assert.ok(Math.abs(drawVar - (4000 ** 2 - 1) / 12) < 0.03 * (4000 ** 2 - 1) / 12, String(drawVar));
  assert.equal(costGateExploreDraw('task-a\nn'), costGateExploreDraw('task-a\nn'));
  for (let i = 0; i < 1000; i++) assert.ok(Number.isInteger(costGateExploreDraw(`k${i}`, 10)) &&
    costGateExploreDraw(`k${i}`, 10) >= 0 && costGateExploreDraw(`k${i}`, 10) < 10);
  assert.throws(() => costGateExploreDraw(''), /cost_gate_explore_key_invalid/);
});

test('cost gate: a confident gate still tries the tier with probability 1 - P_more (posterior probability matching)', () => {
  // Two early failures, nothing since: confident, not certain.
  const value = evidence(2, 2, [801, 803], [1002, 1004]);
  const gate = tierCostGate(value);
  assert.equal(gate.route, 'reference');
  assert.ok(gate.p_more >= COST_GATE_CONFIDENCE && gate.p_more < 1, String(gate.p_more));
  let explored = 0;
  const keys = 4000;
  for (let i = 0; i < keys; i++) {
    const exploreKey = `task-${i}\nn`;
    const keyed = tierCostGate(value, {exploreKey});
    const draw = costGateExploreDraw(exploreKey);
    assert.equal(keyed.p_more, gate.p_more);
    assert.equal(keyed.explore, draw / COST_GATE_DRAWS);
    assert.equal(keyed.reason, draw >= moreOf(gate) ? 'cost_gate_explore' : 'cost_gate_reference');
    assert.equal(keyed.route, draw >= moreOf(gate) ? 'tier' : 'reference');
    if (keyed.route === 'tier') explored++;
  }
  // The share of explored task nodes is 1 - P_more (binomial: 4.5 SE).
  const expected = 1 - gate.p_more, se = Math.sqrt(expected * (1 - expected) / keys);
  assert.ok(Math.abs(explored / keys - expected) < 4.5 * se, `${explored / keys} vs ${expected}`);
  // Below the confidence there is nothing to explore: the tier runs.
  const tier = tierCostGate(evidence(7, 3, [400, 420, 390, 450, 410, 430, 405], [900, 1100, 1000, 950]),
    {exploreKey: 'task-0\nn'});
  assert.deepEqual([tier.route, tier.reason, tier.explore], ['tier', 'cost_gate_tier', null]);
});

const GATE_QUERY = {family: 'trivial:read_only:agent', scope: 'read_only', cheap_pool: 'openai_codex',
  cheap_model: 'gpt-6-luna', cheap_effort: 'low', reference_family: 'trivial:read_only:agent',
  reference_surface_kind: 'agent', reference_pool: 'openai_codex', reference_model: 'gpt-6-astra', reference_effort: 'max'};
const ledgerRecord = changes => ({schema: 1, family: 'trivial:read_only:agent', scope: 'read_only', surface_kind: 'agent',
  surface: 'codex', quota_pool: 'openai_codex', model: 'gpt-6-luna', effort: 'low', route_kind: 'tier',
  escalated: false, attempt_state: 'completed', usage: {input_tokens: 100, output_tokens: 10}, ...changes});
const REFERENCE = {model: 'gpt-6-astra', effort: 'max', route_kind: 'reference'};
const usage = (input, output = 100) => ({input_tokens: input, output_tokens: output});

test('cost gate evidence: trials, escalations and token costs from the ledger, family first then the pool', () => {
  const records = [
    ledgerRecord({}), // adopted: trial, no escalation, cost 110
    // escalated with a signal: cache reads already sit inside input_tokens and
    // are not added again; reasoning tokens are added
    ledgerRecord({attempt_state: 'ladder_not_returned', usage: {input_tokens: 200, output_tokens: 20,
      reasoning_tokens: 5, cache_read_tokens: 150}}),
    ledgerRecord({attempt_state: 'ladder_verifier_failed', usage: null}), // a trial, but no cost sample
    ledgerRecord({attempt_state: 'interrupted'}), ledgerRecord({attempt_state: 'effects_uncertain'}), // no evidence
    // A named route the host graded counts as the route kind it ran as; an
    // older named-route record without host_route_kind is no evidence.
    ledgerRecord({route_kind: 'explicit_route', host_route_kind: 'tier', attempt_state: 'ladder_not_returned',
      usage: usage(300, 30)}), // trial, escalation, cost 330
    ledgerRecord({route_kind: 'explicit_route'}),
    ledgerRecord({effort: 'medium'}), ledgerRecord({family: 'standard:read_only:agent'}),
    ledgerRecord({quota_pool: 'anthropic_shared'}),
    ledgerRecord({...REFERENCE, escalated: true, usage: usage(1000)}), // 1100, family
    ledgerRecord({...REFERENCE, attempt_state: 'held', usage: usage(800)}), // 900, family
    // A reference that ran and failed after dispatch with no side effects:
    // the reference arm pays it too (3000, family).
    ledgerRecord({...REFERENCE, attempt_state: 'effects_uncertain', dispatched_failure: 'no_effects', usage: usage(2900)}),
    ledgerRecord({...REFERENCE, route_kind: 'explicit_route', host_route_kind: 'reference', usage: usage(1200)}), // 1300
    ledgerRecord({...REFERENCE, family: 'deep:read_only:agent', usage: {input_tokens: 4000, output_tokens: 1000}}),
    // Cancelled or unknown (no executor failure report): cut short, no sample.
    ledgerRecord({...REFERENCE, attempt_state: 'effects_uncertain'}),
    ledgerRecord({...REFERENCE, route_kind: 'explicit_route', host_route_kind: 'explicit'}), // owner-fixed
    ledgerRecord({...REFERENCE, scope: 'workspace_write', family: 'trivial:workspace_write:agent'}),
    ledgerRecord({...REFERENCE, surface_kind: 'chat', family: 'trivial:read_only:chat'}),
    ledgerRecord({...REFERENCE, route_kind: 'explicit'}), ledgerRecord({...REFERENCE, schema: 2}),
  ].map(costGateRecord).filter(Boolean);
  assert.equal(records.length, 17, 'only schema-1 tier and reference attempts are kept, named routes by host kind');
  const family = tierCostEvidence(records, GATE_QUERY);
  assert.deepEqual(family, {cheap: {trials: 4, escalations: 3, cost: costSummary([110, 225, 330])},
    reference: {level: 'family', cost: costSummary([1100, 900, 3000, 1300])}});
  // Fewer than two family reference samples: the pool at any class, same
  // scope and surface kind (never a write or another surface kind).
  const pool = tierCostEvidence(records.filter(record => !(record.route_kind === 'reference' &&
    [900, 3000, 1300].includes(record.cost))), GATE_QUERY);
  assert.deepEqual(pool.reference, {level: 'pool', cost: costSummary([1100, 5000])});
  assert.deepEqual(costSummary([110, 225]), {n: 2, mean: 167.5, sd: Math.sqrt(2 * 57.5 ** 2)});
});

test('cost gate: a reference run that failed after dispatch counts in mu_R, so failing references are not hidden', () => {
  // Ten cheaper attempts (four escalated) at ~920 tokens; six delivered
  // references at ~1000 and three that failed after dispatch at ~5000.
  const cheap = Array.from({length: 10}, (_, i) =>
    ledgerRecord({attempt_state: i < 4 ? 'ladder_not_returned' : 'completed', usage: usage(800 + 5 * i)}));
  const delivered = Array.from({length: 6}, (_, i) => ledgerRecord({...REFERENCE, usage: usage(900 + 4 * i)}));
  const failed = Array.from({length: 3}, (_, i) => ledgerRecord({...REFERENCE, attempt_state: 'effects_uncertain',
    dispatched_failure: 'no_effects', usage: usage(4900 + 10 * i)}));
  const counted = tierCostEvidence([...cheap, ...delivered, ...failed].map(costGateRecord), GATE_QUERY);
  assert.equal(counted.reference.cost.n, 9);
  const gate = tierCostGate(counted);
  assert.deepEqual([gate.route, gate.reason, gate.cost_ratio], ['tier', 'cost_gate_tier', 0.393]);
  // Leaving the failed runs out (the old reading) would have made the
  // reference look cheap enough to drop the tier.
  const hidden = tierCostGate(tierCostEvidence([...cheap, ...delivered].map(costGateRecord), GATE_QUERY));
  assert.deepEqual([hidden.route, hidden.cost_ratio], ['reference', 0.913]);
});

test('the routing ledger serves cost-gate records: torn lines are skipped, a public file is unreadable', async t => {
  const dir = await fixture(t);
  const ledger = openRoutingLedger(dir);
  assert.deepEqual(ledger.costRecords(), [], 'no ledger yet: no evidence, no error');
  ledger.append(ledgerRecord({task_id: 't1', attempt_id: 'a1'}));
  ledger.append(ledgerRecord({task_id: 't2', attempt_id: 'a2', ...REFERENCE}));
  assert.deepEqual(ledger.costRecords().map(record => [record.model, record.cost]), [['gpt-6-luna', 110], ['gpt-6-astra', 110]]);
  // A torn earlier write is one missing sample, not a disabled gate.
  await writeFile(ledger.path, '{"schema":1,"route_kind":"ti', {flag: 'a'});
  ledger.append(ledgerRecord({task_id: 't3', attempt_id: 'a3', attempt_state: 'ladder_not_returned'}));
  assert.deepEqual(ledger.costRecords().map(record => record.attempt_state), ['completed', 'completed', 'ladder_not_returned']);
  await chmod(ledger.path, 0o644);
  assert.throws(() => ledger.costRecords(), /routing_ledger_file_invalid/);
});

test('cost gate in the resolver: a confident gate binds the guard target directly; errors keep the tier', () => {
  const strong = evidence(20, 20, around(200, 20, 20), around(1000, 100, 10));
  const strongGate = tierCostGate(strong);
  const taskID = label => `task-gate-resolver-${label}`;
  const request = task('/tmp', 'Answer one question', {taskID: taskID(exploreLabel('bind', taskID, 'n', strongGate, false))});
  const catalog = tierCatalog(request);
  let calls = 0, queries = [];
  const bind = (gateEvidence, routeClass = 'trivial', value = request, values = catalog, options = {}) =>
    resolveRoutePlan(plan(value, [graded('n', routeClass, options)]), value, values, Date.now(),
      {costEvidence: query => { calls++; queries.push(query); if (gateEvidence instanceof Error) throw gateEvidence;
        return gateEvidence; }});
  const gated = bind(strong);
  assert.equal(calls, 1);
  assert.deepEqual(queries[0], GATE_QUERY, 'the cheaper route against the escalation target it would use');
  assert.equal(route(gated.decisions.n), 'openai_codex/gpt-6-astra/max');
  assert.equal(gated.decisions.n.tier, 'frontier');
  assert.match(gated.decisions.n.reason, new RegExp('^resolver;route_reference;class_trivial;cost_gate_reference:' +
    `p_mean=0\\.955:cost_ratio=0\\.2:p_more=${strongGate.p_more}:conf=0\\.9:explore=0\\.\\d+:trials=20:escalations=20:` +
    'cheap_n=20:ref_n=10:ref_family;cost_gate_cheap_gpt_6_luna_low;tier_frontier;pool_rank_0;effort_max;' +
    'cost_gate_same_pool;agent_surface$'));
  assert.equal(Object.hasOwn(gated.decisions.n, 'ladder'), false, 'the reference has nothing to escalate to');
  assert.equal(gated.routes.n.kind, 'reference');
  assert.equal(gated.routes.n.ladder, null);
  assert.equal(gated.routes.n.cost_gate.reason, 'cost_gate_reference');
  assert.equal(gated.plan.nodes[0].candidate_id, key('gpt-6-astra', 'max', 'read_only', 'codex'));
  // The same evidence for a task node whose exploration draw keeps the tier.
  const exploring = task('/tmp', 'Answer one question', {taskID: taskID(exploreLabel('explore', taskID, 'n', strongGate, true))});
  const explored = bind(strong, 'trivial', exploring, tierCatalog(exploring));
  assert.equal(route(explored.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.match(explored.decisions.n.reason, /;escalation_reference_same_pool;cost_gate_explore:p_mean=0\.955:/);
  assert.equal(explored.routes.n.kind, 'tier');
  assert.equal(explored.routes.n.ladder.reference_model, 'gpt-6-astra', 'an explored tier keeps its guard');
  // Not confident, too little evidence, no observed escalation, or no
  // readable evidence: the tier route and its guard, with the gate's reason.
  for (const [gateEvidence, token] of [[evidence(20, 1, around(50, 5, 20), around(1000, 100, 10)),
    /;cost_gate_tier:p_mean=0\.091:cost_ratio=0\.05:p_more=0:conf=0\.9:trials=20:/],
    [evidence(20, 0, around(50, 5, 20), around(1000, 100, 10)),
      /;cost_gate_no_escalation:p_mean=0\.045:cost_ratio=0\.05:trials=20:escalations=0:/],
    [evidence(1, 1, [300], [1000]), /;cost_gate_insufficient:trials=1:escalations=1:cheap_n=1:ref_n=1:ref_family;/],
    [new Error('ledger unreadable'), /;escalation_reference_same_pool;cost_gate_unavailable;agent_surface$/],
    [null, /;cost_gate_unavailable;/]]) {
    const kept = bind(gateEvidence);
    assert.equal(route(kept.decisions.n), 'openai_codex/gpt-6-luna/low', String(token));
    assert.match(kept.decisions.n.reason, token);
    assert.equal(kept.routes.n.kind, 'tier');
    assert.equal(kept.routes.n.ladder.reference_model, 'gpt-6-astra');
  }
  // No reference can run now: the gate has nothing to compare and says so.
  calls = 0;
  const noFrontier = tierCatalog(request, {claude: [], codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')});
  const blind = bind(strong, 'trivial', request, noFrontier);
  assert.equal(calls, 0);
  assert.equal(route(blind.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.match(blind.decisions.n.reason, /;escalation_reference_unavailable;cost_gate_no_reference;agent_surface$/);
  // A pure caller without a reader is unchanged (no token at all).
  assert.doesNotMatch(resolve(request, catalog, 'trivial').decisions.n.reason, /cost_gate/);
});

test('cost gate: writes, owner effort or family words, deep work and named routes with their own words never consult it', async t => {
  let calls = 0;
  const strong = evidence(20, 20, around(200, 20, 20), around(1000, 100, 10));
  const strongGate = tierCostGate(strong);
  const costEvidence = () => { calls++; return strong; };
  const bind = (request, catalog, node) => resolveRoutePlan(plan(request, [node]), request, catalog, Date.now(),
    {costEvidence}).decisions[node.id];
  // A write: guarded by nothing, so never gated.
  const writeTask = task('/tmp', 'Change one file', {write: true});
  const write = bind(writeTask, tierCatalog(writeTask, {write: true}), graded('w', 'trivial', {scope: 'workspace_write'}));
  assert.equal(route(write), 'openai_codex/gpt-6.1-sol/medium');
  // An owner effort word ("최대 리즈닝") or family word: the gate never moves it.
  const request = task('/tmp', '최대 리즈닝으로 해줘');
  const maxOnly = models => models.map(([model, efforts]) => [model, efforts.filter(effort => effort === 'max')])
    .filter(([, efforts]) => efforts.length);
  const effortWord = bind(request, tierCatalog(request, {codex: maxOnly(CODEX), claude: maxOnly(CLAUDE),
    intent: {effort: 'max', model_family: null}}), graded('n', 'trivial'));
  assert.equal(route(effortWord), 'openai_codex/gpt-6-luna/max');
  const familyWord = bind(request, tierCatalog(request, {codex: [], claude: CLAUDE.filter(([model]) =>
    ['claude-opus-5-5', 'opus'].includes(model)), intent: {effort: null, model_family: 'opus'}}), graded('n', 'trivial'));
  assert.equal(route(familyWord), 'anthropic_shared/claude-opus-5-5/low');
  // Deep work already runs the reference.
  const deep = bind(request, tierCatalog(request), graded('n', 'deep'));
  assert.equal(route(deep), 'openai_codex/gpt-6-astra/max');
  // A named route with its own effort word.
  const explicit = explicitTask('/tmp', [FANOUT[0], FANOUT[1]]);
  const worded = resolveRoutePlan(plan(explicit, [routeNode(0, 'trivial', [FANOUT[0], FANOUT[1]])]), explicit,
    {...tierCatalog(explicit), explicit_route_intents: [{effort: 'max', model_family: null}, null]}, Date.now(),
    {costEvidence}).decisions['requested-1'];
  assert.equal(`${worded.surface}:${worded.model}/${worded.effort}`, 'codex:gpt-6-luna/max');
  for (const decision of [write, effortWord, familyWord, deep, worded])
    assert.doesNotMatch(decision.reason, /cost_gate/);
  assert.equal(calls, 0, 'the gate was never consulted');
  // A named route WITHOUT its own words is a host-graded tier route: the gate
  // applies and keeps that route on its own surface (the chat lane's own
  // frontier reference, never the agent surface or another pool). A fixed
  // task id whose three route nodes do not explore at this P_more.
  let label = 0;
  const fanoutID = () => `task-gate-named-${label}`;
  while (FANOUT.some((_, index) => costGateExploreDraw(`${fanoutID()}\nrequested-${index + 1}`) >= moreOf(strongGate))) label++;
  const fanout = explicitTask('/tmp', FANOUT, {taskID: fanoutID()});
  const named = resolveRoutePlan(plan(fanout, FANOUT.map((_, index) => routeNode(index, 'trivial'))), fanout,
    tierCatalog(fanout, {chat: true}), Date.now(), {costEvidence}).decisions;
  assert.equal(calls, 3);
  assert.deepEqual(Object.values(named).map(d => `${d.surface}:${d.model}/${d.effort}`),
    ['codex:gpt-6-astra/max', 'claude:claude-fable-5-1/max', 'claude-chat:claude-fable-5-1/max']);
  assert.match(named['requested-3'].reason, /^resolver;route_reference;explicit_route_surface_claude_chat;class_trivial;cost_gate_reference:/);
});

// One durable runtime for several sequential tasks (the gate reads the
// ledger the earlier tasks wrote). Each task has a fixed id (its exploration
// draw is then reproducible), its catalog options, its route class and, for
// a named-route test, its routes.
async function gateRuntime(t, dir, name, execute) {
  const options = new Map(), tickets = [];
  const stateDir = join(dir, name);
  const runtime = await createRCCRuntime({stateDir,
    catalog: async value => tierCatalog(value, options.get(value.task_id)?.catalog ?? {}),
    plan: async ({task: value}) => plan(value, [options.get(value.task_id)?.node ?? graded('n', 'trivial')]),
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  const taskID = label => `task-gate-${name}-${label}`.replace(/[^A-Za-z0-9_-]/g, '-');
  const submit = async (label, catalog = {}, {routeClass = 'trivial', routes = null} = {}) => {
    const request = routes ? explicitTask(dir, routes, {taskID: taskID(label)}) :
      task(dir, 'Answer one question: ' + label, {taskID: taskID(label)});
    options.set(request.task_id, {catalog, node: routes ? routeNode(0, routeClass, routes) : graded('n', routeClass)});
    await runtime.submit(request);
    const done = await wait(runtime, request);
    return {request, done, tuples: tickets.filter(ticket => ticket.task_id === request.task_id)
      .map(ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`)};
  };
  // The gate's decision for the next task from what the ledger holds now.
  const next = (query = GATE_QUERY) => tierCostGate(tierCostEvidence(openRoutingLedger(stateDir).costRecords(), query));
  // A label for the next task whose node does (true) or does not (false)
  // explore at that decision's P_more.
  const label = (prefix, gate, explore, nodeID = 'n') => exploreLabel(prefix, taskID, nodeID, gate, explore);
  return {runtime, submit, next, label, ledger: async () => (await readFile(join(stateDir, 'routing-ledger',
    'routing-ledger.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))};
}
const tokens = (input, output = 100) => ({input_tokens: input, output_tokens: output});
const GATE_KEYS = ['confidence', 'cost_ratio', 'draws', 'explore', 'p_mean', 'p_more', 'reason'];

test('runtime: once the ledger shows the cheaper route failing, the next task binds the reference directly', async t => {
  const dir = await fixture(t);
  // luna answers empty (a failure signal) at ~800 tokens; astra answers at ~1000.
  const gate = await gateRuntime(t, dir, 'bind', (ticket, count) => ticket.selected_config.model === 'gpt-6-astra' ?
    execution(ticket, {usage: tokens(900 + count)}) : execution(ticket, {output: '', usage: tokens(700 + count)}));
  for (const label of ['first', 'second']) {
    const result = await gate.submit(label);
    assert.equal(result.done.state, 'completed', result.done.error);
    assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max'], label);
  }
  const expected = gate.next();
  assert.equal(expected.route, 'reference');
  const third = await gate.submit(gate.label('third', expected, false));
  assert.equal(third.done.state, 'completed', third.done.error);
  assert.deepEqual(third.tuples, ['gpt-6-astra/max'], 'no cheaper attempt is paid for any more');
  const decision = third.done.children[0].routing_decision;
  assert.match(decision.reason, new RegExp('^resolver;route_reference;class_trivial;cost_gate_reference:p_mean=0\\.75:' +
    `cost_ratio=0\\.799:p_more=${expected.p_more}:conf=0\\.9:explore=0\\.\\d+:trials=2:escalations=2:cheap_n=2:` +
    'ref_n=2:ref_family;cost_gate_cheap_gpt_6_luna_low;tier_frontier;pool_rank_0;effort_max;cost_gate_same_pool;' +
    'agent_surface$'));
  assert.equal(Object.hasOwn(decision, 'ladder'), false);
  const records = await gate.ledger();
  assert.deepEqual(records.map(record => [record.model, record.route_kind, record.escalated, record.cost_gate?.reason ?? null]), [
    ['gpt-6-luna', 'tier', false, 'cost_gate_insufficient'], ['gpt-6-astra', 'reference', true, null],
    ['gpt-6-luna', 'tier', false, 'cost_gate_insufficient'], ['gpt-6-astra', 'reference', true, null],
    ['gpt-6-astra', 'reference', false, 'cost_gate_reference']]);
  assert.deepEqual(Object.keys(records[4].cost_gate).sort(), GATE_KEYS);
  assert.deepEqual([records[4].cost_gate.p_mean, records[4].cost_gate.p_more, records[4].cost_gate.confidence,
    records[4].cost_gate.draws], [0.75, expected.p_more, 0.9, 4000]);
  // Older ledger records without the field still read as evidence.
  assert.equal(tierCostEvidence(records.map(({cost_gate: _, ...rest}) => costGateRecord(rest)).filter(Boolean),
    GATE_QUERY).cheap.trials, 2);
});

test('runtime: an early failure streak cannot lock the family to the reference: an explored task updates the evidence', async t => {
  const dir = await fixture(t);
  // luna fails twice (a transient blip), then answers; astra always answers.
  let lunaRuns = 0;
  const gate = await gateRuntime(t, dir, 'transient', (ticket, count) => {
    if (ticket.selected_config.model === 'gpt-6-astra') return execution(ticket, {usage: tokens(900 + count)});
    lunaRuns++;
    return execution(ticket, lunaRuns <= 2 ? {output: '', usage: tokens(700 + count)} : {usage: tokens(700 + count)});
  });
  for (const label of ['blip-1', 'blip-2'])
    assert.deepEqual((await gate.submit(label)).tuples, ['gpt-6-luna/low', 'gpt-6-astra/max'], label);
  const locked = gate.next();
  assert.equal(locked.route, 'reference');
  assert.deepEqual((await gate.submit(gate.label('gated', locked, false))).tuples, ['gpt-6-astra/max']);
  // A task whose exploration draw keeps the tier (probability 1 - P_more):
  // luna runs again, answers, and the posterior moves.
  const explored = await gate.submit(gate.label('explored', gate.next(), true));
  assert.equal(explored.done.state, 'completed', explored.done.error);
  assert.deepEqual(explored.tuples, ['gpt-6-luna/low']);
  assert.match(explored.done.children[0].routing_decision.reason, /;cost_gate_explore:p_mean=0\.75:/);
  const after = gate.next();
  assert.deepEqual([after.trials, after.escalations], [3, 2]);
  assert.ok(after.p_more < locked.p_more, `${after.p_more} < ${locked.p_more}`);
  const records = await gate.ledger();
  assert.deepEqual(records.at(-1).cost_gate.reason, 'cost_gate_explore');
  assert.equal(records.at(-1).route_kind, 'tier', 'an explored attempt is an ordinary cheaper trial');
});

test('runtime: a cheaper route that never failed keeps the tier even when its attempts spend more tokens', async t => {
  const dir = await fixture(t);
  // An agentic cheaper model that re-reads as much context as the frontier:
  // luna 33100 tokens per attempt, astra 32100, and luna never fails.
  const gate = await gateRuntime(t, dir, 'token-proxy', ticket =>
    execution(ticket, {usage: tokens(ticket.selected_config.model === 'gpt-6-astra' ? 32_000 : 33_000)}));
  for (const label of ['deep-1', 'deep-2'])
    assert.deepEqual((await gate.submit(label, {}, {routeClass: 'deep'})).tuples, ['gpt-6-astra/max'], label);
  for (const label of ['trivial-1', 'trivial-2', 'trivial-3'])
    assert.deepEqual((await gate.submit(label)).tuples, ['gpt-6-luna/low'], label);
  const records = await gate.ledger();
  assert.deepEqual(records.slice(2).map(record => record.cost_gate.reason),
    ['cost_gate_insufficient', 'cost_gate_insufficient', 'cost_gate_no_escalation']);
  // The third trivial task's gate: no escalation observed, so the token
  // count of the cheaper attempt alone can never drop it.
  assert.deepEqual([records[4].cost_gate.cost_ratio, records[4].cost_gate.p_more], [1.032, null]);
});

test('runtime: a named route learns from its own attempts, so the gate can act on it', async t => {
  const dir = await fixture(t);
  const routes = [FANOUT[0]];
  const gate = await gateRuntime(t, dir, 'named', (ticket, count) => ticket.selected_config.model === 'gpt-6-astra' ?
    execution(ticket, {usage: tokens(900 + count)}) : execution(ticket, {output: '', usage: tokens(700 + count)}));
  for (const label of ['first', 'second']) {
    const result = await gate.submit(label, {}, {routes});
    assert.equal(result.done.state, 'completed', result.done.error);
    assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max'], label);
  }
  const records = await gate.ledger();
  assert.deepEqual(records.map(record => [record.route_kind, record.host_route_kind, record.attempt_state]), [
    ['explicit_route', 'tier', 'ladder_not_returned'], ['explicit_route', 'reference', 'completed'],
    ['explicit_route', 'tier', 'ladder_not_returned'], ['explicit_route', 'reference', 'completed']]);
  const expected = gate.next();
  assert.deepEqual([expected.route, expected.trials, expected.escalations], ['reference', 2, 2]);
  const third = await gate.submit(gate.label('third', expected, false, 'requested-1'), {}, {routes});
  assert.equal(third.done.state, 'completed', third.done.error);
  assert.deepEqual(third.tuples, ['gpt-6-astra/max'], 'the named route stops paying for a failing cheaper attempt');
  assert.match(third.done.children[0].routing_decision.reason,
    /^resolver;route_reference;explicit_route_surface_codex;class_trivial;cost_gate_reference:/);
  const last = (await gate.ledger()).at(-1);
  assert.deepEqual([last.route_kind, last.host_route_kind, last.cost_gate.reason],
    ['explicit_route', 'reference', 'cost_gate_reference']);
});

test('runtime: a lost cost record closes the gate until it is written, so it never decides from partial evidence', async t => {
  const dir = await fixture(t);
  const gate = await gateRuntime(t, dir, 'lost-record', (ticket, count) => ticket.selected_config.model === 'gpt-6-astra' ?
    execution(ticket, {usage: tokens(900 + count)}) : execution(ticket, {output: '', usage: tokens(700 + count)}));
  assert.deepEqual((await gate.submit('first')).tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  // The cheaper attempts' records cannot be written for a while. They are no
  // parity failures (no verifier is registered: not_registered) but they are
  // cost evidence, so they wait in the backlog.
  const real = gate.runtime.ledger;
  let blocked = true;
  gate.runtime.ledger = {...real, append: record => {
    if (blocked && record.model === 'gpt-6-luna') throw Object.assign(new Error('disk full'), {code: 'ENOSPC'});
    return real.append(record);
  }};
  assert.deepEqual((await gate.submit('second')).tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.equal(gate.runtime.ledgerBacklog.size, 1);
  const third = await gate.submit('third');
  assert.deepEqual(third.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  // Its bind decision (the child's decision now names the escalation).
  assert.match(gate.runtime._load(third.request.task_id).children[0].attempt_history[0].ledger.cost_gate.reason,
    /^cost_gate_unavailable$/, 'not cost_gate_insufficient from a ledger missing a failure');
  assert.equal(gate.runtime.ledgerBacklog.size, 2);
  // Writable again: the backlog is written first, each record once.
  blocked = false;
  gate.runtime._flushLedgerBacklog();
  assert.equal(gate.runtime.ledgerBacklog.size, 0);
  const records = await gate.ledger();
  assert.deepEqual(records.filter(record => record.model === 'gpt-6-luna').map(record => record.cost_gate.reason),
    ['cost_gate_insufficient', 'cost_gate_insufficient', 'cost_gate_unavailable']);
  assert.equal(new Set(records.map(record => record.attempt_id)).size, records.length, 'each record once');
  const expected = gate.next();
  assert.deepEqual([expected.route, expected.trials, expected.escalations], ['reference', 3, 3]);
  assert.deepEqual((await gate.submit(gate.label('fourth', expected, false))).tuples, ['gpt-6-astra/max']);
  // An attempt that has returned but is not recorded yet (its escalation or
  // verifier still runs) closes the gate as well; one still running does not.
  gate.runtime.ledgerInflight.set('probe', {route: {route_kind: 'tier'}, returned: true});
  assert.throws(() => gate.runtime._costEvidence(GATE_QUERY), /cost_gate_ledger_pending/);
  gate.runtime.ledgerInflight.set('probe', {route: {route_kind: 'explicit_route', host_route_kind: 'reference'}, returned: true});
  assert.throws(() => gate.runtime._costEvidence(GATE_QUERY), /cost_gate_ledger_pending/);
  gate.runtime.ledgerInflight.set('probe', {route: {route_kind: 'tier'}});
  assert.equal(gate.runtime._costEvidence(GATE_QUERY).cheap.trials, 3);
  gate.runtime.ledgerInflight.set('probe', {route: {route_kind: 'adapter_bound'}, returned: true});
  assert.equal(gate.runtime._costEvidence(GATE_QUERY).cheap.trials, 3, 'a non-evidence attempt never closes it');
  gate.runtime.ledgerInflight.delete('probe');
});

test('runtime: a reference that fails after dispatch with no effects is recorded as spent; a reported effect is not', async t => {
  const dir = await fixture(t);
  const failure = {status: 'failed', execution_verified: false, task_quality: 'failed', output: null,
    error: 'native_outcome_uncertain_preserved', usage: tokens(4_900)};
  for (const [name, sideEffects, marker] of [['reference failed', 'none', 'no_effects'],
    ['reference failed with effects', 'possible', null]]) {
    const result = await run(t, dir, name, {execute: (ticket, count) => count === 1 ?
      execution(ticket, {output: '', usage: tokens(700)}) : execution(ticket, {...failure, side_effects: sideEffects})});
    assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max'], name);
    assert.equal(result.done.state, 'effects_uncertain', name);
    const records = await ledger(dir, name);
    assert.deepEqual(records.map(record => [record.model, record.attempt_state, record.dispatched_failure]),
      [['gpt-6-luna', 'ladder_not_returned', null], ['gpt-6-astra', 'effects_uncertain', marker]], name);
    // Only the run that the executor says ended in a failure is a reference
    // cost sample (it is never replayed either way).
    const evidence = tierCostEvidence(records.map(costGateRecord).filter(Boolean), GATE_QUERY);
    assert.deepEqual(evidence.reference.cost, costSummary(marker ? [5000] : []), name);
  }
});

test('runtime: a re-resolution consults the same gate for the route it moves to', async t => {
  const dir = await fixture(t);
  // History: with luna unavailable, trivial work bound gpt-6.1-sol low, which
  // failed twice and escalated to astra. Codex only, so a re-resolution stays
  // in the one pool.
  const noLuna = {claude: [], codex: CODEX.filter(([model]) => model !== 'gpt-6-luna')};
  const gate = await gateRuntime(t, dir, 're-resolution', (ticket, count) => {
    const model = ticket.selected_config.model;
    if (model === 'gpt-6-luna') return execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
      output: "You've hit your weekly limit", execution_verified: false, task_quality: 'failed',
      error: 'provider_quota_rejected_before_execution', usage: null});
    return model === 'gpt-6-astra' ? execution(ticket, {usage: tokens(900 + count)}) :
      execution(ticket, {output: '', usage: tokens(600 + count)});
  });
  for (const label of ['history one', 'history two'])
    assert.deepEqual((await gate.submit(label, noLuna)).tuples, ['gpt-6.1-sol/low', 'gpt-6-astra/max'], label);
  // Now luna is offered and binds (no luna evidence: insufficient); its
  // provider rejects before execution, and the re-resolution's next row in
  // the pool (6.1-sol low) is exactly the route the ledger shows failing.
  const expected = gate.next({...GATE_QUERY, cheap_model: 'gpt-6.1-sol'});
  assert.equal(expected.route, 'reference');
  const moved = await gate.submit(gate.label('moved', expected, false), {claude: []});
  assert.equal(moved.done.state, 'completed', moved.done.error);
  assert.deepEqual(moved.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.match(moved.done.children[0].routing_decision.reason, new RegExp(
    '^re_resolved_after:provider_quota_rejected_before_execution;same_pool_only;route_reference;class_trivial;' +
    `cost_gate_reference:p_mean=0\\.75:cost_ratio=0\\.699:p_more=${expected.p_more}:conf=0\\.9:explore=0\\.\\d+:` +
    'trials=2:escalations=2:cheap_n=2:ref_n=2:ref_family;cost_gate_cheap_gpt_6_1_sol_low;tier_frontier;pool_rank_0;' +
    'effort_max;cost_gate_same_pool;agent_surface$'));
  const records = await gate.ledger();
  assert.deepEqual(records.slice(-2).map(record => [record.model, record.attempt_state, record.cost_gate?.reason ?? null]),
    [['gpt-6-luna', 'verified_not_dispatched', 'cost_gate_insufficient'], ['gpt-6-astra', 'completed', 'cost_gate_reference']]);
});

test('runtime: a ledger file that cannot be read safely keeps the tier route (cost_gate_unavailable)', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'public-ledger');
  await mkdir(join(stateDir, 'routing-ledger'), {recursive: true, mode: 0o700});
  await chmod(stateDir, 0o700);
  await writeFile(join(stateDir, 'routing-ledger', 'routing-ledger.jsonl'), '', {mode: 0o644});
  await chmod(join(stateDir, 'routing-ledger', 'routing-ledger.jsonl'), 0o644);
  const gate = await gateRuntime(t, dir, 'public-ledger', ticket => execution(ticket, {usage: tokens(500)}));
  const result = await gate.submit('unreadable');
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['gpt-6-luna/low']);
  assert.match(result.done.children[0].routing_decision.reason,
    /;escalation_reference_same_pool;cost_gate_unavailable;agent_surface$/);
});
