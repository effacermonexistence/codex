#!/usr/bin/env node
/** OS-1 build 447 (DESIGN-8): replay a recorded corpus under the routing law
 * and compare it with build 446 and with all-reference, in real quota (pool
 * units: Cw = % of the Claude weekly pool, Px = % of one Codex Pro weekly
 * pool). Zero quota: no provider, model or network; Core's own route
 * computation only.
 *
 *   node scripts/routing-law-replay.mjs --catalogs <sw446c.json> --routes446 <r446c.json> [--intents <intents.json>]
 *     [--rows <out.json>] [--remaining anthropic_shared=0.11,openai_codex=0.6 | --pools <pools.json>]
 *     [--owner-table <out.json> --extras <extras.json>]
 *   node scripts/routing-law-replay.mjs --catalogs <sw446c.json> --routes446 <r446c.json> --intents <intents.json> --extras <extras.json> --owner-fixture <out.json>
 *
 * `catalogs`: the build 446 harness rows (Swift-built catalogs, each with the
 * local model's recorded reading). Under the law each catalog carries what
 * the build 447 host sends instead: no capability routes, `routing_law` with
 * the recorded raw reading (plus the intent reading from `intents`, an
 * {index: "self_test"|"other"} map of live local intent calls) and the
 * owner's reference words (`reference_request`: Swift
 * RequestProfile.ownerAsksForReference, mirrored here from the Swift source's
 * own term and pattern lists), and the local row whenever the law may answer
 * locally (the same rule as Swift RCCNativeCatalogBuilder.lawMayAnswerLocally:
 * the reading alone; Core decides by the node's scope). Permissions (owner
 * scope, chat lane, profile) are unchanged: they are build 446's.
 *
 * Three arms per request, on the same catalog and headroom:
 *  - law447: the law;
 *  - build446: the recorded build 446 catalog (no routing_law);
 *  - all_reference: the law restricted to the pool references (the owner's
 *    reference words on every request: family P, the cheapest admissible pool
 *    reference at the same exchange). The calculator and the ask-back stay
 *    free in this arm too (the conservative baseline: it only makes
 *    all-reference cheaper).
 *
 * Headroom (`--remaining` or `--pools`, else the catalogs' recorded 0.6 for both
 * pools with no reset data): `--pools` is scripts/routing-law-pools.mjs output
 * (the pools' real rate-limit state from local files); its windows are carried
 * as routing_law.pools, shifted to each catalog's clock (the same share of
 * every window still to run), every row of a pool gets the pool's remaining
 * share, and an exhausted pool's rows are dropped, as the host's catalog
 * builder excludes them (quota_zero), in every arm.
 *
 * Each route is priced in REAL pool units, never summed 1:1, on three bases:
 *  - start: Q of the bound row for the request's cost shape (the law
 *    receipt's: the family's, agentic for a writer that does work);
 *  - draw: start + p_fail x Q(escalation target) for a laddered route, charged
 *    to the target's pool (the build's mechanics: a reference or a writer
 *    never escalates in 447); p_fail per the corrected law (lawPFail: a row
 *    with a ladder inherits its reference's p_fail for the family; the local
 *    row and 446's graded rows below their reference are priced the same way);
 *  - law_model: draw plus, for every route without a ladder, p_fail x Q(its
 *    repair step): a reference's own (itself), a writer's own pool reference
 *    (the law's own E[Q] accounting, correction 1).
 * Each basis is also priced at the exchange of the headroom (Core
 * lawPoolPrice): a relative index (pool units x that headroom's instantaneous
 * rate), not quota spent.
 *
 * The release gate (DESIGN-8 447, review of 447, gateOf): in both pools' real
 * units the law costs less than 446 and less than all-reference, and starts no
 * more requests on Astra than 446, judged
 *  - priced at a DERIVED exchange only (every pool's rate from a fresh
 *    observed window): the recorded catalogs' 0.6 / 0.6 with no reset data
 *    price both pools 1 / 0.6, the 1:1 sum, and are NO_DERIVED_EXCHANGE;
 *  - on both bases, draw (what 447 draws) and law_model (the E[Q] the argmin
 *    minimizes);
 *  - across headroom regimes (`--regimes`, scripts/routing-law-gate-regimes.json:
 *    fixed states plus, with `--pools`, the real state and the real Claude
 *    state with the owner's open Codex account-week), PASS only when every
 *    regime passes; per pool (no exchange at all), the break-even exchange
 *    and Astra starts per family are reported beside every verdict.
 *   node scripts/routing-law-replay.mjs ... --regimes <regimes.json> [--pools <pools.json>] [--out <sweep.json>] [--fail-on-gate yes]
 *   node scripts/routing-law-replay.mjs --owner-gate <owner fixture> --regimes <regimes.json>   (the build's gate) */
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, join} from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(pathToFileURL(join(ROOT, 'Resources/openclaw-os1-bridge/rcc-runtime.mjs')).href);
const {hostPlan, resolveRoutePlan, deliveryBasisOf, hostContextFingerprint, zeroModelArithmetic, configureLocalModel,
  routingLawTable, lawFamily, lawQuota, lawPFail, lawAskBack, lawPoolPrice, lawEvidence, lawTiers, dispatchable,
  ROUTING_LAW_TABLE_SHA256} = core;
