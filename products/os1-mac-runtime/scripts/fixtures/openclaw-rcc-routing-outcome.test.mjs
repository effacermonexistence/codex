// Synthetic strict-contract fixtures only. origin=actual_execution simulates a
// host wrapper; it does not represent actual provider use or training data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {digest} from '../../Resources/openclaw-os1-bridge/joint-route-selector.mjs';
import {normalizeRoutingOutcome as normalize, mergeRoutingOutcomes as merge}
  from '../../Resources/openclaw-os1-bridge/routing-outcome.mjs';
const h = x => digest(`synthetic-only:${x}`);
const uuid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
function cfg(model = 'mock-native', effort = 'low') {
  return {surface: 'codex', transport: 'codex_app_server', account_id: 'mock-account', model, effort,
    tools: ['read_file'], scope: 'read_only', permission_profile: 'read_only', quota_pool: 'openai_codex',
    allowed_paths: ['/synthetic-private-owned-workspace'], configuration_sha256: h(`configuration-${model}-${effort}`)};
}
function usageRow(id = 'native-parent', parent = null, values = {}) {
  return {execution_id: id, parent_execution_id: parent, basis: 'attempt_total',
    input_basis: 'includes_cache', output_basis: 'includes_reasoning', source_receipt_sha256: h(`usage-${id}`),
    input_tokens: 100, output_tokens: 20, cache_read_tokens: 80, cache_write_tokens: 0,
    reasoning_tokens: 12, provider_calls: 2, duration_ms: 90, ...values};
}
function usage() {
  return {schema: 1, metric: 'native_usage_observation', source_receipt_sha256: h('usage-envelope'),
    parent_scope: 'includes_children', children_coverage: 'complete_disjoint', parent: usageRow(), children: []};
}
function fixture() {
  const config = cfg();
  return {schema: 1, origin: 'actual_execution', identity: {task_id: 'task-1', node_id: 'node-1', attempt_id: uuid(1),
    candidate_id: 'candidate-1', request_sha256: h('request'), source_fingerprint: h('source'),
    policy_sha256: h('policy'), configuration_sha256: config.configuration_sha256, quality_contract_sha256: h('contract')},
    provenance: {source_kind: 'core_settled_attempt', source_sha256: h('actual-host-artifact-MOCK'),
      host_validated: true, observed_at_ms: 1000},
    configs: {selected: config, acknowledged: structuredClone(config), observed: structuredClone(config)},
    native: {provider: 'openai', execution_id: 'native-parent', session_id: uuid(10), turn_id: uuid(11),
      record_sha256: h('native-record'), turn_terminated: true},
    result: {status: 'succeeded', attempt_state: 'completed', dispatch_stage: 'dispatched', side_effects: 'none',
      execution_verified: true, task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
      output_sha256: h('output'), artifact_sha256: h('artifact'), error_code: null, failure_category: null, http_status: null},
    adoption: {state: 'adopted', scope: 'node', final_for_scope: true}, checker: null, usage: usage()};
}
function verified(s = fixture()) {
  s.result.task_verified = true; s.result.task_quality = 'task_verified';
  s.checker = {kind: 'complete_checker', coverage: 'full', assessment: 'pass', host_validated: true,
    scope: s.adoption.scope, task_id: s.identity.task_id, node_id: s.identity.node_id, attempt_id: s.identity.attempt_id,
    configuration_sha256: s.identity.configuration_sha256, config_sha256: digest(s.configs.observed),
    contract_sha256: s.identity.quality_contract_sha256, artifact_sha256: s.result.artifact_sha256,
    witness_sha256: h('scoped-checker-witness')};
  return s;
}
const qreason = (s, code) => { const r = normalize(s); assert.equal(r.status, 'quarantined'); assert.equal(r.reason, code); return r; };

