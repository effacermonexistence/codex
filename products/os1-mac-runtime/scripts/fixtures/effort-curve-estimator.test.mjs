// DESIGN-6 O1 (owner decision 2026-10-29): inductive effort-curve estimation
// for the capability table (scripts/effort-curve-estimator.mjs): curves with
// sibling groups, the estimator, the sibling-aware neighbourhood and max-only
// back-tests, the cluster-bootstrap margins by situation, the adoption rule
// (delta 0 against the reference's best confirmed score, estimate minus margin
// for an unpublished effort, blockers A/B, every failure recorded), the
// output-only common-anchor cost and its orderings, the candidate file and the
// owner fixed-question table. Pure functions over small row sets and the
// committed evidence: no provider, model, network or real HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical, compileTable} from '../capability-table.mjs';
import {CAPABILITY_BINDING_RULE, FAMILY_POLICY, KINDS, MIN_CLUSTERS, OWNER_FIXED_QUESTIONS, backTest, bindingFailure,
  buildCurves, cellStats, compileEstimatedTable, costModel, curveKey, estimateAll, estimatePoint, externalCheck, hideEfforts,
  hidePoint, ledgerSnapshot, marginFor, marginsFrom, nearestRank, ownerTable, qualifyCategoryEstimated, rejectionLine,
  reportFiles, route446, shippedComparison, signedTuple, workedExample} from '../effort-curve-estimator.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const EVIDENCE = readFileSync(join(ROOT, 'scripts/capability-evidence-20261027.json'));
const SIBLINGS = readFileSync(join(ROOT, 'scripts/capability-evidence-siblings-20261027.json'));
const PRICES = readFileSync(join(ROOT, 'Resources/model-price-table.json'));
const SNAPSHOT = readFileSync(join(ROOT, 'scripts/routing-ledger-usage-20261029-v2.json'));
const CANDIDATE = readFileSync(join(ROOT, 'Resources/model-capability-table.estimate-candidate.json'));
const SHIPPED = readFileSync(join(ROOT, 'Resources/model-capability-table.json'));
const prices = JSON.parse(PRICES.toString('utf8'));

const REF = 'claude-fable-5-1', OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5';
const REFERENCES = {anthropic: REF, openai: 'gpt-6-astra'};
const ev = (model, benchmark, level, score, {status = 'confirmed', lb = false, cost = null, category = 'math',
  provider = 'anthropic', unit = '%'} = {}) => ({provider, category, benchmark, model, reasoning_level: level, score,
  status, sources: ['https://www.anthropic.com/fixture'], cost, note: '', lower_better: lb, unit});
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
const estimate = (rows, model, benchmark, effort, provider = 'anthropic', siblings = null) =>
  estimatePoint(buildCurves(rows, siblings), {key: curveKey(provider, model, benchmark), effort, references: REFERENCES});
const siblingDoc = (...groups) => ({schema: 1, kind: 'capability_evidence_sibling_groups',
  groups: groups.map(([id, benchmarks]) => ({id, provider: 'anthropic', benchmarks}))});

// ---- 1. Curves -------------------------------------------------------------------------------
test('curves: confirmed scores at dispatchable efforts only; lower-is-better is its own unit class', () => {
  const curves = buildCurves([ev(OPUS, 'B', 'max', 70), ev(OPUS, 'B', 'xhigh', 66, {status: 'single_source'}),
    ev(OPUS, 'B', 'unspecified', 75), ev(OPUS, 'B', 'medium (API default)', 60), ev(OPUS, 'err', 'max', 4, {lb: true}),
    ev(OPUS, 'elo', 'max', 1800, {unit: 'Elo'})]);
  assert.deepEqual(curves.get(curveKey('anthropic', OPUS, 'B')).points, {max: 70, medium: 60});
  assert.deepEqual(curves.get(curveKey('anthropic', OPUS, 'err')).points, {max: -4});
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'err')).unit_class, 'points_lower_better');
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'elo')).unit_class, 'elo');
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'elo')).bounded, false);
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'B')).unit_class, 'points');
  assert.throws(() => buildCurves([ev(OPUS, 'B', 'max', 70), ev(OPUS, 'B', 'xhigh', 66, {unit: 'Elo'})]),
    /effort_curve_inconsistent/);
});

test('curves: sibling groups set the group and the (provider, model, group) cluster; the map is validated', () => {
  const rows = [ev(OPUS, 'H1', 'max', 70), ev(OPUS, 'H2', 'max', 60), ev(REF, 'H1', 'max', 65), ev(OPUS, 'Z', 'max', 1)];
  const curves = buildCurves(rows, siblingDoc(['g:h', ['H1', 'H2']]));
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'H2')).group, 'g:h');
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'H1')).cluster, curves.get(curveKey('anthropic', OPUS, 'H2')).cluster);
  assert.notEqual(curves.get(curveKey('anthropic', REF, 'H1')).cluster, curves.get(curveKey('anthropic', OPUS, 'H1')).cluster);
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'Z')).group, 'Z');
  assert.throws(() => buildCurves(rows, siblingDoc(['g', ['H1', 'missing']])), /sibling_map_unknown_benchmark/);
  assert.throws(() => buildCurves(rows, siblingDoc(['a', ['H1', 'H2']], ['b', ['H1', 'Z']])), /sibling_map_duplicate/);
  // The committed map names only benchmarks the evidence has, for the evidence it was declared against.
  const map = JSON.parse(SIBLINGS.toString('utf8'));
  assert.equal(map.evidence_sha256, sha(EVIDENCE));
  assert.doesNotThrow(() => buildCurves(JSON.parse(EVIDENCE.toString('utf8')).rows, map));
});

