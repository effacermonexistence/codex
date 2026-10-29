// K10 (§2.4): a frozen check-acceptance cost policy re-ranks a certified
// descent INSIDE F, the escalation reference fixed at bind plus the R11
// pool's dispatchable certified rows, for a contract or verifier admission.
// Every member of F is already admitted and answer-checked (I2), so the
// policy can only move a node between those rows or onto the reference; it is
// inert when absent, invalid, expired or not covering all of F, and nothing in
// production registers one. Pure selector checks, pure resolver checks and real
// durable-runtime fixtures with a fake executor: synthetic policies only, no
// provider, model, network or HOME state.
import './local-model-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { admitBoundedAutoPlan, createRCCRuntime, hostContextFingerprint, registerNodeVerifiers, resolveRoutePlan }
  from '../../Resources/openclaw-os1-bridge/rcc-runtime.mjs';
import { compileFreshPlannerProposal, createPlannerHostProjection }
  from '../../Resources/openclaw-os1-bridge/adaptive-plan-host.mjs';
import { CHECK_ACCEPTANCE_SCORE_SPACE, digest, isPreparedCertifiedDescentPolicy, prepareCertifiedDescentPolicy,
  RESOURCE_COMPONENTS, RESOURCE_UNIT, SCORE_SPACE, selectCertifiedDescent }
  from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'os1-rcc-descent-policy-'));
  await chmod(dir, 0o700);
  t.after(async () => { await rm(dir, {recursive: true, force: true}); });
  return dir;
}
function task(dir, request, extras = {}) {
  const policyText = 'RCC descent policy fixture: candidates do not grant authority.';
  const host = {workspace: dir, context: null, provider_preference: extras.provider ?? 'auto',
    codex_session_id: extras.codexSession ?? null, claude_session_id: null, require_read_only: true, owner_policy: null};
  return {schema: 1, task_id: 'task-' + randomUUID(), request, request_sha256: sha(request), objective: request,
    policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
    budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60_000}, host_context: host,
    policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText}};
}
function row(id, pool, model, effort, options = {}) {
  // Observed well before any `now` a test captured before building its
  // catalog (a slow, parallel run must not make the rows future-dated).
  const now = Date.now() - 9_900;
  const surface = options.surface ?? (pool === 'openai_codex' ? 'codex' : 'claude');
  return {id, surface, transport: surface === 'codex' ? 'codex_app_server' : 'claude_cli',
    account_id: 'account-1', model, effort, tools: surface.endsWith('-chat') ? [] : ['read', 'execute'],
    scope: 'read_only', permission_profile: 'read_only', quota_pool: pool, allowed_paths: [],
    configuration_sha256: sha('config:' + id), availability: options.availability ?? 'available',
    availability_observed_at_ms: now - 100, availability_valid_until_ms: now + 60_000,
    quota_remaining_fraction: 0.7, quota_observed_at_ms: now - 100, quota_valid_until_ms: now + 60_000,
    quality_state: 'policy_admitted', estimated_cost_units: 1};
}
const TIERS = {'gpt-6-astra': 'frontier', 'gpt-6.1-sol': 'workhorse', 'gpt-6-luna': 'fast',
  'claude-fable-5-1': 'frontier', fable: 'frontier', 'claude-opus-5-5': 'workhorse', opus: 'workhorse',
  'claude-sonnet-5-5': 'efficient', sonnet: 'efficient', 'claude-haiku-4-5-20251001': 'fast'};
const CODEX = [['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6.1-sol', ['low', 'medium', 'high', 'xhigh', 'max']], ['gpt-6-luna', ['low', 'medium', 'high', 'xhigh', 'max']],
  ['gpt-6-sol', ['low', 'medium', 'high', 'xhigh', 'max']], ['gpt-daybreak-blue-latest', ['low', 'max']]];
const CLAUDE = [['claude-fable-5-1', ['low', 'medium', 'high', 'xhigh', 'max']], ['fable', ['low', 'xhigh', 'max']],
  ['claude-opus-5-5', ['low', 'medium', 'high', 'xhigh', 'max']], ['opus', ['xhigh', 'max']],
  ['claude-sonnet-5-5', ['low', 'medium', 'high', 'xhigh', 'max']], ['sonnet', ['medium']],
  ['claude-haiku-4-5-20251001', ['none']]];
const key = (model, effort, surface) => `${surface}-${model}-${effort}`.replace(/[^A-Za-z0-9_-]/g, '_');
function poolRows(pool, models, {chat = false, change = () => ({})} = {}) {
  const rows = [];
  for (const [model, efforts] of models) for (const effort of efforts)
    for (const surface of pool === 'anthropic_shared' && chat ? ['claude-chat', 'claude'] :
      [pool === 'openai_codex' ? 'codex' : 'claude'])
      rows.push(row(key(model, effort, surface), pool, model, effort, {surface, ...change(model, effort, surface)}));
  return rows;
}
function tierCatalog(request, {first = 'codex', chat = false, codex = CODEX, claude = CLAUDE, change, extra = {}} = {}) {
  const codexRows = poolRows('openai_codex', codex, {change});
  const claudeRows = poolRows('anthropic_shared', claude, {chat, change});
  const candidates = first === 'codex' ? [...codexRows, ...claudeRows] : [...claudeRows, ...codexRows];
  const models = new Set(candidates.map(c => c.model));
  return {schema: 1, task_id: request.task_id, request_sha256: request.request_sha256, candidates,
    model_tiers: Object.fromEntries(Object.entries(TIERS).filter(([model]) => models.has(model))), ...extra};
}
const unbound = (id, instruction = 'Do one bounded task') => ({id, instruction, dependencies: [], kind: 'agent',
  scope: 'read_only', owned_paths: [], context_refs: []});
const plan = (request, nodes, finalNodeID) => ({schema: 1, task_id: request.task_id, request_sha256: request.request_sha256,
  nodes, ...(finalNodeID === undefined ? {} : {final_node_id: finalNodeID})});
const passes = async input => ({passed: typeof input.output === 'string' && input.output.startsWith('answer from '),
  reason: 'fixture'});
const CERTIFY = await registerNodeVerifiers(new Map([['fixture-sound', {id: 'fixture-sound', scope: 'read_only',
  surfaces: ['agent', 'chat'], soundness: 'sound_full', applies: () => true, verify: passes,
  refutations: [{instruction: 'Do one bounded task', output: 'fixture wrong answer'}]}]]));
