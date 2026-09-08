#!/usr/bin/env node
const path = require('path')
const fs = require('fs')

const {
  SCV_CONTRACT_HARNESS_LOCK_VERSION,
  SCV_CONTRACT_HARNESS_LOCKED,
  runScvContractHarnessSelfTest,
  PREFERRED_FORM_LINK,
  textHasApproximateSizeSignal,
  liveProvidesSizeAnswer,
  packetHasLockedPricingAnswer
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  SCV_HUMAN_WORD_CHOICE_LOCK_VERSION,
  humanWordChoiceHit
} = require(path.join(__dirname, 'scv-human-word-choice.js'))
const {
  SCV_HUMAN_WORD_CHOICE_HARNESS_VERSION,
  runScvHumanWordChoiceHarness
} = require(path.join(__dirname, 'scv-human-word-choice-harness.js'))
const { runScvCriticalRouteHarness } = require(path.join(__dirname, 'scv-critical-route-harness.js'))
const {
  SCV_DELIVERY_PACING_LOCK_VERSION,
  SCV_DELIVERY_PACING_HARD_LOCKED,
  SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY,
  EXPECTED_DELIVERY_PACING_SETTINGS,
  pacingSettingsFromEnv,
  assertExactPacingSettings,
  deliveryDelayForBubble,
  evaluateInitialDelayHardGate,
  DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS
} = require(path.join(__dirname, 'scv-delivery-pacing.js'))
const { runScvOutboxOrderHarness } = require(path.join(__dirname, 'scv-outbox-order-harness.js'))
const { runKandoRegressionHarness } = require(path.join(__dirname, 'scv-kando-regression-harness.js'))
const {
  SCV_SINGLE_CONTROL_HARNESS_LOCK_VERSION,
  runScvSingleControlPlaneHarness
} = require(path.join(__dirname, 'scv-single-control-plane-harness.js'))
const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  SCV_CONTROL_EPOCH,
  CONTROL_RECEIPT_VERSION,
  DEFAULT_CONTROL_REAUTHOR_PASSES,
  MAX_CONTROL_REAUTHOR_PASSES,
  CONTROL_REPAIR_LEDGER_LIMIT,
  CONTROL_REPAIR_LOOP_VERSION,
  SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
  parseCandidateVerifierFailure
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  SCV_CLOSED_TRANSITION_HARNESS_VERSION,
  runClosedTransitionHarness
} = require(path.join(__dirname, 'scv-closed-transition-contract-harness.js'))
const {
  SCV_CLOSED_LIFECYCLE_HARNESS_VERSION,
  runScvClosedLifecycleHarness
} = require(path.join(__dirname, 'scv-closed-lifecycle-harness.js'))
const {
  SCV_REFERENCE_ATTACHMENT_COALESCING_HARNESS_VERSION,
  runScvReferenceAttachmentCoalescingHarness
} = require(path.join(__dirname, 'scv-reference-attachment-coalescing-harness.js'))
const {
  SCV_DISCOURSE_CONTINUITY_HARNESS_VERSION,
  runScvDiscourseContinuityHarness
} = require(path.join(__dirname, 'scv-discourse-continuity-harness.js'))
const {
  buildDeterministicBookingPacket,
  buildPreIntentDeterministicBookingPacket,
  resolveBookingFunnelStage,
  enforceSizePlacementLock,
  enforceFunnelOrderLock,
  enforcePendingFormLinkFulfillment,
  bubblePushesSpecificPreFormCalendar,
  enforceFormConsentSourceLock,
  formLinkAuthorizedThisTurn,
  controllerRequiresFormDelivery,
  bindControllerOwnedPacketMetadata,
  applyDeterministicPacketLocks,
  buildControllerActionGuidance,
  verifyPostFilterAdoption,
  reconcileControllerPlanAfterAuthorityEvidence,
  isExplicitFormLinkRequest,
  recentAskedFormPermission,
  liveFormConsentGranted,
  liveFormSubmittedSignal,
  buildVisibleReplySystemPrompt,
  detectGenericAiTone
} = require(path.join(__dirname, 'codex-dm-runner.js'))
const {
  normalizePacket,
  annotateStructuredStateForLiveTurn,
  summarizeRunnerFailure
} = require(path.join(__dirname, 'dm-authority.js'))
const { run: runScvTestAccountPurgeHarness } = require(path.join(__dirname, 'scv-test-account-purge-harness.js'))
const {
  SCV_VISIBLE_IDENTITY_ADVERSARIAL_HARNESS_VERSION,
  runScvVisibleIdentityAdversarialHarness
} = require(path.join(__dirname, 'scv-visible-identity-adversarial-harness.js'))
const {
  SCV_API_PROMPT_AUTHORITY_HARNESS_VERSION,
  runScvApiPromptAuthorityHarness
} = require(path.join(__dirname, 'scv-api-prompt-authority-harness.js'))
const {
  SCV_MEDIA_AUTHORITY_MONOTONIC_HARNESS_VERSION,
  runScvMediaAuthorityMonotonicHarness
} = require(path.join(__dirname, 'scv-media-authority-monotonic-harness.js'))
const {
  SCV_BOOKING_POLICY_VERSION,
  BOOKING_POLICY_FINGERPRINT
} = require(path.join(__dirname, 'scv-booking-policy.js'))
const {
  SCV_BOOKING_POLICY_HARNESS_VERSION,
  runScvBookingPolicyHarness
} = require(path.join(__dirname, 'scv-booking-policy-harness.js'))
const {
  SCV_BOOKING_SPEECH_ACT_HISTORY_HARNESS_VERSION,
  runScvBookingSpeechActHistoryHarness
} = require(path.join(__dirname, 'scv-booking-speech-act-history-harness.js'))
const {
  SCV_CONTEXT_GROUNDING_HARNESS_VERSION,
  runScvContextGroundingHarness
} = require(path.join(__dirname, 'scv-context-grounding-harness.js'))

const SCV_HARD_HARNESS_LOCK_VERSION = 'scv-hard-harness-lock-2026-09-08-v177-context-grounded-client-intent'

