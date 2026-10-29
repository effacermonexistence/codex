#!/usr/bin/env node
/** OS-1 DESIGN-6 O1 (owner decision 2026-10-29, "귀납적으로 계산 … 그래 그렇게 하자"):
 * inductive effort-curve estimation for the capability table, as a CANDIDATE.
 *
 * Deterministic and offline: reads only the files it is named, never the
 * network, a provider or a model. It does not change the shipped compiled
 * table (Resources/model-capability-table.json), its Swift copy or its pin:
 * `compile` writes a separate candidate file. capability-table.mjs reaches it
 * through its `estimate` / `estimate-check` commands.
 *
 *   node scripts/effort-curve-estimator.mjs snapshot --ledger <routing-ledger.jsonl> --on <YYYY-MM-DD> [--out <new file>]
 *   node scripts/effort-curve-estimator.mjs compile --evidence <file> --prices <file> --ledger-snapshot <file> [--out <new file>]
 *   node scripts/effort-curve-estimator.mjs check --evidence <file> --prices <file> --ledger-snapshot <file> --table <file>
 *   node scripts/effort-curve-estimator.mjs report --evidence <file> --prices <file> --ledger-snapshot <file>
 *        --r446c <file> --production <file> --out-dir <new or empty directory>
 *
 * 1. CURVES. A curve is one (provider, model, benchmark): its CONFIRMED scores
 *    at dispatchable efforts (low … max, ultra). A lower-is-better metric is
 *    stored as goodness = -score, so every delta below reads "higher is
 *    better". Units are never mixed: % and "score" (both 0-100 points) are the
 *    unit class `points`; Elo is `elo`; voxel IoU (0-1) is `fraction`;
 *    accepted findings are `count`.
 * 2. ESTIMATOR. A missing (model, effort) score on a benchmark where the model
 *    has a curve = the nearest published point of that curve (the ANCHOR) plus
 *    an effort delta (anchor effort -> target effort). Three component deltas,
 *    each from confirmed curves only and only in the same unit class:
 *     (i)   reference: the pool reference model's own delta on the SAME
 *           benchmark (both efforts published there);
 *     (ii)  model: the median delta of the SAME model over its OTHER
 *           benchmarks that publish both efforts;
 *     (iii) family: the median delta over every curve of the same provider
 *           (the vendor's model family: effort names mean different things
 *           across vendors, so families never pool across providers).
 *    Combination (pre-registered, not tuned on the back-test): the median of
 *    the components that exist (one -> itself, two -> their mean, three -> the
 *    middle one). When two anchors are equally near (one below, one above) the
 *    estimate is the mean of the two anchor estimates (interpolation). No
 *    component -> no estimate. `ultra` (Codex-only, one benchmark) is never
 *    estimated: it is published-only.
 * 3. BACK-TEST. Leave-one-out over every curve with >= 2 published points: each
 *    point is hidden from the whole data set and re-estimated. Errors (estimate
 *    minus actual, goodness units) are kept by unit class, effort distance and
 *    mode (extrapolation: one anchor; interpolation: two). MARGIN for an
 *    estimate of unit u at distance d and mode m (the stated rule): a cell's
 *    value is the nearest-rank 95th percentile of its absolute errors, which
 *    for a thin cell (n < 20) is its MAXIMUM absolute error; n = 0 has no
 *    value. The margin is the larger of the (u, d, all) and (u, d, m) values,
 *    made non-decreasing in d (more conservative than the plain (u, d) p95
 *    whenever extrapolation errs more than the pooled cell); no (u, d, all)
 *    value -> not adoptable at that distance.
 * 4. ADOPTION. Per pool and category, against the pool reference's best
 *    confirmed score at any effort (DESIGN-4 §7, capability-table.mjs
 *    referenceBar), a (model, effort) qualifies only if on EVERY shared
 *    benchmark (the reference's top row confirmed, the model has a curve on
 *    it) its published score >= the bar, or (estimate - margin) >= the bar.
 *    Blockers A and B of capability-table.mjs still apply. Basis `published`
 *    when every shared score was published at that effort, else `estimated`
 *    with the margins used ("공식 점수 기반 추정").
 * 5. COST. Expected USD of one typical request on (model, effort): the input of
 *    capability-table.mjs TYPICAL_CALL (10k uncached + 20k cached, effort-
 *    blind) plus an effort-aware output size, by the first basis that exists:
 *     a. ledger_observed: n >= 3 routing-ledger output-token observations of
 *        that (model, effort), all surfaces pooled, probe-sized replies (< 20
 *        output tokens: liveness pings, "OK", one-word acks) excluded; the
 *        median output tokens;
 *     b. first_party_per_task_ratio: an observed (a) cell of the same provider
 *        that shares >= 1 first-party per-task cost (same benchmark, same cost
 *        unit, both rows confirmed) scaled by the median cost ratio; anchor
 *        order: same model first, then most observations, then nearest effort,
 *        then name; the range over every eligible anchor is recorded;
 *     c. price_table_effort_multiplier: typical-call input plus
 *        1,500 output tokens x a ledger-derived multiplier for the effort (the
 *        median of observed cells' median output / 1,500 at that effort; a
 *        missing effort interpolated log-linearly between observed efforts).
 *    Local and calculator routes cost $0.
 *
 * Never a quality claim about one answer: the providers' own benchmarks, and
 * for an estimated cell an inductive estimate with a back-tested margin. */
import {createHash} from 'node:crypto';
import {closeSync, constants, mkdirSync, openSync, readFileSync, readdirSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BROAD_CATEGORIES, COST_UNIT_OVERRIDES, DOMAINS, EFFORTS, POLICY, POOLS, REFERENCE_BAR, TOLERANCE, TYPICAL_CALL,
  canonical, effortOf, referenceBar, referenceRow} from './capability-table.mjs';

export const ESTIMATE_POLICY = 'capability_delta0_effort_curve_v1';
/** Efforts an estimate may target (ultra is published-only). */
export const TARGET_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const UNIT_CLASSES = Object.freeze({'%': 'points', score: 'points', Elo: 'elo', 'voxel IoU': 'fraction',
  findings: 'count'});
export const COMBINATION = 'median_of_available_components';
export const COMPONENTS = Object.freeze(['reference', 'model', 'family']);
export const MARGIN_RULE = Object.freeze({percentile: 95, method: 'nearest_rank',
  thin_cell: 'n < 20: the nearest-rank p95 is the maximum absolute error', empty_cell: 'no_value',
  mode: 'max(all, own mode)', distance: 'non_decreasing', missing_all: 'not_adoptable'});
export const LEDGER_MIN_N = 3;
export const PROBE_OUTPUT_TOKENS_BELOW = 20;
export const COST_BASES = Object.freeze(['ledger_observed', 'first_party_per_task_ratio',
  'price_table_effort_multiplier']);
/** Surfaces a model of each provider answers on (DESIGN-6 §5 surface rule). */
export const SURFACES = Object.freeze({anthropic: {chat: 'claude-chat', agent: 'claude'},
  openai: {chat: 'codex', agent: 'codex'}});
const EPSILON = 1e-9;

export const unitClass = unit => UNIT_CLASSES[unit] ?? 'other:' + unit;
const effortIndex = effort => EFFORTS.indexOf(effort);
const byEffort = (a, b) => effortIndex(a) - effortIndex(b);
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const round6 = value => value === null || value === undefined ? null : Math.round(value * 1e6) / 1e6 + 0;
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return null;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
/** Nearest-rank percentile: the ceil(p/100 * n)-th smallest value. */
export function nearestRank(values, percentile) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.max(1, Math.ceil(percentile / 100 * sorted.length)) - 1];
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const curveKey = (provider, model, benchmark) => [provider, model, benchmark].join('\n');