function execution(ticket, overrides = {}) {
  return {schema: 1, task_id: ticket.task_id, node_id: ticket.node_id, attempt_id: ticket.attempt_id,
    candidate_id: ticket.candidate_id, configuration_sha256: ticket.configuration_sha256,
    selected_config: ticket.selected_config, acknowledged_config: ticket.selected_config, observed_config: null,
    status: 'succeeded', dispatch_stage: 'dispatched', side_effects: 'none',
    output: `answer from ${ticket.selected_config.model}/${ticket.selected_config.effort}`,
    execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
    native_receipt: '/private/fixture/receipt-' + ticket.attempt_id, usage: {input_tokens: 4, output_tokens: 2},
    native_summary: JSON.stringify({node: ticket.node_id}), native_turn_terminated: true, ...overrides};
}
const taskVerdict = ({task: value, children}) => ({schema: 1, task_id: value.task_id,
  task_verified: children.every(c => c.state === 'completed'), output: children.map(c => c.output).join('\n'),
  parity_state: 'unverified', reason: 'fixture_deterministic_coverage'});
const route = decision => `${decision.quota_pool}/${decision.model}/${decision.effort}`;

// ---- Synthetic frozen policies ----------------------------------------------
const tuple = (model, effort, pool = 'openai_codex', surface = pool === 'openai_codex' ? 'codex' : 'claude') =>
  ({surface, quota_pool: pool, model, effort});
const ASTRA = tuple('gpt-6-astra', 'max'), LUNA = tuple('gpt-6-luna', 'low'), SOL = tuple('gpt-6.1-sol', 'low');
const ASTRA_LOW = tuple('gpt-6-astra', 'low');
const FABLE = tuple('claude-fable-5-1', 'max', 'anthropic_shared'), HAIKU = tuple('claude-haiku-4-5-20251001', 'none',
  'anthropic_shared'), SONNET = tuple('claude-sonnet-5-5', 'low', 'anthropic_shared'),
  OPUS = tuple('claude-opus-5-5', 'low', 'anthropic_shared');
const ZERO = Object.freeze(Object.fromEntries(RESOURCE_COMPONENTS.map(k => [k, 0])));
const VERIFIER_STRATUM = {request_class: null, scope: 'read_only', admitted_by: 'verifier', check_id: 'fixture-sound',
  turn: 'first', has_materials: false, context_bucket: 0};
// A reference row costs `attempt`; a descent row costs `attempt` plus its
// check `check` (verification_tokens_per_sample), with p_lower `p`.
function prow(t, {role = 'descent', p = null, attempt, check = role === 'descent' ? 10 : 0, stratum = {}} = {}) {
  return {...VERIFIER_STRATUM, ...stratum, ...t, role, p_lower: role === 'reference' ? null : p, basis_sample_count: 60,
    basis_artifact_sha256: sha('basis'), components: {...ZERO, input_tokens_per_sample: attempt,
      verification_tokens_per_sample: check}};
}
const ref = (t, attempt = 1000, stratum = {}) => prow(t, {role: 'reference', attempt, stratum});
function body(rows, {from = Date.now() - 60_000, until = Date.now() + 600_000, bounds = [1_000_000], ...rest} = {}) {
  return {schema: 1, score_space: CHECK_ACCEPTANCE_SCORE_SPACE, label_score_space: 'check_acceptance_v1',
    id: 'fixture-descent-policy', version: '1', resource_unit: RESOURCE_UNIT, valid_from_ms: from, valid_until_ms: until,
    context_bucket_rule: 'instruction_plus_context_utf8_bytes_v1', context_bucket_upper_bytes: bounds, rows, ...rest};
}
const sealed = value => ({...value, policy_sha256: digest(value)});
const policy = (rows, options) => sealed(body(rows, options));
// Codex F of the default catalog: astra/max reference, luna/low (TIER_ROUTES
// entry 0) and gpt-6.1-sol/low (entry 2); no efficient Codex model.
const solWins = () => policy([ref(ASTRA), prow(LUNA, {p: 0.1, attempt: 100}), prow(SOL, {p: 0.99, attempt: 300})]);
const referenceWins = () => policy([ref(ASTRA), prow(LUNA, {p: 0.05, attempt: 100}), prow(SOL, {p: 0.05, attempt: 300})]);
function resolve(request, catalog, options = {}, nodes = [unbound('n')]) {
  return resolveRoutePlan(plan(request, nodes), request, catalog, options.now ?? Date.now(),
    {verifierRegistry: 'verifierRegistry' in options ? options.verifierRegistry : CERTIFY,
      ...('descentPolicy' in options ? {descentPolicy: options.descentPolicy} : {})});
}
const token = value => 'descent_cost_policy_' + value.policy_sha256.slice(0, 12);

// ---- Pure: prepareCertifiedDescentPolicy ------------------------------------

