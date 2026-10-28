// Build 441 part 2 (owner order 2026-10-27, DESIGN-2): the request profile the
// host combines from its keyword rails and the LOCAL classifier's reading, the
// Core mapping by task type, difficulty and tool need, the price-aware choice
// inside a graded tier list (list prices from the host's ModelPriceTable), the
// recorded cheap-first decision, the local row for very easy chat, and the
// deep policy (A shipped, B implemented). Pure resolver calls and a real
// durable Core with temp SQLite and a fake executor: no provider, model,
// network, real HOME or installed app.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEEP_POLICIES, DEEP_POLICY, GRADED_LISTS, LOCAL_WORKER_MODEL, TIER_FAILURE_PRIORS, admittedRoute, createRCCRuntime,
  deliveryBasisOf, hostContextFingerprint, hostPlan, resolveRoutePlan} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {auditDeliveryPolicy} from '../route-replay.mjs';
import {localWorkerStyle} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const VERSION = 'r10_joint_selection_v2';
const policyText = 'Local classifier fixture policy.';
// The compiled ModelPriceTable's typical call (Swift ModelPriceTable.callUSD).
const USD = {'gpt-6-astra': 0.195, 'gpt-6.1-sol': 0.037, 'gpt-6-luna': 0.00195, 'claude-fable-5-1': 0.18,
  'claude-opus-5-5': 0.074, 'claude-sonnet-5-5': 0.037, 'claude-haiku-4-5-20251001': 0.0195, [LOCAL_WORKER_MODEL]: 0};

function task({request = '자 이제 네가 얼마나 잘 되는지 보자', context = null, budget = {}} = {}) {
  const host = {workspace: '/private/classifier-fixture', context, provider_preference: 'auto',
    codex_session_id: null, claude_session_id: null, require_read_only: false, owner_policy: null};
  return {schema: 1, task_id: 'cls-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20000, max_native_dispatches: 16,
      ...budget},
    host_context: host, policy: {source_sha256: sha('source'), projection_sha256: sha(policyText), text: policyText},
    routing_intent_policy_version: VERSION};
}
const intent = {version: VERSION, allowed_surfaces: [], exact_model: null, model_family: null, effort: null,
  require_native_ceiling: false, quality_target: null, state: 'resolved'};
