// K4: node verifier registry soundness (routing architecture v2, R0 (b), I2).
// A registered 'sound_full' verifier certifies only the nodes its own
// applies() admits; registration refuses one that passes its refutations or
// a Core nonce, or whose probe does not answer {passed: false} (fail closed);
// a certifier gets the probes' row-free input; a verifier-admitted descent is
// delivered only with that verifier's pass on THIS attempt, and with its
// certifier gone it is discarded and the node runs its fixed reference once
// (or holds). A 'partial' or legacy family entry is a failure signal only.
// Real durable Core with temp SQLite and a fake executor: no provider, model,
// network, real HOME or installed app is touched.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { admittedRoute, createRCCRuntime, hostContextFingerprint, registerNodeVerifiers,
  resolveRoutePlan } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import { adaptiveRuntimeOptions } from '../../Resources/openclaw-os1-bridge/rcc-plugin.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const policyText = 'RCC verifier registry fixture policy: candidates do not grant authority.';
const FAMILY_A = 'Fixture family A: answer one question';
const PROSE = 'Explain the boundary of the provided definition in plain prose.';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-verifier-registry-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request) {
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, model, effort) {
  const now = Date.now();
  return {id, surface: 'codex', transport: 'codex_app_server', account_id: 'account-1', model, effort,
    tools: ['read', 'execute'], scope: 'read_only', permission_profile: 'read_only', quota_pool: 'openai_codex',
    allowed_paths: [], configuration_sha256: sha('config:' + id), availability: 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
// One pool: the frontier reference (astra/max) and one cheap fast row.
function catalog(request, {reference = true, facts = {}} = {}) {
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
    candidates: [...(reference ? [row('astra', 'gpt-6-astra', 'max')] : []), row('luna', 'gpt-6-luna', 'low')],
    model_tiers: {...(reference ? {'gpt-6-astra': 'frontier'} : {}), 'gpt-6-luna': 'fast'}, ...facts};
}
const node = instruction => ({id: 'n', instruction, dependencies: [], kind: 'agent', scope: 'read_only',
  owned_paths: [], context_refs: []});
const plan = request => ({schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
  nodes: [node(request.request)]});
function execution(ticket, output, patch = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none', output,
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: null, native_turn_terminated: true, ...patch};
}
const verdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
  parity_state: 'unverified', reason: 'fixture_deterministic_coverage'});