configureLocalModel(process.env.LOCAL_MODEL ?? 'qwen3.5:9b');
const sha = text => createHash('sha256').update(text).digest('hex');

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}
export const POOL_UNIT = Object.freeze({anthropic_shared: 'Cw', openai_codex: 'Px', none: 'local'});
const POOLS = ['anthropic_shared', 'openai_codex'];
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

// The host's reference words (Swift RequestProfile.asksForReference): its
// fixed terms and its patterns, read from the Swift source itself so the
// replay never keeps its own copy. A replay approximation only (JS regular
// expressions on the same NFC-lowercased text); the host is the authority.
const PROFILE_SWIFT = readFileSync(join(ROOT, 'Sources/OS1Context/RequestProfile.swift'), 'utf8');
const QUALITY_TERMS = JSON.parse(/static let qualityRequestTerms = (\[[^\]]*\])/.exec(PROFILE_SWIFT)[1]);
const REFERENCE_PATTERNS = [.../static let referenceRequestPatterns = \[([\s\S]*?)\n {4}\]/.exec(PROFILE_SWIFT)[1]
  .matchAll(/#"([\s\S]*?)"#/g)].map(match => new RegExp(match[1], 'u'));
export function asksForReference(request) {
  const lower = request.normalize('NFC').toLowerCase();
  const escape = term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return QUALITY_TERMS.some(term => /^[\x00-\x7f]*$/.test(term) ?
    new RegExp('(?<![A-Za-z0-9])' + escape(term) + '(?![A-Za-z0-9])').test(lower) : lower.includes(term)) ||
    REFERENCE_PATTERNS.some(pattern => pattern.test(lower));
}
/** Swift RequestProfile.ownerAsksForReference: the reference words, unless the
 * local reading cleared them as the owner's own thinking (a floor is never
 * clearable, so a cleared rule is never a floor). */
export function ownerAsksForReference(request, profile) {
  return asksForReference(request) && !(profile?.signals ?? []).includes('soft_cleared_quality');
}

export function lawCatalog(row, intent) {
  const catalog = structuredClone(row.catalog);
  delete catalog.capability_routes;
  const answer = row.receipt?.outcome === 'adopted' ? row.receipt.answer : null;
  const reading = answer ? {task_type: answer.task_type, difficulty: answer.difficulty, needs_tools: answer.needs_tools,
    domain: answer.domain ?? 'general', ...(intent ? {intent} : {})} : null;
  catalog.routing_law = {schema: 1, policy: 'law_447', table_sha256: ROUTING_LAW_TABLE_SHA256,
    reader: reading ? 'local_llm:' + (row.receipt.model ?? 'qwen3.5:9b') : 'none', reading,
    reference_request: ownerAsksForReference(row.request, catalog.request_profile)};
  const local = reading && reading.needs_tools === 'none' && reading.difficulty === 'light';
  if (local && !catalog.candidates.some(c => c.surface === 'local')) {
    const at = Math.max(...catalog.candidates.map(c => c.availability_observed_at_ms ?? 0));
    catalog.candidates.push({account_id: 'os1-local', allowed_paths: [], availability: 'available',
      availability_observed_at_ms: at, availability_valid_until_ms: at + 120000,
      configuration_sha256: sha('os1-fixture-local-row'), effort: 'none', estimated_cost_units: 0,
      id: 'cfg-' + sha('os1-fixture-local-row').slice(0, 32), model: 'qwen3.5:9b', permission_profile: 'read_only',
      quality_state: 'policy_admitted', quota_observed_at_ms: null, quota_pool: 'none', quota_remaining_fraction: null,
      quota_valid_until_ms: null, scope: 'read_only', surface: 'local', tools: [], transport: 'local'});
  }
  return catalog;
}

function taskOf(request, catalog) {
  const policyText = 'fixture policy';
  const host = {workspace: '/tmp/rcc-cls-run', context: null, provider_preference: 'auto',
    codex_session_id: null, claude_session_id: null, require_read_only: false, owner_policy: null};
  return {schema: 1, task_id: catalog.task_id, request, request_sha256: catalog.request_sha256, objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60000, max_native_dispatches: 16},
    host_context: host, policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText},
    ...(catalog.routing_intent_v2 === undefined ? {} : {routing_intent_policy_version: catalog.routing_intent_v2.version})};
}
/** The replay's clock for a catalog: just after its newest observation. */
export function clockOf(catalog) {
  return Math.max(...catalog.candidates.map(c => c.availability_observed_at_ms ?? 0)) + 1;
}

/** One request's route: calculator, ask-back, or Core's bound row. */
export function routeOf(request, catalog) {
  const exact = zeroModelArithmetic(request);
  if (exact !== null) return {route: 'calculator:' + exact, kind: 'calculator', candidate: null};
  const task = taskOf(request, catalog);
  const ask = catalog.routing_law ? lawAskBack(task, catalog) : null;
  if (ask) return {route: 'local:ask_back', kind: 'ask_back', candidate: null, law: ask.receipt};
  const plan = hostPlan(task, catalog);
  const at = clockOf(catalog);
  const {decisions, routes} = resolveRoutePlan(plan, task, catalog, at);
  const id = plan.final_node_id ?? plan.nodes[0].id;
  const decision = decisions[id], route = routes[id];
  const candidate = catalog.candidates.find(c => c.id === decision.resolved_candidate_id);
  return {route: `${candidate.surface}:${candidate.model}@${candidate.effort}`, kind: route.kind, candidate,
    ladder: route.ladder ?? null, scope: plan.nodes[0].scope, law: route.law ?? null,
    basis: deliveryBasisOf({routeClass: decision.route_class, routeKind: route.kind, ladder: route.ladder ?? null,
      reason: decision.reason}), reason: decision.reason};
}

