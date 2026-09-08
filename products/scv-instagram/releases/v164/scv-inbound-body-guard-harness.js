#!/usr/bin/env node
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const {
  preflightProofVerdict,
  readPreflightProof,
  inboundIdentityVerdict,
  manychatSubscriberInfoUrl,
  manychatSubscriberGetInfo,
  boundedInstagramSuppression,
  server: importedServer
} = require('./inbound-scv.js')
const { buildPreflightProof } = require('./scv-production-entry.js')

const ROOT = __dirname
let checked = 0
function ok(condition, label, detail = '') {
  assert.ok(condition, `${label}${detail ? `:${detail}` : ''}`)
  checked++
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((err) => err ? reject(err) : resolve(port))
    })
  })
}

async function waitForLive(baseUrl, child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`inbound_child_exited:${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/livez`)
      if (response.ok) return response.json()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('inbound_liveness_timeout')
}

async function postRaw(baseUrl, body, token = '') {
  const response = await fetch(`${baseUrl}/manychat/inbound`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-scv-ingress-token': token } : {})
    },
    body
  })
  return { status: response.status, headers: response.headers, body: await response.json() }
}

async function getJson(baseUrl, pathname, adminToken = '') {
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: adminToken ? { 'x-scv-admin-token': adminToken } : {}
  })
  return { status: response.status, headers: response.headers, body: await response.json() }
}

function runtimeMutationSnapshot(root) {
  return Object.fromEntries(
    ['inbox', 'thread-state', 'thread-history', 'reactbox', 'outbox_human_agent_required']
      .map((dir) => [dir, fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).sort() : []])
  )
}

function sendPartialBody(port, ingressToken) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const socket = net.createConnection({ host: '127.0.0.1', port })
    let raw = ''
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve({ raw, elapsed_ms: Date.now() - started })
    }
    const deadline = setTimeout(() => {
      socket.destroy()
      if (!settled) reject(new Error('partial_body_connection_not_bounded'))
    }, 2_000)
    socket.once('connect', () => socket.write([
      'POST /manychat/inbound HTTP/1.1',
      'Host: 127.0.0.1',
      'Content-Type: application/json',
      `x-scv-ingress-token: ${ingressToken}`,
      'Content-Length: 100',
      'Connection: close',
      '',
      '{'
    ].join('\r\n')))
    socket.on('data', (chunk) => { raw += String(chunk) })
    socket.once('end', finish)
    socket.once('close', finish)
    socket.once('error', reject)
  })
}

