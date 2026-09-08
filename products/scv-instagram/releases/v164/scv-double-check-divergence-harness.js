#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  calendarBookingProposalFrame,
  clockTimeBookingProposalFrame
} = require('./scv-booking-policy.js')
const {
  buildStructuredState,
  annotateStructuredStateForLiveTurn
} = require('./dm-authority.js')
const {
  deriveClosedTransitionPlan,
  evaluateClosedTransitionContract
} = require('./scv-closed-transition-contract.js')
const {
  buildDeterministicRecoveryPacket,
  buildDoubleCheckRevisionAskPacket,
  buildRouteAwareVisibleRecoveryPacket,
  isRouteAwareVisibleRecoveryPacket
} = require('./scv-deterministic-recovery.js')
const {
  ensureControlDirs,
  appendControlHistoryEvent,
  recordIngressEvent,
  executeSingleControlTurn,
  liveBookingIdentityAnswer
} = require('./scv-single-control-plane.js')

const retiredTemplate = /haven'?t changed or confirmed the booking|what detail do you want me to update|i saw that and i haven/i
const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, pass: Boolean(condition), detail: String(detail || '') })
  assert.ok(condition, `${name} :: ${detail}`)
}

const dateFrames = [
  'We can definitely do September 8',
  'we can really do september 8',
  'make it September 8',
  'switch it to September 8',
  'September 8 instead',
  'actually September 8',
  'Appointment date: September 8'
]
for (const text of dateFrames) {
  const frame = calendarBookingProposalFrame(text, { allowBareDate: true })
  check(`date_revision_${text}`, frame.proposal === true && /september 8/i.test(frame.candidate_text), JSON.stringify(frame))
}

const timeFrames = [
  'Can we do 3 PM?',
  'can we definitely do 3 p.m.?',
  'actually 3pm',
  '3pm instead',
  'could we move it to 3pm',
  'make it 3pm',
  'Time: 3pm'
]
for (const text of timeFrames) {
  const frame = clockTimeBookingProposalFrame(text, { allowBareTime: true })
  check(`time_revision_${text}`, frame.proposal === true && /3\s*p\.?m/i.test(frame.candidate_text), JSON.stringify(frame))
}

// Inductive family matrix: these are grammar classes, not incident-string
// aliases. Vary modal, filler, action, punctuation, casing, labels, and suffixes
// so a future wording change cannot silently collapse back to an exact-phrase
// detector.
const dateRevisionFamilies = [
  ...['can', 'could', 'would', 'should'].flatMap((modal) => [
    `${modal} we do September 8?`,
    `${modal} we definitely do September 8?`,
    `${modal} we really make it September 8?`
  ]),
  'WE CAN ABSOLUTELY DO SEPTEMBER 8!!!',
  'we could maybe schedule September 8, please',
  'move the appointment to September 8',
  'reschedule it for September 8',
  'change the date to September 8',
  'go with September 8 instead',
  'September 8 works for us',
  'would September 8 work?',
  'the appointment date is September 8'
]
for (const text of dateRevisionFamilies) {
  const frame = calendarBookingProposalFrame(text, { allowBareDate: true })
  check(`date_family_${text}`, frame.proposal === true, JSON.stringify(frame))
}

const timeRevisionFamilies = [
  ...['can', 'could', 'would', 'should'].flatMap((modal) => [
    `${modal} we do 3pm?`,
    `${modal} we definitely do 3 p.m.?`,
    `${modal} we really move it to 3:00 PM?`
  ]),
  'CAN WE ABSOLUTELY DO 3 PM!!!',
  'we could maybe schedule it for 3pm, please',
  'move the appointment to 3pm',
  'switch the time to 3 p.m.',
  'change it to 3:00pm',
  'go with 3pm instead',
  '3pm works for us',
  'would 3pm work?',
  'the appointment time is 3pm'
]
for (const text of timeRevisionFamilies) {
  const frame = clockTimeBookingProposalFrame(text, { allowBareTime: true })
  check(`time_family_${text}`, frame.proposal === true, JSON.stringify(frame))
}

// 2026-09-02 live incident (Omar.system): "Can we actually do 3 PM?" at the open
// four-field checkpoint was not a time revision because the modal frame did not
// accept the discourse filler "actually"; the controller froze on the
// confirmation wait and shipped a fixed recovery template after three model
// passes. Fillers are a grammar class, and a suffixless hour inside the open
// checkpoint is a clock candidate on the tattoo-day clock.
const fillerRevisionFamilies = [
  'Can we actually do 3 PM?',
  'can we actually do 3pm',
  'could we honestly just do 3 pm',
  'can we like do 3pm instead',
  'could we maybe actually do 3:30pm',
  'would we possibly do 3pm then'
]
for (const text of fillerRevisionFamilies) {
  const frame = clockTimeBookingProposalFrame(text, { allowBareTime: true })
  check(`time_filler_family_${text}`, frame.proposal === true && /3(?::30)?\s*p\.?m/i.test(frame.candidate_text), JSON.stringify(frame))
}
const dateFillerFamilies = [
  'can we actually do september 10',
  'could we honestly just do September 10?',
  'can we actually push it to september 10'
]
for (const text of dateFillerFamilies) {
  const frame = calendarBookingProposalFrame(text, { allowBareDate: true })
  check(`date_filler_family_${text}`, frame.proposal === true && /september 10/i.test(frame.candidate_text), JSON.stringify(frame))
}
const bareHourRevisionFamilies = [
  ['3', '3pm'], ['3:30', '3:30pm'], ['can we make it 3?', '3pm'], ['could we do 3 instead', '3pm'],
  ['can i change it to 3', '3pm'], ['can we push it to 3', '3pm'], ['actually 3 would be better', '3pm'],
  ['3 instead of 2', '3pm'], ['is 3 ok?', '3pm'], ['would 3 be possible', '3pm'], ['lets do 3 instead', '3pm'],
  ['can we do three instead', '3pm'], ['does 3 work?', '3pm'], ['hmm 4', '4pm'], ['12', '12pm'], ['11', '11am']
]
for (const [text, expected] of bareHourRevisionFamilies) {
  const frame = clockTimeBookingProposalFrame(text, { allowBareTime: true, allowBareHour: true })
  check(`bare_hour_family_${text}`, frame.proposal === true && frame.candidate_text === expected && frame.bare_hour === true, JSON.stringify(frame))
  const closed = clockTimeBookingProposalFrame(text, { allowBareTime: true })
  check(`bare_hour_closed_outside_checkpoint_${text}`, closed.proposal === false, JSON.stringify(closed))
}
const bareHourNonCandidates = ['the 10th', 'sept 10', '4157602883', '2 people', '4 by 4', '$3', 'this one', 'one sec', 'How about fifth of September?', '3 inches']
for (const text of bareHourNonCandidates) {
  const frame = clockTimeBookingProposalFrame(text, { allowBareTime: true, allowBareHour: true })
  check(`bare_hour_non_candidate_${text}`, frame.proposal === false && frame.bare_hour !== true, JSON.stringify(frame))
}
const bareHourAmbiguous = clockTimeBookingProposalFrame('2 or 3?', { allowBareTime: true, allowBareHour: true })
check('bare_hour_alternatives_stay_ambiguous', bareHourAmbiguous.ambiguous === true && JSON.stringify(bareHourAmbiguous.alternatives) === JSON.stringify(['2pm', '3pm']), JSON.stringify(bareHourAmbiguous))
const bareHourRejected = clockTimeBookingProposalFrame('not 3', { allowBareTime: true, allowBareHour: true })
check('bare_hour_rejection_stays_rejection', bareHourRejected.rejection === true && bareHourRejected.candidate_text === '3pm', JSON.stringify(bareHourRejected))

const nonExactRevisionFamilies = [
  ['not 3pm', clockTimeBookingProposalFrame, 'rejection'],
  ['2pm or 3pm', clockTimeBookingProposalFrame, 'ambiguous'],
  ['after 3pm', clockTimeBookingProposalFrame, 'bounded'],
  ['not September 8', calendarBookingProposalFrame, 'rejection'],
  ['September 8 or September 9', calendarBookingProposalFrame, 'ambiguous'],
  ['after September 8', calendarBookingProposalFrame, 'bounded']
]
for (const [text, classifier, expected] of nonExactRevisionFamilies) {
  const frame = classifier(text, { allowBareDate: true, allowBareTime: true })
  check(`non_exact_${expected}_${text}`, frame[expected] === true, JSON.stringify(frame))
}

const history = [
  { role: 'assistant', text: 'https://www.effacermonexistence.com/apply' },
  { role: 'user', text: 'I just submitted' },
  { role: 'assistant', text: 'earliest i have is september 7 at 2pm' },
  { role: 'assistant', text: 'september 8 at 2pm or september 9 at 2pm also work' },
  { role: 'user', text: 'We can definitely do September 8' },
  {
    role: 'assistant',
    text: 'Name : Codex extra high\nPhone Number : 1231231234\nAppointment date : 9th of September\nTime : 2pm\n\ncan you double check this just to make sure'
  }
]
const live = {
  contact_id: 'divergence-thread',
  thread_id: 'divergence-thread',
  instagram_username: 'omar.system',
  message_id: 'divergence-time-correction',
  text: 'Can we do 3 PM?',
  received_at: '2026-09-01T06:35:12.014Z'
}
const rebuilt = buildStructuredState(live, history)
check('client_selected_date_outranks_wrong_assistant_checkpoint',
  /september\s+8/i.test(rebuilt.known_requested_date) && rebuilt.double_check_sent === false,
  JSON.stringify(rebuilt))
const annotated = annotateStructuredStateForLiveTurn(live, rebuilt, history)
const plan = deriveClosedTransitionPlan({
  ...live,
  message: live.text,
  recent_history: history,
  structured_state: {
    ...annotated,
    known_name_used_on_form: 'Codex extra high',
    known_phone_used_on_form: '1231231234'
  }
})
check('time_revision_reopens_fresh_double_check',
  annotated.live_turn_checkpoint_invalidated === true &&
  plan.action === 'double_check' &&
  /september\s+8/i.test(plan.fields.date) &&
  /3(?::00)?pm/i.test(plan.fields.time),
  JSON.stringify({ annotated, plan }))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-double-check-divergence-'))
try {
  ensureControlDirs(root)
  const thread = '1537753982'
  fs.writeFileSync(path.join(root, 'thread-state', `${thread}.json`), `${JSON.stringify({
    contact_id: thread,
    thread_id: thread,
    tattoo_intent_active: true,
    known_design_context: 'client reference',
    form_offer_asked: true,
    form_link_sent: true,
    form_submitted: true,
    last_offered_date: 'september 9',
    last_offered_time: '2pm',
    booking_stage_hint: 'awaiting_date'
  }, null, 2)}\n`)

  const addUser = (messageId, text, at) => appendControlHistoryEvent(root, {
    contact_id: thread, thread_id: thread, message_id: messageId, text
  }, 'user', { at })
  const addAssistant = (messageId, text, at) => appendControlHistoryEvent(root, {
    contact_id: thread,
    thread_id: thread,
    message_id: messageId,
    bubble_index: 0,
    bubble_count: 1,
    bubble: { text }
  }, 'assistant', { at, delivery_status: 'verified' })

  addAssistant('form-link', 'https://www.effacermonexistence.com/apply', '2026-09-01T06:33:11.000Z')
  addUser('submitted', 'I just submitted', '2026-09-01T06:34:04.000Z')
  addAssistant('options', 'september 8 at 2pm or september 9 at 2pm also work', '2026-09-01T06:34:40.000Z')
  addUser('selected-date', 'We can definitely do September 8', '2026-09-01T06:34:51.000Z')
  addAssistant('wrong-checkpoint', history.at(-1).text, '2026-09-01T06:34:58.000Z')

  const inbound = {
    contact_id: thread,
    thread_id: thread,
    instagram_username: 'omar.system',
    message_id: 'exact-live-can-we-do-3pm',
    text: 'Can we do 3 PM?',
    received_at: '2026-09-01T06:35:12.014Z'
  }
  recordIngressEvent(root, inbound)
  let capturedPlan = null
  const result = executeSingleControlTurn(inbound, {
    root,
    candidateGenerator: (_message, options) => {
      capturedPlan = options.control_transition_contract
      const recoveryInput = {
        message: inbound.text,
        live_message: inbound.text,
        recent_history: history,
        structured_state: { ...options.structured_state_override },
        control_transition_contract: capturedPlan
      }
      const packet = buildDeterministicRecoveryPacket(recoveryInput, capturedPlan)
      return {
        source: 'codex_exec_dm_authority',
        authority: {
          runner: 'scv-single-control-plane',
          model: 'none',
          executor: 'deterministic_fixed_booking_checkpoint'
        },
        raw_text: packet.reply_text,
        packet,
        structured_state: recoveryInput.structured_state,
        intent_adoption_state: {},
        recent_history: []
      }
    }
  })
  const visible = String(result.packet?.reply_text || '')
  check('exact_live_executed_path_returns_visible_corrected_checkpoint',
    capturedPlan?.action === 'double_check' &&
    /Appointment date : september 8/i.test(visible) &&
    /Time : 3(?::00)?pm/i.test(visible) &&
    result.authority?.control_candidate_passes === 1,
    JSON.stringify({ capturedPlan, visible, authority: result.authority }))
  // v152 (owner, 2026-09-05): the corrected block is preceded by the answer to the
  // client's question, as its own bubble, on the exact live executed path too.
  const liveBubbles = (Array.isArray(result.packet?.bubbles) ? result.packet.bubbles : []).map((b) => String(b?.text || ''))
  check('v152_exact_live_path_answers_yes_before_the_corrected_block',
    liveBubbles.length === 2 && /^yes 3(?::00)?pm works$/.test(liveBubbles[0]) && /^Name : /.test(liveBubbles[1]) && /Time : 3(?::00)?pm/.test(liveBubbles[1]),
    JSON.stringify({ liveBubbles }))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

function runControllerRevisionScenario(caseId, text) {
  const caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), `scv-double-check-${caseId}-`))
  try {
    ensureControlDirs(caseRoot)
    const thread = `revision-${caseId}`
    fs.writeFileSync(path.join(caseRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({
      contact_id: thread,
      thread_id: thread,
      tattoo_intent_active: true,
      known_design_context: 'client reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      last_offered_date: 'september 9',
      last_offered_time: '2pm',
      booking_stage_hint: 'awaiting_date'
    }, null, 2)}\n`)

    const addUser = (messageId, surface, at) => appendControlHistoryEvent(caseRoot, {
      contact_id: thread, thread_id: thread, message_id: messageId, text: surface
    }, 'user', { at })
    const addAssistant = (messageId, surface, at) => appendControlHistoryEvent(caseRoot, {
      contact_id: thread,
      thread_id: thread,
      message_id: messageId,
      bubble_index: 0,
      bubble_count: 1,
      bubble: { text: surface }
    }, 'assistant', { at, delivery_status: 'verified' })

    addAssistant('form-link', 'https://www.effacermonexistence.com/apply', '2026-09-01T06:33:11.000Z')
    addUser('submitted', 'I just submitted', '2026-09-01T06:34:04.000Z')
    addAssistant('options', 'september 8 at 2pm or september 9 at 2pm also work', '2026-09-01T06:34:40.000Z')
    addUser('selected-date', 'We can definitely do September 8', '2026-09-01T06:34:51.000Z')
    addAssistant('checkpoint', history.at(-1).text, '2026-09-01T06:34:58.000Z')

    const inbound = {
      contact_id: thread,
      thread_id: thread,
      instagram_username: 'omar.system',
      message_id: `revision-${caseId}`,
      text,
      received_at: '2026-09-01T06:35:12.014Z'
    }
    recordIngressEvent(caseRoot, inbound)
    let capturedPlan = null
    const result = executeSingleControlTurn(inbound, {
      root: caseRoot,
      candidateGenerator: (_message, options) => {
        capturedPlan = options.control_transition_contract
        const recoveryInput = {
          message: inbound.text,
          live_message: inbound.text,
          recent_history: history,
          structured_state: { ...options.structured_state_override },
          control_transition_contract: capturedPlan
        }
        let packet
        if (capturedPlan.action === 'double_check') {
          packet = buildDeterministicRecoveryPacket(recoveryInput, capturedPlan)
        } else {
          const replyText = capturedPlan.action === 'post_form_time'
            ? (/\bor\b/i.test(inbound.text)
                ? 'which time do you want me to use 2pm or 3pm?'
                : 'what exact time do you want me to use instead?')
            : capturedPlan.action === 'post_form_availability'
              ? 'what exact date do you want to use instead?'
              : 'what detail do you want me to update?'
          packet = {
            bubbles: [{ text: replyText, delay_ms: 0 }],
            reply_text: replyText,
            acknowledged_fields: [],
            questioned_fields: [],
            next_action_reflected: capturedPlan.action
          }
        }
        return {
          source: 'codex_exec_dm_authority',
          authority: {
            runner: 'scv-single-control-plane',
            model: 'none',
            executor: 'deterministic_divergence_matrix'
          },
          raw_text: packet.reply_text,
          packet,
          structured_state: recoveryInput.structured_state,
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    return {
      plan: capturedPlan,
      visible: String(result.packet?.reply_text || '').trim(),
      passes: Number(result.authority?.control_candidate_passes || 0),
      verifier_rejections: Number(result.authority?.control_verifier_rejection_count || 0)
    }
  } finally {
    fs.rmSync(caseRoot, { recursive: true, force: true })
  }
}

const executedRevisionCases = [
  {
    id: 'name',
    text: 'actually my name on the form is Maya Chen',
    expectedAction: 'double_check',
    visible: /Name : Maya Chen/i
  },
  {
    id: 'phone',
    text: 'the correct phone number is 415 555 0199',
    expectedAction: 'double_check',
    visible: /Phone Number : 4155550199/i
  },
  {
    id: 'date',
    text: 'can we move it to September 10?',
    expectedAction: 'post_form_time',
    visible: /time/i
  },
  {
    id: 'time_ambiguous',
    text: '2pm or 3pm',
    expectedAction: 'post_form_time',
    visible: /time/i
  },
  {
    id: 'time_vague',
    text: 'actually i need to change the time',
    expectedAction: 'post_form_time',
    visible: /time/i
  },
  {
    id: 'date_rejected',
    text: 'not September 8',
    expectedAction: 'post_form_availability',
    visible: /date|day/i
  }
]
for (const scenario of executedRevisionCases) {
  const result = runControllerRevisionScenario(scenario.id, scenario.text)
  check(`executed_${scenario.id}_owns_revision_route`,
    result.plan?.action === scenario.expectedAction,
    JSON.stringify(result))
  check(`executed_${scenario.id}_returns_visible_first_pass`,
    result.visible.length > 0 && scenario.visible.test(result.visible) && result.passes === 1,
    JSON.stringify(result))
}

// Exact live wording from the 2026-09-02 incident replayed through the real
// authority + controller path: it must reopen the checkpoint with 3pm on the
// first pass, keep the design context untouched, and never wait for a model.
{
  const liveHistory = [
    { role: 'assistant', text: 'https://www.effacermonexistence.com/apply' },
    { role: 'user', text: 'Done' },
    { role: 'assistant', text: 'i can do september 9 at 2pm or september 10 11 12 or 13 at 2pm which one works' },
    { role: 'user', text: 'Yeah, let’s do September 9' },
    { role: 'assistant', text: 'Name : Feeble part 5.1 number one\nPhone Number : 1231231234\nAppointment date : 9th of September\nTime : 2pm\n\ncan you double check this just to make sure' }
  ]
  const liveMessage = {
    contact_id: '1537753982', thread_id: '1537753982', instagram_username: 'omar.system',
    message_id: 'legacy-manychat-live-actually-3pm', text: 'Can we actually do 3 PM?', received_at: '2026-09-02T19:46:53.916Z'
  }
  const liveRebuilt = buildStructuredState(liveMessage, liveHistory)
  const liveSeed = {
    ...liveRebuilt,
    known_name_used_on_form: 'Feeble part 5.1 number one', known_phone_used_on_form: '1231231234', form_submitted: true,
    known_requested_date: 'September 9', known_requested_time: '2pm', last_offered_date: 'September 9', last_offered_time: '2pm',
    known_client_anchored_inspiration: true, tattoo_intent_active: true, known_design_context: 'client reference'
  }
  const cases = [
    ['Can we actually do 3 PM?', 'double_check', /3(?::00)?pm/i, 'time'],
    ['can we make it 3?', 'double_check', /3(?::00)?pm/i, 'time'],
    ['could we do 3 instead', 'double_check', /3(?::00)?pm/i, 'time'],
    ['is 3 ok?', 'double_check', /3(?::00)?pm/i, 'time'],
    ['hmm 4', 'double_check', /4(?::00)?pm/i, 'time'],
    ['my name is actually Maya Chen', 'double_check', null, 'name'],
    ['the number is wrong its 4155550199', 'double_check', null, 'phone'],
    ['actually can we do the 10th instead', 'post_form_time', null, 'date'],
    ['2 or 3?', 'post_form_time', null, 'ask'],
    ['not 2pm', 'post_form_time', null, 'ask'],
    // committed-slot polarity (v134 law): rejecting some OTHER value keeps the
    // open checkpoint; it is not a revision of it
    ['not 3pm', 'await_double_check_confirmation', null, 'polarity'],
    ['i cant do 4pm', 'await_double_check_confirmation', null, 'polarity'],
    ['actually i need to change the time', 'post_form_time', null, 'ask'],
    ['i wanna change the date', 'post_form_availability', null, 'ask'],
    ['can i fix the name', 'post_form_identity', null, 'ask'],
    ['wait can i change something', 'await_double_check_confirmation', null, 'ask'],
    ['looks good', 'deposit_handoff', null, 'confirm'],
    ['yes', 'deposit_handoff', null, 'confirm']
  ]
  for (const [text, expectedAction, timeRe, kind] of cases) {
    const annotated = annotateStructuredStateForLiveTurn({ ...liveMessage, text }, { ...liveSeed }, liveHistory)
    const input = { ...liveMessage, text, message: text, live_message: text, recent_history: liveHistory, structured_state: annotated }
    const plan = deriveClosedTransitionPlan(input)
    check(`live_checkpoint_revision_${text}_route`, plan.action === expectedAction, JSON.stringify({ text, plan }))
    if (kind === 'polarity') check(`live_checkpoint_revision_${text}_polarity_keeps_checkpoint`, plan.reason === 'four_field_double_check_already_sent_wait_without_repeating' && annotated.live_turn_checkpoint_invalidated !== true && !annotated.live_turn_checkpoint_revision_intent, JSON.stringify({ text, plan, intent: annotated.live_turn_checkpoint_revision_intent }))
    check(`live_checkpoint_revision_${text}_design_context_untouched`, annotated.known_design_context === 'client reference' && annotated.live_turn_gave_design_idea !== true, JSON.stringify({ design: annotated.known_design_context, gave: annotated.live_turn_gave_design_idea }))
    if (timeRe) check(`live_checkpoint_revision_${text}_time`, timeRe.test(String(plan.fields?.time || '')) && annotated.live_turn_checkpoint_invalidated === true, JSON.stringify(plan.fields))
    if (kind === 'name') check(`live_checkpoint_revision_${text}_name`, plan.fields?.name === 'Maya Chen' && plan.fields?.phone === '1231231234', JSON.stringify(plan.fields))
    if (kind === 'phone') check(`live_checkpoint_revision_${text}_phone`, plan.fields?.phone === '4155550199' && plan.fields?.name === 'Feeble part 5.1 number one', JSON.stringify(plan.fields))
    if (kind === 'date') check(`live_checkpoint_revision_${text}_date`, /september 10/i.test(String(plan.fields?.date || '')), JSON.stringify(plan.fields))
    if (kind === 'ask') {
      check(`live_checkpoint_revision_${text}_reason`, /^double_check_(?:time|date|identity)_revision_unresolved$|^double_check_revision_unclassified_ask_which_field$/.test(String(plan.reason || '')), JSON.stringify(plan))
      const askPacket = buildDoubleCheckRevisionAskPacket(input, plan)
      const verdict = evaluateClosedTransitionContract({ ...input, control_transition_contract: plan }, askPacket, plan)
      check(`live_checkpoint_revision_${text}_ask_valid`, verdict.valid === true && /[?]/.test(askPacket.reply_text) && !retiredTemplate.test(askPacket.reply_text), JSON.stringify({ ask: askPacket.reply_text, verdict }))
      const exhausted = buildRouteAwareVisibleRecoveryPacket(input, plan)
      check(`live_checkpoint_revision_${text}_recovery_is_same_ask`, String(exhausted.reply_text || '').trim() === String(askPacket.reply_text || '').trim(), JSON.stringify({ ask: askPacket.reply_text, recovery: exhausted.reply_text }))
    }
  }
  const askTexts = [
    ['2 or 3?', /do you want 2pm or 3pm\?/i],
    ['not 2pm', /instead of 2pm\?/i],
    ['actually i need to change the time', /instead of 2pm\?/i],
    ['i wanna change the date', /instead of september 9\?/i],
    ['can i fix the name', /what name should i put down instead\?/i],
    ['the number is wrong', /what number should i put down instead\?/i]
  ]
  for (const [text, expected] of askTexts) {
    const annotated = annotateStructuredStateForLiveTurn({ ...liveMessage, text }, { ...liveSeed }, liveHistory)
    const input = { ...liveMessage, text, message: text, live_message: text, recent_history: liveHistory, structured_state: annotated }
    const plan = deriveClosedTransitionPlan(input)
    const askPacket = buildDoubleCheckRevisionAskPacket(input, plan)
    check(`live_checkpoint_revision_ask_text_${text}`, expected.test(String(askPacket.reply_text || '')), JSON.stringify({ text, ask: askPacket.reply_text, plan }))
  }
  // Executed control-plane turn for the exact live wording: one deterministic pass.
  const liveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-live-actually-3pm-'))
  try {
    ensureControlDirs(liveRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(liveRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({
      contact_id: thread, thread_id: thread, tattoo_intent_active: true, known_design_context: 'client reference',
      form_offer_asked: true, form_link_sent: true, form_submitted: true, known_client_anchored_inspiration: true,
      known_requested_date: 'September 9', known_requested_time: '2pm', last_offered_date: 'September 9', last_offered_time: '2pm',
      known_name_used_on_form: 'Feeble part 5.1 number one', known_phone_used_on_form: '1231231234',
      booking_stage_hint: 'awaiting_form_identity_match'
    }, null, 2)}\n`)
    const addUser = (messageId, text, at) => appendControlHistoryEvent(liveRoot, { contact_id: thread, thread_id: thread, message_id: messageId, text }, 'user', { at })
    const addAssistant = (messageId, text, at) => appendControlHistoryEvent(liveRoot, { contact_id: thread, thread_id: thread, message_id: messageId, bubble_index: 0, bubble_count: 1, bubble: { text } }, 'assistant', { at, delivery_status: 'verified' })
    addAssistant('form-link', 'https://www.effacermonexistence.com/apply', '2026-09-02T19:44:45.000Z')
    addUser('done', 'Done', '2026-09-02T19:45:54.000Z')
    addAssistant('options', 'i can do september 9 at 2pm or september 10 11 12 or 13 at 2pm which one works', '2026-09-02T19:46:31.000Z')
    addUser('selected', 'Yeah, let’s do September 9', '2026-09-02T19:46:39.000Z')
    addAssistant('checkpoint', liveHistory.at(-1).text, '2026-09-02T19:46:42.000Z')
    const inbound = { ...liveMessage }
    recordIngressEvent(liveRoot, inbound)
    let livePlan = null
    let modelCalls = 0
    const liveResult = executeSingleControlTurn(inbound, {
      root: liveRoot,
      candidateGenerator: (_message, options) => {
        modelCalls += 1
        livePlan = options.control_transition_contract
        const recoveryInput = { message: inbound.text, live_message: inbound.text, recent_history: liveHistory, structured_state: { ...options.structured_state_override }, control_transition_contract: livePlan }
        const packet = buildDeterministicRecoveryPacket(recoveryInput, livePlan)
        return { source: 'codex_exec_dm_authority', authority: { runner: 'scv-single-control-plane', model: 'none', executor: 'deterministic_fixed_booking_checkpoint' }, raw_text: packet.reply_text, packet, structured_state: recoveryInput.structured_state, intent_adoption_state: {}, recent_history: [] }
      }
    })
    const liveVisible = String(liveResult.packet?.reply_text || '')
    check('live_actually_3pm_executed_path_returns_corrected_checkpoint_first_pass',
      livePlan?.action === 'double_check' && modelCalls === 1 &&
      /Appointment date : (?:9th of September|september 9)/i.test(liveVisible) && /Time : 3(?::00)?pm/i.test(liveVisible) &&
      liveResult.authority?.control_candidate_passes === 1 && !retiredTemplate.test(liveVisible),
      JSON.stringify({ livePlan, liveVisible, authority: liveResult.authority, modelCalls }))
  } finally {
    fs.rmSync(liveRoot, { recursive: true, force: true })
  }
}

