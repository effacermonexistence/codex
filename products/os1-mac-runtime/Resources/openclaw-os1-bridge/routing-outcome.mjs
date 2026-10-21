/** P3, pure host-owned settlement projection. No file, queue, store or calls.
 * The existing durable Core ledger remains the sole persistence owner.
 * Input is a host-prevalidated JSON source wrapper, not a model's assertion.
 * Hash/status checks below establish consistency, NOT receipt authenticity.
 * The caller must actually validate native and checker source artifacts.
 *
 * normalizeRoutingOutcome(source) -> normalized | quarantined.
 * mergeRoutingOutcomes(state|null, normalizedRecord) -> new immutable-data state.
 * Same task/node/attempt has ONE identity regardless of payload/config hash.
 * Repeated bytes deduplicate; contradictory variants permanently quarantine.
 * Raw request/output/path text is intentionally absent from the projection.
 */
import {createHash} from 'node:crypto';

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const CONFIG_KEYS = ['surface', 'transport', 'account_id', 'model', 'effort', 'tools',
  'scope', 'permission_profile', 'quota_pool', 'allowed_paths', 'configuration_sha256'];
const COUNTERS = ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cache_read_tokens',
  'cache_write_tokens', 'provider_calls', 'duration_ms'];
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, keys) => plain(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const hash = x => typeof x === 'string' && HASH.test(x);
const id = x => typeof x === 'string' && ID.test(x);
const text = x => typeof x === 'string' && x.length > 0 && x.length <= 4096 && !/[\x00-\x1f\x7f]/.test(x);
const count = x => Number.isSafeInteger(x) && x >= 0;
const nullableCount = x => x === null || count(x);
const nullableID = x => x === null || id(x);
const nullableHash = x => x === null || hash(x);
const nullableBool = x => x === null || typeof x === 'boolean';
const strings = x => Array.isArray(x) && x.length <= 128 && x.every(text) && new Set(x).size === x.length;
const allowed = (x, values) => values.includes(x);
const copy = x => JSON.parse(JSON.stringify(x));
function need(ok, code) { if (!ok) throw Error(code); }
function stable(value) {
  const seen = new Set(); let nodes = 0;
  function walk(x, depth) {
    need(++nodes <= 50_000 && depth <= 24, 'outcome_json_unbounded');
    if (x === null || typeof x === 'string' || typeof x === 'boolean' || typeof x === 'number' && Number.isFinite(x)) return JSON.stringify(x);
    need((plain(x) || Array.isArray(x)) && !seen.has(x), 'outcome_json_invalid');
    if (Array.isArray(x)) need(x.length <= 4096 && Object.keys(x).length === x.length &&
      x.every((_, i) => Object.hasOwn(x, i)), 'outcome_json_invalid');
    seen.add(x);
    const result = Array.isArray(x) ? '[' + x.map(v => walk(v, depth + 1)).join(',') + ']' :
      '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + walk(x[k], depth + 1)).join(',') + '}';
    seen.delete(x); return result;
  }
  return walk(value, 0);
}
const digest = x => createHash('sha256').update(stable(x)).digest('hex');
function add(xs) { const n = xs.reduce((a, b) => a + b, 0); need(count(n), 'usage_overflow'); return n; }
const allSum = xs => xs.every(count) ? add(xs) : null;

