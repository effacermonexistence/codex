import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open } from 'node:fs/promises';
import { closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { validateLocalUsageEvent, summarizeTaskResources } from './resource-usage.mjs';
import { decodeAdaptiveRoutingPolicy, adaptivePolicyDisposition } from './adaptive-routing-policy.mjs';
import { createPlannerHostProjection, compileFreshPlannerProposal } from './adaptive-plan-host.mjs';
import { selectJointRoute, exactConfigFingerprint } from './joint-route-selector.mjs';
import { captureRoutingOutcome } from './routing-outcome-capture.mjs';
import { isFrozenRoutePredictor, isFrozenRouteInference } from './frozen-route-predictor.mjs';

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
// The local model OpenClaw already runs (intent resolution's model). A catalog row
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
// A legacy adapter called opaque HTTP rejections an authorization refusal.
// That does not establish a model/configuration negative: old records remain
// held, not silently reinterpreted as permission to change candidate/account.
const NATIVE_AUTHORIZATION_REFUSED = 'native_authorization_refused';
// Only the native catalog's explicit unsupported tuple observation emits
// this code. It is not the legacy mixed configuration/authentication error.
const NATIVE_CONFIGURATION_UNAVAILABLE = 'native_configuration_unavailable';
const UNCHARGED_PRE_EXECUTION_ERRORS = new Set([PROVIDER_QUOTA_REJECTED_BEFORE_EXECUTION,
  NATIVE_CONFIGURATION_UNAVAILABLE]);
const TRANSPORTS = new Set(['local', 'codex_app_server', 'claude_cli', 'chatgpt_service', 'claude_service']);
const SCOPES = new Set(['read_only', 'workspace_write']);
// Build 407: the host's deterministic request classes (catalog request_class).
// Only read-only classes may carry a class certificate (R0(c), R5).
const REQUEST_CLASSES = new Set(['chat_explanatory', 'text_operation', 'readonly_lookup', 'readonly_material',
  'writer', 'explicit_route']);
const CERTIFIABLE_CLASSES = new Set(['chat_explanatory', 'text_operation', 'readonly_lookup', 'readonly_material']);
const FORMAT_CHECK = /^[a-z][a-z0-9_]{0,63}$/;
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode']);
// Deterministic host routing (build 407, R0): ONE admission law, decided in
// code at catalog bind before any model call (admittedRoute). Owner objective:
// the SAME result as the newest top model at its provider's highest supported
// reasoning, while spending less quota. Every node binds a REFERENCE (a pool's
// frontier model at its highest admitted supported effort, or the tuple the
// owner's own words leave) unless a certifying source exists before dispatch:
//  (a) a full-coverage owner contract the host re-bound to this exact request;
//  (b) a registered gold-blind node verifier for the certified class;
//  (c) a signed class certificate (rcc-class-table.json, empty as shipped).
// A bounded full-contract writer may descend only with the native host's exact
// staged-workspace capability: failed candidates never touch the original.
// No model-authored grade lowers a tuple. A certified read-only node runs the
// cheaper tier (TIER_ROUTES.trivial, or the certificate's own tuple) only
// beside a reference that can dispatch now, fixed as its one escalation, and
// is delivered only when the source that admitted it accepts THIS answer (R9).
// Among equal-quality references the pool order is R11: the owner's provider
// word (already applied by the native catalog), the class provider pin, the
// pool holding this conversation's resumable native session, then quota.
//
// A catalog WITHOUT `model_tiers` (older hosts and persisted catalogs) binds
// every node at a pool's REFERENCE route (its first model at the highest
// admitted supported effort).
const EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'ultracode'];
// Recorded route classes. 'deep' names a node bound at a reference (or an
// owner-chosen tuple), 'trivial' a certified descent; 'standard' survives
// only in persisted decisions of older builds.
export const ROUTE_CLASSES = Object.freeze(['trivial', 'standard', 'deep']);
const CERTIFIED_CLASS = 'trivial';
// Provider-stated model tiers, strongest first (Swift ModelTiers is the owner).
export const MODEL_TIERS = Object.freeze(['frontier', 'workhorse', 'efficient', 'fast']);
// A tier-list effort that means the model's reference effort: its highest
// admitted supported effort, not a hard-coded label such as "max".
const REFERENCE_EFFORT = 'reference';
// Ordered (tier, effort) entries: the first with a dispatchable row in a pool
// wins. `trivial` is the certified descent of R0 (a) and (b); `deep` is the
// reference only. A model with no effort control (its only row is "none":
// Claude Haiku 4.5, 2026-10-15) satisfies its tier's concrete effort (entryRows).
export const TIER_ROUTES = Object.freeze({
  trivial: Object.freeze([['fast', 'low'], ['efficient', 'low'], ['workhorse', 'low']]),
  deep: Object.freeze([['frontier', REFERENCE_EFFORT]]),
});
// A class certificate's own per-answer format check (R9 (c)), by name. A
// certificate naming a check this Core does not know certifies nothing.
const FORMAT_CHECKS = Object.freeze({nonempty_text: output => typeof output === 'string' && output.trim() !== ''});
// Swift's QualityDisclosure carries at most this many failed check IDs.
const MAX_DISCLOSED_CHECKS = 64;
const INTENT_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const INTENT_FAMILY = /^[a-z][a-z0-9]{1,31}$/;
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
const UNSETTLED_ATTEMPT_STATES = new Set(['dispatch_started', 'continuation_dispatch_started', 'quality_dispatch_started', 'node_verifier_pending']);
const UNSETTLED_DISPATCH_STATES = new Set(['dispatch_started', 'continuation_dispatch_started', 'quality_dispatch_started']);
// Separate from the attempt budget: how often one node's host-resolved row may
// be replaced after a pre-dispatch failure, always within the same scope.
const MAX_RE_RESOLUTIONS = 2;
// Authentication, transport and opaque pre-dispatch refusals do not prove
// that another model/account is an authorized or working alternative. The
// legacy spelling stays fail-closed for an already persisted native record.
const HELD_PRE_DISPATCH_ERRORS = new Set(['native_pre_dispatch_failed', 'pre_dispatch_failed',
  'native_configuration_or_authorization_unavailable', NATIVE_AUTHORIZATION_REFUSED]);
const RE_RESOLVABLE_FAILURES = new Set(['candidate_unavailable', 'candidate_quota_unknown_or_exhausted',
  'candidate_missing', 'selected_candidate_disappeared']);
// A native catalog probe that failed (not a binding/configuration change) is
// retried this many times before the task is held.
const MAX_TRANSIENT_REFRESH_FAILURES = 3;
// How often one not-yet-dispatched host-resolved node may move between pools for
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
// The full owner policy stays in the intent prompt. Installed build387's
// cold live trial used 5.3s model load + 17.4s prefill (4914 tokens), then
// reached only 67 output tokens when the former 30s bound cancelled it.
// This bounded 60s allowance includes that measured substrate overhead;
// the owner's remaining whole-task duration remains the tighter ceiling.
const INTENT_RESOLUTION_TIMEOUT_MS = 60_000;
const INTENT_ROUTE_SURFACES = new Set(['local', 'codex', 'claude', 'claude-chat']);

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

/** Original owner input stays snapshot.task. Only Core may persist a narrower
 * effective task; every routing/verification path must use this same view. */
export function executionTask(snapshot) { return snapshot.effective_task ?? snapshot.task; }

function validateIntentResolution(value, original) {
  assert(keys(value, ['schema', 'task_id', 'request_sha256', 'policy_sha256', 'source_fingerprint',
    'kind', 'routes', 'best_effort', 'notices', 'reason', 'model_answer']) &&
    value.schema === 1 && value.task_id === original.task_id &&
    value.request_sha256 === original.request_sha256 && value.policy_sha256 === original.policy_sha256 &&
    value.source_fingerprint === original.source_fingerprint &&
    ['ordinary', 'routes', 'hold', 'local_response'].includes(value.kind) && typeof value.best_effort === 'boolean' &&
    Array.isArray(value.routes) && value.routes.length <= 8 &&
    value.routes.every(route => keys(route, ['surface', 'instruction']) &&
      INTENT_ROUTE_SURFACES.has(route.surface) && boundedText(route.instruction, 12_000)) &&
    new Set(value.routes.map(stable)).size === value.routes.length &&
    Array.isArray(value.notices) && value.notices.length <= 16 &&
    value.notices.every(notice => boundedText(notice, 4_096)) &&
    (value.reason === null || boundedText(value.reason, 1_024)) &&
    (value.model_answer === null || (typeof value.model_answer === 'string' &&
      !value.model_answer.includes('\0') && Buffer.byteLength(value.model_answer) <= 4_096)),
  'intent_resolution_invalid');
  assert(value.kind === 'routes' ? value.routes.length > 0 && original.material_refs.length === 0 :
    value.routes.length === 0 && value.best_effort === false, 'intent_resolution_scope_invalid');
  assert(value.kind !== 'hold' || value.reason !== null, 'intent_resolution_hold_reason_missing');
  if (value.kind === 'local_response')
    assert(original.mode === 'auto' && original.host_context.provider_preference === 'auto' &&
      (original.provider_preference == null || original.provider_preference === 'auto') &&
      original.host_context.explicit_routes == null && original.material_refs.length === 0 &&
      original.objective === original.request && value.model_answer === null &&
      value.notices.length === 0 && value.reason === null, 'intent_local_response_scope_invalid');
  return immutable(value);
}

/** Fixed, cross-language canonical receipt: not a user-authored authority
 * token. The native executor independently recompiles the original request
 * and raw model answer before accepting the narrow derived host context. */
export function intentResolutionFingerprint(original, resolution) {
  return sha(Buffer.from(stable({schema: 1, task_id: original.task_id,
    request_sha256: original.request_sha256, policy_sha256: original.policy_sha256,
    source_fingerprint: original.source_fingerprint, routes: resolution.routes,
    best_effort: resolution.best_effort, model_answer: resolution.model_answer})));
}

function deriveIntentTask(original, resolution) {
  assert(original.mode === 'auto' && original.host_context.explicit_routes == null &&
    resolution.kind === 'routes', 'intent_derivation_scope_invalid');
  const derived = immutable(original);
  derived.mode = 'explicit_routing_test';
  if (Object.hasOwn(original, 'provider_preference')) derived.provider_preference = 'auto';
  derived.host_context.provider_preference = 'auto';
  derived.host_context.require_read_only = true;
  derived.host_context.explicit_routes = immutable(resolution.routes);
  if (resolution.best_effort) derived.host_context.explicit_routes_best_effort = true;
  derived.source_fingerprint = hostContextFingerprint(derived.host_context);
  derived.core_routing = {schema: 1, original_source_fingerprint: original.source_fingerprint,
    original_mode: 'auto', original_provider_preference: original.host_context.provider_preference,
    original_require_read_only: original.host_context.require_read_only,
    model_answer: resolution.model_answer, resolution_sha256: intentResolutionFingerprint(original, resolution)};
  return validateTask(derived, {allowCoreRouting: true});
}

/** The explicit routes that still run. A GPT/ChatGPT-named route is dropped,
 * never substituted; the immutable host contract keeps the original list. A
 * route Core skipped at admission of a best-effort route test (`admittedTask`)
 * does not run either. */
export function effectiveExplicitRoutes(task) {
  const routes = task?.host_context?.explicit_routes;
  return Array.isArray(routes) ? routes.filter(route => !DROPPED_ROUTE_SURFACES.has(route.surface) &&
    route.skipped !== true) : routes;
}
/** The task as Core admitted it. A best-effort route test (route-all,
 * host_context.explicit_routes_best_effort) runs the routes that have a
 * runnable row at admission; the others are recorded in skipped_routes with
 * their reason, never held for the whole set. Every later plan, repair,
 * re-resolution and the verifier then bind exactly the routes that run: the
 * skipped ones are marked on a copy, the immutable task keeps the original. */
export function admittedTask(snapshot) {
  const skipped = snapshot?.skipped_routes;
  if (!Array.isArray(skipped) || skipped.length === 0) return executionTask(snapshot);
  const task = structuredClone(executionTask(snapshot));
  const routes = task.host_context?.explicit_routes;
  for (const item of skipped) if (Array.isArray(routes) && routes[item.index]) routes[item.index].skipped = true;
  return task;
}
function droppedExplicitRoutes(task) {
  const routes = task?.host_context?.explicit_routes;
  return Array.isArray(routes) ? routes.filter(route => DROPPED_ROUTE_SURFACES.has(route.surface)) : [];
}
function validCapacityPlan(plan) {
  return plan === undefined || plan === null || (keys(plan, ['codex', 'claude']) &&
    int(plan.codex, 0, 100) && int(plan.claude, 0, 100) && plan.codex + plan.claude > 0);
}