function profile({task_type = 'explain', difficulty = 'standard', tool_need = 'none', answer_kind = 'answer_only',
                  classifier = 'local_llm:qwen3.5:9b', signals = ['llm_difficulty_' + difficulty, 'llm_task_' + task_type]} = {}) {
  return {schema: 1, policy: 'host_profile_v1', answer_kind, tool_need, difficulty: answer_kind === 'answer_only' ? difficulty : 'unknown',
    signals: [...new Set(signals)].sort(), classifier, task_type};
}
function row(id, model, effort, provider, {surface = provider, priced = true, quota = 0.6, unavailable = false} = {}) {
  const now = Date.now();
  const local = provider === 'local';
  return {id, surface: local ? 'local' : surface, transport: local ? 'local' : provider === 'codex' ? 'codex_app_server' : 'claude_cli',
    account_id: local ? 'os1-local' : 'fixture-' + provider, model, effort,
    tools: local || surface.endsWith('-chat') ? [] : ['read', 'execute'],
    scope: 'read_only', permission_profile: 'read_only',
    quota_pool: local ? 'none' : provider === 'codex' ? 'openai_codex' : 'anthropic_shared',
    allowed_paths: [], configuration_sha256: sha('fixture:' + id),
    availability: unavailable ? 'unavailable' : 'available', availability_observed_at_ms: now - 1,
    availability_valid_until_ms: now + 60000,
    quota_remaining_fraction: local ? null : quota, quota_observed_at_ms: local ? null : now - 1,
    quota_valid_until_ms: local ? null : now + 60000,
    quality_state: 'policy_admitted', estimated_cost_units: priced ? USD[model] : null};
}
function rows({priced = true, local = true, codexFirst = true, codexQuota = 0.6, localUnavailable = false} = {}) {
  const codex = [row('astra-ultra', 'gpt-6-astra', 'ultra', 'codex', {priced, quota: codexQuota}),
    row('sol-low', 'gpt-6.1-sol', 'low', 'codex', {priced, quota: codexQuota}),
    row('sol-medium', 'gpt-6.1-sol', 'medium', 'codex', {priced, quota: codexQuota}),
    row('sol-xhigh', 'gpt-6.1-sol', 'xhigh', 'codex', {priced, quota: codexQuota}),
    row('luna-low', 'gpt-6-luna', 'low', 'codex', {priced, quota: codexQuota})];
  const claude = [row('fable-max', 'claude-fable-5-1', 'max', 'claude', {priced}),
    row('fable-max-chat', 'claude-fable-5-1', 'max', 'claude', {surface: 'claude-chat', priced}),
    row('opus-medium', 'claude-opus-5-5', 'medium', 'claude', {priced}),
    row('opus-medium-chat', 'claude-opus-5-5', 'medium', 'claude', {surface: 'claude-chat', priced}),
    row('sonnet-medium', 'claude-sonnet-5-5', 'medium', 'claude', {priced}),
    row('sonnet-medium-chat', 'claude-sonnet-5-5', 'medium', 'claude', {surface: 'claude-chat', priced}),
    row('sonnet-low-chat', 'claude-sonnet-5-5', 'low', 'claude', {surface: 'claude-chat', priced}),
    row('haiku-chat', 'claude-haiku-4-5-20251001', 'none', 'claude', {surface: 'claude-chat', priced})];
  return [...(codexFirst ? [...codex, ...claude] : [...claude, ...codex]),
    ...(local ? [row('local-qwen', LOCAL_WORKER_MODEL, 'none', 'local', {priced, unavailable: localUnavailable})] : [])];
}
function catalog(q, {request_profile = profile(), candidates = rows(), chat = true, ownerScope = 'read_only',
                    requestClass = 'chat_explanatory', patch = {}} = {}) {
  // As the Swift builder emits them: tiers and native ceilings of offered models only.
  const offered = new Set(candidates.map(c => c.model));
  const only = map => Object.fromEntries(Object.entries(map).filter(([model]) => offered.has(model)));
  return {schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, candidates,
    model_tiers: only({'gpt-6-astra': 'frontier', 'gpt-6.1-sol': 'workhorse', 'gpt-6-luna': 'fast', 'claude-fable-5-1': 'frontier',
      'claude-opus-5-5': 'workhorse', 'claude-sonnet-5-5': 'efficient', 'claude-haiku-4-5-20251001': 'fast'}),
    native_reference_efforts: {codex: only({'gpt-6-astra': 'ultra', 'gpt-6.1-sol': 'xhigh', 'gpt-6-luna': 'low'}),
      claude: only({'claude-fable-5-1': 'max', 'claude-opus-5-5': 'medium', 'claude-sonnet-5-5': 'medium',
        'claude-haiku-4-5-20251001': 'none'})},
    owner_scope: ownerScope, chat_lane_eligible: chat, request_class: requestClass, routing_intent_v2: intent,
    ...(request_profile === null ? {} : {request_profile}), ...patch};
}
function bind(q, c, options = {}) {
  const {decisions, routes} = resolveRoutePlan(hostPlan(q, c), q, c, Date.now(), options);
  const decision = decisions.node_0, route = routes.node_0;
  return {decision, route, tuple: `${decision.surface}:${decision.model}/${decision.effort}`, tokens: decision.reason.split(';'),
    basis: deliveryBasisOf({routeClass: decision.route_class, routeKind: route.kind, ladder: route.ladder,
      reason: decision.reason})};
}

test('policy A is shipped; B is one constant away and both are named', () => {
  assert.equal(DEEP_POLICY, 'reference_first');
  assert.deepEqual(DEEP_POLICIES, ['reference_first', 'workhorse_first']);
  assert.deepEqual(TIER_FAILURE_PRIORS, {fast: {failures: 3, runs: 11}, workhorse: {failures: 0, runs: 14}});
  assert.deepEqual(GRADED_LISTS.chat_light, [['local', 'none'], ['fast', 'low']]);
  const q = task();
  assert.throws(() => resolveRoutePlan(hostPlan(q, catalog(q)), q, catalog(q), Date.now(), {deepPolicy: 'always_max'}),
    /deep_policy_invalid/);
});