function config(c) {
  need(exact(c, CONFIG_KEYS) && ['surface', 'transport', 'account_id', 'model', 'effort', 'quota_pool'].every(k => id(c[k])) &&
    allowed(c.scope, ['read_only', 'workspace_write']) && c.permission_profile === c.scope &&
    strings(c.tools) && strings(c.allowed_paths) && hash(c.configuration_sha256), 'outcome_config_invalid');
  return {config_sha256: digest(c), configuration_sha256: c.configuration_sha256,
    surface: c.surface, transport: c.transport, account_id: c.account_id, model: c.model,
    effort: c.effort, scope: c.scope, permission_profile: c.permission_profile, quota_pool: c.quota_pool,
    tools_sha256: digest(c.tools), allowed_paths_sha256: digest(c.allowed_paths)};
}
function identity(x) {
  need(exact(x, ['task_id', 'node_id', 'attempt_id', 'candidate_id', 'request_sha256',
    'source_fingerprint', 'policy_sha256', 'configuration_sha256', 'quality_contract_sha256']) &&
    ['task_id', 'node_id', 'candidate_id'].every(k => id(x[k])) && typeof x.attempt_id === 'string' && UUID.test(x.attempt_id) &&
    ['request_sha256', 'source_fingerprint', 'policy_sha256', 'configuration_sha256'].every(k => hash(x[k])) &&
    nullableHash(x.quality_contract_sha256), 'outcome_identity_invalid');
  return copy(x);
}
function outcomeID(x) { return digest({task_id: x.task_id, node_id: x.node_id, attempt_id: x.attempt_id.toLowerCase()}); }

