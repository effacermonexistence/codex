// Actual SQLite owner + bounded injected planner/native fixtures. No provider,
// model, network, real HOME or installed app is touched by these regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, chmod, rm, mkdir, writeFile, readFile, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRCCRuntime, hostContextFingerprint, RCCRuntimeError} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {createLocalPlanPlanner} from '../../Resources/openclaw-os1-bridge/local-plan-planner.mjs';
const H = s => createHash('sha256').update(s).digest('hex');
const policyText = 'Preserve the original objective and source. Proposal is not execution authority.';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const task = (dir, overrides = {}) => {
  const request = 'Read the provided definition and explain its boundary precisely.';
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: randomUUID(), request, objective: request, request_sha256: H(request),
    policy_sha256: H(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 1, max_parallel: 4, max_cost_units: null, max_duration_ms: 10000}, host_context: host,
    policy: {source_sha256: H('source'), projection_sha256: H(policyText), text: policyText}, ...overrides};
};
const adaptive = (patch = {}) => ({schema: 1, mode: 'shadow', policy_id: 'test-shadow', version: '1',
  rcc_source_sha256: H('source'), projection_sha256: H(policyText), reference_policy_sha256: null,
  allowed_workload_classes: ['readonly_lookup'], max_nodes: 4, max_parallel: 2,
  max_plan_revisions: 0, max_planner_calls: 1, planner_input_bytes: 64000, planner_output_tokens: 2048,
  requires_live_reference_fallback: true, adoption_manifest_sha256: null, ...patch});
function catalog(q) {
  const now = Date.now();
  return {schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, owner_scope: 'read_only',
    request_class: 'readonly_lookup', chat_lane_eligible: false, model_tiers: {'gpt-6-astra': 'frontier'},
    candidates: [{id: 'reference', surface: 'codex', transport: 'codex_app_server', account_id: 'fixture',
      model: 'gpt-6-astra', effort: 'ultra', tools: ['read', 'execute'], scope: 'read_only', permission_profile: 'read_only',
      quota_pool: 'openai_codex', allowed_paths: [], configuration_sha256: H('config'), availability: 'available',
      availability_observed_at_ms: now - 1, availability_valid_until_ms: now + 60000,
      quota_remaining_fraction: 0.8, quota_observed_at_ms: now - 1, quota_valid_until_ms: now + 60000,
      quality_state: 'policy_admitted', estimated_cost_units: 1}]};
}
const proposal = () => JSON.stringify({schema: 2, kind: 'untrusted_local_plan_proposal', nodes: ['a', 'b'].map(id => ({
  proposal_node_id: id, instruction: 'Explain the supplied definition.', requirement_refs: ['owner_objective'],
  dependencies: [], material_refs: [], proposed_candidate_id: 'reference', proposed_scope: 'read_only',
  proposed_owned_paths: [], required_output: 'Source-grounded explanation', check_refs: [], reason_code: 'independent_read'})),
  final_output_proposal: {mode: 'ordered_collection', node_ids: ['a', 'b']}});
function completed(ticket) { return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id,
  attempt_id: ticket.attempt_id, candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
  selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
  status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
  task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'fixture result',
  native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null}; }
