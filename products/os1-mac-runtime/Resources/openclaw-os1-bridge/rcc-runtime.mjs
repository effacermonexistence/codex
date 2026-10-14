import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open } from 'node:fs/promises';
import { closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
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
// GPT surfaces stay decodable for old receipts, but are no longer routed.
const DROPPED_ROUTE_SURFACES = new Set(['chatgpt', 'gpt-chat']);
const EXCLUSION_PROVIDERS = new Set(['codex', 'claude']);
const EXCLUSION_REASONS = new Set(['signed_out', 'non_subscription', 'model_unavailable', 'quota_zero',
  'capacity_zero', 'codex_hidden', 'effort_requires_explicit_request', 'explicit_constraint_unavailable',
  'chat_gate_refused', 'gpt_dropped', 'quota_backoff', 'reference_unavailable']);
// The one typed execution reason that lets a started backend process count as
// a verified no-effect attempt: the provider's own stream proved a quota
// rejection before any work, on a read-only attempt with an unchanged
// workspace. Core then re-resolves the node to another pool.
const PROVIDER_QUOTA_REJECTED_BEFORE_EXECUTION = 'provider_quota_rejected_before_execution';
const TRANSPORTS = new Set(['local', 'codex_app_server', 'claude_cli', 'chatgpt_service', 'claude_service']);
const SCOPES = new Set(['read_only', 'workspace_write']);
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']);
// Deterministic host routing. The catalog's own row order already encodes
// pool preference (capacity share, fresh quota, reset time) and, within a
// pool, model strength. Owner objective: the SAME result as the newest top
// model at its highest (max) reasoning, while spending less quota.
//
// Dynamic tier routing (build 378), on a catalog that carries `model_tiers`
// (each model's provider-stated tier): REVAS at the front. The planner grades
// each node (route_class) and the host binds the cheapest tier/effort expected
// to give the same result (TIER_ROUTES), first dispatchable entry wins in the
// first pool that can serve the class; when no pool can, trivial work runs
// at standard (upwards only, never below the grade). A read-only node bound
// below its pool's reference (the frontier model at its highest effort up to
// max) is re-dispatched ONCE at the reference on any failure signal, and held
// when no reference can run then; a write is never escalated. The tier
// choice is the admission: no ledger parity is needed.
//
// A catalog WITHOUT `model_tiers` (older hosts and persisted catalogs) keeps
// the 2026-10-13 reference routing: every node binds a pool's REFERENCE route
// (its first model at the highest offered effort up to max), and a cheaper
// effort of that model needs the REVAS ladder gate (cheaperRouteAdmission).
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode'];
export const ROUTE_CLASSES = Object.freeze(['trivial', 'standard', 'deep']);
// Provider-stated model tiers, strongest first (Swift ModelTiers is the owner).
export const MODEL_TIERS = Object.freeze(['frontier', 'workhorse', 'efficient', 'fast']);
// A tier-list effort that means the model's reference effort: its highest
// offered effort up to max (max on every production frontier profile).
const REFERENCE_EFFORT = 'reference';
// Ordered (tier, effort) preferences per graded class: the first entry with a
// dispatchable row in a pool wins. Deep work only ever runs the reference.
export const TIER_ROUTES = Object.freeze({
  trivial: Object.freeze([['fast', 'low'], ['efficient', 'low'], ['workhorse', 'low']]),
  standard: Object.freeze([['workhorse', 'medium'], ['efficient', 'medium'], ['workhorse', 'high'],
    ['workhorse', 'xhigh'], ['frontier', REFERENCE_EFFORT]]),
  deep: Object.freeze([['frontier', REFERENCE_EFFORT]]),
});
const MAX_REFERENCE_EFFORT = EFFORT_ORDER.indexOf('max');
// Above max: chosen only when the owner explicitly asked (catalog routing_intent).
const EXPLICIT_ONLY_EFFORTS = new Set(['ultra', 'ultracode']);
const INTENT_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const INTENT_FAMILY = /^[a-z][a-z0-9]{1,31}$/;
// REVAS ladder gate: a cheaper effort of the SAME model in the SAME pool needs
// a registered task verifier for the family and this much ledger parity.
export const LADDER_MIN_VERIFIED_PASSES = 20;
const LADDER_MAX_VERIFIER_FAILURES = 0;
// Routing ledger: one bounded, private, append-only JSONL record per settled
// attempt (ids and routing facts only; no request text, output or path).
const LEDGER_DIRECTORY = 'routing-ledger';
const LEDGER_FILE = 'routing-ledger.jsonl';
const LEDGER_ROTATED_FILE = 'routing-ledger.1.jsonl';
// Never rotated: every failure ever recorded per (family, model, effort), so
// rotation can never make a failed cheaper route look clean again.
const LEDGER_FAILURE_INDEX = 'routing-ledger-failures.json';
const MAX_LEDGER_BYTES = 4_194_304;
const MAX_LEDGER_RECORD_BYTES = 8_192;
const MAX_LEDGER_FAILURE_KEYS = 1_024;
const MAX_LEDGER_FAILURE_INDEX_BYTES = 524_288;
// Ledger verifier outcomes that count against a route's parity: its verifier
// failed, it ran and returned nothing deliverable, or it was interrupted
// before its verifier answered.
const LEDGER_FAILURE_OUTCOMES = new Set(['fail', 'not_returned', 'interrupted']);
// Verdicts a settled attempt stores on its history entry; a restart records
// them as they were instead of 'interrupted'.
const SETTLED_VERDICTS = new Set(['pass', 'fail', 'not_returned']);
// A registered node verifier that does not answer in time counts as a failure.
const NODE_VERIFIER_TIMEOUT_MS = 60_000;
// The attempt states of a failed cheaper ladder attempt: its verifier failed,
// or it returned nothing deliverable. Never charged to the owner's budgets.
const LADDER_FAILED_STATES = new Set(['ladder_verifier_failed', 'ladder_not_returned']);
// Attempt states that are not settled yet (a ledger record names them
// 'interrupted' when a stop or restart settles the attempt instead).
const UNSETTLED_ATTEMPT_STATES = new Set(['dispatch_started', 'continuation_dispatch_started', 'node_verifier_pending']);
const UNSETTLED_DISPATCH_STATES = new Set(['dispatch_started', 'continuation_dispatch_started']);
// Separate from the attempt budget: how often one node's host-resolved row may
// be replaced after a pre-dispatch failure, always within the same scope.
const MAX_RE_RESOLUTIONS = 2;
const RE_RESOLVABLE_FAILURES = new Set(['candidate_unavailable', 'candidate_quota_unknown_or_exhausted',
  'candidate_missing', 'selected_candidate_disappeared']);
// A native catalog probe that failed (not a binding/configuration change) is
// retried this many times before the task is held.
const MAX_TRANSIENT_REFRESH_FAILURES = 3;
// How often one not-yet-dispatched graded node may move between pools for
// parallelism (not a failure, so not a re-resolution). Bounded so two pools
// whose leases keep flipping can never move a node forever.
const MAX_POOL_SPREADS = 4;
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

/** The explicit routes that still run. A GPT/ChatGPT-named route is dropped,
 * never substituted; the immutable host contract keeps the original list. */
export function effectiveExplicitRoutes(task) {
  const routes = task?.host_context?.explicit_routes;
  return Array.isArray(routes) ? routes.filter(route => !DROPPED_ROUTE_SURFACES.has(route.surface)) : routes;
}
function droppedExplicitRoutes(task) {
  const routes = task?.host_context?.explicit_routes;
  return Array.isArray(routes) ? routes.filter(route => DROPPED_ROUTE_SURFACES.has(route.surface)) : [];
}
function validCapacityPlan(plan) {
  return plan === undefined || plan === null || (keys(plan, ['codex', 'claude']) &&
    int(plan.codex, 0, 100) && int(plan.claude, 0, 100) && plan.codex + plan.claude > 0);
}

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
  const hostOptionalKeys = ['explicit_routes', 'conversation_id', 'submission_id', 'capacity_plan'];
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
    validCapacityPlan(h.capacity_plan) &&
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

/** The one dispatch rule. Returns null when the row may be dispatched now,
 * otherwise the exact hold/failure code _candidate has always used. */
function dispatchFailure(candidate, task, now) {
  if (!(candidate.availability === 'available' && candidate.availability_valid_until_ms > now))
    return 'candidate_unavailable';
  if (candidate.quality_state === 'mismatch') return 'candidate_quality_mismatch';
  if (candidate.quota_pool !== 'none' && !(candidate.quota_pool !== 'unknown' &&
      candidate.quota_remaining_fraction !== null && candidate.quota_remaining_fraction > 0 &&
      candidate.quota_valid_until_ms > now))
    return 'candidate_quota_unknown_or_exhausted';
  if ((task?.budget?.max_cost_units ?? null) !== null && candidate.estimated_cost_units === null)
    return 'candidate_cost_unknown';
  return null;
}
/** Same rule as _candidate. Unknown or stale rows stay catalog evidence only. */
export function dispatchable(candidate, task, now = Date.now()) {
  return dispatchFailure(candidate, task, now) === null;
}
// A dropped GPT surface stays decodable but is never chosen by the host.
function hostRoutable(candidate) { return !DROPPED_ROUTE_SURFACES.has(candidate.surface); }
function coversOwnedPaths(candidate, ownedPaths) {
  return candidate.allowed_paths.includes('**') ?
    stable(ownedPaths) === stable(['**']) :
    ownedPaths.every(path => candidate.allowed_paths.some(allowed => path === allowed || path.startsWith(allowed + '/')));
}
function providerOfPool(pool) {
  return pool === 'openai_codex' ? 'codex' : pool === 'anthropic_shared' ? 'claude' : pool === 'none' ? 'local' : pool;
}
function scopesAllowed(task) {
  return task.host_context?.require_read_only === true ? ['read_only'] : ['read_only', 'workspace_write'];
}

/** Whether a catalog row can carry this node at all (scope, surface kind and
 * write authority), before any dispatchability or avoidance. `anyPaths` is
 * for the availability summary, which has no planned paths yet. */
function eligibleRow(c, node, {widenWrites = false, anyPaths = false} = {}) {
  if (c.scope !== node.scope || !hostRoutable(c)) return false;
  if (node.kind === 'deterministic' ? !(c.surface === 'local' && c.transport === 'local' &&
      c.quota_pool === 'none' && c.tools.length === 0) : c.surface === 'local') return false;
  return node.scope !== 'workspace_write' || anyPaths || coversOwnedPaths(c, node.owned_paths) ||
    (widenWrites && c.allowed_paths.includes('**'));
}
function surfaceKind(surface) { return surface === 'local' ? 'local' : surface.endsWith('-chat') ? 'chat' : 'agent'; }
/** The task-family label used by the verifier registry and the ledger. */
export function routeFamily(routeClass, scope, surface) {
  return `${routeClass ?? 'unclassified'}:${scope}:${surfaceKind(surface)}`;
}
function routingIntent(catalog) { return catalog?.routing_intent ?? null; }
/** The reference effort of one model's rows. An explicit owner effort that
 * the model offers is a hard constraint. Otherwise the highest offered effort
 * up to max; ultra/ultracode only when the owner explicitly asked for one.
 * Null when the model offers nothing usable by default. */
function referenceEffort(rows, intent) {
  const offered = rows.map(c => c.effort);
  if (intent?.effort && offered.includes(intent.effort)) return intent.effort;
  const capped = offered.filter(effort => EFFORT_ORDER.indexOf(effort) <= MAX_REFERENCE_EFFORT);
  const pool = capped.length ? capped : EXPLICIT_ONLY_EFFORTS.has(intent?.effort) ? offered : [];
  return pool.length ? EFFORT_ORDER[Math.max(...pool.map(effort => EFFORT_ORDER.indexOf(effort)))] : null;
}
/** Per quota pool, in catalog order: the pool's reference model (its first,
 * i.e. most-preferred, model in catalog order among rows that can carry this
 * node) with that model's rows and reference effort. Dispatchability is NOT
 * used to pick the model: an undispatchable top model makes its pool unusable
 * for this node instead of silently substituting a lower model. The native
 * builder keeps that true for a top model that cannot run at all (quota_zero,
 * quota_backoff, an effort word it lacks): it withholds the whole pool
 * (reference_unavailable) rather than let its next model lead the pool. */
function poolReferences(node, catalog, options = {}) {
  const intent = routingIntent(catalog);
  const pools = new Map();
  catalog.candidates.forEach((candidate, index) => {
    if (!eligibleRow(candidate, node, options)) return;
    if (!pools.has(candidate.quota_pool))
      pools.set(candidate.quota_pool, {pool: candidate.quota_pool, model: candidate.model, rows: []});
    const entry = pools.get(candidate.quota_pool);
    if (candidate.model === entry.model) entry.rows.push({candidate, index});
  });
  return [...pools.values()].map(entry => ({...entry,
    effort: referenceEffort(entry.rows.map(row => row.candidate), intent)}));
}
function referenceRows(reference) {
  return reference.effort === null ? [] :
    reference.rows.filter(row => row.candidate.effort === reference.effort).map(row => row.candidate);
}

// ---- Dynamic tier routing (build 378) ----
/** The catalog's provider-stated model tiers, or null for an older catalog
 * (which keeps the former reference routing). */
function modelTiers(catalog) { return plain(catalog?.model_tiers) ? catalog.model_tiers : null; }
function tierOf(catalog, model) {
  const tier = modelTiers(catalog)?.[model];
  return MODEL_TIERS.includes(tier) ? tier : null;
}
function tierRank(catalog, model) {
  const tier = tierOf(catalog, model);
  return tier === null ? MODEL_TIERS.length : MODEL_TIERS.indexOf(tier);
}
/** The class a graded node is routed at: a missing or invalid grade is
 * standard, and a writer never runs below standard. */
function effectiveRouteClass(routeClass, scope) {
  const graded = ROUTE_CLASSES.includes(routeClass) ? routeClass : 'standard';
  return scope === 'workspace_write' && graded === 'trivial' ? 'standard' : graded;
}
/** A row tier routing may bind for a graded node: a tiered model, or any
 * model of a family the owner explicitly named. A model with no tier is never
 * chosen by tier alone. */
function tierRoutable(candidate, catalog) {
  return Boolean(routingIntent(catalog)?.model_family) || tierOf(catalog, candidate.model) !== null;
}
/** The rows that can carry this node, per quota pool, in catalog order. */
function poolRows(node, catalog, options = {}) {
  const pools = new Map();
  catalog.candidates.forEach((candidate, index) => {
    if (!eligibleRow(candidate, node, options)) return;
    if (!pools.has(candidate.quota_pool)) pools.set(candidate.quota_pool, {pool: candidate.quota_pool, rows: []});
    pools.get(candidate.quota_pool).rows.push({candidate, index});
  });
  return [...pools.values()];
}
/** The rows of one pool that match one (tier, effort) entry. A REFERENCE
 * effort is the highest effort up to max that the entry's tier (or, for an
 * explicitly named family, the family) offers in this pool. */
function entryRows(rows, entry, catalog, intent) {
  const matching = rows.filter(({candidate}) => tierRoutable(candidate, catalog) &&
    (entry.tier === null || tierOf(catalog, candidate.model) === entry.tier));
  const effort = entry.effort === REFERENCE_EFFORT ? referenceEffort(matching.map(row => row.candidate), intent) :
    entry.effort;
  return effort === null ? [] : matching.filter(({candidate}) => candidate.effort === effort);
}
/** A pool's REFERENCE rows: its frontier-tier model at the highest effort up
 * to max it offers. Empty when the pool offers no frontier model: nothing
 * lower stands in for it. */
function tierReferenceRows(rows, catalog, intent = null) {
  return entryRows(rows, {tier: 'frontier', effort: REFERENCE_EFFORT}, catalog, intent);
}
/** The ordered entries of one class. An explicit owner effort replaces each
 * entry's effort (the class still picks the tier, deep stays frontier); an
 * explicit model family keeps only the efforts (the family is the model). */
function tierEntries(routeClass, intent) {
  const list = TIER_ROUTES[routeClass];
  if (intent?.model_family) {
    const efforts = intent.effort ? [intent.effort] : [...new Set(list.map(([, effort]) => effort))];
    return efforts.map((effort, index) => ({index, tier: null, effort}));
  }
  if (intent?.effort)
    return [...new Set(list.map(([tier]) => tier))].map((tier, index) => ({index, tier, effort: intent.effort}));
  return list.map(([tier, effort], index) => ({index, tier, effort}));
}

/** The classes a node of this scope can be routed at: a writer runs at least
 * standard (a trivial write is promoted). */
function scopeClasses(scope) { return scope === 'workspace_write' ? ['standard', 'deep'] : ROUTE_CLASSES; }
/** The rows of one pool that tier routing could ever bind for a node of this
 * scope: the union of every entry of every class reachable in the scope (the
 * trivial class's upward fallback adds nothing beyond standard). A row whose
 * tier or effort is no entry of any reachable class (for example a fast-tier
 * writer) can never run, so availability must not count it. */
function bindableRows(rows, scope, catalog, intent) {
  const ids = new Set();
  for (const routeClass of scopeClasses(scope))
    for (const entry of tierEntries(routeClass, intent))
      for (const row of entryRows(rows, entry, catalog, intent)) ids.add(row.candidate.id);
  return rows.filter(row => ids.has(row.candidate.id)).map(row => row.candidate);
}
// When no pool can serve a graded class with its own entries, it runs at the
// next stronger class instead of holding: never downwards (no stand-in below
// the grade). Standard already ends at the frontier reference; deep is the
// reference only.
const CLASS_FALLBACK = Object.freeze({trivial: 'standard'});

/** Pick the exact row for one node on a tier-routed catalog.
 * Pools go in catalog order (an avoided pool last, a preferred pool first);
 * in each pool the class's entries are tried in order and the first entry
 * with a dispatchable row wins (a read-only node takes the gated chat row of
 * the same model and effort first). A pool that cannot offer any entry of the
 * class is skipped. When no pool can serve the class, it falls back upwards
 * (trivial runs standard, recorded as class_fallback_trivial_to_standard);
 * deep is never relaxed. `referenceOnly` routes as deep: the frontier
 * reference only (a REVAS escalation and its re-resolution). A read-only
 * agent node bound below its pool's reference carries `ladder`, its one
 * escalation guard: this pool's reference, else the other pool's; when no
 * pool offers a frontier reference at all the guard has no target
 * (reference_candidate_id null) and a failure signal holds the node
 * (ladder_reference_unavailable) instead of adopting the cheaper answer. An
 * explicit owner constraint (catalog routing_intent) names the route
 * explicit: it is never escalated. */
function tierRouteCandidate(node, routeClass, task, catalog, now,
                            {avoidPool = null, avoidIDs = [], widenWrites = false, referenceOnly = false,
                             preferPool = null, classNote = null} = {}) {
  const intent = routingIntent(catalog);
  const routeClassUsed = referenceOnly ? 'deep' : effectiveRouteClass(routeClass, node.scope);
  const ordinal = new Map();
  for (const c of catalog.candidates) if (!ordinal.has(c.quota_pool)) ordinal.set(c.quota_pool, ordinal.size);
  const usable = row => !avoidIDs.includes(row.candidate.id) && dispatchable(row.candidate, task, now);
  const chatFirst = row => node.scope === 'read_only' && row.candidate.surface.endsWith('-chat') ? 0 : 1;
  const order = (a, b) => (tierRank(catalog, a.candidate.model) - tierRank(catalog, b.candidate.model)) ||
    (chatFirst(a) - chatFirst(b)) || (a.index - b.index);
  const best = rows => rows.filter(usable).sort(order)[0] ?? null;
  const avoided = entry => avoidPool !== null && entry.pool === avoidPool ? 1 : 0;
  const preferred = entry => preferPool !== null && entry.pool === preferPool ? 0 : 1;
  const pools = poolRows(node, catalog, {widenWrites})
    .sort((a, b) => (avoided(a) - avoided(b)) || (preferred(a) - preferred(b)) ||
      (ordinal.get(a.pool) - ordinal.get(b.pool)));
  const deepGuard = routeClassUsed === 'deep' && !intent?.model_family;
  // One pass of the pools at one class: the first pool with a dispatchable
  // row for any of the class's entries, or null.
  const serve = classUsed => {
    const entries = tierEntries(classUsed, intent);
    const skipped = [];
    let offered = false;
    for (const pool of pools) {
      const rank = 'pool_rank_' + ordinal.get(pool.pool);
      let hit = null, entry = null, poolOffered = false;
      for (const candidateEntry of entries) {
        const rows = entryRows(pool.rows, candidateEntry, catalog, intent);
        if (rows.length) poolOffered = true;
        hit = best(rows);
        if (hit) { entry = candidateEntry; break; }
      }
      offered ||= poolOffered;
      if (hit) return {hit, entry, pool, rank, skipped, offered};
      skipped.push(`skipped_${rank}_` + (deepGuard ? poolOffered ? 'reference_undispatchable' : 'reference_unavailable' :
        `${classUsed}_${poolOffered ? 'undispatchable' : 'unavailable'}`));
    }
    return {hit: null, offered};
  };
  let served = serve(routeClassUsed), fallbackNote = null;
  const fallback = CLASS_FALLBACK[routeClassUsed];
  if (!served.hit && fallback) {
    const upward = serve(fallback);
    if (upward.hit) { served = upward; fallbackNote = `class_fallback_${routeClassUsed}_to_${fallback}`; }
  }
  if (!served.hit)
    throw new RCCRuntimeError(`no_dispatchable_candidate:${node.scope}:` +
      (deepGuard && !served.offered ? 'reference_unavailable' : routeClassUsed));
  const {hit, entry, pool, rank, skipped} = served;
  const chosen = hit.candidate;
  const tier = tierOf(catalog, chosen.model);
  const reference = tierReferenceRows(pool.rows, catalog, intent);
  const atReference = reference.some(row => row.candidate.id === chosen.id);
  const kind = intent ? 'explicit' : atReference ? 'reference' : 'tier';
  let ladder = null;
  if (kind === 'tier' && node.scope === 'read_only' && node.kind === 'agent') {
    // The one REVAS escalation target, fixed now and admitted with the
    // plan: this pool's reference when it can run, else another pool's.
    const targets = [pool, ...pools.filter(other => other !== pool)
      .sort((a, b) => ordinal.get(a.pool) - ordinal.get(b.pool))]
      .map(other => tierReferenceRows(other.rows, catalog));
    const target = targets.map(rows => best(rows)).find(Boolean) ?? targets.map(rows => [...rows].sort(order)[0]).find(Boolean);
    // No frontier reference in any pool: the guard still applies, with no
    // target, so a failure signal holds the node instead of adopting the
    // cheaper answer (the escalation re-resolves a reference at that time).
    ladder = {source: 'tier', cheap_model: chosen.model, cheap_effort: chosen.effort,
      reference_model: target?.candidate.model ?? null, reference_effort: target?.candidate.effort ?? null,
      reference_candidate_id: target?.candidate.id ?? null};
  }
  const why = ['route_' + kind];
  if (intent?.effort) why.push('intent_effort_' + intent.effort);
  if (intent?.model_family) why.push('intent_family_' + intent.model_family);
  why.push('class_' + routeClassUsed);
  if (classNote) why.push(classNote);
  if (fallbackNote) why.push(fallbackNote);
  why.push('tier_list_' + entry.index, 'tier_' + (tier ?? 'none'), rank, ...skipped, 'effort_' + chosen.effort);
  if (ladder) why.push('escalation_reference_' + (ladder.reference_candidate_id === null ? 'unavailable' :
    catalog.candidates.find(c => c.id === ladder.reference_candidate_id)?.quota_pool === pool.pool ?
      'same_pool' : 'other_pool'));
  why.push({chat: 'chat_lane_same_route', local: 'local_exact'}[surfaceKind(chosen.surface)] ?? 'agent_surface');
  if (avoidPool !== null) why.unshift(pool.pool === avoidPool ? 'same_pool_only' : 'other_pool');
  const widened = node.scope === 'workspace_write' && !coversOwnedPaths(chosen, node.owned_paths);
  if (widened) why.push('owned_paths_workspace');
  return {candidate: chosen, why: why.join(';'), widened, kind, tier,
    referenceEffort: reference[0]?.candidate.effort ?? null, ladder};
}

/** What can run now, without any candidate ID: the non-explicit planner sees
 * only this summary, never the catalog. On a tier-routed catalog agent work
 * counts only where some class reachable in the scope can bind a row
 * (bindableRows); on an older catalog only where a pool's reference route can
 * dispatch, because nothing lower is ever bound there. */
export function routingAvailability(task, catalog, now = Date.now()) {
  const scopes = [], providers = new Set();
  let chatLane = false;
  const tiered = modelTiers(catalog) !== null;
  const intent = routingIntent(catalog);
  for (const scope of ['read_only', 'workspace_write']) {
    const probe = {scope, kind: 'agent', owned_paths: []};
    // Tier routing: any row a graded node of this scope may bind; reference
    // routing: only a pool's reference rows.
    const pools = tiered ? poolRows(probe, catalog, {anyPaths: true}).map(entry => ({pool: entry.pool,
      rows: bindableRows(entry.rows, scope, catalog, intent)})) :
      poolReferences(probe, catalog, {anyPaths: true}).map(reference => ({pool: reference.pool,
        rows: referenceRows(reference)}));
    for (const entry of pools) {
      const runnable = entry.rows.filter(c => dispatchable(c, task, now));
      if (!runnable.length) continue;
      if (!scopes.includes(scope)) scopes.push(scope);
      providers.add(providerOfPool(entry.pool));
      if (scope === 'read_only' && runnable.some(c => c.surface.endsWith('-chat'))) chatLane = true;
    }
  }
  return {scopes, chat_lane: chatLane, providers: [...providers].sort(),
    deterministic: catalog.candidates.some(c => hostRoutable(c) && dispatchable(c, task, now) &&
      c.surface === 'local' && c.scope === 'read_only' &&
      c.transport === 'local' && c.quota_pool === 'none' && c.tools.length === 0)};
}

/** Null when something in an allowed scope can run; otherwise the visible
 * hold reason with, per pool, the failure of the rows that could be bound in
 * scope (tier routing: bindableRows; reference routing: reference rows). */
function noDispatchableReason(task, catalog, now) {
  const scopes = scopesAllowed(task);
  const local = catalog.candidates.filter(c => hostRoutable(c) && scopes.includes(c.scope) && c.surface === 'local');
  if (local.some(c => dispatchable(c, task, now))) return null;
  const byPool = new Map();
  const note = (pool, reason) => byPool.set(pool, (byPool.get(pool) ?? new Set()).add(reason));
  for (const c of local) note(c.quota_pool, dispatchFailure(c, task, now).replace(/^candidate_/, ''));
  const tiered = modelTiers(catalog) !== null;
  const intent = routingIntent(catalog);
  for (const scope of scopes) {
    if (tiered) {
      for (const entry of poolRows({scope, kind: 'agent', owned_paths: []}, catalog, {anyPaths: true})) {
        const rows = bindableRows(entry.rows, scope, catalog, intent);
        if (rows.some(c => dispatchable(c, task, now))) return null;
        // No tiered model at all, or only rows no class of this scope binds
        // (for example a fast-tier writer).
        if (!rows.length) note(entry.pool, entry.rows.some(row => tierRoutable(row.candidate, catalog)) ?
          'no_bindable_tier' : 'no_tiered_model');
        for (const c of rows) note(entry.pool, dispatchFailure(c, task, now).replace(/^candidate_/, ''));
      }
      continue;
    }
    for (const reference of poolReferences({scope, kind: 'agent', owned_paths: []}, catalog, {anyPaths: true})) {
      const rows = referenceRows(reference);
      if (rows.some(c => dispatchable(c, task, now))) return null;
      if (!rows.length) note(reference.pool, 'no_reference');
      for (const c of rows) note(reference.pool, dispatchFailure(c, task, now).replace(/^candidate_/, ''));
    }
  }
  return 'no_dispatchable_candidate:' + (byPool.size === 0 ? 'no_candidate_in_scope' :
    [...byPool.keys()].sort().map(pool => `${pool}=${[...byPool.get(pool)].sort().join('+')}`).join(','));
}

/** The REVAS ladder gate, front-loaded and pure. A cheaper effort of the SAME
 * model in the SAME pool may replace the reference only when the node is
 * read-only, a task verifier is registered for the family, and the ledger
 * shows parity at that cheaper route: at least LADDER_MIN_VERIFIED_PASSES
 * verified passes and no verifier failure for the family. The cheapest such
 * effort is admitted; anything else (unknown stats included) is reference. */
export function cheaperRouteAdmission({family, scope, model = null, referenceEffort: reference = null,
                                       cheaperEfforts = [], verifierRegistry = null, ledgerStats = null} = {}) {
  if (scope !== 'read_only') return {route: 'reference', reason: 'ladder_write_scope'};
  if (!(verifierRegistry instanceof Map) || typeof family !== 'string' ||
      typeof verifierRegistry.get(family) !== 'function')
    return {route: 'reference', reason: 'ladder_no_registered_verifier'};
  const ceiling = EFFORT_ORDER.indexOf(reference);
  const cheaper = [...new Set(cheaperEfforts)].filter(effort => EFFORTS.has(effort) &&
    EFFORT_ORDER.indexOf(effort) < ceiling).sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
  if (ceiling < 0 || cheaper.length === 0) return {route: 'reference', reason: 'ladder_no_cheaper_route'};
  if (typeof ledgerStats !== 'function') return {route: 'reference', reason: 'ladder_no_ledger_evidence'};
  for (const effort of cheaper) {
    let stats = null;
    try { stats = ledgerStats(family, model, effort); } catch { stats = null; }
    if (plain(stats) && int(stats.verified_passes, 0, Number.MAX_SAFE_INTEGER) &&
        int(stats.verifier_failures, 0, Number.MAX_SAFE_INTEGER) &&
        stats.verified_passes >= LADDER_MIN_VERIFIED_PASSES &&
        stats.verifier_failures <= LADDER_MAX_VERIFIER_FAILURES)
      return {route: 'ladder', cheap_effort: effort, reference_effort: reference, reason: 'ladder_parity_evidence'};
  }
  return {route: 'reference', reason: 'ladder_insufficient_parity_evidence'};
}

function routingDecision(routeClass, candidate, reason, ladder = null, tier = undefined) {
  const decision = {route_class: routeClass, resolved_candidate_id: candidate.id, surface: candidate.surface,
    model: candidate.model, effort: candidate.effort, quota_pool: candidate.quota_pool, reason,
    quota_remaining_fraction: candidate.quota_remaining_fraction};
  // Present only for a route with an escalation target, so every other
  // decision keeps its shape (a tier guard with no frontier reference anywhere
  // has none: its reason says escalation_reference_unavailable). A tier route
  // names both models; the effort ladder does not.
  if (ladder && (ladder.source !== 'tier' || ladder.reference_candidate_id != null)) {
    decision.ladder = {cheap_effort: ladder.cheap_effort, reference_effort: ladder.reference_effort};
    if (ladder.source === 'tier') Object.assign(decision.ladder,
      {cheap_model: ladder.cheap_model, reference_model: ladder.reference_model});
  }
  // Present only on a tier-routed catalog (null for a model with no tier).
  if (tier !== undefined) decision.tier = tier;
  return decision;
}

/** Pick the exact row for one node: tier routing on a catalog that carries
 * model_tiers, the reference route on an older catalog. `widenWrites` lets a
 * graded writer that named concrete paths bind a whole-workspace row; the
 * caller then records owned_paths ["**"], because a native writer is not
 * confined to the paths a planner listed. */
function selectRouteCandidate(node, routeClass, task, catalog, now, options = {}) {
  // A deterministic node binds the local exact row on either catalog.
  return modelTiers(catalog) !== null && node.kind !== 'deterministic' ?
    tierRouteCandidate(node, routeClass, task, catalog, now, options) :
    referenceRouteCandidate(node, routeClass, task, catalog, now, options);
}
/** Reference routing (an older catalog without model_tiers).
 * Pools go in catalog order (capacity share x remaining / hours to reset,
 * computed by the native builder); an avoided pool goes last. Each pool
 * offers only its reference route: its most-preferred model at the
 * reference effort. The first pool whose reference can dispatch wins; equal
 * quality references make this a choice of whose quota is spent, never of
 * quality. Within the pool a read-only node takes the gated chat row of the
 * SAME model and effort when one can dispatch, else the agent row. An
 * explicit owner constraint (catalog routing_intent) is already applied to
 * the rows and names the route explicit. With `ladder` ({verifierRegistry,
 * ledgerStats}) a graded read-only node may take a cheaper effort of the same
 * model and surface, only through cheaperRouteAdmission. route_class never
 * moves the model or the effort. */
function referenceRouteCandidate(node, routeClass, task, catalog, now,
                                 {avoidPool = null, avoidIDs = [], widenWrites = false, ladder = null,
                                  classNote = null} = {}) {
  const ordinal = new Map();
  for (const c of catalog.candidates) if (!ordinal.has(c.quota_pool)) ordinal.set(c.quota_pool, ordinal.size);
  const intent = routingIntent(catalog);
  const usable = row => !avoidIDs.includes(row.candidate.id) && dispatchable(row.candidate, task, now);
  const chatFirst = row => node.scope === 'read_only' && row.candidate.surface.endsWith('-chat') ? 0 : 1;
  const best = rows => rows.filter(usable)
    .sort((a, b) => (chatFirst(a) - chatFirst(b)) || (a.index - b.index))[0] ?? null;
  const avoided = reference => avoidPool !== null && reference.pool === avoidPool ? 1 : 0;
  const ranked = poolReferences(node, catalog, {widenWrites})
    .sort((a, b) => (avoided(a) - avoided(b)) || (ordinal.get(a.pool) - ordinal.get(b.pool)));
  const skipped = [];
  for (const reference of ranked) {
    const rank = 'pool_rank_' + ordinal.get(reference.pool);
    const atReference = reference.effort === null ? null :
      best(reference.rows.filter(row => row.candidate.effort === reference.effort));
    if (!atReference) {
      skipped.push(`skipped_${rank}_${reference.effort === null ? 'no_reference' : 'reference_undispatchable'}`);
      continue;
    }
    let chosen = atReference.candidate, kind = intent ? 'explicit' : 'reference', ladderRoute = null, note = null;
    const family = routeFamily(routeClass, node.scope, chosen.surface);
    if (ladder && !intent && node.kind === 'agent' && ROUTE_CLASSES.includes(routeClass)) {
      const sameSurface = reference.rows.filter(row => row.candidate.surface === chosen.surface && usable(row));
      const admission = cheaperRouteAdmission({family, scope: node.scope, model: reference.model,
        referenceEffort: reference.effort, cheaperEfforts: sameSurface.map(row => row.candidate.effort),
        verifierRegistry: ladder.verifierRegistry, ledgerStats: ladder.ledgerStats});
      const cheap = admission.route === 'ladder' ?
        best(sameSurface.filter(row => row.candidate.effort === admission.cheap_effort)) : null;
      if (cheap) {
        chosen = cheap.candidate; kind = 'ladder';
        ladderRoute = {cheap_effort: admission.cheap_effort, reference_effort: reference.effort,
          reference_candidate_id: atReference.candidate.id};
      } else if (!['ladder_no_registered_verifier', 'ladder_write_scope'].includes(admission.reason)) note = admission.reason;
    }
    const why = ['route_' + kind];
    if (intent?.effort) why.push('intent_effort_' + intent.effort);
    if (intent?.model_family) why.push('intent_family_' + intent.model_family);
    if (classNote) why.push(classNote);
    why.push(rank, ...skipped, 'effort_' + chosen.effort);
    if (ladderRoute) why.push('ladder_reference_effort_' + ladderRoute.reference_effort);
    if (note) why.push(note);
    why.push({chat: 'chat_lane_same_route', local: 'local_exact'}[surfaceKind(chosen.surface)] ?? 'agent_surface');
    if (avoidPool !== null) why.unshift(reference.pool === avoidPool ? 'same_pool_only' : 'other_pool');
    const widened = node.scope === 'workspace_write' && !coversOwnedPaths(chosen, node.owned_paths);
    if (widened) why.push('owned_paths_workspace');
    return {candidate: chosen, why: why.join(';'), widened, kind, referenceEffort: reference.effort,
      ladder: ladderRoute};
  }
  throw new RCCRuntimeError('no_dispatchable_candidate:' + node.scope);
}

/** Graded writers on overlapping paths run one after another, in plan order:
 * they would serialize on the workspace lease anyway, and validatePlan rejects
 * unordered overlapping writers. Only host-graded writers are ordered here;
 * an existing dependency (either direction) is kept as it is. Pure. */
function serializeGradedWriters(nodes, gradedIDs) {
  const byID = new Map(nodes.filter(plain).map(node => [node.id, node]));
  function ancestor(id, target, seen = new Set()) {
    const node = byID.get(id);
    if (!node || seen.has(id) || !Array.isArray(node.dependencies)) return false;
    seen.add(id);
    return node.dependencies.some(parent => parent === target || ancestor(parent, target, seen));
  }
  const writers = nodes.filter(node => gradedIDs.has(node.id) && node.scope === 'workspace_write');
  const added = new Set();
  for (let later = 1; later < writers.length; later++) for (let earlier = 0; earlier < later; earlier++) {
    const [a, b] = [writers[earlier], writers[later]];
    if (!a.owned_paths.some(x => b.owned_paths.some(y => pathsOverlap(x, y))) ||
        ancestor(a.id, b.id) || ancestor(b.id, a.id)) continue;
    b.dependencies = [...b.dependencies, a.id];
    added.add(b.id);
  }
  return added;
}

const PLANNED_NODE_KEYS = ['id', 'instruction', 'dependencies', 'kind', 'route_class', 'scope',
  'owned_paths', 'context_refs'];
/** Assign each graded node's exact candidate_id deterministically. A node that
 * already carries a candidate_id was bound by the trusted host adapter, not
 * by the local planner (the plugin rejects a planner-chosen ID), and is kept.
 * Explicit route tests are never resolved here. Pure: same input, same output.
 * `now` is the catalog's bind time, not the time the planner returned: a slow
 * local planner must not change which pool is chosen. Freshness is enforced
 * again at dispatch, after the pre-dispatch catalog refresh. A planner node
 * with no (or an invalid) route_class and no bound row is graded standard.
 * `routes` is the host's internal record per graded node: route kind
 * (reference, explicit, tier or ladder), the reference effort and, for a
 * tier or ladder route, the reference row it escalates to. On a tier-routed
 * catalog the class picks the tier (TIER_ROUTES). On an older catalog every
 * class binds the reference, and an effort ladder needs a non-empty
 * verifierRegistry (Map of family to verifier) and ledgerStats(family,
 * model, effort); production registers none. */
export function resolveRoutePlan(plan, task, catalog, now = Date.now(), {verifierRegistry = null, ledgerStats = null} = {}) {
  if (task.mode === 'explicit_routing_test' || !plain(plan) || !Array.isArray(plan.nodes))
    return {plan, decisions: {}, routes: {}};
  const tiered = modelTiers(catalog) !== null;
  // The effort ladder belongs to reference routing. A tier-routed catalog is
  // admitted by the tier itself and escalates on failure signals instead.
  const ladder = !tiered && verifierRegistry instanceof Map && verifierRegistry.size > 0 ?
    {verifierRegistry, ledgerStats} : null;
  const decisions = {}, routes = {};
  const gradedIDs = new Set();
  const ungradedKeys = PLANNED_NODE_KEYS.filter(key => key !== 'route_class');
  const nodes = plan.nodes.map(node => {
    const hasClass = plain(node) && Object.hasOwn(node, 'route_class');
    const ungraded = plain(node) && !hasClass && !Object.hasOwn(node, 'candidate_id');
    if (hasClass || ungraded) {
      assert((hasClass ? keys(node, PLANNED_NODE_KEYS) : keys(node, ungradedKeys)) && ID.test(node.id) &&
        SCOPES.has(node.scope) && ['agent', 'deterministic'].includes(node.kind) &&
        allowedPaths(node.owned_paths) && Array.isArray(node.dependencies), 'plan_node_invalid');
      const {route_class: planned, ...rest} = node;
      const valid = ROUTE_CLASSES.includes(planned);
      // A missing or invalid grade is standard; on a tier-routed catalog a
      // writer graded trivial runs at least standard.
      const routeClass = tiered ? effectiveRouteClass(planned, node.scope) : valid ? planned : 'standard';
      const classNote = !valid ? 'route_class_defaulted' : routeClass !== planned ? 'write_promoted_from_trivial' : null;
      const choice = selectRouteCandidate(node, routeClass, task, catalog, now, {widenWrites: true, ladder, classNote});
      decisions[node.id] = routingDecision(routeClass, choice.candidate, 'resolver;' + choice.why, choice.ladder,
        choice.tier);
      routes[node.id] = {kind: choice.kind, reference_effort: choice.referenceEffort, ladder: choice.ladder};
      gradedIDs.add(node.id);
      return {...rest, dependencies: [...rest.dependencies],
        owned_paths: choice.widened ? ['**'] : rest.owned_paths, candidate_id: choice.candidate.id};
    }
    if (plain(node) && typeof node.candidate_id === 'string' && ID.test(node.id ?? '')) {
      const bound = catalog.candidates.find(c => c.id === node.candidate_id);
      // GPT is no longer routed, by the host or by a bound adapter plan.
      assert(!bound || hostRoutable(bound), 'candidate_surface_dropped');
      if (bound) decisions[node.id] = routingDecision(null, bound, 'adapter_bound');
    }
    return node;
  });
  for (const id of serializeGradedWriters(nodes, gradedIDs))
    decisions[id] = {...decisions[id], reason: decisions[id].reason + ';workspace_writer_serialized'};
  return {plan: {...plan, nodes}, decisions, routes};
}

/** The private, bounded routing ledger in the Core state directory: one
 * append-only JSONL record per settled attempt, in an owner-only directory
 * (0700) and files (0600), opened without following links or blocking on a
 * special file, rotated to one previous generation at MAX_LEDGER_BYTES. A
 * separate never-rotated failure index keeps every parity failure per
 * (family, model, effort). `stats` counts the verified passes and failures of
 * one family at one model/effort; it fails closed (no evidence) on anything it
 * cannot read safely: a torn or foreign line, a missing, invalid or overflowed
 * failure index. Synchronous: callers catch every error. */
export function openRoutingLedger(stateDir, {maxBytes = MAX_LEDGER_BYTES} = {}) {
  assert(typeof stateDir === 'string' && isAbsolute(stateDir) &&
    int(maxBytes, MAX_LEDGER_RECORD_BYTES, MAX_LEDGER_BYTES), 'routing_ledger_invalid');
  const directory = join(stateDir, LEDGER_DIRECTORY);
  const current = join(directory, LEDGER_FILE), rotated = join(directory, LEDGER_ROTATED_FILE);
  const index = join(directory, LEDGER_FAILURE_INDEX);
  const failureKey = (family, model, effort) => stable([family ?? null, model ?? null, effort ?? null]);
  function privateDirectory(create) {
    if (create) mkdirSync(directory, {recursive: true, mode: 0o700});
    const st = lstatSync(directory);
    assert(st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid() &&
      (st.mode & 0o077) === 0, 'routing_ledger_directory_not_private');
  }
  function privateFile(fd) {
    const st = fstatSync(fd);
    assert(st.isFile() && st.uid === process.getuid() && st.nlink === 1, 'routing_ledger_file_invalid');
    return st;
  }
  function writeAll(fd, buffer) {
    for (let offset = 0; offset < buffer.length;) {
      const written = writeSync(fd, buffer, offset, buffer.length - offset);
      assert(int(written, 1, buffer.length - offset), 'routing_ledger_short_write');
      offset += written;
    }
  }
  // O_NONBLOCK: a FIFO or device at a ledger path can never block the Core's
  // event loop on open; the fstat check then rejects it.
  function readPrivate(path, limit) {
    let fd;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    try {
      const st = privateFile(fd);
      assert((st.mode & 0o077) === 0 && st.size <= limit, 'routing_ledger_file_invalid');
      return readFileSync(fd, 'utf8');
    } finally { closeSync(fd); }
  }
  const lines = path => readPrivate(path, maxBytes)?.split('\n') ?? [];
  function readIndex() {
    const text = readPrivate(index, MAX_LEDGER_FAILURE_INDEX_BYTES);
    if (text === null) return null;
    const value = JSON.parse(text);
    assert(keys(value, ['schema', 'overflow', 'failures']) && value.schema === 1 &&
      typeof value.overflow === 'boolean' && plain(value.failures) &&
      Object.keys(value.failures).length <= MAX_LEDGER_FAILURE_KEYS &&
      Object.values(value.failures).every(count => int(count, 1, Number.MAX_SAFE_INTEGER)),
    'routing_ledger_failure_index_invalid');
    return value;
  }
  function writeIndex(value) {
    const body = Buffer.from(stable(value));
    assert(body.length <= MAX_LEDGER_FAILURE_INDEX_BYTES, 'routing_ledger_failure_index_oversize');
    const temp = join(directory, `.${LEDGER_FAILURE_INDEX}.${randomUUID()}.tmp`);
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
      constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try { privateFile(fd); fchmodSync(fd, 0o600); writeAll(fd, body); fsyncSync(fd); }
    catch (error) { closeSync(fd); try { unlinkSync(temp); } catch { /* best effort */ } throw error; }
    closeSync(fd);
    try { renameSync(temp, index); }
    catch (error) { try { unlinkSync(temp); } catch { /* best effort */ } throw error; }
  }
  /** Failure counts per key in the raw generations; `unreadable` when any
   * line or file cannot be read (it might have been a failure). */
  function rawFailures(paths) {
    const failures = {};
    let unreadable = false;
    for (const path of paths) {
      let list;
      try { list = lines(path); } catch { unreadable = true; continue; }
      for (let position = 0; position < list.length; position++) {
        if (list[position] === '' && position === list.length - 1) continue;
        let record = null;
        try { record = JSON.parse(list[position]); } catch { unreadable = true; continue; }
        if (!plain(record) || record.schema !== 1) { unreadable = true; continue; }
        if (!LEDGER_FAILURE_OUTCOMES.has(record.verifier_outcome)) continue;
        const key = failureKey(record.family, record.model, record.effort);
        failures[key] = (failures[key] ?? 0) + 1;
      }
    }
    return {failures, unreadable};
  }
  /** A new index never starts empty beside raw generations that may hold
   * failures: it is seeded from them, and overflowed (every stat then reads no
   * evidence) when any raw line is unreadable or the keys do not fit. A
   * missing index is never turned back into valid "no failure" evidence. */
  function seededIndex() {
    const {failures, unreadable} = rawFailures([rotated, current]);
    const value = {schema: 1, overflow: unreadable, failures};
    if (Object.keys(failures).length > MAX_LEDGER_FAILURE_KEYS ||
        Buffer.byteLength(stable(value)) > MAX_LEDGER_FAILURE_INDEX_BYTES) return {schema: 1, overflow: true, failures: {}};
    return value;
  }
  /** Before rotation discards the previous generation: the index must hold at
   * least that generation's failures for every key, or it is overflowed. An
   * invalid index already reads as no evidence and is never overwritten. */
  function guardRotation() {
    let value;
    try { value = readIndex(); } catch { return; }
    if (value === null) { writeIndex(seededIndex()); return; }
    if (value.overflow) return;
    const discarded = rawFailures([rotated]);
    const covered = !discarded.unreadable && Object.entries(discarded.failures)
      .every(([key, count]) => (value.failures[key] ?? 0) >= count);
    if (!covered) writeIndex({...value, overflow: true});
  }
  function recordFailure(record) {
    const value = readIndex() ?? seededIndex();
    const key = failureKey(record.family, record.model, record.effort);
    const next = {...value, failures: {...value.failures, [key]: (value.failures[key] ?? 0) + 1}};
    // Too many keys to keep: every stat then fails closed, never open.
    const full = !Object.hasOwn(value.failures, key) && Object.keys(value.failures).length >= MAX_LEDGER_FAILURE_KEYS;
    writeIndex(full || Buffer.byteLength(stable(next)) > MAX_LEDGER_FAILURE_INDEX_BYTES ?
      {...value, overflow: true} : next);
  }
  const append = record => {
    const line = Buffer.from(stable(record) + '\n');
    assert(line.length <= MAX_LEDGER_RECORD_BYTES, 'routing_ledger_record_oversize');
    privateDirectory(true);
    // The failure index is written first, so it always holds at least the
    // failures the raw generations hold. A failure whose index write fails is
    // not appended at all (fail closed): the caller keeps it pending and a
    // restart records it again, retrying the index. A non-failure record is
    // still appended and the index error is then reported.
    let indexError = null;
    if (LEDGER_FAILURE_OUTCOMES.has(record?.verifier_outcome)) recordFailure(record);
    else {
      try {
        // Create the index once, seeded from the raw generations; an existing
        // (even invalid) one is never overwritten by a non-failure record.
        let present = true;
        try { lstatSync(index); } catch (error) { if (error.code !== 'ENOENT') throw error; present = false; }
        if (!present) writeIndex(seededIndex());
      } catch (error) { indexError = error; }
    }
    const flags = constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    let fd = openSync(current, flags, 0o600);
    try {
      const st = privateFile(fd);
      fchmodSync(fd, 0o600);
      if (st.size + line.length + 1 > maxBytes) {
        closeSync(fd); fd = null;
        guardRotation();
        renameSync(current, rotated);
        fd = openSync(current, flags | constants.O_EXCL, 0o600);
        privateFile(fd); fchmodSync(fd, 0o600);
      } else if (st.size > 0) {
        // A torn earlier write (crash, short write) must not swallow this
        // record: start it on its own line.
        const last = Buffer.alloc(1);
        if (readSync(fd, last, 0, 1, st.size - 1) !== 1 || last[0] !== 0x0a) writeAll(fd, Buffer.from('\n'));
      }
      writeAll(fd, line);
    } finally { if (fd !== null) closeSync(fd); }
    if (indexError) throw indexError;
  };
  const stats = (family, model, effort) => {
    const none = {verified_passes: 0, verifier_failures: 0};
    try {
      try { privateDirectory(false); } catch (error) { if (error.code === 'ENOENT') return none; throw error; }
      const failures = readIndex();
      if (failures === null || failures.overflow) return none;
      let passes = 0, recorded = 0;
      for (const path of [rotated, current]) {
        const list = lines(path);
        for (let position = 0; position < list.length; position++) {
          // Only the final newline's empty tail is skipped; a torn, empty or
          // foreign line anywhere throws or returns: no evidence at all.
          if (list[position] === '' && position === list.length - 1) continue;
          const record = JSON.parse(list[position]);
          if (!plain(record) || record.schema !== 1) return none;
          if (record.family !== family || record.model !== model || record.effort !== effort) continue;
          if (record.verifier_outcome === 'pass' && record.execution_verified === true) passes++;
          else if (LEDGER_FAILURE_OUTCOMES.has(record.verifier_outcome)) recorded++;
        }
      }
      return {verified_passes: passes,
        verifier_failures: Math.max(recorded, failures.failures[failureKey(family, model, effort)] ?? 0)};
    } catch { return none; }
  };
  /** Attempt ids in the retained generations (for restart reconciliation). */
  const attemptIDs = () => {
    const ids = new Set();
    try { privateDirectory(false); } catch (error) { if (error.code === 'ENOENT') return ids; throw error; }
    for (const path of [rotated, current]) for (const line of lines(path)) {
      let record = null;
      try { record = line ? JSON.parse(line) : null; } catch { continue; }
      if (plain(record) && typeof record.attempt_id === 'string') ids.add(record.attempt_id);
    }
    return ids;
  };
  return Object.freeze({directory, path: current, rotatedPath: rotated, failureIndexPath: index,
    append, stats, attemptIDs});
}

function exactConfig(candidate) {
  return Object.fromEntries(['surface', 'transport', 'account_id', 'model', 'effort', 'tools',
    'scope', 'permission_profile', 'quota_pool', 'allowed_paths', 'configuration_sha256']
    .map(key => [key, immutable(candidate[key])]));
}
function validExclusions(exclusions) {
  return Array.isArray(exclusions) && exclusions.length > 0 && exclusions.length <= 32 &&
    exclusions.every(item => keys(item, ['provider', 'reason', 'count']) &&
      EXCLUSION_PROVIDERS.has(item.provider) && EXCLUSION_REASONS.has(item.reason) &&
      int(item.count, 1, 10_000)) &&
    new Set(exclusions.map(item => `${item.provider}\0${item.reason}`)).size === exclusions.length;
}
/** The owner's explicit routing constraint the native builder already
 * applied to the rows (optional, absent without one): it makes a route
 * explicit and is the only way above-max efforts become a reference. */
function validRoutingIntent(intent) {
  return keys(intent, ['effort', 'model_family']) &&
    (intent.effort === null || INTENT_EFFORTS.has(intent.effort)) &&
    (intent.model_family === null || (typeof intent.model_family === 'string' && INTENT_FAMILY.test(intent.model_family))) &&
    (intent.effort !== null || intent.model_family !== null);
}
/** Optional (build 378): the provider-stated tier of each tiered model this
 * catalog offers. Possibly empty (no offered model has a tier). */
function validModelTiers(tiers, candidates) {
  if (!plain(tiers)) return false;
  const models = new Set(candidates.map(c => c?.model));
  const entries = Object.entries(tiers);
  return entries.length <= 256 && entries.every(([model, tier]) => boundedText(model, 256) && models.has(model) &&
    MODEL_TIERS.includes(tier));
}
function validateCatalog(catalog, task) {
  const required = ['schema', 'task_id', 'request_sha256', 'candidates'];
  const optional = ['exclusions', 'routing_intent', 'model_tiers'];
  assert(plain(catalog) && required.every(key => Object.hasOwn(catalog, key)) &&
    Object.keys(catalog).every(key => required.includes(key) || optional.includes(key)) &&
    catalog.schema === 1 && catalog.task_id === task.task_id &&
    catalog.request_sha256 === task.request_sha256 && Array.isArray(catalog.candidates) &&
    catalog.candidates.length <= 256 &&
    (catalog.exclusions === undefined || validExclusions(catalog.exclusions)) &&
    (catalog.routing_intent === undefined || validRoutingIntent(catalog.routing_intent)) &&
    (catalog.model_tiers === undefined || validModelTiers(catalog.model_tiers, catalog.candidates)) &&
    (catalog.candidates.length > 0 || catalog.exclusions !== undefined), 'catalog_binding_invalid');
  assert(Buffer.byteLength(stable(catalog)) <= MAX_CATALOG_BYTES, 'catalog_oversize');
  // An empty catalog is an explicit, explained hold rather than an opaque
  // binding error: say which configured profiles were excluded and why.
  if (catalog.candidates.length === 0)
    throw new RCCRuntimeError('no_routable_candidate:' +
      [...new Set(catalog.exclusions.map(item => item.reason))].sort().join(','));
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
    assert(node.scope !== 'workspace_write' || (node.owned_paths.length > 0 && coversOwnedPaths(c, node.owned_paths)),
    'plan_write_scope_invalid');
    assert(node.scope === 'workspace_write' || node.owned_paths.length === 0, 'plan_read_scope_invalid');
    if (task.host_context.require_read_only) assert(node.scope === 'read_only', 'owner_read_only_violation');
    ids.add(node.id);
  }
  if (task.mode === 'explicit_routing_test') {
    const requested = effectiveExplicitRoutes(task);
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

/** Every row a plan node was admitted with, by ID. A later catalog may drop a
 * row (quota_zero, quota_backoff, sign-out); the node that already ran on it,
 * or still waits for it, stays admitted against the row it was bound to. */
function boundRows(plan, catalog, prior = {}) {
  const rows = {...prior};
  for (const node of plan.nodes) {
    const row = catalog.candidates.find(c => c.id === node.candidate_id);
    if (row) rows[row.id] = immutable(row);
  }
  return rows;
}
/** The catalog a repaired plan is validated against: the changed nodes only
 * against the fresh rows; every other node against its fresh row when it is
 * still offered, else the row it was admitted with. Validating the whole plan
 * against the fresh catalog alone would hold a task merely because a sibling's
 * row left the catalog after that sibling ran (or while it waits its turn). */
function repairCatalog(snapshot, plan, fresh, changedIDs) {
  const rows = new Map(fresh.candidates.map(c => [c.id, c]));
  const admitted = new Map([...(snapshot.catalog?.candidates ?? []).map(c => [c.id, c]),
    ...Object.entries(snapshot.bound_rows ?? {})]);
  for (const node of plan.nodes) {
    if (changedIDs.includes(node.id) || rows.has(node.candidate_id)) continue;
    const prior = admitted.get(node.candidate_id);
    if (prior) rows.set(prior.id, prior);
  }
  return {...fresh, candidates: [...rows.values()]};
}

/** Attempts charged to the retry budget. A verified pre-execution provider
 * quota rejection did no work and is not charged for a host-resolved node,
 * whose moves are bounded by MAX_RE_RESOLUTIONS instead; any other node gets
 * at most one such free attempt, as the legacy runner's quota limit did.
 * The one cheaper ladder attempt whose verifier failed is the Core's own
 * bet, not the owner's: its single reference re-dispatch is never charged. */
function chargedAttempts(child, resolver) {
  const history = child.attempt_history ?? [];
  const free = history.filter(entry => entry.state === 'verified_not_dispatched' &&
    entry.error === PROVIDER_QUOTA_REJECTED_BEFORE_EXECUTION).length;
  const ladder = history.some(entry => LADDER_FAILED_STATES.has(entry.state)) ? 1 : 0;
  return child.attempts - Math.min(free, resolver ? MAX_RE_RESOLUTIONS : 1) - ladder;
}

/** Routes displayed by an explicit-route hold: the routes that still run,
 * or (when every route named GPT) the original GPT routes, so the hold shows
 * exactly what was dropped instead of an empty tree. */
function heldExplicitRoutes(task) {
  const effective = effectiveExplicitRoutes(task);
  return Array.isArray(effective) && effective.length === 0 ? task.host_context.explicit_routes : effective;
}

function requestedSurface(snapshot, child) {
  if (child.requested_surface != null) return child.requested_surface;
  // Older snapshots have no display field. Recover only the exact original
  // explicit binding, not a model-selected alias or an observed execution.
  // Those children were created from the full original list (GPT routes
  // included), so their ordinals index that immutable list, not the
  // GPT-filtered routes a new hold or plan uses.
  const routes = snapshot.task.host_context?.explicit_routes;
  if (snapshot.task.mode !== 'explicit_routing_test' || !Array.isArray(routes)) return null;
  const ordinal = /^requested-([1-8])$/.exec(child.id);
  if (ordinal) {
    const route = routes[Number(ordinal[1]) - 1];
    if (route?.instruction === child.instruction) return route.surface;
  }
  const candidate = snapshot.catalog?.candidates.find(row => row.id === child.candidate_id);
  return routes.find(route => route.surface === candidate?.surface &&
    route.instruction === child.instruction)?.surface ?? null;
}

function publicSnapshot(snapshot) {
  return { schema: 1, task_id: snapshot.task.task_id,
    request_sha256: snapshot.task.request_sha256, state: snapshot.state,
    revision: snapshot.revision,
    children: snapshot.children.map(child => {
      const {id, state, attempt_id, candidate_id, selected_config,
        instruction, dependencies, started_at_ms, finished_at_ms, native_receipt, output} = child;
      return {id, state, attempt_id, candidate_id, selected_config,
        requested_surface: requestedSurface(snapshot, child), instruction, dependencies,
        started_at_ms, finished_at_ms, native_receipt,
        output_summary: typeof output === 'string' ? output.slice(0, 600) : null,
        // Why the host chose this exact row. Older snapshots have none.
        routing_decision: child.routing_decision ? immutable(child.routing_decision) : null};
    }),
    result: snapshot.result ? immutable(snapshot.result) : null,
    install_handoff: snapshot.install_handoff ? immutable(snapshot.install_handoff) : null,
    error: snapshot.error ?? null };
}

/** Wall time of failed cheaper ladder attempts (and their verifier wait),
 * never charged to the task's duration budget. Task-wide, like the budget
 * itself: every node is exempt, not only the laddered one. Cheaper attempts of
 * different nodes run at the same time (spread across pools), so the exempt
 * time is the UNION of their [dispatched, escalated] intervals, never their
 * sum: overlapping wall time is exempted once. A snapshot from before the
 * intervals kept a summed ladder_exempt_ms (task-wide, or per child in an
 * older one); those values still count. */
function ladderExemptMs(snapshot) {
  const legacy = (snapshot.ladder_exempt_ms ?? 0) +
    snapshot.children.reduce((sum, child) => sum + (child.ladder_exempt_ms ?? 0), 0);
  const intervals = (Array.isArray(snapshot.ladder_exempt_intervals) ? snapshot.ladder_exempt_intervals : [])
    .filter(pair => Array.isArray(pair) && pair.length === 2 && Number.isSafeInteger(pair[0]) &&
      Number.isSafeInteger(pair[1]) && pair[1] >= pair[0])
    .sort((a, b) => a[0] - b[0]);
  let union = 0, start = null, end = null;
  for (const [from, to] of intervals) {
    if (end === null || from > end) { if (end !== null) union += end - start; start = from; end = to; }
    else end = Math.max(end, to);
  }
  if (end !== null) union += end - start;
  return legacy + union;
}
/** A node bound below its reference that still has its one escalation: a
 * tier route (build 378) or an effort-ladder route not yet escalated. */
function pendingEscalation(child) {
  return ['ladder', 'tier'].includes(child?.route_kind) && child.ladder != null && child.ladder.escalated !== true;
}
/** A tier route's failure signals beyond the effort ladder's: an output that
 * is only whitespace, or a failure the native adapter recorded beside a
 * finished attempt (a failed task quality is already undeliverable). */
function tierFailureSignal(result) {
  return typeof result.output !== 'string' || result.output.trim() === '' || result.error != null;
}
/** A returned node whose registered family verifier had not answered. */
function verifierPendingChild(child) {
  return child.state === 'waiting' && child.attempt_history?.at(-1)?.state === 'node_verifier_pending';
}
/** A stop or restart settles a still-open native attempt: its history entry
 * gets the settled state, so the ledger never records 'dispatch_started'. */
function settleDispatchEntry(child, state) {
  const last = child.attempt_history?.at(-1);
  if (last && UNSETTLED_DISPATCH_STATES.has(last.state)) last.state = state;
}

function alive(pid) {
  if (!int(pid, 1, Number.MAX_SAFE_INTEGER)) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

/** `verifierRegistry`: Map of task family (routeFamily) to an async node
 * verifier ({schema, task_id, node_id, family, instruction, output,
 * native_receipt, selected_config} -> {passed: boolean, reason}). Production
 * registers none, so every graded node runs its reference route. `ledgerStats`
 * overrides the ledger reader the ladder gate uses (tests only); `ledgerLog`
 * receives a ledger write failure code, which never fails or holds a task. */
export async function createRCCRuntime({stateDir, catalog, plan, execute, executeContinuation,
                                         stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
                                         maximumWorkers = 4, cancelGraceMs = 5_000,
                                         verifierRegistry = null, ledgerStats = null, ledgerLog = null} = {}) {
  assert(typeof stateDir === 'string' && isAbsolute(stateDir) && !stateDir.includes('/../'), 'state_dir_invalid');
  assert(int(maximumWorkers, 1, 16), 'worker_limit_invalid');
  assert(int(cancelGraceMs, 100, 30_000), 'cancel_grace_invalid');
  const registry = verifierRegistry ?? new Map();
  assert(registry instanceof Map && [...registry].every(([family, verify]) =>
    typeof family === 'string' && family.length <= 128 && typeof verify === 'function'), 'verifier_registry_invalid');
  assert(ledgerStats === null || typeof ledgerStats === 'function', 'ledger_stats_invalid');
  assert(ledgerLog === null || typeof ledgerLog === 'function', 'ledger_log_invalid');
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
      revision INTEGER NOT NULL, kind TEXT NOT NULL, at_ms INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ledger_pending (attempt_id TEXT PRIMARY KEY, task_id TEXT NOT NULL,
      node_id TEXT NOT NULL, route TEXT NOT NULL);`);
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

  const ledger = openRoutingLedger(stateDir);
  const runtime = new RCCRuntime({db, token, stateDir, catalog, plan, execute, executeContinuation,
                                 stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
                                 maximumWorkers, cancelGraceMs,
                                 transaction, verifierRegistry: registry, ledger,
                                 ledgerStats: ledgerStats ?? ledger.stats, ledgerLog});
  runtime.reconcileRestart();
  runtime.reconcileLedger();
  runtime.startQueued();
  return runtime;
}

class RCCRuntime {
  constructor({db, token, stateDir, catalog, plan, execute, executeContinuation,
               stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
               maximumWorkers, cancelGraceMs, transaction, verifierRegistry, ledger, ledgerStats, ledgerLog}) {
    this.db = db; this.token = token; this.stateDir = stateDir;
    this.catalog = catalog; this.plan = plan;
    this.execute = execute; this.executeContinuation = executeContinuation;
    this.stageSelfUpdate = stageSelfUpdate;
    this.reconcileInstallation = reconcileInstallation;
    this.cancelInstallation = cancelInstallation;
    this.verifyTask = verifyTask; this.emit = emit;
    this.verifierRegistry = verifierRegistry; this.ledger = ledger;
    this.ledgerStats = ledgerStats; this.ledgerLog = ledgerLog;
    // Dispatched attempts whose ledger record is not written yet, with the
    // route facts fixed at dispatch: an attempt that settles after stop is
    // still recorded once, without the closed DB.
    this.ledgerInflight = new Map();
    // Parity failures whose ledger write failed (attempt id -> retry). While
    // one waits, every ladder in this process reads no evidence; each later
    // record, and each ladder admission, retries them first.
    this.ledgerBacklog = new Map();
    this.maximumWorkers = maximumWorkers; this.cancelGraceMs = cancelGraceMs;
    this.transaction = transaction;
    this.runningTasks = new Map(); this.controllers = new Map();
    this.installationObservations = new Map();
    this.poolReservations = new Set(); this.activeWriteWorkspaces = new Set();
    // Per task: the catalog bind instant a pool spread already re-probed.
    this.spreadProbes = new Map();
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
      const routes = heldExplicitRoutes(snapshot.task);
      if (Array.isArray(routes)) snapshot.children = routes.map((route, index) => ({
        id: `requested-${index + 1}`, state: 'held', attempt_id: null,
        candidate_id: null, attempts: 0, attempt_history: [], repair_needed: false,
        dispatched_at_ms: null, output: null, execution_verified: false,
        task_quality: 'unverified', parity_state: 'unverified', native_receipt: null,
        native_summary: null, usage: null, selected_config: null, requested_surface: route.surface, instruction: route.instruction,
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
      const verifierPending = state.children.some(child => verifierPendingChild(child));
      this._update(row.task_id, 'restart_reconciled', snapshot => {
        snapshot.state = dispatched ? 'effects_uncertain' : 'held';
        snapshot.error = dispatched ? 'restart_active_dispatch_no_replay' :
          pendingContinuation ? 'continuation_pending_recovery_required' :
          verifierPending ? 'restart_node_verifier_pending' : 'restart_before_dispatch';
        for (const child of snapshot.children) if (child.state === 'running') {
          child.state = child.stage ? 'completed' : dispatched ? 'effects_uncertain' : 'held';
          if (child.state === 'effects_uncertain') settleDispatchEntry(child, 'effects_uncertain');
        }
        for (const child of snapshot.children) if (child.stage?.state === 'dispatched')
          child.stage.state = 'effects_uncertain';
        for (const child of snapshot.children) if (child.state === 'waiting' &&
          child.continuation?.state === 'pending') child.state = 'held';
        // A returned node whose family verifier had not answered is neither
        // adopted nor replayed: it stays visible as held.
        for (const child of snapshot.children) if (verifierPendingChild(child)) child.state = 'held';
      });
    }
    for (const row of rows) this._releaseSafeLeases(row.task_id);
  }

  /** Restart: record, once, every attempt an earlier owner dispatched but
   * never recorded (it stopped or crashed before the attempt settled, or its
   * live append failed). A verdict already stored on the attempt (pass, fail,
   * not_returned, or a verified not-dispatched rejection) is recorded as it
   * was; only an attempt without one is 'interrupted' when a verifier was
   * relevant. An attempt that did settle after the stop is already in the
   * ledger and is only cleared. A ledger failure is logged; the pending row is
   * cleared, except for a parity failure, which stays pending so the next
   * restart retries it (a lost failure could readmit a cheaper route). */
  reconcileLedger() {
    const rows = this.transaction(() => this.db.prepare(
      'SELECT attempt_id,task_id,node_id,route FROM ledger_pending ORDER BY rowid').all());
    if (!rows.length) return;
    let recorded;
    try { recorded = this.ledger.attemptIDs(); } catch { recorded = new Set(); }
    for (const row of rows) {
      let keep = false;
      try {
        if (!recorded.has(row.attempt_id)) {
          const route = JSON.parse(row.route);
          const child = this._load(row.task_id)?.children.find(c => c.id === row.node_id);
          const entry = child?.attempt_history?.find(item => item.attempt_id === row.attempt_id);
          const current = child?.attempt_id === row.attempt_id;
          const settled = entry && !UNSETTLED_ATTEMPT_STATES.has(entry.state);
          const outcome = route.verifier !== true ? 'not_registered' :
            settled && SETTLED_VERDICTS.has(entry.verifier) ? entry.verifier :
            settled && entry.state === 'verified_not_dispatched' ? 'not_dispatched' : 'interrupted';
          const write = () => this._appendLedger({taskID: row.task_id, nodeID: row.node_id, attemptID: row.attempt_id,
            route}, {usage: entry?.usage ?? null, execution_verified: current && child.execution_verified === true,
            task_quality: current ? child.task_quality ?? null : null}, outcome, settled ? entry.state : 'interrupted');
          if (LEDGER_FAILURE_OUTCOMES.has(outcome)) { keep = true; this.ledgerBacklog.set(row.attempt_id, write); }
          write();
          this.ledgerBacklog.delete(row.attempt_id);
          keep = false;
        }
      } catch (error) { this._logLedger(error); }
      if (!keep)
        this.transaction(() => this.db.prepare('DELETE FROM ledger_pending WHERE attempt_id=?').run(row.attempt_id));
    }
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
    // GPT is no longer routed. Other named routes still run; only a request
    // in which EVERY route named GPT is held, visibly, before any catalog
    // probe or planner call. Nothing is substituted for a dropped route.
    if (task.mode === 'explicit_routing_test' && effectiveExplicitRoutes(task).length === 0) {
      this._holdExplicitRoutes(taskID, 'explicit_route_surface_dropped:' +
        [...new Set(droppedExplicitRoutes(task).map(route => route.surface))].sort().join(','));
      return;
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
    // The time this catalog was bound. Host resolution after planning ranks
    // against this instant, so planner latency never changes the pool.
    const boundAt = Date.now();
    this._update(taskID, 'catalog_bound', snapshot => {
      snapshot.catalog = catalog; snapshot.catalog_bound_at_ms = boundAt;
    });
    if (task.mode === 'explicit_routing_test') {
      const now = boundAt;
      const unavailable = effectiveExplicitRoutes(task).find(route =>
        !catalog.candidates.some(candidate => candidate.surface === route.surface &&
          candidate.availability === 'available' && candidate.availability_valid_until_ms > now &&
          candidate.quality_state !== 'mismatch' &&
          (candidate.quota_pool === 'none' || (candidate.quota_pool !== 'unknown' &&
            candidate.quota_remaining_fraction > 0 && candidate.quota_valid_until_ms > now))));
      if (unavailable) {
        // Name the host's recorded exclusion reasons for that provider, so a
        // capacity, sign-in or quota exclusion is visible in the hold.
        const provider = unavailable.surface === 'codex' ? 'codex' :
          ['claude', 'claude-chat'].includes(unavailable.surface) ? 'claude' : null;
        const why = [...new Set((catalog.exclusions ?? []).filter(item => item.provider === provider)
          .map(item => item.reason))].sort();
        this._holdExplicitRoutes(taskID, `explicit_route_surface_unavailable:${unavailable.surface}` +
          (why.length ? ':' + why.join('+') : ''));
        return;
      }
    } else {
      // Nothing that could run now: say why per pool, before a planner call.
      const blocked = noDispatchableReason(task, catalog, boundAt);
      if (blocked) { this._hold(taskID, blocked); return; }
    }
    if (typeof this.plan !== 'function') {
      if (task.mode === 'explicit_routing_test') this._holdExplicitRoutes(taskID, 'planner_unavailable');
      else this._hold(taskID, 'planner_unavailable');
      return;
    }
    let plan, decisions, routes;
    try {
      // The injected planner adapter selects only task-relevant policy and
      // context for the local model. It receives the immutable host state,
      // never a model-authored replacement for that state. Outside explicit
      // route tests it grades nodes; the host then binds exact rows.
      const proposed = await this.plan({task: immutable(task), catalog: immutable(catalog)});
      const resolved = resolveRoutePlan(proposed, task, catalog, boundAt,
        {verifierRegistry: this.verifierRegistry, ledgerStats: (...key) => this._ladderStats(...key)});
      plan = validatePlan(resolved.plan, task, catalog);
      decisions = resolved.decisions; routes = resolved.routes;
    } catch (error) {
      const reason = error instanceof RCCRuntimeError ? error.code : 'planner_failed';
      if (task.mode === 'explicit_routing_test') this._holdExplicitRoutes(taskID, reason);
      else this._hold(taskID, reason);
      return;
    }
    if (this._load(taskID).cancel_requested) { this._markCancelled(taskID); return; }
    state = this._update(taskID, 'plan_admitted', snapshot => {
      snapshot.plan = plan; snapshot.state = 'running';
      snapshot.bound_rows = boundRows(plan, catalog);
      // A ladder node is admitted with its reference row too: a sibling's
      // later catalog refresh may drop that row, and the escalation must
      // still rebind it (dispatch then refreshes and re-resolves as usual).
      for (const route of Object.values(routes)) {
        const reference = route?.ladder && catalog.candidates.find(c => c.id === route.ladder.reference_candidate_id);
        if (reference) snapshot.bound_rows[reference.id] = immutable(reference);
      }
      snapshot.children = plan.nodes.map(node => ({id: node.id, state: 'queued',
        attempt_id: null, candidate_id: node.candidate_id, attempts: 0, attempt_history: [],
        repair_needed: false,
        dispatched_at_ms: null, output: null, execution_verified: false,
        task_quality: 'unverified', parity_state: 'unverified', native_receipt: null,
        native_summary: null, usage: null, selected_config: null,
        // validatePlan already requires this exact surface/instruction pair
        // to exist in the original host contract. Requested is not executed.
        requested_surface: task.mode === 'explicit_routing_test'
          ? effectiveExplicitRoutes(task).find(route =>
              route.surface === catalog.candidates.find(candidate => candidate.id === node.candidate_id).surface &&
              route.instruction === node.instruction).surface : null,
        routing_decision: decisions[node.id] ?? null, re_resolutions: 0, avoided_candidate_ids: [],
        // Host-internal route record (never public): reference/explicit/ladder.
        route_kind: routes[node.id]?.kind ?? null, reference_effort: routes[node.id]?.reference_effort ?? null,
        ladder: routes[node.id]?.ladder ? {...routes[node.id].ladder, escalated: false} : null,
        instruction: node.instruction,
        dependencies: node.dependencies, started_at_ms: null, finished_at_ms: null}));
    });
    if (typeof this.execute !== 'function') { this._hold(taskID, 'executor_unavailable'); return; }
    try { await this._scheduleDAG(taskID); } finally { this.spreadProbes.delete(taskID); }
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
        native_summary: null, usage: null, selected_config: config, requested_surface: null, instruction: snapshot.task.request,
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
    const failure = dispatchFailure(candidate, task, Date.now());
    if (failure !== null) throw new RCCRuntimeError(failure);
    return candidate;
  }
  /** A cheap, read-only look at whether this row could take a lease now. It
   * avoids a native catalog probe while the pool or workspace is busy;
   * _tryReserve remains the authoritative, transactional reservation. */
  _leasePossible(candidate, task) {
    if (this.activeWorkers >= this.maximumWorkers) return false;
    const poolKey = this._poolKey(candidate);
    if (poolKey && this.poolReservations.has(poolKey)) return false;
    let workspaceKey = null;
    if (candidate.scope === 'workspace_write') {
      try { workspaceKey = realpathSync(task.host_context.workspace); } catch { return true; }
      if (this.activeWriteWorkspaces.has(workspaceKey)) return false;
    }
    const foreign = (table, column, value) => {
      if (!value) return false;
      const row = this.db.prepare(`SELECT task_id FROM ${table} WHERE ${column}=?`).get(value);
      // An effects-uncertain owner must surface as the existing hold, not wait.
      return Boolean(row && row.task_id !== task.task_id &&
        this._load(row.task_id)?.state !== 'effects_uncertain');
    };
    return !foreign('quota_leases', 'pool_key', poolKey) && !foreign('write_leases', 'workspace', workspaceKey);
  }
  _resolverNode(snapshot, nodeID) {
    const child = snapshot.children.find(c => c.id === nodeID);
    return snapshot.task.mode !== 'explicit_routing_test' &&
      ROUTE_CLASSES.includes(child?.routing_decision?.route_class) ? child : null;
  }
  /** Replace one queued node's host-resolved row, against the supplied fresh
   * catalog, same scope and route_class, preferring a different quota pool.
   * Never used for an explicit route, an adapter-bound node, or a child that
   * already dispatched successfully or is in a continuation. */
  _reResolve(taskID, nodeID, fresh, failure) {
    const snapshot = this._load(taskID);
    const child = this._resolverNode(snapshot, nodeID);
    const node = snapshot.plan.nodes.find(n => n.id === nodeID);
    assert(child && node && child.state === 'queued' && child.continuation == null &&
      child.stage == null, 're_resolution_unavailable');
    assert((child.re_resolutions ?? 0) < MAX_RE_RESOLUTIONS, 're_resolution_exhausted');
    // The refresh has already replaced snapshot.catalog, and a cooled or
    // vanished row is absent from it; the child's own routing decision still
    // names the pool of the row that failed, so the other pool stays preferred.
    const failed = fresh.candidates.find(c => c.id === node.candidate_id) ??
      snapshot.bound_rows?.[node.candidate_id] ??
      snapshot.catalog.candidates.find(c => c.id === node.candidate_id);
    const decided = child.routing_decision.resolved_candidate_id === node.candidate_id ?
      child.routing_decision.quota_pool : null;
    const avoidIDs = [...new Set([...(child.avoided_candidate_ids ?? []), node.candidate_id])];
    // An escalated tier route stays at the reference wherever it moves.
    const escalated = child.ladder?.source === 'tier' && child.ladder.escalated === true;
    const choice = selectRouteCandidate(node, child.routing_decision.route_class, snapshot.task, fresh,
      Date.now(), {avoidPool: failed?.quota_pool ?? decided ?? null, avoidIDs, referenceOnly: escalated});
    const next = {...snapshot.plan, nodes: snapshot.plan.nodes.map(n =>
      n.id === nodeID ? {...n, candidate_id: choice.candidate.id} : n)};
    const plan = validatePlan(next, snapshot.task, repairCatalog(snapshot, next, fresh, [nodeID]));
    const reason = /^[a-z0-9_]{1,64}$/.test(failure) ? failure : 'pre_dispatch_failure';
    this._update(taskID, 'candidate_re_resolved', state => {
      assert(!state.cancel_requested && !TERMINAL.has(state.state), 're_resolution_raced_cancel');
      state.plan = plan;
      state.bound_rows = boundRows({nodes: [{candidate_id: choice.candidate.id}]}, fresh, state.bound_rows);
      const target = state.children.find(c => c.id === nodeID);
      target.candidate_id = choice.candidate.id; target.repair_needed = false;
      target.attempt_id = null; target.selected_config = null;
      target.re_resolutions = (target.re_resolutions ?? 0) + 1;
      target.avoided_candidate_ids = avoidIDs;
      target.reference_effort = choice.referenceEffort;
      if (escalated) {
        // The escalation was spent: the new row is the reference itself.
        target.route_kind = 'reference';
        target.ladder = {...target.ladder, reference_candidate_id: choice.candidate.id,
          reference_model: choice.candidate.model, reference_effort: choice.candidate.effort};
      } else {
        // A re-resolved effort-ladder node runs its reference; a tier node
        // keeps its class and the escalation target of its new pool.
        target.route_kind = choice.kind;
        target.ladder = choice.kind === 'tier' && choice.ladder ? {...choice.ladder, escalated: false} : null;
      }
      target.routing_decision = routingDecision(target.routing_decision.route_class, choice.candidate,
        `re_resolved_after:${reason};${choice.why}`, target.ladder, choice.tier);
    });
  }
  /** Deterministic resolution binds independent nodes of one route_class to
   * the same row, and one pool takes one lease at a time. When THIS task's own
   * running node holds that pool, move a not-yet-dispatched graded node to
   * the best dispatchable row of another admitted pool whose lease is free.
   * A node that already moved this way is re-evaluated on every wait: the
   * move is advisory (only the dispatch reservation is authoritative), so
   * when another task takes its new pool before it dispatches, it moves on to
   * a pool that is free now (its original one included) instead of waiting
   * for that task. Not a failure, so it does not spend re-resolutions; moves
   * are bounded by MAX_POOL_SPREADS. Ranks against the bound catalog, with no
   * native probe while that catalog is fresh. A waiting node never refreshes,
   * so once the bound rows have outlived their validity window a move the
   * bound catalog admitted is re-checked with one refresh per catalog bind,
   * never a probe per wait; dispatch still refreshes and re-checks. */
  async _spreadAcrossPools(taskID, snapshot, node, planned) {
    const eligible = (state, candidateID) => {
      const child = this._resolverNode(state, node.id);
      return child && child.state === 'queued' && child.attempts === 0 && child.candidate_id === candidateID &&
        (child.spreads ?? (child.spread === true ? 1 : 0)) < MAX_POOL_SPREADS &&
        child.continuation == null && child.stage == null && !child.repair_needed ? child : null;
    };
    const child = eligible(snapshot, node.candidate_id);
    if (!child) return false;
    if (child.spread !== true) {
      // The first move only parallelizes this task's own work.
      const poolKey = this._poolKey(planned);
      if (!poolKey || !this.poolReservations.has(poolKey)) return false;
      const owner = this.db.prepare('SELECT task_id FROM quota_leases WHERE pool_key=?').get(poolKey);
      if (owner?.task_id !== snapshot.task.task_id) return false;
    }
    const pick = (catalog, now) => {
      try {
        const choice = selectRouteCandidate(node, child.routing_decision.route_class, snapshot.task, catalog,
          now, {avoidPool: planned.quota_pool, avoidIDs: [node.candidate_id]});
        return choice.candidate.quota_pool !== planned.quota_pool &&
          this._leasePossible(choice.candidate, snapshot.task) ? choice : null;
      } catch { return null; }
    };
    let state = snapshot;
    let choice = pick(state.catalog, Date.now());
    const boundAt = state.catalog_bound_at_ms;
    if (!choice && Number.isSafeInteger(boundAt) && this.spreadProbes.get(taskID) !== boundAt &&
        pick(state.catalog, boundAt)) {
      this.spreadProbes.set(taskID, boundAt);
      try { await this._refreshCatalog(taskID); } catch { return false; }
      state = this._load(taskID);
      if (!state || state.cancel_requested || TERMINAL.has(state.state) || !eligible(state, node.candidate_id))
        return false;
      choice = pick(state.catalog, Date.now());
    }
    if (!choice) return false;
    let plan;
    try {
      const next = {...state.plan, nodes: state.plan.nodes.map(n =>
        n.id === node.id ? {...n, candidate_id: choice.candidate.id} : n)};
      plan = validatePlan(next, state.task, repairCatalog(state, next, state.catalog, [node.id]));
    } catch { return false; }
    const catalog = state.catalog;
    try {
      this._update(taskID, 'candidate_spread_across_pools', current => {
        assert(!current.cancel_requested && !TERMINAL.has(current.state), 'spread_raced_cancel');
        const target = current.children.find(c => c.id === node.id);
        assert(target.state === 'queued' && target.attempts === 0 && target.candidate_id === node.candidate_id,
          'spread_raced_dispatch');
        current.plan = plan;
        current.bound_rows = boundRows({nodes: [{candidate_id: choice.candidate.id}]}, catalog, current.bound_rows);
        // A snapshot from before the counter has moved once if it has moved.
        target.spreads = (target.spreads ?? (target.spread === true ? 1 : 0)) + 1;
        target.candidate_id = choice.candidate.id; target.spread = true;
        // The other pool's route: a spread never keeps an effort ladder; a
        // tier node takes the escalation target of its new pool.
        target.route_kind = choice.kind; target.reference_effort = choice.referenceEffort;
        target.ladder = choice.kind === 'tier' && choice.ladder ? {...choice.ladder, escalated: false} : null;
        target.routing_decision = routingDecision(target.routing_decision.route_class, choice.candidate,
          `spread_for_parallelism;${choice.why}`, target.ladder, choice.tier);
      });
    } catch { return false; }
    return true;
  }
  async _refreshCatalog(taskID, requiredIDs = []) {
    const prior = this._load(taskID);
    assert(prior && !prior.cancel_requested && !TERMINAL.has(prior.state), 'catalog_refresh_not_active');
    assert(typeof this.catalog === 'function', 'catalog_unavailable');
    let fresh;
    try { fresh = validateCatalog(await this.catalog(immutable(prior.task)), prior.task); }
    catch (error) { throw new RCCRuntimeError(error.code ?? 'catalog_refresh_failed'); }
    // A row a node was admitted with keeps its exact configuration even after
    // it left and re-entered the catalog.
    const oldRows = new Map([...Object.entries(prior.bound_rows ?? {}),
      ...prior.catalog.candidates.map(c => [c.id, c])]);
    const newRows = new Map(fresh.candidates.map(c => [c.id, c]));
    for (const id of requiredIDs) assert(newRows.has(id), 'selected_candidate_disappeared');
    for (const [id, row] of oldRows) {
      const updated = newRows.get(id);
      if (updated) assert(stable(exactConfig(updated)) === stable(exactConfig(row)),
        'candidate_configuration_changed');
    }
    const refreshedAt = Date.now();
    this._update(taskID, 'catalog_refreshed_before_dispatch', snapshot => {
      assert(!snapshot.cancel_requested && !TERMINAL.has(snapshot.state), 'catalog_refresh_raced_cancel');
      snapshot.catalog = fresh; snapshot.catalog_bound_at_ms = refreshedAt;
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
    if (chargedAttempts(child, Boolean(this._resolverNode(snapshot, childID))) >= snapshot.task.budget.max_attempts) {
      this._update(taskID, 'safe_retry_budget_exhausted', state => {
        state.children.find(c => c.id === childID).state = 'failed';
        state.state = 'failed'; state.error = 'verified_not_dispatched_retry_exhausted';
      });
      return;
    }
    const failed = snapshot.catalog.candidates.find(c => c.id === oldNode.candidate_id) ??
      snapshot.bound_rows?.[oldNode.candidate_id];
    const resolverNode = this._resolverNode(snapshot, childID);
    if (resolverNode && (resolverNode.re_resolutions ?? 0) >= MAX_RE_RESOLUTIONS) {
      this._update(taskID, 'safe_re_resolution_exhausted', state => {
        state.children.find(c => c.id === childID).state = 'failed';
        state.state = 'failed'; state.error = 'verified_not_dispatched_re_resolution_exhausted';
      });
      return;
    }
    let fresh;
    try { fresh = await this._refreshCatalog(taskID); }
    catch (error) { this._hold(taskID, error.code ?? 'catalog_refresh_failed'); return; }
    if (resolverNode) {
      // The planner never chose this row, so it is not asked to choose again:
      // the host re-resolves the same node against the refreshed catalog,
      // excluding the row that verifiably did not dispatch.
      try {
        const error = resolverNode.attempt_history.at(-1)?.error;
        this._reResolve(taskID, childID, fresh,
          typeof error === 'string' && /^[a-z0-9_]{1,64}$/.test(error) ? error : 'verified_not_dispatched');
      } catch (error) {
        this._hold(taskID, error instanceof RCCRuntimeError ? error.code : 'subset_re_resolution_unavailable');
      }
      return;
    }
    let proposed;
    try {
      // Validate against the refreshed catalog: an alternate row that became
      // available only after the failure is a valid repair candidate.
      proposed = validatePlan(await this.plan({task: immutable(snapshot.task),
        catalog: immutable(fresh), repair: {
          failed_node_id: childID, failed_candidate_id: oldNode.candidate_id,
          failed_attempt_id: child.attempt_id,
          failure_receipt: child.attempt_history.at(-1)?.native_receipt ?? null,
          allowed_change: 'candidate_id_only_same_scope_and_objective'}}), snapshot.task,
        repairCatalog(snapshot, snapshot.plan, fresh, [childID]));
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
      state.bound_rows = boundRows({nodes: [node]}, fresh, state.bound_rows);
      const target = state.children.find(c => c.id === childID);
      target.candidate_id = node.candidate_id; target.repair_needed = false;
      target.attempt_id = null; target.selected_config = null;
      if (target.routing_decision) target.routing_decision = routingDecision(null,
        fresh.candidates.find(c => c.id === node.candidate_id), 'adapter_bound');
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
    // Waiting for a busy pool/workspace backs off instead of probing natively.
    let idleDelay = 50;
    const refreshFailures = new Map();
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
          // A child held for a typed reason (a ladder that could not reach its
          // reference) names the hold; any other held child is unverified.
          const reason = snapshot.children.find(c => c.state === 'held' && typeof c.hold_reason === 'string')
            ?.hold_reason ?? 'child_task_quality_unverified';
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
          this._hold(taskID, reason, returned.length ? {
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
      let reResolved = false;
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
        // The lease probe looks only at a row the current catalog still
        // offers. A row that left it (quota_zero, quota_backoff) names a pool
        // this node will not run on: the node goes straight to the refresh,
        // where a host-resolved node re-resolves, instead of waiting behind
        // another task's lease on the pool it left. bound_rows stays for
        // validation only.
        const planned = snapshot.catalog.candidates.find(c => c.id === node.candidate_id);
        if (planned && !this._leasePossible(planned, snapshot.task)) {
          // Independent graded work waits for the busy pool only when the
          // other admitted pool cannot take it now either.
          if (await this._spreadAcrossPools(taskID, snapshot, node, planned)) { reResolved = true; break; }
          continue;
        }
        const resolverNode = this._resolverNode(snapshot, node.id);
        let candidate, fresh;
        try {
          // A host-resolved row may be replaced if it vanished, so its absence
          // is checked by _candidate instead of failing the refresh itself.
          fresh = await this._refreshCatalog(taskID, resolverNode ? [] : [node.candidate_id]);
          candidate = this._candidate(snapshot.task, fresh, node);
          refreshFailures.delete(node.id);
        }
        catch (error) {
          const code = error?.code ?? 'candidate_unavailable';
          const failures = (refreshFailures.get(node.id) ?? 0) + 1;
          if (fresh === undefined && code === 'catalog_refresh_failed' &&
              failures < MAX_TRANSIENT_REFRESH_FAILURES && !this._load(taskID).cancel_requested) {
            // A failed native probe is retried for a node that has not
            // dispatched; a changed or invalid catalog still holds.
            refreshFailures.set(node.id, failures);
            continue;
          }
          if (fresh !== undefined && resolverNode && RE_RESOLVABLE_FAILURES.has(code) &&
              (resolverNode.re_resolutions ?? 0) < MAX_RE_RESOLUTIONS) {
            try { this._reResolve(taskID, node.id, fresh, code); reResolved = true; break; }
            catch (resolution) {
              if (active.size) await this._waitForActiveOrTerminal(active, taskID);
              if (!TERMINAL.has(this._load(taskID).state))
                this._hold(taskID, resolution.code ?? 're_resolution_unavailable');
              return;
            }
          }
          if (active.size) await this._waitForActiveOrTerminal(active, taskID);
          if (!TERMINAL.has(this._load(taskID).state)) this._hold(taskID, code);
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
        let released = false;
        const releaseOnce = () => { if (!released) { released = true; this._release(reservation); } };
        const work = this._executeNode(taskID, node, candidate, releaseOnce)
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
          }).finally(() => { releaseOnce(); active.delete(node.id); });
        active.set(node.id, work);
        idleDelay = 50;
      }
      if (reResolved) { idleDelay = 50; continue; }
      if (active.size) {
        await Promise.race([...active.values(), new Promise(resolve => setTimeout(resolve, 100))]);
        continue;
      }
      if (ready.length) {
        await new Promise(resolve => setTimeout(resolve, idleDelay));
        idleDelay = Math.min(1_000, idleDelay * 2);
        continue;
      }
      this._hold(taskID, 'dag_no_ready_node'); return;
    }
  }

  _ticket(snapshot, node, candidate, attemptID) {
    const policySource = snapshot.task.host_context.owner_policy;
    const sourceSHA = policySource?.sourceSHA256 ?? policySource?.source_sha256 ?? snapshot.task.policy?.source_sha256;
    assert(HASH.test(sourceSHA ?? ''), 'policy_source_unavailable');
    const isSingleFullAgent = snapshot.plan?.nodes.length === 1 &&
      snapshot.plan.nodes[0]?.id === node.id && node.kind === 'agent';
    // An attempt whose answer may still be discarded runs in a fresh native
    // session, never in the owner's own thread: a cheaper effort-ladder
    // attempt (older catalogs) and a REVAS tier attempt below its reference
    // (build 378, escalation not yet spent). A discarded answer then never
    // sits in the owner's thread, and the escalated reference resumes that
    // thread untouched (it never builds on the failed turn). OS-1 records the
    // delivered attempt's session as the conversation's and still hands the
    // recent conversation over in host_context.context.
    const child = snapshot.children?.find(c => c.id === node.id);
    const cheapLadder = child?.route_kind === 'ladder' && child.ladder != null && child.ladder.escalated !== true;
    const pendingTier = child?.route_kind === 'tier' && pendingEscalation(child);
    const resumeSession = cheapLadder || pendingTier ? null : isSingleFullAgent && candidate.surface === 'codex' ?
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
    // A write is never re-dispatched on a provider's word: the reason is valid
    // only on a read-only, not-dispatched, no-effect report with a receipt.
    if (result.error === PROVIDER_QUOTA_REJECTED_BEFORE_EXECUTION)
      assert(result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
        result.side_effects === 'none' && !result.execution_verified && result.native_receipt != null &&
        ticket.selected_config.scope === 'read_only', 'execution_receipt_invalid');
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

  _holdContinuation(taskID, nodeID, reason, settle = null) {
    this._update(taskID, 'continuation_held', state => {
      settle?.(state);
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
        // The initial attempt settled when it handed back.
        const initial = child.attempt_history.find(entry => entry.attempt_id === prior.attempt_id);
        if (initial && UNSETTLED_DISPATCH_STATES.has(initial.state)) {
          initial.state = 'handback_returned';
          initial.native_receipt = prior.native_receipt; initial.usage = prior.usage ?? null;
        }
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
      if (Date.now() - snapshot.created_at_ms - ladderExemptMs(snapshot) >= snapshot.task.budget.max_duration_ms) {
        this._holdContinuation(taskID, node.id, 'continuation_duration_budget_exhausted'); return;
      }
      // The ticket stays bound to the same row id; the ledger records the
      // refreshed row's quota at this continuation's own dispatch.
      let current;
      try {
        const fresh = await this._refreshCatalog(taskID, [candidate.id]);
        current = this._candidate(snapshot.task, fresh, node);
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
      let route = null;
      this._update(taskID, 'continuation_dispatch_started', state => {
        const child = state.children.find(c => c.id === node.id);
        child.state = 'running'; child.attempt_id = continuationAttemptID;
        child.attempts += 1; child.dispatched_at_ms = Date.now();
        child.continuation.state = 'dispatched';
        route = this._pendLedger(state, child, current, continuationAttemptID);
        child.attempt_history.push({attempt_id: continuationAttemptID,
          candidate_id: candidate.id, state: 'continuation_dispatch_started',
          native_receipt: null, usage: null, ledger: route});
      });
      this.ledgerInflight.set(continuationAttemptID, {taskID, nodeID: node.id, attemptID: continuationAttemptID, route});
      let settled = null;
      try {
        const controller = new AbortController();
        this.controllers.set(continuationAttemptID, {taskID, controller});
        let result;
        try {
          result = this._validateExecution(await this.executeContinuation(immutable(ticket), controller.signal), ticket);
          settled = result;
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
          const safe = result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
            result.side_effects === 'none' && result.native_receipt !== null;
          // The continuation attempt itself settles here, with its receipt.
          const settle = state => {
            const entry = state.children.find(c => c.id === node.id)?.attempt_history
              .find(item => item.attempt_id === continuationAttemptID);
            if (entry) { entry.state = safe ? 'verified_not_dispatched' : 'effects_uncertain';
              entry.native_receipt = result.native_receipt; entry.usage = result.usage ?? null; }
          };
          if (safe) this._holdContinuation(taskID, node.id, 'continuation_verified_not_dispatched', settle);
          else this._update(taskID, 'continuation_failed_after_dispatch', state => {
            settle(state);
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
          // This continuation has settled: record it now, not after staging.
          this._recordLedger(continuationAttemptID, settled, 'not_registered', 'source_candidate_returned');
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
      } finally {
        // A continuation is its own provider attempt: one ledger record.
        this._recordLedger(continuationAttemptID, settled, 'not_registered');
      }
    }
    this._holdContinuation(taskID, node.id, 'continuation_phase_limit_reached');
  }

  /** Route facts for the routing ledger, fixed when an attempt dispatches.
   * `verifier` (internal) says a family verifier was relevant to it. */
  _ledgerRoute(snapshot, child, candidate) {
    const explicitRoute = snapshot.task.mode === 'explicit_routing_test';
    const routeClass = !explicitRoute && ROUTE_CLASSES.includes(child.routing_decision?.route_class) ?
      child.routing_decision.route_class : null;
    const kind = explicitRoute ? 'explicit_route' : routeClass === null ? 'adapter_bound' : child.route_kind ?? 'unrecorded';
    const ladder = ['ladder', 'tier'].includes(kind) && child.ladder ?
      {cheap_effort: child.ladder.cheap_effort, reference_effort: child.ladder.reference_effort} : null;
    if (ladder && child.ladder.source === 'tier')
      Object.assign(ladder, {cheap_model: child.ladder.cheap_model, reference_model: child.ladder.reference_model});
    return {route_class: routeClass, route_kind: kind, surface: candidate.surface,
      quota_pool: candidate.quota_pool, model: candidate.model, effort: candidate.effort, scope: candidate.scope,
      reference_effort: routeClass === null ? null : child.reference_effort ?? null, ladder,
      // Build 378: the bound model's tier (null without one or on an older
      // catalog) and whether this attempt is a REVAS escalation.
      tier: routeClass === null ? null : child.routing_decision?.tier ?? null,
      escalated: routeClass !== null && child.ladder?.escalated === true,
      quota_remaining_fraction: candidate.quota_remaining_fraction, dispatched_at_ms: child.dispatched_at_ms ?? null,
      verifier: Boolean(this._nodeVerifier(snapshot, child.id, candidate))};
  }
  /** Inside a dispatch update: fix the attempt's route facts and mark the
   * attempt pending in the same transaction, so an attempt that is never
   * settled by this owner (stop, crash) is recorded once at restart. */
  _pendLedger(snapshot, child, candidate, attemptID) {
    const route = this._ledgerRoute(snapshot, child, candidate);
    this.db.prepare('INSERT OR REPLACE INTO ledger_pending(attempt_id,task_id,node_id,route) VALUES(?,?,?,?)')
      .run(attemptID, snapshot.task.task_id, child.id, stable(route));
    return route;
  }
  _logLedger(error) {
    const raw = error instanceof RCCRuntimeError ? error.code : error?.code;
    const code = typeof raw === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(raw) ? raw : 'routing_ledger_write_failed';
    try {
      if (this.ledgerLog) this.ledgerLog(code);
      else process.stderr.write(`os1-rcc: routing ledger write failed (${code}); the task continues\n`);
    } catch { /* Logging is best effort as well. */ }
  }
  _appendLedger({taskID, nodeID, attemptID, route}, outcome, verifierOutcome, attemptState) {
    this.ledger.append({schema: 1, task_id: taskID, node_id: nodeID, attempt_id: attemptID,
      family: routeFamily(route.route_class, route.scope, route.surface), route_class: route.route_class,
      scope: route.scope, surface_kind: surfaceKind(route.surface), surface: route.surface,
      quota_pool: route.quota_pool, model: route.model, effort: route.effort, route_kind: route.route_kind,
      reference_effort: route.reference_effort, ladder: route.ladder, tier: route.tier ?? null,
      escalated: route.escalated === true, usage: outcome.usage ?? null,
      quota_remaining_fraction: route.quota_remaining_fraction,
      execution_verified: outcome.execution_verified === true, task_quality: outcome.task_quality ?? null,
      verifier_outcome: verifierOutcome, attempt_state: attemptState,
      dispatched_at_ms: route.dispatched_at_ms, settled_at_ms: Date.now()});
  }
  /** Append one routing-ledger record for a settled attempt: ids, route,
   * usage, quota at dispatch, execution/quality flags and verifier outcome.
   * No request text, output or path. Exactly once per attempt (the in-memory
   * entry is consumed), also after stop: the ledger does not need the DB. A
   * write failure is logged, never thrown: the ledger must not fail or hold a
   * task. `attemptState` defaults to the attempt's recorded state. */
  _recordLedger(attemptID, result, verifierOutcome, attemptState = null) {
    const pending = this.ledgerInflight.get(attemptID);
    if (!pending) return;
    this.ledgerInflight.delete(attemptID);
    this._flushLedgerBacklog();
    let state = attemptState, write = null;
    try {
      if (state === null) state = this.closed ? 'settled_after_stop' : this._load(pending.taskID)?.children
        .find(c => c.id === pending.nodeID)?.attempt_history.find(item => item.attempt_id === attemptID)?.state ?? null;
      // After stop a restart may already have recorded this attempt as
      // interrupted: never record it twice.
      if (this.closed && this.ledger.attemptIDs().has(attemptID)) return;
      const settled = state === null || UNSETTLED_ATTEMPT_STATES.has(state) ? 'interrupted' : state;
      write = () => this._appendLedger(pending, {usage: result?.usage ?? null,
        execution_verified: result?.execution_verified, task_quality: result?.task_quality ?? null},
      verifierOutcome, settled);
      write();
    } catch (error) {
      this._logLedger(error);
      // The pending row stays for the restart; a parity failure also closes
      // every ladder in this process until it is written.
      if (write && !this.closed && LEDGER_FAILURE_OUTCOMES.has(verifierOutcome)) this.ledgerBacklog.set(attemptID, write);
      return;
    }
    this._clearLedgerPending(attemptID);
  }
  _clearLedgerPending(attemptID) {
    if (this.closed) return;
    try { this.transaction(() => this.db.prepare('DELETE FROM ledger_pending WHERE attempt_id=?').run(attemptID)); }
    catch (error) { this._logLedger(error); }
  }
  /** Retry parity failures whose ledger write failed, oldest first; stop at
   * the first that still fails. */
  _flushLedgerBacklog() {
    for (const [attemptID, write] of this.ledgerBacklog) {
      try { write(); } catch (error) { this._logLedger(error); return; }
      this.ledgerBacklog.delete(attemptID);
      this._clearLedgerPending(attemptID);
    }
  }
  /** Ladder parity evidence: none while a parity failure waits to be written,
   * so a lost failure can never readmit a cheaper route. */
  _ladderStats(family, model, effort) {
    if (this.ledgerBacklog.size) this._flushLedgerBacklog();
    if (this.ledgerBacklog.size) return {verified_passes: 0, verifier_failures: 0};
    return this.ledgerStats(family, model, effort);
  }
  /** The registered verifier for a graded read-only node's family, if any. */
  _nodeVerifier(snapshot, nodeID, candidate) {
    const child = this._resolverNode(snapshot, nodeID);
    if (!child || candidate.scope !== 'read_only' || this.verifierRegistry.size === 0) return null;
    const family = routeFamily(child.routing_decision.route_class, candidate.scope, candidate.surface);
    const verify = this.verifierRegistry.get(family);
    return typeof verify === 'function' ? {verify, family} : null;
  }
  /** Run the family verifier on a returned read-only node. Pass adopts it;
   * a ladder route that fails goes to _ladderFailed (its output is never
   * adopted). Returns the ledger outcome. */
  async _verifyNode(taskID, node, candidate, result, {verify, family}) {
    let passed = false, timer;
    try {
      const verdict = await Promise.race([verify(immutable({schema: 1, task_id: taskID, node_id: node.id,
        family, instruction: node.instruction, output: result.output, native_receipt: result.native_receipt ?? null,
        selected_config: exactConfig(candidate)})), new Promise(resolve => {
        timer = setTimeout(() => resolve(null), NODE_VERIFIER_TIMEOUT_MS); timer.unref?.();
      })]);
      passed = plain(verdict) && verdict.passed === true;
    } catch { passed = false; }
    finally { clearTimeout(timer); }
    const outcome = passed ? 'pass' : 'fail';
    if (this.closed) return outcome;
    const state = this._load(taskID);
    const child = state?.children.find(c => c.id === node.id);
    if (!state || TERMINAL.has(state.state) || child?.state !== 'waiting' || child.attempt_id !== result.attempt_id)
      return outcome;
    if (!passed && pendingEscalation(child)) {
      this._ladderFailed(taskID, node, candidate, result, outcome);
      return outcome;
    }
    this._update(taskID, passed ? 'node_verifier_passed' : 'node_verifier_failed', snapshot => {
      const target = snapshot.children.find(c => c.id === node.id);
      if (target?.state !== 'waiting' || target.attempt_id !== result.attempt_id) return;
      target.state = 'completed'; target.node_verifier = outcome;
      const attempt = target.attempt_history.find(entry => entry.attempt_id === result.attempt_id);
      if (attempt) { attempt.state = 'completed'; attempt.verifier = outcome; }
    });
    return outcome;
  }
  /** The cheaper ladder attempt failed: its verifier failed ('fail') or it
   * returned nothing deliverable ('not_returned'). Its output is never
   * adopted. Once, read-only, not stopping or cancelled, and only when the
   * attempt dispatched and reported no side effects, the node returns to the
   * queue bound to its reference row. Otherwise ONLY this child is held
   * (cancelled under a cancel request) with a typed reason: the scheduler
   * settles the task after every running sibling reconciles. */
  _ladderFailed(taskID, node, candidate, result, outcome) {
    const state = this._load(taskID);
    const child = state?.children.find(c => c.id === node.id);
    if (!state || TERMINAL.has(state.state) || child?.state !== 'waiting' || child.attempt_id !== result.attempt_id) return;
    let reason;
    if (state.cancel_requested) reason = 'ladder_cancelled_before_escalation';
    else if (this.stopping) reason = 'owner_stopped_before_ladder_escalation';
    else if (result.dispatch_stage !== 'dispatched' || result.side_effects !== 'none')
      reason = 'ladder_escalation_effects_reported';
    else if (!child.ladder || child.ladder.escalated || candidate.scope !== 'read_only')
      reason = 'ladder_verifier_failed_reference_unavailable';
    else {
      try { this._escalateLadder(taskID, node.id, result.attempt_id, outcome); return; }
      catch (error) { reason = error instanceof RCCRuntimeError ? error.code : 'ladder_reference_unavailable'; }
    }
    if (this.closed) return;
    this._update(taskID, 'ladder_escalation_unavailable', snapshot => {
      const target = snapshot.children.find(c => c.id === node.id);
      if (TERMINAL.has(snapshot.state) || target?.state !== 'waiting' || target.attempt_id !== result.attempt_id) return;
      Object.assign(target, {state: snapshot.cancel_requested ? 'cancelled' : 'held', output: null,
        execution_verified: false, task_quality: 'unverified', parity_state: 'unverified', native_summary: null,
        node_verifier: outcome, hold_reason: reason, finished_at_ms: Date.now()});
      const attempt = target.attempt_history.find(entry => entry.attempt_id === result.attempt_id);
      if (attempt) { attempt.state = outcome === 'fail' ? 'ladder_verifier_failed' : 'ladder_not_returned';
        attempt.verifier = outcome; }
    });
  }
  /** Once, read-only only: the cheaper attempt failed, so the node returns to
   * the queue bound to its reference row, admitted with the plan so a
   * sibling's refresh cannot lose it. An effort ladder escalates to the same
   * model in the same pool at the reference effort. A tier route (build 378)
   * escalates to its pool's frontier reference, or to another pool's when
   * that one cannot dispatch now. The returned output is never adopted,
   * nothing with uncertain effects is replayed, and the failed attempt's time
   * and estimated cost are not charged to the owner's budgets (like its
   * attempt). Dispatch then refreshes the catalog and, if the reference row
   * cannot run, re-resolves (a tier node to a reference only). */
  _escalateLadder(taskID, nodeID, attemptID, outcome = 'fail') {
    const snapshot = this._load(taskID);
    const child = snapshot.children.find(c => c.id === nodeID);
    const node = snapshot.plan.nodes.find(n => n.id === nodeID);
    const find = id => typeof id !== 'string' ? undefined :
      snapshot.catalog.candidates.find(c => c.id === id) ?? snapshot.bound_rows?.[id];
    const cheap = node && find(node.candidate_id);
    const tier = child.ladder?.source === 'tier';
    let reference = find(child.ladder?.reference_candidate_id);
    if (tier && node && cheap) {
      const now = Date.now();
      const offered = reference && snapshot.catalog.candidates.find(c => c.id === reference.id);
      if (!(offered && dispatchable(offered, snapshot.task, now))) {
        try {
          reference = selectRouteCandidate(node, child.routing_decision?.route_class, snapshot.task, snapshot.catalog,
            now, {referenceOnly: true, preferPool: cheap.quota_pool, avoidIDs: [cheap.id]}).candidate;
        } catch { /* Keep the admitted reference row: dispatch re-resolves it. */ }
      }
    }
    assert(node && cheap && reference && node.scope === 'read_only' && reference.scope === 'read_only' &&
      reference.id !== cheap.id && (tier ? reference.surface !== 'local' :
        reference.model === cheap.model && reference.quota_pool === cheap.quota_pool &&
        reference.effort === child.ladder.reference_effort), 'ladder_reference_unavailable');
    const next = {...snapshot.plan, nodes: snapshot.plan.nodes.map(n =>
      n.id === nodeID ? {...n, candidate_id: reference.id} : n)};
    const rows = snapshot.catalog.candidates.some(c => c.id === reference.id) ? snapshot.catalog :
      {...snapshot.catalog, candidates: [...snapshot.catalog.candidates, reference]};
    const plan = validatePlan(next, snapshot.task, repairCatalog(snapshot, next, rows, [nodeID]));
    this._update(taskID, 'ladder_escalated_to_reference', state => {
      assert(!state.cancel_requested && !TERMINAL.has(state.state), 'ladder_escalation_raced_cancel');
      const target = state.children.find(c => c.id === nodeID);
      assert(target.state === 'waiting' && target.attempt_id === attemptID, 'ladder_escalation_raced_state');
      state.plan = plan;
      state.bound_rows = {...(state.bound_rows ?? {}), [reference.id]: immutable(reference)};
      const attempt = target.attempt_history.find(entry => entry.attempt_id === attemptID);
      if (attempt) { attempt.state = outcome === 'fail' ? 'ladder_verifier_failed' : 'ladder_not_returned';
        attempt.verifier = outcome; }
      // Its [dispatched, now] interval: ladderExemptMs exempts the union.
      const dispatchedAt = attempt?.ledger?.dispatched_at_ms;
      const escalatedAt = Date.now();
      if (Number.isSafeInteger(dispatchedAt) && escalatedAt >= dispatchedAt)
        state.ladder_exempt_intervals = [...(state.ladder_exempt_intervals ?? []), [dispatchedAt, escalatedAt]];
      state.ladder_exempt_cost_units = (state.ladder_exempt_cost_units ?? 0) + (cheap.estimated_cost_units ?? 0);
      Object.assign(target, {state: 'queued', candidate_id: reference.id, attempt_id: null, selected_config: null,
        dispatched_at_ms: null, finished_at_ms: null, output: null, execution_verified: false,
        task_quality: 'unverified', parity_state: 'unverified', native_receipt: null, native_summary: null,
        usage: null, repair_needed: false, route_kind: 'reference', node_verifier: outcome});
      target.ladder = tier ? {...target.ladder, escalated: true, reference_candidate_id: reference.id,
        reference_model: reference.model, reference_effort: reference.effort} : {...target.ladder, escalated: true};
      const why = tier ?
        (outcome === 'fail' ? 'tier_escalated_after_verifier_failure' : 'tier_escalated_after_failure_signal') +
          ';route_reference;tier_' + (tierOf(state.catalog, reference.model) ?? 'frontier') +
          (reference.quota_pool === cheap.quota_pool ? ';same_pool' : ';other_pool') :
        (outcome === 'fail' ? 'ladder_escalated_after_verifier_failure' : 'ladder_escalated_after_undeliverable_result') +
          ';route_reference';
      target.routing_decision = routingDecision(target.routing_decision.route_class, reference,
        why + ';effort_' + reference.effort + ';' +
        (reference.surface.endsWith('-chat') ? 'chat_lane_same_route' : 'agent_surface'), target.ladder,
        tier ? tierOf(state.catalog, reference.model) ?? 'frontier' : undefined);
    });
  }

  /** `releaseReservation` (idempotent) frees this node's worker slot and pool
   * reservation once no provider work runs for it, before a node verifier. */
  async _executeNode(taskID, node, candidate, releaseReservation = null) {
    const task = this._load(taskID).task;
    const start = this._load(taskID);
    const resolver = Boolean(this._resolverNode(start, node.id));
    // One dispatch per call: every path below returns. The budget counts
    // charged attempts, so an uncharged pre-execution quota rejection never
    // leaves a queued node that can neither run nor fail.
    for (let attempt = start.children.find(c => c.id === node.id).attempts + 1;
         chargedAttempts(start.children.find(c => c.id === node.id), resolver) < task.budget.max_attempts;
         attempt++) {
      const before = this._load(taskID);
      if (before.cancel_requested || this.stopping) { this._markCancelled(taskID); return; }
      // A failed cheaper ladder attempt is the Core's own bet: its wall time
      // and estimated cost are not charged to the owner, as its attempt is not
      // (a reference-only route would have dispatched when it did). The time
      // is exempt task-wide, so a dependent or sibling node is never held for
      // the ladder's wait either.
      if (Date.now() - before.created_at_ms - ladderExemptMs(before) >= task.budget.max_duration_ms) {
        this._hold(taskID, 'task_duration_budget_exhausted'); return;
      }
      if (task.budget.max_cost_units !== null && before.spent_cost_units - (before.ladder_exempt_cost_units ?? 0) +
          candidate.estimated_cost_units > task.budget.max_cost_units) {
        this._hold(taskID, 'task_cost_budget_exhausted'); return;
      }
      const attemptID = randomUUID();
      const ticket = this._ticket(before, node, candidate, attemptID);
      let route = null;
      this._update(taskID, 'dispatch_started', snapshot => {
        const child = snapshot.children.find(c => c.id === node.id);
        child.state = 'running'; child.attempt_id = attemptID; child.attempts += 1;
        child.dispatched_at_ms = Date.now();
        child.started_at_ms ??= child.dispatched_at_ms;
        child.selected_config = exactConfig(candidate);
        // The route facts the routing ledger records for this attempt, fixed
        // at dispatch (a later escalation or re-resolution changes the child).
        route = this._pendLedger(snapshot, child, candidate, attemptID);
        child.attempt_history.push({attempt_id: attemptID, candidate_id: candidate.id,
          state: 'dispatch_started', native_receipt: null, usage: null, ledger: route});
        if (candidate.estimated_cost_units !== null) snapshot.spent_cost_units += candidate.estimated_cost_units;
      });
      this.ledgerInflight.set(attemptID, {taskID, nodeID: node.id, attemptID, route});
      // With a relevant verifier, an attempt that yields nothing to verify
      // counts against its route's parity; a stop or cancel interrupts it.
      let result = null, verifierOutcome = route.verifier ? 'not_returned' : 'not_registered', attemptState = null;
      const interrupted = route.verifier ? 'interrupted' : 'not_registered';
      try {
        const controller = new AbortController();
        this.controllers.set(attemptID, {taskID, controller});
        try { result = this._validateExecution(await this.execute(immutable(ticket), controller.signal), ticket); }
        catch (error) {
          this.controllers.delete(attemptID);
          attemptState = 'effects_uncertain';
          if (!this.closed) this._update(taskID, 'dispatch_effects_uncertain', snapshot => {
            const child = snapshot.children.find(c => c.id === node.id);
            child.state = 'effects_uncertain'; settleDispatchEntry(child, 'effects_uncertain');
            snapshot.state = 'effects_uncertain';
            snapshot.error = error instanceof RCCRuntimeError ? error.code : 'executor_return_unknown';
          });
          return;
        }
        this.controllers.delete(attemptID);
        if (this.closed) { verifierOutcome = interrupted; return; }
        const current = this._load(taskID);
        if (TERMINAL.has(current.state)) { verifierOutcome = interrupted; return; }
        if (current.cancel_requested || this.stopping) {
          verifierOutcome = interrupted;
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
        // A handback or a source repair settles this attempt now; record it
        // before the continuation chain or the source stage, not after.
        if (result.handback) {
          this._recordLedger(attemptID, result, verifierOutcome, 'handback_returned');
          await this._continueHandback(taskID, node, candidate, result);
          return;
        }
        if (result.repair_source) {
          this._recordLedger(attemptID, result, verifierOutcome, 'source_candidate_returned');
          await this._stageSourceAfterExecution(taskID, node, candidate, result, ticket);
          return;
        }
        if (result.status === 'succeeded') {
          // A registered family verifier runs before the child is deliverable:
          // the child waits (not completed) so the task cannot settle on an
          // output a ladder may still have to replace.
          const verifier = this._nodeVerifier(current, node.id, candidate);
          const recorded = current.children.find(c => c.id === node.id);
          // A tier route below its reference also fails on a whitespace-only
          // output or a failure recorded beside the finished attempt.
          const deliverable = result.execution_verified &&
            ['execution_only', 'task_verified'].includes(result.task_quality) &&
            boundedText(result.output, MAX_OUTPUT_BYTES) &&
            !(pendingEscalation(recorded) && recorded.ladder.source === 'tier' && tierFailureSignal(result));
          // A cheaper ladder or tier attempt that returned nothing deliverable
          // is a failure signal: its output is discarded, never held for return.
          const discard = !deliverable && pendingEscalation(recorded);
          this._update(taskID, 'child_returned', snapshot => {
            const child = snapshot.children.find(c => c.id === node.id);
            child.output = discard ? null : result.output;
            child.execution_verified = discard ? false : result.execution_verified;
            child.task_quality = discard ? 'unverified' : result.task_quality;
            child.parity_state = discard ? 'unverified' : result.parity_state;
            child.native_receipt = result.native_receipt;
            child.native_summary = discard ? null : result.native_summary ?? null;
            child.usage = result.usage ?? null;
            child.finished_at_ms = Date.now();
            child.state = discard || (deliverable && verifier) ? 'waiting' : deliverable ? 'completed' : 'held';
            if (child.state === 'waiting') child.dispatched_at_ms = null;
            child.attempt_history.at(-1).state = discard ? 'ladder_not_returned' :
              child.state === 'waiting' ? 'node_verifier_pending' : child.state;
            child.attempt_history.at(-1).native_receipt = result.native_receipt;
            child.attempt_history.at(-1).usage = result.usage ?? null;
          });
          if (discard) { this._ladderFailed(taskID, node, candidate, result, 'not_returned'); return; }
          if (!deliverable) return;
          verifierOutcome = 'not_registered';
          if (verifier && this._load(taskID)?.children.find(c => c.id === node.id)?.state === 'waiting') {
            // No provider work runs while the verifier thinks: free the worker
            // slot and the pool now, so neither a cancel nor a slow verifier
            // holds another task's dispatch on this pool.
            releaseReservation?.();
            verifierOutcome = await this._verifyNode(taskID, node, candidate, result, verifier);
          }
          return;
        }
        if (result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
            result.side_effects === 'none' && result.native_receipt !== null) {
          verifierOutcome = route.verifier ? 'not_dispatched' : 'not_registered';
          const typedError = typeof result.error === 'string' && /^[a-z0-9_]{1,64}$/.test(result.error) ?
            result.error : null;
          const recorded = current.children.find(c => c.id === node.id);
          const charged = chargedAttempts({attempts: recorded.attempts, attempt_history: [
            ...recorded.attempt_history.slice(0, -1), {state: 'verified_not_dispatched', error: typedError}]},
          resolver);
          if (charged < task.budget.max_attempts) {
            this._update(taskID, 'safe_retry_requires_subset_plan', snapshot => {
              const child = snapshot.children.find(c => c.id === node.id);
              child.state = 'queued'; child.dispatched_at_ms = null; child.repair_needed = true;
              child.attempt_history.at(-1).state = 'verified_not_dispatched';
              child.attempt_history.at(-1).native_receipt = result.native_receipt;
              // A typed pre-execution reason (for example a provider quota
              // rejection) names the host re-resolution; free text never does.
              child.attempt_history.at(-1).error = typedError;
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
        // A cheaper ladder attempt that ran and failed with NO side effects is
        // a ladder failure like an undeliverable result: nothing is replayed
        // and its pool is not poisoned; the node escalates once to its
        // reference. Possible or confirmed effects, or an unknown dispatch,
        // stay effects_uncertain below.
        const failedChild = current.children.find(c => c.id === node.id);
        if (result.status === 'failed' && result.dispatch_stage === 'dispatched' && result.side_effects === 'none' &&
            pendingEscalation(failedChild) && candidate.scope === 'read_only') {
          this._update(taskID, 'child_returned', snapshot => {
            const child = snapshot.children.find(c => c.id === node.id);
            Object.assign(child, {output: null, execution_verified: false, task_quality: 'unverified',
              parity_state: 'unverified', native_receipt: result.native_receipt, native_summary: null,
              usage: result.usage ?? null, finished_at_ms: Date.now(), state: 'waiting', dispatched_at_ms: null});
            child.attempt_history.at(-1).state = 'ladder_not_returned';
            child.attempt_history.at(-1).native_receipt = result.native_receipt;
            child.attempt_history.at(-1).usage = result.usage ?? null;
          });
          this._ladderFailed(taskID, node, candidate, result, 'not_returned');
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
      } finally {
        // One ledger record per settled attempt. It never fails or holds a task.
        this._recordLedger(attemptID, result, verifierOutcome, attemptState);
      }
    }
    // Reached only when the charged budget was already spent before this
    // dispatch: fail closed instead of leaving a queued node behind.
    this._update(taskID, 'safe_retry_budget_exhausted', snapshot => {
      if (TERMINAL.has(snapshot.state)) return;
      snapshot.children.find(c => c.id === node.id).state = 'failed';
      snapshot.state = 'failed'; snapshot.error = 'verified_not_dispatched_retry_exhausted';
    });
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
      const verifierPending = state.children.some(child => verifierPendingChild(child));
      this._update(row.task_id, 'owner_stopping', snapshot => {
        snapshot.state = dispatched ? 'effects_uncertain' : 'held';
        // A returned node whose verifier had not answered did dispatch: say
        // so, instead of claiming nothing was dispatched.
        snapshot.error = dispatched ? 'owner_stopped_active_dispatch' :
          verifierPending ? 'owner_stopped_node_verifier_pending' : 'owner_stopped_before_dispatch';
        for (const child of snapshot.children) {
          if (child.state === 'running') {
            child.state = dispatched ? 'effects_uncertain' : 'held';
            if (child.state === 'effects_uncertain') settleDispatchEntry(child, 'effects_uncertain');
          } else if (verifierPendingChild(child)) child.state = 'held';
        }
      });
    }
    for (const row of rows) this._releaseSafeLeases(row.task_id);
    this.transaction(() => this.db.prepare('DELETE FROM owner WHERE id=1 AND token=?').run(this.token));
    this.closed = true; this.db.close();
  }
}
