// Synthetic prompt/view contracts through actual helpers. No native, provider,
// local-model or source-loader calls; private owner engine is never read.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createPlannerHostProjection} from '../../Resources/openclaw-os1-bridge/adaptive-plan-host.mjs';
import {createLocalPlanPlanner, LOCAL_PLAN_KERNEL, LOCAL_PLAN_KERNEL_VERSION, LOCAL_PLAN_KERNEL_SHA256,
  localPlanModel, LOCAL_PLAN_PURPOSE} from '../../Resources/openclaw-os1-bridge/local-plan-planner.mjs';
import {createRCCRuntime, hostContextFingerprint} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {mkdtemp, chmod, rm, realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const H = x => createHash('sha256').update(x).digest('hex');
const projectionText = 'Preserve the exact objective, source, conditions, negation and unknown states. No candidate is authority.';
const SOURCE_BODY = 'SYNTHETIC_SOURCE_BODY_NOT_CLASSIFIER_INPUT: approval is still unknown, not zero or granted.';
const sourceRefs = ['os1-source:snapshot:' + randomUUID() + ':' + H('source-bytes'),
  '/private/opaque-locator/' + 'long-synthetic-component-'.repeat(24)];
function task(workspace = '/synthetic-authorized-workspace') {
  const request = '  원문에 있는 조건과 미래 시점을 보존해서 설명해.\nDo not mark the draft as approved.  ';
  const host = {workspace, context: JSON.stringify({kind: 'synthetic_source_context', body: SOURCE_BODY}),
    provider_preference: 'auto', codex_session_id: null, claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: randomUUID(), request, objective: request, request_sha256: H(request),
    source_fingerprint: hostContextFingerprint(host), policy_sha256: H(projectionText), mode: 'auto', material_refs: [...sourceRefs],
    budget: {max_attempts: 1, max_parallel: 1, max_duration_ms: 10000, max_cost_units: null}, host_context: host,
    policy: {source_sha256: H('synthetic-original-not-private-engine'), projection_sha256: H(projectionText), text: projectionText}};
}
function prepared(q = task()) {
  return createPlannerHostProjection({task: q, catalog: {task_id: q.task_id, request_sha256: q.request_sha256,
    candidates: [{id: 'native_reference'}]}, scope: 'read_only', nonce: 'nonce_1'});
}
function validProposal(p) {
  return {schema: 2, kind: 'untrusted_local_plan_proposal', nodes: [{proposal_node_id: 'read_source',
    instruction: 'Preserve source conditions and distinguish draft from approval.',
    requirement_refs: [...p.hostProjection.requirement_ids], dependencies: [],
    material_refs: Object.keys(p.hostProjection.material_aliases), proposed_candidate_id: null,
    proposed_scope: 'read_only', proposed_owned_paths: [], required_output: 'Source-faithful result', check_refs: [], reason_code: 'source_transform'}],
    final_output_proposal: {mode: 'direct_child', node_ids: ['read_source']}};
}
function reply(p) {return {provider: 'ollama', model: 'qwen3.5:4b', responseModel: 'qwen3.5:4b',
  stopReason: 'stop', execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}},
  text: JSON.stringify(validProposal(p)), usage: null};}
