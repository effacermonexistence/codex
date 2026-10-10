import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, chmod, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerRCCRuntime } from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');

// SDK admission analogue: a background completion in a released request scope
// is refused. The actual pinned Gateway is independently smoke-tested; this
// fixture catches the service/RPC lifetime regression without any model call.
test('durable local planner does not inherit a released submit RPC root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'os1-rcc-plugin-lifecycle-'));
  await chmod(root, 0o700);
  const keys = ['OS1_RCC_STATE_ROOT', 'OS1_RCC_NATIVE_PATH', 'OS1_RCC_NATIVE_SHA256',
    'OS1_RCC_NATIVE_HOME', 'OS1_RCC_PUBLIC_POLICY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const native = join(root, 'native.mjs');
  const body = `#!${process.execPath}\nimport{readFileSync}from'node:fs';import{createHash}from'node:crypto';
const p=JSON.parse(readFileSync(process.argv[4],'utf8'));const sha=s=>createHash('sha256').update(s).digest('hex');
if(process.argv[1]&&process.argv[2]==='rcc-catalog') {await new Promise(r=>setTimeout(r,35));const n=Date.now();console.log(JSON.stringify({schema:1,task_id:p.task_id,request_sha256:p.request_sha256,candidates:[{id:'fixture',surface:'gpt-chat',transport:'codex_app_server',account_id:'fixture',model:'fixture',effort:'low',tools:[],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:sha('fixture'),availability:'available',availability_observed_at_ms:n,availability_valid_until_ms:n+300000,quota_remaining_fraction:1,quota_observed_at_ms:n,quota_valid_until_ms:n+300000,quality_state:'policy_admitted',estimated_cost_units:1}]}));}
else if(process.argv[2]==='rcc-adapter')console.log(JSON.stringify({schema:1,task_id:p.task_id,node_id:p.node_id,attempt_id:p.attempt_id,candidate_id:p.candidate_id,configuration_sha256:p.configuration_sha256,selected_config:p.selected_config,acknowledged_config:p.selected_config,observed_config:null,status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',output:'hello',execution_verified:true,task_verified:false,task_quality:'execution_only',parity_state:'unverified',native_receipt:'private-fixture-receipt',usage:{provider_calls:0},error:null,native_summary:null}));else process.exit(91);`;
  await writeFile(native, body, { mode: 0o700 });
  const policy = 'Synthetic bounded source policy; no quality parity assertion.';
  Object.assign(process.env, { OS1_RCC_STATE_ROOT: root, OS1_RCC_NATIVE_PATH: native,
    OS1_RCC_NATIVE_SHA256: sha(body), OS1_RCC_NATIVE_HOME: root, OS1_RCC_PUBLIC_POLICY: policy });
  const requestScope = new AsyncLocalStorage();
  const methods = new Map(); let service, modelCalls = 0;
  const api = { on() {}, registerService(value) { service = value; },
    registerGatewayMethod(name, handler) { methods.set(name, handler); },
    runtime: { llm: { async complete(params) {
      await new Promise(resolve => setImmediate(resolve));
      if (requestScope.getStore()?.released) throw Object.assign(Error('Gateway is draining'), { name: 'GatewayDrainingError' });
      assert.equal(requestScope.getStore(), undefined, 'planner still owns transient RPC scope');
      assert.equal(params.model, 'ollama/qwen3.5:4b');
      assert(params.signal instanceof AbortSignal);
      modelCalls++;
      assert.equal(params.responseFormat.type, 'object');
      assert.equal(params.messages.length, 1);
      const value = JSON.parse(params.messages[0].content.split('\n').slice(1).join('\n'));
      return { provider: 'ollama', model: 'qwen3.5:4b',
        execution: { mode: 'direct-provider', owner: { kind: 'provider', id: 'ollama' } },
        stopReason: 'stop', text: JSON.stringify({ schema: 1, task_id: value.task_id,
        request_sha256: value.request_sha256, nodes: [{ id: 'n1', instruction: value.request,
          dependencies: [], kind: 'agent', candidate_id: 'fixture', scope: 'read_only',
          owned_paths: [], context_refs: [] }] }) };
    } } } };
  registerRCCRuntime(api);
  const call = (name, params) => new Promise((resolve, reject) => {
    Promise.resolve(methods.get('os1.rcc.' + name)({ params, respond(ok, result, error) {
      ok ? resolve(result) : reject(Error(error?.message));
    } })).catch(reject);
  });
  try {
    await service.start({ stateDir: root });
    const host = { workspace: root, context: null, provider_preference: 'auto',
      codex_session_id: null, claude_session_id: null, require_read_only: true, owner_policy: null };
    const sorted = Object.fromEntries(Object.keys(host).sort().map(key => [key, host[key]]));
    const request = 'Reply with hello only';
    const task = { schema: 1, task_id: randomUUID(), request, request_sha256: sha(request), objective: request,
      policy_sha256: sha(policy), source_fingerprint: sha(JSON.stringify(sorted)), mode: 'auto', material_refs: [],
      budget: { max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 20000 },
      host_context: host, policy: { source_sha256: sha(policy), projection_sha256: sha(policy), text: policy } };
    const rpcOwner = { released: false };
    await requestScope.run(rpcOwner, async () => { await call('submit', task); rpcOwner.released = true; });
    let snapshot; const until = Date.now() + 5000;
    do { await new Promise(resolve => setTimeout(resolve, 15)); snapshot = await call('status', { schema: 1, task_id: task.task_id }); }
    while (!['returned_unverified', 'completed', 'held', 'failed'].includes(snapshot.state) && Date.now() < until);
    assert.equal(snapshot.state, 'returned_unverified', snapshot.error);
    assert.equal(snapshot.children.length, 1);
    assert.equal(snapshot.children[0].output_summary, 'hello');
    assert.equal(snapshot.result.task_verified, false);
    assert.equal(snapshot.result.parity_state, 'unverified');
    assert.equal(modelCalls, 1);
    assert((await readdir(root)).some(name => name.startsWith('planner-output-')));
    const duplicate = await call('submit', task);
    assert.equal(duplicate.revision, snapshot.revision);
    assert.equal(modelCalls, 1);
  } finally {
    await service.stop();
    for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key];
    await rm(root, { recursive: true, force: true });
  }
});
