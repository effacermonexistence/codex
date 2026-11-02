#!/usr/bin/env node
/** OS-1 build 447 (DESIGN-8, owner-approved direction 2026-10-29): the data
 * the routing law reads. Deterministic and offline: it reads only the files it
 * is named, never the network, a provider or a model.
 *
 * The law (DESIGN-8 steps 1-4) lives in Core (rcc-runtime.mjs, routing law
 * section): read the request into a family, keep the candidates with evidence
 * that they give the reference's result on the family's benchmark tiers
 * (admissible set A), price each in real quota, E[Q] = Q + p_fail x
 * Q(escalation), and take the argmin. This script compiles its inputs; no
 * table here is written by hand:
 *  - tolerance tau per (tier, unit) from the first-party effort-adjacent score
 *    drops (the tier's own drops when it has >= 3, else the pooled drops of
 *    that unit; Elo from the publication discrepancies), never chosen;
 *  - per tier and pool, each (model, effort)'s confirmed scores against the
 *    pool reference's best confirmed score at any effort, and whether every
 *    one is within tau (the law's evidence form (b));
 *  - real quota per (surface, model, effort, cost shape) in pool units (Cw /
 *    Px): the measured median where a cell has n >= 10 turns, else a token
 *    model (the shape's measured context priced at the model's list prices,
 *    the cell's output scaled by the effort multiplier: the larger of the
 *    first-party per-task cost ratio and the vendor's in-app label, O4) times
 *    the measured pool % per API dollar;
 *  - p_fail per (model, effort, law family): the routing ledger's JUDGED
 *    laddered attempts of law routes (a verifier or check verdict, an observed
 *    non-return or escalation; an undispatched or unjudged attempt is no
 *    evidence), with the Laplace prior; Core gives a row with evidence its
 *    reference's p_fail until its own runs move it (lead correction 1). Build
 *    448: the counting rule is Core's own (lawJudgedOutcome): the local model
 *    counts only REVAS check verdicts (a 447 screen pass is no verdict on the
 *    check the law now applies), and the snapshot records through_ms, after
 *    which Core learns from its own ledger (DESIGN-8 step 5);
 *  - build 448: the verify and repair cost shapes of a REVAS check of a local
 *    draft (DESIGN-8 step 5, DESIGN-6 O5), on every answer cell's anchor;
 *  - the passed REVAS paired audits (evidence form c) per (model@effort, law
 *    family): the committed verdicts of scripts/routing-law-audit.mjs grade
 *    (lead correction 3; none yet);
 *  - the pool exchange is not a table constant: Core derives it per request
 *    from the host's rate-limit observations (lead correction 2); the table
 *    carries only its declared formula.
 *
 *   node scripts/routing-law-table.mjs snapshot-quota --quota <quota dir> --date <YYYYMMDD> --out-dir <dir>
 *   node scripts/routing-law-table.mjs snapshot-ledger --ledger <routing-ledger.jsonl> --date <YYYYMMDD> --out-dir <dir>
 *   node scripts/routing-law-table.mjs snapshot-det-outcomes --drafts <drafts.json> --verifier <id> --family <F> --model <m> --effort <e> --date <YYYYMMDD> --out-dir <dir>
 *   node scripts/routing-law-table.mjs snapshot --tiers <tiers.json> --quota <quota dir> --ledger <routing-ledger.jsonl> --date <YYYYMMDD> --out-dir <dir>
 *   node scripts/routing-law-table.mjs compile [--out <new file>]
 *   node scripts/routing-law-table.mjs embed
 *   node scripts/routing-law-table.mjs check
 *
 * `snapshot` reads the price-performance artifacts and the private routing
 * ledger (usage, route identity and outcome fields only; no ids, text or
 * paths survive) and writes the three committed inputs. `compile` and `check`
 * read only the committed inputs (scripts/routing-law-*.json, the price table
 * and Config/production.json, read-only) and the shipped copies:
 * Resources/routing-law-table.json, the literal in rcc-runtime.mjs and the
 * Swift pin (RoutingLaw.swift). `check` exits 1 unless all four agree. */
import {createHash} from 'node:crypto';
import {closeSync, constants, openSync, readFileSync, writeFileSync, writeSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Build 448: the one judged-outcome rule is Core's (lawJudgedOutcome); the
// snapshot never keeps its own copy of it.
const {lawJudgedOutcome, lawScreenOutcome, LAW_DETERMINISTIC_VERIFIERS, LAW_DET_FINDINGS, lawDeterministicCheck,
  revasRepairInstruction, lawSmallTalkText, lawSmallTalkLaterTurn} = await import(pathToFileURL(join(ROOT, 'Resources/openclaw-os1-bridge/rcc-runtime.mjs')).href);
export const INPUTS = Object.freeze({
  evidence: 'scripts/routing-law-evidence-20261029.json',
  quota: 'scripts/routing-law-quota-20261030.json',
  // Round 3 of the 448 review: schema 4 (the structural screen counts beside
  // the judged outcomes, Core lawScreenOutcome).
  ledger: 'scripts/routing-law-ledger-20261101.json',
  audits: 'scripts/routing-law-audits-20261029.json',
  // Build 448 (review of 448): a deterministic verifier's pre-registered
  // held-out validation (labeled replies, frozen before the verifier ran on
  // them) and its verdicts on the local model's real drafts (p_fail). Round 3
  // (lead decisions 1 and 6): the drafts are of the held-out sets' OWN
  // requests (the population the reference prior is measured on), generated
  // with the production small-talk prompt; set C was written, generated and
  // labeled after that prompt was frozen. The corpus drafts that price the
  // realized gate never enter the fit.
  det_validation: 'scripts/routing-law-det-validation-20261101.json',
  det_outcomes: 'scripts/routing-law-det-outcomes-20261101.json',
  policy: 'scripts/routing-law-policy.json',
  prices: 'Resources/model-price-table.json',
  profiles: 'Config/production.json',
  // Round 5 of the 448 review: a checklist parity audit (small talk F1) is
  // compiled only against its pre-registered inputs: the frozen checklist,
  // the committed grader sensitivity (natural, on a held-out labeled set) and
  // the reference harness OS-1 ships (its pinned rendering).
  f1_checklist: 'scripts/routing-law-f1-checklist-20261101.json',
  f1_sensitivity: 'scripts/routing-law-f1-sensitivity-20261101.json',
  harness: 'Sources/OS1Context/HarnessProfile.swift',
});
export const TABLE_PATH = 'Resources/routing-law-table.json';
export const CORE_PATH = 'Resources/openclaw-os1-bridge/rcc-runtime.mjs';
export const SWIFT_PATH = 'Sources/OS1Context/RoutingLaw.swift';
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const DISPATCHABLE = new Set(EFFORTS);

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const round = (value, digits = 6) => value === null || value === undefined ? null :
  Math.round(value * 10 ** digits) / 10 ** digits;
function median(values) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
/** Sorted keys, no whitespace, one trailing newline: the bytes every copy carries. */
export function canonical(value) {
  const order = item => Array.isArray(item) ? item.map(order) : item !== null && typeof item === 'object' ?
    Object.fromEntries(Object.keys(item).sort().map(key => [key, order(item[key])])) : item;
  return JSON.stringify(order(value)) + '\n';
}

// ---- snapshot: committed inputs from the artifacts -------------------------
function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; } else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter(cells => cells.length === header.length).map(cells => Object.fromEntries(header.map((key, i) => [key, cells[i]])));
}
const number = value => value === '' || value === undefined ? null : Number(value);

export function snapshotEvidence(tiersBytes) {
  const tiers = JSON.parse(tiersBytes.toString('utf8'));
  const out = {schema: 1, source: {file: 'price-performance/tiers/tiers.json', sha256: sha(tiersBytes), built_on: tiers.built_on},
    tiers: {}, inversions: [], replicates: [], elo_discrepancies: [], first_party_ratios: [], families: []};
  for (const [id, tier] of Object.entries(tiers.tiers)) {
    const pools = {};
    for (const [provider, pool] of Object.entries(tier.pools)) {
      const shared = (pool.benchmarks ?? []).filter(b => b.shared === true);
      const aliases = new Set(shared.map(b => b.alias));
      const cells = [];
      for (const cell of pool.cells ?? []) {
        const scores = {};
        for (const s of cell.scores ?? [])
          if (s.status === 'confirmed' && aliases.has(s.alias) && Number.isFinite(s.score)) scores[s.alias] = s.score;
        if (Object.keys(scores).length) cells.push({model: cell.model, effort: cell.effort, scores});
      }
      pools[provider] = {reference: pool.reference ?? null,
        benchmarks: shared.map(b => ({alias: b.alias, unit_kind: b.unit_kind, lower_better: b.lower_better === true})),
        cells};
    }
    out.tiers[id] = {skill: tier.skill, difficulty: tier.difficulty, name: tier.name, pools};
  }
  out.inversions = tiers.inversions.map(x => ({tier: x.tier, unit_kind: x.unit_kind, magnitude: x.magnitude}));
  // A replicate run is a same-(model, effort, benchmark) second publication;
  // its unit is the benchmark's.
  const unitOf = (tier, benchmark) => {
    for (const pool of Object.values(tiers.tiers[tier]?.pools ?? {}))
      for (const b of pool.benchmarks ?? []) if (b.benchmark === benchmark) return b.unit_kind;
    return null;
  };
  out.replicates = tiers.replicate_runs.map(x => ({tier: x.tier, unit_kind: unitOf(x.tier, x.benchmark), abs_diff: x.abs_diff}));
  out.elo_discrepancies = tiers.publication_discrepancies.filter(x => x.unit === 'Elo').map(x => ({tier: x.tier, abs_diff: x.abs_diff}));
  out.first_party_ratios = tiers.corpus_first_party_cost_ratios.cells
    .filter(c => DISPATCHABLE.has(c.effort)).map(c => ({provider: c.provider, model: c.model, effort: c.effort, n: c.n, median: c.median}));
  // Each conditional tier keeps its condition: the policy maps it to a
  // reading predicate (or 'always' when no reading can tell); none is dropped.
  out.families = tiers.families.map(f => ({id: f.id, required: f.required,
    conditional: f.conditional.map(c => ({tier: c.tier, when: c.when})), upper_bound: f.upper_bound}));
  return out;
}

