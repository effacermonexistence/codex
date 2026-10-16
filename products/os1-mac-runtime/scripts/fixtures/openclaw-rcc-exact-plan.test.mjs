// Exact explicit diagnostics keep real requested worker executions but do not
// ask a model to re-plan their already-bound recipients, payloads and scope.
// Real Core/plugin/SQLite + fake native/LLM receipts only; no provider/network.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {deterministicExplicitArithmeticPlan, LOCAL_WORKER_PURPOSE,
  registerRCCRuntime} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {hostContextFingerprint, LOCAL_WORKER_MODEL, resolveRoutePlan}
  from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ROUTES = [{surface: 'local', instruction: '1+1'}, {surface: 'codex', instruction: '2+2'},
  {surface: 'claude', instruction: '3+3'}, {surface: 'claude-chat', instruction: '4+4'}];
function task(root, routes = ROUTES) {
  const request = 'A fixed exact diagnostic on the owner-named routes.', policy = 'Keep the whole fixture policy unchanged.';
  const host = {workspace: root, context: 'Owner context must not disappear.', provider_preference: 'auto',
    codex_session_id: null, claude_session_id: null, require_read_only: true, owner_policy: null,
    explicit_routes: structuredClone(routes)};
  return {schema: 1, task_id: randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policy), source_fingerprint: hostContextFingerprint(host), mode: 'explicit_routing_test', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20_000},
    host_context: host, policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policy), text: policy}};
}
function row(id, surface, model, effort) {
  const now = Date.now(), local = surface === 'local';
  return {id, surface, transport: local ? 'local' : surface === 'codex' ? 'codex_app_server' : 'claude_cli',
    account_id: local ? 'os1-local' : 'fixture-account', model, effort, tools: [], scope: 'read_only',
    permission_profile: 'read_only', quota_pool: local ? 'none' : surface === 'codex' ? 'openai_codex' : 'anthropic_shared',
    allowed_paths: [], configuration_sha256: sha(id), availability: 'available',
    availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 60_000,
    quota_remaining_fraction: local ? null : 0.8, quota_observed_at_ms: local ? null : now - 1,
    quota_valid_until_ms: local ? null : now + 60_000, quality_state: 'policy_admitted', estimated_cost_units: null};
}
function catalog(request) {
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    candidates: [row('local', 'local', LOCAL_WORKER_MODEL, 'none'),
      row('codex-low', 'codex', 'gpt-6-luna', 'low'), row('codex-max', 'codex', 'gpt-6-luna', 'max'),
      row('codex-frontier', 'codex', 'gpt-6-astra', 'max'),
      row('claude-fast', 'claude', 'claude-haiku-4-5-20251001', 'none'),
      row('claude-frontier', 'claude', 'claude-fable-5-1', 'max'),
      row('chat-fast', 'claude-chat', 'claude-haiku-4-5-20251001', 'none'),
      row('chat-frontier', 'claude-chat', 'claude-fable-5-1', 'max')],
    model_tiers: {'gpt-6-luna': 'fast', 'gpt-6-astra': 'frontier',
      'claude-haiku-4-5-20251001': 'fast', 'claude-fable-5-1': 'frontier'}};
}

test('pure exact plan preserves original ordinals, context and policy; it emits agent nodes, not arithmetic answers', () => {
  const request = task('/tmp/fixture'), original = structuredClone(request), rows = catalog(request);
  const plan = deterministicExplicitArithmeticPlan(request, rows);
  assert.deepEqual(plan, {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    nodes: ROUTES.map((route, index) => ({id: `requested-${index + 1}`, instruction: route.instruction, dependencies: [],
      kind: 'agent', route_class: 'trivial', scope: 'read_only', owned_paths: [], context_refs: []}))});
  assert.deepEqual(request, original);
  request.host_context.explicit_routes[1].skipped = true;
  assert.deepEqual(deterministicExplicitArithmeticPlan(request, rows).nodes.map(node => node.id),
    ['requested-1', 'requested-3', 'requested-4']);
  const withGPT = task('/tmp/fixture', [{surface: 'chatgpt', instruction: '1+1'}, ...ROUTES]);
  assert.deepEqual(deterministicExplicitArithmeticPlan(withGPT, catalog(withGPT)).nodes.map(node => node.id),
    ['requested-2', 'requested-3', 'requested-4', 'requested-5']);
});