// ---- 1. Curves ------------------------------------------------------------------

/** The curves of the evidence rows: Map key -> {provider, model, benchmark,
 * category, unit, unit_class, lower_better, points: {effort: goodness}}.
 * Confirmed rows at a dispatchable effort only; two confirmed values for one
 * point: the worse one stands. */
export function buildCurves(rows) {
  const curves = new Map();
  for (const row of rows) {
    if (row.status !== 'confirmed') continue;
    const effort = effortOf(row.reasoning_level);
    if (effort === null || !Number.isFinite(row.score)) continue;
    const key = curveKey(row.provider, row.model, row.benchmark);
    let curve = curves.get(key);
    if (!curve) {
      curve = {key, provider: row.provider, model: row.model, benchmark: row.benchmark, category: row.category,
        unit: row.unit, unit_class: unitClass(row.unit), lower_better: row.lower_better === true, points: {}};
      curves.set(key, curve);
    } else if (curve.category !== row.category || curve.unit !== row.unit || curve.lower_better !== (row.lower_better === true))
      throw new Error('effort_curve_inconsistent:' + key.replaceAll('\n', '|'));
    const value = curve.lower_better ? -row.score : row.score;
    curve.points[effort] = effort in curve.points ? Math.min(curve.points[effort], value) : value;
  }
  return curves;
}
/** The same curves with one point hidden (the leave-one-out data set). */
export function hidePoint(curves, key, effort) {
  const copy = new Map(curves);
  const curve = curves.get(key);
  if (!curve || !(effort in curve.points)) throw new Error('effort_curve_hide_missing');
  const points = {...curve.points};
  delete points[effort];
  copy.set(key, {...curve, points});
  return copy;
}
const toScore = (curve, goodness) => curve.lower_better ? -goodness : goodness;

// ---- 2. Estimator -----------------------------------------------------------------

function pairDeltas(curves, include, from, to) {
  const deltas = [];
  for (const curve of curves.values())
    if (include(curve) && from in curve.points && to in curve.points) deltas.push(curve.points[to] - curve.points[from]);
  return deltas;
}

/** The estimate of curve `key` at `effort` (a target effort the curve does not
 * publish) from the data set `curves`. Returns null when the curve is unknown
 * or the effort is not a target effort; otherwise {estimable, distance, mode,
 * anchors: [{anchor, anchor_goodness, components, counts, delta, estimate}],
 * goodness, score}. `references`: {provider: reference model}. */
export function estimatePoint(curves, {key, effort, references}) {
  const curve = curves.get(key);
  if (!curve || !TARGET_EFFORTS.includes(effort)) return null;
  const anchors = Object.keys(curve.points).filter(point => point !== effort);
  if (!anchors.length) return null;
  const distance = Math.min(...anchors.map(point => Math.abs(effortIndex(point) - effortIndex(effort))));
  const nearest = anchors.filter(point => Math.abs(effortIndex(point) - effortIndex(effort)) === distance).sort(byEffort);
  const reference = references[curve.provider];
  const referenceCurve = curves.get(curveKey(curve.provider, reference, curve.benchmark));
  const results = nearest.map(anchor => {
    const referenceDelta = referenceCurve && referenceCurve.model !== curve.model && anchor in referenceCurve.points &&
      effort in referenceCurve.points ? referenceCurve.points[effort] - referenceCurve.points[anchor] : null;
    const own = pairDeltas(curves, other => other.key !== curve.key && other.provider === curve.provider &&
      other.model === curve.model && other.unit_class === curve.unit_class, anchor, effort);
    const family = pairDeltas(curves, other => other.key !== curve.key && other.provider === curve.provider &&
      other.unit_class === curve.unit_class, anchor, effort);
    const components = {reference: referenceDelta, model: median(own), family: median(family)};
    const available = COMPONENTS.map(name => components[name]).filter(value => value !== null);
    const delta = available.length ? median(available) : null;
    return {anchor, anchor_goodness: curve.points[anchor], components,
      counts: {reference: referenceDelta === null ? 0 : 1, model: own.length, family: family.length}, delta,
      estimate: delta === null ? null : curve.points[anchor] + delta};
  });
  const usable = results.filter(result => result.estimate !== null);
  const goodness = usable.length ? usable.reduce((sum, result) => sum + result.estimate, 0) / usable.length : null;
  return {estimable: goodness !== null, distance, mode: usable.length === 2 ? 'interpolation' : 'extrapolation',
    unit_class: curve.unit_class, anchors: results, goodness, score: goodness === null ? null : toScore(curve, goodness)};
}

// ---- 3. Back-test and margins -------------------------------------------------------

/** Leave-one-out over every curve with >= 2 points. One sample per hidden
 * point: estimable or not; errors in goodness units (estimate - actual). */
export function backTest(curves, references) {
  const samples = [];
  const ordered = [...curves.values()].sort((a, b) => compareText(a.key, b.key));
  for (const curve of ordered) {
    const efforts = Object.keys(curve.points).sort(byEffort);
    if (efforts.length < 2) continue;
    for (const effort of efforts) {
      const sample = {provider: curve.provider, model: curve.model, benchmark: curve.benchmark,
        category: curve.category, unit_class: curve.unit_class, lower_is_better: curve.lower_better, effort,
        actual: toScore(curve, curve.points[effort])};
      if (!TARGET_EFFORTS.includes(effort)) { samples.push({...sample, estimable: false, reason: 'published_only_effort'}); continue; }
      const estimate = estimatePoint(hidePoint(curves, curve.key, effort), {key: curve.key, effort, references});
      if (!estimate?.estimable) {
        samples.push({...sample, estimable: false, reason: 'no_component', distance: estimate?.distance ?? null});
        continue;
      }
      const error = estimate.goodness - curve.points[effort];
      // Each component alone (diagnostic only): its anchors' mean estimate.
      const alone = {};
      for (const name of COMPONENTS) {
        const values = estimate.anchors.filter(anchor => anchor.components[name] !== null)
          .map(anchor => anchor.anchor_goodness + anchor.components[name]);
        alone[name] = values.length === estimate.anchors.length && values.length ?
          round6(values.reduce((sum, value) => sum + value, 0) / values.length - curve.points[effort]) : null;
      }
      samples.push({...sample, estimable: true, distance: estimate.distance, mode: estimate.mode,
        anchors: estimate.anchors.map(anchor => anchor.anchor), estimate: round6(estimate.score),
        signed_error: round6(error), abs_error: round6(Math.abs(error)), component_errors: alone,
        components_used: estimate.anchors.map(anchor => COMPONENTS.filter(name => anchor.components[name] !== null))});
    }
  }
  return samples;
}

