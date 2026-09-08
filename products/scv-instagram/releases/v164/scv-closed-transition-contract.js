#!/usr/bin/env node
// ============================================================
// SCV CLOSED TRANSITION CONTRACT
//
// This is the finite controller-level contract above model wording. It does not
// author visible copy. It decides which semantic move owns the live turn, verifies
// that the adopted packet performs that move, and produces a bounded repair lock
// when a model candidate misses it.
// ============================================================
const path = require('path')
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))

const {
  PREFERRED_FORM_LINK,
  EXACT_ADDRESS,
  packetHasVisibleReply,
  asksStudioLocation,
  liveExplicitFormLinkRequest,
  liveAsksPricingOrPolicy,
  packetHasLockedPricingAnswer,
  packetUsesPricingSalesFiller,
  packetLeaksPricingPolicyProse,
  liveAsksArtistStyleScope,
  packetAnswersArtistStyleScope,
  liveAsksTattooCapabilityScope,
  packetAnswersTattooCapabilityScope,
  modelRateAlreadyDisclosed,
  packetStatesModelRate,
  packetAcknowledgesRateWithoutNumber,
  modelRateMentionCount,
  liveInfoAskOpener,
  hasDesignContext,
  storedDesignContextIsDesign,
  hasTattooIntentSignal,
  liveArtistBiographyQuestion,
  liveRequestsSeparateInPersonConsultation,
  packetCommitsSeparateInPersonConsultation,
  packetKeepsTattooConsultationInDm,
  liveIsPlainSocial,
  liveNoisyCanAskQuestion,
  liveStandaloneEmojiText,
  livePortfolioStyleComplimentOnly,
  liveHasConcreteDesignDirection,
  clientAnchoredInspirationReference,
  assistantHistoryHasFormOffer,
  knownTattooReferenceMediaReceived,
  liveTurnHasTattooReferenceEvidence,
  liveTurnUsesNonTattooMediaContext,
  shouldSendFormNow,
  pendingUnansweredUserTurnTexts,
  priorExplicitFormConsentStillUnfulfilled,
  packetPushesTattooSubflow,
  packetSolicitsClientTattoo,
  packetAnswersArtistBiography,
  packetTriesScheduling,
  liveExpressesBudgetObjection,
  liveStatesBudgetAmount,
  liveTurnNamesCalendarDay,
  packetAsksBudget,
  packetFramesLimitedAvailability,
  packetPushesBookingSlot,
  packetOffersDiscountOrDeal,
  packetAcknowledgesBudgetFit,
  packetSendsPreferredFormLink,
  packetAsksFormPermission,
  liveFormSubmittedSignal,
  packetMovesPastSubmittedForm,
  packetHasNamePhoneDateTimeDoubleCheck,
  assistantSentNamePhoneDateTimeDoubleCheck,
  structuredStateHasAllDoubleCheckFields,
  doubleCheckConfirmationContext,
  packetRequestsSecondDoubleCheckConfirmation,
  packetSendsDepositDetails,
  packetReopensDateLoopAfterDoubleCheck,
  liveAcceptsOfferedBookingSlot,
  packetBacktracksAfterAcceptedSlot,
  packetMovesToFormIdentityAfterAcceptedSlot,
  packetHasHostLeadMotion,
  packetClarifiesBookingDateOrSizeConflict
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  requestedReferenceFulfillmentChain
} = require(path.join(__dirname, 'scv-discourse-continuity.js'))
const {
  sanitizeBookingIdentityName,
  sanitizeStoredIdentityName
} = require(path.join(__dirname, 'scv-booking-identity.js'))
const {
  SCV_BOOKING_POLICY_VERSION,
  BOOKING_POLICY_FINGERPRINT,
  calendarBookingProposalFrame,
  classifyBookingDateText,
  isoToParts,
  formatDateShort,
  buildCloseBookingOptions,
  bookingDayConstraintPreference,
  selectCloseBookingOptionForDayConstraint
} = require(path.join(__dirname, 'scv-booking-policy.js'))
const {
  immutableIngressTimeMs
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))

const SCV_CLOSED_TRANSITION_CONTRACT_VERSION = 'scv-closed-transition-contract-2026-09-08-v86-artist-biography-is-not-client-intent'
// v155 (live 2026-09-06 04:26Z, Omar.system): "Do you also do black and gray and or line work" was
// answered with "if you want i can send the form". The owner's law: the design — what they want, a
// subject, idea or reference — is always seen first; the form comes after. Only the offer_form plan
// may offer it, and only send_form may send it.
const FORM_BEFORE_DESIGN_INSTRUCTION = 'No concrete design direction exists yet (a style, a compliment, general interest or a capability question is not one), or the form was already offered. Answer the live turn, then pull one light idea / subject / reference; do not offer or send the form.'
const {
  GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON,
  liveTextIsGenericInfoRequest,
  hasLiveMedia: liveTurnCarriesMedia
} = require(path.join(__dirname, 'scv-generic-info-fast-path.js'))

const ACTIONS = Object.freeze({
  DEPOSIT_HOLD: 'deposit_hold',
  DEPOSIT_PENDING_CONTINUE: 'deposit_pending_continue',
  DEPOSIT_HANDOFF: 'deposit_handoff',
  DOUBLE_CHECK: 'double_check',
  AWAIT_DOUBLE_CHECK_CONFIRMATION: 'await_double_check_confirmation',
  SEND_FORM: 'send_form',
  CLARIFY_FORM_PERMISSION: 'clarify_form_permission',
  POST_FORM_AVAILABILITY: 'post_form_availability',
  POST_FORM_TIME: 'post_form_time',
  POST_FORM_IDENTITY: 'post_form_identity',
  ACCEPTED_SLOT_PROGRESS: 'accepted_slot_progress',
  RESOLVE_CONTEXT: 'resolve_context',
  KEEP_CONSULTATION_IN_DM: 'keep_consultation_in_dm',
  BUDGET_OBJECTION_HOLD: 'budget_objection_hold',
  OFFER_FORM: 'offer_form',
  DESIGN_INTAKE: 'design_intake',
  TATTOO_CONTINUE: 'tattoo_continue',
  SOCIAL_CONTINUE: 'social_continue',
  GENERAL_CONTINUE: 'general_continue'
})

const ACTION_SET = new Set(Object.values(ACTIONS))
const BOOKING_DATE_AUTHORITY_ACTIONS = new Set([
  ACTIONS.POST_FORM_AVAILABILITY,
  ACTIONS.POST_FORM_TIME,
  ACTIONS.POST_FORM_IDENTITY,
  ACTIONS.ACCEPTED_SLOT_PROGRESS,
  ACTIONS.DOUBLE_CHECK,
  ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION,
  ACTIONS.DEPOSIT_HANDOFF,
  ACTIONS.DEPOSIT_PENDING_CONTINUE,
  ACTIONS.DEPOSIT_HOLD
])

function liveText(input) {
  return String(input?.message || input?.text || input?.structured_state?.live_turn_text || '').trim()
}

function packetText(packet) {
  return (Array.isArray(packet?.bubbles) ? packet.bubbles : [])
    .map((bubble) => String(bubble?.text || ''))
    .join('\n')
}

function countOccurrences(haystack, needle) {
  const raw = String(haystack || '')
  const target = String(needle || '')
  if (!target) return 0
  let count = 0
  let offset = 0
  while (true) {
    const index = raw.indexOf(target, offset)
    if (index < 0) return count
    count += 1
    offset = index + target.length
  }
}

function asksPrice(input) {
  // State and model flags are candidate evidence only. A price obligation may
  // exist only when the current client message directly asks about pricing.
  return liveAsksPricingOrPolicy(input)
}

function exactAddressPresent(packet) {
  const compact = packetText(packet).toLowerCase().replace(/[^a-z0-9]/g, '')
  return compact.includes('10arkansasstsanfranciscoca94107') || compact.includes('10arkansasstreetsanfranciscoca94107')
}

// v154 (live 2026-09-06 01:24Z): a client who asked "Sure it's free?" was answered with the
// price, and the tattoo lane rejected that answer as a dead end because it carried no trailing
// question. Answering the direct question the live turn demanded IS the move; the client reacts
// to the answer. Only obligations whose fulfilment is deterministically checkable count here.
function obligationAnswerCarriesMotion(plan, packet) {
  const obligations = Array.isArray(plan?.obligations) ? plan.obligations : []
  if (obligations.includes('answer_model_rate') && priceAnswerPresent(packet)) return true
  // v157: the memory answer to a repeated price question is itself the move
  if (obligations.includes('acknowledge_rate_already_given') && packetAcknowledgesRateWithoutNumber(packet)) return true
  if (obligations.includes('answer_exact_location') && exactAddressPresent(packet)) return true
  return false
}

function priceAnswerPresent(packet) {
  return (
    packetHasLockedPricingAnswer(packet) &&
    !packetUsesPricingSalesFiller(packet) &&
    !packetLeaksPricingPolicyProse(packet)
  )
}

function formLinkSent(input) {
  const state = input?.structured_state || {}
  if (state.form_link_sent === true) return true
  return (Array.isArray(input?.recent_history) ? input.recent_history : [])
    .some((event) => isConversationVisibleAssistantEvent(event) && String(event?.text || event?.message || '').includes(PREFERRED_FORM_LINK))
}

function formOfferOpen(input) {
  const state = input?.structured_state || {}
  if (state.form_offer_asked === true) return true
  return assistantHistoryHasFormOffer(input)
}

function formConsent(input) {
  // Transaction authority must come from direct client evidence, never from a
  // persisted or model-authored intent flag. A consent that arrived immediately
  // before another user message remains authoritative until the promised URL is
  // fulfilled or the client explicitly withdraws it. This lets the controller,
  // runner, verifier, and adoption gate see the same atomic human turn.
  return (
    shouldSendFormNow(input) ||
    liveExplicitFormLinkRequest(input) ||
    priorExplicitFormConsentStillUnfulfilled(input)
  )
}

// Live 2026-07-27: the superseded image turn's machine narration
// ("sent a reference post: <vision prose>") entered the direct-question turns
// and its wording tripped the pricing obligation — the offer_form packet was
// then rejected forever as closed_transition_rate_missing and the lead got
// silence. Machine narration can never BE a client's direct question; a
// voice-note transcript is the client's own words and is kept.
function stripMachineMediaNarrationForDirectQuestions(text) {
  // Pending-turn texts arrive wrapped, e.g. "(earlier message 1 from them that
  // you have NOT replied to yet) sent a reference post: ..." — the optional
  // leading parenthetical must not defeat the label match.
  const value = String(text || '')
  const voice = value.match(/^(?:\([^)]*\)\s*)?sent a voice note saying:\s*([\s\S]*)$/i)
  if (voice) return voice[1]
  if (/^(?:\([^)]*\)\s*)?sent a (reference post|photo|heart reaction|voice note)\b/i.test(value)) return ''
  return value
}

function directQuestionTurnInputs(input) {
  const state = input?.structured_state || {}
  const texts = [
    ...pendingUnansweredUserTurnTexts(input),
    liveText(input)
  ].map((value) => stripMachineMediaNarrationForDirectQuestions(value).trim()).filter(Boolean)
  return texts.map((text) => ({
    ...input,
    message: text,
    text,
    live_message: text,
    recent_history: [],
    structured_state: {
      ...state,
      live_turn_text: text
    }
  }))
}

