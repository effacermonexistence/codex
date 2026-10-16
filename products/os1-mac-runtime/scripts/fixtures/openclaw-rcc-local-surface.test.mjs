// Route-all and the local execution surface (2026-10-14, build 381 incident
// ac5a5fd6): "너 라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐 … 원플러스원
// 투플러스투" named no surface, ran on Auto as one task and escalated to
// gpt-6-astra/max. The host now sends one exact expression to every
// available surface, the local model OpenClaw already runs included. These
// fixtures run the real Core, plugin executor and exact verifier with a fake
// completion and fake native records: no provider, model, network or HOME.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRCCRuntime, dispatchable, hostContextFingerprint, LOCAL_WORKER_MODEL, localWorkerRow,
  resolveRoutePlan, routingAvailability } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import { buildRoutePlanSchema, LOCAL_WORKER_PURPOSE, localModelExecutor, localWorkerCompletionRequest,
  normalizeLocalOutput, registerRCCRuntime, verifyExactExplicitArithmetic } from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-local-surface-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
const INCIDENT = '너 라우팅 할 수 있는 쪽으로 최대한 다 라우팅 해봐. 엄청 간단한 알제브라 계산 있잖아.\n뭐 원플러스원 투플러스투 이런 거 있잖아.';
// What the host builds for the incident (Swift RouteAllIntent, OS1ContextTests).
const ROUTE_ALL = [{surface: 'local', instruction: '1+1'}, {surface: 'codex', instruction: '2+2'},
  {surface: 'claude', instruction: '1+1'}, {surface: 'claude-chat', instruction: '2+2'}];
function explicitTask(dir, routes = ROUTE_ALL, extras = {}) {
  const policyText = 'RCC local-surface fixture policy: candidates do not grant authority.';
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  if (routes) host.explicit_routes = routes;
  const request = extras.request ?? INCIDENT;
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host),
    mode: routes ? 'explicit_routing_test' : 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, surface, model, effort, options = {}) {
  const now = Date.now();
  const pool = {codex: 'openai_codex', claude: 'anthropic_shared', 'claude-chat': 'anthropic_shared', local: 'none'}[surface];
  return {id, surface, transport: {codex: 'codex_app_server', claude: 'claude_cli', 'claude-chat': 'claude_cli',
    local: 'local'}[surface], account_id: surface === 'local' ? 'os1-local' : 'account-1', model, effort,
  tools: surface === 'claude' || surface === 'codex' ? ['read', 'execute'] : [], scope: 'read_only',
  permission_profile: 'read_only', quota_pool: pool, allowed_paths: [], configuration_sha256: sha('config:' + id),
  availability: options.availability ?? 'available', availability_observed_at_ms: now - 100,
  availability_valid_until_ms: now + 30_000,
  quota_remaining_fraction: pool === 'none' ? null : 0.7, quota_observed_at_ms: pool === 'none' ? null : now - 100,
  quota_valid_until_ms: pool === 'none' ? null : now + 30_000, quality_state: 'policy_admitted',
  estimated_cost_units: null};
}
const LOCAL_ROW = (options) => row('cfg-local', 'local', LOCAL_WORKER_MODEL, 'none', options);
function catalog(request, {local = 'available', withLocal = true} = {}) {
  const candidates = [row('codex-luna-low', 'codex', 'gpt-6-luna', 'low'),
    row('codex-astra-max', 'codex', 'gpt-6-astra', 'max'),
    row('chat-sonnet-low', 'claude-chat', 'claude-sonnet-5-5', 'low'),
    row('chat-fable-max', 'claude-chat', 'claude-fable-5-1', 'max'),
    row('claude-sonnet-low', 'claude', 'claude-sonnet-5-5', 'low'),
    row('claude-fable-max', 'claude', 'claude-fable-5-1', 'max')];
  if (withLocal) candidates.push(LOCAL_ROW({availability: local}));
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, candidates,
    model_tiers: {'gpt-6-luna': 'fast', 'gpt-6-astra': 'frontier', 'claude-sonnet-5-5': 'efficient',
      'claude-fable-5-1': 'frontier'}};
}
const routeNode = (index, routes = ROUTE_ALL, routeClass = 'trivial') => ({id: `requested-${index + 1}`,
  instruction: routes[index].instruction, dependencies: [], kind: 'agent', route_class: routeClass,
  scope: 'read_only', owned_paths: [], context_refs: []});
const plan = (request, nodes) => ({schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, nodes});
const wait = (runtime, request) => runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
// The local completion receipt OpenClaw returns for the pinned Ollama model.
const completion = (text, extras = {}) => ({provider: 'ollama', model: 'qwen3.5:4b', stopReason: 'stop',
  execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}, usage: {inputTokens: 31, outputTokens: 1},
  agentId: 'main', audit: {caller: {kind: 'plugin'}}, text, ...extras});
const exact = instruction => String(instruction.split('+').reduce((sum, value) => sum + Number(value), 0));
// A native Codex/Claude record with its private receipt, as the native adapter writes it.
async function nativeRecord(stateDir, ticket, output = exact(ticket.instruction)) {
  const directory = join(stateDir, 'native-receipts');
  await mkdir(directory, {recursive: true, mode: 0o700}); await chmod(directory, 0o700);
  const path = join(directory, randomUUID() + '.json');
  const record = {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output, execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', native_receipt: path,
    usage: {input_tokens: 4, output_tokens: 1}, native_summary: null};
  await writeFile(path, JSON.stringify(record), {flag: 'wx', mode: 0o600});
  return record;
}

