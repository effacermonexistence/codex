// DESIGN-6 O1 (owner decision 2026-10-29): inductive effort-curve estimation
// for the capability table (scripts/effort-curve-estimator.mjs), its
// leave-one-out back-test and margins, the adoption rule (delta 0 against the
// reference's best confirmed score, estimate minus margin for an unpublished
// effort, blockers A/B), the effort-aware cost, the candidate file and the
// owner fixed-question table. Pure functions over small row sets and the
// committed evidence: no provider, model, network or real HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical, compileTable} from '../capability-table.mjs';
import {OWNER_FIXED_QUESTIONS, backTest, buildCurves, compileEstimatedTable, costModel, curveKey, estimateAll,
  estimatePoint, hidePoint, ledgerSnapshot, marginFor, marginsFrom, nearestRank, ownerTable, qualifyCategoryEstimated,
  route446, signedTuple} from '../effort-curve-estimator.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const EVIDENCE = readFileSync(join(ROOT, 'scripts/capability-evidence-20261027.json'));
const PRICES = readFileSync(join(ROOT, 'Resources/model-price-table.json'));
const SNAPSHOT = readFileSync(join(ROOT, 'scripts/routing-ledger-usage-20261029.json'));
const CANDIDATE = readFileSync(join(ROOT, 'Resources/model-capability-table.estimate-candidate.json'));
const SHIPPED = readFileSync(join(ROOT, 'Resources/model-capability-table.json'));
const prices = JSON.parse(PRICES.toString('utf8'));

const REF = 'claude-fable-5-1', OPUS = 'claude-opus-5-5';
const REFERENCES = {anthropic: REF, openai: 'gpt-6-astra'};
const ev = (model, benchmark, level, score, {status = 'confirmed', lb = false, cost = null, category = 'math',
  provider = 'anthropic', unit = '%'} = {}) => ({provider, category, benchmark, model, reasoning_level: level, score,
  status, sources: ['https://www.anthropic.com/fixture'], cost, note: '', lower_better: lb, unit});
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
const estimate = (rows, model, benchmark, effort, provider = 'anthropic') =>
  estimatePoint(buildCurves(rows), {key: curveKey(provider, model, benchmark), effort, references: REFERENCES});

// ---- 1. Curves -------------------------------------------------------------------------------
test('curves: confirmed scores at dispatchable efforts only; lower-is-better stored as goodness', () => {
  const curves = buildCurves([ev(OPUS, 'B', 'max', 70), ev(OPUS, 'B', 'xhigh', 66, {status: 'single_source'}),
    ev(OPUS, 'B', 'unspecified', 75), ev(OPUS, 'B', 'medium (API default)', 60), ev(OPUS, 'err', 'max', 4, {lb: true}),
    ev(OPUS, 'elo', 'max', 1800, {unit: 'Elo'})]);
  assert.deepEqual(curves.get(curveKey('anthropic', OPUS, 'B')).points, {max: 70, medium: 60});
  assert.deepEqual(curves.get(curveKey('anthropic', OPUS, 'err')).points, {max: -4});
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'elo')).unit_class, 'elo');
  assert.equal(curves.get(curveKey('anthropic', OPUS, 'B')).unit_class, 'points');
  assert.throws(() => buildCurves([ev(OPUS, 'B', 'max', 70), ev(OPUS, 'B', 'xhigh', 66, {unit: 'Elo'})]),
    /effort_curve_inconsistent/);
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
  assert.deepEqual([result.distance, result.mode], [1, 'extrapolation']);
  // Two components -> their mean; one -> itself.
  const two = estimate(BASE.filter(row => !(row.model === REF)), OPUS, 'B', 'xhigh');
  assert.deepEqual(two.anchors[0].components, {reference: null, model: -4, family: -4});
  close(two.score, 66, 'two components');
});

test('estimator: two equidistant anchors -> the mean of both estimates (interpolation)', () => {
  const rows = [...BASE, ev(OPUS, 'F', 'high', 30), ev(OPUS, 'F', 'max', 40), ev(REF, 'G', 'high', 10), ev(REF, 'G', 'xhigh', 12)];
  const result = estimate(rows, OPUS, 'F', 'xhigh');
  assert.deepEqual(result.anchors.map(anchor => anchor.anchor), ['high', 'max']);
  // high: family R/G +2 -> 32. max: model C, D -> -4; family R/B, C, D -> -3 -> -3.5 -> 36.5.
  close(result.anchors[0].estimate, 32, 'from high');
  close(result.anchors[1].estimate, 36.5, 'from max');
  close(result.score, 34.25, 'mean');
  assert.deepEqual([result.distance, result.mode], [1, 'interpolation']);
});

