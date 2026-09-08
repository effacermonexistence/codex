#!/usr/bin/env node
// ============================================================
// SCV MANYCHAT INPUT SWEEP — recover inbounds ManyChat received but never forwarded.
//
// Root cause it covers (confirmed live): christian.bolanos.35977 sent his phone number;
// ManyChat recorded it (getInfo last_input_text = "4157602883") but our webhook never
// received it -> no reply, no trace. The local auto-recovery loop only heals inbounds
// that DID reach us; nothing polled the ManyChat side. This sweep does:
//
//   every tick: for each contact we have ever seen (thread-state/*.json on the volume)
//     -> ManyChat getInfo
//     -> if last_input_text is a real human turn we never processed
//        and it is fresh enough to still be deliverable (24h window)
//     -> enqueue it through the existing orphan-recovery pipeline
//        (buildRecoveryPacket + hasProcessedLatestInput dedup + local inbox write)
//
// Safety: dedup via hasProcessedLatestInput (never re-answers a handled turn);
// explicitly excluded canaries skipped; debug targets are ALWAYS watched because
// startup reset removes their thread-state; aged-out inputs logged but not enqueued
// (delivery would 3031); sequential API calls with a gap (rate-limit friendly);
// kill switch SCV_MANYCHAT_INPUT_SWEEP=0.
// ============================================================
const fs = require('fs')
const path = require('path')
const {
  buildRecoveryPacket,
  hasProcessedLatestInput,
  writeRecoveryPacketToLocalPipeline,
  getSubscriberInfo
} = require(path.join(__dirname, 'scv-manychat-orphan-recovery.js'))
const {
  redactedIdentity,
  textMetrics,
  errorMetrics
} = require(path.join(__dirname, 'scv-machine-log.js'))

const ROOT = __dirname
const SWEEP_ENABLED = String(process.env.SCV_MANYCHAT_INPUT_SWEEP || '1').trim() !== '0'
const SWEEP_INTERVAL_MS = Number(process.env.SCV_SWEEP_INTERVAL_MS || 10 * 60 * 1000)
const SWEEP_MAX_AGE_MS = Number(process.env.SCV_SWEEP_MAX_AGE_MS || 24 * 60 * 60 * 1000)
const SWEEP_CALL_GAP_MS = Number(process.env.SCV_SWEEP_CALL_GAP_MS || 400)
const SWEEP_MAX_CONTACTS = Number(process.env.SCV_SWEEP_MAX_CONTACTS || 300)
const SCV_MANYCHAT_INPUT_SWEEP_LOCK_VERSION = 'scv-manychat-input-sweep-lock-2026-07-12-v2-media-debug-watch'

function splitCsv(value) {
  return String(value || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean)
}

function defaultSkipLists(env = process.env) {
  return {
    contactIds: new Set(splitCsv(env.SCV_CANARY_CONTACT_ID)),
    usernames: new Set(splitCsv(env.SCV_CANARY_INSTAGRAM_USERNAME))
  }
}

function defaultWatchContactIds(env = process.env) {
  return new Set([
    ...splitCsv(env.SCV_FAST_TARGET_CONTACT_IDS),
    ...splitCsv(env.SCV_PURGE_TEST_CONTACT_IDS)
  ])
}

function listKnownContactIds(root = ROOT, cap = SWEEP_MAX_CONTACTS) {
  const dir = path.join(root, 'thread-state')
  let entries = []
  try { entries = fs.readdirSync(dir) } catch { return [] }
  return entries
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .slice(0, cap)
}

function listSweepContactIds(root = ROOT, cap = SWEEP_MAX_CONTACTS, env = process.env) {
  const watched = [...defaultWatchContactIds(env)]
  const known = listKnownContactIds(root, cap)
  return Array.from(new Set([...watched, ...known])).filter((id) => /^\d+$/.test(id)).slice(0, cap)
}

