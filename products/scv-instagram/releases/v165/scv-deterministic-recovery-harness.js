#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const {
  runModelAuthoredFlow,
  buildPreIntentDeterministicBookingPacket
} = require('./codex-dm-runner.js')
const {
  DETERMINISTIC_RECOVERY_VERSION,
  SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES,
  PREFERRED_FORM_LINK,
  buildDeterministicRecoveryPacket,
  buildSafeClarificationRecoveryPacket,
  inputAuthorizesSafeClarificationRecovery,
  isSendFormRecoveryPacket
} = require('./scv-deterministic-recovery.js')
const {
  LOCKED_DEPOSIT_HANDOFF_BUBBLES
} = require('./scv-contract-harness.js')

const DETERMINISTIC_RECOVERY_HARNESS_VERSION =
  'scv-generative-visible-authority-harness-2026-08-25-v15-transcribed-voice-route-lock'

function baseInput(action = 'general_continue', reason = 'ordinary_conversation') {
  const fields = action === 'double_check'
    ? { name: 'Mina', phone: '4157602883', date: 'August 30', time: '2pm' }
    : {}
  return {
    contact_id: `generative-authority-${action}`,
    thread_id: `generative-authority-${action}`,
    instagram_username: 'omar.system',
    message: 'yes plz',
    live_message: 'yes plz',
    received_at: '2026-08-23T12:00:00-07:00',
    recent_history: [],
    structured_output_required: true,
    structured_state: {
      live_turn_reply_required: true,
      known_name_used_on_form: fields.name || '',
      known_phone_used_on_form: fields.phone || '',
      known_requested_date: fields.date || '',
      known_requested_time: fields.time || '',
      form_link_sent: action === 'double_check',
      form_submitted: action === 'double_check',
      booking_stage_hint: action === 'double_check' ? 'ready_for_double_check' : 'open_conversation',
      next_action: action
    },
    control_transition_contract: {
      action,
      reason,
      obligations: [],
      fields
    }
  }
}

function invalidCandidate(action = 'general_continue') {
  return JSON.stringify({
    reply_text: 'sounds good',
    acknowledged_fields: [],
    questioned_fields: [],
    next_action_reflected: action,
    bubbles: [{ text: 'sounds good', delay_ms: 0 }]
  })
}

function successfulExecutor(packet, calls) {
  return async () => {
    calls.count += 1
    return {
      status: 0,
      stderr: '',
      error: '',
      modelUsed: 'gpt-5.6-sol',
      executor: 'openai_responses_conversation',
      lastMessage: JSON.stringify(packet),
      conversation: { replayed_visible_event_count: 3 }
    }
  }
}

async function captureError(work) {
  try {
    await work()
    return ''
  } catch (error) {
    return String(error?.message || error)
  }
}