test('estimator: no component, ultra and lower-is-better', () => {
  const lonely = estimate([ev(OPUS, 'B', 'max', 70)], OPUS, 'B', 'xhigh');
  assert.equal(lonely.estimable, false);
  assert.equal(lonely.score, null);
  assert.equal(estimate(BASE, OPUS, 'B', 'ultra'), null);
  // Error rate 5 -> 6 for the reference (goodness -1); Opus 4 at max -> 5 at xhigh.
  const lb = estimate([ev(REF, 'err', 'max', 5, {lb: true}), ev(REF, 'err', 'xhigh', 6, {lb: true}),
    ev(OPUS, 'err', 'max', 4, {lb: true})], OPUS, 'err', 'xhigh');
  assert.equal(lb.anchors[0].components.reference, -1);
  close(lb.score, 5, 'lower-is-better estimate');
});

// ---- 3. Back-test and margins --------------------------------------------------------------------
test('back-test: each point of a multi-point curve is hidden from the whole data set and re-estimated', () => {
  const rows = [ev(REF, 'B', 'max', 60), ev(REF, 'B', 'xhigh', 59), ev(OPUS, 'C', 'max', 50), ev(OPUS, 'C', 'xhigh', 47),
    ev(OPUS, 'B', 'max', 70)];
  const curves = buildCurves(rows);
  const samples = backTest(curves, REFERENCES);
  // Opus B has one point: never hidden. R/B and Opus C: two points each.
  assert.equal(samples.length, 4);
  const error = (model, benchmark, effort) => samples.find(s => s.model === model && s.benchmark === benchmark && s.effort === effort);
  // R/B max from xhigh: only the family delta (Opus C xhigh->max +3) -> 62, actual 60.
  assert.equal(error(REF, 'B', 'max').signed_error, 2);
  assert.equal(error(REF, 'B', 'xhigh').signed_error, -2);
  assert.equal(error(OPUS, 'C', 'max').signed_error, -2);
  assert.equal(error(OPUS, 'C', 'xhigh').signed_error, 2);
  // The hidden data set lacks exactly that point.
  const hidden = hidePoint(curves, curveKey('anthropic', REF, 'B'), 'max');
  assert.deepEqual(hidden.get(curveKey('anthropic', REF, 'B')).points, {xhigh: 59});
  assert.deepEqual(curves.get(curveKey('anthropic', REF, 'B')).points, {max: 60, xhigh: 59});
  const margins = marginsFrom(samples);
  assert.equal(margins.points[1].all.n, 4);
  assert.deepEqual(margins.points[1].margin, {extrapolation: 2, interpolation: 2});
  assert.equal(margins.points[2].margin.extrapolation, null);
});

test('margins: nearest-rank p95 (the maximum below 20 errors), max(all, mode), non-decreasing, none when empty', () => {
  assert.equal(nearestRank([...Array(25).keys()].map(i => i + 1), 95), 24);
  assert.equal(nearestRank([...Array(20).keys()].map(i => i + 1), 95), 19);
  assert.equal(nearestRank([...Array(19).keys()].map(i => i + 1), 95), 19); // thin: the maximum
  const sample = (distance, error, mode = 'extrapolation') => ({estimable: true, unit_class: 'points', distance, mode,
    signed_error: error, abs_error: Math.abs(error)});
  const samples = [...[...Array(25).keys()].map(i => sample(1, (i % 2 ? -1 : 1) * (i + 1), i < 5 ? 'extrapolation' : 'interpolation')),
    sample(2, 3), sample(2, -4), sample(4, 1)];
  const margins = marginsFrom(samples);
  assert.equal(margins.points[1].all.value, 24); // n = 25 -> p95
  assert.equal(margins.points[1].extrapolation.value, 5); // n = 5 -> max
  assert.deepEqual(margins.points[1].margin, {extrapolation: 24, interpolation: 24});
  assert.equal(margins.points[2].all.value, 4);
  assert.deepEqual(margins.points[2].margin, {extrapolation: 24, interpolation: 24}); // non-decreasing in distance
  assert.deepEqual(margins.points[3].margin, {extrapolation: null, interpolation: null}); // no errors: not adoptable
  assert.equal(marginFor(margins, {unit_class: 'points', distance: 4, mode: 'extrapolation'}), 24);
  assert.equal(marginFor(margins, {unit_class: 'elo', distance: 1, mode: 'extrapolation'}), null);
});

