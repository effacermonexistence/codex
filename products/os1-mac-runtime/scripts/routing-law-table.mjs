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
 *    evidence), with the Laplace prior; a cell with no judged run is the prior.
 *
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
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INPUTS = Object.freeze({
  evidence: 'scripts/routing-law-evidence-20261029.json',
  quota: 'scripts/routing-law-quota-20261029.json',
  ledger: 'scripts/routing-law-ledger-20261029.json',
  policy: 'scripts/routing-law-policy.json',
  prices: 'Resources/model-price-table.json',
  profiles: 'Config/production.json',
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

export function snapshotQuota(quotaDir) {
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
    add(groups, JSON.stringify([source, 'openai', r.model, r.effort, shape]), row);
    add(contexts, JSON.stringify([source, 'openai', shape]), row);
  }
  const cells = [...groups].map(([key, rows]) => {
    const [source, provider, model, effort, shape] = JSON.parse(key);
    return {source, provider, model, effort, shape, n: rows.length, pct_median: round(median(rows.map(r => r.pct))),
      output_median: median(rows.map(r => r.out)), cost_median: round(median(rows.map(r => r.cost)))};
  }).filter(cell => cell.shape !== 'mid').sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  const context = [...contexts].map(([key, rows]) => {
    const [source, provider, shape] = JSON.parse(key);
    return {source, provider, shape, n: rows.length, uncached_median: median(rows.map(r => r.uncached)),
      cached_median: median(rows.map(r => r.cached))};
  }).filter(cell => cell.shape !== 'mid').sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  const codex = calibration.codex_conversion_used.pro_weekly;
  return {schema: 1,
    sources: {claude_turns: sha(claudeBytes), codex_turns: sha(codexBytes), calibration: sha(calibrationBytes)},
    conversions: {anthropic_shared: {all: calibration.claude_conversion_used.weekly_all_pct_per_usd.median},
      openai_codex: {'gpt-6-astra': codex['gpt-6-astra'][0], sol_family: codex.sol_family[0], luna_terra: codex.luna_terra[0]}},
    cells, context};
}

const LADDERED = new Set(['tier', 'graded', 'capability', 'law']);
const LADDER_FAILURES = new Set(['ladder_verifier_failed', 'ladder_not_returned']);
const CHECK_PASSES = new Set(['pass', 'screen_pass']);
const CHECK_FAILURES = new Set(['fail', 'not_returned', 'screen_fail']);
/** p_fail evidence (DESIGN-8 step 3: p_fail(c, family)). Only a JUDGED
 * laddered attempt counts: a verifier or check verdict, or an observed
 * failure (it did not return, or it escalated). An attempt never dispatched,
 * or one that completed with no verdict (no verifier registered, a control
 * left unverified) says nothing about whether it gave the reference's result.
 * The family is the law's own (the record's law receipt); an attempt routed
 * before the law has none and is counted as unattributed, never pooled into a
 * family (review of 447). */
export function snapshotLedger(ledgerBytes) {
  const counts = new Map(), excluded = {undispatched: 0, unjudged: 0, no_law_family: 0};
  for (const line of ledgerBytes.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record?.schema !== 1 || !LADDERED.has(record.route_kind) || record.escalated === true) continue;
    if (record.attempt_state === 'verified_not_dispatched') { excluded.undispatched++; continue; }
    const failed = typeof record.escalation_outcome === 'string' || LADDER_FAILURES.has(record.attempt_state) ||
      ['fail', 'not_returned'].includes(record.verifier_outcome) || CHECK_FAILURES.has(record.check_outcome);
    const passed = !failed && (record.verifier_outcome === 'pass' || CHECK_PASSES.has(record.check_outcome));
    if (!failed && !passed) { excluded.unjudged++; continue; }
    const family = typeof record.law?.family === 'string' && /^[A-Za-z0-9-]{1,16}$/.test(record.law.family) ? record.law.family : null;
    if (family === null) { excluded.no_law_family++; continue; }
    const key = JSON.stringify([record.model, record.effort, family]);
    const value = counts.get(key) ?? {runs: 0, failures: 0};
    value.runs++; if (failed) value.failures++;
    counts.set(key, value);
  }
  return {schema: 2, source: {sha256: sha(ledgerBytes), basis: 'judged laddered descents (route kinds tier, graded, ' +
      'capability, law), not escalated, keyed by the law family of their receipt; failure = escalated, not returned, ' +
      'verifier or check fail; success = verifier or check pass'}, excluded,
    cells: [...counts].map(([key, value]) => {
      const [model, effort, family] = JSON.parse(key);
      return {model, effort, family, ...value};
    }).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)};
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
        cells[cell.model + '@' + cell.effort] = {pass: rows.every(row => row[4]) && coverage[0] >= coverage[1],
          coverage, benchmarks: rows};
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
/** Real quota per (surface, model, effort, shape) in pool units. An OS-1
 * dispatch-shaped measured median with n >= measured_min_n is the price; an
 * owner-surface median with n >= measured_min_n is next. Else the token
 * model: the shape's measured OS-1 context at the model's list prices plus its
 * output (the cell's measured output when n >= output_min_n, else the model's
 * nearest measured effort scaled by the effort multiplier, else the shape's
 * pooled output scaled from 'high'), times the measured pool % per API
 * dollar, times the CALIBRATION of that provider and shape: the median ratio
 * of measured price to token-model price over the measured OS-1 cells of the
 * same provider and shape (else of the provider's other shapes, else 1). An
 * uncalibrated token model would price every unmeasured cell below the
 * measured ones (it omits the context tax the measured turns carry). */
