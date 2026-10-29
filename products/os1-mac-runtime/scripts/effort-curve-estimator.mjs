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
 *   node scripts/effort-curve-estimator.mjs compile --evidence <file> --siblings <file> --prices <file> --ledger-snapshot <file> [--out <new file>]
 *   node scripts/effort-curve-estimator.mjs check   --evidence <file> --siblings <file> --prices <file> --ledger-snapshot <file> --table <file>
 *   node scripts/effort-curve-estimator.mjs report  --evidence <file> --siblings <file> --prices <file> --ledger-snapshot <file>
 *        --r446c <file> --production <file> --shipped <file> --out-dir <new or empty directory>
 *
 * 1. CURVES. A curve is one (provider, model, benchmark): its CONFIRMED scores
 *    at dispatchable efforts (low … max, ultra). A lower-is-better metric is
 *    stored as goodness = -score, so every delta below reads "higher is
 *    better". Unit classes are never mixed: % and "score" (0-100) are
 *    `points`; Elo is `elo`; voxel IoU is `fraction`; accepted findings are
 *    `count`; a lower-is-better curve gets its own class (`points_lower_better`).
 *    Each curve belongs to a SIBLING GROUP (capability-evidence-siblings-*.json,
 *    declared next to the evidence): scorings, splits or versions of one vendor
 *    run. A curve's CLUSTER is (provider, model, sibling group).
 * 2. ESTIMATOR. A missing (model, effort) score on a benchmark where the model
 *    has a curve = the nearest published point of that curve (the ANCHOR) plus
 *    an effort delta (anchor effort -> target effort). Three component deltas,
 *    each from confirmed curves of the same unit class only:
 *     (i)   reference: the pool reference model's own delta on the SAME
 *           benchmark (both efforts published there);
 *     (ii)  model: the median delta of the SAME model over its OTHER curves;
 *     (iii) family: the median delta over every other curve of the same
 *           provider (effort names differ across vendors: never cross-provider).
 *    Combination (pre-registered, not tuned on the back-test): the median of
 *    the components that exist. Two equally near anchors (one below, one
 *    above): the mean of both anchor estimates (`interpolation`); one anchor:
 *    `extrapolation`, DOWN (anchor above the target) or UP. A % or "score"
 *    estimate is clamped to 0-100. No component -> no estimate. `ultra`
 *    (Codex-only, one benchmark) is published-only.
 * 3. BACK-TEST (missing-at-random is NOT assumed: two scenarios, both hiding a
 *    point on every sibling curve of the same model):
 *     neighbourhood: for every published point t of every multi-point curve and
 *       every distance d = 1..4, hide every point of the curve within d-1 of t
 *       (d = 1 is leave-one-out) and estimate t; the sample counts at d only if
 *       the nearest remaining anchor is at distance d;
 *     top_only: keep only the curve's highest published effort (the real
 *       "vendor publishes max only" case) and estimate every lower point.
 *    Errors are estimate minus actual in goodness units. One sample per
 *    (curve, hidden point, hidden set): a top_only sample that repeats a
 *    neighbourhood one is counted once, under both scenario names.
 *    MARGIN (the stated rule) for an estimate of unit class u at distance d and
 *    kind k, where k is the estimate's situation: down_from_top (one anchor,
 *    above the target, and the top published effort of the curve: the "max
 *    only" case), down (an anchor above with higher published efforts beyond
 *    it), up, or interpolation. The cell (u, d, k) pools both scenarios. Its
 *    statistic is the nearest-rank 95th percentile of absolute errors, and its
 *    UPPER BOUND is the nearest-rank 95th percentile of that statistic over
 *    2,000 cluster-bootstrap resamples (clusters drawn with replacement; seeded,
 *    deterministic). The margin is that bound made non-decreasing in d within k.
 *    A cell with fewer than 10 clusters is NOT ADOPTABLE: it has no margin.
 *    Situations are never pooled: low-effort collapses widen `down`, not the
 *    max-only margin, and up-direction errors never narrow a down margin.
 *    Because |error| >= signed error, the bound is never below the upper
 *    quantile of the signed error, which carries the downward over-estimation
 *    bias.
 * 4. ADOPTION. Per pool and category, against the pool reference's best
 *    confirmed score at any effort (DESIGN-4 §7, capability-table.mjs
 *    referenceBar), a (model, effort) qualifies only if on EVERY shared
 *    benchmark its published score >= the bar, or (estimate - margin) >= the
 *    bar. Blockers A and B of capability-table.mjs still apply. Every failing
 *    benchmark is recorded. Basis `published` when every shared score was
 *    published at that effort, else `estimated` ("공식 점수 기반 추정"). The
 *    pool's DISPATCH reference (openai: gpt-6-astra@ultra; anthropic:
 *    claude-fable-5-1@max) is never a candidate, and another effort of the
 *    reference MODEL qualifies only if it is resolved cheaper than the
 *    dispatch reference on the common cost basis (5b).
 * 5. COST. All prices are the list price table; a typical request is
 *    capability-table.mjs TYPICAL_CALL input (10k uncached + 20k cached,
 *    effort-blind) plus an effort-aware OUTPUT size; effort and model ratios
 *    scale the OUTPUT side only:
 *     a. ledger_observed (the point when it exists): the (surface, model,
 *        effort) ledger stratum with the most observations, n >= 3 after
 *        probe replies (< 20 output tokens) are removed; its median output.
 *        The stratum's median full request cost with its observed input,
 *        cache-read and cache-write tokens is reported beside it. Strata are
 *        never pooled across surfaces; the ledger's routing `family` field is
 *        outside this tool's read scope, so a stratum still mixes task
 *        families and observed costs are never compared across strata;
 *     b. first_party_per_task_ratio (the COMMON basis, computed for every cell
 *        and the only basis orderings use): every observed stratum (n >= 3) of
 *        the same provider is an anchor; the cell's price = typical input +
 *        the anchor's median output USD x the median first-party per-task cost
 *        ratio (cell : anchor's model and effort; same benchmark, same cost
 *        unit, both confirmed; 1 for the cell's own stratum). The point is the
 *        n-weighted mean over anchors; the RANGE spans every anchor at the
 *        smallest and largest single-benchmark ratio. Two cells are ordered
 *        only when they share a provider and their ranges do not overlap;
 *        otherwise the order is UNRESOLVED. Different providers share no
 *        anchor: always unresolved;
 *     c. price_table_effort_multiplier: typical input plus 1,500 output tokens
 *        x a ledger effort multiplier (median over observed strata of median
 *        output / 1,500 at that effort, log-linear between efforts). It mixes
 *        workloads (ultra lands below medium); no range, so never ordered.
 *    Local and calculator routes cost $0.
 * 6. OWNER TABLE (capability families). Candidates: every cell qualifying in
 *    each listed category (either pool) plus both dispatch references (each
 *    meets its own pool's bar at delta 0). The DEFAULT is the all-reference
 *    tuple codex:gpt-6-astra@ultra, the denominator of the quota objective. A
 *    candidate replaces it only when resolved cheaper (5b); a qualifying cell
 *    whose order is unresolved is listed as an owner decision, never bound
 *    silently.
 *
 * Never a quality claim about one answer: the providers' own benchmarks, and
 * for an estimated cell an inductive estimate with a back-tested margin. */
import {createHash} from 'node:crypto';
import {closeSync, constants, mkdirSync, openSync, readFileSync, readdirSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BROAD_CATEGORIES, COST_UNIT_OVERRIDES, DOMAINS, EFFORTS, POLICY, POOLS, REFERENCE_BAR, TOLERANCE, TYPICAL_CALL,
  canonical, effortOf, referenceBar, referenceRow} from './capability-table.mjs';

export const ESTIMATE_POLICY = 'capability_delta0_effort_curve_v2';
/** Efforts an estimate may target (ultra is published-only). */
export const TARGET_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
export const UNIT_CLASSES = Object.freeze({'%': 'points', score: 'points', Elo: 'elo', 'voxel IoU': 'fraction',
  findings: 'count'});
/** Units on a 0-100 scale: estimates are clamped to it. */
export const BOUNDED_UNITS = Object.freeze(['%', 'score']);
export const COMBINATION = 'median_of_available_components';
export const COMPONENTS = Object.freeze(['reference', 'model', 'family']);
export const SCENARIOS = Object.freeze(['neighbourhood', 'top_only']);
/** Estimate situations: DOWN from the curve's top published effort (the real
 * "vendor publishes max only" case), other DOWN, UP, two-anchor interpolation. */
export const KINDS = Object.freeze(['down_from_top', 'down', 'up', 'interpolation']);
export const MIN_CLUSTERS = 10;
export const BOOTSTRAP = Object.freeze({resamples: 2000, seed: 'os1-design6-o1-margin-v2', statistic_percentile: 95,
  upper_bound_percentile: 95, interval: [5, 95]});
export const MARGIN_RULE = Object.freeze({statistic: 'nearest_rank_p95_abs_error', upper_bound: 'cluster_bootstrap_p95',
  cluster: 'provider|model|sibling_group', bootstrap: BOOTSTRAP, cell: 'unit_class x distance x kind, both scenarios pooled, ' +
  'identical hidden sets counted once', kinds: [...KINDS], distance: 'non_decreasing_within_kind', min_clusters: MIN_CLUSTERS,
  below_min_clusters: 'not_adoptable', scenarios: [...SCENARIOS], siblings: 'hidden_with_the_point'});
export const LEDGER_MIN_N = 3;
export const PROBE_OUTPUT_TOKENS_BELOW = 20;
export const COST_BASES = Object.freeze(['ledger_observed', 'first_party_per_task_ratio',
  'price_table_effort_multiplier']);
/** Surfaces a model of each provider answers on (DESIGN-6 §5 surface rule). */
export const SURFACES = Object.freeze({anthropic: {chat: 'claude-chat', agent: 'claude'},
  openai: {chat: 'codex', agent: 'codex'}});
/** The tuple each pool actually dispatches as its reference. */
export const DISPATCH_REFERENCES = Object.freeze({
  openai: Object.freeze({pool: 'openai_codex', provider: 'openai', model: 'gpt-6-astra', effort: 'ultra'}),
  anthropic: Object.freeze({pool: 'anthropic_shared', provider: 'anthropic', model: 'claude-fable-5-1', effort: 'max'})});
/** The all-reference tuple: the default of every capability row (rule 6). */
export const OWNER_DEFAULT_PROVIDER = 'openai';
const EPSILON = 1e-9;

export const unitClass = (unit, lowerBetter = false) => (UNIT_CLASSES[unit] ?? 'other:' + unit) +
  (lowerBetter ? '_lower_better' : '');
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

/** benchmark -> group id per provider, from the sibling document (validated
 * against the evidence rows: every listed benchmark exists, none twice). */
export function siblingIndex(siblings, rows) {
  if (siblings === null || siblings === undefined) return new Map();
  if (siblings?.schema !== 1 || siblings.kind !== 'capability_evidence_sibling_groups' || !Array.isArray(siblings.groups))
    throw new Error('sibling_map_invalid');
  const index = new Map();
  for (const group of siblings.groups) {
    if (typeof group.id !== 'string' || typeof group.provider !== 'string' || !Array.isArray(group.benchmarks) ||
        group.benchmarks.length < 2) throw new Error('sibling_map_invalid');
    for (const benchmark of group.benchmarks) {
      const key = group.provider + '\n' + benchmark;
      if (index.has(key)) throw new Error('sibling_map_duplicate:' + benchmark);
      if (!rows.some(row => row.provider === group.provider && row.benchmark === benchmark))
        throw new Error('sibling_map_unknown_benchmark:' + benchmark);
      index.set(key, group.id);
    }
  }
  return index;
}

/** The curves of the evidence rows: Map key -> {provider, model, benchmark,
 * category, unit, unit_class, lower_better, bounded, group, cluster,
 * points: {effort: goodness}}. Confirmed rows at a dispatchable effort only;
 * two confirmed values for one point: the worse one stands. */
export function buildCurves(rows, siblings = null) {
  const groups = siblingIndex(siblings, rows);
  const curves = new Map();
  for (const row of rows) {
    if (row.status !== 'confirmed') continue;
    const effort = effortOf(row.reasoning_level);
    if (effort === null || !Number.isFinite(row.score)) continue;
    const key = curveKey(row.provider, row.model, row.benchmark);
    let curve = curves.get(key);
    const lowerBetter = row.lower_better === true;
    if (!curve) {
      const group = groups.get(row.provider + '\n' + row.benchmark) ?? row.benchmark;
      curve = {key, provider: row.provider, model: row.model, benchmark: row.benchmark, category: row.category,
        unit: row.unit, unit_class: unitClass(row.unit, lowerBetter), lower_better: lowerBetter,
        bounded: BOUNDED_UNITS.includes(row.unit), group, cluster: [row.provider, row.model, group].join('|'), points: {}};
      curves.set(key, curve);
    } else if (curve.category !== row.category || curve.unit !== row.unit || curve.lower_better !== lowerBetter)
      throw new Error('effort_curve_inconsistent:' + key.replaceAll('\n', '|'));
    const value = lowerBetter ? -row.score : row.score;
    curve.points[effort] = effort in curve.points ? Math.min(curve.points[effort], value) : value;
  }
  return curves;
}
/** The same curves with `efforts` hidden on curve `key` AND on every curve of
 * its cluster (its siblings: same provider, model and sibling group). */
export function hideEfforts(curves, key, efforts) {
  const curve = curves.get(key);
  if (!curve) throw new Error('effort_curve_hide_missing');
  const copy = new Map(curves);
  for (const other of curves.values()) {
    if (other.cluster !== curve.cluster) continue;
    if (!efforts.some(effort => effort in other.points)) continue;
    const points = {...other.points};
    for (const effort of efforts) delete points[effort];
    copy.set(other.key, {...other, points});
  }
  return copy;
}
/** One point hidden (with its siblings at that effort). */
export function hidePoint(curves, key, effort) {
  if (!(effort in (curves.get(key)?.points ?? {}))) throw new Error('effort_curve_hide_missing');
  return hideEfforts(curves, key, [effort]);
}
const toScore = (curve, goodness) => curve.lower_better ? -goodness : goodness;
function clampGoodness(curve, goodness) {
  if (!curve.bounded) return goodness;
  return curve.lower_better ? Math.min(0, Math.max(-100, goodness)) : Math.min(100, Math.max(0, goodness));
}

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
 * kind, anchors: [{anchor, anchor_goodness, components, counts, delta,
 * estimate, clamped}], goodness, score}. `references`: {provider: model}. */
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
    const raw = delta === null ? null : curve.points[anchor] + delta;
    const estimate = raw === null ? null : clampGoodness(curve, raw);
    return {anchor, anchor_goodness: curve.points[anchor], components,
      counts: {reference: referenceDelta === null ? 0 : 1, model: own.length, family: family.length}, delta, estimate,
      clamped: raw !== null && Math.abs(raw - estimate) > EPSILON};
  });
  const usable = results.filter(result => result.estimate !== null);
  const goodness = usable.length ? usable.reduce((sum, result) => sum + result.estimate, 0) / usable.length : null;
  const mode = usable.length === 2 ? 'interpolation' : 'extrapolation';
  const side = (usable[0] ?? results[0]).anchor;
  const top = Object.keys(curve.points).sort(byEffort).at(-1);
  const kind = mode === 'interpolation' ? 'interpolation' : effortIndex(side) < effortIndex(effort) ? 'up' :
    side === top ? 'down_from_top' : 'down';
  return {estimable: goodness !== null, distance, mode, kind, unit_class: curve.unit_class, anchors: results, goodness,
    score: goodness === null ? null : toScore(curve, goodness)};
}