// ---- 4. Adoption ------------------------------------------------------------------------------------
const MARGINS = margin => ({points: {1: {margin: {extrapolation: margin, interpolation: margin}}}});
const COST = table => (model, effort) => ({usd: table[model + '@' + effort] ?? 1, basis: 'stub'});
function adopt(rows, {margin = 5, cost = {}, blockers = true} = {}) {
  return qualifyCategoryEstimated(rows, {category: 'math', reference: REF, references: REFERENCES, curves: buildCurves(rows),
    margins: MARGINS(margin), cost: COST({[REF + '@max']: 10, ...cost}), blockers});
}
const names = result => result.qualifying.map(row => row.model + '@' + row.effort + ':' + row.basis);
const reasonOf = (result, model, effort) => result.rejected.find(row => row.model === model && row.effort === effort)?.reason;
const ADOPT = [ev(REF, 'A', 'max', 80), ev(REF, 'B', 'max', 50), ev(OPUS, 'A', 'max', 90), ev(OPUS, 'A', 'xhigh', 88),
  ev(OPUS, 'B', 'max', 60)];

test('adoption: published >= bar, or estimate - margin >= bar, on EVERY shared benchmark', () => {
  const result = adopt(ADOPT, {cost: {[OPUS + '@xhigh']: 2, [OPUS + '@max']: 3}});
  // Opus@xhigh B: 60 + (model A max->xhigh -2, family -2) = 58; 58 - 5 = 53 >= 50.
  assert.deepEqual(names(result), [OPUS + '@xhigh:estimated', OPUS + '@max:published']);
  const xhigh = result.qualifying[0];
  assert.equal(xhigh.basis_label, 'estimated(±5 points)');
  assert.deepEqual(xhigh.margin, {points: 5});
  const b = xhigh.benchmarks.find(entry => entry.benchmark === 'B');
  assert.deepEqual([b.source, b.score, b.margin, b.lower_bound, b.reference_score, b.delta], ['estimated', 58, 5, 53, 50, 3]);
  assert.equal(xhigh.cheaper_than_reference, true);
  // A wider margin than the lead: rejected, though every published score clears.
  const strict = adopt(ADOPT, {margin: 9});
  assert.deepEqual(names(strict), [OPUS + '@max:published']);
  assert.equal(reasonOf(strict, OPUS, 'xhigh'), 'estimate_below_reference:B');
  // A published score below the bar fails as before.
  assert.equal(reasonOf(adopt([...ADOPT, ev(OPUS, 'B', 'xhigh', 49)]), OPUS, 'xhigh'), 'below_reference:B');
});

test('adoption: the bar is the reference best at any effort; no curve is not shared; no component or margin fails', () => {
  const higherBar = adopt([...ADOPT, ev(REF, 'A', 'xhigh', 89)]);
  assert.equal(reasonOf(higherBar, OPUS, 'xhigh'), 'below_reference:A'); // 88 < 89
  // A model without any confirmed score on B: B is not shared for it.
  const sonnet = adopt([...ADOPT, ev('claude-sonnet-5-5', 'A', 'max', 81)], {cost: {'claude-sonnet-5-5@max': 2}});
  assert(names(sonnet).includes('claude-sonnet-5-5@max:published'));
  assert.deepEqual(sonnet.qualifying.find(row => row.model === 'claude-sonnet-5-5').benchmarks.map(e => e.benchmark), ['A']);
  // An effort the model only reports unconfirmed: offered, but nothing to anchor a delta on.
  const lonely = adopt([...ADOPT, ev(OPUS, 'A', 'high', 85, {status: 'single_source'})]);
  assert.equal(reasonOf(lonely, OPUS, 'high'), 'unestimable:A');
  // A distance with no back-tested margin is not adoptable.
  const far = adopt([ev(REF, 'A', 'max', 80), ev(REF, 'B', 'max', 50), ev(OPUS, 'A', 'max', 90), ev(OPUS, 'A', 'medium', 88),
    ev(OPUS, 'B', 'max', 60)]);
  assert.equal(reasonOf(far, OPUS, 'medium'), 'no_margin:B');
});

