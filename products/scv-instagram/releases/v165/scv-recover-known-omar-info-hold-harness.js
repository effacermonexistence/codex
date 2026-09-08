#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  EXPECTED_RELEASE_ID,
  EXPECTED_CONTACT_ID,
  EXPECTED_MESSAGE_ID,
  EXPECTED_NORMALIZED_TEXT_SHA256,
  recoverKnownOmarInfoHold
} = require('./scv-recover-known-omar-info-hold.js')
const {
  VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION
} = require('./scv-immutable-ingress-time.js')
const { latchPath, atomicWriteJson } = require('./scv-golden-fail-close.js')
const { namespacedPersistRoot } = require('./scv-runtime-namespace.js')

const release = {
  ok: true,
  release_id: EXPECTED_RELEASE_ID,
  content_fingerprint_sha256: 'd'.repeat(64)
}

function fixture(mutate = () => {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-known-omar-info-recovery-'))
  const root = namespacedPersistRoot(base, 'prod')
  for (const dir of [
    'outbox_human_agent_required', 'inbox', 'thread-state',
    'thread-history', 'logs', 'control-locks'
  ]) fs.mkdirSync(path.join(root, dir), { recursive: true })
  const env = {
    RAILWAY_ENVIRONMENT_NAME: 'production',
    SCV_RELEASE_MODE: 'production',
    SCV_PERSIST_ROOT: base,
    SCV_RUNTIME_NAMESPACE: 'prod',
    SCV_ROOT: root,
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '1',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: EXPECTED_CONTACT_ID
  }
  const hold = {
    type: 'stale_backlog_human_agent_required',
    manual_reason: 'stale_backlog_over_threshold',
    human_agent_required: true,
    queued_for_human_agent_at: '2026-09-01T19:16:36.818Z',
    held_from_inbox_file: `${EXPECTED_MESSAGE_ID}.json`,
    stale_backlog_age_ms: 900817,
    stale_backlog_threshold_ms: 900000,
    reply_certainty: { certain: false, reason: 'missing_context_for_pending_reply' },
    source_interaction_at: '2026-09-01T19:01:38.024Z',
    received_at: '2026-09-01T19:01:38.024Z',
    contact_id: EXPECTED_CONTACT_ID,
    thread_id: EXPECTED_CONTACT_ID,
    instagram_username: 'omar.system',
    message_id: EXPECTED_MESSAGE_ID,
    text: 'Hi, can I please get more information?'
  }
  const state = {
    contact_id: EXPECTED_CONTACT_ID,
    thread_id: EXPECTED_CONTACT_ID,
    control_revision: 0,
    ingress_revision: 1,
    latest_ingress_message_id: EXPECTED_MESSAGE_ID,
    latest_ingress_text_sha256: EXPECTED_NORMALIZED_TEXT_SHA256,
    last_control_message_id: ''
  }
  const history = {
    contact_id: EXPECTED_CONTACT_ID,
    thread_id: EXPECTED_CONTACT_ID,
    instagram_username: 'omar.system',
    events: [{
      role: 'user',
      message_id: EXPECTED_MESSAGE_ID,
      text: hold.text,
      at: hold.source_interaction_at
    }]
  }
  const data = { base, root, env, hold, state, history, release: { ...release } }
  mutate(data)
  const holdFile = path.join(
    root,
    'outbox_human_agent_required',
    `stale-backlog-hold-1788290196818-${EXPECTED_MESSAGE_ID}.json`
  )
  fs.writeFileSync(holdFile, `${JSON.stringify(data.hold, null, 2)}\n`)
  fs.writeFileSync(
    path.join(root, 'thread-state', `${EXPECTED_CONTACT_ID}.json`),
    `${JSON.stringify(data.state, null, 2)}\n`
  )
  fs.writeFileSync(
    path.join(root, 'thread-history', `${EXPECTED_CONTACT_ID}.json`),
    `${JSON.stringify(data.history, null, 2)}\n`
  )
  return { ...data, holdFile }
}

function expectRefusal(name, mutate, expected) {
  const test = fixture(mutate)
  try {
    assert.throws(() => recoverKnownOmarInfoHold({
      root: test.root,
      env: test.env,
      release: test.release,
      now: new Date('2026-09-01T20:30:00.000Z')
    }), expected, name)
    assert.strictEqual(fs.existsSync(test.holdFile), true, `${name}:hold_preserved`)
    assert.strictEqual(
      fs.existsSync(path.join(test.root, 'inbox', `${EXPECTED_MESSAGE_ID}.json`)),
      false,
      `${name}:inbox_not_mutated`
    )
  } finally { fs.rmSync(test.base, { recursive: true, force: true }) }
}

expectRefusal('release mismatch', (test) => {
  test.release.release_id = 'scv-instagram-single-20260901-v131'
}, /known_omar_recovery_release_mismatch/)

expectRefusal('active fail close', (test) => {
  atomicWriteJson(latchPath({ env: test.env, root: test.root }), {
    schema: 'scv-golden-fail-close-2026-07-25-v2',
    active: true,
    activated_at_utc: '2026-09-01T19:00:45.401Z',
    reason: 'critical_drift_detected'
  })
}, /known_omar_recovery_fail_close_active/)

expectRefusal('forged debug identity', (test) => {
  test.hold.instagram_username = 'forged.omar'
}, /known_omar_recovery_debug_identity_mismatch/)

expectRefusal('later user event', (test) => {
  test.history.events.push({
    role: 'user',
    message_id: 'later-user-message',
    text: 'Later message',
    at: '2026-09-01T19:02:00.000Z'
  })
}, /known_omar_recovery_history_latest_user_mismatch/)

expectRefusal('existing processing receipt', (test) => {
  fs.writeFileSync(path.join(test.root, 'logs', 'inbound-processing-receipts.ndjson'), `${JSON.stringify({
    type: 'inbound_processing_adopted',
    message_id: EXPECTED_MESSAGE_ID
  })}\n`)
}, /known_omar_recovery_existing_receipt/)

const success = fixture((test) => {
  test.hold.type = 'authoritative_latest_recovery_repeat_human_agent_required'
  test.hold.manual_reason = 'authoritative_latest_recovery_repeat_blocked'
  delete test.hold.held_from_inbox_file
  test.hold.held_from_superseded_file = `${EXPECTED_MESSAGE_ID}.json`
  test.hold.operator_recovery = true
  test.hold.operator_recovery_lock_version = VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION
  test.hold.operator_recovery_reason = 'verified_control_plane_repair'
  test.hold.operator_recovery_at = '2026-09-01T19:45:20.340Z'
  test.hold.recovered_from_message_id = EXPECTED_MESSAGE_ID
  test.hold.authoritative_latest_recovered_at = '2026-09-01T19:45:20.729Z'
  test.hold.quarantined_at = '2026-09-01T19:45:20.755Z'
})
try {
  const result = recoverKnownOmarInfoHold({
    root: success.root,
    env: success.env,
    release: success.release,
    now: new Date('2026-09-01T20:30:00.000Z')
  })
  assert.strictEqual(result.ok, true)
  assert.strictEqual(fs.existsSync(success.holdFile), false)
  const inboxFile = path.join(success.root, 'inbox', `${EXPECTED_MESSAGE_ID}.json`)
  const recovered = JSON.parse(fs.readFileSync(inboxFile, 'utf8'))
  assert.strictEqual(recovered.operator_recovery, true)
  assert.strictEqual(
    recovered.operator_recovery_lock_version,
    VERIFIED_STALE_OPERATOR_RECOVERY_LOCK_VERSION
  )
  assert.strictEqual(recovered.operator_recovery_reason, 'verified_control_plane_repair')
  assert.strictEqual(recovered.recovered_from_message_id, EXPECTED_MESSAGE_ID)
  assert.strictEqual(recovered.type, undefined)
  assert.strictEqual(recovered.manual_reason, undefined)
  assert.strictEqual(recovered.held_from_superseded_file, undefined)
  assert.strictEqual(recovered.authoritative_latest_recovered_at, undefined)
  assert.strictEqual(recovered.quarantined_at, undefined)
  assert.strictEqual(
    fs.readdirSync(path.join(success.root, 'outbox_human_agent_required', 'incident-recovered')).length,
    1
  )
  assert.strictEqual(
    fs.existsSync(path.join(success.root, 'control-locks', result.receipt_file_name)),
    true
  )
} finally { fs.rmSync(success.base, { recursive: true, force: true }) }

process.stdout.write(`${JSON.stringify({
  ok: true,
  exact_release_bound: true,
  fail_close_must_be_clear: true,
  code_locked_debug_identity_only: true,
  latest_unanswered_user_turn_required: true,
  prior_processing_receipt_refused: true,
  source_hold_archived: true,
  v132_repeat_hold_transition_recoverable: true,
  verified_operator_recovery_envelope_written: true
}, null, 2)}\n`)
