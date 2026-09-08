#!/usr/bin/env node
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { getInstagramSuppressionForUsername } = require(path.join(__dirname, 'instagram-thread-suppression.js'))
const {
  getAdaptiveReactionRate,
  recordLearningOutcome
} = require(path.join(__dirname, 'dm-learning-sidecar.js'))
const {
  SCV_CONTRACT_HARNESS_LOCK_VERSION,
  SCV_CONTRACT_HARNESS_LOCKED
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  SCV_DELIVERY_PACING_LOCK_VERSION,
  pacingSettingsFromEnv
} = require(path.join(__dirname, 'scv-delivery-pacing.js'))
const {
  SCV_HARD_HARNESS_LOCK_VERSION
} = require(path.join(__dirname, 'scv-hard-harness-lock.js'))
const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  SCV_CONTROL_EPOCH,
  recordIngressEvent
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  summarizeDeliveryVisibility,
  VISIBILITY_CONFIRMATION_SOURCES
} = require(path.join(__dirname, 'scv-delivery-visibility.js'))
const {
  getInstagramRuntimeStatus
} = require(path.join(__dirname, 'instagram-thread-runtime.js'))
const {
  debugResetBoundaryVerdict
} = require(path.join(__dirname, 'scv-test-account-purge.js'))
const {
  recoveryQueueSafetyVerdict
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))
const {
  diskNeedsEmergencyRelief,
  emergencyDiskRelief
} = require(path.join(__dirname, 'scv-disk-guardian.js'))
const {
  SCV_SINGLE_RELEASE_PROTOCOL,
  isSingleReleaseRequested,
  verifySingleRelease,
  singleReleaseRuntimeIdentityVerdict
} = require(path.join(__dirname, 'scv-single-release.js'))
const {
  modelContractVerdict,
  modelReadinessReceipt,
  runtimeBehaviorContractVerdict
} = require(path.join(__dirname, 'scv-runtime-behavior-contract.js'))
const SINGLE_RELEASE_REQUESTED = isSingleReleaseRequested(process.env)
let runScvGoldenSnapshotGuard
let runScvImmutableDriftFirewall
let runGoldenReleaseVerification
let releaseMode
let readReleaseManifest
if (!SINGLE_RELEASE_REQUESTED) {
  ;({ runScvGoldenSnapshotGuard } = require(path.join(
    __dirname, 'scv-golden-snapshot-guard.js'
  )))
  ;({ runScvImmutableDriftFirewall } = require(path.join(
    __dirname, 'scv-immutable-drift-firewall.js'
  )))
  ;({
    runGoldenReleaseVerification,
    releaseMode,
    readReleaseManifest
  } = require(path.join(__dirname, 'scv-golden-release.js')))
}
const {
  runtimeNamespaceFromEnv,
  runScvRuntimeNamespaceGuard
} = require(path.join(__dirname, 'scv-runtime-namespace.js'))
const {
  SCV_API_PROMPT_AUTHORITY_LOCK_VERSION,
  apiPromptAuthorityReceipt
} = require(path.join(__dirname, 'scv-api-prompt-authority.js'))
const {
  readFailClose
} = require(path.join(__dirname, 'scv-golden-fail-close.js'))
const {
  pauseDebugAccountsEnabled,
  pauseEnabled,
  pauseAll
} = require(path.join(__dirname, 'scv-pause-gate.js'))
const {
  CAPABILITY_MODE_WITHHELD,
  CAPABILITY_MODE_PROVIDER_BOUND,
  stagingCapabilityBoundary
} = require(path.join(__dirname, 'scv-staging-capability-boundary.js'))
const {
  collectTrustedMediaUrls
} = require(path.join(__dirname, 'scv-media-url-policy.js'))
const {
  legacyFallbackEligible,
  verifyLegacyManyChatIngress,
  commitReplayLedger,
  releaseReplayReservation
} = require(path.join(__dirname, 'scv-manychat-legacy-ingress.js'))

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return

  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue

    const idx = trimmed.indexOf('=')
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key && !process.env[key]) {
      process.env[key] = value
    }
  }
}

loadLocalEnv()

const PORT = Number(process.env.SCV_INBOUND_PORT || process.env.PORT || 3000)
const BIND_HOST = process.env.SCV_BIND_HOST || '127.0.0.1'
const ROOT = process.env.SCV_ROOT || __dirname
const INBOX_DIR = path.join(ROOT, 'inbox')
const OUTBOX_DIR = path.join(ROOT, 'outbox')
const REACTBOX_DIR = path.join(ROOT, 'reactbox')
const REACTBOX_DONE_DIR = path.join(ROOT, 'reactbox_done')
const REACTBOX_FAILED_DIR = path.join(ROOT, 'reactbox_failed')
const THREAD_STATE_DIR = path.join(ROOT, 'thread-state')
const THREAD_HISTORY_DIR = path.join(ROOT, 'thread-history')
const OUTBOX_HUMAN_AGENT_REQUIRED_DIR = path.join(ROOT, 'outbox_human_agent_required')
const RUNTIME_GUARD_DIRS = [
  'inbox',
  'outbox',
  'reactbox',
  'reactbox_done',
  'reactbox_failed',
  'logs',
  'thread-state',
  'thread-state_pre_migration',
  'thread-history',
  'thread-state_quarantine_contaminated',
  'thread-history_quarantine_contaminated',
  'inbox_quarantine_superseded',
  'inbox_quarantine_deadletter',
  'outbox_quarantine_stale',
  'outbox_quarantine_non_authoritative',
  'outbox_quarantine_contract_harness',
  'outbox_quarantine_failed',
  'outbox_human_agent_required',
  'outbox_quarantine_pre_single_control',
  'outbox-idempotency',
  'control-events',
  'control-decisions',
  'control-locks',
  'form-submissions',
  // v122 persistence P1 (2026-08-30): these four runtime surfaces were created
  // by workers under ephemeral /app and lost on every deploy/restart —
  // accepted-unverified boundary observations, in-flight delivery publications,
  // and both corrupt quarantines must survive restarts like every other queue.
  'accepted-unverified-boundary-pending',
  'accepted-unverified-delivery-publications',
  'inbox_quarantine_corrupt',
  'outbox_quarantine_corrupt_adoption'
]
const LOG_DIR = path.join(ROOT, 'logs')
const RAW_INBOUND_AUDIT = path.join(LOG_DIR, 'inbound-raw.ndjson')
const LAST_DELIVERY_FILE = path.join(LOG_DIR, 'last-delivery.json')
const DRIFT_STATUS_FILE = path.join(LOG_DIR, 'drift-status.json')
const CAPABILITY_STATUS_FILE = path.join(LOG_DIR, 'capability-canary-status.json')
const MANYCHAT_SUBSCRIBER_INFO_OFFICIAL_URL = 'https://api.manychat.com/fb/subscriber/getInfo'
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY || ''
const SCV_REACTION_ENABLED = !/^(0|false|off)$/i.test(String(process.env.SCV_REACTION_ENABLED || '1'))
const SCV_REACTION_RATE = Math.max(0, Math.min(0.5, Number(process.env.SCV_REACTION_RATE || '0.38')))
const SCV_REACTION_EMOJI = String(process.env.SCV_REACTION_EMOJI || '❤️').trim() || '❤️'
const SCV_REACTION_DELAY_MIN_MS = Math.max(0, Number(process.env.SCV_REACTION_DELAY_MIN_MS || '8000'))
const SCV_REACTION_DELAY_MAX_MS = Math.max(SCV_REACTION_DELAY_MIN_MS, Number(process.env.SCV_REACTION_DELAY_MAX_MS || '25000'))
const SCV_AUTOMATION_SUPPRESS_TAGS = Array.from(new Set(
  String(process.env.SCV_AUTOMATION_SUPPRESS_TAGS || 'flag')
    .split(',')
    .map((value) => normalizeTagName(value))
    .filter(Boolean)
))
const SCV_FAST_TARGET_INBOX_KICK = /^(1|true|yes|on)$/i.test(String(process.env.SCV_FAST_TARGET_INBOX_KICK || '0'))
const SCV_FAST_TARGET_INBOX_KICK_MODE = String(process.env.SCV_FAST_TARGET_INBOX_KICK_MODE || 'restart').trim().toLowerCase()
const SCV_INBOX_WORKER_LABEL = String(process.env.SCV_INBOX_WORKER_LABEL || 'ai.scv.inbox-worker').trim() || 'ai.scv.inbox-worker'
const SCV_FAIL_CLOSED_RECOVERY = String(process.env.SCV_FAIL_CLOSED_RECOVERY || '1').trim() !== '0'
const SCV_INBOUND_MAX_BODY_BYTES = 1024 * 1024
const SUPERVISOR_STATUS_FILE = path.join(LOG_DIR, 'supervisor-status.json')
const SCV_SUPERVISOR_MAX_AGE_MS = Math.max(10_000, Number(process.env.SCV_SUPERVISOR_MAX_AGE_MS || 20_000))
const SCV_DRIFT_STATUS_MAX_AGE_MS = Math.max(60_000, Number(process.env.SCV_DRIFT_STATUS_MAX_AGE_MS || 180_000))
const SCV_CAPABILITY_STATUS_MAX_AGE_MS = Math.max(
  10 * 60 * 1000,
  Number(process.env.SCV_CAPABILITY_STATUS_MAX_AGE_MS || 90 * 60 * 1000)
)
const SCV_INGRESS_SECRET = String(process.env.SCV_MANYCHAT_INGRESS_SECRET || process.env.SCV_INBOUND_SHARED_SECRET || '')
const SCV_ADMIN_SECRET = String(process.env.SCV_ADMIN_SHARED_SECRET || '')
const SCV_LEGACY_INTERNAL_QUEUE_HTTP = /^(1|true|yes|on)$/i.test(String(process.env.SCV_LEGACY_INTERNAL_QUEUE_HTTP || '0'))
const SCV_INBOUND_RATE_LIMIT_PER_MINUTE = Math.max(10, Number(process.env.SCV_INBOUND_RATE_LIMIT_PER_MINUTE || 300))
const SCV_INBOUND_REQUEST_TIMEOUT_MS = boundedEnvMs(process.env.SCV_INBOUND_REQUEST_TIMEOUT_MS, 15_000, 100, 30_000)
const SCV_INBOUND_HEADERS_TIMEOUT_MS = Math.min(
  SCV_INBOUND_REQUEST_TIMEOUT_MS,
  boundedEnvMs(process.env.SCV_INBOUND_HEADERS_TIMEOUT_MS, 10_000, 100, 20_000)
)
const SCV_INBOUND_KEEP_ALIVE_TIMEOUT_MS = boundedEnvMs(process.env.SCV_INBOUND_KEEP_ALIVE_TIMEOUT_MS, 5_000, 100, 10_000)
const SCV_INSTAGRAM_ENRICH_TIMEOUT_MS = boundedEnvMs(process.env.SCV_INSTAGRAM_ENRICH_TIMEOUT_MS, 1_000, 50, 5_000)
const SCV_MANYCHAT_ENRICH_TIMEOUT_MS = boundedEnvMs(process.env.SCV_MANYCHAT_ENRICH_TIMEOUT_MS, 1_500, 50, 5_000)
const inboundRateBuckets = new Map()
const SCV_PREFLIGHT_PROOF_SCHEMA = 'scv-production-preflight-proof-2026-08-19-v1'
const TRUSTED_RECOVERY_SOURCES = new Set([
  'manychat_subscriber_getinfo',
  'watchdog_orphaned_user_turn'
])

const TEXT_KEY_RE = /(^|[._-])(text|message|message_text|last_input_text|last_text_input|input|reply|caption|content|body)([._-]|$)/i
const NON_TEXT_KEY_RE = /(^|[._-])(id|contact_id|thread_id|message_id|subscriber_id|user_id|username|instagram_username|email|phone|url|received_at|source_interaction_at|last_interaction|last_interaction_at|ig_last_interaction|last_seen|timestamp|created_at|updated_at|at)([._-]|$)/i
// Timestamp-shaped values are transport metadata, never the client's words.
const TIMESTAMP_VALUE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/i
const INTERNAL_META_KEY_RE = /(^|[._-])(recovered_via|recovered_from_ig_last_interaction|recovered_from_last_seen|authority|runner|prompt_sha256|input_sha256|source)([._-]|$)/i
const INTERNAL_META_VALUE_RE = /^(manychat_subscriber_getinfo|codex_exec_dm_authority|codex exec|scv_single_control_plane|scv-single-control-plane)$/i
const PLACEHOLDER_TEXT_RE = /^\{\{[^}]+\}\}$/
const REFERENCE_CONTAINER_KEY_RE = /(^|[._-])(attachment|attachments|media|post|posts|reel|reels|story|stories|share|shared|instagram|ig|reference|references)([._-]|$)/i
const REFERENCE_TITLE_KEY_RE = /(^|[._-])(title|caption|name|description|alt|label|text|message|message_text|content)([._-]|$)/i

function normalizeTagName(value) {
  return String(value || '').trim().toLowerCase()
}

function extractTagNames(value) {
  if (!Array.isArray(value)) return []

  return value
    .map((entry) => {
      if (!entry) return ''
      if (typeof entry === 'string') return entry
      if (typeof entry === 'object') return entry.name || entry.label || entry.tag_name || ''
      return ''
    })
    .map((entry) => normalizeTagName(entry))
    .filter(Boolean)
}

function mergeTagNames(...lists) {
  return Array.from(new Set(
    lists
      .flat()
      .map((entry) => normalizeTagName(entry))
      .filter(Boolean)
  ))
}

function extractInboundTagNames(body) {
  if (!body || typeof body !== 'object') return []

  return mergeTagNames(
    extractTagNames(body.tags),
    extractTagNames(body.labels),
    extractTagNames(body.contact_tags),
    extractTagNames(body.contact_labels)
  )
}