function cellStats(errors) {
  const n = errors.length;
  if (!n) return {n: 0, value: null};
  const absolute = errors.map(Math.abs);
  // Nearest rank: for n < 20, ceil(0.95 n) = n, so a thin cell's value is its maximum error.
  return {n, value: round6(nearestRank(absolute, MARGIN_RULE.percentile)), max_abs: round6(Math.max(...absolute)), mean_abs: round6(absolute.reduce((s, v) => s + v, 0) / n),
  mean_signed: round6(errors.reduce((s, v) => s + v, 0) / n)};
}
/** Margins by unit class and distance (see the header, rule 3). */
export function marginsFrom(samples) {
  const margins = {};
  const units = [...new Set(samples.filter(sample => sample.estimable).map(sample => sample.unit_class))].sort();
  for (const unit of units) {
    const own = samples.filter(sample => sample.estimable && sample.unit_class === unit);
    const maxDistance = Math.max(...own.map(sample => sample.distance));
    const table = {};
    const running = {all: 0, interpolation: 0, extrapolation: 0};
    for (let distance = 1; distance <= Math.max(maxDistance, TARGET_EFFORTS.length - 1); distance++) {
      const at = own.filter(sample => sample.distance === distance);
      const all = cellStats(at.map(sample => sample.signed_error));
      const row = {all};
      for (const mode of ['extrapolation', 'interpolation']) row[mode] = cellStats(at.filter(sample => sample.mode === mode)
        .map(sample => sample.signed_error));
      row.margin = {};
      for (const mode of ['extrapolation', 'interpolation']) {
        if (all.value === null) { row.margin[mode] = null; continue; }
        running[mode] = Math.max(running[mode], all.value, row[mode].value ?? 0);
        row.margin[mode] = round6(running[mode]);
      }
      table[distance] = row;
    }
    margins[unit] = table;
  }
  return margins;
}
/** The margin an estimate carries, or null (not adoptable). */
export function marginFor(margins, estimate) {
  return margins?.[estimate.unit_class]?.[estimate.distance]?.margin?.[estimate.mode] ?? null;
}

// ---- 5. Cost --------------------------------------------------------------------------

/** The price-table key of an evidence or ledger model name (exact, else the one
 * dated key it prefixes: claude-haiku-4-5 -> claude-haiku-4-5-20251001). */
export function priceModel(prices, model) {
  if (prices.models[model]) return model;
  const keys = Object.keys(prices.models).filter(key => key.startsWith(model + '-'));
  return keys.length === 1 ? keys[0] : null;
}
function costUnitOf(row) {
  return COST_UNIT_OVERRIDES[[row.provider, row.benchmark, row.model, row.reasoning_level].join('\n')] ?? 'usd_per_task';
}
const usdOf = (price, output) => (TYPICAL_CALL.uncached_input * price.input + TYPICAL_CALL.cached_input *
  price.cached_input + output * price.output) / 1_000_000;

/** The routing-ledger usage snapshot: reads ONLY surface, model, effort,
 * usage.output_tokens and usage.provider_calls of each JSONL record. */
export function ledgerSnapshot(text, {sourceSha256, on}) {
  const cells = new Map();
  let records = 0, observations = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    records++;
    const record = JSON.parse(line);
    const surface = record.surface, model = record.model, effort = record.effort;
    const output = record.usage?.output_tokens, calls = record.usage?.provider_calls;
    if (typeof surface !== 'string' || typeof model !== 'string' || typeof effort !== 'string' ||
        !Number.isInteger(output) || output < 0 || !(calls >= 1)) continue;
    observations++;
    const key = surface + '\n' + model + '\n' + effort;
    if (!cells.has(key)) cells.set(key, {surface, model, effort, output_tokens: []});
    cells.get(key).output_tokens.push(output);
  }
  return {schema: 1, kind: 'routing_ledger_usage_snapshot', taken_on: on, source_sha256: sourceSha256,
    source_records: records, observations, fields_read: ['surface', 'model', 'effort', 'usage.output_tokens',
      'usage.provider_calls'],
    cells: [...cells.values()].map(cell => ({...cell, output_tokens: cell.output_tokens.sort((a, b) => a - b)}))
      .sort((a, b) => compareText(a.surface + a.model + a.effort, b.surface + b.model + b.effort))};
}

/** The cost model over the evidence, prices and ledger snapshot. Returns
 * {cost(model, effort), observed, multipliers, probe_output_tokens}. */
export function costModel({evidence, prices, snapshot}) {
  if (snapshot?.schema !== 1 || snapshot.kind !== 'routing_ledger_usage_snapshot' || !Array.isArray(snapshot.cells))
    throw new Error('ledger_snapshot_invalid');
  // a. Observed cells: (price model, effort), surfaces pooled, probes out.
  const pooled = new Map(), probes = [];
  for (const cell of snapshot.cells) {
    const model = priceModel(prices, cell.model);
    if (model === null || cell.surface === 'local') continue;
    const key = model + '\n' + cell.effort;
    if (!pooled.has(key)) pooled.set(key, {model, effort: cell.effort, surfaces: {}, outputs: [], excluded_probe: 0});
    const entry = pooled.get(key);
    entry.surfaces[cell.surface] = (entry.surfaces[cell.surface] ?? 0) + cell.output_tokens.length;
    for (const tokens of cell.output_tokens)
      if (tokens < PROBE_OUTPUT_TOKENS_BELOW) { entry.excluded_probe++; probes.push(tokens); } else entry.outputs.push(tokens);
  }
  const observed = new Map();
  for (const [key, entry] of pooled) {
    const price = prices.models[entry.model];
    const n = entry.outputs.length;
    const output = median(entry.outputs);
    observed.set(key, {...entry, provider: price.provider, n, median_output_tokens: output,
      usd: n >= LEDGER_MIN_N ? usdOf(price, output) : null});
  }
  const observedCells = [...observed.values()].filter(cell => cell.usd !== null);
  // b. First-party per-task costs: (provider, benchmark) -> (price model, effort) -> {cost, unit}.
  const taskCosts = new Map();
  for (const row of evidence.rows) {
    const effort = effortOf(row.reasoning_level);
    if (row.status !== 'confirmed' || effort === null || !Number.isFinite(row.cost)) continue;
    const model = priceModel(prices, row.model);
    if (model === null) continue;
    const key = row.provider + '\n' + row.benchmark;
    if (!taskCosts.has(key)) taskCosts.set(key, new Map());
    taskCosts.get(key).set(model + '\n' + effort, {cost: row.cost, unit: costUnitOf(row)});
  }
  const ratioBetween = (a, b) => {
    const ratios = [], benchmarks = [];
    for (const [key, byTuple] of taskCosts) {
      const x = byTuple.get(a), y = byTuple.get(b);
      if (!x || !y || x.unit !== y.unit || !(y.cost > 0)) continue;
      ratios.push(x.cost / y.cost);
      benchmarks.push(key.split('\n')[1]);
    }
    return ratios.length ? {ratio: median(ratios), benchmarks: benchmarks.sort()} : null;
  };
  // c. Ledger-derived effort output multipliers (observed cells, effort named).
  const known = {};
  for (const effort of EFFORTS) {
    const at = observedCells.filter(cell => cell.effort === effort);
    if (at.length) known[effort] = median(at.map(cell => cell.median_output_tokens / TYPICAL_CALL.output));
  }
  const multipliers = {};
  const knownEfforts = Object.keys(known).sort(byEffort);
  for (const effort of EFFORTS) {
    if (effort in known) { multipliers[effort] = {value: round6(known[effort]), basis: 'ledger_median'}; continue; }
    const below = knownEfforts.filter(other => effortIndex(other) < effortIndex(effort)).at(-1);
    const above = knownEfforts.find(other => effortIndex(other) > effortIndex(effort));
    if (!below && !above) multipliers[effort] = {value: 1, basis: 'no_ledger_effort'};
    else if (!below || !above) multipliers[effort] = {value: round6(known[below ?? above]), basis: 'nearest_' + (below ?? above)};
    else {
      const t = (effortIndex(effort) - effortIndex(below)) / (effortIndex(above) - effortIndex(below));
      multipliers[effort] = {value: round6(Math.exp(Math.log(known[below]) * (1 - t) + Math.log(known[above]) * t)),
        basis: 'log_interpolated_' + below + '_' + above};
    }
  }
  const cache = new Map();
  function cost(model, effort) {
    const priced = priceModel(prices, model);
    if (priced === null) return {usd: null, basis: 'unpriced'};
    const key = priced + '\n' + effort;
    if (cache.has(key)) return cache.get(key);
    const price = prices.models[priced];
    const seen = observed.get(key);
    let result;
    if (seen?.usd != null) result = {usd: round6(seen.usd), basis: 'ledger_observed', n: seen.n,
      median_output_tokens: seen.median_output_tokens, excluded_probe: seen.excluded_probe, surfaces: seen.surfaces};
    else {
      const anchors = observedCells.filter(cell => cell.provider === price.provider && cell.model + '\n' + cell.effort !== key)
        .map(cell => ({cell, shared: ratioBetween(key, cell.model + '\n' + cell.effort)}))
        .filter(item => item.shared !== null)
        .sort((a, b) => ((a.cell.model === priced ? 0 : 1) - (b.cell.model === priced ? 0 : 1)) || (b.cell.n - a.cell.n) ||
          (Math.abs(effortIndex(a.cell.effort) - effortIndex(effort)) - Math.abs(effortIndex(b.cell.effort) - effortIndex(effort))) ||
          compareText(a.cell.model, b.cell.model) || byEffort(a.cell.effort, b.cell.effort));
      if (anchors.length) {
        const [{cell, shared}] = anchors;
        const range = anchors.map(item => item.cell.usd * item.shared.ratio);
        result = {usd: round6(cell.usd * shared.ratio), basis: 'first_party_per_task_ratio',
          anchor: cell.model + '@' + cell.effort, anchor_usd: round6(cell.usd), anchor_n: cell.n, ratio: round6(shared.ratio),
          ratio_benchmarks: shared.benchmarks, anchor_range_usd: [round6(Math.min(...range)), round6(Math.max(...range))],
          anchors_considered: anchors.length, observed_n: seen?.n ?? 0};
      } else {
        const multiplier = multipliers[effort]?.value ?? 1;
        result = {usd: round6(usdOf(price, TYPICAL_CALL.output * multiplier)), basis: 'price_table_effort_multiplier',
          multiplier, observed_n: seen?.n ?? 0};
      }
    }
    cache.set(key, result);
    return result;
  }
  return {cost, observed: observedCells, multipliers, probe_output_tokens: median(probes), probe_rows: probes.length,
    ratioBetween: (a, b) => ratioBetween(priceModel(prices, a.model) + '\n' + a.effort, priceModel(prices, b.model) + '\n' + b.effort)};
}