// ---- Pure binding ------------------------------------------------------------

test('an explicit local route binds the local model row; the named provider routes keep their own surfaces', async t => {
  const dir = await fixture(t);
  const request = explicitTask(dir);
  const resolved = resolveRoutePlan(plan(request, ROUTE_ALL.map((_, index) => routeNode(index))), request,
    catalog(request), Date.now());
  assert.deepEqual(Object.values(resolved.decisions).map(d => `${d.surface}:${d.model}/${d.effort}`),
    ['local:qwen3.5:4b/none', 'codex:gpt-6-luna/low', 'claude:claude-sonnet-5-5/low', 'claude-chat:claude-sonnet-5-5/low']);
  assert.equal(resolved.decisions['requested-1'].reason,
    'resolver;route_explicit;explicit_route_surface_local;class_trivial;local_model');
  assert.deepEqual(resolved.routes['requested-1'], {kind: 'explicit', reference_effort: 'none', ladder: null});
  // Whatever the planner's grade, the local route never escalates and never leaves its surface.
  const deep = resolveRoutePlan(plan(request, [routeNode(0, ROUTE_ALL, 'deep')]), request, catalog(request), Date.now());
  assert.equal(deep.decisions['requested-1'].resolved_candidate_id, 'cfg-local');
  assert.equal(deep.routes['requested-1'].ladder, null);
  // Unavailable or absent: a typed hold reason, never another surface.
  assert.throws(() => resolveRoutePlan(plan(request, [routeNode(0)]), request,
    catalog(request, {local: 'unavailable'}), Date.now()), /no_dispatchable_candidate:read_only:local_undispatchable/);
  assert.throws(() => resolveRoutePlan(plan(request, [routeNode(0)]), request,
    catalog(request, {withLocal: false}), Date.now()), /no_dispatchable_candidate:read_only:local_unavailable/);
  // A local route node that is not a read-only answer is a binding error.
  assert.throws(() => resolveRoutePlan(plan(request, [{...routeNode(0), scope: 'workspace_write', owned_paths: ['**']}]),
    request, catalog(request), Date.now()), /explicit_local_route_scope_invalid/);
});

