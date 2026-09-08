#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  buildRecoveryPacket,
  recoveryAdmissionVerdict,
  writeRecoveryPacketToLocalPipeline
} = require(path.join(__dirname, 'scv-manychat-orphan-recovery.js'))
const {
  readBoundedRecoveryInbounds,
  latestRecoveryInboundPerContact,
  runAutoRecoveryOnce
} = require(path.join(__dirname, 'scv-auto-recovery-loop.js'))

function assert(condition, label, detail = '') {
  if (condition) return
  const error = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
  error.label = label
  throw error
}

function mkRoot(prefix = 'scv-recovery-producer-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  return root
}

function acceptedEnv(extra = {}) {
  return {
    SCV_RECOVERY_CUTOVER_AT: '2026-08-01T00:00:00.000Z',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    ...extra
  }
}

function candidate(contactId, messageId, interactionAt, text = 'can i get more info?') {
  return {
    contact_id: String(contactId),
    thread_id: String(contactId),
    message_id: messageId,
    instagram_username: `real_${contactId}`,
    text,
    source_interaction_at: interactionAt,
    at: '2026-08-10T12:00:00.000Z'
  }
}

function runHarness() {
  const roots = []
  let checked = 0
  try {
    const sourceAt = '2026-08-02T10:05:22.000Z'
    const packet = buildRecoveryPacket({
      id: '700000001',
      ig_username: 'real_customer',
      last_input_text: 'can i get more info?',
      ig_last_interaction: sourceAt
    }, { now: '2026-08-10T12:00:00.000Z' })
    assert(packet.source_interaction_at === sourceAt, 'manychat_source_interaction_preserved')
    assert(packet.manychat_latest_interaction_at === sourceAt, 'manychat_latest_interaction_preserved')
    checked += 2

    const admitted = recoveryAdmissionVerdict(packet, { env: acceptedEnv() })
    assert(admitted.hold === false && admitted.reason === 'recovery_admitted', 'post_cutover_admitted', JSON.stringify(admitted))
    const old = recoveryAdmissionVerdict(packet, {
      env: acceptedEnv({ SCV_RECOVERY_CUTOVER_AT: '2026-08-03T00:00:00.000Z' })
    })
    assert(old.hold === true && old.reason === 'recovery_ingress_before_cutover', 'pre_cutover_held', JSON.stringify(old))
    const unknown = recoveryAdmissionVerdict({ ...packet, source_interaction_at: '', manychat_latest_interaction_at: '', recovered_from_ig_last_interaction: '', recovered_from_at: '', received_at: '' }, {
      env: acceptedEnv()
    })
    assert(unknown.hold === true && unknown.reason === 'recovery_ingress_time_unknown', 'unknown_time_held', JSON.stringify(unknown))
    const invalid = recoveryAdmissionVerdict(packet, { env: acceptedEnv({ SCV_RECOVERY_CUTOVER_AT: 'not-a-time' }) })
    assert(invalid.hold === true && invalid.reason === 'recovery_cutover_invalid', 'invalid_cutover_fail_closed', JSON.stringify(invalid))
    const missingProd = recoveryAdmissionVerdict(packet, {
      env: acceptedEnv({ SCV_RECOVERY_CUTOVER_AT: '', RAILWAY_ENVIRONMENT_NAME: 'production' })
    })
    assert(missingProd.hold === true && missingProd.reason === 'recovery_cutover_missing_production', 'production_missing_cutover_fail_closed', JSON.stringify(missingProd))
    const paused = recoveryAdmissionVerdict(packet, { env: acceptedEnv({ SCV_PAUSE_ALL: '1' }) })
    assert(paused.hold === true && paused.reason === 'recovery_paused_for_packet', 'pause_gate_holds_recovery', JSON.stringify(paused))
    checked += 6

    const holdRoot = mkRoot('scv-recovery-hold-')
    roots.push(holdRoot)
    const heldWrite = writeRecoveryPacketToLocalPipeline(holdRoot, packet, {
      env: acceptedEnv({ SCV_RECOVERY_CUTOVER_AT: '2026-08-03T00:00:00.000Z' }),
      now: Date.parse('2026-08-10T12:00:00.000Z')
    })
    assert(heldWrite.held === true && fs.existsSync(heldWrite.human_agent_file), 'pre_cutover_written_to_human_hold')
    assert(!fs.existsSync(path.join(holdRoot, 'thread-state')), 'pre_cutover_does_not_mutate_thread_state')
    assert(!fs.existsSync(path.join(holdRoot, 'thread-history')), 'pre_cutover_does_not_mutate_thread_history')
    assert(!fs.existsSync(path.join(holdRoot, 'inbox')), 'pre_cutover_does_not_touch_inbox')
    checked += 4

    const admittedRoot = mkRoot('scv-recovery-admitted-')
    roots.push(admittedRoot)
    const admittedWrite = writeRecoveryPacketToLocalPipeline(admittedRoot, packet, { env: acceptedEnv() })
    assert(admittedWrite.skipped === false && fs.existsSync(admittedWrite.inbox_file), 'post_cutover_enqueued')
    const state = JSON.parse(fs.readFileSync(admittedWrite.thread_state_file, 'utf8'))
    const history = JSON.parse(fs.readFileSync(admittedWrite.thread_history_file, 'utf8'))
    assert(state.source_interaction_at === sourceAt && state.manychat_latest_interaction_at === sourceAt, 'source_times_preserved_in_state')
    assert(state.latest_ingress_at === sourceAt, 'state_latest_ingress_uses_immutable_source', state.latest_ingress_at)
    assert(history.events[0].at === sourceAt, 'history_uses_immutable_source', history.events[0].at)
    checked += 4

    const auditRoot = mkRoot('scv-recovery-audit-')
    roots.push(auditRoot)
    const auditRows = [
      { type: 'raw_inbound_received', at: '2026-08-10T12:00:00.000Z', redacted: true, message_id: 'redacted', body_sha256: 'a'.repeat(64) },
      { type: 'raw_inbound_received', at: '2026-08-10T12:00:00.000Z', contact_id_hash: 'b'.repeat(64) },
      { type: 'raw_inbound_received', at: '2026-08-10T12:00:00.000Z', body: { contact_id: '8001', message_id: 'old', instagram_username: 'one', text: 'old text', source_interaction_at: '2026-08-02T01:00:00.000Z' } },
      { type: 'raw_inbound_received', at: '2026-08-10T12:00:01.000Z', body: { contact_id: '8001', message_id: 'latest', instagram_username: 'one', text: 'latest text', source_interaction_at: '2026-08-03T01:00:00.000Z' } },
      { type: 'raw_inbound_received', at: '2026-08-10T12:00:02.000Z', body: { contact_id: '8002', message_id: 'other', instagram_username: 'two', text: 'other text', source_interaction_at: '2026-08-04T01:00:00.000Z' } }
    ]
    fs.writeFileSync(path.join(auditRoot, 'logs', 'inbound-raw.ndjson'), auditRows.map((row) => JSON.stringify(row)).join('\n') + '\n')
    const readable = readBoundedRecoveryInbounds(auditRoot)
    assert(readable.length === 3 && readable.every((row) => row.message_id !== 'redacted'), 'redacted_audit_never_candidate', JSON.stringify(readable))
    const latest = latestRecoveryInboundPerContact(readable)
    assert(latest.length === 2 && latest.some((row) => row.message_id === 'latest') && !latest.some((row) => row.message_id === 'old'), 'latest_only_per_contact')

    const enqueued = []
    const tick = runAutoRecoveryOnce({
      root: auditRoot,
      now: Date.parse('2026-08-10T12:00:00.000Z'),
      thresholdMs: 60 * 60 * 1000,
      env: acceptedEnv(),
      enqueueFn: (_root, nextPacket) => {
        enqueued.push(nextPacket)
        return { ok: true, skipped: false }
      }
    })
    assert(tick.latest_contact_candidates === 2, 'tick_latest_contact_count', JSON.stringify(tick))
    assert(tick.enqueue_attempts === 1 && enqueued.length === 1, 'default_one_enqueue_per_tick', JSON.stringify(tick))
    assert(enqueued[0].recovered_from_message_id === 'other', 'newest_contact_first', JSON.stringify(enqueued))
    assert(tick.actions.some((action) => action.action === 'deferred_tick_enqueue_cap'), 'second_contact_deferred_by_cap', JSON.stringify(tick.actions))
    checked += 6

    const gateRoot = mkRoot('scv-recovery-auto-gate-')
    roots.push(gateRoot)
    let unsafeEnqueueCalls = 0
    const gatedTick = runAutoRecoveryOnce({
      root: gateRoot,
      now: Date.parse('2026-08-10T12:00:00.000Z'),
      thresholdMs: 60 * 60 * 1000,
      env: acceptedEnv({ SCV_RECOVERY_CUTOVER_AT: '2026-08-05T00:00:00.000Z' }),
      inbounds: [candidate('9001', 'pre-cutover', '2026-08-02T00:00:00.000Z')],
      enqueueFn: () => { unsafeEnqueueCalls += 1; return { ok: true } }
    })
    assert(unsafeEnqueueCalls === 0, 'auto_gate_runs_before_enqueue')
    assert(gatedTick.actions[0]?.action === 'human_agent_held_recovery_gate', 'auto_pre_cutover_human_hold', JSON.stringify(gatedTick))
    assert(!fs.existsSync(path.join(gateRoot, 'thread-state')), 'auto_pre_cutover_no_thread_state')
    assert(fs.readdirSync(path.join(gateRoot, 'outbox_human_agent_required')).length === 1, 'auto_pre_cutover_hold_persisted')
    checked += 4

    return { ok: true, checked }
  } finally {
    for (const root of roots) {
      try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
    }
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      error: String(err?.message || err),
      label: String(err?.label || '')
    }, null, 2))
    process.exit(1)
  }
}

module.exports = { runHarness }