// Live red-team 2026-09-02 (v139 cases 07-16) replayed as one executed
// control-plane conversation. After the checkpoint, every revision must be
// answered on the first pass without a model where the contract is
// deterministic, the checkpoint must stay open across the clarification turns,
// no reply may repeat the previous assistant line, and the retired template
// must never appear.
{
  const seqRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-live-sequence-'))
  try {
    ensureControlDirs(seqRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(seqRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({
      contact_id: thread, thread_id: thread, tattoo_intent_active: true, known_design_context: 'small dagger on the inner forearm black and grey',
      form_offer_asked: true, form_link_sent: true, form_submitted: true,
      known_requested_date: 'september 12', known_requested_time: '2pm', last_offered_date: 'september 12', last_offered_time: '2pm',
      known_name_used_on_form: 'Omar System', known_phone_used_on_form: '4155550199',
      booking_stage_hint: 'awaiting_double_check_confirmation'
    }, null, 2)}\n`)
    let clock = Date.parse('2026-09-02T20:27:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    const seqHistory = []
    const addUser = (messageId, text) => { const at = tick(); seqHistory.push({ role: 'user', text }); appendControlHistoryEvent(seqRoot, { contact_id: thread, thread_id: thread, message_id: messageId, text }, 'user', { at }) }
    const addAssistant = (messageId, text) => { const at = tick(); seqHistory.push({ role: 'assistant', text }); appendControlHistoryEvent(seqRoot, { contact_id: thread, thread_id: thread, message_id: messageId, bubble_index: 0, bubble_count: 1, bubble: { text } }, 'assistant', { at, delivery_status: 'verified' }) }
    addAssistant('seq-form-link', 'here you go https://www.effacermonexistence.com/apply')
    addUser('seq-submitted', 'just sent it')
    addAssistant('seq-date-ask', 'got it thanks what date works for you')
    addUser('seq-date', 'september 12 works for me')
    addAssistant('seq-time-ask', 'september 12 works what time were you thinking')
    addUser('seq-time', '2pm is good')
    addAssistant('seq-identity-ask', 'perfect september 12 at 2pm is set just send me your name and phone number so i can match it up')
    addUser('seq-identity', 'Omar System 4155550199')
    addAssistant('seq-checkpoint', 'Name : Omar System\nPhone Number : 4155550199\nAppointment date : 12th of September\nTime : 2:00pm\n\ncan you double check this just to make sure')

    const modelStub = (plan, text) => {
      // Plausible model wording for the routes that stay model-authored.
      if (plan.action === 'post_form_time') return 'yeah september 13 works what time are you thinking?'
      if (plan.action === 'deposit_handoff') return null
      return `ok noted ${text}`
    }
    const runTurn = (messageId, text) => {
      const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: messageId, text, received_at: tick() }
      recordIngressEvent(seqRoot, inbound)
      let plan = null
      let calls = 0
      const result = executeSingleControlTurn(inbound, {
        root: seqRoot,
        candidateGenerator: (_message, options) => {
          calls += 1
          plan = options.control_transition_contract
          const recoveryInput = { message: text, live_message: text, recent_history: seqHistory.slice(), structured_state: { ...options.structured_state_override }, control_transition_contract: plan }
          let packet
          let executor = 'deterministic_fixed_booking_checkpoint'
          if (plan.action === 'double_check' || plan.action === 'deposit_handoff') {
            packet = buildDeterministicRecoveryPacket(recoveryInput, plan)
          } else if (/^double_check_(?:time|date|identity)_revision_unresolved$|^double_check_revision_unclassified_ask_which_field$/.test(String(plan.reason || ''))) {
            packet = buildDoubleCheckRevisionAskPacket(recoveryInput, plan)
            executor = 'deterministic_double_check_revision_ask'
          } else {
            const reply = modelStub(plan, text)
            packet = { bubbles: [{ text: reply, delay_ms: 0 }], reply_text: reply, acknowledged_fields: [], questioned_fields: plan.action === 'post_form_time' ? ['appointment_time'] : [], next_action_reflected: plan.action }
            executor = 'stub_model'
          }
          return { source: 'codex_exec_dm_authority', authority: { runner: 'scv-single-control-plane', model: 'none', executor }, raw_text: packet.reply_text, packet, structured_state: recoveryInput.structured_state, intent_adoption_state: {}, recent_history: [] }
        }
      })
      seqHistory.push({ role: 'user', text })
      const visible = String(result.packet?.reply_text || '')
      seqHistory.push({ role: 'assistant', text: visible })
      return { plan, calls, visible, passes: Number(result.authority?.control_candidate_passes || 0), rejections: Number(result.authority?.control_verifier_rejection_count || 0), recovery: result.authority?.control_route_aware_visible_recovery === true, state: result.structured_state || {} }
    }
    const steps = [
      ['seq-08', 'Can we actually do 3 PM?', 'double_check', /Time : 3(?::00)?pm/i, true],
      ['seq-09', '2 or 4?', 'post_form_time', /do you want 2pm or 4pm\?/i, true],
      ['seq-10', '4', 'double_check', /Time : 4(?::00)?pm/i, true],
      ['seq-11', 'actually can we do the 13th instead', 'post_form_time', /september 13/i, false],
      ['seq-12', '4pm', 'double_check', /Appointment date : (?:13th of September|september 13)[\s\S]*Time : 4(?::00)?pm/i, true],
      ['seq-13', 'my name is actually Omar Sys', 'double_check', /Name : Omar Sys\n/i, true],
      ['seq-14', 'wait can i change something', 'await_double_check_confirmation', /\b(?:date|day)\b[\s\S]*\btime\b[\s\S]*\b(?:name|number)\b|\btime\b[\s\S]*\bdate\b[\s\S]*\b(?:name|number)\b/i, true],
      ['seq-15', 'the number is wrong its 4155550188', 'double_check', /Phone Number : 4155550188/i, true],
      ['seq-16', 'looks good', 'deposit_handoff', /100|zelle|deposit/i, true]
    ]
    let previousVisible = seqHistory.at(-1).text
    for (const [id, text, expectedAction, visibleRe, deterministic] of steps) {
      const turn = runTurn(id, text)
      check(`live_sequence_${id}_route`, turn.plan?.action === expectedAction, JSON.stringify({ id, text, plan: turn.plan, visible: turn.visible }))
      check(`live_sequence_${id}_visible`, visibleRe.test(turn.visible) && !retiredTemplate.test(turn.visible), JSON.stringify({ id, text, visible: turn.visible, plan: turn.plan }))
      check(`live_sequence_${id}_no_repeat`, turn.visible.trim().toLowerCase() !== previousVisible.trim().toLowerCase(), JSON.stringify({ id, visible: turn.visible, previousVisible }))
      check(`live_sequence_${id}_no_recovery`, turn.recovery === false && turn.rejections === 0, JSON.stringify({ id, passes: turn.passes, rejections: turn.rejections, recovery: turn.recovery, visible: turn.visible }))
      if (deterministic) check(`live_sequence_${id}_single_pass`, turn.calls === 1 && turn.passes === 1, JSON.stringify({ id, calls: turn.calls, passes: turn.passes }))
      previousVisible = turn.visible
    }
  } finally {
    fs.rmSync(seqRoot, { recursive: true, force: true })
  }
}

// Executed-path replay through the REAL control plane and the REAL spawned
// runner (no stub candidate generator). Only turns the runner answers
// deterministically are executed; the one model-authored turn (the date ask)
// is seeded as history. This is the seam that hid the v141 phone-revision
// regression: the stub path used the controller's working state, but the
// production runner received the identity rebound to the persisted baseline.
{
  process.env.SCV_RELEASE_PROTOCOL = process.env.SCV_RELEASE_PROTOCOL || 'single_release_v1'
  const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-real-runner-sequence-'))
  const previousScvRoot = process.env.SCV_ROOT
  try {
    for (const name of fs.readdirSync(__dirname)) {
      if (name.startsWith('.') || ['thread-state', 'thread-history', 'inbox', 'outbox', 'logs', 'control-decisions', 'control-events', 'control-locks', 'form-submissions'].includes(name) || /_quarantine_/.test(name)) continue
      try { fs.symlinkSync(path.join(__dirname, name), path.join(realRoot, name)) } catch {}
    }
    process.env.SCV_ROOT = realRoot
    ensureControlDirs(realRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(realRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({
      contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true,
      known_design_context: 'small dagger on the inner forearm black and grey', form_offer_asked: true, form_link_sent: true, form_submitted: true,
      known_requested_date: 'september 12', known_requested_time: '2:00pm', last_offered_date: 'september 12', last_offered_time: '2pm',
      known_name_used_on_form: 'Omar System', known_phone_used_on_form: '4155550199',
      double_check_sent: true, name_phone_date_time_double_check_sent: true, booking_stage_hint: 'awaiting_double_check_confirmation'
    }, null, 2)}\n`)
    let clock = Date.parse('2026-09-02T23:30:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    const addUser = (id, text) => appendControlHistoryEvent(realRoot, { contact_id: thread, thread_id: thread, message_id: id, text }, 'user', { at: tick() })
    const addAssistant = (id, text) => appendControlHistoryEvent(realRoot, { contact_id: thread, thread_id: thread, message_id: id, bubble_index: 0, bubble_count: 1, bubble: { text } }, 'assistant', { at: tick(), delivery_status: 'verified' })
    addAssistant('rr-link', 'here you go https://www.effacermonexistence.com/apply'); addUser('rr-sub', 'just sent it')
    addAssistant('rr-date-ask', 'got it send me a couple dates that work'); addUser('rr-date', 'september 12 works for me')
    addAssistant('rr-time-ask', 'september 12 works what time works for you'); addUser('rr-time', '2pm is good')
    addAssistant('rr-id-ask', 'september 12 at 2pm works send me your name and best number and i’ll double check it'); addUser('rr-id', 'Omar System 4155550199')
    addAssistant('rr-cp', 'Name : Omar System\nPhone Number : 4155550199\nAppointment date : 12th of September\nTime : 2:00pm\n\ncan you double check this just to make sure')
    const runReal = (id, text) => {
      const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: id, text, received_at: tick() }
      recordIngressEvent(realRoot, inbound)
      const result = executeSingleControlTurn(inbound, { root: realRoot })
      return {
        visible: String(result.packet?.reply_text || ''),
        action: String(result.authority?.closed_transition_action || ''),
        executor: String(result.authority?.candidate_authority?.executor || ''),
        passes: Number(result.authority?.control_candidate_passes || 0),
        recovery: result.authority?.control_route_aware_visible_recovery === true,
        state: result.structured_state || {}
      }
    }
    const realSteps = [
      ['rr-08', 'Can we actually do 3 PM?', 'double_check', /Time : 3(?::00)?pm/i],
      ['rr-09', '2 or 4?', 'post_form_time', /do you want 2pm or 4pm\?/i],
      ['rr-10', '4', 'double_check', /Time : 4(?::00)?pm/i]
    ]
    for (const [id, text, expectedAction, visibleRe] of realSteps) {
      const turn = runReal(id, text)
      check(`real_runner_${id}_route`, turn.action === expectedAction, JSON.stringify({ id, text, turn: { ...turn, state: undefined } }))
      check(`real_runner_${id}_visible`, visibleRe.test(turn.visible) && !retiredTemplate.test(turn.visible), JSON.stringify({ id, visible: turn.visible }))
      check(`real_runner_${id}_single_deterministic_pass`, turn.passes === 1 && turn.recovery === false && turn.executor.startsWith('deterministic_'), JSON.stringify({ id, passes: turn.passes, recovery: turn.recovery, executor: turn.executor }))
    }
    // The date revision is model-authored on production. Run it through the real
    // control plane with a model stand-in so the state commit is genuine (a
    // history-only seed would leave the persisted baseline behind the thread).
    {
      const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'rr-11', text: 'actually can we do the 13th instead', received_at: tick() }
      recordIngressEvent(realRoot, inbound)
      let plan11 = null
      const turn11 = executeSingleControlTurn(inbound, {
        root: realRoot,
        candidateGenerator: (_message, options) => {
          plan11 = options.control_transition_contract
          const reply = 'yep september 13 works what time do you want on that day'
          const packet = { bubbles: [{ text: reply, delay_ms: 0 }], reply_text: reply, acknowledged_fields: ['appointment_date'], questioned_fields: ['appointment_time'], next_action_reflected: plan11.action }
          return { source: 'codex_exec_dm_authority', authority: { runner: 'scv-single-control-plane', model: 'none', executor: 'stub_model' }, raw_text: reply, packet, structured_state: { ...options.structured_state_override }, intent_adoption_state: {}, recent_history: [] }
        }
      })
      check('real_runner_rr-11_route', plan11?.action === 'post_form_time' && /september 13/i.test(String(turn11.structured_state?.known_requested_date || '')), JSON.stringify({ plan11, date: turn11.structured_state?.known_requested_date, time: turn11.structured_state?.known_requested_time }))
    }
    const realSteps2 = [
      ['rr-12', '4pm', 'double_check', /Appointment date : 13th of September[\s\S]*Time : 4(?::00)?pm/i, { known_requested_date: /september 13/i }],
      ['rr-13', 'my name is actually Omar Sys', 'double_check', /Name : Omar Sys\n/i, { known_name_used_on_form: /^Omar Sys$/ }],
      ['rr-14', 'wait can i change something', 'await_double_check_confirmation', /\b(?:date|day)\b[\s\S]*\btime\b[\s\S]*\b(?:name|number)\b|\btime\b[\s\S]*\bdate\b[\s\S]*\b(?:name|number)\b/i, {}],
      ['rr-15', 'the number is wrong its 4155550188', 'double_check', /Phone Number : 4155550188/i, { known_phone_used_on_form: /^4155550188$/ }],
      ['rr-16', 'looks good', 'deposit_handoff', /100|zelle|deposit/i, { deposit_requested: true }]
    ]
    for (const [id, text, expectedAction, visibleRe, expectState] of realSteps2) {
      const turn = runReal(id, text)
      check(`real_runner_${id}_route`, turn.action === expectedAction, JSON.stringify({ id, text, turn: { ...turn, state: undefined } }))
      check(`real_runner_${id}_visible`, visibleRe.test(turn.visible) && !retiredTemplate.test(turn.visible), JSON.stringify({ id, visible: turn.visible }))
      check(`real_runner_${id}_single_deterministic_pass`, turn.passes === 1 && turn.recovery === false && turn.executor.startsWith('deterministic_'), JSON.stringify({ id, passes: turn.passes, recovery: turn.recovery, executor: turn.executor }))
      for (const [field, expected] of Object.entries(expectState)) {
        const actual = turn.state[field]
        const ok = expected instanceof RegExp ? expected.test(String(actual || '')) : actual === expected
        check(`real_runner_${id}_committed_${field}`, ok, JSON.stringify({ id, field, actual }))
      }
    }
  } finally {
    if (previousScvRoot === undefined) delete process.env.SCV_ROOT
    else process.env.SCV_ROOT = previousScvRoot
    fs.rmSync(realRoot, { recursive: true, force: true })
  }
}