function getAutomationSuppression(tagNames) {
  const normalized = mergeTagNames(tagNames)
  const matchedTag = normalized.find((tag) => SCV_AUTOMATION_SUPPRESS_TAGS.includes(tag)) || ''

  if (!matchedTag) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: ''
    }
  }

  return {
    suppressed: true,
    matched_tag: matchedTag,
    reason: 'suppressed_tag'
  }
}

function applyAutomationSuppression(packet, ...tagLists) {
  const mergedTags = mergeTagNames(packet?.manychat_tags, ...tagLists)
  const verdict = getAutomationSuppression(mergedTags)

  return {
    ...packet,
    manychat_tags: mergedTags,
    automation_suppressed: verdict.suppressed,
    automation_suppressed_tag: verdict.matched_tag,
    automation_suppressed_reason: verdict.reason
  }
}

function applyExternalSuppression(packet, verdict) {
  if (!verdict?.suppressed) {
    return packet
  }

  // A username HEURISTIC must not stamp automation_suppressed onto a real inbound
  // (Ben law: everyone who DMs gets a reply). Record it as advisory only so
  // non-reply lanes (reactions) can still respect it.
  if (verdict.heuristic === true) {
    return {
      ...packet,
      instagram_shop_heuristic: true,
      instagram_shop_heuristic_tag: String(verdict.matched_tag || '')
    }
  }

  return {
    ...packet,
    automation_suppressed: true,
    automation_suppressed_tag: String(packet?.automation_suppressed_tag || verdict.matched_tag || ''),
    automation_suppressed_reason: String(packet?.automation_suppressed_reason || verdict.reason || 'suppressed')
  }
}

function sendJson(res, status, body) {
  if (res.destroyed || res.writableEnded) return
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(raw),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(raw)
}

function boundedEnvMs(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, parsed))
}

function envFlag(value, fallback = false) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return fallback
  return /^(1|true|yes|on)$/i.test(normalized)
}

function cloudRuntime(env = process.env) {
  const railwayName = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const releaseModeName = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  return envFlag(env.SCV_CLOUD_RUNTIME) ||
    railwayName === 'production' || railwayName === 'staging' ||
    releaseModeName === 'production' || releaseModeName === 'staging'
}

function manychatSubscriberInfoUrl(env = process.env) {
  // The bearer credential may only leave the process for ManyChat's exact
  // official endpoint in cloud runtimes. A local override remains available
  // solely for offline harnesses.
  if (cloudRuntime(env)) return MANYCHAT_SUBSCRIBER_INFO_OFFICIAL_URL
  return String(env.MANYCHAT_SUBSCRIBER_INFO_URL || MANYCHAT_SUBSCRIBER_INFO_OFFICIAL_URL).trim()
}

function canonicalProviderId(value) {
  const normalized = String(value ?? '').trim()
  return /^[1-9][0-9]{0,31}$/.test(normalized) &&
    BigInt(normalized) <= BigInt(Number.MAX_SAFE_INTEGER)
}

function inboundIdentityVerdict(body, env = process.env) {
  const strict = cloudRuntime(env) || ingressAuthRequired(env)
  if (!strict) return { ok: true, strict: false, reason: 'local_non_public_ingress' }

  const contactValues = ['contact_id', 'subscriber_id', 'user_id']
    .map((key) => String(body?.[key] ?? '').trim())
    .filter(Boolean)
  const threadId = String(body?.thread_id ?? '').trim()
  if (contactValues.length === 0 || contactValues.some((value) => !canonicalProviderId(value))) {
    return { ok: false, strict: true, reason: 'invalid_contact_id' }
  }
  const uniqueContacts = new Set(contactValues)
  if (uniqueContacts.size !== 1) {
    return { ok: false, strict: true, reason: 'conflicting_contact_identity' }
  }
  const contactId = contactValues[0]
  if (threadId && (!canonicalProviderId(threadId) || threadId !== contactId)) {
    return { ok: false, strict: true, reason: 'invalid_or_mismatched_thread_id' }
  }
  return { ok: true, strict: true, reason: 'canonical_provider_identity', contact_id: contactId }
}

function requestSecret(req, headerName) {
  const direct = String(req.headers?.[headerName] || '').trim()
  if (direct) return direct
  const authorization = String(req.headers?.authorization || '').trim()
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

function secretMatches(expected, supplied) {
  const expectedHash = crypto.createHash('sha256').update(String(expected || '')).digest()
  const suppliedHash = crypto.createHash('sha256').update(String(supplied || '')).digest()
  return Boolean(expected) && Boolean(supplied) && crypto.timingSafeEqual(expectedHash, suppliedHash)
}

function authorizeSharedSecret(req, expected, headerName, required) {
  if (!required) return { ok: true, required: false }
  if (!expected) return { ok: false, status: 503, error: 'authentication_not_configured' }
  if (!secretMatches(expected, requestSecret(req, headerName))) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
  return { ok: true, required: true }
}

function ingressAuthRequired(env = process.env) {
  return envFlag(env.SCV_INBOUND_AUTH_REQUIRED, cloudRuntime(env))
}

function adminAuthRequired(env = process.env) {
  return envFlag(env.SCV_ADMIN_AUTH_REQUIRED, cloudRuntime(env))
}

function ingressRateAllowed(req, now = Date.now()) {
  const key = String(req.socket?.remoteAddress || 'unknown')
  const minute = Math.floor(now / 60_000)
  const current = inboundRateBuckets.get(key)
  const next = !current || current.minute !== minute
    ? { minute, count: 1 }
    : { minute, count: current.count + 1 }
  inboundRateBuckets.set(key, next)
  if (inboundRateBuckets.size > 2000) {
    for (const [address, bucket] of inboundRateBuckets.entries()) {
      if (bucket.minute < minute - 1) inboundRateBuckets.delete(address)
    }
  }
  return next.count <= SCV_INBOUND_RATE_LIMIT_PER_MINUTE
}

function appendNdjson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(obj) + '\n')
}


function safeHealthGuard(fn) {
  try { return fn() } catch (err) { return { ok: false, error: String(err && err.message ? err.message : err) } }
}

function countJsonFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return 0
    return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).length
  } catch {
    return 0
  }
}