function usageRow(x) {
  need(exact(x, ['execution_id', 'parent_execution_id', 'basis', 'input_basis', 'output_basis',
    'source_receipt_sha256', ...COUNTERS]) && id(x.execution_id) && nullableID(x.parent_execution_id) &&
    allowed(x.basis, ['attempt_total', 'thread_cumulative', 'response_total', 'unknown']) &&
    allowed(x.input_basis, ['includes_cache', 'excludes_cache', 'unknown']) &&
    allowed(x.output_basis, ['includes_reasoning', 'excludes_reasoning', 'unknown']) &&
    hash(x.source_receipt_sha256) && COUNTERS.every(k => nullableCount(x[k])), 'usage_row_invalid');
  return counterProjection(x);
}
function counterProjection(x) {
  need(allowed(x.basis, ['attempt_total', 'thread_cumulative', 'response_total', 'unknown']) &&
    allowed(x.input_basis, ['includes_cache', 'excludes_cache', 'unknown']) &&
    allowed(x.output_basis, ['includes_reasoning', 'excludes_reasoning', 'unknown']) &&
    COUNTERS.every(k => nullableCount(x[k])), 'usage_row_invalid');
  if (x.input_basis === 'includes_cache' && count(x.input_tokens)) {
    if (count(x.cache_read_tokens)) need(x.cache_read_tokens <= x.input_tokens, 'usage_cache_exceeds_input');
    if (count(x.cache_write_tokens)) need(x.cache_write_tokens <= x.input_tokens, 'usage_cache_exceeds_input');
    if (count(x.cache_read_tokens) && count(x.cache_write_tokens))
      need(add([x.cache_read_tokens, x.cache_write_tokens]) <= x.input_tokens, 'usage_cache_exceeds_input');
  }
  if (x.output_basis === 'includes_reasoning' && count(x.output_tokens) && count(x.reasoning_tokens))
    need(x.reasoning_tokens <= x.output_tokens, 'usage_reasoning_exceeds_output');
  const input = x.input_basis === 'includes_cache' ? x.input_tokens : x.input_basis === 'excludes_cache' ?
    allSum([x.input_tokens, x.cache_read_tokens, x.cache_write_tokens]) : null;
  const output = x.output_basis === 'includes_reasoning' ? x.output_tokens : x.output_basis === 'excludes_reasoning' ?
    allSum([x.output_tokens, x.reasoning_tokens]) : null;
  const scoped = x.basis === 'attempt_total';
  return {input_tokens_observed: scoped ? input : null, output_tokens_observed: scoped ? output : null,
    total_tokens_observed: scoped ? allSum([input, output]) : null,
    provider_calls_observed: scoped ? x.provider_calls : null,
    duration_ms_observed: x.duration_ms, basis: x.basis, input_basis: x.input_basis, output_basis: x.output_basis,
    raw_counters: Object.fromEntries(COUNTERS.map(k => [k, x[k]]))};
}
function normalizeUsage(u, native) {
  const empty = {observed: false, total_tokens_observed: null, known_tokens_subtotal: null,
    provider_calls_observed: null, accounting_complete: false, parent: null,
    child_accounting: {count: null, coverage: 'unknown', known_tokens_subtotal: null, unknown_rows: null},
    parent_scope: 'unknown', provenance_sha256: null, quota_consumption: 'unknown', cash_cost: 'unknown',
    duration_ms_observed: null, duration_basis: 'not_summed_overlapping_children'};
  if (u === null) return empty;
  need(exact(u, ['schema', 'metric', 'source_receipt_sha256', 'parent_scope', 'children_coverage', 'parent', 'children']) &&
    u.schema === 1 && allowed(u.metric, ['native_usage_observation', 'local_model_usage_observation']) &&
    hash(u.source_receipt_sha256) && allowed(u.parent_scope, ['includes_children', 'excludes_children', 'unknown']) &&
    allowed(u.children_coverage, ['complete_disjoint', 'partial_disjoint', 'unknown']) &&
    (u.children === null ? u.children_coverage === 'unknown' : Array.isArray(u.children) && u.children.length <= 64), 'usage_shape_invalid');
  need((native.provider === 'local') === (u.metric === 'local_model_usage_observation'), 'usage_metric_provider_mismatch');
  need(native.execution_id !== null, 'usage_native_identity_unknown');
  if (u.parent !== null) need(u.parent.execution_id === native.execution_id && u.parent.parent_execution_id === null,
    'usage_parent_identity_mismatch');
  const p = u.parent === null ? null : usageRow(u.parent), byID = new Map();
  for (const c of u.children ?? []) {
    const parsed = usageRow(c);
    need(c.execution_id !== native.execution_id && c.parent_execution_id === native.execution_id, 'usage_child_parent_mismatch');
    const prior = byID.get(c.execution_id);
    if (prior) need(stable(prior.source) === stable(c), 'usage_child_identity_conflict');
    else byID.set(c.execution_id, {source: c, parsed});
  }
  const children = [...byID.values()].map(x => x.parsed), values = children.map(x => x.total_tokens_observed);
  const disjoint = u.children_coverage !== 'unknown', knownChildren = disjoint ? values.filter(count) : [],
    childSubtotal = disjoint ? add(knownChildren) : null;
  const childComplete = u.children !== null && u.children_coverage === 'complete_disjoint' && values.every(count);
  let total = null, calls = null, subtotal = null;
  if (u.parent_scope === 'includes_children') {
    total = p?.total_tokens_observed ?? null; calls = p?.provider_calls_observed ?? null;
    subtotal = total === null ? knownChildren.length ? childSubtotal : null : total;
    if (count(total) && childSubtotal !== null) need(childSubtotal <= total, 'usage_children_exceed_inclusive_parent');
  } else if (u.parent_scope === 'excludes_children') {
    subtotal = count(p?.total_tokens_observed) || knownChildren.length ?
      add([...(count(p?.total_tokens_observed) ? [p.total_tokens_observed] : []), ...(childSubtotal === null ? [] : [childSubtotal])]) : null;
    if (p && childComplete) {
      total = allSum([p.total_tokens_observed, ...values]);
      calls = allSum([p.provider_calls_observed, ...children.map(x => x.provider_calls_observed)]);
    }
  }
  return {observed: true, metric: u.metric, total_tokens_observed: total, known_tokens_subtotal: subtotal,
    provider_calls_observed: calls, accounting_complete: total !== null, parent: p,
    child_accounting: {count: u.children === null ? null : children.length, coverage: u.children_coverage,
      known_tokens_subtotal: u.children === null ? null : childSubtotal, unknown_rows: u.children === null ? null : values.filter(x => x === null).length},
    parent_scope: u.parent_scope, provenance_sha256: digest(u), quota_consumption: 'unknown', cash_cost: 'unknown',
    duration_ms_observed: p?.duration_ms_observed ?? null, duration_basis: 'not_summed_overlapping_children'};
}
function checker(c, source, observedConfig) {
  if (c === null) return {kind: 'unknown', coverage: 'unknown', assessment: 'unknown', source_validated: false,
    correctness_label: null, label_scope: source.adoption.scope, reason: 'checker_not_observed'};
  need(exact(c, ['kind', 'coverage', 'assessment', 'host_validated', 'scope', 'task_id', 'node_id', 'attempt_id',
    'configuration_sha256', 'config_sha256', 'contract_sha256', 'artifact_sha256', 'witness_sha256']) &&
    allowed(c.kind, ['complete_checker', 'partial_checker', 'model_critic', 'unknown']) &&
    allowed(c.coverage, ['full', 'partial', 'unknown']) && allowed(c.assessment, ['pass', 'fail', 'unknown', 'not_run']) &&
    typeof c.host_validated === 'boolean' && allowed(c.scope, ['node', 'task']) &&
    ['task_id', 'node_id', 'attempt_id'].every(k => c[k] === source.identity[k]) &&
    c.configuration_sha256 === source.identity.configuration_sha256 &&
    ['config_sha256', 'contract_sha256', 'artifact_sha256', 'witness_sha256'].every(k => hash(c[k])), 'checker_binding_invalid');
  const exactObserved = observedConfig !== null && c.config_sha256 === observedConfig.config_sha256;
  const s = source.result, adopted = source.adoption.state === 'adopted' && source.adoption.final_for_scope === true;
  const complete = c.kind === 'complete_checker' && c.coverage === 'full' && c.host_validated && exactObserved &&
    c.contract_sha256 === source.identity.quality_contract_sha256 && c.artifact_sha256 === s.artifact_sha256 &&
    c.scope === source.adoption.scope && source.native.turn_terminated === true &&
    source.native.execution_id !== null && source.native.provider !== 'unknown' &&
    source.native.record_sha256 !== null && s.dispatch_stage === 'dispatched' && s.execution_verified === true;
  const actual = source.origin === 'actual_execution';
  need(!(complete && c.assessment === 'fail' && s.task_verified === true), 'outcome_checker_task_claim_conflict');
  let value = null;
  if (actual && complete && c.assessment === 'fail') value = 0;
  if (actual && complete && c.assessment === 'pass' && s.status === 'succeeded' && s.attempt_state === 'completed' &&
      s.task_verified === true && s.task_quality === 'task_verified' && adopted) value = 1;
  return {kind: c.kind, coverage: c.coverage, assessment: c.assessment, source_validated: c.host_validated,
    correctness_label: value, label_scope: c.scope, witness_sha256: c.witness_sha256,
    contract_sha256: c.contract_sha256, artifact_sha256: c.artifact_sha256,
    reason: value === null ? 'no_complete_scoped_actual_adopted_quality_label' : 'host_validated_complete_scoped_checker'};
}

