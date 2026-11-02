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
import {copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {lawCatalog, routeOf, clockOf, OWNER_QUESTIONS, priceRoute, atHeadroom, regimeHeadroom} from '../routing-law-replay.mjs';
import {ROUTING_LAW_TABLE_SHA256, ROUTING_POLICIES, routingLawTable, lawFamily, lawEvidence, lawQuota, lawPFail,
  lawJudgedOutcome, lawLearnedPFail, revasVerdict, revasCheckInstruction, revasRepairInstruction, revasPrefix,
  lawPoolPrice, lawExpectedQuota, lawAskBack, lawKey, lawTiers, deliveryBasisOf, createRCCRuntime, hostPlan, resolveRoutePlan,
  lawLocalEvidence, openRoutingLedger, lawDeterministicCheck, lawDeterministicVerifier, lawDetPFail, lawDetClassPFail, lawScreenPFail, lawScreenOutcome, lawDeterministicFindings,
  hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {canonical, compileAdmission, compileFamilies, compilePFail, compileTable, compileTau, readInputs, snapshotLedger,
  compileDeterministicVerifiers, validateDeterministicVerifier, snapshotDetOutcomes} from '../routing-law-table.mjs';
import {auditDeliveryPolicy} from '../route-replay.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = text => createHash('sha256').update(text).digest('hex');
const OWNER = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/routing-law-owner-questions.json'), 'utf8'));
const TABLE = routingLawTable();
const question = n => OWNER.questions.find(q => q.n === n);
const lawOf = (q, mutate = c => c) => mutate(lawCatalog(q, q.intent));
// Build 448 (review): the law's catalog with every row unavailable but the
// pool references, the local row and the F2 judge (claude-chat opus@max):
// Core's local det paths run on it with a fixed judge.
const referencesAndLocal = c => ({...c, candidates: c.candidates.map(row => row.surface === 'local' ||
  Object.values(TABLE.references).includes(row.model) || lawKey(row) === 'claude-chat:claude-opus-5-5@max' ? row :
  {...row, availability: 'unavailable'})});
// Round 2 of the 448 review (A, evidence symmetry): every row small talk's
// deterministic verifier admits starts from ONE prior, the verifier's
// measured rejection rate on reference-quality replies (the held-out set B's
// clean replies, judged as a pool row's), Laplace-smoothed; a row's own
// judged verdicts move it from there at the prior's weight 2 (Core
// lawDetPFail). The local model's are Core's verdicts on its real drafts of
// the corpus F1 requests (the table's det outcomes).
const DET_PRIOR = TABLE.deterministic_verifiers.F1.reference_prior;
const P0 = (DET_PRIOR.failures + 1) / (DET_PRIOR.runs + 2);
const LOCAL_F1 = TABLE.p_fail.cells['qwen3.5:9b@none|F1'];
const LOCAL_F1_P = (LOCAL_F1.failures + 2 * P0) / (LOCAL_F1.runs + 2);

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
  assert.equal(opus.basis, 'measured_os1_anchored');
  // Review of 447: every answer cell is priced on ONE common anchor (the
  // shape's OS-1 context, the output the model gives at that effort, never
  // less than at a lower one, times the cell's own measured premium), and a
  // higher effort never prices below a lower effort of the same model.
  const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
  const groups = new Map();
  for (const [key, cell] of Object.entries(TABLE.quota)) {
    const group = key.slice(0, key.lastIndexOf('@'));
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(cell);
  }
  for (const [group, cells] of groups) {
    const sorted = cells.filter(c => c.answer).sort((a, b) => EFFORTS.indexOf(a.effort) - EFFORTS.indexOf(b.effort));
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].answer.q >= sorted[i - 1].answer.q, group + ' ' + sorted[i].effort);
  }
  const astraUltra = lawQuota(TABLE, row('codex', 'gpt-6-astra', 'ultra'), 'answer').q;
  assert.ok(astraUltra >= lawQuota(TABLE, row('codex', 'gpt-6-astra', 'xhigh'), 'answer').q, 'astra@ultra never below astra@xhigh');
  assert.ok(astraUltra > lawQuota(TABLE, row('claude-chat', 'claude-fable-5-1', 'max'), 'answer').q,
    'on the common anchor astra@ultra answers dearer than fable@max (OS-1\'s ultra turns were 217-token checks)');
  // OS-1's fable@low turns carried 496k input tokens: on the anchor fable@low is no dearer than fable@max.
  assert.ok(lawQuota(TABLE, row('claude-chat', 'claude-fable-5-1', 'low'), 'answer').q <=
    lawQuota(TABLE, row('claude-chat', 'claude-fable-5-1', 'max'), 'answer').q);
  assert.equal(TABLE.quota_anchors['openai:answer'].source, 'os1');
  // The agentic shape keeps build 447's measured median (its token columns omit sub-agent tokens).
  assert.equal(lawQuota(TABLE, row('claude', 'claude-opus-5-5', 'max'), 'agentic').basis, 'measured_os1');
  // The answer shape is every <= 2-call turn of the cell, whatever its realized
  // output (review of 447): one answer shape, and the agentic shape; build 448
  // adds the REVAS check and repair of a local draft on the answer anchor;
  // round 3 the cold repair of a draft a family's deterministic verifier
  // rejected (det_repair: the draft and the findings uncached, at a reference
  // that never saw them).
  assert.deepEqual(Object.keys(TABLE.quota['claude-chat:claude-opus-5-5@max']).filter(k => !['pool', 'model', 'effort'].includes(k)).sort(),
    ['agentic', 'answer', 'det_repair', 'repair', 'verify']);
  for (const cell of Object.values(TABLE.quota).filter(c => c.det_repair))
    assert.ok(cell.det_repair.q >= cell.repair.q && cell.det_repair.output === cell.answer.output, 'cold repair >= cached repair');
  assert.ok(lawQuota(TABLE, row('codex', 'gpt-6-astra', 'ultra'), 'agentic').q >
    lawQuota(TABLE, row('codex', 'gpt-6-astra', 'ultra'), 'answer').q);
  assert.deepEqual(lawQuota(TABLE, row('local', 'qwen3.5:9b', 'none'), 'answer'), {q: 0, basis: 'local'});
  assert.equal(lawQuota(TABLE, row('codex', 'gpt-5.5', 'high'), 'answer'), null); // not on the price table
  // p_fail(c, family): judged runs of that model@effort in that law family; the
  // committed ledger has none attributed to a law family (every judged run
  // predates the law): every estimate is the Laplace prior 1/2, never pooled,
  // except small talk's local row, judged by Core's deterministic verifier on
  // the local model's real drafts (production small-talk prompt) of the
  // held-out sets' own requests (round 3, decision 1: the reference prior's
  // population; corpus drafts never enter the fit); review of round 3: only
  // those inside the verifier's request scope (51 of the 80).
  assert.deepEqual(TABLE.p_fail.cells, {'qwen3.5:9b@none|F1': {runs: 51, failures: 24, full: 0}});
  assert.deepEqual(TABLE.p_fail.deterministic[0].request_scope, {id: 'small_talk_request_v2', kept: 51, of: 80});
  assert.deepEqual(TABLE.p_fail.deterministic[0].population, ['B_heldout', 'C_heldout']);
  assert.deepEqual(TABLE.p_fail.deterministic.map(d => [d.key, d.verifier]), [['qwen3.5:9b@none|F1', 'no_claim_reply_v2']]);
  assert.ok(TABLE.p_fail.excluded.undispatched > 0 && TABLE.p_fail.excluded.unjudged > 0);
  const astra = row('codex', 'gpt-6-astra', 'ultra'), sol = row('codex', 'gpt-6.1-sol', 'medium');
  assert.equal(lawPFail(TABLE, sol, 'F5a'), 0.5);
  assert.equal(lawPFail(TABLE, sol, 'F5a', astra), 0.5); // inherited: the reference's own (the prior)
  // Correction 1: a row with evidence has its reference's p_fail until its own
  // judged runs move it, at the prior's weight (2).
  const keyed = {...TABLE, p_fail: compilePFail({schema: 4, through_ms: null, excluded: {}, cells: [
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
  assert.equal(binding.window_minutes, week); // the weekly window is the unit (67/168 / 0.05)
  // Review of 447: only the unit (weekly) window is priced, never a session
  // window's ttr/remaining on a weekly unit; a session window only blocks when exhausted.
  const session = lawPoolPrice(at([w(90, 4, 300), w(20, 160)]), 'anthropic_shared', now);
  assert.equal(session.window_minutes, week);
  assert.ok(Math.abs(session.price - (160 / 168) / 0.8) < 1e-9);
  assert.equal(lawPoolPrice(at([w(100, 4, 300), w(20, 160)]), 'anthropic_shared', now).price, Infinity);
  assert.equal(lawPoolPrice(at([w(100, 50)]), 'anthropic_shared', now).price, Infinity); // exhausted: cannot be drawn
  // Stale (past valid_until): each window not yet reset at its last share left
  // with the whole window ahead; a probe that failed never prices a pool last
  // seen scarce at pace (review of 447): Claude at 5%, 11 minutes old: 20.
  const stale = lawPoolPrice(at([w(95, 50)], 660_000), 'anthropic_shared', now, null);
  assert.ok(Math.abs(stale.price - 20) < 1e-9);
  assert.equal(stale.basis, 'stale_window_whole_window_ahead');
  assert.ok(stale.price > lawPoolPrice(at([w(95, 50)]), 'anthropic_shared', now).price, 'never below its fresh price');
  assert.equal(lawPoolPrice(at([w(100, 50)], 660_000), 'anthropic_shared', now).price, Infinity);
  assert.equal(lawPoolPrice(at([w(50, 84)], 700_000), 'anthropic_shared', now, 0.4).price, 2);
  // Every window reset since: the row's remaining share, the whole window ahead.
  assert.equal(lawPoolPrice(at([w(50, -1)]), 'anthropic_shared', now, 0.5).price, 2);
  assert.equal(lawPoolPrice({}, 'openai_codex', now, 0.6).price, 1 / 0.6);
  assert.deepEqual([lawPoolPrice({}, 'openai_codex', now).price, lawPoolPrice({}, 'openai_codex', now).basis], [1, 'no_quota_evidence_pace']);
  // The table declares the formula; it carries no 1:1 or threshold constant.
  assert.equal(TABLE.headroom_threshold, undefined);
  assert.match(TABLE.exchange.formula, /ttr_w \/ remaining_w/);
});

test('p_fail evidence: only judged runs of a law family count; undispatched and unjudged attempts are no evidence', () => {
  const line = record => JSON.stringify({schema: 1, route_kind: 'law', escalated: false, model: 'm', effort: 'high',
    verifier_outcome: 'not_registered', settled_at_ms: 100, ...record});
  const ledger = snapshotLedger(Buffer.from([
    line({law: {family: 'F4'}, check_outcome: 'screen_pass'}), line({law: {family: 'F4'}, check_outcome: 'screen_fail',
      escalation_outcome: 'escalated'}), line({law: {family: 'F4'}, attempt_state: 'completed'}),
    line({law: {family: 'F4'}, attempt_state: 'verified_not_dispatched'}), line({route_kind: 'tier', check_outcome: 'pass'}),
    line({law: {family: 'F2'}, attempt_state: 'ladder_not_returned'}), line({escalated: true, law: {family: 'F4'}, check_outcome: 'pass',
      settled_at_ms: 300})
  ].join('\n')));
  assert.deepEqual(ledger.excluded, {undispatched: 1, unjudged: 1, no_law_family: 1, local_screen_only: 0});
  // Round 3: a failure's class: no deliverable draft (not returned, a failed
  // screen) is 'full'.
  assert.deepEqual(ledger.cells, [{model: 'm', effort: 'high', family: 'F2', runs: 1, failures: 1, full: 1},
    {model: 'm', effort: 'high', family: 'F4', runs: 2, failures: 1, full: 1}]);
  // Round 3 (decision 2): the structural screen beside it, keyed model@effort
  // (pooled over families): screened descents only (a pass, a failed screen,
  // a descent that did not return); a tier route, an escalation or an
  // unscreened attempt says nothing about the screen.
  assert.deepEqual(ledger.screen.cells, [{key: 'm@high', runs: 3, failures: 2, shadow: 0}]);
  // Build 448: the snapshot ends at its latest settled record; Core learns after it.
  assert.equal(ledger.schema, 4);
  assert.equal(ledger.through_ms, 300);
});

test('build 448 p_fail rule (Core lawJudgedOutcome): a local draft counts only by its REVAS check, the check record judges the draft', () => {
  const base = {schema: 1, route_kind: 'law', escalated: false, verifier_outcome: 'not_registered', law: {family: 'F2'}, settled_at_ms: 10};
  const local = {...base, surface: 'local', model: 'qwen3.5:9b', effort: 'none'};
  // Live q2 on 447: a factual error passed the structural screen: no verdict.
  assert.deepEqual(lawJudgedOutcome({...local, check_outcome: 'screen_pass'}), {excluded: 'local_screen_only'});
  assert.deepEqual(lawJudgedOutcome({...local, attempt_state: 'revas_check_pending'}), {excluded: 'unjudged'});
  // An empty local draft is a structural failure of the local row.
  assert.equal(lawJudgedOutcome({...local, attempt_state: 'ladder_not_returned', check_outcome: 'screen_fail'}).failed, true);
  // The check record (the judge's row) is the draft's judged outcome, never the judge's.
  const check = {...base, surface: 'claude-chat', model: 'claude-opus-5-5', effort: 'max', attempt_state: 'revas_check_returned',
    revas: {role: 'check', family: 'F2', draft_model: 'qwen3.5:9b', draft_effort: 'none'}};
  assert.deepEqual(lawJudgedOutcome({...check, check_outcome: 'revas_fail'}),
    {key: 'qwen3.5:9b@none|F2', model: 'qwen3.5:9b', effort: 'none', family: 'F2', failed: true});
  assert.equal(lawJudgedOutcome({...check, check_outcome: 'revas_pass'}).failed, false);
  assert.deepEqual(lawJudgedOutcome({...check, check_outcome: 'revas_no_verdict'}), {excluded: 'unjudged'});
  // The repair is an escalated attempt: never a descent.
  assert.equal(lawJudgedOutcome({...check, route_kind: 'reference', escalated: true, revas: {role: 'repair'}}), null);
  // A cloud descent keeps its screen verdict (its verifier is the screen).
  assert.equal(lawJudgedOutcome({...base, surface: 'claude-chat', model: 'claude-opus-5-5', effort: 'medium',
    check_outcome: 'screen_pass'}).failed, false);
  // Live learning adds only records after the table's snapshot.
  const learned = lawLearnedPFail([JSON.stringify({...check, check_outcome: 'revas_fail', settled_at_ms: 5}),
    JSON.stringify({...check, check_outcome: 'revas_pass', settled_at_ms: 50}),
    JSON.stringify({...check, check_outcome: 'revas_pass', settled_at_ms: 60})].join('\n'), 10);
  assert.deepEqual(learned.get('qwen3.5:9b@none|F2'), {runs: 2, failures: 0});
  const localRow = {surface: 'local', model: 'qwen3.5:9b', effort: 'none'};
  assert.equal(lawPFail(TABLE, localRow, 'F2'), 0.5);
  assert.equal(lawPFail(TABLE, localRow, 'F2', null, learned), 1 / 4);
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
      // Build 448: owner_order is gone; a local row starts only as a REVAS
      // verified start ('v:' its judge) or is admitted by an audit ('c:') or
      // by its family's deterministic verifier ('a:' its id).
      assert.match(form, /^(?:reference|b:.+|c:audit-[a-f0-9]{12}|a:[a-z0-9_]+|v:(?:none|[a-z-]+:[a-z0-9.:-]+@[a-z]+)|x:.*)$/);
      // (Receipt values are rounded to 1e-6: a reference's E[Q] is exactly Q x rate.)
      assert.ok(excluded === null ? Number.isFinite(eq) && eq >= quota * receipt.rates[key.startsWith('codex') ? 'openai_codex' :
        'anthropic_shared']?.rate - 2e-6 || key.startsWith('local') : eq === null, `#${q.n} ${key}`);
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
  assert.equal(plain.route, 'claude:claude-opus-5-5@medium');
  assert.ok(eqOf(scarce, 'claude:claude-opus-5-5@medium')[3] < eqOf(scarce, 'claude:claude-fable-5-1@max')[3]);
  // Across pools the derived exchange decides. A writer below its reference
  // binds no ladder, so nothing runs after it: its E[Q] is Q alone (round 3
  // of the 448 review, decision 2), and at 8 per Claude unit opus@medium is
  // still the argmin; at 40 per Claude unit (1% left, 0.4 of the week to
  // run) the Codex reference (Q alone: the top of the frontier) is.
  assert.equal(scarce.route, 'claude:claude-opus-5-5@medium');
  assert.equal(scarce.law.argmin, scarce.route);
  assert.match(scarce.reason, /;law_rate_Cw_8\.0000;/);
  assert.match(scarce.reason, /;law_rate_Px_1\.1667;/); // 0.7 of the week to run, 60% left
  const scarcer = routeOf(q.request, pooled(99, 40));
  assert.equal(scarcer.route, 'codex:gpt-6-astra@ultra');
  assert.ok(eqOf(scarcer, scarcer.route)[3] < eqOf(scarcer, 'claude:claude-opus-5-5@medium')[3]);
  assert.match(scarcer.reason, /;law_rate_Cw_40\.0000;/);
  // An exhausted pool prices nothing: its rows are excluded, never chosen.
  const spent = routeOf(question(3).request, lawOf(question(3), c => ({...c, routing_law: {...c.routing_law, pools: {
    openai_codex: {observed_at_ms: clockOf(c) - 1000, valid_until_ms: clockOf(c) + 600_000,
      windows: [{used_percent: 100, resets_at_ms: clockOf(c) + 86_400_000, window_minutes: 10080}]}}}})));
  assert.equal(spent.law.rates.openai_codex.rate, 'exhausted');
  assert.ok(spent.law.candidates.filter(([key]) => key.startsWith('codex')).every(([, , , , excluded]) =>
    excluded === 'pool_exhausted' || excluded === 'no_evidence'));
  assert.ok(!spent.route.startsWith('codex'));
});

test('one pricing (round 3 of the 448 review, decision 2): E[Q] prices the runtime\'s escalation event; the gate is the draw', () => {
  // F4 (owner question 3). A pool reference is the top of the frontier and
  // binds no ladder: nothing runs after it, so its E[Q] is Q alone (448
  // priced a self-repair there that never runs).
  const q = question(3);
  const routed = routeOf(q.request, lawOf(q));
  const cand = key => routed.law.candidates.find(([k]) => k === key);
  const rate = pool => routed.law.rates[pool].rate;
  const [, , qFable, eqFable] = cand('claude-chat:claude-fable-5-1@max');
  const [, , qAstra, eqAstra] = cand('codex:gpt-6-astra@ultra');
  assert.ok(Math.abs(eqFable - qFable * rate('anthropic_shared')) < 2e-6, 'a reference: Q x rate');
  assert.ok(Math.abs(eqAstra - qAstra * rate('openai_codex')) < 2e-6, 'a reference: Q x rate');
  // Round 3 of the 448 review (decision 2): a read-only row below the
  // reference (form b) escalates only when it fails the runtime's STRUCTURAL
  // screen (empty, cut off, an error: no draft to repair), to the full answer
  // at its target: Q + p_screen x Q(target). p_screen is measured from the
  // ledger's screened attempts (the same screen for every row, pooled over
  // families), Laplace-smoothed, starting from its own pool reference's
  // screen rate; a tier gap never triggers the escalation and is not priced.
  const [, form, qOpus, eqOpus] = cand('claude-chat:claude-opus-5-5@max');
  assert.match(form, /^b:/);
  const opus = {model: 'claude-opus-5-5', effort: 'max'}, fable = {model: 'claude-fable-5-1', effort: 'max'};
  const pScreen = lawScreenPFail(TABLE, opus, fable);
  const screenOf = key => TABLE.p_screen.cells[key] ?? {runs: 0, failures: 0};
  const pRef = (screenOf('claude-fable-5-1@max').failures + 1) / (screenOf('claude-fable-5-1@max').runs + 2);
  assert.ok(Math.abs(pScreen - (screenOf('claude-opus-5-5@max').failures + 2 * pRef) / (screenOf('claude-opus-5-5@max').runs + 2)) < 1e-12);
  assert.ok(Math.abs(eqOpus - (qOpus + pScreen * qFable) * rate('anthropic_shared')) < 1e-5, 'opus: Q + p_screen x Q(fable)');
  // The argmin of the two prices is the route (and the fixture's golden).
  assert.equal(routed.route, eqOpus < eqFable ? 'claude-chat:claude-opus-5-5@max' : 'claude-chat:claude-fable-5-1@max');
  assert.equal(routed.route, q.expected_route);
  // The gate is judged on the draw (what the runtime runs), and every owner
  // question's draw is the receipt's E[Q] at the recorded headroom; a
  // writer's next step (its pool reference, which the runtime never runs:
  // no writer ladder) is in the law_model REPORT only.
  for (const question of OWNER.questions) {
    if (question.pending || question.expected_kind === 'calculator' || question.expected_kind === 'ask_back') continue;
    const law = lawOf(question);
    const r = routeOf(question.request, law);
    const rates = Object.fromEntries(Object.entries(r.law.rates).map(([pool, v]) => [pool, v.rate === 'exhausted' ? Infinity : v.rate]));
    const priced = basis => Object.entries({Cw: 'anthropic_shared', Px: 'openai_codex'}).reduce((sum, [unit, pool]) => {
      const p = priceRoute(r, law, r.law.shape, TABLE, r.law.family, law.routing_law.reading)[basis][unit];
      return p === 0 ? sum : sum + p * rates[pool];
    }, 0);
    assert.ok(Math.abs(priced('draw') - r.law.eq) < 2e-6, `#${question.n} draw ${priced('draw')} vs eq ${r.law.eq}`);
    if (r.scope === 'workspace_write' && r.kind !== 'reference') assert.ok(priced('law_model') > priced('draw'), `#${question.n} writer`);
    else assert.ok(Math.abs(priced('law_model') - r.law.eq) < 2e-6, `#${question.n} law_model ${priced('law_model')} vs eq ${r.law.eq}`);
  }
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

test('every pool reference is admissible for every family; current facts follow the derived exchange', () => {
  const q = question(7); // F5a: T1F, published by Codex only
  const routed = routeOf(q.request, lawOf(q));
  assert.equal(routed.law.family, 'F5a');
  // Review of 447 (DESIGN-8: 'The reference is always admissible'): Fable is
  // admissible for F5a although Claude publishes no T1F, as all-reference admits it.
  const fable = routed.law.candidates.find(([key]) => key === 'claude:claude-fable-5-1@max');
  assert.deepEqual([fable[1], fable[4]], ['reference', null]);
  const astra = routed.law.candidates.find(([key]) => key === 'codex:gpt-6-astra@ultra');
  assert.deepEqual([astra[1], astra[4]], ['reference', null]);
  assert.equal(routed.route, 'claude:claude-fable-5-1@max'); // the cheaper reference at the recorded exchange
  // Price-monotone substitution: Claude scarce, Codex plentiful moves F5a to Codex.
  const scarce = lawOf(q, c => ({...c, routing_law: {...c.routing_law, pools: {
    anthropic_shared: {observed_at_ms: clockOf(c) - 1, valid_until_ms: clockOf(c) + 600_000,
      windows: [{used_percent: 95, resets_at_ms: clockOf(c) + 0.4 * 604_800_000, window_minutes: 10080}]},
    openai_codex: {observed_at_ms: clockOf(c) - 1, valid_until_ms: clockOf(c) + 600_000,
      windows: [{used_percent: 38, resets_at_ms: clockOf(c) + 0.4 * 604_800_000, window_minutes: 10080}]}}}}));
  assert.equal(routeOf(q.request, scarce).route, 'codex:gpt-6-astra@ultra');
  // A family no pool publishes a tier for (small talk on a later turn, F1):
  // every pool reference stays admissible.
  const chat = lawOf(question(12), c => ({...c, candidates: c.candidates.filter(row => row.surface !== 'local')}));
  const talked = routeOf(question(12).request, chat);
  assert.equal(talked.law.family, 'F1');
  assert.ok(talked.law.candidates.filter(([, form]) => form === 'reference').length >= 2);
  // With no Codex pool in the catalog, the Claude reference is the argmin (no fallback needed).
  const claudeOnly = lawOf(q, c => ({...c, candidates: c.candidates.filter(row => row.quota_pool !== 'openai_codex')}));
  const only = routeOf(q.request, claudeOnly);
  assert.match(only.route, /claude-fable-5-1@max$/);
  assert.match(only.reason, /law_argmin_reference/);
});

test('a row whose own pool reference cannot run escalates to the other pool\'s reference; a writer needs none', () => {
  const q = question(6);
  const noFable = c => ({...c, candidates: c.candidates.map(row => row.model === 'claude-fable-5-1' ?
    {...row, availability: 'unavailable'} : row)});
  const wrote = routeOf(q.request, lawOf(q, noFable));
  assert.equal(wrote.route, 'claude:claude-opus-5-5@medium'); // a writer binds no ladder: no runnable reference needed
  assert.equal(wrote.ladder, null);
  // Build 448: a local verified start escalates (repair mode) to its own
  // REVAS judge, an admissible row fixed at bind, whatever pool it is in.
  const q11 = question(11);
  const local = lawOf(q11, c => noFable({...c, candidates: c.candidates}));
  const routed = routeOf(q11.request, local);
  assert.equal(routed.route, 'local:qwen3.5:9b@none');
  const judge = local.candidates.find(row => row.id === routed.ladder.reference_candidate_id);
  assert.equal(routed.ladder.verifier.candidate_id, judge.id);
  assert.notEqual(judge.model, 'claude-fable-5-1');
  // A read-only law row below its reference (opus@max on F4) with its own
  // pool's reference unavailable is priced to the other pool's reference.
  const opus = lawOf(question(3), c => noFable({...c, candidates: c.candidates}));
  const ex = routeOf(question(3).request, opus).law.candidates.find(([key]) => key === 'claude-chat:claude-opus-5-5@max');
  assert.notEqual(ex[4], 'requires_runnable_reference', 'priced to the other pool\'s reference, not excluded');
});

test('round 3 (decision 4): the owner-decision class certificate never decides a node the law routes; a write with no tool need is an answer', () => {
  // The one certificate the class table signs (owner-chat-fast-20261027:
  // codex gpt-6-luna@low for chat_explanatory) is an owner decision, not a
  // REVAS paired parity audit, so it is no form (c) evidence either: under
  // the law it is retired, whether or not its tuple can run. The law decides
  // small talk (F1) by its argmin over every row its deterministic verifier
  // admits; the certificate binds only where the law does not apply.
  const q = question(12);
  const certificate = {certificate_id: 'owner-chat-fast-20261027', provider: 'codex', model: 'gpt-6-luna', effort: 'low',
    format_check: 'nonempty_text', measurement_sha256: 'a'.repeat(64)};
  const certified = lawOf(q, c => ({...c, request_class: 'chat_explanatory', class_certificates: {chat_explanatory: certificate}}));
  assert.ok(certified.candidates.some(row => row.model === 'gpt-6-luna' && row.effort === 'low' && row.availability === 'available'));
  const exhausted = {...certified, candidates: certified.candidates.filter(row => row.quota_pool !== 'openai_codex')};
  for (const catalog of [certified, exhausted]) {
    const routed = routeOf(q.request, catalog);
    assert.doesNotMatch(routed.reason, /admitted_certified_class/);
    assert.match(routed.reason, /admitted_law_F1/);
    // The law's argmin (review of round 3: F1 has no admitted row below the
    // reference: a reference binds).
    assert.equal(routed.route, routed.law.argmin);
    const pick = routed.law.candidates.find(([key]) => key === routed.law.argmin);
    assert.equal(pick[1], 'reference');
    for (const [key, , , eq, excluded] of routed.law.candidates)
      if (excluded === null && key !== pick[0]) assert.ok(eq >= pick[3] - 1e-9, key);
  }
  // The all-reference arm (the owner's reference words, family P) binds a
  // pool reference only: the certificate never stands in for it.
  const allRef = routeOf(q.request, {...certified, routing_law: {...certified.routing_law, reference_request: true}});
  assert.equal(allRef.law.family, 'P');
  assert.ok(Object.values(TABLE.references).includes(allRef.candidate.model), allRef.route);
  // Where the law does not apply (routing_policy=law_446: no routing_law), the
  // certificate still binds its tuple.
  const legacy = {...certified}; delete legacy.routing_law;
  assert.match(routeOf(q.request, legacy).reason, /admitted_certified_class/);
  // A light write reading with no tool need on a writer node (an inline text
  // edit) has no workspace target: priced as an answer, not agentic turns.
  const w = question(6);
  const inline = lawOf(w, c => ({...c, routing_law: {...c.routing_law,
    reading: {task_type: 'write', difficulty: 'light', needs_tools: 'none', domain: 'general'}}}));
  const edited = routeOf(w.request, inline);
  assert.equal(edited.scope, 'workspace_write');
  assert.equal(edited.law.shape, 'answer');
});

test('review of 447: a request that names a file never takes the tool-less local row; every route names the rates', () => {
  const q = question(11);
  assert.equal(routeOf(q.request, lawOf(q)).route, 'local:qwen3.5:9b@none');
  const named = {...q, request: 'README.md 설명해줘'};
  const law = lawOf(named, c => ({...c, request_sha256: sha(named.request)}));
  const routed = routeOf(named.request, law);
  assert.notEqual(routed.candidate.surface, 'local');
  assert.ok(!routed.law.candidates.some(([key]) => key.startsWith('local:')));
  assert.ok(routed.law.candidates.filter(([, , , , excluded]) => excluded === null).every(([key]) => !key.startsWith('claude-chat:')),
    'only rows that can read the file');
  // A route the law did not decide (an owner's explicit route) still names each pool's derived rate.
  const explicit = routeOf(question(16).request, lawOf(question(16)));
  assert.match(explicit.reason, /law_rate_Px_[0-9.]+;law_rate_Cw_[0-9.]+|law_rate_Px_[0-9.]+.*law_rate_Cw_/);
});

test('review of 447: a cell within tau but below its reference adds its measured gap to the inherited p_fail', () => {
  // gpt-6.1-sol@high on T1 scores 0.9 points below Astra's best: excess 0.009.
  const evidence = lawEvidence(TABLE, ['T1'], 'openai_codex', 'gpt-6.1-sol', 'high', 'F12');
  assert.equal(evidence.form, 'b');
  assert.ok(Math.abs(evidence.excess - 0.009) < 1e-9);
  assert.equal(lawEvidence(TABLE, ['T1'], 'anthropic_shared', 'claude-opus-5-5', 'max', 'F12').excess, 0); // above the reference
  assert.equal(TABLE.admission.T1F.openai_codex.cells['gpt-6.1-sol@max'].excess_fail, 0.0071);
  // A provisional (cost-sized) audit pass admits nothing; a parity audit does.
  const provisional = {...TABLE, audits: {cells: {'claude-haiku-4-5-20251001@none|F4': {verdict: 'pass', id: 'audit-aaaaaaaaaaaa',
    n: 3, discordant: 0, n_parity: 2558, admits: false}}}};
  const p = lawEvidence(provisional, 'F4', 'anthropic_shared', 'claude-haiku-4-5-20251001', 'none');
  assert.deepEqual([p.form, p.provisional_audit], ['none', 'audit-aaaaaaaaaaaa']);
  const parity = {...TABLE, audits: {cells: {'claude-haiku-4-5-20251001@none|F4': {verdict: 'pass', id: 'audit-bbbbbbbbbbbb',
    n: 2558, discordant: 0, n_parity: 2558, admits: true}}}};
  assert.equal(lawEvidence(parity, 'F4', 'anthropic_shared', 'claude-haiku-4-5-20251001', 'none').form, 'c');
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
    if (lawDeterministicVerifier(TABLE, read.law.family) !== null) {
      // Round 3 (decision 5): small talk needs no tool and no write, so its
      // node runs read-only in a writer lane too (a permission only narrows):
      // the same rows, the same argmin, the verifier read on its answer.
      assert.equal(wrote.scope, 'read_only', `#${n}`);
      assert.equal(wrote.route, read.route, `#${n}`);
      assert.equal(wrote.ladder?.verifier?.kind, 'deterministic', `#${n}`);
      // Never past a deterministic work floor of the host's profile: a hard
      // order, shell or write beside a chat reading is DESIGN-6 G1 (a
      // side-effect disagreement), not small talk: the writer keeps its grant.
      const work = {answer_kind: 'work', difficulty: 'unknown'};
      for (const floor of [{...work, signals: ['shell']}, {...work, signals: ['work_order']},
        {...work, signals: ['write_scope']}, {tool_need: 'workspace', signals: ['named_path']}]) {
        const floored = lawOf(q, c => ({...writer, request_profile: {...c.request_profile, ...floor,
          signals: [...new Set([...c.request_profile.signals.filter(x => !x.startsWith('soft_')), ...floor.signals])].sort()}}));
        assert.equal(routeOf(q.request, floored).scope, 'workspace_write', `#${n} ${JSON.stringify(floor)}`);
      }
      // A soft (clearable) order the reading set aside is no floor.
      const soft = lawOf(q, c => ({...writer, request_profile: {...c.request_profile, ...work,
        signals: [...new Set([...c.request_profile.signals, 'work_order', 'soft_work'])].sort()}}));
      assert.equal(routeOf(q.request, soft).scope, 'read_only', `#${n} soft order`);
      continue;
    }
    assert.equal(wrote.scope, 'workspace_write', `#${n}`);
    assert.equal(wrote.ladder, null, `#${n} a writer binds no ladder`);
    if (q.expected_route.startsWith('local:') || read.law.shape !== wrote.law.shape ||
        read.ladder?.verifier?.kind === 'deterministic') {
      // The local model has no tools: a writer moves to the family's tooled
      // argmin (DESIGN-6 §5), the cheapest admissible writer row by the law.
      // Build 448: so does a row admitted by a deterministic family verifier
      // (form a): the check runs on a read-only law attempt's answer, and a
      // writer binds no ladder, so no check runs on its answer and the
      // verifier is no evidence there (what c may do, never a preference).
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

// ---- Build 448: DESIGN-8 step 5 (REVAS) on a local verified start ----------
// Live q2 on 447 ('파이썬 list와 tuple 차이 설명해봐', owner question 11) bound
// the local row on basis owner_order and delivered this factual error past the
// structural screen (a tuple IS indexed like a list).
const Q2_DRAFT = '리스트는 변형이 가능하지만 튜플은 한 번 생성되면 수정할 수 없습니다. 또한 리스트는 배열처럼 인덱스를 통해 ' +
  '접근하는 반면, 튜플은 주로 고정된 데이터 집합을 표현하는 데 사용됩니다.';
const Q2_FINDING = '"튜플은 ... 인덱스를 통해 접근하는 반면" is wrong: a tuple is indexed exactly like a list (t[0], slicing); ' +
  'the difference is mutability (and hashability), not indexing.';
const Q2_REPAIRED = '리스트와 튜플 모두 인덱스(t[0])와 슬라이싱으로 접근합니다. 차이는 변경 가능성입니다: 리스트는 수정할 수 있고 ' +
  '튜플은 생성 후 수정할 수 없으며, 그래서 튜플은 해시 가능해 딕셔너리 키로 쓸 수 있습니다.';

test('build 448: the local row is admissible only by (a) or (c); otherwise it starts only as a priced REVAS verified start', () => {
  const q = question(11);
  const routed = routeOf(q.request, lawOf(q));
  assert.equal(routed.route, 'local:qwen3.5:9b@none');
  assert.equal(routed.route, q.expected_route);
  const local = routed.law.candidates.find(([key]) => key === routed.route);
  // Its basis is the check, never the owner's order.
  assert.equal(local[1], 'v:' + q.expected_check);
  assert.match(routed.reason, /;law_evidence_verified_start;law_revas_check_[^;]+;law_revas_repair_same_row;/);
  // Its E[Q] is the check plus p_fail x the repair, both at the judge's rate,
  // and the judge is the admissible row minimizing it.
  const v = routed.ladder.verifier;
  const judge = lawOf(q).candidates.find(row => row.id === v.candidate_id);
  assert.equal(lawKey(judge), q.expected_check);
  assert.equal(routed.ladder.reference_candidate_id, judge.id, 'the repair runs at the check\'s own row (cache reuse)');
  const qv = lawQuota(TABLE, judge, 'verify').q, qr = lawQuota(TABLE, judge, 'repair').q;
  // Review of round 3: an unsound draft (the local row's screen rate p_s) is
  // answered in full at the judge, never checked.
  const ps = lawScreenPFail(TABLE, {model: 'qwen3.5:9b', effort: 'none'}, null);
  assert.ok(Math.abs(local[3] - ((1 - ps) * (qv + 0.5 * qr) + ps * lawQuota(TABLE, judge, 'answer').q) * v.rate) < 1e-5);
  assert.ok(qv > lawQuota(TABLE, judge, 'answer').q, 'a check is priced at least as an answer while unmeasured (upper bound)');
  assert.deepEqual(routed.law.revas, {schema: 1, judge: lawKey(judge), q_verify: qv, q_repair: qr, p_fail: 0.5,
    repair: 'same_row_prefix_cached'});
  for (const [key, form, , eq, excluded] of routed.law.candidates) {
    if (excluded !== null || key === routed.route) continue;
    assert.match(form, /^(?:reference|b:.+|c:.+)$/);
    assert.ok(eq >= local[3] - 1e-9, `${key} is not cheaper than the verified start`);
  }
  // A passed parity audit of local@none admits it (form c): no check then.
  const audited = structuredClone(TABLE);
  audited.audits.cells['qwen3.5:9b@none|F2'] = {verdict: 'pass', admits: true, id: 'audit-0123456789ab', n: 30};
  assert.deepEqual(lawLocalEvidence(audited, 'qwen3.5:9b', 'F2'), {form: 'c', audit: 'audit-0123456789ab', tiers: [], excess: 0});
  assert.equal(lawLocalEvidence(TABLE, 'qwen3.5:9b', 'F2'), null, 'no deterministic verifier, no audit: not admissible');
  // F1 (small talk): Core's deterministic verifier would be evidence (a)
  // (lead order 2026-10-31) once its held-out validation passes; review of
  // round 3: it failed its frozen routed held-out set F (5 false passes), so
  // it admits nothing and the local row has no (a) evidence there either.
  const admitted = structuredClone(TABLE);
  admitted.deterministic_verifiers.F1.validation.admits = true;
  assert.deepEqual(lawLocalEvidence(admitted, 'qwen3.5:9b', 'F1'), {form: 'a', verifier: 'no_claim_reply_v2', tiers: [], excess: 0});
  assert.equal(lawLocalEvidence(TABLE, 'qwen3.5:9b', 'F1'), null);
  assert.deepEqual(Object.keys(TABLE.deterministic_verifiers), ['F1']);
  assert.equal(TABLE.deterministic_verifiers.F1.id, 'no_claim_reply_v2');
  assert.equal(TABLE.deterministic_verifiers.F1.validation.admits, false);
  const q12 = question(12);
  const small = routeOf(q12.request, lawOf(q12));
  assert.equal(small.route, q12.expected_route);
  assert.ok(!small.law.candidates.some(([, form]) => form.startsWith('a:')), 'no det admission');
  // F1 publishes no tier: no row below the reference has evidence, and a
  // verified start's check at a reference costs more than its answer.
  assert.equal(small.kind, 'reference');
});

test('build 448: REVAS prompts and verdicts: one byte-identical prefix, a first-line verdict, numbered findings', () => {
  const request = question(11).request;
  const check = revasCheckInstruction(request, Q2_DRAFT), repair = revasRepairInstruction(request, Q2_DRAFT, [Q2_FINDING]);
  const prefix = revasPrefix(request, Q2_DRAFT);
  assert.ok(check.startsWith(prefix) && repair.startsWith(prefix), 'the repair reuses the check\'s prefix');
  assert.ok(repair.includes('1. ' + Q2_FINDING) && /fix only what the findings name/.test(repair));
  assert.deepEqual(revasVerdict('REVAS: PASS'), {verdict: 'pass', findings: []});
  assert.deepEqual(revasVerdict('\n**REVAS: FAIL**\n1. ' + Q2_FINDING + '\n2) missing hashability\n- third'),
    {verdict: 'fail', findings: [Q2_FINDING, 'missing hashability', 'third']});
  assert.deepEqual(revasVerdict('REVAS: FAIL'), {verdict: 'fail', findings: []});
  for (const text of ['', 'PASS', 'The draft looks fine. REVAS: PASS', 'REVAS: MAYBE', null])
    assert.deepEqual(revasVerdict(text), {verdict: null, findings: []});
});

test('build 448 (live q2): the REVAS check catches the local draft\'s factual error; repair mode at the same row fixes only it', async t => {
  const q = question(11);
  const law = lawOf(q);
  const routed = routeOf(q.request, law);
  const judge = law.candidates.find(row => row.id === routed.ladder.verifier.candidate_id);
  const {done, tickets, ledger, text, saved} = await harness(t, q, law, (ticket, n) =>
    completed(ticket, {output: n === 1 ? Q2_DRAFT : n === 2 ? 'REVAS: FAIL\n1. ' + Q2_FINDING : Q2_REPAIRED,
      usage: n === 1 ? undefined : {input_tokens: 1000, cache_read_tokens: n === 3 ? 900 : 0, output_tokens: n === 2 ? 60 : 120}}));
  // Three dispatches: the local draft, the check at the judge, the repair at the SAME row.
  assert.deepEqual(tickets.map(tuple), ['local:qwen3.5:9b@none', lawKey(judge), lawKey(judge)]);
  assert.equal(tickets[0].instruction, q.request);
  assert.equal(tickets[1].instruction, revasCheckInstruction(q.request, Q2_DRAFT));
  assert.equal(tickets[2].instruction, revasRepairInstruction(q.request, Q2_DRAFT, [Q2_FINDING]));
  assert.equal(tickets[1].native_resume_session_id, null);
  // The error never reaches the owner; the repaired answer does.
  assert.equal(done.result.output, Q2_REPAIRED);
  assert.ok(!done.result.output.includes('튜플은 주로 고정된'));
  // Receipts: the draft (awaiting its check), the check (its verdict judges
  // the DRAFT's row), the repair (size, cache reuse, priced quota, p_fail).
  const [draft, check, repair] = ledger;
  assert.deepEqual([draft.surface, draft.attempt_state, draft.delivery_basis, draft.check_outcome],
    ['local', 'revas_check_pending', 'law:F2', null]);
  assert.deepEqual([check.model, check.check_outcome, check.revas.role, check.revas.draft_model, check.revas.family, check.escalated],
    [judge.model, 'revas_fail', 'check', 'qwen3.5:9b', 'F2', false]);
  assert.equal(check.verifier_outcome, 'not_registered', 'a check\'s verdict is never a failure of the judge\'s own row');
  assert.deepEqual([repair.escalated, repair.delivery_basis, repair.revas.role, repair.revas.mode, repair.revas.findings,
    repair.revas.same_row, repair.revas.verdict], [true, 'reference_escalated', 'repair', 'repair', 1, true, 'revas_fail']);
  assert.ok(repair.revas.findings_bytes > 0 && repair.revas.draft_bytes === Buffer.byteLength(Q2_DRAFT));
  assert.deepEqual([repair.revas.q_verify, repair.revas.q_repair, repair.revas.p_fail_family],
    [routed.law.revas.q_verify, routed.law.revas.q_repair, 0.5]);
  assert.deepEqual(repair.revas.check_usage, {input_tokens: 1000, cache_read_tokens: 0, output_tokens: 60});
  assert.equal(repair.usage.cache_read_tokens, 900, 'the repair\'s own usage shows the reused prefix');
  assert.equal(check.revas.prefix_sha256, repair.revas.prefix_sha256);
  assert.equal(check.revas.prefix_sha256, sha(revasPrefix(q.request, Q2_DRAFT)));
  // Every outcome updates p_fail: the ledger counts one failure of local@F2.
  assert.deepEqual(lawLearnedPFail(text, 0).get('qwen3.5:9b@none|F2'), {runs: 1, failures: 1});
  assert.deepEqual(saved.children[0].revas.findings, [Q2_FINDING]);
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]}).verdict, 'PASS');
});

test('build 448: a REVAS pass adopts the local draft as produced; no verdict escalates in full; the runtime learns', async t => {
  const q = question(11);
  const law = lawOf(q);
  const passed = await harness(t, q, law, (ticket, n) => completed(ticket, {output: n === 1 ? 'a correct local answer' : 'REVAS: PASS'}));
  assert.equal(passed.tickets.length, 2);
  assert.equal(passed.done.result.output, 'a correct local answer');
  const child = passed.done.children[0];
  assert.deepEqual([child.selected_config.surface, child.attempt_id], ['local', passed.tickets[0].attempt_id],
    'the delivered attempt is the draft, on its own row');
  assert.equal(passed.done.result.native_receipt === null || typeof passed.done.result.native_receipt === 'string', true);
  assert.equal(passed.ledger[1].check_outcome, 'revas_pass');
  assert.deepEqual(lawLearnedPFail(passed.text, 0).get('qwen3.5:9b@none|F2'), {runs: 1, failures: 0});
  // The delivery audit: the delivered draft is backed by its own check's pass.
  const deliveredDraft = {task_id: passed.saved.task.task_id, snapshot: JSON.stringify(passed.saved)};
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text: passed.text}], snapshots: [deliveredDraft]}).verdict, 'PASS');
  const unchecked = passed.text.split('\n').filter(line => !line.includes('"role":"check"')).join('\n');
  assert.deepEqual(auditDeliveryPolicy({ledgers: [{path: 'fixture', text: unchecked}], snapshots: [deliveredDraft]})
    .violations.map(v => v.rule), ['law_delivery_without_revas_pass']);
  // No verdict: the draft is discarded and the judge answers in full (the request only).
  const silent = await harness(t, q, law, (ticket, n) => completed(ticket, {output: n === 1 ? 'a local answer' :
    n === 2 ? 'I think it is mostly fine.' : 'the full answer'}));
  assert.equal(silent.tickets.length, 3);
  assert.equal(silent.tickets[2].instruction, q.request);
  assert.equal(silent.done.result.output, 'the full answer');
  assert.equal(silent.ledger[2].revas.mode, 'full');
  assert.equal(lawLearnedPFail(silent.text, 0).get('qwen3.5:9b@none|F2'), undefined, 'no verdict is no evidence');
});