function safeReadJsonFile(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function statusAgeMs(status, now = Date.now()) {
  // Persistent monitors use either their legacy heartbeat field or the newer
  // explicit UTC receipt field. Treat both as authoritative freshness stamps.
  const timestamp = Date.parse(String(
    status?.updated_at || status?.checked_at_utc || status?.at || ''
  ))
  return Number.isFinite(timestamp) ? Math.max(0, now - timestamp) : Number.POSITIVE_INFINITY
}

function supervisorHealth(status, now = Date.now()) {
  const required = Array.isArray(status?.required_services) ? status.required_services : []
  const services = status?.services && typeof status.services === 'object' ? status.services : {}
  const missing = required.filter((label) => services[label]?.running !== true)
  const crashing = required.filter((label) => Number(services[label]?.recent_restart_count || 0) >= 5)
  const ageMs = statusAgeMs(status, now)
  return {
    ok: Boolean(status) && required.length > 0 && missing.length === 0 && crashing.length === 0 && ageMs <= SCV_SUPERVISOR_MAX_AGE_MS,
    age_ms: ageMs,
    required_count: required.length,
    running_count: required.filter((label) => services[label]?.running === true).length,
    missing,
    crash_loop: crashing
  }
}

function readPreflightProof(env = process.env) {
  const encoded = String(env.SCV_PREFLIGHT_PROOF_B64 || '').trim()
  if (!encoded || encoded.length > 16 * 1024) return null
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function preflightProofVerdict(goldenRelease, runtimeMode, env = process.env) {
  if (isSingleReleaseRequested(env)) {
    const verdict = singleReleaseRuntimeIdentityVerdict({
      receipt: goldenRelease,
      env
    })
    return {
      ok: verdict.ok,
      required: true,
      protocol: SCV_SINGLE_RELEASE_PROTOCOL,
      mode: verdict.mode,
      release_id: verdict.release_id,
      failures: verdict.failures
    }
  }
  if (runtimeMode === 'local') return { ok: true, required: false, reason: 'local_runtime' }
  const proof = readPreflightProof(env)
  const gates = proof?.gates && typeof proof.gates === 'object' ? proof.gates : {}
  const failures = []
  const requireProof = (condition, label) => { if (!condition) failures.push(label) }
  requireProof(proof?.schema === SCV_PREFLIGHT_PROOF_SCHEMA, 'schema')
  requireProof(proof?.mode === runtimeMode, 'mode')
  requireProof(proof?.release_id === goldenRelease?.release_id, 'release_id')
  requireProof(
    proof?.content_fingerprint_sha256 === goldenRelease?.content_fingerprint_sha256,
    'content_fingerprint'
  )
  requireProof(
    proof?.release_manifest_sha256 === goldenRelease?.release_manifest_sha256,
    'release_manifest'
  )
  requireProof(gates.release_verified === true, 'release_gate')
  requireProof(gates.immutable_firewall_verified === true, 'immutable_firewall_gate')
  requireProof(gates.node_runtime_verified === true, 'node_runtime_gate')
  if (runtimeMode === 'production') {
    requireProof(gates.environment_values_verified === true, 'environment_gate')
    requireProof(gates.railway_identity_verified === true, 'railway_identity_gate')
    requireProof(gates.persistent_storage_verified === true, 'persistent_storage_gate')
    requireProof(gates.production_approval_verified === true, 'production_approval_gate')
    requireProof(gates.recovery_transition_verified === true, 'recovery_transition_gate')
  } else {
    requireProof(gates.staging_isolation_verified === true, 'staging_isolation_gate')
  }
  return {
    ok: failures.length === 0,
    required: true,
    mode: String(proof?.mode || ''),
    release_id: String(proof?.release_id || ''),
    failures
  }
}

function buildReadiness(now = Date.now(), {
  allowActiveFailCloseForDeployment = false
} = {}) {
  const strict = cloudRuntime(process.env)
  const singleRelease = isSingleReleaseRequested(process.env)
  const railwayEnvironment = String(process.env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const configuredReleaseMode = String(process.env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  const runtimeMode = railwayEnvironment === 'production' || configuredReleaseMode === 'production'
    ? 'production'
    : (railwayEnvironment === 'staging' || configuredReleaseMode === 'staging' ? 'staging' : 'local')
  const failClose = readFailClose({ env: process.env, root: ROOT })
  const immutableGuard = singleRelease
    ? { required: false, protocol: SCV_SINGLE_RELEASE_PROTOCOL }
    : safeHealthGuard(() => runScvImmutableDriftFirewall({ root: __dirname }))
  const goldenGuard = singleRelease
    ? { required: false, protocol: SCV_SINGLE_RELEASE_PROTOCOL }
    : safeHealthGuard(() => runScvGoldenSnapshotGuard({ root: __dirname }))
  const goldenRelease = singleRelease
    ? safeHealthGuard(() => verifySingleRelease({ root: __dirname, env: process.env }))
    : safeHealthGuard(() => runGoldenReleaseVerification({
        root: __dirname,
        env: process.env,
        // scv-production-entry verified the untouched Railway environment before it
        // injected effective runtime variables. Rechecking exact env membership here
        // would reject those trusted mutations and permanently hold /readyz at 503.
        verifyEnvironmentValues: false,
        verifyRailway: runtimeMode === 'production',
        verifyPersistence: runtimeMode === 'production',
        verifyFiles: true,
        verifyStaging: releaseMode(process.env, readReleaseManifest(__dirname)) === 'staging'
      }))
  const namespaceGuard = safeHealthGuard(() => runScvRuntimeNamespaceGuard({
    appRoot: ROOT,
    dirs: RUNTIME_GUARD_DIRS,
    persistRoot: process.env.SCV_PERSIST_ROOT || '/data',
    namespace: runtimeNamespaceFromEnv(process.env)
  }))
  const promptAuthority = safeHealthGuard(() => apiPromptAuthorityReceipt({ root: ROOT }))
  const driftStatus = safeReadJsonFile(DRIFT_STATUS_FILE)
  const driftAgeMs = statusAgeMs(driftStatus, now)
  const capabilityStatus = safeReadJsonFile(CAPABILITY_STATUS_FILE)
  const capabilityAgeMs = statusAgeMs(capabilityStatus, now)
  const supervisor = supervisorHealth(safeReadJsonFile(SUPERVISOR_STATUS_FILE), now)
  const preflightProof = preflightProofVerdict(goldenRelease, runtimeMode, process.env)
  const modelContract = singleRelease
    ? modelContractVerdict(process.env)
    : null
  const behaviorContract = singleRelease
    ? runtimeBehaviorContractVerdict(process.env, { mode: runtimeMode })
    : null
  const manifestReleasePhase = String(
    goldenRelease?.manifest?.deployment?.release_phase || ''
  )
  const environmentReleasePhase = String(process.env.SCV_RELEASE_PHASE || '')
  const automationPaused = pauseAll(process.env)
  const operatorPauseAllConfigured =
    String(process.env.SCV_PAUSE_ALL || '0').trim() === '1'
  const stagingCapability = stagingCapabilityBoundary(process.env)
  const credentiallessSafeStaging = runtimeMode === 'staging' &&
    stagingCapability.capability_mode === CAPABILITY_MODE_WITHHELD &&
    stagingCapability.ok === true
  const isolatedArmedStaging = runtimeMode === 'staging' &&
    stagingCapability.capability_mode === CAPABILITY_MODE_PROVIDER_BOUND &&
    stagingCapability.ok === true &&
    envFlag(process.env.SCV_STAGING_REAL_E2E_ARMED) &&
    pauseEnabled(process.env) === true &&
    pauseDebugAccountsEnabled(process.env) === false &&
    String(process.env.SCV_FAST_TARGET_USERNAMES || '').trim().toLowerCase() === 'omar.system' &&
    String(process.env.SCV_FAST_TARGET_CONTACT_IDS || '').trim() === '1537753982'
  // Historical queue/quarantine drift must remain visible, but it cannot make an
  // exact single-account armed staging instance permanently undeployable. All
  // non-Omar traffic remains held by PAUSE_NON_TEST while the operator repairs it.
  const criticalDriftStatusOk = driftStatus?.critical_ok === true &&
    driftAgeMs <= SCV_DRIFT_STATUS_MAX_AGE_MS
  const driftReadinessOk = singleRelease
    ? criticalDriftStatusOk
    : driftStatus?.ok === true || isolatedArmedStaging || credentiallessSafeStaging
  const capabilityRequired = runtimeMode === 'production' ||
    (runtimeMode === 'staging' && stagingCapability.external_workers_allowed === true)
  const capabilityCanaryOk = !capabilityRequired || Boolean(
    capabilityStatus?.schema === 'scv-capability-canary-2026-08-31-v2-fail-close' &&
    capabilityStatus?.ok === true &&
    capabilityStatus?.voice_ok === true &&
    capabilityStatus?.vision_ok === true &&
    capabilityStatus?.visible_model_ok === true &&
    capabilityAgeMs <= SCV_CAPABILITY_STATUS_MAX_AGE_MS &&
    String(capabilityStatus?.release_id || '') === String(goldenRelease?.release_id || '') &&
    String(capabilityStatus?.content_fingerprint_sha256 || '') ===
      String(goldenRelease?.content_fingerprint_sha256 || '')
  )
  const releasePhaseReady = runtimeMode !== 'production' || Boolean(
    preflightProof.ok === true &&
    (manifestReleasePhase === 'recovery_bootstrap' || manifestReleasePhase === 'active') &&
    environmentReleasePhase === manifestReleasePhase &&
    operatorPauseAllConfigured === (manifestReleasePhase === 'recovery_bootstrap')
  )
  const failures = []
  const requireCheck = (condition, label) => { if (!condition) failures.push(label) }

  if (!singleRelease) {
    requireCheck(immutableGuard?.ok === true, 'immutable_drift_firewall')
    requireCheck(goldenGuard?.ok === true, 'golden_snapshot_guard')
  }
  requireCheck(goldenRelease?.ok === true, 'golden_production_release')
  if (singleRelease) {
    requireCheck(modelContract?.ok === true, 'runtime_model_contract')
    requireCheck(behaviorContract?.ok === true, 'runtime_behavior_contract')
  }
  requireCheck(namespaceGuard?.ok === true, 'runtime_namespace_guard')
  requireCheck(promptAuthority?.ok === true, 'api_prompt_authority')
  // The normal readiness surface remains fail-closed. Railway's deployment
  // probe may ignore only the already-active latch so a repaired image can
  // replace the image that raised it. Every sender/reaction gate continues to
  // read the persistent latch, so this never resumes customer traffic.
  if (!allowActiveFailCloseForDeployment) {
    requireCheck(failClose.active !== true, 'automation_fail_close')
  }
  requireCheck(driftReadinessOk, singleRelease ? 'critical_drift_status' : 'drift_status')
  requireCheck(capabilityCanaryOk, 'capability_canary')
  if (runtimeMode === 'staging') {
    requireCheck(stagingCapability.ok === true, 'staging_capability_boundary')
  }
  if (strict) {
    requireCheck(runtimeMode === 'production' || runtimeMode === 'staging', 'cloud_release_mode')
    requireCheck(preflightProof.ok === true, 'release_preflight_proof')
    if (runtimeMode === 'production') {
      requireCheck(releasePhaseReady, 'release_phase_transition')
    }
    if (!credentiallessSafeStaging) {
      if (!singleRelease) {
        requireCheck(driftAgeMs <= SCV_DRIFT_STATUS_MAX_AGE_MS, 'drift_status_stale')
      }
      requireCheck(Boolean(MANYCHAT_API_KEY), 'manychat_api_key')
      requireCheck(Boolean(process.env.OPENAI_API_KEY || fs.existsSync(process.env.CODEX_BIN || '')), 'lua_executor')
    }
    requireCheck(process.env.SCV_PERSISTENCE_READY === '1' && namespaceGuard?.persistent === true, 'persistent_state')
    requireCheck(SCV_INGRESS_SECRET.length >= 32, 'manychat_ingress_secret')
    requireCheck(SCV_ADMIN_SECRET.length >= 32, 'admin_secret')
    requireCheck(supervisor.ok === true, 'supervisor')
    requireCheck(envFlag(process.env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE), 'stale_backlog_hold')

    const operatorPauseAll = pauseAll(process.env)
    if (!operatorPauseAll) {
      if (runtimeMode === 'production') {
        requireCheck(
          pauseEnabled(process.env) === false,
          'non_test_accounts_paused'
        )
        requireCheck(
          pauseDebugAccountsEnabled(process.env) === !singleRelease,
          singleRelease
            ? 'single_release_omar_route_paused'
            : 'debug_account_not_isolated'
        )
      } else if (runtimeMode === 'staging') {
        requireCheck(pauseEnabled(process.env) === true, 'staging_non_test_pause_missing')
        requireCheck(pauseDebugAccountsEnabled(process.env) === false, 'staging_debug_route_paused')
      }
      requireCheck(Number.isFinite(Date.parse(String(process.env.SCV_RECOVERY_CUTOVER_AT || ''))), 'recovery_cutover_missing')
    }
  }

  return {
    ok: failures.length === 0,
    strict,
    release_protocol: singleRelease
      ? SCV_SINGLE_RELEASE_PROTOCOL
      : 'legacy_golden',
    runtime_mode: runtimeMode,
    capability_mode: stagingCapability.capability_mode,
    capability_boundary_ok: stagingCapability.ok,
    external_capabilities_verified: false,
    external_workers_started: stagingCapability.staging
      ? stagingCapability.external_workers_allowed
      : null,
    readiness_scope: stagingCapability.readiness_scope,
    failures,
    runtime_namespace: runtimeNamespaceFromEnv(process.env),
    automation_paused: automationPaused,
    operator_pause_all_configured: operatorPauseAllConfigured,
    pause_non_test: pauseEnabled(process.env),
    pause_debug_accounts: pauseDebugAccountsEnabled(process.env),
    drift_status: {
      ok: driftStatus?.ok === true,
      critical_ok: driftStatus?.critical_ok === true,
      readiness_advisory_override: driftStatus?.ok !== true &&
        (isolatedArmedStaging || credentiallessSafeStaging),
      age_ms: Number.isFinite(driftAgeMs) ? driftAgeMs : null,
      alert_count: Number(driftStatus?.alert_count || 0),
      critical_alert_count: Number(driftStatus?.critical_alert_count || 0),
      operational_alert_count: Number(driftStatus?.operational_alert_count || 0)
    },
    capability_canary: {
      required: capabilityRequired,
      ok: capabilityCanaryOk,
      age_ms: Number.isFinite(capabilityAgeMs) ? capabilityAgeMs : null,
      voice_ok: capabilityStatus?.voice_ok === true,
      vision_ok: capabilityStatus?.vision_ok === true,
      visible_model_ok: capabilityStatus?.visible_model_ok === true,
      provider_model: String(capabilityStatus?.provider_model || ''),
      checked_at_utc: String(capabilityStatus?.checked_at_utc || '')
    },
    supervisor,
    preflight_proof: preflightProof,
    model_identity: singleRelease
      ? modelReadinessReceipt(process.env)
      : null,
    behavior_contract: singleRelease
      ? {
          ok: behaviorContract?.ok === true,
          version: String(behaviorContract?.version || ''),
          contract_sha256: String(behaviorContract?.contract_sha256 || ''),
          secret_values_included: false,
          failures: behaviorContract?.failures || []
        }
      : null,
    release_phase: {
      ok: releasePhaseReady,
      phase: manifestReleasePhase
    },
    persistence_ready: process.env.SCV_PERSISTENCE_READY === '1',
    immutable_drift_firewall: immutableGuard,
    golden_snapshot_guard: goldenGuard,
    golden_production_release: goldenRelease,
    runtime_namespace_guard: namespaceGuard,
    api_prompt_authority: promptAuthority,
    automation_fail_close: {
      active: failClose.active === true,
      reason: String(failClose.reason || ''),
      release_id: String(failClose.release_id || '')
    },
    deployment_probe: allowActiveFailCloseForDeployment,
    inbound_max_body_bytes: SCV_INBOUND_MAX_BODY_BYTES
  }
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    let tooLarge = false
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      fn(value)
    }
    const deadline = setTimeout(() => {
      const err = new Error('request_timeout')
      err.statusCode = 408
      finish(reject, err)
    }, SCV_INBOUND_REQUEST_TIMEOUT_MS)

    req.on('data', chunk => {
      if (settled) return
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += value.length
      if (bytes > SCV_INBOUND_MAX_BODY_BYTES) {
        tooLarge = true
        return
      }
      chunks.push(value)
    })
    req.on('end', () => {
      if (settled) return
      if (tooLarge) {
        const err = new Error('payload_too_large')
        err.statusCode = 413
        return finish(reject, err)
      }

      const data = Buffer.concat(chunks).toString('utf8')
      try {
        finish(resolve, data ? JSON.parse(data) : {})
      } catch {
        const err = new Error('invalid_json')
        err.statusCode = 400
        finish(reject, err)
      }
    })
    req.on('aborted', () => {
      const err = new Error('request_aborted')
      err.statusCode = 400
      finish(reject, err)
    })
    req.on('error', (error) => finish(reject, error))
  })
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function identitySha256(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized ? sha256(normalized) : ''
}

function redactedInboundIdentity(value = {}) {
  return {
    contact_sha256: identitySha256(
      value.contact_id || value.subscriber_id || value.user_id || value.thread_id
    ),
    username_sha256: identitySha256(
      value.instagram_username || value.username
    ),
    message_sha256: identitySha256(value.message_id)
  }
}

function safeLogErrorReason(error) {
  const known = String(error?.message || '')
  if (/^(invalid_json|payload_too_large)$/.test(known)) return known
  const code = String(error?.code || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  if (code) return code
  const name = String(error?.name || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  return name || 'handler_error'
}

function deliveryVisibilityReadiness(now = Date.now()) {
  let runtime = { client_exists: false }
  try { runtime = getInstagramRuntimeStatus() || { client_exists: false } } catch { runtime = { client_exists: false } }
  let summary
  try { summary = summarizeDeliveryVisibility(ROOT, now) } catch (error) {
    summary = { ledger_present: false, ledger_error: String(error?.message || error).slice(0, 200) }
  }
  return {
    // Production has no Instagram thread client: provider acceptance is the
    // terminal transport fact and visibility stays UNKNOWN until a real probe
    // or an explicit operator resolution. A newer inbound is never proof.
    confirmation_channel_available: runtime?.client_exists === true,
    confirmation_channel: runtime?.client_exists === true
      ? VISIBILITY_CONFIRMATION_SOURCES.INSTAGRAM_THREAD_PROBE
      : VISIBILITY_CONFIRMATION_SOURCES.NONE,
    ...summary
  }
}

function redactedDeliveryReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null
  const hashOrEmpty = (value) => /^[a-f0-9]{64}$/i.test(String(value || ''))
    ? String(value).toLowerCase()
    : ''
  return {
    present: true,
    at: String(receipt.at || ''),
    ...redactedInboundIdentity(receipt),
    bubble_index: Number(receipt.bubble_index || 0),
    control_receipt_sha256: hashOrEmpty(receipt.control_receipt_sha256),
    text_sha256: hashOrEmpty(receipt.text_sha256),
    text_length: Number(receipt.text_length || 0),
    delivery_status: String(receipt.delivery_status || ''),
    delivery_accepted: receipt.delivery_accepted === true,
    delivery_confirmed: receipt.delivery_confirmed === true,
    delivery_method: String(receipt.delivery_method || ''),
    http_status: Number(receipt.http_status || 0),
    manychat_status: Number(receipt.manychat_status || 0),
    visibility_state: String(receipt.visibility_state || ''),
    visibility_confirmed: receipt.visibility_confirmed === true,
    delivery_visibility_unknown: receipt.delivery_visibility_unknown === true,
    visibility_confirmation_source: String(receipt.visibility_confirmation_source || ''),
    transport_attempt_id: hashOrEmpty(receipt.transport_attempt_id)
  }
}

function redactedDriftStatus(status, now = Date.now()) {
  return {
    ok: status?.ok === true,
    critical_ok: status?.critical_ok === true,
    age_ms: Number.isFinite(statusAgeMs(status, now)) ? statusAgeMs(status, now) : null,
    alert_count: Number(status?.alert_count || 0),
    critical_alert_count: Number(status?.critical_alert_count || 0),
    operational_alert_count: Number(status?.operational_alert_count || 0)
  }
}

function looksLikeStandaloneEmojiText(value) {
  const text = String(value || '').trim()
  if (!text || text.length > 64) return false
  if (/[\p{L}\p{N}]/u.test(text)) return false
  return /\p{Extended_Pictographic}/u.test(text)
}

function looksLikeHumanText(value) {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^https?:\/\//i.test(text)) return false
  if (PLACEHOLDER_TEXT_RE.test(text)) return false
  if (INTERNAL_META_VALUE_RE.test(text)) return false
  if (TIMESTAMP_VALUE_RE.test(text)) return false
  if (/^[\d\s+().-]+$/.test(text)) return false
  return /\p{L}/u.test(text) || looksLikeStandaloneEmojiText(text)
}

// A bare number typed into the direct message field is the client's words
// ("4" answering "2pm or 4pm?", "31", "3:30", or their phone number). Live
// red-team 2026-09-02: "4" was rejected as non-human text and the picker fell
// back to the ISO received_at timestamp, so the client "said" a date string.
// Only direct text fields qualify; nested ids and metadata never do.
function looksLikeDirectNumericReply(value, body = {}) {
  const text = String(value || '').trim()
  if (!text || text.length > 32) return false
  if (!/^\+?[\d\s().:-]+$/.test(text) || !/\d/.test(text)) return false
  if (TIMESTAMP_VALUE_RE.test(text)) return false
  const digits = text.replace(/\D/g, '')
  const ids = [body?.contact_id, body?.thread_id, body?.id, body?.subscriber_id, body?.user_id, body?.message_id]
    .map((entry) => String(entry ?? '').replace(/\D/g, ''))
    .filter(Boolean)
  if (ids.includes(digits)) return false
  return true
}

function looksLikeReferenceLink(value) {
  const text = String(value || '').trim()
  if (!text || PLACEHOLDER_TEXT_RE.test(text)) return false
  return (
    /^https?:\/\/lookaside\.fbsbx\.com\/ig_messaging_cdn\//i.test(text) ||
    /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|stories)\//i.test(text) ||
    /^https?:\/\/.+\.(?:jpg|jpeg|png|gif|webp|mp4|mov|m4v)(?:\?|$)/i.test(text)
  )
}

function normalizeEmojiOnlyText(value) {
  return String(value || '')
    .replace(/[︎️]/g, '')
    .replace(/[‍]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

function looksLikeHeartReaction(value) {
  const text = normalizeEmojiOnlyText(value)
  if (!text) return false
  return /^[❤♥💕💖💗💓💞💘💝💟💜💙💚💛🧡🖤🤍🤎🩷🩵🩶🫶]+$/u.test(text)
}

function looksLikeHeartReactionPath(pathKey) {
  return /(^|\.)(reaction|emoji|like|heart|message_text|last_input_text|last_text_input|text|message)$/i.test(String(pathKey || ''))
}

function collectHeartReactionCandidates(value, pathParts = [], out = []) {
  if (out.length > 40) return out

  if (typeof value === 'string') {
    const text = value.trim()
    const pathKey = pathParts.join('.')
    if (looksLikeHeartReaction(text) && looksLikeHeartReactionPath(pathKey)) {
      out.push({
        path: `heart_reaction.${pathKey || '<root>'}`,
        text: 'sent a heart reaction',
        length: text.length,
        score: 6500
      })
    }
    return out
  }

  if (!value || typeof value !== 'object' || pathParts.length > 8) return out

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectHeartReactionCandidates(item, pathParts.concat(String(index)), out))
    return out
  }

  for (const [key, nested] of Object.entries(value)) {
    collectHeartReactionCandidates(nested, pathParts.concat(key), out)
  }

  return out
}

function looksLikeReferenceTitlePath(pathKey) {
  return REFERENCE_CONTAINER_KEY_RE.test(pathKey) && REFERENCE_TITLE_KEY_RE.test(pathKey)
}

function looksLikeReferenceMediaObject(value, pathKey) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const key = String(pathKey || '')
  if (!REFERENCE_CONTAINER_KEY_RE.test(key)) return false

  const flat = JSON.stringify(value).toLowerCase()
  if (!flat || flat.length > 5000) return false

  const hasMediaKind = /\b(image|photo|picture|video|media|post|reel|story|share|attachment)\b/i.test(flat)
  const hasMediaIdentity = /\b(asset_id|media_id|post_id|reel_id|story_id|attachment_id|mime_type|content_type|media_type|thumbnail|preview|payload|url|src|href|id)\b/i.test(flat)
  return hasMediaKind && hasMediaIdentity
}

function collectReferencePostCandidates(value, pathParts = [], out = []) {
  if (out.length > 200) return out

  if (typeof value === 'string') {
    const text = value.trim()
    const pathKey = pathParts.join('.')
    if (!text || PLACEHOLDER_TEXT_RE.test(text) || INTERNAL_META_VALUE_RE.test(text)) return out

    if (looksLikeReferenceLink(text)) {
      out.push({
        path: pathKey || '<root>',
        text,
        kind: 'link',
        score: 1000 + text.length
      })
      return out
    }

    if (
      looksLikeHumanText(text) &&
      looksLikeReferenceTitlePath(pathKey)
    ) {
      out.push({
        path: pathKey || '<root>',
        text,
        kind: 'title',
        score: 3000 + text.length
      })
    }
    return out
  }

  if (!value || typeof value !== 'object' || pathParts.length > 8) {
    return out
  }

  const pathKey = pathParts.join('.')
  if (looksLikeReferenceMediaObject(value, pathKey)) {
    out.push({
      path: pathKey || '<root>',
      text: 'reference media object',
      kind: 'presence',
      score: 700
    })
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReferencePostCandidates(item, pathParts.concat(String(index)), out))
    return out
  }

  for (const [key, nested] of Object.entries(value)) {
    collectReferencePostCandidates(nested, pathParts.concat(key), out)
  }

  return out
}

