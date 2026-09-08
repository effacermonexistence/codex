#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  SCV_DRIFT_STATUS_SCHEMA,
  driftAlertSeverity,
  classifyDriftAlerts,
  scanQueueDir,
  scanThreadHistory,
  enforceCriticalDriftFailClose,
  enforceDriftMonitorErrorFailClose
} = require('./scv-drift-monitor.js')
const {
  isPausedForPacket,
  operatorPauseReasonForPacket
} = require('./scv-pause-gate.js')
const {
  KNOWN_FALSE_POSITIVE_INCIDENT,
  KNOWN_INTENTIONAL_HOLD_QUEUE_FALSE_POSITIVE_INCIDENT,
  KNOWN_DUPLICATE_RECOVERY_TEXT_INCIDENT,
  latchPath,
  atomicWriteJson,
  readFailClose,
  reconcileKnownFalsePositiveFailClose,
  scanIntentionalHoldIncidentEvidence,
  reconcileKnownIntentionalHoldQueueFalsePositive,
  reconcileKnownDuplicateRecoveryTextFailClose
} = require('./scv-golden-fail-close.js')

assert.strictEqual(driftAlertSeverity({ reason: 'quarantine_not_empty' }), 'operational')
assert.strictEqual(driftAlertSeverity({ reason: 'queue_file_intentionally_held' }), 'operational')
assert.strictEqual(driftAlertSeverity({ reason: 'queue_file_blocked_by_fail_close' }), 'operational')
assert.strictEqual(driftAlertSeverity({ reason: 'queue_file_stale' }), 'critical')

const operational = classifyDriftAlerts([{ reason: 'quarantine_not_empty' }])
assert.strictEqual(operational.critical_ok, true)
assert.strictEqual(operational.critical.length, 0)
assert.strictEqual(operational.operational.length, 1)

const critical = classifyDriftAlerts([
  { reason: 'quarantine_not_empty' },
  { reason: 'queue_file_stale' }
])
assert.strictEqual(critical.critical_ok, false)
assert.strictEqual(critical.critical.length, 1)
assert.strictEqual(critical.operational.length, 1)
assert(critical.alerts.some((alert) =>
  alert.reason === 'queue_file_stale' && alert.severity === 'critical'))

const causalQueueRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-causal-queue-hold-'))
try {
  const inbox = path.join(causalQueueRoot, 'inbox')
  fs.mkdirSync(inbox, { recursive: true })
  const baseMs = Date.parse('2026-09-01T19:00:00.000Z')
  const latchAt = '2026-09-01T19:00:45.401Z'
  const now = baseMs + (30 * 60 * 1000)
  const env = {
    RAILWAY_ENVIRONMENT_NAME: 'production',
    SCV_RELEASE_MODE: 'production',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '1',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982'
  }
  const heldFile = path.join(inbox, 'held-customer.json')
  fs.writeFileSync(heldFile, JSON.stringify({
    contact_id: 'customer-2001',
    instagram_username: 'customer.handle',
    text: 'held by owner test mode'
  }))
  fs.utimesSync(heldFile, new Date(baseMs), new Date(baseMs))

  const blockedFile = path.join(inbox, 'omar-after-latch.json')
  fs.writeFileSync(blockedFile, JSON.stringify({
    contact_id: '1537753982',
    instagram_username: 'omar.system',
    text: 'Hi, can I please get more information?'
  }))
  fs.utimesSync(blockedFile, new Date(baseMs + 60_000), new Date(baseMs + 60_000))

  assert.strictEqual(operatorPauseReasonForPacket({
    contact_id: 'customer-2001',
    instagram_username: 'customer.handle'
  }, env), 'pause_non_test')
  assert.strictEqual(operatorPauseReasonForPacket({
    contact_id: '1537753982',
    instagram_username: 'omar.system'
  }, env), '')

  const scan = scanQueueDir('inbox', {
    env,
    root: causalQueueRoot,
    now,
    failClose: { active: true, activated_at_utc: latchAt }
  })
  assert.strictEqual(scan.stale.length, 0)
  assert.strictEqual(scan.intentionally_held.length, 1)
  assert.strictEqual(scan.intentionally_held[0].hold_reason, 'pause_non_test')
  assert.strictEqual(scan.blocked_by_fail_close.length, 1)
  assert.strictEqual(scan.blocked_by_fail_close[0].latch_activated_at_utc, latchAt)

  const causalOperational = classifyDriftAlerts([
    {
      reason: 'queue_file_intentionally_held',
      hold_reason: scan.intentionally_held[0].hold_reason
    },
    {
      reason: 'queue_file_blocked_by_fail_close',
      latch_activated_at_utc: latchAt
    }
  ])
  assert.strictEqual(causalOperational.critical_ok, true)
  assert.strictEqual(causalOperational.critical.length, 0)
  assert.strictEqual(causalOperational.operational.length, 2)
} finally {
  fs.rmSync(causalQueueRoot, { recursive: true, force: true })
}

const formReceiptHistoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-drift-form-receipt-'))
try {
  const legitimateReceiptFile = path.join(formReceiptHistoryRoot, 'legitimate-receipt.json')
  fs.writeFileSync(legitimateReceiptFile, JSON.stringify({
    events: [
      { role: 'assistant', message_id: 'offer', text: 'Want me to send the form?' },
      { role: 'user', message_id: 'consent', text: 'Yes please' },
      { role: 'assistant', message_id: 'link', text: 'https://www.effacermonexistence.com/apply' },
      { role: 'user', message_id: 'submitted', text: 'Just submitted it' },
      { role: 'assistant', message_id: 'receipt', text: 'Got the form too send me a couple dates that work so I can check availability' }
    ]
  }))
  assert.strictEqual(
    scanThreadHistory(legitimateReceiptFile).some((alert) =>
      alert.reason === 'repeated_form_link_permission_offer_visible_history'),
    false
  )

  const actualRepeatFile = path.join(formReceiptHistoryRoot, 'actual-repeat.json')
  fs.writeFileSync(actualRepeatFile, JSON.stringify({
    events: [
      { role: 'assistant', message_id: 'offer-one', text: 'Want me to send the form?' },
      { role: 'user', message_id: 'later', text: 'I am still thinking' },
      { role: 'assistant', message_id: 'offer-two', text: 'Should I resend the form?' }
    ]
  }))
  assert.strictEqual(
    scanThreadHistory(actualRepeatFile).some((alert) =>
      alert.reason === 'repeated_form_link_permission_offer_visible_history'),
    true
  )
} finally {
  fs.rmSync(formReceiptHistoryRoot, { recursive: true, force: true })
}

let activationCalls = 0
const operationalEnforcement = enforceCriticalDriftFailClose({
  critical_ok: true,
  critical_alert_count: 0,
  alerts: operational.alerts
}, {
  env: { RAILWAY_ENVIRONMENT_NAME: 'production' },
  activateFn: () => {
    activationCalls += 1
    return { state: { active: true } }
  }
})
assert.strictEqual(operationalEnforcement.required, false)
assert.strictEqual(activationCalls, 0)

