// K7: Core's zero-model closed arithmetic (os1-closed-arithmetic-v1) against
// the shared vector file, end to end through Core with fake callbacks that
// count and throw. No catalog, planner, provider, network or model call.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CLOSED_ARITHMETIC_LIMITS, admittedRoute, createRCCRuntime, exactArithmeticQuestion, hostContextFingerprint,
  zeroModelArithmetic} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {arithmeticResult} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';

const VECTORS = JSON.parse(readFileSync(new URL('./rcc-arithmetic-vectors.json', import.meta.url), 'utf8'));
const sha = text => createHash('sha256').update(text).digest('hex');
const BARE = '{"format":"os1-session-handoff-v3","transcript":""}';

async function stateDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-exact-arithmetic-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request, extras = {}) {
  const policyText = 'RCC exact arithmetic fixture policy.';
  const host = {workspace: dir, context: extras.hostContext ?? null, provider_preference: extras.provider ?? 'auto',
    codex_session_id: extras.codexSession ?? null, claude_session_id: extras.claudeSession ?? null,
    require_read_only: true, owner_policy: null};
  const input = {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: extras.mode ?? 'auto',
    material_refs: extras.materialRefs ?? [], host_context: host,
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000},
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
  if (extras.context !== undefined) input.context = extras.context;
  return input;
}
async function countingRuntime(t) {
  const dir = await stateDir(t), calls = {catalog: 0, plan: 0, execute: 0};
  const runtime = await createRCCRuntime({stateDir: dir,
    catalog: async () => { calls.catalog++; throw Error('fake catalog: the models would answer'); },
    plan: async () => { calls.plan++; throw Error('must not plan'); },
    execute: async () => { calls.execute++; throw Error('must not execute'); }});
  t.after(async () => { await runtime.close(); });
  const run = async (input) => {
    await runtime.submit(input);
    return runtime.wait({schema: 1, task_id: input.task_id}, {timeoutMs: 10_000});
  };
  return {dir, runtime, calls, run};
}
function assertLocalExact(runtime, input, done, expected, label) {
  assert.equal(done.state, 'completed', label);
  assert.equal(done.result.output, expected, label);
  assert.equal(done.result.task_verified, true, label);
  assert.equal(done.children.length, 1, label);
  const [child] = done.children;
  assert.deepEqual([child.id, child.candidate_id, child.instruction], ['local-core', 'local-core', input.request], label);
  assert.deepEqual([child.selected_config.surface, child.selected_config.model, child.selected_config.effort],
    ['local', 'none', 'none'], label);
  assert.equal(runtime._load(input.task_id).plan_provenance, 'deterministic_no_model', label);
  assert.ok(runtime.events({schema: 1, task_id: input.task_id}).some(x => x.kind === 'deterministic_arithmetic'), label);
}

test('every shared vector: the runtime expression returns exactly the expected canonical answer or abstains', () => {
  assert.equal(VECTORS.schema, 1);
  assert.equal(VECTORS.grammar, 'os1-closed-arithmetic-v1');
  assert.deepEqual(VECTORS.limits, {...CLOSED_ARITHMETIC_LIMITS});
  assert.ok(VECTORS.vectors.length >= 120);
  assert.equal(new Set(VECTORS.vectors.map(x => x.input)).size, VECTORS.vectors.length, 'no duplicate input');
  for (const {input, expected, why} of VECTORS.vectors) {
    assert.ok(typeof input === 'string' && (expected === null || typeof expected === 'string') && typeof why === 'string');
    assert.equal(zeroModelArithmetic(input), expected, JSON.stringify(input) + ' — ' + why);
    if (expected !== null) {
      // Canonical: no '+', no leading zero, no trailing fraction zero, no
      // '-0', no exponent or grouping, at most the output digit cap.
      assert.match(expected, /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/, input);
      assert.ok(expected !== '-0' && expected.replace(/[^0-9]/g, '').length <= CLOSED_ARITHMETIC_LIMITS.output_digits);
    }
  }
  for (const value of [null, undefined, 7, {}, ['1+1']]) assert.equal(exactArithmeticQuestion(value), null, String(value));
});

test('Core answers every accepted vector with no model; every other vector reaches the catalog (null context)', async t => {
  const {runtime, calls, run, dir} = await countingRuntime(t);
  const vectors = VECTORS.vectors.filter(x => x.input.trim() !== '');
  let routed = 0;
  for (const {input: request, expected} of vectors) {
    const input = task(dir, request), done = await run(input);
    if (expected === null) {
      routed++;
      assert.equal(done.state, 'held', JSON.stringify(request));
      assert.equal(calls.catalog, routed, 'an abstained request goes to the catalog: ' + JSON.stringify(request));
    } else assertLocalExact(runtime, input, done, expected, JSON.stringify(request));
  }
  assert.ok(routed > 30 && vectors.length - routed > 60);
  assert.deepEqual([calls.plan, calls.execute], [0, 0], 'no planner or model call');
});

