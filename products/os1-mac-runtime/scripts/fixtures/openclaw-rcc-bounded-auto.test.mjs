// Actual SQLite owner + bounded injected planner/native fixtures. No provider,
// model, network, real HOME or installed app is touched by these regressions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdtemp, chmod, rm, mkdir, writeFile, readFile, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRCCRuntime, hostContextFingerprint, RCCRuntimeError, admitBoundedAutoPlan, registerNodeVerifiers} from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import {createPlannerHostProjection, compileFreshPlannerProposal} from '../../Resources/openclaw-os1-bridge/adaptive-plan-host.mjs';
import {adaptiveRuntimeOptions} from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';
import {createLocalPlanPlanner, projectLocalPlannerCandidates} from '../../Resources/openclaw-os1-bridge/local-plan-planner.mjs';
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

// The one law (converged routing architecture v2, K1/K2): the local planner
// proposes topology only. Every proposed node binds by selectRouteCandidate,
// a model-authored decomposition needs a plan-shape certificate that does not
// exist yet, and a planner's candidate id never binds a row.
const reply = raw => async () => ({status: 'proposal', raw_proposal: raw, completion_outcome_unknown: false});
const single = (hint = 'reference') => {const raw = JSON.parse(proposal()); raw.nodes = raw.nodes.slice(0, 1);
  raw.nodes[0].proposed_candidate_id = hint; raw.final_output_proposal = {mode: 'direct_child', node_ids: ['a']};
  return JSON.stringify(raw);};
const dependent = () => {const raw = JSON.parse(proposal()); raw.nodes[1].dependencies = ['a'];
  raw.final_output_proposal = {mode: 'direct_child', node_ids: ['b']}; return JSON.stringify(raw);};
const cheapHints = raw => {const p = JSON.parse(raw); for (const n of p.nodes) n.proposed_candidate_id = 'cheap'; return JSON.stringify(p);};
function withCheap(q) {
  const c = catalog(q);
  c.candidates.push({...c.candidates[0], id: 'cheap', model: 'gpt-6-luna', effort: 'low', estimated_cost_units: 0,
    configuration_sha256: H('cheap')});
  c.model_tiers['gpt-6-luna'] = 'fast';
  return c;
}
const writerTask = dir => {const q = task(dir); q.host_context.require_read_only = false;
  q.source_fingerprint = hostContextFingerprint(q.host_context); return q;};
const writerRow = (c, id, patch = {}) => ({...c.candidates[0], id, scope: 'workspace_write',
  permission_profile: 'workspace_write', tools: ['read', 'write', 'execute'], allowed_paths: ['**'],
  configuration_sha256: H(id), ...patch});

test('a model decomposition is not admitted without a plan-shape certificate: the request runs once at the reference', async t => {
  for (const raw of [proposal(), dependent(), cheapHints(proposal())]) {
    const h = await harness(t, {boundedAutoPlanning: true, catalog: async q => withCheap(q), proposeLocalPlan: reply(raw)});
    const q = task(h.directory), done = await h.run(q), saved = h.runtime._load(q.task_id);
    assert.equal(done.state, 'returned_unverified', JSON.stringify(done));
    assert.equal(h.tickets.length, 1);
    assert.equal(h.tickets[0].instruction, q.request);
    assert.equal(h.tickets[0].candidate_id, 'reference');
    assert.equal(saved.plan_provenance, 'host_exact_request');
    assert.equal(saved.adaptive_routing.live_plan_changed, false);
    assert.equal(saved.adaptive_routing.quality_certificate, false);
    assert(saved.children.every(c => c.route_kind === 'reference'));
    await h.runtime.submit(q); assert.equal(h.tickets.length, 1, 'no replay');
  }
});
test('bad bounded candidate restores original host floor before any dispatch', async t => {
  const raw = JSON.parse(proposal());raw.nodes[0].proposed_candidate_id='foreign';
  const h = await harness(t, {boundedAutoPlanning: true,
    proposeLocalPlan: async () => ({status:'proposal',raw_proposal:JSON.stringify(raw),completion_outcome_unknown:false})}), q=task(h.directory);
  await h.run(q);assert.equal(h.tickets.length,1);assert.equal(h.tickets[0].instruction,q.request);
  assert.equal(h.runtime._load(q.task_id).adaptive_routing.live_plan_changed,false);
});
test('one proposed node keeps the original words and binds by the law: a cheap hint never binds', async t => {
  const h = await harness(t, {boundedAutoPlanning: true, catalog: async q => withCheap(q), proposeLocalPlan: reply(single('cheap'))});
  const q = task(h.directory), done = await h.run(q), saved = h.runtime._load(q.task_id);
  assert.equal(done.state, 'returned_unverified', JSON.stringify(done));
  assert.equal(h.tickets.length, 1); assert.equal(h.tickets[0].instruction, q.request);
  assert.equal(h.tickets[0].candidate_id, 'reference');
  assert.equal(saved.plan_provenance, 'host_checked_execution_plan_v1');
  assert.equal(saved.children[0].route_kind, 'reference');
  assert.match(saved.children[0].routing_decision.reason, /^bounded_plan;route_reference;admitted_reference_uncertified;/);
});
test('read-only parent cannot gain write authority from local plan', async t => {
  const raw=JSON.parse(proposal());raw.nodes[0].proposed_scope='workspace_write';raw.nodes[0].proposed_owned_paths=['evil'];
  const h=await harness(t,{boundedAutoPlanning:true,proposeLocalPlan:async()=>({status:'proposal',raw_proposal:JSON.stringify(raw),completion_outcome_unknown:false})}),q=task(h.directory);
  await h.run(q);assert.equal(h.tickets.length,1);assert.equal(h.tickets[0].selected_config.scope,'read_only');
  assert.equal(h.tickets[0].instruction,q.request);
});

