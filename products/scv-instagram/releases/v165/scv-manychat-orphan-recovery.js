#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { recordIngressEvent } = require(path.join(__dirname, 'scv-single-control-plane.js'))
const { orphanPacketPredatesDebugReset } = require(path.join(__dirname, 'scv-test-account-purge.js'))
const { isPausedForPacket } = require(path.join(__dirname, 'scv-pause-gate.js'))
const {
  recoveryCutoverVerdict
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))
const {
  isTrustedMediaUrl
} = require(path.join(__dirname, 'scv-media-url-policy.js'))
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))

const SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION = 'scv-manychat-orphan-recovery-lock-2026-08-20-v6-trusted-media-url-boundary'
const SCV_RECOVERY_ADMISSION_VERSION = 'scv-recovery-admission-2026-08-19-v1-cutover-before-state'
const OFFICIAL_MANYCHAT_API_BASE = 'https://api.manychat.com'
const MANYCHAT_GET_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const parsedManyChatGetTimeoutMs = Number(process.env.SCV_MANYCHAT_GET_TIMEOUT_MS || 10_000)
const MANYCHAT_GET_TIMEOUT_MS = Number.isFinite(parsedManyChatGetTimeoutMs)
  ? Math.min(30_000, Math.max(1_000, parsedManyChatGetTimeoutMs))
  : 10_000

function cloudRuntime(env = process.env) {
  const railwayName = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const releaseMode = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  return String(env.SCV_CLOUD_RUNTIME || '').trim() === '1' ||
    Boolean(String(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_PROJECT_ID || '').trim()) ||
    railwayName === 'production' || railwayName === 'staging' ||
    releaseMode === 'production' || releaseMode === 'staging'
}

function resolveManyChatApiBase(env = process.env) {
  if (cloudRuntime(env)) return OFFICIAL_MANYCHAT_API_BASE
  const candidate = String(env.MANYCHAT_API_BASE || OFFICIAL_MANYCHAT_API_BASE).trim() || OFFICIAL_MANYCHAT_API_BASE
  return new URL(candidate).origin
}

const MANYCHAT_API_BASE = resolveManyChatApiBase()

function loadLocalEnv(root = __dirname) {
  const envPath = path.join(root, '.env')
  if (!fs.existsSync(envPath)) return

  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const idx = trimmed.indexOf('=')
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key && !process.env[key]) process.env[key] = value
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function safeThreadKey(threadId) {
  return String(threadId || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function ensurePipelineDirs(root) {
  for (const dir of ['inbox', 'thread-state', 'thread-history', 'logs']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
}

function threadStatePath(root, threadId) {
  return path.join(root, 'thread-state', `${safeThreadKey(threadId)}.json`)
}

function threadHistoryPath(root, threadId) {
  return path.join(root, 'thread-history', `${safeThreadKey(threadId)}.json`)
}

function inboxPath(root, messageId) {
  return path.join(root, 'inbox', `${safeThreadKey(messageId)}.json`)
}

function outboxPath(root, messageId) {
  return path.join(root, 'outbox', `${safeThreadKey(messageId)}.json`)
}

function deliveryReceiptPath(root) {
  return path.join(root, 'logs', 'delivery-receipts.ndjson')
}

function inboundProcessingReceiptPath(root) {
  return path.join(root, 'logs', 'inbound-processing-receipts.ndjson')
}

function safeReadJson(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function appendNdjson(file, obj) {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true })
  const bytes = Buffer.from(`${JSON.stringify(obj)}\n`, 'utf8')
  let descriptor
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT |
        (fs.constants.O_NOFOLLOW || 0),
      0o600
    )
    fs.fchmodSync(descriptor, 0o600)
    let offset = 0
    while (offset < bytes.length) {
      const written = fs.writeSync(
        descriptor,
        bytes,
        offset,
        bytes.length - offset,
        null
      )
      if (!Number.isInteger(written) || written <= 0) {
        throw new Error('orphan_recovery_ndjson_short_write')
      }
      offset += written
    }
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  let directoryDescriptor
  try {
    directoryDescriptor = fs.openSync(
      fs.realpathSync(directory),
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) |
        (fs.constants.O_NOFOLLOW || 0)
    )
    fs.fsyncSync(directoryDescriptor)
  } finally {
    if (directoryDescriptor !== undefined) fs.closeSync(directoryDescriptor)
  }
}