test('adoption: blockers A and B still remove an otherwise estimated row', () => {
  // Opus A max -> xhigh +5, so B's estimate at xhigh (49 + 5 = 54, minus 1 = 53) clears 50 ...
  const rising = [ev(REF, 'A', 'max', 80), ev(REF, 'B', 'max', 50), ev(OPUS, 'A', 'max', 90), ev(OPUS, 'A', 'xhigh', 95),
    ev(OPUS, 'B', 'max', 49)];
  // ... but Opus @max is below the bar on B: blocker B (and @max itself fails on B).
  const b = adopt(rising, {margin: 1});
  assert.equal(reasonOf(b, OPUS, 'xhigh'), 'below_reference_at_higher_effort:B@max');
  assert.deepEqual(b.blocked, [{model: OPUS, effort: 'xhigh', reason: 'below_reference_at_higher_effort:B@max'}]);
  assert.deepEqual(names(adopt(rising, {margin: 1, blockers: false})), [OPUS + '@xhigh:estimated']);
  // Blocker A: an unconfirmed own value at that effort, every value below the bar.
  const a = adopt([...ADOPT, ev(OPUS, 'B', 'xhigh', 45, {status: 'single_source'})]);
  assert.equal(reasonOf(a, OPUS, 'xhigh'), 'unconfirmed_below_reference:B');
});

test('adoption: a lower-is-better benchmark compares estimate + margin with the bar', () => {
  const rows = [ev(REF, 'err', 'max', 5, {lb: true}), ev(REF, 'err', 'xhigh', 6, {lb: true}),
    ev(OPUS, 'err', 'max', 3, {lb: true}), ev(OPUS, 'X', 'max', 90), ev(OPUS, 'X', 'xhigh', 90)];
  // Opus err @xhigh (goodness = -score): reference -1, model (X) 0, family (R/err -1, X 0) -0.5 -> median -0.5:
  // estimate 3.5; 3.5 + 1 = 4.5 <= 5 qualifies; 3.5 + 2 = 5.5 does not.
  const pass = adopt(rows, {margin: 1});
  const entry = pass.qualifying.find(row => row.effort === 'xhigh').benchmarks.find(e => e.benchmark === 'err');
  assert.deepEqual([entry.score, entry.lower_bound, entry.reference_score, entry.lower_is_better, entry.delta],
    [3.5, 4.5, 5, true, 0.5]);
  assert.equal(reasonOf(adopt(rows, {margin: 2}), OPUS, 'xhigh'), 'estimate_below_reference:err');
});

// ---- 5. Cost ------------------------------------------------------------------------------------------
const costRows = [ev(OPUS, 'TB', 'medium', 50, {cost: 1}), ev(OPUS, 'TB', 'max', 60, {cost: 4}),
  ev(OPUS, 'CB', 'medium', 50, {cost: 1}), ev(OPUS, 'CB', 'max', 60, {cost: 5}), ev(REF, 'TB', 'max', 55, {cost: 8}),
  ev('claude-sonnet-5-5', 'XX', 'low', 10)];
const snapshot = cells => ({schema: 1, kind: 'routing_ledger_usage_snapshot', cells});
const model = cells => costModel({evidence: {rows: costRows}, prices, snapshot: snapshot(cells)});

test('cost: observed median output (n >= 3, probe replies out), else first-party per-task ratio, else multiplier', () => {
  const costs = model([{surface: 'claude', model: OPUS, effort: 'medium', output_tokens: [5, 1000, 1000, 2000]},
    {surface: 'claude', model: REF, effort: 'max', output_tokens: [10000, 12000]}]);
  const medium = costs.cost(OPUS, 'medium');
  // 10k x $4 + 20k x $0.2 + 1,000 x $20 per 1M.
  assert.deepEqual([medium.basis, medium.n, medium.median_output_tokens, medium.excluded_probe, medium.usd],
    ['ledger_observed', 3, 1000, 1, 0.064]);
  const max = costs.cost(OPUS, 'max');
  // Same-model anchor; ratios TB 4, CB 5 -> 4.5.
  assert.deepEqual([max.basis, max.anchor, max.ratio, max.ratio_benchmarks, max.usd],
    ['first_party_per_task_ratio', OPUS + '@medium', 4.5, ['CB', 'TB'], 0.288]);
  // n = 2 is not observed: the reference scales from the one observed cell (TB 8 / 1).
  const reference = costs.cost(REF, 'max');
  assert.deepEqual([reference.basis, reference.observed_n, reference.ratio, reference.usd], ['first_party_per_task_ratio', 2, 8, 0.512]);
  // No per-task cost anywhere: list price x the ledger multiplier (only medium observed: 1000/1500).
  const sonnet = costs.cost('claude-sonnet-5-5', 'low');
  assert.equal(sonnet.basis, 'price_table_effort_multiplier');
  close(sonnet.multiplier, 0.666667, 'multiplier');
  close(sonnet.usd, 0.032, 'multiplier usd');
  assert.equal(costs.multipliers.low.basis, 'nearest_medium');
  assert.equal(costs.cost('local-anything', 'none').basis, 'unpriced');
});

