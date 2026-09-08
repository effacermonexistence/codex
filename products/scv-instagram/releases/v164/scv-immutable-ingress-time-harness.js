#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  IMMUTABLE_INGRESS_TIME_FIELDS,
  immutableIngressTimestamp,
  immutableIngressTimeMs,
  recoveryCutoverVerdict,
  recoveryQueueSafetyVerdict
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))

function assert(condition, label, detail = '') {
  if (!condition) {
    const error = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    error.label = label
    throw error
  }
}

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-immutable-ingress-'))
  for (const dir of ['inbox', 'outbox', 'reactbox', 'outbox_human_agent_required']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true })
  }
  return root
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  return file
}

function reloadForRoot(root, name) {
  process.env.SCV_ROOT = root
  const target = path.join(__dirname, name)
  delete require.cache[require.resolve(target)]
  return require(target)
}

function onlyHeldPayload(root) {
  const dir = path.join(root, 'outbox_human_agent_required')
  const names = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  assert(names.length === 1, 'exactly_one_human_hold', JSON.stringify(names))
  return JSON.parse(fs.readFileSync(path.join(dir, names[0]), 'utf8'))
}

function assertFinalPauseGateBeforeSideEffect(filename, pauseMarker, sideEffectMarker) {
  const source = fs.readFileSync(path.join(__dirname, filename), 'utf8')
  const sideEffectIndex = source.indexOf(sideEffectMarker)
  const pauseIndex = source.lastIndexOf(pauseMarker, sideEffectIndex)
  assert(sideEffectIndex > 0, `${filename}_side_effect_marker_present`)
  assert(pauseIndex > 0 && pauseIndex < sideEffectIndex, `${filename}_final_pause_gate_precedes_side_effect`)
}

