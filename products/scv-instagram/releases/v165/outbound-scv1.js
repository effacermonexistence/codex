#!/usr/bin/env node
const http = require('http')
const fs = require('fs')
const path = require('path')
const {
  DEBUG_USERNAMES_CSV,
  DEBUG_CONTACT_IDS_CSV,
  isDebugIdentity
} = require(path.join(__dirname, 'scv-debug-identity.js'))
const {
  adoptionPaths,
  adoptOutboxPacket
} = require(path.join(__dirname, 'scv-durable-outbox-adoption.js'))
const { getAdaptiveDeliveryPolicy } = require(path.join(__dirname, 'dm-learning-sidecar.js'))
const {
  SCV_DELIVERY_PACING_LOCK_VERSION,
  DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS,
  pacingSettingsFromEnv,
  deliveryDelayForBubble
} = require(path.join(__dirname, 'scv-delivery-pacing.js'))
const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  validateControlReceipt
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  referenceAttachmentGraceMs,
  referenceAttachmentGraceForBubble
} = require(path.join(__dirname, 'scv-reference-attachment-coalescing.js'))
const {
  redactedIdentity
} = require(path.join(__dirname, 'scv-machine-log.js'))
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))
const {
  isVerifiedStaleOperatorRecoveryEnvelope
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))

const PORT = Number(process.env.SCV_OUTBOUND1_PORT || 3101)
const BIND_HOST = process.env.SCV_INTERNAL_BIND_HOST || '127.0.0.1'
const ROOT = process.env.SCV_ROOT || __dirname
const OUTBOX_DIR = path.join(ROOT, 'outbox')
const OUTBOX_IDEMPOTENCY_DIR = path.join(ROOT, 'outbox-idempotency')
const ENV_PATH = path.join(ROOT, '.env')
const REQUIRED_SOURCE = SCV_SINGLE_CONTROL_SOURCE
let injectedFaultReceipt = ''

function ensureDirs() {
  adoptionPaths(ROOT)
}

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

