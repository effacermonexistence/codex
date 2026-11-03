// Build 447, DESIGN-8 lead corrections (2026-10-29): evidence form (c) from
// paired-audit verdicts, the value of information per (cell, family), the
// paired-audit harness (frozen local checklists, answer lock, the weekly cap,
// local grading, paid runs refused without explicit confirmation) and the
// replay's headroom and release-gate arithmetic. Zero quota: a stub local
// model, the fake dispatcher and temporary files only; no Ollama, provider,
// network or real HOME. The corpus is the owner fixture's recorded catalogs (build 449: 30).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {routingLawTable, lawEvidence} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {weeklyTraffic, planAudits, writeChecklists, runAudit, gradeAudit, spendThisWeek, spendInWindows, asrHints, matchingHints,
  answerRequest, passPrior, pathPrice, stratifiedSample, spendWindow, measureSensitivity}
  from '../routing-law-audit.mjs';
import {atHeadroom, gateOf, breakEven, lawCatalog, clockOf, routeOf} from '../routing-law-replay.mjs';
import {checklistAuditContext, compileAudits, harnessPin} from '../routing-law-table.mjs';
import * as fake from './routing-law-audit-fake-dispatcher.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = text => createHash('sha256').update(text).digest('hex');
const TABLE = routingLawTable();
const OWNER = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/routing-law-owner-questions.json'), 'utf8'));
const CORPUS = OWNER.questions.filter(q => !q.pending).map(q => ({index: q.n, request: q.request, catalog: q.catalog, receipt: q.receipt}));
const INTENTS = Object.fromEntries(OWNER.questions.filter(q => !q.pending && q.intent).map(q => [q.n, q.intent]));
const NOW = Date.parse('2026-10-30T05:00:00Z');
// Round 4 of the 448 review (lead decision 3): the traffic is a measured rate
// and each cell's horizon its evidence's lifetime from the catalog history
// (here a synthetic history: 20 days, one local model change, so 20 days).
const TRAFFIC = {requests: 44, explicit_excluded: 0, span_days: 7, per_day: 44 / 7};
const DAY = 86_400_000;
const HISTORY = {schema: 1, rows: [0, 5, 10, 15, 20].map((d, i) => ({at_ms: NOW - (20 - d) * DAY,
  pools: ['anthropic_shared', 'openai_codex'], models: {anthropic_shared: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5',
    'claude-haiku-4-5-20251001'], openai_codex: ['gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol']},
  references: {anthropic_shared: 'claude-fable-5-1', openai_codex: 'gpt-6-astra'}, local: i < 2 ? 'qwen3.5:4b' : 'qwen3.5:9b'}))};
const plan = () => planAudits({catalogs: CORPUS, intents: INTENTS, traffic: TRAFFIC, now: NOW, history: HISTORY});

test('evidence (c): a passed PARITY audit admits a cell with a gap of evidence, never one with evidence against, never under P', () => {
  const pass = (id, n, admits) => ({verdict: 'pass', id, n, discordant: 0, n_parity: 2, admits});
  const audited = {...TABLE, audits: {cells: {
    'claude-haiku-4-5-20251001@none|F4': pass('audit-0123456789ab', 2, true),
    'gpt-6-luna@low|F4': pass('audit-ba9876543210', 2, true),
    'claude-haiku-4-5-20251001@none|F2': {verdict: 'inconclusive', id: 'audit-aaaaaaaaaaaa', n: 2, discordant: 0, admits: false},
    'claude-haiku-4-5-20251001@none|F12': pass('audit-cccccccccccc', 2, false)}}};
  // DESIGN-9: the request's tiers at its band (a standard knowledge answer:
  // T1 + T1F). Haiku has no score on them (a gap of evidence, unscored): only
  // a parity audit admits it.
  const ev = (table, model, effort, family) => lawEvidence(table, ['T1', 'T1F'], model.startsWith('gpt') ? 'openai_codex' :
    'anthropic_shared', model, effort, family, {band: 'standard'});
  assert.deepEqual([ev(TABLE, 'claude-haiku-4-5-20251001', 'none', 'F4').form, ev(TABLE, 'claude-haiku-4-5-20251001', 'none', 'F4').gap,
    ev(audited, 'claude-haiku-4-5-20251001', 'none', 'F4').form], ['none', true, 'c']);
  assert.equal(ev(audited, 'claude-haiku-4-5-20251001', 'none', 'F4').audit, 'audit-0123456789ab');
  assert.equal(ev(audited, 'gpt-6-luna', 'low', 'F4').form, 'none'); // T1 fails tau (MMMU-Pro 13.2 below Astra's best)
  assert.equal(ev(audited, 'claude-haiku-4-5-20251001', 'none', null).form, 'none'); // P passes no family
  assert.equal(ev(audited, 'claude-haiku-4-5-20251001', 'none', 'F2').form, 'none'); // inconclusive admits nothing
  assert.equal(ev(audited, 'claude-haiku-4-5-20251001', 'none', 'F12').form, 'none'); // provisional admits nothing
  // The compiler carries only well-formed verdicts of the rule, and admits
  // only a parity audit: n_parity informative questions sampled at random.
  const rule = 'r', digest = 'a'.repeat(64);
  assert.deepEqual(compileAudits({schema: 1, rule, cells: {'m@high|F4': {verdict: 'pass', answers_sha256: digest, n: 3, discordant: 0}}}).cells,
    {'m@high|F4': {verdict: 'pass', id: 'audit-aaaaaaaaaaaa', n: 3, discordant: 0, n_parity: null, admits: false}});
  assert.equal(compileAudits({schema: 1, rule, cells: {'m@high|F4': {verdict: 'pass', answers_sha256: digest, n: 3, discordant: 0,
    n_parity: 3, informative: 3, sampling: 'stratified_random'}}}).cells['m@high|F4'].admits, true);
  assert.equal(compileAudits({schema: 1, rule, cells: {'m@high|F4': {verdict: 'pass', answers_sha256: digest, n: 3, discordant: 0,
    n_parity: 3, informative: 3, sampling: 'corpus_order'}}}).cells['m@high|F4'].admits, false);
  for (const bad of [{'m@high|F4': {verdict: 'maybe', answers_sha256: digest, n: 3}}, {'m@high': {verdict: 'pass', answers_sha256: digest, n: 3}},
    {'m@high|F4': {verdict: 'pass', answers_sha256: 'x', n: 3}}, {'m@high|F4': {verdict: 'pass', answers_sha256: digest, n: 0}}])
    assert.throws(() => compileAudits({schema: 1, rule, cells: bad}), /bad audit verdict/);
  assert.deepEqual(TABLE.audits.cells, {}, 'no audit has run: no form (c) in the shipped table');
});

