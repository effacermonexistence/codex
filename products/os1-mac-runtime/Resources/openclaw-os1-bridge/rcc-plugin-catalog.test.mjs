import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {assertLocalPlannerCompletion, buildBoundedPlannerInput, buildRoutePlanSchema,
  compactCandidateCatalog,
  plannerCompletionRequest,
  expandCandidateCatalog} from './rcc-plugin.mjs';

function catalog(count, distinctModels = false) {
  const now = 1_786_000_000_000;
  return {schema: 1, task_id: 'test-task', request_sha256: 'a'.repeat(64),
    candidates: Array.from({length: count}, (_, i) => ({
      id: `cfg-${String(i).padStart(3, '0')}`, surface: 'codex',
      transport: 'codex_app_server', account_id: 'account-A',
      model: distinctModels ? `gpt-family-${i}` : 'gpt-family-latest', effort: 'max',
      tools: ['read', 'execute'], scope: 'read_only', permission_profile: 'read_only',
      quota_pool: 'openai_codex', allowed_paths: [],
      configuration_sha256: i.toString(16).padStart(64, '0'),
      availability: 'available', availability_observed_at_ms: now,
      availability_valid_until_ms: now + 120_000,
      quota_remaining_fraction: 0.5, quota_observed_at_ms: now,
      quota_valid_until_ms: now + 120_000,
      quality_state: 'policy_admitted', estimated_cost_units: null}))};
}

function task() { return {task_id: 'test-task', request_sha256: 'a'.repeat(64),
  objective: 'Choose one exact surface for this bounded task',
  request: 'Choose one exact surface for this bounded task', material_refs: [],
  host_context: {explicit_routes: null, context: null}}; }

test('lossless grouped catalog preserves every candidate and original index after 64', () => {
  for (const count of [65, 128, 256]) {
    const original = catalog(count);
    const compact = compactCandidateCatalog(original);
    const expanded = expandCandidateCatalog(compact);
    assert.deepEqual(expanded, original.candidates);
    assert.equal(expanded.at(-1).id, `cfg-${String(count - 1).padStart(3, '0')}`);
    assert.equal(compact.candidate_count, count);
    assert.ok(JSON.stringify(compact).length < JSON.stringify(original.candidates).length);
  }
});

test('even distinct newer model rows remain exact, not filtered or re-ranked', () => {
  const original = catalog(80, true), compact = compactCandidateCatalog(original);
  const expanded = expandCandidateCatalog(compact);
  assert.deepEqual(expanded, original.candidates);
  assert.equal(expanded[79].model, 'gpt-family-79');
  const prompt = buildBoundedPlannerInput({task: task(), catalog: original,
    feedback: {}, policyText: 'RCC owner policy fixture'});
  const payload = JSON.parse(prompt.message.slice('OS1_RCC_PLAN\n'.length));
  assert.equal(payload.candidate_catalog.candidate_count, 80);
  assert.equal(expandCandidateCatalog(payload.candidate_catalog)[79].id, 'cfg-079');
  assert.ok(prompt.instructions.includes('do not omit, alias or invent an ID'));
});

test('122-row fourteen-model inventory fits with 18.5KB policy after lossless variant grouping', () => {
  const original = catalog(122);
  original.candidates.forEach((row, index) => {
    row.model = `fixture-model-${Math.floor(index / 9)}`;
    row.effort = ['low', 'medium', 'max'][index % 3];
    row.surface = index % 2 ? 'gpt-chat' : 'codex';
  });
  const compact = compactCandidateCatalog(original);
  assert.equal(compact.groups.length, 14);
  assert.deepEqual(expandCandidateCatalog(compact), original.candidates);
  const prompt = buildBoundedPlannerInput({task: task(), catalog: original,
    feedback: {}, policyText: 'p'.repeat(18_554)});
  assert.ok(Buffer.byteLength(prompt.instructions) + Buffer.byteLength(prompt.message) <= 48_000);
  assert.equal(expandCandidateCatalog(JSON.parse(prompt.message.slice('OS1_RCC_PLAN\n'.length))
    .candidate_catalog).at(-1).id, 'cfg-121');
});

test('planner input refuses over-budget policy/inventory rather than truncating candidates', () => {
  const all = catalog(256, true);
  assert.throws(() => buildBoundedPlannerInput({task: task(), catalog: all,
    feedback: {}, policyText: 'p'.repeat(47_000)}), /planner_input_budget_exceeded/);
  assert.throws(() => compactCandidateCatalog({candidates: Array(257).fill(all.candidates[0])}),
    /planner_catalog_invalid/);
  const bad = catalog(70); delete bad.candidates[69].id;
  assert.throws(() => compactCandidateCatalog(bad), /planner_candidate_field_missing/);
});