test('an invalid policy is inactive with a specific reason; a valid one is a branded, frozen, decoupled value', () => {
  const valid = solWins();
  const prepared = prepareCertifiedDescentPolicy(valid);
  assert.equal(prepared.status, 'active');
  assert.equal(prepared.sha256, valid.policy_sha256);
  assert.ok(Object.isFrozen(prepared) && Object.isFrozen(prepared.bounds));
  assert.equal(isPreparedCertifiedDescentPolicy(prepared), true);
  const rehash = change => { const {policy_sha256: _, ...rest} = valid; return sealed(change(structuredClone(rest))); };
  const cases = [
    ['null', null, 'policy_missing_or_not_plain'],
    ['array', [], 'policy_missing_or_not_plain'],
    ['extra key', {...valid, extra: 1}, 'policy_shape_invalid'],
    ['reference_match score space', rehash(b => ({...b, score_space: SCORE_SPACE})), 'policy_score_space_invalid'],
    ['row changed after hashing', {...valid, rows: valid.rows.map((r, i) => i === 1 ? {...r, p_lower: 0.2} : r)},
      'policy_hash_mismatch'],
    ['NaN component', {...valid, rows: valid.rows.map((r, i) => i === 1 ?
      {...r, components: {...r.components, input_tokens_per_sample: NaN}} : r)}, 'policy_not_plain_finite_json'],
    ['undefined id', {...valid, id: undefined}, 'policy_not_plain_finite_json'],
    ['duplicate stratum and tuple', rehash(b => ({...b, rows: [...b.rows, b.rows[1]]})), 'policy_duplicate_row'],
    ['retry reserve supplied', rehash(b => { b.rows[1].components.retry_reserve_tokens = 1; return b; }),
      'policy_row_retry_reserve_nonzero'],
    ['reference row with p_lower', rehash(b => { b.rows[0].p_lower = 0.5; return b; }), 'policy_reference_row_invalid'],
    ['reference row with a check cost', rehash(b => { b.rows[0].components.verification_tokens_per_sample = 5; return b; }),
      'policy_reference_row_invalid'],
    ['descent p above 1', rehash(b => { b.rows[1].p_lower = 1.5; return b; }), 'policy_descent_row_invalid'],
    ['descent p below 0', rehash(b => { b.rows[1].p_lower = -0.1; return b; }), 'policy_descent_row_invalid'],
    ['descent without p', rehash(b => { b.rows[1].p_lower = null; return b; }), 'policy_descent_row_invalid'],
    ['negative component', rehash(b => { b.rows[1].components.output_tokens_per_sample = -1; return b; }),
      'policy_row_invalid'],
    ['unknown admitting source', rehash(b => { b.rows[1].admitted_by = 'class'; return b; }), 'policy_row_invalid'],
    ['bucket beyond the bounds', rehash(b => { b.rows[1].context_bucket = 2; return b; }), 'policy_row_invalid'],
    ['equal bucket bounds', rehash(b => ({...b, context_bucket_upper_bytes: [10, 10]})), 'policy_context_buckets_invalid'],
    ['descending bucket bounds', rehash(b => ({...b, context_bucket_upper_bytes: [20, 10]})),
      'policy_context_buckets_invalid'],
    ['empty window', rehash(b => ({...b, valid_until_ms: b.valid_from_ms})), 'policy_window_invalid'],
    ['other label space', rehash(b => ({...b, label_score_space: 'reference_match_v1'})), 'policy_header_invalid'],
    ['no rows', rehash(b => ({...b, rows: []})), 'policy_rows_count_invalid'],
  ];
  for (const [name, value, reason] of cases) {
    const result = prepareCertifiedDescentPolicy(value);
    assert.deepEqual(result, {status: 'inactive', reason}, name);
    assert.equal(isPreparedCertifiedDescentPolicy(result), false, name);
  }
  // The largest admissible policy can still be hashed; one row more cannot be admitted.
  const many = n => policy(Array.from({length: n}, (_, i) => prow(tuple('m' + i, 'low'), {p: 0.5, attempt: 1})));
  assert.equal(prepareCertifiedDescentPolicy(many(2048)).status, 'active');
  assert.deepEqual(prepareCertifiedDescentPolicy(many(2049)), {status: 'inactive', reason: 'policy_rows_count_invalid'});
  // Neither a plain or JSON copy nor a later change to the caller's value ranks anything.
  const input = {now_ms: Date.now(), stratum: {...VERIFIER_STRATUM, context_bytes: 10}, reference: {candidate_id: 'r', ...ASTRA},
    descents: [{candidate_id: 'l', ...LUNA}, {candidate_id: 's', ...SOL}]};
  for (const copy of [{...prepared}, JSON.parse(JSON.stringify(prepared))]) {
    assert.equal(isPreparedCertifiedDescentPolicy(copy), false);
    assert.equal(selectCertifiedDescent({...input, policy: copy}).decision, 'inactive');
    assert.equal(selectCertifiedDescent({...input, policy: copy}).reason, 'policy_not_prepared');
  }
  assert.equal(selectCertifiedDescent({...input, policy: prepared}).candidate_id, 's');
  valid.rows[2].p_lower = 0; valid.rows[1].p_lower = 1;
  assert.equal(selectCertifiedDescent({...input, policy: prepared}).candidate_id, 's', 'the prepared copy is decoupled');
  assert.equal(selectCertifiedDescent({...input, policy: prepareCertifiedDescentPolicy(null)}).reason,
    'policy_missing_or_not_plain');
});

// ---- Pure: selectCertifiedDescent -------------------------------------------

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function pick(rows, {now = Date.now(), stratum = {}, bytes = 10, reference = ASTRA, descents = [LUNA], options} = {}) {
  const prepared = prepareCertifiedDescentPolicy(policy(rows, options));
  assert.equal(prepared.status, 'active', prepared.reason);
  return selectCertifiedDescent({now_ms: now, policy: prepared,
    stratum: {...VERIFIER_STRATUM, ...stratum, context_bucket: undefined, context_bytes: bytes},
    reference: {candidate_id: 'ref', ...reference},
    descents: descents.map((t, i) => ({candidate_id: 'd' + i, ...t}))});
}

test('the expected total is c_attempt + c_check + (1 - p_lower) * c_ref; the reference wins a tie', () => {
  // c_ref 1000; descent: 100 attempt + 10 check = 110.
  const cheap = pick([ref(ASTRA), prow(LUNA, {p: 0.95, attempt: 100})]);
  assert.equal(cheap.decision, 'descent');
  assert.equal(cheap.reason, 'lowest_expected_total_after_check');
  assert.equal(cheap.candidate_id, 'd0');
  assert.equal(cheap.score_space, CHECK_ACCEPTANCE_SCORE_SPACE);
  assert.equal(cheap.execution_authorized, false);
  assert.equal(cheap.quality_certificate, false);
  assert.equal(cheap.totals[0].total, 1000);
  near(cheap.totals[1].total, 160);
  near(cheap.totals[1].components.retry_reserve_tokens, 0.05 * 1000);
  assert.equal(cheap.totals[1].components.verification_tokens_per_sample, 10);
  assert.equal(cheap.totals[0].components.retry_reserve_tokens, 0);
  // A low acceptance bound makes the escalation reserve dominate.
  const costly = pick([ref(ASTRA), prow(LUNA, {p: 0.05, attempt: 100})]);
  assert.equal(costly.decision, 'reference');
  assert.equal(costly.reason, 'certified_descent_not_cost_effective');
  assert.equal(costly.candidate_id, 'ref');
  near(costly.totals[1].total, 1060);
  // Exact tie: 490 + 10 + 0.5 * 1000 = 1000 = c_ref.
  const tie = pick([ref(ASTRA), prow(LUNA, {p: 0.5, attempt: 490})]);
  assert.equal(tie.totals[1].total, 1000);
  assert.equal(tie.decision, 'reference');
  // Two equal descents: input (TIER_ROUTES, then catalog) order.
  const equal = pick([ref(ASTRA), prow(LUNA, {p: 0.5, attempt: 90}), prow(SOL, {p: 0.5, attempt: 90})],
    {descents: [SOL, LUNA]});
  assert.equal(equal.candidate_id, 'd0');
  // The lower total among several descents wins.
  const best = pick([ref(ASTRA), prow(LUNA, {p: 0.1, attempt: 100}), prow(SOL, {p: 0.99, attempt: 300})],
    {descents: [LUNA, SOL]});
  assert.equal(best.candidate_id, 'd1');
  near(best.totals[2].total, 320);
});