export function snapshotQuota(quotaDir, pricesBytes = readFileSync(join(ROOT, INPUTS.prices))) {
  const prices = JSON.parse(pricesBytes.toString('utf8')).models;
  // Schema 2 (review of 447): each turn's measured pool % per list-price
  // dollar of its own counted tokens (its premium: conversion, reasoning or
  // thinking the token columns omit, cache writes), so a cell's measured price
  // can be restated on the common anchor (compileQuota) without a ratio of
  // medians (a skewed cell's medians do not add).
  const premiumOf = (model, row) => {
    const price = prices[model];
    if (!price) return null;
    const dollars = (row.uncached * price.input + row.cached * price.cached_input + (row.out ?? 0) * price.output) / 1e6;
    return dollars > 0 ? row.pct / dollars : null;
  };
  const claudeBytes = readFileSync(join(quotaDir, 'claude_turns.csv'));
  const codexBytes = readFileSync(join(quotaDir, 'codex_turns.csv'));
  const calibrationBytes = readFileSync(join(quotaDir, 'calibration.json'));
  const calibration = JSON.parse(calibrationBytes.toString('utf8'));
  // DESIGN-7 §2b: an answer-shaped turn has two calls or fewer, a
  // build-sized turn more than 15. A route is priced BEFORE it runs, so the
  // answer shape is every <= 2-call turn of the cell, whatever its realized
  // output (review of 447: a split by realized output priced high-effort cells
  // on their short turns only). Turns in between price nothing here.
  const shapeOf = calls => calls <= 2 ? 'answer' : calls >= 16 ? 'agentic' : 'mid';
  const groups = new Map(), contexts = new Map();
  const add = (map, key, value) => { if (!map.has(key)) map.set(key, []); map.get(key).push(value); };
  for (const r of csvRows(claudeBytes.toString('utf8'))) {
    const source = r.ent === 'sdk-cli' ? 'os1' : r.ent === 'claude-desktop' ? 'owner' : null;
    const calls = number(r.calls_total), pct = number(r.weekly_pct);
    if (!source || calls === null || pct === null) continue;
    const shape = shapeOf(calls), effort = r.effort === '' ? 'none' : r.effort;
    const row = {pct, out: number(r.output), cost: number(r.cost_total),
      uncached: (number(r.input) ?? 0) + (number(r.cache_write) ?? 0), cached: number(r.cache_read) ?? 0};
    row.premium = premiumOf(r.model, row);
    add(groups, JSON.stringify([source, 'anthropic', r.model, effort, shape]), row);
    add(contexts, JSON.stringify([source, 'anthropic', shape]), row);
  }
  for (const r of csvRows(codexBytes.toString('utf8'))) {
    if (r.src !== 'token_usage_record') continue; // pre-2026-09-04 rows lack usage records
    const source = r.cls === 'os1_automation' ? 'os1' : ['owner_manual', 'owner_subagent'].includes(r.cls) ? 'owner' : null;
    const calls = number(r.calls), pct = number(r.pro_weekly_pct);
    if (!source || calls === null || pct === null) continue;
    const shape = shapeOf(calls);
    const row = {pct, out: number(r.output), cost: number(r.cost), uncached: number(r.uncached) ?? 0, cached: number(r.cached) ?? 0};
    row.premium = premiumOf(r.model, row);
    add(groups, JSON.stringify([source, 'openai', r.model, r.effort, shape]), row);
    add(contexts, JSON.stringify([source, 'openai', shape]), row);
  }
  const cells = [...groups].map(([key, rows]) => {
    const [source, provider, model, effort, shape] = JSON.parse(key);
    return {source, provider, model, effort, shape, n: rows.length, pct_median: round(median(rows.map(r => r.pct))),
      output_median: median(rows.map(r => r.out)), cost_median: round(median(rows.map(r => r.cost))),
      // Schema 2 (review of 447): the cell's own context and its turns' median
      // premium (% per list dollar), so its measured price can be restated on
      // the common anchor (compileQuota).
      uncached_median: median(rows.map(r => r.uncached)), cached_median: median(rows.map(r => r.cached)),
      premium_median: round(median(rows.map(r => r.premium).filter(v => v !== null)), 6)};
  }).filter(cell => cell.shape !== 'mid').sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  const context = [...contexts].map(([key, rows]) => {
    const [source, provider, shape] = JSON.parse(key);
    return {source, provider, shape, n: rows.length, uncached_median: median(rows.map(r => r.uncached)),
      cached_median: median(rows.map(r => r.cached))};
  }).filter(cell => cell.shape !== 'mid').sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  const codex = calibration.codex_conversion_used.pro_weekly;
  return {schema: 2,
    sources: {claude_turns: sha(claudeBytes), codex_turns: sha(codexBytes), calibration: sha(calibrationBytes),
      prices: sha(pricesBytes)},
    conversions: {anthropic_shared: {all: calibration.claude_conversion_used.weekly_all_pct_per_usd.median},
      openai_codex: {'gpt-6-astra': codex['gpt-6-astra'][0], sol_family: codex.sol_family[0], luna_terra: codex.luna_terra[0]}},
    cells, context};
}

/** p_fail evidence (DESIGN-8 step 3: p_fail(c, family); step 5: every
 * outcome updates it). Only a JUDGED laddered attempt counts, by Core's own
 * rule (lawJudgedOutcome): a verifier or check verdict of the verifier the law
 * applies to that row, or an observed failure (it did not return, or it
 * escalated). An attempt never dispatched, one that completed with no verdict,
 * a local answer the 447 screen passed (no verdict on the REVAS check the law
 * now applies), a REVAS check or repair attempt, and an attempt routed before
 * the law (no law family) say nothing and are only counted as excluded.
 * Schema 3 (build 448) records `through_ms`, the latest settled record in the
 * snapshot: Core adds its own ledger's judged runs after it. */
export function snapshotLedger(ledgerBytes) {
  const counts = new Map(), excluded = {undispatched: 0, unjudged: 0, no_law_family: 0, local_screen_only: 0};
  const screens = new Map();
  let through = null;
  for (const line of ledgerBytes.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (Number.isSafeInteger(record?.settled_at_ms) && (through === null || record.settled_at_ms > through)) through = record.settled_at_ms;
    // Round 3 of the 448 review (lead decision 2): the structural screen,
    // keyed model@effort (the same screen for every row and family).
    const screen = lawScreenOutcome(record);
    if (screen) {
      const value = screens.get(screen.key) ?? {runs: 0, failures: 0, shadow: 0};
      value.runs++; if (screen.failed) value.failures++; if (screen.shadow) value.shadow++;
      screens.set(screen.key, value);
    }
    const outcome = lawJudgedOutcome(record);
    if (outcome === null) continue;
    if (!outcome.key) { excluded[outcome.excluded] = (excluded[outcome.excluded] ?? 0) + 1; continue; }
    const key = JSON.stringify([outcome.model, outcome.effort, outcome.family]);
    const value = counts.get(key) ?? {runs: 0, failures: 0, full: 0};
    value.runs++; if (outcome.failed) value.failures++; if (outcome.class === 'full') value.full++;
    counts.set(key, value);
  }
  return {schema: 4, source: {sha256: sha(ledgerBytes), basis: 'Core lawJudgedOutcome over the routing ledger: judged ' +
      'laddered descents (route kinds tier, graded, capability, law), not escalated, keyed by the law family of their ' +
      'receipt; a local draft by its REVAS check verdict only; failure = escalated, not returned, verifier, check or ' +
      'REVAS fail (class full: no deliverable draft); success = verifier, check or REVAS pass'}, through_ms: through, excluded,
    cells: [...counts].map(([key, value]) => {
      const [model, effort, family] = JSON.parse(key);
      return {model, effort, family, ...value};
    }).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1),
    screen: {basis: 'Core lawScreenOutcome over the routing ledger: the structural screen (descentStructurallySound) of ' +
      'every screened law, graded or capability descent and every law-bound reference answer\'s shadow screen, keyed ' +
      'model@effort, pooled over families and surfaces',
    cells: [...screens].map(([key, value]) => ({key, ...value})).sort((a, b) => a.key < b.key ? -1 : 1)}};
}

