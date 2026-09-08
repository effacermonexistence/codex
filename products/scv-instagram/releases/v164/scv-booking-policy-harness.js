#!/usr/bin/env node
// Deterministic, network-free regression gate for the canonical booking policy.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const root = __dirname
const casesPath = path.join(root, 'SCV_BOOKING_POLICY_GOLDEN_CASES.json')
const policy = require(path.join(root, 'scv-booking-policy.js'))
const SCV_BOOKING_POLICY_HARNESS_VERSION =
  'scv-booking-policy-harness-2026-09-03-v10-ordinal-word-days'

function readCases() {
  const parsed = JSON.parse(fs.readFileSync(casesPath, 'utf8'))
  if (!parsed || !Array.isArray(parsed.cases) || parsed.cases.length < 50) {
    throw new Error('booking_policy_golden_case_count_below_50')
  }
  return parsed
}

function evaluateCase(testCase, defaultReferenceTime) {
  return policy.classifyBookingDateText(testCase.text, {
    referenceTime: testCase.reference_time || defaultReferenceTime,
    numericOrder: testCase.numeric_order,
    allowAmbiguousDay: testCase.allow_ambiguous_day === true,
    contextMonth: testCase.context_month,
    contextYear: testCase.context_year
  })
}

function timezoneSnapshot() {
  const corpus = readCases()
  return corpus.cases.map((testCase) => {
    const decision = evaluateCase(testCase, corpus.default_reference_time)
    return {
      id: testCase.id,
      status: decision.status,
      date_iso: decision.date_iso,
      current_date_iso: decision.current_date_iso,
      minimum_date_iso: decision.minimum_date_iso
    }
  })
}

if (process.argv.includes('--tz-snapshot')) {
  // Keep the child receipt below the pinned Node 20 synchronous pipe limit.
  // The digest still commits to every result in the complete corpus.
  const snapshot = timezoneSnapshot()
  const serialized = JSON.stringify(snapshot)
  process.stdout.write(JSON.stringify({
    count: snapshot.length,
    sha256: crypto.createHash('sha256').update(serialized).digest('hex')
  }))
  return
}

