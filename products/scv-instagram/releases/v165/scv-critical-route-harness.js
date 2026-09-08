#!/usr/bin/env node
const path = require('path')
const {
  SCV_CONTRACT_HARNESS_LOCK_VERSION,
  PREFERRED_FORM_LINK,
  EXACT_ADDRESS,
  evaluateScvContractHarness,
  packetSendsDepositDetails,
  packetHasNamePhoneDateTimeDoubleCheck,
  packetSendsPreferredFormLink,
  packetMovesAfterSizeAnswer,
  packetMovesAfterVisibilityChoice,
  packetAnswersPlacementPossibilityAndMovesNext
} = require(path.join(__dirname, 'scv-contract-harness.js'))

function fail(name, detail) {
  const err = new Error(`scv_critical_route_harness_failed:${name}:${detail}`)
  err.route_name = name
  err.detail = detail
  throw err
}

function base(extra = {}) {
  return {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    received_at: '2026-06-15T22:00:00.000Z',
    recent_history: [],
    structured_state: {},
    ...extra
  }
}

function expectReason(name, input, packet, expectedReason) {
  const verdict = evaluateScvContractHarness(input, packet)
  if (verdict.valid || verdict.reason !== expectedReason) {
    fail(name, `expected_${expectedReason}_got_${JSON.stringify(verdict)}`)
  }
}

function expectValid(name, input, packet, extraCheck) {
  const verdict = evaluateScvContractHarness(input, packet)
  if (!verdict.valid) fail(name, `unexpected_${JSON.stringify(verdict)}`)
  if (typeof extraCheck === 'function') extraCheck(packet)
}