const fallbackInput = {
  message: 'change the booking but i am not sure how yet',
  live_message: 'change the booking but i am not sure how yet',
  structured_state: {},
  recent_history: []
}
const fallbackPlan = {
  action: 'await_double_check_confirmation',
  reason: 'four_field_double_check_already_sent_wait_without_repeating',
  obligations: [],
  fields: {}
}
const fallbackPacket = buildRouteAwareVisibleRecoveryPacket(fallbackInput, fallbackPlan)
check('unclassified_double_check_divergence_has_visible_minimum_reply',
  isRouteAwareVisibleRecoveryPacket(fallbackPacket, fallbackInput, fallbackPlan) &&
  String(fallbackPacket.reply_text || '').trim().length > 0 &&
  /\b(?:date|day)\b/i.test(fallbackPacket.reply_text) &&
  /\btime\b/i.test(fallbackPacket.reply_text) &&
  /\b(?:name|number)\b/i.test(fallbackPacket.reply_text),
  JSON.stringify(fallbackPacket))
// The retired system-notice template must never come back on any recovery
// surface (owner directive 2026-09-02: no templates at the double-check).
check('retired_await_template_absent_from_unclassified_fallback',
  !retiredTemplate.test(fallbackPacket.reply_text), fallbackPacket.reply_text)
const recoverySource = fs.readFileSync(path.join(__dirname, 'scv-deterministic-recovery.js'), 'utf8')
  .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
check('retired_await_template_absent_from_recovery_source',
  !/haven't changed or confirmed the booking yet what detail do you want me to update/i.test(recoverySource), 'template string still present in recovery source')
const rotatedInput = {
  ...fallbackInput,
  recent_history: [{ role: 'assistant', text: fallbackPacket.reply_text }]
}
const rotatedPacket = buildRouteAwareVisibleRecoveryPacket(rotatedInput, fallbackPlan)
check('unclassified_fallback_never_repeats_previous_assistant_line',
  String(rotatedPacket.reply_text || '').trim() !== String(fallbackPacket.reply_text || '').trim() &&
  isRouteAwareVisibleRecoveryPacket(rotatedPacket, rotatedInput, fallbackPlan),
  JSON.stringify({ first: fallbackPacket.reply_text, second: rotatedPacket.reply_text }))


// ============================================================
// v143 (live incident 2026-09-03, Omar.system): "Hi, can I please get more
// information?" sent after the four-field checkpoint. v142 routed it to the
// checkpoint wait, the fast path was refused there, the model lane exhausted
// three verifier passes (88 s) and the route-aware recovery shipped the
// which-field revision ask. The replay below runs the sanitized production
// state through the REAL control plane and the REAL runner.
// ============================================================
const {
  GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON,
  GENERIC_INFO_VARIANTS,
  CHECKPOINT_RESUME_LINES,
  genericInfoFastPathAdmitsPlan
} = require('./scv-generic-info-fast-path.js')
const {
  deriveVerifierRebasePlan,
  liveIsGenericInfoSideQuestionAtOpenCheckpoint
} = require('./scv-closed-transition-contract.js')
const {
  liveTurnCarriesCheckpointRevisionEvidence,
  CHECKPOINT_NEUTRAL_NUDGES
} = require('./scv-deterministic-recovery.js')
const { textLooksLikeSchedulingProposal } = require('./scv-single-control-plane.js')
const whichFieldAsk = /\b(?:date|day)\b[\s\S]*\btime\b[\s\S]*\b(?:name|number)\b|\btime\b[\s\S]*\bdate\b[\s\S]*\b(?:name|number)\b/i
const explanationFirsts = GENERIC_INFO_VARIANTS.map((variant) => variant.first)
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'scv-incident-fixtures', 'owner-redteam-2026-09-03-info-opener-after-checkpoint.json'), 'utf8'))

// A. Contract: the side question keeps the checkpoint open; nothing else is hijacked.
{
  const seedState = { ...fixture.seed_state }
  const history = fixture.history_before_live_turn.map((event) => ({ role: event.role === 'assistant_attempted' ? 'assistant' : event.role, text: event.text, at: event.at, message_id: event.message_id }))
  const planFor = (text) => {
    const msg = { text, message: text, message_id: `v143-${text.length}` }
    const state = annotateStructuredStateForLiveTurn(msg, { ...seedState }, history)
    const input = { ...msg, live_message: text, recent_history: history.concat([{ role: 'user', text }]), structured_state: state }
    return { plan: deriveClosedTransitionPlan(input), input }
  }
  for (const text of ['Hi, can I please get more information?', 'hi can i please get more information', 'more info pls!!', 'can i plz get some infos', 'Could you tell me more about the offer?']) {
    const { plan, input } = planFor(text)
    check(`v143_contract_side_question_${text}`, plan.action === 'await_double_check_confirmation' && plan.reason === GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON && liveIsGenericInfoSideQuestionAtOpenCheckpoint(input) === true && genericInfoFastPathAdmitsPlan(plan) === true, JSON.stringify({ text, action: plan.action, reason: plan.reason }))
  }
  // The production state never recorded the form identity (the v142 state bug
  // fixed in block F); the control plane re-derives it from the matched form
  // submission each turn, so the contract-level non-hijack cases carry it.
  const identityState = { ...seedState, known_name_used_on_form: 'Omar System', known_phone_used_on_form: '4155550199' }
  const planWithIdentity = (text) => {
    const msg = { text, message: text, message_id: `v143-id-${text.length}` }
    const state = annotateStructuredStateForLiveTurn(msg, { ...identityState }, history)
    return deriveClosedTransitionPlan({ ...msg, live_message: text, recent_history: history.concat([{ role: 'user', text }]), structured_state: state })
  }
  const stays = [
    ['looks good', (plan) => plan.action === 'deposit_handoff'],
    ['wait can i change something', (plan) => plan.reason === 'double_check_revision_unclassified_ask_which_field'],
    ['can we actually do 3 pm?', (plan) => plan.action === 'double_check'],
    ['can i get more info on the price?', (plan) => plan.reason !== GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON],
    ['ok', (plan) => plan.reason !== GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON]
  ]
  for (const [text, expect] of stays) {
    const plan = planWithIdentity(text)
    check(`v143_contract_not_hijacked_${text}`, expect(plan), JSON.stringify({ text, action: plan.action, reason: plan.reason }))
  }
  // Without an open checkpoint the plain lanes are untouched (fresh thread).
  const fresh = deriveClosedTransitionPlan({ message: 'Hi, can I please get more information?', live_message: 'Hi, can I please get more information?', recent_history: [], structured_state: {} })
  check('v143_contract_fresh_thread_direct_info_unchanged', fresh.action === 'design_intake' && fresh.reason === 'direct_info_request_owns_live_turn', JSON.stringify(fresh))
}

// B. Recovery: the await-stage recovery asks which field only with revision evidence.
{
  const seedState = { ...fixture.seed_state }
  const history = fixture.history_before_live_turn.map((event) => ({ role: event.role === 'assistant_attempted' ? 'assistant' : event.role, text: event.text }))
  const awaitPlan = { action: 'await_double_check_confirmation', reason: 'four_field_double_check_already_sent_wait_without_repeating', obligations: [], fields: {} }
  const recoveryFor = (text) => {
    const msg = { text, message: text, message_id: `v143-rec-${text.length}` }
    const state = annotateStructuredStateForLiveTurn(msg, { ...seedState }, history)
    const input = { ...msg, live_message: text, recent_history: history.concat([{ role: 'user', text }]), structured_state: state }
    return { input, packet: buildRouteAwareVisibleRecoveryPacket(input, awaitPlan) }
  }
  const info = recoveryFor('Hi, can I please get more information?')
  check('v143_recovery_info_request_gets_side_question_answer', explanationFirsts.some((first) => info.packet.reply_text.includes(first)) && CHECKPOINT_RESUME_LINES.some((line) => info.packet.reply_text.includes(line)) && !whichFieldAsk.test(info.packet.reply_text) && isRouteAwareVisibleRecoveryPacket(info.packet, info.input, awaitPlan) && info.packet.questioned_fields[0] === 'double_check_confirmation', JSON.stringify(info.packet))
  const thanks = recoveryFor('thank you so much!!')
  check('v143_recovery_non_revision_gets_neutral_nudge', CHECKPOINT_NEUTRAL_NUDGES.includes(thanks.packet.reply_text) && !whichFieldAsk.test(thanks.packet.reply_text) && isRouteAwareVisibleRecoveryPacket(thanks.packet, thanks.input, awaitPlan), JSON.stringify(thanks.packet))
  const revision = recoveryFor('wait can i change something')
  check('v143_recovery_revision_evidence_keeps_which_field_ask', whichFieldAsk.test(revision.packet.reply_text) && revision.packet.questioned_fields[0] === 'double_check_revision_field' && isRouteAwareVisibleRecoveryPacket(revision.packet, revision.input, awaitPlan), JSON.stringify(revision.packet))
  check('v143_revision_evidence_predicate', liveTurnCarriesCheckpointRevisionEvidence(revision.input) === true && liveTurnCarriesCheckpointRevisionEvidence(thanks.input) === false && liveTurnCarriesCheckpointRevisionEvidence(info.input) === false, '')
  const nudged = recoveryFor('thank you so much!!')
  const repeatInput = { ...nudged.input, recent_history: nudged.input.recent_history.concat([{ role: 'assistant', text: thanks.packet.reply_text }]) }
  const repeat = buildRouteAwareVisibleRecoveryPacket(repeatInput, awaitPlan)
  check('v143_recovery_neutral_nudge_rotates', repeat.reply_text !== thanks.packet.reply_text && CHECKPOINT_NEUTRAL_NUDGES.includes(repeat.reply_text), JSON.stringify({ first: thanks.packet.reply_text, second: repeat.reply_text }))
}

// C. Verifier rebase: ready identity moves the plan to the checkpoint.
{
  const state = { form_submitted: true, known_name_used_on_form: 'Omar System', known_phone_used_on_form: '4155550199', known_requested_date: 'september 9', known_requested_time: '2pm', accepted_offered_date: 'september 9', accepted_offered_time: '2pm', tattoo_intent_active: true, form_link_sent: true, form_offer_asked: true }
  const input = { message: 'Yeah, sure', live_message: 'Yeah, sure', recent_history: [{ role: 'assistant', text: 'does september 9 (wednesday) at 2pm work for you' }, { role: 'user', text: 'Yeah, sure' }], structured_state: state }
  const stale = { action: 'post_form_identity', reason: 'accepted_slot_missing_identity', obligations: [], fields: {} }
  for (const reason of ['ready_booking_identity_requires_double_check', 'after_reauthor_ready_booking_identity_requires_double_check']) {
    const rebased = deriveVerifierRebasePlan(input, stale, { valid: false, reason })
    check(`v143_rebase_${reason}`, rebased && rebased.action === 'double_check' && rebased.rebase?.previous_action === 'post_form_identity', JSON.stringify(rebased))
  }
  const noFields = deriveVerifierRebasePlan({ ...input, structured_state: { form_submitted: true } }, stale, { valid: false, reason: 'ready_booking_identity_requires_double_check' })
  check('v143_rebase_requires_all_fields', noFields === null, JSON.stringify(noFields))
}

// D. Design context guard.
for (const text of ['Can we do September 5?', 'can we do the 12th', 'how about friday', 'would 3pm work', 'maybe next week']) {
  check(`v143_scheduling_text_not_design_${text}`, textLooksLikeSchedulingProposal(text) === true, text)
}
for (const text of ['small dagger on the inner forearm', 'a snake around my wrist', 'something like the one in your highlights']) {
  check(`v143_design_text_not_scheduling_${text}`, textLooksLikeSchedulingProposal(text) === false, text)
}

// v151 live incident 07: after the form/date/time gates were complete, the
// client naturally sent an unlabeled full name followed by a phone number. The
// identity parser must accept that exact-turn pair and must keep unrelated or
// third-party numbers out of booking authority.
{
  const identityBaseline = {
    form_submitted: true,
    known_requested_date: 'september 12',
    known_requested_time: '2:00pm',
    booking_stage_hint: 'awaiting_form_identity_match'
  }
  const accepted = liveBookingIdentityAnswer('Omar System 4155550199', identityBaseline)
  check('v151_unlabelled_name_phone_is_authoritative_in_identity_lane',
    accepted.name === 'Omar System' && accepted.phone === '4155550199',
    JSON.stringify(accepted))
  const outsideLane = liveBookingIdentityAnswer('Omar System 4155550199', {
    form_submitted: false,
    booking_stage_hint: 'design_intake'
  })
  check('v151_unlabelled_name_phone_rejected_outside_identity_lane',
    !outsideLane.name && !outsideLane.phone,
    JSON.stringify(outsideLane))
  const thirdParty = liveBookingIdentityAnswer('my friend Omar System is at 4155550199', identityBaseline)
  check('v151_third_party_name_phone_rejected_in_identity_lane',
    !thirdParty.name && !thirdParty.phone,
    JSON.stringify(thirdParty))
  const phoneLabelWithTrailingName = liveBookingIdentityAnswer('My phone on the form is 415-555-0199, Lua Test', identityBaseline)
  check('v151_phone_only_label_cannot_promote_trailing_text_to_name',
    !phoneLabelWithTrailingName.name && phoneLabelWithTrailingName.phone === '4155550199',
    JSON.stringify(phoneLabelWithTrailingName))
}

// E. Executed-path replay: production state through the REAL control plane and
// REAL runner, in a fresh process (scv-v143-incident-replay.js) so the history
// loader binds SCV_ROOT to the replay root exactly as production binds it at
// boot. In-process replays in this harness see an empty history because
// dm-authority resolves its root when it is first required.
{
  const { spawnSync } = require('child_process')
  const run = spawnSync(process.execPath, [path.join(__dirname, 'scv-v143-incident-replay.js'), path.join(__dirname, 'scv-incident-fixtures', 'owner-redteam-2026-09-03-info-opener-after-checkpoint.json')], { encoding: 'utf8', env: { ...process.env, SCV_RELEASE_PROTOCOL: process.env.SCV_RELEASE_PROTOCOL || 'single_release_v1' }, maxBuffer: 64 * 1024 * 1024 })
  let replay = null
  try { replay = JSON.parse(String(run.stdout || '').trim().split('\n').at(-1)) } catch {}
  check('v143_replay_process_ok', run.status === 0 && replay && replay.ok === true, JSON.stringify({ status: run.status, stdout: String(run.stdout || '').slice(-600), stderr: String(run.stderr || '').split('\n').filter((line) => !/^\s+at /.test(line)).slice(-6) }))
  const info = replay?.info || {}
  const confirm = replay?.confirm || {}
  check('v143_replay_route_side_question', info.action === 'await_double_check_confirmation' && info.reason === GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON, JSON.stringify(info))
  check('v143_replay_fast_path_single_pass_no_recovery', info.executor === 'deterministic_generic_info_fast_path' && info.passes === 1 && info.recovery === false, JSON.stringify({ executor: info.executor, passes: info.passes, recovery: info.recovery }))
  check('v143_replay_visible_explains_then_resumes', Array.isArray(info.bubbles) && info.bubbles.length === 2 && explanationFirsts.includes(info.bubbles[0]) && CHECKPOINT_RESUME_LINES.includes(info.bubbles[1]) && !whichFieldAsk.test(info.visible) && !retiredTemplate.test(info.visible) && !/^\s*(?:hi+|hello|hey)\b/i.test(info.bubbles[0]), JSON.stringify(info.bubbles))
  check('v143_replay_checkpoint_not_superseded', info.state && info.state.checkpoint_superseded_by_revision !== true && info.state.live_turn_checkpoint_invalidated !== true, JSON.stringify(info.state))
  check('v143_replay_confirmation_after_side_question_reaches_deposit', confirm.action === 'deposit_handoff' && confirm.passes === 1 && confirm.recovery === false && /100|zelle|deposit/i.test(String(confirm.visible || '')), JSON.stringify({ ...confirm, bubbles: undefined }))
}