test('bounded flag is not a shortcut around an existing full task contract or explicit max', async t => {
  for (const modifier of [c=>({...c,task_contract:{coverage:'full'}}),c=>({...c,routing_intent_v2:{version:'r10_joint_selection_v2',allowed_surfaces:[],exact_model:null,model_family:null,effort:null,require_native_ceiling:true,quality_target:null,state:'resolved'}})]) {
    const q=task('/private/test'),c=modifier(catalog(q));
    const prepared=createPlannerHostProjection({task:q,catalog:c,scope:'read_only',nonce:'fixed_nonce'});
    const compiled=compileFreshPlannerProposal(single(),prepared,prepared,{max_nodes:4});
    assert.throws(()=>admitBoundedAutoPlan(compiled,q,c));
  }
});
test('bound material cannot be dropped by a model branch', async t => {
  const h=await harness(t,{boundedAutoPlanning:true,proposeLocalPlan:reply(single())});
  const q=task(h.directory,{material_refs:['source:test:immutable']});
  await h.run(q);assert.equal(h.tickets.length,1);
  for(const ticket of h.tickets) assert.deepEqual(ticket.context_refs,q.material_refs);
});
test('no exhausted, stale or out-of-scope row binds a bounded node', () => {
  for(const change of [c=>c.quota_remaining_fraction=0,c=>c.availability_valid_until_ms=0,c=>c.scope='workspace_write']) {
    const q=task('/private/test'),c=catalog(q);change(c.candidates[0]);
    const prepared=createPlannerHostProjection({task:q,catalog:c,scope:'read_only',nonce:'fixed_nonce'});
    const compiled=compileFreshPlannerProposal(single(),prepared,prepared,{max_nodes:4});
    assert.throws(()=>admitBoundedAutoPlan(compiled,q,c));
  }
});
test('a registered verifier certifies a bounded read node: the descent carries its fixed reference escalation', async () => {
  const q = task('/private/test'), c = withCheap(q);
  const prepared = createPlannerHostProjection({task: q, catalog: c, scope: 'read_only', nonce: 'fixed_nonce'});
  const compiled = compileFreshPlannerProposal(single('reference'), prepared, prepared, {max_nodes: 4});
  // K4: a registered sound_full node verifier (it rejects its refutation and the Core nonce).
  const registry = await registerNodeVerifiers(new Map([['bounded-read', {id: 'bounded-read', scope: 'read_only',
    surfaces: ['agent', 'chat'], soundness: 'sound_full', applies: () => true,
    verify: async input => ({passed: input.output === 'fixture answer'}),
    refutations: [{instruction: 'fixture instruction', output: 'fixture wrong answer'}]}]]));
  const uncertified = admitBoundedAutoPlan(compiled, q, c);
  const [plain] = uncertified.plan.nodes;
  assert.equal(plain.candidate_id, 'reference'); assert.equal(uncertified.routes[plain.id].kind, 'reference');
  const certified = admitBoundedAutoPlan(compiled, q, c, Date.now(), registry);
  const [node] = certified.plan.nodes;
  assert.equal(node.candidate_id, 'cheap');
  assert.equal(certified.routes[node.id].kind, 'tier');
  assert.equal(certified.routes[node.id].ladder.reference_candidate_id, 'reference');
  assert.equal(certified.routes[node.id].ladder.admitted_by, 'verifier');
  assert.equal(certified.routes[node.id].ladder.certificate_id, 'bounded-read');
  assert.match(certified.decisions[node.id].reason, /^bounded_plan;route_tier;admitted_certified_verifier;/);
});
test('writer preparation from a model is not admitted: ONE host writer runs the request', async t => {
  const h = await harness(t, {boundedAutoPlanning: true, proposeLocalPlan: reply(proposal()),
    catalog: async q => {const c = catalog(q); c.owner_scope = 'workspace_write'; c.request_class = 'writer';
      c.candidates.push(writerRow(c, 'writer')); return c;}});
  const q = writerTask(h.directory), done = await h.run(q);
  assert.equal(done.state, 'returned_unverified', JSON.stringify(done)); assert.equal(h.tickets.length, 1);
  const [writer] = h.tickets;
  assert.equal(writer.selected_config.scope, 'workspace_write'); assert.equal(writer.instruction, q.request);
  assert.equal(writer.original_request, q.request); assert.deepEqual(writer.owned_paths, ['**']);
  assert.doesNotMatch(writer.instruction, /DEPENDENCY DATA/);
});
test('future telemetry cannot authorize a bounded hint',()=>{
  const q=task('/private/test'),c=catalog(q);c.candidates[0].availability_observed_at_ms=Date.now()+600000;
  const prep=createPlannerHostProjection({task:q,catalog:c,scope:'read_only',nonce:'fixed_nonce'});
  const compiled=compileFreshPlannerProposal(single(),prep,prep,{max_nodes:4});
  assert.throws(()=>admitBoundedAutoPlan(compiled,q,c));
});

