// Build 447 (DESIGN-8, owner-approved direction 2026-10-29): the routing law.
// The compiled table (tau from data, matched-tier admission, real quota per
// cost shape, p_fail with a Laplace prior), the engine (admissible set,
// E[Q] = Q + p_fail x Q(escalation) + scarcity, argmin) and its receipts, the
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
import {lawCatalog, routeOf, OWNER_QUESTIONS} from '../routing-law-replay.mjs';
import {ROUTING_LAW_TABLE_SHA256, ROUTING_POLICIES, routingLawTable, lawFamily, lawEvidence, lawQuota, lawPFail,
  lawScarcity, lawExpectedQuota, lawAskBack, lawKey, deliveryBasisOf, createRCCRuntime, hostPlan, resolveRoutePlan,
  hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {canonical, compileAdmission, compileTable, compileTau, readInputs} from '../routing-law-table.mjs';
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
  assert.equal(admission.cells['m@low'].pass, false); // 1.3 > tau
  assert.equal(admission.cells['m@unspecified'], undefined); // not a dispatchable effort
  // On the compiled table: F4 = T1 + T1F.
  assert.equal(lawEvidence(TABLE, 'F4', 'anthropic_shared', 'claude-opus-5-5', 'max').form, 'b');
  assert.deepEqual(lawEvidence(TABLE, 'F4', 'anthropic_shared', 'claude-opus-5-5', 'max').tiers,
    [['T1', 'pass'], ['T1F', 'unpublished']]);
  assert.equal(lawEvidence(TABLE, 'F4', 'openai_codex', 'gpt-6.1-sol', 'max').form, 'none'); // T1F fails tau
  assert.equal(lawEvidence(TABLE, 'F4', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').form, 'none'); // unscored
  assert.equal(lawEvidence(TABLE, 'F7', 'anthropic_shared', 'claude-sonnet-5-5', 'xhigh').form, 'b');
  // No evidence is never evidence: a family whose tiers the pool never publishes.
  assert.equal(lawEvidence(TABLE, 'F5a', 'anthropic_shared', 'claude-opus-5-5', 'max').form, 'none');
  assert.equal(lawEvidence(TABLE, 'F1', 'anthropic_shared', 'claude-opus-5-5', 'max').form, 'none');
});

test('E[Q]: real quota per cost shape, p_fail with the Laplace prior, the scarcity price', () => {
  const row = (surface, model, effort) => ({surface, model, effort});
  const opus = lawQuota(TABLE, row('claude-chat', 'claude-opus-5-5', 'max'), 'long_answer');
  assert.equal(opus.basis, 'measured_os1');
  assert.ok(lawQuota(TABLE, row('codex', 'gpt-6-astra', 'ultra'), 'agentic').q >
    lawQuota(TABLE, row('codex', 'gpt-6-astra', 'ultra'), 'answer').q);
  assert.deepEqual(lawQuota(TABLE, row('local', 'qwen3.5:9b', 'none'), 'answer'), {q: 0, basis: 'local'});
  assert.equal(lawQuota(TABLE, row('codex', 'gpt-5.5', 'high'), 'answer'), null); // not on the price table
  // Laplace: (f + 1) / (n + 2); pooled over surfaces.
  const luna = TABLE.p_fail.cells['gpt-6-luna@low'];
  assert.equal(lawPFail(TABLE, row('codex', 'gpt-6-luna', 'low')), (luna.failures + 1) / (luna.runs + 2));
  assert.equal(lawPFail(TABLE, row('claude', 'claude-sonnet-5-5', 'low')), 0.5);
  assert.equal(lawPFail(TABLE, row('claude', 'claude-opus-5-5', 'max')), lawPFail(TABLE, row('claude-chat', 'claude-opus-5-5', 'max')));
  assert.equal(lawExpectedQuota({q: 0.01, pFail: 0.25, escalationQ: 0.04, scarcity: 0.002}), 0.022);
  assert.equal(lawScarcity(0.04, 0.6, 0.15), 0);
  assert.ok(Math.abs(lawScarcity(0.04, 0.05, 0.15) - 0.04 * 0.1 / 0.15) < 1e-12);
  assert.equal(lawScarcity(0.04, null, 0.15), 0);
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
      assert.match(form, /^(?:reference|owner_order|b:.+|x:.*)$/);
      assert.ok(excluded === null ? Number.isFinite(eq) && eq >= quota : eq === null, `#${q.n} ${key}`);
    }
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

test('headroom: a pool under the threshold is priced up, never switched off', () => {
  const q = question(2);
  const plain = routeOf(q.request, lawOf(q));
  assert.match(plain.route, /^claude-chat:/);
  const scarce = lawOf(q, c => ({...c, candidates: c.candidates.map(row => row.quota_pool === 'anthropic_shared' ?
    {...row, quota_remaining_fraction: 0.01} : row)}));
  const routed = routeOf(q.request, scarce);
  const claude = routed.law.candidates.filter(([key]) => key.startsWith('claude'));
  // Claude rows are still evaluated (priced, not excluded) and dearer by the scarcity price.
  for (const [key, , quota, eq, excluded] of claude) if (excluded === null) assert.ok(eq > quota, key);
  const reference = claude.find(([key]) => key === 'claude-chat:claude-fable-5-1@max');
  const q0 = lawQuota(TABLE, {surface: 'claude-chat', model: 'claude-fable-5-1', effort: 'max'}, 'long_answer').q;
  assert.ok(Math.abs(reference[3] - (q0 + q0 * (0.15 - 0.01) / 0.15)) < 1e-6);
  assert.match(routed.reason, /law_argmin|route_law/);
  assert.equal(routed.law.argmin, routed.route);
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

test('the grant never picks the model: the same reading under a read-only and a writer grant binds the same model@effort', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 10]) {
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
    const modelEffort = route => route.split(':').slice(1).join(':');
    assert.equal(modelEffort(wrote.route), modelEffort(read.route), `#${n} ${read.route} vs ${wrote.route}`);
    assert.equal(wrote.ladder, null, `#${n} a writer binds no ladder`);
  }
});

test('owner words for the strongest model leave only the pool references', () => {
  const q = question(2);
  const law = lawOf(q, c => ({...c, request_profile: {...c.request_profile,
    signals: [...c.request_profile.signals, 'quality_request'].sort()}}));
  const routed = routeOf(q.request, law);
  assert.equal(routed.law.family, 'P');
  assert.ok(routed.law.candidates.every(([, form, , , excluded]) => form === 'reference' || excluded !== null));
  assert.match(routed.route, /claude-fable-5-1@max|gpt-6-astra@ultra/);
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
    (({reading, ...rest}) => rest)(good)];
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

test('Core: a failed screen on a read-only law route escalates exactly once to the reference fixed at bind', async t => {
  const q = question(10); // README.md 설명해줘: a law route on the agent surface, below its reference
  const law = lawOf(q);
  const routed = routeOf(q.request, law);
  assert.equal(routed.kind, 'law');
  const reference = law.candidates.find(row => row.id === routed.ladder.reference_candidate_id);
  const {tickets, ledger, text, done} = await harness(t, q, law, (ticket, n) => n === 1 ? completed(ticket, {output: ' '}) :
    completed(ticket, {output: 'reference answer'}));
  assert.deepEqual(tickets.map(tuple), [routed.route, lawKey(reference)]);
  assert.equal(done.result.output, 'reference answer');
  assert.equal(ledger[0].delivery_basis, 'law:F2');
  assert.equal(ledger[0].check_outcome, 'screen_fail');
  assert.equal(ledger[0].escalation_outcome, 'escalated');
  assert.equal(ledger[1].delivery_basis, 'reference_escalated');
  assert.equal(ledger[1].law.argmin, routed.route, 'the escalated attempt keeps the decision that led to it');
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]}).verdict, 'PASS');
});

test('Core: the ask-back completes locally with no dispatch and keeps its receipt', async t => {
  const q = question(8);
  const {done, tickets, saved} = await harness(t, q, lawOf(q), () => { throw new Error('never dispatched'); });
  assert.equal(tickets.length, 0);
  assert.equal(done.state, 'completed');
  assert.equal(done.result.output, TABLE.ask_back.ko);
  assert.equal(saved.law_receipt.family, 'F10');
  assert.equal(saved.plan_provenance, 'deterministic_no_model');
});

test('the owner table covers DESIGN-7 §5\'s 16 questions', () => {
  assert.deepEqual(OWNER.questions.map(q => q.n), OWNER_QUESTIONS.map(([n]) => n));
  for (const q of OWNER.questions) if (!q.pending) assert.equal(typeof lawKey, 'function');
});
