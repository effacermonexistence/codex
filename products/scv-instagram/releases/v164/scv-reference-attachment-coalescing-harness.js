#!/usr/bin/env node
const path = require('path')

const {
  SCV_REFERENCE_ATTACHMENT_COALESCING_VERSION,
  SCV_REFERENCE_ATTACHMENT_GRACE_REASON,
  SCV_REFERENCE_ATTACHMENT_GRACE_MS,
  SCV_REFERENCE_ATTACHMENT_GRACE_MAX_MS,
  liveTurnHasUnresolvedReferencePointer,
  referenceAttachmentGraceMs,
  buildReferenceAttachmentGraceFlags,
  referenceAttachmentGraceForBubble
} = require(path.join(__dirname, 'scv-reference-attachment-coalescing.js'))
const {
  ACTIONS,
  deriveClosedTransitionPlan,
  evaluateClosedTransitionContract,
  buildClosedTransitionRepairLock
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const {
  annotateStructuredStateForLiveTurn
} = require(path.join(__dirname, 'dm-authority.js'))

const SCV_REFERENCE_ATTACHMENT_COALESCING_HARNESS_VERSION =
  'scv-reference-attachment-coalescing-harness-2026-07-19-v4-no-false-understanding-prefix'

function runScvReferenceAttachmentCoalescingHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  const openState = {
    tattoo_intent_active: true,
    live_turn_is_voice_note: true,
    live_turn_is_media_reference: false,
    known_reference_media_received: false,
    booking_stage_hint: 'design_intake'
  }
  const liveText = "sent a voice note saying: I'm thinking of this one."

  check('coalescing_version_exact',
    SCV_REFERENCE_ATTACHMENT_COALESCING_VERSION === 'scv-reference-attachment-coalescing-2026-07-18-v3-inductive-discourse-context',
    SCV_REFERENCE_ATTACHMENT_COALESCING_VERSION)
  check('voice_pointer_detected', liveTurnHasUnresolvedReferencePointer(liveText, openState) === true, liveText)
  check('plain_text_pointer_detected', liveTurnHasUnresolvedReferencePointer('can we do something like this?', openState) === true)
  check('bare_pointer_detected', liveTurnHasUnresolvedReferencePointer('this one', openState) === true)
  check('calendar_this_not_misclassified', liveTurnHasUnresolvedReferencePointer('this Saturday works for me', openState) === false)
  check('ordinary_pronoun_not_misclassified', liveTurnHasUnresolvedReferencePointer('this is perfect', openState) === false)
  check('current_media_resolves_pointer', liveTurnHasUnresolvedReferencePointer(liveText, { ...openState, live_turn_is_media_reference: true }) === false)
  const authoritativeReferenceHistory = [
    { role: 'user', text: 'sent a reference post: visible black and grey snake artwork', text_source: 'authority_media_context_enriched' }
  ]
  check('durable_flag_without_recent_referent_cannot_guess_object',
    liveTurnHasUnresolvedReferencePointer(liveText, { ...openState, known_reference_media_received: true }) === true)
  check('recent_authoritative_reference_resolves_pointer',
    liveTurnHasUnresolvedReferencePointer(liveText, openState, authoritativeReferenceHistory) === false)
  check('transactional_form_consent_keeps_form_route', liveTurnHasUnresolvedReferencePointer('yes please, this one', { ...openState, live_turn_form_consent: true }) === false)

  const authorityAnnotatedState = annotateStructuredStateForLiveTurn(
    { text: liveText, instagram_username: 'omar.system' },
    openState
  )
  check('authority_annotation_sets_unresolved_pointer_flag',
    authorityAnnotatedState.live_turn_reference_pointer_without_media === true,
    JSON.stringify(authorityAnnotatedState))
  const authorityResolvedState = annotateStructuredStateForLiveTurn(
    { text: 'sent a reference post: visible snake artwork', instagram_username: 'omar.system' },
    { ...openState, live_turn_is_media_reference: true, known_reference_media_received: true }
  )
  check('authority_annotation_clears_pointer_after_media_resolution',
    authorityResolvedState.live_turn_reference_pointer_without_media === false,
    JSON.stringify(authorityResolvedState))

  const input = {
    contact_id: '1537753982',
    thread_id: '1537753982',
    instagram_username: 'omar.system',
    message: liveText,
    recent_history: [],
    structured_state: {
      ...openState,
      live_turn_text: liveText,
      live_turn_reference_pointer_without_media: true
    }
  }
  const plan = deriveClosedTransitionPlan(input)
  check('unresolved_pointer_owns_general_context_route', plan.action === ACTIONS.RESOLVE_CONTEXT, JSON.stringify(plan))
  check('unresolved_pointer_route_reason_exact', plan.reason === 'missing_attachment', JSON.stringify(plan))

  const wrongAssumption = evaluateClosedTransitionContract(input, {
    bubbles: [{ text: 'alrighty what about this one clicked for you?' }]
  }, plan)
  check('observed_bad_reply_rejected',
    wrongAssumption.valid === false && wrongAssumption.reason === 'closed_transition_missing_attachment_request_required',
    JSON.stringify(wrongAssumption))

  const mixedAssumption = evaluateClosedTransitionContract(input, {
    bubbles: [{ text: 'what part of it clicked for you? send me the photo too' }]
  }, plan)
  check('mixed_request_cannot_keep_unseen_content_probe',
    mixedAssumption.valid === false && mixedAssumption.reason === 'closed_transition_missing_attachment_assumption_forbidden',
    JSON.stringify(mixedAssumption))

  const runtimeObservedUnseenEvaluation = evaluateClosedTransitionContract(input, {
    bubbles: [
      { text: 'ohhh gotcha that direction feels good' },
      { text: 'do you wanna send the actual pic or reference here so i can see it properly?' }
    ]
  }, plan)
  check('runtime_observed_unseen_direction_evaluation_rejected',
    runtimeObservedUnseenEvaluation.valid === false && runtimeObservedUnseenEvaluation.reason === 'closed_transition_missing_attachment_assumption_forbidden',
    JSON.stringify(runtimeObservedUnseenEvaluation))

  const prematureForm = evaluateClosedTransitionContract(input, {
    bubbles: [{ text: 'want me to send the application form?' }]
  }, plan)
  check('unresolved_pointer_cannot_offer_form', prematureForm.valid === false, JSON.stringify(prematureForm))

  const correctRequest = evaluateClosedTransitionContract(input, {
    bubbles: [{ text: 'send me the pic when you get a sec, i wanna see which one you mean' }]
  }, plan)
  check('model_authored_reference_request_adopted', correctRequest.valid === true, JSON.stringify(correctRequest))

  const repairLock = buildClosedTransitionRepairLock(plan, wrongAssumption)
  check('repair_lock_requires_real_media_without_fixed_visible_script',
    repairLock.includes('media that is not present in authoritative current or recent context') &&
      repairLock.includes('do not claim understanding or evaluate its contents') &&
      repairLock.includes('later question cannot repair an earlier claim') &&
      repairLock.includes('general missing-context route') &&
      repairLock.includes('Do not advance tattoo, form, date, double-check, or deposit state') &&
      !repairLock.includes('send me the pic when you get a sec'),
    repairLock)

  const flags = buildReferenceAttachmentGraceFlags()
  check('grace_reason_exact', flags.reference_attachment_grace_reason === SCV_REFERENCE_ATTACHMENT_GRACE_REASON, JSON.stringify(flags))
  check('grace_duration_exact', referenceAttachmentGraceMs(flags) === SCV_REFERENCE_ATTACHMENT_GRACE_MS && SCV_REFERENCE_ATTACHMENT_GRACE_MS === 12000, JSON.stringify(flags))
  check('grace_applies_only_before_first_bubble',
    referenceAttachmentGraceForBubble(flags, 0) === 12000 && referenceAttachmentGraceForBubble(flags, 1) === 0,
    JSON.stringify(flags))
  check('unauthorized_reason_cannot_create_grace', referenceAttachmentGraceMs({ reference_attachment_grace_ms: 12000, reference_attachment_grace_reason: 'model_requested_delay' }) === 0)
  check('grace_is_bounded', referenceAttachmentGraceMs({ ...flags, reference_attachment_grace_ms: 999999 }) === SCV_REFERENCE_ATTACHMENT_GRACE_MAX_MS)

  const observedImageArrivalMs = 7188
  check('observed_split_image_arrives_inside_grace', observedImageArrivalMs < referenceAttachmentGraceMs(flags), `${observedImageArrivalMs}:${referenceAttachmentGraceMs(flags)}`)
  check('missing_image_still_has_bounded_fallback', referenceAttachmentGraceMs(flags) > 0 && referenceAttachmentGraceMs(flags) <= 20000)

  if (failures.length) {
    const err = new Error(`scv_reference_attachment_coalescing_harness_failed:${JSON.stringify(failures)}`)
    err.failures = failures
    throw err
  }

  return {
    ok: true,
    locked: true,
    lock_version: SCV_REFERENCE_ATTACHMENT_COALESCING_HARNESS_VERSION,
    coalescing_version: SCV_REFERENCE_ATTACHMENT_COALESCING_VERSION,
    checked
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvReferenceAttachmentCoalescingHarness(), null, 2))
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
  SCV_REFERENCE_ATTACHMENT_COALESCING_HARNESS_VERSION,
  runScvReferenceAttachmentCoalescingHarness
}
