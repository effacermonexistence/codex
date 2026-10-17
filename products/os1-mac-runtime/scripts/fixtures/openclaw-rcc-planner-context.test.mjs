// Planner projection only: no live store, local model, provider or native calls.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {buildBoundedPlannerInput, buildRoutePlanSchema, plannerContextProjection}
  from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {createRCCRuntime, hostContextFingerprint}
  from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const NOW = 1_792_254_384_635;
function context() {
  const conversationID = '7EE1641C-FA76-4730-8D49-9861B35F9999';
  return JSON.stringify({format: 'os1-session-handoff-v3',
    transcript: 'Literal source: allowedSessionIDs and permission prose must remain untouched.',
    taskContext: {conversationID, objective: {scope: 'read_only', requestText: 'Preserve supplied source.'},
      facts: [{source: 'user', value: 'Do not change files.'}]},
    memoryPaging: {snapshot: {kind: 'snapshot', id: randomUUID(), sha256: sha('snapshot')},
      conversationID: conversationID.toLowerCase(),
      allowedSessionIDs: [conversationID.toLowerCase(), ...Array.from({length: 186}, () => randomUUID())],
      projectID: 'workspace:fixture', archivedMessages: 0,
      futureField: {preserved: 'No unknown field may disappear.'}},
    futureEnvelopeField: {preserved: true}});
}
function request(workspace = '/tmp/fixture', mode = 'auto') {
  const policy = 'RCC_FULL_POLICY: keep criterion, source, authority, objective and unknown state.';
  const host = {workspace, context: context(), provider_preference: 'codex',
    codex_session_id: null, claude_session_id: null, require_read_only: true, owner_policy: null};
  if (mode === 'explicit_routing_test') host.explicit_routes = [{surface: 'codex', instruction: 'Preserve source.'}];
  return {schema: 1, task_id: randomUUID(), request: 'Preserve source.', objective: 'Preserve source.',
    request_sha256: sha('Preserve source.'), policy_sha256: sha(policy),
    source_fingerprint: hostContextFingerprint(host), mode, material_refs: ['material-original'],
    budget: {max_attempts: 1, max_parallel: 1, max_cost_units: null, max_duration_ms: 20_000},
    host_context: host, policy: {source_sha256: sha('policy source'), projection_sha256: sha(policy), text: policy}};
}
function catalog(task, {tiered = false, now = NOW} = {}) {
  return {schema: 1, task_id: task.task_id, request_sha256: task.request_sha256,
    ...(tiered ? {model_tiers: {'fixture-model': 'frontier'}} : {}), candidates: [{
      id: 'fixture-codex-max', surface: 'codex', transport: 'codex_app_server', account_id: 'fixture-account',
      model: 'fixture-model', effort: 'max', tools: [], scope: 'read_only', permission_profile: 'read_only',
      quota_pool: 'openai_codex', allowed_paths: [], configuration_sha256: sha('configuration'),
      availability: 'available', availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 300_000,
      quota_remaining_fraction: 1, quota_observed_at_ms: now - 1, quota_valid_until_ms: now + 300_000,
      quality_state: 'policy_admitted', estimated_cost_units: 1}]};
}
function payload(input) { return JSON.parse(input.message.slice('OS1_RCC_PLAN\n'.length)); }
const makeInput = (task, rows = catalog(task)) => buildBoundedPlannerInput({task, catalog: rows,
  feedback: {}, policyText: task.policy.text, now: NOW});

test('only typed host session authorization IDs are projected; every other semantic field survives', () => {
  const raw = context(), original = JSON.parse(raw), projected = JSON.parse(plannerContextProjection(raw));
  assert.equal(projected.memoryPaging.allowedSessionIDs, undefined);
  assert.deepEqual(projected.memoryPaging.allowedSessionScope, {
    kind: 'host_authorization_binding', count: 187,
    sha256: sha(JSON.stringify(original.memoryPaging.allowedSessionIDs)), planner_retrieval_authority: false});
  const {allowedSessionIDs, ...beforePaging} = original.memoryPaging;
  const {allowedSessionScope, ...afterPaging} = projected.memoryPaging;
  assert.deepEqual(afterPaging, beforePaging);
  assert.deepEqual({...projected, memoryPaging: null}, {...original, memoryPaging: null});
  assert.ok(Buffer.byteLength(raw) - Buffer.byteLength(JSON.stringify(projected)) > 7_000);
  assert.equal(plannerContextProjection(JSON.stringify(projected)), JSON.stringify(projected), 'projection is idempotent');
});

