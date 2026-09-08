#!/usr/bin/env node

// Known-field re-ask feedback seal (incident 2026-08-26): a client sent a tattoo
// reference, the state marked design_direction known, and every model candidate
// then listed design_direction in questioned_fields. The verifier rejected each
// as known_field_reasked, but the reauthor lock carried only the opaque label,
// so the model repeated the behavior until exhaustion and the canned fallback
// shipped (same failure shape as the v94 size livelock). This harness seals the
// explicit prose that tells the author exactly what to change.

const assert = require('assert')
const { buildCumulativePostFilterReauthorLock } = require('./codex-dm-runner.js')

let checked = 0
function check(name, value) { assert.ok(value, name); checked += 1 }

const input = {
  live_message: 'I am thinking of this one',
  recent_history: [],
  structured_state: { known_client_anchored_inspiration: true },
  control_transition_contract: { action: 'offer_form', reason: 'design_anchored', obligations: [] }
}

const fieldLock = buildCumulativePostFilterReauthorLock(input, '', [
  { reason: 'known_field_reasked:design_direction', instruction: '' }
])
check('lock_names_the_settled_field', fieldLock.includes('design_direction'))
check('lock_carries_explicit_settled_prose', fieldLock.includes('KNOWN FIELD SETTLED EXECUTOR LOCK'))
check('lock_directs_statement_over_question', /statement/.test(fieldLock) && /questioned_fields/.test(fieldLock))
check('lock_directs_acknowledged_fields', fieldLock.includes('acknowledged_fields'))

const bareLock = buildCumulativePostFilterReauthorLock(input, '', [
  { reason: 'after_reauthor_known_field_reasked', instruction: '' }
])
check('bare_reason_still_gets_explicit_prose', bareLock.includes('KNOWN FIELD SETTLED EXECUTOR LOCK'))

const noPlanLock = buildCumulativePostFilterReauthorLock(
  { ...input, control_transition_contract: null },
  '',
  [{ reason: 'known_field_reasked:reference_media', instruction: '' }]
)
check('lock_present_without_transition_plan',
  noPlanLock.includes('KNOWN FIELD SETTLED EXECUTOR LOCK') && noPlanLock.includes('reference_media'))

const unrelated = buildCumulativePostFilterReauthorLock(input, '', [
  { reason: 'self_contained_turn_repeats_recent_followup_function', instruction: '' }
])
check('unrelated_rejection_not_polluted', !unrelated.includes('KNOWN FIELD SETTLED EXECUTOR LOCK'))

// --- greeting-return + unsolicited-rate feedback (fresh-thread livelock 2026-08-27) ---
const { packetReturnsFreshGreeting } = require('./scv-contract-harness.js')
const bubbleOf = (text) => ({ bubbles: [{ text }] })
check('greeting_function_opener_counts', packetReturnsFreshGreeting(bubbleOf('Great to hear from you')))
check('nice_to_hear_counts', packetReturnsFreshGreeting(bubbleOf('Nice to hear from you new info time')))
check('literal_hey_still_counts', packetReturnsFreshGreeting(bubbleOf('Hey nice to hear from you')))
check('thanks_for_reaching_out_counts', packetReturnsFreshGreeting(bubbleOf('thanks for reaching out about the piece')))
check('hey_there_still_excluded', !packetReturnsFreshGreeting(bubbleOf('Hey there')))
check('non_greeting_still_missing', !packetReturnsFreshGreeting(bubbleOf('Tell me a vibe or reference')))

const guardVerdict = (labels) => ({
  reason: 'non_authoring_guard_requires_model_reauthor',
  instruction: `The rejected draft violated these semantic guards: ${labels}.`
})
const greetingLock = buildCumulativePostFilterReauthorLock(input, '', [guardVerdict('fresh_greeting_missing')])
check('greeting_rejection_gets_explicit_prose', greetingLock.includes('GREETING RETURN EXECUTOR LOCK'))
const rateLock = buildCumulativePostFilterReauthorLock(input, '', [guardVerdict('funnel_order_violation, funnel_order_unsolicited_hourly_rate')])
check('unsolicited_rate_rejection_gets_explicit_prose', rateLock.includes('NO UNSOLICITED PRICING EXECUTOR LOCK'))
const otherLock = buildCumulativePostFilterReauthorLock(input, '', [guardVerdict('one_shot_checkpoint_violation')])
check('unrelated_guard_not_polluted',
  !otherLock.includes('GREETING RETURN EXECUTOR LOCK') && !otherLock.includes('NO UNSOLICITED PRICING EXECUTOR LOCK'))

// --- enthusiastic consent + action-owned re-ask exemption (live 2026-08-27) ---
const { shouldSendFormNow } = require('./scv-contract-harness.js')
const consentInput = (text) => ({
  live_message: text,
  message: text,
  recent_history: [
    { role: 'assistant', message_id: 'a1', text: 'want me to send you the application form so we can check dates after you submit' }
  ],
  structured_state: { form_offer_asked: true }
})
check('hell_yeah_is_form_consent', shouldSendFormNow(consentInput('Hell, yeah')))
check('fuck_yeah_is_form_consent', shouldSendFormNow(consentInput('fuck yeah send it')))
check('lets_do_it_is_form_consent', shouldSendFormNow(consentInput("let's do it")))
check('yes_please_still_consent', shouldSendFormNow(consentInput('Yes, please')))
check('hell_no_is_not_consent', !shouldSendFormNow(consentInput('hell no')))
check('question_is_not_consent', !shouldSendFormNow(consentInput('hell yeah?')))

const { validateStructuredOutputContract } = require('./scv-structured-output-contract.js')
const reofferPacket = {
  bubbles: [{ text: 'want me to send the form over' }],
  reply_text: 'want me to send the form over',
  acknowledged_fields: [],
  questioned_fields: ['form_offer'],
  next_action_reflected: 'offer_form'
}
const reofferVerdict = validateStructuredOutputContract(
  { structured_state: { form_offer_asked: true } },
  reofferPacket,
  { action: 'offer_form' }
)
check('route_owned_field_reask_allowed', reofferVerdict.valid === true)
const foreignVerdict = validateStructuredOutputContract(
  { structured_state: { form_offer_asked: true, known_client_anchored_inspiration: true } },
  { ...reofferPacket, questioned_fields: ['design_direction'] },
  { action: 'offer_form' }
)
check('non_owned_known_field_still_protected',
  foreignVerdict.valid === false && foreignVerdict.failures.includes('known_field_reasked:design_direction'))

console.log(`scv-known-field-reask-feedback-harness ok checks=${checked}`)
