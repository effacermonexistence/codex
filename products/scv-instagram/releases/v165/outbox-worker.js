#!/usr/bin/env node
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const { getInstagramSuppressionForUsername } = require(path.join(__dirname, 'instagram-thread-suppression.js'))
const { isPausedForPacket } = require(path.join(__dirname, 'scv-pause-gate.js'))
const {
  immutableIngressTimeMs,
  recoveryCutoverVerdict,
  recoveryQueueSafetyVerdict,
  isVerifiedStaleOperatorRecoveryEnvelope
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))
const { recordLearningOutcome } = require(path.join(__dirname, 'dm-learning-sidecar.js'))
const {
  evaluateScvOutboundBubbleHarness,
  SCV_CONTRACT_HARNESS_LOCK_VERSION
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  loadCleanThreadState,
  loadCleanThreadHistory
} = require(path.join(__dirname, 'scv-state-quarantine.js'))
const {
  SCV_DELIVERY_PACING_LOCK_VERSION,
  evaluateInitialDelayHardGate,
  requiredDueAtMsForPacket
} = require(path.join(__dirname, 'scv-delivery-pacing.js'))
const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  validateControlReceipt,
  appendControlHistoryEvent,
  appendAcceptedUnverifiedDeliveryEvidence,
  appendConfirmedDeliveryEvidence,
  beginAcceptedUnverifiedDeliveryPublication,
  clearAcceptedUnverifiedDeliveryPublication,
  recoverPreNetworkDeliveryPublication,
  repairTransportPacketFromDecisionArtifact
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  VISIBILITY_STATES,
  classifyVisibilityState,
  recordDeliveryVisibility
} = require(path.join(__dirname, 'scv-delivery-visibility.js'))
const {
  adoptionPaths,
  durableCreateJson,
  packetAdoptionSha256,
  idempotencyKeyForPacket,
  markerValue,
  inspectPacketFile,
  inspectMarkerFile,
  ensureMarkerForPacket,
  recoverCorruptLockFromMarker,
  holdCorruptLockForHuman
} = require(path.join(__dirname, 'scv-durable-outbox-adoption.js'))
const {
  redactedIdentity,
  artifactSha256,
  textMetrics,
  errorMetrics,
  safeEnum
} = require(path.join(__dirname, 'scv-machine-log.js'))
const {
  NAMESPACE_ROOT_DIR,
  runtimeNamespaceFromEnv,
  namespacedPersistRoot,
  pathInside
} = require(path.join(__dirname, 'scv-runtime-namespace.js'))

const ROOT = process.env.SCV_ROOT || __dirname
const OUTBOX_DIR = path.join(ROOT, 'outbox')
const THREAD_STATE_DIR = path.join(ROOT, 'thread-state')
const THREAD_HISTORY_DIR = path.join(ROOT, 'thread-history')
const LOG_DIR = path.join(ROOT, 'logs')
const DELIVERY_RECEIPTS_FILE = path.join(LOG_DIR, 'delivery-receipts.ndjson')
const LAST_DELIVERY_FILE = path.join(LOG_DIR, 'last-delivery.json')
const TRANSPORT_ATTEMPT_LEDGER_FILE = path.join(LOG_DIR, 'transport-attempts.ndjson')
const TRANSPORT_ATTEMPT_LEDGER_SCHEMA =
  'scv-final-sender-transport-attempt-ledger-2026-08-20-v1'
const PROVIDER_RESPONSE_DIR = path.join(LOG_DIR, 'provider-send-responses')
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024
const ENV_PATH = path.join(ROOT, '.env')
const STALE_DIR = path.join(ROOT, 'outbox_quarantine_stale')
const AUTHORITY_DIR = path.join(ROOT, 'outbox_quarantine_non_authoritative')
const FAILED_DIR = path.join(ROOT, 'outbox_quarantine_failed')
const CONTRACT_HARNESS_DIR = path.join(ROOT, 'outbox_quarantine_contract_harness')
const HUMAN_AGENT_DIR = path.join(ROOT, 'outbox_human_agent_required')
const OUTBOUND2_URL = process.env.SCV_OUTBOUND2_URL || `http://127.0.0.1:${process.env.SCV_OUTBOUND2_PORT || 3102}/`
const parsedFinalSenderTimeoutMs = Number(process.env.SCV_FINAL_SENDER_TIMEOUT_MS || 20000)
const FINAL_SENDER_TIMEOUT_MS = Number.isFinite(parsedFinalSenderTimeoutMs)
  ? Math.min(60000, Math.max(1000, parsedFinalSenderTimeoutMs))
  : 20000
const EMPTY_POLL_MS = 500
const RETRY_BASE_MS = 15000
const RETRY_MAX_MS = 300000
const MAX_RETRIES = 8
const INTERNAL_SEND_MAX_RETRIES = 12
const REQUIRED_SOURCE = SCV_SINGLE_CONTROL_SOURCE
const DUPLICATE_WINDOW_MS = 72 * 60 * 60 * 1000
const OUTBOX_SEND_ORDER_LOCK_VERSION = 'scv-outbox-send-order-lock-2026-07-10-v2'
const OUTBOX_DURABLE_REQUEUE_SCHEMA =
  'scv-outbox-durable-requeue-transition-2026-08-25-v1'
const MAX_TRANSPORT_LEDGER_RECOVERY_BYTES = 8 * 1024 * 1024
let outboxHarnessHooks = null

function setOutboxHarnessHooks(hooks) {
  if (String(process.env.SCV_OUTBOX_TEST_HARNESS || '') !== '1') {
    throw new Error('outbox_harness_hooks_not_enabled')
  }
  if (hooks !== null && (typeof hooks !== 'object' || Array.isArray(hooks))) {
    throw new Error('outbox_harness_hooks_invalid')
  }
  outboxHarnessHooks = hooks
}

