// Change 2 (build 441, owner order 2026-10-27): the host-profile graded
// admission. A general explanation the host's deterministic request profile
// reads as answer-only, tool-free and light or standard binds a graded tuple
// below a runnable reference, labelled predicted and quality-unverified, never
// certified; any failure signal escalates exactly once to the reference fixed
// at bind. Deep, unknown, tool-needing, current-fact, workspace and owner-
// constrained work keeps the reference or the owner's tuple. Pure resolver
// calls and a real durable Core with temp SQLite and a fake executor: no
// provider, model, network, real HOME or installed app.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GRADED_LISTS, ROUTE_CLASSES, admittedRoute, createRCCRuntime, deliveryBasisOf, hostContextFingerprint, hostPlan,
  registerNodeVerifiers, resolveRoutePlan} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {auditDeliveryPolicy} from '../route-replay.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const VERSION = 'r10_joint_selection_v2';
const policyText = 'Graded admission fixture policy.';
const REQUEST = '슈뢰딩거 방정식 설명해봐';

function task({request = REQUEST, preference = 'auto', budget = {}, v2 = true, materials = []} = {}) {
  const host = {workspace: '/private/graded-fixture', context: null, provider_preference: preference,
    codex_session_id: null, claude_session_id: null, require_read_only: false, owner_policy: null};
  return {schema: 1, task_id: 'graded-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: materials,
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20000,
      max_native_dispatches: 16, ...budget},
    host_context: host, policy: {source_sha256: sha('source'), projection_sha256: sha(policyText), text: policyText},
    ...(v2 ? {routing_intent_policy_version: VERSION} : {})};
}
function intent(extra = {}) {
  return {version: VERSION, allowed_surfaces: [], exact_model: null, model_family: null, effort: null,
    require_native_ceiling: false, quality_target: null, state: 'resolved', ...extra};
}
function profile(answer_kind = 'answer_only', tool_need = 'none', difficulty = 'standard',
                 signals = ['answer_stem', 'explanation_stem']) {
  return {schema: 1, policy: 'host_profile_v1', answer_kind, tool_need, difficulty, signals};
}
// Both pools, as the Swift builder emits them: Codex agent rows; Claude agent
// and chat rows; every tier; each frontier at its native ceiling.
function row(id, model, effort, provider, {surface = provider, stale = false, unavailable = false} = {}) {
  const now = Date.now();
  return {id, surface, transport: provider === 'codex' ? 'codex_app_server' : 'claude_cli',
    account_id: 'fixture-' + provider, model, effort, tools: surface.endsWith('-chat') ? [] : ['read', 'execute'],
    scope: 'read_only', permission_profile: 'read_only', quota_pool: provider === 'codex' ? 'openai_codex' : 'anthropic_shared',
    allowed_paths: [], configuration_sha256: sha('fixture:' + id),
    availability: unavailable ? 'unavailable' : 'available', availability_observed_at_ms: now - 1,
    availability_valid_until_ms: now + 60000, quota_remaining_fraction: 0.6,
    quota_observed_at_ms: stale ? now - 600000 : now - 1, quota_valid_until_ms: stale ? now - 1000 : now + 60000,
    quality_state: 'policy_admitted', estimated_cost_units: null};
}
function catalog(q, {request_profile = profile(), v2 = intent(), rows = null, chat = true, ownerScope = 'read_only',
                    requestClass = 'chat_explanatory', patch = {}} = {}) {
  const candidates = rows ?? [
    row('astra-ultra', 'gpt-6-astra', 'ultra', 'codex'), row('astra-max', 'gpt-6-astra', 'max', 'codex'),
    row('sol-low', 'gpt-6.1-sol', 'low', 'codex'), row('sol-medium', 'gpt-6.1-sol', 'medium', 'codex'),
    row('sol-high', 'gpt-6.1-sol', 'high', 'codex'), row('luna-low', 'gpt-6-luna', 'low', 'codex'),
    row('luna-medium', 'gpt-6-luna', 'medium', 'codex'),
    row('fable-max', 'claude-fable-5-1', 'max', 'claude'), row('fable-max-chat', 'claude-fable-5-1', 'max', 'claude', {surface: 'claude-chat'}),
    row('opus-medium', 'claude-opus-5-5', 'medium', 'claude'),
    row('opus-medium-chat', 'claude-opus-5-5', 'medium', 'claude', {surface: 'claude-chat'}),
    row('haiku-chat', 'claude-haiku-4-5-20251001', 'none', 'claude', {surface: 'claude-chat'})];
  // null omits the field (a default parameter would replace undefined).
  return {schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, candidates,
    model_tiers: {'gpt-6-astra': 'frontier', 'gpt-6.1-sol': 'workhorse', 'gpt-6-luna': 'fast',
      'claude-fable-5-1': 'frontier', 'claude-opus-5-5': 'workhorse', 'claude-haiku-4-5-20251001': 'fast'},
    native_reference_efforts: {codex: {'gpt-6-astra': 'ultra', 'gpt-6.1-sol': 'high', 'gpt-6-luna': 'medium'},
      claude: {'claude-fable-5-1': 'max', 'claude-opus-5-5': 'medium', 'claude-haiku-4-5-20251001': 'none'}},
    owner_scope: ownerScope, chat_lane_eligible: chat, request_class: requestClass,
    ...(v2 === null ? {} : {routing_intent_v2: v2}),
    ...(request_profile === null ? {} : {request_profile}), ...patch};
}
function bind(q, c, options = {}) {
  const {decisions, routes} = resolveRoutePlan(hostPlan(q, c), q, c, Date.now(), options);
  const decision = decisions.node_0, route = routes.node_0;
  return {decision, route, tuple: `${decision.model}/${decision.effort}`,
    basis: deliveryBasisOf({routeClass: decision.route_class, routeKind: route.kind, ladder: route.ladder,
      reason: decision.reason})};
}

