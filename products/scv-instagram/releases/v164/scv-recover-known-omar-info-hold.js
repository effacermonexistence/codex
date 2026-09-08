#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { verifySingleRelease } = require('./scv-single-release.js')
const { isDebugIdentity } = require('./scv-debug-identity.js')
const { isPausedForPacket } = require('./scv-pause-gate.js')
const { readFailClose } = require('./scv-golden-fail-close.js')
const {
  VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION
} = require('./scv-immutable-ingress-time.js')

const RECOVERY_SCHEMA = 'scv-known-omar-info-hold-recovery-2026-09-01-v1-exact-target'
const EXPECTED_RELEASE_ID = 'scv-instagram-single-20260901-v134'
const EXPECTED_CONTACT_ID = '1537753982'
const EXPECTED_MESSAGE_ID = 'legacy-manychat-bbd38badb616940453a45a86b21ea036'
const EXPECTED_NORMALIZED_TEXT_SHA256 =
  '382bb11cf101f09e90086496f6f0ae0e4de19304f9f45bb108d5096310535996'
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_HOLD_FILES = 10000

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function safeThreadKey(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function readRegularJson(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) {
    throw new Error(`known_omar_recovery_json_shape_invalid:${path.basename(file)}`)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(
    fs.realpathSync(directory),
    fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) |
      (fs.constants.O_NOFOLLOW || 0)
  )
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function writePrivateJsonExclusive(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const descriptor = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
      (fs.constants.O_NOFOLLOW || 0),
    0o600
  )
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`)
    fs.fsyncSync(descriptor)
  } finally { fs.closeSync(descriptor) }
  fsyncDirectory(path.dirname(file))
}

function ndjsonHasMessage(file, messageId) {
  if (!fs.existsSync(file)) return false
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('known_omar_recovery_log_shape_invalid')
  const maxBytes = 8 * 1024 * 1024
  const length = Math.min(stat.size, maxBytes)
  const start = Math.max(0, stat.size - length)
  const descriptor = fs.openSync(file, 'r')
  const bytes = Buffer.alloc(length)
  try { fs.readSync(descriptor, bytes, 0, length, start) } finally { fs.closeSync(descriptor) }
  return bytes.toString('utf8').split(/\r?\n/).filter(Boolean).some((line) => {
    try {
      const row = JSON.parse(line)
      return [row?.message_id, row?.source_message_id, row?.reply_to_message_id]
        .some((value) => String(value || '') === messageId)
    } catch { return false }
  })
}

function exactHoldFiles(root) {
  const directory = path.join(root, 'outbox_human_agent_required')
  if (!fs.existsSync(directory)) return []
  const names = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
  if (names.length > MAX_HOLD_FILES) throw new Error('known_omar_recovery_hold_file_limit_exceeded')
  const matches = []
  for (const name of names) {
    const file = path.join(directory, name)
    let packet
    try { packet = readRegularJson(file) } catch { continue }
    if (
      String(packet?.message_id || '') === EXPECTED_MESSAGE_ID ||
      String(packet?.held_from_inbox_file || '') === `${EXPECTED_MESSAGE_ID}.json`
    ) matches.push({ file, packet })
  }
  return matches
}

function assertExactHoldPacket(packet) {
  const holdType = String(packet?.type || '')
  const holdReason = String(packet?.manual_reason || '')
  const staleHold = holdType === 'stale_backlog_human_agent_required' &&
    holdReason === 'stale_backlog_over_threshold' &&
    String(packet?.held_from_inbox_file || '') === `${EXPECTED_MESSAGE_ID}.json`
  const v132RepeatHold =
    holdType === 'authoritative_latest_recovery_repeat_human_agent_required' &&
    holdReason === 'authoritative_latest_recovery_repeat_blocked' &&
    String(packet?.held_from_superseded_file || '') === `${EXPECTED_MESSAGE_ID}.json` &&
    packet?.operator_recovery === true &&
    String(packet?.operator_recovery_lock_version || '') ===
      VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION &&
    String(packet?.operator_recovery_reason || '') === 'verified_control_plane_repair' &&
    String(packet?.recovered_from_message_id || '') === EXPECTED_MESSAGE_ID
  if (!staleHold && !v132RepeatHold) {
    throw new Error('known_omar_recovery_hold_transition_mismatch')
  }
  if (packet?.human_agent_required !== true) {
    throw new Error('known_omar_recovery_human_hold_flag_missing')
  }
  if (String(packet?.message_id || '') !== EXPECTED_MESSAGE_ID) {
    throw new Error('known_omar_recovery_message_id_mismatch')
  }
  if (
    String(packet?.contact_id || '') !== EXPECTED_CONTACT_ID ||
    String(packet?.thread_id || packet?.contact_id || '') !== EXPECTED_CONTACT_ID ||
    !isDebugIdentity(packet)
  ) throw new Error('known_omar_recovery_debug_identity_mismatch')
  if (sha256(normalizeText(packet?.text)) !== EXPECTED_NORMALIZED_TEXT_SHA256) {
    throw new Error('known_omar_recovery_text_hash_mismatch')
  }
  const sourceAt = Date.parse(String(
    packet?.source_interaction_at || packet?.received_at || packet?.at || packet?.created_at || ''
  ))
  if (!Number.isFinite(sourceAt) || sourceAt <= 0) {
    throw new Error('known_omar_recovery_source_time_missing')
  }
}

function assertStateAndHistory(root) {
  const stateFile = path.join(root, 'thread-state', `${EXPECTED_CONTACT_ID}.json`)
  const historyFile = path.join(root, 'thread-history', `${EXPECTED_CONTACT_ID}.json`)
  const state = readRegularJson(stateFile)
  const history = readRegularJson(historyFile)
  if (String(state?.latest_ingress_message_id || '') !== EXPECTED_MESSAGE_ID) {
    throw new Error('known_omar_recovery_latest_ingress_mismatch')
  }
  if (String(state?.latest_ingress_text_sha256 || '') !== EXPECTED_NORMALIZED_TEXT_SHA256) {
    throw new Error('known_omar_recovery_latest_ingress_text_hash_mismatch')
  }
  if (Math.max(0, Number(state?.control_revision) || 0) !== 0) {
    throw new Error('known_omar_recovery_control_revision_not_zero')
  }
  if (String(state?.last_control_message_id || '') === EXPECTED_MESSAGE_ID) {
    throw new Error('known_omar_recovery_control_already_committed')
  }

  const events = Array.isArray(history?.events) ? history.events : []
  const userEvents = events.filter((event) => String(event?.role || '').toLowerCase() === 'user')
  const exactUserEvents = userEvents.filter((event) =>
    String(event?.message_id || '') === EXPECTED_MESSAGE_ID &&
    sha256(normalizeText(event?.text)) === EXPECTED_NORMALIZED_TEXT_SHA256)
  if (exactUserEvents.length !== 1 || userEvents.at(-1) !== exactUserEvents[0]) {
    throw new Error('known_omar_recovery_history_latest_user_mismatch')
  }
  if (events.some((event) =>
    String(event?.role || '').toLowerCase().startsWith('assistant') &&
    [event?.reply_to_message_id, event?.message_id]
      .some((value) => String(value || '') === EXPECTED_MESSAGE_ID)
  )) throw new Error('known_omar_recovery_assistant_reply_already_present')
}

function buildRecoveryPacket(packet, recoveryAt) {
  const {
    type: _type,
    manual_reason: _manualReason,
    human_agent_required: _humanAgentRequired,
    queued_for_human_agent_at: _queuedForHumanAgentAt,
    held_from_inbox_file: _heldFromInboxFile,
    stale_backlog_age_ms: _staleBacklogAgeMs,
    stale_backlog_threshold_ms: _staleBacklogThresholdMs,
    reply_certainty: _replyCertainty,
    retry_after: _retryAfter,
    held_from_superseded_file: _heldFromSupersededFile,
    authoritative_latest_recovered_at: _AuthoritativeLatestRecoveredAt,
    superseded_inbox: _supersededInbox,
    single_control_superseded: _singleControlSuperseded,
    quarantined_at: _quarantinedAt,
    superseded_by_file: _supersededByFile,
    superseded_by_thread: _supersededByThread,
    superseded_by_message_id: _supersededByMessageId,
    ...preserved
  } = packet
  return {
    ...preserved,
    operator_recovery: true,
    operator_recovery_lock_version: VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION,
    operator_recovery_reason: 'verified_control_plane_repair',
    operator_recovery_at: recoveryAt,
    recovered_from_message_id: EXPECTED_MESSAGE_ID,
    recovered_via: 'known_omar_info_hold_exact_target_v134',
    updated_at: recoveryAt
  }
}

function recoverKnownOmarInfoHold({
  root,
  env = process.env,
  release,
  now = new Date()
} = {}) {
  const resolvedRoot = path.resolve(String(root || env.SCV_ROOT || __dirname))
  if (
    String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() !== 'production' ||
    String(env.SCV_RELEASE_MODE || '').trim().toLowerCase() !== 'production'
  ) throw new Error('known_omar_recovery_requires_production')
  if (release?.ok !== true || String(release?.release_id || '') !== EXPECTED_RELEASE_ID) {
    throw new Error('known_omar_recovery_release_mismatch')
  }
  if (!/^[a-f0-9]{64}$/.test(String(release?.content_fingerprint_sha256 || ''))) {
    throw new Error('known_omar_recovery_release_fingerprint_invalid')
  }
  const failClose = readFailClose({ env, root: resolvedRoot })
  if (failClose.active === true) throw new Error('known_omar_recovery_fail_close_active')

  const holds = exactHoldFiles(resolvedRoot)
  if (holds.length !== 1) throw new Error(`known_omar_recovery_exact_hold_count:${holds.length}`)
  const { file: holdFile, packet } = holds[0]
  assertExactHoldPacket(packet)
  if (isPausedForPacket(packet, env)) throw new Error('known_omar_recovery_packet_still_paused')
  assertStateAndHistory(resolvedRoot)

  const inboxDir = path.join(resolvedRoot, 'inbox')
  const inboxFile = path.join(inboxDir, `${safeThreadKey(EXPECTED_MESSAGE_ID)}.json`)
  if (fs.existsSync(inboxFile) || fs.existsSync(`${inboxFile}.lock`)) {
    throw new Error('known_omar_recovery_inbox_collision')
  }
  for (const logName of ['inbound-processing-receipts.ndjson', 'delivery-receipts.ndjson']) {
    if (ndjsonHasMessage(path.join(resolvedRoot, 'logs', logName), EXPECTED_MESSAGE_ID)) {
      throw new Error(`known_omar_recovery_existing_receipt:${logName}`)
    }
  }

  const recoveryAt = new Date(now).toISOString()
  if (!Number.isFinite(Date.parse(recoveryAt))) throw new Error('known_omar_recovery_time_invalid')
  const recoveredPacket = buildRecoveryPacket(packet, recoveryAt)
  const recoveredBytes = Buffer.from(`${JSON.stringify(recoveredPacket, null, 2)}\n`, 'utf8')
  fs.mkdirSync(inboxDir, { recursive: true, mode: 0o700 })
  const tempFile = path.join(inboxDir, `.${EXPECTED_MESSAGE_ID}.${process.pid}.operator-recovery.tmp`)
  const tempDescriptor = fs.openSync(tempFile, 'wx', 0o600)
  try {
    fs.writeFileSync(tempDescriptor, recoveredBytes)
    fs.fsyncSync(tempDescriptor)
  } finally { fs.closeSync(tempDescriptor) }
  if (sha256(fs.readFileSync(tempFile)) !== sha256(recoveredBytes)) {
    fs.unlinkSync(tempFile)
    throw new Error('known_omar_recovery_temp_readback_mismatch')
  }

  const archiveDir = path.join(resolvedRoot, 'outbox_human_agent_required', 'incident-recovered')
  fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 })
  const archiveFile = path.join(archiveDir, `${Date.now()}-${path.basename(holdFile)}`)
  fs.renameSync(tempFile, inboxFile)
  fsyncDirectory(inboxDir)
  fs.renameSync(holdFile, archiveFile)
  fsyncDirectory(path.dirname(holdFile))
  fsyncDirectory(archiveDir)

  const receiptFile = path.join(
    resolvedRoot,
    'control-locks',
    `scv-known-omar-info-hold-recovery-${Date.now()}.json`
  )
  writePrivateJsonExclusive(receiptFile, {
    schema: RECOVERY_SCHEMA,
    ok: true,
    recovered_at_utc: recoveryAt,
    release_id: release.release_id,
    release_fingerprint_sha256: release.content_fingerprint_sha256,
    contact_id_sha256: sha256(EXPECTED_CONTACT_ID),
    message_id_sha256: sha256(EXPECTED_MESSAGE_ID),
    normalized_text_sha256: EXPECTED_NORMALIZED_TEXT_SHA256,
    inbox_file_name: path.basename(inboxFile),
    archived_hold_file_name: path.basename(archiveFile),
    operator_recovery_lock_version: VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION,
    exact_debug_identity_only: true,
    customer_scope_allowed: false,
    raw_message_content_included: false,
    secrets_included: false
  })
  return {
    ok: true,
    schema: RECOVERY_SCHEMA,
    recovered_at_utc: recoveryAt,
    release_id: release.release_id,
    release_fingerprint_sha256: release.content_fingerprint_sha256,
    inbox_file_name: path.basename(inboxFile),
    archived_hold_file_name: path.basename(archiveFile),
    receipt_file_name: path.basename(receiptFile),
    exact_debug_identity_only: true
  }
}

function main() {
  const release = verifySingleRelease({ root: __dirname, env: process.env })
  const result = recoverKnownOmarInfoHold({
    root: process.env.SCV_ROOT || __dirname,
    env: process.env,
    release
  })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (require.main === module) {
  try { main() } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: String(error?.message || error).slice(0, 1000)
    })}\n`)
    process.exitCode = 1
  }
}

module.exports = {
  RECOVERY_SCHEMA,
  EXPECTED_RELEASE_ID,
  EXPECTED_CONTACT_ID,
  EXPECTED_MESSAGE_ID,
  EXPECTED_NORMALIZED_TEXT_SHA256,
  normalizeText,
  exactHoldFiles,
  assertExactHoldPacket,
  assertStateAndHistory,
  buildRecoveryPacket,
  recoverKnownOmarInfoHold
}