test('authorization binding preserves list order, case and duplicates; never claims retrieval authority', () => {
  const base = JSON.parse(context()), ids = base.memoryPaging.allowedSessionIDs;
  const bind = value => JSON.parse(plannerContextProjection(JSON.stringify(value))).memoryPaging.allowedSessionScope;
  const original = bind(base);
  for (const altered of [[...ids].reverse(), ids.map(id => id.toUpperCase()), [...ids, ids[0]]]) {
    const other = structuredClone(base); other.memoryPaging.allowedSessionIDs = altered;
    if (altered.every(id => id === id.toUpperCase()))
      other.memoryPaging.conversationID = other.memoryPaging.conversationID.toUpperCase();
    assert.notEqual(bind(other).sha256, original.sha256);
    assert.equal(bind(other).count, altered.length);
    assert.equal(bind(other).planner_retrieval_authority, false);
  }
});

test('native Swift UUID casing may differ between TaskContext and lowercase memory reference', () => {
  const value = JSON.parse(context());
  value.memoryPaging.conversationID = value.taskContext.conversationID.toLowerCase();
  const projected = JSON.parse(plannerContextProjection(JSON.stringify(value)));
  assert.equal(projected.memoryPaging.allowedSessionScope.count, 187);
  assert.equal(projected.memoryPaging.conversationID, value.memoryPaging.conversationID);
  assert.equal(projected.taskContext.conversationID, value.taskContext.conversationID);
  assert.equal(projected.memoryPaging.allowedSessionScope.sha256,
    sha(JSON.stringify(value.memoryPaging.allowedSessionIDs)));
});

test('unknown, malformed, future or small inputs are preserved exactly, never guessed or repaired', () => {
  const raw = context();
  const variants = [null, undefined, 3, {}, [], '', 'literal allowedSessionIDs: ["one"]', '{invalid',
    JSON.stringify(raw), JSON.stringify({format: 'another-format', memoryPaging: {allowedSessionIDs: []}})];
  const mutations = [
    value => { value.format = 'os1-session-handoff-v4'; },
    value => { value.transcript = null; }, value => { value.taskContext = []; },
    value => { value.taskContext.conversationID = randomUUID(); },
    value => { value.memoryPaging = []; }, value => { value.memoryPaging.snapshot = null; },
    value => { value.memoryPaging.snapshot.kind = 'future'; },
    value => { value.memoryPaging.snapshot.id = 'unbound'; },
    value => { value.memoryPaging.snapshot.sha256 = 'not-a-digest'; },
    value => { value.memoryPaging.snapshot.sha256 = [sha('coerced-digest')]; },
    value => { value.memoryPaging.projectID = null; },
    value => { value.memoryPaging.archivedMessages = -1; },
    value => { value.memoryPaging.allowedSessionIDs = ['not-a-session']; },
    value => { value.memoryPaging.allowedSessionIDs[0] = null; },
    value => { value.memoryPaging.allowedSessionIDs[0] = randomUUID(); },
    value => { value.memoryPaging.allowedSessionIDs = Array(4_097).fill(randomUUID()); },
    value => { value.memoryPaging.allowedSessionIDs = []; },
    value => { value.memoryPaging.allowedSessionIDs = [randomUUID()]; },
    value => { value.memoryPaging.allowedSessionScope = {count: 999, planner_retrieval_authority: true}; },
  ];
  for (const mutate of mutations) { const value = JSON.parse(raw); mutate(value); variants.push(JSON.stringify(value)); }
  for (const value of variants) assert.equal(plannerContextProjection(value), value);
});

