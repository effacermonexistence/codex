#!/usr/bin/env node
// ④+ Continuous in-service self-healing so every received inbound ends in a visible reply
// or an explicit human-agent handoff — nobody is silently skipped.
//
// An inbound NEEDS recovery when, past the threshold, it has NO visible reply, NO queued/
// in-flight work, and NO prior human-agent escalation. That single rule covers silent drops,
// deadletters, and held/failed replies alike; a superseded (stale) turn is auto-resolved
// because the newer turn's delivery receipt counts as a reply for the contact.
//
// Safety against double-sending a paced reply (non-fast accounts wait 20-60 min before the
// first bubble sends): (1) threshold defaults to 90 min, well past the max pacing window;
// (2) a queued outbox item (in_flight) or pending inbox item blocks recovery; (3) the
// re-enqueue path runs hasProcessedLatestInput dedup; (4) a stable recovery message_id +
// a retry ledger cap attempts and escalate to human-agent instead of looping forever.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { collectSignals } = require(path.join(__dirname, 'scv-missed-inbound-watchdog.js'))
const {
  recoveryAdmissionVerdict,
  writeRecoveryHumanHold,
  writeRecoveryPacketToLocalPipeline
} = require(path.join(__dirname, 'scv-manychat-orphan-recovery.js'))
const { immutableIngressTimeMs } = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))
const { classifyPendingReplyCertainty } = require(path.join(__dirname, 'scv-reply-certainty-gate.js'))
const { hmacSha256, errorMetrics } = require(path.join(__dirname, 'scv-machine-log.js'))

const ROOT = process.env.SCV_ROOT || __dirname
const LOCK_VERSION = 'scv-auto-recovery-lock-2026-06-23-v1'
const DEFAULT_THRESHOLD_MS = Number(process.env.SCV_AUTO_RECOVERY_THRESHOLD_MS || 90 * 60 * 1000)
const DEFAULT_INTERVAL_MS = Number(process.env.SCV_AUTO_RECOVERY_INTERVAL_MS || 5 * 60 * 1000)
const MAX_RETRIES = Number(process.env.SCV_AUTO_RECOVERY_MAX_RETRIES || 3)
const DEFAULT_RAW_AUDIT_MAX_BYTES = Number(process.env.SCV_AUTO_RECOVERY_RAW_AUDIT_MAX_BYTES || 4 * 1024 * 1024)
const DEFAULT_MAX_ENQUEUES_PER_TICK = 1

function sha256(v) { return crypto.createHash('sha256').update(String(v || '')).digest('hex') }
function toMs(v) { const t = Date.parse(String(v || '')); return Number.isFinite(t) ? t : 0 }
function ledgerPath(root) { return path.join(root, 'logs', 'auto-recovery-ledger.ndjson') }
function truthy(v) { return /^(1|true|yes|on)$/i.test(String(v || '').trim()) }

