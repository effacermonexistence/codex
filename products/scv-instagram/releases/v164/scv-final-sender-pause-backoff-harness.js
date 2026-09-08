#!/usr/bin/env node
'use strict'

// Regression for the 2026-08-26 pause-retry storm.
//
// When the final sender answers 423 (held), the outbox worker used to
// republish the bubble with an unchanged due_at, making it immediately
// eligible again. That produced hundreds of send attempts per second,
// exhausted container resources, kept the sender's identity re-verification
// failing, and ended with the reply swept into a human hold — customer
// silence. A held bubble must be rescheduled with a bounded pause-retry
// delay, and the hold log must carry the sender's own hold reason so the
// next incident is attributable from logs alone.

const fs = require('fs')
const os = require('os')
const path = require('path')

function fail(reason, extra) {
  console.log(JSON.stringify({
    type: 'final_sender_pause_backoff_harness_fail',
    reason,
    ...extra
  }))
  process.exit(1)
}

function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-pause-backoff-'))
  const appRoot = path.join(base, 'app-root')
  for (const dir of ['outbox', 'outbox_human_agent_required', 'logs']) {
    fs.mkdirSync(path.join(appRoot, dir), { recursive: true, mode: 0o700 })
  }
  process.env.SCV_ROOT = appRoot
  const worker = require(path.join(__dirname, 'outbox-worker.js'))
  if (typeof worker.releaseOutboxLockForPause !== 'function') {
    fail('release_function_not_exported')
  }

  const packet = {
    contact_id: 'pause-backoff-harness',
    thread_id: 'pause-backoff-harness',
    message_id: 'pause-backoff-1',
    bubble_index: 0,
    bubble_count: 1,
    bubble: { text: 'pause backoff harness bubble' },
    bubbles: [{ text: 'pause backoff harness bubble' }],
    due_at: new Date(Date.now() - 5000).toISOString(),
    queued_at: new Date().toISOString()
  }
  const original = path.join(appRoot, 'outbox', 'pause-backoff-0.json')
  const lock = `${original}.lock`
  fs.writeFileSync(lock, JSON.stringify(packet), { mode: 0o600 })

  const logs = []
  const realLog = console.log
  console.log = (line) => { logs.push(String(line)) }
  const before = Date.now()
  let republished
  try {
    republished = worker.releaseOutboxLockForPause(
      lock, packet, 'final_sender_pause_gate', 'scv_final_sender_release_identity_gate'
    )
  } finally {
    console.log = realLog
  }

  if (republished !== original || !fs.existsSync(original) || fs.existsSync(lock)) {
    fail('bubble_not_republished', {
      republished: String(republished),
      original_exists: fs.existsSync(original),
      lock_exists: fs.existsSync(lock)
    })
  }

  const persisted = JSON.parse(fs.readFileSync(original, 'utf8'))
  const dueMs = Date.parse(persisted.due_at)
  const deltaMs = dueMs - before
  if (!(deltaMs >= 1000)) {
    fail('due_at_not_backed_off', { delta_ms: deltaMs, due_at: persisted.due_at })
  }
  if (persisted.bubble?.text !== packet.bubble.text ||
      persisted.message_id !== packet.message_id) {
    fail('packet_payload_mutated_beyond_due_at')
  }

  const holdLine = logs.find((line) => line.includes('outbox_worker_pause_recheck_hold'))
  if (!holdLine) fail('hold_log_missing', { logged: logs.length })
  let parsedLog
  try { parsedLog = JSON.parse(holdLine) } catch { parsedLog = {} }
  if (parsedLog.sender_reason !== 'scv_final_sender_release_identity_gate') {
    fail('sender_reason_not_logged', { got: String(parsedLog.sender_reason) })
  }
  if (!(Number(parsedLog.pause_retry_delay_ms) >= 1000)) {
    fail('retry_delay_not_logged', { got: parsedLog.pause_retry_delay_ms })
  }

  console.log(JSON.stringify({
    type: 'final_sender_pause_backoff_harness_pass',
    backoff_delta_ms: deltaMs,
    sender_reason_logged: true
  }))
  process.exit(0)
}

main()