test('same host binder still applies per-route max effort and model-family constraints', () => {
  const request = task('/tmp/fixture', [{surface: 'codex', instruction: '1+1'}]);
  const rows = catalog(request); rows.explicit_route_intents = [{effort: 'max', model_family: null}];
  let resolved = resolveRoutePlan(deterministicExplicitArithmeticPlan(request, rows), request, rows, Date.now());
  assert.equal(resolved.decisions['requested-1'].effort, 'max');
  rows.explicit_route_intents = [{effort: 'max', model_family: 'astra'}];
  resolved = resolveRoutePlan(deterministicExplicitArithmeticPlan(request, rows), request, rows, Date.now());
  assert.equal(resolved.decisions['requested-1'].model, 'gpt-6-astra');
  assert.equal(resolved.decisions['requested-1'].effort, 'max');
  rows.candidates = rows.candidates.filter(row => row.id !== 'codex-frontier');
  rows.model_tiers = {'gpt-6-luna': 'fast', 'claude-haiku-4-5-20251001': 'fast', 'claude-fable-5-1': 'frontier'};
  assert.throws(() => resolveRoutePlan(deterministicExplicitArithmeticPlan(request, rows), request, rows, Date.now()),
    /no_dispatchable_candidate/);
});

test('unsupported tasks and legacy/unknown catalogs abstain, never replacing free text, material or write work', () => {
  const original = task('/tmp/fixture');
  const change = [
    request => { request.mode = 'auto'; }, request => { request.host_context.require_read_only = false; },
    request => { request.material_refs = ['image']; }, request => { delete request.host_context.explicit_routes; },
    request => { request.host_context.explicit_routes = []; },
    request => { request.host_context.explicit_routes[0].instruction = 'Summarize this sentence'; },
    request => { request.host_context.explicit_routes[0].instruction = '1+1+1'; },
    request => { request.host_context.explicit_routes[0].instruction = '1.5+1'; },
    request => { request.host_context.explicit_routes[0].instruction = '1000000000+1'; },
    request => { request.host_context.explicit_routes[0].instruction = ['1+1']; },
    request => { request.host_context.explicit_routes[0].surface = 'unknown'; },
    request => { request.host_context.explicit_routes = [{surface: 'chatgpt', instruction: '1+1'}]; },
  ];
  for (const mutate of change) {
    const request = structuredClone(original); mutate(request);
    assert.equal(deterministicExplicitArithmeticPlan(request, catalog(request)), null);
  }
  for (const mutate of [rows => { delete rows.model_tiers; }, rows => { rows.model_tiers = null; },
    rows => { rows.model_tiers = []; }, rows => { rows.schema = 2; }, rows => { rows.task_id = 'wrong'; },
    rows => { rows.request_sha256 = sha('wrong'); }, rows => { rows.candidates = []; }]) {
    const rows = catalog(original); mutate(rows);
    assert.equal(deterministicExplicitArithmeticPlan(original, rows), null);
  }
});