/** Build 448: the det outcomes input from a drafts file. */
export function snapshotDetOutcomes(file, {verifier, family, model, effort, basis = null}) {
  if (!Object.hasOwn(LAW_DETERMINISTIC_VERIFIERS, verifier)) throw new Error('not an id Core runs: ' + verifier);
  const drafts = file.drafts ?? [];
  // Round 3 of the 448 review (lead decision 1): every draft is of a request
  // of a named held-out validation set (the population the reference prior
  // is measured on); a corpus draft has no set and is refused.
  if (!drafts.every(d => typeof d.set === 'string' && d.set.length > 0))
    throw new Error('det outcomes: every draft must name the held-out validation set its request belongs to');
  const items = drafts.filter(d => typeof d.request === 'string' && typeof d.draft === 'string').map(d => {
    const v = lawDeterministicCheck(verifier, d.request, d.draft, Number.isSafeInteger(d.output_tokens) ? {output_tokens: d.output_tokens} : null);
    return {set: d.set, request_sha256: sha(Buffer.from(d.request)), draft_sha256: sha(Buffer.from(d.draft)), passed: v.passed,
      failures: v.failures, ...(v.passed ? {} : {class: v.failures.includes('empty') ? 'full' : 'repair'})};
  });
  const failures = items.filter(i => !i.passed).length, full = items.filter(i => i.class === 'full').length;
  const sets = [...new Set(items.map(i => i.set))].sort();
  return {schema: 2, source: {sha256: sha(Buffer.from(JSON.stringify(drafts))), generator: file.generator ?? null,
      basis: basis ?? 'Core lawDeterministicCheck on the local model\'s drafts (production prompt) of the requests of the held-out ' +
        'validation sets ' + sets.join(', ') + ', the population the reference prior is measured on'},
    cells: [{verifier, family, model, effort, runs: items.length, failures, full, population: sets,
      basis: 'drafts ' + items.length + ', verifier passes ' + (items.length - failures) + '; ' +
        sets.map(set => set + ' ' + items.filter(i => i.set === set && i.passed).length + '/' + items.filter(i => i.set === set).length).join(', ')}],
    items};
}

// ---- compile: the law's inputs ---------------------------------------------
/** tau per (tier, unit): the tier's own effort-adjacent drops (n >= 3) else
 * the pooled drops of the unit; Elo from the publication discrepancies; a unit
 * with no drop at all has tau 0 (delta 0, flagged). Never chosen by hand. */
export function compileTau(evidence) {
  const tau = {};
  const pooled = unit => evidence.inversions.filter(x => x.unit_kind === unit).map(x => x.magnitude);
  for (const [id, tier] of Object.entries(evidence.tiers)) {
    const units = new Set(Object.values(tier.pools).flatMap(pool => pool.benchmarks.map(b => b.unit_kind)));
    tau[id] = {};
    for (const unit of [...units].sort()) {
      const own = evidence.inversions.filter(x => x.tier === id && x.unit_kind === unit).map(x => x.magnitude);
      const replicates = evidence.replicates.filter(x => x.unit_kind === unit).map(x => x.abs_diff);
      let value, basis, n;
      if (unit === 'elo') {
        const d = evidence.elo_discrepancies.map(x => x.abs_diff);
        value = median(d); basis = 'elo_publication_discrepancies'; n = d.length;
      } else if (own.length >= 3) { value = median(own); basis = 'tier_effort_adjacent_drops'; n = own.length; }
      else if (pooled(unit).length) { value = median(pooled(unit)); basis = 'pooled_effort_adjacent_drops'; n = pooled(unit).length; }
      else { value = 0; basis = 'no_drop_delta0'; n = 0; }
      tau[id][unit] = {tau: round(value ?? 0, 4), basis, n, replicate_median: round(median(replicates), 4)};
    }
  }
  return tau;
}

const poolOf = (policy, provider) => policy.pools[provider];
/** Evidence form (b): per tier and pool, each dispatchable (model, effort)'s
 * confirmed scores against the pool reference's best confirmed score at any
 * effort; within tau on every benchmark it is scored on, and scored on at
 * least min(2, benchmarks the pool publishes on the tier) (DESIGN-7 §1.2's
 * coverage rule: one benchmark of several is not the tier). */
export function compileAdmission(evidence, tau, policy) {
  const out = {};
  for (const [id, tier] of Object.entries(evidence.tiers)) {
    out[id] = {};
    for (const [provider, pool] of Object.entries(tier.pools)) {
      const poolName = poolOf(policy, provider), reference = policy.references[poolName];
      if (!poolName || pool.reference !== reference || pool.benchmarks.length === 0) continue;
      const best = {};
      for (const b of pool.benchmarks) {
        const scores = pool.cells.filter(c => c.model === reference && Number.isFinite(c.scores[b.alias])).map(c => c.scores[b.alias]);
        if (scores.length) best[b.alias] = b.lower_better ? Math.min(...scores) : Math.max(...scores);
      }
      const benchmarks = pool.benchmarks.filter(b => Object.hasOwn(best, b.alias));
      if (!benchmarks.length) continue;
      const cells = {};
      for (const cell of pool.cells) {
        if (!DISPATCHABLE.has(cell.effort)) continue;
        const rows = [];
        for (const b of benchmarks) {
          if (!Number.isFinite(cell.scores[b.alias])) continue;
          const deficit = b.lower_better ? cell.scores[b.alias] - best[b.alias] : best[b.alias] - cell.scores[b.alias];
          const t = tau[id][b.unit_kind]?.tau ?? 0;
          rows.push([b.alias, cell.scores[b.alias], best[b.alias], round(deficit, 4), deficit <= t + 1e-9]);
        }
        if (!rows.length) continue;
        const coverage = [rows.length, Math.min(2, benchmarks.length)];
        // The measured gap below the reference (review of 447, correction 1):
        // the largest deficit in percentage points on a percentage benchmark
        // (accuracy or error rate), as an excess failure rate; 0 at or above
        // the reference. Elo and other units carry none.
        const pct = rows.filter((row, i) => ['pct', 'pct_error'].includes(benchmarks.find(b => b.alias === row[0])?.unit_kind));
        const excess = pct.length ? round(Math.max(0, ...pct.map(row => row[3])) / 100, 6) : 0;
        cells[cell.model + '@' + cell.effort] = {pass: rows.every(row => row[4]) && coverage[0] >= coverage[1],
          coverage, benchmarks: rows, excess_fail: excess};
      }
      out[id][poolName] = {reference, published: benchmarks.map(b => b.alias), cells};
    }
  }
  return out;
}

const MODEL_EFFORTS = (profiles, provider) => [...new Set(Object.values(profiles.execution_profiles)
  .filter(p => p.provider === provider).map(p => p.model + '@' + p.effort))];
const conversionOf = (quota, pool, model) => pool === 'anthropic_shared' ? quota.conversions.anthropic_shared.all :
  model === 'gpt-6-astra' ? quota.conversions.openai_codex['gpt-6-astra'] :
  /sol/.test(model) ? quota.conversions.openai_codex.sol_family : quota.conversions.openai_codex.luna_terra;
/** The effort multiplier of one step `from` -> `to` (adjacent efforts) of a
 * model: the first-party per-task cost ratio, never below 1 for a higher
 * effort; deriving the HIGHER effort (`upward`), the larger of that and the
 * vendor's in-app label (O4: the label only ever raises cost, so it never
 * prices a lower effort down from a measured higher one). */
function stepMultiplier(evidence, policy, pool, provider, model, from, to, upward) {
  const ratio = effort => evidence.first_party_ratios.find(r => r.provider === provider && r.model === model && r.effort === effort)?.median;
  const fp = ratio(from) && ratio(to) ? ratio(to) / ratio(from) : null;
  const label = upward ? (policy.effort_labels[pool] ?? {})[to] ?? null : null;
  return Math.max(fp ?? 1, label ?? 1, 1);
}
function effortMultiplier(evidence, policy, pool, provider, model, from, to) {
  const order = EFFORTS.filter(e => e !== 'none' && e !== 'minimal');
  let a = order.indexOf(from), b = order.indexOf(to);
  if (a < 0 || b < 0 || a === b) return 1;
  let product = 1;
  if (a < b) for (let i = a; i < b; i++) product *= stepMultiplier(evidence, policy, pool, provider, model, order[i], order[i + 1], true);
  else for (let i = b; i < a; i++) product /= stepMultiplier(evidence, policy, pool, provider, model, order[i], order[i + 1], false);
  return product;
}
/** Real quota per (surface, model, effort, shape) in pool units, every cell
 * priced on ONE common anchor (review of 447: a per-cell median is the price of
 * that cell's own request mix, not of this request at that effort; OS-1's
 * astra@ultra turns were 217-token routing checks, the owner's astra@xhigh
 * turns carried 229k cached tokens, OS-1's fable@low turns 496k input):
 *  - the anchor request is the shape's measured OS-1 context (uncached and
 *    cached tokens; else the owner's) with the output the model produces at
 *    that effort, never less than at a lower effort (out_mono: the largest
 *    measured output, n >= output_min_n, of the model at this or a lower
 *    effort; OS-1's cell first, else the owner's);
 *  - a cell measured with n >= measured_min_n (OS-1 first, else the owner's)
 *    keeps its own measured premium: q = T(anchor) x premium, where T is the
 *    list-price dollar cost of the anchor's tokens and the premium is the
 *    median over the cell's turns of measured % per list dollar of the turn's
 *    own counted tokens (it carries the pool conversion and what the token
 *    columns miss: reasoning or thinking, cache writes); the effort
 *    multiplier is never applied to a measured output (O4 raises a derived
 *    cell only);
 *  - any other cell: its output (measured, else the nearest measured effort's
 *    scaled by the effort multiplier: the larger of the first-party per-task
 *    ratio and the vendor's in-app label, O4, else the shape's pooled output
 *    scaled from 'high'), never below out_mono, at the anchor context, times
 *    the pool conversion, times the CALIBRATION: the median premium over
 *    conversion of the provider's measured OS-1 cells of that shape (else its
 *    other shapes, else 1);
 *  - finally a higher effort never prices below a lower effort of the same
 *    surface, model and shape (the effort multiplier is >= 1; only ever raised).
 * No answer cell is priced on its own request mix. The agentic shape keeps
 * build 447's pricing (ANCHORED below). */
