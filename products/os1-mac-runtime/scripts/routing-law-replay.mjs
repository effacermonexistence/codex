#!/usr/bin/env node
/** OS-1 build 447 (DESIGN-8): replay a recorded corpus under the routing law
 * and compare it with build 446, in real quota (pool units: Cw = % of the
 * Claude weekly pool, Px = % of one Codex Pro weekly pool). Zero quota: no
 * provider, model or network; Core's own route computation only.
 *
 *   node scripts/routing-law-replay.mjs --catalogs <sw446c.json> --routes446 <r446c.json> [--intents <intents.json>] [--rows <out.json>]
 *     [--remaining anthropic_shared=0.11,openai_codex=0.6]
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
 * Each route is priced with the compiled law table: Q of its row for the
 * request's cost shape (the law receipt's shape: the family's, agentic for a
 * writer that does work), and E[Q] = Q + p_fail(c, family) x Q(its
 * escalation) for a laddered route (446's graded and capability routes are
 * priced on the same basis): the expected real draw, never the scarcity
 * price. Each pool is reported on its own (Cw, Px) with its own ratio; Cw and
 * Px are summed 1:1 only in the sum line (an assumption, DESIGN-7, review of
 * 447). `--remaining` sets each pool's quota_remaining_fraction on every row of
 * both arms (the recorded catalogs carry 0.6 for both pools) so the replay can
 * run at the pools' real headroom. */
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, join} from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(pathToFileURL(join(ROOT, 'Resources/openclaw-os1-bridge/rcc-runtime.mjs')).href);
const {hostPlan, resolveRoutePlan, deliveryBasisOf, hostContextFingerprint, zeroModelArithmetic, configureLocalModel,
  routingLawTable, lawFamily, lawQuota, lawPFail, lawAskBack, ROUTING_LAW_TABLE_SHA256} = core;
configureLocalModel(process.env.LOCAL_MODEL ?? 'qwen3.5:9b');
const sha = text => createHash('sha256').update(text).digest('hex');

function options(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}
const POOL_UNIT = {anthropic_shared: 'Cw', openai_codex: 'Px', none: 'local'};

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

/** One request's route: calculator, ask-back, or Core's bound row. */
export function routeOf(request, catalog) {
  const exact = zeroModelArithmetic(request);
  if (exact !== null) return {route: 'calculator:' + exact, kind: 'calculator', candidate: null};
  const task = taskOf(request, catalog);
  const ask = catalog.routing_law ? lawAskBack(task, catalog) : null;
  if (ask) return {route: 'local:ask_back', kind: 'ask_back', candidate: null, law: ask.receipt};
  const plan = hostPlan(task, catalog);
  const at = Math.max(...catalog.candidates.map(c => c.availability_observed_at_ms ?? 0)) + 1;
  const {decisions, routes} = resolveRoutePlan(plan, task, catalog, at);
  const id = plan.final_node_id ?? plan.nodes[0].id;
  const decision = decisions[id], route = routes[id];
  const candidate = catalog.candidates.find(c => c.id === decision.resolved_candidate_id);
  return {route: `${candidate.surface}:${candidate.model}@${candidate.effort}`, kind: route.kind, candidate,
    ladder: route.ladder ?? null, scope: plan.nodes[0].scope, law: route.law ?? null,
    basis: deliveryBasisOf({routeClass: decision.route_class, routeKind: route.kind, ladder: route.ladder ?? null,
      reason: decision.reason}), reason: decision.reason};
}

/** Expected real quota of a bound route for a cost shape (E[Q], pool units). */
export function priceRoute(result, catalog, shape, table = routingLawTable(), family = null) {
  if (result.candidate === null) return {pool: 'none', q: 0, eq: 0};
  const c = result.candidate;
  const q = lawQuota(table, c, shape)?.q ?? null;
  if (q === null) return {pool: c.quota_pool, q: null, eq: null};
  let eq = q, escalationPool = null, escalationQ = 0;
  if (result.ladder && result.ladder.reference_candidate_id) {
    const reference = catalog.candidates.find(row => row.id === result.ladder.reference_candidate_id);
    escalationQ = reference ? lawQuota(table, reference, shape)?.q ?? 0 : 0;
    escalationPool = reference?.quota_pool ?? null;
    eq = q + lawPFail(table, c, family) * escalationQ;
  }
  return {pool: c.quota_pool, q, eq, escalationPool, escalationQ, pFail: result.ladder ? lawPFail(table, c, family) : 0};
}