function productionLike(env = process.env) {
  return String(env?.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production' ||
    String(env?.SCV_RELEASE_MODE || '').trim().toLowerCase() === 'production'
}

// Recovery is a synthetic producer, not a fresh webhook. It must prove that the
// source interaction belongs to the current recovery epoch before it is allowed
// to touch thread state. Missing production cutover configuration, an unknown
// interaction timestamp, a pause latch, or an admission exception all fail into
// a durable human-review hold instead of the executable inbox.
function recoveryAdmissionVerdict(packet, opts = {}) {
  const env = opts.env || process.env
  let cutover
  try {
    cutover = recoveryCutoverVerdict(packet, env, opts.filePath, opts.now)
  } catch (err) {
    return {
      hold: true,
      reason: 'recovery_admission_fail_closed',
      detail: String(err?.message || err),
      timestamp_ms: 0,
      source: 'unknown',
      cutover_ms: 0
    }
  }

  if (cutover.hold) return cutover
  if (!Number(cutover.timestamp_ms || 0)) {
    return { ...cutover, hold: true, reason: 'recovery_ingress_time_unknown' }
  }
  if (productionLike(env) && !Number(cutover.cutover_ms || 0)) {
    return { ...cutover, hold: true, reason: 'recovery_cutover_missing_production' }
  }

  try {
    if (isPausedForPacket(packet, env)) {
      return { ...cutover, hold: true, reason: 'recovery_paused_for_packet' }
    }
  } catch (err) {
    return {
      ...cutover,
      hold: true,
      reason: 'recovery_pause_gate_fail_closed',
      detail: String(err?.message || err)
    }
  }

  return { ...cutover, hold: false, reason: 'recovery_admitted' }
}

function recoveryHumanHoldPath(root, packet) {
  const identity = String(packet?.message_id || '') ||
    sha256(`${packet?.contact_id || packet?.thread_id || ''}\n${packet?.text || ''}`).slice(0, 24)
  return path.join(
    root,
    'outbox_human_agent_required',
    `recovery-admission-hold-${safeThreadKey(identity)}.json`
  )
}

function writeRecoveryHumanHold(root, packet, verdict, opts = {}) {
  const file = recoveryHumanHoldPath(root, packet)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const timestampMs = Number(verdict?.timestamp_ms || 0)
  const cutoverMs = Number(verdict?.cutover_ms || 0)
  fs.writeFileSync(file, JSON.stringify({
    type: 'recovery_admission_human_hold',
    manual_reason: String(verdict?.reason || 'recovery_admission_fail_closed'),
    queued_for_human_agent_at: new Date(opts.now || Date.now()).toISOString(),
    recovery_admission_version: SCV_RECOVERY_ADMISSION_VERSION,
    contact_id: String(packet?.contact_id || ''),
    thread_id: String(packet?.thread_id || packet?.contact_id || ''),
    instagram_username: String(packet?.instagram_username || ''),
    message_id: String(packet?.message_id || ''),
    text: String(packet?.text || ''),
    text_source: String(packet?.text_source || ''),
    media_urls: Array.isArray(packet?.media_urls) ? packet.media_urls : [],
    source_interaction_at: String(packet?.source_interaction_at || ''),
    manychat_latest_interaction_at: String(packet?.manychat_latest_interaction_at || ''),
    recovered_from_ig_last_interaction: String(packet?.recovered_from_ig_last_interaction || ''),
    recovered_from_at: String(packet?.recovered_from_at || ''),
    immutable_ingress_at: timestampMs ? new Date(timestampMs).toISOString() : '',
    immutable_ingress_source: String(verdict?.source || 'unknown'),
    recovery_cutover_at: cutoverMs ? new Date(cutoverMs).toISOString() : '',
    raw_body_sha256: String(packet?.raw_body_sha256 || '')
  }, null, 2) + '\n')
  return file
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTimeMs(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function extractTags(info) {
  if (!Array.isArray(info?.tags)) return []
  return info.tags
    .map((tag) => {
      if (!tag) return ''
      if (typeof tag === 'string') return tag
      return tag.name || tag.label || tag.tag_name || ''
    })
    .map((tag) => String(tag || '').trim().toLowerCase())
    .filter(Boolean)
}

function looksLikeHumanText(value) {
  const text = String(value || '').trim()
  if (!text) return false
  if (/^https?:\/\//i.test(text)) return false
  if (/^\{\{[^}]+\}\}$/.test(text)) return false
  if (/^[\d\s+().-]+$/.test(text)) {
    // A phone-shaped digits-only input IS a real human turn (the funnel literally asks
    // for the phone number). Rejecting it lost christian.bolanos.35977's "4157602883".
    const digits = text.replace(/\D/g, '')
    return digits.length >= 7 && digits.length <= 15
  }
  return /[a-zA-Z가-힣]/.test(text)
}

function looksLikeRecoverableMediaUrl(value) {
  return isTrustedMediaUrl(value)
}

function buildRecoveryPacket(info, opts = {}) {
  const id = String(info?.id || info?.subscriber_id || '').trim()
  const rawInputText = String(info?.last_input_text || info?.message_text || info?.text || '').trim()
  const mediaUrl = looksLikeRecoverableMediaUrl(rawInputText) ? rawInputText : ''
  // Never make the model converse with an opaque signed CDN URL. Preserve the URL
  // only in media_urls so dm-authority / the runner can resolve the actual image or
  // voice note, while the semantic turn remains a normal media-share event.
  const text = mediaUrl ? 'sent a reference post' : rawInputText
  const latestAt = String(info?.ig_last_interaction || info?.ig_last_seen || info?.last_seen || '').trim()
  const now = String(opts.now || new Date().toISOString())

  if (!/^\d+$/.test(id)) {
    throw new Error('manychat_orphan_recovery_missing_numeric_subscriber_id')
  }
  if (!looksLikeHumanText(rawInputText) && !mediaUrl) {
    throw new Error('manychat_orphan_recovery_missing_human_last_input_text')
  }

  const messageHash = sha256(`${id}\n${latestAt}\n${rawInputText}`).slice(0, 16)
  const messageId = `manychat-orphan-${id}-${messageHash}`
  const raw = JSON.stringify({
    id,
    ig_username: info?.ig_username || '',
    last_input_text: rawInputText,
    ig_last_interaction: latestAt
  })

  return {
    contact_id: id,
    thread_id: id,
    message_id: messageId,
    instagram_username: String(info?.ig_username || '').trim(),
    text,
    text_source: mediaUrl
      ? 'manychat.subscriber.last_input_text.orphan_recovery.media'
      : 'manychat.subscriber.last_input_text.orphan_recovery',
    media_urls: mediaUrl ? [mediaUrl] : [],
    media_identity_sha256: mediaUrl ? sha256(mediaUrl) : '',
    manychat_tags: extractTags(info),
    recovered_via: 'manychat_subscriber_getinfo',
    source_interaction_at: latestAt,
    manychat_latest_interaction_at: latestAt,
    recovered_from_ig_last_interaction: latestAt,
    recovered_from_last_seen: String(info?.ig_last_seen || info?.last_seen || '').trim(),
    recovered_from_message_id: '',
    recovered_from_at: latestAt,
    operator_recovery: true,
    operator_recovery_lock_version: SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION,
    raw_body_sha256: sha256(raw),
    received_at: now
  }
}

function historyHasProcessedText(history, packet) {
  const events = Array.isArray(history?.events) ? history.events : []
  const target = normalizeText(packet?.text)
  const latestAtMs = parseTimeMs(packet?.recovered_from_ig_last_interaction || packet?.recovered_from_at)

  if (!target) return false

  return events.some((event) => {
    if (!event || String(event.role || '') !== 'user') return false
    if (normalizeText(event.text) !== target) return false
    const eventAtMs = parseTimeMs(event.at || event.received_at)
    return !latestAtMs || !eventAtMs || eventAtMs >= latestAtMs
  })
}

function historyHasAssistantAfterUser(history, packet) {
  // Multiple media shares have the same semantic fallback text. Treating an old
  // "sent a reference post" + assistant pair as proof for every future image would
  // silently lose later shares. Media dedup is exact via message id / processing
  // receipt (timestamp + normalized text), never loose history text matching.
  if (Array.isArray(packet?.media_urls) && packet.media_urls.length) return false
  const events = Array.isArray(history?.events) ? history.events : []
  const target = normalizeText(packet?.text)
  if (!target) return false

  let seenUser = false
  for (const event of events) {
    const role = String(event?.role || '').toLowerCase()
    if (role === 'user' && normalizeText(event?.text) === target) {
      seenUser = true
      continue
    }
    if (seenUser && isConversationVisibleAssistantEvent(event) && String(event?.text || event?.message || '').trim()) {
      return true
    }
  }
  return false
}

function deliveryReceiptHasMessage(root, messageId) {
  const file = deliveryReceiptPath(root)
  if (!fs.existsSync(file)) return false
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => {
        try {
          const item = JSON.parse(line)
          return String(item?.message_id || item?.source_message_id || '') === String(messageId || '')
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}

// A delayed reply has been processed before it is visible in thread history.
// ManyChat's periodic last_input_text sweep must not mistake that delivery gap for
// a missed webhook and inject the same human turn a second time. This receipt is
// written only after outbound-scv1 accepted the generated packet.
function recordInboundProcessingReceipt(root, packet, meta = {}) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '').trim()
  const messageId = String(packet?.message_id || '').trim()
  const normalized = normalizeText(packet?.text)
  const inboundAt = String(
    // For orphan recovery, received_at is the later sweep time. Dedup must bind to
    // the original ManyChat interaction timestamp or every debug reset/deploy can
    // replay the same old turn after its queue/history artifacts are purged.
    packet?.recovered_from_ig_last_interaction ||
    packet?.recovered_from_at ||
    packet?.received_at ||
    meta.adopted_at ||
    new Date().toISOString()
  ).trim()
  if (!threadId || !messageId || !normalized || !parseTimeMs(inboundAt)) {
    throw new Error('invalid_inbound_processing_receipt')
  }

  const receipt = {
    type: 'inbound_processing_adopted',
    processed_at: String(meta.adopted_at || new Date().toISOString()),
    adoption: String(meta.adoption || 'outbound_3101_accepted'),
    contact_id: String(packet?.contact_id || threadId),
    thread_id: threadId,
    message_id: messageId,
    instagram_username: String(packet?.instagram_username || ''),
    inbound_received_at: inboundAt,
    normalized_text_sha256: sha256(normalized)
  }
  appendNdjson(inboundProcessingReceiptPath(root), receipt)
  return receipt
}

function recentNdjsonLines(file, maxBytes = 4 * 1024 * 1024) {
  if (!fs.existsSync(file)) return []
  let fd
  try {
    const stat = fs.statSync(file)
    const bytes = Math.min(stat.size, maxBytes)
    const start = Math.max(0, stat.size - bytes)
    const buffer = Buffer.alloc(bytes)
    fd = fs.openSync(file, 'r')
    fs.readSync(fd, buffer, 0, bytes, start)
    let raw = buffer.toString('utf8')
    if (start > 0) raw = raw.replace(/^[^\n]*\n/, '')
    return raw.split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
  }
}

function inboundProcessingReceiptHasPacket(root, packet, opts = {}) {
  const file = inboundProcessingReceiptPath(root)
  const threadId = String(packet?.thread_id || packet?.contact_id || '').trim()
  const normalized = normalizeText(packet?.text)
  const targetAtMs = parseTimeMs(
    packet?.recovered_from_ig_last_interaction ||
    packet?.recovered_from_at ||
    packet?.received_at
  )
  const maxTimestampSkewMs = Number.isFinite(Number(opts.maxTimestampSkewMs))
    ? Math.max(0, Number(opts.maxTimestampSkewMs))
    : 5 * 1000
  if (!threadId || !normalized || !targetAtMs) return false

  const targetHash = sha256(normalized)
  const lines = recentNdjsonLines(file)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const receipt = JSON.parse(lines[i])
      if (String(receipt?.thread_id || receipt?.contact_id || '') !== threadId) continue
      if (String(receipt?.normalized_text_sha256 || '') !== targetHash) continue
      const receiptAtMs = parseTimeMs(receipt?.inbound_received_at)
      if (!receiptAtMs) continue
      if (Math.abs(receiptAtMs - targetAtMs) <= maxTimestampSkewMs) return true
    } catch {}
  }
  return false
}

function packetsReferToSameInbound(original, recovered, opts = {}) {
  const originalThread = String(original?.thread_id || original?.contact_id || '').trim()
  const recoveredThread = String(recovered?.thread_id || recovered?.contact_id || '').trim()
  if (!originalThread || originalThread !== recoveredThread) return false
  if (normalizeText(original?.text) !== normalizeText(recovered?.text)) return false

  const originalAtMs = parseTimeMs(original?.received_at || original?.recovered_from_at)
  const recoveredAtMs = parseTimeMs(
    recovered?.recovered_from_ig_last_interaction ||
    recovered?.recovered_from_at ||
    recovered?.received_at
  )
  const maxTimestampSkewMs = Number.isFinite(Number(opts.maxTimestampSkewMs))
    ? Math.max(0, Number(opts.maxTimestampSkewMs))
    : 5 * 1000
  return Boolean(originalAtMs && recoveredAtMs && Math.abs(originalAtMs - recoveredAtMs) <= maxTimestampSkewMs)
}

function pipelineHasMatchingInbound(root, packet) {
  const dir = path.join(root, 'inbox')
  if (!fs.existsSync(dir)) return false
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') && !name.endsWith('.json.lock')) continue
    const original = safeReadJson(path.join(dir, name))
    if (original && packetsReferToSameInbound(original, packet)) return true
  }
  return false
}

