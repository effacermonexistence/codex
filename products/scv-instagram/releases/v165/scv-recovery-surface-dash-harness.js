#!/usr/bin/env node

// Recovery surface dash seal (incident 2026-08-26): the model lane strips every
// dash via enforceNoDashSurfaceText, but deterministic recovery bubbles are
// validated against their exact template strings and bypass that chain, so an
// em dash baked into a template shipped straight to Instagram. This harness
// seals every deterministic recovery surface to the same no-dash persona rule
// and proves the exact-match validators still adopt the sealed templates.

const assert = require('assert')
const {
  SAFE_CLARIFICATION_TEXT,
  buildSafeClarificationRecoveryPacket,
  buildRouteAwareVisibleRecoveryPacket,
  isSafeClarificationRecoveryPacket,
  isRouteAwareVisibleRecoveryPacket
} = require('./scv-deterministic-recovery.js')

let checked = 0
function check(name, value) { assert.ok(value, name); checked += 1 }

// Same forbidden set as FORBIDDEN_DM_DASH_CHARS_RE in codex-dm-runner.js.
const FORBIDDEN_DASH_RE = /[-‐‑‒–—―−﹘﹣－]/
const FORBIDDEN_OWNER_PUNCTUATION_RE = /,|\.\s*$/
function packetSurfaces(packet) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  return [...bubbles.map((b) => String(b?.text || '')), String(packet?.reply_text || '')]
}

const ROUTE_ACTIONS = [
  'offer_form', 'clarify_form_permission', 'post_form_availability',
  'post_form_time', 'post_form_identity', 'accepted_slot_progress',
  'send_form', 'await_double_check_confirmation',
  'deposit_hold', 'deposit_pending_continue',
  'general_continue'
]

function baseInput(extraState = {}) {
  return {
    contact_id: '1537753982',
    thread_id: '1537753982',
    live_message: 'hey what is going on',
    recent_history: [],
    structured_state: { ...extraState }
  }
}

for (const text of Object.values(SAFE_CLARIFICATION_TEXT)) {
  check(`safe_clarification_text_has_no_dash:${text.slice(0, 24)}`, !FORBIDDEN_DASH_RE.test(text))
}

const genericSafe = buildSafeClarificationRecoveryPacket(baseInput())
check('safe_clarification_packet_surfaces_dash_free',
  packetSurfaces(genericSafe).every((t) => !FORBIDDEN_DASH_RE.test(t)))
check('safe_clarification_validator_still_adopts', isSafeClarificationRecoveryPacket(genericSafe))
const voiceSafe = buildSafeClarificationRecoveryPacket(baseInput({ live_turn_voice_transcribe_failed: true }))
check('voice_safe_clarification_dash_free',
  packetSurfaces(voiceSafe).every((t) => !FORBIDDEN_DASH_RE.test(t)))
check('voice_safe_clarification_validator_still_adopts', isSafeClarificationRecoveryPacket(voiceSafe))

for (const action of ROUTE_ACTIONS) {
  const plans = [{ action, reason: 'verifier_exhausted', obligations: [] }]
  if (action === 'send_form') {
    plans.push({ action, reason: 'verifier_exhausted', obligations: [], fields: { asks_price: true } })
  }
  if (action === 'post_form_time') {
    plans.push({ action, reason: 'verifier_exhausted', obligations: [], fields: { appointment_date: 'august 29' } })
  }
  for (const plan of plans) {
    const input = { ...baseInput(), control_transition_contract: plan }
    const packet = buildRouteAwareVisibleRecoveryPacket(input, plan)
    check(`route_recovery_dash_free:${action}`,
      packetSurfaces(packet).every((t) => !FORBIDDEN_DASH_RE.test(t)))
    check(`route_recovery_owner_punctuation_clean:${action}`,
      packetSurfaces(packet).every((t) => !FORBIDDEN_OWNER_PUNCTUATION_RE.test(t)))
    check(`route_recovery_validator_still_adopts:${action}`,
      isRouteAwareVisibleRecoveryPacket(packet, input, plan))
  }
}

