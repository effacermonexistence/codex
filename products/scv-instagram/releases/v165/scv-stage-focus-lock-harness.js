#!/usr/bin/env node

// Stage focus seal (Ben directive 2026-08-27): once the funnel is past design,
// the author may not re-raise the reference/design/vibe unless the client's
// live turn does. Three live date-negotiation replies opened with reference
// acknowledgments before this lock existed.

const assert = require('assert')
const {
  enforceStageFocusLock,
  buildCumulativePostFilterReauthorLock
} = require('./codex-dm-runner.js')

let checked = 0
function check(name, value) { assert.ok(value, name); checked += 1 }

function packetOf(...texts) {
  return {
    bubbles: texts.map((text) => ({ text, delay_ms: 0 })),
    non_authoring_surface_mutations: []
  }
}
function dateInput(liveText, action = 'post_form_availability') {
  return {
    live_message: liveText,
    message: liveText,
    recent_history: [],
    structured_state: { form_submitted: true, booking_stage_hint: 'awaiting_date' },
    control_transition_contract: { action, reason: 'x', obligations: [] }
  }
}

// The live incident shape: date turn, reply opens with reference acknowledgment.
const incident = enforceStageFocusLock(
  dateInput('How about 29 August?'),
  packetOf('Nice reference thanks for sharing the vibe', '29 August is too soon the next available is Sept 6 at 2pm', 'Does Sept 6 at 2pm work for you')
)
check('reference_ack_bubble_removed',
  incident.bubbles.every((b) => !/reference|sharing the vibe/i.test(b.text)))
check('date_content_survives',
  incident.bubbles.some((b) => /Sept 6 at 2pm/.test(b.text)))
check('mutation_marked',
  incident.non_authoring_surface_mutations.includes('stage_regression_reference_mention'))

// Mixed bubble: regression sentence dies, current-step sentence in the SAME
// bubble survives (sentence surgical).
const mixed = enforceStageFocusLock(
  dateInput('what about the 30th'),
  packetOf('Got it I see the reference and the form is in. 30 August is too soon for scheduling.')
)
check('mixed_bubble_keeps_date_sentence',
  mixed.bubbles.length === 1 && /30 August is too soon/.test(mixed.bubbles[0].text) &&
  !/reference/i.test(mixed.bubbles[0].text))

// Client brought the reference up themselves: untouched.
const clientRaised = enforceStageFocusLock(
  dateInput('wait can we adjust the reference design a bit'),
  packetOf('yeah we can adjust the reference before the session', 'Sept 6 still works for that')
)
check('client_raised_reference_untouched',
  clientRaised.bubbles.length === 2 &&
  clientRaised.non_authoring_surface_mutations.length === 0)

// Design stage itself: lock inactive.
const designStage = enforceStageFocusLock(
  dateInput('I am thinking of this one', 'design_intake'),
  packetOf('love that reference direction', 'want me to send the form')
)
check('design_stage_not_locked',
  designStage.bubbles.length === 2 && designStage.non_authoring_surface_mutations.length === 0)

// Reauthor prose for the label.
const prose = buildCumulativePostFilterReauthorLock(dateInput('How about 29 August?'), '', [{
  reason: 'non_authoring_guard_requires_model_reauthor',
  instruction: 'The rejected draft violated these semantic guards: stage_regression_reference_mention.'
}])
check('stage_focus_rejection_gets_explicit_prose', prose.includes('STAGE FOCUS EXECUTOR LOCK'))

// --- repeated form-ack regression (live 2026-08-27: "31st 되냐?" answered with
// "I got your form thanks for submitting it", the SECOND ack, at a date turn) ---
function dateInputWithAckHistory(liveText) {
  return {
    ...dateInput(liveText),
    recent_history: [
      { role: 'assistant', message_id: 'a1', text: 'Got it I have your form submission thanks' },
      { role: 'assistant', message_id: 'a2', text: 'Which of these 2pm slots works for you Sep 3 Sep 4 Sep 5 Sep 6' }
    ]
  }
}
const ackRepeat = enforceStageFocusLock(
  dateInputWithAckHistory('Then how about 31st?'),
  packetOf('I got your form thanks for submitting it', 'earliest available is Sep 3 at 2pm', 'which works for you')
)
check('repeated_form_ack_removed',
  ackRepeat.bubbles.every((b) => !/form/i.test(b.text)))
check('repeated_form_ack_keeps_date_content',
  ackRepeat.bubbles.some((b) => /Sep 3 at 2pm/.test(b.text)))