export function compileQuota(quota, evidence, policy, prices, profiles) {
  if (quota.schema !== 2) throw new Error('quota snapshot schema 2 (per-cell context) required');
  const out = {};
  const providers = {anthropic: 'anthropic_shared', openai: 'openai_codex'};
  const surfacesOf = {anthropic: ['claude', 'claude-chat'], openai: ['codex']};
  const SHAPES = ['answer', 'agentic'];
  // The shapes priced on the common anchor. The agentic shape is not (review
  // of 447): its turns' token columns omit sub-agent tokens (the owner's
  // opus@xhigh agentic turns measure 0.73 % per list dollar against 0.04 to
  // 0.07 for every answer cell), so no anchor restates them; it keeps build
  // 447's measured median per cell, else the calibrated token model.
  const ANCHORED = new Set(['answer']);
  const dollars = (price, uncached, cached, output) =>
    ((uncached ?? 0) * price.input + (cached ?? 0) * price.cached_input + (output ?? 0) * price.output) / 1e6;
  const anchorOf = (provider, shape) => quota.context.find(c => c.source === 'os1' && c.provider === provider && c.shape === shape) ??
    quota.context.find(c => c.source === 'owner' && c.provider === provider && c.shape === shape) ?? null;
  // The model's measured output per effort (OS-1's cell first, else the owner's).
  const measuredOutput = (provider, model, effort, shape) => {
    const of = source => quota.cells.find(c => c.source === source && c.provider === provider && c.model === model &&
      c.effort === effort && c.shape === shape && c.n >= policy.output_min_n && Number.isFinite(c.output_median));
    return (of('os1') ?? of('owner'))?.output_median ?? null;
  };
  // out_mono: never less output at a higher effort of the same model and shape.
  const outMono = (provider, model, effort, shape) => {
    const values = EFFORTS.slice(0, EFFORTS.indexOf(effort) + 1).map(e => measuredOutput(provider, model, e, shape))
      .filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  };
  // A measured cell's premium: the median over its turns of the measured %
  // per list-price dollar of the turn's own counted tokens (the snapshot's).
  const premiumOf = cell => Number.isFinite(cell.premium_median) && cell.premium_median > 0 ? cell.premium_median : null;
  function derivedOutput(provider, pool, model, effort, shape) {
    const own = measuredOutput(provider, model, effort, shape);
    if (own !== null) return {output: own, basis: 'output_measured'};
    const anchors = EFFORTS.map(e => ({effort: e, output: measuredOutput(provider, model, e, shape)}))
      .filter(a => a.output !== null)
      .sort((a, b) => Math.abs(EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(effort)) -
        Math.abs(EFFORTS.indexOf(b.effort) - EFFORTS.indexOf(effort)));
    if (anchors.length)
      return {output: anchors[0].output * effortMultiplier(evidence, policy, pool, provider, model, anchors[0].effort, effort),
        basis: 'output_scaled_from_' + anchors[0].effort};
    const pooled = median(quota.cells.filter(c => c.provider === provider && c.shape === shape && c.source === 'os1')
      .map(c => c.output_median));
    return {output: (pooled ?? 0) * effortMultiplier(evidence, policy, pool, provider, model, 'high', effort),
      basis: 'output_pooled_scaled_from_high'};
  }
  // The calibration per (provider, shape) over the measured OS-1 cells: an
  // answer cell's own premium over conversion (the anchored shape); an agentic
  // cell's measured % over the token model of the anchor context and its own
  // output (build 447's, unchanged: see ANCHORED).
  const calibration = {};
  for (const [provider, pool] of Object.entries(providers)) {
    calibration[provider] = {};
    for (const shape of SHAPES) {
      const ratios = quota.cells.filter(c => c.source === 'os1' && c.provider === provider && c.shape === shape &&
        c.n >= policy.measured_min_n && prices.models[c.model] && c.pct_median > 0)
        .map(c => ANCHORED.has(shape) ? premiumOf(c) / conversionOf(quota, pool, c.model) :
          c.pct_median / (dollars(prices.models[c.model], anchorOf(provider, shape)?.uncached_median,
            anchorOf(provider, shape)?.cached_median, c.output_median) * conversionOf(quota, pool, c.model)))
        .filter(Number.isFinite);
      calibration[provider][shape] = ratios.length ? {factor: round(median(ratios), 4), n_cells: ratios.length, from: shape} : null;
    }
    const any = median(Object.values(calibration[provider]).filter(Boolean).map(c => c.factor));
    for (const shape of SHAPES) calibration[provider][shape] ??= any === null ? {factor: 1, n_cells: 0, from: 'none'} :
      {factor: round(any, 4), n_cells: 0, from: 'provider_other_shapes'};
  }
  const anchors = {};
  for (const [provider, pool] of Object.entries(providers)) {
    const tuples = MODEL_EFFORTS(profiles, provider === 'anthropic' ? 'claude' : 'codex');
    for (const tuple of tuples) {
      const [model, effort] = tuple.split('@');
      const price = prices.models[model];
      if (!price) continue; // a signed tuple of a model the price table no longer lists: unpriced, never cheapest
      for (const shape of SHAPES) {
        const anchor = anchorOf(provider, shape);
        anchors[provider + ':' + shape] = anchor ? {uncached: anchor.uncached_median, cached: anchor.cached_median,
          source: anchor.source, n: anchor.n} : null;
        const conversion = conversionOf(quota, pool, model);
        const mono = outMono(provider, model, effort, shape);
        const measured = source => quota.cells.find(c => c.source === source && c.provider === provider && c.model === model &&
          c.effort === effort && c.shape === shape && c.n >= policy.measured_min_n);
        const hit = measured('os1') ?? measured('owner');
        const premium = hit ? premiumOf(hit) : null;
        let q, basis, n = null, output;
        if (hit && !ANCHORED.has(shape)) {
          output = hit.output_median ?? 0;
          q = hit.pct_median; basis = 'measured_' + hit.source; n = hit.n;
        } else if (hit && premium !== null) {
          output = Math.max(hit.output_median ?? 0, mono ?? 0);
          q = dollars(price, anchor?.uncached_median, anchor?.cached_median, output) * premium;
          basis = 'measured_' + hit.source + '_anchored'; n = hit.n;
        } else {
          const derived = derivedOutput(provider, pool, model, effort, shape);
          output = ANCHORED.has(shape) ? Math.max(derived.output, mono ?? 0) : derived.output;
          q = dollars(price, anchor?.uncached_median, anchor?.cached_median, output) * conversion * calibration[provider][shape].factor;
          basis = 'token_model:' + derived.basis + ':calibrated_' + calibration[provider][shape].from;
        }
        for (const surface of surfacesOf[provider]) {
          // OS-1's Claude answers (claude-chat and the Claude Code surface)
          // are measured as one OS-1 dispatch population.
          const key = surface + ':' + model + '@' + effort;
          out[key] ??= {pool, model, effort};
          out[key][shape] = {q, basis, n, output: Math.round(output)};
        }
      }
    }
  }
  // A higher effort never prices below a lower effort of the same model.
  const byModel = new Map();
  for (const [key, cell] of Object.entries(out)) {
    const group = key.slice(0, key.lastIndexOf('@'));
    if (!byModel.has(group)) byModel.set(group, []);
    byModel.get(group).push(cell);
  }
  for (const cells of byModel.values()) {
    cells.sort((a, b) => EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort));
    for (const shape of SHAPES.filter(shape => ANCHORED.has(shape))) {
      let floor = null;
      for (const cell of cells) {
        if (!cell[shape]) continue;
        if (floor !== null && cell[shape].q < floor.q) {
          cell[shape].basis += ':raised_to_' + floor.effort;
          cell[shape].q = floor.q;
        }
        floor = {q: cell[shape].q, effort: cell.effort};
      }
    }
  }
  // Build 448 (DESIGN-8 step 5, DESIGN-6 O5): the REVAS check and repair of a
  // local draft at an answer cell j, on j's own answer anchor and multiplier
  // (q / list dollars of the anchor: its measured premium, or conversion x
  // calibration), never on a request mix of its own:
  //  - verify: the anchor context plus the draft (uncached; the local worker's
  //    completion cap D, its deterministic upper bound) in, j's answer output
  //    out (a check never outputs more than answering);
  //  - repair at the same row inside the provider cache window: the request
  //    and draft prefix (the anchor context plus the draft: D, or j's own
  //    answer output when j repairs its own answer, whichever is larger)
  //    cached, the findings (bounded by the check's output) uncached, j's
  //    answer output out (a repair never outputs more than rewriting).
  // Upper bounds while no check is measured (O4: the expensive reading when
  // uncertain); every check and repair attempt's usage is in the routing ledger.
  const draftTokens = policy.local_start?.draft_max_tokens;
  if (!Number.isSafeInteger(draftTokens) || draftTokens <= 0) throw new Error('local_start.draft_max_tokens required');
  // Every finding Core can name, and the repair-mode framing, in bytes (>= tokens).
  const detFindingsTokens = Buffer.byteLength(revasRepairInstruction('', '', Object.values(LAW_DET_FINDINGS)));
  for (const cell of Object.values(out)) {
    const a = cell.answer;
    const price = prices.models[cell.model];
    if (!a || !price) continue;
    const anchor = anchorOf(cell.pool === 'anthropic_shared' ? 'anthropic' : 'openai', 'answer');
    const U = anchor?.uncached_median ?? 0, C = anchor?.cached_median ?? 0, O = a.output;
    const base = dollars(price, U, C, O);
    if (!(base > 0)) continue;
    const multiplier = a.q / base;
    cell.verify = {q: dollars(price, U + draftTokens, C, O) * multiplier, basis: 'revas_check_bound:' + a.basis,
      output: O, draft_tokens: draftTokens};
    const prefix = C + U + Math.max(draftTokens, O);
    cell.repair = {q: dollars(price, O, prefix, O) * multiplier,
      basis: 'revas_repair_same_row_bound:' + a.basis, output: O, findings_tokens: O, cached_prefix_tokens: prefix};
    // Round 3 of the 448 review (lead decision 3, DESIGN-6 O5): the repair of
    // a draft a family's deterministic verifier rejected, at the family's
    // reference, which never saw the draft (nothing of its prefix is
    // cached): the anchor context plus the draft (D) plus the verifier's
    // findings and the repair instruction (their bytes, an upper bound of
    // their tokens) uncached, j's answer output out (a repair never outputs
    // more than answering).
    cell.det_repair = {q: dollars(price, U + draftTokens + detFindingsTokens, C, O) * multiplier,
      basis: 'det_repair_cold_bound:' + a.basis, output: O, draft_tokens: draftTokens, findings_tokens: detFindingsTokens};
  }
  for (const cell of Object.values(out)) for (const shape of [...SHAPES, 'verify', 'repair', 'det_repair']) if (cell[shape]) cell[shape].q = round(cell[shape].q, 6);
  return {cells: out, calibration, anchors};
}

