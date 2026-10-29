// Build 442 (owner order 2026-10-27, DESIGN-3): capability-based choice for
// deep work; DESIGN-4 (2026-10-28): standard answers too, the misread-robust
// broad/narrow/writing choice, the best-score bar (§7) and the live-reference
// check (§8). The offline qualification rule at tolerance 0 and its compiled
// table (scripts/capability-table.mjs, Resources/model-capability-table.json,
// Swift ModelCapabilityTable), and Core binding a deep node at the cheapest
// dispatchable capability-qualified row across both pools, the pool reference
// its fallback and (read-only) its one escalation, a writer with no ladder.
// Pure resolver calls and a real durable Core with temp SQLite and a fake
// executor: no provider, model, network, real HOME or installed app.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, readFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CAPABILITY_CATEGORIES, admittedRoute, createRCCRuntime, deliveryBasisOf, hostContextFingerprint, hostPlan,
  resolveRoutePlan} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {DOMAINS, canonical, compileTable, effortOf, qualifyCategory, referenceRow,
  typicalCallUSD} from '../capability-table.mjs';
import {auditDeliveryPolicy} from '../route-replay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = text => createHash('sha256').update(text).digest('hex');
const VERSION = 'r10_joint_selection_v2';
const policyText = 'Capability routes fixture policy.';
const EVIDENCE = readFileSync(join(ROOT, 'scripts/capability-evidence-20261027.json'));
const PRICES = readFileSync(join(ROOT, 'Resources/model-price-table.json'));
const TABLE_BYTES = readFileSync(join(ROOT, 'Resources/model-capability-table.json'));
const TABLE = JSON.parse(TABLE_BYTES.toString('utf8'));
const prices = JSON.parse(PRICES.toString('utf8'));

// ---- The qualification rule (DESIGN-3), on small row sets. -----------------
const ev = (model, benchmark, level, score, {status = 'confirmed', lb = false, cost = null, category = 'math',
  provider = 'anthropic', unit = '%'} = {}) => ({provider, category, benchmark, model, reasoning_level: level, score,
  status, sources: ['https://www.anthropic.com/fixture'], cost, note: '', lower_better: lb, unit});
const REF = 'claude-fable-5-1';
const qualify = (rows, options = {}) => qualifyCategory(rows, {category: 'math', reference: REF, prices, ...options});
const names = result => result.qualifying.map(row => row.model + '@' + row.effort);
const reasonOf = (result, model, effort) => result.rejected.find(row => row.model === model && row.effort === effort)?.reason;

test('rule: a tie qualifies at tolerance 0; a hundredth below does not', () => {
  const tie = qualify([ev(REF, 'B', 'max', 80), ev('claude-opus-5-5', 'B', 'max', 80)]);
  assert.deepEqual(names(tie), ['claude-opus-5-5@max']);
  const below = qualify([ev(REF, 'B', 'max', 80), ev('claude-opus-5-5', 'B', 'max', 79.99)]);
  assert.deepEqual(names(below), []);
  assert.equal(reasonOf(below, 'claude-opus-5-5', 'max'), 'below_reference:B');
  // EVERY shared benchmark: one loss among wins fails it.
  const mixed = qualify([ev(REF, 'A', 'max', 50), ev(REF, 'B', 'max', 50), ev('claude-opus-5-5', 'A', 'max', 90),
    ev('claude-opus-5-5', 'B', 'max', 49.9)]);
  assert.deepEqual(names(mixed), []);
});

test('rule: a lower-is-better metric is inverted', () => {
  const rows = [ev(REF, 'err', 'max', 4.2, {lb: true}), ev('claude-opus-5-5', 'err', 'max', 4.1, {lb: true}),
    ev('claude-sonnet-5-5', 'err', 'max', 4.3, {lb: true})];
  const result = qualify(rows);
  assert.deepEqual(names(result), ['claude-opus-5-5@max']);
  assert.equal(result.qualifying[0].benchmarks[0].delta, 0.1);
  assert.equal(result.qualifying[0].benchmarks[0].lower_is_better, true);
  assert.equal(reasonOf(result, 'claude-sonnet-5-5', 'max'), 'below_reference:err');
});

test('rule: single-source, disputed and unpublished scores never qualify anything', () => {
  // A single-source candidate score is not a score: nothing is shared.
  const single = qualify([ev(REF, 'B', 'max', 50), ev('claude-opus-5-5', 'B', 'max', 90, {status: 'single_source'})]);
  assert.deepEqual(names(single), []);
  assert.equal(reasonOf(single, 'claude-opus-5-5', 'max'), 'no_shared_confirmed_benchmark');
  // A disputed (or single-source) reference leaves the benchmark unshared.
  for (const status of ['disputed', 'single_source']) {
    const result = qualify([ev(REF, 'B', 'max', 50, {status}), ev('claude-opus-5-5', 'B', 'max', 90)]);
    assert.deepEqual(names(result), [], status);
    assert.equal(referenceRow([ev(REF, 'B', 'max', 50, {status})], REF).row, null, status);
  }
  // A confirmed loss beside an unshared win still fails; an unshared benchmark never helps.
  const unshared = qualify([ev(REF, 'A', 'max', 50), ev(REF, 'B', 'max', 50, {status: 'disputed'}),
    ev('claude-opus-5-5', 'A', 'max', 49), ev('claude-opus-5-5', 'B', 'max', 99)]);
  assert.deepEqual(names(unshared), []);
  // Unpublished for the reference: nothing to compare with.
  assert.deepEqual(names(qualify([ev('claude-opus-5-5', 'B', 'max', 99)])), []);
});

test('rule: an effort label that is not a dispatchable effort is no (model, effort) score', () => {
  for (const [level, effort] of [['max (card standard config)', 'max'], ['medium (API default)', 'medium'],
    ['ultra (Codex)', 'ultra'], ['unspecified', null], ['best of any effort / unspecified', null],
    ['fixed thinking budget', null], ['max tested solution length', null]])
    assert.equal(effortOf(level), effort, level);
  const result = qualify([ev(REF, 'B', 'max', 50), ev('claude-opus-5-5', 'B', 'unspecified', 90)]);
  assert.deepEqual(names(result), []);
  // With no max row the reference is its top published effort.
  assert.equal(referenceRow([ev(REF, 'B', 'medium (only level published)', 63.6)], REF).effort, 'medium');
});

