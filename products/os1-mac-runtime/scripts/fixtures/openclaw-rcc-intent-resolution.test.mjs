// Core-owned routing interpretation: real SQLite lifecycle + injected pure
// compiler/executor fixtures. No model, provider, network, real HOME or UI.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createRCCRuntime, executionTask, hostContextFingerprint, intentResolutionFingerprint,
  LOCAL_WORKER_MODEL} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {routingIntentResolver} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ROUTES = [{surface: 'local', instruction: '1+1'}, {surface: 'codex', instruction: '2+2'}];
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'os1-core-intent-fixture-'));
  await chmod(directory, 0o700);
  t.after(async () => rm(directory, {recursive: true, force: true}));
  return directory;
}
function task(directory, text = '다 넘겨봐 1+1 2+2', {explicit = false, writable = true, duration = 10_000} = {}) {
  const policy = 'Fixture RCC: an interpretation is not user authority.';
  const host = {workspace: directory, context: null, provider_preference: 'auto',
    codex_session_id: null, claude_session_id: null, require_read_only: !writable, owner_policy: null};
  if (explicit) host.explicit_routes = structuredClone(ROUTES);
  return {schema: 1, task_id: randomUUID(), request: text, request_sha256: sha(text), objective: text,
    policy_sha256: sha(policy), source_fingerprint: hostContextFingerprint(host),
    mode: explicit ? 'explicit_routing_test' : 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: duration},
    host_context: host, policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policy), text: policy}};
}
function resolution(request, kind = 'routes', overrides = {}) {
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    policy_sha256: request.policy_sha256, source_fingerprint: request.source_fingerprint,
    kind, routes: kind === 'routes' ? structuredClone(ROUTES) : [], best_effort: false,
    notices: ['Core interpreted the original routing request.'], reason: kind === 'hold' ? 'fixture_intent_hold' : null,
    model_answer: null, ...overrides};
}
function row(id, surface) {
  const now = Date.now(), local = surface === 'local';
  return {id, surface, transport: local ? 'local' : 'codex_app_server', account_id: local ? 'os1-local' : 'fixture-account',
    model: local ? LOCAL_WORKER_MODEL : 'fixture-codex', effort: local ? 'none' : 'medium', tools: [],
    scope: 'read_only', permission_profile: 'read_only', quota_pool: local ? 'none' : 'openai_codex', allowed_paths: [],
    configuration_sha256: sha(id), availability: 'available', availability_observed_at_ms: now - 1,
    availability_valid_until_ms: now + 60_000, quota_remaining_fraction: local ? null : 0.8,
    quota_observed_at_ms: local ? null : now - 1, quota_valid_until_ms: local ? null : now + 60_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
function catalog(request) { return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
  candidates: [row('local-fixture', 'local'), row('codex-fixture', 'codex')]}; }
function plan(request) {
  const routes = request.mode === 'explicit_routing_test' ? request.host_context.explicit_routes :
    [{surface: 'codex', instruction: request.request}];
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    nodes: routes.filter(r => !r.skipped).map((route, index) => ({id: `node-${index + 1}`,
      instruction: route.instruction, dependencies: [], kind: 'agent',
      candidate_id: route.surface === 'local' ? 'local-fixture' : 'codex-fixture', scope: 'read_only',
      owned_paths: [], context_refs: []}))};
}
function execution(ticket) { return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id,
  attempt_id: ticket.attempt_id, candidate_id: ticket.candidate_id,
  configuration_sha256: ticket.configuration_sha256, selected_config: ticket.selected_config,
  acknowledged_config: ticket.selected_config, observed_config: null, status: 'succeeded',
  dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
  task_verified: true, task_quality: 'task_verified', parity_state: 'unverified', output: 'fixture answer',
  native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null}; }
