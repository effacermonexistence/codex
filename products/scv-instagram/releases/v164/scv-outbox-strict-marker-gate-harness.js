#!/usr/bin/env node
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-strict-marker-gate-'))
  let calls = 0
  const server = http.createServer((req, res) => {
    calls += 1
    req.resume()
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      ok: true,
      result: {
        status: 200,
        body: {
          status: 'success',
          delivery_accepted: true,
          delivery_confirmed: false,
          manychat_status: 200,
          manychat_body: { status: 'success', data: { message_id: 'strict-marker-1' } },
          provider_receipt_id_present: true,
          provider_receipt_id: 'strict-marker-1',
          provider_receipt_id_path: 'data.message_id'
        }
      }
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    process.env.SCV_ROOT = root
    process.env.SCV_OUTBOUND2_URL = `http://127.0.0.1:${server.address().port}/`
    process.env.SCV_SUPPRESSION_BYPASS_USERNAMES = 'omar.system'
    process.env.SCV_PAUSE_ALL = '0'
    process.env.SCV_PAUSE_NON_TEST = '0'
    fs.mkdirSync(path.join(root, 'outbox'), { recursive: true, mode: 0o700 })
    const control = require(path.join(__dirname, 'scv-single-control-plane.js'))
    const adoption = require(path.join(__dirname, 'scv-durable-outbox-adoption.js'))
    const outbox = require(path.join(__dirname, 'outbox-worker.js'))
    control.ensureControlDirs(root)
    const msg = {
      contact_id: 'strict-marker-thread',
      thread_id: 'strict-marker-thread',
      instagram_username: 'omar.system',
      message_id: 'strict-marker-message',
      text: 'hello',
      received_at: new Date().toISOString()
    }
    control.recordIngressEvent(root, msg)
    const committed = control.commitControlDecision(
      root, msg, control.readControlState(root, msg.thread_id), {
        authority: {
          controller: control.SCV_SINGLE_CONTROL_PLANE_ID,
          runner: 'scv-single-control-plane',
          route: 'strict_marker_gate_harness'
        },
        raw_text: 'hello back',
        packet: { bubbles: [{ text: 'hello back' }] }
      }
    )
    const packet = {
      source: committed.decision.source,
      authority: committed.decision.authority,
      control_receipt: committed.receipt,
      contact_id: msg.contact_id,
      thread_id: msg.thread_id,
      instagram_username: msg.instagram_username,
      message_id: msg.message_id,
      text: msg.text,
      bubble_index: 0,
      bubble_count: 1,
      bubble: { text: 'hello back', delay_ms: 0 },
      bubbles: [{ text: 'hello back' }],
      fast_delay_target: true,
      force_zero_delay: true,
      queued_at: new Date().toISOString(),
      due_at: new Date(Date.now() - 10).toISOString(),
      attempts: 0
    }
    let fault = ''
    try {
      adoption.adoptOutboxPacket({ root, packet, testFaultAfterQueue: true })
    } catch (error) { fault = String(error?.message || error) }
    const key = adoption.idempotencyKeyForPacket(packet)
    const queue = path.join(root, 'outbox', `${key}.json`)
    const marker = path.join(root, 'outbox-idempotency', `${key}.json`)
    await outbox.handleFile(queue)
    const zeroBeforeMarker = calls === 0 && fs.existsSync(queue) && fs.existsSync(marker)
    await outbox.handleFile(queue)
    const exactlyOne = calls === 1
    const result = {
      ok: /test_fault_after_queue_before_marker/.test(fault) &&
        zeroBeforeMarker && exactlyOne,
      fault_reproduced: /test_fault_after_queue_before_marker/.test(fault),
      provider_calls_before_marker_reconciliation: zeroBeforeMarker ? 0 : calls,
      provider_calls_after_strict_marker: calls,
      exactly_one_send: exactlyOne
    }
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } finally {
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.stack || error) }, null, 2))
  process.exitCode = 1
})