test('rule: strictly cheaper by the typical call, and by every comparable per-task cost', () => {
  assert.equal(typicalCallUSD(prices, 'claude-opus-5-5'), 0.074);
  // The reference itself at a lower effort is never cheaper by the typical call.
  const self = qualify([ev(REF, 'B', 'max', 50), ev(REF, 'B', 'high', 60)]);
  assert.deepEqual(names(self), []);
  assert.equal(reasonOf(self, REF, 'high'), 'not_cheaper_typical_call');
  const dear = qualify([ev(REF, 'B', 'max', 50, {cost: 1}), ev('claude-opus-5-5', 'B', 'max', 60, {cost: 1})]);
  assert.equal(reasonOf(dear, 'claude-opus-5-5', 'max'), 'per_task_cost_not_lower:B');
  assert.deepEqual(names(qualify([ev(REF, 'B', 'max', 50, {cost: 1}), ev('claude-opus-5-5', 'B', 'max', 60, {cost: 0.9})])),
    ['claude-opus-5-5@max']);
  // An unpriced model is never shown cheaper.
  assert.equal(reasonOf(qualify([ev(REF, 'B', 'max', 50), ev('claude-unknown-9', 'B', 'max', 60)]), 'claude-unknown-9', 'max'),
    'unpriced');
});

test('rule: the two blockers only remove rows the evidence argues against', () => {
  // A: every reported value of an unconfirmed own score is below the reference.
  const a = [ev(REF, 'A', 'max', 1735), ev(REF, 'B', 'max', 1678), ev('claude-sonnet-5-5', 'A', 'xhigh', 1731, {status: 'disputed'}),
    ev('claude-sonnet-5-5', 'A', 'xhigh', 1725, {status: 'disputed'}), ev('claude-sonnet-5-5', 'B', 'xhigh', 1746)];
  assert.deepEqual(names(qualify(a)), []);
  assert.equal(reasonOf(qualify(a), 'claude-sonnet-5-5', 'xhigh'), 'unconfirmed_below_reference:A');
  assert.deepEqual(names(qualify(a, {blockers: false})), ['claude-sonnet-5-5@xhigh']);
  // A disputed pair straddling the reference does not block.
  const straddle = a.map(row => row.score === 1725 ? {...row, score: 1740} : row);
  assert.deepEqual(names(qualify(straddle)), ['claude-sonnet-5-5@xhigh']);
  // B: the same model, unpublished here at this effort, is below the reference at a higher one.
  const b = [ev(REF, 'A', 'max', 50), ev(REF, 'Q', 'max', 80), ev('claude-opus-5-5', 'A', 'xhigh', 60),
    ev('claude-opus-5-5', 'A', 'max', 61), ev('claude-opus-5-5', 'Q', 'max', 79)];
  assert.deepEqual(names(qualify(b)), []);
  assert.equal(reasonOf(qualify(b), 'claude-opus-5-5', 'xhigh'), 'below_reference_at_higher_effort:Q@max');
  assert.deepEqual(names(qualify(b, {blockers: false})), ['claude-opus-5-5@xhigh']);
  // Its own published score always stands over a higher effort's.
  const own = [...b, ev('claude-opus-5-5', 'Q', 'xhigh', 80.5)];
  assert.deepEqual(names(qualify(own)), ['claude-opus-5-5@xhigh']);
});

test('rule: within one price, the lower effort first, as every first-party cost series agrees', () => {
  const rows = [ev(REF, 'B', 'max', 50, {cost: 10}), ...['medium', 'high', 'max'].map((level, i) =>
    ev('claude-opus-5-5', 'B', level, 60, {cost: 1 + i})), ev('claude-sonnet-5-5', 'B', 'max', 55)];
  assert.deepEqual(names(qualify(rows)), ['claude-sonnet-5-5@max', 'claude-opus-5-5@medium', 'claude-opus-5-5@high',
    'claude-opus-5-5@max']);
  const contradicted = rows.map(row => row.reasoning_level === 'medium' ? {...row, cost: 9} : row);
  assert.throws(() => qualify(contradicted), /capability_effort_order_contradicted/);
});

test('rule (DESIGN-4 §7): the bar is the reference\'s best confirmed score at any effort; it only removes rows', () => {
  // The reference's xhigh beats its max: a candidate between the two fails.
  const rows = [ev(REF, 'B', 'max', 31.0), ev(REF, 'B', 'xhigh', 32.2), ev(REF, 'B', 'high', 31.0),
    ev('claude-opus-5-5', 'B', 'high', 32.0), ev('claude-sonnet-5-5', 'B', 'max', 32.2)];
  const result = qualify(rows);
  assert.deepEqual(names(result), ['claude-sonnet-5-5@max']);
  assert.equal(reasonOf(result, 'claude-opus-5-5', 'high'), 'below_reference:B');
  assert.deepEqual([result.qualifying[0].benchmarks[0].reference_score, result.qualifying[0].benchmarks[0].reference_effort],
    [32.2, 'xhigh']);
  // A lower-is-better metric: the lowest confirmed score at any effort.
  const lb = qualify([ev(REF, 'E', 'max', 3.91, {lb: true}), ev(REF, 'E', 'high', 3.9, {lb: true}),
    ev('claude-opus-5-5', 'E', 'max', 3.905, {lb: true})]);
  assert.deepEqual(names(lb), []);
  // An unconfirmed better reference score is not the bar.
  assert.deepEqual(names(qualify([ev(REF, 'B', 'max', 31), ev(REF, 'B', 'xhigh', 40, {status: 'single_source'}),
    ev('claude-opus-5-5', 'B', 'max', 32)])), ['claude-opus-5-5@max']);
  // Sharing is unchanged: a confirmed lower-effort reference row never makes
  // a benchmark whose max row is disputed shared (it would only add a row).
  assert.deepEqual(names(qualify([ev(REF, 'B', 'max', 65, {status: 'disputed'}), ev(REF, 'B', 'low', 60),
    ev('claude-opus-5-5', 'B', 'max', 61)])), []);
  // The per-task cost condition still compares with the max (or top) row.
  assert.deepEqual(names(qualify([ev(REF, 'B', 'max', 50, {cost: 10}), ev(REF, 'B', 'low', 52, {cost: 1}),
    ev('claude-opus-5-5', 'B', 'max', 53, {cost: 5})])), ['claude-opus-5-5@max']);
});

// ---- The compiled table. ----------------------------------------------------
test('the compiled table is exactly the script output, in the resource and in the Swift source', () => {
  const compiled = canonical(compileTable(EVIDENCE, PRICES));
  assert.equal(TABLE_BYTES.toString('utf8'), compiled);
  const swift = readFileSync(join(ROOT, 'Sources/OS1Context/ModelCapabilityTable.swift'), 'utf8');
  const literal = swift.split('public static let compiledBytes = Data((#"')[1].split('"# + "\\n").utf8)')[0];
  assert.equal(literal + '\n', compiled);
  const pin = swift.match(/public static let compiledSHA256 = "([0-9a-f]{64})"/)[1];
  assert.equal(pin, sha(TABLE_BYTES));
  assert.equal(TABLE.evidence_sha256, sha(EVIDENCE));
  assert.equal(TABLE.price_table_sha256, sha(PRICES));
  assert.deepEqual(Object.keys(TABLE.categories).sort(), [...CAPABILITY_CATEGORIES].sort());
  assert.deepEqual(Object.keys(DOMAINS).sort(), [...CAPABILITY_CATEGORIES].sort());
});