/** p_fail evidence per (model@effort, law family), DESIGN-8 step 3, pooled
 * over surfaces only (a grant that moves a row to another surface must not
 * change the model through it). The judged runs the ledger could not
 * attribute to a law family are reported, never used. */
export function compilePFail(ledger, policy, detOutcomes = null, heldoutSets = null, requestOf = null) {
  if (ledger.schema !== 4) throw new Error('ledger snapshot schema 4 (Core lawJudgedOutcome and lawScreenOutcome, through_ms) required');
  const out = {};
  for (const cell of ledger.cells) {
    const key = cell.model + '@' + cell.effort + '|' + cell.family;
    out[key] = {runs: (out[key]?.runs ?? 0) + cell.runs, failures: (out[key]?.failures ?? 0) + cell.failures,
      full: (out[key]?.full ?? 0) + (cell.full ?? 0)};
  }
  // Build 448 (review of 448): Core's own deterministic verdicts on a row's
  // real drafts are judged outcomes too (the verifier IS the check the law
  // applies; zero quota, deterministic at temperature 0), counted only for
  // the verifier the policy runs for that family.
  const det = [];
  if (detOutcomes !== null && detOutcomes.schema !== 2) throw new Error('det outcomes schema 2 (held-out population, classes) required');
  for (const cell of detOutcomes?.cells ?? []) {
    if (policy.deterministic_verifiers?.[cell.family]?.id !== cell.verifier)
      throw new Error('det outcomes of ' + cell.verifier + ' for ' + cell.family + ': not the verifier the policy runs');
    if (!Number.isSafeInteger(cell.runs) || !Number.isSafeInteger(cell.failures) || cell.failures < 0 || cell.failures > cell.runs ||
        !Number.isSafeInteger(cell.full) || cell.full < 0 || cell.full > cell.failures)
      throw new Error('bad det outcome cell ' + cell.model + '@' + cell.effort + '|' + cell.family);
    // Round 3 of the 448 review (lead decision 1): a row's verdicts price it
    // only when they are of the SAME request population as the reference
    // prior: every held-out set of the verifier's validation, and only those
    // (corpus drafts, which price the realized gate, never enter the fit).
    const population = [...(cell.population ?? [])].sort();
    if (heldoutSets !== null && JSON.stringify(population) !== JSON.stringify([...heldoutSets].sort()))
      throw new Error('det outcomes of ' + cell.model + '@' + cell.effort + ': population ' + population.join(',') +
        ' is not the verifier\'s held-out sets ' + [...heldoutSets].sort().join(','));
    const key = cell.model + '@' + cell.effort + '|' + cell.family;
    // Review of round 3: only verdicts on requests inside the verifier's
    // request scope price a row (the population it is det-admitted on).
    let counts = {runs: cell.runs, failures: cell.failures, full: cell.full}, scope = null;
    if (requestOf !== null && LAW_DETERMINISTIC_VERIFIERS[cell.verifier]?.request_scope) {
      if ((detOutcomes.cells ?? []).length !== 1 || !Array.isArray(detOutcomes.items) || detOutcomes.items.length !== cell.runs)
        throw new Error('det outcomes of ' + key + ': a scoped verifier needs one cell and its items');
      const kept = detOutcomes.items.filter(item => {
        const request = requestOf.get(item.request_sha256);
        if (request === undefined) throw new Error('det outcome item of ' + key + ': request not in the validation sets');
        return detRequestInScope(cell.verifier, request) === true;
      });
      counts = {runs: kept.length, failures: kept.filter(i => !i.passed).length, full: kept.filter(i => i.class === 'full').length};
      scope = {id: LAW_DETERMINISTIC_VERIFIERS[cell.verifier].request_scope, kept: kept.length, of: cell.runs};
    }
    out[key] = {runs: (out[key]?.runs ?? 0) + counts.runs, failures: (out[key]?.failures ?? 0) + counts.failures,
      full: (out[key]?.full ?? 0) + counts.full};
    det.push({key, verifier: cell.verifier, ...counts, population, basis: cell.basis, ...(scope ? {request_scope: scope} : {})});
  }
  return {prior: policy.laplace, cells: out, excluded: ledger.excluded, through_ms: ledger.through_ms ?? null,
    learning: policy.p_fail_learning, ...(det.length ? {deterministic: det} : {}),
    key: 'model@effort|law family (judged runs only), pooled over surfaces; no judged run: the prior'};
}

/** Round 3 of the 448 review (lead decision 2): the structural screen counts
 * per model@effort (Core lawScreenPFail), pooled over families and surfaces,
 * from the ledger snapshot (schema 4); Core adds its live ledger after
 * through_ms. */
export function compileScreen(ledger, policy) {
  if (ledger.schema !== 4 || !ledger.screen || !Array.isArray(ledger.screen.cells)) throw new Error('ledger snapshot schema 4 required');
  const cells = {};
  for (const cell of ledger.screen.cells) {
    if (!/^[a-z0-9][a-z0-9._:-]*@[a-z]+$/.test(cell.key) || !Number.isSafeInteger(cell.runs) || !Number.isSafeInteger(cell.failures) ||
        cell.failures < 0 || cell.failures > cell.runs) throw new Error('bad screen cell ' + cell.key);
    cells[cell.key] = {runs: cell.runs, failures: cell.failures};
  }
  return {prior: policy.laplace, cells, through_ms: ledger.through_ms ?? null, basis: ledger.screen.basis,
    key: 'model@effort (screened attempts and law-bound reference answers\' shadow screens), pooled over families and surfaces'};
}

const PREDICATE_KEYS = Object.freeze({task_type: ['chat', 'explain', 'design', 'write', 'action'],
  difficulty: ['light', 'standard', 'deep'], needs_tools: ['none', 'current_facts', 'workspace', 'execution'],
  domain: ['knowledge', 'science', 'math', 'coding', 'writing', 'tool_use', 'general']});
/** A conditional tier's predicate: 'always' (no reading can tell, so the
 * floor applies) or clauses (any matches) of reading values and `writer`
 * (the node runs as a workspace writer). Throws on anything else. */
function validPredicate(when, label) {
  if (when === 'always') return when;
  if (!Array.isArray(when) || !when.length) throw new Error('bad condition predicate ' + label);
  for (const clause of when) {
    if (clause === null || typeof clause !== 'object' || !Object.keys(clause).length) throw new Error('bad clause ' + label);
    for (const [key, value] of Object.entries(clause)) {
      if (key === 'writer') { if (value !== true) throw new Error('bad writer clause ' + label); continue; }
      if (!PREDICATE_KEYS[key] || !Array.isArray(value) || !value.length || !value.every(v => PREDICATE_KEYS[key].includes(v)))
        throw new Error('bad clause key ' + key + ' ' + label);
    }
  }
  return when;
}
/** The families' tier needs: the policy's explicit list, else the evidence's
 * required tiers, else (an easier family with no own tier) its upper bounds;
 * plus every conditional tier of the evidence with the reading predicate the
 * policy maps its condition to (review of 447: a conditional tier is never
 * dropped; a condition no reading can tell applies always, the floor). */