test('cost: multipliers interpolate log-linearly between observed efforts', () => {
  const costs = model([{surface: 'codex', model: 'gpt-6-luna', effort: 'low', output_tokens: [150, 150, 150]},
    {surface: 'codex', model: 'gpt-6.1-sol', effort: 'max', output_tokens: [15000, 15000, 15000]}]);
  close(costs.multipliers.low.value, 0.1, 'low');
  close(costs.multipliers.max.value, 10, 'max');
  close(costs.multipliers.high.value, 1, 'high = sqrt(0.1 x 10)');
  assert.equal(costs.multipliers.high.basis, 'log_interpolated_low_max');
  assert.equal(costs.multipliers.ultra.basis, 'nearest_max');
});

test('ledger snapshot: only surface, model, effort and usage token counts are read', () => {
  const lines = [{surface: 'codex', model: 'gpt-6-luna', effort: 'low', request: 'SECRET owner text', task_id: 't1',
    usage: {output_tokens: 7, provider_calls: 1, input_tokens: 99}},
  {surface: 'codex', model: 'gpt-6-luna', effort: 'low', usage: {output_tokens: 300, provider_calls: 1}},
  {surface: 'codex', model: 'gpt-6-luna', effort: 'low'},
  {surface: 'claude', model: OPUS, effort: 'medium', usage: {output_tokens: 1000, provider_calls: 0}}]
    .map(line => JSON.stringify(line)).join('\n') + '\n';
  const snap = ledgerSnapshot(lines, {sourceSha256: 'x', on: '2026-10-29'});
  assert.equal(snap.source_records, 4);
  assert.equal(snap.observations, 2);
  assert.deepEqual(snap.cells, [{surface: 'codex', model: 'gpt-6-luna', effort: 'low', output_tokens: [7, 300]}]);
  assert(!JSON.stringify(snap).includes('SECRET') && !JSON.stringify(snap).includes('t1'));
});

// ---- The committed candidate and the real verdicts --------------------------------------------------
const ALL = estimateAll(EVIDENCE, PRICES, SNAPSHOT);

test('the committed candidate is exactly the script output; the shipped table is untouched', () => {
  assert.equal(CANDIDATE.toString('utf8'), canonical(compileEstimatedTable(EVIDENCE, PRICES, SNAPSHOT)));
  const candidate = JSON.parse(CANDIDATE.toString('utf8'));
  assert.equal(candidate.status, 'candidate_not_shipped');
  assert.equal(candidate.evidence_sha256, sha(EVIDENCE));
  assert.equal(candidate.price_table_sha256, sha(PRICES));
  assert.equal(candidate.ledger_snapshot_sha256, sha(SNAPSHOT));
  assert.equal(SHIPPED.toString('utf8'), canonical(compileTable(EVIDENCE, PRICES)));
  assert.notEqual(sha(CANDIDATE), sha(SHIPPED));
  const swift = readFileSync(join(ROOT, 'Sources/OS1Context/ModelCapabilityTable.swift'), 'utf8');
  assert(swift.includes('public static let compiledSHA256 = "' + sha(SHIPPED) + '"'));
  assert(!swift.includes(sha(CANDIDATE)));
});

test('the back-test covers every confirmed multi-effort curve; margins are measured, not assumed', () => {
  assert.equal(ALL.multiCurves, 79);
  const by = unit => ALL.samples.filter(sample => sample.unit_class === unit);
  assert.deepEqual([by('points').length, by('points').filter(s => s.estimable).length], [332, 332]);
  assert.deepEqual([by('elo').length, by('elo').filter(s => s.estimable).length], [25, 25]);
  assert.deepEqual([by('count').length, by('count').filter(s => s.estimable).length], [2, 0]);
  assert.deepEqual(ALL.margins.points[1].margin, {extrapolation: 8.42, interpolation: 6.3});
  assert.equal(ALL.margins.points[1].all.n, 320);
  assert.deepEqual(ALL.margins.elo[2].margin, {extrapolation: null, interpolation: null});
});

