#!/usr/bin/env node
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-inbox-timeout-'))
  const previousRoot = process.env.SCV_ROOT
  const previousInboxHarness = process.env.SCV_INBOX_TEST_HARNESS
  const previousSuppressionBypass = process.env.SCV_SUPPRESSION_BYPASS_USERNAMES
  const sockets = new Set()
  let checked = 0
  const ok = (condition, label, detail = '') => {
    checked += 1
    if (!condition) throw new Error(`${label}${detail ? `:${detail}` : ''}`)
  }

  try {
    process.env.SCV_ROOT = root
    process.env.SCV_INBOX_TEST_HARNESS = '1'
    process.env.SCV_SUPPRESSION_BYPASS_USERNAMES = 'stage.test'
    fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
    const workerPath = require.resolve(path.join(__dirname, 'inbox-worker.js'))
    delete require.cache[workerPath]
    const inbox = require(workerPath)
    const {
      recordIngressEvent,
      statePath,
      executeSingleControlTurn
    } = require(path.join(__dirname, 'scv-single-control-plane.js'))
    const {
      ROUTE_AWARE_VISIBLE_RECOVERY_VERSION
    } = require(path.join(__dirname, 'scv-deterministic-recovery.js'))

    let hangRequests = 0
    let bodyHangRequests = 0
    let oversizedRequests = 0
    let healthyRequests = 0
    const server = http.createServer((request, response) => {
      request.resume()
      if (request.url === '/hang') {
        hangRequests += 1
        return
      }
      if (request.url === '/body-hang') {
        bodyHangRequests += 1
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.flushHeaders()
        response.write('{"partial":')
        return
      }
      if (request.url === '/oversized') {
        oversizedRequests += 1
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': '4096'
        })
        response.end('{}')
        return
      }
      healthyRequests += 1
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"ok":true}')
    })
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    const origin = `http://127.0.0.1:${address.port}`
    // Warm Node's fetch/undici initialization before applying the 100 ms
    // request timeout. Otherwise a heavily loaded harness run can abort during
    // one-time client startup before the loopback server observes the request.
    const warm = await inbox.post3101({ probe: 'loopback-fetch-warmup' }, {
      url: `${origin}/ok`,
      timeoutMs: 500
    })
    if (warm.http_status !== 200 || warm.body?.ok !== true) {
      throw new Error('loopback_fetch_warmup_failed')
    }
    healthyRequests = 0

    const startedAt = Date.now()
    let timeoutError = null
    try {
      await inbox.post3101({ probe: 'bounded-hang' }, {
        url: `${origin}/hang`,
        timeoutMs: 100
      })
    } catch (error) {
      timeoutError = error
    }
    const elapsedMs = Date.now() - startedAt
    ok(hangRequests === 1, 'hanging_3101_request_reached_loopback_server', String(hangRequests))
    ok(timeoutError && /^3101_post_timeout_100$/.test(String(timeoutError.message || '')),
      'hanging_3101_request_has_typed_timeout', String(timeoutError?.message || ''))
    ok(elapsedMs >= 50 && elapsedMs < 1500,
      'hanging_3101_request_is_bounded', String(elapsedMs))
    ok(inbox.isTransientDeliveryError(timeoutError.message) === true,
      'typed_3101_timeout_is_transient_delivery')

    const bodyStartedAt = Date.now()
    let bodyTimeoutError = null
    try {
      await inbox.post3101({ probe: 'bounded-header-then-body-hang' }, {
        url: `${origin}/body-hang`,
        timeoutMs: 100
      })
    } catch (error) {
      bodyTimeoutError = error
    }
    const bodyElapsedMs = Date.now() - bodyStartedAt
    ok(bodyHangRequests === 1, 'header_then_body_hang_reached_loopback_server', String(bodyHangRequests))
    ok(bodyTimeoutError && /^3101_post_timeout_100$/.test(String(bodyTimeoutError.message || '')),
      'header_then_body_hang_has_typed_timeout', String(bodyTimeoutError?.message || ''))
    ok(bodyElapsedMs >= 50 && bodyElapsedMs < 1500,
      'header_then_body_hang_is_bounded', String(bodyElapsedMs))
    ok(inbox.isTransientDeliveryError(bodyTimeoutError.message) === true,
      'header_then_body_timeout_is_transient_delivery')

    let taggedTransportError = null
    try {
      await inbox.post3101({ probe: 'stage-tagged-fetch-rejection' }, {
        timeoutMs: 500,
        fetchImpl: async () => {
          const error = new TypeError('fetch failed')
          error.code = 'ECONNRESET'
          throw error
        }
      })
    } catch (error) {
      taggedTransportError = error
    }
    ok(
      String(taggedTransportError?.message || '') ===
        '3101_post_transport_error:ECONNRESET',
      'raw_3101_fetch_rejection_is_stage_tagged',
      String(taggedTransportError?.message || '')
    )
    ok(inbox.isExplicitPost3101DeliveryError(taggedTransportError?.message) === true,
      'stage_tagged_fetch_rejection_is_explicit_delivery')
    ok(inbox.isExplicitPost3101DeliveryError('TypeError: fetch failed') === false,
      'untagged_fetch_wording_is_not_delivery_stage_authority')

    let oversizedError = null
    try {
      await inbox.post3101({ probe: 'bounded-response-bytes' }, {
        url: `${origin}/oversized`,
        timeoutMs: 500,
        maxResponseBytes: 1024
      })
    } catch (error) {
      oversizedError = error
    }
    ok(oversizedRequests === 1, 'oversized_3101_response_reached_loopback_server', String(oversizedRequests))
    ok(oversizedError && /^3101_response_too_large_1024$/.test(String(oversizedError.message || '')),
      'oversized_3101_response_is_rejected_before_body_read', String(oversizedError?.message || ''))

    const nextStartedAt = Date.now()
    const next = await inbox.post3101({ probe: 'next-thread-progress' }, {
      url: `${origin}/ok`,
      timeoutMs: 500
    })
    const nextElapsedMs = Date.now() - nextStartedAt
    ok(next.http_status === 200 && next.body?.ok === true && healthyRequests === 1,
      'next_internal_request_progresses_after_hung_request_abort', JSON.stringify(next))
    ok(nextElapsedMs < 500, 'next_internal_request_progress_is_bounded', String(nextElapsedMs))

    const lock = path.join(root, 'inbox', 'timeout-retry.json.lock')
    const packet = {
      contact_id: 'timeout-thread',
      thread_id: 'timeout-thread',
      instagram_username: 'timeout.test',
      message_id: 'timeout-message',
      text: 'hello',
      attempts: 0,
      received_at: '2026-08-25T12:00:00.000Z'
    }
    fs.writeFileSync(lock, JSON.stringify(packet, null, 2) + '\n', { mode: 0o600 })
    const timeoutTerminal = inbox.releaseForRetry(lock, packet, timeoutError)
    const retryFile = lock.replace(/\.lock$/, '')
    ok(!fs.existsSync(lock) && !fs.existsSync(retryFile),
      'post3101_timeout_without_committed_decision_is_terminally_retired')
    ok(
      timeoutTerminal?.terminal === true &&
      timeoutTerminal?.human_action_pending === true &&
      timeoutTerminal?.no_blind_resend === true &&
      timeoutTerminal?.operator_alert_created === true,
      'post3101_timeout_without_commit_holds_without_blind_generation',
      JSON.stringify(timeoutTerminal)
    )
    const timeoutHolds = fs.readdirSync(path.join(root, 'outbox_human_agent_required'))
      .filter((name) => name.startsWith('delivery-reconciliation-required-'))
    ok(timeoutHolds.length === 1,
      'post3101_timeout_without_commit_creates_exactly_one_operator_hold',
      JSON.stringify(timeoutHolds))
    ok(!fs.readdirSync(path.join(root, 'inbox')).some((name) => name.endsWith('.tmp')),
      'timed_out_internal_request_leaves_no_partial_retry_temp')

    // Real process boundary regression: generation has already committed the
    // exact receipt/state, then a local conversion/audit write fails before any
    // 3101 request starts. processLockedFile must preserve that stage so retry
    // routing replays the committed decision and never opens an ambiguous
    // delivery hold or invokes a fresh model generation.
    const preNetworkPacket = {
      contact_id: 'stage-prenetwork-thread',
      thread_id: 'stage-prenetwork-thread',
      instagram_username: 'stage.test',
      message_id: 'stage-prenetwork-message',
      text: 'yes plz',
      attempts: 0,
      received_at: '2026-08-25T12:00:00.000Z',
      live_turn_context_relation: 'coherent',
      control_force_route_aware_visible_recovery: true,
      control_route_aware_visible_recovery_version:
        ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
      control_route_aware_visible_recovery_after_attempts: 12,
      control_route_aware_visible_recovery_reason: 'persistent_failure_exhausted',
      last_error_kind: 'persistent_internal_control'
    }
    recordIngressEvent(root, preNetworkPacket)
    const preNetworkStateFile = statePath(root, preNetworkPacket.thread_id)
    const preNetworkSeed = {
      ...JSON.parse(fs.readFileSync(preNetworkStateFile, 'utf8')),
      tattoo_intent_active: true,
      known_design_context: 'blackwork snake',
      form_offer_asked: true,
      form_link_sent: false,
      form_submitted: false,
      double_check_sent: false,
      deposit_requested: false
    }
    fs.writeFileSync(
      preNetworkStateFile,
      JSON.stringify(preNetworkSeed, null, 2) + '\n'
    )
    const committedPreNetwork = executeSingleControlTurn(preNetworkPacket, { root })
    const preNetworkStateBeforeFailure = fs.readFileSync(preNetworkStateFile, 'utf8')
    const preNetworkLock = path.join(
      root,
      'inbox',
      'stage-prenetwork.json.lock'
    )
    fs.writeFileSync(
      preNetworkLock,
      JSON.stringify(preNetworkPacket, null, 2) + '\n',
      { mode: 0o600 }
    )
    inbox.setInboxHarnessHooks({
      beforeCommittedPreNetworkLocalWork: () => {
        throw new Error('test_record_conversion_snapshot_failure')
      }
    })
    let preNetworkStageError = null
    try {
      await inbox.processLockedFile(preNetworkLock)
    } catch (error) {
      preNetworkStageError = error
    } finally {
      inbox.setInboxHarnessHooks(null)
    }
    ok(
      preNetworkStageError?.control_inbox_execution_stage ===
        inbox.INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK &&
      fs.existsSync(preNetworkLock) &&
      fs.readFileSync(preNetworkStateFile, 'utf8') ===
        preNetworkStateBeforeFailure,
      'committed_local_failure_is_explicitly_tagged_before_network_and_preserves_lock_state',
      JSON.stringify({
        message: String(preNetworkStageError?.message || ''),
        stage: String(preNetworkStageError?.control_inbox_execution_stage || '')
      })
    )
    const preNetworkRetryResult = inbox.releaseForRetry(
      preNetworkLock,
      preNetworkPacket,
      preNetworkStageError
    )
    const preNetworkRetryFile = preNetworkLock.replace(/\.lock$/, '')
    const preNetworkRetry = JSON.parse(
      fs.readFileSync(preNetworkRetryFile, 'utf8')
    )
    const preNetworkOutbox = path.join(root, 'outbox')
    const preNetworkHolds = path.join(root, 'outbox_human_agent_required')
    const preNetworkContactHolds = fs.existsSync(preNetworkHolds)
      ? fs.readdirSync(preNetworkHolds)
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(
          fs.readFileSync(path.join(preNetworkHolds, name), 'utf8')
        ))
        .filter((entry) => (
          String(entry?.contact_id || entry?.thread_id || '') ===
          preNetworkPacket.contact_id
        ))
      : []
    ok(
      preNetworkRetryResult?.requeued === true &&
      preNetworkRetryResult?.committed_decision_present === true &&
      preNetworkRetry.attempts === 1 &&
      preNetworkRetry.control_inbox_last_failure_stage ===
        inbox.INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK &&
      !preNetworkRetry.control_final_recovery_phase &&
      fs.existsSync(preNetworkRetryFile) &&
      !fs.existsSync(preNetworkLock) &&
      (!fs.existsSync(preNetworkOutbox) ||
        fs.readdirSync(preNetworkOutbox).length === 0) &&
      preNetworkContactHolds.length === 0 &&
      fs.readFileSync(preNetworkStateFile, 'utf8') ===
        preNetworkStateBeforeFailure,
      'committed_prenetwork_failure_requeues_exact_decision_without_delivery_hold',
      JSON.stringify({ preNetworkRetryResult, preNetworkRetry })
    )
    let forbiddenPreNetworkGeneratorCalls = 0
    const replayedPreNetwork = executeSingleControlTurn(preNetworkRetry, {
      root,
      candidateGenerator: () => {
        forbiddenPreNetworkGeneratorCalls += 1
        throw new Error('pre_network_retry_must_not_generate')
      }
    })
    ok(
      replayedPreNetwork.replayed_control_decision === true &&
      forbiddenPreNetworkGeneratorCalls === 0 &&
      replayedPreNetwork.control_receipt?.receipt_sha256 ===
        committedPreNetwork.control_receipt?.receipt_sha256 &&
      JSON.stringify(replayedPreNetwork.packet.bubbles) ===
        JSON.stringify(committedPreNetwork.packet.bubbles) &&
      fs.readFileSync(preNetworkStateFile, 'utf8') ===
        preNetworkStateBeforeFailure,
      'committed_prenetwork_retry_replays_receipt_without_generation_or_state_mutation',
      JSON.stringify({ forbiddenPreNetworkGeneratorCalls })
    )

    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => server.close(resolve))
    return {
      ok: true,
      checked,
      hang_elapsed_ms: elapsedMs,
      body_hang_elapsed_ms: bodyElapsedMs,
      next_elapsed_ms: nextElapsedMs
    }
  } finally {
    for (const socket of sockets) socket.destroy()
    if (previousRoot === undefined) delete process.env.SCV_ROOT
    else process.env.SCV_ROOT = previousRoot
    if (previousInboxHarness === undefined) delete process.env.SCV_INBOX_TEST_HARNESS
    else process.env.SCV_INBOX_TEST_HARNESS = previousInboxHarness
    if (previousSuppressionBypass === undefined) {
      delete process.env.SCV_SUPPRESSION_BYPASS_USERNAMES
    } else {
      process.env.SCV_SUPPRESSION_BYPASS_USERNAMES = previousSuppressionBypass
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  run()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error)}\n`)
      process.exit(1)
    })
}

module.exports = { run }
