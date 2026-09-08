#!/usr/bin/env node
// Proves the in-service self-healing loop: every received-but-unanswered inbound is either
// re-enqueued for a reply or (after max retries) escalated to a human-agent handoff, while a
// paced/queued/replied/recent inbound is never touched (no double-sends).
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  needsRecovery, recoveryKey, runAutoRecoveryOnce
} = require(path.join(__dirname, 'scv-auto-recovery-loop.js'))

function assert(condition, label, detail = '') {
  if (!condition) { const e = new Error(`${label}${detail ? ` :: ${detail}` : ''}`); e.label = label; throw e }
}

const NOW = Date.parse('2026-06-23T12:00:00.000Z')
const THRESH = 60 * 60 * 1000
const OLD = '2026-06-23T10:00:00.000Z'      // 120 min ago (> threshold)
const RECENT = '2026-06-23T11:55:00.000Z'   // 5 min ago (< threshold)
const UNPAUSED_LOCAL_ENV = Object.freeze({
  RAILWAY_ENVIRONMENT_NAME: 'local',
  SCV_RELEASE_MODE: 'local',
  SCV_PAUSE_ALL: '0',
  SCV_PAUSE_NON_TEST: '0',
  SCV_PAUSE_DEBUG_ACCOUNTS: '0',
  SCV_AUTO_RECOVERY_CERTAIN_ONLY: '0'
})

function localRecoveryEnv(overrides = {}) {
  return { ...UNPAUSED_LOCAL_ENV, ...overrides }
}

function emptySignals(over) {
  return Object.assign({ replies: [], quarantines: [], humanAgent: [], deadletter: [], retries: [], inFlight: [] }, over)
}
function mkRoot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-autorec-'))
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true })
  return tmp
}
function writeRaw(root, records) {
  fs.writeFileSync(path.join(root, 'logs', 'inbound-raw.ndjson'), records.map((r) => JSON.stringify(r)).join('\n') + '\n')
}
function rawInbound(contact, mid, text, at) {
  return { type: 'raw_inbound_received', at, body: { contact_id: contact, message_id: mid, instagram_username: `${contact}_user`, last_input_text: text } }
}