function readLedger(root) {
  try {
    return fs.readFileSync(ledgerPath(root), 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}
function appendLedger(root, obj) {
  fs.mkdirSync(path.dirname(ledgerPath(root)), { recursive: true })
  fs.appendFileSync(ledgerPath(root), JSON.stringify(obj) + '\n')
}

function pick(obj, keys, fallback = '') {
  for (const key of keys) {
    const parts = key.split('.')
    let value = obj
    for (const part of parts) value = value && typeof value === 'object' ? value[part] : undefined
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return fallback
}

// The historic raw audit can be very large and now intentionally contains only
// redacted metadata. Recovery reads a bounded tail and accepts only legacy rows
// that still contain a complete body. Redacted audit entries are evidence, never
// executable queue material.
function readBoundedRecoveryInbounds(root, maxBytes = DEFAULT_RAW_AUDIT_MAX_BYTES) {
  const file = path.join(root, 'logs', 'inbound-raw.ndjson')
  if (!fs.existsSync(file)) return []
  let fd
  try {
    const stat = fs.statSync(file)
    const safeMaxBytes = Math.max(1024, Math.min(16 * 1024 * 1024, Number(maxBytes) || DEFAULT_RAW_AUDIT_MAX_BYTES))
    const bytes = Math.min(stat.size, safeMaxBytes)
    const start = Math.max(0, stat.size - bytes)
    const buffer = Buffer.alloc(bytes)
    fd = fs.openSync(file, 'r')
    fs.readSync(fd, buffer, 0, bytes, start)
    let raw = buffer.toString('utf8')
    if (start > 0) raw = raw.replace(/^[^\n]*(?:\n|$)/, '')

    const out = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line) continue
      let record
      try { record = JSON.parse(line) } catch { continue }
      if (!record || record.type !== 'raw_inbound_received') continue
      const body = record.body
      if (!body || typeof body !== 'object' || record.redacted === true) continue

      const contactId = pick(body, ['contact_id', 'subscriber_id', 'id', 'subscriber.id'])
      const text = pick(body, ['last_input_text', 'text', 'message', 'last_input.text'])
      if (!contactId || !text) continue
      out.push({
        contact_id: contactId,
        thread_id: pick(body, ['thread_id'], contactId),
        message_id: pick(body, ['message_id']),
        instagram_username: pick(body, ['instagram_username', 'username', 'subscriber.ig_username', 'ig_username']),
        text,
        source_interaction_at: pick(body, ['source_interaction_at', 'ig_last_interaction', 'instagram_interaction_at', 'message_created_at', 'event_created_at']),
        manychat_latest_interaction_at: pick(body, ['manychat_latest_interaction_at', 'ig_last_interaction']),
        recovered_from_ig_last_interaction: pick(body, ['recovered_from_ig_last_interaction']),
        recovered_from_at: pick(body, ['recovered_from_at']),
        received_at: pick(body, ['received_at']),
        at: String(record.at || ''),
        raw_body_sha256: String(record.body_sha256 || record.raw_body_sha256 || sha256(JSON.stringify(body)))
      })
    }
    return out
  } catch {
    return []
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
  }
}

function latestRecoveryInboundPerContact(inbounds) {
  const latest = new Map()
  for (const inbound of Array.isArray(inbounds) ? inbounds : []) {
    const contactId = String(inbound?.contact_id || '').trim()
    if (!contactId) continue
    const timestampMs = immutableIngressTimeMs(inbound)
    const prior = latest.get(contactId)
    if (!prior || timestampMs >= prior.timestamp_ms) latest.set(contactId, { inbound, timestamp_ms: timestampMs })
  }
  return [...latest.values()]
    .sort((a, b) => b.timestamp_ms - a.timestamp_ms || String(a.inbound.contact_id).localeCompare(String(b.inbound.contact_id)))
    .map((entry) => entry.inbound)
}

function maxEnqueuesPerTick(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ENQUEUES_PER_TICK
  return Math.max(0, Math.min(25, Math.floor(parsed)))
}

function recoveryKey(inbound) {
  return sha256(`${inbound.contact_id}\n${inbound.message_id}\n${inbound.text}`).slice(0, 16)
}

// Does this inbound still need a reply? Positive-signal definition (anything not covered = recover).
function needsRecovery(inbound, signals, now, thresholdMs) {
  if (!inbound || !inbound.contact_id) return false
  // Live 2026-07-28: an empty-text ManyChat interaction (contact 2124122710)
  // was endlessly "recovered" — there is nothing to reply to, so recovery can
  // never terminate. An inbound with no client text is not recoverable here;
  // real media-only turns already arrive through the webhook media lane.
  if (!String(inbound.text || '').trim()) return false
  const at = immutableIngressTimeMs(inbound)
  if (now - at < thresholdMs) return false
  const sameContact = (s) => String(s.contact_id || '') === String(inbound.contact_id || '')
  const sameThreadTimed = (s) => sameContact(s) &&
    (toMs(s.at) >= at || (s.message_id && inbound.message_id && String(s.message_id) === String(inbound.message_id)))
  if ((signals.replies || []).some(sameThreadTimed)) return false      // got a visible reply (incl. newer-turn reply)
  if ((signals.inFlight || []).some(sameContact)) return false         // a reply is queued (pacing wait)
  if ((signals.retries || []).some(sameContact)) return false          // being reprocessed in inbox
  if ((signals.humanAgent || []).some(sameThreadTimed)) return false   // already escalated to a human
  return true
}

function recoveryPacketFromInbound(inbound, now) {
  const key = recoveryKey(inbound)
  return {
    contact_id: String(inbound.contact_id || ''),
    thread_id: String(inbound.contact_id || ''),
    message_id: `auto-recovery-${inbound.contact_id}-${key}`,
    instagram_username: String(inbound.instagram_username || ''),
    text: String(inbound.text || ''),
    text_source: 'scv_auto_recovery.inbound_raw',
    recovered_via: 'scv_auto_recovery_loop',
    source_interaction_at: String(inbound.source_interaction_at || ''),
    manychat_latest_interaction_at: String(inbound.manychat_latest_interaction_at || ''),
    recovered_from_ig_last_interaction: String(inbound.recovered_from_ig_last_interaction || ''),
    recovered_from_message_id: String(inbound.message_id || ''),
    recovered_from_at: String(inbound.recovered_from_at || inbound.at || ''),
    operator_recovery: true,
    operator_recovery_lock_version: LOCK_VERSION,
    raw_body_sha256: sha256(JSON.stringify(inbound)),
    received_at: now ? new Date(now).toISOString() : new Date().toISOString()
  }
}

function writeHumanAgentEscalation(root, inbound, reason, now) {
  const dir = path.join(root, 'outbox_human_agent_required')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `auto-recovery-escalation-${String(inbound.contact_id).replace(/[^a-zA-Z0-9._-]/g, '_')}-${now}.json`)
  fs.writeFileSync(file, JSON.stringify({
    type: 'auto_recovery_human_agent_escalation',
    manual_reason: reason,
    queued_for_human_agent_at: new Date(now).toISOString(),
    contact_id: String(inbound.contact_id || ''),
    instagram_username: String(inbound.instagram_username || ''),
    message_id: String(inbound.message_id || ''),
    text: String(inbound.text || ''),
    lock_version: LOCK_VERSION
  }, null, 2) + '\n')
  return file
}

