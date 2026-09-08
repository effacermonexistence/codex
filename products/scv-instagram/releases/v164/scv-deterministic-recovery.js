#!/usr/bin/env node

const path = require('path')
const { resolvedCheckpointRevisionAcknowledgement } = require('./scv-checkpoint-revision-ack.js')
const {
  clientAnchoredInspirationReference: contractClientAnchoredInspirationReference,
  LOCKED_DEPOSIT_HANDOFF_BUBBLES,
  modelRateAlreadyDisclosed,
  packetStatesModelRate,
  directPriceAskInLiveOrPending,
  liveInfoAskOpener: contractLiveInfoAskOpener,
  livePlacementSizeDimensions: contractLivePlacementSizeDimensions
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON,
  buildCheckpointSideQuestionBubbles,
  liveTextIsGenericInfoRequest,
  hasLiveMedia: recoveryLiveTurnCarriesMedia
} = require(path.join(__dirname, 'scv-generic-info-fast-path.js'))
const {
  decorateDeterministicPacket
} = require(path.join(__dirname, 'scv-structured-output-contract.js'))

const DETERMINISTIC_RECOVERY_VERSION =
  'scv-explicit-verbatim-checkpoints-and-send-form-liveness-2026-08-25-v12-context-only-clarification'

const SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES = 3
const PREFERRED_FORM_LINK = 'https://www.effacermonexistence.com/apply'

const SAFE_CLARIFICATION_TEXT = Object.freeze({
  generic: 'sorry i didnt catch that clearly can you say that again',
  voice: 'sorry i couldnt hear that clearly can you send it again or type it here'
})
const ROUTE_AWARE_VISIBLE_RECOVERY_VERSION =
  'scv-route-aware-visible-recovery-2026-09-07-v14-a-cost-objection-holds-the-booking'

// Live 2026-09-03 (Omar.system): the await-stage recovery asked "which one
// should i fix the date the time or the name and number?" to a client whose
// live turn was "Hi, can I please get more information?". The which-field ask
// is a revision question; it is only valid when the live turn carries revision
// evidence. An information request at the open checkpoint gets the deterministic
// side-question answer; anything else gets a neutral nudge that keeps the
// checkpoint open without inventing a revision.
const CHECKPOINT_NEUTRAL_NUDGES = Object.freeze([
  'i still have everything above exactly as it is just say yes if it is right or tell me what to change',
  'nothing is changed on my side the details above still stand lmk if they are right or if you want any of it changed',
  'ok i have your message and the booking above is untouched just tell me if it all looks right or what you want changed'
])
const CHECKPOINT_REVISION_EVIDENCE_RE = /\b(?:change|changes|changed|switch|move|fix|update|edit|correct|wrong|instead|actually|different|rather|not\s+(?:that|this|the)\b|reschedule|push|bump|shift|make it|put down|swap|cancel)\b|\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}(?:st|nd|rd|th)\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{7,})/i

function liveTurnCarriesCheckpointRevisionEvidence(input = {}) {
  const state = input.structured_state || {}
  if (String(state.live_turn_checkpoint_revision_intent || '').trim()) return true
  if (state.live_turn_checkpoint_invalidated === true) return true
  if (state.checkpoint_superseded_by_revision === true) return true
  const live = compact(input.live_message || input.message || state.live_turn_text)
  if (!live) return false
  if (liveTextIsGenericInfoRequest(live, { liveInfoAskOpener: () => contractLiveInfoAskOpener(input) })) return false
  return CHECKPOINT_REVISION_EVIDENCE_RE.test(live)
}

function liveTurnIsInfoSideQuestion(input = {}) {
  const state = input.structured_state || {}
  if (state.live_turn_deposit_sent === true || state.live_turn_deposit_proof_media === true) return false
  if (recoveryLiveTurnCarriesMedia(input)) return false
  const live = compact(input.live_message || input.message || state.live_turn_text)
  return liveTextIsGenericInfoRequest(live, { liveInfoAskOpener: () => contractLiveInfoAskOpener(input) })
}