test('chat light (local reading): the local row on a first turn, graded, the reference fixed as its one escalation', () => {
  const q = task(), c = catalog(q, {request_profile: profile({task_type: 'chat', difficulty: 'light'})});
  assert.deepEqual(admittedRoute(hostPlan(q, c).nodes[0], q, c), {class: 'graded', source: 'host_profile',
    certificate_id: null, grade: 'light', list: 'chat_light', classifier: 'local_llm'});
  const bound = bind(q, c);
  assert.equal(bound.tuple, `local:${LOCAL_WORKER_MODEL}/none`);
  assert.equal(bound.route.kind, 'graded');
  assert.equal(bound.basis, 'graded:light');
  for (const token of ['route_graded', 'admitted_graded_light', 'graded_list_0', 'tier_local', 'local_model_row',
    'local_model', 'graded_profile_chat_light', 'classifier_local_llm', 'cheap_first', 'escalation_reference_other_pool'])
    assert(bound.tokens.includes(token), `${token} in ${bound.decision.reason}`);
  // expected = 0 + 1/2 x 0.195 (no local record: the uniform prior)
  assert(bound.tokens.includes('expected_usd_0.097500') && bound.tokens.includes('reference_usd_0.195000') &&
    bound.tokens.includes('p_fail_0.5000'), bound.decision.reason);
  assert.deepEqual(bound.decision.ladder, {cheap_effort: 'none', reference_effort: 'ultra', cheap_model: LOCAL_WORKER_MODEL,
    reference_model: 'gpt-6-astra'});
  assert(!/certified/.test(bound.decision.reason));
});

test('chat light without a usable local row: fast/low by price; a later turn never takes the local row', () => {
  const chat = profile({task_type: 'chat', difficulty: 'light'});
  for (const [name, candidates, context] of [['no local row', rows({local: false}), null],
    ['local row unavailable', rows({localUnavailable: true}), null],
    ['a conversation', rows(), JSON.stringify({format: 'os1-session-handoff-v3', transcript: 'earlier', priorMessageCount: 2})]]) {
    const q = task({context}), bound = bind(q, catalog(q, {request_profile: chat, candidates}));
    // gpt-6-luna low ($0.00195) over claude-haiku-4-5 ($0.0195), whatever the pool order.
    assert.equal(bound.tuple, 'codex:gpt-6-luna/low', name);
    assert.equal(bound.basis, 'graded:light', name);
    assert(bound.tokens.includes('graded_list_1') && bound.tokens.includes('price_choice'), name);
  }
  // A keyword-only profile never reads chat, so never asks for the local row.
  const q = task(), keyword = profile({task_type: 'chat', difficulty: 'light', classifier: 'keyword_v1'});
  assert.equal(bind(q, catalog(q, {request_profile: keyword})).tuple, 'codex:gpt-6-luna/low');
});

test('explain light binds fast/low (luna over haiku 4.5, either pool order); explain standard binds sol over opus', () => {
  const noSonnet = codexFirst => rows({codexFirst}).filter(r => r.model !== 'claude-sonnet-5-5');
  for (const codexFirst of [true, false]) {
    const q = task({request: '엔트로피가 뭐야?'});
    const light = bind(q, catalog(q, {request_profile: profile({difficulty: 'light'}), candidates: noSonnet(codexFirst)}));
    assert.equal(light.tuple, 'codex:gpt-6-luna/low', `light codexFirst=${codexFirst}`);
    assert.equal(light.basis, 'graded:light');
    // p_fail(fast) = (3+1)/(11+2): 0.00195 + 0.3077 x 0.195 < 0.195
    assert(light.tokens.includes('cheap_first') && light.tokens.includes('p_fail_0.3077'), light.decision.reason);
    // The same workhorse tier: gpt-6.1-sol ($0.037) over claude-opus-5-5 ($0.074), whatever the pool order.
    const standard = bind(q, catalog(q, {request_profile: profile(), candidates: noSonnet(codexFirst)}));
    assert.equal(standard.tuple, 'codex:gpt-6.1-sol/medium', `standard codexFirst=${codexFirst}`);
    assert.equal(standard.basis, 'graded:standard');
    assert(standard.tokens.includes('graded_profile_explain_standard') && standard.tokens.includes('p_fail_0.0625'),
      standard.decision.reason);
  }
  // An exact price tie (sol and sonnet are both $0.037) falls back to the R11
  // order: here the catalog's pool order.
  for (const [codexFirst, expected] of [[true, 'codex:gpt-6.1-sol/medium'], [false, 'claude-chat:claude-sonnet-5-5/medium']]) {
    const q = task({request: '슈뢰딩거 방정식 설명해봐'});
    assert.equal(bind(q, catalog(q, {request_profile: profile(), candidates: rows({codexFirst})})).tuple, expected);
  }
});