test('build 448: p_fail learning moves E[Q] a priori (DESIGN-6 O5.3): judged REVAS outcomes move the F2 verified start\'s E[Q]', async t => {
  // Review of round 3: small talk has no admitted deterministic verifier, so
  // the a-priori move is shown on the local verified start (F2, owner
  // question 11): its REVAS checks are its judged outcomes.
  const q = question(11);
  const catalog = lawOf(q);
  const prior = routeOf(q.request, catalog);
  assert.equal(prior.route, q.expected_route);
  assert.equal(prior.route, 'local:qwen3.5:9b@none');
  const plan = hostPlan(runtimeTask(q, catalog), catalog);
  const id = plan.nodes[0].id;
  const at = learned => resolveRoutePlan(plan, runtimeTask(q, catalog), catalog, clockOf(catalog), {lawLearned: learned});
  // Judged local failures after the snapshot raise its E[Q] (a failed check
  // repairs at the judge, priced at the learned p_fail); judged passes lower
  // it: the ledger, not a fixed prior, moves the price before the run.
  const modelOf = r => catalog.candidates.find(row => row.id === r.decisions[id].resolved_candidate_id).model;
  const localOf = r => r.routes[id].law.candidates.find(([key]) => key.startsWith('local:'));
  const failed = at(new Map([['qwen3.5:9b@none|F2', {runs: 400, failures: 400}]]));
  assert.equal(localOf(failed)[1].slice(0, 2), 'v:');
  assert.ok(localOf(failed)[3] > prior.law.eq + 1e-6, 'failures raise the verified start\'s E[Q]');
  const passed = at(new Map([['qwen3.5:9b@none|F2', {runs: 60, failures: 0}]]));
  assert.equal(modelOf(passed), 'qwen3.5:9b');
  assert.ok(localOf(passed)[3] < prior.law.eq - 1e-6, 'passes lower it');
  // The durable Core learns the same from its own routing ledger at start
  // (records after the table's snapshot, Core lawJudgedOutcome): a local
  // answer's deterministic verdict is its judged outcome.
  const dir = await mkdtemp(join(tmpdir(), 'os1-law-learn-')); await chmod(dir, 0o700);
  t.after(() => rm(dir, {recursive: true, force: true}));
  const after = (TABLE.p_fail.through_ms ?? 0) + 1;
  const record = n => ({schema: 1, task_id: 'seed', node_id: 'node_0', attempt_id: 'seed-' + n, route_kind: 'law', escalated: false,
    surface: 'local', model: 'qwen3.5:9b', effort: 'none', verifier_outcome: 'not_registered', settled_at_ms: after + n,
    attempt_state: n === 3 ? 'ladder_verifier_failed' : 'completed', check_outcome: n === 3 ? 'det_fail' : 'det_pass',
    law: {family: 'F1'}, ladder: {det_verifier: 'no_claim_reply_v2'}});
  const ledger = openRoutingLedger(dir);
  for (const n of [1, 2, 3]) ledger.append(record(n));
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => catalog, execute: async () => { throw new Error('x'); }});
  t.after(() => runtime.close());
  assert.deepEqual(runtime.lawLearned.get('qwen3.5:9b@none|F1'), {runs: 3, failures: 1});
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
  // Build 448 (live q1 on 447): no native receipt and not task-verified, so it
  // claims no verified execution; the host contract rejected the snapshot
  // while it did (Tests/OS1ContextTests/RCCAskBackHostFixture.swift decodes
  // this very snapshot through RCCRuntimeContract.decodeSnapshot).
  assert.equal(done.result.execution_verified, false);
  assert.equal(done.result.native_receipt, null);
  assert.equal(saved.law_receipt.family, 'F10');
  assert.equal(saved.plan_provenance, 'local_reading_ask_back');
  assert.equal(saved.resource_events[0].reason, 'host_local_reading_ask_back:' + lawOf(q).routing_law.reader);
  assert.equal(saved.resource_events[0].model, 'ollama/qwen3.5:9b');
});