// ---- 3. Back-test and margins -------------------------------------------------------

function sampleOf(curves, data, curve, effort, references, scenario, hidden) {
  const base = {scenario, provider: curve.provider, model: curve.model, benchmark: curve.benchmark, group: curve.group,
    cluster: curve.cluster, category: curve.category, unit_class: curve.unit_class, lower_is_better: curve.lower_better,
    effort, actual: toScore(curve, curve.points[effort]), hidden};
  const estimate = estimatePoint(data, {key: curve.key, effort, references});
  if (!estimate?.estimable) return {...base, estimable: false, reason: 'no_component', distance: estimate?.distance ?? null,
    kind: estimate?.kind ?? null};
  const error = estimate.goodness - curve.points[effort];
  // Each component alone (diagnostic only): its anchors' mean estimate.
  const alone = {};
  for (const name of COMPONENTS) {
    const values = estimate.anchors.filter(anchor => anchor.components[name] !== null)
      .map(anchor => clampGoodness(curve, anchor.anchor_goodness + anchor.components[name]));
    alone[name] = values.length === estimate.anchors.length && values.length ?
      round6(values.reduce((sum, value) => sum + value, 0) / values.length - curve.points[effort]) : null;
  }
  return {...base, estimable: true, distance: estimate.distance, mode: estimate.mode, kind: estimate.kind,
    anchors: estimate.anchors.map(anchor => anchor.anchor), estimate: round6(estimate.score),
    clamped: estimate.anchors.some(anchor => anchor.clamped), signed_error: round6(error), abs_error: round6(Math.abs(error)),
    component_errors: alone, components_used: estimate.anchors.map(anchor => COMPONENTS.filter(name => anchor.components[name] !== null))};
}

/** Both back-test scenarios (header, rule 3) over every curve with >= 2 points. */
export function backTest(curves, references) {
  const samples = [], seen = new Map();
  // One sample per (curve, hidden point, hidden set): a top_only sample that
  // repeats a neighbourhood one is counted once, with both scenario names.
  const add = sample => {
    const key = [sample.provider, sample.model, sample.benchmark, sample.effort, sample.hidden.join(',')].join('\n');
    if (seen.has(key)) { seen.get(key).scenarios.push(sample.scenario); return; }
    sample.scenarios = [sample.scenario];
    seen.set(key, sample);
    samples.push(sample);
  };
  const ordered = [...curves.values()].sort((a, b) => compareText(a.key, b.key));
  for (const curve of ordered) {
    const efforts = Object.keys(curve.points).sort(byEffort);
    if (efforts.length < 2) continue;
    for (const effort of efforts) {
      if (!TARGET_EFFORTS.includes(effort)) {
        add({scenario: 'neighbourhood', provider: curve.provider, model: curve.model, benchmark: curve.benchmark,
          group: curve.group, cluster: curve.cluster, category: curve.category, unit_class: curve.unit_class,
          lower_is_better: curve.lower_better, effort, actual: toScore(curve, curve.points[effort]), hidden: [effort],
          estimable: false, reason: 'published_only_effort'});
        continue;
      }
      for (let distance = 1; distance < TARGET_EFFORTS.length; distance++) {
        const hidden = efforts.filter(other => Math.abs(effortIndex(other) - effortIndex(effort)) <= distance - 1);
        if (hidden.length === efforts.length) break;
        const data = hideEfforts(curves, curve.key, hidden);
        const sample = sampleOf(curves, data, curve, effort, references, 'neighbourhood', hidden);
        if (sample.distance !== distance) continue; // counted at its own distance
        add(sample);
      }
    }
    const targets = efforts.filter(effort => TARGET_EFFORTS.includes(effort));
    if (targets.length < 2) continue;
    const top = targets.at(-1);
    const hidden = efforts.filter(effort => effort !== top);
    const data = hideEfforts(curves, curve.key, hidden);
    for (const effort of targets.slice(0, -1)) add(sampleOf(curves, data, curve, effort, references, 'top_only', hidden));
  }
  return samples;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash;
}
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
/** One cell's statistics: points, clusters, the p95 |error|, its cluster-
 * bootstrap upper bound and 90% interval, and the signed-error bias. */
