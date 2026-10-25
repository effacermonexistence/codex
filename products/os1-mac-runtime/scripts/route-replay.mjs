#!/usr/bin/env node
/** Offline routing replay (D1). Reads only the files it is named, never
 * writes them, never calls a provider, a model or the network. The only
 * bundled module it imports is the pure resource reducer (resource-usage.mjs),
 * which only `usage` calls, as a parity cross-check.
 *
 *   node scripts/route-replay.mjs delivery --ledger <routing-ledger.jsonl> [--ledger <path>...]
 *       [--snapshots <checkpointed rcc-runtime.sqlite copy>] [--include-legacy] [--out <new file>]
 *   node scripts/route-replay.mjs usage --ledger <routing-ledger.jsonl> [--ledger <path>...]
 *       [--snapshots <checkpointed rcc-runtime.sqlite copy>] [--out <new file>]
 *
 * `delivery` (K9) audits `delivery_policy_valid` (§2.2): every delivered
 * child's basis is zero_model:*, reference, reference_escalated or
 * owner_words (owner tuples are counted separately), or certified:<source>
 * with that source's pass on THIS attempt (I2). Policy enforcement only:
 * never accepted_B, quality parity or a quota saving.
 *  - Without --snapshots a certified attempt counts as delivered unless its
 *    state proves its output never reached the owner (NON_DELIVERY_STATES,
 *    fail closed: a new state FAILs, it never passes).
 *  - With --snapshots (a checkpointed copy: no -wal/-shm beside it; opened
 *    immutable and read-only) a child is delivered when its task's result
 *    holds its output: a completed or returned_unverified result, or the
 *    partial result a held, failed or cancelled task retains (deliveryOf);
 *    that attempt's record must exist and be policy-valid. The per-attempt
 *    rules above still apply.
 *  - Records without delivery_basis (older builds) are legacy: counted,
 *    never proof; --include-legacy fails on an unprovable lower-tuple one.
 *
 * `usage` (K16) reports M1 (§4.2): the observed tokens of every attempt per
 * subscription pool, uncached / cache read / cache write / output, and per
 * task and pool whether that consumption is complete. Recorded tokens only:
 * never a price (M2), a counterfactual (M3), a quota-window observation (M4)
 * or a saving; quota-replay.py reads this report for those.
 *  - Usage comes from the ledger record. An attempt is known only when its
 *    usage is a full, valid counter set, or when the executor typed it
 *    verified_not_dispatched with null usage (verified zero: it did no work).
 *    Anything else is unknown and never filled with a zero, a mean or a max.
 *  - A task is complete in a pool only with --snapshots: the attempt
 *    population is the task's attempt_history, and an attempt missing from
 *    the ledger is unknown. The ledger alone cannot see an attempt whose
 *    record was never written, so without snapshots nothing is complete.
 *  - Completeness is per subscription pool; the local pool 'none' is reported
 *    apart. Delivery (task result) is a reporting dimension only: an
 *    undelivered task's consumption is counted like any other.
 *  - The runtime reducer (summarizeTaskResources) is a parity check: a task
 *    it finds natively incomplete is incomplete here too, except for the one
 *    documented difference (verified_not_dispatched counted as zero).
 *
 * Output: JSON with sorted keys on stdout, or into --out, a new file (O_EXCL,
 * 0600). Exit codes (shared with every subcommand and quota-replay.py):
 * 0 PASS (usage: COMPLETE), 1 FAIL, 2 NO_EVIDENCE / INCOMPLETE / NOT_RUN,
 * 64 usage or input error.
 */
import {createHash} from 'node:crypto';
import {closeSync, constants, existsSync, fstatSync, openSync, readSync, realpathSync, writeSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {summarizeTaskResources} from '../Resources/openclaw-os1-bridge/resource-usage.mjs';

export const EXIT = Object.freeze({pass: 0, fail: 1, no_evidence: 2, usage: 64});
const MAX_INPUT_BYTES = 268_435_456;
const CLAIM_BOUNDARY = 'policy enforcement only; not accepted_B, quality parity or quota saving';
// Attempt states whose output provably never reached the owner: discarded
// descents, no dispatch, uncertain effects (the task never returns a result),
// an interrupted or stopped attempt, a cancelled or failed child, a discarded
// staged writer and an owner-collection control unknown (the whole task holds
// without a result). 'held' and 'operational_checker_held' are NOT here: a
// held child's output can be retained inside a partial result.
export const NON_DELIVERY_STATES = Object.freeze(new Set(['ladder_not_returned', 'ladder_verifier_failed',
  'staged_writer_held', 'verified_not_dispatched', 'effects_uncertain', 'interrupted', 'settled_after_stop',
  'cancelled', 'failed', 'owner_collection_control_unverified']));
const CERTIFIED_BASIS = /^certified:(contract|exact|verifier:[A-Za-z0-9_-]{1,128}|class:[A-Za-z0-9_-]{1,128})$/;
const REFERENCE_BASES = new Set(['reference', 'reference_escalated', 'owner_words']);
const ZERO_MODEL_BASIS = /^zero_model:[a-z0-9_]{1,64}$/;
const LABEL_SOURCES = new Set(['exact', 'contract', 'verifier']);
const LABEL_OUTCOMES = new Set(['pass', 'fail', 'not_returned']);
const DELIVERED_TASK_STATES = new Set(['completed', 'returned_unverified']);
const LOWER_TUPLE_KINDS = new Set(['tier', 'execution_only', 'ladder']);

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Canonical JSON: sorted keys, two-space indent. */
export function canonicalJSON(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) : plain(item) ?
    Object.fromEntries(Object.keys(item).sort().map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(value), null, 2);
}
function inputError(message) { return Object.assign(new Error(message), {code: 'route_replay_input'}); }