function pickReferencePostText(body) {
  const candidates = collectReferencePostCandidates(body)
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length)
  const title = candidates.find((candidate) => candidate.kind === 'title')
  const link = candidates.find((candidate) => candidate.kind === 'link')
  const presence = candidates.find((candidate) => candidate.kind === 'presence')

  if (title) {
    return {
      text: `sent a reference post: ${title.text}`,
      source: `reference_post.${title.path}`,
      candidates: candidates.slice(0, 8).map((candidate) => ({
        path: candidate.path,
        length: candidate.text.length,
        preview: candidate.text.slice(0, 160)
      }))
    }
  }

  if (link) {
    return {
      text: 'sent a reference post',
      source: `reference_post.${link.path}`,
      candidates: candidates.slice(0, 8).map((candidate) => ({
        path: candidate.path,
        length: candidate.text.length,
        preview: candidate.text.slice(0, 160)
      }))
    }
  }

  if (presence) {
    return {
      text: 'sent a reference post',
      source: `reference_post.${presence.path}`,
      candidates: candidates.slice(0, 8).map((candidate) => ({
        path: candidate.path,
        length: candidate.text.length,
        preview: candidate.text.slice(0, 160)
      }))
    }
  }

  return null
}

function collectTextCandidates(value, pathParts = [], out = []) {
  if (out.length > 200) return out

  if (typeof value === 'string') {
    const text = value.trim()
    const pathKey = pathParts.join('.')
    if (
      looksLikeHumanText(text) &&
      !NON_TEXT_KEY_RE.test(pathKey) &&
      !INTERNAL_META_KEY_RE.test(pathKey) &&
      (TEXT_KEY_RE.test(pathKey) || text.length >= 20)
    ) {
      out.push({
        path: pathKey || '<root>',
        text,
        length: text.length,
        score: text.length + (TEXT_KEY_RE.test(pathKey) ? 1000 : 0)
      })
    }
    return out
  }

  if (!value || typeof value !== 'object' || pathParts.length > 8) {
    return out
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTextCandidates(item, pathParts.concat(String(index)), out))
    return out
  }

  for (const [key, nested] of Object.entries(value)) {
    collectTextCandidates(nested, pathParts.concat(key), out)
  }

  return out
}

function pickRecoveredPacketText(body) {
  const prioritized = [
    ['message_text', body.message_text],
    ['last_input_text', body.last_input_text],
    ['text', body.text],
    ['message', body.message],
    ['last_text_input', body.last_text_input]
  ]

  for (const [pathKey, value] of prioritized) {
    if (!['string', 'number', 'boolean'].includes(typeof value)) continue
    const text = String(value || '').trim()
    if (!text) continue
    if (INTERNAL_META_VALUE_RE.test(text)) continue

    return {
      text,
      source: pathKey,
      candidates: prioritized
        .map(([candidatePath, candidateValue]) => ({
          path: candidatePath,
          length: String(candidateValue || '').trim().length,
          preview: String(candidateValue || '').trim().slice(0, 160)
        }))
        .filter((candidate) => candidate.length > 0)
        .slice(0, 8)
    }
  }

  return {
    text: '',
    source: '',
    candidates: []
  }
}

// True when the body is a real inbound message from a real person that simply carries no
// forwardable text (a media / photo / view-once / voice / sticker / share). Requires a
// contact identity AND a message/media envelope key, so genuine system pings or malformed
// bodies (no identity, no message key) still fall through to the empty-text drop.
const MESSAGE_ENVELOPE_KEY_RE = /(^|[._-])(message|message_text|messages|text|last_input_text|last_text_input|attachment|attachments|media|photo|image|picture|video|gif|sticker|voice|audio|story|stories|reel|reels|share|shared)([._-]|$)/i