test('every member of F must be covered in its stratum and window; uncovered rows never cost zero', () => {
  const rows = [ref(ASTRA), prow(LUNA, {p: 0.99, attempt: 100}), prow(SOL, {p: 0.99, attempt: 300})];
  assert.equal(pick(rows, {descents: [LUNA, SOL]}).decision, 'descent');
  // The reference or one descent missing: inactive, never "cheapest by absence".
  assert.equal(pick(rows.slice(1), {descents: [LUNA, SOL]}).reason, 'policy_reference_uncovered');
  assert.equal(pick(rows.slice(0, 2), {descents: [LUNA, SOL]}).reason, 'policy_descent_uncovered');
  // A row of the wrong role does not cover.
  assert.equal(pick([prow(ASTRA, {p: 1, attempt: 0}), rows[1]]).reason, 'policy_reference_uncovered');
  assert.equal(pick([rows[0], ref(LUNA, 0)]).reason, 'policy_descent_uncovered');
  // Another stratum does not cover this one.
  for (const stratum of [{turn: 'not_first'}, {has_materials: true}, {check_id: 'other-verifier'},
    {admitted_by: 'contract', check_id: null}, {request_class: 'readonly_lookup'}])
    assert.equal(pick(rows, {stratum}).decision, 'inactive', JSON.stringify(stratum));
  // Context buckets: upper bounds are inclusive.
  const bucketed = [ref(ASTRA), prow(LUNA, {p: 0.99, attempt: 100}),
    ref(ASTRA, 1000, {context_bucket: 1}), prow(LUNA, {p: 0.01, attempt: 100, stratum: {context_bucket: 1}})];
  assert.equal(pick(bucketed, {bytes: 20, options: {bounds: [20]}}).decision, 'descent');
  assert.equal(pick(bucketed, {bytes: 20, options: {bounds: [20]}}).context_bucket, 0);
  assert.equal(pick(bucketed, {bytes: 21, options: {bounds: [20]}}).decision, 'reference');
  // The window is [valid_from_ms, valid_until_ms).
  const from = 1_000_000, until = 2_000_000;
  for (const [now, decision] of [[from - 1, 'inactive'], [from, 'descent'], [until - 1, 'descent'],
    [until, 'inactive'], [until + 1, 'inactive']]) {
    const result = pick(rows, {now, options: {from, until}});
    assert.equal(result.decision, decision, String(now));
    if (decision === 'inactive') assert.equal(result.reason, 'policy_outside_validity_window');
  }
  // A cheaper row for a tuple outside the input is never returned.
  const outside = pick([...rows, prow(ASTRA_LOW, {p: 1, attempt: 0}), prow(OPUS, {p: 1, attempt: 0})],
    {descents: [LUNA, SOL]});
  assert.ok(['ref', 'd0', 'd1'].includes(outside.candidate_id));
  // Malformed F or stratum: inactive.
  const prepared = prepareCertifiedDescentPolicy(policy(rows));
  const base = {now_ms: Date.now(), policy: prepared, stratum: {...VERIFIER_STRATUM, context_bytes: 1},
    reference: {candidate_id: 'ref', ...ASTRA}, descents: [{candidate_id: 'd0', ...LUNA}]};
  assert.equal(selectCertifiedDescent({...base, descents: []}).reason, 'certified_set_invalid');
  assert.equal(selectCertifiedDescent({...base, descents: [{candidate_id: 'ref', ...LUNA}]}).reason, 'certified_set_invalid');
  assert.equal(selectCertifiedDescent({...base, stratum: {...base.stratum, admitted_by: 'exact'}}).reason, 'stratum_invalid');
  assert.equal(selectCertifiedDescent({...base, stratum: {...base.stratum, context_bytes: -1}}).reason, 'stratum_invalid');
  assert.equal(selectCertifiedDescent().reason, 'policy_not_prepared');
  // Deterministic, and the input is never mutated.
  const input = {...base, descents: [{candidate_id: 'd0', ...LUNA}, {candidate_id: 'd1', ...SOL}]};
  const before = JSON.stringify(input);
  assert.deepEqual(selectCertifiedDescent(input), selectCertifiedDescent(input));
  assert.equal(JSON.stringify(input), before);
});

// ---- Resolver: inert without an active covering policy ----------------------

test('no policy, null, undefined, a raw or inactive policy, an expired or uncovering one all bind today\'s row', () => {
  const now = Date.now();
  const raw = solWins();
  const inactive = [
    ['hash mismatch', prepareCertifiedDescentPolicy({...raw, rows: raw.rows.map((r, i) => i === 2 ? {...r, p_lower: 1} : r)})],
    ['expired', prepareCertifiedDescentPolicy(policy(raw.rows, {from: now - 10_000, until: now - 1}))],
    ['not yet valid', prepareCertifiedDescentPolicy(policy(raw.rows, {from: now + 10_000, until: now + 20_000}))],
    ['uncovering', prepareCertifiedDescentPolicy(policy(raw.rows.slice(0, 2)))],
    ['raw unprepared', raw],
  ];
  assert.equal(inactive[1][1].status, 'active');
  for (const [name, options] of [['codex first', {}], ['claude first', {first: 'claude'}],
    ['claude chat lane', {first: 'claude', chat: true}]]) {
    const request = task('/tmp', 'Answer one bounded question');
    const catalog = tierCatalog(request, options);
    const baseline = resolve(request, catalog, {now});
    assert.equal(baseline.routes.n.kind, 'tier', name);
    for (const [label, descentPolicy] of [['null', null], ['undefined', undefined], ...inactive])
      assert.deepEqual(resolve(request, catalog, {now, descentPolicy}), baseline, `${name}: ${label}`);
  }
});

test('a policy picks the lowest expected total in F: workhorse/low over a weakly accepted fast/low', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const catalog = tierCatalog(request);
  const raw = solWins();
  const resolved = resolve(request, catalog, {descentPolicy: prepareCertifiedDescentPolicy(raw)});
  const decision = resolved.decisions.n;
  assert.equal(route(decision), 'openai_codex/gpt-6.1-sol/low');
  assert.equal(decision.route_class, 'trivial');
  assert.equal(decision.tier, 'workhorse');
  assert.equal(resolved.routes.n.kind, 'tier');
  const ladder = resolved.routes.n.ladder;
  assert.equal(ladder.reference_candidate_id, key('gpt-6-astra', 'max', 'codex'));
  assert.equal(ladder.descent_policy_sha256, raw.policy_sha256);
  assert.equal(ladder.admitted_by, 'verifier');
  assert.equal(ladder.certificate_id, 'fixture-sound');
  assert.deepEqual([ladder.cheap_model, ladder.cheap_effort], ['gpt-6.1-sol', 'low']);
  assert.ok(decision.reason.startsWith(`resolver;route_tier;admitted_certified_verifier;${token(raw)};tier_list_2;tier_workhorse;`),
    decision.reason);
  assert.ok(decision.reason.includes(';tier_list_2;tier_workhorse;'));
  assert.ok(Buffer.byteLength(decision.reason) <= 1024);
  // The wire ladder keeps its four fields; the policy hash stays internal.
  assert.deepEqual(decision.ladder, {cheap_effort: 'low', reference_effort: 'max', cheap_model: 'gpt-6.1-sol',
    reference_model: 'gpt-6-astra'});
  // A policy that confirms today's row still names itself.
  const confirms = policy([ref(ASTRA), prow(LUNA, {p: 0.99, attempt: 100}), prow(SOL, {p: 0.99, attempt: 300})]);
  const same = resolve(request, catalog, {descentPolicy: prepareCertifiedDescentPolicy(confirms)});
  assert.equal(route(same.decisions.n), 'openai_codex/gpt-6-luna/low');
  assert.ok(same.decisions.n.reason.includes(`;${token(confirms)};tier_list_0;tier_fast;`));
});