/** One routing-ledger generation: its records and the lines it could not read
 * (not JSON, not a plain schema-1 record with string ids, a torn tail without
 * its newline, invalid UTF-8). Only the final newline's empty tail is skipped. */
export function parseLedgerText(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { return {records: [], lines: 1, unreadable: 1}; }
  const parts = text.split('\n');
  const records = [];
  let lines = 0, unreadable = 0;
  parts.forEach((line, index) => {
    if (index === parts.length - 1 && line === '') return;
    lines++;
    if (index === parts.length - 1) { unreadable++; return; } // torn: no trailing newline
    let record = null;
    try { record = JSON.parse(line); } catch { /* counted below */ }
    if (!plain(record) || record.schema !== 1 || typeof record.attempt_id !== 'string' ||
        typeof record.task_id !== 'string' || typeof record.node_id !== 'string') { unreadable++; return; }
    records.push(record);
  });
  return {records, lines, unreadable};
}

/** The route kind an attempt actually ran as: a named route's host kind. */
function ranAs(record) {
  return typeof record.host_route_kind === 'string' ? record.host_route_kind : record.route_kind;
}
/** The §2.2 rules for one K9 record. `delivered`: whether its output may have
 * reached the owner. Returns the rules it breaks. */
function basisViolations(record, delivered) {
  const rules = [];
  const basis = record.delivery_basis;
  const tier = ranAs(record) === 'tier';
  const nullChecks = record.check_id == null && record.check_outcome == null && record.check_label == null;
  if (typeof basis === 'string' && CERTIFIED_BASIS.test(basis)) {
    if (!tier || !plain(record.ladder) || record.escalated !== false) rules.push('certified_basis_route_mismatch');
    if (delivered && record.check_outcome !== 'pass') rules.push('certified_delivery_without_pass');
    const label = record.check_label;
    const source = basis.slice('certified:'.length).split(':')[0];
    if (label != null && !(plain(label) && Object.keys(label).sort().join() === 'check_id,outcome,score_space,soundness' &&
        label.score_space === 'check_acceptance_v1' && label.soundness === 'sound_full' &&
        typeof record.check_id === 'string' && label.check_id === record.check_id &&
        LABEL_OUTCOMES.has(record.check_outcome) && label.outcome === record.check_outcome && LABEL_SOURCES.has(source)))
      rules.push('check_label_invalid');
  } else if (typeof basis === 'string' && (REFERENCE_BASES.has(basis) || ZERO_MODEL_BASIS.test(basis))) {
    if (tier) rules.push('tier_route_without_certified_basis');
    if ((basis === 'reference_escalated') !== (record.escalated === true)) rules.push('escalation_basis_mismatch');
    if (!nullChecks) rules.push('check_fields_on_uncertified_basis');
  } else {
    // certified:unrecorded, unbound, unclassified or anything unknown.
    if (tier) rules.push('tier_route_without_certified_basis');
    if (delivered) rules.push('unadmitted_delivery');
  }
  return rules;
}
function legacyUnprovable(record, delivered) {
  return delivered && LOWER_TUPLE_KINDS.has(ranAs(record)) && record.verifier_outcome !== 'pass';
}

/** K9: audit `delivery_policy_valid` over routing-ledger generations
 * ([{path, bytes|text}]) and, optionally, task snapshots ([{task_id,
 * snapshot}] where snapshot is the stored JSON text or object). Pure. */
