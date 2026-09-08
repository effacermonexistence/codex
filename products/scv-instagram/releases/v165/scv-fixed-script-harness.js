#!/usr/bin/env node
// Locks Ben's fixed booking checkpoints and the retired opener kill switch:
//   ① old 3-bubble tattoo-door opener must NOT fire anymore
//   ② fixed Name/Phone Number/Appointment date/Time double-check block
//   ③ fixed deposit handoff block
// Everything else in the system stays model-authored with varied wording.
const path = require('path')
const {
  buildDeterministicOpenerPacket,
  buildDeterministicBookingPacket,
  resolveBookingFunnelStage,
  enforceNoCommaAndPeriodSurfaceText
} = require(path.join(__dirname, 'codex-dm-runner.js'))
const {
  annotateStructuredStateForLiveTurn
} = require(path.join(__dirname, 'dm-authority.js'))
const {
  deriveClosedTransitionPlan,
  evaluateClosedTransitionContract
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const {
  extractBookingPhone,
  extractBookingNameNextToPhone
} = require(path.join(__dirname, 'scv-booking-identity.js'))
const {
  evaluateScvContractHarness,
  liveInfoAskOpener,
  isLockedOpenerGreetingPacket,
  LOCKED_OPENER_GREETING_BUBBLES,
  LOCKED_DEPOSIT_HANDOFF_BUBBLES,
  assistantSentNamePhoneDateTimeDoubleCheck
} = require(path.join(__dirname, 'scv-contract-harness.js'))

function assert(condition, label, detail = '') {
  if (!condition) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

function openerInput(message, extra = {}) {
  return {
    contact_id: 'test',
    thread_id: 'test',
    instagram_username: 'someone',
    message,
    received_at: '2026-06-23T00:00:00.000Z',
    recent_history: extra.recent_history || [],
    structured_state: Object.assign({ live_turn_reply_required: true }, extra.structured_state || {})
  }
}

function bubbleTexts(packet) {
  const bubbles = packet && packet.packet && Array.isArray(packet.packet.bubbles) ? packet.packet.bubbles : []
  return bubbles.map((b) => String(b.text || ''))
}

function runScvFixedScriptHarness() {
  let checked = 0

  // ── ① opener intent detected, but deterministic script must NOT fire ────────
  const fireCases = [
    'Can I please get more information?',
    'can i get more info',
    "I'm interested",
    'I am interested',
    'hey can i get some information',
    'interested!'
  ]
  for (const msg of fireCases) {
    assert(liveInfoAskOpener(openerInput(msg)) === true, 'opener_trigger_detected', msg)
    const out = buildDeterministicOpenerPacket(openerInput(msg))
    assert(out === null, 'deterministic_opener_retired_model_lane_required', msg)
    checked += 1
  }

  // Deprecated exact script is recognized only so it can be rejected by contract.
  const deprecatedGreetingPacket = { bubbles: LOCKED_OPENER_GREETING_BUBBLES.map((text) => ({ text, delay_ms: 0 })) }
  assert(isLockedOpenerGreetingPacket(deprecatedGreetingPacket) === true, 'deprecated_greeting_recognized')
  const deprecatedVerdict = evaluateScvContractHarness(openerInput("I'm interested"), deprecatedGreetingPacket)
  assert(deprecatedVerdict.valid === false && deprecatedVerdict.reason === 'deprecated_fixed_opener_script', 'deprecated_greeting_rejected', JSON.stringify(deprecatedVerdict))
  checked += 1

  // Live Omar regression 2026-07-15: after the system asked for the name and
  // phone used on the form, "i used <name> and <phone>" reached the deterministic
  // checkpoint but the closed-transition verifier compared it against empty
  // persisted fields and rejected the reply. The current live candidates and the
  // visible checkpoint must share one exact identity authority object.
  const liveIdentityMessage = 'i used Omar System Replay Six and 4155550198'
  const liveIdentityState = annotateStructuredStateForLiveTurn({ text: liveIdentityMessage }, {
    form_link_sent: true,
    form_submitted: true,
    known_requested_date: 'August 23',
    known_requested_time: '2pm',
    booking_stage_hint: 'awaiting_form_identity_match',
    current_message_date_local: 'July 14, 2026',
    minimum_booking_date_local: 'July 21, 2026',
    maximum_booking_date_local: 'January 14, 2027'
  })
  const liveIdentityInput = {
    contact_id: 'test',
    thread_id: 'test',
    instagram_username: 'omar.system',
    message: liveIdentityMessage,
    received_at: '2026-07-15T05:55:28.497Z',
    recent_history: [],
    structured_state: liveIdentityState
  }
  const liveIdentityPlan = deriveClosedTransitionPlan(liveIdentityInput)
  const liveIdentityPacket = buildDeterministicBookingPacket(liveIdentityInput)
  const liveIdentityVerdict = evaluateClosedTransitionContract(
    liveIdentityInput,
    liveIdentityPacket && liveIdentityPacket.packet,
    liveIdentityPlan
  )
  assert(liveIdentityState.live_turn_name_candidate === 'Omar System Replay Six', 'live_identity_wrapper_removed', liveIdentityState.live_turn_name_candidate)
  assert(liveIdentityState.live_turn_phone_candidate === '4155550198', 'live_identity_phone_exact', liveIdentityState.live_turn_phone_candidate)
  assert(liveIdentityPlan.fields.name === 'Omar System Replay Six' && liveIdentityPlan.fields.phone === '4155550198', 'live_identity_plan_uses_current_turn_fields', JSON.stringify(liveIdentityPlan.fields))
  assert(liveIdentityPacket.packet.bubbles[0].text === 'Name : Omar System Replay Six\nPhone Number : 4155550198\nAppointment date : 23rd of August\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤', 'live_identity_checkpoint_exact', liveIdentityPacket.packet.bubbles[0].text)
  assert(liveIdentityVerdict.valid === true, 'live_identity_checkpoint_adopted', JSON.stringify(liveIdentityVerdict))
  checked += 5

  for (const [surface, expectedName, expectedPhone] of [
    ['my name is Omar System Replay Six and my phone number is (415) 555-0198', 'Omar System Replay Six', '4155550198'],
    ['Omar System Replay Six 415-555-0198', 'Omar System Replay Six', '4155550198'],
    ['name is Omar System Replay Six, number is 415 555 0198', 'Omar System Replay Six', '4155550198'],
    ['the name i used is Omar System Replay Six and phone number is 415.555.0198', 'Omar System Replay Six', '4155550198']
  ]) {
    assert(extractBookingNameNextToPhone(surface) === expectedName, 'identity_surface_name_exact', surface)
    assert(extractBookingPhone(surface) === expectedPhone, 'identity_surface_phone_exact', surface)
    checked += 1
  }

  // ── ① opener must NOT fire ───────────────────────────────────────────────────
  const noFireCases = [
    "I'm not interested",
    'not interested',
    'no longer interested',
    'stop'
  ]
  for (const msg of noFireCases) {
    assert(buildDeterministicOpenerPacket(openerInput(msg)) === null, 'opener_suppressed_on_negation', msg)
    checked += 1
  }

  // mid-funnel "i'm interested" must continue the funnel, not reset to greeting
  assert(
    buildDeterministicOpenerPacket(openerInput("I'm interested", { structured_state: { booking_stage_hint: 'design_intake' } })) === null,
    'opener_suppressed_mid_booking_stage'
  )
  // an opener that already carries a concrete design lets the model handle it
  assert(
    buildDeterministicOpenerPacket(openerInput("I'm interested in a dragon on my arm")) === null,
    'opener_suppressed_when_design_present'
  )
  // an active assistant tattoo consult suppresses a fresh greeting
  assert(
    buildDeterministicOpenerPacket(openerInput('more info', {
      recent_history: [{ role: 'assistant', text: 'what placement and rough size were you thinking for the tattoo' }]
    })) === null,
    'opener_suppressed_when_consult_active'
  )
  checked += 3

  // ── ② double-check block uses Ben's exact Name/Phone/Date/Time format ────────
  const dcInput = {
    contact_id: 'test',
    thread_id: 'test',
    instagram_username: 'someone',
    message: 'my name is John Smith and number is 5551234567',
    received_at: '2026-06-14T19:00:00.000Z',
    recent_history: [],
    structured_state: {
      current_message_date_local: 'June 14, 2026',
      minimum_booking_date_local: 'June 21, 2026',
      known_name_used_on_form: 'John Smith',
      known_phone_used_on_form: '5551234567',
      known_requested_date: 'June 22',
      known_requested_time: '2pm',
      booking_stage_hint: 'ready_for_double_check',
      form_link_sent: true,
      form_submitted: true
    }
  }
  const dcPacket = buildDeterministicBookingPacket(dcInput)
  assert(dcPacket && dcPacket.packet && dcPacket.packet.bubbles.length === 1, 'double_check_present')
  assert(
    dcPacket.packet.bubbles[0].text ===
      'Name : John Smith\nPhone Number : 5551234567\nAppointment date : 22nd of June\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤',
    'double_check_exact_ben_format',
    dcPacket.packet.bubbles[0].text
  )
  checked += 1

  // ② the new format is still recognized as a double-check in thread history so the
  // "yes" -> deposit handoff keeps firing.
  const historyWithNewDoubleCheck = {
    recent_history: [
      { role: 'assistant', text: 'Name : John Smith\nPhone Number : 5551234567\nAppointment date : June 22\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }
    ]
  }
  assert(
    assistantSentNamePhoneDateTimeDoubleCheck(historyWithNewDoubleCheck) === true,
    'new_format_double_check_recognized_in_history'
  )
  // legacy lowercase format must also still be recognized (in-flight threads)
  const historyWithOldDoubleCheck = {
    recent_history: [
      { role: 'assistant', text: 'name: John Smith\nphone number: 5551234567\nappointment date: June 22\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }
    ]
  }
  assert(
    assistantSentNamePhoneDateTimeDoubleCheck(historyWithOldDoubleCheck) === true,
    'legacy_format_double_check_still_recognized'
  )
  checked += 2

  // ── ③ conversion endpoint: a positive signal right after the double-check must
  // fire the deposit handoff deterministically (100%), incl. emoji / Korean / casual.
  const dcSent = (msg) => ({
    contact_id: 'test',
    thread_id: 'test',
    instagram_username: 'someone',
    message: msg,
    received_at: '2026-06-23T00:00:00.000Z',
    recent_history: [{ role: 'assistant', text: 'Name : John Smith\nPhone Number : 5551234567\nAppointment date : June 22\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }],
    structured_state: {
      known_name_used_on_form: 'John Smith',
      known_phone_used_on_form: '5551234567',
      known_requested_date: 'June 22',
      known_requested_time: '2pm',
      form_link_sent: true,
      form_submitted: true
    }
  })
  const expectedDepositSurface = LOCKED_DEPOSIT_HANDOFF_BUBBLES
    .map((text) => enforceNoCommaAndPeriodSurfaceText(text))
  const firesDeposit = (msg) => {
    const pkt = buildDeterministicBookingPacket(dcSent(msg))
    return !!(
      pkt &&
      pkt.authority &&
      /deposit/.test(pkt.authority.route_lock || '') &&
      pkt.packet?.bubbles?.length === expectedDepositSurface.length &&
      pkt.packet.bubbles.every((bubble, index) => bubble.text === expectedDepositSurface[index])
    )
  }
  // The semantic handoff stays exactly locked while the final client surface
  // applies the owner's punctuation rule at the last pre-verification boundary.
  const depositPkt = buildDeterministicBookingPacket(dcSent('yes'))
  assert(
    depositPkt.packet.bubbles.length === LOCKED_DEPOSIT_HANDOFF_BUBBLES.length &&
      depositPkt.packet.bubbles.every((b, i) => b.text === expectedDepositSurface[i]),
    'deposit_handoff_exact_semantics_owner_surface',
    JSON.stringify(depositPkt.packet.bubbles.map((b) => b.text))
  )
  assert(
    depositPkt.packet.bubbles.every((bubble) =>
      !/[,，]/.test(bubble.text) && !/[.。．]+\s*$/.test(bubble.text)
    ),
    'deposit_handoff_owner_punctuation_surface'
  )
  assert(depositPkt.packet.authority_transport_flags && depositPkt.packet.authority_transport_flags.atomic_deposit_handoff === true, 'deposit_handoff_atomic_flag')
  assert(LOCKED_DEPOSIT_HANDOFF_BUBBLES[0] === 'To confirm your appointment the deposit would be 100.', 'deposit_amount_first_bubble')
  assert(LOCKED_DEPOSIT_HANDOFF_BUBBLES[1] === 'This is my zelle!', 'deposit_zelle_label_before_account')
  assert(LOCKED_DEPOSIT_HANDOFF_BUBBLES[2] === 'contact@omarprotocol.com', 'deposit_zelle_account_after_label')
  assert(LOCKED_DEPOSIT_HANDOFF_BUBBLES.filter((text) => /(?:once you send|when you(?:re|'re) done)/i.test(text)).length === 1, 'deposit_single_post_send_cta')
  assert(/Once you send it/.test(LOCKED_DEPOSIT_HANDOFF_BUBBLES.at(-1)), 'deposit_post_send_cta_last')
  assert(/\bdeposit\b/.test(depositPkt.packet.bubbles[0].text) && /\b100\b/.test(depositPkt.packet.bubbles[0].text), 'deposit_amount_present')
  checked += 8
  const positives = ['yes', 'ok', 'perfect', 'correct', 'sounds good', 'sounds great', 'that works', 'yeah that works', 'looks good', '그래', '네', '오케이', 'ya', 'k', 'sure', 'bet', '👍', '💯', '❤️', '👌', '🙏', 'yes!! 😍']
  for (const yes of positives) {
    assert(firesDeposit(yes) === true, 'positive_signal_fires_deposit', yes)
    checked += 1
  }
  const nonConfirms = ['no thats wrong', 'wait change the date', 'what time works', 'can you change the time', 'not yet', 'actually different date', '👎']
  for (const no of nonConfirms) {
    assert(firesDeposit(no) === false, 'non_confirm_does_not_fire_deposit', no)
    checked += 1
  }

  // Live Omar regression 2026-07-15: Gmail supplied identity and the client supplied
  // only "August 22". The runner silently invented preferred 2pm and jumped straight
  // to the four-field double-check. Date-only must stop at an explicit time offer.
  const dateOnlyInput = {
    contact_id: 'test-date-only',
    thread_id: 'test-date-only',
    instagram_username: 'omar.system',
    message: 'saturdays are best, august 22 would work',
    received_at: '2026-07-15T05:29:27.885Z',
    recent_history: [
      { role: 'assistant', text: 'what dates or weekend days are easiest for you?' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Omar System Replay Five',
      known_phone_used_on_form: '4155550188',
      known_requested_date: 'august 22',
      preferred_time_primary: '2pm',
      live_turn_date_phrase: 'august 22',
      live_turn_date_status: 'legal',
      booking_stage_hint: 'awaiting_time'
    }
  }
  const dateOnlyPacket = buildDeterministicBookingPacket(dateOnlyInput)
  const dateOnlyTexts = bubbleTexts(dateOnlyPacket)
  const dateOnlyStage = resolveBookingFunnelStage(dateOnlyInput)
  assert(dateOnlyPacket === null, 'date_only_visible_time_offer_must_be_model_authored', JSON.stringify(dateOnlyPacket))
  assert(dateOnlyStage.stage === 'time_after_form', 'date_only_semantic_route_is_time_after_form', JSON.stringify(dateOnlyStage))
  assert(!/Name\s*:/i.test(dateOnlyTexts.join('\n')) && !/Phone Number\s*:/i.test(dateOnlyTexts.join('\n')), 'date_only_cannot_emit_identity_checkpoint')
  checked += 3

  const acceptedTimeInput = {
    ...dateOnlyInput,
    message: '2pm works for me',
    recent_history: [
      ...dateOnlyInput.recent_history,
      { role: 'assistant', text: 'August 22 works on my side. would 2pm work for you?' }
    ],
    structured_state: {
      ...dateOnlyInput.structured_state,
      known_requested_time: '2pm',
      booking_stage_hint: 'ready_for_double_check'
    }
  }
  const acceptedTimePacket = buildDeterministicBookingPacket(acceptedTimeInput)
  const acceptedTimeTexts = bubbleTexts(acceptedTimePacket)
  assert(acceptedTimePacket && /double_check/.test(acceptedTimePacket.authority.route_lock || ''), 'explicit_time_acceptance_unlocks_double_check', JSON.stringify(acceptedTimePacket))
  assert(acceptedTimeTexts.length === 1 && /Appointment date : 22nd of August/.test(acceptedTimeTexts[0]) && /Time : 2pm/.test(acceptedTimeTexts[0]), 'accepted_time_double_check_uses_exact_fields', acceptedTimeTexts.join(' | '))
  checked += 2

  const counterproposalTimePacket = buildDeterministicBookingPacket({
    ...dateOnlyInput,
    message: '1pm works for me',
    recent_history: [
      ...dateOnlyInput.recent_history,
      { role: 'assistant', text: 'August 22 works on my side. would 2pm work for you?' }
    ],
    structured_state: {
      ...dateOnlyInput.structured_state,
      last_offered_date: 'august 22',
      last_offered_time: '2pm',
      live_turn_accepts_offered_slot: true
    }
  })
  const counterproposalTimeTexts = bubbleTexts(counterproposalTimePacket)
  assert(
    counterproposalTimePacket &&
      /double_check/.test(counterproposalTimePacket.authority.route_lock || '') &&
      /Appointment date : 22nd of August/.test(counterproposalTimeTexts[0]) &&
      /Time : 1pm/.test(counterproposalTimeTexts[0]) &&
      !/Time : 2pm/.test(counterproposalTimeTexts[0]),
    'explicit_time_counterproposal_overrides_stale_offered_time_and_false_acceptance_flag',
    JSON.stringify(counterproposalTimePacket)
  )
  checked += 1

  return { ok: true, checked }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvFixedScriptHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  }
}

module.exports = { runScvFixedScriptHarness }
