#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const {
  mediaContextAuthorityRank,
  selectAuthoritativeMediaText
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  ACTIONS,
  deriveClosedTransitionPlan,
  evaluateClosedTransitionContract
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const {
  buildFunnelStateMachinePacket,
  buildPreIntentDeterministicBookingPacket
} = require(path.join(__dirname, 'codex-dm-runner.js'))

const SCV_MEDIA_AUTHORITY_MONOTONIC_HARNESS_VERSION =
  'scv-media-authority-monotonic-harness-2026-08-21-v4-bounded-cold-start'

const CHILD_PROCESS_TIMEOUT_MS = 30_000

function runScvMediaAuthorityMonotonicHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  const exact = 'sent a voice note saying: How about 26?'
  const unresolved = 'sent a voice note that could not be understood'
  const conflict = 'sent a voice note saying: How about 28?'

  check(
    'authority_rank_orders_exact_above_unresolved_above_transport',
    mediaContextAuthorityRank(exact) > mediaContextAuthorityRank(unresolved) &&
      mediaContextAuthorityRank(unresolved) > mediaContextAuthorityRank('sent a reference post'),
    JSON.stringify({
      exact: mediaContextAuthorityRank(exact),
      unresolved: mediaContextAuthorityRank(unresolved),
      transport: mediaContextAuthorityRank('sent a reference post')
    })
  )

  const downgrade = selectAuthoritativeMediaText(exact, unresolved)
  check(
    'exact_transcript_cannot_be_downgraded_by_later_retry',
    downgrade.adopted === false &&
      downgrade.text === exact &&
      downgrade.reason === 'media_context_downgrade_blocked',
    JSON.stringify(downgrade)
  )

  const upgrade = selectAuthoritativeMediaText(unresolved, exact)
  check(
    'unresolved_transcript_can_be_upgraded_by_exact_retry',
    upgrade.adopted === true && upgrade.text === exact,
    JSON.stringify(upgrade)
  )

  const equalConflict = selectAuthoritativeMediaText(exact, conflict)
  check(
    'equal_authority_conflict_preserves_first_accepted_source',
    equalConflict.adopted === false &&
      equalConflict.text === exact &&
      /first_source_preserved/.test(equalConflict.reason),
    JSON.stringify(equalConflict)
  )

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-media-monotonic-'))
  try {
    fs.mkdirSync(path.join(root, 'thread-history'), { recursive: true })
    fs.mkdirSync(path.join(root, 'thread-state'), { recursive: true })
    const threadId = '1537753982'
    const messageId = '1784865924800'
    const historyFile = path.join(root, 'thread-history', `${threadId}.json`)
    fs.writeFileSync(path.join(root, 'thread-state', `${threadId}.json`), JSON.stringify({
      contact_id: threadId,
      thread_id: threadId,
      tattoo_intent_active: true,
      known_design_context: 'black and gray reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date'
    }, null, 2) + '\n')
    fs.writeFileSync(historyFile, JSON.stringify({
      contact_id: threadId,
      thread_id: threadId,
      instagram_username: 'omar.system',
      events: [
        {
          role: 'assistant',
          message_id: 'form-date-packet',
          bubble_index: 0,
          text: 'perfect i got the form',
          at: '2026-07-24T04:04:00.000Z'
        },
        {
          role: 'assistant',
          message_id: 'form-date-packet',
          bubble_index: 1,
          text: 'what dates or weekend days are easiest for you?',
          at: '2026-07-24T04:04:01.000Z'
        },
        {
          role: 'user',
          message_id: messageId,
          text: 'sent a reference post',
          at: '2026-07-24T04:05:24.801Z'
        }
      ]
    }, null, 2) + '\n')

    const child = spawnSync(process.execPath, ['-e', `
      const path = require('path')
      const authority = require(path.join(${JSON.stringify(__dirname)}, 'dm-authority.js'))
      const contract = require(path.join(${JSON.stringify(__dirname)}, 'scv-closed-transition-contract.js'))
      const msg = {
        contact_id: ${JSON.stringify(threadId)},
        thread_id: ${JSON.stringify(threadId)},
        instagram_username: 'omar.system',
        message_id: ${JSON.stringify(messageId)},
        text: 'sent a reference post',
        media_urls: ['https://example.invalid/voice.m4a'],
        received_at: '2026-07-24T04:05:24.801Z'
      }
      const exact = ${JSON.stringify(exact)}
      const unresolved = ${JSON.stringify(unresolved)}
      const firstPersist = authority.persistEnrichedInboundHistoryText(msg, exact)
      const downgradePersist = authority.persistEnrichedInboundHistoryText(msg, unresolved)
      const recent = authority.loadRecentThreadHistory(msg, 30)
      let resolverCalls = 0
      const resolved = authority.resolveMonotonicInboundMediaContext(msg, recent, () => {
        resolverCalls += 1
        return {
          resolved: true,
          text: unresolved,
          is_voice_note: true,
          voice_transcribe_failed: true,
          voice_context_unresolved: true
        }
      })
      const resolvedMsg = { ...msg, text: resolved.text }
      const state = authority.annotateStructuredStateForLiveTurn(
        resolvedMsg,
        authority.buildStructuredState(resolvedMsg, recent),
        recent
      )
      const monthHistory = [{
        role: 'assistant',
        message_id: 'month-question',
        text: 'which month did you mean for the 26th?'
      }]
      const calendarBase = {
        form_offer_asked: true,
        form_link_sent: true,
        form_submitted: true,
        tattoo_intent_active: true,
        known_design_context: 'black and gray reference',
        booking_stage_hint: 'awaiting_date',
        current_message_date_local: 'July 23, 2026',
        minimum_booking_date_local: 'July 30, 2026',
        maximum_booking_date_local: 'January 23, 2027',
        earliest_booking_option_local: 'July 30 (thursday) at 2pm',
        close_booking_options_local: [
          'July 30 (thursday) at 2pm',
          'July 31 (friday) at 2pm',
          'August 1 (saturday) at 2pm'
        ]
      }
      const monthCase = (text, suffix) => {
        const monthMsg = {
          contact_id: ${JSON.stringify(threadId)},
          thread_id: ${JSON.stringify(threadId)},
          message_id: 'month-' + suffix,
          text,
          received_at: '2026-07-23T20:00:00.000-07:00'
        }
        const annotated = authority.annotateStructuredStateForLiveTurn(
          monthMsg,
          { ...calendarBase },
          monthHistory
        )
        const plan = contract.deriveClosedTransitionPlan({
          message: text,
          live_message: text,
          recent_history: monthHistory,
          structured_state: annotated
        })
        return {
          contextual: annotated.live_turn_contextual_booking_reply,
          day: annotated.live_turn_monthless_day_candidate,
          month: annotated.live_turn_contextual_month_anchor,
          phrase: annotated.live_turn_date_phrase,
          status: annotated.live_turn_date_status,
          name: annotated.live_turn_name_candidate,
          size: annotated.known_size_context,
          plan_action: plan.action,
          plan_reason: plan.reason,
          plan_fields: plan.fields
        }
      }
      process.stdout.write('\\n' + JSON.stringify({
        firstPersist,
        downgradePersist,
        recent,
        resolverCalls,
        resolved,
        state: {
          form_submitted: state.form_submitted,
          live_turn_contextual_booking_reply: state.live_turn_contextual_booking_reply,
          live_turn_monthless_day_candidate: state.live_turn_monthless_day_candidate,
          live_turn_date_needs_month: state.live_turn_date_needs_month,
          known_size_context: state.known_size_context
        },
        monthCases: {
          july: monthCase('July', 'july'),
          voiceJuly: monthCase('sent a voice note saying: July', 'voice-july'),
          august: monthCase('August', 'august'),
          meantAugust: monthCase('I meant August', 'meant-august'),
          unrelated: monthCase('July birth flower', 'unrelated')
        }
      }))
    `], {
      env: { ...process.env, SCV_ROOT: root },
      encoding: 'utf8',
      timeout: CHILD_PROCESS_TIMEOUT_MS
    })
    const lines = String(child.stdout || '').trim().split(/\r?\n/)
    let result = null
    try { result = JSON.parse(lines[lines.length - 1] || '{}') } catch {}

    check(
      'persisted_exact_source_survives_second_pass_downgrade',
      child.status === 0 &&
        result?.firstPersist === true &&
        result?.downgradePersist === false &&
        result?.resolved?.text === exact &&
        result?.resolverCalls === 0,
      JSON.stringify({
        status: child.status,
        signal: child.signal,
        error: child.error
          ? { code: child.error.code, message: child.error.message }
          : null,
        stderr: child.stderr,
        result
      })
    )
    check(
      'enriched_live_event_excluded_by_message_id_not_text',
      Array.isArray(result?.recent) &&
        result.recent.length === 2 &&
        result.recent.every((event) => event.message_id !== messageId),
      JSON.stringify(result?.recent)
    )
    check(
      'exact_26_reaches_monthless_calendar_route_not_size',
      result?.state?.form_submitted === true &&
        result?.state?.live_turn_contextual_booking_reply === true &&
        result?.state?.live_turn_monthless_day_candidate === '26' &&
        result?.state?.live_turn_date_needs_month === true &&
        !String(result?.state?.known_size_context || '').trim(),
      JSON.stringify(result?.state)
    )
    check(
      'month_only_july_binds_to_open_26_and_reapplies_one_week_floor',
      result?.monthCases?.july?.contextual === true &&
        result?.monthCases?.july?.day === '26' &&
        result?.monthCases?.july?.month === 'july' &&
        result?.monthCases?.july?.phrase === 'july 26' &&
        result?.monthCases?.july?.status === 'too_soon' &&
        !String(result?.monthCases?.july?.name || '').trim() &&
        !String(result?.monthCases?.july?.size || '').trim() &&
        result?.monthCases?.july?.plan_action === ACTIONS.POST_FORM_AVAILABILITY &&
        result?.monthCases?.july?.plan_reason === 'submitted_form_date_counterproposal_outside_window',
      JSON.stringify(result?.monthCases?.july)
    )
    check(
      'voice_wrapped_month_answer_keeps_same_calendar_slot_authority',
      result?.monthCases?.voiceJuly?.contextual === true &&
        result?.monthCases?.voiceJuly?.phrase === 'july 26' &&
        result?.monthCases?.voiceJuly?.status === 'too_soon' &&
        result?.monthCases?.voiceJuly?.plan_reason === 'submitted_form_date_counterproposal_outside_window',
      JSON.stringify(result?.monthCases?.voiceJuly)
    )
    check(
      'month_only_august_binds_to_open_26_and_advances_to_time',
      result?.monthCases?.august?.contextual === true &&
        result?.monthCases?.august?.phrase === 'august 26' &&
        result?.monthCases?.august?.status === 'legal' &&
        result?.monthCases?.august?.plan_action === ACTIONS.POST_FORM_TIME &&
        result?.monthCases?.august?.plan_reason === 'submitted_form_missing_time',
      JSON.stringify(result?.monthCases?.august)
    )
    check(
      'natural_i_meant_august_answer_advances_without_name_or_size_leak',
      result?.monthCases?.meantAugust?.contextual === true &&
        result?.monthCases?.meantAugust?.phrase === 'august 26' &&
        result?.monthCases?.meantAugust?.status === 'legal' &&
        !String(result?.monthCases?.meantAugust?.name || '').trim() &&
        !String(result?.monthCases?.meantAugust?.size || '').trim() &&
        result?.monthCases?.meantAugust?.plan_action === ACTIONS.POST_FORM_TIME,
      JSON.stringify(result?.monthCases?.meantAugust)
    )
    check(
      'unrelated_month_mention_is_not_laundered_into_calendar_answer',
      result?.monthCases?.unrelated?.contextual !== true &&
        !String(result?.monthCases?.unrelated?.phrase || '').trim(),
      JSON.stringify(result?.monthCases?.unrelated)
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  const postFormInput = {
    message: 'How about 26?',
    live_message: 'How about 26?',
    recent_history: [
      { role: 'assistant', message_id: 'form-date-packet', text: 'perfect i got the form' },
      { role: 'assistant', message_id: 'form-date-packet', text: 'what dates or weekend days are easiest for you?' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      live_turn_contextual_booking_reply: true,
      live_turn_monthless_day_candidate: '26',
      live_turn_date_needs_month: true
    }
  }
  const monthPlan = {
    action: ACTIONS.POST_FORM_AVAILABILITY,
    reason: 'submitted_form_monthless_day_requires_month_clarification',
    obligations: [],
    fields: { monthless_day: '26' }
  }
  const naturalVariants = [
    'the 26th of which month?',
    'which month did you mean for the 26th?',
    'the 26th — what month are you thinking?'
  ]
  for (const [index, text] of naturalVariants.entries()) {
    const verdict = evaluateClosedTransitionContract(
      postFormInput,
      { bubbles: [{ text }] },
      monthPlan
    )
    check(
      `fresh_month_clarification_variant_${index + 1}_passes_semantic_gate`,
      verdict.valid === true,
      JSON.stringify({ text, verdict })
    )
  }

  const outsideWindowInput = {
    message: 'July',
    live_message: 'July',
    recent_history: [
      { role: 'assistant', message_id: 'month-question', text: 'which month did you mean for the 26th?' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      live_turn_contextual_booking_reply: true,
      live_turn_monthless_day_candidate: '26',
      live_turn_contextual_month_anchor: 'july',
      live_turn_date_needs_month: false,
      live_turn_date_phrase: 'july 26',
      live_turn_date_status: 'too_soon',
      minimum_booking_date_local: 'July 30, 2026',
      earliest_booking_option_local: 'July 30 (thursday) at 2pm',
      close_booking_options_local: [
        'July 30 (thursday) at 2pm',
        'July 31 (friday) at 2pm',
        'August 1 (saturday) at 2pm'
      ]
    }
  }
  const outsideWindowPlan = deriveClosedTransitionPlan(outsideWindowInput)
  const validOutsideWindowVariants = [
    'July 26 is too soon on my side. July 30 is the earliest I can do — would that work?',
    'I need at least one week from the 26th, so how does July 30 sound?',
    'The 26th is a little too close. Could you make July 31 work instead?',
    "July 26 isn't enough lead time for me. Would August 1 work?",
    "I can't do July 26 that close. Is July 30 okay?",
    'July 26 falls inside the one-week minimum. Would July 30 be okay?',
    'That date is too early for the one-week buffer. Can you do July 30?',
    'The 26th is outside my minimum window. Does July 30 work?'
  ]
  for (const [index, text] of validOutsideWindowVariants.entries()) {
    const verdict = evaluateClosedTransitionContract(
      outsideWindowInput,
      { bubbles: [{ text }] },
      outsideWindowPlan
    )
    check(
      `model_authored_grounded_outside_window_variant_${index + 1}_passes`,
      verdict.valid === true,
      JSON.stringify({ text, outsideWindowPlan, verdict })
    )
  }

  const invalidOutsideWindowVariants = [
    'July 26 works for me. Can you do July 30?',
    'Got it so far. What days or weekend days are easiest for you?',
    'July 26 is too soon. Can you do August 8?',
    'July 26 is too close. July 30 is the earliest.',
    'July 26 is too soon. Please send the form again: https://www.effacermonexistence.com/apply'
  ]
  for (const [index, text] of invalidOutsideWindowVariants.entries()) {
    const verdict = evaluateClosedTransitionContract(
      outsideWindowInput,
      { bubbles: [{ text }] },
      outsideWindowPlan
    )
    check(
      `unsafe_or_stalled_outside_window_variant_${index + 1}_is_rejected`,
      verdict.valid === false,
      JSON.stringify({ text, outsideWindowPlan, verdict })
    )
  }

  const legalDateInput = {
    message: 'August',
    live_message: 'August',
    recent_history: [
      { role: 'assistant', message_id: 'month-question', text: 'which month did you mean for the 26th?' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      live_turn_contextual_booking_reply: true,
      live_turn_monthless_day_candidate: '26',
      live_turn_contextual_month_anchor: 'august',
      live_turn_date_needs_month: false,
      live_turn_date_phrase: 'august 26',
      live_turn_date_status: 'legal'
    }
  }
  const legalDatePlan = deriveClosedTransitionPlan(legalDateInput)
  const naturalTimeVariants = [
    'August 26 works on my side. What time were you thinking?',
    'Yeah, August 26 is open. Would 2pm work for you?',
    'August 26 is good — are you closer to 2pm or 1pm?',
    'I can do August 26. Is 2pm good for you?',
    'August 26 works. Around what time were you thinking?'
  ]
  for (const [index, text] of naturalTimeVariants.entries()) {
    const verdict = evaluateClosedTransitionContract(
      legalDateInput,
      { bubbles: [{ text }] },
      legalDatePlan
    )
    check(
      `model_authored_legal_month_answer_time_move_${index + 1}_passes`,
      legalDatePlan.action === ACTIONS.POST_FORM_TIME &&
        legalDatePlan.reason === 'submitted_form_missing_time' &&
        verdict.valid === true,
      JSON.stringify({ text, legalDatePlan, verdict })
    )
  }

  const repeatedGeneric = evaluateClosedTransitionContract(
    {
      ...postFormInput,
      structured_state: {
        ...postFormInput.structured_state,
        live_turn_date_needs_month: false,
        live_turn_monthless_day_candidate: '',
        live_turn_contextual_booking_reply: false,
        live_turn_date_phrase: '',
        live_turn_date_status: '',
        live_turn_text: 'weekends are easiest'
      },
      message: 'weekends are easiest',
      live_message: 'weekends are easiest'
    },
    { bubbles: [{ text: 'got it so far what days or weekend days are easiest for you?' }] },
    {
      action: ACTIONS.POST_FORM_AVAILABILITY,
      reason: 'submitted_form_missing_date',
      obligations: [],
      fields: {}
    }
  )
  check(
    'semantic_antirepeat_rejects_same_availability_function',
    repeatedGeneric.valid === false &&
      repeatedGeneric.reason === 'closed_transition_repeated_availability_function_forbidden',
    JSON.stringify(repeatedGeneric)
  )

  const openStageInput = {
    message: 'I just submitted',
    recent_history: [],
    structured_state: {
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      live_turn_form_submitted_signal: true,
      booking_stage_hint: 'awaiting_date'
    }
  }
  check(
    'open_post_form_stage_has_no_fixed_visible_packet',
    buildFunnelStateMachinePacket(openStageInput) === null &&
      buildPreIntentDeterministicBookingPacket(openStageInput) === null,
    JSON.stringify({
      funnel: buildFunnelStateMachinePacket(openStageInput),
      preintent: buildPreIntentDeterministicBookingPacket(openStageInput)
    })
  )

  if (failures.length) {
    const error = new Error(`scv_media_authority_monotonic_harness_failed:${JSON.stringify(failures)}`)
    error.failures = failures
    throw error
  }
  return {
    ok: true,
    locked: true,
    lock_version: SCV_MEDIA_AUTHORITY_MONOTONIC_HARNESS_VERSION,
    checked
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvMediaAuthorityMonotonicHarness(), null, 2))
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: String(error?.message || error),
      failures: error?.failures || []
    }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  SCV_MEDIA_AUTHORITY_MONOTONIC_HARNESS_VERSION,
  runScvMediaAuthorityMonotonicHarness
}
