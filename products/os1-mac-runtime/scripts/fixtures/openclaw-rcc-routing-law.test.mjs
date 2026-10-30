// Build 447 (DESIGN-8, owner-approved direction 2026-10-29): the routing law.
// The compiled table (tau from data, matched-tier admission, real quota per
// cost shape, p_fail with a Laplace prior), the engine (admissible set,
// E[Q] = Q·price + p_fail x Q(repair)·price at each pool's derived exchange,
// with p_fail inherited from the reference (lead corrections 1-2), argmin) and its receipts, the
// rollback switch, local-first, the ask-back, grant invariance, and the
// durable Core (ladder, screen, ledger receipt). Pure resolver calls and a
// real durable Core with temp SQLite and a fake executor: no provider, model,
// network, real HOME or installed app. The local model is qwen3.5:9b (the
// recorded owner catalogs' local row; routing-law-replay configures it).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdtemp, readFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {lawCatalog, routeOf, clockOf, OWNER_QUESTIONS} from '../routing-law-replay.mjs';
import {ROUTING_LAW_TABLE_SHA256, ROUTING_POLICIES, routingLawTable, lawFamily, lawEvidence, lawQuota, lawPFail,
  lawPoolPrice, lawExpectedQuota, lawAskBack, lawKey, lawTiers, deliveryBasisOf, createRCCRuntime, hostPlan, resolveRoutePlan,
  hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {canonical, compileAdmission, compileFamilies, compilePFail, compileTable, compileTau, readInputs, snapshotLedger}
  from '../routing-law-table.mjs';
import {auditDeliveryPolicy} from '../route-replay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = text => createHash('sha256').update(text).digest('hex');
const OWNER = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/routing-law-owner-questions.json'), 'utf8'));
const TABLE = routingLawTable();
const question = n => OWNER.questions.find(q => q.n === n);
const lawOf = (q, mutate = c => c) => mutate(lawCatalog(q, q.intent));

// ---- The compiled table: from the data, pinned three times. ----------------
test('the table is the compiler output of the committed inputs, pinned in Core, Resources and Swift', () => {
  const bytes = canonical(compileTable(readInputs(ROOT)));
  const resource = readFileSync(join(ROOT, 'Resources/routing-law-table.json'), 'utf8');
  assert.equal(resource, bytes);
  assert.equal(sha(resource), ROUTING_LAW_TABLE_SHA256);
  const swift = readFileSync(join(ROOT, 'Sources/OS1Context/RoutingLaw.swift'), 'utf8');
  assert.match(swift, new RegExp(`public static let tableSHA256 = "${ROUTING_LAW_TABLE_SHA256}"`));
  assert.notEqual(TABLE, null);
  assert.equal(OWNER.table_sha256, ROUTING_LAW_TABLE_SHA256, 'the owner fixture was generated against this table');
  assert.deepEqual([...ROUTING_POLICIES], ['law_446', 'law_447']);
});

test('tau is measured from the data, never chosen: tier drops (n >= 3), else pooled drops, Elo discrepancies, else 0', () => {
  const tiers = {A: {pools: {anthropic: {benchmarks: [{alias: 'a', unit_kind: 'pct'}]}}},
    B: {pools: {anthropic: {benchmarks: [{alias: 'b', unit_kind: 'pct'}, {alias: 'e', unit_kind: 'elo'}]}}},
    C: {pools: {anthropic: {benchmarks: [{alias: 'c', unit_kind: 'other:x'}]}}}};
  const inversions = [{tier: 'A', unit_kind: 'pct', magnitude: 0.5}, {tier: 'A', unit_kind: 'pct', magnitude: 0.7},
    {tier: 'A', unit_kind: 'pct', magnitude: 3}, {tier: 'B', unit_kind: 'pct', magnitude: 2}];
  const tau = compileTau({tiers, inversions, replicates: [], elo_discrepancies: [{abs_diff: 4}, {abs_diff: 6}, {abs_diff: 13}]});
  assert.deepEqual([tau.A.pct.tau, tau.A.pct.basis], [0.7, 'tier_effort_adjacent_drops']);
  assert.deepEqual([tau.B.pct.tau, tau.B.pct.basis], [1.35, 'pooled_effort_adjacent_drops']);
  assert.deepEqual([tau.B.elo.tau, tau.B.elo.basis], [6, 'elo_publication_discrepancies']);
  assert.deepEqual([tau.C['other:x'].tau, tau.C['other:x'].basis], [0, 'no_drop_delta0']);
  // The compiled table: T1 (no own drop) pooled 1.2; T1F its own three drops.
  assert.equal(TABLE.tau.T1.pct.tau, 1.2);
  assert.equal(TABLE.tau.T1F.pct_error.basis, 'tier_effort_adjacent_drops');
  assert.equal(TABLE.tau.C2.pct.n >= 3 && TABLE.tau.C2.pct.basis, 'tier_effort_adjacent_drops');
});

test('admission (b): within tau of the reference best at any effort, on every published tier, with at least one', () => {
  const policy = {pools: {anthropic: 'anthropic_shared'}, references: {anthropic_shared: 'ref'}};
  const evidence = {tiers: {T: {pools: {anthropic: {reference: 'ref',
    benchmarks: [{alias: 'x', unit_kind: 'pct', lower_better: false}, {alias: 'err', unit_kind: 'pct', lower_better: true}],
    cells: [{model: 'ref', effort: 'low', scores: {x: 80, err: 5}}, {model: 'ref', effort: 'max', scores: {x: 82, err: 6}},
      {model: 'm', effort: 'high', scores: {x: 80.8, err: 5.9}}, {model: 'm', effort: 'low', scores: {x: 80.7}},
      {model: 'm', effort: 'unspecified', scores: {x: 90}}]}}}}};
  const admission = compileAdmission(evidence, {T: {pct: {tau: 1.2}}}, policy).T.anthropic_shared;
  // Best: x 82 (max), err 5 (low; lower is better).
  assert.deepEqual(admission.cells['m@high'].benchmarks.map(row => row.slice(0, 4)), [['x', 80.8, 82, 1.2], ['err', 5.9, 5, 0.9]]);
  assert.equal(admission.cells['m@high'].pass, true);
  assert.equal(admission.cells['m@low'].pass, false); // 1.3 > tau, and scored on one of two (coverage)
  assert.deepEqual(admission.cells['m@low'].coverage, [1, 2]);
  assert.equal(admission.cells['m@unspecified'], undefined); // not a dispatchable effort
  // Coverage (DESIGN-7 §1.2, review of 447): within tau on the ONE benchmark it
  // is scored on is not the tier when the pool publishes two.
  const one = compileAdmission({tiers: {T: {pools: {anthropic: {...evidence.tiers.T.pools.anthropic,
    cells: [...evidence.tiers.T.pools.anthropic.cells, {model: 'n', effort: 'high', scores: {x: 81.9}}]}}}}},
  {T: {pct: {tau: 1.2}}}, policy).T.anthropic_shared;
  assert.deepEqual([one.cells['n@high'].pass, one.cells['n@high'].coverage], [false, [1, 2]]);
  // On the compiled table: F4 = T1 + T1F.
  assert.equal(lawEvidence(TABLE, 'F4', 'anthropic_shared', 'claude-opus-5-5', 'max').form, 'b');
  assert.deepEqual(lawEvidence(TABLE, 'F4', 'anthropic_shared', 'claude-opus-5-5', 'max').tiers,
    [['T1', 'pass'], ['T1F', 'unpublished']]);
  assert.equal(lawEvidence(TABLE, 'F4', 'openai_codex', 'gpt-6.1-sol', 'max').form, 'none'); // T1F fails tau
  assert.equal(lawEvidence(TABLE, 'F4', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').form, 'none'); // unscored
  assert.equal(lawEvidence(TABLE, 'F7', 'anthropic_shared', 'claude-opus-5-5', 'medium').form, 'b');
  // W2 (four published): sonnet@xhigh is within tau on Briefcase alone: not admitted.
  assert.equal(TABLE.admission.W2.anthropic_shared.cells['claude-sonnet-5-5@xhigh'].pass, false);
  assert.equal(lawEvidence(TABLE, 'F13', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').form, 'none');
  // A coverage shortfall within tau is a gap of evidence ('short'), never evidence against.
  assert.deepEqual(lawEvidence(TABLE, 'F13', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').tiers, [['W2', 'short']]);
  assert.equal(lawEvidence(TABLE, 'F13', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').gap, true);
  assert.equal(lawEvidence(TABLE, 'F4', 'openai_codex', 'gpt-6.1-sol', 'max').gap, false); // T1F fails tau
  assert.equal(lawEvidence(TABLE, 'F13', 'anthropic_shared', 'claude-opus-5-5', 'xhigh').form, 'b');
  // No evidence is never evidence: a family whose tiers the pool never publishes.
  assert.equal(lawEvidence(TABLE, 'F5a', 'anthropic_shared', 'claude-opus-5-5', 'max').form, 'none');
  assert.equal(lawEvidence(TABLE, 'F1', 'anthropic_shared', 'claude-opus-5-5', 'max').form, 'none');
});

test('E[Q]: real quota per cost shape, priced at the derived exchange; p_fail inherited from the reference (corrections 1, 2)', () => {
  const row = (surface, model, effort) => ({surface, model, effort});
  const opus = lawQuota(TABLE, row('claude-chat', 'claude-opus-5-5', 'max'), 'answer');
  assert.equal(opus.basis, 'measured_os1');
  // The answer shape is every <= 2-call turn of the cell, whatever its realized
  // output (review of 447): one answer shape, and the agentic shape.
  assert.deepEqual(Object.keys(TABLE.quota['claude-chat:claude-opus-5-5@max']).filter(k => !['pool', 'model', 'effort'].includes(k)).sort(),
    ['agentic', 'answer']);
  assert.ok(lawQuota(TABLE, row('codex', 'gpt-6-astra', 'ultra'), 'agentic').q >
    lawQuota(TABLE, row('codex', 'gpt-6-astra', 'ultra'), 'answer').q);
  assert.deepEqual(lawQuota(TABLE, row('local', 'qwen3.5:9b', 'none'), 'answer'), {q: 0, basis: 'local'});
  assert.equal(lawQuota(TABLE, row('codex', 'gpt-5.5', 'high'), 'answer'), null); // not on the price table
  // p_fail(c, family): judged runs of that model@effort in that law family; the
  // committed ledger has none attributed to a law family (every judged run
  // predates the law): every estimate is the Laplace prior 1/2, never pooled.
  assert.deepEqual(TABLE.p_fail.cells, {});
  assert.ok(TABLE.p_fail.excluded.undispatched > 0 && TABLE.p_fail.excluded.unjudged > 0);
  const astra = row('codex', 'gpt-6-astra', 'ultra'), sol = row('codex', 'gpt-6.1-sol', 'medium');
  assert.equal(lawPFail(TABLE, sol, 'F5a'), 0.5);
  assert.equal(lawPFail(TABLE, sol, 'F5a', astra), 0.5); // inherited: the reference's own (the prior)
  // Correction 1: a row with evidence has its reference's p_fail until its own
  // judged runs move it, at the prior's weight (2).
  const keyed = {...TABLE, p_fail: compilePFail({schema: 2, excluded: {}, cells: [
    {model: 'gpt-6-astra', effort: 'ultra', family: 'F5a', runs: 18, failures: 1},
    {model: 'gpt-6.1-sol', effort: 'medium', family: 'F5a', runs: 8, failures: 1}]}, {laplace: {failures: 1, runs: 2}})};
  assert.equal(lawPFail(keyed, astra, 'F5a'), 0.1); // the reference: (1 + 1) / (18 + 2)
  assert.equal(lawPFail(keyed, row('codex', 'gpt-6-luna', 'low'), 'F5a', astra), 0.1); // no own runs: the reference's
  assert.ok(Math.abs(lawPFail(keyed, sol, 'F5a', astra) - (1 + 2 * 0.1) / (8 + 2)) < 1e-12);
  assert.equal(lawPFail(keyed, sol, 'F5a'), 0.2); // its own Laplace estimate (no evidence: the local row's rule)
  assert.equal(lawPFail(keyed, sol, 'F6-code', astra), 0.5); // another family: the reference's prior there
  assert.equal(lawPFail(keyed, row('claude', 'claude-opus-5-5', 'max'), 'F4'), lawPFail(keyed, row('claude-chat', 'claude-opus-5-5', 'max'), 'F4'));
  // E[Q] = Q·price + p_fail·Q(repair)·price(repair pool).
  assert.equal(lawExpectedQuota({q: 0.01, price: 2, pFail: 0.25, escalationQ: 0.04, escalationPrice: 0.5}), 0.025);
  // The pool exchange (correction 2): max over open windows of ttr / remaining.
  const now = 1_800_000_000_000, week = 10080, h = 3_600_000;
  const at = (windows, ageMS = 0, validMS = 600_000) => ({routing_law: {pools: {anthropic_shared:
    {observed_at_ms: now - ageMS, valid_until_ms: now - ageMS + validMS, windows}}}});
  const w = (used, hoursLeft, minutes = week) => ({used_percent: used, resets_at_ms: now + hoursLeft * h, window_minutes: minutes});
  assert.equal(lawPoolPrice(at([w(50, 84)]), 'anthropic_shared', now).price, 1); // on pace
  assert.ok(Math.abs(lawPoolPrice(at([w(89, 0.8 * 168)]), 'anthropic_shared', now).price - 0.8 / 0.11) < 1e-9); // scarce: 7.27
  assert.ok(Math.abs(lawPoolPrice(at([w(40, 0.1 * 168)]), 'anthropic_shared', now).price - 0.1 / 0.6) < 1e-9); // plentiful
  const binding = lawPoolPrice(at([w(10, 1, 300), w(95, 67)]), 'anthropic_shared', now);
  assert.equal(binding.window_minutes, week); // the weekly binds (67/168 / 0.05) over the session (0.2 / 0.9)
  assert.equal(lawPoolPrice(at([w(100, 50)]), 'anthropic_shared', now).price, Infinity); // exhausted: cannot be drawn
  // Stale, reset-crossed or missing data: the row's remaining share, the whole window ahead.
  assert.deepEqual([lawPoolPrice(at([w(50, 84)], 700_000), 'anthropic_shared', now, 0.4).price,
    lawPoolPrice(at([w(50, 84)], 700_000), 'anthropic_shared', now, 0.4).basis], [2.5, 'remaining_whole_window_ahead']);
  assert.equal(lawPoolPrice(at([w(50, -1)]), 'anthropic_shared', now, 0.5).price, 2);
  assert.equal(lawPoolPrice({}, 'openai_codex', now, 0.6).price, 1 / 0.6);
  assert.deepEqual([lawPoolPrice({}, 'openai_codex', now).price, lawPoolPrice({}, 'openai_codex', now).basis], [1, 'no_quota_evidence_pace']);
  // The table declares the formula; it carries no 1:1 or threshold constant.
  assert.equal(TABLE.headroom_threshold, undefined);
  assert.match(TABLE.exchange.formula, /ttr_w \/ remaining_w/);
});

test('p_fail evidence: only judged runs of a law family count; undispatched and unjudged attempts are no evidence', () => {
  const line = record => JSON.stringify({schema: 1, route_kind: 'law', escalated: false, model: 'm', effort: 'high',
    verifier_outcome: 'not_registered', ...record});
  const ledger = snapshotLedger(Buffer.from([
    line({law: {family: 'F4'}, check_outcome: 'screen_pass'}), line({law: {family: 'F4'}, check_outcome: 'screen_fail',
      escalation_outcome: 'escalated'}), line({law: {family: 'F4'}, attempt_state: 'completed'}),
    line({law: {family: 'F4'}, attempt_state: 'verified_not_dispatched'}), line({route_kind: 'tier', check_outcome: 'pass'}),
    line({law: {family: 'F2'}, attempt_state: 'ladder_not_returned'}), line({escalated: true, law: {family: 'F4'}, check_outcome: 'pass'})
  ].join('\n')));
  assert.deepEqual(ledger.excluded, {undispatched: 1, unjudged: 1, no_law_family: 1});
  assert.deepEqual(ledger.cells, [{model: 'm', effort: 'high', family: 'F2', runs: 1, failures: 1},
    {model: 'm', effort: 'high', family: 'F4', runs: 2, failures: 1}]);
});

test('step 1: the family is the reading through the table\'s first-match rules', () => {
  const r = (task_type, difficulty, needs_tools, domain = 'general', intent) =>
    ({task_type, difficulty, needs_tools, domain, ...(intent ? {intent} : {})});
  assert.equal(lawFamily(null), 'U');
  assert.equal(lawFamily(r('chat', 'light', 'none', 'general', 'self_test')), 'F10');
  assert.equal(lawFamily(r('chat', 'light', 'none')), 'F1');
  assert.equal(lawFamily(r('explain', 'light', 'none')), 'F2');
  assert.equal(lawFamily(r('explain', 'standard', 'none', 'science')), 'F4');
  assert.equal(lawFamily(r('explain', 'standard', 'none', 'math')), 'F4m');
  assert.equal(lawFamily(r('explain', 'light', 'current_facts')), 'F5a');
  assert.equal(lawFamily(r('explain', 'deep', 'current_facts')), 'F5b');
  assert.equal(lawFamily(r('action', 'standard', 'execution', 'coding')), 'F7');
  assert.equal(lawFamily(r('design', 'deep', 'workspace', 'coding')), 'F6-code');
  assert.equal(lawFamily(r('write', 'standard', 'none', 'writing')), 'F13');
  // Review of 447: the tool-use and document tiers have families.
  assert.equal(lawFamily(r('action', 'standard', 'execution', 'tool_use')), 'F8');
  assert.equal(lawFamily(r('explain', 'standard', 'workspace', 'writing')), 'F3x');
  assert.deepEqual(TABLE.families.F8.tiers, ['U1']);
  assert.deepEqual(TABLE.families.F3x.tiers, ['W1']);
});

test('step 2: the matched tiers include every conditional tier whose condition the reading or a writer meets', () => {
  const r = (task_type, difficulty, needs_tools, domain = 'general') => ({task_type, difficulty, needs_tools, domain});
  // Every conditional tier of the evidence is compiled; none is dropped.
  const evidence = JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-evidence-20261029.json'), 'utf8'));
  for (const [id, family] of Object.entries(TABLE.families)) {
    const row = evidence.families.find(f => f.id === id);
    if (!row || family.tier_basis === 'policy') continue;
    for (const c of row.conditional) if (!family.tiers.includes(c.tier))
      assert.ok(family.conditional.some(x => x.tier === c.tier && x.condition === c.when), `${id} ${c.tier}`);
  }
  assert.throws(() => compileFamilies({families: [{id: 'X', required: ['T1'], conditional: [{tier: 'T2', when: 'x'}], upper_bound: []}]},
    {families: {X: {tiers: 'evidence'}}, conditions: {}, local_admission: {families: []}}), /unmapped conditional tier/);
  // F7 / F6-code: C3 for a deep reading or a writer; C2 alone otherwise.
  assert.deepEqual(lawTiers(TABLE, 'F7', r('action', 'standard', 'execution', 'coding'), false), ['C2']);
  assert.deepEqual(lawTiers(TABLE, 'F7', r('action', 'deep', 'execution', 'coding'), false), ['C2', 'C3']);
  assert.deepEqual(lawTiers(TABLE, 'F7', r('action', 'standard', 'execution', 'coding'), true), ['C2', 'C3']);
  assert.deepEqual(lawTiers(TABLE, 'F6-code', r('design', 'standard', 'none', 'coding'), false), ['C2']);
  assert.deepEqual(lawTiers(TABLE, 'F6-code', r('design', 'standard', 'workspace', 'coding'), true), ['C2', 'C3']);
  // A condition no reading tells applies always (the floor); an unread request meets every clause.
  assert.deepEqual(lawTiers(TABLE, 'F4', r('explain', 'standard', 'none', 'science'), false), ['T1', 'T1F', 'T2P']);
  assert.deepEqual(lawTiers(TABLE, 'F4', r('chat', 'standard', 'none', 'science'), false), ['T1', 'T1F', 'T2', 'T2P']);
  assert.deepEqual(lawTiers(TABLE, 'F7', null, false), ['C2', 'C3']);
  // sol@medium: scored on one of Codex's two C2 benchmarks (coverage) and outside tau on C3: never admitted.
  assert.equal(lawEvidence(TABLE, ['C2', 'C3'], 'openai_codex', 'gpt-6.1-sol', 'medium').form, 'none');
  assert.equal(lawEvidence(TABLE, ['C2', 'C3'], 'anthropic_shared', 'claude-opus-5-5', 'medium').form, 'b');
});

// ---- The engine on the owner's own catalogs. -------------------------------
test('every owner fixed question routes to the law\'s recorded output, with a receipt for every candidate', () => {
  for (const q of OWNER.questions) {
    if (q.pending) continue;
    const routed = routeOf(q.request, lawOf(q));
    assert.equal(routed.route, q.expected_route, `#${q.n} ${q.request}`);
    if (routed.kind === 'calculator') continue;
    const receipt = routed.law;
    assert.equal(receipt.policy, 'law_447');
    assert.equal(receipt.table, ROUTING_LAW_TABLE_SHA256.slice(0, 16));
    assert.equal(receipt.family, q.expected_family, `#${q.n}`);
    if (routed.kind === 'ask_back') continue;
    assert.deepEqual(receipt.reading, lawOf(q).routing_law.reading);
    // The argmin is the bound row, and no admissible candidate is cheaper.
    assert.equal(receipt.argmin, routed.route);
    const admissible = receipt.candidates.filter(([, , , eq, excluded]) => excluded === null && eq !== null);
    assert.ok(admissible.length >= 1);
    assert.equal(receipt.eq, Math.min(...admissible.map(([, , , eq]) => eq)), `#${q.n}`);
    for (const [key, form, quota, eq, excluded] of receipt.candidates) {
      assert.match(key, /^[a-z-]+:[a-z0-9.:-]+@[a-z]+$/);
      assert.match(form, /^(?:reference|owner_order|b:.+|c:audit-[a-f0-9]{12}|x:.*)$/);
      assert.ok(excluded === null ? Number.isFinite(eq) && eq >= quota * receipt.rates[key.startsWith('codex') ? 'openai_codex' :
        'anthropic_shared']?.rate - 1e-9 || key.startsWith('local') : eq === null, `#${q.n} ${key}`);
    }
    // The derived exchange of each pool is in every receipt (correction 2).
    for (const rate of Object.values(receipt.rates)) assert.ok(rate.rate === 'exhausted' || rate.rate > 0);
    assert.match(routed.reason, /;law_rate_(?:Cw|Px)_/);
    assert.match(routed.reason, /;law_policy_447;/);
    assert.match(routed.reason, new RegExp(`;law_family_${q.expected_family};`));
    assert.ok(routed.reason.length <= 1024, `#${q.n} reason ${routed.reason.length} chars`);
  }
});

test('a law route below its reference carries one escalation to its own pool\'s reference; its basis is law:<family>', () => {
  const q = question(11); // local-first light explanation
  const routed = routeOf(q.request, lawOf(q));
  assert.equal(routed.kind, 'law');
  assert.equal(routed.ladder.admitted_by, 'routing_law');
  assert.equal(routed.ladder.family, 'F2');
  assert.match(routed.reason, /;local_model$/);
  assert.equal(routed.basis, 'law:F2');
  assert.equal(deliveryBasisOf({routeClass: 'standard', routeKind: 'law', ladder: {...routed.ladder, escalated: false},
    reason: routed.reason}), 'law:F2');
  assert.equal(deliveryBasisOf({routeClass: 'standard', routeKind: 'reference', ladder: {...routed.ladder, escalated: true},
    reason: routed.reason}), 'reference_escalated');
  // A forged family token or ladder is unclassified.
  assert.equal(deliveryBasisOf({routeClass: 'standard', routeKind: 'law', ladder: {...routed.ladder, family: 'F4'},
    reason: routed.reason}), 'unclassified');
});

test('rollback: without routing_law (routing_policy=law_446) every owner question keeps its build 446 route', () => {
  for (const q of OWNER.questions) {
    if (q.pending) continue;
    assert.equal(routeOf(q.request, q.catalog).route, q.route_446, `#${q.n}`);
    if (q.recorded_446) assert.equal(q.route_446, q.recorded_446.replace(/\/(?=[^/]*$)/, '@'), `#${q.n} recorded`);
    // A catalog whose host was built against another table never runs the
    // law: build 446's path, which (no capability routes under the law's
    // host) binds the pool reference or 446's local/graded/certified rows.
    const stale = lawOf(q, c => ({...c, routing_law: {...c.routing_law, table_sha256: sha('another table')}}));
    if (q.expected_route.startsWith('calculator')) continue;
    const routed = routeOf(q.request, stale);
    assert.ok(!/;(?:route_law|admitted_law_|law_policy_447)/.test(routed.reason ?? ''), `#${q.n} stale: ${routed.reason}`);
    assert.equal(routed.law ?? null, null, `#${q.n} stale`);
  }
});

test('the derived exchange: a scarce pool is priced up by its own windows, never switched off; an exhausted one cannot be drawn', () => {
  const q = question(6); // a writer build: Claude's opus@medium below its reference
  const at = c => clockOf(c);
  const pooled = (claude, codex) => lawOf(q, c => ({...c, routing_law: {...c.routing_law, pools: {
    anthropic_shared: {observed_at_ms: at(c) - 1000, valid_until_ms: at(c) + 600_000,
      windows: [{used_percent: claude, resets_at_ms: at(c) + 0.4 * 7 * 86_400_000, window_minutes: 10080}]},
    openai_codex: {observed_at_ms: at(c) - 1000, valid_until_ms: at(c) + 600_000,
      windows: [{used_percent: codex, resets_at_ms: at(c) + 0.7 * 7 * 86_400_000, window_minutes: 10080}]}}}}));
  const plain = routeOf(q.request, lawOf(q)), scarce = routeOf(q.request, pooled(95, 40));
  assert.deepEqual([scarce.law.rates.anthropic_shared.basis, scarce.law.rates.anthropic_shared.ttr], ['observed_window', 0.4]);
  const claudeRate = scarce.law.rates.anthropic_shared.rate, plainRate = plain.law.rates.anthropic_shared.rate;
  assert.ok(Math.abs(claudeRate - 0.4 / 0.05) < 1e-6 && Math.abs(plainRate - 1 / 0.6) < 1e-6);
  const eqOf = (routed, key) => routed.law.candidates.find(([row]) => row === key);
  for (const [key, , , eq, excluded] of scarce.law.candidates.filter(([key]) => key.startsWith('claude'))) {
    if (excluded !== null) continue;
    // Every term of a Claude row's E[Q] is a Claude draw: each scales with the rate.
    assert.ok(Math.abs(eq - eqOf(plain, key)[3] * claudeRate / plainRate) < 1e-5, `${key} ${eq} vs ${eqOf(plain, key)[3]}`);
  }
  // Within the scarce pool the cheap row still beats its own reference: a rate
  // never favours the largest draw (review of 447).
  assert.equal(scarce.route, 'claude:claude-opus-5-5@medium');
  assert.ok(eqOf(scarce, scarce.route)[3] < eqOf(scarce, 'claude:claude-fable-5-1@max')[3]);
  assert.equal(scarce.law.argmin, scarce.route);
  assert.match(scarce.reason, /;law_rate_Cw_8\.0000;/);
  assert.match(scarce.reason, /;law_rate_Px_1\.1667;/); // 0.7 of the week to run, 60% left
  // An exhausted pool prices nothing: its rows are excluded, never chosen.
  const spent = routeOf(question(3).request, lawOf(question(3), c => ({...c, routing_law: {...c.routing_law, pools: {
    openai_codex: {observed_at_ms: clockOf(c) - 1000, valid_until_ms: clockOf(c) + 600_000,
      windows: [{used_percent: 100, resets_at_ms: clockOf(c) + 86_400_000, window_minutes: 10080}]}}}})));
  assert.equal(spent.law.rates.openai_codex.rate, 'exhausted');
  assert.ok(spent.law.candidates.filter(([key]) => key.startsWith('codex')).every(([, , , , excluded]) =>
    excluded === 'pool_exhausted' || excluded === 'no_evidence'));
  assert.ok(!spent.route.startsWith('codex'));
});

test('correction 1: an admissible row pays only the reference\'s own failure rate; the reference prices its own repair', () => {
  // F4 (owner question 3): opus@max has evidence (T1, T2P); at equal rates its
  // E[Q] beats both references, which pay for their own verifier failures.
  const routed = routeOf(question(3).request, lawOf(question(3)));
  assert.equal(routed.route, 'claude-chat:claude-opus-5-5@max');
  const [, , qOpus, eqOpus] = routed.law.candidates.find(([key]) => key === routed.route);
  const [, , qAstra, eqAstra] = routed.law.candidates.find(([key]) => key === 'codex:gpt-6-astra@ultra');
  const [, , qFable] = routed.law.candidates.find(([key]) => key === 'claude-chat:claude-fable-5-1@max');
  const rate = routed.law.rates.anthropic_shared.rate;
  assert.ok(Math.abs(eqAstra - qAstra * routed.law.rates.openai_codex.rate * 1.5) < 1e-5, 'a reference: Q(1 + p_fail) at its rate');
  assert.ok(Math.abs(eqOpus - (qOpus + 0.5 * qFable) * rate) < 1e-5, 'opus: Q + p_ref x Q(fable)');
  assert.ok(eqOpus < eqAstra);
});

test('the owner\'s reference words (P) admit the references only, priced on the work the reading does', () => {
  // A build read as action (F7, agentic) with reference words: the references
  // compete on the agentic shape (fable@max agentic, not astra on the answer shape).
  const q = question(6);
  const routed = routeOf(q.request, lawOf(q, c => ({...c, routing_law: {...c.routing_law, reference_request: true}})));
  assert.equal(routed.law.family, 'P');
  assert.equal(routed.law.shape, 'agentic');
  assert.equal(routed.route, 'claude:claude-fable-5-1@max');
  assert.ok(routed.law.candidates.every(([, form, , , excluded]) => form === 'reference' || excluded !== null));
});

test('a writer that does work is priced on the agentic shape; the same reading answering is priced as an answer', () => {
  const q = question(6);
  const routed = routeOf(q.request, lawOf(q));
  assert.equal(routed.scope, 'workspace_write');
  assert.equal(routed.law.shape, 'agentic');
  assert.deepEqual(routed.law.tiers, ['C2', 'C3']); // a writer meets 'multi-step agentic work on a repository'
  const opus = lawQuota(TABLE, {surface: 'claude', model: 'claude-opus-5-5', effort: 'medium'}, 'agentic').q;
  assert.equal(routed.law.candidates.find(([key]) => key === routed.route)[2], Math.round(opus * 1e6) / 1e6);
  // The same request answered by a read-only node (no write rows): its family's answer shape.
  const readOnly = lawOf(q, c => ({...c, owner_scope: 'read_only', candidates: c.candidates.filter(row => row.scope === 'read_only')}));
  const answered = routeOf(q.request, readOnly);
  assert.equal(answered.scope, 'read_only');
  assert.equal(answered.law.shape, 'answer');
  // A writer whose reading is a plain explanation does no work: its family's shape.
  const explain = lawOf(q, c => ({...c, routing_law: {...c.routing_law,
    reading: {task_type: 'explain', difficulty: 'standard', needs_tools: 'none', domain: 'general'}}}));
  assert.equal(routeOf(q.request, explain).law.shape, 'answer');
});

test('a pool reference is admissible on the tiers its pool publishes; current facts bind the Codex reference', () => {
  const q = question(7); // F5a: T1F, published by Codex only
  const routed = routeOf(q.request, lawOf(q));
  assert.equal(routed.law.family, 'F5a');
  const fable = routed.law.candidates.find(([key]) => key.endsWith('claude-fable-5-1@max'));
  assert.deepEqual([fable[1], fable[4]], ['x:T1F=unpublished', 'reference_tier_unpublished']);
  const astra = routed.law.candidates.find(([key]) => key === 'codex:gpt-6-astra@ultra');
  assert.deepEqual([astra[1], astra[4]], ['reference', null]);
  assert.equal(routed.route, 'codex:gpt-6-astra@ultra');
  // A family no pool publishes a tier for (small talk on a later turn, F1):
  // every pool reference stays admissible (DESIGN-8: the reference is always admissible).
  const chat = lawOf(question(12), c => ({...c, candidates: c.candidates.filter(row => row.surface !== 'local')}));
  const talked = routeOf(question(12).request, chat);
  assert.equal(talked.law.family, 'F1');
  assert.ok(talked.law.candidates.filter(([, form]) => form === 'reference').length >= 2);
  // With no Codex pool in the catalog, nothing is admissible: the reference fallback binds.
  const claudeOnly = lawOf(q, c => ({...c, candidates: c.candidates.filter(row => row.quota_pool !== 'openai_codex')}));
  const fallback = routeOf(q.request, claudeOnly);
  assert.match(fallback.route, /claude-fable-5-1@max$/);
  assert.match(fallback.reason, /law_F5a_no_admissible_priced_row/);
});

test('a row whose own pool reference cannot run escalates to the other pool\'s reference; a writer needs none', () => {
  const q = question(6);
  const noFable = c => ({...c, candidates: c.candidates.map(row => row.model === 'claude-fable-5-1' ?
    {...row, availability: 'unavailable'} : row)});
  const wrote = routeOf(q.request, lawOf(q, noFable));
  assert.equal(wrote.route, 'claude:claude-opus-5-5@medium'); // a writer binds no ladder: no runnable reference needed
  assert.equal(wrote.ladder, null);
  // A read-only law row below its reference: its ladder's escalation is the Codex reference.
  const q11 = question(11);
  const local = lawOf(q11, c => noFable({...c, candidates: c.candidates}));
  const routed = routeOf(q11.request, local);
  assert.equal(routed.route, 'local:qwen3.5:9b@none');
  const reference = local.candidates.find(row => row.id === routed.ladder.reference_candidate_id);
  assert.equal(reference.model, 'gpt-6-astra');
  const opus = lawOf(question(3), c => noFable({...c, candidates: c.candidates}));
  const ex = routeOf(question(3).request, opus).law.candidates.find(([key]) => key === 'claude-chat:claude-opus-5-5@max');
  assert.notEqual(ex[4], 'requires_runnable_reference', 'priced to the other pool\'s reference, not excluded');
});

test('local first: a light tool-free reading binds the local row on the first turn only; a writer never', () => {
  const q = question(11);
  const law = lawOf(q);
  assert.equal(routeOf(q.request, law).route, 'local:qwen3.5:9b@none');
  // A later turn (conversation context): the local row is not offered by the law.
  const host = {workspace: '/tmp/rcc-cls-run', context: 'earlier turn', provider_preference: 'auto',
    codex_session_id: null, claude_session_id: null, require_read_only: false, owner_policy: null};
  const policyText = 'fixture policy';
  const task = {schema: 1, task_id: law.task_id, request: q.request, request_sha256: law.request_sha256, objective: q.request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60000, max_native_dispatches: 16},
    host_context: host, policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText},
    routing_intent_policy_version: law.routing_intent_v2.version};
  const plan = hostPlan(task, law);
  const at = Math.max(...law.candidates.map(c => c.availability_observed_at_ms ?? 0)) + 1;
  const {decisions, routes} = resolveRoutePlan(plan, task, law, at);
  const decision = decisions[plan.nodes[0].id];
  assert.notEqual(decision.surface, 'local');
  assert.ok(!routes[plan.nodes[0].id].law.candidates.some(([key]) => key.startsWith('local:')));
});

test('the grant never picks the model: an owner write grant on a read-only node changes nothing', () => {
  // Review of 447: the owner's scope alone (the node still runs read-only)
  // never removes the local row or moves a request to the reference.
  for (const q of OWNER.questions) {
    if (q.pending || q.expected_route.startsWith('calculator')) continue;
    // A read-only request class (the corpus's grant-only rows): the node runs read-only either way.
    const readOnly = lawOf(q, c => ({...c, owner_scope: 'read_only', request_class: c.request_class === 'writer' ? 'readonly_lookup' :
      c.request_class, candidates: c.candidates.filter(row => row.scope === 'read_only')}));
    const granted = {...readOnly, owner_scope: 'workspace_write'};
    const a = routeOf(q.request, readOnly), b = routeOf(q.request, granted);
    assert.equal(b.route, a.route, `#${q.n} ${q.request}`);
    if (a.kind === 'ask_back') continue;
    assert.equal(a.scope, 'read_only', `#${q.n}`);
    assert.equal(b.route, a.route, `#${q.n} ${q.request}`);
  }
  // The local row travels by the reading alone (Swift lawMayAnswerLocally).
  const q10 = question(10);
  assert.equal(q10.catalog.owner_scope, 'workspace_write');
  assert.ok(lawOf(q10).candidates.some(row => row.surface === 'local'));
});

test('the grant never picks the model: the same reading under a read-only and a writer node binds the same model@effort', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 10, 11, 12]) {
    const q = question(n);
    const agentRows = lawOf(q).candidates.filter(row => row.surface !== 'local' && row.scope === 'read_only');
    const readOnly = lawOf(q, c => ({...c, owner_scope: 'read_only', request_class: 'readonly_lookup',
      chat_lane_eligible: c.owner_scope === 'read_only' ? c.chat_lane_eligible : false,
      candidates: agentRows.filter(row => row.surface !== 'claude-chat' || c.owner_scope === 'read_only')}));
    const writerRows = agentRows.filter(row => row.surface !== 'claude-chat').map(row => ({...row, scope: 'workspace_write',
      permission_profile: 'workspace_write', allowed_paths: ['**'], tools: ['read', 'write', 'execute'],
      id: 'w' + row.id.slice(1), configuration_sha256: sha('writer:' + row.configuration_sha256)}));
    const writer = lawOf(q, c => ({...c, owner_scope: 'workspace_write', chat_lane_eligible: false, request_class: 'writer',
      candidates: [...agentRows.filter(row => row.surface !== 'claude-chat'), ...writerRows]}));
    const read = routeOf(q.request, readOnly), wrote = routeOf(q.request, writer);
    assert.equal(read.scope, 'read_only', `#${n}`);
    assert.equal(wrote.scope, 'workspace_write', `#${n}`);
    assert.equal(wrote.ladder, null, `#${n} a writer binds no ladder`);
    if (q.expected_route.startsWith('local:') || read.law.shape !== wrote.law.shape) {
      // The local model has no tools: a writer moves to the family's tooled
      // argmin (DESIGN-6 §5), the cheapest admissible writer row by the law.
      assert.equal(wrote.law.argmin, wrote.route, `#${n}`);
      const admissible = wrote.law.candidates.filter(([, , , eq, excluded]) => excluded === null);
      assert.equal(wrote.law.eq, Math.min(...admissible.map(([, , , eq]) => eq)), `#${n}`);
      continue;
    }
    const modelEffort = route => route.split(':').slice(1).join(':');
    assert.equal(modelEffort(wrote.route), modelEffort(read.route), `#${n} ${read.route} vs ${wrote.route}`);
  }
});

test('owner words for the strongest model or more thinking leave only the pool references', () => {
  const q = question(2);
  const law = lawOf(q, c => ({...c, request_profile: {...c.request_profile,
    signals: [...c.request_profile.signals, 'quality_request'].sort()}}));
  const routed = routeOf(q.request, law);
  assert.equal(routed.law.family, 'P');
  assert.ok(routed.law.candidates.every(([, form, , , excluded]) => form === 'reference' || excluded !== null));
  assert.match(routed.route, /claude-fable-5-1@max|gpt-6-astra@ultra/);
  // Review of 447: the host's wider forms (build 446's capability guard) travel
  // as routing_law.reference_request; the fixed-phrase signal is not needed.
  for (const [request, reading] of [
    ['최대한 신중히 생각해서 퀵소트 최악 시간복잡도가 왜 나오는지 설명해줘', {task_type: 'explain', difficulty: 'deep', needs_tools: 'none', domain: 'coding'}],
    ['think very carefully: why is the harmonic series divergent?', {task_type: 'explain', difficulty: 'standard', needs_tools: 'none', domain: 'math'}],
    ['머리를 최대한 굴려서 이 함수 설명해봐', {task_type: 'explain', difficulty: 'light', needs_tools: 'none', domain: 'coding'}]]) {
    const row = {request, catalog: {...structuredClone(question(3).catalog), request_sha256: sha(request)},
      receipt: {outcome: 'adopted', model: 'qwen3.5:9b', answer: reading}};
    const catalog = lawCatalog(row, null);
    assert.equal(catalog.request_profile.signals.includes('quality_request'), false);
    assert.equal(catalog.routing_law.reference_request, true, request);
    const words = routeOf(request, catalog);
    assert.equal(words.law.family, 'P', request);
    assert.match(words.route, /claude-fable-5-1@max|gpt-6-astra@ultra/, request);
    const without = routeOf(request, {...catalog, routing_law: {...catalog.routing_law, reference_request: false}});
    assert.notEqual(without.law.family, 'P', request);
  }
  // A self-test with reference words is not asked back.
  const q8 = question(8);
  assert.equal(lawAskBack({mode: 'auto', request: q8.request},
    lawOf(q8, c => ({...c, routing_law: {...c.routing_law, reference_request: true}}))), null);
});

test('ask-back: a first-turn self-test with no task asks one free question in the owner\'s language', () => {
  const q = question(8);
  const law = lawOf(q);
  const task = {mode: 'auto', request: q.request};
  const ask = lawAskBack(task, law);
  assert.equal(ask.output, TABLE.ask_back.ko);
  assert.equal(ask.receipt.family, 'F10');
  assert.equal(lawAskBack({mode: 'auto', request: "let's see how well you do"}, law).output, TABLE.ask_back.en);
  // The rollback or another reading: no ask-back.
  assert.equal(lawAskBack(task, q.catalog), null);
  assert.equal(lawAskBack(task, lawOf(q, c => ({...c, routing_law: {...c.routing_law,
    reading: {...c.routing_law.reading, intent: 'other'}}}))), null);
});

test('the catalog contract: routing_law travels only well-formed and beside the admission facts', () => {
  const q = question(2);
  const good = lawOf(q).routing_law;
  const bad = [{...good, policy: 'law_446'}, {...good, schema: 2}, {...good, table_sha256: 'x'},
    {...good, reader: 'none'}, {...good, reading: {...good.reading, task_type: 'dance'}},
    {...good, reading: {...good.reading, extra: 1}}, {...good, reader: 'local_llm:qwen3.5:9b', reading: null},
    (({reading, ...rest}) => rest)(good), (({reference_request, ...rest}) => rest)(good), {...good, reference_request: 'yes'},
    // Lead correction 2: the pools' windows are well-formed or the catalog is.
    {...good, pools: {elsewhere: null}}, {...good, pools: []},
    {...good, pools: {openai_codex: {observed_at_ms: 1, valid_until_ms: 2, windows: []}}},
    {...good, pools: {openai_codex: {observed_at_ms: 1, valid_until_ms: 2, windows: [{used_percent: 101, resets_at_ms: 3, window_minutes: 60}]}}},
    {...good, pools: {openai_codex: {observed_at_ms: 1, valid_until_ms: 2, windows: [{used_percent: 1, resets_at_ms: 3, window_minutes: 0}]}}},
    {...good, pools: {openai_codex: {observed_at_ms: 1, valid_until_ms: 2, account_id: 'x',
      windows: [{used_percent: 1, resets_at_ms: 3, window_minutes: 60}]}}}];
  return Promise.all(bad.map(async routingLaw => {
    const dir = await mkdtemp(join(tmpdir(), 'os1-law-bad-')); await chmod(dir, 0o700);
    const catalog = {...lawOf(q), routing_law: routingLaw};
    const task = runtimeTask(q, catalog);
    const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => ({...catalog, task_id: task.task_id}),
      execute: async () => { throw new Error('never'); }});
    try {
      await runtime.submit(task);
      const done = await runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 4000});
      assert.equal(done.error, 'catalog_binding_invalid', JSON.stringify(routingLaw));
    } finally { await runtime.close(); await rm(dir, {recursive: true, force: true}); }
  }));
});