async function harness(t, options = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'os1-adaptive-owner-'))); await chmod(directory, 0o700);
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: directory, hostAutoPlan: true,
    catalog: async q => catalog(q), execute: async q => {tickets.push(q); return completed(q);},
    ...options});
  t.after(async () => {await runtime.close(); await rm(directory, {recursive: true, force: true});});
  const run = async q => {await runtime.submit(q); return runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});};
  return {directory, runtime, tickets, run};
}
test('OFF preserves the host plan and does not call/record a local proposal', async t => {
  let calls = 0; const h = await harness(t, {proposeLocalPlan: () => {calls++; throw Error('off');}}), q = task(h.directory);
  const done = await h.run(q); assert.equal(done.state, 'returned_unverified');
  assert.equal(calls, 0); assert.equal(h.tickets.length, 1);
  assert.equal(h.runtime._load(q.task_id).adaptive_routing, undefined);
  assert.equal(h.tickets[0].instruction, q.request);
});
test('shadow invokes the actual helper and records two UNBOUND nodes without executing them', async t => {
  let calls = 0;
  const planner = createLocalPlanPlanner({complete: async request => {
    calls++; assert.equal(request.purpose, 'os1.rcc.local-plan-proposal');
    assert.match(request.systemPrompt, /Proposal is not execution authority/);
    return {provider: 'ollama', model: 'qwen3.5:4b', stopReason: 'stop', text: proposal(),
      execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}},
      usage: {inputTokens: 12, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 18}};
  }});
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: planner}), q = task(h.directory);
  const done = await h.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(done.state, 'returned_unverified'); assert.equal(calls, 1); assert.equal(h.tickets.length, 1);
  assert.equal(saved.adaptive_routing.reason, 'shadow_proposal_validated_not_executed');
  assert.equal(saved.adaptive_routing.proposed_unbound_plan.nodes.length, 2);
  assert(saved.adaptive_routing.proposed_unbound_plan.nodes.every(n => !Object.hasOwn(n, 'candidate_id')));
  assert.equal(saved.adaptive_routing.live_plan_changed, false); assert.equal(saved.adaptive_routing.quality_certificate, false);
  assert.equal(saved.resource_events.filter(e => e.stage === 'plan_proposal' && e.state === 'started').length, 1);
  assert.equal(done.resource_usage.plan_model_calls, 1); assert.equal(h.tickets[0].instruction, q.request);
  await h.runtime.submit(q); assert.equal(calls, 1, 'idempotent submission never replays a planner');
});
test('malformed trusted-candidate injection is preserved raw and cannot replace the original route', async t => {
  const bad = JSON.parse(proposal()); bad.nodes[0].candidate_id = 'fake_trusted'; const raw = JSON.stringify(bad);
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: async () => ({status: 'proposal', raw_proposal: raw})});
  const q = task(h.directory), done = await h.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(done.state, 'returned_unverified'); assert.equal(h.tickets.length, 1);
  assert.equal(saved.adaptive_routing.raw_proposal, raw); assert.equal(saved.adaptive_routing.proposal_sha256, H(raw));
  assert.equal(saved.adaptive_routing.proposed_unbound_plan, null);
  assert.equal(saved.adaptive_routing.live_plan_changed, false); assert.equal(h.tickets[0].instruction, q.request);
});
test('foreign source policy skips observation, not source/quality guard', async t => {
  let calls = 0;
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive({rcc_source_sha256: H('foreign')}),
    proposeLocalPlan: async () => {calls++; return {status: 'proposal', raw_proposal: proposal()};}});
  const q = task(h.directory), done = await h.run(q);
  assert.equal(done.state, 'returned_unverified'); assert.equal(calls, 0);
  assert.equal(h.runtime._load(q.task_id).adaptive_routing.reason, 'adaptive_source_or_reference_mismatch');
});
test('model-returned source replacement cannot become current host state', async t => {
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: async args => {
    args.hostProjection.request = 'changed copy'; return {status: 'proposal', raw_proposal: proposal()};
  }}), q = task(h.directory), done = await h.run(q);
  assert.equal(done.state, 'returned_unverified'); assert.equal(h.tickets[0].instruction, q.request);
});
test('quiescence tracks an abort-ignoring callback until ACTUAL settlement, never dispatching a late plan', async t => {
  let resolve, entered = false;
  const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: async () => {entered = true; return new Promise(r => {resolve = r;});}});
  const q = task(h.directory); await h.runtime.submit(q);
  for (let i = 0; i < 200 && !entered; i++) await sleep(5);
  assert.equal(entered, true);
  const first = h.runtime.quiesce({schema: 1, request_id: 'stop_fixture'});
  assert.equal(first.safe_to_stop, false); assert(first.active_dispatches > 0);
  const held = await h.runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 2000});
  assert.equal(held.state, 'held'); assert.equal(held.error, 'adaptive_plan_interrupted');
  assert.equal(h.tickets.length, 0);
  assert.equal(h.runtime.quiesce({schema: 1, request_id: 'still_waiting'}).safe_to_stop, false);
  resolve({status: 'proposal', raw_proposal: proposal()}); await sleep(30);
  assert.equal(h.tickets.length, 0); assert.equal(h.runtime.status({schema: 1, task_id: q.task_id}).state, 'held');
  assert.equal(h.runtime.quiesce({schema: 1, request_id: 'settled'}).safe_to_stop, true);
  assert.equal(h.runtime._load(q.task_id).adaptive_routing.raw_proposal, proposal(), 'late raw source retained privately');
  assert.equal(h.runtime._load(q.task_id).adaptive_routing.reply_settled_after_abort, true);
});
test('hash-only failed reply metadata survives fallback without invented raw content', async t => {
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: async () => ({status: 'fallback_required',
    raw_model_output: null, output_sha256: H('oversize'), raw_output_sha256: H('oversize'),
    raw_capture_status: 'oversize_hash_only', completion_outcome_unknown: false})}), q = task(h.directory);
  const done = await h.run(q), s = h.runtime._load(q.task_id);
  assert.equal(done.state, 'returned_unverified'); assert.equal(h.tickets.length, 1);
  assert.equal(s.adaptive_routing.proposal_sha256, H('oversize'));
  assert.equal(s.adaptive_routing.raw_proposal, null); assert.equal(s.adaptive_routing.raw_reply_complete, false);
  assert.equal(s.adaptive_routing.raw_capture_status, 'oversize_hash_only');
});
test('a covered-live hash/flag cannot register its own calibration authority', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'os1-adaptive-reject-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  await assert.rejects(createRCCRuntime({stateDir: directory,
    adaptiveRoutingPolicy: adaptive({mode: 'covered_live', reference_policy_sha256: H('ref'),
      adoption_manifest_sha256: H('not-an-artifact')})}), /adaptive_live_policy_not_registered/);
});
test('actual Core settlement reads one exact private adapter receipt; raw ledger gets only a bounded pointer', async t => {
  let h;
  h = await harness(t, {adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: async () => ({status: 'fallback_required', completion_outcome_unknown: false}),
    execute: async ticket => {
      const dir = join(h.directory, 'native-receipts'); await mkdir(dir, {mode: 0o700});
      const result = {...completed(ticket), native_receipt: join(dir, randomUUID() + '.json'), native_turn_terminated: true};
      await writeFile(result.native_receipt, JSON.stringify(result), {mode: 0o600, flag: 'wx'});
      return result;
    }});
  const q = task(h.directory), done = await h.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(done.state, 'returned_unverified');
  const entry = saved.children[0].attempt_history[0], capture = entry.routing_outcome;
  assert.equal(capture.status, 'captured');
  assert.equal(capture.record.selected_config.model, 'gpt-6-astra');
  assert.equal(capture.record.observed_config, null); assert.equal(capture.record.origin, 'unknown');
  assert.equal(capture.record.learning.eligible, false); assert.equal(capture.record.learning.correctness_label, null);
  assert.equal(capture.record.usage.total_tokens_observed, null); assert.equal(capture.record.parity_state, 'unverified');
  assert.equal(entry.ledger.outcome_context.identity.request_sha256, q.request_sha256);
  const file = join(h.directory, 'routing-ledger', 'routing-ledger.jsonl');
  const lines = (await readFile(file, 'utf8')).trim().split('\n');
  assert.equal(lines.length, 1); const row = JSON.parse(lines[0]);
  assert.equal(row.routing_outcome.status, 'captured');
  assert.equal(row.routing_outcome.normalized_sha256, capture.record.normalized_sha256);
  assert.equal(row.routing_outcome.learning_eligible, false);
  assert(!lines[0].includes(capture.capture.adapter_receipt_path)); assert(!lines[0].includes('fixture result'));
  assert(Buffer.byteLength(lines[0]) + 1 <= 8192);
  await h.runtime.submit(q);
  assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 1);
});
test('missing optional outcome source quarantines only accounting and does not reject a returned answer', async t => {
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: async () => ({status: 'fallback_required', completion_outcome_unknown: false})});
  const q = task(h.directory), done = await h.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(done.state, 'returned_unverified'); assert.equal(done.result.output, 'fixture result');
  assert.equal(saved.children[0].attempt_history[0].routing_outcome.status, 'quarantined');
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
async function waitFor(predicate) {
  for (let i = 0; i < 300 && !predicate(); i++) await sleep(5);
  assert(predicate(), 'bounded synthetic observer checkpoint reached');
}
function timeoutObserver(runtime, q) {
  const item = runtime.intentControllers.get(q.task_id);
  assert(item);
  // Deterministically trigger the SAME observer-local reason as its 20s timer,
  // without waiting20s, modifying a production timeout or running a model.
  item.controller.abort(new RCCRuntimeError('adaptive_plan_timeout'));
}
const ticketWithoutAttempt = ({attempt_id, ...ticket}) => ticket;

