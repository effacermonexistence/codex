// Build 407 admission (R0-R13). 407-a: the Core accepts the optional host
// facts the native catalog now carries (owner_scope, chat_lane_eligible,
// request_class, task_contract, class_certificates, class_provider_pins) and
// rejects malformed ones as catalog_binding_invalid. 407-g: the one admission
// law routes by them: every Auto node is host-built (R7) and binds the
// reference unless a certifying source admits a cheaper read-only tuple, whose
// answer that source must accept or the node escalates once (R9); pools rank
// by pin, conversation affinity and then quota (R11). Real durable runtime
// with a fake executor: no provider, model, network or HOME state.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { admittedRoute, createRCCRuntime, hostContextFingerprint, hostPlan, registerNodeVerifiers, resolveRoutePlan,
  routeFamily } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import { auditDeliveryPolicy } from '../route-replay.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
// R0 (b) (K4): a registered sound_full node verifier applying to every
// read-only node. Registration refuses one that passes its refutation or
// the Core nonce, so each fixture verifier accepts only its own answers.
const soundVerifier = (id, verify, surfaces = ['agent', 'chat']) => registerNodeVerifiers(new Map([[id, {id,
  scope: 'read_only', surfaces, soundness: 'sound_full', applies: () => true, verify,
  refutations: [{instruction: 'What does the interval rule in this workspace mean?', output: 'fixture wrong answer'}]}]]));
const acceptsAnswer = async input => ({passed: input.output === 'answer', reason: 'fixture'});
const policyText = 'RCC admission fixture policy: candidates do not grant authority.';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-admission-fixture-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request, {write = false, context = null, mode = 'auto', materials = [], codexSession = null,
                              claudeSession = null} = {}) {
  const host = {workspace: dir, context, provider_preference: 'auto', codex_session_id: codexSession,
    claude_session_id: claudeSession, require_read_only: !write, owner_policy: null};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode, material_refs: materials,
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, model, effort, scope = 'read_only') {
  const now = Date.now();
  return {id, surface: 'codex', transport: 'codex_app_server', account_id: 'account-1', model, effort,
    tools: scope === 'read_only' ? ['read', 'execute'] : ['read', 'write', 'execute'], scope, permission_profile: scope,
    quota_pool: 'openai_codex', allowed_paths: scope === 'workspace_write' ? ['**'] : [],
    configuration_sha256: sha('config:' + id), availability: 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
function catalog(request, facts) {
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    candidates: [row('astra-ultra', 'gpt-6-astra', 'ultra'), row('astra-ultra-w', 'gpt-6-astra', 'ultra', 'workspace_write')],
    model_tiers: {'gpt-6-astra': 'frontier'}, native_reference_efforts: {codex: {'gpt-6-astra': 'ultra'}}, ...facts};
}
const contract = (request, overrides = {}) => ({coverage: 'full', scope: 'read_only',
  objective_sha256: request.request_sha256, contract_sha256: sha('contract'),
  context_sha256: sha(request.host_context.context ?? ''), start_tree_sha256: sha('tree'),
  reference_policy_sha256: request.policy_sha256, valid_until_ms: Date.now() + 600_000, bindings_checked: true,
  ...overrides});
const certificate = (overrides = {}) => ({certificate_id: 'cert-chat-1', provider: 'codex', model: 'gpt-6-luna',
  effort: 'low', format_check: 'nonempty_text', measurement_sha256: sha('frozen measurement'), ...overrides});
const facts = (cls, extra = {}) => ({owner_scope: cls === 'writer' ? 'workspace_write' : 'read_only',
  chat_lane_eligible: ['chat_explanatory', 'text_operation'].includes(cls), request_class: cls, ...extra});
function execution(ticket) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output: 'answer',
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: JSON.stringify({node: ticket.node_id})};
}
async function run(t, dir, request, value) {
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state-' + randomUUID()),
    catalog: async () => value,
    plan: async () => ({schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
      nodes: [{id: 'n', instruction: request.request, dependencies: [], kind: 'agent',
        scope: request.host_context.require_read_only ? 'read_only' : 'workspace_write',
        owned_paths: request.host_context.require_read_only ? [] : ['**'], context_refs: []}]}),
    execute: async ticket => execution(ticket),
    verifyTask: ({task: value, children}) => ({schema: 1, task_id: value.task_id,
      task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
      parity_state: 'unverified', reason: 'fixture_deterministic_coverage'})});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  return runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
}

test('a catalog carrying the build-407 admission facts is accepted', async t => {
  const dir = await fixture(t);
  const lookup = task(dir, 'What does the interval rule in this workspace mean?', {context: 'prior turn'});
  const cases = [
    ['older catalog without facts', lookup, {}],
    ['facts only', lookup, facts('readonly_lookup')],
    ['facts with a full contract, certificate and pin', lookup, facts('readonly_lookup', {task_contract: contract(lookup),
      class_certificates: {readonly_lookup: certificate()}, class_provider_pins: {readonly_lookup: 'claude'}})],
    ['a contract without a source binding (null)', lookup, facts('readonly_lookup',
      {task_contract: contract(lookup, {source_sha256: null, coverage: 'partial'})})],
  ];
  const writer = task(dir, 'Fix the login bug in Sources/App.swift', {write: true});
  cases.push(['writer', writer, facts('writer', {class_provider_pins: {writer: 'codex'}})]);
  const material = task(dir, 'Summarize the attached notes.', {materials: ['material-1']});
  cases.push(['read-only material', material, facts('readonly_material')]);
  for (const [name, request, extra] of cases) {
    const done = await run(t, dir, request, catalog(request, extra));
    assert.equal(done.state, 'completed', `${name}: ${done.error}`);
  }
});

test('malformed admission facts hold the task as catalog_binding_invalid', async t => {
  const dir = await fixture(t);
  const lookup = task(dir, 'What does the interval rule in this workspace mean?');
  const writer = task(dir, 'Fix the login bug in Sources/App.swift', {write: true});
  const base = facts('readonly_lookup');
  const cases = [
    ['facts not together', lookup, {owner_scope: 'read_only', request_class: 'readonly_lookup'}],
    ['contract without facts', lookup, {task_contract: contract(lookup)}],
    ['unknown class', lookup, {...base, request_class: 'deep'}],
    ['a chat class that is not chat-eligible', lookup, {...base, request_class: 'chat_explanatory'}],
    ['explicit_route outside an explicit route test', lookup, {...base, request_class: 'explicit_route'}],
    ['material class without material', lookup, {...base, request_class: 'readonly_material'}],
    ['writer on a read-only host', lookup, facts('writer')],
    ['writer that is chat-eligible', writer, {...facts('writer'), chat_lane_eligible: true}],
    ['contract for another objective', lookup, {...base, task_contract: contract(lookup, {objective_sha256: sha('other')})}],
    ['contract under another policy', lookup, {...base, task_contract: contract(lookup, {reference_policy_sha256: sha('p')})}],
    ['contract with another context', lookup, {...base, task_contract: contract(lookup, {context_sha256: sha('c')})}],
    ['contract not re-checked', lookup, {...base, task_contract: contract(lookup, {bindings_checked: false})}],
    ['contract with an extra field', lookup, {...base, task_contract: {...contract(lookup), local_only: true}}],
    ['certificate for a writer', writer, {...facts('writer'), class_certificates: {writer: certificate()}}],
    ['certificate keyed by another class', lookup, {...base, class_certificates: {chat_explanatory: certificate()}}],
    ['certificate at effort none', lookup, {...base, class_certificates: {readonly_lookup: certificate({effort: 'none'})}}],
    ['certificate for a third provider', lookup, {...base, class_certificates: {readonly_lookup: certificate({provider: 'local'})}}],
    ['pin keyed by another class', lookup, {...base, class_provider_pins: {writer: 'codex'}}],
    ['pin to an unknown pool', lookup, {...base, class_provider_pins: {readonly_lookup: 'gpt'}}],
  ];
  for (const [name, request, extra] of cases) {
    const done = await run(t, dir, request, catalog(request, extra));
    assert.equal(done.state, 'held', name);
    assert.equal(done.error, 'catalog_binding_invalid', name);
  }
});

// ---- 407-g: the admission law at work -----------------------------------------
// Two pools, as the native builder emits them: Codex (luna fast, astra
// frontier at its admitted ultra) and Anthropic (haiku fast, fable frontier
// at max, with the chat lane's rows of the same models only when the chat
// lane predicate holds and there is no material).
function poolRow(id, pool, surface, model, effort, scope = 'read_only') {
  const value = row(id, model, effort, scope);
  return {...value, surface, quota_pool: pool, transport: surface === 'codex' ? 'codex_app_server' : 'claude_cli',
    tools: surface.endsWith('-chat') ? [] : value.tools};
}
const CODEX_ROWS = () => [poolRow('luna-low', 'openai_codex', 'codex', 'gpt-6-luna', 'low'),
  poolRow('astra-ultra', 'openai_codex', 'codex', 'gpt-6-astra', 'ultra'),
  poolRow('astra-ultra-w', 'openai_codex', 'codex', 'gpt-6-astra', 'ultra', 'workspace_write')];
