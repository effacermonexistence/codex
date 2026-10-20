// Task-bound resource observations. Pure data reduction; never execution authority.
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const STATES = new Set(['started', 'completed', 'failed', 'cancelled', 'not_needed']);
const LOCAL_KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'];
const NATIVE_KEYS = ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cache_read_tokens', 'cache_write_tokens', 'provider_calls', 'duration_ms'];
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const count = x => Number.isSafeInteger(x) && x >= 0;
const sum = xs => { const n = xs.reduce((a, b) => a + b, 0); if (!count(n)) throw Error('resource_usage_overflow'); return n; };
const stable = x => Array.isArray(x) ? '[' + x.map(stable).join(',') + ']' : plain(x) ?
  '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}' : JSON.stringify(x);
function localUsage(x) {
  if (!plain(x) || Object.keys(x).some(k => ![...LOCAL_KEYS, 'costUsd'].includes(k)) ||
      Object.entries(x).some(([k, v]) => k === 'costUsd' ?
        typeof v !== 'number' || !Number.isFinite(v) || v < 0 : !count(v))) throw Error('local_usage_invalid');
  const known = LOCAL_KEYS.slice(0, 4).filter(k => x[k] !== undefined).map(k => x[k]);
  if (x.totalTokens !== undefined && (sum(known) > x.totalTokens ||
      known.length === 4 && sum(known) !== x.totalTokens)) throw Error('local_usage_total_mismatch');
  return x;
}
export function validateLocalUsageEvent(event) {
  const keys = ['id', 'stage', 'state', 'provider', 'model', 'usage', 'elapsed_ms', 'observed_at_ms', 'usage_basis', 'reason'];
  if (!plain(event) || Object.keys(event).length !== keys.length || keys.some(k => !Object.hasOwn(event, k)) ||
      typeof event.id !== 'string' || !UUID.test(event.id) || event.stage !== 'routing_intent' || !STATES.has(event.state) ||
      event.provider !== 'ollama' || event.model !== 'ollama/qwen3.5:4b' ||
      event.usage_basis !== 'openclaw_input_excludes_cache' || !count(event.observed_at_ms) ||
      event.elapsed_ms !== null && !count(event.elapsed_ms) ||
      event.reason !== null && (typeof event.reason !== 'string' || event.reason.length > 1024 || event.reason.includes('\0')) ||
      ['started', 'not_needed'].includes(event.state) && event.usage !== null)
    throw Error('local_resource_event_invalid');
  if (event.usage !== null) localUsage(event.usage);
  return event;
}
function counters(rows, keys) {
  return Object.fromEntries(keys.map(k => [k, rows.length === 0 ? 0 :
    rows.every(r => count(r?.[k])) ? sum(rows.map(r => r[k])) : null]));
}
function totals(rows, total) {
  const values = rows.map(total), observed = values.filter(count);
  return {total_tokens_observed: observed.length === rows.length ? sum(observed) : null,
    known_tokens_subtotal: sum(observed), usage_unknown: values.length - observed.length};
}
const localTotal = x => x == null ? null : count(x.totalTokens) ? x.totalTokens :
  LOCAL_KEYS.slice(0, 4).every(k => count(x[k])) ? sum(LOCAL_KEYS.slice(0, 4).map(k => x[k])) : null;
function nativeUsage(x, inclusive = true) {
  if (!plain(x) || Object.keys(x).some(k => ![...NATIVE_KEYS, 'metric', 'cost_units'].includes(k)) ||
      Object.entries(x).some(([k, v]) => v !== null && (NATIVE_KEYS.includes(k) ? !count(v) :
        k === 'metric' ? typeof v !== 'string' || v.length > 64 :
        typeof v !== 'number' || !Number.isFinite(v) || v < 0))) throw Error('native_usage_invalid');
  if (inclusive && count(x.input_tokens) && (count(x.cache_read_tokens) && x.cache_read_tokens > x.input_tokens ||
      count(x.cache_write_tokens) && x.cache_write_tokens > x.input_tokens ||
      count(x.cache_read_tokens) && count(x.cache_write_tokens) &&
      sum([x.cache_read_tokens, x.cache_write_tokens]) > x.input_tokens)) throw Error('native_cache_exceeds_input');
  return x;
}
/** Old/partial snapshots stay readable, but do not become zero-cost evidence.
 * Counts are executor attempts, not provider HTTP requests or subscription use.
 * Native attempt usage must already include its delegated native responses. */