test('execution-only success stays unverified, separate from task correctness', () => {
  const s = fixture(), before = JSON.stringify(s), r = normalize(s);
  assert.equal(r.status, 'normalized'); assert.equal(r.learning.correctness_label, null);
  assert.equal(r.learning.eligible, false); assert.equal(r.result.execution_verified, true);
  assert.equal(r.parity_state, 'unverified'); assert.equal(r.quality_certificate, false);
  assert.equal(r.execution_authorized, false); assert.equal(JSON.stringify(s), before);
});
test('only actual complete scoped validated checker on final adopted attempt yields success label', () => {
  const r = normalize(verified()); assert.equal(r.status, 'normalized');
  assert.equal(r.learning.correctness_label, 1); assert.equal(r.learning.eligible, true);
  assert.equal(r.quality.label_scope, 'node'); assert.equal(r.parity_state, 'unverified');
});
test('native execution metadata and config observations remain separate immutable projections', () => {
  const s = fixture(), r = normalize(s);
  assert.equal(r.selected_config.model, 'mock-native'); assert.equal(r.acknowledged_config.model, 'mock-native');
  assert.equal(r.observed_config.model, 'mock-native'); assert.equal(r.native.turn_id, uuid(11));
  s.configs.observed.model = 'changed'; assert.equal(r.observed_config.model, 'mock-native');
  assert.equal(JSON.stringify(r).includes('/synthetic-private-owned-workspace'), false);
  assert.equal(r.selected_config.allowed_paths_sha256, digest(['/synthetic-private-owned-workspace']));
});
for (const [name, mutate] of [
  ['execution_only', s => { s.result.task_verified = false; s.result.task_quality = 'execution_only'; }],
  ['unverified', s => { s.result.task_verified = false; s.result.task_quality = 'unverified'; }],
  ['partial coverage', s => { s.checker.coverage = 'partial'; }],
  ['model critic', s => { s.checker.kind = 'model_critic'; }],
  ['partial checker', s => { s.checker.kind = 'partial_checker'; }],
  ['unvalidated checker', s => { s.checker.host_validated = false; }],
  ['unvalidated host artifact', s => { s.provenance.host_validated = false; }],
  ['nonterminal turn', s => { s.native.turn_terminated = false; }],
  ['unknown turn termination', s => { s.native.turn_terminated = null; }],
  ['unknown native execution identity', s => { s.native.execution_id = null; s.usage = null; }],
  ['unknown native provider', s => { s.native.provider = 'unknown'; }],
  ['observed model unknown', s => { s.configs.observed = null; }],
  ['missing expected quality contract', s => { s.identity.quality_contract_sha256 = null; }],
  ['wrong quality contract', s => { s.checker.contract_sha256 = h('different-contract'); }],
  ['wrong observed artifact', s => { s.checker.artifact_sha256 = h('different-artifact'); }],
  ['checker task versus node scope', s => { s.checker.scope = 'task'; }],
  ['not adopted', s => { s.adoption.state = 'not_adopted'; }],
  ['held', s => { s.adoption.state = 'held'; }],
  ['not final', s => { s.adoption.final_for_scope = false; }],
  ['unknown final', s => { s.adoption.final_for_scope = null; }],
  ['pending attempt', s => { s.result.attempt_state = 'node_verifier_pending'; }],
  ['synthetic origin', s => { s.origin = 'synthetic_fixture'; }],
  ['forecast origin', s => { s.origin = 'forecast'; }],
]) test(`${name} cannot become correctness 1`, () => {
  const s = verified(); mutate(s); const r = normalize(s);
  assert.equal(r.status, 'normalized'); assert.equal(r.learning.correctness_label, null); assert.equal(r.learning.eligible, false);
});
test('complete scoped checker failure retains negative label, unlike missing or partial checks', () => {
  const s = verified(); s.checker.assessment = 'fail'; s.result.task_verified = false; s.result.task_quality = 'failed';
  s.result.attempt_state = 'quality_mismatch'; s.adoption.state = 'rejected';
  const r = normalize(s); assert.equal(r.learning.correctness_label, 0); assert.equal(r.learning.eligible, true);
  s.checker.coverage = 'partial'; assert.equal(normalize(s).learning.correctness_label, null);
});
test('host-validated complete checker fail contradicting task_verified quarantines, never trains either label', () => {
  const s = verified(); s.checker.assessment = 'fail'; qreason(s, 'outcome_checker_task_claim_conflict');
});
test('scope task label is explicit, never inferred from a node checker', () => {
  const s = verified(); s.adoption.scope = 'task'; assert.equal(normalize(s).learning.correctness_label, null);
  s.checker.scope = 'task'; assert.equal(normalize(s).quality.label_scope, 'task');
  assert.equal(normalize(s).learning.correctness_label, 1);
});
test('executor parity claim remains a reported claim, not normalized parity evidence', () => {
  const s = verified(); s.result.parity_state = 'reference_equivalent'; const r = normalize(s);
  assert.equal(r.result.parity_state, 'reference_equivalent'); assert.equal(r.parity_state, 'unverified');
});
test('failed, cancelled and interrupted attempts retain usage and no artificial correctness label', () => {
  for (const state of ['failed', 'cancelled', 'interrupted', 'effects_uncertain']) {
    const s = fixture(); s.result.status = state === 'effects_uncertain' ? state : 'failed';
    s.result.execution_verified = false; s.result.attempt_state = state; s.adoption.state = state === 'cancelled' ? 'cancelled' : 'held';
    const r = normalize(s); assert.equal(r.status, 'normalized'); assert.equal(r.learning.correctness_label, null);
    assert.equal(r.usage.total_tokens_observed, 120); assert.equal(r.result.attempt_state, state);
  }
});
test('transport failure and unknown HTTP status are retained, not labeled model incorrect', () => {
  const s = fixture(); Object.assign(s.result, {status: 'failed', execution_verified: false, attempt_state: 'failed',
    failure_category: 'transport', error_code: 'native_socket_closed', http_status: null});
  const r = normalize(s); assert.equal(r.result.failure_category, 'transport'); assert.equal(r.result.http_status, null);
  assert.equal(r.learning.correctness_label, null);
  s.result.http_status = 429; assert.equal(normalize(s).result.failure_category, 'transport'); // no inferred quota cause.
});
test('selected config cannot stand in for a missing observed execution config', () => {
  const s = fixture(); s.configs.observed = null; const r = normalize(s);
  assert.equal(r.observed_config, null); assert.equal(r.attribution.actual_config, null);
  assert.equal(r.attribution.final_adopted_config, null); assert.equal(r.attribution.basis, 'observed_config_unknown');
});
test('retry success is attributed to actual final tuple rather than cheap first attempt', () => {
  const cheap = fixture(); cheap.result.status = 'failed'; cheap.result.execution_verified = false;
  cheap.result.attempt_state = 'ladder_not_returned'; cheap.adoption.state = 'rejected'; cheap.adoption.final_for_scope = false;
  const final = fixture(); final.identity.attempt_id = uuid(2); final.identity.candidate_id = 'reference-2';
  const c = cfg('mock-actual-reference', 'ultra'); final.configs = {selected: c, acknowledged: structuredClone(c), observed: structuredClone(c)};
  final.identity.configuration_sha256 = c.configuration_sha256; verified(final);
  const a = normalize(cheap), b = normalize(final); let state = merge(null, a).state; state = merge(state, b).state;
  assert.equal(state.records.length, 2); assert.equal(a.attribution.final_adopted_config, null);
  assert.equal(b.attribution.final_adopted_config.model, 'mock-actual-reference');
  assert.equal(b.attribution.final_adopted_config.effort, 'ultra');
  assert.equal(b.identity.attempt_id, uuid(2));
});
test('native cache and reasoning are subsets, not extra token charges', () => {
  const r = normalize(fixture()); assert.equal(r.usage.total_tokens_observed, 120);
  assert.equal(r.usage.parent.raw_counters.cache_read_tokens, 80); assert.equal(r.usage.parent.raw_counters.reasoning_tokens, 12);
  assert.equal(r.usage.quota_consumption, 'unknown'); assert.equal(r.usage.cash_cost, 'unknown');
});
test('local cache-exclusive accounting adds known cache once, reasoning subset stays included', () => {
  const s = fixture(), c = {...cfg(), surface: 'local', transport: 'local', quota_pool: 'none'};
  s.configs = {selected: c, acknowledged: structuredClone(c), observed: structuredClone(c)};
  s.native.provider = 'local'; s.usage.metric = 'local_model_usage_observation';
  Object.assign(s.usage.parent, {input_basis: 'excludes_cache', input_tokens: 10, output_tokens: 2,
    cache_read_tokens: 8, cache_write_tokens: 0, reasoning_tokens: 1});
  assert.equal(normalize(s).usage.total_tokens_observed, 20);
  s.usage.parent.cache_read_tokens = null; assert.equal(normalize(s).usage.total_tokens_observed, null);
});
test('parent-includes-children aggregate is not added again to child counters', () => {
  const s = fixture(); s.usage.children = [usageRow('child-1', 'native-parent', {input_tokens: 40, output_tokens: 5,
    cache_read_tokens: 20, reasoning_tokens: 2, provider_calls: 1, duration_ms: 50})];
  const r = normalize(s); assert.equal(r.usage.total_tokens_observed, 120); assert.equal(r.usage.provider_calls_observed, 2);
  assert.equal(r.usage.child_accounting.known_tokens_subtotal, 45); assert.equal(r.usage.duration_ms_observed, 90);
});
test('parent-excludes-children aggregates only complete disjoint child scope', () => {
  const s = fixture(); s.usage.parent_scope = 'excludes_children';
  s.usage.children = [usageRow('child-1', 'native-parent', {input_tokens: 40, output_tokens: 5,
    cache_read_tokens: 20, reasoning_tokens: 2, provider_calls: 1})];
  let r = normalize(s); assert.equal(r.usage.total_tokens_observed, 165); assert.equal(r.usage.provider_calls_observed, 3);
  s.usage.children_coverage = 'partial_disjoint'; r = normalize(s);
  assert.equal(r.usage.total_tokens_observed, null); assert.equal(r.usage.known_tokens_subtotal, 165);
  assert.equal(r.usage.accounting_complete, false);
});
test('unknown parent/child scope or counters never become known zero', () => {
  const s = fixture(); s.usage = null; assert.equal(normalize(s).usage.total_tokens_observed, null);
  assert.equal(normalize(s).usage.known_tokens_subtotal, null);
  s.usage = usage(); s.usage.parent = null; s.usage.children = null; s.usage.children_coverage = 'unknown';
  let r = normalize(s); assert.equal(r.usage.total_tokens_observed, null); assert.equal(r.usage.child_accounting.count, null);
  assert.equal(r.usage.known_tokens_subtotal, null);
  s.usage = usage(); s.usage.parent_scope = 'unknown'; assert.equal(normalize(s).usage.total_tokens_observed, null);
  s.usage = usage(); s.usage.parent.input_tokens = null;
  assert.equal(normalize(s).usage.total_tokens_observed, null); assert.equal(normalize(s).usage.known_tokens_subtotal, null);
});
test('unknown child disjointness is not summed or used to reject valid inclusive parent total', () => {
  const s = fixture(); s.usage.children_coverage = 'unknown';
  s.usage.children = [usageRow('child-1', 'native-parent'), usageRow('child-2', 'native-parent')];
  const r = normalize(s); assert.equal(r.status, 'normalized'); assert.equal(r.usage.total_tokens_observed, 120);
  assert.equal(r.usage.child_accounting.known_tokens_subtotal, null); assert.equal(r.usage.child_accounting.count, 2);
  s.usage.parent_scope = 'excludes_children';
  const excluded = normalize(s); assert.equal(excluded.usage.total_tokens_observed, null);
  assert.equal(excluded.usage.known_tokens_subtotal, 120);
});
test('absent child list cannot claim complete-disjoint child inventory', () => {
  const s = fixture(); s.usage.children = null; qreason(s, 'usage_shape_invalid');
});
test('explicit measured zero remains zero but does not imply zero quota or cash', () => {
  const s = fixture(); for (const k of ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cache_read_tokens', 'cache_write_tokens', 'provider_calls']) s.usage.parent[k] = 0;
  const r = normalize(s); assert.equal(r.usage.total_tokens_observed, 0); assert.equal(r.usage.accounting_complete, true);
  assert.equal(r.usage.cash_cost, 'unknown'); assert.equal(r.usage.quota_consumption, 'unknown');
});
test('thread cumulative and response forms are not silently substituted for attempt total', () => {
  for (const basis of ['thread_cumulative', 'response_total', 'unknown']) {
    const s = fixture(); s.usage.parent.basis = basis; const r = normalize(s);
    assert.equal(r.usage.total_tokens_observed, null); assert.equal(r.usage.parent.raw_counters.input_tokens, 100);
  }
});
test('identical child identity repeats deduplicate, conflicting child identity quarantines', () => {
  const s = fixture(); const c = usageRow('child-1', 'native-parent', {input_tokens: 40, output_tokens: 5, cache_read_tokens: 20, reasoning_tokens: 1});
  s.usage.children = [c, structuredClone(c)]; assert.equal(normalize(s).usage.child_accounting.count, 1);
  s.usage.children[1].input_tokens = 41; qreason(s, 'usage_child_identity_conflict');
});
for (const [name, mutate, code] of [
  ['foreign task witness', s => { s.checker.task_id = 'foreign-task'; }, 'checker_binding_invalid'],
  ['foreign attempt witness', s => { s.checker.attempt_id = uuid(99); }, 'checker_binding_invalid'],
  ['wrong selected instructions', s => { s.identity.configuration_sha256 = h('foreign'); }, 'outcome_selected_config_binding'],
  ['foreign ACK config', s => { s.configs.acknowledged.model = 'foreign'; }, 'outcome_ack_or_observed_config_mismatch'],
  ['foreign observed config', s => { s.configs.observed.effort = 'ultra'; }, 'outcome_ack_or_observed_config_mismatch'],
  ['missing ACK with execution claim', s => { s.configs.acknowledged = null; }, 'outcome_execution_claim_unacknowledged'],
  ['missing native receipt with execution claim', s => { s.native.record_sha256 = null; }, 'outcome_execution_claim_unacknowledged'],
  ['wrong native provider', s => { s.native.provider = 'anthropic'; }, 'outcome_native_provider_mismatch'],
  ['negative token', s => { s.usage.parent.input_tokens = -1; }, 'usage_row_invalid'],
  ['fractional count', s => { s.usage.parent.input_tokens = 1.5; }, 'usage_row_invalid'],
  ['cache exceeds inclusive input', s => { s.usage.parent.cache_read_tokens = 101; }, 'usage_cache_exceeds_input'],
  ['reasoning exceeds output', s => { s.usage.parent.reasoning_tokens = 21; }, 'usage_reasoning_exceeds_output'],
  ['wrong parent usage identity', s => { s.usage.parent.execution_id = 'foreign'; }, 'usage_parent_identity_mismatch'],
  ['foreign native child', s => { s.usage.children = [usageRow('child-1', 'foreign-parent')]; }, 'usage_child_parent_mismatch'],
  ['wrong metric', s => { s.usage.metric = 'local_model_usage_observation'; }, 'usage_metric_provider_mismatch'],
  ['unknown usage field', s => { s.usage.balance_usd = 5; }, 'usage_shape_invalid'],
]) test(`${name} quarantines rather than dropping contradictory evidence`, () => {
  const s = verified(); mutate(s); qreason(s, code);
});
test('unknown or malformed schema/provenance/identity never creates a learning record', () => {
  for (const mutate of [s => { delete s.identity.attempt_id; }, s => { s.identity.attempt_id = 'not-uuid'; },
    s => { s.identity.request_sha256 = 'not-hash'; }, s => { s.provenance.source_sha256 = null; },
    s => { s.provenance.source_kind = 'model_self_report'; }, s => { s.provenance.observed_at_ms = -1; },
    s => { s.extra_private_text = 'do-not-leak-this'; }, s => { s.result.http_status = 'unknown'; }]) {
    const s = fixture(); mutate(s); const r = normalize(s); assert.equal(r.status, 'quarantined');
    assert.equal(r.learning_eligible, false); assert.equal(JSON.stringify(r).includes('do-not-leak-this'), false);
  }
  for (const input of [null, [], undefined, {schema: 1}]) assert.equal(normalize(input).status, 'quarantined');
});
test('safe integer overflow remains invalid instead of wrapping resource counts', () => {
  const s = fixture(); Object.assign(s.usage.parent, {input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1, reasoning_tokens: 0});
  qreason(s, 'usage_overflow');
});
test('idempotent merge counts an identical settled attempt once', () => {
  const r = normalize(verified()), first = merge(null, r), before = JSON.stringify(first.state);
  const again = merge(first.state, structuredClone(r)); assert.equal(again.disposition, 'duplicate');
  assert.equal(again.state.records.length, 1); assert.equal(JSON.stringify(first.state), before);
});
test('final serialized normalized record including hash and newline fits the existing ledger bound', () => {
  const r = normalize(verified()); assert.equal(r.status, 'normalized');
  assert.ok(Buffer.byteLength(JSON.stringify(r)) + 1 <= 8192);
});
test('same identity different terminal/usage/config payload quarantines, never last-wins', () => {
  for (const mutate of [s => { s.result.attempt_state = 'failed'; }, s => { s.usage.parent.output_tokens = 22; },
    s => { s.identity.policy_sha256 = h('new-policy'); }]) {
    const a = fixture(), b = fixture(); mutate(b); const na = normalize(a), nb = normalize(b);
    assert.equal(na.outcome_id, nb.outcome_id); let r = merge(merge(null, na).state, nb);
    assert.equal(r.disposition, 'quarantined'); assert.equal(r.state.records.length, 0);
    assert.equal(r.state.quarantined.length, 1); assert.equal(r.state.quarantined[0].variant_sha256s.length, 2);
    r = merge(r.state, na); assert.equal(r.disposition, 'quarantined'); assert.equal(r.state.records.length, 0);
  }
});
test('task/node/attempt identity does not change when retry model or receipt metadata changes', () => {
  const a = fixture(), b = fixture(); const c = cfg('changed-native-model', 'ultra');
  b.configs = {selected: c, acknowledged: structuredClone(c), observed: structuredClone(c)};
  b.identity.configuration_sha256 = c.configuration_sha256;
  assert.equal(normalize(a).outcome_id, normalize(b).outcome_id);
  assert.equal(merge(merge(null, normalize(a)).state, normalize(b)).disposition, 'quarantined');
});
test('distinct attempts remain separate including their failed-attempt resources', () => {
  const a = fixture(), b = fixture(); b.identity.attempt_id = uuid(2); b.result.status = 'failed'; b.result.execution_verified = false;
  const r = merge(merge(null, normalize(a)).state, normalize(b)); assert.equal(r.state.records.length, 2);
  assert.equal(r.state.records.map(x => x.usage.total_tokens_observed).reduce((x, y) => x + y), 240);
});
test('malformed/rehashed foreign merge input and invalid quarantine state are rejected', () => {
  const r = normalize(fixture()), bad = structuredClone(r); bad.result.status = 'failed';
  assert.throws(() => merge(null, bad), /outcome_merge_record_invalid/);
  const forged = structuredClone(r); forged.learning.correctness_label = forged.quality.correctness_label = 1;
  forged.learning.eligible = true;
  const {normalized_sha256, ...forgedBody} = forged; forged.normalized_sha256 = digest(forgedBody);
  assert.throws(() => merge(null, forged), /outcome_merge_record_invalid/);
  const authority = {...r, execution_authorized: true}; const {normalized_sha256: old, ...authorityBody} = authority;
  authority.normalized_sha256 = digest(authorityBody);
  assert.throws(() => merge(null, authority), /outcome_merge_record_invalid/);
  assert.throws(() => merge({schema: 1, records: [], quarantined: [{outcome_id: r.outcome_id}]}, r), /outcome_merge_state_invalid/);
  assert.throws(() => merge(null, normalize(null)), /outcome_merge_record_invalid/);
});
test('rehashing malformed normalized usage cannot bypass typed merge validation', () => {
  for (const mutate of [u => { u.total_tokens_observed = -99; u.accounting_complete = true; },
    u => { u.total_tokens_observed = null; u.accounting_complete = true; },
    u => { u.known_tokens_subtotal = -1; }, u => { u.provider_calls_observed = 1.5; },
    u => { u.duration_ms_observed = -1; }, u => { u.parent.raw_counters.input_tokens = -1; },
    u => { u.parent.raw_counters.cache_read_tokens = 1000; },
    u => { u.parent.total_tokens_observed = -50; }, u => { u.parent.input_tokens_observed = null; },
    u => { u.child_accounting.known_tokens_subtotal = -1; },
    u => { u.child_accounting.count = 0; u.child_accounting.unknown_rows = 1; },
    u => { u.child_accounting.known_tokens_subtotal = null; },
    u => { u.child_accounting.coverage = 'unknown'; u.child_accounting.known_tokens_subtotal = 1; },
    u => { u.quota_consumption = 0; }, u => { u.cash_cost = 0; }]) {
    const r = normalize(fixture()); mutate(r.usage); const {normalized_sha256, ...body} = r;
    r.normalized_sha256 = digest(body); assert.throws(() => merge(null, r), /outcome_merge_record_invalid/);
  }
  const s = fixture(); s.usage = null; const r = normalize(s); r.usage.total_tokens_observed = 0; r.usage.accounting_complete = true;
  const {normalized_sha256, ...body} = r; r.normalized_sha256 = digest(body);
  assert.throws(() => merge(null, r), /outcome_merge_record_invalid/);
});
test('full conflict quarantine fails closed without evicting prior evidence or returning oversized state', () => {
  const prior = normalize(fixture()), changed = fixture(); changed.usage.parent.output_tokens = 21;
  const state = {schema: 1, records: [prior], quarantined: Array.from({length: 4096}, (_, i) => ({
    outcome_id: h(`quarantined-${i}`), reason: 'contradictory_same_identity', variant_sha256s: [h('variant-1'), h('variant-2')]}))};
  const before = JSON.stringify(state);
  assert.throws(() => merge(state, normalize(changed)), /outcome_merge_quarantine_full/);
  assert.equal(JSON.stringify(state), before); assert.equal(state.quarantined.length, 4096);
});
test('source remains pure and never writes its own persistence or reads credentials', () => {
  const src = readFileSync(new URL('../../Resources/openclaw-os1-bridge/routing-outcome.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...src.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(x => x[1]), ['node:crypto']);
  assert.doesNotMatch(src, /\b(?:fetch|spawn|execFile|writeFile|readFile|Date\.now|setTimeout)\s*\(/);
});