const CLAUDE_ROWS = () => [poolRow('chat-haiku', 'anthropic_shared', 'claude-chat', 'claude-haiku-4-5', 'none'),
  poolRow('chat-fable-max', 'anthropic_shared', 'claude-chat', 'claude-fable-5-1', 'max'),
  poolRow('haiku', 'anthropic_shared', 'claude', 'claude-haiku-4-5', 'none'),
  poolRow('fable-max', 'anthropic_shared', 'claude', 'claude-fable-5-1', 'max'),
  poolRow('fable-max-w', 'anthropic_shared', 'claude', 'claude-fable-5-1', 'max', 'workspace_write')];
const TIERS = {'gpt-6-luna': 'fast', 'gpt-6-astra': 'frontier', 'claude-haiku-4-5': 'fast', 'claude-fable-5-1': 'frontier'};
function pools(request, extra = {}, {claudeFirst = false, rows = null} = {}) {
  const chat = extra.chat_lane_eligible === true && request.material_refs.length === 0;
  const claude = CLAUDE_ROWS().filter(c => chat || c.surface !== 'claude-chat');
  const candidates = rows ?? (claudeFirst ? [...claude, ...CODEX_ROWS()] : [...CODEX_ROWS(), ...claude]);
  const models = new Set(candidates.map(c => c.model));
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, candidates,
    model_tiers: Object.fromEntries(Object.entries(TIERS).filter(([model]) => models.has(model))), ...extra};
}
const tuple = ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}/${ticket.selected_config.effort}`;
// An answer the owner's full read-only contract verified (R0 (a), R9 (a)).
const contractVerified = (stateDir, ticket) => ({...execution(ticket), task_verified: true, task_quality: 'task_verified',
  native_turn_terminated: true, operational_quality: {schema: 1, coverage: 'full', assessment_state: 'task_contract_verified',
    contract_sha256: sha('contract'), witness_path: join(stateDir, 'quality-witnesses', ticket.attempt_id + '.json'),
    witness_sha256: sha('witness'), artifact_sha256: sha(ticket.attempt_id), workspace_after_sha256: sha('tree'),
    failed_check_ids: [], corrective_attempts: 0, local_only_verified: false}});
const verdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
  parity_state: 'unverified', reason: 'fixture_deterministic_coverage'});
// K9: a runtime's routing ledger, after asserting it passes the offline
// delivery_policy_valid audit, and that the same ledger with one accepted
// descent forged unchecked does not.
async function audited(stateDir) {
  const text = await readFile(join(stateDir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8');
  const report = auditDeliveryPolicy({ledgers: [{path: 'ledger', text}]});
  assert.equal(report.verdict, 'PASS', JSON.stringify(report.violations));
  const records = text.trim().split('\n').map(line => JSON.parse(line));
  const accepted = records.find(r => r.check_outcome === 'pass' && r.attempt_state === 'completed');
  if (accepted) assert.equal(auditDeliveryPolicy({ledgers: [{text: text + JSON.stringify({...accepted,
    attempt_id: randomUUID(), check_outcome: 'not_run', check_label: null}) + '\n'}]}).verdict, 'FAIL');
  return records;
}
const label = (check_id, outcome = 'pass') => ({score_space: 'check_acceptance_v1', check_id, soundness: 'sound_full', outcome});
const basisOf = record => [record.delivery_basis, record.check_id, record.check_outcome, record.check_label];
// Auto with the host-built plan (R7): `plan` must never be called. `execute`
// receives (ticket, stateDir, call count, runtime).
async function auto(t, dir, request, value, {execute = (ticket, _stateDir) => execution(ticket), verifierRegistry} = {}) {
  const stateDir = join(dir, 'auto-' + randomUUID());
  const tickets = [];
  let catalogCalls = 0;
  const runtime = await createRCCRuntime({stateDir, hostAutoPlan: true, ...(verifierRegistry ? {verifierRegistry} : {}),
    catalog: async () => { catalogCalls++; return typeof value === 'function' ? value(catalogCalls) : value; },
    plan: async () => { throw Error('Auto must not call plan()'); },
    execute: async ticket => { tickets.push(ticket); return execute(ticket, stateDir, tickets.length, runtime); },
    verifyTask: verdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
  return {runtime, done, tickets, tuples: tickets.map(tuple), catalogCalls: () => catalogCalls, stateDir,
    events: runtime.events({schema: 1, task_id: request.task_id}).map(event => event.kind)};
}

test('uncertified chat, lookup, material and writer requests bind the reference: astra ultra or fable max', async t => {
  const dir = await fixture(t);
  const chat = task(dir, 'co가 무슨 뜻이야?');
  const lookup = task(dir, 'What does the interval rule in this workspace mean?');
  const material = task(dir, 'Summarize the attached notes.', {materials: ['material-1']});
  const writer = task(dir, 'Fix the login bug in Sources/App.swift', {write: true});
  const cases = [
    ['chat', chat, facts('chat_explanatory'), false, 'codex:gpt-6-astra/ultra'],
    ['chat, Anthropic first', chat, facts('chat_explanatory'), true, 'claude-chat:claude-fable-5-1/max'],
    ['lookup', lookup, facts('readonly_lookup'), false, 'codex:gpt-6-astra/ultra'],
    ['material', material, facts('readonly_material'), false, 'codex:gpt-6-astra/ultra'],
    ['writer', writer, facts('writer'), false, 'codex:gpt-6-astra/ultra'],
    ['writer, Anthropic first', writer, facts('writer'), true, 'claude:claude-fable-5-1/max'],
    ['an older catalog without facts', lookup, {}, false, 'codex:gpt-6-astra/ultra'],
  ];
  for (const [name, request, extra, claudeFirst, expected] of cases) {
    const result = await auto(t, dir, request, pools(request, extra, {claudeFirst}));
    assert.equal(result.done.state, 'completed', `${name}: ${result.done.error}`);
    assert.deepEqual(result.tuples, [expected], name);
    const [ticket] = result.tickets;
    assert.equal(ticket.instruction, request.request, `${name}: the owner request runs byte-exact`);
    assert.equal(ticket.node_id, 'node_0');
    assert.equal(ticket.selected_config.scope, request === writer ? 'workspace_write' : 'read_only', name);
    const decision = result.done.children[0].routing_decision;
    assert.match(decision.reason, /;admitted_reference_uncertified;/, name);
    assert.equal(decision.route_class, 'deep', name);
  }
});

test('a stale, partial or expired contract binds the reference; a full read-only contract binds the tier only with a runnable reference', async t => {
  const dir = await fixture(t);
  const lookup = task(dir, 'What does the interval rule in this workspace mean?');
  for (const [name, change] of [['expired', {valid_until_ms: Date.now() - 1}], ['partial', {coverage: 'partial'}],
    ['writer scope', {scope: 'workspace_write'}]]) {
    const result = await auto(t, dir, lookup, pools(lookup, facts('readonly_lookup', {task_contract: contract(lookup, change)})));
    assert.deepEqual(result.tuples, ['codex:gpt-6-astra/ultra'], name);
    assert.match(result.done.children[0].routing_decision.reason, /;admitted_reference_uncertified;/, name);
    assert.deepEqual(basisOf((await audited(result.stateDir))[0]), ['reference', null, null, null], name);
  }
  // A full read-only contract re-bound to this request: the cheapest tier on
  // an agent surface (a contract judges the workspace, never a chat lane),
  // guarded by the reference; its verified answer is adopted.
  const full = facts('readonly_lookup', {task_contract: contract(lookup)});
  for (const claudeFirst of [false, true]) {
    const result = await auto(t, dir, lookup, pools(lookup, full, {claudeFirst}),
      {execute: (ticket, stateDir) => contractVerified(stateDir, ticket)});
    assert.equal(result.done.state, 'completed', result.done.error);
    assert.deepEqual(result.tuples, [claudeFirst ? 'claude:claude-haiku-4-5/none' : 'codex:gpt-6-luna/low']);
    const decision = result.done.children[0].routing_decision;
    assert.match(decision.reason, /^resolver;route_tier;admitted_certified_contract;tier_list_0;tier_fast;/);
    assert.equal(result.done.result.task_verified, true);
    // K9: the contract's own pass on this attempt, a sound_full label.
    const [record] = await audited(result.stateDir);
    assert.deepEqual(basisOf(record), ['certified:contract', 'contract:' + sha('contract'), 'pass',
      label('contract:' + sha('contract'))]);
    assert.equal(record.verifier_outcome, 'pass');
  }
  // No runnable reference: nothing runs below it (held before any plan).
  const noReference = await auto(t, dir, lookup, pools(lookup, full, {rows: [CODEX_ROWS()[0]]}),
    {execute: () => { throw Error('must not dispatch'); }});
  assert.equal(noReference.done.state, 'held');
  assert.equal(noReference.done.error, 'no_dispatchable_candidate:openai_codex=no_reference');
  // A contract for a request the node does not run byte-exact never certifies:
  // a contract never reaches an injected decomposition's sub-instruction.
  const node = {id: 'n', instruction: 'Explain only the first paragraph.', dependencies: [], kind: 'agent',
    scope: 'read_only', owned_paths: [], context_refs: []};
  assert.deepEqual(admittedRoute(node, lookup, pools(lookup, full)),
    {class: 'reference', source: 'uncertified', certificate_id: null});
});

test('R9: a certified descent escalates exactly once on verifier failure, empty, error, partial and mismatch', async t => {
  const dir = await fixture(t);
  const lookup = task(dir, 'What does the interval rule in this workspace mean?');
  const full = pools(lookup, facts('readonly_lookup', {task_contract: contract(lookup)}));
  const quality = (stateDir, ticket, patch) => {
    const value = contractVerified(stateDir, ticket);
    return {...value, task_verified: false, task_quality: patch.assessment_state === 'mismatch' ? 'failed' : 'execution_only',
      operational_quality: {...value.operational_quality, ...patch}};
  };
  const cheap = {
    'unverified answer': ticket => execution(ticket),
    empty: ticket => ({...execution(ticket), output: ''}),
    whitespace: ticket => ({...execution(ticket), output: ' \n '}),
    error: ticket => ({...execution(ticket), error: 'native_tool_failed'}),
    partial: (ticket, stateDir) => quality(stateDir, ticket, {coverage: 'partial', assessment_state: 'execution_only'}),
    mismatch: (ticket, stateDir) => quality(stateDir, ticket, {coverage: 'full', assessment_state: 'mismatch',
      failed_check_ids: ['public-test']}),
  };
  for (const [name, answer] of Object.entries(cheap)) {
    const result = await auto(t, dir, lookup, full, {execute: (ticket, stateDir, count) =>
      count === 1 ? answer(ticket, stateDir) : execution(ticket)});
    assert.equal(result.done.state, 'completed', `${name}: ${result.done.error}`);
    assert.deepEqual(result.tuples, ['codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra'], name);
    assert.equal(result.done.result.output, 'answer', `${name}: the reference answer, never the descent`);
    assert.equal(result.events.filter(kind => kind === 'ladder_escalated_to_reference').length, 1, name);
    assert.match(result.done.children[0].routing_decision.reason, /;admitted_reference_escalation;/, name);
    // K9: the contract did not accept this answer; the reference needs no check.
    const [descent, reference] = await audited(result.stateDir);
    assert.deepEqual(basisOf(descent), ['certified:contract', 'contract:' + sha('contract'), 'not_returned',
      label('contract:' + sha('contract'), 'not_returned')], name);
    assert.deepEqual([descent.attempt_state, descent.escalation_outcome], ['ladder_not_returned', 'escalated'], name);
    assert.deepEqual(basisOf(reference), ['reference_escalated', null, null, null], name);
  }
  // R0 (b): a registered verifier certifies; its failure escalates once too.
  const verifierRegistry = await soundVerifier('fixture-astra-only', async input =>
    ({passed: input.selected_config?.model === 'gpt-6-astra', reason: 'fixture'}));
  const verified = await auto(t, dir, lookup, pools(lookup, facts('readonly_lookup')), {verifierRegistry});
  assert.deepEqual(verified.tuples, ['codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra']);
  assert.match(verified.done.children[0].routing_decision.reason, /^tier_escalated_after_verifier_failure;/);
  assert.equal(verified.events.filter(kind => kind === 'ladder_escalated_to_reference').length, 1);
  // K9: the certifier (a registered sound_full verifier) failed this attempt.
  const [failedDescent, escalatedReference] = await audited(verified.stateDir);
  assert.deepEqual(basisOf(failedDescent), ['certified:verifier:fixture-astra-only', 'verifier:fixture-astra-only', 'fail',
    label('verifier:fixture-astra-only', 'fail')]);
  assert.deepEqual([failedDescent.attempt_state, failedDescent.verifier_outcome], ['ladder_verifier_failed', 'fail']);
  assert.deepEqual(basisOf(escalatedReference), ['reference_escalated', null, null, null]);
});

test('a class certificate binds its own tuple for the request run byte-exact; its format check accepts or escalates', async t => {
  const dir = await fixture(t);
  const chat = task(dir, 'co가 무슨 뜻이야?');
  const signed = pools(chat, facts('chat_explanatory', {class_certificates: {chat_explanatory: certificate()}}));
  const adopted = await auto(t, dir, chat, signed);
  assert.equal(adopted.done.state, 'completed', adopted.done.error);
  assert.deepEqual(adopted.tuples, ['codex:gpt-6-luna/low']);
  assert.match(adopted.done.children[0].routing_decision.reason,
    /^resolver;route_tier;admitted_certified_class:cert-chat-1;tier_fast;/);
  // K9: a format check is partial: its pass is the delivery check, never a §4.3 label.
  assert.deepEqual(basisOf((await audited(adopted.stateDir))[0]),
    ['certified:class:cert-chat-1', 'class:cert-chat-1:nonempty_text', 'pass', null]);
  const failed = await auto(t, dir, chat, signed, {execute: (ticket, _stateDir, count) =>
    count === 1 ? {...execution(ticket), output: '  '} : execution(ticket)});
  assert.deepEqual(failed.tuples, ['codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra']);
  assert.equal(failed.done.state, 'completed', failed.done.error);
  const [classDescent, classReference] = await audited(failed.stateDir);
  assert.deepEqual(basisOf(classDescent), ['certified:class:cert-chat-1', 'class:cert-chat-1:nonempty_text',
    'not_returned', null]);
  assert.equal(classReference.delivery_basis, 'reference_escalated');
  // A certificate for a tuple the catalog does not offer binds the reference.
  const absent = pools(chat, facts('chat_explanatory', {class_certificates: {chat_explanatory: certificate({model: 'gpt-9'})}}));
  const reference = await auto(t, dir, chat, absent);
  assert.deepEqual(reference.tuples, ['codex:gpt-6-astra/ultra']);
  assert.match(reference.done.children[0].routing_decision.reason, /;certified_tuple_undispatchable;/);
});

// Build 440 (owner order 2026-10-27): the SHIPPED signed table, the bytes the
// host compiles in (RCCAdmissionFactsFixture proves them identical), certifies
// chat_explanatory only, by the compiled owner decision. Core binds that
// certificate's own tuple, codex gpt-6-luna low, admitted by 'class'; its
// format check accepts or escalates once; every other class stays on the
// reference exactly as before (the host emits no certificate for it).
test('build 440: the shipped owner-decision certificate binds chat_explanatory to luna low; other classes keep the reference', async t => {
  const dir = await fixture(t);
  const shipped = JSON.parse(await readFile(new URL('../../Resources/rcc-class-table.json', import.meta.url), 'utf8'));
  const decision = await readFile(new URL('../../Resources/rcc-class-owner-decision.json', import.meta.url));
  assert.deepEqual(Object.keys(shipped.class_certificates), ['chat_explanatory']);
  assert.deepEqual(shipped.class_provider_pins, {});
  const owner = shipped.class_certificates.chat_explanatory;
  assert.deepEqual(owner, {certificate_id: 'owner-chat-fast-20261027', provider: 'codex', model: 'gpt-6-luna', effort: 'low',
    format_check: 'nonempty_text', measurement_sha256: createHash('sha256').update(decision).digest('hex')});
  const chat = task(dir, '자 이제 네가 얼마나 잘 되는지 보자');
  const signed = pools(chat, facts('chat_explanatory', {class_certificates: {chat_explanatory: owner}}));
  const adopted = await auto(t, dir, chat, signed);
  assert.equal(adopted.done.state, 'completed', adopted.done.error);
  assert.deepEqual(adopted.tuples, ['codex:gpt-6-luna/low']);
  assert.match(adopted.done.children[0].routing_decision.reason,
    /^resolver;route_tier;admitted_certified_class:owner-chat-fast-20261027;tier_fast;/);
  const [record] = await audited(adopted.stateDir);
  assert.deepEqual(basisOf(record), ['certified:class:owner-chat-fast-20261027',
    'class:owner-chat-fast-20261027:nonempty_text', 'pass', null]);
  assert.equal(record.stratum.request_class, 'chat_explanatory');
  assert.deepEqual(record.ladder, {cheap_effort: 'low', reference_effort: 'ultra', cheap_model: 'gpt-6-luna',
    reference_model: 'gpt-6-astra'});
  // An empty answer fails the format check: one escalation to the reference.
  const failed = await auto(t, dir, chat, signed, {execute: (ticket, _stateDir, count) =>
    count === 1 ? {...execution(ticket), output: ' \n'} : execution(ticket)});
  assert.equal(failed.done.state, 'completed', failed.done.error);
  assert.deepEqual(failed.tuples, ['codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra']);
  assert.equal(failed.events.filter(kind => kind === 'ladder_escalated_to_reference').length, 1);
  const [descent, escalated] = await audited(failed.stateDir);
  assert.deepEqual(basisOf(descent), ['certified:class:owner-chat-fast-20261027',
    'class:owner-chat-fast-20261027:nonempty_text', 'not_returned', null]);
  assert.equal(escalated.delivery_basis, 'reference_escalated');
  // The App routes with routing intent v2: a resolved intent naming nothing
  // changes owner-word semantics only, so the class descent stands; one that
  // requires the native ceiling binds the reference.
  const v2Task = {...chat, routing_intent_policy_version: 'r10_joint_selection_v2'};
  const v2Catalog = {...signed, routing_intent_v2: {version: 'r10_joint_selection_v2', allowed_surfaces: [], exact_model: null,
    model_family: null, effort: null, require_native_ceiling: false, quality_target: null, state: 'resolved'}};
  const v2Route = resolveRoutePlan(hostPlan(v2Task, v2Catalog), v2Task, v2Catalog);
  assert.deepEqual([v2Route.decisions.node_0.model, v2Route.decisions.node_0.effort, v2Route.routes.node_0.kind,
    v2Route.routes.node_0.ladder.admitted_by], ['gpt-6-luna', 'low', 'tier', 'class']);
  const ceiling = {...v2Catalog, routing_intent_v2: {...v2Catalog.routing_intent_v2, require_native_ceiling: true}};
  assert.equal(resolveRoutePlan(hostPlan(v2Task, ceiling), v2Task, ceiling).decisions.node_0.model, 'gpt-6-astra');
  // readonly_lookup, text_operation and writer: no certificate on the wire.
  const others = [
    ['readonly_lookup', task(dir, 'What does the interval rule in this workspace mean?'), 'codex:gpt-6-astra/ultra'],
    ['text_operation', task(dir, '다음 문장을 영문으로 번역해줘: 내일 회의를 오후 3시로 옮겨도 될까요?'), 'codex:gpt-6-astra/ultra'],
    ['writer', task(dir, 'Fix the login bug in Sources/App.swift', {write: true}), 'codex:gpt-6-astra/ultra']];
  for (const [cls, request, expected] of others) {
    const result = await auto(t, dir, request, pools(request, facts(cls)));
    assert.equal(result.done.state, 'completed', `${cls}: ${result.done.error}`);
    assert.deepEqual(result.tuples, [expected], cls);
    assert.match(result.done.children[0].routing_decision.reason, /;admitted_reference_uncertified;/, cls);
    assert.equal((await audited(result.stateDir))[0].delivery_basis, 'reference', cls);
  }
  // The owner's words still own an explicit route, the certificate notwithstanding.
  const explicit = task(dir, 'co가 무슨 뜻이야?', {mode: 'explicit_routing_test'});
  assert.deepEqual(admittedRoute({id: 'requested-1', instruction: explicit.request, dependencies: [], kind: 'agent',
    scope: 'read_only', owned_paths: [], context_refs: []}, {...explicit, host_context: {...explicit.host_context,
    explicit_routes: [{surface: 'codex', instruction: explicit.request}]}},
  pools(explicit, facts('chat_explanatory', {class_certificates: {chat_explanatory: owner}}))),
  {class: 'reference', source: 'owner_words', certificate_id: null});
});

test('R11: a class pin, then conversation affinity, choose between equal-quality references', async t => {
  const dir = await fixture(t);
  const lookup = task(dir, 'What does the interval rule in this workspace mean?');
  const pinned = await auto(t, dir, lookup, pools(lookup, facts('readonly_lookup',
    {class_provider_pins: {readonly_lookup: 'claude'}})));
  assert.deepEqual(pinned.tuples, ['claude:claude-fable-5-1/max']);
  assert.match(pinned.done.children[0].routing_decision.reason, /;pool_class_pin;/);
  const resumed = task(dir, 'And what about the second rule?', {claudeSession: 'owner-claude-thread'});
  const affine = await auto(t, dir, resumed, pools(resumed, facts('readonly_lookup')));
  assert.deepEqual(affine.tuples, ['claude:claude-fable-5-1/max']);
  assert.equal(affine.tickets[0].native_resume_session_id, 'owner-claude-thread');
  assert.match(affine.done.children[0].routing_decision.reason, /;pool_conversation_affinity;/);
  // The pin outranks the affinity.
  const both = await auto(t, dir, resumed, pools(resumed, facts('readonly_lookup',
    {class_provider_pins: {readonly_lookup: 'codex'}})));
  assert.deepEqual(both.tuples, ['codex:gpt-6-astra/ultra']);
});

test('R1: a zero-model path runs only without earlier conversation; R7: Auto never calls plan()', async t => {
  const dir = await fixture(t);
  const bare = await auto(t, dir, task(dir, '1+1'), () => { throw Error('no catalog for an exact answer'); });
  assert.equal(bare.done.state, 'completed');
  assert.equal(bare.done.result.output, '2');
  assert.equal(bare.catalogCalls(), 0, 'no catalog probe, plan or model call');
  const followUp = task(dir, '3-4', {codexSession: 'owner-codex-thread'});
  const routed = await auto(t, dir, followUp, pools(followUp, facts('readonly_lookup')));
  assert.equal(routed.done.state, 'completed', routed.done.error);
  assert.deepEqual(routed.tuples, ['codex:gpt-6-astra/ultra'], 'after a prior turn "3-4" reaches the reference');
  assert.equal(routed.tickets[0].instruction, '3-4');
  assert.ok(!routed.events.includes('plan_requested'));
});

test('hostPlan (R2, R7): one byte-exact node whose scope the host decides; explicit routes keep their ordinals', () => {
  const lookup = task('/tmp', 'What does the interval rule in this workspace mean?', {materials: ['material-1']});
  const single = hostPlan(lookup, pools(lookup, facts('readonly_material')));
  assert.deepEqual(single, {schema: 1, task_id: lookup.task_id, request_sha256: lookup.request_sha256,
    nodes: [{id: 'node_0', instruction: lookup.request, dependencies: [], kind: 'agent', scope: 'read_only',
      owned_paths: [], context_refs: ['material-1']}], final_node_id: 'node_0'});
  const writer = task('/tmp', 'Fix the login bug in Sources/App.swift', {write: true});
  assert.deepEqual(hostPlan(writer, pools(writer, facts('writer'))).nodes[0].owned_paths, ['**']);
  assert.equal(hostPlan(writer, pools(writer, facts('writer'))).nodes[0].scope, 'workspace_write');
  // An owner request that runs read-only, the chat lane, or a read-only class
  // makes a host that allows writes still plan a reader.
  for (const extra of [{...facts('readonly_lookup')}, {...facts('writer'), owner_scope: 'read_only'},
    {...facts('chat_explanatory')}])
    assert.equal(hostPlan(writer, pools(writer, extra)).nodes[0].scope, 'read_only', JSON.stringify(extra));
  // No facts on a host that allows writes: a writer (the scope error that never lowers quality).
  assert.equal(hostPlan(writer, pools(writer)).nodes[0].scope, 'workspace_write');
  // An explicit route test: one node per route that still runs, keyed by
  // its ORIGINAL ordinal, with that route's own text.
  const explicit = task('/tmp', '1+1 Codex한테. 3+3 Claude한테.', {mode: 'explicit_routing_test'});
  explicit.host_context = {...explicit.host_context, explicit_routes: [{surface: 'codex', instruction: '1+1'},
    {surface: 'claude', instruction: '3+3', skipped: true}, {surface: 'claude-chat', instruction: '4+4'}]};
  explicit.source_fingerprint = hostContextFingerprint(explicit.host_context);
  const routes = hostPlan(explicit, pools(explicit));
  assert.deepEqual(routes.nodes.map(node => [node.id, node.instruction, node.scope]),
    [['requested-1', '1+1', 'read_only'], ['requested-3', '4+4', 'read_only']]);
  assert.equal(Object.hasOwn(routes, 'final_node_id'), false);
  const untiered = {...pools(explicit)}; delete untiered.model_tiers;
  assert.throws(() => hostPlan(explicit, untiered), /explicit_route_catalog_untiered/);
});

test('routeFamily names the class, scope and surface kind', () => {
  assert.equal(routeFamily('trivial', 'read_only', 'claude-chat'), 'trivial:read_only:chat');
  assert.equal(routeFamily('deep', 'workspace_write', 'codex'), 'deep:workspace_write:agent');
  assert.equal(routeFamily(null, 'read_only', 'local'), 'unclassified:read_only:local');
});

// ---- 407-g: the design's per-kind table, bound before dispatch --------------
// What each request kind binds (design quality_argument (1)-(2); R1, R3-R5,
// R7, R10): decided by code when the plan is admitted, before any model call.
// The `plan_admitted` event already names the tuple each first ticket runs,
// and at dispatch the persisted decision names exactly that ticket's row.
const REFERENCE_TUPLES = new Set(['codex:gpt-6-astra/ultra', 'claude:claude-fable-5-1/max',
  'claude-chat:claude-fable-5-1/max']);
const decided = decision => `${decision.surface}:${decision.model}/${decision.effort}`;
function admittedAt(runtime, request) {
  const events = runtime.events({schema: 1, task_id: request.task_id});
  const admitted = events.findIndex(event => event.kind === 'plan_admitted');
  const dispatched = events.findIndex(event => event.kind === 'dispatch_started');
  return {before: admitted >= 0 && dispatched > admitted, routes: Object.fromEntries((events[admitted]?.snapshot.children ?? [])
    .map(child => [child.id, decided(child.routing_decision)]))};
}
// Execute that also checks, at dispatch, that the persisted decision of the
// dispatched node names exactly this ticket's row (no late choice).
function observing(answer = (ticket, stateDir) => execution(ticket)) {
  const mismatches = [];
  return {mismatches, execute: (ticket, stateDir, count, runtime) => {
    const child = runtime.status({schema: 1, task_id: ticket.task_id}).children.find(c => c.id === ticket.node_id);
    const decision = child?.routing_decision;
    if (!(decision?.resolved_candidate_id === ticket.candidate_id && decision.model === ticket.selected_config.model &&
        decision.effort === ticket.selected_config.effort && decision.surface === ticket.selected_config.surface))
      mismatches.push(ticket.node_id);
    return answer(ticket, stateDir, count);
  }};
}
// The owner's own words reach Core as host facts: a provider word narrows the
// catalog to that provider's rows, a family or effort word is its
// routing_intent (RCCNativeCatalogBuilder).
function withHost(request, patch) {
  const value = {...request, host_context: {...request.host_context, ...patch}};
  value.source_fingerprint = hostContextFingerprint(value.host_context);
  return value;
}
const AGENT_CLAUDE = () => CLAUDE_ROWS().filter(c => c.surface === 'claude');

test('the per-kind table: every request kind binds the route the design names, recorded before dispatch', async t => {
  const dir = await fixture(t);
  // (1) Zero-model (R1): no prior conversation, an exact computation: no
  // catalog, plan or model call.
  const exact = await auto(t, dir, task(dir, '1+1'), () => { throw Error('no catalog for an exact answer'); });
  assert.equal(exact.done.result.output, '2');
  assert.deepEqual([exact.catalogCalls(), exact.tickets.length], [0, 0]);
  const chat = () => task(dir, 'co가 무슨 뜻이야?');
  const text = () => task(dir, 'Translate into English: 오늘 회의는 3시에 시작합니다.');
  const lookup = () => task(dir, 'What does the interval rule in this workspace mean?');
  const material = () => task(dir, 'Summarize the attached notes.', {materials: ['material-1']});
  const writer = () => task(dir, 'Fix the login bug in Sources/App.swift', {write: true});
  const claudeWord = () => withHost(task(dir, 'Claude한테 물어봐: 이 저장소의 interval 규칙이 뭐야?'), {provider_preference: 'claude'});
  const haikuWord = () => withHost(task(dir, 'Claude haiku로 물어봐: 이 저장소의 interval 규칙이 뭐야?'),
    {provider_preference: 'claude'});
  const astraLow = () => task(dir, 'astra low로 이 저장소의 interval 규칙 설명해줘');
  const ASTRA_LOW = () => [...CODEX_ROWS(), poolRow('astra-low', 'openai_codex', 'codex', 'gpt-6-astra', 'low')];
  // [kind, request, facts, catalog options, the one tuple it binds, scope, admission token]
  const table = [
    // (2) Uncertified kinds bind the reference model at the reference effort.
    ['chat_explanatory (R3)', chat, facts('chat_explanatory'), {}, 'codex:gpt-6-astra/ultra', 'read_only', 'reference_uncertified'],
    ['chat_explanatory (R3), Anthropic pool', chat, facts('chat_explanatory'), {claudeFirst: true},
      'claude-chat:claude-fable-5-1/max', 'read_only', 'reference_uncertified'],
    ['text_operation (R3)', text, facts('text_operation'), {}, 'codex:gpt-6-astra/ultra', 'read_only', 'reference_uncertified'],
    ['text_operation (R3), Anthropic pool', text, facts('text_operation'), {claudeFirst: true},
      'claude-chat:claude-fable-5-1/max', 'read_only', 'reference_uncertified'],
    ['readonly_lookup (R4)', lookup, facts('readonly_lookup'), {}, 'codex:gpt-6-astra/ultra', 'read_only', 'reference_uncertified'],
    ['readonly_lookup (R4), Anthropic pool', lookup, facts('readonly_lookup'), {claudeFirst: true},
      'claude:claude-fable-5-1/max', 'read_only', 'reference_uncertified'],
    ['readonly_material (R4)', material, facts('readonly_material'), {}, 'codex:gpt-6-astra/ultra', 'read_only',
      'reference_uncertified'],
    ['readonly_material (R4), Anthropic pool', material, facts('readonly_material'), {claudeFirst: true},
      'claude:claude-fable-5-1/max', 'read_only', 'reference_uncertified'],
    ['writer (R5)', writer, facts('writer'), {}, 'codex:gpt-6-astra/ultra', 'workspace_write', 'reference_uncertified'],
    ['writer (R5), Anthropic pool', writer, facts('writer'), {claudeFirst: true}, 'claude:claude-fable-5-1/max',
      'workspace_write', 'reference_uncertified'],
    // (R10) Owner words win: a bare provider name binds that provider's
    // reference; a family word that family; family and effort that tuple.
    ['provider word "Claude한테 물어봐" (R10)', claudeWord, facts('readonly_lookup'), {rows: AGENT_CLAUDE()},
      'claude:claude-fable-5-1/max', 'read_only', 'reference_owner_words'],
    ['family word "Claude haiku로" (R10)', haikuWord, facts('readonly_lookup', {routing_intent: {effort: null,
      model_family: 'haiku'}}), {rows: AGENT_CLAUDE()}, 'claude:claude-haiku-4-5/none', 'read_only', 'reference_owner_words'],
    ['family and effort words "astra low로" (R10)', astraLow, facts('readonly_lookup', {routing_intent: {effort: 'low',
      model_family: 'astra'}}), {rows: ASTRA_LOW()}, 'codex:gpt-6-astra/low', 'read_only', 'reference_owner_words'],
  ];
  for (const [name, make, extra, options, expected, scope, token] of table) {
    const request = make();
    const watch = observing();
    const result = await auto(t, dir, request, pools(request, extra, options), {execute: watch.execute});
    assert.equal(result.done.state, 'completed', `${name}: ${result.done.error}`);
    assert.deepEqual(result.tuples, [expected], name);
    const bound = admittedAt(result.runtime, request);
    assert.ok(bound.before, `${name}: the route is recorded with the plan, before any dispatch`);
    assert.deepEqual(bound.routes, {node_0: expected}, name);
    assert.deepEqual(watch.mismatches, [], `${name}: the dispatched row is the admitted row`);
    assert.equal(result.tickets[0].instruction, request.request, `${name}: one host node runs the owner request byte-exact`);
    assert.equal(result.tickets[0].selected_config.scope, scope, name);
    assert.match(result.done.children[0].routing_decision.reason, new RegExp(`;admitted_${token};`), name);
    if (token === 'reference_uncertified' || name.startsWith('provider word'))
      assert.ok(REFERENCE_TUPLES.has(expected), name);
    assert.equal(result.done.children[0].routing_decision.ladder, undefined, `${name}: no descent, no escalation`);
  }
  // explicit_route (R7, R10): one host node per named route, each on its own
  // surface's reference with that route's own text.
  const routes = [{surface: 'codex', instruction: 'Explain the interval rule.'},
    {surface: 'claude', instruction: 'Explain the merge rule.'}, {surface: 'claude-chat', instruction: 'What does co mean?'}];
  const explicit = withHost(task(dir, 'Codex한테 interval 규칙, Claude Code한테 merge 규칙, Claude한테 co 뜻.',
    {mode: 'explicit_routing_test'}), {explicit_routes: routes});
  const watch = observing();
  const fanout = await auto(t, dir, explicit, pools(explicit, facts('explicit_route'),
    {rows: [...CODEX_ROWS(), ...CLAUDE_ROWS()]}), {execute: watch.execute});
  assert.equal(fanout.done.state, 'completed', fanout.done.error);
  const expected = {'requested-1': 'codex:gpt-6-astra/ultra', 'requested-2': 'claude:claude-fable-5-1/max',
    'requested-3': 'claude-chat:claude-fable-5-1/max'};
  const bound = admittedAt(fanout.runtime, explicit);
  assert.ok(bound.before);
  assert.deepEqual(bound.routes, expected);
  assert.deepEqual(watch.mismatches, []);
  assert.deepEqual(Object.fromEntries(fanout.tickets.map(ticket => [ticket.node_id, tuple(ticket)])), expected);
  assert.deepEqual(Object.fromEntries(fanout.tickets.map(ticket => [ticket.node_id, ticket.instruction])),
    Object.fromEntries(routes.map((route, index) => [`requested-${index + 1}`, route.instruction])));
  assert.ok(fanout.done.children.every(child => /;admitted_reference_owner_words;/.test(child.routing_decision.reason)));
});

test('R10: an owner provider choice binds that provider\'s reference even when a certifying source exists', async t => {
  const dir = await fixture(t);
  const verifierRegistry = await soundVerifier('fixture-answer', acceptsAnswer);
  const FABLE_LOW = () => [...AGENT_CLAUDE(), poolRow('fable-low', 'anthropic_shared', 'claude', 'claude-fable-5-1', 'low')];
  const lookup = provider => withHost(task(dir, 'What does the interval rule in this workspace mean?'),
    {provider_preference: provider});
  const chat = provider => withHost(task(dir, 'co가 무슨 뜻이야?'), {provider_preference: provider});
  // [name, request for a provider, facts for that request, rows, the descent it binds with no provider choice,
  //  the reference the provider choice binds, execute, verifier registry]
  const cases = [
    ['Claude + full contract', lookup, request => facts('readonly_lookup', {task_contract: contract(request)}),
      AGENT_CLAUDE, 'claude:claude-haiku-4-5/none', 'claude:claude-fable-5-1/max',
      (ticket, stateDir) => contractVerified(stateDir, ticket), null],
    ['Codex + full contract', lookup, request => facts('readonly_lookup', {task_contract: contract(request)}),
      CODEX_ROWS, 'codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra',
      (ticket, stateDir) => contractVerified(stateDir, ticket), null],
    ['Claude + registered verifier', lookup, () => facts('readonly_lookup'), AGENT_CLAUDE,
      'claude:claude-haiku-4-5/none', 'claude:claude-fable-5-1/max', undefined, verifierRegistry],
    ['Codex + registered verifier', lookup, () => facts('readonly_lookup'), CODEX_ROWS,
      'codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra', undefined, verifierRegistry],
    ['Claude + class certificate', lookup, () => facts('readonly_lookup', {class_certificates: {readonly_lookup:
      certificate({certificate_id: 'cert-claude-1', provider: 'claude', model: 'claude-fable-5-1', effort: 'low'})}}),
      FABLE_LOW, 'claude:claude-fable-5-1/low', 'claude:claude-fable-5-1/max', undefined, null],
    ['Codex + class certificate', chat, () => facts('chat_explanatory',
      {class_certificates: {chat_explanatory: certificate()}}), CODEX_ROWS, 'codex:gpt-6-luna/low',
      'codex:gpt-6-astra/ultra', undefined, null],
  ];
  for (const [name, make, factsOf, rows, descent, expected, execute, registry] of cases) {
    const options = {...(execute ? {execute} : {}), ...(registry ? {verifierRegistry: registry} : {})};
    // Control: with no provider choice the certifying source is live and descends.
    const auto_ = make('auto');
    const control = await auto(t, dir, auto_, pools(auto_, factsOf(auto_), {rows: rows()}), options);
    assert.equal(control.tuples[0], descent, `${name}: the source certifies a descent without a provider choice`);
    assert.match(control.done.children[0].routing_decision.reason, /;admitted_certified_|^tier_escalated_/, name);
    // The owner's provider choice: that provider's reference, nothing below it.
    const chosen = make(rows === CODEX_ROWS ? 'codex' : 'claude');
    const watch = observing(execute);
    const result = await auto(t, dir, chosen, pools(chosen, factsOf(chosen), {rows: rows()}),
      {...options, execute: watch.execute});
    assert.equal(result.done.state, 'completed', `${name}: ${result.done.error}`);
    assert.deepEqual(result.tuples, [expected], name);
    assert.deepEqual(admittedAt(result.runtime, chosen).routes, {node_0: expected}, name);
    assert.deepEqual(watch.mismatches, [], name);
    const decision = result.done.children[0].routing_decision;
    assert.match(decision.reason, /^resolver;route_reference;admitted_reference_owner_words;/, name);
    assert.equal(decision.ladder, undefined, `${name}: no descent, no escalation`);
    // K9: the owner's tuple, counted apart; the control's descent passes the audit too.
    assert.deepEqual(basisOf((await audited(result.stateDir))[0]), ['owner_words', null, null, null], name);
    await audited(control.stateDir);
  }
  // A task-level provider choice is the owner's word too; 'auto' at both levels is not.
  const lookupAuto = lookup('auto');
  const full = pools(lookupAuto, facts('readonly_lookup', {task_contract: contract(lookupAuto)}), {rows: CODEX_ROWS()});
  const node = {id: 'n', instruction: lookupAuto.request, dependencies: [], kind: 'agent', scope: 'read_only',
    owned_paths: [], context_refs: []};
  assert.deepEqual(admittedRoute(node, lookupAuto, full), {class: 'certified', source: 'contract', certificate_id: null});
  assert.deepEqual(admittedRoute(node, {...lookupAuto, provider_preference: 'auto'}, full),
    {class: 'certified', source: 'contract', certificate_id: null});
  assert.deepEqual(admittedRoute(node, {...lookupAuto, provider_preference: 'codex'}, full),
    {class: 'reference', source: 'owner_words', certificate_id: null});
  assert.deepEqual(admittedRoute(node, lookup('claude-chat'), full),
    {class: 'reference', source: 'owner_words', certificate_id: null});
});

// One durable runtime runs many tasks, each with its own catalog. With
// `plan`, the injected plan is used instead of the host plan.
async function bulk(t, dir, jobs, {verifierRegistry = null, plan = null} = {}) {
  const catalogs = new Map(jobs.map(job => [job.request.task_id, job.catalog]));
  const tickets = new Map(jobs.map(job => [job.request.task_id, []]));
  const runtime = await createRCCRuntime({stateDir: join(dir, 'bulk-' + randomUUID()), maximumWorkers: 8,
    maximumReadWorkersPerPool: 8, hostAutoPlan: plan === null,
    plan: plan ?? (async () => { throw Error('Auto must not call plan()'); }),
    ...(verifierRegistry ? {verifierRegistry} : {}),
    catalog: async value => catalogs.get(value.task_id),
    execute: async ticket => { tickets.get(ticket.task_id).push(ticket); return execution(ticket); },
    verifyTask: verdict});
  t.after(async () => { await runtime.close(); });
  for (const job of jobs) await runtime.submit(job.request);
  return Promise.all(jobs.map(async job => {
    const done = await runtime.wait({schema: 1, task_id: job.request.task_id}, {timeoutMs: 20_000});
    return {...job, done, tuples: tickets.get(job.request.task_id).map(tuple)};
  }));
}

test('without a certifying source nothing binds below the reference: catalog order, quota, pins, affinity, grades and near-miss sources never lower it', async t => {
  const dir = await fixture(t);
  const KINDS = {
    chat_explanatory: (extra = {}) => task(dir, 'co가 무슨 뜻이야?', extra),
    text_operation: (extra = {}) => task(dir, 'Translate into English: 오늘 회의는 3시에 시작합니다.', extra),
    readonly_lookup: (extra = {}) => task(dir, 'What does the interval rule in this workspace mean?', extra),
    readonly_material: (extra = {}) => task(dir, 'Summarize the attached notes.', {materials: ['material-1'], ...extra}),
    writer: (extra = {}) => task(dir, 'Fix the login bug in Sources/App.swift', {write: true, ...extra}),
  };
  const fast = c => TIERS[c.model] === 'fast';
  // The rows pools() would emit for this request, transformed.
  const reshaped = (request, extra, change) => pools(request, extra, {rows: change(pools(request, extra).candidates)});
  const variants = [
    ['every fast row listed first', (request, extra) => reshaped(request, extra, rows =>
      [...rows.filter(fast), ...rows.filter(c => !fast(c))])],
    ['the references nearly out of quota, the fast rows full', (request, extra) => reshaped(request, extra, rows =>
      rows.map(c => ({...c, quota_remaining_fraction: fast(c) ? 1 : 0.01})))],
    ['quota scores favouring the fast models', (request, extra) => pools(request, {...extra, quota_scores:
      {'gpt-6-luna': 1_000_000_000, 'claude-haiku-4-5': 1_000_000_000, 'gpt-6-astra': 1, 'claude-fable-5-1': 1}})],
    ['a class pin to Codex', (request, extra) => pools(request, {...extra,
      class_provider_pins: {[extra.request_class]: 'codex'}})],
    ['a class pin to Claude', (request, extra) => pools(request, {...extra,
      class_provider_pins: {[extra.request_class]: 'claude'}})],
    ['a partial contract', (request, extra) => pools(request, {...extra, task_contract: contract(request, {coverage: 'partial'})})],
    ['an expired contract', (request, extra) => pools(request, {...extra,
      task_contract: contract(request, {valid_until_ms: Date.now() - 1})})],
    ['a writer-scope contract', (request, extra) => pools(request, {...extra,
      task_contract: contract(request, {scope: 'workspace_write'})})],
  ];
  const jobs = [];
  for (const [cls, make] of Object.entries(KINDS)) {
    for (const [name, build] of variants) {
      const request = make();
      jobs.push({name: `${cls}: ${name}`, request, catalog: build(request, facts(cls))});
    }
    // Conversation affinity picks a pool, never a tier.
    for (const session of [{codexSession: 'owner-codex'}, {claudeSession: 'owner-claude'}]) {
      const request = make(session);
      jobs.push({name: `${cls}: affinity ${Object.keys(session)[0]}`, request, catalog: pools(request, facts(cls))});
    }
    if (cls === 'writer') {
      // A full read-only contract never reaches a writer node (R5).
      const request = make();
      jobs.push({name: 'writer: a full read-only contract', request, catalog: pools(request,
        facts(cls, {task_contract: contract(request)}))});
    } else {
      // A certificate whose per-answer format check this Core does not know
      // certifies nothing (R0 (c)).
      const request = make();
      jobs.push({name: `${cls}: an unknown certificate format check`, request, catalog: pools(request,
        facts(cls, {class_certificates: {[cls]: certificate({format_check: 'exact_json'})}}))});
    }
  }
  const expectReference = results => {
    for (const {name, done, tuples} of results) {
      assert.equal(done.state, 'completed', `${name}: ${done.error}`);
      assert.equal(tuples.length, 1, name);
      assert.ok(REFERENCE_TUPLES.has(tuples[0]), `${name}: bound ${tuples[0]}`);
      assert.match(done.children[0].routing_decision.reason, /;admitted_reference_uncertified;/, name);
      assert.equal(done.children[0].routing_decision.ladder, undefined, name);
    }
  };
  expectReference(await bulk(t, dir, jobs));
  // Verifiers registered for any family but the certified one certify
  // nothing (R0 (b)); a reference node they cover is still checked.
  const other = async () => ({passed: true, reason: 'fixture'});
  const elsewhere = new Map(['deep:read_only:agent', 'deep:read_only:chat', 'deep:workspace_write:agent',
    'trivial:workspace_write:agent', 'unclassified:read_only:agent'].map(family => [family, other]));
  expectReference(await bulk(t, dir, Object.entries(KINDS).map(([cls, make]) => {
    const request = make();
    return {name: `${cls}: verifiers of other families`, request, catalog: pools(request, facts(cls))};
  }), {verifierRegistry: elsewhere}));
  // An injected plan's grade is accepted for its shape and ignored: a
  // 'trivial' node binds the reference like any other.
  const graded = async ({task: value}) => ({schema: 1, task_id: value.task_id, request_sha256: value.request_sha256,
    nodes: [{id: 'n', instruction: value.request, dependencies: [], kind: 'agent', route_class: 'trivial',
      scope: value.host_context.require_read_only ? 'read_only' : 'workspace_write',
      owned_paths: value.host_context.require_read_only ? [] : ['**'], context_refs: [...value.material_refs]}]});
  expectReference(await bulk(t, dir, Object.entries(KINDS).map(([cls, make]) => {
    const request = make();
    return {name: `${cls}: a trivial grade`, request, catalog: pools(request, facts(cls))};
  }), {plan: graded}));
});

test('a route never depends on ledger history: passes a descent recorded certify nothing once its source is gone', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'ledger-history');
  const lookup = () => task(dir, 'What does the interval rule in this workspace mean?');
  const start = async verifierRegistry => {
    const tickets = [];
    const runtime = await createRCCRuntime({stateDir, hostAutoPlan: true, ...(verifierRegistry ? {verifierRegistry} : {}),
      catalog: async value => pools(value, facts('readonly_lookup')),
      execute: async ticket => { tickets.push(ticket); return execution(ticket); }, verifyTask: verdict});
    const run = async request => { await runtime.submit(request);
      return runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000}); };
    return {runtime, tickets, run};
  };
  const certified = await start(await soundVerifier('fixture-answer', acceptsAnswer));
  for (let index = 0; index < 3; index++) assert.equal((await certified.run(lookup())).state, 'completed');
  assert.deepEqual(certified.tickets.map(tuple), Array(3).fill('codex:gpt-6-luna/low'));
  await certified.runtime.close();
  const records = (await readFile(join(stateDir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8')).trim().split('\n')
    .map(line => JSON.parse(line));
  assert.deepEqual(records.map(record => `${record.model}/${record.effort}:${record.verifier_outcome}`),
    Array(3).fill('gpt-6-luna/low:pass'));
  // K9: the certifier's pass on each attempt, a sound_full label.
  for (const record of await audited(stateDir))
    assert.deepEqual(basisOf(record), ['certified:verifier:fixture-answer', 'verifier:fixture-answer', 'pass',
      label('verifier:fixture-answer')]);
  const later = await start(null);
  t.after(async () => { await later.runtime.close(); });
  const done = await later.run(lookup());
  assert.equal(done.state, 'completed', done.error);
  assert.deepEqual(later.tickets.map(tuple), ['codex:gpt-6-astra/ultra']);
  assert.match(done.children[0].routing_decision.reason, /;admitted_reference_uncertified;/);
});

test('a certified descent that fails its check reruns once at the reference fixed at bind, whatever a later catalog prefers', async t => {
  const dir = await fixture(t);
  // (a) A contract-certified lookup: bound luna/low guarded by Codex's own
  // reference. Every later catalog pins Claude and scores fable highest,
  // which would bind fable max were the node bound now.
  const lookup = task(dir, 'What does the interval rule in this workspace mean?');
  const bindFacts = facts('readonly_lookup', {task_contract: contract(lookup)});
  const laterFacts = {...bindFacts, class_provider_pins: {readonly_lookup: 'claude'},
    quota_scores: {'claude-fable-5-1': 1_000_000_000, 'gpt-6-astra': 1}};
  const later = pools(lookup, laterFacts);
  assert.equal(decided(resolveRoutePlan(hostPlan(lookup, later), lookup, {...later, task_contract: undefined})
    .decisions.node_0), 'claude:claude-fable-5-1/max', 'bound now, the node would run fable max');
  const partial = (stateDir, ticket) => {
    const value = contractVerified(stateDir, ticket);
    return {...value, task_verified: false, task_quality: 'execution_only',
      operational_quality: {...value.operational_quality, coverage: 'partial', assessment_state: 'execution_only'}};
  };
  const contractRun = await auto(t, dir, lookup, calls => calls === 1 ? pools(lookup, bindFacts) : later,
    {execute: (ticket, stateDir, count) => count === 1 ? partial(stateDir, ticket) : execution(ticket)});
  assert.equal(contractRun.done.state, 'completed', contractRun.done.error);
  assert.ok(contractRun.catalogCalls() >= 2, 'the later catalog was observed before the escalation');
  const atBind = contractRun.runtime.events({schema: 1, task_id: lookup.task_id})
    .find(event => event.kind === 'plan_admitted').snapshot.children[0].routing_decision;
  assert.deepEqual(atBind.ladder, {cheap_model: 'gpt-6-luna', cheap_effort: 'low', reference_model: 'gpt-6-astra',
    reference_effort: 'ultra'});
  assert.match(atBind.reason, /;escalation_reference_same_pool;/);
  assert.deepEqual(contractRun.tuples, ['codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra']);
  assert.equal(contractRun.tickets[1].candidate_id, 'astra-ultra');
  assert.equal(contractRun.events.filter(kind => kind === 'ladder_escalated_to_reference').length, 1);
  assert.match(contractRun.done.children[0].routing_decision.reason,
    /^tier_escalated_after_failure_signal;route_reference;admitted_reference_escalation;tier_frontier;same_pool;/);
  assert.equal(contractRun.done.result.output, 'answer');

  // (b) A class-certified chat answer bound while Codex's reference could not
  // run: its one escalation is Claude's chat reference, fixed then. Later
  // catalogs have astra back, pinned and scored first: the rerun still goes
  // to the reference admitted with the plan.
  const chat = task(dir, 'co가 무슨 뜻이야?');
  const signed = facts('chat_explanatory', {class_certificates: {chat_explanatory: certificate()}});
  const down = pools(chat, signed, {rows: [...CODEX_ROWS().map(c => c.model === 'gpt-6-astra' ?
    {...c, availability: 'unavailable'} : c), ...CLAUDE_ROWS()]});
  const back = pools(chat, {...signed, class_provider_pins: {chat_explanatory: 'codex'},
    quota_scores: {'gpt-6-astra': 1_000_000_000, 'claude-fable-5-1': 1}}, {rows: [...CODEX_ROWS(), ...CLAUDE_ROWS()]});
  assert.equal(decided(resolveRoutePlan(hostPlan(chat, back), chat, {...back, class_certificates: undefined})
    .decisions.node_0), 'codex:gpt-6-astra/ultra', 'bound now, the node would run astra ultra');
  const classRun = await auto(t, dir, chat, calls => calls === 1 ? down : back,
    {execute: (ticket, _stateDir, count) => count === 1 ? {...execution(ticket), output: ' \n '} : execution(ticket)});
  assert.equal(classRun.done.state, 'completed', classRun.done.error);
  assert.match(classRun.runtime.events({schema: 1, task_id: chat.task_id}).find(event => event.kind === 'plan_admitted')
    .snapshot.children[0].routing_decision.reason, /^resolver;route_tier;admitted_certified_class:cert-chat-1;.*;escalation_reference_other_pool;/);
  assert.deepEqual(classRun.tuples, ['codex:gpt-6-luna/low', 'claude-chat:claude-fable-5-1/max']);
  assert.equal(classRun.tickets[1].candidate_id, 'chat-fable-max');
  assert.equal(classRun.events.filter(kind => kind === 'ladder_escalated_to_reference').length, 1);
  assert.match(classRun.done.children[0].routing_decision.reason, /;admitted_reference_escalation;tier_frontier;other_pool;/);
});

test('R9 under every certifying source: a partial, unverified or mismatched operational check is never acceptance', async t => {
  const dir = await fixture(t);
  const checked = (stateDir, ticket, patch) => {
    const value = contractVerified(stateDir, ticket);
    return {...value, task_verified: false, task_quality: patch.assessment_state === 'mismatch' ? 'failed' : 'execution_only',
      operational_quality: {...value.operational_quality, ...patch}};
  };
  const checks = {partial: {coverage: 'partial', assessment_state: 'execution_only'},
    unverified: {coverage: 'full', assessment_state: 'unverified'},
    mismatch: {coverage: 'full', assessment_state: 'mismatch', failed_check_ids: ['public-test']}};
  // (b) a registered verifier that passes the fixture's answer; (c) a
  // certificate whose format check the answer meets. Neither adopts a
  // failed check.
  const verifierRegistry = await soundVerifier('fixture-answer', acceptsAnswer);
  const sources = {
    verifier: request => [pools(request, facts('readonly_lookup')), verifierRegistry],
    class: request => [pools(request, facts('readonly_lookup', {class_certificates: {readonly_lookup: certificate()}})), undefined],
  };
  for (const [source, admit] of Object.entries(sources)) for (const [name, patch] of Object.entries(checks)) {
    const lookup = task(dir, 'What does the interval rule in this workspace mean?');
    const [value, verifierRegistry] = admit(lookup);
    const result = await auto(t, dir, lookup, value, {verifierRegistry, execute: (ticket, stateDir, count) =>
      count === 1 ? checked(stateDir, ticket, patch) : execution(ticket)});
    const label = `${source}: ${name}`;
    assert.equal(result.done.state, 'completed', `${label}: ${result.done.error}`);
    assert.deepEqual(result.tuples, ['codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra'], label);
    assert.equal(result.events.filter(kind => kind === 'ladder_escalated_to_reference').length, 1, label);
    assert.equal(result.done.result.output, 'answer', label);
  }
});

test('exact arithmetic route test: each named surface runs its cheapest tier, certified by the exact result', async t => {
  const dir = await fixture(t);
  const routes = [{surface: 'codex', instruction: '2+2'}, {surface: 'claude', instruction: '1+1'},
    {surface: 'claude-chat', instruction: '3*3'}];
  const request = () => withHost(task(dir, 'Codex 2+2, Claude Code 1+1, Claude chat 3*3', {mode: 'explicit_routing_test'}),
    {explicit_routes: routes});
  const exact = {'2+2': '4', '1+1': '2', '3*3': '9'};
  const right = ticket => ({...execution(ticket), output: exact[ticket.instruction]});
  const first = request();
  const passed = await auto(t, dir, first, pools(first, facts('explicit_route'),
    {rows: [...CODEX_ROWS(), ...CLAUDE_ROWS()]}), {execute: right});
  assert.equal(passed.done.state, 'completed', passed.done.error);
  assert.deepEqual(passed.tickets.map(tuple), ['codex:gpt-6-luna/low', 'claude:claude-haiku-4-5/none',
    'claude-chat:claude-haiku-4-5/none']);
  assert.ok(passed.done.children.every(child => /;admitted_certified_exact;/.test(child.routing_decision.reason)));
  // K9: an explicit route test's exact descent is certified:exact by its route kind.
  const exactRecords = await audited(passed.stateDir);
  assert.equal(exactRecords.length, 3);
  for (const record of exactRecords) {
    assert.deepEqual(basisOf(record), ['certified:exact', 'exact_arithmetic_v1', 'pass', label('exact_arithmetic_v1')]);
    assert.deepEqual([record.route_kind, record.host_route_kind, record.verifier_outcome],
      ['explicit_route', 'tier', 'not_registered']);
  }
  // A wrong cheap answer is never delivered: that route escalates once to its
  // own surface's reference; a model word on a route still binds the owner's tuple.
  const wrongOnCodex = ticket => ({...execution(ticket),
    output: ticket.selected_config.model === 'gpt-6-luna' ? '5' : exact[ticket.instruction]});
  const second = request();
  const escalated = await auto(t, dir, second, pools(second, facts('explicit_route'),
    {rows: [...CODEX_ROWS(), ...CLAUDE_ROWS()]}), {execute: wrongOnCodex});
  assert.equal(escalated.done.state, 'completed', escalated.done.error);
  assert.deepEqual(escalated.tickets.map(tuple).sort(), ['claude-chat:claude-haiku-4-5/none',
    'claude:claude-haiku-4-5/none', 'codex:gpt-6-astra/ultra', 'codex:gpt-6-luna/low']);
  assert.match(escalated.done.output ?? escalated.done.result?.output ?? JSON.stringify(escalated.done), /4/);
  const escalatedRecords = await audited(escalated.stateDir);
  const luna = escalatedRecords.find(record => record.model === 'gpt-6-luna');
  assert.deepEqual(basisOf(luna), ['certified:exact', 'exact_arithmetic_v1', 'not_returned',
    label('exact_arithmetic_v1', 'not_returned')]);
  assert.deepEqual([luna.attempt_state, luna.escalation_outcome], ['ladder_not_returned', 'escalated']);
  assert.deepEqual(basisOf(escalatedRecords.find(record => record.model === 'gpt-6-astra')),
    ['reference_escalated', null, null, null]);
  // The ledger names the check, never the exact answer or the instructions.
  const ledgerText = await readFile(join(escalated.stateDir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8');
  for (const forbidden of ['exact_answer', '2+2', '1+1', '3*3', 'Claude chat'])
    assert.ok(!ledgerText.includes(forbidden), forbidden);
  assert.equal(admittedRoute({id: 'requested-1', instruction: 'Explain the interval rule.', kind: 'agent',
    scope: 'read_only', dependencies: []}, withHost(task(dir, 'x', {mode: 'explicit_routing_test'}),
    {explicit_routes: [{surface: 'codex', instruction: 'Explain the interval rule.'}]}), {}).source, 'owner_words');
});
