import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

// RCC owns the task state. Model output supplies candidates, never authority.
// The pinned OpenClaw plugin must call this module from its long-lived Gateway
// service; importing it alone does not activate a route, tool, or provider.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const HASH = /^[a-f0-9]{64}$/;
const TERMINAL = new Set(['completed', 'returned_unverified', 'awaiting_install', 'held', 'failed', 'cancelled', 'effects_uncertain']);
const QUALITY = new Set(['policy_admitted', 'exact_domain_verified', 'reference_equivalent', 'reference_above', 'unverified', 'mismatch']);
const PARITY = new Set(['unverified', 'reference_equivalent', 'reference_above', 'mismatch']);
const TASK_QUALITY = new Set(['execution_only', 'task_verified', 'failed', 'unverified']);
const POOLS = new Set(['none', 'unknown', 'openai_codex', 'openai_chat', 'anthropic_shared']);
const SURFACES = new Set(['chatgpt', 'codex', 'claude', 'local', 'gpt-chat', 'claude-chat']);
const TRANSPORTS = new Set(['local', 'codex_app_server', 'claude_cli', 'chatgpt_service', 'claude_service']);
const SCOPES = new Set(['read_only', 'workspace_write']);
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']);
const AVAILABILITY = new Set(['available', 'unavailable', 'unknown']);
const DISPATCH = new Set(['not_dispatched', 'dispatched', 'unknown']);
const SIDE_EFFECTS = new Set(['none', 'possible', 'confirmed']);
const HANDBACK_KINDS = new Set(['full_access_required', 'os1_change_required', 'both']);
const HANDBACK_ADOPTION = new Set(['returned', 'rejected']);
const INSTALL_STATES = new Set(['staged', 'installed', 'failed', 'cancelled', 'effects_uncertain']);
const INSTALL_UNRESOLVED = new Set(['staged', 'failed', 'effects_uncertain']);
const STAGE_DENIALS = new Set(['source_authority_missing', 'source_changed_or_uncommitted',
  'staging_intent_busy', 'protected_gate_changed']);
const GIT_HEAD = /^[a-f0-9]{40}$/;
const MAX_TASK_BYTES = 1_000_000;
const MAX_CATALOG_BYTES = 1_000_000;
const MAX_OUTPUT_BYTES = 256_000;
const MAX_NATIVE_SUMMARY_BYTES = 512_000;
const MAX_PUBLIC_WIRE_BYTES = 8_388_608;
const MAX_USAGE_BYTES = 2_048;

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value, names) { return plain(value) && Object.keys(value).sort().join('|') === [...names].sort().join('|'); }
function assert(value, reason) { if (!value) throw new RCCRuntimeError(reason); }
function boundedText(value, max) { return typeof value === 'string' && value.length > 0 &&
  !value.includes('\0') && Buffer.byteLength(value) <= max; }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  assert(value === null || typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)), 'non_json_state');
  return JSON.stringify(value);
}
function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function immutable(value) { return structuredClone(value); }
function int(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function allowedPaths(paths) {
  return Array.isArray(paths) && paths.length <= 64 && paths.every(path =>
    boundedText(path, 512) && (path === '**' || (!isAbsolute(path) && !path.startsWith('~') &&
    path.split('/').every(part => part && part !== '.' && part !== '..') && !path.includes('\\'))));
}
function pathsOverlap(a, b) { return a === '**' || b === '**' || a === b || a.startsWith(b + '/') || b.startsWith(a + '/'); }
function within(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..' + '/') && path !== '..' && !isAbsolute(path));
}
function validUsage(value) {
  if (value == null) return true;
  if (!plain(value) || Buffer.byteLength(stable(value)) > MAX_USAGE_BYTES) return false;
  const numeric = new Set(['input_tokens', 'output_tokens', 'reasoning_tokens',
    'cache_read_tokens', 'cache_write_tokens', 'provider_calls', 'duration_ms']);
  return Object.entries(value).every(([key, item]) => item === null ||
    (numeric.has(key) ? int(item, 0, Number.MAX_SAFE_INTEGER) :
      key === 'cost_units' ? typeof item === 'number' && Number.isFinite(item) && item >= 0 :
      key === 'metric' ? boundedText(item, 64) : false)) &&
    Object.keys(value).every(key => numeric.has(key) || key === 'cost_units' || key === 'metric') &&
    (value.cost_units == null || boundedText(value.metric, 64));
}
function validateHandback(handback, ticket, result) {
  assert(keys(handback, ['kind', 'native_session_id', 'protected_root', 'source_head',
    'protected_source_sha256', 'source_fingerprint', 'request_sha256',
    'parent_attempt_id', 'exit_code', 'cancelled', 'adoption']) &&
    HANDBACK_KINDS.has(handback.kind) && HANDBACK_ADOPTION.has(handback.adoption) &&
    ID.test(handback.native_session_id) && boundedText(handback.protected_root, 4_096) &&
    isAbsolute(handback.protected_root) && GIT_HEAD.test(handback.source_head) &&
    HASH.test(handback.protected_source_sha256) &&
    handback.source_fingerprint === ticket.source_fingerprint &&
    handback.request_sha256 === ticket.request_sha256 &&
    handback.parent_attempt_id === ticket.attempt_id &&
    handback.exit_code === 0 && handback.cancelled === false &&
    result.status === 'succeeded' && result.execution_verified === true &&
    result.task_verified === false && result.task_quality === 'execution_only' &&
    result.parity_state === 'unverified' &&
    result.dispatch_stage === 'dispatched' &&
    ticket.selected_config.surface === 'claude' &&
    ticket.selected_config.transport === 'claude_cli' &&
    ticket.selected_config.scope === 'workspace_write' &&
    ticket.selected_config.permission_profile === 'workspace_write' &&
    ticket.host_context?.require_read_only === false &&
    boundedText(result.output, MAX_OUTPUT_BYTES) &&
    boundedText(result.native_summary, MAX_NATIVE_SUMMARY_BYTES) &&
    boundedText(result.native_receipt, 4_096), 'handback_receipt_invalid');
  if (ticket.continuation) assert(
    handback.protected_root === ticket.continuation.protected_root &&
    handback.source_head === ticket.continuation.source_head &&
    handback.protected_source_sha256 === ticket.continuation.protected_source_sha256 &&
    (ticket.continuation.kind !== 'full_access_required' ||
      handback.native_session_id === ticket.continuation.native_session_id),
  'handback_source_changed_during_continuation');
}

function validateRepairSource(source, ticket, result) {
  assert(keys(source, ['source_root', 'source_head', 'source_before_head',
    'source_before_sha256', 'protected_source_sha256', 'source_before_clean', 'changed_paths']) &&
    boundedText(source.source_root, 4_096) && isAbsolute(source.source_root) &&
    GIT_HEAD.test(source.source_head) && GIT_HEAD.test(source.source_before_head) &&
    HASH.test(source.source_before_sha256) && HASH.test(source.protected_source_sha256) &&
    source.source_before_clean === true && Array.isArray(source.changed_paths) &&
    source.changed_paths.length > 0 && source.changed_paths.length <= 512 &&
    new Set(source.changed_paths).size === source.changed_paths.length &&
    source.changed_paths.every(path => boundedText(path, 4_096) &&
      path.startsWith('products/os1-mac-runtime/') && path !== 'products/os1-mac-runtime/release' &&
      !isAbsolute(path) && !path.includes('\\') &&
      path.split('/').every(part => part && part !== '.' && part !== '..')) &&
    result.handback == null && result.status === 'succeeded' &&
    result.execution_verified === true && result.task_quality !== 'failed' &&
    ticket.host_context?.require_read_only === false &&
    ['codex', 'claude'].includes(ticket.selected_config.surface) &&
    ticket.selected_config.scope === 'workspace_write' &&
    ticket.selected_config.permission_profile === 'workspace_write' &&
    (ticket.continuation == null || ticket.continuation.kind === 'os1_change_required') &&
    (ticket.continuation == null ||
      (source.source_root === ticket.continuation.protected_root &&
       source.source_before_head === ticket.continuation.source_head &&
       source.source_before_sha256 === ticket.continuation.protected_source_sha256)),
  'repair_source_receipt_invalid');
}

function installHandoffShape(value) {
  const required = ['schema', 'task_id', 'request_sha256', 'node_id', 'parent_attempt_id',
    'source_fingerprint', 'source_root', 'source_head', 'protected_source_sha256',
    'staged_intent_id', 'staged_receipt_sha256', 'state'];
  return plain(value) && required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || key === 'installed_receipt') &&
    INSTALL_STATES.has(value.state) &&
    (value.state === 'installed' ? boundedText(value.installed_receipt, 4_096) &&
      isAbsolute(value.installed_receipt) : value.installed_receipt == null);
}
function validateInstallHandoff(value, task, node, source, parentAttemptID) {
  assert(installHandoffShape(value) &&
    value.schema === 1 && value.task_id === task.task_id &&
    value.request_sha256 === task.request_sha256 && value.node_id === node.id &&
    value.parent_attempt_id === parentAttemptID &&
    value.source_fingerprint === task.source_fingerprint &&
    value.source_root === source.source_root && value.source_head === source.source_head &&
    value.protected_source_sha256 === source.protected_source_sha256 &&
    ID.test(value.staged_intent_id) && HASH.test(value.staged_receipt_sha256),
  'install_handoff_invalid');
  return immutable({...value, installed_receipt: value.installed_receipt ?? null});
}

function validateReconciledInstall(value, prior) {
  assert(installHandoffShape(value) && Object.entries(prior).every(([key, original]) =>
      key === 'state' || key === 'installed_receipt' || value[key] === original),
  'install_reconciliation_invalid');
  return immutable({...value, installed_receipt: value.installed_receipt ?? null});
}

export class RCCRuntimeError extends Error {
  constructor(code) { super(code); this.name = 'RCCRuntimeError'; this.code = code; }
}

export function canonicalHostContext(value) { return stable(value); }
export function hostContextFingerprint(value) { return sha(Buffer.from(canonicalHostContext(value))); }

function validateTask(task) {
  const required = ['schema', 'task_id', 'request', 'request_sha256', 'objective', 'policy_sha256',
    'source_fingerprint', 'mode', 'material_refs', 'budget', 'host_context'];
  const optional = ['context', 'workspace', 'native_sessions', 'provider_preference', 'policy'];
  assert(plain(task) && required.every(key => Object.hasOwn(task, key)) &&
    Object.keys(task).every(key => required.includes(key) || optional.includes(key)), 'task_shape_invalid');
  assert(task.schema === 1 && ID.test(task.task_id) && boundedText(task.request, 64_000) &&
    boundedText(task.objective, 8_192) && HASH.test(task.request_sha256) &&
    sha(Buffer.from(task.request)) === task.request_sha256 && HASH.test(task.policy_sha256) &&
    HASH.test(task.source_fingerprint) && ['auto', 'explicit_routing_test'].includes(task.mode),
  'task_identity_invalid');
  assert(keys(task.budget, ['max_attempts', 'max_parallel', 'max_cost_units', 'max_duration_ms']) &&
    int(task.budget.max_attempts, 1, 3) && int(task.budget.max_parallel, 1, 8) &&
    int(task.budget.max_duration_ms, 1_000, 86_400_000) &&
    (task.budget.max_cost_units === null ||
      (typeof task.budget.max_cost_units === 'number' && Number.isFinite(task.budget.max_cost_units) &&
       task.budget.max_cost_units >= 0)), 'task_budget_invalid');
  assert(Array.isArray(task.material_refs) && task.material_refs.length <= 128 &&
    task.material_refs.every(x => boundedText(x, 1_024)) &&
    new Set(task.material_refs).size === task.material_refs.length, 'material_refs_invalid');
  assert(task.context === undefined || task.context === null ||
    (typeof task.context === 'string' && Buffer.byteLength(task.context) <= 500_000), 'context_invalid');
  assert(task.workspace === undefined || task.workspace === null ||
    (boundedText(task.workspace, 4_096) && isAbsolute(task.workspace)), 'workspace_invalid');
  assert(task.provider_preference === undefined || task.provider_preference === null ||
    boundedText(task.provider_preference, 256), 'provider_preference_invalid');
  assert(task.native_sessions === undefined || task.native_sessions === null ||
    (plain(task.native_sessions) && Object.entries(task.native_sessions).every(([key, value]) =>
      boundedText(key, 64) && boundedText(value, 256))), 'native_sessions_invalid');
  assert(task.policy === undefined || task.policy === null ||
    (keys(task.policy, ['source_sha256', 'projection_sha256', 'text']) &&
      HASH.test(task.policy.source_sha256) && HASH.test(task.policy.projection_sha256) &&
      typeof task.policy.text === 'string' &&
      sha(Buffer.from(task.policy.text)) === task.policy.projection_sha256), 'policy_invalid');
  const h = task.host_context;
  const hostKeys = ['workspace', 'context', 'provider_preference', 'codex_session_id',
    'claude_session_id', 'require_read_only', 'owner_policy'];
  const hostOptionalKeys = ['explicit_routes', 'conversation_id', 'submission_id'];
  const uuid = value => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  assert(plain(h) && hostKeys.every(key => Object.hasOwn(h, key)) &&
    Object.keys(h).every(key => hostKeys.includes(key) || hostOptionalKeys.includes(key)) &&
    boundedText(h.workspace, 4_096) && isAbsolute(h.workspace) &&
    (h.context === null || (typeof h.context === 'string' && Buffer.byteLength(h.context) <= 500_000)) &&
    boundedText(h.provider_preference, 256) &&
    (h.codex_session_id === null || boundedText(h.codex_session_id, 256)) &&
    (h.claude_session_id === null || boundedText(h.claude_session_id, 256)) &&
    (h.conversation_id === undefined || uuid(h.conversation_id)) &&
    (h.submission_id === undefined || uuid(h.submission_id)) &&
    typeof h.require_read_only === 'boolean' &&
    (h.owner_policy === null || plain(h.owner_policy)) &&
    (h.explicit_routes === undefined || h.explicit_routes === null ||
      (Array.isArray(h.explicit_routes) && h.explicit_routes.length > 0 &&
       h.explicit_routes.length <= 8 && h.explicit_routes.every(route =>
         keys(route, ['surface', 'instruction']) && SURFACES.has(route.surface) &&
         boundedText(route.instruction, 12_000)) &&
       new Set(h.explicit_routes.map(route => stable(route))).size === h.explicit_routes.length)) &&
    (h.explicit_routes == null || task.mode === 'explicit_routing_test') &&
    hostContextFingerprint(h) === task.source_fingerprint, 'host_context_invalid');
  assert(Buffer.byteLength(stable(task)) <= MAX_TASK_BYTES, 'task_oversize');
  return immutable(task);
}

