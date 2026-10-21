import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalUsageEvent, summarizeTaskResources} from './resource-usage.mjs';
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const event = (state = 'completed', extra = {}) => ({id: id(1), stage: 'routing_intent', state,
  provider: 'ollama', model: 'ollama/qwen3.5:4b', usage: state === 'started' || state === 'not_needed' ? null :
    {inputTokens: 10, outputTokens: 2, cacheReadTokens: 8, cacheWriteTokens: 0, totalTokens: 20},
  elapsed_ms: state === 'started' ? null : 5, observed_at_ms: state === 'started' ? 100 : 110,
  usage_basis: 'openclaw_input_excludes_cache', reason: null, ...extra});
const attempt = (n, usage = {input_tokens: 100, output_tokens: 10, cache_read_tokens: 80,
  cache_write_tokens: 0, provider_calls: 1, metric: 'native_usage_observation'}, state = 'completed') =>
  ({attempt_id: id(n), state, usage});
const child = (...attempts) => ({selected_config: {surface: 'codex'}, attempt_history: attempts});
const snapshot = (extra = {}) => ({plan_provenance: 'host_exact_request', resource_events: [event('not_needed')], children: [], ...extra});
const frozen = x => { if (x && typeof x === 'object') { Object.values(x).forEach(frozen); Object.freeze(x); } return x; };