const stagingEnforcement = enforceCriticalDriftFailClose({
  critical_ok: false,
  critical_alert_count: 1,
  alerts: critical.alerts
}, {
  env: { RAILWAY_ENVIRONMENT_NAME: 'staging', SCV_RELEASE_MODE: 'staging' },
  activateFn: () => {
    activationCalls += 1
    return { state: { active: true } }
  }
})
assert.strictEqual(stagingEnforcement.required, true)
assert.strictEqual(stagingEnforcement.activated, false)
assert.strictEqual(activationCalls, 0)

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-drift-fail-close-'))
try {
  const productionEnv = {
    RAILWAY_ENVIRONMENT_NAME: 'production',
    SCV_RELEASE_MODE: 'production',
    SCV_RELEASE_ID: 'scv-instagram-drift-harness-v1',
    SCV_CONTENT_FINGERPRINT: 'a'.repeat(64),
    SCV_PERSIST_ROOT: tempRoot,
    SCV_RUNTIME_NAMESPACE: 'drift-harness',
    SCV_ROOT: tempRoot
  }
  const productionEnforcement = enforceCriticalDriftFailClose({
    schema: SCV_DRIFT_STATUS_SCHEMA,
    critical_ok: false,
    critical_alert_count: 1,
    alerts: critical.alerts
  }, { env: productionEnv, root: tempRoot })
  assert.strictEqual(productionEnforcement.required, true)
  assert.strictEqual(productionEnforcement.activated, true)
  assert.strictEqual(isPausedForPacket({
    contact_id: 'real-customer',
    instagram_username: 'real.customer'
  }, productionEnv), true)

  const monitorErrorEnforcement = enforceDriftMonitorErrorFailClose(
    new Error('synthetic_monitor_error'),
    { env: productionEnv, root: tempRoot }
  )
  assert.strictEqual(monitorErrorEnforcement.activated, true)
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

const reconciliationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-known-false-positive-'))
try {
  const reconciliationEnv = {
    RAILWAY_ENVIRONMENT_NAME: 'production',
    SCV_RELEASE_MODE: 'production',
    SCV_PERSIST_ROOT: reconciliationRoot,
    SCV_RUNTIME_NAMESPACE: 'prod',
    SCV_ROOT: reconciliationRoot
  }
  const incidentLatch = {
    schema: 'scv-golden-fail-close-2026-07-25-v2',
    active: true,
    activated_at_utc: KNOWN_FALSE_POSITIVE_INCIDENT.activated_at_utc,
    release_id: KNOWN_FALSE_POSITIVE_INCIDENT.release_id,
    release_fingerprint_sha256:
      KNOWN_FALSE_POSITIVE_INCIDENT.release_fingerprint_sha256,
    reason: KNOWN_FALSE_POSITIVE_INCIDENT.reason,
    failed_checks: [KNOWN_FALSE_POSITIVE_INCIDENT.failed_check],
    detail: {
      critical_reasons: [KNOWN_FALSE_POSITIVE_INCIDENT.failed_check]
    },
    alert: { delivery_status: 'not_attempted' }
  }
  atomicWriteJson(latchPath({ env: reconciliationEnv, root: reconciliationRoot }), incidentLatch)
  const cleanReplacementStatus = {
    schema: 'scv-drift-status-2026-08-31-v3-fail-close',
    at: '2026-09-01T03:00:00.000Z',
    critical_ok: true,
    critical_alert_count: 0,
    alerts: [{ reason: 'quarantine_not_empty', severity: 'operational' }],
    hard_harness_lock_version:
      KNOWN_FALSE_POSITIVE_INCIDENT.fixed_hard_harness_lock_version,
    hard_harness: { ok: true }
  }
  const dirtyAttempt = reconcileKnownFalsePositiveFailClose({
    env: reconciliationEnv,
    root: reconciliationRoot,
    driftStatus: { ...cleanReplacementStatus, critical_ok: false, critical_alert_count: 1 },
    currentReleaseId: 'scv-instagram-single-20260901-v127',
    currentReleaseFingerprint: 'b'.repeat(64)
  })
  assert.strictEqual(dirtyAttempt.reconciled, false)
  assert.strictEqual(readFailClose({ env: reconciliationEnv, root: reconciliationRoot }).active, true)

  const reconciled = reconcileKnownFalsePositiveFailClose({
    env: reconciliationEnv,
    root: reconciliationRoot,
    driftStatus: cleanReplacementStatus,
    currentReleaseId: 'scv-instagram-single-20260901-v127',
    currentReleaseFingerprint: 'b'.repeat(64)
  })
  assert.strictEqual(reconciled.reconciled, true)
  assert.strictEqual(fs.existsSync(reconciled.archived_file), true)
  assert.strictEqual(fs.existsSync(reconciled.audit_file), true)
  assert.strictEqual(readFailClose({ env: reconciliationEnv, root: reconciliationRoot }).active, false)
} finally {
  fs.rmSync(reconciliationRoot, { recursive: true, force: true })
}

const intentionalHoldReconciliationRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'scv-intentional-hold-reconciliation-')
)
try {
  const incident = KNOWN_INTENTIONAL_HOLD_QUEUE_FALSE_POSITIVE_INCIDENT
  const reconciliationEnv = {
    RAILWAY_ENVIRONMENT_NAME: 'production',
    SCV_RELEASE_MODE: 'production',
    SCV_PERSIST_ROOT: intentionalHoldReconciliationRoot,
    SCV_RUNTIME_NAMESPACE: 'prod',
    SCV_ROOT: intentionalHoldReconciliationRoot,
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '1',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982'
  }
  atomicWriteJson(latchPath({
    env: reconciliationEnv,
    root: intentionalHoldReconciliationRoot
  }), {
    schema: 'scv-golden-fail-close-2026-07-25-v2',
    active: true,
    activated_at_utc: incident.activated_at_utc,
    release_id: incident.release_id,
    release_fingerprint_sha256: incident.release_fingerprint_sha256,
    reason: incident.reason,
    failed_checks: [incident.failed_check],
    detail: { critical_reasons: [incident.failed_check] },
    alert: { delivery_status: 'not_attempted' }
  })
  const cleanStatus = {
    schema: incident.fixed_drift_schema,
    at: '2026-09-01T20:00:00.000Z',
    critical_ok: true,
    critical_alert_count: 0,
    alerts: [],
    queues: [{ dir: 'inbox', stale: [] }],
    hard_harness_lock_version: incident.fixed_hard_harness_lock_version,
    hard_harness: { ok: true }
  }
  const evidenceDir = path.join(
    intentionalHoldReconciliationRoot,
    'outbox_human_agent_required'
  )
  fs.mkdirSync(evidenceDir, { recursive: true })
  fs.writeFileSync(path.join(evidenceDir, 'stale-backlog-hold-1-customer.json'), JSON.stringify({
    type: 'stale_backlog_human_agent_required',
    manual_reason: 'stale_backlog_over_threshold',
    queued_for_human_agent_at: '2026-09-01T19:16:00.000Z',
    source_interaction_at: '2026-09-01T18:40:00.000Z',
    contact_id: 'customer-2001',
    instagram_username: 'customer.handle'
  }))
  const causalEvidenceFile = path.join(
    evidenceDir,
    'stale-backlog-hold-2-omar.json'
  )
  fs.writeFileSync(causalEvidenceFile, JSON.stringify({
    type: 'stale_backlog_human_agent_required',
    manual_reason: 'stale_backlog_over_threshold',
    queued_for_human_agent_at: '2026-09-01T19:16:36.818Z',
    source_interaction_at: '2026-09-01T19:01:38.024Z',
    contact_id: '1537753982',
    instagram_username: 'forged.omar'
  }))
  const missingScan = scanIntentionalHoldIncidentEvidence({
    env: reconciliationEnv,
    root: intentionalHoldReconciliationRoot,
    incident
  })
  assert.strictEqual(missingScan.pre_latch_intentional_holds.length, 1)
  assert.strictEqual(missingScan.causal_debug_blocks.length, 0)
  const missingCausalEvidence = reconcileKnownIntentionalHoldQueueFalsePositive({
    env: reconciliationEnv,
    root: intentionalHoldReconciliationRoot,
    driftStatus: cleanStatus,
    currentReleaseId: incident.replacement_release_id,
    currentReleaseFingerprint: 'c'.repeat(64)
  })
  assert.strictEqual(missingCausalEvidence.reconciled, false)
  assert.strictEqual(readFailClose({
    env: reconciliationEnv,
    root: intentionalHoldReconciliationRoot
  }).active, true)

  fs.writeFileSync(causalEvidenceFile, JSON.stringify({
    type: 'stale_backlog_human_agent_required',
    manual_reason: 'stale_backlog_over_threshold',
    queued_for_human_agent_at: '2026-09-01T19:16:36.818Z',
    source_interaction_at: '2026-09-01T19:01:38.024Z',
    contact_id: '1537753982',
    instagram_username: 'omar.system'
  }))
  const completeScan = scanIntentionalHoldIncidentEvidence({
    env: reconciliationEnv,
    root: intentionalHoldReconciliationRoot,
    incident
  })
  assert.strictEqual(completeScan.pre_latch_intentional_holds.length, 1)
  assert.strictEqual(completeScan.causal_debug_blocks.length, 1)
  assert.strictEqual(completeScan.unclassified.length, 0)

  const reconciled = reconcileKnownIntentionalHoldQueueFalsePositive({
    env: reconciliationEnv,
    root: intentionalHoldReconciliationRoot,
    driftStatus: cleanStatus,
    currentReleaseId: incident.replacement_release_id,
    currentReleaseFingerprint: 'c'.repeat(64)
  })
  assert.strictEqual(reconciled.reconciled, true)
  assert.strictEqual(fs.existsSync(reconciled.archived_file), true)
  assert.strictEqual(fs.existsSync(reconciled.audit_file), true)
  assert.strictEqual(readFailClose({
    env: reconciliationEnv,
    root: intentionalHoldReconciliationRoot
  }).active, false)
} finally {
  fs.rmSync(intentionalHoldReconciliationRoot, { recursive: true, force: true })
}

