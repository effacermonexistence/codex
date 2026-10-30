// Build 447, DESIGN-8 lead corrections (2026-10-29): evidence form (c) from
// paired-audit verdicts, the value of information per (cell, family), the
// paired-audit harness (frozen local checklists, answer lock, the weekly cap,
// local grading, paid runs refused without explicit confirmation) and the
// replay's headroom and release-gate arithmetic. Zero quota: a stub local
// model, the fake dispatcher and temporary files only; no Ollama, provider,
// network or real HOME. The corpus is the owner fixture's 14 recorded catalogs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {routingLawTable, lawEvidence} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {weeklyTraffic, planAudits, writeChecklists, runAudit, gradeAudit, spendThisWeek, asrHints, matchingHints, answerRequest}
  from '../routing-law-audit.mjs';
import {atHeadroom, gateOf, lawCatalog, clockOf, routeOf} from '../routing-law-replay.mjs';
import {compileAudits} from '../routing-law-table.mjs';
import * as fake from './routing-law-audit-fake-dispatcher.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = text => createHash('sha256').update(text).digest('hex');
const TABLE = routingLawTable();
const OWNER = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/routing-law-owner-questions.json'), 'utf8'));
const CORPUS = OWNER.questions.filter(q => !q.pending).map(q => ({index: q.n, request: q.request, catalog: q.catalog, receipt: q.receipt}));
const INTENTS = Object.fromEntries(OWNER.questions.filter(q => !q.pending && q.intent).map(q => [q.n, q.intent]));
const NOW = Date.parse('2026-10-30T05:00:00Z');
const TRAFFIC = {requests: 44, explicit_excluded: 0, window_days: 7};
const plan = () => planAudits({catalogs: CORPUS, intents: INTENTS, traffic: TRAFFIC, now: NOW});

