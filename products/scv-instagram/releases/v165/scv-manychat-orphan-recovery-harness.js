#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  buildRecoveryPacket,
  hasProcessedLatestInput,
  recordInboundProcessingReceipt,
  inboundProcessingReceiptHasPacket,
  writeRecoveryPacketToLocalPipeline,
  resolveManyChatApiBase,
  OFFICIAL_MANYCHAT_API_BASE,
  readBoundedResponseText,
  SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION
} = require(path.join(__dirname, 'scv-manychat-orphan-recovery.js'))
const { purgeTestAccountDebugState } = require(path.join(__dirname, 'scv-test-account-purge.js'))

function assert(condition, label, detail = '') {
  if (!condition) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function unpausedLocalRecoveryOptions(root, now) {
  return {
    env: {
      RAILWAY_ENVIRONMENT_NAME: 'local',
      SCV_RELEASE_MODE: 'local',
      SCV_ROOT: root,
      SCV_PAUSE_ALL: '0',
      SCV_PAUSE_NON_TEST: '0',
      SCV_PAUSE_DEBUG_ACCOUNTS: '0'
    },
    now
  }
}

async function runScvManyChatOrphanRecoveryHarness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-mc-orphan-'))
  const info = {
    id: 72324942,
    name: 'Allie',
    first_name: 'Allie',
    ig_username: 'alliesugar',
    last_input_text: 'Hello, can I get more info on this?',
    ig_last_interaction: '2026-06-20T10:05:22-07:00',
    tags: []
  }

  const packet = buildRecoveryPacket(info, {
    now: '2026-06-21T09:30:00.000Z'
  })

  assert(SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION === 'scv-manychat-orphan-recovery-lock-2026-08-20-v6-trusted-media-url-boundary', 'lock_version_exact', SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION)
  assert(resolveManyChatApiBase({ SCV_CLOUD_RUNTIME: '1', MANYCHAT_API_BASE: 'https://credential-exfil.invalid' }) === OFFICIAL_MANYCHAT_API_BASE, 'cloud_manychat_base_is_official')
  assert(resolveManyChatApiBase({ MANYCHAT_API_BASE: 'http://127.0.0.1:9999/mock' }) === 'http://127.0.0.1:9999', 'local_manychat_mock_base_allowed')
  let headerRejected = false
  try {
    await readBoundedResponseText({ headers: { get: () => '3' } }, 2)
  } catch (error) {
    headerRejected = error.message === 'manychat_response_too_large'
  }
  assert(headerRejected, 'manychat_declared_oversize_rejected')
  let cancelled = false
  let index = 0
  const chunks = [Buffer.from('ab'), Buffer.from('cd')]
  const reader = {
    async read() {
      if (index >= chunks.length) return { done: true }
      return { done: false, value: chunks[index++] }
    },
    async cancel() { cancelled = true },
    releaseLock() {}
  }
  let streamedRejected = false
  try {
    await readBoundedResponseText({
      headers: { get: () => '' },
      body: { getReader: () => reader }
    }, 3)
  } catch (error) {
    streamedRejected = error.message === 'manychat_response_too_large'
  }
  assert(streamedRejected, 'manychat_streamed_oversize_rejected')
  assert(cancelled, 'manychat_streamed_oversize_cancelled')
  assert(packet.contact_id === '72324942', 'packet_contact_id')
  assert(packet.thread_id === '72324942', 'packet_thread_id')
  assert(packet.instagram_username === 'alliesugar', 'packet_username')
  assert(packet.text === 'Hello, can I get more info on this?', 'packet_text')
  assert(packet.message_id.startsWith('manychat-orphan-72324942-'), 'packet_message_id_prefix', packet.message_id)
  assert(packet.recovered_via === 'manychat_subscriber_getinfo', 'packet_recovered_via')
  assert(packet.operator_recovery === true, 'packet_operator_recovery')

  const mediaUrl = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset=latest-reference'
  const mediaPacket = buildRecoveryPacket({
    id: 1537753982,
    ig_username: 'omar.system',
    last_input_text: mediaUrl,
    ig_last_interaction: '2026-07-12T14:37:59-07:00'
  }, { now: '2026-07-12T22:00:00.000Z' })
  assert(mediaPacket.text === 'sent a reference post', 'media_packet_semantic_text')
  assert(Array.isArray(mediaPacket.media_urls) && mediaPacket.media_urls[0] === mediaUrl, 'media_packet_url_preserved')
  assert(mediaPacket.text_source.endsWith('.media'), 'media_packet_source_marked')
  assert(mediaPacket.message_id.startsWith('manychat-orphan-1537753982-'), 'media_packet_deterministic_id')
  recordInboundProcessingReceipt(tmp, mediaPacket, { adopted_at: '2026-07-12T22:01:00.000Z' })
  assert(inboundProcessingReceiptHasPacket(tmp, mediaPacket) === true, 'media_receipt_binds_original_interaction_time')

  const resetTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-mc-reset-watermark-'))
  purgeTestAccountDebugState({
    root: resetTmp,
    usernames: ['omar.system'],
    contactIds: ['1537753982'],
    resetAt: '2026-07-12T22:00:00.000Z'
  })
  assert(hasProcessedLatestInput(resetTmp, mediaPacket) === true, 'pre_reset_manychat_last_input_not_replayed')
  const freshMediaPacket = buildRecoveryPacket({
    id: 1537753982,
    ig_username: 'omar.system',
    last_input_text: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset=fresh-after-reset',
    ig_last_interaction: '2026-07-12T22:00:01.000Z'
  }, { now: '2026-07-12T22:00:02.000Z' })
  assert(hasProcessedLatestInput(resetTmp, freshMediaPacket) === false, 'post_reset_manychat_input_is_live')
  const pausedWrite = writeRecoveryPacketToLocalPipeline(resetTmp, freshMediaPacket, {
    env: {
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      SCV_RELEASE_MODE: 'staging',
      SCV_ROOT: resetTmp,
      SCV_PAUSE_ALL: '1',
      SCV_PAUSE_NON_TEST: '1'
    },
    now: '2026-07-12T22:00:02.000Z'
  })
  assert(
    pausedWrite.skipped === true && pausedWrite.held === true && pausedWrite.reason === 'recovery_paused_for_packet',
    'post_reset_manychat_staging_pause_holds'
  )
  assert(hasProcessedLatestInput(resetTmp, freshMediaPacket) === false, 'staging_pause_does_not_enqueue_post_reset_manychat_input')
  const freshWrite = writeRecoveryPacketToLocalPipeline(
    resetTmp,
    freshMediaPacket,
    unpausedLocalRecoveryOptions(resetTmp, '2026-07-12T22:00:02.000Z')
  )
  assert(freshWrite.skipped === false && fs.existsSync(freshWrite.inbox_file), 'post_reset_manychat_input_enqueued')

  assert(hasProcessedLatestInput(tmp, packet) === false, 'unseen_packet_not_processed')

  const localWriteOptions = unpausedLocalRecoveryOptions(tmp, '2026-06-21T09:30:00.000Z')
  const written = writeRecoveryPacketToLocalPipeline(tmp, packet, localWriteOptions)
  assert(fs.existsSync(written.inbox_file), 'inbox_written')
  assert(fs.existsSync(written.thread_state_file), 'thread_state_written')
  assert(fs.existsSync(written.thread_history_file), 'thread_history_written')

  const inboxPacket = readJson(written.inbox_file)
  const state = readJson(written.thread_state_file)
  const history = readJson(written.thread_history_file)

  assert(inboxPacket.text === packet.text, 'inbox_text_preserved')
  assert(state.recovered_via === 'manychat_subscriber_getinfo', 'state_recovery_marker_preserved')
  assert(history.events.length === 1 && history.events[0].role === 'user', 'history_user_event_written')
  assert(hasProcessedLatestInput(tmp, packet) === true, 'written_packet_now_processed')

  const duplicateWrite = writeRecoveryPacketToLocalPipeline(tmp, packet, localWriteOptions)
  assert(duplicateWrite.skipped === true && duplicateWrite.reason === 'latest_input_already_processed', 'duplicate_recovery_skip')

  fs.unlinkSync(written.inbox_file)
  assert(hasProcessedLatestInput(tmp, packet) === false, 'deadlettered_user_only_history_is_retryable')

  const retryWrite = writeRecoveryPacketToLocalPipeline(tmp, packet, localWriteOptions)
  assert(retryWrite.skipped === false && fs.existsSync(retryWrite.inbox_file), 'deadlettered_recovery_requeues')
  fs.unlinkSync(retryWrite.inbox_file)

  history.events.push({
    role: 'assistant',
    message_id: 'assistant-after-retry',
    text: 'yeah for sure send me the idea you are leaning toward',
    at: '2026-06-21T09:31:00.000Z'
  })
  fs.writeFileSync(written.thread_history_file, JSON.stringify(history, null, 2) + '\n')
  assert(hasProcessedLatestInput(tmp, packet) === true, 'assistant_after_user_marks_processed')

  const inboxWorkerSource = fs.readFileSync(path.join(__dirname, 'inbox-worker.js'), 'utf8')
  const outboundSource = fs.readFileSync(path.join(__dirname, 'outbound-scv1.js'), 'utf8')
  assert(inboxWorkerSource.includes('operator_recovery_source') && inboxWorkerSource.includes('manychat-orphan-'), 'inbox_worker_accepts_operator_orphan_recovery')
  assert(outboundSource.includes('operatorRecovery') && outboundSource.includes('operator_recovery_skip_initial_delay'), 'outbound_scv1_skips_initial_delay_for_operator_recovery_only')

  const receipt = {
    ok: true,
    lock_version: SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION,
    checked: 34
  }
  fs.rmSync(resetTmp, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
  return receipt
}

if (require.main === module) {
  runScvManyChatOrphanRecoveryHarness().then((receipt) => {
    console.log(JSON.stringify(receipt, null, 2))
  }).catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  })
}

module.exports = {
  runScvManyChatOrphanRecoveryHarness
}