function runHarness() {
  let checked = 0
  const roots = []
  const now = Date.parse('2026-04-21T12:00:00.000Z')
  const cutoverAt = '2026-04-20T12:00:00.000Z'
  const beforeCutover = '2026-04-20T11:59:59.000Z'
  const freshAfterCutover = '2026-04-21T11:59:00.000Z'
  const staleAfterCutover = '2026-04-21T10:00:00.000Z'
  const env = {
    SCV_RECOVERY_CUTOVER_AT: cutoverAt,
    SCV_HOLD_STALE_BACKLOG_MS: String(15 * 60 * 1000),
    SCV_STALE_LOCK_RECOVERY_MS: String(15 * 60 * 1000),
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0'
  }

  try {
    assert(
      IMMUTABLE_INGRESS_TIME_FIELDS.join(',') === [
        'source_interaction_at',
        'recovered_from_ig_last_interaction',
        'manychat_latest_interaction_at',
        'recovered_from_at',
        'received_at',
        'at',
        'queued_at',
        'created_at'
      ].join(','),
      'immutable_priority_contract_exact'
    )
    checked += 1

    const priorityPacket = {
      source_interaction_at: '2026-04-01T00:00:00.000Z',
      recovered_from_ig_last_interaction: '2026-04-08T00:00:00.000Z',
      manychat_latest_interaction_at: '2026-04-07T00:00:00.000Z',
      recovered_from_at: '2026-04-06T00:00:00.000Z',
      received_at: '2026-04-05T00:00:00.000Z',
      at: '2026-04-04T00:00:00.000Z',
      queued_at: '2026-04-03T00:00:00.000Z',
      created_at: '2026-04-02T00:00:00.000Z',
      updated_at: '2099-01-01T00:00:00.000Z'
    }
    const priority = immutableIngressTimestamp(priorityPacket)
    assert(priority.source === 'source_interaction_at', 'first_valid_priority_source_wins', JSON.stringify(priority))
    assert(priority.timestamp_ms === Date.parse(priorityPacket.source_interaction_at), 'first_valid_priority_time_wins')
    checked += 2

    const fallbackRoot = mkRoot()
    roots.push(fallbackRoot)
    const fallbackFile = writeJson(path.join(fallbackRoot, 'mtime.json'), { updated_at: '2099-01-01T00:00:00.000Z' })
    const mtime = new Date('2026-04-02T03:04:05.000Z')
    fs.utimesSync(fallbackFile, mtime, mtime)
    const fallback = immutableIngressTimestamp({ updated_at: '2099-01-01T00:00:00.000Z' }, fallbackFile)
    assert(fallback.source === 'file_mtime', 'updated_at_never_used_as_ingress_time', JSON.stringify(fallback))
    assert(Math.abs(immutableIngressTimeMs({ updated_at: '2099-01-01T00:00:00.000Z' }, fallbackFile) - mtime.getTime()) < 2, 'file_mtime_is_last_fallback')
    checked += 2

    const pre = recoveryCutoverVerdict({ source_interaction_at: beforeCutover }, env)
    const atCutover = recoveryCutoverVerdict({ source_interaction_at: cutoverAt }, env)
    const unknown = recoveryCutoverVerdict({}, env)
    const invalid = recoveryCutoverVerdict({ source_interaction_at: freshAfterCutover }, { SCV_RECOVERY_CUTOVER_AT: 'not-a-time' })
    assert(pre.hold && pre.reason === 'recovery_ingress_before_cutover', 'pre_cutover_fail_closed', JSON.stringify(pre))
    assert(!atCutover.hold, 'at_cutover_allowed', JSON.stringify(atCutover))
    assert(unknown.hold && unknown.reason === 'recovery_ingress_time_unknown', 'unknown_time_fail_closed', JSON.stringify(unknown))
    assert(invalid.hold && invalid.reason === 'recovery_cutover_invalid', 'invalid_cutover_fail_closed', JSON.stringify(invalid))
    checked += 4

    const staleDebug = recoveryQueueSafetyVerdict({
      instagram_username: 'omar.system',
      source_interaction_at: staleAfterCutover,
      updated_at: freshAfterCutover
    }, env, undefined, now, 15 * 60 * 1000)
    assert(staleDebug.hold && staleDebug.reason === 'stale_backlog_over_threshold', 'debug_has_no_stale_bypass', JSON.stringify(staleDebug))
    checked += 1

    const future = recoveryQueueSafetyVerdict({
      source_interaction_at: new Date(now + (6 * 60 * 1000)).toISOString()
    }, env, undefined, now, 15 * 60 * 1000)
    assert(future.hold && future.reason === 'immutable_ingress_time_in_future', 'future_ingress_time_fail_closed', JSON.stringify(future))
    checked += 1

    const inboxRoot = mkRoot()
    roots.push(inboxRoot)
    const inbox = reloadForRoot(inboxRoot, 'inbox-worker.js')
    writeJson(path.join(inboxRoot, 'inbox', 'clear-stale.json'), {
      contact_id: 'real-1',
      thread_id: 'real-1',
      instagram_username: 'clear_real_lead',
      message_id: 'clear-stale',
      text: 'is there a cost?',
      source_interaction_at: staleAfterCutover,
      updated_at: freshAfterCutover
    })
    assert(inbox.listDueInboxFiles({ env, now }).length === 0, 'clear_stale_inbox_not_due')
    const inboxHeld = onlyHeldPayload(inboxRoot)
    assert(inboxHeld.text === 'is there a cost?' && inboxHeld.message_id === 'clear-stale', 'inbox_hold_preserves_payload')
    assert(inboxHeld.manual_reason === 'stale_backlog_over_threshold', 'clear_intent_has_no_stale_bypass', inboxHeld.manual_reason)

    const authorizedRecovery = {
      contact_id: 'operator-recovery-contact',
      thread_id: 'operator-recovery-contact',
      instagram_username: 'omar.system',
      message_id: 'verified-stale-recovery',
      recovered_from_message_id: 'verified-stale-recovery',
      text: 'can I get more information?',
      source_interaction_at: staleAfterCutover,
      operator_recovery: true,
      operator_recovery_reason: 'verified_control_plane_repair',
      operator_recovery_lock_version: 'scv-verified-stale-operator-recovery-lock-v1',
      operator_recovery_at: new Date(now).toISOString()
    }
    const authorizedRecoveryFile = path.join(inboxRoot, 'inbox', 'verified-stale-recovery.json')
    writeJson(authorizedRecoveryFile, authorizedRecovery)
    const authorizedVerdict = inbox.shouldHoldStaleBacklogPacket(authorizedRecovery, authorizedRecoveryFile, env, now)
    assert(!authorizedVerdict.hold && authorizedVerdict.reason === 'verified_stale_operator_recovery_admitted', 'verified_operator_recovery_admitted', JSON.stringify(authorizedVerdict))

    const forgedRecovery = { ...authorizedRecovery, operator_recovery_lock_version: 'wrong-lock' }
    const forgedVerdict = inbox.shouldHoldStaleBacklogPacket(forgedRecovery, authorizedRecoveryFile, env, now)
    assert(forgedVerdict.hold && forgedVerdict.reason === 'stale_backlog_over_threshold', 'forged_operator_recovery_fail_closed', JSON.stringify(forgedVerdict))

    const expiredRecovery = { ...authorizedRecovery, operator_recovery_at: new Date(now - (6 * 60 * 1000)).toISOString() }
    const expiredVerdict = inbox.shouldHoldStaleBacklogPacket(expiredRecovery, authorizedRecoveryFile, env, now)
    assert(expiredVerdict.hold && expiredVerdict.reason === 'stale_backlog_over_threshold', 'expired_operator_recovery_fail_closed', JSON.stringify(expiredVerdict))
    const inboxPauseLock = writeJson(path.join(inboxRoot, 'inbox', 'pause-preserve.json.lock'), {
      contact_id: 'pause-inbox',
      message_id: 'pause-inbox-message',
      text: 'preserve paused inbound',
      source_interaction_at: freshAfterCutover
    })
    inbox.releaseInboxLockForPause(inboxPauseLock, JSON.parse(fs.readFileSync(inboxPauseLock, 'utf8')))
    const inboxPauseOriginal = inboxPauseLock.replace(/\.lock$/, '')
    assert(fs.existsSync(inboxPauseOriginal), 'inbox_final_pause_requeues_original')
    assert(JSON.parse(fs.readFileSync(inboxPauseOriginal, 'utf8')).text === 'preserve paused inbound', 'inbox_final_pause_preserves_payload')
    checked += 8

    const debugRoot = mkRoot()
    roots.push(debugRoot)
    const debugInbox = reloadForRoot(debugRoot, 'inbox-worker.js')
    writeJson(path.join(debugRoot, 'inbox', 'debug-stale.json'), {
      contact_id: '1537753982',
      thread_id: '1537753982',
      instagram_username: 'omar.system',
      message_id: 'debug-stale',
      text: 'yes',
      source_interaction_at: staleAfterCutover
    })
    assert(debugInbox.listDueInboxFiles({ env, now }).length === 0, 'debug_stale_inbox_not_due')
    assert(onlyHeldPayload(debugRoot).message_id === 'debug-stale', 'debug_stale_inbox_human_held')
    checked += 2

    const outboxRoot = mkRoot()
    roots.push(outboxRoot)
    const outbox = reloadForRoot(outboxRoot, 'outbox-worker.js')
    let fetchCalls = 0
    const priorFetch = global.fetch
    global.fetch = async () => { fetchCalls += 1; throw new Error('unexpected_network_side_effect') }
    writeJson(path.join(outboxRoot, 'outbox', 'pre-cutover.json'), {
      contact_id: 'real-2',
      thread_id: 'real-2',
      instagram_username: 'pre_cutover_lead',
      message_id: 'pre-cutover',
      source_interaction_at: beforeCutover,
      queued_at: freshAfterCutover,
      bubble: { text: 'preserve this exact reply' }
    })
    assert(outbox.listFiles({ env, now }).length === 0, 'pre_cutover_outbox_not_due')
    const outboxHeld = onlyHeldPayload(outboxRoot)
    assert(outboxHeld.bubble.text === 'preserve this exact reply', 'outbox_hold_preserves_payload')
    assert(outboxHeld.manual_reason === 'recovery_ingress_before_cutover', 'outbox_uses_source_interaction_not_fresh_queue_time', outboxHeld.manual_reason)
    assert(fetchCalls === 0, 'outbox_hold_has_no_network_send')
    const outboxPauseLock = writeJson(path.join(outboxRoot, 'outbox', 'pause-preserve.json.lock'), {
      contact_id: 'pause-outbox',
      message_id: 'pause-outbox-message',
      bubble: { text: 'preserve paused outbound' },
      source_interaction_at: freshAfterCutover
    })
    outbox.releaseOutboxLockForPause(outboxPauseLock, JSON.parse(fs.readFileSync(outboxPauseLock, 'utf8')))
    const outboxPauseOriginal = outboxPauseLock.replace(/\.lock$/, '')
    assert(fs.existsSync(outboxPauseOriginal), 'outbox_final_pause_requeues_original')
    assert(JSON.parse(fs.readFileSync(outboxPauseOriginal, 'utf8')).bubble.text === 'preserve paused outbound', 'outbox_final_pause_preserves_payload')
    const authorizedOutboxRecovery = {
      ...authorizedRecovery,
      bubble: { text: 'preserve and send this verified reply' },
      queued_at: freshAfterCutover
    }
    const authorizedOutboxVerdict = outbox.outboxRecoverySafetyVerdict(
      authorizedOutboxRecovery,
      path.join(outboxRoot, 'outbox', 'verified-stale-recovery-0.json'),
      env,
      now
    )
    assert(
      !authorizedOutboxVerdict.hold && authorizedOutboxVerdict.reason === 'verified_stale_operator_recovery_admitted_outbound',
      'verified_operator_recovery_survives_outbox_stale_gate',
      JSON.stringify(authorizedOutboxVerdict)
    )
    const expiredOutboxVerdict = outbox.outboxRecoverySafetyVerdict(
      { ...authorizedOutboxRecovery, operator_recovery_at: new Date(now - (6 * 60 * 1000)).toISOString() },
      path.join(outboxRoot, 'outbox', 'verified-stale-recovery-expired-0.json'),
      env,
      now
    )
    assert(
      expiredOutboxVerdict.hold && expiredOutboxVerdict.reason === 'stale_backlog_over_threshold',
      'expired_operator_recovery_fails_closed_at_outbox',
      JSON.stringify(expiredOutboxVerdict)
    )
    global.fetch = priorFetch
    checked += 8

    const reactionRoot = mkRoot()
    roots.push(reactionRoot)
    const reaction = reloadForRoot(reactionRoot, 'reaction-worker.js')
    writeJson(path.join(reactionRoot, 'reactbox', 'old-reaction.json'), {
      contact_id: 'real-3',
      thread_id: 'real-3',
      instagram_username: 'reaction_lead',
      message_id: 'old-reaction',
      text: 'preserve reaction target',
      emoji: '❤️',
      source_interaction_at: staleAfterCutover,
      due_at: freshAfterCutover
    })
    assert(reaction.listDueFiles({ env, now }).length === 0, 'stale_reaction_not_due')
    const reactionHeld = onlyHeldPayload(reactionRoot)
    assert(reactionHeld.text === 'preserve reaction target' && reactionHeld.emoji === '❤️', 'reaction_hold_preserves_payload')
    assert(reactionHeld.manual_reason === 'stale_backlog_over_threshold', 'reaction_stale_fail_closed', reactionHeld.manual_reason)
    const reactionPauseLock = writeJson(path.join(reactionRoot, 'reactbox', 'pause-preserve.json.lock'), {
      contact_id: 'pause-reaction',
      message_id: 'pause-reaction-message',
      text: 'preserve paused reaction',
      emoji: '💜',
      source_interaction_at: freshAfterCutover
    })
    reaction.releaseReactionLockForPause(reactionPauseLock, JSON.parse(fs.readFileSync(reactionPauseLock, 'utf8')))
    const reactionPauseOriginal = reactionPauseLock.replace(/\.lock$/, '')
    assert(fs.existsSync(reactionPauseOriginal), 'reaction_final_pause_requeues_original')
    assert(JSON.parse(fs.readFileSync(reactionPauseOriginal, 'utf8')).emoji === '💜', 'reaction_final_pause_preserves_payload')
    checked += 5

    assertFinalPauseGateBeforeSideEffect('inbox-worker.js', 'if (isPausedForPacket(msg, process.env))', 'const result = await post3101(')
    assertFinalPauseGateBeforeSideEffect('outbox-worker.js', 'if (isPausedForPacket(packet, process.env))', 'const result = await sendTo3102(packet)')
    assertFinalPauseGateBeforeSideEffect('reaction-worker.js', 'if (isPausedForPacket(job, process.env))', 'client.sendReaction(')
    checked += 3

    const outbound1Source = fs.readFileSync(path.join(__dirname, 'outbound-scv1.js'), 'utf8')
    assert(
      ['source_interaction_at', 'recovered_from_ig_last_interaction', 'manychat_latest_interaction_at', 'recovered_from_at']
        .every((field) => outbound1Source.includes(`${field}: String(body.${field} || '')`)),
      'outbound_queue_preserves_immutable_ingress_fields'
    )
    assert(
      ['operator_recovery_reason', 'operator_recovery_at', 'recovered_from_message_id']
        .every((field) => outbound1Source.includes(`${field}: String(body.${field} || '')`)),
      'outbound_queue_preserves_verified_operator_recovery_envelope'
    )
    checked += 2

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
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      label: String(error?.label || ''),
      error: String(error?.message || error)
    }, null, 2))
    process.exit(1)
  }
}

module.exports = { runHarness }
