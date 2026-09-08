#!/usr/bin/env node
// Proves the unpause safety gate Ben added on 2026-07-09:
// stale backlog is never blindly answered, even when intent is clear or the
// packet belongs to the debug account.
const fs = require('fs')
const crypto = require('crypto')
const os = require('os')
const path = require('path')
const { recordIngressEvent } = require('./scv-single-control-plane.js')
const {
  VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION
} = require('./scv-immutable-ingress-time.js')

function assert(condition, label, detail = '') {
  if (!condition) { const e = new Error(`${label}${detail ? ` :: ${detail}` : ''}`); e.label = label; throw e }
}

function mkRoot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-stale-backlog-'))
  fs.mkdirSync(path.join(tmp, 'inbox'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'outbox'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'thread-history'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'outbox_human_agent_required'), { recursive: true })
  return tmp
}

function writeInbox(root, name, packet) {
  const file = path.join(root, 'inbox', name)
  fs.writeFileSync(file, JSON.stringify(packet, null, 2) + '\n')
  return file
}

function writeOutbox(root, name, packet) {
  const file = path.join(root, 'outbox', name)
  fs.writeFileSync(file, JSON.stringify(packet, null, 2) + '\n')
  return file
}

function makeFileOld(file, iso) {
  const ts = new Date(iso)
  fs.utimesSync(file, ts, ts)
}

function loadWorkerForRoot(root) {
  process.env.SCV_ROOT = root
  const workerPath = path.join(__dirname, 'inbox-worker.js')
  delete require.cache[require.resolve(workerPath)]
  return require(workerPath)
}

function loadOutboxWorkerForRoot(root) {
  process.env.SCV_ROOT = root
  const workerPath = path.join(__dirname, 'outbox-worker.js')
  delete require.cache[require.resolve(workerPath)]
  return require(workerPath)
}

