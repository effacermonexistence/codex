#!/usr/bin/env node
const fs = require('fs')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const http = require('http')
const os = require('os')
const path = require('path')
const { namespacedPersistRoot } = require(path.join(__dirname, 'scv-runtime-namespace.js'))

const SCV_OUTBOX_ADOPTION_HARNESS_VERSION = 'scv-outbox-adoption-harness-2026-08-29-v6-strict-send-gate'

function providerSuccessEvidence(messageId) {
  const providerReceiptId = `manychat-provider-${String(messageId || 'unknown')}`
  const bytes = Buffer.from(JSON.stringify({
    status: 'success',
    data: { message_id: providerReceiptId }
  }))
  return {
    bytes,
    fields: {
      manychat_status: 200,
      manychat_body: JSON.parse(bytes.toString('utf8')),
      provider_response_body_base64: bytes.toString('base64'),
      provider_response_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      provider_response_size_bytes: bytes.length,
      provider_receipt_id_present: true,
      provider_receipt_id: providerReceiptId,
      provider_receipt_id_path: 'data.message_id'
    }
  }
}

function providerAcceptedUnverifiedEvidence() {
  const bytes = Buffer.from(JSON.stringify({ status: 'success' }))
  return {
    manychat_status: 200,
    manychat_body: JSON.parse(bytes.toString('utf8')),
    provider_response_body_base64: bytes.toString('base64'),
    provider_response_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    provider_response_size_bytes: bytes.length,
    provider_receipt_id_present: false,
    provider_receipt_id: '',
    provider_receipt_id_path: ''
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address())
    })
  })
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()))
}

function makeCommittedPacket(control, root, suffix, bubbleText) {
  const threadId = `outbox-adoption-thread-${suffix}`
  const messageId = `outbox-adoption-message-${suffix}`
  const msg = {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: messageId,
    text: 'can i send you the reference i am thinking about?',
    text_source: 'closed_contract_harness',
    received_at: new Date().toISOString()
  }

  control.recordIngressEvent(root, msg)
  const state = control.readControlState(root, threadId)
  const bubbleTexts = Array.isArray(bubbleText) ? bubbleText : [bubbleText]
  const committed = control.commitControlDecision(root, msg, state, {
    authority: {
      controller: control.SCV_SINGLE_CONTROL_PLANE_ID,
      runner: 'scv-single-control-plane',
      route: 'closed_contract_harness'
    },
    raw_text: bubbleTexts.join('\n'),
    packet: {
      bubbles: bubbleTexts.map((text) => ({ text }))
    }
  })

  const bubbles = committed.decision.packet.bubbles
  return {
    committed,
    packet: {
      source: committed.decision.source,
      authority: committed.decision.authority,
      control_receipt: committed.receipt,
      contact_id: threadId,
      thread_id: threadId,
      instagram_username: 'omar.system',
      message_id: messageId,
      text: msg.text,
      bubble_index: 0,
      bubble_count: bubbles.length,
      bubble: { text: bubbles[0].text, delay_ms: 0 },
      bubbles,
      fast_delay_target: true,
      force_zero_delay: true,
      attempts: 0,
      queued_at: new Date().toISOString(),
      due_at: new Date(Date.now() - 10).toISOString()
    }
  }
}

async function runScvOutboxAdoptionHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-outbox-adoption-'))
  const failures = []
  let checked = 0
  const requests = []
  let responseMode = 'success'
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  const server = http.createServer(async (req, res) => {
    try {
      const body = await readRequestBody(req)
      requests.push(body)
      res.setHeader('Content-Type', 'application/json')
      if (responseMode === 'internal_403') {
        res.statusCode = 403
        res.end(JSON.stringify({ ok: false, error: 'non_authoritative_final_send_rejected' }))
        return
      }
      if (responseMode === 'ambiguous_provider') {
        res.statusCode = 502
        res.end(JSON.stringify({
          ok: false,
          result: {
            status: 502,
            body: {
              status: 'error',
              delivery_outcome_ambiguous: true,
              do_not_retry: true,
              requires_manual_reconciliation: true
            }
          }
        }))
        return
      }
      if (responseMode === 'transient_429') {
        res.statusCode = 429
        res.end(JSON.stringify({
          ok: false,
          result: {
            status: 429,
            body: {
              status: 'error',
              manychat_status: 429,
              message: 'rate limit retry later'
            }
          }
        }))
        return
      }
      const provider = responseMode === 'accepted_unverified'
        ? { fields: providerAcceptedUnverifiedEvidence() }
        : providerSuccessEvidence(body.message_id)
      res.statusCode = 200
      res.end(JSON.stringify({
        ok: true,
        result: {
          status: 200,
          body: {
            status: 'success',
            delivery_accepted: true,
            delivery_confirmed: false,
            delivery_method: responseMode === 'accepted_unverified'
              ? 'manychat_api_accepted_unverified'
              : 'closed_contract_local_stub',
            ...provider.fields
          }
        }
      }))
    } catch (err) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
    }
  })

  const originalEnv = {
    SCV_ROOT: process.env.SCV_ROOT,
    SCV_OUTBOUND2_URL: process.env.SCV_OUTBOUND2_URL,
    SCV_PAUSE_ALL: process.env.SCV_PAUSE_ALL,
    SCV_PAUSE_NON_TEST: process.env.SCV_PAUSE_NON_TEST,
    SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE: process.env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE,
    SCV_SUPPRESSION_BYPASS_USERNAMES: process.env.SCV_SUPPRESSION_BYPASS_USERNAMES,
    SCV_FAIL_CLOSED_SEND_FAILURES: process.env.SCV_FAIL_CLOSED_SEND_FAILURES,
    SCV_OUTBOX_TEST_HARNESS: process.env.SCV_OUTBOX_TEST_HARNESS,
    SCV_PERSIST_ROOT: process.env.SCV_PERSIST_ROOT,
    SCV_RUNTIME_NAMESPACE: process.env.SCV_RUNTIME_NAMESPACE
  }

  try {
    const address = await listen(server)
    process.env.SCV_ROOT = root
    process.env.SCV_OUTBOUND2_URL = `http://127.0.0.1:${address.port}/`
    process.env.SCV_PAUSE_ALL = '0'
    process.env.SCV_PAUSE_NON_TEST = '0'
    process.env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE = '0'
    process.env.SCV_SUPPRESSION_BYPASS_USERNAMES = 'omar.system'
    process.env.SCV_FAIL_CLOSED_SEND_FAILURES = '1'
    process.env.SCV_OUTBOX_TEST_HARNESS = '1'
    const persistRoot = path.join(root, 'persist')
    const runtimeNamespace = 'outbox-adoption'
    const persistentLogs = path.join(namespacedPersistRoot(persistRoot, runtimeNamespace), 'logs')
    fs.mkdirSync(persistentLogs, { recursive: true, mode: 0o700 })
    fs.symlinkSync(persistentLogs, path.join(root, 'logs'))
    process.env.SCV_PERSIST_ROOT = persistRoot
    process.env.SCV_RUNTIME_NAMESPACE = runtimeNamespace

    const control = require(path.join(__dirname, 'scv-single-control-plane.js'))
    const outbox = require(path.join(__dirname, 'outbox-worker.js'))
    const durableAdoption = require(path.join(__dirname, 'scv-durable-outbox-adoption.js'))
    const contract = require(path.join(__dirname, 'scv-contract-harness.js'))
    const { isConversationVisibleAssistantEvent } = require(path.join(__dirname, 'scv-history-visibility.js'))
    control.ensureControlDirs(root)
    fs.mkdirSync(path.join(root, 'outbox'), { recursive: true })
    const publishStrictQueue = (file, packet) => {
      fs.writeFileSync(file, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 })
      fs.chmodSync(file, 0o600)
      outbox.reconcilePublishedQueueMarker(file)
      return file
    }

    check('harness_version_exact', SCV_OUTBOX_ADOPTION_HARNESS_VERSION === 'scv-outbox-adoption-harness-2026-08-29-v6-strict-send-gate', SCV_OUTBOX_ADOPTION_HARNESS_VERSION)
    check('canonical_persistent_log_symlink_resolves_exactly',
      outbox.privateTransportAttemptLedgerDirectory() === persistentLogs &&
        fs.realpathSync(path.join(root, 'logs')) === fs.realpathSync(persistentLogs),
      outbox.privateTransportAttemptLedgerDirectory())
    const wrongTargetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-outbox-ledger-wrong-'))
    const wrongAppRoot = path.join(wrongTargetRoot, 'app')
    const wrongLogs = path.join(wrongTargetRoot, 'wrong-logs')
    fs.mkdirSync(wrongAppRoot, { recursive: true })
    fs.mkdirSync(wrongLogs, { recursive: true })
    fs.symlinkSync(wrongLogs, path.join(wrongAppRoot, 'logs'))
    let wrongTargetError
    try {
      outbox.privateTransportAttemptLedgerDirectory(path.join(wrongAppRoot, 'logs'), {
        SCV_PERSIST_ROOT: persistRoot,
        SCV_RUNTIME_NAMESPACE: runtimeNamespace
      })
    } catch (error) { wrongTargetError = error }
    check('arbitrary_log_directory_symlink_is_rejected',
      /transport_attempt_ledger_directory_wrong_target/.test(String(wrongTargetError?.message || '')),
      String(wrongTargetError?.message || wrongTargetError || ''))
    fs.rmSync(wrongTargetRoot, { recursive: true, force: true })
    let relativePersistRootError
    try {
      outbox.privateTransportAttemptLedgerDirectory(path.join(root, 'logs'), {
        SCV_PERSIST_ROOT: 'relative-persist-root',
        SCV_RUNTIME_NAMESPACE: runtimeNamespace
      })
    } catch (error) { relativePersistRootError = error }
    check('relative_persist_root_is_rejected',
      /transport_attempt_ledger_persist_root_invalid/.test(String(relativePersistRootError?.message || '')),
      String(relativePersistRootError?.message || relativePersistRootError || ''))
    const symlinkPersistFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-outbox-ledger-persist-link-'))
    const realPersistRoot = path.join(symlinkPersistFixture, 'real-persist')
    const linkedPersistRoot = path.join(symlinkPersistFixture, 'linked-persist')
    const linkedAppRoot = path.join(symlinkPersistFixture, 'app')
    const linkedLogs = path.join(namespacedPersistRoot(linkedPersistRoot, runtimeNamespace), 'logs')
    fs.mkdirSync(path.join(namespacedPersistRoot(realPersistRoot, runtimeNamespace), 'logs'), {
      recursive: true,
      mode: 0o700
    })
    fs.mkdirSync(linkedAppRoot, { recursive: true })
    fs.symlinkSync(realPersistRoot, linkedPersistRoot)
    fs.symlinkSync(linkedLogs, path.join(linkedAppRoot, 'logs'))
    let symlinkPersistRootError
    try {
      outbox.privateTransportAttemptLedgerDirectory(path.join(linkedAppRoot, 'logs'), {
        SCV_PERSIST_ROOT: linkedPersistRoot,
        SCV_RUNTIME_NAMESPACE: runtimeNamespace
      })
    } catch (error) { symlinkPersistRootError = error }
    check('symlinked_persist_root_is_rejected',
      /transport_attempt_ledger_persistent_directory_invalid/.test(String(symlinkPersistRootError?.message || '')),
      String(symlinkPersistRootError?.message || symlinkPersistRootError || ''))
    fs.rmSync(symlinkPersistFixture, { recursive: true, force: true })
    check('internal_403_is_controller_retry_class', outbox.classifySendFailure('3102_send_failed_403') === 'internal_control', outbox.classifySendFailure('3102_send_failed_403'))
    check('internal_500_is_controller_retry_class', outbox.classifySendFailure('3102_send_failed_500') === 'internal_control', outbox.classifySendFailure('3102_send_failed_500'))
    check('network_failure_is_transient_class', outbox.classifySendFailure('fetch failed: ECONNREFUSED') === 'transient', outbox.classifySendFailure('fetch failed: ECONNREFUSED'))
    check('accepted_provider_result_is_terminal_no_resend', outbox.terminalNoResendReason({
      http_status: 200,
      body: { ok: true, result: { status: 200, body: { status: 'success', delivery_accepted: true } } }
    }) === 'provider_delivery_accepted')
    check('outer_final_sender_5xx_is_terminal_no_resend', outbox.terminalNoResendReason({
      http_status: 503,
      body: { ok: false }
    }) === 'provider_delivery_outcome_ambiguous')

    const crashGapCase = makeCommittedPacket(
      control, root, 'queue-before-marker-crash-gap',
      'this reply must be sent exactly once after marker reconciliation'
    )
    let crashGapError
    try {
      durableAdoption.adoptOutboxPacket({
        root,
        packet: crashGapCase.packet,
        testFaultAfterQueue: true
      })
    } catch (error) { crashGapError = error }
    const crashGapKey = durableAdoption.idempotencyKeyForPacket(crashGapCase.packet)
    const crashGapFile = path.join(root, 'outbox', `${crashGapKey}.json`)
    const crashGapMarker = path.join(root, 'outbox-idempotency', `${crashGapKey}.json`)
    const requestsBeforeCrashGap = requests.length
    await outbox.handleFile(crashGapFile)
    check('queue_before_marker_crash_is_reproduced',
      /test_fault_after_queue_before_marker/.test(String(crashGapError?.message || '')),
      String(crashGapError?.message || crashGapError || ''))
    check('restarted_outbox_repairs_marker_without_provider_call',
      requests.length === requestsBeforeCrashGap &&
        fs.existsSync(crashGapFile) && fs.existsSync(crashGapMarker),
      JSON.stringify({ requests: requests.length, files: fs.readdirSync(path.join(root, 'outbox')) }))
    await outbox.handleFile(crashGapFile)
    check('strict_marker_reconciliation_allows_exactly_one_send',
      requests.length === requestsBeforeCrashGap + 1 &&
        !fs.existsSync(crashGapFile) && fs.existsSync(crashGapMarker),
      JSON.stringify({ requests: requests.length }))
    const requestsAfterCrashGap = requests.length
    durableAdoption.adoptOutboxPacket({ root, packet: crashGapCase.packet })
    check('terminal_marker_replay_never_reconstructs_duplicate_queue',
      requests.length === requestsAfterCrashGap && !fs.existsSync(crashGapFile),
      JSON.stringify({ requests: requests.length }))

    // Once the valid bound marker is terminal (no active queue or lock), a
    // later corrupt file at the same queue name must not make an identical
    // controller replay reconstruct a sendable packet.
    const terminalReplayCase = makeCommittedPacket(
      control,
      root,
      'terminal-marker-corrupt-queue-replay',
      'never reconstruct this terminal reply from a corrupt queue file'
    )
    const terminalReplayAdoption = durableAdoption.adoptOutboxPacket({
      root,
      packet: terminalReplayCase.packet
    })
    fs.unlinkSync(terminalReplayAdoption.file)
    fs.writeFileSync(terminalReplayAdoption.file, '{"truncated":', { mode: 0o600 })
    const requestsBeforeTerminalReplay = requests.length
    const terminalReplay = durableAdoption.adoptOutboxPacket({
      root,
      packet: terminalReplayCase.packet
    })
    check('valid_terminal_marker_wins_after_corrupt_active_queue_quarantine',
      terminalReplay?.reason === 'outbox_adoption_terminal_marker_valid' &&
        terminalReplay?.idempotent === true && terminalReplay?.repaired === true &&
        !fs.existsSync(terminalReplayAdoption.file) &&
        fs.existsSync(terminalReplayAdoption.marker),
      JSON.stringify(terminalReplay || {}))
    check('terminal_marker_corrupt_queue_replay_never_contacts_provider',
      requests.length === requestsBeforeTerminalReplay,
      JSON.stringify(requests.length))
    check('terminal_marker_corrupt_queue_is_preserved_outside_active_outbox',
      fs.readdirSync(path.join(root, 'outbox_quarantine_corrupt_adoption'))
        .some((name) => name.includes(path.basename(terminalReplayAdoption.file))),
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox_quarantine_corrupt_adoption'))))

    // A retained adoption marker is not durable proof that a corrupt claimed
    // lock belongs to a never-started transport attempt. The real worker must
    // remove it from the active queue and emit one no-resend operator hold.
    const corruptLockCase = makeCommittedPacket(
      control,
      root,
      'terminal-marker-corrupt-lock-recovery',
      'never restore this corrupt claimed lock from marker bytes alone'
    )
    const corruptLockAdoption = durableAdoption.adoptOutboxPacket({
      root,
      packet: corruptLockCase.packet
    })
    fs.unlinkSync(corruptLockAdoption.file)
    fs.writeFileSync(corruptLockAdoption.file, '{"truncated":', { mode: 0o600 })
    const requestsBeforeCorruptLock = requests.length
    const humanFilesBeforeCorruptLock = new Set(
      fs.readdirSync(path.join(root, 'outbox_human_agent_required'))
    )
    await outbox.handleFile(corruptLockAdoption.file)
    const newHumanFiles = fs.readdirSync(path.join(root, 'outbox_human_agent_required'))
      .filter((name) => !humanFilesBeforeCorruptLock.has(name))
    const corruptLockHold = newHumanFiles
      .map((name) => JSON.parse(fs.readFileSync(
        path.join(root, 'outbox_human_agent_required', name), 'utf8'
      )))
      .find((value) => value?.human_agent_required === true)
    check('corrupt_queue_marker_alone_never_reconstructs_active_queue',
      !fs.existsSync(corruptLockAdoption.file) &&
        !fs.existsSync(`${corruptLockAdoption.file}.lock`) &&
        fs.existsSync(corruptLockAdoption.marker),
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox'))))
    check('corrupt_queue_marker_gate_emits_exactly_one_operator_hold',
      newHumanFiles.length === 1 &&
        corruptLockHold?.human_agent_required === true &&
        corruptLockHold?.no_blind_resend === true &&
        corruptLockHold?.reason ===
          'outbox_adoption_marker_is_not_durable_pre_network_proof_no_resend:outbox_adoption_json_invalid',
      JSON.stringify({ newHumanFiles, corruptLockHold }))
    check('corrupt_claimed_lock_marker_alone_never_contacts_provider',
      requests.length === requestsBeforeCorruptLock,
      JSON.stringify(requests.length))

    const depositBubbles = [
      'perfect thank you',
      'to confirm your appointment the deposit is 100',
      'zelle is contact@omarprotocol.com',
      'once you send it just lmk so i can double check everything on my side and confirm your appointment on my calendar'
    ]
    const staleDepositCase = makeCommittedPacket(
      control,
      root,
      'stale-atomic-deposit',
      depositBubbles
    )
    staleDepositCase.packet.authority_transport_flags = { atomic_deposit_handoff: true }
    const newerDepositInbound = {
      contact_id: staleDepositCase.packet.contact_id,
      thread_id: staleDepositCase.packet.thread_id,
      instagram_username: 'omar.system',
      message_id: `${staleDepositCase.packet.message_id}-newer`,
      text: 'wait i need to change the date first',
      received_at: new Date(Date.now() + 1000).toISOString()
    }
    control.recordIngressEvent(root, newerDepositInbound, {
      authenticated_inbound: true,
      authentication_source: 'shared_secret'
    })
    const staleDepositFile = path.join(root, 'outbox', 'stale-atomic-deposit.json')
    const staleRequestsBefore = requests.length
    publishStrictQueue(staleDepositFile, staleDepositCase.packet)
    await outbox.handleFile(staleDepositFile)
    const staleDepositQuarantineDir = path.join(root, 'outbox_quarantine_stale')
    const staleDepositQuarantine = (fs.existsSync(staleDepositQuarantineDir) ? fs.readdirSync(staleDepositQuarantineDir) : [])
      .map((name) => JSON.parse(fs.readFileSync(path.join(staleDepositQuarantineDir, name), 'utf8')))
      .find((packet) => packet.message_id === staleDepositCase.packet.message_id)
    const staleDepositUnexpectedRequeue = fs.existsSync(staleDepositFile)
      ? JSON.parse(fs.readFileSync(staleDepositFile, 'utf8'))
      : null
    check('real_worker_stale_atomic_deposit_is_terminal_before_network',
      requests.length === staleRequestsBefore &&
        staleDepositQuarantine?.stale_reason === 'newer_inbound_exists_for_thread' &&
        !fs.existsSync(staleDepositFile) && !fs.existsSync(`${staleDepositFile}.lock`),
      JSON.stringify({ quarantine: staleDepositQuarantine || {}, requeue: staleDepositUnexpectedRequeue || {} }))
    check('stale_atomic_deposit_creates_no_requeue_publication_or_pending',
      !fs.readdirSync(path.join(root, 'outbox')).some((name) => name.includes('stale-atomic-deposit')) &&
        control.conversationContextPublicationPending(root, staleDepositCase.packet.thread_id) === false,
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox'))))

    const adoptedText = 'send me the reference you are thinking about and tell me where you want it'
    const repairCase = makeCommittedPacket(control, root, 'repair', adoptedText)
    check('immutable_decision_artifact_written', fs.existsSync(repairCase.committed.decision_artifact_file), repairCase.committed.decision_artifact_file)

    const corruptedPacket = {
      ...repairCase.packet,
      bubble: { ...repairCase.packet.bubble, text: 'transport mutated this adopted copy' },
      bubbles: [{ text: 'transport mutated this adopted copy' }]
    }
    const repairFile = path.join(root, 'outbox', 'repair.json')
    publishStrictQueue(repairFile, repairCase.packet)
    fs.writeFileSync(repairFile, `${JSON.stringify(corruptedPacket, null, 2)}\n`, { mode: 0o600 })
    const requestsBeforeMismatch = requests.length
    await outbox.handleFile(repairFile)
    check('mutated_queue_payload_is_never_sent',
      requests.length === requestsBeforeMismatch && !fs.existsSync(repairFile),
      JSON.stringify({ requests: requests.length }))

    publishStrictQueue(repairFile, repairCase.packet)
    await outbox.handleFile(repairFile)

    const delivered = requests.find((request) => request.message_id === repairCase.packet.message_id) || {}
    check('strict_queue_payload_sent_exactly', delivered?.bubble?.text === adoptedText, JSON.stringify(delivered))
    check('full_strict_payload_preserved', Array.isArray(delivered.bubbles) && delivered.bubbles.length === 1 && delivered.bubbles[0].text === adoptedText, JSON.stringify(delivered.bubbles))
    check('strict_payload_preserves_receipt_identity', delivered?.control_receipt?.receipt_sha256 === repairCase.committed.receipt.receipt_sha256, JSON.stringify(delivered.control_receipt || {}))
    check('successful_adopted_packet_leaves_no_outbox_file', !fs.existsSync(repairFile) && !fs.existsSync(`${repairFile}.lock`), repairFile)
    check('successful_adopted_packet_records_delivery_receipt', fs.existsSync(path.join(root, 'logs', 'delivery-receipts.ndjson')), path.join(root, 'logs', 'delivery-receipts.ndjson'))
    const initialReceipt = fs.readFileSync(path.join(root, 'logs', 'delivery-receipts.ndjson'), 'utf8')
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      .find((item) => item.message_id === repairCase.packet.message_id)
    const initialProvider = providerSuccessEvidence(repairCase.packet.message_id)
    const initialProviderFile = path.join(
      root, 'logs', 'provider-send-responses', initialReceipt?.provider_response_file || ''
    )
    check('accepted_provider_raw_bytes_persisted_exactly',
      fs.existsSync(initialProviderFile) && fs.readFileSync(initialProviderFile).equals(initialProvider.bytes),
      initialProviderFile)
    check('accepted_provider_raw_file_is_owner_only',
      fs.existsSync(initialProviderFile) && (fs.statSync(initialProviderFile).mode & 0o077) === 0,
      initialProviderFile)
    check('delivery_receipt_binds_raw_provider_hash_and_real_id',
      initialReceipt?.provider_response_sha256 === initialProvider.fields.provider_response_sha256 &&
        initialReceipt?.provider_receipt_id === initialProvider.fields.provider_receipt_id &&
        initialReceipt?.provider_receipt_id_path === 'data.message_id' &&
        initialReceipt?.provider_receipt_id_present === true &&
        /^[a-f0-9]{64}$/.test(String(initialReceipt?.transport_attempt_id || '')),
      JSON.stringify(initialReceipt || {}))
    check('delivery_receipt_does_not_embed_raw_provider_bytes',
      !Object.hasOwn(initialReceipt || {}, 'provider_response_body_base64'),
      JSON.stringify(initialReceipt || {}))
    const attemptLedgerFile = path.join(root, 'logs', 'transport-attempts.ndjson')
    const readAttemptLedger = () => fs.readFileSync(attemptLedgerFile, 'utf8')
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    const initialAttempts = readAttemptLedger()
      .filter((item) => item.message_id === repairCase.packet.message_id)
    check('accepted_unconfirmed_attempt_has_exact_durable_start_and_completion',
      initialAttempts.length === 2 &&
        initialAttempts[0]?.record_type === 'attempt_started' &&
        initialAttempts[1]?.record_type === 'attempt_completed' &&
        initialAttempts[0]?.attempt_id === initialReceipt.transport_attempt_id &&
        initialAttempts[1]?.attempt_id === initialReceipt.transport_attempt_id &&
        initialAttempts[1]?.outcome === 'accepted' &&
        initialAttempts[1]?.delivery_accepted === true &&
        initialAttempts[1]?.delivery_confirmed === false,
      JSON.stringify(initialAttempts))
    check('transport_attempt_ledger_is_private_regular_file',
      fs.lstatSync(attemptLedgerFile).isFile() &&
        !fs.lstatSync(attemptLedgerFile).isSymbolicLink() &&
        (fs.lstatSync(attemptLedgerFile).mode & 0o077) === 0 &&
        fs.realpathSync(attemptLedgerFile) ===
          fs.realpathSync(path.join(persistentLogs, 'transport-attempts.ndjson')) &&
        initialAttempts.length === 2,
      attemptLedgerFile)
    const attemptLedgerBackup = `${attemptLedgerFile}.fixture-backup`
    let attemptSymlinkError
    fs.renameSync(attemptLedgerFile, attemptLedgerBackup)
    try {
      fs.symlinkSync(attemptLedgerBackup, attemptLedgerFile)
      try {
        outbox.appendTransportAttemptRecord({
          ...initialAttempts[0],
          attempt_id: 'f'.repeat(64)
        })
      } catch (error) { attemptSymlinkError = error }
    } finally {
      try { fs.unlinkSync(attemptLedgerFile) } catch {}
      fs.renameSync(attemptLedgerBackup, attemptLedgerFile)
    }
    check('transport_attempt_ledger_rejects_symlink_target',
      /transport_attempt_ledger_file_invalid/.test(String(attemptSymlinkError?.message || '')),
      String(attemptSymlinkError?.message || attemptSymlinkError || ''))
    let overwriteError
    try {
      outbox.persistAcceptedProviderResponse({
        transport_attempt_id: initialReceipt.transport_attempt_id
      }, {
        http_status: 200,
        body: {
          ok: true,
          result: {
            status: 200,
            body: {
              status: 'success',
              delivery_accepted: true,
              ...initialProvider.fields
            }
          }
        }
      })
    } catch (error) { overwriteError = error }
    check('provider_raw_evidence_is_never_overwritten',
      overwriteError?.code === 'EEXIST' &&
        fs.readFileSync(initialProviderFile).equals(initialProvider.bytes),
      String(overwriteError?.message || overwriteError || ''))

    // Force the real worker to pause after a provider-accepted HTTP response
    // and before receipt/history publication. The authenticated newer inbound
    // must be durably adopted but semantic processing stays fenced until the
    // exact accepted-visible bubble is published and reconciled ahead of it.
    responseMode = 'accepted_unverified'
    const interleavingCase = makeCommittedPacket(
      control,
      root,
      'accepted-response-publication-interleaving',
      'the model rate is $150 an hour'
    )
    const interleavingFile = path.join(root, 'outbox', 'accepted-response-publication-interleaving.json')
    const observer = {
      contact_id: interleavingCase.packet.contact_id,
      thread_id: interleavingCase.packet.thread_id,
      instagram_username: 'omar.system',
      message_id: `${interleavingCase.packet.message_id}-observer`,
      text: 'I want a raven design',
      received_at: ''
    }
    let interleavingIngress = null
    let pendingInsideHook = false
    const requestsBeforeInterleaving = requests.length
    outbox.setOutboxHarnessHooks({
      after_provider_accepted_before_bookkeeping: async ({ packet }) => {
        observer.received_at = new Date(Date.parse(packet.transport_response_received_at) + 1000).toISOString()
        interleavingIngress = control.recordIngressEvent(root, observer, {
          authenticated_inbound: true,
          authentication_source: 'shared_secret'
        })
        pendingInsideHook = control.conversationContextPublicationPending(root, observer.thread_id)
      }
    })
    publishStrictQueue(interleavingFile, interleavingCase.packet)
    try {
      await outbox.handleFile(interleavingFile)
    } finally {
      outbox.setOutboxHarnessHooks(null)
    }
    const interleavingHistory = JSON.parse(fs.readFileSync(
      path.join(root, 'thread-history', `${observer.thread_id}.json`),
      'utf8'
    ))
    const interleavingAttempt = interleavingHistory.events.find((event) =>
      event.role === 'assistant_attempted' && event.message_id === interleavingCase.packet.message_id
    )
    const interleavingObserverIndex = interleavingHistory.events.findIndex((event) =>
      event.role === 'user' && event.message_id === observer.message_id
    )
    check('real_worker_provider_response_before_bookkeeping_fences_newer_inbound',
      interleavingIngress?.accepted_unverified_delivery_publication_pending === true &&
        interleavingIngress?.accepted_unverified_boundary_pending === true &&
        pendingInsideHook === true,
      JSON.stringify(interleavingIngress || {}))
    check('real_worker_provider_response_publication_reconciles_before_observer_once',
      requests.length === requestsBeforeInterleaving + 1 &&
        Boolean(interleavingAttempt) && isConversationVisibleAssistantEvent(interleavingAttempt) &&
        interleavingHistory.events.indexOf(interleavingAttempt) < interleavingObserverIndex &&
        JSON.stringify(contract.pendingUnansweredUserTurnTexts(interleavingHistory.events)) === JSON.stringify([observer.text]) &&
        control.conversationContextPublicationPending(root, observer.thread_id) === false &&
        !fs.existsSync(interleavingFile) && !fs.existsSync(`${interleavingFile}.lock`),
      JSON.stringify(interleavingHistory.events))

    responseMode = 'internal_403'
    const retryText = 'drop the reference here and i will keep the design moving with you'
    const retryCase = makeCommittedPacket(control, root, 'retry', retryText)
    retryCase.packet.attempts = 99
    const retryFile = path.join(root, 'outbox', 'retry.json')
    publishStrictQueue(retryFile, retryCase.packet)
    await outbox.handleFile(retryFile)

    const humanAgentDir = path.join(root, 'outbox_human_agent_required')
    const internalAlerts = fs.readdirSync(humanAgentDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
    const internalAlert = internalAlerts.find((packet) =>
      packet.message_id === retryCase.packet.message_id
    )
    check('internal_sender_gate_failure_stops_at_finite_cap',
      !fs.existsSync(retryFile) && !fs.existsSync(`${retryFile}.lock`) && internalAlert?.attempts === 100,
      JSON.stringify(internalAlert || {}))
    check('internal_sender_gate_failure_emits_exact_operator_alert',
      internalAlerts.filter((packet) => packet.message_id === retryCase.packet.message_id).length === 1 &&
        internalAlert?.manual_reason === 'persistent_internal_send_failure_max_retries_operator_alert',
      JSON.stringify(internalAlerts))
    check('internal_sender_gate_failure_keeps_exact_adopted_payload',
      internalAlert?.bubble?.text === retryText && internalAlert?.bubbles?.[0]?.text === retryText,
      JSON.stringify(internalAlert || {}))
    const failedDir = path.join(root, 'outbox_quarantine_failed')
    const failedFiles = fs.existsSync(failedDir) ? fs.readdirSync(failedDir) : []
    check('internal_sender_gate_failure_never_enters_quiet_failed_quarantine', failedFiles.length === 0, JSON.stringify(failedFiles))
    check('internal_sender_gate_operator_alert_remains_authoritative',
      outbox.hasValidAuthority(internalAlert) === true, JSON.stringify(internalAlert?.control_receipt || {}))

    responseMode = 'transient_429'
    const transientCase = makeCommittedPacket(
      control,
      root,
      'transient-before-success',
      'a transient final sender failure before acceptance must remain visible'
    )
    const transientFile = path.join(root, 'outbox', 'transient-before-success.json')
    publishStrictQueue(transientFile, transientCase.packet)
    await outbox.handleFile(transientFile)
    const transientRetry = JSON.parse(fs.readFileSync(transientFile, 'utf8'))
    const firstTransientAttemptId = transientRetry.transport_attempt_id
    check('transient_provider_attempt_requeues_once',
      transientRetry.attempts === 1 &&
        transientRetry.last_error_kind === 'transient_send_failure',
      JSON.stringify(transientRetry))
    responseMode = 'success'
    transientRetry.due_at = new Date(Date.now() - 10).toISOString()
    publishStrictQueue(transientFile, transientRetry)
    await outbox.handleFile(transientFile)
    const transientAttempts = readAttemptLedger()
      .filter((item) => item.message_id === transientCase.packet.message_id)
    const transientStarts = transientAttempts.filter((item) => item.record_type === 'attempt_started')
    const transientCompletions = transientAttempts
      .filter((item) => item.record_type === 'attempt_completed')
    check('retry_transport_attempt_ids_are_unique',
      transientStarts.length === 2 &&
        new Set(transientStarts.map((item) => item.attempt_id)).size === 2 &&
        transientStarts[0].attempt_id === firstTransientAttemptId,
      JSON.stringify(transientStarts))
    check('transient_before_success_is_durably_preserved',
      transientCompletions.length === 2 &&
        transientCompletions[0]?.outcome === 'transient_failure' &&
        transientCompletions[0]?.failure_class === 'transient' &&
        transientCompletions[1]?.outcome === 'accepted',
      JSON.stringify(transientCompletions))

    responseMode = 'ambiguous_provider'
    const ambiguousCase = makeCommittedPacket(
      control,
      root,
      'ambiguous',
      'this reply must never be sent a second time without reconciliation'
    )
    const ambiguousFile = path.join(root, 'outbox', 'ambiguous.json')
    const requestCountBeforeAmbiguous = requests.length
    publishStrictQueue(ambiguousFile, ambiguousCase.packet)
    await outbox.handleFile(ambiguousFile)
    const humanAgentFiles = fs.readdirSync(humanAgentDir)
    const ambiguousHold = humanAgentFiles
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
      .find((packet) => packet.message_id === ambiguousCase.packet.message_id)
    check('ambiguous_provider_result_attempted_exactly_once', requests.length === requestCountBeforeAmbiguous + 1, JSON.stringify(requests.length))
    check('ambiguous_provider_result_never_requeued', !fs.existsSync(ambiguousFile) && !fs.existsSync(`${ambiguousFile}.lock`), ambiguousFile)
    check('ambiguous_provider_result_moves_to_manual_reconciliation',
      ambiguousHold?.manual_reason === 'provider_delivery_outcome_ambiguous_no_resend' && ambiguousHold?.attempts === 1,
      JSON.stringify(ambiguousHold || {}))

    // A provider-accepted response followed by a raw-evidence filesystem
    // failure is terminal: it must be held for reconciliation, never resent.
    const providerResponseDir = path.join(root, 'logs', 'provider-send-responses')
    fs.rmSync(providerResponseDir, { recursive: true, force: true })
    fs.writeFileSync(providerResponseDir, 'not-a-directory')
    responseMode = 'success'
    const evidenceFailureCase = makeCommittedPacket(
      control,
      root,
      'provider-evidence-write-failure',
      'accepted provider response evidence failure must never cause a resend'
    )
    const evidenceFailureFile = path.join(root, 'outbox', 'provider-evidence-write-failure.json')
    const requestCountBeforeEvidenceFailure = requests.length
    publishStrictQueue(evidenceFailureFile, evidenceFailureCase.packet)
    await outbox.handleFile(evidenceFailureFile)
    const evidenceFailureHold = fs.readdirSync(humanAgentDir)
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
      .find((packet) => packet.message_id === evidenceFailureCase.packet.message_id)
    check('accepted_then_evidence_write_failure_attempted_exactly_once',
      requests.length === requestCountBeforeEvidenceFailure + 1, JSON.stringify(requests.length))
    check('accepted_then_evidence_write_failure_never_requeued',
      !fs.existsSync(evidenceFailureFile) && !fs.existsSync(`${evidenceFailureFile}.lock`),
      evidenceFailureFile)
    check('accepted_then_evidence_write_failure_moves_to_terminal_hold',
      evidenceFailureHold?.manual_reason === 'post_terminal_bookkeeping_failed_no_resend' &&
        evidenceFailureHold?.transport_terminal_outcome === 'provider_delivery_accepted',
      JSON.stringify(evidenceFailureHold || {}))
    fs.unlinkSync(providerResponseDir)

    // Force a real post-provider local write failure. An accepted result and an
    // ambiguous result must both move to a terminal manual hold, never back to
    // the active outbox where they could be sent again.
    const darwinStatePath = path.join(root, 'dm_darwin_state.json')
    if (fs.existsSync(darwinStatePath)) fs.rmSync(darwinStatePath, { recursive: true, force: true })
    fs.mkdirSync(darwinStatePath)

    responseMode = 'success'
    const acceptedBookkeepingCase = makeCommittedPacket(
      control,
      root,
      'accepted-bookkeeping-failure',
      'accepted provider response must never be retried after a local write failure'
    )
    const acceptedBookkeepingFile = path.join(root, 'outbox', 'accepted-bookkeeping-failure.json')
    const requestCountBeforeAcceptedBookkeepingFailure = requests.length
    publishStrictQueue(acceptedBookkeepingFile, acceptedBookkeepingCase.packet)
    await outbox.handleFile(acceptedBookkeepingFile)
    const acceptedBookkeepingHold = fs.readdirSync(humanAgentDir)
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
      .find((packet) => packet.message_id === acceptedBookkeepingCase.packet.message_id)
    check('accepted_then_bookkeeping_failure_attempted_exactly_once', requests.length === requestCountBeforeAcceptedBookkeepingFailure + 1, JSON.stringify(requests.length))
    check('accepted_then_bookkeeping_failure_never_requeued', !fs.existsSync(acceptedBookkeepingFile) && !fs.existsSync(`${acceptedBookkeepingFile}.lock`), acceptedBookkeepingFile)
    check('accepted_then_bookkeeping_failure_moves_to_terminal_hold',
      acceptedBookkeepingHold?.manual_reason === 'post_terminal_bookkeeping_failed_no_resend' &&
        acceptedBookkeepingHold?.transport_terminal_outcome === 'provider_delivery_accepted',
      JSON.stringify(acceptedBookkeepingHold || {}))

    responseMode = 'ambiguous_provider'
    const ambiguousBookkeepingCase = makeCommittedPacket(
      control,
      root,
      'ambiguous-bookkeeping-failure',
      'uncertain provider response must never be retried after a local write failure'
    )
    const ambiguousBookkeepingFile = path.join(root, 'outbox', 'ambiguous-bookkeeping-failure.json')
    const requestCountBeforeAmbiguousBookkeepingFailure = requests.length
    publishStrictQueue(ambiguousBookkeepingFile, ambiguousBookkeepingCase.packet)
    await outbox.handleFile(ambiguousBookkeepingFile)
    const ambiguousBookkeepingHold = fs.readdirSync(humanAgentDir)
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
      .find((packet) => packet.message_id === ambiguousBookkeepingCase.packet.message_id)
    check('ambiguous_then_bookkeeping_failure_attempted_exactly_once', requests.length === requestCountBeforeAmbiguousBookkeepingFailure + 1, JSON.stringify(requests.length))
    check('ambiguous_then_bookkeeping_failure_never_requeued', !fs.existsSync(ambiguousBookkeepingFile) && !fs.existsSync(`${ambiguousBookkeepingFile}.lock`), ambiguousBookkeepingFile)
    check('ambiguous_then_bookkeeping_failure_moves_to_terminal_hold',
      ambiguousBookkeepingHold?.manual_reason === 'post_terminal_bookkeeping_failed_no_resend' &&
        ambiguousBookkeepingHold?.transport_terminal_outcome === 'provider_delivery_outcome_ambiguous',
      JSON.stringify(ambiguousBookkeepingHold || {}))
    fs.rmSync(darwinStatePath, { recursive: true, force: true })

    // A crash after the retry packet is durably committed to the lock but
    // before publication must recover without another provider attempt.
    responseMode = 'transient_429'
    const replaceCrashCase = makeCommittedPacket(
      control,
      root,
      'retry-replace-crash',
      'keep this exact adopted reply through a retry publication crash'
    )
    const replaceCrashFile = path.join(root, 'outbox', 'retry-replace-crash.json')
    const requestsBeforeReplaceCrash = requests.length
    publishStrictQueue(replaceCrashFile, replaceCrashCase.packet)
    outbox.setOutboxHarnessHooks({
      after_retry_lock_replace_before_publish: () => {
        throw new Error('harness_crash_after_retry_lock_replace')
      }
    })
    await outbox.handleFile(replaceCrashFile)
    outbox.setOutboxHarnessHooks(null)
    const replaceCrashLock = `${replaceCrashFile}.lock`
    check('retry_replace_crash_leaves_only_valid_prepared_lock',
      !fs.existsSync(replaceCrashFile) && fs.existsSync(replaceCrashLock),
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox'))))
    fs.utimesSync(replaceCrashLock, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
    const replaceRecovery = outbox.recoverStaleOutboxLockFile(
      replaceCrashLock,
      { ...process.env, SCV_STALE_LOCK_RECOVERY_MS: '0' },
      Date.now()
    )
    const replaceRecovered = JSON.parse(fs.readFileSync(replaceCrashFile, 'utf8'))
    check('retry_replace_crash_requeues_from_durable_definitive_failure_evidence',
      replaceRecovery?.action === 'requeued' && replaceRecovered.attempts === 1 &&
        replaceRecovered.durable_requeue_transition?.schema ===
          'scv-outbox-durable-requeue-transition-2026-08-25-v1',
      JSON.stringify(replaceRecovery || {}))
    check('retry_replace_crash_never_recontacts_provider_during_recovery',
      requests.length === requestsBeforeReplaceCrash + 1,
      JSON.stringify(requests.length))
    check('retry_replace_crash_preserves_exact_adopted_payload',
      replaceRecovered.bubble.text === replaceCrashCase.packet.bubble.text &&
        replaceRecovered.bubbles[0].text === replaceCrashCase.packet.bubbles[0].text,
      JSON.stringify(replaceRecovered))

    const requestsBeforePreNetworkKill = requests.length
    const killed = spawnSync(process.execPath, ['-e', `
      const worker = require(process.argv[1]);
      worker.setOutboxHarnessHooks({
        after_authority_before_pre_network_gates: () => process.kill(process.pid, 'SIGKILL')
      });
      worker.handleFile(process.argv[2]).catch(() => process.exit(92));
    `, path.join(__dirname, 'outbox-worker.js'), replaceCrashFile], {
      encoding: 'utf8',
      env: { ...process.env, SCV_OUTBOX_TEST_HARNESS: '1' }
    })
    check('retry_dequeue_pre_network_boundary_is_killed_by_real_sigkill',
      killed.signal === 'SIGKILL', JSON.stringify({ status: killed.status, signal: killed.signal }))
    const preNetworkKillLock = `${replaceCrashFile}.lock`
    const killedPacket = JSON.parse(fs.readFileSync(preNetworkKillLock, 'utf8'))
    check('retry_dequeue_pre_network_sigkill_preserves_prior_recovery_proof',
      !fs.existsSync(replaceCrashFile) &&
        killedPacket.durable_requeue_transition?.schema ===
          'scv-outbox-durable-requeue-transition-2026-08-25-v1',
      JSON.stringify(killedPacket.durable_requeue_transition || {}))
    fs.utimesSync(preNetworkKillLock, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
    const preNetworkKillRecovery = outbox.recoverStaleOutboxLockFile(
      preNetworkKillLock,
      { ...process.env, SCV_STALE_LOCK_RECOVERY_MS: '0' },
      Date.now()
    )
    check('retry_dequeue_pre_network_sigkill_automatically_requeues',
      preNetworkKillRecovery?.action === 'requeued' &&
        fs.existsSync(replaceCrashFile) && !fs.existsSync(preNetworkKillLock),
      JSON.stringify(preNetworkKillRecovery || {}))
    check('retry_dequeue_pre_network_sigkill_never_contacts_provider',
      requests.length === requestsBeforePreNetworkKill,
      JSON.stringify(requests.length))
    fs.unlinkSync(replaceCrashFile)

    // A crash after hard-link publication leaves two names for one inode; the
    // stale recovery path must collapse them to exactly one active queue item.
    const linkCrashCase = makeCommittedPacket(
      control,
      root,
      'retry-link-crash',
      'keep exactly one active retry after a hard link publication crash'
    )
    const linkCrashFile = path.join(root, 'outbox', 'retry-link-crash.json')
    const requestsBeforeLinkCrash = requests.length
    publishStrictQueue(linkCrashFile, linkCrashCase.packet)
    outbox.setOutboxHarnessHooks({
      after_retry_publish_before_lock_unlink: () => {
        throw new Error('harness_crash_after_retry_publish')
      }
    })
    await outbox.handleFile(linkCrashFile)
    outbox.setOutboxHarnessHooks(null)
    const linkCrashLock = `${linkCrashFile}.lock`
    const publishedStat = fs.lstatSync(linkCrashFile)
    const linkedStat = fs.lstatSync(linkCrashLock)
    check('retry_publish_crash_leaves_same_inode_not_partial_copies',
      publishedStat.dev === linkedStat.dev && publishedStat.ino === linkedStat.ino,
      JSON.stringify({ published: publishedStat.ino, lock: linkedStat.ino }))
    fs.utimesSync(linkCrashLock, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
    const linkRecovery = outbox.recoverStaleOutboxLockFile(
      linkCrashLock,
      { ...process.env, SCV_STALE_LOCK_RECOVERY_MS: '0' },
      Date.now()
    )
    check('retry_publish_crash_collapses_to_exactly_one_active_queue_item',
      linkRecovery?.action === 'requeued' && fs.existsSync(linkCrashFile) && !fs.existsSync(linkCrashLock),
      JSON.stringify(linkRecovery || {}))
    check('retry_publish_crash_never_recontacts_provider_during_recovery',
      requests.length === requestsBeforeLinkCrash + 1,
      JSON.stringify(requests.length))
    fs.unlinkSync(linkCrashFile)

    // A partial original beside a different valid lock is ambiguous. Neither
    // name may remain active or be sent; both artifacts and one alert receipt
    // move to the operator queue.
    const collisionCase = makeCommittedPacket(
      control,
      root,
      'partial-original-collision',
      'never send through an ambiguous partial publication collision'
    )
    const collisionFile = path.join(root, 'outbox', 'partial-original-collision.json')
    const collisionLock = `${collisionFile}.lock`
    const requestsBeforeCollision = requests.length
    fs.writeFileSync(collisionFile, '{"partial":')
    fs.writeFileSync(collisionLock, JSON.stringify(collisionCase.packet, null, 2) + '\n')
    fs.utimesSync(collisionLock, new Date(Date.now() - 60000), new Date(Date.now() - 60000))
    const collisionRecovery = outbox.recoverStaleOutboxLockFile(
      collisionLock,
      { ...process.env, SCV_STALE_LOCK_RECOVERY_MS: '0' },
      Date.now()
    )
    check('partial_original_valid_lock_collision_never_remains_active',
      collisionRecovery?.action === 'human_agent_hold' &&
        !fs.existsSync(collisionFile) && !fs.existsSync(collisionLock),
      JSON.stringify(collisionRecovery || {}))
    check('partial_original_valid_lock_collision_preserves_both_artifacts_and_one_receipt',
      fs.existsSync(collisionRecovery?.originalDest || '') &&
        fs.existsSync(collisionRecovery?.lockDest || '') &&
        fs.existsSync(collisionRecovery?.receipt || ''),
      JSON.stringify(collisionRecovery || {}))
    check('partial_original_valid_lock_collision_never_contacts_provider',
      requests.length === requestsBeforeCollision,
      JSON.stringify(requests.length))

    check('durable_retry_mutants_leave_no_temporary_files',
      !fs.readdirSync(path.join(root, 'outbox')).some((name) => name.endsWith('.tmp')),
      JSON.stringify(fs.readdirSync(path.join(root, 'outbox'))))

    if (failures.length) {
      const err = new Error(`scv_outbox_adoption_harness_failed:${JSON.stringify(failures)}`)
      err.failures = failures
      throw err
    }

    return {
      ok: true,
      locked: true,
      lock_version: SCV_OUTBOX_ADOPTION_HARNESS_VERSION,
      checked
    }
  } finally {
    await close(server)
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value == null) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  runScvOutboxAdoptionHarness()
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
  SCV_OUTBOX_ADOPTION_HARNESS_VERSION,
  runScvOutboxAdoptionHarness
}