export function compileFamilies(evidence, policy) {
  const out = {};
  for (const [id, family] of Object.entries(policy.families)) {
    let tiers = family.tiers, basis = 'policy', conditional = [];
    if (tiers === 'evidence') {
      const row = evidence.families.find(f => f.id === id);
      if (!row) throw new Error('family without evidence row: ' + id);
      tiers = row.required.length ? row.required : row.upper_bound;
      basis = row.required.length ? 'evidence_required' : 'evidence_upper_bound';
      const mapped = policy.conditions[id] ?? {};
      for (const tier of Object.keys(mapped))
        if (!row.conditional.some(c => c.tier === tier)) throw new Error('condition without evidence: ' + id + ' ' + tier);
      conditional = row.conditional.filter(c => !tiers.includes(c.tier)).map(c => {
        if (!Object.hasOwn(mapped, c.tier)) throw new Error('unmapped conditional tier: ' + id + ' ' + c.tier);
        return {tier: c.tier, when: validPredicate(mapped[c.tier], id + ' ' + c.tier), condition: c.when};
      });
    }
    // Build 448: whether the local row is a CANDIDATE (a capability floor: a
    // tool-free answer family); never an admission (DESIGN-8 step 2).
    out[id] = {tiers: [...tiers], tier_basis: basis, conditional, shape: family.shape, tools: family.tools,
      local_candidate: family.tools === 'none' && family.shape === 'answer'};
  }
  return out;
}

/** Evidence form (c): the committed paired-audit verdicts, keyed
 * model@effort|law family (pooled over surfaces, as p_fail). Only a verdict of
 * the pre-registered rule with its answers' digest is carried. A PASS admits
 * the cell (`admits`) only when it is a parity audit (review of 447): at least
 * n_parity informative questions (zero discordant pairs in n_parity bound the
 * cell's excess failure rate below the family's tier tau at the plan's
 * confidence, with the measured grader sensitivity folded in), sampled at
 * random across the family's traffic. A cost-sized pass (fewer questions, or
 * corpus-order questions) is provisional: carried, never admitting. */
/** The harness OS-1 ships (Swift HarnessProfile.current): its id@version and
 * pinned rendering sha256, read from the source. */
export function harnessPin(text = null) {
  const swift = text ?? readFileSync(join(ROOT, INPUTS.harness), 'utf8');
  const current = /public static let current = (\w+)/.exec(swift)?.[1];
  const block = current ? new RegExp(`public static let ${current} = Descriptor\\(\\s*id: "([^"]+)",\\s*version: (\\d+),` +
    '[\\s\\S]*?renderingSHA256: "([a-f0-9]{64})"\\)').exec(swift) : null;
  if (!block) throw new Error('HarnessProfile.current is not readable');
  return {profile: `${block[1]}@${block[2]}`, rendering_sha256: block[3]};
}
/** The context a checklist parity audit compiles against (round 5): the
 * policy's confidence, the frozen checklist's and the committed
 * sensitivities' digests, the pool references at their ceilings (the table's
 * quota), the shipped harness. */
export function checklistAuditContext({policy, checklistBytes, sensitivities = [], quota = {}, harness}) {
  const sensitivityDigest = value => sha(canonical(value).replace(/\n$/, ''));
  const efforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const references = Object.values(policy.references).map(model => {
    const keys = Object.keys(quota).filter(k => k.slice(k.indexOf(':') + 1, k.lastIndexOf('@')) === model);
    const top = Math.max(-1, ...keys.map(k => efforts.indexOf(k.slice(k.lastIndexOf('@') + 1))));
    return top < 0 ? null : model + '@' + efforts[top];
  }).filter(Boolean);
  return {confidence: policy.value_of_information.confidence, checklist_sha256: sha(checklistBytes),
    sensitivities: new Map(sensitivities.map(value => [sensitivityDigest(value), value])), references, harness};
}
/** Round 4 of the 448 review (lead decision 3): a checklist parity audit
 * (scripts/routing-law-f1-audit.mjs grade: small talk F1, graded by the local
 * model against a frozen checklist, the reference answered twice), re-derived
 * here from its counts: tau is the reference's own run-to-run spread on the
 * checklist (its two runs disagreeing), n_parity = ceil(ln(1 - confidence) /
 * ln(1 - s * tau)) with the grader's measured sensitivity s, and a PASS
 * admits only with zero discordant pairs in at least n_parity informative
 * questions. The cell's and the reference's checklist failure counts are
 * carried as the evidence's report (lawAuditPFail).
 * Round 5: nothing the cell says about itself is trusted: its confidence is
 * the policy's, its checklist the frozen one, its grader sensitivity a
 * committed measurement of the same grader whose digest it carries, its
 * reference a pool reference at its ceiling, its reference harness the one
 * OS-1 ships, its scope the checklist's (small_talk_request_v2, where alone
 * Core admits it). */
function compileChecklistAudit(key, cell, context) {
  const int = value => Number.isSafeInteger(value) && value >= 0;
  const counts = value => value && int(value.runs) && int(value.failures) && value.failures <= value.runs;
  if (!/^[a-f0-9]{64}$/.test(cell.answers_sha256 ?? '') || !/^[a-f0-9]{64}$/.test(cell.checklist_sha256 ?? '') ||
      !int(cell.n) || cell.n < 1 || !int(cell.informative) || !int(cell.discordant) || !int(cell.spread_pairs) ||
      cell.informative > cell.n || cell.spread_pairs > cell.n || !counts(cell.p_fail) || !counts(cell.reference_p_fail) ||
      cell.p_fail.runs !== cell.n || cell.reference_p_fail.runs !== 2 * cell.n || typeof cell.reference !== 'string' ||
      !(typeof cell.confidence === 'number' && cell.confidence > 0 && cell.confidence < 1) ||
      !(cell.grader_sensitivity === null || (typeof cell.grader_sensitivity === 'number' && cell.grader_sensitivity > 0 &&
        cell.grader_sensitivity <= 1)) || cell.sampling !== 'stratified_random')
    throw new Error('bad checklist audit verdict ' + key);
  if (!context) throw new Error('checklist audit ' + key + ': no pre-registered context to compile against');
  const hex = value => /^[a-f0-9]{64}$/.test(value ?? '');
  const sensitivity = context.sensitivities.get(cell.sensitivity_sha256) ?? null;
  const harnessOf = value => value && typeof value === 'object' ? `${value.profile}|${value.rendering_sha256}` : null;
  if (cell.confidence !== context.confidence) throw new Error('checklist audit ' + key + ': confidence is not the policy\'s');
  if (cell.checklist_sha256 !== context.checklist_sha256) throw new Error('checklist audit ' + key + ': not the frozen checklist');
  if (sensitivity === null || sensitivity.s !== cell.grader_sensitivity || sensitivity.checklist_sha256 !== cell.checklist_sha256 ||
      sensitivity.grader_version !== cell.grader_version)
    throw new Error('checklist audit ' + key + ': grader sensitivity is no committed measurement of this grader');
  if (!context.references.includes(cell.reference)) throw new Error('checklist audit ' + key + ': reference is no pool reference at its ceiling');
  if (harnessOf(cell.reference_harness) !== harnessOf(context.harness))
    throw new Error('checklist audit ' + key + ': reference harness is not the one OS-1 ships');
  if (cell.scope !== 'small_talk_request_v2' || !hex(cell.requests_sha256) || !hex(cell.exclusion_sha256) || !hex(cell.lineage))
    throw new Error('checklist audit ' + key + ': no request scope, request set or lineage');
  const tau = cell.spread_pairs / cell.n;
  const x = (cell.grader_sensitivity ?? 0) * tau;
  const nParity = x > 0 ? (x >= 1 ? 1 : Math.ceil(Math.log(1 - cell.confidence) / Math.log(1 - x))) : null;
  const verdict = cell.discordant > 0 ? 'fail' : nParity !== null && cell.informative >= nParity ? 'pass' : 'inconclusive';
  if (cell.verdict !== verdict || cell.n_parity !== nParity) throw new Error('checklist audit verdict does not follow its counts ' + key);
  return {kind: 'checklist_parity', verdict, id: 'audit-' + cell.answers_sha256.slice(0, 12), n: cell.n, discordant: cell.discordant,
    informative: cell.informative, tau, n_parity: nParity, grader_sensitivity: cell.grader_sensitivity, reference: cell.reference,
    checklist_sha256: cell.checklist_sha256, sensitivity_sha256: cell.sensitivity_sha256, scope: cell.scope,
    reference_harness: {profile: cell.reference_harness.profile, rendering_sha256: cell.reference_harness.rendering_sha256},
    p_fail: {runs: cell.p_fail.runs, failures: cell.p_fail.failures},
    reference_p_fail: {runs: cell.reference_p_fail.runs, failures: cell.reference_p_fail.failures}, admits: verdict === 'pass'};
}
export function compileAudits(audits, context = null) {
  if (audits.schema !== 1 || audits.cells === null || typeof audits.cells !== 'object') throw new Error('audits snapshot schema 1 required');
  const out = {};
  for (const [key, cell] of Object.entries(audits.cells)) {
    if (cell?.kind === 'checklist_parity') {
      if (!/^[a-z0-9][a-z0-9._:-]*@[a-z]+\|[A-Za-z0-9-]{1,16}$/.test(key)) throw new Error('bad audit verdict ' + key);
      out[key] = compileChecklistAudit(key, cell, context);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9._-]*@[a-z]+\|[A-Za-z0-9-]{1,16}$/.test(key) || !['pass', 'fail', 'inconclusive'].includes(cell?.verdict) ||
        !/^[a-f0-9]{64}$/.test(cell?.answers_sha256 ?? '') || !Number.isSafeInteger(cell?.n) || cell.n < 1)
      throw new Error('bad audit verdict ' + key);
    const parity = Number.isSafeInteger(cell.n_parity) && cell.n_parity >= 1 && cell.sampling === 'stratified_random' &&
      Number.isSafeInteger(cell.informative) && cell.informative >= cell.n_parity;
    out[key] = {verdict: cell.verdict, id: 'audit-' + cell.answers_sha256.slice(0, 12), n: cell.n, discordant: cell.discordant ?? null,
      n_parity: cell.n_parity ?? null, admits: cell.verdict === 'pass' && parity};
  }
  return {basis: 'REVAS paired audits (scripts/routing-law-audit.mjs grade): ' + audits.rule +
    '; admits only a parity audit (n_parity informative questions sampled at random), a cost-sized pass is provisional', cells: out};
}

