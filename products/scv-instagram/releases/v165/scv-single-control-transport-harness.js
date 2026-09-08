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
  buildReferenceAttachmentGraceFlags,
  SCV_REFERENCE_ATTACHMENT_GRACE_MS
} = require(path.join(__dirname, 'scv-reference-attachment-coalescing.js'))

const SCV_SINGLE_CONTROL_TRANSPORT_HARNESS_LOCK_VERSION =
  'scv-single-control-transport-harness-2026-08-25-v4-terminal-marker-no-resend'

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForHealth(url, child, output) {
  for (let i = 0; i < 80; i += 1) {
    if (child.exitCode !== null) throw new Error(`outbound1_exited_early:${child.exitCode}:${output.join('')}`)
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch {}
    await sleep(25)
  }
  throw new Error(`outbound1_health_timeout:${output.join('')}`)
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

async function runScvSingleControlTransportHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-single-control-transport-'))
  const port = 35000 + Math.floor(Math.random() * 20000)
  const output = []
  let checked = 0
  const failures = []
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }
  let child = null

  try {
    const msg = {
      contact_id: '1537753982',
      thread_id: '1537753982',
      instagram_username: 'omar.system',
      message_id: 'transport-message-1',
      text: 'can i get more info?',
      received_at: '2026-07-10T21:00:00.000Z'
    }
    recordIngressEvent(root, msg)
    const state = reduceConversationState({ root, event: msg, candidate: { tattoo_intent_active: true } })
    const authority = {
      controller: SCV_SINGLE_CONTROL_PLANE_ID,
      runner: 'scv-single-control-plane',
      control_epoch: SCV_CONTROL_EPOCH,
      recent_history: []
    }
    const packet = {
      bubbles: [
        { text: 'yeah for sure, send me whatever direction you have in mind' },
        { text: 'even a loose reference is enough to start from' }
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
      text: msg.text,
      bubbles: packet.bubbles
    }

    let fixtureOrdinal = 1
    const controllerBody = ({
      contactId,
      threadId = contactId,
      username,
      messageId,
      text = 'transport durability probe',
      bubbles = [{ text: 'controller-authored reply' }],
      extra = {}
    }) => {
      fixtureOrdinal += 1
      const event = {
        contact_id: String(contactId),
        thread_id: String(threadId),
        instagram_username: String(username),
        message_id: String(messageId),
        text,
        received_at: new Date(
          Date.parse('2026-07-10T21:00:00.000Z') + fixtureOrdinal * 1000
        ).toISOString()
      }
      recordIngressEvent(root, event)
      const nextState = reduceConversationState({
        root,
        event,
        candidate: { tattoo_intent_active: true }
      })
      const nextPacket = { bubbles }
      const nextCommitted = commitControlDecision(
        root, event, nextState, { authority, packet: nextPacket }
      )
      return {
        source: SCV_SINGLE_CONTROL_SOURCE,
        authority,
        control_receipt: nextCommitted.receipt,
        contact_id: event.contact_id,
        thread_id: event.thread_id,
        instagram_username: event.instagram_username,
        message_id: event.message_id,
        text: event.text,
        bubbles,
        ...extra
      }
    }
    const corruptQueueBody = controllerBody({
      contactId: '880000001',
      username: 'qa.corrupt.queue',
      messageId: 'transport-corrupt-queue-1'
    })
    const faultBetweenQueueAndMarkerBody = controllerBody({
      contactId: '1537753982',
      threadId: 'transport-queue-marker-fault-thread',
      username: 'omar.system',
      messageId: 'transport-queue-marker-fault-1'
    })
    const mismatchedUsernameBody = controllerBody({
      contactId: '1537753982',
      username: 'real.lead',
      messageId: 'transport-fast-pair-mismatch-username'
    })
    const mismatchedContactBody = controllerBody({
      contactId: '999',
      username: 'omar.system',
      messageId: 'transport-fast-pair-mismatch-contact'
    })
    const exactOmarGraceBody = controllerBody({
      contactId: '1537753982',
      username: 'omar.system',
      messageId: 'transport-exact-omar-attachment-grace',
      extra: {
        authority_transport_flags: buildReferenceAttachmentGraceFlags()
      }
    })

    child = spawn(process.execPath, [path.join(__dirname, 'outbound-scv1.js')], {
      cwd: __dirname,
      env: {
        ...process.env,
        SCV_ROOT: root,
        SCV_OUTBOUND1_PORT: String(port),
        SCV_INTERNAL_BIND_HOST: '127.0.0.1',
        SCV_FAST_TARGET_USERNAMES: 'omar.system',
        SCV_FAST_TARGET_CONTACT_IDS: '1537753982',
        SCV_FAST_TARGET_DELAY_MULTIPLIER: '0',
        SCV_FAST_TARGET_FORCE_ZERO: '1',
        SCV_OUTBOUND1_TEST_HARNESS: '1',
        SCV_OUTBOUND1_TEST_FAIL_AFTER_QUEUE_RECEIPT:
          faultBetweenQueueAndMarkerBody.control_receipt.receipt_sha256
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.stdout.on('data', (chunk) => output.push(String(chunk)))
    child.stderr.on('data', (chunk) => output.push(String(chunk)))

    const base = `http://127.0.0.1:${port}/`
    const health = await waitForHealth(`${base}health`, child, output)
    check('queue_writer_exposes_single_control_gate',
      health.authority_gate === SCV_SINGLE_CONTROL_SOURCE && health.control_plane_id === SCV_SINGLE_CONTROL_PLANE_ID,
      JSON.stringify(health))

    const first = await postJson(base, body)
    check('first_controller_packet_is_accepted', first.status === 200 && first.body?.ok === true, JSON.stringify(first))
    check('first_controller_packet_writes_each_bubble_once',
      fs.readdirSync(path.join(root, 'outbox')).filter((name) => name.endsWith('.json')).length === 2,
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox'))))
    check('idempotency_markers_are_persisted',
      fs.readdirSync(path.join(root, 'outbox-idempotency')).filter((name) => name.endsWith('.json')).length === 2,
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox-idempotency'))))

    const second = await postJson(base, body)
    check('replayed_controller_packet_is_idempotently_accepted',
      second.status === 200 && second.body?.idempotent_skips?.length === 2,
      JSON.stringify(second))
    check('replayed_controller_packet_cannot_duplicate_outbox',
      fs.readdirSync(path.join(root, 'outbox')).filter((name) => name.endsWith('.json')).length === 2,
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox'))))

    const forged = await postJson(base, {
      ...body,
      control_receipt: { ...body.control_receipt, receipt_sha256: 'forged' }
    })
    check('forged_controller_receipt_is_rejected',
      forged.status === 403 && forged.body?.error === 'non_authoritative_queue_write_rejected',
      JSON.stringify(forged))

    const tamperedText = await postJson(base, {
      ...body,
      bubbles: body.bubbles.map((bubble, index) => index === 0 ? { ...bubble, text: `${bubble.text} changed` } : bubble)
    })
    check('payload_bound_receipt_rejects_changed_text',
      tamperedText.status === 403 && tamperedText.body?.receipt_reason === 'single_control_packet_payload_hash_mismatch',
      JSON.stringify(tamperedText))
    const reordered = await postJson(base, {
      ...body,
      bubbles: [...body.bubbles].reverse()
    })
    check('payload_bound_receipt_rejects_changed_order',
      reordered.status === 403 && reordered.body?.receipt_reason === 'single_control_packet_payload_hash_mismatch',
      JSON.stringify(reordered))
    const dropped = await postJson(base, {
      ...body,
      bubbles: body.bubbles.slice(0, 1)
    })
    check('payload_bound_receipt_rejects_changed_count',
      dropped.status === 403 && dropped.body?.receipt_reason === 'single_control_packet_payload_hash_mismatch',
      JSON.stringify(dropped))

    const outboxPackets = fs.readdirSync(path.join(root, 'outbox'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(root, 'outbox', name), 'utf8')))
    check('queued_bubbles_carry_exact_controller_receipt',
      outboxPackets.every((item) =>
        item.source === SCV_SINGLE_CONTROL_SOURCE &&
        item.authority?.controller === SCV_SINGLE_CONTROL_PLANE_ID &&
        item.control_receipt?.receipt_sha256 === committed.receipt.receipt_sha256
      ),
      JSON.stringify(outboxPackets))
    const orderedOutboxPackets = outboxPackets.slice().sort((a, b) => Number(a.bubble_index) - Number(b.bubble_index))
    check('queue_transport_preserves_controller_text_count_and_order_exactly',
      orderedOutboxPackets.length === packet.bubbles.length &&
      orderedOutboxPackets.every((item, index) =>
        Number(item.bubble_index) === index &&
        Number(item.bubble_count) === packet.bubbles.length &&
        String(item.bubble?.text || '') === String(packet.bubbles[index]?.text || '') &&
        JSON.stringify(item.bubbles) === JSON.stringify(packet.bubbles)
      ),
      JSON.stringify(orderedOutboxPackets))
    check('queued_receipt_binds_full_controller_payload',
      orderedOutboxPackets.every((item) => item.control_receipt?.packet_sha256 === committed.receipt.packet_sha256),
      JSON.stringify(orderedOutboxPackets.map((item) => item.control_receipt)))

    const corruptKey = `${corruptQueueBody.control_receipt.receipt_sha256}-0`
    const corruptFile = path.join(root, 'outbox', `${corruptKey}.json`)
    fs.writeFileSync(corruptFile, '{"partial":', { mode: 0o600 })
    const repairedCorrupt = await postJson(base, corruptQueueBody)
    check('truncated_expected_queue_is_reconstructed_before_200',
      repairedCorrupt.status === 200 &&
      repairedCorrupt.body?.repaired_adoptions?.length === 1 &&
      JSON.parse(fs.readFileSync(corruptFile, 'utf8'))?.message_id ===
        corruptQueueBody.message_id,
      JSON.stringify(repairedCorrupt))
    check('truncated_queue_is_preserved_in_explicit_quarantine',
      fs.readdirSync(path.join(root, 'outbox_quarantine_corrupt_adoption'))
        .some((name) => name.includes(`${corruptKey}.json`) && !name.endsWith('.receipt.json')),
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox_quarantine_corrupt_adoption'))))

    const faultKey = `${faultBetweenQueueAndMarkerBody.control_receipt.receipt_sha256}-0`
    const faultFile = path.join(root, 'outbox', `${faultKey}.json`)
    const faultMarker = path.join(root, 'outbox-idempotency', `${faultKey}.json`)
    const faulted = await postJson(base, faultBetweenQueueAndMarkerBody)
    check('fault_between_durable_queue_and_marker_returns_failure',
      faulted.status === 500 && fs.existsSync(faultFile) && !fs.existsSync(faultMarker),
      JSON.stringify(faulted))
    const faultRetry = await postJson(base, faultBetweenQueueAndMarkerBody)
    check('retry_after_queue_marker_fault_repairs_marker_without_duplicate_queue',
      faultRetry.status === 200 &&
      faultRetry.body?.idempotent_skips?.length === 1 &&
      faultRetry.body?.repaired_adoptions?.length === 1 &&
      fs.existsSync(faultFile) && fs.existsSync(faultMarker),
      JSON.stringify(faultRetry))

    // A retained adoption marker proves packet identity, not that an earlier
    // process never sent it. A corrupt claimed lock must therefore leave the
    // active queue, contact no provider, and produce one no-resend human hold.
    fs.writeFileSync(faultFile, '{"partial":', { mode: 0o600 })
    const priorRoot = process.env.SCV_ROOT
    const priorPauseAll = process.env.SCV_PAUSE_ALL
    const priorPauseNonTest = process.env.SCV_PAUSE_NON_TEST
    const priorPauseDebug = process.env.SCV_PAUSE_DEBUG_ACCOUNTS
    process.env.SCV_ROOT = root
    process.env.SCV_PAUSE_ALL = '1'
    process.env.SCV_PAUSE_NON_TEST = '1'
    process.env.SCV_PAUSE_DEBUG_ACCOUNTS = '1'
    const humanDir = path.join(root, 'outbox_human_agent_required')
    const humanFilesBeforeCorruptLock = new Set(fs.readdirSync(humanDir))
    const priorFetch = global.fetch
    let providerContactCount = 0
    global.fetch = async () => {
      providerContactCount += 1
      throw new Error('transport_harness_unexpected_provider_contact')
    }
    try {
      const workerPath = path.join(__dirname, 'outbox-worker.js')
      delete require.cache[require.resolve(workerPath)]
      const outboxWorker = require(workerPath)
      await outboxWorker.handleFile(faultFile)
    } finally {
      global.fetch = priorFetch
      if (priorRoot === undefined) delete process.env.SCV_ROOT
      else process.env.SCV_ROOT = priorRoot
      if (priorPauseAll === undefined) delete process.env.SCV_PAUSE_ALL
      else process.env.SCV_PAUSE_ALL = priorPauseAll
      if (priorPauseNonTest === undefined) delete process.env.SCV_PAUSE_NON_TEST
      else process.env.SCV_PAUSE_NON_TEST = priorPauseNonTest
      if (priorPauseDebug === undefined) delete process.env.SCV_PAUSE_DEBUG_ACCOUNTS
      else process.env.SCV_PAUSE_DEBUG_ACCOUNTS = priorPauseDebug
    }
    const newHumanFiles = fs.readdirSync(humanDir)
      .filter((name) => !humanFilesBeforeCorruptLock.has(name))
    const corruptLockHold = newHumanFiles.length === 1
      ? JSON.parse(fs.readFileSync(path.join(humanDir, newHumanFiles[0]), 'utf8'))
      : null
    check('corrupt_lock_marker_only_fails_closed_once_without_provider_contact',
      !fs.existsSync(faultFile) && !fs.existsSync(`${faultFile}.lock`) &&
        fs.existsSync(faultMarker) && providerContactCount === 0 &&
        newHumanFiles.length === 1 &&
        String(corruptLockHold?.reason || '').includes(
          'outbox_adoption_marker_is_not_durable_pre_network_proof_no_resend'
        ),
      JSON.stringify({
        outbox: fs.readdirSync(path.join(root, 'outbox')),
        newHumanFiles,
        corruptLockHold,
        providerContactCount
      }))

    const mismatchedUsername = await postJson(base, mismatchedUsernameBody)
    const mismatchedUsernameKey =
      `${mismatchedUsernameBody.control_receipt.receipt_sha256}-0.json`
    const mismatchedUsernamePacket = JSON.parse(fs.readFileSync(
      path.join(root, 'outbox', mismatchedUsernameKey), 'utf8'
    ))
    check('omar_contact_without_omar_username_is_not_fast_zero',
      mismatchedUsername.status === 200 &&
      mismatchedUsernamePacket.fast_delay_target === false &&
      mismatchedUsernamePacket.force_zero_delay === false,
      JSON.stringify(mismatchedUsernamePacket))

    const mismatchedContact = await postJson(base, mismatchedContactBody)
    const mismatchedContactKey =
      `${mismatchedContactBody.control_receipt.receipt_sha256}-0.json`
    const mismatchedContactPacket = JSON.parse(fs.readFileSync(
      path.join(root, 'outbox', mismatchedContactKey), 'utf8'
    ))
    check('omar_username_without_omar_contact_is_not_fast_zero',
      mismatchedContact.status === 200 &&
      mismatchedContactPacket.fast_delay_target === false &&
      mismatchedContactPacket.force_zero_delay === false,
      JSON.stringify(mismatchedContactPacket))

    const exactGrace = await postJson(base, exactOmarGraceBody)
    const exactGraceKey = `${exactOmarGraceBody.control_receipt.receipt_sha256}-0.json`
    const exactGracePacket = JSON.parse(fs.readFileSync(
      path.join(root, 'outbox', exactGraceKey), 'utf8'
    ))
    check('exact_omar_has_zero_human_pacing',
      exactGrace.status === 200 &&
      exactGracePacket.fast_delay_target === true &&
      exactGracePacket.force_zero_delay === true &&
      exactGracePacket.bubble?.delay_ms === 0,
      JSON.stringify(exactGracePacket))
    check('exact_omar_only_bounded_exception_is_attachment_coalescing_grace',
      exactGracePacket.reference_attachment_grace_ms ===
        SCV_REFERENCE_ATTACHMENT_GRACE_MS &&
      Date.parse(exactGracePacket.due_at) - Date.parse(exactGracePacket.queued_at) ===
        SCV_REFERENCE_ATTACHMENT_GRACE_MS,
      JSON.stringify(exactGracePacket))

    if (failures.length) {
      const err = new Error(`scv_single_control_transport_harness_failed:${JSON.stringify(failures)}`)
      err.failures = failures
      throw err
    }
    return {
      ok: true,
      locked: true,
      lock_version: SCV_SINGLE_CONTROL_TRANSPORT_HARNESS_LOCK_VERSION,
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
  runScvSingleControlTransportHarness()
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
  SCV_SINGLE_CONTROL_TRANSPORT_HARNESS_LOCK_VERSION,
  runScvSingleControlTransportHarness
}
