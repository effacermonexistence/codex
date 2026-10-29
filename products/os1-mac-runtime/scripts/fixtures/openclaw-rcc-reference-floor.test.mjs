// Build 407-g reference floor (R6): the completed output of a node bound at
// the reference (or at an owner-chosen tuple) is the floor. A partial check
// that fails, or a checker that is unavailable, delivers that output with a
// quality disclosure (returned_unverified), never a hold or a null result;
// only an owner-declared local-only contract runs its one same-row writer
// correction first. Holds remain for reported effects, unterminated turns,
// nothing returned and cancel. A certified descent's failed check is R9
// instead: one rerun at its reference, whose own result is then the floor.
// Real durable runtime with host-built plans and a fake executor that writes
// its native receipts: no provider, model, network or HOME state.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRCCRuntime, hostContextFingerprint } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const policyText = 'RCC reference-floor fixture policy: candidates do not grant authority.';
async function directory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-reference-floor-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request, {write = false, mode = 'auto', routes = null} = {}) {
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: !write, owner_policy: null, ...(routes ? {explicit_routes: routes} : {})};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode, material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, surface, model, effort, scope = 'read_only') {
  const now = Date.now();
  const codex = surface === 'codex';
  return {id, surface, transport: codex ? 'codex_app_server' : 'claude_cli', account_id: 'account-1', model, effort,
    tools: surface.endsWith('-chat') ? [] : scope === 'read_only' ? ['read', 'execute'] : ['read', 'write', 'execute'],
    scope, permission_profile: scope, quota_pool: codex ? 'openai_codex' : 'anthropic_shared',
    allowed_paths: scope === 'workspace_write' ? ['**'] : [], configuration_sha256: sha('config:' + id),
    availability: 'available', availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 60_000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 60_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
const CODEX = () => [row('luna-low', 'codex', 'gpt-6-luna', 'low'), row('astra-low', 'codex', 'gpt-6-astra', 'low'),
  row('astra-ultra', 'codex', 'gpt-6-astra', 'ultra'), row('astra-ultra-w', 'codex', 'gpt-6-astra', 'ultra', 'workspace_write')];
const CLAUDE = () => [row('haiku', 'claude', 'claude-haiku-4-5', 'none'), row('fable-max', 'claude', 'claude-fable-5-1', 'max'),
  row('fable-max-w', 'claude', 'claude-fable-5-1', 'max', 'workspace_write'),
  row('chat-fable-max', 'claude-chat', 'claude-fable-5-1', 'max')];
const TIERS = {'gpt-6-luna': 'fast', 'gpt-6-astra': 'frontier', 'claude-haiku-4-5': 'fast', 'claude-fable-5-1': 'frontier'};
function catalog(request, extra = {}, {claudeFirst = false} = {}) {
  const explicit = request.mode === 'explicit_routing_test';
  const claude = CLAUDE().filter(c => explicit || c.surface !== 'claude-chat');
  const write = !request.host_context.require_read_only;
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    candidates: claudeFirst ? [...claude, ...CODEX()] : [...CODEX(), ...claude], model_tiers: TIERS,
    owner_scope: write ? 'workspace_write' : 'read_only', chat_lane_eligible: false,
    request_class: explicit ? 'explicit_route' : write ? 'writer' : 'readonly_lookup', ...extra};
}
const contract = request => ({coverage: 'full', scope: 'read_only', objective_sha256: request.request_sha256,
  contract_sha256: sha('contract'), context_sha256: sha(''), start_tree_sha256: sha('tree'),
  reference_policy_sha256: request.policy_sha256, valid_until_ms: Date.now() + 600_000, bindings_checked: true});

// The native adapter's records (main.swift rcc-adapter): a writer that changed
// files reports confirmed effects; a read-only answer none.
function execution(ticket, output = 'reference output') {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched',
    side_effects: ticket.selected_config.scope === 'workspace_write' ? 'confirmed' : 'none', output,
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: null, native_turn_terminated: true, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: JSON.stringify({node: ticket.node_id})};
}
function descriptor(stateDir, ticket, patch = {}) {
  return {schema: 1, coverage: 'partial', assessment_state: 'mismatch', contract_sha256: sha('contract'),
    witness_path: join(stateDir, 'quality-witnesses', ticket.attempt_id + '.json'), witness_sha256: sha('witness'),
    artifact_sha256: sha(ticket.attempt_id), workspace_after_sha256: sha('tree'), failed_check_ids: ['public-test'],
    corrective_attempts: ticket.quality_continuation ? 1 : 0, local_only_verified: false, ...patch};
}
// An auto-discovered partial check that failed (TaskQualityRuntime's
// README-unittest snapshot), as the adapter reports it.
const mismatch = (stateDir, ticket, failed, output) => ({...execution(ticket, output), task_quality: 'failed',
  error: 'native_operational_quality_mismatch', operational_quality: descriptor(stateDir, ticket, {failed_check_ids: failed})});
