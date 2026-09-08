#!/usr/bin/env node
// Persistent production fail-close latch for the immutable golden release.
//
// The latch lives on the namespaced Railway volume, not in the deployment
// filesystem. A failed synthetic check therefore survives process restarts and
// holds every outbound path until an explicitly approved operator clear.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  runtimeNamespaceFromEnv,
  namespacedPersistRoot
} = require(path.join(__dirname, 'scv-runtime-namespace.js'))

const SCV_GOLDEN_FAIL_CLOSE_VERSION = 'scv-golden-fail-close-2026-07-25-v2'
const LATCH_FILE = 'scv-golden-synthetic-fail-closed.json'
const ALERT_CLAIM_FILE = 'scv-golden-synthetic-alert-claimed'
const ACTIVATION_CLAIM_FILE = 'scv-golden-synthetic-activation-claimed'
const DEFAULT_ALERT_LEASE_MS = 5 * 60 * 1000
const KNOWN_FALSE_POSITIVE_INCIDENT = Object.freeze({
  release_id: 'scv-instagram-single-20260831-v124',
  release_fingerprint_sha256: 'fd4e7d064e68b27125c2530d9e369080feb0a4ca89db20c47e2f09689fb0da66',
  activated_at_utc: '2026-09-01T02:15:37.250Z',
  reason: 'critical_drift_detected',
  failed_check: 'repeated_form_link_permission_offer_visible_history',
  fixed_hard_harness_lock_version: 'scv-hard-harness-lock-2026-09-01-v153-date-change-history'
})
const KNOWN_INTENTIONAL_HOLD_QUEUE_FALSE_POSITIVE_INCIDENT = Object.freeze({
  release_id: 'scv-instagram-single-20260901-v130',
  release_fingerprint_sha256: '21fd9e5f430e54236d00495b823686b9a0a042944d86211b6e701d5aee852b59',
  activated_at_utc: '2026-09-01T19:00:45.401Z',
  reason: 'critical_drift_detected',
  failed_check: 'queue_file_stale',
  replacement_release_id: 'scv-instagram-single-20260901-v132',
  fixed_drift_schema: 'scv-drift-status-2026-09-01-v4-causal-queue-hold',
  fixed_hard_harness_lock_version: 'scv-hard-harness-lock-2026-09-01-v155-checkpoint-divergence'
})

// 2026-09-02 live red-team of v139 on the code-locked debug identity: two
// consecutive identical generic recovery lines (no rotation) tripped the
// duplicate-visible-text critical check. The visible history was purged by a
// receipted Omar.system reset and every later release rotates recovery lines.
// This is a true positive with a purged cause, not a false positive; the latch
// may be archived only when the replacement release, the repaired hard harness,
// the fixed recovery version, a fresh zero-critical drift result, and a
// post-latch purge receipt for that exact debug thread all match. The owner
// directed this incident-scoped repair on 2026-09-02; any other latch still
// requires the Ben-signed approval receipt.
const KNOWN_DUPLICATE_RECOVERY_TEXT_INCIDENT = Object.freeze({
  release_id: 'scv-instagram-single-20260902-v139',
  release_fingerprint_sha256: '01d8485f4848d4fb967137d1eb13b90814feabab7c5eec633a9f2f0f932f9855',
  activated_at_utc: '2026-09-02T20:33:05.238Z',
  reason: 'critical_drift_detected',
  failed_check: 'duplicate_assistant_text_visible_history',
  affected_contact_id: '1537753982',
  replacement_release_id: 'scv-instagram-single-20260902-v141',
  fixed_drift_schema: 'scv-drift-status-2026-09-01-v4-causal-queue-hold',
  fixed_hard_harness_lock_version: 'scv-hard-harness-lock-2026-09-02-v158-duplicate-recovery-text-reconciliation',
  fixed_recovery_version: 'scv-route-aware-visible-recovery-2026-09-02-v5-checkpoint-revision-ask-no-template',
  purge_receipt_schema_prefix: 'scv-paused-worker-barrier-omar-system-purge-2026-09-01-v5-'
})

const INTENTIONAL_HOLD_EVIDENCE_DIR = 'outbox_human_agent_required'
const MAX_INTENTIONAL_HOLD_EVIDENCE_FILES = 10000
const MAX_INTENTIONAL_HOLD_EVIDENCE_BYTES = 2 * 1024 * 1024

function isProductionEnv(env = process.env) {
  return String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production' ||
    String(env.SCV_RELEASE_MODE || '').trim().toLowerCase() === 'production'
}