// ---- 4. Adoption ---------------------------------------------------------------------------

/** Every (model, effort) a pool's category can bind: the target efforts the
 * model publishes anywhere in the evidence, plus any other dispatchable
 * effort it publishes in this category (ultra). */
function candidateTuples(providerRows, categoryRows, reference) {
  const offered = new Map();
  for (const row of providerRows) {
    const effort = effortOf(row.reasoning_level);
    if (effort === null) continue;
    if (!offered.has(row.model)) offered.set(row.model, new Set());
    if (TARGET_EFFORTS.includes(effort) || row.category === categoryRows[0]?.category) offered.get(row.model).add(effort);
  }
  const models = [...new Set(categoryRows.map(row => row.model))].sort();
  const tuples = [];
  for (const model of models) for (const effort of [...(offered.get(model) ?? [])].sort(byEffort))
    if (!(model === reference && effort === 'max')) tuples.push({model, effort});
  return tuples;
}

/** The O1 rule for one pool and one evidence category. */
export function qualifyCategoryEstimated(providerRows, {category, reference, references, curves, margins, cost,
  blockers = true, marginScale = 1}) {
  const categoryRows = providerRows.filter(row => row.category === category);
  const benchmarks = [...new Set(categoryRows.map(row => row.benchmark))].sort();
  const shared = [];
  for (const benchmark of benchmarks) {
    const benchmarkRows = categoryRows.filter(row => row.benchmark === benchmark);
    const top = referenceRow(benchmarkRows, reference);
    if (top.row) shared.push({benchmark, rows: benchmarkRows, top, bar: referenceBar(benchmarkRows, reference, top)});
  }
  const referenceCost = cost(reference, 'max');
  const qualifying = [], rejected = [], blocked = [];
  for (const {model, effort} of candidateTuples(providerRows, categoryRows, reference)) {
    const entries = [];
    let failure = null, blocker = null;
    for (const {benchmark, rows, top, bar} of shared) {
      if (model === reference && effort === top.effort) continue; // the reference row itself
      const lowerBetter = top.row.lower_better === true;
      const goodness = score => lowerBetter ? -score : score;
      const atOrAbove = score => goodness(score) - goodness(bar.score) >= -EPSILON;
      const mine = rows.filter(row => row.model === model);
      const own = mine.filter(row => effortOf(row.reasoning_level) === effort && row.status === 'confirmed');
      if (blockers && blocker === null && !own.length) {
        const unconfirmed = mine.filter(row => effortOf(row.reasoning_level) === effort && row.status !== 'confirmed');
        if (unconfirmed.length && unconfirmed.every(row => !atOrAbove(row.score)))
          blocker = 'unconfirmed_below_reference:' + benchmark;
        const higher = mine.find(row => row.status === 'confirmed' && effortOf(row.reasoning_level) !== null &&
          effortIndex(effortOf(row.reasoning_level)) > effortIndex(effort) && !atOrAbove(row.score));
        if (higher && blocker === null) blocker = 'below_reference_at_higher_effort:' + benchmark + '@' + effortOf(higher.reasoning_level);
      }
      const base = {benchmark, unit: top.row.unit, unit_class: unitClass(top.row.unit), lower_is_better: lowerBetter,
        reference_score: bar.score, reference_effort: bar.effort};
      if (own.length) {
        const score = lowerBetter ? Math.max(...own.map(row => row.score)) : Math.min(...own.map(row => row.score));
        const entry = {...base, source: 'published', score, margin: null, lower_bound: score,
          delta: round6(goodness(score) - goodness(bar.score))};
        entries.push(entry);
        if (entry.delta < -EPSILON && failure === null) failure = 'below_reference:' + benchmark;
        continue;
      }
      const key = curveKey(top.row.provider, model, benchmark);
      if (!curves.has(key)) continue; // no confirmed score of this model here: not shared
      const estimate = estimatePoint(curves, {key, effort, references});
      if (!estimate?.estimable) {
        entries.push({...base, source: 'unestimable', score: null, margin: null, lower_bound: null, delta: null});
        if (failure === null) failure = 'unestimable:' + benchmark;
        continue;
      }
      // marginScale 0 is a diagnostic only (the point estimate alone); 1 is the rule.
      const margin = marginScale === 0 ? 0 : marginFor(margins, estimate);
      const lowerBound = margin === null ? null : estimate.goodness - margin * marginScale;
      const entry = {...base, source: 'estimated', score: round6(estimate.score), margin, distance: estimate.distance,
        mode: estimate.mode, lower_bound: lowerBound === null ? null : round6(lowerBetter ? -lowerBound : lowerBound),
        delta: lowerBound === null ? null : round6(lowerBound - goodness(bar.score)),
        anchors: estimate.anchors.map(anchor => ({effort: anchor.anchor, score: round6(lowerBetter ? -anchor.anchor_goodness :
          anchor.anchor_goodness), components: Object.fromEntries(COMPONENTS.map(name => [name, round6(anchor.components[name])])),
          counts: anchor.counts, delta: round6(anchor.delta)}))};
      entries.push(entry);
      if (failure === null) {
        if (margin === null) failure = 'no_margin:' + benchmark;
        else if (entry.delta < -EPSILON) failure = 'estimate_below_reference:' + benchmark;
      }
    }
    const reason = !entries.length ? 'no_shared_confirmed_benchmark' : failure ?? blocker;
    if (reason !== null) {
      rejected.push({model, effort, reason, shared: entries.length});
      if (failure === null && blocker !== null) blocked.push({model, effort, reason: blocker});
      continue;
    }
    const estimated = entries.filter(entry => entry.source === 'estimated');
    const marginByUnit = {};
    for (const entry of estimated) marginByUnit[entry.unit_class] = Math.max(marginByUnit[entry.unit_class] ?? 0, entry.margin);
    const usd = cost(model, effort);
    qualifying.push({model, effort, basis: estimated.length ? 'estimated' : 'published',
      basis_label: estimated.length ? 'estimated(' + Object.entries(marginByUnit).map(([unit, value]) => '±' + round6(value) +
        ' ' + unit).join(', ') + ')' : 'published', margin: estimated.length ? marginByUnit : null,
      estimated_benchmarks: estimated.length, expected_cost_usd: usd.usd, cost_basis: usd.basis,
      cheaper_than_reference: usd.usd !== null && referenceCost.usd !== null && usd.usd < referenceCost.usd - EPSILON,
      benchmarks: entries});
  }
  qualifying.sort((a, b) => ((a.expected_cost_usd ?? Infinity) - (b.expected_cost_usd ?? Infinity)) ||
    byEffort(a.effort, b.effort) || compareText(a.model, b.model));
  rejected.sort((a, b) => compareText(a.model, b.model) || byEffort(a.effort, b.effort));
  return {reference: {model: reference, effort: 'max', expected_cost_usd: referenceCost.usd, cost_basis: referenceCost.basis,
    shared_benchmarks: shared.map(item => item.benchmark)}, qualifying, blocked, rejected};
}