function runHarness() {
  let checked = 0
  const machineLogs = []
  const originalConsoleLog = console.log
  console.log = (...args) => { machineLogs.push(args.map(String).join(' ')) }
  const now = Date.parse('2026-07-09T12:00:00.000Z')
  const old = '2026-07-09T11:00:00.000Z'
  const fresh = '2026-07-09T11:59:00.000Z'
  const debugFresh = '2026-07-09T11:58:00.000Z'
  const env = {
    SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE: '1',
    SCV_HOLD_STALE_BACKLOG_MS: String(15 * 60 * 1000),
    SCV_PAUSE_NON_TEST: '0',
    SCV_PAUSE_ALL: '0',
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982'
  }

  const inboxSource = fs.readFileSync(path.join(__dirname, 'inbox-worker.js'), 'utf8')
  const listDueSource = inboxSource.slice(
    inboxSource.indexOf('function listDueInboxFiles'),
    inboxSource.indexOf('function lockPath')
  )
  assert(
    listDueSource.indexOf('const superseded = sweepSupersededInboxFiles()') <
      listDueSource.indexOf('const recoveredLatest = recoverAuthoritativeLatestSupersededInboxFiles()'),
    'existing_inbox_is_swept_before_authoritative_recovery_admission'
  )
  checked += 1

  const root0 = mkRoot()
  const worker0 = loadWorkerForRoot(root0)
  const verifiedRecoveryAt = new Date(now).toISOString()
  const verifiedRecovery = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message_id: 'verified-authoritative-recovery-message',
    text: 'Hi, can I please get more information?',
    source_interaction_at: old,
    received_at: old,
    operator_recovery: true,
    operator_recovery_lock_version: VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION,
    operator_recovery_reason: 'verified_control_plane_repair',
    operator_recovery_at: verifiedRecoveryAt,
    recovered_from_message_id: 'verified-authoritative-recovery-message',
    recovered_via: 'known_omar_info_hold_exact_target_v134'
  }
  recordIngressEvent(root0, verifiedRecovery)
  const superseded0 = path.join(root0, 'inbox_quarantine_superseded')
  fs.mkdirSync(superseded0, { recursive: true })
  fs.writeFileSync(
    path.join(superseded0, `${verifiedRecovery.message_id}.json`),
    `${JSON.stringify({
      ...verifiedRecovery,
      superseded_inbox: true,
      quarantined_at: verifiedRecoveryAt
    }, null, 2)}\n`
  )
  const due0 = worker0.listDueInboxFiles({ env, now })
  assert(
    due0.length === 1 && path.basename(due0[0]) === `${verifiedRecovery.message_id}.json`,
    'verified_authoritative_recovery_reaches_admission_in_same_tick',
    JSON.stringify(due0)
  )
  assert(
    fs.readdirSync(path.join(root0, 'outbox_human_agent_required')).length === 0,
    'verified_authoritative_recovery_not_repeat_fused_before_admission'
  )
  const syntheticVerdict0 = worker0.syntheticRecoveryVerdict(verifiedRecovery, now)
  assert(
    syntheticVerdict0.accept === true &&
      syntheticVerdict0.reason === 'verified_stale_operator_recovery_exact_debug_identity',
    'verified_exact_debug_recovery_survives_synthetic_source_gate',
    JSON.stringify(syntheticVerdict0)
  )
  const forgedSyntheticVerdict0 = worker0.syntheticRecoveryVerdict({
    ...verifiedRecovery,
    contact_id: 'not-the-debug-contact',
    thread_id: 'not-the-debug-contact'
  }, now)
  assert(
    forgedSyntheticVerdict0.accept === false,
    'verified_recovery_envelope_cannot_expand_to_non_debug_identity',
    JSON.stringify(forgedSyntheticVerdict0)
  )
  checked += 4

  const root1 = mkRoot()
  const worker1 = loadWorkerForRoot(root1)
  writeInbox(root1, 'ambiguous-old.json', {
    contact_id: '111',
    thread_id: '111',
    instagram_username: 'real_lead',
    message_id: 'm1',
    text: 'yes',
    received_at: old
  })
  const due1 = worker1.listDueInboxFiles({ env, now })
  assert(due1.length === 0, 'ambiguous_stale_backlog_not_due', JSON.stringify(due1))
  assert(!fs.existsSync(path.join(root1, 'inbox', 'ambiguous-old.json')), 'ambiguous_stale_backlog_removed_from_inbox')
  const held1 = fs.readdirSync(path.join(root1, 'outbox_human_agent_required'))
  assert(held1.length === 1 && held1[0].startsWith('stale-backlog-hold-'), 'ambiguous_stale_backlog_human_hold', JSON.stringify(held1))
  checked += 3

  const root2 = mkRoot()
  const worker2 = loadWorkerForRoot(root2)
  writeInbox(root2, 'clear-old.json', {
    contact_id: '222',
    thread_id: '222',
    instagram_username: 'clear_lead',
    message_id: 'm2',
    text: 'is there a cost?',
    received_at: old
  })
  const due2 = worker2.listDueInboxFiles({ env, now })
  assert(due2.length === 0, 'clear_stale_backlog_not_due', JSON.stringify(due2))
  assert(!fs.existsSync(path.join(root2, 'inbox', 'clear-old.json')), 'clear_stale_backlog_removed_from_inbox')
  assert(fs.readdirSync(path.join(root2, 'outbox_human_agent_required')).length === 1, 'clear_stale_backlog_human_hold')
  checked += 3

  const root3 = mkRoot()
  const worker3 = loadWorkerForRoot(root3)
  const freshFile = writeInbox(root3, 'fresh-ambiguous.json', {
    contact_id: '333',
    thread_id: '333',
    instagram_username: 'fresh_lead',
    message_id: 'm3',
    text: 'yes',
    received_at: fresh
  })
  const due3 = worker3.listDueInboxFiles({ env, now })
  assert(due3.length === 1 && due3[0] === freshFile, 'fresh_ambiguous_not_held_as_backlog', JSON.stringify(due3))
  checked += 1

  const root4 = mkRoot()
  const worker4 = loadWorkerForRoot(root4)
  writeInbox(root4, 'omar-old.json', {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message_id: 'm4',
    text: 'yes',
    received_at: old
  })
  const due4 = worker4.listDueInboxFiles({ env, now })
  assert(due4.length === 0, 'debug_stale_backlog_not_due', JSON.stringify(due4))
  assert(!fs.existsSync(path.join(root4, 'inbox', 'omar-old.json')), 'debug_stale_backlog_removed_from_inbox')
  assert(fs.readdirSync(path.join(root4, 'outbox_human_agent_required')).length === 1, 'debug_stale_backlog_human_hold')
  checked += 3

  const root5 = mkRoot()
  const worker5 = loadWorkerForRoot(root5)
  const ambiguousLock = writeInbox(root5, 'ambiguous-lock.json.lock', {
    contact_id: '555',
    thread_id: '555',
    instagram_username: 'old_lead',
    message_id: 'm5',
    text: 'perfect',
    received_at: old
  })
  makeFileOld(ambiguousLock, old)
  const due5 = worker5.listDueInboxFiles({ env, now })
  assert(due5.length === 0, 'ambiguous_stale_inbox_lock_not_requeued', JSON.stringify(due5))
  assert(!fs.existsSync(ambiguousLock), 'ambiguous_stale_inbox_lock_removed')
  const held5 = fs.readdirSync(path.join(root5, 'outbox_human_agent_required'))
  assert(held5.length === 1, 'ambiguous_stale_inbox_lock_human_hold', JSON.stringify(held5))
  checked += 3

  const root6 = mkRoot()
  const worker6 = loadWorkerForRoot(root6)
  const clearLock = writeInbox(root6, 'clear-lock.json.lock', {
    contact_id: '666',
    thread_id: '666',
    instagram_username: 'clear_lock_lead',
    message_id: 'm6',
    text: 'are you located in sf?',
    received_at: old
  })
  makeFileOld(clearLock, old)
  const due6 = worker6.listDueInboxFiles({ env, now })
  assert(due6.length === 0, 'clear_stale_inbox_lock_not_requeued', JSON.stringify(due6))
  assert(!fs.existsSync(clearLock), 'clear_stale_inbox_lock_removed')
  assert(fs.readdirSync(path.join(root6, 'outbox_human_agent_required')).length === 1, 'clear_stale_inbox_lock_human_hold')
  checked += 3

  const root7 = mkRoot()
  const worker7 = loadWorkerForRoot(root7)
  const freshLock = writeInbox(root7, 'fresh-lock.json.lock', {
    contact_id: '777',
    thread_id: '777',
    instagram_username: 'fresh_lock_lead',
    message_id: 'm7',
    text: 'yes',
    received_at: fresh
  })
  makeFileOld(freshLock, fresh)
  const due7 = worker7.listDueInboxFiles({ env, now })
  assert(due7.length === 0, 'fresh_inbox_lock_not_processed', JSON.stringify(due7))
  assert(fs.existsSync(freshLock), 'fresh_inbox_lock_left_in_place')
  checked += 2

  const root8 = mkRoot()
  const outboxWorker8 = loadOutboxWorkerForRoot(root8)
  const staleOutboxLock = writeOutbox(root8, 'old-outbound.json.lock', {
    source: 'codex_exec_dm_authority',
    authority: { runner: 'codex exec' },
    contact_id: '888',
    thread_id: '888',
    instagram_username: 'old_outbox_lead',
    message_id: 'm8',
    bubble: { text: 'yeah for sure' },
    queued_at: old,
    due_at: old
  })
  makeFileOld(staleOutboxLock, old)
  const outboxDue8 = outboxWorker8.listFiles({ env, now })
  assert(outboxDue8.length === 0, 'stale_outbox_lock_not_requeued_for_blind_send', JSON.stringify(outboxDue8))
  assert(!fs.existsSync(staleOutboxLock), 'stale_outbox_lock_removed')
  const held8 = fs.readdirSync(path.join(root8, 'outbox_human_agent_required'))
  assert(held8.length === 1, 'stale_outbox_lock_human_hold', JSON.stringify(held8))
  const heldPayload8 = JSON.parse(fs.readFileSync(path.join(root8, 'outbox_human_agent_required', held8[0]), 'utf8'))
  assert(heldPayload8.manual_reason === 'stale_outbox_lock_abandoned_no_blind_resend', 'stale_outbox_lock_manual_reason', heldPayload8.manual_reason)
  checked += 4

  const root14 = mkRoot()
  const worker14 = loadWorkerForRoot(root14)
  const recoverablePacket14 = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message_id: 'partial-original-valid-lock-message',
    text: 'yes plz',
    received_at: debugFresh
  }
  const validLock14 = writeInbox(root14, 'partial-original.json.lock', recoverablePacket14)
  fs.writeFileSync(path.join(root14, 'inbox', 'partial-original.json'), '{"partial":')
  makeFileOld(validLock14, debugFresh)
  const due14 = worker14.listDueInboxFiles({ env, now })
  const recovered14 = path.join(root14, 'inbox', 'partial-original.json')
  assert(due14.length === 1 && due14[0] === recovered14,
    'invalid_partial_original_is_quarantined_and_valid_lock_requeued',
    JSON.stringify(due14))
  assert(!fs.existsSync(validLock14) && JSON.parse(fs.readFileSync(recovered14, 'utf8')).message_id === recoverablePacket14.message_id,
    'valid_lock_payload_preserved_after_partial_original_collision')
  assert(fs.readdirSync(path.join(root14, 'inbox_quarantine_corrupt'))
    .some((name) => name.includes('partial-original.json') && !name.endsWith('.receipt.json')),
  'invalid_partial_original_raw_bytes_quarantined')
  checked += 3

  const root15 = mkRoot()
  const worker15 = loadWorkerForRoot(root15)
  const linkCrashOriginal15 = writeInbox(root15, 'link-crash.json', {
    contact_id: '1515',
    thread_id: '1515',
    instagram_username: 'link.crash.test',
    message_id: 'link-crash-message',
    text: 'hello',
    received_at: fresh
  })
  const linkCrashLock15 = `${linkCrashOriginal15}.lock`
  fs.linkSync(linkCrashOriginal15, linkCrashLock15)
  const due15 = worker15.listDueInboxFiles({ env, now })
  assert(due15.length === 1 && due15[0] === linkCrashOriginal15,
    'no_clobber_lock_link_crash_is_immediately_requeued',
    JSON.stringify(due15))
  assert(!fs.existsSync(linkCrashLock15) && fs.existsSync(linkCrashOriginal15),
    'same_inode_lock_alias_removed_without_payload_loss')
  checked += 2

  const root16 = mkRoot()
  const worker16 = loadWorkerForRoot(root16)
  const publishFaultLock16 = writeInbox(root16, 'publish-fault.json.lock', {
    contact_id: '1616',
    thread_id: '1616',
    instagram_username: 'publish.fault.test',
    message_id: 'publish-fault-message',
    text: 'hello',
    attempts: 0,
    received_at: fresh
  })
  const publishFaultPacket16 = JSON.parse(fs.readFileSync(publishFaultLock16, 'utf8'))
  const originalLinkSync = fs.linkSync
  fs.linkSync = function injectedRetryPublishFault(source, destination) {
    if (destination === publishFaultLock16.replace(/\.lock$/, '')) {
      const error = new Error('injected durable retry publish failure')
      error.code = 'ENOSPC'
      throw error
    }
    return originalLinkSync.apply(this, arguments)
  }
  try {
    let threw = false
    try {
      worker16.releaseForRetry(publishFaultLock16, publishFaultPacket16, 'fetch failed')
    } catch (error) {
      threw = error?.code === 'ENOSPC'
    }
    assert(threw, 'durable_retry_publish_fault_is_loud')
  } finally {
    fs.linkSync = originalLinkSync
  }
  assert(fs.existsSync(publishFaultLock16) && !fs.existsSync(publishFaultLock16.replace(/\.lock$/, '')),
    'durable_retry_publish_fault_preserves_authoritative_lock')
  assert(!fs.readdirSync(path.join(root16, 'inbox')).some((name) => name.endsWith('.tmp')),
    'durable_retry_publish_fault_cleans_exact_temp_file')
  checked += 3

  const root9 = mkRoot()
  const worker9 = loadWorkerForRoot(root9)
  const debugOrphanLock = writeInbox(root9, 'omar-debug-orphan.json.lock', {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message_id: 'm9',
    text: 'sent a voice note saying: How about 18th of July?',
    received_at: debugFresh
  })
  makeFileOld(debugOrphanLock, debugFresh)
  const due9 = worker9.listDueInboxFiles({ env, now })
  const requeued9 = path.join(root9, 'inbox', 'omar-debug-orphan.json')
  assert(due9.length === 1 && due9[0] === requeued9, 'debug_account_orphan_lock_recovered_after_60s', JSON.stringify(due9))
  assert(!fs.existsSync(debugOrphanLock) && fs.existsSync(requeued9), 'debug_account_orphan_lock_requeued_without_loss')
  checked += 2

  const root10 = mkRoot()
  const worker10 = loadWorkerForRoot(root10)
  const normalFreshLock = writeInbox(root10, 'normal-fresh-lock.json.lock', {
    contact_id: '1010',
    thread_id: '1010',
    instagram_username: 'normal_lead',
    message_id: 'm10',
    text: 'is there a cost?',
    received_at: debugFresh
  })
  makeFileOld(normalFreshLock, debugFresh)
  const due10 = worker10.listDueInboxFiles({ env, now })
  assert(due10.length === 0, 'normal_account_uses_regular_15m_lock_threshold', JSON.stringify(due10))
  assert(fs.existsSync(normalFreshLock), 'normal_fresh_lock_left_in_place')
  checked += 2

  // Mutable routing/fast-target allowlists may include a real account, but they
  // must not grant the canonical debug account's accelerated lock recovery.
  const root11 = mkRoot()
  const worker11 = loadWorkerForRoot(root11)
  const expandedAllowlistEnv = {
    ...env,
    SCV_FAST_TARGET_USERNAMES: 'omar.system,real-canary',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982,1111',
    SCV_DEBUG_STALE_LOCK_RECOVERY_MS: String(60 * 1000),
    SCV_STALE_LOCK_RECOVERY_MS: String(15 * 60 * 1000)
  }
  const realCanaryLock = writeInbox(root11, 'real-canary-lock.json.lock', {
    contact_id: '1111',
    thread_id: '1111',
    instagram_username: 'real-canary',
    message_id: 'm11',
    text: 'is there a cost?',
    received_at: debugFresh
  })
  makeFileOld(realCanaryLock, debugFresh)
  const due11 = worker11.listDueInboxFiles({ env: expandedAllowlistEnv, now })
  assert(due11.length === 0, 'mutable_allowlist_does_not_grant_debug_lock_threshold', JSON.stringify(due11))
  assert(fs.existsSync(realCanaryLock), 'real_allowlisted_lock_left_until_regular_threshold')
  checked += 2

  const root12 = mkRoot()
  const worker12 = loadWorkerForRoot(root12)
  const privatePacket = {
    contact_id: 'private-contact-88776655',
    thread_id: 'private-contact-88776655',
    instagram_username: 'private.customer.88776655',
    message_id: 'private-message-88776655',
    text: 'PRIVATE-TEXT-DO-NOT-LOG-88776655',
    received_at: old
  }
  writeInbox(root12, 'redaction-probe.json', privatePacket)
  const due12 = worker12.listDueInboxFiles({ env, now })
  assert(due12.length === 0, 'redaction_probe_stale_packet_held')
  assert(fs.readdirSync(path.join(root12, 'outbox_human_agent_required')).length === 1, 'redaction_probe_payload_preserved_in_human_hold')
  const serializedLogs = machineLogs.join('\n')
  assert(
    ![
      privatePacket.contact_id,
      privatePacket.instagram_username,
      privatePacket.message_id,
      privatePacket.text
    ].some((value) => serializedLogs.includes(value)),
    'inbox_machine_logs_omit_raw_identity_and_text',
    serializedLogs
  )
  assert(
    serializedLogs.includes(crypto.createHash('sha256').update(privatePacket.contact_id).digest('hex')),
    'inbox_machine_logs_keep_hashed_identity_correlation'
  )
  assert(!/"(?:contact_id|thread_id|message_id|instagram_username|text)":/.test(serializedLogs), 'inbox_machine_log_schema_has_no_raw_pii_keys')
  checked += 5

  const root13 = mkRoot()
  const outboxWorker13 = loadOutboxWorkerForRoot(root13)
  const corruptStaleLock = path.join(
    root13,
    'outbox',
    `${'a'.repeat(64)}-0.json.lock`
  )
  fs.writeFileSync(corruptStaleLock, '{"partial":', { mode: 0o600 })
  makeFileOld(corruptStaleLock, old)
  const corruptStaleResult = outboxWorker13.recoverStaleOutboxLockFile(
    corruptStaleLock, env, now
  )
  assert(corruptStaleResult?.action === 'human_agent_hold',
    'corrupt_stale_outbox_lock_gets_explicit_human_hold',
    JSON.stringify(corruptStaleResult))
  assert(!fs.existsSync(corruptStaleLock),
    'corrupt_stale_outbox_lock_is_not_permanent_tombstone')
  assert(fs.readdirSync(path.join(root13, 'outbox_human_agent_required')).length === 1,
    'corrupt_stale_outbox_lock_human_receipt_persisted')
  assert(fs.readdirSync(path.join(root13, 'outbox_quarantine_corrupt_adoption'))
    .some((name) => name.includes(`${'a'.repeat(64)}-0.json.lock`) &&
      !name.endsWith('.receipt.json')),
  'corrupt_stale_outbox_lock_raw_artifact_quarantined')
  checked += 4

  try {
    fs.rmSync(root1, { recursive: true, force: true })
    fs.rmSync(root2, { recursive: true, force: true })
    fs.rmSync(root3, { recursive: true, force: true })
    fs.rmSync(root4, { recursive: true, force: true })
    fs.rmSync(root5, { recursive: true, force: true })
    fs.rmSync(root6, { recursive: true, force: true })
    fs.rmSync(root7, { recursive: true, force: true })
    fs.rmSync(root8, { recursive: true, force: true })
    fs.rmSync(root9, { recursive: true, force: true })
    fs.rmSync(root10, { recursive: true, force: true })
    fs.rmSync(root11, { recursive: true, force: true })
    fs.rmSync(root12, { recursive: true, force: true })
    fs.rmSync(root13, { recursive: true, force: true })
    fs.rmSync(root14, { recursive: true, force: true })
    fs.rmSync(root15, { recursive: true, force: true })
    fs.rmSync(root16, { recursive: true, force: true })
  } catch { /* ignore */ }
  console.log = originalConsoleLog
  return { ok: true, checked }
}

if (require.main === module) {
  try { console.log(JSON.stringify(runHarness(), null, 2)) }
  catch (err) { console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2)); process.exit(1) }
}

module.exports = { runHarness }