function stored(directory, id) {
  const db = new DatabaseSync(join(directory, 'rcc-runtime.sqlite'), {readOnly: true});
  try { return JSON.parse(db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(id).snapshot); }
  finally { db.close(); }
}
function verifier({task, children}) { return {schema: 1, task_id: task.task_id, task_verified: true,
  output: children.map(child => child.output).join('\n'), parity_state: 'unverified', reason: 'fixture coverage'}; }
async function wait(runtime, request) { return runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5_000}); }
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await sleep(5); }
  throw Error('fixture wait expired');
}

test('same persisted Core task: resolution precedes catalog, immutable original, derived context on refresh/tickets/verifier', async t => {
  const directory = await fixture(t), request = task(directory), original = structuredClone(request), seen = [];
  let resolverCalls = 0, catalogCalls = 0;
  const readModelAnswer = '{"kind":"route_all"}';
  const compiled = resolution(request, 'routes', {best_effort: true, model_answer: readModelAnswer});
  const runtime = await createRCCRuntime({stateDir: directory,
    resolveIntent: async ({task: value, signal}) => {
      resolverCalls++; assert.ok(signal instanceof AbortSignal);
      assert.deepEqual(value, original);
      assert.equal(stored(directory, request.task_id).state, 'planning');
      value.request = 'mutation of compiler input copy only';
      return compiled;
    }, catalog: async value => { catalogCalls++; seen.push(value); return catalog(value); },
    plan: async ({task: value}) => { seen.push(value); return plan(value); },
    execute: async ticket => {
      assert.equal(ticket.task_id, request.task_id);
      assert.equal(ticket.original_request, original.request);
      assert.equal(ticket.host_context.require_read_only, true);
      assert.equal(ticket.host_context.provider_preference, 'auto');
      assert.equal(ticket.source_fingerprint, hostContextFingerprint(ticket.host_context));
      assert.equal(ticket.core_routing.original_source_fingerprint, original.source_fingerprint);
      assert.equal(ticket.core_routing.original_require_read_only, false);
      assert.equal(ticket.core_routing.model_answer, readModelAnswer);
      assert.equal(ticket.core_routing.resolution_sha256, intentResolutionFingerprint(original, compiled));
      return execution(ticket);
    }, verifyTask: value => { seen.push(value.task); return verifier(value); }});
  t.after(async () => runtime.close());
  await runtime.submit(request);
  const result = await wait(runtime, request);
  assert.equal(result.state, 'completed');
  assert.equal(result.children.length, 2);
  assert.equal(resolverCalls, 1); assert.ok(catalogCalls >= 2, 'pre-dispatch catalog refresh occurred');
  for (const value of seen) {
    assert.equal(value.mode, 'explicit_routing_test');
    assert.equal(value.source_fingerprint, hostContextFingerprint(value.host_context));
    assert.deepEqual(value.host_context.explicit_routes, ROUTES);
    assert.equal(value.host_context.explicit_routes_best_effort, true);
    assert.equal(Object.hasOwn(value, 'provider_preference'), false, 'no absent optional mirror invented');
  }
  const snapshot = stored(directory, request.task_id);
  assert.deepEqual(request, original); assert.deepEqual(snapshot.task, original);
  assert.notEqual(snapshot.effective_task.source_fingerprint, original.source_fingerprint);
  assert.deepEqual(snapshot.intent_resolution, compiled);
  assert.deepEqual(executionTask(snapshot), snapshot.effective_task);
  assert.deepEqual(result.routing_intent, {state: 'routes', notices: compiled.notices, reason: null,
    resolution_sha256: snapshot.effective_task.core_routing.resolution_sha256});
  assert.ok(!JSON.stringify(result).includes(readModelAnswer), 'raw model answer is private');
  await runtime.submit(original); await sleep(20);
  assert.equal(resolverCalls, 1, 'idempotent original submission is not reinterpreted/replayed');
});