check('repeated_form_ack_mutation_marked',
  ackRepeat.non_authoring_surface_mutations.includes('stage_regression_form_ack_repeat'))

// The FIRST ack (no prior visible ack in history) stays untouched.
const firstAck = enforceStageFocusLock(
  dateInput('I just submitted'),
  packetOf('Got it I have your form submission', 'what dates work for you')
)
check('first_form_ack_untouched',
  firstAck.bubbles.length === 2 && firstAck.non_authoring_surface_mutations.length === 0)

// Client asked about the form themselves: ack allowed even after a prior ack.
const clientAskedForm = enforceStageFocusLock(
  dateInputWithAckHistory('did you get my form?'),
  packetOf('yes I got your form', 'Sep 3 at 2pm still open')
)
check('client_form_question_ack_untouched',
  clientAskedForm.bubbles.length === 2 && clientAskedForm.non_authoring_surface_mutations.length === 0)

console.log(`scv-stage-focus-lock-harness ok checks=${checked}`)

// --- empty labeled checkpoint guard (live 2026-08-27 21:29) ---
const { enforceNoEmptyLabeledCheckpoint } = require('./codex-dm-runner.js')
const emptyBlock = enforceNoEmptyLabeledCheckpoint(
  dateInput('Definitely', 'accepted_slot_progress'),
  packetOf('Name\nPhone\nAppointment date\nSeptember 3\nAppointment time\n2:00 PM')
)
check('empty_name_phone_labels_stripped',
  emptyBlock.bubbles.every((b) => !/^\s*(?:name|phone)\s*$/im.test(b.text)))
check('empty_label_mutation_marked',
  emptyBlock.non_authoring_surface_mutations.includes('empty_labeled_checkpoint_block'))
const filledBlock = enforceNoEmptyLabeledCheckpoint(
  dateInput('Definitely', 'accepted_slot_progress'),
  packetOf('Name : Codex 09\nPhone Number : 1231234213\nAppointment date : September 3\nTime : 2 PM\n\ncan you give this a quick look and make sure it\'s all right? 🖤')
)
check('filled_labeled_checkpoint_untouched',
  filledBlock.bubbles.length === 1 && filledBlock.non_authoring_surface_mutations.length === 0)
const emptyProse = buildCumulativePostFilterReauthorLock(dateInput('Definitely'), '', [{
  reason: 'non_authoring_guard_requires_model_reauthor',
  instruction: 'The rejected draft violated these semantic guards: empty_labeled_checkpoint_block.'
}])
check('empty_label_rejection_gets_explicit_prose', emptyProse.includes('NO EMPTY LABELED BLOCK EXECUTOR LOCK'))
console.log('empty-label checks appended ok')

// --- double-check must ask + loose handle claim (live 2026-08-27 21:29) ---
const { enforceDoubleCheckConfirmationAsk } = require('./codex-dm-runner.js')
const askless = enforceDoubleCheckConfirmationAsk(
  dateInput('Definitely', 'accepted_slot_progress'),
  packetOf('Name: Codex saw 10', 'Phone: 1231234213', 'Appointment date: September 3', 'Appointment time: 2 PM')
)
check('askless_double_check_rejected',
  askless.non_authoring_surface_mutations.includes('double_check_missing_confirmation_ask'))
const withAsk = enforceDoubleCheckConfirmationAsk(
  dateInput('Definitely', 'accepted_slot_progress'),
  packetOf('Name : Codex saw 10\nPhone Number : 1231234213\nAppointment date : September 3\nTime : 2 PM\n\ncan you give this a quick look and make sure it\'s all right? 🖤')
)
check('double_check_with_ask_untouched', withAsk.non_authoring_surface_mutations.length === 0)
const nonCheckpoint = enforceDoubleCheckConfirmationAsk(
  dateInput('Definitely'),
  packetOf('Sept 3 at 2pm locked in for you')
)
check('non_checkpoint_reply_untouched', nonCheckpoint.non_authoring_surface_mutations.length === 0)
const askProse = buildCumulativePostFilterReauthorLock(dateInput('Definitely'), '', [{
  reason: 'non_authoring_guard_requires_model_reauthor',
  instruction: 'The rejected draft violated these semantic guards: double_check_missing_confirmation_ask.'
}])
check('double_check_ask_rejection_gets_explicit_prose', askProse.includes('DOUBLE CHECK MUST ASK EXECUTOR LOCK'))
console.log('double-check-ask checks appended ok')