// F. Executed checkpoint records durable state even when the plan is not DOUBLE_CHECK.
{
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v143-executed-checkpoint-'))
  try {
    ensureControlDirs(stateRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, known_design_context: 'small dagger on the inner forearm black and grey', form_offer_asked: true, form_link_sent: true, form_submitted: true, known_requested_date: 'september 9', known_requested_time: '2pm', accepted_offered_date: 'september 9', accepted_offered_time: '2pm' }, null, 2)}\n`)
    let clock = Date.parse('2026-09-03T03:00:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    appendControlHistoryEvent(stateRoot, { contact_id: thread, thread_id: thread, message_id: 'f-date-ask', bubble_index: 0, bubble_count: 1, bubble: { text: 'does september 9 (wednesday) at 2pm work for you' } }, 'assistant', { at: tick(), delivery_status: 'verified' })
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'f-yes', text: 'Yeah, sure', received_at: tick() }
    recordIngressEvent(stateRoot, inbound)
    const block = 'Name : Omar System\nPhone Number : 4155550199\nAppointment date : september 9\nTime : 2pm\n\ncan you double check this just to make sure'
    let seenPlan = null
    const result = executeSingleControlTurn(inbound, {
      root: stateRoot,
      candidateGenerator: (_message, options) => {
        seenPlan = options.control_transition_contract
        // Mirror production 03:01:58Z: the fixed checkpoint executor shipped the
        // four-field block while the frozen plan still said post_form_identity, and
        // the packet reflected the frozen plan's action.
        const packet = { bubbles: [{ text: block, delay_ms: 0 }], reply_text: block, acknowledged_fields: ['name', 'phone_number', 'appointment_date', 'appointment_time'], questioned_fields: ['double_check_confirmation'], next_action_reflected: String(seenPlan?.action || 'post_form_identity') }
        return { source: 'codex_exec_dm_authority', authority: { runner: 'scv-single-control-plane', model: 'none', executor: 'deterministic_fixed_booking_checkpoint' }, raw_text: block, packet, structured_state: { ...options.structured_state_override, known_name_used_on_form: 'Omar System', known_phone_used_on_form: '4155550199' }, intent_adoption_state: {}, recent_history: [] }
      }
    })
    const committed = JSON.parse(fs.readFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), 'utf8'))
    check('v143_executed_checkpoint_marks_state', committed.double_check_sent === true && committed.name_phone_date_time_double_check_sent === true && committed.known_name_used_on_form === 'Omar System' && committed.known_phone_used_on_form === '4155550199', JSON.stringify({ plan: seenPlan && seenPlan.action, action: result.authority?.closed_transition_action, double_check_sent: committed.double_check_sent, name: committed.known_name_used_on_form, stage: committed.booking_stage_hint }))
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true })
  }
}


// ============================================================
// v145 (live red-team on v144, 2026-09-03 07:2xZ): two stochastic-flag hijacks
// of resolved checkpoint revisions.
//  - case 08 "Can we actually do 3 PM?" right after the model-spot explanation:
//    the placement-possibility heuristic rejected every corrected-checkpoint
//    candidate (terminal no-reply).
//  - case 11 "actually can we do the 13th instead" carried a decline flag and
//    the decline branch swallowed the date revision.
// ============================================================
{
  const { evaluateScvContractHarness } = require('./scv-contract-harness.js')
  const checkpointBlock = 'Name : Omar System\nPhone Number : 4155550199\nAppointment date : 12th of September\nTime : 4:00pm\n\ncan you double check this just to make sure'
  const sideQuestionHistory = [
    { role: 'assistant', text: checkpointBlock },
    { role: 'user', text: 'hi can i please get more information' },
    { role: 'assistant', text: 'sure!! so a model spot is one of the few spots i open for pieces made from what you want while the finished tattoo stays in my style 🖤' },
    { role: 'assistant', text: 'feel free to pull inspo from my profile or send your own idea and i can customize it for you 🖤 all the info above is still exactly how i have it so let me know if anything on there needs changing' }
  ]
  // v160: the v145 calendar fixtures name September 12/13 and must not drift with the wall clock —
  // pin the inbound time to the day the incident was recorded.
  const V145_CLOCK = '2026-09-03T18:10:00.000Z'
  const base = {
    contact_id: '1537753982', thread_id: '1537753982', instagram_username: 'omar.system', tattoo_intent_active: true,
    known_design_context: 'small dagger on the inner forearm black and grey', known_client_anchored_inspiration: true, form_offer_asked: true, form_link_sent: true, form_submitted: true,
    known_requested_date: 'september 12', known_requested_time: '4:00pm', known_name_used_on_form: 'Omar System', known_phone_used_on_form: '4155550199',
    double_check_sent: true, name_phone_date_time_double_check_sent: true, booking_stage_hint: 'awaiting_double_check_confirmation'
  }
  // A. time revision after the model-spot explanation: corrected checkpoint accepted by the semantic layer
  {
    const text = 'Can we actually do 3 PM?'
    const msg = { text, message: text, message_id: 'v145-08', received_at: V145_CLOCK }
    const state = annotateStructuredStateForLiveTurn(msg, { ...base }, sideQuestionHistory)
    const input = { ...msg, live_message: text, recent_history: sideQuestionHistory.concat([{ role: 'user', text }]), structured_state: state }
    const plan = deriveClosedTransitionPlan(input)
    check('v145_time_revision_after_side_question_routes_double_check', plan.action === 'double_check', JSON.stringify({ action: plan.action, reason: plan.reason, time: state.live_turn_time_candidate }))
    const packet = buildDeterministicRecoveryPacket({ ...input, control_transition_contract: plan }, plan)
    const verdict = evaluateScvContractHarness({ ...input, control_transition_contract: plan }, packet)
    check('v145_corrected_checkpoint_not_rejected_as_placement_possibility', verdict.valid === true && /Time : 3(?::00)?pm/i.test(packet.reply_text), JSON.stringify({ reason: verdict.reason, reply: packet.reply_text }))
  }
  // B. date revision with a stale decline flag: still the time ask, never the decline branch
  {
    const text = 'actually can we do the 13th instead'
    const msg = { text, message: text, message_id: 'v145-11', received_at: V145_CLOCK }
    const state = annotateStructuredStateForLiveTurn(msg, { ...base, live_turn_declines: true }, sideQuestionHistory)
    state.live_turn_declines = true
    const input = { ...msg, live_message: text, recent_history: sideQuestionHistory.concat([{ role: 'user', text }]), structured_state: state }
    const plan = deriveClosedTransitionPlan(input)
    check('v145_date_revision_with_decline_flag_is_not_a_decline', plan.action === 'post_form_time' && plan.reason !== 'client_decline_or_not_yet_preserves_gate_without_pressure', JSON.stringify({ action: plan.action, reason: plan.reason, invalidated: state.live_turn_checkpoint_invalidated, time: state.known_requested_time }))
    check('v145_date_revision_clears_sibling_time', !String(state.known_requested_time || '').trim(), JSON.stringify({ time: state.known_requested_time, accepted_time: state.accepted_offered_time }))
  }
  // C. a genuine decline at the open checkpoint still takes the decline branch
  {
    const text = 'not yet i need to think about it'
    const msg = { text, message: text, message_id: 'v145-decline', received_at: V145_CLOCK }
    const state = annotateStructuredStateForLiveTurn(msg, { ...base }, sideQuestionHistory)
    state.live_turn_declines = true
    const input = { ...msg, live_message: text, recent_history: sideQuestionHistory.concat([{ role: 'user', text }]), structured_state: state }
    const plan = deriveClosedTransitionPlan(input)
    check('v145_genuine_decline_still_declines', plan.reason === 'client_decline_or_not_yet_preserves_gate_without_pressure', JSON.stringify({ action: plan.action, reason: plan.reason }))
  }
}


// ============================================================
// v146 (owner red-team on v145, the accepted run): "Can we do fifth of
// September?" right after the form link, before the gmail form match, took 70 s
// through the tattoo lane. Ordinal words are days, and a date answer to the
// assistant's date ask is an availability turn before the match lands.
// ============================================================
{
  const runner = require('./codex-dm-runner.js')
  const { dateAnswerAfterFormLink } = require('./scv-closed-transition-contract.js')
  const history = [
    { role: 'user', text: 'Can we do something like this?' },
    { role: 'assistant', text: 'yeah we can work from that' },
    { role: 'assistant', text: 'it can stay close to the reference and still be made your way want me to send the form' },
    { role: 'user', text: 'Yes, please' },
    { role: 'assistant', text: 'here’s the form https://www.effacermonexistence.com/apply' },
    { role: 'assistant', text: 'send me a couple dates that work and i’ll check the schedule' }
  ]
  const baseState = { tattoo_intent_active: true, known_client_anchored_inspiration: true, known_design_context: 'reference post', form_offer_asked: true, form_link_sent: true, current_message_date_local: 'September 3, 2026' }
  const cases = [
    ['Can we do fifth of September?', 'submitted_form_date_counterproposal_outside_window', true],
    ['how about sept fifth', 'submitted_form_date_counterproposal_outside_window', true],
    ['Can we do the fifth?', 'submitted_form_monthless_day_requires_month_clarification', false]
  ]
  for (const [text, expectedReason, deterministicDecline] of cases) {
    const msg = { text, message: text, message_id: `v146-${text.length}`, received_at: '2026-09-03T13:48:59.000Z' }
    const state = annotateStructuredStateForLiveTurn(msg, { ...baseState }, history)
    const input = { ...msg, live_message: text, recent_history: history.concat([{ role: 'user', text, message_id: msg.message_id }]), structured_state: state }
    const plan = deriveClosedTransitionPlan(input)
    check(`v146_date_answer_before_form_match_routes_availability_${text}`, plan.action === 'post_form_availability' && plan.reason === expectedReason, JSON.stringify({ text, action: plan.action, reason: plan.reason, status: state.live_turn_date_status, iso: state.live_turn_date_iso, needs_month: state.live_turn_date_needs_month }))
    if (deterministicDecline) {
      check(`v146_date_answer_helper_${text}`, dateAnswerAfterFormLink(input, plan.fields) === true, JSON.stringify(plan.fields))
      const packet = runner.buildDeterministicBookingPacket({ ...input, control_transition_contract: plan, structured_output_required: true })
      check(`v146_outside_window_decline_is_deterministic_${text}`, packet && /too soon/i.test(packet.packet.reply_text) && /earliest opening/i.test(packet.packet.reply_text) && packet.authority.model === 'none', JSON.stringify(packet && packet.packet.bubbles))
    }
  }
  // Without the assistant's date ask the same message keeps its existing lane (no route hijack).
  {
    const text = 'Can we do fifth of September?'
    const msg = { text, message: text, message_id: 'v146-noask', received_at: '2026-09-03T13:48:59.000Z' }
    const noAsk = history.slice(0, 5)
    const state = annotateStructuredStateForLiveTurn(msg, { ...baseState }, noAsk)
    const plan = deriveClosedTransitionPlan({ ...msg, live_message: text, recent_history: noAsk.concat([{ role: 'user', text, message_id: msg.message_id }]), structured_state: state })
    check('v146_no_date_ask_no_availability_hijack', plan.reason !== 'submitted_form_date_counterproposal_outside_window', JSON.stringify(plan))
  }
}


// v8 (live 2026-09-03 16:38Z to 16:44Z, v146 production red-team): the date answer
// before the form match must survive the intent classifier, and the four-field
// double-check detector must never fuse bubbles from different assistant replies.
{
  const contractHarness = require('./scv-contract-harness.js')
  const runner = require('./codex-dm-runner.js')
  const A = (id, text) => ({ role: 'assistant', message_id: id, text })
  const U = (id, text) => ({ role: 'user', message_id: id, text })
  // A. the v146 production history: four ordinary replies from four turns are NOT a sent double-check
  const v146History = [U('03', 'yes send it'), A('03', 'here you go https://www.effacermonexistence.com/apply'), A('03', 'send me a couple dates in this DM too and i ll check the schedule'), U('03b', 'Can we do fifth of September?'), A('03b', 'what date would you like me to check?'), U('04', 'just sent it'), A('04', 'got it i have the form'), A('04', 'the first open spot is september 10 at 2pm or september 11 12 or 13 at 2pm'), A('04', 'which one works'), U('05', 'september 12 works for me'), A('05', 'sept 12 is open at 2pm'), A('05', 'does that time work for you'), U('06', '2pm is good'), A('06', 'perfect sept 12 at 2pm is set'), A('06', 'send me your name and best number and i ll double check it'), U('07', 'Omar System 4155550199')]
  check('v147_double_check_detector_never_fuses_replies_across_client_turns', contractHarness.assistantSentNamePhoneDateTimeDoubleCheck({ message_id: '07', recent_history: v146History, structured_state: {} }) === false, 'v146 production history read as a sent double-check')
  const legacyNoIds = v146History.map((e) => ({ role: e.role, text: e.text }))
  check('v147_double_check_detector_legacy_events_without_ids_split_on_client_turns', contractHarness.assistantSentNamePhoneDateTimeDoubleCheck({ recent_history: legacyNoIds, structured_state: {} }) === false, 'legacy history fused across client turns')
  // B. a real multi-bubble double-check inside ONE reply still counts
  const realBlock = [U('x', 'Omar System 4155550199'), A('y', 'Name : Omar System'), A('y', 'Phone Number : 4155550199'), A('y', 'Appointment date : sept 12'), A('y', 'Time : 2pm'), A('y', 'can you double check this just to make sure'), U('z', 'ok')]
  check('v147_double_check_detector_keeps_single_reply_multi_bubble_block', contractHarness.assistantSentNamePhoneDateTimeDoubleCheck({ message_id: 'z', recent_history: realBlock, structured_state: {} }) === true, 'single-reply multi-bubble block not detected')
  const singleBlock = [U('x', 'Omar System 4155550199'), A('y', 'Name : Omar System\nPhone Number : 4155550199\nAppointment date : sept 12\nTime : 2pm\n\ncan you double check this just to make sure'), U('z', 'ok')]
  check('v147_double_check_detector_keeps_single_bubble_block', contractHarness.assistantSentNamePhoneDateTimeDoubleCheck({ message_id: 'z', recent_history: singleBlock, structured_state: {} }) === true, 'single-bubble block not detected')
  // C. the date answer before the form match survives the classifier's stand-alone/question labels
  const history = [U('01', 'hey!! could i get more info?'), A('01', 'hiii!! sure!! a model spot is a spot i keep open for just a few pieces in my style and the tattoo is made from what you want 🖤'), U('02', 'i’m thinking a small dagger on my inner forearm, black and grey'), A('02', 'yeah small inner forearm dagger in black and grey sounds clean exact sizing and placement get dialed in at the appointment'), A('02', 'if you want i can send the form'), U('03', 'yes send it'), A('03', 'here you go https://www.effacermonexistence.com/apply'), A('03', 'send me a couple dates in this DM too and i ll check the schedule')]
  const text = 'Can we do fifth of September?'
  const msg = { text, message: text, message_id: '03b', received_at: '2026-09-03T16:37:53.000Z' }
  const baseState = { tattoo_intent_active: true, known_client_anchored_inspiration: true, known_design_context: 'small dagger on the inner forearm black and grey', form_offer_asked: true, form_link_sent: true, booking_stage_hint: 'awaiting_form_submission', current_message_date_local: 'September 3, 2026' }
  const annotated = annotateStructuredStateForLiveTurn(msg, { ...baseState }, history)
  check('v147_date_answer_before_form_match_has_live_date_status', annotated.live_turn_date_status === 'too_soon' && /5th of september/i.test(String(annotated.live_turn_date_phrase || '')), JSON.stringify({ status: annotated.live_turn_date_status, phrase: annotated.live_turn_date_phrase, iso: annotated.live_turn_date_iso }))
  // classifier labels merged after dm-authority (mergeIntentFlags): is_question + self-contained topic shift
  const classified = { ...annotated, live_turn_is_question: true, live_turn_self_contained_topic_shift: true, context_classifier_applied: true, llm_intent_applied: true }
  const input = { ...msg, live_message: text, recent_history: history.concat([U('03b', text)]), structured_state: classified, structured_output_required: true }
  const plan = deriveClosedTransitionPlan(input)
  check('v147_date_answer_before_form_match_outranks_classifier_standalone_flags', plan.action === 'post_form_availability' && plan.reason === 'submitted_form_date_counterproposal_outside_window', JSON.stringify({ action: plan.action, reason: plan.reason }))
  // even with the live date status stripped (a stale annotation path), the policy-resolved date still owns the route
  const stripped = { ...classified, live_turn_date_status: '', live_turn_date_phrase: '', live_turn_date_iso: '' }
  const plan2 = deriveClosedTransitionPlan({ ...input, structured_state: stripped })
  check('v147_policy_resolved_date_outranks_standalone_flags_without_live_status', plan2.action === 'post_form_availability' && plan2.reason === 'submitted_form_date_counterproposal_outside_window', JSON.stringify({ action: plan2.action, reason: plan2.reason }))
  // D. the decline is authored before the intent classifier (pre-intent lane), never a model turn
  const pre = runner.buildPreIntentOutsideWindowDeclinePacket({ ...input, control_transition_contract: plan })
  check('v147_outside_window_decline_pre_intent_lane', pre && /too soon/i.test(pre.packet.reply_text) && /earliest opening/i.test(pre.packet.reply_text) && pre.authority.model === 'none', JSON.stringify(pre && pre.packet.bubbles))
  check('v147_outside_window_decline_pre_intent_lane_yields_under_repair', runner.buildPreIntentOutsideWindowDeclinePacket({ ...input, control_transition_contract: plan, control_transition_repair: 'x' }) === null, 'pre-intent lane fired under a controller repair pass')
}

// v8 E. the executed four-field block persists durable state whichever executor produced it (model-authored block under post_form_identity).
{
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v147-executed-checkpoint-model-'))
  try {
    ensureControlDirs(stateRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, known_design_context: 'small dagger on the inner forearm black and grey', form_offer_asked: true, form_link_sent: true, form_submitted: true, known_requested_date: 'sept 12', known_requested_time: '2pm', accepted_offered_date: 'sept 12', accepted_offered_time: '2pm', booking_stage_hint: 'awaiting_form_identity_match' })}\n`)
    let clock = Date.parse('2026-09-03T16:39:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    appendControlHistoryEvent(stateRoot, { contact_id: thread, thread_id: thread, message_id: 'm6', bubble_index: 0, bubble_count: 2, bubble: { text: 'perfect sept 12 at 2pm is set' } }, 'assistant', { at: tick() })
    appendControlHistoryEvent(stateRoot, { contact_id: thread, thread_id: thread, message_id: 'm6', bubble_index: 1, bubble_count: 2, bubble: { text: 'send me your name and best number and i ll double check it' } }, 'assistant', { at: tick() })
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'm7', text: 'Omar System 4155550199', received_at: tick() }
    recordIngressEvent(stateRoot, inbound)
    const block = 'Name : Omar System\nPhone Number : 4155550199\nAppointment date : sept 12\nTime : 2:00pm\n\ncan you double check this just to make sure'
    const result = executeSingleControlTurn(inbound, {
      root: stateRoot,
      candidateGenerator: (_message, options) => {
        const packet = { bubbles: [{ text: block, delay_ms: 0 }], reply_text: block, acknowledged_fields: ['appointment_date', 'appointment_time', 'name', 'phone_number'], questioned_fields: ['double_check_confirmation'], next_action_reflected: String(options.control_transition_contract?.action || 'post_form_identity') }
        return { source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'gpt-5.4-mini-2026-03-17', executor: 'openai_responses_conversation' }, raw_text: block, packet, structured_state: { ...options.structured_state } }
      }
    })
    const committed = JSON.parse(fs.readFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), 'utf8'))
    check('v147_model_authored_executed_block_marks_state', committed.double_check_sent === true && committed.name_phone_date_time_double_check_sent === true && committed.known_name_used_on_form === 'Omar System' && committed.known_phone_used_on_form === '4155550199', JSON.stringify({ action: result && result.authority && result.authority.closed_transition_action, double_check_sent: committed.double_check_sent, name: committed.known_name_used_on_form, phone: committed.known_phone_used_on_form, stage: committed.booking_stage_hint }))
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true })
  }
}