function detectInboundMediaType(value, pathParts = [], evidence = { voice: false, photo: false, media: false }) {
  if (pathParts.length > 8) return evidence
  const pathKey = pathParts.join('.')
  if (/(^|[._-])(voice|voice_note|voicenote|audio)([._-]|$)/i.test(pathKey)) evidence.voice = true
  if (/(^|[._-])(photo|image|picture)([._-]|$)/i.test(pathKey)) evidence.photo = true
  if (/(^|[._-])(attachment|attachments|media|video|gif|sticker|story|reel|share)([._-]|$)/i.test(pathKey)) evidence.media = true

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    const leafKey = String(pathParts[pathParts.length - 1] || '')
    const typeField = /^(?:type|kind|media_type|attachment_type|message_type)$/i.test(leafKey)
    const mimeField = /^(?:mime_type|content_type|mimetype)$/i.test(leafKey)
    if (
      (typeField && /^(?:voice|voice_note|voicenote|audio|audio_message)$/.test(text)) ||
      (mimeField && /^audio\//.test(text))
    ) evidence.voice = true
    if (
      (typeField && /^(?:photo|image|picture)$/.test(text)) ||
      (mimeField && /^image\//.test(text))
    ) evidence.photo = true
    if (typeField && /^(?:video|gif|sticker|story|reel|media|attachment)$/.test(text)) evidence.media = true
    return evidence
  }

  if (!value || typeof value !== 'object') return evidence
  if (Array.isArray(value)) {
    value.forEach((item, index) => detectInboundMediaType(item, pathParts.concat(String(index)), evidence))
    return evidence
  }
  for (const [key, nested] of Object.entries(value)) {
    detectInboundMediaType(nested, pathParts.concat(key), evidence)
  }
  return evidence
}

function inboundMediaType(body) {
  const evidence = detectInboundMediaType(body)
  if (evidence.voice) return 'voice'
  if (evidence.photo) return 'photo'
  if (evidence.media) return 'media'
  return ''
}

function bodyHasMessageEnvelope(body) {
  if (!body || typeof body !== 'object') return false
  const hasIdentity = !!(body.contact_id || body.subscriber_id || body.user_id)
  if (!hasIdentity) return false
  return Object.keys(body).some((k) => MESSAGE_ENVELOPE_KEY_RE.test(String(k)))
}

function pickInboundText(body) {
  if (body && body.recovered_via) {
    return pickRecoveredPacketText(body)
  }

  const directCandidates = [
    ['text', body.text],
    ['message', body.message],
    ['message_text', body.message_text],
    ['last_input_text', body.last_input_text],
    ['last_text_input', body.last_text_input]
  ]
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .filter(([, value]) => String(value || '').trim())
    .filter(([, value]) => {
      const text = String(value || '').trim()
      return !PLACEHOLDER_TEXT_RE.test(text) && (looksLikeHumanText(text) || looksLikeReferenceLink(text) || looksLikeHeartReaction(text) || looksLikeDirectNumericReply(text, body))
    })
    .map(([pathKey, value]) => {
      const raw = String(value).trim()
      const heartReaction = looksLikeHeartReaction(raw)
      const text = heartReaction ? 'sent a heart reaction' : raw
      return {
        path: heartReaction ? `heart_reaction.${pathKey}` : pathKey,
        text,
        length: text.length,
        score: text.length + (heartReaction ? 6500 : 5000)
      }
    })

  const heartCandidates = collectHeartReactionCandidates(body)
  const allCandidates = collectTextCandidates(body)
  const byText = new Map()
  for (const candidate of directCandidates.concat(heartCandidates, allCandidates)) {
    const key = candidate.text
    const existing = byText.get(key)
    if (!existing || candidate.score > existing.score) {
      byText.set(key, candidate)
    }
  }

  const candidates = Array.from(byText.values())
    .sort((a, b) => b.score - a.score || b.length - a.length)

  const selected = candidates[0] || { path: '', text: '' }
  const selectedIsDirectHumanText = directCandidates.some((candidate) => (
    candidate.text === selected.text && (looksLikeHumanText(candidate.text) || looksLikeDirectNumericReply(candidate.text, body))
  ))
  const selectedIsNestedHumanText = Boolean(
    selected.text &&
    looksLikeHumanText(selected.text) &&
    !String(selected.path || '').startsWith('heart_reaction.') &&
    /^(?:text|message|message_text|last_input_text|last_text_input|input|reply|caption|content|body)$/i.test(
      String(selected.path || '').split('.').pop() || ''
    )
  )
  const mediaType = inboundMediaType(body)
  const referencePostText = pickReferencePostText(body)

  if (mediaType === 'voice' && !selectedIsDirectHumanText && !selectedIsNestedHumanText) {
    return { text: 'sent a voice note', source: 'media_only_voice_no_text', candidates: [] }
  }

  if (referencePostText && (
    !selected.text ||
    (!selectedIsDirectHumanText && !selectedIsNestedHumanText) ||
    looksLikeReferenceLink(selected.text)
  )) {
    return referencePostText
  }

  // Media-only / view-once / non-text inbound (photo, view-once "burn" pic, voice, sticker,
  // gif, or a share with no title). A real person sent something with no forwardable text;
  // ManyChat delivers it as an empty message_text and no accessible media object. Give it a
  // synthetic turn so it gets a warm human reply instead of the empty-text 400 drop at 1370.
  if (!selected.text && bodyHasMessageEnvelope(body)) {
    return { text: 'sent a photo', source: 'media_only_no_text', candidates: [] }
  }

  return {
    text: selected.text || '',
    source: selected.path || '',
    candidates: candidates.slice(0, 8).map((candidate) => ({
      path: candidate.path,
      length: candidate.length,
      preview: candidate.text.slice(0, 160)
    }))
  }
}

function collectInboundMediaUrls(body) {
  try {
    return collectTrustedMediaUrls(JSON.stringify(body), 3)
  } catch {
    return []
  }
}

function normalize(body) {
  const contact_id = String(body.contact_id || body.subscriber_id || body.user_id || '').trim()
  const thread_id = String(body.thread_id || contact_id || '').trim()
  const instagram_username = String(body.instagram_username || '').trim()
  const pickedText = pickInboundText(body)
  const media_type = inboundMediaType(body) || (
    pickedText.text === 'sent a photo' ? 'photo' : ''
  )
  const media_urls = collectInboundMediaUrls(body)
  const rawBody = JSON.stringify(body)

  const sourceInteractionCandidates = [
    body.source_interaction_at,
    body.ig_last_interaction,
    body.instagram_interaction_at,
    body.message_created_at,
    body.event_created_at
  ]
  const source_interaction_at = sourceInteractionCandidates
    .map((value) => String(value || '').trim())
    .find((value) => value && Number.isFinite(Date.parse(value))) || ''
  const receivedAtMs = Date.now()
  const received_at = new Date(receivedAtMs).toISOString()
  const providerMessageId = String(body.message_id || '').trim()
  const message_id = providerMessageId || (source_interaction_at
    ? `inbound-event-${sha256(`${rawBody}\n${source_interaction_at}`).slice(0, 32)}`
    // Without a provider event id or source interaction time there is no
    // trustworthy retry identity. Treat each authenticated arrival as a real
    // turn instead of silently discarding a customer's repeated short answer.
    : `inbound-arrival-${sha256(`${rawBody}\n${received_at}\n${crypto.randomUUID()}`).slice(0, 32)}`)
  const message_id_authority = providerMessageId
    ? 'provider_message_id'
    : source_interaction_at
      ? 'source_interaction_at'
      : 'ambiguous_arrival'

  return {
    contact_id,
    thread_id,
    message_id,
    message_id_authority,
    message_id_retry_window_ms: 0,
    instagram_username,
    text: pickedText.text,
    text_source: pickedText.source,
    text_candidates: pickedText.candidates,
    media_type,
    media_urls,
    manychat_tags: extractInboundTagNames(body),
    recovered_via: String(body.recovered_via || '').trim(),
    recovered_from_ig_last_interaction: String(body.recovered_from_ig_last_interaction || '').trim(),
    recovered_from_last_seen: String(body.recovered_from_last_seen || '').trim(),
    recovered_from_message_id: String(body.recovered_from_message_id || '').trim(),
    recovered_from_at: String(body.recovered_from_at || '').trim(),
    source_interaction_at,
    raw_body_sha256: sha256(rawBody),
    received_at
  }
}

function getSyntheticRecoveryVerdict(body) {
  const messageId = String(body?.message_id || '').trim()
  const recoveredVia = String(body?.recovered_via || '').trim()
  const synthetic = !!(recoveredVia || messageId.startsWith('watchdog-gap-'))

  if (!synthetic) {
    return {
      synthetic: false,
      accept: true,
      reason: ''
    }
  }

  if (SCV_FAIL_CLOSED_RECOVERY) {
    return {
      synthetic: true,
      accept: false,
      reason: 'synthetic_recovery_disabled'
    }
  }

  if (!TRUSTED_RECOVERY_SOURCES.has(recoveredVia)) {
    return {
      synthetic: true,
      accept: false,
      reason: 'untrusted_recovery_source'
    }
  }

  if (messageId.startsWith('watchdog-gap-') && recoveredVia !== 'watchdog_orphaned_user_turn') {
    return {
      synthetic: true,
      accept: false,
      reason: 'synthetic_gap_source_mismatch'
    }
  }

  return {
    synthetic: true,
    accept: true,
    reason: 'trusted_recovery_source'
  }
}

function isSyntheticRecoveryInbound(body) {
  return getSyntheticRecoveryVerdict(body).synthetic
}

function ensureDirs() {
  fs.mkdirSync(INBOX_DIR, { recursive: true })
  fs.mkdirSync(OUTBOX_DIR, { recursive: true })
  fs.mkdirSync(REACTBOX_DIR, { recursive: true })
  fs.mkdirSync(REACTBOX_DONE_DIR, { recursive: true })
  fs.mkdirSync(REACTBOX_FAILED_DIR, { recursive: true })
  fs.mkdirSync(THREAD_STATE_DIR, { recursive: true })
  fs.mkdirSync(THREAD_HISTORY_DIR, { recursive: true })
  fs.mkdirSync(OUTBOX_HUMAN_AGENT_REQUIRED_DIR, { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

function inboundWriterHoldThresholdMs(env = process.env) {
  const parsed = Number(env.SCV_HOLD_STALE_BACKLOG_MS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  let fd = null
  try {
    fd = fs.openSync(tmp, 'wx', 0o600)
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    fs.renameSync(tmp, file)

    // The rename is already atomic. Persist the directory entry when the
    // filesystem supports directory fsync without making a valid hold fail on
    // platforms that return EINVAL for it.
    let dirFd = null
    try {
      dirFd = fs.openSync(path.dirname(file), 'r')
      fs.fsyncSync(dirFd)
    } catch {
    } finally {
      if (dirFd !== null) fs.closeSync(dirFd)
    }
    return file
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch {}
    }
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {}
    throw error
  }
}

function holdInboundAtWriterBoundary(packet, verdict, now = new Date()) {
  ensureDirs()
  const file = path.join(
    OUTBOX_HUMAN_AGENT_REQUIRED_DIR,
    `inbound-writer-hold-${now.getTime()}-${crypto.randomUUID()}.json`
  )
  atomicWriteJson(file, {
    ...packet,
    type: 'inbound_writer_recovery_human_agent_required',
    manual_reason: String(verdict.reason || 'unsafe_immutable_ingress_time'),
    human_agent_required: true,
    held_at_writer_boundary: true,
    queued_for_human_agent_at: now.toISOString(),
    immutable_ingress_time_source: String(verdict.source || 'unknown'),
    immutable_ingress_timestamp_ms: Number.isFinite(verdict.timestamp_ms) ? verdict.timestamp_ms : null,
    recovery_cutover_timestamp_ms: Number.isFinite(verdict.cutover_ms) ? verdict.cutover_ms : null,
    stale_backlog_age_ms: Number.isFinite(verdict.age_ms) ? verdict.age_ms : null,
    stale_backlog_threshold_ms: Number.isFinite(verdict.threshold_ms) ? verdict.threshold_ms : null
  })
  return file
}

function safeThreadKey(thread_id) {
  return String(thread_id || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function threadStatePath(thread_id) {
  return path.join(THREAD_STATE_DIR, `${safeThreadKey(thread_id)}.json`)
}

function threadHistoryPath(thread_id) {
  return path.join(THREAD_HISTORY_DIR, `${safeThreadKey(thread_id)}.json`)
}

function getDuplicateInboundVerdict(packet) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '').trim()
  const messageId = String(packet?.message_id || '').trim()
  if (!threadId) {
    return { duplicate: false, reason: '' }
  }
  if (String(packet?.message_id_authority || '') === 'ambiguous_arrival') {
    return { duplicate: false, reason: 'ambiguous_arrival_requires_new_turn' }
  }

  const duplicateAgainst = (prior, location) => {
    if (!prior) return null
    const priorMessageId = String(prior?.message_id || prior?.latest_ingress_message_id || '').trim()
    if (messageId && priorMessageId === messageId) {
      return {
        duplicate: true,
        reason: `${location}_same_message_id`,
        matched_message_id: priorMessageId,
        bounded_retry_window: false
      }
    }
    return null
  }

  const latest = safeReadJson(threadStatePath(threadId))
  if (latest) {
    const verdict = duplicateAgainst(latest, 'thread_state')
    if (verdict) return verdict
  }

  const history = safeReadJson(threadHistoryPath(threadId))
  const events = Array.isArray(history?.events) ? history.events : []
  for (const event of events) {
    if (!event || event.role !== 'user') continue
    const verdict = duplicateAgainst(event, 'thread_history')
    if (verdict) return verdict
  }

  return { duplicate: false, reason: '' }
}

function duplicateInboundDurability(packet, duplicateVerdict = {}) {
  const currentMessageId = String(packet?.message_id || '').trim()
  const matchedMessageId = String(
    duplicateVerdict?.matched_message_id || currentMessageId
  ).trim()
  const pendingCandidates = [matchedMessageId, currentMessageId]
    .filter(Boolean)
    .flatMap((id) => {
      const base = path.join(INBOX_DIR, `${safeMessageKey(id)}.json`)
      return [base, `${base}.lock`]
    })
  const pendingFile = pendingCandidates.find((file) => fs.existsSync(file)) || ''
  if (pendingFile) {
    return { durable: true, terminal: false, pending: true, reason: 'durable_inbox_exists' }
  }

  const history = safeReadJson(threadHistoryPath(packet?.thread_id || packet?.contact_id), {})
  const events = Array.isArray(history?.events) ? history.events : []
  let matchedUserIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.role !== 'user') continue
    if (matchedMessageId && String(event.message_id || '') === matchedMessageId) {
      matchedUserIndex = index
      break
    }
    if (duplicateVerdict?.bounded_retry_window === true &&
        String(event.raw_body_sha256 || '') === String(packet?.raw_body_sha256 || '')) {
      matchedUserIndex = index
      break
    }
  }
  const terminal = matchedUserIndex >= 0 && events.slice(matchedUserIndex + 1).some((event) =>
    /^assistant(?:_|$)/.test(String(event?.role || '')) &&
    String(event?.message_id || '') === matchedMessageId
  )
  return {
    durable: terminal,
    terminal,
    pending: false,
    reason: terminal ? 'assistant_terminal_history_exists' : 'dedup_state_without_durable_work'
  }
}

function boundedPromise(factory, timeoutMs, timeoutReason) {
  let timer = null
  const operation = Promise.resolve().then(factory)
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error(timeoutReason)
      error.code = 'SCV_ENRICHMENT_TIMEOUT'
      reject(error)
    }, timeoutMs)
  })
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer))
}

async function boundedInstagramSuppression(username, context, options = {}) {
  const lookup = options.lookup || getInstagramSuppressionForUsername
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : SCV_INSTAGRAM_ENRICH_TIMEOUT_MS
  try {
    return await boundedPromise(
      () => lookup(username, context),
      timeoutMs,
      'instagram_thread_lookup_timeout'
    )
  } catch (error) {
    return {
      suppressed: false,
      matched_tag: '',
      reason: error?.code === 'SCV_ENRICHMENT_TIMEOUT'
        ? 'instagram_thread_lookup_timeout'
        : 'instagram_thread_lookup_failed'
    }
  }
}

async function manychatSubscriberGetInfo(subscriberId, options = {}) {
  const env = options.env || process.env
  const apiKey = options.apiKey === undefined ? MANYCHAT_API_KEY : String(options.apiKey || '')
  const fetchImpl = options.fetchImpl || fetch
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : SCV_MANYCHAT_ENRICH_TIMEOUT_MS
  const url = new URL(manychatSubscriberInfoUrl(env))
  url.searchParams.set('subscriber_id', String(subscriberId))
  const controller = new AbortController()
  try {
    return await boundedPromise(async () => {
      const resp = await fetchImpl(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: controller.signal
      })
      const text = await resp.text()
      let parsed = {}
      try {
        parsed = text ? JSON.parse(text) : {}
      } catch {
        parsed = { status: 'error' }
      }
      return { http_status: resp.status, body: parsed }
    }, timeoutMs, 'manychat_lookup_timeout')
  } catch (error) {
    if (error?.code === 'SCV_ENRICHMENT_TIMEOUT') controller.abort()
    throw error
  }
}

async function enrichInboundPacket(packet, body, options = {}) {
  const instagramSuppression = await boundedInstagramSuppression(packet.instagram_username, {
    text: packet.text || body?.message_text || body?.text || ''
  })
  const basePacket = applyExternalSuppression(
    applyAutomationSuppression(packet),
    instagramSuppression
  )

  if (!MANYCHAT_API_KEY) {
    return {
      packet: basePacket,
      enrichment: {
        enabled: false,
        reason: 'missing_manychat_api_key',
        instagram_thread_suppression: instagramSuppression
      }
    }
  }

  if (body && body.recovered_via) {
    return {
      packet: basePacket,
      enrichment: {
        enabled: false,
        reason: 'synthetic_recovery_packet',
        instagram_thread_suppression: instagramSuppression
      }
    }
  }

  if (body && body.canary === true) {
    return {
      packet: {
        ...basePacket,
        canary: true,
        canary_kind: String(body.canary_kind || '')
      },
      enrichment: {
        enabled: false,
        reason: 'canary_packet_preserve_posted_text',
        instagram_thread_suppression: instagramSuppression
      }
    }
  }

  if (!/^\d+$/.test(String(packet.contact_id || ''))) {
    return {
      packet: basePacket,
      enrichment: {
        enabled: false,
        reason: 'non_numeric_contact_id',
        instagram_thread_suppression: instagramSuppression
      }
    }
  }

  try {
    const info = options.manychatInfo || await manychatSubscriberGetInfo(packet.contact_id)
    const data = info?.body?.data || {}
    const manychatTags = extractTagNames(data.tags)
    const latestText = String(data.last_input_text || '').trim()
    const latestInteractionAtRaw = String(data.ig_last_interaction || data.ig_last_seen || '').trim()
    const latestInteractionAtMs = Date.parse(latestInteractionAtRaw) || 0
    if (info.http_status !== 200 || info?.body?.status !== 'success') {
      return {
        packet: applyExternalSuppression(
          applyAutomationSuppression(packet, manychatTags),
          instagramSuppression
        ),
        enrichment: {
          enabled: true,
          applied: false,
          reason: 'manychat_lookup_failed',
          http_status: info.http_status,
          status: String(info?.body?.status || ''),
          manychat_tags: manychatTags,
          instagram_thread_suppression: instagramSuppression
        }
      }
    }

    const packetWithManyChatInteraction = latestInteractionAtMs
      ? { ...basePacket, manychat_latest_interaction_at: latestInteractionAtRaw }
      : basePacket

    if (!looksLikeHumanText(latestText)) {
      return {
        packet: applyExternalSuppression(
          applyAutomationSuppression(packetWithManyChatInteraction, manychatTags),
          instagramSuppression
        ),
        enrichment: {
          enabled: true,
          applied: false,
          reason: 'manychat_text_not_human',
          manychat_tags: manychatTags,
          instagram_thread_suppression: instagramSuppression
        }
      }
    }

    const matchesPostedText = latestText === String(packet.text || '').trim()
    return {
      packet: applyExternalSuppression(
        applyAutomationSuppression(packetWithManyChatInteraction, manychatTags),
        instagramSuppression
      ),
      enrichment: {
        enabled: true,
        applied: false,
        reason: matchesPostedText
          ? 'manychat_metadata_matches_posted_text'
          : 'manychat_text_differs_posted_text_preserved',
        latest_interaction_at: latestInteractionAtRaw,
        manychat_tags: manychatTags,
        instagram_thread_suppression: instagramSuppression
      }
    }
  } catch (err) {
    return {
      packet: basePacket,
      enrichment: {
        enabled: true,
        applied: false,
        reason: err?.code === 'SCV_ENRICHMENT_TIMEOUT' ? 'manychat_lookup_timeout' : 'manychat_exception',
        instagram_thread_suppression: instagramSuppression
      }
    }
  }
}

