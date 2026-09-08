#!/usr/bin/env node
const fs = require('fs')
const crypto = require('crypto')
const http = require('http')
const path = require('path')
const {
  VISIBILITY_STATES,
  VISIBILITY_CONFIRMATION_SOURCES,
  visibilityFieldsForState
} = require(path.join(__dirname, 'scv-delivery-visibility.js'))
const {
  SCV_SINGLE_RELEASE_PROTOCOL,
  isSingleReleaseRequested,
  verifySingleRelease,
  singleReleaseRuntimeIdentityVerdict
} = require(path.join(__dirname, 'scv-single-release.js'))
const {
  confirmOutgoingTextVisible,
  getInstagramRuntimeStatus
} = require(path.join(__dirname, 'instagram-thread-runtime.js'))
const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  validateControlReceipt
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  redactedIdentity,
  safeEnum
} = require(path.join(__dirname, 'scv-machine-log.js'))

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) {
    return
  }

  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue
    }

    const idx = trimmed.indexOf('=')
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key && !process.env[key]) {
      process.env[key] = value
    }
  }
}

loadLocalEnv()

const PORT = Number(process.env.SCV_OUTBOUND2_PORT || 3102)
const BIND_HOST = process.env.SCV_INTERNAL_BIND_HOST || '127.0.0.1'
const OFFICIAL_MANYCHAT_SEND_URL = 'https://api.manychat.com/fb/sending/sendContent'
const MAX_MANYCHAT_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024

function resolveManyChatSendUrl(env = process.env) {
  const cloudRuntime =
    String(env.SCV_CLOUD_RUNTIME || '').trim() === '1' ||
    Boolean(String(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || '').trim())
  if (cloudRuntime) return OFFICIAL_MANYCHAT_SEND_URL
  return String(env.MANYCHAT_SEND_URL || OFFICIAL_MANYCHAT_SEND_URL).trim() || OFFICIAL_MANYCHAT_SEND_URL
}

const MANYCHAT_SEND_URL = resolveManyChatSendUrl()
const MANYCHAT_API_KEY = process.env.MANYCHAT_API_KEY || ''
const REQUIRED_SOURCE = SCV_SINGLE_CONTROL_SOURCE
const MANYCHAT_OTN_TOPIC_NAME = String(process.env.SCV_MANYCHAT_OTN_TOPIC_NAME || '').trim()
const HUMAN_AGENT_TAG_RETRY = String(process.env.SCV_HUMAN_AGENT_TAG_RETRY || '1').trim() !== '0'
const parsedManyChatTimeoutMs = Number(process.env.SCV_MANYCHAT_SEND_TIMEOUT_MS || 15000)
const MANYCHAT_SEND_TIMEOUT_MS = Number.isFinite(parsedManyChatTimeoutMs)
  ? Math.min(60000, Math.max(1000, parsedManyChatTimeoutMs))
  : 15000

function sendJson(res, status, body) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(raw)
  })
  res.end(raw)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}) } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

function canonicalManyChatSubscriberId(value) {
  const normalized = String(value ?? '').trim()
  if (
    !/^[1-9][0-9]{0,31}$/.test(normalized) ||
    BigInt(normalized) > BigInt(Number.MAX_SAFE_INTEGER)
  ) throw new Error('manychat_subscriber_id_not_safe_integer')
  return normalized
}

function buildSendBody(contact_id, bubble, messageTagOverride = '') {
  const subscriberId = canonicalManyChatSubscriberId(contact_id)
  const body = {
    subscriber_id: Number(subscriberId),
    data: {
      version: 'v2',
      content: {
        type: 'instagram',
        messages: [
          {
            type: 'text',
            text: bubble.text
          }
        ]
      }
    }
  }
  // A privileged message tag may only come from the explicit coded 3031/3011
  // retry below. Mutable environment cannot tag an ordinary first attempt.
  const tag = String(messageTagOverride || '').trim()
  if (tag) {
    body.message_tag = tag
  }
  if (MANYCHAT_OTN_TOPIC_NAME) {
    body.otn_topic_name = MANYCHAT_OTN_TOPIC_NAME
  }
  return body
}