// v8 F. A bare confirmation of the open (corrected) checkpoint keeps the corrected time in durable state.
{
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v147-confirm-keeps-corrected-time-'))
  try {
    ensureControlDirs(stateRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, known_design_context: 'reference post', form_offer_asked: true, form_link_sent: true, form_submitted: true, known_name_used_on_form: 'Omar System', known_phone_used_on_form: '4155550199', known_requested_date: 'September 10', known_requested_time: '3:00pm', last_offered_date: 'September 10', last_offered_time: '2pm', double_check_sent: true, name_phone_date_time_double_check_sent: true, booking_stage_hint: 'awaiting_double_check_confirmation' })}\n`)
    let clock = Date.parse('2026-09-03T12:10:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    appendControlHistoryEvent(stateRoot, { contact_id: thread, thread_id: thread, message_id: 'c-decline', bubble_index: 0, bubble_count: 2, bubble: { text: '5th of September is too soon for scheduling and my earliest opening is september 10 (thursday) at 2pm' } }, 'assistant', { at: tick() })
    appendControlHistoryEvent(stateRoot, { contact_id: thread, thread_id: thread, message_id: 'c-decline', bubble_index: 1, bubble_count: 2, bubble: { text: 'does september 10 (thursday) at 2pm work for you' } }, 'assistant', { at: tick() })
    appendControlHistoryEvent(stateRoot, { contact_id: thread, thread_id: thread, message_id: 'c-block', bubble_index: 0, bubble_count: 1, bubble: { text: 'Name : Omar System\nPhone Number : 4155550199\nAppointment date : 10th of September\nTime : 3pm\n\ncan you double check this just to make sure' } }, 'assistant', { at: tick() })
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'c-confirm', text: 'Yeah, perfect', received_at: tick() }
    recordIngressEvent(stateRoot, inbound)
    let result = null, error = ''
    try { result = executeSingleControlTurn(inbound, { root: stateRoot }) } catch (err) { error = String(err && err.message ? err.message : err).slice(0, 300) }
    const committed = JSON.parse(fs.readFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), 'utf8'))
    check('v147_confirmation_of_open_checkpoint_reaches_deposit', !error && result && String(result.authority?.closed_transition_action || '') === 'deposit_handoff', JSON.stringify({ error, action: result && result.authority && result.authority.closed_transition_action }))
    check('v147_confirmation_keeps_corrected_time_in_durable_state', committed.known_requested_time === '3:00pm' && committed.known_requested_date === 'September 10', JSON.stringify({ time: committed.known_requested_time, date: committed.known_requested_date, accepted_time: committed.accepted_offered_time }))
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true })
  }
}


// v9 (live 2026-09-03 18:07Z, v147 red-team case 02): a volunteered placement/size on the design turn carries its
// acknowledge-and-defer obligation into the route, the model instructions state it before the first pass, and the
// form-offer recovery line keeps it even after model exhaustion.
{
  const contractHarness = require('./scv-contract-harness.js')
  const runner = require('./codex-dm-runner.js')
  const recovery = require('./scv-deterministic-recovery.js')
  const A = (id, text) => ({ role: 'assistant', message_id: id, text })
  const U = (id, text) => ({ role: 'user', message_id: id, text })
  const history = [U('01', 'hey!! could i get more info?'), A('01', 'hiii!! sure!! a model spot is a spot i keep open for just a few pieces in my style and the tattoo is made from what you want 🖤'), A('01', 'my profile and story highlights are there for inspo and if you already have an idea i can customize it for you :) just lmk what you are into')]
  const text = 'i’m thinking a small dagger on my inner forearm, black and grey'
  const msg = { text, message: text, message_id: '02', received_at: '2026-09-03T18:07:20.000Z' }
  const baseState = { tattoo_intent_active: true, booking_stage_hint: 'design_intake', current_message_date_local: 'September 3, 2026' }
  const annotated = annotateStructuredStateForLiveTurn(msg, { ...baseState }, history)
  const input = { ...msg, live_message: text, recent_history: history.concat([U('02', text)]), structured_state: annotated, structured_output_required: true }
  const plan = deriveClosedTransitionPlan(input)
  check('v148_design_turn_routes_offer_form', plan.action === 'offer_form', JSON.stringify({ action: plan.action, reason: plan.reason }))
  check('v148_volunteered_placement_size_obligation_on_route', Array.isArray(plan.obligations) && plan.obligations.includes('acknowledge_and_defer_placement_size'), JSON.stringify(plan.obligations))
  const guidance = String(runner.buildControllerActionGuidance({ ...plan, live_intent: plan.live_intent }) || '')
  check('v148_model_instructions_state_acknowledge_and_defer_up_front', /volunteered a placement and\/or a size/i.test(guidance) && /dialed in together at the appointment/i.test(guidance) && /do not ask any placement or size question/i.test(guidance), guidance.slice(0, 400))
  const recoveryPacket = recovery.buildRouteAwareVisibleRecoveryPacket({ ...input, control_transition_contract: plan }, { action: 'offer_form', reason: 'design_direction_ready_for_form_offer' })
  const recoveryText = String(recoveryPacket?.reply_text || (recoveryPacket?.bubbles || []).map((b) => b.text).join(' \n '))
  check('v148_offer_form_recovery_acknowledges_and_defers', /that (?:size and spot|spot|size) can work/i.test(recoveryText) && /dialed in together at the appointment/i.test(recoveryText) && /want me to send the application form\?/i.test(recoveryText), recoveryText)
  check('v148_offer_form_recovery_passes_the_verifier_rule', contractHarness.packetAcknowledgesPlacementSizeAndDefers(input, recoveryPacket) === true, recoveryText)
  const plainInput = { ...input, message: 'a small dagger in black and grey', live_message: 'a small dagger in black and grey', text: 'a small dagger in black and grey', structured_state: annotateStructuredStateForLiveTurn({ ...msg, text: 'a small dagger in black and grey', message: 'a small dagger in black and grey' }, { ...baseState }, history) }
  const plainRecovery = recovery.buildRouteAwareVisibleRecoveryPacket({ ...plainInput, control_transition_contract: deriveClosedTransitionPlan(plainInput) }, { action: 'offer_form', reason: 'design_direction_ready_for_form_offer' })
  const plainText = String(plainRecovery?.reply_text || (plainRecovery?.bubbles || []).map((b) => b.text).join(' \n '))
  check('v148_offer_form_recovery_without_placement_keeps_size_acknowledgement_only_when_size_present', /that size can work/i.test(plainText) && !/spot/i.test(plainText), plainText)
}


// v10 (owner's own v148 red-team, 2026-09-03 22:53Z): the checkpoint printed
// "Name : Open file number" and then "Name : Open file" on a pure time revision.
// A stored name is authoritative; only a raw current-turn candidate is parsed.
{
  const identity = require('./scv-booking-identity.js')
  const runner = require('./codex-dm-runner.js')
  const storedInput = (name) => ({
    message: 'Can we start at 3 PM?', live_message: 'Can we start at 3 PM?', text: 'Can we start at 3 PM?', recent_history: [],
    structured_state: {
      form_submitted: true, form_link_sent: true, known_name_used_on_form: name, known_phone_used_on_form: '1231231234',
      known_requested_date: '12th of September', known_requested_time: '2pm', form_submission_source: 'gmail_form_email',
      booking_stage_hint: 'awaiting_double_check_confirmation'
    }
  })
  for (const name of ['Open file number', 'Jean Number', 'Anna Cell', 'Omar System']) {
    const plan = deriveClosedTransitionPlan(storedInput(name))
    check(`v149_stored_form_name_survives_field_normalization :: ${name}`, plan.fields.name === name, JSON.stringify({ stored: name, field: plan.fields.name }))
  }
  check('v149_stored_name_hygiene_only_trims', deriveClosedTransitionPlan(storedInput('  Omar  ')).fields.name === 'Omar', 'stored name not trimmed')
  check('v149_stored_name_rejects_valueless', identity.sanitizeStoredIdentityName('   ') === '' && identity.sanitizeStoredIdentityName('1234') === '' && identity.sanitizeStoredIdentityName('x'.repeat(61)) === '', 'stored-name validation weakened')
  // the utterance sanitizer keeps its job for a raw current-turn candidate
  const liveOnly = storedInput('')
  liveOnly.structured_state.live_turn_name_candidate = 'my name is Omar and number'
  check('v149_live_candidate_still_uses_the_utterance_sanitizer', deriveClosedTransitionPlan(liveOnly).fields.name === 'Omar', JSON.stringify(deriveClosedTransitionPlan(liveOnly).fields.name))
  check('v149_utterance_sanitizer_unchanged', identity.sanitizeBookingIdentityName('my name is Omar and number') === 'Omar' && identity.sanitizeBookingIdentityName('my name is actually Omar Sys') === 'Omar Sys', 'utterance sanitizer changed')
  void runner
}

// v10 (same incident, end to end): the owner's exact sequence — a form-sourced name,
// an open checkpoint at 2pm, then "Can we start at 3 PM?" — must reprint the SAME name.
{
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v149-stored-name-'))
  try {
    ensureControlDirs(stateRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, known_design_context: 'reference post', form_offer_asked: true, form_link_sent: true, form_submitted: true, form_submission_source: 'gmail_form_email', known_name_used_on_form: 'Open file number', known_phone_used_on_form: '1231231234', known_requested_date: '12th of September', known_requested_time: '2pm', accepted_offered_date: '12th of September', accepted_offered_time: '2pm', double_check_sent: true, name_phone_date_time_double_check_sent: true, booking_stage_hint: 'awaiting_double_check_confirmation' })}\n`)
    let clock = Date.parse('2026-09-03T12:20:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    appendControlHistoryEvent(stateRoot, { contact_id: thread, thread_id: thread, message_id: 'n-block', bubble_index: 0, bubble_count: 1, bubble: { text: 'Name : Open file number\nPhone Number : 1231231234\nAppointment date : 12th of September\nTime : 2pm\n\ncan you double check this just to make sure' } }, 'assistant', { at: tick() })
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'n-3pm', text: 'Can we start at 3 PM?', received_at: tick() }
    recordIngressEvent(stateRoot, inbound)
    let result = null, error = ''
    try { result = executeSingleControlTurn(inbound, { root: stateRoot }) } catch (err) { error = String(err && err.message ? err.message : err).slice(0, 200) }
    const visible = (Array.isArray(result?.packet?.bubbles) ? result.packet.bubbles : []).map((b) => String(b.text || '')).join('\n')
    const shown = visible.match(/^Name\s*:\s*(.+)$/m)
    const committed = JSON.parse(fs.readFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), 'utf8'))
    check('v149_time_revision_reprints_the_stored_name', Boolean(shown) && shown[1].trim() === 'Open file number', JSON.stringify({ error, shown: shown && shown[1], visible: visible.slice(0, 140) }))
    check('v149_time_revision_keeps_the_stored_name_in_state', committed.known_name_used_on_form === 'Open file number', JSON.stringify({ name: committed.known_name_used_on_form, time: committed.known_requested_time }))
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true })
  }
}


// v11 (live 2026-09-04 05:18Z, v149 red-team case 02): the design turn with a volunteered
// placement/size gets ONE model attempt, then the deterministic recovery. Three passes cost 44 s
// and ended in that same recovery line anyway.
{
  const A = (id, text) => ({ role: 'assistant', message_id: id, text })
  const U = (id, text) => ({ role: 'user', message_id: id, text })
  const history = [U('01', 'hey!! could i get more info?'), A('01', 'hiii!! sure!! a model spot is a spot i keep open for just a few pieces in my style'), A('01', 'lmk what you have in mind')]
  const text = 'i’m thinking a small dagger on my inner forearm, black and grey'
  const msg = { text, message: text, message_id: '02', received_at: '2026-09-04T05:18:30.000Z' }
  const base = { tattoo_intent_active: true, booking_stage_hint: 'design_intake', current_message_date_local: 'September 4, 2026' }
  const state = annotateStructuredStateForLiveTurn(msg, { ...base }, history)
  const input = { ...msg, live_message: text, recent_history: history.concat([U('02', text)]), structured_state: state, structured_output_required: true }
  const plan = deriveClosedTransitionPlan(input)
  check('v150_design_turn_keeps_the_volunteered_dimension_obligation', plan.action === 'offer_form' && Array.isArray(plan.obligations) && plan.obligations.includes('acknowledge_and_defer_placement_size'), JSON.stringify({ action: plan.action, obligations: plan.obligations }))
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v150-budget-'))
  try {
    ensureControlDirs(stateRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(stateRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, booking_stage_hint: 'design_intake' })}\n`)
    let clock = Date.parse('2026-09-04T05:18:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    appendControlHistoryEvent(stateRoot, { contact_id: thread, thread_id: thread, message_id: 'x1', bubble_index: 0, bubble_count: 1, bubble: { text: 'lmk what you have in mind' } }, 'assistant', { at: tick() })
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'x2', text, received_at: tick() }
    recordIngressEvent(stateRoot, inbound)
    // a model that keeps asking a size question is exactly the live failure; count the attempts
    let attempts = 0
    let result = null, error = ''
    try {
      result = executeSingleControlTurn(inbound, {
        root: stateRoot,
        candidateGenerator: (_m, options) => {
          attempts += 1
          const bad = 'love that. what size were you thinking for the forearm?'
          const packet = { bubbles: [{ text: bad, delay_ms: 0 }], reply_text: bad, acknowledged_fields: [], questioned_fields: [], next_action_reflected: String(options.control_transition_contract?.action || 'offer_form') }
          return { source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'gpt-5.4-mini-2026-03-17', executor: 'openai_responses_conversation' }, raw_text: bad, packet, structured_state: { ...options.structured_state } }
        }
      })
    } catch (err) { error = String(err && err.message ? err.message : err).slice(0, 200) }
    const visible = (Array.isArray(result?.packet?.bubbles) ? result.packet.bubbles : []).map((b) => String(b.text || '')).join(' \n ')
    // One model attempt, then the turn fails closed with a retryable control error; the inbox
    // worker arms the route-aware recovery on the next attempt (the v9 block above proves that
    // recovery line acknowledges the detail and defers it). Before this cap the same turn burned
    // three attempts and 44 s to reach the identical outcome.
    check('v150_one_model_attempt_then_fail_closed', attempts === 1, JSON.stringify({ attempts, error }))
    check('v150_failure_is_the_retryable_control_error_that_arms_recovery', /single_control_internal_retryable/.test(error) && !visible, JSON.stringify({ error: error.slice(0, 140), visible: visible.slice(0, 80) }))
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true })
  }
}


// ---------------------------------------------------------------------------
// v152 (owner directive 2026-09-05): "오후 5시가 가능할까요 하면 네 가능합니다 하고 더블
// 체크가 나와야지" — a time revision of the OPEN checkpoint is answered first, then the
// corrected four-line block follows as its own bubble. The first checkpoint, a
// too-early time and an identity revision keep the bare block / their own lanes.
{
  const { buildDeterministicBookingPacket } = require('./codex-dm-runner.js')
  const { normalizePacket } = require('./dm-authority.js')
  const { resolvedCheckpointRevisionAcknowledgement, CHECKPOINT_REVISION_ACK_VERSION } = require('./scv-checkpoint-revision-ack.js')
  check('v152_ack_module_version_pinned', CHECKPOINT_REVISION_ACK_VERSION === 'scv-checkpoint-revision-ack-2026-09-05-v1-yes-time-works-before-corrected-block', CHECKPOINT_REVISION_ACK_VERSION)

  // Runner fixed lane on the exact scenario above (open checkpoint at 2pm, "Can we do 3 PM?").
  const revisionInput = {
    message: live.text,
    live_message: live.text,
    recent_history: history,
    structured_state: { ...annotated, known_name_used_on_form: 'Codex extra high', known_phone_used_on_form: '1231231234' },
    control_transition_contract: plan
  }
  const fixed = buildDeterministicBookingPacket(revisionInput)
  const fixedBubbles = (Array.isArray(fixed?.packet?.bubbles) ? fixed.packet.bubbles : []).map((b) => String(b?.text || ''))
  check('v152_runner_fixed_lane_answers_yes_then_corrected_block',
    fixed?.authority?.executor === 'deterministic_fixed_booking_checkpoint' &&
    fixedBubbles.length === 2 &&
    fixedBubbles[0] === 'yes 3pm works' &&
    /^Name : Codex extra high\nPhone Number : 1231231234\nAppointment date : .+\nTime : 3pm\n\ncan you double check this just to make sure$/.test(fixedBubbles[1]),
    JSON.stringify({ fixedBubbles, authority: fixed?.authority }))

  // The verifier still recognises the two-bubble reply as ONE sent checkpoint (no duplicate later).
  const verdict = evaluateClosedTransitionContract(revisionInput, fixed.packet, plan)
  check('v152_two_bubble_checkpoint_passes_the_closed_transition_contract', verdict.valid === true, JSON.stringify(verdict))

  // First checkpoint (nothing revised) stays the bare block: a clean identity turn with no prior checkpoint.
  const firstHistory = [
    { role: 'assistant', text: 'https://www.effacermonexistence.com/apply' },
    { role: 'user', text: 'I just submitted' },
    { role: 'assistant', text: 'september 8 at 2pm or september 9 at 2pm also work' },
    { role: 'user', text: 'We can definitely do September 8' },
    { role: 'assistant', text: 'what name and number should i put down' }
  ]
  const firstLive = { contact_id: 'first-thread', thread_id: 'first-thread', instagram_username: 'omar.system', message_id: 'first-identity', text: 'Codex extra high 1231231234', received_at: '2026-09-01T06:35:12.014Z' }
  const firstState = annotateStructuredStateForLiveTurn(firstLive, buildStructuredState(firstLive, firstHistory), firstHistory)
  const firstPlan = deriveClosedTransitionPlan({ ...firstLive, message: firstLive.text, recent_history: firstHistory, structured_state: firstState })
  const first = buildDeterministicBookingPacket({ message: firstLive.text, live_message: firstLive.text, recent_history: firstHistory, structured_state: firstState, control_transition_contract: firstPlan })
  const firstBubbles = (Array.isArray(first?.packet?.bubbles) ? first.packet.bubbles : []).map((b) => String(b?.text || ''))
  check('v152_first_checkpoint_stays_bare_block',
    firstPlan.action === 'double_check' && firstBubbles.length === 1 && /^Name : Codex extra high\n/.test(firstBubbles[0]) && /Time : 2pm\n\ncan you double check this just to make sure$/.test(firstBubbles[0]),
    JSON.stringify({ plan: [firstPlan.action, firstPlan.reason], firstBubbles }))

  // Predicate boundaries: too-early time, identity revision, date-only revision, no revision.
  check('v152_no_ack_for_too_early_identity_or_unrevised',
    resolvedCheckpointRevisionAcknowledgement({ live_turn_checkpoint_invalidated: true, checkpoint_superseded_by_revision: true, live_turn_time_candidate: '10am', live_turn_time_status: 'too_early' }, { time: '10am' }) === '' &&
    resolvedCheckpointRevisionAcknowledgement({ live_turn_checkpoint_invalidated: true, checkpoint_superseded_by_revision: true, live_turn_checkpoint_revision_intent: 'phone', live_turn_time_candidate: '3pm' }, { time: '3pm' }) === '' &&
    resolvedCheckpointRevisionAcknowledgement({ live_turn_checkpoint_invalidated: true, checkpoint_superseded_by_revision: true, live_turn_date_phrase: 'september 12', live_turn_date_iso: '2026-09-12' }, { time: '' }) === '' &&
    resolvedCheckpointRevisionAcknowledgement({ live_turn_time_phrase: '2pm' }, { time: '2pm' }) === '',
    'boundaries')
  check('v152_date_and_time_revision_names_both',
    resolvedCheckpointRevisionAcknowledgement({ live_turn_checkpoint_invalidated: true, checkpoint_superseded_by_revision: true, live_turn_time_candidate: '3pm', live_turn_time_status: 'legal', live_turn_date_phrase: 'September 12', live_turn_date_iso: '2026-09-12' }, { time: '3pm' }) === 'yes september 12 at 3pm works',
    'date+time')

  // The dm-authority canonicalizer keeps the acknowledgement bubble and still canonicalizes the block.
  const normalized = normalizePacket({ bubbles: [{ text: 'yes 3pm works', delay_ms: 0 }, { text: 'Name: Codex extra high\nPhone: 1231231234\nAppointment date: september 8\nTime: 3pm\ncan you double check this just to make sure', delay_ms: 0 }] })
  check('v152_canonicalizer_keeps_leading_acknowledgement',
    normalized.bubbles.length === 2 && normalized.bubbles[0].text === 'yes 3pm works' && /^Name : Codex extra high\nPhone Number : 1231231234\nAppointment date : 8th of September\nTime : 3pm\n\ncan you double check this just to make sure$/.test(normalized.bubbles[1].text),
    JSON.stringify(normalized.bubbles))
  const stripped = normalizePacket({ bubbles: [{ text: 'sounds great, here is the summary', delay_ms: 0 }, { text: 'Name: A\nPhone: 1\nAppointment date: september 8\nTime: 3pm\ncan you double check this just to make sure', delay_ms: 0 }] })
  check('v152_canonicalizer_still_strips_other_prose', stripped.bubbles.length === 1 && /^Name : A\n/.test(stripped.bubbles[0].text), JSON.stringify(stripped.bubbles))
}


// ---------------------------------------------------------------------------
// v153 (live 2026-09-05 21:56Z, Omar.system, production v152): after "Can you also do
// black and gray?" the client sent an image and, six seconds later, "I'm thinking of
// this one". Vision labelled the image unknown, the coalesced live text replaced the
// client's words, the turn fell to the non-tattoo host lead, the model asked a size
// question three times (each stripped), and 80 s later the reply was the checkpoint
// flavoured generic ask ("i see your message nothing is changed on my side yet what
// should i take care of first?"). Locked here: the nominated visual is design
// authority, every pre-checkpoint route owns its recovery line, budget two passes.
{
  const { buildRouteAwareVisibleRecoveryPacket: recoveryPacket } = require('./scv-deterministic-recovery.js')
  const { liveNominatesCurrentVisualAsIdea, SCV_CONTRACT_HARNESS_LOCK_VERSION } = require('./scv-contract-harness.js')
  check('v153_contract_behavior_carried_by_current_v129', SCV_CONTRACT_HARNESS_LOCK_VERSION === 'scv-contract-harness-lock-2026-09-08-v129-context-grounded-client-intent', SCV_CONTRACT_HARNESS_LOCK_VERSION)
  const v153History = [
    { role: 'user', text: 'hey can i get some info?' },
    { role: 'assistant', text: 'hiii sure thing!! a model spot is a limited spot i open for a few pieces in my style and we make the tattoo from what you want' },
    { role: 'user', text: 'Can you also do black and gray?' },
    { role: 'assistant', text: 'yeah black and grey works for me lmk what you have in mind' }
  ]
  const run = (label, text, extra, selector) => {
    const live = { contact_id: 'v153-thread', thread_id: 'v153-thread', instagram_username: 'omar.system', message_id: `v153-${label}`, text, received_at: '2026-09-05T21:56:30.000Z' }
    const base = { ...buildStructuredState(live, v153History), ...extra, ...(selector ? { live_turn_client_selector_text: selector } : {}) }
    const state = annotateStructuredStateForLiveTurn(live, base, v153History)
    const input = { ...live, message: text, live_message: text, recent_history: v153History, structured_state: state }
    const plan = deriveClosedTransitionPlan(input)
    let packet = null, visible = '', verdict = { valid: false, reason: 'not_built' }
    try {
      packet = recoveryPacket(input, plan)
      visible = packet.bubbles.map((b) => String(b.text || '')).join(' | ')
      verdict = evaluateClosedTransitionContract(input, packet, plan)
    } catch (err) { visible = `ERR ${String(err && err.message ? err.message : err)}` }
    return { state, plan, visible, verdict }
  }
  const unknownImage = { live_turn_is_media_reference: true, live_turn_media_category: 'unknown', reference_media_classification_observed: true, tattoo_intent_active: true }
  const swallow = 'sent a reference post: a drawing of a swallow holding a ribbon in its beak'
  const live = run('live', swallow, unknownImage, "I'm thinking of this one")
  check('v153_nominated_unknown_image_is_design_authority_offer_form',
    live.plan.action === 'offer_form' && live.state.known_client_anchored_inspiration === true,
    JSON.stringify({ action: live.plan.action, reason: live.plan.reason }))
  check('v153_nominated_image_recovery_is_the_reference_offer_line',
    /starting point/.test(live.visible) && /want me to send the application form\?$/.test(live.visible) && live.verdict.valid === true,
    JSON.stringify({ visible: live.visible, verdict: live.verdict.reason }))
  const genericAsk = /nothing is changed on my side|what should i take care of first|what do you want me to handle first|which part do you want me to handle first/i
  const silent = run('silent', swallow, unknownImage, '')
  check('v153_unknown_image_without_words_keeps_host_lead_with_an_image_question',
    silent.plan.action === 'general_continue' && silent.plan.reason === 'non_tattoo_media_requires_contextual_host_lead' &&
    /image/.test(silent.visible) && /\?$/.test(silent.visible) && !genericAsk.test(silent.visible) && silent.verdict.valid === true,
    JSON.stringify({ plan: [silent.plan.action, silent.plan.reason], visible: silent.visible }))
  const screenshot = run('screenshot', 'sent a reference post: a screenshot of a website dashboard', { ...unknownImage, live_turn_media_category: 'non_tattoo' }, "I'm thinking of this one")
  check('v153_screenshot_nomination_never_unlocks_the_form',
    screenshot.plan.action === 'general_continue' && screenshot.state.known_client_anchored_inspiration !== true && !/application form/.test(screenshot.visible),
    JSON.stringify({ plan: [screenshot.plan.action, screenshot.plan.reason], visible: screenshot.visible }))
  const pointer = run('pointer', 'this one', { tattoo_intent_active: true }, '')
  check('v153_bare_pointer_without_media_still_asks_for_the_media',
    pointer.plan.action === 'resolve_context' && pointer.plan.reason === 'missing_attachment' && /send me the photo or reference/.test(pointer.visible) && pointer.verdict.valid === true,
    JSON.stringify({ plan: [pointer.plan.action, pointer.plan.reason], visible: pointer.visible, verdict: pointer.verdict.reason }))
  const intake = run('intake', 'i want to get a tattoo', { tattoo_intent_active: true }, '')
  check('v153_design_intake_recovery_is_a_design_lead_not_the_checkpoint_ask',
    intake.plan.action === 'design_intake' && !genericAsk.test(intake.visible) && /\?/.test(intake.visible) && intake.verdict.valid === true,
    JSON.stringify({ plan: [intake.plan.action, intake.plan.reason], visible: intake.visible }))
  const tattooRef = run('tattooref', 'sent a reference post: a black and grey snake tattoo on a forearm', { ...unknownImage, live_turn_media_category: 'tattoo_reference' }, 'Can we do something like this?')
  check('v153_tattoo_reference_caption_still_offer_form', tattooRef.plan.action === 'offer_form', JSON.stringify([tattooRef.plan.action, tattooRef.plan.reason]))
  // predicate boundaries
  const nominate = (text, state) => liveNominatesCurrentVisualAsIdea({ message: text, live_message: text, recent_history: [], structured_state: state })
  check('v153_nomination_predicate_boundaries',
    nominate('sent a reference post: a drawing of a fox', { live_turn_is_media_reference: true, live_turn_media_category: 'unknown', live_turn_client_selector_text: 'something like this' }) === true &&
    nominate('sent a reference post: a drawing of a fox', { live_turn_is_media_reference: true, live_turn_media_category: 'unknown', live_turn_client_selector_text: 'this one' }) === true &&
    nominate('sent a reference post: a drawing of a fox', { live_turn_is_media_reference: true, live_turn_media_category: 'unknown', live_turn_client_selector_text: 'lol' }) === false &&
    nominate('this one', { live_turn_media_category: '' }) === false &&
    nominate('sent a reference post: a selfie of a person', { live_turn_is_media_reference: true, live_turn_media_category: 'non_tattoo', live_turn_client_selector_text: 'this one' }) === false,
    'boundaries')
  // the checkpoint-flavoured ask survives only once a booking exists
  const booked = run('booked', 'hold on one sec', { tattoo_intent_active: true, form_link_sent: true, form_submitted: true, known_requested_date: 'september 12', known_requested_time: '2pm', known_name_used_on_form: 'A B', known_phone_used_on_form: '4155550199', double_check_sent: true, name_phone_date_time_double_check_sent: true, booking_stage_hint: 'awaiting_double_check_confirmation' }, '')
  check('v153_booking_stage_keeps_its_checkpoint_recovery_not_a_design_lead',
    !/what are you thinking of getting|what did you have in mind|what are you picturing|i see the image/i.test(booked.visible),
    JSON.stringify({ plan: [booked.plan.action, booked.plan.reason], visible: booked.visible }))
  // pass budget: the design route gets one re-author, not two
  const budgetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v153-budget-'))
  try {
    ensureControlDirs(budgetRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(budgetRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, booking_stage_hint: 'design_intake' })}\n`)
    let clock = Date.parse('2026-09-05T21:56:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    appendControlHistoryEvent(budgetRoot, { contact_id: thread, thread_id: thread, message_id: 'b1', bubble_index: 0, bubble_count: 1, bubble: { text: 'yeah black and grey works for me lmk what you have in mind' } }, 'assistant', { at: tick() })
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'b2', text: 'i want to get a tattoo', received_at: tick() }
    recordIngressEvent(budgetRoot, inbound)
    let attempts = 0; let error = ''; let result = null; let seenAction = ''
    try {
      result = executeSingleControlTurn(inbound, {
        root: budgetRoot,
        candidateGenerator: (_m, options) => {
          attempts += 1; seenAction = String(options.control_transition_contract?.action || '')
          const bad = 'love that. what size were you thinking for the forearm?'
          const packet = { bubbles: [{ text: bad, delay_ms: 0 }], reply_text: bad, acknowledged_fields: [], questioned_fields: [], next_action_reflected: seenAction || 'design_intake' }
          return { source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'gpt-5.4-mini-2026-03-17', executor: 'openai_responses_conversation' }, raw_text: bad, packet, structured_state: { ...options.structured_state } }
        }
      })
    } catch (err) { error = String(err && err.message ? err.message : err).slice(0, 200) }
    check('v153_design_route_gets_two_passes_then_fails_closed',
      seenAction === 'design_intake' && attempts === 2 && /single_control_internal_retryable/.test(error) && !result,
      JSON.stringify({ seenAction, attempts, error }))
  } finally {
    fs.rmSync(budgetRoot, { recursive: true, force: true })
  }
}