function latchDirectory({ env = process.env, root = env.SCV_ROOT || __dirname } = {}) {
  const persistRoot = String(env.SCV_PERSIST_ROOT || env.RAILWAY_VOLUME_MOUNT_PATH || '').trim()
  if (isProductionEnv(env)) {
    if (!persistRoot) throw new Error('production_persistent_control_root_missing')
    if (!path.isAbsolute(persistRoot)) {
      throw new Error(`production_persistent_control_root_not_absolute:${persistRoot}`)
    }
    if (!fs.existsSync(persistRoot) || !fs.statSync(persistRoot).isDirectory()) {
      throw new Error(`production_persistent_control_root_unavailable:${persistRoot}`)
    }
  }
  if (persistRoot && fs.existsSync(persistRoot) && fs.statSync(persistRoot).isDirectory()) {
    return path.join(
      namespacedPersistRoot(persistRoot, runtimeNamespaceFromEnv(env)),
      'control-locks'
    )
  }
  return path.join(root, 'control-locks')
}

function latchPath(options = {}) {
  return path.join(latchDirectory(options), LATCH_FILE)
}

function alertClaimPath(options = {}) {
  return path.join(latchDirectory(options), ALERT_CLAIM_FILE)
}

function activationClaimPath(options = {}) {
  return path.join(latchDirectory(options), ACTIVATION_CLAIM_FILE)
}