function validateTask(task, {allowCoreRouting = false} = {}) {
  const required = ['schema', 'task_id', 'request', 'request_sha256', 'objective', 'policy_sha256',
    'source_fingerprint', 'mode', 'material_refs', 'budget', 'host_context'];
  const optional = ['context', 'workspace', 'native_sessions', 'provider_preference', 'policy', 'routing_intent_policy_version',
    ...(allowCoreRouting ? ['core_routing'] : [])];
  assert(plain(task) && required.every(key => Object.hasOwn(task, key)) &&
    Object.keys(task).every(key => required.includes(key) || optional.includes(key)), 'task_shape_invalid');
  assert(task.routing_intent_policy_version == null ||
    (task.routing_intent_policy_version === INTENT_V2_VERSION && task.mode === 'auto'), 'intent_policy_version_invalid');
  assert(task.schema === 1 && ID.test(task.task_id) && boundedText(task.request, 64_000) &&
    boundedText(task.objective, 8_192) && HASH.test(task.request_sha256) &&
    sha(Buffer.from(task.request)) === task.request_sha256 && HASH.test(task.policy_sha256) &&
    HASH.test(task.source_fingerprint) && ['auto', 'explicit_routing_test'].includes(task.mode),
  'task_identity_invalid');
  assert(keys(task.budget, ['max_attempts', 'max_parallel', 'max_cost_units', 'max_duration_ms',
      ...(Object.hasOwn(task.budget ?? {}, 'max_native_dispatches') ? ['max_native_dispatches'] : [])]) &&
    (task.budget.max_native_dispatches == null || int(task.budget.max_native_dispatches, 1, 64)) &&
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
  const hostOptionalKeys = ['explicit_routes', 'conversation_id', 'submission_id', 'capacity_plan',
    'explicit_routes_best_effort'];
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
    // Route-all only: run the routes that can run, skip (visibly) the rest.
    (h.explicit_routes_best_effort === undefined ||
      (h.explicit_routes_best_effort === true && Array.isArray(h.explicit_routes))) &&
    hostContextFingerprint(h) === task.source_fingerprint, 'host_context_invalid');
  assert(Buffer.byteLength(stable(task)) <= MAX_TASK_BYTES, 'task_oversize');
  if (task.core_routing !== undefined) {
    const core = task.core_routing;
    assert(allowCoreRouting && keys(core, ['schema', 'original_source_fingerprint', 'original_mode',
      'original_provider_preference', 'original_require_read_only', 'model_answer', 'resolution_sha256']) &&
      core.schema === 1 && HASH.test(core.original_source_fingerprint) && core.original_mode === 'auto' &&
      boundedText(core.original_provider_preference, 256) && typeof core.original_require_read_only === 'boolean' &&
      (core.model_answer === null || (typeof core.model_answer === 'string' &&
        !core.model_answer.includes('\0') && Buffer.byteLength(core.model_answer) <= 4_096)) &&
      HASH.test(core.resolution_sha256) && task.mode === 'explicit_routing_test' &&
      h.require_read_only === true && h.provider_preference === 'auto' &&
      (task.provider_preference === undefined || task.provider_preference === 'auto'),
    'core_routing_invalid');
  }
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
const INTENT_V2_VERSION = 'r10_joint_selection_v2';
function routingIntent(catalog) { return catalog?.routing_intent_v2 ?? catalog?.routing_intent ?? null; }
function activeIntentV2(task, catalog) {
  return task?.routing_intent_policy_version === INTENT_V2_VERSION &&
    validRoutingIntentV2(catalog?.routing_intent_v2) && catalog.routing_intent_v2.state === 'resolved';
}
function intentAdmits(candidate, intent) {
  return !intent || ((!intent.allowed_surfaces?.length || intent.allowed_surfaces.includes(candidate.surface)) &&
    (intent.exact_model == null || candidate.model === intent.exact_model) &&
    (intent.model_family == null || modelInFamily(candidate.model, intent.model_family)) &&
    (intent.effort == null || candidate.effort === intent.effort));
}
/** The reference effort of one model's admitted rows. An explicit owner
 * effort is exact, including when unavailable (never substitute another
 * effort). Otherwise use the highest supported catalog row BEFORE testing
 * dispatchability: an unavailable highest row cannot silently become max.
 * The native builder also reports reference_unavailable when it knows a
 * higher supported tuple is absent from its signed catalog. Preserve that
 * boundary without fabricating the missing row. Concrete cheap-tier entries
 * remain eligible; only the automatic reference is unavailable. */
function referenceEffort(rows, intent, catalog) {
  const offered = rows.map(c => c.effort);
  if (intent?.effort) return offered.includes(intent.effort) ? intent.effort : null;
  // Ordinary Auto must preserve the provider's missing-reference boundary
  // even on a legacy catalog that also carries per-model metadata. That map
  // describes represented models, not the absent frontier. A named family
  // has its own ceiling and must not inherit another family's global hold.
  if (!intent?.model_family && !intent?.exact_model && rows.some(row => (catalog?.exclusions ?? []).some(exclusion =>
    exclusion.provider === providerOfPool(row.quota_pool) && exclusion.reason === 'reference_unavailable'))) return null;
  // Fresh native catalogs report the ceiling of THIS exact model even when
  // its signed executable tuple is absent. The map grants no execution
  // authority: a matching admitted row must still exist and dispatch.
  // Per-model evidence resolves a named family's broader provider exclusion so
  // an unavailable Astra ceiling cannot poison an explicit Sol reference.
  const first = rows[0];
  const provider = first ? providerOfPool(first.quota_pool) : null;
  if (catalog?.native_reference_efforts !== undefined && EXCLUSION_PROVIDERS.has(provider)) {
    const ceiling = catalog.native_reference_efforts?.[provider]?.[first?.model];
    return EFFORTS.has(ceiling) && offered.includes(ceiling) ? ceiling : null;
  }
  // Legacy/persisted catalogs lack model-specific native evidence. Retain
  // their compatibility route; do not infer that the
  // highest offered row proves the native host's true supported maximum.
  return offered.length ? EFFORT_ORDER[Math.max(...offered.map(effort => EFFORT_ORDER.indexOf(effort)))] : null;
}
/** Per quota pool, in catalog order: the pool's reference model (its first,
 * i.e. most-preferred, model in catalog order among rows that can carry this
 * node) with that model's rows and reference effort. Dispatchability is NOT
 * used to pick the model: an undispatchable top model makes its pool unusable
 * for this node instead of silently substituting a lower model. The native
 * builder's reference_unavailable boundary also covers a known higher
 * supported effort whose signed row is missing. A tiered catalog may retain
 * cheap rows in that pool, but they cannot stand in for its reference. */
function poolReferences(node, catalog, options = {}) {
  const intent = routingIntent(catalog);
  const pools = new Map();
  catalog.candidates.forEach((candidate, index) => {
    if (!eligibleRow(candidate, node, options) || !intentAdmits(candidate, catalog?.routing_intent_v2 ?? null)) return;
    if (!pools.has(candidate.quota_pool))
      pools.set(candidate.quota_pool, {pool: candidate.quota_pool, model: candidate.model, rows: []});
    const entry = pools.get(candidate.quota_pool);
    if (candidate.model === entry.model) entry.rows.push({candidate, index});
  });
  return [...pools.values()].map(entry => ({...entry,
    effort: referenceEffort(entry.rows.map(row => row.candidate), intent, catalog)}));
}
function referenceRows(reference) {
  return reference.effort === null ? [] :
    reference.rows.filter(row => row.candidate.effort === reference.effort).map(row => row.candidate);
}

// ---- Dynamic tier routing (build 378) ----
/** The catalog's provider-stated model tiers, or null for an older catalog
 * (which keeps the former reference routing). */
function modelTiers(catalog) { return plain(catalog?.model_tiers) ? catalog.model_tiers : null; }
/** An explicit route test on a tier-routed catalog: the host binds each named
 * route's model and effort on that route's own surface (an older catalog keeps
 * an injected plan's exact candidate choice). */
export function explicitTierRouting(task, catalog) {
  return task?.mode === 'explicit_routing_test' && modelTiers(catalog) !== null;
}
/** A model belongs to a family only on a whole name token: the same rule as
 * Swift RoutingIntent.model(_:belongsTo:), so "sol" never matches "console". */
function modelInFamily(model, family) {
  return typeof model === 'string' && model.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(family);
}
// An explicit-route node names its route by its position in the owner's
// ORIGINAL route list (requested-1 ... requested-8), the same ordinal older
// snapshots use for their display surface.
const EXPLICIT_NODE_ID = /^requested-([1-8])$/;
export function explicitRouteNodeID(index) { return `requested-${index + 1}`; }
/** The explicit route a node binds, with that route's OWN effort or
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
  assert(route && !DROPPED_ROUTE_SURFACES.has(route.surface) && route.skipped !== true &&
    node.instruction === route.instruction &&
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
/** A row tier routing may bind: a tiered model, or a model of the family the
 * owner explicitly named. A model with no tier is never chosen by tier alone.
 * The catalog already holds only the named family's rows for a whole-request
 * intent; an explicit route's own family word narrows the rows here (its
 * catalog is not filtered per route). */
function tierRoutable(candidate, catalog, intent) {
  return intent?.exact_model ? candidate.model === intent.exact_model :
    intent?.model_family ? modelInFamily(candidate.model, intent.model_family) :
    tierOf(catalog, candidate.model) !== null;
}
/** The rows that can carry this node, per quota pool, in catalog order;
 * `surface` keeps only one named surface (an explicit route). */
function poolRows(node, catalog, options = {}) {
  const pools = new Map();
  catalog.candidates.forEach((candidate, index) => {
    if (!eligibleRow(candidate, node, options) || !intentAdmits(candidate, catalog?.routing_intent_v2 ?? null)) return;
    if (options.surface != null && candidate.surface !== options.surface) return;
    if (!pools.has(candidate.quota_pool)) pools.set(candidate.quota_pool, {pool: candidate.quota_pool, rows: []});
    pools.get(candidate.quota_pool).rows.push({candidate, index});
  });
  return [...pools.values()];
}
/** The models among these rows that offer ONLY effort "none": the model has
 * no reasoning-effort control (2026-10-15: the Claude CLI 2.1.290 inventory
 * row 'haiku' -> claude-haiku-4-5-20251001 has no supportsEffort and no
 * supportedEffortLevels, and `claude -p --model haiku` with no --effort
 * answered on that model), so its one row is the whole model. A model with a
 * "none" row beside real efforts is not effortless. */
function effortlessModels(matching) {
  const efforts = new Map();
  for (const {candidate} of matching)
    efforts.set(candidate.model, (efforts.get(candidate.model) ?? new Set()).add(candidate.effort));
  return new Set([...efforts].filter(([, set]) => set.size === 1 && set.has('none')).map(([model]) => model));
}
/** The rows of one pool that match one (tier, effort) entry. A REFERENCE
 * effort is the highest admitted supported effort that the entry's tier (or,
 * for an explicitly named family, the family) offers in this pool. An
 * explicit effort word is a hard constraint. A model with no effort control
 * (effortlessModels) satisfies any concrete effort of an entry its tier (or
 * the named family) matches: the entry's effort is the cheapest reasoning
 * expected to suffice and such a model has nothing to set. Never under an
 * owner effort word (that model cannot honour it) and never for a REFERENCE
 * entry (referenceEffort already reads a none-only model as "none"); with
 * today's TIER_ROUTES only a certified read-only descent binds a fast-tier
 * model. An explicit family word naming it binds it: the owner's route. */
function entryRows(rows, entry, catalog, intent) {
  const matching = rows.filter(({candidate}) => tierRoutable(candidate, catalog, intent) &&
    (entry.tier === null || tierOf(catalog, candidate.model) === entry.tier));
  if (entry.effort === REFERENCE_EFFORT) {
    // Model preference and effort are separate axes. Bind the preferred
    // matching MODEL first, then only its own native ceiling. Another
    // frontier/family member offering a larger label cannot replace it.
    const model = matching[0]?.candidate.model;
    const preferred = matching.filter(({candidate}) => candidate.model === model);
    const effort = referenceEffort(preferred.map(row => row.candidate), intent, catalog);
    return effort === null ? [] : preferred.filter(({candidate}) => candidate.effort === effort);
  }
  const effortless = intent?.effort ? new Set() : effortlessModels(matching);
  return matching.filter(({candidate}) => candidate.effort === entry.effort ||
    (candidate.effort === 'none' && effortless.has(candidate.model)));
}
/** A pool's REFERENCE rows: its frontier-tier model at the highest supported
 * effort it admits. Empty when the pool offers no frontier model: nothing
 * lower stands in for it. */
function tierReferenceRows(rows, catalog, intent = null) {
  return entryRows(rows, {tier: 'frontier', effort: REFERENCE_EFFORT}, catalog, intent);
}
/** The reference an owner constraint leaves: the named family at its highest
 * admitted supported effort (or at the owner's effort word), else the frontier at the
 * owner's effort word (or its highest admitted supported effort). Without an
 * owner constraint it is the pool's frontier reference. */
function intentReferenceRows(rows, catalog, intent) {
  return intent?.model_family || intent?.exact_model ? entryRows(rows, {tier: null, effort: REFERENCE_EFFORT}, catalog, intent) :
    tierReferenceRows(rows, catalog, intent);
}

/** The builder's per-model pool score (share x the model's own remaining
 * quota / hours to its own reset), or null when the catalog has none for it
 * (older catalogs, unknown quota). */
function quotaScore(catalog, model) {
  const score = plain(catalog?.quota_scores) ? catalog.quota_scores[model] : undefined;
  return int(score, 0, 1_000_000_000) ? score : null;
}

// ---- The admission law (build 407, R0) ----
/** The surface kinds ('agent', 'chat') a registered gold-blind node verifier
 * covers for the certified class (R0 (b)). Production registers none. */
function verifiedSurfaceKinds(registry) {
  return registry instanceof Map ? ['agent', 'chat'].filter(kind =>
    typeof registry.get(`${CERTIFIED_CLASS}:read_only:${kind}`) === 'function') : [];
}
/** R0, the one admission law, decided in code at bind before any model call:
 * the reference tuple unless one certifying source exists NOW. Pure: the
 * result depends only on the node, the task, the catalog's host facts, `now`
 * and the registered node verifiers. Returns {class: 'reference'|'certified',
 * source, certificate_id}:
 *  - 'exact': an explicit route test's node whose payload is one exact
 *    arithmetic expression and whose route names no model or effort: its
 *    surface stays fixed and only the exact result is ever delivered;
 *  - owner words (an explicit route test, an effort or model-family word, or
 *    a provider the owner chose: a host or task provider_preference other
 *    than 'auto') fix the reference those words leave (R10): source
 *    'owner_words'. A bare provider name binds that provider's reference
 *    (the catalog already holds only its rows), never a certified descent;
 *  - a deterministic node is never certified here; writers need the exact
 *    host-attested full-contract atomic-stage capability (413), never a hint;
 *  - (a) 'contract': a full-coverage read-only owner contract that the host
 *    re-bound at catalog time to this exact request, still valid, and a node
 *    running that request byte-exact;
 *  - (b) 'verifier': a registered verifier for the certified class;
 *  - (c) 'class': this request class's signed certificate, for a node running
 *    the request byte-exact, whose per-answer format check this Core knows;
 *  - anything else 'uncertified'. A model-authored grade never certifies. */
export function admittedRoute(node, task, catalog, now = Date.now(), {verifierRegistry = null} = {}) {
  const reference = source => ({class: 'reference', source, certificate_id: null});
  const providerChosen = value => value != null && value !== 'auto';
  // An explicit route test's exact arithmetic payload is certified by its
  // exact result (source 'exact'): the named surface stays fixed, its
  // cheapest tier runs, and any other answer escalates once to that
  // surface's reference. A model or effort word on the route still binds
  // the owner's tuple.
  const explicit = task?.mode === 'explicit_routing_test' ? explicitRouteOf(node, task, catalog) : null;
  if (explicit && explicit.intent == null && node?.kind === 'agent' && node.scope === 'read_only' &&
      pureArithmetic(node.instruction ?? '') !== null)
    return {class: 'certified', source: 'exact', certificate_id: null};
  const v2 = activeIntentV2(task, catalog);
  // A task marker is not activation/admission. Missing/mismatched host catalog
  // never reuses legacy policy or admits an uncertified cheaper tuple.
  if ((task?.routing_intent_policy_version != null || catalog?.routing_intent_v2 !== undefined) && !v2)
    return reference('intent_policy_unavailable');
  if (task?.mode === 'explicit_routing_test' ||
      (v2 ? catalog.routing_intent_v2.require_native_ceiling : routingIntent(catalog) !== null ||
        providerChosen(task?.host_context?.provider_preference) || providerChosen(task?.provider_preference)))
    return reference('owner_words');
  // v2 changes owner-word semantics only. ALL R0 certifying sources below,
  // runnable-reference requirement and post-result adoption remain unchanged.
  if (node?.kind !== 'agent') return reference('uncertified');
  if (node.scope === 'workspace_write') {
    const c = catalog?.task_contract;
    return node.instruction === task.request && stagedWriterContract(c) && c.bindings_checked === true &&
      c.objective_sha256 === task.request_sha256 && c.valid_until_ms > now ?
      {class: 'certified', source: 'contract', certificate_id: null} : reference('uncertified');
  }
  if (node.scope !== 'read_only') return reference('uncertified');
  const own = node.instruction === task.request;
  const contract = catalog?.task_contract;
  if (own && plain(contract) && contract.coverage === 'full' && contract.scope === 'read_only' &&
      contract.bindings_checked === true && contract.objective_sha256 === task.request_sha256 &&
      int(contract.valid_until_ms, 0, Number.MAX_SAFE_INTEGER) && contract.valid_until_ms > now)
    return {class: 'certified', source: 'contract', certificate_id: null};
  if (verifiedSurfaceKinds(verifierRegistry).length > 0)
    return {class: 'certified', source: 'verifier', certificate_id: null};
  const cls = catalog?.request_class;
  const certificate = own && CERTIFIABLE_CLASSES.has(cls) && plain(catalog.class_certificates) ?
    catalog.class_certificates[cls] : undefined;
  if (plain(certificate) && Object.hasOwn(FORMAT_CHECKS, certificate.format_check))
    return {class: 'certified', source: 'class', certificate_id: certificate.certificate_id};
  return reference('uncertified');
}
const ESCALATION_ADMISSION = Object.freeze({class: 'reference', source: 'escalation', certificate_id: null});
/** The routing-reason token that names the admission. */
function admissionToken(admission) {
  return admission.class === 'reference' ? 'admitted_reference_' + admission.source :
    admission.source === 'class' ? 'admitted_certified_class:' + admission.certificate_id :
      'admitted_certified_' + admission.source;
}
/** The rows one pool offers a certified descent, as ordered entries: the
 * certificate's own tuple (c), else the cheapest tier list (a, b). A contract
 * binds an agent surface only (its start tree is the host workspace, which a
 * tool-free chat lane does not run in); a verifier only the surface kinds it
 * is registered for, so it judges every answer it admitted. */
function certifiedEntries(pool, admission, catalog, verifierRegistry) {
  if (admission.source === 'class') {
    const certificate = catalog.class_certificates[catalog.request_class];
    return [{index: 0, rows: pool.rows.filter(({candidate}) => providerOfPool(candidate.quota_pool) === certificate.provider &&
      candidate.model === certificate.model && candidate.effort === certificate.effort)}];
  }
  const kinds = admission.source === 'contract' ? ['agent'] : admission.source === 'exact' ? ['agent', 'chat'] :
    verifiedSurfaceKinds(verifierRegistry);
  const rows = pool.rows.filter(({candidate}) => kinds.includes(surfaceKind(candidate.surface)) &&
    (!stagedWriterContract(catalog.task_contract) || (candidate.surface === 'codex' && candidate.transport === 'codex_app_server')));
  return TIER_ROUTES[CERTIFIED_CLASS].map(([tier, effort], index) =>
    ({index, rows: entryRows(rows, {tier, effort}, catalog, catalog?.routing_intent_v2 ?? null)}));
}
function surfaceToken(candidate) {
  return {chat: 'chat_lane_same_route', local: 'local_exact'}[surfaceKind(candidate.surface)] ?? 'agent_surface';
}

/** An explicit route that names the local surface (route-all, 2026-10-14)
 * binds the one dispatchable local model row: the model OpenClaw already runs,
 * read-only and tools-free, with no quota pool. No tier list or REVAS
 * escalation applies: the owner named this surface and nothing else stands in
 * for it (a re-resolution that must avoid the row holds). */
function localRouteCandidate(node, task, catalog, now, {avoidIDs = []} = {}) {
  assert(node.kind === 'agent' && node.scope === 'read_only' && (node.owned_paths ?? []).length === 0,
    'explicit_local_route_scope_invalid');
  const rows = catalog.candidates.filter(c => hostRoutable(c) && localWorkerRow(c) && !avoidIDs.includes(c.id));
  const chosen = rows.find(c => dispatchable(c, task, now));
  if (!chosen)
    throw new RCCRuntimeError('no_dispatchable_candidate:read_only:local_' + (rows.length ? 'undispatchable' : 'unavailable'));
  return {candidate: chosen, why: ['route_explicit', 'explicit_route_surface_local', 'admitted_reference_owner_words',
    'local_model'].join(';'), widened: false, kind: 'explicit', tier: null, routeClass: 'deep',
    referenceEffort: chosen.effort, ladder: null};
}

/** Pick the exact row for one node on a tier-routed catalog, by the one
 * admission law (admittedRoute). A reference node binds the reference (or the
 * reference the owner's words leave) of the first pool, in R11 order, whose
 * reference can dispatch; within a pool a read-only node takes the gated chat
 * row of the same model and effort first. A certified read-only node binds its
 * certified tuple only when some pool's reference can dispatch now: that
 * reference (this pool's, else another's) is its one escalation, fixed here
 * and admitted with the plan; otherwise it binds the reference itself.
 * `referenceOnly` binds the reference (an escalation and its re-resolution).
 * An explicit route test binds each node on its own named surface only, with
 * that route's own words: never another surface or pool.
 *
 * R11 among equal-quality offers: an avoided pool last and an escalation's own
 * pool first (host-internal), then the class provider pin, then the pool whose
 * surface resumes this conversation's native session, then the quota of the
 * row that would actually bind (catalog quota_scores; unknown last), then the
 * catalog's pool order. The owner's provider word already shaped the catalog.
 *
 * The route is 'reference' (no owner words), 'explicit' (the reference the
 * owner's words leave) or 'tier' (a certified descent, carrying `ladder`). */
function tierRouteCandidate(node, task, catalog, now, {avoidPool = null, avoidIDs = [], widenWrites = false,
                            referenceOnly = false, preferPool = null, verifierRegistry = null} = {}) {
  const explicitRoute = explicitRouteOf(node, task, catalog);
  if (explicitRoute?.surface === 'local') return localRouteCandidate(node, task, catalog, now, {avoidIDs});
  const intent = explicitRoute ? explicitRoute.intent : routingIntent(catalog);
  const admission = referenceOnly ? ESCALATION_ADMISSION : admittedRoute(node, task, catalog, now, {verifierRegistry});
  const ordinal = new Map();
  for (const c of catalog.candidates) if (!ordinal.has(c.quota_pool)) ordinal.set(c.quota_pool, ordinal.size);
  const usable = row => !avoidIDs.includes(row.candidate.id) && dispatchable(row.candidate, task, now);
  const chatFirst = row => node.scope === 'read_only' && row.candidate.surface.endsWith('-chat') ? 0 : 1;
  const order = (a, b) => (tierRank(catalog, a.candidate.model) - tierRank(catalog, b.candidate.model)) ||
    (chatFirst(a) - chatFirst(b)) || (a.index - b.index);
  const best = rows => rows.filter(usable).sort(order)[0] ?? null;
  const pin = plain(catalog.class_provider_pins) ? catalog.class_provider_pins[catalog.request_class] ?? null : null;
  const pinned = pool => pin !== null && providerOfPool(pool) === pin;
  const affine = pool => (pool === 'openai_codex' && task.host_context?.codex_session_id != null) ||
    (pool === 'anthropic_shared' && task.host_context?.claude_session_id != null);
  const r11Keys = pool => [avoidPool !== null && pool === avoidPool ? 1 : 0, preferPool !== null && pool === preferPool ? 0 : 1,
    pinned(pool) ? 0 : 1, affine(pool) ? 0 : 1];
  const r11 = (a, b) => { const x = r11Keys(a), y = r11Keys(b); return x.map((v, i) => v - y[i]).find(d => d !== 0) ?? 0; };
  const pools = poolRows(node, catalog, {widenWrites, surface: explicitRoute?.surface ?? null})
    .filter(pool => !stagedWriterContract(catalog.task_contract) || pool.pool === 'openai_codex')
    .sort((a, b) => r11(a.pool, b.pool) || (ordinal.get(a.pool) - ordinal.get(b.pool)));
  // One pass of the pools: each pool's offer is its first entry with a
  // dispatchable row; the offers then rank by R11.
  const serve = (entriesOf, label) => {
    const skipped = [], offers = [];
    let offered = false;
    for (const pool of pools) {
      const rank = 'pool_rank_' + ordinal.get(pool.pool);
      let hit = null, entry = null, poolOffered = false;
      for (const candidateEntry of entriesOf(pool)) {
        if (candidateEntry.rows.length) poolOffered = true;
        hit = best(candidateEntry.rows);
        if (hit) { entry = candidateEntry; break; }
      }
      offered ||= poolOffered;
      if (hit) offers.push({hit, entry, pool, rank, score: quotaScore(catalog, hit.candidate.model)});
      else skipped.push(`skipped_${rank}_${label}_${poolOffered ? 'undispatchable' : 'unavailable'}`);
    }
    if (!offers.length) return {hit: null, offered};
    // Stable: equal or unknown scores keep the order above.
    const scored = offers.map((offer, position) => ({offer, position})).sort((a, b) =>
      r11(a.offer.pool.pool, b.offer.pool.pool) || ((a.offer.score === null) - (b.offer.score === null)) ||
      (a.offer.score !== null && b.offer.score !== null ? b.offer.score - a.offer.score : 0) ||
      (a.position - b.position));
    const passed = scored.slice(1).filter(({position}) => position < scored[0].position)
      .map(({offer}) => `outscored_${offer.rank}`);
    return {...scored[0].offer, skipped: [...skipped, ...passed], offered};
  };
  const referenceOf = pool => intentReferenceRows(pool.rows, catalog, intent);
  const poolNotes = (pool, chosen) => [...(pinned(pool) ? ['pool_class_pin'] : []),
    ...(affine(pool) ? ['pool_conversation_affinity'] : []),
    ...(quotaScore(catalog, chosen.model) !== null ? ['pool_scored_by_bound_model'] : [])];
  const notes = [];
  if (admission.class === 'certified') {
    const tier = serve(pool => certifiedEntries(pool, admission, catalog, verifierRegistry), 'tier');
    const chosen = tier.hit?.candidate ?? null;
    // The one escalation target, fixed now: this pool's reference when it can
    // dispatch, else another pool's.
    const target = chosen && [tier.pool, ...pools.filter(other => other !== tier.pool)
      .sort((a, b) => ordinal.get(a.pool) - ordinal.get(b.pool))].map(other => best(referenceOf(other))).find(Boolean);
    const isReference = chosen && referenceOf(tier.pool).some(row => row.candidate.id === chosen.id);
    if (target && !isReference) {
      const certificate = admission.source === 'class' ? catalog.class_certificates[catalog.request_class] : null;
      const ladder = {source: 'tier', admitted_by: admission.source, certificate_id: admission.certificate_id,
        format_check: certificate?.format_check ?? null,
        ...(admission.source === 'exact' ? {exact_answer: pureArithmetic(node.instruction)} : {}),
        cheap_model: chosen.model, cheap_effort: chosen.effort,
        reference_model: target.candidate.model, reference_effort: target.candidate.effort,
        reference_candidate_id: target.candidate.id};
      const why = ['route_tier', admissionToken(admission)];
      if (admission.source !== 'class') why.push('tier_list_' + tier.entry.index);
      why.push('tier_' + (tierOf(catalog, chosen.model) ?? 'none'), tier.rank, ...tier.skipped, 'effort_' + chosen.effort,
        ...poolNotes(tier.pool.pool, chosen),
        'escalation_reference_' + (target.candidate.quota_pool === tier.pool.pool ? 'same_pool' : 'other_pool'),
        surfaceToken(chosen));
      if (avoidPool !== null) why.unshift(tier.pool.pool === avoidPool ? 'same_pool_only' : 'other_pool');
      return {candidate: chosen, why: why.join(';'), widened: false, kind: 'tier', tier: tierOf(catalog, chosen.model),
        routeClass: CERTIFIED_CLASS, referenceEffort: referenceOf(tier.pool)[0]?.candidate.effort ?? null, ladder};
    }
    // R9: a descent needs a reference that can dispatch now. Without one, or
    // without a dispatchable certified tuple below it, the node binds the
    // reference itself (which holds when no reference can dispatch, R12).
    notes.push(!chosen ? 'certified_tuple_undispatchable' : isReference ? 'certified_tuple_is_reference' :
      'tier_requires_runnable_reference');
  }
  const served = serve(pool => [{index: 0, rows: referenceOf(pool)}], 'reference');
  if (!served.hit)
    throw new RCCRuntimeError(`no_dispatchable_candidate:${node.scope}:` +
      (intent?.model_family || served.offered ? 'deep' : 'reference_unavailable'));
  const {hit, pool, rank, skipped} = served;
  const chosen = hit.candidate;
  const kind = intent ? 'explicit' : 'reference';
  const why = ['route_' + kind];
  if (explicitRoute) why.push('explicit_route_surface_' + explicitRoute.surface.replace(/[^a-z0-9]/g, '_'));
  if (intent?.effort) why.push('intent_effort_' + intent.effort);
  if (intent?.model_family) why.push('intent_family_' + intent.model_family);
  why.push(admissionToken(admission), ...notes, 'tier_' + (tierOf(catalog, chosen.model) ?? 'none'), rank, ...skipped,
    'effort_' + chosen.effort, ...poolNotes(pool.pool, chosen), surfaceToken(chosen));
  if (avoidPool !== null) why.unshift(pool.pool === avoidPool ? 'same_pool_only' : 'other_pool');
  const widened = node.scope === 'workspace_write' && !coversOwnedPaths(chosen, node.owned_paths);
  if (widened) why.push('owned_paths_workspace');
  return {candidate: chosen, why: why.join(';'), widened, kind, tier: tierOf(catalog, chosen.model), routeClass: 'deep',
    referenceEffort: chosen.effort, ladder: null};
}

/** Null when something in an allowed scope can run; otherwise the visible
 * hold reason with, per pool, the failure of its reference rows (on a
 * tier-routed catalog the reference the owner's words leave): a certified
 * descent needs a dispatchable reference too (R9), so nothing below a
 * reference ever counts. */
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
    const probe = {scope, kind: 'agent', owned_paths: []};
    const pools = tiered ? poolRows(probe, catalog, {anyPaths: true}).map(entry => ({pool: entry.pool,
      rows: intentReferenceRows(entry.rows, catalog, intent).map(row => row.candidate)})) :
      poolReferences(probe, catalog, {anyPaths: true}).map(reference => ({pool: reference.pool,
        rows: referenceRows(reference)}));
    for (const entry of pools) {
      if (entry.rows.some(c => dispatchable(c, task, now))) return null;
      if (!entry.rows.length) note(entry.pool, 'no_reference');
      for (const c of entry.rows) note(entry.pool, dispatchFailure(c, task, now).replace(/^candidate_/, ''));
    }
  }
  return 'no_dispatchable_candidate:' + (byPool.size === 0 ? 'no_candidate_in_scope' :
    [...byPool.keys()].sort().map(pool => `${pool}=${[...byPool.get(pool)].sort().join('+')}`).join(','));
}

function routingDecision(routeClass, candidate, reason, ladder = null, tier = undefined) {
  const decision = {route_class: routeClass, resolved_candidate_id: candidate.id, surface: candidate.surface,
    model: candidate.model, effort: candidate.effort, quota_pool: candidate.quota_pool, reason,
    quota_remaining_fraction: candidate.quota_remaining_fraction};
  // Present only for a certified descent with its escalation target, so every
  // other decision keeps its shape. A tier route names both models.
  if (ladder && ladder.reference_candidate_id != null)
    decision.ladder = {cheap_effort: ladder.cheap_effort, reference_effort: ladder.reference_effort,
      cheap_model: ladder.cheap_model, reference_model: ladder.reference_model};
  // Present only on a tier-routed catalog (null for a model with no tier).
  if (tier !== undefined) decision.tier = tier;
  return decision;
}

/** Pick the exact row for one node: the admission law on a catalog that
 * carries model_tiers, the reference route on an older catalog. `widenWrites`
 * lets a writer that named concrete paths bind a whole-workspace row; the
 * caller then records owned_paths ["**"], because a native writer is not
 * confined to the paths a planner listed. */
function selectRouteCandidate(node, task, catalog, now, options = {}) {
  // A deterministic node binds the local exact row on either catalog.
  return modelTiers(catalog) !== null && node.kind !== 'deterministic' ?
    tierRouteCandidate(node, task, catalog, now, options) :
    referenceRouteCandidate(node, task, catalog, now, options);
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
 * the rows and names the route explicit. Nothing below the reference binds. */
function referenceRouteCandidate(node, task, catalog, now, {avoidPool = null, avoidIDs = [], widenWrites = false} = {}) {
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
    const chosen = atReference.candidate, kind = intent ? 'explicit' : 'reference';
    const why = ['route_' + kind];
    if (intent?.effort) why.push('intent_effort_' + intent.effort);
    if (intent?.model_family) why.push('intent_family_' + intent.model_family);
    why.push(rank, ...skipped, 'effort_' + chosen.effort, surfaceToken(chosen));
    if (avoidPool !== null) why.unshift(reference.pool === avoidPool ? 'same_pool_only' : 'other_pool');
    const widened = node.scope === 'workspace_write' && !coversOwnedPaths(chosen, node.owned_paths);
    if (widened) why.push('owned_paths_workspace');
    return {candidate: chosen, why: why.join(';'), widened, kind, routeClass: 'deep',
      referenceEffort: reference.effort, ladder: null};
  }
  throw new RCCRuntimeError('no_dispatchable_candidate:' + node.scope);
}

/** Graded writers on overlapping paths run one after another, in plan order:
 * they would serialize on the workspace lease anyway, and validatePlan rejects
 * unordered overlapping writers. Only host-resolved writers are ordered here;
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
/** Assign each host-resolved node's exact candidate_id deterministically, by
 * the one admission law. A node that already carries a candidate_id was bound
 * by the trusted host adapter (an injected plan), not by a planner, and is
 * kept. An explicit route test on an older catalog (no model_tiers) is never
 * resolved here: its injected plan chose exact rows. On a tier-routed catalog
 * each explicit node (id requested-N, the route's exact payload, no
 * dependencies) binds on that route's own surface only. An injected node's
 * route_class grade is accepted for its shape and ignored: no model-authored
 * grade lowers a tuple (R0). Pure: same input, same output.
 * `now` is the catalog's bind time: a slow planner never changes which pool
 * is chosen. Freshness is enforced again at dispatch, after the pre-dispatch
 * catalog refresh. `routes` is the host's internal record per resolved node:
 * route kind (reference, explicit or tier), the reference effort and, for a
 * certified descent, its ladder (admitting source and escalation row).
 * `verifierRegistry` (Map of family to node verifier) is the R0 (b) source;
 * production registers none. */
