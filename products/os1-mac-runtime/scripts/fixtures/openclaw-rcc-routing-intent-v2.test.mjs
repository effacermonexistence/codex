// R10 v2 migration fixtures: fake catalog/executor only. No native/model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, chmod, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {admittedRoute, createRCCRuntime, hostContextFingerprint, hostPlan, resolveRoutePlan}
  from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
const sha = x => createHash('sha256').update(x).digest('hex');
const VERSION = 'r10_joint_selection_v2';
function task({version = VERSION, preference = 'codex', write = false} = {}) {
  const request = 'Codex로 첨부 규칙을 간결하게 설명해줘';
  const host = {workspace: '/private/r10-fixture', context: null, provider_preference: preference,
    codex_session_id: null, claude_session_id: null, require_read_only: !write, owner_policy: null};
  return {schema: 1, task_id: 'r10-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha('fixture policy'), source_fingerprint: hostContextFingerprint(host), mode: 'auto',
    material_refs: [], budget: {max_attempts: 2, max_parallel: 1, max_cost_units: null, max_duration_ms: 3000},
    host_context: host, ...(version === undefined ? {} : {routing_intent_policy_version: version})};
}
function intent(extra = {}) {
  return {version: VERSION, allowed_surfaces: ['codex'], exact_model: null, model_family: null, effort: null,
    require_native_ceiling: false, quality_target: null, state: 'resolved', ...extra};
}
function row(id, model, effort, provider = 'codex', scope = 'read_only') {
  const now = Date.now();
  return {id, surface: provider, transport: provider === 'codex' ? 'codex_app_server' : 'claude_cli',
    account_id: 'fixture-account-' + provider, model, effort, tools: scope === 'read_only' ? ['read', 'execute'] : ['read', 'write', 'execute'],
    scope, permission_profile: scope, quota_pool: provider === 'codex' ? 'openai_codex' : 'anthropic_shared',
    allowed_paths: scope === 'read_only' ? [] : ['**'], configuration_sha256: sha('fixture:' + id),
    availability: 'available', availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 60000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 1, quota_valid_until_ms: now + 60000,
    quality_state: 'policy_admitted', estimated_cost_units: null};
}
function catalog(t, {v2 = intent(), full = false, write = false} = {}) {
  const c = {schema: 1, task_id: t.task_id, request_sha256: t.request_sha256,
    candidates: [row('ref', 'gpt-6-astra', 'ultra', 'codex', write ? 'workspace_write' : 'read_only'),
      row('ref-max', 'gpt-6-astra', 'max', 'codex', write ? 'workspace_write' : 'read_only'),
      row('sol-low', 'gpt-6-sol', 'low'), row('sol-high', 'gpt-6-sol', 'high'),
      row('cheap', 'gpt-6-luna', 'low'), row('foreign', 'claude-fable-5-1', 'max', 'claude')],
    model_tiers: {'gpt-6-astra': 'frontier', 'gpt-6-sol': 'workhorse', 'gpt-6-luna': 'fast', 'claude-fable-5-1': 'frontier'},
    native_reference_efforts: {codex: {'gpt-6-astra': 'ultra', 'gpt-6-sol': 'high', 'gpt-6-luna': 'low'},
      claude: {'claude-fable-5-1': 'max'}},
    owner_scope: write ? 'workspace_write' : 'read_only', chat_lane_eligible: false, request_class: write ? 'writer' : 'readonly_lookup',
    ...(v2 === undefined ? {} : {routing_intent_v2: v2})};
  if (full) c.task_contract = {coverage: 'full', scope: 'read_only', objective_sha256: t.request_sha256,
    contract_sha256: sha('fixture-contract'), context_sha256: sha(''), start_tree_sha256: sha('tree'),
    reference_policy_sha256: t.policy_sha256, valid_until_ms: Date.now() + 60000, bindings_checked: true};
  return c;
}
const decision = (t, c) => resolveRoutePlan(hostPlan(t, c), t, c).decisions.node_0;
const admit = (t, c) => admittedRoute(hostPlan(t, c).nodes[0], t, c);
async function runtime(t, request, value, execute = async () => { throw Error('fake no execution'); }) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-r10-fixture-')); await chmod(dir, 0o700);
  const r = await createRCCRuntime({stateDir: dir, catalog: async () => value, execute});
  t.after(async () => { await r.close(); await rm(dir, {recursive: true, force: true}); });
  return r;
}

