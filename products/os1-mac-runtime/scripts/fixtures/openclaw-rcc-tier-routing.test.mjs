// Tier routing under the one admission law (build 407, R0): every node binds
// the reference (the frontier model at its highest admitted effort, or the
// reference the owner's words leave) unless a certifying source admits a
// cheaper read-only tuple; a certified descent whose source does not accept
// its answer escalates once to the reference (R9). No model grade lowers a
// tuple. Pure resolver checks plus real durable-runtime fixtures with a fake
// executor: no provider, model, network or HOME state.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRCCRuntime, hostContextFingerprint, MODEL_TIERS, resolveRoutePlan,
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
// The provider-stated tiers (Swift ModelTiers, observed 2026-10-14; Haiku's
// resolved ID claude-haiku-4-5-20251001 observed 2026-10-15).
const TIERS = {'gpt-6-astra': 'frontier', 'gpt-6.1-sol': 'workhorse', 'gpt-6-luna': 'fast',
  'claude-fable-5-1': 'frontier', fable: 'frontier', 'claude-opus-5-5': 'workhorse', opus: 'workhorse',
  'claude-sonnet-5-5': 'efficient', sonnet: 'efficient', haiku: 'fast', 'claude-haiku-4-5-20251001': 'fast'};
// The signed production profiles, in the order the native builder emits them:
// pool first, then the strongest tier first. gpt-6-sol (previous generation)
// and daybreak (specialized) have no tier. Claude (2026-10-15, 85 profiles):
// fable, opus and sonnet by their resolved IDs at low, medium, high, xhigh and
// max; the aliases fable (low, xhigh, max), opus (xhigh, max) and sonnet
// (medium); Haiku 4.5 at "none" only (the CLI row has no effort control).
const CODEX = [['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6.1-sol', ['low', 'medium', 'high', 'xhigh', 'max']], ['gpt-6-luna', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6-sol', ['low', 'medium', 'high', 'xhigh', 'max']], ['gpt-daybreak-blue-latest', ['low', 'max']]];
const CLAUDE = [['claude-fable-5-1', ['low', 'medium', 'high', 'xhigh', 'max']], ['fable', ['low', 'xhigh', 'max']],
  ['claude-opus-5-5', ['low', 'medium', 'high', 'xhigh', 'max']], ['opus', ['xhigh', 'max']],
  ['claude-sonnet-5-5', ['low', 'medium', 'high', 'xhigh', 'max']], ['sonnet', ['medium']],
  ['claude-haiku-4-5-20251001', ['none']]];
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
// A host node (what hostPlan builds); `graded` adds a planner-style grade,
// which the resolver accepts for its shape and ignores.
const unbound = (id, options = {}) => ({id, instruction: options.instruction ?? 'Do one bounded task',
  dependencies: [], kind: 'agent', scope: options.scope ?? 'read_only',
  owned_paths: options.scope === 'workspace_write' ? ['**'] : [], context_refs: []});
const graded = (id, routeClass, options = {}) => ({...unbound(id, options), route_class: routeClass});
// R0 (b): a registered gold-blind verifier for the certified class is the
// fixtures' certifying source. Production registers none and ships an empty
// class table, so production binds every Auto node at its reference.
const passes = async () => ({passed: true, reason: 'fixture'});
const CERTIFY = new Map([['trivial:read_only:agent', passes], ['trivial:read_only:chat', passes]]);
const plan = (request, nodes, finalNodeID) => ({schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, nodes,
  ...(finalNodeID === undefined ? {} : {final_node_id: finalNodeID})});
function execution(ticket, overrides = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none',
    output: `answer from ${ticket.selected_config.model}/${ticket.selected_config.effort}`,
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: JSON.stringify({node: ticket.node_id}), native_turn_terminated: true, ...overrides};
}
const taskVerdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
  parity_state: 'unverified', reason: 'fixture_deterministic_coverage'});
const wait = (runtime, request) => runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
const route = (decision) => `${decision.quota_pool}/${decision.model}/${decision.effort}`;
// 'reference': no certifying source; 'certified': the fixture verifier certifies.
function resolve(request, catalog, admission = 'reference', options = {}) {
  return resolveRoutePlan(plan(request, [unbound('n', options)]), request, catalog, Date.now(),
    admission === 'certified' ? {verifierRegistry: CERTIFY} : {});
}
const certifiedLadder = (cheap, reference) => ({source: 'tier', admitted_by: 'verifier', certificate_id: null,
  format_check: null, cheap_model: cheap.model, cheap_effort: cheap.effort, reference_model: reference?.model ?? null,
  reference_effort: reference?.effort ?? null, reference_candidate_id: reference?.id ?? null});

// Source-derived regression: the installed inventory admits Astra/ultra, but
// the old JS referenceEffort capped it at max even after native admission.
// The quality reference is the admitted model's highest supported row; this
// is not permission to send ordinary cheap-tier work straight to that row.
const HIGHEST_CODEX = CODEX.map(([model, efforts]) => [model,
  model === 'gpt-6-astra' ? [...efforts, 'ultra'] : efforts]);
const NATIVE_EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode'];
function nativeCeilings(catalog, overrides = {}) {
  const ceilings = {};
  for (const candidate of catalog.candidates) {
    const provider = {openai_codex: 'codex', anthropic_shared: 'claude'}[candidate.quota_pool];
    if (!provider) continue;
    ceilings[provider] ??= {};
    const previous = ceilings[provider][candidate.model];
    if (previous === undefined || NATIVE_EFFORT_ORDER.indexOf(candidate.effort) > NATIVE_EFFORT_ORDER.indexOf(previous))
      ceilings[provider][candidate.model] = candidate.effort;
  }
  for (const [provider, models] of Object.entries(overrides)) Object.assign(ceilings[provider] ??= {}, models);
  return {...catalog, native_reference_efforts: ceilings};
}