test('the O1 verdicts on the committed evidence', () => {
  const rows = (domain, pool) => ALL.categories[domain].pools[pool].qualifying.map(row => row.model + '@' + row.effort + ':' + row.basis);
  assert.deepEqual(rows('knowledge', 'anthropic_shared'), [OPUS + '@max:published']);
  assert.deepEqual(rows('science', 'anthropic_shared'), [OPUS + '@max:published']);
  assert.deepEqual(rows('math', 'anthropic_shared'), [OPUS + '@max:published', 'claude-sonnet-5-5@max:published']);
  assert.deepEqual(rows('tool_use', 'anthropic_shared'), [OPUS + '@max:published']);
  // Every Opus coding row is unpublished on a coding benchmark where Opus has a
  // curve, and the back-tested margin is wider than its lead there.
  assert.deepEqual(rows('coding', 'anthropic_shared'), []);
  const coding = ALL.categories.coding.pools.anthropic_shared.rejected;
  assert.equal(reasonOf({rejected: coding}, OPUS, 'medium'), 'estimate_below_reference:DeepSWE v1.1');
  assert.equal(reasonOf({rejected: coding}, OPUS, 'max'),
    'estimate_below_reference:SWE-bench Pro subset (Anthropic 478-problem harness, docs)');
  assert.deepEqual(rows('writing', 'anthropic_shared'), []);
  assert.deepEqual(rows('writing', 'openai_codex'), ['gpt-6-astra@xhigh:published']);
  for (const domain of ['knowledge', 'science', 'math', 'coding', 'tool_use']) assert.deepEqual(rows(domain, 'openai_codex'), []);
  assert.deepEqual(ALL.broad.pools, {anthropic_shared: [], openai_codex: []});
});

// ---- The owner fixed-question table ---------------------------------------------------------------------
test('owner table: 16 questions, #9 asks back locally (O2), capability rows bind the cheapest qualifying cell', () => {
  const replay = [{request: '1-1은 뭐냐?', route: 'calculator:0', basis: 'zero_model'},
    {request: 'README.md 설명해줘', route: 'codex:gpt-6-astra/ultra', basis: 'reference', scope: 'read_only'}];
  const production = {execution_profiles: {a: {provider: 'claude', model: OPUS, effort: 'max'},
    b: {provider: 'codex', model: 'gpt-6-astra', effort: 'ultra'}}};
  const table = ownerTable(ALL, {replay, production});
  assert.equal(table.rows.length, 16);
  assert.deepEqual(table.rows.map(row => row.n), OWNER_FIXED_QUESTIONS.map(q => q.n));
  const row = n => table.rows.find(item => item.n === n);
  assert.deepEqual([row(9).family, row(9).chosen, row(9).basis, row(9).expected_cost_usd],
    ['F10-ask', 'local:qwen3.5:9b', 'owner_decision:O2', 0]);
  assert.equal(row(8).family, 'F10');
  assert.match(row(8).chosen, /^fan-out local:qwen3\.5:9b ‖ codex:gpt-6-luna@low ‖ /);
  for (const n of [2, 3, 4, 16]) assert.deepEqual([row(n).chosen, row(n).basis, row(n).signed],
    ['claude-chat:' + OPUS + '@max', 'published', true]);
  // No coding cell qualifies: F6/F7 bind the cheaper pool reference.
  for (const n of [5, 6]) assert.deepEqual([row(n).chosen, row(n).basis], ['codex:gpt-6-astra@ultra', 'reference (no cell qualifies)']);
  assert.deepEqual([row(15).chosen, row(15).expected_cost_usd], ['local:calculator -> 500000000000500000000000', 0]);
  assert.deepEqual([row(10).route_446, row(1).route_446, row(16).route_446], ['codex:gpt-6-astra@ultra', 'calculator:0', null]);
  const sum = table.rows.reduce((total, item) => total + item.expected_cost_usd, 0);
  assert(Math.abs(sum - table.totals.expected_cost_usd) < 1e-6);
  assert.deepEqual(route446([{request: 'x', route: 'local:qwen3.5:9b/none'}], 'x').route, 'local:qwen3.5:9b@none');
  assert.equal(signedTuple(production, 'claude-chat', OPUS, 'max'), true);
  assert.equal(signedTuple(production, 'claude-chat', OPUS, 'xhigh'), false);
});