test('hiding a point hides it on every sibling curve of the same model, never on another model', () => {
  const rows = [ev(OPUS, 'H1', 'max', 70), ev(OPUS, 'H1', 'xhigh', 68), ev(OPUS, 'H2', 'max', 60), ev(OPUS, 'H2', 'xhigh', 59),
    ev(REF, 'H2', 'xhigh', 50), ev(REF, 'H2', 'max', 52)];
  const curves = buildCurves(rows, siblingDoc(['g', ['H1', 'H2']]));
  const hidden = hidePoint(curves, curveKey('anthropic', OPUS, 'H1'), 'xhigh');
  assert.deepEqual(hidden.get(curveKey('anthropic', OPUS, 'H1')).points, {max: 70});
  assert.deepEqual(hidden.get(curveKey('anthropic', OPUS, 'H2')).points, {max: 60});
  assert.deepEqual(hidden.get(curveKey('anthropic', REF, 'H2')).points, {xhigh: 50, max: 52});
  assert.deepEqual(curves.get(curveKey('anthropic', OPUS, 'H2')).points, {xhigh: 59, max: 60}); // the input is untouched
  assert.deepEqual(hideEfforts(curves, curveKey('anthropic', OPUS, 'H2'), ['xhigh', 'max']).get(curveKey('anthropic', OPUS, 'H1'))
    .points, {});
});

// ---- 2. Estimator ------------------------------------------------------------------------------
const BASE = [ev(REF, 'B', 'max', 60), ev(REF, 'B', 'xhigh', 59), ev(OPUS, 'B', 'max', 70),
  ev(OPUS, 'C', 'max', 50), ev(OPUS, 'C', 'xhigh', 47), ev(OPUS, 'D', 'max', 40), ev(OPUS, 'D', 'xhigh', 35),
  ev(OPUS, 'E', 'max', 1800, {unit: 'Elo'}), ev(OPUS, 'E', 'xhigh', 1500, {unit: 'Elo'})];

test('estimator: anchor + median of the reference, model and family deltas, one unit class only', () => {
  const result = estimate(BASE, OPUS, 'B', 'xhigh');
  // (i) reference B: 59-60 = -1; (ii) Opus C, D: -3, -5 -> -4 (the Elo curve's -300 never enters);
  // (iii) family R/B, C, D: -1, -3, -5 -> -3; median(-1, -4, -3) = -3.
  assert.deepEqual(result.anchors[0].components, {reference: -1, model: -4, family: -3});
  assert.deepEqual(result.anchors[0].counts, {reference: 1, model: 2, family: 3});
  assert.equal(result.estimable, true);
  close(result.score, 67, 'estimate');
  assert.deepEqual([result.distance, result.mode, result.kind], [1, 'extrapolation', 'down_from_top']);
  const two = estimate(BASE.filter(row => !(row.model === REF)), OPUS, 'B', 'xhigh');
  assert.deepEqual(two.anchors[0].components, {reference: null, model: -4, family: -4});
  close(two.score, 66, 'two components');
});

test('estimator: interpolation, situations (down_from_top / down / up) and the 0-100 clamp', () => {
  const rows = [...BASE, ev(OPUS, 'F', 'high', 30), ev(OPUS, 'F', 'max', 40), ev(REF, 'G', 'high', 10), ev(REF, 'G', 'xhigh', 12)];
  const result = estimate(rows, OPUS, 'F', 'xhigh');
  assert.deepEqual(result.anchors.map(anchor => anchor.anchor), ['high', 'max']);
  close(result.anchors[0].estimate, 32, 'from high');
  close(result.anchors[1].estimate, 36.5, 'from max');
  close(result.score, 34.25, 'mean');
  assert.deepEqual([result.distance, result.mode, result.kind], [1, 'interpolation', 'interpolation']);
  // An anchor above with a higher published effort beyond it is plain `down`; below the target is `up`.
  const curve = [ev(OPUS, 'K', 'medium', 50), ev(OPUS, 'K', 'max', 60), ev(OPUS, 'L', 'low', 10), ev(OPUS, 'L', 'medium', 20),
    ev(OPUS, 'L', 'xhigh', 25), ev(OPUS, 'L', 'max', 30)];
  assert.equal(estimate(curve, OPUS, 'K', 'low').kind, 'down');
  assert.equal(estimate([ev(OPUS, 'K', 'medium', 50), ev(OPUS, 'L', 'medium', 20), ev(OPUS, 'L', 'max', 30)], OPUS, 'K', 'max').kind, 'up');
  // A % estimate never leaves 0-100; Elo is not clamped.
  const high = estimate([ev(OPUS, 'P', 'low', 98), ev(OPUS, 'Q', 'low', 10), ev(OPUS, 'Q', 'medium', 30)], OPUS, 'P', 'medium');
  assert.deepEqual([high.score, high.anchors[0].clamped], [100, true]);
  const elo = estimate([ev(OPUS, 'P', 'low', 98, {unit: 'Elo'}), ev(OPUS, 'Q', 'low', 10, {unit: 'Elo'}),
    ev(OPUS, 'Q', 'medium', 30, {unit: 'Elo'})], OPUS, 'P', 'medium');
  assert.equal(elo.score, 118);
});

test('estimator: no component, ultra and lower-is-better', () => {
  const lonely = estimate([ev(OPUS, 'B', 'max', 70)], OPUS, 'B', 'xhigh');
  assert.equal(lonely.estimable, false);
  assert.equal(lonely.score, null);
  assert.equal(estimate(BASE, OPUS, 'B', 'ultra'), null);
  const lb = estimate([ev(REF, 'err', 'max', 5, {lb: true}), ev(REF, 'err', 'xhigh', 6, {lb: true}),
    ev(OPUS, 'err', 'max', 4, {lb: true})], OPUS, 'err', 'xhigh');
  assert.equal(lb.anchors[0].components.reference, -1);
  close(lb.score, 5, 'lower-is-better estimate');
  assert.equal(lb.unit_class, 'points_lower_better');
});

