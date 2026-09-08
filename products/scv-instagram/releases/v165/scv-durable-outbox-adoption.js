#!/usr/bin/env node
'use strict'

// Crash-safe adoption boundary shared by the controller queue writer and the
// durable outbox worker. File existence alone is never delivery authority.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  validateControlReceipt
} = require('./scv-single-control-plane.js')

const OUTBOX_ADOPTION_MARKER_SCHEMA =
  'scv-durable-outbox-adoption-marker-2026-08-25-v1'
const OUTBOX_ADOPTION_HUMAN_HOLD_SCHEMA =
  'scv-durable-outbox-adoption-human-hold-2026-08-25-v1'
const MAX_OUTBOX_ADOPTION_BYTES = 2 * 1024 * 1024
const SHA256_RE = /^[a-f0-9]{64}$/

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])])
  )
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(stableValue(value))}\n`, 'utf8')
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (stat.isDirectory() && !stat.isSymbolicLink()) fs.chmodSync(directory, 0o700)
  return directory
}

function adoptionPaths(root) {
  const resolved = path.resolve(String(root || ''))
  if (!resolved) throw new Error('outbox_adoption_root_invalid')
  return {
    root: resolved,
    outbox: ensureDirectory(path.join(resolved, 'outbox')),
    markers: ensureDirectory(path.join(resolved, 'outbox-idempotency')),
    corrupt: ensureDirectory(path.join(resolved, 'outbox_quarantine_corrupt_adoption')),
    human: ensureDirectory(path.join(resolved, 'outbox_human_agent_required'))
  }
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
      throw new Error('outbox_adoption_short_write')
    }
    offset += written
  }
}

function durableCreateBytes(file, bytes) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (payload.length < 1 || payload.length > MAX_OUTBOX_ADOPTION_BYTES) {
    throw new Error('outbox_adoption_bytes_out_of_bounds')
  }
  const directory = ensureDirectory(path.dirname(file))
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
    writeAll(descriptor, payload)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    // link(2) is the publication primitive: unlike exists+rename, it cannot
    // replace a winner created by another process between the check and the
    // publish operation. The temporary and destination are in one directory,
    // so the hard-link is same-filesystem and atomic.
    try {
      fs.linkSync(temporary, file)
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error('outbox_adoption_target_exists')
      }
      throw error
    }
    fsyncDirectory(directory)
    fs.unlinkSync(temporary)
    fsyncDirectory(directory)
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
    try { fs.unlinkSync(temporary) } catch {}
    throw error
  }
  return { file, sha256: sha256(payload), size: payload.length }
}

function durableCreateJson(file, value) {
  return durableCreateBytes(file, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))
}

function readBoundedRegularJson(file) {
  let descriptor
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    const stat = fs.fstatSync(descriptor)
    if (
      !stat.isFile() || stat.size < 1 ||
      stat.size > MAX_OUTBOX_ADOPTION_BYTES ||
      (stat.mode & 0o077) !== 0
    ) throw new Error('outbox_adoption_file_not_private_bounded_regular')
    const bytes = fs.readFileSync(descriptor)
    if (bytes.length !== stat.size) throw new Error('outbox_adoption_file_changed')
    let value
    try { value = JSON.parse(bytes.toString('utf8')) } catch {
      throw new Error('outbox_adoption_json_invalid')
    }
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error('outbox_adoption_json_object_required')
    }
    return { ok: true, file, bytes, sha256: sha256(bytes), value }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function packetAdoptionView(packet) {
  return {
    contact_id: String(packet?.contact_id || ''),
    thread_id: String(packet?.thread_id || packet?.contact_id || ''),
    instagram_username: String(packet?.instagram_username || ''),
    message_id: String(packet?.message_id || ''),
    text: String(packet?.text || ''),
    bubble_index: Number(packet?.bubble_index),
    bubble_count: Number(packet?.bubble_count),
    // Human pacing is sampled per adoption attempt. The controller-authorized
    // semantic payload is the exact ordered text, not the sampled delay.
    bubble: { text: String(packet?.bubble?.text || '') },
    bubbles: (Array.isArray(packet?.bubbles) ? packet.bubbles : [])
      .map((bubble) => ({ text: String(bubble?.text || '') })),
    source: String(packet?.source || ''),
    authority: packet?.authority && typeof packet.authority === 'object'
      ? packet.authority
      : {},
    control_receipt: packet?.control_receipt &&
      typeof packet.control_receipt === 'object'
      ? packet.control_receipt
      : {},
    allow_duplicate_url_resend: packet?.allow_duplicate_url_resend === true,
    force_send_urls: Array.isArray(packet?.force_send_urls)
      ? packet.force_send_urls
      : [],
    authority_transport_flags: packet?.authority_transport_flags &&
      typeof packet.authority_transport_flags === 'object'
      ? packet.authority_transport_flags
      : null,
    operator_recovery: packet?.operator_recovery === true,
    operator_recovery_lock_version: String(packet?.operator_recovery_lock_version || ''),
    operator_recovery_reason: String(packet?.operator_recovery_reason || ''),
    operator_recovery_at: String(packet?.operator_recovery_at || ''),
    recovered_from_message_id: String(packet?.recovered_from_message_id || ''),
    recovered_via: String(packet?.recovered_via || ''),
    source_interaction_at: String(packet?.source_interaction_at || ''),
    recovered_from_ig_last_interaction:
      String(packet?.recovered_from_ig_last_interaction || ''),
    manychat_latest_interaction_at:
      String(packet?.manychat_latest_interaction_at || ''),
    recovered_from_at: String(packet?.recovered_from_at || ''),
    received_at: String(packet?.received_at || ''),
    at: String(packet?.at || ''),
    created_at: String(packet?.created_at || ''),
    raw_text: String(packet?.raw_text || ''),
    delivery_pacing_lock_version:
      String(packet?.delivery_pacing_lock_version || ''),
    delivery_pacing_rule: String(packet?.delivery_pacing_rule || ''),
    delay_multiplier: Number(packet?.delay_multiplier || 0),
    base_delay_multiplier: Number(packet?.base_delay_multiplier || 0),
    fast_delay_target: packet?.fast_delay_target === true,
    force_zero_delay: packet?.force_zero_delay === true,
    reference_attachment_grace_ms:
      Number(packet?.reference_attachment_grace_ms || 0),
    adaptive_policy: packet?.adaptive_policy && typeof packet.adaptive_policy === 'object'
      ? packet.adaptive_policy
      : {}
  }
}

function packetAdoptionSha256(packet) {
  return sha256(canonicalBytes(packetAdoptionView(packet)))
}

function idempotencyKeyForPacket(packet) {
  const receiptSha = String(packet?.control_receipt?.receipt_sha256 || '')
  const bubbleIndex = Number(packet?.bubble_index)
  if (!SHA256_RE.test(receiptSha) || !Number.isInteger(bubbleIndex) || bubbleIndex < 0) {
    throw new Error('outbox_adoption_idempotency_identity_invalid')
  }
  return `${receiptSha}-${bubbleIndex}`
}

function validateAdoptedPacket(root, packet, expectedPacket = null) {
  if (!packet || Array.isArray(packet) || typeof packet !== 'object') {
    return { valid: false, reason: 'outbox_adoption_packet_invalid' }
  }
  const receipt = validateControlReceipt(packet, {
    root, requireLedger: true, requirePayload: true
  })
  if (!receipt.valid) {
    return { valid: false, reason: `outbox_adoption_receipt_invalid:${receipt.reason}` }
  }
  if (
    packet.source !== SCV_SINGLE_CONTROL_SOURCE ||
    packet?.authority?.controller !== SCV_SINGLE_CONTROL_PLANE_ID ||
    packet?.authority?.runner !== 'scv-single-control-plane'
  ) return { valid: false, reason: 'outbox_adoption_authority_invalid' }
  const index = Number(packet.bubble_index)
  const bubbles = Array.isArray(packet.bubbles) ? packet.bubbles : []
  if (
    !Number.isInteger(index) || index < 0 || index >= bubbles.length ||
    Number(packet.bubble_count) !== bubbles.length ||
    String(packet?.bubble?.text || '') !== String(bubbles[index]?.text || '')
  ) return { valid: false, reason: 'outbox_adoption_bubble_binding_invalid' }
  let key
  try { key = idempotencyKeyForPacket(packet) } catch (error) {
    return { valid: false, reason: String(error?.message || error) }
  }
  const adoptionSha256 = packetAdoptionSha256(packet)
  if (
    expectedPacket &&
    adoptionSha256 !== packetAdoptionSha256(expectedPacket)
  ) return { valid: false, reason: 'outbox_adoption_expected_packet_mismatch' }
  return { valid: true, reason: 'outbox_adoption_packet_valid', key, adoptionSha256 }
}

function markerValue(packet, idempotencyKey, queueFileSha256, now = new Date()) {
  return {
    schema: OUTBOX_ADOPTION_MARKER_SCHEMA,
    idempotency_key: idempotencyKey,
    receipt_sha256: String(packet?.control_receipt?.receipt_sha256 || ''),
    packet_adoption_sha256: packetAdoptionSha256(packet),
    queue_file_sha256: String(queueFileSha256 || ''),
    contact_id: String(packet?.contact_id || ''),
    thread_id: String(packet?.thread_id || packet?.contact_id || ''),
    instagram_username: String(packet?.instagram_username || ''),
    message_id: String(packet?.message_id || ''),
    bubble_index: Number(packet?.bubble_index),
    adopted_at: now.toISOString(),
    adopted_packet: packet
  }
}

function validateMarker(root, marker, expectedPacket, idempotencyKey, options = {}) {
  if (!marker || Array.isArray(marker) || typeof marker !== 'object') {
    return { valid: false, reason: 'outbox_adoption_marker_invalid' }
  }
  const expectedReceipt = String(expectedPacket?.control_receipt?.receipt_sha256 || '')
  const expectedIndex = Number(expectedPacket?.bubble_index)
  if (marker.schema !== OUTBOX_ADOPTION_MARKER_SCHEMA) {
    const legacyValid = options.allowLegacy === true &&
      String(marker.idempotency_key || '') === idempotencyKey &&
      String(marker.receipt_sha256 || '') === expectedReceipt &&
      String(marker.thread_id || '') === String(expectedPacket?.thread_id || expectedPacket?.contact_id || '') &&
      String(marker.message_id || '') === String(expectedPacket?.message_id || '') &&
      Number(marker.bubble_index) === expectedIndex
    return legacyValid
      ? { valid: true, legacy: true, reason: 'outbox_adoption_legacy_marker_valid' }
      : { valid: false, reason: 'outbox_adoption_marker_schema_invalid' }
  }
  const adopted = validateAdoptedPacket(root, marker.adopted_packet, expectedPacket)
  if (!adopted.valid) {
    return { valid: false, reason: `outbox_adoption_marker_packet_invalid:${adopted.reason}` }
  }
  if (
    String(marker.idempotency_key || '') !== idempotencyKey ||
    String(marker.receipt_sha256 || '') !== expectedReceipt ||
    String(marker.packet_adoption_sha256 || '') !== adopted.adoptionSha256 ||
    !SHA256_RE.test(String(marker.queue_file_sha256 || '')) ||
    String(marker.contact_id || '') !== String(expectedPacket?.contact_id || '') ||
    String(marker.thread_id || '') !== String(expectedPacket?.thread_id || expectedPacket?.contact_id || '') ||
    String(marker.instagram_username || '') !== String(expectedPacket?.instagram_username || '') ||
    String(marker.message_id || '') !== String(expectedPacket?.message_id || '') ||
    Number(marker.bubble_index) !== expectedIndex ||
    !Number.isFinite(Date.parse(String(marker.adopted_at || '')))
  ) return { valid: false, reason: 'outbox_adoption_marker_binding_invalid' }
  return { valid: true, legacy: false, reason: 'outbox_adoption_marker_valid' }
}

function quarantineArtifact(root, file, kind, reason) {
  const paths = adoptionPaths(root)
  let stat
  try { stat = fs.lstatSync(file) } catch {
    return { moved: false, reason: 'outbox_adoption_artifact_missing' }
  }
  const base = path.basename(file)
  const dest = path.join(
    paths.corrupt,
    `${Date.now()}-${crypto.randomUUID()}-${base}`
  )
  let artifactSha256 = ''
  if (stat.isFile() && stat.size >= 0 && stat.size <= MAX_OUTBOX_ADOPTION_BYTES) {
    try { artifactSha256 = sha256(fs.readFileSync(file)) } catch {}
  }
  fs.renameSync(file, dest)
  if (stat.isFile()) {
    try { fs.chmodSync(dest, 0o600) } catch {}
  }
  fsyncDirectory(path.dirname(file))
  fsyncDirectory(paths.corrupt)
  const record = {
    schema: OUTBOX_ADOPTION_HUMAN_HOLD_SCHEMA,
    artifact_kind: String(kind || 'unknown'),
    reason: String(reason || 'outbox_adoption_artifact_invalid'),
    original_basename: base,
    quarantined_basename: path.basename(dest),
    artifact_sha256: artifactSha256,
    artifact_size: Number(stat.size || 0),
    quarantined_at: new Date().toISOString(),
    raw_values_included: false,
    secrets_included: false
  }
  const recordFile = path.join(paths.corrupt, `${path.basename(dest)}.receipt.json`)
  durableCreateJson(recordFile, record)
  return { moved: true, file, dest, recordFile, record }
}

function writeHumanHold(root, idempotencyKey, reason, quarantine = null) {
  const paths = adoptionPaths(root)
  const file = path.join(
    paths.human,
    `outbox-adoption-hold-${Date.now()}-${crypto.randomUUID()}.json`
  )
  const value = {
    schema: OUTBOX_ADOPTION_HUMAN_HOLD_SCHEMA,
    idempotency_key_sha256: sha256(String(idempotencyKey || '')),
    reason: String(reason || 'outbox_adoption_manual_reconciliation_required'),
    corrupt_artifact_sha256: String(quarantine?.record?.artifact_sha256 || ''),
    queued_for_human_agent_at: new Date().toISOString(),
    raw_values_included: false,
    secrets_included: false
  }
  const written = durableCreateJson(file, value)
  return { file, value, written }
}

function inspectPacketFile(root, file, expectedPacket) {
  try {
    const loaded = readBoundedRegularJson(file)
    const verdict = validateAdoptedPacket(root, loaded.value, expectedPacket)
    return { ...loaded, ...verdict }
  } catch (error) {
    return { valid: false, file, reason: String(error?.message || error) }
  }
}

function inspectMarkerFile(root, file, expectedPacket, idempotencyKey, options = {}) {
  try {
    const loaded = readBoundedRegularJson(file)
    const verdict = validateMarker(
      root, loaded.value, expectedPacket, idempotencyKey, options
    )
    return { ...loaded, ...verdict }
  } catch (error) {
    return { valid: false, file, reason: String(error?.message || error) }
  }
}

function ensureMarkerForPacket(
  root,
  markerFile,
  packet,
  idempotencyKey,
  queueSha256,
  options = {}
) {
  if (fs.existsSync(markerFile)) {
    const current = inspectMarkerFile(
      root, markerFile, packet, idempotencyKey, { allowLegacy: false }
    )
    if (current.valid) return { created: false, repaired: false, file: markerFile }
    quarantineArtifact(root, markerFile, 'idempotency_marker', current.reason)
  }
  if (typeof options.beforePublish === 'function') options.beforePublish()
  let written
  try {
    written = durableCreateJson(
      markerFile,
      markerValue(packet, idempotencyKey, queueSha256)
    )
  } catch (error) {
    if (String(error?.message || error) !== 'outbox_adoption_target_exists') {
      throw error
    }
    // A marker can win after the initial exists check. Accept only the exact
    // strict packet/key binding; never turn EEXIST into queue reconstruction.
    const concurrent = inspectMarkerFile(
      root,
      markerFile,
      packet,
      idempotencyKey,
      { allowLegacy: false }
    )
    if (!concurrent.valid) {
      throw new Error(
        `outbox_adoption_concurrent_marker_invalid:${concurrent.reason}`
      )
    }
    return {
      created: false,
      repaired: false,
      concurrent: true,
      file: markerFile
    }
  }
  return { created: true, repaired: true, file: markerFile, written }
}

function adoptOutboxPacket(options = {}) {
  const root = path.resolve(String(options.root || ''))
  const packet = options.packet
  const paths = adoptionPaths(root)
  const packetVerdict = validateAdoptedPacket(root, packet, packet)
  if (!packetVerdict.valid) throw new Error(packetVerdict.reason)
  const idempotencyKey = packetVerdict.key
  if (
    options.idempotencyKey &&
    String(options.idempotencyKey) !== idempotencyKey
  ) throw new Error('outbox_adoption_requested_key_mismatch')
  const file = path.join(paths.outbox, `${idempotencyKey}.json`)
  const lock = `${file}.lock`
  const marker = path.join(paths.markers, `${idempotencyKey}.json`)
  let repaired = false
  let queueInspection = null

  if (fs.existsSync(file)) {
    queueInspection = inspectPacketFile(root, file, packet)
    if (queueInspection.valid) {
      const markerResult = ensureMarkerForPacket(
        root, marker, packet, idempotencyKey, queueInspection.sha256
      )
      return {
        ok: true, idempotent: true, repaired: markerResult.repaired,
        reason: 'outbox_adoption_existing_queue_valid',
        file, marker, idempotencyKey
      }
    }
    quarantineArtifact(root, file, 'outbox_queue', queueInspection.reason)
    repaired = true
  }

  if (fs.existsSync(lock)) {
    const lockInspection = inspectPacketFile(root, lock, packet)
    if (lockInspection.valid) {
      const markerResult = ensureMarkerForPacket(
        root, marker, packet, idempotencyKey, lockInspection.sha256
      )
      return {
        ok: true, idempotent: true, repaired: markerResult.repaired,
        reason: 'outbox_adoption_existing_lock_valid',
        file, lock, marker, idempotencyKey
      }
    }
    writeHumanHold(root, idempotencyKey,
      `outbox_adoption_lock_invalid:${lockInspection.reason}`)
    throw new Error('outbox_adoption_lock_invalid_manual_reconciliation_required')
  }

  // A valid marker with no valid active queue is the terminal idempotency
  // boundary. A corrupt file appearing at the same queue name must not make
  // the controller recreate a packet that may already have been delivered.
  // The corrupt artifact was preserved above; let the bound marker win.
  if (fs.existsSync(marker)) {
    const markerInspection = inspectMarkerFile(
      root, marker, packet, idempotencyKey, { allowLegacy: true }
    )
    if (markerInspection.valid) {
      if (markerInspection.legacy) {
        quarantineArtifact(root, marker, 'legacy_idempotency_marker',
          markerInspection.reason)
        ensureMarkerForPacket(
          root, marker, packet, idempotencyKey,
          sha256(Buffer.from('legacy-marker-upgrade-with-no-active-queue'))
        )
      }
      return {
        ok: true, idempotent: true,
        repaired: repaired || markerInspection.legacy === true,
        reason: 'outbox_adoption_terminal_marker_valid',
        file, marker, idempotencyKey
      }
    }
    const quarantined = quarantineArtifact(
      root, marker, 'idempotency_marker', markerInspection.reason
    )
    writeHumanHold(root, idempotencyKey,
      'outbox_adoption_marker_invalid_without_active_queue', quarantined)
    throw new Error('outbox_adoption_marker_invalid_manual_reconciliation_required')
  }

  const queueBytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, 'utf8')
  const queueWritten = durableCreateBytes(file, queueBytes)
  if (options.testFaultAfterQueue === true) {
    throw new Error('outbox_adoption_test_fault_after_queue_before_marker')
  }
  ensureMarkerForPacket(
    root, marker, packet, idempotencyKey, queueWritten.sha256
  )
  return {
    ok: true, idempotent: false, repaired,
    reason: repaired
      ? 'outbox_adoption_corrupt_queue_reconstructed'
      : 'outbox_adoption_new_queue_committed',
    file, marker, idempotencyKey
  }
}

function recoverCorruptLockFromMarker(options = {}) {
  if (options.preNetworkConfirmed !== true) {
    throw new Error('outbox_adoption_pre_network_proof_required')
  }
  const root = path.resolve(String(options.root || ''))
  const lock = path.resolve(String(options.lockFile || ''))
  const match = path.basename(lock).match(/^([a-f0-9]{64}-\d+)\.json\.lock$/)
  if (!match) return { recovered: false, reason: 'outbox_adoption_lock_name_invalid' }
  const idempotencyKey = match[1]
  const paths = adoptionPaths(root)
  const marker = path.join(paths.markers, `${idempotencyKey}.json`)
  let loaded
  try { loaded = readBoundedRegularJson(marker) } catch (error) {
    return { recovered: false, reason: String(error?.message || error) }
  }
  const expected = loaded.value?.adopted_packet
  const markerVerdict = validateMarker(
    root, loaded.value, expected, idempotencyKey, { allowLegacy: false }
  )
  if (!markerVerdict.valid) {
    return { recovered: false, reason: markerVerdict.reason }
  }

  // The caller can prove only that this process has not contacted the
  // provider since acquiring the lock. The retained adoption marker does not
  // prove that an earlier process never sent the same packet. Restoring from
  // marker bytes here could therefore turn a terminal packet into a duplicate
  // send. Until a separately durable, packet-bound pre-network transition is
  // available, the worker must move this artifact to the human no-resend hold.
  return {
    recovered: false,
    reason: 'outbox_adoption_marker_is_not_durable_pre_network_proof_no_resend',
    marker
  }
}

function holdCorruptLockForHuman(root, lockFile, reason) {
  const match = path.basename(lockFile).match(/^([a-f0-9]{64}-\d+)\.json\.lock$/)
  const idempotencyKey = match?.[1] || ''
  const quarantined = quarantineArtifact(
    root, lockFile, 'outbox_lock', reason || 'outbox_adoption_corrupt_stale_lock'
  )
  const hold = writeHumanHold(
    root, idempotencyKey,
    reason || 'outbox_adoption_corrupt_stale_lock_manual_reconciliation_required',
    quarantined
  )
  return { action: 'human_agent_hold', idempotencyKey, quarantined, hold }
}

module.exports = {
  OUTBOX_ADOPTION_MARKER_SCHEMA,
  OUTBOX_ADOPTION_HUMAN_HOLD_SCHEMA,
  MAX_OUTBOX_ADOPTION_BYTES,
  adoptionPaths,
  durableCreateBytes,
  durableCreateJson,
  readBoundedRegularJson,
  packetAdoptionView,
  packetAdoptionSha256,
  idempotencyKeyForPacket,
  validateAdoptedPacket,
  markerValue,
  validateMarker,
  inspectPacketFile,
  inspectMarkerFile,
  quarantineArtifact,
  writeHumanHold,
  ensureMarkerForPacket,
  adoptOutboxPacket,
  recoverCorruptLockFromMarker,
  holdCorruptLockForHuman
}