test('a finalizer hint is not a binding: the host writer binds the reference writer row by the law', async t=>{
  const raw=JSON.parse(single());raw.final_output_proposal.host_finalizer_candidate_id='writer_hint';
  const h=await harness(t,{boundedAutoPlanning:true,catalog:async q=>{const c=catalog(q);c.owner_scope='workspace_write';c.request_class='writer';
    c.model_tiers['gpt-6-luna']='fast';
    c.candidates.push(writerRow(c,'writer'),writerRow(c,'writer_hint',{model:'gpt-6-luna',effort:'low',estimated_cost_units:0}));return c;},
    proposeLocalPlan:reply(JSON.stringify(raw))});
  const q=writerTask(h.directory);
  await h.run(q);assert.equal(h.tickets.length,1);assert.equal(h.tickets[0].candidate_id,'writer');assert.equal(h.tickets[0].instruction,q.request);
});

test('a writer row whose permission profile is not its scope binds nothing',()=>{
  const q=writerTask('/private/test');
  const c=catalog(q);c.owner_scope='workspace_write';c.request_class='writer';
  c.candidates.push(writerRow(c,'writer_hint',{permission_profile:'read_only'}));
  const raw=JSON.parse(single());raw.final_output_proposal.host_finalizer_candidate_id='writer_hint';
  const prep=createPlannerHostProjection({task:q,catalog:c,scope:'read_only',nonce:'fixed_nonce'});
  const compiled=compileFreshPlannerProposal(JSON.stringify(raw),prep,prep,{max_nodes:3});
  assert.throws(()=>admitBoundedAutoPlan(compiled,q,c),{code:/^no_dispatchable_candidate:workspace_write/});
});

test('with no runnable reference bounded Auto holds before any planner call or dispatch (no cheap fallback)',async t=>{
  let calls=0;
  const h=await harness(t,{boundedAutoPlanning:true,
    catalog:async q=>{const c=catalog(q);c.candidates[0].model='gpt-6-luna';c.candidates[0].effort='low';c.model_tiers={'gpt-6-luna':'fast'};c.exclusions=[{provider:'codex',reason:'reference_unavailable',count:1}];return c;},
    proposeLocalPlan:async()=>{calls++;return {status:'proposal',raw_proposal:single(),completion_outcome_unknown:false};}}),q=task(h.directory);
  const done=await h.run(q);
  assert.equal(done.state,'held',JSON.stringify(done));assert.equal(h.tickets.length,0);assert.equal(calls,0);
  assert.match(h.runtime._load(q.task_id).error,/^no_dispatchable_candidate:/);
});

