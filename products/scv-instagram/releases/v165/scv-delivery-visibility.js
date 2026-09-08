#!/usr/bin/env node
'use strict'

// ============================================================
// DELIVERY VISIBILITY TRUTH (owner directive 2026-09-02).
//
// ManyChat answers sendContent with {"status":"success"} and no provider
// message id. Production has no Instagram thread client, so that acceptance
// is terminal for transport (never resend) but says nothing about whether the
// reply is visible in the Instagram thread. This module separates the four
// states the runtime must never blur:
//
//   confirmed_visible                     provider accepted AND a thread probe
//                                         saw the exact text
//   provider_accepted_visibility_unknown  provider accepted, no receipt id,
//                                         no visibility channel (production)
//   confirmed_failure                     provider definitively rejected the
//                                         send (nothing can be visible)
//   transport_exception_outcome_unknown   the request may or may not have
//                                         reached the provider (exception,
//                                         timeout, 5xx); never resend blindly
//
// `delivery_outcome_ambiguous` keeps its historical meaning (provider
// acceptance itself is unknown). `delivery_visibility_unknown` is the new,
// separate flag: acceptance is known but Instagram visibility is not.
// A newer inbound from the same client is NEVER visibility evidence: the
// client may be re-sending precisely because the reply never appeared.
// ============================================================

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SCV_DELIVERY_VISIBILITY_VERSION = 'scv-delivery-visibility-2026-09-02-v1-four-state-truth'
const DELIVERY_VISIBILITY_LEDGER_SCHEMA = 'scv-delivery-visibility-reconciliation-2026-09-02-v1'
const DELIVERY_VISIBILITY_LEDGER_FILE = 'delivery-visibility-reconciliation.ndjson'

const VISIBILITY_STATES = Object.freeze({
  CONFIRMED_VISIBLE: 'confirmed_visible',
  PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN: 'provider_accepted_visibility_unknown',
  CONFIRMED_FAILURE: 'confirmed_failure',
  TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN: 'transport_exception_outcome_unknown'
})

const VISIBILITY_CONFIRMATION_SOURCES = Object.freeze({
  NONE: 'none',
  INSTAGRAM_THREAD_PROBE: 'instagram_thread_probe',
  OPERATOR_THREAD_REVIEW: 'operator_instagram_thread_review'
})

const RECONCILIATION_RECORD_TYPES = Object.freeze({
  PENDING: 'visibility_pending',
  CONFIRMED_AT_SEND: 'visibility_confirmed_at_send',
  RESOLUTION: 'visibility_resolution'
})

const RESOLUTIONS = Object.freeze({
  CONFIRMED_VISIBLE: 'confirmed_visible',
  CONFIRMED_NOT_VISIBLE: 'confirmed_not_visible'
})

const MAX_LEDGER_READ_BYTES = 8 * 1024 * 1024

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''))
}

// Classify the final sender body (outbound-scv2 result body) into exactly one
// visibility state. Works for bodies produced before this module existed.
function classifyVisibilityState(body = {}, options = {}) {
  const accepted = body?.delivery_accepted === true
  const confirmed = body?.delivery_confirmed === true
  const ambiguous = body?.delivery_outcome_ambiguous === true || body?.do_not_retry === true
  if (confirmed) return VISIBILITY_STATES.CONFIRMED_VISIBLE
  if (accepted) return VISIBILITY_STATES.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN
  if (ambiguous || options.transportException === true) {
    return VISIBILITY_STATES.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN
  }
  return VISIBILITY_STATES.CONFIRMED_FAILURE
}

function visibilityFieldsForState(state, options = {}) {
  const confirmed = state === VISIBILITY_STATES.CONFIRMED_VISIBLE
  return {
    visibility_state: state,
    visibility_confirmed: confirmed,
    delivery_visibility_unknown:
      state === VISIBILITY_STATES.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN ||
      state === VISIBILITY_STATES.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN,
    visibility_confirmation_source: confirmed
      ? String(options.confirmationSource || VISIBILITY_CONFIRMATION_SOURCES.INSTAGRAM_THREAD_PROBE)
      : VISIBILITY_CONFIRMATION_SOURCES.NONE,
    newer_inbound_is_visibility_proof: false
  }
}

function ledgerPath(root) {
  return path.join(String(root || ''), 'logs', DELIVERY_VISIBILITY_LEDGER_FILE)
}

function readLedgerRecords(root) {
  const file = ledgerPath(root)
  if (!fs.existsSync(file)) return []
  let descriptor
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size <= 0) return []
    const length = Math.min(stat.size, MAX_LEDGER_READ_BYTES)
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
        return record && typeof record === 'object' && !Array.isArray(record) &&
          record.schema === DELIVERY_VISIBILITY_LEDGER_SCHEMA
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