export function auditDeliveryPolicy({ledgers, snapshots = null, includeLegacy = false}) {
  if (!Array.isArray(ledgers) || ledgers.length === 0) throw inputError('at least one --ledger is required');
  const inputs = {ledgers: [], snapshots: null};
  const byAttempt = new Map(), seen = new Map(), conflicts = new Set();
  let lines = 0, unreadable = 0, duplicates = 0;
  for (const {path = null, bytes, text} of ledgers) {
    const raw = bytes ?? Buffer.from(String(text ?? ''), 'utf8');
    const parsed = parseLedgerText(raw);
    inputs.ledgers.push({path, sha256: sha256(raw), bytes: raw.length, lines: parsed.lines,
      unreadable_lines: parsed.unreadable});
    lines += parsed.lines; unreadable += parsed.unreadable;
    for (const record of parsed.records) {
      const form = JSON.stringify(record);
      if (seen.has(record.attempt_id)) {
        if (seen.get(record.attempt_id) === form) duplicates++;
        else conflicts.add(record.attempt_id);
        continue;
      }
      seen.set(record.attempt_id, form);
      byAttempt.set(record.attempt_id, record);
    }
  }
  for (const id of conflicts) byAttempt.delete(id);

  const violations = new Map();
  const violate = (rule, record, extra = {}) => {
    const key = rule + '\0' + (record?.attempt_id ?? extra.task_id + '/' + extra.node_id);
    if (!violations.has(key)) violations.set(key, {rule, attempt_id: record?.attempt_id ?? null,
      task_id: record?.task_id ?? extra.task_id ?? null, node_id: record?.node_id ?? extra.node_id ?? null,
      delivery_basis: record?.delivery_basis ?? null, check_outcome: record?.check_outcome ?? null,
      attempt_state: record?.attempt_state ?? null, ...extra});
  };
  const byBasis = {};
  const legacy = {records: 0, unprovable_lower_tuple_delivery: 0, explicit_exact_inferred: 0,
    note: 'explicit_exact_inferred is an inference from route_kind explicit_route with host_route_kind tier, never proof'};
  let k9 = 0;
  const tasksWithRecords = new Set();
  for (const record of byAttempt.values()) {
    tasksWithRecords.add(record.task_id);
    const delivered = !NON_DELIVERY_STATES.has(record.attempt_state);
    if (!Object.hasOwn(record, 'delivery_basis')) {
      legacy.records++;
      if (legacyUnprovable(record, delivered)) {
        legacy.unprovable_lower_tuple_delivery++;
        if (record.route_kind === 'explicit_route' && record.host_route_kind === 'tier') legacy.explicit_exact_inferred++;
      }
      continue;
    }
    k9++;
    const basis = typeof record.delivery_basis === 'string' ? record.delivery_basis : 'invalid';
    byBasis[basis] ??= {attempts: 0, possibly_delivered: 0};
    byBasis[basis].attempts++;
    if (delivered) byBasis[basis].possibly_delivered++;
    for (const rule of basisViolations(record, delivered)) violate(rule, record);
  }

  // --snapshots: the delivered population, from task results.
  let delivery = null, incompleteSnapshots = 0, missingRecords = 0;
  if (snapshots !== null) {
    delivery = {tasks_read: 0, unreadable_snapshots: 0, delivered_tasks: 0, delivered_children: 0,
      by_basis: {}, missing_attempt_records: 0, tasks_outside_ledger_window: 0, legacy_delivered: 0,
      legacy_unprovable_delivered: 0};
    for (const row of snapshots) {
      let snapshot = row?.snapshot;
      if (typeof snapshot === 'string') { try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; } }
      const taskID = plain(snapshot) && plain(snapshot.task) ? snapshot.task.task_id : null;
      if (typeof taskID !== 'string' || !Array.isArray(snapshot.children) || taskID !== row.task_id) {
        delivery.unreadable_snapshots++; incompleteSnapshots++; continue;
      }
      delivery.tasks_read++;
      // A partial result (a held, failed or cancelled task) delivers too:
      // every child output it may hold is audited (fail closed).
      if (deliveryOf(snapshot) !== 'delivered') continue;
      delivery.delivered_tasks++;
      let outside = false;
      for (const child of snapshot.children) {
        if (!plain(child) || typeof child.output !== 'string') continue;
        delivery.delivered_children++;
        const count = basis => { delivery.by_basis[basis] = (delivery.by_basis[basis] ?? 0) + 1; };
        const attemptless = child.attempt_id == null && (child.attempt_history ?? []).length === 0;
        if (attemptless) {
          if (snapshot.plan_provenance === 'deterministic_no_model') count('zero_model:deterministic_no_model');
          else violate('delivered_without_attempt', null, {task_id: taskID, node_id: child.id ?? null});
          continue;
        }
        const record = typeof child.attempt_id === 'string' ? byAttempt.get(child.attempt_id) : undefined;
        if (!record) {
          if (conflicts.has(child.attempt_id) || tasksWithRecords.has(taskID)) {
            delivery.missing_attempt_records++; missingRecords++;
          } else outside = true;
          continue;
        }
        if (record.task_id !== taskID || record.node_id !== child.id) {
          violate('delivered_attempt_identity_mismatch', record, {task_id: taskID, node_id: child.id ?? null});
          continue;
        }
        if (!Object.hasOwn(record, 'delivery_basis')) {
          delivery.legacy_delivered++;
          if (legacyUnprovable(record, true)) delivery.legacy_unprovable_delivered++;
          continue;
        }
        count(typeof record.delivery_basis === 'string' ? record.delivery_basis : 'invalid');
        for (const rule of basisViolations(record, true)) violate(rule, record);
      }
      if (outside) delivery.tasks_outside_ledger_window++;
    }
  }

  const list = [...violations.values()].sort((a, b) =>
    (a.rule + (a.attempt_id ?? '') + a.task_id).localeCompare(b.rule + (b.attempt_id ?? '') + b.task_id));
  const legacyFail = includeLegacy && (legacy.unprovable_lower_tuple_delivery > 0 ||
    (delivery?.legacy_unprovable_delivered ?? 0) > 0);
  const incomplete = unreadable > 0 || conflicts.size > 0 || incompleteSnapshots > 0 || missingRecords > 0;
  const verdict = list.length > 0 || legacyFail ? 'FAIL' : incomplete ? 'INCOMPLETE' : k9 === 0 ? 'NO_EVIDENCE' : 'PASS';
  if (snapshots !== null) inputs.snapshots = {tasks: snapshots.length};
  return {schema: 1, kind: 'os1_route_replay_delivery', check: 'delivery_policy_valid', verdict,
    exit_code: verdict === 'PASS' ? EXIT.pass : verdict === 'FAIL' ? EXIT.fail : EXIT.no_evidence,
    delivery_population: snapshots === null ? 'attempt_state_fail_closed' : 'task_result_and_attempt_state',
    include_legacy: includeLegacy === true, inputs,
    counts: {lines, records: byAttempt.size + conflicts.size, unreadable_lines: unreadable,
      duplicate_identical: duplicates, identity_conflicts: conflicts.size, k9_records: k9, legacy_records: legacy.records},
    by_basis: byBasis,
    owner_words: byBasis.owner_words ?? {attempts: 0, possibly_delivered: 0},
    delivery, violations: list, legacy, claim_boundary: CLAIM_BOUNDARY};
}