test('R1 is unchanged: context, a resumable session, an attachment, a provider or an explicit route keeps the models', async t => {
  const {calls, run, dir} = await countingRuntime(t);
  const accepted = ['1+2*3', '7/2는 얼마야?', '1.5+1은?', '10 나누기 4', 'what is 10 divided by 4?'];
  for (const request of accepted) {
    assert.notEqual(zeroModelArithmetic(request), null);
    const cases = [task(dir, request, {hostContext: 'Owner: 1+1 상품은 3,500원, 2+1 상품은 4,800원.'}),
      task(dir, request, {context: 'USER: 이 표의 10/25는 날짜야.'}),
      task(dir, request, {codexSession: randomUUID()}), task(dir, request, {claudeSession: randomUUID()}),
      task(dir, request, {materialRefs: ['attached-source.png']}), task(dir, request, {provider: 'codex'})];
    const topLevel = task(dir, request); topLevel.provider_preference = 'claude';
    cases.push(topLevel);
    for (const input of cases) {
      const before = calls.catalog, done = await run(input);
      assert.equal(done.state, 'held', request);
      assert.equal(calls.catalog, before + 1, 'reaches the catalog: ' + request);
    }
    const explicit = await run(task(dir, request, {mode: 'explicit_routing_test'}));
    assert.equal(explicit.state, 'held');
    assert.equal(explicit.error, 'explicit_route_contract_missing');
  }
  assert.deepEqual([calls.plan, calls.execute], [0, 0]);
});

test('the explicit-route exact family stays the one-operator pureArithmetic shape', () => {
  const route = instruction => {
    const node = {id: 'requested-1', instruction, kind: 'agent', scope: 'read_only', dependencies: [],
      owned_paths: [], context_refs: []};
    const explicit = {mode: 'explicit_routing_test', host_context: {explicit_routes: [{surface: 'codex', instruction}]}};
    return admittedRoute(node, explicit, {});
  };
  assert.deepEqual(route('1+1'), {class: 'certified', source: 'exact', certificate_id: null});
  assert.equal(arithmeticResult('1+1'), '2');
  // '6/3' abstains in both grammars (bare ASCII '/'); the others are new
  // zero-model answers that must not become certified explicit routes.
  for (const instruction of ['1+2*3', '6/3', '6÷3', '1.5+1', '1+1+1', '(1+2)*3', '10 나누기 4']) {
    assert.equal(zeroModelArithmetic(instruction) === null, instruction === '6/3', instruction);
    assert.notDeepEqual(route(instruction), {class: 'certified', source: 'exact', certificate_id: null}, instruction);
    assert.equal(route(instruction).class, 'reference', instruction);
    assert.equal(arithmeticResult(instruction), null, instruction);
  }
});

test('a bare v3 envelope is a first turn only at the zero-model sites; any other state stays held', async t => {
  const {runtime, calls, run, dir} = await countingRuntime(t);
  const conversation = randomUUID();
  const withSource = '{"format":"os1-session-handoff-v3","transcript":"","source":null}';
  const firstTurns = [task(dir, '1+2*3', {hostContext: BARE}), task(dir, '7/2는 얼마야?', {context: BARE}),
    task(dir, '1+1이 뭐야?', {hostContext: withSource}), task(dir, '0.1+0.2=', {hostContext: BARE, context: BARE})];
  for (const input of firstTurns) {
    const done = await run(input);
    assertLocalExact(runtime, input, done, zeroModelArithmetic(input.request), input.request);
    assert.equal(runtime._load(input.task_id).task.host_context.context, input.host_context.context, 'bytes kept');
  }
  assert.equal(calls.catalog, 0);
  const fresh = {schemaVersion: 1, conversationID: conversation, objectiveID: randomUUID(),
    createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z', contextRevision: 1,
    project: {projectID: 'fixture-project', workspace: dir},
    objective: {requestText: '1+2*3', kind: 'other', scope: 'read_only',
      prohibitions: [], pendingDecisions: [], completionConditions: []},
    facts: [], sources: [], bindings: [], executions: [], decisions: [], blockers: [], nextSteps: []};
  const paging = {snapshot: {kind: 'snapshot', id: randomUUID(), sha256: sha('fixture only')},
    conversationID: conversation, projectID: 'fixture-project', archivedMessages: 1, allowedSessionIDs: [conversation]};
  const held = [
    JSON.stringify({format: 'os1-session-handoff-v3', transcript: '', taskContext: fresh}),
    JSON.stringify({format: 'os1-session-handoff-v3', transcript: '', memoryPaging: paging}),
    '{"format":"os1-session-handoff-v3","transcript":"","priorMessageCount":null}',
    '{"format":"os1-session-handoff-v3","transcript":"","priorMessageCount":"0"}',
    '{"format":"os1-session-handoff-v3","transcript":"","priorMessageCount":1}',
    '{"format":"os1-session-handoff-v3","transcript":" "}',
    '{"format":"os1-session-handoff-v3","transcript":"USER: 10/25는 날짜야"}',
    '{"format": "os1-session-handoff-v3","transcript":""}',
    '{"format":"os1-session-handoff-v3","transcript":"" }',
    '{"format":"os1-session-handoff-v2","transcript":""}',
    '{"format":"os1-session-handoff-v3","transcript":"","source":{"kind":"snapshot"}}',
    '{"format":"os1-session-handoff-v3","transcript":"","futureState":0}'];
  let expected = 0;
  for (const raw of held) {
    const input = task(dir, '1+2*3', {hostContext: raw});
    input.host_context.conversation_id = conversation;
    input.source_fingerprint = hostContextFingerprint(input.host_context);
    const done = await run(input);
    assert.equal(done.state, 'held', raw);
    assert.equal(calls.catalog, ++expected, 'unknown or retained history reaches the models: ' + raw);
  }
  // A non-arithmetic request in the same bare envelope is not answered by
  // Core: the envelope proves no history, it never authorizes an answer.
  const prose = await run(task(dir, 'Explain the interval rule.', {hostContext: BARE}));
  assert.equal(prose.state, 'held');
  assert.deepEqual([calls.plan, calls.execute], [0, 0]);
});