function runHarness() {
  let checked = 0

  // ── needsRecovery unit logic ────────────────────────────────────────────────
  const ib = { contact_id: '1', message_id: 'm', text: 'hi', at: OLD }
  assert(needsRecovery(ib, emptySignals(), NOW, THRESH) === true, 'dropped_needs_recovery')
  assert(needsRecovery(ib, emptySignals({ replies: [{ contact_id: '1', at: OLD }] }), NOW, THRESH) === false, 'replied_no_recovery')
  assert(needsRecovery(ib, emptySignals({ inFlight: [{ contact_id: '1' }] }), NOW, THRESH) === false, 'in_flight_no_recovery')
  assert(needsRecovery(ib, emptySignals({ retries: [{ contact_id: '1' }] }), NOW, THRESH) === false, 'pending_inbox_no_recovery')
  assert(needsRecovery(ib, emptySignals({ humanAgent: [{ contact_id: '1', at: OLD }] }), NOW, THRESH) === false, 'human_agent_no_recovery')
  assert(needsRecovery({ contact_id: '1', message_id: 'm', text: 'hi', at: RECENT }, emptySignals(), NOW, THRESH) === false, 'recent_no_recovery')
  // a reply that arrived BEFORE this inbound does not cover it (still needs recovery)
  assert(needsRecovery(ib, emptySignals({ replies: [{ contact_id: '1', at: '2026-06-23T09:00:00.000Z' }] }), NOW, THRESH) === true, 'earlier_reply_still_needs_recovery')
  // a newer-turn reply (stale supersede) DOES cover it
  assert(needsRecovery(ib, emptySignals({ replies: [{ contact_id: '1', at: '2026-06-23T11:00:00.000Z' }] }), NOW, THRESH) === false, 'newer_turn_reply_covers_stale')
  checked += 8

  // A deployed staging process is intentionally PAUSE_ALL. Prove that the real
  // recovery loop holds rather than enqueueing before running the local enqueue
  // behavior checks below with an explicit, narrow unpaused harness env.
  const rootPaused = mkRoot()
  writeRaw(rootPaused, [rawInbound('777', 'm7', 'is there a cost?', OLD)])
  const paused = runAutoRecoveryOnce({
    root: rootPaused,
    now: NOW,
    thresholdMs: THRESH,
    maxRetries: 3,
    env: {
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      SCV_RELEASE_MODE: 'staging',
      SCV_PAUSE_ALL: '1',
      SCV_PAUSE_NON_TEST: '1'
    }
  })
  assert(
    paused.actions.some((action) => action.contact_id === '777' && action.action === 'human_agent_held_recovery_gate' && action.reason === 'recovery_paused_for_packet'),
    'staging_pause_holds_auto_recovery',
    JSON.stringify(paused.actions)
  )
  const pausedInbox = fs.existsSync(path.join(rootPaused, 'inbox')) ? fs.readdirSync(path.join(rootPaused, 'inbox')) : []
  assert(pausedInbox.length === 0, 'staging_pause_does_not_enqueue_auto_recovery', JSON.stringify(pausedInbox))
  checked += 2

  // ── full loop over a synthetic root (real enqueue path) ─────────────────────
  const root = mkRoot()
  writeRaw(root, [
    rawInbound('111', 'm1', 'is there a cost?', OLD),    // replied
    rawInbound('222', 'm2', 'hello can i get info', OLD), // DROPPED -> recover
    rawInbound('333', 'm3', 'a tattoo idea', OLD),        // in-flight (queued reply)
    rawInbound('444', 'm4', 'just now', RECENT)           // too recent
  ])
  fs.writeFileSync(path.join(root, 'logs', 'delivery-receipts.ndjson'), JSON.stringify({ contact_id: '111', at: '2026-06-23T10:30:00.000Z', text: 'yeah there is a rate' }) + '\n')
  fs.mkdirSync(path.join(root, 'outbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'outbox', 'queued.json'), JSON.stringify({ contact_id: '333', bubble: { text: 'queued reply waiting on pacing' } }))

  const r1 = runAutoRecoveryOnce({ root, now: NOW, thresholdMs: THRESH, maxRetries: 3, env: localRecoveryEnv() })
  const acted = Object.fromEntries(r1.actions.map((a) => [a.contact_id, a.action]))
  assert(r1.needs_recovery === 1, 'loop_one_needs_recovery', JSON.stringify(r1))
  assert(acted['222'] === 'reenqueued', 'dropped_222_reenqueued', JSON.stringify(r1.actions))
  assert(!acted['111'] && !acted['333'] && !acted['444'], 'others_untouched', JSON.stringify(r1.actions))
  // the recovery actually landed in the inbox for the worker to pick up
  const inboxFiles = fs.readdirSync(path.join(root, 'inbox'))
  assert(inboxFiles.some((f) => /^auto-recovery-222-/.test(f)), 'recovery_222_enqueued_to_inbox', JSON.stringify(inboxFiles))
  // ledger recorded it
  const ledger1 = fs.readFileSync(path.join(root, 'logs', 'auto-recovery-ledger.ndjson'), 'utf8')
  assert(/"action":"reenqueued"/.test(ledger1) && /"contact_id":"222"/.test(ledger1), 'ledger_recorded_reenqueue')
  checked += 5

  // ── dedup across ticks: 222 now has an inbox item -> not re-enqueued again ───
  const r2 = runAutoRecoveryOnce({ root, now: NOW + 1000, thresholdMs: THRESH, maxRetries: 3, env: localRecoveryEnv() })
  const acted2 = Object.fromEntries(r2.actions.map((a) => [a.contact_id, a.action]))
  assert(acted2['222'] !== 'reenqueued', 'no_double_enqueue_next_tick', JSON.stringify(r2.actions))
  checked += 1

  // ── Ben 2026-07-09: when releasing delayed backlog, do not force an answer if
  // the isolated old message has no reliable context. Hold uncertain stale turns
  // for human review; still recover clear tattoo/booking questions.
  const rootUncertain = mkRoot()
  writeRaw(rootUncertain, [rawInbound('555', 'm5', 'yes', OLD)])
  const uncertain = runAutoRecoveryOnce({
    root: rootUncertain,
    now: NOW,
    thresholdMs: THRESH,
    maxRetries: 3,
    env: localRecoveryEnv({ SCV_AUTO_RECOVERY_CERTAIN_ONLY: '1' })
  })
  const uncertainActed = Object.fromEntries(uncertain.actions.map((a) => [a.contact_id, a.action]))
  assert(uncertainActed['555'] === 'human_agent_held_uncertain', 'uncertain_backlog_held_for_human', JSON.stringify(uncertain.actions))
  const uncertainInbox = fs.existsSync(path.join(rootUncertain, 'inbox')) ? fs.readdirSync(path.join(rootUncertain, 'inbox')) : []
  assert(uncertainInbox.length === 0, 'uncertain_backlog_not_enqueued', JSON.stringify(uncertainInbox))
  const uncertainHa = fs.readdirSync(path.join(rootUncertain, 'outbox_human_agent_required'))
  assert(uncertainHa.some((f) => /^auto-recovery-escalation-555-/.test(f)), 'uncertain_backlog_human_agent_file', JSON.stringify(uncertainHa))

  const rootCertain = mkRoot()
  writeRaw(rootCertain, [rawInbound('666', 'm6', 'is there a cost?', OLD)])
  const certain = runAutoRecoveryOnce({
    root: rootCertain,
    now: NOW,
    thresholdMs: THRESH,
    maxRetries: 3,
    env: localRecoveryEnv({ SCV_AUTO_RECOVERY_CERTAIN_ONLY: '1' })
  })
  const certainActed = Object.fromEntries(certain.actions.map((a) => [a.contact_id, a.action]))
  assert(certainActed['666'] === 'reenqueued', 'certain_backlog_reenqueued', JSON.stringify(certain.actions))
  const certainInbox = fs.readdirSync(path.join(rootCertain, 'inbox'))
  assert(certainInbox.some((f) => /^auto-recovery-666-/.test(f)), 'certain_backlog_enqueued_to_inbox', JSON.stringify(certainInbox))
  checked += 6

  // ── retry exhaustion -> human-agent escalation (no infinite loop) ────────────
  const root2 = mkRoot()
  const dropped = rawInbound('999', 'm9', 'please reply to me', OLD)
  writeRaw(root2, [dropped])
  const key = recoveryKey({ contact_id: '999', message_id: 'm9', text: 'please reply to me', at: OLD })
  const seed = [1, 2, 3].map((n) => JSON.stringify({ at: OLD, recovery_key: key, action: 'reenqueued', contact_id: '999', attempt: n })).join('\n') + '\n'
  fs.writeFileSync(path.join(root2, 'logs', 'auto-recovery-ledger.ndjson'), seed)
  const r3 = runAutoRecoveryOnce({ root: root2, now: NOW, thresholdMs: THRESH, maxRetries: 3, env: localRecoveryEnv() })
  const acted3 = Object.fromEntries(r3.actions.map((a) => [a.contact_id, a.action]))
  assert(acted3['999'] === 'human_agent_escalated', 'exhausted_escalates_to_human_agent', JSON.stringify(r3.actions))
  const haFiles = fs.readdirSync(path.join(root2, 'outbox_human_agent_required'))
  assert(haFiles.some((f) => /^auto-recovery-escalation-999-/.test(f)), 'human_agent_file_written', JSON.stringify(haFiles))
  // a further tick does not re-escalate: the human-agent record now resolves the inbound
  const r4 = runAutoRecoveryOnce({ root: root2, now: NOW + 1000, thresholdMs: THRESH, maxRetries: 3, env: localRecoveryEnv() })
  assert(r4.needs_recovery === 0 && !r4.actions.some((a) => a.contact_id === '999'), 'no_double_escalation_resolved_by_human_agent', JSON.stringify(r4.actions))
  checked += 3

  try {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(root2, { recursive: true, force: true })
    fs.rmSync(rootPaused, { recursive: true, force: true })
    fs.rmSync(rootUncertain, { recursive: true, force: true })
    fs.rmSync(rootCertain, { recursive: true, force: true })
  } catch { /* ignore */ }
  return { ok: true, checked }
}

if (require.main === module) {
  try { console.log(JSON.stringify(runHarness(), null, 2)) }
  catch (err) { console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2)); process.exit(1) }
}

module.exports = { runHarness }