test('the compiled verdicts: DESIGN-3 evidence table under the DESIGN-4 §7 bar; the literal three conditions would add two rows', () => {
  const rows = (table, domain, pool) => table.categories[domain].pools[pool].qualifying.map(row => row.model + '@' + row.effort);
  // DESIGN-4 §7 dropped Opus 5.5 @xhigh from coding (FrontierCode v1.1 Main
  // 51.42 < Fable @low 52.8) and every GPT-6.1 Sol writing row (GDP.pdf
  // 32.0 / 31.8 / 31.0 < astra @xhigh 32.2): writing binds the reference.
  const expected = {knowledge: [[], ['claude-opus-5-5@max']], science: [[], ['claude-opus-5-5@max']],
    math: [[], ['claude-sonnet-5-5@max', 'claude-opus-5-5@max']],
    coding: [[], ['claude-opus-5-5@medium', 'claude-opus-5-5@high', 'claude-opus-5-5@max']],
    writing: [[], []], tool_use: [[], ['claude-opus-5-5@max']]};
  for (const [domain, [openai, anthropic]] of Object.entries(expected)) {
    assert.deepEqual(rows(TABLE, domain, 'openai_codex'), openai, domain);
    assert.deepEqual(rows(TABLE, domain, 'anthropic_shared'), anthropic, domain);
  }
  assert.equal(TABLE.reference_bar, 'best_confirmed_any_effort');
  assert.deepEqual(TABLE.broad, {categories: ['knowledge', 'science', 'math', 'coding', 'tool_use'],
    pools: {anthropic_shared: [{effort: 'max', model: 'claude-opus-5-5', typical_call_usd: 0.074}], openai_codex: []}});
  const bar = row => row.benchmarks.find(b => b.benchmark === 'FrontierCode v1.1 Main');
  const opusMedium = TABLE.categories.coding.pools.anthropic_shared.qualifying.find(r => r.effort === 'medium');
  assert.deepEqual([bar(opusMedium).reference_score, bar(opusMedium).reference_effort], [52.8, 'low']);
  const literal = compileTable(EVIDENCE, PRICES, {blockers: false});
  assert.deepEqual(rows(literal, 'coding', 'anthropic_shared'), expected.coding[1]);
  assert.deepEqual(rows(literal, 'writing', 'anthropic_shared'), ['claude-sonnet-5-5@xhigh', 'claude-opus-5-5@xhigh']);
  assert.deepEqual(TABLE.categories.writing.pools.anthropic_shared.blocked.map(row => row.model + '@' + row.effort + ' ' + row.reason),
    ['claude-opus-5-5@xhigh below_reference_at_higher_effort:OfficeQA@max',
      'claude-sonnet-5-5@xhigh unconfirmed_below_reference:GDPval-AA v2.1 (Elo)']);
  // Every qualifying row names its benchmarks, deltas and first-party sources.
  for (const category of Object.values(TABLE.categories)) for (const pool of Object.values(category.pools))
    for (const row of pool.qualifying) {
      assert(row.typical_call_usd < pool.reference.typical_call_usd);
      for (const benchmark of row.benchmarks) {
        assert(benchmark.delta >= 0 && benchmark.sources.length > 0 &&
          benchmark.sources.every(url => /^https:\/\/(?:www\.anthropic\.com|openai\.com|deploymentsafety\.openai\.com|developers\.openai\.com|platform\.claude\.com)\//.test(url)),
          JSON.stringify(benchmark));
      }
    }
});

// ---- Core: binding a deep node. ------------------------------------------------
const USD = {'gpt-6-astra': 0.195, 'gpt-6.1-sol': 0.037, 'gpt-6-luna': 0.00195, 'claude-fable-5-1': 0.18,
  'claude-opus-5-5': 0.074, 'claude-sonnet-5-5': 0.037, 'claude-haiku-4-5-20251001': 0.0195};
function task({request = '이 두 이론을 통합하는 체계를 설계해줘', write = false, budget = {}, provider = 'auto',
               workspace = '/private/capability-fixture'} = {}) {
  const host = {workspace, context: null, provider_preference: provider, codex_session_id: null, claude_session_id: null,
    require_read_only: false, owner_policy: null};
  return {schema: 1, task_id: 'cap-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20000, max_native_dispatches: 16,
      ...budget},
    host_context: host, policy: {source_sha256: sha('source'), projection_sha256: sha(policyText), text: policyText},
    routing_intent_policy_version: VERSION};
}
const intent = {version: VERSION, allowed_surfaces: [], exact_model: null, model_family: null, effort: null,
  require_native_ceiling: false, quality_target: null, state: 'resolved'};
function profile({task_type = 'design', difficulty = 'deep', tool_need = 'none', answer_kind = 'answer_only',
                  classifier = 'local_llm:qwen3.5:9b', domain = 'science', signals = []} = {}) {
  const value = {schema: 1, policy: 'host_profile_v1', answer_kind, tool_need,
    difficulty: answer_kind === 'answer_only' ? difficulty : 'unknown',
    signals: [...new Set(['llm_task_' + task_type, ...signals])].sort(), classifier, task_type};
  return domain === null ? value : {...value, domain};
}
const POOLS = ['openai_codex', 'anthropic_shared'];
const BROAD = Object.fromEntries(POOLS.map(pool => [pool, TABLE.broad.pools[pool].map(({model, effort}) => ({model, effort}))]));
const PRICE = sha(PRICES);
/** Schema-2 capability routes (Swift CapabilityChoice): `choice` 'narrow'
 * (the domain's full list, corroborated by `marker`), 'broad' (the broad rows;
 * category 'broad' for an unknown domain or a non-deliverable writing reading),
 * 'writing' (the writing list); `pools` overrides the rows (a hand-built row). */
function routesFor(domain, {choice = domain === null ? 'broad' : domain === 'writing' ? 'writing' : 'narrow',
                            marker = 'fixture_marker', pools = null, references = null, price = null} = {}) {
  const list = domain === null ? BROAD : Object.fromEntries(POOLS.map(pool =>
    [pool, TABLE.categories[domain].pools[pool].qualifying.map(({model, effort}) => ({model, effort}))]));
  const base = {schema: 2, policy: 'capability_delta0_v2', table_sha256: sha(TABLE_BYTES), broad: BROAD,
    references: references ?? {openai_codex: 'gpt-6-astra', anthropic_shared: 'claude-fable-5-1'},
    price_basis: price ?? {table: PRICE, active: PRICE, compiled: PRICE}};
  if (choice === 'broad')
    return {...base, category: domain === null || domain === 'writing' ? 'broad' : domain, choice: 'broad', marker: null,
      pools: pools ?? BROAD};
  if (choice === 'writing') return {...base, category: 'writing', choice: 'writing_deliverable', marker: null, pools: pools ?? list};
  return {...base, category: domain, choice: 'narrow_corroborated', marker, pools: pools ?? list};
}
/** A hand-built writing row (the compiled table has none since DESIGN-4 §7):
 * Core's writer and pool-boundary paths stay covered. */