// ---- K16 `usage`: M1 observed tokens per subscription pool (§4.2). ----
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const POOL_ID = /^[a-z0-9_]{1,64}$/;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$/;
const STATE_ID = /^[a-z0-9_]{1,64}$/;
export const LOCAL_POOL = 'none';
const UNKNOWN_POOL = 'unknown';
const METRICS = Object.freeze({native: 'native_usage_observation', local: 'local_model_usage_observation'});
const COUNTERS = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'];
// The usage keys the runtime reducer reads (resource-usage.mjs NATIVE_KEYS,
// metric, cost_units). Any other key is an unknown basis, never ignored: a
// later child-receipt or usage-incomplete marker on an attempt lands here.
const USAGE_KEYS = new Set([...COUNTERS, 'reasoning_tokens', 'provider_calls', 'duration_ms', 'metric', 'cost_units']);
const OPTIONAL_COUNTS = ['reasoning_tokens', 'provider_calls', 'duration_ms'];
const UNDELIVERED_TASK_STATES = new Set(['held', 'failed', 'cancelled', 'effects_uncertain']);
// A held, failed or cancelled task whose result retains outputs (a partial).
const PARTIAL_TASK_STATES = new Set(['held', 'failed', 'cancelled']);
const ZERO_MODEL_EVENTS = new Set(['deterministic_arithmetic', 'local_checkin']);
// The one documented difference from the runtime reducer, which counts a
// verified_not_dispatched attempt's null usage as unknown.
const EXPECTED_PARITY_DIFFERENCE = 'verified_not_dispatched_zero';
const USAGE_CLAIM = 'M1 recorded tokens only: not a price (M2), a counterfactual (M3), a quota-window observation (M4) or a saving';
const isCount = x => Number.isSafeInteger(x) && x >= 0;
const tuple = () => ({uncached: 0, cache_read: 0, cache_write: 0, output: 0});
function addInto(into, value) {
  for (const key of Object.keys(into)) {
    into[key] += value[key];
    if (!Number.isSafeInteger(into[key])) throw inputError('usage counters overflow');
  }
  return into;
}
const unknown = reason => ({state: 'unknown', reason});
const modelOf = record => typeof record.model === 'string' && MODEL_ID.test(record.model) ? record.model : 'unrecorded';
/** The fields that decide an attempt's accounting; identical copies of a
 * record across generations agree on them. */
const accountingForm = record => canonicalJSON({task_id: record.task_id, node_id: record.node_id,
  quota_pool: record.quota_pool, attempt_state: record.attempt_state ?? null, usage: record.usage ?? null});

/** One attempt's recorded usage (its ledger record): observed with its token
 * tuple (reasoning tokens are inside output and never added), verified_zero,
 * or unknown with a reason. Never a filled-in value. Pure. */
export function usageState(record) {
  if (!Object.hasOwn(record, 'usage')) return unknown('usage_missing');
  const usage = record.usage;
  // The executor typed it not dispatched: it did no work (chargedAttempts).
  if (usage === null)
    return record.attempt_state === 'verified_not_dispatched' ? {state: 'verified_zero'} : unknown('usage_null');
  if (!plain(usage) || Object.keys(usage).some(key => !USAGE_KEYS.has(key))) return unknown('usage_invalid');
  const local = record.quota_pool === LOCAL_POOL;
  if (usage.metric !== (local ? METRICS.local : METRICS.native)) return unknown('usage_basis_unknown');
  if (OPTIONAL_COUNTS.some(key => usage[key] != null && !isCount(usage[key])) || usage.cost_units != null &&
      !(typeof usage.cost_units === 'number' && Number.isFinite(usage.cost_units) && usage.cost_units >= 0))
    return unknown('usage_invalid');
  if (COUNTERS.some(key => usage[key] == null)) return unknown('usage_partial');
  if (COUNTERS.some(key => !isCount(usage[key]))) return unknown('usage_invalid');
  const {input_tokens: input, output_tokens: output, cache_read_tokens: read, cache_write_tokens: write} = usage;
  // A local worker's input excludes its cache counters; a native one's includes them.
  if (local) return {state: 'observed', tuple: {uncached: input, cache_read: read, cache_write: write, output}};
  if (read + write > input) return unknown('usage_invalid');
  return {state: 'observed', tuple: {uncached: input - read - write, cache_read: read, cache_write: write, output}};
}
/** What became of a task's result: delivered (a completed or
 * returned_unverified result, or a result a held, failed or cancelled task
 * retains as a partial), undelivered, or not_final. `delivery`'s snapshot
 * population; a reporting dimension only in `usage`. */
