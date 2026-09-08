#!/usr/bin/env node
// ④ No-silent-loss watchdog.
// Reconstructs each inbound's disposition from existing artifacts (logs/inbound-raw.ndjson,
// logs/delivery-receipts.ndjson, thread-history/, and the quarantine / human-agent / deadletter
// queue dirs) and flags any inbound where the user spoke but there is no reply, no explicit
// quarantine, no human-agent handoff, and no retry — i.e. a silent miss.
//
// Non-invasive: it only READS live artifacts. `--recover` writes an explicit
// outbox_human_agent_required record per unresolved inbound (no silent drop) and prints the
// recovery command; it never makes network calls itself.
//
// Core (classifyInbound / scanFromData) is pure and is exercised by scv-missed-inbound-harness.js.
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))

const ROOT = process.env.SCV_ROOT || __dirname
const DEFAULT_THRESHOLD_MS = Number(process.env.SCV_MISSED_THRESHOLD_MS || 15 * 60 * 1000)

// Disposition outcomes. Anything other than 'silent_missing' / 'pending' is "resolved".
const RESOLVED = new Set(['replied', 'quarantined', 'human_agent_required', 'deadletter', 'retry_pending'])

function toMs(value) {
  const t = Date.parse(String(value || ''))
  return Number.isFinite(t) ? t : 0
}

function previewText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
}

// Pure: decide one inbound's disposition from the resolution signals for its contact.
// inbound:  { contact_id, message_id, instagram_username, text, at }
// signals:  { replies:[], quarantines:[], humanAgent:[], deadletter:[], retries:[] }
//           each entry: { contact_id, message_id, at }
// now, thresholdMs: numbers (ms).
function classifyInbound(inbound, signals, now, thresholdMs) {
  const at = toMs(inbound.at)
  // Prefer exact message correlation. Only legacy ID-less artifacts fall back
  // to AT/AFTER timing, so a late reply to A cannot close newer inbound B.
  const sameThreadTimed = (s) => {
    if (String(s.contact_id || '') !== String(inbound.contact_id || '')) return false
    const signalMessageId = String(s.message_id || '').trim()
    const inboundMessageId = String(inbound.message_id || '').trim()
    if (signalMessageId && inboundMessageId) return signalMessageId === inboundMessageId
    return toMs(s.at) >= at
  }
  // pending work for the contact (queued reply / item being processed) = actively handled
  // right now, so it is never a silent miss regardless of timestamp. This is what stops the
  // auto-recovery loop from double-sending a reply that is just waiting out the pacing delay.
  const sameContact = (s) => String(s.contact_id || '') === String(inbound.contact_id || '')

  const layers = [
    ['replied', signals.replies, sameThreadTimed],
    ['quarantined', signals.quarantines, sameThreadTimed],
    ['human_agent_required', signals.humanAgent, sameThreadTimed],
    ['deadletter', signals.deadletter, sameThreadTimed],
    ['retry_pending', signals.retries, sameContact],
    ['in_flight', signals.inFlight, sameContact]
  ]
  for (const [disposition, list, match] of layers) {
    if (Array.isArray(list) && list.some(match)) {
      return { disposition, resolved: true, last_known_layer: disposition }
    }
  }

  const ageMs = now - at
  if (ageMs < thresholdMs) {
    return { disposition: 'pending', resolved: false, last_known_layer: 'inbound_received', age_ms: ageMs }
  }
  return {
    disposition: 'silent_missing',
    resolved: false,
    last_known_layer: 'inbound_received',
    age_ms: ageMs,
    recommended_action: 'enqueue operator recovery (scv-manychat-orphan-recovery.js) or write outbox_human_agent_required'
  }
}

// Pure: classify a whole batch given already-parsed data.
function scanFromData({ inbounds, signals, now, thresholdMs = DEFAULT_THRESHOLD_MS }) {
  const summary = { total: 0, replied: 0, quarantined: 0, human_agent_required: 0, deadletter: 0, retry_pending: 0, in_flight: 0, pending: 0, silent_missing: 0 }
  const unresolved = []
  for (const inbound of inbounds) {
    if (!inbound || !inbound.contact_id) continue
    summary.total += 1
    const verdict = classifyInbound(inbound, signals, now, thresholdMs)
    summary[verdict.disposition] = (summary[verdict.disposition] || 0) + 1
    if (verdict.disposition === 'silent_missing') {
      unresolved.push({
        contact_id: inbound.contact_id,
        instagram_username: inbound.instagram_username || '',
        message_id: inbound.message_id || '',
        inbound_preview: previewText(inbound.text),
        last_known_layer: verdict.last_known_layer,
        age_minutes: Math.round((verdict.age_ms || 0) / 60000),
        recommended_action: verdict.recommended_action
      })
    }
  }
  return { ok: true, summary, unresolved }
}

// ── file layer (best-effort, defensive) ─────────────────────────────────────
function readNdjson(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

function readJsonDir(dir) {
  try {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) } catch { return null }
    }).filter(Boolean)
  } catch { return [] }
}

function pick(obj, keys, fallback = '') {
  for (const k of keys) {
    const parts = k.split('.')
    let v = obj
    for (const p of parts) { v = v && typeof v === 'object' ? v[p] : undefined }
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v)
  }
  return fallback
}

