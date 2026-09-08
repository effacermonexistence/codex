#!/usr/bin/env node

// v165: exact owner-approved checkpoint copy. The field labels remain the
// booking contract; only the human-facing nudge and question copy may change.
const assert = require('assert')
const {
  CHECKPOINT_NEUTRAL_NUDGES,
  buildDeterministicRecoveryPacket,
  buildRouteAwareVisibleRecoveryPacket
} = require('./scv-deterministic-recovery.js')
const { packetHasNamePhoneDateTimeDoubleCheck } = require('./scv-contract-harness.js')
const { extractVisibleAssistantDoubleCheckFields } = require('./scv-booking-identity.js')

const EXPECTED_NUDGES = [
  "everything above is exactly as is 🖤 just say the word if it's right, or tell me what to switch",
  'all good on my end, nothing moved — lmk if it all looks right or if you wanna change anything',
  "got you! the details above are still the same, just tell me if they look right or what you\'d change"
]
const QUESTION = "can you give this a quick look and make sure it\'s all right? 🖤"
const OLD_QUESTION = 'can you double check this just to make sure'

assert.deepStrictEqual(CHECKPOINT_NEUTRAL_NUDGES, EXPECTED_NUDGES, 'v165 nudge copy drifted')

const checkpointPlan = {
  action: 'double_check',
  reason: 'all_four_fields_known',
  obligations: [],
  fields: { name: 'Mina', phone: '4157602883', date: 'August 30', time: '2pm' }
}
const checkpoint = buildDeterministicRecoveryPacket({
  contact_id: '1537753982',
  thread_id: '1537753982',
  live_message: 'yes',
  structured_state: { form_submitted: true, form_link_sent: true },
  control_transition_contract: checkpointPlan
}, checkpointPlan)
const checkpointText = checkpoint?.bubbles?.[0]?.text || ''
assert.strictEqual(
  checkpointText,
  `Name : Mina\nPhone Number : 4157602883\nAppointment date : August 30\nTime : 2pm\n\n${QUESTION}`,
  'v165 four-field checkpoint copy drifted'
)
assert.ok(packetHasNamePhoneDateTimeDoubleCheck(checkpoint), 'field-label double-check contract regressed')
assert.ok(!checkpointText.includes(OLD_QUESTION), 'old generic double-check copy survived')
assert.deepStrictEqual(
  extractVisibleAssistantDoubleCheckFields(checkpointText),
  { name: 'Mina', phone: '4157602883', date_text: 'August 30', time_text: '2pm' },
  'v165 checkpoint must remain reconstructable from visible history'
)

const nudgePlan = { action: 'await_double_check_confirmation', reason: 'ordinary_confirmation_wait', obligations: [], fields: {} }
const nudge = buildRouteAwareVisibleRecoveryPacket({
  contact_id: '1537753982',
  thread_id: '1537753982',
  live_message: 'hmm',
  structured_state: {},
  control_transition_contract: nudgePlan
}, nudgePlan)
assert.ok(EXPECTED_NUDGES.includes(nudge?.bubbles?.[0]?.text), 'checkpoint nudge did not use the approved copy')

console.log('scv-checkpoint-human-wording-harness ok checks=6')