function safeMessageKey(message_id) {
  return String(message_id || '').replace(/[^a-zA-Z0-9._-]/g, '_') || crypto.randomUUID()
}

function writeInboxPacket(packet, options = {}) {
  const safeId = safeMessageKey(packet.message_id)
  const file = path.join(INBOX_DIR, `${safeId}.json`)
  const bodyText = JSON.stringify(packet, null, 2) + '\n'
  try {
    if (options.durable === true) atomicWriteJson(file, packet)
    else fs.writeFileSync(file, bodyText)
  } catch (err) {
    // Live 2026-07-28: a full /data volume (ENOSPC) made this write fail with
    // zero stdout trace — brand-new contacts vanished unrecoverably. A persist
    // failure must be loud (stdout survives a full disk) and gets exactly one
    // self-heal retry after rotating machine journals; a second failure throws
    // to the handler so ManyChat receives a 5xx instead of a silent 200.
    console.error('===INBOUND_PERSIST_FAIL===')
    console.error(JSON.stringify({
      ...redactedInboundIdentity(packet),
      reason: safeLogErrorReason(err)
    }))
    try { emergencyDiskRelief(ROOT) } catch {}
    if (options.durable === true) atomicWriteJson(file, packet)
    else fs.writeFileSync(file, bodyText)
    console.log('===INBOUND_PERSIST_RECOVERED_AFTER_RELIEF===')
  }
  return file
}

function boundedReceiptHasMessageId(file, messageId, maxBytes = 2 * 1024 * 1024) {
  try {
    const stat = fs.statSync(file)
    const length = Math.min(stat.size, maxBytes)
    const start = Math.max(0, stat.size - length)
    const buffer = Buffer.alloc(length)
    const fd = fs.openSync(file, 'r')
    try { fs.readSync(fd, buffer, 0, length, start) } finally { fs.closeSync(fd) }
    return buffer.toString('utf8').split(/\r?\n/).some((line) => {
      if (!line) return false
      try {
        const row = JSON.parse(line)
        return String(row?.message_id || row?.source_message_id || '') === messageId
      } catch { return false }
    })
  } catch { return false }
}

function legacyManyChatDurableIngressExists(context = {}) {
  const messageId = String(context.expected_message_id || '')
  const replayKey = String(context.replay_key || '')
  const contactId = String(context.contact_id || '')
  if (!/^legacy-manychat-[a-f0-9]{32}$/.test(messageId) ||
      !/^[a-f0-9]{64}$/.test(replayKey) ||
      !/^[1-9][0-9]{0,31}$/.test(contactId)) return false

  for (const suffix of ['.json', '.json.lock']) {
    const packet = safeReadJson(path.join(INBOX_DIR, `${safeMessageKey(messageId)}${suffix}`))
    if (String(packet?.message_id || '') === messageId &&
        String(packet?.legacy_manychat_replay_key || '') === replayKey) return true
  }
  const state = safeReadJson(threadStatePath(contactId))
  if (String(state?.latest_ingress_message_id || '') === messageId) return true
  const history = safeReadJson(threadHistoryPath(contactId))
  if ((Array.isArray(history?.events) ? history.events : []).some((event) =>
    String(event?.message_id || '') === messageId)) return true
  try {
    const held = fs.readdirSync(OUTBOX_HUMAN_AGENT_REQUIRED_DIR)
      .filter((name) => name.endsWith('.json'))
      .slice(-2_048)
      .some((name) => {
        const packet = safeReadJson(path.join(OUTBOX_HUMAN_AGENT_REQUIRED_DIR, name))
        return String(packet?.message_id || '') === messageId &&
          String(packet?.legacy_manychat_replay_key || '') === replayKey
      })
    if (held) return true
  } catch {}
  return boundedReceiptHasMessageId(
    path.join(LOG_DIR, 'inbound-processing-receipts.ndjson'),
    messageId
  )
}

function releaseLegacyManyChatPending(proof) {
  if (!proof) return
  try { releaseReplayReservation(proof) } catch {}
}

function splitEnvList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

function isFastInboxTarget(packet) {
  const contactId = String(packet?.contact_id || packet?.subscriber_id || packet?.thread_id || '').trim().toLowerCase()
  const username = String(packet?.instagram_username || packet?.username || '').trim().toLowerCase()
  const fastContactIds = splitEnvList(process.env.SCV_FAST_TARGET_CONTACT_IDS)
  const fastUsernames = splitEnvList(process.env.SCV_FAST_TARGET_USERNAMES)

  return (
    (contactId && fastContactIds.includes(contactId)) ||
    (username && fastUsernames.includes(username))
  )
}

function kickInboxWorkerIfNeeded(packet, inboxFile) {
  const verdict = {
    enabled: SCV_FAST_TARGET_INBOX_KICK,
    kicked: false,
    reason: '',
    label: SCV_INBOX_WORKER_LABEL,
    mode: SCV_FAST_TARGET_INBOX_KICK_MODE,
    inbox_file: inboxFile || null
  }

  if (!inboxFile) {
    verdict.reason = 'no_inbox_file'
    return verdict
  }
  if (!SCV_FAST_TARGET_INBOX_KICK) {
    verdict.reason = 'disabled'
    return verdict
  }
  if (!isFastInboxTarget(packet)) {
    verdict.reason = 'not_fast_target'
    return verdict
  }
  if (String(process.env.SCV_CLOUD_RUNTIME || '') === '1') {
    verdict.reason = 'cloud_runtime_launchctl_disabled_worker_already_running'
    return verdict
  }
  if (!fs.existsSync('/bin/launchctl')) {
    verdict.reason = 'launchctl_missing_worker_already_running'
    return verdict
  }

  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null
    if (uid === null || uid === undefined) {
      verdict.reason = 'uid_unavailable'
      return verdict
    }

    const args = ['kickstart']
    if (SCV_FAST_TARGET_INBOX_KICK_MODE === 'restart') args.push('-k')
    args.push(`gui/${uid}/${SCV_INBOX_WORKER_LABEL}`)

    const child = spawn('/bin/launchctl', args, {
      detached: true,
      stdio: 'ignore'
    })
    child.on('error', () => {})
    child.unref()

    verdict.kicked = true
    verdict.reason = 'fast_target_inbox_kick'
    return verdict
  } catch (err) {
    verdict.reason = `kick_failed:${safeLogErrorReason(err)}`
    return verdict
  }
}

function normalizedReactionKey(packet) {
  return `${safeThreadKey(packet.thread_id || packet.contact_id || '')}--${safeMessageKey(packet.message_id)}`
}

function reactionJobFileCandidates(packet) {
  const base = normalizedReactionKey(packet)
  return [
    path.join(REACTBOX_DIR, `${base}.json`),
    path.join(REACTBOX_DIR, `${base}.json.lock`),
    path.join(REACTBOX_DONE_DIR, `${base}.json`),
    path.join(REACTBOX_FAILED_DIR, `${base}.json`)
  ]
}

function reactionChanceBucket(packet) {
  const raw = sha256(`${packet.thread_id || packet.contact_id}::${packet.message_id || ''}::reaction`)
  return Number.parseInt(raw.slice(0, 8), 16) / 0xffffffff
}

function reactionDelayMs(packet) {
  if (SCV_REACTION_DELAY_MAX_MS <= SCV_REACTION_DELAY_MIN_MS) {
    return SCV_REACTION_DELAY_MIN_MS
  }

  const raw = sha256(`${packet.thread_id || packet.contact_id}::${packet.message_id || ''}::reaction_delay`)
  const bucket = Number.parseInt(raw.slice(0, 8), 16) / 0xffffffff
  return Math.round(
    SCV_REACTION_DELAY_MIN_MS +
    ((SCV_REACTION_DELAY_MAX_MS - SCV_REACTION_DELAY_MIN_MS) * bucket)
  )
}