export function compileQuota(quota, evidence, policy, prices, profiles) {
  const out = {};
  const providers = {anthropic: 'anthropic_shared', openai: 'openai_codex'};
  const surfacesOf = {anthropic: ['claude', 'claude-chat'], openai: ['codex']};
  const SHAPES = ['answer', 'agentic'];
  function tokenModel(provider, pool, model, effort, shape) {
    const price = prices.models[model];
    const ctx = quota.context.find(c => c.source === 'os1' && c.provider === provider && c.shape === shape) ??
      quota.context.find(c => c.source === 'owner' && c.provider === provider && c.shape === shape);
    const outputs = quota.cells.filter(c => c.provider === provider && c.model === model && c.shape === shape &&
      c.n >= policy.output_min_n && Number.isFinite(c.output_median));
    let output, outBasis;
    const own = outputs.find(c => c.effort === effort && c.source === 'os1') ?? outputs.find(c => c.effort === effort);
    if (own) { output = own.output_median; outBasis = 'output_measured'; }
    else {
      const anchors = outputs.filter(c => EFFORTS.includes(c.effort))
        .sort((a, b) => Math.abs(EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(effort)) -
          Math.abs(EFFORTS.indexOf(b.effort) - EFFORTS.indexOf(effort)) || (a.source === 'os1' ? -1 : 1));
      if (anchors.length) {
        output = anchors[0].output_median * effortMultiplier(evidence, policy, pool, provider, model, anchors[0].effort, effort);
        outBasis = 'output_scaled_from_' + anchors[0].effort;
      } else {
        const pooled = median(quota.cells.filter(c => c.provider === provider && c.shape === shape && c.source === 'os1')
          .map(c => c.output_median));
        output = (pooled ?? 0) * effortMultiplier(evidence, policy, pool, provider, model, 'high', effort);
        outBasis = 'output_pooled_scaled_from_high';
      }
    }
    const usd = ((ctx?.uncached_median ?? 0) * price.input + (ctx?.cached_median ?? 0) * price.cached_input +
      output * price.output) / 1e6;
    return {q: usd * conversionOf(quota, pool, model), outBasis};
  }
  // The calibration per (provider, shape): measured OS-1 cells only.
  const calibration = {};
  for (const [provider, pool] of Object.entries(providers)) {
    calibration[provider] = {};
    for (const shape of SHAPES) {
      const ratios = quota.cells.filter(c => c.source === 'os1' && c.provider === provider && c.shape === shape &&
        c.n >= policy.measured_min_n && prices.models[c.model] && c.pct_median > 0)
        .map(c => c.pct_median / tokenModel(provider, pool, c.model, c.effort, shape).q).filter(Number.isFinite);
      calibration[provider][shape] = ratios.length ? {factor: round(median(ratios), 4), n_cells: ratios.length, from: shape} : null;
    }
    const any = median(Object.values(calibration[provider]).filter(Boolean).map(c => c.factor));
    for (const shape of SHAPES) calibration[provider][shape] ??= any === null ? {factor: 1, n_cells: 0, from: 'none'} :
      {factor: round(any, 4), n_cells: 0, from: 'provider_other_shapes'};
  }
  for (const [provider, pool] of Object.entries(providers)) {
    for (const tuple of MODEL_EFFORTS(profiles, provider === 'anthropic' ? 'claude' : 'codex')) {
      const [model, effort] = tuple.split('@');
      if (!prices.models[model]) continue; // a signed tuple of a model the price table no longer lists: unpriced, never cheapest
      for (const shape of SHAPES) {
        const measured = source => quota.cells.find(c => c.source === source && c.provider === provider && c.model === model &&
          c.effort === effort && c.shape === shape && c.n >= policy.measured_min_n);
        const hit = measured('os1') ?? measured('owner');
        let q, basis, n = null;
        if (hit) { q = hit.pct_median; basis = 'measured_' + hit.source; n = hit.n; }
        else {
          const model_ = tokenModel(provider, pool, model, effort, shape);
          q = model_.q * calibration[provider][shape].factor;
          basis = 'token_model:' + model_.outBasis + ':calibrated_' + calibration[provider][shape].from;
        }
        for (const surface of surfacesOf[provider]) {
          // OS-1's Claude answers (claude-chat and the Claude Code surface)
          // are measured as one OS-1 dispatch population.
          const key = surface + ':' + model + '@' + effort;
          out[key] ??= {pool, model, effort};
          out[key][shape] = {q: round(q, 6), basis, n};
        }
      }
    }
  }
  return {cells: out, calibration};
}