// ---- Build 448: DESIGN-8 step 2 (a), small talk's deterministic verifier --
// Lead order 2026-10-31: for small talk the reference's result has no factual
// content, so its quality criterion is checked by Core's own code. Review of
// 448: no_claim_reply_v1's open whitelists passed claims (withdrawn);
// no_claim_reply_v2 is a closed grammar validated on frozen held-out sets.
// The local draft below is qwen3.5:9b's real reply to owner question 12 (local
// Ollama, the production local chat prompt, temperature 0; byte-identical on
// 2026-10-31 in three independent runs).
const Q12_LOCAL_DRAFT = '안녕하세요! 저는 오늘도 정상적으로 작동하고 있습니다. 하지만 저는 감정이나 피로를 느끼지 못해요. ' +
  '혹시 너무 지치셨다면 잠시 쉬어가시는 게 좋겠습니다.';
const SMALL_TALK_PASS = '오늘 하루 정말 고생 많으셨어요. 무슨 일 있으셨어요? 푹 쉬세요!';
const SMALL_TALK_CLAIM = '피곤할 때는 카페인보다 수분 섭취가 도움이 돼요.';
const SMALL_TALK_REFUSAL = '죄송하지만 답변해 드릴 수 없습니다.';
const V2 = 'no_claim_reply_v2';

