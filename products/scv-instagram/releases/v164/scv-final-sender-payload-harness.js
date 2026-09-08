#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  SCV_CONTROL_EPOCH,
  recordIngressEvent,
  reduceConversationState,
  commitControlDecision
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  OFFICIAL_MANYCHAT_SEND_URL,
  resolveManyChatSendUrl
} = require(path.join(__dirname, 'outbound-scv2.js'))

const SCV_FINAL_SENDER_PAYLOAD_HARNESS_VERSION = 'scv-final-sender-payload-harness-2026-07-12-v2-official-cloud-transport'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHealth(url, child, output) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`outbound2_exited_early:${child.exitCode}:${output.join('')}`)
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch {}
    await sleep(25)
  }
  throw new Error(`outbound2_health_timeout:${output.join('')}`)
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await response.text()
  let parsed = {}
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = { raw: text } }
  return { status: response.status, body: parsed }
}

async function runScvFinalSenderPayloadHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-final-sender-payload-'))
  const port = 36000 + Math.floor(Math.random() * 18000)
  const output = []
  const failures = []
  let checked = 0
  let child = null
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  try {
    check('cloud_runtime_ignores_poisoned_manychat_override',
      resolveManyChatSendUrl({ SCV_CLOUD_RUNTIME: '1', MANYCHAT_SEND_URL: 'http://127.0.0.1:9' }) === OFFICIAL_MANYCHAT_SEND_URL)
    check('local_runtime_preserves_explicit_test_transport',
      resolveManyChatSendUrl({ MANYCHAT_SEND_URL: 'http://127.0.0.1:9' }) === 'http://127.0.0.1:9')

    const msg = {
      contact_id: '1537753982',
      thread_id: '1537753982',
      instagram_username: 'omar.system',
      message_id: 'final-sender-message-1',
      text: 'hello',
      received_at: '2026-07-12T12:00:00.000Z'
    }
    recordIngressEvent(root, msg)
    const state = reduceConversationState({ root, event: msg, candidate: {} })
    const authority = {
      controller: SCV_SINGLE_CONTROL_PLANE_ID,
      runner: 'scv-single-control-plane',
      control_epoch: SCV_CONTROL_EPOCH,
      recent_history: []
    }
    const packet = {
      bubbles: [
        { text: 'first controller adopted bubble' },
        { text: 'second controller adopted bubble' }
      ]
    }
    const committed = commitControlDecision(root, msg, state, { authority, packet })
    const body = {
      source: SCV_SINGLE_CONTROL_SOURCE,
      authority,
      control_receipt: committed.receipt,
      contact_id: msg.contact_id,
      thread_id: msg.thread_id,
      instagram_username: msg.instagram_username,
      message_id: msg.message_id,
      bubble_index: 0,
      bubble: packet.bubbles[0],
      bubbles: packet.bubbles
    }

    child = spawn(process.execPath, [path.join(__dirname, 'outbound-scv2.js')], {
      cwd: __dirname,
      env: {
        ...process.env,
        SCV_ROOT: root,
        SCV_OUTBOUND2_PORT: String(port),
        SCV_INTERNAL_BIND_HOST: '127.0.0.1',
        SCV_PAUSE_ALL: '0',
        SCV_PAUSE_NON_TEST: '0',
        SCV_PAUSE_DEBUG_ACCOUNTS: '1',
        SCV_REQUIRE_IG_VISIBILITY: '0',
        SCV_ALLOW_MANYCHAT_UNVERIFIED_SUCCESS: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', (chunk) => output.push(String(chunk)))
    child.stderr.on('data', (chunk) => output.push(String(chunk)))

    const base = `http://127.0.0.1:${port}/`
    const health = await waitForHealth(`${base}health`, child, output)
    check('final_sender_exposes_controller_authority_gate',
      health.authority_gate === SCV_SINGLE_CONTROL_SOURCE && health.control_plane_id === SCV_SINGLE_CONTROL_PLANE_ID,
      JSON.stringify(health))
    check('final_sender_health_exposes_official_manychat_lock',
      health.manychat_send_host === 'api.manychat.com' && health.manychat_send_official_lock === true,
      JSON.stringify(health))

    const valid = await postJson(base, body)
    check('exact_controller_payload_passes_authority_gate_before_pause',
      valid.status === 423 &&
      valid.body?.error !== 'non_authoritative_final_send_rejected' &&
      valid.body?.held === true &&
      valid.body?.retryable === false &&
      valid.body?.reason === 'scv_final_sender_pause_gate',
      JSON.stringify(valid))

    const changedText = await postJson(base, {
      ...body,
      bubble: { text: 'transport changed the controller text' }
    })
    check('final_sender_rejects_changed_bubble_text',
      changedText.status === 403 && changedText.body?.receipt_reason === 'single_control_bubble_payload_mismatch',
      JSON.stringify(changedText))

    const changedIndex = await postJson(base, {
      ...body,
      bubble_index: 1,
      bubble: packet.bubbles[0]
    })
    check('final_sender_rejects_changed_bubble_index',
      changedIndex.status === 403 && changedIndex.body?.receipt_reason === 'single_control_bubble_payload_mismatch',
      JSON.stringify(changedIndex))

    const changedFullPayload = await postJson(base, {
      ...body,
      bubbles: [...packet.bubbles].reverse(),
      bubble: packet.bubbles[1]
    })
    check('final_sender_rejects_changed_full_payload',
      changedFullPayload.status === 403 && changedFullPayload.body?.receipt_reason === 'single_control_packet_payload_hash_mismatch',
      JSON.stringify(changedFullPayload))

    const missingFullPayload = { ...body }
    delete missingFullPayload.bubbles
    const missing = await postJson(base, missingFullPayload)
    check('final_sender_rejects_missing_full_payload',
      missing.status === 400,
      JSON.stringify(missing))

    if (failures.length) {
      const err = new Error(`scv_final_sender_payload_harness_failed:${JSON.stringify(failures)}`)
      err.failures = failures
      throw err
    }

    return {
      ok: true,
      locked: true,
      lock_version: SCV_FINAL_SENDER_PAYLOAD_HARNESS_VERSION,
      checked
    }
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await sleep(30)
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  runScvFinalSenderPayloadHarness()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error(JSON.stringify({
        ok: false,
        error: String(err?.message || err),
        failures: err?.failures || []
      }, null, 2))
      process.exit(1)
    })
}

module.exports = {
  SCV_FINAL_SENDER_PAYLOAD_HARNESS_VERSION,
  runScvFinalSenderPayloadHarness
}