// ---- The candidate table --------------------------------------------------------------------

/** Everything the candidate and the report need, from the three inputs. Pure. */
export function estimateAll(evidenceBytes, pricesBytes, snapshotBytes, {blockers = true} = {}) {
  const evidence = JSON.parse(Buffer.from(evidenceBytes).toString('utf8'));
  const prices = JSON.parse(Buffer.from(pricesBytes).toString('utf8'));
  const snapshot = JSON.parse(Buffer.from(snapshotBytes).toString('utf8'));
  if (evidence?.schema !== 1 || !Array.isArray(evidence.rows) || !evidence.references ||
      prices?.schema !== 1 || prices.unit !== 'per_1m_tokens' || prices.currency !== 'USD')
    throw new Error('capability_estimate_input_invalid');
  const references = evidence.references;
  const curves = buildCurves(evidence.rows);
  const samples = backTest(curves, references);
  const margins = marginsFrom(samples);
  const costs = costModel({evidence, prices, snapshot});
  const categories = {};
  for (const [domain, category] of Object.entries(DOMAINS)) {
    const pools = {};
    for (const [provider, pool] of Object.entries(POOLS))
      pools[pool] = qualifyCategoryEstimated(evidence.rows.filter(row => row.provider === provider), {category,
        reference: references[provider], references, curves, margins, cost: costs.cost, blockers});
    categories[domain] = {evidence_category: category, pools};
  }
  const broad = {categories: [...BROAD_CATEGORIES], pools: {}};
  for (const pool of Object.values(POOLS)) {
    const lists = BROAD_CATEGORIES.map(domain => categories[domain].pools[pool].qualifying);
    broad.pools[pool] = lists[0].filter(row => lists.every(list => list.some(other => other.model === row.model &&
      other.effort === row.effort))).map(({model, effort, expected_cost_usd}) => ({model, effort, expected_cost_usd,
      basis: BROAD_CATEGORIES.map(domain => categories[domain].pools[pool].qualifying.find(other => other.model === model &&
        other.effort === effort).basis).includes('estimated') ? 'estimated' : 'published'}));
  }
  const multiCurves = [...curves.values()].filter(curve => Object.keys(curve.points).length >= 2).length;
  return {evidence, prices, snapshot, references, curves, samples, margins, costs, categories, broad, multiCurves,
    shas: {evidence: sha256(evidenceBytes), prices: sha256(pricesBytes), snapshot: sha256(snapshotBytes)}};
}

export function backTestSummary(samples) {
  const summary = {};
  for (const unit of [...new Set(samples.map(sample => sample.unit_class))].sort()) {
    const own = samples.filter(sample => sample.unit_class === unit);
    const ok = own.filter(sample => sample.estimable);
    const component = {};
    for (const name of COMPONENTS) {
      const errors = ok.map(sample => sample.component_errors[name]).filter(value => value !== null);
      component[name] = errors.length ? {n: errors.length, mean_abs: round6(errors.reduce((s, v) => s + Math.abs(v), 0) /
        errors.length), p95_abs: round6(nearestRank(errors.map(Math.abs), 95))} : {n: 0};
    }
    summary[unit] = {hidden_points: own.length, estimable: ok.length, unestimable: own.length - ok.length,
      mean_abs: ok.length ? round6(ok.reduce((s, x) => s + x.abs_error, 0) / ok.length) : null,
      mean_signed: ok.length ? round6(ok.reduce((s, x) => s + x.signed_error, 0) / ok.length) : null,
      p95_abs: ok.length ? round6(nearestRank(ok.map(x => x.abs_error), 95)) : null, component_alone: component};
  }
  return summary;
}

/** The compiled candidate (pure). Not the shipped table: nothing pins it. */
export function compileEstimatedTable(evidenceBytes, pricesBytes, snapshotBytes, options = {}) {
  const all = estimateAll(evidenceBytes, pricesBytes, snapshotBytes, options);
  const {costs} = all;
  return {schema: 1, policy: ESTIMATE_POLICY, status: 'candidate_not_shipped', base_policy: POLICY, tolerance: TOLERANCE,
    reference_bar: REFERENCE_BAR, compiled_on: all.evidence.retrieved_on,
    blockers: options.blockers === false ? [] : ['unconfirmed_below_reference', 'below_reference_at_higher_effort'],
    evidence_sha256: all.shas.evidence, price_table_sha256: all.shas.prices, ledger_snapshot_sha256: all.shas.snapshot,
    basis: 'first_party_benchmarks_published_or_estimated_minus_backtested_margin_not_an_answer_check',
    estimator: {target_efforts: [...TARGET_EFFORTS], unit_classes: UNIT_CLASSES, components: [...COMPONENTS],
      combination: COMBINATION, anchor: 'nearest_published_effort_same_curve;two_equidistant_anchors_mean',
      family: 'same_provider_all_models_same_unit_class', confirmed_only: true},
    backtest: {multi_effort_curves: all.multiCurves, summary: backTestSummary(all.samples)},
    margin_rule: MARGIN_RULE, margins: all.margins,
    cost: {bases: [...COST_BASES], typical_input: {uncached_input: TYPICAL_CALL.uncached_input,
      cached_input: TYPICAL_CALL.cached_input}, ledger_min_n: LEDGER_MIN_N,
    probe_rule: 'output_tokens < ' + PROBE_OUTPUT_TOKENS_BELOW + ' excluded', multipliers: costs.multipliers,
    observed: costs.observed.map(cell => ({model: cell.model, effort: cell.effort, n: cell.n,
      median_output_tokens: cell.median_output_tokens, excluded_probe: cell.excluded_probe, usd: round6(cell.usd)}))
      .sort((a, b) => compareText(a.model, b.model) || byEffort(a.effort, b.effort))},
    categories: all.categories, broad: all.broad};
}

