import {createHash} from 'node:crypto';
import {constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, readFileSync} from 'node:fs';
import {isAbsolute, resolve, join, dirname, basename} from 'node:path';
import {stableJSON} from './joint-route-selector.mjs';
import {normalizeRoutingOutcome} from './routing-outcome.mjs';

// Read-only bridge, NOT a new store, checker, task owner or adoption decision.
// The producer names receipts with an independent UUID, not its attempt UUID.
// Follow ONLY the existing result.native_receipt direct leaf; never scan.
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const REQUIRED = ['schema', 'task_id', 'node_id', 'attempt_id', 'candidate_id', 'configuration_sha256',
  'selected_config', 'status', 'dispatch_stage', 'side_effects', 'execution_verified', 'task_verified', 'task_quality', 'parity_state'];
const OPTIONAL = ['acknowledged_config', 'observed_config', 'output', 'native_receipt', 'usage', 'error',
  'native_summary', 'handback', 'repair_source', 'native_turn_terminated', 'operational_quality', 'staged_writer', 'configured_input_observation'];
const CONFIG = ['surface', 'transport', 'account_id', 'model', 'effort', 'tools', 'scope', 'permission_profile',
  'quota_pool', 'allowed_paths', 'configuration_sha256'];
const IDENTITY = ['task_id', 'node_id', 'attempt_id', 'candidate_id', 'request_sha256', 'source_fingerprint',
  'policy_sha256', 'configuration_sha256', 'quality_contract_sha256'];
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(x));
const exact = (x, names) => plain(x) && Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x, k));
const hash = x => typeof x === 'string' && HASH.test(x);
const id = x => typeof x === 'string' && ID.test(x);
const count = x => Number.isSafeInteger(x) && x >= 0;
const digest = x => createHash('sha256').update(x).digest('hex');
const objectSHA = x => digest(stableJSON(x));
const copy = x => JSON.parse(JSON.stringify(x));
const freeze = x => { if (x && typeof x === 'object') { for (const v of Object.values(x)) freeze(v); Object.freeze(x); } return x; };
function need(value, reason) { if (!value) throw Object.assign(new Error(reason), {code: reason}); }

// JSON.parse is used only after a bounded key walk rejects duplicate keys
// (including escaped equivalents). No file/model contents are evaluated.
function parseReceipt(raw) {
  const parsed = JSON.parse(raw); let at = 0, nodes = 0;
  const ws = () => { while (at < raw.length && /[\t\r\n ]/.test(raw[at])) at++; };
  function string() {
    const start = at++;
    while (at < raw.length) {
      const ch = raw[at++]; if (ch === '\\') at++;
      else if (ch === '"') return JSON.parse(raw.slice(start, at));
    }
    throw Error('receipt_json_invalid');
  }
  function value(depth) {
    need(++nodes <= 50000 && depth <= 32, 'receipt_json_unbounded'); ws();
    if (raw[at] === '"') { string(); return; }
    if (raw[at] === '{') {
      at++; ws(); const seen = new Set(); if (raw[at] === '}') { at++; return; }
      for (;;) {
        ws(); const key = string(); need(!seen.has(key), 'receipt_duplicate_key'); seen.add(key);
        ws(); at++; value(depth + 1); ws(); if (raw[at++] === '}') return;
      }
    }
    if (raw[at] === '[') {
      at++; ws(); if (raw[at] === ']') { at++; return; }
      for (;;) { value(depth + 1); ws(); if (raw[at++] === ']') return; }
    }
    while (at < raw.length && !/[\s,\]}]/.test(raw[at])) at++;
  }
  value(0); return parsed;
}
function directory(path) {
  need(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path, 'capture_directory_not_canonical');
  const st = lstatSync(path, {bigint: true});
  need(st.isDirectory() && !st.isSymbolicLink() && st.uid === BigInt(process.getuid()) &&
    (st.mode & 0o077n) === 0n, 'capture_directory_not_private');
  return st;
}
const sameInode = (a, b) => a.dev === b.dev && a.ino === b.ino;
function readExactReceipt(stateDir, path) {
  need(typeof stateDir === 'string' && typeof path === 'string' && !stateDir.includes('\0') && !path.includes('\0'), 'capture_path_invalid');
  const parent = directory(stateDir), root = join(stateDir, 'native-receipts'), receiptDirectory = directory(root);
  need(isAbsolute(path) && resolve(path) === path && dirname(path) === root &&
    basename(path).endsWith('.json') && UUID.test(basename(path).slice(0, -5)), 'capture_receipt_pointer_invalid');
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd, {bigint: true});
    need(before.isFile() && before.uid === BigInt(process.getuid()) && before.nlink === 1n &&
      (before.mode & 0o077n) === 0n && (before.mode & 0o7111n) === 0n &&
      before.size > 1n && before.size <= BigInt(MAX_RECEIPT_BYTES), 'capture_receipt_custody_invalid');
    need(realpathSync(path) === path && sameInode(lstatSync(path, {bigint: true}), before), 'capture_receipt_path_changed');
    const bytes = readFileSync(fd), after = fstatSync(fd, {bigint: true});
    need(bytes.length === Number(before.size) && ['dev', 'ino', 'size', 'mode', 'uid', 'nlink', 'mtimeNs', 'ctimeNs'].every(k => before[k] === after[k]) &&
      sameInode(lstatSync(path, {bigint: true}), after) && sameInode(directory(stateDir), parent) &&
      sameInode(directory(root), receiptDirectory) && realpathSync(path) === path, 'capture_receipt_changed_during_read');
    const raw = bytes.toString('utf8'); need(Buffer.from(raw, 'utf8').equals(bytes), 'capture_receipt_utf8_invalid');
    return {receipt: parseReceipt(raw), sha256: digest(bytes), bytes: bytes.length, path};
  } finally { if (fd !== undefined) closeSync(fd); }
}
function nativeSummaryIDs(result, config) {
  const empty = {session_id: null, turn_id: null, basis: 'native_summary_identity_unavailable'};
  if (typeof result.native_summary !== 'string' || Buffer.byteLength(result.native_summary) > MAX_RECEIPT_BYTES) return empty;
  let summary; try { summary = parseReceipt(result.native_summary); } catch { return empty; }
  if (!plain(summary) || !Array.isArray(summary.steps) || summary.steps.length !== 1) return empty;
  const step = summary.steps[0], provider = config.surface === 'local' ? 'local' : config.quota_pool === 'openai_codex' ? 'codex' : 'claude';
  if (!plain(step) || step.provider !== provider || step.model !== config.model || step.effort !== config.effort) return empty;
  return {session_id: id(step.session_id) ? step.session_id : null,
    turn_id: id(step.native_record?.turn_id) ? step.native_record.turn_id : null,
    basis: 'explicit_single_matching_native_summary_step_adapter_report_not_provider_readback'};
}