// The checker or its custody could not run: the adapter keeps the answer.
const unavailable = (stateDir, ticket, q = null, output) => ({...execution(ticket, output), task_quality: 'unverified',
  error: 'native_operational_quality_unverified', ...(q ? {operational_quality: q} : {})});

// A parent verifier that would bless anything: it never washes a disclosure.
const blessing = ({task: value, children}) => ({schema: 1, task_id: value.task_id, task_verified: true,
  output: children.map(c => c.output ?? '').join('\n'), parity_state: 'unverified', reason: 'fixture_parent_blesses'});

async function floor(t, request, value, {execute, decide = null, verifyTask = blessing, cancelGate = null} = {}) {
  const stateDir = join(await directory(t), 'state');
  await mkdir(stateDir, {mode: 0o700});
  await mkdir(join(stateDir, 'native-receipts'), {mode: 0o700});
  await mkdir(join(stateDir, 'quality-witnesses'), {mode: 0o700});
  const tickets = [];
  let catalogCalls = 0;
  const runtime = await createRCCRuntime({stateDir, hostAutoPlan: true,
    plan: async () => { throw Error('Auto must not call plan()'); },
    catalog: async () => { catalogCalls++; return typeof value === 'function' ? value(catalogCalls) : value; },
    execute: async ticket => {
      tickets.push(ticket);
      await cancelGate?.(ticket);
      const record = execute(ticket, stateDir, tickets.length);
      // The adapter's durable native receipt is the record itself (0600).
      record.native_receipt = join(stateDir, 'native-receipts', ticket.attempt_id + '.json');
      await writeFile(record.native_receipt, JSON.stringify(record), {mode: 0o600, flag: 'wx'});
      return record;
    },
    ...(decide ? {decideOperationalQuality: decide(stateDir)} : {}), verifyTask});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  if (cancelGate?.started) { await cancelGate.started; await runtime.cancel({schema: 1, task_id: request.task_id}); cancelGate.release(); }
  const done = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
  const events = runtime.events({schema: 1, task_id: request.task_id}).map(event => event.kind);
  return {runtime, done, tickets, events, child: runtime._load(request.task_id).children[0],
    tuples: tickets.map(ticket => `${ticket.selected_config.surface}:${ticket.selected_config.model}/${ticket.selected_config.effort}`)};
}
function expectDisclosed(result, {output = 'reference output', disclosure, name = ''} = {}) {
  const {done} = result;
  assert.equal(done.state, 'returned_unverified', `${name}: ${done.error}`);
  assert.equal(done.error, 'child_quality_disclosed', name);
  assert.equal(done.result.output, output, `${name}: the completed reference output is delivered`);
  assert.equal(done.result.task_verified, false, `${name}: no parent verifier washes a disclosure`);
  assert.equal(done.result.parity_state, 'unverified', name);
  assert.equal(done.children[0].state, 'completed', name);
  assert.deepEqual(done.children[0].quality_disclosure, disclosure, name);
  assert.equal(result.child.hold_reason, undefined, `${name}: never held`);
  assert.ok(!result.events.includes('operational_checker_held') && !result.events.includes('quality_continuation_held'), name);
  assert.ok(!result.events.includes('ladder_escalated_to_reference'), `${name}: a reference result never escalates`);
}