const weekendPlan = {
  action: 'post_form_availability',
  reason: 'form_handoff_coarse_day_constraint_requires_grounded_slot',
  obligations: [],
  fields: { last_offered_date: 'september 5', last_offered_time: '2pm' }
}
const weekendInput = { ...baseInput(), live_message: "OK then let's do weekend", control_transition_contract: weekendPlan }
const weekendPacket = buildRouteAwareVisibleRecoveryPacket(weekendInput, weekendPlan)
check('weekend_recovery_keeps_one_grounded_slot',
  weekendPacket.bubbles.length === 1 &&
  weekendPacket.bubbles[0].text === 'i can do september 5 at 2pm for the weekend does that work for you?' &&
  weekendPacket.questioned_fields.length === 1 &&
  weekendPacket.questioned_fields[0] === 'appointment_date')
check('weekend_recovery_validator_still_adopts',
  isRouteAwareVisibleRecoveryPacket(weekendPacket, weekendInput, weekendPlan))

const acceptedSlotPlan = {
  action: 'post_form_identity',
  reason: 'accepted_slot_missing_identity',
  obligations: [],
  fields: { date: 'september 5', time: '2pm' }
}
const acceptedSlotInput = {
  ...baseInput({
    form_submitted: true,
    known_requested_date: 'september 5',
    known_requested_time: '2pm'
  }),
  live_message: 'yeah sure',
  control_transition_contract: acceptedSlotPlan
}
const acceptedSlotPacket = buildRouteAwareVisibleRecoveryPacket(
  acceptedSlotInput,
  acceptedSlotPlan
)
check('accepted_slot_recovery_keeps_date_time_and_moves_to_identity',
  acceptedSlotPacket.bubbles.length === 1 &&
  acceptedSlotPacket.bubbles[0].text ===
    'perfect september 5 at 2pm works what name and phone number did you use on the form?')
check('accepted_slot_recovery_has_no_false_lock_or_verification_language',
  !/locked|nothing is|while i verify|haven.?t changed/i.test(acceptedSlotPacket.reply_text))
check('accepted_slot_recovery_validator_still_adopts',
  isRouteAwareVisibleRecoveryPacket(acceptedSlotPacket, acceptedSlotInput, acceptedSlotPlan))

const pricingRecoveryPlan = {
  action: 'general_continue',
  reason: 'direct_price_question',
  obligations: ['answer_model_rate'],
  fields: {}
}
const pricingRecoveryInput = {
  ...baseInput(),
  live_message: 'how much is it',
  control_transition_contract: pricingRecoveryPlan
}
const pricingRecoveryPacket = buildRouteAwareVisibleRecoveryPacket(
  pricingRecoveryInput,
  pricingRecoveryPlan
)
check('pricing_recovery_carries_all_three_rate_facts',
  /discounted model rate/i.test(pricingRecoveryPacket.reply_text) &&
  /\$150 per hour/i.test(pricingRecoveryPacket.reply_text) &&
  /finished piece stays in my style/i.test(pricingRecoveryPacket.reply_text))
check('pricing_recovery_validator_still_adopts',
  isRouteAwareVisibleRecoveryPacket(pricingRecoveryPacket, pricingRecoveryInput, pricingRecoveryPlan))

const retailReferencePlan = {
  action: 'offer_form',
  reason: 'design_direction_ready_for_form_offer',
  obligations: []
}
const retailReferenceInput = {
  ...baseInput({ live_turn_is_media_reference: true }),
  live_message: 'sent a reference post: grocery shelves with canned soup and price tags',
  control_transition_contract: retailReferencePlan
}
const retailReferencePacket = buildRouteAwareVisibleRecoveryPacket(
  retailReferenceInput,
  retailReferencePlan
)
check('media_offer_recovery_acknowledges_reference_before_form',
  retailReferencePacket.bubbles.length === 1 &&
  retailReferencePacket.bubbles[0].text ===
    'yeah we can use that as a starting point and make it custom in my style want me to send the application form?')
check('media_offer_recovery_validator_still_adopts',
  isRouteAwareVisibleRecoveryPacket(retailReferencePacket, retailReferenceInput, retailReferencePlan))

// The full template source must stay clean too, including strings a builder
// only reaches under states this fixture does not enumerate.
const fs = require('fs')
const path = require('path')
const recoverySource = fs.readFileSync(path.join(__dirname, 'scv-deterministic-recovery.js'), 'utf8')
check('recovery_source_has_no_em_or_en_dash', !/[‐-―−]/.test(recoverySource))

console.log(`scv-recovery-surface-dash-harness ok checks=${checked}`)