test('the graded lists are the locked design and never reach the frontier or max', () => {
  // Build 441 part 2 (DESIGN-2 "Core mapping"): keyed by what the profile reads.
  assert.deepEqual(GRADED_LISTS, {chat_light: [['local', 'none'], ['fast', 'low']],
    explain_light: [['fast', 'low'], ['efficient', 'low']],
    explain_standard: [['workhorse', 'medium'], ['efficient', 'medium']],
    current_facts: [['workhorse', 'medium']], deep_workhorse: [['workhorse', 'xhigh']]});
  for (const [list, entries] of Object.entries(GRADED_LISTS))
    for (const [tier, effort] of entries)
      assert(tier !== 'frontier' && !['max', 'ultra'].includes(effort) && (effort !== 'xhigh' || list === 'deep_workhorse'));
  assert(ROUTE_CLASSES.includes('standard'));
});

test('a standard answer binds the graded workhorse at medium, uncertified, with the reference fixed as its escalation', () => {
  const q = task(), c = catalog(q);
  const admission = admittedRoute(hostPlan(q, c).nodes[0], q, c);
  assert.deepEqual(admission, {class: 'graded', source: 'host_profile', certificate_id: null, grade: 'standard',
    list: 'explain_standard', classifier: 'keyword'});
  const {decision, route, tuple, basis} = bind(q, c);
  assert.equal(tuple, 'gpt-6.1-sol/medium');
  assert.equal(decision.route_class, 'standard');
  assert.equal(route.kind, 'graded');
  assert.match(decision.reason, /^resolver;route_graded;admitted_graded_standard;graded_list_0;tier_workhorse;/);
  assert(!/certified/.test(decision.reason), decision.reason);
  assert.equal(basis, 'graded:standard');
  assert.deepEqual({admitted_by: route.ladder.admitted_by, grade: route.ladder.grade, certificate_id: route.ladder.certificate_id,
    format_check: route.ladder.format_check, reference: `${route.ladder.reference_model}/${route.ladder.reference_effort}`,
    reference_candidate_id: route.ladder.reference_candidate_id},
  {admitted_by: 'host_profile', grade: 'standard', certificate_id: null, format_check: null,
    reference: 'gpt-6-astra/ultra', reference_candidate_id: 'astra-ultra'});
  assert.deepEqual(decision.ladder, {cheap_effort: 'medium', reference_effort: 'ultra', cheap_model: 'gpt-6.1-sol',
    reference_model: 'gpt-6-astra'});
  // Claude first (another pool order): the chat row of its workhorse at medium.
  const claude = catalog(q, {rows: catalog(q).candidates.slice(7).concat(catalog(q).candidates.slice(0, 7))});
  const other = bind(q, claude);
  assert.equal(other.decision.surface, 'claude-chat');
  assert.equal(other.tuple, 'claude-opus-5-5/medium');
  assert.equal(other.route.ladder.reference_model, 'claude-fable-5-1');
});