function runAutoRecoveryOnce({ root = ROOT, now = Date.now(), thresholdMs = DEFAULT_THRESHOLD_MS, maxRetries = MAX_RETRIES, enqueueFn = writeRecoveryPacketToLocalPipeline, env = process.env, inbounds, rawAuditMaxBytes = DEFAULT_RAW_AUDIT_MAX_BYTES, enqueueCap } = {}) {
  const rawInbounds = Array.isArray(inbounds) ? inbounds : readBoundedRecoveryInbounds(root, rawAuditMaxBytes)
  const latestInbounds = latestRecoveryInboundPerContact(rawInbounds)
  const signals = collectSignals(root)
  const ledger = readLedger(root)
  const reenqueuedFor = (key) => ledger.filter((e) => e.recovery_key === key && e.action === 'reenqueued').length
  const escalatedFor = (key) => ledger.some((e) => e.recovery_key === key && e.action === 'human_agent_escalated')
  const actions = []
  let needed = 0
  let enqueueAttempts = 0
  const tickEnqueueCap = maxEnqueuesPerTick(enqueueCap ?? env.SCV_AUTO_RECOVERY_MAX_ENQUEUES_PER_TICK ?? DEFAULT_MAX_ENQUEUES_PER_TICK)
  for (const inbound of latestInbounds) {
    if (!needsRecovery(inbound, signals, now, thresholdMs)) continue
    needed += 1
    const key = recoveryKey(inbound)
    if (escalatedFor(key)) { actions.push({ contact_id: inbound.contact_id, recovery_key: key, action: 'already_escalated' }); continue }
    const tries = reenqueuedFor(key)
    const packet = recoveryPacketFromInbound(inbound, now)
    const admission = recoveryAdmissionVerdict(packet, { env, now })
    if (admission.hold) {
      const file = writeRecoveryHumanHold(root, packet, admission, { now })
      const rec = { at: new Date(now).toISOString(), recovery_key: key, action: 'human_agent_held_recovery_gate', reason: admission.reason, contact_id: String(inbound.contact_id), message_id: String(inbound.message_id || ''), attempts: tries, human_agent_file: path.relative(root, file), recovery_admission: admission }
      appendLedger(root, rec); ledger.push(rec)
      actions.push({ contact_id: inbound.contact_id, recovery_key: key, action: 'human_agent_held_recovery_gate', reason: admission.reason })
      continue
    }
    if (truthy(env.SCV_AUTO_RECOVERY_CERTAIN_ONLY)) {
      const certainty = classifyPendingReplyCertainty(inbound, { root })
      if (!certainty.certain) {
        const file = writeHumanAgentEscalation(root, inbound, `auto_recovery_uncertain_context_hold:${certainty.reason}`, now)
        const rec = { at: new Date(now).toISOString(), recovery_key: key, action: 'human_agent_held_uncertain', contact_id: String(inbound.contact_id), message_id: String(inbound.message_id || ''), attempts: tries, human_agent_file: path.relative(root, file), reply_certainty: certainty }
        appendLedger(root, rec); ledger.push(rec)
        actions.push({ contact_id: inbound.contact_id, recovery_key: key, action: 'human_agent_held_uncertain', reason: certainty.reason })
        continue
      }
    }
    if (tries >= maxRetries) {
      const file = writeHumanAgentEscalation(root, inbound, `auto_recovery_exhausted_after_${tries}_attempts`, now)
      const rec = { at: new Date(now).toISOString(), recovery_key: key, action: 'human_agent_escalated', contact_id: String(inbound.contact_id), message_id: String(inbound.message_id || ''), attempts: tries, human_agent_file: path.relative(root, file) }
      appendLedger(root, rec); ledger.push(rec)
      actions.push({ contact_id: inbound.contact_id, recovery_key: key, action: 'human_agent_escalated', attempts: tries })
      continue
    }
    if (enqueueAttempts >= tickEnqueueCap) {
      actions.push({ contact_id: inbound.contact_id, recovery_key: key, action: 'deferred_tick_enqueue_cap' })
      continue
    }
    enqueueAttempts += 1
    let written
    try { written = enqueueFn(root, packet, { env, now }) } catch (e) { written = { ok: false, error: String(e && e.message ? e.message : e) } }
    const action = (written && written.held)
      ? 'human_agent_held_recovery_gate'
      : ((written && written.skipped) ? 'skipped_dedup' : ((written && written.ok !== false) ? 'reenqueued' : 'enqueue_failed'))
    const rec = { at: new Date(now).toISOString(), recovery_key: key, action, contact_id: String(inbound.contact_id), message_id: String(inbound.message_id || ''), recovery_message_id: packet.message_id, attempt: tries + 1 }
    appendLedger(root, rec); ledger.push(rec)
    actions.push({ contact_id: inbound.contact_id, recovery_key: key, action, attempt: tries + 1 })
  }
  return {
    ok: true,
    lock_version: LOCK_VERSION,
    threshold_ms: thresholdMs,
    raw_candidates: rawInbounds.length,
    latest_contact_candidates: latestInbounds.length,
    max_enqueues_per_tick: tickEnqueueCap,
    enqueue_attempts: enqueueAttempts,
    needs_recovery: needed,
    actions
  }
}