function extractManyChatProviderReceipt(body) {
  const candidates = [
    ['data', 'message_id'],
    ['data', 'messageId'],
    ['data', 'id'],
    ['data', 0, 'message_id'],
    ['data', 0, 'messageId'],
    ['data', 0, 'id'],
    ['data', 'result', 'message_id'],
    ['data', 'result', 'messageId'],
    ['result', 'message_id'],
    ['result', 'messageId'],
    ['message_id'],
    ['messageId'],
    ['id']
  ]
  for (const segments of candidates) {
    let value = body
    for (const segment of segments) value = value?.[segment]
    if (!['string', 'number', 'bigint'].includes(typeof value)) continue
    const normalized = String(value).trim()
    if (
      normalized && normalized.length <= 512 &&
      !/[\u0000-\u001f\u007f]/u.test(normalized)
    ) {
      return {
        present: true,
        id: normalized,
        path: segments.join('.')
      }
    }
  }
  return { present: false, id: '', path: '' }
}

const {
  pauseAll: scvPauseAll,
  isPausedForPacket
} = require(path.join(__dirname, 'scv-pause-gate.js'))

function finalReleaseIdentityVerdict(env = process.env) {
  if (!isSingleReleaseRequested(env)) {
    return { ok: true, required: false, reason: 'legacy_release_identity_path' }
  }
  try {
    const receipt = verifySingleRelease({
      root: String(env.SCV_ROOT || __dirname),
      env,
      // The entrypoint and cloud-start already performed the durable /data
      // probe. The per-message last-line gate rechecks sealed files and the
      // exact inherited proof without writing a fresh probe for every bubble.
      verifyPersistence: false
    })
    return singleReleaseRuntimeIdentityVerdict({ receipt, env })
  } catch (error) {
    return {
      ok: false,
      required: true,
      protocol: SCV_SINGLE_RELEASE_PROTOCOL,
      reason: 'single_release_runtime_identity_rejected',
      failures: [String(error?.message || error).slice(0, 300)]
    }
  }
}

function finalSenderPauseVerdict(packet, env = process.env) {
  const releaseIdentity = finalReleaseIdentityVerdict(env)
  if (!releaseIdentity.ok) {
    return {
      held: true,
      reason: 'scv_final_sender_release_identity_gate',
      release_identity_reason: String(releaseIdentity.reason || '')
    }
  }
  return {
    held: isPausedForPacket(packet, env),
    reason: 'scv_final_sender_pause_gate',
    release_identity_reason: String(releaseIdentity.reason || '')
  }
}

async function sendBubble(contact_id, bubble, messageTagOverride = '') {
  const releaseIdentity = finalReleaseIdentityVerdict(process.env)
  if (!releaseIdentity.ok) {
    console.error(JSON.stringify({
      type: 'scv_release_identity_send_blocked',
      reason: safeEnum(releaseIdentity.reason),
      ...redactedIdentity({ contact_id })
    }))
    return {
      ok: false,
      release_identity: true,
      status: 0,
      body: { held: 'scv_release_identity' }
    }
  }
  // TOTAL HARD-STOP last line (Ben 2026-07-08): when SCV_PAUSE_ALL=1, no ManyChat
  // POST happens for ANY account — the actual send is refused here regardless of
  // which path reached it. Reported as not-sent so the packet is held, not dropped.
  if (scvPauseAll()) {
    console.error(JSON.stringify({
      type: 'scv_pause_all_send_blocked',
      ...redactedIdentity({ contact_id })
    }))
    return { ok: false, paused_all: true, status: 0, body: { held: 'scv_pause_all' } }
  }

  const body = buildSendBody(contact_id, bubble, messageTagOverride)

  const resp = await fetch(MANYCHAT_SEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MANYCHAT_API_KEY}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MANYCHAT_SEND_TIMEOUT_MS)
  })

  const responseBytes = Buffer.from(await resp.arrayBuffer())
  if (
    responseBytes.length < 1 ||
    responseBytes.length > MAX_MANYCHAT_PROVIDER_RESPONSE_BYTES
  ) throw new Error('manychat_provider_response_size_invalid')
  const text = responseBytes.toString('utf8')
  let parsed
  try {
    parsed = text ? JSON.parse(text) : {}
  } catch {
    parsed = { raw: text }
  }

  const providerReceipt = extractManyChatProviderReceipt(parsed)
  return {
    status: resp.status,
    body: parsed,
    sent_text: bubble.text,
    provider_response_body_base64: responseBytes.toString('base64'),
    provider_response_sha256: crypto.createHash('sha256').update(responseBytes).digest('hex'),
    provider_response_size_bytes: responseBytes.length,
    provider_receipt_id_present: providerReceipt.present,
    provider_receipt_id: providerReceipt.id,
    provider_receipt_id_path: providerReceipt.path
  }
}

function isManyChatSuccess(result) {
  return (
    result &&
    Number(result.status) === 200 &&
    result.body &&
    String(result.body.status || '').toLowerCase() === 'success'
  )
}