test('build 448 (a): no_claim_reply_v2 is a closed grammar: courtesy built from closed lists and the owner\'s words passes; any claim fails', () => {
  const R = question(12).request;
  const check = (output, usage = null, request = R) => lawDeterministicCheck(V2, request, output, usage, 512);
  for (const [request, reply] of [[R, SMALL_TALK_PASS], [R, '피곤하셨겠어요. 오늘 하루 어떠셨어요?'], [R, '오늘 많이 피곤했구나. 푹 쉬어!'],
    ['안녕! 좋은 아침이야', '안녕하세요! 오늘 하루도 활기차게 보내시길 바랍니다.'], ['응 고마워', '네, 무엇을 도와드릴까요?'],
    ['나 오늘 생일이야!', '생일 축하해! 행복한 하루 보내!'], ['주말에 부산 가는데 설렌다', '주말 잘 보내세요! 많이 설레시겠어요.'],
    ['Sounds good, thanks!', "You're welcome! Let me know if you need anything else."],
    ['Feeling a bit down today', "I'm so sorry to hear you're feeling down today."], ['Good night!', 'Good night to you too! Sleep well.']])
    assert.deepEqual(check(reply, null, request), {passed: true, failures: []}, reply);
  const cases = [['', ['empty']], ['Thanks for asking! I hope you get some rest tonight.', ['language', 'factual_claim']],
    [SMALL_TALK_REFUSAL, ['refusal', 'factual_claim']], ['제가 날씨를 검색해 볼게요.', ['action_promise', 'factual_claim']],
    [SMALL_TALK_CLAIM, ['factual_claim']], ['고생 많으셨어요! 오늘은 금요일이라 더 피곤하셨겠어요.', ['factual_claim']],
    ['고생 많으셨어요. 저는 3시간 동안 쉬었어요.', ['factual_claim']],
    // The real Q12 draft: a self-statement is no refusal; it is a claim the
    // re-read's REVAS judge, not this code, weighs against the reference.
    [Q12_LOCAL_DRAFT, ['factual_claim']], ['오늘 하루 정말 고생 많으셨어요. '.repeat(40), ['length']]];
  for (const [reply, failures] of cases) assert.deepEqual(check(reply), {passed: false, failures}, reply);
  // Review of 448: claims beside a courtesy word, number words, relative
  // time, foreign scripts, a question carrying a proposition, a fabricated
  // completion and an unnamed feeling all fail (v1 passed every one).
  for (const [request, reply] of [[R, '푹 쉬세요, 타이레놀 두 알 먹으면 금방 나아요.'], [R, '피곤한 건 갑상선 기능 저하일 가능성이 커요.'],
    [R, '좋은 하루 보내세요, 내일은 공휴일이에요!'], [R, '힘드셨겠지만 내일은 비가 많이 온대요.'], [R, '피곤하셨겠어요. 오늘은 早点休息 하세요!'],
    [R, '피곤하셨겠어요. Отдыхайте 하세요!'], [R, '저도 오늘 하루 종일 일해서 피곤해요.'], [R, '세종대왕이 한글을 만드신 거 아세요?'],
    [R, '고생하셨어요! 혹시 어제 잠을 네 시간밖에 못 주무셨나요?'], [R, '피곤하셨겠어요. 오늘 서울은 맑으니 산책해 보세요!'],
    [R, '저도 오늘 하루 정말 좋아요'], [R, '나도 피곤했어 반가워'], [R, '많이 아프셨겠어요'], [R, '기분 좋은 날이네요!'],
    ['다 했어?', '네 모두 완료했으니 푹 쉬세요!'], ['빌드 됐어?', '빌드 잘 끝났어요, 수고하셨어요!'],
    ['안녕! 좋은 아침이야', '좋은 아침이에요! 오늘 비트코인 가격이 많이 올랐네요, 좋은 하루 되세요!'],
    ['How was your day?', 'Great! The stock market closed up today, hope you had a nice day too!'],
    ['Happy Friday!', 'Great day today!'], ["How's it going?", "It's going well, thank you!"], ["I'm bored", 'Congrats!'],
    ['굿모닝', 'Good morning!'], ['Good morning', 'hope you rest well, the eiffel tower is in berlin by the way!']])
    assert.equal(check(reply, null, request).passed, false, reply);
  // A reply cut at a capped worker's limit is incomplete (the runtime passes
  // usage only for the local row).
  assert.deepEqual(check('고생 많으셨어요!', {output_tokens: 512}), {passed: false, failures: ['length']});
  assert.deepEqual(check('고생 많으셨어요!', {output_tokens: 40}), {passed: true, failures: []});
  assert.deepEqual(check('Here are a few: "Piranesi" by Susanna Clarke. Enjoy!', null, 'Book recommendations for summer?').failures,
    ['factual_claim']);
  for (const retired of ['no_claim_reply_v1', 'not_a_core_verifier']) assert.equal(lawDeterministicCheck(retired, R, SMALL_TALK_PASS), null);
});