export function cellStats(samples, cellKey) {
  const n = samples.length;
  if (!n) return {n_points: 0, n_clusters: 0, p95_abs: null, ucb95: null};
  const errors = samples.map(sample => sample.signed_error);
  const absolute = errors.map(Math.abs);
  const byCluster = new Map();
  for (const sample of samples) {
    if (!byCluster.has(sample.cluster)) byCluster.set(sample.cluster, []);
    byCluster.get(sample.cluster).push(Math.abs(sample.signed_error));
  }
  const ids = [...byCluster.keys()].sort();
  const random = mulberry32(fnv1a(BOOTSTRAP.seed + '|' + cellKey));
  const values = [];
  for (let resample = 0; resample < BOOTSTRAP.resamples; resample++) {
    const drawn = [];
    for (let index = 0; index < ids.length; index++) drawn.push(...byCluster.get(ids[Math.floor(random() * ids.length)]));
    values.push(nearestRank(drawn, BOOTSTRAP.statistic_percentile));
  }
  return {n_points: n, n_clusters: ids.length, p95_abs: round6(nearestRank(absolute, BOOTSTRAP.statistic_percentile)),
    max_abs: round6(Math.max(...absolute)), mean_abs: round6(absolute.reduce((s, v) => s + v, 0) / n),
    mean_signed: round6(errors.reduce((s, v) => s + v, 0) / n), p95_signed: round6(nearestRank(errors, 95)),
    over_estimates: errors.filter(value => value > EPSILON).length,
    ucb95: round6(nearestRank(values, BOOTSTRAP.upper_bound_percentile)),
    ci90: [round6(nearestRank(values, BOOTSTRAP.interval[0])), round6(nearestRank(values, BOOTSTRAP.interval[1]))]};
}
/** Margins by unit class, distance and kind (see the header, rule 3). */
export function marginsFrom(samples) {
  const margins = {};
  const estimable = samples.filter(sample => sample.estimable);
  for (const unit of [...new Set(estimable.map(sample => sample.unit_class))].sort()) {
    const own = estimable.filter(sample => sample.unit_class === unit);
    const table = {};
    const running = Object.fromEntries(KINDS.map(kind => [kind, null]));
    for (let distance = 1; distance < TARGET_EFFORTS.length; distance++) {
      const at = own.filter(sample => sample.distance === distance);
      const cell = name => [unit, distance, name].join('|');
      // `all` and the scenario cells are reported only; margins use the kind cells.
      const row = {all: cellStats(at, cell('all'))};
      for (const scenario of SCENARIOS) row['scenario_' + scenario] = cellStats(at.filter(sample =>
        sample.scenarios.includes(scenario)), cell('scenario_' + scenario));
      for (const kind of KINDS) row[kind] = cellStats(at.filter(sample => sample.kind === kind), cell(kind));
      row.margin = {};
      for (const kind of KINDS) {
        if (row[kind].ucb95 !== null) running[kind] = Math.max(running[kind] ?? 0, row[kind].ucb95);
        row.margin[kind] = row[kind].n_clusters >= MIN_CLUSTERS && running[kind] !== null ? round6(running[kind]) : null;
      }
      table[distance] = row;
    }
    margins[unit] = table;
  }
  return margins;
}
/** The margin an estimate carries, or null (not adoptable). */
export function marginFor(margins, estimate) {
  return margins?.[estimate.unit_class]?.[estimate.distance]?.margin?.[estimate.kind] ?? null;
}

/** The O1 estimator against the scores it never uses: every single-source or
 * disputed row at a target effort the model does not publish confirmed on that
 * benchmark, estimated from the confirmed curves. */
export function externalCheck(rows, curves, references, margins) {
  const checks = [];
  for (const row of rows) {
    if (row.status === 'confirmed' || !Number.isFinite(row.score)) continue;
    const effort = effortOf(row.reasoning_level);
    if (!TARGET_EFFORTS.includes(effort)) continue;
    const key = curveKey(row.provider, row.model, row.benchmark);
    const curve = curves.get(key);
    if (!curve || effort in curve.points) continue;
    const estimate = estimatePoint(curves, {key, effort, references});
    if (!estimate?.estimable) continue;
    const reported = curve.lower_better ? -row.score : row.score;
    const margin = marginFor(margins, estimate);
    const error = estimate.goodness - reported;
    checks.push({provider: row.provider, model: row.model, benchmark: row.benchmark, effort, status: row.status,
      unit_class: curve.unit_class, reported: row.score, estimate: round6(estimate.score), signed_error: round6(error),
      distance: estimate.distance, kind: estimate.kind, margin, within_margin: margin === null ? null : Math.abs(error) <= margin + EPSILON});
  }
  checks.sort((a, b) => compareText(a.provider + a.model + a.benchmark, b.provider + b.model + b.benchmark) || byEffort(a.effort, b.effort));
  const points = checks.filter(check => check.unit_class === 'points');
  const signed = points.map(check => check.signed_error);
  return {checks, summary: {points: points.length, mean_signed: signed.length ? round6(signed.reduce((s, v) => s + v, 0) /
    signed.length) : null, over_estimates: signed.filter(value => value > EPSILON).length,
  max_abs: signed.length ? round6(Math.max(...signed.map(Math.abs))) : null,
  outside_margin: points.filter(check => check.within_margin === false).length,
  without_margin: points.filter(check => check.margin === null).length}};
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
const typicalInputUSD = price => (TYPICAL_CALL.uncached_input * price.input + TYPICAL_CALL.cached_input *
  price.cached_input) / 1_000_000;
const outputUSD = (price, tokens) => tokens * price.output / 1_000_000;
/** The USD of one observed request: the ledger's input_tokens include its
 * cache-read and cache-write tokens. */
export const observedRequestUSD = (price, [input, read, write, output]) => (Math.max(0, input - read - write) * price.input +
  read * price.cached_input + write * (price.cache_write ?? price.input) + output * price.output) / 1_000_000;

export const SNAPSHOT_TOKEN_LAYOUT = Object.freeze(['input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens']);
/** The routing-ledger usage snapshot: reads ONLY surface, model, effort and
 * usage.{input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
 * provider_calls} of each JSONL record (never the request, task, family or
 * any other field). */
export function ledgerSnapshot(text, {sourceSha256, on}) {
  const cells = new Map();
  let records = 0, observations = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    records++;
    const record = JSON.parse(line);
    const surface = record.surface, model = record.model, effort = record.effort, usage = record.usage;
    const tokens = SNAPSHOT_TOKEN_LAYOUT.map(name => usage?.[name]);
    if (typeof surface !== 'string' || typeof model !== 'string' || typeof effort !== 'string' ||
        tokens.some(value => !Number.isInteger(value) || value < 0) || !(usage?.provider_calls >= 1)) continue;
    observations++;
    const key = surface + '\n' + model + '\n' + effort;
    if (!cells.has(key)) cells.set(key, {surface, model, effort, observations: []});
    cells.get(key).observations.push(tokens);
  }
  const order = (a, b) => a[3] - b[3] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  return {schema: 2, kind: 'routing_ledger_usage_snapshot', taken_on: on, source_sha256: sourceSha256,
    source_records: records, observations, fields_read: ['surface', 'model', 'effort', ...SNAPSHOT_TOKEN_LAYOUT
      .map(name => 'usage.' + name), 'usage.provider_calls'], token_layout: [...SNAPSHOT_TOKEN_LAYOUT],
    cells: [...cells.values()].map(cell => ({...cell, observations: cell.observations.sort(order)}))
      .sort((a, b) => compareText(a.surface + a.model + a.effort, b.surface + b.model + b.effort))};
}

/** The cost model over the evidence, prices and ledger snapshot (rule 5).
 * Returns {cost(model, effort), compare(a, b), strata, observed, multipliers,
 * probe_output_tokens, ratioBetween}. */
