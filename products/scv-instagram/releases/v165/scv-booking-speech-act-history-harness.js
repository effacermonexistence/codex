#!/usr/bin/env node
// Deterministic, network-free proof that raw DM history cannot manufacture
// booking authority from incidental dates, clock times, or third-party phones.
const fs = require('fs')
const os = require('os')
const path = require('path')

const SCV_BOOKING_SPEECH_ACT_HISTORY_HARNESS_VERSION =
  'scv-booking-speech-act-history-harness-2026-08-25-v4-atomic-four-field-rebuild-authority'

function runHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail: String(detail || '').slice(0, 1400) })
  }

  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-booking-speech-act-history-'))
  const priorRoot = process.env.SCV_ROOT
  process.env.SCV_ROOT = sandbox

  try {
    const authority = require(path.join(__dirname, 'dm-authority.js'))
    const referenceTime = '2026-08-19T19:00:00.000Z'
    let sequence = 0
    const user = (text) => ({ role: 'user', text, message_id: `u-${++sequence}` })
    const assistant = (text) => ({ role: 'assistant', text, message_id: `a-${++sequence}` })
    const build = (history, label) => authority.buildStructuredState({
      thread_id: `speech-history-${label}-${++sequence}`,
      contact_id: `speech-history-${label}-${sequence}`,
      instagram_username: 'omar.system',
      message_id: `live-${sequence}`,
      source_interaction_at: referenceTime,
      received_at: referenceTime
    }, history)
    const formSubmitted = () => user('I just submitted the form.')
    const activeDateHistory = (reply) => [
      formSubmitted(),
      assistant('What date were you thinking?'),
      user(reply)
    ]
    const activeTimeHistory = (reply, includeTimeQuestion = true) => {
      const history = [
        formSubmitted(),
        assistant('What date were you thinking?'),
        user('How about August 30?')
      ]
      if (includeTimeQuestion) history.push(assistant('What time were you thinking?'))
      history.push(user(reply))
      return history
    }

    const freshIncidentalDates = [
      'The event starts August 27.',
      'My trip begins August 27.',
      'My flight is on August 27.',
      'The wedding is August 27.',
      'My birthday is August 27.',
      'Our anniversary is August 27.',
      'My old appointment was August 27.'
    ]
    for (const [index, text] of freshIncidentalDates.entries()) {
      const state = build([user(text)], `fresh-date-${index}`)
      check(`fresh_incidental_date_${index}_not_imported`, !state.known_requested_date, JSON.stringify(state))
      check(`fresh_incidental_date_${index}_not_advanced`, !['awaiting_time', 'ready_for_double_check'].includes(state.booking_stage_hint), JSON.stringify(state))
    }

    for (const [index, text] of [
      'How about August 30?',
      'August 30 works for me.',
      'Book me for August 30.'
    ].entries()) {
      const state = build([user(text)], `preform-proposal-${index}`)
      check(`preform_explicit_date_${index}_not_imported`, !state.known_requested_date, JSON.stringify(state))
    }

    const compound = build(
      activeDateHistory('My old appointment was August 27; how about August 30?'),
      'compound-later-proposal'
    )
    check('active_compound_chooses_real_later_proposal', compound.known_requested_date === 'august 30', JSON.stringify(compound))
    check('active_compound_advances_to_time', compound.booking_stage_hint === 'awaiting_time', JSON.stringify(compound))

    const mixedPositiveThenNegative = build(
      activeDateHistory('I can do August 30, but not August 31.'),
      'mixed-positive-negative'
    )
    check('mixed_positive_then_negative_chooses_august_30', mixedPositiveThenNegative.known_requested_date === 'august 30', JSON.stringify(mixedPositiveThenNegative))
    const mixedNegativeThenPositive = build(
      activeDateHistory("I can't do August 30 but August 31 works."),
      'mixed-negative-positive'
    )
    check('mixed_negative_then_positive_chooses_august_31', mixedNegativeThenPositive.known_requested_date === 'august 31', JSON.stringify(mixedNegativeThenPositive))
    for (const [index, text] of [
      'August 30 works but I cannot do August 30.',
      'I cannot do August 30 but August 30 works.',
      'August 30 or August 31 works.',
      'Between August 30 and August 31 works.'
    ].entries()) {
      const state = build(activeDateHistory(text), `ambiguous-date-${index}`)
      check(`ambiguous_or_conflicting_date_${index}_not_imported`, !state.known_requested_date, JSON.stringify(state))
    }

    for (const [index, text] of [
      'I cannot do August 30.',
      'Anything except August 30.',
      'Anything other than August 30.',
      'After August 30 would work.',
      'August 30 or later works.',
      'Between August 30 and September 2 works.'
    ].entries()) {
      const state = build(activeDateHistory(text), `active-date-reject-${index}`)
      check(`active_rejected_or_bounded_date_${index}_not_imported`, !state.known_requested_date, JSON.stringify(state))
      check(`active_rejected_or_bounded_date_${index}_not_advanced`, state.booking_stage_hint !== 'awaiting_time', JSON.stringify(state))
    }

    const bareDateAfterQuestion = build(activeDateHistory('August 30'), 'bare-date-after-question')
    check('bare_date_after_active_question_imported', bareDateAfterQuestion.known_requested_date === 'august 30', JSON.stringify(bareDateAfterQuestion))
    const bareDateWithoutQuestion = build([formSubmitted(), user('August 30')], 'bare-date-no-question')
    check('bare_date_without_active_question_not_imported', !bareDateWithoutQuestion.known_requested_date, JSON.stringify(bareDateWithoutQuestion))

    const positiveComposite = build(activeDateHistory('Can we do August 30 at 2pm?'), 'positive-date-time-composite')
    check('positive_date_time_composite_date_exact', positiveComposite.known_requested_date === 'august 30', JSON.stringify(positiveComposite))
    check('positive_date_time_composite_time_exact', positiveComposite.known_requested_time === '2:00pm', JSON.stringify(positiveComposite))

    for (const [index, text] of [
      'My flight is at 2pm.',
      'The event starts at 3pm.',
      'Lunch is at 2pm.',
      'The livestream starts at 2pm.',
      'I cannot do 2pm.',
      'Anything except 2pm.',
      'Any time after 2pm works.'
    ].entries()) {
      const state = build(activeTimeHistory(text), `active-time-negative-${index}`)
      check(`active_incidental_rejected_or_bounded_time_${index}_not_imported`, !state.known_requested_time, JSON.stringify(state))
      check(`active_incidental_rejected_or_bounded_time_${index}_not_ready`, state.booking_stage_hint !== 'ready_for_double_check', JSON.stringify(state))
    }

    const explicitTime = build(activeTimeHistory('2pm works.'), 'explicit-time')
    check('active_explicit_time_imported', explicitTime.known_requested_time === '2:00pm', JSON.stringify(explicitTime))
    const dottedTime = build(activeTimeHistory('2 p.m. works.'), 'dotted-time')
    check('active_dotted_time_imported', dottedTime.known_requested_time === '2:00pm', JSON.stringify(dottedTime))
    check('active_dotted_time_not_imported_as_size', !dottedTime.known_size_context, JSON.stringify(dottedTime))
    const naturalTime = build(activeTimeHistory('2 in the afternoon works.'), 'natural-part-of-day-time')
    check('active_natural_part_of_day_time_imported', naturalTime.known_requested_time === '2:00pm', JSON.stringify(naturalTime))
    check('active_natural_part_of_day_time_not_imported_as_size', !naturalTime.known_size_context, JSON.stringify(naturalTime))
    const bareTimeAfterQuestion = build(activeTimeHistory('2pm'), 'bare-time-after-question')
    check('bare_time_after_active_question_imported', bareTimeAfterQuestion.known_requested_time === '2:00pm', JSON.stringify(bareTimeAfterQuestion))
    const bareTimeWithoutQuestion = build(activeTimeHistory('2pm', false), 'bare-time-no-question')
    check('bare_time_without_active_question_not_imported', !bareTimeWithoutQuestion.known_requested_time, JSON.stringify(bareTimeWithoutQuestion))
    const mixedTime = build(activeTimeHistory("Can't do 2pm but 3pm works."), 'mixed-time')
    check('mixed_time_chooses_only_positive_candidate', mixedTime.known_requested_time === '3:00pm', JSON.stringify(mixedTime))
    const ambiguousTimes = build(activeTimeHistory('2pm works or 3pm works.'), 'ambiguous-times')
    check('multiple_positive_times_do_not_commit_exact_time', !ambiguousTimes.known_requested_time, JSON.stringify(ambiguousTimes))
    for (const [index, text] of [
      '2pm works but I cannot do 2pm.',
      'I cannot do 2pm but 2pm works.',
      'Between 2pm and 3pm works.'
    ].entries()) {
      const state = build(activeTimeHistory(text), `ambiguous-time-${index}`)
      check(`ambiguous_or_conflicting_time_${index}_not_imported`, !state.known_requested_time, JSON.stringify(state))
    }

    const thirdPartyIdentityTexts = [
      "My friend Alex's phone is 415-555-0123.",
      'Call my mom at 415-555-0123.',
      'Her phone is 415-555-0123.',
      "My doctor's phone is 415-555-0123.",
      "Alex's phone is 415-555-0123.",
      'You can reach Alex at 415-555-0123.',
      'Alex can be reached at 415-555-0123.',
      'The number belongs to Alex: 415-555-0123.'
    ]
    for (const [index, text] of thirdPartyIdentityTexts.entries()) {
      const state = build([user(text)], `fresh-third-party-phone-${index}`)
      check(`fresh_third_party_phone_${index}_not_imported`, !state.known_phone_used_on_form, JSON.stringify(state))
      check(`fresh_third_party_phone_${index}_name_not_imported`, !state.known_name_used_on_form, JSON.stringify(state))
    }

    const identityPrefix = [
      formSubmitted(),
      assistant('What date were you thinking?'),
      user('How about August 30?'),
      assistant('What time were you thinking?'),
      user('2pm works.'),
      assistant('What name and phone number did you use on the form?')
    ]
    for (const [index, text] of thirdPartyIdentityTexts.entries()) {
      const state = build([...identityPrefix, user(text)], `active-third-party-phone-${index}`)
      check(`active_third_party_phone_${index}_not_imported`, !state.known_phone_used_on_form, JSON.stringify(state))
      check(`active_third_party_phone_${index}_name_not_imported`, !state.known_name_used_on_form, JSON.stringify(state))
      check(`active_third_party_phone_${index}_stays_identity`, state.booking_stage_hint === 'awaiting_form_identity_match', JSON.stringify(state))
    }

    const explicitIdentity = build(
      [...identityPrefix, user('My phone on the form is 415-555-0123, Lua Test')],
      'explicit-form-identity'
    )
    check('explicit_form_identity_phone_imported', explicitIdentity.known_phone_used_on_form === '4155550123', JSON.stringify(explicitIdentity))
    check('explicit_form_identity_name_clean', explicitIdentity.known_name_used_on_form === 'Lua Test', JSON.stringify(explicitIdentity))
    check('explicit_form_identity_reaches_double_check', explicitIdentity.booking_stage_hint === 'ready_for_double_check', JSON.stringify(explicitIdentity))

    const naturalIdentitySentence = build(
      [...identityPrefix, user('My name is Lua Test and my phone is 415-555-0123.')],
      'natural-form-identity-sentence'
    )
    check('natural_form_identity_sentence_phone_clean', naturalIdentitySentence.known_phone_used_on_form === '4155550123', JSON.stringify(naturalIdentitySentence))
    check('natural_form_identity_sentence_name_clean', naturalIdentitySentence.known_name_used_on_form === 'Lua Test', JSON.stringify(naturalIdentitySentence))
    check('natural_form_identity_sentence_reaches_double_check', naturalIdentitySentence.booking_stage_hint === 'ready_for_double_check', JSON.stringify(naturalIdentitySentence))

    const permute = (items) => items.length <= 1
      ? [items]
      : items.flatMap((item, index) => permute(items.filter((_, candidateIndex) => candidateIndex !== index)).map((tail) => [item, ...tail]))
    const labeledFieldLines = [
      'Name: Lua Test',
      'Phone: 415-555-0123',
      'Date: August 31',
      'Time: 3pm'
    ]
    const labeledPermutationMisses = []
    for (const separator of [', ', '; ', '\n']) {
      for (const [index, order] of permute(labeledFieldLines).entries()) {
        const text = order.join(separator)
        const state = build([...identityPrefix, user(text)], `labeled-order-${JSON.stringify(separator)}-${index}`)
        if (
          state.known_name_used_on_form !== 'Lua Test' ||
          state.known_phone_used_on_form !== '4155550123' ||
          state.known_requested_date !== 'august 31' ||
          state.known_requested_time !== '3:00pm' ||
          state.booking_stage_hint !== 'ready_for_double_check'
        ) labeledPermutationMisses.push({ separator, index, text, state })
      }
    }
    check('all_labeled_four_field_orders_and_separators_rebuild_all_four_fields_atomically', labeledPermutationMisses.length === 0, JSON.stringify(labeledPermutationMisses.slice(0, 4)))

    const visibleCheckpointPrefix = [
      ...identityPrefix,
      user('Name: Ivy; Phone: 415-555-0170; Date: August 30; Time: 2pm'),
      assistant('Name: Ivy\nPhone number: 4155550170\nAppointment date: August 30\nTime: 2pm\ndoes that all look right?')
    ]
    const rebuiltVisibleCheckpoint = build(visibleCheckpointPrefix, 'visible-checkpoint-that-all-look-right')
    check(
      'executed_path_visible_checkpoint_surface_rebuilds_confirmation_wait',
      rebuiltVisibleCheckpoint.double_check_sent === true &&
      rebuiltVisibleCheckpoint.name_phone_date_time_double_check_sent === true &&
      rebuiltVisibleCheckpoint.booking_stage_hint === 'awaiting_double_check_confirmation',
      JSON.stringify(rebuiltVisibleCheckpoint)
    )

    const priorDoubleCheckCorrection = build([
      ...visibleCheckpointPrefix,
      user('Time: 3pm\nDate: August 31\nPhone: 415-555-0123\nName: Lua Test')
    ], 'prior-double-check-four-field-correction')
    check(
      'four_field_correction_after_visible_checkpoint_reopens_fresh_double_check',
      priorDoubleCheckCorrection.known_name_used_on_form === 'Lua Test' &&
      priorDoubleCheckCorrection.known_phone_used_on_form === '4155550123' &&
      priorDoubleCheckCorrection.known_requested_date === 'august 31' &&
      priorDoubleCheckCorrection.known_requested_time === '3:00pm' &&
      priorDoubleCheckCorrection.double_check_sent !== true &&
      priorDoubleCheckCorrection.name_phone_date_time_double_check_sent !== true &&
      priorDoubleCheckCorrection.booking_stage_hint === 'ready_for_double_check',
      JSON.stringify(priorDoubleCheckCorrection)
    )

    const unlabeledFourFieldCorrection = build(
      [...identityPrefix, user('Lua Test, 415-555-0123, August 31, 3pm')],
      'unlabeled-four-field-correction'
    )
    check(
      'unlabeled_four_field_payload_rebuilds_atomically_at_shared_parser',
      unlabeledFourFieldCorrection.known_name_used_on_form === 'Lua Test' &&
      unlabeledFourFieldCorrection.known_phone_used_on_form === '4155550123' &&
      unlabeledFourFieldCorrection.known_requested_date === 'august 31' &&
      unlabeledFourFieldCorrection.known_requested_time === '3:00pm' &&
      unlabeledFourFieldCorrection.booking_stage_hint === 'ready_for_double_check',
      JSON.stringify(unlabeledFourFieldCorrection)
    )

    const invalidUnlabeledMisses = []
    for (const [id, text] of [
      ['ambiguous_time', 'Lua Test, 415-555-0123, August 31, 2pm or 3pm'],
      ['third_party_identity', 'My friend Alex, 415-555-0123, August 31, 3pm']
    ]) {
      const state = build([...identityPrefix, user(text)], `invalid-unlabeled-${id}`)
      if (
        state.known_name_used_on_form ||
        state.known_phone_used_on_form ||
        state.known_requested_date !== 'august 30' ||
        state.known_requested_time !== '2:00pm' ||
        state.booking_stage_hint !== 'awaiting_form_identity_match'
      ) invalidUnlabeledMisses.push({ id, text, state })
    }
    check(
      'ambiguous_or_third_party_unlabeled_payload_fails_closed_without_partial_import',
      invalidUnlabeledMisses.length === 0,
      JSON.stringify(invalidUnlabeledMisses)
    )

    const invalidLabeledPayloadMisses = []
    for (const [index, text] of [
      'Name: Lua Test; Name: Alex; Phone: 415-555-0123; Date: August 30; Time: 2pm',
      'Name: Lua Test; Phone: 415-555-0123; Phone: 415-555-0199; Date: August 30; Time: 2pm',
      'Name: Lua Test; Phone: 415-555-0123; Date: August 30; Date: August 31; Time: 2pm',
      'Name: Lua Test; Phone: 415-555-0123; Date: August 30; Time: 2pm; Time: 3pm',
      'Name: Lua Test; Phone: 415-555-0123; Date: August 30',
      'Name: Lua Test; Phone: nope; Date: August 30; Time: 2pm'
    ].entries()) {
      const state = build([...identityPrefix, user(text)], `invalid-labeled-${index}`)
      if (
        state.known_name_used_on_form ||
        state.known_phone_used_on_form ||
        state.known_requested_date !== 'august 30' ||
        state.known_requested_time !== '2:00pm' ||
        state.booking_stage_hint !== 'awaiting_form_identity_match'
      ) {
        invalidLabeledPayloadMisses.push({ text, state })
      }
    }
    check('duplicate_incomplete_or_invalid_labeled_payloads_fail_closed', invalidLabeledPayloadMisses.length === 0, JSON.stringify(invalidLabeledPayloadMisses))

    const liveBase = build(activeTimeHistory('2pm works.'), 'live-base')
    const liveMessage = (text, id) => ({
      thread_id: `live-annotation-${id}`,
      contact_id: `live-annotation-${id}`,
      instagram_username: 'omar.system',
      message_id: `live-annotation-${id}`,
      text,
      source_interaction_at: referenceTime,
      received_at: referenceTime
    })
    const liveTimeBase = { ...liveBase, known_requested_time: '', booking_stage_hint: 'awaiting_time' }
    const liveFlight = authority.annotateStructuredStateForLiveTurn(
      liveMessage('My flight is at 2pm.', 'flight'),
      liveTimeBase,
      [assistant('What time were you thinking?')]
    )
    check('live_incidental_flight_time_not_adopted', !liveFlight.live_turn_time_phrase && !liveFlight.known_requested_time, JSON.stringify(liveFlight))
    const livePositiveTime = authority.annotateStructuredStateForLiveTurn(
      liveMessage('2pm works.', 'positive-time'),
      liveTimeBase,
      [assistant('What time were you thinking?')]
    )
    check('live_positive_time_adopted', livePositiveTime.live_turn_time_phrase === '2:00pm' && livePositiveTime.known_requested_time === '2:00pm', JSON.stringify(livePositiveTime))
    const liveNaturalTime = authority.annotateStructuredStateForLiveTurn(
      liveMessage('2 in the afternoon works.', 'natural-time'),
      liveTimeBase,
      [assistant('What time were you thinking?')]
    )
    check('live_natural_time_adopted', liveNaturalTime.live_turn_time_phrase === '2:00pm' && liveNaturalTime.known_requested_time === '2:00pm', JSON.stringify(liveNaturalTime))
    check('live_natural_time_does_not_pollute_size', !liveNaturalTime.known_size_context, JSON.stringify(liveNaturalTime))
    const liveMixedDate = authority.annotateStructuredStateForLiveTurn(
      liveMessage('I can do August 30, but not August 31.', 'mixed-date'),
      { ...liveBase, known_requested_date: '', booking_stage_hint: 'awaiting_date' },
      [assistant('What date were you thinking?')]
    )
    check('live_mixed_date_uses_positive_exact_candidate', liveMixedDate.live_turn_date_phrase === 'August 30', JSON.stringify(liveMixedDate))
    for (const [index, text] of thirdPartyIdentityTexts.entries()) {
      const liveThirdPartyPhone = authority.annotateStructuredStateForLiveTurn(
        liveMessage(text, `third-party-phone-${index}`),
        { ...liveBase, known_name_used_on_form: '', known_phone_used_on_form: '', booking_stage_hint: 'awaiting_form_identity_match' },
        [assistant('What name and phone number did you use on the form?')]
      )
      check(`live_third_party_phone_candidate_${index}_blocked`, !liveThirdPartyPhone.live_turn_phone_candidate, JSON.stringify(liveThirdPartyPhone))
      check(`live_third_party_name_candidate_${index}_blocked`, !liveThirdPartyPhone.live_turn_name_candidate, JSON.stringify(liveThirdPartyPhone))
    }
  } finally {
    if (priorRoot === undefined) delete process.env.SCV_ROOT
    else process.env.SCV_ROOT = priorRoot
    try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch {}
  }

  return {
    ok: failures.length === 0,
    locked: failures.length === 0,
    lock_version: SCV_BOOKING_SPEECH_ACT_HISTORY_HARNESS_VERSION,
    checked,
    failures,
    network: false,
    external_changes: false
  }
}

if (require.main === module) {
  try {
    const receipt = runHarness()
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
    if (!receipt.ok) process.exit(1)
  } catch (error) {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`)
    process.exit(1)
  }
}

module.exports = {
  SCV_BOOKING_SPEECH_ACT_HISTORY_HARNESS_VERSION,
  runScvBookingSpeechActHistoryHarness: runHarness,
  runHarness
}