test('Auto never routes work to the local model row, and it is never the deterministic exact row', async t => {
  const dir = await fixture(t);
  const request = explicitTask(dir, null, {request: 'Summarize the plan'});
  const rows = catalog(request);
  assert.ok(localWorkerRow(rows.candidates.at(-1)) && dispatchable(rows.candidates.at(-1), request));
  const graded = resolveRoutePlan(plan(request, [{id: 'n', instruction: 'Summarize the plan', dependencies: [],
    kind: 'agent', route_class: 'trivial', scope: 'read_only', owned_paths: [], context_refs: []}]),
  request, rows, Date.now());
  assert.notEqual(graded.decisions.n.surface, 'local');
  const availability = routingAvailability(request, rows);
  assert.equal(availability.deterministic, false, 'the local model row is not a deterministic exact row');
  assert.deepEqual(availability.providers, ['claude', 'codex']);
  // The planner is not offered the deterministic kind because of it either.
  assert.equal(buildRoutePlanSchema(request, rows).properties.nodes.items.properties.kind.const, 'agent');
  // An adapter-bound Auto plan that names the local model row is refused by Core.
  const runtime = await createRCCRuntime({stateDir: join(dir, 'auto-local'),
    catalog: async () => rows,
    plan: async () => plan(request, [{id: 'n', instruction: 'Summarize the plan', dependencies: [], kind: 'agent',
      candidate_id: 'cfg-local', scope: 'read_only', owned_paths: [], context_refs: []}]),
    execute: async () => { throw Error('must not execute'); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held');
  assert.equal(held.error, 'local_agent_node_not_explicit');
});

// ---- The local executor -------------------------------------------------------

test('the local executor sends only the instruction to the pinned model and writes the verifier receipt', async t => {
  const dir = await fixture(t);
  const requests = [];
  const execute = localModelExecutor({stateDir: dir,
    complete: async request => { requests.push(request); return completion('<think>one and one</think>\n2\n'); }});
  const ticket = {task_id: 'task-local', node_id: 'requested-1', attempt_id: randomUUID(), candidate_id: 'cfg-local',
    configuration_sha256: LOCAL_ROW().configuration_sha256, instruction: '1+1', owned_paths: [],
    original_request: INCIDENT, selected_config: (({id, availability, availability_observed_at_ms,
      availability_valid_until_ms, quota_remaining_fraction, quota_observed_at_ms, quota_valid_until_ms,
      quality_state, estimated_cost_units, ...config}) => config)(LOCAL_ROW())};
  const controller = new AbortController();
  const record = await execute(ticket, controller.signal);
  assert.equal(requests.length, 1);
  const sent = requests[0];
  assert.equal(sent.model, 'ollama/qwen3.5:4b');
  assert.equal(sent.purpose, LOCAL_WORKER_PURPOSE);
  assert.equal(sent.reasoning, 'off');
  assert.equal(Object.hasOwn(sent, 'responseFormat'), false);
  assert.deepEqual(sent.messages, [{role: 'user', content: '1+1'}], 'only the instruction, never the owner request');
  assert.ok(!JSON.stringify(sent).includes('라우팅'));
  assert.ok(sent.signal instanceof AbortSignal);
  assert.deepEqual({...localWorkerCompletionRequest({instruction: '1+1', signal: undefined}), signal: undefined},
    {...sent, signal: undefined});
  // The record Core validates, and the identical private receipt.
  assert.equal(record.status, 'succeeded'); assert.equal(record.dispatch_stage, 'dispatched');
  assert.equal(record.side_effects, 'none'); assert.equal(record.execution_verified, true);
  assert.equal(record.output, '2'); assert.equal(record.task_quality, 'task_verified'); assert.equal(record.task_verified, true);
  assert.deepEqual(record.acknowledged_config, ticket.selected_config); assert.equal(record.observed_config, null);
  assert.equal(record.native_turn_terminated, true);
  assert.deepEqual(record.usage, {input_tokens: 31, output_tokens: 1, cache_read_tokens: null, cache_write_tokens: null,
    provider_calls: 1, duration_ms: record.usage.duration_ms, metric: 'local_model_usage_observation'});
  const summary = JSON.parse(record.native_summary);
  assert.deepEqual({...summary.steps[0], duration_ms: 0}, {sequence: 1, provider: 'local', action: 'rcc_local_model',
    model: 'qwen3.5:4b', effort: 'none', revas_disposition: 'execution_only', session_id: ticket.attempt_id,
    permission_profile: 'read_only', exit_code: 0, output: '2', stderr: '', duration_ms: 0, native_record: null,
    surface: 'local'});
  assert.match(record.native_receipt, new RegExp(`^${join(dir, 'native-receipts')}/[a-f0-9-]{36}\\.json$`));
  assert.deepEqual(JSON.parse(await readFile(record.native_receipt, 'utf8')), record);
  assert.equal((await stat(record.native_receipt)).mode & 0o777, 0o600);
  assert.equal((await lstat(join(dir, 'native-receipts'))).mode & 0o777, 0o700);
  // Not the exact result: delivered as execution-only, never relabelled.
  const prose = await localModelExecutor({stateDir: dir, complete: async () => completion('1+1 = 2')})(
    {...ticket, attempt_id: randomUUID()});
  assert.equal(prose.output, '1+1 = 2'); assert.equal(prose.task_quality, 'execution_only');
  assert.equal(normalizeLocalOutput('<think>unfinished'), '');
});

test('the local executor never adopts a foreign or broken answer and never fabricates an outcome', async t => {
  const dir = await fixture(t);
  const ticket = {task_id: 'task-local', node_id: 'requested-1', attempt_id: randomUUID(), candidate_id: 'cfg-local',
    configuration_sha256: 'a'.repeat(64), instruction: '1+1', owned_paths: [],
    selected_config: {surface: 'local', transport: 'local', account_id: 'os1-local', model: LOCAL_WORKER_MODEL,
      effort: 'none', tools: [], scope: 'read_only', permission_profile: 'read_only', quota_pool: 'none',
      allowed_paths: [], configuration_sha256: 'a'.repeat(64)}};
  const run = complete => localModelExecutor({stateDir: dir, complete})({...ticket, attempt_id: randomUUID()});
  for (const [label, response, error] of [
    ['another provider answered', completion('2', {provider: 'openai', model: 'gpt-6-astra'}), 'local_model_receipt_invalid'],
    ['the model was cut off', completion('2', {stopReason: 'length'}), 'local_model_receipt_invalid'],
    ['an isolated agent runtime answered', completion('2', {execution: {mode: 'isolated-agent-runtime',
      owner: {kind: 'harness', id: 'codex'}}}), 'local_model_receipt_invalid'],
    ['only reasoning came back', completion('<think>thinking only</think>'), 'local_model_output_empty']]) {
    const record = await run(async () => response);
    assert.equal(record.status, 'succeeded', label); assert.equal(record.execution_verified, false, label);
    assert.equal(record.task_quality, 'failed', label); assert.equal(record.output, null, label);
    assert.equal(record.error, error, label); assert.equal(record.acknowledged_config, null, label);
    assert.deepEqual(JSON.parse(await readFile(record.native_receipt, 'utf8')), record, label);
  }
  // A completion that throws (Ollama down or restarted, a model-load error,
  // a Gateway change) is a finished turn with no answer, never "uncertain":
  // tools-free and read-only, it changed nothing.
  for (const error of [Object.assign(Error('LLM_COMPLETION_FAILED'), {code: 'LLM_COMPLETION_FAILED'}),
    Object.assign(Error('connect ECONNREFUSED 127.0.0.1:11434'), {code: 'ECONNREFUSED'})]) {
    const thrown = await run(async () => { throw error; });
    assert.equal(thrown.status, 'succeeded', error.code); assert.equal(thrown.dispatch_stage, 'dispatched');
    assert.equal(thrown.side_effects, 'none'); assert.equal(thrown.error, 'local_model_completion_failed');
    assert.equal(thrown.execution_verified, false); assert.equal(thrown.task_quality, 'failed');
    assert.equal(thrown.output, null); assert.equal(thrown.native_turn_terminated, true);
    assert.equal(thrown.usage.provider_calls, 1);
    assert.deepEqual(JSON.parse(await readFile(thrown.native_receipt, 'utf8')), thrown);
  }
  // An owner cancel or a service stop aborts it: an ended turn, reported as such.
  const controller = new AbortController();
  const aborted = localModelExecutor({stateDir: dir, complete: async request => new Promise((_, reject) => {
    if (request.signal.aborted) reject(request.signal.reason);
    request.signal.addEventListener('abort', () => reject(request.signal.reason), {once: true}); })})(
    {...ticket, attempt_id: randomUUID()}, controller.signal);
  controller.abort(Error('cancel_requested'));
  const cancelled = await aborted;
  assert.equal(cancelled.status, 'failed'); assert.equal(cancelled.dispatch_stage, 'dispatched');
  assert.equal(cancelled.side_effects, 'none'); assert.equal(cancelled.native_turn_terminated, true);
  assert.equal(cancelled.error, 'local_model_completion_aborted');
  for (const [label, change] of [['a provider row', {surface: 'codex', transport: 'codex_app_server', quota_pool: 'openai_codex'}],
    ['another model', {model: 'qwen3:8b'}], ['a writer', {scope: 'workspace_write', permission_profile: 'workspace_write'}],
    ['tools', {tools: ['read']}]])
    await assert.rejects(localModelExecutor({stateDir: dir, complete: async () => completion('2')})(
      {...ticket, selected_config: {...ticket.selected_config, ...change}}), /local_worker_ticket_invalid/, label);
  await assert.rejects(localModelExecutor({stateDir: dir, complete: async () => completion('2')})(
    {...ticket, continuation: {kind: 'full_access_required'}}), /local_worker_ticket_invalid/);
});

// ---- Durable runtime: the incident end to end ----------------------------------

test('route-all: four surfaces each answer their own expression and the exact verifier verifies all four', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'route-all');
  await mkdir(stateDir, {mode: 0o700});
  const request = explicitTask(dir);
  const executeLocal = localModelExecutor({stateDir, complete: async value => completion(exact(value.messages[0].content))});
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir,
    catalog: async value => catalog(value),
    plan: async () => plan(request, ROUTE_ALL.map((_, index) => routeNode(index))),
    execute: async (ticket, signal) => { tickets.push(ticket);
      return ticket.selected_config.surface === 'local' ? executeLocal(ticket, signal) : nativeRecord(stateDir, ticket); },
    verifyTask: evidence => verifyExactExplicitArithmetic(evidence, {stateDir})});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.equal(done.result.task_verified, true);
  assert.deepEqual(done.children.map(child => `${child.requested_surface}:${child.selected_config.surface}:` +
    `${child.selected_config.model}`), ['local:local:qwen3.5:4b', 'codex:codex:gpt-6-luna',
    'claude:claude:claude-sonnet-5-5', 'claude-chat:claude-chat:claude-sonnet-5-5']);
  assert.equal(done.result.output, 'requested-1: 2\n\nrequested-2: 4\n\nrequested-3: 2\n\nrequested-4: 4');
  assert.equal(tickets.length, 4, 'one attempt per route: nothing escalated, no astra/max, no fable/max');
  assert.ok(tickets.every(ticket => !['gpt-6-astra', 'claude-fable-5-1'].includes(ticket.selected_config.model)));
  assert.equal(done.children[0].routing_decision.reason, 'resolver;route_explicit;explicit_route_surface_local;class_trivial;local_model');
});