/** A catalog at a headroom setting: null or {kind: 'recorded'} (as recorded),
 * {kind: 'remaining', remaining: {pool: share}} or {kind: 'pools', pools,
 * generated_at_ms} (routing-law-pools.mjs output, shifted to this catalog's
 * clock; the law arm carries it as routing_law.pools). An exhausted pool's
 * rows are dropped (the host's quota_zero exclusion). */
export function atHeadroom(catalog, headroom = null) {
  if (!headroom || headroom.kind === 'recorded') return catalog;
  let remaining = headroom.remaining ?? {}, pools = null;
  if (headroom.kind === 'pools') {
    const shift = clockOf(catalog) - headroom.generated_at_ms;
    pools = Object.fromEntries(POOLS.map(pool => {
      const state = headroom.pools[pool] ?? null;
      return [pool, state === null ? null : {observed_at_ms: state.observed_at_ms + shift, valid_until_ms: state.valid_until_ms + shift,
        windows: state.windows.map(w => ({used_percent: w.used_percent, resets_at_ms: w.resets_at_ms + shift,
          window_minutes: w.window_minutes}))}];
    }));
    remaining = Object.fromEntries(Object.entries(pools).filter(([, state]) => state !== null)
      .map(([pool, state]) => [pool, Math.min(...state.windows.map(w => Math.max(0, 1 - w.used_percent / 100)))]));
  }
  const out = {...catalog, candidates: catalog.candidates
    .filter(row => !(Object.hasOwn(remaining, row.quota_pool) && remaining[row.quota_pool] <= 0))
    .map(row => Object.hasOwn(remaining, row.quota_pool) ? {...row, quota_remaining_fraction: remaining[row.quota_pool]} : row)};
  if (pools && catalog.routing_law) out.routing_law = {...catalog.routing_law, pools};
  return out;
}
/** Back-compatible: every row of a pool at the given remaining share. */
export function atRemaining(catalog, remaining = null) {
  return remaining ? atHeadroom(catalog, {kind: 'remaining', remaining}) : catalog;
}

/** Each pool's derived exchange on a (law) catalog at its clock, as Core
 * prices it (lawPoolPrice over the pool's dispatchable rows). */
export function ratesOf(catalog) {
  const at = clockOf(catalog);
  return Object.fromEntries(POOLS.map(pool => {
    const shares = catalog.candidates.filter(c => c.quota_pool === pool && dispatchable(c, null, at) &&
      typeof c.quota_remaining_fraction === 'number').map(c => c.quota_remaining_fraction);
    return [pool, lawPoolPrice(catalog, pool, at, shares.length ? Math.min(...shares) : null)];
  }));
}

/** The repair step a route's failures would take (correction 1's law model):
 * its ladder's reference; a reference itself; any other bound row (a writer,
 * a capability writer) its own pool's reference row, highest dispatch effort. */
function repairOf(result, catalog, table) {
  const c = result.candidate;
  if (result.ladder?.reference_candidate_id) return catalog.candidates.find(row => row.id === result.ladder.reference_candidate_id) ?? null;
  if (result.kind === 'reference' || c.model === table.references[c.quota_pool]) return c;
  return catalog.candidates.filter(row => row.quota_pool === c.quota_pool && row.model === table.references[c.quota_pool] &&
    row.scope === c.scope).sort((a, b) => EFFORT_ORDER.indexOf(b.effort) - EFFORT_ORDER.indexOf(a.effort))[0] ?? null;
}
/** The p_fail Core charges a bound row (review of 447: the replay inherits
 * from the same reference as Core): the local row and a pool reference their
 * own Laplace estimate; any other row its OWN pool's listed reference's
 * p_fail for the family (Core listedReferenceOf), plus the measured gap below
 * that reference on the matched tiers (lawEvidence excess). */