test('a light definitional answer binds the fast tier at low; deep and unknown keep the reference', () => {
  const q = task({request: '슈뢰딩거 방정식이 뭐야?'});
  const light = bind(q, catalog(q, {request_profile: profile('answer_only', 'none', 'light',
    ['answer_stem', 'definitional_stem', 'short_definition'])}));
  assert.equal(light.tuple, 'gpt-6-luna/low');
  assert.equal(light.basis, 'graded:light');
  assert.match(light.decision.reason, /;admitted_graded_light;/);
  // Build 441 part 2: a current-facts answer is graded too (agent surfaces
  // only, openclaw-rcc-local-classifier.test.mjs); everything else here keeps
  // the reference.
  for (const [answer, need, difficulty] of [['answer_only', 'none', 'deep'], ['unknown', 'none', 'unknown'],
    ['work', 'none', 'unknown'], ['answer_only', 'workspace', 'standard'],
    ['work', 'shell', 'unknown'], ['work', 'write', 'unknown']]) {
    const t = task(), c = catalog(t, {request_profile: profile(answer, need, difficulty)});
    const bound = bind(t, c);
    assert.equal(bound.tuple, 'gpt-6-astra/ultra', `${answer}/${need}/${difficulty}`);
    assert.equal(bound.route.kind, 'reference');
    assert.equal(bound.basis, 'reference');
    assert.match(bound.decision.reason, /^resolver;route_reference;admitted_reference_uncertified;/);
  }
  // A catalog without a profile (an older host) binds the reference as before.
  const old = task(), oc = catalog(old, {request_profile: null});
  assert.equal(bind(old, oc).tuple, 'gpt-6-astra/ultra');
});

test('owner routing words keep the owner tuple; a certifying source keeps priority', () => {
  const words = [[intent({effort: 'max'}), 'gpt-6-astra/max'], [intent({model_family: 'sol'}), 'gpt-6.1-sol/high'],
    [intent({allowed_surfaces: ['claude-chat']}), 'claude-fable-5-1/max'],
    [intent({quality_target: 'current_host_reference'}), 'gpt-6-astra/ultra']];
  for (const [v2, expected] of words) {
    const q = task(), c = catalog(q, {v2});
    const bound = bind(q, c);
    assert.equal(bound.tuple, expected, JSON.stringify(v2));
    assert.equal(bound.route.kind, 'explicit', JSON.stringify(v2));
    assert.equal(bound.basis, 'owner_words', JSON.stringify(v2));
    assert.notEqual(admittedRoute(hostPlan(q, c).nodes[0], q, c).class, 'graded');
  }
  const ceiling = task(), cc = catalog(ceiling, {v2: intent({require_native_ceiling: true})});
  assert.deepEqual(admittedRoute(hostPlan(ceiling, cc).nodes[0], ceiling, cc).source, 'owner_words');
  assert.equal(bind(ceiling, cc).tuple, 'gpt-6-astra/ultra');
  // A provider the owner chose (an older task without v2).
  const chosen = task({preference: 'codex', v2: false}), pc = catalog(chosen, {v2: null});
  assert.equal(admittedRoute(hostPlan(chosen, pc).nodes[0], chosen, pc).source, 'owner_words');
  assert.equal(bind(chosen, pc).tuple, 'gpt-6-astra/ultra');
  // Attached material, or a host that does not run the request read-only.
  const material = task({materials: ['material-1']});
  assert.notEqual(admittedRoute(hostPlan(material, catalog(material)).nodes[0], material, catalog(material)).class, 'graded');
  const writer = task(), wc = catalog(writer, {ownerScope: 'workspace_write', chat: false, requestClass: 'readonly_lookup'});
  assert.notEqual(admittedRoute(hostPlan(writer, wc).nodes[0], writer, wc).class, 'graded');
  // The build-440 owner-decision certificate (a state-only check-in) wins.
  const checkIn = task({request: '너 되냐?'});
  const certified = catalog(checkIn, {patch: {class_certificates: {chat_explanatory: {certificate_id: 'owner-chat-fast-20261027',
    provider: 'codex', model: 'gpt-6-luna', effort: 'low', format_check: 'nonempty_text', measurement_sha256: sha('decision')}}}});
  const bound = bind(checkIn, certified);
  assert.equal(bound.route.kind, 'tier');
  assert.equal(bound.basis, 'certified:class:owner-chat-fast-20261027');
});