function isManyChatWindowBlocked(result) {
  const code = Number(result?.body?.code || 0)
  // HUMAN_AGENT is a privileged delivery reason. Never infer eligibility from
  // provider prose: retry only the two explicit ManyChat window error codes.
  return Number(result?.status) === 400 && (code === 3031 || code === 3011)
}

async function sendWithVisibilityGuarantee(contact_id, instagram_username, bubble, dependencies = {}) {
  const send = dependencies.sendBubble || sendBubble
  const runtimeStatus = dependencies.getInstagramRuntimeStatus || getInstagramRuntimeStatus
  const confirmVisible = dependencies.confirmOutgoingTextVisible || confirmOutgoingTextVisible
  const packetPauseCheck = dependencies.isPausedForPacket || isPausedForPacket
  const pauseEnv = dependencies.env || process.env
  const pausePacket = {
    contact_id: String(contact_id || ''),
    thread_id: String(contact_id || ''),
    instagram_username: String(instagram_username || '')
  }
  const sendOnce = async (messageTag = '') => {
    if (packetPauseCheck(pausePacket, pauseEnv)) {
      return {
        ok: false,
        paused: true,
        status: 0,
        body: { held: 'scv_packet_pause_gate' },
        sent_text: String(bubble?.text || '')
      }
    }
    return send(contact_id, bubble, messageTag)
  }
  const isPausedResult = (result) => result?.paused === true ||
    result?.paused_all === true ||
    Boolean(result?.body?.held)
  const heldResult = (result, pauseStage) => ({
    ok: false,
    status: 423,
    body: {
      status: 'held',
      held: true,
      retryable: false,
      reason: String(result?.body?.held || 'scv_packet_pause_gate'),
      pause_stage: pauseStage
    },
    sent_text: String(bubble?.text || '')
  })
  const transport = {
    manychat: null,
    verification: null
  }

  try {
    transport.manychat = await sendOnce()
  } catch (err) {
    transport.manychat = {
      status: 599,
      body: {
        status: 'error',
        message: String(err?.message || err || 'manychat_send_failed'),
        delivery_outcome_ambiguous: true
      },
      delivery_outcome_ambiguous: true,
      sent_text: String(bubble?.text || '')
    }
  }

  if (isPausedResult(transport.manychat)) {
    return heldResult(transport.manychat, 'initial_provider_attempt')
  }

  // 24h-window recovery: if ManyChat refused with 3031/3011 (last interaction >24h),
  // retry ONCE with the Meta HUMAN_AGENT message tag (allows replies up to 7 days).
  // Fail-open: if the tag is not approved for this account or the retry fails for any
  // reason, we keep the original blocked result and fall through to the existing
  // human-agent-required quarantine path. Kill switch: SCV_HUMAN_AGENT_TAG_RETRY=0.
  if (HUMAN_AGENT_TAG_RETRY && isManyChatWindowBlocked(transport.manychat)) {
    try {
      const retry = await sendOnce('HUMAN_AGENT')
      if (isPausedResult(retry)) {
        return heldResult(retry, 'human_agent_retry')
      }
      transport.human_agent_tag_retry = {
        attempted: true,
        status: retry?.status,
        body: retry?.body
      }
      console.log(JSON.stringify({
        type: 'manychat_human_agent_tag_retry',
        ...redactedIdentity({ contact_id }),
        ok: isManyChatSuccess(retry),
        manychat_status: retry?.status,
        manychat_body_status: safeEnum(retry?.body?.status),
        manychat_body_code: safeEnum(retry?.body?.code)
      }))
      if (isManyChatSuccess(retry)) {
        transport.manychat = retry
        transport.manychat.human_agent_tag_used = true
      } else {
        const retryStatus = Number(retry?.status || 0)
        if (
          retry?.delivery_outcome_ambiguous === true ||
          retry?.body?.delivery_outcome_ambiguous === true ||
          retryStatus === 408 ||
          retryStatus >= 500 ||
          (retryStatus >= 200 && retryStatus < 300)
        ) {
          transport.human_agent_tag_retry.delivery_outcome_ambiguous = true
        }
      }
    } catch (err) {
      transport.human_agent_tag_retry = {
        attempted: true,
        error: String(err?.message || err || 'human_agent_tag_retry_failed'),
        delivery_outcome_ambiguous: true
      }
    }
  }

  const canVerify = !!String(instagram_username || '').trim() && !!String(bubble?.text || '').trim()
  let runtime
  try {
    runtime = runtimeStatus() || { client_exists: false }
  } catch (error) {
    // ManyChat acceptance is already terminal. A local visibility-runtime probe
    // must never turn that accepted attempt into a 500 that the durable outbox
    // could resend.
    runtime = {
      client_exists: false,
      status_probe_failed: true,
      error: String(error?.message || error || 'instagram_runtime_status_probe_failed')
    }
  }

  // Provider acceptance is a terminal transport outcome. Visibility probing is
  // audit-only: retrying the same text through a second transport can duplicate
  // a DM that ManyChat already accepted (the April no-resend contract).
  if (isManyChatSuccess(transport.manychat)) {
    if (canVerify && runtime.client_exists) {
      try {
        transport.verification = await confirmVisible({
          instagram_username,
          text: bubble.text
        })
      } catch (err) {
        transport.verification = {
          confirmed: false,
          reason: 'instagram_visibility_probe_failed',
          error: String(err?.message || err || '')
        }
      }
    } else {
      transport.verification = {
        confirmed: false,
        reason: runtime.status_probe_failed
          ? 'instagram_runtime_status_probe_failed_manychat_accepted'
          : canVerify
            ? 'instagram_runtime_missing_manychat_accepted'
          : 'missing_username_or_text',
        runtime
      }
    }

    const confirmed = transport.verification?.confirmed === true
    // Provider acceptance is definitive (not ambiguous) but Instagram
    // visibility is a separate fact. Without a thread probe it stays UNKNOWN;
    // a later inbound from the client never upgrades it (2026-09-02 owner
    // directive: the client may be re-sending because the reply never showed).
    const visibilityState = confirmed
      ? VISIBILITY_STATES.CONFIRMED_VISIBLE
      : VISIBILITY_STATES.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN
    return {
      ok: true,
      status: 200,
      body: {
        status: 'success',
        delivery_accepted: true,
        delivery_confirmed: confirmed,
        delivery_outcome_ambiguous: false,
        delivery_outcome_ambiguity_scope: 'provider_acceptance',
        ...visibilityFieldsForState(visibilityState, {
          confirmationSource: VISIBILITY_CONFIRMATION_SOURCES.INSTAGRAM_THREAD_PROBE
        }),
        visibility_probe_reason: String(transport.verification?.reason || ''),
        delivery_method: confirmed ? 'manychat_visible' : 'manychat_api_accepted_unverified',
        manychat_status: transport.manychat.status,
        manychat_body: transport.manychat.body,
        provider_response_body_base64:
          String(transport.manychat.provider_response_body_base64 || ''),
        provider_response_sha256:
          String(transport.manychat.provider_response_sha256 || ''),
        provider_response_size_bytes:
          Number(transport.manychat.provider_response_size_bytes || 0),
        provider_receipt_id_present:
          transport.manychat.provider_receipt_id_present === true,
        provider_receipt_id:
          String(transport.manychat.provider_receipt_id || ''),
        provider_receipt_id_path:
          String(transport.manychat.provider_receipt_id_path || ''),
        verification: transport.verification
      },
      sent_text: bubble.text
    }
  }

  const requiresHumanAgent = isManyChatWindowBlocked(transport.manychat)
  const manychatStatus = Number(transport.manychat?.status || 0)
  const deliveryOutcomeAmbiguous = transport.manychat?.delivery_outcome_ambiguous === true ||
    transport.manychat?.body?.delivery_outcome_ambiguous === true ||
    transport.human_agent_tag_retry?.delivery_outcome_ambiguous === true ||
    (manychatStatus >= 200 && manychatStatus < 300) ||
    manychatStatus === 408 ||
    manychatStatus >= 500
  const failureVisibilityState = deliveryOutcomeAmbiguous
    ? VISIBILITY_STATES.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN
    : VISIBILITY_STATES.CONFIRMED_FAILURE
  return {
    ok: false,
    status: 502,
    body: {
      status: 'error',
      delivery_accepted: false,
      delivery_confirmed: false,
      delivery_method: 'unverified',
      ...visibilityFieldsForState(failureVisibilityState),
      requires_human_agent: requiresHumanAgent,
      requires_manual_reconciliation: deliveryOutcomeAmbiguous,
      delivery_outcome_ambiguous: deliveryOutcomeAmbiguous,
      delivery_outcome_ambiguity_scope: 'provider_acceptance',
      do_not_retry: deliveryOutcomeAmbiguous,
      manychat_status: transport.manychat?.status || 0,
      manychat_body: transport.manychat?.body || {},
      verification: transport.verification,
      human_agent_tag_retry: transport.human_agent_tag_retry || null
    },
    sent_text: String(bubble?.text || '')
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const releaseIdentity = finalReleaseIdentityVerdict(process.env)
      const healthy = releaseIdentity.ok === true
      return sendJson(res, healthy ? 200 : 503, {
        ok: healthy,
        port: PORT,
        role: 'outbound-scv2-final-sender',
        release_protocol: isSingleReleaseRequested(process.env)
          ? SCV_SINGLE_RELEASE_PROTOCOL
          : 'legacy_golden',
        release_identity_ok: releaseIdentity.ok === true,
        release_id: String(process.env.SCV_RELEASE_ID || ''),
        content_fingerprint_sha256:
          String(process.env.SCV_CONTENT_FINGERPRINT || ''),
        release_manifest_sha256:
          String(process.env.SCV_RELEASE_MANIFEST_SHA256 || ''),
        railway_deployment_id:
          String(process.env.RAILWAY_DEPLOYMENT_ID || ''),
        authority_gate: REQUIRED_SOURCE,
        control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
        manychat_send_host: new URL(MANYCHAT_SEND_URL).host,
        manychat_send_official_lock: MANYCHAT_SEND_URL === OFFICIAL_MANYCHAT_SEND_URL
      })
    }

    if (req.method === 'POST' && req.url === '/') {
      const body = await readJsonBody(req)

      if (
        !body ||
        !body.contact_id ||
        !body.bubble ||
        typeof body.bubble.text !== 'string' ||
        !Array.isArray(body.bubbles) ||
        !Number.isInteger(Number(body.bubble_index))
      ) {
        return sendJson(res, 400, { ok: false, error: 'missing contact_id, full bubbles payload, bubble index, or single bubble' })
      }

      const source = String(body.source || '')
      const authority = body.authority && typeof body.authority === 'object' ? body.authority : null
      const controlReceiptVerdict = validateControlReceipt(body, { root: process.env.SCV_ROOT || __dirname, requireLedger: true, requirePayload: true })
      if (
        source !== REQUIRED_SOURCE ||
        !authority ||
        authority.controller !== SCV_SINGLE_CONTROL_PLANE_ID ||
        authority.runner !== 'scv-single-control-plane' ||
        !controlReceiptVerdict.valid
      ) {
        return sendJson(res, 403, {
          ok: false,
          error: 'non_authoritative_final_send_rejected',
          required_source: REQUIRED_SOURCE,
          required_controller: SCV_SINGLE_CONTROL_PLANE_ID,
          receipt_reason: controlReceiptVerdict.reason
        })
      }

      const pauseVerdict = finalSenderPauseVerdict(body, process.env)
      if (pauseVerdict.held) {
        console.log(JSON.stringify({
          type: 'final_sender_held',
          reason: safeEnum(pauseVerdict.reason, 'scv_final_sender_pause_gate'),
          release_identity_reason: safeEnum(pauseVerdict.release_identity_reason, ''),
          ...redactedIdentity(body)
        }))
        return sendJson(res, 423, {
          ok: false,
          held: true,
          retryable: false,
          reason: pauseVerdict.reason
        })
      }

      const result = await sendWithVisibilityGuarantee(
        String(body.contact_id),
        String(body.instagram_username || ''),
        body.bubble
      )

      if (!result.ok && Number(result.status) === 423 && result.body?.held === true) {
        return sendJson(res, 423, {
          ok: false,
          held: true,
          retryable: false,
          reason: String(result.body.reason || 'scv_final_sender_pause_gate'),
          pause_stage: String(result.body.pause_stage || 'provider_attempt')
        })
      }

      return sendJson(res, result.ok ? 200 : 502, {
        ok: result.ok,
        contact_id: String(body.contact_id),
        thread_id: String(body.thread_id || body.contact_id),
        message_id: String(body.message_id || Date.now()),
        bubble: body.bubble,
        source,
        authority,
        control_receipt: body.control_receipt,
        instagram_username: String(body.instagram_username || ''),
        result
      })
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message })
  }
})

if (require.main === module) {
  server.listen(PORT, BIND_HOST)
}

module.exports = {
  OFFICIAL_MANYCHAT_SEND_URL,
  MAX_MANYCHAT_PROVIDER_RESPONSE_BYTES,
  MANYCHAT_SEND_TIMEOUT_MS,
  resolveManyChatSendUrl,
  canonicalManyChatSubscriberId,
  buildSendBody,
  extractManyChatProviderReceipt,
  sendBubble,
  isManyChatWindowBlocked,
  isManyChatSuccess,
  finalReleaseIdentityVerdict,
  finalSenderPauseVerdict,
  sendWithVisibilityGuarantee
}