function reactionEligibility(packet) {
  const value = String(packet?.text || '').trim()
  const messageId = String(packet?.message_id || '').trim()
  if (!value) return { eligible: false, reason: 'empty_text', score: 0 }
  if (messageId.startsWith('watchdog-gap-')) return { eligible: false, reason: 'synthetic_gap_message', score: 0 }
  if (value.length === 1 && /^[?!.,]$/.test(value)) return { eligible: false, reason: 'punct_only', score: 0 }
  if (/^[\d\s+()./:,-]+$/.test(value)) return { eligible: false, reason: 'numeric_or_schedule_only', score: 0 }
  if (!/[a-zA-Z가-힣]/.test(value)) return { eligible: false, reason: 'no_human_letters', score: 0 }

  const lower = value.toLowerCase()
  const normalized = lower.replace(/\s+/g, ' ').trim()
  const lowSignalExact = new Set([
    'ok', 'okay', 'okk', 'okie', 'okkie', 'sure',
    'does that work', 'lmk'
  ])
  if (lowSignalExact.has(normalized)) {
    return { eligible: false, reason: 'low_signal_ack', score: 0 }
  }

  const bookingIntentRe = /\b(i just submitted|just submitted|submitted it|i submitted|sent it|i sent it|done!|done !!|donee|let'?s do it|lets do it|i'?m down|im down|i want to book|book it|i'?m ready|im ready|that works for me|works for me let'?s|can i book|want to lock it in|lock it in|can i get the form|send the form|i can do|i could do|that date works|that works)\b/i
  const logisticsRe = /\b(name|phone|number|form|submitted|submit|deposit|available|availability|date|time|schedule|scheduled|under the form|works for you|what day|which day|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm)\b/i
  const bookingLikely = bookingIntentRe.test(value)
  if (logisticsRe.test(value) && !bookingLikely) {
    return { eligible: false, reason: 'booking_logistics', score: 0 }
  }

  const positiveAffectRe = /\b(love|luv|excited|so excited|cant wait|can't wait|dream|obsessed|amazing|beautiful|so good|perfect for me|gift for myself|really want|really wanna|would love|been wanting)\b/i
  const ideaRe = /\b(i want|i wanna|get|get a|piece|idea|design|vibe|reference|tattoo|thinking|imagining|style|on my)\b/i
  const enthusiasmRe = /!{1,}|(:3|hehe|haha|lol|lmao|omg|yess|yesss|yay|finally|super|so much|really)/i
  const warmAckRe = /\b(for sure|sounds good|absolutely|perfect+|both are fine|works for me|cool|awesome|bet|love that|that sounds good)\b/i
  const shortPositiveAckRe = /^(yes+|yeah+|yea+|yep+|yeap+|ty|tysmm|tysm|thanks+|thank you+|thank youuu|perfect+|love that|sounds good|for sure|absolutely|bet|cool|awesome)$/i

  let score = 0
  if (positiveAffectRe.test(value)) score += 2
  if (ideaRe.test(value)) score += 1
  if (enthusiasmRe.test(value)) score += 1
  if (warmAckRe.test(value)) score += 1
  if (shortPositiveAckRe.test(normalized)) score += 1
  if (bookingLikely) score += 2
  if (value.length >= 40) score += 1
  if (/\b(on my|style|vibe|reference|design|piece|tattoo)\b/i.test(value)) score += 1

  if (score >= 1) {
    return { eligible: true, reason: bookingLikely ? 'positive_or_booking_intent' : 'positive_or_excited_idea', score }
  }

  return { eligible: false, reason: 'not_warm_enough_for_reaction', score }
}

function enqueueReactionJob(packet) {
  if (!SCV_REACTION_ENABLED) {
    return { enabled: false, enqueued: false, reason: 'reaction_disabled' }
  }

  if (packet?.automation_suppressed) {
    return {
      enabled: true,
      enqueued: false,
      reason: 'automation_suppressed_tag',
      matched_tag: String(packet?.automation_suppressed_tag || '')
    }
  }

  if (!String(packet.instagram_username || '').trim()) {
    return { enabled: true, enqueued: false, reason: 'missing_instagram_username' }
  }

  const reactionDecision = reactionEligibility(packet)
  if (!reactionDecision.eligible) {
    return { enabled: true, enqueued: false, reason: reactionDecision.reason, score: reactionDecision.score }
  }

  const adaptiveRate = getAdaptiveReactionRate(packet, SCV_REACTION_RATE)

  if (reactionChanceBucket(packet) > adaptiveRate) {
    return { enabled: true, enqueued: false, reason: 'rate_filtered', rate: adaptiveRate, base_rate: SCV_REACTION_RATE }
  }

  const files = reactionJobFileCandidates(packet)
  if (files.some((file) => fs.existsSync(file))) {
    return { enabled: true, enqueued: false, reason: 'already_queued_or_done' }
  }

  const delayMs = reactionDelayMs(packet)
  const job = {
    source: 'scv_inbound_reaction_sidecar',
    contact_id: String(packet.contact_id || ''),
    thread_id: String(packet.thread_id || packet.contact_id || ''),
    message_id: String(packet.message_id || ''),
    instagram_username: String(packet.instagram_username || ''),
    text: String(packet.text || ''),
    reaction_reason: reactionDecision.reason,
    reaction_score: reactionDecision.score,
    adaptive_reaction_rate: adaptiveRate,
    source_interaction_at: String(packet.source_interaction_at || ''),
    recovered_from_ig_last_interaction: String(packet.recovered_from_ig_last_interaction || ''),
    manychat_latest_interaction_at: String(packet.manychat_latest_interaction_at || ''),
    recovered_from_at: String(packet.recovered_from_at || ''),
    received_at: String(packet.received_at || new Date().toISOString()),
    emoji: SCV_REACTION_EMOJI,
    due_at: new Date(Date.now() + delayMs).toISOString(),
    reaction_delay_ms: delayMs,
    created_at: new Date().toISOString()
  }

  const dest = files[0]
  fs.writeFileSync(dest, JSON.stringify(job, null, 2) + '\n')

  return {
    enabled: true,
    enqueued: true,
    reason: 'queued',
    reaction_reason: reactionDecision.reason,
    reaction_score: reactionDecision.score,
    file: dest,
    due_at: job.due_at,
    reaction_delay_ms: delayMs
  }
}

const server = http.createServer(async (req, res) => {
  // Request-local by construction. A malformed or oversized concurrent request
  // must never inherit another customer's identity in its error log.
  let inboundIdentityHint = null
  let legacyManyChatProof = null
  let legacyManyChatDurable = false
  try {
    const pathname = new URL(String(req.url || '/'), 'http://scv.local').pathname

    if (req.method === 'GET' && pathname === '/livez') {
      return sendJson(res, 200, { ok: true, service: 'scv-inbound', mode: 'transport_only' })
    }

    if (req.method === 'GET' && pathname === '/deployz') {
      const readiness = buildReadiness(Date.now(), {
        allowActiveFailCloseForDeployment: true
      })
      return sendJson(res, readiness.ok ? 200 : 503, {
        ok: readiness.ok,
        deployment_probe: true,
        outbound_still_fail_closed: readiness.automation_fail_close?.active === true,
        preflight_verified: readiness.preflight_proof?.ok === true,
        critical_drift_ok: readiness.drift_status?.critical_ok === true,
        capability_canary_ok: readiness.capability_canary?.ok === true,
        release_id: String(readiness.golden_production_release?.release_id || ''),
        content_fingerprint_sha256: String(
          readiness.golden_production_release?.content_fingerprint_sha256 || ''
        )
      })
    }

    if (req.method === 'GET' && (pathname === '/readyz' || pathname === '/health')) {
      const readiness = buildReadiness()
      return sendJson(res, readiness.ok ? 200 : 503, {
        ok: readiness.ok,
        fail_close_active: readiness.automation_fail_close?.active === true,
        preflight_verified: readiness.preflight_proof?.ok === true,
        capability_mode: readiness.capability_mode,
        capability_boundary_ok: readiness.capability_boundary_ok === true,
        external_capabilities_verified:
          readiness.external_capabilities_verified === true,
        external_workers_started: readiness.external_workers_started,
        readiness_scope: readiness.readiness_scope,
        drift: {
          critical_ok: readiness.drift_status?.critical_ok === true,
          age_ms: readiness.drift_status?.age_ms ?? null,
          critical_alert_count: Number(
            readiness.drift_status?.critical_alert_count || 0
          ),
          operational_alert_count: Number(
            readiness.drift_status?.operational_alert_count || 0
          )
        },
        capability_canary: readiness.capability_canary,
        delivery_visibility: deliveryVisibilityReadiness(),
        release: {
          ok: readiness.golden_production_release?.ok === true,
          mode: String(readiness.golden_production_release?.mode || ''),
          release_phase: String(process.env.SCV_RELEASE_PHASE || 'active'),
          phase_ready: readiness.release_phase?.ok === true,
          release_id: String(readiness.golden_production_release?.release_id || ''),
          content_fingerprint_sha256: String(
            readiness.golden_production_release?.content_fingerprint_sha256 || ''
          ),
          release_manifest_sha256: String(
            readiness.golden_production_release?.release_manifest_sha256 || ''
          )
        },
        model_identity: readiness.model_identity,
        behavior_contract: readiness.behavior_contract
      })
    }

    if (req.method === 'GET' && pathname === '/stability') {
      const authorization = authorizeSharedSecret(
        req,
        SCV_ADMIN_SECRET,
        'x-scv-admin-token',
        adminAuthRequired(process.env)
      )
      if (!authorization.ok) return sendJson(res, authorization.status, { ok: false, error: authorization.error })

      const driftStatus = safeReadJsonFile(DRIFT_STATUS_FILE)
      const failClose = readFailClose({ env: process.env, root: ROOT })
      const readiness = buildReadiness()
      const release = readiness.golden_production_release
      return sendJson(res, readiness.ok ? 200 : 503, {
        ok: readiness.ok,
        transport_ok: true,
        automation_fail_closed: failClose.active === true,
        fail_close_reason_sha256: failClose.reason ? sha256(String(failClose.reason)) : '',
        mode: 'transport_only',
        contract_harness: {
          locked: SCV_CONTRACT_HARNESS_LOCKED,
          lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION
        },
        delivery_pacing: {
          locked: true,
          lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
          settings: pacingSettingsFromEnv(process.env)
        },
        queues: {
          inbox: countJsonFiles(INBOX_DIR),
          outbox: countJsonFiles(OUTBOX_DIR),
          reactbox: countJsonFiles(REACTBOX_DIR),
          reactbox_done: countJsonFiles(REACTBOX_DONE_DIR),
          reactbox_failed: countJsonFiles(REACTBOX_FAILED_DIR),
          inbox_deadletter: countJsonFiles(path.join(ROOT, 'inbox_quarantine_deadletter')),
          outbox_failed: countJsonFiles(path.join(ROOT, 'outbox_quarantine_failed')),
          outbox_contract_harness: countJsonFiles(path.join(ROOT, 'outbox_quarantine_contract_harness')),
          outbox_human_agent_required: countJsonFiles(path.join(ROOT, 'outbox_human_agent_required')),
          outbox_pre_single_control: countJsonFiles(path.join(ROOT, 'outbox_quarantine_pre_single_control')),
          outbox_idempotency: countJsonFiles(path.join(ROOT, 'outbox-idempotency')),
          thread_state_quarantine: countJsonFiles(path.join(ROOT, 'thread-state_quarantine_contaminated')),
          thread_history_quarantine: countJsonFiles(path.join(ROOT, 'thread-history_quarantine_contaminated'))
        },
        last_delivery: redactedDeliveryReceipt(safeReadJsonFile(LAST_DELIVERY_FILE)),
        delivery_visibility: deliveryVisibilityReadiness(),
        drift_status: redactedDriftStatus(driftStatus),
        readiness: {
          ok: readiness.ok,
          strict: readiness.strict,
          runtime_mode: readiness.runtime_mode,
          failures: readiness.failures,
          automation_paused: readiness.automation_paused,
          pause_non_test: readiness.pause_non_test,
          pause_debug_accounts: readiness.pause_debug_accounts,
          release_phase: readiness.release_phase,
          preflight_verified: readiness.preflight_proof?.ok === true,
          persistence_ready: readiness.persistence_ready,
          supervisor_ok: readiness.supervisor?.ok === true,
          critical_drift_ok: readiness.drift_status?.critical_ok === true,
          capability_canary_ok: readiness.capability_canary?.ok === true
        },
        capability_canary: readiness.capability_canary,
        release: {
          ok: release?.ok === true,
          mode: String(release?.mode || ''),
          release_id: String(release?.release_id || ''),
          content_fingerprint_sha256: String(release?.content_fingerprint_sha256 || ''),
          release_manifest_sha256: String(release?.release_manifest_sha256 || '')
        }
      })
    }

    if (req.method === 'GET' && pathname === '/next-inbox' && SCV_LEGACY_INTERNAL_QUEUE_HTTP) {
      const authorization = authorizeSharedSecret(
        req,
        SCV_ADMIN_SECRET,
        'x-scv-admin-token',
        true
      )
      if (!authorization.ok) return sendJson(res, authorization.status, { ok: false, error: authorization.error })

      ensureDirs()
      const files = fs.readdirSync(INBOX_DIR)
        .filter(name => name.endsWith('.json'))
        .map(name => path.join(INBOX_DIR, name))
        .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)

      if (!files.length) {
        return sendJson(res, 200, { ok: true, found: false })
      }

      const file = files[0]
      const packet = JSON.parse(fs.readFileSync(file, 'utf8'))
      return sendJson(res, 200, {
        ok: true,
        found: true,
        file: path.basename(file),
        packet
      })
    }

    if (req.method === 'POST' && pathname === '/ack-inbox' && SCV_LEGACY_INTERNAL_QUEUE_HTTP) {
      const authorization = authorizeSharedSecret(
        req,
        SCV_ADMIN_SECRET,
        'x-scv-admin-token',
        true
      )
      if (!authorization.ok) return sendJson(res, authorization.status, { ok: false, error: authorization.error })

      ensureDirs()
      const body = await readJsonBody(req)
      const requested = String(body.file || '').trim()
      if (!requested) return sendJson(res, 400, { ok: false, error: 'missing_file' })
      if (requested !== path.basename(requested) || !requested.endsWith('.json')) {
        return sendJson(res, 400, { ok: false, error: 'invalid_file' })
      }
      const file = path.join(INBOX_DIR, requested)
      if (!fs.existsSync(file)) return sendJson(res, 404, { ok: false, error: 'file_not_found' })
      fs.unlinkSync(file)
      return sendJson(res, 200, { ok: true, deleted: requested })
    }

    if (req.method === 'POST' && (pathname === '/' || pathname === '/manychat/inbound')) {
      const authRequired = ingressAuthRequired(process.env)
      const authorization = authorizeSharedSecret(
        req,
        SCV_INGRESS_SECRET,
        'x-scv-ingress-token',
        authRequired
      )
      // A supplied-but-wrong credential never falls back. Compatibility exists
      // only for the old ManyChat External Request, which supplies no credential.
      const legacyFallback = pathname === '/manychat/inbound' &&
        !authorization.ok &&
        authorization.error === 'unauthorized' &&
        Boolean(SCV_INGRESS_SECRET) &&
        legacyFallbackEligible(req, { required: authRequired, env: process.env })
      if (!authorization.ok && !legacyFallback) {
        return sendJson(res, authorization.status, { ok: false, error: authorization.error })
      }
      if (!ingressRateAllowed(req)) return sendJson(res, 429, { ok: false, error: 'rate_limited' })
      if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) {
        return sendJson(res, 415, { ok: false, error: 'content_type_must_be_application_json' })
      }

      const body = await readJsonBody(req)
      if (legacyFallback) {
        legacyManyChatProof = await verifyLegacyManyChatIngress({
          req,
          body,
          root: ROOT,
          env: process.env,
          authRequired,
          durableIngressProbe: legacyManyChatDurableIngressExists
        })
        if (!legacyManyChatProof.ok) {
          console.log('===INBOUND_LEGACY_MANYCHAT_DENIED===')
          console.log(JSON.stringify({
            ...redactedInboundIdentity(body),
            reason: String(legacyManyChatProof.reason || 'legacy_manychat_verification_failed')
          }))
          const status = Number(legacyManyChatProof.status || 401)
          const error = status === 409
            ? 'duplicate_legacy_manychat_inbound'
            : status >= 500
              ? 'legacy_manychat_verification_unavailable'
              : 'unauthorized'
          return sendJson(res, status, { ok: false, error })
        }
        console.log('===INBOUND_LEGACY_MANYCHAT_VERIFIED===')
        console.log(JSON.stringify({
          ...redactedInboundIdentity(body),
          provider_interaction_at: legacyManyChatProof.provider_interaction_at,
          provider_response_sha256: legacyManyChatProof.provider_response_sha256,
          reason: legacyManyChatProof.reason
        }))
      }

      // No runtime directory, audit, state, history, or queue mutation occurs
      // until shared-secret auth or the provider-backed compatibility proof wins.
      ensureDirs()
      const rawBody = JSON.stringify(body || {})
      appendNdjson(RAW_INBOUND_AUDIT, {
        type: 'redacted_inbound_received',
        at: new Date().toISOString(),
        path: pathname,
        body_sha256: sha256(rawBody),
        body_bytes: Buffer.byteLength(rawBody),
        ...redactedInboundIdentity(body)
      })

      console.log('===INBOUND_DOOR===')
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        ...redactedInboundIdentity(body),
        body_sha256: sha256(rawBody),
        reason: legacyManyChatProof
          ? 'provider_verified_legacy_manychat_inbound'
          : 'authorized_json_inbound'
      }))

      const syntheticRecovery = getSyntheticRecoveryVerdict(body)
      if (syntheticRecovery.synthetic && !syntheticRecovery.accept) {
        releaseLegacyManyChatPending(legacyManyChatProof)
        legacyManyChatProof = null
        recordLearningOutcome({
          instagram_username: String(body?.instagram_username || ''),
          text: String(body?.text || body?.message_text || body?.message || ''),
          bubble: { text: String(body?.text || body?.message_text || body?.message || '') }
        }, 'synthetic_drop')
        console.log('===INBOUND_FAIL_CLOSED_SYNTHETIC===')
        console.log(JSON.stringify({
          ...redactedInboundIdentity(body),
          reason: syntheticRecovery.reason
        }))
        return sendJson(res, 200, {
          ok: true,
          transport_only: true,
          stored: false,
          dropped: true,
          reason: syntheticRecovery.reason
        })
      }

      const identityVerdict = inboundIdentityVerdict(body, process.env)
      if (!identityVerdict.ok) {
        releaseLegacyManyChatPending(legacyManyChatProof)
        legacyManyChatProof = null
        console.log('===INBOUND_INVALID_IDENTITY_DROP===')
        console.log(JSON.stringify({
          ...redactedInboundIdentity(body),
          reason: String(identityVerdict.reason || 'invalid_inbound_identity')
        }))
        return sendJson(res, 400, { ok: false, error: 'invalid_inbound_identity' })
      }

      const normalizedBasePacket = normalize(body)
      const normalizedPacket = legacyManyChatProof
        ? {
            ...normalizedBasePacket,
            message_id: legacyManyChatProof.expected_message_id,
            message_id_authority: 'provider_verified_legacy_manychat',
            message_id_retry_window_ms: 0,
            source_interaction_at: legacyManyChatProof.provider_interaction_at,
            legacy_manychat_replay_key: legacyManyChatProof.replay_key
          }
        : normalizedBasePacket
      const { packet, enrichment } = await enrichInboundPacket(normalizedPacket, body, {
        manychatInfo: legacyManyChatProof?.manychat_info
      })
      inboundIdentityHint = {
        ...redactedInboundIdentity({
          contact_id: packet.contact_id || body?.contact_id,
          instagram_username: packet.instagram_username || body?.instagram_username,
          message_id: packet.message_id || body?.message_id
        })
      }

      if (!packet.contact_id || !packet.text) {
        releaseLegacyManyChatPending(legacyManyChatProof)
        legacyManyChatProof = null
        console.log('===INBOUND_EMPTY_TEXT_DROP===')
        console.log(JSON.stringify({
          ...redactedInboundIdentity({
            contact_id: packet.contact_id || body?.contact_id,
            instagram_username: packet.instagram_username || body?.instagram_username,
            message_id: packet.message_id || body?.message_id
          }),
          reason: 'missing_contact_id_or_text',
          picked_text_source: String(packet.text_source || ''),
          body_sha256: sha256(JSON.stringify(body || {}))
        }))
        return sendJson(res, 400, { ok: false, error: 'missing_contact_id_or_text' })
      }


      // Omar.system is a destructive-reset debug account. ManyChat can retry an
      // older direct webhook after local state has been purged; because templates
      // often omit message_id, normalize() must generate a new local id and normal
      // dedup cannot recognize the replay. Compare externally anchored Instagram /
      // ManyChat interaction time to the reset watermark before any state mutation.
      const debugResetBoundary = debugResetBoundaryVerdict(ROOT, packet)
      if (debugResetBoundary.predates) {
        releaseLegacyManyChatPending(legacyManyChatProof)
        legacyManyChatProof = null
        recordLearningOutcome(packet, 'debug_reset_stale_inbound_drop')
        console.log('===INBOUND_DEBUG_RESET_STALE_DROP===')
        console.log(JSON.stringify({
          ...redactedInboundIdentity(packet),
          reason: debugResetBoundary.reason,
          timestamp_source: debugResetBoundary.source,
          interaction_at: debugResetBoundary.interaction_at,
          reset_at: debugResetBoundary.reset_at
        }))
        return sendJson(res, 200, {
          ok: true,
          transport_only: true,
          stored: false,
          dropped: true,
          reason: 'debug_reset_stale_inbound'
        })
      }

      // A direct ManyChat retry can carry an April interaction timestamp even
      // though this HTTP delivery arrived now. Gate that immutable timestamp at
      // the writer boundary, before history/state, reaction, or inbox mutation.
      // Packets without an upstream interaction time retain received_at=now and
      // therefore continue through the live path.
      const writerBoundaryNow = Date.now()
      const writerBoundaryVerdict = recoveryQueueSafetyVerdict(
        packet,
        process.env,
        undefined,
        writerBoundaryNow,
        inboundWriterHoldThresholdMs(process.env)
      )
      if (writerBoundaryVerdict.hold) {
        const holdFile = holdInboundAtWriterBoundary(packet, writerBoundaryVerdict, new Date(writerBoundaryNow))
        if (legacyManyChatProof) {
          legacyManyChatDurable = true
          const replayCommit = commitReplayLedger(legacyManyChatProof, {
            durableIngressIdentity: holdFile
          })
          if (!replayCommit.ok) throw new Error('legacy_manychat_replay_commit_failed')
        }
        console.log('===INBOUND_WRITER_BOUNDARY_HOLD===')
        console.log(JSON.stringify({
          ...redactedInboundIdentity(packet),
          reason: String(writerBoundaryVerdict.reason || ''),
          timestamp_source: String(writerBoundaryVerdict.source || 'unknown'),
          age_ms: Number.isFinite(writerBoundaryVerdict.age_ms) ? writerBoundaryVerdict.age_ms : null,
          threshold_ms: Number.isFinite(writerBoundaryVerdict.threshold_ms) ? writerBoundaryVerdict.threshold_ms : null
        }))
        return sendJson(res, 200, {
          ok: true,
          transport_only: true,
          stored: false,
          held: true,
          reason: String(writerBoundaryVerdict.reason || 'unsafe_immutable_ingress_time')
        })
      }

      const duplicateInbound = getDuplicateInboundVerdict(packet)
      if (duplicateInbound.duplicate) {
        releaseLegacyManyChatPending(legacyManyChatProof)
        legacyManyChatProof = null
        const durability = duplicateInboundDurability(packet, duplicateInbound)
        if (!durability.durable) {
          // Older builds could publish state/history and then crash before the
          // inbox write. A retry must repair that gap, not convert it into a
          // permanent silent duplicate. The repaired packet is fsynced before
          // the 200 response and no second state/history event is appended.
          const repairedFile = writeInboxPacket(packet, { durable: true })
          const inboxKick = kickInboxWorkerIfNeeded(packet, repairedFile)
          recordLearningOutcome(packet, 'inbound_duplicate_durable_work_repaired')
          console.log('===INBOUND_DUPLICATE_DURABLE_WORK_REPAIRED===')
          console.log(JSON.stringify({
            ...redactedInboundIdentity(packet),
            reason: duplicateInbound.reason,
            repair_reason: durability.reason,
            inbox_worker_kicked: inboxKick?.kicked === true
          }))
          return sendJson(res, 200, {
            ok: true,
            transport_only: true,
            stored: true,
            repaired: true,
            duplicate: true,
            reason: 'duplicate_state_without_durable_work_repaired',
            message_id: String(packet.message_id || ''),
            inbox_queued: true,
            inbox_worker_kicked: inboxKick?.kicked === true
          })
        }
        recordLearningOutcome(packet, durability.pending
          ? 'inbound_duplicate_already_pending'
          : 'inbound_duplicate_drop')
        console.log(durability.pending
          ? '===INBOUND_DUPLICATE_ALREADY_PENDING==='
          : '===INBOUND_DUPLICATE_DROP===')
        console.log(JSON.stringify({
          ...redactedInboundIdentity(packet),
          reason: duplicateInbound.reason,
          durable_reason: durability.reason
        }))
        return sendJson(res, 200, {
          ok: true,
          transport_only: true,
          stored: durability.pending === true,
          dropped: durability.terminal === true,
          duplicate: true,
          pending: durability.pending === true,
          reason: duplicateInbound.reason,
          message_id: String(packet.message_id || '')
        })
      }

      // Live 2026-07-28: with /data at 100% the very first persist below threw
      // before anything reached stdout, so the inbound left no trace at all.
      // Check the volume BEFORE touching disk and rotate machine journals if
      // persistence is at risk, so ingress/inbox writes always have room.
      if (diskNeedsEmergencyRelief(ROOT)) {
        console.log('===INBOUND_PRE_PERSIST_DISK_RELIEF===')
        try { emergencyDiskRelief(ROOT) } catch {}
      }

      const suppressed = !!packet.automation_suppressed
      let ingress_control
      let reaction
      let file
      // This provenance is process-local and is passed only after either the
      // shared-secret gate or the provider-backed legacy proof has succeeded.
      // Body fields can never opt into accepted-unverified reconciliation.
      const authenticatedIngressOptions = legacyManyChatProof
        ? {
            authenticated_inbound: true,
            authentication_source: 'provider_verified_legacy_manychat'
          }
        : authorization.required === true
          ? {
              authenticated_inbound: true,
              authentication_source: 'shared_secret'
            }
          : {}

      if (legacyManyChatProof && !suppressed) {
        // The compatibility reservation is committed only after an fsynced,
        // atomically renamed inbox packet exists. A crash before this point
        // leaves a reclaimable pending reservation; a crash after it leaves a
        // durable packet that stale reconciliation can prove.
        file = writeInboxPacket(packet, { durable: true })
        legacyManyChatDurable = true
        const replayCommit = commitReplayLedger(legacyManyChatProof, {
          durableIngressIdentity: path.basename(file)
        })
        if (!replayCommit.ok) throw new Error('legacy_manychat_replay_commit_failed')
        ingress_control = recordIngressEvent(ROOT, packet, authenticatedIngressOptions)
        reaction = ingress_control.accepted_unverified_boundary_pending ||
          ingress_control.accepted_unverified_delivery_publication_pending
          ? { enabled: false, enqueued: false, reason: 'accepted_unverified_boundary_pending' }
          : enqueueReactionJob(packet)
      } else {
        // Every unsuppressed authenticated ingress uses the same crash-safe
        // order as the provider-verified compatibility route: durable work
        // first, dedup-visible state/history second. Publishing conversation
        // state before this fsynced packet can turn a retry into a silent drop.
        if (!suppressed) file = writeInboxPacket(packet, { durable: true })
        ingress_control = recordIngressEvent(ROOT, packet, authenticatedIngressOptions)
        if (legacyManyChatProof) {
          // A deliberately suppressed transport has no inbox by design; its
          // fsynced control-plane state is the durable terminal ingress write.
          legacyManyChatDurable = true
          const replayCommit = commitReplayLedger(legacyManyChatProof, {
            durableIngressIdentity: ingress_control.state_file
          })
          if (!replayCommit.ok) throw new Error('legacy_manychat_replay_commit_failed')
        }
        reaction = ingress_control.accepted_unverified_boundary_pending ||
          ingress_control.accepted_unverified_delivery_publication_pending
          ? { enabled: false, enqueued: false, reason: 'accepted_unverified_boundary_pending' }
          : enqueueReactionJob(packet)
      }
      const thread_state_file = ingress_control.state_file
      const thread_history_file = ingress_control.history_file
      if (suppressed) recordLearningOutcome(packet, 'suppressed')
      const inbox_kick = kickInboxWorkerIfNeeded(packet, file)

      console.log('===INBOUND_TRANSPORT_ONLY===')
      console.log(JSON.stringify({
        ...redactedInboundIdentity(packet),
        packet_sha256: sha256(JSON.stringify(packet)),
        suppressed,
        inbox_queued: Boolean(file)
      }))
      console.log('===INBOUND_ENRICHMENT===')
      console.log(JSON.stringify({
        enabled: enrichment?.enabled === true,
        applied: enrichment?.applied === true,
        reason: String(enrichment?.reason || ''),
        http_status: Number(enrichment?.http_status || 0),
        manychat_tag_count: Array.isArray(enrichment?.manychat_tags) ? enrichment.manychat_tags.length : 0
      }))
      console.log('===INBOUND_REACTION===')
      console.log(JSON.stringify({
        enabled: reaction?.enabled === true,
        enqueued: reaction?.enqueued === true,
        reason: String(reaction?.reason || ''),
        reaction_reason: String(reaction?.reaction_reason || ''),
        reaction_score: Number(reaction?.reaction_score || 0),
        reaction_delay_ms: Number(reaction?.reaction_delay_ms || 0)
      }))
      console.log('===INBOUND_SUPPRESSION===')
      console.log(JSON.stringify({
        suppressed,
        matched_tag: String(packet.automation_suppressed_tag || ''),
        reason: String(packet.automation_suppressed_reason || '')
      }))
      console.log('===INBOX_WORKER_KICK===')
      console.log(JSON.stringify({
        enabled: inbox_kick?.enabled === true,
        kicked: inbox_kick?.kicked === true,
        reason: String(inbox_kick?.reason || ''),
        mode: String(inbox_kick?.mode || '')
      }))

      return sendJson(res, 200, {
        ok: true,
        transport_only: true,
        stored: true,
        suppressed,
        message_id: String(packet.message_id || ''),
        inbox_queued: Boolean(file),
        inbox_worker_kicked: inbox_kick?.kicked === true,
        reaction_queued: reaction?.enqueued === true,
        enriched: enrichment?.attempted === true
      })
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' })
  } catch (err) {
    if (legacyManyChatProof && !legacyManyChatDurable) releaseLegacyManyChatPending(legacyManyChatProof)
    // Live 2026-07-28: this catch used to answer 500 silently — a persist
    // failure during the disk-full outage left no stdout trace and the lost
    // inbounds were undiscoverable. Every handler failure must be loud and
    // carry only stable identity hashes so recovery can correlate the victim.
    console.error('===INBOUND_HANDLER_ERROR===')
    console.error(JSON.stringify({
      method: String(req.method || ''),
      identity_hint: inboundIdentityHint,
      reason: safeLogErrorReason(err)
    }))
    const statusCode = Number(err && err.statusCode) || 500
    const publicError = statusCode < 500 && /^(invalid_json|payload_too_large|request_timeout)$/.test(String(err?.message || ''))
      ? String(err.message)
      : 'internal_error'
    return sendJson(res, statusCode, { ok: false, error: publicError })
  }
})

server.requestTimeout = SCV_INBOUND_REQUEST_TIMEOUT_MS
server.headersTimeout = SCV_INBOUND_HEADERS_TIMEOUT_MS
server.keepAliveTimeout = SCV_INBOUND_KEEP_ALIVE_TIMEOUT_MS
server.maxHeadersCount = 100

if (require.main === module) {
  ensureDirs()
  server.listen(PORT, BIND_HOST)
}

module.exports = {
  pickInboundText,
  statusAgeMs,
  inboundMediaType,
  bodyHasMessageEnvelope,
  looksLikeStandaloneEmojiText,
  normalize,
  buildReadiness,
  readPreflightProof,
  preflightProofVerdict,
  redactedInboundIdentity,
  redactedDeliveryReceipt,
  redactedDriftStatus,
  inboundIdentityVerdict,
  manychatSubscriberInfoUrl,
  manychatSubscriberGetInfo,
  boundedInstagramSuppression,
  inboundWriterHoldThresholdMs,
  holdInboundAtWriterBoundary,
  getDuplicateInboundVerdict,
  duplicateInboundDurability,
  authorizeSharedSecret,
  secretMatches,
  server
}
