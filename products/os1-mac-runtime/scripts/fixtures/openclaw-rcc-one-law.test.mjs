// The one law (converged routing architecture v2, K1/K2), on the actual Core
// with temp SQLite and canned planner/native receipts. No provider, model,
// network, real HOME or installed app is touched.
//
// Every row the Core binds comes from selectRouteCandidate: the reference,
// the reference the owner's words leave, or a certified descent that carries
// its fixed reference escalation. No second binding function exists, so no
// 'execution_only' (unchecked, uncertified) row can be bound again, on the
// bounded planner path, a re-resolution or a pool spread.
import './local-model-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, chmod, rm, realpath, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRCCRuntime, hostContextFingerprint, registerNodeVerifiers} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {adaptiveRuntimeOptions} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
const H = s => createHash('sha256').update(s).digest('hex');
const RUNTIME = new URL('../../Resources/openclaw-os1-bridge/rcc-runtime.mjs', import.meta.url);
const policyText = 'Preserve the original objective and source. Proposal is not execution authority.';
const REJECTED = 'provider_quota_rejected_before_execution';
// R0 (b) (K4): registered sound_full node verifiers applying to every
// read-only node; each accepts only the fixture executor's answer.
const sound = (id, verify) => registerNodeVerifiers(new Map([[id, {id, scope: 'read_only', surfaces: ['agent', 'chat'],
  soundness: 'sound_full', applies: () => true, verify,
  refutations: [{instruction: 'Read the provided definition and explain its boundary precisely.', output: 'wrong'}]}]]));
const CERTIFY = await sound('fixture-result', async input => ({passed: input.output === 'fixture result', reason: 'fixture'}));
const REJECTS = await sound('fixture-rejects', async () => ({passed: false, reason: 'fixture rejected'}));

function task(dir, hostPatch = {}) {
  const request = 'Read the provided definition and explain its boundary precisely.';
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null, ...hostPatch};
  return {schema: 1, task_id: randomUUID(), request, objective: request, request_sha256: H(request),
    policy_sha256: H(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 1, max_parallel: 4, max_cost_units: null, max_duration_ms: 10000}, host_context: host,
    policy: {source_sha256: H('source'), projection_sha256: H(policyText), text: policyText}};
}
// Two pools, each with its frontier reference and a cheap fast row.
function catalog(q) {
  const now = Date.now();
  const row = (id, surface, model, effort, pool) => ({id, surface,
    transport: surface === 'codex' ? 'codex_app_server' : 'claude_cli', account_id: 'fixture', model, effort,
    tools: ['read', 'execute'], scope: 'read_only', permission_profile: 'read_only', quota_pool: pool, allowed_paths: [],
    configuration_sha256: H(id), availability: 'available', availability_observed_at_ms: now - 1,
    availability_valid_until_ms: now + 60000, quota_remaining_fraction: 0.8, quota_observed_at_ms: now - 1,
    quota_valid_until_ms: now + 60000, quality_state: 'policy_admitted', estimated_cost_units: model.includes('luna') ||
      model.includes('haiku') ? 0 : 1});
  return {schema: 1, task_id: q.task_id, request_sha256: q.request_sha256, owner_scope: 'read_only',
    request_class: 'readonly_lookup', chat_lane_eligible: false,
    model_tiers: {'gpt-6-astra': 'frontier', 'gpt-6-luna': 'fast', 'claude-fable-5-1': 'frontier', 'claude-haiku-4-5-20251001': 'fast'},
    candidates: [row('astra', 'codex', 'gpt-6-astra', 'ultra', 'openai_codex'),
      row('luna', 'codex', 'gpt-6-luna', 'low', 'openai_codex'),
      row('fable', 'claude', 'claude-fable-5-1', 'max', 'anthropic_shared'),
      row('haiku', 'claude', 'claude-haiku-4-5-20251001', 'low', 'anthropic_shared')]};
}
// The planner's one node names the cheapest row: a hint, never a binding.
const cheapHint = () => JSON.stringify({schema: 2, kind: 'untrusted_local_plan_proposal', nodes: [{
  proposal_node_id: 'a', instruction: 'Explain the supplied definition.', requirement_refs: ['owner_objective'],
  dependencies: [], material_refs: [], proposed_candidate_id: 'luna', proposed_scope: 'read_only',
  proposed_owned_paths: [], required_output: 'Source-grounded explanation', check_refs: [], reason_code: 'independent_read'}],
  final_output_proposal: {mode: 'direct_child', node_ids: ['a']}});