export function pFailOf(result, catalog, table, family, reading) {
  const c = result.candidate;
  if (c.surface === 'local' || result.kind === 'reference' || c.model === table.references[c.quota_pool]) return lawPFail(table, c, family);
  const own = catalog.candidates.filter(row => row.quota_pool === c.quota_pool && row.model === table.references[c.quota_pool] &&
    row.scope === c.scope).sort((a, b) => EFFORT_ORDER.indexOf(b.effort) - EFFORT_ORDER.indexOf(a.effort))[0] ??
    repairOf(result, catalog, table);
  if (!own) return lawPFail(table, c, family);
  const tiers = family === 'P' ? [] : lawTiers(table, family, reading ?? null, result.scope === 'workspace_write');
  const excess = tiers.length ? lawEvidence(table, tiers, c.quota_pool, c.model, c.effort, family).excess ?? 0 : 0;
  return Math.min(1, lawPFail(table, c, family, own) + excess);
}
/** A bound route's real draws per pool on the three bases (see the header). */
export function priceRoute(result, catalog, shape, table = routingLawTable(), family = null, reading = null) {
  const zero = () => ({Cw: 0, Px: 0});
  const out = {pool: 'none', q: 0, start: zero(), draw: zero(), law_model: zero(), unpriced: false, p_fail: 0};
  if (!result.candidate) return out;
  const c = result.candidate;
  const q = lawQuota(table, c, shape)?.q ?? null;
  out.pool = c.quota_pool;
  if (q === null) return {...out, q: null, unpriced: true};
  out.q = q;
  const unit = POOL_UNIT[c.quota_pool];
  if (unit !== 'local') { out.start[unit] += q; out.draw[unit] += q; out.law_model[unit] += q; }
  const repair = repairOf(result, catalog, table);
  if (!repair) return out;
  const qr = lawQuota(table, repair, shape)?.q ?? 0;
  const repairUnit = POOL_UNIT[repair.quota_pool];
  const p = pFailOf(result, catalog, table, family, reading);
  out.p_fail = p;
  if (repairUnit === 'local') return out;
  if (result.ladder?.reference_candidate_id) out.draw[repairUnit] += p * qr;
  out.law_model[repairUnit] += p * qr;
  return out;
}

function addTo(total, priced, rates) {
  for (const basis of ['start', 'draw', 'law_model']) {
    for (const unit of ['Cw', 'Px']) total[basis][unit] += priced[basis][unit];
    total[basis].priced += POOLS.reduce((sum, pool) => {
      const value = priced[basis][POOL_UNIT[pool]];
      return value === 0 ? sum : sum + value * rates[pool].price;
    }, 0);
  }
}
const emptyTotals = () => Object.fromEntries(['start', 'draw', 'law_model'].map(b => [b, {Cw: 0, Px: 0, priced: 0}]));
const r4 = value => Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : value === Infinity ? 'infinite' : value;

/** One request on the three arms at a headroom setting. */
export function armsOf(row, intent, headroom = null, table = routingLawTable()) {
  const law = atHeadroom(lawCatalog(row, intent), headroom);
  const b446 = atHeadroom(row.catalog, headroom);
  const attempt = (request, catalog) => {
    try { return routeOf(request, catalog); } catch (error) { return {route: 'core_error:' + error.message, candidate: null, error: true}; }
  };
  const mine = attempt(row.request, law);
  const theirs = attempt(row.request, b446);
  const allRef = mine.kind === 'calculator' || mine.kind === 'ask_back' ? mine :
    attempt(row.request, {...law, routing_law: {...law.routing_law, reference_request: true}});
  // The law's family (P for the owner's reference words) and the cost shape
  // the law priced the request with (the same work for every arm).
  const family = mine.law?.family ?? lawFamily(law.routing_law.reading, table);
  const shape = mine.law?.shape ?? table.families[family]?.shape ?? 'answer';
  const rates = ratesOf(law);
  const price = (result, catalog) => result.error ? {pool: 'none', q: null, unpriced: true, start: {Cw: 0, Px: 0},
    draw: {Cw: 0, Px: 0}, law_model: {Cw: 0, Px: 0}, p_fail: 0} : priceRoute(result, catalog, shape, table, family,
      law.routing_law.reading);
  return {family, shape, rates, law, reading: law.routing_law.reading,
    arms: {law447: {result: mine, priced: price(mine, law)}, build446: {result: theirs, priced: price(theirs, b446)},
      all_reference: {result: allRef, priced: price(allRef, law)}}};
}

const ARMS = ['law447', 'build446', 'all_reference'];
const BASES = ['draw', 'law_model'];
/** Per pool (no exchange): a <= b in Cw and in Px, strictly lower in one. */
function paretoBelow(a, b) {
  return a.Cw <= b.Cw + 1e-12 && a.Px <= b.Px + 1e-12 && (a.Cw < b.Cw - 1e-12 || a.Px < b.Px - 1e-12);
}
/** Whether a headroom carries a DERIVED exchange (review of 447): every pool's
 * price from a fresh observed window (an exhausted pool included: it cannot be
 * drawn). The recorded catalogs' 0.6/0.6 with no reset data price both pools
 * 1/0.6 by the conservative fallback: that is the 1:1 sum, not an exchange. */
export function derivedExchange(rates) {
  return rates !== null && POOLS.every(pool => rates[pool]?.basis === 'observed_window');
}
/** The exchange x = price(Cw) / price(Px) at which law447 and the other arm
 * cost the same with the routes held fixed: law447 is cheaper for x below it
 * ('below') or above it ('above'), at any x ('always') or none ('never'). */
export function breakEven(me, other) {
  const dC = me.Cw - other.Cw, dP = other.Px - me.Px;
  if (Math.abs(dC) < 1e-12) return {x: null, cheaper_when: dP > 1e-12 ? 'always' : 'never'};
  const x = dP / dC + 0; // + 0: no negative zero
  if (dC > 0) return {x: r4(x), cheaper_when: x > 0 ? 'below' : 'never'};
  return {x: r4(x), cheaper_when: x <= 0 ? 'always' : 'above'};
}
/** The release gate at one headroom (DESIGN-8 447, review of 447): against
 * 446 and against all-reference, on BOTH bases (draw: what 447 actually draws;
 * law_model: the E[Q] the argmin minimizes, references charged their own
 * repair), law447 must cost less priced at the DERIVED exchange of that
 * headroom (never at the 1:1 fallback: no derived exchange is
 * NO_DERIVED_EXCHANGE, never a PASS). Astra starts are reported, not gated
 * (owner, 2026-10-30: one law decides). Per pool (no exchange at all) and the break-even exchange are reported
 * next to every priced verdict. Priced totals are relative indices (pool units
 * x that headroom's instantaneous rate), not quota spent. */