function appendLedgerRecord(root, record) {
  const file = ledgerPath(root)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const line = `${JSON.stringify(record)}\n`
  const descriptor = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0),
    0o600
  )
  try {
    fs.writeFileSync(descriptor, line)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  return record
}

function attemptKey(record) {
  return `${String(record?.transport_attempt_id || '')}:${Number(record?.bubble_index) || 0}`
}

// One reconciliation entry per accepted transport attempt. The entry carries
// only hashes and evidence pointers (never the DM text), survives the outbox
// file removal, and is closed only by an explicit resolution record.
function recordDeliveryVisibility(root, details = {}) {
  const transportAttemptId = String(details.transport_attempt_id || '')
  if (!validSha256(transportAttemptId)) throw new Error('delivery_visibility_transport_attempt_id_invalid')
  const state = String(details.visibility_state || '')
  if (!Object.values(VISIBILITY_STATES).includes(state)) throw new Error('delivery_visibility_state_invalid')
  const threadId = String(details.thread_id || '')
  const messageId = String(details.message_id || '')
  if (!threadId || !messageId) throw new Error('delivery_visibility_identity_missing')
  const existing = readLedgerRecords(root)
  const key = attemptKey({ transport_attempt_id: transportAttemptId, bubble_index: details.bubble_index })
  const duplicate = existing.find((record) =>
    (record.record_type === RECONCILIATION_RECORD_TYPES.PENDING ||
      record.record_type === RECONCILIATION_RECORD_TYPES.CONFIRMED_AT_SEND) &&
    attemptKey(record) === key
  )
  if (duplicate) return { record: duplicate, duplicate: true }
  const record = {
    schema: DELIVERY_VISIBILITY_LEDGER_SCHEMA,
    version: SCV_DELIVERY_VISIBILITY_VERSION,
    record_type: state === VISIBILITY_STATES.CONFIRMED_VISIBLE
      ? RECONCILIATION_RECORD_TYPES.CONFIRMED_AT_SEND
      : RECONCILIATION_RECORD_TYPES.PENDING,
    at: String(details.at || new Date().toISOString()),
    thread_id: threadId,
    contact_id: String(details.contact_id || threadId),
    message_id: messageId,
    bubble_index: Number(details.bubble_index) || 0,
    transport_attempt_id: transportAttemptId,
    text_sha256: validSha256(details.text_sha256) ? String(details.text_sha256).toLowerCase() : '',
    text_length: Number(details.text_length) || 0,
    delivery_status: String(details.delivery_status || ''),
    delivery_accepted: details.delivery_accepted === true,
    delivery_confirmed: details.delivery_confirmed === true,
    provider_receipt_id_present: details.provider_receipt_id_present === true,
    provider_response_file: String(details.provider_response_file || ''),
    provider_response_sha256: validSha256(details.provider_response_sha256)
      ? String(details.provider_response_sha256).toLowerCase()
      : '',
    control_receipt_sha256: validSha256(details.control_receipt_sha256)
      ? String(details.control_receipt_sha256).toLowerCase()
      : '',
    ...visibilityFieldsForState(state, { confirmationSource: details.visibility_confirmation_source }),
    reconciliation_status: state === VISIBILITY_STATES.CONFIRMED_VISIBLE ? 'closed' : 'open',
    raw_message_text_included: false,
    secrets_included: false
  }
  appendLedgerRecord(root, record)
  return { record, duplicate: false }
}

// Operator-only closure. Requires the exact transport attempt id; the
// resolution is appended, never edited, and never triggers a resend.
function resolveDeliveryVisibility(root, details = {}) {
  const transportAttemptId = String(details.transport_attempt_id || '')
  if (!validSha256(transportAttemptId)) throw new Error('delivery_visibility_transport_attempt_id_invalid')
  const resolution = String(details.resolution || '')
  if (!Object.values(RESOLUTIONS).includes(resolution)) throw new Error('delivery_visibility_resolution_invalid')
  const source = String(details.source || '')
  if (!source || source === VISIBILITY_CONFIRMATION_SOURCES.NONE) throw new Error('delivery_visibility_resolution_source_required')
  const bubbleIndex = Number(details.bubble_index) || 0
  const existing = readLedgerRecords(root)
  const key = attemptKey({ transport_attempt_id: transportAttemptId, bubble_index: bubbleIndex })
  const pending = existing.find((record) =>
    record.record_type === RECONCILIATION_RECORD_TYPES.PENDING && attemptKey(record) === key
  )
  if (!pending) throw new Error('delivery_visibility_pending_record_missing')
  const alreadyResolved = existing.find((record) =>
    record.record_type === RECONCILIATION_RECORD_TYPES.RESOLUTION && attemptKey(record) === key
  )
  if (alreadyResolved) return { record: alreadyResolved, duplicate: true }
  const record = {
    schema: DELIVERY_VISIBILITY_LEDGER_SCHEMA,
    version: SCV_DELIVERY_VISIBILITY_VERSION,
    record_type: RECONCILIATION_RECORD_TYPES.RESOLUTION,
    at: String(details.at || new Date().toISOString()),
    thread_id: pending.thread_id,
    contact_id: pending.contact_id,
    message_id: pending.message_id,
    bubble_index: bubbleIndex,
    transport_attempt_id: transportAttemptId,
    text_sha256: pending.text_sha256,
    resolution,
    visibility_state: resolution === RESOLUTIONS.CONFIRMED_VISIBLE
      ? VISIBILITY_STATES.CONFIRMED_VISIBLE
      : VISIBILITY_STATES.CONFIRMED_FAILURE,
    visibility_confirmed: resolution === RESOLUTIONS.CONFIRMED_VISIBLE,
    visibility_confirmation_source: source,
    resend_performed: false,
    note_sha256: details.note ? sha256(details.note) : '',
    raw_message_text_included: false,
    secrets_included: false
  }
  appendLedgerRecord(root, record)
  return { record, duplicate: false }
}