test('when no descent is cheaper than the reference after its check, the node binds the reference', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const raw = referenceWins();
  const resolved = resolve(request, tierCatalog(request), {descentPolicy: prepareCertifiedDescentPolicy(raw)});
  const decision = resolved.decisions.n;
  assert.equal(route(decision), 'openai_codex/gpt-6-astra/max');
  assert.equal(decision.route_class, 'deep');
  assert.equal(decision.ladder, undefined);
  assert.deepEqual(resolved.routes.n, {kind: 'reference', reference_effort: 'max', ladder: null});
  assert.ok(decision.reason.includes(`admitted_certified_verifier;certified_descent_not_cost_effective;${token(raw)};`),
    decision.reason);
});

test('F membership: the pick is always the reference or a dispatchable certified row of the R11 pool', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const tiered = new Set(['fast', 'efficient', 'workhorse']);
  // Independently: the R11 (Codex) pool's reference plus its dispatchable cheap-tier low rows.
  const allowed = catalog => new Set([key('gpt-6-astra', 'max', 'codex'), ...catalog.candidates
    .filter(c => c.quota_pool === 'openai_codex' && tiered.has(TIERS[c.model]) && c.effort === 'low' &&
      c.availability === 'available').map(c => c.id)]);
  const cases = [
    ['undispatchable row', {change: model => model === 'gpt-6.1-sol' ? {availability: 'unavailable'} : {}},
      [ref(ASTRA), prow(LUNA, {p: 0.05, attempt: 100}), prow(SOL, {p: 1, attempt: 0})], key('gpt-6.1-sol', 'low', 'codex')],
    ['other pool row', {}, [ref(ASTRA), prow(LUNA, {p: 0.05, attempt: 100}), prow(SOL, {p: 0.05, attempt: 300}),
      ref(FABLE), prow(HAIKU, {p: 1, attempt: 0}), prow(OPUS, {p: 1, attempt: 0})], key('claude-haiku-4-5-20251001', 'none', 'claude')],
    ['frontier non-reference row', {}, [ref(ASTRA), prow(LUNA, {p: 0.05, attempt: 100}), prow(SOL, {p: 0.05, attempt: 300}),
      prow(ASTRA_LOW, {p: 1, attempt: 0})], key('gpt-6-astra', 'low', 'codex')],
  ];
  for (const [name, options, rows, never] of cases) {
    const catalog = tierCatalog(request, options);
    const chosen = resolve(request, catalog, {descentPolicy: prepareCertifiedDescentPolicy(policy(rows))})
      .decisions.n.resolved_candidate_id;
    assert.notEqual(chosen, never, name);
    assert.ok(allowed(catalog).has(chosen), `${name}: ${chosen}`);
    assert.equal(chosen, key('gpt-6-astra', 'max', 'codex'), `${name}: every F member here costs more than the reference`);
  }
});

test('a reference decision binds the very reference the policy costed, never another pool\'s R11 reference', () => {
  const request = task('/tmp', 'Answer one bounded question');
  // Haiku outscores Luna for the tier offer (the Claude pool is the R11 pool);
  // Astra outscores Fable, so a plain reference serve would pick Codex.
  const scores = {quota_scores: {'claude-haiku-4-5-20251001': 100, 'gpt-6-luna': 1, 'gpt-6-astra': 100,
    'claude-fable-5-1': 1}};
  const catalog = tierCatalog(request, {extra: scores});
  const baseline = resolve(request, catalog);
  assert.equal(route(baseline.decisions.n), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.equal(baseline.routes.n.ladder.reference_candidate_id, key('claude-fable-5-1', 'max', 'claude'));
  assert.equal(route(resolve(request, catalog, {verifierRegistry: null}).decisions.n), 'openai_codex/gpt-6-astra/max',
    'a reference node ranks references by R11');
  // Every Claude descent costs a little more than Fable; Astra (outside F) costs far more.
  const claudeDear = [ref(FABLE), prow(HAIKU, {p: 0.5, attempt: 600}), prow(SONNET, {p: 0.5, attempt: 600}),
    prow(OPUS, {p: 0.5, attempt: 600})];
  const raw = policy([...claudeDear, ref(ASTRA, 50_000)]);
  const resolved = resolve(request, catalog, {descentPolicy: prepareCertifiedDescentPolicy(raw)});
  const decision = resolved.decisions.n;
  assert.equal(route(decision), 'anthropic_shared/claude-fable-5-1/max');
  assert.equal(decision.resolved_candidate_id, key('claude-fable-5-1', 'max', 'claude'));
  assert.deepEqual(resolved.routes.n, {kind: 'reference', reference_effort: 'max', ladder: null});
  assert.ok(decision.reason.includes(`;certified_descent_not_cost_effective;${token(raw)};tier_frontier;pool_rank_1;` +
    'outscored_pool_rank_0;effort_max;pool_scored_by_tier_hit_model;'), decision.reason);
  assert.doesNotMatch(decision.reason, /pool_scored_by_bound_model/);
  // The R11 pool's reference cannot dispatch: the target fixed at bind is
  // Codex's, and the policy binds exactly that row, which no score ranked.
  const noFable = tierCatalog(request, {extra: scores,
    change: model => ['claude-fable-5-1', 'fable'].includes(model) ? {availability: 'unavailable'} : {}});
  const otherTarget = resolve(request, noFable).routes.n.ladder;
  assert.equal(otherTarget.reference_candidate_id, key('gpt-6-astra', 'max', 'codex'));
  const astraDear = policy([ref(ASTRA), ...claudeDear.slice(1)]);
  const fallback = resolve(request, noFable, {descentPolicy: prepareCertifiedDescentPolicy(astraDear)}).decisions.n;
  assert.equal(route(fallback), 'openai_codex/gpt-6-astra/max');
  assert.ok(fallback.reason.includes(`;certified_descent_not_cost_effective;${token(astraDear)};tier_frontier;pool_rank_0;` +
    'effort_max;agent_surface'), fallback.reason);
  assert.doesNotMatch(fallback.reason, /pool_scored_by_/);
});

test('a policy that binds another model of the pool never claims that model\'s quota score ranked the pool', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const catalog = tierCatalog(request, {extra: {quota_scores: {'claude-haiku-4-5-20251001': 400, 'gpt-6-luna': 50,
    'gpt-6.1-sol': 900}}});
  const baseline = resolve(request, catalog).decisions.n;
  assert.equal(route(baseline), 'anthropic_shared/claude-haiku-4-5-20251001/none');
  assert.ok(baseline.reason.includes(';pool_rank_1;outscored_pool_rank_0;effort_none;pool_scored_by_bound_model;'));
  const raw = policy([ref(FABLE), prow(HAIKU, {p: 0.1, attempt: 50}), prow(SONNET, {p: 0.1, attempt: 80}),
    prow(OPUS, {p: 0.99, attempt: 200})]);
  const decision = resolve(request, catalog, {descentPolicy: prepareCertifiedDescentPolicy(raw)}).decisions.n;
  assert.equal(route(decision), 'anthropic_shared/claude-opus-5-5/low');
  // The Claude pool was ranked by Haiku's score, not Opus's (which has none).
  assert.ok(decision.reason.includes(`;${token(raw)};tier_list_2;tier_workhorse;pool_rank_1;outscored_pool_rank_0;` +
    'effort_low;pool_scored_by_tier_hit_model;escalation_reference_same_pool;'), decision.reason);
  assert.doesNotMatch(decision.reason, /pool_scored_by_bound_model/);
  // An unscored hit model: no score note at all, even when the bound model has one.
  const unscored = tierCatalog(request, {extra: {quota_scores: {'gpt-6.1-sol': 5}}});
  const sol = resolve(request, unscored, {descentPolicy: prepareCertifiedDescentPolicy(solWins())}).decisions.n;
  assert.equal(route(sol), 'openai_codex/gpt-6.1-sol/low');
  assert.doesNotMatch(sol.reason, /pool_scored_by_/);
});