test('exact arithmetic and preexisting literal greeting bypass compiler/catalog/planner/provider completely', async t => {
  const directory = await fixture(t);
  let calls = 0;
  const fail = () => { calls++; throw Error('unexpected model/provider operation'); };
  const runtime = await createRCCRuntime({stateDir: directory, resolveIntent: fail, catalog: fail, plan: fail, execute: fail});
  t.after(async () => runtime.close());
  for (const text of ['1+1', '1+1이 뭐야?', 'hello']) {
    const request = task(directory, text);
    await runtime.submit(request);
    const result = await wait(runtime, request);
    assert.equal(result.state, 'completed'); assert.equal(result.routing_intent, undefined);
    assert.equal(stored(directory, request.task_id).intent_resolution, undefined);
  }
  assert.equal(calls, 0);
});

test('native typed response-path disposition completes ONE original Core child with no catalog/planner/provider', async t => {
  const directory = await fixture(t), request = task(directory, '야 체크해 봅시다. 너 되냐?');
  const original = structuredClone(request); let compilerCalls = 0, otherCalls = 0;
  const fail = () => { otherCalls++; throw Error('response path must not spend model/provider quota'); };
  const runtime = await createRCCRuntime({stateDir: directory,
    resolveIntent: async ({task: q}) => { compilerCalls++; assert.deepEqual(q, original);
      return resolution(q, 'local_response', {notices: []}); }, catalog: fail, plan: fail, execute: fail});
  t.after(() => runtime.close()); await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed'); assert.equal(done.routing_intent.state, 'local_response');
  assert.equal(done.children.length, 1); assert.equal(done.children[0].id, 'local-core');
  assert.equal(done.children[0].instruction, request.request);
  assert.equal(done.children[0].selected_config.model, 'none');
  assert.equal(done.children[0].selected_config.effort, 'none');
  assert.equal(done.result.parity_state, 'unverified'); assert.equal(done.result.native_receipt, null);
  assert.ok(!/설치|완료|backend|quota|ready/i.test(done.result.output));
  assert.deepEqual(stored(directory, request.task_id).task, original);
  await runtime.submit(original); assert.equal(compilerCalls, 1); assert.equal(otherCalls, 0);
});

test('local response disposition cannot carry model output, extra authority or different source/provider/material', async t => {
  const directory = await fixture(t); let index = 0;
  const mutations = [
    (r, q) => { r.source_fingerprint = sha('other'); }, (r, q) => { r.policy_sha256 = sha('other'); },
    (r, q) => { r.request_sha256 = sha('other'); }, (r, q) => { r.task_id = 'foreign'; },
    r => { r.model_answer = '{"kind":"local_response"}'; }, r => { r.reason = 'make this ready'; },
    r => { r.notices = ['all tasks complete']; }, r => { r.output = 'Everything is ready'; },
    r => { r.best_effort = true; }, r => { r.routes = [{surface: 'codex', instruction: 'Do work'}]; }
  ];
  for (const mutate of mutations) {
    const path = join(directory, String(index++)), q = task(path, '너 되냐?'); let calls = 0;
    const rt = await createRCCRuntime({stateDir: path,
      resolveIntent: async () => { const value = resolution(q, 'local_response', {notices: []}); mutate(value, q); return value; },
      catalog: () => { calls++; throw Error('must not run'); }});
    await rt.submit(q); assert.equal((await wait(rt, q)).state, 'held'); assert.equal(calls, 0); await rt.close();
  }
  for (const mutate of [q => {q.host_context.provider_preference = 'codex';},
    q => {q.provider_preference = 'claude';}, q => {q.material_refs = ['provided-material'];},
    q => {q.objective = 'a different objective';}]) {
    const path = join(directory, String(index++)), q = task(path, '너 되냐?'); mutate(q);
    q.source_fingerprint = hostContextFingerprint(q.host_context); let calls = 0;
    const rt = await createRCCRuntime({stateDir: path,
      resolveIntent: async () => resolution(q, 'local_response', {notices: []}),
      catalog: () => {calls++; throw Error('must not run');}});
    await rt.submit(q); const done = await wait(rt, q);
    assert.equal(done.state, 'held'); assert.equal(done.error, 'intent_local_response_scope_invalid');
    assert.equal(calls, 0); await rt.close();
  }
});