test('Auto and graded explicit input preserve full policy, request, schema and source binding without candidate IDs', () => {
  for (const mode of ['auto', 'explicit_routing_test']) {
    const task = request('/tmp/fixture', mode), rows = catalog(task, {tiered: true});
    const original = structuredClone(task), input = makeInput(task, rows), value = payload(input);
    assert.deepEqual(task, original);
    assert.equal(hostContextFingerprint(task.host_context), task.source_fingerprint);
    assert.equal(value.context, plannerContextProjection(original.host_context.context));
    assert.equal(value.request, original.request); assert.equal(value.original_objective, original.objective);
    assert.deepEqual(value.material_refs, original.material_refs);
    assert.equal(value.task_id, original.task_id); assert.equal(value.request_sha256, original.request_sha256);
    assert.equal(Object.hasOwn(value, 'candidate_catalog'), false);
    assert.equal(input.message.includes('fixture-codex-max'), false);
    assert.ok(input.instructions.includes(task.policy.text));
    assert.deepEqual(input.responseFormat, buildRoutePlanSchema(task, rows, NOW));
    assert.equal(task.policy_sha256, sha(task.policy.text));
    if (mode === 'auto') assert.deepEqual(value.availability.providers, ['codex']);
    else assert.deepEqual(value.explicit_routes, [{id: 'requested-1', surface: 'codex', instruction: 'Preserve source.'}]);
  }
});

test('legacy explicit candidate-choice prompts and literal request/transcript content stay exact', () => {
  const task = request('/tmp/fixture', 'explicit_routing_test');
  task.request = 'Discuss the literal field allowedSessionIDs; do not infer permission.';
  const input = makeInput(task), value = payload(input);
  assert.equal(value.context, task.host_context.context);
  assert.equal(value.request, task.request);
  assert.equal(value.candidate_catalog.candidate_count, 1);
});

test('Core dispatch and persisted original task retain the complete allowlist and fingerprint', async t => {
  const root = await mkdtemp(join(tmpdir(), 'os1-planner-projection-')); await chmod(root, 0o700);
  const task = request(root), original = structuredClone(task);
  let dispatches = 0;
  const runtime = await createRCCRuntime({stateDir: root, catalog: async task => catalog(task, {now: Date.now()}),
    plan: async ({task, catalog}) => {
      const input = buildBoundedPlannerInput({task, catalog, feedback: {}, policyText: task.policy.text});
      assert.equal(JSON.parse(payload(input).context).memoryPaging.allowedSessionScope.count, 187);
      return {schema: 1, task_id: task.task_id, request_sha256: task.request_sha256, nodes: [{id: 'n',
        instruction: task.request, dependencies: [], kind: 'agent', route_class: 'standard', scope: 'read_only',
        owned_paths: [], context_refs: []}]};
    }, execute: async ticket => {
      dispatches++; assert.equal(ticket.host_context.context, original.host_context.context);
      assert.equal(ticket.source_fingerprint, original.source_fingerprint);
      assert.deepEqual(JSON.parse(ticket.host_context.context).memoryPaging.allowedSessionIDs,
        JSON.parse(original.host_context.context).memoryPaging.allowedSessionIDs);
      return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
        candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
        selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config,
        observed_config: null, status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none',
        output: 'Fixture returned, not quality parity.', execution_verified: true, task_verified: false,
        task_quality: 'execution_only', parity_state: 'unverified', native_receipt: '/private/fixture/receipt',
        usage: {provider_calls: 0}, native_summary: null};
    }});
  t.after(async () => { await runtime.close(); await rm(root, {recursive: true, force: true}); });
  await runtime.submit(task);
  const result = await runtime.wait({schema: 1, task_id: task.task_id}, {timeoutMs: 5_000});
  assert.equal(result.state, 'returned_unverified', result.error);
  assert.equal(dispatches, 1); assert.deepEqual(task, original);
  assert.deepEqual(runtime._load(task.task_id).task, original);
  assert.equal(result.result.task_verified, false); assert.equal(result.result.parity_state, 'unverified');
});