// ---- 3. Back-test and margins --------------------------------------------------------------------
test('back-test: neighbourhood at every distance, max-only, siblings hidden, identical hold-outs counted once', () => {
  const rows = [ev(OPUS, 'C', 'low', 40), ev(OPUS, 'C', 'medium', 44), ev(OPUS, 'C', 'high', 47), ev(OPUS, 'C', 'max', 50),
    ev(OPUS, 'S', 'high', 30), ev(OPUS, 'S', 'max', 33), ev(OPUS, 'T', 'high', 70), ev(OPUS, 'T', 'max', 72)];
  const curves = buildCurves(rows, siblingDoc(['g', ['S', 'T']]));
  const samples = backTest(curves, REFERENCES);
  const of = (benchmark, effort, scenario, distance) => samples.filter(sample => sample.benchmark === benchmark &&
    sample.effort === effort && sample.scenarios.includes(scenario) && (distance === undefined || sample.distance === distance));
  // C low (C has no xhigh): d1 from medium, d2 from high (medium hidden too), d4 from max; the max-only
  // hold-out is the same as the d4 one and is counted once under both names.
  assert.deepEqual(of('C', 'low', 'neighbourhood').map(sample => [sample.distance, sample.kind]),
    [[1, 'down'], [2, 'down'], [4, 'down_from_top']]);
  const maxOnly = of('C', 'low', 'top_only');
  assert.equal(maxOnly.length, 1);
  assert.deepEqual([maxOnly[0].distance, maxOnly[0].scenarios, maxOnly[0].hidden], [4, ['neighbourhood', 'top_only'],
    ['low', 'medium', 'high']]);
  assert.deepEqual(of('C', 'low', 'neighbourhood', 2)[0].hidden, ['low', 'medium']);
  // S high hidden also hides T high (same model, same group): only C's high<-max delta (-3) is left,
  // so the estimate is 33 - 3 = 30. Without the sibling map T's -2 would leak in: 33 - 2.5 = 30.5.
  const s = of('S', 'high', 'neighbourhood', 2)[0];
  assert.deepEqual([s.estimate, s.signed_error], [30, 0]);
  const leaky = backTest(buildCurves(rows), REFERENCES).find(sample => sample.benchmark === 'S' && sample.effort === 'high' &&
    sample.distance === 2);
  assert.equal(leaky.estimate, 30.5);
  // Unique (curve, effort, hidden set).
  const keys = samples.map(sample => [sample.benchmark, sample.effort, sample.hidden.join(',')].join('|'));
  assert.equal(new Set(keys).size, keys.length);
});

test('cell statistics: nearest-rank p95, a deterministic cluster-bootstrap upper bound, clusters counted', () => {
  assert.equal(nearestRank([...Array(25).keys()].map(i => i + 1), 95), 24);
  assert.equal(nearestRank([...Array(19).keys()].map(i => i + 1), 95), 19); // thin: the maximum
  const samples = [...Array(30).keys()].map(i => ({cluster: 'c' + (i % 12), signed_error: (i % 2 ? -1 : 1) * (i % 7)}));
  const a = cellStats(samples, 'x'), b = cellStats(samples, 'x');
  assert.deepEqual(a, b);
  assert.equal(a.n_points, 30);
  assert.equal(a.n_clusters, 12);
  assert.equal(a.p95_abs, 6);
  assert(a.ucb95 >= a.p95_abs);
  assert(a.ci90[0] <= a.ci90[1]);
  const one = cellStats([{cluster: 'only', signed_error: 3}, {cluster: 'only', signed_error: -5}], 'y');
  assert.deepEqual([one.n_clusters, one.p95_abs, one.ucb95, one.mean_signed, one.over_estimates], [1, 5, 5, -1, 1]);
  assert.deepEqual(cellStats([], 'z'), {n_points: 0, n_clusters: 0, p95_abs: null, ucb95: null});
});

test('margins: one cell per situation, non-decreasing in distance, none below the cluster minimum', () => {
  const sample = (distance, kind, error, cluster) => ({estimable: true, unit_class: 'points', distance, kind,
    scenarios: ['neighbourhood'], signed_error: error, abs_error: Math.abs(error), cluster});
  const many = (distance, kind, error, clusters = MIN_CLUSTERS) =>
    [...Array(clusters).keys()].map(i => sample(distance, kind, error, kind + distance + ':' + i));
  const samples = [...many(1, 'down_from_top', 3), ...many(1, 'down', 30), ...many(2, 'down_from_top', 2),
    ...many(1, 'up', 1, MIN_CLUSTERS - 1)];
  const margins = marginsFrom(samples);
  assert.equal(margins.points[1].margin.down_from_top, 3); // the collapses in `down` never widen it
  assert.equal(margins.points[1].margin.down, 30);
  assert.equal(margins.points[2].margin.down_from_top, 3); // non-decreasing
  assert.equal(margins.points[1].margin.up, null); // 9 clusters: not adoptable
  assert.equal(margins.points[1].margin.interpolation, null);
  assert.equal(margins.points[2].margin.down, null); // no cell at d2: not adoptable
  assert.equal(marginFor(margins, {unit_class: 'points', distance: 1, kind: 'down_from_top'}), 3);
  assert.equal(marginFor(margins, {unit_class: 'elo', distance: 1, kind: 'down_from_top'}), null);
});

// ---- 4. Adoption ------------------------------------------------------------------------------------
const MARGINS = margin => ({points: {1: {margin: Object.fromEntries(KINDS.map(kind => [kind, margin]))}}});
const COSTS = (table = {}, order = {}) => ({cost: (model, effort) => ({usd: table[model + '@' + effort] ?? 1, basis: 'stub',
  common: null}), compare: (a, b) => a.model === b.model && a.effort === b.effort ? 'same' : order[a.model + '@' + a.effort] ?? 'unresolved'});