test('route-all with the local model not ready is held visibly before any planner or provider call', async t => {
  const dir = await fixture(t);
  const request = explicitTask(dir);
  let planned = 0, executed = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'not-ready'),
    catalog: async value => catalog(value, {local: 'unavailable'}),
    plan: async () => { planned++; throw Error('must not plan'); },
    execute: async () => { executed++; throw Error('must not execute'); }});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const held = await wait(runtime, request);
  assert.equal(held.state, 'held');
  assert.equal(held.error, 'explicit_route_surface_unavailable:local:local_model_not_ready');
  assert.deepEqual(held.children.map(child => child.requested_surface), ROUTE_ALL.map(route => route.surface));
  assert.equal(planned, 0); assert.equal(executed, 0);
  const absent = explicitTask(dir, [ROUTE_ALL[0]]);
  const second = await createRCCRuntime({stateDir: join(dir, 'absent'),
    catalog: async value => catalog(value, {withLocal: false}),
    plan: async () => { planned++; throw Error('must not plan'); }, execute: async () => { executed++; }});
  t.after(async () => { await second.close(); });
  await second.submit(absent);
  assert.equal((await wait(second, absent)).error, 'explicit_route_surface_unavailable:local:local_model_absent');
});

// ---- The plugin wiring: execute branches to the local surface --------------------