function runScvHardHarnessLock() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  const hostileEnvSettings = pacingSettingsFromEnv({
    SCV_NON_FAST_INITIAL_DELAY_MIN_MS: '1',
    SCV_NON_FAST_INITIAL_DELAY_MAX_MS: '2',
    SCV_BUBBLE_GAP_MIN_MS: '3',
    SCV_BUBBLE_GAP_MAX_MS: '4',
    SCV_ALLOW_DELIVERY_PACING_ENV_OVERRIDE: '1'
  })
  try { assertExactPacingSettings(hostileEnvSettings, 'hard_harness_hostile_env') } catch (err) { failures.push({ name: 'hostile_env_settings_exact', detail: String(err.message || err) }) }

  const contract = runScvContractHarnessSelfTest()
  const critical = runScvCriticalRouteHarness()
  const outboxOrder = runScvOutboxOrderHarness()
  const kandoRegression = runKandoRegressionHarness()
  const singleControl = runScvSingleControlPlaneHarness()
  const closedTransition = runClosedTransitionHarness()
  const closedLifecycle = runScvClosedLifecycleHarness()
  const referenceAttachmentCoalescing = runScvReferenceAttachmentCoalescingHarness()
  const discourseContinuity = runScvDiscourseContinuityHarness()
  const testAccountPurge = runScvTestAccountPurgeHarness()
  const visibleIdentityAdversarial = runScvVisibleIdentityAdversarialHarness()
  const apiPromptAuthority = runScvApiPromptAuthorityHarness()
  const mediaAuthorityMonotonic = runScvMediaAuthorityMonotonicHarness()
  const bookingPolicy = runScvBookingPolicyHarness()
  const bookingSpeechActHistory = runScvBookingSpeechActHistoryHarness()
  const contextGrounding = runScvContextGroundingHarness()
  const humanWordChoice = runScvHumanWordChoiceHarness()
  const settings = hostileEnvSettings
  const fast = deliveryDelayForBubble({ bubble: { text: 'hey', delay_ms: 777777 }, index: 0, fastDelayTarget: true, settings, rng: () => 0.5 })
  const firstMin = deliveryDelayForBubble({ bubble: { text: 'hey' }, index: 0, settings, rng: () => 0 })
  const firstMax = deliveryDelayForBubble({ bubble: { text: 'hey' }, index: 0, settings, rng: () => 0.999999 })
  const micro = deliveryDelayForBubble({ bubble: { text: 'yeah' }, index: 1, settings, rng: () => 0.2 })
  const short = deliveryDelayForBubble({ bubble: { text: 'yeah that works for me' }, index: 1, settings, rng: () => 0.3 })
  const normal = deliveryDelayForBubble({ bubble: { text: 'i can work with that, do you want it more visible or a little quieter on the shoulder?' }, index: 1, settings, rng: () => 0.4 })
  const operational = deliveryDelayForBubble({ bubble: { text: 'here is the form: https://www.effacermonexistence.com/apply' }, index: 1, settings, rng: () => 0.4 })
  const long = deliveryDelayForBubble({ bubble: { text: 'once you send it just lmk so i can double check everything on my side and confirm your appointment on my calendar' }, index: 1, settings, rng: () => 0.5 })

  check('hard_harness_version_exact', SCV_HARD_HARNESS_LOCK_VERSION === 'scv-hard-harness-lock-2026-09-08-v177-context-grounded-client-intent', SCV_HARD_HARNESS_LOCK_VERSION)
  check(
    'send_form_generic_availability_tail_is_not_calendar_jump',
    bubblePushesSpecificPreFormCalendar('once it is in send me a couple dates here too so i can check what works') === false
  )
  check(
    'send_form_specific_pre_submission_slot_remains_calendar_jump',
    bubblePushesSpecificPreFormCalendar('would July 27 at 2pm work for you?') === true
  )
  check(
    'send_form_lower_booking_boundary_choices_are_not_calendar_jump',
    bubblePushesSpecificPreFormCalendar('send me a couple dates from August 31 onward so i can check what is open') === false
  )
  check(
    'send_form_lower_boundary_does_not_exempt_actual_slot_commitment',
    bubblePushesSpecificPreFormCalendar('I can do August 31 at 2pm and hold that slot for you') === true
  )
  check('contract_lock_version_v129_exact', SCV_CONTRACT_HARNESS_LOCK_VERSION === 'scv-contract-harness-lock-2026-09-08-v129-context-grounded-client-intent', SCV_CONTRACT_HARNESS_LOCK_VERSION)
  check('contract_locked_true', SCV_CONTRACT_HARNESS_LOCKED === true, String(SCV_CONTRACT_HARNESS_LOCKED))
  check('contract_self_test_374', contract.ok === true && contract.checked === 374, JSON.stringify(contract))
  check(
    'context_grounding_harness_v1_passes',
    SCV_CONTEXT_GROUNDING_HARNESS_VERSION === 'scv-context-grounding-harness-2026-09-08-v1-evidence-bound-model-and-biography-routing' &&
      contextGrounding.ok === true && contextGrounding.checked >= 60 && contextGrounding.failures.length === 0,
    JSON.stringify(contextGrounding)
  )
  // v160 (live 2026-09-07 05:59Z, Omar.system): the exact incident audio produced "black and grey" and
  // "black and gray"; v159 treated the spelling variants as conflicting evidence, the adjudicator
  // rejected both, the failed-voice recovery drifted to an image draft, and the client got silence.
  // Orthography-only consensus adopts an exact candidate; every semantic difference stays gated.
  {
    const runner160 = require(path.join(__dirname, 'codex-dm-runner.js'))
    const norm = runner160.normalizeAsrCandidate
    check('asr_orthography_only_consensus_grey_gray_colour_color',
      typeof norm === 'function' && norm('Do you also do black and grey?') === norm('Do you also do black and gray?') && norm('what colour do you use') === norm('what color do you use'),
      JSON.stringify([norm && norm('Do you also do black and grey?'), norm && norm('Do you also do black and gray?')]))
    check('asr_semantic_differences_stay_distinct',
      typeof norm === 'function' && norm('do you do black and gray') !== norm('do you not do black and gray') && norm('can we do 2pm') !== norm('can we do 3pm') && norm('is it 100') !== norm('is it 150') && norm('send the form') !== norm('do not send the form') && norm('black and gray') !== norm('back in the grade'),
      'semantic gate')
  }
  // v161 (live 2026-09-07 19:13Z, Omar.system): an aftercare-cream picture, the host lead, then "I mean I just
  // want the after cream ointment as a reference" answered with "that screenshot is just aftercare tho". The
  // nominated object is the design; re-grading it or asking for the actual picture is rejected; the lane latch
  // is not a precondition; the sentence is readable design memory.
  {
    const contract161 = require(path.join(__dirname, 'scv-contract-harness.js'))
    const image161 = { role: 'user', message_id: 'h161-image', text_source: 'single_control_media_context_enriched', text: 'sent a reference post: The image shows a screenshot of a product listing for a tube of aftercare ointment, a vitamin based healing cream, with the label visible' }
    const history161 = [image161, { role: 'assistant', message_id: 'h161-image', text: 'That looks like aftercare ointment, not the tattoo itself' }, { role: 'assistant', message_id: 'h161-image', text: 'If you meant a tattoo reference, send me the actual picture or tell me the vibe' }]
    const input161 = (text, extra = {}) => ({ message_id: 'h161-live', message: text, live_message: text, recent_history: history161.concat([{ role: 'user', message_id: 'h161-live', text }]), structured_state: { reference_media_classification_observed: true, known_reference_media_received: true, ...extra } })
    const nominated161 = input161('I mean I just want the after cream ointment as a reference')
    check('nominated_object_in_own_picture_is_design_authority', contract161.clientAnchoredInspirationReference(nominated161) === true && contract161.liveTurnUsesNonTattooMediaContext(nominated161) === false, 'anchored without the lane latch')
    check('regrading_the_nominated_object_is_rejected', contract161.evaluateScvContractHarness(nominated161, { bubbles: [{ text: 'Got you' }, { text: 'that screenshot is just aftercare tho, not really a tattoo design on its own' }, { text: 'want me to send the application form over?' }] }).reason === 'anchored_inspiration_reference_cannot_reopen_design_interview', 'regrade')
    check('asking_for_the_actual_picture_after_the_nomination_is_rejected', contract161.evaluateScvContractHarness(nominated161, { bubbles: [{ text: 'Got you' }, { text: 'If you meant a tattoo reference, send me the actual picture or tell me the vibe' }] }).reason === 'anchored_inspiration_reference_cannot_reopen_design_interview', 'resend')
    check('nominated_object_affirmation_with_form_offer_is_valid', contract161.evaluateScvContractHarness(nominated161, { bubbles: [{ text: 'got you!! the ointment tube as the reference totally works, i can turn that into a piece in my style 🖤' }, { text: 'want me to send the application form so we can lock it in?' }] }).valid === true, 'valid')
    check('bare_pointer_on_a_non_tattoo_screenshot_keeps_the_host_lead', contract161.clientAnchoredInspirationReference(input161('this one', { tattoo_intent_active: true })) === false, 'v153 boundary')
    check('nominated_reference_sentence_is_design_memory', contract161.storedDesignContextIsDesign('I mean I just want the after cream ointment as a reference') === true && contract161.storedDesignContextIsDesign('use that as a reference') === false, 'memory')
  }
  // v162 (live 2026-09-07 21:18Z, Omar.system): a cost objection holds the booking motion; the first price answer
  // travels with every recovery route.
  {
    const contract162 = require(path.join(__dirname, 'scv-contract-harness.js'))
    const closed162 = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
    const hist162 = [
      { role: 'assistant', message_id: 'h162-a1', text: 'here is the form https://www.effacermonexistence.com/apply fill it out and tell me a couple dates that work' },
      { role: 'user', message_id: 'h162-u1', text: 'How much is it by the way?' },
      { role: 'assistant', message_id: 'h162-u1', text: 'this is my discounted model rate at $150 per hour when the finished piece stays in my style' }
    ]
    const objection162 = { message_id: 'h162-live', message: "I thought it's free though. My budget is tight.", live_message: "I thought it's free though. My budget is tight.", recent_history: hist162.concat([{ role: 'user', message_id: 'h162-live', text: "I thought it's free though. My budget is tight." }]), structured_state: { tattoo_intent_active: true, known_design_context: 'a snake on my forearm', form_offer_asked: true, form_link_sent: true, form_submitted: true, known_model_rate_disclosed: true, booking_stage_hint: 'awaiting_date' } }
    const plan162 = closed162.deriveClosedTransitionPlan(objection162)
    check('cost_objection_routes_to_the_budget_hold', plan162.action === 'budget_objection_hold' && (plan162.obligations || []).includes('acknowledge_rate_already_given'), JSON.stringify([plan162.action, plan162.obligations]))
    check('cost_objection_slot_push_is_rejected', contract162.evaluateScvContractHarness(objection162, { bubbles: [{ text: "I get it. It's still the model rate I mentioned earlier and nothing's changed." }, { text: 'if you want a weekend spot, September 9th or 20th at 2pm are open' }] }).reason === 'budget_objection_cannot_push_booking', 'slot push')
    check('cost_objection_budget_question_with_limited_framing_is_valid', contract162.evaluateScvContractHarness(objection162, { bubbles: [{ text: 'nah it is not free — it is the model rate i mentioned earlier, that part stays the same 🖤' }, { text: 'what budget are you working with? these model spots are limited and this rate is only open right now, so give me your range and i will shape the piece around it' }] }).valid === true, 'valid')
    check('stated_budget_is_money_not_size', contract162.textStatesBudgetAmount('around 300 max') === true && contract162.liveStatesBudgetAmount({ message: 'around 300 max', live_message: 'around 300 max', recent_history: [{ role: 'assistant', text: 'what budget are you working with?' }], structured_state: {} }) === true && contract162.textStatesBudgetAmount('how much is it?') === false, 'budget amount')
  }
  check(
    'runner_failure_summary_preserves_new_verifier_family',
    summarizeRunnerFailure([
      'Error: deterministic_recovery_contract_rejected_form_permission_gate_after_consultation :: []',
      '    at runModelAuthoredFlow (/app/codex-dm-runner.js:3997:15)',
      '    at async main (/app/codex-dm-runner.js:5059:18)'
    ].join('\n')).startsWith('Error: deterministic_recovery_contract_rejected_form_permission_gate_after_consultation :: []')
  )
  const exactMutationFeedback = parseCandidateVerifierFailure(
    'codex_runner_failed_1 :: Error: post_filter_adoption_rejected_after_reauthor_non_authoring_guard_requires_model_reauthor :: non_authoring_surface_mutations=["pending_form_calendar_jump"]'
  )
  check(
    'outer_control_reauthor_receives_exact_non_authoring_mutation',
    exactMutationFeedback?.reason === 'after_reauthor_non_authoring_guard_requires_model_reauthor' &&
      exactMutationFeedback?.instruction?.includes('pending_form_calendar_jump'),
    JSON.stringify(exactMutationFeedback)
  )
  check('calendar_clock_number_never_classified_as_size', textHasApproximateSizeSignal('August 1st around 2 pm would be perfect for me') === false)
  check('explicit_approximate_size_remains_classified', textHasApproximateSizeSignal('roughly 8 in or so') === true)
  const contextualDateHistory = [
    { role: 'assistant', message_id: 'form-date-packet', text: 'perfect i got the form' },
    { role: 'assistant', message_id: 'form-date-packet', text: 'what dates or weekend days are easiest for you?' }
  ]
  const contextualDateState = annotateStructuredStateForLiveTurn(
    { text: 'How about 26?', message: 'How about 26?' },
    {
      tattoo_intent_active: true,
      known_design_context: 'black and gray reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      current_message_date_local: 'July 23, 2026',
      minimum_booking_date_local: 'July 30, 2026',
      maximum_booking_date_local: 'January 23, 2027'
    },
    contextualDateHistory
  )
  // Sealed 2026-08-26 (v95 incident): in an awaiting_date thread, "How about 26?"
  // is a monthless DAY proposal. Reading the bare number as a size answer is the
  // exact false trigger that livelocked the date step in production, so the lock
  // now pins the date reading AND that the size classifier stays silent on it.
  check(
    'contextual_post_form_day_not_misread_as_size',
    contextualDateState.live_turn_contextual_booking_reply === true &&
      contextualDateState.live_turn_monthless_day_candidate === '26' &&
      contextualDateState.live_turn_date_needs_month === true &&
      !String(contextualDateState.known_size_context || '').trim() &&
      liveProvidesSizeAnswer({
        message: 'How about 26?',
        live_message: 'How about 26?',
        recent_history: contextualDateHistory,
        structured_state: contextualDateState
      }) === false,
    JSON.stringify(contextualDateState)
  )
  const temporalClosedCheckpoint = buildPreIntentDeterministicBookingPacket({
    message: 'August 1st around 2 pm would be perfect for me',
    recent_history: [{ role: 'assistant', text: 'August 1st or 2nd around 2pm both work on my side which one feels better for you?' }],
    structured_state: {
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Omar Test One',
      known_phone_used_on_form: '4155550111',
      known_requested_date: 'August 1st',
      known_requested_time: '2pm',
      live_turn_date_phrase: 'August 1st',
      live_turn_date_status: 'legal',
      live_turn_time_phrase: '2pm',
      current_message_date_local: 'July 23, 2026',
      minimum_booking_date_local: 'July 30, 2026',
      booking_stage_hint: 'awaiting_date'
    }
  })
  check(
    'closed_temporal_booking_checkpoint_bypasses_intent_and_emits_exact_doublecheck',
    temporalClosedCheckpoint?.packet?.bubbles?.[0]?.text === 'Name : Omar Test One\nPhone Number : 4155550111\nAppointment date : 1st of August\nTime : 2pm\n\ncan you double check this just to make sure',
    JSON.stringify(temporalClosedCheckpoint)
  )
  check(
    'preintent_checkpoint_bypass_does_not_capture_open_design_lane',
    buildPreIntentDeterministicBookingPacket({
      message: 'i want a tiger wrapping around my upper arm',
      recent_history: [],
      structured_state: { booking_stage_hint: 'design_intake' }
    }) === null
  )
  check('critical_self_test_32', critical.ok === true && critical.checked === 32, JSON.stringify(critical))
  check('outbox_order_self_test_10', outboxOrder.ok === true && outboxOrder.checked === 10, JSON.stringify(outboxOrder))
  check('outbox_order_lock_version_v2', outboxOrder.lock_version === 'scv-outbox-send-order-lock-2026-07-10-v2', JSON.stringify(outboxOrder))
  check('single_control_harness_lock_exact', SCV_SINGLE_CONTROL_HARNESS_LOCK_VERSION === 'scv-single-control-harness-2026-08-29-v48-bare-hour-and-recovery-durability', SCV_SINGLE_CONTROL_HARNESS_LOCK_VERSION)
  check('single_control_self_test_141', singleControl.ok === true && singleControl.checked === 141, JSON.stringify(singleControl))
  check('single_control_plane_id_exact', SCV_SINGLE_CONTROL_PLANE_ID === 'scv-single-control-plane-2026-07-12-v3-route-frozen-liveness', SCV_SINGLE_CONTROL_PLANE_ID)
  check('single_control_source_exact', SCV_SINGLE_CONTROL_SOURCE === 'scv_single_control_plane', SCV_SINGLE_CONTROL_SOURCE)
  check('single_control_epoch_exact', SCV_CONTROL_EPOCH === 'scv-control-epoch-2026-07-12-v3-route-frozen-liveness', SCV_CONTROL_EPOCH)
  check('payload_bound_receipt_version_exact', CONTROL_RECEIPT_VERSION === 'scv-control-receipt-v2-payload-bound', CONTROL_RECEIPT_VERSION)
  check('control_verifier_hot_reauthor_budget_exact', DEFAULT_CONTROL_REAUTHOR_PASSES === 3 && MAX_CONTROL_REAUTHOR_PASSES === 3, `${DEFAULT_CONTROL_REAUTHOR_PASSES}/${MAX_CONTROL_REAUTHOR_PASSES}`)
  check('control_verifier_repair_ledger_limit_exact', CONTROL_REPAIR_LEDGER_LIMIT === 12, String(CONTROL_REPAIR_LEDGER_LIMIT))
  check('control_verifier_feedback_loop_version_exact', CONTROL_REPAIR_LOOP_VERSION === 'scv-verifier-feedback-loop-2026-07-25-v1', CONTROL_REPAIR_LOOP_VERSION)
  check('closed_transition_contract_version_exact', SCV_CLOSED_TRANSITION_CONTRACT_VERSION === 'scv-closed-transition-contract-2026-09-08-v86-artist-biography-is-not-client-intent', SCV_CLOSED_TRANSITION_CONTRACT_VERSION)
  check('closed_transition_harness_version_exact', SCV_CLOSED_TRANSITION_HARNESS_VERSION === 'scv-closed-transition-harness-2026-08-29-v65-clock-wording-and-discounted-model-rate', SCV_CLOSED_TRANSITION_HARNESS_VERSION)
  check('closed_transition_matrix_and_flag_power_set_all_locked',
    closedTransition.ok === true &&
      closedTransition.enumerated_transitions === 132 &&
      closedTransition.combination_flags === 8 &&
      closedTransition.enumerated_combination_transitions === 3072 &&
      closedTransition.checked === 10010,
    JSON.stringify(closedTransition))
  check(
    'canonical_booking_policy_identity_exact',
    SCV_BOOKING_POLICY_VERSION === 'scv-booking-policy-2026-09-03-v5-ordinal-word-days' &&
      BOOKING_POLICY_FINGERPRINT === 'f1cbb01c1e021396d8dfda9e33cda4a2e3d21261859b9930ff35b1db2953362f',
    `${SCV_BOOKING_POLICY_VERSION}:${BOOKING_POLICY_FINGERPRINT}`
  )
  check(
    'canonical_booking_policy_full_regression_locked',
    SCV_BOOKING_POLICY_HARNESS_VERSION === 'scv-booking-policy-harness-2026-09-03-v10-ordinal-word-days' &&
      bookingPolicy.ok === true &&
      bookingPolicy.golden_cases === 64 &&
      bookingPolicy.checked === 766 &&
      Array.isArray(bookingPolicy.failures) &&
      bookingPolicy.failures.length === 0,
    JSON.stringify(bookingPolicy)
  )
  check(
    'booking_speech_act_history_harness_version_exact',
    SCV_BOOKING_SPEECH_ACT_HISTORY_HARNESS_VERSION ===
      'scv-booking-speech-act-history-harness-2026-08-25-v4-atomic-four-field-rebuild-authority',
    SCV_BOOKING_SPEECH_ACT_HISTORY_HARNESS_VERSION
  )
  check(
    'booking_speech_act_history_full_regression_locked',
    bookingSpeechActHistory.ok === true &&
      bookingSpeechActHistory.locked === true &&
      bookingSpeechActHistory.checked === 140 &&
      bookingSpeechActHistory.network === false &&
      bookingSpeechActHistory.external_changes === false &&
      Array.isArray(bookingSpeechActHistory.failures) &&
      bookingSpeechActHistory.failures.length === 0,
    JSON.stringify(bookingSpeechActHistory)
  )
  check('closed_lifecycle_harness_version_exact', SCV_CLOSED_LIFECYCLE_HARNESS_VERSION === 'scv-closed-lifecycle-harness-2026-08-30-v14-marker-race-and-prenetwork-replay', SCV_CLOSED_LIFECYCLE_HARNESS_VERSION)
  check('closed_lifecycle_failure_classes_all_locked',
    // 27 -> 29 (2026-08-24): an authoritative-latest packet may be recovered
    // from superseded quarantine once. A repeated crossing is fused into a
    // preserved human-agent hold and audited exactly once, preventing the live
    // 2,971-event inbox/quarantine ABA loop.
    // 29 -> 31 (2026-08-25): a missing immutable source timestamp is now a
    // bounded persistent-internal failure class instead of an unbounded retry.
    // 35 -> 37 (2026-08-25): persistent/unclassified cap exhaustion now emits
    // one route-aware nontransactional reply plus one operator artifact.
    // 37 -> 38 (2026-08-29): a fresh time answer before 1 PM must remain at
    // the time checkpoint and expose the 1 PM floor even when an older repair
    // ledger forces the bounded visible-recovery path.
    // 38 -> 54 (2026-08-30): runner/delivery/persistent final recovery is
    // monotonic and finite; strict adoption reconciliation prevents blind
    // resend, stage tags separate upstream from 3101 errors, and successful
    // recovery leaves no actionable operator handoff.
    // 54 -> 59 (2026-08-30): marker repair cannot recreate a concurrently
    // consumed queue, and committed local pre-network failures get one exact
    // receipt replay with a stable finite terminal boundary.
    closedLifecycle.ok === true && closedLifecycle.failure_classes === 12 && closedLifecycle.checked === 59,
    JSON.stringify(closedLifecycle))
  check('reference_attachment_coalescing_harness_version_exact',
    SCV_REFERENCE_ATTACHMENT_COALESCING_HARNESS_VERSION === 'scv-reference-attachment-coalescing-harness-2026-07-19-v4-no-false-understanding-prefix',
    SCV_REFERENCE_ATTACHMENT_COALESCING_HARNESS_VERSION)
  check('reference_attachment_coalescing_regression_all_locked',
    referenceAttachmentCoalescing.ok === true && referenceAttachmentCoalescing.checked === 27,
    JSON.stringify(referenceAttachmentCoalescing))
  check('discourse_continuity_harness_version_exact',
    SCV_DISCOURSE_CONTINUITY_HARNESS_VERSION === 'scv-discourse-continuity-harness-2026-08-25-v27-rejected-date-continuation-authority',
    SCV_DISCOURSE_CONTINUITY_HARNESS_VERSION)
  check('discourse_continuity_inductive_regressions_all_locked',
    discourseContinuity.ok === true && discourseContinuity.checked === 145,
    JSON.stringify(discourseContinuity))
  check('debug_reset_source_time_boundary_regressions_all_locked',
    testAccountPurge.ok === true && testAccountPurge.checked === 52,
    JSON.stringify(testAccountPurge))
  check('visible_identity_system_role_and_booking_meta_adversarial_all_locked',
    SCV_VISIBLE_IDENTITY_ADVERSARIAL_HARNESS_VERSION === 'scv-visible-identity-adversarial-harness-2026-09-01-v13-human-word-choice' &&
      visibleIdentityAdversarial.ok === true &&
      visibleIdentityAdversarial.checked === 449 &&
      visibleIdentityAdversarial.generic_booking_cases === 248 &&
      visibleIdentityAdversarial.concrete_design_cases === 63 &&
      visibleIdentityAdversarial.unresolved_context_cases === 6,
    JSON.stringify(visibleIdentityAdversarial))
  check('api_prompt_authority_all_semantic_call_sites_fail_closed',
    SCV_API_PROMPT_AUTHORITY_HARNESS_VERSION === 'scv-api-prompt-authority-harness-2026-08-24-v9-archive-first-info-reply' &&
      apiPromptAuthority.ok === true &&
      apiPromptAuthority.checked === 84 &&
      apiPromptAuthority.semantic_call_sites?.visible_reply === 'full_authority_bound_cli_chat_fallback' &&
      apiPromptAuthority.semantic_call_sites?.responses_visible_reply === 'rcc_revas_pre_inference_chatgpt_convergence_author' &&
      apiPromptAuthority.semantic_call_sites?.vision_evidence_extractor === 'authority_bound',
    JSON.stringify(apiPromptAuthority))
  const initialMediaOfferGuidance = buildControllerActionGuidance({ action: 'offer_form' })
  check('initial_media_offer_route_has_semantic_guidance_not_visible_script',
    initialMediaOfferGuidance.includes('subject-bounded creative freedom') &&
      initialMediaOfferGuidance.includes('does not need to look like a finished tattoo reference') &&
      initialMediaOfferGuidance.includes('ask once whether they want the application form') &&
      initialMediaOfferGuidance.includes('ask what part/vibe they mean again') &&
      initialMediaOfferGuidance.includes('Do not grade the source image') &&
      !initialMediaOfferGuidance.includes('can send you the form to fill out') &&
      !initialMediaOfferGuidance.includes(PREFERRED_FORM_LINK),
    initialMediaOfferGuidance)
  const initialDesignGuidance = buildControllerActionGuidance({ action: 'design_intake' })
  check('initial_tattoo_design_intake_route_has_non_script_lead_guidance',
    initialDesignGuidance.includes('one easy answerable idea, subject, reference, or vibe move') &&
      initialDesignGuidance.includes('Do not ask size, placement, date, or form questions') &&
      initialDesignGuidance.includes('The final bubble must be directly answerable') &&
      initialDesignGuidance.includes('Profile, highlight, and custom-availability statements alone are not forward motion') &&
      !initialDesignGuidance.includes('what kind of'),
    initialDesignGuidance)
  const missingReferentGuidance = buildControllerActionGuidance({ action: 'resolve_context', reason: 'ambiguous_missing_referent' })
  check('missing_referent_route_requires_open_identification_not_placeholder_choice',
      missingReferentGuidance.includes('one short open question') &&
      missingReferentGuidance.includes('identify, name, show, or describe') &&
      missingReferentGuidance.includes('same/new or this/that') &&
      missingReferentGuidance.includes('later clarification question cannot wash an earlier false-understanding phrase') &&
      missingReferentGuidance.includes('positive approval or evaluation') &&
      !missingReferentGuidance.includes('strongest supportable candidate'),
    missingReferentGuidance)
  const spatialClarificationInput = {
    message: "I'm tryna go kinda over there with it",
    live_message: "I'm tryna go kinda over there with it",
    recent_history: [
      { role: 'user', text: 'black and grey tiger wrapping around my upper arm' },
      { role: 'assistant', text: 'want me to send the form?' }
    ],
    control_transition_contract: {
      action: 'resolve_context',
      reason: 'ambiguous_missing_referent',
      obligations: [],
      fields: {}
    },
    structured_state: {
      live_turn_text: "I'm tryna go kinda over there with it",
      live_turn_context_relation: 'ambiguous_missing_referent',
      live_turn_context_missing: true,
      live_turn_context_needs_clarification: true,
      known_design_context: 'black and grey tiger',
      known_placement_context: 'upper arm',
      form_offer_asked: true
    }
  }
  const spatialClarificationPacket = applyDeterministicPacketLocks(spatialClarificationInput, {
    bubbles: [{ text: 'what part of your arm do you mean by over there' }]
  })
  const spatialClarificationVerdict = verifyPostFilterAdoption(spatialClarificationInput, spatialClarificationPacket)
  check('resolve_context_spatial_question_survives_executed_size_filter',
    spatialClarificationPacket.bubbles.length === 1 &&
      /what part of your arm/i.test(String(spatialClarificationPacket.bubbles[0]?.text || '')) &&
      spatialClarificationVerdict.valid === true,
    JSON.stringify({ packet: spatialClarificationPacket, verdict: spatialClarificationVerdict }))
  const ordinaryPlacementPacket = enforceSizePlacementLock(
    { structured_state: { known_design_context: 'black and grey tiger' } },
    { bubbles: [{ text: 'what part of your arm were you thinking' }] }
  )
  check(
    'media_authority_monotonic_harness_version_exact',
    SCV_MEDIA_AUTHORITY_MONOTONIC_HARNESS_VERSION === 'scv-media-authority-monotonic-harness-2026-08-21-v4-bounded-cold-start',
    SCV_MEDIA_AUTHORITY_MONOTONIC_HARNESS_VERSION
  )
  check(
    'media_authority_monotonic_source_state_and_semantic_antirepeat_all_locked',
    mediaAuthorityMonotonic.ok === true && mediaAuthorityMonotonic.checked === 35,
    JSON.stringify(mediaAuthorityMonotonic)
  )
  check('ordinary_placement_question_remains_stripped_outside_resolve_context',
    !ordinaryPlacementPacket.bubbles.some((bubble) => /what part of your arm/i.test(String(bubble?.text || ''))),
    JSON.stringify(ordinaryPlacementPacket))
  const initialTattooInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'hey can i ask about a tattoo?',
    recent_history: [],
    structured_state: {
      live_turn_text: 'hey can i ask about a tattoo?',
      tattoo_intent_active: true,
      live_turn_is_tattoo_intent: true,
      known_design_context: '',
      known_placement_context: '',
      known_size_context: '',
      booking_stage_hint: 'design_intake'
    },
    control_transition_contract: {
      action: 'design_intake',
      reason: 'tattoo_lane_missing_design_direction',
      obligations: [],
      fields: {}
    }
  }
  const strippedInitialTattooDeadEnd = verifyPostFilterAdoption(initialTattooInput, {
    bubbles: [{ text: 'we can dial in all the exact details together in person 🖤' }]
  })
  check('post_filter_transition_gate_rejects_initial_tattoo_dead_end',
    strippedInitialTattooDeadEnd.valid === false &&
      strippedInitialTattooDeadEnd.reason === 'closed_transition_design_intake_dead_end',
    JSON.stringify(strippedInitialTattooDeadEnd))
  const initialTattooLead = verifyPostFilterAdoption(initialTattooInput, {
    bubbles: [{ text: 'yeah of course what kind of idea or reference has been on your mind?' }]
  })
  check('post_filter_transition_gate_accepts_initial_tattoo_host_lead',
    initialTattooLead.valid === true,
    JSON.stringify(initialTattooLead))
  const mediaResolvedRouteInput = {
    message: 'sent a reference post: black and grey snake upper arm wrap',
    live_message: 'sent a reference post: black and grey snake upper arm wrap',
    media_context_resolved: true,
    control_transition_contract: {
      action: 'design_intake',
      reason: 'tattoo_lane_missing_design_direction',
      obligations: [],
      fields: {}
    },
    structured_state: {
      live_turn_text: 'sent a reference post: black and grey snake upper arm wrap',
      live_turn_is_media_reference: true,
      live_turn_media_vision_used: true,
      known_design_context: 'black and grey snake upper arm wrap',
      tattoo_intent_active: true,
      live_turn_is_tattoo_intent: true
    }
  }
  const mediaResolvedRoute = reconcileControllerPlanAfterAuthorityEvidence(mediaResolvedRouteInput)
  check('authority_resolved_media_replaces_provisional_design_intake_with_form_offer',
    mediaResolvedRoute?.action === 'offer_form' &&
      mediaResolvedRouteInput.control_transition_contract?.action === 'offer_form',
    JSON.stringify(mediaResolvedRoute))
  const frozenRepairRouteInput = {
    ...mediaResolvedRouteInput,
    control_transition_repair: 'CONTROLLER CLOSED-TRANSITION REPAIR LOCK',
    control_transition_contract: {
      action: 'design_intake',
      reason: 'route_already_frozen',
      obligations: [],
      fields: {}
    }
  }
  const frozenRepairRoute = reconcileControllerPlanAfterAuthorityEvidence(frozenRepairRouteInput)
  check('authority_evidence_never_reroutes_a_frozen_controller_repair_pass',
    frozenRepairRoute?.action === 'design_intake' &&
      frozenRepairRouteInput.control_transition_contract?.action === 'design_intake',
    JSON.stringify(frozenRepairRoute))
  const coalescedFormSubmission = {
    message: '(earlier message 1 from them that you have NOT replied to yet) I just sent you the form\n(their latest message just now) Just submitted',
    live_message: 'Just submitted',
    recent_history: [{ role: 'assistant', text: PREFERRED_FORM_LINK }],
    structured_state: { form_link_sent: true }
  }
  check(
    'atomic_latest_form_submission_survives_coalesced_backlog',
    liveFormSubmittedSignal(coalescedFormSubmission) === true &&
      isExplicitFormLinkRequest('I just sent you the form') === false &&
      isExplicitFormLinkRequest('can you send me the link?') === true,
    JSON.stringify(coalescedFormSubmission)
  )
  check(
    'kando_state_authority_meeting_gate_regression_23',
    kandoRegression.ok === true
      && kandoRegression.checked === 23
      && kandoRegression.regression === 'kando_intenchanel_boatman_state_authority_meeting_gate_2026-07-10',
    JSON.stringify(kandoRegression)
  )
  check('delivery_lock_version_v6_exact', SCV_DELIVERY_PACING_LOCK_VERSION === 'scv-delivery-pacing-lock-2026-07-04-v6-first-reply-3to12min', SCV_DELIVERY_PACING_LOCK_VERSION)
  check('delivery_hard_locked_true', SCV_DELIVERY_PACING_HARD_LOCKED === true, String(SCV_DELIVERY_PACING_HARD_LOCKED))
  check('delivery_env_override_ignored', SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY === 'ignored_by_default_hard_lock', SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY)
  check('hostile_env_cannot_change_settings', JSON.stringify(settings) === JSON.stringify(EXPECTED_DELIVERY_PACING_SETTINGS), JSON.stringify(settings))
  check('initial_min_3m_exact', settings.non_fast_initial_delay_min_ms === 180000, JSON.stringify(settings))
  check('initial_max_12m_exact', settings.non_fast_initial_delay_max_ms === 720000, JSON.stringify(settings))
  check('bubble_min_1500_exact', settings.bubble_gap_min_ms === 1500, JSON.stringify(settings))
  check('bubble_max_22000_exact', settings.bubble_gap_max_ms === 22000, JSON.stringify(settings))
  check('fast_target_zero_exact', fast.delay_ms === 0 && fast.pacing_rule === 'fast_target_zero_delay', JSON.stringify(fast))
  check('first_min_exact', firstMin.delay_ms === 180000, JSON.stringify(firstMin))
  check('first_max_exact', firstMax.delay_ms >= 719995 && firstMax.delay_ms <= 720000, JSON.stringify(firstMax))
  check('first_reply_3_to_12_range', firstMin.delay_ms === 180000 && firstMax.delay_ms >= 719995 && firstMin.delay_ms < firstMax.delay_ms, `${firstMin.delay_ms}/${firstMax.delay_ms}`)
  check('micro_bucket_under_8s', micro.delay_ms < 8000 && micro.pacing_rule.endsWith(':micro_followup'), JSON.stringify(micro))
  check('short_bucket_3_to_8s', short.delay_ms >= 3000 && short.delay_ms <= 8000 && short.pacing_rule.endsWith(':short_sentence'), JSON.stringify(short))
  check('normal_bucket_after_short', normal.delay_ms > short.delay_ms && normal.delay_ms <= 13000 && normal.pacing_rule.endsWith(':normal_sentence'), JSON.stringify({ short, normal }))
  check('operational_bucket_9_to_18s', operational.delay_ms >= 9000 && operational.delay_ms <= 18000 && operational.pacing_rule.endsWith(':operational_detail'), JSON.stringify(operational))
  check('long_cap_22s', long.delay_ms <= 22000, JSON.stringify(long))
  const gateNow = Date.parse('2026-06-16T00:00:00.000Z')
  const earlyPacket = { bubble_index: 0, fast_delay_target: false, force_zero_delay: false, queued_at: new Date(gateNow).toISOString(), due_at: new Date(gateNow + 1 * 60 * 1000).toISOString() }
  const gate = evaluateInitialDelayHardGate(earlyPacket, gateNow + 2 * 60 * 1000)
  const fastGate = evaluateInitialDelayHardGate({ ...earlyPacket, fast_delay_target: true }, gateNow + 2 * 60 * 1000)
  const laterGate = evaluateInitialDelayHardGate({ ...earlyPacket, bubble_index: 1 }, gateNow + 2 * 60 * 1000)
  check('worker_nonfast_initial_delay_gate_blocks_under_3m', gate.blocked === true && gate.required_due_at_ms === gateNow + DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS, JSON.stringify(gate))
  check('worker_fast_target_bypasses_initial_delay_gate', fastGate.blocked === false && fastGate.earliest_allowed_send_at_ms === null, JSON.stringify(fastGate))
  check('worker_later_bubble_bypasses_initial_delay_gate', laterGate.blocked === false && laterGate.earliest_allowed_send_at_ms === null, JSON.stringify(laterGate))
  const postFormInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'sent a voice note saying: I just saw a mirror.',
    recent_history: [
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' }
    ],
    structured_state: {
      form_link_sent: true,
      form_offer_asked: true,
      form_submitted: true,
      live_turn_form_submitted_signal: true,
      known_name_used_on_form: 'Test',
      known_phone_used_on_form: '5551119999'
    }
  }
  const postFormStage = resolveBookingFunnelStage(postFormInput)
  const postFormMachine = buildDeterministicBookingPacket(postFormInput)
  check(
    'funnel_state_machine_post_form_availability_is_model_authored',
    postFormStage.stage === 'availability_after_form' && postFormMachine === null,
    JSON.stringify({ stage: postFormStage, packet: postFormMachine })
  )
  const weekendAvailabilityInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: "sent a voice note saying: I'm available on weekends.",
    recent_history: [
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' },
      { role: 'assistant', text: 'perfect i got the form' },
      { role: 'assistant', text: 'what dates or weekend days are easiest for you? i can check a close 2pm spot from there' }
    ],
    structured_state: {
      current_message_date_local: 'July 8, 2026',
      close_booking_options_local: ['july 15 (wednesday) at 2pm', 'july 16 (thursday) at 2pm', 'july 17 (friday) at 2pm', 'july 18 (saturday) at 2pm', 'july 19 (sunday) at 2pm'],
      form_link_sent: true,
      form_offer_asked: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      live_turn_text: "sent a voice note saying: I'm available on weekends."
    }
  }
  const weekendAvailabilityStage = resolveBookingFunnelStage(weekendAvailabilityInput)
  const weekendAvailabilityMachine = buildDeterministicBookingPacket(weekendAvailabilityInput)
  check(
    'weekend_availability_after_form_preserves_calendar_move_for_model_authorship',
    weekendAvailabilityMachine === null &&
      weekendAvailabilityStage.stage === 'weekend_availability_after_form' &&
      weekendAvailabilityStage.fields.offered_date === 'july 18' &&
      weekendAvailabilityStage.fields.offered_time === '2pm' &&
      weekendAvailabilityStage.fields.availability_label === 'weekends',
    JSON.stringify({ stage: weekendAvailabilityStage, packet: weekendAvailabilityMachine })
  )
  const sundayAvailabilityInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'sundays are easiest for me',
    recent_history: [
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' },
      { role: 'assistant', text: 'perfect i got the form' },
      { role: 'assistant', text: 'what dates or weekend days are easiest for you? i can check a close 2pm spot from there' }
    ],
    structured_state: {
      current_message_date_local: 'July 8, 2026',
      close_booking_options_local: ['july 18 (saturday) at 2pm', 'july 19 (sunday) at 2pm'],
      form_link_sent: true,
      form_offer_asked: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      live_turn_text: 'sundays are easiest for me'
    }
  }
  const sundayAvailabilityStage = resolveBookingFunnelStage(sundayAvailabilityInput)
  const sundayAvailabilityMachine = buildDeterministicBookingPacket(sundayAvailabilityInput)
  check(
    'sunday_availability_after_form_preserves_sunday_calendar_move_for_model_authorship',
    sundayAvailabilityMachine === null &&
      sundayAvailabilityStage.stage === 'weekend_availability_after_form' &&
      sundayAvailabilityStage.fields.offered_date === 'july 19' &&
      sundayAvailabilityStage.fields.offered_time === '2pm' &&
      sundayAvailabilityStage.fields.availability_label === 'sundays',
    JSON.stringify({ stage: sundayAvailabilityStage, packet: sundayAvailabilityMachine })
  )
  const canonicalLiveDoubleCheck = normalizePacket({
    bubbles: [
      { text: 'alright here’s what i have for you' },
      { text: 'name: Omar System Replay Two\nphone number: 4155550177\nappointment date: july 26\ntime: 2pm\ncan you double check this just to make sure' }
    ]
  })
  check(
    'model_double_check_is_single_canonical_block_before_receipt',
    canonicalLiveDoubleCheck?.bubbles?.length === 1 &&
      canonicalLiveDoubleCheck.bubbles[0].text === 'Name : Omar System Replay Two\nPhone Number : 4155550177\nAppointment date : 26th of July\nTime : 2pm\n\ncan you double check this just to make sure',
    JSON.stringify(canonicalLiveDoubleCheck)
  )
  const unacceptedOfferMachine = buildDeterministicBookingPacket({
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'what about another day?',
    recent_history: [
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' },
      { role: 'assistant', text: 'weekends work i have july 25 at 2pm as the closest weekend spot' },
      { role: 'assistant', text: 'does that work for you?' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Test',
      known_phone_used_on_form: '5551119999',
      last_offered_date: 'july 25',
      last_offered_time: '2pm'
    }
  })
  check('unaccepted_offer_never_becomes_fixed_double_check', unacceptedOfferMachine === null, JSON.stringify(unacceptedOfferMachine))
  const tooSoonCounterproposalMachine = buildDeterministicBookingPacket({
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'sent a voice note saying: How about 18th of July?',
    recent_history: [
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' },
      { role: 'assistant', text: 'weekends work i have july 25 at 2pm as the closest weekend spot' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Test',
      known_phone_used_on_form: '5551119999',
      last_offered_date: 'july 25',
      last_offered_time: '2pm',
      live_turn_date_phrase: '18th of July',
      live_turn_date_status: 'too_soon'
    }
  })
  check('too_soon_counterproposal_never_becomes_fixed_double_check', tooSoonCounterproposalMachine === null, JSON.stringify(tooSoonCounterproposalMachine))
  const legalCounterproposalInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'sent a voice note saying: How about 25th of July?',
    recent_history: [
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' },
      { role: 'assistant', text: 'weekends work i have july 26 at 2pm as the closest weekend spot' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Test',
      known_phone_used_on_form: '5551119999',
      last_offered_date: 'july 26',
      last_offered_time: '2pm',
      preferred_time_primary: '2pm',
      minimum_booking_date_local: 'July 19, 2026',
      live_turn_date_phrase: '25th of July',
      live_turn_date_status: 'legal'
    }
  }
  const legalCounterproposalStage = resolveBookingFunnelStage(legalCounterproposalInput)
  const legalCounterproposalMachine = buildDeterministicBookingPacket(legalCounterproposalInput)
  check(
    'legal_date_only_counterproposal_preserves_time_question_for_model_authorship',
    legalCounterproposalMachine === null &&
      legalCounterproposalStage.stage === 'time_after_form' &&
      legalCounterproposalStage.fields.date === '25th of July' &&
      !legalCounterproposalStage.fields.time,
    JSON.stringify({ stage: legalCounterproposalStage, packet: legalCounterproposalMachine })
  )
  const explicitTimeAcceptanceMachine = buildDeterministicBookingPacket({
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: '2pm works for me',
    recent_history: [
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' },
      { role: 'user', text: 'How about 25th of July?' },
      { role: 'assistant', text: 'July 25 works on my side. would 2pm work for you?' }
    ],
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Test',
      known_phone_used_on_form: '5551119999',
      known_requested_date: 'july 25',
      last_offered_date: 'july 25',
      last_offered_time: '2pm',
      preferred_time_primary: '2pm',
      minimum_booking_date_local: 'July 19, 2026',
      live_turn_accepts_offered_slot: true,
      live_turn_accepted_offered_date: 'july 25',
      live_turn_accepted_offered_time: '2pm'
    }
  })
  const explicitTimeAcceptanceText = String(explicitTimeAcceptanceMachine?.packet?.bubbles?.[0]?.text || '')
  check(
    'explicit_time_acceptance_unlocks_exact_four_field_double_check',
    explicitTimeAcceptanceMachine?.authority?.route_lock === 'ready_booking_identity_fixed_double_check' &&
      /Appointment date\s*:\s*25th of July/i.test(explicitTimeAcceptanceText) &&
      /Name\s*:\s*Test/i.test(explicitTimeAcceptanceText) &&
      /Phone Number\s*:\s*5551119999/i.test(explicitTimeAcceptanceText) &&
      /Time\s*:\s*2pm/i.test(explicitTimeAcceptanceText),
    JSON.stringify(explicitTimeAcceptanceMachine)
  )
  const cloudStartSource = fs.readFileSync(path.join(__dirname, 'cloud-start.js'), 'utf8')
  check(
    'destructive_debug_reset_requires_explicit_opt_in_and_pause_all_barrier',
    cloudStartSource.includes("SCV_PURGE_TEST_ACCOUNT_ON_STARTUP || '0'") &&
      cloudStartSource.includes('purgeTestAccountRequested && destructiveDebugResetBarrierActive') &&
      cloudStartSource.includes('pauseAll(process.env)') &&
      cloudStartSource.includes('pause_all_required_for_destructive_debug_reset') &&
      cloudStartSource.includes('purge_requested: purgeTestAccountRequested') &&
      cloudStartSource.includes('pause_all: destructiveDebugResetBarrierActive') &&
      cloudStartSource.includes('scv_test_account_chat_purge_skipped'),
    'cloud-start.js'
  )
  const inboundSource = fs.readFileSync(path.join(__dirname, 'inbound-scv.js'), 'utf8')
  check(
    'direct_manychat_retry_before_debug_reset_is_dropped_before_state_mutation',
    inboundSource.includes('debugResetBoundaryVerdict(ROOT, packet)') &&
      inboundSource.includes('manychat_latest_interaction_at: latestInteractionAtRaw') &&
      inboundSource.includes('===INBOUND_DEBUG_RESET_STALE_DROP===') &&
      inboundSource.indexOf('debugResetBoundaryVerdict(ROOT, packet)') < inboundSource.indexOf('const duplicateInbound = getDuplicateInboundVerdict(packet)'),
    'inbound-scv.js'
  )
  const acceptedSlotInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'oh yeah perfect actually',
    recent_history: [
      { role: 'assistant', text: 'july 18 at 2pm works on my side' },
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' }
    ],
    structured_state: {
      form_link_sent: true,
      form_offer_asked: true,
      form_submitted: false,
      accepted_offered_date: 'july 18',
      accepted_offered_time: '2pm',
      live_turn_accepts_offered_slot: true
    }
  }
  const acceptedSlotStage = resolveBookingFunnelStage(acceptedSlotInput)
  const acceptedSlotMachine = buildDeterministicBookingPacket(acceptedSlotInput)
  check(
    'funnel_state_machine_accepted_slot_form_identity_is_model_authored',
    acceptedSlotMachine === null &&
      acceptedSlotStage.stage === 'accepted_slot_needs_form' &&
      acceptedSlotStage.fields.date === 'july 18' &&
      acceptedSlotStage.fields.time === '2pm',
    JSON.stringify({ stage: acceptedSlotStage, packet: acceptedSlotMachine })
  )
  const saturdayDateMachine = buildDeterministicBookingPacket({
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'sent a voice note saying: Oh yeah, that is perfect.',
    recent_history: [
      { role: 'assistant', text: 'saturday at 2pm works on my side' }
    ],
    structured_state: {
      current_message_date_local: 'July 8, 2026',
      minimum_booking_date_local: 'July 15, 2026',
      close_booking_options_local: ['july 15 (wednesday) at 2pm', 'july 16 (thursday) at 2pm', 'july 17 (friday) at 2pm', 'july 18 (saturday) at 2pm', 'july 19 (sunday) at 2pm'],
      form_link_sent: true,
      form_offer_asked: true,
      form_submitted: true,
      known_name_used_on_form: 'Test codex3',
      known_phone_used_on_form: '1231234',
      known_requested_date: 'saturday',
      known_requested_time: '2pm',
      last_offered_date: 'saturday',
      last_offered_time: '2pm',
      accepted_offered_date: 'saturday',
      accepted_offered_time: '2pm',
      live_turn_accepts_offered_slot: true,
      live_turn_accepted_offered_date: 'saturday',
      live_turn_accepted_offered_time: '2pm',
      live_turn_booking_match_signal: true
    }
  })
  const saturdayDateText = String(saturdayDateMachine?.packet?.bubbles?.[0]?.text || '')
  check('weekday_only_saturday_resolves_to_exact_18th_of_july_double_check', /Appointment date\s*:\s*18th of July/i.test(saturdayDateText) && !/Appointment date\s*:\s*saturday\b/i.test(saturdayDateText), saturdayDateText)
  const mediaPostStripInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'sent a reference post: This is a black-and-white selfie/person photo of an individual wearing large ski goggles and a leather jacket.',
    control_transition_contract: { action: 'offer_form', reason: 'design_direction_ready_for_form_offer', obligations: [], fields: {} },
    structured_state: {
      form_link_sent: false,
      form_offer_asked: false,
      form_submitted: false,
      live_turn_is_media_reference: true,
      live_turn_has_unanswered_backlog: true,
      pending_unanswered_user_messages: ['sent a voice note saying: I want something like this.'],
      live_turn_text: '(earlier message 1 from them that you have NOT replied to yet) sent a voice note saying: I want something like this.\n(their latest message just now) sent a reference post: This is a black-and-white selfie/person photo of an individual wearing large ski goggles and a leather jacket.'
    }
  }
  const mediaPostStripPacket = {
    bubbles: [
      { text: 'this vibe’s got a cool edge to it for sure' },
      { text: 'would you want it somewhere specific or more open to ideas on placement?' }
    ]
  }
  const mediaPostStripAfterSize = enforceSizePlacementLock(mediaPostStripInput, JSON.parse(JSON.stringify(mediaPostStripPacket)))
  const mediaPostStripAfterFunnel = enforceFunnelOrderLock(mediaPostStripInput, mediaPostStripAfterSize)
  const mediaPostStripAfterLocks = applyDeterministicPacketLocks(mediaPostStripInput, JSON.parse(JSON.stringify(mediaPostStripAfterFunnel)))
  const mediaPostStripVerdict = verifyPostFilterAdoption(mediaPostStripInput, mediaPostStripAfterLocks)
  check('media_reference_post_strip_dead_end_requires_model_reauthor', mediaPostStripVerdict.valid === false && !mediaPostStripAfterLocks.bubbles.some((bubble) => /form|application|apply/i.test(String(bubble.text || ''))), JSON.stringify({ verdict: mediaPostStripVerdict, bubbles: mediaPostStripAfterLocks.bubbles }))
  const blackGrayFollowupInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: "sent a voice note saying: I don't know, um, you can just play with it. Do you do black and gray?",
    control_transition_contract: { action: 'offer_form', reason: 'design_direction_ready_for_form_offer', obligations: [], fields: {} },
    structured_state: {
      form_link_sent: false,
      form_offer_asked: false,
      form_submitted: false,
      known_reference_media_received: true,
      live_turn_is_media_reference: false,
      live_turn_gave_design_idea: true,
      live_turn_text: "sent a voice note saying: I don't know, um, you can just play with it. Do you do black and gray?"
    }
  }
  const blackGrayFollowupPacket = {
    bubbles: [
      { text: 'black and gray works really well for that vibe' },
      { text: 'were you thinking about where you want it on your body?' }
    ]
  }
  const blackGrayAfterSize = enforceSizePlacementLock(blackGrayFollowupInput, JSON.parse(JSON.stringify(blackGrayFollowupPacket)))
  const blackGrayAfterFunnel = enforceFunnelOrderLock(blackGrayFollowupInput, blackGrayAfterSize)
  const blackGrayAfterLocks = applyDeterministicPacketLocks(blackGrayFollowupInput, JSON.parse(JSON.stringify(blackGrayAfterFunnel)))
  const blackGrayAfterVerdict = verifyPostFilterAdoption(blackGrayFollowupInput, blackGrayAfterLocks)
  check('black_gray_design_followup_dead_end_requires_model_reauthor', blackGrayAfterVerdict.valid === false && !blackGrayAfterLocks.bubbles.some((bubble) => /form|application|apply/i.test(String(bubble.text || ''))), JSON.stringify({ verdict: blackGrayAfterVerdict, bubbles: blackGrayAfterLocks.bubbles }))
  const styleComplimentInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'sent a voice note saying: Okay, I love your style.',
    control_transition_contract: { action: 'design_intake', reason: 'portfolio_compliment_requires_design_lead_not_form_offer', obligations: [], fields: {} },
    recent_history: [
      { role: 'assistant', text: 'hey yeah for sure you can check my profile and the flashes in the highlights for inspo those are more like references though and custom ideas are totally cool too' }
    ],
    structured_state: {
      form_link_sent: false,
      form_offer_asked: false,
      form_submitted: false,
      known_design_context: '',
      known_placement_context: '',
      known_size_context: '',
      booking_stage_hint: 'open_conversation',
      live_turn_text: 'sent a voice note saying: Okay, I love your style.'
    }
  }
  const styleComplimentAfterLocks = applyDeterministicPacketLocks(styleComplimentInput, { bubbles: [{ text: 'thank you so much that means a lot to me' }] })
  const styleComplimentVerdict = verifyPostFilterAdoption(styleComplimentInput, styleComplimentAfterLocks)
  check(
    'style_compliment_dead_end_requires_model_reauthor_not_fixed_copy',
    styleComplimentVerdict.valid === false && styleComplimentAfterLocks.bubbles.length === 1,
    JSON.stringify({ verdict: styleComplimentVerdict, bubbles: styleComplimentAfterLocks.bubbles })
  )
  const nonConsentSizeInput = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'roughly 8 inches or so',
    recent_history: [
      { role: 'assistant', text: 'want me to send the form so we can confirm a day?' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'black and grey snake',
      known_placement_context: 'arm',
      form_offer_asked: true,
      form_link_sent: false,
      booking_stage_hint: 'awaiting_form_permission_answer'
    }
  }
  const nonConsentSizePacket = enforceFormConsentSourceLock(nonConsentSizeInput, {
    bubbles: [
      { text: 'yeah around 8 inches can work and we can adjust the exact size in person' },
      { text: PREFERRED_FORM_LINK }
    ]
  })
  check(
    'nonconsent_size_cannot_retain_form_link',
    formLinkAuthorizedThisTurn(nonConsentSizeInput) === false &&
      !nonConsentSizePacket.bubbles.some((bubble) => String(bubble.text || '').includes(PREFERRED_FORM_LINK)) &&
      verifyPostFilterAdoption(nonConsentSizeInput, nonConsentSizePacket).reason === 'form_link_missing_consent_source',
    JSON.stringify(nonConsentSizePacket.bubbles)
  )
  const liveAcceptedUnverifiedOfferRace = {
    message: 'Yes, please how much is it by the way?',
    live_message: 'Yes, please how much is it by the way?',
    recent_history: [{ role: 'assistant', text: 'Yeah I can work from this as a custom piece in my own style' }],
    structured_state: {
      form_offer_asked: true,
      form_link_sent: false,
      live_turn_pricing_question: true,
      booking_stage_hint: 'awaiting_form_permission_answer'
    }
  }
  check(
    'accepted_unverified_form_offer_boundary_race_uses_durable_controller_state',
    recentAskedFormPermission(liveAcceptedUnverifiedOfferRace) === false &&
      liveFormConsentGranted(liveAcceptedUnverifiedOfferRace) === true &&
      formLinkAuthorizedThisTurn(liveAcceptedUnverifiedOfferRace) === true,
    JSON.stringify(liveAcceptedUnverifiedOfferRace)
  )
  const controllerOwnedSendForm = {
    message: 'sure thing',
    recent_history: [],
    structured_state: { form_link_sent: false },
    control_transition_contract: {
      action: 'send_form',
      reason: 'accepted_slot_requires_form_link'
    }
  }
  check(
    'locked_controller_send_form_cannot_be_denied_by_runner_history_gap',
    controllerRequiresFormDelivery(controllerOwnedSendForm) === true &&
      formLinkAuthorizedThisTurn(controllerOwnedSendForm) === true
  )
  const controllerMetadataPacket = {
    reply_text: 'same visible reply',
    acknowledged_fields: [],
    questioned_fields: [],
    next_action_reflected: 'general_continue',
    bubbles: [{ text: 'same visible reply' }]
  }
  const controllerMetadataVisibleBefore = JSON.stringify(controllerMetadataPacket.bubbles)
  bindControllerOwnedPacketMetadata(controllerOwnedSendForm, controllerMetadataPacket)
  check(
    'controller_owns_invisible_next_action_metadata',
    controllerMetadataPacket.next_action_reflected === 'send_form'
  )
  check(
    'controller_metadata_binding_never_rewrites_visible_copy',
    JSON.stringify(controllerMetadataPacket.bubbles) === controllerMetadataVisibleBefore
  )
  check(
    'visual_language_is_valid_pricing_condition_semantics',
    packetHasLockedPricingAnswer({
      bubbles: [{ text: 'Yep the discounted model rate is $150 an hour when the finished piece stays in my visual language' }]
    }) === true
  )
  const mixedConsentPriceRepair = enforcePendingFormLinkFulfillment({
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: 'sent a voice note saying: Oh yeah, yes please. How much is it though?',
    recent_history: [{ role: 'assistant', text: 'want me to send the form so we can confirm a time?' }],
    structured_state: {
      form_offer_asked: true,
      form_link_sent: false,
      known_reference_media_received: true,
      live_turn_pricing_question: true,
      live_turn_text: 'sent a voice note saying: Oh yeah, yes please. How much is it though?',
      booking_stage_hint: 'awaiting_form_permission_answer'
    }
  }, {
    bubbles: [
      { text: 'right on glad you want the form' },
      { text: 'the discounted model rate is 150 per hour as long as it’s in my style' },
      { text: 'do you have a day around july 15 to 19 in mind for the appointment?' }
    ]
  })
  check(
    'pending_form_mixed_consent_price_rejects_without_deterministic_authorship',
    !String((mixedConsentPriceRepair?.bubbles || []).map((bubble) => bubble.text || '').join('\n')).includes('https://www.effacermonexistence.com/apply') &&
      mixedConsentPriceRepair?.non_authoring_surface_mutations?.includes('pending_form_link_missing') &&
      mixedConsentPriceRepair?.non_authoring_surface_mutations?.includes('pending_form_availability_tail_missing') &&
      verifyPostFilterAdoption({}, mixedConsentPriceRepair).reason === 'non_authoring_guard_requires_model_reauthor',
    JSON.stringify(mixedConsentPriceRepair)
  )
  const weekendBeforeLinkRepair = enforcePendingFormLinkFulfillment({
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: "sent a voice note saying: I'm available on weekends.",
    recent_history: [
      { role: 'assistant', text: 'want me to send the form so we can confirm a time?' },
      { role: 'assistant', text: 'do you have a day around july 15 to 19 in mind for the appointment?' }
    ],
    structured_state: {
      form_offer_asked: true,
      form_link_sent: false,
      known_reference_media_received: true,
      live_turn_text: "sent a voice note saying: I'm available on weekends.",
      booking_stage_hint: 'awaiting_form_permission_answer'
    }
  }, {
    bubbles: [
      { text: 'weekends could be good for sure' },
      { text: 'do you have a rough idea what you want yet or just feeling it out?' }
    ]
  })
  check(
    'pending_form_weekend_availability_rejects_without_deterministic_authorship',
    !String((weekendBeforeLinkRepair?.bubbles || []).map((bubble) => bubble.text || '').join('\n')).includes('https://www.effacermonexistence.com/apply') &&
      weekendBeforeLinkRepair?.non_authoring_surface_mutations?.includes('pending_form_link_missing') &&
      weekendBeforeLinkRepair?.non_authoring_surface_mutations?.includes('pending_form_design_backtrack') &&
      verifyPostFilterAdoption({}, weekendBeforeLinkRepair).reason === 'non_authoring_guard_requires_model_reauthor',
    JSON.stringify(weekendBeforeLinkRepair)
  )
  const relationshipStyleLock = fs.existsSync(path.join(__dirname, 'lua-dm-relationship-style-lock.txt')) ? fs.readFileSync(path.join(__dirname, 'lua-dm-relationship-style-lock.txt'), 'utf8') : ''
  const benInstagramBehavioralStyleLock = fs.existsSync(path.join(__dirname, 'lua-dm-ben-instagram-behavioral-style-lock-v2.txt')) ? fs.readFileSync(path.join(__dirname, 'lua-dm-ben-instagram-behavioral-style-lock-v2.txt'), 'utf8') : ''
  const humanWordChoiceLock = fs.existsSync(path.join(__dirname, 'lua-dm-human-word-choice-lock-v1.txt')) ? fs.readFileSync(path.join(__dirname, 'lua-dm-human-word-choice-lock-v1.txt'), 'utf8') : ''
  const convergenceHierarchyLock = fs.existsSync(path.join(__dirname, 'lua-dm-convergence-hierarchy-lock.txt')) ? fs.readFileSync(path.join(__dirname, 'lua-dm-convergence-hierarchy-lock.txt'), 'utf8') : ''
  check('relationship_style_lock_present', relationshipStyleLock.includes('LUA RELATIONSHIP STYLE LOCK v1') && relationshipStyleLock.includes('Forbidden flat shapes'), relationshipStyleLock.slice(0, 120))
  check(
    'ben_instagram_behavioral_style_lock_present',
    benInstagramBehavioralStyleLock.includes('LUA BEN INSTAGRAM BEHAVIORAL STYLE AUTHORITY v2') &&
      benInstagramBehavioralStyleLock.includes('9c16de2f979eaf0d698f027903f32151bdb0db13577f64a3574f73b88b30ad68') &&
      benInstagramBehavioralStyleLock.includes('The model authors every non-fixed visible sentence fresh') &&
      benInstagramBehavioralStyleLock.includes('leave exactly one useful next movement') &&
      benInstagramBehavioralStyleLock.includes('ARCHIVE-GROUNDED FIRST INFO REPLY') &&
      benInstagramBehavioralStyleLock.includes('Do not force any exact historical line'),
    benInstagramBehavioralStyleLock.slice(0, 180)
  )
  check(
    'ben_instagram_behavioral_style_lock_in_visible_system_authority',
    buildVisibleReplySystemPrompt().includes(benInstagramBehavioralStyleLock.trim()),
    String(buildVisibleReplySystemPrompt().indexOf(benInstagramBehavioralStyleLock.trim()))
  )
  check(
    'human_word_choice_lock_present_and_private',
    humanWordChoiceLock.includes('LUA HUMAN WORD CHOICE LOCK v1') &&
      humanWordChoiceLock.includes('private owner-provided writing reference') &&
      !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(humanWordChoiceLock),
    humanWordChoiceLock.slice(0, 180)
  )
  check(
    'human_word_choice_lock_in_visible_system_authority',
    buildVisibleReplySystemPrompt().includes(humanWordChoiceLock.trim()),
    String(buildVisibleReplySystemPrompt().indexOf(humanWordChoiceLock.trim()))
  )
  check(
    'human_word_choice_gate_rejects_build_surface',
    humanWordChoiceHit('we can build something around that')?.label === 'consultant verb build' &&
      detectGenericAiTone({ bubbles: [{ text: 'we can build something around that' }] }, {})?.label === 'consultant verb build'
  )
  check(
    'human_word_choice_gate_accepts_plain_dm_surface',
    humanWordChoiceHit('yeah i can make my own version of that') === null &&
      detectGenericAiTone({ bubbles: [{ text: 'yeah i can make my own version of that' }] }, {}) === null
  )
  check(
    'human_word_choice_harness_locked',
    humanWordChoice.ok === true && humanWordChoice.checked === 25 &&
      humanWordChoice.lock_version === SCV_HUMAN_WORD_CHOICE_LOCK_VERSION &&
      humanWordChoice.version === SCV_HUMAN_WORD_CHOICE_HARNESS_VERSION,
    JSON.stringify(humanWordChoice)
  )
  check(
    'fresh_info_opener_rejects_observed_polished_ai_surface',
    detectGenericAiTone(
      { bubbles: [{ text: 'Hi yeah absolutely I only open a few model spots at a time' }] },
      { message: 'Hi can I please get some information?', recent_history: [], structured_state: {} }
    )?.label === 'polished info opener instead of archive micro greeting'
  )
  check(
    'convergence_hierarchy_lock_present',
    convergenceHierarchyLock.includes('LUA CONVERGENCE HIERARCHY LOCK v2') &&
      convergenceHierarchyLock.includes('form offer -> exact form URL after consent') &&
      convergenceHierarchyLock.includes('Do not convert this sequence into reusable client-visible sentences'),
    convergenceHierarchyLock.slice(0, 180)
  )

  if (failures.length) {
    const err = new Error(`scv_hard_harness_lock_failed:${JSON.stringify(failures)}`)
    err.failures = failures
    throw err
  }

  return {
    ok: true,
    locked: true,
    lock_version: SCV_HARD_HARNESS_LOCK_VERSION,
    checked,
    contract_lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION,
    closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
    closed_transition_harness_version: SCV_CLOSED_TRANSITION_HARNESS_VERSION,
    booking_policy_version: SCV_BOOKING_POLICY_VERSION,
    booking_policy_fingerprint: BOOKING_POLICY_FINGERPRINT,
    booking_policy_harness_version: SCV_BOOKING_POLICY_HARNESS_VERSION,
    booking_speech_act_history_harness_version: SCV_BOOKING_SPEECH_ACT_HISTORY_HARNESS_VERSION,
    context_grounding_harness_version: SCV_CONTEXT_GROUNDING_HARNESS_VERSION,
    human_word_choice_lock_version: SCV_HUMAN_WORD_CHOICE_LOCK_VERSION,
    human_word_choice_harness_version: SCV_HUMAN_WORD_CHOICE_HARNESS_VERSION,
    closed_lifecycle_harness_version: SCV_CLOSED_LIFECYCLE_HARNESS_VERSION,
    reference_attachment_coalescing_harness_version: SCV_REFERENCE_ATTACHMENT_COALESCING_HARNESS_VERSION,
    discourse_continuity_harness_version: SCV_DISCOURSE_CONTINUITY_HARNESS_VERSION,
    api_prompt_authority_harness_version: SCV_API_PROMPT_AUTHORITY_HARNESS_VERSION,
    media_authority_monotonic_harness_version: SCV_MEDIA_AUTHORITY_MONOTONIC_HARNESS_VERSION,
    delivery_pacing_lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
    outbox_order_lock_version: outboxOrder.lock_version,
    settings
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvHardHarnessLock(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), failures: err.failures || [] }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  SCV_HARD_HARNESS_LOCK_VERSION,
  runScvHardHarnessLock
}