test('zero-model branch and two plan origins are explicit, not guessed from old state', () => {
  for (const provenance of ['host_exact_request', 'deterministic_no_model']) {
    const r = summarizeTaskResources(snapshot({plan_provenance: provenance}));
    assert.equal(r.plan.model_calls, 0); assert.equal(r.local.calls_started, 0);
    assert.equal(r.local.not_needed, 1); assert.equal(r.total_tokens_observed, 0); assert.equal(r.accounting_complete, true);
  }
  const r = summarizeTaskResources({children: []});
  assert.equal(r.plan.model_calls, null); assert.equal(r.accounting_complete, false);
  assert.equal(r.total_tokens_observed, null); assert.ok(r.issues.includes('local_resource_events_missing_or_unbounded'));
});
test('local exclusive cache and native inclusive cache sum once, without mutating input', () => {
  const s = frozen(snapshot({resource_events: [event('started'), event()], children: [child(attempt(2))]}));
  const before = JSON.stringify(s), r = summarizeTaskResources(s);
  assert.equal(r.local.total_tokens_observed, 20); assert.equal(r.native.total_tokens_observed, 110);
  assert.equal(r.total_tokens_observed, 130); assert.equal(r.local.calls_started, 1);
  assert.equal(r.accounting_complete, true); assert.equal(JSON.stringify(s), before);
  assert.equal(r.quota_savings, 'not_measured'); assert.equal(r.cash_cost, 'not_measured');
});
test('failed/cancelled terminal retains measured tokens, not just accepted outputs', () => {
  for (const state of ['failed', 'cancelled']) {
    const r = summarizeTaskResources(snapshot({resource_events: [event('started'), event(state)]}));
    assert.equal(r.local.calls_started, 1); assert.equal(r.local.calls_settled, 1);
    assert.equal(r.total_tokens_observed, 20); assert.equal(r.accounting_complete, true);
  }
});
test('missing provider usage and started-only are incomplete, never zero', () => {
  for (const events of [[event('started')], [event('started'), event('failed', {usage: null})], [event('cancelled', {usage: {}})]]) {
    const r = summarizeTaskResources(snapshot({resource_events: events}));
    assert.equal(r.local.calls_started, 1); assert.equal(r.local.usage_unknown, 1);
    assert.equal(r.total_tokens_observed, null); assert.equal(r.accounting_complete, false);
  }
});
test('duplicate events and native histories do not add a call or child projection usage', () => {
  const a = attempt(2), s = snapshot({resource_events: [event('started'), event(), event()],
    children: [{...child(a, a), usage: {input_tokens: 999999}}, child(a)]});
  const r = summarizeTaskResources(s);
  assert.equal(r.local.calls_started, 1); assert.equal(r.native.attempts, 1);
  assert.equal(r.total_tokens_observed, 130); assert.equal(r.accounting_complete, true);
});
test('conflicting IDs, multiple terminal states and reversed chronology block completeness', () => {
  for (const events of [[event(), event('failed')], [event('started'), event('not_needed')],
    [event('started', {observed_at_ms: 120}), event()], [event('started'), event('started', {observed_at_ms: 101})]]) {
    const r = summarizeTaskResources(snapshot({resource_events: events}));
    assert.ok(r.issues.includes('local_operation_lifecycle_conflict')); assert.equal(r.accounting_complete, false);
  }
  const r = summarizeTaskResources(snapshot({children: [child(attempt(2), attempt(2, null))]}));
  assert.equal(r.native.attempts, 1); assert.equal(r.accounting_complete, false); assert.equal(r.total_tokens_observed, null);
});
test('all retry attempts count, including failed/cancelled, unknown retry does not disappear', () => {
  let r = summarizeTaskResources(snapshot({children: [child(attempt(2), attempt(3, undefined, 'failed'), attempt(4, undefined, 'cancelled'))]}));
  assert.equal(r.native.attempts, 3); assert.equal(r.native.total_tokens_observed, 330);
  r = summarizeTaskResources(snapshot({children: [child(attempt(2), attempt(3, null, 'failed'))]}));
  assert.equal(r.native.known_tokens_subtotal, 110); assert.equal(r.native.usage_unknown, 1); assert.equal(r.accounting_complete, false);
});
test('local explicit worker is partitioned from native and adds its exclusive caches', () => {
  const a = attempt(2, {input_tokens: 2, output_tokens: 3, cache_read_tokens: 20, cache_write_tokens: 0,
    provider_calls: 1, metric: 'local_model_usage_observation'});
  const s = snapshot({children: [{...child(a), selected_config: {surface: 'local'}}, child(attempt(3))]});
  let r = summarizeTaskResources(s);
  assert.equal(r.local.worker.attempts, 1); assert.equal(r.local.worker.total_tokens_observed, 25);
  assert.equal(r.native.attempts, 1); assert.equal(r.total_tokens_observed, 135);
  a.usage.metric = 'legacy_unknown'; r = summarizeTaskResources(s);
  assert.equal(r.accounting_complete, false); assert.equal(r.local.worker.usage_unknown, 1);
});
test('worker may bind its own ledger surface and partial worker usage is unknown', () => {
  const a = attempt(2, {input_tokens: 2, output_tokens: 3, metric: 'local_model_usage_observation'});
  a.ledger = {surface: 'local'};
  const r = summarizeTaskResources(snapshot({children: [child(a)]}));
  assert.equal(r.native.attempts, 0); assert.equal(r.local.worker.attempts, 1);
  assert.equal(r.local.worker.total_tokens_observed, null); assert.equal(r.accounting_complete, false);
});
test('explicit observed total can stand when component breakdown is partial; no invented missing cache', () => {
  let r = summarizeTaskResources(snapshot({resource_events: [event('completed', {usage: {totalTokens: 20}})]}));
  assert.equal(r.total_tokens_observed, 20); assert.equal(r.local.counters.inputTokens, null);
  r = summarizeTaskResources(snapshot({resource_events: [event('completed', {usage: {inputTokens: 10, outputTokens: 2}})]}));
  assert.equal(r.total_tokens_observed, null); assert.equal(r.accounting_complete, false);
});
test('strict validator rejects malformed counts, unknown fields, provider, states and conflicting totals', () => {
  const invalid = [event('started', {usage: {}}), event('completed', {unexpected: 1}), event('completed', {id: 'not-uuid'}), event('completed', {id: {toString: () => id(1)}}),
    event('completed', {provider: 'remote'}), event('completed', {stage: 'planner'}), event('completed', {state: 'done'}),
    event('completed', {usage_basis: 'native_input_includes_cache'}), event('completed', {observed_at_ms: -1}),
    event('completed', {elapsed_ms: true}), event('completed', {reason: 'x\0y'}),
    ...[-1, true, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1].map(inputTokens => event('completed', {usage: {inputTokens}})),
    event('completed', {usage: {inputTokens: 5, totalTokens: 4}}),
    event('completed', {usage: {inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, totalTokens: 11}}),
    event('completed', {usage: {foo: 1}})];
  for (const e of invalid) assert.throws(() => validateLocalUsageEvent(e));
  assert.equal(validateLocalUsageEvent(event()).usage.totalTokens, 20);
});
test('malformed native usage and legacy histories do not become zero-cost records', () => {
  for (const usage of [{input_tokens: -1}, {input_tokens: true}, {input_tokens: 2, cache_read_tokens: 3}, {input_tokens: 2, cache_read_tokens: 2, cache_write_tokens: 1},
    {input_tokens: 2, output_tokens: 1, metric: 'unknown'}, {input_tokens: 1, output_tokens: 2, unknown: 1}]) {
    const r = summarizeTaskResources(snapshot({children: [child(attempt(2, usage))]}));
    assert.equal(r.accounting_complete, false); assert.equal(r.total_tokens_observed, null);
  }
  assert.equal(summarizeTaskResources(snapshot({children: [{}]})).accounting_complete, false);
  assert.equal(summarizeTaskResources(null).accounting_complete, false);
});
test('sum overflow blocks adoption instead of losing precision', () => {
  const r = summarizeTaskResources(snapshot({resource_events: [event('completed', {usage: {totalTokens: Number.MAX_SAFE_INTEGER}}),
    event('completed', {id: id(5), usage: {totalTokens: 1}})]}));
  assert.ok(r.issues.includes('resource_usage_overflow')); assert.equal(r.accounting_complete, false);
});