async function main() {
  const fakeRelease = {
    ok: true,
    release_id: 'scv-instagram-golden-production-focused-proof',
    content_fingerprint_sha256: 'a'.repeat(64),
    release_manifest_sha256: 'b'.repeat(64)
  }
  const fakeReceipt = {
    ok: true,
    mode: 'production',
    firewall: { ok: true },
    release: fakeRelease,
    approval: { required: true, ok: true },
    transition: { required: true, ok: true },
    nodeRuntime: { expected: 'v20.20.2', actual: 'v20.20.2' }
  }
  const proof = buildPreflightProof(fakeReceipt, new Date('2026-08-20T00:00:00.000Z'))
  const proofEnv = {
    SCV_PREFLIGHT_PROOF_B64: Buffer.from(JSON.stringify(proof)).toString('base64url'),
    // Trusted runtime mutations after preflight must not invalidate the proof.
    SCV_PERSISTENCE_READY: '1',
    SCV_OUTBOUND1_PORT: '3101',
    SCV_GOLDEN_RELEASE_ID: fakeRelease.release_id
  }
  ok(readPreflightProof(proofEnv)?.release_id === fakeRelease.release_id, 'preflight_proof_decodes')
  ok(preflightProofVerdict(fakeRelease, 'production', proofEnv).ok === true, 'preflight_proof_survives_runtime_env_mutation')
  ok(preflightProofVerdict(
    { ...fakeRelease, release_manifest_sha256: 'c'.repeat(64) },
    'production',
    proofEnv
  ).ok === false, 'preflight_proof_rejects_manifest_change')
  ok(preflightProofVerdict(fakeRelease, 'production', {}).ok === false, 'preflight_proof_required_in_cloud')
  ok(importedServer.requestTimeout > 0 && importedServer.requestTimeout <= 30_000, 'request_timeout_is_bounded')
  ok(importedServer.headersTimeout > 0 && importedServer.headersTimeout <= importedServer.requestTimeout, 'headers_timeout_is_bounded')
  ok(importedServer.keepAliveTimeout > 0 && importedServer.keepAliveTimeout <= 10_000, 'keepalive_timeout_is_bounded')
  ok(inboundIdentityVerdict({ contact_id: '123', thread_id: '123' }, { SCV_CLOUD_RUNTIME: '1' }).ok === true, 'canonical_cloud_identity_allowed')
  ok(inboundIdentityVerdict({ contact_id: '9007199254740993', thread_id: '9007199254740993' }, { SCV_CLOUD_RUNTIME: '1' }).ok === false, 'unsafe_integer_precision_identity_rejected')
  ok(inboundIdentityVerdict({ contact_id: 'a/b', thread_id: 'a_b' }, { SCV_CLOUD_RUNTIME: '1' }).ok === false, 'unsafe_cloud_identity_rejected')
  ok(
    manychatSubscriberInfoUrl({ SCV_CLOUD_RUNTIME: '1', MANYCHAT_SUBSCRIBER_INFO_URL: 'https://attacker.invalid/steal' }) === 'https://api.manychat.com/fb/subscriber/getInfo',
    'cloud_manychat_endpoint_override_ignored'
  )
  let requestedManychatUrl = ''
  let attackerCredentialHits = 0
  await manychatSubscriberGetInfo('123', {
    env: { SCV_CLOUD_RUNTIME: '1', MANYCHAT_SUBSCRIBER_INFO_URL: 'https://attacker.invalid/steal' },
    apiKey: 'private-manychat-key',
    timeoutMs: 100,
    fetchImpl: async (url) => {
      requestedManychatUrl = String(url)
      if (new URL(url).hostname === 'attacker.invalid') attackerCredentialHits += 1
      return { status: 200, text: async () => JSON.stringify({ status: 'success', data: {} }) }
    }
  })
  ok(requestedManychatUrl.startsWith('https://api.manychat.com/fb/subscriber/getInfo?'), 'manychat_key_sent_only_to_official_endpoint')
  ok(attackerCredentialHits === 0, 'malicious_manychat_override_never_receives_key')
  const instagramTimeoutStarted = Date.now()
  const instagramTimeout = await boundedInstagramSuppression('private.user', {}, {
    lookup: () => new Promise(() => {}),
    timeoutMs: 50
  })
  ok(instagramTimeout.reason === 'instagram_thread_lookup_timeout', 'hanging_instagram_lookup_fails_open_bounded')
  ok(Date.now() - instagramTimeoutStarted < 1_000, 'instagram_lookup_timeout_returns_promptly')
  const manychatTimeoutStarted = Date.now()
  let manychatTimedOut = false
  try {
    await manychatSubscriberGetInfo('123', {
      env: {}, apiKey: 'test', timeoutMs: 50, fetchImpl: () => new Promise(() => {})
    })
  } catch (error) {
    manychatTimedOut = error?.code === 'SCV_ENRICHMENT_TIMEOUT'
  }
  ok(manychatTimedOut && Date.now() - manychatTimeoutStarted < 1_000, 'hanging_manychat_lookup_is_bounded')

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-inbound-body-guard-'))
  fs.mkdirSync(path.join(tempRoot, 'logs'), { recursive: true })
  const driftStatusFile = path.join(tempRoot, 'logs', 'drift-status.json')
  fs.writeFileSync(driftStatusFile, JSON.stringify({ ok: false, alert_count: 1 }))
  const stabilityPii = {
    at: '2026-08-20T00:00:00.000Z',
    contact_id: 'private-stability-contact',
    thread_id: 'private-stability-contact',
    instagram_username: 'private.stability.user',
    message_id: 'private-stability-message',
    text_sha256: 'c'.repeat(64),
    text_length: 17,
    delivery_status: 'accepted',
    delivery_accepted: true
  }
  fs.writeFileSync(
    path.join(tempRoot, 'logs', 'last-delivery.json'),
    JSON.stringify(stabilityPii)
  )
  const port = await reservePort()
  const recoveryCutoverAt = new Date(Date.now() - 60_000).toISOString()
  const ingressToken = 'ingress-token-that-is-at-least-thirty-two-bytes'
  const adminToken = 'admin-token-that-is-at-least-thirty-two-bytes'
  const child = spawn(process.execPath, [path.join(ROOT, 'inbound-scv.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      SCV_ROOT: tempRoot,
      SCV_INBOUND_PORT: String(port),
      SCV_BIND_HOST: '127.0.0.1',
      SCV_REACTION_ENABLED: '0',
      SCV_FAIL_CLOSED_RECOVERY: '1',
      SCV_CLOUD_RUNTIME: '0',
      SCV_INBOUND_AUTH_REQUIRED: '1',
      SCV_ADMIN_AUTH_REQUIRED: '1',
      SCV_MANYCHAT_INGRESS_SECRET: ingressToken,
      SCV_ADMIN_SHARED_SECRET: adminToken,
      SCV_LEGACY_INTERNAL_QUEUE_HTTP: '0',
      SCV_RECOVERY_CUTOVER_AT: recoveryCutoverAt,
      SCV_HOLD_STALE_BACKLOG_MS: String(15 * 60 * 1000),
      SCV_INBOUND_REQUEST_TIMEOUT_MS: '250',
      SCV_INBOUND_HEADERS_TIMEOUT_MS: '200',
      SCV_INBOUND_KEEP_ALIVE_TIMEOUT_MS: '100',
      MANYCHAT_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr.on('data', (chunk) => { stderr += String(chunk) })

  try {
    const baseUrl = `http://127.0.0.1:${port}`
    const live = await waitForLive(baseUrl, child)
    ok(live.ok === true, 'liveness_before')

    const readiness = await getJson(baseUrl, '/readyz')
    ok(readiness.status === 503 && readiness.body.ok === false, 'readiness_fails_closed_when_guards_red')
    ok(readiness.headers.get('cache-control') === 'no-store', 'readiness_response_not_cacheable')
    ok(readiness.headers.get('x-content-type-options') === 'nosniff', 'readiness_response_nosniff')
    ok(!readiness.headers.has('access-control-allow-origin'), 'cors_remains_absent')
    ok(!JSON.stringify(readiness.body).includes(tempRoot), 'public_readiness_has_no_local_paths')
    ok(readiness.body.release && typeof readiness.body.release.release_id === 'string', 'public_readiness_has_redacted_release_identity')
    ok(typeof readiness.body.release.phase_ready === 'boolean', 'public_readiness_has_redacted_phase_verdict')
    ok(!Object.hasOwn(readiness.body, 'golden_production_release'), 'public_readiness_omits_full_release_receipt')
    for (const privateField of ['failures', 'automation_paused', 'pause_non_test', 'pause_debug_accounts', 'runtime_namespace']) {
      ok(!Object.hasOwn(readiness.body, privateField), `public_readiness_omits_${privateField}`)
    }

    const stabilityUnauthorized = await getJson(baseUrl, '/stability')
    ok(stabilityUnauthorized.status === 401, 'stability_requires_admin_auth')
    const stabilityWrongHeader = await fetch(`${baseUrl}/stability`, {
      headers: { 'x-scv-admin-secret': adminToken }
    })
    ok(stabilityWrongHeader.status === 401, 'stability_rejects_noncanonical_admin_header')
    const stabilityRed = await getJson(baseUrl, '/stability', adminToken)
    ok(stabilityRed.status === 503, 'stability_red_http_status', String(stabilityRed.status))
    ok(stabilityRed.body.transport_ok === true, 'stability_red_transport_alive')
    ok(stabilityRed.body.ok === false, 'stability_red_cannot_report_green')
    ok(stabilityRed.body.drift_status?.ok === false, 'stability_red_preserves_drift_status')
    ok(!JSON.stringify(stabilityRed.body).includes('private-stability'), 'stability_payload_redacts_delivery_identity')
    ok(
      stabilityRed.body.last_delivery?.message_sha256 === crypto.createHash('sha256')
        .update(stabilityPii.message_id)
        .digest('hex'),
      'stability_payload_keeps_hashed_delivery_correlation'
    )
    ok(!JSON.stringify(stabilityRed.body).includes(tempRoot), 'stability_payload_omits_internal_paths')
    ok(!Object.hasOwn(stabilityRed.body.readiness || {}, 'golden_production_release'), 'stability_payload_omits_full_guard_receipts')

    fs.writeFileSync(driftStatusFile, JSON.stringify({ ok: true, alert_count: 0 }))
    const stabilityGreen = await getJson(baseUrl, '/stability', adminToken)
    ok(stabilityGreen.status === 503, 'stability_stays_red_when_other_guards_red')
    ok(stabilityGreen.body.drift_status?.ok === true, 'stability_green_preserves_drift_status')

    const unauthorized = await postRaw(baseUrl, JSON.stringify({
      contact_id: 'must-not-write',
      message_text: 'must-not-write-this-message'
    }))
    ok(unauthorized.status === 401, 'inbound_requires_auth')
    ok(fs.readdirSync(path.join(tempRoot, 'inbox')).length === 0, 'unauthorized_has_zero_queue_mutation')
    ok(!fs.existsSync(path.join(tempRoot, 'logs', 'inbound-raw.ndjson')), 'unauthorized_has_zero_audit_mutation')

    const wrongToken = await postRaw(baseUrl, '{}', 'wrong-token')
    ok(wrongToken.status === 401, 'wrong_ingress_token_rejected')

    const malformed = await postRaw(baseUrl, '{not-json', ingressToken)
    ok(malformed.status === 400, 'malformed_status', String(malformed.status))
    ok(malformed.body.error === 'invalid_json', 'malformed_reason', malformed.body.error)
    ok(malformed.headers.get('cache-control') === 'no-store', 'ingress_error_not_cacheable')

    const missing = await postRaw(baseUrl, '{}', ingressToken)
    ok(missing.status === 400, 'missing_status', String(missing.status))
    ok(missing.body.error === 'invalid_inbound_identity', 'missing_reason', missing.body.error)

    const unsafeIdentity = await postRaw(baseUrl, JSON.stringify({
      contact_id: 'a/b', thread_id: 'a_b', message_text: 'must not collide'
    }), ingressToken)
    ok(unsafeIdentity.status === 400 && unsafeIdentity.body.error === 'invalid_inbound_identity', 'unsafe_identity_rejected_before_enrichment')
    const mismatchedIdentity = await postRaw(baseUrl, JSON.stringify({
      contact_id: '900000008', thread_id: '900000009', message_text: 'must not cross threads'
    }), ingressToken)
    ok(mismatchedIdentity.status === 400 && mismatchedIdentity.body.error === 'invalid_inbound_identity', 'mismatched_identity_rejected')
    ok(runtimeMutationSnapshot(tempRoot).inbox.length === 0, 'invalid_identity_has_zero_queue_mutation')

    const beforePartial = runtimeMutationSnapshot(tempRoot)
    const partial = await sendPartialBody(port, ingressToken)
    ok(partial.elapsed_ms < 2_000, 'partial_body_request_is_bounded', String(partial.elapsed_ms))
    ok(partial.raw.includes('408'), 'partial_body_returns_timeout_status')
    ok(JSON.stringify(runtimeMutationSnapshot(tempRoot)) === JSON.stringify(beforePartial), 'partial_body_has_zero_queue_or_state_mutation')

    const staleContactId = '9988776655'
    const staleMessageId = 'direct-manychat-april-retry-1'
    const staleText = 'old direct webhook must never enter live context'
    const stale = await postRaw(baseUrl, JSON.stringify({
      contact_id: staleContactId,
      thread_id: staleContactId,
      message_id: staleMessageId,
      instagram_username: 'private.old.retry',
      message_text: staleText,
      source_interaction_at: '2026-04-15T12:00:00.000Z'
    }), ingressToken)
    ok(stale.status === 200 && stale.body.stored === false && stale.body.held === true, 'pre_cutover_direct_retry_human_held')
    ok(stale.body.reason === 'recovery_ingress_before_cutover', 'pre_cutover_direct_retry_reason', stale.body.reason)
    ok(fs.readdirSync(path.join(tempRoot, 'thread-state')).length === 0, 'writer_hold_has_zero_thread_state_mutation')
    ok(fs.readdirSync(path.join(tempRoot, 'thread-history')).length === 0, 'writer_hold_has_zero_thread_history_mutation')
    ok(fs.readdirSync(path.join(tempRoot, 'inbox')).length === 0, 'writer_hold_has_zero_inbox_mutation')
    ok(fs.readdirSync(path.join(tempRoot, 'reactbox')).length === 0, 'writer_hold_has_zero_reaction_mutation')
    const humanHoldDir = path.join(tempRoot, 'outbox_human_agent_required')
    const humanHoldFiles = fs.readdirSync(humanHoldDir).filter((name) => name.endsWith('.json'))
    ok(humanHoldFiles.length === 1, 'writer_hold_is_single_persistent_artifact', JSON.stringify(humanHoldFiles))
    const humanHoldFile = path.join(humanHoldDir, humanHoldFiles[0])
    const humanHold = JSON.parse(fs.readFileSync(humanHoldFile, 'utf8'))
    ok(humanHold.contact_id === staleContactId && humanHold.message_id === staleMessageId && humanHold.text === staleText, 'writer_hold_preserves_full_manual_payload')
    ok(humanHold.held_at_writer_boundary === true && humanHold.human_agent_required === true, 'writer_hold_marks_manual_boundary')
    ok((fs.statSync(humanHoldFile).mode & 0o077) === 0, 'writer_hold_not_group_or_world_readable')

    const unicode = await postRaw(baseUrl, JSON.stringify({
      contact_id: '900000001',
      thread_id: '900000001',
      message_id: '../../qa-msg',
      instagram_username: 'qa.user',
      message_text: 'Can I ask uou a question? 안녕 🖤'
    }), ingressToken)
    ok(unicode.status === 200 && unicode.body.stored === true, 'unicode_accepted')
    ok(!Object.hasOwn(unicode.body, 'inbox_file') && !Object.hasOwn(unicode.body, 'packet'), 'success_response_redacts_packet_and_paths')
    const inboxDir = path.join(tempRoot, 'inbox')
    const inboxFiles = fs.readdirSync(inboxDir).filter((name) => name.endsWith('.json'))
    ok(inboxFiles.length === 1, 'unicode_inbox_written')
    const inboxFile = path.join(inboxDir, inboxFiles[0])
    ok(path.resolve(inboxFile).startsWith(path.resolve(tempRoot) + path.sep), 'message_id_cannot_escape_root', inboxFile)
    ok((fs.statSync(inboxFile).mode & 0o077) === 0, 'inbox_state_not_group_or_world_readable')

    const noIdPayload = JSON.stringify({
      contact_id: '900000002',
      thread_id: '900000002',
      instagram_username: 'qa.no.id',
      message_text: 'same webhook retry without upstream id'
    })
    const noIdFirst = await postRaw(baseUrl, noIdPayload, ingressToken)
    const noIdSecond = await postRaw(baseUrl, noIdPayload, ingressToken)
    ok(noIdFirst.status === 200 && noIdFirst.body.stored === true, 'missing_upstream_id_first_delivery_stored')
    ok(noIdSecond.status === 200 && noIdSecond.body.stored === true && noIdSecond.body.duplicate !== true,
      'missing_upstream_id_identical_second_delivery_is_not_silenced')
    ok(noIdFirst.body.message_id !== noIdSecond.body.message_id,
      'missing_upstream_id_each_authenticated_arrival_gets_unique_id')
    const noIdInboxPackets = fs.readdirSync(inboxDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(inboxDir, name), 'utf8')))
      .filter((packet) => packet.contact_id === '900000002')
    ok(noIdInboxPackets.length === 2, 'same_text_without_id_or_time_creates_two_inbox_turns')
    ok(noIdInboxPackets.every((packet) => packet.message_id_authority === 'ambiguous_arrival'),
      'same_text_without_id_or_time_records_ambiguous_arrival_authority')
    const noIdHistory = JSON.parse(fs.readFileSync(path.join(tempRoot, 'thread-history', '900000002.json'), 'utf8'))
    const noIdUserTurns = noIdHistory.events.filter((event) => event.role === 'user')
    ok(noIdUserTurns.length === 2, 'same_text_without_id_or_time_creates_two_control_turns')
    ok(new Set(noIdUserTurns.map((event) => event.message_id)).size === 2,
      'same_text_without_id_or_time_control_turn_ids_are_distinct')

    const interactionBase = Date.now()
    const repeatedText = 'yes plz'
    const distinctFirst = await postRaw(baseUrl, JSON.stringify({
      contact_id: '900000005',
      thread_id: '900000005',
      instagram_username: 'qa.repeated.turn',
      message_text: repeatedText,
      source_interaction_at: new Date(interactionBase - 2_000).toISOString()
    }), ingressToken)
    const distinctSecond = await postRaw(baseUrl, JSON.stringify({
      contact_id: '900000005',
      thread_id: '900000005',
      instagram_username: 'qa.repeated.turn',
      message_text: repeatedText,
      source_interaction_at: new Date(interactionBase - 1_000).toISOString()
    }), ingressToken)
    ok(distinctFirst.body.stored === true && distinctSecond.body.stored === true,
      'identical_text_at_distinct_authenticated_interaction_times_is_two_turns')
    ok(distinctFirst.body.message_id !== distinctSecond.body.message_id,
      'distinct_authenticated_interaction_times_get_distinct_event_ids')

    const crashGapPayload = JSON.stringify({
      contact_id: '900000006',
      thread_id: '900000006',
      message_id: 'qa-crash-gap-1',
      instagram_username: 'qa.crash.gap',
      message_text: 'I just submit'
    })
    const crashGapFirst = await postRaw(baseUrl, crashGapPayload, ingressToken)
    const crashGapInbox = path.join(inboxDir, 'qa-crash-gap-1.json')
    ok(crashGapFirst.body.stored === true && fs.existsSync(crashGapInbox), 'crash_gap_first_ingress_has_durable_work')
    fs.unlinkSync(crashGapInbox)
    const crashGapHistoryFile = path.join(tempRoot, 'thread-history', '900000006.json')
    const crashGapHistory = JSON.parse(fs.readFileSync(crashGapHistoryFile, 'utf8'))
    crashGapHistory.events.push({
      role: 'assistant',
      message_id: 'different-event-cannot-prove-terminal',
      text: 'unrelated later output',
      at: new Date().toISOString()
    })
    fs.writeFileSync(crashGapHistoryFile, `${JSON.stringify(crashGapHistory, null, 2)}\n`)
    const crashGapRetry = await postRaw(baseUrl, crashGapPayload, ingressToken)
    ok(crashGapRetry.body.stored === true && crashGapRetry.body.repaired === true,
      'dedup_visible_state_without_work_is_repaired_not_dropped')
    ok(fs.existsSync(crashGapInbox), 'crash_gap_retry_recreates_exactly_one_inbox_item')

    const emojiOnly = await postRaw(baseUrl, JSON.stringify({
      contact_id: '900000003',
      thread_id: '900000003',
      message_id: 'qa-emoji-1',
      instagram_username: 'qa.emoji',
      message_text: '🫠🦐'
    }), ingressToken)
    ok(emojiOnly.status === 200 && emojiOnly.body.stored === true, 'emoji_only_accepted_as_text')
    const emojiInboxFile = fs.readdirSync(inboxDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(inboxDir, name))
      .find((file) => JSON.parse(fs.readFileSync(file, 'utf8')).contact_id === '900000003')
    const emojiInbox = JSON.parse(fs.readFileSync(emojiInboxFile, 'utf8'))
    ok(emojiInbox.text === '🫠🦐', 'emoji_only_preserved_exactly', String(emojiInbox.text || ''))
    ok(emojiInbox.text_source === 'message_text', 'emoji_only_not_rewritten_as_photo', String(emojiInbox.text_source || ''))

    const oversized = await postRaw(baseUrl, JSON.stringify({
      contact_id: '900000004',
      thread_id: '900000004',
      message_id: 'qa-big-1',
      instagram_username: 'qa.big',
      message_text: 'A'.repeat((1024 * 1024) + 1)
    }), ingressToken)
    ok(oversized.status === 413, 'oversized_status', String(oversized.status))
    ok(oversized.body.error === 'payload_too_large', 'oversized_reason', oversized.body.error)
    ok(!fs.existsSync(path.join(tempRoot, 'inbox', 'qa-big-1.json')), 'oversized_not_queued')
    ok(!fs.existsSync(path.join(tempRoot, 'thread-state', '900000004.json')), 'oversized_state_not_written')
    await new Promise((resolve) => setTimeout(resolve, 20))
    ok(
      !stderr.includes('900000003') && !stderr.includes('qa.emoji'),
      'handler_error_never_reuses_prior_request_identity'
    )

    const capturedLogs = `${stdout}\n${stderr}`
    for (const forbidden of [
      '900000001',
      'qa.user',
      '../../qa-msg',
      'Can I ask uou a question?',
      '900000003',
      'qa.emoji',
      'qa-emoji-1'
    ]) {
      ok(!capturedLogs.includes(forbidden), `machine_logs_redact_${forbidden}`)
    }
    const qaUserHash = crypto.createHash('sha256').update('900000001').digest('hex')
    ok(capturedLogs.includes(qaUserHash), 'machine_logs_retain_hashed_identity_for_correlation')
    ok(!capturedLogs.includes('reference_candidates'), 'empty_drop_log_omits_reference_candidates')
    ok(!capturedLogs.includes('"picked_text"'), 'empty_drop_log_omits_text_preview')

    const nextInbox = await getJson(baseUrl, '/next-inbox', adminToken)
    ok(nextInbox.status === 404, 'legacy_queue_read_endpoint_disabled')
    const ackInboxResponse = await fetch(`${baseUrl}/ack-inbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-scv-admin-token': adminToken },
      body: JSON.stringify({ file: '../thread-state/qa-user.json' })
    })
    ok(ackInboxResponse.status === 404, 'legacy_queue_delete_endpoint_disabled')

    const rawAudit = fs.readFileSync(path.join(tempRoot, 'logs', 'inbound-raw.ndjson'), 'utf8')
    ok(!rawAudit.includes('Can I ask uou a question?'), 'raw_audit_redacts_message_text')
    ok(!rawAudit.includes('900000001'), 'raw_audit_redacts_contact_identity')
    ok((fs.statSync(path.join(tempRoot, 'logs', 'inbound-raw.ndjson')).mode & 0o077) === 0, 'audit_log_not_group_or_world_readable')
    for (const stateDir of ['thread-state', 'thread-history']) {
      const created = fs.readdirSync(path.join(tempRoot, stateDir)).filter((name) => name.endsWith('.json'))
      ok(created.length > 0, `${stateDir}_created_for_live_inbound`)
      ok(created.every((name) => (fs.statSync(path.join(tempRoot, stateDir, name)).mode & 0o077) === 0), `${stateDir}_not_group_or_world_readable`)
    }

    const liveAfter = await waitForLive(baseUrl, child)
    ok(liveAfter.ok === true, 'liveness_after_hostile_inputs')

    console.log(JSON.stringify({
      ok: true,
      locked: true,
      lock_version: 'scv-inbound-body-guard-harness-2026-08-25-v10-ambiguous-repeat-liveness',
      checked
    }, null, 2))
  } finally {
    child.kill('SIGTERM')
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve()
      child.once('exit', resolve)
      setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1000).unref()
    })
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  if (stderr.trim()) process.stderr.write(stderr)
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }))
  process.exit(1)
})
