#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-control-ledger-durable-'))
  const controlFile = path.join(__dirname, 'scv-single-control-plane.js')
  const adoptionFile = path.join(__dirname, 'scv-durable-outbox-adoption.js')
  const msg = {
    contact_id: 'durable-ledger-thread',
    thread_id: 'durable-ledger-thread',
    instagram_username: 'durable.ledger.test',
    message_id: 'durable-ledger-message',
    text: 'hello',
    received_at: '2026-08-25T12:00:00.000Z'
  }
  try {
    const childScript = [
      `const control = require(${JSON.stringify(controlFile)})`,
      `const root = ${JSON.stringify(root)}`,
      `const msg = ${JSON.stringify(msg)}`,
      'control.recordIngressEvent(root, msg)',
      'const state = control.reduceConversationState({ root, event: msg, candidate: {} })',
      'control.commitControlDecision(root, msg, state, {',
      "  authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, runner: 'scv-single-control-plane', control_epoch: control.SCV_CONTROL_EPOCH, closed_transition_action: 'general_continue', closed_transition_reason: 'durability_fault_probe' },",
      "  packet: { bubbles: [{ text: 'durable controller reply' }] },",
      "  test_fault_after_durable_state_write: 'sigkill'",
      '})'
    ].join('\n')
    const child = spawnSync(process.execPath, ['-e', childScript], {
      cwd: __dirname,
      env: {
        ...process.env,
        SCV_ROOT: root,
        SCV_SINGLE_CONTROL_TEST_HARNESS: '1'
      },
      encoding: 'utf8',
      timeout: 10000
    })
    assert.strictEqual(child.signal, 'SIGKILL')

    const control = require(controlFile)
    const state = control.readControlState(root, msg.thread_id)
    assert.strictEqual(state.last_control_message_id, msg.message_id)
    assert.strictEqual(state.last_control_decision?.packet?.bubbles?.[0]?.text, 'durable controller reply')
    assert.strictEqual(
      control.validateControlReceipt(state.last_control_decision, {
        root,
        requireLedger: true,
        requirePayload: true
      }).valid,
      true
    )

    const receiptSha = state.last_control_decision.control_receipt.receipt_sha256
    assert.strictEqual(fs.existsSync(control.controlDecisionPath(root, receiptSha)), false)
    const auditFile = path.join(root, 'control-events', `${msg.thread_id}.ndjson`)
    const preReplayAudit = fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8') : ''
    assert.strictEqual(preReplayAudit.includes('control_decision_committed'), false)

    const lockFile = path.join(root, 'control-locks', `${msg.thread_id}.lock`)
    assert.strictEqual(fs.existsSync(lockFile), true)
    const stale = new Date(Date.now() - 60_000)
    fs.utimesSync(lockFile, stale, stale)
    const replay = control.replayCommittedDecision(root, msg)
    assert.strictEqual(replay.replayed_control_decision, true)
    assert.strictEqual(fs.existsSync(control.controlDecisionPath(root, receiptSha)), true)
    assert.strictEqual(fs.readFileSync(auditFile, 'utf8').includes('control_decision_committed'), true)
    assert.strictEqual(fs.existsSync(lockFile), false)

    const transportPacket = {
      ...replay,
      contact_id: msg.contact_id,
      thread_id: msg.thread_id,
      instagram_username: msg.instagram_username,
      message_id: msg.message_id,
      bubble_index: 0,
      bubble_count: replay.packet.bubbles.length,
      bubble: replay.packet.bubbles[0],
      bubbles: replay.packet.bubbles
    }
    const adoption = require(adoptionFile).adoptOutboxPacket({
      root,
      packet: transportPacket
    })
    assert.strictEqual(adoption.ok, true)
    assert.strictEqual(fs.existsSync(adoption.file), true)
    assert.strictEqual(fs.existsSync(adoption.marker), true)
    const queued = JSON.parse(fs.readFileSync(adoption.file, 'utf8'))
    assert.strictEqual(
      control.validateControlReceipt(queued, {
        root,
        requireLedger: true,
        requirePayload: true
      }).valid,
      true
    )

    return {
      ok: true,
      checks: 15,
      crash_signal: child.signal,
      receipt_sha256: receiptSha,
      outbox_adoption_reason: adoption.reason
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(run())}\n`)
  } catch (error) {
    process.stderr.write(`${String(error?.stack || error)}\n`)
    process.exit(1)
  }
}

module.exports = { run }
