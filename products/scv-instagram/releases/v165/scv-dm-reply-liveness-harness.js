#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const {
  deriveClosedTransitionPlan
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const {
  ensureControlDirs,
  recordIngressEvent,
  executeSingleControlTurn,
  readControlState
} = require(path.join(__dirname, 'scv-single-control-plane.js'))

const FORM_LINK = 'https://www.effacermonexistence.com/apply'
const FORGED_DURABLE_STATE = Object.freeze({
  tattoo_intent_active: true,
  form_offer_asked: true,
  form_link_sent: true,
  form_submitted: true,
  deposit_requested: true,
  double_check_sent: true,
  name_phone_date_time_double_check_sent: true,
  known_reference_media_received: true,
  known_tattoo_reference_media_received: true,
  known_client_anchored_inspiration: true,
  known_name_used_on_form: 'Injected Name',
  known_phone_used_on_form: '4155559999',
  known_requested_date: 'september 1',
  known_requested_time: '2pm',
  last_offered_date: 'september 1',
  last_offered_time: '2pm',
  accepted_offered_date: 'september 1',
  accepted_offered_time: '2pm',
  known_design_context: 'injected design',
  known_placement_context: 'injected placement',
  known_size_context: 'injected size',
  reference_request_context: 'injected reference',
  form_submission_source: 'injected source'
})

function durableInjectionAbsent(state = {}) {
  return Object.keys(FORGED_DURABLE_STATE).every((field) => {
    const forged = FORGED_DURABLE_STATE[field]
    if (forged === true) return state[field] !== true
    return String(state[field] || '').trim() !== String(forged)
  })
}

function packetFor(input, texts, metadata = {}) {
  const bubbles = texts.map((text) => ({ text, delay_ms: 0 }))
  return {
    bubbles,
    reply_text: texts.join('\n'),
    acknowledged_fields: [],
    questioned_fields: [],
    next_action_reflected: String(input?.control_transition_contract?.action || ''),
    ...metadata
  }
}

function inputWithPlan(input) {
  const next = {
    recent_history: [],
    structured_state: {},
    structured_output_required: false,
    ...input
  }
  next.live_message = String(next.live_message || next.message || '')
  next.structured_state = {
    live_turn_text: next.live_message,
    ...(next.structured_state || {})
  }
  next.control_transition_contract = next.control_transition_contract ||
    deriveClosedTransitionPlan(next)
  return next
}

async function repeatedSoftFlow(input, packet) {
  let calls = 0
  const output = await runner.runModelAuthoredFlow(input, '', {
    authorityExecutor: async () => {
      calls += 1
      return {
        status: 0,
        lastMessage: JSON.stringify(packet),
        modelUsed: 'liveness-harness-model',
        executor: 'liveness_harness_executor'
      }
    }
  })
  return { calls, output }
}