// A byte/hash preparation observation is deliberately separate from P7 features,
// token counts, provider inclusion, task success and execution authority. This
// validator never invokes a predictor or changes any selection/adoption result.
const INPUT_OBSERVATION_KEYS = ['schema', 'kind', 'task_id', 'node_id', 'attempt_id', 'candidate_id',
  'request_sha256', 'source_fingerprint', 'original_source_fingerprint', 'policy_sha256', 'policy_source_sha256', 'configuration_sha256',
  'selected_config_sha256', 'renderer_id', 'harness_sha256', 'native_binary_sha256', 'catalog_sha256',
  'catalog_observed_at_ms', 'prepared_at_ms', 'catalog_basis', 'channel', 'session_state', 'delegated_input',
  'provider_input', 'instructions', 'base_instructions', 'execution_configuration_sha256', 'execution_configuration_basis', 'input_coverage', 'capture_state',
  'backend_inclusion_verified', 'quality_certified', 'execution_authorized', 'tokenizer_id', 'input_tokens',
  'context_window_tokens', 'family', 'capacity_upper_bound'];
export function validateConfiguredInputObservation(x, {identity, selectedConfig, now_ms = null} = {}) {
  need(exact(x, INPUT_OBSERVATION_KEYS) && x.schema === 1 && x.kind === 'native_configured_input_observation_v1' &&
    x.renderer_id === 'rcc_delegated_envelope_provider_prompt_native_channels_v1' &&
    x.input_coverage === 'os1_explicit_channels_only_provider_hidden_defaults_unobserved' &&
    x.execution_configuration_basis === (x.channel === 'codex_developer' ? 'codex_app_server_overrides_only' : 'claude_cli_final_arguments_only') &&
    x.capture_state === 'prepared_before_native_turn' && x.backend_inclusion_verified === false &&
    x.quality_certified === false && x.execution_authorized === false &&
    x.catalog_basis === 'selected_provider_inventory_before_authorization_not_core_candidate_catalog' &&
    ['new', 'resumed'].includes(x.session_state) &&
    ['request_sha256', 'source_fingerprint', 'original_source_fingerprint', 'policy_sha256', 'policy_source_sha256', 'configuration_sha256',
      'selected_config_sha256', 'harness_sha256', 'native_binary_sha256', 'catalog_sha256',
      'execution_configuration_sha256'].every(k => hash(x[k])) &&
    ['task_id', 'node_id', 'attempt_id', 'candidate_id'].every(k => id(x[k])) &&
    ['tokenizer_id', 'input_tokens', 'context_window_tokens', 'family', 'capacity_upper_bound'].every(k => x[k] === null) &&
    count(x.catalog_observed_at_ms) && count(x.prepared_at_ms) && x.catalog_observed_at_ms <= x.prepared_at_ms &&
    (now_ms === null || count(now_ms) && x.prepared_at_ms <= now_ms), 'capture_configured_input_invalid');
  const bytes = v => exact(v, ['sha256', 'utf8_bytes']) && hash(v.sha256) && count(v.utf8_bytes) &&
    v.utf8_bytes > 0 && v.utf8_bytes <= 8388608;
  need(['delegated_input', 'provider_input', 'instructions'].every(k => bytes(x[k])) &&
    (x.base_instructions === null || bytes(x.base_instructions)), 'capture_configured_input_bytes_invalid');
  need(exact(selectedConfig, CONFIG) && x.configuration_sha256 === selectedConfig.configuration_sha256 &&
    x.selected_config_sha256 === objectSHA(selectedConfig) && x.channel ===
      (selectedConfig.transport === 'codex_app_server' ? 'codex_developer' :
       selectedConfig.transport === 'claude_cli' ? 'claude_append_system' : 'unsupported') &&
    ['task_id', 'node_id', 'attempt_id', 'candidate_id', 'request_sha256', 'source_fingerprint', 'policy_sha256',
      'configuration_sha256'].every(k => x[k] === identity?.[k]) &&
    (identity.policy_source_sha256 === undefined || x.original_source_fingerprint === (identity.core_routing?.original_source_fingerprint ?? identity.source_fingerprint)) &&
    (identity.policy_source_sha256 === undefined || identity.policy_source_sha256 === x.policy_source_sha256),
    'capture_configured_input_binding_invalid');
  return freeze(copy(x));
}