export function resolveRoutePlan(plan, task, catalog, now = Date.now(), {verifierRegistry = null} = {}) {
  if ((task.mode === 'explicit_routing_test' && !explicitTierRouting(task, catalog)) ||
      !plain(plan) || !Array.isArray(plan.nodes))
    return {plan, decisions: {}, routes: {}};
  const decisions = {}, routes = {};
  const resolvedIDs = new Set();
  const unboundKeys = PLANNED_NODE_KEYS.filter(key => key !== 'route_class');
  const nodes = plan.nodes.map(node => {
    const graded = plain(node) && Object.hasOwn(node, 'route_class');
    const unbound = plain(node) && !graded && !Object.hasOwn(node, 'candidate_id');
    if (graded || unbound) {
      assert((graded ? keys(node, PLANNED_NODE_KEYS) : keys(node, unboundKeys)) && ID.test(node.id) &&
        SCOPES.has(node.scope) && ['agent', 'deterministic'].includes(node.kind) &&
        allowedPaths(node.owned_paths) && Array.isArray(node.dependencies), 'plan_node_invalid');
      const {route_class: _grade, ...rest} = node;
      const choice = selectRouteCandidate(rest, task, catalog, now, {widenWrites: true, verifierRegistry});
      decisions[node.id] = routingDecision(choice.routeClass, choice.candidate, 'resolver;' + choice.why, choice.ladder,
        choice.tier);
      routes[node.id] = {kind: choice.kind, reference_effort: choice.referenceEffort, ladder: choice.ladder};
      resolvedIDs.add(node.id);
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
    for (const id of serializeGradedWriters(nodes, resolvedIDs))
      decisions[id] = {...decisions[id], reason: decisions[id].reason + ';workspace_writer_serialized'};
  return {plan: {...plan, nodes}, decisions, routes};
}

/** R2: the host scope of a host-built node, decided by code with no planner.
 * Read-only when the host requires it, the owner request runs read-only, the
 * chat lane takes it, or the host's request class is a read-only one (which
 * also counts the request's own resolved read-only scope, so a writer class
 * always has writer rows); otherwise a writer. When unsure, a writer: a
 * wrongly read-only writer is the only scope error that lowers quality. */
function hostScope(task, catalog) {
  return task.host_context.require_read_only === true || catalog.owner_scope === 'read_only' ||
    catalog.chat_lane_eligible === true ||
    (REQUEST_CLASSES.has(catalog.request_class) && !['writer', 'explicit_route'].includes(catalog.request_class)) ?
    'read_only' : 'workspace_write';
}
/** R7: the host-built plan (hostAutoPlan). Auto runs ONE agent node whose
 * instruction is the owner's request byte-exact (a writer owns the whole
 * workspace, a reader nothing; the materials are its context). An explicit
 * route test runs one node per route that still runs, keyed by its original
 * ordinal, with that route's own text; no model grades or rewrites either. A
 * big request runs as one session, as the native reference does (R8). */
export function hostPlan(task, catalog) {
  const scope = hostScope(task, catalog);
  const node = (id, instruction) => ({id, instruction, dependencies: [], kind: 'agent', scope,
    owned_paths: scope === 'workspace_write' ? ['**'] : [], context_refs: [...task.material_refs]});
  const base = {schema: 1, task_id: task.task_id, request_sha256: task.request_sha256};
  if (task.mode !== 'explicit_routing_test') return {...base, nodes: [node('node_0', task.request)], final_node_id: 'node_0'};
  assert(modelTiers(catalog) !== null, 'explicit_route_catalog_untiered');
  const effective = effectiveExplicitRoutes(task);
  return {...base, nodes: task.host_context.explicit_routes.flatMap((route, index) =>
    effective.includes(route) ? [node(explicitRouteNodeID(index), route.instruction)] : [])};
}

/** The private, bounded routing ledger in the Core state directory: one
 * append-only JSONL record per settled attempt, in an owner-only directory
 * (0700) and files (0600), opened without following links or blocking on a
 * special file, rotated to one previous generation at MAX_LEDGER_BYTES. A
 * separate never-rotated failure index keeps every parity failure per
 * (family, model, effort). `stats` counts the verified passes and failures of
 * one family at one model/effort, a diagnostic read for the offline class
 * measurement (no route reads it: admission is R0's certifying sources only);
 * it fails closed (no evidence) on anything it cannot read safely: a torn or
 * foreign line, a missing, invalid or overflowed failure index. Synchronous:
 * callers catch every error. */
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
  const stats = (family, model, effort, referenceEffort) => {
    // Three-argument reads retain the historical diagnostic aggregate only.
    // A bound read names an exact reference and rejects an unbound summary:
    // no old max passes are ever read as ultra evidence.
    const binding = EFFORTS.has(referenceEffort) ? {reference_effort: referenceEffort, reference_model: model} : {};
    const none = {verified_passes: 0, verifier_failures: 0, ...binding};
    const bound = referenceEffort !== undefined;
    if (bound && !EFFORTS.has(referenceEffort)) return none;
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
          if (LEDGER_FAILURE_OUTCOMES.has(record.verifier_outcome)) recorded++;
          if (record.verifier_outcome !== 'pass' || record.execution_verified !== true) continue;
          if (bound) {
            if (record.reference_effort !== referenceEffort || (plain(record.ladder) &&
                Object.hasOwn(record.ladder, 'reference_effort') && record.ladder.reference_effort !== referenceEffort)) continue;
            const models = [];
            if (Object.hasOwn(record, 'reference_model')) models.push(record.reference_model);
            if (plain(record.ladder) && Object.hasOwn(record.ladder, 'reference_model')) models.push(record.ladder.reference_model);
            // Narrow compatibility bridge: legacy route_kind=ladder was
            // contractually SAME MODEL, so its model supplies that relation.
            // Generic/reference/tier records without a model binding do not.
            // reference_effort is never inferred from the execution effort.
            if (models.length === 0 && record.route_kind === 'ladder') models.push(record.model);
            if (models.length === 0 || models.some(value => value !== model)) continue;
          }
          passes++;
        }
      }
      return {verified_passes: passes,
        verifier_failures: Math.max(recorded, failures.failures[failureKey(family, model, effort)] ?? 0), ...binding};
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
 * applied to the rows (optional, absent without one): its exact effort
 * overrides the automatic reference, never silently substitutes another. */
function validRoutingIntent(intent) {
  return keys(intent, ['effort', 'model_family']) &&
    (intent.effort === null || INTENT_EFFORTS.has(intent.effort)) &&
    (intent.model_family === null || (typeof intent.model_family === 'string' && INTENT_FAMILY.test(intent.model_family))) &&
    (intent.effort !== null || intent.model_family !== null);
}
function validRoutingIntentV2(intent) {
  return keys(intent, ['version', 'allowed_surfaces', 'exact_model', 'model_family', 'effort',
    'require_native_ceiling', 'quality_target', 'state']) && intent.version === INTENT_V2_VERSION &&
    Array.isArray(intent.allowed_surfaces) && intent.allowed_surfaces.length <= 3 &&
    new Set(intent.allowed_surfaces).size === intent.allowed_surfaces.length &&
    intent.allowed_surfaces.every(x => ['codex', 'claude', 'claude-chat'].includes(x)) &&
    (intent.exact_model === null || boundedText(intent.exact_model, 256)) &&
    (intent.model_family === null || ['fable', 'opus', 'sonnet', 'haiku', 'sol', 'luna', 'terra', 'astra', 'daybreak'].includes(intent.model_family)) &&
    !(intent.exact_model !== null && intent.model_family !== null) &&
    (intent.effort === null || EFFORTS.has(intent.effort)) &&
    typeof intent.require_native_ceiling === 'boolean' && !(intent.require_native_ceiling && intent.effort !== null) &&
    (intent.quality_target === null || intent.quality_target === 'current_host_reference') &&
    ['resolved', 'unresolved'].includes(intent.state);
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
/** Optional native inventory evidence: provider -> exact offered model ->
 * highest known supported effort, BEFORE signed-profile/availability filters.
 * It may explain a missing executable tuple but never creates one. Require
 * every offered native model, reject orphan keys and ceilings below an
 * admitted row. Local deterministic/model rows have no native provider map. */
function validNativeReferenceEfforts(ceilings, candidates) {
  if (!plain(ceilings)) return false;
  const providers = Object.entries(ceilings);
  if (providers.length > 2 || providers.some(([provider, models]) =>
    !EXCLUSION_PROVIDERS.has(provider) || !plain(models) || Object.keys(models).length === 0)) return false;
  const offered = new Map();
  for (const candidate of candidates) {
    const provider = providerOfPool(candidate?.quota_pool);
    if (!EXCLUSION_PROVIDERS.has(provider)) continue;
    offered.set(`${provider}\0${candidate.model}`, true);
    if (!Object.hasOwn(ceilings, provider) || !Object.hasOwn(ceilings[provider], candidate.model) ||
        !EFFORTS.has(ceilings[provider][candidate.model]) ||
        EFFORT_ORDER.indexOf(ceilings[provider][candidate.model]) < EFFORT_ORDER.indexOf(candidate.effort)) return false;
  }
  let count = 0;
  for (const [provider, models] of providers) for (const [model, effort] of Object.entries(models)) {
    if (++count > 256 || !boundedText(model, 256) || !offered.has(`${provider}\0${model}`) || !EFFORTS.has(effort)) return false;
  }
  return true;
}
/** Optional (build 407, R0/R2/R11): host facts for the admission law.
 * owner_scope, chat_lane_eligible and request_class travel together and
 * agree; a task contract, class certificate or provider pin exists only
 * beside them and keys this request (and its class) only. A catalog without
 * them is older and binds the reference. */
function validAdmissionFacts(catalog, task) {
  const present = ['owner_scope', 'chat_lane_eligible', 'request_class'].map(key => catalog[key] !== undefined);
  if (!present.some(Boolean))
    return catalog.task_contract === undefined && catalog.class_certificates === undefined &&
      catalog.class_provider_pins === undefined;
  const cls = catalog.request_class, chat = catalog.chat_lane_eligible;
  if (!present.every(Boolean) || !SCOPES.has(catalog.owner_scope) || typeof chat !== 'boolean' ||
      !REQUEST_CLASSES.has(cls) || (cls === 'explicit_route') !== (task.mode === 'explicit_routing_test')) return false;
  if (cls === 'writer' && (catalog.owner_scope !== 'workspace_write' || chat ||
      task.host_context?.require_read_only === true)) return false;
  if ((cls === 'chat_explanatory' || cls === 'text_operation') && !chat) return false;
  if (cls === 'readonly_material' && !(Array.isArray(task.material_refs) && task.material_refs.length > 0)) return false;
  return (catalog.task_contract === undefined || validTaskContract(catalog.task_contract, catalog, task)) &&
    (catalog.class_certificates === undefined || validClassCertificates(catalog.class_certificates, cls)) &&
    (catalog.class_provider_pins === undefined ||
      (cls !== 'explicit_route' && keys(catalog.class_provider_pins, [cls]) &&
       EXCLUSION_PROVIDERS.has(catalog.class_provider_pins[cls])));
}
/** An owner contract the host re-bound at catalog time to exactly this
 * request, context and reference policy (R0(a)). */
function stagedWriterContract(c) {
  return plain(c) && c.coverage === 'full' && c.scope === 'workspace_write' && c.source_sha256 == null &&
    c.execution_isolation === 'codex_fresh_local_effects_v1' && HASH.test(c.execution_isolation_sha256 ?? '') &&
    HASH.test(c.staged_writer_envelope_sha256 ?? '') && HASH.test(c.staged_writer_base_sha256 ?? '') &&
    c.staged_writer_envelope_sha256 === c.execution_isolation_sha256;
}
function validTaskContract(contract, catalog, task) {
  const required = ['coverage', 'scope', 'objective_sha256', 'contract_sha256', 'context_sha256',
    'start_tree_sha256', 'reference_policy_sha256', 'valid_until_ms', 'bindings_checked'];
  return plain(contract) && required.every(key => Object.hasOwn(contract, key)) &&
    Object.keys(contract).every(key => required.includes(key) || ['source_sha256', 'execution_isolation', 'execution_isolation_sha256', 'staged_writer_envelope_sha256', 'staged_writer_base_sha256'].includes(key)) &&
    ((contract.execution_isolation == null && contract.execution_isolation_sha256 == null) ||
      (contract.execution_isolation === 'codex_fresh_local_effects_v1' && HASH.test(contract.execution_isolation_sha256 ?? '') && contract.source_sha256 == null)) &&
    ((contract.staged_writer_envelope_sha256 == null && contract.staged_writer_base_sha256 == null) || stagedWriterContract(contract)) &&
    ['partial', 'full'].includes(contract.coverage) && SCOPES.has(contract.scope) &&
    contract.bindings_checked === true && contract.objective_sha256 === catalog.request_sha256 &&
    [contract.contract_sha256, contract.context_sha256, contract.start_tree_sha256,
      contract.reference_policy_sha256].every(value => typeof value === 'string' && HASH.test(value)) &&
    (contract.source_sha256 == null || (typeof contract.source_sha256 === 'string' && HASH.test(contract.source_sha256))) &&
    int(contract.valid_until_ms, 1, Number.MAX_SAFE_INTEGER) &&
    contract.reference_policy_sha256 === task.policy_sha256 &&
    contract.context_sha256 === sha(Buffer.from(task.host_context?.context ?? ''));
}
/** The signed class table's certificate for this request's class only (R0(c)). */
function validClassCertificates(certificates, cls) {
  const certificate = plain(certificates) ? certificates[cls] : undefined;
  return CERTIFIABLE_CLASSES.has(cls) && keys(certificates, [cls]) &&
    keys(certificate, ['certificate_id', 'provider', 'model', 'effort', 'format_check', 'measurement_sha256']) &&
    typeof certificate.certificate_id === 'string' && ID.test(certificate.certificate_id) &&
    EXCLUSION_PROVIDERS.has(certificate.provider) && boundedText(certificate.model, 256) &&
    EFFORTS.has(certificate.effort) && certificate.effort !== 'none' &&
    typeof certificate.format_check === 'string' && FORMAT_CHECK.test(certificate.format_check) &&
    typeof certificate.measurement_sha256 === 'string' && HASH.test(certificate.measurement_sha256);
}
function validateCatalog(catalog, task) {
  const required = ['schema', 'task_id', 'request_sha256', 'candidates'];
  const optional = ['exclusions', 'routing_intent', 'routing_intent_v2', 'model_tiers', 'explicit_route_intents', 'quota_scores',
    'native_reference_efforts', 'owner_scope', 'chat_lane_eligible', 'request_class', 'task_contract',
    'class_certificates', 'class_provider_pins'];
  assert(plain(catalog) && required.every(key => Object.hasOwn(catalog, key)) &&
    Object.keys(catalog).every(key => required.includes(key) || optional.includes(key)) &&
    catalog.schema === 1 && catalog.task_id === task.task_id &&
    catalog.request_sha256 === task.request_sha256 && Array.isArray(catalog.candidates) &&
    catalog.candidates.length <= 256 &&
    (catalog.exclusions === undefined || validExclusions(catalog.exclusions)) &&
    (catalog.routing_intent === undefined || validRoutingIntent(catalog.routing_intent)) &&
    (task.routing_intent_policy_version == null ? catalog.routing_intent_v2 === undefined :
      activeIntentV2(task, catalog) && catalog.routing_intent === undefined &&
      catalog.native_reference_efforts !== undefined && catalog.model_tiers !== undefined) &&
    (catalog.model_tiers === undefined || validModelTiers(catalog.model_tiers, catalog.candidates)) &&
    (catalog.explicit_route_intents === undefined || validExplicitRouteIntents(catalog.explicit_route_intents, task)) &&
    (catalog.quota_scores === undefined || validQuotaScores(catalog.quota_scores, catalog.candidates)) &&
    (catalog.native_reference_efforts === undefined ||
      validNativeReferenceEfforts(catalog.native_reference_efforts, catalog.candidates)) &&
    validAdmissionFacts(catalog, task) &&
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

// Wrapped exact arithmetic (2026-10-15). A plain Auto "1+1이 뭐야?" ran Codex
// gpt-6-luna/low (29K input tokens) and still ended returned_unverified
// (no_registered_exact_task_verifier): the bare-expression gate above missed
// the question wording around the same exact sum. Only these closed whole-
// request shapes take Core's zero-model exact route; any other word, a number
// word, an operator word, division, a decimal, a second operator or a second
// expression abstains (null) and stays with the models.
const WRAPPED_EXPRESSION = /^(\d{1,15}) ?([+*]) ?(\d{1,15})/;
// EXPR, an optional subject/topic particle, an optional closed predicate.
const KOREAN_ARITHMETIC_SUFFIX = new RegExp('^ ?(?:(은|는|이|가) ?)?(뭐야|뭐냐|뭐니|뭐지|뭐죠|뭐예요|뭐에요|뭔가요|' +
  '얼마야|얼마냐|얼마지|얼마죠|얼마예요|얼마에요|얼마인가요|몇이야|몇이냐|몇이지|몇이에요)?$', 'u');
// The typographic apostrophe is the same word (macOS/iOS smart punctuation).
const ENGLISH_ARITHMETIC_PREFIX = /^(?:what is|what's|what’s|how much is) /u;
/** The exact answer of a whole request that only asks one sum or product, or
 * null. Shapes (after NFKC, '×' as '*', collapsed whitespace, lowercase, at
 * most 160 characters, one trailing run of ?!.。？！ removed):
 *  (a) a bare expression exactly as pureArithmetic reads it ('-' included)
 *      when nothing was removed; with a removed question/end mark only + or *;
 *  (b) EXPR + an optional particle (은|는|이|가) + an optional closed Korean
 *      predicate; a particle alone needs the '?' ("2+2는?");
 *  (c) a closed English prefix (what is | what's | how much is) + EXPR;
 *  (d) EXPR followed by '=' ("1+1=", "1+1=?").
 * Every wrapped shape takes + or * only and unsigned operands: a hyphen next
 * to words reads as a section, score or range ("5-3은?", "3-4?"). A
 * compatibility character other than a fullwidth form that folds into a
 * digit or operator abstains: NFKC turns the exponent in "2²+1" into "22+1".
 * A '!' right after a digit abstains: "2+3!" is factorial notation. */
export function exactArithmeticQuestion(request) {
  if (typeof request !== 'string') return null;
  for (const ch of request) {
    const folded = ch.normalize('NFKC');
    if (folded !== ch && !/^[\uFF00-\uFFEF\u3000]$/u.test(ch) && /[0-9+*=-]/.test(folded)) return null;
  }
  let text = request.normalize('NFKC').replace(/×/gu, '*').replace(/\s+/gu, ' ').trim().toLowerCase();
  if (text.length > 160 || /\d!/.test(text)) return null;
  const end = /[?!.。？！]+$/u.exec(text);
  const question = end !== null && /[?？]/u.test(end[0]);
  if (end) text = text.slice(0, end.index).trim();
  if (!end) {
    const bare = pureArithmetic(text);
    if (bare !== null) return bare;
  }
  const prefix = ENGLISH_ARITHMETIC_PREFIX.exec(text);
  const body = prefix ? text.slice(prefix[0].length) : text;
  const expression = WRAPPED_EXPRESSION.exec(body);
  if (!expression) return null;
  const rest = body.slice(expression[0].length);
  const answer = pureArithmetic(`${expression[1]}${expression[2]}${expression[3]}`);
  // (c): nothing may follow the expression.
  if (prefix) return rest === '' ? answer : null;
  // (a) with a removed mark, and (d).
  if (rest === '' || /^ ?=$/u.test(rest)) return answer;
  // (b): a particle or a predicate (the empty suffix was (a) above).
  const korean = KOREAN_ARITHMETIC_SUFFIX.exec(rest);
  if (!korean) return null;
  return korean[2] !== undefined || question ? answer : null;
}

/** Whether a task carries no earlier conversation that could give its words
 * another meaning (a product label, a score, a promotion): no context text on
 * the task or the host, and no native session the host would resume. Every
 * zero-model path requires it (R1). */
function withoutConversation(task) {
  const h = task.host_context;
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
  if (task.native_sessions != null && Object.keys(task.native_sessions).length !== 0) return false;
  const empty = raw => {
    if ((raw ?? '').trim() === '') return true;
    // GUI paging envelopes carry bookkeeping even on the first turn. Keep
    // those bytes intact; distinguish that metadata from retained semantics.
    // Require the current compact host encoding. A duplicate key, alternate
    // numeric spelling or unknown field abstains instead of erasing history.
    let x;
    try { x = JSON.parse(raw); } catch { return false; }
    if (JSON.stringify(x) !== raw || !plain(x) ||
        Object.keys(x).some(k => !['format', 'transcript', 'source', 'taskContext', 'memoryPaging', 'priorMessageCount'].includes(k)) ||
        x.format !== 'os1-session-handoff-v3' || x.priorMessageCount !== 0 ||
        x.transcript !== '' || x.source != null) return false;
    const c = x.taskContext;
    if (c != null) {
      if (!plain(c) || c.schemaVersion !== 1 || !uuid(c.conversationID) || !uuid(c.objectiveID) ||
          !int(c.contextRevision, 0, Number.MAX_SAFE_INTEGER) ||
          (c._semanticRevision !== undefined && !int(c._semanticRevision, 0, Number.MAX_SAFE_INTEGER)) ||
          !['createdAt', 'updatedAt'].every(k => typeof c[k] === 'string' && boundedText(c[k], 64)) ||
          Object.keys(c).some(k => !['schemaVersion', 'createdAt', 'updatedAt', 'contextRevision', '_semanticRevision',
            'conversationID', 'objectiveID', 'project', 'objective', 'facts', 'sources', 'bindings', 'executions',
            'decisions', 'blockers', 'nextSteps'].includes(k)) ||
          !['facts', 'sources', 'bindings', 'executions', 'decisions', 'blockers', 'nextSteps']
            .every(k => Array.isArray(c[k]) && c[k].length === 0) ||
          !plain(c.objective) || c.objective.requestText !== task.request ||
          c.objective.kind !== 'other' || c.objective.scope !== 'read_only' ||
          Object.keys(c.objective).some(k => !['requestText', 'kind', 'scope', 'prohibitions', 'pendingDecisions', 'completionConditions'].includes(k)) ||
          !['prohibitions', 'pendingDecisions', 'completionConditions']
            .every(k => Array.isArray(c.objective[k]) && c.objective[k].length === 0) ||
          (c.project != null && (!plain(c.project) || Object.keys(c.project).some(k => !['projectID', 'workspace'].includes(k)) ||
            !boundedText(c.project.projectID, 256) || typeof c.project.workspace !== 'string' || c.project.workspace !== h.workspace))) return false;
      if (h.conversation_id != null && (typeof c.conversationID !== 'string' || c.conversationID.toLowerCase() !== h.conversation_id.toLowerCase())) return false;
    }
    if (x.memoryPaging != null) {
      const m = x.memoryPaging;
      if (!keys(m, ['snapshot', 'projectID', 'archivedMessages', 'allowedSessionIDs', 'conversationID']) ||
          !boundedText(m.projectID, 256) || !uuid(m.conversationID) ||
          !Array.isArray(m.allowedSessionIDs) || m.allowedSessionIDs.length > 4096 ||
          new Set(m.allowedSessionIDs).size !== m.allowedSessionIDs.length ||
          !m.allowedSessionIDs.every(uuid) || !m.allowedSessionIDs.some(id => id.toLowerCase() === m.conversationID.toLowerCase()) ||
          m.archivedMessages !== 1 || !keys(m.snapshot, ['kind', 'id', 'sha256']) ||
          m.snapshot.kind !== 'snapshot' || !uuid(m.snapshot.id) ||
          typeof m.snapshot.sha256 !== 'string' || !HASH.test(m.snapshot.sha256) ||
          (h.conversation_id != null && (typeof m.conversationID !== 'string' || m.conversationID.toLowerCase() !== h.conversation_id.toLowerCase()))) return false;
    }
    return true;
  };
  return empty(task.context) && empty(h.context) && h.codex_session_id === null && h.claude_session_id === null;
}

// Preserve the old exact zero-call greeting only. Liveness classification is
// owned by the existing native StatusCheckIn compiler, not a duplicate Set.
function exactLocalGreeting(request) {
  const value = request.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    .replace(/\s*([.!?])\s*/gu, '$1').toLowerCase();
  return value === 'hello' ? 'Yes. This local OS-1 request-and-response path is working.' : null;
}
function localResponsePathOutput(request) {
  return /[가-힣]/u.test(request) ? '응, 지금 OS-1 로컬 요청·응답 경로는 살아 있어.' :
    'Yes. This local OS-1 request-and-response path is working.';
}

/** An ordinary plan declares either one final worker or Core collection.
 * This is graph/source validation, never a content judge. A final worker
 * consumes all work; explicit null collects all separately requested outputs.
 * Authored collections must be independent. Core may subsequently add writer
 * safety ordering, without changing ownership or discarding any output.
 * Explicit route tests already collect every independent requested route.
 * Legacy single-node omission remains readable; no multi-node owner is ever
 * inferred from array order, a unique sink, or agreement between answers. */
export function assertFinalOutputOwnership(plan, task, {collectionMayBeOrdered = false} = {}) {
  assert(plain(plan) && Array.isArray(plan.nodes) && plan.nodes.length > 0 &&
    plan.nodes.length <= 8, 'plan_final_ownership_invalid');
  const final = plan.final_node_id;
  if (task?.mode === 'explicit_routing_test') {
    assert(final === undefined || final === null, 'explicit_route_final_forbidden');
    return plan;
  }
  const byID = new Map();
  for (const node of plan.nodes) {
    assert(plain(node) && typeof node.id === 'string' && ID.test(node.id) && !byID.has(node.id) &&
      Array.isArray(node.dependencies) && node.dependencies.length <= 8 &&
      node.dependencies.every(id => typeof id === 'string' && ID.test(id)) &&
      new Set(node.dependencies).size === node.dependencies.length, 'plan_final_ownership_invalid');
    byID.set(node.id, node);
  }
  for (const node of byID.values())
    assert(node.dependencies.every(id => byID.has(id) && id !== node.id), 'plan_dependency_invalid');
  const visiting = new Set(), visited = new Set();
  function walk(id, closure) {
    if (closure.has(id)) return;
    assert(!visiting.has(id), 'plan_cycle'); visiting.add(id);
    for (const parent of byID.get(id).dependencies) walk(parent, closure);
    visiting.delete(id); closure.add(id);
  }
  for (const id of byID.keys()) walk(id, visited);
  if (final === undefined) {
    assert(plan.nodes.length === 1, 'plan_final_node_required');
    return plan;
  }
  if (final === null) {
    assert(collectionMayBeOrdered || plan.nodes.every(node => node.dependencies.length === 0),
      'plan_collection_has_dependencies');
    return plan;
  }
  assert(typeof final === 'string' && ID.test(final) && byID.has(final), 'plan_final_node_unknown');
  const covered = new Set(); walk(final, covered);
  assert(covered.size === byID.size, 'plan_final_coverage_incomplete');
  return plan;
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
  // Planner independence was checked before host writer serialization.
  // Candidate-only rebindings preserve the admitted graph/ownership.
  assertFinalOutputOwnership(plan, task, {collectionMayBeOrdered: true});
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
 * quota rejection, and the routing server's refusal of the exact tuple, did
 * no work and are not charged for a host-resolved node, whose moves are
 * bounded by MAX_RE_RESOLUTIONS instead; any other node gets at most one
 * such free attempt, as the legacy runner's quota limit did.
 * The one cheaper ladder attempt whose verifier failed is the Core's own
 * bet, not the owner's: its single reference re-dispatch is never charged. */
function chargedAttempts(child, resolver) {
  const history = child.attempt_history ?? [];
  const free = history.filter(entry => entry.state === 'verified_not_dispatched' &&
    UNCHARGED_PRE_EXECUTION_ERRORS.has(entry.error)).length;
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
  const routes = executionTask(snapshot).host_context?.explicit_routes;
  if (executionTask(snapshot).mode !== 'explicit_routing_test' || !Array.isArray(routes)) return null;
  const ordinal = /^requested-([1-8])$/.exec(child.id);
  if (ordinal) {
    const route = routes[Number(ordinal[1]) - 1];
    if (route?.instruction === child.instruction) return route.surface;
  }
  const candidate = snapshot.catalog?.candidates.find(row => row.id === child.candidate_id);
  return routes.find(route => route.surface === candidate?.surface &&
    route.instruction === child.instruction)?.surface ?? null;
}

function publicResourceUsage(snapshot) {
  const s = summarizeTaskResources(snapshot);
  return {schema: 1, accounting_complete: s.accounting_complete,
    total_tokens_observed: s.total_tokens_observed,
    local_tokens_observed: s.local.total_tokens_observed, native_tokens_observed: s.native.total_tokens_observed,
    local_calls_started: s.local.calls_started, local_calls_settled: s.local.calls_settled,
    local_worker_attempts: s.local.worker.attempts, native_attempts: s.native.attempts,
    plan_model_calls: s.plan.model_calls, issues: s.issues,
    quota_savings: s.quota_savings, cash_cost: s.cash_cost,
    accounting_scope: 'observed_attempts_as_of_snapshot_not_future_cost'};
}
function publicSnapshot(snapshot) {
  return { schema: 1, task_id: snapshot.task.task_id,
    request_sha256: snapshot.task.request_sha256, state: snapshot.state,
    revision: snapshot.revision,
    // Observation only: never an adoption, routing score, quota percentage or
    // dollar estimate. Includes failed attempts; unknown usage remains unknown.
    resource_usage: publicResourceUsage(snapshot),
    children: snapshot.children.map(child => {
      const {id, state, attempt_id, candidate_id, selected_config,
        instruction, dependencies, started_at_ms, finished_at_ms, native_receipt, output} = child;
      return {id, state, attempt_id, candidate_id, selected_config,
        requested_surface: requestedSurface(snapshot, child), instruction, dependencies,
        started_at_ms, finished_at_ms, native_receipt,
        output_summary: typeof output === 'string' ? output.slice(0, 600) : null,
        // Why the host chose this exact row. Older snapshots have none.
        routing_decision: child.routing_decision ? immutable(child.routing_decision) : null,
        // R6: why a delivered output is not task-verified (present only then).
        ...(child.quality_disclosure ? {quality_disclosure: immutable(child.quality_disclosure)} : {})};
    }),
    result: snapshot.result ? immutable(snapshot.result) : null,
    install_handoff: snapshot.install_handoff ? immutable(snapshot.install_handoff) : null,
    ...(snapshot.intent_resolution_state ? {routing_intent: {
      state: snapshot.intent_resolution_state,
      notices: immutable(snapshot.intent_resolution?.notices ?? []),
      reason: snapshot.intent_resolution?.reason ?? snapshot.intent_resolution_error ?? null,
      resolution_sha256: snapshot.effective_task?.core_routing?.resolution_sha256 ?? null}} : {}),
    // A best-effort route test's routes Core did not run, with the reason.
    ...(Array.isArray(snapshot.skipped_routes) && snapshot.skipped_routes.length ? {
      skipped_routes: snapshot.skipped_routes.map(({surface, instruction, reason}) => ({surface, instruction, reason}))} : {}),
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
/** A certified descent bound below its reference that still has its one
 * escalation (R9). */
function pendingEscalation(child) {
  return child?.route_kind === 'tier' && child.ladder != null && child.ladder.escalated !== true;
}
/** A certified descent's structural failure signals: an output that is only
 * whitespace, or a failure the native adapter recorded beside a finished
 * attempt (a failed task quality is already undeliverable). */
function stagedWriterDiscarded(result) {
  return result?.staged_writer?.state === 'discarded' && result.error === 'native_staged_writer_discarded' &&
    result.side_effects === 'none' && result.native_turn_terminated === true;
}
function tierFailureSignal(result) {
  return typeof result.output !== 'string' || result.output.trim() === '' || result.error != null;
}
/** R9: whether the source that admitted a certified descent accepts THIS
 * answer. (a) the owner contract verified it with full coverage; (b) it is
 * structurally sound, and the registered verifier then decides; (c) it is
 * structurally sound and passes the certificate's own format check. Under
 * any source an operational check that ran partially, could not verify or
 * failed is no acceptance. A descent recorded without its admitting source
 * (an older build) is never accepted: it escalates. */
function certifiedAnswer(ladder, result) {
  if (tierFailureSignal(result)) return false;
  if (result.selected_config?.scope === 'workspace_write' && result.staged_writer?.state !== 'applied') return false;
  const q = result.operational_quality;
  if (q && (q.coverage !== 'full' || ['unverified', 'mismatch'].includes(q.assessment_state))) return false;
  switch (ladder?.admitted_by) {
    case 'contract': return result.task_verified === true && q?.coverage === 'full' &&
      q.assessment_state === 'task_contract_verified';
    case 'verifier': return true;
    case 'class': return Object.hasOwn(FORMAT_CHECKS, ladder.format_check) && FORMAT_CHECKS[ladder.format_check](result.output);
    case 'exact': return typeof ladder.exact_answer === 'string' && result.output.trim() === ladder.exact_answer;
    default: return false;
  }
}
/** R6: a completed result of a node bound at its reference (or at an
 * owner-chosen tuple) whose check failed or whose checker was unavailable is
 * delivered, never held or nulled: the turn ended, it returned an output, and
 * nothing beyond its own scope's effects was reported (a read-only answer
 * reported none). Holds remain for reported or uncertain effects, unterminated
 * turns and cancel. */
function disclosable(result, scope) {
  return result.status === 'succeeded' && result.dispatch_stage === 'dispatched' && result.execution_verified === true &&
    result.native_turn_terminated === true && boundedText(result.output, MAX_OUTPUT_BYTES) &&
    result.handback == null && result.repair_source == null &&
    (scope === 'workspace_write' || result.side_effects === 'none');
}
/** The disclosure a delivered unverified output carries (Swift
 * QualityDisclosure): the operational check's coverage, the checks that
 * failed and its witness, or a checker that was unavailable. A failed node
 * verifier names itself in failed_check_ids ('node_verifier'), which alone
 * is a complete disclosure when no operational check ran. */
function qualityDisclosure(result, checkerUnavailable) {
  const q = result.operational_quality ?? null;
  return {coverage: q?.coverage ?? null, failed_check_ids: (q?.failed_check_ids ?? []).slice(0, MAX_DISCLOSED_CHECKS),
    witness_sha256: q?.witness_sha256 ?? null, ...(checkerUnavailable ? {checker: 'unavailable'} : {})};
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
  return Date.now() - executionTask(snapshot).budget.max_duration_ms;
}
/** What a returned record attests about its native turn, on its attempt
 * entry: settled_side_effects only when the adapter attested the turn ended
 * (settledReadOnly); a record without the attestation records nothing. */
function recordTurnSettlement(entry, result) {
  if (typeof result.native_turn_terminated !== 'boolean') return;
  entry.native_turn_terminated = result.native_turn_terminated;
  if (result.native_turn_terminated) entry.settled_side_effects = result.side_effects;
}
/** Another child of this task is still running a dispatched attempt. */
function siblingRunning(snapshot, nodeID) {
  return snapshot.children.some(c => c.id !== nodeID && c.state === 'running' && c.dispatched_at_ms !== null);
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
 * native_receipt, selected_config} -> {passed: boolean, reason}): a
 * registration for the certified class is R0's source (b). Production
 * registers none, so every node runs its reference. `hostAutoPlan` (R7): the
 * host builds every plan itself (hostPlan) and never calls `plan`; injected
 * plans (`plan`) remain for fixtures. `ledgerLog` receives a ledger write
 * failure code, which never fails or holds a task. */
export async function createRCCRuntime({stateDir, catalog, plan, execute, executeContinuation, decideOperationalQuality, resolveIntent,
                                         stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
                                         maximumWorkers = 4, maximumReadWorkersPerPool = 1, cancelGraceMs = 5_000,
                                         verifierRegistry = null, hostAutoPlan = false, ledgerLog = null,
                                         adaptiveRoutingPolicy = null, proposeLocalPlan, jointRouteEvidence = null,
                                         frozenRoutePredictor = null} = {}) {
  assert(typeof stateDir === 'string' && isAbsolute(stateDir) && !stateDir.includes('/../'), 'state_dir_invalid');
  assert(int(maximumWorkers, 1, 16), 'worker_limit_invalid');
  assert(int(maximumReadWorkersPerPool, 1, maximumWorkers), 'pool_reader_limit_invalid');
  assert(int(cancelGraceMs, 100, 30_000), 'cancel_grace_invalid');
  const registry = verifierRegistry ?? new Map();
  assert(registry instanceof Map && [...registry].every(([family, verify]) =>
    typeof family === 'string' && family.length <= 128 && typeof verify === 'function'), 'verifier_registry_invalid');
  assert(typeof hostAutoPlan === 'boolean', 'host_auto_plan_invalid');
  const adaptivePolicy = decodeAdaptiveRoutingPolicy(adaptiveRoutingPolicy);
  assert(proposeLocalPlan === undefined || typeof proposeLocalPlan === 'function', 'adaptive_planner_invalid');
  assert(jointRouteEvidence === null || typeof jointRouteEvidence === 'function', 'adaptive_joint_evidence_invalid');
  assert(frozenRoutePredictor === null || isFrozenRoutePredictor(frozenRoutePredictor),
    'adaptive_frozen_predictor_not_host_factory');
  assert(adaptivePolicy.mode !== 'shadow' || typeof proposeLocalPlan === 'function', 'adaptive_planner_missing');
  // Descriptor-shaped input cannot register calibrated authority. Until the
  // separate host artifact/admission rollout exists, never activate it by flag.
  assert(adaptivePolicy.mode !== 'covered_live', 'adaptive_live_policy_not_registered');
  assert(ledgerLog === null || typeof ledgerLog === 'function', 'ledger_log_invalid');
  assert(resolveIntent === undefined || typeof resolveIntent === 'function', 'intent_resolver_invalid');
  assert(decideOperationalQuality === undefined || typeof decideOperationalQuality === 'function', 'quality_decider_invalid');
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
    CREATE TABLE IF NOT EXISTS pool_claims (seq INTEGER PRIMARY KEY AUTOINCREMENT, pool_key TEXT NOT NULL,
      task_id TEXT NOT NULL, node_id TEXT NOT NULL, claim_id TEXT NOT NULL UNIQUE, candidate_id TEXT NOT NULL,
      workspace TEXT, mode TEXT NOT NULL, shared INTEGER NOT NULL, binding_sha256 TEXT NOT NULL, phase TEXT NOT NULL, requested_ms INTEGER NOT NULL,
      UNIQUE(pool_key,task_id,node_id));
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
  const runtime = new RCCRuntime({db, token, stateDir, catalog, plan, execute, executeContinuation, decideOperationalQuality, resolveIntent,
                                 stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
                                 maximumWorkers, maximumReadWorkersPerPool, cancelGraceMs,
                                 transaction, verifierRegistry: registry, hostAutoPlan, ledger, ledgerLog,
                                 adaptivePolicy, proposeLocalPlan, jointRouteEvidence, frozenRoutePredictor});
  runtime.reconcileRestart();
  runtime.reconcileLedger();
  runtime.startQueued();
  return runtime;
}

class RCCRuntime {
  constructor({db, token, stateDir, catalog, plan, execute, executeContinuation, decideOperationalQuality, resolveIntent,
               stageSelfUpdate, reconcileInstallation, cancelInstallation, verifyTask, emit,
               maximumWorkers, maximumReadWorkersPerPool, cancelGraceMs, transaction, verifierRegistry, hostAutoPlan, ledger,
               ledgerLog, adaptivePolicy, proposeLocalPlan, jointRouteEvidence, frozenRoutePredictor}) {
    this.db = db; this.token = token; this.stateDir = stateDir;
    this.catalog = catalog; this.plan = plan;
    this.execute = execute; this.executeContinuation = executeContinuation;
    this.decideOperationalQuality = decideOperationalQuality;
    this.resolveIntent = resolveIntent;
    this.stageSelfUpdate = stageSelfUpdate;
    this.reconcileInstallation = reconcileInstallation;
    this.cancelInstallation = cancelInstallation;
    this.verifyTask = verifyTask; this.emit = emit;
    this.verifierRegistry = verifierRegistry; this.hostAutoPlan = hostAutoPlan;
    this.adaptivePolicy = adaptivePolicy; this.proposeLocalPlan = proposeLocalPlan;
    this.jointRouteEvidence = jointRouteEvidence;
    this.frozenRoutePredictor = frozenRoutePredictor;
    this.ledger = ledger; this.ledgerLog = ledgerLog;
    // Dispatched attempts whose ledger record is not written yet, with the
    // route facts fixed at dispatch: an attempt that settles after stop is
    // still recorded once, without the closed DB.
    this.ledgerInflight = new Map();
    // Parity failures whose ledger write failed (attempt id -> retry): each
    // later record retries them first, so the failure index stays complete.
    this.ledgerBacklog = new Map();
    this.maximumWorkers = maximumWorkers; this.cancelGraceMs = cancelGraceMs;
    this.transaction = transaction;
    this.runningTasks = new Map(); this.controllers = new Map();
    // The original task's compiler is cancellable work of THIS Core owner,
    // never a second task/queue. Keep it tracked until the actual callback
    // settles, even when a timeout has already held the task.
    this.intentControllers = new Map();
    this.installationObservations = new Map();
    this.poolReservations = new Set(); this.readPoolReservations = new Map(); this.claimReservations = new Map();
    this.maximumReadWorkersPerPool = maximumReadWorkersPerPool; this.activeWriteWorkspaces = new Set();
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
      const routes = heldExplicitRoutes(executionTask(snapshot));
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
        children: [], result: null, install_handoff: null, error: null, spent_cost_units: 0, native_dispatches: 0};
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
      if (state.intent_resolution_state === 'resolving') {
        state.intent_resolution_state = 'held'; state.intent_resolution_error = state.error;
      }
      if (!active) for (const child of state.children)
        if (child.state === 'queued' || child.state === 'waiting') child.state = 'cancelled';
    });
    for (const [attemptID, item] of this.controllers) if (item.taskID === value.task_id)
      item.controller.abort(new RCCRuntimeError('cancel_requested'));
    this.intentControllers.get(value.task_id)?.controller.abort(new RCCRuntimeError('cancel_requested'));
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
    for (const item of this.intentControllers.values())
      item.controller.abort(new RCCRuntimeError('intent_resolution_quiesced'));
    const rows = this.transaction(() => this.db.prepare('SELECT snapshot FROM tasks').all()
      .map(row => JSON.parse(row.snapshot)));
    const active = rows.reduce((count, snapshot) => count + snapshot.children.filter(child =>
      child.state === 'running' && child.dispatched_at_ms !== null).length, 0);
    const inProgress = rows.some(snapshot => ['planning', 'running', 'cancelling'].includes(snapshot.state));
    return {schema: 1, request_id: value.request_id, owner_pid: process.pid,
      active_dispatches: Math.max(active, this.controllers.size) + this.installationObservations.size + this.intentControllers.size,
      queued_preserved: true, queued_tasks: rows.filter(snapshot => snapshot.state === 'queued').length,
      accepting_submissions: false,
      // A prior terminal effects_uncertain row remains durable and unreplayed;
      // it is not evidence that this owner still has a live child process.
      safe_to_stop: !inProgress && this.runningTasks.size === 0 &&
        this.controllers.size === 0 && this.intentControllers.size === 0 &&
        this.activeWorkers === 0 && this.installationObservations.size === 0};
  }

  reconcileRestart() {
    const rows = this.transaction(() => this.db.prepare('SELECT task_id,snapshot FROM tasks').all());
    for (const row of rows) {
      const state = JSON.parse(row.snapshot);
      if (!['planning', 'running', 'cancelling'].includes(state.state)) continue;
      const dispatched = state.children.some(child => child.state === 'running' && child.dispatched_at_ms !== null);
      const pendingContinuation = state.children.some(child =>
        child.state === 'waiting' && (child.continuation?.state === 'pending' ||
          ['decision_pending', 'pending'].includes(child.quality_continuation?.state)));
      const verifierPending = state.children.some(child => verifierPendingChild(child));
      this._update(row.task_id, 'restart_reconciled', snapshot => {
        snapshot.state = dispatched ? 'effects_uncertain' : 'held';
        snapshot.error = dispatched ? 'restart_active_dispatch_no_replay' :
          pendingContinuation ? 'continuation_pending_recovery_required' :
          verifierPending ? 'restart_node_verifier_pending' : 'restart_before_dispatch';
        if (snapshot.intent_resolution_state === 'resolving') {
          snapshot.intent_resolution_state = 'held'; snapshot.intent_resolution_error = snapshot.error;
        }
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
   * cleared, except for a parity failure, which stays pending (and
   * backlogged) so this process and the next restart retry it: the failure
   * index must never lose one. */
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
            task_quality: current ? child.task_quality ?? null : null,
            routing_outcome_summary: this._outcomeSummary(entry?.routing_outcome)}, outcome, settled ? entry.state : 'interrupted',
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
      this._reconcilePoolClaims();
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
      .run(executionTask(snapshot).task_id, snapshot.revision, kind, Date.now(), stable(publicSnapshot(snapshot)));
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

  /** Existing partial-result shape, scoped to exactly the supplied returned
   * children. A failed/missing child supplies neither answer nor execution
   * evidence. This never adopts the quality of the original whole task. */
  async _partialResult(taskID, returned) {
    if (!returned.length) return null;
    const output = returned.map(c => `${c.id}: ${c.output}`).join('\n\n');
    assert(Buffer.byteLength(output) <= MAX_OUTPUT_BYTES, 'partial_output_oversize');
    let receipt;
    try { receipt = await this._aggregateReceipt(taskID, returned, output); }
    catch { throw new RCCRuntimeError('aggregate_receipt_unavailable'); }
    return {output, execution_verified: returned.every(c => c.execution_verified), task_verified: false,
      task_quality: 'execution_only', parity_state: 'unverified', native_receipt: receipt,
      native_summary: returned.length === 1 ? returned[0].native_summary : null,
      native_summaries: returned.flatMap(c => c.native_summaries ??
        (c.native_summary ? [c.native_summary] : []))};
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
      executionTask(snapshot).host_context.require_read_only === false &&
      result.execution_verified && result.status === 'succeeded' &&
      !snapshot.cancel_requested, 'handback_original_authority_unavailable');
    let sourceRoot, workspace;
    try {
      sourceRoot = realpathSync(h.protected_root);
      workspace = realpathSync(executionTask(snapshot).host_context.workspace);
    } catch { throw new RCCRuntimeError('handback_source_root_unavailable'); }
    assert(sourceRoot === h.protected_root && isAbsolute(sourceRoot), 'handback_source_root_not_canonical');
    if (h.kind === 'os1_change_required')
      assert(within(sourceRoot, workspace), 'os1_repair_original_workspace_not_authorized');
    return {sourceRoot, workspace};
  }

  _authorizeRepairSource(snapshot, node, candidate, result) {
    const source = result.repair_source;
    assert(snapshot.plan.nodes.length === 1 && node.kind === 'agent' &&
      node.instruction === executionTask(snapshot).request && node.dependencies.length === 0 &&
      ['codex', 'claude'].includes(candidate.surface) &&
      candidate.scope === 'workspace_write' && candidate.permission_profile === 'workspace_write' &&
      executionTask(snapshot).host_context.require_read_only === false &&
      result.status === 'succeeded' && result.execution_verified &&
      result.side_effects === 'confirmed' && source.source_before_clean === true &&
      !snapshot.cancel_requested, 'repair_source_original_authority_unavailable');
    let sourceRoot, workspace;
    try {
      sourceRoot = realpathSync(source.source_root);
      workspace = realpathSync(executionTask(snapshot).host_context.workspace);
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
      handoff = validateInstallHandoff(response, executionTask(snapshot), node, source, result.attempt_id);
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

  _recordResourceUsage(taskID, event) {
    // This callback is held by Core's intent resolver, never deserialized from
    // a model/tool result. Telemetry cannot rewrite the task or its verdict.
    if (this.closed) return false;
    try {
      validateLocalUsageEvent(event);
      const current = this._load(taskID);
      if (!current) return false;
      const prior = (current.resource_events ?? []).filter(row => row.id === event.id);
      if (prior.some(row => stable(row) === stable(event))) return true;
      assert(prior.length === 0 ? ['started', 'not_needed'].includes(event.state) :
        prior.length === 1 && prior[0].state === 'started' &&
        ['completed', 'failed', 'cancelled'].includes(event.state) &&
        prior[0].stage === event.stage && prior[0].provider === event.provider &&
        prior[0].model === event.model && event.observed_at_ms >= prior[0].observed_at_ms,
      'resource_usage_transition_invalid');
      assert((current.resource_events?.length ?? 0) < 16, 'resource_usage_event_bound');
      this._update(taskID, 'resource_usage_observed', snapshot => {
        snapshot.resource_events = [...(snapshot.resource_events ?? []), immutable(event)];
      });
      return true;
    } catch {
      // Preserve the missing-data boundary, but do not lose an otherwise
      // valid task because optional accounting failed.
      try { this._update(taskID, 'resource_usage_unavailable', snapshot => {
        snapshot.resource_accounting_errors = ['local_usage_observation_unavailable'];
      }); } catch { /* Existing task/DB failure remains authoritative. */ }
      return false;
    }
  }

  // P7 is an optional finite DEVELOPMENT observation inside this owner, not a
  // calibrated selector/admission source. Native catalog rows alone lack the
  // needed capacity/harness/feature evidence; do not manufacture it here.
  _frozenPredictorShadow(task, node, plan, input = null) {
    if (this.frozenRoutePredictor === null) return null;
    try {
      let prepared;
      if (plain(input?.frozen_predictor_input)) {
        const {current_bindings, features} = input.frozen_predictor_input;
        assert(current_bindings?.rcc_source_sha256 === task.policy?.source_sha256,
          'frozen_current_source_mismatch');
        prepared = {current_bindings, features, selector_input: Object.fromEntries(
          ['schema', 'task', 'candidates', 'selection_policy', 'quality_reference', 'execution_fallback',
            'calibration', 'forecasts', 'host_evidence'].map(k => [k, input[k]]))};
        prepared.selector_input.now_ms = Date.now();
      }
      const result = this.frozenRoutePredictor(prepared);
      assert(plain(result) && !result.then && Buffer.byteLength(stable(result)) <= 131072 &&
        result.execution_authorized === false && result.live_route_change_authorized === false &&
        result.calibration === null && result.forecasts === null && result.host_evidence === null &&
        result.calibration_validated === false && result.holdout_accepted === false,
      'frozen_development_result_invalid');
      if (result.predictor_inference_observed) {
        const receipt = result.inference_receipt;
        assert(isFrozenRouteInference(result) && receipt?.task_id === task.task_id &&
          receipt.node_id === node.id && receipt.request_sha256 === task.request_sha256 &&
          receipt.source_snapshot_sha256 === task.source_fingerprint &&
          receipt.policy_sha256 === task.policy_sha256 && receipt.plan_sha256 === sha(Buffer.from(stable(plan))),
        'frozen_inference_task_binding');
      }
      // No predictions or private dataset bodies enter the prompt/selector.
      return {schema: 1, status: result.status, reason: result.reason,
        artifact_loaded: result.artifact_loaded, artifact_manifest_sha256: result.artifact_manifest_sha256,
        predictor_inference_observed: result.predictor_inference_observed,
        inference_receipt: result.inference_receipt, selector_predictor_executed: false,
        calibration_validated: false, holdout_accepted: false, live_route_change_authorized: false,
        execution_authorized: false, quality_certificate: false};
    } catch {
      return {schema: 1, status: 'rejected', reason: 'frozen_development_observation_invalid',
        predictor_inference_observed: false, calibration_validated: false, holdout_accepted: false,
        live_route_change_authorized: false, execution_authorized: false, quality_certificate: false};
    }
  }

  /** P2/P4 shadow path inside this same durable owner. The model can propose
   * a graph; no graph or candidate from it is executed until a separate,
   * versioned host adoption policy passes. A failed observation preserves the
   * existing route, never a model-selected adapter_bound shortcut. */
  _jointRouteShadow(task, plan, catalog) {
    if (this.adaptivePolicy.mode === 'off') return null;
    const byID = new Map(catalog.candidates.map(c => [c.id, c]));
    return plan.nodes.map(node => {
      const base = {schema: 1, node_id: node.id, advisory_only: true,
        candidate_inventory_sha256: sha(Buffer.from(stable(catalog))),
        bound_candidate_id: node.candidate_id, model_selection_changed: false,
        source_snapshot_basis: 'exact_core_host_context_fingerprint_not_source_body_hash',
        live_route_change_authorized: false, execution_authorized: false, quality_certificate: false};
      if (task.policy?.source_sha256 !== this.adaptivePolicy.rcc_source_sha256 ||
          task.policy_sha256 !== this.adaptivePolicy.projection_sha256 ||
          !this.adaptivePolicy.allowed_workload_classes.includes(catalog.request_class))
        return {...base, state: 'rejected', reason: 'joint_shadow_policy_binding_mismatch',
          predictor_executed: false, selection: null};
      // Missing calibration, exact context capacity or reference metadata is
      // not supplied by the planner or invented from a model name. Until the
      // artifact loader is registered, keep the already-admitted host route.
      if (this.jointRouteEvidence === null) return {...base, state: 'unmeasured',
        reason: 'joint_host_artifacts_not_registered', predictor_executed: false, selection: null,
        frozen_predictor: this._frozenPredictorShadow(task, node, plan)};
      try {
        const candidate = byID.get(node.candidate_id);
        const input = this.jointRouteEvidence({task: immutable(task), plan: immutable(plan),
          node: immutable(node), catalog: immutable(catalog), candidate: immutable(candidate)});
        assert(plain(input) && !input.then && Buffer.byteLength(stable(input)) <= 240_000,
          'joint_shadow_evidence_unbounded_or_async');
        assert(input.task?.id === task.task_id && input.task?.node_id === node.id &&
          input.task?.request_sha256 === task.request_sha256 && input.task?.policy_sha256 === task.policy_sha256 &&
          input.task?.source_snapshot_sha256 === task.source_fingerprint &&
          input.task?.instructions_sha256 === task.policy_sha256 &&
          input.task?.plan_sha256 === sha(Buffer.from(stable(plan))) && input.task?.scope === node.scope &&
          input.quality_reference?.policy_sha256 === this.adaptivePolicy.reference_policy_sha256 &&
          input.execution_fallback?.candidate_id === candidate.id &&
          input.execution_fallback?.config_sha256 === exactConfigFingerprint(exactConfig(candidate)) &&
          Array.isArray(input.candidates) && input.candidates.length <= 256 &&
          input.candidates.every(c => byID.has(c.id) &&
            stable(c.config) === stable(exactConfig(byID.get(c.id)))), 'joint_shadow_evidence_binding');
        const selection = selectJointRoute({...input, now_ms: Date.now()});
        return {...base, state: 'observed', reason: selection.reason,
          predictor_executed: selection.predictor_executed, selection,
          frozen_predictor: this._frozenPredictorShadow(task, node, plan, input)};
      } catch {
        return {...base, state: 'rejected', reason: 'joint_shadow_evidence_invalid',
          predictor_executed: false, selection: null};
      }
    });
  }

  async _observeAdaptivePlan(taskID, task, catalog) {
    const policy = this.adaptivePolicy;
    if (policy.mode === 'off' || task.mode !== 'auto') return true;
    const state = this._load(taskID);
    if (!state || state.cancel_requested || TERMINAL.has(state.state)) return false;
    if (state.adaptive_routing?.planner_invoked) {
      if (state.adaptive_routing.state === 'observed') return true;
      this._hold(taskID, 'adaptive_proposal_interrupted'); return false;
    }
    const scope = hostScope(task, catalog);
    const workload = catalog.request_class;
    // No fabricated quality-reference descriptor. Unknown reference is allowed
    // only for shadow observations; it cannot qualify a cheap live route.
    let disposition;
    if (typeof workload !== 'string' || scope !== 'read_only') {
      disposition = {plan_proposals_enabled: false, reason: 'adaptive_readonly_workload_unavailable'};
    } else {
      disposition = adaptivePolicyDisposition(policy, {
        rcc_source_sha256: task.policy?.source_sha256,
        projection_sha256: task.policy_sha256,
        reference_policy_sha256: null, workload_class: workload,
      });
    }
    if (!disposition.plan_proposals_enabled) {
      this._update(taskID, 'adaptive_plan_skipped', snapshot => {
        snapshot.adaptive_routing = {schema: 1, mode: policy.mode,
          state: 'not_needed', reason: disposition.reason, planner_invoked: false,
          live_plan_changed: false, quality_certificate: false};
      });
      return true;
    }
    const remaining = task.budget.max_duration_ms - (Date.now() - state.created_at_ms);
    if (remaining <= 0) { this._hold(taskID, 'task_duration_budget_exhausted'); return false; }
    const nonce = randomUUID();
    const prepared = createPlannerHostProjection({task, catalog, scope, nonce});
    this._update(taskID, 'adaptive_plan_started', snapshot => {
      assert(!snapshot.cancel_requested && !TERMINAL.has(snapshot.state), 'adaptive_plan_not_active');
      snapshot.state = 'planning'; snapshot.plan_provenance = 'host_exact_request_shadow';
      snapshot.adaptive_routing = {schema: 1, mode: 'shadow', state: 'started', planner_invoked: true,
        policy_id: policy.policy_id, policy_version: policy.version, binding: prepared.expectedBinding,
        callback_pending: true, backend_completion_unknown: true,
        live_plan_changed: false, quality_certificate: false};
    });
    const controller = new AbortController(), item = {controller, promise: null};
    this.intentControllers.set(taskID, item);
    const expiresAt = Math.min(Date.now() + 20_000, state.created_at_ms + task.budget.max_duration_ms);
    let timeout, onAbort, settled = false;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason ?? new RCCRuntimeError('adaptive_plan_aborted'));
      controller.signal.addEventListener('abort', onAbort, {once: true});
    });
    timeout = setTimeout(() => controller.abort(new RCCRuntimeError('adaptive_plan_timeout')),
      Math.max(0, expiresAt - Date.now()));
    const captureReply = result => {
      if (this.closed) return result;
      const raw = typeof result?.raw_proposal === 'string' ? result.raw_proposal :
        typeof result?.raw_model_output === 'string' ? result.raw_model_output : null;
      const current = this._load(taskID);
      if (stable(current?.adaptive_routing?.binding) !== stable(prepared.expectedBinding)) return result;
      // Late settlement can retain a source receipt, but NEVER re-adopts the
      // proposal or restarts any task. After owner shutdown the
      // missing capture remains unknown rather than writing through a new owner.
      this._update(taskID, 'adaptive_reply_captured', snapshot => {
        const reportedHash = result?.raw_output_sha256 ?? result?.output_sha256;
        snapshot.adaptive_routing = {...snapshot.adaptive_routing,
          proposal_sha256: raw !== null ? sha(Buffer.from(raw)) : HASH.test(reportedHash ?? '') ? reportedHash : null,
          raw_proposal: raw !== null && Buffer.byteLength(raw) <= 262_144 ? raw : null,
          raw_reply_complete: raw !== null && Buffer.byteLength(raw) <= 262_144,
          raw_capture_status: raw !== null && Buffer.byteLength(raw) <= 262_144 ? 'captured_exact' :
            ['not_returned', 'oversize_hash_only', 'reasoning_withheld_hash_only'].includes(result?.raw_capture_status)
              ? result.raw_capture_status : 'not_returned',
          backend_completion_unknown: result?.completion_outcome_unknown !== false,
          reply_settled_after_abort: controller.signal.aborted};
      });
      return result;
    };
    item.promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return this.proposeLocalPlan({hostProjection: prepared.hostProjection,
        expectedBinding: prepared.expectedBinding, ownerPolicy: immutable(task.policy),
        projection: prepared.projection, attempt: {index: 0, revision_of: null, correction_codes: []},
        signal: controller.signal,
        observeResourceUsage: event => this._recordResourceUsage(taskID, event)});
    }).then(captureReply).finally(() => {
      settled = true;
      if (this.intentControllers.get(taskID) !== item) return;
      this.intentControllers.delete(taskID);
      // Callback settlement is not backend termination. Keep that separate
      // observation, and never write through a closed/replaced Core owner.
      if (!this.closed) try {
        const current = this._load(taskID);
        if (stable(current?.adaptive_routing?.binding) === stable(prepared.expectedBinding))
          this._update(taskID, 'adaptive_callback_settled', snapshot => {
            snapshot.adaptive_routing = {...snapshot.adaptive_routing, callback_pending: false};
          });
      } catch { /* Optional lifecycle metadata cannot replace owner/state guards. */ }
    });
    try {
      const result = await Promise.race([item.promise, aborted]);
      if (this.closed) return false;
      const current = this._load(taskID);
      if (!current || current.cancel_requested || TERMINAL.has(current.state)) return false;
      if (controller.signal.aborted || this.stopping || this.quiescing || Date.now() >= expiresAt)
        throw new RCCRuntimeError('adaptive_plan_interrupted');
      let compiled = null, reason = 'adaptive_model_proposal_rejected';
      const raw = typeof result?.raw_proposal === 'string' ? result.raw_proposal :
        typeof result?.raw_model_output === 'string' ? result.raw_model_output : null;
      if (result?.completion_outcome_unknown === true) throw new RCCRuntimeError('adaptive_plan_completion_unknown');
      if (result?.status === 'proposal' && typeof raw === 'string') {
        const freshTask = executionTask(current), freshCatalog = current.catalog ?? catalog;
        const fresh = createPlannerHostProjection({task: freshTask, catalog: freshCatalog,
          scope: hostScope(freshTask, freshCatalog), nonce});
        compiled = compileFreshPlannerProposal(raw, prepared, fresh, policy);
        reason = 'shadow_proposal_validated_not_executed';
      }
      this._update(taskID, 'adaptive_plan_observed', snapshot => {
        snapshot.adaptive_routing = {...snapshot.adaptive_routing, state: 'observed', reason,
          proposed_unbound_plan: compiled?.plan ?? null,
          candidate_preferences: compiled?.candidate_preferences ?? [],
          node_obligations: compiled?.node_obligations ?? [],
          semantic_coverage_verified: false, live_plan_changed: false, quality_certificate: false};
      });
      return true;
    } catch (error) {
      if (this.closed) return false;
      const current = this._load(taskID);
      if (!current || current.cancel_requested || TERMINAL.has(current.state)) return false;
      if (!settled) {
        // This observer can only compute proposal DATA. A timeout is not
        // permission to replay it or forget a still-pending local callback.
        await Promise.race([item.promise.catch(() => {}),
          new Promise(resolve => setTimeout(resolve, Math.min(this.cancelGraceMs, 1000)))]);
      }
      // Cancellation/maintenance/deadline can arrive DURING the grace wait.
      // Those authoritative controls still forbid dispatch; an observer-local
      // deadline or unknown compute outcome alone does not change the host plan.
      const latest = this.closed ? null : this._load(taskID);
      if (!latest || latest.cancel_requested || TERMINAL.has(latest.state)) return false;
      if (this.stopping || this.quiescing ||
          Date.now() >= latest.created_at_ms + task.budget.max_duration_ms ||
          (controller.signal.aborted && controller.signal.reason?.code !== 'adaptive_plan_timeout')) {
        this._hold(taskID, 'adaptive_plan_interrupted'); return false;
      }
      this._update(taskID, 'adaptive_plan_rejected', snapshot => {
        snapshot.adaptive_routing = {...snapshot.adaptive_routing, state: 'observed',
          reason: !settled ? 'shadow_callback_pending_original_route_preserved' :
            error?.code === 'adaptive_plan_completion_unknown' ? 'shadow_backend_unknown_original_route_preserved' :
            controller.signal.aborted ? 'shadow_observer_timeout_original_route_preserved' :
              'shadow_proposal_invalid_original_route_preserved',
          callback_pending: !settled,
          proposed_unbound_plan: null, candidate_preferences: [], node_obligations: [],
          semantic_coverage_verified: false,
          live_plan_changed: false, quality_certificate: false};
      });
      return true;
    } finally {
      clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort);
    }
  }

  async _resolveTaskIntent(taskID) {
    const state = this._load(taskID);
    if (!state || TERMINAL.has(state.state) || state.cancel_requested) return null;
    // Exactly one persisted interpretation per original task. Restart never
    // replays a planning task, and a catalog refresh never calls this path.
    if (state.intent_resolution !== undefined) return executionTask(state);
    const original = state.task;
    if (original.mode !== 'auto') {
      this._recordResourceUsage(taskID, {id: randomUUID(), stage: 'routing_intent', state: 'not_needed',
        provider: 'ollama', model: 'ollama/qwen3.5:4b', usage: null, elapsed_ms: 0,
        observed_at_ms: Date.now(), usage_basis: 'openclaw_input_excludes_cache', reason: 'explicit_routes_bypass_intent'});
      return original;
    }
    if (typeof this.resolveIntent !== 'function') return original;
    const remaining = original.budget.max_duration_ms - (Date.now() - state.created_at_ms);
    if (remaining <= 0) { this._hold(taskID, 'task_duration_budget_exhausted'); return null; }
    this._update(taskID, 'intent_resolution_started', snapshot => {
      assert(snapshot.state === 'queued' && !snapshot.cancel_requested, 'intent_resolution_not_active');
      snapshot.state = 'planning';
      snapshot.intent_resolution_state = 'resolving';
    });
    const controller = new AbortController(), item = {controller, promise: null};
    this.intentControllers.set(taskID, item);
    let timeout, abort;
    const aborted = new Promise((_, reject) => {
      abort = () => reject(controller.signal.reason ?? new RCCRuntimeError('intent_resolution_aborted'));
      controller.signal.addEventListener('abort', abort, {once: true});
    });
    const expiresAt = Math.min(Date.now() + INTENT_RESOLUTION_TIMEOUT_MS,
      state.created_at_ms + original.budget.max_duration_ms);
    timeout = setTimeout(() => controller.abort(new RCCRuntimeError('intent_resolution_timeout')),
      Math.max(0, expiresAt - Date.now()));
    // Promise.resolve captures synchronous throws too. A non-cooperative
    // callback remains tracked for quiescence until it actually terminates;
    // the race never installs a late result or replays its original request.
    item.promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return this.resolveIntent({task: immutable(original), signal: controller.signal,
        observeResourceUsage: event => this._recordResourceUsage(taskID, event)});
    })
      .finally(() => { if (this.intentControllers.get(taskID) === item) this.intentControllers.delete(taskID); });
    try {
      const resolution = validateIntentResolution(await Promise.race([item.promise, aborted]), original);
      if (this.closed) return null;
      const current = this._load(taskID);
      if (!current || current.cancel_requested || TERMINAL.has(current.state)) return null;
      if (Date.now() >= expiresAt) throw new RCCRuntimeError('intent_resolution_timeout');
      if (controller.signal.aborted || this.stopping || this.quiescing) {
        this._hold(taskID, 'intent_resolution_interrupted'); return null;
      }
      const effective = resolution.kind === 'routes' ? deriveIntentTask(original, resolution) : null;
      const changed = this._update(taskID, 'intent_resolution_admitted', snapshot => {
        assert(!snapshot.cancel_requested && !TERMINAL.has(snapshot.state) &&
          snapshot.intent_resolution === undefined && stable(snapshot.task) === stable(original),
        'intent_resolution_raced_state');
        snapshot.intent_resolution = resolution;
        snapshot.intent_resolution_state = resolution.kind === 'hold' ? 'held' : resolution.kind;
        if (effective !== null) snapshot.effective_task = effective;
        if (resolution.kind === 'hold') { snapshot.state = 'held'; snapshot.error = resolution.reason; }
      });
      return resolution.kind === 'hold' ? null : executionTask(changed);
    } catch (error) {
      if (this.closed) return null;
      const current = this._load(taskID);
      if (current && !current.cancel_requested && !TERMINAL.has(current.state)) {
        const reason = error instanceof RCCRuntimeError ? error.code : 'intent_resolver_failed';
        this._update(taskID, 'intent_resolution_failed', snapshot => {
          snapshot.intent_resolution_state = 'held'; snapshot.intent_resolution_error = reason;
          snapshot.state = 'held'; snapshot.error = reason;
        });
      }
      return null;
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abort);
    }
  }

  async _runTask(taskID) {
    let state = this._load(taskID);
    if (!state || state.state !== 'queued') return;
    let task = executionTask(state);
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
    // R1: the zero-model paths finish in Core with no provider call, and only
    // with no prior conversation: after "1+1 상품은 3,500원" the follow-up
    // "1+1은 얼마야?" asks a price, and "3-4" after a score is no sum; a model
    // must see that context (review 2026-10-15). A wrapped question
    // ("1+1이 뭐야?") is the same exact sum: the child keeps the whole request
    // as its instruction (_completeLocalExact).
    if (task.mode === 'auto' && task.objective.trim() === task.request.trim() && task.host_context.provider_preference === 'auto' &&
        (task.provider_preference == null || task.provider_preference === 'auto') &&
        task.host_context.explicit_routes == null &&
        task.material_refs.length === 0 && withoutConversation(task)) {
      const checkin = exactLocalGreeting(task.request);
      if (checkin !== null && task.objective.trim() === task.request.trim()) {
        this._completeLocalExact(taskID, 'local_checkin', checkin); return;
      }
      const answer = pureArithmetic(task.request) ?? exactArithmeticQuestion(task.request);
      if (answer !== null) {
        this._completeLocalExact(taskID, 'deterministic_arithmetic', answer);
        return;
      }
    }
    task = await this._resolveTaskIntent(taskID);
    if (task === null || this.closed || this.stopping || this.quiescing) return;
    if (this._load(taskID)?.intent_resolution?.kind === 'local_response' && withoutConversation(task)) {
      this._completeLocalExact(taskID, 'local_checkin', localResponsePathOutput(task.request)); return;
    }
    state = this._update(taskID, 'planning', snapshot => {
      assert(!snapshot.cancel_requested && !TERMINAL.has(snapshot.state), 'planning_raced_cancel');
      snapshot.state = 'planning';
    });
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
    // The task the plan binds: the submitted one, or (a best-effort route
    // test with a route that cannot run now) the routes that run.
    let admitted = task;
    if (task.mode === 'explicit_routing_test') {
      const now = boundAt;
      const runnable = route => catalog.candidates.some(candidate => candidate.surface === route.surface &&
          (route.surface !== 'local' || localWorkerRow(candidate)) &&
          candidate.availability === 'available' && candidate.availability_valid_until_ms > now &&
          candidate.quality_state !== 'mismatch' &&
          (candidate.quota_pool === 'none' || (candidate.quota_pool !== 'unknown' &&
            candidate.quota_remaining_fraction > 0 && candidate.quota_valid_until_ms > now)));
      // Name the host's recorded exclusion reasons for that provider, so a
      // capacity, sign-in or quota exclusion is visible.
      const reasons = route => {
        const provider = route.surface === 'codex' ? 'codex' :
          ['claude', 'claude-chat'].includes(route.surface) ? 'claude' : null;
        // The local surface has no exclusion record: its row is present and
        // observed unavailable (the readiness probe failed), or absent.
        return route.surface === 'local' ?
          [catalog.candidates.some(localWorkerRow) ? 'local_model_not_ready' : 'local_model_absent'] :
          [...new Set((catalog.exclusions ?? []).filter(item => item.provider === provider)
            .map(item => item.reason))].sort();
      };
      const effective = effectiveExplicitRoutes(task);
      const unavailable = effective.filter(route => !runnable(route));
      // A named route test needs every named route: one that cannot run holds
      // the set. A best-effort one (route-all) holds only when none can run.
      if (unavailable.length > 0 && (task.host_context.explicit_routes_best_effort !== true ||
          unavailable.length === effective.length)) {
        const [first] = unavailable, why = reasons(first);
        this._holdExplicitRoutes(taskID, `explicit_route_surface_unavailable:${first.surface}` +
          (why.length ? ':' + why.join('+') : ''));
        return;
      }
      if (unavailable.length > 0) {
        const original = task.host_context.explicit_routes;
        state = this._update(taskID, 'explicit_routes_skipped', snapshot => {
          snapshot.skipped_routes = unavailable.map(route => ({index: original.indexOf(route),
            surface: route.surface, instruction: route.instruction, reason: reasons(route).join('+') || 'unavailable'}));
        });
        admitted = admittedTask(state);
      }
    } else {
      // Nothing that could run now: say why per pool, before a planner call.
      const blocked = noDispatchableReason(task, catalog, boundAt);
      if (blocked) { this._hold(taskID, blocked); return; }
    }
    if (!this.hostAutoPlan && typeof this.plan !== 'function') {
      if (task.mode === 'explicit_routing_test') this._holdExplicitRoutes(taskID, 'planner_unavailable');
      else this._hold(taskID, 'planner_unavailable');
      return;
    }
    let plan, decisions, routes, lockedID = null;
    try {
      if (!await this._observeAdaptivePlan(taskID, admitted, catalog)) return;
      // R7: the host builds the plan itself (hostPlan); no model plans or
      // grades it. An injected plan (fixtures) receives the immutable host
      // state, never a model-authored replacement for that state, and the
      // host then binds exact rows by the same admission law.
      const proposed = this.hostAutoPlan ? hostPlan(admitted, catalog) :
        await this.plan({task: immutable(admitted), catalog: immutable(catalog)});
      // Writer serialization is a safety order, not authority to manufacture
      // the planner's final-output dependency coverage.
      assertFinalOutputOwnership(proposed, admitted);
      const resolved = resolveRoutePlan(proposed, admitted, catalog, boundAt, {verifierRegistry: this.verifierRegistry});
      // One indivisible task runs the owner's own words, never a planner
      // paraphrase (lockIndivisibleInstruction); the decision says so.
      const locked = lockIndivisibleInstruction(resolved.plan, admitted);
      plan = validatePlan(locked.plan, admitted, catalog);
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
    const jointShadow = this._jointRouteShadow(admitted, plan, catalog);
    state = this._update(taskID, 'plan_admitted', snapshot => {
      snapshot.plan = plan; snapshot.state = 'running';
      if (jointShadow !== null) snapshot.joint_route_shadow = jointShadow;
      snapshot.plan_provenance = this.hostAutoPlan
        ? snapshot.adaptive_routing?.planner_invoked ? 'host_exact_request_shadow' : 'host_exact_request'
        : 'external_plan_callback';
      snapshot.bound_rows = boundRows(plan, catalog);
      // A certified descent is admitted with its reference row too: a
      // sibling's later catalog refresh may drop that row, and the escalation
      // must still rebind it (dispatch then refreshes and re-resolves).
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
          ? effectiveExplicitRoutes(admitted).find(route =>
              route.surface === catalog.candidates.find(candidate => candidate.id === node.candidate_id).surface &&
              route.instruction === node.instruction).surface : null,
        routing_decision: decisions[node.id] ?? null, re_resolutions: 0, avoided_candidate_ids: [],
        // Host-internal route record (never public): reference/explicit/tier.
        route_kind: routes[node.id]?.kind ?? null, reference_effort: routes[node.id]?.reference_effort ?? null,
        ladder: routes[node.id]?.ladder ? {...routes[node.id].ladder, escalated: false} : null,
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
      snapshot.plan_provenance = 'deterministic_no_model';
      if (!Array.isArray(snapshot.resource_events) || snapshot.resource_events.length === 0)
        snapshot.resource_events = [{id: randomUUID(), stage: 'routing_intent', state: 'not_needed',
          provider: 'ollama', model: 'ollama/qwen3.5:4b', usage: null, elapsed_ms: 0,
          observed_at_ms: now, usage_basis: 'openclaw_input_excludes_cache', reason: 'deterministic_no_model'}];
      const config = {surface: 'local', transport: 'local', account_id: 'os1-core',
        model: 'none', effort: 'none', tools: [], scope: 'read_only',
        permission_profile: 'read_only', quota_pool: 'none', allowed_paths: [],
        configuration_sha256: sha(Buffer.from('os1-rcc-core-local-exact-v1'))};
      snapshot.children = [{id: 'local-core', state: 'completed', attempt_id: null,
        candidate_id: 'local-core', attempts: 0, attempt_history: [], repair_needed: false,
        dispatched_at_ms: null, output, execution_verified: true,
        task_quality: 'task_verified', parity_state: 'unverified', native_receipt: null,
        native_summary: null, usage: null, selected_config: config, requested_surface: null, instruction: executionTask(snapshot).request,
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
  /** Bounded SQLite resource probe; never a model/catalog call. An uncertain
   * member reaches the authoritative reservation check so it holds, not spins. */
  _leasePossible(candidate, task, nodeID, note = true) {
    try {
      const claim = this._poolClaim(candidate, task, nodeID, {note});
      if (claim.state === 'busy') return false;
      // Preserve the legacy ready-wave's busy -> async spread -> admission
      // recheck path. Returning free synchronously could dispatch a stale
      // sibling before an immediately returned authorization failure settles.
      if (!claim.info.shared && claim.info.poolKey && this.poolReservations.has(claim.info.poolKey)) return false;
      return true;
    } catch { return true; } // _tryReserve reports the exact canonical-path error.
  }
  /** A node the host resolved and bound (its routing decision has a class):
   * any resolved node, and an explicit route on a tier-routed catalog,
   * whose re-resolution stays on its own named surface. A planner-chosen
   * explicit row (older catalog) or an adapter-bound node has no class. */
  _resolverNode(snapshot, nodeID) {
    const child = snapshot.children.find(c => c.id === nodeID);
    return ROUTE_CLASSES.includes(child?.routing_decision?.route_class) ? child : null;
  }
  /** Replace one queued node's host-resolved row, against the supplied fresh
   * catalog, same scope and route_class, preferring a different quota pool
   * (an explicit route stays on its own named surface). Never used for
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
    // An escalated tier route stays at the reference wherever it moves; any
    // other node is admitted again by the same law (R0) against the fresh rows.
    const escalated = child.ladder?.source === 'tier' && child.ladder.escalated === true;
    const choice = selectRouteCandidate(node, executionTask(snapshot), fresh, Date.now(),
      {avoidPool: failed?.quota_pool ?? decided ?? null, avoidIDs, referenceOnly: escalated,
        verifierRegistry: this.verifierRegistry});
    const next = {...snapshot.plan, nodes: snapshot.plan.nodes.map(n =>
      n.id === nodeID ? {...n, candidate_id: choice.candidate.id} : n)};
    const plan = validatePlan(next, admittedTask(snapshot), repairCatalog(snapshot, next, fresh, [nodeID]));
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
        // A certified descent keeps its source and takes the escalation
        // target of its new pool; anything else runs the reference.
        target.route_kind = choice.kind;
        target.ladder = choice.kind === 'tier' && choice.ladder ? {...choice.ladder, escalated: false} : null;
      }
      target.routing_decision = withInstructionLock(target, routingDecision(
        escalated ? target.routing_decision.route_class : choice.routeClass,
        choice.candidate, `re_resolved_after:${reason};${choice.why}`, target.ladder, choice.tier));
    });
  }
  /** Deterministic resolution binds independent nodes of one admission to
   * the same row, and one pool takes one lease at a time. When THIS task's own
   * running node holds that pool, move a not-yet-dispatched resolved node to
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
      if (owner?.task_id !== executionTask(snapshot).task_id) return false;
    }
    const pick = (catalog, now) => {
      try {
        const choice = selectRouteCandidate(node, executionTask(snapshot), catalog, now,
          {avoidPool: planned.quota_pool, avoidIDs: [node.candidate_id], verifierRegistry: this.verifierRegistry});
        return choice.candidate.quota_pool !== planned.quota_pool &&
          this._leasePossible(choice.candidate, executionTask(snapshot), node.id, false) ? choice : null;
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
      plan = validatePlan(next, admittedTask(state), repairCatalog(state, next, state.catalog, [node.id]));
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
        // The other pool's route, admitted by the same law (R0): a certified
        // descent takes the escalation target of its new pool.
        target.route_kind = choice.kind; target.reference_effort = choice.referenceEffort;
        target.ladder = choice.kind === 'tier' && choice.ladder ? {...choice.ladder, escalated: false} : null;
        target.routing_decision = withInstructionLock(target, routingDecision(choice.routeClass,
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
    try { fresh = validateCatalog(await this.catalog(immutable(executionTask(prior))), executionTask(prior)); }
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
  /** One scheduler-ready wave only, never a persisted or cross-task cache.
   * The full effective task binds source, policy, context, account constraint
   * and budgets. Exact plan/rows/catalog/bind-time changes invalidate reuse;
   * dispatch still rechecks the row and native admission checks independently. */
  _readyWaveBinding(snapshot) {
    return sha(Buffer.from(stable({task: executionTask(snapshot), plan: snapshot.plan,
      bound_rows: snapshot.bound_rows ?? {}, catalog: snapshot.catalog,
      catalog_bound_at_ms: snapshot.catalog_bound_at_ms})));
  }
  _readyWaveEligible(snapshot, node, candidate) {
    if (!snapshot || snapshot.cancel_requested || TERMINAL.has(snapshot.state) || this.stopping || this.closed ||
        !candidate || !this._readPoolEligible(candidate, executionTask(snapshot)) ||
        snapshot.plan?.nodes.length < 2 || node.kind !== 'agent' ||
        !snapshot.plan.nodes.every(n => n.scope === 'read_only' && n.owned_paths.length === 0 &&
          n.dependencies.length === 0)) return false;
    const child = snapshot.children.find(c => c.id === node.id);
    // The actual multi-node ticket uses a fresh native thread. Legacy
    // native_sessions, continuations, source staging, retries and re-resolution
    // cannot borrow this wave's observation, even if their row still exists.
    return child?.state === 'queued' && child.attempts === 0 &&
      snapshot.children.every(c => ['queued', 'running', 'completed'].includes(c.state) &&
        c.attempts <= 1 && !c.repair_needed && c.continuation == null && c.stage == null &&
        !(c.re_resolutions > 0) && !(c.spreads > 0) && c.spread !== true &&
        (c.attempt_history ?? []).every(a => ['dispatch_started', 'completed'].includes(a.state)));
  }
  _poolKey(candidate) {
    return candidate.quota_pool === 'none' ? null : `${candidate.quota_pool}:${candidate.account_id}`;
  }
  /** Sharing is bounded to new, independent read-only Codex children of
   * ONE parent. The durable pool lease still fences every other task and all
   * writes. A resumed native thread is never used by simultaneous turns. */
  _readPoolEligible(candidate, task) {
    if (!(this.maximumReadWorkersPerPool > 1 && task.budget.max_parallel > 1 &&
        candidate.surface === 'codex' && candidate.transport === 'codex_app_server' &&
        candidate.scope === 'read_only' && candidate.permission_profile === 'read_only' &&
        candidate.quota_pool === 'openai_codex' &&
        (task.native_sessions == null || Object.keys(task.native_sessions).length === 0))) return false;
    const state = this._load(task.task_id);
    // _ticket creates fresh side sessions for a real multi-node plan even
    // when the conversation itself already owns a thread. Do not confuse
    // that history with concurrent turns on one resumed native thread.
    const detached = state?.plan?.nodes.length > 1 &&
      !state.children.some(child => child.continuation != null || child.stage != null);
    return task.host_context.codex_session_id === null || detached;
  }
  _joinReadPool(candidate, task) {
    if (!this._readPoolEligible(candidate, task)) return false;
    const key = this._poolKey(candidate), owned = this.readPoolReservations.get(key);
    if (!owned || owned.taskID !== task.task_id || owned.nodes.size >= this.maximumReadWorkersPerPool) return false;
    const state = this._load(task.task_id);
    return state && !state.cancel_requested && !TERMINAL.has(state.state) &&
      !state.children.some(child => poolKeyOf(child.selected_config) === key &&
        child.state === 'effects_uncertain' && !settledReadOnly(child));
  }
  /** Sharing is a host-attested resource capability, never a route/model guess.
   * The adapter independently rechecks the exact local-effects boundary before
   * dispatch. Legacy, resumed, source/permission handbacks remain exclusive. */
  _claimInfo(candidate, task, nodeID) {
    let workspace = null;
    try { workspace = realpathSync(task.host_context.workspace); }
    catch { if (candidate.scope === 'workspace_write') throw new RCCRuntimeError('write_workspace_unavailable'); }
    const snapshot = this._load(task.task_id), child = snapshot?.children.find(c => c.id === nodeID);
    const contract = snapshot?.catalog?.task_contract;
    const shared = this.maximumReadWorkersPerPool > 1 && candidate.surface === 'codex' &&
      candidate.transport === 'codex_app_server' && candidate.quota_pool === 'openai_codex' &&
      candidate.scope === candidate.permission_profile && workspace === task.host_context.workspace &&
      task.host_context.codex_session_id === null &&
      (task.native_sessions == null || Object.keys(task.native_sessions).length === 0) &&
      child?.attempts === 0 && !child.stage && !child.continuation && !child.quality_continuation && !child.repair_needed &&
      contract?.execution_isolation === 'codex_fresh_local_effects_v1' && HASH.test(contract.execution_isolation_sha256 ?? '') &&
      validTaskContract(contract, snapshot.catalog, task) && contract.valid_until_ms > Date.now() &&
      contract.source_sha256 == null && (contract.scope === 'workspace_write' || candidate.scope === 'read_only');
    return {poolKey: this._poolKey(candidate), taskID: task.task_id, nodeID, workspace,
      mode: candidate.scope === 'workspace_write' ? 'write' : 'read', shared: Boolean(shared), candidateID: candidate.id,
      isolation: shared ? {execution_isolation: contract.execution_isolation, execution_isolation_sha256: contract.execution_isolation_sha256} : null,
      binding: sha(Buffer.from(stable({config: exactConfig(candidate), workspace, shared: Boolean(shared),
        contract: shared ? contract : null, session: task.host_context.codex_session_id, native_sessions: task.native_sessions ?? null})))};
  }
  _rootsOverlap(a, b) {
    if (a === null || b === null) return true;
    const under = (root, path) => { const r = relative(root, path); return r === '' || (!r.startsWith('../') && r !== '..' && !isAbsolute(r)); };
    return under(a, b) || under(b, a);
  }
  _claimChild(row) { return this._load(row.task_id)?.children.find(c => c.id === row.node_id); }
  _validClaimRow(row) {
    if (!boundedText(row.pool_key, 600) || !ID.test(row.task_id ?? '') || !ID.test(row.node_id ?? '') ||
        !(typeof row.claim_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.claim_id)) || !ID.test(row.candidate_id ?? '') || !HASH.test(row.binding_sha256 ?? '') ||
        !['waiting', 'active'].includes(row.phase) || !['read', 'write'].includes(row.mode) ||
        ![0, 1].includes(row.shared) || !(row.workspace === null ||
          (typeof row.workspace === 'string' && isAbsolute(row.workspace)))) return false;
    if (row.shared === 1 && row.workspace === null) return false;
    const child = this._claimChild(row), reservation = this.claimReservations.get(row.claim_id);
    if (reservation && (row.phase !== 'active' || reservation.binding !== row.binding_sha256 ||
        reservation.workspace !== row.workspace || reservation.mode !== row.mode || reservation.poolKey !== row.pool_key ||
        reservation.taskID !== row.task_id || reservation.nodeID !== row.node_id ||
        Boolean(reservation.isolation) !== (row.shared === 1))) return false;
    if (row.phase === 'waiting' && child && leaseProtectingChild(child)) return false;
    if (row.phase === 'active' && child?.selected_config) {
      if (poolKeyOf(child.selected_config) !== row.pool_key ||
          (child.selected_config.scope === 'workspace_write' ? 'write' : 'read') !== row.mode) return false;
      // Legacy rows also name resources; a forged old reader root must not
      // become permission for a newer isolated writer in another account.
      try {
        if (realpathSync(this._load(row.task_id).task.host_context.workspace) !== row.workspace) return false;
      } catch { return false; }
    }
    return true;
  }
  /** Called only under this owner's transaction. Reservations precede the
   * durable dispatch marker; absent markers are known not dispatched on restart. */
  _reconcilePoolClaims() {
    for (const row of this.db.prepare('SELECT * FROM pool_claims').all()) {
      if (!this._validClaimRow(row)) continue; // Undecidable membership is not permission to release.
      const state = this._load(row.task_id), child = state?.children.find(c => c.id === row.node_id);
      const candidate = state?.catalog?.candidates.find(c => c.id === row.candidate_id);
      const waitingGone = row.phase === 'waiting' && (!state || state.cancel_requested || TERMINAL.has(state.state) ||
        child?.state !== 'queued' || child.candidate_id !== row.candidate_id || !candidate ||
        !dispatchable(candidate, executionTask(state), Date.now()));
      const settled = row.phase === 'active' && !this.claimReservations.has(row.claim_id) &&
        (!state || !child || !leaseProtectingChild(child));
      if (waitingGone || settled) this.db.prepare('DELETE FROM pool_claims WHERE claim_id=?').run(row.claim_id);
    }
  }
  _claimsConflict(a, b, task, candidate) {
    if (a.pool_key === b.poolKey && !(a.shared === 1 && b.shared)) {
      // Preserve the older same-parent read-only DAG capability, not an
      // arbitrary cross-parent exemption for unbounded native effects.
      if (!(a.task_id === b.taskID && a.mode === 'read' && b.mode === 'read' && this._joinReadPool(candidate, task))) return true;
    }
    // The new mixed-sharing admission extends workspace exclusion; wholly
    // legacy paths retain their existing quota/write-lease behavior.
    return (a.shared || b.shared) && (a.mode === 'write' || b.mode === 'write') && this._rootsOverlap(a.workspace, b.workspace);
  }
  /** One durable waiter/member ledger, not another scheduler. Fair first-ready
   * intents remove polling-order starvation; unsupported classes keep old fences. */
  _poolClaim(candidate, task, nodeID, {acquire = false, note = true} = {}) {
    const info = this._claimInfo(candidate, task, nodeID);
    if (!info.poolKey) return {state: 'local', info};
    return this.transaction(() => {
      this._reconcilePoolClaims();
      if (this.db.prepare('SELECT * FROM pool_claims').all().some(row => !this._validClaimRow(row)))
        return {state: 'uncertain_pool', info};
      let own = this.db.prepare('SELECT * FROM pool_claims WHERE pool_key=? AND task_id=? AND node_id=?')
        .get(info.poolKey, info.taskID, nodeID);
      if (own?.phase === 'active') return {state: 'busy', info};
      if (own && own.binding_sha256 !== info.binding) {
        // A changed permission/configuration/attestation is a new intent, not
        // an upgrade of an old reader's age or release token (ABA).
        this.db.prepare('DELETE FROM pool_claims WHERE claim_id=? AND phase=?').run(own.claim_id, 'waiting');
        own = null;
      }
      if (note && !own && dispatchable(candidate, task, Date.now())) {
        this.db.prepare(`INSERT INTO pool_claims(pool_key,task_id,node_id,claim_id,candidate_id,workspace,mode,shared,binding_sha256,phase,requested_ms)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(info.poolKey, info.taskID, nodeID, randomUUID(), info.candidateID,
            info.workspace, info.mode, info.shared ? 1 : 0, info.binding, 'waiting', Date.now());
        own = this.db.prepare('SELECT * FROM pool_claims WHERE pool_key=? AND task_id=? AND node_id=?')
          .get(info.poolKey, info.taskID, nodeID);
      }
      const active = this.db.prepare("SELECT * FROM pool_claims WHERE phase='active'").all();
      const uncertain = active.some(row => row.pool_key === info.poolKey &&
        this._claimChild(row)?.state === 'effects_uncertain' && !settledReadOnly(this._claimChild(row)));
      if (uncertain) return {state: 'uncertain_pool', info};
      let legacy = this.db.prepare('SELECT task_id FROM quota_leases WHERE pool_key=?').get(info.poolKey);
      if (legacy && legacy.task_id !== task.task_id) {
        const owner = this._load(legacy.task_id);
        if (!owner || (TERMINAL.has(owner.state) && !protectedPools(owner).has(info.poolKey))) {
          this.db.prepare('DELETE FROM quota_leases WHERE pool_key=? AND task_id=?').run(info.poolKey, legacy.task_id);
          legacy = null;
        } else if (owner.state === 'effects_uncertain') return {state: 'uncertain_pool', info};
        else return {state: 'busy', info};
      }
      if (this.activeWorkers >= this.maximumWorkers || active.length >= this.maximumWorkers ||
          active.filter(row => row.pool_key === info.poolKey).length >= this.maximumReadWorkersPerPool ||
          active.some(row => this._claimsConflict(row, info, task, candidate))) return {state: 'busy', info};
      // A writer lease may outlive its returned child until the parent settles.
      // Respect canonical overlapping roots across pools, including HOME.
      for (const writer of this.db.prepare('SELECT * FROM write_leases').all()) {
        if (writer.task_id === task.task_id) continue;
        const state = this._load(writer.task_id);
        if (!state || (TERMINAL.has(state.state) && !state.children.some(c => leaseProtectingChild(c)))) {
          this.db.prepare('DELETE FROM write_leases WHERE workspace=? AND task_id=?').run(writer.workspace, writer.task_id);
          continue;
        }
        const boundedWriter = active.some(row => row.task_id === writer.task_id && row.shared && row.mode === 'write');
        const conflict = info.shared || boundedWriter ? this._rootsOverlap(writer.workspace, info.workspace) :
          info.mode === 'write' && writer.workspace === info.workspace;
        if (conflict) return {state: state.state === 'effects_uncertain' ? 'uncertain_workspace' : 'busy', info};
      }
      const ahead = this.db.prepare("SELECT * FROM pool_claims WHERE phase='waiting' AND seq<? ORDER BY seq")
        .all(own?.seq ?? Number.MAX_SAFE_INTEGER).filter(row => row.pool_key === info.poolKey);
      const priorWaiters = [];
      for (const waiter of ahead) {
        // Keep unrelated legacy spread/re-resolution semantics unchanged.
        if (!info.shared && !waiter.shared) continue;
        // An older exclusive intent drains the pool; an overlapping writer
        // drains its resource. New readers must not refill either forever.
        const conflictsWithNew = !(waiter.shared && info.shared) ||
          ((waiter.mode === 'write' || info.mode === 'write') && this._rootsOverlap(waiter.workspace, info.workspace));
        if (conflictsWithNew) return {state: 'busy', info};
        // Genuinely disjoint bounded work may pass a resource-blocked waiter,
        // but once it is eligible its next capacity opportunity is reserved.
        const blocked = active.some(row => (row.pool_key === waiter.pool_key && !(row.shared && waiter.shared)) ||
          ((row.mode === 'write' || waiter.mode === 'write') && this._rootsOverlap(row.workspace, waiter.workspace))) ||
          priorWaiters.some(row => !(row.shared && waiter.shared) ||
            ((row.mode === 'write' || waiter.mode === 'write') && this._rootsOverlap(row.workspace, waiter.workspace)));
        if (!blocked) return {state: 'busy', info};
        // A read waiting behind an earlier writer is not itself eligible to
        // head-of-line block a genuinely disjoint candidate.
        priorWaiters.push(waiter);
      }
      if (!acquire) return {state: 'free', info};
      if (!own || !dispatchable(candidate, task, Date.now())) return {state: 'busy', info};
      if (!info.shared && !legacy) this.db.prepare('INSERT INTO quota_leases(pool_key,task_id,acquired_ms) VALUES(?,?,?)')
        .run(info.poolKey, task.task_id, Date.now());
      if (info.mode === 'write') this.db.prepare('INSERT OR IGNORE INTO write_leases(workspace,task_id,acquired_ms) VALUES(?,?,?)')
        .run(info.workspace, task.task_id, Date.now());
      this.db.prepare("UPDATE pool_claims SET phase='active' WHERE claim_id=?").run(own.claim_id);
      return {state: 'owned', info, claimID: own.claim_id};
    });
  }

  _tryReserve(candidate, task, nodeID) {
    const claim = this._poolClaim(candidate, task, nodeID, {acquire: true});
    if (claim.state === 'uncertain_pool') throw new RCCRuntimeError('quota_pool_effects_uncertain');
    if (claim.state === 'uncertain_workspace') throw new RCCRuntimeError('write_workspace_effects_uncertain');
    if (!['owned', 'local'].includes(claim.state)) return null;
    if (claim.state === 'local' && this.activeWorkers >= this.maximumWorkers) return null;
    const {poolKey, workspace, mode} = claim.info;
    this.activeWorkers += 1;
    if (poolKey) {
      this.poolReservations.add(poolKey);
      if (!claim.info.shared && this._readPoolEligible(candidate, task)) {
        const readers = this.readPoolReservations.get(poolKey);
        this.readPoolReservations.set(poolKey, {taskID: task.task_id, nodes: new Set([...(readers?.nodes ?? []), nodeID])});
      }
    }
    const workspaceKey = mode === 'write' ? workspace : null;
    if (workspaceKey) this.activeWriteWorkspaces.add(workspaceKey);
    const reservation = {poolKey, workspaceKey, taskID: task.task_id, nodeID, claimID: claim.claimID ?? null, isolation: claim.info.isolation, binding: claim.info.binding,
      workspace: claim.info.workspace, mode: claim.info.mode};
    if (reservation.claimID) this.claimReservations.set(reservation.claimID, reservation);
    return reservation;
  }

  _release(reservation) {
    if (reservation.claimID && !this.claimReservations.has(reservation.claimID)) return;
    if (reservation.claimID) this.claimReservations.delete(reservation.claimID);
    this.activeWorkers -= 1;
    if (reservation.claimID && !this.closed) this.transaction(() => {
      const child = this._load(reservation.taskID)?.children.find(c => c.id === reservation.nodeID);
      if (!child || !leaseProtectingChild(child))
        this.db.prepare('DELETE FROM pool_claims WHERE claim_id=?').run(reservation.claimID);
    });
    if (reservation.poolKey) {
      const readers = this.readPoolReservations.get(reservation.poolKey);
      if (readers && readers.taskID === reservation.taskID) {
        const nodes = new Set(readers.nodes); nodes.delete(reservation.nodeID);
        if (nodes.size) this.readPoolReservations.set(reservation.poolKey, {...readers, nodes});
        else { this.readPoolReservations.delete(reservation.poolKey); this.poolReservations.delete(reservation.poolKey); }
      } else {
        const active = [...this.claimReservations.values()].some(r => r.poolKey === reservation.poolKey);
        if (!active) this.poolReservations.delete(reservation.poolKey);
      }
    }
    if (reservation.workspaceKey) this.activeWriteWorkspaces.delete(reservation.workspaceKey);
    if (reservation.poolKey && !this.closed) {
      const snapshot = this._load(reservation.taskID);
      const child = snapshot?.children.find(c => c.id === reservation.nodeID);
      // A settled read-only attempt releases its pool even when its outcome
      // is effects_uncertain: its process exited and it changed nothing.
      // One sibling finishing must not release the parent's fence while
      // another sibling is active or an unsettled native turn protects it.
      if (!this.poolReservations.has(reservation.poolKey) &&
          !protectedPools(snapshot).has(reservation.poolKey)) {
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
    // A queued repair persisted by an older owner is not fresh authority to
    // route around an opaque authentication/transport refusal after restart.
    const priorError = child.attempt_history.at(-1)?.error;
    if (HELD_PRE_DISPATCH_ERRORS.has(priorError)) {
      this._update(taskID, 'child_pre_dispatch_held', state => {
        const target = state.children.find(c => c.id === childID);
        target.state = 'held'; target.hold_reason = priorError; target.repair_needed = false;
      });
      return;
    }
    if (chargedAttempts(child, Boolean(this._resolverNode(snapshot, childID))) >= executionTask(snapshot).budget.max_attempts) {
      this._update(taskID, 'safe_retry_budget_exhausted', state => {
        const target = state.children.find(c => c.id === childID);
        target.state = 'failed'; target.failure_reason = 'verified_not_dispatched_retry_exhausted';
      });
      return;
    }
    const failed = snapshot.catalog.candidates.find(c => c.id === oldNode.candidate_id) ??
      snapshot.bound_rows?.[oldNode.candidate_id];
    const resolverNode = this._resolverNode(snapshot, childID);
    if (resolverNode && (resolverNode.re_resolutions ?? 0) >= MAX_RE_RESOLUTIONS) {
      this._update(taskID, 'safe_re_resolution_exhausted', state => {
        const target = state.children.find(c => c.id === childID);
        target.state = 'failed'; target.failure_reason = 'verified_not_dispatched_re_resolution_exhausted';
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
      const admitted = admittedTask(snapshot);
      proposed = validatePlan(lockIndivisibleInstruction(await this.plan({task: immutable(admitted),
        catalog: immutable(fresh), repair: {
          failed_node_id: childID, failed_candidate_id: oldNode.candidate_id,
          failed_attempt_id: child.attempt_id,
          failure_receipt: child.attempt_history.at(-1)?.native_receipt ?? null,
          allowed_change: 'candidate_id_only_same_scope_and_objective'}}), admitted).plan, admitted,
        repairCatalog(snapshot, snapshot.plan, fresh, [childID]));
      assert(proposed.nodes.length === snapshot.plan.nodes.length, 'repair_plan_shape_changed');
      assert(proposed.nodes.every((next, index) => next.id === snapshot.plan.nodes[index].id),
        'repair_plan_order_changed');
      assert(Object.hasOwn(proposed, 'final_node_id') === Object.hasOwn(snapshot.plan, 'final_node_id') &&
        proposed.final_node_id === snapshot.plan.final_node_id, 'repair_final_output_owner_changed');
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
      this._candidate(executionTask(snapshot), fresh, proposed.nodes.find(n => n.id === childID));
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
      // A best-effort route test (route-all) runs every route it can: a route
      // held without effects (the local model gave no answer) does not stop
      // the routes still queued behind a shared pool. Anything else settles.
      const continuing = executionTask(snapshot).host_context?.explicit_routes_best_effort === true &&
        !snapshot.children.some(c => ['failed', 'effects_uncertain'].includes(c.state)) &&
        snapshot.children.some(c => c.state === 'queued');
      if (!continuing && snapshot.children.some(c => ['failed', 'held', 'effects_uncertain'].includes(c.state))) {
        if (active.size) { await this._waitForActiveOrTerminal(active, taskID); continue; }
        const uncertain = snapshot.children.some(c => c.state === 'effects_uncertain');
        const failed = snapshot.children.some(c => c.state === 'failed');
        if (uncertain) this._update(taskID, 'task_effects_uncertain', state => {
          state.state = 'effects_uncertain';
          state.error = state.children.find(c => c.state === 'effects_uncertain' && typeof c.uncertain_error === 'string')
            ?.uncertain_error ?? 'child_effects_uncertain_no_replay';
        });
        else if (failed) {
          // Failure remains failure, but a supported earlier or concurrently
          // completed result must not disappear behind the terminal error.
          // Aggregation failure does not replace that original failure reason.
          let partial = null;
          try { partial = await this._partialResult(taskID,
            snapshot.children.filter(c => c.state === 'completed' && c.output !== null)); }
          catch { /* Child records remain intact if no bounded receipt can be assembled. */ }
          this._update(taskID, 'task_failed', state => {
            if (TERMINAL.has(state.state)) return;
            state.state = 'failed';
            state.error = snapshot.children.find(c => c.state === 'failed' && typeof c.failure_reason === 'string')
              ?.failure_reason ?? 'child_failed';
            if (partial) state.result = partial;
          });
        }
        else {
          // A child held for a typed reason (a ladder that could not reach its
          // reference) names the hold; any other held child is unverified.
          const reason = snapshot.children.find(c => c.state === 'held' && typeof c.hold_reason === 'string')
            ?.hold_reason ?? 'child_task_quality_unverified';
          const returned = snapshot.children.filter(c => c.output !== null);
          try { this._hold(taskID, reason, await this._partialResult(taskID, returned)); }
          catch (error) { this._hold(taskID, error.code ?? 'aggregate_receipt_unavailable'); }
        }
        return;
      }
      const cap = Math.min(executionTask(snapshot).budget.max_parallel, this.maximumWorkers);
      const ready = snapshot.plan.nodes.filter(node => {
        const child = snapshot.children.find(c => c.id === node.id);
        return child?.state === 'queued' && node.dependencies.every(finished.has.bind(finished));
      });
      let reResolved = false;
      // Only siblings already ready together can share the first successful
      // pre-dispatch refresh. A later loop/wave always starts without it.
      let readyWave = null;
      const readyIDs = new Set(ready.map(node => node.id));
      const admissionCurrent = state => state && !state.cancel_requested && !TERMINAL.has(state.state) &&
        !state.children.some(c => ['failed', 'effects_uncertain'].includes(c.state)) &&
        !state.children.some(c => c.state === 'held' && HELD_PRE_DISPATCH_ERRORS.has(c.hold_reason));
      // Other held-verifier/best-effort behavior remains the existing DAG's
      // responsibility. It invalidates wave reuse, not fresh legacy admission.
      for (const node of ready) {
        if (active.size >= cap || snapshot.cancel_requested) break;
        let current = this._load(taskID);
        if (!admissionCurrent(current)) { reResolved = true; break; }
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
        const planned = current.catalog.candidates.find(c => c.id === node.candidate_id);
        if (planned && !this._leasePossible(planned, executionTask(current), node.id)) {
          // Independent resolved work waits for the busy pool only when the
          // other admitted pool cannot take it now either.
          if (await this._spreadAcrossPools(taskID, current, node, planned)) { reResolved = true; break; }
          current = this._load(taskID);
          if (!admissionCurrent(current)) { reResolved = true; break; }
          if (!this._joinReadPool(planned, executionTask(current))) continue;
        }
        const resolverNode = this._resolverNode(current, node.id);
        let candidate, fresh;
        try {
          // A host-resolved row may be replaced if it vanished, so its absence
          // is checked by _candidate instead of failing the refresh itself.
          const reusable = readyWave && readyWave.ids.has(node.id) &&
            this._readyWaveEligible(current, node, planned) &&
            readyWave.binding === this._readyWaveBinding(current) &&
            dispatchable(planned, executionTask(current), Date.now());
          fresh = reusable ? current.catalog :
            await this._refreshCatalog(taskID, resolverNode ? [] : [node.candidate_id]);
          current = this._load(taskID);
          if (!admissionCurrent(current)) { reResolved = true; break; }
          candidate = this._candidate(executionTask(current), fresh, node);
          if (!reusable) readyWave = this._readyWaveEligible(current, node, candidate) ?
            {ids: readyIDs, binding: this._readyWaveBinding(current)} : null;
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
        try { reservation = this._tryReserve(candidate, executionTask(current), node.id); }
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
              // Keep the task observable until already-dispatched siblings
              // return their own records. The scheduler sees this failed
              // child and starts nothing new, but a premature parent terminal
              // would discard those siblings' late results below.
              const reason = error.code ?? (dispatched ? 'node_execution_unknown' : 'node_pre_dispatch_failed');
              if (dispatched) child.uncertain_error = reason;
              else child.hold_reason = reason;
              if (siblingRunning(state, node.id)) return;
              state.state = dispatched ? 'effects_uncertain' : 'held';
              state.error = reason;
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
    const policySource = executionTask(snapshot).host_context.owner_policy;
    const sourceSHA = policySource?.sourceSHA256 ?? policySource?.source_sha256 ?? executionTask(snapshot).policy?.source_sha256;
    assert(HASH.test(sourceSHA ?? ''), 'policy_source_unavailable');
    const isSingleFullAgent = snapshot.plan?.nodes.length === 1 &&
      snapshot.plan.nodes[0]?.id === node.id && node.kind === 'agent';
    // An attempt whose answer may still be discarded runs in a fresh native
    // session, never in the owner's own thread: a certified descent below its
    // reference (escalation not yet spent). A discarded answer then never
    // sits in the owner's thread, and the escalated reference resumes that
    // thread untouched (it never builds on the failed turn). OS-1 records the
    // delivered attempt's session as the conversation's and still hands the
    // recent conversation over in host_context.context.
    const child = snapshot.children?.find(c => c.id === node.id);
    const resumeSession = pendingEscalation(child) ? null : isSingleFullAgent && candidate.surface === 'codex' ?
      executionTask(snapshot).host_context.codex_session_id :
      isSingleFullAgent && candidate.surface === 'claude' ?
        executionTask(snapshot).host_context.claude_session_id : null;
    assert(resumeSession === null || ID.test(resumeSession), 'native_resume_session_invalid');
    const granted = [...this.claimReservations.values()].find(r => r.taskID === executionTask(snapshot).task_id && r.nodeID === node.id)?.isolation;
    if (granted) assert(resumeSession === null && snapshot.catalog.task_contract?.execution_isolation === granted.execution_isolation &&
      snapshot.catalog.task_contract?.execution_isolation_sha256 === granted.execution_isolation_sha256 &&
      snapshot.catalog.task_contract.valid_until_ms > Date.now(), 'execution_isolation_lost_before_dispatch');
    const staged = snapshot.catalog.task_contract;
    const staging = stagedWriterContract(staged) && node.scope === 'workspace_write' && candidate.surface === 'codex' ? {
      execution_isolation: staged.execution_isolation, execution_isolation_sha256: staged.execution_isolation_sha256,
      staged_writer_envelope_sha256: staged.staged_writer_envelope_sha256, staged_writer_base_sha256: staged.staged_writer_base_sha256} : {};
    if (Object.keys(staging).length) assert(staged.valid_until_ms > Date.now() && resumeSession === null,
      'staged_writer_authority_lost_before_dispatch');
    return {schema: 1, ...(granted ?? {}), ...staging, task_id: executionTask(snapshot).task_id, node_id: node.id,
      attempt_id: attemptID, candidate_id: candidate.id,
      objective: node.instruction,
      original_request: executionTask(snapshot).request, original_objective: executionTask(snapshot).objective,
      request_sha256: executionTask(snapshot).request_sha256, policy_sha256: executionTask(snapshot).policy_sha256,
      policy_source_sha256: sourceSHA, source_fingerprint: executionTask(snapshot).source_fingerprint,
      host_context: immutable(executionTask(snapshot).host_context),
      ...(executionTask(snapshot).core_routing ? {core_routing: immutable(executionTask(snapshot).core_routing)} : {}),
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
      'usage', 'error', 'native_summary', 'handback', 'repair_source', 'native_turn_terminated', 'operational_quality', 'staged_writer'];
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
    // Only an actual native catalog negative permits configuration repair in
    // either scope, with no dispatch/effects and an exact native receipt.
    if (result.error === NATIVE_CONFIGURATION_UNAVAILABLE)
      assert(result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
        result.side_effects === 'none' && !result.execution_verified && result.native_receipt != null,
      'execution_receipt_invalid');
    if (result.execution_verified) assert(result.status === 'succeeded' &&
      result.dispatch_stage === 'dispatched' && result.acknowledged_config != null &&
      result.native_receipt != null, 'executed_config_unacknowledged');
    if (result.task_verified) assert(result.execution_verified && result.task_quality === 'task_verified',
      'task_quality_upgrade_invalid');
    if (['reference_equivalent', 'reference_above'].includes(result.parity_state))
      assert(result.task_verified, 'parity_upgrade_invalid');
    if (result.operational_quality != null) {
      const q = result.operational_quality;
      assert(keys(q, ['schema', 'coverage', 'assessment_state', 'contract_sha256', 'witness_path',
        'witness_sha256', 'artifact_sha256', 'workspace_after_sha256', 'failed_check_ids',
        'corrective_attempts', 'local_only_verified']) && q.schema === 1 &&
        ['partial', 'full'].includes(q.coverage) &&
        ['execution_only', 'task_contract_verified', 'unverified', 'mismatch'].includes(q.assessment_state) &&
        [q.contract_sha256, q.witness_sha256, q.artifact_sha256, q.workspace_after_sha256].every(x => HASH.test(x)) &&
        boundedText(q.witness_path, 4096) && dirname(q.witness_path) === join(this.stateDir, 'quality-witnesses') &&
        basename(q.witness_path) === ticket.attempt_id + '.json' &&
        Array.isArray(q.failed_check_ids) && q.failed_check_ids.length <= 128 &&
        q.failed_check_ids.every(x => boundedText(x, 256) && !/\p{Cc}/u.test(x)) && new Set(q.failed_check_ids).size === q.failed_check_ids.length &&
        int(q.corrective_attempts, 0, 1) && typeof q.local_only_verified === 'boolean' &&
        q.corrective_attempts === (ticket.quality_continuation ? 1 : 0) &&
        result.execution_verified && result.native_turn_terminated === true &&
        (q.assessment_state === 'mismatch' ? q.failed_check_ids.length > 0 && !result.task_verified && result.task_quality === 'failed' : q.failed_check_ids.length === 0) &&
        (q.coverage !== 'partial' || q.assessment_state !== 'task_contract_verified') &&
        (result.task_verified === (q.assessment_state === 'task_contract_verified')) &&
        (result.task_quality === 'task_verified' ? q.assessment_state === 'task_contract_verified' : true) &&
        result.parity_state === 'unverified' && !result.handback && !result.repair_source,
      'operational_quality_invalid');
      if (q.assessment_state === 'task_contract_verified')
        assert(q.coverage === 'full' && result.task_verified, 'operational_quality_upgrade_invalid');
    }
    if (result.staged_writer != null) {
      const st = result.staged_writer;
      assert(ticket.staged_writer_envelope_sha256 != null && ticket.selected_config.scope === 'workspace_write' &&
        keys(st, ['state', 'receipt_path', 'receipt_sha256']) && ['applied', 'discarded', 'held'].includes(st.state) &&
        HASH.test(st.receipt_sha256 ?? '') && st.receipt_path === join(this.stateDir, 'staged-writer-receipts', ticket.attempt_id + '.json'),
      'staged_writer_record_invalid');
      // Exact private host receipt bytes, not the label or the model's self report.
      let fd;
      try {
        const directory = dirname(st.receipt_path), directoryStat = lstatSync(directory);
        assert(directoryStat.isDirectory() && !directoryStat.isSymbolicLink() && directoryStat.uid === process.getuid() &&
          (directoryStat.mode & 0o077) === 0 && realpathSync(directory) === join(realpathSync(this.stateDir), 'staged-writer-receipts'), 'staged_writer_receipt_directory_invalid');
        fd = openSync(st.receipt_path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = fstatSync(fd);
        assert(stat.isFile() && stat.uid === process.getuid() && stat.nlink === 1 &&
          (stat.mode & 0o077) === 0 && stat.size <= 128_000, 'staged_writer_receipt_custody_invalid');
        const raw = readFileSync(fd), receipt = JSON.parse(raw.toString('utf8'));
        assert(sha(raw) === st.receipt_sha256 && receipt.schema === 1 && receipt.task_id === ticket.task_id &&
          receipt.node_id === ticket.node_id && receipt.attempt_id === ticket.attempt_id &&
          receipt.configuration_sha256 === ticket.configuration_sha256 && receipt.state === st.state &&
          receipt.envelope_sha256 === ticket.staged_writer_envelope_sha256 && receipt.base_sha256 === ticket.staged_writer_base_sha256,
        'staged_writer_receipt_binding_invalid');
        if (st.state !== 'held') assert(receipt.local_only_verified === true && HASH.test(receipt.native_profile_sha256 ?? ''),
          'staged_writer_local_effects_unproven');
        if (st.state === 'discarded') assert(receipt.original_unchanged === true && receipt.native_turn_terminated === true &&
          result.side_effects === 'none' && result.native_turn_terminated === true && !result.task_verified &&
          result.error === 'native_staged_writer_discarded', 'staged_writer_discard_unproven');
        if (st.state === 'applied') assert(receipt.native_turn_terminated === true && receipt.checks_passed === true &&
          receipt.original_contract_sha256 === result.operational_quality?.contract_sha256 &&
          receipt.mapped_final_artifact_sha256 === result.operational_quality?.artifact_sha256 &&
          result.task_verified && result.native_turn_terminated === true &&
          result.operational_quality?.coverage === 'full' && result.operational_quality.assessment_state === 'task_contract_verified',
        'staged_writer_apply_unverified');
      } finally { if (fd !== undefined) closeSync(fd); }
    } else assert(ticket.staged_writer_envelope_sha256 == null || result.dispatch_stage !== 'dispatched', 'staged_writer_receipt_missing');
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

  /** R6: deliver one node's completed output with its quality disclosure: the
   * child completes (its dependents may use the output) and the task settles
   * returned_unverified. `attemptState` settles its attempt entry. */
  _deliverDisclosed(taskID, nodeID, result, disclosure, attemptState) {
    this._update(taskID, 'child_delivered_with_disclosure', snapshot => {
      const child = snapshot.children.find(c => c.id === nodeID);
      if (TERMINAL.has(snapshot.state) || !child) return;
      Object.assign(child, {state: 'completed', output: result.output, execution_verified: result.execution_verified,
        task_quality: result.task_quality, parity_state: 'unverified', native_receipt: result.native_receipt,
        native_summary: result.native_summary ?? null, usage: result.usage ?? null,
        operational_quality: result.operational_quality ?? null, quality_disclosure: disclosure,
        finished_at_ms: Date.now(), dispatched_at_ms: null});
      const attempt = child.attempt_history.find(entry => entry.attempt_id === result.attempt_id);
      if (attempt) {
        Object.assign(attempt, {state: attemptState, native_receipt: result.native_receipt, usage: result.usage ?? null});
        recordTurnSettlement(attempt, result);
      }
    });
  }

  /** The same task owner handles one known local writer correction. The
   * native host revalidates the frozen contract, content custody and enforced
   * task-effect boundary. Neither a model verdict nor an adapter retry owns it.
   * R6: when the correction is spent, refused, out of budget or unavailable,
   * the last completed output is delivered with its failed checks disclosed;
   * only a cancel or stop (or an output that cannot be delivered) holds it. */
  async _prepareQualityCorrection(taskID, node, candidate, result, parentTicket) {
    const q = result.operational_quality;
    this._update(taskID, 'quality_candidate_preserved', state => {
      const child = state.children.find(c => c.id === node.id);
      child.output = result.output; child.native_receipt = result.native_receipt;
      child.native_summary = result.native_summary ?? null; child.usage = result.usage ?? null;
      child.execution_verified = result.execution_verified; child.task_quality = 'failed';
      child.parity_state = 'unverified'; child.operational_quality = q;
      child.state = 'waiting'; child.dispatched_at_ms = null;
      Object.assign(child.attempt_history.at(-1), {state: 'quality_mismatch',
        native_receipt: result.native_receipt, usage: result.usage ?? null, operational_quality: q});
      recordTurnSettlement(child.attempt_history.at(-1), result);
      child.quality_history ??= [];
      child.quality_history.push({attempt_id: result.attempt_id, output: result.output,
        native_receipt: result.native_receipt, operational_quality: q});
      child.quality_continuation = {state: 'decision_pending', parent_attempt_id: result.attempt_id};
    });
    const hold = reason => {
      if (this.closed) return null;
      const before = this._load(taskID);
      const deliver = !before?.cancel_requested && !this.stopping && disclosable(result, candidate.scope);
      this._update(taskID, deliver ? 'quality_correction_disclosed' : 'quality_continuation_held', state => {
        if (TERMINAL.has(state.state)) return;
        const child = state.children.find(c => c.id === node.id);
        child.quality_continuation.state = 'held';
        child.finished_at_ms = Date.now();
        if (deliver && !state.cancel_requested) {
          child.state = 'completed'; child.quality_disclosure = qualityDisclosure(result, false);
          child.quality_correction_outcome = reason;
        } else { child.state = 'held'; child.hold_reason = reason; }
      });
      return null;
    };
    const snapshot = this._load(taskID), child = snapshot.children.find(c => c.id === node.id);
    if (snapshot.cancel_requested || this.stopping) return hold('quality_correction_cancelled');
    if (candidate.scope !== 'workspace_write' || !q.local_only_verified || !result.native_turn_terminated ||
        !result.execution_verified || result.status !== 'succeeded' || result.handback || result.repair_source ||
        q.corrective_attempts !== 0 || child.quality_corrective_attempts || parentTicket.quality_continuation)
      return hold('quality_correction_boundary_unverified_or_spent');
    if (child.attempts >= executionTask(snapshot).budget.max_attempts)
      return hold('quality_correction_attempt_budget_exhausted');
    if (typeof this.decideOperationalQuality !== 'function') return hold('quality_decider_unavailable');
    let receiptSHA;
    try { receiptSHA = await this._verifiedNativeReceiptDigest(result); }
    catch { return hold('quality_parent_receipt_unavailable'); }
    let decision;
    const remaining = executionTask(snapshot).budget.max_duration_ms -
      (Date.now() - snapshot.created_at_ms - ladderExemptMs(snapshot));
    if (remaining <= 0) return hold('quality_decision_duration_budget_exhausted');
    const controller = new AbortController(), controllerID = 'quality-decision-' + result.attempt_id;
    // This is a bounded read-only host command, never a provider retry. The
    // pinned nativeOperation aborts/kills its exact child and awaits close.
    const decisionTimer = setTimeout(() => controller.abort(new RCCRuntimeError('quality_decision_timeout')),
      Math.min(10_000, remaining));
    decisionTimer.unref?.();
    this.controllers.set(controllerID, {taskID, controller});
    try {
      decision = await this.decideOperationalQuality(immutable({schema: 1, parent_ticket: parentTicket,
        parent_native_receipt: result.native_receipt, parent_native_receipt_sha256: receiptSHA}), controller.signal);
      assert(!controller.signal.aborted, 'quality_decision_aborted');
      assert(keys(decision, ['schema', 'task_id', 'node_id', 'parent_attempt_id', 'action', 'reason', 'quality_continuation']) &&
        decision.schema === 1 && decision.task_id === taskID && decision.node_id === node.id &&
        decision.parent_attempt_id === result.attempt_id && ['correct', 'hold', 'none'].includes(decision.action) &&
        boundedText(decision.reason, 1024), 'quality_decision_invalid');
      const c = decision.quality_continuation;
      if (decision.action === 'correct') assert(keys(c, ['schema', 'parent_attempt_id', 'parent_native_receipt',
        'parent_native_receipt_sha256', 'witness_path', 'witness_sha256', 'expected_workspace_after_sha256',
        'original_instruction_sha256', 'corrective_attempts']) && c.schema === 1 && c.corrective_attempts === 1 &&
        c.parent_attempt_id === result.attempt_id && c.parent_native_receipt === result.native_receipt &&
        c.parent_native_receipt_sha256 === receiptSHA && c.witness_path === q.witness_path &&
        c.witness_sha256 === q.witness_sha256 && c.expected_workspace_after_sha256 === q.workspace_after_sha256 &&
        c.original_instruction_sha256 === sha(Buffer.from(node.instruction)), 'quality_continuation_binding_invalid');
      else assert(c == null, 'quality_decision_invalid');
    } catch { return hold(controller.signal.aborted ? 'quality_decision_aborted' : 'quality_decision_or_binding_unavailable'); }
    finally { clearTimeout(decisionTimer); this.controllers.delete(controllerID); }
    if (this.closed) return null;
    const current = this._load(taskID);
    if (current.cancel_requested || this.stopping || TERMINAL.has(current.state)) return hold('quality_correction_cancelled');
    if (decision.action !== 'correct') return hold(decision.reason);
    // Same exact row only; quota/source checks never authorize a different
    // model, effort, account, scope or reference route for a written workspace.
    try {
      const fresh = await this._refreshCatalog(taskID, [candidate.id]);
      const row = this._candidate(executionTask(current), fresh, node);
      assert(row.id === candidate.id && stable(exactConfig(row)) === stable(exactConfig(candidate)), 'quality_candidate_changed');
    } catch { return hold('quality_candidate_no_longer_available'); }
    const latest = this._load(taskID);
    if (latest.cancel_requested || this.stopping || TERMINAL.has(latest.state)) return hold('quality_correction_cancelled');
    this._update(taskID, 'quality_continuation_intent_recorded', state => {
      const target = state.children.find(c => c.id === node.id);
      target.quality_continuation = {state: 'pending', ...decision.quality_continuation};
      target.quality_corrective_attempts = 1;
    });
    return immutable(decision.quality_continuation);
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
      if (snapshot.children.find(c => c.id === node.id).attempts >= executionTask(snapshot).budget.max_attempts) {
        this._holdContinuation(taskID, node.id, 'continuation_attempt_budget_exhausted'); return;
      }
      if (Date.now() - snapshot.created_at_ms - ladderExemptMs(snapshot) >= executionTask(snapshot).budget.max_duration_ms) {
        this._holdContinuation(taskID, node.id, 'continuation_duration_budget_exhausted'); return;
      }
      // The ticket stays bound to the same row id; the ledger records the
      // refreshed row's quota at this continuation's own dispatch.
      let current;
      try {
        const fresh = await this._refreshCatalog(taskID, [candidate.id]);
        current = this._candidate(executionTask(snapshot), fresh, node);
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
        source_fingerprint: executionTask(snapshot).source_fingerprint,
        request_sha256: executionTask(snapshot).request_sha256};
      let route = null;
      const dispatchAdmitted = this._admitNativeDispatch(taskID, node.id, candidate, 'continuation_dispatch_started', state => {
        const child = state.children.find(c => c.id === node.id);
        child.state = 'running'; child.attempt_id = continuationAttemptID;
        child.attempts += 1; child.dispatched_at_ms = Date.now();
        child.continuation.state = 'dispatched';
        route = this._pendLedger(state, child, current, continuationAttemptID);
        child.attempt_history.push({attempt_id: continuationAttemptID,
          candidate_id: candidate.id, state: 'continuation_dispatch_started',
          native_receipt: null, usage: null, ledger: route});
      });
      if (!dispatchAdmitted) return;
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
    const explicitRoute = executionTask(snapshot).mode === 'explicit_routing_test';
    // A node the host resolved (any tier-routed explicit route included)
    // keeps its class, tier and escalation guard as evidence; a planner-chosen
    // explicit row (older catalog) has none.
    const routeClass = ROUTE_CLASSES.includes(child.routing_decision?.route_class) ?
      child.routing_decision.route_class : null;
    const kind = explicitRoute ? 'explicit_route' : routeClass === null ? 'adapter_bound' : child.route_kind ?? 'unrecorded';
    // A named route the host resolved keeps the route kind it ran as (tier,
    // reference, explicit); null otherwise (and absent in older records).
    const hostKind = explicitRoute && routeClass !== null && typeof child.route_kind === 'string' ? child.route_kind : null;
    const ladder = routeClass !== null && child.route_kind === 'tier' && child.ladder ?
      {cheap_effort: child.ladder.cheap_effort, reference_effort: child.ladder.reference_effort,
        cheap_model: child.ladder.cheap_model, reference_model: child.ladder.reference_model} : null;
    const observedTask = executionTask(snapshot);
    const qualityContract = snapshot.catalog?.task_contract?.contract_sha256;
    const outcomeContext = this.adaptivePolicy.mode === 'off' ? null : {
      identity: {task_id: observedTask.task_id, node_id: child.id,
        candidate_id: candidate.id, request_sha256: observedTask.request_sha256,
        source_fingerprint: observedTask.source_fingerprint, policy_sha256: observedTask.policy_sha256,
        configuration_sha256: candidate.configuration_sha256,
        quality_contract_sha256: HASH.test(qualityContract ?? '') ? qualityContract : null},
      selected_config: exactConfig(candidate)};
    return {route_class: routeClass, route_kind: kind, host_route_kind: hostKind, surface: candidate.surface,
      quota_pool: candidate.quota_pool, model: candidate.model, effort: candidate.effort, scope: candidate.scope,
      reference_effort: routeClass === null ? null : child.reference_effort ?? null, ladder,
      // The bound model's tier (null without one or on an older catalog) and
      // whether this attempt is the reference escalation of a descent.
      tier: routeClass === null ? null : child.routing_decision?.tier ?? null,
      escalated: routeClass !== null && child.ladder?.escalated === true,
      quota_remaining_fraction: candidate.quota_remaining_fraction, dispatched_at_ms: child.dispatched_at_ms ?? null,
      verifier: Boolean(this._nodeVerifier(snapshot, child.id, candidate)),
      ...(outcomeContext === null ? {} : {outcome_context: outcomeContext})};
  }
  /** Inside a dispatch update: fix the attempt's route facts and mark the
   * attempt pending in the same transaction, so an attempt that is never
   * settled by this owner (stop, crash) is recorded once at restart. */
  _pendLedger(snapshot, child, candidate, attemptID) {
    const route = this._ledgerRoute(snapshot, child, candidate);
    this.db.prepare('INSERT OR REPLACE INTO ledger_pending(attempt_id,task_id,node_id,route) VALUES(?,?,?,?)')
      .run(attemptID, executionTask(snapshot).task_id, child.id, stable(route));
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
  /** One routing-ledger record. `escalationOutcome`: on a certified descent
   * that failed, what its one escalation did ('escalated', or the
   * typed hold reason when the node was held instead); null on every other
   * attempt. `dispatchedFailure` 'no_effects': the executor reported that the
   * attempt failed after dispatch with no side effects (the node is still
   * never replayed); null on every other attempt. `host_route_kind` and
   * `dispatched_failure` are optional: older records lack them. */
  _ledgerRecord({taskID, nodeID, attemptID, route}, outcome, verifierOutcome, attemptState, escalationOutcome = null,
                dispatchedFailure = null) {
    const record = {schema: 1, task_id: taskID, node_id: nodeID, attempt_id: attemptID,
      family: routeFamily(route.route_class, route.scope, route.surface), route_class: route.route_class,
      scope: route.scope, surface_kind: surfaceKind(route.surface), surface: route.surface,
      quota_pool: route.quota_pool, model: route.model, effort: route.effort, route_kind: route.route_kind,
      host_route_kind: typeof route.host_route_kind === 'string' ? route.host_route_kind : null,
      reference_effort: route.reference_effort, ladder: route.ladder, tier: route.tier ?? null,
      escalated: route.escalated === true, usage: outcome.usage ?? null,
      quota_remaining_fraction: route.quota_remaining_fraction,
      execution_verified: outcome.execution_verified === true, task_quality: outcome.task_quality ?? null,
      verifier_outcome: verifierOutcome, attempt_state: attemptState,
      escalation_outcome: typeof escalationOutcome === 'string' && /^[a-z0-9_:]{1,128}$/.test(escalationOutcome) ?
        escalationOutcome : null,
      dispatched_failure: dispatchedFailure === 'no_effects' ? 'no_effects' : null,
      dispatched_at_ms: route.dispatched_at_ms, settled_at_ms: Date.now(),
      ...(outcome.routing_outcome_summary ? {routing_outcome: outcome.routing_outcome_summary} : {})};
    // Full capture is in the existing attempt row; optional metadata must not
    // turn a bounded legacy ledger/failure entry into a lost oversize record.
    if (record.routing_outcome && Buffer.byteLength(stable(record)) + 1 > MAX_LEDGER_RECORD_BYTES)
      delete record.routing_outcome;
    return record;
  }
  _outcomeSummary(capture) {
    if (!capture) return null;
    return {schema: 1, status: capture.status, reason: capture.reason,
      outcome_id: capture.record?.outcome_id ?? null,
      normalized_sha256: capture.record?.normalized_sha256 ?? null,
      adapter_receipt_sha256: capture.capture?.adapter_receipt_sha256 ?? null,
      // Scope/type of the traffic is not declared by this initial observation
      // path. A native return is not enough to label a training example.
      origin: 'unknown', correctness_label: null, learning_eligible: false, parity_state: 'unverified'};
  }
  /** Whether a ledger record that could not be written must wait in the
   * backlog: a parity failure, so the never-rotated failure index stays
   * complete for the offline class measurement. */
  _backlogged(record) {
    return LEDGER_FAILURE_OUTCOMES.has(record?.verifier_outcome);
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
      let outcomeCapture = null;
      if (pending.route.outcome_context) {
        // Frozen dispatch-time selected config, not a child after escalation.
        // This bounded optional source read never edits execution/adoption.
        try {
          outcomeCapture = captureRoutingOutcome({stateDir: this.stateDir,
            identity: {...pending.route.outcome_context.identity, attempt_id: attemptID},
            selectedConfig: pending.route.outcome_context.selected_config,
            result, attemptState: settled, origin: 'unknown', now_ms: Date.now()});
          if (!this.closed && entry) this._update(pending.taskID, 'routing_outcome_observed', snapshot => {
            const own = snapshot.children.find(c => c.id === pending.nodeID)?.attempt_history
              .find(a => a.attempt_id === attemptID);
            if (own && !own.routing_outcome) own.routing_outcome = outcomeCapture;
          });
        } catch { /* Optional observation cannot invalidate the original result. */ }
      }
      // Built once: a retry writes the same record (its settled time too).
      record = this._ledgerRecord(pending, {usage: result?.usage ?? null,
        execution_verified: result?.execution_verified, task_quality: result?.task_quality ?? null,
        routing_outcome_summary: this._outcomeSummary(outcomeCapture)},
      verifierOutcome, settled, entry?.escalation_outcome ?? null, entry?.dispatched_failure ?? null);
      write = () => this.ledger.append(record);
      write();
    } catch (error) {
      this._logLedger(error);
      // The pending row stays for the restart; a parity failure is also
      // retried by this process before every later record.
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
  /** Retry backlogged records (parity failures whose ledger write failed),
   * oldest first; stop at the first that still fails. */
  _flushLedgerBacklog() {
    for (const [attemptID, write] of this.ledgerBacklog) {
      try { write(); } catch (error) { this._logLedger(error); return; }
      this.ledgerBacklog.delete(attemptID);
      this._clearLedgerPending(attemptID);
    }
  }
  /** The registered verifier for a resolved read-only node's family, if any. */
  _nodeVerifier(snapshot, nodeID, candidate) {
    const child = this._resolverNode(snapshot, nodeID);
    if (!child || candidate.scope !== 'read_only' || this.verifierRegistry.size === 0) return null;
    const family = routeFamily(child.routing_decision.route_class, candidate.scope, candidate.surface);
    const verify = this.verifierRegistry.get(family);
    return typeof verify === 'function' ? {verify, family} : null;
  }
  /** Run the family verifier on a returned read-only node. Pass adopts it;
   * a certified descent that fails goes to _ladderFailed (R9). A rejected
   * reference or explicit route is delivered with its disclosure (R6), never
   * replayed; only an undisclosable record (an unterminated turn, reported
   * effects) is held. Returns the ledger outcome. */
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
    if (!passed && disclosable(result, candidate.scope)) {
      const disclosure = qualityDisclosure(result, false);
      disclosure.failed_check_ids = ['node_verifier', ...disclosure.failed_check_ids].slice(0, MAX_DISCLOSED_CHECKS);
      this._update(taskID, 'node_verifier_failed_disclosed', snapshot => {
        const target = snapshot.children.find(c => c.id === node.id);
        if (target?.state !== 'waiting' || target.attempt_id !== result.attempt_id) return;
        Object.assign(target, {state: 'completed', node_verifier: outcome, quality_disclosure: disclosure,
          parity_state: 'unverified'});
        const attempt = target.attempt_history.find(entry => entry.attempt_id === result.attempt_id);
        if (attempt) { attempt.state = 'completed'; attempt.verifier = outcome; }
      });
      return outcome;
    }
    this._update(taskID, passed ? 'node_verifier_passed' : 'node_verifier_failed', snapshot => {
      const target = snapshot.children.find(c => c.id === node.id);
      if (target?.state !== 'waiting' || target.attempt_id !== result.attempt_id) return;
      target.state = passed ? 'completed' : 'held'; target.node_verifier = outcome;
      if (!passed) {
        target.hold_reason = 'node_verifier_failed';
        target.task_quality = 'failed'; target.parity_state = 'unverified';
      }
      const attempt = target.attempt_history.find(entry => entry.attempt_id === result.attempt_id);
      if (attempt) { attempt.state = target.state; attempt.verifier = outcome; }
    });
    return outcome;
  }
  /** A certified descent failed (R9): its verifier failed ('fail') or its
   * admitting source did not accept the answer ('not_returned'). Its output
   * is never adopted. Once, read-only, not stopping or cancelled, and only
   * when the attempt dispatched and reported no side effects, the node
   * returns to the queue bound to its reference row. A descent that finds no
   * reference in its bound catalog (its rows may have outlived their validity
   * window while the cheaper attempt ran) refreshes the catalog once and
   * looks again before it gives up. Otherwise ONLY this child is held (cancelled under a
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
      !child.ladder || child.ladder.escalated || !(candidate.scope === 'read_only' || stagedWriterDiscarded(result)) ?
        'ladder_verifier_failed_reference_unavailable' : null;
    let found = current();
    if (!found) return;
    let reason = holdReason(found);
    for (let pass = 0; reason === null; pass++) {
      try { this._escalateLadder(taskID, node.id, result.attempt_id, outcome); return; }
      catch (error) { reason = error instanceof RCCRuntimeError ? error.code : 'ladder_reference_unavailable'; }
      if (pass > 0 || reason !== 'ladder_reference_unavailable' || this.closed ||
          typeof this.catalog !== 'function') break;
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
  /** Once, read-only only: the certified descent failed, so the node returns
   * to the queue bound to its reference row, admitted with the plan so a
   * sibling's refresh cannot lose it: its pool's reference, or another pool's
   * when that one cannot dispatch now. The returned output is never adopted,
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
    const explicitRoute = executionTask(snapshot).mode === 'explicit_routing_test';
    let reference = find(child.ladder?.reference_candidate_id);
    if (child.ladder?.source === 'tier' && node && cheap) {
      const now = Date.now();
      const offered = reference && snapshot.catalog.candidates.find(c => c.id === reference.id);
      if (!(offered && dispatchable(offered, executionTask(snapshot), now))) {
        // Now, else as last observed: the bound catalog's rows may have
        // outlived their validity window while the cheaper attempt ran, and
        // that must not make a reference observed then look unavailable
        // (dispatch refreshes and re-checks the row before anything runs).
        for (const at of [now, snapshot.catalog_bound_at_ms]) {
          if (!Number.isSafeInteger(at)) continue;
          try {
            reference = selectRouteCandidate(node, executionTask(snapshot), snapshot.catalog, at,
              {referenceOnly: true, preferPool: cheap.quota_pool, avoidIDs: [cheap.id]}).candidate;
            break;
          } catch { /* Keep the admitted reference row, if any: dispatch re-resolves it. */ }
        }
      }
    }
    assert(child.ladder?.source === 'tier' && node && cheap && reference &&
      (node.scope === 'read_only' || (node.scope === 'workspace_write' && stagedWriterContract(snapshot.catalog.task_contract))) &&
      reference.scope === node.scope && reference.id !== cheap.id && reference.surface !== 'local' &&
      (!explicitRoute || reference.surface === cheap.surface), 'ladder_reference_unavailable');
    const next = {...snapshot.plan, nodes: snapshot.plan.nodes.map(n =>
      n.id === nodeID ? {...n, candidate_id: reference.id} : n)};
    const rows = snapshot.catalog.candidates.some(c => c.id === reference.id) ? snapshot.catalog :
      {...snapshot.catalog, candidates: [...snapshot.catalog.candidates, reference]};
    const plan = validatePlan(next, admittedTask(snapshot), repairCatalog(snapshot, next, rows, [nodeID]));
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
      target.ladder = {...target.ladder, escalated: true, reference_candidate_id: reference.id,
        reference_model: reference.model, reference_effort: reference.effort};
      const why = (outcome === 'fail' ? 'tier_escalated_after_verifier_failure' : 'tier_escalated_after_failure_signal') +
        ';route_reference;' + admissionToken(ESCALATION_ADMISSION) + ';tier_' + (tierOf(state.catalog, reference.model) ?? 'frontier') +
        (reference.quota_pool === cheap.quota_pool ? ';same_pool' : ';other_pool');
      target.routing_decision = withInstructionLock(target, routingDecision(target.routing_decision.route_class, reference,
        why + ';effort_' + reference.effort + ';' + surfaceToken(reference), target.ladder,
        tierOf(state.catalog, reference.model) ?? 'frontier'));
    });
  }

  /** Admission budget for native EXECUTOR submissions, not an estimate of
   * backend API calls, automatic subagents or quota percentages. The count is
   * committed with dispatch intent before execute is invoked; ambiguity,
   * pre-execution failure and ladder exemptions never refund it. No await may
   * separate this admission from its transactional intent update. */
  _admitNativeDispatch(taskID, nodeID, candidate, event, update) {
    const native = candidate.transport !== 'local';
    const current = this._load(taskID), cap = executionTask(current).budget.max_native_dispatches;
    const count = snapshot => snapshot.native_dispatches ?? snapshot.children.reduce((total, child) =>
      total + (child.attempt_history ?? []).filter(entry => {
        const row = snapshot.catalog?.candidates.find(c => c.id === entry.candidate_id) ??
          snapshot.bound_rows?.[entry.candidate_id];
        return row?.transport !== 'local'; // unknown old rows are conservative
      }).length, 0);
    if (native && cap != null && count(current) >= cap) {
      this._update(taskID, 'native_dispatch_budget_exhausted', snapshot => {
        const child = snapshot.children.find(c => c.id === nodeID);
        child.state = 'held'; child.hold_reason = 'native_dispatch_budget_exhausted';
        child.dispatched_at_ms = null; child.finished_at_ms = Date.now();
        // Already-dispatched siblings retain their result/receipt custody.
        if (siblingRunning(snapshot, nodeID)) return;
        snapshot.state = 'held'; snapshot.error = 'native_dispatch_budget_exhausted';
      });
      return false;
    }
    this._update(taskID, event, snapshot => {
      if (native) {
        const observed = count(snapshot);
        assert(cap == null || observed < cap, 'native_dispatch_budget_raced');
        snapshot.native_dispatches = observed + 1;
      }
      update(snapshot);
    });
    return true;
  }

  /** `releaseReservation` (idempotent) frees this node's worker slot and pool
   * reservation once no provider work runs for it, before a node verifier. */
  async _executeNode(taskID, node, candidate, releaseReservation = null, qualityContinuation = null) {
    const task = executionTask(this._load(taskID));
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
      if (qualityContinuation) {
        const stored = before.children.find(c => c.id === node.id).quality_continuation;
        assert(stored?.state === 'pending' && stored.parent_attempt_id === qualityContinuation.parent_attempt_id &&
          stored.witness_sha256 === qualityContinuation.witness_sha256, 'quality_continuation_intent_missing');
        ticket.native_resume_session_id = null;
        ticket.quality_continuation = immutable(qualityContinuation);
      }
      let route = null;
      const dispatchAdmitted = this._admitNativeDispatch(taskID, node.id, candidate, qualityContinuation ? 'quality_dispatch_started' : 'dispatch_started', snapshot => {
        const child = snapshot.children.find(c => c.id === node.id);
        child.state = 'running'; child.attempt_id = attemptID; child.attempts += 1;
        child.dispatched_at_ms = Date.now();
        child.started_at_ms ??= child.dispatched_at_ms;
        if (qualityContinuation) child.quality_continuation.state = 'dispatched';
        child.selected_config = exactConfig(candidate);
        // The route facts the routing ledger records for this attempt, fixed
        // at dispatch (a later escalation or re-resolution changes the child).
        route = this._pendLedger(snapshot, child, candidate, attemptID);
        child.attempt_history.push({attempt_id: attemptID, candidate_id: candidate.id,
          state: qualityContinuation ? 'quality_dispatch_started' : 'dispatch_started', native_receipt: null, usage: null, ledger: route});
        if (candidate.estimated_cost_units !== null) snapshot.spent_cost_units += candidate.estimated_cost_units;
      });
      if (!dispatchAdmitted) return;
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
            const reason = error instanceof RCCRuntimeError ? error.code : 'executor_return_unknown';
            child.uncertain_error = reason;
            if (siblingRunning(snapshot, node.id)) return;
            snapshot.state = 'effects_uncertain';
            snapshot.error = reason;
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
            const notDispatched = result.status === 'failed' && result.dispatch_stage === 'not_dispatched' &&
              result.side_effects === 'none' && result.native_receipt !== null;
            // The local model surface is tools-free, read-only and quota-free:
            // a completion that its executor attests ended (aborted) with no
            // side effects changed nothing, so its cancel is safe as well.
            const localEnded = localWorkerRow(candidate) && result.side_effects === 'none' &&
              result.native_turn_terminated === true && result.native_receipt !== null;
            const safe = notDispatched || localEnded;
            child.state = safe ? 'cancelled' : 'effects_uncertain';
            child.finished_at_ms = Date.now();
            child.attempt_history.at(-1).state = child.state;
            child.attempt_history.at(-1).native_receipt = result.native_receipt;
            // Settled only when the adapter attests the turn ended
            // (settledReadOnly): a cancelled Codex Desktop turn may still run.
            recordTurnSettlement(child.attempt_history.at(-1), result);
            child.usage = result.usage ?? null;
            child.attempt_history.at(-1).usage = result.usage ?? null;
            // A sibling still running reconciles its own record first: the
            // task becomes terminal with the last one, so no sibling's record
            // is dropped and no running child keeps its pool's lease. (A
            // service stop keeps its first-record rule: no later record lands.)
            if (snapshot.cancel_requested && !this.stopping && siblingRunning(snapshot, node.id)) return;
            const uncertain = snapshot.children.some(c => c.state === 'effects_uncertain');
            // A route still queued behind a busy pool never starts now.
            for (const other of snapshot.children)
              if (other.state === 'queued' || (other.state === 'waiting' && other.dispatched_at_ms === null)) other.state = 'cancelled';
            snapshot.state = uncertain ? 'effects_uncertain' : 'cancelled';
            snapshot.error = uncertain ? 'cancel_effects_uncertain' : notDispatched ?
              'cancelled_before_backend_dispatch' : 'cancelled_without_effects';
          });
          return;
        }
        const recorded = current.children.find(c => c.id === node.id);
        const descent = pendingEscalation(recorded);
        const mismatch = result.operational_quality?.assessment_state === 'mismatch';
        if (result.staged_writer && result.staged_writer.state !== 'applied') {
          const safe = stagedWriterDiscarded(result);
          verifierOutcome = safe ? 'fail' : 'not_returned';
          this._update(taskID, 'staged_writer_not_applied', snapshot => {
            const child = snapshot.children.find(c => c.id === node.id);
            Object.assign(child, {state: descent && safe ? 'waiting' : 'held', output: null,
              execution_verified: false, task_quality: 'unverified', parity_state: 'unverified',
              native_receipt: result.native_receipt, native_summary: null, usage: result.usage ?? null,
              hold_reason: result.error ?? 'staged_writer_not_applied', dispatched_at_ms: null});
            Object.assign(child.attempt_history.at(-1), {state: safe ? 'ladder_verifier_failed' : 'staged_writer_held',
              native_receipt: result.native_receipt, usage: result.usage ?? null, staged_writer: result.staged_writer});
            recordTurnSettlement(child.attempt_history.at(-1), result);
          });
          if (descent && safe) await this._ladderFailed(taskID, node, candidate, result, 'fail');
          return;
        }
        if (!descent && (mismatch || result.error === 'native_operational_quality_unverified' ||
            result.error === 'native_operational_quality_mismatch')) {
          // R6: a reference (or owner-chosen) node's completed output is the
          // floor. Only an owner-declared local-only contract runs the one
          // same-row writer correction; any other failed check, and a checker
          // (or custody) that was unavailable, delivers the output with a
          // disclosure. Neither is a model-quality signal or permission to
          // escalate or replay a completed writer. A certified descent's
          // failed or unverified check falls to R9 below (one escalation).
          if (mismatch) {
            // Persist/settle the failed candidate before any correction.
            this._recordLedger(attemptID, result, 'not_registered', 'quality_mismatch');
            if (candidate.scope === 'workspace_write' && result.operational_quality.local_only_verified) {
              const continuation = await this._prepareQualityCorrection(taskID, node, candidate, result, ticket);
              if (continuation) await this._executeNode(taskID, node, candidate, releaseReservation, continuation);
              return;
            }
          }
          if (disclosable(result, candidate.scope)) {
            this._deliverDisclosed(taskID, node.id, result, qualityDisclosure(result, !mismatch),
              mismatch ? 'quality_mismatch' : 'completed');
            return;
          }
          // Reported or unsettled effects, or nothing returned: held.
          this._update(taskID, 'operational_checker_held', snapshot => {
            const child = snapshot.children.find(c => c.id === node.id);
            Object.assign(child, {state: 'held', hold_reason: result.error, output: result.output,
              execution_verified: result.execution_verified, task_quality: result.task_quality,
              parity_state: 'unverified', native_receipt: result.native_receipt,
              native_summary: result.native_summary ?? null, usage: result.usage ?? null,
              operational_quality: result.operational_quality ?? null, finished_at_ms: Date.now(), dispatched_at_ms: null});
            const attempt = child.attempt_history.find(entry => entry.attempt_id === result.attempt_id);
            if (attempt) {
              attempt.state = mismatch ? 'quality_mismatch' : 'operational_checker_held';
              Object.assign(attempt, {native_receipt: result.native_receipt, usage: result.usage ?? null});
              recordTurnSettlement(attempt, result);
            }
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
          // output an escalation may still have to replace.
          const verifier = this._nodeVerifier(current, node.id, candidate);
          // R9: a certified descent is deliverable only when the source that
          // admitted it accepts THIS answer (certifiedAnswer); anything else
          // (empty, error, partial, mismatch, unverified) is discarded, never
          // held for return, and the node runs once at its reference.
          const deliverable = result.execution_verified &&
            ['execution_only', 'task_verified'].includes(result.task_quality) &&
            boundedText(result.output, MAX_OUTPUT_BYTES) && (!descent || certifiedAnswer(recorded.ladder, result));
          const discard = !deliverable && descent;
          this._update(taskID, 'child_returned', snapshot => {
            const child = snapshot.children.find(c => c.id === node.id);
            child.output = discard ? null : result.output;
            child.execution_verified = discard ? false : result.execution_verified;
            child.task_quality = discard ? 'unverified' : result.task_quality;
            child.parity_state = discard ? 'unverified' : result.parity_state;
            child.operational_quality = result.operational_quality ?? null;
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
          verifierOutcome = result.task_verified && result.operational_quality?.coverage === 'full' &&
            result.operational_quality.assessment_state === 'task_contract_verified' ? 'pass' : 'not_registered';
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
          if (HELD_PRE_DISPATCH_ERRORS.has(typedError)) {
            this._update(taskID, 'child_pre_dispatch_held', snapshot => {
              const child = snapshot.children.find(c => c.id === node.id);
              child.state = 'held'; child.hold_reason = typedError;
              child.repair_needed = false; child.dispatched_at_ms = null;
              child.output = null; child.execution_verified = false;
              child.task_quality = 'unverified'; child.parity_state = 'unverified';
              child.native_receipt = result.native_receipt; child.native_summary = null;
              Object.assign(child.attempt_history.at(-1), {state: 'verified_not_dispatched',
                error: typedError, native_receipt: result.native_receipt, usage: result.usage ?? null});
              child.usage = result.usage ?? null; child.finished_at_ms = Date.now();
            });
            return;
          }
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
            child.failure_reason = 'verified_not_dispatched_retry_exhausted';
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
          // Any dispatched failure while a sibling runs: the DAG
          // settles the task after that sibling's record is reconciled (its
          // answer kept, its lease released), with this child's reason. An
          // unsettled native turn still quarantines its pool; waiting for the
          // sibling never supplies a made-up settlement for that turn.
          if (siblingRunning(snapshot, node.id)) {
            child.uncertain_error = 'dispatched_failure_no_replay'; return;
          }
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
      const child = snapshot.children.find(c => c.id === node.id);
      child.state = 'failed'; child.failure_reason = 'verified_not_dispatched_retry_exhausted';
    });
  }

  async _settleTask(taskID) {
    const snapshot = this._load(taskID);
    if (!snapshot || snapshot.cancel_requested || snapshot.state !== 'running') return;
    // Defense for legacy/in-memory plans: retain every child artifact but do
    // not guess a final owner or relabel intermediate outputs as the answer.
    try { assertFinalOutputOwnership(snapshot.plan, admittedTask(snapshot), {collectionMayBeOrdered: true}); }
    catch (error) { this._hold(taskID, error.code ?? 'plan_final_ownership_invalid'); return; }
    const byID = new Map(snapshot.children.map(c => [c.id, c]));
    const ordered = snapshot.plan.nodes.map(n => byID.get(n.id));
    // A single native answer is already the user's result. Never add a node
    // label: exact-output tasks (including "Reply with hello only") must
    // preserve the returned bytes. Explicit routes or an admitted null Core
    // collection emit every labelled result; other DAGs have one final owner.
    const candidateOutput = snapshot.plan.final_node_id ? byID.get(snapshot.plan.final_node_id)?.output :
      ordered.length === 1 ? ordered[0].output :
        ordered.map(c => `${c.id}: ${c.output}`).join('\n\n');
    const output = candidateOutput ?? '';
    if (!boundedText(output, MAX_OUTPUT_BYTES)) {
      this._hold(taskID, 'combined_output_empty_or_oversize'); return;
    }
    const only = ordered.length === 1 ? ordered[0] : null;
    // R6: a delivered child that carries a quality disclosure keeps the whole
    // task returned_unverified, whatever a parent verifier says.
    const disclosed = ordered.some(c => c.quality_disclosure != null);
    const originalContractVerified = only?.execution_verified && only?.task_quality === 'task_verified' &&
      only?.operational_quality?.coverage === 'full' &&
      only.operational_quality.assessment_state === 'task_contract_verified' &&
      snapshot.plan.nodes[0].instruction === admittedTask(snapshot).request;
    if (typeof this.verifyTask !== 'function' && !originalContractVerified) {
      let receipt;
      try { receipt = await this._aggregateReceipt(taskID, ordered, output); }
      catch { this._hold(taskID, 'aggregate_receipt_unavailable'); return; }
      this._hold(taskID, disclosed ? 'child_quality_disclosed' : 'parent_task_verifier_unavailable', {
        output, execution_verified: true, task_verified: false,
        task_quality: 'execution_only', parity_state: 'unverified', native_receipt: receipt,
        native_summary: ordered.length === 1 ? ordered[0].native_summary : null,
        native_summaries: ordered.flatMap(c => c.native_summaries ??
          (c.native_summary ? [c.native_summary] : []))});
      return;
    }
    let verdict;
    try {
      verdict = originalContractVerified ? {schema: 1, task_id: taskID, task_verified: true,
        output, parity_state: 'unverified', reason: 'exact_original_operational_contract_verified'} :
        await this.verifyTask({task: immutable(admittedTask(snapshot)), plan: immutable(snapshot.plan),
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
    const verified = !disclosed && verdict.task_verified === true && verdict.output !== null;
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
        parity_state: disclosed ? 'unverified' : verdict.parity_state, native_receipt: receipt,
        native_summary: ordered.length === 1 ? ordered[0].native_summary : null,
        native_summaries: ordered.flatMap(c => c.native_summaries ??
          (c.native_summary ? [c.native_summary] : []))};
      state.error = verified ? null : disclosed ? 'child_quality_disclosed' : verdict.reason;
    });
  }

  async close({timeoutMs = 3_000} = {}) {
    if (this.closed) return;
    assert(int(timeoutMs, 0, 60_000), 'close_timeout_invalid');
    this.stopping = true;
    for (const item of this.controllers.values()) item.controller.abort(new RCCRuntimeError('runtime_closing'));
    for (const item of this.intentControllers.values()) item.controller.abort(new RCCRuntimeError('runtime_closing'));
    await Promise.race([Promise.allSettled([...this.runningTasks.values(), ...this.installationObservations.values(),
      ...[...this.intentControllers.values()].map(item => item.promise)]),
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
        if (snapshot.intent_resolution_state === 'resolving') {
          snapshot.intent_resolution_state = 'held'; snapshot.intent_resolution_error = snapshot.error;
        }
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