// ---- The durable Core: the receipt reaches the ledger; ask-back is free. --
function runtimeTask(q, catalog, workspace = '/tmp/rcc-cls-run') {
  const policyText = 'fixture policy';
  const host = {workspace, context: null, provider_preference: 'auto',
    codex_session_id: null, claude_session_id: null, require_read_only: false, owner_policy: null};
  return {schema: 1, task_id: catalog.task_id, request: q.request, request_sha256: catalog.request_sha256, objective: q.request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60000, max_native_dispatches: 16},
    host_context: host, policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText},
    routing_intent_policy_version: catalog.routing_intent_v2.version};
}
function completed(ticket, patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'fixture answer',
    native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null, native_turn_terminated: true, ...patch};
}
async function harness(t, q, catalog, execute) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-law-')); await chmod(dir, 0o700);
  const workspace = await mkdtemp(join(tmpdir(), 'os1-law-workspace-')); await chmod(workspace, 0o700);
  const tickets = [];
  const task = runtimeTask(q, catalog, workspace);
  // A catalog observed now (the recorded rows' freshness window has passed).
  const now = Date.now();
  const fresh = {...catalog, candidates: catalog.candidates.map(row => ({...row,
    ...(row.availability_observed_at_ms === null ? {} : {availability_observed_at_ms: now, availability_valid_until_ms: now + 600000}),
    ...(row.quota_observed_at_ms === null ? {} : {quota_observed_at_ms: now, quota_valid_until_ms: now + 600000})}))};
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => fresh,
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); }});
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true});
    await rm(workspace, {recursive: true, force: true}); });
  await runtime.submit(task);
  const done = await runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 6000});
  let text = '';
  try { text = await readFile(join(dir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8'); } catch { /* no attempt */ }
  return {done, tickets, saved: runtime._load(task.task_id), text,
    ledger: text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))};
}
const tuple = ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}@${ticket.selected_config.effort}`;

test('Core: the law\'s route runs, its screen delivers it, and the ledger record carries the law receipt', async t => {
  const q = question(6); // a writer: no ladder
  const {done, tickets, ledger, text} = await harness(t, q, lawOf(q), ticket => completed(ticket));
  assert.deepEqual(tickets.map(tuple), [q.expected_route]);
  assert.equal(done.result.output, 'fixture answer');
  const [record] = ledger;
  assert.equal(record.delivery_basis, 'law:' + q.expected_family);
  assert.equal(record.law.argmin, q.expected_route);
  assert.equal(record.law.family, q.expected_family);
  assert.ok(Array.isArray(record.law.candidates) && record.law.candidates.length > 0);
  assert.ok(Buffer.byteLength(text.split('\n')[0]) <= 8192);
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]}).verdict, 'PASS');
});

test('Core: the law\'s local route dispatches locally with no hold (light explanation and light writing)', async t => {
  // Review of 447 (blocker): the plan validator admits a law-bound local node
  // under the predicate the law bound it under, not only a chat profile.
  for (const [q, label] of [[question(11), 'F2'], [{...question(11), request: '이 문장 영어로 번역해줘: 나는 학교에 갔다',
    receipt: {outcome: 'adopted', model: 'qwen3.5:9b', answer: {task_type: 'write', difficulty: 'light', needs_tools: 'none', domain: 'writing'}},
    intent: 'other'}, 'F12']]) {
    const catalog = lawCatalog({...q, catalog: {...structuredClone(q.catalog), request_sha256: sha(q.request)}}, q.intent);
    assert.equal(catalog.request_profile.task_type === 'chat', false, label + ': not a chat profile');
    const routed = routeOf(q.request, catalog);
    assert.equal(routed.route, 'local:qwen3.5:9b@none', label);
    assert.equal(routed.law.family, label);
    const {done, tickets} = await harness(t, q, catalog, ticket => completed(ticket, {output: 'a local answer, long enough to pass'}));
    assert.notEqual(done.state, 'held', label + ' ' + done.error);
    assert.deepEqual(tickets.map(tuple), ['local:qwen3.5:9b@none'], label);
  }
});

test('Core: a failed screen on a read-only law route escalates exactly once to the reference fixed at bind', async t => {
  const q = question(11); // a light explanation: the local law route, below its reference
  const law = lawOf(q);
  const routed = routeOf(q.request, law);
  assert.equal(routed.kind, 'law');
  const reference = law.candidates.find(row => row.id === routed.ladder.reference_candidate_id);
  const {tickets, ledger, text, done} = await harness(t, q, law, (ticket, n) => n === 1 ? completed(ticket, {output: ' '}) :
    completed(ticket, {output: 'reference answer'}));
  assert.deepEqual(tickets.map(tuple), [routed.route.replace(/@none$/, '@none'), lawKey(reference)]);
  assert.equal(done.result.output, 'reference answer');
  assert.equal(ledger[0].delivery_basis, 'law:F2');
  assert.equal(ledger[0].check_outcome, 'screen_fail');
  assert.equal(ledger[0].escalation_outcome, 'escalated');
  assert.equal(ledger[1].delivery_basis, 'reference_escalated');
  assert.equal(ledger[1].law.argmin, routed.route, 'the escalated attempt keeps the decision that led to it');
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]}).verdict, 'PASS');
});

test('Core: the ask-back returns locally with no dispatch, unverified, and records the local reading that decided it', async t => {
  const q = question(8);
  const {done, tickets, saved} = await harness(t, q, lawOf(q), () => { throw new Error('never dispatched'); });
  assert.equal(tickets.length, 0);
  // Review of 447: a question back is no verified answer, and the local
  // model's reading (not an exact parser) decided it.
  assert.equal(done.state, 'returned_unverified');
  assert.equal(done.result.output, TABLE.ask_back.ko);
  assert.equal(done.result.task_verified, false);
  assert.equal(done.result.task_quality, 'execution_only');
  assert.equal(saved.law_receipt.family, 'F10');
  assert.equal(saved.plan_provenance, 'local_reading_ask_back');
  assert.equal(saved.resource_events[0].reason, 'host_local_reading_ask_back:' + lawOf(q).routing_law.reader);
  assert.equal(saved.resource_events[0].model, 'ollama/qwen3.5:9b');
});

test('the owner table covers DESIGN-7 §5\'s 16 questions', () => {
  assert.deepEqual(OWNER.questions.map(q => q.n), OWNER_QUESTIONS.map(([n]) => n));
  for (const q of OWNER.questions) if (!q.pending) assert.equal(typeof lawKey, 'function');
});