export function gateOf(totals, astra, rates = null) {
  const derived = derivedExchange(rates);
  const x = derived ? (rates.anthropic_shared.price === Infinity ? 'infinite' : rates.openai_codex.price === Infinity ? 0 :
    r4(rates.anthropic_shared.price / rates.openai_codex.price)) : null;
  const verdict = {derived_exchange: derived, exchange_Cw_per_Px: x};
  for (const basis of ['start', ...BASES]) {
    const me = totals.law447[basis];
    verdict[basis] = Object.fromEntries(['build446', 'all_reference'].map(arm => {
      const other = totals[arm][basis];
      return [arm, {per_pool: paretoBelow(me, other) ? 'PASS' : 'FAIL',
        priced: !derived ? 'NO_DERIVED_EXCHANGE' : me.priced < other.priced - 1e-12 ? 'PASS' : 'FAIL',
        break_even_Cw_per_Px: breakEven(me, other),
        ratio_Cw: other.Cw ? r4(me.Cw / other.Cw) : null, ratio_Px: other.Px ? r4(me.Px / other.Px) : null,
        ratio_priced: other.priced ? r4(me.priced / other.priced) : null}];
    }));
  }
  verdict.astra = {law447: astra.law447, build446: astra.build446, verdict: astra.law447 <= astra.build446 ? 'PASS' : 'FAIL'};
  const priced = BASES.every(basis => ['build446', 'all_reference'].every(arm => verdict[basis][arm].priced === 'PASS'));
  // Owner, 2026-10-30: the law decides, not hand-added proxies. The release
  // verdict is the objective only (priced at the derived exchange on both
  // bases); Astra starts and per-pool totals stay reported, never gating.
  verdict.release = !derived ? 'NO_DERIVED_EXCHANGE' : priced ? 'PASS' : 'FAIL';
  verdict.release_parts = {priced_both_bases: derived ? (priced ? 'PASS' : 'FAIL') : 'NO_DERIVED_EXCHANGE',
    astra: verdict.astra.verdict,
    per_pool_draw: verdict.draw.build446.per_pool === 'PASS' && verdict.draw.all_reference.per_pool === 'PASS' ? 'PASS' : 'FAIL'};
  return verdict;
}
/** Astra starts per family on every arm (review of 447: an aggregate can hide
 * a family that got worse). */
function astraByFamily(rows) {
  const out = {};
  for (const row of rows) for (const arm of ARMS) if (row[arm].route.includes('gpt-6-astra')) {
    out[row.family] ??= Object.fromEntries(ARMS.map(a => [a, 0]));
    out[row.family][arm]++;
  }
  return Object.fromEntries(Object.entries(out).sort().map(([family, counts]) =>
    [family, {...counts, worse_than_446: counts.law447 > counts.build446}]));
}
const ratesView = rates => rates && Object.fromEntries(POOLS.map(pool => [POOL_UNIT[pool], {rate: r4(rates[pool].price),
  basis: rates[pool].basis, remaining: r4(rates[pool].remaining), ttr: r4(rates[pool].ttr)}]));

export function replay(catalogRows, routes446, intents = {}, headroom = null) {
  const table = routingLawTable();
  const by446 = new Map(routes446.map(row => [row.index, row]));
  const rows = [], totals = Object.fromEntries(ARMS.map(arm => [arm, emptyTotals()]));
  let rates = null;
  for (const row of catalogRows) {
    if (!row.catalog) continue;
    const r = armsOf(row, intents[row.index] ?? null, headroom, table);
    rates ??= r.rates;
    for (const arm of ARMS) addTo(totals[arm], r.arms[arm].priced, r.rates);
    const recorded = by446.get(row.index)?.route ?? null;
    const view = arm => ({route: r.arms[arm].result.route, kind: r.arms[arm].result.kind ?? null, pool: POOL_UNIT[r.arms[arm].priced.pool],
      q: r.arms[arm].priced.q, draw: r.arms[arm].priced.draw, law_model: r.arms[arm].priced.law_model, p_fail: r.arms[arm].priced.p_fail});
    rows.push({index: row.index, group: row.group, request: row.request, family: r.family, shape: r.shape, reading: r.reading,
      route446_recorded: recorded, law447: {...view('law447'), basis: r.arms.law447.result.basis ?? null,
        argmin: r.arms.law447.result.law?.argmin ?? null, eq: r.arms.law447.result.law?.eq ?? null,
        candidates: r.arms.law447.result.law?.candidates?.length ?? null, rates: r.arms.law447.result.law?.rates ?? null,
        reason: r.arms.law447.result.reason ?? null},
      build446: view('build446'), all_reference: view('all_reference')});
  }
  const astra = Object.fromEntries(ARMS.map(arm => [arm, rows.filter(r => r[arm].route.includes('gpt-6-astra')).length]));
  const rounded = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(Object.entries(totals[arm]).map(([basis, v]) =>
    [basis, {Cw: r4(v.Cw), Px: r4(v.Px), priced: r4(v.priced)}]))]));
  return {table_sha256: ROUTING_LAW_TABLE_SHA256, rows,
    summary: {requests: rows.length, headroom: headroomLabel(headroom),
      rates: ratesView(rates),
      priced_note: 'priced = pool units x the headroom\'s instantaneous rate: a relative index, not quota spent',
      routes_changed_vs_446: rows.filter(r => r.law447.route !== r.build446.route).length,
      reproduces_recorded_446: headroom ? null :
        rows.filter(r => r.build446.route === (r.route446_recorded ?? '').replace(/\/(?=[^/]*$)/, '@')).length,
      core_errors: Object.fromEntries(ARMS.map(arm => [arm, rows.filter(r => r[arm].route.startsWith('core_error')).length])),
      free: Object.fromEntries(ARMS.map(arm => [arm, rows.filter(r => r[arm].q === 0).length])),
      astra_starts: astra, astra_by_family: astraByFamily(rows), totals: rounded, gate: gateOf(totals, astra, rates)}};
}
function headroomLabel(headroom) {
  return headroom?.kind === 'pools' ? {kind: 'pools', ...(headroom.name ? {name: headroom.name} : {}),
    generated_at: new Date(headroom.generated_at_ms).toISOString()} : headroom ?? 'recorded (0.6 both pools, no reset data)';
}