function adopt(rows, {margin = 5, costs = COSTS(), blockers = true} = {}) {
  return qualifyCategoryEstimated(rows, {category: 'math', reference: REF, dispatch: {model: REF, effort: 'max'},
    references: REFERENCES, curves: buildCurves(rows), margins: MARGINS(margin), costs, blockers});
}
const names = result => result.qualifying.map(row => row.model + '@' + row.effort + ':' + row.basis);
const reasonOf = (result, model, effort) => result.rejected.find(row => row.model === model && row.effort === effort)?.reason;
const ADOPT = [ev(REF, 'A', 'max', 80), ev(REF, 'B', 'max', 50), ev(OPUS, 'A', 'max', 90), ev(OPUS, 'A', 'xhigh', 88),
  ev(OPUS, 'B', 'max', 60)];

test('adoption: published >= bar, or estimate - margin >= bar, on EVERY shared benchmark', () => {
  const result = adopt(ADOPT, {costs: COSTS({[OPUS + '@xhigh']: 2, [OPUS + '@max']: 3})});
  // Opus@xhigh B: 60 + (model A max->xhigh -2, family -2) = 58; 58 - 5 = 53 >= 50.
  assert.deepEqual(names(result).sort(), [OPUS + '@max:published', OPUS + '@xhigh:estimated']);
  const xhigh = result.qualifying.find(row => row.effort === 'xhigh');
  assert.equal(xhigh.basis_label, 'estimated(±5 points)');
  const b = xhigh.benchmarks.find(entry => entry.benchmark === 'B');
  assert.deepEqual([b.source, b.score, b.margin, b.lower_bound, b.reference_score, b.delta, b.kind],
    ['estimated', 58, 5, 53, 50, 3, 'down_from_top']);
  assert.equal(xhigh.cost_vs_dispatch_reference, 'unresolved');
  const strict = adopt(ADOPT, {margin: 9});
  assert.deepEqual(names(strict), [OPUS + '@max:published']);
  assert.equal(reasonOf(strict, OPUS, 'xhigh'), 'estimate_below_reference:B');
  assert.equal(reasonOf(adopt([...ADOPT, ev(OPUS, 'B', 'xhigh', 49)]), OPUS, 'xhigh'), 'below_reference:B');
});

test('adoption: every failing benchmark is recorded; the binding one is the worst; one line per rejection', () => {
  const rows = [...ADOPT, ev(REF, 'C', 'max', 20), ev(OPUS, 'C', 'max', 21), ev(OPUS, 'A', 'medium', 70)];
  const result = adopt(rows, {margin: 9});
  const rejection = result.rejected.find(row => row.model === OPUS && row.effort === 'xhigh');
  assert.deepEqual(rejection.failures.map(failure => failure.benchmark), ['B', 'C']);
  assert.equal(rejection.binding.benchmark, 'C'); // C: 21-1.5-9 vs 20 -> -9.5; B: 58-9 vs 50 -> -1 ... worst is C
  assert.match(rejectionLine(rejection), /^claude-opus-5-5@xhigh: C est [\d.]+ − 9 = [\d.-]+ < bar 20 \(d1 down_from_top\) \(\+1 more\)$/);
  assert.equal(bindingFailure([{delta: null, benchmark: 'x'}]).benchmark, 'x');
  const published = result.rejected.find(row => row.model === OPUS && row.effort === 'medium');
  assert.match(rejectionLine(published), /A published 70 < bar 80/);
});

test('adoption: the dispatch reference is never a candidate; its model\'s other efforts need a resolved lower cost', () => {
  const rows = [ev(REF, 'A', 'max', 80), ev(REF, 'A', 'xhigh', 81), ev(REF, 'B', 'max', 50), ev(REF, 'B', 'xhigh', 52)];
  const unresolved = adopt(rows);
  assert.deepEqual(names(unresolved), []);
  assert.equal(reasonOf(unresolved, REF, 'xhigh'), 'reference_model_not_resolved_cheaper:unresolved');
  assert.equal(reasonOf(unresolved, REF, 'max'), undefined);
  assert.deepEqual(names(adopt(rows, {costs: COSTS({}, {[REF + '@xhigh']: 'cheaper'})})), [REF + '@xhigh:published']);
});

test('adoption: the bar is the reference best at any effort; no curve is not shared; no component or margin fails', () => {
  assert.equal(reasonOf(adopt([...ADOPT, ev(REF, 'A', 'xhigh', 89)]), OPUS, 'xhigh'), 'below_reference:A');
  const sonnet = adopt([...ADOPT, ev(SONNET, 'A', 'max', 81)]);
  assert(names(sonnet).includes(SONNET + '@max:published'));
  assert.deepEqual(sonnet.qualifying.find(row => row.model === SONNET).benchmarks.map(e => e.benchmark), ['A']);
  const lonely = adopt([...ADOPT, ev(OPUS, 'A', 'high', 85, {status: 'single_source'})]);
  assert.equal(reasonOf(lonely, OPUS, 'high'), 'unestimable:A');
  const far = adopt([ev(REF, 'A', 'max', 80), ev(REF, 'B', 'max', 50), ev(OPUS, 'A', 'max', 90), ev(OPUS, 'A', 'medium', 88),
    ev(OPUS, 'B', 'max', 60)]);
  assert.equal(reasonOf(far, OPUS, 'medium'), 'no_margin:B');
});

