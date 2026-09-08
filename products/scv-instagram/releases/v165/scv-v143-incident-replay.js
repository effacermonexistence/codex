#!/usr/bin/env node
'use strict'
// Executed-path replay of the 2026-09-03 Omar.system incident state through the
// REAL control plane and the REAL spawned runner, in a fresh process so every
// module (dm-authority's history loader included) binds SCV_ROOT to the replay
// root exactly as production binds it at boot.
//   node scv-v143-incident-replay.js <fixture.json>   -> JSON result on stdout
const fs = require('fs')
const os = require('os')
const path = require('path')
const TREE = __dirname
const fixturePath = process.argv[2]
if (!fixturePath) throw new Error('usage: scv-v143-incident-replay.js <fixture.json>')
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
const replayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v143-incident-replay-'))
const skip = new Set(['thread-state', 'thread-history', 'inbox', 'outbox', 'logs', 'control-decisions', 'control-events', 'control-locks', 'form-submissions'])
for (const name of fs.readdirSync(TREE)) {
  if (name.startsWith('.') || skip.has(name) || /_quarantine_/.test(name)) continue
  try { fs.symlinkSync(path.join(TREE, name), path.join(replayRoot, name)) } catch {}
}
process.env.SCV_ROOT = replayRoot
process.env.SCV_RELEASE_PROTOCOL = process.env.SCV_RELEASE_PROTOCOL || 'single_release_v1'
const { ensureControlDirs, appendControlHistoryEvent, recordIngressEvent, executeSingleControlTurn } = require(path.join(TREE, 'scv-single-control-plane.js'))
try {
  ensureControlDirs(replayRoot)
  const thread = String(fixture.seed_state.thread_id || fixture.seed_state.contact_id || '1537753982')
  const seed = { ...fixture.seed_state }
  for (const key of Object.keys(seed)) {
    if (/^(control_|ingress_|last_control_|latest_|last_inbound|openai_)/.test(key) || /message_id/.test(key) || /^legacy-manychat-/.test(String(seed[key] || ''))) delete seed[key]
  }
  fs.writeFileSync(path.join(replayRoot, 'thread-state', `${thread}.json`), `${JSON.stringify(seed, null, 2)}\n`)
  let clock = Date.parse('2026-09-03T02:54:00.000Z')
  const tick = () => { clock += 4000; return new Date(clock).toISOString() }
  for (const event of fixture.history_before_live_turn) {
    if (event.role === 'user') appendControlHistoryEvent(replayRoot, { contact_id: thread, thread_id: thread, message_id: event.message_id, text: event.text }, 'user', { at: tick() })
    else appendControlHistoryEvent(replayRoot, { contact_id: thread, thread_id: thread, message_id: event.message_id, bubble_index: 0, bubble_count: 1, bubble: { text: event.text } }, 'assistant', { at: tick(), delivery_status: 'verified' })
  }
  const runReal = (id, text) => {
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: id, text, received_at: tick() }
    recordIngressEvent(replayRoot, inbound)
    const result = executeSingleControlTurn(inbound, { root: replayRoot })
    const state = result.structured_state || {}
    return {
      visible: String(result.packet?.reply_text || ''),
      bubbles: (Array.isArray(result.packet?.bubbles) ? result.packet.bubbles : []).map((item) => String(item.text || '')),
      action: String(result.authority?.closed_transition_action || ''),
      reason: String(result.authority?.closed_transition_reason || ''),
      executor: String(result.authority?.candidate_authority?.executor || ''),
      passes: Number(result.authority?.control_candidate_passes || 0),
      recovery: result.authority?.control_route_aware_visible_recovery === true,
      state: {
        double_check_sent: state.double_check_sent,
        checkpoint_superseded_by_revision: state.checkpoint_superseded_by_revision,
        live_turn_checkpoint_invalidated: state.live_turn_checkpoint_invalidated,
        booking_stage_hint: state.booking_stage_hint,
        deposit_requested: state.deposit_requested
      },
      runner_history_loaded_from_replay_root: fs.existsSync(path.join(replayRoot, 'thread-history', `${thread}.json`))
    }
  }
  const info = runReal('v143-rr-info', fixture.live_text)
  const confirm = runReal('v143-rr-yes', 'yes that is all correct')
  process.stdout.write(`${JSON.stringify({ ok: true, info, confirm })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error).slice(0, 600) })}\n`)
  process.exitCode = 1
} finally {
  fs.rmSync(replayRoot, { recursive: true, force: true })
}