// DESIGN-7 §5: the 16 owner fixed questions, their corpus rows (or 'extra'
// for the two that are not in the corpus) and DESIGN-7's own route, for
// comparison only: the fixture's expected route is the law's output.
export const OWNER_QUESTIONS = Object.freeze([
  [1, 0, 'local:calculator'], [2, 1, 'claude-chat:claude-opus-5-5@max'], [3, 2, 'claude-chat:claude-opus-5-5@max'],
  [4, 3, 'claude-chat:claude-opus-5-5@max'], [5, 4, 'claude-chat:claude-opus-5-5@medium'],
  [6, 5, 'claude:claude-opus-5-5@medium'], [7, 6, 'codex:gpt-6.1-sol@medium'], [8, 7, 'local:ask_back'],
  [9, 'extra9', 'local:ask_back'], [10, 8, 'local:qwen3.5:9b'], [11, 9, 'local:qwen3.5:9b'],
  [12, 366, 'local:qwen3.5:9b'], [13, 367, 'local:calculator'], [14, 368, 'local:calculator'],
  [15, 369, 'local:calculator'], [16, 'extra16', 'claude-chat:claude-opus-5-5@max']]);
function ownerRows(catalogRows, intents, extras) {
  return OWNER_QUESTIONS.map(([n, source, design7]) => {
    if (typeof source === 'number')
      return {n, design7, source, origin: 'r446c#' + source, row: {...catalogRows[source], intent: intents[String(source)] ?? null}};
    const extra = extras[source];
    if (!extra) return {n, design7, source, pending: 'no live local reading recorded'};
    return {n, design7, source, origin: `live local reading ${extra.read_at}; host facts of r446c#${extra.facts_from}`,
      row: {request: extra.request, catalog: structuredClone(catalogRows[extra.facts_from].catalog), receipt: extra.receipt,
        intent: extra.intent ?? null}};
  });
}
/** The owner-question fixture: each question's Swift-built build-446
 * catalog (the corpus row's, or for an extra question the catalog of the
 * corpus row whose host facts it shares, named), its recorded local reading
 * (an extra: a live reading, recorded), and as expected route the law's own
 * output; the build 446 route of the same catalog is kept for the rollback. */