test('legitimate ordinary result leaves owner task/source and downstream planning unchanged', async t => {
  const directory = await fixture(t), request = task(directory, 'Summarize one supplied sentence');
  let compilerCalls = 0;
  const runtime = await createRCCRuntime({stateDir: directory,
    resolveIntent: async ({task: value}) => { compilerCalls++; return resolution(value, 'ordinary'); },
    catalog: async value => { assert.deepEqual(value, request); return catalog(value); },
    plan: async ({task: value}) => { assert.deepEqual(value, request); return plan(value); },
    execute: async ticket => { assert.equal(ticket.core_routing, undefined); return execution(ticket); }, verifyTask: verifier});
  t.after(async () => runtime.close());
  await runtime.submit(request);
  assert.equal((await wait(runtime, request)).state, 'completed');
  assert.equal(compilerCalls, 1); assert.equal(stored(directory, request.task_id).effective_task, undefined);
});

test('hold and malformed/mismatched compiler proposals never fall through to provider work', async t => {
  const directory = await fixture(t);
  const changes = [
    () => ({kind: 'routes'}), value => ({...resolution(value), task_id: 'wrong-task'}),
    value => ({...resolution(value), request_sha256: sha('wrong')}),
    value => ({...resolution(value), policy_sha256: sha('wrong')}),
    value => ({...resolution(value), source_fingerprint: sha('wrong')}),
    value => ({...resolution(value), routes: [{surface: 'chatgpt', instruction: '1+1'}]}),
    value => ({...resolution(value), routes: [{surface: 'codex', instruction: ''}]}),
    value => ({...resolution(value), routes: [{surface: 'codex', instruction: 'x'.repeat(12_001)}]}),
    value => ({...resolution(value), routes: [{surface: 'codex', instruction: '1+1', scope: 'workspace_write'}]}),
    value => ({...resolution(value, 'ordinary'), routes: ROUTES}),
    value => ({...resolution(value), extra: 'invented'}),
    value => ({...resolution(value), best_effort: 1}),
    value => ({...resolution(value), routes: []}),
    value => ({...resolution(value), routes: [ROUTES[0], ROUTES[0]]}),
    value => ({...resolution(value), kind: 'execute'}),
    value => ({...resolution(value, 'hold'), reason: null}),
    value => ({...resolution(value, 'ordinary'), best_effort: true}),
    value => ({...resolution(value), notices: [null]}),
    value => ({...resolution(value), model_answer: 'x'.repeat(4097)}),
    value => resolution(value, 'hold'),
    () => { throw Error('compiler transport failed'); },
  ];
  for (const [index, change] of changes.entries()) {
    const stateDir = join(directory, String(index)), request = task(directory);
    let providerCalls = 0;
    const unexpected = () => { providerCalls++; throw Error('must not fall through'); };
    const runtime = await createRCCRuntime({stateDir, resolveIntent: ({task: value}) => change(value),
      catalog: unexpected, plan: unexpected, execute: unexpected});
    await runtime.submit(request); const result = await wait(runtime, request);
    assert.equal(result.state, 'held'); assert.equal(providerCalls, 0);
    assert.equal(result.routing_intent.state, 'held'); assert.deepEqual(stored(stateDir, request.task_id).task, request);
    assert.equal(stored(stateDir, request.task_id).effective_task, undefined);
    await runtime.close();
  }
});

test('caller cannot submit core_routing/effective_task/intent_resolution or hide them in host context', async t => {
  const directory = await fixture(t), request = task(directory);
  const runtime = await createRCCRuntime({stateDir: directory});
  t.after(async () => runtime.close());
  for (const key of ['core_routing', 'effective_task', 'intent_resolution'])
    await assert.rejects(runtime.submit({...request, [key]: {schema: 1}}), /task_shape_invalid/);
  const host = {...request.host_context, core_routing: {schema: 1}};
  await assert.rejects(runtime.submit({...request, host_context: host, source_fingerprint: hostContextFingerprint(host)}),
    /host_context_invalid/);
});

