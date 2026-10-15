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
// The local model OpenClaw already runs (the planner's model). A catalog row
// of it is an explicit route's local EXECUTION surface (route-all,
// 2026-10-14): read-only, tools-free, quota-free, transport local. It is
// bound only for an explicit route that names the local surface; Auto never
// routes ordinary work to it, and it is never the deterministic exact row.
export const LOCAL_WORKER_MODEL = 'qwen3.5:4b';
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
// choice is the admission: no ledger parity is needed. One ledger-derived
// check remains (tierCostGate): a guarded read-only tier route whose cost
// evidence says, with COST_GATE_CONFIDENCE, that cheap-then-escalate costs
// more tokens than the reference because of its escalations goes straight to
// that reference (each task node still explores the tier with probability
// 1 - P_more).
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
// Cost gate (tierCostGate): a guarded read-only tier route runs the cheaper
// route and, with escalation probability p, the reference once more, so its
// expected cost is mu_C + p*mu_R against mu_R for routing straight to the
// reference: the tier is cheaper iff p < 1 - mu_C/mu_R (exact for this
// structure). p, mu_C and mu_R are estimated from the routing ledger as a
// TOKEN PROXY (input + output + reasoning tokens), not subscription quota.
// Quota per token is not observable and is assumed no higher on the cheaper
// model, so the token proxy can only show the tier costing more THROUGH its
// escalations: P_more = Pr[mu_C < mu_R and mu_C + p*mu_R > mu_R], and the
// gate never acts without an observed escalation or when the cheaper attempt
// alone costs at least a reference attempt in tokens. The node goes straight
// to its reference only when P_more reaches COST_GATE_CONFIDENCE, and even
// then a task still tries the tier with probability 1 - P_more (posterior
// probability matching, seeded per task and node) so the evidence keeps
// moving. COST_GATE_CONFIDENCE is the one owner-tunable number: a confidence
// level, not a cost threshold.
export const COST_GATE_CONFIDENCE = 0.9;
// Monte Carlo draws of the posterior (standard error <= 0.008 at any P).
export const COST_GATE_DRAWS = 4000;
// Below two cost samples per arm the sample spread is undefined: tier.
export const COST_GATE_MIN_SAMPLES = 2;
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
/** The one local model execution row shape: the pinned local model on the
 * local surface, read-only, no tools, no quota pool. */
export function localWorkerRow(c) {
  return c?.surface === 'local' && c.transport === 'local' && c.quota_pool === 'none' &&
    c.model === LOCAL_WORKER_MODEL && Array.isArray(c.tools) && c.tools.length === 0 &&
    c.scope === 'read_only' && c.permission_profile === 'read_only';
}
/** A local row the host may compute itself (a deterministic node): never the
 * local model execution row. */
function localExactRow(c) {
  return c.surface === 'local' && c.transport === 'local' && c.quota_pool === 'none' &&
    c.tools.length === 0 && !localWorkerRow(c);
}
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
  // An explicit local route binds its row in localRouteCandidate, never here.
  if (node.kind === 'deterministic' ? !localExactRow(c) : c.surface === 'local') return false;
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
/** An explicit route test on a tier-routed catalog: the planner grades each
 * named route and the host binds its model and effort on that route's own
 * surface (an older catalog keeps the planner's exact candidate choice). */
export function explicitTierRouting(task, catalog) {
  return task?.mode === 'explicit_routing_test' && modelTiers(catalog) !== null;
}
/** A model belongs to a family only on a whole name token: the same rule as
 * Swift RoutingIntent.model(_:belongsTo:), so "sol" never matches "console". */
function modelInFamily(model, family) {
  return typeof model === 'string' && model.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(family);
}
// A graded explicit-route node names its route by its position in the owner's
// ORIGINAL route list (requested-1 ... requested-8), the same ordinal older
// snapshots use for their display surface.
const EXPLICIT_NODE_ID = /^requested-([1-8])$/;
export function explicitRouteNodeID(index) { return `requested-${index + 1}`; }
/** The explicit route a graded node binds, with that route's OWN effort or
 * model-family words (catalog explicit_route_intents, aligned with the
 * original list; one route's words never constrain another route). Null
 * outside an explicit route test. A node that names no remaining route
 * (unknown ordinal, a dropped GPT route, a changed payload) is a binding
 * mismatch: the host never picks a surface for it. */
function explicitRouteOf(node, task, catalog) {
  if (task?.mode !== 'explicit_routing_test') return null;
  const routes = task.host_context?.explicit_routes;
  const match = EXPLICIT_NODE_ID.exec(node?.id ?? '');
  const index = match ? Number(match[1]) - 1 : -1;
  const route = Array.isArray(routes) ? routes[index] : undefined;
  assert(route && !DROPPED_ROUTE_SURFACES.has(route.surface) && node.instruction === route.instruction &&
    (node.dependencies ?? []).length === 0, 'explicit_route_binding_mismatch');
  const intent = Array.isArray(catalog?.explicit_route_intents) ? catalog.explicit_route_intents[index] ?? null : null;
  return {index, surface: route.surface, intent};
}
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
/** A row tier routing may bind for a graded node: a tiered model, or a model
 * of the family the owner explicitly named. A model with no tier is never
 * chosen by tier alone. The catalog already holds only the named family's
 * rows for a whole-request intent; an explicit route's own family word
 * narrows the rows here (its catalog is not filtered per route). */
function tierRoutable(candidate, catalog, intent) {
  return intent?.model_family ? modelInFamily(candidate.model, intent.model_family) :
    tierOf(catalog, candidate.model) !== null;
}
/** The rows that can carry this node, per quota pool, in catalog order;
 * `surface` keeps only one named surface (an explicit route). */
function poolRows(node, catalog, options = {}) {
  const pools = new Map();
  catalog.candidates.forEach((candidate, index) => {
    if (!eligibleRow(candidate, node, options)) return;
    if (options.surface != null && candidate.surface !== options.surface) return;
    if (!pools.has(candidate.quota_pool)) pools.set(candidate.quota_pool, {pool: candidate.quota_pool, rows: []});
    pools.get(candidate.quota_pool).rows.push({candidate, index});
  });
  return [...pools.values()];
}
/** The rows of one pool that match one (tier, effort) entry. A REFERENCE
 * effort is the highest effort up to max that the entry's tier (or, for an
 * explicitly named family, the family) offers in this pool. An explicit
 * effort word is a hard constraint on every entry (tierEntries). */