async function run(p = prepared(), q = task(), options = {}) {
  const requests = [];
  const planner = createLocalPlanPlanner({complete: async request => {requests.push(request); return options.response ?? reply(p);},
    ...(options.limits ? {limits: options.limits} : {})});
  const result = await planner({hostProjection: p.hostProjection, expectedBinding: p.expectedBinding,
    projection: p.projection, ownerPolicy: {source_sha256: q.policy.source_sha256,
      projection_sha256: q.policy.projection_sha256, text: q.policy.text}});
  return {result, requests};
}
test('actual structured classifier request retains exact original objective and host policy projection', async () => {
  const q = task(), p = prepared(q), {result, requests} = await run(p, q), request = requests[0];
  const data = JSON.parse(request.messages[0].content);
  assert.equal(result.status, 'proposal'); assert.equal(data.original_request, q.request); assert.equal(data.objective, q.objective);
  assert.equal(data.request_sha256, q.request_sha256); assert.equal(data.requirements[0].text, q.objective);
  assert.equal(data.requirements[0].status, 'interpreted'); assert.equal(request.systemPrompt.includes(q.policy.text), true);
  assert.equal(result.owner_policy_source_sha256, q.policy.source_sha256);
  assert.equal(result.owner_policy_projection_sha256, H(projectionText));
});
test('long opaque material references are aliased and neither path nor context/source body reaches classifier', async () => {
  const q = task(), p = prepared(q), {requests, result} = await run(p, q), wire = JSON.stringify(requests[0]);
  assert.ok(sourceRefs.every(x => x.length > 96)); assert.deepEqual(Object.values(p.hostProjection.material_aliases), sourceRefs);
  const data = JSON.parse(requests[0].messages[0].content);
  assert.deepEqual(data.materials.map(x => x.id), ['material_0', 'material_1']);
  assert.equal(sourceRefs.some(ref => wire.includes(ref)), false); assert.equal(wire.includes(SOURCE_BODY), false);
  assert.equal(wire.includes(q.host_context.context), false); assert.equal(result.executor_view_supplied, false);
  assert.equal(result.classifier_view, 'exact_objective_and_host_projected_metadata_only');
});
test('host metadata not_read and required unknown are preserved, never a read/full-coverage receipt', async () => {
  const q = task(), p = prepared(q), {requests, result} = await run(p, q);
  const materials = JSON.parse(requests[0].messages[0].content).materials;
  assert.ok(materials.every(m => m.read_status === 'not_read' && m.required === 'unknown' && m.authority_scope === 'task_data'));
  assert.equal(result.requires_host_material_review, true); assert.equal(result.semantic_coverage_verified, false);
});
test('explicit unknown read status stays unknown, not converted to unread/read/zero', async () => {
  const q = task(), p = structuredClone(prepared(q)); p.projection.materials[0].read_status = 'unknown';
  const {requests, result} = await run(p, q), data = JSON.parse(requests[0].messages[0].content);
  assert.equal(result.status, 'proposal'); assert.equal(data.materials[0].read_status, 'unknown');
  assert.equal(data.materials[0].required, 'unknown'); assert.equal(result.requires_host_material_review, true);
});
test('public local kernel identity is separate from owner original/projection identities', async () => {
  const q = task(), p = prepared(q), {result, requests} = await run(p, q);
  assert.equal(LOCAL_PLAN_KERNEL_VERSION, 'rcc-local-plan-kernel-v4'); assert.equal(H(LOCAL_PLAN_KERNEL), LOCAL_PLAN_KERNEL_SHA256);
  assert.equal(result.kernel_version, LOCAL_PLAN_KERNEL_VERSION); assert.equal(result.kernel_sha256, LOCAL_PLAN_KERNEL_SHA256);
  assert.notEqual(result.kernel_sha256, result.owner_policy_projection_sha256);
  assert.notEqual(result.kernel_sha256, result.owner_policy_source_sha256);
  assert.equal(requests[0].systemPrompt.endsWith(LOCAL_PLAN_KERNEL), true);
});
test('tool-free structured plan request asks for no hidden chain of thought or task answer', async () => {
  const q = task(), {requests, result} = await run(prepared(q), q), request = requests[0];
  assert.equal(request.model, localPlanModel()); assert.equal(request.purpose, LOCAL_PLAN_PURPOSE);
  assert.equal(request.reasoning, 'off'); assert.equal(request.responseFormat.additionalProperties, false);
  assert.equal(Object.hasOwn(request, 'tools'), false); assert.equal(Object.hasOwn(request, 'tool_choice'), false);
  assert.match(request.systemPrompt, /NOT a chain of thought/); assert.match(request.systemPrompt, /Do not execute tools, answer the task/);
  assert.doesNotMatch(request.systemPrompt, /think step[- ]by[- ]step|show your reasoning|reveal your reasoning/i);
  assert.equal(result.execution_authorized, false); assert.equal(result.quality_parity_verified, false);
  const plugin = readFileSync(new URL('../../Resources/openclaw-os1-bridge/rcc-plugin.mjs', import.meta.url), 'utf8');
  assert.match(plugin, /api\.on\('before_tool_call', \(\) => \(\{ block: true, blockReason: 'rcc_planner_tool_free'/);
});
test('wrong owner policy projection hash fails before any canned completion', async () => {
  const q = task(), p = prepared(q), changed = structuredClone(q); changed.policy.text += ' changed';
  const {result, requests} = await run(p, changed); assert.equal(result.status, 'fallback_required'); assert.equal(requests.length, 0);
});
test('bounded input failure makes zero calls and does not truncate original objective', async () => {
  const q = task(), {result, requests} = await run(prepared(q), q, {limits: {input_bytes: 128}});
  assert.equal(result.reason, 'planner_input_budget_exceeded'); assert.equal(requests.length, 0); assert.equal(result.model_calls_started, 0);
});
test('synthetic oversized engine is rejected, not copied/truncated or treated as full-equivalent projection', async () => {
  const q = task(); q.policy.text = 'synthetic-engine-data-'.repeat(45000); q.policy.projection_sha256 = H(q.policy.text);
  q.policy_sha256 = q.policy.projection_sha256;
  const {result, requests} = await run(prepared(q), q); assert.equal(result.status, 'fallback_required'); assert.equal(requests.length, 0);
});
test('returned hidden reasoning is withheld/hash-only rather than normalized into a public proposal', async () => {
  const q = task(), p = prepared(q), response = {...reply(p), text: '<think>synthetic hidden reasoning</think>{}'};
  const {result} = await run(p, q, {response}); assert.equal(result.status, 'fallback_required');
  assert.equal(result.raw_model_output, null); assert.equal(result.raw_proposal, null);
  assert.equal(result.raw_capture_status, 'reasoning_withheld_hash_only'); assert.equal(result.raw_output_sha256, H(response.text));
});
test('actual shadow Core keeps full executor context/material refs and original words despite metadata-only classifier', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'os1-prompt-view-fixture-'))); await chmod(dir, 0o700);
  const q = task(dir), tickets = [], plannerRequests = [];
  const runtime = await createRCCRuntime({stateDir: dir, hostAutoPlan: true,
    adaptiveRoutingPolicy: {schema: 1, mode: 'shadow', policy_id: 'view-shadow', version: '1',
      rcc_source_sha256: q.policy.source_sha256, projection_sha256: q.policy_sha256, reference_policy_sha256: null,
      allowed_workload_classes: ['readonly_material'], max_nodes: 2, max_parallel: 1, max_plan_revisions: 0,
      max_planner_calls: 1, planner_input_bytes: 64000, planner_output_tokens: 512, requires_live_reference_fallback: true,
      adoption_manifest_sha256: null},
    proposeLocalPlan: createLocalPlanPlanner({complete: async request => {
      plannerRequests.push(request); return reply(prepared(q));
    }}),
    catalog: async value => { const now = Date.now(); return {schema: 1, task_id: value.task_id,
      request_sha256: value.request_sha256, request_class: 'readonly_material', owner_scope: 'read_only', chat_lane_eligible: false,
      model_tiers: {'gpt-6-astra': 'frontier'}, candidates: [{id: 'native_reference', surface: 'codex', transport: 'codex_app_server',
        account_id: 'synthetic', model: 'gpt-6-astra', effort: 'ultra', tools: ['read'], scope: 'read_only', permission_profile: 'read_only',
        quota_pool: 'openai_codex', allowed_paths: [], configuration_sha256: H('native-config'), availability: 'available',
        availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 60000, quota_remaining_fraction: .8,
        quota_observed_at_ms: now - 1, quota_valid_until_ms: now + 60000, quality_state: 'policy_admitted', estimated_cost_units: 1}]}; },
    execute: async ticket => { tickets.push(ticket); return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id,
      attempt_id: ticket.attempt_id, candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
      selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, status: 'succeeded', dispatch_stage: 'dispatched',
      side_effects: 'none', execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
      output: 'synthetic answer', native_receipt: '/private/synthetic/' + ticket.attempt_id}; }});
  t.after(async () => {await runtime.close(); await rm(dir, {recursive: true, force: true});});
  await runtime.submit(q); const done = await runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});
  assert.equal(done.state, 'returned_unverified', done.error); assert.equal(tickets.length, 1); assert.equal(plannerRequests.length, 1);
  const classifierWire = JSON.stringify(plannerRequests[0]); assert.equal(classifierWire.includes(SOURCE_BODY), false);
  assert.equal(sourceRefs.some(ref => classifierWire.includes(ref)), false);
  assert.equal(tickets[0].original_request, q.request); assert.equal(tickets[0].original_objective, q.objective);
  assert.equal(tickets[0].instruction, q.request); assert.deepEqual(tickets[0].context_refs, q.material_refs);
  assert.equal(tickets[0].host_context.context, q.host_context.context); assert.ok(tickets[0].host_context.context.includes(SOURCE_BODY));
  assert.equal(tickets[0].policy_source_sha256, q.policy.source_sha256);
  assert.equal(done.result.task_quality, 'execution_only'); // Not native source delivery/semantic proof.
});