function deliveryOf(snapshot) {
  if (plain(snapshot.result) && (DELIVERED_TASK_STATES.has(snapshot.state) || PARTIAL_TASK_STATES.has(snapshot.state)))
    return 'delivered';
  return DELIVERED_TASK_STATES.has(snapshot.state) || UNDELIVERED_TASK_STATES.has(snapshot.state) ? 'undelivered' : 'not_final';
}
function parseSnapshot(row) {
  let snapshot = row?.snapshot;
  if (typeof snapshot === 'string') { try { snapshot = JSON.parse(snapshot); } catch { snapshot = null; } }
  const taskID = plain(snapshot) && plain(snapshot.task) ? snapshot.task.task_id : null;
  return typeof taskID === 'string' && taskID === row?.task_id && Array.isArray(snapshot.children) ? snapshot : null;
}
function snapshotPool(entry) {
  const pool = plain(entry.ledger) ? entry.ledger.quota_pool :
    plain(entry.selected_config) ? entry.selected_config.quota_pool : null;
  return typeof pool === 'string' && POOL_ID.test(pool) ? pool : UNKNOWN_POOL;
}

/** K16: M1 over routing-ledger generations ([{path, bytes|text}], rotated
 * first) and, optionally, task snapshots ([{task_id, snapshot}]) with their
 * zero-model event kinds ([{task_id, kind}]). Pure. The report holds ids,
 * enums and counters only, never request, instruction or output text, and
 * no saving or quota figure. */