export function ownerFixture(catalogRows, routes446, intents = {}, extras = {}) {
  const recorded446 = new Map(routes446.map(row => [row.index, row.route]));
  return {schema: 1, table_sha256: ROUTING_LAW_TABLE_SHA256,
    note: 'DESIGN-7 §5 owner fixed questions; expected_route is the routing law output (golden) at the recorded headroom ' +
      '(no derived exchange: both pools 1 / 0.6), never hand-set; flags mark an Astra start and a route that differs from ' +
      'build 446\'s (review of 447); design7_route is DESIGN-7 for comparison only; the per-regime routes are the sweep\'s',
    questions: ownerRows(catalogRows, intents, extras).map(({n, design7, source, origin, row, pending}) => {
      if (pending) return {n, pending};
      const law = lawCatalog(row, row.intent);
      const routed = routeOf(row.request, law);
      const route446 = routeOf(row.request, row.catalog).route;
      // Review of 447: a golden route is never pinned silently where it starts
      // Astra (the owner's complaint) or leaves build 446's route: flagged.
      const flags = [...(routed.route.includes('gpt-6-astra') ? ['astra_start'] : []),
        ...(routed.route.includes('gpt-6-astra') && !route446.includes('gpt-6-astra') ? ['astra_where_446_was_not'] : []),
        ...(routed.route !== route446 ? ['differs_from_446'] : [])];
      return {n, request: row.request, origin, receipt: row.receipt, intent: row.intent, catalog: row.catalog,
        expected_route: routed.route, expected_kind: routed.kind ?? null, flags,
        expected_family: routed.kind === 'calculator' ? 'F0' : routed.law?.family ?? lawFamily(law.routing_law.reading, routingLawTable()),
        route_446: route446,
        recorded_446: typeof source === 'number' ? recorded446.get(source) ?? null : null, design7_route: design7};
    })};
}
/** The 16 owner questions on the three arms at a headroom, in real pool units. */
export function ownerTable(catalogRows, intents = {}, extras = {}, headroom = null) {
  const table = routingLawTable();
  const totals = Object.fromEntries(ARMS.map(arm => [arm, emptyTotals()]));
  const questions = [];
  let rates = null;
  for (const {n, design7, origin, row, pending} of ownerRows(catalogRows, intents, extras)) {
    if (pending) { questions.push({n, pending}); continue; }
    const r = armsOf(row, row.intent, headroom, table);
    rates ??= r.rates;
    for (const arm of ARMS) addTo(totals[arm], r.arms[arm].priced, r.rates);
    const view = arm => ({route: r.arms[arm].result.route, pool: POOL_UNIT[r.arms[arm].priced.pool], q: r.arms[arm].priced.q,
      draw: Object.fromEntries(Object.entries(r.arms[arm].priced.draw).map(([k, v]) => [k, r4(v)])),
      law_model: Object.fromEntries(Object.entries(r.arms[arm].priced.law_model).map(([k, v]) => [k, r4(v)]))});
    questions.push({n, request: row.request, origin, family: r.family, shape: r.shape, design7_route: design7,
      law447: {...view('law447'), eq: r.arms.law447.result.law?.eq ?? null}, build446: view('build446'),
      all_reference: view('all_reference')});
  }
  const astra = Object.fromEntries(ARMS.map(arm => [arm, questions.filter(q => q[arm]?.route?.includes('gpt-6-astra')).length]));
  const rounded = Object.fromEntries(ARMS.map(arm => [arm, Object.fromEntries(Object.entries(totals[arm]).map(([basis, v]) =>
    [basis, {Cw: r4(v.Cw), Px: r4(v.Px), priced: r4(v.priced)}]))]));
  return {table_sha256: ROUTING_LAW_TABLE_SHA256, headroom: headroomLabel(headroom), rates: ratesView(rates),
    priced_note: 'priced = pool units x the headroom\'s instantaneous rate: a relative index, not quota spent',
    questions, astra_starts: astra, totals: rounded, gate: gateOf(totals, astra, rates)};
}

/** A gate regime as a pools headroom (review of 447: the gate is judged
 * across headroom states, never on one snapshot): each pool one weekly window
 * at `used_percent` with `ttr` of the week still to run, observed at `at`; a
 * pool given as `{from: 'pools'}` keeps the real pools file's observation, and
 * `{from: 'open_codex_account'}` the real file's open Codex account-week with
 * the most allowance left (the owner's other account OS-1 could dispatch
 * through). The rates follow from Core lawPoolPrice; nothing here is a price. */
export function regimeHeadroom(regime, real = null, at = null) {
  const now = at ?? (real ? Date.parse(real.generated_at) : Date.UTC(2026, 9, 30));
  const week = 10080 * 60000;
  const pools = {};
  for (const pool of POOLS) {
    const spec = regime[pool];
    if (spec?.from === 'pools') {
      if (!real?.pools?.[pool]) throw new Error('regime ' + regime.name + ' needs the real pools file for ' + pool);
      pools[pool] = real.pools[pool];
    } else if (spec?.from === 'open_codex_account') {
      const open = (real?.sources?.codex?.account_weeks ?? []).filter(w => w.open_at_now && w.window_minutes === 10080)
        .sort((a, b) => a.last_used_percent - b.last_used_percent)[0];
      if (!open) throw new Error('regime ' + regime.name + ': no open Codex account-week in the pools file');
      pools[pool] = {observed_at_ms: now, valid_until_ms: now + 600000,
        windows: [{used_percent: open.last_used_percent, resets_at_ms: Date.parse(open.resets_at), window_minutes: 10080}]};
    } else if (spec && Number.isFinite(spec.used_percent) && Number.isFinite(spec.ttr)) {
      pools[pool] = {observed_at_ms: now, valid_until_ms: now + 600000,
        windows: [{used_percent: spec.used_percent, resets_at_ms: now + Math.round(spec.ttr * week), window_minutes: 10080}]};
    } else throw new Error('bad regime ' + regime.name + ' ' + pool);
  }
  return {kind: 'pools', name: regime.name, pools, generated_at_ms: now};
}
/** The release gate across every regime: PASS only when each regime with a
 * derived exchange passes on both bases and on Astra starts. */
export function sweep(catalogRows, routes446, intents, regimes, real = null, extras = null) {
  const out = {};
  for (const regime of regimes) {
    const headroom = regimeHeadroom(regime, real);
    const corpus = replay(catalogRows, routes446, intents, headroom).summary;
    const owner = extras ? ownerTable(catalogRows, intents, extras, headroom) : null;
    out[regime.name] = {spec: regime, rates: corpus.rates, astra_starts: corpus.astra_starts,
      astra_by_family: corpus.astra_by_family, totals: corpus.totals, gate: corpus.gate,
      ...(owner ? {owner_table: {astra_starts: owner.astra_starts, totals: owner.totals, gate: owner.gate,
        routes: owner.questions.map(q => ({n: q.n, family: q.family, law447: q.law447?.route ?? null,
          build446: q.build446?.route ?? null, all_reference: q.all_reference?.route ?? null}))}} : {})};
  }
  const verdicts = Object.fromEntries(Object.entries(out).map(([name, r]) => [name, r.gate.release]));
  return {table_sha256: ROUTING_LAW_TABLE_SHA256, regimes: out, release: {per_regime: verdicts,
    verdict: Object.values(verdicts).every(v => v === 'PASS') ? 'PASS' : 'FAIL'}};
}

