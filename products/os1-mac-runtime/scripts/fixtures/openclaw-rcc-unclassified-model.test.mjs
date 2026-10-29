// K14: a model the catalog offers that OS-1 cannot classify (no provider-stated
// tier, not a known untiered model) is isolated, never a pool hold. The native
// builder records the informational exclusion `unclassified_model`; it changes
// no route, reference, descent, escalation or hold, cannot explain an empty
// catalog, and marks every model-backed delivery `reference_review_required`
// on the public routing reason (the stored decision and the ledger are
// unchanged). Pure resolver differentials plus real durable-runtime fixtures
// with a fake executor: no provider, model, network or HOME state.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRCCRuntime, hostContextFingerprint, REFERENCE_REVIEW_REASON, referenceReviewReason,
  registerNodeVerifiers, resolveRoutePlan } from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const TOKEN = 'reference_review_required';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-unclassified-fixture-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request) {
  const policyText = 'RCC unclassified-model fixture policy: candidates do not grant authority.';
  const host = {workspace: dir, context: null, provider_preference: 'auto', codex_session_id: null,
    claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000},
    host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, pool, model, effort, options = {}) {
  const now = Date.now();
  const surface = options.surface ?? (pool === 'openai_codex' ? 'codex' : 'claude');
  return {id, surface, transport: surface === 'codex' ? 'codex_app_server' : 'claude_cli',
    account_id: 'account-1', model, effort, tools: ['read', 'execute'],
    scope: 'read_only', permission_profile: 'read_only', quota_pool: pool,
    allowed_paths: [], configuration_sha256: sha('config:' + id),
    availability: options.availability ?? 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 30_000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 30_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
// The provider-stated tiers (Swift ModelTiers). A model with no entry here is
// tier-less on the wire: JS cannot (and need not) tell a known untiered model
// from an unclassified one; only the host builder makes that distinction.
const TIERS = {'gpt-6-astra': 'frontier', 'gpt-6.1-sol': 'workhorse', 'gpt-6-luna': 'fast',
  'claude-fable-5-1': 'frontier', fable: 'frontier', 'claude-opus-5-5': 'workhorse', opus: 'workhorse',
  'claude-sonnet-5-5': 'efficient', sonnet: 'efficient', haiku: 'fast', 'claude-haiku-4-5-20251001': 'fast'};
const CODEX = [['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6.1-sol', ['low', 'medium', 'high', 'xhigh', 'max']], ['gpt-6-luna', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6-sol', ['low', 'medium', 'high', 'xhigh', 'max']]];
const CLAUDE = [['claude-fable-5-1', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['claude-opus-5-5', ['low', 'medium', 'high', 'xhigh', 'max']], ['claude-sonnet-5-5', ['low', 'medium', 'high', 'xhigh', 'max']]];
// A new frontier-looking model OS-1 has not classified, placed FIRST in its
// pool's catalog order (the strongest placement it could get).
const NEW_CODEX = [['gpt-7-astra', ['low', 'max']], ...CODEX];
const key = (model, effort, surface) => `${surface}-${model}-${effort}`.replace(/[^A-Za-z0-9_-]/g, '_');
function poolRows(pool, models) {
  const surface = pool === 'openai_codex' ? 'codex' : 'claude';
  return models.flatMap(([model, efforts]) => efforts.map(effort => row(key(model, effort, surface), pool, model, effort)));
}
function tierCatalog(request, {first = 'codex', codex = CODEX, claude = CLAUDE, exclusions, legacy = false,
                               extra = []} = {}) {
  const codexRows = poolRows('openai_codex', codex), claudeRows = poolRows('anthropic_shared', claude);
  const candidates = [...extra, ...(first === 'codex' ? [...codexRows, ...claudeRows] : [...claudeRows, ...codexRows])];
  const models = new Set(candidates.map(c => c.model));
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, candidates,
    ...(legacy ? {} : {model_tiers: Object.fromEntries(Object.entries(TIERS).filter(([model]) => models.has(model)))}),
    ...(exclusions ? {exclusions} : {})};
}
const UNCLASSIFIED = provider => ({provider, reason: 'unclassified_model', count: 1});
const REFERENCE_UNAVAILABLE = provider => ({provider, reason: 'reference_unavailable', count: 1});
const unbound = id => ({id, instruction: 'Do one bounded task', dependencies: [], kind: 'agent', scope: 'read_only',
  owned_paths: [], context_refs: []});
const plan = (request, nodes, finalNodeID) => ({schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
  nodes, ...(finalNodeID === undefined ? {} : {final_node_id: finalNodeID})});
// A registered sound_full verifier (K4) is the fixture's certifying source.
const CERTIFY = await registerNodeVerifiers(new Map([['fixture-sound', {id: 'fixture-sound', scope: 'read_only',
  surfaces: ['agent', 'chat'], soundness: 'sound_full', applies: () => true,
  verify: async input => ({passed: typeof input.output === 'string' && input.output.startsWith('answer from '),
    reason: 'fixture'}),
  refutations: [{instruction: 'Do one bounded task', output: 'fixture wrong answer'}]}]]));
// Rows are observed 100 ms before they are built; resolve after building.
function resolve(request, catalog, admission = 'reference', now = Date.now()) {
  return resolveRoutePlan(plan(request, [unbound('n')]), request, catalog, now,
    admission === 'certified' ? {verifierRegistry: CERTIFY} : {});
}
const route = decision => `${decision.quota_pool}/${decision.model}/${decision.effort}`;
// The exclusion is informational: the same catalog with and without it
// resolves to the identical plan, routes and decisions (or the same error).
function differential(request, options, exclusions, admission) {
  const others = exclusions.filter(item => item.reason !== 'unclassified_model');
  const plainCatalog = tierCatalog(request, {...options, exclusions: others.length ? others : undefined});
  const flaggedCatalog = tierCatalog(request, {...options, exclusions});
  const now = Date.now();
  const outcome = catalog => {
    try { const value = resolve(request, catalog, admission, now); return {plan: value.plan, routes: value.routes, decisions: value.decisions}; }
    catch (error) { return {error: error.code ?? error.message}; }
  };
  const without = outcome(plainCatalog), withIt = outcome(flaggedCatalog);
  assert.deepEqual(withIt, without, `${admission}: unclassified_model changed the route`);
  return withIt;
}
function execution(ticket) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none',
    output: `answer from ${ticket.selected_config.model}/${ticket.selected_config.effort}`,
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: JSON.stringify({node: ticket.node_id}), native_turn_terminated: true};
}
const taskVerdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
  parity_state: 'unverified', reason: 'fixture_deterministic_coverage'});