/** p_fail evidence per (model@effort, law family), DESIGN-8 step 3, pooled
 * over surfaces only (a grant that moves a row to another surface must not
 * change the model through it). The judged runs the ledger could not
 * attribute to a law family are reported, never used. */
export function compilePFail(ledger, policy) {
  if (ledger.schema !== 2) throw new Error('ledger snapshot schema 2 (judged, law-family keyed) required');
  const out = {};
  for (const cell of ledger.cells) {
    const key = cell.model + '@' + cell.effort + '|' + cell.family;
    out[key] = {runs: (out[key]?.runs ?? 0) + cell.runs, failures: (out[key]?.failures ?? 0) + cell.failures};
  }
  return {prior: policy.laplace, cells: out, excluded: ledger.excluded,
    key: 'model@effort|law family (judged runs only), pooled over surfaces; no judged run: the prior'};
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
    out[id] = {tiers: [...tiers], tier_basis: basis, conditional, shape: family.shape, tools: family.tools,
      local: policy.local_admission.families.includes(id)};
  }
  return out;
}

export function compileTable(bytes) {
  const json = name => JSON.parse(bytes[name].toString('utf8'));
  const evidence = json('evidence'), quota = json('quota'), ledger = json('ledger'), policy = json('policy');
  const prices = json('prices'), profiles = json('profiles');
  const tau = compileTau(evidence);
  return {schema: 1, policy: 'routing_law_447', objective: policy.objective,
    inputs: Object.fromEntries(Object.entries(bytes).map(([name, value]) => [name, sha(value)])),
    references: policy.references, pool_units: policy.pool_units, headroom_threshold: policy.headroom_threshold,
    local_admission: policy.local_admission, ask_back: policy.ask_back,
    tau, admission: compileAdmission(evidence, tau, policy), families: compileFamilies(evidence, policy),
    family_rules: policy.family_rules, ...(() => {
      const compiled = compileQuota(quota, evidence, policy, prices, profiles);
      return {quota: compiled.cells, quota_calibration: compiled.calibration};
    })(),
    p_fail: compilePFail(ledger, policy)};
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
  throw new Error('usage: snapshot|compile|embed|check');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(String(error.message ?? error) + '\n'); process.exitCode = 64; }
}