function classifySweepCandidate({ info, now, maxAgeMs, skip }) {
  const contactId = String(info?.id || '').trim()
  const username = String(info?.ig_username || '').trim().toLowerCase()
  if (skip.contactIds.has(contactId) || (username && skip.usernames.has(username))) {
    return { action: 'skip', reason: 'explicitly_skipped_account' }
  }

  const latestAtMs = Date.parse(String(info?.ig_last_interaction || info?.ig_last_seen || '')) || 0
  if (!latestAtMs) return { action: 'skip', reason: 'no_interaction_timestamp' }
  if (now - latestAtMs > maxAgeMs) return { action: 'skip', reason: 'aged_out_window_closed' }

  let packet
  try {
    packet = buildRecoveryPacket(info)
  } catch (err) {
    return { action: 'skip', reason: String(err?.message || 'packet_build_failed') }
  }
  return { action: 'recover', packet }
}

async function sweepOnce(deps = {}) {
  const root = deps.root || ROOT
  const now = deps.now || Date.now()
  const maxAgeMs = deps.maxAgeMs || SWEEP_MAX_AGE_MS
  const skip = deps.skip || defaultSkipLists()
  const getInfo = deps.getInfo || (async (id) => (await getSubscriberInfo(id)))
  const hasProcessed = deps.hasProcessed || ((r, p) => hasProcessedLatestInput(r, p))
  const writePacket = deps.writePacket || ((r, p) => writeRecoveryPacketToLocalPipeline(r, p))
  const sleepMs = deps.callGapMs != null ? deps.callGapMs : SWEEP_CALL_GAP_MS
  const contactIds = deps.contactIds || listSweepContactIds(root, SWEEP_MAX_CONTACTS, deps.env || process.env)

  const summary = { scanned: 0, recovered: 0, skipped: {}, errors: 0 }
  for (const contactId of contactIds) {
    summary.scanned++
    try {
      const info = await getInfo(contactId)
      const verdict = classifySweepCandidate({ info, now, maxAgeMs, skip })
      if (verdict.action === 'skip') {
        summary.skipped[verdict.reason] = (summary.skipped[verdict.reason] || 0) + 1
      } else if (hasProcessed(root, verdict.packet)) {
        summary.skipped.already_processed = (summary.skipped.already_processed || 0) + 1
      } else {
        const written = writePacket(root, verdict.packet)
        if (written && written.skipped) {
          summary.skipped[written.reason || 'writer_skipped'] = (summary.skipped[written.reason || 'writer_skipped'] || 0) + 1
        } else {
          summary.recovered++
          console.log(JSON.stringify({
            type: 'manychat_input_sweep_recovered',
            ...redactedIdentity(verdict.packet),
            input_kind: Array.isArray(verdict.packet.media_urls) && verdict.packet.media_urls.length ? 'media' : 'text',
            ...textMetrics(verdict.packet.text)
          }))
        }
      }
    } catch (err) {
      summary.errors++
    }
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
  }
  console.log(JSON.stringify({ type: 'manychat_input_sweep_tick', enabled: SWEEP_ENABLED, ...summary }))
  return summary
}

async function main() {
  if (!SWEEP_ENABLED) {
    console.log(JSON.stringify({ type: 'manychat_input_sweep_disabled' }))
    if (process.argv.includes('--loop')) setInterval(() => {}, 1 << 30)
    return
  }
  if (process.argv.includes('--loop')) {
    await sweepOnce().catch((err) => console.error(JSON.stringify({ type: 'manychat_input_sweep_error', ...errorMetrics(err) })))
    setInterval(() => {
      sweepOnce().catch((err) => console.error(JSON.stringify({ type: 'manychat_input_sweep_error', ...errorMetrics(err) })))
    }, SWEEP_INTERVAL_MS)
  } else {
    await sweepOnce()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, ...errorMetrics(err) }))
    process.exit(1)
  })
}

module.exports = {
  SCV_MANYCHAT_INPUT_SWEEP_LOCK_VERSION,
  sweepOnce,
  classifySweepCandidate,
  listKnownContactIds,
  listSweepContactIds,
  defaultSkipLists,
  defaultWatchContactIds
}