test('App-shaped bounded options: the real local compiler runs once and its cheap hints never bind', async t => {
  let calls=0;
  const options=adaptiveRuntimeOptions({pluginConfig:{bounded_auto:true},complete:async request=>{
    calls++;
    const input=JSON.parse(request.messages[0].content);
    assert.equal(input.candidate_metadata.owner_scope,'workspace_write','catalog authority ceiling retained');
    assert.equal(input.candidate_metadata.effective_scope,'read_only','separate host-derived effective scope');
    assert.equal(Object.hasOwn(input,'host_finalizer'),false,'read task is not writer preparation');
    return {provider:'ollama',model:'qwen3.5:4b',responseModel:'qwen3.5:4b',stopReason:'stop',
      execution:{mode:'direct-provider',owner:{kind:'provider',id:'ollama'}},text:cheapHints(proposal())};
  }});
  const h=await harness(t,{...options,maximumWorkers:4,maximumReadWorkersPerPool:4,
    catalog:async q=>{const c=withCheap(q);c.owner_scope='workspace_write';return c;}});
  const q=writerTask(h.directory);
  const original=JSON.stringify(q),done=await h.run(q),saved=h.runtime._load(q.task_id);
  assert.equal(calls,1);assert.equal(done.state,'returned_unverified',JSON.stringify(done));
  assert.equal(h.tickets.length,1);assert.equal(saved.plan_provenance,'host_exact_request');
  assert.equal(saved.adaptive_routing.quality_certificate,false);
  assert(h.tickets.every(x=>x.selected_config.scope==='read_only'&&x.selected_config.model==='gpt-6-astra'&&x.selected_config.effort==='ultra'));
  assert(h.tickets.every(x=>x.original_request===q.request&&x.original_objective===q.objective));
  assert.equal(JSON.stringify(q),original,'original task/policy/source unchanged');
});

test('effective scope is contained by owner ceiling and cannot create a final writer hint',()=>{
  const q=task('/private/test'),c=catalog(q),prep=createPlannerHostProjection({task:q,catalog:c,scope:'read_only',nonce:'fixed_nonce'});
  assert.throws(()=>projectLocalPlannerCandidates({catalog:c,hostProjection:prep.hostProjection,expectedBinding:prep.expectedBinding,now_ms:Date.now(),executionScope:'workspace_write'}),{code:'planner_effective_scope_not_owner_admitted'});
  c.owner_scope='workspace_write';const wide=createPlannerHostProjection({task:q,catalog:c,scope:'read_only',nonce:'fixed_nonce'});
  const view=projectLocalPlannerCandidates({catalog:c,hostProjection:wide.hostProjection,expectedBinding:wide.expectedBinding,now_ms:Date.now(),executionScope:'read_only'});
  assert.equal(view.owner_scope,'workspace_write');assert.equal(view.effective_scope,'read_only');
  assert.equal(view.catalog_sha256,wide.expectedBinding.catalog_sha256,'catalog hash not rewritten to hide capability/effective distinction');
});

test('write ceiling never enables a model finalizer hint for an effective read task',async t=>{
  const options=adaptiveRuntimeOptions({pluginConfig:{bounded_auto:true},complete:async()=>{
    const raw=JSON.parse(proposal());raw.final_output_proposal.host_finalizer_candidate_id='writer_hint';
    return {provider:'ollama',model:'qwen3.5:4b',responseModel:'qwen3.5:4b',stopReason:'stop',
      execution:{mode:'direct-provider',owner:{kind:'provider',id:'ollama'}},text:JSON.stringify(raw)};
  }});
  const h=await harness(t,{...options,catalog:async q=>{const c=catalog(q);c.owner_scope='workspace_write';
    c.candidates.push({...c.candidates[0],id:'writer_hint',scope:'workspace_write',permission_profile:'workspace_write',tools:['read','write','execute'],allowed_paths:['**'],configuration_sha256:H('writer_hint')});return c;}});
  const q=task(h.directory);q.host_context.require_read_only=false;q.source_fingerprint=hostContextFingerprint(q.host_context);
  const done=await h.run(q),saved=h.runtime._load(q.task_id);
  assert.equal(done.state,'returned_unverified');assert.equal(h.tickets.length,1,'rejected hint preserves exact host fallback');
  assert(h.tickets.every(x=>x.selected_config.scope==='read_only'));assert.equal(saved.plan_provenance,'host_exact_request');
  assert.equal(saved.adaptive_routing.live_plan_changed,false);assert.equal(saved.adaptive_routing.quality_certificate,false);
});