export function costModel({evidence, prices, snapshot}) {
  if (snapshot?.schema !== 2 || snapshot.kind !== 'routing_ledger_usage_snapshot' || !Array.isArray(snapshot.cells))
    throw new Error('ledger_snapshot_invalid');
  // a. Strata: (surface, price model, effort); probes out.
  const byStratum = new Map(), probes = [];
  for (const cell of snapshot.cells) {
    const model = priceModel(prices, cell.model);
    if (model === null || cell.surface === 'local') continue;
    const price = prices.models[model];
    const key = cell.surface + '\n' + model + '\n' + cell.effort;
    if (!byStratum.has(key)) byStratum.set(key, {surface: cell.surface, model, effort: cell.effort, provider: price.provider,
      outputs: [], requests: [], excluded_probe: 0});
    const stratum = byStratum.get(key);
    for (const tokens of cell.observations) {
      if (tokens[3] < PROBE_OUTPUT_TOKENS_BELOW) { stratum.excluded_probe++; probes.push(tokens[3]); continue; }
      stratum.outputs.push(tokens[3]);
      stratum.requests.push(observedRequestUSD(price, tokens));
    }
  }
  const strata = [...byStratum.values()].map(({outputs, requests, ...stratum}) => {
    const price = prices.models[stratum.model];
    const output = median(outputs);
    return {...stratum, n: outputs.length, median_output_tokens: output,
      output_usd: output === null ? null : outputUSD(price, output), median_request_usd: median(requests)};
  }).sort((a, b) => compareText(a.surface + a.model + a.effort, b.surface + b.model + b.effort));
  const observed = strata.filter(stratum => stratum.n >= LEDGER_MIN_N);
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
    return ratios.length ? {ratio: median(ratios), min: Math.min(...ratios), max: Math.max(...ratios), n: ratios.length,
      benchmarks: benchmarks.sort()} : null;
  };
  // c. Ledger-derived effort output multipliers (observed strata, effort named).
  const known = {};
  for (const effort of EFFORTS) {
    const at = observed.filter(stratum => stratum.effort === effort);
    if (at.length) known[effort] = median(at.map(stratum => stratum.median_output_tokens / TYPICAL_CALL.output));
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
    if (priced === null) return {usd: null, basis: 'unpriced', common: null};
    const key = priced + '\n' + effort;
    if (cache.has(key)) return cache.get(key);
    const price = prices.models[priced];
    const input = typicalInputUSD(price);
    const own = strata.filter(stratum => stratum.model === priced && stratum.effort === effort);
    const ownStrata = own.map(stratum => ({surface: stratum.surface, n: stratum.n, excluded_probe: stratum.excluded_probe,
      median_output_tokens: stratum.median_output_tokens, median_request_usd: round6(stratum.median_request_usd)}));
    // The common basis (5b): every observed stratum of the provider with a ratio.
    const anchors = [];
    for (const stratum of observed) {
      if (stratum.provider !== price.provider) continue;
      const self = stratum.model === priced && stratum.effort === effort;
      const shared = self ? {ratio: 1, min: 1, max: 1, n: 0, benchmarks: []} : ratioBetween(key, stratum.model + '\n' + stratum.effort);
      if (shared === null) continue;
      anchors.push({anchor: stratum.surface + ':' + stratum.model + '@' + stratum.effort, n: stratum.n,
        anchor_output_usd: round6(stratum.output_usd), ratio: round6(shared.ratio), ratio_min: round6(shared.min),
        ratio_max: round6(shared.max), ratio_benchmarks: shared.benchmarks, usd: input + stratum.output_usd * shared.ratio,
        low: input + stratum.output_usd * shared.min, high: input + stratum.output_usd * shared.max});
    }
    const weight = anchors.reduce((sum, anchor) => sum + anchor.n, 0);
    const common = anchors.length ? {usd: round6(anchors.reduce((sum, anchor) => sum + anchor.n * anchor.usd, 0) / weight),
      range: [round6(Math.min(...anchors.map(anchor => anchor.low))), round6(Math.max(...anchors.map(anchor => anchor.high)))],
      anchors: anchors.map(({usd, low, high, ...anchor}) => ({...anchor, usd: round6(usd), low: round6(low), high: round6(high)}))} : null;
    const best = own.filter(stratum => stratum.n >= LEDGER_MIN_N).sort((a, b) => (b.n - a.n) || compareText(a.surface, b.surface))[0];
    let result;
    if (best) result = {usd: round6(input + best.output_usd), basis: 'ledger_observed', stratum: best.surface, n: best.n,
      median_output_tokens: best.median_output_tokens, observed_request_usd: round6(best.median_request_usd)};
    else if (common) result = {usd: common.usd, basis: 'first_party_per_task_ratio', anchors_used: anchors.length};
    else {
      const multiplier = multipliers[effort]?.value ?? 1;
      result = {usd: round6(input + outputUSD(price, TYPICAL_CALL.output * multiplier)), basis: 'price_table_effort_multiplier',
        multiplier};
    }
    result = {...result, provider: price.provider, common, strata: ownStrata};
    cache.set(key, result);
    return result;
  }
  /** a vs b on the common basis: cheaper | dearer | unresolved |
   * unresolved_cross_provider | unresolved_no_common_basis | same. */
  function compare(a, b) {
    if (priceModel(prices, a.model) === priceModel(prices, b.model) && a.effort === b.effort) return 'same';
    const x = cost(a.model, a.effort), y = cost(b.model, b.effort);
    if (x.usd === null || y.usd === null) return 'unresolved_no_common_basis';
    if (x.provider !== y.provider) return 'unresolved_cross_provider';
    if (!x.common || !y.common) return 'unresolved_no_common_basis';
    if (x.common.range[1] < y.common.range[0] - EPSILON) return 'cheaper';
    if (x.common.range[0] > y.common.range[1] + EPSILON) return 'dearer';
    return 'unresolved';
  }
  return {cost, compare, strata, observed, multipliers, probe_output_tokens: median(probes), probe_rows: probes.length,
    ratioBetween: (a, b) => ratioBetween(priceModel(prices, a.model) + '\n' + a.effort, priceModel(prices, b.model) + '\n' + b.effort)};
}

// ---- 4. Adoption ---------------------------------------------------------------------------

/** Every (model, effort) a pool's category can bind: the target efforts the
 * model publishes anywhere in the evidence, plus any other dispatchable
 * effort it publishes in this category (ultra); never the dispatch reference. */
function candidateTuples(providerRows, categoryRows, dispatch) {
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
    if (!(model === dispatch.model && effort === dispatch.effort)) tuples.push({model, effort});
  return tuples;
}
/** The failure that binds a rejection: the most negative numeric delta, else the first. */
export function bindingFailure(failures) {
  const numeric = failures.filter(failure => failure.delta !== null);
  return numeric.length ? numeric.reduce((worst, failure) => failure.delta < worst.delta ? failure : worst) : failures[0] ?? null;
}

/** The O1 rule for one pool and one evidence category. `costs`: {cost, compare};
 * `dispatch`: the pool's dispatched reference tuple. */
export function qualifyCategoryEstimated(providerRows, {category, reference, dispatch = {model: reference, effort: 'max'},
  references, curves, margins, costs, blockers = true, marginScale = 1}) {
  const categoryRows = providerRows.filter(row => row.category === category);
  const benchmarks = [...new Set(categoryRows.map(row => row.benchmark))].sort();
  const shared = [];
  for (const benchmark of benchmarks) {
    const benchmarkRows = categoryRows.filter(row => row.benchmark === benchmark);
    const top = referenceRow(benchmarkRows, reference);
    if (top.row) shared.push({benchmark, rows: benchmarkRows, top, bar: referenceBar(benchmarkRows, reference, top)});
  }
  const referenceCost = costs.cost(dispatch.model, dispatch.effort);
  const qualifying = [], rejected = [], blocked = [];
  for (const {model, effort} of candidateTuples(providerRows, categoryRows, dispatch)) {
    const entries = [], failures = [];
    let blocker = null;
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
      const base = {benchmark, unit: top.row.unit, unit_class: unitClass(top.row.unit, lowerBetter), lower_is_better: lowerBetter,
        reference_score: bar.score, reference_effort: bar.effort};
      if (own.length) {
        const score = lowerBetter ? Math.max(...own.map(row => row.score)) : Math.min(...own.map(row => row.score));
        const entry = {...base, source: 'published', score, margin: null, lower_bound: score,
          delta: round6(goodness(score) - goodness(bar.score))};
        entries.push(entry);
        if (entry.delta < -EPSILON) failures.push({why: 'below_reference', ...entry});
        continue;
      }
      const key = curveKey(top.row.provider, model, benchmark);
      if (!curves.has(key)) continue; // no confirmed score of this model here: not shared
      const estimate = estimatePoint(curves, {key, effort, references});
      if (!estimate?.estimable) {
        const entry = {...base, source: 'unestimable', score: null, margin: null, lower_bound: null, delta: null};
        entries.push(entry);
        failures.push({why: 'unestimable', ...entry});
        continue;
      }
      // marginScale 0 is a diagnostic only (the point estimate alone); 1 is the rule.
      const margin = marginScale === 0 ? 0 : marginFor(margins, estimate);
      const lowerBound = margin === null ? null : estimate.goodness - margin * marginScale;
      const entry = {...base, source: 'estimated', score: round6(estimate.score), margin, distance: estimate.distance,
        mode: estimate.mode, kind: estimate.kind,
        lower_bound: lowerBound === null ? null : round6(lowerBetter ? -lowerBound : lowerBound),
        delta: lowerBound === null ? null : round6(lowerBound - goodness(bar.score)),
        anchors: estimate.anchors.map(anchor => ({effort: anchor.anchor, score: round6(lowerBetter ? -anchor.anchor_goodness :
          anchor.anchor_goodness), components: Object.fromEntries(COMPONENTS.map(name => [name, round6(anchor.components[name])])),
          counts: anchor.counts, delta: round6(anchor.delta), clamped: anchor.clamped}))};
      entries.push(entry);
      if (margin === null) failures.push({why: 'no_margin', ...entry});
      else if (entry.delta < -EPSILON) failures.push({why: 'estimate_below_reference', ...entry});
    }
    const failureText = failure => failure.why + ':' + failure.benchmark;
    let reason = !entries.length ? 'no_shared_confirmed_benchmark' : failures.length ? failureText(failures[0]) : blocker;
    const usd = costs.cost(model, effort);
    const versus = costs.compare({model, effort}, dispatch);
    if (reason === null && model === reference && versus !== 'cheaper') reason = 'reference_model_not_resolved_cheaper:' + versus;
    if (reason !== null) {
      const compact = failures.map(({why, benchmark, source, score, margin, lower_bound, reference_score, delta, distance, kind}) =>
        ({why, benchmark, source, score, margin, lower_bound, reference_score, delta, distance: distance ?? null, kind: kind ?? null}));
      rejected.push({model, effort, reason, shared: entries.length, failures: compact, binding: bindingFailure(compact),
        blocker: blocker ?? null});
      if (!failures.length && blocker !== null) blocked.push({model, effort, reason: blocker});
      continue;
    }
    const estimated = entries.filter(entry => entry.source === 'estimated');
    const marginByUnit = {};
    for (const entry of estimated) marginByUnit[entry.unit_class] = Math.max(marginByUnit[entry.unit_class] ?? 0, entry.margin);
    qualifying.push({model, effort, basis: estimated.length ? 'estimated' : 'published',
      basis_label: estimated.length ? 'estimated(' + Object.entries(marginByUnit).map(([unit, value]) => '±' + round6(value) +
        ' ' + unit).join(', ') + ')' : 'published', margin: estimated.length ? marginByUnit : null,
      estimated_benchmarks: estimated.length, expected_cost_usd: usd.usd, cost_basis: usd.basis,
      common_cost_usd: usd.common?.usd ?? null, common_cost_range_usd: usd.common?.range ?? null,
      cost_vs_dispatch_reference: versus, benchmarks: entries});
  }
  qualifying.sort((a, b) => ((a.common_cost_usd ?? a.expected_cost_usd ?? Infinity) - (b.common_cost_usd ?? b.expected_cost_usd ??
    Infinity)) || byEffort(a.effort, b.effort) || compareText(a.model, b.model));
  rejected.sort((a, b) => compareText(a.model, b.model) || byEffort(a.effort, b.effort));
  return {reference: {model: dispatch.model, effort: dispatch.effort, evidence_reference: reference,
    expected_cost_usd: referenceCost.usd, cost_basis: referenceCost.basis, common_cost_usd: referenceCost.common?.usd ?? null,
    common_cost_range_usd: referenceCost.common?.range ?? null, shared_benchmarks: shared.map(item => item.benchmark)},
  qualifying, blocked, rejected};
}

