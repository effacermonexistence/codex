#!/usr/bin/env node
const path = require('path')

const {
  PREFERRED_FORM_LINK,
  EXACT_ADDRESS
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
  ACTIONS,
  deriveClosedTransitionPlan,
  deriveVerifierRebasePlan,
  evaluateClosedTransitionContract,
  evaluateClosedTransitionLivenessFloor,
  buildClosedTransitionRepairLock,
  bookingPolicyDecisionForInput
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const {
  annotateStructuredStateForLiveTurn,
  extractContextualBookingDayReply
} = require(path.join(__dirname, 'dm-authority.js'))
const {
  applyDiscourseClassification
} = require(path.join(__dirname, 'scv-discourse-continuity.js'))

const SCV_CLOSED_TRANSITION_HARNESS_VERSION = 'scv-closed-transition-harness-2026-08-29-v65-clock-wording-and-discounted-model-rate'

const BASE_STATES = [
  { id: 'open', state: { booking_stage_hint: 'open_conversation' } },
  { id: 'tattoo_no_design', state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' } },
  { id: 'design_ready', state: { tattoo_intent_active: true, known_design_context: 'black and gray snake reference', booking_stage_hint: 'design_intake' } },
  { id: 'form_offer_open', state: { tattoo_intent_active: true, known_design_context: 'black and gray snake reference', form_offer_asked: true, booking_stage_hint: 'awaiting_form_permission_answer' } },
  { id: 'form_link_sent', state: { tattoo_intent_active: true, known_design_context: 'black and gray snake reference', form_offer_asked: true, form_link_sent: true, booking_stage_hint: 'awaiting_form_submission' } },
  { id: 'submitted_no_date', state: { tattoo_intent_active: true, known_design_context: 'black and gray snake reference', form_offer_asked: true, form_link_sent: true, form_submitted: true, booking_stage_hint: 'awaiting_date' } },
  { id: 'submitted_date_only', state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, known_requested_date: '18th of July', booking_stage_hint: 'awaiting_time' } },
  { id: 'submitted_slot_no_identity', state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, known_requested_date: '18th of July', known_requested_time: '2pm', booking_stage_hint: 'awaiting_form_identity_match' } },
  { id: 'submitted_slot_name_only', state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, known_name_used_on_form: 'Eloise', known_requested_date: '18th of July', known_requested_time: '2pm', booking_stage_hint: 'awaiting_phone_used_on_form' } },
  { id: 'four_fields_ready', state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, known_name_used_on_form: 'Eloise', known_phone_used_on_form: '4155550199', known_requested_date: '18th of July', known_requested_time: '2pm', booking_stage_hint: 'ready_for_double_check' } },
  { id: 'double_check_sent', state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, known_name_used_on_form: 'Eloise', known_phone_used_on_form: '4155550199', known_requested_date: '18th of July', known_requested_time: '2pm', booking_stage_hint: 'ready_for_double_check' } },
  { id: 'deposit_requested', state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, deposit_requested: true, known_name_used_on_form: 'Eloise', known_phone_used_on_form: '4155550199', known_requested_date: '18th of July', known_requested_time: '2pm', booking_stage_hint: 'deposit_requested' } }
]

const LIVE_INTENTS = [
  { id: 'ordinary', message: 'okay sounds good' },
  { id: 'location', message: 'where are you located?' },
  { id: 'price', message: 'how much is it though?' },
  { id: 'free_price', message: 'By the way, is it free?' },
  { id: 'form_consent', message: 'yes please', flags: { live_turn_form_consent: true } },
  { id: 'explicit_form_request', message: 'can you send me the form?', flags: { live_turn_explicit_form_request: true } },
  { id: 'slot_accept', message: 'yeah that works for me', flags: { live_turn_accepts_offered_slot: true } },
  { id: 'form_submitted', message: 'i just submitted the form', flags: { live_turn_form_submitted_signal: true } },
  { id: 'deposit_sent', message: 'i just sent the deposit', flags: { live_turn_deposit_sent: true } },
  { id: 'consult_meetup', message: 'can we meet up and discuss the tattoo?' },
  { id: 'decline', message: 'not yet maybe later', flags: { live_turn_declines: true } }
]

const COMBINATION_FLAGS = [
  'live_turn_form_consent',
  'live_turn_explicit_form_request',
  'live_turn_accepts_offered_slot',
  'live_turn_form_submitted_signal',
  'live_turn_deposit_sent',
  'live_turn_pricing_question',
  'live_turn_is_question',
  'live_turn_declines'
]

function inputFor(base, intent) {
  const state = { ...base.state, ...(intent.flags || {}) }
  if (intent.id === 'slot_accept') {
    state.last_offered_date = state.last_offered_date || '18th of July'
    state.last_offered_time = state.last_offered_time || '2pm'
    state.accepted_offered_date = state.accepted_offered_date || '18th of July'
    state.accepted_offered_time = state.accepted_offered_time || '2pm'
  }
  const recentHistory = []
  if (state.form_offer_asked) recentHistory.push({ role: 'assistant', text: 'want me to send the application form?' })
  if (state.form_link_sent) recentHistory.push({ role: 'assistant', text: `here is the form ${PREFERRED_FORM_LINK}` })
  if (base.id === 'double_check_sent' || base.id === 'deposit_requested') {
    recentHistory.push({ role: 'assistant', text: 'Name : Eloise\nPhone Number : 4155550199\nAppointment date : 18th of July\nTime : 2pm\n\ncan you double check this just to make sure' })
  }
  if (base.id === 'deposit_requested') {
    recentHistory.push({ role: 'assistant', text: 'to confirm your appointment the deposit is 100\ncontact@omarprotocol.com\nthat is my zelle\nonce you send it let me know so i can confirm the appointment on my calendar' })
  }
  if (intent.id === 'slot_accept') recentHistory.push({ role: 'assistant', text: '18th of July at 2pm works on my side. does that work for you?' })
  return {
    contact_id: `closed-${base.id}-${intent.id}`,
    thread_id: `closed-${base.id}-${intent.id}`,
    instagram_username: 'omar.system',
    message: intent.message,
    received_at: '2026-07-12T20:00:00.000Z',
    recent_history: recentHistory,
    structured_state: state
  }
}

function goodPacketFor(plan) {
  let bubbles
  switch (plan.action) {
    case ACTIONS.DEPOSIT_HOLD:
      bubbles = [{ text: "it hasn't come through on my side yet, i'm checking and i'll confirm the moment it lands" }]
      break
    case ACTIONS.DEPOSIT_PENDING_CONTINUE:
      bubbles = [{ text: 'yeah i have that side set, what were you wondering about?' }]
      break
    case ACTIONS.DEPOSIT_HANDOFF:
      bubbles = [
        { text: 'perfect' },
        { text: 'to confirm your appointment the deposit is 100' },
        { text: 'contact@omarprotocol.com' },
        { text: 'that is my zelle' },
        { text: 'once you send it let me know so i can double check everything on my side and confirm the appointment on my calendar' }
      ]
      break
    case ACTIONS.DOUBLE_CHECK:
      bubbles = [{
        text: `Name : ${plan.fields.name}\nPhone Number : ${plan.fields.phone}\nAppointment date : ${plan.fields.date}\nTime : ${plan.fields.time}\n\ncan you double check this just to make sure`
      }]
      break
    case ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION:
      bubbles = [{ text: 'if anything there needs changing just tell me which line and i will fix it' }]
      break
    case ACTIONS.SEND_FORM:
      bubbles = [
        { text: `here is the form ${PREFERRED_FORM_LINK}` },
        { text: 'send me a couple of dates you are available in this dm so i can check faster on my side' }
      ]
      break
    case ACTIONS.CLARIFY_FORM_PERMISSION:
      bubbles = [{ text: 'wait i might have heard that wrong, did you mean you want me to send the form?' }]
      break
    case ACTIONS.RESOLVE_CONTEXT:
      bubbles = plan.reason === 'missing_attachment'
        ? [{ text: 'send me the actual reference when you get a sec so i can see what you mean' }]
        : [{ text: 'what exactly are you referring to there?' }]
      break
    case ACTIONS.POST_FORM_AVAILABILITY:
      if (plan.reason === 'submitted_form_monthless_day_requires_month_clarification') {
        bubbles = [{ text: `the ${plan.fields.monthless_day}th — which month did you mean?` }]
      } else if (plan.reason === 'form_handoff_coarse_day_constraint_requires_grounded_slot') {
        bubbles = [{ text: `${plan.fields.last_offered_date} at ${plan.fields.last_offered_time} is the closest ${plan.fields.day_constraint} spot does that work for you?` }]
      } else {
        bubbles = [{ text: 'perfect i got the form. what dates or weekend days are easiest for you?' }]
      }
      break
    case ACTIONS.POST_FORM_TIME:
      bubbles = [{ text: 'that date works. what time is best for you?' }]
      break
    case ACTIONS.POST_FORM_IDENTITY: {
      const parts = []
      if (!plan.fields.name) parts.push('name')
      if (!plan.fields.phone) parts.push('phone number')
      bubbles = [{ text: `perfect i have the date and time. what ${parts.join(' and ')} did you use on the form?` }]
      break
    }
    case ACTIONS.ACCEPTED_SLOT_PROGRESS:
      bubbles = [{ text: '18th of July at 2pm works on my side. once the form is in send me the name and phone number you used so i can double check everything' }]
      break
    case ACTIONS.KEEP_CONSULTATION_IN_DM:
      bubbles = [{ text: 'we can go over the design right here in the dm. send me the references and direction you want me to pull from' }]
      break
    case ACTIONS.OFFER_FORM:
      bubbles = [{ text: 'yeah i can build a custom piece from that direction. want me to send the application form?' }]
      break
    case ACTIONS.DESIGN_INTAKE:
      bubbles = [{ text: 'send me any loose idea, reference, or vibe you are drawn to and i can help shape it from there' }]
      break
    case ACTIONS.TATTOO_CONTINUE:
      bubbles = [{ text: 'i can work with that direction. what part of the reference do you want me to keep strongest?' }]
      break
    case ACTIONS.SOCIAL_CONTINUE:
      bubbles = [{ text: "i'm good, what have you been up to today?" }]
      break
    default:
      bubbles = [{ text: 'yeah i hear you, what happened next?' }]
      break
  }

  if (plan.obligations.includes('answer_exact_location')) {
    bubbles.push({ text: EXACT_ADDRESS })
  }
  if (plan.obligations.includes('answer_model_rate')) {
    bubbles.push({ text: 'the discounted model rate is 150 per hour as long as the design stays in my style' })
  }
  if (plan.obligations.includes('answer_artist_style_scope')) {
    bubbles.unshift({ text: 'i keep the finished work in my own style but references and custom ideas are totally fine to adapt into it' })
  }
  if (plan.obligations.includes('answer_tattoo_capability_scope')) {
    bubbles.unshift({ text: 'yeah i do black and gray too' })
  }
  return { bubbles }
}

function runClosedTransitionHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  const actions = new Set(Object.values(ACTIONS))
  for (const base of BASE_STATES) {
    for (const intent of LIVE_INTENTS) {
      const input = inputFor(base, intent)
      const plan = deriveClosedTransitionPlan(input)
      const good = goodPacketFor(plan)
      const verdict = evaluateClosedTransitionContract(input, good, plan)
      const emptyVerdict = evaluateClosedTransitionContract(input, { bubbles: [] }, plan)
      const key = `${base.id}__${intent.id}`
      check(`${key}__total_route`, actions.has(plan.action), JSON.stringify(plan))
      check(`${key}__single_unique_obligation_set`, new Set(plan.obligations).size === plan.obligations.length, JSON.stringify(plan))
      check(`${key}__valid_route_candidate_adopted`, verdict.valid === true, JSON.stringify({ plan, verdict, good }))
      check(`${key}__empty_candidate_rejected`, emptyVerdict.valid === false && emptyVerdict.reason === 'closed_transition_visible_reply_required', JSON.stringify(emptyVerdict))
    }
  }

  let enumeratedCombinationTransitions = 0
  const combinationCount = 2 ** COMBINATION_FLAGS.length
  for (const base of BASE_STATES) {
    for (let mask = 0; mask < combinationCount; mask += 1) {
      const input = inputFor(base, { id: `flags_${mask}`, message: 'okay' })
      for (let bit = 0; bit < COMBINATION_FLAGS.length; bit += 1) {
        if ((mask & (1 << bit)) !== 0) input.structured_state[COMBINATION_FLAGS[bit]] = true
      }
      if (input.structured_state.live_turn_accepts_offered_slot === true) {
        input.structured_state.last_offered_date = '18th of July'
        input.structured_state.last_offered_time = '2pm'
        input.structured_state.accepted_offered_date = '18th of July'
        input.structured_state.accepted_offered_time = '2pm'
        input.recent_history.push({ role: 'assistant', text: '18th of July at 2pm works on my side. does that work for you?' })
      }
      const firstPlan = deriveClosedTransitionPlan(input)
      const secondPlan = deriveClosedTransitionPlan(input)
      const verdict = evaluateClosedTransitionContract(input, goodPacketFor(firstPlan), firstPlan)
      const key = `${base.id}__flags_${mask}`
      check(`${key}__combination_total_route`, actions.has(firstPlan.action), JSON.stringify(firstPlan))
      check(`${key}__combination_deterministic_route`, JSON.stringify(firstPlan) === JSON.stringify(secondPlan), JSON.stringify({ firstPlan, secondPlan }))
      check(`${key}__combination_candidate_adopted`, verdict.valid === true, JSON.stringify({ firstPlan, verdict }))
      enumeratedCombinationTransitions += 1
    }
  }

  const criticalCases = [
    {
      id: 'confirmed_double_check_goes_direct_to_deposit',
      expected: ACTIONS.DEPOSIT_HANDOFF,
      input: {
        message: 'yes perfect',
        recent_history: [{ role: 'assistant', text: 'Name : Eloise\nPhone Number : 4155550199\nAppointment date : 18th of July\nTime : 2pm\n\ncan you double check this just to make sure' }],
        structured_state: { form_submitted: true, known_name_used_on_form: 'Eloise', known_phone_used_on_form: '4155550199', known_requested_date: '18th of July', known_requested_time: '2pm' }
      }
    },
    {
      id: 'double_check_confirmation_outranks_generic_slot_accept_flag',
      expected: ACTIONS.DEPOSIT_HANDOFF,
      input: {
        message: 'yeah, everything\u2019s perfect',
        recent_history: [{ role: 'assistant', text: 'Name : Kodak 12\nPhone Number : 1231231234\nAppointment date : 3rd of September\nTime : 1 PM\n\ncan you double check this just to make sure' }],
        structured_state: {
          tattoo_intent_active: true,
          form_link_sent: true,
          form_submitted: true,
          known_requested_date: 'september 3',
          known_requested_time: '1:00pm',
          last_offered_date: 'september 3',
          live_turn_accepts_offered_slot: true,
          booking_stage_hint: 'awaiting_form_identity_match'
        }
      }
    },
    {
      id: 'four_fields_go_to_one_double_check',
      expected: ACTIONS.DOUBLE_CHECK,
      input: { message: 'Eloise 4155550199', recent_history: [], structured_state: { form_submitted: true, known_name_used_on_form: 'Eloise', known_phone_used_on_form: '4155550199', known_requested_date: '18th of July', known_requested_time: '2pm' } }
    },
    {
      id: 'current_turn_identity_fields_go_to_one_double_check',
      expected: ACTIONS.DOUBLE_CHECK,
      input: {
        message: 'i used Omar System Replay Six and 4155550198',
        recent_history: [],
        structured_state: {
          form_link_sent: true,
          form_submitted: true,
          live_turn_name_candidate: 'Omar System Replay Six',
          live_turn_phone_candidate: '4155550198',
          known_requested_date: '23rd of August',
          known_requested_time: '2pm',
          booking_stage_hint: 'awaiting_form_identity_match'
        }
      }
    },
    {
      id: 'form_consent_fulfills_link',
      expected: ACTIONS.SEND_FORM,
      input: { message: 'yes please', recent_history: [{ role: 'assistant', text: 'want me to send the form?' }], structured_state: { tattoo_intent_active: true, known_design_context: 'snake', form_offer_asked: true, live_turn_form_consent: true } }
    },
    {
      id: 'voice_wrapped_compositional_form_consent_fulfills_link',
      expected: ACTIONS.SEND_FORM,
      input: {
        message: 'sent a voice note saying: Yeah, sure. Go ahead.',
        recent_history: [{ role: 'assistant', text: 'if you want i can send the application form now so we can start confirming your spot?' }],
        structured_state: {
          tattoo_intent_active: true,
          known_design_context: 'custom reference',
          form_offer_asked: true,
          form_link_sent: false,
          live_turn_is_voice_note: true,
          booking_stage_hint: 'awaiting_form_permission_answer'
        }
      }
    },
    {
      id: 'submitted_form_never_stops_flat',
      expected: ACTIONS.POST_FORM_AVAILABILITY,
      input: { message: 'i just submitted', recent_history: [{ role: 'assistant', text: `here is the form ${PREFERRED_FORM_LINK}` }], structured_state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, live_turn_form_submitted_signal: true } }
    },
    {
      id: 'reference_direction_moves_to_form_offer',
      expected: ACTIONS.OFFER_FORM,
      input: { message: 'sent a reference post: i want something like this', recent_history: [], structured_state: { tattoo_intent_active: true, known_reference_media_received: true, live_turn_is_media_reference: true, live_turn_gave_design_idea: true, known_design_context: 'reference image' } }
    },
    {
      id: 'capability_question_answers_then_stays_in_design_intake',
      expected: ACTIONS.DESIGN_INTAKE,
      input: {
        message: 'do you also do black and gray?',
        recent_history: [{ role: 'assistant', text: 'what kind of tattoo idea do you have in mind?' }],
        structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
      }
    },
    {
      id: 'missing_attachment_uses_general_context_resolution_route',
      expected: ACTIONS.RESOLVE_CONTEXT,
      input: { message: 'same energy as this', recent_history: [], structured_state: { tattoo_intent_active: true, live_turn_context_relation: 'missing_attachment', live_turn_context_missing: true, live_turn_context_missing_attachment: true } }
    },
    {
      id: 'missing_referent_uses_general_context_resolution_route',
      expected: ACTIONS.RESOLVE_CONTEXT,
      input: { message: 'he said no though', recent_history: [], structured_state: { live_turn_context_relation: 'ambiguous_missing_referent', live_turn_context_missing: true, live_turn_context_needs_clarification: true } }
    },
    {
      id: 'missing_referent_outranks_false_lexical_decline',
      expected: ACTIONS.RESOLVE_CONTEXT,
      input: { message: 'he said no though', recent_history: [], structured_state: { live_turn_declines: true, live_turn_context_relation: 'ambiguous_missing_referent', live_turn_context_missing: true, live_turn_context_needs_clarification: true } }
    },
    {
      id: 'in_person_consult_request_stays_in_dm',
      expected: ACTIONS.KEEP_CONSULTATION_IN_DM,
      input: { message: 'can we meet and discuss the tattoo?', recent_history: [], structured_state: { tattoo_intent_active: true, known_design_context: 'custom snake' } }
    },
    {
      id: 'deposit_sent_claim_is_hold_not_booking_restart',
      expected: ACTIONS.DEPOSIT_HOLD,
      input: { message: 'i sent the deposit', recent_history: [], structured_state: { deposit_requested: true, live_turn_deposit_sent: true } }
    },
    {
      id: 'durable_submitted_form_keeps_awaiting_date_on_next_turn',
      expected: ACTIONS.POST_FORM_AVAILABILITY,
      input: { message: 'weekends are usually easiest for me', recent_history: [{ role: 'assistant', text: `here is the form ${PREFERRED_FORM_LINK}` }], structured_state: { tattoo_intent_active: true, known_design_context: 'snake', form_link_sent: true, form_submitted: true } }
    },
    {
      id: 'durable_submitted_form_with_date_keeps_awaiting_time',
      expected: ACTIONS.POST_FORM_TIME,
      input: { message: 'that date works', recent_history: [{ role: 'assistant', text: `here is the form ${PREFERRED_FORM_LINK}` }], structured_state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, known_requested_date: '18th of July' } }
    },
    {
      id: 'durable_submitted_form_with_slot_keeps_awaiting_identity',
      expected: ACTIONS.POST_FORM_IDENTITY,
      input: { message: 'yeah that timing is good', recent_history: [{ role: 'assistant', text: `here is the form ${PREFERRED_FORM_LINK}` }], structured_state: { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, known_requested_date: '18th of July', known_requested_time: '2pm' } }
    },
    {
      id: 'sent_double_check_is_not_repeated_on_nonconfirmation',
      expected: ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION,
      input: {
        message: 'what if i need to change one thing?',
        recent_history: [{ role: 'assistant', text: 'Name : Eloise\nPhone Number : 4155550199\nAppointment date : 18th of July\nTime : 2pm\n\ncan you double check this just to make sure' }],
        structured_state: { form_submitted: true, known_name_used_on_form: 'Eloise', known_phone_used_on_form: '4155550199', known_requested_date: '18th of July', known_requested_time: '2pm' }
      }
    },
    {
      id: 'deposit_handoff_is_not_repeated_or_backtracked',
      expected: ACTIONS.DEPOSIT_PENDING_CONTINUE,
      input: {
        message: 'what happens next?',
        recent_history: [{ role: 'assistant', text: 'Name : Eloise\nPhone Number : 4155550199\nAppointment date : 18th of July\nTime : 2pm\n\ncan you double check this just to make sure' }],
        structured_state: { deposit_requested: true, form_submitted: true, known_name_used_on_form: 'Eloise', known_phone_used_on_form: '4155550199', known_requested_date: '18th of July', known_requested_time: '2pm' }
      }
    },
    {
      id: 'generic_information_voice_note_cannot_be_upgraded_to_form_request',
      expected: ACTIONS.DESIGN_INTAKE,
      input: {
        message: 'sent a voice note saying: Hi, can I please get more information?',
        recent_history: [],
        structured_state: {
          live_turn_is_voice_note: true,
          live_turn_is_question: true,
          live_turn_explicit_form_request: true,
          live_turn_pricing_question: true
        }
      }
    },
    {
      id: 'direct_form_voice_note_remains_send_form',
      expected: ACTIONS.SEND_FORM,
      input: {
        message: 'sent a voice note saying: Can you send me the form?',
        recent_history: [],
        structured_state: {
          live_turn_is_voice_note: true,
          live_turn_explicit_form_request: true
        }
      }
    },
    {
      id: 'unknown_short_voice_after_form_offer_requires_clarification',
      expected: ACTIONS.CLARIFY_FORM_PERMISSION,
      input: {
        message: 'sent a voice note saying: Shording',
        recent_history: [{ role: 'assistant', text: 'want me to send the form so we can get it rolling?' }],
        structured_state: {
          tattoo_intent_active: true,
          known_design_context: 'black and gray snake',
          form_offer_asked: true,
          booking_stage_hint: 'awaiting_form_permission_answer',
          live_turn_is_voice_note: true
        }
      }
    },
    {
      id: 'portfolio_compliment_cannot_be_promoted_to_form_offer',
      expected: ACTIONS.DESIGN_INTAKE,
      input: {
        message: 'sent a voice note saying: I love your style.',
        recent_history: [{ role: 'assistant', text: 'you can look through the flash in my highlights and send me anything that catches your eye' }],
        structured_state: {
          tattoo_intent_active: true,
          live_turn_is_voice_note: true,
          live_turn_gave_design_idea: true,
          known_design_context: 'sent a voice note saying: I love your style.',
          booking_stage_hint: 'design_intake'
        }
      }
    },
    {
      id: 'compound_portfolio_compliment_and_style_scope_question',
      expected: ACTIONS.DESIGN_INTAKE,
      input: {
        message: 'sent a voice note saying: I love your style. By the way, do you only do your style?',
        recent_history: [{ role: 'assistant', text: 'you can check the flashes and posts for inspo' }],
        structured_state: {
          tattoo_intent_active: true,
          live_turn_is_voice_note: true,
          booking_stage_hint: 'design_intake'
        }
      }
    },
    {
      id: 'unaccepted_assistant_offer_cannot_authorize_double_check',
      expected: ACTIONS.POST_FORM_AVAILABILITY,
      input: {
        message: 'what about another day?',
        recent_history: [
          { role: 'assistant', text: `here is the form ${PREFERRED_FORM_LINK}` },
          { role: 'assistant', text: 'weekends work i have july 25 at 2pm as the closest weekend spot' },
          { role: 'assistant', text: 'does that work for you?' }
        ],
        structured_state: {
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Eloise',
          known_phone_used_on_form: '4155550199',
          last_offered_date: 'july 25',
          last_offered_time: '2pm'
        }
      }
    },
    {
      id: 'too_soon_post_form_counterproposal_stays_in_date_negotiation',
      expected: ACTIONS.POST_FORM_AVAILABILITY,
      input: {
        received_at: '2026-07-14T19:00:00.000Z',
        message: 'sent a voice note saying: How about 18th of July?',
        recent_history: [
          { role: 'assistant', text: `here is the form ${PREFERRED_FORM_LINK}` },
          { role: 'assistant', text: 'weekends work i have july 25 at 2pm as the closest weekend spot' }
        ],
        structured_state: {
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Eloise',
          known_phone_used_on_form: '4155550199',
          last_offered_date: 'july 25',
          last_offered_time: '2pm',
          live_turn_date_phrase: '18th of July',
          live_turn_date_status: 'too_soon'
        }
      }
    },
    {
      id: 'legal_post_form_date_only_counterproposal_with_identity_still_awaits_time',
      expected: ACTIONS.POST_FORM_TIME,
      input: {
        received_at: '2026-07-14T19:00:00.000Z',
        message: 'sent a voice note saying: How about 25th of July?',
        recent_history: [
          { role: 'assistant', text: `here is the form ${PREFERRED_FORM_LINK}` },
          { role: 'assistant', text: 'weekends work i have july 26 at 2pm as the closest weekend spot' }
        ],
        structured_state: {
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Eloise',
          known_phone_used_on_form: '4155550199',
          last_offered_date: 'july 26',
          last_offered_time: '2pm',
          preferred_time_primary: '2pm',
          live_turn_date_phrase: '25th of July',
          live_turn_date_status: 'legal'
        }
      }
    }
  ]

  for (const row of criticalCases) {
    const plan = deriveClosedTransitionPlan(row.input)
    check(row.id, plan.action === row.expected, JSON.stringify(plan))
  }

  // Live Omar.system regression 2026-07-23:
  // Studio: "what dates or weekend days are easiest for you?"
  // Client: "Can you do 26?"
  // Old path: bare day not parsed -> classifier called it a standalone question
  // -> SOCIAL_CONTINUE -> "26 huh that's a neat number..."
  // Dialogue-slot authority keeps the turn in booking. If the independent
  // semantic verifier still detects a valid size reading, that rejection must
  // rebase the route to one date-or-size clarification instead of weakening the
  // verifier, repeating the frozen date route, or returning silence.
  const contextualDateHistory = [
    { role: 'assistant', message_id: 'form-date-packet', text: 'perfect i got the form' },
    { role: 'assistant', message_id: 'form-date-packet', text: 'what dates or weekend days are easiest for you?' }
  ]
  const contextualDateBaseState = {
    tattoo_intent_active: true,
    known_design_context: 'black and gray reference',
    form_offer_asked: true,
    form_link_sent: true,
    form_submitted: true,
    booking_stage_hint: 'awaiting_date',
    current_message_date_local: 'July 23, 2026',
    minimum_booking_date_local: 'July 30, 2026',
    maximum_booking_date_local: 'January 23, 2027'
  }
  const contextualVariants = [
    'Can you do 26?',
    '26?',
    'the 26th',
    'how about 26',
    'does 26 work?',
    'I can do 26'
  ]
  for (const [index, message] of contextualVariants.entries()) {
    const state = annotateStructuredStateForLiveTurn(
      { text: message },
      { ...contextualDateBaseState },
      contextualDateHistory
    )
    // Even a high-confidence candidate classifier may not overwrite the verified
    // dialogue-pair relation with an unrelated-topic label.
    applyDiscourseClassification(state, {
      context_relation: 'self_contained_topic_shift',
      context_confidence: 'high',
      context_reason_code: 'looks_like_complete_question'
    }, message, contextualDateHistory)
    const input = {
      message,
      live_message: message,
      recent_history: contextualDateHistory,
      structured_state: state
    }
    const plan = deriveClosedTransitionPlan(input)
    check(
      `contextual_monthless_day_variant_${index}_stays_in_booking`,
      state.live_turn_contextual_booking_reply === true &&
        state.live_turn_monthless_day_candidate === '26' &&
        state.live_turn_date_needs_month === true &&
        !String(state.known_size_context || '').trim() &&
        state.live_turn_self_contained_topic_shift === false &&
        plan.action === ACTIONS.POST_FORM_AVAILABILITY &&
        plan.reason === 'submitted_form_monthless_day_requires_month_clarification',
      JSON.stringify({ message, state, plan })
    )
  }

  for (const [index, message] of [
    '$26',
    '26 dollars',
    '26 inches',
    'I am 26 years old',
    '2:26pm',
    '26 people',
    'call me at 4155550126'
  ].entries()) {
    check(
      `noncalendar_numeric_dimension_${index}_cannot_inherit_date_slot`,
      extractContextualBookingDayReply(
        message,
        contextualDateBaseState,
        contextualDateHistory
      ) === null,
      message
    )
  }

  const contextualDateState = annotateStructuredStateForLiveTurn(
    { text: 'Can you do 26?' },
    { ...contextualDateBaseState },
    contextualDateHistory
  )
  const contextualDateInput = {
    message: 'Can you do 26?',
    live_message: 'Can you do 26?',
    recent_history: contextualDateHistory,
    structured_state: contextualDateState
  }
  const contextualDatePlan = deriveClosedTransitionPlan(contextualDateInput)
  const contextualDateGood = evaluateClosedTransitionContract(
    contextualDateInput,
    { bubbles: [{ text: 'the 26th — which month did you mean?' }] },
    contextualDatePlan
  )
  const contextualDateSocialNonsense = evaluateClosedTransitionContract(
    contextualDateInput,
    { bubbles: [{ text: "26 huh that's a neat number what's up with that?" }] },
    contextualDatePlan
  )
  const contextualDateInventedMonth = evaluateClosedTransitionContract(
    contextualDateInput,
    { bubbles: [{ text: 'did you mean July 26th?' }] },
    contextualDatePlan
  )
  const contextualDatePrematureAvailability = evaluateClosedTransitionContract(
    contextualDateInput,
    { bubbles: [{ text: 'the 26th sounds good — which month did you mean?' }] },
    contextualDatePlan
  )
  const contextualDateSoftPrematureAvailability = evaluateClosedTransitionContract(
    contextualDateInput,
    { bubbles: [{ text: 'the 26th sounds like a good day to keep in mind — which month were you thinking?' }] },
    contextualDatePlan
  )
  const contextualDateLivenessNonsense = evaluateClosedTransitionLivenessFloor(
    contextualDateInput,
    { bubbles: [{ text: "26 huh that's a neat number what's up with that?" }] },
    contextualDatePlan
  )
  check(
    'contextual_monthless_day_accepts_only_day_anchored_month_question',
    contextualDateGood.valid === true &&
      contextualDateSocialNonsense.valid === false &&
      contextualDateSocialNonsense.reason === 'closed_transition_monthless_day_requires_month' &&
      contextualDateInventedMonth.valid === false &&
      contextualDatePrematureAvailability.valid === false &&
      contextualDateSoftPrematureAvailability.valid === false &&
      contextualDateLivenessNonsense.valid === false,
    JSON.stringify({
      contextualDatePlan,
      contextualDateGood,
      contextualDateSocialNonsense,
      contextualDateInventedMonth,
      contextualDatePrematureAvailability,
      contextualDateSoftPrematureAvailability,
      contextualDateLivenessNonsense
    })
  )

  // Live Omar.system regression 2026-07-25:
  // after the form and one rejected July date, the client said
  // "OK, then can we do 15th of August?" The old parser kept only "15th",
  // inherited July, and then retried against stale August 1 / August 27 state
  // until the turn went silent. A complete client date now owns the route in
  // either word order. The seven-day floor is the only date boundary.
  const legalDateHistory = [
    {
      role: 'assistant',
      message_id: 'legal-date-packet',
      text: 'about july 27, the earliest i can book is august 1 at 2pm. august 2 or 3 would also be at 2pm'
    }
  ]
  const legalDateBaseState = {
    tattoo_intent_active: true,
    known_design_context: 'black and gray reference',
    form_offer_asked: true,
    form_link_sent: true,
    form_submitted: true,
    known_name_used_on_form: 'Omar System',
    known_phone_used_on_form: '4155550199',
    // Deliberately hostile stale state from the preceding negotiation.
    known_requested_date: 'august 27',
    known_requested_time: '2pm',
    accepted_offered_date: 'august 1',
    accepted_offered_time: '2pm',
    last_offered_date: 'august 1',
    last_offered_time: '2pm',
    booking_stage_hint: 'ready_for_double_check',
    current_message_date_local: 'July 25, 2026',
    minimum_booking_date_local: 'August 1, 2026',
    // This stale legacy field must have no authority.
    maximum_booking_date_local: 'January 25, 2027'
  }
  const legalDateVariants = [
    'OK, then can we do 15th of August?',
    'August 15th?',
    '15 August?',
    'sent a voice note saying: can we do the 15th of August?'
  ]
  for (const [index, message] of legalDateVariants.entries()) {
    const state = annotateStructuredStateForLiveTurn(
      { text: message },
      { ...legalDateBaseState },
      legalDateHistory
    )
    // Simulate both generic classifier failures seen in the live retry path.
    state.live_turn_accepts_offered_slot = true
    state.live_turn_is_question = true
    state.live_turn_self_contained_topic_shift = true
    const input = {
      message,
      live_message: message,
      recent_history: legalDateHistory,
      structured_state: state
    }
    const plan = deriveClosedTransitionPlan(input)
    const good = evaluateClosedTransitionContract(
      input,
      { bubbles: [{ text: `${plan.fields.proposed_date} works. would 2pm work for you?` }] },
      plan
    )
    const inventedClosure = evaluateClosedTransitionContract(
      input,
      { bubbles: [{ text: `i do not have ${plan.fields.proposed_date} open. august 1 at 2pm works though` }] },
      plan
    )
    const staleReplacement = evaluateClosedTransitionContract(
      input,
      { bubbles: [{ text: 'august 1 at 2pm works. want to do that?' }] },
      plan
    )
    check(
      `explicit_legal_date_variant_${index}_outranks_stale_offer_and_moves_only_to_time`,
      state.live_turn_date_status === 'legal' &&
        /august/i.test(String(state.live_turn_date_phrase || '')) &&
        plan.action === ACTIONS.POST_FORM_TIME &&
        plan.reason === 'submitted_form_missing_time' &&
        /august/i.test(String(plan.fields.date || '')) &&
        /15/.test(String(plan.fields.date || '')) &&
        !String(plan.fields.time || '').trim() &&
        plan.live_intent.accepts_offered_slot === false &&
        good.valid === true &&
        inventedClosure.valid === false &&
        inventedClosure.reason === 'closed_transition_legal_date_rejection_forbidden' &&
        staleReplacement.valid === false &&
        staleReplacement.reason === 'closed_transition_legal_date_replacement_forbidden',
      JSON.stringify({ message, state, plan, good, inventedClosure, staleReplacement })
    )
  }

  const farFutureState = annotateStructuredStateForLiveTurn(
    { text: 'March 15th?' },
    { ...legalDateBaseState },
    legalDateHistory
  )
  const farFuturePlan = deriveClosedTransitionPlan({
    message: 'March 15th?',
    live_message: 'March 15th?',
    recent_history: legalDateHistory,
    structured_state: farFutureState
  })
  check(
    'explicit_date_beyond_legacy_six_month_field_is_legal_without_maximum_horizon',
    farFutureState.live_turn_date_status === 'legal' &&
      farFuturePlan.action === ACTIONS.POST_FORM_TIME &&
      /march/i.test(String(farFuturePlan.fields.date || '')),
    JSON.stringify({ farFutureState, farFuturePlan })
  )

  const tooSoonState = annotateStructuredStateForLiveTurn(
    { text: 'July 27th?' },
    { ...legalDateBaseState },
    legalDateHistory
  )
  const tooSoonPlan = deriveClosedTransitionPlan({
    message: 'July 27th?',
    live_message: 'July 27th?',
    recent_history: legalDateHistory,
    structured_state: tooSoonState
  })
  check(
    'seven_day_minimum_remains_the_only_rejection_boundary',
    tooSoonState.live_turn_date_status === 'too_soon' &&
      tooSoonPlan.action === ACTIONS.POST_FORM_AVAILABILITY &&
      tooSoonPlan.reason === 'submitted_form_date_counterproposal_outside_window',
    JSON.stringify({ tooSoonState, tooSoonPlan })
  )

  const verifierRebasePlan = deriveVerifierRebasePlan(
    contextualDateInput,
    contextualDatePlan,
    { valid: false, reason: 'size_answer_requires_visible_next_move' }
  )
  check(
    'immediate_date_question_prevents_numeric_dimension_downgrade',
    verifierRebasePlan === null,
    JSON.stringify(verifierRebasePlan)
  )

  const dateOrSizeDowngrade = evaluateClosedTransitionContract(
    { ...contextualDateInput, control_transition_contract: contextualDatePlan },
    { bubbles: [{ text: 'when you say 26, did you mean the appointment date or around 26 inches for the size?' }] },
    contextualDatePlan
  )
  check(
    'strong_date_frame_rejects_date_or_size_downgrade',
    dateOrSizeDowngrade.valid === false &&
      dateOrSizeDowngrade.reason === 'closed_transition_monthless_day_requires_month',
    JSON.stringify(dateOrSizeDowngrade)
  )

  check(
    'verifier_reroute_is_bounded_to_ambiguous_bare_number',
    deriveVerifierRebasePlan(
      {
        ...contextualDateInput,
        message: 'about 26 inches',
        live_message: 'about 26 inches',
        structured_state: {
          ...contextualDateInput.structured_state,
          live_turn_monthless_day_candidate: ''
        }
      },
      contextualDatePlan,
      { reason: 'size_answer_requires_visible_next_move' }
    ) === null &&
      deriveVerifierRebasePlan(
        {
          message: 'How about 26?',
          recent_history: [],
          structured_state: { booking_stage_hint: 'open_conversation' }
        },
        { action: ACTIONS.GENERAL_CONTINUE, reason: 'general_continue', obligations: [] },
        { reason: 'size_answer_requires_visible_next_move' }
      ) === null &&
      deriveVerifierRebasePlan(
        contextualDateInput,
        contextualDatePlan,
        { reason: 'some_other_verifier_rejection' }
      ) === null,
    'unexpected verifier rebase outside the locked ambiguity'
  )

  const nonTattooMediaInput = {
    message: 'this one',
    live_message: 'this one',
    recent_history: [
      { role: 'user', message_id: 'non-tattoo-image', text: 'sent a reference post: The image shows a website or presentation screenshot.' },
      { role: 'user', message_id: 'non-tattoo-pointer', text: 'this one' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      live_turn_context_resolved_from_history: true,
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }
  }
  const nonTattooRebase = deriveVerifierRebasePlan(
    nonTattooMediaInput,
    { action: ACTIONS.DESIGN_INTAKE, reason: 'tattoo_lane_missing_design_direction', obligations: [] },
    { reason: 'non_tattoo_media_cannot_advance_booking_funnel' }
  )
  check(
    'verified_non_tattoo_media_conflict_rebases_stale_design_intake',
    nonTattooRebase?.action === ACTIONS.GENERAL_CONTINUE &&
      nonTattooRebase?.reason === 'non_tattoo_media_requires_contextual_host_lead' &&
      nonTattooRebase?.rebase?.verifier_reason === 'non_tattoo_media_cannot_advance_booking_funnel',
    JSON.stringify(nonTattooRebase)
  )

  check(
    'non_tattoo_verifier_reason_without_authority_evidence_cannot_rebase',
    deriveVerifierRebasePlan(
      { message: 'can i get more info?', structured_state: { tattoo_intent_active: true } },
      { action: ACTIONS.DESIGN_INTAKE, reason: 'tattoo_lane_missing_design_direction', obligations: [] },
      { reason: 'non_tattoo_media_cannot_advance_booking_funnel' }
    ) === null,
    'non-tattoo route rebase occurred without verified media context'
  )

  const monthAnchoredHistory = [
    { role: 'assistant', message_id: 'slot-packet', text: 'july 18 at 2pm works on my side' },
    { role: 'assistant', message_id: 'slot-packet', text: 'does that work for you?' }
  ]
  const monthAnchoredState = annotateStructuredStateForLiveTurn(
    { text: 'Can you do 30?' },
    { ...contextualDateBaseState },
    monthAnchoredHistory
  )
  const monthAnchoredPlan = deriveClosedTransitionPlan({
    message: 'Can you do 30?',
    recent_history: monthAnchoredHistory,
    structured_state: monthAnchoredState
  })
  check(
    'immediate_scheduling_month_anchor_resolves_day_without_guessing',
    monthAnchoredState.live_turn_contextual_booking_reply === true &&
      monthAnchoredState.live_turn_contextual_month_anchor === 'july' &&
      monthAnchoredState.live_turn_date_phrase === 'july 30' &&
      monthAnchoredState.live_turn_date_status === 'legal' &&
      monthAnchoredPlan.action === ACTIONS.POST_FORM_TIME,
    JSON.stringify({ monthAnchoredState, monthAnchoredPlan })
  )

  const tooSoonCounterproposalInput = criticalCases.find((row) => row.id === 'too_soon_post_form_counterproposal_stays_in_date_negotiation').input
  const tooSoonCounterproposalPlan = deriveClosedTransitionPlan(tooSoonCounterproposalInput)
  const tooSoonCounterproposalReply = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    {
      bubbles: [{
        text: 'the 18th is a little earlier than i can do. july 25 at 2pm is the closest weekend spot on my side, does that work for you?'
      }]
    },
    tooSoonCounterproposalPlan
  )
  check(
    'too_soon_post_form_counterproposal_reply_is_adopted_not_rejected_as_identity_missing',
    tooSoonCounterproposalReply.valid === true,
    JSON.stringify({ tooSoonCounterproposalPlan, tooSoonCounterproposalReply })
  )
  const multipleGroundedAlternativesPlan = {
    ...tooSoonCounterproposalPlan,
    fields: {
      ...tooSoonCounterproposalPlan.fields,
      last_offered_date: '',
      last_offered_time: '',
      earliest_booking_option: 'july 25 at 2pm',
      close_booking_options: ['july 25 at 2pm', 'july 26 at 2pm']
    }
  }
  const multipleGroundedAlternatives = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    { bubbles: [{ text: 'July 18 is too soon but I can do July 25 at 2pm or July 26 at 2pm. Would either work?' }] },
    multipleGroundedAlternativesPlan
  )
  check(
    'outside_window_reply_offers_one_replacement_so_short_acceptance_is_unambiguous',
    multipleGroundedAlternatives.valid === false &&
      multipleGroundedAlternatives.reason === 'closed_transition_multiple_date_alternatives_forbidden',
    JSON.stringify(multipleGroundedAlternatives)
  )

  const dateOnlyTimeInput = criticalCases.find((row) => row.id === 'legal_post_form_date_only_counterproposal_with_identity_still_awaits_time').input
  const dateOnlyTimePlan = deriveClosedTransitionPlan(dateOnlyTimeInput)
  const prematureDateOnlyDoubleCheck = evaluateClosedTransitionContract(
    dateOnlyTimeInput,
    {
      bubbles: [{
        text: 'Name : Eloise\nPhone Number : 4155550199\nAppointment date : 25th of July\nTime : 2pm\n\ncan you double check this just to make sure'
      }]
    },
    dateOnlyTimePlan
  )
  check(
    'date_only_client_proposal_cannot_synthesize_2pm_and_skip_time_confirmation',
    prematureDateOnlyDoubleCheck.valid === false && prematureDateOnlyDoubleCheck.reason === 'closed_transition_time_cannot_skip_to_double_check',
    JSON.stringify({ dateOnlyTimePlan, prematureDateOnlyDoubleCheck })
  )

  const visibleDateAuthorityInput = {
    message: 'Can we do 31 instead?',
    recent_history: [{ role: 'assistant', text: 'Perfect, what time are you thinking?' }],
    structured_state: {
      form_submitted: true,
      known_requested_date: 'August 30',
      known_requested_time: '',
      booking_stage_hint: 'awaiting_time'
    }
  }
  const visibleDateAuthorityPlan = {
    action: ACTIONS.POST_FORM_TIME,
    reason: 'submitted_form_missing_time',
    obligations: [],
    fields: {
      date: 'August 30',
      time: '',
      proposed_date: '',
      date_status: ''
    },
    live_intent: {}
  }
  const staleVisibleRevision = evaluateClosedTransitionContract(
    visibleDateAuthorityInput,
    { bubbles: [{ text: 'August 31 works. What time works best?' }] },
    visibleDateAuthorityPlan
  )
  const matchingVisibleDate = evaluateClosedTransitionContract(
    visibleDateAuthorityInput,
    { bubbles: [{ text: 'August 30 works. What time works best?' }] },
    visibleDateAuthorityPlan
  )
  check(
    'post_form_time_visible_date_must_match_authoritative_field_without_date_status',
    staleVisibleRevision.valid === false &&
      staleVisibleRevision.reason === 'closed_transition_visible_date_state_mismatch' &&
      matchingVisibleDate.valid === true,
    JSON.stringify({ staleVisibleRevision, matchingVisibleDate })
  )

  const mixedPolarityDateCases = [
    ['positive_before_rejection', 'I can do August 30, but not August 31', '2026-08-30'],
    ['rejection_before_positive', 'I cannot do August 31, but I can do August 30', '2026-08-30'],
    ['replacement_after_rejection', 'I cannot do August 30, but I can do August 31', '2026-08-31']
  ]
  const mixedPolarityDateMisses = []
  for (const [id, message, expectedIso] of mixedPolarityDateCases) {
    const input = {
      message_id: `mixed-date-${id}`,
      message,
      received_at: '2026-08-20T18:03:00.000Z',
      recent_history: [{ role: 'assistant', text: 'What date works for you?' }],
      structured_state: {
        form_submitted: true,
        current_message_date_local: 'Thursday, August 20, 2026',
        minimum_booking_date_local: '2026-08-27',
        booking_stage_hint: 'awaiting_date'
      }
    }
    const decision = bookingPolicyDecisionForInput(input)
    const selectedDate = expectedIso.endsWith('-30') ? 'August 30' : 'August 31'
    const plan = {
      action: ACTIONS.POST_FORM_TIME,
      reason: 'submitted_form_missing_time',
      obligations: [],
      fields: { date: selectedDate, time: '', proposed_date: selectedDate, date_status: 'legal' },
      live_intent: {}
    }
    const packet = { bubbles: [{ text: `${selectedDate} works. What time works best?` }] }
    const strict = evaluateClosedTransitionContract(input, packet, plan)
    const liveness = evaluateClosedTransitionLivenessFloor(input, packet, plan)
    if (
      decision.status !== 'legal' ||
      decision.date_iso !== expectedIso ||
      strict.valid !== true ||
      liveness.valid !== true
    ) {
      mixedPolarityDateMisses.push({ id, message, expectedIso, decision, strict, liveness })
    }
  }
  check(
    'mixed_polarity_date_turn_uses_exact_positive_candidate_in_both_orders',
    mixedPolarityDateMisses.length === 0,
    JSON.stringify(mixedPolarityDateMisses)
  )

  const missingDateAuthorityPlan = {
    action: ACTIONS.POST_FORM_AVAILABILITY,
    reason: 'submitted_form_missing_date',
    obligations: [],
    fields: { date: '', time: '', proposed_date: '', date_status: '' },
    live_intent: {}
  }
  const missingDateCommitment = evaluateClosedTransitionContract(
    {
      message: 'I just submitted',
      structured_state: { form_submitted: true, booking_stage_hint: 'awaiting_date' }
    },
    { bubbles: [{ text: 'August 30 works. What time works best?' }] },
    missingDateAuthorityPlan
  )
  const missingDateQuestion = evaluateClosedTransitionContract(
    {
      message: 'I just submitted',
      structured_state: { form_submitted: true, booking_stage_hint: 'awaiting_date' }
    },
    { bubbles: [{ text: 'Would August 30 work?' }] },
    missingDateAuthorityPlan
  )
  const noncommittalAlternatives = [
    'I could do August 30 or September 1. Which one works for you?',
    'August 30 is unavailable; September 1 is the earliest. Would that work?'
  ].map((text) => evaluateClosedTransitionContract(
    {
      message: 'I just submitted',
      structured_state: { form_submitted: true, booking_stage_hint: 'awaiting_date' }
    },
    { bubbles: [{ text }] },
    missingDateAuthorityPlan
  ))
  check(
    'booking_reply_cannot_commit_concrete_date_when_controller_date_is_absent',
    missingDateCommitment.valid === false &&
      missingDateCommitment.reason === 'closed_transition_visible_date_state_authority_missing' &&
      missingDateQuestion.reason !== 'closed_transition_visible_date_state_authority_missing' &&
      noncommittalAlternatives.every((verdict) => verdict.reason !== 'closed_transition_visible_date_state_authority_missing'),
    JSON.stringify({ missingDateCommitment, missingDateQuestion, noncommittalAlternatives })
  )

  const clientRejectedDatePhrases = [
    'I cannot do August 30',
    'August 30 does not work for me',
    'Not August 30',
    'Anything except August 30',
    'After August 30 would work'
  ]
  const rejectedDateLeaks = clientRejectedDatePhrases.map((message) => ({
    message,
    verdict: evaluateClosedTransitionContract(
      { ...visibleDateAuthorityInput, message },
      { bubbles: [{ text: 'August 30 works. What time works best?' }] },
      visibleDateAuthorityPlan
    )
  })).filter((row) => (
    row.verdict.valid !== false ||
    row.verdict.reason !== 'closed_transition_client_rejected_date_cannot_be_adopted'
  ))
  check(
    'post_form_time_cannot_adopt_client_negated_or_excluded_date',
    rejectedDateLeaks.length === 0,
    JSON.stringify(rejectedDateLeaks)
  )

  // Live Omar regression 2026-07-14: the state correctly held `july 26`, while
  // the locked visible checkpoint correctly rendered `26th of July`. The old
  // verifier compared those strings literally and discarded the valid packet,
  // causing a permanent retry/silence loop after the client accepted the slot.
  const canonicalDateDoubleCheckInput = {
    message: 'yeah that works perfectly',
    recent_history: [
      { role: 'assistant', text: 'sundays work i have july 26 at 2pm as the closest sunday spot' },
      { role: 'assistant', text: 'does that work for you?' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Omar System Replay Three',
      known_phone_used_on_form: '4155550166',
      known_requested_date: 'july 26',
      known_requested_time: '2pm',
      accepted_offered_date: 'july 26',
      accepted_offered_time: '2pm',
      live_turn_accepts_offered_slot: true
    }
  }
  const canonicalDateDoubleCheckPlan = deriveClosedTransitionPlan(canonicalDateDoubleCheckInput)
  const canonicalDateDoubleCheckPacket = {
    bubbles: [{
      text: 'Name : Omar System Replay Three\nPhone Number : 4155550166\nAppointment date : 26th of July\nTime : 2pm\n\ncan you double check this just to make sure'
    }]
  }
  const canonicalDateDoubleCheckVerdict = evaluateClosedTransitionContract(
    canonicalDateDoubleCheckInput,
    canonicalDateDoubleCheckPacket,
    canonicalDateDoubleCheckPlan
  )
  check(
    'canonical_visible_date_equals_history_order_date_at_double_check',
    canonicalDateDoubleCheckPlan.action === ACTIONS.DOUBLE_CHECK && canonicalDateDoubleCheckVerdict.valid === true,
    JSON.stringify({ canonicalDateDoubleCheckPlan, canonicalDateDoubleCheckVerdict })
  )
  const wrongCanonicalDateVerdict = evaluateClosedTransitionContract(
    canonicalDateDoubleCheckInput,
    {
      bubbles: [{
        text: 'Name : Omar System Replay Three\nPhone Number : 4155550166\nAppointment date : 27th of July\nTime : 2pm\n\ncan you double check this just to make sure'
      }]
    },
    canonicalDateDoubleCheckPlan
  )
  check(
    'canonical_date_equivalence_does_not_accept_a_different_day',
    wrongCanonicalDateVerdict.valid === false && wrongCanonicalDateVerdict.reason === 'closed_transition_four_field_double_check_missing',
    JSON.stringify(wrongCanonicalDateVerdict)
  )
  const inventedAlternative = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    {
      bubbles: [
        { text: '18th is a little too soon for me honestly' },
        { text: 'i have july 19 at 2pm as the earliest that works' },
        { text: 'would that day work instead?' }
      ]
    },
    tooSoonCounterproposalPlan
  )
  check(
    'too_soon_post_form_counterproposal_cannot_invent_third_date_or_drop_last_offer',
    inventedAlternative.valid === false && inventedAlternative.reason === 'closed_transition_unanchored_date_alternative_forbidden',
    JSON.stringify({ tooSoonCounterproposalPlan, inventedAlternative })
  )

  const safeWordingMiss = {
    bubbles: [{ text: 'the 18th is earlier than i can do. would july 25 at 2pm work for you instead?' }]
  }
  const safeWordingStrict = evaluateClosedTransitionContract(tooSoonCounterproposalInput, safeWordingMiss, tooSoonCounterproposalPlan)
  const safeWordingLiveness = evaluateClosedTransitionLivenessFloor(tooSoonCounterproposalInput, safeWordingMiss, tooSoonCounterproposalPlan)
  check(
    'semantically_safe_grounded_date_reply_passes_strict_and_remains_answerable',
    safeWordingStrict.valid === true &&
      safeWordingLiveness.valid === true &&
      safeWordingLiveness.liveness_floor === false,
    JSON.stringify({ safeWordingStrict, safeWordingLiveness })
  )

  // The rejected client date need not be repeated verbatim when the reply
  // establishes an exact grounded earliest-availability boundary. These are
  // semantic equivalents of "August 27 is too soon" and must pass the same
  // strict gate rather than depending on liveness fail-open behavior.
  const earliestBoundaryPlan = {
    ...tooSoonCounterproposalPlan,
    fields: {
      ...tooSoonCounterproposalPlan.fields,
      proposed_date: 'August 27',
      date_status: 'too_soon',
      last_offered_date: 'September 1',
      last_offered_time: '2pm',
      earliest_booking_option: '',
      close_booking_options: []
    }
  }
  const earliestBoundaryReplies = [
    ['no_opening_before_grounded_slot', 'I won\u2019t have an opening before September 1 at 2pm. Would that work?'],
    ['first_day_i_can_fit_you_in', 'The first day I can fit you in is September 1 at 2pm. Can you make that?'],
    ['grounded_slot_is_soonest_opening', 'September 1 at 2pm is my soonest opening instead, let me know.'],
    ['booked_up_until_grounded_slot', 'I\u2019m booked up until September 1 at 2pm. Would that work?'],
    ['nothing_available_until_grounded_slot', 'I don\u2019t have anything until September 1 at 2pm. Would that work?'],
    ['nothing_open_before_grounded_slot', 'Nothing is open before September 1 at 2pm. Would that work?'],
    ['next_opening_is_grounded_slot', 'The next opening I have is September 1 at 2pm. Would that work?'],
    ['next_slot_is_grounded_slot', 'The next slot I have is September 1 at 2pm. Would that work?'],
    ['not_free_until_grounded_slot', 'I\u2019m not free until September 1 at 2pm. Would that work?'],
    ['soonest_i_can_get_you_in', 'The soonest I can get you in is September 1 at 2pm. Would that work?'],
    ['can_only_do_grounded_slot_or_later', 'I can only do September 1 at 2pm or later. Would that work?'],
    ['grounded_slot_is_next_thing_i_have', 'September 1 at 2pm is the next thing I have. Would that work?']
  ]
  for (const [id, text] of earliestBoundaryReplies) {
    const packet = { bubbles: [{ text }] }
    const strict = evaluateClosedTransitionContract(
      tooSoonCounterproposalInput,
      packet,
      earliestBoundaryPlan
    )
    const liveness = evaluateClosedTransitionLivenessFloor(
      tooSoonCounterproposalInput,
      packet,
      earliestBoundaryPlan
    )
    check(
      `semantic_earliest_boundary_${id}_passes_same_strict_contract`,
      strict.valid === true &&
        strict.reason === 'closed_transition_valid' &&
        liveness.valid === true &&
        liveness.reason === 'closed_transition_valid' &&
        liveness.liveness_floor === false,
      JSON.stringify({ strict, liveness, packet })
    )
  }

  const ungroundedEarliestBoundary = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    { bubbles: [{ text: 'I\u2019m booked up until September 2 at 2pm. Would that work?' }] },
    earliestBoundaryPlan
  )
  check(
    'semantic_earliest_boundary_cannot_substitute_an_ungrounded_date',
    ungroundedEarliestBoundary.valid === false &&
      ungroundedEarliestBoundary.reason === 'closed_transition_unanchored_date_alternative_forbidden',
    JSON.stringify(ungroundedEarliestBoundary)
  )

  const wrongTimeEarliestBoundary = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    { bubbles: [{ text: 'I won\u2019t have an opening before September 1 at 3pm. Would that work?' }] },
    earliestBoundaryPlan
  )
  check(
    'semantic_earliest_boundary_must_keep_exact_grounded_time',
    wrongTimeEarliestBoundary.valid === false &&
      wrongTimeEarliestBoundary.reason === 'closed_transition_last_offered_alternative_missing',
    JSON.stringify(wrongTimeEarliestBoundary)
  )

  const acceptedTooSoonWithBoundary = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    {
      bubbles: [{
        text: 'August 27 works for me, and I\u2019m booked up until September 1 at 2pm. Would that work?'
      }]
    },
    earliestBoundaryPlan
  )
  check(
    'semantic_earliest_boundary_cannot_mask_acceptance_of_too_soon_proposal',
    acceptedTooSoonWithBoundary.valid === false &&
      acceptedTooSoonWithBoundary.reason === 'closed_transition_out_of_window_date_acceptance_forbidden',
    JSON.stringify(acceptedTooSoonWithBoundary)
  )

  const softAcceptedTooSoonWithBoundaryPackets = [
    [
      'could_squeeze_in',
      'The first day I can fit you in is September 1 at 2pm, though I could squeeze you in August 27 if needed. Which do you prefer?'
    ],
    [
      'might_make_happen',
      'I\u2019m booked up until September 1 at 2pm, but I might be able to make August 27 happen. Would that be better?'
    ],
    [
      'could_fit_in',
      'September 1 at 2pm is my soonest opening, though I could fit you in August 27 if needed. Which do you prefer?'
    ],
    [
      'may_have_room',
      'September 1 at 2pm is my soonest opening, though I may have room August 27 after all. Which do you prefer?'
    ],
    [
      'proposed_date_is_fine_too',
      'September 1 at 2pm is my soonest opening, though August 27 is fine too. Which do you prefer?'
    ],
    [
      'proposed_date_could_happen',
      'September 1 at 2pm is my soonest opening, though August 27 could still happen. Which do you prefer?'
    ],
    [
      'could_accommodate',
      'September 1 at 2pm is my soonest opening, though I could accommodate August 27. Which do you prefer?'
    ],
    [
      'can_take_if_preferred',
      'September 1 at 2pm is my soonest opening, though I can take August 27 if you prefer. Which do you prefer?'
    ],
    [
      'proposed_date_is_an_option',
      'September 1 at 2pm is my soonest opening. August 27 is an option too. Which do you prefer?'
    ],
    [
      'proposed_date_is_on_the_table',
      'September 1 at 2pm is my soonest opening. August 27 is still on the table. Which do you prefer?'
    ],
    [
      'can_offer_proposed_date',
      'September 1 at 2pm is my soonest opening. I can offer August 27 too. Which do you prefer?'
    ],
    [
      'have_proposed_date_open',
      'September 1 at 2pm is my soonest opening. I have August 27 open too. Which do you prefer?'
    ],
    [
      'there_is_opening_on_proposed_date',
      'September 1 at 2pm is my soonest opening. There is an opening August 27 too. Which do you prefer?'
    ],
    [
      'proposed_date_is_still_open',
      'September 1 at 2pm is my soonest opening. August 27 is still open. Which do you prefer?'
    ],
    [
      'possible_cancellation_reopens_proposed_date',
      'September 1 at 2pm is my soonest opening. I might have a cancellation for August 27. Which do you prefer?'
    ],
    [
      'keep_proposed_date_as_backup',
      'September 1 at 2pm is my soonest opening. Keep August 27 as a backup. Which do you prefer?'
    ],
    [
      'same_sentence_and_reopens_proposed_date',
      'September 1 at 2pm is my soonest opening and August 27 remains an option too. Which do you prefer?'
    ],
    [
      'em_dash_reopens_proposed_date',
      'September 1 at 2pm is my soonest opening \u2014 August 27 remains on the table. Which do you prefer?'
    ]
  ]
  for (const [id, text] of softAcceptedTooSoonWithBoundaryPackets) {
    const packet = { bubbles: [{ text }] }
    const strict = evaluateClosedTransitionContract(
      tooSoonCounterproposalInput,
      packet,
      earliestBoundaryPlan
    )
    const liveness = evaluateClosedTransitionLivenessFloor(
      tooSoonCounterproposalInput,
      packet,
      earliestBoundaryPlan
    )
    check(
      `semantic_earliest_boundary_${id}_cannot_soft_accept_too_soon_proposal`,
      strict.valid === false &&
        strict.reason === 'closed_transition_out_of_window_date_acceptance_forbidden' &&
        liveness.valid === false &&
        liveness.reason === 'closed_transition_out_of_window_date_acceptance_forbidden',
      JSON.stringify({ strict, liveness, packet })
    )
  }

  const softAcceptedTooSoonBeforeBoundaryPackets = [
    ['option_before_boundary', 'August 27 is still an option, but September 1 at 2pm is my earliest opening. Which do you prefer?'],
    ['on_table_before_boundary', 'August 27 is still on the table, but September 1 at 2pm is my earliest opening. Which do you prefer?'],
    ['offer_before_boundary', 'I can offer August 27 too, though September 1 at 2pm is my earliest opening. Which do you prefer?'],
    ['open_before_boundary', 'I have August 27 open too, though September 1 at 2pm is my earliest opening. Which do you prefer?'],
    ['opening_before_boundary', 'There is an opening August 27 too, though September 1 at 2pm is my earliest opening. Which do you prefer?'],
    ['cancellation_before_boundary', 'I might have a cancellation for August 27, though September 1 at 2pm is my earliest opening. Which do you prefer?'],
    ['backup_before_boundary', 'Keep August 27 as a backup, though September 1 at 2pm is my earliest opening. Which do you prefer?'],
    ['that_date_before_boundary', 'That date is still an option, but September 1 at 2pm is my earliest opening. Which do you prefer?'],
    ['then_before_boundary', 'I have an opening then, but September 1 at 2pm is my earliest opening. Which do you prefer?']
  ]
  for (const [id, text] of softAcceptedTooSoonBeforeBoundaryPackets) {
    const packet = { bubbles: [{ text }] }
    const strict = evaluateClosedTransitionContract(
      tooSoonCounterproposalInput,
      packet,
      earliestBoundaryPlan
    )
    const liveness = evaluateClosedTransitionLivenessFloor(
      tooSoonCounterproposalInput,
      packet,
      earliestBoundaryPlan
    )
    check(
      `semantic_earliest_boundary_${id}_fails_order_independently`,
      strict.valid === false &&
        strict.reason === 'closed_transition_out_of_window_date_acceptance_forbidden' &&
        liveness.valid === false &&
        liveness.reason === 'closed_transition_out_of_window_date_acceptance_forbidden',
      JSON.stringify({ strict, liveness, packet })
    )
  }

  const activeProposalEllipsisPermutations = [
    [
      'could_squeeze_in_then',
      'I could squeeze you in then, but September 1 at 2pm is my earliest opening. Would that work?',
      'September 1 at 2pm is my earliest opening. I could squeeze you in then. Would that work?'
    ],
    [
      'could_probably_fit_in_then',
      'I could probably fit you in then, but September 1 at 2pm is my earliest opening. Would that work?',
      'September 1 at 2pm is my earliest opening. I could probably fit you in then. Would that work?'
    ],
    [
      'might_accommodate_then',
      'I might be able to accommodate you then, but September 1 at 2pm is my earliest opening. Would that work?',
      'September 1 at 2pm is my earliest opening. I might be able to accommodate you then. Would that work?'
    ],
    [
      'cancellation_then',
      'There might be a cancellation then, but September 1 at 2pm is my earliest opening. Would that work?',
      'September 1 at 2pm is my earliest opening. There might be a cancellation then. Would that work?'
    ],
    [
      'can_take_then',
      'I can take you then if needed, but September 1 at 2pm is my earliest opening. Would that work?',
      'September 1 at 2pm is my earliest opening. I can take you then if needed. Would that work?'
    ],
    [
      'might_make_then_work',
      'I might make then work, but September 1 at 2pm is my earliest opening. Would that work?',
      'September 1 at 2pm is my earliest opening. I might make then work. Would that work?'
    ],
    [
      'can_fit_in_there',
      'I can fit you in there, but September 1 at 2pm is my earliest opening. Would that work?',
      'September 1 at 2pm is my earliest opening. I can fit you in there. Would that work?'
    ],
    [
      'maybe_then_after_all',
      'Maybe then after all, but September 1 at 2pm is my earliest opening. Would that work?',
      'September 1 at 2pm is my earliest opening. Maybe then after all. Would that work?'
    ]
  ]
  for (const [id, beforeBoundary, afterBoundary] of activeProposalEllipsisPermutations) {
    const beforePacket = { bubbles: [{ text: beforeBoundary }] }
    const beforeStrict = evaluateClosedTransitionContract(
      tooSoonCounterproposalInput,
      beforePacket,
      earliestBoundaryPlan
    )
    const beforeLiveness = evaluateClosedTransitionLivenessFloor(
      tooSoonCounterproposalInput,
      beforePacket,
      earliestBoundaryPlan
    )
    const afterPacket = { bubbles: [{ text: afterBoundary }] }
    const afterStrict = evaluateClosedTransitionContract(
      tooSoonCounterproposalInput,
      afterPacket,
      earliestBoundaryPlan
    )
    const afterLiveness = evaluateClosedTransitionLivenessFloor(
      tooSoonCounterproposalInput,
      afterPacket,
      earliestBoundaryPlan
    )
    check(
      `semantic_earliest_boundary_${id}_resolves_active_date_by_clause_order`,
      beforeStrict.valid === false &&
        beforeStrict.reason === 'closed_transition_out_of_window_date_acceptance_forbidden' &&
        beforeLiveness.valid === false &&
        beforeLiveness.reason === 'closed_transition_out_of_window_date_acceptance_forbidden' &&
        afterStrict.valid === true &&
        afterLiveness.valid === true &&
        afterLiveness.liveness_floor === false,
      JSON.stringify({ beforeStrict, beforeLiveness, afterStrict, afterLiveness })
    )
  }

  const negatedRejectionPackets = [
    ['not_too_soon', "August 27 isn't too soon after all, but September 1 at 2pm is my earliest opening. Would that work?"],
    ['not_too_early', 'August 27 is not too early actually, but September 1 at 2pm is my earliest opening. Would that work?'],
    ['not_earlier_than_i_can', "August 27 isn't earlier than I can do, but September 1 at 2pm is my earliest opening. Would that work?"],
    ['hardly_too_soon', 'August 27 is hardly too soon, but September 1 at 2pm is my earliest opening. Would that work?']
  ]
  for (const [id, text] of negatedRejectionPackets) {
    const packet = { bubbles: [{ text }] }
    const strict = evaluateClosedTransitionContract(
      tooSoonCounterproposalInput,
      packet,
      earliestBoundaryPlan
    )
    const liveness = evaluateClosedTransitionLivenessFloor(
      tooSoonCounterproposalInput,
      packet,
      earliestBoundaryPlan
    )
    check(
      `semantic_earliest_boundary_${id}_cannot_invert_rejection_polarity`,
      strict.valid === false &&
        strict.reason === 'closed_transition_out_of_window_date_acceptance_forbidden' &&
        liveness.valid === false &&
        liveness.reason === 'closed_transition_out_of_window_date_acceptance_forbidden',
      JSON.stringify({ strict, liveness })
    )
  }

  const explicitEllipsisRejectionPacket = {
    bubbles: [{
      text: "I definitely can't fit you in then, but September 1 at 2pm is my earliest opening. Would that work?"
    }]
  }
  const explicitEllipsisRejectionStrict = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    explicitEllipsisRejectionPacket,
    earliestBoundaryPlan
  )
  const explicitEllipsisRejectionLiveness = evaluateClosedTransitionLivenessFloor(
    tooSoonCounterproposalInput,
    explicitEllipsisRejectionPacket,
    earliestBoundaryPlan
  )
  check(
    'semantic_earliest_boundary_positive_ellipsis_rejection_remains_safe',
    explicitEllipsisRejectionStrict.valid === true &&
      explicitEllipsisRejectionLiveness.valid === true &&
      explicitEllipsisRejectionLiveness.liveness_floor === false,
    JSON.stringify({ explicitEllipsisRejectionStrict, explicitEllipsisRejectionLiveness })
  )

  const boundaryThenExplicitRejectionPacket = {
    bubbles: [{
      text: 'September 1 at 2pm is my soonest opening. August 27 is definitely too soon. Would September 1 work?'
    }]
  }
  const boundaryThenExplicitRejectionStrict = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    boundaryThenExplicitRejectionPacket,
    earliestBoundaryPlan
  )
  const boundaryThenExplicitRejectionLiveness = evaluateClosedTransitionLivenessFloor(
    tooSoonCounterproposalInput,
    boundaryThenExplicitRejectionPacket,
    earliestBoundaryPlan
  )
  check(
    'semantic_earliest_boundary_allows_later_explicit_rejection_of_proposed_date',
    boundaryThenExplicitRejectionStrict.valid === true &&
      boundaryThenExplicitRejectionLiveness.valid === true &&
      boundaryThenExplicitRejectionLiveness.liveness_floor === false,
    JSON.stringify({ boundaryThenExplicitRejectionStrict, boundaryThenExplicitRejectionLiveness })
  )

  const rejectionThenBoundaryPacket = {
    bubbles: [{
      text: 'August 27 is definitely too soon. September 1 at 2pm is my earliest opening. Would that work?'
    }]
  }
  const rejectionThenBoundaryStrict = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    rejectionThenBoundaryPacket,
    earliestBoundaryPlan
  )
  const rejectionThenBoundaryLiveness = evaluateClosedTransitionLivenessFloor(
    tooSoonCounterproposalInput,
    rejectionThenBoundaryPacket,
    earliestBoundaryPlan
  )
  check(
    'semantic_earliest_boundary_allows_explicit_rejection_before_boundary',
    rejectionThenBoundaryStrict.valid === true &&
      rejectionThenBoundaryLiveness.valid === true &&
      rejectionThenBoundaryLiveness.liveness_floor === false,
    JSON.stringify({ rejectionThenBoundaryStrict, rejectionThenBoundaryLiveness })
  )

  const neutralMentionThenBoundaryPacket = {
    bubbles: [{
      text: 'Regarding August 27, September 1 at 2pm is my earliest opening. Would that work?'
    }]
  }
  const neutralMentionThenBoundaryStrict = evaluateClosedTransitionContract(
    tooSoonCounterproposalInput,
    neutralMentionThenBoundaryPacket,
    earliestBoundaryPlan
  )
  const neutralMentionThenBoundaryLiveness = evaluateClosedTransitionLivenessFloor(
    tooSoonCounterproposalInput,
    neutralMentionThenBoundaryPacket,
    earliestBoundaryPlan
  )
  check(
    'semantic_earliest_boundary_allows_demonstrably_neutral_prior_date_mention',
    neutralMentionThenBoundaryStrict.valid === true &&
      neutralMentionThenBoundaryLiveness.valid === true &&
      neutralMentionThenBoundaryLiveness.liveness_floor === false,
    JSON.stringify({ neutralMentionThenBoundaryStrict, neutralMentionThenBoundaryLiveness })
  )

  // Live Omar.system regression 2026-07-25: one client turn combined an
  // out-of-window date with a direct pricing question. The model produced a
  // natural, complete answer, but the date verifier read "works" for the
  // grounded alternative as acceptance of the rejected client date. It also
  // failed to recognize "a bit soon" as a rejection. The two obligations must
  // intersect without requiring canned outward copy.
  const combinedTooSoonPriceInput = {
    ...tooSoonCounterproposalInput,
    message: 'How about July 18? By the way, is it free?',
    live_message: 'How about July 18? By the way, is it free?'
  }
  const combinedTooSoonPricePlan = deriveClosedTransitionPlan(combinedTooSoonPriceInput)
  const naturalCombinedPacket = {
    bubbles: [
      { text: 'nah the discounted model rate is 150 an hour when the piece stays in my style' },
      { text: 'july 18 is a bit soon tho the earliest i can book you is july 25 at 2pm does that work?' }
    ]
  }
  const naturalCombinedVerdict = evaluateClosedTransitionContract(
    combinedTooSoonPriceInput,
    naturalCombinedPacket,
    combinedTooSoonPricePlan
  )
  check(
    'combined_too_soon_date_and_price_accepts_natural_complete_grounded_reply',
    combinedTooSoonPricePlan.action === ACTIONS.POST_FORM_AVAILABILITY &&
      combinedTooSoonPricePlan.reason === 'submitted_form_date_counterproposal_outside_window' &&
      combinedTooSoonPricePlan.obligations.includes('answer_model_rate') &&
      naturalCombinedVerdict.valid === true,
    JSON.stringify({ combinedTooSoonPricePlan, naturalCombinedVerdict })
  )
  const incompleteCombinedPriceVerdict = evaluateClosedTransitionContract(
    combinedTooSoonPriceInput,
    {
      bubbles: [
        { text: 'nah, it is 150 an hour' },
        { text: 'july 18 is a little soon, july 25 at 2pm would work instead. does that work for you?' }
      ]
    },
    combinedTooSoonPricePlan
  )
  check(
    'combined_date_price_reply_missing_style_eligibility_still_fails_closed',
    incompleteCombinedPriceVerdict.valid === false &&
      incompleteCombinedPriceVerdict.reason === 'closed_transition_rate_missing',
    JSON.stringify(incompleteCombinedPriceVerdict)
  )
  const unsafeCombinedAcceptanceVerdict = evaluateClosedTransitionContract(
    combinedTooSoonPriceInput,
    {
      bubbles: [
        { text: 'the discounted model rate is 150 an hour when the piece stays in my style' },
        { text: 'july 18 works for me. july 25 at 2pm is another option too' }
      ]
    },
    combinedTooSoonPricePlan
  )
  check(
    'combined_date_price_reply_cannot_accept_the_out_of_window_date',
    unsafeCombinedAcceptanceVerdict.valid === false &&
      unsafeCombinedAcceptanceVerdict.reason === 'closed_transition_out_of_window_date_acceptance_forbidden',
    JSON.stringify(unsafeCombinedAcceptanceVerdict)
  )

  const missingActionPointerInput = {
    message: 'send it',
    recent_history: [],
    structured_state: {
      live_turn_context_relation: 'ambiguous_missing_referent',
      live_turn_context_missing: true,
      live_turn_context_needs_clarification: true
    }
  }
  const missingActionPointerPlan = deriveClosedTransitionPlan(missingActionPointerInput)
  const naturalMissingObjectQuestion = { bubbles: [{ text: 'hey just to be sure what exactly do you want me to send' }] }
  const naturalMissingObjectStrict = evaluateClosedTransitionContract(missingActionPointerInput, naturalMissingObjectQuestion, missingActionPointerPlan)
  const naturalMissingObjectLiveness = evaluateClosedTransitionLivenessFloor(missingActionPointerInput, naturalMissingObjectQuestion, missingActionPointerPlan)
  check(
    'safe_natural_missing_action_object_clarification_passes_strict_without_punctuation',
    missingActionPointerPlan.action === ACTIONS.RESOLVE_CONTEXT &&
      naturalMissingObjectStrict.valid === true &&
      naturalMissingObjectLiveness.valid === true &&
      naturalMissingObjectLiveness.liveness_floor === false,
    JSON.stringify({ missingActionPointerPlan, naturalMissingObjectStrict, naturalMissingObjectLiveness })
  )
  const livePlaceholderChoice = { bubbles: [{ text: 'hey just to be sure are you talking about the same piece you mentioned earlier or something new over there?' }] }
  const livePlaceholderChoiceStrict = evaluateClosedTransitionContract(missingActionPointerInput, livePlaceholderChoice, missingActionPointerPlan)
  const livePlaceholderChoiceLiveness = evaluateClosedTransitionLivenessFloor(missingActionPointerInput, livePlaceholderChoice, missingActionPointerPlan)
  check(
    'live_same_piece_or_something_new_placeholder_choice_is_rejected',
    livePlaceholderChoiceStrict.valid === false &&
      livePlaceholderChoiceStrict.reason === 'closed_transition_missing_referent_clarification_required' &&
      livePlaceholderChoiceLiveness.valid === false,
    JSON.stringify({ livePlaceholderChoiceStrict, livePlaceholderChoiceLiveness })
  )
  const genericPlaceholderChoice = { bubbles: [{ text: 'which one do you mean, the same one or the other one?' }] }
  check(
    'generic_unresolved_placeholder_choice_is_rejected_even_with_which_one',
    evaluateClosedTransitionLivenessFloor(missingActionPointerInput, genericPlaceholderChoice, missingActionPointerPlan).valid === false
  )
  const openLocationClarification = { bubbles: [{ text: 'what do you mean by over there?' }] }
  check(
    'open_over_there_referent_question_is_adopted',
    evaluateClosedTransitionContract(missingActionPointerInput, openLocationClarification, missingActionPointerPlan).valid === true
  )
  const openDirectionClarification = { bubbles: [{ text: 'which place or direction are you pointing to exactly?' }] }
  check(
    'open_direction_referent_question_is_adopted',
    evaluateClosedTransitionContract(missingActionPointerInput, openDirectionClarification, missingActionPointerPlan).valid === true
  )
  for (const [name, text] of [
    ['arm_part', 'what part of your arm do you mean by over there?'],
    ['arm_pointing', 'where exactly are you pointing to on your arm?'],
    ['upper_arm_spot', 'which spot on your upper arm are you referring to?'],
    ['forearm_area', 'what area on your forearm are you talking about?']
  ]) {
    check(
      `open_spatial_referent_${name}_is_adopted`,
      evaluateClosedTransitionContract(
        missingActionPointerInput,
        { bubbles: [{ text }] },
        missingActionPointerPlan
      ).valid === true,
      text
    )
  }
  for (const [name, text] of [
    ['part_clicked', 'what part of it clicked for you?'],
    ['detail_loved', 'which detail did you love most?'],
    ['part_keep', 'what part of the reference do you want me to keep strongest?']
  ]) {
    const verdict = evaluateClosedTransitionContract(
      missingActionPointerInput,
      { bubbles: [{ text }] },
      missingActionPointerPlan
    )
    check(
      `unseen_design_probe_${name}_still_rejected`,
      verdict.valid === false && verdict.reason === 'closed_transition_missing_context_assumption_forbidden',
      JSON.stringify(verdict)
    )
  }
  for (const [name, text] of [
    ['exact_live_cool_prefix', 'okay cool where’s that over there for you? like a spot or vibe?'],
    ['nice_prefix', 'nice, which direction do you mean?'],
    ['sounds_good_prefix', 'sounds good, what do you mean by there?'],
    ['love_that_prefix', 'love that, where exactly do you mean?']
  ]) {
    const verdict = evaluateClosedTransitionContract(
      missingActionPointerInput,
      { bubbles: [{ text }] },
      missingActionPointerPlan
    )
    check(`positive_unresolved_${name}_is_rejected`,
      verdict.valid === false && verdict.reason === 'closed_transition_missing_context_assumption_forbidden',
      JSON.stringify(verdict))
  }
  for (const [name, text] of [
    ['wait', 'wait what do you mean by over there?'],
    ['hey', 'hey which direction do you mean exactly?'],
    ['neutral_okay', 'okay what do you mean by over there?']
  ]) {
    check(`neutral_attention_${name}_open_question_is_adopted`,
      evaluateClosedTransitionContract(
        missingActionPointerInput,
        { bubbles: [{ text }] },
        missingActionPointerPlan
      ).valid === true,
      text)
  }
  const liveFalseUnderstandingBeforeMediaRequest = {
    bubbles: [
      { text: 'yeah i get that you want something like what you mentioned' },
      { text: 'but i still can\'t see the actual reference here' },
      { text: 'could you send the pic or drop the link you\'re thinking of so i can get it right?' }
    ]
  }
  const missingAttachmentInput = {
    message: 'I want something in that direction',
    recent_history: [],
    structured_state: {
      live_turn_context_missing_attachment: true,
      live_turn_reference_pointer_without_media: true,
      live_turn_context_missing: true,
      live_turn_context_needs_clarification: true
    }
  }
  const missingAttachmentPlan = deriveClosedTransitionPlan(missingAttachmentInput)
  const contaminatedMissingAttachmentPlan = deriveClosedTransitionPlan({
    ...missingAttachmentInput,
    structured_state: {
      ...missingAttachmentInput.structured_state,
      // Exact live failure family: completed booking state or a candidate intent
      // label must not pull an unresolved new visual pointer into deposit logic.
      deposit_requested: true,
      live_turn_deposit_sent: true,
      form_link_sent: true,
      form_submitted: true
    }
  })
  check(
    'verified_missing_attachment_outranks_stale_or_candidate_transaction_flags',
    contaminatedMissingAttachmentPlan.action === ACTIONS.RESOLVE_CONTEXT &&
      contaminatedMissingAttachmentPlan.reason === 'missing_attachment',
    JSON.stringify(contaminatedMissingAttachmentPlan)
  )
  const falseUnderstandingBeforeMediaVerdict = evaluateClosedTransitionContract(
    missingAttachmentInput,
    liveFalseUnderstandingBeforeMediaRequest,
    missingAttachmentPlan
  )
  check(
    'live_false_understanding_prefix_is_rejected_even_when_media_is_requested_later',
    falseUnderstandingBeforeMediaVerdict.valid === false &&
      falseUnderstandingBeforeMediaVerdict.reason === 'closed_transition_missing_attachment_assumption_forbidden',
    JSON.stringify(falseUnderstandingBeforeMediaVerdict)
  )
  const exactUserRejectedReply = {
    bubbles: [
      { text: "Okay, I get the vibe you're aiming for there." },
      { text: 'What do you mean by over there?' }
    ]
  }
  const exactUserRejectedVerdict = evaluateClosedTransitionContract(
    missingActionPointerInput,
    exactUserRejectedReply,
    missingActionPointerPlan
  )
  check(
    'claimed_vibe_understanding_cannot_be_washed_by_later_open_question',
    exactUserRejectedVerdict.valid === false &&
      exactUserRejectedVerdict.reason === 'closed_transition_missing_context_assumption_forbidden',
    JSON.stringify(exactUserRejectedVerdict)
  )
  const liveGotYouPrefix = {
    bubbles: [{ text: 'got you what you mean by this though? could you send the actual pic or post you are thinking of so i can see it better' }]
  }
  const liveGotYouPrefixVerdict = evaluateClosedTransitionContract(
    missingAttachmentInput,
    liveGotYouPrefix,
    missingAttachmentPlan
  )
  check(
    'generic_got_you_prefix_cannot_claim_resolution_before_attachment',
    liveGotYouPrefixVerdict.valid === false &&
      liveGotYouPrefixVerdict.reason === 'closed_transition_missing_attachment_assumption_forbidden',
    JSON.stringify(liveGotYouPrefixVerdict)
  )
  check(
    'missing_action_liveness_floor_cannot_invent_or_send_form',
    evaluateClosedTransitionLivenessFloor(
      missingActionPointerInput,
      { bubbles: [{ text: `you mean the form right? ${PREFERRED_FORM_LINK}` }] },
      missingActionPointerPlan
    ).valid === false
  )
  const unsafeEarlyAcceptance = evaluateClosedTransitionLivenessFloor(
    tooSoonCounterproposalInput,
    { bubbles: [{ text: 'the 18th works perfect. july 25 at 2pm is still open too' }] },
    tooSoonCounterproposalPlan
  )
  check(
    'liveness_floor_cannot_accept_out_of_window_client_date',
    unsafeEarlyAcceptance.valid === false,
    JSON.stringify(unsafeEarlyAcceptance)
  )
  const unsafeThirdDate = evaluateClosedTransitionLivenessFloor(
    tooSoonCounterproposalInput,
    { bubbles: [{ text: 'the 18th is too early. july 19 at 2pm is better' }, { text: 'july 25 at 2pm is still open too' }] },
    tooSoonCounterproposalPlan
  )
  check(
    'liveness_floor_cannot_invent_third_date',
    unsafeThirdDate.valid === false,
    JSON.stringify(unsafeThirdDate)
  )

  const socialLivenessInput = {
    message: 'hey, how are you doing?',
    recent_history: [],
    structured_state: { booking_stage_hint: 'open_conversation' }
  }
  const socialLivenessPlan = deriveClosedTransitionPlan(socialLivenessInput)
  const safeSocialDeadEnd = { bubbles: [{ text: 'hey im good over here' }] }
  const safeSocialStrict = evaluateClosedTransitionContract(socialLivenessInput, safeSocialDeadEnd, socialLivenessPlan)
  const safeSocialLiveness = evaluateClosedTransitionLivenessFloor(socialLivenessInput, safeSocialDeadEnd, socialLivenessPlan)
  check(
    'strict_social_dead_end_candidate_is_rejected',
    socialLivenessPlan.action === ACTIONS.SOCIAL_CONTINUE &&
      safeSocialStrict.valid === false &&
      safeSocialStrict.reason === 'closed_transition_social_dead_end',
    JSON.stringify({ socialLivenessPlan, safeSocialStrict })
  )
  check(
    'semantic_harness_valid_social_model_copy_survives_host_motion_false_negative',
    safeSocialLiveness.valid === true &&
      safeSocialLiveness.liveness_floor === true &&
      safeSocialLiveness.strict_reason === 'closed_transition_social_dead_end',
    JSON.stringify(safeSocialLiveness)
  )
  const unsafeSocialColdPush = evaluateClosedTransitionLivenessFloor(
    socialLivenessInput,
    { bubbles: [{ text: 'hey im good, want to talk about your tattoo and book a date?' }] },
    socialLivenessPlan
  )
  check(
    'social_liveness_floor_cannot_cold_push_tattoo_or_booking',
    unsafeSocialColdPush.valid === false,
    JSON.stringify(unsafeSocialColdPush)
  )
  const socialRepair = buildClosedTransitionRepairLock(socialLivenessPlan, {
    reason: 'closed_transition_social_dead_end'
  })
  check(
    'social_repair_lock_requires_motion_without_fixed_visible_script',
    socialRepair.includes('plain social and human') &&
      socialRepair.includes('one easy answerable social next move') &&
      socialRepair.includes('Do not cold-push tattoo') &&
      !socialRepair.includes('how are you doing?') &&
      !socialRepair.includes('what are you up to?'),
    socialRepair
  )

  const freePriceInput = {
    message: 'By the way, is it free?',
    recent_history: [],
    structured_state: { booking_stage_hint: 'open_conversation' }
  }
  const freePricePlan = deriveClosedTransitionPlan(freePriceInput)
  const freePriceSalesDeflection = {
    bubbles: [
      { text: "haha no it's not free but i promise it's worth every penny" },
      { text: "what's got you curious about that today?" }
    ]
  }
  const freePriceStrict = evaluateClosedTransitionContract(
    freePriceInput,
    freePriceSalesDeflection,
    freePricePlan
  )
  const freePriceLiveness = evaluateClosedTransitionLivenessFloor(
    freePriceInput,
    freePriceSalesDeflection,
    freePricePlan
  )
  check(
    'free_question_routes_to_direct_price_obligation_not_social',
    freePricePlan.action === ACTIONS.GENERAL_CONTINUE &&
      freePricePlan.reason === 'direct_question_obligation_owns_turn_without_cold_funnel_push' &&
      freePricePlan.obligations.includes('answer_model_rate'),
    JSON.stringify(freePricePlan)
  )
  check(
    'free_question_sales_deflection_rejected_by_strict_verifier',
    freePriceStrict.valid === false &&
      freePriceStrict.reason === 'closed_transition_rate_missing',
    JSON.stringify(freePriceStrict)
  )
  check(
    'free_question_price_obligation_cannot_liveness_fail_open',
    freePriceLiveness.valid === false &&
      freePriceLiveness.reason === 'closed_transition_rate_missing',
    JSON.stringify(freePriceLiveness)
  )
  check(
    'free_question_locked_price_answer_is_adoptable',
    evaluateClosedTransitionContract(
      freePriceInput,
      { bubbles: [{ text: "nah the discounted model rate is 150 per hour as long as we're keeping the piece in my style" }] },
      freePricePlan
    ).valid === true,
    JSON.stringify(freePricePlan)
  )

  // Live Omar.system regression 2026-07-25: the client accepted the open form
  // offer, then immediately sent a price question before the first inbound could
  // commit. Latest-only ingress correctly collapsed the two physical messages,
  // but the controller inspected only the second text while the post-filter saw
  // both. The controller and verifier must now derive one atomic SEND_FORM turn
  // with the price obligation, independent of the two-message order.
  const compoundConsentPriceBase = {
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'black and gray portrait',
      form_offer_asked: true,
      form_link_sent: false,
      booking_stage_hint: 'awaiting_form_permission_answer'
    }
  }
  const consentThenPriceInput = {
    ...compoundConsentPriceBase,
    message: 'By the way, is is it free?',
    recent_history: [
      { role: 'assistant', text: 'once you are ready i can send over the form so we can confirm a date' },
      { role: 'user', text: 'OK, send it over' }
    ]
  }
  const consentThenPricePlan = deriveClosedTransitionPlan(consentThenPriceInput)
  check(
    'prior_unfulfilled_consent_plus_latest_price_is_one_send_form_route',
    consentThenPricePlan.action === ACTIONS.SEND_FORM &&
      consentThenPricePlan.reason === 'explicit_form_request_or_open_offer_consent' &&
      consentThenPricePlan.obligations.includes('answer_model_rate') &&
      consentThenPricePlan.live_intent.prior_unfulfilled_form_consent === true,
    JSON.stringify(consentThenPricePlan)
  )

  const compoundConsentPricePacket = {
    bubbles: [
      { text: "it isnt free the discounted model rate is 150 per hour when we're keeping the piece in my style" },
      { text: `here is the form ${PREFERRED_FORM_LINK}` },
      { text: 'once it is in, send me a couple days here too so i can check what works' }
    ]
  }
  check(
    'compound_consent_price_packet_must_fulfill_link_price_and_availability_together',
    evaluateClosedTransitionContract(
      consentThenPriceInput,
      compoundConsentPricePacket,
      consentThenPricePlan
    ).valid === true,
    JSON.stringify(consentThenPricePlan)
  )
  check(
    'compound_consent_price_packet_missing_link_fails_closed',
    evaluateClosedTransitionContract(
      consentThenPriceInput,
      { bubbles: compoundConsentPricePacket.bubbles.filter((bubble) => !String(bubble.text).includes(PREFERRED_FORM_LINK)) },
      consentThenPricePlan
    ).reason === 'closed_transition_form_link_exactly_once_required',
    JSON.stringify(consentThenPricePlan)
  )
  check(
    'compound_consent_price_packet_missing_price_fails_closed',
    evaluateClosedTransitionContract(
      consentThenPriceInput,
      { bubbles: compoundConsentPricePacket.bubbles.slice(1) },
      consentThenPricePlan
    ).reason === 'closed_transition_rate_missing',
    JSON.stringify(consentThenPricePlan)
  )

  const priceThenConsentInput = {
    ...compoundConsentPriceBase,
    message: 'OK, send it over',
    recent_history: [
      { role: 'assistant', text: 'once you are ready i can send over the form so we can confirm a date' },
      { role: 'user', text: 'By the way, is is it free?' }
    ]
  }
  const priceThenConsentPlan = deriveClosedTransitionPlan(priceThenConsentInput)
  check(
    'reversed_physical_message_order_preserves_same_form_and_price_obligations',
    priceThenConsentPlan.action === ACTIONS.SEND_FORM &&
      priceThenConsentPlan.obligations.includes('answer_model_rate'),
    JSON.stringify(priceThenConsentPlan)
  )

  const withdrawnConsentPlan = deriveClosedTransitionPlan({
    ...compoundConsentPriceBase,
    message: "actually no don't send it",
    recent_history: [
      { role: 'assistant', text: 'once you are ready i can send over the form so we can confirm a date' },
      { role: 'user', text: 'OK, send it over' }
    ]
  })
  check(
    'newer_explicit_withdrawal_cancels_prior_unfulfilled_form_consent',
    withdrawnConsentPlan.action !== ACTIONS.SEND_FORM &&
      withdrawnConsentPlan.live_intent.prior_unfulfilled_form_consent === false,
    JSON.stringify(withdrawnConsentPlan)
  )

  const staleDesignNoisyQuestionInput = {
    message: 'can i as,uou a qurstion',
    recent_history: [{ role: 'assistant', text: 'send me the pic or link you mean so i can see the right one' }],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'black and gray snake reference',
      booking_stage_hint: 'design_intake'
    }
  }
  const staleDesignNoisyQuestionPlan = deriveClosedTransitionPlan(staleDesignNoisyQuestionInput)
  check(
    'recoverable_noisy_question_permission_outranks_stale_design_funnel',
    staleDesignNoisyQuestionPlan.action === ACTIONS.SOCIAL_CONTINUE &&
      staleDesignNoisyQuestionPlan.reason === 'latest_turn_recoverable_question_permission_owns_route',
    JSON.stringify(staleDesignNoisyQuestionPlan)
  )
  check(
    'recoverable_noisy_question_cannot_offer_form',
    evaluateClosedTransitionContract(
      staleDesignNoisyQuestionInput,
      { bubbles: [{ text: 'yeah go ahead' }] },
      staleDesignNoisyQuestionPlan
    ).valid === true &&
      evaluateClosedTransitionContract(
        staleDesignNoisyQuestionInput,
        { bubbles: [{ text: 'want me to send the form so we can lock it in?' }] },
        staleDesignNoisyQuestionPlan
      ).valid === false
  )

  const staleBookingPersonalQuestionInput = {
    message: 'What is your sexual identity?',
    recent_history: [],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'black and gray snake reference',
      form_offer_asked: true,
      booking_stage_hint: 'awaiting_form_permission_answer',
      live_turn_is_question: true,
      live_turn_self_contained_topic_shift: true
    }
  }
  const staleBookingPersonalQuestionPlan = deriveClosedTransitionPlan(staleBookingPersonalQuestionInput)
  check(
    'self_contained_personal_question_outranks_durable_booking_state',
    staleBookingPersonalQuestionPlan.action === ACTIONS.SOCIAL_CONTINUE &&
      staleBookingPersonalQuestionPlan.reason === 'latest_turn_self_contained_nonfunnel_owns_route',
    JSON.stringify(staleBookingPersonalQuestionPlan)
  )

  const staleBookingEmojiInput = {
    message: '🫠🦐',
    recent_history: [],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'black and gray snake reference',
      booking_stage_hint: 'design_intake'
    }
  }
  const staleBookingEmojiPlan = deriveClosedTransitionPlan(staleBookingEmojiInput)
  check(
    'emoji_only_turn_outranks_stale_design_without_becoming_photo',
    staleBookingEmojiPlan.action === ACTIONS.SOCIAL_CONTINUE,
    JSON.stringify(staleBookingEmojiPlan)
  )

  const genericTattooInterestInput = {
    message: 'doing good. i wanted to ask about getting a tattoo',
    recent_history: [{ role: 'assistant', text: 'hey im doing alright thanks for asking! what’s up with you?' }],
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
  }
  const genericTattooInterestPlan = deriveClosedTransitionPlan(genericTattooInterestInput)
  check(
    'generic_tattoo_interest_routes_to_design_intake_not_form_offer',
    genericTattooInterestPlan.action === ACTIONS.DESIGN_INTAKE &&
      genericTattooInterestPlan.reason === 'tattoo_lane_missing_design_direction',
    JSON.stringify(genericTattooInterestPlan)
  )
  const contaminatedGenericInterestPlan = deriveClosedTransitionPlan({
    ...genericTattooInterestInput,
    structured_state: {
      ...genericTattooInterestInput.structured_state,
      live_turn_gave_design_idea: true,
      known_design_context: 'doing good. i wanted to ask about getting a tattoo'
    }
  })
  check(
    'model_design_label_cannot_promote_generic_tattoo_interest_to_form_offer',
    contaminatedGenericInterestPlan.action === ACTIONS.DESIGN_INTAKE,
    JSON.stringify(contaminatedGenericInterestPlan)
  )
  const concreteDesignPlan = deriveClosedTransitionPlan({
    message: 'i’m thinking of a black and gray snake wrapping around my shoulder',
    recent_history: [],
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
  })
  check(
    'concrete_subject_and_style_can_open_form_offer',
    concreteDesignPlan.action === ACTIONS.OFFER_FORM,
    JSON.stringify(concreteDesignPlan)
  )
  const openVocabularyDesignPlan = deriveClosedTransitionPlan({
    message: "Hi, I'm thinking about a colorful moth on my shoulder, around 4 by 4 inches.",
    recent_history: [],
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
  })
  check(
    'open_vocabulary_subject_plus_placement_and_size_opens_form_offer',
    openVocabularyDesignPlan.action === ACTIONS.OFFER_FORM &&
      openVocabularyDesignPlan.reason === 'design_direction_ready_for_form_offer',
    JSON.stringify(openVocabularyDesignPlan)
  )
  for (const [id, message] of [
    ['generic_custom_placeholder_stays_design_intake', "I'm thinking about something custom"],
    ['portfolio_compliment_stays_design_intake', 'I love your style'],
    ['body_only_tattoo_stays_design_intake', 'I want a shoulder tattoo'],
    ['generic_booking_info_stays_design_intake', 'Hey, can I get more info about booking a tattoo?'],
    ['generic_custom_tattoo_info_stays_design_intake', 'can I get more information about a custom tattoo?'],
    ['generic_getting_tattooed_details_stays_design_intake', 'could I get details about getting tattooed?'],
    ['generic_booking_process_stays_design_intake', 'I want to know more about your booking process'],
    ['generic_how_booking_works_stays_design_intake', 'how does booking a tattoo work?'],
    ['generic_booking_steps_stay_design_intake', 'what do I need to do to book a tattoo?'],
    ['generic_booking_help_stays_design_intake', 'can I get help with booking a tattoo?'],
    ['generic_process_guidance_stays_design_intake', 'could I get guidance about your tattoo process?'],
    ['generic_policy_explanation_stays_design_intake', 'I would like an explanation of your booking policy'],
    ['generic_tattoo_inquiry_stays_design_intake', 'can I get a tattoo inquiry?'],
    ['generic_booking_instructions_stay_design_intake', 'could I have booking instructions?'],
    ['generic_process_understanding_stays_design_intake', 'I want to understand how the tattoo process works'],
    ['generic_sometime_booking_stays_design_intake', 'I want to book with you sometime'],
    ['generic_someday_custom_tattoo_stays_design_intake', 'I would like a custom tattoo someday'],
    ['generic_tattoo_advice_stays_design_intake', 'can I get some general tattoo advice?'],
    ['generic_next_steps_stay_design_intake', 'I want the next steps for a tattoo'],
    ['generic_working_with_artist_info_stays_design_intake', 'I am looking for more information about working with you'],
    ['generic_tattoo_interest_stays_design_intake', "I'm interested in getting a tattoo"]
  ]) {
    const genericPlan = deriveClosedTransitionPlan({
      message,
      recent_history: [],
      // The model/state candidate is intentionally contaminated. The shared
      // concrete-design authority must quarantine it before route adoption.
      structured_state: {
        tattoo_intent_active: true,
        live_turn_gave_design_idea: true,
        known_design_context: message,
        booking_stage_hint: 'design_intake'
      }
    })
    check(id, genericPlan.action === ACTIONS.DESIGN_INTAKE, JSON.stringify(genericPlan))
  }

  for (const [id, message] of [
    ['colorful_moth_is_concrete', 'can I get a colorful moth tattoo?'],
    ['named_vehicle_is_concrete', 'can I get a 1997 Chevy Impala tattoo?'],
    ['abstract_wave_is_concrete', "I'm thinking of an abstract wave on my forearm."],
    ['unknown_animal_accessory_is_concrete', 'I want a capybara wearing sunglasses'],
    ['unknown_object_is_concrete', 'I would like a vintage diving helmet'],
    ['unknown_botanical_is_concrete', 'can I get a pomegranate branch tattoo?']
  ]) {
    const concretePlan = deriveClosedTransitionPlan({
      message,
      recent_history: [],
      structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
    })
    check(
      id,
      concretePlan.action === ACTIONS.OFFER_FORM &&
        concretePlan.reason === 'design_direction_ready_for_form_offer',
      JSON.stringify(concretePlan)
    )
  }

  const contaminatedInfoPlan = deriveClosedTransitionPlan(criticalCases.find((row) => row.id === 'generic_information_voice_note_cannot_be_upgraded_to_form_request').input)
  check('generic_information_voice_note_reports_no_grounded_form_intent', contaminatedInfoPlan.live_intent.explicit_form_request === false, JSON.stringify(contaminatedInfoPlan))
  check('generic_information_voice_note_reports_no_grounded_price_intent', contaminatedInfoPlan.live_intent.asks_price === false && !contaminatedInfoPlan.obligations.includes('answer_model_rate'), JSON.stringify(contaminatedInfoPlan))

  const payloadMutationInput = criticalCases.find((row) => row.id === 'form_consent_fulfills_link').input
  const payloadMutationPlan = deriveClosedTransitionPlan(payloadMutationInput)
  const missingLink = evaluateClosedTransitionContract(payloadMutationInput, { bubbles: [{ text: 'yeah for sure, send me some dates' }] }, payloadMutationPlan)
  check('send_form_semantic_mutation_is_rejected', missingLink.valid === false && missingLink.reason === 'closed_transition_form_link_exactly_once_required', JSON.stringify(missingLink))
  const repeatedOfferAfterVisibleLink = evaluateClosedTransitionContract(payloadMutationInput, {
    bubbles: [
      { text: PREFERRED_FORM_LINK },
      { text: 'the discounted model rate is 150 per hour as long as the design stays in my style' },
      { text: 'i can send the form if you want to get started' },
      { text: 'and toss me a couple days you are free so i can check what works' }
    ]
  }, payloadMutationPlan)
  check('send_form_cannot_repeat_offer_after_visible_link',
    repeatedOfferAfterVisibleLink.valid === false && repeatedOfferAfterVisibleLink.reason === 'closed_transition_form_offer_after_link_forbidden',
    JSON.stringify(repeatedOfferAfterVisibleLink))

  const depositInput = criticalCases.find((row) => row.id === 'confirmed_double_check_goes_direct_to_deposit').input
  const depositPlan = deriveClosedTransitionPlan(depositInput)
  const secondCheck = evaluateClosedTransitionContract(depositInput, goodPacketFor({ ...depositPlan, action: ACTIONS.DOUBLE_CHECK, fields: depositPlan.fields }), depositPlan)
  check('confirmed_double_check_cannot_loop_to_second_double_check', secondCheck.valid === false, JSON.stringify(secondCheck))

  const alreadySentInput = criticalCases.find((row) => row.id === 'sent_double_check_is_not_repeated_on_nonconfirmation').input
  const alreadySentPlan = deriveClosedTransitionPlan(alreadySentInput)
  const duplicateDoubleCheck = evaluateClosedTransitionContract(alreadySentInput, goodPacketFor({ ...alreadySentPlan, action: ACTIONS.DOUBLE_CHECK }), alreadySentPlan)
  check('existing_double_check_payload_cannot_be_repeated', duplicateDoubleCheck.valid === false && duplicateDoubleCheck.reason === 'closed_transition_duplicate_double_check_forbidden', JSON.stringify(duplicateDoubleCheck))

  const depositPendingInput = criticalCases.find((row) => row.id === 'deposit_handoff_is_not_repeated_or_backtracked').input
  const depositPendingPlan = deriveClosedTransitionPlan(depositPendingInput)
  const repeatedDeposit = evaluateClosedTransitionContract(depositPendingInput, goodPacketFor({ ...depositPendingPlan, action: ACTIONS.DEPOSIT_HANDOFF }), depositPendingPlan)
  check('existing_deposit_handoff_cannot_be_repeated', repeatedDeposit.valid === false && repeatedDeposit.reason === 'closed_transition_deposit_repeat_forbidden', JSON.stringify(repeatedDeposit))

  const ambiguousVoiceInput = criticalCases.find((row) => row.id === 'unknown_short_voice_after_form_offer_requires_clarification').input
  const ambiguousVoicePlan = deriveClosedTransitionPlan(ambiguousVoiceInput)
  const coherentClarification = evaluateClosedTransitionContract(ambiguousVoiceInput, goodPacketFor(ambiguousVoicePlan), ambiguousVoicePlan)
  check('ambiguous_form_voice_clarification_is_adopted', coherentClarification.valid === true, JSON.stringify(coherentClarification))
  const designMisread = evaluateClosedTransitionContract(ambiguousVoiceInput, { bubbles: [{ text: 'wait what part of the idea were you thinking about with shorting?' }] }, ambiguousVoicePlan)
  check('ambiguous_form_voice_cannot_be_adopted_as_design', designMisread.valid === false && designMisread.reason === 'closed_transition_form_permission_clarification_missing', JSON.stringify(designMisread))
  const unauthorizedFormSend = evaluateClosedTransitionContract(ambiguousVoiceInput, { bubbles: [{ text: `here is the form ${PREFERRED_FORM_LINK}` }] }, ambiguousVoicePlan)
  check('ambiguous_form_voice_cannot_silently_authorize_link', unauthorizedFormSend.valid === false && unauthorizedFormSend.reason === 'closed_transition_ambiguous_voice_cannot_authorize_form_send', JSON.stringify(unauthorizedFormSend))

  const nonconsentSizeInput = {
    message: 'roughly 8 inches or so',
    recent_history: [{ role: 'assistant', text: 'want me to send the application form?' }],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'black and grey snake wrapping around the arm',
      known_placement_context: 'arm',
      form_offer_asked: true,
      form_link_sent: false,
      booking_stage_hint: 'awaiting_form_permission_answer'
    }
  }
  const nonconsentSizePlan = deriveClosedTransitionPlan(nonconsentSizeInput)
  check(
    'size_detail_after_open_offer_is_nonconsent_route',
    nonconsentSizePlan.action === ACTIONS.GENERAL_CONTINUE && nonconsentSizePlan.reason === 'open_form_offer_received_nonconsent_size_or_placement_detail',
    JSON.stringify(nonconsentSizePlan)
  )
  const nonconsentSizeLink = evaluateClosedTransitionContract(nonconsentSizeInput, {
    bubbles: [
      { text: 'yeah that size works' },
      { text: PREFERRED_FORM_LINK },
      { text: 'send me a couple dates here too' }
    ]
  }, nonconsentSizePlan)
  check(
    'size_detail_without_consent_cannot_send_form_link',
    nonconsentSizeLink.valid === false && nonconsentSizeLink.reason === 'closed_transition_nonconsent_detail_cannot_send_form',
    JSON.stringify(nonconsentSizeLink)
  )
  const nonconsentSizeAck = evaluateClosedTransitionContract(nonconsentSizeInput, {
    bubbles: [{ text: 'yeah that size makes sense and we can dial the exact scale in together in person' }]
  }, nonconsentSizePlan)
  check('size_detail_ack_keeps_existing_form_question_pending', nonconsentSizeAck.valid === true, JSON.stringify(nonconsentSizeAck))

  // Directional placement is an open semantic family. Once the form question
  // is open, a body-anchored placement refinement must keep that question
  // pending; it is neither consent nor calendar authority.
  const directionalPlacementCases = [
    ['over_forearm', "I'm tryna wrap the snake over my forearm"],
    ['across_shoulder', 'maybe across my shoulder'],
    ['along_arm', 'more along my arm'],
    ['down_leg', 'i was thinking down my leg'],
    ['onto_wrist', 'could bring it onto my wrist'],
    ['upper_arm', 'probably my upper arm']
  ]
  for (const [id, message] of directionalPlacementCases) {
    const input = {
      ...nonconsentSizeInput,
      message,
      structured_state: {
        ...nonconsentSizeInput.structured_state,
        known_placement_context: ''
      }
    }
    const plan = deriveClosedTransitionPlan(input)
    check(
      `directional_placement_${id}_preserves_open_form_gate`,
      plan.action === ACTIONS.GENERAL_CONTINUE &&
        plan.reason === 'open_form_offer_received_nonconsent_size_or_placement_detail',
      JSON.stringify(plan)
    )
    const naturalAck = evaluateClosedTransitionContract(input, {
      bubbles: [{ text: 'got it that placement gives the piece a clear path through the shape' }]
    }, plan)
    check(`directional_placement_${id}_natural_ack_is_adopted`, naturalAck.valid === true, JSON.stringify(naturalAck))
  }

  const liveDirectionalInput = {
    ...nonconsentSizeInput,
    message: "I'm tryna wrap the snake over my forearm",
    structured_state: {
      ...nonconsentSizeInput.structured_state,
      known_placement_context: ''
    }
  }
  const liveDirectionalPlan = deriveClosedTransitionPlan(liveDirectionalInput)
  const liveDirectionalCalendarJump = evaluateClosedTransitionContract(liveDirectionalInput, {
    bubbles: [
      { text: 'got it wrapping the snake over your forearm sounds tight' },
      { text: 'when were you thinking of booking the session?' }
    ]
  }, liveDirectionalPlan)
  check(
    'directional_placement_after_open_offer_cannot_jump_to_calendar',
    liveDirectionalCalendarJump.valid === false &&
      liveDirectionalCalendarJump.reason === 'closed_transition_nonconsent_detail_cannot_skip_to_calendar',
    JSON.stringify(liveDirectionalCalendarJump)
  )

  const generalizedCalendarJumps = [
    'do you have a rough time frame in mind for when you want to get started',
    'when are you hoping to get started',
    'what kind of timeline are you thinking',
    'how soon are you looking to do it',
    'what month were you aiming for',
    'when would you want the session',
    'when were you thinking of booking the session'
  ]
  for (const text of generalizedCalendarJumps) {
    const verdict = evaluateClosedTransitionContract(liveDirectionalInput, {
      bubbles: [
        { text: 'got it wrapping the snake over your forearm sounds tight' },
        { text }
      ]
    }, liveDirectionalPlan)
    check(
      `open_form_gate_rejects_generalized_calendar_jump_${text}`,
      verdict.valid === false && verdict.reason === 'closed_transition_nonconsent_detail_cannot_skip_to_calendar',
      JSON.stringify(verdict)
    )
  }

  const designOrProcessStartPhrases = [
    'got it forearm wraps super cool spot for a snake',
    'we can get started once the form is in',
    'what made you want to start with a snake',
    'do you want it to start near the wrist'
  ]
  for (const text of designOrProcessStartPhrases) {
    const verdict = evaluateClosedTransitionContract(liveDirectionalInput, {
      bubbles: [{ text }]
    }, liveDirectionalPlan)
    check(
      `open_form_gate_keeps_noncalendar_start_language_${text}`,
      verdict.valid === true,
      JSON.stringify(verdict)
    )
  }

  // Exact live family: candidate/model flags said the client consented even
  // though the actual newest text was a self-contained tattoo brief. Current
  // client text is the only authority that may unlock the transactional URL.
  const concreteBrief = 'I want a black and grey koi wrapping around my upper arm around 8 inches'
  const contaminatedConsentInput = {
    message: concreteBrief,
    recent_history: [{ role: 'assistant', text: 'want me to send the application form?' }],
    structured_state: {
      tattoo_intent_active: true,
      live_turn_is_tattoo_intent: true,
      live_turn_gave_design_idea: true,
      known_design_context: concreteBrief,
      known_placement_context: 'upper arm',
      known_size_context: '8 inches',
      form_offer_asked: true,
      form_link_sent: false,
      live_turn_form_consent: true,
      live_turn_explicit_form_request: true,
      booking_stage_hint: 'awaiting_form_permission_answer'
    }
  }
  const contaminatedConsentPlan = deriveClosedTransitionPlan(contaminatedConsentInput)
  check(
    'model_flags_cannot_turn_concrete_brief_into_form_consent',
    contaminatedConsentPlan.action === ACTIONS.GENERAL_CONTINUE &&
      contaminatedConsentPlan.reason === 'open_form_offer_received_nonconsent_size_or_placement_detail' &&
      contaminatedConsentPlan.live_intent.form_consent === false &&
      contaminatedConsentPlan.live_intent.explicit_form_request === false,
    JSON.stringify(contaminatedConsentPlan)
  )
  const contaminatedConsentLink = evaluateClosedTransitionContract(contaminatedConsentInput, {
    bubbles: [
      { text: 'that koi direction and scale can work' },
      { text: PREFERRED_FORM_LINK },
      { text: 'send me a couple dates too' }
    ]
  }, contaminatedConsentPlan)
  check(
    'contaminated_consent_flags_cannot_authorize_form_url',
    contaminatedConsentLink.valid === false && contaminatedConsentLink.reason === 'closed_transition_nonconsent_detail_cannot_send_form',
    JSON.stringify(contaminatedConsentLink)
  )

  const cleanConcreteBriefInput = {
    message: concreteBrief,
    recent_history: [],
    structured_state: {
      tattoo_intent_active: true,
      live_turn_is_tattoo_intent: true,
      live_turn_gave_design_idea: true,
      known_design_context: concreteBrief,
      known_placement_context: 'upper arm',
      known_size_context: '8 inches',
      booking_stage_hint: 'design_intake'
    }
  }
  const cleanConcreteBriefPlan = deriveClosedTransitionPlan(cleanConcreteBriefInput)
  check(
    'fully_specified_concrete_brief_routes_to_offer_not_send',
    cleanConcreteBriefPlan.action === ACTIONS.OFFER_FORM && cleanConcreteBriefPlan.reason === 'design_direction_ready_for_form_offer',
    JSON.stringify(cleanConcreteBriefPlan)
  )
  const prematureConcreteBriefLink = evaluateClosedTransitionContract(cleanConcreteBriefInput, {
    bubbles: [{ text: `that can work ${PREFERRED_FORM_LINK}` }, { text: 'send me dates' }]
  }, cleanConcreteBriefPlan)
  check(
    'fully_specified_concrete_brief_cannot_skip_form_permission',
    prematureConcreteBriefLink.valid === false,
    JSON.stringify(prematureConcreteBriefLink)
  )

  const groundedConsentInput = {
    message: 'yes please',
    recent_history: [{ role: 'assistant', text: 'want me to send the application form?' }],
    structured_state: {
      tattoo_intent_active: true,
      form_offer_asked: true,
      form_link_sent: false,
      live_turn_form_consent: true,
      booking_stage_hint: 'awaiting_form_permission_answer'
    }
  }
  const groundedConsentPlan = deriveClosedTransitionPlan(groundedConsentInput)
  check(
    'actual_yes_after_offer_still_routes_to_send_form',
    groundedConsentPlan.action === ACTIONS.SEND_FORM,
    JSON.stringify(groundedConsentPlan)
  )

  // Exact live Omar regression, 2026-08-22: the reference-post classifier
  // remained in state after the assistant offered the form, and Instagram sent
  // the consent as the fused shorthand "Yesplz". Direct consent must win and
  // the form URL must be the next controlled transition.
  const fusedConsentAfterMediaInput = {
    message_id: 'omar-live-yesplz',
    message: 'Yesplz',
    recent_history: [
      {
        role: 'user',
        message_id: 'omar-live-reference',
        text: 'sent a reference post: The image shows a chat/app screenshot with two photos of a person.'
      },
      {
        role: 'assistant',
        message_id: 'omar-live-form-offer',
        text: 'want me to send the form so we can get the booking started?'
      }
    ],
    structured_state: {
      tattoo_intent_active: true,
      form_offer_asked: true,
      form_link_sent: false,
      booking_stage_hint: 'awaiting_form_permission_answer',
      live_turn_context_resolved_from_history: true,
      reference_media_classification_observed: true,
      known_reference_media_received: true,
      live_turn_form_consent: true,
      next_action: 'send_form'
    }
  }
  const fusedConsentAfterMediaPlan = deriveClosedTransitionPlan(fusedConsentAfterMediaInput)
  check(
    'live_yesplz_open_offer_outranks_inherited_non_tattoo_media',
    fusedConsentAfterMediaPlan.action === ACTIONS.SEND_FORM &&
      fusedConsentAfterMediaPlan.reason === 'explicit_form_request_or_open_offer_consent' &&
      fusedConsentAfterMediaPlan.live_intent.form_consent === true,
    JSON.stringify(fusedConsentAfterMediaPlan)
  )
  const fusedConsentAfterMediaPacket = goodPacketFor(fusedConsentAfterMediaPlan)
  const fusedConsentAfterMediaVerdict = evaluateClosedTransitionContract(
    fusedConsentAfterMediaInput,
    fusedConsentAfterMediaPacket,
    fusedConsentAfterMediaPlan
  )
  check(
    'live_yesplz_open_offer_sends_exact_form_once',
    fusedConsentAfterMediaVerdict.valid === true &&
      fusedConsentAfterMediaPacket.bubbles.filter((bubble) => bubble.text.includes(PREFERRED_FORM_LINK)).length === 1,
    JSON.stringify(fusedConsentAfterMediaVerdict)
  )

  const fusedWithdrawalPlan = deriveClosedTransitionPlan({
    ...fusedConsentAfterMediaInput,
    message_id: 'omar-live-yesplz-not-yet',
    message: 'Yesplz but not yet'
  })
  check(
    'fused_form_shorthand_with_withdrawal_is_not_consent',
    fusedWithdrawalPlan.action !== ACTIONS.SEND_FORM && fusedWithdrawalPlan.live_intent.form_consent === false,
    JSON.stringify(fusedWithdrawalPlan)
  )

  const voiceWrappedConsentInput = criticalCases.find((row) => row.id === 'voice_wrapped_compositional_form_consent_fulfills_link').input
  const voiceWrappedConsentPlan = deriveClosedTransitionPlan(voiceWrappedConsentInput)
  check(
    'voice_transport_wrapper_and_punctuation_cannot_hide_open_offer_consent',
    voiceWrappedConsentPlan.action === ACTIONS.SEND_FORM &&
      voiceWrappedConsentPlan.reason === 'explicit_form_request_or_open_offer_consent' &&
      voiceWrappedConsentPlan.live_intent.form_consent === true,
    JSON.stringify(voiceWrappedConsentPlan)
  )

  const complimentInput = criticalCases.find((row) => row.id === 'portfolio_compliment_cannot_be_promoted_to_form_offer').input
  const complimentPlan = deriveClosedTransitionPlan(complimentInput)
  const complimentLead = evaluateClosedTransitionContract(complimentInput, { bubbles: [{ text: 'thank youu, what kind of piece have you been thinking about lately?' }] }, complimentPlan)
  check('portfolio_compliment_design_lead_is_adopted', complimentLead.valid === true, JSON.stringify({ complimentPlan, complimentLead }))
  const prematureFormOffer = evaluateClosedTransitionContract(complimentInput, { bubbles: [{ text: 'thank youu, want me to send the application form?' }] }, complimentPlan)
  check('portfolio_compliment_cannot_skip_to_form_offer', prematureFormOffer.valid === false && prematureFormOffer.reason === 'closed_transition_form_before_design', JSON.stringify(prematureFormOffer))

  const compoundStyleScopeInput = criticalCases.find((row) => row.id === 'compound_portfolio_compliment_and_style_scope_question').input
  const compoundStyleScopePlan = deriveClosedTransitionPlan(compoundStyleScopeInput)
  check(
    'compound_style_scope_question_creates_atomic_answer_obligation',
    compoundStyleScopePlan.action === ACTIONS.DESIGN_INTAKE &&
      compoundStyleScopePlan.obligations.includes('answer_artist_style_scope') &&
      compoundStyleScopePlan.live_intent.asks_artist_style_scope === true,
    JSON.stringify(compoundStyleScopePlan)
  )
  const skippedStyleScope = evaluateClosedTransitionContract(
    compoundStyleScopeInput,
    { bubbles: [{ text: 'thank you so much for saying that' }, { text: 'did anything in my posts catch your eye?' }] },
    compoundStyleScopePlan
  )
  check(
    'compound_style_scope_question_cannot_be_washed_by_thanks_and_next_question',
    skippedStyleScope.valid === false && skippedStyleScope.reason === 'closed_transition_artist_style_scope_missing',
    JSON.stringify(skippedStyleScope)
  )
  const answeredStyleScope = evaluateClosedTransitionContract(
    compoundStyleScopeInput,
    { bubbles: [
      { text: 'thank youu 🖤 i keep every finished piece in my own style but references and custom ideas are totally fine to adapt into it' },
      { text: 'was there anything in the flashes or posts that caught you?' }
    ] },
    compoundStyleScopePlan
  )
  check('compound_style_scope_answer_and_host_lead_are_adopted_together', answeredStyleScope.valid === true, JSON.stringify(answeredStyleScope))

  const mediaOfferPlan = {
    action: ACTIONS.OFFER_FORM,
    reason: 'design_direction_complete_offer_form_once',
    obligations: [],
    fields: {}
  }
  const mediaOfferRepair = buildClosedTransitionRepairLock(mediaOfferPlan, {
    reason: 'closed_transition_form_offer_missing'
  })
  check('media_offer_repair_names_the_required_semantic_move_without_fixed_copy',
    mediaOfferRepair.includes('React briefly to the chosen subject or source image') &&
    mediaOfferRepair.includes('does not need to look like a finished tattoo reference') &&
    mediaOfferRepair.includes('ask once whether they want the application form') &&
    mediaOfferRepair.includes('send the URL before consent') &&
    !mediaOfferRepair.includes(PREFERRED_FORM_LINK) &&
    !mediaOfferRepair.includes('want me to send the application form?'),
    mediaOfferRepair)

  const liveFailureHistory = [
    { role: 'assistant', message_id: 'attachment-recovery', text: 'ooo you might have forgotten to send the pic or link over' },
    { role: 'assistant', message_id: 'attachment-recovery', text: "drop it again or just tell me what vibe you're going for" },
    {
      role: 'user',
      message_id: 'non-tattoo-image',
      text: 'sent a reference post: The image shows a website or presentation screenshot featuring BYOK Harness Verification.'
    },
    { role: 'user', message_id: 'voice-pointer', text: 'sent a voice note saying: This one, this one.' }
  ]
  const liveFailurePlan = deriveClosedTransitionPlan({
    message_id: 'voice-pointer',
    message: 'sent a voice note saying: This one, this one.',
    recent_history: liveFailureHistory,
    structured_state: {
      tattoo_intent_active: true,
      live_turn_context_resolved_from_history: true,
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }
  })
  check(
    'attachment_recovery_plus_non_tattoo_pointer_routes_visible_general_continue',
    liveFailurePlan.action === ACTIONS.GENERAL_CONTINUE &&
      liveFailurePlan.reason === 'non_tattoo_media_requires_contextual_host_lead',
    JSON.stringify(liveFailurePlan)
  )

  const selectedVisualElementPlan = deriveClosedTransitionPlan({
    message_id: 'pink-selection',
    message: 'I mean the pink doughnut',
    recent_history: [
      {
        role: 'user',
        message_id: 'pink-screen',
        text: 'sent a reference post: The image shows a website screenshot with a bright pink doughnut shape.'
      },
      { role: 'assistant', message_id: 'pink-question', text: 'what did you mean from that one?' },
      { role: 'user', message_id: 'pink-selection', text: 'I mean the pink doughnut' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      live_turn_context_relation: 'coherent',
      live_turn_context_missing: false,
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }
  })
  check(
    'client_named_element_inside_visible_non_tattoo_image_is_design_authority',
    selectedVisualElementPlan.action === ACTIONS.OFFER_FORM &&
      selectedVisualElementPlan.reason === 'design_direction_ready_for_form_offer',
    JSON.stringify(selectedVisualElementPlan)
  )

  const selectedVisualElementAsrPlan = deriveClosedTransitionPlan({
    message_id: 'pink-selection-asr',
    message: "I'm in the pink donut",
    recent_history: [
      {
        role: 'user',
        message_id: 'pink-screen-asr',
        text: 'sent a reference post: The image shows a website screenshot with a bright pink doughnut shape.'
      },
      { role: 'assistant', message_id: 'pink-question-asr', text: 'what did you mean from that one?' },
      { role: 'user', message_id: 'pink-selection-asr', text: "I'm in the pink donut" }
    ],
    structured_state: {
      tattoo_intent_active: true,
      live_turn_context_relation: 'coherent',
      live_turn_context_missing: false,
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }
  })
  check(
    'context_grounded_visual_asr_nomination_is_design_authority',
    selectedVisualElementAsrPlan.action === ACTIONS.OFFER_FORM &&
      selectedVisualElementAsrPlan.reason === 'design_direction_ready_for_form_offer',
    JSON.stringify(selectedVisualElementAsrPlan)
  )

  const splitReferenceArrivalPlan = deriveClosedTransitionPlan({
    message_id: 'pink-screen',
    message: 'sent a reference post: The image shows a website screenshot with a bright pink doughnut shape.',
    recent_history: [
      { role: 'user', message_id: 'pointer', text: "I'm thinking of this one" },
      { role: 'assistant', message_id: 'attachment-request', text: 'send the actual image over' },
      {
        role: 'user',
        message_id: 'pink-screen',
        text: 'sent a reference post: The image shows a website screenshot with a bright pink doughnut shape.'
      }
    ],
    structured_state: {
      tattoo_intent_active: true,
      live_turn_is_media_reference: true,
      live_turn_media_category: 'non_tattoo',
      live_turn_media_tattoo_reference: false,
      live_turn_context_relation: 'coherent',
      live_turn_context_missing: false,
      reference_media_classification_observed: true
    }
  })
  check(
    'split_client_design_pointer_plus_arriving_image_moves_to_form_offer',
    splitReferenceArrivalPlan.action === ACTIONS.OFFER_FORM &&
      splitReferenceArrivalPlan.reason === 'design_direction_ready_for_form_offer',
    JSON.stringify(splitReferenceArrivalPlan)
  )

  const jojiReferenceHistory = [
    { role: 'user', message_id: 'joji-pointer', text: "I'm thinking of this one" },
    { role: 'assistant', message_id: 'joji-reference-request', text: 'send me the actual photo or reference so i can see it' },
    {
      role: 'user',
      message_id: 'joji-image',
      text: 'sent a reference post: The image shows a screenshot of a media app displaying several portrait photos of a singer named Joji.'
    },
    { role: 'user', message_id: 'joji-apology', text: 'Sorry, my bad' },
    { role: 'assistant', message_id: 'joji-question', text: 'what part of that image or Joji were you thinking about for your piece?' }
  ]
  const jojiCreativeFreedomInput = {
    message_id: 'joji-creative',
    message: 'You can choose anything you want if its related to Joji',
    recent_history: jojiReferenceHistory.concat([
      { role: 'user', message_id: 'joji-creative', text: 'You can choose anything you want if its related to Joji' }
    ]),
    structured_state: {
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake',
      live_turn_gave_design_idea: true,
      live_turn_context_resolved_from_history: true,
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }
  }
  const jojiCreativeFreedomPlan = deriveClosedTransitionPlan(jojiCreativeFreedomInput)
  check(
    'subject_bounded_creative_freedom_overrides_non_tattoo_file_category',
    jojiCreativeFreedomPlan.action === ACTIONS.OFFER_FORM &&
      jojiCreativeFreedomPlan.reason === 'design_direction_ready_for_form_offer',
    JSON.stringify(jojiCreativeFreedomPlan)
  )
  const jojiCreativeFreedomPacket = {
    bubbles: [
      { text: 'yeah i can build a custom Joji piece from that and keep the composition open on my side' },
      { text: 'want me to send the application form over?' }
    ]
  }
  check(
    'subject_bounded_creative_freedom_form_offer_passes_closed_transition',
    evaluateClosedTransitionContract(
      jojiCreativeFreedomInput,
      jojiCreativeFreedomPacket,
      jojiCreativeFreedomPlan
    ).valid === true,
    JSON.stringify(jojiCreativeFreedomPlan)
  )

  const jojiFaceInput = {
    message_id: 'joji-face',
    message: 'At least his face needs to be included',
    recent_history: jojiCreativeFreedomInput.recent_history.concat([
      { role: 'assistant', message_id: 'joji-face-question', text: 'is there a specific part or vibe from him you want for your piece?' },
      { role: 'user', message_id: 'joji-face', text: 'At least his face needs to be included' }
    ]),
    structured_state: {
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake',
      live_turn_gave_design_idea: true,
      live_turn_context_resolved_from_history: true,
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }
  }
  const jojiFacePlan = deriveClosedTransitionPlan(jojiFaceInput)
  check(
    'required_face_element_advances_without_second_design_interview',
    jojiFacePlan.action === ACTIONS.OFFER_FORM &&
      jojiFacePlan.reason === 'design_direction_ready_for_form_offer',
    JSON.stringify(jojiFacePlan)
  )

  const supersededJojiImageInput = {
    message_id: 'joji-apology',
    message: 'Sorry, my bad',
    recent_history: jojiReferenceHistory.slice(0, 4),
    structured_state: {
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake',
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }
  }
  const supersededJojiImagePlan = deriveClosedTransitionPlan(supersededJojiImageInput)
  check(
    'requested_image_remains_design_authority_after_adjacent_apology_supersession',
    supersededJojiImagePlan.action === ACTIONS.OFFER_FORM &&
      supersededJojiImagePlan.reason === 'design_direction_ready_for_form_offer',
    JSON.stringify(supersededJojiImagePlan)
  )

  const randomImageApologyPlan = deriveClosedTransitionPlan({
    message_id: 'random-apology',
    message: 'sorry my bad',
    recent_history: [
      { role: 'assistant', message_id: 'small-talk', text: 'how has your day been?' },
      {
        role: 'user',
        message_id: 'random-image',
        text: 'sent a reference post: The image shows a dashboard screenshot with a sales chart.'
      },
      { role: 'user', message_id: 'random-apology', text: 'sorry my bad' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake',
      reference_media_classification_observed: true,
      known_reference_media_received: true,
      live_turn_context_resolved_from_history: true
    }
  })
  check(
    'random_image_apology_does_not_open_form_gate',
    randomImageApologyPlan.action === ACTIONS.GENERAL_CONTINUE &&
      randomImageApologyPlan.reason === 'non_tattoo_media_requires_contextual_host_lead',
    JSON.stringify(randomImageApologyPlan)
  )

  const acceptedDateOnlyOfferState = annotateStructuredStateForLiveTurn(
    {
      message_id: 'accepted-date-only-offer',
      text: 'Sure thing',
      received_at: '2026-08-23T06:36:08.000Z'
    },
    {
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      known_requested_date: 'august 29',
      known_requested_time: '2pm',
      last_offered_date: 'august 29',
      last_offered_time: '',
      booking_stage_hint: 'awaiting_form_identity_match',
      reference_media_classification_observed: true,
      known_reference_media_received: true,
      latest_reference_media_category: 'non_tattoo'
    },
    [
      { role: 'assistant', text: 'the earliest date i can offer is august 29' },
      { role: 'assistant', text: 'would august 29 work for you?' }
    ]
  )
  const acceptedDateOnlyOfferPlan = deriveClosedTransitionPlan({
    message_id: 'accepted-date-only-offer',
    message: 'Sure thing',
    recent_history: [
      { role: 'assistant', text: 'the earliest date i can offer is august 29' },
      { role: 'assistant', text: 'would august 29 work for you?' }
    ],
    structured_state: acceptedDateOnlyOfferState
  })
  check(
    'date_only_offer_acceptance_outranks_stale_reference_media',
    acceptedDateOnlyOfferState.live_turn_accepts_offered_slot === true &&
      acceptedDateOnlyOfferState.known_requested_date === 'august 29' &&
      acceptedDateOnlyOfferState.known_requested_time === '2pm' &&
      acceptedDateOnlyOfferPlan.action === ACTIONS.POST_FORM_IDENTITY &&
      acceptedDateOnlyOfferPlan.reason === 'accepted_slot_missing_identity',
    JSON.stringify({ state: acceptedDateOnlyOfferState, plan: acceptedDateOnlyOfferPlan })
  )

  const persistedDateOnlyOfferState = annotateStructuredStateForLiveTurn(
    {
      message_id: 'accepted-persisted-date-only-offer',
      text: 'Sure thing',
      received_at: '2026-08-23T19:22:40.000Z'
    },
    {
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Codexsoltry3',
      known_phone_used_on_form: '123123124',
      last_offered_date: 'august 30',
      last_offered_time: '',
      booking_stage_hint: 'awaiting_date',
      reference_media_classification_observed: true,
      known_reference_media_received: true,
      latest_reference_media_category: 'non_tattoo'
    },
    [
      { role: 'assistant_attempted', delivery_status: 'manychat_accepted_unverified', text: 'the earliest date i can offer is august 30' },
      { role: 'assistant_attempted', delivery_status: 'manychat_accepted_unverified', text: 'would august 30 work for you?' }
    ]
  )
  const persistedDateOnlyOfferPlan = deriveClosedTransitionPlan({
    message_id: 'accepted-persisted-date-only-offer',
    message: 'Sure thing',
    recent_history: [],
    structured_state: persistedDateOnlyOfferState
  })
  check(
    'persisted_date_only_offer_acceptance_survives_missing_delivery_boundary',
    persistedDateOnlyOfferState.live_turn_accepts_offered_slot === true &&
      persistedDateOnlyOfferState.known_requested_date === 'august 30' &&
      String(persistedDateOnlyOfferState.known_requested_time || '') === '' &&
      persistedDateOnlyOfferState.booking_stage_hint === 'awaiting_time' &&
      persistedDateOnlyOfferPlan.action === ACTIONS.POST_FORM_TIME &&
      persistedDateOnlyOfferPlan.reason === 'accepted_slot_missing_time',
    JSON.stringify({ state: persistedDateOnlyOfferState, plan: persistedDateOnlyOfferPlan })
  )

  const bookingSideQuestionPlan = deriveClosedTransitionPlan({
    message_id: 'booking-side-location',
    message: 'btw is the studio in sf?',
    recent_history: [
      { role: 'assistant', text: PREFERRED_FORM_LINK },
      { role: 'user', text: 'i sent the form' },
      { role: 'assistant', text: 'would august 29 at 2pm work?' },
      { role: 'user', message_id: 'booking-side-location', text: 'btw is the studio in sf?' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      known_requested_date: '2026-08-29',
      booking_stage_hint: 'awaiting_time'
    }
  })
  check(
    'booking_side_question_answers_then_resumes_missing_time',
    bookingSideQuestionPlan.action === ACTIONS.POST_FORM_TIME &&
      bookingSideQuestionPlan.reason === 'side_question_answer_then_resume_missing_time' &&
      bookingSideQuestionPlan.obligations.includes('answer_exact_location'),
    JSON.stringify(bookingSideQuestionPlan)
  )

  // Exact live regression 2026-08-29
  // The assistant offered September 5 6 and 7 then the client said
  // "OK then let's do weekend". Generic OK / let's-do matching once promoted
  // that coarse preference into accepted_slot_progress and the recovery asked
  // for name and phone without any accepted date. The day constraint must win
  // even when a candidate intent flag incorrectly says the slot was accepted.
  const coarseWeekendInput = {
    message_id: 'live-weekend-constraint-after-multi-offer',
    message: "OK then let's do weekend",
    received_at: '2026-08-30T00:16:02.000Z',
    recent_history: [
      { role: 'assistant_attempted', delivery_status: 'manychat_accepted_unverified', text: `Yep here is the form ${PREFERRED_FORM_LINK}` },
      { role: 'assistant_attempted', delivery_status: 'manychat_accepted_unverified', text: 'Send me a couple of dates you can do and I will check the schedule' },
      { role: 'user', text: 'How about September 3?' },
      { role: 'assistant_attempted', delivery_status: 'manychat_accepted_unverified', text: 'September 3 is too early for me' },
      { role: 'assistant_attempted', delivery_status: 'manychat_accepted_unverified', text: 'I can do Sept 5 at 2pm or Sept 6 at 2pm or Sept 7 at 2pm Which one works?' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'custom reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: false,
      booking_stage_hint: 'awaiting_form_submission',
      next_action: 'post_form_availability',
      live_turn_accepts_offered_slot: true,
      minimum_booking_date_local: 'September 5, 2026',
      close_booking_options_local: [
        'september 5 (saturday) at 2pm',
        'september 6 (sunday) at 2pm',
        'september 7 (monday) at 2pm'
      ]
    }
  }
  const coarseWeekendPlan = deriveClosedTransitionPlan(coarseWeekendInput)
  const coarseWeekendGoodPacket = goodPacketFor(coarseWeekendPlan)
  const coarseWeekendGoodVerdict = evaluateClosedTransitionContract(
    coarseWeekendInput,
    coarseWeekendGoodPacket,
    coarseWeekendPlan
  )
  const coarseWeekendBadVerdict = evaluateClosedTransitionContract(
    coarseWeekendInput,
    { bubbles: [{ text: 'I have September 5 at 2pm or September 6 at 2pm which one works?' }] },
    coarseWeekendPlan
  )
  check(
    'live_ok_then_weekend_is_one_grounded_date_not_false_slot_acceptance',
    coarseWeekendPlan.action === ACTIONS.POST_FORM_AVAILABILITY &&
      coarseWeekendPlan.reason === 'form_handoff_coarse_day_constraint_requires_grounded_slot' &&
      coarseWeekendPlan.live_intent.accepts_offered_slot === false &&
      coarseWeekendPlan.fields.last_offered_date === 'september 5' &&
      coarseWeekendPlan.fields.last_offered_time === '2pm' &&
      coarseWeekendGoodVerdict.valid === true &&
      coarseWeekendBadVerdict.valid === false &&
      coarseWeekendBadVerdict.reason === 'closed_transition_day_constraint_ungrounded_date_forbidden',
    JSON.stringify({
      plan: coarseWeekendPlan,
      good: coarseWeekendGoodVerdict,
      bad: coarseWeekendBadVerdict
    })
  )

  const bareNoonInput = {
    message: 'How about 12?',
    recent_history: [{ role: 'assistant', text: 'yeah september 5 works what time are you thinking?' }],
    structured_state: {
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      known_requested_date: 'september 5',
      known_requested_time: '',
      live_turn_time_candidate: '12pm',
      live_turn_time_status: 'too_early',
      minimum_booking_time_local: '1pm',
      booking_stage_hint: 'awaiting_time'
    }
  }
  const bareNoonPlan = deriveClosedTransitionPlan(bareNoonInput)
  const bareNoonBadVerdict = evaluateClosedTransitionContract(
    bareNoonInput,
    { bubbles: [{ text: '12 isnt open' }, { text: 'I can do September 5 at 2pm if you want that' }] },
    bareNoonPlan
  )
  const bareNoonGoodVerdict = evaluateClosedTransitionContract(
    bareNoonInput,
    { bubbles: [{ text: '12 is a little too early for me i start at 1pm would 1 or 2 work?' }] },
    bareNoonPlan
  )
  check(
    'bare_noon_time_floor_rejects_date_open_wording_and_accepts_natural_clock_wording',
    bareNoonPlan.action === ACTIONS.POST_FORM_TIME &&
      bareNoonPlan.reason === 'submitted_form_time_before_minimum' &&
      bareNoonPlan.fields.proposed_time === '12pm' &&
      bareNoonBadVerdict.valid === false &&
      bareNoonBadVerdict.reason === 'closed_transition_clock_cannot_use_date_open_wording' &&
      bareNoonGoodVerdict.valid === true,
    JSON.stringify({ bareNoonPlan, bareNoonBadVerdict, bareNoonGoodVerdict })
  )

  if (failures.length) {
    const err = new Error(`scv_closed_transition_harness_failed:${JSON.stringify(failures)}`)
    err.failures = failures
    throw err
  }
  return {
    ok: true,
    locked: true,
    lock_version: SCV_CLOSED_TRANSITION_HARNESS_VERSION,
    contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
    enumerated_states: BASE_STATES.length,
    enumerated_intents: LIVE_INTENTS.length,
    enumerated_transitions: BASE_STATES.length * LIVE_INTENTS.length,
    combination_flags: COMBINATION_FLAGS.length,
    enumerated_combination_transitions: enumeratedCombinationTransitions,
    checked
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runClosedTransitionHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      error: String(err?.message || err),
      failures: err?.failures || []
    }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  SCV_CLOSED_TRANSITION_HARNESS_VERSION,
  runClosedTransitionHarness,
  goodPacketFor
}