test('a reference writer whose auto-discovered partial unittest check fails ends returned_unverified with the failed IDs, not held', async t => {
  const dir = await directory(t);
  const failed = ['unittest:tests/test_readme.py::ReadmeExamples::test_quickstart',
    'unittest:tests/test_cli.py::CliTest::test_help'];
  for (const claudeFirst of [false, true]) {
    const request = task(dir, 'Add the --verbose flag to cli.py as the README describes.', {write: true});
    const result = await floor(t, request, catalog(request, {}, {claudeFirst}),
      {execute: (ticket, stateDir) => mismatch(stateDir, ticket, failed)});
    assert.deepEqual(result.tuples, [claudeFirst ? 'claude:claude-fable-5-1/max' : 'codex:gpt-6-astra/ultra']);
    expectDisclosed(result, {name: `README-unittest writer${claudeFirst ? ', Anthropic' : ''}`,
      disclosure: {coverage: 'partial', failed_check_ids: failed, witness_sha256: sha('witness')}});
    assert.match(result.done.children[0].routing_decision.reason, /;admitted_reference_uncertified;/);
    assert.ok(result.events.includes('child_delivered_with_disclosure'));
  }
});

test("'change X and update tests' is not held: a stale partial snapshot or an unbindable checker delivers the reference output", async t => {
  const dir = await directory(t);
  const text = "Change the greeting to 'Hi' and update the tests.";
  // The pre-change test snapshot fails the requested new behaviour.
  const stale = task(dir, text, {write: true});
  expectDisclosed(await floor(t, stale, catalog(stale), {execute: (ticket, stateDir) =>
    mismatch(stateDir, ticket, ['unittest:tests/test_greeting.py::GreetingTest::test_hello'])}),
  {name: 'stale snapshot', disclosure: {coverage: 'partial',
    failed_check_ids: ['unittest:tests/test_greeting.py::GreetingTest::test_hello'], witness_sha256: sha('witness')}});
  // The updated tests no longer bind the checker's custody: no verdict.
  const unbound = task(dir, text, {write: true});
  expectDisclosed(await floor(t, unbound, catalog(unbound), {execute: (ticket, stateDir) =>
    unavailable(stateDir, ticket, descriptor(stateDir, ticket, {assessment_state: 'unverified', failed_check_ids: []}))}),
  {name: 'unbindable checker', disclosure: {coverage: 'partial', failed_check_ids: [], witness_sha256: sha('witness'),
    checker: 'unavailable'}});
});

test('checker unavailable: a completed reference answer or writer is delivered with checker unavailable', async t => {
  const dir = await directory(t);
  for (const write of [false, true]) {
    const request = task(dir, write ? 'Fix the login bug in Sources/App.swift' : 'What does the interval rule mean?', {write});
    const result = await floor(t, request, catalog(request), {execute: (ticket, stateDir) => unavailable(stateDir, ticket)});
    assert.equal(result.tickets.length, 1, 'no retry, no replay');
    expectDisclosed(result, {name: write ? 'writer' : 'reader',
      disclosure: {coverage: null, failed_check_ids: [], witness_sha256: null, checker: 'unavailable'}});
  }
});