test('settled unknown SHADOW preserves the exact OFF ticket/source/graph and cannot replay', async t => {
  let calls = 0;
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: async () => {
    calls++; return {status: 'proposal', raw_proposal: proposal(), completion_outcome_unknown: true};
  }}), off = await harness(t), q = task(h.directory);
  const done = await h.run(q), baseline = await off.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(done.state, baseline.state); assert.equal(done.result.output, baseline.result.output);
  assert.deepEqual(ticketWithoutAttempt(h.tickets[0]), ticketWithoutAttempt(off.tickets[0]));
  assert.deepEqual(saved.plan, off.runtime._load(q.task_id).plan); assert.deepEqual(saved.task, q);
  assert.equal(saved.adaptive_routing.reason, 'shadow_backend_unknown_original_route_preserved');
  assert.equal(saved.adaptive_routing.callback_pending, false);
  assert.equal(saved.adaptive_routing.backend_completion_unknown, true);
  assert.equal(saved.adaptive_routing.planner_invoked, true);
  assert.equal(saved.adaptive_routing.proposed_unbound_plan, null);
  assert.equal(saved.adaptive_routing.live_plan_changed, false);
  assert.equal(saved.adaptive_routing.quality_certificate, false);
  assert.equal(done.resource_usage.accounting_complete, false);
  await h.runtime.submit(q); assert.equal(calls, 1); assert.equal(h.tickets.length, 1);
});