test('same bare provider remains legacy reference without version', () => {
  const t = task({version: null}), c = catalog(t); delete c.routing_intent_v2;
  assert.equal(admit(t, c).source, 'owner_words'); assert.equal(decision(t, c).model, 'gpt-6-astra');
});
test('v2 bare provider only changes intent semantics; no checker remains reference', () => {
  const t = task(), c = catalog(t);
  assert.equal(admit(t, c).source, 'uncertified'); assert.equal(decision(t, c).model, 'gpt-6-astra');
  assert.equal(decision(t, c).effort, 'ultra');
});
test('v2 R0 full contract permits supported descent inside provider, never self quality target', () => {
  const t = task(), c = catalog(t, {full: true});
  assert.equal(admit(t, c).source, 'contract'); assert.equal(decision(t, c).model, 'gpt-6-luna');
  assert.equal(decision(t, c).surface, 'codex');
  const q = catalog(t, {v2: intent({quality_target: 'current_host_reference'})});
  assert.equal(admit(t, q).class, 'reference');
  assert.equal(decision(t, q).model, 'gpt-6-astra');
});
test('quality descriptor cannot create full checker coverage', () => {
  const t = task(), c = catalog(t, {full: true, v2: intent({quality_target: 'current_host_reference'})});
  c.task_contract.coverage = 'partial';
  assert.equal(admit(t, c).source, 'uncertified'); assert.equal(decision(t, c).effort, 'ultra');
});
test('native maximum uses actual per-model supported ceiling, not max signed row', () => {
  const t = task(), c = catalog(t, {full: true, v2: intent({require_native_ceiling: true})});
  assert.equal(admit(t, c).source, 'owner_words'); assert.equal(decision(t, c).effort, 'ultra');
  c.candidates = c.candidates.filter(x => x.id !== 'ref');
  assert.throws(() => decision(t, c), /no_dispatchable_candidate/);
});
test('exact model/effort unavailable never substitutes family/frontier/other provider', () => {
  const t = task(), c = catalog(t, {full: true, v2: intent({exact_model: 'gpt-6-sol', effort: 'high'})});
  assert.equal(decision(t, c).model, 'gpt-6-sol'); assert.equal(decision(t, c).effort, 'high');
  c.candidates = c.candidates.filter(x => x.id !== 'sol-high');
  assert.throws(() => decision(t, c), /no_dispatchable_candidate/);
});
test('exact model alone leaves reasoning selectable only after R0 admission', () => {
  const t = task(), c = catalog(t, {full: true, v2: intent({exact_model: 'gpt-6-sol'})});
  assert.equal(decision(t, c).model, 'gpt-6-sol'); assert.equal(decision(t, c).effort, 'low');
  delete c.task_contract; assert.equal(decision(t, c).effort, 'high');
});
test('unknown quota remains null and exhausted capacity does not become cheaper authorization', () => {
  const t = task(), c = catalog(t); c.candidates.forEach(x => {
    x.quota_remaining_fraction = null; x.quota_observed_at_ms = null; x.quota_valid_until_ms = null;
  });
  assert.throws(() => decision(t, c), /no_dispatchable_candidate/); assert.equal(c.candidates[0].quota_remaining_fraction, null);
  c.candidates[0].quota_remaining_fraction = 0;
  assert.throws(() => decision(t, c), /no_dispatchable_candidate/);
});
test('writer does not get read-only checker authority from v2', () => {
  const t = task({write: true}), c = catalog(t, {full: true, write: true});
  assert.equal(admit(t, c).class, 'reference');
});
for (const [label, mutateTask, mutateCatalog] of [
  ['marker missing', t => delete t.routing_intent_policy_version, () => {}],
  ['catalog missing', () => {}, c => delete c.routing_intent_v2],
  ['unknown version', t => t.routing_intent_policy_version = 'v99', () => {}],
  ['foreign catalog version', () => {}, c => c.routing_intent_v2.version = 'v99'],
  ['unresolved', () => {}, c => c.routing_intent_v2.state = 'unresolved'],
  ['extra authority', () => {}, c => c.routing_intent_v2.quality_proven = true],
  ['nullable key missing', () => {}, c => delete c.routing_intent_v2.exact_model],
  ['dropped ChatGPT', () => {}, c => c.routing_intent_v2.allowed_surfaces = ['chatgpt']],
  ['native ceiling unknown', () => {}, c => delete c.native_reference_efforts],
  ['legacy and v2 mixed', () => {}, c => c.routing_intent = {effort: 'high', model_family: null}],
]) test('strict host version gate: ' + label, async t => {
  const request = task(), c = catalog(request); mutateTask(request); mutateCatalog(c);
  let calls = 0; const r = await runtime(t, request, c, async () => { calls++; throw Error('must not call'); });
  try { await r.submit(request); const state = await r.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 5000});
    assert.notEqual(state.state, 'completed'); }
  catch (e) { assert.match(String(e), /intent_policy_version_invalid|catalog_binding_invalid/); }
  assert.equal(calls, 0);
});
test('same taskID/original request with changed intent version cannot replay old admitted task', async t => {
  const request = task({version: null}), c = catalog(request); delete c.routing_intent_v2;
  const r = await runtime(t, request, c); await r.submit(request);
  await assert.rejects(r.submit({...request, routing_intent_policy_version: VERSION}), /idempotency_conflict/);
  assert.equal(request.request_sha256, sha(request.request));
});
test('new task idempotency survives identical version but rejects a null downgrade', async t => {
  const request = task(), c = catalog(request), r = await runtime(t, request, c);
  await r.submit(request); await r.submit(structuredClone(request));
  await assert.rejects(r.submit({...request, routing_intent_policy_version: null}), /idempotency_conflict/);
});

test('persisted legacy snapshot cannot acquire v2 semantics after Core restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'os1-r10-replay-')); await chmod(dir, 0o700);
  const request = task({version: null}), c = catalog(request); delete c.routing_intent_v2;
  const options = {stateDir: dir, catalog: async () => c, execute: async () => { throw Error('fake only'); }};
  const first = await createRCCRuntime(options); await first.submit(request); await first.close();
  const second = await createRCCRuntime(options);
  t.after(async () => { await second.close(); await rm(dir, {recursive: true, force: true}); });
  await assert.rejects(second.submit({...request, routing_intent_policy_version: VERSION}), /idempotency_conflict/);
});

test('v2 task cannot borrow expired or wrong-object full coverage', () => {
  const request = task(), c = catalog(request, {full: true});
  c.task_contract.valid_until_ms = Date.now() - 1;
  assert.equal(admit(request, c).class, 'reference');
  c.task_contract.valid_until_ms = Date.now() + 60000; c.task_contract.objective_sha256 = sha('other objective');
  assert.equal(admit(request, c).class, 'reference');
});