const SOL_WRITING = {openai_codex: [{model: 'gpt-6.1-sol', effort: 'high'}], anthropic_shared: []};
function row(id, model, effort, provider, {surface = provider, scope = 'read_only', quota = 0.6, unavailable = false,
                                           usd = USD[model]} = {}) {
  const now = Date.now();
  return {id, surface, transport: provider === 'codex' ? 'codex_app_server' : 'claude_cli',
    account_id: 'fixture-' + provider, model, effort,
    tools: surface.endsWith('-chat') ? [] : scope === 'read_only' ? ['read', 'execute'] : ['read', 'write', 'execute'],
    scope, permission_profile: scope, quota_pool: provider === 'codex' ? 'openai_codex' : 'anthropic_shared',
    allowed_paths: scope === 'workspace_write' ? ['**'] : [], configuration_sha256: sha('fixture:' + id),
    availability: unavailable ? 'unavailable' : 'available', availability_observed_at_ms: now - 1,
    availability_valid_until_ms: now + 60000, quota_remaining_fraction: quota, quota_observed_at_ms: now - 1,
    quota_valid_until_ms: now + 60000, quality_state: 'policy_admitted', estimated_cost_units: usd};
}
// Every production profile a capability row names, plus the references and
// the build-441 graded tiers; read-only (agent and chat) or writer rows.
function rows({scope = 'read_only', codexQuota = 0.6, claudeQuota = 0.6, drop = [], patch = {}} = {}) {
  const codex = [['astra-ultra', 'gpt-6-astra', 'ultra'], ['sol-medium', 'gpt-6.1-sol', 'medium'],
    ['sol-high', 'gpt-6.1-sol', 'high'], ['sol-xhigh', 'gpt-6.1-sol', 'xhigh'], ['sol-max', 'gpt-6.1-sol', 'max'],
    ['luna-low', 'gpt-6-luna', 'low']].map(([id, model, effort]) => row(id, model, effort, 'codex', {scope, quota: codexQuota}));
  const claude = [['fable-max', 'claude-fable-5-1', 'max'], ['opus-medium', 'claude-opus-5-5', 'medium'],
    ['opus-high', 'claude-opus-5-5', 'high'], ['opus-xhigh', 'claude-opus-5-5', 'xhigh'], ['opus-max', 'claude-opus-5-5', 'max'],
    ['sonnet-medium', 'claude-sonnet-5-5', 'medium'], ['sonnet-xhigh', 'claude-sonnet-5-5', 'xhigh'],
    ['sonnet-max', 'claude-sonnet-5-5', 'max']].map(([id, model, effort]) => row(id, model, effort, 'claude', {scope, quota: claudeQuota}));
  const all = [...codex, ...claude].map(value => scope === 'workspace_write' ? {...value, id: value.id + '-w'} : value);
  return all.filter(value => !drop.includes(value.id)).map(value => ({...value, ...(patch[value.id] ?? {})}));
}
function catalog(q, {request_profile = profile(), candidates = rows(), writer = false, routes = undefined, patch = {}} = {}) {
  const offered = new Set(candidates.map(c => c.model));
  const only = map => Object.fromEntries(Object.entries(map).filter(([model]) => offered.has(model)));
  const capability = routes !== undefined ? routes :
    request_profile?.domain ? routesFor(request_profile.domain) : null;
  return {schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, candidates,
    model_tiers: only({'gpt-6-astra': 'frontier', 'gpt-6.1-sol': 'workhorse', 'gpt-6-luna': 'fast', 'claude-fable-5-1': 'frontier',
      'claude-opus-5-5': 'workhorse', 'claude-sonnet-5-5': 'efficient'}),
    native_reference_efforts: {codex: only({'gpt-6-astra': 'ultra', 'gpt-6.1-sol': 'max', 'gpt-6-luna': 'low'}),
      claude: only({'claude-fable-5-1': 'max', 'claude-opus-5-5': 'max', 'claude-sonnet-5-5': 'max'})},
    owner_scope: writer ? 'workspace_write' : 'read_only', chat_lane_eligible: false,
    request_class: writer ? 'writer' : 'readonly_lookup', routing_intent_v2: intent,
    ...(request_profile === null ? {} : {request_profile}), ...(capability === null ? {} : {capability_routes: capability}),
    ...patch};
}
function bind(q, c, options = {}) {
  const {decisions, routes} = resolveRoutePlan(hostPlan(q, c), q, c, Date.now(), options);
  const decision = decisions.node_0, route = routes.node_0;
  return {decision, route, tuple: `${decision.model}/${decision.effort}`, pool: decision.quota_pool,
    tokens: decision.reason.split(';'),
    basis: deliveryBasisOf({routeClass: decision.route_class, routeKind: route.kind, ladder: route.ladder,
      reason: decision.reason})};
}

test('Core binds each domain at the cheapest qualifying row of either pool, uncertified, the reference its escalation', () => {
  const expected = {knowledge: ['claude-opus-5-5/max', 'claude-fable-5-1', 'capability_broad'],
    science: ['claude-opus-5-5/max', 'claude-fable-5-1', 'capability_broad'],
    math: ['claude-sonnet-5-5/max', 'claude-fable-5-1', 'capability_narrow_corroborated:fixture_marker'],
    coding: ['claude-opus-5-5/medium', 'claude-fable-5-1', 'capability_narrow_corroborated:fixture_marker'],
    tool_use: ['claude-opus-5-5/max', 'claude-fable-5-1', 'capability_broad']};
  // DESIGN-4 §7: no writing row qualifies in either pool: the reference, with the note.
  {
    const q = task(), bound = bind(q, catalog(q, {request_profile: profile({domain: 'writing', task_type: 'write'})}));
    assert.equal(bound.tuple, 'gpt-6-astra/ultra');
    assert.equal(bound.basis, 'reference');
    assert(bound.tokens.includes('capability_writing_none_qualify') &&
      bound.tokens.includes('capability_choice_writing_deliverable'), bound.decision.reason);
  }
  for (const [domain, [tuple, reference, choice]] of Object.entries(expected)) {
    const q = task(), c = catalog(q, {request_profile: profile({domain})});
    assert.deepEqual(admittedRoute(hostPlan(q, c).nodes[0], q, c), {class: 'capability', source: 'capability_table',
      certificate_id: null, category: domain}, domain);
    const bound = bind(q, c);
    assert.equal(bound.tuple, tuple, domain);
    assert.equal(bound.route.kind, 'capability', domain);
    assert.equal(bound.decision.route_class, 'deep', domain);
    assert.equal(bound.basis, 'capability:' + domain, domain);
    assert.equal(bound.route.ladder.reference_model, reference, domain);
    assert.equal(bound.route.ladder.admitted_by, 'capability_table', domain);
    assert.equal(bound.route.ladder.category, domain, domain);
    for (const token of ['route_capability', 'admitted_capability_' + domain, choice, 'price_choice', 'escalation_reference_same_pool'])
      assert(bound.tokens.includes(token), `${domain}: ${token} in ${bound.decision.reason}`);
    assert(!/certified/.test(bound.decision.reason), bound.decision.reason);
    assert(bound.tokens.some(token => token.startsWith('capability_usd_')) &&
      bound.tokens.some(token => token.startsWith('reference_usd_')), bound.decision.reason);
  }
});