async function runScvDeterministicRecoveryHarness() {
  const checks = []
  const check = (name, condition, detail = '') => {
    checks.push({ name, pass: Boolean(condition), detail: String(detail || '') })
  }

  check('version_names_explicit_exception_boundary',
    /explicit-verbatim-checkpoints/.test(DETERMINISTIC_RECOVERY_VERSION),
    DETERMINISTIC_RECOVERY_VERSION)

  check('send_form_model_candidate_budget_is_bounded',
    SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES === 3,
    SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES)

  for (const [action, reason] of [
    ['general_continue', 'ordinary_conversation'],
    ['post_form_availability', 'submitted_form_missing_date'],
    ['post_form_availability', 'submitted_form_date_counterproposal_outside_window']
  ]) {
    const input = baseInput(action, reason)
    const error = await captureError(async () => buildDeterministicRecoveryPacket(input))
    check(`deterministic_visible_copy_forbidden_${action}_${reason}`,
      error === `deterministic_visible_recovery_forbidden:${action}`,
      error)
  }

  const prematureSendFormRecoveryError = await captureError(async () =>
    buildDeterministicRecoveryPacket(
      baseInput('send_form', 'explicit_form_request_or_open_offer_consent'),
      null,
      { model_drafts_exhausted: true, model_candidate_count: 2 }
    )
  )
  check('send_form_checkpoint_forbidden_before_full_model_budget',
    prematureSendFormRecoveryError === 'deterministic_send_form_recovery_unauthorized',
    prematureSendFormRecoveryError)

  const sendFormInput = baseInput('send_form', 'explicit_form_request_or_open_offer_consent')
  sendFormInput.structured_state.form_offer_asked = true
  sendFormInput.structured_state.live_turn_form_consent = true
  sendFormInput.recent_history = [
    { role: 'assistant', text: 'want me to send the form?' },
    { role: 'user', text: 'yes plz' }
  ]
  check('yes_plz_form_fulfillment_does_not_bypass_model',
    buildPreIntentDeterministicBookingPacket(sendFormInput) === null)

  const formCalls = { count: 0 }
  const formPacket = {
    reply_text: 'yeah here you go\nhttps://www.effacermonexistence.com/apply\nafter you fill it out what days usually work best for you?',
    acknowledged_fields: ['form_offer', 'form_link'],
    questioned_fields: ['appointment_date'],
    next_action_reflected: 'send_form',
    bubbles: [
      { text: 'yeah here you go', delay_ms: 0 },
      { text: PREFERRED_FORM_LINK, delay_ms: 0 },
      { text: 'after you fill it out what days usually work best for you?', delay_ms: 0 }
    ]
  }
  const formOutput = await runModelAuthoredFlow(sendFormInput, '', {
    authorityExecutor: successfulExecutor(formPacket, formCalls)
  })
  check('form_fulfillment_is_model_authored',
    formCalls.count === 1 &&
      formOutput?.authority?.executor === 'openai_responses_conversation' &&
      formOutput?.authority?.deterministic_recovery === false,
    JSON.stringify(formOutput?.authority || {}))
  check('model_authored_form_preserves_exact_operational_url',
    formOutput.packet.bubbles.filter((bubble) =>
      bubble.text.includes('https://www.effacermonexistence.com/apply')).length === 1,
    formOutput.packet.reply_text)

  const failedExecutorCalls = { count: 0 }
  const executorError = await captureError(() => runModelAuthoredFlow(sendFormInput, '', {
    authorityExecutor: async () => {
      failedExecutorCalls.count += 1
      return {
        status: 1,
        stderr: 'simulated provider failure',
        error: '',
        attempts: [{ attempt: 1, status: 1 }]
      }
    }
  }))
  check('provider_failure_never_becomes_canned_form_copy',
    failedExecutorCalls.count === 1 && executorError.startsWith('codex_exec_failed_'),
    JSON.stringify({ calls: failedExecutorCalls.count, error: executorError }))

  const rejectedCalls = { count: 0 }
  const rejectedRepairLocks = []
  const rejectedOutput = await runModelAuthoredFlow(sendFormInput, '', {
    authorityExecutor: async (_prompt, _input, repairLock) => {
      rejectedCalls.count += 1
      rejectedRepairLocks.push(String(repairLock || ''))
      return {
        status: 0,
        stderr: '',
        error: '',
        modelUsed: 'gpt-5.6-sol',
        executor: 'openai_responses_conversation',
        lastMessage: invalidCandidate('send_form')
      }
    }
  })
  check('yes_plz_exhausts_bounded_fresh_drafts_then_sends_form_checkpoint',
    rejectedCalls.count === SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES &&
      rejectedOutput?.authority?.deterministic_recovery === true &&
      rejectedOutput?.authority?.deterministic_recovery_kind === 'send_form_checkpoint' &&
      rejectedOutput?.authority?.model_reauthor_passes === SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES - 1 &&
      rejectedOutput?.packet?.authority_transport_flags?.atomic_send_form_recovery === true,
    JSON.stringify({ calls: rejectedCalls.count, output: rejectedOutput }))
  check('yes_plz_checkpoint_sends_apply_exactly_once_and_moves_to_availability',
    rejectedOutput.packet.next_action_reflected === 'send_form' &&
      rejectedOutput.packet.reply_text.split(PREFERRED_FORM_LINK).length - 1 === 1 &&
      /\b(?:days|dates|availability|available)\b/i.test(rejectedOutput.packet.reply_text) &&
      !/didn.?t catch|say that again/i.test(rejectedOutput.packet.reply_text),
    rejectedOutput.packet.reply_text)
  check('send_form_reauthor_feedback_is_cumulative',
    rejectedRepairLocks.length === SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES &&
      rejectedRepairLocks[0] === '' &&
      rejectedRepairLocks.slice(2).every((lock, index) =>
        lock.length > rejectedRepairLocks[index + 1].length
      ) &&
      rejectedRepairLocks[rejectedRepairLocks.length - 1].includes('POST FILTER EXECUTED PATH LOCK'),
    JSON.stringify(rejectedRepairLocks.map((lock) => lock.length)))

  const compoundInput = {
    ...sendFormInput,
    message: 'YES PLEASE HOW MUCH IS IT BY THE WAY',
    live_message: 'YES PLEASE HOW MUCH IS IT BY THE WAY',
    recent_history: [
      { role: 'assistant', text: 'want me to send the form?' },
      { role: 'user', text: 'YES PLEASE HOW MUCH IS IT BY THE WAY' }
    ],
    structured_state: {
      ...sendFormInput.structured_state,
      live_turn_pricing_question: true
    },
    control_transition_contract: {
      ...sendFormInput.control_transition_contract,
      obligations: ['send_form_link', 'answer_model_rate']
    }
  }
  const compoundCalls = { count: 0 }
  const compoundOutput = await runModelAuthoredFlow(compoundInput, '', {
    authorityExecutor: async () => {
      compoundCalls.count += 1
      return {
        status: 0,
        stderr: '',
        error: '',
        modelUsed: 'gpt-5.6-sol',
        executor: 'openai_responses_conversation',
        lastMessage: invalidCandidate('send_form')
      }
    }
  })
  check('yes_please_how_much_preserves_atomic_price_form_and_availability',
    compoundCalls.count === SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES &&
      compoundOutput?.authority?.deterministic_recovery_kind === 'send_form_checkpoint' &&
      /\$?150\s+per\s+hour/i.test(compoundOutput.packet.reply_text) &&
      /\b(?:style|visual language)\b/i.test(compoundOutput.packet.reply_text) &&
      compoundOutput.packet.reply_text.split(PREFERRED_FORM_LINK).length - 1 === 1 &&
      /\b(?:days|dates|availability|available)\b/i.test(compoundOutput.packet.reply_text),
    JSON.stringify({ calls: compoundCalls.count, output: compoundOutput }))
  check('send_form_checkpoint_shape_is_exactly_recognized_for_outer_receipt_exemption',
    isSendFormRecoveryPacket(compoundOutput.packet) === true &&
      isSendFormRecoveryPacket({
        ...compoundOutput.packet,
        authority_transport_flags: {
          ...compoundOutput.packet.authority_transport_flags,
          model_candidate_count: SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES - 1
        }
      }) === false &&
      isSendFormRecoveryPacket({
        ...compoundOutput.packet,
        bubbles: compoundOutput.packet.bubbles.slice(0, 2)
      }) === false,
    JSON.stringify(compoundOutput.packet))

  const ordinaryInput = baseInput('general_continue', 'ordinary_conversation')
  const ordinaryRejectedCalls = { count: 0 }
  const ordinaryRejectedError = await captureError(() => runModelAuthoredFlow(ordinaryInput, '', {
    authorityExecutor: async () => {
      ordinaryRejectedCalls.count += 1
      return {
        status: 0,
        stderr: '',
        error: '',
        modelUsed: 'gpt-5.6-sol',
        executor: 'openai_responses_conversation',
        lastMessage: invalidCandidate('general_continue')
      }
    }
  }))
  check('clear_dialogue_exhaustion_stays_on_route_for_outer_reauthor',
    ordinaryRejectedCalls.count === SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES &&
      ordinaryRejectedError.startsWith('post_filter_adoption_rejected_after_reauthor_') &&
      inputAuthorizesSafeClarificationRecovery(ordinaryInput) === false,
    JSON.stringify({ calls: ordinaryRejectedCalls.count, error: ordinaryRejectedError }))

  const clearDateInput = {
    ...baseInput('post_form_availability', 'submitted_form_legal_date_missing_time'),
    message: 'How about August 25th?',
    live_message: 'How about August 25th?',
    structured_state: {
      ...baseInput('post_form_availability', 'submitted_form_legal_date_missing_time').structured_state,
      form_link_sent: true,
      form_submitted: true,
      live_turn_date_phrase: 'August 25th',
      live_turn_date_status: 'legal',
      known_requested_date: 'August 25th'
    }
  }
  check('clear_date_never_authorizes_unintelligible_recovery',
    inputAuthorizesSafeClarificationRecovery(clearDateInput) === false)

  const unintelligibleInput = {
    ...baseInput('resolve_context', 'unintelligible'),
    message: 'sent a voice note that could not be understood',
    live_message: 'sent a voice note that could not be understood',
    structured_state: {
      ...baseInput('resolve_context', 'unintelligible').structured_state,
      live_turn_is_voice_note: true,
      live_turn_voice_transcribe_failed: true,
      live_turn_voice_context_unresolved: true,
      live_turn_context_relation: 'unintelligible',
      live_turn_context_needs_clarification: true
    }
  }
  const unintelligibleCalls = { count: 0 }
  const unintelligibleOutput = await runModelAuthoredFlow(unintelligibleInput, '', {
    authorityExecutor: async () => {
      unintelligibleCalls.count += 1
      return {
        status: 0,
        stderr: '',
        error: '',
        modelUsed: 'gpt-5.6-sol',
        executor: 'openai_responses_conversation',
        lastMessage: invalidCandidate('resolve_context')
      }
    }
  })
  check('genuinely_unintelligible_exhaustion_gets_verified_visible_clarification',
    unintelligibleCalls.count === SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES &&
      unintelligibleOutput?.authority?.deterministic_recovery_kind === 'safe_clarification' &&
      unintelligibleOutput.packet.next_action_reflected === 'resolve_context' &&
      /hear|send it again|type it/i.test(unintelligibleOutput.packet.reply_text),
    JSON.stringify({ calls: unintelligibleCalls.count, output: unintelligibleOutput }))

  const directVoiceRecovery = buildSafeClarificationRecoveryPacket({
    ...baseInput('send_form', 'explicit_form_request_or_open_offer_consent'),
    media_type: 'voice',
    structured_state: {
      ...baseInput('send_form', 'explicit_form_request_or_open_offer_consent').structured_state,
      live_turn_is_voice_note: true,
      live_turn_voice_transcribe_failed: true
    }
  })
  check('voice_safe_clarification_is_visible_and_media_specific',
    directVoiceRecovery.bubbles.length === 1 &&
      /hear|send it again|type it/i.test(directVoiceRecovery.reply_text) &&
      !/photo|reference|post/i.test(directVoiceRecovery.reply_text),
    directVoiceRecovery.reply_text)

  const understoodVoiceInput = {
    ...baseInput('post_form_availability', 'submitted_form_legal_date_missing_time'),
    message: 'sent a voice note saying: How about August 25th?',
    live_message: 'sent a voice note saying: How about August 25th?',
    media_type: 'voice',
    structured_state: {
      ...baseInput('post_form_availability', 'submitted_form_legal_date_missing_time').structured_state,
      live_turn_is_voice_note: true,
      live_turn_voice_transcribe_failed: false,
      live_turn_voice_context_unresolved: false,
      live_turn_date_phrase: 'August 25th',
      live_turn_date_status: 'legal',
      known_requested_date: 'August 25th'
    }
  }
  check('successfully_transcribed_voice_date_cannot_enter_unintelligible_recovery',
    inputAuthorizesSafeClarificationRecovery(understoodVoiceInput) === false,
    JSON.stringify({
      authorized: inputAuthorizesSafeClarificationRecovery(understoodVoiceInput),
      date_status: understoodVoiceInput.structured_state.live_turn_date_status,
      voice_transcribe_failed: understoodVoiceInput.structured_state.live_turn_voice_transcribe_failed
    }))

  const doubleInput = baseInput('double_check', 'all_four_fields_known')
  const doublePacket = buildDeterministicRecoveryPacket(doubleInput)
  check('explicit_four_field_double_check_remains_verbatim',
    doublePacket.reply_text ===
      'Name : Mina\nPhone Number : 4157602883\nAppointment date : August 30\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤',
    doublePacket.reply_text)

  const depositInput = baseInput('deposit_handoff', 'double_check_confirmed')
  const depositPacket = buildDeterministicRecoveryPacket(depositInput)
  check('explicit_deposit_handoff_remains_verbatim',
    JSON.stringify(depositPacket.bubbles.map((bubble) => bubble.text)) ===
      JSON.stringify(LOCKED_DEPOSIT_HANDOFF_BUBBLES),
    JSON.stringify(depositPacket.bubbles))

  const runnerSource = fs.readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
  const modelFlowSource = runnerSource.slice(
    runnerSource.indexOf('async function runModelAuthoredFlow('),
    runnerSource.indexOf('// ============================================================\n// LLM INTENT CLASSIFIER')
  )
  const executorSource = runnerSource.slice(
    runnerSource.indexOf('async function runAuthorityExecutor('),
    runnerSource.indexOf('function buildAiVisibleRouteLock(')
  )
  check('model_flow_limits_transactional_recovery_to_send_form_after_exhaustion',
    modelFlowSource.includes('buildSafeClarificationRecoveryPacket(') &&
      modelFlowSource.includes('buildDeterministicRecoveryPacket(') &&
      modelFlowSource.includes('sendFormRecoveryAuthorized'))
  check('visible_executor_has_no_codex_cli_fallback',
    !executorSource.includes("executor = 'codex_cli'") &&
      executorSource.includes('runOpenAIResponses('))
  const authoritySource = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')
  check('safe_clarification_bypasses_original_route_fact_floors',
    /deterministic_recovery_kind !== 'safe_clarification'[\s\S]{0,500}applyFinalPricingFloor/.test(authoritySource) &&
      /deterministic_recovery_kind !== 'safe_clarification'[\s\S]{0,700}applyExplainOnInterestFloor/.test(authoritySource))

  const failed = checks.filter((item) => !item.pass)
  return {
    ok: failed.length === 0,
    harness_version: DETERMINISTIC_RECOVERY_HARNESS_VERSION,
    model_candidate_calls: rejectedCalls.count,
    checked: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks
  }
}

if (require.main === module) {
  runScvDeterministicRecoveryHarness()
    .then((receipt) => {
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
      if (!receipt.ok) process.exit(1)
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error)}\n`)
      process.exit(1)
    })
}

module.exports = {
  DETERMINISTIC_RECOVERY_HARNESS_VERSION,
  runScvDeterministicRecoveryHarness
}
