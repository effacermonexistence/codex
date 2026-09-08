#!/usr/bin/env node
'use strict'

// Operator CLI for the delivery visibility reconciliation ledger.
//
//   node scv-delivery-visibility-reconcile.js summary
//   node scv-delivery-visibility-reconcile.js list [--limit 50]
//   node scv-delivery-visibility-reconcile.js resolve \
//        --transport-attempt-id <64 hex> [--bubble-index 0] \
//        --resolution confirmed_visible|confirmed_not_visible \
//        --source operator_instagram_thread_review [--note "..."]
//
// It never sends anything. A resolution is an appended record bound to the
// exact transport attempt id; it does not edit history, does not clear
// idempotency markers and does not requeue the outbox.

const path = require('path')
const {
  RESOLUTIONS,
  RECONCILIATION_RECORD_TYPES,
  readLedgerRecords,
  resolveDeliveryVisibility,
  summarizeDeliveryVisibility
} = require(path.join(__dirname, 'scv-delivery-visibility.js'))

const ROOT = process.env.SCV_ROOT || __dirname

function parseArguments(argv) {
  const command = String(argv[0] || 'summary')
  const values = {}
  for (let index = 1; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error(`invalid_argument:${key}`)
    const value = argv[index + 1]
    if (value === undefined || String(value).startsWith('--')) {
      values[key.slice(2)] = 'true'
    } else {
      values[key.slice(2)] = String(value)
      index += 1
    }
  }
  return { command, values }
}

function redactedRecord(record) {
  return {
    record_type: record.record_type,
    at: record.at,
    thread_id_sha256_prefix: require('crypto').createHash('sha256').update(String(record.thread_id || '')).digest('hex').slice(0, 16),
    message_id: record.message_id,
    bubble_index: record.bubble_index,
    transport_attempt_id: record.transport_attempt_id,
    delivery_status: record.delivery_status,
    visibility_state: record.visibility_state,
    visibility_confirmed: record.visibility_confirmed === true,
    reconciliation_status: record.reconciliation_status || (record.resolution ? 'resolution' : ''),
    resolution: record.resolution || '',
    provider_response_file: record.provider_response_file || '',
    text_length: record.text_length || 0
  }
}

function main(argv = process.argv.slice(2)) {
  const { command, values } = parseArguments(argv)
  if (command === 'summary') return summarizeDeliveryVisibility(ROOT)
  if (command === 'list') {
    const limit = Math.max(1, Math.min(500, Number(values.limit) || 50))
    const records = readLedgerRecords(ROOT)
    const resolvedKeys = new Set(records
      .filter((record) => record.record_type === RECONCILIATION_RECORD_TYPES.RESOLUTION)
      .map((record) => `${record.transport_attempt_id}:${record.bubble_index}`))
    const open = records.filter((record) =>
      record.record_type === RECONCILIATION_RECORD_TYPES.PENDING &&
      !resolvedKeys.has(`${record.transport_attempt_id}:${record.bubble_index}`)
    )
    return {
      ok: true,
      open_count: open.length,
      records: open.slice(-limit).map(redactedRecord)
    }
  }
  if (command === 'resolve') {
    const result = resolveDeliveryVisibility(ROOT, {
      transport_attempt_id: values['transport-attempt-id'],
      bubble_index: Number(values['bubble-index'] || 0),
      resolution: values.resolution,
      source: values.source,
      note: values.note || ''
    })
    return { ok: true, duplicate: result.duplicate, record: redactedRecord(result.record), resend_performed: false }
  }
  throw new Error(`unknown_command:${command}`)
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.message || error) })}\n`)
    process.exit(1)
  }
}

module.exports = { main, parseArguments, RESOLUTIONS }