// ---- The owner fixed-question table (DESIGN-6 §4 + O2) ----------------------------------------

/** DESIGN-6 §4's 16 questions with their pre-registered families; #9 asks
 * back first (O2). */
export const OWNER_FIXED_QUESTIONS = Object.freeze([
  {n: 1, request: '1-1은 뭐냐?', family: 'F0', answer: '0'},
  {n: 2, request: '쉐딩과 방정식 설명해 봐봐', family: 'F4', note: 'ASR hint "슈뢰딩거 방정식" passed as data'},
  {n: 3, request: '백프로 로직 설명해 봐', family: 'F4'},
  {n: 4, request: '백프로 로직과 다윈 내추럴 셀렉션은 상관 관계가 있을까?', family: 'F4'},
  {n: 5, request: 'QMGR 통합하게 스키마 좀 짜봐', family: 'F6-code', note: 'Claude Code read-only only if QMGR resolves in the workspace'},
  {n: 6, request: '샤넬 같은 부티크 패션 사이트 하나 만들어봐', family: 'F7', note: 'grant workspace_write (new project dir)'},
  {n: 7, request: '오늘 원달러 환율 설명해줘', family: 'F5a'},
  {n: 8, request: '자 이제 네가 얼마나 잘 되는지 보자', family: 'F10'},
  {n: 9, request: '자 이제 네가 얼마나 잘하는지 보자', family: 'F10-ask'},
  {n: 10, request: 'README.md 설명해줘', family: 'F3'},
  {n: 11, request: '파이썬 list와 tuple 차이 설명해봐', family: 'F2'},
  {n: 12, request: '오늘 하루 어땠어? 나는 좀 피곤했어', family: 'F1'},
  {n: 13, request: '1부터 10까지 더하면 얼마야?', family: 'F0', answer: '55'},
  {n: 14, request: '1부터 100까지 더하면 얼마야?', family: 'F0', answer: '5050'},
  {n: 15, request: '1부터 1000000000000까지 더하면 얼마야?', family: 'F0', answer: '500000000000500000000000'},
  {n: 16, request: '슈뢰딩거 방정식 설명해줘', family: 'F4'},
]);
const LOCAL_MODEL = 'local:qwen3.5:9b';
/** How each family binds (DESIGN-6 §3; O1-O3). Capability families take the
 * cheapest cell, by effort-aware cost, qualifying in EVERY listed category
 * (both pools); none -> the cheaper pool reference. */
export const FAMILY_POLICY = Object.freeze({
  F0: {kind: 'calculator', why: 'exact deterministic parser, no model (order 3)'},
  F1: {kind: 'local', why: 'small talk (order 3, owner_decision)'},
  F2: {kind: 'local', why: 'light, local-answerable (order 3)'},
  F3: {kind: 'local', why: 'host reads the file (<=48 KB) -> local (order 3)'},
  'F10-ask': {kind: 'ask_back', why: 'O2: local asks "뭘 볼까요? ① 라우팅 점검(로컬·Codex·Claude 동시 확인) ② 답변 실력 테스트" first'},
  F10: {kind: 'fanout', why: 'routing self-test, one OK/FAIL line per lane (order 5)',
    lanes: [{surface: 'codex', model: 'gpt-6-luna', effort: 'low'}, {surface: 'claude-chat', model: 'claude-haiku-4-5-20251001', effort: 'none'},
      {surface: 'claude', model: 'claude-haiku-4-5-20251001', effort: 'none'}]},
  F5a: {kind: 'owner_decision', surface: 'codex', model: 'gpt-6.1-sol', effort: 'medium',
    why: 'O3/D2: light current facts, web, dated source required; one escalation to astra@ultra'},
  F4: {kind: 'capability', categories: ['knowledge', 'science'], surface: 'chat', min_effort: null,
    why: 'standard explanation; cheapest cell >= reference in knowledge and science (O3/D1 superseded by O1)'},
  'F6-code': {kind: 'capability', categories: ['coding'], surface: 'chat', min_effort: 'high',
    why: 'deep design with a code/schema artifact; DESIGN-6 deep floor effort >= high'},
  F7: {kind: 'capability', categories: ['coding'], surface: 'agent', min_effort: null,
    why: 'workspace build (order 6); the write grant sets the surface, never the model'},
});
const DISPATCH_REFERENCES = Object.freeze({openai_codex: {provider: 'openai', model: 'gpt-6-astra', effort: 'ultra'},
  anthropic_shared: {provider: 'anthropic', model: 'claude-fable-5-1', effort: 'max'}});
const tupleText = (surface, model, effort) => surface + ':' + model + '@' + effort;
const providerOfPool = pool => Object.entries(POOLS).find(([, name]) => name === pool)[0];

/** Whether Config/production.json signs a tuple (claude-chat runs the claude
 * profiles). */
export function signedTuple(production, surface, model, effort) {
  const provider = surface === 'claude-chat' ? 'claude' : surface;
  return Object.values(production?.execution_profiles ?? {}).some(profile => profile.provider === provider &&
    profile.model === model && profile.effort === effort);
}
/** The 446 route of a request in the r446c replay, or null. */
export function route446(replay, request) {
  const row = replay.find(item => item.request === request);
  if (!row) return null;
  return {route: String(row.route).replace(/\/([a-z]+)$/, '@$1'), basis: row.basis ?? null, scope: row.scope ?? null};
}
/** The cost of a dispatchable route text "surface:model@effort" (local and
 * calculator $0). */
function routeCost(all, route) {
  if (route === null) return {usd: null, basis: 'not_recorded'};
  if (/^(?:local|calculator):/.test(route)) return {usd: 0, basis: 'local'};
  const match = route.match(/^[a-z-]+:([^@]+)@([a-z]+)$/);
  if (!match) return {usd: null, basis: 'unparsed'};
  return all.costs.cost(match[1], match[2]);
}

