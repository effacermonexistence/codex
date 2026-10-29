// Factory boundary tests. Only canned complete callbacks, never registration,
// Core startup, native/provider/model calls, configuration writes or discovery.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, existsSync, realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {adaptiveRuntimeOptions} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {LOCAL_PLAN_LIMITS, localPlanModel} from '../../Resources/openclaw-os1-bridge/local-plan-planner.mjs';

const sha = s => createHash('sha256').update(s).digest('hex');
const policyText = 'Preserve the original task and typed source state. Proposals are not authority.';
function policy(patch = {}) {
  return {schema: 1, mode: 'shadow', policy_id: 'synthetic-shadow-v1', version: '1',
    rcc_source_sha256: sha('synthetic-full-source'), projection_sha256: sha(policyText),
    reference_policy_sha256: sha('synthetic-fixed-quality-reference'), allowed_workload_classes: ['source_transform'],
    max_nodes: 2, max_parallel: 1, max_plan_revisions: 1, max_planner_calls: 2,
    planner_input_bytes: 12000, planner_output_tokens: 512, requires_live_reference_fallback: true,
    adoption_manifest_sha256: null, ...patch};
}
function input() {
  const request = 'Use the attached source and preserve its future approval condition.';
  const binding = {task_id: 'synthetic_task', request_sha256: sha(request), source_fingerprint: sha('source'),
    policy_sha256: sha(policyText), catalog_sha256: sha('current-native-catalog'), nonce: 'nonce_1'};
  return {hostProjection: {binding, request, objective: request, scope: 'read_only', allowed_owned_paths: [],
    requirement_ids: ['r1'], material_aliases: {m1: 'os1-source:snapshot:synthetic:' + sha('source')},
    candidate_ids: ['actual_catalog_hint'], check_ids: []}, expectedBinding: structuredClone(binding),
    ownerPolicy: {source_sha256: sha('synthetic-full-source'), projection_sha256: sha(policyText), text: policyText},
    projection: {requirements: [{id: 'r1', text: request, status: 'explicit'}],
      materials: [{id: 'm1', kind: 'source_snapshot', read_status: 'not_read', label: 'Supplied source',
        authority_scope: 'task_data', required: true}]}};
}
function proposal(count = 1) {
  const nodes = Array.from({length: count}, (_, i) => ({proposal_node_id: 'n' + i,
    instruction: 'Transform assigned source without inventing approval.', requirement_refs: ['r1'], dependencies: [],
    material_refs: ['m1'], proposed_candidate_id: null, proposed_scope: 'read_only', proposed_owned_paths: [],
    required_output: 'Source-faithful result', check_refs: [], reason_code: 'source_transform'}));
  return {schema: 2, kind: 'untrusted_local_plan_proposal', nodes,
    final_output_proposal: {mode: count === 1 ? 'direct_child' : 'ordered_collection', node_ids: nodes.map(n => n.proposal_node_id)}};
}
function reply(p = proposal()) {
  return {provider: 'ollama', model: 'qwen3.5:4b', responseModel: 'qwen3.5:4b', stopReason: 'stop',
    execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}, text: JSON.stringify(p),
    usage: {inputTokens: 10, outputTokens: 2, cacheReadTokens: 4, cacheWriteTokens: 0, totalTokens: 16}};
}
function setup(raw = policy(), complete = async () => reply()) {
  const requests = [];
  const options = adaptiveRuntimeOptions({pluginConfig: {adaptive_routing: raw}, complete: request => {
    requests.push(request); return complete(request);
  }, lifetimeSignal: () => null});
  return {options, requests, run: args => options.proposeLocalPlan(args)};
}