test('Codex quota exhausted: the explain-standard list binds claude-sonnet (efficient, cheaper than opus)', () => {
  const q = task({request: '슈뢰딩거 방정식 설명해봐'});
  const exhausted = rows({codexQuota: 0});
  const bound = bind(q, catalog(q, {request_profile: profile(), candidates: exhausted}));
  assert.equal(bound.tuple, 'claude-chat:claude-sonnet-5-5/medium');
  assert.equal(bound.decision.ladder.reference_model, 'claude-fable-5-1');
  assert(bound.tokens.includes('graded_list_1') && bound.tokens.includes('escalation_reference_same_pool'));
});

test('current facts: agent surfaces only at workhorse/medium, never a tool-free chat row', () => {
  const q = task({request: '오늘 원달러 환율 설명해줘'});
  const facts = profile({tool_need: 'current_facts', difficulty: 'light'});
  const bound = bind(q, catalog(q, {request_profile: facts, requestClass: 'readonly_lookup', chat: false}));
  assert.equal(bound.tuple, 'codex:gpt-6.1-sol/medium');
  assert.equal(bound.basis, 'graded:light');
  assert(bound.tokens.includes('graded_profile_current_facts'));
  // Only Claude left: its agent surface, not claude-chat.
  const claudeOnly = bind(q, catalog(q, {request_profile: facts, candidates: rows({codexQuota: 0})}));
  assert.equal(claudeOnly.tuple, 'claude:claude-opus-5-5/medium');
  // Chat rows only: no graded tuple, the reference.
  const chatOnly = rows().filter(r => r.surface !== 'claude' || r.model === 'claude-fable-5-1');
  const noAgent = bind(q, catalog(q, {request_profile: facts, candidates: chatOnly.filter(r => r.quota_pool !== 'openai_codex' ||
    r.model === 'gpt-6-astra')}));
  assert.equal(noAgent.route.kind, 'reference');
  assert.match(noAgent.decision.reason, /;admitted_reference_uncertified;graded_light_tuple_undispatchable;/);
  // Deep current facts keeps the reference.
  assert.equal(bind(q, catalog(q, {request_profile: profile({tool_need: 'current_facts', difficulty: 'deep'})})).route.kind,
    'reference');
});

test('design, write and any deep answer keep the reference under policy A; B runs workhorse/xhigh first', () => {
  const q = task({request: 'QMGR 통합하게 스키마 좀 짜봐'});
  for (const [task_type, difficulty] of [['design', 'deep'], ['design', 'standard'], ['write', 'standard'],
    ['explain', 'deep'], ['chat', 'deep']]) {
    const c = catalog(q, {request_profile: profile({task_type, difficulty})});
    const a = bind(q, c);
    assert.equal(a.tuple, 'codex:gpt-6-astra/ultra', `${task_type}/${difficulty}`);
    assert.equal(a.basis, 'reference');
    assert(a.tokens.includes('deep_policy_reference_first') && a.tokens.includes('classifier_local_llm'), a.decision.reason);
    const b = bind(q, c, {deepPolicy: 'workhorse_first'});
    assert.equal(b.tuple, 'codex:gpt-6.1-sol/xhigh', `B ${task_type}/${difficulty}`);
    assert.equal(b.route.kind, 'graded');
    assert.equal(b.basis, 'graded:deep');
    assert.equal(b.route.ladder.reference_model, 'gpt-6-astra');
    assert(b.tokens.includes('graded_profile_deep_workhorse') && b.tokens.includes('cheap_first'), b.decision.reason);
  }
  // Work and a workspace need keep the reference under either policy.
  for (const p of [profile({answer_kind: 'work', task_type: 'action', tool_need: 'shell'}),
    profile({tool_need: 'workspace'}), profile({answer_kind: 'unknown', task_type: 'design', tool_need: 'workspace'})])
    for (const deepPolicy of DEEP_POLICIES)
      assert.equal(bind(q, catalog(q, {request_profile: p}), {deepPolicy}).route.kind, 'reference', JSON.stringify(p));
});