/** The owner fixed-question table from estimateAll() output. */
export function ownerTable(all, {replay = [], production = null} = {}) {
  const rows = [];
  for (const question of OWNER_FIXED_QUESTIONS) {
    const policy = FAMILY_POLICY[question.family];
    const was = route446(replay, question.request);
    let chosen, basis, margin = null, cost, why = policy.why, signed = null, escalation = null; // escalation: F5a only (O3/D2)
    if (policy.kind === 'calculator') {
      chosen = 'local:calculator -> ' + question.answer; basis = 'zero_model'; cost = {usd: 0, basis: 'local'};
    } else if (policy.kind === 'local' || policy.kind === 'ask_back') {
      chosen = LOCAL_MODEL; basis = policy.kind === 'ask_back' ? 'owner_decision:O2' : 'owner_decision:order3';
      cost = {usd: 0, basis: 'local'};
    } else if (policy.kind === 'fanout') {
      const probeTokens = all.costs.probe_output_tokens ?? 0;
      let usd = 0;
      const lanes = [];
      for (const lane of policy.lanes) {
        const price = all.prices.models[priceModel(all.prices, lane.model)];
        const laneUSD = usdOf(price, probeTokens);
        usd += laneUSD;
        lanes.push(tupleText(lane.surface, lane.model, lane.effort));
      }
      chosen = 'fan-out ' + [LOCAL_MODEL, ...lanes].join(' ‖ ') + ' + calculator probe 17+25';
      basis = 'order5:liveness_not_quality';
      cost = {usd: round6(usd), basis: 'typical_input_plus_probe_output', probe_output_tokens: probeTokens};
      signed = policy.lanes.every(lane => signedTuple(production, lane.surface, lane.model, lane.effort));
    } else if (policy.kind === 'owner_decision') {
      chosen = tupleText(policy.surface, policy.model, policy.effort); basis = 'owner_decision:O3-D2 (not delta-0)';
      cost = all.costs.cost(policy.model, policy.effort);
      signed = signedTuple(production, policy.surface, policy.model, policy.effort);
      escalation = 'codex:gpt-6-astra@ultra';
    } else {
      const candidates = [];
      for (const [provider, poolName] of Object.entries(POOLS)) {
        const lists = policy.categories.map(domain => all.categories[domain].pools[poolName].qualifying);
        for (const row of lists[0]) {
          if (policy.min_effort && effortIndex(row.effort) < effortIndex(policy.min_effort)) continue;
          const everywhere = lists.map(list => list.find(other => other.model === row.model && other.effort === row.effort));
          if (everywhere.some(item => !item)) continue;
          const estimated = everywhere.some(item => item.basis === 'estimated');
          const margins = {};
          for (const item of everywhere) for (const [unit, value] of Object.entries(item.margin ?? {}))
            margins[unit] = Math.max(margins[unit] ?? 0, value);
          candidates.push({provider, model: row.model, effort: row.effort, estimated, margins,
            cost: all.costs.cost(row.model, row.effort)});
        }
      }
      candidates.sort((a, b) => ((a.cost.usd ?? Infinity) - (b.cost.usd ?? Infinity)) || byEffort(a.effort, b.effort) ||
        compareText(a.model, b.model));
      if (candidates.length) {
        const best = candidates[0];
        const surface = SURFACES[best.provider][policy.surface];
        chosen = tupleText(surface, best.model, best.effort);
        basis = best.estimated ? 'estimated(' + Object.entries(best.margins).map(([unit, value]) => '±' + round6(value) + ' ' + unit)
          .join(', ') + ') 공식 점수 기반 추정' : 'published';
        margin = best.estimated ? best.margins : null;
        cost = best.cost;
        signed = signedTuple(production, surface, best.model, best.effort);
        why += '; qualifying in ' + policy.categories.join('+') + (policy.min_effort ? ' at effort >= ' + policy.min_effort : '') +
          ': ' + candidates.map(item => item.model + '@' + item.effort + (item.estimated ? '(est)' : '') + ' $' +
          round6(item.cost.usd)).join(', ');
      } else {
        const options = Object.entries(DISPATCH_REFERENCES).map(([pool, ref]) => ({...ref, pool,
          cost: all.costs.cost(ref.model, ref.effort)})).sort((a, b) => (a.cost.usd ?? Infinity) - (b.cost.usd ?? Infinity));
        const ref = options[0];
        const surface = SURFACES[ref.provider][policy.surface];
        chosen = tupleText(surface, ref.model, ref.effort); basis = 'reference (no cell qualifies)'; cost = ref.cost;
        signed = signedTuple(production, surface, ref.model, ref.effort);
      }
    }
    rows.push({n: question.n, request: question.request, family: question.family, chosen, basis, margin,
      expected_cost_usd: cost.usd, cost_basis: cost.basis, cost_detail: cost, escalation, signed, why,
      note: question.note ?? null, route_446: was?.route ?? null, route_446_basis: was?.basis ?? null,
      route_446_scope: was?.scope ?? null, route_446_cost_usd: routeCost(all, was?.route ?? null).usd,
      route_446_cost_basis: routeCost(all, was?.route ?? null).basis});
  }
  const reference = all.costs.cost(DISPATCH_REFERENCES.openai_codex.model, DISPATCH_REFERENCES.openai_codex.effort);
  const total = rows.reduce((sum, row) => sum + (row.expected_cost_usd ?? 0), 0);
  const recorded = rows.filter(row => row.route_446_cost_usd !== null);
  const total446 = recorded.reduce((sum, row) => sum + row.route_446_cost_usd, 0);
  const totalRecorded = recorded.reduce((sum, row) => sum + (row.expected_cost_usd ?? 0), 0);
  return {rows, totals: {questions: rows.length, expected_cost_usd: round6(total),
    all_reference_usd: round6(rows.length * reference.usd), all_reference_tuple: 'codex:gpt-6-astra@ultra',
    all_reference_unit_usd: reference.usd, all_reference_basis: reference.basis,
    ratio_to_all_reference: round6(total / (rows.length * reference.usd)),
    recorded_446: recorded.length, route_446_cost_usd: round6(total446),
    new_cost_on_446_recorded_usd: round6(totalRecorded),
    ratio_446_to_all_reference: round6(total446 / (recorded.length * reference.usd)),
    ratio_new_to_all_reference_on_446_recorded: round6(totalRecorded / (recorded.length * reference.usd))}};
}

// ---- Report files ------------------------------------------------------------------------------