test('bounded Auto admission applies the same policy as the resolver (admitBoundedAutoPlan)', () => {
  const request = task('/tmp', 'Answer one bounded question');
  const catalog = tierCatalog(request, {extra: {owner_scope: 'read_only', request_class: 'readonly_lookup',
    chat_lane_eligible: false}});
  const prepared = createPlannerHostProjection({task: request, catalog, scope: 'read_only', nonce: 'fixed_nonce'});
  const compiled = compileFreshPlannerProposal(JSON.stringify({schema: 2, kind: 'untrusted_local_plan_proposal',
    nodes: [{proposal_node_id: 'a', instruction: request.request, requirement_refs: ['owner_objective'], dependencies: [],
      material_refs: [], proposed_candidate_id: null, proposed_scope: 'read_only', proposed_owned_paths: [],
      required_output: 'Source-grounded answer', check_refs: [], reason_code: 'independent_read'}],
    final_output_proposal: {mode: 'direct_child', node_ids: ['a']}}), prepared, prepared, {max_nodes: 4});
  const now = Date.now();
  const base = admitBoundedAutoPlan(compiled, request, catalog, now, CERTIFY);
  const [plain] = base.plan.nodes;
  assert.equal(plain.candidate_id, key('gpt-6-luna', 'low', 'codex'));
  const stratum = {request_class: 'readonly_lookup'};
  const raw = policy([ref(ASTRA, 1000, stratum), prow(LUNA, {p: 0.1, attempt: 100, stratum}),
    prow(SOL, {p: 0.99, attempt: 300, stratum})]);
  const admitted = admitBoundedAutoPlan(compiled, request, catalog, now, CERTIFY, prepareCertifiedDescentPolicy(raw));
  const [node] = admitted.plan.nodes;
  assert.equal(node.candidate_id, key('gpt-6.1-sol', 'low', 'codex'));
  assert.equal(admitted.routes[node.id].ladder.descent_policy_sha256, raw.policy_sha256);
  assert.ok(admitted.decisions[node.id].reason.startsWith(
    `bounded_plan;route_tier;admitted_certified_verifier;${token(raw)};tier_list_2;tier_workhorse;`),
  admitted.decisions[node.id].reason);
  // The bind-time resolver of the same node agrees with the admission.
  assert.equal(resolve(request, catalog, {now, descentPolicy: prepareCertifiedDescentPolicy(raw)},
    [unbound('a', request.request)]).plan.nodes[0].candidate_id, node.candidate_id);
  const referenceRaw = policy([ref(ASTRA, 1000, stratum), prow(LUNA, {p: 0.05, attempt: 100, stratum}),
    prow(SOL, {p: 0.05, attempt: 300, stratum})]);
  const reference = admitBoundedAutoPlan(compiled, request, catalog, now, CERTIFY,
    prepareCertifiedDescentPolicy(referenceRaw));
  assert.equal(reference.plan.nodes[0].candidate_id, key('gpt-6-astra', 'max', 'codex'));
  assert.equal(reference.routes[reference.plan.nodes[0].id].kind, 'reference');
});

test('multi-node plans: each node is ranked in its own context bucket', () => {
  const request = task('/tmp', 'Two bounded questions');
  const short = 'Short one', long = 'A much longer bounded instruction for the second node';
  assert.ok(Buffer.byteLength(short) <= 20 && Buffer.byteLength(long) > 20);
  const raw = policy([ref(ASTRA), prow(LUNA, {p: 0.99, attempt: 100}), prow(SOL, {p: 0.1, attempt: 300}),
    ref(ASTRA, 1000, {context_bucket: 1}), prow(LUNA, {p: 0.1, attempt: 100, stratum: {context_bucket: 1}}),
    prow(SOL, {p: 0.99, attempt: 300, stratum: {context_bucket: 1}})], {bounds: [20]});
  const resolved = resolve(request, tierCatalog(request), {descentPolicy: prepareCertifiedDescentPolicy(raw)},
    [unbound('a', short), unbound('b', long)]);
  assert.equal(route(resolved.decisions.a), 'openai_codex/gpt-6-luna/low');
  assert.equal(route(resolved.decisions.b), 'openai_codex/gpt-6.1-sol/low');
  assert.equal(resolved.routes.a.ladder.descent_policy_sha256, raw.policy_sha256);
  assert.equal(resolved.routes.b.ladder.descent_policy_sha256, raw.policy_sha256);
});