export function normalizeRoutingOutcome(source) {
  let key = null, sourceHash = null;
  const quarantine = reason => ({schema: 1, kind: 'routing_outcome_quarantine', outcome_id: key,
    status: 'quarantined', reason, correctness_label: null, learning_eligible: false,
    source_payload_sha256: sourceHash, execution_authorized: false, quality_certificate: false});
  try {
    const raw = stable(source); need(Buffer.byteLength(raw) <= 524288, 'outcome_source_unbounded');
    sourceHash = createHash('sha256').update(raw).digest('hex');
    need(exact(source, ['schema', 'origin', 'identity', 'provenance', 'configs', 'native', 'result', 'adoption', 'checker', 'usage']) &&
      source.schema === 1 && allowed(source.origin, ['actual_execution', 'synthetic_fixture', 'forecast', 'unknown']), 'outcome_source_shape');
    const ident = identity(source.identity); key = outcomeID(ident);
    const p = source.provenance;
    need(exact(p, ['source_kind', 'source_sha256', 'host_validated', 'observed_at_ms']) &&
      allowed(p.source_kind, ['core_settled_attempt', 'core_reconciled_attempt']) && hash(p.source_sha256) &&
      typeof p.host_validated === 'boolean' && count(p.observed_at_ms), 'outcome_provenance_invalid');
    need(exact(source.configs, ['selected', 'acknowledged', 'observed']), 'outcome_configs_shape');
    const selected = config(source.configs.selected), ack = source.configs.acknowledged === null ? null : config(source.configs.acknowledged),
      observed = source.configs.observed === null ? null : config(source.configs.observed);
    need(selected.configuration_sha256 === ident.configuration_sha256, 'outcome_selected_config_binding');
    need((ack === null || ack.config_sha256 === selected.config_sha256) &&
      (observed === null || observed.config_sha256 === selected.config_sha256), 'outcome_ack_or_observed_config_mismatch');
    const n = source.native;
    need(exact(n, ['provider', 'execution_id', 'session_id', 'turn_id', 'record_sha256', 'turn_terminated']) &&
      allowed(n.provider, ['openai', 'anthropic', 'local', 'unknown']) &&
      ['execution_id', 'session_id', 'turn_id'].every(k => nullableID(n[k])) &&
      nullableHash(n.record_sha256) && nullableBool(n.turn_terminated), 'outcome_native_identity_invalid');
    const expectedProvider = selected.surface === 'local' ? 'local' :
      ['codex', 'gpt-chat'].includes(selected.surface) ? 'openai' : ['claude', 'claude-chat'].includes(selected.surface) ? 'anthropic' : 'unknown';
    need(n.provider === expectedProvider || n.provider === 'unknown', 'outcome_native_provider_mismatch');
    const r = source.result;
    need(exact(r, ['status', 'attempt_state', 'dispatch_stage', 'side_effects', 'execution_verified', 'task_verified',
      'task_quality', 'parity_state', 'output_sha256', 'artifact_sha256', 'error_code', 'failure_category', 'http_status']) &&
      allowed(r.status, ['succeeded', 'failed', 'effects_uncertain', 'unknown']) && id(r.attempt_state) &&
      allowed(r.dispatch_stage, ['not_dispatched', 'dispatched', 'unknown']) &&
      allowed(r.side_effects, ['none', 'possible', 'confirmed', 'unknown']) &&
      nullableBool(r.execution_verified) && nullableBool(r.task_verified) &&
      allowed(r.task_quality, ['unverified', 'execution_only', 'task_verified', 'failed', 'unknown']) &&
      allowed(r.parity_state, ['unverified', 'reference_equivalent', 'reference_above', 'mismatch', 'unknown']) &&
      nullableHash(r.output_sha256) && nullableHash(r.artifact_sha256) && (r.error_code === null || id(r.error_code)) &&
      allowed(r.failure_category, [null, 'auth', 'quota', 'capability', 'transport', 'tool', 'model_result', 'checker', 'cancelled', 'unknown']) &&
      (r.http_status === null || Number.isInteger(r.http_status) && r.http_status >= 100 && r.http_status <= 599), 'outcome_result_invalid');
    need(r.execution_verified !== true || r.status === 'succeeded' && r.dispatch_stage === 'dispatched' &&
      ack !== null && n.record_sha256 !== null, 'outcome_execution_claim_unacknowledged');
    need(r.task_verified !== true || r.execution_verified === true && r.task_quality === 'task_verified', 'outcome_task_claim_inconsistent');
    need(exact(source.adoption, ['state', 'scope', 'final_for_scope']) &&
      allowed(source.adoption.state, ['adopted', 'not_adopted', 'held', 'rejected', 'cancelled', 'unknown']) &&
      allowed(source.adoption.scope, ['node', 'task']) && nullableBool(source.adoption.final_for_scope), 'outcome_adoption_invalid');
    const q = checker(source.checker, source, observed), usage = normalizeUsage(source.usage, n);
    // An unvalidated source cannot turn an otherwise consistent checker body
    // into measured success. Forecast/synthetic origins never enter labels.
    if (!p.host_validated || source.origin !== 'actual_execution') {
      q.correctness_label = null; q.reason = 'host_source_unvalidated_or_nonactual_origin';
    }
    const normalized = {schema: 1, kind: 'routing_outcome', outcome_id: key, status: 'normalized',
      origin: source.origin, identity: ident, provenance: copy(p),
      selected_config: selected, acknowledged_config: ack, observed_config: observed,
      native: copy(n), result: copy(r), adoption: copy(source.adoption), quality: q, usage,
      attribution: {actual_config: observed, basis: observed === null ? 'observed_config_unknown' : 'native_observed_config',
        final_adopted_config: source.adoption.state === 'adopted' && source.adoption.final_for_scope === true ? observed : null},
      learning: {correctness_label: q.correctness_label,
        eligible: p.host_validated && source.origin === 'actual_execution' && q.correctness_label !== null,
        use: source.origin === 'actual_execution' && p.host_validated ? 'source_bound_observation' : 'regression_or_unmeasured_only'},
      parity_state: 'unverified', parity_basis: 'executor_or_checker_is_not_reference_comparison',
      source_payload_sha256: sourceHash, execution_authorized: false, quality_certificate: false};
    const record = {...normalized, normalized_sha256: digest(normalized)};
    need(Buffer.byteLength(stable(record)) + 1 <= 8192, 'normalized_outcome_exceeds_existing_ledger_record');
    return record;
  } catch (error) { return quarantine(typeof error?.message === 'string' && /^[a-z_]+$/.test(error.message) ? error.message : 'outcome_source_invalid'); }
}

