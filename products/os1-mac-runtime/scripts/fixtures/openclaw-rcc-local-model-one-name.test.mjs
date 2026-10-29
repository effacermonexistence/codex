// Build 446 (DESIGN-5 §B, owner order 2026-10-29): ONE local model per
// machine. The Swift host decides it and passes the name in the plugin config
// (`local_model`); the plugin configures it once and Core, the plugin and the
// planner read only that binding. This file deliberately does NOT import
// local-model-fixture.mjs: it starts unconfigured. Also §A: the zero-model
// calculator's closed range-sum grammar. Offline: no model, provider or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {LOCAL_WORKER_MODEL, localWorkerRow, zeroModelArithmetic, integerRangeSum}
  from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {configureLocalModel, isLocalModelID, localModelID, validateLocalUsageEvent}
  from '../../Resources/openclaw-os1-bridge/resource-usage.mjs';
import {assertLocalModelCompletion, localWorkerCompletionRequest, registerRCCRuntime, adaptiveRuntimeOptions}
  from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {localPlanModel} from '../../Resources/openclaw-os1-bridge/local-plan-planner.mjs';

const row = model => ({surface: 'local', transport: 'local', quota_pool: 'none', model, tools: [],
  scope: 'read_only', permission_profile: 'read_only'});
const completion = model => ({provider: 'ollama', model, stopReason: 'stop', text: 'hi',
  execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}});
const event = model => ({id: '00000000-0000-4000-8000-000000000000', stage: 'plan_proposal', state: 'not_needed',
  provider: 'ollama', model, usage: null, elapsed_ms: 0, observed_at_ms: 1, usage_basis: 'openclaw_input_excludes_cache',
  reason: 'fixture'});

test('unconfigured: there is no local model, and every local path fails closed', () => {
  assert.equal(LOCAL_WORKER_MODEL, null);
  assert.equal(localModelID(), null);
  assert.equal(localPlanModel(), null);
  assert.equal(localWorkerRow(row('qwen3.5:4b')), false);
  assert.throws(() => assertLocalModelCompletion(completion('qwen3.5:4b'), 'fixture_code'), /fixture_code/);
});

test('the plugin config names the one model; Core, the plugin and the planner follow it', () => {
  const hooks = {};
  const api = {pluginConfig: {bounded_auto: true, local_model: 'qwen3.5:9b'}, on(name, handler) { hooks[name] = handler; },
    registerService() {}, registerGatewayMethod() {}, registerTool() {}, registerCommand() {},
    runtime: {llm: {complete: async () => { throw Error('no model calls'); }}}};
  registerRCCRuntime(api);
  assert.equal(LOCAL_WORKER_MODEL, 'qwen3.5:9b', 'the live binding Core reads');
  assert.deepEqual(hooks.before_model_resolve(), {providerOverride: 'ollama', modelOverride: 'qwen3.5:9b'});
  assert.equal(localModelID(), 'ollama/qwen3.5:9b');
  assert.equal(localPlanModel(), 'ollama/qwen3.5:9b');
  assert.equal(localWorkerCompletionRequest({instruction: '1+1', signal: undefined}).model, 'ollama/qwen3.5:9b');
  assert.equal(localWorkerRow(row('qwen3.5:9b')), true);
  assert.equal(localWorkerRow(row('qwen3.5:4b')), false, 'a row of another model is not the local worker');
  assert.equal(assertLocalModelCompletion(completion('qwen3.5:9b'), 'fixture_code'), 'hi');
  assert.equal(assertLocalModelCompletion(completion('ollama/qwen3.5:9b'), 'fixture_code'), 'hi');
  assert.throws(() => assertLocalModelCompletion(completion('qwen3.5:4b'), 'fixture_code'), /fixture_code/);
  // The plugin config key is accepted by the strict host configuration reader.
  assert.doesNotThrow(() => adaptiveRuntimeOptions({pluginConfig: {bounded_auto: true, local_model: 'qwen3.5:9b'},
    complete: async () => null, lifetimeSignal: () => null, stateDir: null}));
  // Persisted events of any OS-1 local model still validate; a foreign id does not.
  for (const model of ['ollama/qwen3.5:4b', 'ollama/qwen3.5:9b']) assert.doesNotThrow(() => validateLocalUsageEvent(event(model)));
  for (const model of ['qwen3.5:9b', 'openai/gpt-6', 'ollama/', 'ollama/Qwen3.5:9B', null])
    assert.throws(() => validateLocalUsageEvent(event(model)), /local_resource_event_invalid/);
  assert.equal(isLocalModelID('ollama/qwen3.5:9b'), true);
});

test('only a model name configures the local model', () => {
  for (const bad of ['', 'Qwen3.5:9b', 'qwen3.5', 'ollama/qwen3.5:9b', 'qwen3.5:9b; rm -rf', null, 7])
    assert.throws(() => configureLocalModel(bad), /local_model_config_invalid/);
  assert.equal(LOCAL_WORKER_MODEL, 'qwen3.5:9b', 'a rejected name changes nothing');
});

test('the calculator answers the owner range sums exactly and holds every other shape', () => {
  for (const [text, expected] of [
    ['1부터 10까지 더하면 얼마야?', '55'], ['1부터 100까지 더하면 얼마야?', '5050'],
    ['1부터 1000000000000까지 더하면 얼마야?', '500000000000500000000000'],
    ['1부터 999999999999999까지 합은?', '499999999999999500000000000000'],
    ['1에서 10까지 다 더한 값은 얼마예요?', '55'], ['1부터 10까지의 합', '55'], ['5부터 5까지 더하면?', '5'],
    ['0부터 3까지 다 더하면 몇이야', '6'], ['sum of 1..10', '55'], ['What is the sum of the integers from 1 to 100?', '5050'],
    ['the sum of numbers from 3 through 4', '7'], ['１부터 １０까지 더하면 얼마야？', '55']]) {
    assert.equal(zeroModelArithmetic(text), expected, text);
    assert.equal(integerRangeSum(text), expected, text);
  }
  for (const text of ['1부터 10까지 곱하면 얼마야?', '1부터 10까지 홀수만 더하면 얼마야?', '10부터 1까지 더하면 얼마야?',
    '01부터 10까지 더하면?', '1부터 10까지 더하면 얼마야? 그리고 2부터 3까지는?', '1.5부터 10까지 더하면?',
    '-1부터 10까지 더하면?', '일부터 십까지 더하면 얼마야?', '1부터 1000000000000000까지 더하면 얼마야?',
    '1부터 10까지 더하면 얼마야 그리고 이것도', 'sum of 1..n', 'sum of 1 to 10 and 20', '1부터 10까지 더하는 코드 짜줘',
    '1부터 10까지', '1부터10까지더하면얼마야요', 'x'.repeat(200)]) {
    assert.equal(zeroModelArithmetic(text), null, text);
  }
});