test('reference first: a cheap row whose expected cost reaches the reference binds the reference, recorded', () => {
  const q = task({request: '슈뢰딩거 방정식 설명해봐'});
  // sol at $0.19 vs astra at $0.195: 0.19 + 1/16 x 0.195 >= 0.195.
  const pricey = rows().map(r => r.model === 'gpt-6.1-sol' ? {...r, estimated_cost_units: 0.19} :
    r.model === 'claude-opus-5-5' || r.model === 'claude-sonnet-5-5' ? {...r, availability: 'unavailable'} : r);
  const bound = bind(q, catalog(q, {request_profile: profile(), candidates: pricey}));
  assert.equal(bound.tuple, 'codex:gpt-6-astra/ultra');
  assert.equal(bound.basis, 'reference');
  assert.match(bound.decision.reason,
    /;admitted_reference_uncertified;graded_standard_reference_first;graded_profile_explain_standard;classifier_local_llm;expected_usd_0\.20218[78];reference_usd_0\.195000;p_fail_0\.0625;/);
});

test('an unpriced catalog records cost_unpriced and keeps the part-1 order', () => {
  const q = task({request: '슈뢰딩거 방정식 설명해봐'});
  const bound = bind(q, catalog(q, {request_profile: profile(), candidates: rows({priced: false, codexFirst: false})}));
  // Claude first in catalog order: its workhorse (opus) at medium, the chat row first.
  assert.equal(bound.tuple, 'claude-chat:claude-opus-5-5/medium');
  assert(bound.tokens.includes('cost_unpriced') && !bound.tokens.includes('price_choice'), bound.decision.reason);
});

test('the local row binds only for a local chat reading: an injected Auto plan otherwise is refused', async t => {
  const q = task({request: '엔트로피가 뭐야?'});
  const c = catalog(q, {request_profile: profile({difficulty: 'light'})});
  const node = {id: 'node_0', instruction: q.request, dependencies: [], kind: 'agent', scope: 'read_only',
    owned_paths: [], context_refs: [], candidate_id: 'local-qwen'};
  const dir = await mkdtemp(join(tmpdir(), 'os1-cls-plan-')); await chmod(dir, 0o700);
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: dir, catalog: async () => c,
    plan: async () => ({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, final_node_id: 'node_0', nodes: [node]}),
    execute: async ticket => { tickets.push(ticket); throw new Error('never'); }});
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });
  await runtime.submit(q);
  const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});
  assert.notEqual(done.state, 'completed');
  assert.equal(tickets.length, 0);
});

test('the catalog contract: classifier and task_type travel together and are strict', async () => {
  const bad = [{...profile(), classifier: undefined}, {...profile(), task_type: undefined},
    {...profile(), classifier: 'gpt-6:remote'}, {...profile(), classifier: 'local_llm:Qwen 9B'},
    {...profile(), task_type: 'poem'}, profile({task_type: 'action'}), {...profile(), task_type: 'unknown'},
    {...profile({classifier: 'keyword_v1'}), task_type: 'action'}];
  for (const raw of bad) {
    const request_profile = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
    const dir = await mkdtemp(join(tmpdir(), 'os1-cls-bad-')); await chmod(dir, 0o700);
    const q = task(), tickets = [];
    const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => catalog(q, {request_profile}),
      execute: async ticket => { tickets.push(ticket); throw new Error('never'); }});
    try {
      await runtime.submit(q);
      const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});
      assert.equal(done.error, 'catalog_binding_invalid', JSON.stringify(request_profile));
      assert.equal(tickets.length, 0);
    } finally { await runtime.close(); await rm(dir, {recursive: true, force: true}); }
  }
  // The keyword unknown that reads as an answer, and a work profile, are valid.
  for (const ok of [profile({classifier: 'keyword_v1', signals: ['keyword_unknown_default']}),
    profile({answer_kind: 'work', task_type: 'action', tool_need: 'write'}),
    profile({answer_kind: 'unknown', task_type: 'unknown', tool_need: 'current_facts', classifier: 'keyword_v1'})]) {
    const q = task();
    assert.doesNotThrow(() => bind(q, catalog(q, {request_profile: ok})), JSON.stringify(ok));
  }
});