function markdownOwnerTable(table) {
  const money = value => value === null || value === undefined ? '—' : '$' + value.toFixed(4);
  const lines = ['| # | Question | Family | Chosen (surface:model@effort) | Basis | Margin | Effort-aware cost (basis) | 446 route (cost) | Signed |',
    '|---|---|---|---|---|---|---|---|---|'];
  for (const row of table.rows) lines.push('| ' + [row.n, row.request, row.family, '`' + row.chosen + '`', row.basis,
    row.margin ? Object.entries(row.margin).map(([unit, value]) => '±' + value + ' ' + unit).join(', ') : '—',
    money(row.expected_cost_usd) + ' (' + row.cost_basis + ')',
    row.route_446 ? '`' + row.route_446 + '` (' + money(row.route_446_cost_usd) + ')' : 'not in r446c',
    row.signed === null ? '—' : row.signed ? 'yes' : 'NO'].join(' | ') + ' |');
  const t = table.totals;
  lines.push('', `Total, ${t.questions} questions: ${money(t.expected_cost_usd)} effort-aware = ${t.ratio_to_all_reference}× ` +
    `all-reference (${t.questions} × ${t.all_reference_tuple} ${money(t.all_reference_unit_usd)}, ${t.all_reference_basis}).`,
  `On the ${t.recorded_446} questions r446c recorded: new ${money(t.new_cost_on_446_recorded_usd)} ` +
    `(${t.ratio_new_to_all_reference_on_446_recorded}× all-reference) vs build 446 ${money(t.route_446_cost_usd)} ` +
    `(${t.ratio_446_to_all_reference}×), both effort-aware.`);
  return lines.join('\n') + '\n';
}
function writeNew(path, text) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
  try { writeSync(fd, text); } finally { closeSync(fd); }
}
/** The report files' contents (pure): name -> text. */
export function reportFiles(all, {replay = [], production = null, candidateBytes}) {
  const table = ownerTable(all, {replay, production});
  const qualifying = {};
  for (const [domain, category] of Object.entries(all.categories)) {
    qualifying[domain] = {};
    for (const [pool, result] of Object.entries(category.pools))
      qualifying[domain][pool] = {reference: result.reference,
        qualifying: result.qualifying.map(({model, effort, basis, basis_label, margin, expected_cost_usd, cost_basis,
          cheaper_than_reference, benchmarks}) => ({model, effort, basis, basis_label, margin, expected_cost_usd, cost_basis,
          cheaper_than_reference, benchmarks: benchmarks.map(({benchmark, source, score, margin, lower_bound, reference_score,
            reference_effort, delta}) => ({benchmark, source, score, margin, lower_bound, reference_score, reference_effort, delta}))})),
        blocked: result.blocked, rejected: result.rejected};
  }
  const costCells = {};
  const seen = new Set();
  for (const category of Object.values(all.categories)) for (const result of Object.values(category.pools))
    for (const item of [result.reference, ...result.qualifying, ...result.rejected]) seen.add(item.model + '\n' + item.effort);
  for (const ref of Object.values(DISPATCH_REFERENCES)) seen.add(ref.model + '\n' + ref.effort);
  seen.add('gpt-6.1-sol\nmedium'); seen.add('gpt-6-luna\nlow'); seen.add('claude-haiku-4-5-20251001\nnone');
  for (const key of [...seen].sort()) { const [model, effort] = key.split('\n'); costCells[model + '@' + effort] = all.costs.cost(model, effort); }
  const summary = backTestSummary(all.samples);
  // Diagnostic only: the same rule on point estimates (margin 0). Cells it
  // admits and the rule does not show where the back-tested margin binds.
  const pointOnly = {};
  for (const [domain, category] of Object.entries(DOMAINS)) for (const [provider, pool] of Object.entries(POOLS)) {
    const loose = qualifyCategoryEstimated(all.evidence.rows.filter(row => row.provider === provider), {category,
      reference: all.references[provider], references: all.references, curves: all.curves, margins: all.margins,
      cost: all.costs.cost, marginScale: 0});
    const strict = all.categories[domain].pools[pool];
    const extra = loose.qualifying.filter(row => !strict.qualifying.some(other => other.model === row.model &&
      other.effort === row.effort)).map(row => ({model: row.model, effort: row.effort, expected_cost_usd: row.expected_cost_usd,
      rule_reason: strict.rejected.find(other => other.model === row.model && other.effort === row.effort)?.reason ?? null,
      estimated: row.benchmarks.filter(entry => entry.source === 'estimated').map(entry => ({benchmark: entry.benchmark,
        estimate: entry.score, reference_score: entry.reference_score,
        margin: strict.rejected.some(other => other.model === row.model && other.effort === row.effort) ?
          marginFor(all.margins, {unit_class: entry.unit_class, distance: entry.distance, mode: entry.mode}) : null,
        distance: entry.distance, mode: entry.mode}))}));
    if (extra.length) (pointOnly[domain] ??= {})[pool] = extra;
  }
  const files = {
    'point-estimate-diagnostic.json': canonical({note: 'diagnostic only, not a verdict: the O1 rule with margin 0', cells: pointOnly}),
    'backtest.json': canonical({multi_effort_curves: all.multiCurves, combination: COMBINATION, summary, samples: all.samples}),
    'margins.json': canonical({rule: MARGIN_RULE, margins: all.margins}),
    'qualifying-cells.json': canonical({policy: ESTIMATE_POLICY, broad: all.broad, categories: qualifying}),
    'costs.json': canonical({bases: COST_BASES, ledger_min_n: LEDGER_MIN_N, probe_rule: 'output_tokens < ' + PROBE_OUTPUT_TOKENS_BELOW,
      probe_output_tokens_median: all.costs.probe_output_tokens, probe_rows: all.costs.probe_rows,
      multipliers: all.costs.multipliers, snapshot: {taken_on: all.snapshot.taken_on, source_sha256: all.snapshot.source_sha256,
        source_records: all.snapshot.source_records, observations: all.snapshot.observations}, cells: costCells}),
    'owner-table.json': canonical(table),
    'owner-table.md': markdownOwnerTable(table),
    'inputs.json': canonical({evidence_sha256: all.shas.evidence, price_table_sha256: all.shas.prices,
      ledger_snapshot_sha256: all.shas.snapshot, candidate_sha256: candidateBytes ? sha256(candidateBytes) : null}),
  };
  return {files, table, summary};
}

// ---- CLI -----------------------------------------------------------------------------------------

const OPTIONS = ['--evidence', '--prices', '--ledger-snapshot', '--out', '--table', '--ledger', '--on', '--r446c',
  '--production', '--out-dir'];
function argumentsOf(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index], value = rest[index + 1];
    if (!OPTIONS.includes(key) || typeof value !== 'string') throw new Error('usage: see the header of effort-curve-estimator.mjs');
    options[key.slice(2)] = value;
  }
  return {command, options};
}
export function main(argv = process.argv.slice(2)) {
  const {command, options} = argumentsOf(argv);
  if (command === 'snapshot') {
    if (!options.ledger || !/^\d{4}-\d{2}-\d{2}$/.test(options.on ?? '')) throw new Error('snapshot needs --ledger <file> --on <YYYY-MM-DD>');
    const bytes = readFileSync(options.ledger);
    const text = canonical(ledgerSnapshot(bytes.toString('utf8'), {sourceSha256: sha256(bytes), on: options.on}));
    if (options.out) writeNew(options.out, text); else process.stdout.write(text);
    return 0;
  }
  if (!['compile', 'check', 'report'].includes(command) || !options.evidence || !options.prices || !options['ledger-snapshot'])
    throw new Error('usage: compile|check|report --evidence <file> --prices <file> --ledger-snapshot <file> …');
  const inputs = [readFileSync(options.evidence), readFileSync(options.prices), readFileSync(options['ledger-snapshot'])];
  const bytes = canonical(compileEstimatedTable(...inputs));
  if (command === 'check') {
    if (!options.table) throw new Error('check needs --table <file>');
    const same = readFileSync(options.table).toString('utf8') === bytes;
    process.stdout.write(same ? 'estimate candidate: file = script output\n' : 'estimate candidate: DIFFERS from the script output\n');
    return same ? 0 : 1;
  }
  if (command === 'compile') {
    if (options.out) writeNew(options.out, bytes); else process.stdout.write(bytes);
    return 0;
  }
  if (!options['out-dir'] || !options.r446c || !options.production) throw new Error('report needs --r446c, --production and --out-dir');
  const all = estimateAll(...inputs);
  const replay = JSON.parse(readFileSync(options.r446c).toString('utf8'));
  const production = JSON.parse(readFileSync(options.production).toString('utf8'));
  mkdirSync(options['out-dir'], {recursive: true});
  if (readdirSync(options['out-dir']).length) throw new Error('report --out-dir must be new or empty');
  const {files} = reportFiles(all, {replay, production, candidateBytes: Buffer.from(bytes)});
  for (const [name, text] of Object.entries(files)) writeNew(join(options['out-dir'], name), text);
  process.stdout.write('report: ' + Object.keys(files).length + ' files in ' + options['out-dir'] + '\n');
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(String(error.message ?? error) + '\n'); process.exitCode = 64; }
}
