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
// Build 446 (DESIGN-5 §B, owner order 2026-10-29): ONE local model per
// machine. The Swift host decides it (LocalModelSelection: the larger model
// with >= 16 GiB of RAM when installed, else the smaller) and passes the name in the
// OS-1 bridge plugin's config (`local_model`); the plugin configures it here
// once. Core, the plugin and the planner read only this binding: no module
// writes a model name of its own. Unconfigured, there is no local model (every
// local row, completion and planner call fails closed). A persisted event
// from any earlier local model still validates by shape.
const LOCAL_MODEL_NAME = /^[a-z0-9][a-z0-9._-]{0,47}:[a-z0-9][a-z0-9._-]{0,15}$/;
export let LOCAL_MODEL = null;
export function configureLocalModel(name) {
  if (typeof name !== 'string' || !LOCAL_MODEL_NAME.test(name)) throw Error('local_model_config_invalid');
  LOCAL_MODEL = name;
  return name;
}
/** The configured model's provider id ("ollama/<name>"), or null. */
export function localModelID() { return LOCAL_MODEL === null ? null : 'ollama/' + LOCAL_MODEL; }
/** A local model id of any OS-1 local model (the persisted event shape). */
export function isLocalModelID(value) {
  return typeof value === 'string' && value.startsWith('ollama/') && LOCAL_MODEL_NAME.test(value.slice('ollama/'.length));
}
export function validateLocalUsageEvent(event) {
  const keys = ['id', 'stage', 'state', 'provider', 'model', 'usage', 'elapsed_ms', 'observed_at_ms', 'usage_basis', 'reason'];
  if (!plain(event) || Object.keys(event).length !== keys.length || keys.some(k => !Object.hasOwn(event, k)) ||
      typeof event.id !== 'string' || !UUID.test(event.id) || !['routing_intent', 'plan_proposal'].includes(event.stage) || !STATES.has(event.state) ||
      event.provider !== 'ollama' || !isLocalModelID(event.model) ||
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
  const localRows = [], intentRows = [], planRows = [];
  const stageCounts = Object.fromEntries(['routing_intent', 'plan_proposal'].map(k => [k,
    {operations: 0, calls_started: 0, calls_settled: 0, not_needed: 0}]));
  let planConflict = false;
  for (const rows of groups.values()) {
    const starts = rows.filter(r => r.state === 'started'), ends = rows.filter(r => r.state !== 'started');
    const stage = rows[0].stage, stageRow = stageCounts[stage];
    stageRow.operations++;
    const partition = stage === 'plan_proposal' ? planRows : intentRows;
    const conflicting = rows.some(r => r.stage !== stage || r.provider !== rows[0].provider ||
      r.model !== rows[0].model || r.usage_basis !== rows[0].usage_basis) ||
      starts.length > 1 || ends.length > 1 ||
      ends[0]?.state === 'not_needed' && starts.length > 0 ||
      starts.length && ends.length && starts[0].observed_at_ms > ends[0].observed_at_ms;
    if (conflicting) { callsStarted++; stageRow.calls_started++;
      if (rows.some(r => r.stage === 'plan_proposal')) planConflict = true;
      fail('local_operation_lifecycle_conflict'); localRows.push(null); partition.push(null); continue; }
    const end = ends[0];
    if (end?.state === 'not_needed') { notNeeded++; stageRow.not_needed++; continue; }
    // A terminal event implies one admitted operation even if its start is absent.
    callsStarted++; stageRow.calls_started++;
    if (end) { callsSettled++; stageRow.calls_settled++; localRows.push(end.usage); partition.push(end.usage); }
    else { startedOnly++; localRows.push(null); partition.push(null); }
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
  let localTotals, nativeTotals, localCounters, nativeCounters, intentTotals, planTotals, workerTotals;
  try {
    intentTotals = totals(intentRows, localTotal);
    planTotals = totals(planRows, localTotal);
    workerTotals = totals(workerRows, localTotal);
    localTotals = totals([...localRows, ...workerRows], localTotal);
    nativeTotals = totals(nativeRows, x => count(x?.input_tokens) && count(x?.output_tokens) ?
      sum([x.input_tokens, x.output_tokens]) : null);
    localCounters = counters([...localRows, ...workerRows], LOCAL_KEYS);
    nativeCounters = counters(nativeRows, NATIVE_KEYS);
  } catch {
    fail('resource_usage_overflow');
    intentTotals = planTotals = workerTotals = localTotals = nativeTotals = {total_tokens_observed: null, known_tokens_subtotal: null, usage_unknown: null};
    localCounters = nativeCounters = {};
  }
  const observedPlanner = stageCounts.plan_proposal.operations > 0;
  const legacyNoPlanner = ['host_exact_request', 'deterministic_no_model', 'local_reading_ask_back'].includes(snapshot?.plan_provenance);
  const planKnown = !planConflict && (observedPlanner || legacyNoPlanner);
  const planModelCalls = planKnown ? stageCounts.plan_proposal.calls_started : null;
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
    intent: {...stageCounts.routing_intent, ...intentTotals},
    planner: {...stageCounts.plan_proposal, ...planTotals},
    worker: {attempts: workerRows.length, ...workerTotals},
    usage_basis: 'openclaw_input_excludes_cache', accounting_complete: localComplete,
    call_counts_basis: observedPlanner ? 'intent_and_planner_operations;local_worker_attempts_reported_separately' : 'intent_operations;local_worker_attempts_reported_separately'},
    native: {attempts: nativeRows.length, counters: nativeCounters, ...nativeTotals,
      usage_basis: 'native_input_includes_cache', accounting_complete: nativeComplete},
    plan: {model_calls: planModelCalls, basis: planKnown ? (observedPlanner ? 'observed_plan_proposal_operations' : snapshot.plan_provenance) : 'unobserved'},
    total_tokens_observed: total, accounting_complete: complete && total !== null,
    issues, quota_savings: 'not_measured', cash_cost: 'not_measured',
    wall_time: 'not_summed_overlapping_operations', native_calls_basis: 'executor_attempts_not_physical_provider_requests'};
}