function summarizeDeliveryVisibility(root, now = Date.now()) {
  const records = readLedgerRecords(root)
  const resolvedKeys = new Set(
    records
      .filter((record) => record.record_type === RECONCILIATION_RECORD_TYPES.RESOLUTION)
      .map(attemptKey)
  )
  const resolutions = records.filter((record) => record.record_type === RECONCILIATION_RECORD_TYPES.RESOLUTION)
  const pending = records.filter((record) =>
    record.record_type === RECONCILIATION_RECORD_TYPES.PENDING && !resolvedKeys.has(attemptKey(record))
  )
  const confirmedAtSend = records.filter((record) => record.record_type === RECONCILIATION_RECORD_TYPES.CONFIRMED_AT_SEND)
  const oldestPending = pending
    .map((record) => Date.parse(String(record.at || '')))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)[0]
  const last = records[records.length - 1] || null
  return {
    version: SCV_DELIVERY_VISIBILITY_VERSION,
    ledger_present: records.length > 0,
    unconfirmed_open_count: pending.length,
    confirmed_at_send_count: confirmedAtSend.length,
    resolved_visible_count: resolutions.filter((record) => record.resolution === RESOLUTIONS.CONFIRMED_VISIBLE).length,
    resolved_not_visible_count: resolutions.filter((record) => record.resolution === RESOLUTIONS.CONFIRMED_NOT_VISIBLE).length,
    oldest_unconfirmed_at: Number.isFinite(oldestPending) ? new Date(oldestPending).toISOString() : '',
    oldest_unconfirmed_age_ms: Number.isFinite(oldestPending) ? Math.max(0, now - oldestPending) : null,
    last_visibility_state: last ? String(last.visibility_state || '') : '',
    last_record_at: last ? String(last.at || '') : '',
    newer_inbound_is_visibility_proof: false
  }
}

// Drift-monitor input: an operational (never critical) alert that keeps the
// unconfirmed backlog visible. Production has no visibility channel, so this
// alert is expected to stay present; it is honest operational debt, not proof
// that the sealed runtime drifted.
function deliveryVisibilityAlerts(root, options = {}) {
  const now = Number(options.now) || Date.now()
  const alertAfterMs = Math.max(60000, Number(options.alertAfterMs) || (15 * 60 * 1000))
  const summary = summarizeDeliveryVisibility(root, now)
  if (summary.unconfirmed_open_count <= 0) return []
  if (!(Number(summary.oldest_unconfirmed_age_ms) >= alertAfterMs)) return []
  return [{
    reason: 'delivery_visibility_unconfirmed_backlog',
    severity: 'operational',
    unconfirmed_open_count: summary.unconfirmed_open_count,
    oldest_unconfirmed_at: summary.oldest_unconfirmed_at,
    oldest_unconfirmed_age_ms: summary.oldest_unconfirmed_age_ms,
    confirmation_channel: VISIBILITY_CONFIRMATION_SOURCES.NONE,
    newer_inbound_is_visibility_proof: false
  }]
}

module.exports = {
  SCV_DELIVERY_VISIBILITY_VERSION,
  DELIVERY_VISIBILITY_LEDGER_SCHEMA,
  DELIVERY_VISIBILITY_LEDGER_FILE,
  VISIBILITY_STATES,
  VISIBILITY_CONFIRMATION_SOURCES,
  RECONCILIATION_RECORD_TYPES,
  RESOLUTIONS,
  classifyVisibilityState,
  visibilityFieldsForState,
  ledgerPath,
  readLedgerRecords,
  recordDeliveryVisibility,
  resolveDeliveryVisibility,
  summarizeDeliveryVisibility,
  deliveryVisibilityAlerts
}