export function replayUsage({ledgers, snapshots = null, events = null}) {
  if (!Array.isArray(ledgers) || ledgers.length === 0) throw inputError('at least one --ledger is required');
  const inputs = {ledgers: [], snapshots: snapshots === null ? null : {tasks: snapshots.length}};
  const copies = new Map();
  let lines = 0, unreadable = 0, duplicates = 0;
  for (const {path = null, bytes, text} of ledgers) {
    const raw = bytes ?? Buffer.from(String(text ?? ''), 'utf8');
    const parsed = parseLedgerText(raw);
    let bad = parsed.unreadable;
    for (const record of parsed.records) {
      if (!UUID.test(record.attempt_id) || typeof record.quota_pool !== 'string' || !POOL_ID.test(record.quota_pool)) {
        bad++; continue;
      }
      if (!copies.has(record.attempt_id)) copies.set(record.attempt_id, []);
      copies.get(record.attempt_id).push(record);
    }
    inputs.ledgers.push({path, sha256: sha256(raw), bytes: raw.length, lines: parsed.lines, unreadable_lines: bad});
    lines += parsed.lines; unreadable += bad;
  }
  // The same attempt in two generations: identical copies count once; copies
  // that disagree on its accounting make it unknown wherever each claims it.
  const records = new Map(), conflicts = new Map();
  for (const [id, list] of copies) {
    if (new Set(list.map(accountingForm)).size === 1) { records.set(id, list[0]); duplicates += list.length - 1; }
    else conflicts.set(id, list);
  }
  const tasks = new Map();
  const taskOf = id => {
    if (!tasks.has(id)) tasks.set(id, {task_id: id, attempts: new Map(), reasons: new Set(), snapshot: null,
      listed: null, state: null, delivery: 'unknown', zero_model: null, parity: null, runtime: null});
    return tasks.get(id);
  };
  const fromRecord = (record, usage = usageState(record)) =>
    ({attempt_id: record.attempt_id, pool: record.quota_pool, model: modelOf(record), usage, ledger: true});
  for (const [id, record] of records) taskOf(record.task_id).attempts.set(id, fromRecord(record));
  for (const [id, list] of conflicts)
    for (const record of list) taskOf(record.task_id).attempts.set(id + '\0' + record.quota_pool,
      fromRecord(record, unknown('identity_conflict')));

  // --snapshots: the attempt population of each task.
  const zeroEvents = new Set();
  for (const row of events ?? []) if (typeof row?.task_id === 'string' && ZERO_MODEL_EVENTS.has(row.kind)) zeroEvents.add(row.task_id);
  const zero = {deterministic_no_model: 0, no_attempt_dispatched: 0, zero_model_event_with_attempts: 0};
  let tasksRead = 0, unreadableSnapshots = 0;
  for (const row of snapshots ?? []) {
    const snapshot = parseSnapshot(row);
    if (!snapshot || tasks.get(snapshot.task.task_id)?.snapshot) {
      unreadableSnapshots++;
      if (typeof row?.task_id === 'string') taskOf(row.task_id).reasons.add('snapshot_unreadable');
      continue;
    }
    tasksRead++;
    const task = taskOf(snapshot.task.task_id);
    task.snapshot = snapshot;
    task.state = typeof snapshot.state === 'string' && STATE_ID.test(snapshot.state) ? snapshot.state : 'invalid';
    task.delivery = deliveryOf(snapshot);
    task.listed = new Set();
    for (const child of snapshot.children) {
      if (!plain(child) || !Array.isArray(child.attempt_history)) { task.reasons.add('snapshot_attempt_history_invalid'); continue; }
      // Every dispatch counts an attempt and lists it together; fewer listed
      // than counted means a dispatched attempt the snapshot lost.
      if (isCount(child.attempts) && child.attempts > child.attempt_history.length)
        task.reasons.add('snapshot_attempt_history_short');
      for (const entry of child.attempt_history) {
        if (!plain(entry) || typeof entry.attempt_id !== 'string' || !UUID.test(entry.attempt_id)) {
          task.reasons.add('snapshot_attempt_identity_invalid'); continue;
        }
        const id = entry.attempt_id;
        if (task.listed.has(id)) continue;
        task.listed.add(id);
        if (conflicts.has(id)) {
          // Copies that disagree are unknown wherever each claims it; when
          // none names this task and node, this task lists it too: unknown here.
          if (!conflicts.get(id).some(record => record.task_id === task.task_id && record.node_id === child.id))
            task.attempts.set(id, {attempt_id: id, pool: snapshotPool(entry), model: 'unrecorded',
              usage: unknown('identity_conflict'), ledger: false});
          continue;
        }
        const record = records.get(id);
        if (!record) {
          task.attempts.set(id, {attempt_id: id, pool: snapshotPool(entry), model: 'unrecorded',
            usage: unknown('ledger_record_missing'), ledger: false});
          continue;
        }
        if (record.task_id !== task.task_id || record.node_id !== child.id) {
          task.attempts.set(id, fromRecord(record, unknown('identity_conflict')));
          const owner = taskOf(record.task_id).attempts.get(id);
          if (owner) owner.usage = unknown('identity_conflict');
          continue;
        }
        if (entry.usage != null && canonicalJSON(entry.usage) !== canonicalJSON(record.usage ?? null))
          task.attempts.get(id).usage = unknown('usage_record_conflict');
      }
    }
    if (task.listed.size === 0 && task.attempts.size === 0 && task.reasons.size === 0) {
      task.zero_model = zeroEvents.has(task.task_id) || snapshot.plan_provenance === 'deterministic_no_model' ?
        'deterministic_no_model' : 'no_attempt_dispatched';
      zero[task.zero_model]++;
    } else if (zeroEvents.has(task.task_id)) zero.zero_model_event_with_attempts++;
    try {
      const summary = summarizeTaskResources(snapshot);
      task.runtime = {complete: summary.native.accounting_complete === true, unknown: summary.native.usage_unknown,
        issues: summary.issues.filter(issue => issue.startsWith('native_')).length};
    } catch { task.runtime = null; }
  }

  // Per task and pool: complete iff every attempt is observed or verified_zero.
  const taskPools = task => {
    const pools = new Map();
    const at = pool => {
      if (!pools.has(pool)) pools.set(pool, {attempts: {observed: 0, verified_zero: 0, unknown: 0}, consumption: tuple(),
        by_model: {}, reasons: new Set()});
      return pools.get(pool);
    };
    for (const attempt of task.attempts.values()) {
      const row = at(attempt.pool);
      row.attempts[attempt.usage.state]++;
      if (attempt.usage.state === 'observed') {
        addInto(row.consumption, attempt.usage.tuple);
        addInto(row.by_model[attempt.model] ??= tuple(), attempt.usage.tuple);
      } else if (attempt.usage.state === 'unknown') row.reasons.add(attempt.usage.reason);
      // A recorded attempt the task's snapshot does not list: the two copies
      // are not of one moment, so the population is not proven.
      if (task.listed && attempt.ledger && !task.listed.has(attempt.attempt_id)) row.reasons.add('snapshot_attempt_missing');
    }
    const taskReasons = new Set(task.reasons);
    if (!task.snapshot && !taskReasons.has('snapshot_unreadable'))
      taskReasons.add(snapshots === null ? 'attempt_coverage_unverified' : 'task_snapshot_missing');
    if (taskReasons.size > 0 && pools.size === 0) at(UNKNOWN_POOL);
    for (const row of pools.values()) for (const reason of taskReasons) row.reasons.add(reason);
    if (pools.has(UNKNOWN_POOL))
      for (const [pool, row] of pools) if (pool !== UNKNOWN_POOL && pool !== LOCAL_POOL) row.reasons.add('attempt_pool_unknown');
    return pools;
  };
  const parity = {basis: 'summarizeTaskResources(snapshot).native.accounting_complete', tasks_checked: 0, agree: 0,
    disagreements: {}, expected_difference: EXPECTED_PARITY_DIFFERENCE};
  const disagree = reason => { parity.disagreements[reason] = (parity.disagreements[reason] ?? 0) + 1; return reason; };
  const pools = {}, byDelivery = {}, attempts = {observed: 0, verified_zero: 0, unknown: 0}, rows = [];
  const poolSummary = pool => pools[pool] ??= {subscription: pool !== LOCAL_POOL,
    usage_basis: pool === LOCAL_POOL ? 'local_input_excludes_cache' : pool === UNKNOWN_POOL ? 'unknown' : 'native_input_includes_cache',
    tasks: 0, complete_tasks: 0, incomplete_tasks: 0, attempts: {observed: 0, verified_zero: 0, unknown: 0},
    consumption_complete_tasks: tuple(), by_model_complete_tasks: {}, known_subtotal_incomplete_tasks: tuple(),
    incomplete_reasons: {}};
  for (const task of [...tasks.values()].sort((a, b) => a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0)) {
    const own = taskPools(task);
    if (task.snapshot) {
      // Parity, then fail closed: native incompleteness the reducer finds
      // and this replay does not is incompleteness here too.
      parity.tasks_checked++;
      const ours = [...own].every(([pool, row]) => pool === LOCAL_POOL || row.reasons.size === 0);
      const zeros = [...task.attempts.values()].filter(a => a.pool !== LOCAL_POOL && a.usage.state === 'verified_zero').length;
      if (task.runtime === null) task.parity = disagree('runtime_reducer_error');
      else if (task.runtime.complete === ours) { task.parity = 'agree'; parity.agree++; }
      else if (!ours) task.parity = disagree('replay_stricter');
      else task.parity = disagree(task.runtime.issues === 0 && zeros > 0 && task.runtime.unknown === zeros ?
        EXPECTED_PARITY_DIFFERENCE : 'runtime_reducer_stricter');
      if (task.parity === 'runtime_reducer_error' || task.parity === 'runtime_reducer_stricter') {
        if (![...own.keys()].some(pool => pool !== LOCAL_POOL))
          own.set(UNKNOWN_POOL, {attempts: {observed: 0, verified_zero: 0, unknown: 0}, consumption: tuple(), by_model: {},
            reasons: new Set()});
        for (const [pool, row] of own) if (pool !== LOCAL_POOL) row.reasons.add('runtime_reducer_native_incomplete');
      }
    }
    const delivery = byDelivery[task.delivery] ??= {tasks: 0, by_state: {}, complete_tasks: 0, consumption: {}};
    delivery.tasks++;
    if (task.state !== null) delivery.by_state[task.state] = (delivery.by_state[task.state] ?? 0) + 1;
    let complete = true;
    const out = {};
    for (const [pool, row] of [...own].sort(([a], [b]) => a < b ? -1 : 1)) {
      const summary = poolSummary(pool);
      const poolComplete = row.reasons.size === 0;
      summary.tasks++;
      for (const state of Object.keys(attempts)) { summary.attempts[state] += row.attempts[state]; attempts[state] += row.attempts[state]; }
      if (poolComplete) {
        summary.complete_tasks++;
        addInto(summary.consumption_complete_tasks, row.consumption);
        for (const [model, value] of Object.entries(row.by_model)) addInto(summary.by_model_complete_tasks[model] ??= tuple(), value);
        addInto(delivery.consumption[pool] ??= tuple(), row.consumption);
      } else {
        summary.incomplete_tasks++;
        addInto(summary.known_subtotal_incomplete_tasks, row.consumption);
        for (const reason of row.reasons) summary.incomplete_reasons[reason] = (summary.incomplete_reasons[reason] ?? 0) + 1;
        if (pool !== LOCAL_POOL) complete = false;
      }
      out[pool] = {complete: poolComplete, attempts: row.attempts, consumption: row.consumption, by_model: row.by_model,
        incomplete_reasons: [...row.reasons].sort()};
    }
    if (complete) delivery.complete_tasks++;
    rows.push({task_id: task.task_id, coverage: task.snapshot ? 'snapshot' : 'ledger_only', delivery: task.delivery,
      task_state: task.state, zero_model: task.zero_model, parity: task.parity,
      runtime_native_accounting_complete: task.runtime?.complete ?? null, pools: out});
  }
  const subscriptionComplete = rows.every(row => Object.entries(row.pools).every(([pool, value]) => pool === LOCAL_POOL || value.complete));
  const accountingComplete = rows.length > 0 && unreadable === 0 && conflicts.size === 0 && unreadableSnapshots === 0 &&
    subscriptionComplete;
  const verdict = accountingComplete ? 'COMPLETE' :
    rows.length === 0 && unreadable === 0 && unreadableSnapshots === 0 ? 'NO_EVIDENCE' : 'INCOMPLETE';
  return {schema: 1, kind: 'os1_route_replay_usage', metric: 'M1_observed_tokens', label: 'recorded', verdict,
    exit_code: verdict === 'COMPLETE' ? EXIT.pass : EXIT.no_evidence,
    attempt_coverage: snapshots === null ? 'ledger_records_only' : 'snapshot_attempt_history',
    accounting_complete: accountingComplete,
    local_accounting_complete: pools[LOCAL_POOL] ? pools[LOCAL_POOL].incomplete_tasks === 0 : null,
    inputs, ledger: {lines, records: records.size + conflicts.size, unreadable_lines: unreadable,
      duplicate_identical: duplicates, identity_conflicts: conflicts.size},
    snapshots: snapshots === null ? null : {tasks_read: tasksRead, unreadable_snapshots: unreadableSnapshots,
      zero_model_events: events === null ? null : zeroEvents.size, zero_model: zero},
    zero_model_tasks: zero.deterministic_no_model + zero.no_attempt_dispatched, attempts, pools,
    by_delivery: byDelivery, tasks: rows, parity: snapshots === null ? null : parity, claim_boundary: USAGE_CLAIM};
}