// ---------------------------------------------------------------------------
// v154 (live 2026-09-06 01:23-01:27Z, Omar.system, production v153): "Sure it's free?" waited
// 50 s and got the fixed price line; "It's kinda expensive I thought it's free?" waited 81 s
// and got the identical line. Neither was recognised as a price question, the tattoo lane
// demanded forward motion, the model's price answer + size question was stripped and then
// rejected whole by the non-authoring guard, and the one-wording recovery line repeated.
{
  const { verifyPostFilterAdoption: verifyAdoption, buildPreIntentGenericInfoPacket: fastPath, evaluateGenericInfoFastPathForInput: fastEligible } = require('./codex-dm-runner.js')
  const { buildRouteAwareVisibleRecoveryPacket: recoveryPacket2 } = require('./scv-deterministic-recovery.js')
  const { priceAnswerPresent, SCV_CLOSED_TRANSITION_CONTRACT_VERSION: contractVersion } = require('./scv-closed-transition-contract.js')
  const { textAsksPricingOrPolicy: asksPriceText, SCV_CONTRACT_HARNESS_LOCK_VERSION: lockVersion } = require('./scv-contract-harness.js')
  check('v159_versions_pinned',
    contractVersion === 'scv-closed-transition-contract-2026-09-08-v86-artist-biography-is-not-client-intent' &&
    lockVersion === 'scv-contract-harness-lock-2026-09-08-v129-context-grounded-client-intent',
    JSON.stringify([contractVersion, lockVersion]))
  check('v154_its_free_and_expensive_are_price_questions',
    ["Sure it's free?", "It's kinda expensive I thought it's free?", 'wait is this free', 'i thought it was free', 'is it free?'].every((t) => asksPriceText(t) === true) &&
    ['feel free to send it over', 'are you free tomorrow?', 'you free this weekend', 'free time on saturday?', 'this is perfect', 'that seems pricey', 'my budget is tight'].every((t) => asksPriceText(t) === false),
    'price regex boundaries')
  const priceHistory = [
    { role: 'user', text: 'hey can i get some info?' },
    { role: 'assistant', text: 'hiii sure thing!! a model spot is a limited spot i open for a few pieces in my style and we make the tattoo from what you want' },
    { role: 'user', text: 'i want a small dagger on my forearm' },
    { role: 'assistant', text: 'small dagger on the forearm is clean want me to send the application form?' }
  ]
  const mkPrice = (text, hist) => {
    const live = { contact_id: 'v154-thread', thread_id: 'v154-thread', instagram_username: 'omar.system', message_id: `v154-${text.length}-${hist.length}`, text, received_at: '2026-09-06T01:24:27.000Z' }
    const state = annotateStructuredStateForLiveTurn(live, { ...buildStructuredState(live, hist), tattoo_intent_active: true, form_offer_asked: true }, hist)
    const input = { ...live, message: text, live_message: text, recent_history: hist, structured_state: state }
    input.control_transition_contract = deriveClosedTransitionPlan(input)
    return input
  }
  const priceTurn = mkPrice("Sure it's free?", priceHistory)
  check('v154_free_question_carries_the_price_obligation',
    Array.isArray(priceTurn.control_transition_contract.obligations) && priceTurn.control_transition_contract.obligations.includes('answer_model_rate'),
    JSON.stringify(priceTurn.control_transition_contract.obligations))
  const priceAnswer = 'not free it is my discounted model rate at $150 per hour when the finished piece stays in my style'
  const strippedDraft = (mutations) => ({ bubbles: [{ text: priceAnswer, delay_ms: 0 }], reply_text: priceAnswer, acknowledged_fields: [], questioned_fields: [], next_action_reflected: priceTurn.control_transition_contract.action, non_authoring_surface_mutations: mutations })
  const adoption = verifyAdoption(priceTurn, strippedDraft(['size_or_placement_question_violation']))
  const transition = evaluateClosedTransitionContract(priceTurn, strippedDraft(['size_or_placement_question_violation']), priceTurn.control_transition_contract)
  check('v154_price_answer_with_only_the_size_question_deleted_ships',
    adoption.valid === true && transition.valid === true,
    JSON.stringify({ adoption: adoption.reason, transition: transition.reason }))
  const rejectedStill = verifyAdoption(priceTurn, strippedDraft(['fresh_greeting_missing']))
  check('v154_missing_content_mutations_still_force_reauthor', rejectedStill.valid === false && rejectedStill.reason === 'non_authoring_guard_requires_model_reauthor', JSON.stringify(rejectedStill))
  const rec1 = recoveryPacket2(priceTurn, priceTurn.control_transition_contract)
  const rec1Text = rec1.bubbles.map((b) => String(b.text || '')).join(' | ')
  const secondTurn = mkPrice("It's kinda expensive I thought it's free?", [...priceHistory, { role: 'assistant', text: rec1Text }])
  const rec2 = recoveryPacket2(secondTurn, secondTurn.control_transition_contract)
  const rec2Text = rec2.bubbles.map((b) => String(b.text || '')).join(' | ')
  // v157: the second price question is answered from memory — the recovery never speaks the rate twice
  const { textStatesModelRate: statesRate157 } = require('./scv-contract-harness.js')
  check('v154_price_recovery_rotates_and_never_repeats_the_thread',
    rec1Text !== rec2Text && priceAnswerPresent(rec1) && !statesRate157(rec2Text) && /mentioned|said before|from earlier/i.test(rec2Text) &&
    (secondTurn.control_transition_contract.obligations || []).includes('acknowledge_rate_already_given') &&
    evaluateClosedTransitionContract(priceTurn, rec1, priceTurn.control_transition_contract).valid === true &&
    evaluateClosedTransitionContract(secondTurn, rec2, secondTurn.control_transition_contract).valid === true,
    JSON.stringify({ rec1Text, rec2Text, obligations: secondTurn.control_transition_contract.obligations }))
  // the fixed info answer yields when an earlier message of theirs is still unanswered
  const infoLive = { contact_id: 'v154-info', thread_id: 'v154-info', instagram_username: 'omar.system', message_id: 'v154-info-1', text: 'hey can i get more info?', received_at: '2026-09-06T01:23:24.000Z' }
  const infoState = annotateStructuredStateForLiveTurn(infoLive, buildStructuredState(infoLive, []), [])
  const infoInput = { ...infoLive, message: infoLive.text, live_message: infoLive.text, recent_history: [], structured_state: infoState }
  const unansweredSinceReply = [{ role: 'assistant_attempted', text: 'hiii sure thing!! a model spot is a limited spot i open for a few pieces in my style', message_id: 'a1' }, { role: 'user', text: 'can you do fine line?', message_id: 'u1' }]
  const answeredEarlier = [{ role: 'user', text: 'can you do fine line?', message_id: 'u0' }, { role: 'assistant_attempted', text: 'yeah fine line is a big part of my work', message_id: 'a0' }]
  check('v154_fast_path_yields_only_to_a_client_turn_since_our_last_reply',
    fastEligible(infoInput).eligible === true && fastPath(infoInput) !== null &&
    fastPath({ ...infoInput, recent_history: unansweredSinceReply }) === null &&
    fastPath({ ...infoInput, recent_history: answeredEarlier }) !== null,
    'fast path backlog boundary')
  // the gate covers the conversational lanes only: a post-form required-field re-ask after a
  // third party's phone number is the same fixed question by design
  const { repeatedVisibleLineVerdict } = require('./scv-single-control-plane.js')
  const reAsk = 'perfect august 30 at 2pm works what name and phone number did you use on the form?'
  const reAskHistory = [{ role: 'assistant', text: reAsk, delivery_status: 'verified' }, { role: 'user', text: "My friend Alex's phone is 415-555-0199" }]
  const reAskPacket = { bubbles: [{ text: reAsk, delay_ms: 0 }] }
  check('v154_repeat_gate_exempts_booking_state_reasks_and_gates_conversational_lanes',
    repeatedVisibleLineVerdict(reAskPacket, reAskHistory, { action: 'post_form_identity' }).valid === true &&
    repeatedVisibleLineVerdict(reAskPacket, reAskHistory, { action: 'post_form_time' }).valid === true &&
    repeatedVisibleLineVerdict(reAskPacket, reAskHistory, { action: 'double_check' }).valid === true &&
    repeatedVisibleLineVerdict(reAskPacket, reAskHistory, { action: 'send_form' }).valid === true &&
    repeatedVisibleLineVerdict(reAskPacket, reAskHistory, { action: 'tattoo_continue' }).valid === false &&
    repeatedVisibleLineVerdict(reAskPacket, reAskHistory, { action: 'design_intake' }).reason === 'visible_line_repeats_previous_assistant_line' &&
    repeatedVisibleLineVerdict(reAskPacket, reAskHistory, { action: 'general_continue' }).valid === false,
    'repeat gate lane boundary')
  // repeat gate end to end: the same line twice is rejected, a fresh line is accepted on pass 2
  const repeatRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v154-repeat-'))
  try {
    ensureControlDirs(repeatRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(repeatRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, booking_stage_hint: 'design_intake' })}\n`)
    let clock = Date.parse('2026-09-06T01:20:00.000Z')
    const tick = () => { clock += 4000; return new Date(clock).toISOString() }
    const lead = 'what are you thinking of getting? send me an idea or a reference and i will take it from there'
    appendControlHistoryEvent(repeatRoot, { contact_id: thread, thread_id: thread, message_id: 'rg1', bubble_index: 0, bubble_count: 1, bubble: { text: lead } }, 'assistant', { at: tick(), delivery_status: 'verified' })
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'rg2', text: 'hmm not sure yet honestly', received_at: tick() }
    recordIngressEvent(repeatRoot, inbound)
    let attempts = 0
    const result = executeSingleControlTurn(inbound, {
      root: repeatRoot,
      candidateGenerator: (_m, options) => {
        attempts += 1
        const text = attempts === 1 ? lead : 'no rush at all what kind of vibe are you drawn to? dark and bold or soft and fine line'
        return { source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'gpt-5.4-mini-2026-03-17', executor: 'openai_responses_conversation' }, raw_text: text, packet: { bubbles: [{ text, delay_ms: 0 }], reply_text: text, acknowledged_fields: [], questioned_fields: [], next_action_reflected: String(options.control_transition_contract?.action || 'design_intake') }, structured_state: { ...options.structured_state } }
      }
    })
    const finalText = (result.packet?.bubbles || []).map((b) => String(b.text || '')).join(' | ')
    check('v154_repeat_gate_rejects_the_repeated_line_then_accepts_fresh_words',
      attempts === 2 && result.authority?.control_candidate_passes === 2 &&
      (result.authority?.control_verifier_rejection_reasons || []).includes('semantic:visible_line_repeats_previous_assistant_line') &&
      finalText !== lead,
      JSON.stringify({ attempts, passes: result.authority?.control_candidate_passes, reasons: result.authority?.control_verifier_rejection_reasons, finalText }))
  } finally {
    fs.rmSync(repeatRoot, { recursive: true, force: true })
  }

  // ---- v155 (live 2026-09-06 04:26Z): a style question is answered, the design is seen, THEN the form ----
  const { liveAsksTattooCapabilityScope, liveHasConcreteDesignDirection } = require('./scv-contract-harness.js')
  const bgText = 'Do you also do black and gray and or line work'
  check('v155_style_list_question_is_capability_not_design',
    [bgText, 'do you also do black and gray or line work?', 'do you do line work', 'black and gray or color?', 'can you do fine line and black and grey'].every((t) =>
      liveAsksTattooCapabilityScope({ message: t }) === true && liveHasConcreteDesignDirection({ message: t, structured_state: {} }) === false) &&
    ['i want something black and gray', 'fine line please', 'black and gray'].every((t) => liveHasConcreteDesignDirection({ message: t, structured_state: {} }) === false) &&
    liveHasConcreteDesignDirection({ message: 'a black and gray snake on my shoulder', structured_state: {} }) === true &&
    liveHasConcreteDesignDirection({ message: 'can you do a black and gray portrait of my dog?', structured_state: {} }) === true,
    'style-only boundary')
  const bgRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v155-bg-'))
  try {
    ensureControlDirs(bgRoot)
    const thread = '1537753982'
    let clock = Date.parse('2026-09-06T04:26:19.000Z')
    const tick = (ms) => { clock += ms; return new Date(clock).toISOString() }
    const opener = [
      'hiii!! sure!! so a model spot is one of the few spots i open for pieces made from what you want while the finished tattoo stays in my style 🖤',
      'you can look through my profile and story highlights for inspo or if you already have something in mind i can customize a piece for you :) just send me any loose idea or reference'
    ]
    const t1 = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'bg-1', text: 'Hi can I get more information?', received_at: new Date(clock).toISOString() }
    recordIngressEvent(bgRoot, t1)
    executeSingleControlTurn(t1, { root: bgRoot, candidateGenerator: (_m, o) => ({ source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'stub', executor: 'stub' }, raw_text: opener.join('\n'), packet: { bubbles: opener.map((text) => ({ text, delay_ms: 0 })) }, structured_state: o?.structured_state_override }) })
    const t2 = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'bg-2', text: bgText, received_at: tick(20000) }
    recordIngressEvent(bgRoot, t2)
    const offending = ['yeah i can do black and gray and line work', 'if you want i can send the form']
    const good = ['yeah i do black and gray and line work 🖤', 'what are you thinking of getting? send me an idea or a reference and i will take it from there']
    const plans = []
    let attempts = 0
    const r2 = executeSingleControlTurn(t2, { root: bgRoot, candidateGenerator: (_m, o) => {
      attempts += 1
      plans.push({ action: o?.control_transition_contract?.action, reason: o?.control_transition_contract?.reason, obligations: o?.control_transition_contract?.obligations, known_design_context: o?.structured_state_override?.known_design_context })
      const text = attempts === 1 ? offending : good
      return { source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'stub', executor: 'stub' }, raw_text: text.join('\n'), packet: { bubbles: text.map((t) => ({ text: t, delay_ms: 0 })) }, structured_state: o?.structured_state_override }
    } })
    const finalText = (r2.packet?.bubbles || []).map((b) => String(b.text || '')).join(' | ')
    check('v155_capability_question_routes_to_design_intake_with_the_answer_obligation',
      plans[0]?.action === 'design_intake' && !String(plans[0]?.known_design_context || '').trim() && (plans[0]?.obligations || []).includes('answer_tattoo_capability_scope'),
      JSON.stringify(plans[0]))
    check('v155_form_offer_after_style_question_is_rejected_then_answer_plus_design_lead_ships',
      attempts === 2 && (r2.authority?.control_verifier_rejection_reasons || []).some((r) => String(r).includes('closed_transition_form_before_design')) && finalText === good.join(' | '),
      JSON.stringify({ attempts, reasons: r2.authority?.control_verifier_rejection_reasons, finalText }))
    check('v155_state_keeps_no_design_context_and_no_open_form_offer',
      !String(r2.structured_state?.known_design_context || '').trim() && r2.structured_state?.form_offer_asked !== true && String(r2.structured_state?.booking_stage_hint || '') === 'design_intake',
      JSON.stringify({ kdc: r2.structured_state?.known_design_context, form_offer_asked: r2.structured_state?.form_offer_asked, stage: r2.structured_state?.booking_stage_hint }))
    // the deterministic recovery for this plan answers the capability, then pulls the idea, and passes the contract
    const recoveryInput = { ...t2, message: t2.text, live_message: t2.text, recent_history: [], structured_state: annotateStructuredStateForLiveTurn(t2, buildStructuredState(t2, []), []) }
    const recoveryPlan = { action: 'design_intake', reason: 'tattoo_lane_missing_design_direction', obligations: ['answer_tattoo_capability_scope'], fields: {} }
    const recPacket = recoveryPacket2(recoveryInput, recoveryPlan)
    const recText = (recPacket.bubbles || []).map((b) => String(b.text || '')).join(' | ')
    check('v155_recovery_answers_capability_then_pulls_the_idea',
      /black and gray and line work are both part of what i do/.test(recText) && /\?/.test(recText) && !/form/i.test(recText) &&
      evaluateClosedTransitionContract(recoveryInput, recPacket, recoveryPlan).valid === true,
      JSON.stringify({ recText, verdict: evaluateClosedTransitionContract(recoveryInput, recPacket, recoveryPlan) }))
  } finally {
    fs.rmSync(bgRoot, { recursive: true, force: true })
  }

  // ---- v156 (live 2026-09-06 15:34Z): the rate is a boundary — spoken only on a direct ask ----
  const { textAsksPricingOrPolicy: asksPrice156, textMentionsCostConcern, packetStatesModelRate } = require('./scv-contract-harness.js')
  const budgetText = "So, oops, my budget is tight. How long do you think it's gonna take?"
  check('v156_budget_and_duration_are_not_price_questions',
    [budgetText, 'my budget is tight', 'that is expensive', 'how long will it take?', 'how many sessions'].every((x) => asksPrice156(x) === false) &&
    ['is it free?', 'how much is it', "what's your rate", 'wait how much was it again?'].every((x) => asksPrice156(x) === true) &&
    textMentionsCostConcern(budgetText) === true && packetStatesModelRate({ bubbles: [{ text: 'a $100 deposit confirms it' }] }) === false,
    'price boundary')
  const pbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v156-pb-'))
  try {
    ensureControlDirs(pbRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(pbRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, known_design_context: 'a snake on my forearm', form_offer_asked: true, form_link_sent: true, booking_stage_hint: 'awaiting_form_submission' })}\n`)
    let clock = Date.parse('2026-09-06T15:32:30.000Z')
    const tick = () => { clock += 30000; return new Date(clock).toISOString() }
    appendControlHistoryEvent(pbRoot, { contact_id: thread, thread_id: thread, message_id: 'pb-a1', bubble_index: 0, bubble_count: 1, bubble: { text: 'here is the form https://www.effacermonexistence.com/apply fill it out and tell me a couple dates that work' } }, 'assistant', { at: tick(), delivery_status: 'verified' })
    const askFree = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'pb-u1', text: "I'm only available on weekends. Also, is it free?", received_at: tick() }
    recordIngressEvent(pbRoot, askFree)
    // the price turn is processed by a real control turn (as production did at 15:33Z), so it is answered, not pending
    // the weekend constraint makes the contract demand a grounded weekend slot with the rate answer
    const priceAnswer = ['weekends work — would sunday september 13 at 2pm work for you?', 'and it is not free — it is the discounted model rate, $150 an hour, as long as the finished piece stays in my style']
    const r2free = executeSingleControlTurn(askFree, { root: pbRoot, candidateGenerator: (_m, o) => ({ source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'stub', executor: 'stub' }, raw_text: priceAnswer.join('\n'), packet: { bubbles: priceAnswer.map((x) => ({ text: x, delay_ms: 0 })) }, structured_state: o?.structured_state_override }) })
    check('v156_direct_free_question_after_the_form_link_gets_the_rate',
      (r2free.packet?.bubbles || []).some((b) => /150/.test(String(b.text || ''))),
      JSON.stringify({ reasons: r2free.authority?.control_verifier_rejection_reasons, text: (r2free.packet?.bubbles || []).map((b) => b.text) }))
    // production publishes the accepted bubbles into the conversation ledger through the outbox;
    // mirror that so the price question counts as answered, not pending
    ;(r2free.packet?.bubbles || []).forEach((bubble, index, all) => {
      // the ledger keys an assistant bubble by the inbound message it answers (as the outbox does)
      appendControlHistoryEvent(pbRoot, { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: askFree.message_id, bubble_index: index, bubble_count: all.length, bubble: { text: String(bubble.text || '') } }, 'assistant', { at: tick(), delivery_status: 'harness_visible', delivery_confirmed: true, proof_mode: 'local_divergence_harness_proof' })
    })
    clock += 30000
    const budgetTurn = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'pb-u2', text: budgetText, received_at: tick() }
    recordIngressEvent(pbRoot, budgetTurn)
    const withRate = ['totally get it! just so you have it again, the model rate is $150 an hour while the piece stays in my style', 'how long depends on the piece and we set that at the appointment', 'does sunday september 13 at 2pm still work for you?']
    // v162: a budget remark holds the booking motion — the compliant second draft asks the budget and frames the limited spots
    const noRate = ['totally get it 🖤 how long depends on the piece and we set that at the appointment', 'what budget are you working with? the model spots are limited and this rate is only open right now, so give me your range and i will shape the piece around it']
    let attempts = 0
    const plans = []
    const r3 = executeSingleControlTurn(budgetTurn, { root: pbRoot, candidateGenerator: (_m, o) => {
      attempts += 1
      plans.push({ action: o?.control_transition_contract?.action, obligations: o?.control_transition_contract?.obligations })
      const text = attempts === 1 ? withRate : noRate
      return { source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'stub', executor: 'stub' }, raw_text: text.join('\n'), packet: { bubbles: text.map((x) => ({ text: x, delay_ms: 0 })) }, structured_state: o?.structured_state_override }
    } })
    const finalText3 = (r3.packet?.bubbles || []).map((b) => String(b.text || '')).join(' | ')
    check('v156_budget_turn_carries_no_price_obligation',
      plans.length > 0 && !(plans[0]?.obligations || []).includes('answer_model_rate'),
      JSON.stringify(plans[0]))
    check('v162_budget_remark_routes_to_the_budget_objection_hold', plans.length > 0 && plans[0]?.action === 'budget_objection_hold', JSON.stringify(plans[0]))
    check('v156_restated_rate_after_budget_remark_is_rejected_then_no_rate_reply_ships',
      attempts === 2 && (r3.authority?.control_verifier_rejection_reasons || []).some((x) => /price_(?:restated_after_disclosure|disclosed_without_direct_question)/.test(String(x))) && finalText3 === noRate.join(' | ') && !packetStatesModelRate(r3.packet),
      JSON.stringify({ attempts, reasons: r3.authority?.control_verifier_rejection_reasons, finalText3 }))
  } finally {
    fs.rmSync(pbRoot, { recursive: true, force: true })
  }

  // ---- v157 (live 2026-09-06 21:41Z): the rate is spoken once; the second price question is answered from memory ----
  const { modelRateAlreadyDisclosed, textStatesModelRate } = require('./scv-contract-harness.js')
  const poRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v157-po-'))
  try {
    ensureControlDirs(poRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(poRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, known_design_context: 'a snake on my forearm', form_offer_asked: true, form_link_sent: true, booking_stage_hint: 'awaiting_form_submission' })}\n`)
    let clock = Date.parse('2026-09-06T21:40:00.000Z')
    const tick = () => { clock += 30000; return new Date(clock).toISOString() }
    const publish = (inbound, result) => (result.packet?.bubbles || []).forEach((bubble, index, all) => appendControlHistoryEvent(poRoot, { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: inbound.message_id, bubble_index: index, bubble_count: all.length, bubble: { text: String(bubble.text || '') } }, 'assistant', { at: tick(), delivery_status: 'harness_visible', delivery_confirmed: true, proof_mode: 'local_divergence_harness_proof' }))
    appendControlHistoryEvent(poRoot, { contact_id: thread, thread_id: thread, message_id: 'po-a1', bubble_index: 0, bubble_count: 1, bubble: { text: 'here is the form https://www.effacermonexistence.com/apply fill it out and tell me a couple dates that work' } }, 'assistant', { at: tick(), delivery_status: 'verified' })
    const howMuch = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'po-u1', text: 'How much is it by the way?', received_at: tick() }
    recordIngressEvent(poRoot, howMuch)
    const rateAnswer = ['it is the discounted model rate, $150 an hour, as long as the finished piece stays in my style', 'what dates are easiest for you?']
    const rHow = executeSingleControlTurn(howMuch, { root: poRoot, candidateGenerator: (_m, o) => ({ source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'stub', executor: 'stub' }, raw_text: rateAnswer.join('\n'), packet: { bubbles: rateAnswer.map((x) => ({ text: x, delay_ms: 0 })) }, structured_state: o?.structured_state_override }) })
    check('v157_first_price_question_gets_the_rate_once',
      (rHow.packet?.bubbles || []).some((b) => textStatesModelRate(String(b.text || ''))),
      JSON.stringify({ reasons: rHow.authority?.control_verifier_rejection_reasons, text: (rHow.packet?.bubbles || []).map((b) => b.text) }))
    publish(howMuch, rHow)
    clock += 30000
    const thoughtFree = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'po-u2', text: "I thought it's free though", received_at: tick() }
    recordIngressEvent(poRoot, thoughtFree)
    const withRate = ['nah not free', 'it is the model rate, $150 an hour while the piece stays in my style', 'what dates work for you?']
    // the follow-up line must differ from the earlier availability ask (the v154 repeat gate is live in this lane)
    // v162: "I thought it's free though" is a cost objection — the compliant draft answers from memory, asks the budget and frames the limited spots (no dates)
    const fromMemory = ['nah it is not free — it is the model rate i mentioned earlier, that part stays the same 🖤', 'what budget are you working with? these model spots are limited and only open right now, so tell me your range and i will shape the piece to fit']
    let attempts = 0
    const plans = []
    const rFree = executeSingleControlTurn(thoughtFree, { root: poRoot, candidateGenerator: (_m, o) => {
      attempts += 1
      plans.push({ action: o?.control_transition_contract?.action, obligations: o?.control_transition_contract?.obligations, disclosed: o?.structured_state_override?.known_model_rate_disclosed })
      const text = attempts === 1 ? withRate : fromMemory
      return { source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'stub', executor: 'stub' }, raw_text: text.join('\n'), packet: { bubbles: text.map((x) => ({ text: x, delay_ms: 0 })) }, structured_state: o?.structured_state_override }
    } })
    const finalFree = (rFree.packet?.bubbles || []).map((b) => String(b.text || '')).join(' | ')
    check('v157_second_price_question_carries_the_memory_obligation',
      plans.length > 0 && (plans[0]?.obligations || []).includes('acknowledge_rate_already_given') && !(plans[0]?.obligations || []).includes('answer_model_rate'),
      JSON.stringify(plans[0]))
    check('v157_restated_rate_is_rejected_then_the_memory_answer_ships',
      attempts === 2 && (rFree.authority?.control_verifier_rejection_reasons || []).some((x) => /rate_restated_after_disclosure/.test(String(x))) && finalFree === fromMemory.join(' | ') && !textStatesModelRate(finalFree),
      JSON.stringify({ attempts, reasons: rFree.authority?.control_verifier_rejection_reasons, finalFree }))
    check('v157_disclosure_flag_persists_in_state', rFree.structured_state?.known_model_rate_disclosed === true, JSON.stringify({ flag: rFree.structured_state?.known_model_rate_disclosed }))
    check('v162_thought_it_was_free_routes_to_the_budget_objection_hold', plans.length > 0 && plans[0]?.action === 'budget_objection_hold', JSON.stringify(plans[0]))
    // the deterministic recovery for that plan answers from memory without the number
    const memInput = { ...thoughtFree, message: thoughtFree.text, live_message: thoughtFree.text, recent_history: [], structured_state: { ...annotateStructuredStateForLiveTurn(thoughtFree, buildStructuredState(thoughtFree, []), []), known_model_rate_disclosed: true, form_link_sent: true, tattoo_intent_active: true } }
    const memPlan = { action: 'tattoo_continue', reason: 'active_tattoo_lane_requires_forward_motion', obligations: ['acknowledge_rate_already_given'], fields: {} }
    const memPacket = recoveryPacket2(memInput, memPlan)
    const memText = (memPacket.bubbles || []).map((b) => String(b.text || '')).join(' | ')
    check('v157_recovery_after_disclosure_has_no_number',
      memText.length > 0 && !textStatesModelRate(memText) && /mentioned|said before|from earlier/i.test(memText),
      JSON.stringify({ memText }))
  } finally {
    fs.rmSync(poRoot, { recursive: true, force: true })
  }

  // ---- v158 (live 2026-09-07 01:15Z): "Yeah, sure is it free?" = form consent AND a price question, one reply ----
  const { liveMixedFormConsentWithPriceQuestion: mixed158, shouldSendFormNow: sendNow158, PREFERRED_FORM_LINK: LINK158 } = require('./scv-contract-harness.js')
  const runner158 = require('./codex-dm-runner.js')
  const offerText158 = 'yeah we can use that as a starting point and make it custom in my style want me to send the application form?'
  check('v158_runner_and_controller_agree_on_compound_consent',
    ['Yeah, sure is it free?', 'Yes sure, is it free?', 'Oh yeah, yes please. How much is it though?', 'Is it free? yes please'].every((x) => mixed158({ message: x }) === true && runner158.isAffirmingFormPermission(x) === true) &&
    ['Is it free?', 'Are you sure it is free?', 'Is the application form free?', 'sure if it is free', 'ok but how much is it?', 'not yet, is it free?'].every((x) => mixed158({ message: x }) === false && runner158.isAffirmingFormPermission(x) === false),
    'compound consent boundary')
  const cfRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v158-cf-'))
  try {
    ensureControlDirs(cfRoot)
    const thread = '1537753982'
    fs.writeFileSync(path.join(cfRoot, 'thread-state', `${thread}.json`), `${JSON.stringify({ contact_id: thread, thread_id: thread, instagram_username: 'omar.system', tattoo_intent_active: true, known_design_context: 'a small rose', form_offer_asked: true, form_link_sent: false, booking_stage_hint: 'awaiting_form_permission_answer' })}\n`)
    let clock = Date.parse('2026-09-07T01:15:46.000Z')
    const tick = () => { clock += 9000; return new Date(clock).toISOString() }
    appendControlHistoryEvent(cfRoot, { contact_id: thread, thread_id: thread, message_id: 'cf-a1', bubble_index: 0, bubble_count: 1, bubble: { text: offerText158 } }, 'assistant', { at: tick(), delivery_status: 'verified' })
    const compound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'cf-u1', text: 'Yeah, sure is it free?', received_at: tick() }
    recordIngressEvent(cfRoot, compound)
    const priceOnly = ['the model spot is $150 per hour that is my discounted rate as long as the piece stays in my style']
    const both = ['it is not free — it is the discounted model rate, $150 an hour, as long as the finished piece stays in my style', `here is the form ${LINK158}`, 'once it is in, send me a couple days that work for you so i can check']
    let attempts = 0
    const plans = []
    const rCf = executeSingleControlTurn(compound, { root: cfRoot, candidateGenerator: (_m, o) => {
      attempts += 1
      plans.push({ action: o?.control_transition_contract?.action, reason: o?.control_transition_contract?.reason, obligations: o?.control_transition_contract?.obligations })
      const text = attempts === 1 ? priceOnly : both
      return { source: 'codex_exec_dm_authority', authority: { runner: 'codex exec', model: 'stub', executor: 'stub' }, raw_text: text.join('\n'), packet: { bubbles: text.map((x) => ({ text: x, delay_ms: 0 })) }, structured_state: o?.structured_state_override }
    } })
    const finalCf = (rCf.packet?.bubbles || []).map((b) => String(b.text || '')).join(' | ')
    check('v158_compound_turn_plans_send_form_with_the_price_obligation',
      plans[0]?.action === 'send_form' && (plans[0]?.obligations || []).includes('answer_model_rate'),
      JSON.stringify(plans[0]))
    check('v158_price_only_reply_is_rejected_then_link_plus_price_ships',
      attempts === 2 && (rCf.authority?.control_verifier_rejection_reasons || []).length > 0 && finalCf === both.join(' | ') && (finalCf.split(LINK158).length - 1) === 1,
      JSON.stringify({ attempts, reasons: rCf.authority?.control_verifier_rejection_reasons, finalCf }))
    check('v158_state_after_compound_turn_has_link_sent_and_rate_disclosed',
      rCf.structured_state?.form_link_sent === true && rCf.structured_state?.known_model_rate_disclosed === true,
      JSON.stringify({ link: rCf.structured_state?.form_link_sent, disclosed: rCf.structured_state?.known_model_rate_disclosed }))
    // prior compound consent survives an unanswered follow-up until the link is sent
    const priorInput = { message: 'how much again?', live_message: 'how much again?', recent_history: [{ role: 'assistant', text: offerText158 }, { role: 'user', text: 'Yeah, sure is it free?' }], structured_state: { tattoo_intent_active: true, known_design_context: 'a small rose', form_offer_asked: true, form_link_sent: false, booking_stage_hint: 'awaiting_form_permission_answer', live_turn_text: 'how much again?' } }
    const priorPlan = deriveClosedTransitionPlan(priorInput)
    check('v158_prior_compound_consent_still_routes_send_form', priorPlan.action === 'send_form', JSON.stringify({ action: priorPlan.action, reason: priorPlan.reason }))
    const withdrawInput = { ...priorInput, message: 'wait', live_message: 'wait', structured_state: { ...priorInput.structured_state, live_turn_text: 'wait' } }
    check('v158_withdrawal_cancels_prior_compound_consent', deriveClosedTransitionPlan(withdrawInput).action !== 'send_form', JSON.stringify(deriveClosedTransitionPlan(withdrawInput).action))
    const formFreeInput = { ...priorInput, message: 'Is the application form free?', live_message: 'Is the application form free?', recent_history: [{ role: 'assistant', text: offerText158 }], structured_state: { ...priorInput.structured_state, live_turn_text: 'Is the application form free?' } }
    check('v158_form_word_inside_a_price_question_is_not_consent', deriveClosedTransitionPlan(formFreeInput).action !== 'send_form' && sendNow158(formFreeInput) === false, JSON.stringify(deriveClosedTransitionPlan(formFreeInput).action))
  } finally {
    fs.rmSync(cfRoot, { recursive: true, force: true })
  }

  // ---- v159 (live 2026-09-07 04:28Z): a transcribed voice note is text — the info answer fires, never the image ask ----
  const voiceText = 'sent a voice note saying: Hi, can I please get more information?'
  const voiceLive = { contact_id: '1537753982', thread_id: '1537753982', instagram_username: 'omar.system', message_id: 'vn-1', text: voiceText, received_at: '2026-09-07T04:28:12.000Z', media_type: 'audio', media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=abc'] }
  const voiceState = annotateStructuredStateForLiveTurn(voiceLive, buildStructuredState(voiceLive, []), [])
  const voiceInput = { ...voiceLive, message: voiceText, live_message: voiceText, recent_history: [], structured_state: voiceState }
  const voicePlan = deriveClosedTransitionPlan(voiceInput)
  const voiceFast = fastEligible(voiceInput)
  const voicePacket = fastPath(voiceInput)
  check('v159_voice_info_request_with_audio_fields_takes_the_fixed_info_answer',
    voiceState.live_turn_is_voice_note === true && voiceState.live_turn_is_media_reference !== true &&
    voiceFast.eligible === true && voicePacket !== null && voicePlan.reason === 'direct_info_request_owns_live_turn',
    JSON.stringify({ voice: voiceState.live_turn_is_voice_note, fast: voiceFast, plan: { action: voicePlan.action, reason: voicePlan.reason } }))
  const { packetClaimsVisualReceipt: claimsVisual159, evaluateScvContractHarness: evalHarness159 } = require('./scv-contract-harness.js')
  for (const plan159 of [{ action: 'design_intake', reason: 'tattoo_lane_missing_design_direction', obligations: [], fields: {} }, { action: 'general_continue', reason: 'non_tattoo_media_requires_contextual_host_lead', obligations: [], fields: {} }, { action: 'tattoo_continue', reason: 'active_tattoo_lane_requires_forward_motion', obligations: [], fields: {} }]) {
    const recVoice = recoveryPacket2({ ...voiceInput, structured_state: { ...voiceState, live_turn_is_media_reference: true } }, plan159)
    const recText = (recVoice.bubbles || []).map((b) => String(b.text || '')).join(' | ')
    check(`v159_recovery_never_answers_a_voice_note_as_an_image_${plan159.action}`, recText.length > 0 && !claimsVisual159(recVoice) && !/image|photo/i.test(recText), JSON.stringify({ recText }))
  }
  check('v159_model_reply_that_claims_an_image_on_a_voice_turn_is_rejected',
    evalHarness159(voiceInput, { bubbles: [{ text: 'I see the image what part of it are you thinking about for the tattoo?', delay_ms: 0 }] }).reason === 'voice_note_answered_as_an_image',
    JSON.stringify(evalHarness159(voiceInput, { bubbles: [{ text: 'I see the image what part of it are you thinking about for the tattoo?', delay_ms: 0 }] })))
  // a real image turn keeps the image-part ask
  const imgLive = { contact_id: '1537753982', thread_id: '1537753982', instagram_username: 'omar.system', message_id: 'img-1', text: 'sent a reference post: a screenshot of a website with a logo', received_at: '2026-09-07T04:29:00.000Z' }
  const imgState = { ...annotateStructuredStateForLiveTurn(imgLive, buildStructuredState(imgLive, []), []), live_turn_is_media_reference: true }
  const recImg = recoveryPacket2({ ...imgLive, message: imgLive.text, live_message: imgLive.text, recent_history: [], structured_state: imgState }, { action: 'general_continue', reason: 'non_tattoo_media_requires_contextual_host_lead', obligations: [], fields: {} })
  check('v159_a_real_image_turn_keeps_the_image_part_ask', /what part/i.test((recImg.bubbles || []).map((b) => b.text).join(' ')), JSON.stringify((recImg.bubbles || []).map((b) => b.text)))
}

// v161 (live 2026-09-07 19:13Z, Omar.system, production v160): picture of an aftercare cream → host lead
// ("looks like aftercare ointment, not the tattoo itself … send me the actual picture or tell me the vibe") →
// "I mean I just want the after cream ointment as a reference" → "Got you / that screenshot is just aftercare
// tho …". Locked here on the exact executed path: the nominated object is design authority (offer_form), the
// re-grading draft is rejected, the affirmation + form offer ships, and the thread remembers the nomination.
{
  const {
    SCV_CONTRACT_HARNESS_LOCK_VERSION: lock161,
    clientAnchoredInspirationReference: anchored161,
    liveTurnUsesNonTattooMediaContext: nonTattoo161,
    storedDesignContextIsDesign: stored161,
    evaluateScvContractHarness: evalHarness161
  } = require('./scv-contract-harness.js')
  const { buildRouteAwareVisibleRecoveryPacket: recoveryPacket161 } = require('./scv-deterministic-recovery.js')
  check('v161_contract_behavior_carried_by_current_v129', lock161 === 'scv-contract-harness-lock-2026-09-08-v129-context-grounded-client-intent', lock161)
  const IMAGE161 = 'sent a reference post: The image shows a screenshot of a product listing for a tube of aftercare ointment, a vitamin based healing cream, with the label visible'
  const NOMINATION161 = 'I mean I just want the after cream ointment as a reference'
  const BAD161 = ['Got you', 'that screenshot is just aftercare tho, not really a tattoo design on its own', 'want me to send the application form over?']
  const GOOD161 = ['got you!! the ointment tube as the reference totally works, i can turn that into a piece in my style 🖤', 'want me to send the application form so we can lock it in?']
  const root161 = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-v161-nomination-'))
  try {
    ensureControlDirs(root161)
    const thread = '1537753982'
    const at = (mmss) => `2026-09-07T19:${mmss}.000Z`
    const addUser = (id, text, when) => appendControlHistoryEvent(root161, { contact_id: thread, thread_id: thread, message_id: id, text }, 'user', { at: when })
    const addAssistant = (id, texts, when) => texts.forEach((text, index) => appendControlHistoryEvent(root161, {
      contact_id: thread, thread_id: thread, message_id: id, bubble_index: index, bubble_count: texts.length, bubble: { text }
    }, 'assistant', { at: when, delivery_status: 'verified' }))
    addUser('n1', 'Hi, can I please get some information?', at('10:37'))
    addAssistant('n1', [
      'sure!! so a model spot is one of the few spots i open for pieces made from what you want while the finished tattoo stays in my style 🖤',
      'you can look through my profile and story highlights for inspo or if you already have something in mind i can customize a piece for you :) just send me any loose idea or reference'
    ], at('10:38'))
    addUser('n2', 'sent a voice note saying: Do you also do black and gray?', at('10:50'))
    addAssistant('n2', ['yeah black and gray is my thing', 'what are you thinking of getting?'], at('11:08'))
    addUser('n3', IMAGE161, at('11:21'))
    addAssistant('n3', ['That looks like aftercare ointment, not the tattoo itself', 'If you meant a tattoo reference, send me the actual picture or tell me the vibe'], at('12:36'))
    fs.writeFileSync(path.join(root161, 'thread-state', `${thread}.json`), `${JSON.stringify({
      contact_id: thread, thread_id: thread, tattoo_intent_active: true, known_reference_media_received: true,
      reference_media_classification_observed: true, booking_stage_hint: 'design_intake'
    }, null, 2)}\n`)
    const inbound = { contact_id: thread, thread_id: thread, instagram_username: 'omar.system', message_id: 'n4', text: NOMINATION161, received_at: at('13:45') }
    recordIngressEvent(root161, inbound)
    const plans = []
    let calls = 0
    const result = executeSingleControlTurn(inbound, {
      root: root161,
      candidateGenerator: (_message, options) => {
        calls += 1
        plans.push([options.control_transition_contract?.action, options.control_transition_contract?.reason])
        const bubbles = (calls === 1 ? BAD161 : GOOD161).map((text) => ({ text, delay_ms: 0 }))
        const packet = { bubbles, reply_text: bubbles.map((b) => b.text).join('\n'), acknowledged_fields: [], questioned_fields: [], next_action_reflected: options.control_transition_contract?.action }
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'scv-single-control-plane', model: 'none', executor: 'deterministic_divergence_matrix' },
          raw_text: packet.reply_text,
          packet,
          structured_state: { ...options.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    const visible = (Array.isArray(result.packet?.bubbles) ? result.packet.bubbles : []).map((b) => String(b?.text || '')).join(' | ')
    check('v161_exact_path_plan_is_offer_form_for_the_nominated_object', plans.length >= 1 && plans[0][0] === 'offer_form', JSON.stringify(plans))
    check('v161_exact_path_never_ships_the_regrading_draft',
      visible.length > 0 && !/just aftercare|not the tattoo itself|actual picture/i.test(visible) && /application form/i.test(visible) && /(ointment tube as the reference|starting point)/i.test(visible),
      JSON.stringify({ calls, visible, authority: result.authority }))
    const persisted = JSON.parse(fs.readFileSync(path.join(root161, 'thread-state', `${thread}.json`), 'utf8'))
    check('v161_exact_path_latches_the_nomination_and_opens_the_form_gate',
      persisted.known_client_anchored_inspiration === true && persisted.form_offer_asked === true,
      JSON.stringify({ anchored: persisted.known_client_anchored_inspiration, form_offer_asked: persisted.form_offer_asked }))
    check('v161_exact_path_stores_readable_design_memory',
      stored161(String(persisted.known_design_context || '')) === true,
      JSON.stringify({ known_design_context: persisted.known_design_context }))
  } finally {
    fs.rmSync(root161, { recursive: true, force: true })
  }
  // predicate + recovery boundaries (no lane latch in the state)
  const history161 = [
    { role: 'user', message_id: 'd161-image', text: IMAGE161 },
    { role: 'assistant', message_id: 'd161-image', text: 'That looks like aftercare ointment, not the tattoo itself' },
    { role: 'assistant', message_id: 'd161-image', text: 'If you meant a tattoo reference, send me the actual picture or tell me the vibe' }
  ]
  const mk161 = (text, extra = {}) => {
    const live = { contact_id: 'd161', thread_id: 'd161', instagram_username: 'omar.system', message_id: 'd161-live', text, received_at: '2026-09-07T19:13:45.000Z' }
    const hist = history161.concat([{ role: 'user', message_id: 'd161-live', text }])
    const state = { ...annotateStructuredStateForLiveTurn(live, buildStructuredState(live, hist), hist), reference_media_classification_observed: true, known_reference_media_received: true, ...extra }
    return { ...live, message: text, live_message: text, recent_history: hist, structured_state: state }
  }
  const nominated161 = mk161(NOMINATION161)
  const plan161 = deriveClosedTransitionPlan(nominated161)
  check('v161_nomination_without_lane_latch_is_offer_form', anchored161(nominated161) === true && nonTattoo161(nominated161) === false && plan161.action === 'offer_form', JSON.stringify([plan161.action, plan161.reason]))
  check('v161_regrading_draft_rejected_by_the_anchored_rule', evalHarness161(nominated161, { bubbles: BAD161.map((text) => ({ text })) }).reason === 'anchored_inspiration_reference_cannot_reopen_design_interview', JSON.stringify(evalHarness161(nominated161, { bubbles: BAD161.map((text) => ({ text })) })))
  check('v161_affirmation_plus_form_offer_valid_on_both_contracts',
    evalHarness161(nominated161, { bubbles: GOOD161.map((text) => ({ text })) }).valid === true && evaluateClosedTransitionContract(nominated161, { bubbles: GOOD161.map((text) => ({ text, delay_ms: 0 })) }, plan161).valid === true,
    JSON.stringify({ harness: evalHarness161(nominated161, { bubbles: GOOD161.map((text) => ({ text })) }), closed: evaluateClosedTransitionContract(nominated161, { bubbles: GOOD161.map((text) => ({ text, delay_ms: 0 })) }, plan161) }))
  const rec161 = recoveryPacket161(nominated161, plan161)
  const recText161 = (rec161.bubbles || []).map((b) => String(b.text || '')).join(' | ')
  check('v161_recovery_acknowledges_the_reference_and_offers_the_form', /starting point/i.test(recText161) && /application form\?$/i.test(recText161) && !/what are you thinking of getting/i.test(recText161), JSON.stringify({ recText161 }))
  const pointer161 = mk161('this one', { tattoo_intent_active: true })
  const pointerPlan161 = deriveClosedTransitionPlan(pointer161)
  check('v161_bare_pointer_on_the_screenshot_still_gets_the_host_lead_once', anchored161(pointer161) === false && pointerPlan161.action === 'general_continue' && pointerPlan161.reason === 'non_tattoo_media_requires_contextual_host_lead', JSON.stringify([pointerPlan161.action, pointerPlan161.reason]))
  check('v161_nomination_variants_are_design_authority',
    anchored161(mk161('I just want the aftercare cream as a reference')) === true && anchored161(mk161('use the ointment tube as the design')) === true && anchored161(mk161('use that as a reference')) === true && anchored161(mk161('can you do the ointment tube as the reference?')) === true,
    'variants')
  check('v161_withdrawals_and_evaluations_are_not_nominations',
    anchored161(mk161("I don't want the cream as a reference, forget that")) === false && anchored161(mk161('is the cream a good reference?')) === false,
    'boundaries')
}

// v162 (live 2026-09-07 21:15Z + 21:18Z, Omar.system, production v161): (1) "How much is it by the way?" at the
// post-form stage fell to the recovery line without the first price answer; (2) "I thought it's free though. My
// budget is tight." was answered with the rate-memory line plus weekend slots. Locked here: the recovery carries the
// first price answer on the post-form route; a cost objection routes to the hold, the slot-pushing draft is rejected,
// the budget question + limited framing ships, the recovery line complies; a stated budget is fitted, never discounted.
{
  const H162 = require('./scv-contract-harness.js')
  const { buildRouteAwareVisibleRecoveryPacket: recovery162 } = require('./scv-deterministic-recovery.js')
  const { SCV_CLOSED_TRANSITION_CONTRACT_VERSION: contract162 } = require('./scv-closed-transition-contract.js')
  check('v162_behavior_carried_by_current_versions', H162.SCV_CONTRACT_HARNESS_LOCK_VERSION === 'scv-contract-harness-lock-2026-09-08-v129-context-grounded-client-intent' && contract162 === 'scv-closed-transition-contract-2026-09-08-v86-artist-biography-is-not-client-intent', JSON.stringify([H162.SCV_CONTRACT_HARNESS_LOCK_VERSION, contract162]))
  const mk162 = (text, history, extra = {}) => {
    const live = { contact_id: 'd162', thread_id: 'd162', instagram_username: 'omar.system', message_id: 'd162-live', text, received_at: '2026-09-07T21:15:00.000Z' }
    const hist = history.concat([{ role: 'user', message_id: 'd162-live', text }])
    const state = { ...annotateStructuredStateForLiveTurn(live, buildStructuredState(live, hist), hist), tattoo_intent_active: true, known_design_context: 'a snake on my forearm', form_offer_asked: true, form_link_sent: true, ...extra }
    return { ...live, message: text, live_message: text, recent_history: hist, structured_state: state }
  }
  const formLinkHistory = [
    { role: 'assistant', message_id: 'd162-a1', text: 'here is the form https://www.effacermonexistence.com/apply fill it out and tell me a couple dates that work' },
    { role: 'user', message_id: 'd162-u1', text: 'Submitted' },
    { role: 'assistant', message_id: 'd162-u1', text: 'got it i have your form what date would you like me to check?' }
  ]
  // (1) first price question at the post-form stage
  const howMuch = mk162('How much is it by the way?', formLinkHistory, { form_submitted: true, booking_stage_hint: 'awaiting_date' })
  const howMuchPlan = deriveClosedTransitionPlan(howMuch)
  check('v162_post_form_price_question_carries_answer_model_rate', ['post_form_availability', 'general_continue', 'tattoo_continue'].includes(howMuchPlan.action) && (howMuchPlan.obligations || []).includes('answer_model_rate'), JSON.stringify([howMuchPlan.action, howMuchPlan.reason, howMuchPlan.obligations]))
  const noPrice = { bubbles: [{ text: 'got it, i have your form. what day would you like me to check?', delay_ms: 0 }] }
  check('v162_post_form_price_question_draft_without_the_price_is_rejected', evaluateClosedTransitionContract(howMuch, noPrice, howMuchPlan).valid === false, JSON.stringify(evaluateClosedTransitionContract(howMuch, noPrice, howMuchPlan).reason))
  const rec1 = recovery162(howMuch, howMuchPlan)
  const rec1Text = (rec1.bubbles || []).map((b) => String(b.text || '')).join(' | ')
  check('v162_post_form_recovery_carries_the_first_price_answer', /150/.test(rec1Text) && /\bhour\b/i.test(rec1Text) && /\bstyle\b/i.test(rec1Text) && H162.textStatesModelRate(rec1Text), JSON.stringify({ rec1Text }))
  check('v162_post_form_recovery_still_moves_the_booking', /date|day|check/i.test(rec1Text), JSON.stringify({ rec1Text }))
  // (2) the objection after the disclosure
  const disclosedHistory = formLinkHistory.concat([
    { role: 'user', message_id: 'd162-u2', text: 'How much is it by the way?' },
    { role: 'assistant', message_id: 'd162-u2', text: 'this is my discounted model rate at $150 per hour when the finished piece stays in my style' },
    { role: 'assistant', message_id: 'd162-u2', text: 'what date would you like me to check?' }
  ])
  const objection = mk162("I thought it's free though. My budget is tight.", disclosedHistory, { form_submitted: true, booking_stage_hint: 'awaiting_date', known_model_rate_disclosed: true })
  const objectionPlan = deriveClosedTransitionPlan(objection)
  check('v162_cost_objection_routes_to_the_hold_with_the_memory_obligation', objectionPlan.action === 'budget_objection_hold' && (objectionPlan.obligations || []).includes('acknowledge_rate_already_given') && !(objectionPlan.obligations || []).includes('answer_model_rate'), JSON.stringify([objectionPlan.action, objectionPlan.reason, objectionPlan.obligations]))
  const productionReply = { bubbles: [{ text: "I get it. It's still the model rate I mentioned earlier and nothing's changed.", delay_ms: 0 }, { text: 'if you want a weekend spot, September 9th or 20th at 2pm are open', delay_ms: 0 }] }
  check('v162_production_reply_is_rejected_on_both_contracts',
    H162.evaluateScvContractHarness(objection, productionReply).reason === 'budget_objection_cannot_push_booking' && evaluateClosedTransitionContract(objection, productionReply, objectionPlan).valid === false,
    JSON.stringify({ harness: H162.evaluateScvContractHarness(objection, productionReply).reason, closed: evaluateClosedTransitionContract(objection, productionReply, objectionPlan).reason }))
  const goodReply = { bubbles: [{ text: 'nah it is not free — it is the model rate i mentioned earlier, that part stays the same 🖤', delay_ms: 0 }, { text: 'what budget are you working with? these model spots are limited and this rate is only open right now, so give me your range and i will shape the piece around it', delay_ms: 0 }] }
  check('v162_budget_question_with_limited_framing_is_valid_on_both_contracts',
    H162.evaluateScvContractHarness(objection, goodReply).valid === true && evaluateClosedTransitionContract(objection, goodReply, objectionPlan).valid === true,
    JSON.stringify({ harness: H162.evaluateScvContractHarness(objection, goodReply), closed: evaluateClosedTransitionContract(objection, goodReply, objectionPlan).reason }))
  const rec2 = recovery162(objection, objectionPlan)
  const rec2Text = (rec2.bubbles || []).map((b) => String(b.text || '')).join(' | ')
  check('v162_objection_recovery_answers_from_memory_asks_the_budget_and_frames_the_spots',
    rec2Text.length > 0 && !H162.textStatesModelRate(rec2Text) && !/150/.test(rec2Text) && H162.packetAsksBudget(rec2) && H162.packetFramesLimitedAvailability(rec2) && !H162.packetPushesBookingSlot(rec2) && evaluateClosedTransitionContract(objection, rec2, objectionPlan).valid === true,
    JSON.stringify({ rec2Text, closed: evaluateClosedTransitionContract(objection, rec2, objectionPlan).reason }))
  // (3) the stated budget resumes the step with a fit line, never a discount
  const statedHistory = disclosedHistory.concat([
    { role: 'user', message_id: 'd162-u3', text: "I thought it's free though. My budget is tight." },
    { role: 'assistant', message_id: 'd162-u3', text: 'what budget are you working with? these model spots are limited and this rate is only open right now, so give me your range and i will shape the piece around it' }
  ])
  const stated = mk162('around 300 max', statedHistory, { form_submitted: true, booking_stage_hint: 'awaiting_date', known_model_rate_disclosed: true })
  const statedPlan = deriveClosedTransitionPlan(stated)
  check('v162_stated_budget_resumes_the_booking_with_the_fit_obligation', statedPlan.action !== 'budget_objection_hold' && (statedPlan.obligations || []).includes('acknowledge_budget_fit') && !(statedPlan.obligations || []).includes('acknowledge_and_defer_placement_size'), JSON.stringify([statedPlan.action, statedPlan.reason, statedPlan.obligations]))
  check('v162_stated_budget_draft_without_the_fit_line_is_rejected', evaluateClosedTransitionContract(stated, { bubbles: [{ text: 'got it! what date would you like me to check?', delay_ms: 0 }] }, statedPlan).reason === 'closed_transition_budget_fit_missing', evaluateClosedTransitionContract(stated, { bubbles: [{ text: 'got it! what date would you like me to check?', delay_ms: 0 }] }, statedPlan).reason)
  check('v162_stated_budget_discount_is_rejected', evaluateClosedTransitionContract(stated, { bubbles: [{ text: 'that range works, i can do a discount for you. what date would you like me to check?', delay_ms: 0 }] }, statedPlan).reason === 'closed_transition_budget_fit_cannot_discount', 'discount')
  const rec3 = recovery162(stated, statedPlan)
  const rec3Text = (rec3.bubbles || []).map((b) => String(b.text || '')).join(' | ')
  check('v162_stated_budget_recovery_carries_the_fit_line_and_resumes', /shape|fit/i.test(rec3Text) && !/150|discount/i.test(rec3Text) && evaluateClosedTransitionContract(stated, rec3, statedPlan).valid === true, JSON.stringify({ rec3Text, closed: evaluateClosedTransitionContract(stated, rec3, statedPlan).reason }))
  // boundaries: a client-named day keeps the booking branches; a plain price question is not an objection
  const namedDay = mk162('my budget is tight but can we do the 20th?', disclosedHistory, { form_submitted: true, booking_stage_hint: 'awaiting_date', known_model_rate_disclosed: true })
  check('v162_client_named_day_keeps_the_booking_branch', deriveClosedTransitionPlan(namedDay).action !== 'budget_objection_hold', deriveClosedTransitionPlan(namedDay).action)
  check('v162_plain_price_question_is_not_an_objection', H162.liveExpressesBudgetObjection(howMuch) === false && H162.liveExpressesBudgetObjection(objection) === true, 'boundary')
}

console.log(JSON.stringify({
  ok: true,
  harness: 'scv-double-check-divergence-2026-09-07-v22-a-cost-objection-holds-the-booking',
  checked: checks.length,
  passed: checks.filter((item) => item.pass).length,
  failed: checks.filter((item) => !item.pass).length,
  checks
}, null, 2))