test('adoption: blockers A and B still remove an otherwise estimated row', () => {
  const rising = [ev(REF, 'A', 'max', 80), ev(REF, 'B', 'max', 50), ev(OPUS, 'A', 'max', 90), ev(OPUS, 'A', 'xhigh', 95),
    ev(OPUS, 'B', 'max', 49)];
  const b = adopt(rising, {margin: 1});
  assert.equal(reasonOf(b, OPUS, 'xhigh'), 'below_reference_at_higher_effort:B@max');
  assert.deepEqual(b.blocked, [{model: OPUS, effort: 'xhigh', reason: 'below_reference_at_higher_effort:B@max'}]);
  assert.deepEqual(names(adopt(rising, {margin: 1, blockers: false})), [OPUS + '@xhigh:estimated']);
  const a = adopt([...ADOPT, ev(OPUS, 'B', 'xhigh', 45, {status: 'single_source'})]);
  assert.equal(reasonOf(a, OPUS, 'xhigh'), 'unconfirmed_below_reference:B');
});

test('adoption: a lower-is-better benchmark compares estimate + margin with the bar', () => {
  const rows = [ev(REF, 'err', 'max', 5, {lb: true}), ev(REF, 'err', 'xhigh', 6, {lb: true}),
    ev(OPUS, 'err', 'max', 3, {lb: true}), ev(OPUS, 'X', 'max', 90), ev(OPUS, 'X', 'xhigh', 90)];
  const lbMargins = margin => ({points_lower_better: {1: {margin: Object.fromEntries(KINDS.map(kind => [kind, margin]))}}});
  const run = margin => qualifyCategoryEstimated(rows, {category: 'math', reference: REF, references: REFERENCES,
    curves: buildCurves(rows), margins: lbMargins(margin), costs: COSTS()});
  // Opus err @xhigh (goodness = -score): reference -1 only (X is another unit class now): estimate 4; 4 + 1 = 5 <= 5.
  const entry = run(1).qualifying.find(row => row.effort === 'xhigh').benchmarks.find(e => e.benchmark === 'err');
  assert.deepEqual([entry.score, entry.lower_bound, entry.reference_score, entry.lower_is_better, entry.delta], [4, 5, 5, true, 0]);
  assert.equal(reasonOf(run(2), OPUS, 'xhigh'), 'estimate_below_reference:err');
});

// ---- 5. Cost ------------------------------------------------------------------------------------------
const costRows = [ev(OPUS, 'TB', 'medium', 50, {cost: 1}), ev(OPUS, 'TB', 'max', 60, {cost: 4}),
  ev(OPUS, 'CB', 'medium', 50, {cost: 1}), ev(OPUS, 'CB', 'max', 60, {cost: 6}), ev(REF, 'TB', 'max', 55, {cost: 8}),
  ev(SONNET, 'TB', 'max', 50, {cost: 4}), ev(SONNET, 'CB', 'max', 50, {cost: 6}),
  ev(SONNET, 'XX', 'low', 10), ev('gpt-6-astra', 'O', 'ultra', 1, {provider: 'openai', cost: 1})];
const snapshot = cells => ({schema: 2, kind: 'routing_ledger_usage_snapshot', cells});
const obs = (output, input = 30000, read = 20000, write = 0) => [input, read, write, output];
const model = cells => costModel({evidence: {rows: costRows}, prices, snapshot: snapshot(cells)});

test('cost: observed stratum (n >= 3, probes out, never pooled across surfaces) with its full request cost', () => {
  const costs = model([{surface: 'claude', model: OPUS, effort: 'medium', observations: [obs(5), obs(1000), obs(1000), obs(2000)]},
    {surface: 'claude-chat', model: OPUS, effort: 'medium', observations: [obs(9000), obs(9000)]}]);
  const medium = costs.cost(OPUS, 'medium');
  // 10k x $4 + 20k x $0.2 + 1,000 x $20 per 1M; the chat stratum (n = 2) is reported, never pooled in.
  assert.deepEqual([medium.basis, medium.stratum, medium.n, medium.median_output_tokens, medium.usd],
    ['ledger_observed', 'claude', 3, 1000, 0.064]);
  // Observed request: 10k uncached x $4 + 20k cached x $0.2 + 1,000 x $20.
  assert.equal(medium.observed_request_usd, 0.064);
  assert.deepEqual(medium.strata.map(stratum => [stratum.surface, stratum.n, stratum.excluded_probe]).sort(),
    [['claude', 3, 1], ['claude-chat', 2, 0]]);
  assert.deepEqual(medium.common.range, [0.064, 0.064]);
});

test('cost: the common basis scales OUTPUT only, pools every same-provider anchor by n and keeps the ratio range', () => {
  const costs = model([{surface: 'claude', model: OPUS, effort: 'medium', observations: [obs(1000), obs(1000), obs(1000)]},
    {surface: 'claude', model: REF, effort: 'max', observations: [obs(2000), obs(2000), obs(2000), obs(2000)]}]);
  const max = costs.cost(OPUS, 'max');
  assert.equal(max.basis, 'first_party_per_task_ratio');
  const [fromMedium, fromRef] = ['claude:' + OPUS + '@medium', 'claude:' + REF + '@max']
    .map(name => max.common.anchors.find(anchor => anchor.anchor === name));
  // Opus input $0.044 + medium output $0.02 x ratio 5 (TB 4, CB 6: range 4-6).
  assert.deepEqual([fromMedium.ratio, fromMedium.ratio_min, fromMedium.ratio_max, fromMedium.usd, fromMedium.low, fromMedium.high],
    [5, 4, 6, 0.144, 0.124, 0.164]);
  // Fable@max output $0.10 x (TB 4/8 = 0.5).
  assert.deepEqual([fromRef.ratio, fromRef.usd], [0.5, 0.094]);
  assert(Math.abs(max.common.usd - (3 * 0.144 + 4 * 0.094) / 7) < 1e-6, 'n-weighted');
  assert.deepEqual(max.common.range, [0.094, 0.164]);
  assert.equal(max.usd, max.common.usd);
  // Orderings: disjoint ranges only, never across providers. Fable@max: own $0.205, from Opus@medium x 8 $0.265.
  assert.deepEqual(costs.cost(REF, 'max').common.range, [0.205, 0.265]);
  assert.equal(costs.compare({model: OPUS, effort: 'max'}, {model: REF, effort: 'max'}), 'cheaper');
  assert.equal(costs.compare({model: REF, effort: 'max'}, {model: OPUS, effort: 'medium'}), 'dearer');
  // Sonnet@max (same ratios, half the input price): $0.072-$0.142 overlaps Opus@max $0.094-$0.164.
  assert.deepEqual(costs.cost(SONNET, 'max').common.range, [0.072, 0.142]);
  assert.equal(costs.compare({model: SONNET, effort: 'max'}, {model: OPUS, effort: 'max'}), 'unresolved');
  assert.equal(costs.compare({model: OPUS, effort: 'max'}, {model: 'gpt-6-astra', effort: 'ultra'}), 'unresolved_cross_provider');
  assert.equal(costs.compare({model: OPUS, effort: 'max'}, {model: OPUS, effort: 'max'}), 'same');
});