async function runPlugin(t, count, {policyMismatch = false} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'os1-exact-plan-fixture-')); await chmod(root, 0o700);
  const request = task(root, ROUTES.slice(0, count)), rows = catalog(request);
  const native = join(root, 'native.mjs'), catalogPath = join(root, 'catalog.json');
  await writeFile(catalogPath, JSON.stringify(rows), {mode: 0o600});
  const body = `#!${process.execPath}
import fs from 'node:fs';import crypto from 'node:crypto';
const p=JSON.parse(fs.readFileSync(process.argv[4],'utf8')),home=process.env.HOME;
fs.appendFileSync(home+'/native-calls.log',process.argv[2]+'\\n');
if(process.argv[2]==='rcc-catalog'){console.log(fs.readFileSync(home+'/catalog.json','utf8'));process.exit(0);}
if(process.argv[2]!=='rcc-adapter')process.exit(97);
const parts=/^(-?\\d+)([+*-])(-?\\d+)$/.exec(p.instruction);if(!parts)process.exit(98);
const a=BigInt(parts[1]),b=BigInt(parts[3]),answer=String(parts[2]==='+'?a+b:parts[2]==='*'?a*b:a-b);
fs.mkdirSync(home+'/native-receipts',{recursive:true,mode:0o700});const path=home+'/native-receipts/'+crypto.randomUUID()+'.json';
const r={schema:1,task_id:p.task_id,node_id:p.node_id,attempt_id:p.attempt_id,candidate_id:p.candidate_id,
configuration_sha256:p.configuration_sha256,selected_config:p.selected_config,acknowledged_config:p.selected_config,
observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',output:answer,
execution_verified:true,task_verified:false,task_quality:'execution_only',parity_state:'unverified',native_receipt:path,native_summary:null};
fs.writeFileSync(path,JSON.stringify(r),{flag:'wx',mode:0o600});console.log(JSON.stringify(r));`;
  await writeFile(native, body, {mode: 0o700});
  const keys = ['OS1_RCC_STATE_ROOT', 'OS1_RCC_NATIVE_PATH', 'OS1_RCC_NATIVE_SHA256', 'OS1_RCC_NATIVE_HOME', 'OS1_RCC_PUBLIC_POLICY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {OS1_RCC_STATE_ROOT: root, OS1_RCC_NATIVE_PATH: native, OS1_RCC_NATIVE_SHA256: sha(body),
    OS1_RCC_NATIVE_HOME: root, OS1_RCC_PUBLIC_POLICY: policyMismatch ? 'Different policy must not dispatch.' : request.policy.text});
  let service, plannerCalls = 0, localWorkerCalls = 0;
  const methods = new Map();
  registerRCCRuntime({on() {}, registerService(value) { service = value; },
    registerGatewayMethod(name, callback) { methods.set(name, callback); }, runtime: {llm: {complete: async input => {
      if (input.purpose !== LOCAL_WORKER_PURPOSE) { plannerCalls++; throw Error('exact plan must not invoke a planner'); }
      localWorkerCalls++; assert.equal(input.model, 'ollama/qwen3.5:4b'); assert.equal(input.messages[0].content, '1+1');
      return {provider: 'ollama', model: LOCAL_WORKER_MODEL, text: '2', stopReason: 'stop',
        execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}, usage: {inputTokens: 30, outputTokens: 1}};
    }}}});
  const call = (name, params) => new Promise((resolve, reject) => {
    Promise.resolve(methods.get('os1.rcc.' + name)({params, respond(ok, result, error) {
      ok ? resolve(result) : reject(Error(error?.message)); }})).catch(reject);
  });
  try {
    await service.start({stateDir: root}); await call('submit', request);
    let result;
    for (let i = 0; i < 300; i++) {
      result = await call('status', {schema: 1, task_id: request.task_id});
      if (['completed', 'held', 'failed', 'effects_uncertain', 'returned_unverified'].includes(result.state)) break;
      await pause(10);
    }
    if (policyMismatch) {
      assert.equal(result.state, 'held'); assert.equal(result.error, 'planner_failed');
      assert.equal(plannerCalls, 0); assert.equal(localWorkerCalls, 0);
      assert.ok(result.children.every(child => child.attempt_id === null));
      const calls = (await readFile(join(root, 'native-calls.log'), 'utf8')).trim().split('\n');
      assert.ok(calls.every(operation => operation === 'rcc-catalog'), 'mismatched policy never reaches any adapter');
      return;
    }
    assert.equal(result.state, 'completed', result.error); assert.equal(result.result.task_verified, true);
    assert.equal(result.children.length, count); assert.equal(plannerCalls, 0); assert.equal(localWorkerCalls, 1);
    assert.deepEqual(result.children.map(child => child.selected_config.surface), ROUTES.slice(0, count).map(route => route.surface));
    assert.deepEqual(result.children.map(child => child.output_summary), ['2', '4', '6', '8'].slice(0, count));
    const calls = (await readFile(join(root, 'native-calls.log'), 'utf8')).trim().split('\n');
    assert.equal(calls.filter(operation => operation === 'rcc-adapter').length, count - 1,
      'every requested hosted worker still executes through the unchanged adapter');
    assert.equal((await readdir(join(root, 'native-receipts'))).length, count);
  } finally {
    await service.stop();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, {recursive: true, force: true});
  }
}
for (const count of [1, 4]) test(`production plugin: ${count} exact route(s), zero planner calls, every requested worker executes`,
  {concurrency: false, timeout: 12_000}, async t => runPlugin(t, count));
test('production exact path still verifies owner/public policy binding before any completion or worker execution',
  {concurrency: false, timeout: 12_000}, async t => runPlugin(t, 1, {policyMismatch: true}));