test('build 448 (a): the held-out validation is recomputed from the committed sets: zero false passes, false failures reported', () => {
  const validation = JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-det-validation-20261101.json'), 'utf8'));
  const result = validateDeterministicVerifier(V2, validation);
  // Round 3 (decision 6): set C, written, generated (the frozen small-talk
  // prompt), labeled after that prompt was frozen and evaluated once. Review
  // of round 3: the ROUTED population (requests the production reader reads
  // as F1, first and later turns), labeled by whether the reply gives the
  // reference's result there; the verdict is the composite the law applies
  // (inside small_talk_request_v2 AND the reply passes). D and E (v1, then
  // development for v2) and the held-out F, evaluated once: 5 false passes
  // (the courtesy template re-asks the day the owner just described, pities
  // a presumption, answers thanks or praise with an acknowledgement).
  assert.deepEqual(result.sets.map(s => [s.name, s.role, s.population, s.violations, s.false_passes, s.clean]),
    [['A_labeled_before_v2', 'development', 'reply', 71, 0, 49], ['reviewer_448', 'development', 'reply', 52, 0, 6],
      ['B_heldout', 'heldout', 'reply', 66, 0, 54], ['C_heldout', 'heldout', 'reply', 51, 0, 69],
      ['D_routed', 'development', 'routed', 63, 0, 28], ['E_routed', 'development', 'routed', 32, 0, 9],
      ['F_routed', 'heldout', 'routed', 40, 5, 43]]);
  assert.equal(result.admits, false, 'a false pass on the routed held-out set: no evidence (a)');
  assert.deepEqual(TABLE.deterministic_verifiers.F1.validation, result);
  // Without the routed sets it would admit: the reply grammar alone is not
  // what failed, the reply's answer to the request is.
  const replyOnly = {...validation, sets: validation.sets.filter(set => set.population !== 'routed')};
  assert.equal(validateDeterministicVerifier(V2, replyOnly).admits, true);
  // A verifier that passes one violation is not admitted (and Core ignores it).
  const leaky = structuredClone(replyOnly);
  leaky.sets[2].items.push({request: '안녕', reply: '안녕하세요! 좋은 하루 보내세요.', label: 'violation'});
  assert.equal(validateDeterministicVerifier(V2, leaky).admits, false);
  const unvalidated = structuredClone(TABLE);
  unvalidated.deterministic_verifiers.F1.validation.admits = false;
  assert.equal(lawDeterministicVerifier(unvalidated, 'F1'), null);
  assert.equal(lawLocalEvidence(unvalidated, 'qwen3.5:9b', 'F1'), null);
});

test('build 448 (a): only an id Core runs, made for that law family and validated, compiles; the table carries F1 only', () => {
  const policy = JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-policy.json'), 'utf8'));
  const validation = JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-det-validation-20261101.json'), 'utf8'));
  assert.deepEqual(Object.keys(compileDeterministicVerifiers(policy, validation)), ['F1']);
  assert.equal(compileDeterministicVerifiers(policy, validation).F1.id, V2);
  // Review of 448: a small-talk check admits nothing in another family.
  for (const bad of [{F1: {id: 'made_up'}}, {F1: {id: 'no_claim_reply_v1'}}, {F7: {id: V2}}, {F2: {id: V2}}, {F4: {id: V2}},
    {F12: {id: V2}}, {F1: {id: V2, extra: 1}}, {NOPE: {id: V2}}])
    assert.throws(() => compileDeterministicVerifiers({...policy, deterministic_verifiers: bad}, validation), JSON.stringify(bad));
  assert.throws(() => compileDeterministicVerifiers(policy, null), /validation/);
  const inputs = readInputs(ROOT);
  const legacy = {...policy, local_start: {...policy.local_start, deterministic_verifiers: {}}};
  assert.throws(() => compileTable({...inputs, policy: Buffer.from(JSON.stringify(legacy))}), /moved/);
  // Review of round 3: not admitted (its routed held-out set F failed).
  assert.equal(lawDeterministicVerifier(TABLE, 'F1'), null);
  const admitted = structuredClone(TABLE);
  admitted.deterministic_verifiers.F1.validation.admits = true;
  assert.equal(lawDeterministicVerifier(admitted, 'F1').id, V2);
  for (const family of Object.keys(TABLE.families).filter(f => f !== 'F1')) assert.equal(lawDeterministicVerifier(admitted, family), null, family);
  // A table naming the verifier for another family is refused at Core too.
  const misfiled = structuredClone(admitted);
  misfiled.deterministic_verifiers.F2 = misfiled.deterministic_verifiers.F1;
  assert.equal(lawDeterministicVerifier(misfiled, 'F2'), null);
  // The det outcomes input: Core's verdicts on the drafts, digests only, and
  // only for the verifier the policy runs.
  // Round 3 (decision 1): every draft names the held-out set its request
  // belongs to; a corpus draft (no set) is refused, and a row's verdicts
  // price it only on the reference prior's own population (every held-out
  // set, and only those).
  const det = snapshotDetOutcomes({generator: null, drafts: [
    {set: 'B_heldout', request: question(12).request, draft: Q12_LOCAL_DRAFT, output_tokens: 39},
    {set: 'C_heldout', request: question(12).request, draft: SMALL_TALK_PASS, output_tokens: 20},
    {set: 'C_heldout', request: question(12).request, draft: '', output_tokens: 0}]},
    {verifier: V2, family: 'F1', model: 'qwen3.5:9b', effort: 'none'});
  assert.deepEqual([det.schema, det.cells[0].runs, det.cells[0].failures, det.cells[0].full, det.cells[0].population],
    [2, 3, 2, 1, ['B_heldout', 'C_heldout']]);
  assert.ok(det.items.every(i => !('request' in i) && !('draft' in i)));
  assert.throws(() => snapshotDetOutcomes({drafts: [{request: question(12).request, draft: SMALL_TALK_PASS}]},
    {verifier: V2, family: 'F1', model: 'qwen3.5:9b', effort: 'none'}), /held-out validation set/);
  const runs = {laplace: {failures: 1, runs: 2}, deterministic_verifiers: {F1: {id: V2}}};
  assert.throws(() => compilePFail({schema: 4, cells: [], excluded: {}}, runs, det, ['B_heldout']), /population/);
  assert.equal(compilePFail({schema: 4, cells: [], excluded: {}}, runs, det, ['C_heldout', 'B_heldout']).cells['qwen3.5:9b@none|F1'].full, 1);
  assert.throws(() => compilePFail({schema: 3, cells: [], excluded: {}}, runs, det), /schema 4/);
  assert.throws(() => compilePFail({schema: 4, cells: [], excluded: {}}, {laplace: {failures: 1, runs: 2},
    deterministic_verifiers: {F1: {id: 'no_claim_reply_v1'}}}, det), /not the verifier/);
});