test('cost: no ratio anywhere -> list price x the ledger effort multiplier, which never orders', () => {
  const costs = model([{surface: 'codex', model: 'gpt-6-luna', effort: 'low', observations: [obs(150), obs(150), obs(150)]},
    {surface: 'codex', model: 'gpt-6.1-sol', effort: 'max', observations: [obs(15000), obs(15000), obs(15000)]}]);
  close(costs.multipliers.low.value, 0.1, 'low');
  close(costs.multipliers.max.value, 10, 'max');
  close(costs.multipliers.high.value, 1, 'high = sqrt(0.1 x 10)');
  assert.equal(costs.multipliers.ultra.basis, 'nearest_max');
  const sonnet = costs.cost(SONNET, 'low');
  assert.deepEqual([sonnet.basis, sonnet.common], ['price_table_effort_multiplier', null]);
  assert.equal(costs.compare({model: SONNET, effort: 'low'}, {model: OPUS, effort: 'max'}), 'unresolved_no_common_basis');
  assert.equal(costs.cost('local-anything', 'none').basis, 'unpriced');
  assert.throws(() => costModel({evidence: {rows: []}, prices, snapshot: {schema: 1, kind: 'routing_ledger_usage_snapshot', cells: []}}),
    /ledger_snapshot_invalid/);
});

test('ledger snapshot: only surface, model, effort and usage token counts are read', () => {
  const lines = [{surface: 'codex', model: 'gpt-6-luna', effort: 'low', request: 'SECRET owner text', task_id: 't1', family: 'F4',
    usage: {input_tokens: 99, cache_read_tokens: 10, cache_write_tokens: 0, output_tokens: 7, provider_calls: 1}},
  {surface: 'codex', model: 'gpt-6-luna', effort: 'low', usage: {input_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0,
    output_tokens: 300, provider_calls: 1}},
  {surface: 'codex', model: 'gpt-6-luna', effort: 'low', usage: {output_tokens: 300, provider_calls: 1}},
  {surface: 'claude', model: OPUS, effort: 'medium', usage: {input_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0,
    output_tokens: 1000, provider_calls: 0}}].map(line => JSON.stringify(line)).join('\n') + '\n';
  const snap = ledgerSnapshot(lines, {sourceSha256: 'x', on: '2026-10-29'});
  assert.deepEqual([snap.schema, snap.source_records, snap.observations], [2, 4, 2]);
  assert.deepEqual(snap.cells, [{surface: 'codex', model: 'gpt-6-luna', effort: 'low', observations: [[99, 10, 0, 7], [50, 0, 0, 300]]}]);
  const text = JSON.stringify(snap);
  assert(!text.includes('SECRET') && !text.includes('t1') && !text.includes('F4'));
  const committed = JSON.parse(SNAPSHOT.toString('utf8'));
  assert.deepEqual(committed.fields_read, ['surface', 'model', 'effort', 'usage.input_tokens', 'usage.cache_read_tokens',
    'usage.cache_write_tokens', 'usage.output_tokens', 'usage.provider_calls']);
});

// ---- The committed candidate and the real verdicts --------------------------------------------------
const ALL = estimateAll(EVIDENCE, SIBLINGS, PRICES, SNAPSHOT);

test('the committed candidate is exactly the script output; the shipped table is untouched', () => {
  assert.equal(CANDIDATE.toString('utf8'), canonical(compileEstimatedTable(EVIDENCE, SIBLINGS, PRICES, SNAPSHOT)));
  const candidate = JSON.parse(CANDIDATE.toString('utf8'));
  assert.equal(candidate.status, 'candidate_not_shipped');
  assert.equal(candidate.evidence_sha256, sha(EVIDENCE));
  assert.equal(candidate.sibling_map_sha256, sha(SIBLINGS));
  assert.equal(candidate.price_table_sha256, sha(PRICES));
  assert.equal(candidate.ledger_snapshot_sha256, sha(SNAPSHOT));
  assert.equal(SHIPPED.toString('utf8'), canonical(compileTable(EVIDENCE, PRICES)));
  assert.notEqual(sha(CANDIDATE), sha(SHIPPED));
  const swift = readFileSync(join(ROOT, 'Sources/OS1Context/ModelCapabilityTable.swift'), 'utf8');
  assert(swift.includes('public static let compiledSHA256 = "' + sha(SHIPPED) + '"'));
  assert(!swift.includes(sha(CANDIDATE)));
  assert.throws(() => estimateAll(EVIDENCE, Buffer.from(JSON.stringify({...JSON.parse(SIBLINGS.toString('utf8')),
    evidence_sha256: 'x'})), PRICES, SNAPSHOT), /sibling_map_evidence_mismatch/);
});

