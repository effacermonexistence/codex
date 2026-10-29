// Cross-language integration. Build os1 and OS1ContextTests first, then run:
// OS1_INTENT_NATIVE_TEST=1 node --test scripts/fixtures/openclaw-rcc-intent-native.test.mjs
// Real compiler/decoder and SQLite Core; injected completions/executors only.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, chmod, writeFile, readFile, rm, realpath} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createRCCRuntime, hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {routingIntentResolver} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';

const run = promisify(execFile), sha = x => createHash('sha256').update(x).digest('hex');
const root = fileURLToPath(new URL('../../', import.meta.url));
const binary = process.env.OS1_INTENT_BINARY || resolve(root, '.build/debug/os1');
const validator = process.env.OS1_INTENT_VALIDATOR || resolve(root, '.build/debug/OS1ContextTests');
const enabled = process.env.OS1_INTENT_NATIVE_TEST === '1';
const modelAnswer = '{"kind":"route_all","expressions":["1+1"],"named":[],"excluded":[],"other_instruction":false,"sends_pointed_content":false}';

test('real native compiler → same Core task → exact native derived decoder; tampering rejected', {skip: !enabled}, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'os1-intent-native-')));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, {recursive: true, force: true}));
  let nativeCalls = 0, modelCalls = 0, executorCalls = 0, validations = 0;
  async function privateJSON(value) {
    const path = join(directory, randomUUID() + '.json');
    await writeFile(path, JSON.stringify(value), {mode: 0o600, flag: 'wx'}); return path;
  }
  async function native(operation, payload) {
    assert.equal(operation, 'rcc-intent'); nativeCalls++;
    const path = await privateJSON(payload);
    const result = await run(binary, [operation, '--request-file', path], {
      timeout: 10_000, env: {...process.env, OS1_RCC_ADAPTER_CHILD: '1'}}).catch(error => { console.error('native compiler failed:', error.stderr || error.message); throw error; });
    return JSON.parse(result.stdout);
  }
  async function validate(value, rejected = false) {
    const path = await privateJSON(value);
    const operation = () => run(validator, ['--rcc-core-validate-request', path], {timeout: 10_000});
    if (rejected) await assert.rejects(operation());
    else assert.equal(JSON.parse((await operation()).stdout).validated, true);
    validations++;
  }
  function request(text) {
    const routing = 'Synthetic fixture: preserve original recipients and scope.', projection = 'No parity claim.';
    const policy = routing + '\n' + projection;
    const host = {workspace: directory, context: null, provider_preference: 'claude',
      codex_session_id: null, claude_session_id: null, require_read_only: false, owner_policy: null, explicit_routes: null};
    return {schema: 1, task_id: randomUUID(), request: text, request_sha256: sha(text), objective: text,
      policy_sha256: sha(policy), source_fingerprint: hostContextFingerprint(host), mode: 'auto',
      material_refs: [], budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20_000},
      host_context: host, policy: {source_sha256: sha('fixture'), projection_sha256: sha(policy), text: policy}};
  }
  // Resolver policy uses the actual task policy fallback, not live owner files.
  const oldPolicy = process.env.OS1_RCC_PUBLIC_POLICY;
  process.env.OS1_RCC_PUBLIC_POLICY = 'Synthetic fixture: preserve original recipients and scope.\nNo parity claim.';
  t.after(() => { if (oldPolicy === undefined) delete process.env.OS1_RCC_PUBLIC_POLICY; else process.env.OS1_RCC_PUBLIC_POLICY = oldPolicy; });
  const resolver = routingIntentResolver({native, complete: async input => {
    modelCalls++; assert.equal(input.reasoning, 'off');
    assert.equal(Object.keys(input.responseFormat.properties)[0], 'kind');
    return {provider: 'ollama', model: 'qwen3.5:4b', text: modelAnswer, stopReason: 'stop',
      execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}};
  }});
  for (const text of ['다 라우팅 해봐 1+1', '다 넘겨봐 1+1']) {
    const task = request(text), original = structuredClone(task);
    const stateDir = join(directory, task.task_id);
    const runtime = await createRCCRuntime({stateDir, resolveIntent: resolver,
      catalog: async effective => {
        await validate(effective);
        const forged = structuredClone(effective);
        forged.core_routing.resolution_sha256 = '0'.repeat(64); await validate(forged, true);
        const now = Date.now();
        return {schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
          candidates: effective.host_context.explicit_routes.map(route => ({id: route.surface,
            surface: route.surface, transport: route.surface === 'local' ? 'local' : route.surface === 'codex' ? 'codex_app_server' : 'claude_cli',
            account_id: route.surface === 'local' ? 'os1-local' : 'fixture',
            model: route.surface === 'local' ? 'qwen3.5:4b' : 'fixture', effort: route.surface === 'local' ? 'none' : 'medium',
            tools: [], scope: 'read_only', permission_profile: 'read_only',
            quota_pool: route.surface === 'local' ? 'none' : route.surface === 'codex' ? 'openai_codex' : 'anthropic_shared',
            allowed_paths: [], configuration_sha256: sha(route.surface), availability: 'available',
            availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 60_000,
            quota_remaining_fraction: route.surface === 'local' ? null : 0.8, quota_observed_at_ms: route.surface === 'local' ? null : now - 1, quota_valid_until_ms: route.surface === 'local' ? null : now + 60_000,
            quality_state: 'policy_admitted', estimated_cost_units: 1}))};
      }, plan: async ({task: effective}) => ({schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
        nodes: effective.host_context.explicit_routes.map((route, i) => ({id: `requested-${i + 1}`,
          instruction: route.instruction, dependencies: [], kind: 'agent', candidate_id: route.surface,
          scope: 'read_only', owned_paths: [], context_refs: []}))}),
      execute: async ticket => {
        executorCalls++; assert.equal(ticket.original_request, text); assert.equal(ticket.instruction, '1+1');
        assert(ticket.core_routing); assert.equal(ticket.selected_config.scope, 'read_only');
        return {schema: 1, task_id: task.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
          candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
          selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
          status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
          task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'synthetic output',
          native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null};
      }});
    try {
      await runtime.submit(task);
      const status = await runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 15_000});
      assert.equal(status.children.length, 4, JSON.stringify(status));
      assert.equal(status.state, 'returned_unverified', JSON.stringify(status));
      assert.equal(status.routing_intent.state, 'routes');
      assert.deepEqual(task, original);
      const db = new DatabaseSync(join(stateDir, 'rcc-runtime.sqlite'), {readOnly: true});
      try { assert.deepEqual(JSON.parse(db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(task.task_id).snapshot).task, original); }
      finally { db.close(); }
    } finally { await runtime.close(); }
  }
  for (const text of ['엄마 아빠한테 다 보내봐 1+1', '다 라우팅 해봐 아까 거']) {
    const result = await native('rcc-intent', {schema: 1, task: request(text)});
    assert.notEqual(result.kind, 'routes'); assert.notEqual(result.kind, 'needs_model');
  }
  assert.equal(modelCalls, 1); assert.equal(nativeCalls, 5); assert.equal(executorCalls, 8);
  assert(validations >= 4);
  console.log('Actual Swift compiler/decoder + JS Core: PASS; injected completions/executions only, provider calls 0.');
});