function exactConfig(candidate) {
  return Object.fromEntries(['surface', 'transport', 'account_id', 'model', 'effort', 'tools',
    'scope', 'permission_profile', 'quota_pool', 'allowed_paths', 'configuration_sha256']
    .map(key => [key, immutable(candidate[key])]));
}
function validateCatalog(catalog, task) {
  assert(keys(catalog, ['schema', 'task_id', 'request_sha256', 'candidates']) &&
    catalog.schema === 1 && catalog.task_id === task.task_id &&
    catalog.request_sha256 === task.request_sha256 && Array.isArray(catalog.candidates) &&
    catalog.candidates.length > 0 && catalog.candidates.length <= 256, 'catalog_binding_invalid');
  assert(Buffer.byteLength(stable(catalog)) <= MAX_CATALOG_BYTES, 'catalog_oversize');
  const ids = new Set();
  for (const c of catalog.candidates) {
    assert(keys(c, ['id', 'surface', 'transport', 'account_id', 'model', 'effort', 'tools', 'scope',
      'permission_profile', 'quota_pool', 'allowed_paths', 'configuration_sha256',
      'availability', 'availability_observed_at_ms', 'availability_valid_until_ms',
      'quota_remaining_fraction', 'quota_observed_at_ms', 'quota_valid_until_ms',
      'quality_state', 'estimated_cost_units']), 'candidate_shape_invalid');
    assert(ID.test(c.id) && !ids.has(c.id) && SURFACES.has(c.surface) && TRANSPORTS.has(c.transport) &&
      boundedText(c.account_id, 256) && boundedText(c.model, 256) && EFFORTS.has(c.effort) &&
      Array.isArray(c.tools) && c.tools.length <= 64 && c.tools.every(x => boundedText(x, 128)) &&
      new Set(c.tools).size === c.tools.length && SCOPES.has(c.scope) &&
      SCOPES.has(c.permission_profile) && POOLS.has(c.quota_pool) &&
      allowedPaths(c.allowed_paths) && HASH.test(c.configuration_sha256) &&
      AVAILABILITY.has(c.availability) && QUALITY.has(c.quality_state) &&
      (c.estimated_cost_units === null ||
       (typeof c.estimated_cost_units === 'number' && Number.isFinite(c.estimated_cost_units) && c.estimated_cost_units >= 0)),
    'candidate_invalid');
    ids.add(c.id);
    const physical = c.surface === 'local' ? c.transport === 'local' && c.quota_pool === 'none' :
      c.surface === 'chatgpt' ? c.transport === 'chatgpt_service' && c.quota_pool === 'openai_chat' :
      c.surface === 'gpt-chat' || c.surface === 'codex' ?
        c.transport === 'codex_app_server' && c.quota_pool === 'openai_codex' :
      c.surface === 'claude' ? c.transport === 'claude_cli' && c.quota_pool === 'anthropic_shared' :
      c.surface === 'claude-chat' ?
        ['claude_cli', 'claude_service'].includes(c.transport) && c.quota_pool === 'anthropic_shared' : false;
    assert(physical, 'candidate_surface_transport_pool_mismatch');
    for (const [observed, valid] of [
      [c.availability_observed_at_ms, c.availability_valid_until_ms],
      [c.quota_observed_at_ms, c.quota_valid_until_ms]]) {
      assert((observed === null && valid === null) ||
        (int(observed, 0, Number.MAX_SAFE_INTEGER) && int(valid, observed, Number.MAX_SAFE_INTEGER)),
      'candidate_time_invalid');
    }
    assert(c.quota_remaining_fraction === null ||
      (typeof c.quota_remaining_fraction === 'number' && Number.isFinite(c.quota_remaining_fraction) &&
       c.quota_remaining_fraction >= 0 && c.quota_remaining_fraction <= 1), 'candidate_quota_invalid');
    // Unknown/stale rows remain evidence, but cannot be dispatched. A stale
    // row must not erase another eligible candidate from the catalogue.
  }
  return immutable(catalog);
}

function pureArithmetic(request) {
  // Entire input only. No natural-language or routed/quoted expression may
  // authorize a deterministic shortcut for an explicit multi-surface test.
  const match = /^\s*(-?\d{1,15})\s*([+*\-])\s*(-?\d{1,15})\s*$/.exec(request);
  if (!match) return null;
  const a = BigInt(match[1]), b = BigInt(match[3]);
  const result = match[2] === '+' ? a + b : match[2] === '*' ? a * b : a - b;
  return result.toString();
}

function exactLocalCheckIn(request) {
  const value = request.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    .replace(/\s*([.!?])\s*/gu, '$1').toLowerCase();
  const korean = new Set(['야 너 되냐?', '야 체크해봅시다 너 되냐?',
    '야 체크해봅시다.너 되냐?', '너 되냐?']);
  if (korean.has(value)) return '응, 지금 OS-1 로컬 요청·응답 경로는 살아 있어.';
  if (value === 'are you working?' || value === 'hello')
    return 'Yes. This local OS-1 request-and-response path is working.';
  return null;
}

function validatePlan(plan, task, catalog) {
  assert(plain(plan) && ['schema', 'task_id', 'request_sha256', 'nodes'].every(k => Object.hasOwn(plan, k)) &&
    Object.keys(plan).every(k => ['schema', 'task_id', 'request_sha256', 'nodes', 'final_node_id'].includes(k)) &&
    plan.schema === 1 && plan.task_id === task.task_id &&
    plan.request_sha256 === task.request_sha256 && Array.isArray(plan.nodes) &&
    plan.nodes.length > 0 && plan.nodes.length <= 8 &&
    (plan.final_node_id === undefined || plan.final_node_id === null || ID.test(plan.final_node_id)), 'plan_binding_invalid');
  const candidates = new Map(catalog.candidates.map(c => [c.id, c]));
  const ids = new Set();
  for (const node of plan.nodes) {
    assert(keys(node, ['id', 'instruction', 'dependencies', 'kind', 'candidate_id',
      'scope', 'owned_paths', 'context_refs']) && ID.test(node.id) && !ids.has(node.id) &&
      boundedText(node.instruction, 12_000) && ['agent', 'deterministic'].includes(node.kind) &&
      ID.test(node.candidate_id) && candidates.has(node.candidate_id) &&
      SCOPES.has(node.scope) && node.scope === candidates.get(node.candidate_id).scope &&
      Array.isArray(node.dependencies) && node.dependencies.length <= 8 &&
      node.dependencies.every(ID.test.bind(ID)) && new Set(node.dependencies).size === node.dependencies.length &&
      allowedPaths(node.owned_paths) && Array.isArray(node.context_refs) &&
      node.context_refs.length <= 128 &&
      node.context_refs.every(x => task.material_refs.includes(x)), 'plan_node_invalid');
    const c = candidates.get(node.candidate_id);
    if (node.kind === 'deterministic')
      assert(task.mode !== 'explicit_routing_test' && c.surface === 'local' && c.transport === 'local' &&
        c.quota_pool === 'none' && c.tools.length === 0 && node.scope === 'read_only' &&
        pureArithmetic(node.instruction) !== null, 'deterministic_node_not_exact');
    assert(node.scope !== 'workspace_write' || (node.owned_paths.length > 0 &&
      (c.allowed_paths.includes('**') ?
        stable(node.owned_paths) === stable(['**']) :
        node.owned_paths.every(path => c.allowed_paths.some(allowed => path === allowed || path.startsWith(allowed + '/'))))),
    'plan_write_scope_invalid');
    assert(node.scope === 'workspace_write' || node.owned_paths.length === 0, 'plan_read_scope_invalid');
    if (task.host_context.require_read_only) assert(node.scope === 'read_only', 'owner_read_only_violation');
    ids.add(node.id);
  }
  if (task.mode === 'explicit_routing_test') {
    const requested = task.host_context.explicit_routes;
    assert(Array.isArray(requested) && requested.length === plan.nodes.length,
      'explicit_route_count_mismatch');
    const remaining = new Set(requested.map(route => stable(route)));
    for (const node of plan.nodes) {
      const candidate = candidates.get(node.candidate_id);
      const binding = stable({surface: candidate.surface, instruction: node.instruction});
      assert(node.kind === 'agent' && node.dependencies.length === 0 && remaining.delete(binding),
        'explicit_route_binding_mismatch');
    }
    assert(remaining.size === 0, 'explicit_route_binding_mismatch');
  }
  if (plan.final_node_id !== undefined && plan.final_node_id !== null)
    assert(ids.has(plan.final_node_id), 'plan_final_node_unknown');
  for (const node of plan.nodes) assert(node.dependencies.every(id => ids.has(id) && id !== node.id), 'plan_dependency_invalid');
  const byID = new Map(plan.nodes.map(node => [node.id, node]));
  const visiting = new Set(), done = new Set();
  function visit(id) {
    if (done.has(id)) return;
    assert(!visiting.has(id), 'plan_cycle'); visiting.add(id);
    for (const parent of byID.get(id).dependencies) visit(parent);
    visiting.delete(id); done.add(id);
  }
  for (const id of ids) visit(id);
  const writes = plan.nodes.filter(node => node.scope === 'workspace_write');
  function ancestor(node, id) {
    return node.dependencies.some(parent => parent === id || ancestor(byID.get(parent), id));
  }
  for (let a = 0; a < writes.length; a++) for (let b = a + 1; b < writes.length; b++) {
    const overlap = writes[a].owned_paths.some(x => writes[b].owned_paths.some(y => pathsOverlap(x, y)));
    assert(!overlap || ancestor(writes[a], writes[b].id) || ancestor(writes[b], writes[a].id),
      'plan_write_conflict');
  }
  return immutable(plan);
}

function publicSnapshot(snapshot) {
  return { schema: 1, task_id: snapshot.task.task_id,
    request_sha256: snapshot.task.request_sha256, state: snapshot.state,
    revision: snapshot.revision,
    children: snapshot.children.map(({id, state, attempt_id, candidate_id, selected_config,
      instruction, dependencies, started_at_ms, finished_at_ms, native_receipt, output}) =>
      ({id, state, attempt_id, candidate_id, selected_config, instruction, dependencies,
        started_at_ms, finished_at_ms, native_receipt,
        output_summary: typeof output === 'string' ? output.slice(0, 600) : null})),
    result: snapshot.result ? immutable(snapshot.result) : null,
    install_handoff: snapshot.install_handoff ? immutable(snapshot.install_handoff) : null,
    error: snapshot.error ?? null };
}