test('legacy explicit task and no-resolver ordinary work retain old behavior', async t => {
  const directory = await fixture(t);
  for (const explicit of [true, false]) {
    const stateDir = join(directory, String(explicit)), request = task(directory, 'Run exactly the approved task', {explicit});
    let compiles = 0;
    const runtime = await createRCCRuntime({stateDir,
      ...(explicit ? {resolveIntent: () => { compiles++; throw Error('must bypass'); }} : {}),
      catalog: async value => catalog(value), plan: async ({task: value}) => plan(value),
      execute: async ticket => { assert.equal(ticket.core_routing, undefined); return execution(ticket); }, verifyTask: verifier});
    await runtime.submit(request); assert.equal((await wait(runtime, request)).state, 'completed');
    assert.equal(compiles, 0); assert.equal(stored(stateDir, request.task_id).intent_resolution, undefined);
    await runtime.close();
  }
});

test('cancel pending compiler aborts Core signal; late answer cannot resurrect task or dispatch', async t => {
  const directory = await fixture(t), request = task(directory);
  let started = false, signal, release, providerCalls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const runtime = await createRCCRuntime({stateDir: directory,
    resolveIntent: async input => { signal = input.signal; started = true; await pending; return resolution(input.task); },
    catalog: async () => { providerCalls++; throw Error('not reached'); }});
  t.after(async () => runtime.close());
  await runtime.submit(request); await until(() => started);
  assert.equal(runtime.status({schema: 1, task_id: request.task_id}).routing_intent.state, 'resolving');
  assert.equal(runtime.cancel({schema: 1, task_id: request.task_id}).state, 'cancelled');
  assert.equal(signal.aborted, true); release(); await sleep(20);
  const cancelled = await wait(runtime, request);
  assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.routing_intent.state, 'held');
  assert.equal(providerCalls, 0);
  assert.equal(stored(directory, request.task_id).effective_task, undefined);
});

test('timeout is capped by remaining task budget, aborts compiler and cannot fall through', async t => {
  const directory = await fixture(t), request = task(directory, 'Route the written arithmetic everywhere', {duration: 1_000});
  let signal, release, providerCalls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const runtime = await createRCCRuntime({stateDir: directory,
    resolveIntent: async input => { signal = input.signal; await pending; return resolution(input.task); },
    catalog: async () => { providerCalls++; throw Error('not reached'); }});
  t.after(async () => runtime.close());
  await runtime.submit(request);
  const result = await wait(runtime, request);
  assert.equal(result.state, 'held'); assert.equal(result.error, 'intent_resolution_timeout');
  assert.equal(signal.aborted, true); assert.equal(providerCalls, 0);
  assert.equal(runtime.quiesce({schema: 1, request_id: 'wait-for-real-callback'}).safe_to_stop, false);
  release(); await sleep(20);
  assert.equal(runtime.quiesce({schema: 1, request_id: 'callback-ended'}).safe_to_stop, true);
  assert.equal((await wait(runtime, request)).state, 'held');
  assert.equal(stored(directory, request.task_id).effective_task, undefined);
});