test('a pool that cannot run: the other pool, else the reference, never an unlisted stand-in', () => {
  // Anthropic exhausted: no OpenAI row qualifies for coding, so astra (the reference) binds.
  let q = task();
  let bound = bind(q, catalog(q, {request_profile: profile({domain: 'coding'}), candidates: rows({claudeQuota: 0})}));
  assert.equal(bound.tuple, 'gpt-6-astra/ultra');
  assert.equal(bound.route.kind, 'reference');
  assert(bound.tokens.includes('admitted_reference_uncertified') && bound.tokens.includes('capability_coding_tuple_undispatchable'),
    bound.decision.reason);
  // Codex exhausted: Opus still serves coding; writing (Sol only) falls to Fable.
  q = task();
  bound = bind(q, catalog(q, {request_profile: profile({domain: 'coding'}), candidates: rows({codexQuota: 0})}));
  assert.equal(bound.tuple, 'claude-opus-5-5/medium');
  q = task();
  bound = bind(q, catalog(q, {request_profile: profile({domain: 'writing', task_type: 'write'}), candidates: rows({codexQuota: 0}),
    routes: routesFor('writing', {pools: SOL_WRITING})}));
  assert.equal(bound.tuple, 'claude-fable-5-1/max');
  assert.equal(bound.basis, 'reference');
  // A stale quota row is out; the next listed row of the domain binds.
  q = task();
  const stale = {quota_observed_at_ms: Date.now() - 600000, quota_valid_until_ms: Date.now() - 1000};
  bound = bind(q, catalog(q, {request_profile: profile({domain: 'coding'}), candidates: rows({patch: {'opus-medium': stale}})}));
  assert.equal(bound.tuple, 'claude-opus-5-5/high');
  // Review of 442: the table's own reference unavailable. Its rows qualified
  // against that reference only, so none stands in beside the other pool's
  // reference (never compared): policy A's reference binds, with the note.
  q = task();
  bound = bind(q, catalog(q, {request_profile: profile({domain: 'coding'}),
    candidates: rows({patch: {'fable-max': {availability: 'unavailable'}}})}));
  assert.equal(bound.tuple, 'gpt-6-astra/ultra');
  assert.equal(bound.basis, 'reference');
  assert(bound.tokens.includes('capability_coding_requires_runnable_reference'), bound.decision.reason);
  assert(!bound.tokens.some(token => token.startsWith('admitted_capability_')), bound.decision.reason);
  // The builder's own boundary (a quota-exhausted or cooled-down frontier:
  // its rows gone, quota_zero or quota_backoff plus reference_unavailable),
  // per domain and per pool: the other pool's reference, never a lower row
  // of the held pool and never a cross-pool ladder.
  for (const [reason, domain, held, tuple] of [
    ['quota_zero', 'coding', 'fable-max', 'gpt-6-astra/ultra'], ['quota_zero', 'math', 'fable-max', 'gpt-6-astra/ultra'],
    ['quota_backoff', 'science', 'fable-max', 'gpt-6-astra/ultra'],
    ['quota_zero', 'writing', 'astra-ultra', 'claude-fable-5-1/max']]) {
    const provider = held === 'fable-max' ? 'claude' : 'codex';
    q = task();
    bound = bind(q, catalog(q, {request_profile: profile({domain, task_type: domain === 'writing' ? 'write' : 'design'}),
      candidates: rows({drop: [held]}), routes: domain === 'writing' ? routesFor('writing', {pools: SOL_WRITING}) : undefined,
      patch: {exclusions: [{provider, reason, count: 1}, {provider, reason: 'reference_unavailable', count: 1}]}}));
    assert.equal(bound.tuple, tuple, `${reason} ${domain}`);
    assert.equal(bound.basis, 'reference', `${reason} ${domain}`);
    assert.equal(bound.route.ladder ?? null, null, `${reason} ${domain}`);
    assert(bound.tokens.includes(`capability_${domain}_requires_runnable_reference`), bound.decision.reason);
  }
  // A writer is held the same way: no reference-equivalent row without its reference.
  q = task({request: '랜딩 페이지 카피 영어로 갈아끼워', write: true});
  bound = bind(q, catalog(q, {writer: true, candidates: rows({scope: 'workspace_write', drop: ['astra-ultra-w']}),
    request_profile: profile({answer_kind: 'unknown', task_type: 'write', domain: 'writing'}),
    routes: routesFor('writing', {pools: SOL_WRITING}),
    patch: {exclusions: [{provider: 'codex', reason: 'quota_zero', count: 1},
      {provider: 'codex', reason: 'reference_unavailable', count: 1}]}}));
  assert.equal(bound.tuple, 'claude-fable-5-1/max');
  assert.equal(bound.basis, 'reference');
  assert(bound.tokens.includes('capability_writing_requires_runnable_reference'), bound.decision.reason);
  // No reference anywhere: a typed hold, never the capability row alone.
  q = task();
  assert.throws(() => bind(q, catalog(q, {request_profile: profile({domain: 'coding'}),
    candidates: rows({patch: {'fable-max': {availability: 'unavailable'}, 'astra-ultra': {availability: 'unavailable'}}})})),
  /no_dispatchable_candidate:read_only:/);
});