function hasProcessedLatestInput(root, packet) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '').trim()
  const messageId = String(packet?.message_id || '').trim()
  if (!threadId || !messageId) return false

  // A debug reset is a temporal boundary, not only a file deletion. ManyChat keeps
  // last_input_text after our local state is purged; without this cutoff the sweep
  // immediately replays the pre-reset turn and silently recreates the old chat.
  // Only orphan-recovered interactions at/before the reset are blocked. A fresh
  // Instagram message has a later interaction timestamp and proceeds normally.
  if (orphanPacketPredatesDebugReset(root, packet)) return true

  if (fs.existsSync(inboxPath(root, messageId))) return true
  if (fs.existsSync(`${inboxPath(root, messageId)}.lock`)) return true
  if (fs.existsSync(outboxPath(root, messageId))) return true
  if (fs.existsSync(`${outboxPath(root, messageId)}.lock`)) return true
  if (pipelineHasMatchingInbound(root, packet)) return true
  if (deliveryReceiptHasMessage(root, messageId)) return true
  if (inboundProcessingReceiptHasPacket(root, packet)) return true

  const history = safeReadJson(threadHistoryPath(root, threadId))
  return historyHasAssistantAfterUser(history, packet)
}

function writeRecoveryPacketToLocalPipeline(root, packet, opts = {}) {
  const admission = recoveryAdmissionVerdict(packet, opts)
  if (admission.hold) {
    const humanAgentFile = writeRecoveryHumanHold(root, packet, admission, opts)
    return {
      ok: true,
      skipped: true,
      held: true,
      reason: admission.reason,
      human_agent_file: humanAgentFile,
      admission
    }
  }

  ensurePipelineDirs(root)
  if (hasProcessedLatestInput(root, packet)) {
    return {
      ok: true,
      skipped: true,
      reason: 'latest_input_already_processed',
      contact_id: String(packet.contact_id || ''),
      thread_id: String(packet.thread_id || ''),
      message_id: String(packet.message_id || '')
    }
  }

  const ingress_control = recordIngressEvent(root, packet)
  const thread_state_file = ingress_control.state_file
  const thread_history_file = ingress_control.history_file
  const inbox_file = inboxPath(root, packet.message_id)
  fs.writeFileSync(inbox_file, JSON.stringify(packet, null, 2) + '\n')
  appendNdjson(path.join(root, 'logs', 'manychat-orphan-recovery.ndjson'), {
    type: 'manychat_orphan_recovery_enqueued',
    at: new Date().toISOString(),
    lock_version: SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION,
    contact_id: String(packet.contact_id || ''),
    thread_id: String(packet.thread_id || ''),
    instagram_username: String(packet.instagram_username || ''),
    message_id: String(packet.message_id || ''),
    text_sha256: sha256(packet.text || ''),
    recovered_from_ig_last_interaction: String(packet.recovered_from_ig_last_interaction || '')
  })

  return {
    ok: true,
    skipped: false,
    reason: 'enqueued',
    inbox_file,
    thread_state_file,
    thread_history_file,
    ingress_control,
    contact_id: String(packet.contact_id || ''),
    thread_id: String(packet.thread_id || ''),
    message_id: String(packet.message_id || '')
  }
}