// A client can answer an open form-permission question with another useful
// tattoo detail instead of yes/no. That detail keeps the conversation alive but
// it is not consent to receive the URL. Keep this semantic and open-vocabulary:
// the detector recognizes size / body-placement information rather than one
// inspected sentence such as "roughly 8 inches or so".
function liveVolunteersSizeOrPlacement(input) {
  // v162: a money-shaped number answering the studio's budget question is a budget, never a size or placement
  if (liveStatesBudgetAmount(input)) return false
  const text = liveText(input)
  if (!text) return false
  const size = (
    /\b\d+(?:\.\d+)?\s*(?:inch|inches|in|in\.|\")\b/i.test(text) ||
    /\b\d+\s*(?:x|by)\s*\d+\b/i.test(text) ||
    /\b(?:roughly|around|about|approx|approximately)\s*\d+(?:\.\d+)?\b/i.test(text) ||
    /\b(?:small|medium|middle|mid[ -]?size|midsize|large|bigger|tiny|palm[ -]?size|fist[ -]?size)\b/i.test(text)
  )
  // Placement language is relational, not a closed phrase list. Keep the
  // relation bounded by an explicit body-part anchor so unseen but ordinary
  // directions such as "over my forearm", "across my shoulder", "along my
  // arm", "down my leg", or "onto my wrist" remain consultation details
  // rather than being mistaken for permission to skip into scheduling.
  const bodyPart = '(?:(?:upper|lower|inner|outer|front|back|side)\\s+)?(?:arm|forearm|wrist|bicep|shoulder|back|chest|ribs?|sternum|neck|thigh|calf|shin|ankle|hand|leg)'
  const placementRelation = new RegExp(
    `\\b(?:on(?:to)?|over|across|along|around|down|up|under|inside|outside|beside|near|toward(?:s)?|for)\\s+(?:(?:my|the|this)\\s+)?${bodyPart}\\b`,
    'i'
  )
  const placementStandalone = new RegExp(
    `^\\s*(?:(?:my|the|this)\\s+)?${bodyPart}\\b`,
    'i'
  )
  const placementPossessive = new RegExp(
    `\\b(?:my|the|this)\\s+${bodyPart}\\b`,
    'i'
  )
  const placement = (
    placementRelation.test(text) ||
    placementStandalone.test(text) ||
    placementPossessive.test(text)
  )
  return size || placement
}

function voiceTranscriptBody(input) {
  return liveText(input)
    .replace(/^sent\s+a\s+voice\s+note\s+saying\s*:\s*/i, '')
    .replace(/^voice\s+note\s*:\s*/i, '')
    .trim()
}

function pendingFormPermissionNeedsClarification(input) {
  const state = input?.structured_state || {}
  if (!formOfferOpen(input) || formLinkSent(input) || formConsent(input)) return false
  if (state.live_turn_declines === true || state.live_turn_form_submitted_signal === true || state.live_turn_deposit_sent === true) return false
  if (state.live_turn_gave_design_idea === true || state.live_turn_is_media_reference === true || state.live_turn_accepts_offered_slot === true) return false
  if (asksStudioLocation(liveText(input)) || asksPrice(input) || liveExplicitFormLinkRequest(input)) return false
  if (state.live_turn_is_voice_note !== true && state.live_turn_voice_transcribe_failed !== true) return false
  if (state.live_turn_voice_transcribe_failed === true) return true

  const body = voiceTranscriptBody(input)
  if (!body) return true
  if (/[?？]/.test(body) || /\b(what|why|how|where|when|which|who|can|could|would|do|does|is|are)\b/i.test(body)) return false
  if (/\b(no|nope|nah|not yet|later|wait|hold on|stop)\b/i.test(body)) return false
  if (/\b(black|grey|gray|color|colour|arm|leg|back|chest|shoulder|wrist|forearm|placement|size|small|medium|large|inch|inches|design|reference|vibe)\b/i.test(body)) return false
  const tokens = body.match(/[\p{L}\p{N}']+/gu) || []
  return tokens.length >= 1 && tokens.length <= 6
}

function slotAccepted(input) {
  const state = input?.structured_state || {}
  if (bookingDayConstraintPreference(liveText(input))) return false
  // A confirmation of the immediately preceding four-field double-check is a
  // stronger dialogue act than the generic accepted-slot flag. The live
  // annotator intentionally marks short affirmations such as "yeah, everything's
  // perfect" as slot acceptance too, but once the visible assistant object is
  // the Name / Phone / Appointment date / Time checkpoint that shared flag must
  // not pull the controller backward into POST_FORM_IDENTITY. The checkpoint
  // owns the turn and advances directly to the one-shot deposit handoff.
  if (
    doubleCheckConfirmationContext(input) ||
    state.live_turn_confirms_double_check === true
  ) return false
  // A current explicit date proposal is a counterproposal even when it begins
  // with "ok" or a model intent classifier marks it as generic acceptance.
  if (
    String(state.live_turn_date_phrase || '').trim() ||
    String(state.live_turn_date_status || '').trim() ||
    state.live_turn_date_needs_month === true
  ) return false
  return state.live_turn_accepts_offered_slot === true || liveAcceptsOfferedBookingSlot(input)
}

function formSubmitted(input) {
  const state = input?.structured_state || {}
  return state.form_submitted === true || state.live_turn_form_submitted_signal === true || liveFormSubmittedSignal(input)
}

function doubleCheckAlreadySent(input) {
  const state = input?.structured_state || {}
  if (state.live_turn_checkpoint_invalidated === true) return false
  // A checkpoint that a later client revision superseded (date, time, name or
  // phone changed after it) is history, not an open confirmation gate: the
  // corrected four-field block still has to be sent (live red-team 2026-09-02,
  // "actually can we do the 13th instead" -> "4pm").
  if (state.checkpoint_superseded_by_revision === true && state.double_check_sent !== true) return false
  return assistantSentNamePhoneDateTimeDoubleCheck(input)
}

function allFields(state) {
  const fields = normalizedFields(state)
  return Boolean(
    fields.name &&
    fields.phone &&
    fields.date &&
    fields.time
  )
}

function bookingPolicyDecisionForInput(input = {}) {
  const state = input?.structured_state || {}
  const priorAssistantPacket = latestAssistantPacketText(input)
  const assistantDateSlotOpen = Boolean(
    formSubmitted(input) &&
    (
      /\b(?:what|which|any|couple|some)\b.{0,55}\b(?:date|dates|day|days|weekend|weekends|availability)\b/i.test(priorAssistantPacket) ||
      /\bwhen\b.{0,45}\b(?:free|available|open|work|works|come|do it)\b/i.test(priorAssistantPacket)
    )
  )
  const calendarFrame = calendarBookingProposalFrame(liveText(input), {
    allowBareDate: assistantDateSlotOpen
  })
  if (calendarFrame.proposal !== true || !calendarFrame.candidate_text) {
    return {
      status: 'missing',
      phrase: '',
      date: null,
      policy_version: SCV_BOOKING_POLICY_VERSION,
      policy_fingerprint: BOOKING_POLICY_FINGERPRINT
    }
  }
  const ingressTimeMs = immutableIngressTimeMs(input)
  return classifyBookingDateText(calendarFrame.candidate_text, {
    referenceTime: ingressTimeMs ? new Date(ingressTimeMs).toISOString() : undefined,
    currentDateLocal: state.current_message_date_local,
    minimumDateLocal: state.minimum_booking_date_local,
    allowAmbiguousDay: false
  })
}

function normalizedFields(state = {}, bookingDecision = null) {
  const policyOwnsDate = bookingDecision && bookingDecision.status !== 'missing'
  const effectiveDateStatus = policyOwnsDate
    ? String(bookingDecision.status || '')
    : String(state.live_turn_date_status || '')
  const effectiveDatePhrase = policyOwnsDate
    ? String(bookingDecision.phrase || bookingDecision.canonical_label || '').trim()
    : String(state.live_turn_date_phrase || '').trim()
  const liveLegalDate = effectiveDateStatus === 'legal'
    ? effectiveDatePhrase
    : ''
  const currentExplicitDateProposal = !!(
    effectiveDatePhrase ||
    effectiveDateStatus ||
    state.live_turn_date_needs_month === true
  )
  // The canonical booking policy derives its minimum from immutable ingress
  // time even when a partial or legacy state record has not persisted the
  // policy snapshot yet. An outside-window proposal must never reach the
  // verifier without the legal alternative that the verifier requires.
  const policyMinimumParts = isoToParts(bookingDecision?.minimum_date_iso)
  const policyMinimumDate = formatDateShort(policyMinimumParts)
  const policyCloseBookingOptions = buildCloseBookingOptions(policyMinimumParts)
  const minimumBookingDate = String(
    state.minimum_booking_date_local || policyMinimumDate || ''
  ).trim()
  const earliestBookingOption = String(
    state.earliest_booking_option_local || policyCloseBookingOptions[0] || policyMinimumDate || ''
  ).trim()
  const closeBookingOptions = Array.isArray(state.close_booking_options_local) && state.close_booking_options_local.length
    ? state.close_booking_options_local.map((value) => String(value || '').trim()).filter(Boolean)
    : policyCloseBookingOptions
  return {
    // Route selection already accepts current-turn identity candidates. The
    // verifier must compare against the same authority fields; otherwise a valid
    // deterministic checkpoint is rejected after the client supplies the last
    // missing name/phone and the thread goes silent.
    // The stored form/DM name is authoritative and was sanitized when it was
    // captured; only a raw current-turn candidate goes through the utterance
    // sanitizer, whose trailing "and my number" stripper would otherwise eat a
    // real trailing word of a submitted name.
    name: sanitizeStoredIdentityName(state.known_name_used_on_form) ||
      sanitizeBookingIdentityName(state.live_turn_name_candidate || ''),
    phone: String(state.known_phone_used_on_form || state.live_turn_phone_candidate || '').trim(),
    // The current client proposal is the highest-authority date object. Once a
    // replacement offer is accepted, that accepted slot outranks the older
    // rejected request retained for negotiation history.
    date: String(
      liveLegalDate ||
      state.live_turn_accepted_offered_date ||
      state.accepted_offered_date ||
      state.known_requested_date ||
      ''
    ).trim(),
    // A genuinely replaced/ambiguous date invalidates an older sibling time;
    // merely re-affirming the exact persisted calendar date does not. The
    // controller stamps checkpoint invalidation `false` only after comparing
    // canonical date/time authority. Missing/unknown provenance therefore fails
    // closed as replacement rather than laundering a stale time into a new date.
    time: String(
      currentExplicitDateProposal
        ? state.live_turn_checkpoint_invalidated === false
          ? state.live_turn_time_phrase || state.live_turn_accepted_offered_time || state.accepted_offered_time || state.known_requested_time || ''
          : state.live_turn_time_phrase || state.live_turn_historical_offered_time || ''
        : state.live_turn_time_phrase || state.live_turn_accepted_offered_time || state.accepted_offered_time || state.known_requested_time || ''
    ).trim(),
    checkpoint_revision: String(state.live_turn_checkpoint_revision_intent || '').trim()
      ? {
          kind: String(state.live_turn_checkpoint_revision_intent || '').trim(),
          ...(state.live_turn_checkpoint_revision_detail && typeof state.live_turn_checkpoint_revision_detail === 'object'
            ? state.live_turn_checkpoint_revision_detail
            : {})
        }
      : null,
    proposed_time: String(state.live_turn_time_candidate || '').trim(),
    time_status: String(state.live_turn_time_status || '').trim(),
    minimum_booking_time: String(
      state.minimum_booking_time_local || state.earliest_allowed_time || '1pm'
    ).trim(),
    proposed_date: effectiveDatePhrase,
    monthless_day: String(state.live_turn_monthless_day_candidate || '').trim(),
    date_status: effectiveDateStatus,
    date_iso: String(bookingDecision?.date_iso || state.live_turn_date_iso || '').trim(),
    booking_policy_version: SCV_BOOKING_POLICY_VERSION,
    booking_policy_fingerprint: BOOKING_POLICY_FINGERPRINT,
    last_offered_date: String(state.last_offered_date || '').trim(),
    last_offered_time: String(state.last_offered_time || '').trim(),
    minimum_booking_date: minimumBookingDate,
    earliest_booking_option: earliestBookingOption,
    close_booking_options: closeBookingOptions
  }
}

function independentDesignDirectionExists(input) {
  const state = input?.structured_state || {}
  if (state.known_client_anchored_inspiration === true) return true
  if (liveTurnHasTattooReferenceEvidence(input) || knownTattooReferenceMediaReceived(input)) return true
  if (clientAnchoredInspirationReference(input)) return true
  // v155: stored context is judged by the shared stored-context reader (strict detector, plus legacy
  // style-only statements; never a stored question or capability text).
  return storedDesignContextIsDesign(state.known_design_context)
}

function requestedReferenceAuthorityKind(input) {
  const chain = requestedReferenceFulfillmentChain(
    Array.isArray(input?.recent_history) ? input.recent_history : [],
    liveText(input)
  )
  return String(chain?.authority_kind || '')
}

function transportShadowReferenceOwnsFollowup(input) {
  return requestedReferenceAuthorityKind(input) === 'transport_shadow_requested_reference'
}

function liveComplimentNeedsDesignLead(input) {
  return livePortfolioStyleComplimentOnly(input) && !independentDesignDirectionExists(input)
}

function unresolvedReferencePointerNeedsMedia(input) {
  const state = input?.structured_state || {}
  if (state.live_turn_checkpoint_invalidated === true) return false
  return state.live_turn_context_missing_attachment === true || state.live_turn_reference_pointer_without_media === true
}

function missingContextRelation(input) {
  const state = input?.structured_state || {}
  if (
    state.live_turn_checkpoint_invalidated !== true &&
    (state.live_turn_context_missing_attachment === true || state.live_turn_reference_pointer_without_media === true)
  ) {
    return 'missing_attachment'
  }
  if (state.live_turn_context_needs_clarification === true) {
    const relation = String(state.live_turn_context_relation || '')
    return relation === 'unintelligible' ? 'unintelligible' : 'ambiguous_missing_referent'
  }
  return ''
}

function contextResolutionNeeded(input) {
  return Boolean(missingContextRelation(input))
}

function latestAssistantAskedDateOrAvailability(input) {
  const history = Array.isArray(input?.recent_history) ? input.recent_history : []
  const liveMessageId = String(input?.message_id || '').trim()
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const event = history[index] || {}
    if (event.role === 'user') {
      if (liveMessageId && String(event.message_id || '').trim() === liveMessageId) continue
      return false
    }
    if (event.role === 'assistant_attempted' && !isConversationVisibleAssistantEvent(event)) return false
    if (!isConversationVisibleAssistantEvent(event)) continue
    const text = String(event.text || event.message || '')
    // v147: an explicit slot question ("does september 10 (thursday) at 2pm work
    // for you") is a date/availability ask too; the deterministic outside-window
    // decline ends with exactly that question, and the client's next calendar
    // answer must keep the booking route before the form match.
    const explicitSlotQuestion =
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(text) &&
      /\b(?:work|works|available|free|good|okay|ok|possible|doable|opening|open|earliest|first|soonest|fit)\b/i.test(text) &&
      (/[?？]/.test(text) || /^\s*(?:does|do|would|could|can|is|are|will)\b/i.test(text))
    return explicitSlotQuestion || (
      /\b(date|dates|day|days|weekend|weekends|availability|available)\b/i.test(text) &&
      (/[?？]/.test(text) || /\b(send|throw|give|tell|lmk|let me know|what|which|any|easiest|works?)\b/i.test(text))
    )
  }
  return false
}

function bareAmbiguousBookingNumber(input) {
  const stateDay = String(input?.structured_state?.live_turn_monthless_day_candidate || '').trim()
  if (/^(?:[1-9]|[12]\d|3[01])$/.test(stateDay)) return stateDay

  const text = liveText(input)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  const match = text.match(/^(?:(?:how|what)\s+about|can\s+you\s+do|could\s+you\s+do|maybe|possibly|the)?\s*(\d{1,2})(?:st|nd|rd|th)?\s*[?!.]*$/i)
  if (!match) return ''
  const day = Number(match[1])
  return day >= 1 && day <= 31 ? String(day) : ''
}

function verifierReason(value) {
  if (value && typeof value === 'object') return String(value.reason || '')
  return String(value || '')
}

function deriveVerifierRebasePlan(input = {}, currentPlan = null, verifierVerdict = null) {
  const plan = currentPlan && ACTION_SET.has(currentPlan.action)
    ? currentPlan
    : deriveClosedTransitionPlan(input)

  // Live 2026-07-27 #2: a frozen controller route can outlive the state that
  // justified it (offer_form stayed locked while the thread's design direction
  // was no longer settled). Every candidate authored under the stale route was
  // deterministically stripped, the non-authoring guard demanded reauthor, and
  // the loop burned to silence. When the guard fires and a fresh derivation
  // disagrees with the frozen plan, rebase once to the fresh plan instead of
  // burning the whole budget against a contradiction.
  const routeConflictReason = verifierReason(verifierVerdict).replace(/^after_reauthor_/, '')
  // Live 2026-09-03 03:01Z (Omar.system): the route locked post_form_identity
  // before the gmail form match landed; one pass later the verifier reported
  // ready_booking_identity_requires_double_check, but nothing rebased, three
  // passes burned (53 s) and the checkpoint only shipped through the failure
  // recovery with the plan still saying "identity missing". When the verifier
  // says the four fields are ready, rebase straight to DOUBLE_CHECK so the
  // deterministic checkpoint authors the turn under its own action and the
  // commit path records the checkpoint as sent.
  if (routeConflictReason === 'ready_booking_identity_requires_double_check') {
    const state = input?.structured_state || {}
    if (
      String(plan.action || '') !== ACTIONS.DOUBLE_CHECK &&
      (structuredStateHasAllDoubleCheckFields(input) || allFields(state)) &&
      !doubleCheckAlreadySent(input)
    ) {
      const fresh = deriveClosedTransitionPlan(input)
      const base = fresh && fresh.action === ACTIONS.DOUBLE_CHECK ? fresh : { ...plan, action: ACTIONS.DOUBLE_CHECK, reason: 'verifier_ready_identity_rebased_to_double_check' }
      return {
        ...base,
        rebase: {
          source: 'verifier_rejection',
          verifier_reason: routeConflictReason,
          previous_action: String(plan.action || ''),
          previous_reason: String(plan.reason || '')
        }
      }
    }
    return null
  }
  if (
    routeConflictReason === 'non_authoring_guard_requires_model_reauthor' ||
    routeConflictReason === 'non_tattoo_media_cannot_advance_booking_funnel'
  ) {
    const fresh = deriveClosedTransitionPlan(input)
    if (
      routeConflictReason === 'non_tattoo_media_cannot_advance_booking_funnel' &&
      String(fresh?.reason || '') !== 'non_tattoo_media_requires_contextual_host_lead'
    ) return null
    if (
      fresh &&
      ACTION_SET.has(fresh.action) &&
      String(fresh.action) !== String(plan.action || '')
    ) {
      return {
        ...fresh,
        rebase: {
          source: 'verifier_rejection',
          verifier_reason: routeConflictReason,
          previous_action: String(plan.action || ''),
          previous_reason: String(plan.reason || '')
        }
      }
    }
    return null
  }

  if (verifierReason(verifierVerdict) !== 'size_answer_requires_visible_next_move') return null

  const day = bareAmbiguousBookingNumber(input)
  const state = input?.structured_state || {}
  const postForm = state.form_submitted === true || plan.action === ACTIONS.POST_FORM_AVAILABILITY
  const dateSlotOpen =
    plan.reason === 'submitted_form_monthless_day_requires_month_clarification' ||
    plan.reason === 'submitted_form_missing_date' ||
    latestAssistantAskedDateOrAvailability(input)
  if (!day || !postForm || !dateSlotOpen) return null

  // Dialogue-pair authority outranks a lower-level lexical size detector. When
  // the immediately preceding assistant packet explicitly asked for dates and
  // dm-authority marked the bare 1-31 number as a contextual day needing only a
  // month, the verifier may not downgrade that strong frame into date-vs-size
  // ambiguity. Preserve the date route and let the month-only gate verify it.
  const dateDimensionLocked =
    state.live_turn_contextual_booking_reply === true &&
    state.live_turn_date_needs_month === true &&
    String(state.live_turn_monthless_day_candidate || '').trim() === day &&
    latestAssistantAskedDateOrAvailability(input)
  if (dateDimensionLocked) return null

  return {
    version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
    action: ACTIONS.RESOLVE_CONTEXT,
    reason: 'verifier_conflict_booking_day_or_size',
    obligations: Array.from(new Set([...(Array.isArray(plan.obligations) ? plan.obligations : []), 'disambiguate_booking_day_or_size'])).sort(),
    stage: String(plan.stage || state.booking_stage_hint || 'awaiting_date'),
    fields: {
      ...(plan.fields && typeof plan.fields === 'object' ? plan.fields : {}),
      monthless_day: day,
      ambiguous_value: day
    },
    live_intent: {
      ...(plan.live_intent && typeof plan.live_intent === 'object' ? plan.live_intent : {}),
      form_submitted: true
    },
    rebase: {
      source: 'verifier_rejection',
      verifier_reason: 'size_answer_requires_visible_next_move',
      previous_action: String(plan.action || ''),
      previous_reason: String(plan.reason || '')
    }
  }
}

function liveTurnHasDirectTattooAuthority(input) {
  const state = input?.structured_state || {}
  const live = liveText(input)
  return hasTattooIntentSignal({
    ...input,
    message: live,
    recent_history: [],
    // Durable lane state is intentionally excluded.  This answers only whether
    // the newest client turn itself carries tattoo authority; an old design may
    // not silently own an unrelated question or topic jump.
    structured_state: {
      live_turn_text: live,
      live_turn_is_media_reference: state.live_turn_is_media_reference === true,
      live_turn_gave_design_idea: state.live_turn_gave_design_idea === true,
      tattoo_intent_active: false,
      live_turn_is_tattoo_intent: false,
      booking_stage_hint: 'open_conversation'
    }
  })
}

function latestTurnOwnsStandaloneConversation(input) {
  const state = input?.structured_state || {}
  if (contextResolutionNeeded(input)) return false
  // v147 (live 2026-09-03 16:38Z): the booking policy resolved "Can we do fifth
  // of September?" to a calendar proposal while dm-authority carried no live
  // date status before the form match; the classifier's is_question flag then
  // made this turn "stand-alone" and the outside-window decline route flipped
  // to social. A resolved live calendar proposal is a booking move, whatever
  // the classifier says about its surface shape.
  if (bookingPolicyDecisionForInput(input).status !== 'missing') return false
  if (
    state.live_turn_deposit_sent === true ||
    state.live_turn_deposit_proof_media === true ||
    formConsent(input) ||
    state.live_turn_form_submitted_signal === true ||
    state.live_turn_accepts_offered_slot === true ||
    state.live_turn_contextual_booking_reply === true ||
    !!String(state.live_turn_date_phrase || '').trim() ||
    !!String(state.live_turn_date_status || '').trim() ||
    !!String(state.live_turn_time_phrase || '').trim() ||
    state.live_turn_is_media_reference === true ||
    liveExplicitFormLinkRequest(input) ||
    asksPrice(input) ||
    asksStudioLocation(liveText(input)) ||
    liveTurnHasDirectTattooAuthority(input)
  ) return false

  return Boolean(
    liveNoisyCanAskQuestion(input) ||
    liveStandaloneEmojiText(input) ||
    state.live_turn_self_contained_topic_shift === true ||
    state.live_turn_is_question === true
  )
}

function packetRequestsReferenceMedia(packet) {
  const text = packetText(packet)
  return (
    /\b(?:send|show|share|drop|attach|resend|forward|throw|shoot|upload)\b.{0,70}\b(?:photo|pic|picture|image|reference|ref|post|screenshot|it|that|this)\b/i.test(text) ||
    /\b(?:photo|pic|picture|image|reference|ref|post|screenshot)\b.{0,70}\b(?:send|show|share|drop|attach|resend|forward|throw|shoot|upload)\b/i.test(text)
  )
}

function packetAssumesUnseenReference(packet) {
  const text = packetText(packet)
  return (
    // Positive approval/evaluation at the start still pretends the missing
    // object or direction was understood, even when a clarification follows.
    // Neutral attention markers ("wait", "hey", or bare "okay") remain valid;
    // approval words such as "cool" or "sounds good" do not.
    /^(?:(?:hey|wait|hold\s+on|okay|ok|alright|right|ah|oh|yeah)[\s,!?.:-]*)*(?:cool|nice|perfect|awesome|great|love\s+that|sounds?\s+good|solid|dope|sick|sweet|amazing|for\s+sure|definitely|that\s+works|i\s+(?:like|love)\s+that)\b/i.test(text) ||
    // Subject-first evaluations are the same unsupported acceptance even when
    // the positive adjective is separated by filler ("that sounds like a solid
    // choice", "it feels pretty good"). The object still was not observed.
    /\b(?:that|this|it)\s+(?:sounds?|feels?|looks?|seems?)\b.{0,45}\b(?:good|great|solid|nice|cool|right|perfect|strong|dope|sick|sweet|promising|interesting|clean|fun)\b/i.test(text) ||
    /\bwhat\s+about\s+(?:this|that)(?:\s+one)?\b/i.test(text) ||
    // A design-content probe assumes the unseen object ("what part of it
    // clicked", "which detail do you love"). Do not classify the open
    // referent-acquisition shape itself ("what part of your arm do you mean")
    // as assumed understanding merely because it contains "what part".
    /\b(?:what|which)\b.{0,35}\b(?:part|detail|vibe|style|aspect|element)\b.{0,70}\b(?:clicked|keep|strongest|love|like|feel|feeling|into|drawn|vibing|leaning)\b/i.test(text) ||
    /\b(?:what|which)\b.{0,80}\b(?:clicked|strongest)\b/i.test(text) ||
    /\b(?:this|that)(?:\s+one)?\b.{0,45}\b(?:looks?|feels?|has|is|vibe|style|edge|wild|cool)\b/i.test(text) ||
    /\b(?:this|that|the|your)?\s*(?:direction|idea|piece|design|reference|ref|vibe|style|concept)\b.{0,55}\b(?:feels?|looks?|sounds?|works?|is|would|could)\b.{0,35}\b(?:good|solid|cool|nice|wild|clean|strong|fun|dope|sick|interesting|unique)\b/i.test(text) ||
    /\b(?:good|solid|cool|nice|wild|clean|strong|fun|dope|sick|interesting|unique)\b.{0,45}\b(?:direction|idea|piece|design|reference|ref|vibe|style|concept)\b/i.test(text) ||
    /\b(?:i\s+(?:get|see|understand)|we\s+(?:get|see|understand)|got)\b.{0,30}\b(?:this|that|the|your)?\s*(?:direction|idea|reference|ref|vibe|style|concept|one|thing)\b/i.test(text) ||
    // A later clarification question cannot wash an earlier claim that the
    // missing object/direction was already understood. This catches open-
    // vocabulary variants such as "i get that you want something like what you
    // mentioned" without binding the verifier to one visible sentence.
    /\b(?:i|we)\s+(?:get|understand|follow)\s+(?:it|that|what|where|who|you|your|the|this)\b/i.test(text) ||
    /\b(?:i|we)\s+see\s+(?:what|where|who|you|your|the|this|that\s+you)\b/i.test(text) ||
    /\b(?:got\s+it|i\s+know\s+what\s+you\s+mean|that\s+makes\s+sense|makes\s+sense)\b/i.test(text) ||
    // Acknowledgement fillers such as "got you" still assert resolution when
    // they open a packet whose referent is unknown. Keep the entire packet
    // epistemically unresolved; the clarification itself must be the motion.
    /^(?:(?:yeah|okay|ok|alright|right|ah|oh|hey)[\s,!.-]*)*(?:got\s+(?:you|it)|i\s+(?:get|understand|follow)(?:\s+(?:you|it|that))?|understood)\b/i.test(text) ||
    /\b(?:this|that|the|your)?\s*(?:direction|idea|reference|ref|vibe|style|concept)\b.{0,35}\b(?:works?|lands?|fits?|tracks?)\b(?:\s+(?:well|perfectly|fine|for\s+sure))?/i.test(text)
  )
}

function packetOffersOnlyUnresolvedPlaceholderChoice(packet) {
  const text = packetText(packet)
  const placeholder = '(?:same|last|previous|this|that|other|another|new|different)(?:\\s+(?:one|thing|piece|idea|option|part|direction))?'
  const indefinite = '(?:something|anything)(?:\\s+(?:new|else|different|other))?'
  const left = `(?:${placeholder}|${indefinite})`
  const right = `(?:${placeholder}|${indefinite})`
  return new RegExp(`\\b${left}\\b.{0,90}\\bor\\b.{0,90}\\b${right}\\b`, 'i').test(text)
}

// An ambiguous-referent route means the controller could not identify the
// person/object/place/action from authoritative context.  The adopted reply
// must therefore acquire that missing variable. A yes/no guess (including a
// generic "same one or something new" choice) can leave the referent just as
// unknown and is not resolution.
function packetRequestsOpenMissingReferent(packet) {
  const text = packetText(packet).replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()
  if (!text || packetOffersOnlyUnresolvedPlaceholderChoice(packet)) return false

  return Boolean(
    /\bwhat\s+(?:exactly\s+)?(?:do|did)\s+you\s+mean(?:\s+by\b)?/i.test(text) ||
    /\bwhat\s+(?:exactly\s+)?(?:are|were)\s+you\s+(?:referring|talking|pointing|alluding)\s+to\b/i.test(text) ||
    /\b(?:who|where)\s+(?:exactly\s+)?(?:do|did|are|were)\s+you\s+(?:mean|refer(?:ring)?|talk(?:ing)?|point(?:ing)?|allud(?:ing)?)/i.test(text) ||
    /\bwhich\s+(?:exact\s+)?(?:one|part|thing|person|place|spot|area|side|direction|message|idea|reference|way|option|action|claim)\b.{0,70}\b(?:do|did|are|were)\s+you\s+(?:mean|refer(?:ring)?|talk(?:ing)?|point(?:ing)?|allud(?:ing)?)/i.test(text) ||
    /\bwhat\s+(?:exactly\s+)?(?:one|part|thing|person|place|spot|area|side|direction|message|idea|reference|way|option|action|claim)\b.{0,55}\b(?:do|did|are|were)\s+you\s+(?:mean|refer(?:ring)?|talk(?:ing)?|point(?:ing)?|allud(?:ing)?)/i.test(text) ||
    /\bwhat\s+(?:exactly\s+)?do\s+you\s+want\s+(?:me\s+)?to\s+(?:send|show|share|drop|use|change|move|make|look\s+at|work\s+from)\b/i.test(text) ||
    /\b(?:can|could|would|will)\s+you\s+(?:tell|show|send|name|describe|clarify|explain)\b.{0,80}\b(?:what|which|who|where)\b/i.test(text) ||
    /\b(?:tell|show|send|name|describe|clarify|explain)\s+(?:me\s+)?\b(?:what|which|who|where)\b.{0,80}\b(?:mean|refer(?:ring)?|talk(?:ing)?|point(?:ing)?|want|meant)\b/i.test(text) ||
    /\bwhat\b.{0,55}\b(?:that|this|it|there|over\s+there)\b.{0,35}\b(?:mean|refer(?:ring)?\s+to|point(?:ing)?\s+to)\b/i.test(text)
  )
}

function packetClarifiesMissingContext(packet, reason = 'ambiguous_missing_referent') {
  const text = packetText(packet)
  if (packetRequestsOpenMissingReferent(packet)) return true
  if (reason !== 'unintelligible') return false

  // A candidate confirmation is useful for noisy/ASR text only. It is not
  // authority for an otherwise unidentified referent.
  const candidateConfirmation = (
    /\b(?:did|do|were|are)\s+you\s+(?:mean|saying|talking\s+about|referring\s+to)\b/i.test(text) ||
    /\b(?:do|did)\s+you\s+mean\b/i.test(text) ||
    /\bwhen\s+you\s+(?:say|said|mean)\b/i.test(text)
  )
  return Boolean(
    candidateConfirmation ||
    /\b(?:say|send|show|tell)\s+(?:that|it|the\s+part)\s+again\b/i.test(text) ||
    /\b(?:not\s+sure|didn.?t\s+(?:catch|get|follow)|might\s+be\s+reading|heard\s+that\s+wrong)\b/i.test(text)
  )
}

function formOfferEligible(input) {
  const state = input?.structured_state || {}
  if (formLinkSent(input) || formOfferOpen(input) || state.form_submitted === true) return false
  if (liveComplimentNeedsDesignLead(input)) return false
  return Boolean(
    liveTurnHasTattooReferenceEvidence(input) ||
    knownTattooReferenceMediaReceived(input) ||
    independentDesignDirectionExists(input) ||
    liveHasConcreteDesignDirection(input)
  )
}

// A generic information request ("Hi, can I please get more information?")
// while the four-field checkpoint is open and not yet confirmed (live incident
// 2026-09-03, Omar.system). Bounded to the same text shapes and exclusions the
// generic-info fast path accepts, so the route and the executor agree. A
// revision, a confirmation, media, a deposit claim or a price question never
// lands here. This deliberately does not consult the durable design-direction
// guard: with the checkpoint open the design is settled, and reading the
// client-anchored reference from state is what pushed the live turn off the
// direct-info route, into the model lane and onto the which-field recovery ask.
function liveIsGenericInfoSideQuestionAtOpenCheckpoint(input) {
  const state = input?.structured_state || {}
  if (!doubleCheckAlreadySent(input)) return false
  if (state.live_turn_checkpoint_invalidated === true) return false
  if (String(state.live_turn_checkpoint_revision_intent || '').trim()) return false
  if (state.live_turn_deposit_sent === true || state.live_turn_deposit_proof_media === true) return false
  if (liveTurnCarriesMedia(input)) return false
  return liveTextIsGenericInfoRequest(liveText(input), { liveInfoAskOpener: () => liveInfoAskOpener(input) })
}

// A direct information request is a non-transactional side turn at every funnel
// stage, not only after a successfully emitted four-field checkpoint.  Evaluate
// design specificity from the live sentence alone: historical tattoo/reference
// state remains durable context but cannot transform "more information please"
// into a booking-identity answer.  A current motif still stays in the tattoo
// lane and media/money/deposit turns retain their existing stricter routes.
function liveIsSelfContainedGenericInfoRequest(input) {
  const raw = liveText(input)
  if (!liveTextIsGenericInfoRequest(raw, { liveInfoAskOpener: () => liveInfoAskOpener(input) })) return false
  if (liveTurnCarriesMedia(input)) return false
  const state = input?.structured_state || {}
  if (state.live_turn_deposit_sent === true || state.live_turn_deposit_proof_media === true) return false
  const liveOnlyInput = {
    message: raw,
    live_message: raw,
    recent_history: [],
    media_urls: [],
    media_type: '',
    structured_state: { live_turn_text: raw }
  }
  return !liveHasConcreteDesignDirection(liveOnlyInput)
}

// Live red-team 2026-09-03 (owner, v145): "Can we do fifth of September?" right
// after the form link, before the gmail form match had landed, was routed to
// the tattoo lane and burned two dead-end verifier passes (70 s). The assistant
// asked for dates; a date answer to that ask is an availability turn whether or
// not the form submission has been matched yet.
function dateAnswerAfterFormLink(input, fields) {
  const state = input?.structured_state || {}
  if (!formLinkSent(input) || !latestAssistantAskedDateOrAvailability(input)) return false
  return Boolean(String(fields?.date_status || state.live_turn_date_status || '').trim())
}

function deriveClosedTransitionPlan(input = {}) {
  const state = input?.structured_state || {}
  const bookingDecision = bookingPolicyDecisionForInput(input)
  const fields = normalizedFields(state, bookingDecision)
  const coarseDayConstraint = bookingDayConstraintPreference(liveText(input))
  const groundedDayConstraintSlot = coarseDayConstraint
    ? selectCloseBookingOptionForDayConstraint(
        fields.close_booking_options,
        coarseDayConstraint,
        String(state.preferred_time_primary || '2pm').trim() || '2pm'
      )
    : null
  const obligations = []
  const directQuestionTurns = directQuestionTurnInputs(input)
  if (directQuestionTurns.some((turn) => asksStudioLocation(liveText(turn)))) obligations.push('answer_exact_location')
  // v157: the rate is spoken at most once per thread. A price question after the disclosure is
  // answered from memory without the number (acknowledge_rate_already_given).
  if (directQuestionTurns.some((turn) => asksPrice(turn))) obligations.push(modelRateAlreadyDisclosed(input) ? 'acknowledge_rate_already_given' : 'answer_model_rate')
  if (directQuestionTurns.some((turn) => liveAsksArtistStyleScope(turn))) obligations.push('answer_artist_style_scope')
  if (directQuestionTurns.some((turn) => liveAsksTattooCapabilityScope(turn))) obligations.push('answer_tattoo_capability_scope')
  // v148 (live 2026-09-03 18:07Z, v147 red-team case 02): "i'm thinking a small
  // dagger on my inner forearm, black and grey" burned three model passes because
  // the verifier demands that a volunteered placement/size be acknowledged and
  // deferred to the appointment, but nothing told the model so up front; the
  // turn ended in the bare recovery line after 56 s. The obligation is known at
  // route time, so the route carries it.
  if (liveVolunteersSizeOrPlacement(input) && (hasTattooIntentSignal(input) || state.tattoo_intent_active === true)) {
    obligations.push('acknowledge_and_defer_placement_size')
  }
  // v162: a budget number answering the studio's budget question must be acknowledged as workable (no discount)
  if (liveStatesBudgetAmount(input)) obligations.push('acknowledge_budget_fit')

  let action = ACTIONS.GENERAL_CONTINUE
  let reason = 'ordinary_nonempty_inbound'

  // Discourse classification has already granted real current media and direct
  // transaction evidence a coherent relation. Therefore any missing-context
  // state that survives that gate is a verified unresolved live object and must
  // outrank candidate/stale form or deposit flags. Otherwise an ASR voice note
  // such as "I'm thinking of this one" can be pulled backward into an old
  // deposit lane before the client supplies the image they are pointing at.
  if (liveArtistBiographyQuestion(input)) {
    // A question about how the artist began is answerable on its own. Neither
    // a stale lane flag nor a classifier's missing-context guess can replace
    // it with a sales prompt. The shared predicate excludes client requests.
    action = ACTIONS.SOCIAL_CONTINUE
    reason = 'artist_biography_question_owns_social_turn'
  } else if (liveIsGenericInfoSideQuestionAtOpenCheckpoint(input)) {
    // Side question at the open checkpoint: keep the thread at the confirmation
    // wait (the checkpoint is neither confirmed, revised nor abandoned) and let
    // the generic-info fast path answer it deterministically under this reason.
    action = ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION
    reason = GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON
  } else if (liveIsSelfContainedGenericInfoRequest(input)) {
    // A current, self-contained information request outranks both provisional
    // deictic ambiguity ("here", "this") and every durable booking stage.  The
    // state is preserved, but it cannot author a date/time continuation while
    // the client is directly asking for general information now. A concrete
    // current-turn motif still follows the existing design-complete route so
    // an open-vocabulary brief is never erased by its polite question framing.
    action = ACTIONS.DESIGN_INTAKE
    reason = 'direct_info_request_owns_live_turn'
  } else if (contextResolutionNeeded(input)) {
    action = ACTIONS.RESOLVE_CONTEXT
    reason = missingContextRelation(input)
  } else if (state.live_turn_deposit_sent === true || state.live_turn_deposit_proof_media === true) {
    action = ACTIONS.DEPOSIT_HOLD
    reason = 'live_deposit_sent_claim'
  } else if (
    liveExplicitFormLinkRequest(input) ||
    (!formLinkSent(input) && formOfferOpen(input) && formConsent(input))
  ) {
    // Direct transaction consent to the still-open offer outranks inherited
    // media classification. A previously classified screenshot/reference may
    // remain in state, but it cannot erase the client's live "yes, send it".
    action = ACTIONS.SEND_FORM
    reason = 'explicit_form_request_or_open_offer_consent'
  } else if (
    liveExpressesBudgetObjection(input) &&
    !liveTurnProvidesAvailabilityContent(input) &&
    !liveTurnNamesCalendarDay(input) &&
    !slotAccepted(input)
  ) {
    // v162 (live 2026-09-07 21:18Z, Omar.system): "I thought it's free though. My budget is tight." was routed
    // as the open post-form availability exchange and the reply pushed weekend slots. A cost objection is not a
    // booking turn: hold the motion, keep the lead warm, ask the budget, frame the spots as limited, no numbers.
    action = ACTIONS.BUDGET_OBJECTION_HOLD
    reason = 'cost_objection_holds_booking_motion'
  } else if (
    formLinkSent(input) &&
    coarseDayConstraint &&
    groundedDayConstraintSlot
  ) {
    // A broad calendar preference narrows the open date exchange but does not
    // accept any one of the previously visible alternatives.  Freeze exactly
    // one nearest policy-grounded slot so the model can answer naturally while
    // the verifier prevents a generic repeat question or multi-date ambiguity.
    fields.last_offered_date = groundedDayConstraintSlot.date
    fields.last_offered_time = groundedDayConstraintSlot.time
    fields.day_constraint = coarseDayConstraint.label
    fields.day_constraint_weekday = groundedDayConstraintSlot.weekday
    action = ACTIONS.POST_FORM_AVAILABILITY
    reason = 'form_handoff_coarse_day_constraint_requires_grounded_slot'
  } else if (slotAccepted(input) && !(structuredStateHasAllDoubleCheckFields(input) || allFields(state))) {
    // A short acknowledgement belongs to the immediately preceding grounded
    // scheduling offer. It must outrank durable reference-media context from an
    // earlier design turn, otherwise "sure thing" after "would August 29 work"
    // reopens the old image instead of advancing the booking checkpoint.
    if (!formLinkSent(input)) {
      action = ACTIONS.SEND_FORM
      reason = 'accepted_slot_requires_form_link'
    } else if (formSubmitted(input) && !fields.time) {
      action = ACTIONS.POST_FORM_TIME
      reason = 'accepted_slot_missing_time'
    } else if (formSubmitted(input) && (!fields.name || !fields.phone)) {
      action = ACTIONS.POST_FORM_IDENTITY
      reason = 'accepted_slot_missing_identity'
    } else {
      action = ACTIONS.ACCEPTED_SLOT_PROGRESS
      reason = 'accepted_slot_move_to_form_or_identity'
    }
  } else if (liveTurnUsesNonTattooMediaContext(input)) {
    action = ACTIONS.GENERAL_CONTINUE
    reason = 'non_tattoo_media_requires_contextual_host_lead'
  } else if (doubleCheckConfirmationContext(input) || state.live_turn_confirms_double_check === true) {
    action = ACTIONS.DEPOSIT_HANDOFF
    reason = 'four_field_double_check_confirmed'
  } else if (pendingFormPermissionNeedsClarification(input)) {
    action = ACTIONS.CLARIFY_FORM_PERMISSION
    reason = 'voice_reply_is_not_coherent_with_open_form_permission_question'
  } else if (
    formOfferOpen(input) &&
    !formLinkSent(input) &&
    !formConsent(input) &&
    hasTattooIntentSignal(input) &&
    liveVolunteersSizeOrPlacement(input)
  ) {
    // The open offer remains pending. A volunteered consultation detail is not
    // permission to transmit the form and must not be laundered into consent.
    action = ACTIONS.GENERAL_CONTINUE
    reason = 'open_form_offer_received_nonconsent_size_or_placement_detail'
  } else if (
    (formSubmitted(input) || (formLinkSent(input) && latestAssistantAskedDateOrAvailability(input))) &&
    state.live_turn_contextual_booking_reply === true &&
    state.live_turn_date_needs_month === true &&
    !!String(state.live_turn_monthless_day_candidate || '').trim()
  ) {
    // The client is answering the immediately open date question with an
    // elliptical calendar day ("26?", "can you do 26?"). This relation must
    // outrank generic question/topic-shift routing. The day is grounded; the
    // month is not, so acquire only that missing calendar dimension.
    action = ACTIONS.POST_FORM_AVAILABILITY
    reason = 'submitted_form_monthless_day_requires_month_clarification'
  } else if (latestTurnOwnsStandaloneConversation(input) && obligations.length === 0) {
    // Preserve the durable funnel in memory, but do not let it author this
    // unrelated live turn.  The response remains model-authored and must keep
    // human conversational motion without cold-pushing tattoo or booking.
    action = ACTIONS.SOCIAL_CONTINUE
    reason = liveNoisyCanAskQuestion(input)
      ? 'latest_turn_recoverable_question_permission_owns_route'
      : 'latest_turn_self_contained_nonfunnel_owns_route'
  } else if (
    state.live_turn_declines === true &&
    // Live red-team 2026-09-03 (v144 case 11): "actually can we do the 13th
    // instead" at the open checkpoint carried a stochastic decline flag and the
    // decline branch swallowed a resolved date revision. A live turn that
    // invalidated or revised the checkpoint, or that carries a resolved booking
    // date/time candidate, is a booking move, never a decline.
    state.live_turn_checkpoint_invalidated !== true &&
    !String(state.live_turn_checkpoint_revision_intent || '').trim() &&
    !['legal', 'too_soon'].includes(String(state.live_turn_date_status || '').trim().toLowerCase()) &&
    !String(state.live_turn_time_candidate || '').trim()
  ) {
    action = ACTIONS.GENERAL_CONTINUE
    reason = 'client_decline_or_not_yet_preserves_gate_without_pressure'
  } else if (state.deposit_requested === true) {
    action = ACTIONS.DEPOSIT_PENDING_CONTINUE
    reason = 'deposit_handoff_already_sent_no_booking_replay'
  } else if (
    (formSubmitted(input) || dateAnswerAfterFormLink(input, fields)) &&
    fields.date_status === 'too_soon'
  ) {
    // A live counter-proposal outside the allowed window is still a readable,
    // answerable booking turn. It owns the route before any stale offered-slot or
    // autofilled identity can promote the thread to DOUBLE_CHECK.
    action = ACTIONS.POST_FORM_AVAILABILITY
    reason = 'submitted_form_date_counterproposal_outside_window'
  } else if (
    formSubmitted(input) &&
    fields.time_status === 'too_early'
  ) {
    // A readable but prohibited time is an active customer turn, not a valid
    // appointment checkpoint. Keep the already-established date and form state,
    // reject only the time, and acquire a legal time before any double-check.
    action = ACTIONS.POST_FORM_TIME
    reason = 'submitted_form_time_before_minimum'
  } else if (
    formSubmitted(input) &&
    ['ambiguous_month', 'ambiguous_numeric', 'invalid'].includes(fields.date_status)
  ) {
    action = ACTIONS.POST_FORM_AVAILABILITY
    reason = 'submitted_form_date_requires_clarification'
  } else if (obligations.length > 0 && formSubmitted(input)) {
    // A self-contained side question does not erase the open booking checkpoint.
    // Answer the side question first, then resume exactly the one missing field.
    // Date counterproposals and ambiguities are handled by the stricter branches
    // above before this composite continuation is considered.
    if (!fields.date) {
      action = ACTIONS.POST_FORM_AVAILABILITY
      reason = 'side_question_answer_then_resume_missing_date'
    } else if (!fields.time) {
      action = ACTIONS.POST_FORM_TIME
      reason = 'side_question_answer_then_resume_missing_time'
    } else if (!fields.name || !fields.phone) {
      action = ACTIONS.POST_FORM_IDENTITY
      reason = 'side_question_answer_then_resume_missing_identity'
    } else if (!doubleCheckAlreadySent(input)) {
      action = ACTIONS.DOUBLE_CHECK
      reason = 'side_question_answer_then_resume_double_check'
    } else {
      action = ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION
      reason = 'side_question_answer_then_resume_confirmation_wait'
    }
  } else if (
    doubleCheckAlreadySent(input) &&
    String(state.live_turn_checkpoint_revision_intent || '').trim()
  ) {
    // The four-field checkpoint is open and the client is changing something
    // rather than confirming, but the authority layer could not resolve the new
    // value (ambiguous "2 or 3", a rejection, a bound, or a vague "i need to
    // change the time"). Own the exact field instead of freezing on the
    // confirmation wait (live incident 2026-09-02, Omar.system).
    const revisionKind = String(state.live_turn_checkpoint_revision_intent || '').trim()
    if (revisionKind === 'time') {
      action = ACTIONS.POST_FORM_TIME
      reason = 'double_check_time_revision_unresolved'
    } else if (revisionKind === 'date') {
      action = ACTIONS.POST_FORM_AVAILABILITY
      reason = 'double_check_date_revision_unresolved'
    } else if (['identity', 'name', 'phone'].includes(revisionKind)) {
      action = ACTIONS.POST_FORM_IDENTITY
      reason = 'double_check_identity_revision_unresolved'
    } else {
      action = ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION
      reason = 'double_check_revision_unclassified_ask_which_field'
    }
  } else if (structuredStateHasAllDoubleCheckFields(input) || allFields(state)) {
    if (doubleCheckAlreadySent(input)) {
      action = ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION
      reason = 'four_field_double_check_already_sent_wait_without_repeating'
    } else {
      action = ACTIONS.DOUBLE_CHECK
      reason = 'all_four_booking_fields_ready'
    }
  } else if (slotAccepted(input)) {
    if (!formLinkSent(input)) {
      action = ACTIONS.SEND_FORM
      reason = 'accepted_slot_requires_form_link'
    } else if (formSubmitted(input) && !fields.time) {
      action = ACTIONS.POST_FORM_TIME
      reason = 'accepted_slot_missing_time'
    } else if (formSubmitted(input) && (!fields.name || !fields.phone)) {
      action = ACTIONS.POST_FORM_IDENTITY
      reason = 'accepted_slot_missing_identity'
    } else {
      action = ACTIONS.ACCEPTED_SLOT_PROGRESS
      reason = 'accepted_slot_move_to_form_or_identity'
    }
  } else if (liveRequestsSeparateInPersonConsultation(input) && hasTattooIntentSignal(input)) {
    action = ACTIONS.KEEP_CONSULTATION_IN_DM
    reason = 'tattoo_consultation_must_remain_in_dm'
  } else if (formSubmitted(input) || dateAnswerAfterFormLink(input, fields)) {
    if (!fields.date) {
      action = ACTIONS.POST_FORM_AVAILABILITY
      reason = 'submitted_form_missing_date'
    } else if (!fields.time) {
      action = ACTIONS.POST_FORM_TIME
      reason = 'submitted_form_missing_time'
    } else if (!fields.name || !fields.phone) {
      action = ACTIONS.POST_FORM_IDENTITY
      reason = 'submitted_form_missing_identity'
    } else {
      action = ACTIONS.DOUBLE_CHECK
      reason = 'submitted_form_all_four_fields_ready'
    }
  } else if (liveComplimentNeedsDesignLead(input)) {
    action = ACTIONS.DESIGN_INTAKE
    reason = 'portfolio_compliment_requires_design_lead_not_form_offer'
  } else if (formOfferEligible(input)) {
    action = ACTIONS.OFFER_FORM
    reason = 'design_direction_ready_for_form_offer'
  } else if (hasTattooIntentSignal(input) && !independentDesignDirectionExists(input) && !liveHasConcreteDesignDirection(input)) {
    action = ACTIONS.DESIGN_INTAKE
    reason = 'tattoo_lane_missing_design_direction'
  } else if (hasTattooIntentSignal(input)) {
    action = ACTIONS.TATTOO_CONTINUE
    reason = 'active_tattoo_lane_requires_forward_motion'
  } else if (obligations.length > 0) {
    action = ACTIONS.GENERAL_CONTINUE
    reason = 'direct_question_obligation_owns_turn_without_cold_funnel_push'
  } else if (liveIsPlainSocial(input)) {
    action = ACTIONS.SOCIAL_CONTINUE
    reason = 'plain_social_lane'
  }

  return {
    version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
    action,
    reason,
    obligations: Array.from(new Set(obligations)).sort(),
    stage: String(state.booking_stage_hint || 'open_conversation'),
    fields,
    live_intent: {
      form_consent: formConsent(input),
      // Never let a persisted/model-authored flag create SEND_FORM authority.
      // Only a grounded current request/consent or an explicit prior client
      // consent whose promised URL is still unfulfilled may open this gate.
      prior_unfulfilled_form_consent: priorExplicitFormConsentStillUnfulfilled(input),
      explicit_form_request: liveExplicitFormLinkRequest(input),
      accepts_offered_slot: slotAccepted(input),
      form_submitted: formSubmitted(input),
      deposit_sent: state.live_turn_deposit_sent === true || state.live_turn_deposit_proof_media === true,
      asks_price: obligations.includes('answer_model_rate'),
    budget_objection: liveExpressesBudgetObjection(input),
    states_budget: liveStatesBudgetAmount(input),
      asks_location: obligations.includes('answer_exact_location'),
      asks_artist_style_scope: obligations.includes('answer_artist_style_scope'),
      asks_tattoo_capability_scope: obligations.includes('answer_tattoo_capability_scope'),
      direct_info_request: liveInfoAskOpener(input),
      generic_info_side_question_at_open_checkpoint: reason === GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON,
      declines: state.live_turn_declines === true,
      requested_reference_authority_kind: requestedReferenceAuthorityKind(input),
      transport_shadow_reference: transportShadowReferenceOwnsFollowup(input)
    }
  }
}

function invalid(reason, plan, instruction = '') {
  return {
    valid: false,
    reason,
    instruction,
    lock_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
    plan
  }
}

function valid(plan) {
  return {
    valid: true,
    reason: 'closed_transition_valid',
    instruction: '',
    lock_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
    plan
  }
}

function asksForDateOrAvailability(packet) {
  const text = packetText(packet)
  const explicitCalendarDate = explicitDateKeys(text).length > 0 ||
    /\b(?:the\s+)?\d{1,2}(?:st|nd|rd|th)\b/i.test(text)
  const explicitDateHasAnswerableMove = explicitCalendarDate && (
    /[?？]/.test(text) ||
    /\b(work|works|working|better|instead|available|free|good|okay|ok|possible|doable|tell me|lmk|let me know)\b/i.test(text)
  )
  return /\b(what|which|any|couple|send|throw|give|lmk|let me know)\b.{0,80}\b(date|dates|day|days|weekend|weekends|availability|available)\b/i.test(text) ||
    /\b(date|dates|day|days|weekend|weekends|availability|available)\b.{0,80}\b(work|works|thinking|easiest|good|free)\b/i.test(text) ||
    explicitDateHasAnswerableMove
}

function latestAssistantPacketText(input) {
  const history = Array.isArray(input?.recent_history) ? input.recent_history : []
  const liveMessageId = String(input?.message_id || '').trim()
  let latestIndex = -1
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === 'user') {
      if (liveMessageId && String(history[index]?.message_id || '').trim() === liveMessageId) continue
      return ''
    }
    if (history[index]?.role === 'assistant_attempted' && !isConversationVisibleAssistantEvent(history[index])) return ''
    if (isConversationVisibleAssistantEvent(history[index])) {
      latestIndex = index
      break
    }
  }
  if (latestIndex < 0) return ''

  const parts = []
  for (let index = latestIndex; index >= 0; index -= 1) {
    const event = history[index] || {}
    if (!isConversationVisibleAssistantEvent(event)) break
    const text = String(event.text || event.message || '').trim()
    if (text) parts.unshift(text)
  }
  return parts.join('\n')
}