// ---- The candidate table --------------------------------------------------------------------

const parse = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));
/** Everything the candidate and the report need, from the four inputs. Pure. */
export function estimateAll(evidenceBytes, siblingsBytes, pricesBytes, snapshotBytes, {blockers = true} = {}) {
  const evidence = parse(evidenceBytes), siblings = parse(siblingsBytes), prices = parse(pricesBytes),
    snapshot = parse(snapshotBytes);
  if (evidence?.schema !== 1 || !Array.isArray(evidence.rows) || !evidence.references ||
      prices?.schema !== 1 || prices.unit !== 'per_1m_tokens' || prices.currency !== 'USD')
    throw new Error('capability_estimate_input_invalid');
  if (siblings?.evidence_sha256 !== sha256(evidenceBytes)) throw new Error('sibling_map_evidence_mismatch');
  const references = evidence.references;
  const curves = buildCurves(evidence.rows, siblings);
  const samples = backTest(curves, references);
  const margins = marginsFrom(samples);
  const costs = costModel({evidence, prices, snapshot});
  const categories = {};
  for (const [domain, category] of Object.entries(DOMAINS)) {
    const pools = {};
    for (const [provider, pool] of Object.entries(POOLS))
      pools[pool] = qualifyCategoryEstimated(evidence.rows.filter(row => row.provider === provider), {category,
        reference: references[provider], dispatch: DISPATCH_REFERENCES[provider], references, curves, margins, costs, blockers});
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
  const external = externalCheck(evidence.rows, curves, references, margins);
  return {evidence, siblings, prices, snapshot, references, curves, samples, margins, costs, categories, broad, multiCurves,
    external, shas: {evidence: sha256(evidenceBytes), siblings: sha256(siblingsBytes), prices: sha256(pricesBytes),
      snapshot: sha256(snapshotBytes)}};
}

export function backTestSummary(samples) {
  const summary = {};
  for (const unit of [...new Set(samples.map(sample => sample.unit_class))].sort()) {
    summary[unit] = {};
    for (const scenario of SCENARIOS) {
      const own = samples.filter(sample => sample.unit_class === unit && sample.scenarios.includes(scenario));
      if (!own.length) continue;
      const ok = own.filter(sample => sample.estimable);
      // Components compared on ONE common subset: samples where all three exist.
      const common = ok.filter(sample => COMPONENTS.every(name => sample.component_errors[name] !== null));
      const component = {subset: common.length};
      for (const name of COMPONENTS) component[name] = common.length ? round6(nearestRank(common.map(sample =>
        Math.abs(sample.component_errors[name])), 95)) : null;
      component.combined = common.length ? round6(nearestRank(common.map(sample => sample.abs_error), 95)) : null;
      summary[unit][scenario] = {samples: own.length, estimable: ok.length, unestimable: own.length - ok.length,
        clusters: new Set(ok.map(sample => sample.cluster)).size, clamped: ok.filter(sample => sample.clamped).length,
        mean_abs: ok.length ? round6(ok.reduce((s, x) => s + x.abs_error, 0) / ok.length) : null,
        mean_signed: ok.length ? round6(ok.reduce((s, x) => s + x.signed_error, 0) / ok.length) : null,
        p95_abs: ok.length ? round6(nearestRank(ok.map(x => x.abs_error), 95)) : null, component_p95_abs_common_subset: component};
    }
  }
  return summary;
}

/** The compiled candidate (pure). Not the shipped table: nothing pins it. */
export function compileEstimatedTable(evidenceBytes, siblingsBytes, pricesBytes, snapshotBytes, options = {}) {
  const all = estimateAll(evidenceBytes, siblingsBytes, pricesBytes, snapshotBytes, options);
  const {costs} = all;
  return {schema: 1, policy: ESTIMATE_POLICY, status: 'candidate_not_shipped', base_policy: POLICY, tolerance: TOLERANCE,
    reference_bar: REFERENCE_BAR, compiled_on: all.evidence.retrieved_on,
    blockers: options.blockers === false ? [] : ['unconfirmed_below_reference', 'below_reference_at_higher_effort'],
    evidence_sha256: all.shas.evidence, sibling_map_sha256: all.shas.siblings, price_table_sha256: all.shas.prices,
    ledger_snapshot_sha256: all.shas.snapshot,
    basis: 'first_party_benchmarks_published_or_estimated_minus_backtested_margin_not_an_answer_check',
    estimator: {target_efforts: [...TARGET_EFFORTS], unit_classes: UNIT_CLASSES, lower_is_better: 'own_unit_class',
      bounded_units: [...BOUNDED_UNITS], components: [...COMPONENTS], combination: COMBINATION,
      anchor: 'nearest_published_effort_same_curve;two_equidistant_anchors_mean', family: 'same_provider_all_models_same_unit_class',
      confirmed_only: true, sibling_groups: all.siblings.groups.map(group => group.id)},
    backtest: {multi_effort_curves: all.multiCurves, scenarios: [...SCENARIOS], summary: backTestSummary(all.samples)},
    external_check: all.external.summary, margin_rule: MARGIN_RULE,
    margins: Object.fromEntries(Object.entries(all.margins).map(([unit, table]) => [unit, Object.fromEntries(Object.entries(table)
      .map(([distance, row]) => [distance, {margin: row.margin, clusters: Object.fromEntries(KINDS.map(kind =>
        [kind, row[kind].n_clusters]))}]))])),
    dispatch_references: DISPATCH_REFERENCES,
    cost: {bases: [...COST_BASES], typical_input: {uncached_input: TYPICAL_CALL.uncached_input,
      cached_input: TYPICAL_CALL.cached_input}, scaling: 'output_only', ledger_min_n: LEDGER_MIN_N,
    probe_rule: 'output_tokens < ' + PROBE_OUTPUT_TOKENS_BELOW + ' excluded', multipliers: costs.multipliers,
    strata: costs.strata.map(({surface, model, effort, n, excluded_probe, median_output_tokens, median_request_usd}) =>
      ({surface, model, effort, n, excluded_probe, median_output_tokens, median_request_usd: round6(median_request_usd)}))},
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
/** The capability-row rule (header rule 6), written out so it is reviewable. */
export const CAPABILITY_BINDING_RULE = 'candidates = cells qualifying in every listed category (either pool) + both dispatch ' +
  'references (delta 0 against their own pool bar); default = codex:gpt-6-astra@ultra (the all-reference tuple); a candidate ' +
  'replaces the default only when resolved cheaper on the common cost basis (same provider, ranges disjoint); an unresolved ' +
  'qualifying candidate is an owner decision, never bound silently';
/** How each family binds (DESIGN-6 §3; O1-O3). */
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
  F4: {kind: 'capability', categories: ['knowledge', 'science'], surface: 'chat', binding: CAPABILITY_BINDING_RULE,
    why: 'standard explanation; O3: the cheapest cell >= the reference in knowledge and science'},
  'F6-code': {kind: 'capability', categories: ['coding'], surface: 'chat', binding: CAPABILITY_BINDING_RULE,
    why: 'deep design with a code/schema artifact; the coding bar'},
  F7: {kind: 'capability', categories: ['coding'], surface: 'agent', binding: CAPABILITY_BINDING_RULE,
    why: 'workspace build (order 6); the write grant sets the surface, never the model'},
});
const tupleText = (surface, model, effort) => surface + ':' + model + '@' + effort;

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
  if (route === null) return {usd: null, basis: 'not_recorded', common: null};
  if (/^(?:local|calculator):/.test(route)) return {usd: 0, basis: 'local', common: null};
  const match = route.match(/^[a-z-]+:([^@]+)@([a-z]+)$/);
  if (!match) return {usd: null, basis: 'unparsed', common: null};
  return all.costs.cost(match[1], match[2]);
}
const money = value => value === null || value === undefined ? '—' : '$' + value.toFixed(4);
const rangeText = cost => cost?.common ? money(cost.common.range[0]) + '–' + money(cost.common.range[1]) : 'no range';
/** One line per binding rejection: "model@effort: benchmark est E − M = LB < bar B (dN kind)". */
export function rejectionLine(rejection) {
  const failure = rejection.binding;
  if (!failure) return rejection.model + '@' + rejection.effort + ': ' + rejection.reason;
  const more = rejection.failures.length > 1 ? ' (+' + (rejection.failures.length - 1) + ' more)' : '';
  const where = failure.benchmark;
  if (failure.why === 'below_reference')
    return `${rejection.model}@${rejection.effort}: ${where} published ${failure.score} < bar ${failure.reference_score}${more}`;
  if (failure.why === 'estimate_below_reference')
    return `${rejection.model}@${rejection.effort}: ${where} est ${failure.score} − ${failure.margin} = ${failure.lower_bound} < bar ` +
      `${failure.reference_score} (d${failure.distance} ${failure.kind})${more}`;
  if (failure.why === 'no_margin')
    return `${rejection.model}@${rejection.effort}: ${where} est ${failure.score}, no adoptable margin at d${failure.distance} ${failure.kind}${more}`;
  return `${rejection.model}@${rejection.effort}: ${where} ${failure.why}${more}`;
}