function validNormalizedUsage(u) {
  const keys = ['observed', 'total_tokens_observed', 'known_tokens_subtotal', 'provider_calls_observed',
    'accounting_complete', 'parent', 'child_accounting', 'parent_scope', 'provenance_sha256',
    'quota_consumption', 'cash_cost', 'duration_ms_observed', 'duration_basis'];
  if (!plain(u) || typeof u.observed !== 'boolean' || !exact(u, u.observed ? [...keys, 'metric'] : keys) ||
      !['total_tokens_observed', 'known_tokens_subtotal', 'provider_calls_observed', 'duration_ms_observed'].every(k => nullableCount(u[k])) ||
      typeof u.accounting_complete !== 'boolean' || u.accounting_complete !== (u.total_tokens_observed !== null) ||
      !allowed(u.parent_scope, ['includes_children', 'excludes_children', 'unknown']) ||
      u.quota_consumption !== 'unknown' || u.cash_cost !== 'unknown' ||
      u.duration_basis !== 'not_summed_overlapping_children') return false;
  const c = u.child_accounting, p = u.parent;
  if (!exact(c, ['count', 'coverage', 'known_tokens_subtotal', 'unknown_rows']) || !nullableCount(c.count) ||
      c.count !== null && c.count > 64 || !nullableCount(c.known_tokens_subtotal) || !nullableCount(c.unknown_rows) ||
      !allowed(c.coverage, ['complete_disjoint', 'partial_disjoint', 'unknown']) ||
      (c.count === null ? c.unknown_rows !== null || c.known_tokens_subtotal !== null || c.coverage !== 'unknown' :
        c.unknown_rows === null || c.unknown_rows > c.count) ||
      c.coverage === 'unknown' && c.known_tokens_subtotal !== null ||
      c.coverage !== 'unknown' && c.known_tokens_subtotal === null) return false;
  if (!u.observed) return u.total_tokens_observed === null && u.known_tokens_subtotal === null &&
    u.provider_calls_observed === null && u.parent === null && c.count === null && u.parent_scope === 'unknown' &&
    u.provenance_sha256 === null && u.duration_ms_observed === null;
  if (!allowed(u.metric, ['native_usage_observation', 'local_model_usage_observation']) || !hash(u.provenance_sha256)) return false;
  if (p !== null) {
    if (!exact(p, ['input_tokens_observed', 'output_tokens_observed', 'total_tokens_observed', 'provider_calls_observed',
      'duration_ms_observed', 'basis', 'input_basis', 'output_basis', 'raw_counters']) || !exact(p.raw_counters, COUNTERS)) return false;
    const expected = counterProjection({...p.raw_counters, basis: p.basis, input_basis: p.input_basis, output_basis: p.output_basis});
    if (stable(p) !== stable(expected)) return false;
  }
  if (u.duration_ms_observed !== (p?.duration_ms_observed ?? null)) return false;
  const childComplete = c.count !== null && c.coverage === 'complete_disjoint' && c.unknown_rows === 0;
  const hasKnownChild = c.count !== null && c.unknown_rows !== null && c.count > c.unknown_rows && c.known_tokens_subtotal !== null;
  if (u.parent_scope === 'includes_children') {
    if (u.total_tokens_observed !== (p?.total_tokens_observed ?? null) ||
        u.provider_calls_observed !== (p?.provider_calls_observed ?? null)) return false;
    const subtotal = u.total_tokens_observed ?? (hasKnownChild ? c.known_tokens_subtotal : null);
    if (u.known_tokens_subtotal !== subtotal || count(u.total_tokens_observed) &&
        count(c.known_tokens_subtotal) && c.known_tokens_subtotal > u.total_tokens_observed) return false;
  } else if (u.parent_scope === 'excludes_children') {
    const expected = p && childComplete ? allSum([p.total_tokens_observed, c.known_tokens_subtotal]) : null;
    const subtotal = count(p?.total_tokens_observed) || hasKnownChild ? add([
      ...(count(p?.total_tokens_observed) ? [p.total_tokens_observed] : []), ...(hasKnownChild ? [c.known_tokens_subtotal] : [])]) : null;
    if (u.total_tokens_observed !== expected || u.known_tokens_subtotal !== subtotal ||
        (!childComplete || p === null || p.provider_calls_observed === null) && u.provider_calls_observed !== null ||
        count(u.provider_calls_observed) && u.provider_calls_observed < (p?.provider_calls_observed ?? 0)) return false;
  } else if (u.total_tokens_observed !== null || u.known_tokens_subtotal !== null || u.provider_calls_observed !== null) return false;
  return true;
}
function validRecord(r) {
  if (!exact(r, ['schema', 'kind', 'outcome_id', 'status', 'origin', 'identity', 'provenance', 'selected_config',
    'acknowledged_config', 'observed_config', 'native', 'result', 'adoption', 'quality', 'usage', 'attribution',
    'learning', 'parity_state', 'parity_basis', 'source_payload_sha256', 'execution_authorized',
    'quality_certificate', 'normalized_sha256']) || r.schema !== 1 || r.kind !== 'routing_outcome' ||
      r.status !== 'normalized' || !hash(r.outcome_id) || !hash(r.normalized_sha256) || !hash(r.source_payload_sha256) ||
      r.execution_authorized !== false || r.quality_certificate !== false || r.parity_state !== 'unverified' ||
      !plain(r.provenance) || !plain(r.selected_config) || !plain(r.result) || !plain(r.adoption) ||
      !plain(r.quality) || !plain(r.usage) || !plain(r.learning) || !plain(r.native)) return false;
  const {normalized_sha256, ...body} = r;
  try {
    if (!validNormalizedUsage(r.usage)) return false;
    const label = r.learning.correctness_label, q = r.quality;
    if (![null, 0, 1].includes(label) || label !== q.correctness_label ||
        r.learning.eligible !== (label !== null && r.origin === 'actual_execution' && r.provenance.host_validated === true)) return false;
    if (label !== null) {
      if (q.kind !== 'complete_checker' || q.coverage !== 'full' || q.source_validated !== true ||
          q.contract_sha256 !== r.identity.quality_contract_sha256 || q.artifact_sha256 !== r.result.artifact_sha256 ||
          !hash(q.witness_sha256) || !plain(r.observed_config) || !plain(r.acknowledged_config) ||
          r.observed_config.config_sha256 !== r.selected_config.config_sha256 ||
          r.acknowledged_config.config_sha256 !== r.selected_config.config_sha256 ||
          r.native.turn_terminated !== true || r.native.provider === 'unknown' || !id(r.native.execution_id) ||
          !hash(r.native.record_sha256) || r.result.execution_verified !== true || r.result.dispatch_stage !== 'dispatched' ||
          q.label_scope !== r.adoption.scope) return false;
      if (label === 1 && (q.assessment !== 'pass' || r.result.status !== 'succeeded' ||
          r.result.attempt_state !== 'completed' || r.result.task_verified !== true || r.result.task_quality !== 'task_verified' ||
          r.adoption.state !== 'adopted' || r.adoption.final_for_scope !== true)) return false;
      if (label === 0 && (q.assessment !== 'fail' || r.result.task_verified === true)) return false;
    }
    return outcomeID(identity(r.identity)) === r.outcome_id && digest(body) === normalized_sha256;
  }
  catch { return false; }
}
/** Pure idempotent reduction for the EXISTING ledger owner. Quarantine is
 * sticky; callers must retain the whole returned state, not records alone.
 * Original raw artifacts remain outside this data reducer in host custody. */