test('internal JSON mode is locked before/after full policy and official direct completion gets schema', () => {
  const policyText = 'RCC_FULL_POLICY_SENTINEL';
  const input = buildBoundedPlannerInput({task: task(), catalog: catalog(70),
    feedback: {}, policyText});
  assert.ok(input.instructions.startsWith('INTERNAL ROUTING PLAN ONLY.'));
  assert.ok(input.instructions.indexOf(policyText) > 0);
  assert.ok(input.instructions.lastIndexOf('INTERNAL ROUTING PLAN ONLY.') >
    input.instructions.indexOf(policyText));
  assert.ok(input.instructions.includes('Persona prefix Ben./LuaIsHere :3 is OFF'));
  const params = plannerCompletionRequest({...input, signal: new AbortController().signal});
  assert.equal(params.model, 'ollama/qwen3.5:4b');
  assert.deepEqual(params.messages, [{role: 'user', content: input.message}]);
  assert.equal(params.systemPrompt, input.instructions);
  assert.equal(params.responseFormat.type, 'object');
  assert.deepEqual(params.responseFormat.required,
    ['schema', 'task_id', 'request_sha256', 'nodes']);
  assert.equal(params.responseFormat.properties.nodes.maxItems, 8);
  assert.equal(params.responseFormat.properties.task_id.const, 'test-task');
  assert.equal(params.responseFormat.properties.request_sha256.const, 'a'.repeat(64));
  assert.equal(params.responseFormat.properties.nodes.items.properties.scope.const, 'read_only');
  assert.equal(params.responseFormat.properties.nodes.items.properties.owned_paths.maxItems, 0);
  assert.equal(params.responseFormat.properties.nodes.items.properties.context_refs.maxItems, 0);
  assert.equal(params.maxTokens, 4_096);
  assert.equal(Object.hasOwn(params, 'tools'), false);
  assert.equal(Object.hasOwn(params, 'execution'), false);
  const result = {text: '{"schema":1}', provider: 'ollama', model: 'qwen3.5:4b',
    responseModel: 'qwen3.5:4b', stopReason: 'stop',
    execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}};
  assert.equal(assertLocalPlannerCompletion(result), result.text);
  for (const invalid of [
    {...result, provider: 'openai'}, {...result, model: 'other'},
    {...result, stopReason: 'length'}, {...result, responseModel: 'other'},
    {...result, execution: {mode: 'isolated-agent-runtime', owner: {kind: 'harness', id: 'ollama'}}}
  ]) assert.throws(() => assertLocalPlannerCompletion(invalid), /planner_local_model_receipt_invalid/);
});

test('schema derives read-only, explicit count and mixed writer branch from trusted host state', () => {
  const fixed = task();
  fixed.mode = 'explicit_routing_test';
  fixed.host_context.require_read_only = true;
  fixed.host_context.explicit_routes = [
    {surface: 'codex', instruction: '1+1'}, {surface: 'codex', instruction: '2+2'}];
  const mixed = catalog(2);
  mixed.candidates[1].scope = 'workspace_write';
  mixed.candidates[1].permission_profile = 'workspace_write';
  mixed.candidates[1].allowed_paths = ['**'];
  const locked = buildRoutePlanSchema(fixed, mixed);
  assert.equal(locked.properties.nodes.minItems, 2);
  assert.equal(locked.properties.nodes.maxItems, 2);
  assert.equal(Object.hasOwn(locked.properties, 'final_node_id'), false);
  assert.equal(locked.properties.nodes.items.properties.scope.const, 'read_only');
  assert.equal(locked.properties.nodes.items.properties.owned_paths.maxItems, 0);
  assert.equal(locked.properties.nodes.items.properties.kind.const, 'agent');
  const writableTask = task(); writableTask.host_context.require_read_only = false;
  writableTask.material_refs = ['provided.txt'];
  const branched = buildRoutePlanSchema(writableTask, mixed).properties.nodes.items;
  assert.equal(branched.oneOf.length, 2);
  assert.equal(branched.oneOf[0].properties.scope.const, 'read_only');
  assert.equal(branched.oneOf[0].properties.owned_paths.maxItems, 0);
  assert.equal(branched.oneOf[1].properties.scope.const, 'workspace_write');
  assert.equal(branched.oneOf[1].properties.owned_paths.minItems, 1);
  assert.deepEqual(branched.oneOf[0].properties.context_refs.items.enum, ['provided.txt']);
});

test('pinned OpenClaw 2026.9.9 contract exposes direct responseFormat and Ollama native format', async t => {
  const dist = join(homedir(), 'Library/Application Support/OS-1/tools/openclaw-2026.9.9',
    'node_modules/openclaw/dist');
  let types, stream;
  try {
    types = await readFile(join(dist, 'types-DuAVdnLS.d.ts'), 'utf8');
    stream = await readFile(join(dist, 'stream.runtime-BPTCQ6OM.mjs'), 'utf8');
  } catch { t.skip('pinned OpenClaw bundle not installed on this runner'); return; }
  const direct = types.slice(types.indexOf('type LlmDirectCompleteParams ='),
    types.indexOf('type LlmIsolatedAgentRuntimeCompleteParams ='));
  const subagent = types.slice(types.indexOf('type SubagentCompleteParams ='),
    types.indexOf('type PluginManagedWorktree ='));
  assert.ok(direct.includes('responseFormat?: Record<string, unknown>;'));
  assert.equal(subagent.includes('responseFormat'), false);
  assert.ok(stream.includes('function resolveOllamaResponseFormat('));
  assert.ok(stream.includes('format: responseFormat'));
});