let _running = false
function autoRecoveryLogSummary(receipt = {}) {
  const actions = Array.isArray(receipt.actions) ? receipt.actions : []
  const actionCounts = actions.reduce((counts, item) => {
    const action = String(item?.action || 'unknown')
      .replace(/[^a-z0-9_.:-]+/gi, '_')
      .slice(0, 80) || 'unknown'
    counts[action] = Number(counts[action] || 0) + 1
    return counts
  }, {})
  return {
    event: 'scv_auto_recovery_tick',
    ok: receipt.ok === true,
    lock_version: receipt.lock_version,
    threshold_ms: receipt.threshold_ms,
    raw_candidates: receipt.raw_candidates,
    latest_contact_candidates: receipt.latest_contact_candidates,
    max_enqueues_per_tick: receipt.max_enqueues_per_tick,
    enqueue_attempts: receipt.enqueue_attempts,
    needs_recovery: receipt.needs_recovery,
    action_count: actions.length,
    action_counts_hmac_sha256: hmacSha256(JSON.stringify(actionCounts))
  }
}

function startAutoRecoveryLoop({ root = ROOT, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const tick = () => {
    if (_running) return
    _running = true
    try {
      const r = runAutoRecoveryOnce({ root })
      if (r.actions.length) {
        console.log(JSON.stringify(autoRecoveryLogSummary(r)))
      }
    } catch (e) {
      console.error(JSON.stringify({ event: 'scv_auto_recovery_failed', ...errorMetrics(e) }))
    } finally { _running = false }
  }
  const timer = setInterval(tick, intervalMs)
  if (timer.unref) timer.unref()
  console.log(JSON.stringify({ event: 'scv_auto_recovery_loop_started', lock_version: LOCK_VERSION, interval_ms: intervalMs, threshold_ms: DEFAULT_THRESHOLD_MS, max_retries: MAX_RETRIES }))
  return timer
}

if (require.main === module) {
  if (process.argv.includes('--loop')) {
    startAutoRecoveryLoop({})
    setInterval(() => {}, 1 << 30) // keep the process alive for cloud-start's supervisor
  } else {
    console.log(JSON.stringify(autoRecoveryLogSummary(runAutoRecoveryOnce({})), null, 2))
  }
}

module.exports = {
  LOCK_VERSION, DEFAULT_THRESHOLD_MS, DEFAULT_INTERVAL_MS, MAX_RETRIES,
  DEFAULT_RAW_AUDIT_MAX_BYTES, DEFAULT_MAX_ENQUEUES_PER_TICK,
  readBoundedRecoveryInbounds, latestRecoveryInboundPerContact, maxEnqueuesPerTick,
  needsRecovery, recoveryKey, recoveryPacketFromInbound, writeHumanAgentEscalation,
  runAutoRecoveryOnce, autoRecoveryLogSummary, startAutoRecoveryLoop
}