export function mergeRoutingOutcomes(previous, incoming) {
  const state = previous === null ? {schema: 1, records: [], quarantined: []} : copy(previous);
  const validQuarantine = q => exact(q, ['outcome_id', 'reason', 'variant_sha256s']) && hash(q.outcome_id) &&
    q.reason === 'contradictory_same_identity' && Array.isArray(q.variant_sha256s) &&
    q.variant_sha256s.length >= 2 && q.variant_sha256s.length <= 64 && q.variant_sha256s.every(hash) &&
    new Set(q.variant_sha256s).size === q.variant_sha256s.length;
  need(exact(state, ['schema', 'records', 'quarantined']) && state.schema === 1 &&
    Array.isArray(state.records) && state.records.length <= 4096 && state.records.every(validRecord) &&
    new Set(state.records.map(r => r.outcome_id)).size === state.records.length &&
    Array.isArray(state.quarantined) && state.quarantined.length <= 4096 && state.quarantined.every(validQuarantine) &&
    new Set(state.quarantined.map(q => q.outcome_id)).size === state.quarantined.length &&
    !state.records.some(r => state.quarantined.some(q => q.outcome_id === r.outcome_id)), 'outcome_merge_state_invalid');
  need(validRecord(incoming), 'outcome_merge_record_invalid');
  const q = state.quarantined.find(x => x.outcome_id === incoming.outcome_id);
  if (q) {
    need(exact(q, ['outcome_id', 'reason', 'variant_sha256s']) && q.reason === 'contradictory_same_identity' &&
      Array.isArray(q.variant_sha256s) && q.variant_sha256s.every(hash), 'outcome_merge_quarantine_invalid');
    q.variant_sha256s = [...new Set([...q.variant_sha256s, incoming.normalized_sha256])].sort();
    need(q.variant_sha256s.length <= 64, 'outcome_merge_conflict_unbounded');
    return {state, disposition: 'quarantined', outcome_id: incoming.outcome_id};
  }
  const prior = state.records.find(r => r.outcome_id === incoming.outcome_id);
  if (!prior) { need(state.records.length < 4096, 'outcome_merge_full'); state.records.push(copy(incoming)); }
  else if (prior.normalized_sha256 !== incoming.normalized_sha256) {
    need(state.quarantined.length < 4096, 'outcome_merge_quarantine_full');
    state.records = state.records.filter(r => r.outcome_id !== incoming.outcome_id);
    state.quarantined.push({outcome_id: incoming.outcome_id, reason: 'contradictory_same_identity',
      variant_sha256s: [prior.normalized_sha256, incoming.normalized_sha256].sort()});
    state.quarantined.sort((a, b) => a.outcome_id < b.outcome_id ? -1 : a.outcome_id > b.outcome_id ? 1 : 0);
    return {state, disposition: 'quarantined', outcome_id: incoming.outcome_id};
  }
  state.records.sort((a, b) => a.outcome_id < b.outcome_id ? -1 : a.outcome_id > b.outcome_id ? 1 : 0);
  return {state, disposition: prior ? 'duplicate' : 'inserted', outcome_id: incoming.outcome_id};
}