test('evidence (c): a passed paired audit admits a cell with a gap of evidence, never one with evidence against, never under P', () => {
  const audited = {...TABLE, audits: {cells: {
    'claude-sonnet-5-5@xhigh|F13': {verdict: 'pass', id: 'audit-0123456789ab', n: 2, discordant: 0},
    'gpt-6.1-sol@max|F4': {verdict: 'pass', id: 'audit-ba9876543210', n: 2, discordant: 0},
    'claude-sonnet-5-5@max|F13': {verdict: 'inconclusive', id: 'audit-aaaaaaaaaaaa', n: 2, discordant: 0}}}};
  assert.deepEqual([lawEvidence(TABLE, 'F13', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').form,
    lawEvidence(audited, 'F13', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').form], ['none', 'c']);
  assert.equal(lawEvidence(audited, 'F13', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').audit, 'audit-0123456789ab');
  assert.equal(lawEvidence(audited, 'F4', 'openai_codex', 'gpt-6.1-sol', 'max').form, 'none'); // T1F fails tau
  assert.equal(lawEvidence(audited, ['W2'], 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh', null).form, 'none'); // P passes no family
  assert.equal(lawEvidence(audited, 'F13', 'anthropic_shared', 'claude-sonnet-5-5', 'max').form, 'none'); // inconclusive admits nothing
  // The compiler carries only well-formed verdicts of the rule.
  const rule = 'r', digest = 'a'.repeat(64);
  assert.deepEqual(compileAudits({schema: 1, rule, cells: {'m@high|F4': {verdict: 'pass', answers_sha256: digest, n: 3, discordant: 0}}}).cells,
    {'m@high|F4': {verdict: 'pass', id: 'audit-aaaaaaaaaaaa', n: 3, discordant: 0}});
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

test('value of information: only gap cells, never P; Core\'s E[Q] re-derived exactly; saving > cost within the weekly cap', () => {
  const result = plan();
  assert.deepEqual(result.derivation_check.mismatches, []);
  assert.ok(result.derivation_check.admissible_rows_repriced > 0);
  assert.ok(result.audits.length > 0);
  for (const audit of result.audits) {
    assert.notEqual(audit.family, 'P');
    assert.ok(audit.evidence_now.every(form => form.startsWith('x:') && !/=fail(?:,|$)/.test(form)), audit.id);
    if (audit.decision !== 'scheduled') continue;
    assert.ok(audit.saving_7d_priced > audit.cost.priced && audit.voi > 0, audit.id);
    assert.equal(audit.questions.length, audit.n);
    const b = audit.breakeven_excess_fail;
    assert.equal(audit.n, b >= 1 ? 1 : Math.ceil(Math.log(0.1) / Math.log(1 - b)), audit.id);
  }
  const scheduled = result.audits.filter(a => a.decision === 'scheduled');
  assert.ok(scheduled.reduce((s, a) => s + a.cost.Cw, 0) <= 1 + 1e-9 && scheduled.reduce((s, a) => s + a.cost.Px, 0) <= 1 + 1e-9);
  // A week already spent to the cap schedules nothing that draws on that pool.
  const spent = planAudits({catalogs: CORPUS, intents: INTENTS, traffic: TRAFFIC, now: NOW, spent: {anthropic_shared: 1, openai_codex: 1}});
  assert.equal(spent.audits.filter(a => a.decision === 'scheduled').length, 0);
  // No traffic: no saving can pay for any audit.
  const idle = planAudits({catalogs: CORPUS, intents: INTENTS, traffic: {...TRAFFIC, requests: 0}, now: NOW});
  assert.equal(idle.scheduled.length, 0);
});

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-audit-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}
const stubChecklist = async (model, system, user) => ({items: ['states the main point', 'answers the question asked', 'is correct']});
async function frozen(t) {
  const result = plan();
  const planBytes = Buffer.from(JSON.stringify(result));
  const audit = result.audits.find(a => a.decision === 'scheduled') ?? (() => { throw new Error('the fixture plan schedules nothing'); })();
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
  const week = '2026-10-26';
  await writeFile(spend, JSON.stringify({week, pool: audit.pool, units: 1, audit: 'earlier'}) + '\n');
  await assert.rejects(runAudit({...base, dispatcher: fake}), /weekly audit cap/);
  await writeFile(spend, '');
  const answers = await runAudit({...base, dispatcher: fake});
  assert.equal(answers.answers.length, audit.n);
  assert.equal(answers.n_required, audit.n);
  assert.equal(answers.paid, false);
  assert.ok(answers.answers.every(a => a.cell.output_sha256 === sha(a.cell.output) && a.reference.output_sha256 === sha(a.reference.output)));
  assert.equal(answers.answers[0].reference.route, audit.audit_references[0]);
  assert.deepEqual(spendThisWeek(spend, week), {[audit.pool]: 0});
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
  assert.equal(routed.route, 'claude-chat:claude-opus-5-5@max');
  assert.ok(!atHeadroom(q.catalog, {kind: 'remaining', remaining: {openai_codex: 0}}).candidates.some(row => row.quota_pool === 'openai_codex'));
});

test('the release gate: per pool (no exchange) and priced at the derived exchange, against 446 and all-reference; Astra starts', () => {
  const arm = (Cw, Px, priced) => Object.fromEntries(['start', 'draw', 'law_model'].map(b => [b, {Cw, Px, priced}]));
  const moved = gateOf({law447: arm(5, 1, 10), build446: arm(1, 50, 85), all_reference: arm(6, 3, 15)}, {law447: 2, build446: 3});
  assert.deepEqual([moved.draw.build446.per_pool, moved.draw.build446.priced], ['FAIL', 'PASS']); // more Cw: no Pareto
  assert.deepEqual([moved.draw.all_reference.per_pool, moved.draw.all_reference.priced], ['PASS', 'PASS']);
  assert.deepEqual(moved.release, {priced_draw: 'PASS', per_pool_draw: 'FAIL'});
  const astra = gateOf({law447: arm(1, 1, 2), build446: arm(2, 2, 4), all_reference: arm(3, 3, 6)}, {law447: 4, build446: 3});
  assert.deepEqual(astra.release, {priced_draw: 'FAIL', per_pool_draw: 'FAIL'});
  const equal = gateOf({law447: arm(1, 0, 2), build446: arm(1, 0, 2), all_reference: arm(3, 0, 6)}, {law447: 0, build446: 0});
  assert.equal(equal.draw.build446.per_pool, 'FAIL', 'equal in both pools is not cheaper');
});