test('a follow-up turn is its own stratum: first-turn rows never apply to it', () => {
  const request = task('/tmp', 'Continue the bounded question', {codexSession: 'owner-codex-thread'});
  const catalog = tierCatalog(request);
  const baseline = resolve(request, catalog);
  assert.equal(route(baseline.decisions.n), 'openai_codex/gpt-6-luna/low');
  const firstOnly = prepareCertifiedDescentPolicy(referenceWins());
  assert.deepEqual(resolve(request, catalog, {descentPolicy: firstOnly}), baseline);
  const later = policy([ref(ASTRA, 1000, {turn: 'not_first'}), prow(LUNA, {p: 0.05, attempt: 100, stratum: {turn: 'not_first'}}),
    prow(SOL, {p: 0.05, attempt: 300, stratum: {turn: 'not_first'}})]);
  const resolved = resolve(request, catalog, {descentPolicy: prepareCertifiedDescentPolicy(later)});
  assert.equal(route(resolved.decisions.n), 'openai_codex/gpt-6-astra/max');
  assert.ok(resolved.decisions.n.reason.includes(`;certified_descent_not_cost_effective;${token(later)};`));
});

test('a contract admission is ranked; exact, class and owner-word routes ignore any policy', () => {
  const now = Date.now();
  // Contract (R0 a): the full read-only owner contract for this exact request.
  const request = task('/tmp', 'What does the interval rule in this workspace mean?');
  const contract = {coverage: 'full', scope: 'read_only', objective_sha256: request.request_sha256,
    contract_sha256: sha('contract'), context_sha256: sha(''), start_tree_sha256: sha('tree'),
    reference_policy_sha256: request.policy_sha256, valid_until_ms: now + 600_000, bindings_checked: true};
  const facts = {owner_scope: 'read_only', chat_lane_eligible: false, request_class: 'readonly_lookup', task_contract: contract};
  const contracted = tierCatalog(request, {extra: facts});
  const node = [unbound('n', request.request)];
  const baseline = resolve(request, contracted, {now, verifierRegistry: null}, node);
  assert.match(baseline.decisions.n.reason, /^resolver;route_tier;admitted_certified_contract;tier_list_0;/);
  const stratum = {request_class: 'readonly_lookup', admitted_by: 'contract', check_id: null};
  const contractPolicy = policy([ref(ASTRA, 1000, stratum), prow(LUNA, {p: 0.1, attempt: 100, stratum}),
    prow(SOL, {p: 0.99, attempt: 300, stratum})]);
  const ranked = resolve(request, contracted, {now, verifierRegistry: null,
    descentPolicy: prepareCertifiedDescentPolicy(contractPolicy)}, node);
  assert.equal(route(ranked.decisions.n), 'openai_codex/gpt-6.1-sol/low');
  assert.equal(ranked.routes.n.ladder.admitted_by, 'contract');
  // A verifier-keyed policy never ranks a contract node (another stratum).
  assert.deepEqual(resolve(request, contracted, {now, verifierRegistry: null,
    descentPolicy: prepareCertifiedDescentPolicy(solWins())}, node), baseline);

  // A policy that would rank ANY covered stratum, for the routes below.
  const everything = prepareCertifiedDescentPolicy(policy([ref(ASTRA), prow(LUNA, {p: 0.01, attempt: 100}),
    prow(SOL, {p: 0.01, attempt: 300}), ref(ASTRA, 1000, stratum), prow(LUNA, {p: 0.01, attempt: 100, stratum}),
    prow(SOL, {p: 0.01, attempt: 300, stratum})]));
  // Exact (R0, explicit route test): the owner-named route keeps its cheapest tier.
  const explicit = task('/tmp', 'Codex 2+2');
  explicit.mode = 'explicit_routing_test';
  explicit.host_context = {...explicit.host_context, explicit_routes: [{surface: 'codex', instruction: '2+2'}]};
  explicit.source_fingerprint = hostContextFingerprint(explicit.host_context);
  const explicitCatalog = tierCatalog(explicit);
  const routeNode = [{...unbound('requested-1', '2+2')}];
  const exactBase = resolve(explicit, explicitCatalog, {now}, routeNode);
  assert.match(exactBase.decisions['requested-1'].reason, /;admitted_certified_exact;/);
  assert.deepEqual(resolve(explicit, explicitCatalog, {now, descentPolicy: everything}, routeNode), exactBase);
  // Class (R0 c): no check-acceptance labels exist for a format check.
  const classed = tierCatalog(request, {extra: {owner_scope: 'read_only', chat_lane_eligible: false,
    request_class: 'readonly_lookup', class_certificates: {readonly_lookup: {certificate_id: 'cert-lookup-1',
      provider: 'codex', model: 'gpt-6-luna', effort: 'low', format_check: 'nonempty_text',
      measurement_sha256: sha('frozen measurement')}}}});
  const classBase = resolve(request, classed, {now, verifierRegistry: null}, node);
  assert.match(classBase.decisions.n.reason, /;admitted_certified_class:cert-lookup-1;/);
  assert.deepEqual(resolve(request, classed, {now, verifierRegistry: null, descentPolicy: everything}, node), classBase);
  // Owner words (a model/effort intent or a provider choice) bind the owner's tuple.
  const worded = tierCatalog(request, {extra: {routing_intent: {effort: 'max', model_family: 'astra'}}});
  const wordedBase = resolve(request, worded, {now});
  assert.match(wordedBase.decisions.n.reason, /admitted_reference_owner_words/);
  assert.deepEqual(resolve(request, worded, {now, descentPolicy: everything}), wordedBase);
  const provider = task('/tmp', 'Answer one bounded question', {provider: 'codex'});
  const providerCatalog = tierCatalog(provider);
  const providerBase = resolve(provider, providerCatalog, {now});
  assert.match(providerBase.decisions.n.reason, /admitted_reference_owner_words/);
  assert.deepEqual(resolve(provider, providerCatalog, {now, descentPolicy: everything}), providerBase);
});

// ---- Durable runtime ---------------------------------------------------------