async function run(t, dir, name, {catalog, planFor, certified = false}) {
  const request = task(dir, 'Answer one question: ' + name);
  const tickets = [];
  const stateDir = join(dir, name.replace(/\W+/g, '-'));
  const runtime = await createRCCRuntime({stateDir, ...(certified ? {verifierRegistry: CERTIFY} : {}),
    catalog: async value => catalog(value),
    plan: async () => (planFor ? planFor(request) : plan(request, [unbound('n')])),
    execute: async ticket => { tickets.push(ticket); return execution(ticket); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
  return {request, runtime, tickets, done, stateDir,
    tuples: tickets.map(ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`)};
}
const tokens = reason => reason.split(';').filter(segment => segment === TOKEN).length;

test('U1: a new unclassified model beside the frontier changes nothing; it is never the reference or the escalation', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const reference = differential(request, {codex: NEW_CODEX}, [UNCLASSIFIED('codex')], 'reference');
  assert.equal(route(reference.decisions.n), 'openai_codex/gpt-6-astra/max');
  const certified = differential(request, {codex: NEW_CODEX}, [UNCLASSIFIED('codex')], 'certified');
  assert.equal(certified.decisions.n.ladder.reference_model, 'gpt-6-astra');
  assert.notEqual(certified.decisions.n.model, 'gpt-7-astra');
  assert.notEqual(certified.decisions.n.ladder.cheap_model, 'gpt-7-astra');
});

test('U2: a new non-frontier unclassified model never takes a certified descent', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const options = {codex: [...CODEX, ['gpt-6-nova-mini', ['low']]]};
  assert.equal(route(differential(request, options, [UNCLASSIFIED('codex')], 'reference').decisions.n),
    'openai_codex/gpt-6-astra/max');
  const certified = differential(request, options, [UNCLASSIFIED('codex')], 'certified');
  assert.equal(route(certified.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.equal(certified.decisions.n.ladder.reference_model, 'gpt-6-astra');
});

test('U3: an unclassified model in the other pool is isolated there too', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const claude = [['claude-fable-6', ['low', 'max']], ...CLAUDE];
  for (const [first, expected] of [['claude', 'anthropic_shared/claude-fable-5-1/max'], ['codex', 'openai_codex/gpt-6-astra/max']]) {
    for (const admission of ['reference', 'certified']) {
      const resolved = differential(request, {first, claude}, [UNCLASSIFIED('claude')], admission);
      assert.notEqual(resolved.decisions.n.model, 'claude-fable-6', `${first}/${admission}`);
      assert.notEqual(resolved.decisions.n.ladder?.reference_model, 'claude-fable-6', `${first}/${admission}`);
      if (admission === 'reference') assert.equal(route(resolved.decisions.n), expected, first);
    }
  }
});

test('U4: an unconfirmed frontier replacing the old one is still reference_unavailable; the other pool serves', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const codex = NEW_CODEX.filter(([model]) => model !== 'gpt-6-astra');
  for (const admission of ['reference', 'certified']) {
    const resolved = differential(request, {codex}, [REFERENCE_UNAVAILABLE('codex'), UNCLASSIFIED('codex')], admission);
    assert.notEqual(resolved.decisions.n.model, 'gpt-7-astra', admission);
    if (admission === 'reference') {
      assert.equal(route(resolved.decisions.n), 'anthropic_shared/claude-fable-5-1/max');
      assert.match(resolved.decisions.n.reason, /;skipped_pool_rank_0_reference_unavailable;/);
    } else assert.equal(resolved.decisions.n.ladder.reference_model, 'claude-fable-5-1');
  }
});

test('U5: the task runs on the existing reference, never held; every model-backed delivery names reference_review_required', async t => {
  const dir = await fixture(t);
  const flagged = await run(t, dir, 'flagged', {catalog: value =>
    tierCatalog(value, {codex: NEW_CODEX, exclusions: [UNCLASSIFIED('codex')]})});
  assert.equal(flagged.done.state, 'completed', flagged.done.error);
  assert.deepEqual(flagged.tuples, ['gpt-6-astra/max']);
  assert.equal(flagged.done.result.output, 'answer from gpt-6-astra/max');
  for (const child of flagged.done.children) {
    assert.ok(child.selected_config.transport !== 'local');
    assert.equal(tokens(child.routing_decision.reason), 1, child.routing_decision.reason);
    assert.ok(child.routing_decision.reason.endsWith(';' + TOKEN));
  }
  // Only the public projection changes: the stored decision is unchanged and
  // the persisted public events carry the same token.
  const stored = flagged.runtime._load(flagged.request.task_id).children[0].routing_decision;
  assert.equal(tokens(stored.reason), 0);
  assert.equal(flagged.done.children[0].routing_decision.reason, stored.reason + ';' + TOKEN);
  const completedEvent = flagged.runtime.events({schema: 1, task_id: flagged.request.task_id})
    .filter(event => event.kind === 'task_completed').at(-1);
  assert.equal(tokens(completedEvent.snapshot.children[0].routing_decision.reason), 1);
  const ledger = (await readFile(join(flagged.stateDir, 'routing-ledger', 'routing-ledger.jsonl'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  assert.ok(ledger.length > 0 && !JSON.stringify(ledger).includes(TOKEN), 'the ledger is unchanged');
  // The same run without the exclusion carries no token.
  const plain = await run(t, dir, 'plain', {catalog: value => tierCatalog(value, {codex: NEW_CODEX})});
  assert.equal(plain.done.state, 'completed', plain.done.error);
  assert.deepEqual(plain.tuples, ['gpt-6-astra/max']);
  assert.equal(tokens(plain.done.children[0].routing_decision.reason), 0);
  assert.equal(plain.done.children[0].routing_decision.reason, stored.reason);
  // A certified descent and its escalation reference are classified models;
  // its delivery is marked the same way.
  const certified = await run(t, dir, 'certified', {certified: true, catalog: value =>
    tierCatalog(value, {codex: NEW_CODEX, exclusions: [UNCLASSIFIED('codex')]})});
  assert.equal(certified.done.state, 'completed', certified.done.error);
  assert.deepEqual(certified.tuples, ['gpt-6-luna/low']);
  assert.equal(certified.done.children[0].routing_decision.ladder.reference_model, 'gpt-6-astra');
  assert.equal(tokens(certified.done.children[0].routing_decision.reason), 1);
});

test('U6: noDispatchableReason never reads the exclusion as reference absence', async t => {
  const dir = await fixture(t);
  const only = {codex: [['gpt-7-astra', ['low', 'max']]], claude: []};
  const held = await run(t, dir, 'only new', {catalog: value => tierCatalog(value, {...only, exclusions: [UNCLASSIFIED('codex')]})});
  const baseline = await run(t, dir, 'only new baseline', {catalog: value => tierCatalog(value, only)});
  assert.equal(held.done.state, 'held');
  assert.equal(baseline.done.state, 'held');
  assert.equal(held.done.error, baseline.done.error);
  assert.equal(held.done.error, 'no_dispatchable_candidate:openai_codex=no_reference');
  assert.equal(held.tickets.length, 0);
  assert.equal(baseline.tickets.length, 0);
  // The Codex frontier is gone, Claude's is not: completes on Claude.
  const other = await run(t, dir, 'other pool', {catalog: value => tierCatalog(value, {
    codex: NEW_CODEX.filter(([model]) => model !== 'gpt-6-astra'),
    exclusions: [REFERENCE_UNAVAILABLE('codex'), UNCLASSIFIED('codex')]})});
  assert.equal(other.done.state, 'completed', other.done.error);
  assert.deepEqual(other.tuples, ['claude-fable-5-1/max']);
  assert.equal(tokens(other.done.children[0].routing_decision.reason), 1);
});

test('U7: the exclusion never explains an empty catalog and needs a tiered catalog offering a tier-less row', async t => {
  const dir = await fixture(t);
  const cases = [
    ['alone on an empty catalog', value => ({...tierCatalog(value, {codex: [], claude: []}), exclusions: [UNCLASSIFIED('codex')]}),
      'catalog_binding_invalid'],
    ['beside a real reason on an empty catalog', value => ({...tierCatalog(value, {codex: [], claude: []}),
      exclusions: [{provider: 'codex', reason: 'quota_zero', count: 1}, UNCLASSIFIED('codex')]}), 'catalog_binding_invalid'],
    ['legacy catalog without model_tiers', value => tierCatalog(value, {codex: NEW_CODEX, legacy: true,
      exclusions: [UNCLASSIFIED('codex')]}), 'catalog_binding_invalid'],
    ['provider whose rows are all tiered', value => tierCatalog(value, {codex: NEW_CODEX,
      exclusions: [UNCLASSIFIED('claude')]}), 'catalog_binding_invalid'],
    ['provider with no rows', value => tierCatalog(value, {codex: NEW_CODEX, claude: [],
      exclusions: [UNCLASSIFIED('codex'), UNCLASSIFIED('claude')]}), 'catalog_binding_invalid'],
    ['a real reason still explains an empty catalog', value => ({...tierCatalog(value, {codex: [], claude: []}),
      exclusions: [{provider: 'codex', reason: 'quota_zero', count: 1}]}), 'no_routable_candidate:quota_zero']];
  for (const [name, catalog, expected] of cases) {
    const held = await run(t, dir, name, {catalog});
    assert.equal(held.done.state, 'held', name);
    assert.equal(held.done.error, expected, name);
    assert.equal(held.tickets.length, 0, name);
  }
});

test('U8: a legacy catalog keeps its reference route and carries no token', async t => {
  const dir = await fixture(t);
  const request = task(dir, 'Answer one bounded question');
  const legacy = tierCatalog(request, {legacy: true});
  assert.equal(route(resolve(request, legacy).decisions.n), 'openai_codex/gpt-6-astra/max');
  const legacyRun = await run(t, dir, 'legacy', {catalog: value => tierCatalog(value, {legacy: true})});
  assert.equal(legacyRun.done.state, 'completed', legacyRun.done.error);
  assert.deepEqual(legacyRun.tuples, ['gpt-6-astra/max']);
  assert.equal(tokens(legacyRun.done.children[0].routing_decision.reason), 0);
});

test('U9: the token is bounded, idempotent and survives truncation; a local deterministic child never carries it', async t => {
  assert.equal(REFERENCE_REVIEW_REASON, TOKEN);
  assert.equal(referenceReviewReason('resolver;route_reference;pool_rank_0'), 'resolver;route_reference;pool_rank_0;' + TOKEN);
  const once = referenceReviewReason('resolver;route_reference');
  assert.equal(referenceReviewReason(once), once, 'idempotent');
  assert.equal(referenceReviewReason('resolver;' + TOKEN + 'X'), 'resolver;' + TOKEN + 'X;' + TOKEN,
    'only the exact segment counts');
  // A ~1015-byte diagnostic reason: trailing segments are dropped, never the token.
  const long = ['resolver', 'route_reference', ...Array.from({length: 70}, (_, i) => `diag_${String(i).padStart(10, '0')}`)]
    .join(';').slice(0, 1015);
  assert.ok(Buffer.byteLength(long) >= 1010 && Buffer.byteLength(long) <= 1024);
  const bounded = referenceReviewReason(long);
  assert.ok(Buffer.byteLength(bounded) <= 1024, String(Buffer.byteLength(bounded)));
  assert.ok(bounded.endsWith(';' + TOKEN));
  assert.ok(bounded.startsWith('resolver;route_reference;diag_'));
  assert.equal(tokens(bounded), 1);
  assert.equal(referenceReviewReason(bounded), bounded);
  // The instruction-lock tail is a diagnostic segment like any other (D8: the
  // review token always survives the 1 KiB bound).
  const locked = long.slice(0, 1024 - ';instruction_host_locked'.length) + ';instruction_host_locked';
  assert.ok(referenceReviewReason(locked).endsWith(';' + TOKEN));
  assert.ok(Buffer.byteLength(referenceReviewReason(locked)) <= 1024);
  // One oversized segment keeps its longest prefix that fits.
  const single = referenceReviewReason('x'.repeat(1024));
  assert.equal(Buffer.byteLength(single), 1024);
  assert.ok(single.endsWith('x;' + TOKEN));
  assert.equal(referenceReviewReason(''), TOKEN);
  // A deterministic node binds the local exact row: no model, no token.
  const dir = await fixture(t);
  const exact = {...row('local-exact', 'none', 'local-deterministic', 'none', {surface: 'local'}),
    transport: 'local', tools: [], quota_remaining_fraction: null, quota_observed_at_ms: null, quota_valid_until_ms: null,
    estimated_cost_units: 0};
  const mixed = await run(t, dir, 'deterministic', {
    catalog: value => tierCatalog(value, {codex: NEW_CODEX, exclusions: [UNCLASSIFIED('codex')], extra: [exact]}),
    planFor: request => plan(request, [{...unbound('d'), kind: 'deterministic', instruction: '2+3'},
      {...unbound('a'), dependencies: ['d']}], 'a')});
  assert.equal(mixed.done.state, 'completed', mixed.done.error);
  const byID = Object.fromEntries(mixed.done.children.map(child => [child.id, child]));
  assert.equal(byID.d.selected_config.transport, 'local');
  assert.equal(tokens(byID.d.routing_decision.reason), 0, byID.d.routing_decision.reason);
  assert.equal(byID.a.selected_config.model, 'gpt-6-astra');
  assert.equal(tokens(byID.a.routing_decision.reason), 1, byID.a.routing_decision.reason);
});
