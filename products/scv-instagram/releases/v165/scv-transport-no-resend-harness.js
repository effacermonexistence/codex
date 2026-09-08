#!/usr/bin/env node
const crypto = require('crypto')
const path = require('path')
const {
  finalSenderPauseVerdict,
  sendBubble,
  sendWithVisibilityGuarantee
} = require(path.join(__dirname, 'outbound-scv2.js'))
const {
  isDeliveryOutcomeAmbiguous,
  transportAttemptIsAmbiguous
} = require(path.join(__dirname, 'outbox-worker.js'))

const LOCK_VERSION = 'scv-transport-no-resend-2026-08-19-v1'

async function withUnpausedLocalHarnessEnvironment(fn) {
  const overrides = {
    RAILWAY_ENVIRONMENT_NAME: 'local',
    SCV_RELEASE_MODE: 'local',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0'
  }
  const prior = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]])
  )
  Object.assign(process.env, overrides)
  try {
    return await fn()
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function runHarness() {
  return withUnpausedLocalHarnessEnvironment(async () => {
  let checked = 0
  const ok = (condition, label, detail = '') => {
    checked += 1
    if (!condition) throw new Error(`${label}${detail ? `:${detail}` : ''}`)
  }

  const exactProviderBytes = Buffer.from(
    '{"status":"success","data":{"message_id":"manychat-exact-raw-1"}}\n'
  )
  const originalFetch = global.fetch
  try {
    global.fetch = async () => new Response(exactProviderBytes, { status: 200 })
    const rawResult = await sendBubble('2000', { text: 'raw evidence probe' })
    ok(rawResult.provider_response_body_base64 === exactProviderBytes.toString('base64'),
      'provider_response_preserves_exact_bytes')
    ok(rawResult.provider_response_sha256 ===
      crypto.createHash('sha256').update(exactProviderBytes).digest('hex'),
    'provider_response_hash_binds_exact_bytes')
    ok(rawResult.provider_response_size_bytes === exactProviderBytes.length,
      'provider_response_size_binds_exact_bytes')
    ok(rawResult.provider_receipt_id_present === true &&
      rawResult.provider_receipt_id === 'manychat-exact-raw-1' &&
      rawResult.provider_receipt_id_path === 'data.message_id',
    'provider_receipt_id_is_raw_response_derived')
  } finally {
    global.fetch = originalFetch
  }

  let calls = []
  let probes = 0
  const accepted = await sendWithVisibilityGuarantee('2001', 'real.lead', { text: 'hey' }, {
    sendBubble: async (_contact, _bubble, tag = '') => {
      calls.push(tag)
      return { status: 200, body: { status: 'success' } }
    },
    getInstagramRuntimeStatus: () => ({ client_exists: true }),
    confirmOutgoingTextVisible: async () => { probes += 1; return { confirmed: false } }
  })
  ok(calls.length === 1, 'accepted_manychat_never_uses_second_transport', JSON.stringify(calls))
  ok(probes === 1, 'visibility_probe_is_audit_only')
  ok(accepted.ok === true && accepted.body.delivery_accepted === true && accepted.body.delivery_confirmed === false, 'accepted_unverified_is_terminal_attempt')
  ok(accepted.body.delivery_method === 'manychat_api_accepted_unverified', 'accepted_unverified_status_is_honest')

  calls = []
  const probeError = await sendWithVisibilityGuarantee('2002', 'real.lead', { text: 'hello' }, {
    sendBubble: async (_contact, _bubble, tag = '') => {
      calls.push(tag)
      return { status: 200, body: { status: 'success' } }
    },
    getInstagramRuntimeStatus: () => ({ client_exists: true }),
    confirmOutgoingTextVisible: async () => { throw new Error('probe_down') }
  })
  ok(calls.length === 1, 'probe_failure_never_resends')
  ok(probeError.ok === true && probeError.body.verification.reason === 'instagram_visibility_probe_failed', 'probe_failure_recorded_not_retried')

  calls = []
  const tagged = await sendWithVisibilityGuarantee('2003', 'real.lead', { text: 'still there?' }, {
    sendBubble: async (_contact, _bubble, tag = '') => {
      calls.push(tag)
      if (!tag) return { status: 400, body: { status: 'error', code: 3031, message: 'last interaction over 24 hours' } }
      return { status: 200, body: { status: 'success' } }
    },
    getInstagramRuntimeStatus: () => ({ client_exists: false }),
    confirmOutgoingTextVisible: async () => ({ confirmed: false })
  })
  ok(calls.length === 2 && calls[0] === '' && calls[1] === 'HUMAN_AGENT', 'explicit_window_rejection_gets_one_tagged_retry', JSON.stringify(calls))
  ok(tagged.ok === true && tagged.body.delivery_accepted === true, 'tagged_retry_acceptance_terminal')

  calls = []
  const held = await sendWithVisibilityGuarantee('2004', 'real.lead', { text: 'blocked' }, {
    sendBubble: async (_contact, _bubble, tag = '') => {
      calls.push(tag)
      return { status: 0, paused_all: true, body: { held: 'scv_pause_all' } }
    },
    getInstagramRuntimeStatus: () => ({ client_exists: true }),
    confirmOutgoingTextVisible: async () => { throw new Error('must_not_probe') }
  })
  ok(calls.length === 1, 'pause_all_has_exactly_zero_fallback_paths')
  ok(held.ok === false && held.status === 423 && held.body.held === true && held.body.reason === 'scv_pause_all', 'pause_all_remains_held')

  calls = []
  const ambiguous = await sendWithVisibilityGuarantee('2005', 'real.lead', { text: 'one attempt only' }, {
    sendBubble: async () => {
      calls.push('attempt')
      throw new Error('socket closed after request write')
    },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  ok(calls.length === 1, 'ambiguous_provider_exception_never_resends')
  ok(ambiguous.ok === false && ambiguous.body.delivery_outcome_ambiguous === true && ambiguous.body.do_not_retry === true, 'ambiguous_provider_exception_is_fail_closed')
  ok(isDeliveryOutcomeAmbiguous({ body: { result: ambiguous } }) === true, 'durable_worker_recognizes_ambiguous_provider_result')
  ok(isDeliveryOutcomeAmbiguous({ http_status: 200, body: { raw: 'truncated response' } }) === true, 'malformed_2xx_final_sender_response_is_ambiguous')
  for (const httpStatus of [408, 500, 502, 503, 504]) {
    ok(isDeliveryOutcomeAmbiguous({ http_status: httpStatus, body: { ok: false } }) === true, `outer_final_sender_${httpStatus}_is_ambiguous`)
  }
  ok(transportAttemptIsAmbiguous(true, false) === true && transportAttemptIsAmbiguous(true, true) === false, 'lost_final_sender_response_is_never_blindly_retried')

  calls = []
  const provider500 = await sendWithVisibilityGuarantee('2007', 'real.lead', { text: 'provider uncertain' }, {
    sendBubble: async () => {
      calls.push('attempt')
      return { status: 500, body: { status: 'error', message: 'internal provider error' } }
    },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  ok(calls.length === 1, 'provider_5xx_never_blindly_resends')
  ok(provider500.ok === false && provider500.body.delivery_outcome_ambiguous === true && provider500.body.do_not_retry === true, 'provider_5xx_requires_reconciliation')

  calls = []
  const runtimeProbeError = await sendWithVisibilityGuarantee('2008', 'real.lead', { text: 'accepted once' }, {
    sendBubble: async () => {
      calls.push('attempt')
      return { status: 200, body: { status: 'success' } }
    },
    getInstagramRuntimeStatus: () => { throw new Error('runtime probe exploded') }
  })
  ok(calls.length === 1, 'runtime_status_probe_failure_after_acceptance_never_resends')
  ok(runtimeProbeError.ok === true && runtimeProbeError.body.delivery_accepted === true && runtimeProbeError.body.verification.reason === 'instagram_runtime_status_probe_failed_manychat_accepted', 'runtime_status_probe_failure_is_audit_only')

  calls = []
  const taggedRetryAmbiguous = await sendWithVisibilityGuarantee('2009', 'real.lead', { text: 'tagged attempt uncertain' }, {
    sendBubble: async (_contact, _bubble, tag = '') => {
      calls.push(tag)
      if (!tag) return { status: 400, body: { status: 'error', code: 3031 } }
      throw new Error('tagged request response lost')
    },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  ok(calls.length === 2 && calls[1] === 'HUMAN_AGENT', 'tagged_retry_exception_stops_after_two_attempts')
  ok(taggedRetryAmbiguous.ok === false && taggedRetryAmbiguous.body.delivery_outcome_ambiguous === true && taggedRetryAmbiguous.body.do_not_retry === true, 'tagged_retry_exception_requires_reconciliation')

  const priorDefaultTag = process.env.SCV_MANYCHAT_MESSAGE_TAG
  process.env.SCV_MANYCHAT_MESSAGE_TAG = 'HUMAN_AGENT'
  const poisonedDefault = require(path.join(__dirname, 'outbound-scv2.js')).buildSendBody('2010', { text: 'ordinary first attempt' })
  let unsafePrecisionIdentityRejected = false
  try {
    require(path.join(__dirname, 'outbound-scv2.js')).buildSendBody(
      '9007199254740993', { text: 'must never target a rounded subscriber id' }
    )
  } catch (error) {
    unsafePrecisionIdentityRejected =
      /manychat_subscriber_id_not_safe_integer/.test(String(error?.message || error))
  }
  ok(unsafePrecisionIdentityRejected, 'unsafe_integer_precision_identity_never_reaches_manychat')
  if (priorDefaultTag == null) delete process.env.SCV_MANYCHAT_MESSAGE_TAG
  else process.env.SCV_MANYCHAT_MESSAGE_TAG = priorDefaultTag
  ok(!('message_tag' in poisonedDefault), 'environment_cannot_privilege_tag_first_attempt')

  calls = []
  const nonWindow = await sendWithVisibilityGuarantee('2011', 'real.lead', { text: 'ordinary rejection' }, {
    sendBubble: async (_contact, _bubble, tag = '') => {
      calls.push(tag)
      return { status: 400, body: { status: 'error', code: 9999 } }
    },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  ok(calls.length === 1 && nonWindow.ok === false, 'non_window_error_never_gets_privileged_retry')

  calls = []
  const pausedBeforeFirstAttempt = await sendWithVisibilityGuarantee('2012', 'real.lead', { text: 'pause race' }, {
    sendBubble: async () => { calls.push('unexpected'); return { status: 200, body: { status: 'success' } } },
    isPausedForPacket: () => true,
    getInstagramRuntimeStatus: () => { throw new Error('must_not_probe') }
  })
  ok(calls.length === 0, 'pause_race_before_first_attempt_makes_zero_provider_calls')
  ok(pausedBeforeFirstAttempt.status === 423 && pausedBeforeFirstAttempt.body.held === true && pausedBeforeFirstAttempt.body.retryable === false, 'pause_race_before_first_attempt_propagates_hold')

  calls = []
  let pauseChecks = 0
  const pausedBeforeTaggedRetry = await sendWithVisibilityGuarantee('2013', 'real.lead', { text: 'pause before retry' }, {
    sendBubble: async (_contact, _bubble, tag = '') => {
      calls.push(tag)
      return { status: 400, body: { status: 'error', code: 3031 } }
    },
    isPausedForPacket: () => {
      pauseChecks += 1
      return pauseChecks >= 2
    },
    getInstagramRuntimeStatus: () => { throw new Error('must_not_probe') }
  })
  ok(calls.length === 1 && calls[0] === '', 'pause_before_tagged_retry_makes_no_second_provider_call')
  ok(pausedBeforeTaggedRetry.status === 423 && pausedBeforeTaggedRetry.body.held === true && pausedBeforeTaggedRetry.body.pause_stage === 'human_agent_retry', 'pause_before_tagged_retry_propagates_hold')

  const debugEnv = {
    SCV_RELEASE_MODE: 'local',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: '1'
  }
  ok(finalSenderPauseVerdict({ instagram_username: 'omar.system', contact_id: '1537753982' }, debugEnv).held === true, 'final_sender_holds_debug_identity')
  ok(finalSenderPauseVerdict({ instagram_username: 'real.lead', contact_id: '2006' }, debugEnv).held === false, 'final_sender_allows_real_identity')

  return { ok: true, lock_version: LOCK_VERSION, checked }
  })
}

if (require.main === module) {
  runHarness()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
      process.exit(1)
    })
}

module.exports = { LOCK_VERSION, runHarness }