test('the back-test covers every confirmed multi-effort curve; margins are measured by situation', () => {
  assert.equal(ALL.multiCurves, 79);
  const points = ALL.samples.filter(sample => sample.unit_class === 'points' && sample.estimable);
  assert(points.every(sample => sample.scenarios.length >= 1 && typeof sample.cluster === 'string'));
  // No % estimate leaves 0-100 (ExploitBench, saturated at 100).
  assert(points.every(sample => sample.estimate >= 0 && sample.estimate <= 100));
  const m = ALL.margins.points;
  assert.deepEqual(m[1].margin, {down_from_top: 12.7, down: 36.29, up: 12.7, interpolation: 5.65});
  assert.deepEqual(m[2].margin, {down_from_top: 24.82, down: 36.29, up: 24.8, interpolation: 22.5475});
  assert.deepEqual(m[3].margin, {down_from_top: 29.4, down: 49.95, up: 29.34, interpolation: null});
  assert.deepEqual(m[4].margin, {down_from_top: 53.06, down: null, up: 53.06, interpolation: null});
  for (const distance of [1, 2, 3, 4]) for (const kind of KINDS)
    if (m[distance].margin[kind] !== null) assert(m[distance][kind].n_clusters >= MIN_CLUSTERS);
  // Elo and lower-is-better curves rest on too few independent curves: never adoptable.
  for (const unit of ['elo', 'points_lower_better']) for (const row of Object.values(ALL.margins[unit]))
    assert(Object.values(row.margin).every(value => value === null));
  // The reviewer's near miss (Opus@max on the internal agentic-coding benchmark, d3 up) now fails by far.
  const internal = ALL.categories.coding.pools.anthropic_shared.rejected.find(row => row.model === OPUS && row.effort === 'max')
    .failures.find(failure => failure.benchmark.startsWith('Internal agentic-coding'));
  assert.deepEqual([internal.score, internal.margin, internal.distance, internal.kind], [94.275, 29.34, 3, 'up']);
  assert(internal.lower_bound < 84.2 - 15);
});

test('the estimator against the single-source and disputed scores it never uses', () => {
  const {summary, checks} = ALL.external;
  assert.deepEqual([summary.points, summary.over_estimates, summary.outside_margin], [17, 13, 0]);
  assert(summary.mean_signed > 0);
  assert(checks.every(check => check.status !== 'confirmed'));
  assert.deepEqual(externalCheck([ev(OPUS, 'B', 'xhigh', 60, {status: 'disputed'})], buildCurves(BASE), REFERENCES, MARGINS(4))
    .checks.map(check => [check.estimate, check.signed_error, check.margin, check.within_margin]), [[67, 7, 4, false]]);
});

test('the O1 verdicts on the committed evidence, and their effect on the shipped table', () => {
  const rows = (domain, pool) => ALL.categories[domain].pools[pool].qualifying.map(row => row.model + '@' + row.effort + ':' + row.basis);
  assert.deepEqual(rows('knowledge', 'anthropic_shared'), [OPUS + '@max:published']);
  assert.deepEqual(rows('science', 'anthropic_shared'), [OPUS + '@max:published']);
  assert.deepEqual(rows('math', 'anthropic_shared').sort(), [OPUS + '@max:published', SONNET + '@max:published']);
  assert.deepEqual(rows('tool_use', 'anthropic_shared'), [OPUS + '@max:published']);
  assert.deepEqual(rows('coding', 'anthropic_shared'), []);
  // gpt-6-astra@xhigh holds the GDP.pdf bar itself; it is not resolved cheaper than astra@ultra: out.
  assert.deepEqual(rows('writing', 'openai_codex'), []);
  assert.equal(reasonOf(ALL.categories.writing.pools.openai_codex, 'gpt-6-astra', 'xhigh'),
    'reference_model_not_resolved_cheaper:unresolved');
  for (const domain of ['knowledge', 'science', 'math', 'coding', 'tool_use']) assert.deepEqual(rows(domain, 'openai_codex'), []);
  assert.deepEqual(ALL.broad.pools, {anthropic_shared: [], openai_codex: []});
  const comparison = shippedComparison(ALL, JSON.parse(SHIPPED.toString('utf8')));
  assert.deepEqual(comparison.added, []);
  assert.deepEqual(comparison.removed.map(item => item.domain + ':' + item.cell), ['coding:' + OPUS + '@high',
    'coding:' + OPUS + '@max', 'coding:' + OPUS + '@medium']);
  const example = workedExample(ALL);
  assert.deepEqual([example.estimate, example.margin, example.kind, example.qualifies], [62.6, 12.7, 'down_from_top', false]);
});

// ---- The owner fixed-question table ---------------------------------------------------------------------
test('family policy: no effort floor anywhere; capability families carry the written binding rule', () => {
  for (const policy of Object.values(FAMILY_POLICY)) {
    assert(!('min_effort' in policy));
    if (policy.kind === 'capability') assert.equal(policy.binding, CAPABILITY_BINDING_RULE);
  }
});