// 2026-09-02 duplicate-recovery-text incident: the latch is archived only with
// the exact latch identity, the v141 replacement release, the repaired hard
// harness, the fixed recovery version, clean drift, and a post-latch purge
// receipt for the affected debug thread. Anything else keeps the latch.
const duplicateRecoveryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'scv-duplicate-recovery-reconciliation-')
)
try {
  const incident = KNOWN_DUPLICATE_RECOVERY_TEXT_INCIDENT
  const reconciliationEnv = {
    RAILWAY_ENVIRONMENT_NAME: 'production',
    SCV_RELEASE_MODE: 'production',
    SCV_PERSIST_ROOT: duplicateRecoveryRoot,
    SCV_RUNTIME_NAMESPACE: 'prod',
    SCV_ROOT: duplicateRecoveryRoot
  }
  const writeLatch = () => atomicWriteJson(latchPath({ env: reconciliationEnv, root: duplicateRecoveryRoot }), {
    schema: 'scv-golden-fail-close-2026-07-25-v2',
    active: true,
    activated_at_utc: incident.activated_at_utc,
    release_id: incident.release_id,
    release_fingerprint_sha256: incident.release_fingerprint_sha256,
    reason: incident.reason,
    failed_checks: [incident.failed_check],
    detail: { critical_reasons: [incident.failed_check] },
    alert: { delivery_status: 'not_attempted' }
  })
  writeLatch()
  const cleanStatus = {
    schema: incident.fixed_drift_schema,
    at: '2026-09-02T21:40:00.000Z',
    critical_ok: true,
    critical_alert_count: 0,
    alerts: [{ reason: 'quarantine_not_empty', severity: 'operational' }],
    hard_harness_lock_version: incident.fixed_hard_harness_lock_version,
    hard_harness: { ok: true }
  }
  const cleanPurge = {
    schema: `${incident.purge_receipt_schema_prefix}v141-private`,
    ok: true,
    executed_at_utc: '2026-09-02T21:17:50.000Z',
    worker_pause_barrier_verified: true,
    code_locked_identity_scope: true,
    non_debug_identity_scope_allowed: false,
    contact_ids: [incident.affected_contact_id],
    post_audit_remaining_count: 0
  }
  const base = {
    env: reconciliationEnv,
    root: duplicateRecoveryRoot,
    driftStatus: cleanStatus,
    currentReleaseId: incident.replacement_release_id,
    currentReleaseFingerprint: 'd'.repeat(64),
    currentRecoveryVersion: incident.fixed_recovery_version,
    purgeReceipt: cleanPurge
  }
  const rejected = [
    { ...base, driftStatus: { ...cleanStatus, critical_ok: false, critical_alert_count: 1 } },
    { ...base, currentReleaseId: incident.release_id },
    { ...base, currentRecoveryVersion: 'scv-route-aware-visible-recovery-2026-08-29-v4-booking-continuity-and-discounted-model-rate' },
    { ...base, purgeReceipt: { ...cleanPurge, executed_at_utc: '2026-09-02T20:24:22.000Z' } },
    { ...base, purgeReceipt: { ...cleanPurge, contact_ids: ['9999999999'] } },
    { ...base, purgeReceipt: null },
    { ...base, driftStatus: { ...cleanStatus, hard_harness_lock_version: 'scv-hard-harness-lock-2026-09-02-v157-superseded-checkpoint-and-numeric-ingress' } }
  ]
  for (const attempt of rejected) {
    const verdict = reconcileKnownDuplicateRecoveryTextFailClose(attempt)
    assert.strictEqual(verdict.reconciled, false)
    assert.strictEqual(readFailClose({ env: reconciliationEnv, root: duplicateRecoveryRoot }).active, true)
  }
  const reconciled = reconcileKnownDuplicateRecoveryTextFailClose(base)
  assert.strictEqual(reconciled.reconciled, true)
  assert.strictEqual(fs.existsSync(reconciled.archived_file), true)
  assert.strictEqual(fs.existsSync(reconciled.audit_file), true)
  const audit = JSON.parse(fs.readFileSync(reconciled.audit_file, 'utf8'))
  assert.strictEqual(audit.incident_classification, 'true_positive_cause_fixed_and_visible_history_purged')
  assert.strictEqual(readFailClose({ env: reconciliationEnv, root: duplicateRecoveryRoot }).active, false)
  assert.strictEqual(reconcileKnownDuplicateRecoveryTextFailClose(base).reconciled, false)
} finally {
  fs.rmSync(duplicateRecoveryRoot, { recursive: true, force: true })
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  schema: SCV_DRIFT_STATUS_SCHEMA,
  duplicate_recovery_text_incident_reconciliation_is_evidence_bound: true,
  operational_quarantine_does_not_false_fail_critical_gate: true,
  completed_form_receipt_does_not_false_trigger_repeat_offer: true,
  actual_repeat_form_offer_remains_critical: true,
  stale_queue_fails_critical_gate: true,
  intentional_operator_hold_is_operational_not_critical: true,
  post_latch_queue_growth_is_causal_operational_evidence: true,
  critical_drift_activates_persistent_sender_reaction_hold: true,
  drift_monitor_error_activates_persistent_hold: true,
  incident_specific_false_positive_reconciliation_is_evidence_bound: true,
  intentional_hold_incident_reconciliation_is_evidence_bound: true
}, null, 2)}\n`)