test('the Gateway plugin runs a local route on the planner model in the service scope, then verifies it', async t => {
  const dir = await fixture(t);
  const native = join(dir, 'native.mjs');
  // The native CLI fake answers only the catalog: a local route never reaches the native adapter.
  const body = `#!${process.execPath}
import {readFileSync,appendFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');const p=JSON.parse(readFileSync(process.argv[4],'utf8'));
appendFileSync(process.env.HOME+'/native-calls.log',process.argv[2]+'\\n');
if(process.argv[2]==='rcc-intent'){const t=p.task;console.log(JSON.stringify({schema:1,task_id:t.task_id,request_sha256:t.request_sha256,policy_sha256:t.policy_sha256,source_fingerprint:t.source_fingerprint,kind:'ordinary',routes:[],best_effort:false,notices:[],reason:null}));process.exit(0);}
if(process.argv[2]!=='rcc-catalog')process.exit(91);
const n=Date.now();console.log(JSON.stringify({schema:1,task_id:p.task_id,request_sha256:p.request_sha256,model_tiers:{},
candidates:[{id:'cfg-local',surface:'local',transport:'local',account_id:'os1-local',model:'qwen3.5:4b',effort:'none',
tools:[],scope:'read_only',permission_profile:'read_only',quota_pool:'none',allowed_paths:[],configuration_sha256:sha('local'),
availability:'available',availability_observed_at_ms:n,availability_valid_until_ms:n+120000,quota_remaining_fraction:null,
quota_observed_at_ms:null,quota_valid_until_ms:null,quality_state:'policy_admitted',estimated_cost_units:null}]}));`;
  await writeFile(native, body, {mode: 0o700});
  const policy = 'Synthetic bounded source policy; no quality parity assertion.';
  const keys = ['OS1_RCC_STATE_ROOT', 'OS1_RCC_NATIVE_PATH', 'OS1_RCC_NATIVE_SHA256', 'OS1_RCC_NATIVE_HOME', 'OS1_RCC_PUBLIC_POLICY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {OS1_RCC_STATE_ROOT: dir, OS1_RCC_NATIVE_PATH: native, OS1_RCC_NATIVE_SHA256: sha(body),
    OS1_RCC_NATIVE_HOME: dir, OS1_RCC_PUBLIC_POLICY: policy});
  const calls = [];
  let service;
  const methods = new Map();
  const api = {on() {}, registerService(value) { service = value; },
    registerGatewayMethod(name, handler) { methods.set(name, handler); },
    runtime: {llm: {async complete(params) {
      calls.push(params);
      assert.equal(params.model, 'ollama/qwen3.5:4b');
      assert(params.signal instanceof AbortSignal);
      if (params.purpose === LOCAL_WORKER_PURPOSE) return completion(exact(params.messages[0].content));
      const value = JSON.parse(params.messages[0].content.split('\n').slice(1).join('\n'));
      return completion(JSON.stringify({schema: 1, task_id: value.task_id, request_sha256: value.request_sha256,
        nodes: value.explicit_routes.map(route => ({id: route.id, instruction: route.instruction, dependencies: [],
          kind: 'agent', route_class: 'trivial', scope: 'read_only', owned_paths: [], context_refs: []}))}));
    }}}};
  registerRCCRuntime(api);
  const call = (name, params) => new Promise((resolve, reject) => {
    Promise.resolve(methods.get('os1.rcc.' + name)({params, respond(ok, result, error) {
      ok ? resolve(result) : reject(Error(error?.message)); }})).catch(reject);
  });
  try {
    await service.start({stateDir: dir});
    const policyText = policy;
    const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
      claude_session_id: null, require_read_only: true, owner_policy: null,
      explicit_routes: [{surface: 'local', instruction: '1+1'}]};
    const task = {schema: 1, task_id: randomUUID(), request: INCIDENT, request_sha256: sha(INCIDENT), objective: INCIDENT,
      policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'explicit_routing_test',
      material_refs: [], budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20_000},
      host_context: host, policy: {source_sha256: sha(policyText), projection_sha256: sha(policyText), text: policyText}};
    await call('submit', task);
    let snapshot; const until = Date.now() + 8_000;
    do { await new Promise(resolve => setTimeout(resolve, 20)); snapshot = await call('status', {schema: 1, task_id: task.task_id}); }
    while (!['completed', 'returned_unverified', 'held', 'failed', 'effects_uncertain'].includes(snapshot.state) && Date.now() < until);
    assert.equal(snapshot.state, 'completed', snapshot.error);
    assert.equal(snapshot.result.task_verified, true);
    assert.equal(snapshot.result.output, '2');
    assert.deepEqual(calls.map(params => params.purpose), [LOCAL_WORKER_PURPOSE]);
    assert.equal(Object.hasOwn(calls[0], 'responseFormat'), false);
    assert.ok((await readFile(join(dir, 'native-calls.log'), 'utf8')).trim().split('\n').every(line => line === 'rcc-catalog'),
      'the native adapter is never called for a local route');
    assert.equal((await readdir(join(dir, 'native-receipts'))).length, 1);
  } finally {
    await service.stop();
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
  }
});