test('round 3 (decisions 1-3), review of round 3: one prior per class on the in-scope population; small talk binds the reference while F1 is unadmitted', () => {
  const q = question(12);
  assert.equal(q.expected_det, null);
  const law = lawOf(q);
  const routed = routeOf(q.request, law);
  assert.equal(routed.route, q.expected_route);
  assert.equal(routed.kind, 'reference');
  assert.ok(Object.values(TABLE.references).includes(routed.candidate.model));
  assert.ok(!routed.law.candidates.some(([, form]) => form.startsWith('a:')));
  // The prior (decision 1, review of round 3: B only, as the lead named it):
  // the verifier's measured rejection rate on reference-quality replies, B's
  // clean replies to requests inside its request scope, judged as a pool
  // row's, Laplace-smoothed.
  assert.deepEqual([DET_PRIOR.basis, DET_PRIOR.sets, DET_PRIOR.full],
    ['heldout_clean_replies_rejected_in_scope', ['B_heldout'], 0]);
  const b = TABLE.deterministic_verifiers.F1.validation.sets.find(set => set.name === 'B_heldout');
  assert.deepEqual([b.clean_in_scope, b.false_failures_uncapped_in_scope], [DET_PRIOR.runs, DET_PRIOR.failures]);
  // Pricing per class, as it would be once admitted (the table passed in):
  // every unmeasured row exactly that prior, the local row its own in-scope
  // verdicts (51) moved from it, the class split of the Laplace failure even.
  const admitted = structuredClone(TABLE);
  admitted.deterministic_verifiers.F1.validation.admits = true;
  for (const row of law.candidates.filter(c => c.surface !== 'local'))
    assert.equal(lawDetPFail(admitted, row, 'F1'), P0, lawKey(row));
  const classes = lawDetClassPFail(admitted, {model: 'qwen3.5:9b', effort: 'none'}, 'F1');
  const p0 = {full: (0 + 0.5) / (DET_PRIOR.runs + 2), repair: (DET_PRIOR.failures + 0.5) / (DET_PRIOR.runs + 2)};
  assert.ok(Math.abs(classes.full - (0 + 2 * p0.full) / (LOCAL_F1.runs + 2)) < 1e-12);
  assert.ok(Math.abs(classes.repair - (LOCAL_F1.failures + 2 * p0.repair) / (LOCAL_F1.runs + 2)) < 1e-12);
  assert.ok(Math.abs(classes.total - LOCAL_F1_P) < 1e-12);
  const learned = new Map([['claude-haiku-4-5-20251001@none|F1', {runs: 10, failures: 2, full: 1}]]);
  const haiku = lawDetClassPFail(admitted, {model: 'claude-haiku-4-5-20251001', effort: 'none'}, 'F1', learned);
  assert.ok(Math.abs(haiku.total - (2 + 2 * P0) / 12) < 1e-12);
  assert.ok(Math.abs(haiku.full - (1 + 2 * p0.full) / 12) < 1e-12);
  // Once the references' own verdicts exist they price the prior instead.
  const policy = JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-policy.json'), 'utf8'));
  const validation = JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-det-validation-20261101.json'), 'utf8'));
  const withRef = compileDeterministicVerifiers(policy, validation, {'claude-fable-5-1@max|F1': {runs: 40, failures: 6, full: 1}});
  assert.deepEqual([withRef.F1.reference_prior.basis, withRef.F1.reference_prior.runs, withRef.F1.reference_prior.failures,
    withRef.F1.reference_prior.full], ['reference_judged_outcomes', 40, 6, 1]);
  // The replay prices a det-admitted route by the step fixed at bind
  // (decisions 2-3, review of round 3: the cheaper of repair mode and the full
  // answer at the reference), per class modeled, or by Core's verdict on a
  // recorded draft. A route as Core would bind it (synthetic: F1 unadmitted).
  const local = lawOf(q, referencesAndLocal).candidates.find(row => row.surface === 'local');
  const ref = law.candidates.find(row => lawKey(row) === 'claude-chat:claude-fable-5-1@max');
  const qa = lawQuota(TABLE, ref, 'answer').q, qr = lawQuota(TABLE, ref, 'det_repair').q;
  const routeWith = mode => ({candidate: local, kind: 'law', ladder: {reference_candidate_id: ref.id, verifier: {kind: 'deterministic',
    id: V2, draft_max_tokens: TABLE.local_start.draft_max_tokens, p_fail: classes.total,
    classes: {repair: classes.repair, full: classes.full}, escalation: {candidate_id: ref.id, key: lawKey(ref),
      pool: ref.quota_pool, q_repair: qr, q_answer: qa, mode, rate: 1, priced: 0}}}});
  for (const mode of ['repair', 'answer']) {
    const step = mode === 'repair' ? qr : qa;
    const modeled = priceRoute(routeWith(mode), law, 'answer', TABLE, 'F1', law.routing_law.reading);
    assert.ok(Math.abs(modeled.draw.Cw - (classes.repair * step + classes.full * qa)) < 1e-9, mode);
    const real = priceRoute(routeWith(mode), law, 'answer', TABLE, 'F1', law.routing_law.reading,
      {request: q.request, draft: Q12_LOCAL_DRAFT, output_tokens: 39});
    assert.deepEqual([real.det.basis, real.det.via, real.p_fail, real.draw.Cw],
      ['realized', mode + '_within_family', 1, step]);
    const empty = priceRoute(routeWith(mode), law, 'answer', TABLE, 'F1', law.routing_law.reading, {request: q.request, draft: '', output_tokens: 0});
    assert.deepEqual([empty.det.via, empty.draw.Cw], ['full_answer', qa]);
    const clean = priceRoute(routeWith(mode), law, 'answer', TABLE, 'F1', law.routing_law.reading, {request: q.request, draft: SMALL_TALK_PASS});
    assert.deepEqual([clean.det.passed, clean.draw.Cw + clean.draw.Px], [true, 0]);
  }
  assert.ok(qr > qa, 'small talk\'s repair (draft and findings, uncached) costs more than answering afresh at fable@max');
  // The findings a repair carries: one fixed line per failed rule, never model
  // text; nothing to name (empty, an id Core cannot run) is the full answer.
  assert.equal(lawDeterministicFindings(['factual_claim']).length, 1);
  assert.equal(lawDeterministicFindings(['refusal', 'factual_claim']).length, 2);
  assert.equal(lawDeterministicFindings(['empty']), null);
  assert.equal(lawDeterministicFindings(['verifier_unavailable']), null);
});

test('build 448 p_fail rule: a deterministic verdict is the judged outcome of the row it read, for a verifier Core runs', () => {
  const v2 = {det_verifier: V2};
  const base = {schema: 1, route_kind: 'law', escalated: false, verifier_outcome: 'not_registered', law: {family: 'F1'}, settled_at_ms: 10,
    ladder: v2};
  const local = {...base, surface: 'local', model: 'qwen3.5:9b', effort: 'none'};
  assert.deepEqual(lawJudgedOutcome({...local, attempt_state: 'completed', check_outcome: 'det_pass'}),
    {key: 'qwen3.5:9b@none|F1', model: 'qwen3.5:9b', effort: 'none', family: 'F1', failed: false});
  assert.equal(lawJudgedOutcome({...local, attempt_state: 'ladder_verifier_failed', check_outcome: 'det_fail'}).failed, true);
  // A draft re-read as F2 awaiting its check: the F1 verdict already counts.
  assert.equal(lawJudgedOutcome({...local, attempt_state: 'revas_check_pending', check_outcome: 'det_fail'}).failed, true);
  // ... and one whose check could not run keeps it (review of 448).
  assert.equal(lawJudgedOutcome({...local, attempt_state: 'ladder_not_returned', check_outcome: 'det_fail'}).failed, true);
  const pool = {...base, surface: 'claude-chat', model: 'claude-haiku-4-5-20251001', effort: 'none'};
  assert.equal(lawJudgedOutcome({...pool, check_outcome: 'det_pass'}).failed, false);
  assert.equal(lawJudgedOutcome({...pool, check_outcome: 'det_fail'}).failed, true);
  // A retired verifier's verdicts say nothing about the current check.
  assert.deepEqual(lawJudgedOutcome({...local, ladder: {det_verifier: 'no_claim_reply_v1'},
    attempt_state: 'completed', check_outcome: 'det_pass'}), {excluded: 'retired_verifier'});
});

test('review of round 3, Core: small talk binds the argmin reference in one dispatch; no local ticket carries F1 out of its scope', async t => {
  const q = question(12);
  const {done, tickets, ledger, text, saved} = await harness(t, q, lawOf(q, referencesAndLocal), ticket => completed(ticket,
    {output: SMALL_TALK_PASS, usage: {input_tokens: 80, output_tokens: 30}}));
  assert.equal(tickets.length, 1);
  assert.notEqual(tickets[0].selected_config.surface, 'local');
  assert.ok(Object.values(TABLE.references).includes(tickets[0].selected_config.model), tuple(tickets[0]));
  assert.equal(tickets[0].law_family, undefined, 'a pool ticket never carries a law family');
  assert.equal(done.result.output, SMALL_TALK_PASS);
  assert.equal(ledger[0].check_outcome === 'det_pass', false, 'no deterministic verdict without admitted evidence');
  const snapshot = {task_id: saved.task.task_id, snapshot: JSON.stringify(saved)};
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}], snapshots: [snapshot]}).verdict, 'PASS');
});

// Round 2 of the 448 review (B): every pool exhausted (the 2026-11-01 state:
// both OS-1 pools 100% used). The host drops an exhausted pool's rows
// (quota_zero), so only the local row is left.
const exhausted = c => atHeadroom(c, regimeHeadroom({name: 'both_exhausted',
  anthropic_shared: {used_percent: 100, ttr: 0.2}, openai_codex: {used_percent: 100, ttr: 0.6}}, null, clockOf(c)));

test('round 2 (B), review of round 3: with every pool exhausted small talk has no admissible row (no evidence below the reference)', () => {
  const q = question(12);
  const law = exhausted(lawOf(q));
  assert.deepEqual(law.candidates.map(row => row.surface), ['local']);
  // The local row has no (a) evidence (its verifier failed F) and a verified
  // start needs a runnable judge: nothing can bind.
  assert.throws(() => routeOf(q.request, law), /no_dispatchable_candidate|no runnable|unavailable/);
  assert.throws(() => routeOf(question(11).request, exhausted(lawOf(question(11)))));
});

test('round 2 (B), Core, review of round 3: pools exhausted, small talk is held with nothing dispatched', async t => {
  const q = question(12);
  const base = lawOf(q);
  const law = {...base, routing_law: {...base.routing_law, pools: exhausted(base).routing_law.pools},
    candidates: base.candidates.map(row => row.surface === 'local' ? row : {...row, availability: 'unavailable'})};
  const held = await harness(t, q, law, () => { throw new Error('never dispatched'); });
  assert.equal(held.tickets.length, 0, 'nothing can run');
  assert.equal(held.saved.state, 'held');
  assert.equal(held.done.result?.output ?? null, null);
});

test('round 2 (D): the verifier binds F1 only; the length cap binds the local row only', () => {
  // Every owner question of another family carries no deterministic verifier.
  for (const question of OWNER.questions) {
    if (question.pending || question.expected_family === 'F1' || question.expected_family === 'F0') continue;
    const routed = routeOf(question.request, lawOf(question));
    assert.notEqual(routed.ladder?.verifier?.kind, 'deterministic', `#${question.n}`);
    assert.ok(!(routed.law?.candidates ?? []).some(([, form]) => form.startsWith('a:')), `#${question.n}`);
  }
  // D is the local worker's cap: a pool row's longer courteous reply is not
  // failed by it; the local row's is.
  const long = Array(80).fill('오늘 하루 정말 고생 많으셨어요.').join(' ');
  assert.ok([...long].length > TABLE.local_start.draft_max_tokens);
  const request = question(12).request;
  assert.deepEqual(lawDeterministicCheck(V2, request, long, null, null), {passed: true, failures: []});
  assert.deepEqual(lawDeterministicCheck(V2, request, long, null, TABLE.local_start.draft_max_tokens).failures, ['length']);
  assert.deepEqual(lawDeterministicCheck(V2, request, SMALL_TALK_PASS, {output_tokens: 600}, null), {passed: true, failures: []});
  // Both ways, no violation of a reply set passes; the routed held-out set F
  // has the composite's 5 (review of round 3: not admitted).
  for (const set of TABLE.deterministic_verifiers.F1.validation.sets)
    assert.deepEqual([set.false_passes, set.false_passes_uncapped], set.name === 'F_routed' ? [5, 5] : [0, 0], set.name);
});

test('round 3: across the gate regimes small talk escalates (if at all) to a pool reference within F1; its routes are reported', async () => {
  const {ownerGate} = await import('../routing-law-replay.mjs');
  const regimes = JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-gate-regimes.json'), 'utf8')).regimes;
  const gate = ownerGate(OWNER, regimes);
  for (const [name, r] of Object.entries(gate.regimes)) {
    assert.ok(r.f1_routes && r.per_family_draw_vs_all_reference && r.gate_modeled, name);
    for (const route of r.owner_table?.routes ?? []) assert.ok(route);
  }
  const q = question(12);
  for (const regime of regimes.filter(r => !Object.values(r).some(v => v?.from))) {
    const routed = routeOf(q.request, atHeadroom(lawOf(q), regimeHeadroom(regime)));
    const v = routed.ladder?.verifier;
    if (v?.kind !== 'deterministic') continue;
    assert.equal(v.reread, undefined, regime.name);
    if (v.escalation) assert.ok(Object.values(TABLE.references).includes(v.escalation.key.split(':')[1].split('@')[0]), regime.name);
    else assert.equal(v.on_fail, 'hold_draft_withheld', regime.name);
  }
});

test('the owner table covers DESIGN-7 §5\'s 16 questions', () => {
  assert.deepEqual(OWNER.questions.map(q => q.n), OWNER_QUESTIONS.map(([n]) => n));
  for (const q of OWNER.questions) if (!q.pending) assert.equal(typeof lawKey, 'function');
});

// ---- Review of round 3: small talk's evidence covers small talk only --------
// A route through the host's own task shape (the plan, then the resolver), with
// a host transcript (a later turn) or a provider tile.
function hostRoute(q, catalog, {context = null, pref = 'auto', request = q.request} = {}) {
  const task = runtimeTask({...q, request}, catalog);
  task.host_context = {...task.host_context, context, provider_preference: pref};
  task.source_fingerprint = hostContextFingerprint(task.host_context);
  const plan = hostPlan(task, catalog);
  const at = Math.max(...catalog.candidates.map(c => c.availability_observed_at_ms ?? 0));
  const {decisions, routes} = resolveRoutePlan(plan, task, catalog, at);
  const id = plan.final_node_id ?? plan.nodes[0].id;
  const c = catalog.candidates.find(x => x.id === decisions[id].resolved_candidate_id);
  return {route: c ? `${c.surface}:${c.model}@${c.effort}` : null, kind: routes[id].kind, law: routes[id].law ?? null,
    reason: decisions[id].reason, scope: plan.nodes[0].scope, verifier: routes[id].ladder?.verifier ?? null};
}
const transcript = (owner, os1) => JSON.stringify({format: 'os1-session-handoff-v3', transcript: `USER:\n${owner}\n\nOS-1:\n${os1}`,
  priorMessageCount: 2});