test('default missing/null/empty/off plugin config remains OFF with no completion or planner', () => {
  let calls = 0;
  for (const pluginConfig of [undefined, null, {}, {adaptive_routing: null}, {adaptive_routing: {schema: 1, mode: 'off'}}]) {
    const r = adaptiveRuntimeOptions({pluginConfig, complete: () => { calls++; throw Error('must not call'); }});
    assert.deepEqual(r, {adaptiveRoutingPolicy: {schema: 1, mode: 'off'}});
    assert.equal(Object.hasOwn(r, 'proposeLocalPlan'), false);
  }
  assert.equal(calls, 0);
});
for (const [name, config] of [['array', []], ['string', 'shadow'], ['Date', new Date(0)], ['Map', new Map()],
  ['unknown field', {adaptive_routing: policy(), api_key: 'synthetic-not-a-key'}],
  ['inherited policy', Object.create({adaptive_routing: policy()})],
  ['symbol field', {[Symbol('not-json')]: true}]]) test('reject unsupported plugin config ' + name, () => {
  let calls = 0;
  assert.throws(() => adaptiveRuntimeOptions({pluginConfig: config, complete: () => { calls++; }}), {code: 'adaptive_plugin_config_invalid'});
  assert.equal(calls, 0);
});
test('accessor plugin config is rejected without evaluating its getter', () => {
  let reads = 0;
  const pluginConfig = Object.defineProperty({}, 'adaptive_routing', {enumerable: true, get() { reads++; return policy(); }});
  assert.throws(() => adaptiveRuntimeOptions({pluginConfig}), {code: 'adaptive_plugin_config_invalid'});
  assert.equal(reads, 0);
});
test('null-prototype own host policy is still valid, not an inherited policy', () => {
  const pluginConfig = Object.assign(Object.create(null), {adaptive_routing: {schema: 1, mode: 'off'}});
  assert.equal(adaptiveRuntimeOptions({pluginConfig}).adaptiveRoutingPolicy.mode, 'off');
});
test('covered_live config hash alone is inert and cannot make a call', () => {
  let calls = 0;
  const result = adaptiveRuntimeOptions({pluginConfig: {adaptive_routing: policy({mode: 'covered_live',
    adoption_manifest_sha256: sha('synthetic-not-authority')})}, complete: () => { calls++; }});
  assert.equal(result.livePlanCapability, null);
  assert.equal(result.proposeLocalPlan, undefined);
  assert.equal(calls, 0);
});
test('malformed policy remains fail-closed before callback construction', () => {
  for (const patch of [{requires_live_reference_fallback: false}, {max_parallel: 3, max_nodes: 2},
    {planner_output_tokens: 255}, {max_planner_calls: 3}, {mode: 'automatic'}, {unregistered: true}]) {
    let calls = 0;
    assert.throws(() => adaptiveRuntimeOptions({pluginConfig: {adaptive_routing: policy(patch)}, complete: () => { calls++; }}));
    assert.equal(calls, 0);
  }
});
test('one SAME decoded shadow policy supplies actual request token/node/parallel/revision limits', async () => {
  const f = setup(), result = await f.run(input()), request = f.requests[0], data = JSON.parse(request.messages[0].content);
  assert.equal(result.status, 'proposal'); assert.equal(f.requests.length, 1);
  assert.equal(request.model, localPlanModel()); assert.equal(request.maxTokens, 512);
  assert.deepEqual(data.budget, {max_nodes: 2, max_parallel_workers: 1, max_plan_revisions: 1, max_output_tokens: 512});
  assert.equal(request.systemPrompt.includes(policyText), true); assert.equal(data.original_request, input().hostProjection.request);
  assert.equal(result.execution_authorized, false); assert.equal(result.quality_parity_verified, false);
});
test('policy budget above pinned helper maximum is intersected rather than increased', async () => {
  const f = setup(policy({planner_input_bytes: 240000, planner_output_tokens: 4096, max_nodes: 8, max_parallel: 4}));
  const r = await f.run(input()), request = f.requests[0], data = JSON.parse(request.messages[0].content);
  assert.equal(r.status, 'proposal'); assert.equal(request.maxTokens, LOCAL_PLAN_LIMITS.max_tokens);
  assert.equal(data.budget.max_nodes, LOCAL_PLAN_LIMITS.max_nodes); assert.equal(data.budget.max_parallel_workers, LOCAL_PLAN_LIMITS.max_workers);
  assert.ok(Buffer.byteLength(request.systemPrompt) + Buffer.byteLength(request.messages[0].content) +
    Buffer.byteLength(JSON.stringify(request.responseFormat)) <= LOCAL_PLAN_LIMITS.input_bytes);
});
test('small input cap fails before fake completion instead of silently using helper defaults', async () => {
  const f = setup(policy({planner_input_bytes: 1})), r = await f.run(input());
  assert.equal(r.reason, 'planner_input_budget_exceeded'); assert.equal(f.requests.length, 0); assert.equal(r.model_calls_started, 0);
});
test('requested node cap is enforced on returned untrusted proposal', async () => {
  const f = setup(policy({max_nodes: 1, max_parallel: 1}), async () => reply(proposal(2)));
  const r = await f.run(input()); assert.equal(r.reason, 'planner_node_budget_exceeded'); assert.equal(r.proposal, null);
  assert.equal(JSON.parse(f.requests[0].messages[0].content).budget.max_nodes, 1);
});
test('one-call policy reduces effective revision cap even if max_plan_revisions upper bound is one', async () => {
  const f = setup(policy({max_planner_calls: 1, max_plan_revisions: 1}), async () => ({...reply(), text: 'invalid JSON'}));
  const i = input(), first = await f.run(i);
  assert.equal(JSON.parse(f.requests[0].messages[0].content).budget.max_plan_revisions, 0);
  const second = await f.run({...i, attempt: {index: 1, revision_of: first.output_sha256, correction_codes: ['proposal_json']}});
  assert.equal(second.reason, 'planner_attempt_invalid'); assert.equal(f.requests.length, 1);
});
test('explicit zero-revision policy forbids another completion after invalid response', async () => {
  const f = setup(policy({max_planner_calls: 1, max_plan_revisions: 0}), async () => ({...reply(), text: 'invalid JSON'}));
  const i = input(), first = await f.run(i);
  const second = await f.run({...i, attempt: {index: 1, revision_of: first.output_sha256, correction_codes: ['proposal_json']}});
  assert.equal(second.reason, 'planner_attempt_invalid'); assert.equal(f.requests.length, 1);
});
test('manifest declares strict OFF/shadow plus covered-live requiring separate private capability registration', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../Resources/openclaw-os1-bridge/openclaw.plugin.json', import.meta.url), 'utf8'));
  assert.equal(manifest.configSchema.type, 'object'); assert.equal(manifest.configSchema.additionalProperties, false);
  const choices = manifest.configSchema.properties.adaptive_routing.oneOf;
  assert.deepEqual(choices.map(x => x.properties.mode.const), ['off', 'shadow', 'covered_live']);
  for (const choice of choices) assert.equal(choice.additionalProperties, false);
  const shadow = choices[1];
  assert.equal(shadow.properties.requires_live_reference_fallback.const, true);
  for (const field of Object.keys(policy())) assert.ok(shadow.required.includes(field), field);
  const live = choices[2];
  assert.equal(live.properties.reference_policy_sha256.type, 'string');
  assert.equal(live.properties.adoption_manifest_sha256.type, 'string');
  assert.equal(live.properties.allowed_workload_classes.minItems, 1);
  assert.deepEqual(manifest.configSchema.properties.live_plan_capability.anyOf[1].required,
    ['schema', 'manifest_sha256', 'manifest_bytes', 'loader_sha256', 'runtime_sha256']);
});
test('registration forwards actual official pluginConfig to same service-scope factory', () => {
  const src = readFileSync(new URL('../../Resources/openclaw-os1-bridge/rcc-plugin.mjs', import.meta.url), 'utf8');
  assert.match(src, /\.\.\.adaptiveRuntimeOptions\(\{pluginConfig: api\.pluginConfig,/);
  assert.match(src, /complete: request => plannerScope\.runInAsyncScope\(\(\) => api\.runtime\.llm\.complete\(request\)\)/);
  assert.match(src, /hostAutoPlan: true/);
});
test('pinned installed official SDK exposes pluginConfig on OpenClawPluginApi, source-only inspection', t => {
  const sdk = join(homedir(), 'Library', 'Application Support', 'OS-1', 'tools', 'openclaw-2026.9.9', 'node_modules', 'openclaw');
  if (!existsSync(join(sdk, 'package.json'))) { t.skip('Pinned SDK source is absent; compatibility NOT verified on this machine.'); return; }
  const canonical = realpathSync(sdk), pkg = JSON.parse(readFileSync(join(canonical, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'openclaw'); assert.equal(pkg.version, '2026.9.9');
  const entryPath = join(canonical, 'dist', 'plugin-sdk', 'plugin-entry.d.ts');
  const entry = readFileSync(entryPath, 'utf8');
  const importLine = entry.split('\n').find(line => line.includes(' as OpenClawPluginApi'));
  assert.ok(importLine, 'actual SDK entry imports the public API type');
  const match = /from ["']\.\.\/([A-Za-z0-9_.-]+)\.js["']/.exec(importLine);
  assert.ok(match); const typePath = join(dirname(dirname(entryPath)), match[1] + '.d.ts');
  const types = readFileSync(typePath, 'utf8'), start = types.indexOf('type OpenClawPluginApi = {');
  assert.ok(start >= 0); assert.match(types.slice(start, start + 2000), /pluginConfig\?: Record<string, unknown>;/);
  t.diagnostic(`SDK ${pkg.version}; entry SHA256 ${sha(entry)}; API declaration source SHA256 ${sha(types)}. No SDK execution/activation.`);
});