function entryRows(rows, entry, catalog, intent) {
  const matching = rows.filter(({candidate}) => tierRoutable(candidate, catalog, intent) &&
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
/** The reference an owner constraint leaves: the named family at its highest
 * effort up to max (or at the owner's effort word), else the frontier at the
 * owner's effort word (or its highest up to max). The host-chosen route below
 * it is guarded against exactly this one. */
function intentReferenceRows(rows, catalog, intent) {
  return intent?.model_family ? entryRows(rows, {tier: null, effort: REFERENCE_EFFORT}, catalog, intent) :
    tierReferenceRows(rows, catalog, intent);
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

/** The builder's per-model pool score (share x the model's own remaining
 * quota / hours to its own reset), or null when the catalog has none for it
 * (older catalogs, unknown quota). */
function quotaScore(catalog, model) {
  const score = plain(catalog?.quota_scores) ? catalog.quota_scores[model] : undefined;
  return int(score, 0, 1_000_000_000) ? score : null;
}

// ---- Cost gate: tier or reference, from the routing ledger ----
// Derivation (doc: DYNAMIC_TIER_ROUTING_BUILD378.md, "Cost gate"). A guarded
// read-only tier route pays one cheaper attempt (mean cost mu_C) and, with
// probability p (a failure signal), one reference attempt (mu_R); routing
// straight to the reference pays mu_R. Whatever a reference run does
// (delivers, is held, fails after dispatch) it does the same in both arms, so
// mu_R is the mean over EVERY reference run that ended on its own, failed
// runs included, and the tier costs more iff mu_C + p*mu_R > mu_R, i.e.
// p > 1 - mu_C/mu_R.
// Posterior: p ~ Beta(1 + escalations, 1 + trials - escalations) (uniform
// prior); each mean cost ~ Student-t(n-1) at the sample mean with scale sd/sqrt(n)
// (the posterior of a mean under the usual noninformative prior; it tends to
// Normal(mean, sd/sqrt(n)) as n grows and is wider for small n), truncated
// to > 0. The SAMPLE MEAN is used, not the median: the decision is about
// expected cost. Cost is a TOKEN PROXY: input + output + reasoning tokens as
// the ledger recorded them (cache reads are already inside input_tokens and
// are not added again). It is NOT subscription quota: quota per token can
// differ by model and is not observable here, so no calibration is claimed.
// The cheaper model is assumed to spend at most the frontier's quota per
// token (w <= 1, the provider tier order), so in quota the rule is
// w*mu_C + p*mu_R > mu_R and tokens OVERSTATE the cheaper attempt. The token
// proxy may therefore only decide where the excess comes from escalations:
// at least one observed escalation, a cheaper mean token cost below the
// reference's, and P_more counting only posterior draws with mu_C < mu_R.

// Ledger attempt states of a cheaper tier attempt: adopted (no escalation) or
// failed with a failure signal (escalated or held). Anything else (interrupted,
// cancelled, effects uncertain, never dispatched) is no evidence either way.
const COST_GATE_CHEAP_STATES = new Set(['completed', 'ladder_verifier_failed', 'ladder_not_returned']);
// A reference attempt that ended on its own: delivered ('completed') or
// returned nothing deliverable ('held'). A reference that FAILED after
// dispatch with no side effects reported is recorded 'effects_uncertain'
// (never replayed) with dispatched_failure 'no_effects', and counts too
// (costGateReferenceRun): its tokens were spent in either arm. A cancelled,
// stopped, interrupted or never-dispatched run is no sample (cut short or
// never run, like the same outcome of a cheaper attempt).
const COST_GATE_REFERENCE_STATES = new Set(['completed', 'held']);
const COST_GATE_MEMO_LIMIT = 256;
const costGateMemo = new Map();

/** The token proxy of one recorded attempt, or null when its usage is missing
 * (input and output tokens are both required; reasoning tokens, not reported
 * by every executor, count as 0 when absent). */
function tokenCost(usage) {
  if (!plain(usage) || !int(usage.input_tokens, 0, Number.MAX_SAFE_INTEGER) ||
      !int(usage.output_tokens, 0, Number.MAX_SAFE_INTEGER) ||
      !(usage.reasoning_tokens == null || int(usage.reasoning_tokens, 0, Number.MAX_SAFE_INTEGER))) return null;
  const cost = usage.input_tokens + usage.output_tokens + (usage.reasoning_tokens ?? 0);
  return Number.isSafeInteger(cost) ? cost : null;
}
/** The route kind a ledger record counts as for the cost gate: its own
 * route_kind, or, on a named-route test (route_kind 'explicit_route'), the
 * host route kind the graded route ran as (host_route_kind; an older
 * explicit record without it is no evidence). */
function costGateRouteKind(record) {
  return record.route_kind === 'explicit_route' ? record.host_route_kind ?? null : record.route_kind;
}
/** The compact evidence the cost gate reads from one ledger record: only a
 * host tier or reference attempt (a graded named route included), else null. */
export function costGateRecord(record) {
  if (!plain(record) || record.schema !== 1 || typeof record.family !== 'string' ||
      typeof record.quota_pool !== 'string' || typeof record.model !== 'string' ||
      typeof record.effort !== 'string' || typeof record.attempt_state !== 'string') return null;
  const kind = costGateRouteKind(record);
  if (!['tier', 'reference'].includes(kind)) return null;
  return {family: record.family, scope: record.scope ?? null, surface_kind: record.surface_kind ?? null,
    quota_pool: record.quota_pool, model: record.model, effort: record.effort, route_kind: kind,
    escalated: record.escalated === true, attempt_state: record.attempt_state,
    dispatched_failure: record.dispatched_failure === 'no_effects' ? 'no_effects' : null,
    cost: tokenCost(record.usage)};
}
/** Whether an attempt with these ledger route facts (fixed at dispatch)
 * becomes cost-gate evidence once it is recorded. */
function costGateRoute(route) {
  return plain(route) && ['tier', 'reference'].includes(costGateRouteKind(route));
}
/** Whether a compact reference record is a run that ended on its own. */
function costGateReferenceRun(record) {
  return COST_GATE_REFERENCE_STATES.has(record.attempt_state) ||
    (record.attempt_state === 'effects_uncertain' && record.dispatched_failure === 'no_effects');
}
/** Count, mean and sample standard deviation (n - 1), Welford's method. */
export function costSummary(costs) {
  let n = 0, mean = 0, squares = 0;
  for (const cost of costs) {
    n++;
    const delta = cost - mean;
    mean += delta / n;
    squares += delta * (cost - mean);
  }
  return {n, mean: n ? mean : 0, sd: n > 1 ? Math.sqrt(Math.max(0, squares / (n - 1))) : 0};
}
/** The gate's evidence for one cheaper route against one reference route,
 * from compact ledger records (costGateRecord). Pure.
 * Cheaper attempts: the same family, pool, model and effort, a 'tier' route
 * that was not itself an escalation; every settled one is an escalation trial
 * (failed with a signal = 1, adopted = 0), and the ones with usage are its
 * cost samples. Reference attempts: the reference's pool, model and effort on
 * a 'reference' route (bound directly or escalated to), that ended on its own
 * (costGateReferenceRun: delivered, held, or failed after dispatch with no
 * effects), with usage; first in the node's family, else (fewer than
 * COST_GATE_MIN_SAMPLES there) in the same pool at any class with the same
 * scope and surface kind. */
export function tierCostEvidence(records, query) {
  assert(Array.isArray(records) && plain(query), 'cost_gate_query_invalid');
  let trials = 0, escalations = 0;
  const cheapCosts = [], familyCosts = [], poolCosts = [];
  for (const record of records) {
    if (!plain(record)) continue;
    if (record.route_kind === 'tier' && !record.escalated && record.family === query.family &&
        record.quota_pool === query.cheap_pool && record.model === query.cheap_model &&
        record.effort === query.cheap_effort && COST_GATE_CHEAP_STATES.has(record.attempt_state)) {
      trials++;
      if (record.attempt_state !== 'completed') escalations++;
      if (record.cost !== null) cheapCosts.push(record.cost);
    } else if (record.route_kind === 'reference' && record.quota_pool === query.reference_pool &&
        record.model === query.reference_model && record.effort === query.reference_effort &&
        costGateReferenceRun(record) && record.cost !== null &&
        record.scope === query.scope && record.surface_kind === query.reference_surface_kind) {
      poolCosts.push(record.cost);
      if (record.family === query.reference_family) familyCosts.push(record.cost);
    }
  }
  const family = familyCosts.length >= COST_GATE_MIN_SAMPLES;
  return {cheap: {trials, escalations, cost: costSummary(cheapCosts)},
    reference: {level: family ? 'family' : 'pool', cost: costSummary(family ? familyCosts : poolCosts)}};
}

/** A deterministic uniform generator on (0, 1): xoshiro128** seeded with the
 * first 128 bits of a hex digest (an all-zero state is replaced). */
export function costGateRandom(seedHex) {
  assert(typeof seedHex === 'string' && /^[0-9a-f]{32,}$/.test(seedHex), 'cost_gate_seed_invalid');
  const s = new Uint32Array([0, 1, 2, 3].map(i => parseInt(seedHex.slice(i * 8, i * 8 + 8), 16)));
  if (s.every(word => word === 0)) s[0] = 1;
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  return () => {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (s[1] << 9) >>> 0;
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 11);
    return (result + 0.5) / 4_294_967_296;
  };
}
/** A standard normal draw (Box-Muller, one draw per two uniforms). */
function sampleNormal(random) {
  return Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
}
/** A Gamma(shape, 1) draw: Marsaglia and Tsang (2000) for shape >= 1; for
 * shape < 1, Gamma(shape + 1) * U^(1/shape). */
export function sampleGamma(random, shape) {
  assert(typeof shape === 'number' && Number.isFinite(shape) && shape > 0, 'cost_gate_gamma_shape_invalid');
  if (shape < 1) return sampleGamma(random, shape + 1) * random() ** (1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = sampleNormal(random); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
/** A Beta(a, b) draw: X / (X + Y) with X ~ Gamma(a), Y ~ Gamma(b). */
export function sampleBeta(random, a, b) {
  const x = sampleGamma(random, a), y = sampleGamma(random, b);
  return x / (x + y);
}
/** A Student-t(df) draw: Z / sqrt(V / df) with V ~ chi-square(df) = 2 Gamma(df/2). */
function sampleStudentT(random, df) {
  return sampleNormal(random) / Math.sqrt(2 * sampleGamma(random, df / 2) / df);
}
/** The posterior of one mean cost: Student-t(n - 1) located at the sample
 * mean with scale sd/sqrt(n), truncated to > 0 by rejection (the location is
 * > 0, so each try succeeds with probability > 1/2); the sample mean after 64
 * rejected tries. A zero spread is the sample mean itself. */
function sampleMeanCost(random, {n, mean, sd}) {
  const scale = sd / Math.sqrt(n);
  if (scale === 0) return mean;
  for (let tries = 0; tries < 64; tries++) {
    const value = mean + scale * sampleStudentT(random, n - 1);
    if (value > 0) return value;
  }
  return mean;
}
function validCostSummary(value) {
  return keys(value, ['n', 'mean', 'sd']) && int(value.n, 0, Number.MAX_SAFE_INTEGER) &&
    Number.isFinite(value.mean) && value.mean >= 0 && Number.isFinite(value.sd) && value.sd >= 0;
}
function validCostEvidence(value) {
  return plain(value) && plain(value.cheap) && plain(value.reference) &&
    int(value.cheap.trials, 0, Number.MAX_SAFE_INTEGER) &&
    int(value.cheap.escalations, 0, value.cheap.trials) && validCostSummary(value.cheap.cost) &&
    value.cheap.cost.n <= value.cheap.trials && ['family', 'pool'].includes(value.reference.level) &&
    validCostSummary(value.reference.cost);
}
const round3 = value => Math.round(value * 1000) / 1000;
/** The cost ratio mu_C/mu_R for display (3 decimals), rounded towards the
 * side the rule reads: below 1 exactly when the cheaper mean is below the
 * reference mean (the 1e-9 only absorbs floating-point noise in the means). */
function displayRatio(cheapMean, referenceMean) {
  const scaled = 1000 * cheapMean / referenceMean;
  return (cheapMean < referenceMean ? Math.min(999, Math.floor(scaled + 1e-9)) :
    Math.max(1000, Math.ceil(scaled - 1e-9))) / 1000;
}
function validExploreKey(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
/** One task node's exploration draw: a deterministic integer in [0, draws)
 * from a SHA-256 of its key (the resolver's key is task id and node id), so
 * one node decides the same way at bind, re-resolution and pool spread, and
 * keys spread uniformly (to the generator's 2^-32 granularity). */
export function costGateExploreDraw(exploreKey, draws = COST_GATE_DRAWS) {
  assert(validExploreKey(exploreKey) && int(draws, 1, 1_000_000), 'cost_gate_explore_key_invalid');
  const random = costGateRandom(sha(Buffer.from('os1-rcc-cost-gate-explore-v1\n' + exploreKey)));
  return Math.min(draws - 1, Math.floor(random() * draws));
}
/** How many of `draws` posterior draws have the tier costing more because
 * of its escalations: mu_C < mu_R and mu_C + p*mu_R > mu_R. Seeded from the
 * exact evidence and the draw count ONLY (never a confidence or a task):
 * the same evidence has one P_more. Memoized per seed. */
function costGateMoreDraws(cheap, reference, draws) {
  const seed = sha(Buffer.from('os1-rcc-cost-gate-v2\n' + stable({draws, cheap, reference})));
  const memo = costGateMemo.get(seed);
  if (memo !== undefined) return memo;
  const random = costGateRandom(seed);
  const a = 1 + cheap.escalations, b = 1 + cheap.trials - cheap.escalations;
  let more = 0;
  for (let draw = 0; draw < draws; draw++) {
    const p = sampleBeta(random, a, b);
    const muC = sampleMeanCost(random, cheap.cost), muR = sampleMeanCost(random, reference.cost);
    if (muC < muR && muC + p * muR > muR) more++;
  }
  if (costGateMemo.size >= COST_GATE_MEMO_LIMIT) costGateMemo.delete(costGateMemo.keys().next().value);
  costGateMemo.set(seed, more);
  return more;
}
/** A gate result with nothing decided yet (every field null, route tier). */
function costGateBase() {
  return {route: 'tier', reason: null, p_mean: null, cost_ratio: null, p_more: null, confidence: null, draws: null,
    explore: null, trials: null, escalations: null, cheap_n: null, reference_n: null, reference_level: null};
}

/** Whether a guarded read-only tier route should run its cheaper route or go
 * straight to its reference, from tierCostEvidence. Pure and deterministic.
 * P_more = Pr[mu_C < mu_R and mu_C + p*mu_R > mu_R] (costGateMoreDraws) is
 * `p_more`, the exact fraction more/draws the decision compares (never
 * rounded), so a higher confidence can only keep more nodes on the tier and
 * a retuned confidence never changes a recorded P_more. With `exploreKey`
 * (the resolver passes task id and node id) a confident gate still keeps the
 * tier when that key's exploration draw (costGateExploreDraw, recorded as
 * `explore` = draw/draws) is >= more: the tier then runs with probability
 * 1 - P_more (posterior probability matching), so its evidence keeps growing
 * and an early failure streak cannot lock the family to the reference.
 * Returns {route: 'tier'|'reference', reason, p_mean, cost_ratio, p_more,
 * confidence, draws, explore, trials, escalations, cheap_n, reference_n,
 * reference_level}:
 *  - cost_gate_unavailable (tier): no readable evidence;
 *  - cost_gate_insufficient (tier): fewer than COST_GATE_MIN_SAMPLES cost
 *    samples in either arm, or a zero mean cost;
 *  - cost_gate_no_escalation (tier): no cheaper attempt has escalated, so
 *    nothing observed makes the tier cost more except the cheaper attempt's
 *    own token count, which overstates its quota;
 *  - cost_gate_unidentified (tier): the cheaper mean token cost is not below
 *    the reference's: tokens cannot rank the arms without a quota weight;
 *  - cost_gate_reference: P_more >= confidence (and, with a key, explore <
 *    P_more);
 *  - cost_gate_explore (tier): P_more >= confidence, explore >= P_more;
 *  - cost_gate_tier otherwise. */
export function tierCostGate(evidence, {confidence = COST_GATE_CONFIDENCE, draws = COST_GATE_DRAWS,
                                       exploreKey = null} = {}) {
  assert(typeof confidence === 'number' && confidence > 0 && confidence <= 1 && int(draws, 1, 1_000_000) &&
    (exploreKey === null || validExploreKey(exploreKey)), 'cost_gate_options_invalid');
  const base = costGateBase();
  if (!validCostEvidence(evidence)) return {...base, reason: 'cost_gate_unavailable'};
  const {cheap, reference} = evidence;
  const counts = {trials: cheap.trials, escalations: cheap.escalations, cheap_n: cheap.cost.n,
    reference_n: reference.cost.n, reference_level: reference.level};
  if (cheap.cost.n < COST_GATE_MIN_SAMPLES || reference.cost.n < COST_GATE_MIN_SAMPLES ||
      !(cheap.cost.mean > 0) || !(reference.cost.mean > 0))
    return {...base, ...counts, reason: 'cost_gate_insufficient'};
  const a = 1 + cheap.escalations, b = 1 + cheap.trials - cheap.escalations;
  const described = {...base, ...counts, p_mean: round3(a / (a + b)),
    cost_ratio: displayRatio(cheap.cost.mean, reference.cost.mean)};
  if (cheap.escalations === 0) return {...described, reason: 'cost_gate_no_escalation'};
  if (!(cheap.cost.mean < reference.cost.mean)) return {...described, reason: 'cost_gate_unidentified'};
  const more = costGateMoreDraws(cheap, reference, draws);
  const decided = {...described, p_more: more / draws, confidence, draws};
  if (!(more / draws >= confidence)) return {...decided, reason: 'cost_gate_tier'};
  if (exploreKey === null) return {...decided, route: 'reference', reason: 'cost_gate_reference'};
  const draw = costGateExploreDraw(exploreKey, draws);
  return draw < more ? {...decided, route: 'reference', reason: 'cost_gate_reference', explore: draw / draws} :
    {...decided, reason: 'cost_gate_explore', explore: draw / draws};
}
/** The auditable routing-reason token of one gate result. p_more and explore
 * are the exact fractions the rule compared (reference iff p_more >= conf
 * and, when explore is present, explore < p_more). */
function costGateToken(gate) {
  if (gate.reason === 'cost_gate_unavailable' || gate.reason === 'cost_gate_no_reference') return gate.reason;
  const counts = `trials=${gate.trials}:escalations=${gate.escalations}:cheap_n=${gate.cheap_n}:` +
    `ref_n=${gate.reference_n}:ref_${gate.reference_level}`;
  if (gate.reason === 'cost_gate_insufficient') return `${gate.reason}:${counts}`;
  const described = `${gate.reason}:p_mean=${gate.p_mean}:cost_ratio=${gate.cost_ratio}`;
  if (gate.p_more === null) return `${described}:${counts}`;
  return `${described}:p_more=${gate.p_more}:conf=${gate.confidence}` +
    (gate.explore === null ? '' : `:explore=${gate.explore}`) + `:${counts}`;
}
/** The compact gate result a routing-ledger record keeps (optional field;
 * confidence, draws and explore are optional inside it as well). */
function costGateLedger(gate) {
  return gate ? {reason: gate.reason, p_mean: gate.p_mean, cost_ratio: gate.cost_ratio, p_more: gate.p_more,
    confidence: gate.confidence ?? null, draws: gate.draws ?? null, explore: gate.explore ?? null} : null;
}

/** An explicit route that names the local surface (route-all, 2026-10-14)
 * binds the one dispatchable local model row: the model OpenClaw already runs,
 * read-only and tools-free, with no quota pool. No tier list, cost gate or
 * REVAS escalation applies: the owner named this surface and nothing else
 * stands in for it (a re-resolution that must avoid the row holds). */
function localRouteCandidate(node, routeClass, task, catalog, now, {avoidIDs = []} = {}) {
  assert(node.kind === 'agent' && node.scope === 'read_only' && (node.owned_paths ?? []).length === 0,
    'explicit_local_route_scope_invalid');
  const rows = catalog.candidates.filter(c => hostRoutable(c) && localWorkerRow(c) && !avoidIDs.includes(c.id));
  const chosen = rows.find(c => dispatchable(c, task, now));
  if (!chosen)
    throw new RCCRuntimeError('no_dispatchable_candidate:read_only:local_' + (rows.length ? 'undispatchable' : 'unavailable'));
  return {candidate: chosen, why: ['route_explicit', 'explicit_route_surface_local', 'class_' + routeClass,
    'local_model'].join(';'), widened: false, kind: 'explicit', tier: null, referenceEffort: chosen.effort,
    ladder: null, costGate: null};
}

/** Pick the exact row for one node on a tier-routed catalog.
 * In each pool the class's entries are tried in order and the first entry
 * with a dispatchable row is that pool's offer (a read-only node takes the
 * gated chat row of the same model and effort first). A pool that cannot
 * offer any entry of the class is skipped. Among the pools that can, the
 * pool is chosen by the quota of the row it would actually bind (catalog
 * quota_scores: the builder's capacity share x remaining / hours to reset of
 * THAT model; unknown last), never by another model's quota; an avoided pool
 * goes last and a preferred pool first; equal or unknown scores keep the
 * catalog's pool order (an older catalog without scores keeps it wholly).
 * When no pool can serve the class, it falls back upwards (trivial runs
 * standard, recorded as class_fallback_trivial_to_standard); deep is never
 * relaxed. `referenceOnly` routes as deep: the reference only (a REVAS
 * escalation and its re-resolution).
 *
 * The route is 'reference' when the bound row is its pool's reference (the
 * frontier at its highest effort up to max), 'explicit' when the owner's own
 * words fix the route (an effort word AND a model family, or a bound row that
 * is the reference those words leave: intentReferenceRows), and 'tier'
 * otherwise. A read-only agent node on a 'tier' route carries `ladder`, its
 * one escalation guard: this pool's (owner-constrained) reference, else
 * another pool's; when no pool offers one the guard has no target
 * (reference_candidate_id null) and a failure signal holds the node
 * (ladder_reference_unavailable) instead of adopting the cheaper answer.
 *
 * An explicit route test binds each graded node on its own named surface
 * only, with that route's own words (explicitRouteOf): never another surface
 * or pool, for the cheaper route or for its escalation.
 *
 * With `costEvidence(query)` (the runtime's routing-ledger reader; tests may
 * pass their own) a guarded read-only tier route with NO owner effort or
 * family word runs the cost gate (tierCostGate) against the escalation target
 * it would use; when that target can dispatch now and the gate is confident
 * the tier costs more (and this task node's exploration draw does not keep
 * the tier), the node binds that reference directly (route
 * 'reference', no guard). A write, an owner-constrained route and a route
 * already at its reference never consult the gate. Without `costEvidence`
 * (pure callers) nothing changes. `costGate` in the result is the gate's
 * decision, null when it did not apply. */
function tierRouteCandidate(node, routeClass, task, catalog, now,
                            {avoidPool = null, avoidIDs = [], widenWrites = false, referenceOnly = false,
                             preferPool = null, classNote = null, costEvidence = null} = {}) {
  const explicitRoute = explicitRouteOf(node, task, catalog);
  if (explicitRoute?.surface === 'local')
    return localRouteCandidate(node, effectiveRouteClass(routeClass, node.scope), task, catalog, now, {avoidIDs});
  const intent = explicitRoute ? explicitRoute.intent : routingIntent(catalog);
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
  const pools = poolRows(node, catalog, {widenWrites, surface: explicitRoute?.surface ?? null})
    .sort((a, b) => (avoided(a) - avoided(b)) || (preferred(a) - preferred(b)) ||
      (ordinal.get(a.pool) - ordinal.get(b.pool)));
  const deepGuard = routeClassUsed === 'deep' && !intent?.model_family;
  // One pass of the pools at one class: every pool's offer (its first entry
  // with a dispatchable row), then the pool whose offered row has the most
  // quota for its own model.
  const serve = classUsed => {
    const entries = tierEntries(classUsed, intent);
    const skipped = [], offers = [];
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
      if (hit) { offers.push({hit, entry, pool, rank, score: quotaScore(catalog, hit.candidate.model)}); continue; }
      skipped.push(`skipped_${rank}_` + (deepGuard ? poolOffered ? 'reference_undispatchable' : 'reference_unavailable' :
        `${classUsed}_${poolOffered ? 'undispatchable' : 'unavailable'}`));
    }
    if (!offers.length) return {hit: null, offered};
    // Stable: equal or unknown scores keep the order above.
    const scored = offers.map((offer, position) => ({offer, position})).sort((a, b) =>
      (avoided(a.offer.pool) - avoided(b.offer.pool)) || (preferred(a.offer.pool) - preferred(b.offer.pool)) ||
      ((a.offer.score === null) - (b.offer.score === null)) ||
      (a.offer.score !== null && b.offer.score !== null ? b.offer.score - a.offer.score : 0) ||
      (a.position - b.position));
    const chosen = scored[0].offer;
    const passed = scored.slice(1).filter(({position}) => position < scored[0].position)
      .map(({offer}) => `outscored_${offer.rank}`);
    return {...chosen, skipped: [...skipped, ...passed], offered};
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
  // Without an owner constraint this is the frontier reference; with one it
  // is the reference the owner's own words leave.
  const reference = intentReferenceRows(pool.rows, catalog, intent);
  const atReference = reference.some(row => row.candidate.id === chosen.id);
  const ownerFixed = Boolean(intent?.model_family && intent?.effort);
  const kind = intent && (ownerFixed || atReference) ? 'explicit' : atReference ? 'reference' : 'tier';
  let ladder = null, costGate = null, gated = null;
  if (kind === 'tier' && node.scope === 'read_only' && node.kind === 'agent') {
    // The one REVAS escalation target, fixed now and admitted with the
    // plan: this pool's reference when it can run, else another pool's (an
    // explicit route has only its own surface's pool).
    const targets = [pool, ...pools.filter(other => other !== pool)
      .sort((a, b) => ordinal.get(a.pool) - ordinal.get(b.pool))]
      .map(other => intentReferenceRows(other.rows, catalog, intent));
    const runnable = targets.map(rows => best(rows)).find(Boolean) ?? null;
    const target = runnable ?? targets.map(rows => [...rows].sort(order)[0]).find(Boolean);
    // No reference in any pool: the guard still applies, with no target, so
    // a failure signal holds the node instead of adopting the cheaper answer
    // (the escalation re-resolves a reference at that time).
    ladder = {source: 'tier', cheap_model: chosen.model, cheap_effort: chosen.effort,
      reference_model: target?.candidate.model ?? null, reference_effort: target?.candidate.effort ?? null,
      reference_candidate_id: target?.candidate.id ?? null};
    // The cost gate compares this cheaper route with the escalation target
    // it would actually use. Never under an owner effort or family word.
    if (typeof costEvidence === 'function' && !intent?.effort && !intent?.model_family) {
      if (!runnable) {
        costGate = {...costGateBase(), reason: 'cost_gate_no_reference'};
      } else {
        const ref = runnable.candidate;
        let evidence = null;
        try {
          evidence = costEvidence({family: routeFamily(routeClass, node.scope, chosen.surface), scope: node.scope,
            cheap_pool: chosen.quota_pool, cheap_model: chosen.model, cheap_effort: chosen.effort,
            reference_family: routeFamily(routeClass, node.scope, ref.surface),
            reference_surface_kind: surfaceKind(ref.surface), reference_pool: ref.quota_pool,
            reference_model: ref.model, reference_effort: ref.effort});
        } catch { evidence = null; }
        // The exploration key: this task's node, so it decides the same way
        // at bind, re-resolution and pool spread.
        costGate = tierCostGate(evidence,
          {exploreKey: typeof task?.task_id === 'string' ? `${task.task_id}\n${node.id}` : null});
        if (costGate.route === 'reference') gated = runnable;
      }
    }
  }
  if (gated) {
    // The gate is confident the cheaper route plus its escalation spends more
    // than the reference: bind that reference now (nothing to escalate).
    const ref = gated.candidate;
    const why = ['route_reference'];
    if (explicitRoute) why.push('explicit_route_surface_' + explicitRoute.surface.replace(/[^a-z0-9]/g, '_'));
    why.push('class_' + routeClassUsed);
    if (classNote) why.push(classNote);
    if (fallbackNote) why.push(fallbackNote);
    why.push(costGateToken(costGate), ('cost_gate_cheap_' + chosen.model + '_' + chosen.effort).replace(/[^A-Za-z0-9_]/g, '_'),
      'tier_' + (tierOf(catalog, ref.model) ?? 'none'), 'pool_rank_' + ordinal.get(ref.quota_pool), 'effort_' + ref.effort,
      ref.quota_pool === pool.pool ? 'cost_gate_same_pool' : 'cost_gate_other_pool',
      {chat: 'chat_lane_same_route', local: 'local_exact'}[surfaceKind(ref.surface)] ?? 'agent_surface');
    if (avoidPool !== null) why.unshift(ref.quota_pool === avoidPool ? 'same_pool_only' : 'other_pool');
    return {candidate: ref, why: why.join(';'), widened: false, kind: 'reference', tier: tierOf(catalog, ref.model),
      referenceEffort: ref.effort, ladder: null, costGate};
  }
  const why = ['route_' + kind];
  if (explicitRoute) why.push('explicit_route_surface_' + explicitRoute.surface.replace(/[^a-z0-9]/g, '_'));
  if (intent?.effort) why.push('intent_effort_' + intent.effort);
  if (intent?.model_family) why.push('intent_family_' + intent.model_family);
  why.push('class_' + routeClassUsed);
  if (classNote) why.push(classNote);
  if (fallbackNote) why.push(fallbackNote);
  why.push('tier_list_' + entry.index, 'tier_' + (tier ?? 'none'), rank, ...skipped, 'effort_' + chosen.effort);
  if (quotaScore(catalog, chosen.model) !== null) why.push('pool_scored_by_bound_model');
  if (ladder) why.push('escalation_reference_' + (ladder.reference_candidate_id === null ? 'unavailable' :
    catalog.candidates.find(c => c.id === ladder.reference_candidate_id)?.quota_pool === pool.pool ?
      'same_pool' : 'other_pool'));
  if (costGate) why.push(costGateToken(costGate));
  why.push({chat: 'chat_lane_same_route', local: 'local_exact'}[surfaceKind(chosen.surface)] ?? 'agent_surface');
  if (avoidPool !== null) why.unshift(pool.pool === avoidPool ? 'same_pool_only' : 'other_pool');
  const widened = node.scope === 'workspace_write' && !coversOwnedPaths(chosen, node.owned_paths);
  if (widened) why.push('owned_paths_workspace');
  return {candidate: chosen, why: why.join(';'), widened, kind, tier,
    referenceEffort: reference[0]?.candidate.effort ?? null, ladder, costGate};
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
      c.scope === 'read_only' && localExactRow(c))};
}

/** Null when something in an allowed scope can run; otherwise the visible
 * hold reason with, per pool, the failure of the rows that could be bound in
 * scope (tier routing: bindableRows; reference routing: reference rows). */
function noDispatchableReason(task, catalog, now) {
  const scopes = scopesAllowed(task);
  // Only a host-computed exact row means "something can run": the local model
  // row is an explicit route's surface, never a reason to plan Auto work.
  const local = catalog.candidates.filter(c => hostRoutable(c) && scopes.includes(c.scope) && localExactRow(c));
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
        if (!rows.length) note(entry.pool, entry.rows.some(row => tierRoutable(row.candidate, catalog, intent)) ?
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
 * An explicit route test on an older catalog (no model_tiers) is never
 * resolved here: its planner chose exact rows. On a tier-routed catalog its
 * planner only grades each named route (node id requested-N, the route's
 * exact payload, no dependencies) and the host binds model and effort on
 * that route's own surface, like any graded node: same tier lists, same REVAS
 * guard, never another surface. Pure: same input, same output.
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
 * model, effort); production registers none. `costEvidence(query)` (the
 * routing-ledger reader, tierCostEvidence) lets a guarded read-only tier route
 * consult the cost gate (tierRouteCandidate); without it nothing changes, and
 * with it the result is as deterministic as the evidence it returns. A route
 * the gate decided carries `cost_gate` ({reason, p_mean, cost_ratio, p_more,
 * confidence, draws, explore}). */
export function resolveRoutePlan(plan, task, catalog, now = Date.now(),
                                 {verifierRegistry = null, ledgerStats = null, costEvidence = null} = {}) {
  if ((task.mode === 'explicit_routing_test' && !explicitTierRouting(task, catalog)) ||
      !plain(plan) || !Array.isArray(plan.nodes))
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
      const choice = selectRouteCandidate(node, routeClass, task, catalog, now,
        {widenWrites: true, ladder, classNote, costEvidence});
      decisions[node.id] = routingDecision(routeClass, choice.candidate, 'resolver;' + choice.why, choice.ladder,
        choice.tier);
      routes[node.id] = {kind: choice.kind, reference_effort: choice.referenceEffort, ladder: choice.ladder,
        ...(choice.costGate ? {cost_gate: costGateLedger(choice.costGate)} : {})};
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
  // Explicit routes stay independent (one node per named route, no
  // dependencies): overlapping explicit writers are refused by validatePlan.
  if (task.mode !== 'explicit_routing_test')
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
  // Parsed cost-gate records per generation, reused while the file's
  // identity (device, inode, size, modification and change time) is unchanged.
  const costCache = new Map();
  function costGenerationRecords(path) {
    let fd;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) { if (error.code === 'ENOENT') { costCache.delete(path); return []; } throw error; }
    try {
      const st = privateFile(fd);
      assert((st.mode & 0o077) === 0 && st.size <= maxBytes, 'routing_ledger_file_invalid');
      const identity = `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
      const cached = costCache.get(path);
      if (cached?.identity === identity) return cached.records;
      const records = [];
      for (const line of readFileSync(fd, 'utf8').split('\n')) {
        if (!line) continue;
        let record = null;
        try { record = JSON.parse(line); } catch { continue; }
        const compact = costGateRecord(record);
        if (compact) records.push(compact);
      }
      costCache.set(path, {identity, records});
      return records;
    } finally { closeSync(fd); }
  }
  /** The compact tier/reference records the cost gate reads (costGateRecord),
   * oldest first, from both retained generations. Unlike `stats`, a torn or
   * foreign line is skipped: it is one missing cost sample, never evidence
   * that a route is clean. A file that cannot be read safely (not private, a
   * link, oversize, unreadable) throws: the caller reads no evidence. */
  const costRecords = () => {
    try { privateDirectory(false); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return [...costGenerationRecords(rotated), ...costGenerationRecords(current)];
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
    append, stats, costRecords, attemptIDs});
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
/** Optional: an explicit route test's own effort/model words per route,
 * aligned with the ORIGINAL host explicit_routes (null where a route has
 * none). Never present outside an explicit route test. */
function validExplicitRouteIntents(intents, task) {
  const routes = task.host_context?.explicit_routes;
  return task.mode === 'explicit_routing_test' && Array.isArray(routes) && Array.isArray(intents) &&
    intents.length === routes.length && intents.every(intent => intent === null || validRoutingIntent(intent));
}
/** Optional (build 378): per offered model, the builder's pool score for that
 * model (capacity share x its own remaining quota / hours to its own reset),
 * in integer parts per billion. A model with unknown quota has no entry. */
function validQuotaScores(scores, candidates) {
  if (!plain(scores)) return false;
  const models = new Set(candidates.map(c => c?.model));
  const entries = Object.entries(scores);
  return entries.length <= 256 && entries.every(([model, score]) => boundedText(model, 256) && models.has(model) &&
    int(score, 0, 1_000_000_000));
}
function validateCatalog(catalog, task) {
  const required = ['schema', 'task_id', 'request_sha256', 'candidates'];
  const optional = ['exclusions', 'routing_intent', 'model_tiers', 'explicit_route_intents', 'quota_scores'];
  assert(plain(catalog) && required.every(key => Object.hasOwn(catalog, key)) &&
    Object.keys(catalog).every(key => required.includes(key) || optional.includes(key)) &&
    catalog.schema === 1 && catalog.task_id === task.task_id &&
    catalog.request_sha256 === task.request_sha256 && Array.isArray(catalog.candidates) &&
    catalog.candidates.length <= 256 &&
    (catalog.exclusions === undefined || validExclusions(catalog.exclusions)) &&
    (catalog.routing_intent === undefined || validRoutingIntent(catalog.routing_intent)) &&
    (catalog.model_tiers === undefined || validModelTiers(catalog.model_tiers, catalog.candidates)) &&
    (catalog.explicit_route_intents === undefined || validExplicitRouteIntents(catalog.explicit_route_intents, task)) &&
    (catalog.quota_scores === undefined || validQuotaScores(catalog.quota_scores, catalog.candidates)) &&
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
    // The local model executes only an explicit route that names the local
    // surface; Auto never routes ordinary work to it (route-all, 2026-10-14).
    if (node.kind === 'agent' && c.surface === 'local')
      assert(task.mode === 'explicit_routing_test' && localWorkerRow(c) && node.scope === 'read_only' &&
        node.dependencies.length === 0, 'local_agent_node_not_explicit');
    if (node.kind === 'deterministic')
      assert(task.mode !== 'explicit_routing_test' && localExactRow(c) && node.scope === 'read_only' &&
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
/** A child whose latest attempt SETTLED read-only with no side effects AND
 * whose native turn the adapter attested ENDED (native_turn_terminated: OS-1
 * closed the provider process it owned, or Codex Desktop reported a terminal
 * status for the turn; Core then recorded 'settled_side_effects'). Its
 * effects_uncertain state (a failure after dispatch, a cancel) is about
 * remote billing, never a running turn or a workspace effect. A returned
 * record alone never qualifies: a Codex Desktop turn may still run after its
 * adapter returned (an observation that failed, a best-effort interrupt). An
 * attempt with no returned record (an executor that threw, a restart while
 * dispatched) never qualifies either. `legacyBefore` (an owner start only): a
 * record from an adapter older than that attestation (neither true nor false
 * recorded; build 378's 'dispatched_failure' no_effects fact) qualifies once
 * it returned before that time, longer ago than its task's whole duration
 * budget (legacySettleCutoff). */
function settledReadOnly(child, legacyBefore = null) {
  const last = child?.attempt_history?.at(-1);
  if (child?.selected_config?.scope !== 'read_only' || !plain(last)) return false;
  if (last.native_turn_terminated === true && last.settled_side_effects === 'none') return true;
  return legacyBefore !== null && last.dispatched_failure === 'no_effects' &&
    !Object.hasOwn(last, 'native_turn_terminated') && int(child.finished_at_ms, 0, legacyBefore);
}
/** An owner start's cutoff for a pre-attestation record (settledReadOnly):
 * its task's whole duration budget ago. */
function legacySettleCutoff(snapshot) {
  return Date.now() - snapshot.task.budget.max_duration_ms;
}
/** What a returned record attests about its native turn, on its attempt
 * entry: settled_side_effects only when the adapter attested the turn ended
 * (settledReadOnly); a record without the attestation records nothing. */
function recordTurnSettlement(entry, result) {
  if (typeof result.native_turn_terminated !== 'boolean') return;
  entry.native_turn_terminated = result.native_turn_terminated;
  if (result.native_turn_terminated) entry.settled_side_effects = result.side_effects;
}
/** The quota-pool lease key of an exact configuration, or null. */
function poolKeyOf(config) {
  return !plain(config) || config.quota_pool === 'none' ? null : `${config.quota_pool}:${config.account_id}`;
}
/** Whether this child keeps its pool's lease: an attempt still running, or an
 * effects-uncertain one not settledReadOnly (a write, an outcome with no
 * returned record, or a turn not attested ended). A settled read-only attempt
 * holds no pool (shared pool peak 1 counts running turns, not remote billing
 * doubt). */
function leaseProtectingChild(child, legacyBefore = null) {
  return plain(child?.selected_config) && (child.state === 'running' ||
    (child.state === 'effects_uncertain' && !settledReadOnly(child, legacyBefore)));
}
/** The pools a snapshot's children still protect (leaseProtectingChild). */
function protectedPools(snapshot, legacyBefore = null) {
  return new Set((snapshot?.children ?? []).filter(child => leaseProtectingChild(child, legacyBefore))
    .map(child => poolKeyOf(child.selected_config)).filter(Boolean));
}
/** A pool held only by settled read-only effects-uncertain children: the
 * reason a released lease names (quota_lease_released_settled_read_only). */
function settledReadOnlyPools(snapshot, legacyBefore = null) {
  return new Set((snapshot?.children ?? []).filter(child => child.state === 'effects_uncertain' &&
    plain(child.selected_config) && settledReadOnly(child, legacyBefore))
    .map(child => poolKeyOf(child.selected_config)).filter(Boolean));
}
/** In a non-explicit task, a plan of exactly ONE agent node with no separate
 * final integration node is the owner's indivisible task: the planner may
 * grade it but never rewrite it, so the host runs the original request (owner
 * text) as its instruction. Explicit route tests keep each route's payload;
 * decompositions keep the planner's instructions; a deterministic node keeps
 * its exact expression; a request over the node instruction bound keeps the
 * planner's text. Pure. */
export function lockIndivisibleInstruction(plan, task) {
  if (task?.mode === 'explicit_routing_test' || !plain(plan) || !Array.isArray(plan.nodes) ||
      plan.nodes.length !== 1) return {plan, changed: false};
  const [node] = plan.nodes;
  if (!plain(node) || node.kind !== 'agent' ||
      !(plan.final_node_id === undefined || plan.final_node_id === null || plan.final_node_id === node.id) ||
      node.instruction === task.request || !boundedText(task.request, 12_000)) return {plan, changed: false};
  return {plan: {...plan, nodes: [{...node, instruction: task.request}]}, changed: true};
}
const INSTRUCTION_LOCK_REASON = 'instruction_host_locked';
/** A routing decision of a child whose instruction the host locked
 * (lockIndivisibleInstruction changed the planner's text at admission) names
 * that lock, also when an escalation, re-resolution, spread or repair
 * rebuilds it; the public reason stays within its 1 KiB contract bound. */
function withInstructionLock(child, decision) {
  if (child?.instruction_host_locked !== true || !plain(decision) || typeof decision.reason !== 'string' ||
      decision.reason.split(';').includes(INSTRUCTION_LOCK_REASON)) return decision;
  const reason = decision.reason + ';' + INSTRUCTION_LOCK_REASON;
  return boundedText(reason, 1_024) ? {...decision, reason} : decision;
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
    // Owner start: a lease whose task is terminal, or whose holding attempt
    // settled read-only, is stale (each release records why); a lease of an
    // attempt that may still run (no returned record) is kept. A lease whose
    // task row does not exist protects nothing.
    for (const row of rows) this._releaseSafeLeases(row.task_id, {reconcile: true});
    this.transaction(() => this.db.prepare(
      'DELETE FROM quota_leases WHERE task_id NOT IN (SELECT task_id FROM tasks)').run());
  }

  /** Restart: record, once, every attempt an earlier owner dispatched but
   * never recorded (it stopped or crashed before the attempt settled, or its
   * live append failed). A verdict already stored on the attempt (pass, fail,
   * not_returned, or a verified not-dispatched rejection) is recorded as it
   * was; only an attempt without one is 'interrupted' when a verifier was
   * relevant. An attempt that did settle after the stop is already in the
   * ledger and is only cleared. A ledger failure is logged; the pending row is
   * cleared, except for a parity failure or cost-gate evidence, which stays
   * pending (and backlogged) so this process and the next restart retry it
   * (a lost failure could readmit a cheaper route; a lost cost sample would
   * let the cost gate decide from partial evidence). */
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
          const record = this._ledgerRecord({taskID: row.task_id, nodeID: row.node_id, attemptID: row.attempt_id,
            route}, {usage: entry?.usage ?? null, execution_verified: current && child.execution_verified === true,
            task_quality: current ? child.task_quality ?? null : null}, outcome, settled ? entry.state : 'interrupted',
            settled ? entry.escalation_outcome ?? null : null, settled ? entry.dispatched_failure ?? null : null);
          const write = () => this.ledger.append(record);
          if (this._backlogged(record)) { keep = true; this.ledgerBacklog.set(row.attempt_id, write); }
          write();
          this.ledgerBacklog.delete(row.attempt_id);
          keep = false;
        }
      } catch (error) { this._logLedger(error); }
      if (!keep)
        this.transaction(() => this.db.prepare('DELETE FROM ledger_pending WHERE attempt_id=?').run(row.attempt_id));
    }
  }

  /** `reconcile`: an owner start, which records why every lease it releases
   * was stale. A routine release records only a settled read-only one. */
  _releaseSafeLeases(taskID, {reconcile = false} = {}) {
    const snapshot = this._load(taskID);
    if (!snapshot) return;
    const activeOrUncertain = snapshot.children.some(c => c.state === 'effects_uncertain' || c.state === 'running');
    if (TERMINAL.has(snapshot.state) && snapshot.state !== 'effects_uncertain' && !activeOrUncertain) {
      this.transaction(() => this.db.prepare('DELETE FROM write_leases WHERE task_id=?').run(taskID));
    }
    // A quota reservation protects only a running native attempt or an
    // uncertain one not settled read-only (a write, no returned record, or a
    // turn the adapter did not attest ended), not the parent verifier's think
    // time. Preserve it across a crash when the native turn might still be
    // consuming that account pool. A settled read-only attempt's turn ended.
    // An owner start also accepts a pre-attestation record (legacySettleCutoff).
    const legacy = reconcile ? legacySettleCutoff(snapshot) : null;
    const kept = protectedPools(snapshot, legacy), settled = settledReadOnlyPools(snapshot, legacy);
    this.transaction(() => {
      const rows = this.db.prepare('SELECT pool_key FROM quota_leases WHERE task_id=?').all(taskID);
      for (const row of rows) if (!kept.has(row.pool_key)) {
        this.db.prepare('DELETE FROM quota_leases WHERE pool_key=? AND task_id=?').run(row.pool_key, taskID);
        const why = settled.has(row.pool_key) ? 'settled_read_only' :
          !reconcile ? null : TERMINAL.has(snapshot.state) ? 'task_terminal' : 'no_running_attempt';
        if (why) this._leaseEvent(snapshot, 'quota_lease_released_' + why);
      }
    });
  }
  /** One durable event naming why a stale quota lease was released. Called
   * inside a transaction; the task snapshot itself is unchanged. */
  _leaseEvent(snapshot, kind) {
    this.db.prepare('INSERT INTO events(task_id,revision,kind,at_ms,payload) VALUES(?,?,?,?,?)')
      .run(snapshot.task.task_id, snapshot.revision, kind, Date.now(), stable(publicSnapshot(snapshot)));
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
          (route.surface !== 'local' || localWorkerRow(candidate)) &&
          candidate.availability === 'available' && candidate.availability_valid_until_ms > now &&
          candidate.quality_state !== 'mismatch' &&
          (candidate.quota_pool === 'none' || (candidate.quota_pool !== 'unknown' &&
            candidate.quota_remaining_fraction > 0 && candidate.quota_valid_until_ms > now))));
      if (unavailable) {
        // Name the host's recorded exclusion reasons for that provider, so a
        // capacity, sign-in or quota exclusion is visible in the hold.
        const provider = unavailable.surface === 'codex' ? 'codex' :
          ['claude', 'claude-chat'].includes(unavailable.surface) ? 'claude' : null;
        // The local surface has no exclusion record: its row is present and
        // observed unavailable (the readiness probe failed), or absent.
        const why = unavailable.surface === 'local' ?
          [catalog.candidates.some(localWorkerRow) ? 'local_model_not_ready' : 'local_model_absent'] :
          [...new Set((catalog.exclusions ?? []).filter(item => item.provider === provider)
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
    let plan, decisions, routes, lockedID = null;
    try {
      // The injected planner adapter selects only task-relevant policy and
      // context for the local model. It receives the immutable host state,
      // never a model-authored replacement for that state. Outside explicit
      // route tests it grades nodes; the host then binds exact rows.
      const proposed = await this.plan({task: immutable(task), catalog: immutable(catalog)});
      const resolved = resolveRoutePlan(proposed, task, catalog, boundAt,
        {verifierRegistry: this.verifierRegistry, ledgerStats: (...key) => this._ladderStats(...key),
         costEvidence: query => this._costEvidence(query)});
      // One indivisible task runs the owner's own words, never a planner
      // paraphrase (lockIndivisibleInstruction); the decision says so.
      const locked = lockIndivisibleInstruction(resolved.plan, task);
      plan = validatePlan(locked.plan, task, catalog);
      decisions = resolved.decisions; routes = resolved.routes;
      lockedID = locked.changed ? plan.nodes[0].id : null;
      if (lockedID !== null && decisions[lockedID])
        decisions[lockedID] = withInstructionLock({instruction_host_locked: true}, decisions[lockedID]);
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
        // The cost gate's decision at bind time (null when it did not apply).
        cost_gate: routes[node.id]?.cost_gate ?? null,
        // The host replaced the planner's text with the owner's request: every
        // later decision of this child keeps naming that (withInstructionLock).
        ...(node.id === lockedID ? {instruction_host_locked: true} : {}),
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
      if (!row || row.task_id === task.task_id) return false;
      const owner = this._load(row.task_id);
      // A stale quota lease (vanished or terminal owner, no attempt of its
      // own protecting the pool) is released by _tryReserve: not a wait.
      if (table === 'quota_leases' && (!owner || (TERMINAL.has(owner.state) && !protectedPools(owner).has(value))))
        return false;
      // An effects-uncertain owner must surface as the existing hold, not wait.
      return owner?.state !== 'effects_uncertain';
    };
    return !foreign('quota_leases', 'pool_key', poolKey) && !foreign('write_leases', 'workspace', workspaceKey);
  }
  /** A node the host graded and bound (its routing decision has a class):
   * any graded node, and a graded explicit route on a tier-routed catalog,
   * whose re-resolution stays on its own named surface. A planner-chosen
   * explicit row (older catalog) or an adapter-bound node has no class. */
  _resolverNode(snapshot, nodeID) {
    const child = snapshot.children.find(c => c.id === nodeID);
    return ROUTE_CLASSES.includes(child?.routing_decision?.route_class) ? child : null;
  }
  /** Replace one queued node's host-resolved row, against the supplied fresh
   * catalog, same scope and route_class, preferring a different quota pool
   * (a graded explicit route stays on its own named surface). Never used for
   * a planner-chosen explicit row, an adapter-bound node, or a child that
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
      Date.now(), {avoidPool: failed?.quota_pool ?? decided ?? null, avoidIDs, referenceOnly: escalated,
        costEvidence: query => this._costEvidence(query)});
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
        // keeps its class and the escalation target of its new pool, and the
        // cost gate decides again against that target.
        target.route_kind = choice.kind;
        target.ladder = choice.kind === 'tier' && choice.ladder ? {...choice.ladder, escalated: false} : null;
        target.cost_gate = costGateLedger(choice.costGate);
      }
      target.routing_decision = withInstructionLock(target, routingDecision(target.routing_decision.route_class,
        choice.candidate, `re_resolved_after:${reason};${choice.why}`, target.ladder, choice.tier));
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
          now, {avoidPool: planned.quota_pool, avoidIDs: [node.candidate_id],
            costEvidence: query => this._costEvidence(query)});
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
        target.cost_gate = costGateLedger(choice.costGate);
        target.routing_decision = withInstructionLock(target, routingDecision(target.routing_decision.route_class,
          choice.candidate, `spread_for_parallelism;${choice.why}`, target.ladder, choice.tier));
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
      let pool = poolKey ? this.db.prepare('SELECT task_id FROM quota_leases WHERE pool_key=?').get(poolKey) : null;
      const writer = workspaceKey ? this.db.prepare('SELECT task_id FROM write_leases WHERE workspace=?').get(workspaceKey) : null;
      if (pool && pool.task_id !== task.task_id) {
        const owner = this._load(pool.task_id);
        // Lease acquisition reconciles too: a foreign lease that no running
        // attempt and no unsettled uncertain attempt of a terminal (or
        // vanished) owner protects is stale, never a hold on this pool.
        if (!owner || (TERMINAL.has(owner.state) && !protectedPools(owner).has(poolKey))) {
          this.db.prepare('DELETE FROM quota_leases WHERE pool_key=? AND task_id=?').run(poolKey, pool.task_id);
          if (owner) this._leaseEvent(owner, 'quota_lease_released_' +
            (settledReadOnlyPools(owner).has(poolKey) ? 'settled_read_only' : 'task_terminal'));
          pool = null;
        } else return owner?.state === 'effects_uncertain' ? 'uncertain_pool' : 'busy';
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
      // A settled read-only attempt releases its pool even when its outcome
      // is effects_uncertain: its process exited and it changed nothing.
      if (!leaseProtectingChild(child)) {
        this.transaction(() => {
          const released = this.db.prepare('DELETE FROM quota_leases WHERE pool_key=? AND task_id=?')
            .run(reservation.poolKey, reservation.taskID).changes;
          if (released && child?.state === 'effects_uncertain')
            this._leaseEvent(snapshot, 'quota_lease_released_settled_read_only');
        });
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
      // The admitted single node already runs the owner's words: the repair
      // proposal is locked the same way, so only its candidate can differ.
      proposed = validatePlan(lockIndivisibleInstruction(await this.plan({task: immutable(snapshot.task),
        catalog: immutable(fresh), repair: {
          failed_node_id: childID, failed_candidate_id: oldNode.candidate_id,
          failed_attempt_id: child.attempt_id,
          failure_receipt: child.attempt_history.at(-1)?.native_receipt ?? null,
          allowed_change: 'candidate_id_only_same_scope_and_objective'}}), snapshot.task).plan, snapshot.task,
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
      if (target.routing_decision) target.routing_decision = withInstructionLock(target, routingDecision(null,
        fresh.candidates.find(c => c.id === node.candidate_id), 'adapter_bound'));
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
      'usage', 'error', 'native_summary', 'handback', 'repair_source', 'native_turn_terminated'];
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
      (result.native_summary == null || boundedText(result.native_summary, MAX_NATIVE_SUMMARY_BYTES)) &&
      (result.native_turn_terminated == null || typeof result.native_turn_terminated === 'boolean'),
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
    // An explicit route the host graded and bound (tier-routed catalog) keeps
    // its class, tier and REVAS guard as evidence; a planner-chosen explicit
    // row (older catalog) has none.
    const routeClass = ROUTE_CLASSES.includes(child.routing_decision?.route_class) ?
      child.routing_decision.route_class : null;
    const kind = explicitRoute ? 'explicit_route' : routeClass === null ? 'adapter_bound' : child.route_kind ?? 'unrecorded';
    // A named route the host graded keeps the route kind it ran as (tier,
    // reference, explicit), so the cost gate can learn from it; null
    // otherwise (and absent in older records).
    const hostKind = explicitRoute && routeClass !== null && typeof child.route_kind === 'string' ? child.route_kind : null;
    const ladder = routeClass !== null && ['ladder', 'tier'].includes(child.route_kind) && child.ladder ?
      {cheap_effort: child.ladder.cheap_effort, reference_effort: child.ladder.reference_effort} : null;
    if (ladder && child.ladder.source === 'tier')
      Object.assign(ladder, {cheap_model: child.ladder.cheap_model, reference_model: child.ladder.reference_model});
    return {route_class: routeClass, route_kind: kind, host_route_kind: hostKind, surface: candidate.surface,
      quota_pool: candidate.quota_pool, model: candidate.model, effort: candidate.effort, scope: candidate.scope,
      reference_effort: routeClass === null ? null : child.reference_effort ?? null, ladder,
      // Build 378: the bound model's tier (null without one or on an older
      // catalog) and whether this attempt is a REVAS escalation.
      tier: routeClass === null ? null : child.routing_decision?.tier ?? null,
      escalated: routeClass !== null && child.ladder?.escalated === true,
      // The cost gate's decision for the route this attempt runs as bound
      // (null for an escalated attempt, an ungraded route, or no gate).
      cost_gate: routeClass === null || child.ladder?.escalated === true ? null : child.cost_gate ?? null,
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
  /** One routing-ledger record. `escalationOutcome`: on a cheaper ladder/tier
   * attempt that failed, what its one escalation did ('escalated', or the
   * typed hold reason when the node was held instead); null on every other
   * attempt. `dispatchedFailure` 'no_effects': the executor reported that the
   * attempt failed after dispatch with no side effects (the node is still
   * never replayed); null on every other attempt. `host_route_kind` and
   * `dispatched_failure` are optional: older records lack them. */
  _ledgerRecord({taskID, nodeID, attemptID, route}, outcome, verifierOutcome, attemptState, escalationOutcome = null,
                dispatchedFailure = null) {
    return {schema: 1, task_id: taskID, node_id: nodeID, attempt_id: attemptID,
      family: routeFamily(route.route_class, route.scope, route.surface), route_class: route.route_class,
      scope: route.scope, surface_kind: surfaceKind(route.surface), surface: route.surface,
      quota_pool: route.quota_pool, model: route.model, effort: route.effort, route_kind: route.route_kind,
      host_route_kind: typeof route.host_route_kind === 'string' ? route.host_route_kind : null,
      reference_effort: route.reference_effort, ladder: route.ladder, tier: route.tier ?? null,
      escalated: route.escalated === true, cost_gate: route.cost_gate ?? null, usage: outcome.usage ?? null,
      quota_remaining_fraction: route.quota_remaining_fraction,
      execution_verified: outcome.execution_verified === true, task_quality: outcome.task_quality ?? null,
      verifier_outcome: verifierOutcome, attempt_state: attemptState,
      escalation_outcome: typeof escalationOutcome === 'string' && /^[a-z0-9_:]{1,128}$/.test(escalationOutcome) ?
        escalationOutcome : null,
      dispatched_failure: dispatchedFailure === 'no_effects' ? 'no_effects' : null,
      dispatched_at_ms: route.dispatched_at_ms, settled_at_ms: Date.now()};
  }
  /** Whether a ledger record that could not be written must wait in the
   * backlog: a parity failure (it could readmit a cheaper route) or cost-gate
   * evidence (a lost record would let the gate decide from partial evidence,
   * in either direction). */
  _backlogged(record) {
    return LEDGER_FAILURE_OUTCOMES.has(record?.verifier_outcome) || costGateRecord(record) !== null;
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
    let state = attemptState, record = null, write = null;
    try {
      const entry = this.closed ? null : this._load(pending.taskID)?.children
        .find(c => c.id === pending.nodeID)?.attempt_history.find(item => item.attempt_id === attemptID) ?? null;
      if (state === null) state = this.closed ? 'settled_after_stop' : entry?.state ?? null;
      // After stop a restart may already have recorded this attempt as
      // interrupted: never record it twice.
      if (this.closed && this.ledger.attemptIDs().has(attemptID)) return;
      const settled = state === null || UNSETTLED_ATTEMPT_STATES.has(state) ? 'interrupted' : state;
      // Built once: a retry writes the same record (its settled time too).
      record = this._ledgerRecord(pending, {usage: result?.usage ?? null,
        execution_verified: result?.execution_verified, task_quality: result?.task_quality ?? null},
      verifierOutcome, settled, entry?.escalation_outcome ?? null, entry?.dispatched_failure ?? null);
      write = () => this.ledger.append(record);
      write();
    } catch (error) {
      this._logLedger(error);
      // The pending row stays for the restart; a parity failure also closes
      // every ladder in this process until it is written, and cost-gate
      // evidence closes the gate (cost_gate_unavailable) until it is written.
      if (write && !this.closed && this._backlogged(record)) this.ledgerBacklog.set(attemptID, write);
      return;
    }
    this._clearLedgerPending(attemptID);
  }
  _clearLedgerPending(attemptID) {
    if (this.closed) return;
    try { this.transaction(() => this.db.prepare('DELETE FROM ledger_pending WHERE attempt_id=?').run(attemptID)); }
    catch (error) { this._logLedger(error); }
  }
  /** Retry backlogged records (parity failures and cost-gate evidence whose
   * ledger write failed), oldest first; stop at the first that still fails. */
  _flushLedgerBacklog() {
    for (const [attemptID, write] of this.ledgerBacklog) {
      try { write(); } catch (error) { this._logLedger(error); return; }
      this.ledgerBacklog.delete(attemptID);
      this._clearLedgerPending(attemptID);
    }
  }
  /** Ladder parity evidence: none while a backlogged record (a parity
   * failure, or cost-gate evidence) waits to be written, so a lost failure
   * can never readmit a cheaper route. */
  _ladderStats(family, model, effort) {
    if (this.ledgerBacklog.size) this._flushLedgerBacklog();
    if (this.ledgerBacklog.size) return {verified_passes: 0, verifier_failures: 0};
    return this.ledgerStats(family, model, effort);
  }
  /** Cost-gate evidence (tierCostEvidence) from the routing ledger. Throws
   * (the gate then reads cost_gate_unavailable and the node keeps its tier
   * route) when the gate would otherwise decide from partial evidence: while
   * a backlogged record waits to be written (a lost cheaper failure would
   * make the tier look cheaper, a lost cheaper success or reference cost the
   * reference), while a tier or reference attempt of this process has
   * returned but is not recorded yet (its escalation or verifier is still
   * running), and when the ledger cannot be read safely. */
  _costEvidence(query) {
    if (this.ledgerBacklog.size) this._flushLedgerBacklog();
    assert(this.ledgerBacklog.size === 0, 'cost_gate_ledger_backlog');
    for (const pending of this.ledgerInflight.values())
      assert(!(pending.returned && costGateRoute(pending.route)), 'cost_gate_ledger_pending');
    return tierCostEvidence(this.ledger.costRecords(), query);
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
      await this._ladderFailed(taskID, node, candidate, result, outcome);
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
   * queue bound to its reference row. A tier guard that finds no reference in
   * its bound catalog (its rows may have outlived their validity window while
   * the cheaper attempt ran) refreshes the catalog once and looks again
   * before it gives up. Otherwise ONLY this child is held (cancelled under a
   * cancel request) with a typed reason: the scheduler settles the task after
   * every running sibling reconciles. Either way the cheaper attempt's
   * history entry records its escalation outcome ('escalated', or the hold
   * reason), which the routing ledger keeps. */
  async _ladderFailed(taskID, node, candidate, result, outcome) {
    const current = () => {
      const state = this._load(taskID);
      const child = state?.children.find(c => c.id === node.id);
      return !state || TERMINAL.has(state.state) || child?.state !== 'waiting' ||
        child.attempt_id !== result.attempt_id ? null : {state, child};
    };
    const holdReason = ({state, child}) => state.cancel_requested ? 'ladder_cancelled_before_escalation' :
      this.stopping ? 'owner_stopped_before_ladder_escalation' :
      result.dispatch_stage !== 'dispatched' || result.side_effects !== 'none' ? 'ladder_escalation_effects_reported' :
      !child.ladder || child.ladder.escalated || candidate.scope !== 'read_only' ?
        'ladder_verifier_failed_reference_unavailable' : null;
    let found = current();
    if (!found) return;
    let reason = holdReason(found);
    for (let pass = 0; reason === null; pass++) {
      try { this._escalateLadder(taskID, node.id, result.attempt_id, outcome); return; }
      catch (error) { reason = error instanceof RCCRuntimeError ? error.code : 'ladder_reference_unavailable'; }
      if (pass > 0 || reason !== 'ladder_reference_unavailable' || found.child.ladder?.source !== 'tier' ||
          this.closed || typeof this.catalog !== 'function') break;
      try { await this._refreshCatalog(taskID); } catch { /* The hold below names the reference. */ break; }
      found = current();
      if (!found) return;
      reason = holdReason(found);
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
        attempt.verifier = outcome; attempt.escalation_outcome = reason; }
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
    const explicitRoute = snapshot.task.mode === 'explicit_routing_test';
    let reference = find(child.ladder?.reference_candidate_id);
    if (tier && node && cheap) {
      const now = Date.now();
      const offered = reference && snapshot.catalog.candidates.find(c => c.id === reference.id);
      if (!(offered && dispatchable(offered, snapshot.task, now))) {
        // Now, else as last observed: the bound catalog's rows may have
        // outlived their validity window while the cheaper attempt ran, and
        // that must not make a reference observed then look unavailable
        // (dispatch refreshes and re-checks the row before anything runs).
        for (const at of [now, snapshot.catalog_bound_at_ms]) {
          if (!Number.isSafeInteger(at)) continue;
          try {
            reference = selectRouteCandidate(node, child.routing_decision?.route_class, snapshot.task,
              snapshot.catalog, at, {referenceOnly: true, preferPool: cheap.quota_pool, avoidIDs: [cheap.id]}).candidate;
            break;
          } catch { /* Keep the admitted reference row, if any: dispatch re-resolves it. */ }
        }
      }
    }
    assert(node && cheap && reference && node.scope === 'read_only' && reference.scope === 'read_only' &&
      reference.id !== cheap.id && (tier ? reference.surface !== 'local' &&
        (!explicitRoute || reference.surface === cheap.surface) :
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
        attempt.verifier = outcome; attempt.escalation_outcome = 'escalated'; }
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
      target.routing_decision = withInstructionLock(target, routingDecision(target.routing_decision.route_class, reference,
        why + ';effort_' + reference.effort + ';' +
        (reference.surface.endsWith('-chat') ? 'chat_lane_same_route' : 'agent_surface'), target.ladder,
        tier ? tierOf(state.catalog, reference.model) ?? 'frontier' : undefined));
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
        // Returned but not recorded until this call settles it (an escalation,
        // a verifier or a catalog refresh may still run): the cost gate reads
        // no evidence meanwhile (_costEvidence).
        const inflight = this.ledgerInflight.get(attemptID);
        if (inflight) inflight.returned = true;
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
            // Settled only when the adapter attests the turn ended
            // (settledReadOnly): a cancelled Codex Desktop turn may still run.
            recordTurnSettlement(child.attempt_history.at(-1), result);
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
          if (discard) { await this._ladderFailed(taskID, node, candidate, result, 'not_returned'); return; }
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
          await this._ladderFailed(taskID, node, candidate, result, 'not_returned');
          return;
        }
        this._update(taskID, 'child_effects_uncertain', snapshot => {
          const child = snapshot.children.find(c => c.id === node.id);
          child.state = 'effects_uncertain'; child.attempt_history.at(-1).state = 'effects_uncertain';
          // The executor's own report that the attempt ran and failed with no
          // side effects (not a cancel or stop: those returned above). The
          // node is still never replayed; the routing ledger keeps the fact
          // (dispatched_failure) because the run's tokens were spent.
          if (result.status === 'failed' && result.dispatch_stage === 'dispatched' && result.side_effects === 'none')
            child.attempt_history.at(-1).dispatched_failure = 'no_effects';
          // A record whose adapter attests the native turn ended settled the
          // attempt: a read-only one with no side effects then holds no
          // quota-pool lease (settledReadOnly); it is still never replayed.
          recordTurnSettlement(child.attempt_history.at(-1), result);
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