function makeFileName() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}.json`
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function estimateHumanTailDelayMs(text) {
  const raw = String(text || '').trim()
  const chars = raw.length
  const words = raw ? raw.split(/\s+/).length : 0
  const lines = raw ? raw.split(/\n+/).length : 0
  const hasLinkishText = /https?:\/\/|@|\.[a-z]{2,}/i.test(raw)
  const estimated =
    5000 +
    (chars * 85) +
    (words * 260) +
    Math.max(0, lines - 1) * 1800 +
    (hasLinkishText ? 2500 : 0)

  return clamp(Math.round(estimated), 8000, 50000)
}

function splitLongBubbleText(text) {
  const raw = String(text || '').trim()
  if (!raw) return []

  const byDoubleNewline = raw.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  if (byDoubleNewline.length > 1) return byDoubleNewline

  const bySingleNewline = raw.split(/\n+/).map((part) => part.trim()).filter(Boolean)
  if (bySingleNewline.length > 1) return bySingleNewline

  const bySentence = raw.split(/(?<=[!?])\s+(?=[A-Za-z0-9])/).map((part) => part.trim()).filter(Boolean)
  if (bySentence.length > 1) return bySentence

  return [raw]
}

function extractUrls(text) {
  return String(text || '').match(/https?:\/\/[^\s]+/gi) || []
}

function normalizeUrl(url) {
  return String(url || '').trim().replace(/[)\]}>.,!?]+$/g, '')
}

function normalizeBubbleText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function isUrlOnlyBubble(text) {
  const raw = String(text || '').trim()
  if (!raw) return false
  const urls = extractUrls(raw).map(normalizeUrl).filter(Boolean)
  return urls.length === 1 && raw === urls[0]
}

function filterDuplicateUrlBubbles(bubbles, authority, options = {}) {
  const history = Array.isArray(authority?.recent_history) ? authority.recent_history : []
  const recentAssistantUrls = new Set()
  const recentAssistantTexts = new Set()
  const allowDuplicateUrlResend = !!options.allow_duplicate_url_resend
  const forceSendUrls = new Set(
    (Array.isArray(options.force_send_urls) ? options.force_send_urls : [])
      .map(normalizeUrl)
      .filter(Boolean)
  )

  for (const event of history) {
    if (!isConversationVisibleAssistantEvent(event)) continue
    const normalizedText = normalizeBubbleText(event?.text || '')
    if (normalizedText) recentAssistantTexts.add(normalizedText)
    for (const url of extractUrls(event?.text).map(normalizeUrl).filter(Boolean)) {
      recentAssistantUrls.add(url)
    }
  }

  const kept = []
  const seenInPacket = new Set()
  const seenTextInPacket = new Set()

  for (const bubble of Array.isArray(bubbles) ? bubbles : []) {
    if (!bubble || typeof bubble.text !== 'string') continue

    const raw = String(bubble.text || '').trim()
    const normalizedText = normalizeBubbleText(raw)
    const urls = extractUrls(raw).map(normalizeUrl).filter(Boolean)
    const duplicateAgainstHistory = urls.length > 0 && urls.every((url) => recentAssistantUrls.has(url))
    const duplicateInPacket = urls.length > 0 && urls.every((url) => seenInPacket.has(url))
    const duplicateTextAgainstHistory = normalizedText && recentAssistantTexts.has(normalizedText)
    const duplicateTextInPacket = normalizedText && seenTextInPacket.has(normalizedText)
    const forceSendDuplicateUrl =
      allowDuplicateUrlResend &&
      urls.length > 0 &&
      urls.some((url) => forceSendUrls.has(url))

    const duplicateUrl = (duplicateAgainstHistory || duplicateInPacket) && (isUrlOnlyBubble(raw) || urls.length > 0)
    const duplicateText = duplicateTextAgainstHistory || duplicateTextInPacket

    if (!forceSendDuplicateUrl && (duplicateUrl || duplicateText)) {
      continue
    }

    kept.push({
      ...bubble,
      text: raw
    })

    for (const url of urls) {
      seenInPacket.add(url)
    }
    if (normalizedText) {
      seenTextInPacket.add(normalizedText)
    }
  }

  return kept
}

function expandBubblesForReadability(bubbles) {
  const expanded = []

  for (const bubble of Array.isArray(bubbles) ? bubbles : []) {
    if (!bubble || typeof bubble.text !== 'string') continue

    const raw = String(bubble.text || '').trim()
    if (!raw) continue

    const lines = raw.split(/\n+/).filter(Boolean).length
    const shouldSplit = raw.length >= 165 || lines >= 4

    if (!shouldSplit) {
      expanded.push({
        ...bubble,
        text: raw
      })
      continue
    }

    const parts = splitLongBubbleText(raw)
    if (parts.length <= 1) {
      expanded.push({
        ...bubble,
        text: raw
      })
      continue
    }

    for (let i = 0; i < parts.length; i++) {
      expanded.push({
        ...bubble,
        text: parts[i],
        delay_ms: i === 0 ? bubble.delay_ms : 0
      })
    }
  }

  return expanded
}

function normalizeBubbleDelayMs(bubble, index, multiplier, forceZeroDelay = false, fastDelayTarget = false, pacingSettings = pacingSettingsFromEnv()) {
  return deliveryDelayForBubble({
    bubble,
    index,
    multiplier,
    forceZeroDelay,
    fastDelayTarget,
    settings: pacingSettings
  })
}

function splitCsvList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function readDotEnvSettings() {
  const settings = {}
  try {
    if (!fs.existsSync(ENV_PATH)) return settings
    const raw = fs.readFileSync(ENV_PATH, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx === -1) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim()
      settings[key] = value
    }
  } catch {}
  return settings
}

function settingValue(settings, key) {
  const envValue = process.env[key]
  if (typeof envValue === 'string' && envValue.trim() !== '') return envValue
  return settings[key]
}

function loadDelaySettings() {
  const fileSettings = readDotEnvSettings()
  let multiplier = 1
  let fast_target_contact_ids = splitCsvList(settingValue(fileSettings, 'SCV_FAST_TARGET_CONTACT_IDS') || DEBUG_CONTACT_IDS_CSV)
  let fast_target_usernames = splitCsvList(settingValue(fileSettings, 'SCV_FAST_TARGET_USERNAMES') || DEBUG_USERNAMES_CSV).map((item) => item.toLowerCase())
  let fast_target_multiplier = 0
  let fast_target_force_zero = true

  const multiplierRaw = settingValue(fileSettings, 'SCV_DELAY_MULTIPLIER')
  const parsedMultiplier = Number(multiplierRaw)
  if (Number.isFinite(parsedMultiplier) && parsedMultiplier > 0) multiplier = parsedMultiplier

  const fastMultiplierRaw = settingValue(fileSettings, 'SCV_FAST_TARGET_DELAY_MULTIPLIER')
  const parsedFastMultiplier = Number(fastMultiplierRaw)
  if (Number.isFinite(parsedFastMultiplier) && parsedFastMultiplier >= 0) fast_target_multiplier = parsedFastMultiplier

  const fastZeroRaw = settingValue(fileSettings, 'SCV_FAST_TARGET_FORCE_ZERO')
  if (typeof fastZeroRaw === 'string' && fastZeroRaw.trim() !== '') {
    fast_target_force_zero = ['1', 'true', 'yes', 'on'].includes(fastZeroRaw.trim().toLowerCase())
  }

  return {
    multiplier,
    fast_target_contact_ids,
    fast_target_usernames,
    fast_target_multiplier,
    fast_target_force_zero,
    pacing_settings: pacingSettingsFromEnv(process.env)
  }
}

function isFastDelayTarget(delay, contact_id, instagram_username) {
  const contactId = String(contact_id || '').trim()
  const username = String(instagram_username || '').trim().toLowerCase()
  return (
    isDebugIdentity({ contact_id: contactId, instagram_username: username }) &&
    delay.fast_target_contact_ids.includes(contactId) &&
    delay.fast_target_usernames.includes(username)
  )
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      const delay = loadDelaySettings()
      return sendJson(res, 200, {
        ok: true,
        port: PORT,
        role: 'outbound-scv1-queue-writer',
        authority_gate: REQUIRED_SOURCE,
        control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
        delay_multiplier: delay.multiplier,
        delivery_pacing: {
          locked: true,
          lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
          settings: delay.pacing_settings
        }
      })
    }

    if (req.method === 'POST' && req.url === '/') {
      const body = await readJsonBody(req)
      const delay = loadDelaySettings()

      if (!body || !body.contact_id || !Array.isArray(body.bubbles)) {
        return sendJson(res, 400, { ok: false, error: 'missing contact_id or bubbles array' })
      }

      const source = String(body.source || '')
      const authority = body.authority && typeof body.authority === 'object' ? body.authority : null
      const controlReceiptVerdict = validateControlReceipt(body, { root: ROOT, requireLedger: true, requirePayload: true })
      if (
        source !== REQUIRED_SOURCE ||
        !authority ||
        authority.controller !== SCV_SINGLE_CONTROL_PLANE_ID ||
        authority.runner !== 'scv-single-control-plane' ||
        !controlReceiptVerdict.valid
      ) {
        return sendJson(res, 403, {
          ok: false,
          error: 'non_authoritative_queue_write_rejected',
          required_source: REQUIRED_SOURCE,
          required_controller: SCV_SINGLE_CONTROL_PLANE_ID,
          receipt_reason: controlReceiptVerdict.reason
        })
      }

      const contact_id = String(body.contact_id)
      const thread_id = String(body.thread_id || body.contact_id)
      const instagram_username = String(body.instagram_username || '')
      const message_id = String(body.message_id || Date.now())
      const text = String(body.text || '')
      if (body.bubbles.some((bubble) => !bubble || typeof bubble.text !== 'string' || !bubble.text.trim())) {
        return sendJson(res, 400, { ok: false, error: 'controller_bubbles_must_be_nonempty_text' })
      }
      const adaptivePolicy = getAdaptiveDeliveryPolicy({
        instagram_username,
        text,
        bubbles: body.bubbles
      })
      // Transport-only boundary: controller-adopted text/count/order are immutable.
      // Queueing may add pacing metadata, but it may not split, rewrite, dedupe, or
      // remove semantic bubbles after the controller receipt was issued.
      const bubbles = body.bubbles
      const files = []
      const idempotent_skips = []
      const repaired_adoptions = []
      const now = Date.now()
      const fastDelayTarget = isFastDelayTarget(delay, contact_id, instagram_username)
      const baseMultiplier = fastDelayTarget ? delay.fast_target_multiplier : delay.multiplier
      const forceZeroDelay = fastDelayTarget && delay.fast_target_force_zero
      const pacingSettings = delay.pacing_settings || pacingSettingsFromEnv(process.env)
      const orphanOperatorRecovery =
        body.operator_recovery === true &&
        String(body.recovered_via || '') === 'manychat_subscriber_getinfo' &&
        String(body.operator_recovery_lock_version || '').startsWith('scv-manychat-orphan-recovery-lock-')
      const verifiedStaleOperatorRecovery = isVerifiedStaleOperatorRecoveryEnvelope(body, now)
      const operatorRecovery = orphanOperatorRecovery || verifiedStaleOperatorRecovery
      const referenceAttachmentGrace = referenceAttachmentGraceMs(body.authority_transport_flags)

      let cumulative_delay_ms = 0

      for (let i = 0; i < bubbles.length; i++) {
        const bubble = bubbles[i]
        if (!bubble || typeof bubble.text !== 'string') continue
        const forceZeroDelayForBubble = forceZeroDelay || (operatorRecovery && i === 0)

        const { original_delay_ms, delay_ms, pacing_rule } = normalizeBubbleDelayMs(
          bubble,
          i,
          baseMultiplier * Number(adaptivePolicy.delay_multiplier || 1),
          forceZeroDelayForBubble,
          fastDelayTarget,
          pacingSettings
        )
        if (!fastDelayTarget && !operatorRecovery && i === 0 && delay_ms < DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS) {
          throw new Error(`non_fast_initial_delay_under_min:${delay_ms}`)
        }
        cumulative_delay_ms += referenceAttachmentGraceForBubble(body.authority_transport_flags, i)
        cumulative_delay_ms += delay_ms
        const effectivePacingRule =
          operatorRecovery && i === 0
            ? 'operator_recovery_skip_initial_delay'
            : pacing_rule
        const packet = {
          contact_id,
          thread_id,
          instagram_username,
          message_id,
          text,
          bubble_index: i,
          bubble_count: bubbles.length,
          bubble: {
            text: bubble.text,
            delay_ms
          },
          bubbles,
          source,
          authority,
          control_receipt: body.control_receipt,
          allow_duplicate_url_resend: !!body.allow_duplicate_url_resend,
          force_send_urls: Array.isArray(body.force_send_urls) ? body.force_send_urls : [],
          authority_transport_flags: body.authority_transport_flags && typeof body.authority_transport_flags === 'object'
            ? body.authority_transport_flags
            : undefined,
          operator_recovery: operatorRecovery,
          operator_recovery_lock_version: String(body.operator_recovery_lock_version || ''),
          operator_recovery_reason: String(body.operator_recovery_reason || ''),
          operator_recovery_at: String(body.operator_recovery_at || ''),
          recovered_from_message_id: String(body.recovered_from_message_id || ''),
          recovered_via: String(body.recovered_via || ''),
          source_interaction_at: String(body.source_interaction_at || ''),
          recovered_from_ig_last_interaction: String(body.recovered_from_ig_last_interaction || ''),
          manychat_latest_interaction_at: String(body.manychat_latest_interaction_at || ''),
          recovered_from_at: String(body.recovered_from_at || ''),
          received_at: String(body.received_at || ''),
          at: String(body.at || ''),
          created_at: String(body.created_at || ''),
          raw_text: typeof body.raw_text === 'string' ? body.raw_text : '',
          delay_original_ms: original_delay_ms,
          delivery_pacing_lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
          delivery_pacing_rule: effectivePacingRule,
          delay_multiplier: baseMultiplier * Number(adaptivePolicy.delay_multiplier || 1),
          base_delay_multiplier: baseMultiplier,
          fast_delay_target: fastDelayTarget,
          force_zero_delay: forceZeroDelayForBubble,
          reference_attachment_grace_ms: referenceAttachmentGraceForBubble(body.authority_transport_flags, i),
          adaptive_policy: adaptivePolicy,
          attempts: 0,
          queued_at: new Date(now).toISOString(),
          due_at: new Date(now + cumulative_delay_ms).toISOString()
        }

        const receiptSha = String(body.control_receipt?.receipt_sha256 || '')
        const idempotencyKey = `${receiptSha}-${i}`
        const injectFault =
          process.env.SCV_OUTBOUND1_TEST_HARNESS === '1' &&
          String(process.env.SCV_OUTBOUND1_TEST_FAIL_AFTER_QUEUE_RECEIPT || '') === receiptSha &&
          injectedFaultReceipt !== receiptSha
        if (injectFault) injectedFaultReceipt = receiptSha
        const adoption = adoptOutboxPacket({
          root: ROOT,
          packet,
          idempotencyKey,
          testFaultAfterQueue: injectFault
        })
        if (adoption.idempotent) {
          idempotent_skips.push({ bubble_index: i, idempotency_key: idempotencyKey })
          if (adoption.repaired) {
            repaired_adoptions.push({
              bubble_index: i,
              idempotency_key: idempotencyKey,
              reason: adoption.reason
            })
          }
          files.push(adoption.file)
          continue
        }
        if (adoption.repaired) {
          repaired_adoptions.push({
            bubble_index: i,
            idempotency_key: idempotencyKey,
            reason: adoption.reason
          })
        }
        console.log(JSON.stringify({
          type: 'scv_delay_queue_write',
          ...redactedIdentity({ contact_id, thread_id, instagram_username, message_id }),
          bubble_index: i,
          bubble_count: bubbles.length,
          fast_delay_target: fastDelayTarget,
          force_zero_delay: forceZeroDelay,
          reference_attachment_grace_ms: referenceAttachmentGrace,
          delay_ms,
          cumulative_delay_ms,
          queued_at: packet.queued_at,
          due_at: packet.due_at,
          delivery_pacing_lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
          delivery_pacing_rule: effectivePacingRule,
          operator_recovery: operatorRecovery
        }))
        files.push(adoption.file)
      }

      return sendJson(res, 200, {
        ok: true,
        queued: true,
        contact_id,
        thread_id,
        message_id,
        delay_multiplier: baseMultiplier * Number(adaptivePolicy.delay_multiplier || 1),
        fast_delay_target: fastDelayTarget,
        force_zero_delay: forceZeroDelay,
        adaptive_policy: adaptivePolicy,
        delivery_pacing: {
          locked: true,
          lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
          settings: pacingSettings
        },
        bubble_count: bubbles.length,
        idempotent_skips,
        repaired_adoptions,
        files
      })
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' })
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: err.message })
  }
})

if (require.main === module) {
  ensureDirs()
  server.listen(PORT, BIND_HOST)
}

module.exports = {
  estimateHumanTailDelayMs,
  splitLongBubbleText,
  normalizeBubbleDelayMs,
  loadDelaySettings,
  isFastDelayTarget,
  ensureDirs,
  server
}