function bubble(text) {
  return { text: String(text || '').trim(), delay_ms: 0 }
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function fieldValue(plan, state, ...names) {
  for (const name of names) {
    const fromPlan = compact(plan?.fields?.[name])
    if (fromPlan) return fromPlan
    const fromState = compact(state?.[name])
    if (fromState) return fromState
  }
  return ''
}

function doubleCheckPacket(input, plan) {
  const state = input.structured_state || {}
  const name = fieldValue(plan, state, 'name', 'known_name_used_on_form')
  const phone = fieldValue(plan, state, 'phone', 'known_phone_used_on_form')
  const date = fieldValue(plan, state, 'date', 'proposed_date', 'known_requested_date', 'accepted_offered_date')
  const time = fieldValue(plan, state, 'time', 'known_requested_time', 'accepted_offered_time')
  if (!name || !phone || !date || !time) {
    throw new Error('deterministic_exact_double_check_fields_missing')
  }
  // v152 (owner, 2026-09-05): same rule as the runner's fixed lane — a resolved
  // time revision of the open checkpoint gets "yes 5pm works" in front of the block.
  const acknowledgement = resolvedCheckpointRevisionAcknowledgement(state, { time })
  const block = `Name : ${name}\nPhone Number : ${phone}\nAppointment date : ${date}\nTime : ${time}\n\ncan you double check this just to make sure`
  return decorateDeterministicPacket(input, {
    bubbles: acknowledgement ? [bubble(acknowledgement), bubble(block)] : [bubble(block)]
  }, {
    plan,
    nextAction: plan.action,
    acknowledgedFields: ['name', 'phone_number', 'appointment_date', 'appointment_time'],
    questionedFields: ['double_check_confirmation']
  })
}

function sendFormRecoveryAsksPrice(input, plan) {
  const obligations = new Set(
    Array.isArray(plan?.obligations)
      ? plan.obligations.map((value) => String(value || '').trim()).filter(Boolean)
      : []
  )
  // v157: once the rate was given in this thread, no recovery line speaks it again
  if (obligations.has('acknowledge_rate_already_given') || modelRateAlreadyDisclosed(input)) return false
  if (obligations.has('answer_model_rate')) return true
  return directPriceAskInLiveOrPending(input)
}

function sendFormCheckpointPacket(input, plan, recoveryAuthority) {
  const reason = String(plan?.reason || '')
  const candidateCount = Number(recoveryAuthority?.model_candidate_count || 0)
  const linkVisibleInHistory = (Array.isArray(input?.recent_history) ? input.recent_history : [])
    .some((event) => {
      const role = String(event?.role || event?.sender || event?.actor || '').trim().toLowerCase()
      const assistant = ['assistant', 'lua', 'artist', 'bot', 'business'].includes(role)
      return assistant && String(event?.text || event?.message || event?.content || '').includes(PREFERRED_FORM_LINK)
    })
  const firstDelivery =
    input?.structured_state?.form_link_sent !== true &&
    !linkVisibleInHistory
  const authorized =
    recoveryAuthority?.model_drafts_exhausted === true &&
    candidateCount >= SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES &&
    firstDelivery &&
    [
      'explicit_form_request_or_open_offer_consent',
      'accepted_slot_requires_form_link'
    ].includes(reason)

  if (!authorized) {
    throw new Error('deterministic_send_form_recovery_unauthorized')
  }

  const answersPrice = sendFormRecoveryAsksPrice(input, plan)
  const bubbles = []
  if (answersPrice) {
    bubbles.push(bubble("it isnt free this is my discounted model rate at $150 per hour when the finished piece stays in my style"))
  } else if ((plan?.obligations || []).includes('acknowledge_rate_already_given')) {
    bubbles.push(bubble(rotateAsk(input, RATE_ALREADY_GIVEN_LINES)))
  } else {
    bubbles.push(bubble('yeah here you go'))
  }
  bubbles.push(bubble(PREFERRED_FORM_LINK))
  bubbles.push(bubble("send me a couple days that work for you here and i'll check the schedule"))

  return decorateDeterministicPacket(input, {
    authority_transport_flags: {
      atomic_send_form_recovery: true,
      model_drafts_exhausted: true,
      model_candidate_count: candidateCount,
      deterministic_recovery_version: DETERMINISTIC_RECOVERY_VERSION,
      reason: 'authorized_send_form_checkpoint_after_model_exhaustion'
    },
    bubbles
  }, {
    plan,
    nextAction: plan.action,
    acknowledgedFields: answersPrice
      ? ['form_offer', 'form_link', 'price']
      : ['form_offer', 'form_link'],
    questionedFields: ['appointment_date']
  })
}

function buildSafeClarificationRecoveryPacket(input = {}) {
  const state = input.structured_state || {}
  const voice =
    state.live_turn_voice_transcribe_failed === true ||
    state.live_turn_voice_context_unresolved === true ||
    /voice note that could not be understood/i.test(
      String(input.live_message || input.message || state.live_turn_text || '')
    )
  const plan = {
    action: 'resolve_context',
    reason: 'unintelligible',
    obligations: [],
    fields: {}
  }
  return decorateDeterministicPacket(input, {
    authority_transport_flags: {
      safe_nontransactional_recovery: true,
      reason: voice
        ? 'voice_media_unavailable_or_unintelligible'
        : 'model_adoption_exhausted'
    },
    bubbles: [bubble(voice ? SAFE_CLARIFICATION_TEXT.voice : SAFE_CLARIFICATION_TEXT.generic)]
  }, {
    plan,
    nextAction: plan.action,
    acknowledgedFields: [],
    questionedFields: ['missing_context']
  })
}

const DOUBLE_CHECK_REVISION_REASONS = Object.freeze([
  'double_check_time_revision_unresolved',
  'double_check_date_revision_unresolved',
  'double_check_identity_revision_unresolved',
  'double_check_revision_unclassified_ask_which_field'
])

// The old await-stage recovery line ("got you i saw that and i haven't changed
// or confirmed the booking yet what detail do you want me to update?") was a
// fixed system-notice template that the owner saw on every unclassified
// revision at the four-field checkpoint (live incident 2026-09-02, Omar.system,
// "Can we actually do 3 PM?"). It is retired: the ask below is built from the
// live turn and the checkpoint values, names the concrete field or values in
// question, rotates its wording, and never repeats the previous assistant line.
const GENERIC_RECOVERY_ASKS = Object.freeze([
  'got you i have your message and i have not changed anything yet what do you want me to handle first?',
  'i see your message nothing is changed on my side yet what should i take care of first?',
  'ok i have that here and nothing is changed yet which part do you want me to handle first?'
])

// v153: before any booking exists the checkpoint-flavoured generic ask ("nothing is
// changed on my side yet") is nonsense to a client who just sent a reference; every
// pre-checkpoint route now owns its own answerable line and the generic ask is
// reserved for turns after a form/checkpoint/deposit exists.
const DESIGN_LEAD_ASKS = Object.freeze([
  'what are you thinking of getting? an idea a reference or a vibe is enough and we go from there',
  'what did you have in mind? send me an idea or a reference and i will take it from there',
  'what are you picturing? a subject a reference or just a vibe is enough to start'
])

const IMAGE_PART_ASKS = Object.freeze([
  'i see the image what part of it are you thinking about for the tattoo?',
  'got the image which part of it do you want to bring into the tattoo?'
])

const SOCIAL_LEAD_ASKS = Object.freeze([
  'hey what is up? what can i help you with',
  'hey i am here what did you want to ask me about'
])

// v154 (live 2026-09-06 01:24Z): the same price line went out twice in a row. Facts fixed
// ($150 per hour, discounted model rate, only when the finished piece stays in my style);
// wording rotates and skips whatever this thread already heard.
const PRICE_ANSWER_LINES = Object.freeze([
  'this is my discounted model rate at $150 per hour when the finished piece stays in my style',
  'it is not free the model rate is $150 an hour and that discounted rate applies when the finished piece stays in my style',
  'the model spot is $150 per hour that is my discounted rate as long as the piece stays in my style'
])

// v157: a repeated price question after the rate was given is answered from memory, no number.
// v162: a cost objection holds the booking motion — warm ack, ask the budget, limited spots, no numbers, no dates.
const BUDGET_OBJECTION_LINES = Object.freeze([
  'totally get it, no pressure at all. what budget are you working with? the model spots are limited and this rate is only open right now, so give me your range and i will shape the piece around it',
  'i hear you, money matters and i would rather make it work than lose you. what range are you comfortable with? these model spots are limited so tell me your number and i will scale the piece to fit',
  'all good, that is exactly why i keep a few model spots open. what budget did you have in mind? the spots are limited and only open right now, once i know your number i can shape the piece to fit it'
])
const RATE_ALREADY_GIVEN_LINES = Object.freeze([
  'nah it is not free, it is the model rate i mentioned earlier and that part stays the same 🖤',
  'same as i said before, the model rate i mentioned still stands, nothing changed there',
  'that is still the model rate from earlier, nothing moved on my side'
])

const WHICH_FIELD_ASKS = Object.freeze([
  'which part do you want me to change the time the date or the name and number?',
  'what should i change on it the date the time or the name and number?',
  'which one should i fix the date the time or the name and number?'
])

function stableTextHash(value) {
  let hash = 0
  for (const ch of String(value || '')) hash = ((hash * 31) + ch.codePointAt(0)) >>> 0
  return hash
}

function recentAssistantTexts(input = {}) {
  return (Array.isArray(input?.recent_history) ? input.recent_history : [])
    .filter((event) => ['assistant', 'lua', 'artist', 'bot', 'business', 'assistant_attempted'].includes(String(event?.role || event?.sender || event?.actor || '').trim().toLowerCase()))
    .map((event) => compact(event?.text || event?.message || event?.content || (event?.bubble || {}).text).toLowerCase())
    .filter(Boolean)
    .slice(-6)
}

function rotateAsk(input, variants) {
  const recent = recentAssistantTexts(input)
  const live = compact(input?.live_message || input?.message || input?.structured_state?.live_turn_text)
  const seed = stableTextHash(`${live}|${recent.join('|')}`)
  for (let offset = 0; offset < variants.length; offset += 1) {
    const candidate = variants[(seed + offset) % variants.length]
    if (!recent.includes(compact(candidate).toLowerCase())) return candidate
  }
  return variants[seed % variants.length]
}

function checkpointRevisionDetail(input = {}, plan = {}) {
  const state = input.structured_state || {}
  const detail = plan?.fields?.checkpoint_revision || state.live_turn_checkpoint_revision_detail || {}
  return detail && typeof detail === 'object' ? detail : {}
}

function isDoubleCheckRevisionReason(reason) {
  return DOUBLE_CHECK_REVISION_REASONS.includes(String(reason || ''))
}

function doubleCheckRevisionAskText(input = {}, plan = {}) {
  const reason = String(plan?.reason || '')
  const state = input.structured_state || {}
  const detail = checkpointRevisionDetail(input, plan)
  const currentTime = fieldValue(plan, state, 'time', 'known_requested_time', 'accepted_offered_time')
  const currentDate = fieldValue(plan, state, 'date', 'known_requested_date', 'accepted_offered_date')
  if (reason === 'double_check_time_revision_unresolved') {
    const alternatives = Array.isArray(detail.alternatives) ? detail.alternatives.filter(Boolean) : []
    if (alternatives.length >= 2) return `do you want ${alternatives.slice(0, -1).join(' ')} or ${alternatives.at(-1)}?`
    if (detail.rejected) return `what time do you want instead of ${detail.rejected}?`
    if (detail.bounded) return `what exact time do you want me to put down?`
    return currentTime
      ? `what time do you want me to switch it to instead of ${currentTime}?`
      : 'what time do you want me to switch it to?'
  }
  if (reason === 'double_check_date_revision_unresolved') {
    if (detail.rejected) return `what date works instead of ${detail.rejected}?`
    return currentDate
      ? `what date do you want me to switch it to instead of ${currentDate}?`
      : 'what date do you want me to switch it to?'
  }
  if (reason === 'double_check_identity_revision_unresolved') {
    const kind = String(detail.kind || '')
    if (kind === 'name') return 'what name should i put down instead?'
    if (kind === 'phone') return 'what number should i put down instead?'
    return 'what name and number should i put down instead?'
  }
  return rotateAsk(input, WHICH_FIELD_ASKS)
}

function buildDoubleCheckRevisionAskPacket(input = {}, plan = {}) {
  if (!isDoubleCheckRevisionReason(plan?.reason)) {
    throw new Error(`double_check_revision_ask_reason_unsupported:${String(plan?.reason || '')}`)
  }
  const questioned = plan.action === 'post_form_time'
    ? ['appointment_time']
    : plan.action === 'post_form_availability'
      ? ['appointment_date']
      : plan.action === 'post_form_identity'
        ? ['name', 'phone_number']
        : ['double_check_revision_field']
  return decorateDeterministicPacket(input, {
    authority_transport_flags: {
      double_check_revision_ask: true,
      deterministic_recovery_version: DETERMINISTIC_RECOVERY_VERSION,
      reason: String(plan.reason || '')
    },
    bubbles: [bubble(doubleCheckRevisionAskText(input, plan))]
  }, {
    plan,
    nextAction: plan.action,
    acknowledgedFields: [],
    questionedFields: questioned
  })
}

function routeAwareRecoveryQuestionedFields(action, plan = {}, state = {}, input = {}) {
  if (action === 'await_double_check_confirmation') {
    return liveTurnCarriesCheckpointRevisionEvidence(input) ? ['double_check_revision_field'] : ['double_check_confirmation']
  }
  if (action === 'offer_form' || action === 'clarify_form_permission') return ['form_link']
  if (action === 'post_form_availability') return ['appointment_date']
  // the budget question lives in the canonical price field (structured-output contract has no budget field)
  if (action === 'budget_objection_hold') return ['price']
  if (action === 'post_form_time') return ['appointment_time']
  if (action === 'post_form_identity' || action === 'accepted_slot_progress') {
    const date = fieldValue(plan, state, 'date', 'known_requested_date', 'accepted_offered_date')
    const time = fieldValue(plan, state, 'time', 'known_requested_time', 'accepted_offered_time')
    if (!date) return ['appointment_date']
    if (!time) return ['appointment_time']
    return ['name', 'phone_number']
  }
  if (['send_form', 'double_check', 'deposit_handoff', 'deposit_hold', 'deposit_pending_continue'].includes(action)) {
    return []
  }
  return ['missing_context']
}

// v155: deterministic answer to a style / technique capability question. Core modalities are
// answered as capabilities; anything else is answered as style scope (everything stays in the
// artist's own style and the idea gets adapted into it). Fact-safe last resort after the model lane.
const CORE_CAPABILITY_TERMS = new Set(['black and gray', 'black and white', 'gray scale', 'grayscale', 'black work', 'line work', 'fine line', 'color', 'color work', 'full color'])
function capabilityScopeAnswer(input) {
  let terms = []
  try {
    terms = require('./scv-contract-harness.js').extractTattooCapabilityStyleTerms(String(input?.live_message || input?.message || input?.structured_state?.live_turn_text || ''))
  } catch (_error) {
    terms = []
  }
  if (!terms.length) return 'yeah that is all within what i do,'
  const core = terms.filter((term) => CORE_CAPABILITY_TERMS.has(term))
  const other = terms.filter((term) => !CORE_CAPABILITY_TERMS.has(term))
  const list = (items) => items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
  if (core.length && !other.length) return core.length === 1 ? `yeah ${core[0]} is part of what i do,` : `yeah ${list(core)} are both part of what i do,`
  return `everything i make stays in my own style and i can adapt ${list(terms)} ideas into it,`
}

function routeAwareRecoveryText(input = {}, originalPlan = {}) {
  const core = routeAwareRecoveryTextCore(input, originalPlan)
  const obligations = Array.isArray(originalPlan?.obligations) ? originalPlan.obligations.map((value) => String(value || '')) : []
  let text = core
  if (obligations.includes('acknowledge_rate_already_given')) {
    const ack = rotateAsk(input, RATE_ALREADY_GIVEN_LINES)
    text = core && !packetStatesModelRate({ bubbles: [{ text: core }] }) ? `${ack} ${core}` : ack
  } else if (obligations.includes('answer_model_rate') && !packetStatesModelRate({ bubbles: [{ text: core }] })) {
    // v162 (live 2026-09-07 21:15Z, Omar.system): "How much is it by the way?" at the post-form stage fell to
    // the recovery line "got it i have your form what date would you like me to check?" and the first price
    // answer was dropped. The route owns its line; the first price answer travels with every route.
    text = core ? `${rotateAsk(input, PRICE_ANSWER_LINES)}\n${core}` : rotateAsk(input, PRICE_ANSWER_LINES)
  }
  if (obligations.includes('acknowledge_budget_fit') && !/\b(?:shape|fit|work with|around it|around that)\b/i.test(text)) {
    text = `that range works, i can shape the piece to fit it and keep it clean in my style\n${text}`.trim()
  }
  return text
}

function routeAwareRecoveryTextCore(input = {}, originalPlan = {}) {
  const action = String(originalPlan?.action || 'general_continue')
  const state = input.structured_state || {}
  // An unresolved revision at the open four-field checkpoint keeps its exact
  // field question even after the model lane is exhausted.
  if (isDoubleCheckRevisionReason(originalPlan?.reason)) {
    return doubleCheckRevisionAskText(input, originalPlan)
  }
  const asksPrice = sendFormRecoveryAsksPrice(input, originalPlan)
  const date = fieldValue(
    originalPlan,
    state,
    'date',
    'proposed_date',
    'known_requested_date',
    'accepted_offered_date',
    'live_turn_date_phrase'
  )

  if (action === 'send_form') {
    return asksPrice
      ? "yes this is my discounted model rate at $150 per hour when the finished piece stays in my style i have your yes on the form too while i get the link"
      : "got you, you said yes to the form. i haven't marked anything complete while i verify the link"
  }
  if (action === 'offer_form' || action === 'clarify_form_permission') {
    const liveText = String(
      input.live_message || input.message || state.live_turn_text || ''
    )
    let referenceTurn =
      state.live_turn_is_media_reference === true ||
      /^sent a (?:reference post|photo|media)\b/i.test(liveText)
    // v161: the client named the object in their picture as the reference; the recovery owes the same
    // acknowledgement as a picture turn, never a bare form ask.
    try { referenceTurn = referenceTurn || contractClientAnchoredInspirationReference(input) === true } catch {}
    // v148 (live 2026-09-03 18:07Z): after the model lane is exhausted on a
    // design turn that volunteered a placement/size, the recovery line still
    // owes the acknowledgement and the in-person deferral the verifier demands;
    // a bare form offer drops the client's own detail on the floor.
    let dimensions = { any: false, placement: false, size: false }
    try { dimensions = contractLivePlacementSizeDimensions({ ...input, message: liveText, live_message: liveText }) || dimensions } catch {}
    if (dimensions.any && !referenceTurn) {
      const detail = dimensions.placement && dimensions.size
        ? 'that size and spot'
        : dimensions.placement ? 'that spot' : 'that size'
      return `${detail} can work and the exact placement and sizing get dialed in together at the appointment\nwant me to send the application form?`
    }
    return referenceTurn
      ? 'yeah we can use that as a starting point and make it custom in my style want me to send the application form?'
      : 'want me to send the application form?'
  }
  if (action === 'post_form_availability') {
    if (String(originalPlan?.reason || '') === 'form_handoff_coarse_day_constraint_requires_grounded_slot') {
      const groundedDate = fieldValue(originalPlan, state, 'last_offered_date')
      const groundedTime = fieldValue(originalPlan, state, 'last_offered_time') || '2pm'
      if (groundedDate) return `i can do ${groundedDate} at ${groundedTime} for the weekend does that work for you?`
    }
    return state.form_submitted === true || originalPlan?.live_intent?.form_submitted === true
      ? "got it i have your form what date would you like me to check?"
      : "what date would you like me to check?"
  }
  if (action === 'post_form_time') {
    if (String(originalPlan?.reason || '') === 'submitted_form_time_before_minimum') {
      const proposed = fieldValue(
        originalPlan,
        state,
        'proposed_time',
        'live_turn_time_candidate'
      )
      return `${proposed || 'that time'} is a little early for me i start at 1pm or later would 1 or 2 work?`
    }
    return date
      ? `yeah ${date} works what time are you thinking?`
      : 'what time are you thinking?'
  }
  if (action === 'post_form_identity' || action === 'accepted_slot_progress') {
    const time = fieldValue(originalPlan, state, 'time', 'known_requested_time', 'accepted_offered_time')
    if (!date) return 'what date do you want me to check?'
    if (!time) return `i have ${date} in mind what time works for you?`
    return `perfect ${date} at ${time} works what name and phone number did you use on the form?`
  }
  if (action === 'double_check' || action === 'deposit_handoff') {
    throw new Error(`route_aware_recovery_transactional_checkpoint_forbidden:${action}`)
  }
  if (action === 'await_double_check_confirmation') {
    if (liveTurnCarriesCheckpointRevisionEvidence(input)) {
      return doubleCheckRevisionAskText(input, { ...originalPlan, reason: 'double_check_revision_unclassified_ask_which_field' })
    }
    if (liveTurnIsInfoSideQuestion(input)) {
      const live = compact(input.live_message || input.message || state.live_turn_text)
      const built = buildCheckpointSideQuestionBubbles(
        { ...input, control_transition_contract: { action, reason: GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON } },
        live
      )
      if (built && Array.isArray(built.bubbles) && built.bubbles.length) {
        return built.bubbles.map((item) => String(item.text || '').trim()).filter(Boolean).join(' ')
      }
    }
    return rotateAsk(input, CHECKPOINT_NEUTRAL_NUDGES)
  }
  if (action === 'deposit_hold' || action === 'deposit_pending_continue') {
    return "got it, i have your message and i haven't changed the deposit status. i'm checking the handoff before anything moves"
  }
  if (action === 'budget_objection_hold') return rotateAsk(input, BUDGET_OBJECTION_LINES)
  if (asksPrice) {
    return rotateAsk(input, PRICE_ANSWER_LINES)
  }
  // v153 (live 2026-09-05 21:56Z): pre-checkpoint routes own their own line.
  if (action === 'resolve_context') {
    const reason = String(originalPlan?.reason || '')
    if (reason === 'missing_attachment') return 'send me the photo or reference you mean and i will take a look'
    if (reason === 'unintelligible') return 'i might be reading that wrong say that again for me?'
    return 'what are you referring to? tell me a bit more'
  }
  // v159 (live 2026-09-07 04:28Z): a voice note is the client's words, never an image; the
  // image-part ask must not answer a voice turn under any route.
  const voiceTurn = state.live_turn_is_voice_note === true ||
    /^sent\s+a\s+voice\s+note\b/i.test(String(input.live_message || input.message || state.live_turn_text || ''))
  const voiceWithoutVisual = voiceTurn &&
    state.live_turn_context_resolved_from_history !== true &&
    state.known_reference_media_received !== true &&
    state.known_tattoo_reference_media_received !== true
  const imageTurn = !voiceWithoutVisual && (state.live_turn_is_media_reference === true || (voiceTurn && state.live_turn_context_resolved_from_history === true))
  if (action === 'general_continue' && String(originalPlan?.reason || '') === 'non_tattoo_media_requires_contextual_host_lead') {
    return voiceWithoutVisual ? rotateAsk(input, DESIGN_LEAD_ASKS) : rotateAsk(input, IMAGE_PART_ASKS)
  }
  if (action === 'design_intake' || action === 'tattoo_continue') {
    const lead = imageTurn
      ? rotateAsk(input, IMAGE_PART_ASKS)
      : rotateAsk(input, DESIGN_LEAD_ASKS)
    // v155: a pending style / technique question is answered first, then the idea is pulled.
    const capabilityAnswer = (originalPlan?.obligations || []).includes('answer_tattoo_capability_scope')
      ? capabilityScopeAnswer(input)
      : ''
    return capabilityAnswer ? `${capabilityAnswer} ${lead}` : lead
  }
  if (action === 'social_continue') return rotateAsk(input, SOCIAL_LEAD_ASKS)
  const bookingExists = Boolean(
    state.form_link_sent === true || state.form_submitted === true || state.double_check_sent === true ||
    state.name_phone_date_time_double_check_sent === true || state.deposit_requested === true
  )
  if (!bookingExists) {
    return imageTurn
      ? rotateAsk(input, IMAGE_PART_ASKS)
      : rotateAsk(input, DESIGN_LEAD_ASKS)
  }
  // The generic fallback rotates and never repeats the previous assistant line:
  // two identical consecutive recovery lines tripped the duplicate-visible-text
  // critical latch on 2026-09-02 and fail-closed production.
  return rotateAsk(input, GENERIC_RECOVERY_ASKS)
}

function routeAwareRecoverySurfaceText(input = {}, originalPlan = {}) {
  return routeAwareRecoveryText(input, originalPlan)
    .replace(/,/g, '')
    .replace(/\.(?=\s|$)/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

function buildRouteAwareVisibleRecoveryPacket(input = {}, originalPlan = {}) {
  const originalAction = String(originalPlan?.action || 'general_continue')
  const recoveryPlan = {
    action: 'resolve_context',
    reason: 'verifier_exhausted_route_recovery',
    obligations: [],
    fields: {},
    recovery: {
      previous_action: originalAction,
      previous_reason: String(originalPlan?.reason || '')
    }
  }
  return decorateDeterministicPacket(input, {
    authority_transport_flags: {
      safe_nontransactional_recovery: true,
      route_aware_visible_recovery: true,
      route_aware_visible_recovery_version: ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
      original_action: originalAction,
      original_reason: String(originalPlan?.reason || '')
    },
    bubbles: [bubble(routeAwareRecoverySurfaceText(input, originalPlan))]
  }, {
    plan: recoveryPlan,
    nextAction: recoveryPlan.action,
    acknowledgedFields: [],
    questionedFields: routeAwareRecoveryQuestionedFields(originalAction, originalPlan, input.structured_state || {}, input)
  })
}

function isRouteAwareVisibleRecoveryPacket(packet = {}, input = {}, originalPlan = {}) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  const text = bubbles.length === 1 ? compact(bubbles[0]?.text) : ''
  const expectedText = compact(routeAwareRecoverySurfaceText(input, originalPlan))
  const originalAction = String(originalPlan?.action || 'general_continue')
  const flags = packet?.authority_transport_flags || {}
  return Boolean(
    text && text === expectedText &&
    compact(packet.reply_text) === expectedText &&
    !text.includes(PREFERRED_FORM_LINK) &&
    !/effacermonexistence|contact@omarprotocol|\bzelle\b/i.test(text) &&
    String(packet.next_action_reflected || '') === 'resolve_context' &&
    Array.isArray(packet.acknowledged_fields) &&
    packet.acknowledged_fields.length === 0 &&
    Array.isArray(packet.questioned_fields) &&
    packet.questioned_fields.length === routeAwareRecoveryQuestionedFields(originalAction, originalPlan, input.structured_state || {}, input).length &&
    packet.questioned_fields.every((value, index) => (
      value === routeAwareRecoveryQuestionedFields(originalAction, originalPlan, input.structured_state || {}, input)[index]
    )) &&
    flags.safe_nontransactional_recovery === true &&
    flags.route_aware_visible_recovery === true &&
    flags.route_aware_visible_recovery_version === ROUTE_AWARE_VISIBLE_RECOVERY_VERSION &&
    String(flags.original_action || '') === originalAction &&
    String(flags.original_reason || '') === String(originalPlan?.reason || '')
  )
}

function inputAuthorizesSafeClarificationRecovery(input = {}) {
  const plan = input.control_transition_contract || {}
  const state = input.structured_state || {}
  return Boolean(
    String(plan.action || '') === 'resolve_context' &&
    String(plan.reason || '') === 'unintelligible' &&
    (
      state.live_turn_voice_transcribe_failed === true ||
      state.live_turn_voice_context_unresolved === true ||
      String(state.live_turn_context_relation || '') === 'unintelligible' ||
      state.live_turn_context_needs_clarification === true
    )
  )
}

function isSafeClarificationRecoveryPacket(packet = {}) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  const text = bubbles.length === 1 ? compact(bubbles[0]?.text) : ''
  return Boolean(
    Object.values(SAFE_CLARIFICATION_TEXT).includes(text) &&
    compact(packet.reply_text) === text &&
    String(packet.next_action_reflected || '') === 'resolve_context' &&
    Array.isArray(packet.acknowledged_fields) && packet.acknowledged_fields.length === 0 &&
    Array.isArray(packet.questioned_fields) &&
    packet.questioned_fields.length === 1 &&
    packet.questioned_fields[0] === 'missing_context' &&
    packet.authority_transport_flags?.safe_nontransactional_recovery === true
  )
}

function isSendFormRecoveryPacket(packet = {}) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  if (bubbles.length !== 3) return false

  const texts = bubbles.map((entry) => compact(entry?.text))
  // The recovery source carries semantic copy while the runner's final client
  // surface removes commas before controller adoption and receipt binding.
  const priceReply = "it isnt free this is my discounted model rate at $150 per hour when the finished piece stays in my style"
  const genericReply = 'yeah here you go'
  const availabilityReply = "send me a couple days that work for you here and i'll check the schedule"
  const answersPrice = texts[0] === priceReply
  const expectedAcknowledged = answersPrice
    ? ['form_offer', 'form_link', 'price']
    : ['form_offer', 'form_link']
  const modelCandidateCount = Number(packet?.authority_transport_flags?.model_candidate_count || 0)

  return Boolean(
    [genericReply, priceReply, ...RATE_ALREADY_GIVEN_LINES.map(compact), ...RATE_ALREADY_GIVEN_LINES.map(text => compact(text.replace(/,/g, '')))].includes(texts[0]) &&
    texts[1] === PREFERRED_FORM_LINK &&
    texts[2] === availabilityReply &&
    compact(packet.reply_text) === compact(texts.join('\n')) &&
    Array.isArray(packet.acknowledged_fields) &&
    packet.acknowledged_fields.length === expectedAcknowledged.length &&
    packet.acknowledged_fields.every((value, index) => value === expectedAcknowledged[index]) &&
    Array.isArray(packet.questioned_fields) &&
    packet.questioned_fields.length === 1 &&
    packet.questioned_fields[0] === 'appointment_date' &&
    String(packet.next_action_reflected || '') === 'send_form' &&
    packet.authority_transport_flags?.atomic_send_form_recovery === true &&
    packet.authority_transport_flags?.model_drafts_exhausted === true &&
    modelCandidateCount === SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES &&
    packet.authority_transport_flags?.deterministic_recovery_version === DETERMINISTIC_RECOVERY_VERSION &&
    packet.authority_transport_flags?.reason === 'authorized_send_form_checkpoint_after_model_exhaustion'
  )
}