export function headroomOf(o) {
  if (o.pools) {
    const file = JSON.parse(readFileSync(o.pools, 'utf8'));
    return {kind: 'pools', pools: file.pools, generated_at_ms: Date.parse(file.generated_at)};
  }
  if (o.remaining) return {kind: 'remaining', remaining: Object.fromEntries(o.remaining.split(',').map(pair => {
    const [pool, value] = pair.split('=');
    if (!POOLS.includes(pool) || !(Number(value) >= 0 && Number(value) <= 1)) throw new Error('bad --remaining ' + pair);
    return [pool, Number(value)];
  }))};
  return null;
}

/** The build's zero-quota release gate (review of 447): the committed owner
 * fixture's recorded catalogs and readings at every fixed regime of the gate
 * file (no real pools file: the build reads nothing outside the repository).
 * The 370-request corpus sweep lives with the artifacts and is the lead's. */
export function ownerGate(fixture, regimes) {
  const live = fixture.questions.filter(q => !q.pending && q.catalog);
  const rows = live.map(q => ({index: q.n, request: q.request, catalog: q.catalog, receipt: q.receipt}));
  const intents = Object.fromEntries(live.filter(q => q.intent).map(q => [q.n, q.intent]));
  return sweep(rows, [], intents, regimes.filter(r => !Object.values(r).some(v => v?.from)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const o = options(process.argv.slice(2));
  if (o['owner-gate']) {
    const result = ownerGate(JSON.parse(readFileSync(o['owner-gate'], 'utf8')), JSON.parse(readFileSync(o.regimes, 'utf8')).regimes);
    for (const [name, r] of Object.entries(result.regimes))
      process.stdout.write(`routing law gate ${name}: ${r.gate.release} (astra ${r.astra_starts.law447} vs 446 ` +
        `${r.astra_starts.build446}; priced vs 446 draw ${r.gate.draw.build446.ratio_priced} law_model ` +
        `${r.gate.law_model.build446.ratio_priced}; vs all-reference draw ${r.gate.draw.all_reference.ratio_priced} law_model ` +
        `${r.gate.law_model.all_reference.ratio_priced})\n`);
    process.stdout.write(`routing law gate (owner fixture, ${Object.keys(result.regimes).length} regimes): ${result.release.verdict}\n`);
    process.exit(result.release.verdict === 'PASS' ? 0 : 1);
  }
  const catalogs = JSON.parse(readFileSync(o.catalogs, 'utf8'));
  const routes446 = JSON.parse(readFileSync(o.routes446, 'utf8'));
  const intents = o.intents ? JSON.parse(readFileSync(o.intents, 'utf8')) : {};
  const extras = o.extras ? JSON.parse(readFileSync(o.extras, 'utf8')) : {};
  const headroom = headroomOf(o);
  if (o['owner-fixture']) {
    writeFileSync(o['owner-fixture'], JSON.stringify(ownerFixture(catalogs, routes446, intents, extras)) + '\n');
    process.exit(0);
  }
  if (o.regimes) {
    const spec = JSON.parse(readFileSync(o.regimes, 'utf8'));
    const real = o.pools ? JSON.parse(readFileSync(o.pools, 'utf8')) : null;
    const regimes = spec.regimes.filter(r => real || !Object.values(r).some(v => v?.from));
    const result = sweep(catalogs, routes446, intents, regimes, real, o.extras ? extras : null);
    if (o.out) writeFileSync(o.out, JSON.stringify(result, null, 1) + '\n');
    process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(result.regimes).map(([name, r]) => [name,
      {rates: Object.fromEntries(Object.entries(r.rates).map(([unit, v]) => [unit, v.rate])), astra: r.astra_starts,
        release: r.gate.release, parts: r.gate.release_parts,
        draw: {b446: r.gate.draw.build446.ratio_priced, allref: r.gate.draw.all_reference.ratio_priced},
        law_model: {b446: r.gate.law_model.build446.ratio_priced, allref: r.gate.law_model.all_reference.ratio_priced}}])
      .concat([['release', result.release.verdict]])), null, 1) + '\n');
    process.exit(o['fail-on-gate'] === 'yes' && result.release.verdict !== 'PASS' ? 1 : 0);
  }
  if (o['owner-table']) {
    const result = ownerTable(catalogs, intents, extras, headroom);
    writeFileSync(o['owner-table'], JSON.stringify(result, null, 1) + '\n');
    process.stdout.write(JSON.stringify({rates: result.rates, astra_starts: result.astra_starts, totals: result.totals,
      gate: result.gate}, null, 1) + '\n');
    process.exit(0);
  }
  const result = replay(catalogs, routes446, intents, headroom);
  if (o.rows) writeFileSync(o.rows, JSON.stringify(result, null, 1));
  process.stdout.write(JSON.stringify(result.summary, null, 1) + '\n');
}