export function summarizeTaskResources(snapshot) {
  const issues = [], groups = new Map(), attempts = new Map();
  const fail = text => { if (issues.length < 64 && !issues.includes(text)) issues.push(text); };
  if (snapshot?.resource_accounting_errors != null &&
      (!Array.isArray(snapshot.resource_accounting_errors) || snapshot.resource_accounting_errors.length > 0))
    fail('resource_accounting_observation_incomplete');
  const eventsKnown = Array.isArray(snapshot?.resource_events) && snapshot.resource_events.length <= 4096;
  if (!eventsKnown) fail('local_resource_events_missing_or_unbounded');
  for (const e of eventsKnown ? snapshot.resource_events : []) {
    try { validateLocalUsageEvent(e); } catch { fail('local_resource_event_invalid'); continue; }
    const rows = groups.get(e.id) ?? [];
    if (!rows.some(r => stable(r) === stable(e))) rows.push(e);
    groups.set(e.id, rows);
  }
  let callsStarted = 0, callsSettled = 0, notNeeded = 0, startedOnly = 0;
  const localRows = [];
  for (const rows of groups.values()) {
    const starts = rows.filter(r => r.state === 'started'), ends = rows.filter(r => r.state !== 'started');
    const conflicting = starts.length > 1 || ends.length > 1 ||
      ends[0]?.state === 'not_needed' && starts.length > 0 ||
      starts.length && ends.length && starts[0].observed_at_ms > ends[0].observed_at_ms;
    if (conflicting) { callsStarted++; fail('local_operation_lifecycle_conflict'); localRows.push(null); continue; }
    const end = ends[0];
    if (end?.state === 'not_needed') { notNeeded++; continue; }
    // A terminal event implies one admitted operation even if its start is absent.
    callsStarted++;
    if (end) { callsSettled++; localRows.push(end.usage); }
    else { startedOnly++; localRows.push(null); }
  }
  const childrenKnown = Array.isArray(snapshot?.children) && snapshot.children.length <= 1024;
  if (!childrenKnown) fail('native_children_missing_or_unbounded');
  for (const child of childrenKnown ? snapshot.children : []) {
    if (!plain(child) || !Array.isArray(child.attempt_history) || child.attempt_history.length > 4096) {
      fail('native_attempt_history_missing_or_unbounded'); continue;
    }
    for (const a of child.attempt_history) {
      if (!plain(a) || typeof a.attempt_id !== 'string' || !UUID.test(a.attempt_id)) { fail('native_attempt_identity_invalid'); continue; }
      const surface = a.selected_config?.surface ?? a.ledger?.surface ?? child.selected_config?.surface ?? null;
      // Relevant identity+usage only; projection metadata is not another call.
      const value = {surface, state: a.state ?? null, usage: a.usage ?? null};
      if (attempts.has(a.attempt_id) && stable(attempts.get(a.attempt_id)) !== stable(value)) {
        fail('attempt_identity_conflict'); attempts.set(a.attempt_id, {surface, state: null, usage: null});
      } else if (!attempts.has(a.attempt_id)) attempts.set(a.attempt_id, value);
    }
  }
  const nativeRows = [], workerRows = [];
  for (const a of attempts.values()) {
    if (a.surface === 'local') {
      try {
        const x = a.usage === null ? null : nativeUsage(a.usage, false);
        if (x !== null && x.metric !== 'local_model_usage_observation') throw Error('unknown_basis');
        workerRows.push(x === null ? null : Object.fromEntries([
          ['inputTokens', x.input_tokens], ['outputTokens', x.output_tokens],
          ['cacheReadTokens', x.cache_read_tokens], ['cacheWriteTokens', x.cache_write_tokens]
        ].filter(([, v]) => v !== undefined && v !== null)));
      } catch { fail('local_worker_usage_invalid_or_basis_unknown'); workerRows.push(null); }
    } else {
      try {
        const x = a.usage === null ? null : nativeUsage(a.usage);
        if (x !== null && x.metric !== 'native_usage_observation') throw Error('unknown_basis');
        nativeRows.push(x);
      } catch { fail('native_usage_invalid_or_basis_unknown'); nativeRows.push(null); }
    }
  }
  let localTotals, nativeTotals, localCounters, nativeCounters, intentTotals, workerTotals;
  try {
    intentTotals = totals(localRows, localTotal);
    workerTotals = totals(workerRows, localTotal);
    localTotals = totals([...localRows, ...workerRows], localTotal);
    nativeTotals = totals(nativeRows, x => count(x?.input_tokens) && count(x?.output_tokens) ?
      sum([x.input_tokens, x.output_tokens]) : null);
    localCounters = counters([...localRows, ...workerRows], LOCAL_KEYS);
    nativeCounters = counters(nativeRows, NATIVE_KEYS);
  } catch {
    fail('resource_usage_overflow');
    intentTotals = workerTotals = localTotals = nativeTotals = {total_tokens_observed: null, known_tokens_subtotal: null, usage_unknown: null};
    localCounters = nativeCounters = {};
  }
  const planKnown = ['host_exact_request', 'deterministic_no_model'].includes(snapshot?.plan_provenance);
  if (!planKnown) fail('plan_model_calls_unobserved');
  const localComplete = eventsKnown && startedOnly === 0 && localTotals.usage_unknown === 0 &&
    !issues.some(x => x.startsWith('local_'));
  const nativeComplete = childrenKnown && nativeTotals.usage_unknown === 0 &&
    !issues.some(x => x.startsWith('native_'));
  const complete = localComplete && nativeComplete && planKnown && issues.length === 0;
  let total = null;
  if (complete) try { total = sum([localTotals.total_tokens_observed, nativeTotals.total_tokens_observed]); }
  catch { fail('resource_usage_overflow'); }
  return {schema: 1, accounting_scope: 'observed_attempts_as_of_snapshot_not_future_cost', local: {operations: groups.size, calls_started: callsStarted, calls_settled: callsSettled,
    not_needed: notNeeded, started_only: startedOnly, counters: localCounters, ...localTotals,
    intent: {operations: groups.size, calls_started: callsStarted, calls_settled: callsSettled, not_needed: notNeeded, ...intentTotals},
    worker: {attempts: workerRows.length, ...workerTotals},
    usage_basis: 'openclaw_input_excludes_cache', accounting_complete: localComplete,
    call_counts_basis: 'intent_operations;local_worker_attempts_reported_separately'},
    native: {attempts: nativeRows.length, counters: nativeCounters, ...nativeTotals,
      usage_basis: 'native_input_includes_cache', accounting_complete: nativeComplete},
    plan: {model_calls: planKnown ? 0 : null, basis: planKnown ? snapshot.plan_provenance : 'unobserved'},
    total_tokens_observed: total, accounting_complete: complete && total !== null,
    issues, quota_savings: 'not_measured', cash_cost: 'not_measured',
    wall_time: 'not_summed_overlapping_operations', native_calls_basis: 'executor_attempts_not_physical_provider_requests'};
}