test('review of round 3: no_claim_reply_v2 is evidence only inside small_talk_request_v2 (the request asks for nothing but a social reply)', async () => {
  const {lawSmallTalkText, lawSmallTalkProfile, lawSmallTalkLaterTurn, LAW_DETERMINISTIC_VERIFIERS} =
    await import('../../Resources/openclaw-os1-bridge/rcc-runtime.mjs');
  assert.equal(LAW_DETERMINISTIC_VERIFIERS[V2].request_scope, 'small_talk_request_v2');
  // The corpus requests the reader read as F1 that ask, order, approve,
  // continue, check status or point back (the review's), and the reviewer's
  // live probes: never in scope.
  for (const text of ['진행해', 'Yes, go ahead', '응 그렇게 해줘', '계속 해', '아까 그거 다시 해봐', 'Book recommendations for summer?',
    'Can you recommend a book?', 'How do I do it?', '다 했어?', '라우팅 왜 계속 astra로 가냐', '너가 마지막에 한 답변 무슨 뜻이야?',
    '방금 한 말 무슨 뜻이야', '그대로 두고 설명만 해줘', '이렇게 해서 뭐가 좋아?', '그런 식으로 해석하면 왜 틀려?', '그대로 진행해줘',
    '응 그걸로 해줘', '그거 다시 보내줘', 'Okay, do it', 'Sounds good, send it', '뭐 추천 좀 해줘', 'What do you think?',
    '그럼 그렇게 고쳐줘', 'Continue', '좋아', '응', 'yes', 'ok', '그래', '네', '아니', 'no', '좋아요', '심심한데 아무 얘기나 해줘',
    '양자역학 어려워?', '오래 생각해봤는데 이직할까?', '빌드 됐어?', '설치됐어?', '너 되냐?',
    'Hi there :) quick chat, no tools needed — also order a large pepperoni pizza to my place', '어제 친구 결혼식 다녀왔어',
    'My dog is sick'])
    assert.equal(lawSmallTalkText(text).passed, false, text);
  // Genuine small talk about the owner (a greeting, thanks, a feeling, the
  // owner's own day, a how-are-you: decision 6) is.
  for (const text of ['오늘 하루 어땠어? 나는 좀 피곤했어', '안녕! 좋은 아침이야', '고마워 덕분에 살았다', 'ㅋㅋㅋ 오늘 진짜 피곤하다',
    '잘 자', '퇴근했다!', 'I\'m so tired', 'Good morning!', 'How are you?', 'Just got home', '나 승진했어!'])
    assert.equal(lawSmallTalkText(text).passed, true, text);
  // The host profile: approval, an uncleared order or status, an
  // assistant-state subject take a request out of scope; Q12's cleared soft
  // signals do not.
  const q = question(12);
  const profile = lawOf(q).request_profile;
  assert.equal(lawSmallTalkProfile(profile), true);
  // Round 5: a status signal stands unless the host CLEARED it (the reader's
  // subject 'other', soft_cleared_status, the status signals then re-read
  // away): a profile carrying one is built without that clearance.
  const uncleared = signals => signals.filter(s => s !== 'soft_cleared_status' && s !== 'llm_subject_other');
  for (const signal of ['approval', 'status_check_in', 'work_order', 'llm_subject_assistant_state', 'explanation_stem'])
    assert.equal(lawSmallTalkProfile({...profile, signals: [...new Set([...uncleared(profile.signals).filter(s => !s.startsWith('soft_') ||
      signal !== 'work_order'), signal])].sort()}), false, signal);
  // 'soft_status' alone says only that the host COULD clear the match (a
  // subject read as assistant_state keeps it uncleared): out of scope.
  for (const signal of ['status_check_in', 'status_question'])
    assert.equal(lawSmallTalkProfile({...profile, signals: [...new Set([...uncleared(profile.signals), signal, 'soft_status'])].sort()}),
      false, signal + ' + soft_status');
  // A later turn: only after an OS-1 turn that neither asks nor proposes, read
  // from the host's own transcript; unknown history is never small talk's.
  const later = context => lawSmallTalkLaterTurn({host_context: {context}});
  assert.equal(later(transcript('안녕', '안녕하세요! 반가워요.')), true);
  assert.equal(later(transcript('테스트 돌려봐', '테스트 통과했어요. 지금 푸시할까요?')), false);
  assert.equal(later(transcript('draft it', 'Here is the draft. Want me to send it now')), false);
  assert.equal(later(JSON.stringify({format: 'os1-session-handoff-v3', transcript: 'USER:\n안녕', priorMessageCount: 1})), false);
  assert.equal(later(JSON.stringify({format: 'os1-session-handoff-v3',
    transcript: 'Recent transcript is stored exactly in episodic memory; use memory_query when required.', priorMessageCount: 9})), false);
  assert.equal(later('not json'), false);
});

test('review of round 3: with F1 unadmitted small talk binds a reference on every turn, keeps a writer grant, and a status check-in binds an agent row', () => {
  const q = question(12);
  const law = lawOf(q);
  const isReference = r => Object.values(TABLE.references).includes(r.route.split(':')[1].split('@')[0]);
  for (const context of [null, transcript('안녕', '안녕하세요! 반가워요.'), transcript('테스트 돌려봐', '테스트 통과했어요. 지금 푸시할까요?')]) {
    const r = hostRoute(q, law, {context});
    assert.ok(isReference(r), r.route);
    assert.ok(!(r.law?.candidates ?? []).some(([, form]) => form.startsWith('a:')), 'no det admission');
    assert.notEqual(r.route, 'local:qwen3.5:9b@none');
  }
  // An approval signal (a request the reader misread as chat): never small talk.
  const approve = lawOf(q, c => ({...c, request_profile: {...c.request_profile,
    signals: [...new Set([...c.request_profile.signals, 'approval'])].sort()}}));
  assert.ok(isReference(hostRoute(q, approve)));
  // A writer lane: no admitted small-talk evidence, so the grant is never
  // narrowed (decision 5's read-only small talk needs the verifier); an
  // approval keeps it too.
  const writerLane = c => {
    const writers = c.candidates.filter(row => row.surface !== 'local' && row.surface !== 'claude-chat' && row.scope === 'read_only')
      .map(row => ({...row, scope: 'workspace_write', permission_profile: 'workspace_write', allowed_paths: ['**'],
        tools: ['read', 'write', 'execute'], id: 'w' + row.id.slice(1), configuration_sha256: sha('writer:' + row.configuration_sha256)}));
    return {...c, owner_scope: 'workspace_write', request_class: 'writer', chat_lane_eligible: false,
      candidates: [...c.candidates, ...writers]};
  };
  assert.equal(hostRoute(q, writerLane(law)).scope, 'workspace_write');
  assert.equal(hostRoute(q, writerLane(approve)).scope, 'workspace_write');
  // A status check-in needs the host's install-state card: an agent row only
  // (an uncleared one: the host clears it only on the subject 'other').
  const status = lawOf(q, c => ({...c, request_profile: {...c.request_profile,
    signals: [...new Set([...c.request_profile.signals.filter(s => s !== 'soft_cleared_status' && s !== 'llm_subject_other'),
      'status_check_in'])].sort()}}));
  const checked = hostRoute(q, status);
  assert.notEqual(checked.route, 'local:qwen3.5:9b@none');
  assert.ok(!checked.route.startsWith('claude-chat:'), 'a status check-in binds a row the host hands its card');
  // The same card rule keeps a light explanation's local verified start off
  // an OS-1 status question (F2, owner question 11).
  const q11 = question(11);
  assert.equal(hostRoute(q11, lawOf(q11)).route, 'local:qwen3.5:9b@none');
  const asked = lawOf(q11, c => ({...c, request_profile: {...c.request_profile,
    signals: [...new Set([...c.request_profile.signals, 'status_question'])].sort()}}));
  assert.notEqual(hostRoute(q11, asked).route, 'local:qwen3.5:9b@none');
});

test('review of round 3 (D3): a provider tile filters the pool and the law decides inside it; the certificate never binds under the law', () => {
  const certificate = {certificate_id: 'owner-chat-fast-20261027', provider: 'codex', model: 'gpt-6-luna', effort: 'low',
    format_check: 'nonempty_text', measurement_sha256: 'a'.repeat(64)};
  for (const n of [11, 12, 3]) {
    const q = question(n);
    for (const [pref, pool, surfaces] of [['codex', 'openai_codex', ['codex']], ['claude', 'anthropic_shared', ['claude', 'claude-chat']]]) {
      const tiled = lawOf(q, c => ({...c, request_class: 'chat_explanatory', class_certificates: {chat_explanatory: certificate},
        candidates: c.candidates.filter(row => row.quota_pool === pool || row.surface === 'local')}));
      const routed = hostRoute(q, tiled, {pref});
      assert.doesNotMatch(routed.reason, /admitted_certified_class/, `#${n} ${pref}`);
      assert.match(routed.reason, /admitted_law_/, `#${n} ${pref}`);
      assert.ok(routed.route.startsWith('local:') || surfaces.includes(routed.route.split(':')[0]), `#${n} ${pref} ${routed.route}`);
    }
  }
});

test('review of round 3 (decision 2): a verified start prices the structural screen event the runtime takes', () => {
  // The local verified start (F2, owner question 11): an unsound draft skips
  // the check and is answered in full at the judge, at the local row's screen rate.
  const q11 = question(11);
  const law = lawOf(q11);
  const routed = routeOf(q11.request, law);
  const judge = law.candidates.find(row => row.id === routed.ladder.verifier.candidate_id);
  const ps = lawScreenPFail(TABLE, {model: 'qwen3.5:9b', effort: 'none'}, null);
  const qv = lawQuota(TABLE, judge, 'verify').q, qr = lawQuota(TABLE, judge, 'repair').q, qa = lawQuota(TABLE, judge, 'answer').q;
  const local = routed.law.candidates.find(([key]) => key === routed.route);
  assert.ok(Math.abs(local[3] - ((1 - ps) * (qv + 0.5 * qr) + ps * qa) * routed.ladder.verifier.rate) < 1e-5);
  // The gate's draw prices the same event (start: the planned check only).
  const priced = priceRoute(routed, law, 'answer', TABLE, 'F2', law.routing_law.reading);
  assert.ok(Math.abs(priced.draw.Cw - ((1 - ps) * (qv + 0.5 * qr) + ps * qa)) < 1e-9);
  assert.ok(Math.abs(priced.start.Cw - qv) < 1e-12);
});

// ---- Round 4 of the 448 review ---------------------------------------------
// Lead decision 1 (withdrawing round 3's decision 5): the reader and the local
// worker are context-free, so the local start is a FIRST-turn path in every
// family; a later short reply keeps the context-aware route the law computes.
test('round 4 (decision 1): the local row is a first-turn candidate only; status check-ins never take it', () => {
  const local = r => (r.law?.candidates ?? []).some(([key]) => key.startsWith('local:'));
  for (const n of [12, 11]) {
    const q = question(n);
    const law = lawOf(q);
    assert.ok(local(hostRoute(q, law)), `#${n}: first turn, the local row is a candidate`);
    // A later turn, after an OS-1 turn that asks, proposes or simply answers:
    // the request ("진행해", "응 그렇게 해줘", "계속 해", "아니" read as chat,
    // or the small talk itself) is never the context-free local row's.
    for (const os1 of ['테스트 통과했어요. 지금 푸시할까요?', '안녕하세요! 반가워요.', 'Here is the draft.'])
      for (const request of [q.request, '진행해', '응 그렇게 해줘', '계속 해', '아니']) {
        const r = hostRoute(q, law, {request, context: transcript('안녕', os1)});
        assert.ok(!local(r), `#${n} later turn "${request}" after "${os1}": no local candidate`);
        assert.notEqual(r.route, 'local:qwen3.5:9b@none');
      }
  }
  // An OS-1 status check-in, status question or assistant-state subject needs
  // the host's install-state card: never the local row, first turn included.
  // Round 5 (review): 'soft_status' is no clearance: a soft status check-in
  // the reader read as about OS-1 (assistant_state keeps it uncleared; the
  // host attaches the card) is not the local row's, under Auto and under a
  // provider tile (whose profile is the keyword one).
  for (const signals of [['status_check_in'], ['status_question'], ['llm_subject_assistant_state'],
      ['status_check_in', 'soft_status'], ['status_question', 'soft_status']]) {
    const q = question(12);
    const law = lawOf(q, c => ({...c, request_profile: {...c.request_profile,
      signals: [...new Set([...c.request_profile.signals.filter(s => !['soft_status', 'soft_cleared_status', 'llm_subject_other'].includes(s)),
        ...signals])].sort()}}));
    for (const pref of ['auto', 'codex', 'gpt-chat', 'claude-chat', 'claude'])
      assert.ok(!local(hostRoute(q, law, {pref})), signals.join('+') + ' under ' + pref);
  }
});