test('DESIGN-4: an unknown domain\'s explanation takes the broad row; a design, a deep keyword profile keep the reference', () => {
  // A keyword (LLM down) standard explanation, a local 'general' or 4B reading of an explanation: the broad row.
  for (const [name, request_profile] of [
    ['keyword standard explanation', profile({domain: null, classifier: 'keyword_v1', task_type: 'explain', difficulty: 'standard'})],
    ['local general standard explanation', profile({domain: null, task_type: 'explain', difficulty: 'standard'})],
    ['4B deep explanation', profile({domain: null, classifier: 'local_llm:qwen3.5:4b', task_type: 'explain', difficulty: 'deep',
      signals: ['llm_domain_unqualified']})],
    ['writing reading, no deliverable', profile({domain: 'writing', task_type: 'explain', difficulty: 'standard'})]]) {
    const q = task({request: '이 개념을 설명해줘'});
    const c = catalog(q, {request_profile, routes: routesFor(request_profile.domain ?? null, {choice: 'broad'})});
    const bound = bind(q, c);
    assert.equal(bound.tuple, 'claude-opus-5-5/max', name);
    assert.equal(bound.basis, 'capability:broad', name);
    assert(bound.tokens.includes('capability_broad') && bound.tokens.includes('admitted_capability_broad'), name);
  }
  // A broad category never serves an unknown domain's design, nor a keyword profile's deep answer.
  for (const [name, request_profile] of [
    ['local general design', profile({domain: null, task_type: 'design', difficulty: 'deep'})],
    ['keyword deep explanation', profile({domain: null, classifier: 'keyword_v1', task_type: 'explain', difficulty: 'deep'})]]) {
    const q = task(), bound = bind(q, catalog(q, {request_profile, routes: routesFor(null)}));
    assert.equal(bound.tuple, 'gpt-6-astra/ultra', name);
    assert.equal(bound.basis, 'reference', name);
  }
});

test('domain unknown, general or keyword-only, strongest-model words, an owner provider: the reference', () => {
  const cases = [
    ['no domain (local general)', {request_profile: profile({domain: null}), routes: null}],
    ['keyword fallback', {request_profile: profile({domain: null, classifier: 'keyword_v1', task_type: 'explain'}), routes: null}],
    ['no capability routes', {request_profile: profile({domain: 'coding'}), routes: null}],
    ['strongest-model words', {request_profile: profile({domain: 'coding', signals: ['quality_request']})}],
  ];
  for (const [name, options] of cases) {
    const q = task(), bound = bind(q, catalog(q, options));
    assert.equal(bound.tuple, 'gpt-6-astra/ultra', name);
    assert.equal(bound.basis, 'reference', name);
    assert(!bound.tokens.some(token => token.startsWith('admitted_capability_')), name);
  }
  // The owner's provider word (the host already kept only that provider's
  // rows): its reference, never a capability row of it.
  const q = task({provider: 'claude'});
  const c = catalog(q, {request_profile: profile({domain: 'coding'}), candidates: rows().filter(r => r.quota_pool === 'anthropic_shared')});
  assert.notEqual(admittedRoute(hostPlan(q, c).nodes[0], q, c).class, 'capability');
  const bound = bind(q, c);
  assert.equal(bound.tuple, 'claude-fable-5-1/max');
  assert.equal(bound.basis, 'reference');
});

test('DESIGN-4: light stays graded; a standard answer binds a capability row, never the workhorse at medium', () => {
  {
    const q = task({request: '슈뢰딩거 방정식 설명해줘'});
    const bound = bind(q, catalog(q, {request_profile: profile({task_type: 'explain', difficulty: 'light', domain: 'science'})}));
    assert.equal(bound.tuple, 'gpt-6-luna/low');
    assert.equal(bound.basis, 'graded:light');
  }
  for (const type of ['explain', 'chat']) {
    const q = task({request: '슈뢰딩거 방정식 설명해줘'});
    const c = catalog(q, {request_profile: profile({task_type: type, difficulty: 'standard', domain: 'science'}),
      routes: routesFor('science', {choice: 'broad'})});
    assert.deepEqual(admittedRoute(hostPlan(q, c).nodes[0], q, c), {class: 'capability', source: 'capability_table',
      certificate_id: null, category: 'science'}, type);
    const bound = bind(q, c);
    assert.equal(bound.tuple, 'claude-opus-5-5/max', type);
    assert.equal(bound.basis, 'capability:science', type);
    assert.equal(bound.route.ladder.reference_model, 'claude-fable-5-1', type);
    // With no capability routes: the reference, never sol medium.
    const none = bind(q, catalog(q, {request_profile: profile({task_type: type, difficulty: 'standard', domain: 'science'}),
      routes: null}));
    assert.equal(none.tuple, 'gpt-6-astra/ultra', type);
    assert(none.tokens.includes('standard_policy_reference'), none.decision.reason);
  }
  // A standard current-facts answer: a qualifying row on an agent surface
  // only (a chat row is never offered); none, the reference with tools.
  {
    const q = task({request: '오늘 환율이 왜 오르는지 설명해줘'});
    const chat = row('opus-max-chat', 'claude-opus-5-5', 'max', 'claude', {surface: 'claude-chat'});
    let bound = bind(q, catalog(q, {candidates: [chat, ...rows()],
      request_profile: profile({task_type: 'explain', difficulty: 'standard', tool_need: 'current_facts', domain: 'knowledge'}),
      routes: routesFor('knowledge', {choice: 'broad'})}));
    assert.equal(bound.tuple, 'claude-opus-5-5/max');
    assert.equal(bound.decision.surface, 'claude');
    bound = bind(q, catalog(q, {candidates: [chat, ...rows({drop: ['opus-max']})],
      request_profile: profile({task_type: 'explain', difficulty: 'standard', tool_need: 'current_facts', domain: 'knowledge'}),
      routes: routesFor('knowledge', {choice: 'broad'})}));
    // The reference with tools (this catalog lists the Claude pool first: Fable).
    assert.equal(bound.tuple, 'claude-fable-5-1/max');
    assert.equal(bound.decision.surface, 'claude');
    assert.equal(bound.basis, 'reference');
    assert(bound.tokens.includes('capability_knowledge_tuple_undispatchable'), bound.decision.reason);
  }
  // A narrow choice whose narrow row cannot run binds the broad row, named so.
  {
    const q = task({request: '적분이 뭔지 설명해줘'});
    const bound = bind(q, catalog(q, {candidates: rows({drop: ['sonnet-max']}),
      request_profile: profile({task_type: 'explain', difficulty: 'standard', domain: 'math'}),
      routes: routesFor('math', {marker: 'math_calculus'})}));
    assert.equal(bound.tuple, 'claude-opus-5-5/max');
    assert(bound.tokens.includes('capability_broad') && !bound.tokens.some(token => token.startsWith('capability_narrow')),
      bound.decision.reason);
  }
  // A deep explain answer is deep work; a design or write reading at any difficulty too.
  for (const [type, difficulty] of [['explain', 'deep'], ['chat', 'deep'], ['design', 'standard'], ['write', 'light']]) {
    const q = task(), bound = bind(q, catalog(q, {request_profile: profile({task_type: type, difficulty, domain: 'science'})}));
    assert.equal(bound.basis, 'capability:science', `${type}/${difficulty}`);
  }
  // A read-only workspace deep answer: an agent surface only.
  let q = task();
  let bound = bind(q, catalog(q, {request_profile: profile({task_type: 'explain', tool_need: 'workspace', domain: 'coding'})}));
  assert.equal(bound.basis, 'capability:coding');
  assert.equal(bound.decision.surface, 'claude');
  // A writer with an action reading keeps the reference.
  q = task({request: '다크모드 켜줘', write: true});
  bound = bind(q, catalog(q, {writer: true, candidates: rows({scope: 'workspace_write'}),
    request_profile: profile({answer_kind: 'work', task_type: 'action', tool_need: 'workspace', domain: 'tool_use'})}));
  assert.equal(bound.tuple, 'gpt-6-astra/ultra');
  assert.equal(bound.basis, 'reference');
});