function safeDetail(value, depth = 0) {
  if (depth > 4) return '[depth-limited]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 1000)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => safeDetail(entry, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
      if (/password|token|secret|api.?key|authorization/i.test(key)) out[key] = '[REDACTED]'
      else out[key] = safeDetail(entry, depth + 1)
    }
    return out
  }
  return String(value).slice(0, 1000)
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const nonce = crypto.randomBytes(8).toString('hex')
  const temp = `${file}.${process.pid}.${nonce}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temp, file)
}

function readFailClose(options = {}) {
  const file = latchPath(options)
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!state || state.active !== true) {
      return { active: false, file, reason: 'inactive_or_invalid_latch' }
    }
    return { ...state, active: true, file }
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      const activationFile = activationClaimPath(options)
      if (isProductionEnv(options.env || process.env) && fs.existsSync(activationFile)) {
        let activationState = {}
        try {
          activationState = JSON.parse(fs.readFileSync(activationFile, 'utf8'))
        } catch {}
        return {
          ...activationState,
          active: true,
          file,
          reason: 'activation_claim_without_latch',
          activation_claim_file: activationFile
        }
      }
      return { active: false, file, reason: 'latch_absent' }
    }
    // A corrupt or unreadable safety latch is itself a fail-close condition in
    // production. Never silently treat unknown latch state as healthy.
    return {
      active: isProductionEnv(options.env || process.env),
      file,
      reason: 'latch_read_error',
      error: String(error && error.message ? error.message : error).slice(0, 300)
    }
  }
}

function isFailClosed(options = {}) {
  return readFailClose(options).active === true
}

function activateFailClose({
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  releaseId = '',
  releaseFingerprint = '',
  reason = 'synthetic_check_failed',
  failedChecks = [],
  detail = {}
} = {}) {
  const options = { env, root }
  const existing = readFailClose(options)
  if (existing.active) return { created: false, state: existing }

  fs.mkdirSync(latchDirectory(options), { recursive: true })
  const now = new Date().toISOString()
  const state = {
    schema: SCV_GOLDEN_FAIL_CLOSE_VERSION,
    active: true,
    activated_at_utc: now,
    release_id: String(releaseId || ''),
    release_fingerprint_sha256: String(releaseFingerprint || ''),
    reason: String(reason || 'synthetic_check_failed').slice(0, 200),
    failed_checks: Array.from(new Set((Array.isArray(failedChecks) ? failedChecks : [])
      .map((entry) => String(entry || '').slice(0, 160))
      .filter(Boolean))),
    detail: safeDetail(detail),
    response_policy: 'hold_all_new_automatic_replies_preserve_current_golden_release',
    alert: {
      attempted_at_utc: '',
      delivered_at_utc: '',
      channel: '',
      delivery_status: 'not_attempted'
    }
  }
  const activationFile = activationClaimPath(options)
  let activationFd
  try {
    activationFd = fs.openSync(activationFile, 'wx', 0o600)
    fs.writeFileSync(activationFd, `${JSON.stringify(state, null, 2)}\n`)
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return {
        created: false,
        state: readFailClose(options),
        reason: 'activation_already_claimed'
      }
    }
    throw error
  } finally {
    if (activationFd !== undefined) fs.closeSync(activationFd)
  }

  const file = latchPath(options)
  try {
    // A rolling-overlap process may have recovered the activation record and
    // materialized the latch while this creator still held the claim. Preserve
    // that newer alert state instead of overwriting it.
    if (fs.existsSync(file)) {
      return { created: false, state: readFailClose(options) }
    }
    atomicWriteJson(file, state)
  } catch (error) {
    try { fs.unlinkSync(activationFile) } catch {}
    throw error
  }
  return { created: true, state: { ...state, file } }
}

function readAlertClaim(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function alertTerminal(state) {
  return ['delivered', 'failed'].includes(String(state?.alert?.delivery_status || ''))
}

function claimSingleAlertAttempt({
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  leaseMs = DEFAULT_ALERT_LEASE_MS,
  nowMs = Date.now()
} = {}) {
  const options = { env, root }
  const state = readFailClose(options)
  if (!state.active) return { claimed: false, reason: 'latch_inactive', state }
  if (alertTerminal(state)) {
    return { claimed: false, reason: 'alert_terminal', state }
  }
  fs.mkdirSync(latchDirectory(options), { recursive: true })
  const claimFile = alertClaimPath(options)
  const lease = Math.max(1000, Number(leaseMs) || DEFAULT_ALERT_LEASE_MS)
  const claimedAt = new Date(nowMs).toISOString()
  const claimId = crypto.randomUUID()
  const claimState = {
    schema: 'scv-golden-alert-lease-2026-07-25-v1',
    claim_id: claimId,
    claimed_at_utc: claimedAt,
    lease_ms: lease,
    status: 'attempting'
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let claimFd
    try {
      claimFd = fs.openSync(claimFile, 'wx', 0o600)
      fs.writeFileSync(claimFd, `${JSON.stringify(claimState, null, 2)}\n`)
      fs.closeSync(claimFd)
      claimFd = undefined
      break
    } catch (error) {
      if (claimFd !== undefined) fs.closeSync(claimFd)
      if (!error || error.code !== 'EEXIST') throw error
      const existing = readAlertClaim(claimFile)
      const existingAt = Date.parse(String(existing?.claimed_at_utc || ''))
      const ageMs = Number.isFinite(existingAt) ? Math.max(0, nowMs - existingAt) : lease
      if (ageMs < lease) {
        return {
          claimed: false,
          reason: 'alert_attempt_in_progress',
          retry_after_ms: Math.max(1000, lease - ageMs),
          state: readFailClose(options)
        }
      }
      const staleFile = `${claimFile}.stale-${nowMs}-${crypto.randomBytes(4).toString('hex')}`
      try {
        fs.renameSync(claimFile, staleFile)
      } catch (renameError) {
        if (renameError && renameError.code === 'ENOENT') continue
        throw renameError
      }
      if (attempt === 3) {
        throw new Error('alert_claim_recovery_exhausted')
      }
    }
  }

  if (!fs.existsSync(claimFile)) throw new Error('alert_claim_not_materialized')
  const next = {
    ...state,
    alert: {
      ...(state.alert || {}),
      attempted_at_utc: claimedAt,
      claim_id: claimId,
      claimed_at_utc: claimedAt,
      lease_ms: lease,
      delivery_status: 'attempting'
    }
  }
  delete next.file
  atomicWriteJson(latchPath(options), next)
  return {
    claimed: true,
    claim_id: claimId,
    state: { ...next, file: latchPath(options) }
  }
}

function completeSingleAlertAttempt({
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  claimId = '',
  delivered = false,
  channel = '',
  error = ''
} = {}) {
  const options = { env, root }
  const state = readFailClose(options)
  if (!state.active) return state
  if (!claimId || String(state.alert?.claim_id || '') !== String(claimId)) {
    return {
      ...state,
      completion_applied: false,
      completion_reason: 'alert_claim_mismatch'
    }
  }
  const completedAt = new Date().toISOString()
  const next = {
    ...state,
    alert: {
      ...(state.alert || {}),
      delivered_at_utc: delivered ? completedAt : '',
      completed_at_utc: completedAt,
      channel: String(channel || '').slice(0, 80),
      delivery_status: delivered ? 'delivered' : 'failed',
      error: delivered ? '' : safeDetail(String(error || 'alert_delivery_failed'))
    }
  }
  delete next.file
  atomicWriteJson(latchPath(options), next)
  atomicWriteJson(alertClaimPath(options), {
    schema: 'scv-golden-alert-lease-2026-07-25-v1',
    claim_id: String(claimId),
    claimed_at_utc: String(state.alert?.claimed_at_utc || state.alert?.attempted_at_utc || ''),
    completed_at_utc: completedAt,
    status: delivered ? 'delivered' : 'failed',
    channel: String(channel || '').slice(0, 80)
  })
  return {
    ...next,
    file: latchPath(options),
    completion_applied: true
  }
}

function clearFailCloseWithVerifiedApproval({
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  approval,
  publicKeyPem
} = {}) {
  const file = latchPath({ env, root })
  const current = readFailClose({ env, root })
  if (!current.active) return { cleared: false, reason: 'already_clear', file }
  const {
    verifyFailCloseClearApprovalReceipt
  } = require(path.join(__dirname, 'scv-release-approval.js'))
  const verification = verifyFailCloseClearApprovalReceipt(
    approval,
    current,
    publicKeyPem
  )
  if (!verification.ok) {
    throw new Error(`fail_close_clear_requires_verified_ben_approval:${verification.failures.join(',')}`)
  }
  const archived = `${file}.cleared-${Date.now()}.json`
  fs.renameSync(file, archived)
  for (const claim of [alertClaimPath({ env, root }), activationClaimPath({ env, root })]) {
    if (!fs.existsSync(claim)) continue
    fs.renameSync(claim, `${claim}.cleared-${Date.now()}`)
  }
  return {
    cleared: true,
    cleared_at_utc: new Date().toISOString(),
    archived_file: archived,
    approval_id: String(approval.approval_id || '')
  }
}

// One incident-scoped repair path for the v124 latch whose only critical
// evidence was the now-regressed form-receipt false positive. This is not a
// general operator-clear bypass: every immutable latch field, the replacement
// release identity, the repaired hard harness, and a fresh zero-critical drift
// result must all match before the latch is archived with an audit receipt.
function reconcileKnownFalsePositiveFailClose({
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  driftStatus = {},
  currentReleaseId = '',
  currentReleaseFingerprint = ''
} = {}) {
  const options = { env, root }
  const current = readFailClose(options)
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  const exactChecks = Array.isArray(current.failed_checks)
    ? current.failed_checks.map(String).sort()
    : []
  const detailReasons = Array.isArray(current?.detail?.critical_reasons)
    ? current.detail.critical_reasons.map(String).sort()
    : []
  const currentId = String(currentReleaseId || '')
  const currentFingerprint = String(currentReleaseFingerprint || '')
  const criticalAlerts = (Array.isArray(driftStatus.alerts) ? driftStatus.alerts : [])
    .filter((alert) => String(alert?.severity || '') === 'critical')

  check(isProductionEnv(env), 'known_false_positive_reconciliation_requires_production')
  check(current.active === true, 'known_false_positive_latch_not_active')
  check(current.schema === SCV_GOLDEN_FAIL_CLOSE_VERSION, 'known_false_positive_latch_schema_mismatch')
  check(current.release_id === KNOWN_FALSE_POSITIVE_INCIDENT.release_id,
    'known_false_positive_release_id_mismatch')
  check(current.release_fingerprint_sha256 ===
    KNOWN_FALSE_POSITIVE_INCIDENT.release_fingerprint_sha256,
  'known_false_positive_release_fingerprint_mismatch')
  check(current.activated_at_utc === KNOWN_FALSE_POSITIVE_INCIDENT.activated_at_utc,
    'known_false_positive_activation_identity_mismatch')
  check(current.reason === KNOWN_FALSE_POSITIVE_INCIDENT.reason,
    'known_false_positive_reason_mismatch')
  check(exactChecks.length === 1 &&
    exactChecks[0] === KNOWN_FALSE_POSITIVE_INCIDENT.failed_check,
  'known_false_positive_failed_checks_not_exact')
  check(detailReasons.length === 1 &&
    detailReasons[0] === KNOWN_FALSE_POSITIVE_INCIDENT.failed_check,
  'known_false_positive_detail_reasons_not_exact')
  check(/^scv-instagram-single-20260901-v\d+$/.test(currentId) &&
    currentId !== KNOWN_FALSE_POSITIVE_INCIDENT.release_id,
  'known_false_positive_replacement_release_invalid')
  check(/^[a-f0-9]{64}$/.test(currentFingerprint) &&
    currentFingerprint !== KNOWN_FALSE_POSITIVE_INCIDENT.release_fingerprint_sha256,
  'known_false_positive_replacement_fingerprint_invalid')
  check(driftStatus?.schema === 'scv-drift-status-2026-08-31-v3-fail-close',
    'known_false_positive_drift_schema_mismatch')
  check(driftStatus?.critical_ok === true &&
    Number(driftStatus?.critical_alert_count || 0) === 0 &&
    criticalAlerts.length === 0,
  'known_false_positive_current_drift_not_clean')
  check(driftStatus?.hard_harness?.ok === true &&
    driftStatus?.hard_harness_lock_version ===
      KNOWN_FALSE_POSITIVE_INCIDENT.fixed_hard_harness_lock_version,
  'known_false_positive_repaired_hard_harness_missing')

  if (failures.length) {
    return { reconciled: false, reason: 'evidence_mismatch', failures }
  }

  const file = latchPath(options)
  const now = Date.now()
  const reconciledAt = new Date(now).toISOString()
  const archived = `${file}.reconciled-known-false-positive-${now}.json`
  fs.renameSync(file, archived)
  const archivedClaims = []
  for (const claim of [alertClaimPath(options), activationClaimPath(options)]) {
    if (!fs.existsSync(claim)) continue
    const archivedClaim = `${claim}.reconciled-known-false-positive-${now}`
    fs.renameSync(claim, archivedClaim)
    archivedClaims.push(archivedClaim)
  }
  const auditFile = path.join(
    latchDirectory(options),
    `scv-known-false-positive-reconciliation-${now}.json`
  )
  atomicWriteJson(auditFile, {
    schema: 'scv-known-false-positive-reconciliation-2026-09-01-v1',
    reconciled_at_utc: reconciledAt,
    incident_release_id: current.release_id,
    incident_release_fingerprint_sha256: current.release_fingerprint_sha256,
    incident_activated_at_utc: current.activated_at_utc,
    incident_failed_checks: exactChecks,
    replacement_release_id: currentId,
    replacement_release_fingerprint_sha256: currentFingerprint,
    drift_status_schema: String(driftStatus.schema || ''),
    drift_checked_at_utc: String(driftStatus.at || ''),
    critical_alert_count: Number(driftStatus.critical_alert_count || 0),
    hard_harness_lock_version: String(driftStatus.hard_harness_lock_version || ''),
    authorization_scope: 'incident_specific_false_positive_repair_only'
  })
  return {
    reconciled: true,
    reconciled_at_utc: reconciledAt,
    archived_file: archived,
    archived_claims: archivedClaims,
    audit_file: auditFile,
    replacement_release_id: currentId,
    replacement_release_fingerprint_sha256: currentFingerprint
  }
}

function firstPacketTimestampMs(packet) {
  for (const field of ['source_interaction_at', 'received_at', 'at', 'created_at']) {
    const milliseconds = Date.parse(String(packet?.[field] || ''))
    if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds
  }
  return 0
}

// A stale inbox packet can move into the durable human-review queue before an
// operator gets to reconcile the latch. Preserve that transition as evidence,
// but accept only the exact stale-backlog artifact shape. The classifier uses
// the code-locked debug identity and the deployed operator pause gate; prompt
// text and caller-supplied identifiers cannot expand the scope.
function scanIntentionalHoldIncidentEvidence({
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  incident = KNOWN_INTENTIONAL_HOLD_QUEUE_FALSE_POSITIVE_INCIDENT
} = {}) {
  const directory = path.join(root, INTENTIONAL_HOLD_EVIDENCE_DIR)
  const result = {
    candidate_count: 0,
    intentional_holds: [],
    pre_latch_intentional_holds: [],
    causal_debug_blocks: [],
    unclassified: []
  }
  if (!fs.existsSync(directory)) return result

  const activatedAtMs = Date.parse(String(incident?.activated_at_utc || ''))
  if (!Number.isFinite(activatedAtMs) || activatedAtMs <= 0) {
    result.unclassified.push({ reason: 'incident_activation_time_invalid' })
    return result
  }

  const { operatorPauseReasonForPacket } = require('./scv-pause-gate.js')
  const { isDebugIdentity } = require('./scv-debug-identity.js')
  const names = fs.readdirSync(directory)
    .filter((name) => name.startsWith('stale-backlog-hold-') && name.endsWith('.json'))
    .sort()
  if (names.length > MAX_INTENTIONAL_HOLD_EVIDENCE_FILES) {
    result.unclassified.push({ reason: 'evidence_file_limit_exceeded' })
    return result
  }

  for (const name of names) {
    const file = path.join(directory, name)
    let packet
    try {
      const stat = fs.lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INTENTIONAL_HOLD_EVIDENCE_BYTES) {
        throw new Error('evidence_file_shape_invalid')
      }
      packet = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      result.candidate_count += 1
      result.unclassified.push({ file_name: name, reason: 'evidence_file_invalid' })
      continue
    }

    if (
      String(packet?.type || '') !== 'stale_backlog_human_agent_required' ||
      String(packet?.manual_reason || '') !== 'stale_backlog_over_threshold'
    ) continue

    const queuedAtMs = Date.parse(String(packet?.queued_for_human_agent_at || ''))
    if (!Number.isFinite(queuedAtMs) || queuedAtMs < activatedAtMs) continue

    result.candidate_count += 1
    const sourceAtMs = firstPacketTimestampMs(packet)
    const operatorReason = operatorPauseReasonForPacket(packet, env)
    if (operatorReason) {
      const evidence = {
        file_name: name,
        hold_reason: operatorReason,
        source_at_ms: sourceAtMs,
        queued_at_ms: queuedAtMs
      }
      result.intentional_holds.push(evidence)
      if (sourceAtMs > 0 && sourceAtMs <= activatedAtMs) {
        result.pre_latch_intentional_holds.push(evidence)
      }
      continue
    }
    if (isDebugIdentity(packet, env) && sourceAtMs >= activatedAtMs) {
      result.causal_debug_blocks.push({
        file_name: name,
        source_at_ms: sourceAtMs,
        queued_at_ms: queuedAtMs
      })
      continue
    }
    result.unclassified.push({
      file_name: name,
      reason: sourceAtMs > 0 ? 'identity_or_causality_unclassified' : 'source_time_missing'
    })
  }
  return result
}

// Incident-scoped reconciliation for the v130 latch raised when a production
// owner-test lockdown deliberately held a non-test inbox packet. The repaired
// monitor must prove both the original operator hold and any packets that were
// causally blocked after latch activation. Any pre-latch unheld stale packet or
// other critical signal keeps the latch closed.
function reconcileKnownIntentionalHoldQueueFalsePositive({
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  driftStatus = {},
  currentReleaseId = '',
  currentReleaseFingerprint = ''
} = {}) {
  const options = { env, root }
  const current = readFailClose(options)
  const incident = KNOWN_INTENTIONAL_HOLD_QUEUE_FALSE_POSITIVE_INCIDENT
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  const exactChecks = Array.isArray(current.failed_checks)
    ? current.failed_checks.map(String).sort()
    : []
  const detailReasons = Array.isArray(current?.detail?.critical_reasons)
    ? current.detail.critical_reasons.map(String).sort()
    : []
  const alerts = Array.isArray(driftStatus.alerts) ? driftStatus.alerts : []
  const criticalAlerts = alerts.filter((alert) => String(alert?.severity || '') === 'critical')
  const intentionalHolds = alerts.filter((alert) =>
    String(alert?.reason || '') === 'queue_file_intentionally_held')
  const causalBlocks = alerts.filter((alert) =>
    String(alert?.reason || '') === 'queue_file_blocked_by_fail_close')
  const queueRows = Array.isArray(driftStatus.queues) ? driftStatus.queues : []
  const unclassifiedStale = queueRows.flatMap((queue) =>
    Array.isArray(queue?.stale) ? queue.stale : [])
  const quarantinedEvidence = scanIntentionalHoldIncidentEvidence({ env, root, incident })
  const intentionalEvidenceCount = intentionalHolds.length +
    quarantinedEvidence.pre_latch_intentional_holds.length
  const causalEvidenceCount = causalBlocks.length +
    quarantinedEvidence.causal_debug_blocks.length

  check(isProductionEnv(env), 'intentional_hold_reconciliation_requires_production')
  check(current.active === true, 'intentional_hold_latch_not_active')
  check(current.schema === SCV_GOLDEN_FAIL_CLOSE_VERSION,
    'intentional_hold_latch_schema_mismatch')
  check(current.release_id === incident.release_id,
    'intentional_hold_release_id_mismatch')
  check(current.release_fingerprint_sha256 === incident.release_fingerprint_sha256,
    'intentional_hold_release_fingerprint_mismatch')
  check(current.activated_at_utc === incident.activated_at_utc,
    'intentional_hold_activation_identity_mismatch')
  check(current.reason === incident.reason, 'intentional_hold_reason_mismatch')
  check(exactChecks.length === 1 && exactChecks[0] === incident.failed_check,
    'intentional_hold_failed_checks_not_exact')
  check(detailReasons.length === 1 && detailReasons[0] === incident.failed_check,
    'intentional_hold_detail_reasons_not_exact')
  check(String(currentReleaseId || '') === incident.replacement_release_id,
    'intentional_hold_replacement_release_invalid')
  check(/^[a-f0-9]{64}$/.test(String(currentReleaseFingerprint || '')) &&
    String(currentReleaseFingerprint) !== incident.release_fingerprint_sha256,
  'intentional_hold_replacement_fingerprint_invalid')
  check(driftStatus?.schema === incident.fixed_drift_schema,
    'intentional_hold_drift_schema_mismatch')
  check(driftStatus?.critical_ok === true &&
    Number(driftStatus?.critical_alert_count || 0) === 0 &&
    criticalAlerts.length === 0 &&
    unclassifiedStale.length === 0,
  'intentional_hold_current_drift_not_clean')
  check(intentionalEvidenceCount > 0,
    'intentional_hold_current_operator_hold_evidence_missing')
  check(intentionalHolds.every((alert) =>
    ['pause_non_test', 'pause_non_test_exact_staging', 'pause_debug_account']
      .includes(String(alert?.hold_reason || ''))),
  'intentional_hold_current_operator_hold_reason_invalid')
  check(causalEvidenceCount > 0,
    'intentional_hold_current_causal_block_evidence_missing')
  check(causalBlocks.every((alert) =>
    String(alert?.latch_activated_at_utc || '') === incident.activated_at_utc),
  'intentional_hold_current_causal_block_identity_mismatch')
  check(quarantinedEvidence.unclassified.length === 0,
    'intentional_hold_quarantined_evidence_unclassified')
  check(driftStatus?.hard_harness?.ok === true &&
    driftStatus?.hard_harness_lock_version === incident.fixed_hard_harness_lock_version,
  'intentional_hold_repaired_hard_harness_missing')

  if (failures.length) {
    return { reconciled: false, reason: 'evidence_mismatch', failures }
  }

  const file = latchPath(options)
  const now = Date.now()
  const reconciledAt = new Date(now).toISOString()
  const archived = `${file}.reconciled-intentional-hold-false-positive-${now}.json`
  fs.renameSync(file, archived)
  const archivedClaims = []
  for (const claim of [alertClaimPath(options), activationClaimPath(options)]) {
    if (!fs.existsSync(claim)) continue
    const archivedClaim = `${claim}.reconciled-intentional-hold-false-positive-${now}`
    fs.renameSync(claim, archivedClaim)
    archivedClaims.push(archivedClaim)
  }
  const auditFile = path.join(
    latchDirectory(options),
    `scv-intentional-hold-false-positive-reconciliation-${now}.json`
  )
  atomicWriteJson(auditFile, {
    schema: 'scv-intentional-hold-false-positive-reconciliation-2026-09-01-v2-quarantine-bound',
    reconciled_at_utc: reconciledAt,
    incident_release_id: current.release_id,
    incident_release_fingerprint_sha256: current.release_fingerprint_sha256,
    incident_activated_at_utc: current.activated_at_utc,
    incident_failed_checks: exactChecks,
    replacement_release_id: String(currentReleaseId || ''),
    replacement_release_fingerprint_sha256: String(currentReleaseFingerprint || ''),
    drift_status_schema: String(driftStatus.schema || ''),
    drift_checked_at_utc: String(driftStatus.at || ''),
    critical_alert_count: Number(driftStatus.critical_alert_count || 0),
    intentional_hold_alert_count: intentionalHolds.length,
    causal_block_alert_count: causalBlocks.length,
    quarantined_candidate_count: quarantinedEvidence.candidate_count,
    quarantined_intentional_hold_count: quarantinedEvidence.intentional_holds.length,
    quarantined_pre_latch_intentional_hold_count:
      quarantinedEvidence.pre_latch_intentional_holds.length,
    quarantined_causal_debug_block_count: quarantinedEvidence.causal_debug_blocks.length,
    quarantined_unclassified_count: quarantinedEvidence.unclassified.length,
    hard_harness_lock_version: String(driftStatus.hard_harness_lock_version || ''),
    authorization_scope: 'incident_specific_intentional_hold_false_positive_repair_only'
  })
  return {
    reconciled: true,
    reconciled_at_utc: reconciledAt,
    archived_file: archived,
    archived_claims: archivedClaims,
    audit_file: auditFile,
    replacement_release_id: String(currentReleaseId || ''),
    replacement_release_fingerprint_sha256: String(currentReleaseFingerprint || '')
  }
}

function reconcileKnownDuplicateRecoveryTextFailClose({
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  driftStatus = {},
  currentReleaseId = '',
  currentReleaseFingerprint = '',
  currentRecoveryVersion = '',
  purgeReceipt = null
} = {}) {
  const options = { env, root }
  const current = readFailClose(options)
  const incident = KNOWN_DUPLICATE_RECOVERY_TEXT_INCIDENT
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  const exactChecks = Array.isArray(current.failed_checks)
    ? current.failed_checks.map(String).sort()
    : []
  const detailReasons = Array.isArray(current?.detail?.critical_reasons)
    ? current.detail.critical_reasons.map(String).sort()
    : []
  const alerts = Array.isArray(driftStatus.alerts) ? driftStatus.alerts : []
  const criticalAlerts = alerts.filter((alert) => String(alert?.severity || '') === 'critical')
  const purgeExecutedMs = Date.parse(String(purgeReceipt?.executed_at_utc || ''))
  const activatedMs = Date.parse(String(incident.activated_at_utc))

  check(isProductionEnv(env), 'duplicate_recovery_reconciliation_requires_production')
  check(current.active === true, 'duplicate_recovery_latch_not_active')
  check(current.schema === SCV_GOLDEN_FAIL_CLOSE_VERSION, 'duplicate_recovery_latch_schema_mismatch')
  check(current.release_id === incident.release_id, 'duplicate_recovery_release_id_mismatch')
  check(current.release_fingerprint_sha256 === incident.release_fingerprint_sha256,
    'duplicate_recovery_release_fingerprint_mismatch')
  check(current.activated_at_utc === incident.activated_at_utc,
    'duplicate_recovery_activation_identity_mismatch')
  check(current.reason === incident.reason, 'duplicate_recovery_reason_mismatch')
  check(exactChecks.length === 1 && exactChecks[0] === incident.failed_check,
    'duplicate_recovery_failed_checks_not_exact')
  check(detailReasons.length === 1 && detailReasons[0] === incident.failed_check,
    'duplicate_recovery_detail_reasons_not_exact')
  check(String(currentReleaseId || '') === incident.replacement_release_id,
    'duplicate_recovery_replacement_release_invalid')
  check(/^[a-f0-9]{64}$/.test(String(currentReleaseFingerprint || '')) &&
    String(currentReleaseFingerprint) !== incident.release_fingerprint_sha256,
  'duplicate_recovery_replacement_fingerprint_invalid')
  check(String(currentRecoveryVersion || '') === incident.fixed_recovery_version,
    'duplicate_recovery_fixed_recovery_version_missing')
  check(driftStatus?.schema === incident.fixed_drift_schema,
    'duplicate_recovery_drift_schema_mismatch')
  check(driftStatus?.critical_ok === true &&
    Number(driftStatus?.critical_alert_count || 0) === 0 &&
    criticalAlerts.length === 0,
  'duplicate_recovery_current_drift_not_clean')
  check(driftStatus?.hard_harness?.ok === true &&
    driftStatus?.hard_harness_lock_version === incident.fixed_hard_harness_lock_version,
  'duplicate_recovery_repaired_hard_harness_missing')
  check(purgeReceipt && typeof purgeReceipt === 'object' &&
    String(purgeReceipt.schema || '').startsWith(incident.purge_receipt_schema_prefix) &&
    purgeReceipt.ok === true &&
    purgeReceipt.code_locked_identity_scope === true &&
    purgeReceipt.non_debug_identity_scope_allowed === false,
  'duplicate_recovery_purge_receipt_invalid')
  check(Array.isArray(purgeReceipt?.contact_ids) &&
    purgeReceipt.contact_ids.map(String).includes(incident.affected_contact_id),
  'duplicate_recovery_purge_receipt_thread_mismatch')
  check(Number.isFinite(purgeExecutedMs) && purgeExecutedMs > activatedMs,
    'duplicate_recovery_purge_receipt_not_after_latch')
  check(Number(purgeReceipt?.post_audit_remaining_count) === 0 &&
    purgeReceipt?.worker_pause_barrier_verified === true,
  'duplicate_recovery_purge_receipt_not_clean')

  if (failures.length) {
    return { reconciled: false, reason: 'evidence_mismatch', failures }
  }

  const file = latchPath(options)
  const now = Date.now()
  const reconciledAt = new Date(now).toISOString()
  const archived = `${file}.reconciled-duplicate-recovery-text-${now}.json`
  fs.renameSync(file, archived)
  const archivedClaims = []
  for (const claim of [alertClaimPath(options), activationClaimPath(options)]) {
    if (!fs.existsSync(claim)) continue
    const archivedClaim = `${claim}.reconciled-duplicate-recovery-text-${now}`
    fs.renameSync(claim, archivedClaim)
    archivedClaims.push(archivedClaim)
  }
  const auditFile = path.join(
    latchDirectory(options),
    `scv-duplicate-recovery-text-reconciliation-${now}.json`
  )
  atomicWriteJson(auditFile, {
    schema: 'scv-duplicate-recovery-text-reconciliation-2026-09-02-v1',
    reconciled_at_utc: reconciledAt,
    incident_release_id: current.release_id,
    incident_release_fingerprint_sha256: current.release_fingerprint_sha256,
    incident_activated_at_utc: current.activated_at_utc,
    incident_failed_checks: exactChecks,
    incident_classification: 'true_positive_cause_fixed_and_visible_history_purged',
    affected_contact_id: incident.affected_contact_id,
    replacement_release_id: String(currentReleaseId),
    replacement_release_fingerprint_sha256: String(currentReleaseFingerprint),
    fixed_recovery_version: String(currentRecoveryVersion),
    purge_receipt_executed_at_utc: String(purgeReceipt.executed_at_utc),
    purge_receipt_schema: String(purgeReceipt.schema),
    drift_status_schema: String(driftStatus.schema || ''),
    drift_checked_at_utc: String(driftStatus.at || ''),
    critical_alert_count: Number(driftStatus.critical_alert_count || 0),
    hard_harness_lock_version: String(driftStatus.hard_harness_lock_version || ''),
    owner_directive: 'owner instructed the incident-scoped repair on 2026-09-02',
    authorization_scope: 'incident_specific_repair_only_ben_signed_approval_still_required_for_any_other_latch'
  })
  return {
    reconciled: true,
    reconciled_at_utc: reconciledAt,
    archived_file: archived,
    archived_claims: archivedClaims,
    audit_file: auditFile,
    replacement_release_id: String(currentReleaseId),
    replacement_release_fingerprint_sha256: String(currentReleaseFingerprint)
  }
}

module.exports = {
  KNOWN_DUPLICATE_RECOVERY_TEXT_INCIDENT,
  reconcileKnownDuplicateRecoveryTextFailClose,
  SCV_GOLDEN_FAIL_CLOSE_VERSION,
  LATCH_FILE,
  ALERT_CLAIM_FILE,
  ACTIVATION_CLAIM_FILE,
  DEFAULT_ALERT_LEASE_MS,
  KNOWN_FALSE_POSITIVE_INCIDENT,
  KNOWN_INTENTIONAL_HOLD_QUEUE_FALSE_POSITIVE_INCIDENT,
  isProductionEnv,
  latchDirectory,
  latchPath,
  alertClaimPath,
  activationClaimPath,
  safeDetail,
  atomicWriteJson,
  readFailClose,
  isFailClosed,
  activateFailClose,
  readAlertClaim,
  alertTerminal,
  claimSingleAlertAttempt,
  completeSingleAlertAttempt,
  clearFailCloseWithVerifiedApproval,
  reconcileKnownFalsePositiveFailClose,
  scanIntentionalHoldIncidentEvidence,
  reconcileKnownIntentionalHoldQueueFalsePositive
}