const familyA = value => value.instruction.startsWith('Fixture family A:');
const exactAlpha = async input => ({passed: input.output === 'alpha', reason: 'fixture exact'});
// A registry entry (object form); `sound_full` entries carry a refutation.
function entry(id, {soundness = 'sound_full', applies = familyA, verify = exactAlpha, surfaces = ['agent', 'chat'],
                    refutations = [{instruction: FAMILY_A, output: 'beta'}], ...extra} = {}) {
  return {id, scope: 'read_only', surfaces, soundness, applies, verify,
    ...(soundness === 'sound_full' ? {refutations} : {}), ...extra};
}
const tuple = ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`;
// Auto with the host-built plan: the node runs the request byte-exact.
async function runtimeFor(t, dir, {verifierRegistry, execute, catalogOf = (value, _count) => catalog(value), name = randomUUID()}) {
  const tickets = [];
  let catalogCalls = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, 'state-' + name), hostAutoPlan: true,
    ...(verifierRegistry ? {verifierRegistry} : {}),
    catalog: async value => catalogOf(value, ++catalogCalls),
    plan: async () => { throw Error('Auto must not call plan()'); },
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length, runtime); },
    verifyTask: verdict});
  t.after(async () => { await runtime.close(); });
  const run = async request => {
    const before = tickets.length;
    await runtime.submit(request);
    const done = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
    const own = tickets.slice(before);
    return {done, tickets: own, tuples: own.map(tuple), saved: runtime._load(request.task_id),
      events: runtime.events({schema: 1, task_id: request.task_id})};
  };
  return {runtime, run};
}

test('T1 registration refuses an unsound or malformed registry, by registerNodeVerifiers and createRCCRuntime', async t => {
  const dir = await fixture(t);
  const unsound = {
    'passes everything': entry('always', {verify: async () => ({passed: true, reason: 'fixture'})}),
    'rejects its refutation but passes the Core nonce': entry('nonce', {
      refutations: [{instruction: '2+2', output: '5'}], verify: async input => ({passed: input.output !== '5'})}),
  };
  for (const [name, value] of Object.entries(unsound)) {
    await assert.rejects(registerNodeVerifiers(new Map([[value.id, value]])), /verifier_registration_unsound/, name);
    const stateDir = join(dir, 'refused-' + value.id);
    await assert.rejects(createRCCRuntime({stateDir, verifierRegistry: new Map([[value.id, value]]),
      catalog: async () => { throw Error('never'); }, execute: async () => { throw Error('never'); }}),
    /verifier_registration_unsound/, name);
    await assert.rejects(stat(stateDir), {code: 'ENOENT'}, `${name}: refused before any state is touched`);
  }
  const many = Array.from({length: 17}, (_, index) => ({instruction: 'q' + index, output: 'wrong' + index}));
  const malformed = {
    'a writer scope': ['w', entry('w', {scope: 'workspace_write'})],
    'a local surface': ['l', entry('l', {surfaces: ['local']})],
    'no surfaces': ['e', entry('e', {surfaces: []})],
    'a duplicate surface': ['d', entry('d', {surfaces: ['agent', 'agent']})],
    'an unknown soundness': ['m', entry('m', {soundness: 'maybe'})],
    'a key that is not its id': ['other', entry('k')],
    'an id with a colon': ['trivial:read_only:agent', entry('trivial:read_only:agent')],
    'applies that is not a function': ['a', entry('a', {applies: true})],
    'sound_full without refutations': ['r', (({refutations, ...rest}) => rest)(entry('r'))],
    'more than 16 refutations': ['x', entry('x', {refutations: many})],
    'a refutation with an extra key': ['y', entry('y', {refutations: [{instruction: 'q', output: 'w', extra: 1}]})],
    'a partial with refutations': ['p', {...entry('p', {soundness: 'partial'}), refutations: [{instruction: 'q', output: 'w'}]}],
    'an extra key': ['z', entry('z', {format: 'x'})],
    'a legacy key that is not a string': [7, async () => ({passed: false})],
  };
  for (const [name, [key, value]] of Object.entries(malformed)) {
    await assert.rejects(registerNodeVerifiers(new Map([[key, value]])), /verifier_registry_invalid/, name);
    await assert.rejects(createRCCRuntime({stateDir: join(dir, 'malformed-' + randomUUID()),
      verifierRegistry: new Map([[key, value]]), catalog: async () => ({}), execute: async () => ({})}),
    /verifier_registry_invalid/, name);
  }
  const tooMany = new Map(Array.from({length: 33}, (_, index) => ['f' + index, entry('f' + index,
    {soundness: 'partial'})]));
  await assert.rejects(registerNodeVerifiers(tooMany), /verifier_registry_invalid/, 'more than 32 entries');
  await assert.rejects(registerNodeVerifiers([['f', entry('f')]]), /verifier_registry_invalid/, 'not a Map');
  // Control: a discriminating exact verifier registers. Each refutation is
  // probed, then a Core nonce for each refutation instruction; every probe
  // carries no receipt and no selected configuration.
  const inputs = [];
  const exact = entry('exact', {applies: value => value.instruction === '2+2',
    refutations: [{instruction: '2+2', output: '5'}, {instruction: '2+2', output: '22'}],
    verify: async input => { inputs.push(input); return {passed: input.output === '4', reason: 'exact'}; }});
  const registered = await registerNodeVerifiers(new Map([['exact', exact]]));
  assert.equal(inputs.length, 4);
  assert.deepEqual(inputs.slice(0, 2).map(input => input.output), ['5', '22']);
  assert.ok(inputs.slice(2).every(input => /^os1-verifier-registration-nonce:[0-9a-f-]{36}$/.test(input.output)));
  assert.ok(inputs.every(input => input.selected_config === null && input.native_receipt === null &&
    input.verifier_id === 'exact' && input.instruction === '2+2' && input.task_id === 'verifier_registration_probe'));
  assert.ok(registered instanceof Map && registered.size === 1);
  // Registering a registered registry again probes nothing and returns a new Map.
  const again = await registerNodeVerifiers(registered);
  assert.equal(inputs.length, 4);
  assert.notEqual(again, registered);
  assert.equal(again.get('exact'), registered.get('exact'));
  // Fail closed: a probe that throws, answers malformed or does not answer
  // refuses the registry (a timeout takes this path after the live verifier
  // timeout). A pass-all keyed on the selected configuration dereferences the
  // probe's null configuration and throws: refused too.
  for (const [name, verify] of [['a throw', async () => { throw Error('fixture'); }],
    ['a malformed verdict', async () => ({passed: 'yes'})], ['no verdict', async () => null],
    ['a config-keyed pass-all', async input => ({passed: input.selected_config.model.length > 0})]]) {
    await assert.rejects(registerNodeVerifiers(new Map([['quiet', entry('quiet', {verify})]])),
      /verifier_registration_probe_unanswered/, name);
    await assert.rejects(createRCCRuntime({stateDir: join(dir, 'unanswered-' + randomUUID()),
      verifierRegistry: new Map([['quiet', entry('quiet', {verify})]]), catalog: async () => ({}),
      execute: async () => ({})}), /verifier_registration_probe_unanswered/, name);
  }
});

test('T2 a verifier certifies only the nodes its applies() admits; nothing else certifies', async () => {
  const prose = task('/private/fixture', PROSE), family = task('/private/fixture', FAMILY_A);
  const registry = await registerNodeVerifiers(new Map([['family-a', entry('family-a')]]));
  assert.deepEqual(admittedRoute(node(PROSE), prose, catalog(prose), Date.now(), {verifierRegistry: registry}),
    {class: 'reference', source: 'uncertified', certificate_id: null});
  assert.deepEqual(admittedRoute(node(FAMILY_A), family, catalog(family), Date.now(), {verifierRegistry: registry}),
    {class: 'certified', source: 'verifier', certificate_id: 'family-a'});
  const resolved = resolveRoutePlan(plan(family), family, catalog(family), Date.now(), {verifierRegistry: registry});
  assert.equal(resolved.routes.n.kind, 'tier');
  assert.equal(resolved.plan.nodes[0].candidate_id, 'luna');
  assert.equal(resolved.routes.n.ladder.certificate_id, 'family-a');
  assert.equal(resolved.routes.n.ladder.admitted_by, 'verifier');
  assert.equal(resolved.routes.n.ladder.reference_candidate_id, 'astra');
  assert.match(resolved.decisions.n.reason, /(^|;)route_tier;admitted_certified_verifier;/);
  const proseResolved = resolveRoutePlan(plan(prose), prose, catalog(prose), Date.now(), {verifierRegistry: registry});
  assert.equal(proseResolved.plan.nodes[0].candidate_id, 'astra');
  assert.match(proseResolved.decisions.n.reason, /;admitted_reference_uncertified;/);
  // An applies() that throws, or returns anything but true, admits nothing.
  for (const applies of [() => { throw Error('fixture'); }, () => 'yes', () => 1])
    assert.equal(admittedRoute(node(FAMILY_A), family, catalog(family), Date.now(),
      {verifierRegistry: await registerNodeVerifiers(new Map([['odd', entry('odd', {applies})]]))}).source, 'uncertified');
  // A partial-only registry, a raw (unregistered) Map holding a sound_full
  // object, and a legacy family function (raw or registered) certify nothing.
  const partialOnly = await registerNodeVerifiers(new Map([['partial-a', entry('partial-a', {soundness: 'partial',
    verify: async () => ({passed: true})})]]));
  const legacy = new Map([['trivial:read_only:agent', async () => ({passed: true})],
    ['trivial:read_only:chat', async () => ({passed: true})]]);
  for (const [name, value] of [['partial only', partialOnly], ['raw sound_full object', new Map([['family-a', entry('family-a')]])],
    ['legacy raw', legacy], ['legacy registered', await registerNodeVerifiers(legacy)]]) {
    const r = resolveRoutePlan(plan(family), family, catalog(family), Date.now(), {verifierRegistry: value});
    assert.equal(r.plan.nodes[0].candidate_id, 'astra', name);
    assert.match(r.decisions.n.reason, /;admitted_reference_uncertified;/, name);
  }
  // An entry put into a registered Map afterwards was never probed: inert.
  const tampered = await registerNodeVerifiers(new Map());
  tampered.set('family-a', Object.freeze({...registry.get('family-a')}));
  assert.equal(admittedRoute(node(FAMILY_A), family, catalog(family), Date.now(), {verifierRegistry: tampered}).source,
    'uncertified');
  // With a class certificate present: a verifier that does not apply leaves
  // the class certificate as the admitting source; one that applies comes first.
  const cert = {certificate_id: 'cert-1', provider: 'codex', model: 'gpt-6-luna', effort: 'low',
    format_check: 'nonempty_text', measurement_sha256: sha('frozen measurement')};
  const facts = {owner_scope: 'read_only', chat_lane_eligible: false, request_class: 'readonly_lookup',
    class_certificates: {readonly_lookup: cert}};
  assert.deepEqual(admittedRoute(node(PROSE), prose, catalog(prose, {facts}), Date.now(), {verifierRegistry: registry}),
    {class: 'certified', source: 'class', certificate_id: 'cert-1'});
  assert.deepEqual(admittedRoute(node(FAMILY_A), family, catalog(family, {facts}), Date.now(), {verifierRegistry: registry}),
    {class: 'certified', source: 'verifier', certificate_id: 'family-a'});
  // The certifying entry's own surfaces bound the descent: an agent-only
  // verifier is the source for a node only on an agent row.
  const agentOnly = await registerNodeVerifiers(new Map([['agent-a', entry('agent-a', {surfaces: ['agent']})]]));
  assert.equal(resolveRoutePlan(plan(family), family, catalog(family), Date.now(), {verifierRegistry: agentOnly})
    .routes.n.ladder.certificate_id, 'agent-a');
});

test('T3 two outputs of the same configuration: only the accepted one is delivered; the other runs the reference once', async t => {
  const dir = await fixture(t);
  let cheapCalls = 0;
  const {run} = await runtimeFor(t, dir, {verifierRegistry: new Map([['family-a', entry('family-a')]]),
    execute: ticket => execution(ticket, ticket.selected_config.model === 'gpt-6-astra' ? 'alpha' :
      ++cheapCalls === 1 ? 'alpha' : 'beta')});
  const first = await run(task(dir, FAMILY_A));
  assert.equal(first.done.state, 'completed', first.done.error);
  assert.deepEqual(first.tuples, ['gpt-6-luna/low']);
  assert.equal(first.done.result.output, 'alpha');
  assert.equal(first.saved.children[0].attempt_history[0].verifier, 'pass');
  assert.equal(first.saved.children[0].attempt_history[0].verifier_id, 'family-a');
  assert.equal(first.saved.children[0].ladder.certificate_id, 'family-a');
  const second = await run(task(dir, FAMILY_A));
  assert.equal(second.done.state, 'completed', second.done.error);
  assert.deepEqual(second.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.equal(second.events.filter(event => event.kind === 'ladder_escalated_to_reference').length, 1);
  assert.equal(second.saved.children[0].attempt_history[0].state, 'ladder_verifier_failed');
  assert.equal(second.done.result.output, 'alpha');
  assert.equal(second.saved.children[0].output, 'alpha');
  assert.match(second.done.children[0].routing_decision.reason, /^tier_escalated_after_verifier_failure;/);
  // The rejected answer was never delivered, stored on the child or shown,
  // not even while its verifier ran.
  assert.ok(!JSON.stringify(second.events).includes('beta'), 'the unaccepted descent output never reached the wire');
});

test('T4 a certifier missing at adoption discards the answer and runs the reference; no reference holds', async t => {
  const dir = await fixture(t);
  const gone = (ticket, runtime) => runtime._update(ticket.task_id, 'fixture_certifier_gone', snapshot => {
    snapshot.children.find(c => c.id === ticket.node_id).ladder.certificate_id = 'gone';
  });
  // A correct cheap answer is still never delivered without its certifier.
  const {run} = await runtimeFor(t, dir, {verifierRegistry: new Map([['family-a', entry('family-a')]]),
    execute: (ticket, _count, runtime) => {
      if (ticket.selected_config.model === 'gpt-6-astra') return execution(ticket, 'reference alpha');
      gone(ticket, runtime); return execution(ticket, 'alpha');
    }});
  const escalated = await run(task(dir, FAMILY_A));
  assert.equal(escalated.done.state, 'completed', escalated.done.error);
  assert.deepEqual(escalated.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.equal(escalated.saved.children[0].attempt_history[0].state, 'ladder_not_returned');
  assert.equal(escalated.done.result.output, 'reference alpha');
  assert.equal(escalated.saved.children[0].output, 'reference alpha');
  assert.match(escalated.done.children[0].routing_decision.reason, /^tier_escalated_after_failure_signal;/);
  // No reference can run when the descent is discarded: held, nothing shown.
  const vanishing = await runtimeFor(t, dir, {verifierRegistry: new Map([['family-a', entry('family-a')]]),
    catalogOf: (value, count) => catalog(value, {reference: count === 1}),
    execute: (ticket, _count, runtime) => { gone(ticket, runtime); return execution(ticket, 'alpha'); }});
  const held = await vanishing.run(task(dir, FAMILY_A));
  assert.deepEqual(held.tuples, ['gpt-6-luna/low']);
  assert.equal(held.done.state, 'held', held.done.error);
  assert.equal(held.done.result, null);
  assert.equal(held.saved.children[0].output, null);
  assert.equal(held.done.children[0].output_summary, null);
  // Registration copies the caller's Map: deleting or replacing its entry
  // after createRCCRuntime changes nothing (the hole of HEAD 5576cf30).
  const callerMap = new Map([['family-a', entry('family-a')]]);
  const copied = await runtimeFor(t, dir, {verifierRegistry: callerMap,
    execute: ticket => execution(ticket, 'alpha')});
  callerMap.delete('family-a');
  callerMap.set('family-a', {...entry('family-a'), verify: async () => ({passed: true})});
  const kept = await copied.run(task(dir, FAMILY_A));
  assert.equal(kept.done.state, 'completed', kept.done.error);
  assert.deepEqual(kept.tuples, ['gpt-6-luna/low']);
  assert.equal(kept.done.result.output, 'alpha');
  // A registered Map is copied too: an entry set into it later is not the runtime's.
  const registered = await registerNodeVerifiers(new Map([['family-a', entry('family-a')]]));
  const fromRegistered = await runtimeFor(t, dir, {verifierRegistry: registered,
    execute: ticket => execution(ticket, ticket.selected_config.model === 'gpt-6-astra' ? 'alpha' : 'beta')});
  registered.set('family-a', Object.freeze({...registered.get('family-a'), verify: async () => ({passed: true})}));
  const rejected = await fromRegistered.run(task(dir, FAMILY_A));
  assert.deepEqual(rejected.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.equal(rejected.done.result.output, 'alpha');
});

test('T5 an escalated reference keeps the certifier as a failure signal: disclosed, never replayed', async t => {
  const dir = await fixture(t);
  const {run} = await runtimeFor(t, dir, {verifierRegistry: new Map([['family-a', entry('family-a',
    {verify: async () => ({passed: false, reason: 'fixture rejects'})})]]),
  execute: ticket => execution(ticket, 'answer from ' + ticket.selected_config.model)});
  const done = await run(task(dir, FAMILY_A));
  assert.deepEqual(done.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.equal(done.events.filter(event => event.kind === 'ladder_escalated_to_reference').length, 1);
  assert.equal(done.done.state, 'returned_unverified', done.done.error);
  assert.equal(done.done.error, 'child_quality_disclosed');
  assert.deepEqual(done.done.children[0].quality_disclosure.failed_check_ids, ['node_verifier']);
  assert.equal(done.done.result.output, 'answer from gpt-6-astra');
  const child = done.saved.children[0];
  assert.equal(child.route_kind, 'reference');
  assert.equal(child.node_verifier, 'fail');
  assert.equal(child.attempt_history[1].verifier_id, 'family-a');
  assert.ok(!JSON.stringify(done.events).includes('answer from gpt-6-luna'), 'the rejected descent is never shown');
});

test('T6 a partial verifier is a failure signal only: it never certifies, and it can still escalate a descent once', async t => {
  const dir = await fixture(t);
  // An applying partial that passes everything certifies nothing: the node
  // runs its reference, which the partial then checks as a signal.
  const passing = await runtimeFor(t, dir, {verifierRegistry: new Map([['partial-a', entry('partial-a',
    {soundness: 'partial', verify: async () => ({passed: true})})]]),
  execute: ticket => execution(ticket, 'answer from ' + ticket.selected_config.model)});
  const reference = await passing.run(task(dir, FAMILY_A));
  assert.equal(reference.done.state, 'completed', reference.done.error);
  assert.deepEqual(reference.tuples, ['gpt-6-astra/max']);
  assert.equal(reference.saved.children[0].route_kind, 'reference');
  assert.equal(reference.saved.children[0].ladder ?? null, null);
  assert.equal(reference.saved.children[0].attempt_history[0].verifier, 'pass');
  assert.equal(reference.saved.children[0].attempt_history[0].verifier_id, 'partial-a');
  assert.match(reference.done.children[0].routing_decision.reason, /;admitted_reference_uncertified;/);
  // A contract-admitted descent the contract accepts but a failing partial
  // rejects escalates exactly once to its fixed reference.
  const contractFacts = request => ({owner_scope: 'read_only', chat_lane_eligible: false, request_class: 'readonly_lookup',
    task_contract: {coverage: 'full', scope: 'read_only', objective_sha256: request.request_sha256,
      contract_sha256: sha('contract'), context_sha256: sha(''), start_tree_sha256: sha('tree'),
      reference_policy_sha256: request.policy_sha256, valid_until_ms: Date.now() + 600_000, bindings_checked: true}});
  const contractVerified = (ticket, stateDir) => execution(ticket, 'answer from ' + ticket.selected_config.model, {
    task_verified: true, task_quality: 'task_verified', operational_quality: {schema: 1, coverage: 'full',
      assessment_state: 'task_contract_verified', contract_sha256: sha('contract'),
      witness_path: join(stateDir, 'quality-witnesses', ticket.attempt_id + '.json'), witness_sha256: sha('witness'),
      artifact_sha256: sha(ticket.attempt_id), workspace_after_sha256: sha('tree'), failed_check_ids: [],
      corrective_attempts: 0, local_only_verified: false}});
  const stateName = 'contract-' + randomUUID();
  const contract = await runtimeFor(t, dir, {name: stateName, verifierRegistry: new Map([['partial-b', entry('partial-b',
    {soundness: 'partial', applies: () => true, surfaces: ['agent'],
      verify: async input => ({passed: input.selected_config?.model === 'gpt-6-astra'})})]]),
  catalogOf: value => catalog(value, {facts: contractFacts(value)}),
  execute: ticket => contractVerified(ticket, join(dir, 'state-' + stateName))});
  const escalated = await contract.run(task(dir, PROSE));
  assert.equal(escalated.done.state, 'completed', escalated.done.error);
  assert.deepEqual(escalated.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.equal(escalated.events.filter(event => event.kind === 'ladder_escalated_to_reference').length, 1);
  assert.equal(escalated.saved.children[0].attempt_history[0].state, 'ladder_verifier_failed');
  assert.equal(escalated.done.result.output, 'answer from gpt-6-astra');
  assert.match(escalated.done.children[0].routing_decision.reason, /^tier_escalated_after_verifier_failure;/);
});

test('T7 production registers no node verifier: the plugin options carry none and an omitted registry is empty', async t => {
  const dir = await fixture(t);
  for (const pluginConfig of [null, {bounded_auto: true}]) {
    const options = adaptiveRuntimeOptions({pluginConfig, stateDir: join(dir, 'plugin-state'),
      complete: async () => { throw Error('no model call'); }});
    assert.ok(!Object.hasOwn(options, 'verifierRegistry'), JSON.stringify(Object.keys(options)));
  }
  const {runtime, run} = await runtimeFor(t, dir, {execute: ticket => execution(ticket, 'alpha')});
  assert.ok(runtime.verifierRegistry instanceof Map);
  assert.equal(runtime.verifierRegistry.size, 0);
  const done = await run(task(dir, FAMILY_A));
  assert.deepEqual(done.tuples, ['gpt-6-astra/max'], 'every node runs its reference');
  assert.match(done.done.children[0].routing_decision.reason, /;admitted_reference_uncertified;/);
});

test('T8 a certifier sees only the instruction and the answer: a verdict keyed on the row never certifies', async t => {
  const dir = await fixture(t);
  // Passes every answer that carries a selected configuration: its probes
  // (no configuration) reject, so it registers, and a live certifier gets no
  // configuration either, so it can never accept a descent.
  const inputs = [];
  const rowKeyed = entry('row-keyed', {verify: async input => {
    inputs.push(input); return {passed: input.selected_config !== null, reason: 'fixture row-keyed'}; }});
  const {run} = await runtimeFor(t, dir, {verifierRegistry: new Map([['row-keyed', rowKeyed]]),
    execute: ticket => execution(ticket, 'answer from ' + ticket.selected_config.model)});
  const done = await run(task(dir, FAMILY_A));
  assert.equal(done.done.state, 'completed', done.done.error);
  assert.deepEqual(done.tuples, ['gpt-6-luna/low', 'gpt-6-astra/max']);
  assert.equal(done.done.result.output, 'answer from gpt-6-astra');
  assert.equal(done.saved.children[0].attempt_history[0].state, 'ladder_verifier_failed');
  assert.match(done.done.children[0].routing_decision.reason, /^tier_escalated_after_verifier_failure;/);
  const live = inputs.filter(input => input.task_id !== 'verifier_registration_probe');
  assert.equal(inputs.length - live.length, 2, 'one refutation and one nonce probe');
  assert.deepEqual(live.map(input => [input.selected_config?.model ?? null, input.native_receipt === null]),
    [[null, true], ['gpt-6-astra', false]], 'the certifier gets no row; the escalated reference signal does');
  assert.ok(!JSON.stringify(done.events).includes('answer from gpt-6-luna'), 'the unaccepted descent is never shown');
});