/** A deterministic verifier's pre-registered held-out validation (review of
 * 448), recomputed here from the committed labeled sets with Core's own
 * check: every item's verdict against its label, frozen before the verifier
 * ran on it. A false pass is a reply labeled a violation that the verifier
 * passes. Round 2 of the 448 review (D): the length rule binds the local row
 * only, so every item is judged twice, as the local row's reply (capped at
 * the local worker's D) and as a pool row's (no cap): the verifier admits
 * rows only when no set has a false pass in either. A set's role
 * ('heldout': frozen before the verifier ran on it, evaluated once;
 * 'development': seen while it was written) is carried. */
/** Review of round 3: whether a validation item's request (and, on a later
 * turn, the host transcript before it) is inside the verifier's request
 * scope, read as Core reads it at routing (lawSmallTalkScope), on the text
 * and the turn alone: the host profile's signals can only narrow the scope
 * further, so a set's false passes counted without them bound those with
 * them. Null: the verifier has no request scope. */
export function detRequestInScope(id, request, context = null) {
  const scope = LAW_DETERMINISTIC_VERIFIERS[id]?.request_scope ?? null;
  if (scope === null) return null;
  if (scope !== 'small_talk_request_v2') throw new Error('unknown request scope ' + scope);
  if (!lawSmallTalkText(request).passed) return false;
  if (context === null || context === undefined) return true;
  const envelope = JSON.stringify({format: 'os1-session-handoff-v3', transcript: context, priorMessageCount: 2});
  return lawSmallTalkLaterTurn({request, host_context: {context: envelope, codex_session_id: null, claude_session_id: null}});
}
export function validateDeterministicVerifier(id, validation, draftMaxTokens = 512) {
  if (validation?.schema !== 1 || !Array.isArray(validation.sets)) throw new Error('det validation schema 1 required');
  const sets = validation.sets.filter(set => set.verifier === id).map(set => {
    if (!Array.isArray(set.items) || !set.items.length) throw new Error('empty det validation set ' + set.name);
    if (!['heldout', 'development'].includes(set.role)) throw new Error('det validation set without a role: ' + set.name);
    // Review of round 3: a 'routed' set is the population the reader routes
    // to the family (first and later turns), labeled by whether the reply
    // gives the reference's result there; its verdict is the COMPOSITE the
    // law applies: inside the request scope AND the reply passes. A 'reply'
    // set (the default) validates the reply grammar alone, as before, and
    // reports its in-scope clean replies (the reference prior's population).
    const routed = set.population === 'routed';
    if (!['routed', 'reply', undefined].includes(set.population)) throw new Error('bad det validation population ' + set.name);
    const counts = {violations: 0, false_passes: 0, false_passes_uncapped: 0, clean: 0, false_failures: 0,
      false_failures_uncapped: 0, out_of_scope: 0, clean_in_scope: 0, false_failures_uncapped_in_scope: 0};
    for (const item of set.items) {
      if (!['clean', 'violation'].includes(item.label) || typeof item.request !== 'string' || typeof item.reply !== 'string' ||
          !(item.context === undefined || item.context === null || typeof item.context === 'string') || (!routed && item.context != null))
        throw new Error('bad det validation item in ' + set.name);
      const usage = Number.isSafeInteger(item.output_tokens) ? {output_tokens: item.output_tokens} : null;
      const scoped = detRequestInScope(id, item.request, item.context ?? null);
      if (scoped === false) counts.out_of_scope++;
      const gate = check => routed ? scoped !== false && check.passed : check.passed;
      const capped = gate(lawDeterministicCheck(id, item.request, item.reply, usage, draftMaxTokens));
      const uncapped = gate(lawDeterministicCheck(id, item.request, item.reply, null, null));
      if (item.label === 'violation') {
        counts.violations++;
        if (capped) counts.false_passes++;
        if (uncapped) counts.false_passes_uncapped++;
      } else {
        counts.clean++;
        if (!capped) counts.false_failures++;
        if (!uncapped) counts.false_failures_uncapped++;
        if (scoped !== false) {
          counts.clean_in_scope++;
          if (!uncapped) counts.false_failures_uncapped_in_scope++;
        }
      }
    }
    return {name: set.name, role: set.role, population: routed ? 'routed' : 'reply', reference_prior: set.reference_prior === true,
      frozen: set.frozen, items_sha256: sha(Buffer.from(JSON.stringify(set.items))), ...counts};
  });
  const admits = sets.length > 0 && sets.every(set => set.violations > 0 && set.false_passes === 0 && set.false_passes_uncapped === 0);
  return {criterion: validation.criterion, sets, admits};
}
/** Round 2 of the 448 review (lead, defect A: evidence symmetry): the prior
 * p_fail every row admitted by the verifier starts from (Core lawDetPFail) is
 * the verifier's measured rejection rate on REFERENCE-QUALITY replies, as
 * counts (Core adds the Laplace prior):
 *  - the pool references' own judged verdicts on it, once a det-outcomes
 *    snapshot or the ledger has them (the cells of the references' models in
 *    this family; none yet: no reference reply was ever run through it);
 *  - else the clean replies of its HELD-OUT sets (frozen before it ran on
 *    them, evaluated once: B), judged as a pool row's (no length cap: a
 *    reference reply is not capped by the local worker's D). A development
 *    set (seen while the verifier was written) never prices it. */
export function compileDetReferencePrior(family, verifier, validation, pFailCells, references) {
  const refs = Object.entries(pFailCells).filter(([key]) => {
    const [cell, fam] = key.split('|');
    return fam === family && Object.values(references).includes(cell.slice(0, cell.lastIndexOf('@')));
  });
  if (refs.length) return {failures: refs.reduce((a, [, c]) => a + c.failures, 0), runs: refs.reduce((a, [, c]) => a + c.runs, 0),
    full: refs.reduce((a, [, c]) => a + (c.full ?? 0), 0), basis: 'reference_judged_outcomes', cells: refs.map(([key]) => key).sort()};
  // Review of round 3 (lead decision 1 names B): only a held-out set the
  // validation marks reference_prior prices it (C's clean replies are partly
  // the local model's own drafts, which already price the local row; C is
  // evaluated once), and only its replies to requests inside the verifier's
  // request scope (the population a det-admitted row is priced on).
  const held = validation.sets.filter(set => set.role === 'heldout' && set.reference_prior === true);
  if (!held.length) throw new Error('deterministic verifier ' + verifier + ': no held-out reference_prior set to price its prior');
  // A clean reply is never empty: every rejection of one is a 'repair' class.
  return {failures: held.reduce((a, set) => a + set.false_failures_uncapped_in_scope, 0),
    runs: held.reduce((a, set) => a + set.clean_in_scope, 0),
    full: 0, basis: 'heldout_clean_replies_rejected_in_scope', sets: held.map(set => set.name)};
}
/** DESIGN-8 step 2 (a) (build 448): the families with a deterministic
 * verifier, keyed by law family: only an id Core runs
 * (LAW_DETERMINISTIC_VERIFIERS: an entry Core cannot run would admit a row
 * unchecked), made for that law family (review of 448: a small-talk check
 * admits nothing elsewhere), on a tool-free answer family (it reads a
 * reply), with its held-out validation (Core admits only when it passed) and
 * its reference prior (compileDetReferencePrior). */
export function compileDeterministicVerifiers(policy, validation = null, pFailCells = {}) {
  const out = {};
  for (const [family, entry] of Object.entries(policy.deterministic_verifiers ?? {})) {
    const fam = policy.families[family];
    if (!fam) throw new Error('deterministic verifier for an unknown family ' + family);
    if (entry === null || typeof entry !== 'object' || Object.keys(entry).join() !== 'id' ||
        !Object.hasOwn(LAW_DETERMINISTIC_VERIFIERS, entry.id))
      throw new Error('deterministic verifier ' + family + ': not an id Core runs');
    if (!LAW_DETERMINISTIC_VERIFIERS[entry.id].law_families.includes(family))
      throw new Error('deterministic verifier ' + family + ': ' + entry.id + ' is made for ' +
        LAW_DETERMINISTIC_VERIFIERS[entry.id].law_families.join(','));
    if (fam.shape !== 'answer' || fam.tools !== 'none')
      throw new Error('deterministic verifier ' + family + ': a reply check needs a tool-free answer family');
    if (validation === null) throw new Error('deterministic verifier ' + family + ': no held-out validation');
    const checked = validateDeterministicVerifier(entry.id, validation, policy.local_start?.draft_max_tokens ?? 512);
    out[family] = {id: entry.id, validation: checked,
      reference_prior: compileDetReferencePrior(family, entry.id, checked, pFailCells, policy.references)};
  }
  return out;
}