// ---- A failed or cancelled local completion keeps the sibling routes --------
// Review of 1bd83c4: a thrown local completion was an uncertain dispatched
// failure, so the route-all task became effects_uncertain the moment local
// returned (it returns first, in-process), the Codex and Claude answers that
// came back afterwards were dropped, their children stayed "running" and kept
// both quota pools: every later Codex or Claude task was held, even after a
// restart. A cancel during the local completion did the same.

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
// What the host sends for a route-all order: the routes are best effort.
function bestEffortTask(dir, routes = ROUTE_ALL) {
  const task = explicitTask(dir, routes);
  task.host_context.explicit_routes_best_effort = true;
  task.source_fingerprint = hostContextFingerprint(task.host_context);
  return task;
}
async function siblingsRun(t, {stateDir, local, release, providerOnCancel = null, bestEffort = true}) {
  const request = bestEffort ? bestEffortTask(stateDir) : explicitTask(stateDir);
  const started = [];
  const runtime = await createRCCRuntime({stateDir,
    catalog: async value => catalog(value),
    plan: async value => plan(value.task ?? value, (value.task ?? value).host_context.explicit_routes
      .map((_, index) => routeNode(index, (value.task ?? value).host_context.explicit_routes))),
    execute: async (ticket, signal) => {
      if (ticket.selected_config.surface === 'local') return local(ticket, signal);
      started.push(ticket.selected_config.surface);
      // The provider turns finish after local has returned, or on cancel.
      await Promise.race([release.promise, new Promise(resolve => signal.addEventListener('abort', resolve, {once: true}))]);
      if (signal.aborted && providerOnCancel) return providerOnCancel(ticket);
      return nativeRecord(stateDir, ticket);
    },
    verifyTask: evidence => verifyExactExplicitArithmetic(evidence, {stateDir})});
  t.after(async () => { await runtime.close(); });
  return {request, runtime, started};
}
async function nextProviderTaskRuns(runtime, stateDir, surface) {
  const request = explicitTask(stateDir, [{surface, instruction: '3+3'}]);
  await runtime.submit(request);
  return runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5_000});
}

test('a local completion that throws holds only the local route; Codex and Claude answers are kept, their pools free', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'throw');
  await mkdir(stateDir, {mode: 0o700});
  const release = gate();
  const local = localModelExecutor({stateDir, complete: async () => {
    throw Object.assign(Error('connect ECONNREFUSED 127.0.0.1:11434'), {code: 'ECONNREFUSED'}); }});
  const {request, runtime} = await siblingsRun(t, {stateDir, local: async (ticket, signal) => {
    const record = await local(ticket, signal); setTimeout(() => release.resolve(), 100); return record; }, release});
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'returned_unverified', done.error);
  assert.deepEqual(done.children.map(child => `${child.requested_surface}:${child.state}`),
    ['local:held', 'codex:completed', 'claude:completed', 'claude-chat:completed']);
  assert.equal(done.result.output, 'requested-2: 4\n\nrequested-3: 2\n\nrequested-4: 4', 'every sibling answer is returned');
  // No child is left running with a lease: the next Codex and Claude tasks run.
  for (const surface of ['codex', 'claude']) {
    const next = await nextProviderTaskRuns(runtime, stateDir, surface);
    assert.equal(next.state, 'completed', `${surface}: ${next.state} ${next.error}`);
  }
});

test('cancelling a route-all task while the local model answers ends cancelled once every route returned; pools free', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'cancel');
  await mkdir(stateDir, {mode: 0o700});
  const release = gate(), localStarted = gate();
  const local = localModelExecutor({stateDir, complete: async value => { localStarted.resolve();
    return new Promise((_, reject) => value.signal.addEventListener('abort', () => reject(value.signal.reason), {once: true})); }});
  // A provider turn that stops on cancel before any backend work: a safe cancel.
  const providerOnCancel = async ticket => {
    const record = await nativeRecord(stateDir, ticket, null);
    return {...record, status: 'failed', dispatch_stage: 'not_dispatched', output: null, execution_verified: false,
      task_quality: 'failed', acknowledged_config: null};
  };
  const {request, runtime, started} = await siblingsRun(t, {stateDir, local, release, providerOnCancel});
  await runtime.submit(request);
  await localStarted.promise;
  // Codex and Claude Code run; Claude chat waits behind Claude Code's pool.
  while (started.length < 2) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(runtime.cancel({schema: 1, task_id: request.task_id}).state, 'cancelling');
  const done = await wait(runtime, request);
  assert.equal(done.state, 'cancelled', done.error);
  assert.deepEqual(done.children.map(child => child.state), ['cancelled', 'cancelled', 'cancelled', 'cancelled'],
    'no sibling record is dropped and none stays running');
  release.resolve();
  for (const surface of ['codex', 'claude']) {
    const next = await nextProviderTaskRuns(runtime, stateDir, surface);
    assert.equal(next.state, 'completed', `${surface}: ${next.state} ${next.error}`);
  }
});