test('a read-only reference answer whose partial check mismatches is delivered with its disclosure; the same failure on a certified descent reruns once at the reference', async t => {
  const dir = await directory(t);
  const lookup = task(dir, 'What does the interval rule in this workspace mean?');
  const reference = await floor(t, lookup, catalog(lookup), {execute: (ticket, stateDir) =>
    mismatch(stateDir, ticket, ['interval-merge-check'])});
  assert.deepEqual(reference.tuples, ['codex:gpt-6-astra/ultra']);
  expectDisclosed(reference, {name: 'read-only reference', disclosure: {coverage: 'partial',
    failed_check_ids: ['interval-merge-check'], witness_sha256: sha('witness')}});
  // R9 vs R6: a contract-certified descent with that failure is discarded and
  // reruns once at its reference; the reference's own failure is the floor.
  const certified = task(dir, 'What does the interval rule in this workspace mean?');
  const descent = await floor(t, certified, catalog(certified, {task_contract: contract(certified)}),
    {execute: (ticket, stateDir, count) => mismatch(stateDir, ticket, ['interval-merge-check'],
      count === 1 ? 'descent output' : 'reference output')});
  assert.deepEqual(descent.tuples, ['codex:gpt-6-luna/low', 'codex:gpt-6-astra/ultra']);
  assert.equal(descent.events.filter(kind => kind === 'ladder_escalated_to_reference').length, 1);
  assert.equal(descent.done.state, 'returned_unverified', descent.done.error);
  assert.equal(descent.done.error, 'child_quality_disclosed');
  assert.equal(descent.done.result.output, 'reference output', 'the descent output is never delivered');
  assert.deepEqual(descent.done.children[0].quality_disclosure, {coverage: 'partial',
    failed_check_ids: ['interval-merge-check'], witness_sha256: sha('witness')});
});

test("an owner-chosen tuple is a floor too: its failed check discloses and never escalates", async t => {
  const dir = await directory(t);
  // "astra low로": the owner's family and effort words bind astra low.
  const words = task(dir, 'astra low로 이 저장소의 interval 규칙 설명해줘');
  const chosen = await floor(t, words, catalog(words, {routing_intent: {effort: 'low', model_family: 'astra'}}),
    {execute: (ticket, stateDir) => mismatch(stateDir, ticket, ['interval-merge-check'])});
  assert.deepEqual(chosen.tuples, ['codex:gpt-6-astra/low']);
  assert.match(chosen.done.children[0].routing_decision.reason, /^resolver;route_explicit;intent_effort_low;intent_family_astra;/);
  expectDisclosed(chosen, {name: 'owner words', disclosure: {coverage: 'partial', failed_check_ids: ['interval-merge-check'],
    witness_sha256: sha('witness')}});
  // A named route: delivered on the surface the owner named.
  const routes = [{surface: 'claude', instruction: 'Explain the interval rule.'}];
  const named = task(dir, 'Claude Code한테 interval 규칙 설명.', {mode: 'explicit_routing_test', routes});
  const route = await floor(t, named, catalog(named), {execute: (ticket, stateDir) =>
    unavailable(stateDir, ticket, null, 'route answer')});
  assert.deepEqual(route.tuples, ['claude:claude-fable-5-1/max']);
  assert.equal(route.done.state, 'returned_unverified', route.done.error);
  assert.equal(route.done.error, 'child_quality_disclosed');
  assert.equal(route.done.result.output, 'route answer');
  assert.deepEqual(route.done.children[0].quality_disclosure, {coverage: null, failed_check_ids: [], witness_sha256: null,
    checker: 'unavailable'});
});