function completed(ticket, patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', execution_verified: true,
    task_verified: false, task_quality: 'execution_only', parity_state: 'unverified', output: 'fixture result',
    native_receipt: '/private/fixture/' + ticket.attempt_id, native_summary: null, ...patch};
}
const rejected = ticket => completed(ticket, {status: 'failed', dispatch_stage: 'not_dispatched', output: null,
  execution_verified: false, task_quality: 'failed', error: REJECTED});
async function harness(t, options) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'os1-one-law-'))); await chmod(directory, 0o700);
  const tickets = [];
  const runtime = await createRCCRuntime({stateDir: directory, hostAutoPlan: true,
    catalog: async q => catalog(q), ...options(tickets, () => runtime)});
  t.after(async () => {await runtime.close(); await rm(directory, {recursive: true, force: true});});
  const run = async q => {await runtime.submit(q); return runtime.wait({schema: 1, task_id: q.task_id}, {timeoutMs: 4000});};
  return {directory, runtime, tickets, run};
}
// The invariant: a bound child is the reference, the owner's tuple, or a
// certified descent with its escalation reference fixed at bind.
function lawBound(child) {
  return child.route_kind === 'reference' || child.route_kind === 'explicit' ||
    (child.route_kind === 'tier' && typeof child.ladder?.reference_candidate_id === 'string');
}
const tuple = ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`;

test('the Core has one binding function: no unchecked execution-only route kind can be bound', async () => {
  const source = await readFile(RUNTIME, 'utf8');
  assert.equal(source.includes('executionPolicyChoice'), false);
  assert.equal(source.includes('host_checked_unmeasured_choice'), false);
  assert.equal(/kind: 'execution_only'/.test(source), false, 'no route kind execution_only is constructed');
});

test('App bounded options: the planner is not asked (K3); the bind and the re-resolution bind by the law', async t => {
  let calls = 0;
  const h = await harness(t, tickets => ({...adaptiveRuntimeOptions({pluginConfig: {bounded_auto: true},
    complete: async () => {calls++; return {provider: 'ollama', model: 'qwen3.5:4b', responseModel: 'qwen3.5:4b',
      stopReason: 'stop', execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}, text: cheapHint()};}}),
  maximumWorkers: 4, maximumReadWorkersPerPool: 4,
  execute: async ticket => {tickets.push(ticket); return tickets.length === 1 ? rejected(ticket) : completed(ticket);}}));
  const q = task(h.directory), done = await h.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(calls, 0, 'no admissible check or plan shape: the local planner is not asked');
  assert.equal(done.state, 'returned_unverified', JSON.stringify(done));
  assert.equal(saved.adaptive_routing.reason, 'no_admissible_check_or_shape');
  assert.equal(saved.plan_provenance, 'host_exact_request');
  // The first pool's reference was refused before execution; the other pool's reference ran.
  assert.deepEqual(h.tickets.map(tuple), ['gpt-6-astra/ultra', 'claude-fable-5-1/max']);
  assert(h.tickets.every(x => !['luna', 'haiku'].includes(x.candidate_id)), 'the cheap hint never bound');
  assert(saved.children.every(lawBound), JSON.stringify(saved.children.map(c => c.route_kind)));
  assert.match(saved.children[0].routing_decision.reason,
    new RegExp(`^re_resolved_after:${REJECTED};other_pool;route_reference;admitted_reference_uncertified;`));
});

// K5: the owner's explicit A/B partition is topology hostPlan builds with no
// planner call; each unit binds by the same law, so no unchecked row binds.
test('App bounded options with an owner A/B request: no planner call, every unit binds by the law (K5)', async t => {
  let calls = 0;
  const h = await harness(t, tickets => ({...adaptiveRuntimeOptions({pluginConfig: {bounded_auto: true},
    complete: async () => {calls++; return {provider: 'ollama', model: 'qwen3.5:4b', responseModel: 'qwen3.5:4b',
      stopReason: 'stop', execution: {mode: 'direct-provider', owner: {kind: 'provider', id: 'ollama'}}, text: cheapHint()};}}),
  maximumWorkers: 4, maximumReadWorkersPerPool: 4,
  execute: async ticket => {tickets.push(ticket); return completed(ticket);}}));
  const request = 'Process A and B as independent tasks in parallel. Return each result unchanged.\n\nA — Return the supplied number only: 19.\n\nB — Return the supplied word only: orchard.';
  const q = {...task(h.directory), request, objective: request, request_sha256: H(request)};
  const done = await h.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(calls, 0, 'owner topology never asks the local planner');
  assert.equal(done.state, 'returned_unverified', JSON.stringify(done));
  assert.equal(saved.plan_provenance, 'host_owner_explicit_parallel_v1');
  assert.equal(h.tickets.length, 2);
  assert.equal(saved.children.filter(c => c.route_kind === 'execution_only').length, 0);
  assert(saved.children.every(lawBound) && saved.children.every(c => c.route_kind === 'reference'),
    JSON.stringify(saved.children.map(c => c.route_kind)));
  assert(h.tickets.every(x => !['luna', 'haiku'].includes(x.candidate_id)), 'no cheap row binds a unit');
});

test('a child an older build bound execution-only re-resolves to the reference, not a cheaper row', async t => {
  // Certified by a registered verifier, the node would re-admit its descent in
  // the other pool. Marked as the older build's unchecked execution-only
  // route, it may only move to a reference.
  for (const legacy of [false, true]) {
    const h = await harness(t, (tickets, runtime) => ({verifierRegistry: CERTIFY,
      execute: async ticket => {
        tickets.push(ticket);
        if (tickets.length > 1) return completed(ticket);
        if (legacy) runtime()._update(ticket.task_id, 'fixture_older_build_execution_only', snapshot => {
          const child = snapshot.children.find(c => c.id === ticket.node_id);
          child.route_kind = 'execution_only'; child.ladder = null;
        });
        return rejected(ticket);
      }}));
    const q = task(h.directory), done = await h.run(q), saved = h.runtime._load(q.task_id);
    assert.equal(h.tickets.length, 2, JSON.stringify(done));
    assert.equal(tuple(h.tickets[0]), 'gpt-6-luna/low', 'the certified descent bound first');
    const [child] = saved.children;
    if (legacy) {
      assert.equal(tuple(h.tickets[1]), 'claude-fable-5-1/max');
      assert.equal(child.route_kind, 'reference'); assert.equal(child.ladder, null);
      assert.match(child.routing_decision.reason, new RegExp(`^re_resolved_after:${REJECTED};other_pool;route_reference;admitted_reference_escalation;`));
    } else {
      assert.equal(tuple(h.tickets[1]), 'claude-haiku-4-5-20251001/low');
      assert.equal(child.route_kind, 'tier'); assert.equal(child.ladder.reference_candidate_id, 'fable');
    }
    assert(lawBound(child));
  }
});

// K13: C3 (native sub-agent parity) was never implemented and is withdrawn.
// No Core ticket allows native sub-agents or carries a delegation object; the
// typed delegation is reserved until a native adapter enforces it before
// dispatch, and the Swift contract refuses the flag.
test('no Core ticket carries native delegation (K13)', async t => {
  const source = await readFile(RUNTIME, 'utf8');
  assert.equal(source.includes('allow_native_subagents'), false, 'Core never emits the flag');
  assert.equal(source.includes('delegation:'), false, 'Core never emits a delegation object');
  const undelegated = ticket => !Object.hasOwn(ticket, 'allow_native_subagents') && !Object.hasOwn(ticket, 'delegation');
  const session = randomUUID();
  // (a) The C3 trigger shape: Auto, one node, the Codex reference, a resumed
  // owner thread. (b) The Claude reference, resumed. Each is one ticket.
  for (const [hostPatch, expected] of [[{codex_session_id: session}, 'gpt-6-astra/ultra'],
    [{claude_session_id: session}, 'claude-fable-5-1/max']]) {
    const h = await harness(t, tickets => ({execute: async ticket => {tickets.push(ticket); return completed(ticket);}}));
    const q = task(h.directory, hostPatch), done = await h.run(q), saved = h.runtime._load(q.task_id);
    assert.equal(done.state, 'returned_unverified', JSON.stringify(done));
    assert.deepEqual(h.tickets.map(tuple), [expected]);
    assert.equal(saved.children[0].route_kind, 'reference');
    assert.equal(h.tickets[0].native_resume_session_id, session, 'the owner thread is resumed');
    assert(h.tickets.every(undelegated), JSON.stringify(h.tickets));
  }
  // (c) A certified descent whose verifier fails, then its fixed escalation.
  const h = await harness(t, tickets => ({verifierRegistry: REJECTS,
  execute: async ticket => {tickets.push(ticket); return completed(ticket);}}));
  const q = task(h.directory), done = await h.run(q);
  assert.deepEqual(h.tickets.map(tuple), ['gpt-6-luna/low', 'gpt-6-astra/ultra'], JSON.stringify(done));
  assert(h.tickets.every(undelegated), JSON.stringify(h.tickets));
});