export function compileTable(bytes) {
  const json = name => JSON.parse(bytes[name].toString('utf8'));
  const evidence = json('evidence'), quota = json('quota'), ledger = json('ledger'), policy = json('policy');
  const detValidation = json('det_validation'), detOutcomes = json('det_outcomes');
  const prices = json('prices'), profiles = json('profiles'), audits = json('audits');
  const tau = compileTau(evidence);
  const quotaCompiled = compileQuota(quota, evidence, policy, prices, profiles);
  const auditContext = checklistAuditContext({policy, checklistBytes: bytes.f1_checklist, sensitivities: [json('f1_sensitivity')],
    quota: quotaCompiled.cells, harness: harnessPin(bytes.harness.toString('utf8'))});
  return {schema: 1, policy: 'routing_law_447', objective: policy.objective,
    inputs: Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, sha(value)])),
    references: policy.references, pool_units: policy.pool_units, exchange: policy.exchange,
    p_fail_inheritance: policy.p_fail_inheritance, value_of_information: policy.value_of_information,
    audits: compileAudits(audits, auditContext),
    local_start: (() => {
      if (Object.hasOwn(policy.local_start, 'deterministic_verifiers'))
        throw new Error('local_start.deterministic_verifiers moved to deterministic_verifiers (a family verifier admits any row)');
      return policy.local_start;
    })(), ask_back: policy.ask_back,
    deterministic_verifiers: compileDeterministicVerifiers(policy, detValidation,
      compilePFail(ledger, policy, detOutcomes, heldoutSetsOf(detValidation), requestsOf(detValidation)).cells),
    deterministic_verifiers_rule: policy.deterministic_verifiers_rule,
    tau, admission: compileAdmission(evidence, tau, policy), families: compileFamilies(evidence, policy),
    family_rules: policy.family_rules, quota: quotaCompiled.cells, quota_calibration: quotaCompiled.calibration,
    quota_anchors: quotaCompiled.anchors,
    p_fail: compilePFail(ledger, policy, detOutcomes, heldoutSetsOf(detValidation), requestsOf(detValidation)),
    p_screen: compileScreen(ledger, policy)};
}
/** The names of a det validation's held-out sets (the population every
 * det-admitted row is priced on, round 3 of the 448 review, decision 1). */
function heldoutSetsOf(validation) {
  // Review of round 3: a routed set validates the scope; it prices nothing.
  return (validation?.sets ?? []).filter(set => set.role === 'heldout' && set.population !== 'routed').map(set => set.name);
}
/** sha256(request) -> request over every validation item (the det outcomes
 * name their requests by hash). */
function requestsOf(validation) {
  const out = new Map();
  for (const set of validation?.sets ?? []) for (const item of set.items ?? [])
    if (typeof item.request === 'string') out.set(sha(Buffer.from(item.request)), item.request);
  return out;
}

export function readInputs(root = ROOT) {
  return Object.fromEntries(Object.entries(INPUTS).map(([name, path]) => [name, readFileSync(join(root, path))]));
}
/** The compiled literal Core embeds, and the Swift pin, as written there. */
export function embeddedCopies(root = ROOT) {
  const core = readFileSync(join(root, CORE_PATH), 'utf8');
  const literal = /^const ROUTING_LAW_TABLE_TEXT = (.*);$/m.exec(core)?.[1];
  const corePin = /^export const ROUTING_LAW_TABLE_SHA256 = '([a-f0-9]{64})';$/m.exec(core)?.[1] ?? null;
  const swift = readFileSync(join(root, SWIFT_PATH), 'utf8');
  const swiftPin = /public static let tableSHA256 = "([a-f0-9]{64})"/.exec(swift)?.[1] ?? null;
  return {coreText: literal === undefined ? null : JSON.parse(literal), corePin, swiftPin};
}

function argumentsOf(argv) {
  const [command, ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith('--') || rest[i + 1] === undefined) throw new Error('bad argument ' + rest[i]);
    options[rest[i].slice(2)] = rest[i + 1];
  }
  return {command, options};
}
function writeNew(path, text) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
  try { writeSync(fd, text); } finally { closeSync(fd); }
}
export function main(argv = process.argv.slice(2)) {
  const {command, options} = argumentsOf(argv);
  if (command === 'snapshot-quota') {
    // Schema 2 of the quota input only (review of 447: per-cell context), from
    // the same price-performance quota directory.
    for (const key of ['quota', 'date', 'out-dir']) if (!options[key]) throw new Error('snapshot-quota needs --' + key);
    writeNew(join(options['out-dir'], `routing-law-quota-${options.date}.json`), canonical(snapshotQuota(options.quota)));
    return 0;
  }
  if (command === 'snapshot-ledger') {
    // Build 448: the ledger input only (schema 3, Core's counting rule).
    for (const key of ['ledger', 'date', 'out-dir']) if (!options[key]) throw new Error('snapshot-ledger needs --' + key);
    writeNew(join(options['out-dir'], `routing-law-ledger-${options.date}.json`), canonical(snapshotLedger(readFileSync(options.ledger))));
    return 0;
  }
  if (command === 'snapshot-det-outcomes') {
    // Build 448 (review of 448): Core's deterministic verdicts on a row's
    // real drafts (a private drafts file: {generator, drafts: [{request,
    // draft, output_tokens}]}); only digests and verdicts survive.
    for (const key of ['drafts', 'verifier', 'family', 'model', 'effort', 'date', 'out-dir'])
      if (!options[key]) throw new Error('snapshot-det-outcomes needs --' + key);
    const file = JSON.parse(readFileSync(options.drafts, 'utf8'));
    writeNew(join(options['out-dir'], `routing-law-det-outcomes-${options.date}.json`),
      canonical(snapshotDetOutcomes(file, options)));
    return 0;
  }
  if (command === 'snapshot') {
    for (const key of ['tiers', 'quota', 'ledger', 'date', 'out-dir']) if (!options[key]) throw new Error('snapshot needs --' + key);
    const dir = options['out-dir'];
    writeNew(join(dir, `routing-law-evidence-${options.date}.json`), canonical(snapshotEvidence(readFileSync(options.tiers))));
    writeNew(join(dir, `routing-law-quota-${options.date}.json`), canonical(snapshotQuota(options.quota)));
    writeNew(join(dir, `routing-law-ledger-${options.date}.json`), canonical(snapshotLedger(readFileSync(options.ledger))));
    return 0;
  }
  const bytes = canonical(compileTable(readInputs()));
  if (command === 'compile') {
    if (options.out) writeNew(options.out, bytes); else process.stdout.write(bytes);
    return 0;
  }
  if (command === 'embed') {
    // Rewrites the three shipped copies from the compiler output: the
    // Resources file, Core's literal and pin, and the Swift pin.
    const digest = sha(bytes);
    writeFileSync(join(ROOT, TABLE_PATH), bytes);
    const corePath = join(ROOT, CORE_PATH), swiftPath = join(ROOT, SWIFT_PATH);
    const core = readFileSync(corePath, 'utf8')
      .replace(/^const ROUTING_LAW_TABLE_TEXT = .*;$/m, () => 'const ROUTING_LAW_TABLE_TEXT = ' + JSON.stringify(bytes.slice(0, -1)) + ';')
      .replace(/^export const ROUTING_LAW_TABLE_SHA256 = '[a-f0-9]{64}';$/m, `export const ROUTING_LAW_TABLE_SHA256 = '${digest}';`);
    writeFileSync(corePath, core);
    writeFileSync(swiftPath, readFileSync(swiftPath, 'utf8')
      .replace(/public static let tableSHA256 = "[a-f0-9]{64}"/, `public static let tableSHA256 = "${digest}"`));
    process.stdout.write(`routing law table embedded: ${digest}\n`);
    return 0;
  }
  if (command === 'check') {
    const digest = sha(bytes);
    const resource = readFileSync(join(ROOT, TABLE_PATH), 'utf8');
    const {coreText, corePin, swiftPin} = embeddedCopies();
    const checks = [['Resources copy = compiler output', resource === bytes],
      ['Core literal = compiler output', coreText + '\n' === bytes],
      ['Core pin = sha256', corePin === digest], ['Swift pin = sha256', swiftPin === digest]];
    for (const [label, ok] of checks) process.stdout.write(`routing law table: ${ok ? 'PASS' : 'FAIL'} ${label}\n`);
    process.stdout.write(`routing law table sha256 ${digest}\n`);
    return checks.every(([, ok]) => ok) ? 0 : 1;
  }
  throw new Error('usage: snapshot|snapshot-quota|snapshot-ledger|snapshot-det-outcomes|compile|embed|check');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(String(error.message ?? error) + '\n'); process.exitCode = 64; }
}