test('only an owner-declared local-only contract runs its one same-row correction; when spent, the last output is delivered disclosed', async t => {
  const dir = await directory(t);
  const request = task(dir, 'Repair the declared local Python fixture and run its tests.', {write: true});
  const decide = stateDir => async x => {
    const parent = x.parent_ticket;
    return {schema: 1, task_id: parent.task_id, node_id: parent.node_id, parent_attempt_id: parent.attempt_id,
      action: 'correct', reason: 'trusted_local_checker_mismatch', quality_continuation: {schema: 1,
        parent_attempt_id: parent.attempt_id, parent_native_receipt: x.parent_native_receipt,
        parent_native_receipt_sha256: x.parent_native_receipt_sha256,
        witness_path: join(stateDir, 'quality-witnesses', parent.attempt_id + '.json'), witness_sha256: sha('witness'),
        expected_workspace_after_sha256: sha('tree'), original_instruction_sha256: sha(parent.instruction),
        corrective_attempts: 1}};
  };
  const result = await floor(t, request, catalog(request), {decide, execute: (ticket, stateDir) => ({
    ...mismatch(stateDir, ticket, ['public-test'], ticket.quality_continuation ? 'corrected output' : 'first output'),
    operational_quality: descriptor(stateDir, ticket, {local_only_verified: true})})});
  assert.deepEqual(result.tuples, ['codex:gpt-6-astra/ultra', 'codex:gpt-6-astra/ultra'], 'the same reference row');
  assert.ok(result.tickets[1].quality_continuation, 'the second attempt is the correction');
  expectDisclosed(result, {output: 'corrected output', name: 'spent correction', disclosure: {coverage: 'partial',
    failed_check_ids: ['public-test'], witness_sha256: sha('witness')}});
  assert.deepEqual(result.child.quality_history.map(entry => entry.output), ['first output', 'corrected output']);
  // Without the local-only boundary the same failure never replays.
  const plain = task(dir, 'Repair the declared local Python fixture and run its tests.', {write: true});
  let decisions = 0;
  const once = await floor(t, plain, catalog(plain), {decide: stateDir => async x => { decisions++; return decide(stateDir)(x); },
    execute: (ticket, stateDir) => mismatch(stateDir, ticket, ['public-test'], 'first output')});
  assert.equal(once.tickets.length, 1);
  assert.equal(decisions, 0);
  expectDisclosed(once, {output: 'first output', name: 'no boundary', disclosure: {coverage: 'partial',
    failed_check_ids: ['public-test'], witness_sha256: sha('witness')}});
});

test('holds remain for reported effects, an unterminated turn, nothing returned and cancel', async t => {
  const dir = await directory(t);
  const cases = [
    ['a read-only answer reporting effects', false, (stateDir, ticket) =>
      ({...mismatch(stateDir, ticket, ['public-test']), side_effects: 'possible'}), 'native_operational_quality_mismatch'],
    ['an unterminated native turn', true, (stateDir, ticket) =>
      ({...unavailable(stateDir, ticket), native_turn_terminated: false}), 'native_operational_quality_unverified'],
    ['no output', true, (stateDir, ticket) => unavailable(stateDir, ticket, null, ''), 'native_operational_quality_unverified'],
  ];
  for (const [name, write, record, reason] of cases) {
    const request = task(dir, write ? 'Fix the login bug in Sources/App.swift' : 'What does the interval rule mean?', {write});
    const result = await floor(t, request, catalog(request), {execute: (ticket, stateDir) => record(stateDir, ticket)});
    // The task names the hold reason (never child_quality_disclosed) and the
    // child stays held: its raw record is kept only as a labelled partial, as
    // before build 407, never delivered as the answer.
    assert.notEqual(result.done.state, 'completed', name);
    assert.equal(result.done.error, reason, name);
    assert.ok(result.done.result === null || (result.done.result.task_verified === false &&
      result.done.result.output.startsWith('node_0: ')), name);
    assert.equal(result.done.children[0].state, 'held', name);
    assert.equal(result.done.children[0].quality_disclosure, undefined, name);
    assert.equal(result.tickets.length, 1, `${name}: never replayed`);
  }
  // A cancel while the reference runs: its later result is never delivered.
  let started, release;
  const gate = async () => { started(); await new Promise(resolve => { release = resolve; }); };
  gate.started = new Promise(resolve => { started = resolve; });
  gate.release = () => release();
  const request = task(dir, 'Fix the login bug in Sources/App.swift', {write: true});
  const cancelled = await floor(t, request, catalog(request), {cancelGate: gate,
    execute: (ticket, stateDir) => mismatch(stateDir, ticket, ['public-test'])});
  assert.ok(['cancelled', 'effects_uncertain'].includes(cancelled.done.state), cancelled.done.state);
  assert.equal(cancelled.done.result, null);
  assert.equal(cancelled.done.children[0].quality_disclosure, undefined);
});