// Ben's explicit booking checkpoints remain deliberately narrow. Open dialogue
// is authored afresh by the Responses model. SEND_FORM is a transaction/liveness
// checkpoint, not open dialogue: only an already-authorized controller route may
// use its final packet, and only after the bounded model draft budget is proved
// exhausted. The packet sends /apply once, answers the atomic price side-question
// when present, and leaves availability as the next move.
function buildDeterministicRecoveryPacket(input = {}, planOverride = null, recoveryAuthority = {}) {
  const plan = planOverride || input.control_transition_contract || {
    action: 'general_continue',
    reason: 'missing_plan',
    obligations: [],
    fields: {}
  }
  const action = String(plan.action || 'general_continue')

  if (action === 'deposit_handoff') {
    return decorateDeterministicPacket(input, {
      authority_transport_flags: {
        atomic_deposit_handoff: true,
        reason: 'exact_checkpoint_recovery_after_one_reauthor'
      },
      bubbles: LOCKED_DEPOSIT_HANDOFF_BUBBLES.map(bubble)
    }, {
      plan,
      nextAction: action,
      acknowledgedFields: ['double_check_confirmation', 'deposit'],
      questionedFields: []
    })
  }

  if (action === 'double_check') return doubleCheckPacket(input, plan)
  if (action === 'send_form') return sendFormCheckpointPacket(input, plan, recoveryAuthority)

  throw new Error(`deterministic_visible_recovery_forbidden:${action}`)
}

module.exports = {
  BUDGET_OBJECTION_LINES,
  DOUBLE_CHECK_REVISION_REASONS,
  isDoubleCheckRevisionReason,
  liveTurnCarriesCheckpointRevisionEvidence,
  liveTurnIsInfoSideQuestion,
  CHECKPOINT_NEUTRAL_NUDGES,
  doubleCheckRevisionAskText,
  buildDoubleCheckRevisionAskPacket,
  DETERMINISTIC_RECOVERY_VERSION,
  SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES,
  PREFERRED_FORM_LINK,
  SAFE_CLARIFICATION_TEXT,
  ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
  buildSafeClarificationRecoveryPacket,
  buildRouteAwareVisibleRecoveryPacket,
  inputAuthorizesSafeClarificationRecovery,
  isSafeClarificationRecoveryPacket,
  isRouteAwareVisibleRecoveryPacket,
  isSendFormRecoveryPacket,
  buildDeterministicRecoveryPacket
}