/** The capability row (rule 6) for one family policy. */
function capabilityRow(all, policy) {
  const fallback = DISPATCH_REFERENCES[OWNER_DEFAULT_PROVIDER];
  const candidates = [];
  for (const [provider, poolName] of Object.entries(POOLS)) {
    const lists = policy.categories.map(domain => all.categories[domain].pools[poolName].qualifying);
    for (const row of lists[0]) {
      const everywhere = lists.map(list => list.find(other => other.model === row.model && other.effort === row.effort));
      if (everywhere.some(item => !item)) continue;
      const margins = {};
      for (const item of everywhere) for (const [unit, value] of Object.entries(item.margin ?? {}))
        margins[unit] = Math.max(margins[unit] ?? 0, value);
      candidates.push({kind: 'qualifying', provider, model: row.model, effort: row.effort,
        estimated: everywhere.some(item => item.basis === 'estimated'), margins});
    }
    const ref = DISPATCH_REFERENCES[provider];
    candidates.push({kind: 'reference', provider, model: ref.model, effort: ref.effort, estimated: false, margins: {}});
  }
  for (const candidate of candidates) {
    candidate.cost = all.costs.cost(candidate.model, candidate.effort);
    candidate.vs_default = all.costs.compare(candidate, fallback);
    candidate.tuple = tupleText(SURFACES[candidate.provider][policy.surface], candidate.model, candidate.effort);
  }
  const eligible = candidates.filter(candidate => candidate.vs_default === 'cheaper').sort((a, b) =>
    (a.cost.common.usd - b.cost.common.usd) || byEffort(a.effort, b.effort) || compareText(a.model, b.model));
  const chosen = eligible[0] ?? candidates.find(candidate => candidate.vs_default === 'same');
  const alternatives = candidates.filter(candidate => candidate !== chosen);
  const undecided = alternatives.filter(candidate => candidate.kind === 'qualifying' && candidate.vs_default.startsWith('unresolved'));
  // Per category and pool: the shipped cells O1 removed, and the nearest miss
  // that only estimates decide (the cell O1 would add first if margins shrank).
  const rejections = [];
  for (const domain of policy.categories) for (const poolName of Object.values(POOLS)) {
    const result = all.categories[domain].pools[poolName];
    const removed = result.rejected.filter(rejection => all.shippedQualifying?.has([domain, poolName, rejection.model,
      rejection.effort].join('\n')));
    for (const rejection of removed) rejections.push(domain + ': removed ' + rejectionLine(rejection));
    const misses = result.rejected.filter(rejection => !removed.includes(rejection) && rejection.failures.length &&
      rejection.failures.every(failure => failure.source === 'estimated') && rejection.binding?.delta !== null &&
      rejection.binding?.delta !== undefined).sort((a, b) => (b.binding.delta - a.binding.delta) ||
      compareText(a.model, b.model) || byEffort(a.effort, b.effort));
    if (misses.length) rejections.push(domain + ': nearest estimated miss ' + rejectionLine(misses[0]));
  }
  return {chosen, candidates, alternatives, undecided, rejections};
}

/** The owner fixed-question table from estimateAll() output. */
export function ownerTable(all, {replay = [], production = null} = {}) {
  const rows = [];
  const defaultTuple = DISPATCH_REFERENCES[OWNER_DEFAULT_PROVIDER];
  const defaultCost = all.costs.cost(defaultTuple.model, defaultTuple.effort);
  for (const question of OWNER_FIXED_QUESTIONS) {
    const policy = FAMILY_POLICY[question.family];
    const was = route446(replay, question.request);
    let chosen, basis, margin = null, cost, why = policy.why, signed = null, escalation = null, binding = null;
    let alternatives = [], ownerDecision = null, rejections = [];
    if (policy.kind === 'calculator') {
      chosen = 'local:calculator -> ' + question.answer; basis = 'zero_model'; cost = {usd: 0, basis: 'local', common: null};
    } else if (policy.kind === 'local' || policy.kind === 'ask_back') {
      chosen = LOCAL_MODEL; basis = policy.kind === 'ask_back' ? 'owner_decision:O2' : 'owner_decision:order3';
      cost = {usd: 0, basis: 'local', common: null};
    } else if (policy.kind === 'fanout') {
      const probeTokens = all.costs.probe_output_tokens ?? 0;
      let usd = 0;
      const lanes = [];
      for (const lane of policy.lanes) {
        const price = all.prices.models[priceModel(all.prices, lane.model)];
        usd += typicalInputUSD(price) + outputUSD(price, probeTokens);
        lanes.push(tupleText(lane.surface, lane.model, lane.effort));
      }
      chosen = 'fan-out ' + [LOCAL_MODEL, ...lanes].join(' ‖ ') + ' + calculator probe 17+25';
      basis = 'order5:liveness_not_quality';
      cost = {usd: round6(usd), basis: 'typical_input_plus_probe_output', probe_output_tokens: probeTokens, common: null};
      signed = policy.lanes.every(lane => signedTuple(production, lane.surface, lane.model, lane.effort));
    } else if (policy.kind === 'owner_decision') {
      chosen = tupleText(policy.surface, policy.model, policy.effort); basis = 'owner_decision:O3-D2 (not delta-0)';
      cost = all.costs.cost(policy.model, policy.effort);
      signed = signedTuple(production, policy.surface, policy.model, policy.effort);
      escalation = 'codex:gpt-6-astra@ultra';
    } else {
      const result = capabilityRow(all, policy);
      const best = result.chosen;
      chosen = best.tuple;
      cost = best.cost;
      signed = signedTuple(production, SURFACES[best.provider][policy.surface], best.model, best.effort);
      if (best.kind === 'reference') {
        basis = 'reference';
        binding = best.vs_default === 'same' ? 'default reference: no candidate resolved cheaper' : 'reference resolved cheaper';
      } else {
        basis = best.estimated ? 'estimated(' + Object.entries(best.margins).map(([unit, value]) => '±' + round6(value) + ' ' + unit)
          .join(', ') + ') 공식 점수 기반 추정' : 'published';
        margin = best.estimated ? best.margins : null;
        binding = 'resolved cheaper than the default reference';
      }
      alternatives = result.alternatives.map(candidate => ({tuple: candidate.tuple, kind: candidate.kind,
        basis: candidate.kind === 'reference' ? 'reference' : candidate.estimated ? 'estimated' : 'published',
        expected_cost_usd: candidate.cost.usd, cost_basis: candidate.cost.basis, common_cost_usd: candidate.cost.common?.usd ?? null,
        common_cost_range_usd: candidate.cost.common?.range ?? null, vs_default: candidate.vs_default}));
      if (result.undecided.length) ownerDecision = result.undecided.map(candidate => `${candidate.tuple} qualifies ` +
        `(${candidate.estimated ? 'estimated' : 'published'}) at ${money(candidate.cost.usd)} [${rangeText(candidate.cost)}] vs ` +
        `${chosen} ${money(cost.usd)} [${rangeText(cost)}]: ${candidate.vs_default}; the default reference binds unless the ` +
        `owner picks it`).join('; ');
      rejections = result.rejections;
    }
    const was446 = routeCost(all, was?.route ?? null);
    rows.push({n: question.n, request: question.request, family: question.family, chosen, basis, binding, margin,
      expected_cost_usd: cost.usd, cost_basis: cost.basis, common_cost_usd: cost.common?.usd ?? null,
      common_cost_range_usd: cost.common?.range ?? null, cost_detail: cost, escalation, signed, why,
      alternatives, owner_decision: ownerDecision, binding_rejections: rejections,
      note: question.note ?? null, route_446: was?.route ?? null, route_446_basis: was?.basis ?? null,
      route_446_scope: was?.scope ?? null, route_446_cost_usd: was446.usd, route_446_cost_basis: was446.basis,
      route_446_cost_range_usd: was446.common?.range ?? null});
  }
  // Totals: three coherent cost scenarios (point, every common range low, every
  // common range high); a cost without a range keeps its point in each.
  const scenario = (usd, range, which) => which === 'point' || !range ? usd : which === 'low' ? range[0] : range[1];
  const referenceIn = which => scenario(defaultCost.usd, defaultCost.common?.range ?? null, which);
  const sensitivity = {};
  for (const which of ['point', 'low', 'high']) {
    const total = rows.reduce((sum, row) => sum + scenario(row.expected_cost_usd ?? 0, row.common_cost_range_usd, which), 0);
    const recorded = rows.filter(row => row.route_446_cost_usd !== null);
    const total446 = recorded.reduce((sum, row) => sum + scenario(row.route_446_cost_usd, row.route_446_cost_range_usd, which), 0);
    const totalNew = recorded.reduce((sum, row) => sum + scenario(row.expected_cost_usd ?? 0, row.common_cost_range_usd, which), 0);
    sensitivity[which] = {reference_unit_usd: round6(referenceIn(which)), new_usd: round6(total),
      ratio_new_to_all_reference: round6(total / (rows.length * referenceIn(which))),
      ratio_new_to_all_reference_on_446_recorded: round6(totalNew / (recorded.length * referenceIn(which))),
      route_446_usd: round6(total446), ratio_446_to_all_reference: round6(total446 / (recorded.length * referenceIn(which)))};
  }
  // The one observed Opus@max explanation (claude-chat, n = 1), priced like a point.
  const opusChat = all.costs.strata.find(stratum => stratum.surface === 'claude-chat' && stratum.model === 'claude-opus-5-5' &&
    stratum.effort === 'max');
  let opusObserved = null;
  if (opusChat) {
    const price = all.prices.models['claude-opus-5-5'];
    const usd = typicalInputUSD(price) + opusChat.output_usd;
    const recorded = rows.filter(row => row.route_446_cost_usd !== null);
    const total446 = recorded.reduce((sum, row) => sum + (/^claude(?:-chat)?:claude-opus-5-5@max$/.test(row.route_446) ? usd :
      row.route_446_cost_usd), 0);
    opusObserved = {n: opusChat.n, output_tokens: opusChat.median_output_tokens, usd: round6(usd),
      observed_request_usd: round6(opusChat.median_request_usd), route_446_usd: round6(total446),
      ratio_446_to_all_reference: round6(total446 / (recorded.length * defaultCost.usd))};
  }
  const point = sensitivity.point;
  return {rows, rule: CAPABILITY_BINDING_RULE, totals: {questions: rows.length, expected_cost_usd: point.new_usd,
    all_reference_tuple: tupleText('codex', defaultTuple.model, defaultTuple.effort), all_reference_unit_usd: defaultCost.usd,
    all_reference_basis: defaultCost.basis, all_reference_usd: round6(rows.length * defaultCost.usd),
    ratio_to_all_reference: point.ratio_new_to_all_reference,
    recorded_446: rows.filter(row => row.route_446_cost_usd !== null).length, sensitivity,
    route_446_with_observed_opus_max_explanation: opusObserved}};
}