function textAcknowledgesFormReceipt(value) {
  const text = String(value || '')
  return (
    /\b(?:got|received|have)\s+(?:the|your|that)?\s*form\b/i.test(text) ||
    /\bform\b.{0,35}\b(?:came through|is in|went through|received|submitted|all set)\b/i.test(text)
  )
}

const SUBMISSION_RESIDUE_STOP_WORDS = new Set([
  'a', 'all', 'already', 'am', 'and', 'application', 'complete', 'completed',
  'did', 'done', 'filled', 'finished', 'form', 'got', 'have', 'i', 'im', 'in',
  'is', 'it', 'its', 'ive', 'just', 'made', 'make', 'my', 'now', 'ok', 'okay',
  'out', 'over', 'please', 'send', 'sent', 'submit', 'submitted', 'submitting',
  'thank', 'thanks', 'that', 'the', 'this', 'through', 'to', 'was', 'yeah', 'yep',
  'yes', 'you', 'your'
])

function normalizedLexicalTokens(value) {
  const tokens = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z][a-z'-]{1,}/g) || []
  return tokens.map((token) => token.replace(/'s$/i, ''))
}

function ungroundedSubmissionResidueTokens(input) {
  const state = input?.structured_state || {}
  const text = liveText(input)
  const currentTurnClaimsSubmission = (
    /\bsubmit(?:ted|ting)?\b/i.test(text) ||
    /\b(?:sent|completed|filled\s+out)\b.{0,30}\b(?:form|application|it)\b/i.test(text) ||
    /\b(?:form|application)\b.{0,20}\b(?:is\s+in|submitted|sent|completed)\b/i.test(text)
  )
  if (!currentTurnClaimsSubmission) return []

  const normalizedLive = text.toLowerCase().replace(/\s+/g, ' ').trim()
  const factValues = [
    state.known_name_used_on_form,
    state.known_requested_date,
    state.known_requested_time,
    state.known_placement_context,
    state.known_size_context,
    state.instagram_username
  ]
  const priorDesign = String(state.known_design_context || '').trim()
  if (priorDesign && priorDesign.toLowerCase().replace(/\s+/g, ' ').trim() !== normalizedLive) {
    factValues.push(priorDesign)
  }
  const grounded = new Set(factValues.flatMap(normalizedLexicalTokens))
  return [...new Set(normalizedLexicalTokens(text).filter((token) => (
    token.length >= 3 &&
    !SUBMISSION_RESIDUE_STOP_WORDS.has(token) &&
    !grounded.has(token)
  )))]
}

function packetEchoesUngroundedSubmissionResidue(input, packet) {
  const visible = normalizedLexicalTokens(packetText(packet))
  const visibleSet = new Set(visible)
  return ungroundedSubmissionResidueTokens(input).filter((token) => visibleSet.has(token))
}

function textAsksGenericAvailability(value) {
  const text = String(value || '')
  if (!text) return false
  const asks = (
    /\b(?:what|which|any)\b.{0,50}\b(?:date|dates|day|days|weekend|weekends|availability)\b/i.test(text) ||
    /\b(?:date|dates|day|days|weekend|weekends|availability)\b.{0,60}\b(?:work|works|thinking|easiest|best|good|free|available)\b/i.test(text) ||
    /\bwhen\b.{0,45}\b(?:free|available|open|work|works|come|do it)\b/i.test(text)
  )
  if (!asks) return false
  return explicitDateKeys(text).length === 0 &&
    !/\b(?:what|which)\s+month\b/i.test(text)
}

function liveTurnProvidesAvailabilityContent(input) {
  const state = input?.structured_state || {}
  if (
    state.live_turn_contextual_booking_reply === true ||
    String(state.live_turn_monthless_day_candidate || '').trim() ||
    String(state.live_turn_date_phrase || '').trim() ||
    String(state.live_turn_date_status || '').trim()
  ) return true
  const text = liveText(input)
  return /\b(?:weekends?|weekdays?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|next month)\b/i.test(text)
}

function packetAddsConcreteCalendarMove(packet) {
  const text = packetText(packet)
  return explicitDateKeys(text).length > 0 ||
    /\b(?:what|which)\s+month\b/i.test(text)
}

function packetClarifiesMonthlessBookingDay(packet, fields = {}) {
  const text = packetText(packet).replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()
  const day = Number(fields.monthless_day)
  if (!text || !Number.isInteger(day) || day < 1 || day > 31) return false
  const mentionsDay = new RegExp(`\\b(?:the\\s+)?${day}(?:st|nd|rd|th)?\\b`, 'i').test(text)
  const asksMonth = (
    /\b(?:what|which)\s+month\b/i.test(text) ||
    /\bmonth\s+(?:did|do|are|were|would|should)\s+you\b/i.test(text) ||
    /\bmonth\s+(?:you(?:'re| are)?\s+thinking|you\s+mean)\b/i.test(text)
  ) && /[?？]/.test(text)
  const inventsMonth =
    /\b(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/i.test(text)
  // The day is not an available slot until its month is known.  "Sounds good",
  // "works", or "I can do the 26th" is a fabricated availability confirmation
  // even when a month question follows.  Keep the reply neutral and acquire the
  // missing calendar dimension first.
  const dayToken = `(?:the\\s+)?${day}(?:st|nd|rd|th)?`
  const availabilityClaim = new RegExp(
    [
      `${dayToken}.{0,55}\\b(?:sounds?\\s+(?:like\\s+)?(?:a\\s+)?(?:plan|good|great|perfect|fine)(?:\\s+day)?|(?:is|looks?)\\s+(?:like\\s+)?(?:a\\s+)?(?:good|great|perfect|fine)(?:\\s+day)?|good\\s+day\\s+to\\s+keep\\s+in\\s+mind|works?|available|free|doable|possible|could\\s+work|should\\s+work)\\b`,
      `\\b(?:i|we)\\s+(?:can|could|should|would)\\s+(?:do|make|take|fit|book|hold)\\s+${dayToken}\\b`,
      `\\b(?:yes|yeah|yep|perfect|great)\\b.{0,35}${dayToken}`
    ].join('|'),
    'i'
  ).test(text)
  return mentionsDay && asksMonth && !inventsMonth && !availabilityClaim
}

function packetClarifiesAmbiguousBookingDate(packet, fields = {}) {
  const text = packetText(packet).replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim()
  if (!text || !/[?？]/.test(text)) return false
  const asksForMissingDateDimension =
    /\b(?:what|which)\s+month\b/i.test(text) ||
    /\bmonth\s+(?:did|do|are|were|would|should)\s+you\b/i.test(text) ||
    /\b(?:which|what)\s+date\b/i.test(text) ||
    /\bdo\s+you\s+mean\b/i.test(text)
  const inventsAvailability =
    /\b(?:works?|available|open|free|perfect|confirmed|booked|locked\s+in|can\s+do)\b/i.test(text) &&
    !/\b(?:would|does|is|are|which|what|mean)\b/i.test(text)
  const inventsDifferentDate = explicitDateKeys(text).some(
    (key) => key !== canonicalDateKey(fields.proposed_date)
  )
  return asksForMissingDateDimension && !inventsAvailability && !inventsDifferentDate
}

function dateDecisionClauses(value) {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .split(/(?:\r?\n)+|(?<=[.!?;,])\s+|\s+\b(?:but|though|tho|however|instead|whereas|while)\b\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

function dateClauseProposalRelation(clause, proposedKey, proposedDay, activeDateKey = proposedKey) {
  const keys = explicitDateKeys(clause)
  const mentionsProposedDay =
    new RegExp(`\\b(?:the\\s+${proposedDay}(?:st|nd|rd|th)?|${proposedDay}(?:st|nd|rd|th))\\b`, 'i').test(clause)
  if (keys.length > 0) {
    return {
      // Natural one-sentence moves often use a contextual ordinal for the
      // rejected proposal and a fully specified grounded alternative:
      // "the 18th is early — would the 25th of July work?".
      refersToProposal: keys.includes(proposedKey) || mentionsProposedDay,
      activeDateKey: keys[keys.length - 1]
    }
  }

  if (new RegExp(`\\b(?:the\\s+)?${proposedDay}(?:st|nd|rd|th)?\\b`, 'i').test(clause)) {
    return { refersToProposal: true, activeDateKey: proposedKey }
  }

  // "does that work?" resolves to the most recently named date. Once a
  // grounded alternative has appeared, do not point this pronoun backward to
  // the rejected client proposal.
  const refersByPronoun =
    /\b(?:that(?:\s+date|\s+day)?|it)\b/i.test(clause) &&
    activeDateKey === proposedKey
  return { refersToProposal: refersByPronoun, activeDateKey }
}

function dateClauseNegatesRejection(clause) {
  const text = String(clause || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
  return (
    /\b(?:is(?:\s+not|n't)|are(?:\s+not|n't)|was(?:\s+not|n't)|were(?:\s+not|n't)|not|never|hardly)\s+(?:actually\s+|really\s+|even\s+)?too\s+(?:soon|early|close|late|far)\b/i.test(text) ||
    /\b(?:is(?:\s+not|n't)|are(?:\s+not|n't)|was(?:\s+not|n't)|were(?:\s+not|n't)|not|never|hardly)\s+(?:actually\s+|really\s+|even\s+)?(?:earlier|later)\s+than\s+(?:i|we)\s+can\b/i.test(text)
  )
}

function dateClauseRejectsProposal(clause) {
  // Rejection cues are polarity-sensitive. "isn't too soon" and "hardly too
  // early" reopen the prohibited date; they cannot borrow the positive "too
  // soon" token and pass as a rejection merely because a grounded boundary is
  // mentioned elsewhere in the packet.
  if (dateClauseNegatesRejection(clause)) return false
  return (
    /\b(?:can(?:not|'?t)|couldn(?:'t| not)|wouldn(?:'t| not)|won(?:not|'?t)|doesn(?:'t| not)|do\s+not|don'?t|not)\b.{0,45}\b(?:work|available|open|possible|doable|make|fit|book|do)\b/i.test(clause) ||
    /\b(?:not|isn(?:'t| not)|is\s+not)\s+(?:available|open|possible|doable)\b/i.test(clause) ||
    /\btoo\s+(?:soon|early|close|late|far)\b/i.test(clause) ||
    /\b(?:(?:a\s+)?(?:bit|little)|kind\s+of|kinda|pretty|slightly)\s+(?:too\s+)?(?:soon|early|close|late|far)\b/i.test(clause) ||
    /\b(?:earlier|later)\s+than\s+(?:i|we)\s+can\b/i.test(clause) ||
    /\b(?:earliest\s+i\s+(?:can|have)|already\s+(?:booked|taken)|no\s+(?:opening|availability))\b/i.test(clause) ||
    /\b(?:need|needs|give|leave)\b.{0,30}\bat\s+least\b.{0,12}\b(?:a|one|1)\s+week\b/i.test(clause) ||
    /\b(?:under|inside|within|short of)\b.{0,18}\b(?:a|one|1)[-\s]?week\b/i.test(clause) ||
    /\b(?:isn(?:'t| not)|is\s+not|not)\s+enough\b.{0,18}\b(?:time|notice|lead time)\b/i.test(clause) ||
    /\boutside\b.{0,20}\b(?:window|range|minimum)\b/i.test(clause) ||
    /\bcutting\s+it\s+(?:a\s+)?(?:bit\s+)?close\b/i.test(clause)
  )
}

function dateClauseAcceptsProposal(clause) {
  return (
    /\b(works?|perfect|good|great|available|free|possible|doable|can\s+do|sounds?\s+good|that'?s\s+fine|yes|yeah|yep)\b/i.test(clause) ||
    /\b(?:i|we)\s+(?:can|could|may|might)\s+(?:possibly\s+|probably\s+|maybe\s+|still\s+)*(?:(?:squeeze|fit)\s+(?:you\s+)?in|accommodate|take|book|have\s+(?:some\s+)?room|make\b.{0,24}\bhappen)\b/i.test(clause) ||
    /\b(?:i|we)\s+(?:can|could|may|might)\s+(?:possibly\s+|probably\s+|maybe\s+|still\s+)*(?:make|do)\b/i.test(clause) ||
    /\b(?:i|we)\s+(?:may|might|could)\s+be\s+able\s+to\s+(?:make|do|fit|book|accommodate|take)\b/i.test(clause) ||
    /\b(?:can|could|may|might)\s+(?:possibly\s+|probably\s+|maybe\s+|still\s+)*(?:work|happen|be\s+(?:possible|doable|available))\b/i.test(clause) ||
    /\b(?:is|would\s+be|sounds?)\s+(?:fine|okay|ok)\b/i.test(clause)
  )
}

function dateClauseEstablishesGroundedEarliestBoundary(clause, fields = {}) {
  const grounded = groundedOutsideWindowAlternativeKeys(fields)
  if (!grounded.size || !explicitDateKeys(clause).some((key) => grounded.has(key))) return false
  return (
    /\b(?:i|we)\s+(?:won'?t|will\s+not|can'?t|cannot|don'?t|do\s+not)\s+have\s+(?:an?\s+)?(?:opening|slot|appointment|availability)\s+before\b/i.test(clause) ||
    /\b(?:i|we)\s+(?:won'?t|will\s+not|can'?t|cannot|don'?t|do\s+not)\s+have\s+(?:anything|nothing|an?\s+(?:opening|slot|appointment)|availability)\s+(?:open\s+)?(?:before|until)\b/i.test(clause) ||
    /\b(?:nothing|none)\s+(?:is\s+)?(?:open|available|free)\s+(?:before|until)\b/i.test(clause) ||
    /\bno\s+(?:openings?|slots?|appointments?|availability)\s+(?:before|until)\b/i.test(clause) ||
    /\b(?:the\s+)?(?:first|earliest|soonest)\s+(?:day|date|time|opening|slot|appointment)\s+(?:i|we)\s+can\s+(?:fit|book|take|see|do|make|offer)\b/i.test(clause) ||
    /\b(?:the\s+)?(?:next|first|earliest|soonest)\s+(?:opening|slot|appointment|date|day|thing)\s+(?:i|we)\s+have\s+is\b/i.test(clause) ||
    /\b(?:the\s+)?(?:soonest|earliest|first)\s+(?:i|we)\s+can\s+(?:get|fit|book|take)\s+(?:you\s+)?in\s+is\b/i.test(clause) ||
    /\b(?:my|our|the)\s+(?:first|earliest|soonest)\s+(?:opening|slot|date|day|appointment|availability)\s+is\b/i.test(clause) ||
    /\bis\s+(?:my|our|the)\s+(?:first|earliest|soonest)\s+(?:opening|slot|date|day|appointment|availability)\b/i.test(clause) ||
    /\bis\s+(?:the\s+)?(?:next|first|earliest|soonest)\s+(?:thing|opening|slot|appointment|date|day)\s+(?:i|we)\s+have\b/i.test(clause) ||
    /\b(?:i'?m|i\s+am|we'?re|we\s+are)\s+(?:fully\s+)?booked(?:\s+up)?\s+until\b/i.test(clause) ||
    /\b(?:i'?m|i\s+am|we'?re|we\s+are)\s+not\s+(?:free|available|open)\s+(?:before|until)\b/i.test(clause) ||
    /\b(?:i|we)\s+can\s+only\s+(?:do|make|offer|fit|book|take)\b.{0,60}\b(?:or\s+later|and\s+later)\b/i.test(clause)
  )
}

function dateClauseIsDemonstrablyNeutralProposalMention(clause, establishesGroundedBoundary = false) {
  if (establishesGroundedBoundary) return true
  const withoutDates = String(clause || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\b(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi, ' ')
    .replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/gi, ' ')
    .replace(/[^a-z]+/gi, ' ')
    .trim()
    .toLowerCase()
  return /^(?:(?:as for|about|regarding)(?: the)?(?: date| day)?)?$/.test(withoutDates)
}

function packetAcceptsOutOfWindowProposal(packet, fields = {}) {
  const proposedKey = canonicalDateKey(fields.proposed_date)
  if (!proposedKey) return false
  const proposedDay = Number(proposedKey.slice(3))
  let activeDateKey = proposedKey
  const baseClauses = dateDecisionClauses(packetText(packet))
  const clauses = baseClauses.flatMap((clause) =>
    clause.split(/\s+(?:and|or|with|plus|as\s+well\s+as|[-\u2013\u2014])\s+/i).map((part) => part.trim()).filter(Boolean)
  )
  const packetHasGroundedBoundary = baseClauses.some((clause) =>
    dateClauseEstablishesGroundedEarliestBoundary(clause, fields)
  )
  for (const clause of clauses) {
    const establishesGroundedBoundary = dateClauseEstablishesGroundedEarliestBoundary(clause, fields)
    const relation = dateClauseProposalRelation(clause, proposedKey, proposedDay, activeDateKey)
    const activeProposalPronoun = activeDateKey === proposedKey && /\b(?:then|there)\b/i.test(clause)
    const ellipticallyRefersToActiveProposal =
      activeDateKey === proposedKey &&
      (
        /\b(?:opening|slot|availability|available|open|option|room)\b.{0,24}\bthen\b/i.test(clause) ||
        /\bthen\b.{0,24}\b(?:opening|slot|availability|available|open|option|room)\b/i.test(clause) ||
        (
          activeProposalPronoun &&
          (
            /\b(?:can|could|may|might)\b.{0,55}\b(?:squeeze|fit|accommodate|take|book|offer|hold|make)\b/i.test(clause) ||
            /\b(?:opening|slot|availability|available|open|option|room|cancellation)\b/i.test(clause) ||
            /\bmaybe\b.{0,24}\b(?:then|there)\b.{0,24}\bafter\s+all\b/i.test(clause)
          )
        )
      )
    activeDateKey = relation.activeDateKey
    if (relation.refersToProposal || ellipticallyRefersToActiveProposal) {
      if (dateClauseRejectsProposal(clause)) {
        continue
      }
      if (dateClauseAcceptsProposal(clause)) return true
      // Grounded-boundary packets are evaluated as a whole, not left-to-right.
      // An unqualified prohibited-date clause is unsafe whether it appears
      // before or after the exact earliest slot. This prevents wording and
      // clause-order changes ("an option", "on the table", "open", etc.)
      // from reopening a date the route classified as too soon.
      if (
        packetHasGroundedBoundary &&
        !dateClauseIsDemonstrablyNeutralProposalMention(clause, establishesGroundedBoundary)
      ) return true
    }
  }
  return false
}

// The primary transition verifier remains strict. This second gate exists only to
// prevent a semantically valid, model-authored reply from being discarded forever
// because a narrow wording detector missed the same safe move. It never authors
// visible text and it never relaxes the transactional checkpoints (form send,
// identity, four-field double-check, deposit, or payment hold).
function evaluateClosedTransitionLivenessFloor(input, packet, planOverride = null) {
  const plan = planOverride || deriveClosedTransitionPlan(input)
  const strict = evaluateClosedTransitionContract(input, packet, plan)
  if (strict.valid) return { ...strict, liveness_floor: false }
  if (!plan || !ACTION_SET.has(plan.action) || !packetHasVisibleReply(packet)) return strict
  // v162: a cost objection never falls open into a slot push; a stated budget never falls open without its fit line
  if (plan.action === ACTIONS.BUDGET_OBJECTION_HOLD) return strict
  if (plan.obligations.includes('acknowledge_budget_fit') && (!packetAcknowledgesBudgetFit(packet) || packetOffersDiscountOrDeal(packet))) return strict

  // Exact factual obligations cannot fail open.
  if (plan.obligations.includes('answer_exact_location') && !exactAddressPresent(packet)) return strict
  if (plan.obligations.includes('answer_model_rate') && !priceAnswerPresent(packet)) return strict
  if (plan.obligations.includes('answer_artist_style_scope') && !packetAnswersArtistStyleScope(input, packet)) return strict
  if (plan.obligations.includes('answer_tattoo_capability_scope') && !packetAnswersTattooCapabilityScope(input, packet)) return strict

  // No liveness fallback may invent or advance a transactional checkpoint.
  if (plan.action !== ACTIONS.SEND_FORM && packetSendsPreferredFormLink(packet)) return strict
  if (plan.action !== ACTIONS.DEPOSIT_HANDOFF && packetSendsDepositDetails(packet)) return strict
  if (plan.action !== ACTIONS.DOUBLE_CHECK && packetHasNamePhoneDateTimeDoubleCheck(packet)) return strict

  if (plan.action === ACTIONS.POST_FORM_AVAILABILITY) {
    if (plan.reason === 'form_handoff_coarse_day_constraint_requires_grounded_slot') return strict
    if (plan.reason === 'submitted_form_monthless_day_requires_month_clarification') return strict
    const groundedOutsideWindowProgress =
      plan.reason === 'submitted_form_date_counterproposal_outside_window' &&
      packetMakesGroundedOutsideWindowMove(packet, plan.fields)
    if (!packetMovesPastSubmittedForm(input, packet) && !groundedOutsideWindowProgress) return strict
    if (packetSendsPreferredFormLink(packet) || packetSendsDepositDetails(packet) || packetHasNamePhoneDateTimeDoubleCheck(packet)) return strict
    if (plan.reason === 'submitted_form_date_counterproposal_outside_window') {
      if (!groundedOutsideWindowProgress) return strict
      if (packetInventsThirdDate(packet, plan.fields)) return strict
      if (plan.fields?.last_offered_date && !packetKeepsLastOfferedSlot(packet, plan.fields)) return strict
      if (packetAcceptsOutOfWindowProposal(packet, plan.fields)) return strict
    }
    return {
      valid: true,
      reason: 'closed_transition_liveness_safe_adoption',
      instruction: '',
      lock_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
      plan,
      liveness_floor: true,
      strict_reason: strict.reason
    }
  }

  // A genuinely missing action/person/object antecedent must never become a
  // silent thread merely because the model used an unlisted but safe natural
  // clarification shape.  Missing attachments stay strict; those require an
  // explicit media request and unseen-content guard.
  if (
    plan.action === ACTIONS.RESOLVE_CONTEXT &&
    plan.reason !== 'missing_attachment' &&
    strict.reason === 'closed_transition_missing_referent_clarification_required'
  ) {
    const naturalClarification = plan.reason === 'unintelligible'
      ? packetClarifiesMissingContext(packet, plan.reason)
      : packetRequestsOpenMissingReferent(packet)
    if (
      naturalClarification &&
      !packetTriesScheduling(packet) &&
      !packetAsksFormPermission(packet) &&
      !packetSendsPreferredFormLink(packet) &&
      !packetHasNamePhoneDateTimeDoubleCheck(packet) &&
      !packetSendsDepositDetails(packet)
    ) {
      return {
        valid: true,
        reason: 'closed_transition_liveness_safe_context_clarification',
        instruction: '',
        lock_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
        plan,
        liveness_floor: true,
        strict_reason: strict.reason
      }
    }
  }

  // Plain social turns are non-transactional. If all bounded model passes already
  // cleared the full semantic harness and the only strict miss is the narrow
  // host-motion detector, preserve the safest model-authored reply instead of
  // converting a normal greeting into permanent silence. This cannot cold-push
  // tattoo, schedule, offer/send a form, double-check, or deposit.
  if (plan.action === ACTIONS.SOCIAL_CONTINUE && strict.reason === 'closed_transition_social_dead_end') {
    if (Array.isArray(plan.obligations) && plan.obligations.length > 0) return strict
    const biographyTurn = plan.reason === 'artist_biography_question_owns_social_turn'
    if (biographyTurn ? packetSolicitsClientTattoo(packet) : packetPushesTattooSubflow(packet)) return strict
    if (biographyTurn && !packetAnswersArtistBiography(packet)) return strict
    if (packetTriesScheduling(packet) || packetAsksFormPermission(packet)) return strict
    if (packetSendsPreferredFormLink(packet) || packetSendsDepositDetails(packet) || packetHasNamePhoneDateTimeDoubleCheck(packet)) return strict
    return {
      valid: true,
      reason: 'closed_transition_liveness_safe_social_adoption',
      instruction: '',
      lock_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
      plan,
      liveness_floor: true,
      strict_reason: strict.reason
    }
  }

  return strict
}

function asksForTime(packet) {
  const text = packetText(packet)
  return /\b(what|which|any|around)\b.{0,50}\btime\b/i.test(text) || /\btime\b.{0,50}\b(work|works|good|best|thinking)\b/i.test(text) || /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text)
}

function packetExplainsMinimumBookingTime(packet, fields = {}) {
  const text = packetText(packet)
  const mentionsOnePm = /\b1(?::00)?\s*p\.?m\.?\b/i.test(text)
  const statesFloor = (
    /\b(?:earliest|start|starting|from|after|later|before|earlier|minimum|soonest)\b/i.test(text) ||
    /\b(?:can|could)\s+(?:only\s+)?(?:do|start|book|take)\b/i.test(text)
  )
  const rejectsTooEarly = /\b(?:too\s+early|can(?:not|'?t)|couldn(?:'t| not)|won(?:'t| not)|not\s+available|don'?t\s+start|start\s+at)\b/i.test(text)
  const proposed = canonicalTimeKey(fields.proposed_time)
  const proposedRepeatedAsAccepted = proposed && packetText(packet)
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
    .some((clause) => (
      canonicalTimeKey(clause.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0] || '') === proposed &&
      /\b(?:works?|perfect|good|great|available|free|can\s+do|locked|booked|confirmed)\b/i.test(clause) &&
      !/\b(?:not|can(?:not|'?t)|couldn(?:'t| not)|won(?:'t| not)|too\s+early)\b/i.test(clause)
    ))
  return mentionsOnePm && statesFloor && rejectsTooEarly && !proposedRepeatedAsAccepted
}

function packetUsesDateAvailabilityWordForClock(packet, fields = {}) {
  const proposed = canonicalTimeKey(fields.proposed_time)
  if (!proposed) return false
  const proposedHour = Number(proposed.split(':')[0])
  return packetText(packet)
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
    .some((clause) => (
      /\bopen(?:ing)?\b/i.test(clause) &&
      (
        canonicalTimeKey(clause.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0] || '') === proposed ||
        new RegExp(`\\b${proposedHour}(?::00)?\\b`, 'i').test(clause)
      )
    ))
}

function asksForMissingIdentity(packet, fields) {
  const text = packetText(packet)
  const needsName = !String(fields?.name || '').trim()
  const needsPhone = !String(fields?.phone || '').trim()
  const asksName = /\bname\b/i.test(text)
  const asksPhone = /\b(phone|number)\b/i.test(text)
  if (needsName && !asksName) return false
  if (needsPhone && !asksPhone) return false
  if (!needsName && asksName && /\b(send|give|drop|what|need)\b/i.test(text)) return false
  if (!needsPhone && asksPhone && /\b(send|give|drop|what|need)\b/i.test(text)) return false
  return needsName || needsPhone
}

function normalizeComparableText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function canonicalPhoneKey(value) {
  return String(value || '').replace(/\D/g, '')
}

function canonicalTimeKey(value) {
  const compact = String(value || '').toLowerCase().replace(/[.\s]/g, '')
  const match = compact.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)$/)
  if (!match) return compact
  const hour = String(Number(match[1]))
  const minute = String(match[2] || '00').padStart(2, '0')
  return `${hour}:${minute}${match[3]}`
}

function doubleCheckContainsExactFields(packet, fields) {
  const lines = packetText(packet).split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const labeledValues = {
    name: '',
    phone: '',
    date: '',
    time: ''
  }

  for (const line of lines) {
    let match = line.match(/^name\s*:\s*(.+)$/i)
    if (match) {
      labeledValues.name = match[1].trim()
      continue
    }
    match = line.match(/^phone(?:\s+number)?\s*:\s*(.+)$/i)
    if (match) {
      labeledValues.phone = match[1].trim()
      continue
    }
    match = line.match(/^appointment\s+date\s*:\s*(.+)$/i)
    if (match) {
      labeledValues.date = match[1].trim()
      continue
    }
    match = line.match(/^time\s*:\s*(.+)$/i)
    if (match) labeledValues.time = match[1].trim()
  }

  const expectedDateKey = canonicalDateKey(fields?.date)
  const visibleDateKey = canonicalDateKey(labeledValues.date)
  const dateMatches = expectedDateKey && visibleDateKey
    ? expectedDateKey === visibleDateKey
    : normalizeComparableText(labeledValues.date) === normalizeComparableText(fields?.date)

  return Boolean(
    normalizeComparableText(labeledValues.name) &&
    normalizeComparableText(labeledValues.name) === normalizeComparableText(fields?.name) &&
    canonicalPhoneKey(labeledValues.phone) &&
    canonicalPhoneKey(labeledValues.phone) === canonicalPhoneKey(fields?.phone) &&
    dateMatches &&
    canonicalTimeKey(labeledValues.time) &&
    canonicalTimeKey(labeledValues.time) === canonicalTimeKey(fields?.time)
  )
}

function packetClarifiesPendingFormPermission(packet) {
  const raw = packetText(packet)
  const uncertainty = /\b(did you mean|were you saying|are you saying|do you mean|heard (?:that|you) wrong|read that wrong|caught that wrong|didn.?t catch|not sure i (?:heard|caught|got)|say that again|what did you mean)\b/i.test(raw)
  const openObject = /\b(form|application|link|send it|send that|send (?:the )?form|send (?:the )?link)\b/i.test(raw)
  return uncertainty && openObject && /[?？]/.test(raw)
}

const MONTH_NUMBER = Object.freeze({
  january: '01', jan: '01',
  february: '02', feb: '02',
  march: '03', mar: '03',
  april: '04', apr: '04',
  may: '05',
  june: '06', jun: '06',
  july: '07', jul: '07',
  august: '08', aug: '08',
  september: '09', sep: '09', sept: '09',
  october: '10', oct: '10',
  november: '11', nov: '11',
  december: '12', dec: '12'
})

function canonicalDateKey(value) {
  const text = String(value || '').toLowerCase()
  const iso = text.match(/\b\d{4}-(\d{2})-(\d{2})\b/)
  if (iso) {
    const month = Number(iso[1])
    const day = Number(iso[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  let match = text.match(/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  if (!match) {
    match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/i)
    if (!match) return ''
    return `${MONTH_NUMBER[String(match[2]).toLowerCase()] || ''}-${String(Number(match[1])).padStart(2, '0')}`
  }
  return `${MONTH_NUMBER[String(match[1]).toLowerCase()] || ''}-${String(Number(match[2])).padStart(2, '0')}`
}

function explicitDateKeys(value) {
  const text = String(value || '').toLowerCase()
  const keys = []
  const patterns = [
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi,
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/gi
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const key = canonicalDateKey(match[0])
      if (key && !keys.includes(key)) keys.push(key)
    }
  }
  return keys
}

function maskTargetDateInClause(value, targetKey) {
  let text = String(value || '')
  const patterns = [
    /\b(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+\d{1,2}(?:st|nd|rd|th)?\b/gi,
    /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\b/gi
  ]
  for (const pattern of patterns) {
    text = text.replace(pattern, (match) => canonicalDateKey(match) === targetKey
      ? ' __target_date__ '
      : match)
  }
  return text.replace(/\s+/g, ' ').trim()
}

function clientTurnExplicitlyExcludesDate(input, targetKey) {
  if (!targetKey) return false
  const clauses = dateDecisionClauses(liveText(input))
  for (const clause of clauses) {
    if (!explicitDateKeys(clause).includes(targetKey)) continue
    const masked = maskTargetDateInClause(clause, targetKey)
      .replace(/[\u2018\u2019]/g, "'")
      .toLowerCase()
    if (
      /\b(?:cannot|can'?t|cant|won'?t|will\s+not|am\s+not\s+able\s+to|unable\s+to)\s+(?:do|make|book|take|come|attend|manage)\b.{0,40}__target_date__/.test(masked) ||
      /__target_date__.{0,40}\b(?:does(?:n't|\s+not)|won'?t|will\s+not|cannot|can'?t)\s+work\b/.test(masked) ||
      /\b(?:not|isn'?t|is\s+not)\s+(?:available|free|open)\b.{0,32}__target_date__/.test(masked) ||
      /__target_date__.{0,32}\b(?:isn'?t|is\s+not)\s+(?:available|free|open|good)\b/.test(masked) ||
      /(?:^|[,;:]\s*)\s*(?:not|no|except|anything\s+(?:but|except))\s+__target_date__\b/.test(masked) ||
      /\b(?:anything|any\s+(?:date|day|time))\s+(?:but|except)\s+__target_date__\b/.test(masked)
    ) return true

    const rangeMatch = /\b(?:after|later\s+than|before|earlier\s+than)\s+__target_date__\b/.exec(masked)
    if (rangeMatch) {
      const prefix = masked.slice(0, rangeMatch.index)
      // "not after" and "no later than" include the boundary; unnegated
      // after/before language excludes the named day itself.
      if (!/\b(?:not|no)\s*$/.test(prefix)) return true
    }
  }
  return false
}

function packetCommittedConcreteDateKeys(packet) {
  const clauses = packetText(packet)
    .replace(/[\u2018\u2019]/g, "'")
    .split(/(?:\r?\n)+|(?<=[.!;])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const committed = new Set()
  for (const clause of clauses) {
    const keys = explicitDateKeys(clause)
    if (keys.length !== 1) continue
    if (/^\s*(?:would|could|can|does|do|is|are|what|which|how)\b/i.test(clause) && /[?？]/.test(clause)) continue
    if (/\b(?:option|alternative|earliest|soonest|first\s+(?:day|date|time|opening|slot|appointment)|next\s+(?:day|date|time|opening|slot|appointment)|unavailable|not\s+open|booked\s+(?:up\s+)?until|too\s+(?:soon|early))\b/i.test(clause)) continue
    const commits = (
      /\b(?:works?|is\s+(?:good|fine|perfect|confirmed|locked(?:\s+in)?|booked|set))\b/i.test(clause) ||
      /\blet'?s\s+(?:do|book|schedule|lock|set)\b/i.test(clause) ||
      /\b(?:i|we)\s+can\s+(?:book|schedule|do|take|fit)\b/i.test(clause) ||
      /\b(?:got|have|put|booked|set)\s+you\b.{0,28}\b(?:for|on)\b/i.test(clause) ||
      (/\bperfect\b/i.test(clause) && !/\b(?:not|isn'?t|is\s+not)\b.{0,12}\bperfect\b/i.test(clause))
    )
    if (commits) committed.add(keys[0])
  }
  return committed
}

function packetRejectsLegalClientDate(packet, fields = {}) {
  if (String(fields.date_status || '') !== 'legal') return false
  const proposedKey = canonicalDateKey(fields.proposed_date || fields.date)
  if (!proposedKey) return false
  const text = packetText(packet)
  const proposedDay = Number(proposedKey.slice(3))
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean)
  for (const sentence of sentences) {
    const mentionsProposal =
      explicitDateKeys(sentence).includes(proposedKey) ||
      new RegExp(`\\b(?:the\\s+)?${proposedDay}(?:st|nd|rd|th)?\\b`, 'i').test(sentence) ||
      /\b(?:that|it|that date|that day)\b/i.test(sentence)
    if (!mentionsProposal) continue
    if (
      /\b(?:can(?:not|'?t)|won(?:not|'?t)|doesn(?:'t| not)|do\s+not|don'?t|not)\b.{0,45}\b(?:work|available|open|possible|doable|make|fit|book|do)\b/i.test(sentence) ||
      /\b(?:not|isn(?:'t| not)|is\s+not)\s+(?:available|open|possible|doable)\b/i.test(sentence) ||
      /\b(?:too\s+(?:soon|early|late|far)|earliest\s+i\s+(?:can|have)|already\s+(?:booked|taken)|no\s+(?:opening|availability))\b/i.test(sentence)
    ) return true
  }
  return false
}

function packetReplacesLegalClientDate(packet, fields = {}) {
  if (String(fields.date_status || '') !== 'legal') return false
  const proposedKey = canonicalDateKey(fields.proposed_date || fields.date)
  if (!proposedKey) return false
  return explicitDateKeys(packetText(packet)).some((key) => key !== proposedKey)
}

function groundedOutsideWindowAlternativeKeys(fields = {}) {
  const lastOffered = canonicalDateKey(fields.last_offered_date)
  if (lastOffered) return new Set([lastOffered])

  const values = [
    fields.minimum_booking_date,
    fields.earliest_booking_option,
    ...(Array.isArray(fields.close_booking_options) ? fields.close_booking_options : [])
  ]
  return new Set(values.map(canonicalDateKey).filter(Boolean))
}

function packetRejectsOutOfWindowProposal(packet, fields = {}) {
  const text = packetText(packet)
  const proposedKey = canonicalDateKey(fields.proposed_date)
  if (!text) return false

  if (proposedKey) {
    const proposedDay = Number(proposedKey.slice(3))
    let activeDateKey = proposedKey
    for (const clause of dateDecisionClauses(text)) {
      const relation = dateClauseProposalRelation(clause, proposedKey, proposedDay, activeDateKey)
      activeDateKey = relation.activeDateKey
      if (relation.refersToProposal && dateClauseRejectsProposal(clause)) return true
    }
  }

  // A natural reply does not always repeat the client's rejected date.  An
  // exact, state-grounded alternative can establish the same boundary by
  // saying it is the first/soonest opening, or that the calendar is booked
  // until that slot.  Keep this inference narrow: the boundary language and
  // a grounded alternative date must occur in the same clause.  The outer
  // contract still enforces the exact saved time, forbids accepting the
  // too-soon proposal, and rejects invented or multiple alternatives. This
  // boundary is also the canonical rejection proof for relative proposals such
  // as tomorrow whose calendar identity lives in fields.date_iso rather than in
  // a month-name phrase.
  for (const clause of dateDecisionClauses(text)) {
    if (dateClauseEstablishesGroundedEarliestBoundary(clause, fields)) return true
  }
  return false
}

function packetOffersGroundedOutsideWindowAlternative(packet, fields = {}) {
  const grounded = groundedOutsideWindowAlternativeKeys(fields)
  if (!grounded.size) return false
  return explicitDateKeys(packetText(packet)).some((key) => grounded.has(key))
}

function packetMakesGroundedOutsideWindowMove(packet, fields = {}) {
  return (
    packetRejectsOutOfWindowProposal(packet, fields) &&
    packetOffersGroundedOutsideWindowAlternative(packet, fields) &&
    !packetInventsThirdDate(packet, fields) &&
    !packetOffersMultipleReplacementDates(packet, fields) &&
    asksForDateOrAvailability(packet)
  )
}

function packetKeepsLastOfferedSlot(packet, fields = {}) {
  const text = packetText(packet)
  const targetDateKey = canonicalDateKey(fields.last_offered_date)
  if (!targetDateKey) return false
  const targetDay = Number(targetDateKey.slice(3))
  const dateVisible = explicitDateKeys(text).includes(targetDateKey) || new RegExp(`\\b(?:the\\s+)?${targetDay}(?:st|nd|rd|th)?\\b`, 'i').test(text)
  const targetTime = String(fields.last_offered_time || '').toLowerCase().replace(/[^0-9apm]/g, '')
  const packetTimes = Array.from(text.toLowerCase().matchAll(/\b\d{1,2}(?::\d{2})?\s*(?:a\.m\.?|p\.m\.?|am|pm)(?![a-z0-9_])/g))
    .map((match) => String(match[0]).replace(/[^0-9apm]/g, ''))
  return dateVisible && (!targetTime || packetTimes.includes(targetTime))
}

function packetInventsThirdDate(packet, fields = {}) {
  const allowed = new Set([canonicalDateKey(fields.proposed_date)].filter(Boolean))
  for (const key of groundedOutsideWindowAlternativeKeys(fields)) allowed.add(key)
  return explicitDateKeys(packetText(packet)).some((key) => !allowed.has(key))
}

function packetOffersMultipleReplacementDates(packet, fields = {}) {
  const proposed = canonicalDateKey(fields.proposed_date)
  const alternatives = explicitDateKeys(packetText(packet)).filter((key) => key !== proposed)
  return new Set(alternatives).size > 1
}

function evaluateClosedTransitionContract(input, packet, planOverride = null) {
  const plan = planOverride || deriveClosedTransitionPlan(input)
  if (!plan || !ACTION_SET.has(plan.action)) return invalid('closed_transition_unclassified', plan)
  if (!packetHasVisibleReply(packet)) {
    return invalid('closed_transition_visible_reply_required', plan, 'Produce at least one non-empty visible DM bubble.')
  }

  if (plan.obligations.includes('answer_exact_location') && !exactAddressPresent(packet)) {
    return invalid('closed_transition_location_missing', plan, `Answer the location directly with ${EXACT_ADDRESS}.`)
  }
  if (modelRateMentionCount(packetText(packet)) > 1) {
    return invalid('closed_transition_rate_repeated_within_packet', plan, 'The rate amount may appear only once across all reply bubbles.')
  }
  if (modelRateAlreadyDisclosed(input) && packetStatesModelRate(packet)) {
    return invalid(
      'closed_transition_rate_restated_after_disclosure',
      plan,
      'The rate was already given earlier in this thread; the number is spoken at most once. Answer from memory without any amount or hourly wording: it is the model rate you mentioned earlier and nothing changed, then continue the current step.'
    )
  }
  if (plan.obligations.includes('acknowledge_rate_already_given') && !packetAcknowledgesRateWithoutNumber(packet)) {
    return invalid('closed_transition_rate_memory_answer_missing', plan, 'Answer the price question: it is the same model rate mentioned earlier. No amount, hourly wording, free offer, or unrelated acknowledgement. Then address the current booking step.')
  }
  if (plan.obligations.includes('answer_model_rate') && !priceAnswerPresent(packet)) {
    return invalid(
      'closed_transition_rate_missing',
      plan,
      'Use this internal fact object: {currency:USD,amount:150,unit:HOUR,rate_type:MODEL_DISCOUNT,eligibility_code:ARTIST_VISUAL_LANGUAGE_REQUIRED}. The visible answer must carry all three facts: it is the discounted model rate, it is $150 per hour, and it applies when the finished piece remains in the artist’s visual language. These are facts, not a sentence template. Author fresh human wording from the live question; never serialize the object, copy its field order, defend the value, or ask why they are curious.'
    )
  }
  if (plan.obligations.includes('acknowledge_budget_fit')) {
    if (packetOffersDiscountOrDeal(packet)) return invalid('closed_transition_budget_fit_cannot_discount', plan, 'The client named a budget. Never offer a discount, deal, payment plan or lower rate; the rate is fixed. Say the number is workable and that you shape the piece (size, detail, session length) around it, then continue the current step.')
    if (!packetAcknowledgesBudgetFit(packet)) return invalid('closed_transition_budget_fit_missing', plan, 'The client answered your budget question with a number. First say that range is workable and that you will shape the piece around it (no amount, no discount), then continue the current step.')
  }
  if (plan.obligations.includes('answer_artist_style_scope') && !packetAnswersArtistStyleScope(input, packet)) {
    return invalid(
      'closed_transition_artist_style_scope_missing',
      plan,
      'Answer the direct style-scope question before the next move: finished work stays in the artist’s own style, while references and custom ideas can be adapted into that style.'
    )
  }
  if (plan.obligations.includes('answer_tattoo_capability_scope') && !packetAnswersTattooCapabilityScope(input, packet)) {
    return invalid(
      'closed_transition_tattoo_capability_scope_missing',
      plan,
      'Answer the exact palette / technique / style capability question directly, then leave one design-subject or reference move. Do not treat the capability question as the client’s concrete design.'
    )
  }

  const groundedDayConstraintMove = Boolean(
    plan.action === ACTIONS.POST_FORM_AVAILABILITY &&
    plan.reason === 'form_handoff_coarse_day_constraint_requires_grounded_slot'
  )
  const authoritativeDateKey = canonicalDateKey(
    plan.fields?.date ||
    (groundedDayConstraintMove ? plan.fields?.last_offered_date : '')
  )
  const visibleDateKeys = explicitDateKeys(packetText(packet))
  const committedDateKeys = BOOKING_DATE_AUTHORITY_ACTIONS.has(plan.action)
    ? packetCommittedConcreteDateKeys(packet)
    : new Set()
  const existingLegalDateVerifierOwnsMismatch = Boolean(
    plan.action === ACTIONS.POST_FORM_TIME &&
    String(plan.fields?.date_status || '') === 'legal'
  )
  const groundedOutsideWindowMove = Boolean(
    plan.action === ACTIONS.POST_FORM_AVAILABILITY &&
    plan.reason === 'submitted_form_date_counterproposal_outside_window'
  )
  if (
    plan.action === ACTIONS.POST_FORM_TIME &&
    authoritativeDateKey &&
    clientTurnExplicitlyExcludesDate(input, authoritativeDateKey)
  ) {
    return invalid(
      'closed_transition_client_rejected_date_cannot_be_adopted',
      plan,
      'The client explicitly excluded or rejected this date. Do not confirm it or advance to its time; ask for a different exact date.'
    )
  }
  if (
    plan.action === ACTIONS.POST_FORM_TIME &&
    authoritativeDateKey &&
    !existingLegalDateVerifierOwnsMismatch &&
    visibleDateKeys.some((key) => key !== authoritativeDateKey)
  ) {
    return invalid(
      'closed_transition_visible_date_state_mismatch',
      plan,
      'The visible reply introduced a date that does not match the controller-owned requested date. Keep the exact authoritative date and ask or offer only the missing time.'
    )
  }
  if (BOOKING_DATE_AUTHORITY_ACTIONS.has(plan.action)) {
    if (
      committedDateKeys.size > 0 &&
      !authoritativeDateKey &&
      !groundedOutsideWindowMove
    ) {
      return invalid(
        'closed_transition_visible_date_state_authority_missing',
        plan,
        'Do not visibly accept or commit a concrete appointment date until that exact date exists in controller state.'
      )
    }
    if (
      authoritativeDateKey &&
      !existingLegalDateVerifierOwnsMismatch &&
      [...committedDateKeys].some((key) => key !== authoritativeDateKey)
    ) {
      return invalid(
        'closed_transition_visible_date_state_mismatch',
        plan,
        'A visibly accepted or committed date must exactly match the controller-owned requested date.'
      )
    }
  }

  if (plan.reason === 'open_form_offer_received_nonconsent_size_or_placement_detail') {
    if (packetSendsPreferredFormLink(packet)) {
      return invalid('closed_transition_nonconsent_detail_cannot_send_form', plan, 'The client added a size or placement detail but did not consent to receive the form. Acknowledge the detail without sending the URL.')
    }
    if (packetAsksFormPermission(packet)) {
      return invalid('closed_transition_nonconsent_detail_cannot_repeat_form_offer', plan, 'The form-permission question is already open. Do not ask it a second time; acknowledge the detail and leave the existing question pending.')
    }
    if (packetTriesScheduling(packet)) {
      return invalid('closed_transition_nonconsent_detail_cannot_skip_to_calendar', plan, 'Do not turn a size or placement detail into scheduling before the open form permission is answered.')
    }
  }

  switch (plan.action) {
    case ACTIONS.DEPOSIT_HOLD: {
      const text = packetText(packet)
      const hold = /(hasn.?t|haven.?t|not|didn.?t|don.?t|no)\b.{0,55}(come through|arriv|receiv|land|show|pop|hit|reflect|through yet|on my (side|end))/i.test(text) && /\b(check|checking|confirm|once it|when it|lands)\b/i.test(text)
      if (!hold) return invalid('closed_transition_deposit_hold_missing', plan, 'Acknowledge that the deposit has not arrived yet and that you are checking; do not restart booking.')
      break
    }
    case ACTIONS.DEPOSIT_PENDING_CONTINUE:
      if (packetSendsDepositDetails(packet)) return invalid('closed_transition_deposit_repeat_forbidden', plan, 'Deposit details were already sent. Do not send them again unless a future explicit resend route authorizes it.')
      if (packetHasNamePhoneDateTimeDoubleCheck(packet) || packetRequestsSecondDoubleCheckConfirmation(packet)) return invalid('closed_transition_double_check_after_deposit_forbidden', plan, 'The booking checkpoint is complete. Do not repeat it after deposit handoff.')
      if (packetTriesScheduling(packet) || packetSendsPreferredFormLink(packet)) return invalid('closed_transition_booking_backtrack_after_deposit', plan, 'Do not reopen form, date, or time after deposit handoff.')
      break
    case ACTIONS.DEPOSIT_HANDOFF:
      if (!packetSendsDepositDetails(packet)) return invalid('closed_transition_deposit_handoff_missing', plan, 'Send the $100 deposit and Zelle handoff immediately after the confirmed four-field double-check.')
      if (packetRequestsSecondDoubleCheckConfirmation(packet)) return invalid('closed_transition_second_double_check_forbidden', plan, 'Do not ask for a second confirmation after the four-field double-check was confirmed.')
      if (packetReopensDateLoopAfterDoubleCheck(packet)) return invalid('closed_transition_date_loop_after_confirm_forbidden', plan, 'Do not reopen date or time after confirmation; move directly to deposit.')
      break
    case ACTIONS.DOUBLE_CHECK:
      if (!packetHasNamePhoneDateTimeDoubleCheck(packet) || !doubleCheckContainsExactFields(packet, plan.fields)) {
        return invalid('closed_transition_four_field_double_check_missing', plan, 'Show Name, Phone Number, Appointment date, and Time on separate lines with their exact known values, then ask for one double-check.')
      }
      if (packetSendsDepositDetails(packet)) return invalid('closed_transition_deposit_before_confirmation_forbidden', plan, 'Wait for the client to confirm the four-field double-check before sending deposit details.')
      break
    case ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION:
      if (packetHasNamePhoneDateTimeDoubleCheck(packet) || packetRequestsSecondDoubleCheckConfirmation(packet)) return invalid('closed_transition_duplicate_double_check_forbidden', plan, 'The four-field double-check was already sent. Do not repeat it.')
      if (packetSendsDepositDetails(packet)) return invalid('closed_transition_deposit_without_confirmation_forbidden', plan, 'Do not send deposit details until the existing double-check receives a clear confirmation.')
      if (packetTriesScheduling(packet) || packetSendsPreferredFormLink(packet)) return invalid('closed_transition_backtrack_while_awaiting_double_check', plan, 'Do not reopen form, date, or time while the existing double-check awaits confirmation.')
      if (!packetHasHostLeadMotion(input, packet)) return invalid('closed_transition_await_double_check_dead_end', plan, 'Reply naturally and leave one answerable clarification path without repeating the four-field checkpoint.')
      break
    case ACTIONS.SEND_FORM: {
      const count = countOccurrences(packetText(packet), PREFERRED_FORM_LINK)
      if (!packetSendsPreferredFormLink(packet) || count !== 1) return invalid('closed_transition_form_link_exactly_once_required', plan, `Send ${PREFERRED_FORM_LINK} exactly once in this turn.`)
      if (packetAsksFormPermission(packet)) return invalid('closed_transition_form_offer_after_link_forbidden', plan, 'The client already consented and the form link is visible. Do not ask or offer to send the form again in the same reply.')
      if (!asksForDateOrAvailability(packet)) return invalid('closed_transition_form_availability_tail_missing', plan, 'After the form link, ask for availability or a couple of dates in this DM.')
      break
    }
    case ACTIONS.CLARIFY_FORM_PERMISSION:
      if (packetSendsPreferredFormLink(packet)) return invalid('closed_transition_ambiguous_voice_cannot_authorize_form_send', plan, 'The voice reply was not understood. Do not send the form until the client confirms the pending form-permission question.')
      if (!packetClarifiesPendingFormPermission(packet)) return invalid('closed_transition_form_permission_clarification_missing', plan, 'Say that the short voice reply may have been heard incorrectly and ask whether they meant for you to send the form. Do not reinterpret the unknown word as design intent.')
      if (/\b(part of|idea|design|reference|vibe|placement|size|shorting|shortening)\b/i.test(packetText(packet))) return invalid('closed_transition_ambiguous_voice_design_backtrack', plan, 'Do not turn an incoherent reply to the form question into a new design question.')
      break
    case ACTIONS.RESOLVE_CONTEXT:
      if (plan.reason === 'verifier_conflict_booking_day_or_size') {
        if (!packetClarifiesBookingDateOrSizeConflict({ ...input, control_transition_contract: plan }, packet)) {
          return invalid(
            'closed_transition_booking_day_or_size_disambiguation_required',
            plan,
            `The verifier rejected a one-sided interpretation of ${plan.fields?.ambiguous_value || 'the number'}. Ask whether it means the appointment date or the tattoo size; do not choose either meaning for the client.`
          )
        }
      } else if (plan.reason === 'missing_attachment') {
        if (!packetRequestsReferenceMedia(packet)) return invalid('closed_transition_missing_attachment_request_required', plan, 'The latest turn depends on media that is not authoritative yet. Ask naturally for the actual photo, post, image, screenshot, clip, or reference.')
        if (packetAssumesUnseenReference(packet)) return invalid('closed_transition_missing_attachment_assumption_forbidden', plan, 'Do not claim to understand, praise, evaluate, describe, or probe content that is not visible. A later request for the attachment does not cure an earlier false-understanding phrase.')
      } else if (packetAssumesUnseenReference(packet)) {
        return invalid('closed_transition_missing_context_assumption_forbidden', plan, 'Do not claim to understand, approve, or evaluate an object or direction that has not been identified yet.')
      } else if (!packetClarifiesMissingContext(packet, plan.reason)) {
        return invalid('closed_transition_missing_referent_clarification_required', plan, 'Ask one short, open, natural question that requires the client to identify the missing person, object, place, direction, or action. Do not offer unresolved placeholder choices or guess the referent.')
      }
      if (
        (plan.reason !== 'verifier_conflict_booking_day_or_size' && (
          packetPushesTattooSubflow(packet) ||
          packetTriesScheduling(packet)
        )) ||
        packetAsksFormPermission(packet) ||
        packetSendsPreferredFormLink(packet) ||
        packetHasNamePhoneDateTimeDoubleCheck(packet) ||
        packetSendsDepositDetails(packet)
      ) return invalid('closed_transition_context_gap_cannot_advance_funnel', plan, 'Resolve the missing context before changing booking stage or advancing the funnel.')
      break
    case ACTIONS.POST_FORM_AVAILABILITY:
      if (plan.reason === 'double_check_date_revision_unresolved') {
        if (
          packetHasNamePhoneDateTimeDoubleCheck(packet) ||
          packetSendsDepositDetails(packet) ||
          !/[?？]/.test(packetText(packet)) ||
          !/\b(?:date|day|days|when|which\s+day)\b/i.test(packetText(packet))
        ) return invalid('closed_transition_date_revision_ask_missing', plan, 'The client wants to change the checkpoint date but the new date is not resolved. Ask which exact date to put down in one short question; do not repeat the four-field block or send deposit details.')
        break
      }
      {
        const echoedResidue = packetEchoesUngroundedSubmissionResidue(input, packet)
        if (echoedResidue.length > 0) {
          return invalid(
            'closed_transition_ungrounded_submission_residue_echo_forbidden',
            plan,
            'The submission fact is clear, but extra name-like or ASR-damaged words are not grounded. Do not repeat them as a person, form name, design, or object. Acknowledge only the submitted form and continue to the missing booking checkpoint.'
          )
        }
      }
      if (plan.reason === 'submitted_form_monthless_day_requires_month_clarification') {
        if (!packetClarifiesMonthlessBookingDay(packet, plan.fields)) {
          return invalid('closed_transition_monthless_day_requires_month', plan, `The client proposed the ${plan.fields?.monthless_day || 'calendar day'} in answer to the open date question. Keep that day anchored and ask which month they mean. The month is still unknown, so do not say the day sounds good, sounds like a plan, works, is available, is possible, is perfect, or that you can do it. Do not treat it as an unrelated number or invent a month.`)
        }
        if (
          packetSendsPreferredFormLink(packet) ||
          packetSendsDepositDetails(packet) ||
          packetHasNamePhoneDateTimeDoubleCheck(packet)
        ) return invalid('closed_transition_monthless_day_cannot_advance_checkpoint', plan, 'Resolve the missing month before form replay, double-check, or deposit.')
        break
      }
      if (plan.reason === 'submitted_form_date_requires_clarification') {
        if (!packetClarifiesAmbiguousBookingDate(packet, plan.fields)) {
          return invalid(
            'closed_transition_ambiguous_date_clarification_required',
            plan,
            'The client date is incomplete, numerically ambiguous, or invalid. Ask only for the missing month/date meaning. Do not invent a month, confirm availability, replace it with another date, resend the form, or advance to time.'
          )
        }
        if (
          packetSendsPreferredFormLink(packet) ||
          packetSendsDepositDetails(packet) ||
          packetHasNamePhoneDateTimeDoubleCheck(packet)
        ) return invalid('closed_transition_ambiguous_date_cannot_advance_checkpoint', plan, 'Resolve the date before form replay, double-check, or deposit.')
        break
      }
      {
        const priorAssistantPacket = latestAssistantPacketText(input)
        const currentPacketText = packetText(packet)
        if (
          liveTurnProvidesAvailabilityContent(input) &&
          textAcknowledgesFormReceipt(priorAssistantPacket) &&
          textAcknowledgesFormReceipt(currentPacketText)
        ) {
          return invalid('closed_transition_duplicate_form_receipt_ack_forbidden', plan, 'The form receipt was already acknowledged. Respond to the client’s availability/date content without replaying that checkpoint.')
        }
        if (
          liveTurnProvidesAvailabilityContent(input) &&
          textAsksGenericAvailability(priorAssistantPacket) &&
          textAsksGenericAvailability(currentPacketText) &&
          !packetAddsConcreteCalendarMove(packet)
        ) {
          return invalid('closed_transition_repeated_availability_function_forbidden', plan, 'The client answered the open availability question. Do not ask the same generic question again; resolve their answer or offer/ask the next specific calendar dimension.')
        }
      }
      {
        const standardDateProgress =
          packetMovesPastSubmittedForm(input, packet) &&
          asksForDateOrAvailability(packet)
        const groundedOutsideWindowProgress =
          plan.reason === 'submitted_form_date_counterproposal_outside_window' &&
          packetMakesGroundedOutsideWindowMove(packet, plan.fields)
        if (!standardDateProgress && !groundedOutsideWindowProgress) {
          return invalid('closed_transition_post_form_date_progress_missing', plan, 'The form is submitted. Resolve the client’s calendar answer and leave one grounded, answerable date move; never wait for the form again.')
        }
      }
      if (plan.reason === 'form_handoff_coarse_day_constraint_requires_grounded_slot') {
        if (packetInventsThirdDate(packet, plan.fields)) {
          return invalid('closed_transition_day_constraint_ungrounded_date_forbidden', plan, 'Use only the single nearest date grounded by the client day constraint and the policy calendar.')
        }
        if (packetOffersMultipleReplacementDates(packet, plan.fields)) {
          return invalid('closed_transition_day_constraint_multiple_dates_forbidden', plan, 'The client narrowed the schedule by day type. Offer exactly one nearest grounded date so the next short answer is unambiguous.')
        }
        if (!packetKeepsLastOfferedSlot(packet, plan.fields)) {
          return invalid('closed_transition_day_constraint_grounded_slot_missing', plan, `Offer exactly ${plan.fields?.last_offered_date || 'the grounded date'} at ${plan.fields?.last_offered_time || '2pm'} and ask whether it works. Do not claim the client already accepted it.`)
        }
      }
      if (plan.reason === 'submitted_form_date_counterproposal_outside_window') {
        if (packetAcceptsOutOfWindowProposal(packet, plan.fields)) {
          return invalid('closed_transition_out_of_window_date_acceptance_forbidden', plan, 'The client proposal is outside the allowed booking window. Do not accept it; preserve the closest valid offered alternative.')
        }
        if (packetInventsThirdDate(packet, plan.fields)) {
          return invalid('closed_transition_unanchored_date_alternative_forbidden', plan, 'Do not invent a third appointment date. Respond to the client proposal while preserving the exact last offered alternative.')
        }
        if (packetOffersMultipleReplacementDates(packet, plan.fields)) {
          return invalid('closed_transition_multiple_date_alternatives_forbidden', plan, 'Offer exactly one grounded replacement date. Multiple simultaneous choices make a short acceptance ambiguous and corrupt the next booking state.')
        }
        if (plan.fields?.last_offered_date && !packetKeepsLastOfferedSlot(packet, plan.fields)) {
          return invalid('closed_transition_last_offered_alternative_missing', plan, 'Keep the exact last offered date and time in play; do not silently replace it with a new slot.')
        }
        if (!packetMakesGroundedOutsideWindowMove(packet, plan.fields)) {
          return invalid('closed_transition_grounded_out_of_window_move_required', plan, 'Respond directly to the out-of-window proposal, explain the timing boundary naturally, and ask about a legal date already grounded in the state calendar. Do not invent a new date.')
        }
      }
      break
    case ACTIONS.POST_FORM_TIME:
      if (packetRejectsLegalClientDate(packet, plan.fields)) {
        return invalid('closed_transition_legal_date_rejection_forbidden', plan, 'The client proposed a fully specified date on or after the one-week minimum. That date is valid and available. Do not invent a closure or availability restriction; accept it and ask or offer the missing time.')
      }
      if (packetReplacesLegalClientDate(packet, plan.fields)) {
        return invalid('closed_transition_legal_date_replacement_forbidden', plan, 'The client’s legal explicit date owns the turn. Do not replace it with a prior offer or a newly invented alternative; keep that date and move only to time.')
      }
      if (packetHasNamePhoneDateTimeDoubleCheck(packet)) return invalid('closed_transition_time_cannot_skip_to_double_check', plan, 'The client supplied a date but has not accepted a time. Ask or offer the missing appointment time first; do not synthesize 2pm or run the four-field double-check.')
      if (packetUsesDateAvailabilityWordForClock(packet, plan.fields)) return invalid('closed_transition_clock_cannot_use_date_open_wording', plan, 'Open describes date or slot availability. For a clock time before the daily floor say naturally that it is too early or before the start time and give a legal time move.')
      if (
        plan.reason === 'submitted_form_time_before_minimum' &&
        !packetExplainsMinimumBookingTime(packet, plan.fields)
      ) return invalid('closed_transition_minimum_time_explanation_missing', plan, 'The client proposed a time before 1pm. Reject only that time, state that appointments begin at 1pm or later, and ask for a legal time without changing the date or form state.')
      if (plan.reason === 'double_check_time_revision_unresolved') {
        if (!/[?？]/.test(packetText(packet)) || !/\b(?:time|am|pm|\d{1,2}(?::\d{2})?\s*(?:am|pm)|o'?clock|earlier|later)\b/i.test(packetText(packet))) return invalid('closed_transition_time_revision_ask_missing', plan, 'The client wants to change the checkpoint time but the new time is not resolved. Ask which exact time to put down, naming the options when they gave two; do not repeat the four-field block.')
        break
      }
      if (!packetMovesPastSubmittedForm(input, packet) || !asksForTime(packet)) return invalid('closed_transition_post_form_time_progress_missing', plan, 'The date is known. Ask or offer the missing appointment time; never return to design or form.')
      break
    case ACTIONS.POST_FORM_IDENTITY:
      if (plan.reason === 'double_check_identity_revision_unresolved') {
        if (
          packetHasNamePhoneDateTimeDoubleCheck(packet) ||
          packetSendsDepositDetails(packet) ||
          !/[?？]/.test(packetText(packet)) ||
          !/\b(?:name|number|phone)\b/i.test(packetText(packet))
        ) return invalid('closed_transition_identity_revision_ask_missing', plan, 'The client wants to change the name or number on the checkpoint. Ask which name or number to put down instead, in one short question; do not repeat the four-field block or send deposit details.')
        break
      }
      if (!asksForMissingIdentity(packet, plan.fields)) return invalid('closed_transition_post_form_identity_missing', plan, 'Ask only for the missing name and/or phone used on the submitted form; do not re-ask known fields.')
      break
    case ACTIONS.ACCEPTED_SLOT_PROGRESS:
      if (packetBacktracksAfterAcceptedSlot(packet)) return invalid('closed_transition_accepted_slot_backtrack', plan, 'The slot was accepted. Do not return to design, placement, size, or availability.')
      if (!packetMovesToFormIdentityAfterAcceptedSlot(packet)) return invalid('closed_transition_accepted_slot_no_progress', plan, 'Confirm the accepted slot and move to form submission or missing identity fields.')
      break
    case ACTIONS.KEEP_CONSULTATION_IN_DM:
      if (packetCommitsSeparateInPersonConsultation(packet) || !packetKeepsTattooConsultationInDm(packet)) return invalid('closed_transition_consultation_must_stay_in_dm', plan, 'Do not offer a separate meetup. Keep design discussion in this DM; first in-person meeting is the confirmed appointment.')
      break
    case ACTIONS.OFFER_FORM:
      if (!packetAsksFormPermission(packet)) return invalid('closed_transition_form_offer_missing', plan, 'The design direction is sufficient. Ask once, in fresh wording, whether they want the application form.')
      if (packetSendsPreferredFormLink(packet)) return invalid('closed_transition_unsolicited_form_link', plan, 'Offer the form first unless the client explicitly requested or consented to receive it.')
      break
    case ACTIONS.DESIGN_INTAKE:
      // v155: the form check comes first — "answered, then offered the form" must be named as the form
      // fault, not as a missing lead, so the repair lock tells the model exactly what to remove.
      if (packetAsksFormPermission(packet) || packetSendsPreferredFormLink(packet)) return invalid('closed_transition_form_before_design', plan, FORM_BEFORE_DESIGN_INSTRUCTION)
      if (!packetHasHostLeadMotion(input, packet) && !obligationAnswerCarriesMotion(plan, packet)) return invalid('closed_transition_design_intake_dead_end', plan, 'Lead with one answerable design/reference/vibe move. Do not stop at an acknowledgement.')
      if (packetTriesScheduling(packet)) return invalid('closed_transition_schedule_before_design', plan, 'Do not schedule before any design direction exists.')
      break
    case ACTIONS.TATTOO_CONTINUE:
      // v155: the form is offered only when the plan is offer_form. A style question, a compliment
      // or general interest must be answered and followed by one idea/reference pull instead.
      if (packetAsksFormPermission(packet) || packetSendsPreferredFormLink(packet)) return invalid('closed_transition_form_before_design', plan, FORM_BEFORE_DESIGN_INSTRUCTION)
      if (!packetHasHostLeadMotion(input, packet) && !obligationAnswerCarriesMotion(plan, packet)) return invalid('closed_transition_tattoo_dead_end', plan, 'Keep the tattoo lead moving with one coherent next action or answerable question.')
      break
    case ACTIONS.SOCIAL_CONTINUE:
      if (packetAsksFormPermission(packet) || packetSendsPreferredFormLink(packet)) return invalid('closed_transition_form_before_design', plan, FORM_BEFORE_DESIGN_INSTRUCTION)
      if (
        plan.reason === 'artist_biography_question_owns_social_turn'
          ? packetSolicitsClientTattoo(packet)
          : packetPushesTattooSubflow(packet)
      ) return invalid('closed_transition_social_cold_push', plan, 'Keep plain social conversation human; do not cold-push tattoo booking.')
      if (
        plan.reason === 'artist_biography_question_owns_social_turn'
          ? !packetAnswersArtistBiography(packet)
          : !packetHasHostLeadMotion(input, packet) && !obligationAnswerCarriesMotion(plan, packet)
      ) return invalid('closed_transition_social_dead_end', plan, plan.reason === 'artist_biography_question_owns_social_turn'
        ? 'Answer the artist-background question directly; a substantive answer completes the turn without a follow-up or customer tattoo prompt.'
        : 'Answer naturally and leave one small answerable next move.')
      break
    case ACTIONS.BUDGET_OBJECTION_HOLD:
      if (packetSendsPreferredFormLink(packet) || packetAsksFormPermission(packet)) return invalid('closed_transition_budget_hold_cannot_offer_form', plan, 'The client raised a cost objection. Do not offer or send the form on this turn.')
      if (packetOffersDiscountOrDeal(packet)) return invalid('closed_transition_budget_hold_cannot_discount', plan, 'Never offer a discount, deal, payment plan or lower rate. The rate is fixed; the piece gets shaped to the budget later.')
      if (packetTriesScheduling(packet) || packetPushesBookingSlot(packet)) return invalid('closed_transition_budget_hold_cannot_push_slot', plan, 'Do not offer dates, times or slots and do not ask for availability on a cost objection. Hold the booking motion.')
      if (!packetAsksBudget(packet)) return invalid('closed_transition_budget_question_missing', plan, 'Ask what budget or range they are working with, in one warm question.')
      if (!packetFramesLimitedAvailability(packet)) return invalid('closed_transition_limited_spot_framing_missing', plan, 'Say that the model spots / this rate are limited and only open right now (no amount), and that you will shape the piece to their number.')
      break
    case ACTIONS.GENERAL_CONTINUE:
      if (packetAsksFormPermission(packet) || packetSendsPreferredFormLink(packet)) return invalid('closed_transition_form_before_design', plan, FORM_BEFORE_DESIGN_INSTRUCTION)
      break
    default:
      return invalid('closed_transition_unknown_action', plan)
  }

  return valid(plan)
}

function buildClosedTransitionRepairLock(plan, verdict = {}) {
  verdict = verdict && typeof verdict === 'object' ? verdict : {}
  const safePlan = plan && ACTION_SET.has(plan.action) ? plan : { action: ACTIONS.GENERAL_CONTINUE, obligations: [], fields: {} }
  const lines = [
    'CONTROLLER CLOSED-TRANSITION REPAIR LOCK',
    `- Contract version: ${SCV_CLOSED_TRANSITION_CONTRACT_VERSION}.`,
    `- Required semantic action: ${safePlan.action}.`,
    `- Why this action owns the turn: ${safePlan.reason || 'controller route decision'}.`,
    `- Previous candidate was rejected: ${String(verdict.reason || 'semantic route mismatch')}.`,
    '- Re-author fresh human Lua DM wording. Do not copy a fixed sentence from this lock.',
    '- Preserve every already-known fact and do not reopen a completed gate.'
  ]
  if (String(verdict.instruction || '').trim()) {
    lines.push(`- Verifier correction requirement: ${String(verdict.instruction).replace(/\s+/g, ' ').trim().slice(0, 1600)}`)
  }
  if (safePlan.obligations?.includes('answer_exact_location')) lines.push(`- Also answer with the exact public studio address: ${EXACT_ADDRESS}.`)
  if (safePlan.obligations?.includes('answer_model_rate')) {
    lines.push('- Internal pricing fact object: {currency:USD,amount:150,unit:HOUR,rate_type:MODEL_DISCOUNT,eligibility_code:ARTIST_VISUAL_LANGUAGE_REQUIRED}.')
    lines.push('- The reply must carry all three pricing facts: it is the discounted model rate, it is $150 per hour, and eligibility applies only when the finished piece remains in the artist’s visual language. This is a semantic requirement, not fixed outward wording.')
    lines.push('- Never serialize or translate the object field by field. Recompose the meaning naturally from the client’s current wording.')
    lines.push('- Do not use sales filler such as worth every penny or promise it is worth it. Do not ask why they are curious or what made them ask.')
  }
  if (safePlan.obligations?.includes('answer_artist_style_scope')) {
    lines.push('- Also answer the direct style-scope question before the next move: finished work stays in your own style, while references and custom ideas can be adapted into that style. Do not volunteer price unless it was asked.')
  }
  if (safePlan.obligations?.includes('acknowledge_rate_already_given')) {
    lines.push('- The rate was already given earlier in this thread. Do NOT restate any amount or hourly wording. Answer from memory in one warm line: it is the model rate you mentioned earlier and nothing changed; then continue the current step.')
  }
  if (safePlan.obligations?.includes('answer_tattoo_capability_scope')) {
    lines.push('- Also answer the exact palette / technique / style capability question directly. Then ask for the actual subject, idea, or reference. The capability question is not itself a concrete design and cannot open the form gate.')
  }
  if (safePlan.action === ACTIONS.SEND_FORM) lines.push(`- Include ${PREFERRED_FORM_LINK} exactly once and then ask for availability / a couple dates in this DM.`)
  if (safePlan.action === ACTIONS.SEND_FORM && safePlan.obligations?.includes('answer_model_rate')) lines.push('- The client consented to the form AND asked the price in the same turn: answer the price (all three facts, fresh wording) in the SAME reply as the form link. Neither replaces the other.')
  if (safePlan.action === ACTIONS.SEND_FORM && safePlan.obligations?.includes('acknowledge_rate_already_given')) lines.push('- The client consented to the form AND asked the price again: answer from memory without any number in the SAME reply as the form link.')
  if (safePlan.action === ACTIONS.OFFER_FORM) {
    lines.push('- React briefly to the chosen subject or source image, confirm it can be customized, then ask once whether they want the application form. A source image does not need to look like a finished tattoo reference. Do not grade the reference, send the URL before consent, or reopen design, style, placement, or size questions.')
    if (safePlan.live_intent?.transport_shadow_reference === true) {
      lines.push('- Transport omitted the requested media event, but the exact pointer -> studio media request -> client delivery-selector chain proves the reference was sent. Treat the reference as delivered and move to the form offer. Do not say it is missing or ask for it again.')
      lines.push('- The transport-shadow chain proves delivery only, not image contents. Do not name, describe, praise, or infer any motif, color, number, face, text, style, composition, or other visual detail unless the client’s own current text names it.')
    }
  }
  if (safePlan.action === ACTIONS.BUDGET_OBJECTION_HOLD) {
    lines.push('- The client raised a cost objection ("I thought it was free", "my budget is tight", "too expensive"). Hold the booking motion: no dates, no slots, no availability question, no form link or offer, no amount, no discount.')
    lines.push('- One warm acknowledgement, then ask what budget or range they are working with, and say the model spots / this rate are limited and only open right now so you would love to shape the piece around their number. Keep them as a potential client, no pressure.')
    if (safePlan.obligations?.includes('acknowledge_rate_already_given')) lines.push('- They also asked about the price again: answer from memory first without any number (the model rate you mentioned earlier, nothing changed).')
  }
  if (safePlan.obligations?.includes('acknowledge_budget_fit')) lines.push('- The client named their budget. Say that range is workable and that you shape the piece (size, detail, session length) around it; never a discount or a lower rate; then continue the current step.')
  if (safePlan.action === ACTIONS.CLARIFY_FORM_PERMISSION) lines.push('- The short voice reply does not coherently answer the open form-permission question. State hearing uncertainty and ask whether they meant for you to send the form. Do not infer a design meaning and do not send the link yet.')
  if (safePlan.action === ACTIONS.RESOLVE_CONTEXT) {
    if (safePlan.reason === 'verifier_conflict_booking_day_or_size') {
      lines.push(`- The prior candidate was correctly rejected because ${safePlan.fields?.ambiguous_value || 'the client number'} can still mean either an appointment day or a tattoo size in this thread.`)
      lines.push('- Ask one natural clarification that distinguishes those two meanings. Do not decide the meaning, confirm availability, accept a size, resend the form, or advance the booking checkpoint.')
      lines.push('- This is verifier feedback returned to the router, not a fixed visible sentence. Author fresh Lua wording.')
    } else if (safePlan.reason === 'missing_attachment') {
      lines.push('- The client turn depends on media that is not present in authoritative current or recent context. Ask naturally for the actual attachment and do not claim understanding or evaluate its contents before it arrives.')
      lines.push('- Do not prefix the clarification with an affirmative understanding phrase. A later question cannot repair an earlier claim that the missing object or direction was understood.')
      lines.push('- This is a general missing-context route, not a phrase-specific "this one" script. Do not advance tattoo, form, date, double-check, or deposit state until the object arrives.')
    } else {
      lines.push('- The latest turn depends on a person, object, choice, action, or prior claim that cannot be identified from authoritative context.')
      lines.push('- Ask one short open question that makes the client identify, name, show, or describe the missing person, object, place, direction, or action. Do not guess, prefix with claimed understanding, or offer generic placeholder choices such as same/new or this/that.')
      lines.push('- Do not open with positive approval or evaluation such as cool, nice, perfect, sounds good, or love that. The clarification itself is the whole motion; neutral attention markers are fine.')
    }
  }
  if (safePlan.action === ACTIONS.SOCIAL_CONTINUE && safePlan.reason !== 'artist_biography_question_owns_social_turn') lines.push('- Keep it plain social and human. A bare acknowledgement is not enough: leave one easy answerable social next move. Do not cold-push tattoo, booking, pricing, a form, or scheduling.')
  if (safePlan.reason === 'artist_biography_question_owns_social_turn') lines.push('- Answer the question about the artist\'s background directly using established facts. A substantive answer completes this turn; no follow-up is required. Tattoo vocabulary is allowed in that answer, but do not ask whether the client wants tattoos or pull a design, reference, booking, or form request from them.')
  if (safePlan.reason === 'open_form_offer_received_nonconsent_size_or_placement_detail') {
    lines.push('- The client supplied another size or placement detail instead of answering the already-open form-permission question.')
    lines.push('- Acknowledge that detail naturally. Do not send the form URL, do not repeat the form offer, and do not schedule. The previous form-permission question remains pending until actual consent or an explicit form request arrives.')
  }
  if (safePlan.reason === 'form_handoff_coarse_day_constraint_requires_grounded_slot') {
    lines.push(`- The client narrowed the open calendar exchange to ${safePlan.fields?.day_constraint || 'a day constraint'} but did not accept a specific slot.`)
    lines.push(`- Offer exactly one grounded option: ${safePlan.fields?.last_offered_date || ''} at ${safePlan.fields?.last_offered_time || '2pm'} and ask whether it works.`)
    lines.push('- Do not ask for identity, claim the form was submitted, claim a date was accepted, repeat multiple alternatives, or move to deposit.')
  }
  if (safePlan.reason === 'submitted_form_date_counterproposal_outside_window') {
    lines.push(`- The client proposed ${safePlan.fields?.proposed_date || 'a date'} but it is ${safePlan.fields?.date_status || 'outside the allowed window'}.`)
    const groundedAlternative =
      safePlan.fields?.last_offered_date ||
      safePlan.fields?.earliest_booking_option ||
      safePlan.fields?.close_booking_options?.[0] ||
      safePlan.fields?.minimum_booking_date ||
      ''
    if (groundedAlternative) {
      lines.push(`- Keep this state-grounded legal alternative in play: ${groundedAlternative}${safePlan.fields?.last_offered_date ? ` at ${safePlan.fields?.last_offered_time || '2pm'}` : ''}.`)
    }
    lines.push('- Respond to the counter-proposal directly, explain the timing boundary naturally, and leave one answerable legal date choice. Do not invent a date, send the form again, or run the four-field double-check yet.')
  }
  if (safePlan.reason === 'submitted_form_monthless_day_requires_month_clarification') {
    lines.push(`- The client proposed the ${safePlan.fields?.monthless_day || 'calendar day'} as an elliptical answer to your immediately preceding date question.`)
    lines.push('- Keep that day anchored and ask which month they mean. Do not react to it as a random number, invent a month, restart consultation, resend the form, or advance to time/double-check/deposit.')
    lines.push('- The month is unknown, so remain neutral about availability. Do not say sounds good, sounds like a plan, works, available, possible, perfect, or that you can do that day before the month is supplied.')
  }
  if (safePlan.reason === 'submitted_form_date_requires_clarification') {
    lines.push(`- The client supplied ${safePlan.fields?.proposed_date || 'a date expression'}, but the canonical booking policy classified it as ${safePlan.fields?.date_status || 'ambiguous'}.`)
    lines.push('- Ask only for the missing month or exact date meaning. Do not infer a month, claim availability, offer a replacement date, resend the form, or advance to time.')
  }
  if (
    safePlan.action === ACTIONS.POST_FORM_TIME &&
    String(safePlan.fields?.date_status || '') === 'legal' &&
    String(safePlan.fields?.proposed_date || '').trim()
  ) {
    lines.push(`- The client proposed ${safePlan.fields.proposed_date}, which is on or after the one-week minimum and is therefore valid and available.`)
    lines.push('- Accept that exact date and ask or offer only the missing time. Do not claim it is closed, unavailable, too far away, or replace it with an earlier assistant suggestion.')
  }
  if (safePlan.action === ACTIONS.POST_FORM_AVAILABILITY) {
    lines.push('- Read the latest client turn as an answer to the open calendar exchange. Do not replay an already-sent form receipt acknowledgment or ask the same generic availability question again.')
    lines.push('- Keep the semantic move locked, but author fresh natural wording rather than copying any earlier visible sentence.')
  }
  if (safePlan.action === ACTIONS.DESIGN_INTAKE) {
    lines.push('- No concrete design direction exists yet. Lead with one answerable idea / subject / reference / vibe move. Do not ask size, placement, date, or form questions.')
    lines.push('- The final bubble must be directly answerable: ask one real question or directly invite them to send / show / tell / drop / throw over an idea or reference. Profile and custom-availability statements alone are not forward motion.')
    if (safePlan.reason === 'portfolio_compliment_requires_design_lead_not_form_offer') lines.push('- The client complimented the portfolio. Thank them naturally before the one design lead move.')
  }
  if (safePlan.action === ACTIONS.DOUBLE_CHECK) {
    lines.push('- Required four-line checkpoint values:')
    lines.push(`  Name: ${safePlan.fields?.name || ''}`)
    lines.push(`  Phone Number: ${safePlan.fields?.phone || ''}`)
    lines.push(`  Appointment date: ${safePlan.fields?.date || ''}`)
    lines.push(`  Time: ${safePlan.fields?.time || ''}`)
  }
  if (safePlan.action === ACTIONS.DEPOSIT_HANDOFF) lines.push('- The four-field checkpoint is already confirmed. Send the $100 deposit/Zelle handoff now; no second confirmation and no date loop.')
  return lines.join('\n')
}

module.exports = {
  dateAnswerAfterFormLink,
  liveIsGenericInfoSideQuestionAtOpenCheckpoint,
  SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
  ACTIONS,
  deriveClosedTransitionPlan,
  deriveVerifierRebasePlan,
  evaluateClosedTransitionContract,
  evaluateClosedTransitionLivenessFloor,
  buildClosedTransitionRepairLock,
  countOccurrences,
  exactAddressPresent,
  priceAnswerPresent,
  packetUsesDateAvailabilityWordForClock,
  latestAssistantPacketText,
  textAcknowledgesFormReceipt,
  ungroundedSubmissionResidueTokens,
  packetEchoesUngroundedSubmissionResidue,
  textAsksGenericAvailability,
  liveTurnProvidesAvailabilityContent,
  packetAcceptsOutOfWindowProposal,
  packetRejectsOutOfWindowProposal,
  packetOffersGroundedOutsideWindowAlternative,
  packetMakesGroundedOutsideWindowMove,
  packetClarifiesMonthlessBookingDay,
  packetClarifiesAmbiguousBookingDate,
  bookingPolicyDecisionForInput,
  pendingFormPermissionNeedsClarification,
  packetClarifiesPendingFormPermission,
  independentDesignDirectionExists,
  liveComplimentNeedsDesignLead,
  unresolvedReferencePointerNeedsMedia,
  missingContextRelation,
  contextResolutionNeeded,
  packetRequestsReferenceMedia,
  packetAssumesUnseenReference,
  packetClarifiesMissingContext
}