test('cooperative observer timeout preserves host floor and counts unknown local usage, not zero', async t => {
  let calls = 0;
  const planner = createLocalPlanPlanner({complete: request => {
    calls++; return new Promise((_, reject) => request.signal.addEventListener('abort',
      () => reject(request.signal.reason), {once: true}));
  }});
  const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: planner}), q = task(h.directory);
  await h.runtime.submit(q); await waitFor(() => calls === 1); timeoutObserver(h.runtime, q);
  const done = await h.runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 3000}), saved = h.runtime._load(q.task_id);
  assert.equal(done.state, 'returned_unverified'); assert.equal(h.tickets.length, 1);
  assert.equal(h.tickets[0].instruction, q.request); assert.equal(calls, 1);
  assert.equal(saved.adaptive_routing.callback_pending, false);
  assert.equal(saved.adaptive_routing.backend_completion_unknown, true);
  assert.equal(done.resource_usage.plan_model_calls, 1);
  assert.equal(done.resource_usage.local_calls_started, 1);
  assert.equal(done.resource_usage.accounting_complete, false);
  assert.equal(done.resource_usage.total_tokens_observed, null);
  assert.equal(saved.resource_events.filter(e => e.stage === 'plan_proposal' && e.state === 'started').length, 1);
  assert.equal(saved.resource_events.some(e => e.stage === 'plan_proposal' && e.state === 'not_needed'), false);
});

test('pending tool-free shadow fallback dispatches exact OFF floor once; quiescence still waits for actual callback', async t => {
  const pending = deferred(); let calls = 0;
  const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: () => {calls++; return pending.promise;}}), off = await harness(t), q = task(h.directory);
  try {
    await h.runtime.submit(q); await waitFor(() => calls === 1); timeoutObserver(h.runtime, q);
    const done = await h.runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 3000}); await off.run(q);
    assert.equal(done.state, 'returned_unverified'); assert.equal(h.tickets.length, 1);
    assert.deepEqual(ticketWithoutAttempt(h.tickets[0]), ticketWithoutAttempt(off.tickets[0]));
    const saved = h.runtime._load(q.task_id), result = structuredClone(saved.result), plan = structuredClone(saved.plan);
    assert.equal(saved.adaptive_routing.reason, 'shadow_callback_pending_original_route_preserved');
    assert.equal(saved.adaptive_routing.callback_pending, true); assert.equal(saved.adaptive_routing.backend_completion_unknown, true);
    assert.equal(h.runtime.intentControllers.size, 1);
    const paused = h.runtime.quiesce({schema: 1, request_id: 'pending_shadow'});
    assert.equal(paused.safe_to_stop, false); assert(paused.active_dispatches >= 1);
    const invalid = '{"candidate_id":"untrusted-late-route","request":"replace original"}';
    pending.resolve({status: 'proposal', raw_proposal: invalid, completion_outcome_unknown: false});
    await waitFor(() => h.runtime.intentControllers.size === 0);
    const after = h.runtime._load(q.task_id);
    assert.deepEqual(after.plan, plan); assert.deepEqual(after.result, result); assert.deepEqual(after.task, q);
    assert.equal(after.adaptive_routing.raw_proposal, invalid);
    assert.equal(after.adaptive_routing.proposed_unbound_plan, null);
    assert.equal(after.adaptive_routing.callback_pending, false); assert.equal(after.adaptive_routing.backend_completion_unknown, false);
    assert.equal(after.adaptive_routing.reply_settled_after_abort, true);
    assert.equal(h.tickets.length, 1); assert.equal(calls, 1);
    assert.equal(h.runtime.quiesce({schema: 1, request_id: 'callback_settled'}).safe_to_stop, true);
  } finally {pending.resolve({status: 'fallback_required', completion_outcome_unknown: true});}
});