test('the empty v2 intent is not owner words: the reference is labelled reference (RT label fix)', () => {
  const q = task(), c = catalog(q, {request_profile: profile('answer_only', 'none', 'deep')});
  const bound = bind(q, c);
  assert.equal(bound.route.kind, 'reference');
  assert.equal(bound.basis, 'reference');
  assert.match(bound.decision.reason, /^resolver;route_reference;admitted_reference_uncertified;/);
  assert(!/route_explicit|owner_words/.test(bound.decision.reason), bound.decision.reason);
  // A real owner word still names the route explicit and owner_words.
  const effort = bind(q, catalog(q, {request_profile: profile('answer_only', 'none', 'deep'), v2: intent({effort: 'max'})}));
  assert.equal(effort.route.kind, 'explicit');
  assert.equal(effort.basis, 'owner_words');
  assert.match(effort.decision.reason, /^resolver;route_explicit;intent_effort_max;/);
});

test('bind-time headroom: two attempts and two native dispatches must remain, else the reference binds', () => {
  for (const budget of [{max_attempts: 1}, {max_native_dispatches: 1}]) {
    const q = task({budget}), bound = bind(q, catalog(q));
    assert.equal(bound.tuple, 'gpt-6-astra/ultra', JSON.stringify(budget));
    assert.equal(bound.basis, 'reference');
    assert.match(bound.decision.reason, /;admitted_reference_uncertified;graded_standard_requires_dispatch_headroom;/);
  }
  const unlimited = task({budget: {max_native_dispatches: null}});
  assert.equal(bind(unlimited, catalog(unlimited)).tuple, 'gpt-6.1-sol/medium', 'no cap: only the attempts bound');
});

test('the headroom is the task\'s: only a one-node plan binds graded (an injected two-node plan keeps the reference)', () => {
  // Review of build 441: two graded siblings would each count the task's two
  // dispatches, so the first one's escalation could be refused. The host's
  // Auto plan has one node; an injected plan of two runs the reference.
  const q = task({budget: {max_native_dispatches: 2}}), c = catalog(q);
  const nodes = ['a', 'b'].map(id => ({id, instruction: q.request, dependencies: [], kind: 'agent', scope: 'read_only',
    owned_paths: [], context_refs: []}));
  const two = resolveRoutePlan({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, final_node_id: null, nodes},
    q, c, Date.now());
  for (const id of ['a', 'b']) {
    assert.equal(`${two.decisions[id].model}/${two.decisions[id].effort}`, 'gpt-6-astra/ultra', id);
    assert.equal(two.routes[id].kind, 'reference', id);
    assert.match(two.decisions[id].reason, /;admitted_reference_uncertified;graded_standard_requires_single_node_plan;/);
  }
  const one = resolveRoutePlan({schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, final_node_id: 'a',
    nodes: [nodes[0]]}, q, c, Date.now());
  assert.equal(`${one.decisions.a.model}/${one.decisions.a.effort}`, 'gpt-6.1-sol/medium');
  assert.equal(one.routes.a.kind, 'graded');
});