/** Read one exact private adapter receipt and project it. Parent source/policy
 * hashes remain frozen CORE-supplied identity, NOT newly discovered file facts.
 * Initial checker/usage/adoption are unknown; no filename, summary, metric name
 * or adapter task_verified claim certifies correctness, parity or zero cost. */
export function captureRoutingOutcome({stateDir, identity, selectedConfig, result, attemptState,
  origin = 'unknown', now_ms} = {}) {
  let capture = {adapter_receipt_path: null, adapter_receipt_sha256: null, adapter_receipt_bytes: null,
    record_basis: 'native_adapter_execution_record_not_provider_jsonl', provider_native_record_read: false};
  const unknowns = ['checker_not_independently_validated', 'usage_attempt_and_child_basis_not_proven',
    'final_adoption_not_supplied', 'provider_instruction_inclusion_not_observed'];
  const quarantine = reason => freeze({schema: 1, status: 'quarantined', reason, record: null, capture,
    unknown_fields: [...unknowns], execution_authorized: false, task_adoption_changed: false});
  try {
    need(count(now_ms) && exact(identity, IDENTITY) && ['task_id', 'node_id', 'candidate_id'].every(k => id(identity[k])) &&
      UUID.test(identity.attempt_id ?? '') && ['request_sha256', 'source_fingerprint', 'policy_sha256', 'configuration_sha256'].every(k => hash(identity[k])) &&
      (identity.quality_contract_sha256 === null || hash(identity.quality_contract_sha256)) && id(attemptState) &&
      ['actual_execution', 'synthetic_fixture', 'forecast', 'unknown'].includes(origin), 'capture_host_identity_invalid');
    need(exact(selectedConfig, CONFIG) && selectedConfig.configuration_sha256 === identity.configuration_sha256,
      'capture_selected_config_invalid');
    need(plain(result) && REQUIRED.every(k => Object.hasOwn(result, k)) &&
      Object.keys(result).every(k => [...REQUIRED, ...OPTIONAL].includes(k)) && result.schema === 1 &&
      ['task_id', 'node_id', 'attempt_id', 'candidate_id', 'configuration_sha256'].every(k => result[k] === identity[k]) &&
      stableJSON(result.selected_config) === stableJSON(selectedConfig), 'capture_result_identity_or_selected_mismatch');
    for (const key of ['acknowledged_config', 'observed_config'])
      need(result[key] == null || stableJSON(result[key]) === stableJSON(selectedConfig), 'capture_ack_or_observed_mismatch');
    const read = readExactReceipt(stateDir, result.native_receipt);
    capture = {...capture, adapter_receipt_path: read.path, adapter_receipt_sha256: read.sha256,
      adapter_receipt_bytes: read.bytes, frozen_identity_basis: 'core_supplied_request_source_policy_plus_receipt_task_node_attempt_config'};
    need(stableJSON(read.receipt) === stableJSON(result), 'capture_receipt_result_mismatch');
    // Same exact task/attempt receipt read; no sidecar scan or stale protected
    // host-record substitution. Kept in Core's durable routing_outcome capture.
    capture.configured_input_observation = read.receipt.configured_input_observation == null ? null :
      validateConfiguredInputObservation(read.receipt.configured_input_observation, {identity, selectedConfig, now_ms});
    capture.configured_input_basis = capture.configured_input_observation === null ? 'not_captured' :
      'actual_adapter_prepared_hashes_not_provider_inclusion_or_token_measurement';
    const ids = nativeSummaryIDs(read.receipt, selectedConfig);
    capture.native_identity_basis = 'adapter_execution_envelope_attempt_id_not_provider_execution_id';
    capture.summary_identity_basis = ids.basis;
    capture.reported_usage_present = read.receipt.usage != null;
    capture.reported_usage_sha256 = read.receipt.usage == null ? null : objectSHA(read.receipt.usage);
    capture.reported_checker_coverage = ['full', 'partial'].includes(read.receipt.operational_quality?.coverage) ? read.receipt.operational_quality.coverage : null;
    const output = read.receipt.output;
    need(output == null || typeof output === 'string', 'capture_output_invalid');
    // A selected/requested surface alone does not prove a backend ran. Use
    // actual adapter ACK/observed metadata or the explicit matching summary.
    const providerObserved = read.receipt.observed_config != null || read.receipt.acknowledged_config != null ||
      ids.basis !== 'native_summary_identity_unavailable';
    const provider = !providerObserved ? 'unknown' : selectedConfig.surface === 'local' ? 'local' : ['codex', 'gpt-chat'].includes(selectedConfig.surface) ?
      'openai' : ['claude', 'claude-chat'].includes(selectedConfig.surface) ? 'anthropic' : 'unknown';
    const error = read.receipt.error;
    const source = {schema: 1, origin, identity: copy(identity),
      provenance: {source_kind: 'core_settled_attempt', source_sha256: read.sha256, host_validated: true, observed_at_ms: now_ms},
      configs: {selected: copy(read.receipt.selected_config), acknowledged: read.receipt.acknowledged_config == null ? null : copy(read.receipt.acknowledged_config),
        observed: read.receipt.observed_config == null ? null : copy(read.receipt.observed_config)},
      native: {provider, execution_id: identity.attempt_id, session_id: ids.session_id, turn_id: ids.turn_id,
        record_sha256: read.sha256, turn_terminated: typeof read.receipt.native_turn_terminated === 'boolean' ? read.receipt.native_turn_terminated : null},
      result: {status: read.receipt.status, attempt_state: attemptState, dispatch_stage: read.receipt.dispatch_stage,
        side_effects: read.receipt.side_effects, execution_verified: read.receipt.execution_verified, task_verified: read.receipt.task_verified,
        task_quality: read.receipt.task_quality, parity_state: read.receipt.parity_state,
        output_sha256: output == null ? null : digest(Buffer.from(output, 'utf8')), artifact_sha256: null,
        error_code: id(error) ? error : null, failure_category: error == null ? null : 'unknown', http_status: null},
      adoption: {state: 'unknown', scope: 'node', final_for_scope: null}, checker: null, usage: null};
    const record = normalizeRoutingOutcome(source);
    need(record.status === 'normalized', 'capture_normalized_record_rejected');
    need(Buffer.byteLength(JSON.stringify(record)) + 1 <= 8192, 'capture_normalized_record_oversize');
    if (record.observed_config === null) unknowns.push('actual_observed_config_unavailable');
    if (provider === 'unknown') unknowns.push('actual_provider_origin_unavailable');
    if (ids.session_id === null) unknowns.push('provider_session_id_unavailable');
    if (ids.turn_id === null) unknowns.push('provider_turn_id_unavailable');
    return freeze({schema: 1, status: 'captured', reason: 'exact_private_adapter_receipt_consistency_verified', record, capture,
      unknown_fields: [...unknowns], execution_authorized: false, task_adoption_changed: false});
  } catch (error) {
    const code = error?.code ?? error?.message;
    return quarantine(typeof code === 'string' && /^[a-z_]+$/.test(code) ? code : 'capture_source_unavailable_or_invalid');
  }
}