for (const control of ['cancel', 'quiesce', 'close']) {
  test(`authoritative ${control} during timeout grace forbids original-floor dispatch`, async t => {
    const pending = deferred(); let entered = false;
    const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(),
      proposeLocalPlan: () => {entered = true; return pending.promise;}}), q = task(h.directory);
    try {
      await h.runtime.submit(q); await waitFor(() => entered); timeoutObserver(h.runtime, q);
      await sleep(10); // Inside the bounded grace, after its pre-await state read.
      if (control === 'cancel') h.runtime.cancel({schema: 1, task_id: q.task_id});
      else if (control === 'quiesce') h.runtime.quiesce({schema: 1, request_id: 'quiesce_during_grace'});
      else await h.runtime.close({timeoutMs: 0});
      if (control !== 'close') {
        const done = await h.runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 2000});
        assert.equal(done.state, control === 'cancel' ? 'cancelled' : 'held');
        assert.equal(h.runtime.quiesce({schema: 1, request_id: 'not_physically_settled'}).safe_to_stop, false);
      }
      assert.equal(h.tickets.length, 0);
      pending.resolve({status: 'proposal', raw_proposal: proposal(), completion_outcome_unknown: false}); await sleep(25);
      assert.equal(h.tickets.length, 0, 'late result never restarts authoritative stopped work');
    } finally {pending.resolve({status: 'fallback_required', completion_outcome_unknown: true});}
  });
}

test('overall task deadline remains authoritative despite observer-local timeout', async t => {
  const pending = deferred(); let entered = false;
  const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: () => {entered = true; return pending.promise;}});
  const q = task(h.directory, {budget: {max_attempts: 1, max_parallel: 4, max_cost_units: null, max_duration_ms: 1000}});
  try {
    await h.runtime.submit(q); await waitFor(() => entered);
    const done = await h.runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 2000});
    assert.equal(done.state, 'held'); assert.equal(done.error, 'adaptive_plan_interrupted');
    assert.equal(h.tickets.length, 0); assert.equal(h.runtime._load(q.task_id).created_at_ms + 1000 <= Date.now(), true);
  } finally {pending.resolve({status: 'fallback_required', completion_outcome_unknown: true});}
});

test('observer soft fallback never resets native cost or attempt budgets', async t => {
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: async () =>
    ({status: 'fallback_required', completion_outcome_unknown: true})});
  const q = task(h.directory, {budget: {max_attempts: 1, max_parallel: 4, max_cost_units: 0, max_duration_ms: 10000}});
  const done = await h.run(q);
  assert.equal(done.state, 'held'); assert.equal(done.error, 'task_cost_budget_exhausted');
  assert.equal(h.tickets.length, 0); assert.deepEqual(h.runtime._load(q.task_id).task.budget, q.budget);
});

test('native unknown effects and authoritative intent-resolution failure do not become optional shadow fallback', async t => {
  let calls = 0;
  const native = await harness(t, {adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: async () =>
    ({status: 'fallback_required', completion_outcome_unknown: true}), execute: async () => {calls++; throw Error('native outcome unknown');}});
  const q = task(native.directory), result = await native.run(q);
  assert.equal(result.state, 'effects_uncertain'); assert.equal(calls, 1);
  let observations = 0;
  const intent = await harness(t, {adaptiveRoutingPolicy: adaptive(), resolveIntent: async () => {throw Error('intent unavailable');},
    proposeLocalPlan: async () => {observations++; return {status: 'fallback_required'};}});
  const held = await intent.run(task(intent.directory));
  assert.equal(held.state, 'held'); assert.equal(observations, 0); assert.equal(intent.tickets.length, 0);
});