// ---- Input custody: read-only, regular files, never a symlink. ----
function readInput(path) {
  if (typeof path !== 'string' || path === '') throw inputError('empty path');
  const full = resolve(path);
  let fd;
  try {
    fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd);
    if (!before.isFile()) throw inputError('not a regular file: ' + path);
    if (before.size > MAX_INPUT_BYTES) throw inputError('input too large: ' + path);
    const bytes = Buffer.alloc(before.size);
    let at = 0;
    while (at < bytes.length) {
      const n = readSync(fd, bytes, at, bytes.length - at, at);
      if (n <= 0) throw inputError('short read: ' + path);
      at += n;
    }
    const after = fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw inputError('input changed while read: ' + path);
    return {path, bytes};
  } catch (error) {
    if (error.code === 'route_replay_input') throw error;
    throw inputError(`cannot read ${path}: ${error.code ?? error.message}`);
  } finally { if (fd !== undefined) closeSync(fd); }
}
/** Task snapshots from a checkpointed copy of the Core's SQLite store: opened
 * immutable and read-only (no lock, no journal, no -shm is created). A file
 * with a -wal or -shm beside it may be a live store and is refused. With
 * `events`, also the zero-model event kinds per task (null for a store
 * without an events table). */
export async function readSnapshotsDB(path, {events = false} = {}) {
  const {bytes} = readInput(path);
  const full = resolve(path);
  for (const suffix of ['-wal', '-shm', '-journal'])
    if (existsSync(full + suffix))
      throw inputError(`${path}${suffix} exists: pass a checkpointed copy (sqlite3 DB ".backup COPY" or VACUUM INTO)`);
  const {DatabaseSync} = await import('node:sqlite');
  const url = pathToFileURL(full);
  url.search = '?immutable=1&mode=ro';
  let db;
  try {
    db = new DatabaseSync(url, {readOnly: true});
    const rows = db.prepare('SELECT task_id, snapshot FROM tasks ORDER BY task_id').all();
    let kinds = null;
    if (events && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='events'").get())
      kinds = db.prepare("SELECT task_id, kind FROM events WHERE kind IN ('deterministic_arithmetic','local_checkin') " +
        'ORDER BY seq').all().map(row => ({task_id: row.task_id, kind: row.kind}));
    return {sha256: sha256(bytes), rows: rows.map(row => ({task_id: row.task_id, snapshot: row.snapshot})), events: kinds};
  } catch (error) {
    throw inputError(`cannot read tasks from ${path}: ${error.message}`);
  } finally { db?.close(); }
}

function parseArguments(argv, spec) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    const kind = spec[name];
    if (!kind) throw inputError('unknown argument: ' + name);
    if (kind === 'flag') { options[name] = true; continue; }
    const value = argv[++index];
    if (value === undefined || value.startsWith('--')) throw inputError(name + ' needs a value');
    if (kind === 'many') (options[name] ??= []).push(value);
    else if (Object.hasOwn(options, name)) throw inputError(name + ' given twice');
    else options[name] = value;
  }
  return options;
}
/** Write the report: stdout, or a NEW file (O_EXCL, 0600, never a symlink). */
function emit(report, out) {
  const text = canonicalJSON(report) + '\n';
  if (out === undefined) { process.stdout.write(text); return; }
  let fd;
  try {
    fd = openSync(resolve(out), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) { throw inputError(`cannot create --out ${out}: ${error.code ?? error.message}`); }
  try { writeSync(fd, text); } finally { closeSync(fd); }
}

async function runDelivery(argv) {
  const options = parseArguments(argv, {'--ledger': 'many', '--snapshots': 'one', '--include-legacy': 'flag',
    '--out': 'one'});
  if (!options['--ledger']?.length) throw inputError('delivery needs --ledger <path>');
  const ledgers = options['--ledger'].map(readInput);
  let snapshots = null, snapshotsSHA = null;
  if (options['--snapshots'] !== undefined) {
    const read = await readSnapshotsDB(options['--snapshots']);
    snapshots = read.rows; snapshotsSHA = read.sha256;
  }
  const report = auditDeliveryPolicy({ledgers, snapshots, includeLegacy: options['--include-legacy'] === true});
  if (report.inputs.snapshots) Object.assign(report.inputs.snapshots, {path: options['--snapshots'], sha256: snapshotsSHA});
  emit(report, options['--out']);
  process.stderr.write(`route-replay delivery: ${report.verdict} (${report.violations.length} violations, ` +
    `${report.counts.k9_records} K9 records)\n`);
  return report.exit_code;
}

async function runUsage(argv) {
  const options = parseArguments(argv, {'--ledger': 'many', '--snapshots': 'one', '--out': 'one'});
  if (!options['--ledger']?.length) throw inputError('usage needs --ledger <path>');
  const ledgers = options['--ledger'].map(readInput);
  let snapshots = null, events = null, snapshotsSHA = null;
  if (options['--snapshots'] !== undefined)
    ({rows: snapshots, events, sha256: snapshotsSHA} = await readSnapshotsDB(options['--snapshots'], {events: true}));
  const report = replayUsage({ledgers, snapshots, events});
  if (report.inputs.snapshots) Object.assign(report.inputs.snapshots, {path: options['--snapshots'], sha256: snapshotsSHA});
  emit(report, options['--out']);
  const incomplete = Object.values(report.pools).reduce((n, pool) => n + (pool.subscription ? pool.incomplete_tasks : 0), 0);
  process.stderr.write(`route-replay usage: ${report.verdict} (${report.tasks.length} tasks, ` +
    `${incomplete} incomplete in a subscription pool)\n`);
  return report.exit_code;
}

// One CLI: explicit inputs, read-only, the same output and exit-code rules.
const SUBCOMMANDS = Object.freeze({delivery: runDelivery, usage: runUsage});
export async function main(argv) {
  const [subcommand, ...rest] = argv;
  try {
    if (!Object.hasOwn(SUBCOMMANDS, subcommand ?? ''))
      throw inputError(`usage: route-replay.mjs <${Object.keys(SUBCOMMANDS).join('|')}> [options]`);
    return await SUBCOMMANDS[subcommand](rest);
  } catch (error) {
    process.stderr.write(`route-replay: ${error.code === 'route_replay_input' ? error.message : 'internal error: ' +
      (error?.stack ?? error)}\n`);
    return EXIT.usage;
  }
}

const invoked = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (invoked) process.exitCode = await main(process.argv.slice(2));
