#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { getInstagramSuppressionForUsername } = require(path.join(__dirname, 'instagram-thread-suppression.js'))
const { isPausedForPacket, isDebugAccountPacket } = require(path.join(__dirname, 'scv-pause-gate.js'))
const { classifyPendingReplyCertainty } = require(path.join(__dirname, 'scv-reply-certainty-gate.js'))
const {
  immutableIngressTimeMs,
  recoveryCutoverVerdict,
  recoveryQueueSafetyVerdict,
  VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION,
  isVerifiedStaleOperatorRecoveryEnvelope
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))
const {
  recordInboundProcessingReceipt,
  inboundProcessingReceiptHasPacket
} = require(path.join(__dirname, 'scv-manychat-orphan-recovery.js'))
const {
  adoptionPaths,
  readBoundedRegularJson,
  inspectPacketFile,
  inspectMarkerFile,
  idempotencyKeyForPacket,
  ensureMarkerForPacket
} = require(path.join(__dirname, 'scv-durable-outbox-adoption.js'))
const {
  ROUTE_AWARE_VISIBLE_RECOVERY_VERSION
} = require(path.join(__dirname, 'scv-deterministic-recovery.js'))
const {
  coalesceReferenceMediaIntoTarget,
  packetIsReferenceMediaCarrier
} = require(path.join(__dirname, 'scv-media-turn-coalescing.js'))

const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  executeSingleControlTurn,
  assertSingleControlEnvelope,
  readControlState,
  conversationContextPublicationPending,
  recordControlLifecycleEvent
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const { recordConversionSnapshot } = require(path.join(__dirname, 'dm-learning-sidecar.js'))

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

const LIVE_DIR = process.env.SCV_ROOT || __dirname
const INBOX_DIR = path.join(LIVE_DIR, 'inbox')
const INBOX_SUPERSEDED_DIR = path.join(LIVE_DIR, 'inbox_quarantine_superseded')
const INBOX_DEADLETTER_DIR = path.join(LIVE_DIR, 'inbox_quarantine_deadletter')
const INBOX_CORRUPT_DIR = path.join(LIVE_DIR, 'inbox_quarantine_corrupt')
const OUTBOX_HUMAN_AGENT_REQUIRED_DIR = path.join(LIVE_DIR, 'outbox_human_agent_required')
const OUTBOUND1_URL = process.env.SCV_OUTBOUND1_URL || `http://127.0.0.1:${process.env.SCV_OUTBOUND1_PORT || 3101}/`
const { recordLearningOutcome } = require(path.join(__dirname, 'dm-learning-sidecar.js'))
const SCV_FAIL_CLOSED_RECOVERY = String(process.env.SCV_FAIL_CLOSED_RECOVERY || '1').trim() !== '0'
const TRUSTED_RECOVERY_SOURCES = new Set([
  'manychat_subscriber_getinfo',
  'watchdog_orphaned_user_turn'
])

const POLL_MS = 1000
const RETRY_BASE_MS = 15000
const RETRY_MAX_MS = 300000
const UPSTREAM_RETRY_BASE_MS = 2500
const UPSTREAM_RETRY_MAX_MS = 60000
const INTERNAL_OUTBOUND_TIMEOUT_MS = Math.max(
  50,
  Math.min(60000, Number(process.env.SCV_INTERNAL_OUTBOUND_TIMEOUT_MS || 15000))
)
const MAX_INTERNAL_OUTBOUND_RESPONSE_BYTES = Math.max(
  1024,
  Math.min(8 * 1024 * 1024, Number(process.env.SCV_INTERNAL_OUTBOUND_MAX_RESPONSE_BYTES || 1024 * 1024))
)
// Live 2026-07-29 (contact 1955263859): a deterministic verifier ping-pong kept
// one inbound cycling every 5 minutes for 50+ attempts — permanent silence with
// receipts. The same bound now applies to a provider/internal transport outage:
// one final recovery pass is durable and idempotent, then the accepted inbound
// terminates in exactly one loud operator artifact instead of retrying forever.
const parsedInternalRetryableMaxAttempts = Number(
  process.env.SCV_INTERNAL_RETRYABLE_MAX_ATTEMPTS || 12
)
const INTERNAL_RETRYABLE_MAX_ATTEMPTS = Number.isFinite(parsedInternalRetryableMaxAttempts)
  ? Math.max(1, Math.min(100, Math.floor(parsedInternalRetryableMaxAttempts)))
  : 12
// A fully exhausted semantic/verifier cycle is already proof that repeating the
// same frozen route will not create a visible answer. Do not make a client wait
// through the general outage budget (12 cycles). Arm the bounded, route-aware
// visible recovery after the first complete verifier cycle; transport outages
// keep their separate retry budget and exact-delivery reconciliation rules.
const parsedVisibleRecoveryAfterAttempts = Number(
  process.env.SCV_VISIBLE_RECOVERY_AFTER_ATTEMPTS || 1
)
const VISIBLE_RECOVERY_AFTER_ATTEMPTS = Number.isFinite(parsedVisibleRecoveryAfterAttempts)
  ? Math.max(1, Math.min(3, Math.floor(parsedVisibleRecoveryAfterAttempts)))
  : 1
const SAFE_CLARIFICATION_RECOVERY_VERSION =
  'scv-inbox-safe-clarification-recovery-2026-08-25-v2-context-bound'
const BOUNDED_TRANSIENT_RECOVERY_VERSION =
  'scv-inbox-monotonic-final-recovery-2026-08-30-v2'
const FINAL_RECOVERY_PHASE_PRECOMMIT = 'precommit_final_recovery'
const FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK =
  'committed_pre_network_final_replay'
const FINAL_RECOVERY_PHASE_DELIVERY = 'postcommit_delivery_reconciliation'
const INBOX_EXECUTION_STAGE_PRECOMMIT = 'precommit_generation'
const INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK = 'committed_pre_network'
const INBOX_EXECUTION_STAGE_POST3101_ATTEMPT = 'post3101_attempt_started'
const INBOX_EXECUTION_STAGE_POST3101_ACCEPTED = 'post3101_accepted'
const DELIVERY_RECONCILIATION_HOLD_SCHEMA =
  'scv-delivery-reconciliation-hold-2026-08-30-v2-receipt-bound-no-manual-send'
const DELIVERY_RECONCILIATION_MANUAL_SEND_INSTRUCTION =
  'Reconcile the receipt-bound outbox marker and provider delivery receipt before any manual customer send'
const SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION =
  'scv-closed-lifecycle-contract-2026-08-30-v6-monotonic-final-recovery'
const MAX_INBOX_JSON_BYTES = 8 * 1024 * 1024
let inboxHarnessHooks = null

function setInboxHarnessHooks(hooks) {
  if (String(process.env.SCV_INBOX_TEST_HARNESS || '') !== '1') {
    throw new Error('inbox_harness_hooks_not_enabled')
  }
  if (hooks !== null && (typeof hooks !== 'object' || Array.isArray(hooks))) {
    throw new Error('inbox_harness_hooks_invalid')
  }
  inboxHarnessHooks = hooks
}