test('quiesce aborts compiler but cannot report safe-to-stop until actual callback terminates; queued tasks stay queued', async t => {
  const directory = await fixture(t), request = task(directory);
  let started = false, signal, release;
  const pending = new Promise(resolve => { release = resolve; });
  const runtime = await createRCCRuntime({stateDir: directory,
    resolveIntent: async input => { started = true; signal = input.signal; await pending; return resolution(input.task); }});
  t.after(async () => runtime.close());
  await runtime.submit(request); await until(() => started);
  // A persisted not-yet-started queue row is not drained by quiescence.
  const queued = task(directory, 'Leave this queued owner request untouched');
  const queuedSnapshot = {schema: 1, task: queued, fingerprint: hostContextFingerprint(queued), state: 'queued', revision: 1,
    created_at_ms: Date.now(), cancel_requested: false, catalog: null, plan: null, children: [], result: null,
    install_handoff: null, error: null, spent_cost_units: 0};
  const db = new DatabaseSync(join(directory, 'rcc-runtime.sqlite'));
  db.prepare('INSERT INTO tasks(task_id,fingerprint,snapshot) VALUES(?,?,?)')
    .run(queued.task_id, queuedSnapshot.fingerprint, JSON.stringify(queuedSnapshot));
  db.close();
  const first = runtime.quiesce({schema: 1, request_id: 'pause'});
  assert.equal(signal.aborted, true); assert.equal(first.safe_to_stop, false); assert.equal(first.queued_tasks, 1);
  assert.equal((await wait(runtime, request)).error, 'intent_resolution_quiesced');
  release(); await sleep(20);
  const quiet = runtime.quiesce({schema: 1, request_id: 'drained'});
  assert.equal(quiet.safe_to_stop, true); assert.equal(quiet.queued_tasks, 1); assert.equal(quiet.queued_preserved, true);
  assert.deepEqual(stored(directory, queued.task_id), queuedSnapshot);
});

test('legacy compiler-bound free-text named routes keep their exact payload and read-only authority', async t => {
  const directory = await fixture(t), request = task(directory, 'Codex에게 Say hello, 로컬에게 Say goodbye 전달해줘');
  const routes = [{surface: 'codex', instruction: 'Say hello'}, {surface: 'local', instruction: 'Say goodbye'}];
  const runtime = await createRCCRuntime({stateDir: directory,
    resolveIntent: async ({task: value}) => resolution(value, 'routes', {routes}),
    catalog: async value => catalog(value), plan: async ({task: value}) => plan(value),
    execute: async ticket => {
      assert.ok(['Say hello', 'Say goodbye'].includes(ticket.instruction));
      assert.equal(ticket.selected_config.scope, 'read_only'); assert.equal(ticket.host_context.require_read_only, true);
      assert.deepEqual(ticket.owned_paths, []);
      return execution(ticket);
    }, verifyTask: verifier});
  t.after(async () => runtime.close());
  await runtime.submit(request);
  assert.equal((await wait(runtime, request)).state, 'completed');
  assert.deepEqual(stored(directory, request.task_id).task, request);
});

test('explicit optional provider mirror changes only in derived copy; material-bearing derivation is rejected', async t => {
  const directory = await fixture(t);
  for (const material of [false, true]) {
    const stateDir = join(directory, String(material)), request = task(directory);
    request.host_context.provider_preference = 'claude'; request.provider_preference = 'claude';
    request.source_fingerprint = hostContextFingerprint(request.host_context);
    if (material) request.material_refs = ['fixture-image.png'];
    const original = structuredClone(request);
    let calls = 0;
    const runtime = await createRCCRuntime({stateDir,
      resolveIntent: ({task: value}) => resolution(value),
      catalog: async value => {
        calls++; assert.equal(value.provider_preference, 'auto');
        assert.equal(value.core_routing.original_provider_preference, 'claude'); return catalog(value);
      }, plan: async ({task: value}) => plan(value), execute: async ticket => execution(ticket), verifyTask: verifier});
    await runtime.submit(request); const result = await wait(runtime, request);
    assert.equal(result.state, material ? 'held' : 'completed');
    assert.equal(calls === 0, material);
    assert.deepEqual(stored(stateDir, request.task_id).task, original);
    await runtime.close();
  }
});