test('a writer binds the capability row reference-equivalent: no ladder, no headroom rule', () => {
  const q = task({request: '랜딩 페이지 카피 영어로 갈아끼워', write: true, budget: {max_native_dispatches: 1}});
  const c = catalog(q, {writer: true, candidates: rows({scope: 'workspace_write'}),
    request_profile: profile({answer_kind: 'unknown', task_type: 'write', domain: 'writing'}),
    routes: routesFor('writing', {pools: SOL_WRITING})});
  const bound = bind(q, c);
  assert.equal(bound.tuple, 'gpt-6.1-sol/high');
  assert.equal(bound.decision.scope ?? 'workspace_write', 'workspace_write');
  assert.equal(bound.route.kind, 'capability');
  assert.equal(bound.route.ladder, null);
  assert.equal(bound.decision.ladder, undefined);
  assert.equal(bound.basis, 'capability:writing');
  assert(bound.tokens.includes('writer_reference_equivalent_no_ladder'), bound.decision.reason);
  // DESIGN-4: a writer never binds the broad rows (no writing benchmark qualifies them).
  const broadWriter = catalog(q, {writer: true, candidates: rows({scope: 'workspace_write'}),
    request_profile: profile({answer_kind: 'unknown', task_type: 'design', domain: 'writing'}),
    routes: routesFor('writing', {choice: 'broad'})});
  assert.notEqual(admittedRoute(hostPlan(q, broadWriter).nodes[0], q, broadWriter).class, 'capability');
  assert.equal(bind(q, broadWriter).basis, 'reference');
});

test('price guard: a row no cheaper than the reference now binds the reference', () => {
  const q = task();
  const c = catalog(q, {request_profile: profile({domain: 'coding'}),
    candidates: rows({patch: {'fable-max': {estimated_cost_units: 0.07}}})});
  const bound = bind(q, c);
  // Policy A's reference by R11 (Codex is this catalog's first pool).
  assert.equal(bound.tuple, 'gpt-6-astra/ultra');
  assert.equal(bound.basis, 'reference');
  assert(bound.tokens.includes('capability_coding_not_cheaper_than_reference'), bound.decision.reason);
});

test('DESIGN-4 §8: a row binds only beside the live reference its table compared it with, on its price basis', () => {
  // A new frontier model live in a pool before the table is recompiled: that pool's rows are off, its reference binds.
  let q = task();
  let bound = bind(q, catalog(q, {request_profile: profile({domain: 'coding'}),
    routes: routesFor('coding', {references: {openai_codex: 'gpt-6-astra', anthropic_shared: 'claude-fable-5-0'}})}));
  assert.equal(bound.tuple, 'gpt-6-astra/ultra');
  assert.equal(bound.basis, 'reference');
  assert(bound.tokens.includes('capability_table_stale') && bound.tokens.includes('capability_coding_table_stale'),
    bound.decision.reason);
  // Only the stale pool is off: the other pool's rows still bind.
  q = task();
  bound = bind(q, catalog(q, {request_profile: profile({domain: 'writing', task_type: 'write'}),
    routes: routesFor('writing', {pools: SOL_WRITING, references: {openai_codex: 'gpt-6-astra', anthropic_shared: 'claude-fable-5-0'}})}));
  assert.equal(bound.tuple, 'gpt-6.1-sol/high');
  // A table priced on neither the active nor the compiled price table: every pool off.
  q = task();
  const other = sha('another price table');
  bound = bind(q, catalog(q, {request_profile: profile({domain: 'coding'}),
    routes: routesFor('coding', {price: {table: other, active: PRICE, compiled: PRICE}})}));
  assert.equal(bound.basis, 'reference');
  assert(bound.tokens.includes('capability_table_stale'), bound.decision.reason);
  // A refreshed (active) price table the table was compiled on is its basis too.
  q = task();
  bound = bind(q, catalog(q, {request_profile: profile({domain: 'coding'}),
    routes: routesFor('coding', {price: {table: other, active: other, compiled: PRICE}})}));
  assert.equal(bound.tuple, 'claude-opus-5-5/medium');
});

test('the catalog contract: capability routes travel only beside a locally read profile of their domain', async t => {
  const bad = [
    {request_profile: profile({domain: 'coding'}), routes: routesFor('math')},
    {request_profile: profile({domain: null}), routes: routesFor('math')},
    {request_profile: {...profile({domain: null, classifier: 'keyword_v1', task_type: 'explain'}), domain: 'math'}, routes: null},
    {request_profile: profile({domain: 'cooking'}), routes: null},
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding'), policy: 'capability_delta0_v1'}},
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding'), schema: 1}},
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding'), pools: {anthropic_shared: []}}},
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding'),
      pools: {openai_codex: [{model: 'gpt-6.1-sol', effort: 'none'}], anthropic_shared: []}}},
    // DESIGN-4: the choice's own rules.
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding', {choice: 'broad'}),
      pools: routesFor('coding').pools}},
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding'), marker: null}},
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding'), marker: 'Not A Marker'}},
    {request_profile: profile({domain: 'math'}), routes: {...routesFor('math'), choice: 'writing_deliverable', marker: null}},
    {request_profile: profile({domain: 'science'}), routes: routesFor(null)},
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding'), references: {openai_codex: 'gpt-6-astra'}}},
    {request_profile: profile({domain: 'coding'}), routes: {...routesFor('coding'), price_basis: {table: PRICE, compiled: PRICE}}},
    {request_profile: {...profile({domain: null}), classifier: undefined, task_type: undefined}, routes: routesFor(null)},
  ];
  for (const options of bad) {
    const dir = await mkdtemp(join(tmpdir(), 'os1-capability-bad-')); await chmod(dir, 0o700);
    const q = task(), tickets = [];
    const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => catalog(q, options),
      execute: async ticket => { tickets.push(ticket); throw new Error('never'); }});
    try {
      await runtime.submit(q);
      const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});
      assert.equal(done.error, 'catalog_binding_invalid', JSON.stringify(options));
      assert.equal(tickets.length, 0);
    } finally { await runtime.close(); await rm(dir, {recursive: true, force: true}); }
  }
});