async function run(t, dir, name, {execute, policy: certifiedDescentPolicy, catalog = {}, refresh = null} = {}) {
  const request = task(dir, 'Answer one question: ' + name);
  const tickets = [];
  let refreshes = 0;
  const runtime = await createRCCRuntime({stateDir: join(dir, name.replace(/\W+/g, '-')), verifierRegistry: CERTIFY,
    ...(certifiedDescentPolicy === undefined ? {} : {certifiedDescentPolicy}),
    catalog: async value => { refreshes++; return refresh ? refresh(value, refreshes) : tierCatalog(value, catalog); },
    plan: async () => plan(request, [unbound('n')]),
    execute: async ticket => { tickets.push(ticket); return execute(ticket, tickets.length); },
    verifyTask: taskVerdict});
  t.after(async () => { await runtime.close(); });
  await runtime.submit(request);
  const done = await runtime.wait({schema: 1, task_id: request.task_id}, {timeoutMs: 10_000});
  return {request, runtime, tickets, done,
    tuples: tickets.map(ticket => `${ticket.selected_config.model}/${ticket.selected_config.effort}`)};
}
const ledger = async (dir, name) => (await readFile(join(dir, name.replace(/\W+/g, '-'), 'routing-ledger',
  'routing-ledger.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));

test('runtime: the policy-chosen descent runs first, is delivered on its check, and its failure escalates once', async t => {
  const dir = await fixture(t);
  const raw = solWins();
  const adopted = await run(t, dir, 'policy adopted', {policy: raw, execute: ticket => execution(ticket)});
  assert.equal(adopted.done.state, 'completed', adopted.done.error);
  assert.deepEqual(adopted.tuples, ['gpt-6.1-sol/low']);
  assert.equal(adopted.done.result.output, 'answer from gpt-6.1-sol/low');
  const child = adopted.done.children[0];
  assert.ok(child.routing_decision.reason.includes(`;${token(raw)};tier_list_2;tier_workhorse;`));
  const [record] = await ledger(dir, 'policy adopted');
  assert.equal(record.descent_policy_sha256, raw.policy_sha256);
  assert.equal(record.delivery_basis, 'certified:verifier:fixture-sound');
  assert.equal(record.check_outcome, 'pass');

  const failed = await run(t, dir, 'policy escalated', {policy: raw,
    execute: (ticket, count) => execution(ticket, count === 1 ? {output: ''} : {})});
  assert.equal(failed.done.state, 'completed', failed.done.error);
  assert.deepEqual(failed.tuples, ['gpt-6.1-sol/low', 'gpt-6-astra/max']);
  assert.equal(failed.tickets[1].candidate_id, key('gpt-6-astra', 'max', 'codex'));
  assert.equal(failed.done.result.output, 'answer from gpt-6-astra/max', 'the failed descent is never delivered');
  assert.equal(failed.runtime.events({schema: 1, task_id: failed.request.task_id})
    .filter(event => event.kind === 'ladder_escalated_to_reference').length, 1);
  const records = await ledger(dir, 'policy escalated');
  assert.deepEqual(records.map(r => [r.model, r.escalated, r.descent_policy_sha256]),
    [['gpt-6.1-sol', false, raw.policy_sha256], ['gpt-6-astra', true, raw.policy_sha256]]);

  const reference = await run(t, dir, 'policy reference', {policy: referenceWins(), execute: ticket => execution(ticket)});
  assert.equal(reference.done.state, 'completed', reference.done.error);
  assert.deepEqual(reference.tuples, ['gpt-6-astra/max']);
  assert.equal(reference.done.children[0].routing_decision.ladder, undefined);
  assert.match(reference.done.children[0].routing_decision.reason, /;certified_descent_not_cost_effective;descent_cost_policy_[a-f0-9]{12};/);
  const [referenceRecord] = await ledger(dir, 'policy reference');
  assert.equal(referenceRecord.route_kind, 'reference');
  assert.equal('descent_policy_sha256' in referenceRecord, false);
});

test('runtime: a non-object policy is refused; an invalid policy object routes exactly like none', async t => {
  const dir = await fixture(t);
  for (const value of ['x', 1, [], true])
    await assert.rejects(createRCCRuntime({stateDir: join(dir, 'refused-' + randomUUID()), certifiedDescentPolicy: value,
      catalog: async request => tierCatalog(request), plan: async () => null, execute: async () => null}),
    error => error.code === 'certified_descent_policy_invalid');
  const raw = solWins();
  const broken = await run(t, dir, 'bad hash', {policy: {...raw, policy_sha256: sha('another body')},
    execute: ticket => execution(ticket)});
  const none = await run(t, dir, 'no policy', {execute: ticket => execution(ticket)});
  for (const result of [broken, none]) {
    assert.equal(result.done.state, 'completed', result.done.error);
    assert.deepEqual(result.tuples, ['gpt-6-luna/low']);
    assert.doesNotMatch(result.done.children[0].routing_decision.reason, /descent_cost_policy_/);
  }
  const strip = reason => reason.replace(/^resolver;/, '');
  assert.equal(strip(broken.done.children[0].routing_decision.reason), strip(none.done.children[0].routing_decision.reason));
  assert.equal('descent_policy_sha256' in (await ledger(dir, 'bad hash'))[0], false);
});

test('runtime re-resolution applies the policy inside the new F, never to an avoided row', async t => {
  const dir = await fixture(t);
  // The bound sol/low row is gone by dispatch: the node moves to the Claude
  // pool and the policy ranks THAT pool's F (fable/max, haiku, sonnet, opus).
  const claude = [ref(FABLE), prow(HAIKU, {p: 0.1, attempt: 50}), prow(SONNET, {p: 0.1, attempt: 80}),
    prow(OPUS, {p: 0.99, attempt: 200})];
  const raw = policy([...solWins().rows, ...claude]);
  const moved = await run(t, dir, 'policy re-resolved', {policy: raw,
    refresh: (value, count) => tierCatalog(value, {change: model =>
      count >= 2 && model === 'gpt-6.1-sol' ? {availability: 'unavailable'} : {}}),
    execute: ticket => execution(ticket)});
  assert.equal(moved.done.state, 'completed', moved.done.error);
  assert.deepEqual(moved.tuples, ['claude-opus-5-5/low']);
  const decision = moved.done.children[0].routing_decision;
  assert.match(decision.reason, new RegExp(`^re_resolved_after:[a-z_]+;other_pool;route_tier;admitted_certified_verifier;` +
    `${token(raw)};tier_list_2;tier_workhorse;`));
  assert.equal(decision.ladder.reference_model, 'claude-fable-5-1');
  // Same pool only (no Claude rows): the refused, still available sol/low is
  // avoided even though the policy prices it cheapest; luna/low is taken.
  const avoided = policy([ref(ASTRA), prow(LUNA, {p: 0.99, attempt: 100}), prow(SOL, {p: 1, attempt: 0})]);
  const refused = ticket => execution(ticket, {status: 'failed', dispatch_stage: 'not_dispatched', side_effects: 'none',
    output: null, execution_verified: false, task_quality: 'failed', usage: null, error: 'native_configuration_unavailable'});
  const same = await run(t, dir, 'policy avoided row', {policy: avoided, catalog: {claude: []},
    execute: ticket => ticket.selected_config.model === 'gpt-6.1-sol' ? refused(ticket) : execution(ticket)});
  assert.equal(same.done.state, 'completed', same.done.error);
  assert.deepEqual(same.tuples, ['gpt-6.1-sol/low', 'gpt-6-luna/low']);
  assert.match(same.done.children[0].routing_decision.reason,
    new RegExp(`^re_resolved_after:native_configuration_unavailable;same_pool_only;route_tier;admitted_certified_verifier;${token(avoided)};tier_list_0;`));
});