function invokeInboxHarnessHook(name, context = {}) {
  const hook = inboxHarnessHooks?.[name]
  if (typeof hook === 'function') hook(context)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function ensureDirs() {
  fs.mkdirSync(INBOX_DIR, { recursive: true })
  fs.mkdirSync(INBOX_SUPERSEDED_DIR, { recursive: true })
  fs.mkdirSync(INBOX_DEADLETTER_DIR, { recursive: true })
  fs.mkdirSync(INBOX_CORRUPT_DIR, { recursive: true })
  fs.mkdirSync(OUTBOX_HUMAN_AGENT_REQUIRED_DIR, { recursive: true })
}

function safeReadJson(file) {
  let descriptor
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INBOX_JSON_BYTES) {
      throw new Error('inbox_json_file_invalid')
    }
    const parsed = JSON.parse(fs.readFileSync(descriptor, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('inbox_json_object_required')
    }
    return parsed
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function fsyncDirectory(directory) {
  let descriptor
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY)
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function durableWriteJson(file, obj, { noReplace = false } = {}) {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(8).toString('hex')}.tmp`
  )
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.fchmodSync(descriptor, 0o600)
    fs.writeFileSync(descriptor, JSON.stringify(obj, null, 2) + '\n')
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  try {
    if (noReplace) {
      fs.linkSync(temporary, file)
      fsyncDirectory(directory)
      fs.unlinkSync(temporary)
      fsyncDirectory(directory)
    } else {
      fs.renameSync(temporary, file)
      fsyncDirectory(directory)
    }
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
  return file
}

function safeWriteJson(file, obj) {
  return durableWriteJson(file, obj)
}

function unlinkAndFsync(file) {
  fs.unlinkSync(file)
  fsyncDirectory(path.dirname(file))
}

function nowIso() {
  return new Date().toISOString()
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function identitySha256(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized ? sha256(normalized) : ''
}

function redactedPacketIdentity(packet = {}) {
  return {
    contact_sha256: identitySha256(
      packet.contact_id || packet.subscriber_id || packet.user_id || packet.thread_id
    ),
    username_sha256: identitySha256(
      packet.instagram_username || packet.username
    ),
    message_sha256: identitySha256(packet.message_id)
  }
}

function artifactSha256(file) {
  const basename = String(file || '') ? path.basename(String(file)) : ''
  return basename ? sha256(basename) : ''
}

function objectSha256(value) {
  try { return sha256(JSON.stringify(value ?? null)) } catch { return sha256('unserializable') }
}

function errorLogFields(error) {
  const message = String(error?.message || error || 'unknown_error')
  const code = String(error?.code || error?.name || 'error')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 80) || 'error'
  return { error_code: code, error_sha256: sha256(message) }
}

function parseTime(value, fallback = 0) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeThreadKey(thread_id) {
  return String(thread_id || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function readLatestThreadState(thread_id) {
  try {
    return readControlState(LIVE_DIR, thread_id)
  } catch {
    return null
  }
}

// Username HEURISTICS may not silence an inbound reply (Ben law: everyone who DMs
// gets a reply — "wondercrushstudio" is a real lead whose handle merely contains
// "studio"; the compact heuristic suppressed 28 straight replies live). Explicit
// operator suppressions (ManyChat 'flag' tag, known-shop list) stay authoritative.
const REPLY_LANE_HEURISTIC_TAGS = new Set([
  'tattoo_shop_username_heuristic',
  'tattoo_shop_username_compact_heuristic',
  'tattoo_shop_message_heuristic'
])

async function getAutomationSuppression(msg) {
  const latest = readLatestThreadState(msg.thread_id || msg.contact_id)
  const suppressed = !!(latest?.automation_suppressed || msg?.automation_suppressed)

  if (suppressed) {
    const matchedTag = String(latest?.automation_suppressed_tag || msg?.automation_suppressed_tag || '')
    if (REPLY_LANE_HEURISTIC_TAGS.has(matchedTag)) {
      console.log(JSON.stringify({
        type: 'inbox_worker_heuristic_suppression_bypassed',
        ...redactedPacketIdentity(msg),
        matched_tag_sha256: identitySha256(matchedTag)
      }))
    } else {
      return {
        suppressed,
        matched_tag: matchedTag,
        reason: String(latest?.automation_suppressed_reason || msg?.automation_suppressed_reason || '')
      }
    }
  }

  const instagramSuppression = await getInstagramSuppressionForUsername(
    latest?.instagram_username || msg?.instagram_username,
    { text: msg?.text || '' }
  )
  if (instagramSuppression?.suppressed && instagramSuppression?.heuristic === true) {
    return { suppressed: false, matched_tag: '', reason: `heuristic_bypassed_for_inbound_reply:${instagramSuppression.matched_tag}` }
  }

  return {
    suppressed: !!instagramSuppression?.suppressed,
    matched_tag: String(instagramSuppression?.matched_tag || ''),
    reason: String(instagramSuppression?.reason || '')
  }
}

function quarantineFile(lockOrFile, destinationDir, payload, reasonKey) {
  ensureDirs()
  const base = path.basename(lockOrFile).replace(/\.lock$/, '')
  const dest = path.join(destinationDir, base)

  safeWriteJson(dest, {
    ...payload,
    [reasonKey]: true,
    quarantined_at: nowIso()
  })

  if (fs.existsSync(lockOrFile)) {
    fs.unlinkSync(lockOrFile)
  }

  return dest
}

function isPauseAllowlistedPacket(packet, env = process.env) {
  // The accelerated orphan-lock threshold is destructive recovery behavior,
  // not a routing permission. Only the compiled canonical debug identity may
  // receive it; mutable fast/canary/pause allowlists must never broaden scope.
  return isDebugAccountPacket(packet, env)
}

function inboxContainsMessageId(messageId) {
  const target = String(messageId || '')
  if (!target || !fs.existsSync(INBOX_DIR)) return false
  for (const name of fs.readdirSync(INBOX_DIR).filter((entry) => entry.endsWith('.json') || entry.endsWith('.json.lock'))) {
    try {
      const packet = safeReadJson(path.join(INBOX_DIR, name))
      if (String(packet?.message_id || '') === target) return true
    } catch {}
  }
  return false
}

function staleBacklogHoldThresholdMs(env = process.env) {
  const parsed = Number(env.SCV_HOLD_STALE_BACKLOG_MS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000
}

function staleLockRecoveryThresholdMs(env = process.env) {
  const parsed = Number(env.SCV_STALE_LOCK_RECOVERY_MS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000
}

function debugStaleLockRecoveryThresholdMs(env = process.env) {
  const parsed = Number(env.SCV_DEBUG_STALE_LOCK_RECOVERY_MS)
  return Number.isFinite(parsed) && parsed >= 10_000 ? parsed : 60 * 1000
}

function staleLockRecoveryThresholdForPacket(packet, env = process.env) {
  const regular = staleLockRecoveryThresholdMs(env)
  return isPauseAllowlistedPacket(packet, env)
    ? Math.min(regular, debugStaleLockRecoveryThresholdMs(env))
    : regular
}

function fileAgeMs(file, now = Date.now()) {
  try { return now - fs.statSync(file).mtimeMs } catch { return 0 }
}

function isVerifiedStaleOperatorRecovery(packet, file, now = Date.now()) {
  if (!isVerifiedStaleOperatorRecoveryEnvelope(packet, now)) return false

  const messageId = String(packet?.message_id || '')
  const expectedBase = `${messageId}.json`
  const actualBase = path.basename(String(file || '')).replace(/\.lock$/, '')
  return actualBase === expectedBase
}

function shouldHoldStaleBacklogPacket(packet, file, env = process.env, now = Date.now()) {
  const thresholdMs = staleBacklogHoldThresholdMs(env)
  const certainty = classifyPendingReplyCertainty(packet, { root: LIVE_DIR })
  const verdict = recoveryQueueSafetyVerdict(packet, env, file, now, thresholdMs)
  if (
    verdict.hold &&
    verdict.reason === 'stale_backlog_over_threshold' &&
    isVerifiedStaleOperatorRecovery(packet, file, now)
  ) {
    return {
      ...verdict,
      hold: false,
      reason: 'verified_stale_operator_recovery_admitted',
      operator_recovery_admitted: true,
      certainty
    }
  }
  return { ...verdict, certainty }
}

function holdStaleBacklogForHuman(file, packet, verdict) {
  ensureDirs()
  const base = path.basename(file).replace(/\.lock$/, '')
  const dest = path.join(OUTBOX_HUMAN_AGENT_REQUIRED_DIR, `stale-backlog-hold-${Date.now()}-${base}`)

  safeWriteJson(dest, {
    ...packet,
    type: 'stale_backlog_human_agent_required',
    manual_reason: verdict.reason,
    human_agent_required: true,
    queued_for_human_agent_at: nowIso(),
    held_from_inbox_file: base,
    stale_backlog_age_ms: verdict.age_ms,
    stale_backlog_threshold_ms: verdict.threshold_ms,
    reply_certainty: verdict.certainty
  })

  if (fs.existsSync(file)) {
    unlinkAndFsync(file)
  }

  return dest
}

function packetIdentityMatches(left = {}, right = {}) {
  const leftThread = String(left.thread_id || left.contact_id || '')
  const rightThread = String(right.thread_id || right.contact_id || '')
  return Boolean(
    leftThread && rightThread && leftThread === rightThread &&
    String(left.message_id || '') &&
    String(left.message_id || '') === String(right.message_id || '') &&
    String(left.contact_id || leftThread) === String(right.contact_id || rightThread)
  )
}

function quarantineCorruptInboxFile(file, reason) {
  fs.mkdirSync(INBOX_CORRUPT_DIR, { recursive: true, mode: 0o700 })
  const destination = path.join(
    INBOX_CORRUPT_DIR,
    `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${path.basename(file)}`
  )
  fs.renameSync(file, destination)
  fsyncDirectory(path.dirname(file))
  if (path.dirname(file) !== path.dirname(destination)) fsyncDirectory(path.dirname(destination))
  safeWriteJson(`${destination}.receipt.json`, {
    schema: 'scv-inbox-corrupt-quarantine-2026-08-25-v1',
    source_basename_sha256: sha256(path.basename(file)),
    quarantined_at: nowIso(),
    reason: String(reason || 'invalid_json')
  })
  return destination
}

function recoverStaleInboxLockFile(file, env = process.env, now = Date.now()) {
  if (!file.endsWith('.json.lock')) return null
  const ageMs = fileAgeMs(file, now)

  let packet
  try {
    packet = safeReadJson(file)
  } catch {
    return null
  }

  const original = file.replace(/\.lock$/, '')
  if (fs.existsSync(original)) {
    try {
      const lockStat = fs.lstatSync(file)
      const originalStat = fs.lstatSync(original)
      if (
        lockStat.isFile() && originalStat.isFile() &&
        lockStat.dev === originalStat.dev && lockStat.ino === originalStat.ino
      ) {
        // tryLock uses link+unlink as a no-clobber rename. Both names on the
        // same inode proves the process died before tryLock returned, hence no
        // generation or network send could have started.
        unlinkAndFsync(file)
        return {
          action: 'requeued',
          file,
          dest: original,
          age_ms: ageMs,
          threshold_ms: 0,
          reason: 'no_clobber_lock_adoption_crash_recovered'
        }
      }
    } catch {}
  }

  const thresholdMs = staleLockRecoveryThresholdForPacket(packet, env)
  if (!Number.isFinite(ageMs) || ageMs < thresholdMs) return null

  const holdVerdict = shouldHoldStaleBacklogPacket(packet, file, env, now)
  if (holdVerdict.hold) {
    const dest = holdStaleBacklogForHuman(file, packet, {
      ...holdVerdict,
      reason: `stale_inbox_lock_uncertain:${holdVerdict.reason}`,
      stale_lock_age_ms: ageMs
    })
    return { action: 'human_agent_hold', file, dest, age_ms: ageMs, threshold_ms: thresholdMs, reason: holdVerdict.reason }
  }

  if (fs.existsSync(original)) {
    let originalPacket = null
    try { originalPacket = safeReadJson(original) } catch {}
    if (!originalPacket) {
      const quarantined = quarantineCorruptInboxFile(
        original,
        'stale_lock_collision_invalid_original'
      )
      durableWriteJson(original, {
        ...packet,
        stale_inbox_lock_recovered_at: nowIso(),
        stale_inbox_lock_age_ms: ageMs,
        recovered_from_invalid_original_sha256: artifactSha256(quarantined)
      }, { noReplace: true })
      unlinkAndFsync(file)
      return {
        action: 'requeued',
        file,
        dest: original,
        quarantined,
        age_ms: ageMs,
        threshold_ms: thresholdMs,
        reason: 'invalid_original_quarantined_valid_lock_requeued'
      }
    }
    if (
      packetIdentityMatches(originalPacket, packet) &&
      Number(originalPacket.attempts || 0) >= Number(packet.attempts || 0)
    ) {
      // A fully durable retry file may exist while its predecessor lock remains
      // after a crash between directory fsync and lock unlink. The retry copy is
      // already authoritative and can be kept without duplicating the turn.
      unlinkAndFsync(file)
      return {
        action: 'requeued',
        file,
        dest: original,
        age_ms: ageMs,
        threshold_ms: thresholdMs,
        reason: 'durable_retry_already_materialized'
      }
    }
    const dest = holdStaleBacklogForHuman(file, packet, {
      hold: true,
      reason: 'stale_inbox_lock_collision_original_exists',
      age_ms: ageMs,
      threshold_ms: thresholdMs,
      certainty: holdVerdict.certainty || null
    })
    return { action: 'human_agent_hold', file, dest, age_ms: ageMs, threshold_ms: thresholdMs, reason: 'collision_original_exists' }
  }

  durableWriteJson(original, {
    ...packet,
    stale_inbox_lock_recovered_at: nowIso(),
    stale_inbox_lock_age_ms: ageMs
  }, { noReplace: true })
  unlinkAndFsync(file)
  return { action: 'requeued', file, dest: original, age_ms: ageMs, threshold_ms: thresholdMs, reason: holdVerdict.reason }
}

function sweepStaleInboxLockFiles({ env = process.env, now = Date.now() } = {}) {
  ensureDirs()
  const recovered = []
  for (const name of fs.readdirSync(INBOX_DIR).filter((entry) => entry.endsWith('.json.lock'))) {
    const file = path.join(INBOX_DIR, name)
    const result = recoverStaleInboxLockFile(file, env, now)
    if (result && result.action !== 'paused') recovered.push(result)
  }
  if (recovered.length) {
    console.log(JSON.stringify({
      type: 'inbox_worker_stale_lock_recovery_batch',
      count: recovered.length,
      actions: recovered.reduce((counts, item) => {
        const action = String(item?.action || 'unknown').replace(/[^a-z0-9_-]/gi, '_')
        counts[action] = Number(counts[action] || 0) + 1
        return counts
      }, {})
    }))
  }
  return recovered
}

function recoverAuthoritativeLatestSupersededInboxFiles() {
  ensureDirs()
  const recovered = []

  for (const name of fs.readdirSync(INBOX_SUPERSEDED_DIR).filter((entry) => entry.endsWith('.json'))) {
    const file = path.join(INBOX_SUPERSEDED_DIR, name)
    let packet
    try {
      packet = safeReadJson(file)
    } catch {
      continue
    }

    const threadId = String(packet?.thread_id || packet?.contact_id || '')
    const messageId = String(packet?.message_id || '')
    if (!threadId || !messageId) continue

    const state = readLatestThreadState(threadId)
    const authoritativeMessageId = String(state?.latest_ingress_message_id || '')
    const committedMessageId = String(state?.last_control_message_id || '')
    if (authoritativeMessageId !== messageId || committedMessageId === messageId) continue
    if (inboxContainsMessageId(messageId)) continue

    // A superseded packet may be recovered once when the durable ingress ledger
    // proves it is still the authoritative uncommitted latest turn. If that same
    // packet returns to superseded quarantine, recovering it again can create an
    // unbounded inbox <-> quarantine ABA loop (observed live: 2,971 recoveries in
    // 13 seconds). Stop the churn loudly instead of silently burning the worker,
    // control ledger, and disk. A later authenticated inbound can supersede this
    // hold normally; an operator can also inspect the exact preserved envelope.
    if (String(packet?.authoritative_latest_recovered_at || '').trim()) {
      const base = path.basename(file).replace(/\.lock$/, '')
      const dest = path.join(
        OUTBOX_HUMAN_AGENT_REQUIRED_DIR,
        `authoritative-recovery-repeat-${Date.now()}-${base}`
      )
      safeWriteJson(dest, {
        ...packet,
        type: 'authoritative_latest_recovery_repeat_human_agent_required',
        manual_reason: 'authoritative_latest_recovery_repeat_blocked',
        human_agent_required: true,
        queued_for_human_agent_at: nowIso(),
        held_from_superseded_file: base
      })
      fs.unlinkSync(file)

      try {
        recordControlLifecycleEvent(LIVE_DIR, packet, {
          type: 'control_authoritative_latest_recovery_repeat_blocked',
          reason: 'authoritative_latest_recovery_repeat_blocked',
          source: file,
          destination: dest,
          lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
        })
      } catch {}

      recovered.push({
        action: 'human_agent_hold',
        file,
        dest,
        thread_id: threadId,
        message_id: messageId,
        reason: 'authoritative_latest_recovery_repeat_blocked'
      })
      continue
    }

    const {
      superseded_inbox: _supersededInbox,
      quarantined_at: _quarantinedAt,
      superseded_by_file: _supersededByFile,
      superseded_by_thread: _supersededByThread,
      superseded_by_message_id: _supersededByMessageId,
      retry_after: _retryAfter,
      ...rest
    } = packet
    const recoveredPacket = {
      ...rest,
      authoritative_latest_recovered_at: nowIso(),
      updated_at: nowIso()
    }
    let dest = path.join(INBOX_DIR, path.basename(name).replace(/\.lock$/, ''))
    if (fs.existsSync(dest) || fs.existsSync(`${dest}.lock`)) {
      dest = path.join(INBOX_DIR, `${safeThreadKey(messageId)}-${Date.now()}.json`)
    }
    safeWriteJson(dest, recoveredPacket)
    fs.unlinkSync(file)

    try {
      recordControlLifecycleEvent(LIVE_DIR, recoveredPacket, {
        type: 'control_authoritative_latest_recovered',
        reason: 'authoritative_latest_was_in_superseded_quarantine',
        source: file,
        destination: dest,
        lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
      })
    } catch {}

    recovered.push({
      action: 'requeued',
      file,
      dest,
      thread_id: threadId,
      message_id: messageId
    })
  }

  return recovered
}

function sweepSupersededInboxFiles() {
  ensureDirs()

  const files = fs.readdirSync(INBOX_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(INBOX_DIR, name))

  if (files.length < 2) return []

  const latestByThread = new Map()
  const packets = []

  for (const file of files) {
    let packet
    try {
      packet = safeReadJson(file)
    } catch {
      continue
    }

    const rawThreadId = String(packet.thread_id || packet.contact_id || '')
    const threadId = safeThreadKey(rawThreadId)
    const packetTime = immutableIngressTimeMs(packet, file)

    packets.push({ file, packet, rawThreadId, threadId, packetTime })

    const current = latestByThread.get(threadId)
    if (!current || packetTime > current.packetTime) {
      latestByThread.set(threadId, {
        file,
        packetTime,
        messageId: String(packet.message_id || '')
      })
    }
  }

  // The single control state is the authoritative ingress ledger. A rewritten
  // retry file or touched mtime may not override its latest message id.
  for (const entry of packets) {
    const state = readLatestThreadState(entry.rawThreadId)
    const authoritativeMessageId = String(state?.latest_ingress_message_id || '')
    if (!authoritativeMessageId) continue
    latestByThread.set(entry.threadId, {
      file: '',
      packetTime: parseTime(state?.latest_ingress_at, 0),
      messageId: authoritativeMessageId,
      authoritative: true
    })
  }

  // Preserve an authenticated attachment that is immediately followed by a
  // short selector (for example screenshot -> "I mean this one"). Supersession
  // still removes the older envelope, but its trusted media URL is first bound
  // to the authoritative newest packet. This is same-thread, provider-identity,
  // and time-window locked; arbitrary text or stale history cannot activate it.
  for (const [threadId, latest] of latestByThread.entries()) {
    const targetEntry = packets.find((entry) => (
      entry.threadId === threadId &&
      String(entry.packet?.message_id || '') === String(latest.messageId || '')
    ))
    if (!targetEntry) continue
    const sourceEntries = packets
      .filter((entry) => (
        entry.threadId === threadId &&
        entry.packetTime <= targetEntry.packetTime &&
        String(entry.packet?.message_id || '') !== String(targetEntry.packet?.message_id || '') &&
        packetIsReferenceMediaCarrier(entry.packet)
      ))
      .sort((left, right) => right.packetTime - left.packetTime)
    for (const sourceEntry of sourceEntries) {
      const coalesced = coalesceReferenceMediaIntoTarget(
        sourceEntry.packet,
        targetEntry.packet
      )
      if (!coalesced.adopted) continue
      safeWriteJson(targetEntry.file, coalesced.packet)
      targetEntry.packet = coalesced.packet
      console.log(JSON.stringify({
        type: 'inbox_worker_reference_media_coalesced',
        ...redactedPacketIdentity(targetEntry.packet),
        gap_ms: coalesced.verdict.gap_ms,
        media_url_count: coalesced.verdict.media_urls.length
      }))
      try {
        recordControlLifecycleEvent(LIVE_DIR, targetEntry.packet, {
          type: 'control_reference_media_coalesced',
          reason: coalesced.verdict.reason,
          source_message_id: coalesced.verdict.source_message_id,
          lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
        })
      } catch {}
      break
    }
  }

  const quarantined = []

  for (const entry of packets) {
    const latest = latestByThread.get(entry.threadId)
    if (!latest) continue
    const messageId = String(entry.packet.message_id || '')
    if (
      (latest.messageId && messageId === latest.messageId) ||
      (!latest.messageId && latest.file === entry.file)
    ) continue

    const dest = quarantineFile(
      entry.file,
      INBOX_SUPERSEDED_DIR,
      {
        ...entry.packet,
        superseded_by_file: latest.file,
        superseded_by_thread: entry.threadId,
        superseded_by_message_id: latest.messageId || ''
      },
      'superseded_inbox'
    )

    try {
      recordControlLifecycleEvent(LIVE_DIR, entry.packet, {
        type: 'control_inbound_superseded',
        reason: 'newer_inbound_exists_for_thread',
        destination: dest,
        superseded_by_file: latest.file,
        superseded_by_message_id: latest.messageId || '',
        lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
      })
    } catch {}

    quarantined.push({
      file: entry.file,
      dest,
      thread_id: entry.packet.thread_id || entry.packet.contact_id || '',
      message_id: entry.packet.message_id || '',
      superseded_by_file: latest.file,
      superseded_by_message_id: latest.messageId || ''
    })
  }

  return quarantined
}

function listDueInboxFiles({ env = process.env, now = Date.now() } = {}) {
  ensureDirs()

  // Classify the inbox that existed at the start of this sweep first. A packet
  // recovered from superseded quarantine is already proven by durable state to
  // be the authoritative, uncommitted latest turn. Re-running supersession on
  // that newly recovered packet in the same tick can create an immediate
  // recover -> supersede -> repeat-fuse loop before it ever reaches admission.
  const superseded = sweepSupersededInboxFiles()
  if (superseded.length) {
    console.log(JSON.stringify({
      type: 'inbox_worker_quarantine_superseded_batch',
      count: superseded.length
    }))
  }
  const recoveredLatest = recoverAuthoritativeLatestSupersededInboxFiles()
  if (recoveredLatest.length) {
    console.log(JSON.stringify({
      type: 'inbox_worker_authoritative_latest_recovery_batch',
      count: recoveredLatest.length
    }))
  }
  sweepStaleInboxLockFiles({ env, now })

  return fs.readdirSync(INBOX_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(INBOX_DIR, name))
    .filter((file) => {
      try {
        const obj = safeReadJson(file)
        const holdVerdict = shouldHoldStaleBacklogPacket(obj, file, env, now)
        if (holdVerdict.hold) {
          const dest = holdStaleBacklogForHuman(file, obj, holdVerdict)
          console.log(JSON.stringify({
            type: 'inbox_worker_stale_backlog_human_agent_hold',
            ...redactedPacketIdentity(obj),
            file_sha256: artifactSha256(file),
            destination_sha256: artifactSha256(dest),
            reason: holdVerdict.reason,
            age_ms: holdVerdict.age_ms,
            timestamp_source: holdVerdict.source,
            cutover_ms: holdVerdict.cutover_ms,
            certainty: holdVerdict.certainty?.certain === true,
            certainty_reason: String(holdVerdict.certainty?.reason || '')
          }))
          return false
        }
        // Live-surgery pause: hold non-test inbounds in place (not consumed, not
        // quarantined) — they all get answered via coalesce on unpause.
        if (isPausedForPacket(obj, env)) return false
        const retryAfter = obj.retry_after ? Date.parse(obj.retry_after) : 0
        if (retryAfter && retryAfter > now) return false
        return true
      } catch (err) {
        console.log(JSON.stringify({
          type: 'inbox_worker_admission_fail_closed',
          file_sha256: artifactSha256(file),
          ...errorLogFields(err)
        }))
        return false
      }
    })
    .sort()
}

function lockPath(file) {
  return `${file}.lock`
}

function tryLock(file) {
  const locked = lockPath(file)
  // Hard-link publication gives destination O_EXCL semantics. A crash between
  // link and unlink leaves two names for the same inode, which the startup
  // sweep recognizes as provably pre-processing and repairs immediately.
  fs.linkSync(file, locked)
  fsyncDirectory(path.dirname(file))
  unlinkAndFsync(file)
  return locked
}

function releaseInboxLockForPause(lockFile, msg, stage = 'final_outbound_recheck') {
  const original = lockFile.replace(/\.lock$/, '')
  if (fs.existsSync(original)) {
    return holdStaleBacklogForHuman(lockFile, msg, {
      hold: true,
      reason: 'pause_recheck_lock_collision',
      age_ms: Date.now() - immutableIngressTimeMs(msg, lockFile),
      threshold_ms: staleBacklogHoldThresholdMs(process.env),
      certainty: null,
      pause_stage: stage
    })
  }

  fs.linkSync(lockFile, original)
  fsyncDirectory(path.dirname(original))
  unlinkAndFsync(lockFile)
  console.log(JSON.stringify({
    type: 'inbox_worker_pause_recheck_hold',
    ...redactedPacketIdentity(msg),
    file_sha256: artifactSha256(original),
    stage
  }))
  return original
}

async function readBoundedResponseText(response, maxResponseBytes) {
  const declaredLength = Number(response?.headers?.get?.('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    try {
      await response?.body?.cancel?.('3101_response_too_large')
    } catch {}
    throw new Error(`3101_response_too_large_${maxResponseBytes}`)
  }

  const reader = response?.body?.getReader?.()
  if (!reader) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
      throw new Error(`3101_response_too_large_${maxResponseBytes}`)
    }
    return text
  }

  const decoder = new TextDecoder()
  let text = ''
  let receivedBytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    receivedBytes += Number(value?.byteLength || 0)
    if (receivedBytes > maxResponseBytes) {
      try {
        await reader.cancel('3101_response_too_large')
      } catch {}
      throw new Error(`3101_response_too_large_${maxResponseBytes}`)
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  return text
}

async function post3101(body, options = {}) {
  const timeoutMs = Math.max(
    50,
    Math.min(60000, Number(options.timeoutMs || INTERNAL_OUTBOUND_TIMEOUT_MS))
  )
  const maxResponseBytes = Math.max(
    1024,
    Math.min(8 * 1024 * 1024, Number(options.maxResponseBytes || MAX_INTERNAL_OUTBOUND_RESPONSE_BYTES))
  )
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  let resp
  let text
  try {
    const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch
    resp = await fetchImpl(options.url || OUTBOUND1_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    text = await readBoundedResponseText(resp, maxResponseBytes)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`3101_post_timeout_${timeoutMs}`)
    }
    const existingType = String(error?.message || error || '')
    if (/^3101_/i.test(existingType)) throw error
    const transportCode = String(error?.code || error?.name || 'transport_error')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 80) || 'transport_error'
    throw new Error(`3101_post_transport_error:${transportCode}`)
  } finally {
    clearTimeout(timer)
  }
  let parsed

  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }

  return {
    http_status: resp.status,
    body: parsed
  }
}

function nextRetryDelayMs(attempts, options = {}) {
  const n = Math.max(1, Number(attempts) || 1)
  const baseMs = Math.max(1, Number(options.baseMs || RETRY_BASE_MS))
  const maxMs = Math.max(baseMs, Number(options.maxMs || RETRY_MAX_MS))
  const random = typeof options.randomImpl === 'function' ? options.randomImpl : Math.random
  const exp = Math.min(baseMs * (2 ** (n - 1)), maxMs)
  const jitter = Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * Math.min(5000, Math.ceil(exp * 0.25)))
  return Math.min(exp + jitter, maxMs)
}

function isTransientRunnerError(errorText) {
  const text = String(errorText || '').toLowerCase()
  return (
    text.includes('single_control_upstream_retryable') ||
    text.includes('openai_upstream_transient_exhausted') ||
    (
      text.includes('codex_exec_failed') &&
      (
        text.includes('high demand') ||
        text.includes('reconnecting') ||
        text.includes('temporar') ||
        text.includes('rate limit') ||
        text.includes('overloaded') ||
        text.includes('too many concurrent requests') ||
        text.includes('upstream connect error') ||
        text.includes('connection termination') ||
        text.includes('connection reset') ||
        text.includes('openai_http_500') ||
        text.includes('openai_http_502') ||
        text.includes('openai_http_503') ||
        text.includes('openai_http_504')
      )
    )
  )
}

function retryDelayForError(errorText, attempts, randomImpl = Math.random) {
  if (isTransientRunnerError(errorText)) {
    return nextRetryDelayMs(attempts, {
      baseMs: UPSTREAM_RETRY_BASE_MS,
      maxMs: UPSTREAM_RETRY_MAX_MS,
      randomImpl
    })
  }
  return nextRetryDelayMs(attempts, { randomImpl })
}

function isTransientDeliveryError(errorText) {
  const text = String(errorText || '').toLowerCase()
  return (
    text.includes('fetch failed') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('timeout') ||
    text.includes('networkerror') ||
    text.includes('socket hang up') ||
    text.includes('temporar') ||
    text.includes('3101_post_')
  )
}

function isExplicitPost3101DeliveryError(errorText) {
  return /^3101_post_/i.test(String(errorText || '').trim())
}

function normalizeInboxExecutionStage(value) {
  const stage = String(value || '')
  return [
    INBOX_EXECUTION_STAGE_PRECOMMIT,
    INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK,
    INBOX_EXECUTION_STAGE_POST3101_ATTEMPT,
    INBOX_EXECUTION_STAGE_POST3101_ACCEPTED
  ].includes(stage) ? stage : ''
}

function inboxExecutionStageForFailure(errorInput, msg = {}, errorText = '') {
  const explicit = normalizeInboxExecutionStage(
    errorInput && typeof errorInput === 'object'
      ? errorInput.control_inbox_execution_stage
      : ''
  )
  if (explicit) return explicit
  if (isExplicitPost3101DeliveryError(errorText)) {
    return INBOX_EXECUTION_STAGE_POST3101_ATTEMPT
  }
  const durable = normalizeInboxExecutionStage(msg?.control_inbox_last_failure_stage)
  if (durable) return durable
  return ''
}

function tagInboxExecutionStage(errorInput, stage) {
  const error = errorInput instanceof Error
    ? errorInput
    : new Error(String(errorInput || 'unknown_error'))
  if (!normalizeInboxExecutionStage(error.control_inbox_execution_stage)) {
    error.control_inbox_execution_stage = normalizeInboxExecutionStage(stage) ||
      INBOX_EXECUTION_STAGE_PRECOMMIT
  }
  return error
}

function isPersistentInternalControlError(errorText) {
  const text = String(errorText || '').toLowerCase()
  return (
    text.includes('single_control_internal_retryable:') ||
    text.includes('single_control_candidate_invalid') ||
    text.includes('single_control_immutable_ingress_time_required') ||
    text.includes('single_control_commit_empty_packet_rejected') ||
    text.includes('single_control_envelope_receipt_invalid:') ||
    text.includes('single_control_final_verifier_rejected:') ||
    text.includes('post_filter_adoption_rejected_') ||
    text.includes('codex_runner_invalid_json') ||
    text.includes('codex_runner_invalid_packet') ||
    text.includes('codex_runner_empty_stdout') ||
    text.includes('codex_runner_spawn_error')
  )
}

function isVerifierAdoptionExhaustion(errorText) {
  const text = String(errorText || '').toLowerCase()
  return (
    text.includes('post_filter_adoption_rejected_') ||
    text.includes('single_control_internal_retryable:final_verifier_rejected:') ||
    text.includes('single_control_final_verifier_rejected:') ||
    text.includes('single_control_candidate_invalid')
  )
}

function inboundAllowsSafeClarificationRecovery(msg = {}) {
  const text = String(msg?.text || msg?.message || '').trim()
  return Boolean(
    msg?.live_turn_voice_transcribe_failed === true ||
    msg?.live_turn_voice_context_unresolved === true ||
    String(msg?.live_turn_context_relation || '') === 'unintelligible' ||
    /voice note that could not be understood/i.test(text)
  )
}

function isSingleControlSupersededError(errorText) {
  const text = String(errorText || '')
  return (
    text.includes('single_control_stale_generation_') ||
    text.includes('single_control_nonlatest_inbound_rejected:')
  )
}

function isExplicitNonrecoverableInboxError(errorText) {
  const text = String(errorText || '').toLowerCase()
  return (
    text.includes('missing_contact_id') ||
    text.includes('single_control_ingress_missing_thread_id') ||
    text.includes('single_control_ingress_missing_event_identity') ||
    text.includes('malformed_inbound_identity')
  )
}

function classifyInboxFailureDisposition(errorText) {
  if (isSingleControlSupersededError(errorText)) return 'supersede'
  if (isExplicitNonrecoverableInboxError(errorText)) return 'deadletter'
  // Fail closed on every unclassified execution failure. A future TypeError,
  // provider shape change, or newly introduced controller error may delay a
  // reply, but it may never silently convert a real accepted inbound to a
  // terminal deadletter merely because its string was not pre-enumerated.
  return 'retry'
}

function syntheticRecoveryVerdict(msg, now = Date.now()) {
  const messageId = String(msg?.message_id || '').trim()
  const recoveredVia = String(msg?.recovered_via || '').trim()
  const synthetic = !!(recoveredVia || messageId.startsWith('watchdog-gap-'))
  const operatorRecovery = msg?.operator_recovery === true

  if (!synthetic) {
    return { synthetic: false, accept: true, reason: '' }
  }

  // A recent operator-recovery envelope is already checked at every stale
  // admission boundary. Let that same authority survive the synthetic-source
  // gate only for the compiled canonical debug identity. Without this bridge,
  // a verified exact-target repair is admitted from stale backlog and then
  // silently reclassified as an untrusted synthetic turn moments later.
  if (
    operatorRecovery &&
    isDebugAccountPacket(msg, process.env) &&
    isVerifiedStaleOperatorRecoveryEnvelope(msg, now)
  ) {
    return {
      synthetic: true,
      accept: true,
      reason: 'verified_stale_operator_recovery_exact_debug_identity'
    }
  }

  if (
    operatorRecovery &&
    recoveredVia === 'manychat_subscriber_getinfo' &&
    messageId.startsWith('manychat-orphan-')
  ) {
    return { synthetic: true, accept: true, reason: 'operator_recovery_source' }
  }

  if (SCV_FAIL_CLOSED_RECOVERY) {
    return { synthetic: true, accept: false, reason: 'synthetic_recovery_disabled' }
  }

  if (!TRUSTED_RECOVERY_SOURCES.has(recoveredVia)) {
    return { synthetic: true, accept: false, reason: 'untrusted_recovery_source' }
  }

  if (messageId.startsWith('watchdog-gap-') && recoveredVia !== 'watchdog_orphaned_user_turn') {
    return { synthetic: true, accept: false, reason: 'synthetic_gap_source_mismatch' }
  }

  return { synthetic: true, accept: true, reason: 'trusted_recovery_source' }
}

function exhaustedFailureOperatorArtifactPath(msg, kind) {
  const stableToken = sha256([
    String(msg?.thread_id || msg?.contact_id || ''),
    String(msg?.message_id || ''),
    String(kind || 'persistent_failure')
  ].join('\n')).slice(0, 32)
  return path.join(
    OUTBOX_HUMAN_AGENT_REQUIRED_DIR,
    `visible-recovery-required-${stableToken}.json`
  )
}

function materializeExhaustedFailureOperatorArtifact(lockFile, msg, errorText, attempts, kind) {
  ensureDirs()
  const destination = exhaustedFailureOperatorArtifactPath(msg, kind)
  if (fs.existsSync(destination)) {
    const existing = safeReadJson(destination)
    const reasonPrefix = `${String(kind || 'persistent_failure')}_after_`
    const reasonSuffix = '_attempts'
    const existingReason = String(existing.manual_reason || '')
    const existingAttemptCount = Number(
      existingReason.slice(reasonPrefix.length, -reasonSuffix.length)
    )
    if (
      existing.schema !== 'scv-visible-recovery-operator-artifact-2026-08-25-v1' ||
      existing.type !== 'persistent_failure_visible_recovery_and_human_review_required' ||
      existing.human_agent_required !== true ||
      existing.visible_recovery_required !== true ||
      String(existing.message_id || '') !== String(msg?.message_id || '') ||
      String(existing.thread_id || existing.contact_id || '') !==
        String(msg?.thread_id || msg?.contact_id || '') ||
      !existingReason.startsWith(reasonPrefix) ||
      !existingReason.endsWith(reasonSuffix) ||
      !Number.isInteger(existingAttemptCount) ||
      existingAttemptCount < 1
    ) {
      throw new Error('inbox_visible_recovery_operator_artifact_collision')
    }
    return { file: destination, created: false }
  }
  durableWriteJson(destination, {
    ...msg,
    schema: 'scv-visible-recovery-operator-artifact-2026-08-25-v1',
    type: 'persistent_failure_visible_recovery_and_human_review_required',
    manual_reason: `${String(kind || 'persistent_failure')}_after_${attempts}_attempts`,
    human_agent_required: true,
    visible_recovery_required: true,
    queued_for_human_agent_at: nowIso(),
    held_from_inbox_file: path.basename(lockFile).replace(/\.lock$/, ''),
    attempts,
    last_error: String(errorText || '').slice(0, 400)
  }, { noReplace: true })
  return { file: destination, created: true }
}

function finalRecoveryPhase(msg = {}) {
  if (msg?.control_final_recovery_version !== BOUNDED_TRANSIENT_RECOVERY_VERSION) {
    return ''
  }
  const phase = String(msg?.control_final_recovery_phase || '')
  if ([
    FINAL_RECOVERY_PHASE_PRECOMMIT,
    FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK,
    FINAL_RECOVERY_PHASE_DELIVERY
  ].includes(phase)) {
    return phase
  }
  return 'invalid_final_recovery_phase'
}

function committedDecisionForMessage(msg = {}) {
  const threadId = String(msg?.thread_id || msg?.contact_id || '')
  const messageId = String(msg?.message_id || '')
  if (!threadId || !messageId) {
    return { present: false, reason: 'committed_decision_identity_missing' }
  }
  const state = readLatestThreadState(threadId)
  const decision = state?.last_control_decision
  const receiptSha256 = String(decision?.control_receipt?.receipt_sha256 || '')
  const bubbles = Array.isArray(decision?.packet?.bubbles)
    ? decision.packet.bubbles
    : []
  if (
    String(state?.last_control_message_id || '') !== messageId ||
    String(decision?.thread_id || '') !== threadId ||
    String(decision?.message_id || '') !== messageId ||
    !/^[a-f0-9]{64}$/i.test(receiptSha256) ||
    bubbles.length < 1 ||
    bubbles.some((bubble) => !String(bubble?.text || '').trim())
  ) {
    return { present: false, reason: 'committed_decision_not_present_for_message', state }
  }
  return {
    present: true,
    reason: 'committed_decision_present_for_message',
    state,
    decision,
    receipt_sha256: receiptSha256,
    bubbles
  }
}

function adoptedPacketMatchesCommittedDecision(packet, committed, index) {
  if (!committed?.present) return false
  const expectedBubbles = committed.bubbles.map((bubble) => String(bubble?.text || ''))
  const actualBubbles = (Array.isArray(packet?.bubbles) ? packet.bubbles : [])
    .map((bubble) => String(bubble?.text || ''))
  let idempotencyKey = ''
  try { idempotencyKey = idempotencyKeyForPacket(packet) } catch { return false }
  return (
    idempotencyKey === `${committed.receipt_sha256}-${index}` &&
    String(packet?.control_receipt?.receipt_sha256 || '') === committed.receipt_sha256 &&
    String(packet?.contact_id || '') === String(committed.decision?.contact_id || '') &&
    String(packet?.thread_id || packet?.contact_id || '') ===
      String(committed.decision?.thread_id || '') &&
    String(packet?.source || '') === String(committed.decision?.source || '') &&
    objectSha256(packet?.authority || {}) ===
      objectSha256(committed.decision?.authority || {}) &&
    String(packet?.message_id || '') === String(committed.decision?.message_id || '') &&
    Number(packet?.bubble_index) === index &&
    Number(packet?.bubble_count) === expectedBubbles.length &&
    String(packet?.bubble?.text || '') === expectedBubbles[index] &&
    JSON.stringify(actualBubbles) === JSON.stringify(expectedBubbles)
  )
}

function inspectCommittedOutboxAdoption(committed) {
  if (!committed?.present) {
    return {
      status: 'partial_or_unknown',
      adopted_indices: [],
      missing_indices: [],
      unknown: ['committed_decision_missing']
    }
  }
  const paths = adoptionPaths(LIVE_DIR)
  const adopted = []
  const missing = []
  const unknown = []

  for (let index = 0; index < committed.bubbles.length; index += 1) {
    const key = `${committed.receipt_sha256}-${index}`
    const markerFile = path.join(paths.markers, `${key}.json`)
    const queueFile = path.join(paths.outbox, `${key}.json`)
    const lockFile = `${queueFile}.lock`

    if (fs.existsSync(markerFile)) {
      try {
        const loaded = readBoundedRegularJson(markerFile)
        const expected = loaded.value?.adopted_packet
        const markerVerdict = inspectMarkerFile(
          LIVE_DIR, markerFile, expected, key, { allowLegacy: false }
        )
        if (
          !markerVerdict.valid ||
          !adoptedPacketMatchesCommittedDecision(expected, committed, index)
        ) throw new Error(`marker_binding_invalid:${markerVerdict.reason}`)
        adopted.push(index)
        continue
      } catch (error) {
        unknown.push(`marker_${index}:${String(error?.message || error)}`)
        continue
      }
    }

    const activeArtifacts = [queueFile, lockFile].filter((file) => fs.existsSync(file))
    if (activeArtifacts.length === 0) {
      missing.push(index)
      continue
    }
    if (activeArtifacts.length === 2) {
      try {
        const queueStat = fs.lstatSync(queueFile)
        const lockStat = fs.lstatSync(lockFile)
        if (
          !queueStat.isFile() || !lockStat.isFile() ||
          queueStat.isSymbolicLink() || lockStat.isSymbolicLink() ||
          queueStat.dev !== lockStat.dev || queueStat.ino !== lockStat.ino
        ) throw new Error('distinct_active_artifacts')
        activeArtifacts.splice(1, 1)
      } catch (error) {
        unknown.push(`active_collision_${index}:${String(error?.message || error)}`)
        continue
      }
    }
    try {
      // Pacing metadata is authored by the outbound adopter. Validate the
      // receipt-bound active packet first, then bind its semantic payload to
      // the exact committed controller decision below.
      const packetVerdict = inspectPacketFile(LIVE_DIR, activeArtifacts[0], null)
      if (
        !packetVerdict.valid ||
        !adoptedPacketMatchesCommittedDecision(packetVerdict.value, committed, index)
      ) throw new Error(`active_binding_invalid:${packetVerdict.reason}`)
      invokeInboxHarnessHook('afterActiveAdoptionInspection', {
        file: activeArtifacts[0],
        key,
        queue_file_sha256: packetVerdict.sha256
      })
      // Inspection/reconciliation must never publish or reconstruct a queue.
      // The verified active bytes are sufficient to repair only the durable
      // marker even if the outbox worker concurrently takes, sends, and removes
      // the queue/lock after this inspection.
      let markerRepairError = null
      try {
        ensureMarkerForPacket(
          LIVE_DIR,
          markerFile,
          packetVerdict.value,
          key,
          packetVerdict.sha256,
          {
            beforePublish: () => invokeInboxHarnessHook(
              'beforeMarkerRepairPublish',
              {
                marker_file: markerFile,
                key,
                queue_file_sha256: packetVerdict.sha256
              }
            )
          }
        )
      } catch (error) {
        // Another process may publish the same marker after the initial
        // absence check. Never resolve that race by reconstructing the active
        // queue; the only acceptable winner is the strict receipt-bound marker
        // revalidated below.
        markerRepairError = error
      }
      const repairedMarker = inspectMarkerFile(
        LIVE_DIR,
        markerFile,
        packetVerdict.value,
        key,
        { allowLegacy: false }
      )
      if (
        !repairedMarker.valid ||
        !adoptedPacketMatchesCommittedDecision(
          repairedMarker.value?.adopted_packet,
          committed,
          index
        )
      ) {
        throw new Error([
          'repaired_marker_binding_invalid',
          repairedMarker.reason,
          markerRepairError ? String(markerRepairError?.message || markerRepairError) : ''
        ].filter(Boolean).join(':'))
      }
      adopted.push(index)
    } catch (error) {
      unknown.push(`active_${index}:${String(error?.message || error)}`)
    }
  }

  const total = committed.bubbles.length
  const status = adopted.length === total
    ? 'all_adopted'
    : (missing.length === total && unknown.length === 0
        ? 'none_adopted'
        : 'partial_or_unknown')
  return {
    status,
    receipt_sha256: committed.receipt_sha256,
    bubble_count: total,
    adopted_indices: adopted,
    missing_indices: missing,
    unknown
  }
}

function deliveryFailureAllowsAbsentReplay(errorText) {
  // A complete typed 5xx response from the local 3101 queue writer is a closed
  // request. With no receipt-bound queue/lock/marker, one idempotent replay is
  // safe. A timeout, reset, or generic fetch failure is not absence authority:
  // the server may still publish after the client stopped waiting.
  return /^3101_post_failed_5\d\d$/i.test(String(errorText || '').trim())
}

function deliveryReconciliationArtifactPath(msg) {
  const stableToken = sha256([
    String(msg?.thread_id || msg?.contact_id || ''),
    String(msg?.message_id || ''),
    'delivery_reconciliation_no_blind_resend'
  ].join('\n')).slice(0, 32)
  return path.join(
    OUTBOX_HUMAN_AGENT_REQUIRED_DIR,
    `delivery-reconciliation-required-${stableToken}.json`
  )
}

function existingDeliveryReconciliationHold(msg) {
  const file = deliveryReconciliationArtifactPath(msg)
  if (!fs.existsSync(file)) return null
  const loaded = readBoundedRegularJson(file)
  const value = loaded.value
  const committed = committedDecisionForMessage(msg)
  const expectedReceiptSha256 = String(committed?.receipt_sha256 || '')
  const expectedPacketSha256 = String(
    committed?.decision?.control_receipt?.packet_sha256 || ''
  )
  const artifactReceiptSha256 = String(value?.control_receipt_sha256 || '')
  const artifactPacketSha256 = String(value?.packet_sha256 || '')
  const artifactCommitBindingValid = committed.present
    ? (
        artifactReceiptSha256 === expectedReceiptSha256 &&
        artifactPacketSha256 === expectedPacketSha256
      )
    : (
        (!artifactReceiptSha256 && !artifactPacketSha256) ||
        (
          /^[a-f0-9]{64}$/i.test(artifactReceiptSha256) &&
          /^[a-f0-9]{64}$/i.test(artifactPacketSha256)
        )
      )
  if (
    value?.schema !== DELIVERY_RECONCILIATION_HOLD_SCHEMA ||
    value?.type !== 'delivery_reconciliation_human_action_pending' ||
    value?.human_agent_required !== true ||
    value?.human_action_pending !== true ||
    value?.no_blind_resend !== true ||
    value?.customer_reply_status !== 'unconfirmed' ||
    value?.manual_send_prohibited_until !==
      'outbox_marker_and_provider_receipt_reconciled' ||
    value?.manual_send_instruction !==
      DELIVERY_RECONCILIATION_MANUAL_SEND_INSTRUCTION ||
    String(value?.message_id || '') !== String(msg?.message_id || '') ||
    String(value?.thread_id || value?.contact_id || '') !==
      String(msg?.thread_id || msg?.contact_id || '') ||
    !artifactCommitBindingValid
  ) throw new Error('inbox_delivery_reconciliation_artifact_collision')
  return { file, value }
}

function materializeDeliveryReconciliationHold(lockFile, msg, errorText, attempts, adoption) {
  ensureDirs()
  const committed = committedDecisionForMessage(msg)
  const receiptSha256 = String(
    adoption?.receipt_sha256 || committed?.receipt_sha256 || ''
  )
  const packetSha256 = String(
    committed?.decision?.control_receipt?.packet_sha256 || ''
  )
  const destination = deliveryReconciliationArtifactPath(msg)
  if (fs.existsSync(destination)) {
    const existing = safeReadJson(destination)
    if (
      String(existing.message_id || '') !== String(msg?.message_id || '') ||
      String(existing.thread_id || existing.contact_id || '') !==
        String(msg?.thread_id || msg?.contact_id || '') ||
      String(existing.schema || '') !== DELIVERY_RECONCILIATION_HOLD_SCHEMA ||
      existing.human_agent_required !== true ||
      existing.human_action_pending !== true ||
      existing.no_blind_resend !== true ||
      String(existing.customer_reply_status || '') !== 'unconfirmed' ||
      String(existing.manual_send_prohibited_until || '') !==
        'outbox_marker_and_provider_receipt_reconciled' ||
      String(existing.manual_send_instruction || '') !==
        DELIVERY_RECONCILIATION_MANUAL_SEND_INSTRUCTION ||
      String(existing.control_receipt_sha256 || '') !== receiptSha256 ||
      String(existing.packet_sha256 || '') !== packetSha256
    ) throw new Error('inbox_delivery_reconciliation_artifact_collision')
    return { file: destination, created: false }
  }
  durableWriteJson(destination, {
    schema: DELIVERY_RECONCILIATION_HOLD_SCHEMA,
    type: 'delivery_reconciliation_human_action_pending',
    manual_reason: 'committed_reply_delivery_ambiguous_no_blind_resend',
    human_agent_required: true,
    human_action_pending: true,
    no_blind_resend: true,
    customer_reply_status: 'unconfirmed',
    manual_send_prohibited_until:
      'outbox_marker_and_provider_receipt_reconciled',
    manual_send_instruction: DELIVERY_RECONCILIATION_MANUAL_SEND_INSTRUCTION,
    contact_id: String(msg?.contact_id || msg?.thread_id || ''),
    thread_id: String(msg?.thread_id || msg?.contact_id || ''),
    instagram_username: String(msg?.instagram_username || ''),
    message_id: String(msg?.message_id || ''),
    control_receipt_sha256: receiptSha256,
    packet_sha256: packetSha256,
    adoption_status: String(adoption?.status || 'partial_or_unknown'),
    bubble_count: Number(adoption?.bubble_count || committed?.bubbles?.length || 0),
    adopted_indices: Array.isArray(adoption?.adopted_indices)
      ? adoption.adopted_indices
      : [],
    missing_indices: Array.isArray(adoption?.missing_indices)
      ? adoption.missing_indices
      : [],
    unknown_reason_sha256: (Array.isArray(adoption?.unknown) ? adoption.unknown : [])
      .map((reason) => sha256(reason)),
    last_error_sha256: sha256(String(errorText || 'unknown_error')),
    attempts,
    held_from_inbox_file: path.basename(lockFile).replace(/\.lock$/, ''),
    queued_for_human_agent_at: nowIso(),
    raw_message_included: false,
    secrets_included: false
  }, { noReplace: true })
  return { file: destination, created: true }
}

function terminalizePrecommitFinalFailure(lockFile, msg, errorText, attempts) {
  const operatorAlert = materializeExhaustedFailureOperatorArtifact(
    lockFile,
    msg,
    errorText,
    attempts,
    'precommit_final_failure'
  )
  unlinkAndFsync(lockFile)
  try {
    recordControlLifecycleEvent(LIVE_DIR, msg, {
      type: 'control_inbound_precommit_final_recovery_terminal_operator_alert',
      attempts,
      last_error: String(errorText || 'unknown_error'),
      operator_alert_created: operatorAlert.created === true,
      operator_alert_file_sha256: artifactSha256(operatorAlert.file),
      final_recovery_version: BOUNDED_TRANSIENT_RECOVERY_VERSION,
      final_recovery_phase: FINAL_RECOVERY_PHASE_PRECOMMIT,
      lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
    })
  } catch {}
  console.log(JSON.stringify({
    type: 'inbox_worker_precommit_final_recovery_terminal_operator_alert',
    ...redactedPacketIdentity(msg),
    attempts,
    last_error_sha256: sha256(String(errorText || 'unknown_error')),
    operator_alert_created: operatorAlert.created === true,
    operator_alert_file_sha256: artifactSha256(operatorAlert.file),
    final_recovery_version: BOUNDED_TRANSIENT_RECOVERY_VERSION
  }))
  return {
    terminal: true,
    human_action_pending: true,
    operator_alert_file: operatorAlert.file,
    operator_alert_created: operatorAlert.created === true,
    attempts,
    phase: FINAL_RECOVERY_PHASE_PRECOMMIT
  }
}

function terminalizeCommittedPreNetworkFinalFailure(
  lockFile,
  msg,
  errorText,
  attempts
) {
  const operatorAlert = materializeExhaustedFailureOperatorArtifact(
    lockFile,
    msg,
    errorText,
    attempts,
    'committed_pre_network_final_failure'
  )
  unlinkAndFsync(lockFile)
  try {
    recordControlLifecycleEvent(LIVE_DIR, msg, {
      type: 'control_inbound_committed_pre_network_final_replay_terminal_operator_alert',
      attempts,
      last_error: String(errorText || 'unknown_error'),
      operator_alert_created: operatorAlert.created === true,
      operator_alert_file_sha256: artifactSha256(operatorAlert.file),
      final_recovery_version: BOUNDED_TRANSIENT_RECOVERY_VERSION,
      final_recovery_phase: FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK,
      lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
    })
  } catch {}
  return {
    terminal: true,
    human_action_pending: true,
    operator_alert_file: operatorAlert.file,
    operator_alert_created: operatorAlert.created === true,
    attempts,
    phase: FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK
  }
}

function holdDeliveryForReconciliation(lockFile, msg, errorText, attempts, adoption) {
  const operatorAlert = materializeDeliveryReconciliationHold(
    lockFile,
    msg,
    errorText,
    attempts,
    adoption
  )
  unlinkAndFsync(lockFile)
  try {
    recordControlLifecycleEvent(LIVE_DIR, msg, {
      type: 'control_inbound_delivery_reconciliation_human_action_pending',
      attempts,
      adoption_status: String(adoption?.status || 'partial_or_unknown'),
      adopted_indices: adoption?.adopted_indices || [],
      missing_indices: adoption?.missing_indices || [],
      operator_alert_created: operatorAlert.created === true,
      operator_alert_file_sha256: artifactSha256(operatorAlert.file),
      no_blind_resend: true,
      final_recovery_version: BOUNDED_TRANSIENT_RECOVERY_VERSION,
      final_recovery_phase: FINAL_RECOVERY_PHASE_DELIVERY,
      lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
    })
  } catch {}
  return {
    terminal: true,
    human_action_pending: true,
    no_blind_resend: true,
    operator_alert_file: operatorAlert.file,
    operator_alert_created: operatorAlert.created === true,
    attempts,
    phase: FINAL_RECOVERY_PHASE_DELIVERY,
    adoption_status: String(adoption?.status || 'partial_or_unknown')
  }
}

function finalizeAlreadyAdoptedDelivery(lockFile, msg, attempts, adoption) {
  let processingReceiptRepaired = false
  if (!inboundProcessingReceiptHasPacket(LIVE_DIR, msg)) {
    recordInboundProcessingReceipt(LIVE_DIR, msg, {
      adoption: 'outbound_3101_adoption_reconciled'
    })
    processingReceiptRepaired = true
  }
  if (!inboundProcessingReceiptHasPacket(LIVE_DIR, msg)) {
    throw new Error('inbound_processing_receipt_reconciliation_not_durable')
  }
  unlinkAndFsync(lockFile)
  try {
    recordControlLifecycleEvent(LIVE_DIR, msg, {
      type: 'control_inbound_delivery_adoption_reconciled_terminal',
      attempts,
      adoption_status: 'all_adopted',
      control_receipt_sha256: String(adoption?.receipt_sha256 || ''),
      processing_receipt_repaired: processingReceiptRepaired,
      final_recovery_version: BOUNDED_TRANSIENT_RECOVERY_VERSION,
      lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
    })
  } catch {}
  return {
    terminal: true,
    adopted: true,
    processing_receipt_repaired: processingReceiptRepaired,
    operator_alert_created: false,
    attempts,
    phase: FINAL_RECOVERY_PHASE_DELIVERY
  }
}

function releaseForRetry(lockFile, msg, errorInput) {
  ensureDirs()
  const errorText = errorInput && typeof errorInput === 'object'
    ? String(errorInput.message || errorInput)
    : String(errorInput || '')
  const retryContext = errorInput && typeof errorInput === 'object' &&
    errorInput.control_retry_context && typeof errorInput.control_retry_context === 'object'
    ? errorInput.control_retry_context
    : null
  const original = lockFile.replace(/\.lock$/, '')
  const attempts = Number(msg.attempts || 0) + 1
  const existingDeliveryHold = existingDeliveryReconciliationHold(msg)
  if (existingDeliveryHold) {
    // The durable hold is a terminal lifecycle phase of its own. If a process
    // crashed after fsyncing it but before retiring the inbox lock, a changed
    // error string on restart must not reopen generation or create a second
    // operator action.
    unlinkAndFsync(lockFile)
    return {
      terminal: true,
      human_action_pending: true,
      no_blind_resend: true,
      operator_alert_file: existingDeliveryHold.file,
      operator_alert_created: false,
      attempts,
      phase: FINAL_RECOVERY_PHASE_DELIVERY,
      adoption_status: String(
        existingDeliveryHold.value?.adoption_status || 'partial_or_unknown'
      )
    }
  }
  const phase = finalRecoveryPhase(msg)
  if (
    phase === FINAL_RECOVERY_PHASE_PRECOMMIT &&
    fs.existsSync(exhaustedFailureOperatorArtifactPath(
      msg,
      'precommit_final_failure'
    ))
  ) {
    return terminalizePrecommitFinalFailure(
      lockFile,
      msg,
      errorText,
      attempts
    )
  }
  if (
    phase === FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK &&
    fs.existsSync(exhaustedFailureOperatorArtifactPath(
      msg,
      'committed_pre_network_final_failure'
    ))
  ) {
    return terminalizeCommittedPreNetworkFinalFailure(
      lockFile,
      msg,
      errorText,
      attempts
    )
  }
  const explicitPost3101Delivery = isExplicitPost3101DeliveryError(errorText)
  const failureStage = inboxExecutionStageForFailure(errorInput, msg, errorText)
  const explicitlyCommittedPreNetworkFailure =
    failureStage === INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK
  const post3101Failure = [
    INBOX_EXECUTION_STAGE_POST3101_ATTEMPT,
    INBOX_EXECUTION_STAGE_POST3101_ACCEPTED
  ].includes(failureStage)
  // Generic network wording without a 3101 stage tag is precommit/upstream.
  // This prevents a raw future OpenAI fetch error from being mistaken for an
  // ambiguous customer-delivery attempt. Explicit runner classification wins
  // if an error happens to contain both vocabularies.
  const transientDelivery = post3101Failure
  const transientRunner = !transientDelivery && (
    isTransientRunnerError(errorText) ||
    (!explicitPost3101Delivery && isTransientDeliveryError(errorText))
  )
  const persistentInternal = isPersistentInternalControlError(errorText)
  const persistentUnclassified = !persistentInternal && !transientRunner && !transientDelivery
  const failureCapReached = attempts >= INTERNAL_RETRYABLE_MAX_ATTEMPTS
  const verifierCycleExhausted = Boolean(
    persistentInternal &&
    isVerifierAdoptionExhaustion(errorText) &&
    attempts >= VISIBLE_RECOVERY_AFTER_ATTEMPTS
  )
  const committed = committedDecisionForMessage(msg)
  // executeSingleControlTurn can durably commit the state/decision and then
  // fail while publishing its receipt-bound artifact or audit, before it
  // returns to processLockedFile. That exception is tagged precommit at the
  // call boundary, but the durable committed decision is stronger evidence:
  // promote it to exact committed pre-network replay, never fresh generation
  // or ambiguous-delivery handling.
  const committedPreNetworkFailure = Boolean(
    committed.present &&
    !post3101Failure &&
    (
      explicitlyCommittedPreNetworkFailure ||
      failureStage === INBOX_EXECUTION_STAGE_PRECOMMIT
    )
  )
  const durableFailureStage = committedPreNetworkFailure
    ? INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK
    : failureStage
  let adoption = null

  if (
    post3101Failure &&
    !committed.present &&
    !phase
  ) {
    // A 3101-class failure is post-commit by definition. If the exact committed
    // receipt/payload is unavailable, fresh generation could create a second
    // semantic reply and mutate the booking funnel, so fail closed without a
    // blind resend.
    return holdDeliveryForReconciliation(
      lockFile,
      msg,
      errorText,
      attempts,
      {
        status: 'partial_or_unknown',
        adopted_indices: [],
        missing_indices: [],
        unknown: [committed.reason || 'committed_delivery_decision_missing']
      }
    )
  }

  if (committed.present) {
    adoption = inspectCommittedOutboxAdoption(committed)
    if (adoption.status === 'all_adopted') {
      return finalizeAlreadyAdoptedDelivery(lockFile, msg, attempts, adoption)
    }
    if (adoption.status === 'partial_or_unknown') {
      return holdDeliveryForReconciliation(
        lockFile,
        msg,
        errorText,
        attempts,
        adoption
      )
    }
    if (
      phase === FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK &&
      !post3101Failure
    ) {
      return terminalizeCommittedPreNetworkFinalFailure(
        lockFile,
        msg,
        errorText,
        attempts
      )
    }
    if (
      phase === FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK &&
      post3101Failure
    ) {
      // The one exact committed pre-network replay has already been consumed.
      // Once that pass reaches 3101, any failure belongs to the delivery
      // boundary and must not earn another replay merely by changing stage.
      return holdDeliveryForReconciliation(
        lockFile,
        msg,
        errorText,
        attempts,
        adoption
      )
    }
    if (
      !committedPreNetworkFailure &&
      adoption.status === 'none_adopted' &&
      !deliveryFailureAllowsAbsentReplay(errorText)
    ) {
      adoption = {
        ...adoption,
        status: 'partial_or_unknown',
        unknown: ['ambiguous_transport_absence_is_not_nonadoption_authority']
      }
      return holdDeliveryForReconciliation(
        lockFile,
        msg,
        errorText,
        attempts,
        adoption
      )
    }
    if (phase === FINAL_RECOVERY_PHASE_DELIVERY) {
      return holdDeliveryForReconciliation(
        lockFile,
        msg,
        errorText,
        attempts,
        adoption
      )
    }
    if (phase === 'invalid_final_recovery_phase') {
      return holdDeliveryForReconciliation(
        lockFile,
        msg,
        errorText,
        attempts,
        {
          ...adoption,
          status: 'partial_or_unknown',
          unknown: [...(adoption.unknown || []), phase]
        }
      )
    }
  } else if (phase === FINAL_RECOVERY_PHASE_PRECOMMIT) {
    return terminalizePrecommitFinalFailure(lockFile, msg, errorText, attempts)
  } else if (phase === FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK) {
    return terminalizeCommittedPreNetworkFinalFailure(
      lockFile,
      msg,
      errorText,
      attempts
    )
  } else if (phase) {
    return holdDeliveryForReconciliation(
      lockFile,
      msg,
      errorText,
      attempts,
      {
        status: 'partial_or_unknown',
        adopted_indices: [],
        missing_indices: [],
        unknown: [committed.reason || phase]
      }
    )
  }

  const armCommittedPreNetworkRecovery = Boolean(
    committed.present &&
    committedPreNetworkFailure &&
    phase !== FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK &&
    phase !== FINAL_RECOVERY_PHASE_DELIVERY &&
    (phase === FINAL_RECOVERY_PHASE_PRECOMMIT || failureCapReached)
  )
  const armDeliveryRecovery = Boolean(
    committed.present &&
    post3101Failure &&
    phase !== FINAL_RECOVERY_PHASE_DELIVERY &&
    (
      phase === FINAL_RECOVERY_PHASE_PRECOMMIT ||
      phase === FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK ||
      failureCapReached
    )
  )
  const armPrecommitRecovery = Boolean(
    !committed.present && !phase && (failureCapReached || verifierCycleExhausted)
  )
  const forceSafeClarificationRecovery = Boolean(
    armPrecommitRecovery &&
    persistentInternal &&
    isVerifierAdoptionExhaustion(errorText) &&
    inboundAllowsSafeClarificationRecovery(msg)
  )
  const forceRouteAwareVisibleRecovery = Boolean(
    armPrecommitRecovery &&
    !forceSafeClarificationRecovery
  )
  const delayMs = retryDelayForError(errorText, attempts)

  const retryObj = {
    ...msg,
    attempts,
    last_error: String(errorText || 'unknown_error'),
    control_inbox_last_failure_stage: durableFailureStage,
    last_error_kind: persistentInternal || persistentUnclassified
      ? (persistentInternal ? 'persistent_internal_control' : 'persistent_unclassified_fail_closed')
      : (transientRunner
          ? 'transient_upstream'
          : (transientDelivery ? 'transient_delivery' : 'non_transient')),
    retry_after: new Date(Date.now() + (
      forceSafeClarificationRecovery || forceRouteAwareVisibleRecovery ||
        armCommittedPreNetworkRecovery || armDeliveryRecovery ? 0 : delayMs
    )).toISOString(),
    updated_at: nowIso()
  }
  if (forceSafeClarificationRecovery) {
    retryObj.control_force_safe_clarification_recovery = true
    retryObj.control_safe_clarification_recovery_version = SAFE_CLARIFICATION_RECOVERY_VERSION
    retryObj.control_safe_clarification_recovery_after_attempts = attempts
    retryObj.control_safe_clarification_recovery_reason = 'verifier_or_adoption_exhausted'
  }
  if (forceRouteAwareVisibleRecovery) {
    retryObj.control_force_route_aware_visible_recovery = true
    retryObj.control_route_aware_visible_recovery_version = ROUTE_AWARE_VISIBLE_RECOVERY_VERSION
    retryObj.control_route_aware_visible_recovery_after_attempts = attempts
    retryObj.control_route_aware_visible_recovery_reason = transientRunner
      ? 'transient_upstream_exhausted'
      : (persistentUnclassified
          ? 'unclassified_failure_exhausted'
          : 'persistent_failure_exhausted')
  }
  if (
    armPrecommitRecovery ||
    armCommittedPreNetworkRecovery ||
    armDeliveryRecovery
  ) {
    retryObj.control_final_recovery_version = BOUNDED_TRANSIENT_RECOVERY_VERSION
    retryObj.control_final_recovery_phase = armDeliveryRecovery
      ? FINAL_RECOVERY_PHASE_DELIVERY
      : (armCommittedPreNetworkRecovery
          ? FINAL_RECOVERY_PHASE_COMMITTED_PRENETWORK
          : FINAL_RECOVERY_PHASE_PRECOMMIT)
    retryObj.control_final_recovery_armed_after_attempts = attempts
  }
  if (armCommittedPreNetworkRecovery || armDeliveryRecovery) {
    // Both committed recovery phases are receipt replay only. Stale precommit
    // flags must not authorize fresh generation if the durable decision later
    // goes missing.
    delete retryObj.control_force_safe_clarification_recovery
    delete retryObj.control_safe_clarification_recovery_version
    delete retryObj.control_safe_clarification_recovery_after_attempts
    delete retryObj.control_safe_clarification_recovery_reason
    delete retryObj.control_force_route_aware_visible_recovery
    delete retryObj.control_route_aware_visible_recovery_version
    delete retryObj.control_route_aware_visible_recovery_after_attempts
    delete retryObj.control_route_aware_visible_recovery_reason
  }
  if (retryContext) {
    retryObj.control_repair_loop_version = String(retryContext.version || '')
    retryObj.control_repair_cycle = Math.max(
      Number(msg.control_repair_cycle || 0),
      Number(retryContext.retry_cycle || 0)
    )
    retryObj.control_repair_required_action = String(retryContext.required_action || '')
    retryObj.control_repair_route_reason = String(retryContext.route_reason || '')
    retryObj.control_repair_ledger = Array.isArray(retryContext.rejection_ledger)
      ? retryContext.rejection_ledger.slice(-12)
      : (Array.isArray(msg.control_repair_ledger) ? msg.control_repair_ledger.slice(-12) : [])
  }

  durableWriteJson(original, retryObj, { noReplace: true })
  unlinkAndFsync(lockFile)
  try {
    recordControlLifecycleEvent(LIVE_DIR, msg, {
      type: forceSafeClarificationRecovery
        ? 'control_inbound_safe_clarification_recovery_required'
        : armDeliveryRecovery
          ? 'control_inbound_delivery_final_reconciliation_required'
          : armCommittedPreNetworkRecovery
            ? 'control_inbound_committed_pre_network_final_replay_required'
          : forceRouteAwareVisibleRecovery
          ? 'control_inbound_route_aware_visible_recovery_required'
          : 'control_inbound_retry_scheduled',
      attempts,
      retry_after: retryObj.retry_after,
      last_error_kind: retryObj.last_error_kind,
      last_error: retryObj.last_error,
      control_repair_cycle: Number(retryObj.control_repair_cycle || 0),
      control_repair_ledger_count: Array.isArray(retryObj.control_repair_ledger)
        ? retryObj.control_repair_ledger.length
        : 0,
      final_recovery_phase: String(retryObj.control_final_recovery_phase || ''),
      failure_stage: durableFailureStage,
      final_recovery_armed: armPrecommitRecovery ||
        armCommittedPreNetworkRecovery || armDeliveryRecovery,
      operator_alert_created: false,
      lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
    })
  } catch {}

  console.log(JSON.stringify({
    type: forceSafeClarificationRecovery
      ? 'inbox_worker_safe_clarification_recovery_required'
      : armDeliveryRecovery
        ? 'inbox_worker_delivery_final_reconciliation_required'
        : armCommittedPreNetworkRecovery
          ? 'inbox_worker_committed_pre_network_final_replay_required'
        : forceRouteAwareVisibleRecovery
        ? 'inbox_worker_route_aware_visible_recovery_required'
        : 'inbox_worker_requeued',
    ...redactedPacketIdentity(msg),
    file_sha256: artifactSha256(original),
    attempts,
    retry_after: retryObj.retry_after,
    last_error_sha256: sha256(retryObj.last_error),
    last_error_kind: retryObj.last_error_kind,
    failure_stage: durableFailureStage,
    final_recovery_phase: String(retryObj.control_final_recovery_phase || ''),
    final_recovery_armed: armPrecommitRecovery ||
      armCommittedPreNetworkRecovery || armDeliveryRecovery,
    operator_alert_created: false,
    control_repair_cycle: Number(retryObj.control_repair_cycle || 0),
    control_repair_ledger_count: Array.isArray(retryObj.control_repair_ledger)
      ? retryObj.control_repair_ledger.length
      : 0
  }))
  return {
    terminal: false,
    requeued: true,
    attempts,
    phase: String(retryObj.control_final_recovery_phase || ''),
    committed_decision_present: committed.present === true
  }
}

function moveToDeadletter(lockFile, msg, errorText) {
  const dest = quarantineFile(
    lockFile,
    INBOX_DEADLETTER_DIR,
    {
      ...msg,
      attempts: Number(msg.attempts || 0) + 1,
      last_error: String(errorText || 'unknown_error'),
      deadletter_reason: 'max_retries_exceeded_or_nonrecoverable'
    },
    'deadletter_inbox'
  )

  console.log(JSON.stringify({
    type: 'inbox_worker_deadletter',
    ...redactedPacketIdentity(msg),
    file_sha256: artifactSha256(lockFile),
    destination_sha256: artifactSha256(dest),
    attempts: Number(msg.attempts || 0) + 1,
    last_error_sha256: sha256(String(errorText || 'unknown_error'))
  }))
}

function assertSingleAuthorPacket(result) {
  assertSingleControlEnvelope(result, { root: LIVE_DIR, requireLedger: true })
  if (result.source !== SCV_SINGLE_CONTROL_SOURCE) throw new Error('single_control_source_not_locked')
  if (result.authority?.controller !== SCV_SINGLE_CONTROL_PLANE_ID) throw new Error('single_control_controller_not_locked')
}

async function processLockedFile(lockFile) {
  let executionStage = INBOX_EXECUTION_STAGE_PRECOMMIT
  try {
  const msg = safeReadJson(lockFile)
  const suppression = await getAutomationSuppression(msg)

  console.log(JSON.stringify({
    type: 'inbox_worker_pick',
    ...redactedPacketIdentity(msg),
    file_sha256: artifactSha256(lockFile),
    reason: 'locked_for_processing'
  }))

  if (suppression.suppressed) {
    const dest = quarantineFile(
      lockFile,
      INBOX_SUPERSEDED_DIR,
      {
        ...msg,
        suppressed_tag: suppression.matched_tag,
        suppressed_reason: suppression.reason
      },
      'suppressed_inbox'
    )

    console.log(JSON.stringify({
      type: 'inbox_worker_skip_suppressed',
      ...redactedPacketIdentity(msg),
      file_sha256: artifactSha256(lockFile),
      destination_sha256: artifactSha256(dest),
      matched_tag_sha256: identitySha256(suppression.matched_tag),
      reason: 'automation_suppressed'
    }))
    return
  }

  if (conversationContextPublicationPending(LIVE_DIR, String(msg?.thread_id || msg?.contact_id || ''))) {
    throw new Error('single_control_conversation_context_publication_pending')
  }

  const syntheticRecovery = syntheticRecoveryVerdict(msg)
  if (syntheticRecovery.synthetic && !syntheticRecovery.accept) {
    recordLearningOutcome(msg, 'synthetic_drop')
    const dest = quarantineFile(
      lockFile,
      INBOX_SUPERSEDED_DIR,
      {
        ...msg,
        synthetic_inbox: true
      },
      'synthetic_inbox'
    )

    console.log(JSON.stringify({
      type: 'inbox_worker_skip_synthetic',
      ...redactedPacketIdentity(msg),
      file_sha256: artifactSha256(lockFile),
      destination_sha256: artifactSha256(dest),
      reason: syntheticRecovery.reason
    }))
    return
  }

  const controlResult = executeSingleControlTurn(msg, { root: LIVE_DIR })
  executionStage = INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK
  assertSingleAuthorPacket(controlResult)
  const { source, authority, packet, raw_text, structured_state, control_receipt, control_state_file } = controlResult
  const authority_state_file = control_state_file
  invokeInboxHarnessHook('beforeCommittedPreNetworkLocalWork', {
    lockFile,
    message_id: String(msg?.message_id || ''),
    control_receipt_sha256: String(control_receipt?.receipt_sha256 || '')
  })
  const conversion = recordConversionSnapshot(msg, structured_state, packet)

  console.log(JSON.stringify({
    type: 'inbox_worker_packet',
    ...redactedPacketIdentity(msg),
    source: String(source || ''),
    controller: String(authority?.controller || ''),
    file_sha256: artifactSha256(lockFile),
    recent_history_count: Array.isArray(authority?.recent_history) ? authority.recent_history.length : undefined,
    raw_text_sha256: sha256(raw_text),
    structured_state_sha256: objectSha256(structured_state),
    authority_state_file_sha256: artifactSha256(authority_state_file),
    conversion_sha256: objectSha256(conversion),
    packet_sha256: objectSha256(packet),
    bubble_count: Array.isArray(packet?.bubbles) ? packet.bubbles.length : 0
  }))

  // Generation can take long enough for a cutover, stale threshold, or operator
  // pause to change. Re-evaluate both gates at the last point before creating
  // outbound work; preserve the locked inbound instead of consuming it.
  const finalRecoveryVerdict = shouldHoldStaleBacklogPacket(msg, lockFile, process.env, Date.now())
  if (finalRecoveryVerdict.hold) {
    const dest = holdStaleBacklogForHuman(lockFile, msg, finalRecoveryVerdict)
    console.log(JSON.stringify({
      type: 'inbox_worker_final_recovery_human_agent_hold',
      ...redactedPacketIdentity(msg),
      file_sha256: artifactSha256(lockFile),
      destination_sha256: artifactSha256(dest),
      reason: finalRecoveryVerdict.reason,
      timestamp_source: finalRecoveryVerdict.source
    }))
    return
  }

  if (isPausedForPacket(msg, process.env)) {
    releaseInboxLockForPause(lockFile, msg)
    return
  }

  executionStage = INBOX_EXECUTION_STAGE_POST3101_ATTEMPT
  const result = await post3101({
    source,
    authority,
    control_receipt,
    raw_text,
    allow_duplicate_url_resend: !!packet.allow_duplicate_url_resend,
    force_send_urls: Array.isArray(packet.force_send_urls) ? packet.force_send_urls : [],
    authority_transport_flags: packet.authority_transport_flags && typeof packet.authority_transport_flags === 'object'
      ? packet.authority_transport_flags
      : undefined,
    operator_recovery: msg.operator_recovery === true,
    operator_recovery_lock_version: String(msg.operator_recovery_lock_version || ''),
    operator_recovery_reason: String(msg.operator_recovery_reason || ''),
    operator_recovery_at: String(msg.operator_recovery_at || ''),
    recovered_from_message_id: String(msg.recovered_from_message_id || ''),
    recovered_via: String(msg.recovered_via || ''),
    source_interaction_at: String(msg.source_interaction_at || ''),
    recovered_from_ig_last_interaction: String(msg.recovered_from_ig_last_interaction || ''),
    manychat_latest_interaction_at: String(msg.manychat_latest_interaction_at || ''),
    recovered_from_at: String(msg.recovered_from_at || ''),
    received_at: String(msg.received_at || ''),
    at: String(msg.at || ''),
    created_at: String(msg.created_at || ''),
    contact_id: String(msg.contact_id || ''),
    thread_id: String(msg.thread_id || msg.contact_id || ''),
    instagram_username: String(msg.instagram_username || ''),
    message_id: String(msg.message_id || Date.now()),
    text: String(msg.text || ''),
    bubbles: Array.isArray(packet.bubbles) ? packet.bubbles : []
  })

  console.log(JSON.stringify({
    type: 'inbox_worker_3101_result',
    ...redactedPacketIdentity(msg),
    source: String(source || ''),
    controller: String(authority?.controller || ''),
    file_sha256: artifactSha256(lockFile),
    http_status: Number(result?.http_status || 0),
    accepted: Boolean(result?.body?.ok),
    result_sha256: objectSha256(result)
  }))

  if (!(result.http_status >= 200 && result.http_status < 300 && result.body && result.body.ok)) {
    throw new Error(`3101_post_failed_${result.http_status}`)
  }

  executionStage = INBOX_EXECUTION_STAGE_POST3101_ACCEPTED
  const processing_receipt = recordInboundProcessingReceipt(LIVE_DIR, msg, {
    adoption: 'outbound_3101_accepted'
  })

  unlinkAndFsync(lockFile)

  console.log(JSON.stringify({
    type: 'inbox_worker_done',
    ok: true,
    ...redactedPacketIdentity(msg),
    source: String(source || ''),
    controller: String(authority?.controller || ''),
    file_sha256: artifactSha256(lockFile),
    processing_receipt_sha256: objectSha256(processing_receipt)
  }))
  } catch (error) {
    throw tagInboxExecutionStage(error, executionStage)
  }
}

async function loop() {
  ensureDirs()

  while (true) {
    try {
      const files = listDueInboxFiles()

      if (!files.length) {
        await sleep(POLL_MS)
        continue
      }

      const file = files[0]
      let locked

      try {
        locked = tryLock(file)
      } catch {
        await sleep(POLL_MS)
        continue
      }

      try {
        await processLockedFile(locked)
      } catch (err) {
        let msg = null
        try {
          msg = safeReadJson(locked)
        } catch {}

        console.log(JSON.stringify({
          type: 'inbox_worker_error',
          file_sha256: artifactSha256(locked),
          ...errorLogFields(err)
        }))

        try {
          if (!msg) {
            throw new Error('failed_to_read_locked_inbox_after_error')
          }

          const disposition = classifyInboxFailureDisposition(err.message)
          if (disposition === 'supersede') {
            const dest = quarantineFile(locked, INBOX_SUPERSEDED_DIR, msg, 'single_control_superseded')
            try {
              recordControlLifecycleEvent(LIVE_DIR, msg, {
                type: 'control_inbound_superseded',
                reason: String(err.message || ''),
                destination: dest,
                lifecycle_contract_version: SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION
              })
            } catch {}
            console.log(JSON.stringify({
              type: 'inbox_worker_single_control_superseded',
              ...redactedPacketIdentity(msg),
              file_sha256: artifactSha256(locked),
              destination_sha256: artifactSha256(dest),
              error_sha256: sha256(String(err.message || '')),
              reason: 'single_control_superseded'
            }))
          } else if (disposition === 'deadletter') {
            moveToDeadletter(locked, msg, err.message)
          } else {
            // Internal generation / verifier failures use their existing recovery
            // law. Transient executor/queue failures get one bounded final pass;
            // a repeated same-kind failure terminates in one durable operator
            // artifact rather than an infinite retry or silent deadletter.
            releaseForRetry(locked, msg, err)
          }
        } catch (requeueErr) {
          console.log(JSON.stringify({
            type: 'inbox_worker_requeue_error',
            file_sha256: artifactSha256(locked),
            ...errorLogFields(requeueErr)
          }))
        }
      }
    } catch {
      await sleep(POLL_MS)
    }
  }
}

if (require.main === module) {
  loop()
}

module.exports = {
  SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION,
  BOUNDED_TRANSIENT_RECOVERY_VERSION,
  redactedPacketIdentity,
  artifactSha256,
  objectSha256,
  errorLogFields,
  listDueInboxFiles,
  shouldHoldStaleBacklogPacket,
  holdStaleBacklogForHuman,
  isPauseAllowlistedPacket,
  staleBacklogHoldThresholdMs,
  staleLockRecoveryThresholdMs,
  debugStaleLockRecoveryThresholdMs,
  staleLockRecoveryThresholdForPacket,
  isVerifiedStaleOperatorRecovery,
  recoverStaleInboxLockFile,
  sweepStaleInboxLockFiles,
  immutableIngressTimeMs,
  recoveryCutoverVerdict,
  releaseInboxLockForPause,
  recoverAuthoritativeLatestSupersededInboxFiles,
  sweepSupersededInboxFiles,
  isPersistentInternalControlError,
  isVerifierAdoptionExhaustion,
  inboundAllowsSafeClarificationRecovery,
  isExplicitNonrecoverableInboxError,
  isSingleControlSupersededError,
  classifyInboxFailureDisposition,
  nextRetryDelayMs,
  retryDelayForError,
  isTransientRunnerError,
  isTransientDeliveryError,
  isExplicitPost3101DeliveryError,
  setInboxHarnessHooks,
  processLockedFile,
  inspectCommittedOutboxAdoption,
  INBOX_EXECUTION_STAGE_PRECOMMIT,
  INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK,
  INBOX_EXECUTION_STAGE_POST3101_ATTEMPT,
  INBOX_EXECUTION_STAGE_POST3101_ACCEPTED,
  post3101,
  durableWriteJson,
  packetIdentityMatches,
  syntheticRecoveryVerdict,
  releaseForRetry,
  loop
}
