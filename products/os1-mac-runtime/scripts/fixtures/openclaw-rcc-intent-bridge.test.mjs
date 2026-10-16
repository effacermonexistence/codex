import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {routingIntentResolver} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const routing = 'Synthetic bounded RCC policy', projection = 'No permissions or parity invented';
const task = {schema: 1, task_id: 'intent-fixture', request: 'all models: 1+1',
  request_sha256: sha('all models: 1+1'), policy_sha256: sha(routing + '\n' + projection),
  source_fingerprint: sha('original-host'), host_context: {owner_policy: {routing, projection}}};
const result = kind => ({schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
  policy_sha256: task.policy_sha256, source_fingerprint: task.source_fingerprint,
  kind, routes: [], best_effort: false, notices: [], reason: null});
const probe = () => ({...result('needs_model'), model_prompt: 'Classifier schema only',
  model_input: 'all models: 1+1', model_schema: {type: 'object'}, model_schema_json: '{"type":"object"}'});
const answer = '{"kind":"route_all"}';
const completion = () => ({provider: 'ollama', model: 'qwen3.5:4b',
  execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}},
  stopReason: 'stop', text: answer});

test('ordinary compiler result makes no intent model call', async () => {
  let nativeCalls = 0, modelCalls = 0;
  const resolve = routingIntentResolver({native: async (operation, payload) => {
    assert.equal(operation, 'rcc-intent'); assert.equal(payload.task, task);
    nativeCalls++; return result('ordinary');
  }, complete: async () => {modelCalls++; throw Error('must not run');}});
  assert.equal((await resolve({task})).kind, 'ordinary');
  assert.equal(nativeCalls, 1); assert.equal(modelCalls, 0);
});

test('same Core operation proposes once and independently admits exact raw answer', async () => {
  let nativeCalls = 0, modelCalls = 0;
  const controller = new AbortController();
  const resolve = routingIntentResolver({native: async (operation, payload, signal) => {
    assert.equal(operation, 'rcc-intent'); assert.equal(payload.task, task);
    assert(signal instanceof AbortSignal); nativeCalls++;
    if (!Object.hasOwn(payload, 'answer')) return probe();
    assert.equal(payload.answer, answer); return {...result('routes'),
      routes: [{surface: 'local', instruction: '1+1'}]};
  }, complete: async request => {
    modelCalls++; assert.equal(request.model, 'ollama/qwen3.5:4b');
    assert.equal(request.messages[0].content, probe().model_input);
    assert(request.systemPrompt.includes(routing));
    assert(request.systemPrompt.includes('INTERNAL ROUTING INTENT ONLY'));
    assert.equal(request.purpose, 'os1.rcc.internal-routing-intent');
    assert.equal(request.maxTokens, 192); assert.equal(request.reasoning, 'off'); assert(request.signal instanceof AbortSignal);
    return completion();
  }});
  const admitted = await resolve({task, signal: controller.signal});
  assert.equal(admitted.model_answer, answer); assert.equal(admitted.kind, 'routes');
  assert.equal(nativeCalls, 2); assert.equal(modelCalls, 1);
});

test('wrong source probe is rejected before model or admission', async () => {
  const resolve = routingIntentResolver({native: async () => ({...probe(), task_id: 'other'}),
    complete: async () => {throw Error('must not run');}});
  await assert.rejects(resolve({task}), /intent_source_binding_invalid/);
});

test('nonlocal model receipt cannot become a native admission', async () => {
  let calls = 0;
  const resolve = routingIntentResolver({native: async () => {calls++; return probe();},
    complete: async () => ({...completion(), model: 'another-model'})});
  await assert.rejects(resolve({task}), /intent_local_model_receipt_invalid/);
  assert.equal(calls, 1);
});

test('pre-cancelled task calls neither compiler nor model', async () => {
  const controller = new AbortController(); controller.abort();
  const resolve = routingIntentResolver({native: async () => {throw Error('must not run');},
    complete: async () => {throw Error('must not run');}});
  await assert.rejects(resolve({task, signal: controller.signal}), /intent_cancelled/);
});

test('late completion after service cancellation never reaches second compiler', async () => {
  const controller = new AbortController(); let calls = 0;
  const resolve = routingIntentResolver({lifetimeSignal: () => controller.signal,
    native: async () => {calls++; return probe();}, complete: async () => {
      controller.abort(); return completion();
    }});
  await assert.rejects(resolve({task}), /intent_cancelled/); assert.equal(calls, 1);
});

test('changed source on final compiler result is rejected', async () => {
  let calls = 0;
  const resolve = routingIntentResolver({native: async () => ++calls === 1 ? probe() :
    {...result('routes'), source_fingerprint: sha('wrong')}, complete: async () => completion()});
  await assert.rejects(resolve({task}), /intent_source_binding_invalid/);
});

test('compiler cannot request unbounded repeated classification', async () => {
  const resolve = routingIntentResolver({native: async () => probe(), complete: async () => completion()});
  await assert.rejects(resolve({task}), /intent_compiler_did_not_settle/);
});


test('schema literal preserves property order but cannot substitute another schema', async () => {
  const ordered = {type: 'object', properties: {kind: {type: 'string'}, expressions: {type: 'array'}}};
  const canonical = {properties: {expressions: {type: 'array'}, kind: {type: 'string'}}, type: 'object'};
  const resolve = routingIntentResolver({native: async (_, payload) => Object.hasOwn(payload, 'answer') ? result('ordinary') :
    {...probe(), model_schema: canonical, model_schema_json: JSON.stringify(ordered)}, complete: async request => {
      assert.deepEqual(Object.keys(request.responseFormat.properties), ['kind', 'expressions']); return completion();
    }});
  assert.equal((await resolve({task})).kind, 'ordinary');
  let calls = 0;
  const mismatch = routingIntentResolver({native: async () => ({...probe(), model_schema_json: '{"type":"array"}'}),
    complete: async () => {calls++; return completion();}});
  await assert.rejects(mismatch({task}), /intent_model_contract_invalid/); assert.equal(calls, 0);
});