test('weekly traffic: distinct Auto tasks first dispatched in the trailing 7 days; explicit routes excluded', () => {
  const day = 86_400_000;
  const line = (task, ago, kind = 'law') => JSON.stringify({task_id: task, route_kind: kind, dispatched_at_ms: NOW - ago});
  const text = [line('a', day), line('a', 2 * day), line('b', 6 * day), line('c', 8 * day), line('d', day, 'explicit_route'),
    line('e', 3 * day, 'explicit'), 'not json', line('c', 3 * day)].join('\n');
  const traffic = weeklyTraffic(text, NOW);
  assert.deepEqual([traffic.requests, traffic.explicit_excluded], [2, 2]); // a, b; c first ran 8 days ago
});

test('value of information: gap cells only, never P; parity n, P(pass), the price path and deferral; nothing without a grader', () => {
  const result = plan();
  assert.deepEqual(result.derivation_check.mismatches, []);
  assert.ok(result.derivation_check.admissible_rows_repriced > 0);
  assert.ok(result.audits.length > 0);
  for (const audit of result.audits) {
    assert.notEqual(audit.family, 'P');
    // A gap of evidence, or (build 448) the local model where it may only
    // start as a REVAS verified start ('v:' its judge): its (c) audit.
    assert.ok(audit.evidence_now.every(form => (form.startsWith('x:') && !/=fail(?:,|$)/.test(form)) ||
      (audit.cell === 'qwen3.5:9b@none' && form.startsWith('v:'))), audit.id);
    // n is the PARITY bound at the family's tightest percentage tau (no grader
    // sensitivity measured: s = 1, a lower bound), never a cost break-even.
    if (audit.tau_excess_rate) assert.equal(audit.n, Math.ceil(Math.log(0.1) / Math.log(1 - audit.tau_excess_rate)), audit.id);
    assert.ok(audit.p_pass > 0 && audit.p_pass < 1);
    assert.equal(audit.voi, Math.max(audit.voi_now, audit.voi_after_reset ?? -Infinity));
    if (TABLE.families[audit.family]?.tools === 'agent' && audit.rows_saving > 0) assert.equal(audit.decision, 'not_auditable_tool_surface');
  }
  // Build 448 (lead order): the local F2 audit is in the plan; its parity n
  // comes from its tiers' tau. Review of round 3: small talk's deterministic
  // verifier failed its routed held-out set F, so F1 admits no pool row below
  // the reference by (a): F1's pool rows are gaps of evidence (F1 names no
  // skill), and step 6 prices their paired audits. DESIGN-9 section 4.8: the
  // owner judges small talk, so its local row is admitted (form o) and no
  // audit of it is planned.
  const localF2 = result.audits.find(a => a.id === 'qwen3.5:9b@none|F2');
  assert.ok(localF2, 'the local F2 audit is planned');
  const f1 = result.audits.filter(a => a.family === 'F1');
  assert.ok(f1.length > 0, 'F1 pool rows are gaps of evidence: audited by VOI');
  assert.ok(!f1.some(a => a.id === 'qwen3.5:9b@none|F1'), 'the owner judges the local F1 row: no audit');
  assert.ok(localF2.n > 0 && localF2.tau_excess_rate > 0);
  assert.equal(localF2.tau_excess_rate, TABLE.tau.pct.tau / 100, 'DESIGN-9: one percentage tau, 1.2 points');
  assert.equal(localF2.cost.Cw + localF2.cost.Px > 0, true, 'its reference answers are paid; the local answers draw nothing');
  // DESIGN-9: the verified start's check now runs at an admissible Sonnet 5.5
  // medium (the reference's result on a light knowledge answer), cheaper than
  // a (c) admission's structural-screen escalation to the reference: on this
  // fixture admitting the local row would save nothing.
  assert.deepEqual([localF2.saving_path, localF2.decision], [0, 'no_saving']);
  // The horizon is the evidence's measured lifetime: the local cell's one
  // model change in 20 days; a pool cell with no change seen, the span.
  assert.equal(localF2.lifetime_days, 20);
  assert.equal(localF2.lifetime_basis, 'mean_interval_between_changes');
  assert.ok(result.audits.filter(a => a.cell !== 'qwen3.5:9b@none').every(a => a.lifetime_basis === 'censored_no_change_seen_span_lower_bound'));
  // No catalog history: no lifetime, nothing can be scheduled.
  const blind = planAudits({catalogs: CORPUS, intents: INTENTS, traffic: TRAFFIC, now: NOW, sensitivity: {s: 1}});
  assert.equal(blind.scheduled.length, 0);
  assert.ok(blind.audits.every(a => a.blockers.includes('no_lifetime_or_traffic_measurement')));
  // Until the grader's sensitivity is measured nothing is scheduled.
  assert.equal(result.scheduled.length, 0);
  assert.ok(Object.keys(result.totals.by_decision).every(d => !d.startsWith('scheduled')));
  // P(pass): Laplace over the cell's own matched tiers.
  assert.equal(passPrior('x:T1=unscored,T1F=unpublished'), 1 / 2);
  assert.equal(passPrior('x:T1=pass,T1F=unscored,T2P=short'), 3 / 4);
  // The price path: spot until the reset, then 1, time-weighted.
  const week = 7 * 86_400_000;
  assert.ok(Math.abs(pathPrice({rate: 8, basis: 'observed_window', ttr: 0.25}, week) - (0.25 * 8 + 0.75)) < 1e-12);
  assert.equal(pathPrice({rate: 1.6667, basis: 'remaining_whole_window_ahead', ttr: 1}, week), 1.6667); // no reset known
  // The sample: stratified by difficulty, reproducible, never corpus order.
  const rows = Array.from({length: 40}, (_, i) => ({index: i, difficulty: i % 4 === 0 ? 'deep' : 'standard'}));
  const a = stratifiedSample(rows, 8, 'cell|week'), b = stratifiedSample(rows, 8, 'cell|week');
  assert.deepEqual(a, b);
  assert.equal(a.filter(i => i % 4 === 0).length, 2); // 10 of 40 rows are deep: 2 of 8
  assert.notDeepEqual(a, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(stratifiedSample(rows, 41, 'x'), null);
  // The audit window is the pool's reset window, not the ISO week.
  assert.match(spendWindow('anthropic_shared', {basis: 'observed_window', ttr: 0.5}, NOW), /^anthropic_shared@reset:2026-11-0/);
  assert.match(spendWindow('openai_codex', {basis: 'remaining_whole_window_ahead', ttr: 1}, NOW), /@iso-week:2026-10-26$/);
  // No traffic: no saving can pay for any audit.
  const idle = planAudits({catalogs: CORPUS, intents: INTENTS, traffic: {...TRAFFIC, requests: 0, per_day: 0}, now: NOW,
    sensitivity: {s: 1}, history: HISTORY});
  assert.equal(idle.scheduled.length, 0);
});

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-audit-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}
const stubChecklist = async (model, system, user) => ({items: ['states the main point', 'answers the question asked', 'is correct']});
// The harness is tested apart from the economics (no fixture audit pays at
// parity): one plan audit marked scheduled with two of its offered questions,
// each run against its own audit reference.
async function frozen(t) {
  const base = plan();
  // A pool cell's audit (both arms draw quota: the cap is per pool and per
  // its reset window); build 449's plan lists the local F2 audit first.
  const source = base.audits.find(a => a.pool !== 'none' && Object.keys(a.offered_rows).length >= 2) ??
    (() => { throw new Error('the fixture plan has no pool audit offered on two questions'); })();
  const indices = Object.keys(source.offered_rows).map(Number).slice(0, 2);
  const audit = {...source, decision: 'scheduled', n: 2, questions: indices, grader_sensitivity: 1,
    question_references: Object.fromEntries(indices.map(index => [index, source.offered_rows[index]]))};
  const result = {...base, audits: [audit], scheduled: [audit.id]};
  const planBytes = Buffer.from(JSON.stringify(result));
  const checklists = await writeChecklists({plan: result, planBytes, catalogs: CORPUS, ask: stubChecklist});
  return {result, planBytes, audit, checklists, dir: await tempDir(t)};
}