test('a no-effect dispatched failure waits for its running siblings before the task settles', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'uncertain');
  await mkdir(stateDir, {mode: 0o700});
  const release = gate();
  // A local turn whose executor (an older one) reports an uncertain no-effect failure.
  const local = async ticket => {
    const record = await nativeRecord(stateDir, ticket, null);
    setTimeout(() => release.resolve(), 100);
    return {...record, status: 'failed', output: null, execution_verified: false, task_quality: 'failed',
      acknowledged_config: null, error: 'native_outcome_uncertain_preserved'};
  };
  const {request, runtime} = await siblingsRun(t, {stateDir, local, release, bestEffort: false});
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'effects_uncertain'); assert.equal(done.error, 'dispatched_failure_no_replay');
  // The running siblings are reconciled; nothing new starts after an uncertain child.
  assert.deepEqual(done.children.map(child => child.state),
    ['effects_uncertain', 'completed', 'completed', 'queued'], 'the siblings were reconciled, not left running');
  for (const surface of ['codex', 'claude']) {
    const next = await nextProviderTaskRuns(runtime, stateDir, surface);
    assert.equal(next.state, 'completed', `${surface}: ${next.state} ${next.error}`);
  }
});

// ---- Route-all is best effort: one route that cannot run never holds the set ----
// Review of 1bd83c4: the host included every surface its cached health did
// not rule out; Core then held EVERY route when one had no runnable row (a
// Claude CLI on API billing, a stale quota, the catalog's own local probe).

function withoutChat(value) {
  const rows = catalog(value);
  // Claude signed in on API billing: no Claude row at all, the reason recorded.
  rows.candidates = rows.candidates.filter(row => !['claude', 'claude-chat'].includes(row.surface));
  rows.model_tiers = {'gpt-6-luna': 'fast', 'gpt-6-astra': 'frontier'};
  rows.exclusions = [{provider: 'claude', reason: 'non_subscription', count: 4}];
  return rows;
}

test('route-all runs every route that can run and skips the rest with its reason; a named test still holds the set', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'best-effort');
  await mkdir(stateDir, {mode: 0o700});
  const planned = [];
  const make = async (name, catalogFn) => {
    const executeLocal = localModelExecutor({stateDir: join(stateDir, name),
      complete: async value => completion(exact(value.messages[0].content))});
    const runtime = await createRCCRuntime({stateDir: join(stateDir, name),
      catalog: async value => catalogFn(value),
      plan: async ({task}) => { planned.push(task.host_context.explicit_routes.filter(route => !route.skipped).length);
        return plan(task, task.host_context.explicit_routes.map((route, index) => route.skipped ? null : routeNode(index,
          task.host_context.explicit_routes)).filter(Boolean)); },
      execute: async (ticket, signal) => ticket.selected_config.surface === 'local' ? executeLocal(ticket, signal) :
        nativeRecord(join(stateDir, name), ticket),
      verifyTask: evidence => verifyExactExplicitArithmetic(evidence, {stateDir: join(stateDir, name)})});
    t.after(async () => { await runtime.close(); });
    return runtime;
  };
  for (const name of ['a', 'b', 'c', 'd']) await mkdir(join(stateDir, name), {mode: 0o700});
  const runtime = await make('a', withoutChat);
  const request = bestEffortTask(join(stateDir, 'a'));
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.equal(done.result.task_verified, true, 'the routes that ran are verified');
  assert.deepEqual(done.children.map(child => `${child.id}:${child.requested_surface}`),
    ['requested-1:local', 'requested-2:codex']);
  assert.deepEqual(done.skipped_routes, [{surface: 'claude', instruction: '1+1', reason: 'non_subscription'},
    {surface: 'claude-chat', instruction: '2+2', reason: 'non_subscription'}]);
  assert.equal(done.result.output, 'requested-1: 2\n\nrequested-2: 4');
  assert.deepEqual(planned, [2], 'the planner sees only the routes that run');
  // The same catalog for a named route test (no best effort) holds every route.
  const named = await make('b', withoutChat);
  const strict = explicitTask(join(stateDir, 'b'));
  await named.submit(strict);
  const held = await wait(named, strict);
  assert.equal(held.state, 'held'); assert.equal(held.error, 'explicit_route_surface_unavailable:claude:non_subscription');
  assert.equal(Object.hasOwn(held, 'skipped_routes'), false);
  // Best effort with nothing runnable still holds, with the first reason.
  const nothing = await make('c', value => ({...catalog(value), model_tiers: {},
    candidates: [LOCAL_ROW({availability: 'unavailable'})],
    exclusions: [{provider: 'codex', reason: 'quota_zero', count: 2}, {provider: 'claude', reason: 'signed_out', count: 4}]}));
  const none = bestEffortTask(join(stateDir, 'c'));
  await nothing.submit(none);
  const unheld = await wait(nothing, none);
  assert.equal(unheld.state, 'held');
  assert.equal(unheld.error, 'explicit_route_surface_unavailable:local:local_model_not_ready');
  // The local model not ready at the catalog's own probe skips only local.
  const notReady = await make('d', value => catalog(value, {local: 'unavailable'}));
  const local = bestEffortTask(join(stateDir, 'd'));
  await notReady.submit(local);
  const ran = await wait(notReady, local);
  assert.equal(ran.state, 'completed', ran.error);
  assert.deepEqual(ran.skipped_routes, [{surface: 'local', instruction: '1+1', reason: 'local_model_not_ready'}]);
  assert.deepEqual(ran.children.map(child => child.requested_surface), ['codex', 'claude', 'claude-chat']);
});