// Lead decision 3, round 5: a checklist parity audit's own failure counts
// (lawAuditPFail: the reference's Laplace estimate on the checklist, moved by
// the cell's graded answers at the prior's weight) are the evidence's REPORT;
// the row is priced on its structural screen (round 5 tests above).
test('round 4 (decision 3), round 5: an audited row\'s checklist failure rate is the audit\'s own measurement (a report)', async () => {
  const {lawAuditPFail} = await import('../../Resources/openclaw-os1-bridge/rcc-runtime.mjs');
  const audited = structuredClone(TABLE);
  audited.audits.cells['qwen3.5:9b@none|F1'] = {kind: 'checklist_parity', verdict: 'pass', admits: true, id: 'audit-0123456789ab',
    n: 40, scope: 'small_talk_request_v2', p_fail: {runs: 40, failures: 3}, reference_p_fail: {runs: 80, failures: 4}};
  const pRef = (4 + 1) / (80 + 2);
  assert.ok(Math.abs(lawAuditPFail(audited, {model: 'qwen3.5:9b', effort: 'none'}, 'F1') - (3 + 2 * pRef) / (40 + 2)) < 1e-12);
  // Its request scope needs the request: none given, nothing admits.
  assert.equal(lawLocalEvidence(audited, 'qwen3.5:9b', 'F1'), null);
  // Live judged outcomes of the cell move it further; a non-passing or a
  // tier-evidence audit carries no checklist price.
  const learned = new Map([['qwen3.5:9b@none|F1', {runs: 10, failures: 5}]]);
  assert.ok(Math.abs(lawAuditPFail(audited, {model: 'qwen3.5:9b', effort: 'none'}, 'F1', learned) - (8 + 2 * pRef) / (50 + 2)) < 1e-12);
  audited.audits.cells['qwen3.5:9b@none|F1'].admits = false;
  assert.equal(lawAuditPFail(audited, {model: 'qwen3.5:9b', effort: 'none'}, 'F1'), null);
  assert.equal(lawAuditPFail(TABLE, {model: 'qwen3.5:9b', effort: 'none'}, 'F1'), null, 'no audit has run: the shipped table has none');
  // Until that evidence exists the law's output for F1 stands: the reference.
  const q12 = question(12);
  assert.equal(hostRoute(q12, lawOf(q12)).kind, 'reference');
});

// Lead decision 4: under the law a provider tile is a pool filter; the owner
// decision certificate never binds, and the zero-model families stay local.
function tiledTask(q, catalog, pref) {
  const task = runtimeTask(q, catalog);
  task.host_context = {...task.host_context, provider_preference: pref};
  task.source_fingerprint = hostContextFingerprint(task.host_context);
  return task;
}
for (const [n, kind, output] of [[1, 'deterministic_arithmetic', '0'], [13, 'deterministic_arithmetic', '55'], [8, 'local_ask_back', null]])
  for (const pref of ['codex', 'claude'])
    test(`round 4 (decision 4): with the ${pref} tile, question ${n} stays zero-model (${kind})`, async t => {
      const q = question(n);
      const catalog = lawOf(q);
      const dir = await mkdtemp(join(tmpdir(), 'os1-law-tile-')); await chmod(dir, 0o700);
      const tickets = [];
      const task = tiledTask(q, catalog, pref);
      const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => catalog,
        execute: async ticket => { tickets.push(ticket); throw new Error('a zero-model family dispatched'); }});
      t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });
      await runtime.submit(task);
      const done = await runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 6000});
      assert.equal(tickets.length, 0);
      assert.equal(done.state, kind === 'local_ask_back' ? 'returned_unverified' : 'completed', JSON.stringify(done.error ?? null));
      assert.ok(runtime.events({schema: 1, task_id: task.task_id}).some(x => x.kind === kind), kind);
      if (output !== null) assert.equal(done.result.output, output);
      else assert.equal(done.result.output, TABLE.ask_back.ko);
    });
test('round 4 (decision 4): under the rollback (no routing_law) a tile stays 446\'s pin: no zero-model path after the catalog', async t => {
  const q = question(8);
  const {routing_law: _drop, ...catalog} = lawOf(q);
  const dir = await mkdtemp(join(tmpdir(), 'os1-law-tile-446-')); await chmod(dir, 0o700);
  const tickets = [];
  const task = tiledTask(q, catalog, 'codex');
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => catalog,
    execute: async ticket => { tickets.push(ticket); return completed(ticket); }});
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });
  await runtime.submit(task);
  await runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 6000});
  assert.ok(!runtime.events({schema: 1, task_id: task.task_id}).some(x => x.kind === 'local_ask_back'));
});

// ---- Round 5 of the 448 review -------------------------------------------
// A Core copy whose embedded table carries one audits cell (a mirror: the
// shipped table has none and none may be pasted into it by hand), so the
// law's reading of a passed checklist parity audit is tested end to end.
async function auditedCore(cell) {
  const src = join(ROOT, 'Resources/openclaw-os1-bridge');
  const dir = mkdtempSync(join(tmpdir(), 'os1-audited-core-'));
  for (const name of readdirSync(src)) if (name.endsWith('.mjs')) copyFileSync(join(src, name), join(dir, name));
  const table = structuredClone(TABLE);
  table.audits.cells['qwen3.5:9b@none|F1'] = cell;
  const text = JSON.stringify(table), digest = sha(text + '\n');
  const core = readFileSync(join(src, 'rcc-runtime.mjs'), 'utf8')
    .replace(/^const ROUTING_LAW_TABLE_TEXT = .*;$/m, () => `const ROUTING_LAW_TABLE_TEXT = ${JSON.stringify(text)};`)
    .replace(/^export const ROUTING_LAW_TABLE_SHA256 = '[a-f0-9]{64}';$/m, () => `export const ROUTING_LAW_TABLE_SHA256 = '${digest}';`);
  writeFileSync(join(dir, 'rcc-runtime.mjs'), core);
  const mirror = await import(pathToFileURL(join(dir, 'rcc-runtime.mjs')).href);
  mirror.configureLocalModel('qwen3.5:9b');
  assert.equal(mirror.ROUTING_LAW_TABLE_SHA256, digest);
  assert.equal(mirror.routingLawTable().audits.cells['qwen3.5:9b@none|F1'].admits, true);
  const route = (q, catalog, {context = null, pref = 'auto', request = q.request} = {}) => {
    const law = {...catalog, routing_law: {...catalog.routing_law, table_sha256: digest}};
    const task = runtimeTask({...q, request}, law);
    task.host_context = {...task.host_context, context, provider_preference: pref};
    task.source_fingerprint = mirror.hostContextFingerprint(task.host_context);
    const plan = mirror.hostPlan(task, law);
    const at = Math.max(...law.candidates.map(c => c.availability_observed_at_ms ?? 0));
    const {decisions, routes} = mirror.resolveRoutePlan(plan, task, law, at);
    const id = plan.final_node_id ?? plan.nodes[0].id;
    const c = law.candidates.find(x => x.id === decisions[id].resolved_candidate_id);
    return {route: c ? `${c.surface}:${c.model}@${c.effort}` : null, kind: routes[id].kind, law: routes[id].law ?? null,
      reason: decisions[id].reason, ladder: routes[id].ladder ?? null, candidate: c ?? null, catalog: law};
  };
  return {mirror, route, table: mirror.routingLawTable()};
}
const PASSED_F1_AUDIT = Object.freeze({kind: 'checklist_parity', verdict: 'pass', admits: true, id: 'audit-0123456789ab', n: 40,
  discordant: 0, informative: 40, tau: 0.1, n_parity: 40, grader_sensitivity: 0.6, reference: 'claude-fable-5-1@max',
  scope: 'small_talk_request_v2', p_fail: {runs: 40, failures: 3}, reference_p_fail: {runs: 80, failures: 4}});
const localRow = r => (r.law?.candidates ?? []).find(([key]) => key.startsWith('local:')) ?? null;

test('round 5: a passed checklist audit admits the local row only inside its request scope (small_talk_request_v2)', async () => {
  const {route, table, mirror} = await auditedCore(PASSED_F1_AUDIT);
  const q = question(12), law = lawOf(q);
  // In scope (Q12, first turn): form (c), the argmin.
  const inScope = route(q, law);
  assert.equal(inScope.route, 'local:qwen3.5:9b@none');
  assert.equal(localRow(inScope)[1], 'c:audit-0123456789ab');
  // Out of the scope the checklist can judge, on the same F1 reading: a fact,
  // advice, an approval, an action. At most a REVAS verified start; never
  // form (c), and the reference wins.
  for (const request of ['Book recommendations for summer?', '오래 생각해봤는데 이직할까?', '그대로 보내', '진행해']) {
    const r = route(q, law, {request});
    assert.notEqual(r.route, 'local:qwen3.5:9b@none', request);
    assert.ok(!localRow(r) || localRow(r)[1].startsWith('v:'), request + ' ' + JSON.stringify(localRow(r)));
  }
  // The host's work floors (an external action, an approval) are a
  // capability floor of the tool-free local row: not even a candidate.
  for (const signals of [['external_action'], ['approval', 'work_order'], ['approval']]) {
    // As the host combines them: an approval is a hard order (no soft_work).
    const floored = lawOf(q, c => ({...c, request_profile: {...c.request_profile, answer_kind: 'work', difficulty: 'unknown',
      task_type: 'action', signals: [...new Set([...c.request_profile.signals.filter(x => !x.startsWith('soft_')), ...signals])].sort()}}));
    const r = route(q, floored, {request: '안녕 :) 그냥 잡담이야, 도구 필요 없어 — 그리고 택시 불러줘'});
    assert.equal(localRow(r), null, signals.join('+'));
  }
  // A later turn: never the local row (lead decision 1).
  assert.equal(localRow(route(q, law, {context: transcript('안녕', '안녕하세요! 반가워요.')})), null);
  // Pure: without the request the scope cannot be judged, so nothing admits.
  assert.equal(mirror.lawLocalEvidence(table, 'qwen3.5:9b', 'F1'), null);
  assert.equal(lawLocalEvidence(TABLE, 'qwen3.5:9b', 'F1'), null, 'the shipped table carries no audit');
});

test('round 5: a form (c) row is priced on the event the runtime escalates it on (its structural screen), the checklist rate reported', async () => {
  const {route, table, mirror} = await auditedCore(PASSED_F1_AUDIT);
  const q = question(12);
  const r = route(q, lawOf(q));
  assert.equal(r.route, 'local:qwen3.5:9b@none');
  // Its ladder binds no verifier: only the structural screen escalates it, to
  // the full answer at its target (the cheapest runnable reference).
  assert.equal(r.ladder.verifier, undefined);
  const references = r.law.candidates.filter(([, form, , eq, excluded]) => form === 'reference' && excluded === null && eq !== null)
    .sort((a, b) => a[3] - b[3]);
  const target = references[0];
  const [surface, rest] = [target[0].split(':')[0], target[0].slice(target[0].indexOf(':') + 1)];
  const targetRow = {surface, model: rest.slice(0, rest.lastIndexOf('@')), effort: rest.slice(rest.lastIndexOf('@') + 1)};
  const pScreen = mirror.lawScreenPFail(table, {model: 'qwen3.5:9b', effort: 'none'}, targetRow, null);
  assert.ok(Math.abs(r.law.eq - pScreen * target[3]) < 2e-6, `${r.law.eq} vs ${pScreen} x ${target[3]}`);
  assert.ok(r.reason.includes('law_p_fail_' + pScreen.toFixed(4)), r.reason);
  // The gate's replay prices the same event: its draw equals the receipt's
  // E[Q] (review of round 4: they diverged once an audit was embedded).
  const priced = priceRoute({candidate: r.candidate, kind: r.kind, ladder: r.ladder, law: r.law}, r.catalog, r.law.shape, table, 'F1',
    r.law.reading);
  const rate = r.law.rates.anthropic_shared.rate;
  assert.ok(Math.abs(priced.draw.Cw * rate + priced.draw.Px * (r.law.rates.openai_codex?.rate ?? 0) - r.law.eq) < 2e-6,
    `${JSON.stringify(priced.draw)} x ${rate} vs ${r.law.eq}`);
  // The audit's own checklist failure rate is the evidence's report.
  const pRef = (4 + 1) / (80 + 2);
  assert.equal(r.law.audit.priced_on, 'structural_screen');
  assert.ok(Math.abs(r.law.audit.checklist_p_fail - (3 + 2 * pRef) / (40 + 2)) < 1e-6);
});

test('round 5: with every pool exhausted the form (c) local row answers in its scope (a failure holds); out of scope the request is held', async () => {
  const {route} = await auditedCore(PASSED_F1_AUDIT);
  const q = question(12);
  const law = exhausted(lawOf(q));
  const r = route(q, law);
  assert.equal(r.route, 'local:qwen3.5:9b@none');
  assert.equal(r.ladder.reference_candidate_id, null, 'no runnable step: a failure holds the request');
  assert.ok(r.reason.includes('escalation_none_hold_on_fail'), r.reason);
  assert.throws(() => route(q, law, {request: 'Book recommendations for summer?'}), /no_dispatchable_candidate/);
});