// ---- The durable Core: the local answer, its screen, its one escalation. ----
function completed(ticket, patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'fixture answer',
    native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null, native_turn_terminated: true, ...patch};
}
async function harness(t, execute, {q = task(), c = null} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-cls-')); await chmod(dir, 0o700);
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true,
    catalog: async () => c ?? catalog(q, {request_profile: profile({task_type: 'chat', difficulty: 'light'})}),
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); }});
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });
  await runtime.submit(q);
  const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 6000});
  const text = await readFile(join(dir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8').catch(() => '');
  return {done, tickets, saved: runtime._load(q.task_id), text,
    ledger: text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))};
}
const tuple = ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}/${ticket.selected_config.effort}`;

test('a local chat answer is delivered on its structural screen, graded and unverified', async t => {
  const {done, tickets, saved, ledger, text} = await harness(t, ticket => completed(ticket, {output: '좋아, 보자!'}));
  assert.deepEqual(tickets.map(tuple), [`local:${LOCAL_WORKER_MODEL}/none`]);
  assert.equal(tickets[0].instruction, '자 이제 네가 얼마나 잘 되는지 보자');
  // Build 441 part 3: Core's own Auto local ticket gets the conversational
  // prompt (no explicit routes, not arithmetic), never the exact-result one.
  assert.equal(tickets[0].host_context.explicit_routes, undefined);
  assert.equal(localWorkerStyle(tickets[0]), 'conversational');
  assert.equal(done.state, 'returned_unverified', JSON.stringify(done));
  assert.equal(done.result.output, '좋아, 보자!');
  assert.equal(saved.children[0].route_kind, 'graded');
  assert.match(saved.children[0].routing_decision.reason, /;admitted_graded_light;.*;classifier_local_llm;cheap_first;/);
  assert.equal(ledger.length, 1);
  assert.deepEqual({basis: ledger[0].delivery_basis, outcome: ledger[0].check_outcome, label: ledger[0].check_label},
    {basis: 'graded:light', outcome: 'screen_pass', label: null});
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]}).verdict, 'PASS');
});

test('a failed local answer escalates exactly once to the bound reference', async t => {
  const {done, tickets, ledger, text} = await harness(t, (ticket, n) => n === 1 ?
    completed(ticket, {output: null, error: 'local_model_completion_failed'}) : completed(ticket, {output: 'reference answer'}));
  assert.deepEqual(tickets.map(tuple), [`local:${LOCAL_WORKER_MODEL}/none`, 'codex:gpt-6-astra/ultra']);
  assert.equal(done.result.output, 'reference answer');
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].delivery_basis, 'graded:light');
  assert.equal(ledger[0].escalation_outcome, 'escalated');
  assert.equal(ledger[1].delivery_basis, 'reference_escalated');
  assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]}).verdict, 'PASS');
});

test('a priced standard explanation runs sol medium and records its estimated cost', async t => {
  const q = task({request: '슈뢰딩거 방정식 설명해봐'});
  const {done, tickets, saved} = await harness(t, ticket => completed(ticket),
    {q, c: catalog(q, {request_profile: profile(),
      candidates: rows({codexFirst: false}).filter(r => r.model !== 'claude-sonnet-5-5')})});
  assert.deepEqual(tickets.map(tuple), ['codex:gpt-6.1-sol/medium'], JSON.stringify(done));
  assert.equal(done.state, 'returned_unverified');
  assert.equal(saved.spent_cost_units, 0.037);
});