function runHarness() {
  const corpus = readCases()
  const failures = []
  let checked = 0

  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail: String(detail || '').slice(0, 1000) })
  }

  check(
    'policy_version_locked',
    policy.SCV_BOOKING_POLICY_VERSION === 'scv-booking-policy-2026-09-03-v5-ordinal-word-days',
    policy.SCV_BOOKING_POLICY_VERSION
  )
  check('minimum_lead_days_exact', policy.MINIMUM_LEAD_DAYS === 7, policy.MINIMUM_LEAD_DAYS)
  check('maximum_horizon_absent', policy.MAXIMUM_HORIZON_DAYS === null, policy.MAXIMUM_HORIZON_DAYS)
  check('minimum_booking_time_minutes_exact', policy.MINIMUM_BOOKING_TIME_MINUTES === 780, policy.MINIMUM_BOOKING_TIME_MINUTES)
  check('minimum_booking_time_label_exact', policy.MINIMUM_BOOKING_TIME_LABEL === '1pm', policy.MINIMUM_BOOKING_TIME_LABEL)
  check('timezone_exact', policy.BOOKING_TIME_ZONE === 'America/Los_Angeles', policy.BOOKING_TIME_ZONE)
  check('policy_fingerprint_shape', /^[a-f0-9]{64}$/.test(policy.BOOKING_POLICY_FINGERPRINT), policy.BOOKING_POLICY_FINGERPRINT)

  const dateSpeechActMatrix = [
    { category: 'incidental_event', text: 'The event starts August 27.', proposal: false },
    { category: 'incidental_trip', text: 'My trip begins August 27.', proposal: false },
    { category: 'incidental_flight', text: 'My flight is on August 27.', proposal: false },
    { category: 'incidental_wedding', text: 'The wedding is August 27.', proposal: false },
    { category: 'incidental_birthday', text: 'My birthday is August 27.', proposal: false },
    { category: 'incidental_anniversary', text: 'Our anniversary is August 27.', proposal: false },
    { category: 'incidental_old_appointment', text: 'My old appointment was August 27.', proposal: false },
    { category: 'incidental_tattoo_history', text: 'My tattoo was done August 27 last year.', proposal: false },
    { category: 'aux_birthday_question', text: 'Is August 27 her birthday?', proposal: false },
    { category: 'aux_old_appointment_question', text: 'Would August 27 have been the old appointment?', proposal: false },
    { category: 'aux_event_question', text: 'Can August 27 be the event date?', proposal: false },
    { category: 'bare_default_false', text: 'August 30', proposal: false },
    { category: 'bare_active_question_true', text: 'August 30', options: { allowBareDate: true }, proposal: true, candidate: 'August 30' },
    { category: 'how_about', text: 'How about August 30?', proposal: true, candidate: 'August 30' },
    { category: 'would_work', text: 'Would August 30 work?', proposal: true, candidate: 'August 30' },
    { category: 'is_available', text: 'Is August 30 available?', proposal: true, candidate: 'August 30' },
    { category: 'i_can_do', text: 'I can do August 30.', proposal: true, candidate: 'August 30' },
    { category: 'date_works', text: 'August 30 works for me.', proposal: true, candidate: 'August 30' },
    { category: 'lets_do', text: "Let's do August 30.", proposal: true, candidate: 'August 30' },
    { category: 'prefer', text: 'I prefer August 30.', proposal: true, candidate: 'August 30' },
    { category: 'move', text: 'Move the appointment to August 30.', proposal: true, candidate: 'August 30' },
    { category: 'book_imperative', text: 'Book me for August 30.', proposal: true, candidate: 'August 30' },
    { category: 'put_down_imperative', text: 'Put me down for August 30.', proposal: true, candidate: 'August 30' },
    { category: 'lock_imperative', text: 'Lock in August 30.', proposal: true, candidate: 'August 30' },
    { category: 'go_with_imperative', text: 'Go with August 30.', proposal: true, candidate: 'August 30' },
    { category: 'take_imperative', text: "I'll take August 30.", proposal: true, candidate: 'August 30' },
    { category: 'day_first_complete_span', text: 'Can we do the 15th of August?', proposal: true, candidate: '15th of August' },
    { category: 'birthday_compound_override', text: 'My birthday is August 27; how about August 30?', proposal: true, candidate: 'August 30' },
    { category: 'anniversary_compound_override', text: 'Our anniversary is August 27, but August 30 works.', proposal: true, candidate: 'August 30' },
    { category: 'old_appointment_compound_override', text: 'My old appointment was August 27; I can do August 30.', proposal: true, candidate: 'August 30' },
    { category: 'negative_cannot', text: 'I cannot do August 30.', proposal: false, rejection: true, candidate: 'August 30' },
    { category: 'negative_not_available', text: 'I am not available August 30.', proposal: false, rejection: true, candidate: 'August 30' },
    { category: 'negative_doesnt_work', text: "August 30 doesn't work.", proposal: false, rejection: true, candidate: 'August 30' },
    { category: 'negative_no_longer', text: 'August 30 no longer works.', proposal: false, rejection: true, candidate: 'August 30' },
    { category: 'exclusion_except', text: 'Anything except August 30.', proposal: false, rejection: true, candidate: 'August 30' },
    { category: 'exclusion_other_than', text: 'Anything other than August 30.', proposal: false, rejection: true, candidate: 'August 30' },
    { category: 'range_after', text: 'After August 30 would work.', proposal: false, bounded: true, candidate: 'August 30' },
    { category: 'range_before', text: 'Anything before August 30 works.', proposal: false, bounded: true, candidate: 'August 30' },
    { category: 'range_or_later', text: 'August 30 or later works.', proposal: false, bounded: true, candidate: 'August 30' },
    { category: 'range_between', text: 'Between August 30 and September 2 works.', proposal: false, ambiguous: true },
    { category: 'mixed_positive_then_negative', text: 'I can do August 30, but not August 31.', proposal: true, candidate: 'August 30' },
    { category: 'mixed_negative_then_positive', text: "I can't do August 30 but August 31 works.", proposal: true, candidate: 'August 31' },
    { category: 'same_date_positive_then_negative', text: 'August 30 works but I cannot do August 30.', proposal: false, ambiguous: true },
    { category: 'same_date_negative_then_positive', text: 'I cannot do August 30 but August 30 works.', proposal: false, ambiguous: true },
    { category: 'multiple_positive_dates', text: 'August 30 or August 31 works.', proposal: false, ambiguous: true },
    { category: 'multi_endpoint_date_range', text: 'Between August 30 and August 31 works.', proposal: false, ambiguous: true }
  ]
  for (const row of dateSpeechActMatrix) {
    const id = crypto.createHash('sha256').update(`${row.category}:${row.text}`).digest('hex').slice(0, 8)
    const frame = policy.calendarBookingProposalFrame(row.text, row.options || {})
    check(`date_speech_${row.category}_${id}_proposal`, frame.proposal === row.proposal, JSON.stringify(frame))
    check(`date_speech_${row.category}_${id}_boolean`, policy.textFramesCalendarCandidateAsBookingProposal(row.text, row.options || {}) === row.proposal, JSON.stringify(frame))
    check(`date_speech_${row.category}_${id}_rejection`, frame.rejection === (row.rejection === true), JSON.stringify(frame))
    check(`date_speech_${row.category}_${id}_bounded`, frame.bounded === (row.bounded === true), JSON.stringify(frame))
    check(`date_speech_${row.category}_${id}_ambiguous`, frame.ambiguous === (row.ambiguous === true), JSON.stringify(frame))
    if (row.candidate) check(`date_speech_${row.category}_${id}_candidate`, frame.candidate_text === row.candidate, JSON.stringify(frame))
  }

  const timeSpeechActMatrix = [
    { category: 'incidental_flight', text: 'My flight is at 2pm.', proposal: false },
    { category: 'incidental_event', text: 'The event starts at 3pm.', proposal: false },
    { category: 'incidental_lunch', text: 'Lunch is at 2pm.', proposal: false },
    { category: 'incidental_livestream', text: 'The livestream starts at 2pm.', proposal: false },
    { category: 'aux_flight_question', text: 'Is 2pm the flight time?', proposal: false },
    { category: 'aux_lunch_question', text: 'Would 2pm have been lunch?', proposal: false },
    { category: 'bare_default_false', text: '2pm', proposal: false },
    { category: 'bare_active_question_true', text: '2pm', options: { allowBareTime: true }, proposal: true, candidate: '2pm' },
    { category: 'time_works', text: '2pm works.', proposal: true, candidate: '2pm' },
    { category: 'dotted_time_works', text: '2 p.m. works.', proposal: true, candidate: '2 p.m.' },
    { category: 'would_work', text: 'Would 2pm work?', proposal: true, candidate: '2pm' },
    { category: 'is_available', text: 'Is 2pm available?', proposal: true, candidate: '2pm' },
    { category: 'i_can_do', text: 'I can do 2pm.', proposal: true, candidate: '2pm' },
    { category: 'book_imperative', text: 'Book me for 2pm.', proposal: true, candidate: '2pm' },
    { category: 'natural_afternoon_imperative', text: 'Could you book me at 2 in the afternoon?', proposal: true, candidate: '2pm' },
    { category: 'natural_afternoon_works', text: '2 in the afternoon works.', proposal: true, candidate: '2pm' },
    { category: 'natural_morning_active_bare', text: '3 in the morning', options: { allowBareTime: true }, proposal: true, candidate: '3am' },
    { category: 'natural_evening_active_bare', text: '10 in the evening', options: { allowBareTime: true }, proposal: true, candidate: '10pm' },
    { category: 'natural_night_midnight_active_bare', text: '12 in the night', options: { allowBareTime: true }, proposal: true, candidate: '12am' },
    { category: 'natural_afternoon_incidental', text: 'My flight is at 2 in the afternoon.', proposal: false },
    { category: 'take_imperative', text: "I'll take 2pm.", proposal: true, candidate: '2pm' },
    { category: 'lock_imperative', text: 'Lock in 2pm.', proposal: true, candidate: '2pm' },
    { category: 'positive_date_time_composite', text: 'Can we do August 30 at 2pm?', proposal: true, candidate: '2pm' },
    { category: 'incidental_date_time_composite', text: 'My flight is August 30 at 2pm.', proposal: false },
    { category: 'negated_date_time_composite', text: 'I cannot do August 30 at 2pm.', proposal: false, rejection: true, candidate: '2pm' },
    { category: 'negative_cannot', text: 'I cannot do 2pm.', proposal: false, rejection: true, candidate: '2pm' },
    { category: 'negative_no_longer', text: '2pm no longer works.', proposal: false, rejection: true, candidate: '2pm' },
    { category: 'exclusion_except', text: 'Anything except 2pm.', proposal: false, rejection: true, candidate: '2pm' },
    { category: 'range_after', text: 'Any time after 2pm works.', proposal: false, bounded: true, candidate: '2pm' },
    { category: 'range_before', text: 'Before 2pm would be easier.', proposal: false, bounded: true, candidate: '2pm' },
    { category: 'mixed_negative_then_positive', text: "Can't do 2pm but 3pm works.", proposal: true, candidate: '3pm' },
    { category: 'mixed_positive_then_negative', text: '3pm works but not 2pm.', proposal: true, candidate: '3pm' },
    { category: 'multiple_positive_ambiguous', text: '2pm works or 3pm works.', proposal: false, ambiguous: true },
    { category: 'same_time_positive_then_negative', text: '2pm works but I cannot do 2pm.', proposal: false, ambiguous: true },
    { category: 'same_time_negative_then_positive', text: 'I cannot do 2pm but 2pm works.', proposal: false, ambiguous: true },
    { category: 'multi_endpoint_time_range', text: 'Between 2pm and 3pm works.', proposal: false, ambiguous: true }
  ]
  for (const row of timeSpeechActMatrix) {
    const id = crypto.createHash('sha256').update(`${row.category}:${row.text}`).digest('hex').slice(0, 8)
    const frame = policy.clockTimeBookingProposalFrame(row.text, row.options || {})
    check(`time_speech_${row.category}_${id}_proposal`, frame.proposal === row.proposal, JSON.stringify(frame))
    check(`time_speech_${row.category}_${id}_boolean`, policy.textFramesClockTimeAsBookingProposal(row.text, row.options || {}) === row.proposal, JSON.stringify(frame))
    check(`time_speech_${row.category}_${id}_rejection`, frame.rejection === (row.rejection === true), JSON.stringify(frame))
    check(`time_speech_${row.category}_${id}_bounded`, frame.bounded === (row.bounded === true), JSON.stringify(frame))
    check(`time_speech_${row.category}_${id}_ambiguous`, frame.ambiguous === (row.ambiguous === true), JSON.stringify(frame))
    if (row.candidate) check(`time_speech_${row.category}_${id}_candidate`, frame.candidate_text === row.candidate, JSON.stringify(frame))
  }

  const timePolicyMatrix = [
    { text: '11am', status: 'too_early' },
    { text: '12:59pm', status: 'too_early' },
    { text: '1pm', status: 'legal' },
    { text: '2pm', status: 'legal' },
    { text: '6:30pm', status: 'legal' },
    { text: '12am', status: 'too_early' }
  ]
  for (const row of timePolicyMatrix) {
    const decision = policy.classifyBookingClockTimeText(row.text)
    check(
      `time_policy_${row.text.replace(/[^a-z0-9]+/gi, '_')}_${row.status}`,
      decision.status === row.status,
      JSON.stringify(decision)
    )
  }

  for (const testCase of corpus.cases) {
    const decision = evaluateCase(testCase, corpus.default_reference_time)
    check(
      `case_${testCase.id}_status`,
      decision.status === testCase.status,
      JSON.stringify({ text: testCase.text, expected: testCase.status, actual: decision.status, decision })
    )
    check(
      `case_${testCase.id}_date`,
      decision.date_iso === testCase.date_iso,
      JSON.stringify({ text: testCase.text, expected: testCase.date_iso, actual: decision.date_iso, decision })
    )
    check(
      `case_${testCase.id}_never_too_far`,
      decision.status !== 'too_far' && decision.maximum_date_iso === '',
      JSON.stringify(decision)
    )
    if (decision.status === 'legal') {
      check(
        `case_${testCase.id}_legal_available`,
        decision.availability === 'available' &&
          decision.availability_source === 'unbounded_legal_date_policy',
        JSON.stringify(decision)
      )
    }
  }

  const snapshot = policy.buildBookingPolicySnapshot(corpus.default_reference_time)
  check('snapshot_current_date', snapshot.current_message_date_iso === '2026-07-25', JSON.stringify(snapshot))
  check('snapshot_minimum_date', snapshot.minimum_booking_date_iso === '2026-08-01', JSON.stringify(snapshot))
  check(
    'snapshot_no_maximum',
    snapshot.maximum_booking_date_iso === '' &&
      snapshot.maximum_booking_date_local === '' &&
      snapshot.booking_policy_maximum_horizon_days === null,
    JSON.stringify(snapshot)
  )
  check(
    'snapshot_close_options_are_floor_grounded',
    snapshot.close_booking_options_local[0] === 'august 1 (saturday) at 2pm',
    JSON.stringify(snapshot.close_booking_options_local)
  )

  // The production model may phrase the result, but no active authority surface
  // may reintroduce the retired six-month ceiling.
  const authorityFiles = [
    'lua-dm-master-prompt-v17.txt',
    'codex-dm-runner.js',
    'dm-authority.js',
    'scv-single-control-plane.js',
    'scv-closed-transition-contract.js'
  ]
  for (const relative of authorityFiles) {
    const body = fs.readFileSync(path.join(root, relative), 'utf8')
    check(
      `authority_${relative}_has_no_contradictory_booking_policy`,
      policy.contradictoryPolicyPhrases(body).length === 0,
      policy.contradictoryPolicyPhrases(body).join(',')
    )
    check(
      `authority_${relative}_has_no_too_far_status`,
      !/\blive_turn_date_status\s*=\s*['"]too_far['"]|\bstatus\s*:\s*['"]too_far['"]/i.test(body),
      relative
    )
  }
  for (const relative of [
    'codex-dm-runner.js',
    'dm-authority.js',
    'scv-single-control-plane.js',
    'scv-closed-transition-contract.js'
  ]) {
    const body = fs.readFileSync(path.join(root, relative), 'utf8')
    check(
      `authority_${relative}_imports_canonical_policy`,
      body.includes('scv-booking-policy.js'),
      relative
    )
  }
  const masterPrompt = fs.readFileSync(path.join(root, 'lua-dm-master-prompt-v17.txt'), 'utf8')
  check(
    'master_prompt_explicit_unbounded_rule',
    /there is no maximum future booking horizon/i.test(masterPrompt) &&
      /every fully specified client date on or after the one-week minimum is valid and available/i.test(masterPrompt),
    'master prompt missing canonical unbounded rule'
  )

  // Host timezone may not change the booking decision. Run the exact corpus in
  // four independent Node processes with different TZ settings.
  let firstTimezoneSnapshot = null
  for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Europe/Paris']) {
    const child = spawnSync(process.execPath, [__filename, '--tz-snapshot'], {
      cwd: root,
      env: { ...process.env, TZ: timezone },
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024
    })
    check(`timezone_${timezone}_child_exit`, child.status === 0 && !child.error, child.stderr || child.error)
    let parsed = null
    try { parsed = JSON.parse(String(child.stdout || '')) } catch {}
    const validSnapshotDigest = parsed &&
      Number.isInteger(parsed.count) &&
      parsed.count === corpus.cases.length &&
      /^[a-f0-9]{64}$/.test(String(parsed.sha256 || ''))
    check(`timezone_${timezone}_child_json`, validSnapshotDigest, String(child.stdout || '').slice(0, 500))
    if (validSnapshotDigest) {
      if (!firstTimezoneSnapshot) firstTimezoneSnapshot = parsed
      else check(
        `timezone_${timezone}_invariant`,
        JSON.stringify(parsed) === JSON.stringify(firstTimezoneSnapshot),
        'booking result changed with host TZ'
      )
    }
  }

  // Exercise the actual authority annotation and closed transition planner, not
  // only the isolated parser.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-booking-policy-harness-'))
  const previousRoot = process.env.SCV_ROOT
  process.env.SCV_ROOT = sandbox
  try {
    const {
      buildStructuredState,
      annotateStructuredStateForLiveTurn,
      classifyExplicitBookingDateForState
    } = require(path.join(root, 'dm-authority.js'))
    const {
      ACTIONS,
      deriveClosedTransitionPlan,
      evaluateClosedTransitionContract,
      packetClarifiesAmbiguousBookingDate
    } = require(path.join(root, 'scv-closed-transition-contract.js'))

    const baseMessage = {
      contact_id: 'booking-policy-harness',
      thread_id: 'booking-policy-harness',
      instagram_username: 'omar.system',
      received_at: corpus.default_reference_time
    }
    const baseState = buildStructuredState(baseMessage, [])
    check('authority_state_uses_policy_version', baseState.booking_policy_version === policy.SCV_BOOKING_POLICY_VERSION, JSON.stringify(baseState))
    check('authority_state_uses_policy_fingerprint', baseState.booking_policy_fingerprint === policy.BOOKING_POLICY_FINGERPRINT, JSON.stringify(baseState))
    check('authority_state_has_no_maximum', baseState.maximum_booking_date_local === '', JSON.stringify(baseState))

    const direct = classifyExplicitBookingDateForState(
      'Okay, then can we do 15th of August?',
      baseState,
      corpus.default_reference_time
    )
    check('authority_direct_august_15_legal', direct?.status === 'legal' && direct?.date_iso === '2026-08-15', JSON.stringify(direct))

    const annotated = annotateStructuredStateForLiveTurn(
      { ...baseMessage, text: 'Okay, then can we do 15th of August?' },
      { ...baseState, form_link_sent: true, form_submitted: true, last_offered_date: 'august 1', last_offered_time: '2pm' },
      []
    )
    check(
      'authority_annotation_august_15_owns_stale_offer',
      annotated.live_turn_date_status === 'legal' &&
        annotated.live_turn_date_iso === '2026-08-15' &&
        /august/i.test(annotated.live_turn_date_phrase),
      JSON.stringify(annotated)
    )

    const legalInput = {
      ...baseMessage,
      message: 'Okay, then can we do 15th of August?',
      structured_state: {
        ...baseState,
        form_link_sent: true,
        form_submitted: true,
        known_design_context: 'joji portrait',
        last_offered_date: 'august 1',
        last_offered_time: '2pm'
      },
      recent_history: []
    }
    const legalPlan = deriveClosedTransitionPlan(legalInput)
    check('state_machine_legal_date_to_time', legalPlan.action === ACTIONS.POST_FORM_TIME, JSON.stringify(legalPlan))
    check('state_machine_legal_date_exact', legalPlan.fields.date_iso === '2026-08-15', JSON.stringify(legalPlan))
    check('state_machine_legal_date_no_replacement', /august/i.test(legalPlan.fields.proposed_date), JSON.stringify(legalPlan))

    const rejectedLegalPacket = {
      bubbles: [{ text: 'August 15 is not open. August 1 at 2pm is the earliest I can do. Would that work?' }]
    }
    const rejectedLegal = evaluateClosedTransitionContract(legalInput, rejectedLegalPacket, legalPlan)
    check(
      'verifier_rejects_invented_legal_date_closure',
      rejectedLegal.valid === false &&
        ['closed_transition_legal_date_rejection_forbidden', 'closed_transition_legal_date_replacement_forbidden'].includes(rejectedLegal.reason),
      JSON.stringify(rejectedLegal)
    )

    const acceptedLegalPacket = {
      bubbles: [{ text: 'August 15 works. Would 2pm be good for you?' }]
    }
    const acceptedLegal = evaluateClosedTransitionContract(legalInput, acceptedLegalPacket, legalPlan)
    check('verifier_accepts_legal_date_time_move', acceptedLegal.valid === true, JSON.stringify(acceptedLegal))

    const tooSoonInput = {
      ...legalInput,
      message: 'No, I mean July 27. By the way, is it free?'
    }
    const tooSoonPlan = deriveClosedTransitionPlan(tooSoonInput)
    check('state_machine_too_soon_stays_date', tooSoonPlan.action === ACTIONS.POST_FORM_AVAILABILITY, JSON.stringify(tooSoonPlan))
    check('state_machine_compound_price_obligation', tooSoonPlan.obligations.includes('answer_model_rate'), JSON.stringify(tooSoonPlan))

    const ambiguousInput = {
      ...legalInput,
      message: 'Can we do 8/9?'
    }
    const ambiguousPlan = deriveClosedTransitionPlan(ambiguousInput)
    check(
      'state_machine_ambiguous_numeric_clarifies',
      ambiguousPlan.action === ACTIONS.POST_FORM_AVAILABILITY &&
        ambiguousPlan.reason === 'submitted_form_date_requires_clarification',
      JSON.stringify(ambiguousPlan)
    )
    const clarificationPacket = {
      bubbles: [{ text: 'Which date did you mean by 8/9?' }]
    }
    check(
      'ambiguous_date_clarification_shape',
      packetClarifiesAmbiguousBookingDate(clarificationPacket, ambiguousPlan.fields),
      JSON.stringify(ambiguousPlan.fields)
    )
    const clarificationResult = evaluateClosedTransitionContract(
      ambiguousInput,
      clarificationPacket,
      ambiguousPlan
    )
    check('verifier_accepts_ambiguous_date_clarification', clarificationResult.valid === true, JSON.stringify(clarificationResult))

    const timeQuestionHistory = [{ role: 'assistant', text: 'what time works for you?' }]
    const completeBookingSeed = {
      ...baseState,
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_design_context: 'joji portrait',
      known_name_used_on_form: 'Mina',
      known_phone_used_on_form: '4157602883',
      known_requested_date: 'September 4',
      booking_stage_hint: 'awaiting_time'
    }
    const tooEarlyMessage = { ...baseMessage, text: 'Can we do 11am?' }
    const tooEarlyState = annotateStructuredStateForLiveTurn(
      tooEarlyMessage,
      completeBookingSeed,
      timeQuestionHistory
    )
    const tooEarlyInput = {
      ...baseMessage,
      message: tooEarlyMessage.text,
      structured_state: tooEarlyState,
      recent_history: timeQuestionHistory
    }
    const tooEarlyPlan = deriveClosedTransitionPlan(tooEarlyInput)
    check('authority_marks_11am_too_early', tooEarlyState.live_turn_time_status === 'too_early', JSON.stringify(tooEarlyState))
    check('authority_keeps_11am_as_uncommitted_candidate', /11\s*a\.?m\.?/i.test(tooEarlyState.live_turn_time_candidate) && !String(tooEarlyState.known_requested_time || '').trim(), JSON.stringify(tooEarlyState))
    check(
      'state_machine_11am_stays_time_checkpoint',
      tooEarlyPlan.action === ACTIONS.POST_FORM_TIME &&
        tooEarlyPlan.reason === 'submitted_form_time_before_minimum',
      JSON.stringify(tooEarlyPlan)
    )
    const tooEarlyHumanPacket = {
      bubbles: [{ text: '11am is a little too early for me. i start at 1pm, would 1 or 2 work?' }]
    }
    const tooEarlyHumanResult = evaluateClosedTransitionContract(tooEarlyInput, tooEarlyHumanPacket, tooEarlyPlan)
    check('verifier_accepts_1pm_floor_clarification', tooEarlyHumanResult.valid === true, JSON.stringify(tooEarlyHumanResult))
    const tooEarlyBadPacket = {
      bubbles: [{ text: '11am works. Name : Mina\nPhone Number : 4157602883\nAppointment date : September 4\nTime : 11am\n\ncan you double check this?' }]
    }
    const tooEarlyBadResult = evaluateClosedTransitionContract(tooEarlyInput, tooEarlyBadPacket, tooEarlyPlan)
    check('verifier_rejects_early_time_acceptance', tooEarlyBadResult.valid === false, JSON.stringify(tooEarlyBadResult))

    const legalOnePmMessage = { ...baseMessage, text: '1pm works for me' }
    const legalOnePmState = annotateStructuredStateForLiveTurn(
      legalOnePmMessage,
      completeBookingSeed,
      timeQuestionHistory
    )
    const legalOnePmInput = {
      ...baseMessage,
      message: legalOnePmMessage.text,
      structured_state: legalOnePmState,
      recent_history: timeQuestionHistory
    }
    const legalOnePmPlan = deriveClosedTransitionPlan(legalOnePmInput)
    check('authority_marks_1pm_legal', legalOnePmState.live_turn_time_status === 'legal', JSON.stringify(legalOnePmState))
    check(
      'state_machine_1pm_advances_to_double_check',
      legalOnePmPlan.action === ACTIONS.DOUBLE_CHECK && /1(?::00)?\s*p\.?m\.?/i.test(legalOnePmPlan.fields.time),
      JSON.stringify(legalOnePmPlan)
    )

    const emptyResult = evaluateClosedTransitionContract(legalInput, { bubbles: [] }, legalPlan)
    check(
      'empty_reply_always_rejected',
      emptyResult.valid === false && emptyResult.reason === 'closed_transition_visible_reply_required',
      JSON.stringify(emptyResult)
    )
  } finally {
    if (previousRoot === undefined) delete process.env.SCV_ROOT
    else process.env.SCV_ROOT = previousRoot
    try { fs.rmSync(sandbox, { recursive: true, force: true }) } catch {}
  }

  // v10 (owner red-team 2026-09-03): ordinal WORDS are calendar days ("fifth of September" == "5th of September").
  {
    const ordinalCases = [
      ['Can we do fifth of September?', /5th of September/i],
      ['Can we do the fifth?', /the 5th/i],
      ['can we do sept fifth', /sept 5th/i],
      ['how about the twelfth of september', /12th of september/i],
      ['actually the twenty-first works', /the 21st/i],
      ['twenty first of september please', /21st of september/i]
    ]
    for (const [text, expected] of ordinalCases) {
      const frame = policy.calendarBookingProposalFrame(text, { allowBareDate: true })
      check(`ordinal_word_day_frame :: ${text}`, frame.proposal === true && expected.test(frame.candidate_text), JSON.stringify(frame))
    }
    check('ordinal_word_day_no_false_positive', policy.calendarBookingProposalFrame('first come first served lol', { allowBareDate: true }).proposal === false, 'first come first served')
    const classified = policy.classifyBookingDateText('Can we do fifth of September?', { referenceTime: '2026-09-03T13:48:59-07:00' })
    check('ordinal_word_day_classified_too_soon', classified.date_iso === '2026-09-05' && classified.status === 'too_soon', JSON.stringify({ iso: classified.date_iso, status: classified.status }))
    check('ordinal_word_expansion_is_idempotent', policy.expandOrdinalWordDays(policy.expandOrdinalWordDays('the fifth and the 5th')) === 'the 5th and the 5th', policy.expandOrdinalWordDays('the fifth and the 5th'))
    check('ordinal_word_days_invariant_present', Array.isArray(policy.BOOKING_POLICY_INVARIANTS) ? policy.BOOKING_POLICY_INVARIANTS.some((item) => String(item && (item.id || item)).includes('ordinal_word_days')) : true, JSON.stringify(policy.BOOKING_POLICY_INVARIANTS || null).slice(0, 300))
  }

  return {
    ok: failures.length === 0,
    locked: failures.length === 0,
    lock_version: SCV_BOOKING_POLICY_HARNESS_VERSION,
    policy_version: policy.SCV_BOOKING_POLICY_VERSION,
    policy_fingerprint: policy.BOOKING_POLICY_FINGERPRINT,
    golden_case_version: corpus.version,
    golden_cases: corpus.cases.length,
    checked,
    failures,
    proof_mode: corpus.proof_mode,
    network: false,
    live_delivery_claim: false
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
  SCV_BOOKING_POLICY_HARNESS_VERSION,
  runScvBookingPolicyHarness: runHarness,
  runHarness,
  timezoneSnapshot
}