function runScvCriticalRouteHarness() {
  const failures = []
  let checked = 0

  function check(name, fn) {
    checked += 1
    try { fn() } catch (err) { failures.push({ name, error: String(err?.message || err) }) }
  }

  check('plain_social_greeting_rejects_noisy_candidate', () => {
    expectReason(
      'plain_social_greeting_rejects_noisy_candidate',
      base({ message: 'Hey how you doing' }),
      { bubbles: [{ text: 'wait i might be reading that weirdly did you mean you wanted to ask me something?' }] },
      'plain_social_greeting_requires_normal_reply'
    )
  })

  check('plain_social_greeting_accepts_model_social_reply', () => {
    expectValid(
      'plain_social_greeting_accepts_model_social_reply',
      base({ message: 'Hey how you doing' }),
      { bubbles: [{ text: 'hey hey i am good how are you doing today' }] }
    )
  })

  check('pricing_question_rejects_empty_reply', () => {
    expectReason(
      'pricing_question_rejects_empty_reply',
      base({ message: 'is there any cost?' }),
      { bubbles: [] },
      'pricing_question_requires_visible_answer'
    )
  })

  check('pricing_question_rejects_old_200_rate_answer', () => {
    expectReason(
      'pricing_question_rejects_old_200_rate_answer',
      base({ message: 'is there any cost?' }),
      { bubbles: [{ text: 'yeah there is a discounted model rate if the style fits my work it is 200 per hour' }] },
      'pricing_question_requires_visible_answer'
    )
  })

  check('pricing_question_accepts_rate_answer', () => {
    expectValid(
      'pricing_question_accepts_rate_answer',
      base({ message: 'is there any cost?' }),
      { bubbles: [{ text: 'yeah there is a discounted model rate if the style fits my work it is 150 per hour' }] }
    )
  })

  check('state_ready_booking_identity_rejects_duplicate_name_phone', () => {
    expectReason(
      'state_ready_booking_identity_rejects_duplicate_name_phone',
      base({
        message: "yeah that's perfect",
        recent_history: [],
        structured_state: {
          booking_stage_hint: 'ready_for_double_check',
          known_name_used_on_form: '근호',
          known_phone_used_on_form: '1231231234',
          known_requested_date: 'june 22',
          known_requested_time: '2pm',
          form_link_sent: true,
          form_submitted: true
        }
      }),
      { bubbles: [{ text: 'perfect can you send me the name and phone number you used on the form so i can match everything completely' }] },
      'ready_booking_identity_requires_double_check'
    )
  })

  check('deictic_double_check_confirmation_rejects_generic_relationship_drift', () => {
    expectReason(
      'deictic_double_check_confirmation_rejects_generic_relationship_drift',
      base({
        message: 'perfect, this correct',
        recent_history: [],
        structured_state: {
          booking_stage_hint: 'ready_for_double_check',
          known_name_used_on_form: '근호',
          known_phone_used_on_form: '1231231234',
          known_requested_date: 'june 22',
          known_requested_time: '2pm',
          form_link_sent: true,
          form_submitted: true
        }
      }),
      { bubbles: [{ text: "Yeah, that really feels like a good spot to land on what’s been the best part of planning this so far" }] },
      'double_check_confirmation_requires_deposit_details'
    )
  })

  check('double_check_confirmation_rejects_second_looks_good_gate', () => {
    expectReason(
      'double_check_confirmation_rejects_second_looks_good_gate',
      base({
        message: 'perfecto',
        recent_history: [
          { role: 'assistant', text: 'name: 근호\nphone number: 1231231234\nappointment date: june 22\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }
        ],
        structured_state: {
          form_link_sent: true,
          form_submitted: true,
          accepted_offered_date: 'june 22',
          accepted_offered_time: '2pm'
        }
      }),
      { bubbles: [{ text: 'perfect once you say looks good i can send the deposit details' }] },
      'double_check_confirmation_cannot_request_second_confirmation'
    )
  })

  check('state_ready_booking_identity_rejects_deposit_before_double_check', () => {
    const packet = { bubbles: [
      { text: 'perfect thank you' },
      { text: 'the deposit is 100' },
      { text: 'zelle is contact@omarprotocol.com' },
      { text: 'once you send it let me know so i can double check and confirm the appointment on my calendar' }
    ] }
    expectReason(
      'state_ready_booking_identity_rejects_deposit_before_double_check',
      base({
        message: "yeah that's perfect",
        recent_history: [],
        structured_state: {
          booking_stage_hint: 'ready_for_double_check',
          known_name_used_on_form: '근호',
          known_phone_used_on_form: '1231231234',
          known_requested_date: 'june 22',
          known_requested_time: '2pm',
          form_link_sent: true,
          form_submitted: true
        }
      }),
      packet,
      'deposit_requires_name_phone_date_time_double_check'
    )
  })

  check('state_ready_booking_identity_accepts_double_check_block', () => {
    const packet = { bubbles: [{ text: 'name: 근호\nphone number: 1231231234\nappointment date: june 22\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }] }
    expectValid(
      'state_ready_booking_identity_accepts_double_check_block',
      base({
        message: "yeah that's perfect",
        recent_history: [],
        structured_state: {
          booking_stage_hint: 'ready_for_double_check',
          known_name_used_on_form: '근호',
          known_phone_used_on_form: '1231231234',
          known_requested_date: 'june 22',
          known_requested_time: '2pm',
          form_link_sent: true,
          form_submitted: true
        }
      }),
      packet,
      (p) => { if (!packetHasNamePhoneDateTimeDoubleCheck(p)) fail('state_ready_booking_identity_accepts_double_check_block', 'double_check_missing') }
    )
  })

  check('state_ready_booking_identity_rejects_one_line_double_check', () => {
    expectReason(
      'state_ready_booking_identity_rejects_one_line_double_check',
      base({
        message: 'Eloise 1231231234',
        recent_history: [{ role: 'assistant', text: 'send me the name and phone used on the form' }],
        structured_state: {
          booking_stage_hint: 'ready_for_double_check',
          known_name_used_on_form: 'Eloise',
          known_phone_used_on_form: '1231231234',
          known_requested_date: 'june 22',
          known_requested_time: '2pm',
          form_link_sent: true,
          form_submitted: true
        }
      }),
      { bubbles: [{ text: 'name: Eloise phone number: 1231231234 appointment date: june 22 time: 2pm can you give this a quick look and make sure it\'s all right? 🖤' }] },
      'ready_booking_identity_requires_double_check'
    )
  })

  check('legacy_one_line_is_this_correct_confirmation_rejects_date_loop', () => {
    expectReason(
      'legacy_one_line_is_this_correct_confirmation_rejects_date_loop',
      base({
        message: "that's correct",
        recent_history: [{ role: 'assistant', text: 'Name: Eloise Number: 1231231234 Appointment Date: June 22 Time: 2pm. Is this correct?' }],
        structured_state: {
          known_name_used_on_form: 'Eloise',
          known_phone_used_on_form: '1231231234',
          known_requested_date: 'june 22',
          known_requested_time: '2pm',
          form_link_sent: true,
          form_submitted: true
        }
      }),
      { bubbles: [{ text: 'ok june 22 at 2pm works on my side' }] },
      'double_check_confirmation_requires_deposit_details'
    )
  })


  check('split_double_check_ok_rejects_date_loop', () => {
    expectReason(
      'split_double_check_ok_rejects_date_loop',
      base({
        message: 'ok',
        recent_history: [
          { role: 'assistant', text: 'name: 진호' },
          { role: 'assistant', text: 'phone number: 1231231234' },
          { role: 'assistant', text: 'appointment date: june 20' },
          { role: 'assistant', text: 'time: 2pm' },
          { role: 'assistant', text: 'can you give this a quick look and make sure it\'s all right? 🖤' }
        ],
        structured_state: { form_link_sent: true, form_submitted: true, accepted_offered_date: 'june 20', accepted_offered_time: '2pm' }
      }),
      { bubbles: [{ text: 'ok june 20 at 2pm works on my side' }] },
      'double_check_confirmation_requires_deposit_details'
    )
  })

  check('double_check_k_accepts_deposit_gate', () => {
    const packet = { bubbles: [
      { text: 'perfect thank you' },
      { text: 'to confirm your appointment the deposit is 100' },
      { text: 'zelle is contact@omarprotocol.com' },
      { text: 'once you send it message me so i can double check and confirm the appointment on my calendar' }
    ] }
    expectValid(
      'double_check_k_accepts_deposit_gate',
      base({
        message: 'k',
        recent_history: [{ role: 'assistant', text: 'name: 진호\nphone number: 1231231234\nappointment date: june 20\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }],
        structured_state: { form_link_sent: true, form_submitted: true, accepted_offered_date: 'june 20', accepted_offered_time: '2pm' }
      }),
      packet,
      (p) => { if (!packetSendsDepositDetails(p)) fail('double_check_k_accepts_deposit_gate', 'deposit_meaning_missing') }
    )
  })

  check('double_check_confirmation_rejects_date_loop', () => {
    expectReason(
      'double_check_confirmation_rejects_date_loop',
      base({
        message: 'Yes perfect',
        recent_history: [{ role: 'assistant', text: 'name: 근호\nphone number: 1231231234\nappointment date: june 22\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }],
        structured_state: { form_link_sent: true, form_submitted: true, accepted_offered_date: 'june 22', accepted_offered_time: '2pm' }
      }),
      { bubbles: [{ text: 'ok june 22 at 2pm works on my side' }] },
      'double_check_confirmation_requires_deposit_details'
    )
  })

  check('bare_ordinal_date_double_check_rejected', () => {
    expectReason(
      'bare_ordinal_date_double_check_rejected',
      base({
        message: 'yes that works',
        structured_state: {
          booking_stage_hint: 'ready_for_double_check',
          known_name_used_on_form: 'Ordinal Test',
          known_phone_used_on_form: '4157602883',
          known_requested_date: '7th',
          known_requested_time: '2pm',
          form_link_sent: true,
          form_submitted: true
        }
      }),
      { bubbles: [{ text: 'Name : Ordinal Test\nPhone Number : 4157602883\nAppointment date : 7th\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }] },
      'appointment_date_double_check_requires_month'
    )
  })

  check('double_check_confirmation_accepts_deposit_handoff_meaning', () => {
    const packet = { bubbles: [
      { text: 'perfect thank you' },
      { text: `studio is at ${EXACT_ADDRESS}` },
      { text: 'the deposit is 100' },
      { text: 'zelle is contact@omarprotocol.com' },
      { text: 'once you send it message me so i can double check and confirm the appointment on my calendar' }
    ] }
    expectValid(
      'double_check_confirmation_accepts_deposit_handoff_meaning',
      base({
        message: 'Yes perfect',
        recent_history: [{ role: 'assistant', text: 'name: 근호\nphone number: 1231231234\nappointment date: june 22\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }],
        structured_state: { form_link_sent: true, form_submitted: true, accepted_offered_date: 'june 22', accepted_offered_time: '2pm' }
      }),
      packet,
      (p) => { if (!packetSendsDepositDetails(p)) fail('double_check_confirmation_accepts_deposit_handoff_meaning', 'deposit_meaning_missing') }
    )
  })

  check('name_phone_with_slot_requires_double_check', () => {
    expectReason(
      'name_phone_with_slot_requires_double_check',
      base({
        message: '진호 1231231234',
        recent_history: [
          { role: 'assistant', text: 'june 20 at 2pm works on my side' },
          { role: 'assistant', text: 'send the name and phone used on the form' }
        ],
        structured_state: { form_link_sent: true, accepted_offered_date: 'june 20', accepted_offered_time: '2pm' }
      }),
      { bubbles: [{ text: 'got your phone number' }] },
      'name_phone_with_slot_requires_double_check'
    )
  })

  check('name_phone_with_slot_accepts_double_check_block', () => {
    const packet = { bubbles: [{ text: 'name: 진호\nphone number: 1231231234\nappointment date: june 20\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }] }
    expectValid(
      'name_phone_with_slot_accepts_double_check_block',
      base({
        message: '진호 1231231234',
        recent_history: [
          { role: 'assistant', text: 'june 20 at 2pm works on my side' },
          { role: 'assistant', text: 'send the name and phone used on the form' }
        ],
        structured_state: { form_link_sent: true, accepted_offered_date: 'june 20', accepted_offered_time: '2pm' }
      }),
      packet,
      (p) => { if (!packetHasNamePhoneDateTimeDoubleCheck(p)) fail('name_phone_with_slot_accepts_double_check_block', 'double_check_missing') }
    )
  })

  check('explicit_link_request_requires_link', () => {
    expectReason('explicit_link_request_requires_link', base({ message: 'can you send me the link?' }), { bubbles: [{ text: 'i can send it over' }] }, 'explicit_form_link_request_requires_link')
  })

  check('explicit_link_request_accepts_link_plus_availability', () => {
    const packet = { bubbles: [{ text: `of course ${PREFERRED_FORM_LINK}` }, { text: 'send a couple dates here too so i can check faster' }] }
    expectValid('explicit_link_request_accepts_link_plus_availability', base({ message: 'can you send me the link?' }), packet, (p) => {
      if (!packetSendsPreferredFormLink(p)) fail('explicit_link_request_accepts_link_plus_availability', 'link_missing')
    })
  })

  check('form_offer_one_shot_rejects_second_offer', () => {
    expectReason(
      'form_offer_one_shot_rejects_second_offer',
      base({
        message: 'visible',
        recent_history: [
          { role: 'assistant', text: 'want me to send the form so we can start moving it forward?' },
          { role: 'assistant', text: 'do you want it more visible or a little quieter?' }
        ],
        structured_state: { form_offer_asked: true, known_size_context: '4 by 4' }
      }),
      { bubbles: [{ text: 'want me to send the form so we can start moving it forward?' }] },
      'form_permission_offer_one_shot'
    )
  })


  check('roughly_8_in_size_answer_requires_acknowledge_and_defer', () => {
    expectReason(
      'roughly_8_in_size_answer_requires_acknowledge_and_defer',
      base({
        message: 'roughly 8 in or so',
        recent_history: [{ role: 'assistant', text: 'what rough size were you thinking' }],
        structured_state: { known_design_context: 'custom', known_placement_context: 'arm maybe' }
      }),
      { bubbles: [] },
      'volunteered_placement_size_requires_acknowledge_and_defer'
    )
  })

  check('eighteen_inches_open_form_offer_requires_acknowledge_and_defer', () => {
    expectReason(
      'eighteen_inches_open_form_offer_requires_acknowledge_and_defer',
      base({
        message: '18 inches or so',
        recent_history: [
          { role: 'assistant', text: 'want me to send the form so we can start moving it forward?' }
        ],
        structured_state: { known_design_context: 'custom', known_placement_context: 'back', form_offer_asked: true, booking_stage_hint: 'design_intake' }
      }),
      { bubbles: [] },
      'volunteered_placement_size_requires_acknowledge_and_defer'
    )
  })

  check('size_answer_requires_acknowledge_and_defer', () => {
    expectReason(
      'size_answer_requires_acknowledge_and_defer',
      base({
        message: 'middle size',
        recent_history: [{ role: 'assistant', text: 'were you thinking about rough size yet or should we get to the next?' }],
        structured_state: { known_design_context: 'custom', known_placement_context: 'arm maybe' }
      }),
      { bubbles: [] },
      'volunteered_placement_size_requires_acknowledge_and_defer'
    )
  })

  check('size_answer_accepts_model_next_move_meaning', () => {
    const input = base({
      message: 'middle size',
      recent_history: [{ role: 'assistant', text: 'were you thinking about rough size yet or should we get to the next?' }],
      structured_state: { known_design_context: 'custom', known_placement_context: 'arm maybe' }
    })
    const packet = { bubbles: [
      { text: 'got it' },
      { text: 'we can dial the exact sizing and placement in person' },
      { text: 'should i send the form so we can move it forward' }
    ] }
    expectValid('size_answer_accepts_model_next_move_meaning', input, packet, (p) => {
      if (!packetMovesAfterSizeAnswer(input, p)) fail('size_answer_accepts_model_next_move_meaning', 'size_next_move_missing')
    })
  })

  check('visibility_choice_accepts_next_move_meaning', () => {
    const packet = { bubbles: [
      { text: 'visible makes sense for this' },
      { text: 'we can keep it readable without making it too loud' },
      { text: 'what subject or reference are you picturing for it' }
    ] }
    expectValid(
      'visibility_choice_accepts_next_move_meaning',
      base({ message: 'visible', recent_history: [{ role: 'assistant', text: 'do you want it more visible or a little quieter?' }], structured_state: { booking_stage_hint: 'design_intake' } }),
      packet,
      (p) => { if (!packetMovesAfterVisibilityChoice(p)) fail('visibility_choice_accepts_next_move_meaning', 'visibility_next_move_missing') }
    )
  })

  check('placement_possibility_accepts_answer_and_next_move', () => {
    const packet = { bubbles: [
      { text: 'yeah that area can be possible' },
      { text: 'exact placement can be adjusted in person' },
      { text: 'what subject or reference are you thinking for the tattoo' }
    ] }
    expectValid(
      'placement_possibility_accepts_answer_and_next_move',
      base({ message: 'general area is possible?', recent_history: [{ role: 'assistant', text: 'do you have a spot in mind where you are thinking of putting it?' }], structured_state: { booking_stage_hint: 'design_intake' } }),
      packet,
      (p) => { if (!packetAnswersPlacementPossibilityAndMovesNext(p)) fail('placement_possibility_accepts_answer_and_next_move', 'placement_next_move_missing') }
    )
  })


  check('lua_identity_rejects_social_flat_ack_dead_end', () => {
    expectReason(
      'lua_identity_rejects_social_flat_ack_dead_end',
      base({
        message: 'pretty good not bad',
        recent_history: [{ role: 'assistant', text: 'hey hey i am good how are you doing today' }],
        structured_state: { booking_stage_hint: 'open_conversation' }
      }),
      { bubbles: [{ text: 'nice glad to hear it' }] },
      'lua_identity_flat_ack_dead_end'
    )
  })

  check('lua_identity_accepts_social_reply_with_motion', () => {
    expectValid(
      'lua_identity_accepts_social_reply_with_motion',
      base({
        message: 'pretty good not bad',
        recent_history: [{ role: 'assistant', text: 'hey hey i am good how are you doing today' }],
        structured_state: { booking_stage_hint: 'open_conversation' }
      }),
      { bubbles: [{ text: 'okay good not bad is honestly a win sometimes what have you been up to today?' }] }
    )
  })

  check('location_request_rejects_deposit_gate', () => {
    expectReason('location_request_rejects_deposit_gate', base({ message: 'where are you located?' }), { bubbles: [{ text: 'i can send the address after deposit' }] }, 'exact_location_disclosure')
  })

  check('location_request_accepts_public_address', () => {
    expectValid('location_request_accepts_public_address', base({ message: 'where are you located?' }), { bubbles: [{ text: `i am in sf at ${EXACT_ADDRESS}` }] })
  })

  if (failures.length) {
    const err = new Error(`scv_critical_route_harness_failed ${JSON.stringify(failures, null, 2)}`)
    err.failures = failures
    throw err
  }

  return { ok: true, locked: true, lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION, checked }
}

if (require.main === module) {
  const result = runScvCriticalRouteHarness()
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

module.exports = { runScvCriticalRouteHarness }