test('a skipped best-effort route stays skipped through a REVAS escalation of a route that ran', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'best-effort-escalation');
  await mkdir(stateDir, {mode: 0o700});
  const request = bestEffortTask(stateDir, [{surface: 'codex', instruction: '2+2'}, {surface: 'claude', instruction: '1+1'},
    {surface: 'claude-chat', instruction: '3+3'}]);
  const models = [];
  const runtime = await createRCCRuntime({stateDir,
    catalog: async value => { const rows = catalog(value);
      rows.candidates = rows.candidates.filter(row => row.surface !== 'claude-chat');
      rows.exclusions = [{provider: 'claude', reason: 'chat_gate_refused', count: 2}]; return rows; },
    plan: async ({task}) => plan(task, task.host_context.explicit_routes.map((route, index) => route.skipped ? null :
      routeNode(index, task.host_context.explicit_routes)).filter(Boolean)),
    execute: async ticket => { models.push(ticket.selected_config.model);
      // The cheap Claude Code tier answers nothing: the node escalates once to its reference.
      return nativeRecord(stateDir, ticket, ticket.selected_config.model === 'claude-sonnet-5-5' ? '' : exact(ticket.instruction)); },
    verifyTask: evidence => verifyExactExplicitArithmetic(evidence, {stateDir})});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.ok(models.includes('claude-fable-5-1'), 'the Claude Code route escalated to its reference: ' + models.join(','));
  assert.deepEqual(done.skipped_routes.map(route => route.surface), ['claude-chat']);
  assert.deepEqual(done.children.map(child => child.requested_surface), ['codex', 'claude']);
});

test('best effort is a property of a route list and only ever true', async t => {
  const dir = await fixture(t);
  const runtime = await createRCCRuntime({stateDir: join(dir, 'contract'), catalog: async value => catalog(value),
    plan: async () => { throw Error('unused'); }, execute: async () => { throw Error('unused'); }});
  t.after(async () => { await runtime.close(); });
  for (const value of [false, 'true', 1]) {
    const task = bestEffortTask(dir);
    task.host_context.explicit_routes_best_effort = value;
    task.source_fingerprint = hostContextFingerprint(task.host_context);
    await assert.rejects(Promise.resolve().then(() => runtime.submit(task)), /host_context_invalid/, String(value));
  }
  const auto = explicitTask(dir, null, {request: 'Summarize the plan'});
  auto.host_context.explicit_routes_best_effort = true;
  auto.source_fingerprint = hostContextFingerprint(auto.host_context);
  await assert.rejects(Promise.resolve().then(() => runtime.submit(auto)), /host_context_invalid/);
});

// ---- Every operator route-all sends is in the exact verifier's family ---------

test('route-all with minus and times completes and every route is task-verified', async t => {
  const dir = await fixture(t);
  const stateDir = join(dir, 'operators');
  await mkdir(stateDir, {mode: 0o700});
  // "다 라우팅 해봐. 파이브 마이너스 원, 식스곱하기투" (Swift RouteAllIntent).
  const routes = [{surface: 'local', instruction: '5-1'}, {surface: 'codex', instruction: '6*2'},
    {surface: 'claude', instruction: '9-10'}, {surface: 'claude-chat', instruction: '-3*-4'}];
  const value = instruction => String(Function(`"use strict"; return (${instruction.replace(/--/g, '- -')});`)());
  const executeLocal = localModelExecutor({stateDir, complete: async request => completion(value(request.messages[0].content))});
  let localRecord = null;
  const request = explicitTask(stateDir, routes);
  const runtime = await createRCCRuntime({stateDir,
    catalog: async task => catalog(task),
    plan: async () => plan(request, routes.map((_, index) => routeNode(index, routes))),
    execute: async (ticket, signal) => ticket.selected_config.surface === 'local' ?
      (localRecord = await executeLocal(ticket, signal)) : nativeRecord(stateDir, ticket, value(ticket.instruction)),
    verifyTask: evidence => verifyExactExplicitArithmetic(evidence, {stateDir})});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await wait(runtime, request);
  assert.equal(done.state, 'completed', done.error);
  assert.equal(done.result.task_verified, true);
  assert.equal(done.result.output, 'requested-1: 4\n\nrequested-2: 12\n\nrequested-3: -1\n\nrequested-4: 12');
  assert.equal(localRecord.task_quality, 'task_verified', 'the local answer is verified at the source');
  // A wrong answer is still refused, whatever the operator.
  const wrong = explicitTask(stateDir, [{surface: 'codex', instruction: '6*2'}]);
  const second = await createRCCRuntime({stateDir: join(stateDir, 'wrong'),
    catalog: async task => catalog(task), plan: async () => plan(wrong, [routeNode(0, [{surface: 'codex', instruction: '6*2'}])]),
    execute: async ticket => nativeRecord(join(stateDir, 'wrong'), ticket, '8'),
    verifyTask: evidence => verifyExactExplicitArithmetic(evidence, {stateDir: join(stateDir, 'wrong')})});
  t.after(async () => { await second.close(); });
  await mkdir(join(stateDir, 'wrong'), {recursive: true, mode: 0o700});
  await second.submit(wrong);
  const refused = await wait(second, wrong);
  assert.equal(refused.result?.task_verified ?? false, false);
});