test('K2: a graded tuple binds only beside a runnable reference; none holds, typed', () => {
  const q = task();
  // This pool's reference cannot dispatch: the other pool's reference is the escalation.
  const otherRef = catalog(q, {rows: catalog(q).candidates.map(r => r.model === 'gpt-6-astra' ? {...r, availability: 'unavailable'} : r)});
  const other = bind(q, otherRef);
  assert.equal(other.tuple, 'gpt-6.1-sol/medium');
  assert.equal(other.route.ladder.reference_model, 'claude-fable-5-1');
  assert.match(other.decision.reason, /;escalation_reference_other_pool;/);
  // No reference anywhere: never a cheap stand-in; the bind is a typed hold.
  const none = catalog(q, {rows: catalog(q).candidates.map(r => ['gpt-6-astra', 'claude-fable-5-1'].includes(r.model) ?
    {...r, availability: 'unavailable'} : r)});
  assert.throws(() => bind(q, none), /no_dispatchable_candidate:read_only:/);
});

test('a stale quota row is excluded: the next graded entry or pool binds', () => {
  const q = task();
  const staleMedium = catalog(q, {rows: catalog(q).candidates.map(r => r.id === 'sol-medium' ? {...r,
    quota_observed_at_ms: Date.now() - 600000, quota_valid_until_ms: Date.now() - 1000} : r)});
  const bound = bind(q, staleMedium);
  assert.notEqual(bound.decision.resolved_candidate_id, 'sol-medium');
  // Codex has no efficient tier, so its next entry is the workhorse at high;
  // the Claude pool's first entry (its workhorse at medium) may outrank it.
  assert(['gpt-6.1-sol/high', 'claude-opus-5-5/medium'].includes(bound.tuple), bound.tuple);
  assert.equal(bound.basis, 'graded:standard');
});

test('not always luna, not always low, not always max', () => {
  const tuples = new Set(), efforts = new Set();
  for (const difficulty of ['light', 'standard', 'deep']) {
    const q = task(), c = catalog(q, {request_profile: profile('answer_only', 'none', difficulty)});
    const {decision} = bind(q, c);
    tuples.add(decision.model); efforts.add(decision.effort);
  }
  assert.deepEqual([...tuples].sort(), ['gpt-6-astra', 'gpt-6-luna', 'gpt-6.1-sol']);
  assert.deepEqual([...efforts].sort(), ['low', 'medium', 'ultra']);
});

test('the catalog contract: a malformed request profile is a binding error', async t => {
  const bad = [profile('answer_only', 'none', 'unknown'), profile('work', 'none', 'standard'),
    {...profile(), policy: 'host_profile_v2'}, {...profile(), signals: ['b', 'a']}, {...profile(), extra: 1},
    profile('answer_only', 'network', 'standard')];
  for (const request_profile of bad) {
    const dir = await mkdtemp(join(tmpdir(), 'os1-graded-bad-')); await chmod(dir, 0o700);
    const q = task(), tickets = [];
    const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => catalog(q, {request_profile}),
      execute: async ticket => { tickets.push(ticket); throw new Error('never'); }});
    try {
      await runtime.submit(q);
      const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});
      assert.equal(done.state, 'held', JSON.stringify(request_profile));
      assert.equal(done.error, 'catalog_binding_invalid', JSON.stringify(request_profile));
      assert.equal(tickets.length, 0);
    } finally { await runtime.close(); await rm(dir, {recursive: true, force: true}); }
  }
  // A profile without the admission facts is not a catalog this Core binds.
  const q = task(), c = catalog(q);
  for (const key of ['owner_scope', 'chat_lane_eligible', 'request_class']) delete c[key];
  const dir = await mkdtemp(join(tmpdir(), 'os1-graded-bad-')); await chmod(dir, 0o700);
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => c,
    execute: async () => { throw new Error('never'); }});
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });
  await runtime.submit(q);
  assert.equal((await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000})).error, 'catalog_binding_invalid');
});