test('owner close aborts compiler and restart holds its original task without reinterpreting or replay', async t => {
  const directory = await fixture(t), request = task(directory);
  let started = false, signal, release, compilerCalls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  const runtime = await createRCCRuntime({stateDir: directory,
    resolveIntent: async input => {
      compilerCalls++; started = true; signal = input.signal; await pending; return resolution(input.task);
    }});
  await runtime.submit(request); await until(() => started);
  await runtime.close({timeoutMs: 10}); assert.equal(signal.aborted, true);
  const reopened = await createRCCRuntime({stateDir: directory,
    resolveIntent: async input => { compilerCalls++; return resolution(input.task); }});
  t.after(async () => reopened.close());
  release(); await sleep(20);
  const result = await wait(reopened, request);
  assert.equal(result.state, 'held'); assert.equal(result.routing_intent.state, 'held');
  assert.equal(compilerCalls, 1); assert.equal(stored(directory, request.task_id).effective_task, undefined);
  assert.deepEqual(stored(directory, request.task_id).task, request);
});

test('actual plugin resolver integrates with same Core task; changed native admission source holds before catalog', async t => {
  const directory = await fixture(t);
  for (const wrongSource of [false, true]) {
    const stateDir = join(directory, String(wrongSource)), request = task(directory);
    const routing = 'Fixture routing source', projection = 'No authority or parity from a proposal';
    const policyText = routing + '\n' + projection;
    request.host_context.owner_policy = {routing, projection};
    request.policy_sha256 = sha(policyText);
    request.policy = {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText};
    request.source_fingerprint = hostContextFingerprint(request.host_context);
    const answer = '{"kind":"route_all","expressions":["1+1","2+2"],"named":[],"excluded":[],"other_instruction":false,"sends_pointed_content":false}';
    let compilerCalls = 0, fakeCompletionCalls = 0, catalogCalls = 0, executeCalls = 0;
    const resolveIntent = routingIntentResolver({native: async (operation, payload, signal) => {
      compilerCalls++; assert.equal(operation, 'rcc-intent'); assert.deepEqual(payload.task, request);
      assert(signal instanceof AbortSignal);
      if (!Object.hasOwn(payload, 'answer')) return {...resolution(request, 'ordinary'), kind: 'needs_model',
        model_prompt: 'Fixture JSON-only candidate schema.', model_input: request.request,
        model_schema: {type: 'object'}, model_schema_json: '{"type":"object"}'};
      assert.equal(payload.answer, answer);
      return {...resolution(request), ...(wrongSource ? {source_fingerprint: sha('different source')} : {})};
    }, complete: async input => {
      fakeCompletionCalls++; assert.equal(input.model, 'ollama/qwen3.5:4b');
      assert.equal(input.reasoning, 'off', 'classification does not inherit a thinking mode');
      assert.equal(input.messages[0].content, request.request); assert(input.systemPrompt.includes(policyText));
      assert(input.signal instanceof AbortSignal);
      return {provider: 'ollama', model: 'qwen3.5:4b', stopReason: 'stop', text: answer,
        execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}};
    }});
    const runtime = await createRCCRuntime({stateDir, resolveIntent,
      catalog: async value => { catalogCalls++; return catalog(value); },
      plan: async ({task: value}) => plan(value), execute: async ticket => {
        executeCalls++; assert.equal(ticket.core_routing.model_answer, answer);
        assert.equal(ticket.core_routing.resolution_sha256,
          intentResolutionFingerprint(request, resolution(request, 'routes', {model_answer: answer})));
        return execution(ticket);
      }, verifyTask: verifier});
    await runtime.submit(request); const result = await wait(runtime, request);
    assert.equal(compilerCalls, 2); assert.equal(fakeCompletionCalls, 1);
    assert.equal(result.state, wrongSource ? 'held' : 'completed');
    if (wrongSource) { assert.equal(catalogCalls, 0); assert.equal(executeCalls, 0);
      assert.equal(result.error, 'intent_source_binding_invalid'); }
    else { assert.ok(catalogCalls >= 2); assert.equal(executeCalls, 2); }
    assert.deepEqual(stored(stateDir, request.task_id).task, request);
    await runtime.close();
  }
});
