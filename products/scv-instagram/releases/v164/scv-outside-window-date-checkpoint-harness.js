#!/usr/bin/env node

// Outside-window date checkpoint seal (Ben, 2026-08-27: every off-window date
// poke — "How about 30 August?" — livelocked the model lane against the
// anchored-alternative contract and shipped the canned fallback, repeatedly, at
// the same funnel step). The controller owns every fact of this move, so the
// decline + single grounded alternative is now a deterministic fixed checkpoint.
// This harness proves the fixed packet satisfies the REAL closed-transition
// contract, not just its own template.

const assert = require('assert')
const {
  buildDeterministicBookingPacket,
  enforceNoCommaAndPeriodSurfaceText
} = require('./codex-dm-runner.js')
const {
  deriveClosedTransitionPlan,
  evaluateClosedTransitionContract
} = require('./scv-closed-transition-contract.js')

let checked = 0
function check(name, value) { assert.ok(value, name); checked += 1 }

function outsideWindowInput(fields = {}) {
  const plan = {
    action: 'post_form_availability',
    reason: 'submitted_form_date_counterproposal_outside_window',
    obligations: [],
    fields: {
      proposed_date: '30 August',
      last_offered_date: '',
      last_offered_time: '',
      earliest_booking_option: 'September 3',
      minimum_booking_date: 'September 3',
      close_booking_options: ['September 3', 'September 4'],
      ...fields
    }
  }
  return {
    message_id: 'legacy-manychat-owd0000000000000000000000000000000',
    contact_id: '9999999997', thread_id: '9999999997',
    live_message: 'How about 30 August?',
    message: 'How about 30 August?',
    recent_history: [
      { role: 'assistant', message_id: 'a1', text: 'Which of these 2pm slots works for you Sep 3 Sep 4 Sep 5 or Sep 6' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      form_link_sent: true,
      form_offer_asked: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      live_turn_date_phrase: '30 August',
      live_turn_date_status: 'below_minimum'
    },
    control_transition_contract: plan
  }
}

// --- earliest-opening anchor (no last offered slot yet) ---
const earliest = buildDeterministicBookingPacket(outsideWindowInput())
check('checkpoint_fires_for_outside_window_proposal', Boolean(earliest))
check('checkpoint_is_fixed_booking_executor',
  earliest?.authority?.executor === 'deterministic_fixed_booking_checkpoint')
const earliestText = (earliest?.packet?.bubbles || []).map((b) => b.text).join(' ')
check('checkpoint_declines_proposal', /30 August is too soon/i.test(earliestText))
check('checkpoint_offers_single_grounded_alternative',
  /September 3/.test(earliestText) && !/September 4/.test(earliestText))
check('checkpoint_asks_for_confirmation', /does .*work for you/i.test(earliestText))
check('checkpoint_has_no_dash', !/[‐-―−]/.test(earliestText))
const earliestVerdict = evaluateClosedTransitionContract(
  outsideWindowInput(),
  earliest.packet,
  outsideWindowInput().control_transition_contract
)
check('checkpoint_passes_real_closed_transition_contract',
  earliestVerdict.valid === true)

// --- last-offered-slot anchor takes priority and keeps its exact time ---
const anchored = buildDeterministicBookingPacket(outsideWindowInput({
  last_offered_date: 'September 6',
  last_offered_time: '2pm'
}))
const anchoredText = (anchored?.packet?.bubbles || []).map((b) => b.text).join(' ')
check('last_offered_slot_anchor_preferred',
  /September 6 at 2pm/.test(anchoredText) && !/September 3/.test(anchoredText))
const anchoredVerdict = evaluateClosedTransitionContract(
  outsideWindowInput({ last_offered_date: 'September 6', last_offered_time: '2pm' }),
  anchored.packet,
  outsideWindowInput({ last_offered_date: 'September 6', last_offered_time: '2pm' }).control_transition_contract
)
check('anchored_checkpoint_passes_real_contract', anchoredVerdict.valid === true)

// --- ordinary in-window turns never trigger the fixed decline ---
const ordinary = buildDeterministicBookingPacket({
  ...outsideWindowInput(),
  control_transition_contract: { action: 'post_form_availability', reason: 'submitted_form_missing_date', obligations: [], fields: {} }
})
check('in_window_turn_not_hijacked',
  !ordinary || ordinary?.authority?.route_lock !== 'submitted_form_date_counterproposal_outside_window_fixed_decline')

// --- exact live relative-date regression with no pre-seeded policy snapshot ---
const relativeDateInput = {
  message_id: 'legacy-manychat-relative-tomorrow-20260829',
  contact_id: '1537753982',
  thread_id: '1537753982',
  live_message: 'How about tomorrow?',
  message: 'How about tomorrow?',
  received_at: '2026-08-29T23:24:47.764Z',
  recent_history: [
    { role: 'assistant', message_id: 'a-relative-1', text: 'what dates are you thinking' }
  ],
  structured_state: {
    tattoo_intent_active: true,
    form_link_sent: true,
    form_offer_asked: true,
    form_submitted: true,
    booking_stage_hint: 'awaiting_date'
  }
}
const relativePlan = deriveClosedTransitionPlan(relativeDateInput)
check('relative_tomorrow_routes_outside_window',
  relativePlan.action === 'post_form_availability' &&
  relativePlan.reason === 'submitted_form_date_counterproposal_outside_window' &&
  relativePlan.fields.proposed_date.toLowerCase() === 'tomorrow')
check('relative_tomorrow_derives_durable_minimum_anchor',
  relativePlan.fields.minimum_booking_date === 'september 5' &&
  /september 5/i.test(relativePlan.fields.earliest_booking_option) &&
  relativePlan.fields.close_booking_options.some((value) => /september 5/i.test(value)))
const relativeInputWithPlan = {
  ...relativeDateInput,
  control_transition_contract: relativePlan
}
const relativeCheckpoint = buildDeterministicBookingPacket(relativeInputWithPlan)
const relativeText = (relativeCheckpoint?.packet?.bubbles || []).map((bubble) => bubble.text).join('\n')
check('relative_tomorrow_emits_immediate_grounded_checkpoint',
  Boolean(relativeCheckpoint) && /tomorrow/i.test(relativeText) && /september 5/i.test(relativeText))
check('relative_tomorrow_does_not_replay_form_receipt',
  !/form|submitted|received|got it|i have that/i.test(relativeText))
check('relative_tomorrow_surface_has_no_comma_or_terminal_period',
  !/[,，]/.test(relativeText) && !/[.。．]+\s*(?:\n|$)/m.test(relativeText))
const relativeVerdict = evaluateClosedTransitionContract(
  relativeInputWithPlan,
  relativeCheckpoint.packet,
  relativePlan
)
check('relative_tomorrow_checkpoint_passes_real_contract', relativeVerdict.valid === true)

const punctuationProbe = enforceNoCommaAndPeriodSurfaceText('Got it, I saw it.\nOkay, sure...')
check('surface_punctuation_rule_is_deterministic',
  punctuationProbe === 'Got it I saw it\nOkay sure')

console.log(`scv-outside-window-date-checkpoint-harness ok checks=${checked}`)