test('the reference is the highest admitted row; a certified descent keeps its cheap tuple and escalates to that row', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const catalog = tierCatalog(request, {codex: HIGHEST_CODEX, claude: []});
  const reference = resolve(request, catalog);
  assert.equal(route(reference.decisions.n), 'openai_codex/gpt-6-astra/ultra');
  assert.deepEqual(reference.routes.n, {kind: 'reference', reference_effort: 'ultra', ladder: null});
  const certified = resolve(request, catalog, 'certified');
  assert.equal(route(certified.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.equal(certified.routes.n.ladder.reference_candidate_id, key('gpt-6-astra', 'ultra', 'read_only', 'codex'));
  assert.equal(certified.routes.n.reference_effort, 'ultra');
  // Legacy persisted catalogs use the same ceiling without inventing tiers.
  const legacy = {...catalog}; delete legacy.model_tiers;
  assert.equal(route(resolve(request, legacy).decisions.n), 'openai_codex/gpt-6-astra/ultra');
  assert.equal(route(resolve(request, legacy, 'certified').decisions.n), 'openai_codex/gpt-6-astra/ultra',
    'an older catalog has no tiers to descend');
});

test('the highest reference preserves exact effort constraints and never invents an unsupported row', () => {
  const request = task('/tmp', 'Use exactly the requested reasoning setting');
  const max = tierCatalog(request, {codex: HIGHEST_CODEX, claude: [],
    intent: {effort: 'max', model_family: 'astra'}});
  assert.equal(route(resolve(request, max).decisions.n), 'openai_codex/gpt-6-astra/max');
  const unsupported = tierCatalog(request, {claude: [], codex: [['gpt-6-astra', ['low', 'ultra']]],
    intent: {effort: 'max', model_family: 'astra'}});
  assert.throws(() => resolve(request, unsupported), /no_dispatchable_candidate/);
  const legacy = {...unsupported}; delete legacy.model_tiers;
  assert.throws(() => resolve(request, legacy), /no_dispatchable_candidate/,
    'an older catalog must not substitute ultra or low for explicit max');
  const ultraOnly = tierCatalog(request, {claude: [], codex: [['gpt-6-astra', ['ultra']]]});
  assert.equal(resolve(request, ultraOnly).decisions.n.effort, 'ultra');
});

test('an admitted but unavailable highest effort holds: no lower effort stands in, and no descent runs without it', async t => {
  const dir = await fixture(t);
  const options = {codex: HIGHEST_CODEX, claude: [], change: (model, effort) =>
    model === 'gpt-6-astra' && effort === 'ultra' ? {availability: 'unavailable'} : {}};
  const request = task(dir, 'Use the actual reference if needed');
  const catalog = tierCatalog(request, options);
  assert.throws(() => resolve(request, catalog), /no_dispatchable_candidate:read_only:deep/);
  // R9: a descent needs a reference that can dispatch now.
  assert.throws(() => resolve(request, catalog, 'certified'), /no_dispatchable_candidate:read_only:deep/);
  const held = await run(t, dir, 'highest unavailable', {catalog: options,
    execute: () => { throw Error('must not dispatch'); }});
  assert.deepEqual(held.tuples, []);
  assert.equal(held.done.state, 'held');
  assert.equal(held.done.error, 'no_dispatchable_candidate:openai_codex=unavailable');
  assert.equal(held.done.result, null);
});

test('native reference_unavailable blocks that pool reference and its descents; another pool reference serves both', async t => {
  const dir = await fixture(t);
  const exclude = catalog => ({...catalog,
    exclusions: [{provider: 'codex', reason: 'reference_unavailable', count: 1}]});
  const request = task(dir, 'Use admitted scope and the real reference ceiling');
  // Native knows ultra is supported but its signed tuple is missing. The
  // catalog truthfully retains max/low rows plus this exclusion, not a
  // caller-fabricated ultra candidate or an invented model-quality claim.
  const unavailable = exclude(tierCatalog(request, {claude: []}));
  assert.throws(() => resolve(request, unavailable), /no_dispatchable_candidate/);
  assert.throws(() => resolve(request, unavailable, 'certified'), /no_dispatchable_candidate/,
    'no cheap tuple runs without a runnable reference above it');
  const legacy = {...unavailable}; delete legacy.model_tiers;
  assert.throws(() => resolve(request, legacy), /no_dispatchable_candidate/);
  const anotherPool = exclude(tierCatalog(request));
  assert.equal(route(resolve(request, anotherPool).decisions.n), 'anthropic_shared/claude-fable-5-1/max');
  const descent = resolve(request, anotherPool, 'certified');
  assert.equal(route(descent.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.equal(descent.routes.n.ladder.reference_candidate_id, key('claude-fable-5-1', 'max', 'read_only', 'claude'));
  assert.match(descent.decisions.n.reason, /;escalation_reference_other_pool;/);
  const explicitMax = {...unavailable, routing_intent: {effort: 'max', model_family: 'astra'}};
  assert.equal(route(resolve(request, explicitMax).decisions.n), 'openai_codex/gpt-6-astra/max',
    'an admitted exact owner tuple is not replaced by the automatic ceiling');
  const held = await run(t, dir, 'missing highest guard', {
    refresh: value => exclude(tierCatalog(value, {claude: []})), execute: () => { throw Error('must not dispatch'); }});
  assert.deepEqual(held.tuples, []);
  assert.equal(held.done.state, 'held');
  assert.equal(held.done.error, 'no_dispatchable_candidate:openai_codex=no_reference');
});

test('a failed descent reaches ultra once; a failed ultra verifier is delivered with its disclosure, never replayed', async t => {
  const dir = await fixture(t);
  const catalog = {codex: HIGHEST_CODEX, claude: []};
  const escalated = await run(t, dir, 'highest escalation', {catalog,
    execute: (ticket, count) => execution(ticket, count === 1 ? {output: ''} : {})});
  assert.deepEqual(escalated.tuples, ['gpt-6-luna/low', 'gpt-6-astra/ultra']);
  assert.equal(escalated.done.state, 'completed', escalated.done.error);
  assert.equal(escalated.done.result.output, 'answer from gpt-6-astra/ultra');
  const rejected = await run(t, dir, 'highest verifier rejected', {catalog,
    verifierRegistry: new Map([['trivial:read_only:agent', async () => ({passed: false, reason: 'fixture rejected'})]]),
    execute: ticket => execution(ticket)});
  assert.deepEqual(rejected.tuples, ['gpt-6-luna/low', 'gpt-6-astra/ultra']);
  // R6: the reference's completed answer is delivered, never held or nulled.
  assert.equal(rejected.done.state, 'returned_unverified');
  assert.equal(rejected.done.error, 'child_quality_disclosed');
  assert.equal(rejected.done.children[0].state, 'completed');
  assert.deepEqual(rejected.done.children[0].quality_disclosure,
    {coverage: null, failed_check_ids: ['node_verifier'], witness_sha256: null});
  assert.equal(rejected.done.result.output, 'answer from gpt-6-astra/ultra');
  assert.equal(rejected.done.result.task_verified, false);
  assert.equal(rejected.done.result.parity_state, 'unverified');
});

test('native model ceilings are model-specific: a preferred frontier never borrows another frontier effort', () => {
  const request = task('/tmp', 'Keep the reference model and its own native ceiling together');
  // Synthetic same-tier inventory: the preferred model really tops out at
  // max; a different, later frontier supports ultra. Effort magnitude is not
  // a license to replace the preferred model.
  const catalog = nativeCeilings(tierCatalog(request, {claude: [],
    codex: [['gpt-6-astra', ['low', 'max']], ['gpt-6-sol', ['low', 'ultra']], ['gpt-6-luna', ['low']]],
    tiers: {...TIERS, 'gpt-6-sol': 'frontier'}}));
  assert.equal(route(resolve(request, catalog).decisions.n), 'openai_codex/gpt-6-astra/max');
  const cheap = resolve(request, catalog, 'certified');
  assert.equal(route(cheap.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.equal(cheap.routes.n.ladder.reference_model, 'gpt-6-astra');
  assert.equal(cheap.routes.n.ladder.reference_effort, 'max');
});

test('native provider ceiling metadata never intercepts a deterministic local exact row', () => {
  const request = task('/tmp', 'Use the exact local executor for one bounded node');
  const exact = {...row('local-exact', 'none', 'local-deterministic', 'none', {surface: 'local'}),
    transport: 'local', tools: [], quota_remaining_fraction: null, estimated_cost_units: 0};
  for (const candidates of [[exact], [exact, ...tierCatalog(request).candidates]]) {
    const models = new Set(candidates.map(candidate => candidate.model));
    const catalog = nativeCeilings({...tierCatalog(request), candidates,
      model_tiers: Object.fromEntries(Object.entries(TIERS).filter(([model]) => models.has(model)))});
    const resolved = resolveRoutePlan(plan(request, [{...unbound('n'),
      kind: 'deterministic', instruction: '2+3'}]), request, catalog, Date.now());
    assert.equal(resolved.decisions.n.resolved_candidate_id, 'local-exact');
    assert.equal(resolved.decisions.n.effort, 'none');
  }
});

test('a missing native ceiling holds only that model reference, not another explicit family or exact effort', async t => {
  const dir = await fixture(t);
  const options = {claude: [], codex: [['gpt-6-astra', ['low', 'max']], ['gpt-6-sol', ['low', 'max']],
    ['gpt-6-luna', ['low']]], tiers: {...TIERS, 'gpt-6-sol': 'frontier'}};
  const decorate = catalog => ({...nativeCeilings(catalog, {codex: {'gpt-6-astra': 'ultra'}}),
    exclusions: [{provider: 'codex', reason: 'reference_unavailable', count: 1}]});
  const request = task(dir, 'A native supported setting is not a signed executable row');
  const catalog = decorate(tierCatalog(request, options));
  assert.throws(() => resolve(request, catalog), /no_dispatchable_candidate/);
  assert.throws(() => resolve(request, catalog, 'certified'), /no_dispatchable_candidate/);
  assert.equal(catalog.candidates.some(candidate => candidate.effort === 'ultra'), false);
  for (const effort of [null, 'low', 'max']) {
    const family = {...catalog, routing_intent: {model_family: 'sol', effort}};
    assert.equal(route(resolve(request, family).decisions.n),
      `openai_codex/gpt-6-sol/${effort ?? 'max'}`, 'another family does not inherit Astra\'s missing ultra');
  }
  for (const effort of ['low', 'max'])
    assert.equal(resolve(request, {...catalog, routing_intent: {model_family: 'astra', effort}}).decisions.n.effort,
      effort, 'an exact signed owner effort overrides the automatic native ceiling');
  const held = await run(t, dir, 'model ceiling missing guard', {
    refresh: value => decorate(tierCatalog(value, options)), execute: () => { throw Error('must not dispatch'); }});
  assert.deepEqual(held.tuples, []);
  assert.equal(held.done.state, 'held');
  assert.match(held.done.error, /^no_dispatchable_candidate:openai_codex=/);
});

test('a legacy catalog with native metadata still honours the Auto provider reference boundary', () => {
  const request = task('/tmp', 'Do not turn a remaining workhorse into the missing frontier');
  const catalog = {...nativeCeilings(tierCatalog(request, {claude: [], codex: [['gpt-6.1-sol', ['low', 'max']]]})),
    exclusions: [{provider: 'codex', reason: 'reference_unavailable', count: 1}]};
  delete catalog.model_tiers;
  assert.throws(() => resolve(request, catalog), /no_dispatchable_candidate/,
    'the optional metadata map cannot erase an ordinary Auto reference_unavailable boundary');
  const family = {...catalog, routing_intent: {model_family: 'sol', effort: null}};
  assert.equal(route(resolve(request, family).decisions.n), 'openai_codex/gpt-6.1-sol/max');
  for (const effort of ['low', 'max']) {
    assert.equal(resolve(request, {...catalog, routing_intent: {model_family: null, effort}}).decisions.n.effort,
      effort, 'exact owner effort still wins');
  }
});

test('same-pool explicit fan-out keeps each family native ceiling and its own max or low word', () => {
  const routes = [{surface: 'codex', instruction: 'Analyze A'}, {surface: 'codex', instruction: 'Analyze B'}];
  const request = explicitTask('/tmp', routes);
  const options = {claude: [], codex: [['gpt-6-astra', ['low', 'max']], ['gpt-6-sol', ['low', 'max']]],
    tiers: {...TIERS, 'gpt-6-sol': 'frontier'}};
  const catalog = nativeCeilings(tierCatalog(request, options), {codex: {'gpt-6-astra': 'ultra'}});
  const bind = (value, intents, indices = [0, 1]) => Object.values(resolveRoutePlan(plan(request,
    indices.map(index => routeNode(index, routes))), request,
  {...value, explicit_route_intents: intents}, Date.now()).decisions).map(d => `${d.model}/${d.effort}`);
  const families = [{model_family: 'astra', effort: null}, {model_family: 'sol', effort: null}];
  assert.throws(() => bind(catalog, families), /no_dispatchable_candidate/,
    'Astra has no signed native-highest row; Sol/max is not its substitute');
  assert.deepEqual(bind(catalog, families, [1]), ['gpt-6-sol/max']);
  assert.deepEqual(bind(catalog, [{model_family: 'astra', effort: 'max'}, families[1]]),
    ['gpt-6-astra/max', 'gpt-6-sol/max']);
  assert.deepEqual(bind(catalog, [{model_family: 'astra', effort: 'low'}, {model_family: 'sol', effort: 'low'}]),
    ['gpt-6-astra/low', 'gpt-6-sol/low']);
  const absentSolMax = {...catalog, candidates: catalog.candidates.filter(candidate =>
    !(candidate.model === 'gpt-6-sol' && candidate.effort === 'max'))};
  assert.throws(() => bind(absentSolMax, [{model_family: 'astra', effort: 'max'}, families[1]]), /no_dispatchable_candidate/);
  assert.deepEqual(bind(absentSolMax, [{model_family: 'astra', effort: 'max'}, {model_family: 'sol', effort: 'low'}]),
    ['gpt-6-astra/max', 'gpt-6-sol/low']);
});

// ---- Pure resolver --------------------------------------------------------

test('tier lists are the owner contract: the certified descent list and the reference', () => {
  assert.deepEqual(MODEL_TIERS, ['frontier', 'workhorse', 'efficient', 'fast']);
  assert.deepEqual(TIER_ROUTES, {
    trivial: [['fast', 'low'], ['efficient', 'low'], ['workhorse', 'low']],
    deep: [['frontier', 'reference']]});
  assert.ok(Object.isFrozen(TIER_ROUTES) && Object.isFrozen(TIER_ROUTES.trivial));
});

test('R0: an uncertified node binds the reference whatever its grade; a certified one the cheapest certified tier', () => {
  const request = task('/tmp', 'Answer one question');
  const codexFirst = tierCatalog(request), claudeFirst = tierCatalog(request, {first: 'claude'});
  // Uncertified: the frontier reference at its highest admitted effort.
  const deep = resolve(request, codexFirst);
  assert.equal(route(deep.decisions.n), 'openai_codex/gpt-6-astra/max');
  assert.equal(deep.decisions.n.tier, 'frontier');
  assert.equal(deep.decisions.n.route_class, 'deep');
  assert.equal(deep.decisions.n.reason, 'resolver;route_reference;admitted_reference_uncertified;tier_frontier;' +
    'pool_rank_0;effort_max;agent_surface');
  assert.equal(Object.hasOwn(deep.decisions.n, 'ladder'), false, 'the reference itself has nothing to escalate to');
  assert.deepEqual(deep.routes.n, {kind: 'reference', reference_effort: 'max', ladder: null});
  assert.equal(route(resolve(request, claudeFirst).decisions.n), 'anthropic_shared/claude-fable-5-1/max');
  // A model-authored grade certifies nothing: every grade binds the reference.
  for (const routeClass of ['trivial', 'standard', 'deep', 'flagship', null, 7]) {
    const graded = resolveRoutePlan(plan(request, [{...unbound('n'), route_class: routeClass}]), request,
      codexFirst, Date.now()).decisions.n;
    assert.equal(route(graded), 'openai_codex/gpt-6-astra/max', String(routeClass));
    assert.equal(graded.route_class, 'deep');
  }
  // Certified: fast/low (Codex luna). Claude's fast model, Haiku 4.5, has no
  // effort control (its one profile is "none"): it satisfies fast/low.
  const trivial = resolve(request, codexFirst, 'certified');
  assert.equal(route(trivial.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.equal(trivial.decisions.n.tier, 'fast');
  assert.equal(trivial.decisions.n.route_class, 'trivial');
  assert.equal(trivial.decisions.n.reason, 'resolver;route_tier;admitted_certified_verifier;tier_list_0;tier_fast;' +
    'pool_rank_0;effort_low;escalation_reference_same_pool;agent_surface');
  assert.deepEqual(trivial.decisions.n.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'gpt-6-astra'});
  assert.deepEqual(trivial.routes.n, {kind: 'tier', reference_effort: 'max', ladder: certifiedLadder(
    {model: 'gpt-6-luna', effort: 'low'}, {model: 'gpt-6-astra', effort: 'max', id: key('gpt-6-astra', 'max', 'read_only', 'codex')})});
  const claudeTrivial = resolve(request, claudeFirst, 'certified').decisions.n;
  assert.equal(route(claudeTrivial), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.equal(claudeTrivial.reason, 'resolver;route_tier;admitted_certified_verifier;tier_list_0;tier_fast;' +
    'pool_rank_0;effort_none;escalation_reference_same_pool;agent_surface');
  assert.deepEqual(claudeTrivial.ladder, {cheap_effort: 'none', reference_effort: 'max',
    cheap_model: 'claude-haiku-4-5-20251001', reference_model: 'claude-fable-5-1'});
  // A model with no tier is never chosen: gpt-6-sol and daybreak never run.
  for (const admission of ['reference', 'certified'])
    assert.ok(!['gpt-6-sol', 'gpt-daybreak-blue-latest'].includes(resolve(request, codexFirst, admission).decisions.n.model));
});

test('a writer or deterministic node is never certified: a writer binds the reference writer row, deterministically', () => {
  const request = task('/tmp', 'Change one file', {write: true});
  const catalog = tierCatalog(request, {write: true});
  const proposed = plan(request, [unbound('w', {scope: 'workspace_write'})]);
  const first = resolveRoutePlan(structuredClone(proposed), request, catalog, 1_000_000, {verifierRegistry: CERTIFY});
  assert.deepEqual(first, resolveRoutePlan(structuredClone(proposed), request, catalog, 1_000_000, {verifierRegistry: CERTIFY}));
  const write = first.decisions.w;
  assert.equal(route(write), 'openai_codex/gpt-6-astra/max');
  assert.equal(write.route_class, 'deep');
  assert.match(write.reason, /^resolver;route_reference;admitted_reference_uncertified;tier_frontier;/);
  assert.equal(Object.hasOwn(write, 'ladder'), false);
  assert.deepEqual(first.routes.w, {kind: 'reference', reference_effort: 'max', ladder: null});
  assert.equal(first.plan.nodes[0].candidate_id, key('gpt-6-astra', 'max', 'workspace_write', 'codex'));
  // A node with unknown keys is still refused.
  assert.throws(() => resolveRoutePlan(plan(request, [{...unbound('n'), guess: 1}]), request, catalog, Date.now()),
    /plan_node_invalid/);
});

test('owner words fix the reference those words leave (R10): never a host-chosen lower model or effort', () => {
  const request = task('/tmp', '최대 리즈닝으로 해줘');
  // The native builder already kept only the max rows for "최대 리즈닝".
  const maxOnly = (model, effort) => effort === 'max';
  const filtered = (models, keep) => models.map(([model, efforts]) => [model, efforts.filter(e => keep(model, e))])
    .filter(([, efforts]) => efforts.length);
  const maxCatalog = tierCatalog(request, {codex: filtered(CODEX, maxOnly), claude: filtered(CLAUDE, maxOnly),
    intent: {effort: 'max', model_family: null}});
  // An effort word: the frontier at that effort, certified or not.
  for (const admission of ['reference', 'certified']) {
    const decided = resolve(request, maxCatalog, admission);
    assert.equal(route(decided.decisions.n), 'openai_codex/gpt-6-astra/max', admission);
    assert.match(decided.decisions.n.reason, /^resolver;route_explicit;intent_effort_max;admitted_reference_owner_words;/);
    assert.deepEqual(decided.routes.n, {kind: 'explicit', reference_effort: 'max', ladder: null});
  }
  // A family word: that family at its highest admitted effort.
  const opus = tierCatalog(request, {codex: [], claude: CLAUDE.filter(([model]) => ['claude-opus-5-5', 'opus'].includes(model)),
    intent: {effort: null, model_family: 'opus'}});
  const opusRoute = resolve(request, opus, 'certified');
  assert.equal(route(opusRoute.decisions.n), 'anthropic_shared/claude-opus-5-5/max');
  assert.match(opusRoute.decisions.n.reason, /^resolver;route_explicit;intent_family_opus;admitted_reference_owner_words;/);
  assert.deepEqual(opusRoute.routes.n, {kind: 'explicit', reference_effort: 'max', ladder: null});
  // A named family with no tier (daybreak) is usable only because the owner named it.
  const daybreak = tierCatalog(request, {claude: [], codex: CODEX.filter(([model]) => model === 'gpt-daybreak-blue-latest'),
    intent: {effort: null, model_family: 'daybreak'}});
  const named = resolve(request, daybreak).decisions.n;
  assert.equal(route(named), 'openai_codex/gpt-daybreak-blue-latest/max');
  assert.equal(named.tier, null);
  // Both an effort and a family: exactly that tuple, explicit, never escalated.
  const exact = tierCatalog(request, {codex: [], claude: [['claude-opus-5-5', ['xhigh']], ['opus', ['xhigh']]],
    intent: {effort: 'xhigh', model_family: 'opus'}});
  assert.equal(resolve(request, exact, 'certified').decisions.n.effort, 'xhigh');
  assert.deepEqual(resolve(request, exact, 'certified').routes.n, {kind: 'explicit', reference_effort: 'xhigh', ladder: null});
});

test('a pool that cannot serve the certified tier is skipped; inside a pool the first dispatchable entry wins', () => {
  const request = task('/tmp', 'Answer one question');
  // Codex offers only its frontier model: no certified tier there, so Claude serves it.
  const astraOnly = tierCatalog(request, {codex: CODEX.filter(([model]) => model === 'gpt-6-astra')});
  const skipped = resolve(request, astraOnly, 'certified').decisions.n;
  assert.equal(route(skipped), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.match(skipped.reason, /;tier_list_0;tier_fast;pool_rank_1;skipped_pool_rank_0_tier_unavailable;effort_none;/);
  // Inside Claude an exhausted Haiku falls to the next entry of the same
  // pool (efficient/low): sonnet by its resolved ID.
  const haikuOut = tierCatalog(request, {codex: CODEX.filter(([model]) => model === 'gpt-6-astra'),
    change: model => model === 'claude-haiku-4-5-20251001' ? {quota: 0} : {}});
  const sonnet = resolve(request, haikuOut, 'certified').decisions.n;
  assert.equal(route(sonnet), 'anthropic_shared/claude-sonnet-5-5/low');
  assert.match(sonnet.reason, /;tier_list_1;tier_efficient;pool_rank_1;/);
  // Inside Codex an exhausted luna falls to the next entry of the same pool
  // (workhorse/low), not to the other pool.
  const lunaOut = tierCatalog(request, {change: model => model === 'gpt-6-luna' ? {quota: 0} : {}});
  const next = resolve(request, lunaOut, 'certified').decisions.n;
  assert.equal(route(next), 'openai_codex/gpt-6.1-sol/low');
  assert.match(next.reason, /;tier_list_2;tier_workhorse;pool_rank_0;/);
  // The reference with no dispatchable Codex frontier: the Claude reference, never sol.
  const astraOut = tierCatalog(request, {change: model => model === 'gpt-6-astra' ? {availability: 'unavailable'} : {}});
  const reference = resolve(request, astraOut).decisions.n;
  assert.equal(route(reference), 'anthropic_shared/claude-fable-5-1/max');
  assert.match(reference.reason, /;pool_rank_1;skipped_pool_rank_0_reference_undispatchable;/);
  // No frontier model in Codex at all: reference_unavailable there.
  const noAstra = tierCatalog(request, {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')});
  assert.match(resolve(request, noAstra).decisions.n.reason, /;skipped_pool_rank_0_reference_unavailable;/);
  // A descent whose own pool has no frontier escalates to the other pool's.
  const other = resolve(request, noAstra, 'certified').decisions.n;
  assert.deepEqual(other.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'claude-fable-5-1'});
  assert.match(other.reason, /;escalation_reference_other_pool;/);
});

test('with no frontier model nothing runs: no reference, and no descent without one (R9, R12)', () => {
  const request = task('/tmp', 'Prove one hard property');
  const noFrontier = tierCatalog(request, {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra'),
    claude: CLAUDE.filter(([model]) => !['claude-fable-5-1', 'fable'].includes(model))});
  for (const admission of ['reference', 'certified'])
    assert.throws(() => resolve(request, noFrontier, admission),
      /no_dispatchable_candidate:read_only:reference_unavailable/, admission);
  // Only untiered models: nothing can run by tier.
  const untiered = tierCatalog(request, {claude: [], codex: CODEX.filter(([model]) =>
    ['gpt-6-sol', 'gpt-daybreak-blue-latest'].includes(model))});
  assert.deepEqual(untiered.model_tiers, {});
  assert.throws(() => resolve(request, untiered, 'certified'), /no_dispatchable_candidate:read_only:reference_unavailable/);
});

test('read-only work takes the chat row of the same model and effort, and escalates to the chat reference', () => {
  const request = task('/tmp', 'Answer briefly');
  const catalog = tierCatalog(request, {first: 'claude', chat: true});
  const resolved = resolve(request, catalog, 'certified');
  assert.equal(resolved.decisions.n.surface, 'claude-chat');
  assert.equal(route(resolved.decisions.n), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.equal(resolved.plan.nodes[0].candidate_id, key('claude-haiku-4-5-20251001', 'none', 'read_only', 'claude-chat'));
  assert.match(resolved.decisions.n.reason, /;chat_lane_same_route$/);
  assert.equal(resolved.routes.n.ladder.reference_candidate_id, key('claude-fable-5-1', 'max', 'read_only', 'claude-chat'));
  const reference = resolve(request, catalog);
  assert.equal(reference.plan.nodes[0].candidate_id, key('claude-fable-5-1', 'max', 'read_only', 'claude-chat'));
  // A verifier registered for the agent surface only never admits a chat row it would not judge.
  const agentOnly = resolveRoutePlan(plan(request, [unbound('n')]), request, catalog, Date.now(),
    {verifierRegistry: new Map([['trivial:read_only:agent', passes]])});
  assert.equal(agentOnly.decisions.n.surface, 'claude');
  assert.equal(route(agentOnly.decisions.n), 'anthropic_shared/claude-haiku-4-5-20251001/none');
});

// 2026-10-15: Haiku 4.5's CLI row has no effort control, so its one signed
// profile is "none". A certified descent binds it for the fast tier's
// concrete effort only: never under an owner effort word, never as a
// reference, never for a writer. An explicit haiku family word is the owner's
// route, writes included.
test('a model with no effort control binds the fast tier only as a certified read-only descent; a family word names it', () => {
  const request = task('/tmp', 'Answer one question', {write: true});
  const claudeOnly = (claude, options = {}) => tierCatalog(request, {first: 'claude', codex: [], claude, ...options});
  // Certified read-only: Haiku at "none", guarded by fable/max in its pool.
  const trivial = resolve(request, claudeOnly(CLAUDE), 'certified');
  assert.equal(route(trivial.decisions.n), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.deepEqual(trivial.routes.n.ladder, certifiedLadder({model: 'claude-haiku-4-5-20251001', effort: 'none'},
    {model: 'claude-fable-5-1', effort: 'max', id: key('claude-fable-5-1', 'max', 'read_only', 'claude')}));
  // A writer binds the reference writer row, never Haiku, even with Haiku
  // writer rows in the catalog.
  const writer = resolveRoutePlan(plan(request, [unbound('w', {scope: 'workspace_write'})]), request,
    claudeOnly(CLAUDE, {write: true}), Date.now(), {verifierRegistry: CERTIFY}).decisions.w;
  assert.equal(route(writer), 'anthropic_shared/claude-fable-5-1/max');
  // Never a reference: with only Haiku nothing runs, certified or not.
  const haikuOnly = claudeOnly([['claude-haiku-4-5-20251001', ['none']]], {write: true});
  for (const admission of ['reference', 'certified'])
    assert.throws(() => resolve(request, haikuOnly, admission), /no_dispatchable_candidate:read_only:reference_unavailable/);
  // An owner effort word is the owner's route: the frontier at that effort.
  const low = claudeOnly(CLAUDE, {intent: {effort: 'low', model_family: null}});
  const owned = resolve(request, low, 'certified');
  assert.equal(route(owned.decisions.n), 'anthropic_shared/claude-fable-5-1/low');
  assert.match(owned.decisions.n.reason, /^resolver;route_explicit;intent_effort_low;admitted_reference_owner_words;/);
  // A family word naming Haiku binds it: the owner's route, read or write.
  const family = claudeOnly(CLAUDE, {write: true, intent: {effort: null, model_family: 'haiku'}});
  const named = resolve(request, family);
  assert.equal(route(named.decisions.n), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.match(named.decisions.n.reason, /^resolver;route_explicit;intent_family_haiku;admitted_reference_owner_words;/);
  assert.deepEqual(named.routes.n, {kind: 'explicit', reference_effort: 'none', ladder: null});
  const namedWrite = resolveRoutePlan(plan(request, [unbound('w', {scope: 'workspace_write'})]), request,
    family, Date.now());
  assert.equal(route(namedWrite.decisions.w), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.equal(namedWrite.plan.nodes[0].candidate_id, key('claude-haiku-4-5-20251001', 'none', 'workspace_write', 'claude'));
  assert.deepEqual(namedWrite.routes.w, {kind: 'explicit', reference_effort: 'none', ladder: null});
  // Only a model whose rows are ALL "none" has no effort control: a "none"
  // row beside a real effort satisfies nothing but "none".
  const mixed = claudeOnly([['claude-fable-5-1', ['max']], ['claude-sonnet-5-5', ['low']],
    ['claude-haiku-4-5-20251001', ['none', 'medium']]]);
  assert.equal(route(resolve(request, mixed, 'certified').decisions.n), 'anthropic_shared/claude-sonnet-5-5/low');
});

// ---- Durable runtime: REVAS escalation --------------------------------------

async function run(t, dir, name, {certified = true, execute, extras = {}, catalog = {}, verifierRegistry,
                                  refresh = null} = {}) {
  const request = task(dir, 'Answer one question: ' + name, extras);
  const tickets = [];
  let refreshes = 0;
  const registry = verifierRegistry ?? (certified ? CERTIFY : null);
  const runtime = await createRCCRuntime({stateDir: join(dir, name.replace(/\W+/g, '-')),
    ...(registry ? {verifierRegistry: registry} : {}),
    catalog: async value => { refreshes++; return refresh ? refresh(value, refreshes) : tierCatalog(value, catalog); },
    plan: async () => plan(request, [unbound('n', extras.write ? {scope: 'workspace_write'} : {})]),
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

test('a certified answer its source accepts is adopted; nothing escalates', async t => {
  const dir = await fixture(t);
  const ok = await run(t, dir, 'adopted', {execute: ticket => execution(ticket)});
  assert.equal(ok.done.state, 'completed', ok.done.error);
  assert.deepEqual(ok.tuples, ['gpt-6-luna/low']);
  assert.equal(ok.done.result.output, 'answer from gpt-6-luna/low');
  const records = await ledger(dir, 'adopted');
  assert.deepEqual(records.map(record => [record.tier, record.effort, record.route_kind, record.escalated,
    record.verifier_outcome]), [['fast', 'low', 'tier', false, 'pass']]);
  assert.deepEqual(records[0].ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'gpt-6-astra'});
  // Uncertified, the same task runs once at the reference.
  const reference = await run(t, dir, 'reference', {certified: false, execute: ticket => execution(ticket)});
  assert.deepEqual(reference.tuples, ['gpt-6-astra/max']);
  assert.equal((await ledger(dir, 'reference'))[0].route_kind, 'reference');
});

test('every failure signal escalates a certified read-only answer exactly once to the reference, uncharged', async t => {
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
    assert.match(decision.reason, /^tier_escalated_after_failure_signal;route_reference;admitted_reference_escalation;tier_frontier;same_pool;effort_max;/, name);
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

test('a failed reference or explicit verifier delivers its answer with a disclosure; no parent verifier washes it', async t => {
  const dir = await fixture(t);
  const verdicts = [
    ['false', async () => ({passed: false, reason: 'fixture rejection'})],
    ['throw', async () => { throw Error('fixture verifier unavailable'); }],
    ['malformed', async () => ({passed: 'yes'})],
  ];
  for (const routeKind of ['reference', 'explicit', 'escalated']) for (const [name, verify] of verdicts) {
    const request = task(dir, 'Verify a bounded candidate before dependent work');
    const tickets = [];
    let parentVerifierCalls = 0;
    const intent = routeKind === 'explicit' ? {model_family: 'astra', effort: 'max'} : null;
    // An escalated node keeps its certified family, so its verifier judges
    // the reference answer too; the others carry the reference family.
    const verifierRegistry = routeKind === 'escalated' ? new Map([['trivial:read_only:agent', async input =>
      input.selected_config.model === 'gpt-6-astra' ? verify() : {passed: false, reason: 'cheap rejected'}]]) :
      new Map([['deep:read_only:agent', verify]]);
    const runtime = await createRCCRuntime({stateDir: join(dir, routeKind + '-' + name), verifierRegistry,
      catalog: async value => tierCatalog(value, {intent}),
      plan: async () => plan(request, [unbound('candidate'),
        {...unbound('dependent'), dependencies: ['candidate']}], 'dependent'),
      execute: async ticket => { tickets.push(ticket); return execution(ticket); },
      verifyTask: value => { parentVerifierCalls++; return {...taskVerdict(value), task_verified: true}; }});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, 'returned_unverified', `${routeKind}/${name}`);
    assert.equal(done.error, 'child_quality_disclosed', `${routeKind}/${name}`);
    assert.equal(done.result.task_verified, false, 'a parent verifier cannot wash a disclosed child');
    assert.equal(done.result.parity_state, 'unverified');
    const candidateTickets = tickets.filter(ticket => ticket.node_id === 'candidate');
    assert.equal(candidateTickets.length, routeKind === 'escalated' ? 2 : 1,
      'no replay beyond the one existing escalation');
    const child = runtime._load(request.task_id).children.find(value => value.id === 'candidate');
    assert.equal(child.route_kind, routeKind === 'escalated' ? 'reference' : routeKind);
    assert.equal(child.state, 'completed');
    assert.equal(child.node_verifier, 'fail');
    assert.deepEqual(child.quality_disclosure.failed_check_ids, ['node_verifier']);
    assert.equal(child.output, 'answer from gpt-6-astra/max', 'the reference answer is delivered');
    assert.equal(done.children.find(value => value.id === 'candidate').quality_disclosure.failed_check_ids[0],
      'node_verifier');
    await runtime.close();
  }
});

test('a passing reference or explicit verifier releases dependent work exactly once', async t => {
  const dir = await fixture(t);
  for (const routeKind of ['reference', 'explicit']) {
    const request = task(dir, 'Verify a passing bounded candidate before dependent work');
    const tickets = [];
    const verified = [];
    const intent = routeKind === 'explicit' ? {model_family: 'astra', effort: 'max'} : null;
    const runtime = await createRCCRuntime({stateDir: join(dir, routeKind),
      verifierRegistry: new Map([['deep:read_only:agent', async input => {
        verified.push(input.node_id); return {passed: true, reason: 'fixture accepted'}; }]]),
      catalog: async value => tierCatalog(value, {intent}),
      plan: async () => plan(request, [unbound('candidate'),
        {...unbound('dependent'), dependencies: ['candidate']}], 'dependent'),
      execute: async ticket => { tickets.push(ticket.node_id); return execution(ticket); },
      verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, 'completed', done.error);
    assert.deepEqual(tickets, ['candidate', 'dependent']);
    assert.deepEqual(verified, tickets);
    assert.equal(done.result.task_verified, true);
    await runtime.close();
  }
});

test('a write is never certified or escalated: it runs at the reference with the existing no-replay semantics', async t => {
  const dir = await fixture(t);
  const write = await run(t, dir, 'write', {extras: {write: true}, catalog: {write: true},
    execute: ticket => execution(ticket, {status: 'failed', execution_verified: false, task_quality: 'failed',
      output: null, side_effects: 'possible', error: 'native_outcome_uncertain_preserved'})});
  assert.deepEqual(write.tuples, ['gpt-6-astra/max'], 'a write runs at the reference, once');
  assert.equal(write.done.state, 'effects_uncertain');
  assert.equal(write.runtime.events({schema: 1, task_id: write.request.task_id})
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
  // reference and a write keep resuming.
  const passed = await run(t, dir, 'session pass', {extras: {codexSession: 'owner-codex-thread'},
    execute: ticket => execution(ticket)});
  assert.deepEqual(passed.tickets.map(ticket => ticket.native_resume_session_id), [null]);
  const reference = await run(t, dir, 'session reference', {certified: false, extras: {codexSession: 'owner-codex-thread'},
    execute: ticket => execution(ticket)});
  assert.deepEqual(reference.tickets.map(ticket => ticket.native_resume_session_id), ['owner-codex-thread']);
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
  assert.match(decision.reason, /^tier_escalated_after_failure_signal;route_reference;admitted_reference_escalation;tier_frontier;other_pool;effort_max;/);
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
  assert.match(decision.reason, /^re_resolved_after:candidate_missing;other_pool;route_reference;admitted_reference_escalation;/);
  assert.equal(decision.tier, 'frontier');
  assert.deepEqual(decision.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'claude-fable-5-1'});
});

test('a pre-execution quota rejection re-admits a certified node and binds its descent in the other pool', async t => {
  const dir = await fixture(t);
  const result = await run(t, dir, 'quota rejected', {
    execute: (ticket, count) => count === 1 ? execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
      output: "You've hit your weekly limit", execution_verified: false, task_quality: 'failed',
      error: 'provider_quota_rejected_before_execution'}) : execution(ticket)});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'claude-haiku-4-5-20251001/none']);
  const child = result.done.children[0];
  assert.match(child.routing_decision.reason,
    /^re_resolved_after:provider_quota_rejected_before_execution;other_pool;route_tier;admitted_certified_verifier;/);
  assert.equal(child.routing_decision.ladder.reference_model, 'claude-fable-5-1');
  // Uncertified, the rejected reference moves to the other pool's reference.
  const reference = await run(t, dir, 'quota rejected reference', {certified: false,
    execute: (ticket, count) => count === 1 ? execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
      output: null, execution_verified: false, task_quality: 'failed',
      error: 'provider_quota_rejected_before_execution'}) : execution(ticket)});
  assert.deepEqual(reference.tuples, ['gpt-6-astra/max', 'claude-fable-5-1/max']);
});

// Contract repair 2026-10-17: an opaque routing HTTP 400 never established
// the old native_authorization_refused interpretation. That legacy code now
// holds (separately regressed). This synthetic positive fixture instead
// supplies the NEW native catalog's explicit unsupported tuple observation,
// before dispatch/effects. Only that precise evidence permits configuration
// repair; the same bounded movement and write-scope gates stay enforced.
const ADDED_IN_383 = new Set(['claude-opus-5-5/medium', 'claude-opus-5-5/high', 'claude-sonnet-5-5/medium',
  'claude-sonnet-5-5/high', 'claude-fable-5-1/medium', 'claude-fable-5-1/high', 'claude-haiku-4-5-20251001/none']);
const refused = ticket => execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched', side_effects: 'none',
  output: null, execution_verified: false, task_quality: 'failed', usage: null, error: 'native_configuration_unavailable'});
const olderServer = ticket => ADDED_IN_383.has(`${ticket.selected_config.model}/${ticket.selected_config.effort}`) ?
  refused(ticket) : execution(ticket);
test('verified native catalog unsupported tuples cost no budget: bounded same-scope configuration repair remains possible', async t => {
  const dir = await fixture(t);
  const result = await run(t, dir, 'skew certified', {execute: olderServer, catalog: {codex: []}});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['claude-haiku-4-5-20251001/none', 'claude-sonnet-5-5/low']);
  const child = result.done.children[0];
  assert.match(child.routing_decision.reason, /^re_resolved_after:native_configuration_unavailable;/);
  const history = result.runtime._load(result.request.task_id).children[0].attempt_history;
  assert.deepEqual(history.map(entry => [entry.state, entry.error ?? null]),
    [['verified_not_dispatched', 'native_configuration_unavailable'], ['completed', null]]);
  // Still bounded: a catalog that reports every tuple unsupported stops after
  // MAX_RE_RESOLUTIONS moves, never an unbounded walk of the catalog.
  const all = await run(t, dir, 'skew refuses all', {execute: refused, catalog: {codex: []}});
  assert.equal(all.done.state, 'failed');
  assert.equal(all.done.error, 'verified_not_dispatched_re_resolution_exhausted');
  assert.equal(all.tickets.length, 3);
  // A refusal is valid only on a not-dispatched, no-effect report.
  const laundered = await run(t, dir, 'skew dispatched refusal', {certified: false, catalog: {codex: []},
    execute: ticket => execution(ticket, {status: 'failed', dispatch_stage: 'dispatched', side_effects: 'none',
      output: null, execution_verified: false, task_quality: 'failed', error: 'native_configuration_unavailable'})});
  assert.equal(laundered.tickets.length, 1);
  assert.notEqual(laundered.done.state, 'completed');
});

// The 2026-10-14 incident, replayed (build 378, task 9e64077d): the planner
// rewrote "야 원플러스원 해봐." into a command, luna/low ran it and a tool call
// broke (native_tool_failed, 107719 input tokens), REVAS escalated to
// astra/max, and Codex refused every request with HTTP 429 before any output.
// os1 rcc-execute now reports that turn as a verified pre-execution quota
// rejection and cools astra (the next catalog: quota_backoff, Codex
// reference_unavailable). Core re-resolves the escalation to the other
// pool's reference, frees the Codex pool, and nothing is effects_uncertain.
// (Build 407 binds that node at its reference unless certified; this replay
// keeps the certified descent to cover the escalation path.)
const INCIDENT_REQUEST = '야 원플러스원 해봐.';
const INCIDENT_REWRITE = "Execute '원플러스원' (OnePlus One) command.";
const codexLimitRejected = ticket => execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched',
  side_effects: 'none', output: '', execution_verified: false, task_quality: 'failed', usage: null,
  error: 'provider_quota_rejected_before_execution'});
const astraCooled = (value, claude) => ({...tierCatalog(value, {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra'), claude}),
  exclusions: [{provider: 'codex', reason: 'quota_backoff', count: 5}, {provider: 'codex', reason: 'reference_unavailable', count: 1}]});
async function incident(t, dir, name, {claude = CLAUDE} = {}) {
  const request = task(dir, INCIDENT_REQUEST);
  const tickets = [];
  let cooled = false;
  const runtime = await createRCCRuntime({stateDir: join(dir, name), verifierRegistry: CERTIFY,
    catalog: async value => cooled ? astraCooled(value, claude) : tierCatalog(value),
    plan: async ({task: value}) => plan(value, [unbound('node-1', {instruction: INCIDENT_REWRITE})]),
    execute: async ticket => {
      tickets.push(ticket);
      if (tickets.length === 1) return execution(ticket, {error: 'native_tool_failed',
        usage: {input_tokens: 107719, output_tokens: 195}});
      if (tickets.length === 2) { cooled = true; return codexLimitRejected(ticket); }
      return execution(ticket);
    }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  const history = runtime._load(request.task_id).children[0].attempt_history;
  return {request, runtime, tickets, done, history,
    tuples: tickets.map(ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`),
    kinds: runtime.events({schema: 1, task_id: request.task_id}).map(event => event.kind),
    leases: runtime.db.prepare('SELECT pool_key FROM quota_leases').all().map(item => item.pool_key)};
}

test('incident replay: a 429 no-output escalation re-resolves to the other reference; no effects_uncertain, pool freed', async t => {
  const dir = await fixture(t);
  const result = await incident(t, dir, 'incident');
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max', 'claude-fable-5-1/max']);
  assert.equal(result.done.result.output, 'answer from claude-fable-5-1/max');
  // One indivisible task: every attempt runs the owner's words, never the rewrite.
  assert.deepEqual(result.tickets.map(ticket => [ticket.instruction, ticket.objective]),
    Array(3).fill([INCIDENT_REQUEST, INCIDENT_REQUEST]));
  const admitted = result.runtime.events({schema: 1, task_id: result.request.task_id})
    .find(event => event.kind === 'plan_admitted').snapshot.children[0].routing_decision;
  assert.match(admitted.reason, /^resolver;route_tier;admitted_certified_verifier;.*;instruction_host_locked$/);
  const decision = result.done.children[0].routing_decision;
  // The escalation and the re-resolution rebuilt the decision; it still says
  // the owner's words replaced the planner's rewrite.
  assert.match(decision.reason,
    /^re_resolved_after:provider_quota_rejected_before_execution;other_pool;route_reference;.*;instruction_host_locked$/);
  const escalated = result.runtime.events({schema: 1, task_id: result.request.task_id})
    .filter(event => event.kind === 'ladder_escalated_to_reference').at(-1)?.snapshot.children[0].routing_decision;
  assert.match(escalated?.reason ?? '', /^tier_escalated_after_failure_signal;.*;instruction_host_locked$/);
  assert.equal(route(decision), 'anthropic_shared/claude-fable-5-1/max');
  assert.deepEqual(decision.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6-luna',
    reference_model: 'claude-fable-5-1'}, 'the escalation stays reference-only where it moved');
  assert.deepEqual(result.history.map(entry => entry.state), ['ladder_not_returned', 'verified_not_dispatched', 'completed']);
  assert.equal(result.history[1].error, 'provider_quota_rejected_before_execution');
  assert.ok(!result.kinds.some(kind => kind.includes('effects_uncertain')), result.kinds.join(','));
  assert.deepEqual(result.leases, [], 'no pool lease outlives the settled attempts');
  // The owner's next question on Codex runs now (build 378 held it with
  // quota_pool_effects_uncertain); astra is cooled, so the certified descent
  // binds luna, guarded by the Claude reference.
  const next = task(dir, '너 라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐. 엄청 간단한 알제브라 계산 있잖아.');
  await result.runtime.submit(next);
  const second = await wait(result.runtime, next);
  assert.equal(second.state, 'completed', second.error);
  assert.equal(result.tickets.at(-1).instruction, next.request);
  assert.equal(result.tickets.at(-1).selected_config.model, 'gpt-6-luna');
});

test('incident replay with no other reference: held with the typed reason, never effects_uncertain', async t => {
  const dir = await fixture(t);
  const result = await incident(t, dir, 'incident-no-claude', {claude: []});
  assert.equal(result.done.state, 'held');
  assert.equal(result.done.error, 'no_dispatchable_candidate:read_only:reference_unavailable');
  assert.deepEqual(result.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max'], 'nothing lower stands in for the reference');
  assert.deepEqual(result.history.map(entry => entry.state), ['ladder_not_returned', 'verified_not_dispatched']);
  assert.ok(!result.kinds.some(kind => kind.includes('effects_uncertain')), result.kinds.join(','));
  assert.deepEqual(result.leases, []);
});

test('with no frontier model nothing dispatches; model_tiers is strictly shaped', async t => {
  const dir = await fixture(t);
  const noFrontier = {codex: CODEX.filter(([model]) => model !== 'gpt-6-astra'),
    claude: CLAUDE.filter(([model]) => !['claude-fable-5-1', 'fable'].includes(model))};
  for (const certified of [false, true]) {
    const held = await run(t, dir, 'no frontier held ' + certified, {certified, catalog: noFrontier,
      execute: () => { throw Error('must not dispatch'); }});
    assert.equal(held.done.state, 'held');
    assert.equal(held.done.error, 'no_dispatchable_candidate:anthropic_shared=no_reference,openai_codex=no_reference');
    assert.equal(held.tickets.length, 0);
  }
  for (const [name, tiers] of [['unknown tier', {'gpt-6-luna': 'flagship'}], ['absent model', {'gpt-9': 'fast'}],
    ['not an object', ['fast']]]) {
    const bad = await run(t, dir, name, {refresh: value => ({...tierCatalog(value), model_tiers: tiers}),
      execute: () => { throw Error('must not dispatch'); }});
    assert.equal(bad.done.state, 'held', name); assert.equal(bad.done.error, 'catalog_binding_invalid', name);
  }
  // Nothing tiered: held before planning with the per-pool reason.
  const untiered = await run(t, dir, 'untiered', {catalog: {claude: [],
    codex: CODEX.filter(([model]) => model === 'gpt-6-sol')}, execute: () => { throw Error('must not dispatch'); }});
  assert.equal(untiered.done.error, 'no_dispatchable_candidate:openai_codex=no_reference');
});

// ---- Review round: guards, budgets and the runnable reference ----------------

test('a certified descent whose reference vanished before its failure is held, never adopted or shown', async t => {
  const dir = await fixture(t);
  const codexOnly = {claude: [], codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')};
  // Bind time: astra can dispatch (the descent's escalation target). It is
  // gone from every later catalog, so the failed answer has nowhere to go:
  // the escalation is admitted on the bound row, and its dispatch-time
  // re-resolution finds no reference anywhere and holds.
  const vanishing = (value, count) => tierCatalog(value, count === 1 ? {claude: []} : codexOnly);
  const failures = [['whitespace answer', {output: '  \n '}],
    ['failed after dispatch, no effects', {status: 'failed', dispatch_stage: 'dispatched', side_effects: 'none',
      execution_verified: false, task_quality: 'failed', output: null, error: 'native_outcome_uncertain_preserved'}],
    ['native tool failure', {error: 'native_tool_failed'}]];
  for (const [name, failure] of failures) {
    const held = await run(t, dir, 'vanished ' + name, {refresh: vanishing, execute: ticket => execution(ticket, failure)});
    assert.deepEqual(held.tuples, ['gpt-6-luna/low'], name);
    assert.equal(held.done.state, 'held', `${name}: never adopted, never effects_uncertain`);
    assert.equal(held.done.error, 'no_dispatchable_candidate:read_only:reference_unavailable', name);
    assert.equal(held.done.result, null, name);
    assert.equal(held.done.children[0].output_summary, null, `${name}: the cheaper output is never shown`);
  }
  // A passing descent is adopted as before.
  const ok = await run(t, dir, 'vanished pass', {refresh: vanishing, execute: ticket => execution(ticket)});
  assert.equal(ok.done.state, 'completed', ok.done.error);
  assert.equal(ok.done.result.output, 'answer from gpt-6-luna/low');
  // When a frontier row is back by the time the descent fails, the guard
  // escalates to it (re-resolved at that time).
  const back = await run(t, dir, 'vanished then back', {
    refresh: (value, count) => tierCatalog(value, count === 2 ? codexOnly : {claude: []}),
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
  const cheap = new Set(['gpt-6-luna', 'claude-haiku-4-5-20251001']);
  const runtime = await createRCCRuntime({stateDir: join(dir, 'union'), verifierRegistry: CERTIFY,
    catalog: async value => tierCatalog(value),
    plan: async () => plan(request, [unbound('a'), unbound('b'), {...unbound('d'), dependencies: ['a', 'b']}], 'd'),
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
  assert.deepEqual(byNode('b'), ['claude-haiku-4-5-20251001/none', 'claude-fable-5-1/max']);
  // ~800 ms of overlapping cheap time is exempt once (not ~1600 ms), so by
  // the time both escalations finish the real budget is spent.
  assert.deepEqual(byNode('d'), [], 'the dependent node must not dispatch on double-counted exempt time');
  assert.equal(done.state, 'held');
  assert.equal(done.error, 'task_duration_budget_exhausted');
});

test('a reference or explicit answer with a recorded tool failure is delivered unchanged (only a descent escalates)', async t => {
  const dir = await fixture(t);
  const reference = await run(t, dir, 'reference tool failed', {certified: false,
    execute: ticket => execution(ticket, {error: 'native_tool_failed'})});
  assert.equal(reference.done.state, 'completed', reference.done.error);
  assert.deepEqual(reference.tuples, ['gpt-6-astra/max']);
  assert.equal(reference.done.result.output, 'answer from gpt-6-astra/max');
});

test('a task whose only runnable rows bind no reference is held before planning, with the per-pool cause', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Change one file', {write: true});
  let planned = 0;
  // Writer rows of the fast tier only: no reference anywhere.
  const runtime = await createRCCRuntime({stateDir: join(dir, 'fast-writer'),
    catalog: async value => {
      const catalog = tierCatalog(value, {write: true, claude: [], codex: CODEX.filter(([model]) => model === 'gpt-6-luna')});
      return {...catalog, candidates: catalog.candidates.filter(c => c.scope === 'workspace_write')};
    },
    plan: async () => { planned++; return plan(request, [unbound('w', {scope: 'workspace_write'})]); },
    execute: async () => { throw Error('must not dispatch'); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'held');
  assert.equal(done.error, 'no_dispatchable_candidate:openai_codex=no_reference');
  assert.equal(planned, 0, 'no wasted planner call');
});

test('a certified node with no dispatchable certified tuple binds the reference itself, never a hold', async t => {
  const request = task('/tmp', 'what is 1+1');
  // Haiku, Sonnet and Opus on quota_backoff: only the Claude frontier rows remain.
  const fableOnly = tierCatalog(request, {first: 'claude', chat: true, codex: [],
    claude: CLAUDE.filter(([model]) => ['claude-fable-5-1', 'fable'].includes(model))});
  const certified = resolve(request, fableOnly, 'certified');
  assert.equal(route(certified.decisions.n), 'anthropic_shared/claude-fable-5-1/max');
  assert.equal(certified.decisions.n.surface, 'claude-chat');
  assert.equal(certified.decisions.n.route_class, 'deep');
  assert.equal(certified.decisions.n.reason, 'resolver;route_reference;admitted_certified_verifier;' +
    'certified_tuple_undispatchable;tier_frontier;pool_rank_0;effort_max;chat_lane_same_route');
  assert.equal(Object.hasOwn(certified.decisions.n, 'ladder'), false, 'the reference itself never escalates');
  assert.deepEqual(certified.routes.n, {kind: 'reference', reference_effort: 'max', ladder: null});
  // A workhorse below the reference at a non-certified effort is never bound.
  const solMedium = tierCatalog(request, {claude: [], codex: [['gpt-6-astra', ['max']], ['gpt-6.1-sol', ['medium']]]});
  assert.equal(route(resolve(request, solMedium, 'certified').decisions.n), 'openai_codex/gpt-6-astra/max');
  // A certified entry in ANY pool wins over the reference in the first pool.
  const mixed = tierCatalog(request, {codex: CODEX.filter(([model]) => model === 'gpt-6-astra')});
  assert.equal(route(resolve(request, mixed, 'certified').decisions.n), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  const dir = await fixture(t);
  const result = await run(t, dir, 'frontier only certified', {catalog: {first: 'claude', codex: [],
    claude: CLAUDE.filter(([model]) => ['claude-fable-5-1', 'fable'].includes(model))}, execute: ticket => execution(ticket)});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tuples, ['claude-fable-5-1/max']);
  assert.match(result.done.children[0].routing_decision.reason, /;certified_tuple_undispatchable;/);
});

// ---- Review round 2: explicit fan-outs, owner words, stale guards, ledger, quota -

// The owner's own fan-out test: "1+1 Codex chat한테. 3+3 Claude Code한테.
// 4+4 Claude한테." (RouteFanout: Codex chat -> codex, Claude Code -> claude,
// Claude -> claude-chat). Each named route runs that surface's reference,
// with that route's own words; the host builds the nodes, no model grades.
// Text payloads with no exact answer: a named route binds its surface's
// reference (an exact arithmetic payload descends under its exact check;
// see openclaw-rcc-admission.test.mjs).
const FANOUT = [{surface: 'codex', instruction: 'Explain the interval rule.'},
  {surface: 'claude', instruction: 'Explain the merge rule.'}, {surface: 'claude-chat', instruction: 'What does co mean?'}];
function explicitTask(dir, routes, extras = {}) {
  const request = task(dir, '1+1 Codex chat한테. 3+3 Claude Code한테. 4+4 Claude한테.', extras);
  request.mode = 'explicit_routing_test';
  request.host_context = {...request.host_context, explicit_routes: routes};
  request.source_fingerprint = hostContextFingerprint(request.host_context);
  return request;
}
// The production profiles plus their admitted above-max efforts; the same
// reference rule applies to an explicit route's own surface.
const WITH_ULTRA = CODEX.map(([model, efforts]) => [model,
  ['gpt-6-astra', 'gpt-6.1-sol'].includes(model) ? [...efforts, 'ultra'] : efforts]);
const routeNode = (index, routes = FANOUT, extras = {}) => ({id: `requested-${index + 1}`,
  instruction: routes[index].instruction, dependencies: [], kind: 'agent',
  scope: 'read_only', owned_paths: [], context_refs: [], ...extras});

test('an explicit fan-out binds each named surface\'s reference tuple; no grade or certificate lowers it', async t => {
  const dir = await fixture(t);
  const request = explicitTask(dir, FANOUT);
  const catalog = tierCatalog(request, {codex: WITH_ULTRA, chat: true});
  const resolved = resolveRoutePlan(plan(request, FANOUT.map((_, index) => routeNode(index, FANOUT,
    {route_class: 'trivial'}))), request, catalog, Date.now(), {verifierRegistry: CERTIFY});
  assert.deepEqual(Object.values(resolved.decisions).map(d => `${d.surface}:${d.model}/${d.effort}`),
    ['codex:gpt-6-astra/ultra', 'claude:claude-fable-5-1/max', 'claude-chat:claude-fable-5-1/max']);
  assert.match(resolved.decisions['requested-1'].reason,
    /^resolver;route_reference;explicit_route_surface_codex;admitted_reference_owner_words;tier_frontier;/);
  assert.ok(Object.values(resolved.routes).every(value => value.ladder === null));
  // A node that names no route, a changed payload or a dropped GPT route
  // never gets a surface from the host.
  for (const [name, node] of [['unknown ordinal', {...routeNode(0), id: 'requested-7'}],
    ['changed payload', {...routeNode(0), instruction: 'Explain another rule.'}],
    ['free id', {...routeNode(0), id: 'route-1'}]])
    assert.throws(() => resolveRoutePlan(plan(request, [node]), request, catalog, Date.now()),
      /explicit_route_binding_mismatch/, name);

  // Durable runtime with the host-built plan: three tickets, each on its
  // named surface at its reference.
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'fanout'), hostAutoPlan: true,
    catalog: async value => tierCatalog(value, {codex: WITH_ULTRA, chat: true}),
    execute: async ticket => { tickets.push(ticket); return execution(ticket); }, verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.deepEqual(tickets.map(ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}/` +
    ticket.selected_config.effort).sort(),
  ['claude-chat:claude-fable-5-1/max', 'claude:claude-fable-5-1/max', 'codex:gpt-6-astra/ultra']);
  assert.deepEqual(done.children.map(child => child.requested_surface), FANOUT.map(route => route.surface));
  assert.ok(done.children.every(child => child.routing_decision.route_class === 'deep'));
  const records = (await readFile(join(dir, 'fanout', 'routing-ledger', 'routing-ledger.jsonl'), 'utf8')).trim()
    .split('\n').map(line => JSON.parse(line));
  assert.ok(records.every(record => record.route_kind === 'explicit_route' && record.route_class === 'deep' &&
    record.ladder === null && record.escalation_outcome === null));
});

test('an explicit route never descends or moves: a failed answer stays on the surface the owner named', async t => {
  const dir = await fixture(t);
  const routes = [FANOUT[0], FANOUT[2]];
  const request = explicitTask(dir, routes);
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: join(dir, 'explicit-failed'), hostAutoPlan: true,
    verifierRegistry: CERTIFY, catalog: async value => tierCatalog(value, {codex: WITH_ULTRA, chat: true}),
    execute: async ticket => { tickets.push(ticket); return execution(ticket, {output: ''}); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.notEqual(done.state, 'completed');
  assert.deepEqual(tickets.map(ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}`).sort(),
    ['claude-chat:claude-fable-5-1', 'codex:gpt-6-astra'], 'one attempt per named surface, at its reference');
  assert.equal(runtime.events({schema: 1, task_id: request.task_id})
    .some(event => event.kind === 'ladder_escalated_to_reference'), false);
});

test("an explicit route's own effort or model words bind that route only; the automatic reference is the highest admitted row", () => {
  const request = explicitTask('/tmp', [FANOUT[0], FANOUT[1]]);
  const base = tierCatalog(request, {codex: WITH_ULTRA});
  const routes = [FANOUT[0], FANOUT[1]];
  const bind = intents => Object.values(resolveRoutePlan(plan(request,
    routes.map((_, index) => routeNode(index, routes))), request,
  {...base, explicit_route_intents: intents}, Date.now()).decisions).map(d => `${d.model}/${d.effort}`);
  assert.deepEqual(bind([null, null]), ['gpt-6-astra/ultra', 'claude-fable-5-1/max']);
  // "최대 리즈닝으로 1+1": that route runs the frontier at max; the other is untouched.
  assert.deepEqual(bind([{effort: 'max', model_family: null}, null]), ['gpt-6-astra/max', 'claude-fable-5-1/max']);
  assert.deepEqual(bind([null, {effort: 'low', model_family: null}]), ['gpt-6-astra/ultra', 'claude-fable-5-1/low']);
  // A route word naming Haiku binds it (the named family's one route).
  assert.deepEqual(bind([null, {effort: null, model_family: 'haiku'}]), ['gpt-6-astra/ultra', 'claude-haiku-4-5-20251001/none']);
  // A route word naming astra: that family at its highest admitted effort.
  assert.deepEqual(bind([{effort: null, model_family: 'astra'}, null]), ['gpt-6-astra/ultra', 'claude-fable-5-1/max']);
  assert.deepEqual(bind([{effort: 'max', model_family: 'astra'}, null]), ['gpt-6-astra/max', 'claude-fable-5-1/max']);
  // A route whose family has no row on its surface holds: never a substitute.
  assert.throws(() => bind([{effort: null, model_family: 'fable'}, null]), /no_dispatchable_candidate:read_only:deep/);
});

test('an effort-only owner word binds the frontier at that effort and resumes the owner thread; nothing escalates', async t => {
  const dir = await fixture(t);
  const maxOnly = models => models.map(([model, efforts]) => [model, efforts.filter(effort => effort === 'max')])
    .filter(([, efforts]) => efforts.length);
  const result = await run(t, dir, 'effort only', {extras: {codexSession: 'owner-codex-thread'},
    refresh: value => tierCatalog(value, {codex: maxOnly(CODEX), claude: maxOnly(CLAUDE),
      intent: {effort: 'max', model_family: null}}),
    execute: ticket => execution(ticket)});
  assert.equal(result.done.state, 'completed', result.done.error);
  assert.deepEqual(result.tickets.map(ticket => [`${ticket.selected_config.model}/${ticket.selected_config.effort}`,
    ticket.native_resume_session_id]), [['gpt-6-astra/max', 'owner-codex-thread']]);
  // A route the owner's words fix exactly (family AND effort) stays explicit:
  // it resumes the owner's thread and is never escalated, even when it fails.
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
  // The refresh before the cheap dispatch observes astra valid for ~400 ms;
  // the cheap attempt runs 700 ms and fails. The reference observed then still runs.
  const stale = await run(t, dir, 'stale bound catalog', {
    refresh: (value, count) => count === 1 ? tierCatalog(value, {claude: []}) :
      shortLived(tierCatalog(value, {claude: []}), 400),
    execute: async (ticket, count) => { if (count === 1) { await sleep(700); return execution(ticket, {output: ' '}); }
      return execution(ticket); }});
  assert.equal(stale.done.state, 'completed', stale.done.error);
  assert.deepEqual(stale.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  // The pre-dispatch refresh lost the frontier row, but it is back when the
  // cheap attempt fails: the guard refreshes once and escalates to it.
  const back = await run(t, dir, 'refreshed at failure', {
    refresh: (value, count) => tierCatalog(value, count === 2 ? codexOnly : {claude: []}),
    execute: (ticket, count) => count === 1 ? execution(ticket, {output: ''}) : execution(ticket)});
  assert.equal(back.done.state, 'completed', back.done.error);
  assert.deepEqual(back.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.ok(back.runtime.events({schema: 1, task_id: back.request.task_id})
    .some(event => event.kind === 'catalog_refreshed_before_dispatch'));
});

test('the routing ledger records what each descent escalation did: escalated, or why it was held', async t => {
  const dir = await fixture(t);
  await run(t, dir, 'ledger escalated', {execute: (ticket, count) => count === 1 ? execution(ticket, {output: ''}) :
    execution(ticket)});
  const escalated = await ledger(dir, 'ledger escalated');
  assert.deepEqual(escalated.map(record => [record.model, record.attempt_state, record.escalation_outcome]),
    [['gpt-6-luna', 'ladder_not_returned', 'escalated'], ['gpt-6-astra', 'completed', null]]);
  const codexOnly = {claude: [], codex: CODEX.filter(([model]) => model !== 'gpt-6-astra')};
  await run(t, dir, 'ledger held', {refresh: (value, count) => tierCatalog(value, count === 1 ? {claude: []} : codexOnly),
    execute: ticket => execution(ticket, {output: ''})});
  // The reference vanished after bind: the escalation is recorded, and its
  // dispatch-time re-resolution holds before any reference attempt exists.
  const held = await ledger(dir, 'ledger held');
  assert.deepEqual(held.map(record => [record.model, record.attempt_state, record.escalation_outcome]),
    [['gpt-6-luna', 'ladder_not_returned', 'escalated']]);
  await run(t, dir, 'ledger adopted', {execute: ticket => execution(ticket)});
  assert.deepEqual((await ledger(dir, 'ledger adopted')).map(record => record.escalation_outcome), [null]);
});

test('R11: pools rank by the quota of the model a node actually binds, after pin and conversation affinity', () => {
  const request = task('/tmp', 'Answer one question');
  // Codex leads the catalog (its frontier has more room), but its fast model
  // is nearly exhausted; Claude's lower tiers have room.
  const scores = {'gpt-6-astra': 300_000_000, 'gpt-6.1-sol': 2_000_000, 'gpt-6-luna': 2_000_000,
    'claude-fable-5-1': 100_000_000, fable: 100_000_000, 'claude-opus-5-5': 900_000_000, opus: 900_000_000,
    'claude-sonnet-5-5': 900_000_000, sonnet: 900_000_000, 'claude-haiku-4-5-20251001': 900_000_000};
  const catalog = {...tierCatalog(request), quota_scores: scores};
  const certified = resolve(request, catalog, 'certified').decisions.n;
  assert.equal(route(certified), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.match(certified.reason, /;pool_rank_1;outscored_pool_rank_0;effort_none;pool_scored_by_bound_model;/);
  // The reference binds the frontier: Codex's astra has more room than fable.
  assert.equal(route(resolve(request, catalog).decisions.n), 'openai_codex/gpt-6-astra/max');
  // Unknown scores keep the catalog order; a model with a score outranks one with none.
  assert.equal(route(resolve(request, tierCatalog(request), 'certified').decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.equal(route(resolve(request, {...tierCatalog(request), quota_scores: {'claude-haiku-4-5-20251001': 5}},
    'certified').decisions.n), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  // Only the bound model's score counts: a score for another Claude model
  // (sonnet, which this descent does not bind there) leaves the catalog order.
  assert.equal(route(resolve(request, {...tierCatalog(request), quota_scores: {sonnet: 5}}, 'certified')
    .decisions.n), 'openai_codex/gpt-6-luna/low');
  // A class pin outranks the score; conversation affinity outranks the score too.
  const pinned = {...catalog, request_class: 'chat_explanatory', class_provider_pins: {chat_explanatory: 'codex'}};
  const pin = resolve(request, pinned, 'certified').decisions.n;
  assert.equal(route(pin), 'openai_codex/gpt-6-luna/low');
  assert.match(pin.reason, /;pool_class_pin;/);
  const resumed = task('/tmp', 'Answer one question', {codexSession: 'owner-codex-thread'});
  const affine = resolveRoutePlan(plan(resumed, [unbound('n')]), resumed, {...tierCatalog(resumed),
    quota_scores: scores}, Date.now(), {verifierRegistry: CERTIFY}).decisions.n;
  assert.equal(route(affine), 'openai_codex/gpt-6-luna/low');
  assert.match(affine.reason, /;pool_conversation_affinity;/);
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

test('native_reference_efforts is optional but present maps must be bounded, known, model-scoped and cover every native row', async t => {
  const dir = await fixture(t);
  const cases = [
    ['null native ceilings', () => null],
    ['array native ceilings', () => []],
    ['unknown native provider', good => ({...good, openai: {'gpt-6-astra': 'ultra'}})],
    ['null native provider map', good => ({...good, codex: null})],
    ['array native provider map', good => ({...good, codex: []})],
    ['empty provider with no represented models', () => ({codex: {}})],
    ['unknown model entry', good => ({...good, codex: {...good.codex, 'unsigned-model': 'ultra'}})],
    ['missing native provider', good => ({codex: good.codex})],
    ['missing native model', good => ({...good, codex: Object.fromEntries(Object.entries(good.codex)
      .filter(([model]) => model !== 'gpt-6-astra'))})],
    ['unknown future native effort', good => ({...good, codex: {...good.codex, 'gpt-6-astra': 'future-max'}})],
    ['non-string native effort', good => ({...good, codex: {...good.codex, 'gpt-6-astra': {effort: 'ultra'}}})],
    ['ceiling below admitted row', good => ({...good, codex: {...good.codex, 'gpt-6-astra': 'low'}})],
    ['model placed under wrong provider', good => ({...good, claude: {...good.claude, 'gpt-6-astra': 'ultra'}})],
    ['oversized native model map', good => ({...good, codex: Object.fromEntries(Array.from({length: 257},
      (_, i) => ['model-' + i, 'max']))})],
  ];
  for (const [name, mutate] of cases) {
    let planned = 0;
    const request = task(dir, 'Reject malformed native inventory metadata');
    const runtime = await createRCCRuntime({stateDir: join(dir, name.replace(/\W+/g, '-')),
      catalog: async value => {
        const catalog = nativeCeilings(tierCatalog(value));
        return {...catalog, native_reference_efforts: mutate(catalog.native_reference_efforts)};
      }, plan: async () => { planned++; return plan(request, [unbound('n')]); },
      execute: async () => { throw Error('must not dispatch'); }, verifyTask: taskVerdict});
    t.after(async () => { await runtime.close(); });
    await runtime.submit(request);
    const done = await wait(runtime, request);
    assert.equal(done.state, 'held', name);
    assert.equal(done.error, 'catalog_binding_invalid', name);
    assert.equal(planned, 0, name + ': no model/planner spend on malformed metadata');
  }
  const valid = await run(t, dir, 'complete native inventory', {refresh: value => nativeCeilings(tierCatalog(value,
    {codex: HIGHEST_CODEX})), execute: ticket => execution(ticket)});
  assert.equal(valid.done.state, 'completed', valid.done.error);
  assert.deepEqual(valid.tuples, ['gpt-6-luna/low']);
});