// ---- O1 effect against the shipped table -------------------------------------------------------

/** Cells the O1 candidate adds to or removes from the shipped table. */
export function shippedComparison(all, shipped) {
  const added = [], removed = [], kept = [];
  for (const [domain, category] of Object.entries(all.categories)) for (const [pool, result] of Object.entries(category.pools)) {
    const before = new Set((shipped?.categories?.[domain]?.pools?.[pool]?.qualifying ?? []).map(row => row.model + '@' + row.effort));
    const after = new Set(result.qualifying.map(row => row.model + '@' + row.effort));
    for (const cell of [...after].sort()) (before.has(cell) ? kept : added).push({domain, pool, cell,
      basis: result.qualifying.find(row => row.model + '@' + row.effort === cell).basis});
    for (const cell of [...before].sort()) if (!after.has(cell)) {
      const [model, effort] = cell.split('@');
      const rejection = result.rejected.find(row => row.model === model && row.effort === effort);
      removed.push({domain, pool, cell, reason: rejection?.reason ?? 'not_offered', line: rejection ? rejectionLine(rejection) : cell});
    }
  }
  return {added, removed, kept};
}
/** The O1 worked example (DESIGN-6: Opus@xhigh on HLE against Fable's best). */
export function workedExample(all) {
  const benchmark = "Humanity's Last Exam (no tools)";
  const result = all.categories.science.pools.anthropic_shared;
  const rejection = result.rejected.find(row => row.model === 'claude-opus-5-5' && row.effort === 'xhigh');
  const failure = rejection?.failures.find(item => item.benchmark === benchmark) ?? null;
  const estimate = estimatePoint(all.curves, {key: curveKey('anthropic', 'claude-opus-5-5', benchmark), effort: 'xhigh',
    references: all.references});
  return {benchmark, cell: 'claude-opus-5-5@xhigh', estimate: round6(estimate?.score), margin: estimate ? marginFor(all.margins, estimate) : null,
    distance: estimate?.distance ?? null, kind: estimate?.kind ?? null, failure, qualifies: !rejection};
}

// ---- Report files ------------------------------------------------------------------------------

