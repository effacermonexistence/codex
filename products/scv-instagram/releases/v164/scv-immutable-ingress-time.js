#!/usr/bin/env node
const fs = require('fs')

const MAX_FUTURE_INGRESS_SKEW_MS = 5 * 60 * 1000
const VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION = 'scv-verified-stale-operator-recovery-lock-v1'
const VERIFIED_STALE_OPERATOR_RECOVERY_MAX_AGE_MS = 5 * 60 * 1000

// This order is a contract. Pick the first valid source timestamp; never take
// the greatest timestamp because retry/recovery bookkeeping can be newer than
// the Instagram interaction that authorized the work.
const IMMUTABLE_INGRESS_TIME_FIELDS = Object.freeze([
  'source_interaction_at',
  'recovered_from_ig_last_interaction',
  'manychat_latest_interaction_at',
  'recovered_from_at',
  'received_at',
  'at',
  'queued_at',
  'created_at'
])

function parseTimestampMs(value) {
  if (value instanceof Date) {
    const milliseconds = value.getTime()
    return Number.isFinite(milliseconds) ? milliseconds : 0
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0
  }

  const raw = String(value || '').trim()
  if (!raw) return 0
  const milliseconds = Date.parse(raw)
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : 0
}

// Shared authorization envelope for the one bounded operator recovery path.
// Inbox adds a filename identity check; internal transport and outbox preserve
// and re-check this exact tuple so the authority cannot disappear between the
// accepted inbound and its controller-authored bubbles.
function isVerifiedStaleOperatorRecoveryEnvelope(packet, now = Date.now()) {
  if (packet?.operator_recovery !== true) return false
  if (String(packet?.operator_recovery_lock_version || '') !== VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION) return false
  if (String(packet?.operator_recovery_reason || '') !== 'verified_control_plane_repair') return false

  const messageId = String(packet?.message_id || '')
  const recoveredFromMessageId = String(packet?.recovered_from_message_id || '')
  if (!messageId || recoveredFromMessageId !== messageId) return false

  const authorizedAt = parseTimestampMs(packet?.operator_recovery_at)
  const ageMs = now - authorizedAt
  return authorizedAt > 0 && ageMs >= 0 && ageMs <= VERIFIED_STALE_OPERATOR_RECOVERY_MAX_AGE_MS
}

function immutableIngressTimestamp(packet, filePath) {
  const value = packet && typeof packet === 'object' ? packet : {}

  for (const field of IMMUTABLE_INGRESS_TIME_FIELDS) {
    const timestampMs = parseTimestampMs(value[field])
    if (timestampMs > 0) {
      return { timestamp_ms: timestampMs, source: field }
    }
  }

  if (filePath) {
    try {
      const timestampMs = Number(fs.statSync(filePath).mtimeMs)
      if (Number.isFinite(timestampMs) && timestampMs > 0) {
        return { timestamp_ms: timestampMs, source: 'file_mtime' }
      }
    } catch {}
  }

  return { timestamp_ms: 0, source: 'unknown' }
}

function immutableIngressTimeMs(packet, filePath, _now) {
  return immutableIngressTimestamp(packet, filePath).timestamp_ms
}

function recoveryCutoverVerdict(packet, env = process.env, filePath, _now) {
  const timestamp = immutableIngressTimestamp(packet, filePath)
  const rawCutover = String(env?.SCV_RECOVERY_CUTOVER_AT || '').trim()

  if (!rawCutover) {
    return {
      hold: false,
      reason: 'recovery_cutover_not_configured',
      timestamp_ms: timestamp.timestamp_ms,
      source: timestamp.source,
      cutover_ms: 0
    }
  }

  const cutoverMs = parseTimestampMs(rawCutover)
  if (cutoverMs <= 0) {
    return {
      hold: true,
      reason: 'recovery_cutover_invalid',
      timestamp_ms: timestamp.timestamp_ms,
      source: timestamp.source,
      cutover_ms: 0
    }
  }

  if (timestamp.timestamp_ms <= 0) {
    return {
      hold: true,
      reason: 'recovery_ingress_time_unknown',
      timestamp_ms: 0,
      source: 'unknown',
      cutover_ms: cutoverMs
    }
  }

  if (timestamp.timestamp_ms < cutoverMs) {
    return {
      hold: true,
      reason: 'recovery_ingress_before_cutover',
      timestamp_ms: timestamp.timestamp_ms,
      source: timestamp.source,
      cutover_ms: cutoverMs
    }
  }

  return {
    hold: false,
    reason: 'recovery_ingress_at_or_after_cutover',
    timestamp_ms: timestamp.timestamp_ms,
    source: timestamp.source,
    cutover_ms: cutoverMs
  }
}

function recoveryQueueSafetyVerdict(
  packet,
  env = process.env,
  filePath,
  now = Date.now(),
  thresholdMs = 15 * 60 * 1000
) {
  const cutover = recoveryCutoverVerdict(packet, env, filePath, now)
  const timestampMs = cutover.timestamp_ms
  const ageMs = timestampMs > 0 ? now - timestampMs : Number.POSITIVE_INFINITY
  const normalizedThresholdMs = Number.isFinite(Number(thresholdMs)) && Number(thresholdMs) >= 0
    ? Number(thresholdMs)
    : 15 * 60 * 1000

  if (cutover.hold) {
    return {
      ...cutover,
      age_ms: ageMs,
      threshold_ms: normalizedThresholdMs
    }
  }

  if (timestampMs <= 0) {
    return {
      hold: true,
      reason: 'immutable_ingress_time_unknown',
      timestamp_ms: 0,
      source: 'unknown',
      cutover_ms: cutover.cutover_ms,
      age_ms: ageMs,
      threshold_ms: normalizedThresholdMs
    }
  }

  if (ageMs < -MAX_FUTURE_INGRESS_SKEW_MS) {
    return {
      hold: true,
      reason: 'immutable_ingress_time_in_future',
      timestamp_ms: timestampMs,
      source: cutover.source,
      cutover_ms: cutover.cutover_ms,
      age_ms: ageMs,
      threshold_ms: normalizedThresholdMs
    }
  }

  if (!Number.isFinite(ageMs) || ageMs > normalizedThresholdMs) {
    return {
      hold: true,
      reason: 'stale_backlog_over_threshold',
      timestamp_ms: timestampMs,
      source: cutover.source,
      cutover_ms: cutover.cutover_ms,
      age_ms: ageMs,
      threshold_ms: normalizedThresholdMs
    }
  }

  return {
    hold: false,
    reason: 'fresh_ingress_after_cutover',
    timestamp_ms: timestampMs,
    source: cutover.source,
    cutover_ms: cutover.cutover_ms,
    age_ms: ageMs,
    threshold_ms: normalizedThresholdMs
  }
}

module.exports = {
  MAX_FUTURE_INGRESS_SKEW_MS,
  VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION,
  VERIFIED_STALE_OPERATOR_RECOVERY_MAX_AGE_MS,
  IMMUTABLE_INGRESS_TIME_FIELDS,
  parseTimestampMs,
  isVerifiedStaleOperatorRecoveryEnvelope,
  immutableIngressTimestamp,
  immutableIngressTimeMs,
  recoveryCutoverVerdict,
  recoveryQueueSafetyVerdict
}