function fsyncDirectory(directory) {
  let descriptor
  try {
    // Runtime queue directories may be trusted namespace symlinks. Resolve the
    // directory once, then refuse a symlink at the descriptor boundary.
    const realDirectory = fs.realpathSync(directory)
    descriptor = fs.openSync(
      realDirectory,
      fs.constants.O_RDONLY |
        (fs.constants.O_DIRECTORY || 0) |
        (fs.constants.O_NOFOLLOW || 0)
    )
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function writeAll(descriptor, bytes) {
  let offset = 0
  while (offset < bytes.length) {
    const written = fs.writeSync(
      descriptor, bytes, offset, bytes.length - offset, offset
    )
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error('outbox_durable_write_short')
    }
    offset += written
  }
}

function invokeOutboxHarnessHook(name, context = {}) {
  const hook = outboxHarnessHooks?.[name]
  if (typeof hook === 'function') hook(context)
}

function durableReplaceJson(file, value, options = {}) {
  const directory = path.dirname(file)
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`
  )
  let descriptor
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600
    )
    fs.fchmodSync(descriptor, 0o600)
    writeAll(descriptor, bytes)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    if (options.beforeReplaceHook) {
      invokeOutboxHarnessHook(options.beforeReplaceHook, { file, temporary })
    }
    fs.renameSync(temporary, file)
    fsyncDirectory(directory)
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
  return file
}

function unlinkAndFsync(file) {
  fs.unlinkSync(file)
  fsyncDirectory(path.dirname(file))
}

function sameFileIdentity(left, right) {
  try {
    const leftStat = fs.lstatSync(left)
    const rightStat = fs.lstatSync(right)
    return leftStat.isFile() && rightStat.isFile() &&
      !leftStat.isSymbolicLink() && !rightStat.isSymbolicLink() &&
      leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino
  } catch {
    return false
  }
}

function publishPreparedOutboxLock(lock, original, options = {}) {
  if (fs.existsSync(original)) {
    if (!sameFileIdentity(lock, original)) {
      throw new Error('outbox_durable_publish_collision')
    }
  } else {
    fs.linkSync(lock, original)
    fsyncDirectory(path.dirname(original))
  }
  if (options.afterPublishHook) {
    invokeOutboxHarnessHook(options.afterPublishHook, { lock, original })
  }
  unlinkAndFsync(lock)
  return original
}

function strictQueueMarkerVerdict(file, { repairMissing = false } = {}) {
  const packetInspection = inspectPacketFile(ROOT, file, null)
  if (!packetInspection.valid) {
    // Unreadable/corrupt queue bytes with a retained VALID adoption marker for
    // the same idempotency key (derived from the artifact basename) is the
    // marker-cannot-prove-pre-network case: the marker proves packet identity,
    // not that an earlier process never sent it. Surface the canonical
    // no-resend reason so the human hold routes to exact manual
    // reconciliation instead of a generic corrupt-json label.
    const nameMatch = path.basename(file).match(/^([a-f0-9]{64}-\d+)\.json(?:\.lock)?$/)
    if (nameMatch) {
      const marker = path.join(adoptionPaths(ROOT).markers, `${nameMatch[1]}.json`)
      let markerValid = false
      try {
        const markerRaw = JSON.parse(fs.readFileSync(marker, 'utf8'))
        markerValid = inspectMarkerFile(
          ROOT, marker, markerRaw?.adopted_packet, nameMatch[1], { allowLegacy: false }
        ).valid === true
      } catch {}
      if (markerValid) {
        return {
          ready: false,
          repaired: false,
          marker,
          reason: `outbox_adoption_marker_is_not_durable_pre_network_proof_no_resend:${packetInspection.reason}`
        }
      }
    }
    return { ready: false, repaired: false, reason: packetInspection.reason }
  }
  const key = idempotencyKeyForPacket(packetInspection.value)
  const marker = path.join(adoptionPaths(ROOT).markers, `${key}.json`)
  if (!fs.existsSync(marker) && repairMissing) {
    ensureMarkerForPacket(
      ROOT, marker, packetInspection.value, key, packetInspection.sha256
    )
    return {
      ready: false,
      repaired: true,
      reason: 'outbox_queue_marker_reconciled_before_claim',
      marker,
      packet: packetInspection.value
    }
  }
  const markerInspection = inspectMarkerFile(
    ROOT, marker, packetInspection.value, key, { allowLegacy: false }
  )
  if (!markerInspection.valid) {
    return {
      ready: false,
      repaired: false,
      reason: markerInspection.reason,
      marker,
      packet: packetInspection.value
    }
  }
  if (String(markerInspection.value?.queue_file_sha256 || '') !== packetInspection.sha256) {
    return {
      ready: false,
      repaired: false,
      reason: 'outbox_queue_marker_exact_bytes_mismatch',
      marker,
      packet: packetInspection.value
    }
  }
  return {
    ready: true,
    repaired: false,
    reason: 'outbox_queue_strict_marker_ready',
    marker,
    packet: packetInspection.value
  }
}

function reconcilePublishedQueueMarker(file) {
  const packetInspection = inspectPacketFile(ROOT, file, null)
  if (!packetInspection.valid) {
    // Legacy and operator-recovery artifacts predate the adoption receipt
    // contract. They may be republished into the queue for the protective
    // hold/recovery lanes, but they can never reach the network: the strict
    // marker gate blocks them again at send eligibility (listFiles and
    // handleFile both re-gate). Failing the republish here would strand the
    // artifact in a lock and violate the no-half-state rule instead.
    console.log(JSON.stringify({
      type: 'outbox_queue_marker_reconcile_skipped_non_adoption',
      ...logPaths(file),
      reason: packetInspection.reason
    }))
    return null
  }
  const key = idempotencyKeyForPacket(packetInspection.value)
  const marker = path.join(adoptionPaths(ROOT).markers, `${key}.json`)
  durableReplaceJson(
    marker,
    markerValue(packetInspection.value, key, packetInspection.sha256)
  )
  const verdict = strictQueueMarkerVerdict(file)
  if (!verdict.ready) throw new Error(verdict.reason)
  return verdict
}

function holdMarkerBlockedQueue(file, verdict) {
  let queueSha256 = ''
  try {
    const stat = fs.lstatSync(file)
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2 * 1024 * 1024) {
      queueSha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    }
  } catch {}
  const holdId = crypto.createHash('sha256')
    .update(`${path.basename(file)}\0${queueSha256}\0${String(verdict?.reason || '')}`)
    .digest('hex')
  const holdFile = path.join(HUMAN_AGENT_DIR, `outbox-marker-gate-${holdId}.json`)
  if (!fs.existsSync(holdFile)) {
    durableCreateJson(holdFile, {
      schema: 'scv-outbox-marker-gate-human-hold-2026-08-29-v1',
      human_agent_required: true,
      customer_reply_status: 'unconfirmed',
      no_blind_resend: true,
      reason: String(verdict?.reason || 'outbox_queue_marker_gate_invalid'),
      queue_file_sha256: queueSha256,
      queue_basename_sha256: crypto.createHash('sha256')
        .update(path.basename(file)).digest('hex'),
      instruction: 'reconcile the strict adoption marker, exact queue bytes, transport ledger, and provider receipt before any manual send',
      queued_for_human_agent_at: new Date().toISOString(),
      raw_values_included: false,
      secrets_included: false
    })
  }
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file)
    if (stat.isFile() || stat.isSymbolicLink()) {
      unlinkAndFsync(file)
    } else {
      const quarantined = path.join(
        FAILED_DIR, `marker-gate-${holdId}-${path.basename(file)}`
      )
      fs.renameSync(file, quarantined)
      fsyncDirectory(path.dirname(file))
      fsyncDirectory(FAILED_DIR)
    }
  }
  return holdFile
}

function acquireOutboxLock(file) {
  const lock = `${file}.lock`
  if (fs.existsSync(lock)) {
    if (!sameFileIdentity(file, lock)) {
      throw new Error('outbox_lock_collision_manual_reconciliation_required')
    }
    unlinkAndFsync(lock)
  }
  fs.linkSync(file, lock)
  fsyncDirectory(path.dirname(file))
  unlinkAndFsync(file)
  return lock
}

function logIdentity(packet) {
  return redactedIdentity(packet || {})
}

function logPaths(file, dest) {
  return {
    file_hmac_sha256: artifactSha256(file),
    ...(dest ? { destination_hmac_sha256: artifactSha256(dest) } : {})
  }
}

function finalSenderResultMetrics(result) {
  const body = result?.body?.result?.body || {}
  // Visibility truth is reported separately from provider acceptance.
  // `delivery_outcome_ambiguous` = provider acceptance unknown (exception,
  // timeout, 5xx). `delivery_visibility_unknown` = provider accepted but no
  // Instagram thread evidence exists (production has no visibility client).
  const visibilityState = Object.values(VISIBILITY_STATES).includes(String(body.visibility_state || ''))
    ? String(body.visibility_state)
    : classifyVisibilityState(body)
  return {
    http_status: Number(result?.http_status || 0),
    final_sender_status: Number(result?.body?.result?.status || 0),
    provider_status: Number(body.manychat_status || 0),
    provider_body_status: safeEnum(body?.manychat_body?.status),
    delivery_accepted: body.delivery_accepted === true,
    delivery_confirmed: body.delivery_confirmed === true,
    delivery_outcome_ambiguous: body.delivery_outcome_ambiguous === true,
    visibility_state: visibilityState,
    visibility_confirmed: visibilityState === VISIBILITY_STATES.CONFIRMED_VISIBLE,
    delivery_visibility_unknown:
      visibilityState === VISIBILITY_STATES.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN ||
      visibilityState === VISIBILITY_STATES.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN,
    visibility_confirmation_source: String(body.visibility_confirmation_source || 'none'),
    newer_inbound_is_visibility_proof: false,
    requires_human_agent: body.requires_human_agent === true
  }
}

function transportAttemptIdentity(packet) {
  return {
    deployment_id: String(process.env.RAILWAY_DEPLOYMENT_ID || ''),
    instagram_username: String(packet?.instagram_username || '').trim().toLowerCase(),
    contact_id: String(packet?.contact_id || '').trim(),
    message_id: String(packet?.message_id || '').trim(),
    bubble_index: Number(packet?.bubble_index || 0),
    text_sha256: crypto.createHash('sha256')
      .update(String(packet?.bubble?.text || '')).digest('hex')
  }
}

function privateTransportAttemptLedgerDirectory(logDir = LOG_DIR, env = process.env) {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true, mode: 0o700 })
  const directoryStat = fs.lstatSync(logDir)
  if (directoryStat.isDirectory() && !directoryStat.isSymbolicLink()) return logDir
  if (!directoryStat.isSymbolicLink()) {
    throw new Error('transport_attempt_ledger_directory_invalid')
  }

  const persistRoot = String(env.SCV_PERSIST_ROOT || '').trim()
  if (!persistRoot || !path.isAbsolute(persistRoot)) {
    throw new Error('transport_attempt_ledger_persist_root_invalid')
  }
  const persistRootResolved = path.resolve(persistRoot)
  const namespaceParent = path.join(persistRootResolved, NAMESPACE_ROOT_DIR)
  const namespaceRoot = namespacedPersistRoot(
    persistRootResolved,
    runtimeNamespaceFromEnv(env)
  )
  const expectedLogDir = path.join(namespaceRoot, 'logs')
  const linkTarget = path.resolve(path.dirname(logDir), fs.readlinkSync(logDir))
  if (linkTarget !== path.resolve(expectedLogDir) || !pathInside(namespaceRoot, expectedLogDir)) {
    throw new Error('transport_attempt_ledger_directory_wrong_target')
  }

  const persistRootStat = fs.lstatSync(persistRootResolved)
  const namespaceParentStat = fs.lstatSync(namespaceParent)
  const namespaceStat = fs.lstatSync(namespaceRoot)
  const expectedStat = fs.lstatSync(expectedLogDir)
  if (!persistRootStat.isDirectory() || persistRootStat.isSymbolicLink() ||
      !namespaceParentStat.isDirectory() || namespaceParentStat.isSymbolicLink() ||
      !namespaceStat.isDirectory() || namespaceStat.isSymbolicLink() ||
      !expectedStat.isDirectory() || expectedStat.isSymbolicLink()) {
    throw new Error('transport_attempt_ledger_persistent_directory_invalid')
  }
  const realPersistRoot = fs.realpathSync(persistRootResolved)
  const realNamespaceParent = fs.realpathSync(namespaceParent)
  const realNamespaceRoot = fs.realpathSync(namespaceRoot)
  const realExpectedLogDir = fs.realpathSync(expectedLogDir)
  if (!pathInside(realPersistRoot, realNamespaceParent) ||
      realNamespaceParent === realPersistRoot ||
      !pathInside(realNamespaceParent, realNamespaceRoot) ||
      realNamespaceRoot === realNamespaceParent ||
      fs.realpathSync(logDir) !== realExpectedLogDir ||
      !pathInside(realNamespaceRoot, realExpectedLogDir)) {
    throw new Error('transport_attempt_ledger_persistent_directory_escape')
  }
  return expectedLogDir
}

function ensurePrivateTransportAttemptLedger() {
  const ledgerDirectory = privateTransportAttemptLedgerDirectory()
  const directoryFlags = fs.constants.O_RDONLY |
    (fs.constants.O_DIRECTORY || 0) |
    (fs.constants.O_NOFOLLOW || 0)
  let directoryDescriptor
  try {
    directoryDescriptor = fs.openSync(ledgerDirectory, directoryFlags)
    fs.fchmodSync(directoryDescriptor, 0o700)
    const directoryStat = fs.fstatSync(directoryDescriptor)
    if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077) !== 0) {
      throw new Error('transport_attempt_ledger_directory_not_private')
    }
  } finally {
    if (directoryDescriptor !== undefined) fs.closeSync(directoryDescriptor)
  }
  const ledgerFile = path.join(ledgerDirectory, path.basename(TRANSPORT_ATTEMPT_LEDGER_FILE))
  if (fs.existsSync(ledgerFile)) {
    const existing = fs.lstatSync(ledgerFile)
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('transport_attempt_ledger_file_invalid')
    }
  }
  return ledgerFile
}

function appendTransportAttemptRecord(record) {
  const ledgerFile = ensurePrivateTransportAttemptLedger()
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT |
    (fs.constants.O_NOFOLLOW || 0)
  let descriptor
  try {
    descriptor = fs.openSync(ledgerFile, flags, 0o600)
    fs.fchmodSync(descriptor, 0o600)
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      throw new Error('transport_attempt_ledger_file_not_private_regular')
    }
    const written = fs.writeSync(descriptor, bytes, 0, bytes.length, null)
    if (written !== bytes.length) throw new Error('transport_attempt_ledger_short_write')
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  fsyncDirectory(path.dirname(ledgerFile))
  return record
}

function createTransportAttemptStart(packet, now = new Date()) {
  const startedAt = now.toISOString()
  const ordinal = Math.max(1, Number(packet?.attempts || 0) + 1)
  const attemptId = crypto.createHash('sha256').update([
    String(packet?.contact_id || ''),
    String(packet?.message_id || ''),
    String(packet?.bubble_index || 0),
    String(packet?.control_receipt?.receipt_sha256 || ''),
    String(ordinal),
    startedAt,
    crypto.randomBytes(32).toString('hex')
  ].join('\n')).digest('hex')
  return {
    schema: TRANSPORT_ATTEMPT_LEDGER_SCHEMA,
    record_type: 'attempt_started',
    attempt_id: attemptId,
    attempt_ordinal: ordinal,
    started_at_utc: startedAt,
    ...transportAttemptIdentity(packet),
    request_started: true,
    raw_message_text_included: false,
    secrets_included: false
  }
}

function transportAttemptResultOutcome(result) {
  if (isSendAccepted(result)) return { outcome: 'accepted', failureClass: '' }
  if (isDeliveryOutcomeAmbiguous(result)) {
    return { outcome: 'ambiguous', failureClass: 'ambiguous_provider_outcome' }
  }
  if (requiresHumanAgent(result)) {
    return { outcome: 'human_agent_required', failureClass: 'provider_window' }
  }
  if (isFinalSenderPause(result)) {
    return { outcome: 'paused', failureClass: 'final_sender_pause' }
  }
  if (shouldFailClosedWithoutRetry(result)) {
    return { outcome: 'provider_success_unverified', failureClass: 'provider_contract' }
  }
  const body = result?.body?.result?.body || {}
  const status = Number(result?.body?.result?.status || result?.http_status || 0)
  const classification = classifySendFailure([
    `3102_send_failed_${status}`,
    String(result?.body?.error || ''),
    String(body?.message || body?.error || '')
  ].join(' '))
  return {
    outcome: classification === 'transient'
      ? 'transient_failure'
      : classification === 'permanent'
        ? 'permanent_failure'
        : classification === 'internal_control'
          ? 'internal_failure'
          : 'unknown_failure',
    failureClass: classification
  }
}

function createTransportAttemptCompletion(start, packet, options = {}) {
  const result = options.result || null
  const metrics = finalSenderResultMetrics(result)
  const derived = options.error
    ? { outcome: 'ambiguous', failureClass: 'ambiguous_transport' }
    : transportAttemptResultOutcome(result)
  const providerBody = result?.body?.result?.body || {}
  return {
    schema: TRANSPORT_ATTEMPT_LEDGER_SCHEMA,
    record_type: 'attempt_completed',
    attempt_id: start.attempt_id,
    attempt_ordinal: start.attempt_ordinal,
    started_at_utc: start.started_at_utc,
    completed_at_utc: (options.now || new Date()).toISOString(),
    ...transportAttemptIdentity(packet),
    response_received: options.error ? false : true,
    outcome: derived.outcome,
    failure_class: derived.failureClass,
    http_status: metrics.http_status,
    final_sender_status: metrics.final_sender_status,
    manychat_status: metrics.provider_status,
    delivery_accepted: metrics.delivery_accepted,
    delivery_confirmed: metrics.delivery_confirmed,
    delivery_outcome_ambiguous: options.error
      ? true
      : metrics.delivery_outcome_ambiguous || derived.outcome === 'ambiguous',
    visibility_state: options.error || derived.outcome === 'ambiguous'
      ? VISIBILITY_STATES.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN
      : metrics.visibility_state,
    delivery_visibility_unknown: options.error || derived.outcome === 'ambiguous'
      ? true
      : metrics.delivery_visibility_unknown,
    visibility_confirmed: options.error ? false : metrics.visibility_confirmed,
    newer_inbound_is_visibility_proof: false,
    requires_human_agent: metrics.requires_human_agent,
    provider_response_sha256:
      String(providerBody.provider_response_sha256 || ''),
    raw_message_text_included: false,
    secrets_included: false
  }
}

function readTransportAttemptTailRecords() {
  const ledgerFile = ensurePrivateTransportAttemptLedger()
  if (!fs.existsSync(ledgerFile)) return []
  let descriptor
  try {
    descriptor = fs.openSync(
      ledgerFile,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size < 0) return []
    const length = Math.min(stat.size, MAX_TRANSPORT_LEDGER_RECOVERY_BYTES)
    if (length === 0) return []
    const offset = stat.size - length
    const bytes = Buffer.alloc(length)
    const read = fs.readSync(descriptor, bytes, 0, length, offset)
    let text = bytes.subarray(0, read).toString('utf8')
    if (offset > 0) {
      const firstNewline = text.indexOf('\n')
      text = firstNewline === -1 ? '' : text.slice(firstNewline + 1)
    }
    return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        const record = JSON.parse(line)
        return record && typeof record === 'object' && !Array.isArray(record)
          ? [record]
          : []
      } catch {
        return []
      }
    })
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function transportRecordMatchesPacket(record, packet) {
  const identity = transportAttemptIdentity(packet)
  return String(record?.instagram_username || '') === identity.instagram_username &&
    String(record?.contact_id || '') === identity.contact_id &&
    String(record?.message_id || '') === identity.message_id &&
    Number(record?.bubble_index) === identity.bubble_index &&
    String(record?.text_sha256 || '') === identity.text_sha256
}

function isDefinitiveRetryableCompletion(record) {
  return record?.record_type === 'attempt_completed' &&
    record?.response_received === true &&
    record?.delivery_accepted !== true &&
    record?.delivery_confirmed !== true &&
    record?.delivery_outcome_ambiguous !== true &&
    record?.requires_human_agent !== true &&
    ['transient_failure', 'internal_failure', 'unknown_failure'].includes(String(record?.outcome || ''))
}

function durableRequeueTransitionVerdict(packet) {
  const transition = packet?.durable_requeue_transition
  if (!transition || typeof transition !== 'object' || Array.isArray(transition)) {
    return { valid: false, reason: 'durable_requeue_transition_missing' }
  }
  if (
    transition.schema !== OUTBOX_DURABLE_REQUEUE_SCHEMA ||
    !['delay_hard_gate_rearm', 'send_failure_retry'].includes(String(transition.reason || '')) ||
    !['pre_network', 'definitive_failure_response'].includes(String(transition.network_disposition || '')) ||
    Number(transition.attempts) !== Number(packet?.attempts || 0) ||
    String(transition.packet_adoption_sha256 || '') !== packetAdoptionSha256(packet) ||
    !Number.isFinite(Date.parse(String(transition.prepared_at || ''))) ||
    packet?.transport_terminal_no_resend === true ||
    String(packet?.transport_terminal_outcome || '')
  ) return { valid: false, reason: 'durable_requeue_transition_binding_invalid' }
  if (!hasValidAuthority(packet)) {
    return { valid: false, reason: 'durable_requeue_authority_invalid' }
  }

  const records = readTransportAttemptTailRecords()
    .filter((record) => transportRecordMatchesPacket(record, packet))
  const starts = records.filter((record) => record?.record_type === 'attempt_started')
  const transitionAttemptId = String(transition.transport_attempt_id || '')
  const attemptOrdinal = Number(transition.attempts)
  if (starts.some((record) => Number(record?.attempt_ordinal || 0) > attemptOrdinal)) {
    return { valid: false, reason: 'durable_requeue_newer_transport_attempt_exists' }
  }

  if (!transitionAttemptId) {
    const everyPriorStartDefinitivelyCompleted = starts.every((startRecord) =>
      Number(startRecord?.attempt_ordinal || 0) < attemptOrdinal &&
      records.some((record) =>
        String(record?.attempt_id || '') === String(startRecord?.attempt_id || '') &&
        Number(record?.attempt_ordinal || 0) === Number(startRecord?.attempt_ordinal || 0) &&
        isDefinitiveRetryableCompletion(record)
      )
    )
    if (
      transition.network_disposition !== 'pre_network' ||
      !everyPriorStartDefinitivelyCompleted
    ) {
      return { valid: false, reason: 'durable_requeue_pre_network_proof_invalid' }
    }
    return { valid: true, reason: 'durable_requeue_pre_network_proven' }
  }

  const start = starts.find((record) =>
    String(record?.attempt_id || '') === transitionAttemptId &&
    Number(record?.attempt_ordinal || 0) === attemptOrdinal
  )
  const completion = records.find((record) =>
    String(record?.attempt_id || '') === transitionAttemptId &&
    Number(record?.attempt_ordinal || 0) === attemptOrdinal &&
    isDefinitiveRetryableCompletion(record)
  )
  if (!start || !completion) {
    return { valid: false, reason: 'durable_requeue_definitive_completion_missing' }
  }
  return { valid: true, reason: 'durable_requeue_definitive_completion_proven' }
}

function durableRequeueFromLock(lock, packet, options = {}) {
  const original = lock.replace(/\.lock$/, '')
  packet.durable_requeue_transition = {
    schema: OUTBOX_DURABLE_REQUEUE_SCHEMA,
    reason: String(options.reason || ''),
    network_disposition: String(options.networkDisposition || 'pre_network'),
    failure_class: String(options.failureClass || ''),
    attempts: Number(packet?.attempts || 0),
    transport_attempt_id: String(options.transportAttemptId || ''),
    packet_adoption_sha256: packetAdoptionSha256(packet),
    prepared_at: new Date().toISOString()
  }
  const verdict = durableRequeueTransitionVerdict(packet)
  if (!verdict.valid) throw new Error(verdict.reason)
  durableReplaceJson(lock, packet, {
    beforeReplaceHook: 'after_retry_temp_fsync_before_lock_replace'
  })
  invokeOutboxHarnessHook('after_retry_lock_replace_before_publish', { lock, original })
  reconcilePublishedQueueMarker(lock)
  publishPreparedOutboxLock(lock, original, {
    afterPublishHook: 'after_retry_publish_before_lock_unlink'
  })
  return original
}

function ensureDirs() {
  adoptionPaths(ROOT)
  fs.mkdirSync(THREAD_STATE_DIR, { recursive: true })
  fs.mkdirSync(THREAD_HISTORY_DIR, { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })
  fs.mkdirSync(STALE_DIR, { recursive: true })
  fs.mkdirSync(AUTHORITY_DIR, { recursive: true })
  fs.mkdirSync(FAILED_DIR, { recursive: true })
  fs.mkdirSync(CONTRACT_HARNESS_DIR, { recursive: true })
  fs.mkdirSync(HUMAN_AGENT_DIR, { recursive: true })
}

function extractManyChatProviderReceipt(body) {
  const candidates = [
    ['data', 'message_id'],
    ['data', 'messageId'],
    ['data', 'id'],
    ['data', 0, 'message_id'],
    ['data', 0, 'messageId'],
    ['data', 0, 'id'],
    ['data', 'result', 'message_id'],
    ['data', 'result', 'messageId'],
    ['result', 'message_id'],
    ['result', 'messageId'],
    ['message_id'],
    ['messageId'],
    ['id']
  ]
  for (const segments of candidates) {
    let value = body
    for (const segment of segments) value = value?.[segment]
    if (!['string', 'number', 'bigint'].includes(typeof value)) continue
    const normalized = String(value).trim()
    if (
      normalized && normalized.length <= 512 &&
      !/[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
      return { present: true, id: normalized, path: segments.join('.') }
    }
  }
  return { present: false, id: '', path: '' }
}

function decodeCanonicalProviderResponse(value) {
  if (
    typeof value !== 'string' || !value ||
    value.length > Math.ceil(MAX_PROVIDER_RESPONSE_BYTES / 3) * 4 + 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new Error('manychat_provider_response_base64_invalid')
  const bytes = Buffer.from(value, 'base64')
  if (
    bytes.length < 1 || bytes.length > MAX_PROVIDER_RESPONSE_BYTES ||
    bytes.toString('base64') !== value
  ) throw new Error('manychat_provider_response_base64_invalid')
  return bytes
}

function ensurePrivateProviderResponseDir() {
  fs.mkdirSync(PROVIDER_RESPONSE_DIR, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(PROVIDER_RESPONSE_DIR)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('manychat_provider_response_directory_invalid')
  }
  fs.chmodSync(PROVIDER_RESPONSE_DIR, 0o700)
  if ((fs.lstatSync(PROVIDER_RESPONSE_DIR).mode & 0o077) !== 0) {
    throw new Error('manychat_provider_response_directory_not_private')
  }
}

function persistAcceptedProviderResponse(packet, result) {
  if (!isSendAccepted(result)) throw new Error('manychat_provider_response_not_accepted')
  const body = result?.body?.result?.body || {}
  const bytes = decodeCanonicalProviderResponse(body.provider_response_body_base64)
  const responseSha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const declaredSha256 = String(body.provider_response_sha256 || '')
  const declaredSize = Number(body.provider_response_size_bytes)
  if (
    !/^[a-f0-9]{64}$/.test(declaredSha256) ||
    declaredSha256 !== responseSha256 ||
    !Number.isSafeInteger(declaredSize) || declaredSize !== bytes.length
  ) throw new Error('manychat_provider_response_binding_invalid')

  let providerBody
  try { providerBody = JSON.parse(bytes.toString('utf8')) } catch {
    throw new Error('manychat_provider_response_json_invalid')
  }
  if (
    !providerBody || typeof providerBody !== 'object' || Array.isArray(providerBody) ||
    String(providerBody.status || '').toLowerCase() !== 'success' ||
    Number(body.manychat_status || 0) !== 200
  ) throw new Error('manychat_provider_response_acceptance_invalid')

  const providerReceipt = extractManyChatProviderReceipt(providerBody)
  if (
    body.provider_receipt_id_present !== providerReceipt.present ||
    String(body.provider_receipt_id || '') !== providerReceipt.id ||
    String(body.provider_receipt_id_path || '') !== providerReceipt.path ||
    providerReceipt.id.startsWith('runtime-delivery:')
  ) throw new Error('manychat_provider_receipt_binding_invalid')

  const sendAttemptId = String(packet?.transport_attempt_id || '')
  if (!/^[a-f0-9]{64}$/.test(sendAttemptId)) {
    throw new Error('manychat_send_attempt_id_invalid')
  }
  ensurePrivateProviderResponseDir()
  const fileName = `manychat-send-${sendAttemptId}-${responseSha256}.raw.json`
  const file = path.join(PROVIDER_RESPONSE_DIR, fileName)
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0)
  let descriptor
  try {
    descriptor = fs.openSync(file, flags, 0o600)
    fs.fchmodSync(descriptor, 0o600)
    fs.writeFileSync(descriptor, bytes)
    fs.fsyncSync(descriptor)
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size !== bytes.length || (stat.mode & 0o077) !== 0) {
      throw new Error('manychat_provider_response_write_verification_failed')
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  return {
    provider_response_file: fileName,
    provider_response_sha256: responseSha256,
    provider_response_size_bytes: bytes.length,
    provider_receipt_id_present: providerReceipt.present,
    provider_receipt_id: providerReceipt.id,
    provider_receipt_id_path: providerReceipt.path,
    transport_attempt_id: sendAttemptId
  }
}

function appendNdjson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(obj) + '\n')
}

function visibilityReceiptFields(result) {
  const metrics = finalSenderResultMetrics(result)
  return {
    visibility_state: metrics.visibility_state,
    visibility_confirmed: metrics.visibility_confirmed,
    delivery_visibility_unknown: metrics.delivery_visibility_unknown,
    visibility_confirmation_source: metrics.visibility_confirmation_source,
    newer_inbound_is_visibility_proof: false
  }
}

function recordDeliveryReceipt(packet, result, deliveryStatus, providerResponseEvidence) {
  if (!providerResponseEvidence || typeof providerResponseEvidence !== 'object') {
    throw new Error('accepted_delivery_provider_response_evidence_missing')
  }
  const receipt = {
    at: new Date().toISOString(),
    contact_id: String(packet.contact_id || ''),
    thread_id: String(packet.thread_id || packet.contact_id || ''),
    instagram_username: String(packet.instagram_username || ''),
    message_id: String(packet.message_id || ''),
    bubble_index: Number(packet.bubble_index || 0),
    control_receipt_sha256: String(packet.control_receipt?.receipt_sha256 || ''),
    text_sha256: crypto.createHash('sha256').update(String(packet?.bubble?.text || '')).digest('hex'),
    text_length: String(packet?.bubble?.text || '').length,
    delivery_status: String(deliveryStatus || ''),
    delivery_accepted: result?.body?.result?.body?.delivery_accepted === true,
    delivery_confirmed: result?.body?.result?.body?.delivery_confirmed === true,
    delivery_method: String(result?.body?.result?.body?.delivery_method || ''),
    http_status: Number(result?.http_status || 0),
    manychat_status: Number(result?.body?.result?.body?.manychat_status || 0),
    provider_response_file: String(providerResponseEvidence.provider_response_file || ''),
    provider_response_sha256: String(providerResponseEvidence.provider_response_sha256 || ''),
    provider_response_size_bytes: Number(providerResponseEvidence.provider_response_size_bytes || 0),
    provider_receipt_id_present: providerResponseEvidence.provider_receipt_id_present === true,
    provider_receipt_id: String(providerResponseEvidence.provider_receipt_id || ''),
    provider_receipt_id_path: String(providerResponseEvidence.provider_receipt_id_path || ''),
    transport_attempt_id: String(providerResponseEvidence.transport_attempt_id || ''),
    transport_response_received_at: String(packet?.transport_response_received_at || ''),
    ...visibilityReceiptFields(result)
  }
  appendNdjson(DELIVERY_RECEIPTS_FILE, receipt)
  fs.writeFileSync(LAST_DELIVERY_FILE, JSON.stringify(receipt, null, 2) + '\n')
  // Reconciliation ledger: one open entry per provider-accepted attempt whose
  // Instagram visibility is unknown. It survives outbox removal and is closed
  // only by a real probe or an explicit operator resolution, never by a newer
  // inbound (2026-09-02 owner directive).
  recordDeliveryVisibility(ROOT, {
    at: receipt.at,
    thread_id: receipt.thread_id,
    contact_id: receipt.contact_id,
    message_id: receipt.message_id,
    bubble_index: receipt.bubble_index,
    transport_attempt_id: receipt.transport_attempt_id,
    text_sha256: receipt.text_sha256,
    text_length: receipt.text_length,
    delivery_status: receipt.delivery_status,
    delivery_accepted: receipt.delivery_accepted,
    delivery_confirmed: receipt.delivery_confirmed,
    provider_receipt_id_present: receipt.provider_receipt_id_present,
    provider_response_file: receipt.provider_response_file,
    provider_response_sha256: receipt.provider_response_sha256,
    control_receipt_sha256: receipt.control_receipt_sha256,
    visibility_state: receipt.visibility_state,
    visibility_confirmation_source: receipt.visibility_confirmation_source
  })
  return receipt
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadEnvFlag(name, defaultValue = false) {
  const envValue = process.env[name]
  if (typeof envValue === 'string' && envValue.trim() !== '') {
    return ['1', 'true', 'yes', 'on'].includes(envValue.trim().toLowerCase())
  }

  try {
    if (fs.existsSync(ENV_PATH)) {
      const raw = fs.readFileSync(ENV_PATH, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const idx = trimmed.indexOf('=')
        if (idx === -1) continue
        const key = trimmed.slice(0, idx).trim()
        const value = trimmed.slice(idx + 1).trim()
        if (key === name) {
          return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
        }
      }
    }
  } catch {}

  return defaultValue
}

function loadEnvNumber(name, defaultValue) {
  const envValue = process.env[name]
  if (typeof envValue === 'string' && envValue.trim() !== '') {
    const parsed = Number(envValue.trim())
    return Number.isFinite(parsed) ? parsed : defaultValue
  }

  try {
    if (fs.existsSync(ENV_PATH)) {
      const raw = fs.readFileSync(ENV_PATH, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const idx = trimmed.indexOf('=')
        if (idx === -1) continue
        const key = trimmed.slice(0, idx).trim()
        const value = trimmed.slice(idx + 1).trim()
        if (key === name) {
          const parsed = Number(value)
          return Number.isFinite(parsed) ? parsed : defaultValue
        }
      }
    }
  } catch {}

  return defaultValue
}

function parseDueAt(packet) {
  const now = Date.now()
  const parsed = Date.parse(String(packet?.due_at || ''))
  const base = Number.isFinite(parsed)
    ? parsed
    : now + Math.max(0, Number(packet?.bubble?.delay_ms || 0))
  const required = requiredDueAtMsForPacket(packet, now)
  return required == null ? base : Math.max(base, required)
}

function rearmDelayHardGateIfNeeded(lock, packet) {
  const gate = evaluateInitialDelayHardGate(packet)
  if (!gate.blocked) return false

  const original = lock.replace(/\.lock$/, '')
  packet.due_at = new Date(gate.required_due_at_ms).toISOString()
  packet.delay_hard_gate_rearmed_at = new Date(gate.now_ms).toISOString()
  packet.delay_hard_gate = {
    lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
    reason: gate.reason,
    min_initial_delay_ms: gate.min_initial_delay_ms,
    queued_at_ms: gate.queued_at_ms,
    previous_due_at_ms: gate.due_at_ms,
    required_due_at_ms: gate.required_due_at_ms
  }
  durableRequeueFromLock(lock, packet, {
    reason: 'delay_hard_gate_rearm',
    networkDisposition: 'pre_network',
    transportAttemptId: String(packet?.transport_attempt_id || '')
  })
  console.log(JSON.stringify({
    type: 'worker_delay_hard_gate_rearmed',
    ...logPaths(original),
    ...logIdentity(packet),
    bubble_index: Number(packet.bubble_index || 0),
    fast_delay_target: packet.fast_delay_target === true,
    due_at: packet.due_at,
    delivery_pacing_lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
    gate
  }))
  return true
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

function readLatestThreadState(thread_id) {
  return loadCleanThreadState(thread_id)
}

// Username HEURISTICS may not silence an inbound reply at SEND time either (same
// Ben law as inbox-worker — this outbox check was the second ambush that killed
// wondercrushstudio's queued opener bubbles right after the inbox fix).
const REPLY_LANE_HEURISTIC_TAGS = new Set([
  'tattoo_shop_username_heuristic',
  'tattoo_shop_username_compact_heuristic'
])

async function getAutomationSuppression(packet) {
  const latest = readLatestThreadState(packet.thread_id || packet.contact_id)
  const suppressed = !!(latest?.automation_suppressed || packet?.automation_suppressed)

  if (suppressed) {
    const matchedTag = String(latest?.automation_suppressed_tag || packet?.automation_suppressed_tag || '')
    if (REPLY_LANE_HEURISTIC_TAGS.has(matchedTag)) {
      console.log(JSON.stringify({
        type: 'outbox_worker_heuristic_suppression_bypassed',
        ...logIdentity(packet),
        matched_tag_hmac_sha256: artifactSha256(matchedTag)
      }))
    } else {
      return {
        suppressed,
        matched_tag: matchedTag,
        reason: String(latest?.automation_suppressed_reason || packet?.automation_suppressed_reason || '')
      }
    }
  }

  const instagramSuppression = await getInstagramSuppressionForUsername(
    latest?.instagram_username || packet?.instagram_username,
    { text: `${packet?.text || ''}\n${packet?.bubble?.text || ''}` }
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

function appendThreadHistoryEvent(packet) {
  return appendThreadHistoryEventWithRole(packet, 'assistant')
}

function appendThreadHistoryEventWithRole(packet, role, extra = {}) {
  return appendControlHistoryEvent(ROOT, packet, role, {
    at: new Date().toISOString(),
    ...extra
  })
}

function normalizeBubbleText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function extractUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s]+/gi) || []
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/[)\]}>.,!?]+$/g, '')
}

function shouldBypassDuplicateCheck(packet) {
  if (!packet?.allow_duplicate_url_resend) return false

  const forceSendUrls = new Set(
    (Array.isArray(packet.force_send_urls) ? packet.force_send_urls : [])
      .map(normalizeUrl)
      .filter(Boolean)
  )
  if (!forceSendUrls.size) return false

  const urls = extractUrls(packet?.bubble?.text || '').map(normalizeUrl).filter(Boolean)
  return urls.some((url) => forceSendUrls.has(url))
}

function recentAssistantDuplicate(packet) {
  const threadId = String(packet.thread_id || packet.contact_id || '').trim()
  if (!threadId) return false
  const targetText = normalizeBubbleText(packet?.bubble?.text || '')
  if (!targetText) return false

  try {
    const history = loadCleanThreadHistory(threadId)
    const now = Date.now()
    const events = Array.isArray(history?.events) ? history.events : []
    return events.some((event) => {
      if (!event || !['assistant', 'assistant_attempted'].includes(String(event.role || ''))) return false
      const eventAt = Date.parse(String(event.at || ''))
      if (Number.isFinite(eventAt) && (now - eventAt) > DUPLICATE_WINDOW_MS) return false
      return normalizeBubbleText(event.text || '') === targetText
    })
  } catch {
    return false
  }
}

function pendingOutboundDuplicate(packet, currentFile, options = {}) {
  const threadId = String(packet.thread_id || packet.contact_id || '').trim()
  const targetText = normalizeBubbleText(packet?.bubble?.text || '')
  if (!threadId || !targetText) return false

  const outboxDir = options.outboxDir || OUTBOX_DIR
  const latest = options.latestState || readLatestThreadState(threadId)

  for (const name of fs.readdirSync(outboxDir)) {
    if (!name.endsWith('.json')) continue
    const file = path.join(outboxDir, name)
    if (file === currentFile) continue
    try {
      const other = JSON.parse(fs.readFileSync(file, 'utf8'))
      const otherThread = String(other.thread_id || other.contact_id || '').trim()
      const otherText = normalizeBubbleText(other?.bubble?.text || '')
      if (otherThread === threadId && otherText === targetText) {
        // A packet from an older inbound is already doomed by the stale gate. It
        // cannot suppress the same valid bubble authored for the latest inbound.
        // This exact cross-message collision starved KANDO's form offer: the new
        // offer was duplicate-dropped, then the old offer was stale-dropped.
        if (
          latest?.message_id &&
          String(other.message_id || '') !== String(latest.message_id)
        ) continue
        return true
      }
    } catch {}
  }

  return false
}

function isStaleAgainstLatestInbound(packet) {
  const latest = readLatestThreadState(packet.thread_id || packet.contact_id)
  if (!latest || !latest.message_id) return false

  return String(packet.message_id || '') !== String(latest.message_id)
}

function packetTextCorpus(packet) {
  const parts = []
  if (packet?.bubble?.text) parts.push(String(packet.bubble.text || ''))
  for (const bubble of Array.isArray(packet?.bubbles) ? packet.bubbles : []) {
    if (bubble?.text) parts.push(String(bubble.text || ''))
  }
  return parts.join('\n').toLowerCase()
}

function isAtomicDepositHandoffPacket(packet) {
  const flags = packet?.authority_transport_flags && typeof packet.authority_transport_flags === 'object'
    ? packet.authority_transport_flags
    : {}
  if (flags.atomic_deposit_handoff !== true) return false

  const corpus = packetTextCorpus(packet)
  return (
    /\bdeposit\s+is\s+100\b/i.test(corpus) &&
    /\bzelle\s+is\s+contact@omarprotocol\.com\b/i.test(corpus) &&
    /\bonce\s+you\s+send\s+it\b/i.test(corpus) &&
    /\blmk\b|\blet\s+me\s+know\b/i.test(corpus) &&
    /\bdouble\s+check\b/i.test(corpus) &&
    /\bconfirm\b/i.test(corpus) &&
    /\bcalendar\b/i.test(corpus)
  )
}

function shouldBypassStaleForAtomicDepositHandoff(packet) {
  // Atomicity never authorizes sending for an obsolete inbound generation.
  // The controller's publication gate enforces the same invariant, so allowing
  // a stale packet through here can only create a permanent requeue loop.
  return false
}

function quarantineStale(lock, packet, reason) {
  const file = path.join(STALE_DIR, path.basename(lock).replace(/\.lock$/, ''))
  const payload = {
    ...packet,
    stale_reason: reason,
    quarantined_at: new Date().toISOString()
  }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  fs.unlinkSync(lock)
}

function hasValidAuthority(packet) {
  const receipt = validateControlReceipt(packet, { root: ROOT, requireLedger: true, requirePayload: true })
  return (
    packet &&
    packet.source === REQUIRED_SOURCE &&
    packet.authority &&
    packet.authority.controller === SCV_SINGLE_CONTROL_PLANE_ID &&
    packet.authority.runner === 'scv-single-control-plane' &&
    receipt.valid
  )
}

function quarantineNonAuthoritative(lock, packet, reason) {
  const file = path.join(AUTHORITY_DIR, path.basename(lock).replace(/\.lock$/, ''))
  const payload = {
    ...packet,
    non_authoritative_reason: reason,
    quarantined_at: new Date().toISOString()
  }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  fs.unlinkSync(lock)
}

function quarantineFailed(lock, packet, reason) {
  const file = path.join(FAILED_DIR, path.basename(lock).replace(/\.lock$/, ''))
  const payload = {
    ...packet,
    failed_reason: reason,
    quarantined_at: new Date().toISOString()
  }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  fs.unlinkSync(lock)
}

function quarantineContractHarness(lock, packet, verdict) {
  const file = path.join(CONTRACT_HARNESS_DIR, path.basename(lock).replace(/\.lock$/, ''))
  const payload = {
    ...packet,
    contract_harness_reason: String(verdict?.reason || 'unknown'),
    contract_harness_instruction: String(verdict?.instruction || ''),
    contract_harness_lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION,
    quarantined_at: new Date().toISOString()
  }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
  fs.unlinkSync(lock)
}

function quarantineHumanAgentRequired(lock, packet, result, manualReason = 'manychat_24h_window_requires_human_agent') {
  fs.mkdirSync(HUMAN_AGENT_DIR, { recursive: true })
  const deterministic = path.join(HUMAN_AGENT_DIR, path.basename(lock).replace(/\.lock$/, ''))
  const file = fs.existsSync(deterministic)
    ? path.join(HUMAN_AGENT_DIR, `${Date.now()}-${crypto.randomUUID()}-${path.basename(deterministic)}`)
    : deterministic
  const payload = {
    ...packet,
    manual_reason: String(manualReason || 'manual_reconciliation_required'),
    last_result: result,
    queued_for_human_agent_at: new Date().toISOString()
  }
  durableCreateJson(file, payload)
  unlinkAndFsync(lock)
  return file
}

function holdOutboxPublicationCollisionForHuman(original, lock, reason) {
  ensureDirs()
  const collisionId = `${Date.now()}-${crypto.randomUUID()}`
  const originalDest = path.join(
    HUMAN_AGENT_DIR,
    `outbox-publication-collision-${collisionId}-original.json`
  )
  const lockDest = path.join(
    HUMAN_AGENT_DIR,
    `outbox-publication-collision-${collisionId}-lock.json`
  )
  if (fs.existsSync(original)) fs.renameSync(original, originalDest)
  if (fs.existsSync(lock)) fs.renameSync(lock, lockDest)
  fsyncDirectory(OUTBOX_DIR)
  fsyncDirectory(HUMAN_AGENT_DIR)
  const receipt = path.join(
    HUMAN_AGENT_DIR,
    `outbox-publication-collision-${collisionId}-receipt.json`
  )
  durableCreateJson(receipt, {
    schema: 'scv-outbox-publication-collision-hold-2026-08-25-v1',
    reason: String(reason || 'outbox_publication_collision_manual_reconciliation_required'),
    original_artifact_hmac_sha256: fs.existsSync(originalDest) ? artifactSha256(originalDest) : '',
    lock_artifact_hmac_sha256: fs.existsSync(lockDest) ? artifactSha256(lockDest) : '',
    queued_for_human_agent_at: new Date().toISOString(),
    raw_values_included: false,
    secrets_included: false
  })
  return { action: 'human_agent_hold', originalDest, lockDest, receipt }
}

function staleLockRecoveryThresholdMs(env = process.env) {
  const parsed = Number(env.SCV_STALE_LOCK_RECOVERY_MS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000
}

function staleOutboxHoldThresholdMs(env = process.env) {
  const parsed = Number(env.SCV_HOLD_STALE_BACKLOG_MS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000
}

function outboxRecoverySafetyVerdict(packet, file, env = process.env, now = Date.now()) {
  const verdict = recoveryQueueSafetyVerdict(
    packet,
    env,
    file,
    now,
    staleOutboxHoldThresholdMs(env)
  )
  if (
    verdict.hold &&
    verdict.reason === 'stale_backlog_over_threshold' &&
    isVerifiedStaleOperatorRecoveryEnvelope(packet, now)
  ) {
    return {
      ...verdict,
      hold: false,
      reason: 'verified_stale_operator_recovery_admitted_outbound',
      operator_recovery_admitted: true
    }
  }
  return verdict
}

function fileAgeMs(file, now = Date.now()) {
  try { return now - fs.statSync(file).mtimeMs } catch { return 0 }
}

function holdStaleOutboxLockForHuman(file, packet, meta = {}) {
  const base = path.basename(file).replace(/\.lock$/, '')
  const dest = path.join(HUMAN_AGENT_DIR, `stale-outbox-lock-hold-${Date.now()}-${base}`)
  const payload = {
    ...packet,
    type: 'stale_outbox_lock_human_agent_required',
    manual_reason: 'stale_outbox_lock_abandoned_no_blind_resend',
    queued_for_human_agent_at: new Date().toISOString(),
    stale_lock_source_file: file,
    ...meta
  }
  fs.writeFileSync(dest, JSON.stringify(payload, null, 2))
  fs.unlinkSync(file)
  return dest
}

function holdOutboxBacklogForHuman(file, packet, verdict, meta = {}) {
  const base = path.basename(file).replace(/\.lock$/, '')
  const dest = path.join(HUMAN_AGENT_DIR, `recovery-outbox-hold-${Date.now()}-${base}`)
  const payload = {
    ...packet,
    type: 'recovery_outbox_human_agent_required',
    manual_reason: String(verdict?.reason || 'recovery_queue_safety_hold'),
    human_agent_required: true,
    queued_for_human_agent_at: new Date().toISOString(),
    held_from_outbox_file: base,
    immutable_ingress_timestamp_ms: Number(verdict?.timestamp_ms || 0),
    immutable_ingress_timestamp_source: String(verdict?.source || 'unknown'),
    recovery_cutover_ms: Number(verdict?.cutover_ms || 0),
    stale_backlog_age_ms: verdict?.age_ms,
    stale_backlog_threshold_ms: verdict?.threshold_ms,
    ...meta
  }
  fs.writeFileSync(dest, JSON.stringify(payload, null, 2))
  fs.unlinkSync(file)
  return dest
}

function finalSenderPauseRetryDelayMs(env = process.env) {
  const parsed = Number(env.SCV_FINAL_SENDER_PAUSE_RETRY_MS)
  if (Number.isFinite(parsed) && parsed >= 1000) return parsed
  return 15000
}

function releaseOutboxLockForPause(lockFile, packet, stage = 'final_outbound_recheck', senderReason = '') {
  const original = lockFile.replace(/\.lock$/, '')
  if (fs.existsSync(original)) {
    return holdOutboxBacklogForHuman(lockFile, packet, {
      hold: true,
      reason: 'pause_recheck_lock_collision',
      timestamp_ms: immutableIngressTimeMs(packet, lockFile),
      source: recoveryCutoverVerdict(packet, process.env, lockFile).source,
      cutover_ms: recoveryCutoverVerdict(packet, process.env, lockFile).cutover_ms,
      age_ms: Date.now() - immutableIngressTimeMs(packet, lockFile),
      threshold_ms: staleOutboxHoldThresholdMs(process.env)
    }, { pause_stage: stage })
  }

  // 2026-08-26 incident: a transient 423 from the final sender caused an
  // immediate re-pick storm (hundreds of attempts per second) that exhausted
  // container resources and swept the reply into a human hold. A held bubble
  // is rescheduled with a bounded pause-retry delay instead of spinning; only
  // the transport due_at moves, exactly like the send_failure_retry path.
  const retryDelayMs = finalSenderPauseRetryDelayMs(process.env)
  const rescheduled = {
    ...packet,
    due_at: new Date(Date.now() + retryDelayMs).toISOString()
  }
  durableReplaceJson(lockFile, rescheduled)
  reconcilePublishedQueueMarker(lockFile)
  fs.renameSync(lockFile, original)
  fsyncDirectory(path.dirname(original))
  fsyncDirectory(path.dirname(original))
  console.log(JSON.stringify({
    type: 'outbox_worker_pause_recheck_hold',
    ...logPaths(original),
    ...logIdentity(packet),
    bubble_index: Number(packet?.bubble_index || 0),
    stage,
    sender_reason: safeEnum(senderReason, ''),
    pause_retry_delay_ms: retryDelayMs
  }))
  return original
}

function recoverStaleOutboxLockFile(file, env = process.env, now = Date.now()) {
  if (!file.endsWith('.json.lock')) return null
  const ageMs = fileAgeMs(file, now)
  const thresholdMs = staleLockRecoveryThresholdMs(env)
  if (!Number.isFinite(ageMs) || ageMs < thresholdMs) return null

  const original = file.replace(/\.lock$/, '')
  if (fs.existsSync(original)) {
    if (sameFileIdentity(original, file)) {
      unlinkAndFsync(file)
      return {
        action: 'requeued',
        file,
        original,
        age_ms: ageMs,
        threshold_ms: thresholdMs,
        reason: 'durable_requeue_publish_link_crash_recovered'
      }
    }
    return {
      ...holdOutboxPublicationCollisionForHuman(
        original,
        file,
        'outbox_publication_collision_delivery_state_ambiguous_no_resend'
      ),
      file,
      original,
      age_ms: ageMs,
      threshold_ms: thresholdMs,
      reason: 'outbox_publication_collision_delivery_state_ambiguous_no_resend'
    }
  }

  let packet
  try {
    packet = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    const held = holdCorruptLockForHuman(
      ROOT,
      file,
      'stale_corrupt_outbox_lock_delivery_state_ambiguous_no_resend'
    )
    return {
      ...held,
      file,
      age_ms: ageMs,
      threshold_ms: thresholdMs,
      reason: 'stale_corrupt_outbox_lock_delivery_state_ambiguous_no_resend'
    }
  }

  const transitionVerdict = durableRequeueTransitionVerdict(packet)
  if (transitionVerdict.valid) {
    reconcilePublishedQueueMarker(file)
    publishPreparedOutboxLock(file, original)
    return {
      action: 'requeued',
      file,
      original,
      age_ms: ageMs,
      threshold_ms: thresholdMs,
      reason: transitionVerdict.reason
    }
  }

  const dest = holdStaleOutboxLockForHuman(file, packet, {
    stale_lock_age_ms: ageMs,
    stale_lock_threshold_ms: thresholdMs
  })
  return {
    action: 'human_agent_hold',
    file,
    dest,
    age_ms: ageMs,
    threshold_ms: thresholdMs,
    reason: 'abandoned_outbox_lock_no_blind_resend'
  }
}

function sweepStaleOutboxLockFiles({ env = process.env, now = Date.now() } = {}) {
  ensureDirs()
  const recovered = []
  for (const name of fs.readdirSync(OUTBOX_DIR).filter((entry) => entry.endsWith('.json.lock'))) {
    const file = path.join(OUTBOX_DIR, name)
    const result = recoverStaleOutboxLockFile(file, env, now)
    if (result && result.action !== 'paused') recovered.push(result)
  }
  if (recovered.length) {
    console.log(JSON.stringify({
      type: 'outbox_worker_stale_lock_recovery_batch',
      count: recovered.length,
      recovered_hmac_sha256: artifactSha256(JSON.stringify(recovered))
    }))
  }
  return recovered
}

function parsedPacketTimeMs(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function outboxEntryFromPacket(file, packet) {
  return {
    file,
    due_at_ms: parseDueAt(packet),
    queued_at_ms: parsedPacketTimeMs(packet?.queued_at),
    thread_id: String(packet?.thread_id || packet?.contact_id || ''),
    message_id: String(packet?.message_id || ''),
    bubble_index: Number(packet?.bubble_index || 0)
  }
}

function compareOutboxEntriesForSendOrder(a, b) {
  if (a.due_at_ms !== b.due_at_ms) {
    return a.due_at_ms - b.due_at_ms
  }

  const sameMessage =
    String(a.thread_id || '') === String(b.thread_id || '') &&
    String(a.message_id || '') === String(b.message_id || '') &&
    String(a.message_id || '') !== ''

  if (sameMessage && a.bubble_index !== b.bubble_index) {
    return a.bubble_index - b.bubble_index
  }

  if (a.queued_at_ms !== b.queued_at_ms) {
    return a.queued_at_ms - b.queued_at_ms
  }

  const messageCompare = String(a.message_id || '').localeCompare(String(b.message_id || ''))
  if (messageCompare !== 0) return messageCompare

  if (a.bubble_index !== b.bubble_index) {
    return a.bubble_index - b.bubble_index
  }

  return String(a.file || '').localeCompare(String(b.file || ''))
}

function listFiles({ env = process.env, now = Date.now() } = {}) {
  ensureDirs()
  sweepStaleOutboxLockFiles({ env, now })
  const entries = []

  for (const name of fs.readdirSync(OUTBOX_DIR).filter((entry) => entry.endsWith('.json'))) {
    const file = path.join(OUTBOX_DIR, name)
    try {
      // The recovery-ingress safety verdict runs BEFORE the marker gate: a
      // packet it holds is never a send candidate, and its human hold must
      // preserve the exact reply payload (sealed ingress-time behavior). The
      // marker gate then guards everything that remains send-eligible; a
      // non-adoptable legacy artifact that is NOT held above still cannot
      // reach the network because the gate blocks it here and in handleFile.
      let heldBySafety = false
      try {
        const safetyPacket = JSON.parse(fs.readFileSync(file, 'utf8'))
        const safetyVerdict = outboxRecoverySafetyVerdict(safetyPacket, file, env, now)
        if (safetyVerdict.hold) {
          const dest = holdOutboxBacklogForHuman(file, safetyPacket, safetyVerdict)
          console.log(JSON.stringify({
            type: 'outbox_worker_recovery_human_agent_hold',
            ...logPaths(file, dest),
            ...logIdentity(safetyPacket),
            bubble_index: Number(safetyPacket?.bubble_index || 0),
            reason: safetyVerdict.reason,
            timestamp_source: safetyVerdict.source,
            age_ms: safetyVerdict.age_ms,
            cutover_ms: safetyVerdict.cutover_ms
          }))
          heldBySafety = true
        }
      } catch {}
      if (heldBySafety) continue
      const markerGate = strictQueueMarkerVerdict(file, { repairMissing: true })
      if (!markerGate.ready) {
        const held = markerGate.repaired
          ? ''
          : holdMarkerBlockedQueue(file, markerGate)
        console.log(JSON.stringify({
          type: markerGate.repaired
            ? 'outbox_queue_marker_reconciled_before_claim'
            : 'outbox_queue_marker_gate_blocked',
          ...logPaths(file, held || markerGate.marker),
          ...logIdentity(markerGate.packet),
          reason: markerGate.reason
        }))
        continue
      }
      const packet = JSON.parse(fs.readFileSync(file, 'utf8'))
      const verdict = outboxRecoverySafetyVerdict(packet, file, env, now)
      if (verdict.hold) {
        const dest = holdOutboxBacklogForHuman(file, packet, verdict)
        console.log(JSON.stringify({
          type: 'outbox_worker_recovery_human_agent_hold',
          ...logPaths(file, dest),
          ...logIdentity(packet),
          bubble_index: Number(packet?.bubble_index || 0),
          reason: verdict.reason,
          timestamp_source: verdict.source,
          age_ms: verdict.age_ms,
          cutover_ms: verdict.cutover_ms
        }))
        continue
      }

      // Live-surgery pause: hold queued bubbles in place.
      if (isPausedForPacket(packet, env)) continue
      entries.push(outboxEntryFromPacket(file, packet))
    } catch {
      // Corrupt queue entries are recovery work, not lowest-priority work. Put
      // them first so a busy valid queue cannot starve quarantine/restoration.
      entries.push({ file, due_at_ms: Number.NEGATIVE_INFINITY })
    }
  }

  return entries.sort(compareOutboxEntriesForSendOrder)
}

async function sendTo3102(packet) {
  const resp = await fetch(OUTBOUND2_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: packet.source,
        authority: packet.authority,
        control_receipt: packet.control_receipt,
        contact_id: String(packet.contact_id),
        thread_id: String(packet.thread_id || packet.contact_id),
        instagram_username: String(packet.instagram_username || ''),
        message_id: String(packet.message_id || Date.now()),
        bubble_index: Number(packet.bubble_index || 0),
        bubble: packet.bubble,
        bubbles: packet.bubbles,
        source_interaction_at: packet.source_interaction_at,
        recovered_from_ig_last_interaction: packet.recovered_from_ig_last_interaction,
        manychat_latest_interaction_at: packet.manychat_latest_interaction_at,
        recovered_from_at: packet.recovered_from_at,
        received_at: packet.received_at,
        at: packet.at,
        created_at: packet.created_at
      }),
    signal: AbortSignal.timeout(FINAL_SENDER_TIMEOUT_MS)
  })

  const text = await resp.text()
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

function nextRetryDelayMs(attempts) {
  const n = Math.max(1, Number(attempts) || 1)
  const exp = Math.min(RETRY_BASE_MS * (2 ** (n - 1)), RETRY_MAX_MS)
  const jitter = Math.floor(Math.random() * 5000)
  return Math.min(exp + jitter, RETRY_MAX_MS)
}

function classifySendFailure(errorText) {
  const text = String(errorText || '').toLowerCase()

  if (
    text.includes('3102_send_failed_400') ||
    text.includes('3102_send_failed_401') ||
    text.includes('3102_send_failed_403') ||
    text.includes('3102_send_failed_404') ||
    text.includes('3102_send_failed_500') ||
    text.includes('non_authoritative') ||
    text.includes('validation error')
  ) {
    return 'internal_control'
  }

  if (
    text.includes('fetch failed') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('timeout') ||
    text.includes('network') ||
    text.includes('socket hang up') ||
    text.includes('temporar') ||
    text.includes('overloaded') ||
    text.includes('rate limit') ||
    text.includes('3102_send_failed_429') ||
    text.includes('high demand') ||
    text.includes('reconnecting') ||
    text.includes('3102_send_failed_502') ||
    text.includes('3102_send_failed_503') ||
    text.includes('3102_send_failed_504')
  ) {
    return 'transient'
  }

  if (
    text.includes('subscriber_id cannot be blank') ||
    text.includes('missing_or_invalid_codex_authority')
  ) {
    return 'permanent'
  }

  return 'unknown'
}

function shouldFailClosedWithoutRetry(result) {
  const body = result?.body?.result?.body
  const manychatStatus = Number(body?.manychat_status || 0)
  const manychatSuccess = String(body?.manychat_body?.status || '').toLowerCase() === 'success'
  return manychatStatus === 200 && manychatSuccess
}

function isSendAccepted(result) {
  const body = result?.body?.result?.body
  return (
    result.http_status === 200 &&
    result.body &&
    result.body.ok === true &&
    result.body.result &&
    result.body.result.status === 200 &&
    body &&
    body.status === 'success' &&
    (body.delivery_confirmed === true || body.delivery_accepted === true)
  )
}

function requiresHumanAgent(result) {
  const body = result?.body?.result?.body
  return !!body?.requires_human_agent
}

function isFinalSenderPause(result) {
  return Number(result?.http_status || 0) === 423 &&
    result?.body?.held === true &&
    result?.body?.retryable === false
}

function isDeliveryOutcomeAmbiguous(result) {
  const body = result?.body?.result?.body
  const finalSenderStatus = Number(result?.http_status || 0)
  return body?.delivery_outcome_ambiguous === true ||
    body?.do_not_retry === true ||
    finalSenderStatus === 408 ||
    finalSenderStatus >= 500 ||
    (finalSenderStatus >= 200 && finalSenderStatus < 300 && !isSendAccepted(result))
}

function transportAttemptIsAmbiguous(requestStarted, responseReceived) {
  return requestStarted === true && responseReceived !== true
}

function acceptedDeliveryStatus(result) {
  const body = result?.body?.result?.body
  if (body?.delivery_confirmed === true) return 'success_visible'
  if (body?.delivery_accepted === true) return 'manychat_accepted_unverified'
  return 'success'
}

function terminalNoResendReason(result) {
  if (isSendAccepted(result)) return 'provider_delivery_accepted'
  if (isDeliveryOutcomeAmbiguous(result)) return 'provider_delivery_outcome_ambiguous'
  if (requiresHumanAgent(result)) return 'provider_window_requires_human_agent'
  if (shouldFailClosedWithoutRetry(result)) return 'provider_success_unverified_fail_closed'
  return ''
}

async function handleFile(file) {
  ensureDirs()
  const markerGate = strictQueueMarkerVerdict(file, { repairMissing: true })
  if (!markerGate.ready) {
    const held = markerGate.repaired
      ? ''
      : holdMarkerBlockedQueue(file, markerGate)
    console.log(JSON.stringify({
      type: markerGate.repaired
        ? 'outbox_queue_marker_reconciled_before_claim'
        : 'outbox_queue_marker_gate_blocked',
      ...logPaths(file, held || markerGate.marker),
      ...logIdentity(markerGate.packet),
      reason: markerGate.reason
    }))
    return
  }
  const lock = acquireOutboxLock(file)
  const claimedMarkerGate = strictQueueMarkerVerdict(lock)
  if (!claimedMarkerGate.ready) {
    const held = holdMarkerBlockedQueue(lock, claimedMarkerGate)
    console.log(JSON.stringify({
      type: 'outbox_claimed_lock_marker_gate_blocked',
      ...logPaths(lock, held),
      ...logIdentity(claimedMarkerGate.packet),
      reason: claimedMarkerGate.reason
    }))
    return
  }
  let networkAttemptStarted = false
  let networkResponseReceived = false
  let terminalOutcomeReason = ''
  let terminalResult = null
  let transportAttemptStart = null
  let transportAttemptCompletionRecorded = false
  let deliveryPublication = null

  try {
    let packet
    try {
      packet = JSON.parse(fs.readFileSync(lock, 'utf8'))
    } catch (parseError) {
      const recovery = recoverCorruptLockFromMarker({
        root: ROOT,
        lockFile: lock,
        preNetworkConfirmed: true
      })
      if (!recovery.recovered) {
        const held = holdCorruptLockForHuman(
          ROOT,
          lock,
          `corrupt_outbox_lock_unrecoverable_before_network:${recovery.reason}`
        )
        console.log(JSON.stringify({
          type: 'worker_corrupt_lock_human_hold',
          ...logPaths(lock, held?.hold?.file),
          reason: 'corrupt_outbox_lock_unrecoverable_before_network'
        }))
        return
      }
      packet = recovery.packet
      console.log(JSON.stringify({
        type: 'worker_corrupt_lock_restored_from_durable_marker',
        ...logPaths(lock, recovery.marker),
        ...logIdentity(packet),
        bubble_index: Number(packet?.bubble_index || 0),
        reason: recovery.reason
      }))
    }

    if (!hasValidAuthority(packet)) {
      const repair = repairTransportPacketFromDecisionArtifact(ROOT, packet)
      if (repair.repaired) {
        packet = repair.packet
        durableReplaceJson(lock, packet)
        console.log(JSON.stringify({
          type: 'worker_controller_payload_restored_from_artifact',
          ...logPaths(lock, repair.artifact_file),
          ...logIdentity(packet),
          bubble_index: Number(packet.bubble_index || 0),
          artifact_restored: true
        }))
      }
    }

    if (!hasValidAuthority(packet)) {
      quarantineNonAuthoritative(lock, packet, 'missing_or_invalid_codex_authority_and_unrecoverable_artifact')

      console.log(JSON.stringify({
        type: 'worker_skip_non_authoritative',
        ...logPaths(lock),
        ...logIdentity(packet),
        source: String(packet.source || ''),
        reason: 'missing_or_invalid_codex_authority_and_unrecoverable_artifact'
      }))
      return
    }

    // Keep a prior definitive/pre-network retry proof until the next attempt
    // start is both in the lock and in the fsynced transport ledger. If the
    // process dies before that boundary, stale recovery may safely requeue it;
    // after a newer start record exists, the transition verifier rejects it
    // and fails closed against a duplicate send.
    invokeOutboxHarnessHook('after_authority_before_pre_network_gates', { lock })

    if (rearmDelayHardGateIfNeeded(lock, packet)) return

    let outboundHarnessVerdict
    try {
      outboundHarnessVerdict = evaluateScvOutboundBubbleHarness(packet)
    } catch (err) {
      outboundHarnessVerdict = { valid: false, reason: `post_adoption_audit_error:${String(err?.message || err)}` }
    }
    if (!outboundHarnessVerdict.valid) {
      // The controller already adopted and payload-bound the full semantic packet.
      // Transport may audit a per-bubble disagreement, but it may not silently
      // override controller authority or discard an adopted reply.
      console.log(JSON.stringify({
        type: 'worker_post_adoption_semantic_audit_disagreement',
        ...logPaths(lock),
        ...logIdentity(packet),
        ...textMetrics(packet?.bubble?.text, 'sent_text'),
        reason: safeEnum(outboundHarnessVerdict.reason, 'semantic_audit_disagreement'),
        lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION,
        action: 'controller_adoption_preserved'
      }))
    }

    const suppression = await getAutomationSuppression(packet)
    if (suppression.suppressed) {
      recordLearningOutcome(packet, 'suppressed')
      quarantineStale(lock, packet, `automation_suppressed_tag:${suppression.matched_tag || 'flag'}`)

      console.log(JSON.stringify({
        type: 'worker_skip_suppressed',
        ...logPaths(lock),
        ...logIdentity(packet),
        matched_tag_hmac_sha256: artifactSha256(suppression.matched_tag),
        reason: safeEnum(suppression.reason, 'suppressed_tag')
      }))
      return
    }

    const staleBeforeWait = isStaleAgainstLatestInbound(packet)
    if (staleBeforeWait) {
      recordLearningOutcome(packet, 'stale')
      const latest = readLatestThreadState(packet.thread_id || packet.contact_id)
      quarantineStale(lock, packet, 'newer_inbound_exists_for_thread')

      console.log(JSON.stringify({
        type: 'worker_skip_stale',
        ...logPaths(lock),
        ...logIdentity(packet),
        latest_message_hmac_sha256: artifactSha256(latest?.message_id),
        reason: 'newer_inbound_exists_for_thread'
      }))
      return
    }

    const waitMs = Math.max(0, parseDueAt(packet) - Date.now())

    if (waitMs > 0) {
      await sleep(waitMs)
    }

    if (rearmDelayHardGateIfNeeded(lock, packet)) return

    console.log(JSON.stringify({
      type: 'worker_send_due_gate_passed',
      ...logPaths(lock),
      ...logIdentity(packet),
      bubble_index: Number(packet.bubble_index || 0),
      fast_delay_target: packet.fast_delay_target === true,
      queued_at: String(packet.queued_at || ''),
      due_at: String(packet.due_at || ''),
      delivery_pacing_lock_version: SCV_DELIVERY_PACING_LOCK_VERSION
    }))

    const suppressionAfterWait = await getAutomationSuppression(packet)
    if (suppressionAfterWait.suppressed) {
      recordLearningOutcome(packet, 'suppressed')
      quarantineStale(lock, packet, `automation_suppressed_tag_after_wait:${suppressionAfterWait.matched_tag || 'flag'}`)

      console.log(JSON.stringify({
        type: 'worker_skip_suppressed',
        ...logPaths(lock),
        ...logIdentity(packet),
        matched_tag_hmac_sha256: artifactSha256(suppressionAfterWait.matched_tag),
        reason: safeEnum(suppressionAfterWait.reason, 'suppressed_tag_after_wait')
      }))
      return
    }

    const staleAfterWait = isStaleAgainstLatestInbound(packet)
    if (staleAfterWait) {
      recordLearningOutcome(packet, 'stale')
      const latest = readLatestThreadState(packet.thread_id || packet.contact_id)
      quarantineStale(lock, packet, 'newer_inbound_exists_for_thread_after_wait')

      console.log(JSON.stringify({
        type: 'worker_skip_stale',
        ...logPaths(lock),
        ...logIdentity(packet),
        latest_message_hmac_sha256: artifactSha256(latest?.message_id),
        reason: 'newer_inbound_exists_for_thread_after_wait'
      }))
      return
    }

    // The packet can cross the stale threshold or an operator can pause the
    // system while pacing/suppression checks are in flight. These are the last
    // gates before the network side effect; neither atomic handoff nor a debug
    // allowlist may bypass recovery age/cutover safety.
    const finalRecoveryVerdict = outboxRecoverySafetyVerdict(packet, lock, process.env, Date.now())
    if (finalRecoveryVerdict.hold) {
      const dest = holdOutboxBacklogForHuman(lock, packet, finalRecoveryVerdict, {
        hold_stage: 'final_outbound_recheck'
      })
      console.log(JSON.stringify({
        type: 'outbox_worker_final_recovery_human_agent_hold',
        ...logPaths(lock, dest),
        ...logIdentity(packet),
        bubble_index: Number(packet?.bubble_index || 0),
        reason: finalRecoveryVerdict.reason,
        timestamp_source: finalRecoveryVerdict.source
      }))
      return
    }

    if (isPausedForPacket(packet, process.env)) {
      releaseOutboxLockForPause(lock, packet)
      return
    }

    const preNetworkPublicationRecovery = recoverPreNetworkDeliveryPublication(ROOT, packet)
    if (preNetworkPublicationRecovery.ambiguous) {
      quarantineHumanAgentRequired(lock, packet, {
        publication_recovery_reason: preNetworkPublicationRecovery.reason
      }, 'delivery_publication_transport_attempt_ambiguous_no_resend')
      return
    }
    deliveryPublication = beginAcceptedUnverifiedDeliveryPublication(ROOT, packet)
    transportAttemptStart = createTransportAttemptStart(packet)
    packet.transport_attempt_started_at = transportAttemptStart.started_at_utc
    packet.transport_attempt_id = transportAttemptStart.attempt_id
    durableReplaceJson(lock, packet)
    // The start record is durable before the network side effect. If the process
    // dies after this fsync, continuity sees an incomplete attempt and fails
    // closed instead of silently treating the window as failure-free.
    appendTransportAttemptRecord(transportAttemptStart)
    networkAttemptStarted = true
    const result = await sendTo3102(packet)
    networkResponseReceived = true
    packet.transport_response_received_at = new Date().toISOString()
    const ok = isSendAccepted(result)
    terminalOutcomeReason = terminalNoResendReason(result)
    terminalResult = result

    // Lock a provider-terminal outcome before secondary state/history/receipt
    // writes. A crash or local disk failure after this point must never turn an
    // already accepted or uncertain delivery back into an active outbox item.
    if (terminalOutcomeReason) {
      packet.transport_terminal_no_resend = true
      packet.transport_terminal_outcome = terminalOutcomeReason
      packet.transport_response_received_at = new Date().toISOString()
      packet.transport_http_status = Number(result?.http_status || 0)
      durableReplaceJson(lock, packet)
    }

    appendTransportAttemptRecord(createTransportAttemptCompletion(
      transportAttemptStart, packet, { result }
    ))
    transportAttemptCompletionRecorded = true

    // Persist the exact provider bytes only after the accepted outcome is
    // terminally locked. If this private evidence write fails, the catch path
    // moves the packet to a no-resend reconciliation hold.
    const providerResponseEvidence = ok
      ? persistAcceptedProviderResponse(packet, result)
      : null

    // Harness-only forced interleaving point. Production has no hook object;
    // the durable publication already exists when a provider-accepted response
    // reaches this boundary and receipt/history bookkeeping has not started.
    if (ok && typeof outboxHarnessHooks?.after_provider_accepted_before_bookkeeping === 'function') {
      await outboxHarnessHooks.after_provider_accepted_before_bookkeeping({
        packet: { ...packet, bubble: { ...(packet?.bubble || {}) } }
      })
    }

    console.log(JSON.stringify({
      type: 'worker_result',
      ok,
      ...logPaths(lock),
      ...logIdentity(packet),
      ...textMetrics(packet?.bubble?.text, 'sent_text'),
      ...finalSenderResultMetrics(result)
    }))

    if (!ok) {
      if (!isDeliveryOutcomeAmbiguous(result) && deliveryPublication) {
        clearAcceptedUnverifiedDeliveryPublication(ROOT, packet, deliveryPublication.publication_id)
        deliveryPublication = null
      }
      if (isFinalSenderPause(result)) {
        releaseOutboxLockForPause(
          lock, packet, 'final_sender_pause_gate',
          String(result?.body?.reason || '')
        )
        return
      }

      if (isDeliveryOutcomeAmbiguous(result)) {
        appendThreadHistoryEventWithRole(packet, 'assistant_attempted', {
          delivery_status: 'provider_delivery_outcome_ambiguous'
        })
        recordLearningOutcome(packet, 'manual_reconciliation_required')
        quarantineHumanAgentRequired(lock, {
          ...packet,
          attempts: Number(packet.attempts || 0) + 1
        }, result, 'provider_delivery_outcome_ambiguous_no_resend')
        console.log(JSON.stringify({
          type: 'worker_delivery_outcome_ambiguous_hold',
          ...logPaths(lock),
          ...logIdentity(packet),
          reason: 'provider_delivery_outcome_ambiguous_no_resend'
        }))
        return
      }

      if (requiresHumanAgent(result)) {
        appendThreadHistoryEventWithRole(packet, 'assistant_human_agent_required', {
          delivery_status: 'manychat_24h_window_requires_human_agent'
        })
        recordLearningOutcome(packet, 'human_agent_required')
        quarantineHumanAgentRequired(lock, packet, result)

        console.log(JSON.stringify({
          type: 'worker_human_agent_required',
          ...logPaths(lock),
          ...logIdentity(packet),
          ...textMetrics(packet?.bubble?.text, 'sent_text'),
          reason: 'manychat_24h_window_requires_human_agent'
        }))
        return
      }

      if (shouldFailClosedWithoutRetry(result)) {
        appendThreadHistoryEventWithRole(packet, 'assistant_attempted', {
          delivery_status: 'manychat_success_fail_closed'
        })
        recordLearningOutcome(packet, 'fail_closed_unverified')
        quarantineFailed(lock, {
          ...packet,
          attempts: Number(packet.attempts || 0) + 1,
          last_error: 'manychat_success_but_unverified_fail_closed',
          last_result: result
        }, 'manychat_success_unverified_fail_closed')

        console.log(JSON.stringify({
          type: 'worker_fail_closed_unverified',
          ...logPaths(lock),
          ...logIdentity(packet),
          ...textMetrics(packet?.bubble?.text, 'sent_text'),
          reason: 'manychat_success_unverified_fail_closed'
        }))
        return
      }

      throw new Error(`3102_send_failed_${result.body?.result?.status || result.http_status}`)
    }

    const deliveryStatus = acceptedDeliveryStatus(result)
    recordLearningOutcome(packet, deliveryStatus)
    if (deliveryStatus === 'manychat_accepted_unverified') {
      appendAcceptedUnverifiedDeliveryEvidence(ROOT, packet, {
        at: String(packet.transport_response_received_at || new Date().toISOString()),
        delivery_status: deliveryStatus,
        delivery_publication_id: String(deliveryPublication?.publication_id || '')
      }, () => recordDeliveryReceipt(packet, result, deliveryStatus, providerResponseEvidence))
      deliveryPublication = null
    } else {
      appendConfirmedDeliveryEvidence(ROOT, packet, {
        at: String(packet.transport_response_received_at || new Date().toISOString()),
        delivery_status: deliveryStatus,
        delivery_publication_id: String(deliveryPublication?.publication_id || '')
      }, () => recordDeliveryReceipt(packet, result, deliveryStatus, providerResponseEvidence))
      deliveryPublication = null
    }
    unlinkAndFsync(lock)
  } catch (err) {
    try {
      const packet = JSON.parse(fs.readFileSync(lock, 'utf8'))
      if (deliveryPublication && !networkAttemptStarted) {
        try {
          clearAcceptedUnverifiedDeliveryPublication(ROOT, packet, deliveryPublication.publication_id)
          deliveryPublication = null
        } catch {}
      }
      if (terminalOutcomeReason) {
        const attempts = Number(packet.attempts || 0) + 1
        const errorText = String(err && err.message ? err.message : err)
        // Move the terminal packet first. History and adaptive-learning writes
        // are best-effort because either may be the bookkeeping operation that
        // failed. If even the hold write fails, the .lock remains and startup
        // recovery moves it to a no-resend human hold.
        quarantineHumanAgentRequired(lock, {
          ...packet,
          attempts,
          transport_terminal_no_resend: true,
          transport_terminal_outcome: terminalOutcomeReason,
          terminal_bookkeeping_error: errorText
        }, terminalResult || { transport_error: errorText }, 'post_terminal_bookkeeping_failed_no_resend')
        try {
          appendThreadHistoryEventWithRole(packet, 'assistant_attempted', {
            delivery_status: 'post_terminal_bookkeeping_failed_no_resend'
          })
        } catch {}
        try { recordLearningOutcome(packet, 'manual_reconciliation_required') } catch {}
        console.log(JSON.stringify({
          type: 'worker_post_terminal_bookkeeping_failure_hold',
          ...logPaths(lock),
          reason: 'post_terminal_bookkeeping_failed_no_resend',
          terminal_outcome: terminalOutcomeReason
        }))
        return
      }
      if (transportAttemptIsAmbiguous(networkAttemptStarted, networkResponseReceived)) {
        if (transportAttemptStart && !transportAttemptCompletionRecorded) {
          appendTransportAttemptRecord(createTransportAttemptCompletion(
            transportAttemptStart, packet, { error: err }
          ))
          transportAttemptCompletionRecorded = true
        }
        const attempts = Number(packet.attempts || 0) + 1
        const errorText = String(err && err.message ? err.message : err)
        appendThreadHistoryEventWithRole(packet, 'assistant_attempted', {
          delivery_status: 'final_sender_response_ambiguous'
        })
        recordLearningOutcome(packet, 'manual_reconciliation_required')
        quarantineHumanAgentRequired(lock, {
          ...packet,
          attempts,
          last_error: errorText
        }, { transport_error: errorText }, 'final_sender_response_ambiguous_no_resend')
        console.log(JSON.stringify({
          type: 'worker_final_sender_response_ambiguous_hold',
          ...logPaths(lock),
          ...logIdentity(packet),
          reason: 'final_sender_response_ambiguous_no_resend'
        }))
        return
      }
      if (
        networkAttemptStarted && networkResponseReceived && transportAttemptStart &&
        !transportAttemptCompletionRecorded
      ) {
        try {
          appendTransportAttemptRecord(createTransportAttemptCompletion(
            transportAttemptStart, packet, { result: terminalResult }
          ))
          transportAttemptCompletionRecorded = true
        } catch (completionError) {
          const attempts = Number(packet.attempts || 0) + 1
          const hold = quarantineHumanAgentRequired(lock, {
            ...packet,
            attempts,
            transport_terminal_no_resend: true,
            terminal_bookkeeping_error: String(completionError?.message || completionError)
          }, { transport_error: String(err?.message || err) },
          'transport_attempt_completion_persistence_failed_no_resend')
          console.log(JSON.stringify({
            type: 'worker_transport_completion_persistence_failure_hold',
            ...logPaths(lock, hold),
            ...logIdentity(packet),
            reason: 'transport_attempt_completion_persistence_failed_no_resend'
          }))
          return
        }
      }
      const classification = classifySendFailure(err && err.message ? err.message : err)
      const attempts = Number(packet.attempts || 0) + 1
      const errorText = String(err && err.message ? err.message : err)
      const failClosedAllSendFailures = loadEnvFlag('SCV_FAIL_CLOSED_SEND_FAILURES', false)
      // A temporary provider/transport failure must not consume a controller-
      // adopted reply after only two attempts. Match the durable outbox budget.
      const transientMaxRetries = Math.max(1, loadEnvNumber('SCV_TRANSIENT_SEND_MAX_RETRIES', MAX_RETRIES))
      const persistentInternal = classification === 'internal_control' || classification === 'unknown'
      const internalMaxRetries = Math.max(
        1,
        loadEnvNumber('SCV_INTERNAL_SEND_MAX_RETRIES', INTERNAL_SEND_MAX_RETRIES)
      )
      const maxRetriesForFailure = classification === 'transient'
        ? transientMaxRetries
        : (persistentInternal ? internalMaxRetries : MAX_RETRIES)
      const failClosedThisFailure = failClosedAllSendFailures && classification !== 'transient' && !persistentInternal

      if (failClosedThisFailure || classification === 'permanent' || attempts >= maxRetriesForFailure) {
        const manualReason = failClosedThisFailure
          ? 'send_failure_fail_closed_operator_alert'
          : classification === 'permanent'
            ? 'permanent_send_failure_operator_alert'
            : persistentInternal
              ? 'persistent_internal_send_failure_max_retries_operator_alert'
              : 'send_failure_max_retries_operator_alert'
        const hold = quarantineHumanAgentRequired(lock, {
          ...packet,
          attempts,
          last_error: errorText
        }, { transport_error: errorText }, manualReason)
        try {
          appendThreadHistoryEventWithRole(packet, 'assistant_attempted', {
            delivery_status: 'send_failed_operator_alert'
          })
        } catch {}
        try { recordLearningOutcome(packet, 'manual_reconciliation_required') } catch {}
        console.log(JSON.stringify({
          type: 'worker_send_failure_operator_alert',
          ...logPaths(lock, hold),
          ...logIdentity(packet),
          attempts,
          failure_class: classification,
          reason: manualReason
        }))
        return
      } else {
        packet.attempts = attempts
        packet.last_error = errorText
        packet.last_error_kind = persistentInternal
          ? 'persistent_internal_send_control'
          : (classification === 'transient' ? 'transient_send_failure' : 'unknown_send_failure')
        packet.due_at = new Date(Date.now() + nextRetryDelayMs(attempts)).toISOString()
        durableRequeueFromLock(lock, packet, {
          reason: 'send_failure_retry',
          networkDisposition: networkAttemptStarted
            ? 'definitive_failure_response'
            : 'pre_network',
          failureClass: classification,
          transportAttemptId: networkAttemptStarted
            ? String(packet.transport_attempt_id || '')
            : ''
        })
        try { recordLearningOutcome(packet, 'send_failure') } catch {}
      }
    } catch {}

    console.log(JSON.stringify({
      type: 'worker_error',
      ...logPaths(lock),
      ...errorMetrics(err)
    }))
  }
}

async function loop() {
  ensureDirs()
  while (true) {
    try {
      const files = listFiles()
      if (files.length > 0) {
        const next = files[0]
        const waitMs = Math.max(0, next.due_at_ms - Date.now())

        if (waitMs > 0) {
          await sleep(Math.min(waitMs, EMPTY_POLL_MS))
          continue
        }

        await handleFile(next.file)
      } else {
        await sleep(EMPTY_POLL_MS)
      }
    } catch (err) {
      console.log(JSON.stringify({
        type: 'loop_error',
        ...errorMetrics(err)
      }))
      await sleep(1000)
    }
  }
}

if (require.main === module) {
  loop()
}

module.exports = {
  OUTBOX_SEND_ORDER_LOCK_VERSION,
  TRANSPORT_ATTEMPT_LEDGER_FILE,
  TRANSPORT_ATTEMPT_LEDGER_SCHEMA,
  PROVIDER_RESPONSE_DIR,
  MAX_PROVIDER_RESPONSE_BYTES,
  privateTransportAttemptLedgerDirectory,
  extractManyChatProviderReceipt,
  decodeCanonicalProviderResponse,
  appendTransportAttemptRecord,
  createTransportAttemptStart,
  createTransportAttemptCompletion,
  transportAttemptResultOutcome,
  persistAcceptedProviderResponse,
  recordDeliveryReceipt,
  visibilityReceiptFields,
  finalSenderResultMetrics,
  acceptedDeliveryStatus,
  compareOutboxEntriesForSendOrder,
  outboxEntryFromPacket,
  isAtomicDepositHandoffPacket,
  shouldBypassStaleForAtomicDepositHandoff,
  hasValidAuthority,
  classifySendFailure,
  isFinalSenderPause,
  isDeliveryOutcomeAmbiguous,
  transportAttemptIsAmbiguous,
  terminalNoResendReason,
  listFiles,
  staleLockRecoveryThresholdMs,
  staleOutboxHoldThresholdMs,
  outboxRecoverySafetyVerdict,
  recoverStaleOutboxLockFile,
  sweepStaleOutboxLockFiles,
  holdStaleOutboxLockForHuman,
  holdOutboxBacklogForHuman,
  releaseOutboxLockForPause,
  pendingOutboundDuplicate,
  strictQueueMarkerVerdict,
  reconcilePublishedQueueMarker,
  setOutboxHarnessHooks,
  handleFile
}