// ---- The durable Core: delivery, the one escalation, the ledger. ----------
function completed(ticket, patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'fixture answer',
    native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null, native_turn_terminated: true, ...patch};
}
async function harness(t, execute, {q = task(), c = null} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-capability-')); await chmod(dir, 0o700);
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => c ?? catalog(q),
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); }});
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });
  await runtime.submit(q);
  const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 6000});
  const text = await readFile(join(dir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8');
  return {done, tickets, saved: runtime._load(q.task_id), text,
    ledger: text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))};
}
const tuple = ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`;

test('a read-only deep answer is delivered on its screen, labelled capability, never certified', async t => {
  const {done, tickets, saved, ledger, text} = await harness(t, ticket => completed(ticket));
  assert.deepEqual(tickets.map(tuple), ['claude-opus-5-5/max']);
  assert.equal(done.result.output, 'fixture answer');
  assert.equal(done.result.parity_state, 'unverified');
  assert.equal(saved.children[0].route_kind, 'capability');
  assert.match(saved.children[0].routing_decision.reason, /;admitted_capability_science;/);
  const [record] = ledger;
  assert.deepEqual({route_class: record.route_class, route_kind: record.route_kind, delivery_basis: record.delivery_basis,
    check_id: record.check_id, check_outcome: record.check_outcome, check_label: record.check_label, escalated: record.escalated},
  {route_class: 'deep', route_kind: 'capability', delivery_basis: 'capability:science', check_id: null,
    check_outcome: 'screen_pass', check_label: null, escalated: false});
  const report = auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]});
  assert.equal(report.verdict, 'PASS', JSON.stringify(report.violations));
  assert.deepEqual(report.capability, {attempts: 1, possibly_delivered: 1});
});

test('a failure signal on a read-only capability attempt escalates exactly once to the reference', async t => {
  for (const [name, patch] of Object.entries({empty: {output: ' '}, error: {error: 'native_tool_failed'},
    unverified: {execution_verified: false, task_quality: 'unverified'}})) {
    const {done, tickets, saved, ledger, text} = await harness(t, (ticket, n) => n === 1 ? completed(ticket, patch) :
      completed(ticket, {output: 'reference answer'}));
    assert.deepEqual(tickets.map(tuple), ['claude-opus-5-5/max', 'claude-fable-5-1/max'], name);
    assert.equal(done.result.output, 'reference answer', name);
    assert.equal(saved.children[0].route_kind, 'reference', name);
    assert.equal(saved.children[0].ladder.escalated, true, name);
    assert.equal(ledger[0].delivery_basis, 'capability:science', name);
    assert.equal(ledger[0].escalation_outcome, 'escalated', name);
    assert.equal(ledger[1].delivery_basis, 'reference_escalated', name);
    assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]}).verdict, 'PASS', name);
  }
  // No headroom at bind: the reference runs alone.
  const q = task({budget: {max_native_dispatches: 1}});
  const {tickets, ledger, saved} = await harness(t, ticket => completed(ticket), {q});
  assert.deepEqual(tickets.map(tuple), ['gpt-6-astra/ultra']);
  assert.equal(ledger[0].delivery_basis, 'reference');
  assert.match(saved.children[0].routing_decision.reason, /;capability_science_requires_dispatch_headroom;/);
});

test('a writer runs once at its capability row and is never replayed on failure', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'os1-capability-writer-')); await chmod(workspace, 0o700);
  t.after(async () => { await rm(workspace, {recursive: true, force: true}); });
  const writerTask = () => task({request: '랜딩 페이지 카피 영어로 갈아끼워', write: true, workspace});
  const writerCatalog = q => catalog(q, {writer: true, candidates: rows({scope: 'workspace_write'}),
    request_profile: profile({answer_kind: 'unknown', task_type: 'write', domain: 'writing'}),
    routes: routesFor('writing', {pools: SOL_WRITING})});
  let q = writerTask();
  let run = await harness(t, ticket => completed(ticket), {q, c: writerCatalog(q)});
  assert.deepEqual(run.tickets.map(tuple), ['gpt-6.1-sol/high']);
  assert.equal(run.tickets[0].selected_config.scope, 'workspace_write');
  assert.equal(run.saved.children[0].route_kind, 'capability');
  assert.equal(run.saved.children[0].ladder, null);
  assert.deepEqual([run.ledger[0].delivery_basis, run.ledger[0].check_outcome, run.ledger[0].ladder],
    ['capability:writing', null, null]);
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text: run.text}]}).verdict, 'PASS');
  // A failed writer behaves as a failed reference writer: no ladder, no second attempt.
  q = writerTask();
  run = await harness(t, ticket => completed(ticket, {output: ' ', error: 'native_tool_failed'}), {q, c: writerCatalog(q)});
  assert.deepEqual(run.tickets.map(tuple), ['gpt-6.1-sol/high']);
  assert.equal(run.ledger.length, 1);
  assert.equal(run.ledger[0].escalation_outcome, null);
});

test('route-replay: a capability record is valid only as itself; a writer records no check', () => {
  const base = {schema: 1, task_id: 't', node_id: 'node_0', family: 'deep:read_only:agent', route_class: 'deep',
    scope: 'read_only', surface_kind: 'agent', surface: 'claude', quota_pool: 'anthropic_shared', model: 'claude-opus-5-5',
    effort: 'max', route_kind: 'capability', host_route_kind: null, reference_effort: 'max',
    ladder: {cheap_effort: 'max', reference_effort: 'max', cheap_model: 'claude-opus-5-5', reference_model: 'claude-fable-5-1'},
    tier: 'workhorse', escalated: false, usage: null, quota_remaining_fraction: 0.6, execution_verified: true,
    task_quality: 'execution_only', verifier_outcome: 'not_registered', attempt_state: 'completed',
    escalation_outcome: null, dispatched_failure: null, dispatched_at_ms: 1, settled_at_ms: 2,
    delivery_basis: 'capability:science', check_id: null, check_outcome: 'screen_pass', check_label: null, stratum: null};
  const audit = records => auditDeliveryPolicy({ledgers: [{path: 'f', text: records.map(r => JSON.stringify(r)).join('\n') + '\n'}]});
  const rules = report => report.violations.map(v => v.rule).sort();
  assert.equal(audit([{...base, attempt_id: 'a'}]).verdict, 'PASS');
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', check_outcome: 'not_run'}])), ['capability_delivery_without_screen_pass']);
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', check_id: 'x'}])), ['check_label_on_capability_basis']);
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', route_kind: 'graded'}])), ['capability_basis_route_mismatch']);
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', delivery_basis: 'reference', check_outcome: null}])),
    ['capability_route_without_capability_basis']);
  const writer = {...base, scope: 'workspace_write', family: 'deep:workspace_write:agent', ladder: null, check_outcome: null,
    delivery_basis: 'capability:writing'};
  assert.equal(audit([{...writer, attempt_id: 'w'}]).verdict, 'PASS');
  assert.deepEqual(rules(audit([{...writer, attempt_id: 'w', check_outcome: 'screen_pass'}])), ['check_outcome_on_capability_writer']);
});