/** Every row of a pool at the given remaining fraction ({pool: fraction}). */
export function atRemaining(catalog, remaining = null) {
  if (!remaining) return catalog;
  return {...catalog, candidates: catalog.candidates.map(row => Object.hasOwn(remaining, row.quota_pool) ?
    {...row, quota_remaining_fraction: remaining[row.quota_pool]} : row)};
}
export function replay(catalogRows, routes446, intents = {}, remaining = null) {
  const table = routingLawTable();
  const by446 = new Map(routes446.map(row => [row.index, row]));
  const rows = [], totals = {law: {Cw: 0, Px: 0}, b446: {Cw: 0, Px: 0}, law_q: {Cw: 0, Px: 0}, b446_q: {Cw: 0, Px: 0}};
  const add = (bucket, priced, field) => {
    if (priced.pool === 'none' || priced[field] === null) return;
    // A laddered route's escalation share is charged to its escalation pool.
    if (field === 'eq' && priced.escalationPool && priced.escalationPool !== priced.pool) {
      bucket[POOL_UNIT[priced.pool]] += priced.q;
      bucket[POOL_UNIT[priced.escalationPool]] += priced.pFail * priced.escalationQ;
    } else bucket[POOL_UNIT[priced.pool]] += priced[field];
  };
  for (const row of catalogRows) {
    if (!row.catalog) continue;
    const law = atRemaining(lawCatalog(row, intents[row.index] ?? null), remaining);
    const theirsCatalog = atRemaining(row.catalog, remaining);
    let mine, theirs;
    try { mine = routeOf(row.request, law); } catch (error) { mine = {route: 'core_error:' + error.message, candidate: null, error: true}; }
    try { theirs = routeOf(row.request, theirsCatalog); } catch (error) { theirs = {route: 'core_error:' + error.message, candidate: null, error: true}; }
    // The law's family (P for the owner's reference words) and the cost shape
    // the law priced the request with (the same work for both arms).
    const family = mine.law?.family ?? lawFamily(law.routing_law.reading, table);
    const shape = mine.law?.shape ?? table.families[family]?.shape ?? 'answer';
    const recorded = by446.get(row.index)?.route ?? null;
    const p447 = mine.error ? {pool: 'none', q: null, eq: null} : priceRoute(mine, law, shape, table, family);
    const p446 = theirs.error ? {pool: 'none', q: null, eq: null} : priceRoute(theirs, theirsCatalog, shape, table, family);
    add(totals.law, p447, 'eq'); add(totals.b446, p446, 'eq'); add(totals.law_q, p447, 'q'); add(totals.b446_q, p446, 'q');
    rows.push({index: row.index, group: row.group, request: row.request, family, shape,
      reading: law.routing_law.reading, route447: mine.route, kind447: mine.kind ?? null, basis447: mine.basis ?? null,
      route446: theirs.route, route446_recorded: recorded, eq447: p447.eq, eq446: p446.eq, q447: p447.q, q446: p446.q,
      unit447: POOL_UNIT[p447.pool], unit446: POOL_UNIT[p446.pool], argmin: mine.law?.argmin ?? null,
      law_candidates: mine.law?.candidates?.length ?? null, reason447: mine.reason ?? null});
  }
  const sum = bucket => bucket.Cw + bucket.Px;
  const round = value => Math.round(value * 1e4) / 1e4;
  return {table_sha256: ROUTING_LAW_TABLE_SHA256, rows,
    summary: {requests: rows.length, routes_changed: rows.filter(r => r.route447 !== r.route446).length,
      reproduces_recorded_446: rows.filter(r => r.route446 === (r.route446_recorded ?? '').replace(/\/(?=[^/]*$)/, '@')).length,
      core_errors: rows.filter(r => r.route447.startsWith('core_error')).length,
      expected_quota: {law447: {Cw: round(totals.law.Cw), Px: round(totals.law.Px), sum_1to1: round(sum(totals.law))},
        build446: {Cw: round(totals.b446.Cw), Px: round(totals.b446.Px), sum_1to1: round(sum(totals.b446))},
        delta: {Cw: round(totals.law.Cw - totals.b446.Cw), Px: round(totals.law.Px - totals.b446.Px),
          sum_1to1: round(sum(totals.law) - sum(totals.b446)),
          ratio_Cw: totals.b446.Cw ? round(totals.law.Cw / totals.b446.Cw) : null,
          ratio_Px: totals.b446.Px ? round(totals.law.Px / totals.b446.Px) : null,
          ratio_sum: round(sum(totals.law) / sum(totals.b446))}},
      remaining: remaining ?? 'recorded (0.6 both pools)',
      start_quota: {law447: {Cw: round(totals.law_q.Cw), Px: round(totals.law_q.Px)},
        build446: {Cw: round(totals.b446_q.Cw), Px: round(totals.b446_q.Px)}},
      free_447: rows.filter(r => r.eq447 === 0).length, free_446: rows.filter(r => r.eq446 === 0).length,
      astra_starts_447: rows.filter(r => r.route447.includes('gpt-6-astra')).length,
      astra_starts_446: rows.filter(r => r.route446.includes('gpt-6-astra')).length}};
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
/** The owner-question fixture: each question's Swift-built build-446
 * catalog (the corpus row's, or for an extra question the catalog of the
 * corpus row whose host facts it shares, named), its recorded local reading
 * (an extra: a live reading, recorded), and as expected route the law's own
 * output; the build 446 route of the same catalog is kept for the rollback. */
export function ownerFixture(catalogRows, routes446, intents = {}, extras = {}) {
  const recorded446 = new Map(routes446.map(row => [row.index, row.route]));
  return {schema: 1, table_sha256: ROUTING_LAW_TABLE_SHA256,
    note: 'DESIGN-7 §5 owner fixed questions; expected_route is the routing law output (golden), never hand-set; ' +
      'design7_route is DESIGN-7 for comparison only',
    questions: OWNER_QUESTIONS.map(([n, source, design7]) => {
      let row, origin;
      if (typeof source === 'number') { row = {...catalogRows[source], intent: intents[String(source)] ?? null}; origin = 'r446c#' + source; }
      else {
        const extra = extras[source];
        if (!extra) return {n, pending: 'no live local reading recorded'};
        row = {request: extra.request, catalog: structuredClone(catalogRows[extra.facts_from].catalog),
          receipt: extra.receipt, intent: extra.intent ?? null};
        origin = `live local reading ${extra.read_at}; host facts of r446c#${extra.facts_from}`;
      }
      const law = lawCatalog(row, row.intent);
      const routed = routeOf(row.request, law);
      const route446 = routeOf(row.request, row.catalog).route;
      return {n, request: row.request, origin, receipt: row.receipt, intent: row.intent, catalog: row.catalog,
        expected_route: routed.route, expected_kind: routed.kind ?? null,
        expected_family: routed.kind === 'calculator' ? 'F0' : routed.law?.family ?? lawFamily(law.routing_law.reading, routingLawTable()),
        route_446: route446,
        recorded_446: typeof source === 'number' ? recorded446.get(source) ?? null : null, design7_route: design7};
    })};
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const o = options(process.argv.slice(2));
  const catalogs = JSON.parse(readFileSync(o.catalogs, 'utf8'));
  const routes446 = JSON.parse(readFileSync(o.routes446, 'utf8'));
  const intents = o.intents ? JSON.parse(readFileSync(o.intents, 'utf8')) : {};
  const remaining = o.remaining ? Object.fromEntries(o.remaining.split(',').map(pair => {
    const [pool, value] = pair.split('=');
    if (!['anthropic_shared', 'openai_codex'].includes(pool) || !(Number(value) >= 0 && Number(value) <= 1))
      throw new Error('bad --remaining ' + pair);
    return [pool, Number(value)];
  })) : null;
  if (o['owner-fixture']) {
    const extras = o.extras ? JSON.parse(readFileSync(o.extras, 'utf8')) : {};
    writeFileSync(o['owner-fixture'], JSON.stringify(ownerFixture(catalogs, routes446, intents, extras)) + '\n');
    process.exit(0);
  }
  const result = replay(catalogs, routes446, intents, remaining);
  if (o.rows) writeFileSync(o.rows, JSON.stringify(result, null, 1));
  process.stdout.write(JSON.stringify(result.summary, null, 1) + '\n');
}