test('late pending observer cannot write through closed owner or replay after restart', async t => {
  const pending = deferred(); let calls = 0;
  const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: () => {calls++; return pending.promise;}}), q = task(h.directory);
  await h.runtime.submit(q); await waitFor(() => calls === 1); timeoutObserver(h.runtime, q);
  const done = await h.runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 3000}); assert.equal(done.state, 'returned_unverified');
  await h.runtime.close({timeoutMs: 0});
  const restarted = await createRCCRuntime({stateDir: h.directory, hostAutoPlan: true, catalog: async v => catalog(v),
    execute: async () => assert.fail('terminal task replayed'), adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: async () => assert.fail('observer replayed')});
  t.after(() => restarted.close());
  const before = restarted.status({schema: 1, task_id: q.task_id});
  pending.resolve({status: 'proposal', raw_proposal: proposal(), completion_outcome_unknown: false}); await sleep(30);
  assert.deepEqual(restarted.status({schema: 1, task_id: q.task_id}), before);
  assert.equal(restarted._load(q.task_id).adaptive_routing.raw_proposal, undefined);
  assert.equal(restarted._load(q.task_id).adaptive_routing.callback_pending, true, 'new owner does not fabricate old callback settlement');
  assert.equal(calls, 1); assert.equal(h.tickets.length, 1);
});

test('late callback lifecycle writes require the SAME original observer binding', async t => {
  const pending = deferred(); let entered = false;
  const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: () => {entered = true; return pending.promise;}}), q = task(h.directory);
  await h.runtime.submit(q); await waitFor(() => entered); timeoutObserver(h.runtime, q);
  await h.runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 3000});
  h.runtime._update(q.task_id, 'fixture_replaced_binding', s => {s.adaptive_routing.binding = {foreign: 'synthetic'};});
  const before = h.runtime._load(q.task_id);
  pending.resolve({status: 'proposal', raw_proposal: proposal(), completion_outcome_unknown: false});
  await waitFor(() => h.runtime.intentControllers.size === 0);
  assert.deepEqual(h.runtime._load(q.task_id), before); assert.equal(h.tickets.length, 1);
});

test('ordinary optional observer exception preserves floor without fabricating backend completion', async t => {
  const h = await harness(t, {adaptiveRoutingPolicy: adaptive(), proposeLocalPlan: async () => {throw Error('local transport rejected');}}), q = task(h.directory);
  const done = await h.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(done.state, 'returned_unverified'); assert.equal(h.tickets.length, 1);
  assert.equal(h.tickets[0].instruction, q.request);
  assert.equal(saved.adaptive_routing.callback_pending, false);
  assert.equal(saved.adaptive_routing.backend_completion_unknown, true);
  assert.equal(done.resource_usage.total_tokens_observed, null);
});

test('unknown controller abort is not silently relabeled as the optional observer deadline', async t => {
  const pending = deferred(); let entered = false;
  const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: () => {entered = true; return pending.promise;}}), q = task(h.directory);
  try {
    await h.runtime.submit(q); await waitFor(() => entered);
    h.runtime.intentControllers.get(q.task_id).controller.abort(new RCCRuntimeError('foreign_abort_reason'));
    const done = await h.runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 2000});
    assert.equal(done.state, 'held'); assert.equal(done.error, 'adaptive_plan_interrupted'); assert.equal(h.tickets.length, 0);
  } finally {pending.resolve({status: 'fallback_required', completion_outcome_unknown: true});}
});

test('restart of a persisted STARTED observer never replays it or automatically salvages a predispatch task', async t => {
  const pending = deferred(); let calls = 0;
  const h = await harness(t, {cancelGraceMs: 100, adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: () => {calls++; return pending.promise;}}), q = task(h.directory);
  await h.runtime.submit(q); await waitFor(() => calls === 1);
  assert.equal(h.runtime._load(q.task_id).adaptive_routing.state, 'started');
  await h.runtime.close({timeoutMs: 0});
  const restarted = await createRCCRuntime({stateDir: h.directory, hostAutoPlan: true, catalog: async v => catalog(v),
    execute: async () => assert.fail('interrupted predispatch task replayed'), adaptiveRoutingPolicy: adaptive(),
    proposeLocalPlan: async () => assert.fail('durable STARTED observer replayed')});
  t.after(() => restarted.close());
  const held = restarted.status({schema: 1, task_id: q.task_id});
  assert.equal(held.state, 'held'); assert.equal(restarted._load(q.task_id).adaptive_routing.planner_invoked, true);
  await restarted.submit(q);
  pending.resolve({status: 'proposal', raw_proposal: proposal(), completion_outcome_unknown: false}); await sleep(25);
  assert.deepEqual(restarted.status({schema: 1, task_id: q.task_id}), held);
  assert.equal(calls, 1); assert.equal(h.tickets.length, 0);
});