function alive(pid) {
  if (!int(pid, 1, Number.MAX_SAFE_INTEGER)) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export async function createRCCRuntime({stateDir, catalog, plan, execute, executeContinuation,
                                         stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
                                         maximumWorkers = 4, cancelGraceMs = 5_000} = {}) {
  assert(typeof stateDir === 'string' && isAbsolute(stateDir) && !stateDir.includes('/../'), 'state_dir_invalid');
  assert(int(maximumWorkers, 1, 16), 'worker_limit_invalid');
  assert(int(cancelGraceMs, 100, 30_000), 'cancel_grace_invalid');
  await mkdir(stateDir, {recursive: true, mode: 0o700});
  const directory = await lstat(stateDir);
  assert(directory.isDirectory() && !directory.isSymbolicLink() &&
    (directory.mode & 0o077) === 0 && directory.uid === process.getuid(), 'state_dir_not_private');
  const file = join(stateDir, 'rcc-runtime.sqlite');
  const db = new DatabaseSync(file);
  await chmod(file, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;');
  db.exec(`CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL, token TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (task_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, snapshot TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS write_leases (workspace TEXT PRIMARY KEY, task_id TEXT NOT NULL, acquired_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS quota_leases (pool_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, acquired_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
      revision INTEGER NOT NULL, kind TEXT NOT NULL, at_ms INTEGER NOT NULL, payload TEXT NOT NULL);`);
  const token = randomUUID();
  function transaction(fn, checkOwner = true) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (checkOwner) {
        const row = db.prepare('SELECT pid,token FROM owner WHERE id=1').get();
        assert(row?.pid === process.pid && row?.token === token, 'runtime_owner_lost');
      }
      const result = fn(); db.exec('COMMIT'); return result;
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
  }
  try {
    transaction(() => {
      const current = db.prepare('SELECT pid FROM owner WHERE id=1').get();
      assert(!current || !alive(current.pid), 'runtime_owner_active');
      db.prepare('INSERT INTO owner(id,pid,token) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,token=excluded.token')
        .run(process.pid, token);
    }, false);
  } catch (error) { db.close(); throw error; }

  const runtime = new RCCRuntime({db, token, stateDir, catalog, plan, execute, executeContinuation,
                                 stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
                                 maximumWorkers, cancelGraceMs,
                                 transaction});
  runtime.reconcileRestart();
  runtime.startQueued();
  return runtime;
}

class RCCRuntime {
  constructor({db, token, stateDir, catalog, plan, execute, executeContinuation,
               stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
               maximumWorkers, cancelGraceMs, transaction}) {
    this.db = db; this.token = token; this.stateDir = stateDir;
    this.catalog = catalog; this.plan = plan;
    this.execute = execute; this.executeContinuation = executeContinuation;
    this.stageSelfUpdate = stageSelfUpdate;
    this.reconcileInstallation = reconcileInstallation;
    this.cancelInstallation = cancelInstallation;
    this.verifyTask = verifyTask; this.emit = emit;
    this.maximumWorkers = maximumWorkers; this.cancelGraceMs = cancelGraceMs;
    this.transaction = transaction;
    this.runningTasks = new Map(); this.controllers = new Map();
    this.installationObservations = new Map();
    this.poolReservations = new Set(); this.activeWriteWorkspaces = new Set();
    this.activeWorkers = 0; this.closed = false; this.stopping = false;
    this.quiescing = false;
  }

  _load(taskID) {
    const row = this.db.prepare('SELECT snapshot FROM tasks WHERE task_id=?').get(taskID);
    return row ? JSON.parse(row.snapshot) : null;
  }
  _notify(snapshot, kind) {
    if (typeof this.emit !== 'function') return;
    queueMicrotask(() => {
      try { Promise.resolve(this.emit({kind, snapshot: publicSnapshot(snapshot)})).catch(() => {}); }
      catch { /* The durable event, not a UI callback, is authoritative. */ }
    });
  }
  _update(taskID, kind, mutate) {
    assert(!this.closed, 'runtime_closed');
    const changed = this.transaction(() => {
      const snapshot = this._load(taskID);
      assert(snapshot, 'task_not_found');
      mutate(snapshot);
      snapshot.revision += 1;
      const encoded = stable(snapshot);
      assert(Buffer.byteLength(encoded) <= 16_000_000, 'snapshot_oversize');
      assert(Buffer.byteLength(stable(publicSnapshot(snapshot))) <= MAX_PUBLIC_WIRE_BYTES,
        'public_snapshot_oversize');
      this.db.prepare('UPDATE tasks SET snapshot=? WHERE task_id=?').run(encoded, taskID);
      this.db.prepare('INSERT INTO events(task_id,revision,kind,at_ms,payload) VALUES(?,?,?,?,?)')
        .run(taskID, snapshot.revision, kind, Date.now(), stable(publicSnapshot(snapshot)));
      return snapshot;
    });
    this._notify(changed, kind);
    return changed;
  }
  _hold(taskID, reason, result = null) {
    return this._update(taskID, 'held', snapshot => {
      if (TERMINAL.has(snapshot.state)) return;
      snapshot.state = result ? 'returned_unverified' : 'held';
      snapshot.error = reason; if (result) snapshot.result = result;
    });
  }
  _holdExplicitRoutes(taskID, reason) {
    return this._update(taskID, 'explicit_routes_held', snapshot => {
      if (TERMINAL.has(snapshot.state)) return;
      const routes = snapshot.task.host_context.explicit_routes;
      if (Array.isArray(routes)) snapshot.children = routes.map((route, index) => ({
        id: `requested-${index + 1}`, state: 'held', attempt_id: null,
        candidate_id: null, attempts: 0, attempt_history: [], repair_needed: false,
        dispatched_at_ms: null, output: null, execution_verified: false,
        task_quality: 'unverified', parity_state: 'unverified', native_receipt: null,
        native_summary: null, usage: null, selected_config: null, instruction: route.instruction,
        dependencies: [], started_at_ms: null, finished_at_ms: null}));
      snapshot.state = 'held'; snapshot.error = reason;
    });
  }
  _public(taskID) {
    assert(!this.closed, 'runtime_closed');
    const row = this.transaction(() => this._load(taskID));
    assert(row, 'task_not_found');
    return publicSnapshot(row);
  }
  status(value) {
    assert(keys(value, ['schema', 'task_id']) && value.schema === 1 && ID.test(value.task_id),
      'status_request_invalid');
    return this._public(value.task_id);
  }

  async statusWithInstallation(value) {
    const snapshot = this.status(value); // Bind before queuing another native read.
    if (this.stopping || this.quiescing) return snapshot;
    return this._serializeInstallation(value.task_id, () => this._observeInstallation(value, false));
  }

  async cancelWithInstallation(value) {
    const snapshot = this.status(value);
    if (this.stopping || this.quiescing) return snapshot;
    if (!snapshot.install_handoff) return this.cancel(value);
    return this._serializeInstallation(value.task_id, () => this._observeInstallation(value, true));
  }

  _serializeInstallation(taskID, operation) {
    const prior = this.installationObservations.get(taskID) ?? Promise.resolve();
    const job = prior.catch(() => {}).then(operation);
    this.installationObservations.set(taskID, job);
    return job.finally(() => {
      if (this.installationObservations.get(taskID) === job)
        this.installationObservations.delete(taskID);
    });
  }

  _adoptInstallation(state, observed) {
    state.install_handoff = observed;
    state.state = observed.state === 'installed' ? 'returned_unverified' :
      observed.state === 'cancelled' ? 'cancelled' :
      observed.state === 'failed' ? 'held' :
      observed.state === 'effects_uncertain' || state.cancel_requested ? 'effects_uncertain' : 'awaiting_install';
    state.error = observed.state === 'installed' ? 'installed_task_quality_unverified' :
      observed.state === 'staged' && !state.cancel_requested ? null :
      observed.state === 'staged' ? 'cancel_during_source_stage_install_unresolved' : `installation_${observed.state}`;
  }

  async _observeInstallation(value, cancel) {
    let snapshot = this.status(value);
    if (!INSTALL_UNRESOLVED.has(snapshot.install_handoff?.state)) return snapshot;
    const callback = cancel ? this.cancelInstallation : this.reconcileInstallation;
    if (cancel) snapshot = publicSnapshot(this._update(value.task_id, 'install_cancel_requested', state => {
      state.cancel_requested = true;
    }));
    if (typeof callback !== 'function') return snapshot;
    let observed;
    try {
      observed = validateReconciledInstall(await callback(immutable({schema: 1,
        task_id: snapshot.task_id, request_sha256: snapshot.request_sha256,
        install_handoff: snapshot.install_handoff})), snapshot.install_handoff);
    } catch (error) {
      if (!this.closed) this._update(value.task_id, 'install_observation_unverified', state => {
        if (!INSTALL_UNRESOLVED.has(state.install_handoff?.state)) return;
        state.state = 'effects_uncertain';
        state.error = error instanceof RCCRuntimeError ? error.code : 'installation_observation_unavailable';
      });
      return this.status(value);
    }
    if (this.closed) throw new RCCRuntimeError('runtime_closed');
    this._update(value.task_id, cancel ? 'install_cancel_reconciled' : 'install_receipt_reconciled', state => {
      // Installed effect is not semantic quality/parity. Status/cancel never
      // re-enter the native writer, planner, source stage or provider.
      if (!INSTALL_UNRESOLVED.has(state.install_handoff?.state)) return;
      validateReconciledInstall(observed, state.install_handoff);
      this._adoptInstallation(state, observed);
    });
    this._releaseSafeLeases(value.task_id);
    return this.status(value);
  }
  events(value) {
    assert(keys(value, ['schema', 'task_id']) && value.schema === 1 && ID.test(value.task_id),
      'events_request_invalid');
    return this.transaction(() => this.db.prepare(
      'SELECT seq,revision,kind,at_ms,payload FROM events WHERE task_id=? ORDER BY seq').all(value.task_id)
      .map(row => ({seq: Number(row.seq), revision: Number(row.revision), kind: row.kind,
        at_ms: Number(row.at_ms), snapshot: JSON.parse(row.payload)})));
  }

  async submit(value) {
    assert(!this.stopping && !this.quiescing && !this.closed, 'runtime_stopping');
    const task = validateTask(value);
    const fingerprint = sha(Buffer.from(stable(task)));
    const inserted = this.transaction(() => {
      const prior = this.db.prepare('SELECT fingerprint,snapshot FROM tasks WHERE task_id=?').get(task.task_id);
      if (prior) {
        assert(prior.fingerprint === fingerprint, 'idempotency_conflict');
        return {newTask: false, snapshot: JSON.parse(prior.snapshot)};
      }
      const now = Date.now();
      const snapshot = {schema: 1, task, fingerprint, state: 'queued', revision: 1,
        created_at_ms: now, cancel_requested: false, catalog: null, plan: null,
        children: [], result: null, install_handoff: null, error: null, spent_cost_units: 0};
      this.db.prepare('INSERT INTO tasks(task_id,fingerprint,snapshot) VALUES(?,?,?)')
        .run(task.task_id, fingerprint, stable(snapshot));
      this.db.prepare('INSERT INTO events(task_id,revision,kind,at_ms,payload) VALUES(?,?,?,?,?)')
        .run(task.task_id, 1, 'submitted', now, stable(publicSnapshot(snapshot)));
      return {newTask: true, snapshot};
    });
    if (inserted.newTask) { this._notify(inserted.snapshot, 'submitted'); this._start(task.task_id); }
    return this._public(task.task_id);
  }

  cancel(value) {
    assert(keys(value, ['schema', 'task_id']) && value.schema === 1 && ID.test(value.task_id),
      'cancel_request_invalid');
    const snapshot = this._update(value.task_id, 'cancel_requested', state => {
      if (TERMINAL.has(state.state)) return;
      state.cancel_requested = true;
      const active = state.children.some(child => child.state === 'running' && child.dispatched_at_ms !== null);
      state.state = active ? 'cancelling' : 'cancelled';
      state.error = active ? 'cancellation_pending_effect_reconciliation' : 'cancelled_before_dispatch';
      if (!active) for (const child of state.children)
        if (child.state === 'queued' || child.state === 'waiting') child.state = 'cancelled';
    });
    for (const [attemptID, item] of this.controllers) if (item.taskID === value.task_id)
      item.controller.abort(new RCCRuntimeError('cancel_requested'));
    if (snapshot.state === 'cancelling') {
      const timer = setTimeout(() => {
        if (this.closed) return;
        const current = this._load(value.task_id);
        if (current?.state !== 'cancelling') return;
        this._update(value.task_id, 'cancel_terminal_missing', state => {
          state.state = 'effects_uncertain'; state.error = 'cancel_no_terminal_receipt';
          for (const child of state.children) if (child.state === 'running') {
            child.state = child.stage?.state === 'dispatched' ? 'completed' : 'effects_uncertain';
            if (child.stage?.state === 'dispatched') child.stage.state = 'effects_uncertain';
            child.attempt_history.at(-1).state = 'effects_uncertain';
          }
        });
      }, this.cancelGraceMs);
      timer.unref?.();
    }
    return publicSnapshot(snapshot);
  }

  async wait(value, {timeoutMs = 60_000} = {}) {
    assert(keys(value, ['schema', 'task_id']) && value.schema === 1 && ID.test(value.task_id) &&
      int(timeoutMs, 0, 3_600_000), 'wait_request_invalid');
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const snapshot = this.status(value);
      if (TERMINAL.has(snapshot.state) || Date.now() >= deadline) return snapshot;
      await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
    }
  }

  _start(taskID) {
    if (this.closed || this.quiescing || this.runningTasks.has(taskID)) return;
    const job = this._runTask(taskID).catch(error => {
      if (this.closed) return;
      const current = this._load(taskID);
      if (current && !TERMINAL.has(current.state)) this._hold(taskID,
        error instanceof RCCRuntimeError ? error.code : 'runtime_internal_failure');
    }).finally(() => { this.runningTasks.delete(taskID); if (!this.closed) this._releaseSafeLeases(taskID); });
    this.runningTasks.set(taskID, job);
  }
  startQueued() {
    if (this.closed || this.quiescing) return;
    const tasks = this.transaction(() => this.db.prepare('SELECT task_id,snapshot FROM tasks').all()
      .filter(row => JSON.parse(row.snapshot).state === 'queued').map(row => row.task_id));
    for (const id of tasks) this._start(id);
  }

  quiesce(value) {
    assert(keys(value, ['schema', 'request_id']) && value.schema === 1 && ID.test(value.request_id),
      'quiesce_request_invalid');
    assert(!this.closed, 'runtime_closed');
    // Admission pause is deliberately not cancellation: existing native work
    // and dependent nodes must finish under this owner before a safe upgrade.
    this.quiescing = true;
    const rows = this.transaction(() => this.db.prepare('SELECT snapshot FROM tasks').all()
      .map(row => JSON.parse(row.snapshot)));
    const active = rows.reduce((count, snapshot) => count + snapshot.children.filter(child =>
      child.state === 'running' && child.dispatched_at_ms !== null).length, 0);
    const inProgress = rows.some(snapshot => ['planning', 'running', 'cancelling'].includes(snapshot.state));
    return {schema: 1, request_id: value.request_id, owner_pid: process.pid,
      active_dispatches: Math.max(active, this.controllers.size) + this.installationObservations.size,
      queued_preserved: true, queued_tasks: rows.filter(snapshot => snapshot.state === 'queued').length,
      accepting_submissions: false,
      // A prior terminal effects_uncertain row remains durable and unreplayed;
      // it is not evidence that this owner still has a live child process.
      safe_to_stop: !inProgress && this.runningTasks.size === 0 &&
        this.controllers.size === 0 && this.activeWorkers === 0 && this.installationObservations.size === 0};
  }

  reconcileRestart() {
    const rows = this.transaction(() => this.db.prepare('SELECT task_id,snapshot FROM tasks').all());
    for (const row of rows) {
      const state = JSON.parse(row.snapshot);
      if (!['planning', 'running', 'cancelling'].includes(state.state)) continue;
      const dispatched = state.children.some(child => child.state === 'running' && child.dispatched_at_ms !== null);
      const pendingContinuation = state.children.some(child =>
        child.state === 'waiting' && child.continuation?.state === 'pending');
      this._update(row.task_id, 'restart_reconciled', snapshot => {
        snapshot.state = dispatched ? 'effects_uncertain' : 'held';
        snapshot.error = dispatched ? 'restart_active_dispatch_no_replay' :
          pendingContinuation ? 'continuation_pending_recovery_required' : 'restart_before_dispatch';
        for (const child of snapshot.children) if (child.state === 'running')
          child.state = child.stage ? 'completed' : dispatched ? 'effects_uncertain' : 'held';
        for (const child of snapshot.children) if (child.stage?.state === 'dispatched')
          child.stage.state = 'effects_uncertain';
        for (const child of snapshot.children) if (child.state === 'waiting' &&
          child.continuation?.state === 'pending') child.state = 'held';
      });
    }
    for (const row of rows) this._releaseSafeLeases(row.task_id);
  }

  _releaseSafeLeases(taskID) {
    const snapshot = this._load(taskID);
    if (!snapshot) return;
    const activeOrUncertain = snapshot.children.some(c => c.state === 'effects_uncertain' || c.state === 'running');
    if (TERMINAL.has(snapshot.state) && snapshot.state !== 'effects_uncertain' && !activeOrUncertain) {
      this.transaction(() => this.db.prepare('DELETE FROM write_leases WHERE task_id=?').run(taskID));
    }
    // A quota reservation protects only an active or uncertain native attempt,
    // not the parent verifier's think time. Preserve it across a crash when
    // the native child might still be consuming that account pool.
    const protectedPools = new Set(snapshot.children
      .filter(c => ['running', 'effects_uncertain'].includes(c.state) && c.selected_config)
      .map(c => c.selected_config.quota_pool === 'none' ? null :
        `${c.selected_config.quota_pool}:${c.selected_config.account_id}`).filter(Boolean));
    this.transaction(() => {
      const rows = this.db.prepare('SELECT pool_key FROM quota_leases WHERE task_id=?').all(taskID);
      for (const row of rows) if (!protectedPools.has(row.pool_key))
        this.db.prepare('DELETE FROM quota_leases WHERE pool_key=? AND task_id=?').run(row.pool_key, taskID);
    });
  }

  async _aggregateReceipt(taskID, children, output) {
    if (children.length === 1 && children[0].native_receipt) return children[0].native_receipt;
    const directory = join(this.stateDir, 'result-receipts');
    await mkdir(directory, {recursive: true, mode: 0o700});
    const st = await lstat(directory);
    assert(st.isDirectory() && !st.isSymbolicLink() && (st.mode & 0o077) === 0 &&
      st.uid === process.getuid(), 'result_receipt_directory_not_private');
    const path = join(directory, `${taskID}-${randomUUID()}.json`);
    const body = stable({schema: 1, task_id: taskID,
      output_sha256: sha(Buffer.from(output)),
      children: children.map(c => ({id: c.id, attempt_id: c.attempt_id,
        candidate_id: c.candidate_id, native_receipt: c.native_receipt,
        native_summary_sha256: c.native_summary ? sha(Buffer.from(c.native_summary)) : null,
        execution_verified: c.execution_verified, task_quality: c.task_quality}))});
    const handle = await open(path, 'wx', 0o600);
    try { await handle.writeFile(body); await handle.sync(); }
    finally { await handle.close(); }
    return path;
  }

  async _verifiedNativeReceiptDigest(result) {
    const directory = join(this.stateDir, 'native-receipts');
    const path = result.native_receipt;
    assert(typeof path === 'string' && dirname(path) === directory &&
      /^[a-f0-9-]{36}\.json$/.test(basename(path)), 'handback_receipt_path_invalid');
    const parent = await lstat(directory);
    assert(parent.isDirectory() && !parent.isSymbolicLink() && parent.uid === process.getuid() &&
      (parent.mode & 0o077) === 0, 'handback_receipt_directory_invalid');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const st = await handle.stat();
      assert(st.isFile() && st.uid === process.getuid() && st.nlink === 1 &&
        (st.mode & 0o777) === 0o600 && st.size > 0 && st.size <= 1_000_000,
      'handback_receipt_file_invalid');
      const bytes = await handle.readFile();
      const parsed = JSON.parse(bytes.toString('utf8'));
      assert(stable(parsed) === stable(result) &&
        parsed.native_receipt === path && parsed.task_id === result.task_id &&
        parsed.node_id === result.node_id && parsed.attempt_id === result.attempt_id &&
        parsed.configuration_sha256 === result.configuration_sha256 &&
        parsed.handback?.native_session_id === result.handback?.native_session_id,
      'handback_receipt_content_invalid');
      return sha(bytes);
    } finally { await handle.close(); }
  }

  _authorizeHandback(snapshot, node, candidate, result) {
    const h = result.handback;
    assert(snapshot.plan.nodes.length === 1 && node.kind === 'agent' &&
      candidate.surface === 'claude' && candidate.transport === 'claude_cli' &&
      candidate.scope === 'workspace_write' && candidate.permission_profile === 'workspace_write' &&
      snapshot.task.host_context.require_read_only === false &&
      result.execution_verified && result.status === 'succeeded' &&
      !snapshot.cancel_requested, 'handback_original_authority_unavailable');
    let sourceRoot, workspace;
    try {
      sourceRoot = realpathSync(h.protected_root);
      workspace = realpathSync(snapshot.task.host_context.workspace);
    } catch { throw new RCCRuntimeError('handback_source_root_unavailable'); }
    assert(sourceRoot === h.protected_root && isAbsolute(sourceRoot), 'handback_source_root_not_canonical');
    if (h.kind === 'os1_change_required')
      assert(within(sourceRoot, workspace), 'os1_repair_original_workspace_not_authorized');
    return {sourceRoot, workspace};
  }

  _authorizeRepairSource(snapshot, node, candidate, result) {
    const source = result.repair_source;
    assert(snapshot.plan.nodes.length === 1 && node.kind === 'agent' &&
      node.instruction === snapshot.task.request && node.dependencies.length === 0 &&
      ['codex', 'claude'].includes(candidate.surface) &&
      candidate.scope === 'workspace_write' && candidate.permission_profile === 'workspace_write' &&
      snapshot.task.host_context.require_read_only === false &&
      result.status === 'succeeded' && result.execution_verified &&
      result.side_effects === 'confirmed' && source.source_before_clean === true &&
      !snapshot.cancel_requested, 'repair_source_original_authority_unavailable');
    let sourceRoot, workspace;
    try {
      sourceRoot = realpathSync(source.source_root);
      workspace = realpathSync(snapshot.task.host_context.workspace);
    } catch { throw new RCCRuntimeError('repair_source_root_unavailable'); }
    assert(sourceRoot === source.source_root && within(sourceRoot, workspace),
      'repair_source_workspace_unbound');
  }

  async _stageSourceAfterExecution(taskID, node, candidate, result, ticket) {
    const source = result.repair_source;
    // Preserve the raw native candidate before any later source/stage gate.
    // A recovery failure must not erase earlier continuation reports.
    this._update(taskID, 'source_candidate_returned', state => {
      const child = state.children.find(c => c.id === node.id);
      child.state = 'waiting'; child.dispatched_at_ms = null;
      child.output ??= result.output;
      child.execution_verified = false;
      child.task_quality = 'execution_only'; child.parity_state = 'unverified';
      child.native_receipt = result.native_receipt;
      child.native_summary = result.native_summary ?? null;
      child.native_summaries ??= result.native_summary ? [result.native_summary] : [];
      child.usage = result.usage ?? null;
      child.source_candidate = immutable(result);
      const attempt = child.attempt_history.find(entry => entry.attempt_id === result.attempt_id);
      if (attempt) {
        attempt.state = 'source_candidate_returned'; attempt.output = result.output;
        attempt.native_receipt = result.native_receipt; attempt.usage = result.usage ?? null;
      }
    });
    let snapshot = this._load(taskID);
    if (!boundedText(snapshot.children.find(c => c.id === node.id).output, MAX_OUTPUT_BYTES)) {
      this._holdContinuation(taskID, node.id, 'source_combined_output_oversize'); return;
    }
    try { this._authorizeRepairSource(snapshot, node, candidate, result); }
    catch (error) { this._holdContinuation(taskID, node.id,
      error.code ?? 'repair_source_authority_unavailable'); return; }
    let receiptSHA;
    try { receiptSHA = await this._verifiedNativeReceiptDigest(result); }
    catch (error) { this._holdContinuation(taskID, node.id,
      error.code ?? 'repair_source_receipt_unavailable'); return; }
    this._update(taskID, 'source_stage_intent_recorded', state => {
      const child = state.children.find(c => c.id === node.id);
      child.state = 'waiting'; child.dispatched_at_ms = null;
      child.execution_verified = true;
      child.task_quality = 'execution_only'; child.parity_state = 'unverified';
      child.native_receipt = result.native_receipt;
      child.native_summary = result.native_summary ?? null;
      child.native_summaries ??= result.native_summary ? [result.native_summary] : [];
      child.usage = result.usage ?? null;
      child.stage = {state: 'pending', parent_attempt_id: result.attempt_id,
        parent_native_receipt: result.native_receipt, parent_native_receipt_sha256: receiptSHA,
        source_root: source.source_root, source_head: source.source_head,
        protected_source_sha256: source.protected_source_sha256};
      const attempt = child.attempt_history.find(entry => entry.attempt_id === result.attempt_id);
      if (attempt) {
        attempt.state = 'source_stage_intent_recorded';
        attempt.native_receipt = result.native_receipt; attempt.usage = result.usage ?? null;
      }
    });
    if (typeof this.stageSelfUpdate !== 'function') {
      this._holdContinuation(taskID, node.id, 'source_stage_executor_unavailable'); return;
    }
    snapshot = this._load(taskID);
    if (snapshot.cancel_requested || this.stopping) { this._markCancelled(taskID); return; }
    this._update(taskID, 'source_stage_dispatch_started', state => {
      const child = state.children.find(c => c.id === node.id);
      child.state = 'running'; child.dispatched_at_ms = Date.now();
      child.stage.state = 'dispatched';
    });
    const controller = new AbortController();
    this.controllers.set(result.attempt_id, {taskID, controller});
    let handoff;
    try {
      const response = await this.stageSelfUpdate(immutable({ticket,
        parent_record_path: result.native_receipt,
        parent_record_sha256: receiptSHA}), controller.signal);
      if (response?.status === 'not_dispatched') {
        assert(keys(response, ['schema', 'status', 'reason', 'parent_record_sha256']) &&
          response.schema === 1 && STAGE_DENIALS.has(response.reason) &&
          response.parent_record_sha256 === receiptSHA, 'stage_preflight_receipt_invalid');
        if (!this.closed) this._update(taskID, 'source_stage_verified_not_dispatched', state => {
          const child = state.children.find(c => c.id === node.id);
          child.state = 'held'; child.dispatched_at_ms = null;
          child.stage.state = 'not_dispatched';
          state.state = state.cancel_requested ? 'cancelled' : 'held';
          state.error = `source_stage_${response.reason}`;
        });
        return;
      }
      handoff = validateInstallHandoff(response, snapshot.task, node, source, result.attempt_id);
    } catch (error) {
      if (!this.closed)
        this._update(taskID, 'source_stage_effects_uncertain', state => {
          const child = state.children.find(c => c.id === node.id);
          // Native writing is finished; uncertainty belongs to the stage,
          // not an active provider attempt. Keep workspace custody, not quota.
          child.state = 'completed'; child.dispatched_at_ms = null;
          child.stage.state = 'effects_uncertain';
          state.state = 'effects_uncertain';
          state.error = error instanceof RCCRuntimeError ? error.code : 'source_stage_outcome_unknown';
        });
      return;
    } finally {
      this.controllers.delete(result.attempt_id);
    }
    if (this.closed) return;
    this._update(taskID, 'source_stage_handoff_returned', state => {
      const child = state.children.find(c => c.id === node.id);
      child.state = 'completed'; child.finished_at_ms = Date.now();
      child.dispatched_at_ms = null; child.stage.state = handoff.state;
      state.result = {output: child.output, execution_verified: true,
        task_verified: false, task_quality: 'execution_only', parity_state: 'unverified',
        native_receipt: result.native_receipt, native_summary: result.native_summary ?? null,
        native_summaries: child.native_summaries ?? []};
      // A late valid handoff must survive cancellation grace/restart-bound
      // uncertainty. It is the only key for later read-only reconciliation.
      this._adoptInstallation(state, handoff);
    });
  }

  async _runTask(taskID) {
    let state = this._load(taskID);
    if (!state || state.state !== 'queued') return;
    const {task} = state;
    if (task.mode === 'explicit_routing_test' && !Array.isArray(task.host_context.explicit_routes)) {
      this._hold(taskID, 'explicit_route_contract_missing'); return;
    }
    if (task.mode === 'auto' && task.host_context.provider_preference === 'auto' &&
        (task.provider_preference == null || task.provider_preference === 'auto') &&
        task.host_context.explicit_routes == null &&
        task.material_refs.length === 0) {
      const checkin = exactLocalCheckIn(task.request);
      if (checkin !== null && task.objective.trim() === task.request.trim()) {
        this._completeLocalExact(taskID, 'local_checkin', checkin); return;
      }
      const answer = pureArithmetic(task.request);
      if (answer !== null) {
        this._completeLocalExact(taskID, 'deterministic_arithmetic', answer);
        return;
      }
    }
    state = this._update(taskID, 'planning', snapshot => { snapshot.state = 'planning'; });
    if (typeof this.catalog !== 'function') {
      if (task.mode === 'explicit_routing_test') this._holdExplicitRoutes(taskID, 'catalog_unavailable');
      else this._hold(taskID, 'catalog_unavailable');
      return;
    }
    let catalog;
    try { catalog = validateCatalog(await this.catalog(immutable(task)), task); }
    catch (error) {
      const reason = error instanceof RCCRuntimeError ? error.code : 'catalog_failed';
      if (task.mode === 'explicit_routing_test') this._holdExplicitRoutes(taskID, reason);
      else this._hold(taskID, reason);
      return;
    }
    if (this._load(taskID).cancel_requested) { this._markCancelled(taskID); return; }
    this._update(taskID, 'catalog_bound', snapshot => { snapshot.catalog = catalog; });
    if (task.mode === 'explicit_routing_test') {
      const now = Date.now();
      const unavailable = task.host_context.explicit_routes.find(route =>
        !catalog.candidates.some(candidate => candidate.surface === route.surface &&
          candidate.availability === 'available' && candidate.availability_valid_until_ms > now &&
          candidate.quality_state !== 'mismatch' &&
          (candidate.quota_pool === 'none' || (candidate.quota_pool !== 'unknown' &&
            candidate.quota_remaining_fraction > 0 && candidate.quota_valid_until_ms > now))));
      if (unavailable) {
        this._holdExplicitRoutes(taskID, `explicit_route_surface_unavailable:${unavailable.surface}`);
        return;
      }
    }
    if (typeof this.plan !== 'function') {
      if (task.mode === 'explicit_routing_test') this._holdExplicitRoutes(taskID, 'planner_unavailable');
      else this._hold(taskID, 'planner_unavailable');
      return;
    }
    let plan;
    try {
      // The injected planner adapter selects only task-relevant policy and
      // context for the local model. It receives the immutable host state,
      // never a model-authored replacement for that state.
      plan = validatePlan(await this.plan({task: immutable(task), catalog: immutable(catalog)}), task, catalog);
    } catch (error) {
      const reason = error instanceof RCCRuntimeError ? error.code : 'planner_failed';
      if (task.mode === 'explicit_routing_test') this._holdExplicitRoutes(taskID, reason);
      else this._hold(taskID, reason);
      return;
    }
    if (this._load(taskID).cancel_requested) { this._markCancelled(taskID); return; }
    state = this._update(taskID, 'plan_admitted', snapshot => {
      snapshot.plan = plan; snapshot.state = 'running';
      snapshot.children = plan.nodes.map(node => ({id: node.id, state: 'queued',
        attempt_id: null, candidate_id: node.candidate_id, attempts: 0, attempt_history: [],
        repair_needed: false,
        dispatched_at_ms: null, output: null, execution_verified: false,
        task_quality: 'unverified', parity_state: 'unverified', native_receipt: null,
        native_summary: null, usage: null, selected_config: null, instruction: node.instruction,
        dependencies: node.dependencies, started_at_ms: null, finished_at_ms: null}));
    });
    if (typeof this.execute !== 'function') { this._hold(taskID, 'executor_unavailable'); return; }
    await this._scheduleDAG(taskID);
  }

  _completeLocalExact(taskID, kind, output) {
    this._update(taskID, kind, snapshot => {
      if (snapshot.cancel_requested) { snapshot.state = 'cancelled'; return; }
      const now = Date.now();
      const config = {surface: 'local', transport: 'local', account_id: 'os1-core',
        model: 'none', effort: 'none', tools: [], scope: 'read_only',
        permission_profile: 'read_only', quota_pool: 'none', allowed_paths: [],
        configuration_sha256: sha(Buffer.from('os1-rcc-core-local-exact-v1'))};
      snapshot.children = [{id: 'local-core', state: 'completed', attempt_id: null,
        candidate_id: 'local-core', attempts: 0, attempt_history: [], repair_needed: false,
        dispatched_at_ms: null, output, execution_verified: true,
        task_quality: 'task_verified', parity_state: 'unverified', native_receipt: null,
        native_summary: null, usage: null, selected_config: config, instruction: snapshot.task.request,
        dependencies: [], started_at_ms: now, finished_at_ms: now}];
      snapshot.state = 'completed';
      snapshot.result = {output, execution_verified: true, task_verified: true,
        task_quality: 'task_verified', parity_state: 'unverified', native_receipt: null,
        native_summary: null, native_summaries: []};
    });
  }

  _markCancelled(taskID) {
    return this._update(taskID, 'cancelled', snapshot => {
      if (TERMINAL.has(snapshot.state)) return;
      const active = snapshot.children.some(c => c.state === 'running' && c.dispatched_at_ms !== null);
      snapshot.state = active ? 'cancelling' : 'cancelled';
      snapshot.error = active ? 'cancellation_pending_effect_reconciliation' : 'cancelled_before_dispatch';
    });
  }

  _candidate(task, catalog, node) {
    const candidate = catalog.candidates.find(c => c.id === node.candidate_id);
    assert(candidate, 'candidate_missing');
    const now = Date.now();
    assert(candidate.availability === 'available' && candidate.availability_valid_until_ms > now,
      'candidate_unavailable');
    assert(candidate.quality_state !== 'mismatch', 'candidate_quality_mismatch');
    if (candidate.quota_pool !== 'none') {
      assert(candidate.quota_pool !== 'unknown' && candidate.quota_remaining_fraction !== null &&
        candidate.quota_remaining_fraction > 0 && candidate.quota_valid_until_ms > now,
      'candidate_quota_unknown_or_exhausted');
    }
    if (task.budget.max_cost_units !== null)
      assert(candidate.estimated_cost_units !== null, 'candidate_cost_unknown');
    return candidate;
  }
  async _refreshCatalog(taskID, requiredIDs = []) {
    const prior = this._load(taskID);
    assert(prior && !prior.cancel_requested && !TERMINAL.has(prior.state), 'catalog_refresh_not_active');
    assert(typeof this.catalog === 'function', 'catalog_unavailable');
    let fresh;
    try { fresh = validateCatalog(await this.catalog(immutable(prior.task)), prior.task); }
    catch (error) { throw new RCCRuntimeError(error.code ?? 'catalog_refresh_failed'); }
    const oldRows = new Map(prior.catalog.candidates.map(c => [c.id, c]));
    const newRows = new Map(fresh.candidates.map(c => [c.id, c]));
    for (const id of requiredIDs) assert(newRows.has(id), 'selected_candidate_disappeared');
    for (const [id, row] of oldRows) {
      const updated = newRows.get(id);
      if (updated) assert(stable(exactConfig(updated)) === stable(exactConfig(row)),
        'candidate_configuration_changed');
    }
    this._update(taskID, 'catalog_refreshed_before_dispatch', snapshot => {
      assert(!snapshot.cancel_requested && !TERMINAL.has(snapshot.state), 'catalog_refresh_raced_cancel');
      snapshot.catalog = fresh;
    });
    return fresh;
  }
  _poolKey(candidate) {
    return candidate.quota_pool === 'none' ? null : `${candidate.quota_pool}:${candidate.account_id}`;
  }
  _tryReserve(candidate, task, nodeID) {
    const poolKey = this._poolKey(candidate);
    let workspaceKey = null;
    if (candidate.scope === 'workspace_write') {
      try { workspaceKey = realpathSync(task.host_context.workspace); }
      catch { throw new RCCRuntimeError('write_workspace_unavailable'); }
    }
    if (this.activeWorkers >= this.maximumWorkers ||
        (poolKey && this.poolReservations.has(poolKey)) ||
        (workspaceKey && this.activeWriteWorkspaces.has(workspaceKey))) return null;
    const lease = this.transaction(() => {
      const pool = poolKey ? this.db.prepare('SELECT task_id FROM quota_leases WHERE pool_key=?').get(poolKey) : null;
      const writer = workspaceKey ? this.db.prepare('SELECT task_id FROM write_leases WHERE workspace=?').get(workspaceKey) : null;
      if (pool && pool.task_id !== task.task_id) {
        const owner = this._load(pool.task_id);
        return owner?.state === 'effects_uncertain' ? 'uncertain_pool' : 'busy';
      }
      if (writer && writer.task_id !== task.task_id) {
        const owner = this._load(writer.task_id);
        return owner?.state === 'effects_uncertain' ? 'uncertain_workspace' : 'busy';
      }
      if (poolKey && !pool) this.db.prepare('INSERT INTO quota_leases(pool_key,task_id,acquired_ms) VALUES(?,?,?)')
        .run(poolKey, task.task_id, Date.now());
      if (workspaceKey && !writer) this.db.prepare('INSERT INTO write_leases(workspace,task_id,acquired_ms) VALUES(?,?,?)')
        .run(workspaceKey, task.task_id, Date.now());
      return 'owned';
    });
    if (lease === 'uncertain_pool') throw new RCCRuntimeError('quota_pool_effects_uncertain');
    if (lease === 'uncertain_workspace') throw new RCCRuntimeError('write_workspace_effects_uncertain');
    if (lease !== 'owned') return null;
    this.activeWorkers += 1;
    if (poolKey) this.poolReservations.add(poolKey);
    if (workspaceKey) this.activeWriteWorkspaces.add(workspaceKey);
    return {poolKey, workspaceKey, taskID: task.task_id, nodeID};
  }
  _release(reservation) {
    this.activeWorkers -= 1;
    if (reservation.poolKey) this.poolReservations.delete(reservation.poolKey);
    if (reservation.workspaceKey) this.activeWriteWorkspaces.delete(reservation.workspaceKey);
    if (reservation.poolKey && !this.closed) {
      const snapshot = this._load(reservation.taskID);
      const child = snapshot?.children.find(c => c.id === reservation.nodeID);
      if (child?.state !== 'effects_uncertain' && child?.state !== 'running') {
        this.transaction(() => this.db.prepare('DELETE FROM quota_leases WHERE pool_key=? AND task_id=?')
          .run(reservation.poolKey, reservation.taskID));
      }
    }
  }

  async _replanSubset(taskID, childID) {
    const snapshot = this._load(taskID);
    if (!snapshot || TERMINAL.has(snapshot.state) || snapshot.cancel_requested) return;
    const child = snapshot.children.find(c => c.id === childID);
    const oldNode = snapshot.plan.nodes.find(n => n.id === childID);
    if (!child?.repair_needed || !oldNode) return;
    if (child.attempts >= snapshot.task.budget.max_attempts) {
      this._update(taskID, 'safe_retry_budget_exhausted', state => {
        state.children.find(c => c.id === childID).state = 'failed';
        state.state = 'failed'; state.error = 'verified_not_dispatched_retry_exhausted';
      });
      return;
    }
    const failed = snapshot.catalog.candidates.find(c => c.id === oldNode.candidate_id);
    let fresh;
    try { fresh = await this._refreshCatalog(taskID); }
    catch (error) { this._hold(taskID, error.code ?? 'catalog_refresh_failed'); return; }
    let proposed;
    try {
      proposed = validatePlan(await this.plan({task: immutable(snapshot.task),
        catalog: immutable(fresh), repair: {
          failed_node_id: childID, failed_candidate_id: oldNode.candidate_id,
          failed_attempt_id: child.attempt_id,
          failure_receipt: child.attempt_history.at(-1)?.native_receipt ?? null,
          allowed_change: 'candidate_id_only_same_scope_and_objective'}}), snapshot.task, snapshot.catalog);
      assert(proposed.nodes.length === snapshot.plan.nodes.length, 'repair_plan_shape_changed');
      const currentByID = new Map(snapshot.plan.nodes.map(n => [n.id, n]));
      for (const next of proposed.nodes) {
        const prior = currentByID.get(next.id);
        assert(prior, 'repair_node_added');
        if (next.id === childID) {
          assert(next.candidate_id !== prior.candidate_id &&
            stable({...next, candidate_id: prior.candidate_id}) === stable(prior),
          'repair_scope_or_objective_changed');
        } else assert(stable(next) === stable(prior), 'repair_other_node_changed');
      }
      const alternate = fresh.candidates.find(c => c.id === proposed.nodes.find(n => n.id === childID).candidate_id);
      assert(alternate && alternate.scope === failed.scope &&
        alternate.permission_profile === failed.permission_profile &&
        alternate.tools.every(tool => failed.tools.includes(tool)), 'repair_authority_broadened');
      this._candidate(snapshot.task, fresh, proposed.nodes.find(n => n.id === childID));
    } catch (error) {
      this._hold(taskID, error instanceof RCCRuntimeError ? error.code : 'subset_replan_unavailable');
      return;
    }
    this._update(taskID, 'safe_subset_replanned', state => {
      state.plan = proposed;
      const node = proposed.nodes.find(n => n.id === childID);
      const target = state.children.find(c => c.id === childID);
      target.candidate_id = node.candidate_id; target.repair_needed = false;
      target.attempt_id = null; target.selected_config = null;
    });
  }

  async _waitForActiveOrTerminal(active, taskID) {
    while (active.size > 0) {
      if (TERMINAL.has(this._load(taskID)?.state)) return;
      await Promise.race([...active.values(),
        new Promise(resolve => setTimeout(resolve, 100))]);
    }
  }

  async _scheduleDAG(taskID) {
    const active = new Map();
    while (!this.closed) {
      const snapshot = this._load(taskID);
      if (!snapshot || TERMINAL.has(snapshot.state)) return;
      if (snapshot.cancel_requested && active.size === 0) { this._markCancelled(taskID); return; }
      const repair = snapshot.children.find(c => c.state === 'queued' && c.repair_needed);
      if (repair) {
        if (active.size) { await this._waitForActiveOrTerminal(active, taskID); continue; }
        await this._replanSubset(taskID, repair.id);
        continue;
      }
      // An execution-only native result is deliverable to a dependent node;
      // this is not a claim that its task quality or reference parity passed.
      const finished = new Set(snapshot.children.filter(c => c.state === 'completed').map(c => c.id));
      if (finished.size === snapshot.children.length) {
        await this._settleTask(taskID); return;
      }
      if (snapshot.children.some(c => ['failed', 'held', 'effects_uncertain'].includes(c.state))) {
        if (active.size) { await this._waitForActiveOrTerminal(active, taskID); continue; }
        const uncertain = snapshot.children.some(c => c.state === 'effects_uncertain');
        const failed = snapshot.children.some(c => c.state === 'failed');
        if (uncertain) this._update(taskID, 'task_effects_uncertain', state => {
          state.state = 'effects_uncertain'; state.error = 'child_effects_uncertain_no_replay';
        });
        else if (failed) this._update(taskID, 'task_failed', state => {
          state.state = 'failed'; state.error = 'child_failed';
        });
        else {
          const returned = snapshot.children.filter(c => c.output !== null);
          const output = returned.map(c => `${c.id}: ${c.output}`).join('\n\n');
          if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
            this._hold(taskID, 'partial_output_oversize'); return;
          }
          let receipt = null;
          if (returned.length) {
            try { receipt = await this._aggregateReceipt(taskID, returned, output); }
            catch { this._hold(taskID, 'aggregate_receipt_unavailable'); return; }
          }
          this._hold(taskID, 'child_task_quality_unverified', returned.length ? {
            output,
            execution_verified: returned.every(c => c.execution_verified), task_verified: false,
            task_quality: 'execution_only', parity_state: 'unverified',
            native_receipt: receipt,
            native_summary: returned.length === 1 ? returned[0].native_summary : null,
            native_summaries: returned.flatMap(c => c.native_summaries ??
              (c.native_summary ? [c.native_summary] : []))} : null);
        }
        return;
      }
      const cap = Math.min(snapshot.task.budget.max_parallel, this.maximumWorkers);
      const ready = snapshot.plan.nodes.filter(node => {
        const child = snapshot.children.find(c => c.id === node.id);
        return child?.state === 'queued' && node.dependencies.every(finished.has.bind(finished));
      });
      for (const node of ready) {
        if (active.size >= cap || snapshot.cancel_requested) break;
        if (node.kind === 'deterministic') {
          const value = pureArithmetic(node.instruction);
          const candidate = snapshot.catalog.candidates.find(c => c.id === node.candidate_id);
          this._update(taskID, 'deterministic_child', state => {
            const child = state.children.find(c => c.id === node.id);
            child.state = 'completed'; child.output = value;
            child.execution_verified = true; child.task_quality = 'task_verified';
            child.started_at_ms = Date.now(); child.finished_at_ms = Date.now();
            child.selected_config = exactConfig(candidate);
          });
          continue;
        }
        let candidate;
        try {
          const fresh = await this._refreshCatalog(taskID, [node.candidate_id]);
          candidate = this._candidate(snapshot.task, fresh, node);
        }
        catch (error) {
          if (active.size) await this._waitForActiveOrTerminal(active, taskID);
          if (!TERMINAL.has(this._load(taskID).state)) this._hold(taskID, error.code ?? 'candidate_unavailable');
          return;
        }
        let reservation;
        try { reservation = this._tryReserve(candidate, snapshot.task, node.id); }
        catch (error) {
          if (active.size) await this._waitForActiveOrTerminal(active, taskID);
          if (!TERMINAL.has(this._load(taskID).state)) this._hold(taskID, error.code ?? 'write_scope_unavailable');
          return;
        }
        if (!reservation) continue;
        const work = this._executeNode(taskID, node, candidate)
          .catch(error => {
            const current = this._load(taskID);
            if (current && !TERMINAL.has(current.state)) this._update(taskID, 'node_error', state => {
              const child = state.children.find(c => c.id === node.id);
              const dispatched = child?.state === 'running' && child.dispatched_at_ms !== null;
              child.state = dispatched ? 'effects_uncertain' : 'held';
              if (dispatched) child.attempt_history.at(-1).state = 'effects_uncertain';
              state.state = dispatched ? 'effects_uncertain' : 'held';
              state.error = error.code ?? (dispatched ? 'node_execution_unknown' : 'node_pre_dispatch_failed');
            });
          }).finally(() => { this._release(reservation); active.delete(node.id); });
        active.set(node.id, work);
      }
      if (active.size) {
        await Promise.race([...active.values(), new Promise(resolve => setTimeout(resolve, 100))]);
        continue;
      }
      if (ready.length) { await new Promise(resolve => setTimeout(resolve, 50)); continue; }
      this._hold(taskID, 'dag_no_ready_node'); return;
    }
  }

  _ticket(snapshot, node, candidate, attemptID) {
    const policySource = snapshot.task.host_context.owner_policy;
    const sourceSHA = policySource?.sourceSHA256 ?? policySource?.source_sha256 ?? snapshot.task.policy?.source_sha256;
    assert(HASH.test(sourceSHA ?? ''), 'policy_source_unavailable');
    const isSingleFullAgent = snapshot.plan?.nodes.length === 1 &&
      snapshot.plan.nodes[0]?.id === node.id && node.kind === 'agent';
    const resumeSession = isSingleFullAgent && candidate.surface === 'codex' ?
      snapshot.task.host_context.codex_session_id :
      isSingleFullAgent && candidate.surface === 'claude' ?
        snapshot.task.host_context.claude_session_id : null;
    assert(resumeSession === null || ID.test(resumeSession), 'native_resume_session_invalid');
    return {schema: 1, task_id: snapshot.task.task_id, node_id: node.id,
      attempt_id: attemptID, candidate_id: candidate.id,
      objective: node.instruction,
      original_request: snapshot.task.request, original_objective: snapshot.task.objective,
      request_sha256: snapshot.task.request_sha256, policy_sha256: snapshot.task.policy_sha256,
      policy_source_sha256: sourceSHA, source_fingerprint: snapshot.task.source_fingerprint,
      host_context: immutable(snapshot.task.host_context),
      native_resume_session_id: resumeSession,
      configuration_sha256: candidate.configuration_sha256,
      selected_config: exactConfig(candidate), instruction: node.instruction,
      context_refs: immutable(node.context_refs), owned_paths: immutable(node.owned_paths)};
  }
  _validateExecution(result, ticket) {
    const required = ['schema', 'task_id', 'node_id', 'attempt_id', 'candidate_id',
      'configuration_sha256', 'selected_config', 'status', 'dispatch_stage', 'side_effects',
      'execution_verified', 'task_verified', 'task_quality', 'parity_state'];
    const optional = ['acknowledged_config', 'observed_config', 'output', 'native_receipt',
      'usage', 'error', 'native_summary', 'handback', 'repair_source'];
    assert(plain(result) && required.every(key => Object.hasOwn(result, key)) &&
      Object.keys(result).every(key => required.includes(key) || optional.includes(key)) &&
      result.schema === 1 &&
      result.task_id === ticket.task_id && result.node_id === ticket.node_id &&
      result.attempt_id === ticket.attempt_id && result.candidate_id === ticket.candidate_id &&
      result.configuration_sha256 === ticket.configuration_sha256 &&
      stable(result.selected_config) === stable(ticket.selected_config) &&
      (result.acknowledged_config == null || stable(result.acknowledged_config) === stable(ticket.selected_config)) &&
      (result.observed_config == null || stable(result.observed_config) === stable(ticket.selected_config)) &&
      ['succeeded', 'failed', 'effects_uncertain'].includes(result.status) &&
      DISPATCH.has(result.dispatch_stage) && SIDE_EFFECTS.has(result.side_effects) &&
      (result.output == null || (typeof result.output === 'string' &&
        !result.output.includes('\0') && Buffer.byteLength(result.output) <= MAX_OUTPUT_BYTES)) &&
      typeof result.execution_verified === 'boolean' && typeof result.task_verified === 'boolean' &&
      TASK_QUALITY.has(result.task_quality) &&
      PARITY.has(result.parity_state) &&
      (result.native_receipt == null || boundedText(result.native_receipt, 4_096)) &&
      validUsage(result.usage) &&
      (result.error == null || boundedText(result.error, 1_024)) &&
      (result.native_summary == null || boundedText(result.native_summary, MAX_NATIVE_SUMMARY_BYTES)),
    'execution_receipt_invalid');
    if (result.status === 'succeeded' && result.task_verified)
      assert(boundedText(result.output, MAX_OUTPUT_BYTES), 'verified_empty_output');
    if (result.execution_verified) assert(result.status === 'succeeded' &&
      result.dispatch_stage === 'dispatched' && result.acknowledged_config != null &&
      result.native_receipt != null, 'executed_config_unacknowledged');
    if (result.task_verified) assert(result.execution_verified && result.task_quality === 'task_verified',
      'task_quality_upgrade_invalid');
    if (['reference_equivalent', 'reference_above'].includes(result.parity_state))
      assert(result.task_verified, 'parity_upgrade_invalid');
    if (result.handback != null) validateHandback(result.handback, ticket, result);
    if (result.repair_source != null) validateRepairSource(result.repair_source, ticket, result);
    return immutable(result);
  }

  _holdContinuation(taskID, nodeID, reason) {
    this._update(taskID, 'continuation_held', state => {
      if (TERMINAL.has(state.state)) return;
      const child = state.children.find(c => c.id === nodeID);
      if (child && ['running', 'waiting'].includes(child.state)) {
        child.state = 'held'; child.finished_at_ms = Date.now();
      }
      state.state = 'held'; state.error = reason;
    });
  }

  async _continueHandback(taskID, node, candidate, initialResult) {
    let prior = initialResult;
    let phase = prior.handback.kind === 'both' ? 'full_access_required' : prior.handback.kind;
    const reports = [{kind: 'initial', adoption: prior.handback.adoption, output: prior.output}];
    const nativeSummaries = [prior.native_summary];
    for (let phaseIndex = 0; phaseIndex < 2; phaseIndex++) {
      let snapshot = this._load(taskID);
      if (!snapshot || TERMINAL.has(snapshot.state)) return;
      if (snapshot.cancel_requested || this.stopping) { this._markCancelled(taskID); return; }
      try {
        this._authorizeHandback(snapshot, node, candidate, prior);
      } catch (error) {
        this._holdContinuation(taskID, node.id, error.code ?? 'handback_authority_unavailable'); return;
      }
      let receiptSHA;
      try { receiptSHA = await this._verifiedNativeReceiptDigest(prior); }
      catch (error) {
        this._holdContinuation(taskID, node.id, error.code ?? 'handback_native_receipt_unavailable'); return;
      }
      // The initial provider output and its exact receipt are now durable.
      // A Gateway crash here may hold this task, but never reruns that output.
      this._update(taskID, 'continuation_intent_recorded', state => {
        const child = state.children.find(c => c.id === node.id);
        child.state = 'waiting'; child.dispatched_at_ms = null;
        child.output = reports.map((report, index) =>
          `${index === 0 ? 'Initial execution report' : `Continuation ${index}`} (${report.adoption ?? 'returned'}, not task-verified):\n${report.output}`).join('\n\n');
        child.native_receipt = prior.native_receipt;
        child.native_summary = prior.native_summary;
        child.native_summaries = [...nativeSummaries];
        child.usage = prior.usage ?? null;
        child.continuation = {state: 'pending', phase, parent_attempt_id: prior.attempt_id,
          parent_native_receipt: prior.native_receipt,
          parent_native_receipt_sha256: receiptSHA,
          protected_root: prior.handback.protected_root,
          source_head: prior.handback.source_head,
          protected_source_sha256: prior.handback.protected_source_sha256};
        child.continuation_history ??= [];
        if (child.continuation_history.at(-1)?.attempt_id === prior.attempt_id)
          child.continuation_history.at(-1).native_receipt_sha256 = receiptSHA;
        else
          child.continuation_history.push({phase: phaseIndex === 0 ? 'initial' : 'after_full_access',
            attempt_id: prior.attempt_id, adoption: prior.handback.adoption,
            output: prior.output, native_receipt: prior.native_receipt,
            native_receipt_sha256: receiptSHA, native_summary: prior.native_summary,
            usage: prior.usage ?? null});
      });
      if (typeof this.executeContinuation !== 'function') {
        this._holdContinuation(taskID, node.id, 'continuation_executor_unavailable'); return;
      }
      snapshot = this._load(taskID);
      if (snapshot.cancel_requested || this.stopping) { this._markCancelled(taskID); return; }
      if (snapshot.children.find(c => c.id === node.id).attempts >= snapshot.task.budget.max_attempts) {
        this._holdContinuation(taskID, node.id, 'continuation_attempt_budget_exhausted'); return;
      }
      if (Date.now() - snapshot.created_at_ms >= snapshot.task.budget.max_duration_ms) {
        this._holdContinuation(taskID, node.id, 'continuation_duration_budget_exhausted'); return;
      }
      try {
        const fresh = await this._refreshCatalog(taskID, [candidate.id]);
        this._candidate(snapshot.task, fresh, node);
      } catch (error) {
        this._holdContinuation(taskID, node.id, error.code ?? 'continuation_candidate_unavailable'); return;
      }
      snapshot = this._load(taskID);
      if (snapshot.cancel_requested || this.stopping) { this._markCancelled(taskID); return; }
      const continuationAttemptID = randomUUID();
      const ticket = this._ticket(snapshot, node, candidate, continuationAttemptID);
      ticket.native_resume_session_id = phase === 'full_access_required' ? prior.handback.native_session_id : null;
      ticket.continuation = {kind: phase, parent_attempt_id: prior.attempt_id,
        parent_native_receipt: prior.native_receipt,
        parent_native_receipt_sha256: receiptSHA,
        native_session_id: prior.handback.native_session_id,
        protected_root: prior.handback.protected_root,
        source_head: prior.handback.source_head,
        protected_source_sha256: prior.handback.protected_source_sha256,
        source_fingerprint: snapshot.task.source_fingerprint,
        request_sha256: snapshot.task.request_sha256};
      this._update(taskID, 'continuation_dispatch_started', state => {
        const child = state.children.find(c => c.id === node.id);
        child.state = 'running'; child.attempt_id = continuationAttemptID;
        child.attempts += 1; child.dispatched_at_ms = Date.now();
        child.continuation.state = 'dispatched';
        child.attempt_history.push({attempt_id: continuationAttemptID,
          candidate_id: candidate.id, state: 'continuation_dispatch_started',
          native_receipt: null, usage: null});
      });
      const controller = new AbortController();
      this.controllers.set(continuationAttemptID, {taskID, controller});
      let result;
      try {
        result = this._validateExecution(await this.executeContinuation(immutable(ticket), controller.signal), ticket);
      } catch (error) {
        this.controllers.delete(continuationAttemptID);
        if (!this.closed && !TERMINAL.has(this._load(taskID)?.state))
          this._update(taskID, 'continuation_effects_uncertain', state => {
            const child = state.children.find(c => c.id === node.id);
            child.state = 'effects_uncertain'; child.continuation.state = 'effects_uncertain';
            child.attempt_history.at(-1).state = 'effects_uncertain';
            state.state = 'effects_uncertain';
            state.error = error instanceof RCCRuntimeError ? error.code : 'continuation_outcome_unknown';
          });
        return;
      }
      this.controllers.delete(continuationAttemptID);
      if (this.closed || TERMINAL.has(this._load(taskID)?.state)) return;
      if (this._load(taskID).cancel_requested || this.stopping) {
        this._update(taskID, 'continuation_cancel_reconciled', state => {
          const child = state.children.find(c => c.id === node.id);
          const safe = result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
            result.side_effects === 'none' && result.native_receipt !== null;
          child.state = safe ? 'cancelled' : 'effects_uncertain';
          child.continuation.state = child.state;
          child.attempt_history.at(-1).state = child.state;
          child.attempt_history.at(-1).native_receipt = result.native_receipt;
          state.state = child.state; state.error = safe ? 'continuation_cancelled_before_dispatch' :
            'continuation_cancel_effects_uncertain';
        });
        return;
      }
      if (result.status !== 'succeeded' || !result.execution_verified) {
        if (result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
            result.side_effects === 'none' && result.native_receipt !== null)
          this._holdContinuation(taskID, node.id, 'continuation_verified_not_dispatched');
        else this._update(taskID, 'continuation_failed_after_dispatch', state => {
          const child = state.children.find(c => c.id === node.id);
          child.state = 'effects_uncertain'; child.continuation.state = 'effects_uncertain';
          state.state = 'effects_uncertain'; state.error = 'continuation_dispatched_failure_no_replay';
        });
        return;
      }
      if (!boundedText(result.output, MAX_OUTPUT_BYTES)) {
        this._holdContinuation(taskID, node.id, 'continuation_empty_result'); return;
      }
      reports.push({kind: phase, adoption: result.handback?.adoption ?? 'returned', output: result.output});
      if (result.native_summary) nativeSummaries.push(result.native_summary);
      this._update(taskID, 'continuation_returned', state => {
        const child = state.children.find(c => c.id === node.id);
        child.attempt_history.at(-1).state = 'continuation_returned';
        child.attempt_history.at(-1).native_receipt = result.native_receipt;
        child.attempt_history.at(-1).usage = result.usage ?? null;
        child.state = 'waiting'; child.continuation.state = 'pending'; child.dispatched_at_ms = null;
        child.output = reports.map((report, index) =>
          `${index === 0 ? 'Initial execution report' : `Continuation ${index}`} (${report.adoption}, not task-verified):\n${report.output}`).join('\n\n');
        child.native_receipt = result.native_receipt;
        child.native_summary = result.native_summary ?? null;
        child.native_summaries = [...nativeSummaries]; child.usage = result.usage ?? null;
        child.continuation_history.push({phase, attempt_id: result.attempt_id,
          adoption: result.handback?.adoption ?? 'returned', output: result.output,
          native_receipt: result.native_receipt, native_summary: result.native_summary ?? null,
          usage: result.usage ?? null});
      });
      if (result.handback) {
        if (phase === 'full_access_required' && result.handback.kind === 'os1_change_required') {
          prior = result; phase = 'os1_change_required'; continue;
        }
        this._holdContinuation(taskID, node.id, 'continuation_marker_cycle_or_unexpected'); return;
      }
      if (result.repair_source) {
        await this._stageSourceAfterExecution(taskID, node, candidate, result, ticket);
        return;
      }
      if (phase === 'full_access_required' && initialResult.handback.kind === 'both') {
        this._holdContinuation(taskID, node.id, 'os1_change_not_confirmed_after_full_access'); return;
      }
      const output = reports.map((report, index) =>
        `${index === 0 ? 'Initial execution report' : `Continuation ${index}`} (${report.adoption}, not task-verified):\n${report.output}`).join('\n\n');
      if (!boundedText(output, MAX_OUTPUT_BYTES)) {
        this._holdContinuation(taskID, node.id, 'continuation_combined_output_oversize'); return;
      }
      this._update(taskID, 'continuation_candidate_returned', state => {
        const child = state.children.find(c => c.id === node.id);
        child.state = 'completed'; child.output = output; child.finished_at_ms = Date.now();
        child.execution_verified = true; child.task_quality = 'execution_only';
        child.parity_state = 'unverified'; child.native_receipt = result.native_receipt;
        child.native_summary = result.native_summary;
        child.native_summaries = [...nativeSummaries]; child.usage = result.usage ?? null;
        child.continuation.state = 'returned';
      });
      return;
    }
    this._holdContinuation(taskID, node.id, 'continuation_phase_limit_reached');
  }

  async _executeNode(taskID, node, candidate) {
    const task = this._load(taskID).task;
    for (let attempt = this._load(taskID).children.find(c => c.id === node.id).attempts + 1;
         attempt <= task.budget.max_attempts; attempt++) {
      const before = this._load(taskID);
      if (before.cancel_requested || this.stopping) { this._markCancelled(taskID); return; }
      if (Date.now() - before.created_at_ms >= task.budget.max_duration_ms) {
        this._hold(taskID, 'task_duration_budget_exhausted'); return;
      }
      if (task.budget.max_cost_units !== null &&
          before.spent_cost_units + candidate.estimated_cost_units > task.budget.max_cost_units) {
        this._hold(taskID, 'task_cost_budget_exhausted'); return;
      }
      const attemptID = randomUUID();
      const ticket = this._ticket(before, node, candidate, attemptID);
      this._update(taskID, 'dispatch_started', snapshot => {
        const child = snapshot.children.find(c => c.id === node.id);
        child.state = 'running'; child.attempt_id = attemptID; child.attempts += 1;
        child.dispatched_at_ms = Date.now();
        child.started_at_ms ??= child.dispatched_at_ms;
        child.selected_config = exactConfig(candidate);
        child.attempt_history.push({attempt_id: attemptID, candidate_id: candidate.id,
          state: 'dispatch_started', native_receipt: null, usage: null});
        if (candidate.estimated_cost_units !== null) snapshot.spent_cost_units += candidate.estimated_cost_units;
      });
      const controller = new AbortController();
      this.controllers.set(attemptID, {taskID, controller});
      let result;
      try { result = this._validateExecution(await this.execute(immutable(ticket), controller.signal), ticket); }
      catch (error) {
        this.controllers.delete(attemptID);
        if (!this.closed) this._update(taskID, 'dispatch_effects_uncertain', snapshot => {
          const child = snapshot.children.find(c => c.id === node.id);
          child.state = 'effects_uncertain'; snapshot.state = 'effects_uncertain';
          snapshot.error = error instanceof RCCRuntimeError ? error.code : 'executor_return_unknown';
        });
        return;
      }
      this.controllers.delete(attemptID);
      if (this.closed) return;
      const current = this._load(taskID);
      if (TERMINAL.has(current.state)) return;
      if (current.cancel_requested || this.stopping) {
        this._update(taskID, 'cancel_reconciled', snapshot => {
          const child = snapshot.children.find(c => c.id === node.id);
          const safe = result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
            result.side_effects === 'none' && result.native_receipt !== null;
          child.state = safe ? 'cancelled' : 'effects_uncertain';
          child.finished_at_ms = Date.now();
          child.attempt_history.at(-1).state = child.state;
          child.attempt_history.at(-1).native_receipt = result.native_receipt;
          child.usage = result.usage ?? null;
          child.attempt_history.at(-1).usage = result.usage ?? null;
          snapshot.state = safe ? 'cancelled' : 'effects_uncertain';
          snapshot.error = safe ? 'cancelled_before_backend_dispatch' : 'cancel_effects_uncertain';
        });
        return;
      }
      if (result.handback) {
        await this._continueHandback(taskID, node, candidate, result);
        return;
      }
      if (result.repair_source) {
        await this._stageSourceAfterExecution(taskID, node, candidate, result, ticket);
        return;
      }
      if (result.status === 'succeeded') {
        this._update(taskID, 'child_returned', snapshot => {
          const child = snapshot.children.find(c => c.id === node.id);
          child.output = result.output; child.execution_verified = result.execution_verified;
          child.task_quality = result.task_quality; child.parity_state = result.parity_state;
          child.native_receipt = result.native_receipt;
          child.native_summary = result.native_summary ?? null;
          child.usage = result.usage ?? null;
          child.finished_at_ms = Date.now();
          child.state = result.execution_verified &&
            ['execution_only', 'task_verified'].includes(result.task_quality) &&
            boundedText(result.output, MAX_OUTPUT_BYTES) ? 'completed' : 'held';
          child.attempt_history.at(-1).state = child.state;
          child.attempt_history.at(-1).native_receipt = result.native_receipt;
          child.attempt_history.at(-1).usage = result.usage ?? null;
        });
        return;
      }
      if (result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
          result.side_effects === 'none' && result.native_receipt !== null) {
        if (attempt < task.budget.max_attempts) {
          this._update(taskID, 'safe_retry_requires_subset_plan', snapshot => {
            const child = snapshot.children.find(c => c.id === node.id);
            child.state = 'queued'; child.dispatched_at_ms = null; child.repair_needed = true;
            child.attempt_history.at(-1).state = 'verified_not_dispatched';
            child.attempt_history.at(-1).native_receipt = result.native_receipt;
            child.usage = result.usage ?? null;
            child.attempt_history.at(-1).usage = result.usage ?? null;
          });
          return;
        }
        this._update(taskID, 'child_failed_without_effect', snapshot => {
          const child = snapshot.children.find(c => c.id === node.id);
          child.state = 'failed'; child.attempt_history.at(-1).state = 'failed';
          child.attempt_history.at(-1).native_receipt = result.native_receipt;
          child.usage = result.usage ?? null;
          child.attempt_history.at(-1).usage = result.usage ?? null;
          child.finished_at_ms = Date.now();
          snapshot.state = 'failed'; snapshot.error = 'verified_not_dispatched_retry_exhausted';
        });
        return;
      }
      this._update(taskID, 'child_effects_uncertain', snapshot => {
        const child = snapshot.children.find(c => c.id === node.id);
        child.state = 'effects_uncertain'; child.attempt_history.at(-1).state = 'effects_uncertain';
        child.attempt_history.at(-1).native_receipt = result.native_receipt;
        child.usage = result.usage ?? null;
        child.attempt_history.at(-1).usage = result.usage ?? null;
        child.finished_at_ms = Date.now();
        snapshot.state = 'effects_uncertain'; snapshot.error = 'dispatched_failure_no_replay';
      });
      return;
    }
  }

  async _settleTask(taskID) {
    const snapshot = this._load(taskID);
    if (!snapshot || snapshot.cancel_requested || snapshot.state !== 'running') return;
    const byID = new Map(snapshot.children.map(c => [c.id, c]));
    const ordered = snapshot.plan.nodes.map(n => byID.get(n.id));
    // A single native answer is already the user's result. Never add a node
    // label: exact-output tasks (including "Reply with hello only") must
    // preserve the returned bytes. Multi-node output remains visibly labelled
    // unless an explicit final integration node was planned and executed.
    const candidateOutput = snapshot.plan.final_node_id ? byID.get(snapshot.plan.final_node_id)?.output :
      ordered.length === 1 ? ordered[0].output :
        ordered.map(c => `${c.id}: ${c.output}`).join('\n\n');
    const output = candidateOutput ?? '';
    if (!boundedText(output, MAX_OUTPUT_BYTES)) {
      this._hold(taskID, 'combined_output_empty_or_oversize'); return;
    }
    if (typeof this.verifyTask !== 'function') {
      let receipt;
      try { receipt = await this._aggregateReceipt(taskID, ordered, output); }
      catch { this._hold(taskID, 'aggregate_receipt_unavailable'); return; }
      this._hold(taskID, 'parent_task_verifier_unavailable', {
        output, execution_verified: true, task_verified: false,
        task_quality: 'execution_only', parity_state: 'unverified', native_receipt: receipt,
        native_summary: ordered.length === 1 ? ordered[0].native_summary : null,
        native_summaries: ordered.flatMap(c => c.native_summaries ??
          (c.native_summary ? [c.native_summary] : []))});
      return;
    }
    let verdict;
    try {
      verdict = await this.verifyTask({task: immutable(snapshot.task), plan: immutable(snapshot.plan),
        children: immutable(snapshot.children)});
      assert(keys(verdict, ['schema', 'task_id', 'task_verified', 'output', 'parity_state', 'reason']) &&
        verdict.schema === 1 && verdict.task_id === taskID &&
        typeof verdict.task_verified === 'boolean' &&
        (verdict.output === null || (typeof verdict.output === 'string' &&
          !verdict.output.includes('\0') && Buffer.byteLength(verdict.output) <= MAX_OUTPUT_BYTES)) &&
        PARITY.has(verdict.parity_state) && boundedText(verdict.reason, 1_024),
      'task_verdict_invalid');
      if (['reference_equivalent', 'reference_above'].includes(verdict.parity_state))
        assert(verdict.task_verified === true && verdict.output !== null, 'task_parity_upgrade_invalid');
    } catch { verdict = {task_verified: false, output: null, parity_state: 'unverified', reason: 'task_verifier_unavailable'}; }
    const verified = verdict.task_verified === true && verdict.output !== null;
    const finalOutput = verdict.output ?? output;
    if (!boundedText(finalOutput, MAX_OUTPUT_BYTES)) {
      this._hold(taskID, 'task_output_empty_or_oversize'); return;
    }
    let receipt;
    try { receipt = await this._aggregateReceipt(taskID, ordered, finalOutput); }
    catch { this._hold(taskID, 'aggregate_receipt_unavailable'); return; }
    this._update(taskID, verified ? 'task_completed' : 'task_returned_unverified', state => {
      if (state.cancel_requested) { state.state = 'effects_uncertain'; state.error = 'cancel_during_adoption'; return; }
      state.state = verified ? 'completed' : 'returned_unverified';
      state.result = {output: finalOutput, execution_verified: true,
        task_verified: verified, task_quality: verified ? 'task_verified' : 'execution_only',
        parity_state: verdict.parity_state, native_receipt: receipt,
        native_summary: ordered.length === 1 ? ordered[0].native_summary : null,
        native_summaries: ordered.flatMap(c => c.native_summaries ??
          (c.native_summary ? [c.native_summary] : []))};
      state.error = verified ? null : verdict.reason;
    });
  }

  async close({timeoutMs = 3_000} = {}) {
    if (this.closed) return;
    assert(int(timeoutMs, 0, 60_000), 'close_timeout_invalid');
    this.stopping = true;
    for (const item of this.controllers.values()) item.controller.abort(new RCCRuntimeError('runtime_closing'));
    await Promise.race([Promise.allSettled([...this.runningTasks.values(), ...this.installationObservations.values()]),
      new Promise(resolve => setTimeout(resolve, timeoutMs))]);
    const rows = this.transaction(() => this.db.prepare('SELECT task_id,snapshot FROM tasks').all());
    for (const row of rows) {
      const state = JSON.parse(row.snapshot);
      if (!['running', 'cancelling', 'planning'].includes(state.state)) continue;
      const dispatched = state.children.some(c => c.state === 'running' && c.dispatched_at_ms !== null);
      this._update(row.task_id, 'owner_stopping', snapshot => {
        snapshot.state = dispatched ? 'effects_uncertain' : 'held';
        snapshot.error = dispatched ? 'owner_stopped_active_dispatch' : 'owner_stopped_before_dispatch';
        for (const child of snapshot.children) if (child.state === 'running')
          child.state = dispatched ? 'effects_uncertain' : 'held';
      });
    }
    for (const row of rows) this._releaseSafeLeases(row.task_id);
    this.transaction(() => this.db.prepare('DELETE FROM owner WHERE id=1 AND token=?').run(this.token));
    this.closed = true; this.db.close();
  }
}
