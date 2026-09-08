#!/usr/bin/env node
// ④ Proves the no-silent-loss watchdog: every inbound resolves to reply / quarantine /
// human-agent / deadletter / retry, OR is flagged silent_missing. Nothing vanishes quietly.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { classifyInbound, scanFromData, scan } = require(path.join(__dirname, 'scv-missed-inbound-watchdog.js'))

function assert(condition, label, detail = '') {
  if (!condition) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

const NOW = Date.parse('2026-06-23T12:00:00.000Z')
const THRESH = 15 * 60 * 1000
const OLD = '2026-06-23T11:00:00.000Z'      // 60 min ago
const RECENT = '2026-06-23T11:58:00.000Z'   // 2 min ago

function runScvMissedInboundHarness() {
  let checked = 0

  // ── pure classification: every layer resolves, only true gaps are flagged ──
  const sig = (over) => Object.assign({ replies: [], quarantines: [], humanAgent: [], deadletter: [], retries: [] }, over)

  // 1. pricing question that got a visible reply -> resolved
  assert(classifyInbound({ contact_id: '1', text: 'is there any cost?', at: OLD }, sig({ replies: [{ contact_id: '1', at: OLD }] }), NOW, THRESH).disposition === 'replied', 'pricing_question_replied_resolved')
  // 2. user message, NO reply, old -> silent_missing (the bug Ben hates)
  assert(classifyInbound({ contact_id: '2', text: 'hello?', at: OLD }, sig({}), NOW, THRESH).disposition === 'silent_missing', 'no_reply_flagged_silent')
  // 3. media/reference-only share, no reply, old -> silent_missing
  assert(classifyInbound({ contact_id: '3', text: 'sent a reference post: flash', at: OLD }, sig({}), NOW, THRESH).disposition === 'silent_missing', 'media_share_no_reply_silent')
  // 4. heart reaction, no reply, old -> silent_missing
  assert(classifyInbound({ contact_id: '4', text: 'sent a heart reaction', at: OLD }, sig({}), NOW, THRESH).disposition === 'silent_missing', 'heart_reaction_no_reply_silent')
  // 5. quarantined with reason -> resolved (not silent)
  assert(classifyInbound({ contact_id: '5', text: 'x', at: OLD }, sig({ quarantines: [{ contact_id: '5', at: OLD }] }), NOW, THRESH).disposition === 'quarantined', 'quarantine_is_resolved')
  // 6. human-agent handoff -> resolved (not silent)
  assert(classifyInbound({ contact_id: '6', text: 'x', at: OLD }, sig({ humanAgent: [{ contact_id: '6', at: OLD }] }), NOW, THRESH).disposition === 'human_agent_required', 'human_agent_is_resolved')
  // 7. deadletter recorded -> resolved (not silent)
  assert(classifyInbound({ contact_id: '7', text: 'x', at: OLD }, sig({ deadletter: [{ contact_id: '7', at: OLD }] }), NOW, THRESH).disposition === 'deadletter', 'deadletter_is_recorded')
  // 8. retry pending -> resolved (not silent)
  assert(classifyInbound({ contact_id: '8', text: 'x', at: OLD }, sig({ retries: [{ contact_id: '8', at: OLD }] }), NOW, THRESH).disposition === 'retry_pending', 'retry_is_resolved')
  // 9. no reply but RECENT (< threshold) -> pending, not yet flagged
  assert(classifyInbound({ contact_id: '9', text: 'x', at: RECENT }, sig({}), NOW, THRESH).disposition === 'pending', 'recent_inbound_not_yet_flagged')
  // 10. reply that arrived BEFORE the inbound does not count
  assert(classifyInbound({ contact_id: '10', text: 'x', at: OLD }, sig({ replies: [{ contact_id: '10', at: '2026-06-23T10:00:00.000Z' }] }), NOW, THRESH).disposition === 'silent_missing', 'earlier_reply_does_not_cover_later_inbound')
  checked += 10

  // ── batch summary ──
  const batch = scanFromData({
    now: NOW,
    thresholdMs: THRESH,
    inbounds: [
      { contact_id: 'a', text: 'cost?', at: OLD },
      { contact_id: 'b', text: 'hi', at: OLD },
      { contact_id: 'c', text: 'reel', at: OLD }
    ],
    signals: { replies: [{ contact_id: 'a', at: OLD }], quarantines: [{ contact_id: 'c', at: OLD }], humanAgent: [], deadletter: [], retries: [] }
  })
  assert(batch.summary.total === 3, 'batch_total')
  assert(batch.summary.silent_missing === 1 && batch.unresolved.length === 1, 'batch_one_silent')
  assert(batch.unresolved[0].contact_id === 'b', 'batch_silent_is_b')
  assert(typeof batch.unresolved[0].recommended_action === 'string' && batch.unresolved[0].recommended_action.length > 0, 'unresolved_has_recommended_action')
  checked += 4

  // ── file-level scan over a synthetic SCV_ROOT ──
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-missed-'))
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true })
  const raw = [
    { type: 'raw_inbound_received', at: OLD, body: { contact_id: '111', message_id: 'm1', instagram_username: 'replied_user', last_input_text: 'is there a cost?' } },
    { type: 'raw_inbound_received', at: OLD, body: { contact_id: '222', message_id: 'm2', instagram_username: 'silent_user', last_input_text: 'hello can i get more info' } },
    { type: 'raw_inbound_received', at: OLD, body: { contact_id: '333', message_id: 'm3', instagram_username: 'ha_user', last_input_text: 'weird text' } },
    { type: 'raw_inbound_received', at: RECENT, body: { contact_id: '444', message_id: 'm4', instagram_username: 'recent_user', last_input_text: 'just now' } }
  ]
  fs.writeFileSync(path.join(tmp, 'logs', 'inbound-raw.ndjson'), raw.map((r) => JSON.stringify(r)).join('\n') + '\n')
  fs.writeFileSync(path.join(tmp, 'logs', 'delivery-receipts.ndjson'), JSON.stringify({ at: OLD, contact_id: '111', message_id: 'm1', text: 'yeah there is a model rate' }) + '\n')
  fs.mkdirSync(path.join(tmp, 'outbox_human_agent_required'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'outbox_human_agent_required', 'ha.json'), JSON.stringify({ contact_id: '333', queued_for_human_agent_at: OLD }))

  const fileScan = scan({ root: tmp, now: NOW, thresholdMs: THRESH })
  assert(fileScan.summary.total === 4, 'file_total_4', JSON.stringify(fileScan.summary))
  assert(fileScan.summary.replied === 1, 'file_replied_1', JSON.stringify(fileScan.summary))
  assert(fileScan.summary.human_agent_required === 1, 'file_human_agent_1', JSON.stringify(fileScan.summary))
  assert(fileScan.summary.pending === 1, 'file_pending_1', JSON.stringify(fileScan.summary))
  assert(fileScan.summary.silent_missing === 1, 'file_silent_1', JSON.stringify(fileScan.summary))
  assert(fileScan.unresolved.length === 1 && fileScan.unresolved[0].contact_id === '222', 'file_silent_is_222', JSON.stringify(fileScan.unresolved))
  assert(fileScan.unresolved[0].instagram_username === 'silent_user', 'file_silent_has_username')
  assert(fileScan.unresolved[0].inbound_preview === 'hello can i get more info', 'file_silent_has_preview')
  checked += 8

  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }

  return { ok: true, checked }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvMissedInboundHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  }
}

module.exports = { runScvMissedInboundHarness }