// ---- The durable Core: delivery, the one escalation, the ledger. ----------
function completed(ticket, patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'fixture answer',
    native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null, native_turn_terminated: true, ...patch};
}
async function harness(t, execute, {q = task(), c = null, verifierRegistry = null} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-graded-')); await chmod(dir, 0o700);
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true, catalog: async () => c ?? catalog(q),
    ...(verifierRegistry ? {verifierRegistry} : {}),
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); }});
  t.after(async () => { await runtime.close(); await rm(dir, {recursive: true, force: true}); });
  await runtime.submit(q);
  const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 6000});
  const text = await readFile(join(dir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8');
  return {done, tickets, saved: runtime._load(q.task_id), text,
    ledger: text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))};
}
const tuple = ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`;

test('a graded answer is delivered on its structural screen, labelled predicted and unverified', async t => {
  const {done, tickets, saved, ledger, text} = await harness(t, ticket => completed(ticket));
  assert.deepEqual(tickets.map(tuple), ['gpt-6.1-sol/medium']);
  assert.equal(tickets[0].native_resume_session_id, null, 'a graded attempt never resumes the owner thread');
  assert.equal(done.state, 'returned_unverified', JSON.stringify(done));
  assert.equal(done.result.output, 'fixture answer');
  assert.equal(done.result.task_quality, 'execution_only');
  assert.equal(done.result.parity_state, 'unverified');
  assert.equal(saved.children[0].route_kind, 'graded');
  assert.match(saved.children[0].routing_decision.reason, /;admitted_graded_standard;/);
  assert.equal(ledger.length, 1);
  const [record] = ledger;
  assert.deepEqual({route_class: record.route_class, route_kind: record.route_kind, delivery_basis: record.delivery_basis,
    check_id: record.check_id, check_outcome: record.check_outcome, check_label: record.check_label,
    escalated: record.escalated, task_quality: record.task_quality, family: record.family},
  {route_class: 'standard', route_kind: 'graded', delivery_basis: 'graded:standard', check_id: null,
    check_outcome: 'screen_pass', check_label: null, escalated: false, task_quality: 'execution_only',
    family: 'standard:read_only:agent'});
  assert.deepEqual(record.ladder, {cheap_effort: 'medium', reference_effort: 'ultra', cheap_model: 'gpt-6.1-sol',
    reference_model: 'gpt-6-astra'});
  const report = auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]});
  assert.equal(report.verdict, 'PASS', JSON.stringify(report.violations));
  assert.deepEqual(report.graded, {attempts: 1, possibly_delivered: 1});
});

test('any failure signal on the graded attempt escalates exactly once to the bound reference', async t => {
  const failures = {empty: {output: '   '}, error: {error: 'native_tool_failed'},
    unverified: {execution_verified: false, task_quality: 'unverified'},
    failed: {status: 'failed', output: null, execution_verified: false, task_quality: 'failed'}};
  for (const [name, patch] of Object.entries(failures)) {
    const {done, tickets, saved, ledger, text} = await harness(t, (ticket, n) => n === 1 ? completed(ticket, patch) :
      completed(ticket, {output: 'reference answer'}));
    assert.deepEqual(tickets.map(tuple), ['gpt-6.1-sol/medium', 'gpt-6-astra/ultra'], name);
    assert.equal(tickets[1].candidate_id, 'astra-ultra', name);
    assert.equal(done.result.output, 'reference answer', name);
    assert.equal(saved.children[0].route_kind, 'reference', name);
    assert.equal(saved.children[0].ladder.escalated, true, name);
    assert.match(saved.children[0].routing_decision.reason, /^tier_escalated_after_failure_signal;route_reference;admitted_reference_escalation;/);
    assert.equal(ledger.length, 2, name);
    assert.equal(ledger[0].delivery_basis, 'graded:standard', name);
    assert.equal(ledger[0].escalation_outcome, 'escalated', name);
    assert(['screen_fail', 'not_returned'].includes(ledger[0].check_outcome), `${name}: ${ledger[0].check_outcome}`);
    assert.equal(ledger[1].delivery_basis, 'reference_escalated', name);
    assert.equal(ledger[1].escalated, true, name);
    assert.equal(auditDeliveryPolicy({ledgers: [{path: 'fixture', text}]}).verdict, 'PASS', name);
  }
  // The escalated reference is the last attempt: its own failure is never retried.
  const {tickets, done} = await harness(t, (ticket) => completed(ticket, {output: ''}));
  assert.deepEqual(tickets.map(tuple), ['gpt-6.1-sol/medium', 'gpt-6-astra/ultra']);
  assert.notEqual(done.state, 'running');
});

test('a failure-signal verifier failing a graded answer escalates once; it never certifies one', async t => {
  const verifierRegistry = await registerNodeVerifiers(new Map([['signal', {id: 'signal', scope: 'read_only',
    surfaces: ['agent', 'chat'], soundness: 'partial', applies: () => true,
    verify: async input => ({passed: input.output === 'reference answer'})}]]));
  const {tickets, ledger, done} = await harness(t, (ticket, n) => completed(ticket, {output: n === 1 ? 'graded answer' :
    'reference answer'}), {verifierRegistry});
  assert.deepEqual(tickets.map(tuple), ['gpt-6.1-sol/medium', 'gpt-6-astra/ultra']);
  assert.equal(done.result.output, 'reference answer');
  assert.equal(ledger[0].delivery_basis, 'graded:standard');
  assert.equal(ledger[0].check_label, null);
});

test('no headroom at bind: the reference runs alone', async t => {
  const q = task({budget: {max_native_dispatches: 1}});
  const {tickets, ledger} = await harness(t, ticket => completed(ticket), {q});
  assert.deepEqual(tickets.map(tuple), ['gpt-6-astra/ultra']);
  assert.equal(ledger[0].delivery_basis, 'reference');
  assert.equal(ledger[0].check_outcome, null);
});

test('route-replay: a graded record is valid only as itself, screened and unlabelled', () => {
  const base = {schema: 1, task_id: 't', node_id: 'node_0', family: 'standard:read_only:agent', route_class: 'standard',
    scope: 'read_only', surface_kind: 'agent', surface: 'codex', quota_pool: 'openai_codex', model: 'gpt-6.1-sol',
    effort: 'medium', route_kind: 'graded', host_route_kind: null, reference_effort: 'ultra',
    ladder: {cheap_effort: 'medium', reference_effort: 'ultra', cheap_model: 'gpt-6.1-sol', reference_model: 'gpt-6-astra'},
    tier: 'workhorse', escalated: false, usage: null, quota_remaining_fraction: 0.6, execution_verified: true,
    task_quality: 'execution_only', verifier_outcome: 'not_registered', attempt_state: 'completed',
    escalation_outcome: null, dispatched_failure: null, dispatched_at_ms: 1, settled_at_ms: 2,
    delivery_basis: 'graded:standard', check_id: null, check_outcome: 'screen_pass', check_label: null, stratum: null};
  const audit = records => auditDeliveryPolicy({ledgers: [{path: 'f', text: records.map(r => JSON.stringify(r)).join('\n') + '\n'}]});
  const rules = report => report.violations.map(v => v.rule).sort();
  assert.equal(audit([{...base, attempt_id: 'a'}]).verdict, 'PASS');
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', check_outcome: 'not_run'}])), ['graded_delivery_without_screen_pass']);
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', check_outcome: 'pass'}])), ['graded_delivery_without_screen_pass']);
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', check_id: 'x'}])), ['check_label_on_graded_basis']);
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', route_kind: 'tier'}])), ['graded_basis_route_mismatch']);
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', delivery_basis: 'reference', check_outcome: null}])),
    ['graded_route_without_graded_basis']);
  assert.deepEqual(rules(audit([{...base, attempt_id: 'a', delivery_basis: 'certified:class:c1', check_outcome: 'pass'}])).sort(),
    ['certified_basis_route_mismatch', 'graded_route_without_graded_basis']);
  // A failed graded attempt that was never delivered needs no screen pass.
  assert.equal(audit([{...base, attempt_id: 'a', attempt_state: 'ladder_not_returned', check_outcome: 'screen_fail',
    escalation_outcome: 'escalated'}]).verdict, 'PASS');
});