function markdownOwnerTable(table, comparison, example, external) {
  const lines = ['| # | Question | Family | Chosen (surface:model@effort) | Basis | Margin | Effort-aware cost: point (basis) [common range] | Why this cell / binding rejections | 446 route (cost) | Signed |',
    '|---|---|---|---|---|---|---|---|---|---|'];
  for (const row of table.rows) {
    const reasons = [row.binding, row.owner_decision ? 'OWNER DECISION: ' + row.owner_decision : null,
      ...row.binding_rejections].filter(Boolean).join('<br>') || '—';
    lines.push('| ' + [row.n, row.request, row.family, '`' + row.chosen + '`', row.basis,
      row.margin ? Object.entries(row.margin).map(([unit, value]) => '±' + value + ' ' + unit).join(', ') : '—',
      money(row.expected_cost_usd) + ' (' + row.cost_basis + ')' + (row.common_cost_range_usd ? ' [' +
        money(row.common_cost_range_usd[0]) + '–' + money(row.common_cost_range_usd[1]) + ']' : ''),
      reasons,
      row.route_446 ? '`' + row.route_446 + '` (' + money(row.route_446_cost_usd) + (row.route_446_cost_range_usd ? ' [' +
        money(row.route_446_cost_range_usd[0]) + '–' + money(row.route_446_cost_range_usd[1]) + ']' : '') + ')' : 'not in r446c',
      row.signed === null ? '—' : row.signed ? 'yes' : 'NO'].join(' | ') + ' |');
  }
  const t = table.totals;
  const s = t.sensitivity;
  const alt = table.rows.filter(row => row.alternatives.length);
  lines.push('', `**O1 effect:** O1 added ${comparison.added.length} cell${comparison.added.length === 1 ? '' : 's'}` +
    (comparison.added.length ? ' (' + comparison.added.map(item => item.domain + '/' + item.pool + ' ' + item.cell).join(', ') + ')' : '') +
    `; it removed ${comparison.removed.length ? comparison.removed.map(item => item.domain + '/' + item.pool + ' ' + item.cell).join(', ') : 'none'}` +
    ' from the shipped table.');
  for (const item of comparison.removed) lines.push(`- removed ${item.domain}/${item.pool}: ${item.line}`);
  lines.push('', `**O1 worked example** (${example.cell}, ${example.benchmark}): estimate ${example.estimate}, margin ${example.margin} ` +
    `(d${example.distance} ${example.kind}) → lower bound ${example.failure?.lower_bound ?? '—'} vs bar ${example.failure?.reference_score ?? '—'}: ` +
    (example.qualifies ? 'qualifies.' : 'does not qualify (DESIGN-6 O1 expected it to).'));
  lines.push('', '**Capability rows** (' + table.rule + ').', '',
    '| # | Alternative not chosen | Kind / basis | Point (basis) | Common range | vs default |', '|---|---|---|---|---|---|');
  for (const row of alt) for (const item of row.alternatives) lines.push('| ' + [row.n, '`' + item.tuple + '`', item.kind + ' / ' + item.basis,
    money(item.expected_cost_usd) + ' (' + item.cost_basis + ')', item.common_cost_range_usd ? money(item.common_cost_range_usd[0]) +
      '–' + money(item.common_cost_range_usd[1]) : '—', item.vs_default].join(' | ') + ' |');
  lines.push('', `**Totals, ${t.questions} questions** (all-reference = ${t.questions} × \`${t.all_reference_tuple}\`):`, '',
    '| Cost scenario | Reference unit | New total | New / all-reference | On the ' + t.recorded_446 + ' r446c rows: new / all-ref | build 446 / all-ref |',
    '|---|---|---|---|---|---|');
  for (const [name, value] of Object.entries(s)) lines.push('| ' + [name === 'point' ? 'point (per-cell basis)' : 'every common range ' + name,
    money(value.reference_unit_usd), money(value.new_usd), value.ratio_new_to_all_reference + '×',
    value.ratio_new_to_all_reference_on_446_recorded + '×', value.ratio_446_to_all_reference + '×'].join(' | ') + ' |');
  if (t.route_446_with_observed_opus_max_explanation) {
    const o = t.route_446_with_observed_opus_max_explanation;
    lines.push('| build 446 with its Opus@max rows at the one observed claude-chat explanation (n=' + o.n + ', ' + o.output_tokens +
      ' output tokens, ' + money(o.usd) + '; ' + money(o.observed_request_usd) + ' with its observed input) | ' +
      money(t.all_reference_unit_usd) + ' | — | — | — | ' + o.ratio_446_to_all_reference + '× |');
  }
  lines.push('', '**Read these numbers as indicative, not like-for-like:**',
    '- Every capability row binds a reference unless a cell is resolved cheaper, so the new arm differs from all-reference only on the light rows (local/calculator $0, F5a, F10).',
    '- A ledger stratum mixes task families: the routing `family` field is outside this tool\'s read scope. `' + t.all_reference_tuple +
      '` ' + money(t.all_reference_unit_usd) + ' is a median of mostly short Codex replies. The same reference price is used for the site build and the explanations, which are longer.',
    '- Different providers share no cost anchor, so an Anthropic cell is never ordered against the OpenAI default. The ledger effort multipliers also mix workloads (ultra lands below medium); they are a fallback only.',
    '- The build-446 ratios price its Opus@max rows from first-party per-task ratios on the common basis, whose range is wide. The single observed Opus@max explanation is shown separately.',
    '', `**Back-test assumption:** effort scores are NOT assumed missing at random. Margins come from two scenarios: neighbourhoods hidden at each distance, and only the top effort published (the real "max only" case). Siblings of a hidden point are hidden too. Each margin is a cluster-bootstrap upper bound, and a direction or distance with fewer than ${MIN_CLUSTERS} independent curves is not adoptable.`,
    `**Single-source check:** the estimator was run against the ${external.summary.points} single-source or disputed points-unit scores it never uses. Mean signed error ${external.summary.mean_signed} (${external.summary.over_estimates} over-estimates); ${external.summary.outside_margin} outside the margin; ${external.summary.without_margin} without an adoptable margin.`);
  return lines.join('\n') + '\n';
}
function writeNew(path, text) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
  try { writeSync(fd, text); } finally { closeSync(fd); }
}
/** The report files' contents (pure): name -> text. */
export function reportFiles(all, {replay = [], production = null, shipped = null, candidateBytes}) {
  const shippedQualifying = new Set();
  for (const [domain, category] of Object.entries(shipped?.categories ?? {})) for (const [pool, result] of Object.entries(category.pools))
    for (const row of result.qualifying) shippedQualifying.add([domain, pool, row.model, row.effort].join('\n'));
  const table = ownerTable({...all, shippedQualifying}, {replay, production});
  const comparison = shippedComparison(all, shipped);
  const example = workedExample(all);
  const qualifying = {};
  for (const [domain, category] of Object.entries(all.categories)) {
    qualifying[domain] = {};
    for (const [pool, result] of Object.entries(category.pools))
      qualifying[domain][pool] = {reference: result.reference,
        qualifying: result.qualifying.map(({model, effort, basis, basis_label, margin, expected_cost_usd, cost_basis,
          common_cost_usd, common_cost_range_usd, cost_vs_dispatch_reference, benchmarks}) => ({model, effort, basis, basis_label,
          margin, expected_cost_usd, cost_basis, common_cost_usd, common_cost_range_usd, cost_vs_dispatch_reference,
          benchmarks: benchmarks.map(({benchmark, source, score, margin, lower_bound, reference_score, reference_effort, delta,
            distance, kind}) => ({benchmark, source, score, margin, lower_bound, reference_score, reference_effort, delta,
            distance: distance ?? null, kind: kind ?? null}))})),
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
  // Diagnostic only: the same rule on point estimates (margin 0).
  const pointOnly = {};
  for (const [domain, category] of Object.entries(DOMAINS)) for (const [provider, pool] of Object.entries(POOLS)) {
    const loose = qualifyCategoryEstimated(all.evidence.rows.filter(row => row.provider === provider), {category,
      reference: all.references[provider], dispatch: DISPATCH_REFERENCES[provider], references: all.references, curves: all.curves,
      margins: all.margins, costs: all.costs, marginScale: 0});
    const strict = all.categories[domain].pools[pool];
    const extra = loose.qualifying.filter(row => !strict.qualifying.some(other => other.model === row.model &&
      other.effort === row.effort)).map(row => {
      const rejection = strict.rejected.find(other => other.model === row.model && other.effort === row.effort);
      return {model: row.model, effort: row.effort, rule_reason: rejection?.reason ?? null,
        rule_failures: rejection ? rejection.failures.map(failure => rejectionLine({...rejection, failures: [failure], binding: failure})) : []};
    });
    if (extra.length) (pointOnly[domain] ??= {})[pool] = extra;
  }
  const marginRows = {};
  for (const [unit, rows] of Object.entries(all.margins)) {
    marginRows[unit] = {};
    for (const [distance, row] of Object.entries(rows)) marginRows[unit][distance] = row;
  }
  const files = {
    'point-estimate-diagnostic.json': canonical({note: 'diagnostic only, not a verdict: the O1 rule with margin 0', cells: pointOnly}),
    'backtest.json': canonical({multi_effort_curves: all.multiCurves, combination: COMBINATION, scenarios: SCENARIOS,
      sibling_groups: all.siblings.groups, summary, samples: all.samples}),
    'margins.json': canonical({rule: MARGIN_RULE, margins: marginRows}),
    'external-check.json': canonical({assumption: 'effort scores are not assumed missing at random: margins are measured ' +
      'in the neighbourhood and top_only scenarios with siblings hidden, by direction; this file checks the estimator against ' +
      'the single-source and disputed scores it never uses', ...all.external}),
    'qualifying-cells.json': canonical({policy: ESTIMATE_POLICY, dispatch_references: DISPATCH_REFERENCES, broad: all.broad,
      categories: qualifying}),
    'shipped-vs-o1.json': canonical({...comparison, worked_example: example}),
    'costs.json': canonical({bases: COST_BASES, scaling: 'output_only', ledger_min_n: LEDGER_MIN_N,
      probe_rule: 'output_tokens < ' + PROBE_OUTPUT_TOKENS_BELOW, probe_output_tokens_median: all.costs.probe_output_tokens,
      probe_rows: all.costs.probe_rows, multipliers: all.costs.multipliers,
      snapshot: {taken_on: all.snapshot.taken_on, source_sha256: all.snapshot.source_sha256,
        source_records: all.snapshot.source_records, observations: all.snapshot.observations, fields_read: all.snapshot.fields_read},
      strata: all.costs.strata.map(stratum => ({...stratum, output_usd: round6(stratum.output_usd),
        median_request_usd: round6(stratum.median_request_usd)})), cells: costCells}),
    'owner-table.json': canonical(table),
    'owner-table.md': markdownOwnerTable(table, comparison, example, all.external),
    'inputs.json': canonical({evidence_sha256: all.shas.evidence, sibling_map_sha256: all.shas.siblings,
      price_table_sha256: all.shas.prices, ledger_snapshot_sha256: all.shas.snapshot,
      candidate_sha256: candidateBytes ? sha256(candidateBytes) : null}),
  };
  return {files, table, summary, comparison, example};
}

// ---- CLI -----------------------------------------------------------------------------------------

const OPTIONS = ['--evidence', '--siblings', '--prices', '--ledger-snapshot', '--out', '--table', '--ledger', '--on', '--r446c',
  '--production', '--shipped', '--out-dir'];
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
  if (!['compile', 'check', 'report'].includes(command) || !options.evidence || !options.siblings || !options.prices ||
      !options['ledger-snapshot'])
    throw new Error('usage: compile|check|report --evidence <file> --siblings <file> --prices <file> --ledger-snapshot <file> …');
  const inputs = [readFileSync(options.evidence), readFileSync(options.siblings), readFileSync(options.prices),
    readFileSync(options['ledger-snapshot'])];
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
  if (!options['out-dir'] || !options.r446c || !options.production || !options.shipped)
    throw new Error('report needs --r446c, --production, --shipped and --out-dir');
  const all = estimateAll(...inputs);
  const replay = JSON.parse(readFileSync(options.r446c).toString('utf8'));
  const production = JSON.parse(readFileSync(options.production).toString('utf8'));
  const shipped = JSON.parse(readFileSync(options.shipped).toString('utf8'));
  mkdirSync(options['out-dir'], {recursive: true});
  if (readdirSync(options['out-dir']).length) throw new Error('report --out-dir must be new or empty');
  const {files} = reportFiles(all, {replay, production, shipped, candidateBytes: Buffer.from(bytes)});
  for (const [name, text] of Object.entries(files)) writeNew(join(options['out-dir'], name), text);
  process.stdout.write('report: ' + Object.keys(files).length + ' files in ' + options['out-dir'] + '\n');
  return 0;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { process.exitCode = main(); } catch (error) { process.stderr.write(String(error.message ?? error) + '\n'); process.exitCode = 64; }
}