test('exact rationals: no binary floating point, no rounding, no float drift', () => {
  for (const [request, answer] of [['0.1+0.2=', '0.3'], ['1/3+2/3=', '1'], ['2/0.5=', '4'],
    ['999999999999999*999999999999999', '999999999999998000000000000001'], ['0.7*3=', '2.1'],
    ['1.1*1.1=', '1.21'], ['100/8=', '12.5'], ['-7/4=', '-1.75'], ['1/3=', null], ['2/3*3/2=', '1'],
    ['1/7*7=', '1'], ['10/3-1/3=', '3'], ['0.000000000000001*0.000000000000001=', '0.000000000000000000000000000001']])
    assert.equal(zeroModelArithmetic(request), answer, request);
});

test('the offline replay compares recorded answers by value and never prints request or output text', async () => {
  const {replayArithmetic, statedNumber} = await import('../arithmetic-replay.mjs');
  for (const [output, number] of [['3', '3'], ['답은 3입니다.', '3'], ['**2.5**', '2.5'], ['1+2 = 3', '3'],
    ['Ben.\nLuaIsHere :3\n`42`', '42'], ['The answer is 7', '7'], ['three', null], ['3 apples', null]])
    assert.equal(statedNumber(output), number, output);
  const row = (request, children, output, mode = 'auto') => ({task_id: 'task-' + randomUUID(), snapshot: JSON.stringify({
    task: {mode, request, request_sha256: sha(request)}, children: children.map(id => ({id})),
    result: output === undefined ? null : {output}})});
  const rows = [row('1+1이 뭐야?', ['local-core'], '2'), row('1.5+1은?', ['node_0'], '답은 2.5입니다.'),
    row('7/2는 얼마야?', ['node_0'], 'It is 3 and a half.'), row('Explain the interval rule.', ['node_0'], 'prose'),
    row('1+2*3', ['requested-1'], '7', 'explicit_routing_test'), row('10 나누기 4', ['node_0'], undefined),
    {task_id: 'task-broken', snapshot: '{'}];
  const gated = [];
  const pass = await replayArithmetic(rows, async task => { gated.push(task.request); return task.request !== '7/2는 얼마야?'; });
  assert.equal(pass.verdict, 'PASS'); assert.equal(pass.exit_code, 0);
  assert.deepEqual(pass.counts, {tasks: 7, unreadable: 1, auto: 5, accepted: 4, local_core: {identical: 1, different: 0},
    model: {equal: 1, different: 0, unparsed: 1, undelivered: 1}, gate: {zero_model: 3, routed: 1, rejected: 0},
    would_turn_zero_model: 2});
  assert.deepEqual(gated.sort(), ['1+1이 뭐야?', '1.5+1은?', '10 나누기 4', '7/2는 얼마야?'].sort());
  const text = JSON.stringify(pass);
  for (const secret of ['이 뭐야', '2.5입니다', 'half', 'interval', 'prose']) assert.ok(!text.includes(secret), secret);
  const fail = await replayArithmetic([row('1+1이 뭐야?', ['local-core'], '3'), row('2+2는?', ['node_0'], '5')],
    async () => { throw Error('rejected'); });
  assert.equal(fail.verdict, 'FAIL'); assert.equal(fail.exit_code, 1);
  assert.deepEqual(fail.findings.map(x => x.finding).sort(),
    ['gate_rejected', 'gate_rejected', 'local_core_answer_changed', 'model_answer_differs']);
  const none = await replayArithmetic([row('Explain it.', ['node_0'], 'prose')], async () => true);
  assert.equal(none.verdict, 'NO_EVIDENCE'); assert.equal(none.exit_code, 2);
});