test('observer validation or persistence errors cannot certify otherwise zero usage', () => {
  for (const errors of [['local_usage_observation_unavailable'], ['private error text must not leak'], 'invalid-shape']) {
    const r = summarizeTaskResources(snapshot({resource_accounting_errors: errors}));
    assert.equal(r.accounting_complete, false); assert.equal(r.total_tokens_observed, null);
    assert.ok(r.issues.includes('resource_accounting_observation_incomplete'));
    assert.equal(JSON.stringify(r).includes('private error text'), false);
  }
  assert.equal(summarizeTaskResources(snapshot({resource_accounting_errors: []})).accounting_complete, true);
});
test('ongoing observations expose their as-of scope and missing usage remains incomplete', () => {
  const s = snapshot({state: 'planning', resource_events: [event('started')]});
  const r = summarizeTaskResources(s);
  assert.equal(r.accounting_scope, 'observed_attempts_as_of_snapshot_not_future_cost');
  assert.equal(r.accounting_complete, false); assert.equal(r.total_tokens_observed, null);
  const running = summarizeTaskResources(snapshot({state: 'running', children: [child(attempt(2, null, 'dispatch_started'))]}));
  assert.equal(running.accounting_complete, false); assert.equal(running.native.usage_unknown, 1);
});


test('typed planner events count separately from intent and add all costs once', () => {
  const r = summarizeTaskResources(snapshot({plan_provenance: 'host_exact_request_shadow',
    resource_events: [event('started'), event(), event('started', {id: id(9), stage: 'plan_proposal'}),
      event('completed', {id: id(9), stage: 'plan_proposal'})]}));
  assert.equal(r.plan.model_calls, 1); assert.equal(r.local.intent.calls_started, 1);
  assert.equal(r.local.planner.calls_started, 1); assert.equal(r.local.total_tokens_observed, 40);
  assert.equal(r.total_tokens_observed, 40); assert.equal(r.accounting_complete, true);
  assert.equal(r.quota_savings, 'not_measured');
});
test('planner revision, failure and cancellation consumption are retained', () => {
  const r = summarizeTaskResources(snapshot({plan_provenance: 'host_exact_request_shadow',
    resource_events: [event('failed', {id: id(9), stage: 'plan_proposal'}),
      event('cancelled', {id: id(10), stage: 'plan_proposal'})]}));
  assert.equal(r.plan.model_calls, 2); assert.equal(r.local.planner.calls_settled, 2);
  assert.equal(r.local.intent.calls_started, 0); assert.equal(r.total_tokens_observed, 40);
});
test('planner not-needed is zero invocation, unknown invocation is not zero', () => {
  let r = summarizeTaskResources(snapshot({plan_provenance: 'host_exact_request_shadow',
    resource_events: [event('not_needed', {stage: 'plan_proposal'})]}));
  assert.equal(r.plan.model_calls, 0); assert.equal(r.total_tokens_observed, 0);
  r = summarizeTaskResources(snapshot({plan_provenance: 'host_exact_request_shadow', resource_events: []}));
  assert.equal(r.plan.model_calls, null); assert.equal(r.accounting_complete, false);
  r = summarizeTaskResources(snapshot({plan_provenance: 'host_exact_request_shadow',
    resource_events: [event('started', {stage: 'plan_proposal'})]}));
  assert.equal(r.plan.model_calls, 1); assert.equal(r.total_tokens_observed, null);
});
test('one ID cannot bridge intent-start into planner-terminal', () => {
  const r = summarizeTaskResources(snapshot({resource_events: [event('started'), event('completed', {stage: 'plan_proposal'})]}));
  assert.equal(r.accounting_complete, false); assert.equal(r.plan.model_calls, null);
  assert(r.issues.includes('local_operation_lifecycle_conflict'));
});