function extractInbounds(rawRecords) {
  return rawRecords
    .filter((r) => r && r.type === 'raw_inbound_received')
    .map((r) => {
      const b = r.body || {}
      return {
        contact_id: pick(b, ['contact_id', 'subscriber_id', 'id', 'subscriber.id']),
        message_id: pick(b, ['message_id']),
        instagram_username: pick(b, ['instagram_username', 'username', 'subscriber.ig_username', 'ig_username']),
        text: pick(b, ['last_input_text', 'text', 'message', 'last_input.text']),
        at: r.at
      }
    })
    .filter((x) => x.contact_id)
}

function signalsFromDir(records, extraReason) {
  return records.map((r) => ({
    contact_id: String(r.contact_id || (r.packet && r.packet.contact_id) || ''),
    message_id: String(r.message_id || (r.packet && r.packet.message_id) || ''),
    at: r.at || r.quarantined_at || r.queued_for_human_agent_at || ''
  })).filter((s) => s.contact_id)
}

function readThreadHistorySignals(dir) {
  // Only conversation-visible assistant evidence means the thread got a reply.
  const signals = []
  try {
    if (!fs.existsSync(dir)) return signals
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name)
      let entries = []
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
        entries = Array.isArray(parsed)
          ? parsed
          : (Array.isArray(parsed.events)
              ? parsed.events
              : (Array.isArray(parsed.history) ? parsed.history : [parsed]))
      } catch { continue }
      for (const e of entries) {
        if (isConversationVisibleAssistantEvent(e)) {
          signals.push({
            contact_id: String(e.contact_id || e.thread_id || name.replace(/\.json$/, '')),
            message_id: String(e.reply_to_message_id || e.message_id || ''),
            at: e.at || e.created_at || ''
          })
        }
      }
    }
  } catch { /* ignore */ }
  return signals
}

function isConversationReplyReceipt(receipt) {
  const status = String(receipt?.delivery_status || '')
  const hasExplicitDeliveryTruth =
    status !== '' ||
    typeof receipt?.delivery_confirmed === 'boolean' ||
    typeof receipt?.delivery_accepted === 'boolean'

  // Keep pre-contract receipts readable, but fail closed for every explicit
  // modern outcome except confirmed visible delivery.
  if (!hasExplicitDeliveryTruth) return true
  return receipt?.delivery_confirmed === true && status === 'success_visible'
}

function readInbounds(root = ROOT) {
  return extractInbounds(readNdjson(path.join(root, 'logs', 'inbound-raw.ndjson')))
}

function collectSignals(root = ROOT) {
  const logDir = path.join(root, 'logs')
  const replies = readNdjson(path.join(logDir, 'delivery-receipts.ndjson'))
    .filter(isConversationReplyReceipt)
    .map((r) => ({ contact_id: String(r.contact_id || ''), message_id: String(r.message_id || ''), at: r.at }))
    .filter((s) => s.contact_id)
    .concat(readThreadHistorySignals(path.join(root, 'thread-history')))
  const quarantines = []
    .concat(signalsFromDir(readJsonDir(path.join(root, 'outbox_quarantine_stale'))))
    .concat(signalsFromDir(readJsonDir(path.join(root, 'outbox_quarantine_non_authoritative'))))
    .concat(signalsFromDir(readJsonDir(path.join(root, 'outbox_quarantine_failed'))))
    .concat(signalsFromDir(readJsonDir(path.join(root, 'outbox_quarantine_contract_harness'))))
  const humanAgent = signalsFromDir(readJsonDir(path.join(root, 'outbox_human_agent_required')))
  const deadletter = signalsFromDir(readJsonDir(path.join(root, 'inbox_quarantine_deadletter')))
  const retries = signalsFromDir(readJsonDir(path.join(root, 'inbox'))) // pending recovery / reprocess
  // a reply already queued in outbox (commonly waiting out the 20-60 min pacing delay) = in flight
  const inFlight = signalsFromDir(readJsonDir(path.join(root, 'outbox')))
  return { replies, quarantines, humanAgent, deadletter, retries, inFlight }
}

function scan({ root = ROOT, now = Date.now(), thresholdMs = DEFAULT_THRESHOLD_MS } = {}) {
  return scanFromData({ inbounds: readInbounds(root), signals: collectSignals(root), now, thresholdMs })
}

function writeHumanAgentRecovery(root, record) {
  const dir = path.join(root, 'outbox_human_agent_required')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `watchdog-recovery-${record.contact_id}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify({
    type: 'watchdog_missed_inbound_recovery',
    manual_reason: 'silent_missing_inbound_detected_by_watchdog',
    queued_for_human_agent_at: new Date().toISOString(),
    ...record
  }, null, 2) + '\n')
  return file
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const result = scan({})
  if (args.includes('--recover')) {
    result.recovered = result.unresolved.map((r) => writeHumanAgentRecovery(ROOT, r))
  }
  console.log(JSON.stringify(result, null, 2))
  if (result.unresolved.length > 0 && args.includes('--strict')) process.exit(2)
}

module.exports = {
  classifyInbound,
  scanFromData,
  scan,
  extractInbounds,
  readInbounds,
  collectSignals,
  readThreadHistorySignals,
  isConversationReplyReceipt,
  RESOLVED,
  DEFAULT_THRESHOLD_MS
}