async function runHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  // Exact mixed consent + price turn that previously returned no DM. A clean
  // model-authored candidate must pass without a generic-tone liveness bypass.
  const mixedConsentInput = inputWithPlan({
    message: 'YES PLEASE HOW MUCH IS IT BY THE WAY',
    recent_history: [{ role: 'assistant', text: 'want me to send the application form?' }],
    structured_state: { form_offer_asked: true }
  })
  const mixedConsentPacket = packetFor(mixedConsentInput, [
    'yeah its my discounted model rate at $150 per hour when the finished piece stays in my own style',
    FORM_LINK,
    'once its in what dates are you available'
  ])
  const mixedConsent = await repeatedSoftFlow(mixedConsentInput, mixedConsentPacket)
  check('mixed_consent_price_clean_candidate_passes_first_try', mixedConsent.calls === 1, mixedConsent.calls)
  check(
    'mixed_consent_price_returns_visible_form_rate_and_date_tail',
    mixedConsent.output.packet.bubbles.some((bubble) => bubble.text.includes(FORM_LINK)) &&
      mixedConsent.output.packet.bubbles.some((bubble) => /\$150 per hour/i.test(bubble.text)) &&
      mixedConsent.output.packet.bubbles.some((bubble) => /what dates/i.test(bubble.text)),
    JSON.stringify(mixedConsent.output.packet)
  )
  check('mixed_consent_price_has_no_soft_liveness_adoption', mixedConsent.output.authority.liveness_adoption !== true)

  const submittedInput = inputWithPlan({
    message: 'I just submit',
    recent_history: [
      { role: 'assistant', text: FORM_LINK },
      { role: 'assistant', text: 'once its in what dates are you free' }
    ],
    structured_state: {
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      live_turn_form_submitted_signal: true
    }
  })
  const submitted = await repeatedSoftFlow(
    submittedInput,
    packetFor(submittedInput, ['got it what dates are you available'])
  )
  check('just_submit_clean_candidate_returns_reply', submitted.calls === 1 && submitted.output.packet.bubbles.length === 1)
  check(
    'just_submit_stays_on_post_form_date_route',
    submittedInput.control_transition_contract.action === 'post_form_availability' &&
      /what dates are you available/i.test(submitted.output.packet.bubbles[0].text),
    JSON.stringify({ plan: submittedInput.control_transition_contract, packet: submitted.output.packet })
  )

  // Every observed August 25-30 rejected-date continuation remains bound to the
  // exact proposed date plus the already-grounded September 1 alternative.
  for (const day of [25, 26, 27, 28, 29, 30]) {
    const message = `How about August ${day}th`
    const dateInput = inputWithPlan({
      message,
      received_at: '2026-08-25T18:00:00.000Z',
      recent_history: [{ role: 'assistant', text: 'what date works for you' }],
      structured_state: {
        form_link_sent: true,
        form_submitted: true,
        live_turn_form_submitted_signal: true,
        live_turn_date_phrase: `august ${day}`,
        live_turn_date_status: 'too_soon',
        last_offered_date: 'september 1',
        last_offered_time: '2pm'
      }
    })
    const datePacket = packetFor(dateInput, [
      `august ${day} is too soon for me but september 1 at 2pm is the closest opening i have would september 1 work for you`
    ])
    const dateFlow = await repeatedSoftFlow(dateInput, datePacket)
    check(
      `august_${day}_clean_candidate_has_visible_grounded_reply`,
      dateFlow.calls === 1 &&
        dateFlow.output.packet.bubbles.length === 1 &&
        dateFlow.output.authority.liveness_adoption !== true,
      JSON.stringify(dateFlow.output)
    )
    check(
      `august_${day}_cannot_drift_from_grounded_alternative`,
      dateInput.control_transition_contract.reason === 'submitted_form_date_counterproposal_outside_window' &&
        dateFlow.output.packet.bubbles[0].text.includes(`august ${day}`) &&
        dateFlow.output.packet.bubbles[0].text.includes('september 1 at 2pm'),
      JSON.stringify(dateInput.control_transition_contract)
    )
  }

  const sureThingInput = inputWithPlan({
    message: 'sure thing',
    received_at: '2026-08-25T18:00:00.000Z',
    recent_history: [{ role: 'assistant', text: 'september 1 at 2pm is the closest opening i have would that work for you' }],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      live_turn_form_submitted_signal: true,
      live_turn_accepts_offered_slot: true,
      known_name_used_on_form: 'Omar',
      known_phone_used_on_form: '4155550100',
      known_requested_date: 'september 1',
      known_requested_time: '2pm',
      last_offered_date: 'september 1',
      last_offered_time: '2pm',
      accepted_offered_date: 'september 1',
      accepted_offered_time: '2pm'
    }
  })
  const sureThing = runner.buildDeterministicBookingPacket(sureThingInput)
  check(
    'sure_thing_accepted_slot_returns_four_field_checkpoint',
    sureThing?.packet?.bubbles?.length === 1 &&
      /Name : Omar/i.test(sureThing.packet.bubbles[0].text) &&
      /Appointment date : 1st of September/i.test(sureThing.packet.bubbles[0].text) &&
      /Time : 2pm/i.test(sureThing.packet.bubbles[0].text),
    JSON.stringify({ plan: sureThingInput.control_transition_contract, output: sureThing })
  )

  const doubleCheckInput = inputWithPlan({
    message: 'yes',
    recent_history: [{
      role: 'assistant',
      text: 'Name : Omar\nPhone Number : 4155550100\nAppointment date : 1st of September\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤'
    }],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Omar',
      known_phone_used_on_form: '4155550100',
      known_requested_date: 'september 1',
      known_requested_time: '2pm',
      name_phone_date_time_double_check_sent: true,
      double_check_sent: true
    }
  })
  const deposit = runner.buildDeterministicBookingPacket(doubleCheckInput)
  check(
    'double_check_yes_moves_directly_to_deposit',
    deposit?.packet?.bubbles?.some((bubble) => /deposit (?:would be|is) 100/i.test(bubble.text)) &&
      deposit.packet.bubbles.some((bubble) => /contact@omarprotocol\.com/i.test(bubble.text)),
    JSON.stringify(deposit)
  )

  const socialInput = inputWithPlan({ message: 'how are you' })
  const socialPacket = packetFor(socialInput, [
    'im good what are you up to'
  ])
  const socialFlow = await repeatedSoftFlow(socialInput, socialPacket)
  let dashRepairCalls = 0
  let dashRepairLock = ''
  const dashRepairFlow = await runner.runModelAuthoredFlow(socialInput, '', {
    authorityExecutor: async (_promptText, _input, repairLock) => {
      dashRepairCalls += 1
      dashRepairLock = String(repairLock || '')
      const packet = packetFor(socialInput, [
        dashRepairCalls === 1 ? 'im good — what are you up to' : 'im good what are you up to'
      ])
      return {
        status: 0,
        lastMessage: JSON.stringify(packet),
        modelUsed: 'liveness-harness-model',
        executor: 'liveness_harness_executor'
      }
    }
  })
  check(
    'dash_surface_reauthors_once_then_returns_visible_reply',
    dashRepairCalls === 2 &&
      dashRepairFlow.packet.bubbles.length === 1 &&
      !/[\u002d\u2010\u2011\u2012\u2013\u2014\u2015\u2212\ufe58\ufe63\uff0d]/u.test(dashRepairFlow.packet.bubbles[0].text) &&
      dashRepairFlow.authority.liveness_adoption !== true,
    JSON.stringify({ dashRepairCalls, packet: dashRepairFlow.packet })
  )
  check(
    'dash_surface_repair_lock_is_explicit',
    dashRepairLock.includes('CLIENT SURFACE DASH CHARACTER EXECUTOR LOCK'),
    dashRepairLock
  )
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-dm-reply-liveness-'))
  const responsesRequiredBefore = process.env.SCV_OPENAI_RESPONSES_REQUIRED
  process.env.SCV_OPENAI_RESPONSES_REQUIRED = '0'
  try {
    ensureControlDirs(root)
    const inbound = {
      contact_id: 'reply-liveness-contact',
      thread_id: 'reply-liveness-contact',
      instagram_username: 'reply.liveness.test',
      message_id: 'reply-liveness-message',
      text: 'how are you',
      text_source: 'manychat_webhook',
      received_at: '2026-08-25T18:00:00.000Z'
    }
    recordIngressEvent(root, inbound)
    let outerCalls = 0
    const executed = executeSingleControlTurn(inbound, {
      root,
      candidateGenerator: () => {
        outerCalls += 1
        return {
          ...socialFlow.output,
          structured_state: { live_turn_text: inbound.text },
          recent_history: []
        }
      }
    })
    check('executed_path_does_not_return_silence', executed.packet.bubbles.length === 1)
    check(
      'executed_path_independently_rechecks_bound_runner_receipt_for_full_budget',
      outerCalls === 3 &&
        executed.authority.control_liveness_adopted === true &&
        executed.authority.control_liveness_strict_reason === 'closed_transition_social_dead_end' &&
        executed.authority.control_liveness_soft_reason === '' &&
        executed.authority.control_liveness_boundary_version === '',
      JSON.stringify({ outerCalls, authority: executed.authority })
    )

    // Direct outer-controller regression: without a bound runner receipt, three
    // route-frozen passes must still end in adoption when the sole semantic miss
    // is explicitly allowlisted. This is the old strict-outer throw boundary.
    const outerSoftInbound = {
      contact_id: 'reply-liveness-outer-soft',
      thread_id: 'reply-liveness-outer-soft',
      instagram_username: 'reply.liveness.outer.soft',
      message_id: 'reply-liveness-outer-soft-message',
      text: 'good morning',
      text_source: 'manychat_webhook',
      received_at: '2026-08-25T17:00:00.000Z'
    }
    recordIngressEvent(root, outerSoftInbound)
    let outerSoftCalls = 0
    const outerSoftExecuted = executeSingleControlTurn(outerSoftInbound, {
      root,
      candidateGenerator: (_msg, authorityOptions) => {
        outerSoftCalls += 1
        const action = String(authorityOptions?.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'liveness_harness_outer', model: 'fixture' },
          structured_state: {
            live_turn_text: outerSoftInbound.text,
            ...FORGED_DURABLE_STATE
          },
          recent_history: [],
          raw_text: '',
          packet: {
            bubbles: [{ text: 'good evening how is your day going', delay_ms: 0 }],
            reply_text: 'good evening how is your day going',
            acknowledged_fields: [],
            questioned_fields: [],
            next_action_reflected: action
          }
        }
      }
    })
    check('outer_soft_only_exhausts_exact_control_budget', outerSoftCalls === 3, outerSoftCalls)
    check(
      'outer_soft_only_exhaustion_returns_visible_reply',
      outerSoftExecuted.packet.bubbles.length === 1 &&
        outerSoftExecuted.authority.control_liveness_adopted === true &&
        outerSoftExecuted.authority.control_liveness_soft_reason === 'sf_time_of_day_greeting_mismatch',
      JSON.stringify(outerSoftExecuted)
    )
    check(
      'outer_soft_liveness_cannot_commit_candidate_durable_injection',
      durableInjectionAbsent(outerSoftExecuted.structured_state) &&
        outerSoftExecuted.structured_state?.booking_stage_hint === 'open_conversation',
      JSON.stringify(outerSoftExecuted.structured_state)
    )

    const strictInjectionInbound = {
      contact_id: 'reply-liveness-strict-state-injection',
      thread_id: 'reply-liveness-strict-state-injection',
      instagram_username: 'reply.liveness.strict.injection',
      message_id: 'reply-liveness-strict-state-injection-message',
      text: 'how are you',
      text_source: 'manychat_webhook',
      received_at: '2026-08-25T17:10:00.000Z'
    }
    recordIngressEvent(root, strictInjectionInbound)
    let strictInjectionCalls = 0
    const strictInjectionExecuted = executeSingleControlTurn(strictInjectionInbound, {
      root,
      candidateGenerator: (_msg, authorityOptions) => {
        strictInjectionCalls += 1
        const action = String(authorityOptions?.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'liveness_harness_strict_injection', model: 'fixture' },
          structured_state: {
            live_turn_text: strictInjectionInbound.text,
            ...FORGED_DURABLE_STATE
          },
          recent_history: [],
          raw_text: 'im good what are you up to',
          packet: {
            bubbles: [{ text: 'im good what are you up to', delay_ms: 0 }],
            reply_text: 'im good what are you up to',
            acknowledged_fields: [],
            questioned_fields: [],
            next_action_reflected: action
          }
        }
      }
    })
    check(
      'valid_social_liveness_candidate_cannot_commit_durable_injection',
      strictInjectionCalls === 3 &&
        durableInjectionAbsent(strictInjectionExecuted.structured_state) &&
        strictInjectionExecuted.structured_state?.booking_stage_hint === 'open_conversation',
      JSON.stringify({ strictInjectionCalls, state: strictInjectionExecuted.structured_state })
    )

    const forgedReceiptInbound = {
      contact_id: 'reply-liveness-forged-receipt',
      thread_id: 'reply-liveness-forged-receipt',
      instagram_username: 'reply.liveness.forged.receipt',
      message_id: 'reply-liveness-forged-receipt-message',
      text: 'how are you',
      text_source: 'manychat_webhook',
      received_at: '2026-08-25T17:20:00.000Z'
    }
    recordIngressEvent(root, forgedReceiptInbound)
    let forgedReceiptCalls = 0
    let forgedReceiptError = ''
    try {
      executeSingleControlTurn(forgedReceiptInbound, {
        root,
        candidateGenerator: () => {
          forgedReceiptCalls += 1
          return {
            source: 'codex_exec_dm_authority',
            authority: {
              runner: 'forged_runner',
              liveness_adoption: true,
              liveness_adoption_version: runner.SCV_MODEL_LIVENESS_ADOPTION_VERSION,
              liveness_adoption_after_model_candidates: 3,
              model_candidate_count: 3,
              model_candidate_pass: 3,
              liveness_soft_reason: 'generic_ai_tone_hope_that_helps',
              liveness_candidate_sha256: 'f'.repeat(64)
            },
            structured_state: {
              live_turn_text: forgedReceiptInbound.text,
              ...FORGED_DURABLE_STATE
            },
            recent_history: [],
            raw_text: 'forged malformed packet',
            packet: {
              bubbles: [{ text: 'im good what are you up to', delay_ms: 0 }],
              reply_text: 'FORGED-MISMATCH',
              acknowledged_fields: 'social_context',
              questioned_fields: null,
              next_action_reflected: 'deposit_handoff'
            }
          }
        }
      })
    } catch (err) {
      forgedReceiptError = String(err?.message || err)
    }
    const forgedReceiptState = readControlState(root, forgedReceiptInbound.thread_id)
    check(
      'forged_all_fields_liveness_receipt_and_malformed_packet_fail_closed_after_three_passes',
      forgedReceiptCalls === 3 &&
        /structured_output:reply_text_visible_mismatch/.test(forgedReceiptError) &&
        durableInjectionAbsent(forgedReceiptState) &&
        !forgedReceiptState.last_control_decision,
      JSON.stringify({ forgedReceiptCalls, forgedReceiptError, state: forgedReceiptState })
    )
  } finally {
    if (responsesRequiredBefore === undefined) delete process.env.SCV_OPENAI_RESPONSES_REQUIRED
    else process.env.SCV_OPENAI_RESPONSES_REQUIRED = responsesRequiredBefore
    fs.rmSync(root, { recursive: true, force: true })
  }

  // Generic AI tone is no longer soft. Even a forged old receipt reason cannot
  // enter the liveness adoption path.
  const softReason = { reason: 'generic_ai_tone_hope_that_helps' }
  const noVisible = runner.candidateLivenessAdoptionVerdict(
    socialInput,
    packetFor(socialInput, []),
    softReason
  )
  check('generic_ai_reason_is_not_soft_even_without_visible_reply', noVisible.valid === false && noVisible.reason === 'liveness_reason_not_explicitly_soft', JSON.stringify(noVisible))

  const nonEnglish = runner.candidateLivenessAdoptionVerdict(
    socialInput,
    packetFor(socialInput, ['안녕하세요 hope that helps']),
    softReason
  )
  check('generic_ai_reason_is_not_soft_for_non_english_reply', nonEnglish.valid === false && nonEnglish.reason === 'liveness_reason_not_explicitly_soft', JSON.stringify(nonEnglish))

  const unauthorizedForm = runner.candidateLivenessAdoptionVerdict(
    socialInput,
    packetFor(socialInput, [`hope that helps ${FORM_LINK}`]),
    softReason
  )
  check('hard_unauthorized_form_rejected', unauthorizedForm.valid === false, JSON.stringify(unauthorizedForm))

  const unauthorizedDeposit = runner.candidateLivenessAdoptionVerdict(
    socialInput,
    packetFor(socialInput, ['hope that helps the deposit is $100 zelle is contact@omarprotocol.com']),
    softReason
  )
  check('hard_unauthorized_deposit_rejected', unauthorizedDeposit.valid === false, JSON.stringify(unauthorizedDeposit))

  const postDepositInput = inputWithPlan({
    message: 'thanks',
    structured_state: { deposit_requested: true },
    control_transition_contract: {
      version: 'liveness-harness-plan',
      action: 'deposit_pending_continue',
      reason: 'deposit_handoff_already_complete',
      obligations: [],
      stage: 'deposit_pending',
      fields: {},
      live_intent: {}
    }
  })
  const backtrack = runner.candidateLivenessAdoptionVerdict(
    postDepositInput,
    packetFor(postDepositInput, ['hope that helps what date works for you']),
    softReason
  )
  check(
    'hard_post_deposit_backtrack_rejected',
    backtrack.valid === false && backtrack.reason === 'liveness_reason_not_explicitly_soft',
    JSON.stringify(backtrack)
  )

  const routeMismatchInput = inputWithPlan({
    message: 'How about August 25th',
    control_transition_contract: {
      version: 'liveness-harness-plan',
      action: 'post_form_time',
      reason: 'submitted_form_date_known_time_missing',
      obligations: [],
      stage: 'time_after_form',
      fields: { date: 'August 25th', date_status: 'legal' },
      live_intent: { form_submitted: true }
    },
    structured_state: { form_link_sent: true, form_submitted: true }
  })
  const routeMismatch = runner.candidateLivenessAdoptionVerdict(
    routeMismatchInput,
    packetFor(routeMismatchInput, ['august 26 works hope that helps what time works for you']),
    softReason
  )
  check(
    'hard_route_invalid_date_drift_rejected',
    routeMismatch.valid === false && routeMismatch.reason === 'liveness_reason_not_explicitly_soft',
    JSON.stringify(routeMismatch)
  )

  const unknownReason = runner.candidateLivenessAdoptionVerdict(
    socialInput,
    socialPacket,
    { reason: 'future_unreviewed_verifier_reason' }
  )
  check(
    'new_verifier_reason_is_hard_by_default',
    unknownReason.valid === false && unknownReason.reason === 'liveness_reason_not_explicitly_soft',
    JSON.stringify(unknownReason)
  )

  if (failures.length) {
    const err = new Error(`scv_dm_reply_liveness_harness_failed ${JSON.stringify(failures, null, 2)}`)
    err.failures = failures
    throw err
  }
  return {
    ok: true,
    checked,
    liveness_adoption_version: runner.SCV_MODEL_LIVENESS_ADOPTION_VERSION
  }
}

if (require.main === module) {
  runHarness()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((err) => {
      console.error(err && err.stack ? err.stack : String(err))
      process.exit(1)
    })
}

module.exports = { runHarness }