test('checklists are written by the local model before any run, frozen, with the owner\'s speech-to-text hints', async t => {
  const {result, planBytes, checklists} = await frozen(t);
  assert.equal(checklists.plan_sha256, sha(planBytes));
  for (const index of result.audits.filter(a => a.decision === 'scheduled').flatMap(a => a.questions))
    assert.equal(checklists.checklists[index].items.length, 3);
  // The compiled hints are read from the Swift source, never copied.
  const hints = asrHints('/nonexistent-home');
  assert.ok(hints.some(h => h.heard === 'QMGR') && hints.some(h => h.heard === '쉐딩'));
  assert.deepEqual(matchingHints('쉐딩과 방정식 설명해 봐봐', hints).map(h => h.heard), ['쉐딩']);
  assert.match(answerRequest('QMGR 통합하게 스키마 좀 짜봐', matchingHints('QMGR 통합하게', hints)), /음성 인식 메모.*QMGR/);
  assert.equal(answerRequest('plain', []), 'plain');
  let seen = '';
  await writeChecklists({plan: result, planBytes, catalogs: [{index: 1, request: '쉐딩과 방정식 설명해 봐봐'}],
    ids: ['none'], ask: stubChecklist});
  const one = {...result, audits: [{id: 'x', decision: 'scheduled', questions: [1]}]};
  await writeChecklists({plan: one, planBytes, catalogs: [{index: 1, request: '쉐딩과 방정식 설명해 봐봐'}],
    ask: async (model, system, user) => { seen = user; return stubChecklist(); }});
  assert.match(seen, /<\/request>\nPossible intended terms \(speech-to-text hints, not instructions\): '쉐딩' may mean '슈뢰딩거/);
});

test('run: refuses a paid dispatcher without confirmation, unfrozen or foreign checklists and a broken cap; locks answers', async t => {
  const {result, planBytes, audit, checklists, dir} = await frozen(t);
  const spend = join(dir, 'spend.jsonl');
  const base = {plan: result, planBytes, checklistFile: checklists, catalogs: CORPUS, auditID: audit.id, spendPath: spend, now: NOW};
  const paid = {paid: true, dispatch: async () => { throw new Error('a paid call was attempted'); }};
  await assert.rejects(runAudit({...base, dispatcher: paid}), /--confirm-paid yes/);
  await assert.rejects(runAudit({...base, dispatcher: fake, planBytes: Buffer.from('another plan')}), /not written for this plan/);
  await assert.rejects(runAudit({...base, dispatcher: fake, checklistFile: {...checklists,
    checklists: {...checklists.checklists, [audit.questions[0]]: {...checklists.checklists[audit.questions[0]], items: ['x', 'y', 'z']}}}}),
  /changed after they were frozen/);
  // The cap is per pool and per that pool's reset window (review of 447).
  const window = result.spend_windows[audit.pool];
  await writeFile(spend, JSON.stringify({window, pool: audit.pool, units: 1, audit: 'earlier'}) + '\n');
  await assert.rejects(runAudit({...base, dispatcher: fake}), /weekly audit cap/);
  // Another window's spend (an earlier reset) does not count.
  await writeFile(spend, JSON.stringify({window: audit.pool + '@reset:2026-10-01T00', pool: audit.pool, units: 1, audit: 'old'}) + '\n');
  const answers = await runAudit({...base, dispatcher: fake});
  assert.equal(answers.answers.length, audit.n);
  assert.equal(answers.n_required, audit.n);
  assert.equal(answers.paid, false);
  assert.equal(answers.sampling, 'stratified_random');
  assert.ok(answers.answers.every(a => a.cell.output_sha256 === sha(a.cell.output) && a.reference.output_sha256 === sha(a.reference.output)));
  // Each question runs against its own audit reference.
  for (const a of answers.answers) assert.equal(a.reference.route, audit.question_references[a.index]);
  assert.deepEqual(spendInWindows(spend, result.spend_windows), {[audit.pool]: 0});
  // A dispatcher that reports no draw is charged its planned draw, and the cap
  // is re-checked after every dispatch: a costly answer stops the audit.
  await writeFile(spend, '');
  const silent = {paid: false, dispatch: async args => ({output: 'x ' + args.model})};
  await runAudit({...base, dispatcher: silent});
  const charged = (await readFile(spend, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(charged.length === 2 * audit.n && charged.every(r => r.charged === 'planned_no_reported_draw' && r.units > 0));
  await writeFile(spend, '');
  const costly = {paid: false, dispatch: async args => ({output: 'x', draw: {pool: args.surface === 'codex' ? 'openai_codex' : 'anthropic_shared', units: 0.6}})};
  await assert.rejects(runAudit({...base, dispatcher: costly}), /cap (exceeded|would be exceeded)/);
});

test('grade: the local model checks every item; a question counts only when the reference passes (no vacuous pass)', async t => {
  const {result, planBytes, audit, checklists, dir} = await frozen(t);
  const answers = await runAudit({plan: result, planBytes, checklistFile: checklists, catalogs: CORPUS, auditID: audit.id,
    dispatcher: fake, spendPath: join(dir, 'spend.jsonl'), now: NOW});
  const grader = verdicts => async (model, system, user) => {
    const arm = user.includes('[fixture ' + audit.audit_references[0]) ? 'reference' : 'cell';
    return {items: [1, 2, 3].map(n => ({n, pass: verdicts[arm]}))};
  };
  const both = await gradeAudit({checklistFile: checklists, answersFile: answers, ask: grader({reference: false, cell: false})});
  assert.deepEqual([both.verdict, both.informative, both.discordant], ['inconclusive', 0, 0]);
  const parity = await gradeAudit({checklistFile: checklists, answersFile: answers, ask: grader({reference: true, cell: true})});
  assert.deepEqual([parity.verdict, parity.informative], ['pass', audit.n]);
  const worse = await gradeAudit({checklistFile: checklists, answersFile: answers, ask: grader({reference: true, cell: false})});
  assert.deepEqual([worse.verdict, worse.discordant], ['fail', audit.n]);
  await assert.rejects(gradeAudit({checklistFile: checklists, answersFile: {...answers, answers: answers.answers.map(a =>
    ({...a, cell: {...a.cell, output: 'edited'}}))}, ask: grader({reference: true, cell: true})}), /changed after they were locked/);
});

test('replay headroom: an exhausted pool\'s rows leave every arm; the pools\' windows keep their share still to run', () => {
  const q = OWNER.questions.find(item => item.n === 3);
  const generated = Date.parse('2026-10-30T05:17:11Z');
  const pools = {anthropic_shared: {observed_at_ms: generated - 169_000, valid_until_ms: generated + 431_000,
      windows: [{used_percent: 95, resets_at_ms: generated + 0.4 * 604_800_000, window_minutes: 10080}]},
    openai_codex: {observed_at_ms: generated - 1000, valid_until_ms: generated + 599_000,
      windows: [{used_percent: 100, resets_at_ms: generated + 0.7 * 604_800_000, window_minutes: 10080}]}};
  const law = atHeadroom(lawCatalog(q, q.intent), {kind: 'pools', pools, generated_at_ms: generated});
  assert.ok(!law.candidates.some(row => row.quota_pool === 'openai_codex'));
  assert.ok(law.candidates.filter(row => row.quota_pool === 'anthropic_shared').every(row => Math.abs(row.quota_remaining_fraction - 0.05) < 1e-12));
  const shifted = law.routing_law.pools.anthropic_shared;
  assert.equal(shifted.windows[0].resets_at_ms - clockOf(law), 0.4 * 604_800_000);
  const routed = routeOf(q.request, law);
  assert.deepEqual([routed.law.rates.anthropic_shared.basis, routed.law.rates.anthropic_shared.rate], ['observed_window', 8]);
  // Round 3 of the 448 review (decision 2): the reference is priced at Q
  // alone (the top of the frontier); opus@xhigh (form b: DESIGN-9, the same
  // result on T1 + T1F at the standard band) escalates only on the runtime's
  // structural screen, priced Q + p_screen x Q(fable) with p_screen from the
  // ledger's screened attempts: cheaper than fable@max at any rate.
  assert.equal(routed.route, routed.law.argmin);
  assert.equal(routed.route, 'claude-chat:claude-opus-5-5@xhigh');
  assert.ok(!atHeadroom(q.catalog, {kind: 'remaining', remaining: {openai_codex: 0}}).candidates.some(row => row.quota_pool === 'openai_codex'));
});

test('the release gate: priced only at a DERIVED exchange, on the draw, against 446 and all-reference; law_model and Astra starts reported', () => {
  const arm = (Cw, Px, priced) => Object.fromEntries(['start', 'draw', 'law_model'].map(b => [b, {Cw, Px, priced}]));
  const observed = {anthropic_shared: {price: 2, basis: 'observed_window'}, openai_codex: {price: 0.5, basis: 'observed_window'}};
  const moved = gateOf({law447: arm(5, 1, 10.5), build446: arm(1, 50, 27), all_reference: arm(6, 3, 13.5)}, {law447: 2, build446: 3}, observed);
  assert.deepEqual([moved.draw.build446.per_pool, moved.draw.build446.priced], ['FAIL', 'PASS']); // more Cw: no Pareto
  assert.deepEqual([moved.draw.all_reference.per_pool, moved.draw.all_reference.priced], ['PASS', 'PASS']);
  assert.equal(moved.release, 'PASS');
  assert.equal(moved.exchange_Cw_per_Px, 4);
  // The break-even exchange with the routes held: 4 Cw more for 49 Px less: cheaper while x < 12.25.
  assert.deepEqual(moved.draw.build446.break_even_Cw_per_Px, {x: 12.25, cheaper_when: 'below'});
  // Review of 447: the recorded 0.6 / 0.6 fallback (1 / 0.6 both) is the 1:1 sum, not an exchange.
  const fallback = {anthropic_shared: {price: 1 / 0.6, basis: 'remaining_whole_window_ahead'},
    openai_codex: {price: 1 / 0.6, basis: 'remaining_whole_window_ahead'}};
  const recorded = gateOf({law447: arm(5, 1, 10), build446: arm(1, 50, 85), all_reference: arm(6, 3, 15)}, {law447: 2, build446: 3}, fallback);
  assert.deepEqual([recorded.draw.build446.priced, recorded.release], ['NO_DERIVED_EXCHANGE', 'NO_DERIVED_EXCHANGE']);
  assert.equal(gateOf({law447: arm(5, 1, 10), build446: arm(1, 50, 85), all_reference: arm(6, 3, 15)}, {law447: 2, build446: 3}).release,
    'NO_DERIVED_EXCHANGE');
  // Review of round 3: every pool exhausted, no arm can draw (all cost 0):
  // 'less quota' compares nothing, so the regime is NOT_APPLICABLE, never a
  // FAIL; the sweep's verdict needs every applicable regime to pass.
  const exhausted = {anthropic_shared: {price: Infinity, basis: 'observed_window'}, openai_codex: {price: Infinity, basis: 'observed_window'}};
  assert.equal(gateOf({law447: arm(0, 0, 0), build446: arm(0, 0, 0), all_reference: arm(0, 0, 0)}, {law447: 0, build446: 0}, exhausted).release,
    'NOT_APPLICABLE_NO_DRAWABLE_POOL');
  // Round 4: a stale observation of a still-exhausted window is a derived
  // price (Infinity until its reset; usage only rises in a window): the
  // other pool's fresh rate prices the comparison. Any other stale
  // observation is not.
  const staleExhausted = {anthropic_shared: {price: 0.99, basis: 'observed_window'},
    openai_codex: {price: Infinity, basis: 'stale_window_whole_window_ahead'}};
  assert.equal(gateOf({law447: arm(5, 0, 4.95), build446: arm(6, 0, 5.94), all_reference: arm(7, 0, 6.93)}, {law447: 0, build446: 0},
    staleExhausted).release, 'PASS');
  const staleOpen = {...staleExhausted, openai_codex: {price: 2, basis: 'stale_window_whole_window_ahead'}};
  assert.equal(gateOf({law447: arm(5, 0, 4.95), build446: arm(6, 0, 5.94), all_reference: arm(7, 0, 6.93)}, {law447: 0, build446: 0},
    staleOpen).release, 'NO_DERIVED_EXCHANGE');
  const astra = gateOf({law447: arm(1, 1, 2), build446: arm(2, 2, 4), all_reference: arm(3, 3, 6)}, {law447: 4, build446: 3}, observed);
  // Owner, 2026-10-30: Astra starts are reported, never a gate; the objective decides.
  assert.deepEqual([astra.release, astra.astra.verdict], ['PASS', 'FAIL']);
  // Round 3 of the 448 review (decision 2): the release is judged on the
  // draw (what the runtime runs, which E[Q] prices for every row); law_model
  // (a writer's unrun next step added) is a report: cheaper on the draw passes
  // and the report names the law_model gap.
  const bases = {law447: {start: {Cw: 1, Px: 1, priced: 2}, draw: {Cw: 1, Px: 1, priced: 2}, law_model: {Cw: 5, Px: 5, priced: 10}},
    build446: arm(2, 2, 4), all_reference: arm(3, 3, 6)};
  const drawGate = gateOf(bases, {law447: 0, build446: 0}, observed);
  assert.deepEqual([drawGate.release, drawGate.release_parts.priced_draw, drawGate.release_parts.law_model_report], ['PASS', 'PASS', 'FAIL']);
  const dearer = {...bases, law447: {...bases.law447, draw: {Cw: 9, Px: 9, priced: 18}}};
  assert.equal(gateOf(dearer, {law447: 0, build446: 0}, observed).release, 'FAIL');
  const equal = gateOf({law447: arm(1, 0, 2), build446: arm(1, 0, 2), all_reference: arm(3, 0, 6)}, {law447: 0, build446: 0}, observed);
  assert.equal(equal.draw.build446.per_pool, 'FAIL', 'equal in both pools is not cheaper');
  assert.deepEqual(breakEven({Cw: 1, Px: 0}, {Cw: 3, Px: 0}), {x: 0, cheaper_when: 'always'});
});

test('grader sensitivity: planted failures per checklist item, graded locally', async () => {
  const checklistFile = {sha256: 'c'.repeat(64), checklists: {1: {index: 1, request: 'q', items: ['a', 'b', 'c']}}};
  let call = 0;
  const ask = async (model, system) => {
    if (system.startsWith('You write one answer')) return {answer: 'planted ' + call};
    call++;
    // The grader misses the planted failure of item 2 only.
    return {items: [1, 2, 3].map(n => ({n, pass: call === 2 ? n !== 1 : n !== call}))};
  };
  const result = await measureSensitivity({checklistFile, ask});
  assert.deepEqual([result.planted, result.detected], [3, 2]);
  assert.ok(Math.abs(result.s - 2 / 3) < 1e-12);
});

// ---- Round 4 of the 448 review (lead decision 3): small talk's (F1) form (c)
// through the law's own mechanism. Zero quota: a stub grader, the fake
// dispatcher, temporary files.
const f1 = await import('../routing-law-f1-audit.mjs');

test('F1 audit: the pre-registered verdict: tau is the reference\'s own run-to-run spread, never set by hand', () => {
  const q = (cell, a, b) => ({cell: {pass: cell}, references: [{pass: a}, {pass: b}]});
  // 30 questions, the reference's runs disagree on 6 (tau 0.2), no discordant
  // pair, 24 informative: n_parity(0.2, s 1, 0.9) = 11 -> PASS.
  const graded = [...Array.from({length: 24}, () => q(true, true, true)), ...Array.from({length: 6}, (_, i) => q(i % 2 === 0, true, false))];
  const pass = f1.checklistVerdict(graded, 1);
  assert.deepEqual([pass.tau, pass.spread_pairs, pass.informative, pass.discordant, pass.n_parity, pass.verdict],
    [0.2, 6, 24, 0, 11, 'pass']);
  assert.deepEqual(pass.cell, {runs: 30, failures: 3});
  assert.deepEqual(pass.reference, {runs: 60, failures: 6});
  // One discordant pair (both reference runs pass, the cell fails): FAIL.
  assert.equal(f1.checklistVerdict([...graded.slice(1), q(false, true, true)], 1).verdict, 'fail');
  // A reference that never disagrees with itself: tau 0, no finite n: INCONCLUSIVE.
  const steady = f1.checklistVerdict(Array.from({length: 18}, () => q(true, true, true)), 1);
  assert.deepEqual([steady.tau, steady.n_parity, steady.verdict, steady.reason], [0, null, 'inconclusive', 'reference_spread_zero']);
  // An unmeasured grader sensitivity: INCONCLUSIVE; a weaker grader needs more.
  assert.equal(f1.checklistVerdict(graded, null).verdict, 'inconclusive');
  assert.ok(f1.nParity(0.2, 0.5) > f1.nParity(0.2, 1));
  // 3 informative with 1 spread pair in 4 (tau 0.25): n_parity 9 > 3.
  assert.equal(f1.checklistVerdict(graded.slice(0, 3).concat(graded.slice(24, 25)), 1).verdict, 'inconclusive');
});

// Round 5: the compiler trusts nothing the cell says about itself.
const F1_CHECKLIST_SHA = f1.loadChecklist().sha256;
const SENSITIVITY = {schema: 1, s: 0.95, grader_version: f1.GRADER_VERSION, checklist_sha256: F1_CHECKLIST_SHA, basis: 'fixture'};
const AUDIT_CONTEXT = checklistAuditContext({policy: JSON.parse(readFileSync(join(ROOT, 'scripts/routing-law-policy.json'), 'utf8')),
  checklistBytes: readFileSync(join(ROOT, f1.CHECKLIST_PATH)), sensitivities: [SENSITIVITY], quota: TABLE.quota, harness: harnessPin()});
const goodCell = () => ({kind: 'checklist_parity', verdict: 'pass', answers_sha256: 'a'.repeat(64), checklist_sha256: F1_CHECKLIST_SHA,
  sensitivity_sha256: f1.sensitivitySHA(SENSITIVITY), grader_version: f1.GRADER_VERSION, scope: 'small_talk_request_v2',
  requests_sha256: 'c'.repeat(64), exclusion_sha256: 'd'.repeat(64), lineage: 'e'.repeat(64), reference_harness: harnessPin(),
  n: 30, informative: 24, discordant: 0, tau: 0.2, spread_pairs: 6, grader_sensitivity: 0.95, confidence: 0.9,
  n_parity: f1.nParity(0.2, 0.95), sampling: 'stratified_random', reference: 'claude-fable-5-1@max',
  p_fail: {runs: 30, failures: 3}, reference_p_fail: {runs: 60, failures: 6}});

test('F1 audit: the compiler re-derives a checklist parity verdict from its counts against its pre-registered inputs only', () => {
  const rule = 'r';
  const compile = cell => compileAudits({schema: 1, rule, cells: {'qwen3.5:9b@none|F1': cell}}, AUDIT_CONTEXT).cells['qwen3.5:9b@none|F1'];
  // n_parity(0.2, 0.95, 0.9) = 11 <= 24 informative.
  const compiled = compile(goodCell());
  assert.equal(compiled.admits, true);
  assert.equal(compiled.kind, 'checklist_parity');
  assert.equal(compiled.scope, 'small_talk_request_v2');
  assert.deepEqual([compiled.p_fail, compiled.reference_p_fail], [{runs: 30, failures: 3}, {runs: 60, failures: 6}]);
  // A verdict its counts do not support never compiles.
  for (const bad of [{informative: 10}, {n_parity: 12}, {discordant: 1}, {spread_pairs: 0}, {grader_sensitivity: null},
    {p_fail: {runs: 29, failures: 3}}, {sampling: 'corpus_order'}])
    assert.throws(() => compile({...goodCell(), ...bad}), /checklist audit/, JSON.stringify(bad));
  // Nothing the cell says about itself is trusted (review of round 4: a
  // pasted cell with confidence 0.05, s 1, any checklist and any reference
  // compiled to PASS): the policy's confidence, the frozen checklist, a
  // committed sensitivity of this grader, a pool reference at its ceiling,
  // the shipped harness, the checklist's scope.
  const forged = [{confidence: 0.05, n_parity: 1}, {checklist_sha256: 'b'.repeat(64)}, {grader_sensitivity: 1, n_parity: f1.nParity(0.2, 1)},
    {sensitivity_sha256: 'f'.repeat(64)}, {grader_version: 'other'}, {reference: 'anything@max'}, {reference: 'claude-fable-5-1@high'},
    {reference_harness: {profile: 'H1@1', rendering_sha256: '0'.repeat(64)}}, {scope: null}, {lineage: 'x'}];
  for (const bad of forged) assert.throws(() => compile({...goodCell(), ...bad}), /checklist audit/, JSON.stringify(bad));
  assert.throws(() => compileAudits({schema: 1, rule, cells: {'qwen3.5:9b@none|F1': goodCell()}}), /no pre-registered context/);
  // An honest INCONCLUSIVE compiles and admits nothing.
  assert.equal(compile({...goodCell(), verdict: 'inconclusive', informative: 10}).admits, false);
});

test('F1 audit: step 6 from data: the evidence lifetime, the traffic rate and the exhausted share', () => {
  const life = f1.evidenceLifetime(HISTORY, {candidate: 'qwen3.5:9b', pool: 'none', references: ['anthropic_shared']});
  assert.equal(life.lifetime_ms, 20 * DAY);
  assert.deepEqual(life.changes.map(c => [c.key, c.from, c.to]), [['candidate', 'qwen3.5:4b', 'qwen3.5:9b']]);
  const steady = f1.evidenceLifetime(HISTORY, {candidate: 'claude-opus-5-5', pool: 'anthropic_shared', references: ['anthropic_shared']});
  assert.deepEqual([steady.lifetime_ms, steady.basis], [20 * DAY, 'censored_no_change_seen_span_lower_bound']);
  // A reference change and a retired candidate are changes too.
  const moved = {rows: HISTORY.rows.map((row, i) => ({...row, references: {...row.references, anthropic_shared: i < 3 ? 'claude-fable-5-1' :
    'claude-fable-5-2'}, models: {...row.models, anthropic_shared: i < 4 ? row.models.anthropic_shared : ['claude-fable-5-2']}}))};
  assert.equal(f1.evidenceLifetime(moved, {candidate: 'claude-opus-5-5', pool: 'anthropic_shared', references: ['anthropic_shared']})
    .changes.length, 2);
  assert.equal(f1.evidenceLifetime({rows: []}).lifetime_ms, null);
  const line = (task, at, kind = 'law') => JSON.stringify({task_id: task, route_kind: kind, dispatched_at_ms: at});
  const rate = f1.trafficRate([line('a', 0), line('a', DAY), line('b', 2 * DAY), line('c', 4 * DAY, 'explicit_route'), 'x'].join('\n'));
  assert.deepEqual([rate.requests, rate.explicit_excluded, rate.span_days, rate.per_day], [2, 1, 4, 0.5]);
  assert.deepEqual(f1.exhaustedShare({rows: [{pools: []}, {pools: ['openai_codex']}, {pools: []}, {pools: ['anthropic_shared']}]}),
    {catalogs: 4, no_drawable_pool: 2, share: 0.5});
});

const F1_REQUESTS = f1.buildRequestSet({corpusF1: [{request: '오늘 하루 어땠어? 나는 좀 피곤했어'}, {request: '진행해'}],
  fresh: ['나 승진했어!', 'I just got home', '오늘 하루 어땠어? 나는 좀 피곤했어', 'Good night!', '고마워 덕분에 살았다', '퇴근했다!',
    'Book recommendations for summer?', '방금 집 도착했어 ㅎㅎ', '오늘 너무 졸려', 'Long day today', '오늘 운동하고 왔어', '잘 자',
    'Good morning!', '배고프다', 'I\'m so tired', '드디어 금요일이다'],
  excluded: ['고마워 덕분에 살았어', '방금 집 도착했어']});
const AFTER_RESET = Date.parse('2026-11-02T09:00:00Z');
const POOLS_AFTER = {anthropic_shared: {observed_at_ms: AFTER_RESET - 60_000, valid_until_ms: AFTER_RESET + 540_000,
  windows: [{used_percent: 0, resets_at_ms: Date.parse('2026-11-09T07:59:59Z'), window_minutes: 10080}]},
  openai_codex: {observed_at_ms: AFTER_RESET - 60_000, valid_until_ms: AFTER_RESET + 540_000,
    windows: [{used_percent: 100, resets_at_ms: Date.parse('2026-11-05T07:08:27Z'), window_minutes: 10080}]}};
const LEDGER = Array.from({length: 40}, (_, i) => JSON.stringify({task_id: 't' + i, route_kind: 'law',
  dispatched_at_ms: AFTER_RESET - 20 * DAY + i * 12 * 3_600_000})).join('\n');
const MIX = {corpus: 370, f1_offered_first_turn: 49, f1_in_scope_first_turn: 4};
const f1Plan = (sensitivity = SENSITIVITY, extra = {}) => f1.planF1Audit({requestSet: F1_REQUESTS, pools: POOLS_AFTER, at: AFTER_RESET,
  history: HISTORY, ledgerText: LEDGER, mix: MIX, sensitivity, ...extra});

test('F1 audit: the population is the checklist\'s scope; tuning and inspection sets are excluded, near duplicates too', () => {
  const kept = F1_REQUESTS.items.map(i => i.request);
  assert.equal(F1_REQUESTS.scope, 'small_talk_request_v2');
  // Outside small_talk_request_v2 (an approval, a recommendation request): dropped.
  assert.ok(!kept.includes('진행해') && !kept.includes('Book recommendations for summer?'));
  // A tuning example ("고마워 덕분에 살았어", edit distance 1) and a contained
  // one: dropped and recorded; the exclusion list's digest is carried.
  assert.ok(!kept.includes('고마워 덕분에 살았다') && !kept.includes('방금 집 도착했어 ㅎㅎ'));
  assert.deepEqual(F1_REQUESTS.dropped.filter(d => d.reason === 'tuning_or_inspection_set').map(d => d.request),
    ['고마워 덕분에 살았다', '방금 집 도착했어 ㅎㅎ']);
  assert.match(F1_REQUESTS.exclusion.sha256, /^[a-f0-9]{64}$/);
  assert.ok(F1_REQUESTS.items.every(i => i.local_style === 'small_talk'));
  assert.deepEqual(F1_REQUESTS.items.map(i => i.scope_basis), ['text_profile_turn', ...Array(F1_REQUESTS.items.length - 1).fill('text_only')]);
  // Near-duplicate rule: two short greetings differing by a letter are different.
  assert.equal(f1.nearDuplicate(f1.normalizeRequest('잘 자'), f1.normalizeRequest('잘 가')), false);
  assert.equal(f1.nearDuplicate(f1.normalizeRequest('오늘 너무 졸려'), f1.normalizeRequest('오늘 너무 졸려!!')), true);
  // The prompt's own examples are tuning data.
  assert.ok(f1.promptExampleInputs({ko: 'x\n\nExamples:\n피곤해 -> a\n잘 자 -> b'}).includes('잘 자'));
});

test('F1 audit: a PASS must be reachable; the minimal paired audit accumulates across pool windows', () => {
  // Review of round 4: s 0.278 with 18 questions can pass at no reference
  // spread; 36 can (at tau 1/3); s 0.95 with 18 can.
  assert.equal(f1.passReachable(18, 0.2777777777777778, 0.9).reachable, false);
  assert.equal(f1.passReachable(36, 0.2777777777777778, 0.9).reachable, true);
  assert.equal(f1.passReachable(18, 0.95, 0.9).reachable, true);
  // The minimal audit is the smallest n reachable at ANY spread (here 31, and
  // only if the reference disagrees with itself on 15 of 31: tau 0.48, which
  // the plan reports); 30 questions can never pass with this grader.
  assert.equal(f1.minimalAudit(30, 0.2777777777777778, 0.9), null);
  assert.deepEqual([f1.minimalAudit(94, 0.2777777777777778, 0.9).n, f1.minimalAudit(94, 0.2777777777777778, 0.9).spread], [31, 15]);
  // A population too small for this grader: P(pass) 0, never run.
  const weak = f1Plan({...SENSITIVITY, s: 0.2777777777777778});
  assert.equal(weak.minimal_audit.n, null);
  assert.equal(weak.value_of_information.p_pass, 0);
  assert.equal(weak.decision, 'pass_unreachable_in_the_population');
});

test('F1 audit: the plan: the reference after the reset, a locked sensitivity, the cost of the whole audit, the cap per pool window, the VOI', () => {
  const plan = f1Plan();
  // After the Claude reset (Codex still exhausted) the audit reference is the
  // Claude pool's reference at its ceiling, on the chat lane.
  assert.equal(plan.reference.key, 'claude-chat:claude-fable-5-1@max');
  const q = TABLE.quota['claude-chat:claude-fable-5-1@max'].answer.q;
  // The sensitivity is locked by its digest; the harness is the shipped one.
  assert.equal(plan.sensitivity_sha256, f1.sensitivitySHA(SENSITIVITY));
  assert.deepEqual(plan.reference_harness, harnessPin());
  // The window is the pool's reset window, not the ISO week.
  assert.match(plan.cap.window, /^anthropic_shared@reset:2026-11-09T08$/);
  // The minimal audit for s 0.95 in this population and how many questions
  // this window's cap allows (two reference answers each, the local draws
  // nothing).
  const minimal = f1.minimalAudit(F1_REQUESTS.items.length, 0.95, 0.9);
  assert.ok(minimal !== null);
  assert.equal(plan.minimal_audit.n, minimal?.n ?? null);
  if (minimal) {
    assert.equal(plan.n, Math.min(minimal.n, Math.floor(1 / (2 * q))));
    assert.ok(Math.abs(plan.cost.whole_audit_left.Cw - minimal.n * 2 * q) < 1e-6);
  }
  // The VOI prices Core's post-pass E[Q] (the screen) along the path,
  // against the whole remaining audit; P(pass) is the shared prior.
  const v = plan.value_of_information;
  assert.ok(v.p_pass === 0.5 || v.p_pass === 0);
  assert.ok(v.p_screen_if_admitted > 0 && v.p_screen_if_admitted < 1);
  assert.equal(plan.decision === 'scheduled', v.voi > 0 && plan.blockers.length === 0);
  assert.match(plan.availability.not_priced, /not in the objective's units/);
  // No (or another grader's) sensitivity: nothing is scheduled.
  assert.ok(f1Plan(null).blockers.includes('grader_sensitivity_unmeasured'));
  assert.ok(f1Plan({...SENSITIVITY, grader_version: 'llm_only'}).blockers.includes('grader_sensitivity_unmeasured'));
  // Spend already recorded in the window leaves fewer questions.
  assert.ok(f1Plan(SENSITIVITY, {spent: {[plan.cap.window]: 0.99}}).n <= plan.n);
  // Before the reset (both pools exhausted): no reference can be drawn.
  const exhausted = {...POOLS_AFTER, anthropic_shared: {...POOLS_AFTER.anthropic_shared,
    windows: [{used_percent: 100, resets_at_ms: AFTER_RESET + DAY, window_minutes: 10080}]}};
  assert.equal(f1Plan(SENSITIVITY, {pools: exhausted}).decision, 'no_drawable_reference_at_the_planned_time');
});

test('F1 audit: the order is stratified, random and fixed by the lineage; earlier windows are never asked again', () => {
  const items = Array.from({length: 40}, (_, id) => ({id, source: id < 10 ? 'a' : 'b', language: id % 2 ? 'ko' : 'en'}));
  const order = f1.stratifiedOrder(items, 'lineage');
  assert.deepEqual([...order].sort((x, y) => x - y), items.map(i => i.id));
  assert.deepEqual(f1.stratifiedOrder(items, 'lineage'), order);
  // Every prefix keeps the strata near their shares (source a: a quarter).
  for (const k of [4, 8, 20]) assert.ok(Math.abs(order.slice(0, k).filter(id => id < 10).length - k / 4) <= 1, String(k));
  const plan = f1Plan();
  const earlier = {lineage: plan.lineage, answers: [{id: plan.questions[0]}], sha256: null};
  earlier.sha256 = sha(f1.canonical(earlier.answers));
  const next = f1Plan(SENSITIVITY, {earlier: [earlier]});
  assert.ok(!next.questions.includes(plan.questions[0]));
  assert.equal(next.minimal_audit.answered_earlier, 1);
  assert.throws(() => f1Plan(SENSITIVITY, {earlier: [{...earlier, lineage: 'other'}]}), /lineage/);
});

test('F1 audit: run refuses an unreachable or stale plan, an unscheduled one unless the lead says so, a paid dispatcher without confirmation; partial answers lock; grade pools windows with the locked sensitivity', async t => {
  const dir = await tempDir(t);
  const spend = join(dir, 'spend.jsonl');
  const base = f1Plan();
  // A runnable plan in this fixture (s 0.95 makes the audit reachable).
  const plan = {...base, decision: 'voi_below_cost', blockers: ['voi_below_cost']};
  const planBytes = Buffer.from(JSON.stringify(plan));
  const seen = [];
  const dispatcher = {paid: false, dispatch: async args => { seen.push(args);
    return args.surface === 'local' ? {output: '많이 피곤했구나, 고생 많았어.', draw: {pool: 'none', units: 0}} :
      {output: 'reference reply', draw: {pool: 'anthropic_shared', units: 0.02}, route: plan.reference.key, harness: harnessPin()}; }};
  const run = extra => f1.runF1Audit({plan, planBytes, requestSet: F1_REQUESTS, dispatcher, spendPath: spend, pools: POOLS_AFTER,
    now: AFTER_RESET, ...extra});
  await assert.rejects(run(), /did not schedule/);
  await assert.rejects(run({dispatcher: {...dispatcher, paid: true}, leadRunsUnscheduled: true}), /--confirm-paid yes/);
  await assert.rejects(run({requestSet: {...F1_REQUESTS, items: F1_REQUESTS.items.slice(1)}, leadRunsUnscheduled: true}), /request set/);
  // An unreachable plan never runs, whatever the lead passes.
  await assert.rejects(run({plan: {...plan, blockers: ['pass_unreachable_in_the_population'], decision: 'pass_unreachable_in_the_population'},
    leadRunsUnscheduled: true, confirmPaid: true}), /cannot run/);
  // A plan the pools no longer match (another window, another price).
  await assert.rejects(run({now: AFTER_RESET + 8 * DAY, leadRunsUnscheduled: true}), /plan again/);
  // The reference arm must be the plan's reference, through the shipped harness.
  await assert.rejects(run({leadRunsUnscheduled: true, dispatcher: {...dispatcher, dispatch: async args => args.surface === 'local' ?
    {output: 'x'} : {output: 'y', draw: {pool: 'anthropic_shared', units: 0.01}, route: 'claude:claude-opus-5-5@max', harness: harnessPin()}}}),
  /not claude-chat/);
  const spend2 = join(dir, 'spend2.jsonl');
  const answered = [];
  const answers = await run({spendPath: spend2, leadRunsUnscheduled: true, onAnswer: a => answered.push(a.id)});
  assert.equal(answers.answers.length, plan.n);
  assert.deepEqual(answered, plan.questions);
  assert.equal(answers.unscheduled_by_step6, true);
  assert.equal(answers.truncated, false);
  assert.equal(answers.lineage, plan.lineage);
  assert.ok(seen.filter(a => a.surface !== 'local').every(a => a.via === 'os1'), 'the reference arm runs through OS-1');
  // A stopped run still locks what it paid for.
  const spend3 = join(dir, 'spend3.jsonl');
  let calls = 0;
  const failing = {...dispatcher, dispatch: async args => { if (args.surface !== 'local' && ++calls === 3) throw new Error('provider down');
    return dispatcher.dispatch(args); }};
  const stopped = await run({spendPath: spend3, leadRunsUnscheduled: true, dispatcher: failing}).catch(error => error);
  assert.match(stopped.message, /provider down/);
  assert.equal(stopped.locked.answers.length, 1);
  assert.equal(stopped.locked.truncated, true);
  // The cap: a window already near its cap refuses.
  const full = join(dir, 'full.jsonl');
  await writeFile(full, JSON.stringify({window: plan.cap.window, pool: 'anthropic_shared', units: 0.99}) + '\n');
  await assert.rejects(run({spendPath: full, leadRunsUnscheduled: true}), /cap/);
  // Grading: the locked sensitivity only; windows pool by lineage.
  const ask = async () => ({responsive: true, no_invented_claim: true, same_language: true, tone: true, no_refusal: true});
  await assert.rejects(f1.gradeF1Audit({answersFiles: [answers], sensitivity: {...SENSITIVITY, s: 1}, ask}), /locked/);
  const verdict = await f1.gradeF1Audit({answersFiles: [answers], sensitivity: SENSITIVITY, ask});
  assert.equal(verdict.n, plan.n);
  // 'reference reply' is English: Core's language check fails both reference
  // runs on a Korean owner's question (not informative); on an English one
  // the reference passes and the cell's Korean reply fails: discordant.
  const english = plan.questions.filter(id => F1_REQUESTS.items[id].language === 'en').length;
  assert.equal(verdict.informative, english);
  assert.equal(verdict.discordant, english);
  assert.equal(verdict.verdict, english ? 'fail' : 'inconclusive');
  const [key, entry] = f1.auditCellOf(verdict);
  assert.equal(key, 'qwen3.5:9b@none|F1');
  assert.equal(entry.scope, 'small_talk_request_v2');
  assert.equal(entry.sensitivity_sha256, f1.sensitivitySHA(SENSITIVITY));
  await assert.rejects(f1.gradeF1Audit({answersFiles: [{...answers, answers: answers.answers.slice(1)}], sensitivity: SENSITIVITY, ask}),
    /locked/);
  await assert.rejects(f1.gradeF1Audit({answersFiles: [answers, answers], sensitivity: SENSITIVITY, ask}), /twice/);
});

test('F1 audit: the grader\'s deterministic pre-filter (Core\'s checks and the register) fails an item on both arms alike', () => {
  assert.deepEqual(f1.deterministicFindings('피곤해', '많이 피곤하셨겠어요.'), {tone: 'register'});
  assert.deepEqual(f1.deterministicFindings('오늘 첫 출근했어요', '첫 출근 축하해!'), {tone: 'register'});
  assert.deepEqual(f1.deterministicFindings('피곤해', '많이 피곤했구나, 고생 많았어.'), {});
  assert.deepEqual(f1.deterministicFindings('안녕하세요', '안녕하세요! 반가워요.'), {});
  assert.deepEqual(f1.deterministicFindings('피곤해', 'You sound tired.'), {same_language: 'language'});
  assert.deepEqual(f1.deterministicFindings('이메일 초안 보내줘', '알겠습니다. 바로 보내드릴게요.').no_invented_claim, 'action_promise');
  assert.deepEqual(f1.deterministicFindings('I am tired', 'As an AI, I cannot feel tired.').no_refusal, 'refusal');
  assert.equal(f1.deterministicFindings('잘 자', '').responsive, 'empty');
});