async function readBoundedResponseText(response, maxBytes = MANYCHAT_GET_MAX_RESPONSE_BYTES) {
  const contentLength = Number(response?.headers?.get?.('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('manychat_response_too_large')
  }
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value || [])
        total += chunk.length
        if (total > maxBytes) {
          try { await reader.cancel('manychat_response_too_large') } catch {}
          throw new Error('manychat_response_too_large')
        }
        chunks.push(chunk)
      }
      return Buffer.concat(chunks, total).toString('utf8')
    } finally {
      try { reader.releaseLock() } catch {}
    }
  }
  const value = Buffer.from(await response.arrayBuffer())
  if (value.length > maxBytes) throw new Error('manychat_response_too_large')
  return value.toString('utf8')
}

async function manychatGet(pathname, query = {}) {
  const key = process.env.MANYCHAT_API_KEY || ''
  if (!key) throw new Error('missing_manychat_api_key')

  const url = new URL(pathname, MANYCHAT_API_BASE)
  for (const [keyName, value] of Object.entries(query)) {
    url.searchParams.set(keyName, String(value))
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('manychat_get_timeout')), MANYCHAT_GET_TIMEOUT_MS)
  let resp
  let text
  try {
    resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${key}`
      },
      signal: controller.signal
    })
    text = await readBoundedResponseText(resp)
  } finally {
    clearTimeout(timeout)
  }
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { raw: text }
  }
  return {
    http_status: resp.status,
    body
  }
}

async function findSubscribersByName(name) {
  const result = await manychatGet('/fb/subscriber/findByName', { name })
  if (result.http_status !== 200 || result.body?.status !== 'success') {
    throw new Error(`manychat_find_by_name_failed_${result.http_status}`)
  }
  return Array.isArray(result.body?.data) ? result.body.data : []
}

async function getSubscriberInfo(subscriberId) {
  const result = await manychatGet('/fb/subscriber/getInfo', { subscriber_id: subscriberId })
  if (result.http_status !== 200 || result.body?.status !== 'success') {
    throw new Error(`manychat_get_info_failed_${result.http_status}`)
  }
  return result.body?.data || {}
}

function selectSubscriber(candidates, opts = {}) {
  const list = Array.isArray(candidates) ? candidates : []
  const username = String(opts.instagram_username || '').trim().toLowerCase()

  if (!list.length) throw new Error('manychat_orphan_recovery_no_subscriber_match')

  if (username) {
    const matched = list.find((item) => String(item?.ig_username || '').trim().toLowerCase() === username)
    if (!matched) throw new Error(`manychat_orphan_recovery_username_not_found_${username}`)
    return matched
  }

  const withText = list
    .filter((item) => looksLikeHumanText(item?.last_input_text) || looksLikeRecoverableMediaUrl(item?.last_input_text))
    .sort((a, b) => parseTimeMs(b?.ig_last_interaction || b?.ig_last_seen) - parseTimeMs(a?.ig_last_interaction || a?.ig_last_seen))

  if (withText.length) return withText[0]
  if (list.length === 1) return list[0]

  throw new Error('manychat_orphan_recovery_ambiguous_subscriber_match')
}

function parseArgs(argv) {
  const opts = {
    root: process.env.SCV_ROOT || __dirname,
    name: '',
    subscriber_id: '',
    instagram_username: '',
    enqueue: false,
    dry_run: true
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i] || ''
    if (arg === '--name') opts.name = next()
    else if (arg === '--subscriber-id') opts.subscriber_id = next()
    else if (arg === '--instagram-username') opts.instagram_username = next()
    else if (arg === '--root') opts.root = next()
    else if (arg === '--enqueue') {
      opts.enqueue = true
      opts.dry_run = false
    } else if (arg === '--dry-run') {
      opts.enqueue = false
      opts.dry_run = true
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (!opts.name && !opts.subscriber_id) {
      opts.name = arg
    } else {
      throw new Error(`unknown_arg_${arg}`)
    }
  }

  return opts
}

function usage() {
  return [
    'Usage:',
    '  node scv-manychat-orphan-recovery.js --name "Allie" --enqueue',
    '  node scv-manychat-orphan-recovery.js --subscriber-id 72324942 --enqueue',
    '',
    'Default is --dry-run. The script never prints API keys.'
  ].join('\n')
}

async function runCli(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv)
  if (opts.help) {
    return { ok: true, help: usage() }
  }

  loadLocalEnv(opts.root)

  let info
  if (opts.subscriber_id) {
    info = await getSubscriberInfo(opts.subscriber_id)
  } else if (opts.name) {
    const candidates = await findSubscribersByName(opts.name)
    const selected = selectSubscriber(candidates, opts)
    info = await getSubscriberInfo(selected.id)
  } else {
    throw new Error('missing_name_or_subscriber_id')
  }

  const packet = buildRecoveryPacket(info)
  const alreadyProcessed = hasProcessedLatestInput(opts.root, packet)
  const admission = recoveryAdmissionVerdict(packet)
  const safePacketPreview = {
    contact_id: packet.contact_id,
    thread_id: packet.thread_id,
    instagram_username: packet.instagram_username,
    message_id: packet.message_id,
    text_preview: packet.text.slice(0, 160),
    recovered_from_ig_last_interaction: packet.recovered_from_ig_last_interaction,
    operator_recovery_lock_version: packet.operator_recovery_lock_version
  }

  if (alreadyProcessed) {
    return {
      ok: true,
      lock_version: SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION,
      dry_run: opts.dry_run,
      skipped: true,
      reason: 'latest_input_already_processed',
      packet: safePacketPreview
    }
  }

  if (!opts.enqueue) {
    return {
      ok: true,
      lock_version: SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION,
      dry_run: true,
      would_enqueue: !admission.hold,
      would_hold: admission.hold,
      admission,
      packet: safePacketPreview
    }
  }

  const written = writeRecoveryPacketToLocalPipeline(opts.root, packet)
  return {
    ok: true,
    lock_version: SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION,
    dry_run: false,
    written,
    packet: safePacketPreview
  }
}

if (require.main === module) {
  runCli()
    .then((result) => {
      if (result.help) {
        console.log(result.help)
      } else {
        console.log(JSON.stringify(result, null, 2))
      }
    })
    .catch((err) => {
      console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }, null, 2))
      process.exit(1)
    })
}

module.exports = {
  SCV_MANYCHAT_ORPHAN_RECOVERY_LOCK_VERSION,
  SCV_RECOVERY_ADMISSION_VERSION,
  OFFICIAL_MANYCHAT_API_BASE,
  MANYCHAT_GET_MAX_RESPONSE_BYTES,
  resolveManyChatApiBase,
  readBoundedResponseText,
  looksLikeRecoverableMediaUrl,
  buildRecoveryPacket,
  hasProcessedLatestInput,
  recordInboundProcessingReceipt,
  inboundProcessingReceiptHasPacket,
  packetsReferToSameInbound,
  pipelineHasMatchingInbound,
  historyHasAssistantAfterUser,
  deliveryReceiptHasMessage,
  recoveryAdmissionVerdict,
  writeRecoveryHumanHold,
  writeRecoveryPacketToLocalPipeline,
  findSubscribersByName,
  getSubscriberInfo,
  selectSubscriber,
  runCli
}
