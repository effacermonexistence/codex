#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  TEST_ACCOUNT_PURGE_DIRS,
  OMAR_SYSTEM_PURGE_ACKNOWLEDGEMENT,
  debugResetBoundaryVerdict,
  executePausedOmarSystemPurge,
  readDebugResetWatermarks,
  orphanPacketPredatesDebugReset,
  purgeTestAccountDebugState
} = require(path.join(__dirname, 'scv-test-account-purge.js'))

function assert(condition, message, detail = {}) {
  if (!condition) {
    const err = new Error(message)
    err.detail = detail
    throw err
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-test-account-purge-'))
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-test-account-purge-repeat-'))
  const resumeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-test-account-purge-resume-'))
  const previousScvRoot = process.env.SCV_ROOT
  try {
    writeJson(path.join(root, 'thread-state', '1537753982.json'), {
      instagram_username: 'omar.system',
      state: 'debug chat residue'
    })
    writeJson(path.join(root, 'control-decisions', 'debug-decision.json'), {
      receipt_sha256: 'debug',
      instagram_username: 'omar.system',
      contact_id: '1537753982',
      bubbles: ['debug adopted reply']
    })
    writeJson(path.join(root, 'control-decisions', 'real-decision.json'), {
      receipt_sha256: 'real',
      instagram_username: 'real.lead',
      contact_id: '9000000000',
      bubbles: ['keep real lead']
    })
    writeJson(path.join(root, 'inbox', 'real-lead-mentions-debug.json'), {
      instagram_username: 'real.lead',
      contact_id: '9000000000',
      text: 'I found @omar.system through a shared post'
    })
    writeJson(path.join(root, 'inbox', 'omar-alias-wrong-contact.json'), {
      instagram_username: 'omar.system',
      contact_id: '9000000001',
      text: 'unrelated customer using the same alias'
    })
    writeJson(path.join(root, 'inbox', 'omar-contact-wrong-username.json'), {
      instagram_username: 'real.customer',
      contact_id: '1537753982',
      text: 'mismatched provider identity fields'
    })
    writeJson(path.join(root, 'inbox', 'split-identity-array.json'), [
      { instagram_username: 'omar.system', contact_id: '9000000002' },
      { instagram_username: 'real.customer', contact_id: '1537753982' }
    ])
    writeJson(path.join(root, 'form-submissions', 'omar-system-form.json'), {
      uid: 'debug-form',
      instagram: 'Omarsystem',
      name: 'Test Codex',
      phone: '5551119999',
      claimed_by: '1537753982'
    })
    writeJson(path.join(root, 'form-submissions', 'omar-system-qp-form.json'), {
      uid: 'debug-form-qp',
      instagram: 'omar=2Esystem',
      name: 'Omar System E2E',
      phone: '4155550142',
      claimed_by: '1537753982'
    })
    writeJson(path.join(root, 'form-submissions', 'real-lead-form.json'), {
      uid: 'real-form',
      instagram: 'real.lead',
      name: 'Real Lead',
      phone: '5552229999',
      claimed_by: ''
    })
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(root, 'logs', 'inbound-raw.ndjson'), [
      JSON.stringify({ instagram_username: 'omar.system', contact_id: '1537753982', text: 'debug residue' }),
      JSON.stringify({ instagram_username: 'real.lead', text: 'keep this' })
    ].join('\n') + '\n')

    const result = purgeTestAccountDebugState({
      root,
      usernames: ['omar.system', 'omarsystem'],
      contactIds: ['1537753982'],
      resetAt: '2026-07-12T23:00:00.000Z'
    })

    assert(TEST_ACCOUNT_PURGE_DIRS.includes('form-submissions'), 'debug_purge_dirs_include_form_submissions', TEST_ACCOUNT_PURGE_DIRS)
    assert(TEST_ACCOUNT_PURGE_DIRS.includes('control-decisions'), 'debug_purge_dirs_include_control_decisions', TEST_ACCOUNT_PURGE_DIRS)
    assert(result.deleted.includes('thread-state/1537753982.json'), 'debug_chat_state_deleted', result)
    assert(result.deleted.includes('control-decisions/debug-decision.json'), 'debug_immutable_decision_deleted', result)
    assert(!fs.existsSync(path.join(root, 'control-decisions', 'debug-decision.json')), 'debug_immutable_decision_removed')
    assert(fs.existsSync(path.join(root, 'control-decisions', 'real-decision.json')), 'real_lead_immutable_decision_preserved')
    assert(fs.existsSync(path.join(root, 'inbox', 'real-lead-mentions-debug.json')), 'non_target_message_mentioning_debug_handle_preserved')
    assert(fs.existsSync(path.join(root, 'inbox', 'omar-alias-wrong-contact.json')), 'username_only_identity_mismatch_preserved')
    assert(fs.existsSync(path.join(root, 'inbox', 'omar-contact-wrong-username.json')), 'contact_only_identity_mismatch_preserved')
    assert(fs.existsSync(path.join(root, 'inbox', 'split-identity-array.json')), 'different_records_cannot_combine_into_purge_identity')
    assert(result.deleted.includes('form-submissions/omar-system-form.json'), 'debug_gmail_form_ledger_deleted', result)
    assert(!fs.existsSync(path.join(root, 'form-submissions', 'omar-system-form.json')), 'omar_system_form_record_removed')
    assert(result.deleted.includes('form-submissions/omar-system-qp-form.json'), 'quoted_printable_debug_gmail_form_deleted', result)
    assert(!fs.existsSync(path.join(root, 'form-submissions', 'omar-system-qp-form.json')), 'quoted_printable_debug_form_record_removed')
    assert(fs.existsSync(path.join(root, 'form-submissions', 'real-lead-form.json')), 'real_lead_form_record_preserved')
    const tombstonePath = path.join(root, 'form-submissions', '.debug-reset-tombstones.json')
    assert(fs.existsSync(tombstonePath), 'debug_gmail_tombstone_written', result)
    const tombstones = JSON.parse(fs.readFileSync(tombstonePath, 'utf8'))
    assert(
      tombstones.uids.includes('debug-form') &&
      tombstones.uids.includes('omar-system-form') &&
      tombstones.uids.includes('debug-form-qp') &&
      tombstones.uids.includes('omar-system-qp-form'),
      'debug_gmail_tombstone_uids_recorded',
      tombstones
    )
    const resetWatermarks = readDebugResetWatermarks(root)
    assert(resetWatermarks.contact_ids['1537753982'] === '2026-07-12T23:00:00.000Z', 'debug_contact_reset_watermark_written', resetWatermarks)
    assert(resetWatermarks.usernames['omar.system'] === '2026-07-12T23:00:00.000Z', 'debug_username_reset_watermark_written', resetWatermarks)
    assert(orphanPacketPredatesDebugReset(root, {
      contact_id: '1537753982',
      instagram_username: 'omar.system',
      recovered_from_ig_last_interaction: '2026-07-12T22:59:59.000Z'
    }) === true, 'pre_reset_orphan_blocked')
    assert(orphanPacketPredatesDebugReset(root, {
      contact_id: '1537753982',
      instagram_username: 'omar.system',
      recovered_from_ig_last_interaction: '2026-07-12T23:00:01.000Z'
    }) === false, 'post_reset_orphan_allowed')
    assert(orphanPacketPredatesDebugReset(root, {
      contact_id: '9000000001',
      instagram_username: 'omar.system',
      recovered_from_ig_last_interaction: '2026-07-12T22:59:59.000Z'
    }) === false, 'username_only_mismatch_not_bound_to_debug_reset')
    assert(orphanPacketPredatesDebugReset(root, {
      contact_id: '1537753982',
      instagram_username: 'real.customer',
      recovered_from_ig_last_interaction: '2026-07-12T22:59:59.000Z'
    }) === false, 'contact_only_mismatch_not_bound_to_debug_reset')
    assert(orphanPacketPredatesDebugReset(root, {
      contact_id: '1537753982',
      instagram_username: 'omar.system',
      manychat_latest_interaction_at: '2026-07-12T22:59:59.000Z',
      received_at: '2026-07-12T23:05:00.000Z',
      message_id: 'locally-generated-after-reset'
    }) === true, 'pre_reset_direct_webhook_retry_blocked_by_external_manychat_time')
    assert(orphanPacketPredatesDebugReset(root, {
      contact_id: '1537753982',
      instagram_username: 'omar.system',
      manychat_latest_interaction_at: '2026-07-12T23:00:01.000Z'
    }) === false, 'post_reset_direct_webhook_allowed_by_external_manychat_time')
    const missingExternalTime = debugResetBoundaryVerdict(root, {
      contact_id: '1537753982',
      instagram_username: 'omar.system',
      received_at: '2026-07-12T23:05:00.000Z',
      message_id: 'local-receipt-time-is-not-source-proof'
    })
    assert(
      missingExternalTime.predates === true && missingExternalTime.reason === 'missing_external_interaction_timestamp_fail_closed',
      'missing_source_interaction_time_fails_closed_at_debug_reset',
      missingExternalTime
    )
    const explicitSourceTime = debugResetBoundaryVerdict(root, {
      contact_id: '1537753982',
      instagram_username: 'omar.system',
      source_interaction_at: '2026-07-12T22:59:58.000Z',
      manychat_latest_interaction_at: '2026-07-12T23:00:05.000Z'
    })
    assert(
      explicitSourceTime.predates === true && explicitSourceTime.source === 'source_interaction_at',
      'explicit_source_interaction_time_outranks_later_api_observation',
      explicitSourceTime
    )
    const futureSourceTime = debugResetBoundaryVerdict(root, {
      contact_id: '1537753982',
      instagram_username: 'omar.system',
      source_interaction_at: '2099-01-01T00:00:00.000Z'
    }, { now: Date.parse('2026-08-20T00:00:00.000Z') })
    assert(
      futureSourceTime.predates === true && futureSourceTime.reason === 'external_interaction_timestamp_in_future_fail_closed',
      'future_source_interaction_time_cannot_bypass_debug_reset',
      futureSourceTime
    )

    process.env.SCV_ROOT = root
    const { writeSubmission } = require(path.join(__dirname, 'scv-gmail-form-reader.js'))
    const rehydrate = writeSubmission('debug-form', {
      name: 'Test Codex',
      phone: '5551119999',
      instagram: 'Omarsystem'
    }, {}, { root })
    assert(rehydrate.skipped === true && rehydrate.reason === 'purged_test_account_debug_reset', 'debug_gmail_reader_does_not_rehydrate_purged_uid', rehydrate)

    // Same-process repeat regression: the drift monitor reruns this harness every
    // minute. A module-cache-bound submissions root made only the first pass
    // valid, then recreated the deleted first temp directory on pass two. Prove
    // one already-loaded reader can honor a second isolated root without touching
    // either the first test root or live /data state.
    writeJson(path.join(secondRoot, 'form-submissions', 'repeat-debug-form.json'), {
      uid: 'repeat-debug-form',
      instagram: 'Omarsystem',
      name: 'Repeat Test',
      phone: '5551110000',
      claimed_by: '1537753982'
    })
    const secondPurge = purgeTestAccountDebugState({
      root: secondRoot,
      usernames: ['omar.system', 'omarsystem'],
      contactIds: ['1537753982'],
      resetAt: '2026-07-12T23:01:00.000Z'
    })
    const secondRehydrate = writeSubmission('repeat-debug-form', {
      name: 'Repeat Test',
      phone: '5551110000',
      instagram: 'Omarsystem'
    }, {}, { root: secondRoot })
    assert(
      secondPurge.remaining_count === 0 &&
      secondRehydrate.skipped === true &&
      secondRehydrate.reason === 'purged_test_account_debug_reset' &&
      String(secondRehydrate.file || '').startsWith(secondRoot + path.sep),
      'debug_gmail_reader_repeat_run_uses_current_isolated_root',
      { secondPurge, secondRehydrate }
    )

    const keptRawLog = fs.readFileSync(path.join(root, 'logs', 'inbound-raw.ndjson'), 'utf8')
    assert(result.removed_log_lines === 1, 'debug_raw_log_lines_removed', result)
    assert(!keptRawLog.includes('omar.system') && keptRawLog.includes('real.lead'), 'debug_raw_log_filtered', keptRawLog)
    assert(result.remaining_count === 0, 'debug_reset_has_zero_residual_matches', result)

    const cliAudit = spawnSync(process.execPath, [path.join(__dirname, 'scv-test-account-purge.js'), '--audit-omar-system'], {
      env: { ...process.env, SCV_ROOT: root },
      encoding: 'utf8'
    })
    assert(cliAudit.status === 0, 'explicit_operator_cli_audit_exits_clean', cliAudit.stderr || cliAudit.stdout)
    const cliAuditResult = JSON.parse(String(cliAudit.stdout || '{}'))
    assert(cliAuditResult.remaining_count === 0, 'explicit_operator_cli_stays_target_scoped', cliAuditResult)

    writeJson(path.join(root, 'thread-state', '1537753982.json'), {
      instagram_username: 'omar.system',
      contact_id: '1537753982',
      state: 'post-restore debug residue'
    })
    writeJson(path.join(root, 'SCV_GOLDEN_PRODUCTION_RELEASE.json'), {
      release_id: 'scv-instagram-golden-production-bootstrap-test',
      content_fingerprint_sha256: 'a'.repeat(64),
      release_manifest_sha256: 'b'.repeat(64),
      deployment: {
        release_phase: 'recovery_bootstrap',
        recovery_transition: { role: 'bootstrap' }
      }
    })
    const cliReceiptDirectory = path.join(root, 'release-transitions')
    fs.mkdirSync(cliReceiptDirectory, { mode: 0o700 })
    const cliReceipt = path.join(
      cliReceiptDirectory,
      'bootstrap-test.omar-system-purge.json'
    )
    const exactEnv = {
      ...process.env,
      SCV_ROOT: root,
      SCV_PAUSE_ALL: '1',
      SCV_RELEASE_PHASE: 'recovery_bootstrap',
      SCV_GOLDEN_RELEASE_ID: 'scv-instagram-golden-production-bootstrap-test',
      RAILWAY_DEPLOYMENT_ID: '88888888-8888-4888-8888-888888888888'
    }
    const noAck = spawnSync(process.execPath, [
      path.join(__dirname, 'scv-test-account-purge.js'),
      '--execute-omar-system', '--receipt', cliReceipt
    ], { env: exactEnv, encoding: 'utf8' })
    assert(noAck.status !== 0, 'omar_execute_without_exact_ack_was_accepted', noAck)
    assert(fs.existsSync(path.join(root, 'thread-state', '1537753982.json')),
      'omar_execute_without_ack_mutated_state')
    const unpaused = spawnSync(process.execPath, [
      path.join(__dirname, 'scv-test-account-purge.js'),
      '--execute-omar-system', '--receipt', cliReceipt
    ], {
      env: {
        ...exactEnv,
        SCV_PAUSE_ALL: '0',
        SCV_EXECUTE_OMAR_SYSTEM_PURGE: OMAR_SYSTEM_PURGE_ACKNOWLEDGEMENT
      },
      encoding: 'utf8'
    })
    assert(unpaused.status !== 0, 'omar_execute_while_unpaused_was_accepted', unpaused)
    assert(fs.existsSync(path.join(root, 'thread-state', '1537753982.json')),
      'omar_execute_while_unpaused_mutated_state')
    const wrongPhase = spawnSync(process.execPath, [
      path.join(__dirname, 'scv-test-account-purge.js'),
      '--execute-omar-system', '--receipt', cliReceipt
    ], {
      env: {
        ...exactEnv,
        SCV_RELEASE_PHASE: 'active',
        SCV_EXECUTE_OMAR_SYSTEM_PURGE: OMAR_SYSTEM_PURGE_ACKNOWLEDGEMENT
      },
      encoding: 'utf8'
    })
    assert(wrongPhase.status !== 0, 'omar_execute_in_active_phase_was_accepted', wrongPhase)
    const exactExecute = spawnSync(process.execPath, [
      path.join(__dirname, 'scv-test-account-purge.js'),
      '--execute-omar-system', '--receipt', cliReceipt
    ], {
      env: {
        ...exactEnv,
        SCV_EXECUTE_OMAR_SYSTEM_PURGE: OMAR_SYSTEM_PURGE_ACKNOWLEDGEMENT
      },
      encoding: 'utf8'
    })
    assert(exactExecute.status === 0, 'exact paused bootstrap Omar purge failed', exactExecute.stderr)
    assert(!fs.existsSync(path.join(root, 'thread-state', '1537753982.json')),
      'exact paused bootstrap Omar purge left state')
    assert(fs.existsSync(cliReceipt), 'exact Omar purge did not write receipt')
    assert((fs.statSync(cliReceipt).mode & 0o077) === 0, 'Omar purge receipt is not private')
    const parsedCliReceipt = JSON.parse(fs.readFileSync(cliReceipt, 'utf8'))
    assert(
      parsedCliReceipt.pause_all_verified === true &&
      parsedCliReceipt.pre_audit_remaining_count > 0 &&
      parsedCliReceipt.post_audit_remaining_count === 0,
      'Omar purge receipt does not bind audit-purge-audit0',
      parsedCliReceipt
    )

    writeJson(path.join(resumeRoot, 'thread-state', '1537753982.json'), {
      instagram_username: 'omar.system', contact_id: '1537753982'
    })
    writeJson(path.join(resumeRoot, 'SCV_GOLDEN_PRODUCTION_RELEASE.json'), {
      release_id: 'scv-instagram-golden-production-bootstrap-resume',
      content_fingerprint_sha256: 'c'.repeat(64),
      release_manifest_sha256: 'd'.repeat(64),
      deployment: {
        release_phase: 'recovery_bootstrap',
        recovery_transition: { role: 'bootstrap' }
      }
    })
    const resumeReceiptDirectory = path.join(resumeRoot, 'release-transitions')
    fs.mkdirSync(resumeReceiptDirectory, { mode: 0o700 })
    const resumeReceipt = path.join(
      resumeReceiptDirectory,
      'bootstrap-resume.omar-system-purge.json'
    )
    const resumeEnv = {
      SCV_PAUSE_ALL: '1',
      SCV_RELEASE_PHASE: 'recovery_bootstrap',
      SCV_EXECUTE_OMAR_SYSTEM_PURGE: OMAR_SYSTEM_PURGE_ACKNOWLEDGEMENT,
      SCV_GOLDEN_RELEASE_ID: 'scv-instagram-golden-production-bootstrap-resume',
      RAILWAY_DEPLOYMENT_ID: '99999999-9999-4999-8999-999999999999'
    }
    let receiptFailure = false
    try {
      executePausedOmarSystemPurge({
        root: resumeRoot,
        receipt: resumeReceipt,
        env: resumeEnv,
        now: new Date('2026-08-20T13:00:00.000Z'),
        writeReceipt: () => { throw new Error('simulated_purge_receipt_failure') }
      })
    } catch (error) { receiptFailure = /simulated_purge_receipt_failure/.test(String(error.message)) }
    assert(receiptFailure, 'simulated Omar purge receipt failure did not fire')
    assert(!fs.existsSync(path.join(resumeRoot, 'thread-state', '1537753982.json')),
      'receipt failure rolled back or duplicated canonical debug state')
    assert(fs.existsSync(resumeReceipt.replace(
      /\.omar-system-purge\.json$/,
      '.intent.omar-system-purge.json'
    )), 'receipt failure lost durable Omar purge intent')
    const resumedPurge = executePausedOmarSystemPurge({
      root: resumeRoot,
      receipt: resumeReceipt,
      env: resumeEnv,
      now: new Date('2026-08-20T13:01:00.000Z')
    })
    assert(resumedPurge.ok && resumedPurge.post_audit_remaining_count === 0,
      'Omar purge did not finalize from durable intent', resumedPurge)

    return { ok: true, checked: 52, root }
  } finally {
    if (previousScvRoot === undefined) delete process.env.SCV_ROOT
    else process.env.SCV_ROOT = previousScvRoot
    try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
    try { fs.rmSync(secondRoot, { recursive: true, force: true }) } catch {}
    try { fs.rmSync(resumeRoot, { recursive: true, force: true }) } catch {}
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(run(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err?.message || err), detail: err.detail || {} }, null, 2))
    process.exit(1)
  }
}

module.exports = { run }