test('owner rule: references compete; only a resolved-cheaper cell replaces the default; unresolved is an owner decision', () => {
  const pool = qualifying => ({qualifying, rejected: [], blocked: []});
  const cell = (model, effort) => ({model, effort, basis: 'published', margin: null});
  const categories = {knowledge: {pools: {openai_codex: pool([cell('gpt-6.1-sol', 'high')]), anthropic_shared: pool([cell(OPUS, 'max')])}},
    science: {pools: {openai_codex: pool([cell('gpt-6.1-sol', 'high')]), anthropic_shared: pool([cell(OPUS, 'max')])}},
    coding: {pools: {openai_codex: pool([]), anthropic_shared: pool([])}}};
  const costTable = {'gpt-6.1-sol@high': 0.05, 'gpt-6-astra@ultra': 0.2, [OPUS + '@max']: 0.1, [REF + '@max']: 0.9};
  const order = (a, b) => a.model === b.model && a.effort === b.effort ? 'same' :
    a.model.startsWith('gpt') && b.model.startsWith('gpt') ? (costTable[a.model + '@' + a.effort] < costTable[b.model + '@' + b.effort] ?
      'cheaper' : 'dearer') : 'unresolved_cross_provider';
  const all = {categories, prices, costs: {cost: (m, e) => ({usd: costTable[m + '@' + e] ?? 0.01, basis: 'stub',
    common: {usd: costTable[m + '@' + e] ?? 0.01, range: [0, 1]}}), compare: order, probe_output_tokens: 5, strata: []}};
  const table = ownerTable(all);
  const row = n => table.rows.find(item => item.n === n);
  // F4: Sol@high is resolved cheaper than astra@ultra -> it binds; Opus@max (cheaper by point, other provider) does not.
  assert.deepEqual([row(2).chosen, row(2).basis, row(2).binding], ['codex:gpt-6.1-sol@high', 'published',
    'resolved cheaper than the default reference']);
  assert.match(row(2).owner_decision, /claude-chat:claude-opus-5-5@max qualifies \(published\).*unresolved_cross_provider/);
  // F6/F7: nothing qualifies -> the default reference, with the Anthropic reference listed, not chosen.
  assert.deepEqual([row(5).chosen, row(5).basis, row(5).owner_decision], ['codex:gpt-6-astra@ultra', 'reference', null]);
  assert(row(6).alternatives.some(item => item.tuple === 'claude:claude-fable-5-1@max' && item.kind === 'reference'));
});

test('owner table: 16 questions, #9 asks back locally (O2), capability rows bind the default reference', () => {
  const replay = [{request: '1-1은 뭐냐?', route: 'calculator:0', basis: 'zero_model'},
    {request: 'README.md 설명해줘', route: 'codex:gpt-6-astra/ultra', basis: 'reference', scope: 'read_only'},
    {request: '백프로 로직 설명해 봐', route: 'claude-chat:claude-opus-5-5/max', basis: 'delta0'}];
  const production = {execution_profiles: {a: {provider: 'claude', model: OPUS, effort: 'max'},
    b: {provider: 'codex', model: 'gpt-6-astra', effort: 'ultra'}}};
  const table = ownerTable(ALL, {replay, production});
  assert.equal(table.rows.length, 16);
  assert.deepEqual(table.rows.map(row => row.n), OWNER_FIXED_QUESTIONS.map(q => q.n));
  const row = n => table.rows.find(item => item.n === n);
  assert.deepEqual([row(9).family, row(9).chosen, row(9).basis, row(9).expected_cost_usd],
    ['F10-ask', 'local:qwen3.5:9b', 'owner_decision:O2', 0]);
  assert.match(row(8).chosen, /^fan-out local:qwen3\.5:9b ‖ codex:gpt-6-luna@low ‖ /);
  for (const n of [2, 3, 4, 16]) {
    assert.deepEqual([row(n).chosen, row(n).basis, row(n).signed], ['codex:gpt-6-astra@ultra', 'reference', true]);
    assert.match(row(n).owner_decision, /^claude-chat:claude-opus-5-5@max qualifies \(published\)/);
    assert(row(n).binding_rejections.some(line => line.startsWith('science: nearest estimated miss claude-opus-5-5@xhigh')));
  }
  for (const n of [5, 6]) assert.deepEqual([row(n).chosen, row(n).basis, row(n).owner_decision],
    ['codex:gpt-6-astra@ultra', 'reference', null]);
  assert.deepEqual([row(15).chosen, row(15).expected_cost_usd], ['local:calculator -> 500000000000500000000000', 0]);
  assert.deepEqual([row(10).route_446, row(1).route_446, row(16).route_446], ['codex:gpt-6-astra@ultra', 'calculator:0', null]);
  assert.deepEqual(row(3).route_446_cost_range_usd, ALL.costs.cost(OPUS, 'max').common.range);
  const point = table.totals.sensitivity.point;
  const sum = table.rows.reduce((total, item) => total + item.expected_cost_usd, 0);
  assert(Math.abs(sum - point.new_usd) < 1e-6);
  assert(table.totals.sensitivity.low.ratio_446_to_all_reference < table.totals.sensitivity.high.ratio_446_to_all_reference);
  assert.equal(table.totals.route_446_with_observed_opus_max_explanation.output_tokens, 20104);
  assert.deepEqual(route446([{request: 'x', route: 'local:qwen3.5:9b/none'}], 'x').route, 'local:qwen3.5:9b@none');
  assert.equal(signedTuple(production, 'claude-chat', OPUS, 'max'), true);
  assert.equal(signedTuple(production, 'claude-chat', OPUS, 'xhigh'), false);
});

test('report files: the owner table names the removals, the worked example and the binding rejections', () => {
  const {files} = reportFiles(ALL, {replay: [], production: null, shipped: JSON.parse(SHIPPED.toString('utf8'))});
  const markdown = files['owner-table.md'];
  assert.match(markdown, /O1 added 0 cells; it removed coding\/anthropic_shared claude-opus-5-5@high/);
  assert.match(markdown, /coding: removed claude-opus-5-5@max: Internal agentic-coding benchmark/);
  assert.match(markdown, /does not qualify \(DESIGN-6 O1 expected it to\)/);
  assert.match(markdown, /NOT assumed missing at random/);
  for (const name of ['backtest.json', 'margins.json', 'external-check.json', 'qualifying-cells.json', 'costs.json',
    'owner-table.json', 'shipped-vs-o1.json', 'point-estimate-diagnostic.json', 'inputs.json'])
    assert.doesNotThrow(() => JSON.parse(files[name]), name);
});
