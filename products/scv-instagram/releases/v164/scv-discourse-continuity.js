#!/usr/bin/env node
// ============================================================
// SCV DISCOURSE CONTINUITY
//
// General context-dependency resolver for live Instagram turns. This is not a
// phrase patch. It distinguishes a coherent continuation, a referent resolved by
// recent history, a self-contained topic shift, a likely split attachment, and a
// genuinely missing referent. The model may classify by meaning; code validates
// and adopts only a bounded route label. This module never authors visible copy.
// ============================================================

const {
  isConversationVisibleAssistantEvent
} = require('./scv-history-visibility.js')

const SCV_DISCOURSE_CONTINUITY_VERSION =
  'scv-discourse-continuity-2026-08-25-v22-rejected-date-continuation-authority'

const DISCOURSE_RELATIONS = Object.freeze({
  COHERENT: 'coherent',
  RESOLVED_FROM_HISTORY: 'resolved_from_history',
  SELF_CONTAINED_TOPIC_SHIFT: 'self_contained_topic_shift',
  MISSING_ATTACHMENT: 'missing_attachment',
  AMBIGUOUS_MISSING_REFERENT: 'ambiguous_missing_referent',
  UNINTELLIGIBLE: 'unintelligible'
})

const DISCOURSE_RELATION_SET = new Set(Object.values(DISCOURSE_RELATIONS))
const CONFIDENCE_SET = new Set(['high', 'medium', 'low'])

function stripVoiceWrapper(value) {
  return String(value || '')
    .replace(/^sent\s+a\s+voice\s+note\s+saying\s*:\s*/i, '')
    .replace(/^voice\s+note\s*:\s*/i, '')
    .trim()
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function recentEvents(recentHistory = [], limit = 24) {
  return (Array.isArray(recentHistory) ? recentHistory : [])
    .filter((event) => (
      event &&
      typeof event === 'object' &&
      String(event.text || event.message || '').trim() &&
      (
        String(event.role || '') === 'user' ||
        isConversationVisibleAssistantEvent(event)
      )
    ))
    .slice(-Math.max(1, Number(limit) || 24))
}

function currentTurnHasAuthoritativeVisualReference(state = {}) {
  return Boolean(
    state.live_turn_is_media_reference === true ||
    (
      state.live_turn_media_vision_used === true &&
      state.live_turn_is_voice_note !== true &&
      state.live_turn_deposit_proof_media !== true
    )
  )
}

function eventHasAuthoritativeVisualReference(event = {}) {
  if (!event || typeof event !== 'object') return false
  if (String(event.role || '').toLowerCase() !== 'user') return false
  const text = String(event.text || event.message || '').trim()
  const source = String(event.text_source || '').toLowerCase()

  // Transport initially labels both Instagram voice notes and visual shares as
  // "sent a reference post".  After ASR, the final text is a voice transcript,
  // but text_source intentionally preserves that transport ancestry.  Source
  // residue is provenance, not visual evidence: a voice note can never become
  // the unseen picture merely because its source contains "reference_post" or
  // the generic media-context-enriched marker.
  if (
    /^sent\s+a\s+voice\s+note\s+saying\s*:/i.test(text) ||
    event.live_turn_is_voice_note === true ||
    /(?:^|[|._-])(?:voice|audio|asr|transcript)(?:$|[|._-])/i.test(source)
  ) return false

  const describedVisual = /^(?:sent|shared)\s+a\s+(?:reference\s+post|photo|picture|image|media)\s*:\s*\S/i.test(text)
  const directImageUrl = /(?:https?:\/\/\S+\.(?:jpe?g|png|gif|webp)(?:\?\S*)?|^data:image\/)/i.test(text)
  const typedVisualSource = /(?:^|[|._-])(?:vision|image|photo|picture)(?:$|[|._-])/i.test(source)
  return describedVisual || directImageUrl || typedVisualSource
}

function sameObservedTurn(event = {}, currentValue = '') {
  const current = normalizeText(currentValue)
  if (!current) return false
  const values = [
    event.text,
    event.message,
    event.authority_observed_live_turn_text
  ].map((value) => normalizeText(value)).filter(Boolean)
  return values.includes(current)
}

// Instagram can split one human action across several ingress events:
//   pointer -> studio asks for the actual reference -> visual -> short
//   correction/selector.  The final text is not a new topic merely because it
//   superseded the visual at transport level.  Model the bounded discourse
//   composition instead of cataloguing complete sentences.
function lightweightReferenceBridge(value) {
  const compact = normalizeText(stripVoiceWrapper(value))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[,:;!?()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!compact) return false

  const tokens = compact.match(/[\p{L}\p{N}']+/gu) || []
  if (tokens.length > 12) return false

  const correctionCue = /\b(?:oops|wait|sorry|sry|my\s+bad|i\s+(?:mean|meant)|wrong|right|correct|fixed)\b/i.test(compact)
  const deliveryCue = /\b(?:sent|send|here|there|got)\b/i.test(compact)
  const selectorCue = /\b(?:this|that|it)(?:\s+(?:one|pic|photo|picture|image|screenshot|post|reference|ref))?\b/i.test(compact)
  if (!(correctionCue || deliveryCue || selectorCue)) return false

  // Every lexical unit must belong to the correction/delivery/selector
  // vocabulary. This lets "sorry, my bad this one", "I meant that photo", and
  // "oops, wrong one — this one" share one rule while rejecting a substantive
  // new message that merely starts with an apology.
  const residue = compact
    .replace(/\b(?:oh|oops|wait|hold\s+on|sorry|sry|my\s+bad|that\s+was\s+my\s+bad|i\s+(?:mean|meant)|what\s+i\s+meant|wrong|right|correct|fixed|no|not|actually)\b/gi, ' ')
    .replace(/\b(?:(?:i\s+)?just\s+)?(?:sent|send|here|there|got)(?:\s+it|\s+it\s+is)?\b/gi, ' ')
    .replace(/\b(?:this|that|it)(?:\s+(?:one|pic|photo|picture|image|screenshot|post|reference|ref))?\b/gi, ' ')
    .replace(/\b(?:the|one|is|was|now)\b/gi, ' ')
    .replace(/[\s.-]+/g, '')
  return residue === ''
}

// Some Instagram media-only sends render in the client UI but never arrive in
// the ManyChat text webhook.  A later correction can still prove that the user
// performed the exact delivery action the studio requested, but only inside one
// tightly bounded dialogue pair.  This detector establishes delivery/selection
// intent; it never claims access to the image contents.
function bridgeSignalsDeliveredReference(value) {
  if (!lightweightReferenceBridge(value)) return false
  const compact = normalizeText(stripVoiceWrapper(value))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[,:;!?()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!compact) return false

  const selectorCue = /\b(?:this|that|it)(?:\s+(?:one|pic|photo|picture|image|screenshot|post|reference|ref))?\b/i.test(compact)
  const explicitVisualCue = /\b(?:pic|photo|picture|image|screenshot|post|reference|ref)\b/i.test(compact)
  const correctionCue = /\b(?:oops|wait|sorry|sry|my\s+bad|i\s+(?:mean|meant)|wrong|right|correct|fixed)\b/i.test(compact)
  const deliveryCue = (
    /\b(?:here|there)\s+it\s+is\b/i.test(compact) ||
    /\b(?:i\s+)?(?:just\s+)?sent\s+(?:it|this|that|the\s+(?:pic|photo|picture|image|screenshot|post|reference|ref))\b/i.test(compact) ||
    /\b(?:sent|send|here|there)\s+(?:this|that)\s+(?:one|pic|photo|picture|image|screenshot|post|reference|ref)\b/i.test(compact)
  )
  return deliveryCue || (correctionCue && (selectorCue || explicitVisualCue))
}

function assistantRequestsActualReference(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  return Boolean(
    /\b(?:send|show|share|drop|throw|attach|upload)\b.{0,85}\b(?:actual\s+)?(?:photo|pic|picture|image|screenshot|post|reference|ref|design)\b/i.test(text) ||
    /\b(?:can|could|would)\s+you\b.{0,45}\b(?:send|show|share|drop|attach|upload)\b/i.test(text)
  )
}

function assistantMaintainsVisualSelectionFocus(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text || !/[?？]/.test(text)) return false
  if (assistantRequestsActualReference(text)) return false

  const selectionObject = /\b(?:part|element|aspect|detail|bit|piece|face|subject|person|number|digit|color|colour|shape|word|text|vibe|direction|look|energy|focus)\b/i.test(text)
  const visualAnchor = /\b(?:this|that|it|image|photo|picture|screenshot|post|reference|ref|design|piece)\b/i.test(text)
  const salienceQuestion = /\b(?:catch(?:es|ing)?\s+(?:your\s+)?eye|stand(?:s|ing)?\s+out|feel(?:s|ing)?\s+right|drawn\s+to|like\s+about)\b/i.test(text)
  return (selectionObject && visualAnchor) || salienceQuestion
}

function historyWithoutObservedCurrent(recentHistory = [], currentValue = '', limit = 18) {
  const events = recentEvents(recentHistory, limit)
  while (events.length && sameObservedTurn(events[events.length - 1], currentValue)) {
    events.pop()
  }
  return events
}

function currentAnswersVisualSelection(value) {
  const currentBody = stripVoiceWrapper(value)
  const currentTokens = normalizeText(currentBody).match(/[\p{L}\p{N}']+/gu) || []
  return (
    attachmentDependentVisualReference(currentBody) ||
    explicitConcreteReferentNomination(currentBody) ||
    (
      currentTokens.length <= 24 &&
      /\b(?:like|love|want|mean|meant|pick|picked|choose|chose|use|keep|include|focus|drawn)\b/i.test(currentBody) &&
      /\b(?:number|digit|face|person|subject|word|text|letter|shape|color|colour|detail|part|element|background|outline|composition)\b/i.test(currentBody)
    )
  )
}

function requestedReferencePrelude(events = [], boundaryIndex = events.length) {
  let index = Math.min(events.length, Math.max(0, Number(boundaryIndex) || 0)) - 1
  const requestPacket = []
  while (index >= 0 && isConversationVisibleAssistantEvent(events[index])) {
    requestPacket.unshift(events[index])
    index -= 1
  }
  if (!requestPacket.length || requestPacket.length > 4) return null

  const messageIds = new Set(
    requestPacket
      .map((event) => String(event.message_id || '').trim())
      .filter(Boolean)
  )
  if (messageIds.size > 1 || (messageIds.size === 0 && requestPacket.length > 1)) return null
  const requestEvent = requestPacket.find((event) =>
    assistantRequestsActualReference(String(event.text || event.message || ''))
  )
  if (!requestEvent) return null

  const pointerEvent = events[index]
  if (
    !pointerEvent ||
    String(pointerEvent.role || '').toLowerCase() !== 'user' ||
    !attachmentDependentVisualReference(String(pointerEvent.text || pointerEvent.message || ''))
  ) return null

  return {
    pointer_event: pointerEvent,
    request_event: requestEvent,
    request_packet: requestPacket
  }
}

// Transport-shadow authority is deliberately narrower than visual authority:
//   pointer -> one assistant request packet -> delivery selector/correction
// and, optionally, one immediately following visual-selection question.
// It proves only that the requested reference was delivered. It does not expose
// or authorize any claim about pixels, motifs, colors, text, or composition.
function transportShadowReferenceFulfillmentChain(recentHistory = [], currentValue = '') {
  const events = historyWithoutObservedCurrent(recentHistory, currentValue, 18)
  if (!events.length) return null

  if (bridgeSignalsDeliveredReference(currentValue)) {
    const prelude = requestedReferencePrelude(events, events.length)
    if (!prelude) return null
    return {
      authority_kind: 'transport_shadow_requested_reference',
      visual_event: null,
      pointer_event: prelude.pointer_event,
      request_event: prelude.request_event,
      bridge_event: null,
      selection_question_event: null
    }
  }

  if (!currentAnswersVisualSelection(currentValue)) return null

  let bridgeIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (String(event.role || '').toLowerCase() !== 'user') continue
    if (bridgeSignalsDeliveredReference(String(event.text || event.message || ''))) {
      bridgeIndex = index
    }
    break
  }
  if (bridgeIndex < 0) return null

  const prelude = requestedReferencePrelude(events, bridgeIndex)
  if (!prelude) return null

  const afterBridge = events.slice(bridgeIndex + 1)
  if (!afterBridge.length || afterBridge.some((event) => !isConversationVisibleAssistantEvent(event))) return null
  const messageIds = new Set(
    afterBridge
      .map((event) => String(event.message_id || '').trim())
      .filter(Boolean)
  )
  if (messageIds.size > 1 || (messageIds.size === 0 && afterBridge.length > 1)) return null
  const selectionQuestion = afterBridge.find((event) =>
    assistantMaintainsVisualSelectionFocus(String(event.text || event.message || ''))
  )
  if (!selectionQuestion) return null

  return {
    authority_kind: 'transport_shadow_requested_reference',
    visual_event: null,
    pointer_event: prelude.pointer_event,
    request_event: prelude.request_event,
    bridge_event: events[bridgeIndex],
    selection_question_event: selectionQuestion
  }
}

// Return the exact visual event only when one bounded requested-reference chain
// proves that it is still the live antecedent.  This is deliberately stricter
// than "there was an image somewhere in history": a random/stale image cannot
// jump topics, while a transport-superseded requested image remains usable.
function observedRequestedReferenceFulfillmentChain(recentHistory = [], currentValue = '') {
  const events = historyWithoutObservedCurrent(recentHistory, currentValue, 18)
  if (!events.length) return null

  let visualIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (eventHasAuthoritativeVisualReference(events[index])) {
      visualIndex = index
      break
    }
  }
  if (visualIndex < 0) return null

  let requestIndex = -1
  for (let index = visualIndex - 1; index >= Math.max(0, visualIndex - 5); index -= 1) {
    const event = events[index]
    if (
      isConversationVisibleAssistantEvent(event) &&
      assistantRequestsActualReference(String(event.text || event.message || ''))
    ) {
      requestIndex = index
      break
    }
    // A different client turn between the request and the visual breaks the
    // pair. Multi-bubble assistant packets are allowed.
    if (String(event.role || '').toLowerCase() === 'user') break
  }
  if (requestIndex < 0) return null

  let pointerIndex = -1
  for (let index = requestIndex - 1; index >= Math.max(0, requestIndex - 5); index -= 1) {
    const event = events[index]
    if (String(event.role || '').toLowerCase() !== 'user') continue
    if (attachmentDependentVisualReference(String(event.text || event.message || ''))) {
      pointerIndex = index
    }
    break
  }
  if (pointerIndex < 0) return null

  const afterVisual = events.slice(visualIndex + 1)
  const userAfter = afterVisual.filter((event) => String(event.role || '').toLowerCase() === 'user')
  const assistantAfter = afterVisual.filter((event) => isConversationVisibleAssistantEvent(event))
  if (userAfter.length > 1 || assistantAfter.length > 1) return null
  if (userAfter.some((event) => !lightweightReferenceBridge(String(event.text || event.message || '')))) return null

  const currentIsBridge = lightweightReferenceBridge(currentValue)
  if (currentIsBridge) {
    // The correction itself owns the requested visual only before a later
    // assistant response starts a new dialogue pair.
    if (assistantAfter.length) return null
  } else if (afterVisual.length) {
    if (!currentAnswersVisualSelection(currentValue)) return null

    // A later referential answer can remain grounded only when it directly
    // answers one visual-selection question. No unrelated assistant turn or
    // open "send the image" request may be used as invented evidence.
    if (
      assistantAfter.length !== 1 ||
      !assistantMaintainsVisualSelectionFocus(String(assistantAfter[0].text || assistantAfter[0].message || '')) ||
      events[events.length - 1] !== assistantAfter[0]
    ) return null
  } else {
    return null
  }

  return {
    authority_kind: 'observed_visual_requested_reference',
    visual_event: events[visualIndex],
    pointer_event: events[pointerIndex],
    request_event: events[requestIndex],
    bridge_event: userAfter[0] || null,
    selection_question_event: assistantAfter[0] || null
  }
}

function requestedReferenceFulfillmentChain(recentHistory = [], currentValue = '') {
  return (
    observedRequestedReferenceFulfillmentChain(recentHistory, currentValue) ||
    transportShadowReferenceFulfillmentChain(recentHistory, currentValue)
  )
}

function recentHistoryHasAuthoritativeReference(recentHistory = [], currentValue = '') {
  const userEvents = recentEvents(recentHistory, 12)
    .filter((event) => String(event.role || '').toLowerCase() === 'user')

  // Depending on the call site, the current ingress may already have been
  // appended to history. Remove only the exact observed current turn; then the
  // immediately preceding client turn is the sole history candidate. An older
  // image cannot jump over a later compliment, voice note, or unrelated message
  // and silently become the referent for a fresh opaque "this one".
  while (userEvents.length && sameObservedTurn(userEvents[userEvents.length - 1], currentValue)) {
    userEvents.pop()
  }
  const adjacentPriorUserTurn = userEvents[userEvents.length - 1]
  if (eventHasAuthoritativeVisualReference(adjacentPriorUserTurn)) return true
  return Boolean(requestedReferenceFulfillmentChain(recentHistory, currentValue))
}

function adjacentPriorUserTurn(recentHistory = [], currentValue = '') {
  const userEvents = recentEvents(recentHistory, 12)
    .filter((event) => String(event.role || '').toLowerCase() === 'user')
  while (userEvents.length && sameObservedTurn(userEvents[userEvents.length - 1], currentValue)) {
    userEvents.pop()
  }
  return userEvents[userEvents.length - 1] || null
}

function lastAssistantQuestion(recentHistory = []) {
  const events = recentEvents(recentHistory, 10)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!isConversationVisibleAssistantEvent(event)) continue
    const text = String(event.text || event.message || '').trim()
    if (text) return text
  }
  return ''
}

function assistantQuestionCanGroundShortReply(value) {
  const question = String(value || '').trim()
  if (!question || !/[?？]/.test(question)) return false

  // An open clarification request does not create the missing object it asks
  // the client to provide.  Without this boundary, "send me the actual pic"
  // can be recycled as evidence that a later "that/it/over there" was already
  // grounded.  Only a real closed choice or explicit referent confirmation may
  // authorize an elliptical answer.
  const openClarification = (
    /\b(?:what|which|who|where|when|how)\b/i.test(question) ||
    /\b(?:send|show|share|drop|forward|attach|upload)\b.{0,80}\b(?:pic|photo|picture|image|post|reference|ref|link|thing|one|it|that|this)\b/i.test(question) ||
    /\b(?:dont|don't|do not|cant|can't|cannot)\s+(?:see|tell|know|find|open)\b/i.test(question)
  )
  if (openClarification) return false

  const closedChoice = /\b(?:or|either|first|second|third|former|latter|option)\b/i.test(question)
  const explicitReferentConfirmation = /\b(?:do|did|are|were|is|was)\s+(?:you\s+)?(?:mean|referring\s+to|talking\s+about|pointing\s+to)\b/i.test(question)
  return closedChoice || explicitReferentConfirmation
}

function shortReplyCanResolveFromHistory(body, recentHistory = []) {
  const compact = normalizeText(body)
  const tokens = compact.match(/[\p{L}\p{N}']+/gu) || []
  if (!compact || tokens.length > 9) return false
  const priorQuestion = lastAssistantQuestion(recentHistory)
  if (!assistantQuestionCanGroundShortReply(priorQuestion)) return false
  return (
    /^(?:the\s+)?(?:first|second|third|other|last|same|former|latter)(?:\s+one)?[.!?\s]*$/i.test(compact) ||
    /^(?:this|that|it|those|these)(?:\s+one)?(?:\s+(?:works?|is\s+good|is\s+fine|please))?[.!?\s]*$/i.test(compact) ||
    /^(?:yeah|yes|yep|sure|okay|ok)\s+(?:this|that|it|the\s+(?:first|second|other)\s+one)[.!?\s]*$/i.test(compact) ||
    /^(?:(?:yeah|yes|yep|sure|okay|ok)\s+)?(?:this|that)\s+(?:way|direction|side|spot|area)(?:\s+please)?[.!?\s]*$/i.test(compact)
  )
}

// A prior design, image, or location may be real without identifying the
// direction selected by the current turn.  Open spatial/directional deixis is a
// different evidence dimension: "the snake" does not prove what "over there"
// points to.  Keep this detector semantic and open-vocabulary; it classifies the
// dependency shape and never authors visible copy.
function openSpatialDirectionalDeicticDependency(value) {
  const body = stripVoiceWrapper(value)
  const compact = normalizeText(body)
  if (!compact) return false

  const explicitDirectionalPhrase = (
    /\b(?:over|right|back|up|down)\s+(?:here|there)\b/i.test(body) ||
    /\b(?:this|that)\s+(?:way|direction|side|spot|area|place)\b/i.test(body)
  )
  if (explicitDirectionalPhrase) return true

  // Exclude existential "there" ("is there parking", "there is a form"). It
  // does not point at a missing location even when another intent verb appears.
  const locativeHereThere = (
    /\b(?:here|there)\b/i.test(body) &&
    !/\bthere\s+(?:is|are|was|were|will|would|can|could|should|has|have|had)\b/i.test(body) &&
    !/\b(?:is|are|was|were|will|would|can|could|should|has|have|had)\s+there\b/i.test(body)
  )
  if (!locativeHereThere) return false

  const orientationOrMotion = /\b(?:go|going|gone|head|heading|headed|lean|leaning|move|moving|take|taking|push|pushing|aim|aiming|land|landing|end|ending|point|pointing|angle|angling|shift|shifting|turn|turning|try|trying|tryna|want|wanting|think|thinking|look|looking|feel|feeling|something|anything|more)\b/i.test(body)
  const dependentCompanion = /\b(?:it|this|that|one|ones|same|with\s+it|with\s+that)\b/i.test(body)
  return orientationOrMotion || dependentCompanion
}

function classifierAntecedentIsGrounded(classified = {}, recentHistory = []) {
  const antecedent = normalizeText(classified.antecedent || '')
  if (antecedent.length < 3) return false
  const corpus = normalizeText(recentEvents(recentHistory, 24)
    .map((event) => String(event.text || event.message || ''))
    .join('\n'))
  return Boolean(corpus && corpus.includes(antecedent))
}

// A quote can exist verbatim in history without identifying anything.  Generic
// acknowledgements, greetings, compliments, open hosting prompts, and vague
// placeholder language are conversational events, not referent authority.  The
// classifier may use a prior turn only when the quoted text itself carries a
// concrete person/object/place/action identity.  This keeps the gate semantic:
// it rejects whole classes of non-evidence rather than patching one inspected
// phrase such as "yeah sure".
function antecedentTextCarriesReferentAuthority(value) {
  const body = stripVoiceWrapper(value)
  const compact = normalizeText(body)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (compact.length < 3) return false

  const genericAcknowledgement = /^(?:(?:yeah+|yea+|yes+|yep+|yup+|sure|sure thing|of course|okay|ok|alright|right|cool|nice|perfect|awesome|great|gotcha|bet|word|for sure|definitely|totally|sounds good|that works|i got you|got you|thanks?|thank you|lol|lmao|haha+)[\s,!.:-]*)+$/i
  if (genericAcknowledgement.test(compact)) return false

  const greetingOrSmallTalk = /^(?:hey+|hi+|hello+|yo+|sup|what'?s up|how are you|how'?s it going|good (?:morning|afternoon|evening|night))(?:\s+(?:there|again|today|tonight))?$/i
  if (greetingOrSmallTalk.test(compact)) return false

  const portfolioCompliment = /^(?:(?:i|we)\s+)?(?:really\s+)?(?:love|like|dig|enjoy)\s+(?:your|the)\s+(?:style|work|art|pieces?|profile|page|stuff|tattoos?)(?:\s+(?:so much|a lot))?$/i
  if (portfolioCompliment.test(compact)) return false

  const broadOpenPrompt = (
    /^(?:(?:hey|yeah|okay|ok|so)\s+)*(?:what|which|how)\b.{0,120}\b(?:mind|vibe|idea|thing|something|anything|feeling|feel|thinking|want|wanting|looking for)\b/i.test(compact) ||
    /^(?:(?:hey|yeah|okay|ok|so)\s+)*(?:send|show|share|drop|throw|tell|give)\b.{0,120}\b(?:anything|something|idea|vibe|reference|ref|thing|whatever)\b/i.test(compact)
  )
  if (broadOpenPrompt) return false

  // Reject a quote made entirely of discourse glue and contextless placeholder
  // words. A real identity such as "my brother", "upper arm", or "black and
  // grey snake" leaves at least one concrete lexical anchor outside this set.
  const weakTokens = new Set([
    'a', 'about', 'again', 'all', 'an', 'and', 'anything', 'are', 'as', 'at',
    'away', 'be', 'been', 'being', 'but', 'by', 'can', 'could', 'definitely',
    'direction', 'do', 'does', 'doing', 'done', 'feel', 'feeling', 'for',
    'from', 'go', 'going', 'good', 'got', 'great', 'had', 'has', 'have', 'he',
    'her', 'here', 'hey', 'him', 'his', 'how', 'i', "i'm", 'idea', 'if', 'in',
    'is', 'it', "it's", 'just', 'kinda', 'kind', 'later', 'like', 'look',
    'looking', 'love', 'me', 'mind', 'more', 'my', 'nice', 'of', 'ok', 'okay',
    'on', 'one', 'ones', 'or', 'our', 'over', 'perfect', 'please', 'right',
    'same', 'she', 'so', 'some', 'something', 'sort', 'sounds', 'spot', 'stuff',
    'style', 'sure', 'that', "that's", 'the', 'their', 'them', 'there', 'these',
    'they', 'thing', 'things', 'thinking', 'this', 'those', 'to', 'totally',
    'toward', 'towards', 'tryna', 'up', 'us', 'vibe', 'want', 'wanted',
    'wanting', 'was', 'way', 'we', "we're", 'were', 'what', "what's", 'where',
    'which', 'who', 'why', 'with', 'works', 'would', 'yeah', 'yes', 'you',
    "you're", 'your'
  ])
  const tokens = compact.match(/[\p{L}\p{N}']+/gu) || []
  return tokens.some((token) => !weakTokens.has(token))
}

// A client can resolve an image question by naming the exact visible element.
// "I mean the pink doughnut" is not another opaque pointer: the noun phrase
// supplied in the same turn is the missing referent. This gate protects that
// direct client evidence from being downgraded by a probabilistic classifier,
// while generic placeholders ("that part", "the vibe") and transactional nouns
// ("the form") remain unresolved. It classifies meaning only; it never authors
// visible wording or assumes that the surrounding image is itself a tattoo.
function explicitConcreteReferentNomination(value) {
  const body = stripVoiceWrapper(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!body) return false

  const selection = body.match(
    /^(?:sorry[,\s]+)?(?:i\s*(?:mean|meant)\b|what\s+i\s+mean\s+is|i(?:'m|\s+am)\s+(?:talking|asking)\s+about|i(?:'m|\s+am)\s+pointing\s+to|i(?:'m|\s+am)\s+into|it(?:'s|\s+is)|just|only|specifically|mainly)\s+(.+?)[.!?\s]*$/i
  )
  if (!selection) return false

  const candidate = String(selection[1] || '')
    .split(/[.!?;\r\n]+/)[0]
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '')
    .trim()
  const tokens = candidate.match(/[\p{L}\p{N}']+/gu) || []
  if (!candidate || tokens.length === 0 || tokens.length > 18) return false

  const processOnly = /^(?:(?:the|this|that)\s+)?(?:thing|one|part|bit|piece|element|aspect|detail|vibe|style|design|idea|reference|ref|photo|picture|image|screenshot|post|form|link|application|booking|appointment|date|day|time|deposit|address|location|price|rate|cost|process|next\s+step)$/i
  if (processOnly.test(candidate)) return false
  if (
    /\b(?:this|that|it|these|those)(?:\s+one)?\b/i.test(candidate) ||
    attachmentDependentVisualReference(candidate)
  ) return false
  return antecedentTextCarriesReferentAuthority(candidate)
}

function contextualVisualAsrReferentNomination(value, recentHistory = []) {
  if (explicitConcreteReferentNomination(value)) return true

  const body = stripVoiceWrapper(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  // Speech recognition can collapse "I mean the X" into "I'm in the X".
  // Never repair that phonetic shape by phrase alone. The adjacent client turn
  // must contain actual visual evidence and the named object must share a
  // concrete lexical anchor with that evidence.
  const match = body.match(/^(?:sorry[,\s]+)?i(?:'m|\s+am)\s+in\s+(.+?)[.!?\s]*$/i)
  if (!match) return false
  const candidate = String(match[1] || '').replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').trim()
  if (!candidate || !antecedentTextCarriesReferentAuthority(candidate)) return false

  const prior = adjacentPriorUserTurn(recentHistory, value)
  if (!eventHasAuthoritativeVisualReference(prior)) return false

  const normalizeToken = (token) => token.toLowerCase().replace(/^doughnut$/, 'donut')
  const weak = new Set(['a', 'an', 'and', 'at', 'in', 'inside', 'of', 'on', 'the', 'this', 'that', 'one', 'thing', 'part', 'image', 'photo', 'picture', 'screenshot', 'post'])
  const candidateTokens = (candidate.match(/[\p{L}\p{N}']+/gu) || [])
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !weak.has(token))
  const evidenceTokens = new Set(
    (String(prior.text || prior.message || '').match(/[\p{L}\p{N}']+/gu) || []).map(normalizeToken)
  )
  return candidateTokens.some((token) => evidenceTokens.has(token))
}

function classifierAntecedentHasIndependentAuthority(classified = {}, recentHistory = []) {
  const antecedent = normalizeText(classified.antecedent || '')
  if (antecedent.length < 3) return false
  if (!antecedentTextCarriesReferentAuthority(antecedent)) return false
  const events = recentEvents(recentHistory, 24)

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    const text = String(event.text || event.message || '').trim()
    if (!text || !normalizeText(text).includes(antecedent)) continue

    // A model-authored clarification question is not an external anchor.  A
    // closed choice may ground a short answer through the dedicated gate above;
    // an open request for the missing object may never become its own evidence.
    if (isConversationVisibleAssistantEvent(event) && /[?？]/.test(text)) {
      if (!assistantQuestionCanGroundShortReply(text)) continue
    }

    const relation = structuralDiscourseRelation(text, {}, events.slice(0, index))
    if (
      relation === DISCOURSE_RELATIONS.MISSING_ATTACHMENT ||
      relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT ||
      relation === DISCOURSE_RELATIONS.UNINTELLIGIBLE
    ) continue
    return true
  }
  return false
}

function classifierResolutionHasReferentAuthority(classified = {}, value = '', recentHistory = [], structural = '') {
  if (!classifierAntecedentIsGrounded(classified, recentHistory)) return false

  // A literal quote existing in history proves only that the model copied text.
  // It does NOT prove that the quote identifies the object/person/choice the
  // client is pointing at.  In particular, an open studio prompt such as "what
  // kind of idea are you thinking about?" cannot become authority for an unseen
  // "this one".  For media-shaped deictic turns, require actual media authority
  // or an immediately answerable closed-choice reply.  This is an evidence-tier
  // law, not a phrase-specific response script.
  if (structural === DISCOURSE_RELATIONS.MISSING_ATTACHMENT) {
    return (
      recentHistoryHasAuthoritativeReference(recentHistory, value) ||
      shortReplyCanResolveFromHistory(value, recentHistory)
    )
  }

  // The same authority law applies to open-vocabulary pointers.  A literal
  // quote such as "I want something in that direction" is still unresolved if
  // that earlier turn never named or supplied the object.  String presence is
  // provenance, not referent authority.
  if (
    structural === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT ||
    structural === DISCOURSE_RELATIONS.UNINTELLIGIBLE
  ) {
    // Directional/spatial deixis requires evidence in the same dimension. A
    // prior concrete tattoo brief or prior image cannot identify the unnamed
    // direction. Only a genuinely immediate closed-choice/explicit-referent
    // answer may resolve it from history; current-turn media was already granted
    // direct authority before this gate.
    if (openSpatialDirectionalDeicticDependency(value)) {
      return shortReplyCanResolveFromHistory(value, recentHistory)
    }

    return (
      recentHistoryHasAuthoritativeReference(recentHistory, value) ||
      shortReplyCanResolveFromHistory(value, recentHistory) ||
      classifierAntecedentHasIndependentAuthority(classified, recentHistory)
    )
  }

  return true
}

function liveTurnHasDirectTransactionalAuthority(state = {}) {
  // A deterministically parsed full calendar date is current-turn booking
  // authority. The inductive discourse classifier may not relabel it as an
  // unnamed object merely because the surface form begins with "How about".
  // Keep this grant evidence-bound: a day without a resolved month has no ISO
  // value and must continue through the existing month-clarification route.
  const liveDateStatus = String(state.live_turn_date_status || '').trim().toLowerCase()
  const liveDatePhrase = String(state.live_turn_date_phrase || '').trim()
  const liveDateIso = String(state.live_turn_date_iso || '').trim()
  const liveTurnHasExplicitBookingDate = (
    ['legal', 'too_soon'].includes(liveDateStatus) &&
    Boolean(liveDatePhrase) &&
    /^\d{4}-\d{2}-\d{2}$/.test(liveDateIso)
  )

  return Boolean(
    state.live_turn_deposit_sent === true ||
    state.live_turn_deposit_proof_media === true ||
    state.live_turn_form_consent === true ||
    state.live_turn_explicit_form_request === true ||
    state.live_turn_form_submitted_signal === true ||
    state.live_turn_accepts_offered_slot === true ||
    state.live_turn_pricing_question === true ||
    state.live_turn_contextual_booking_reply === true ||
    liveTurnHasExplicitBookingDate
  )
}

function attachmentDependentVisualReference(value) {
  const body = stripVoiceWrapper(value)
  return (
    /\b(?:thinking|looking|leaning|going|settling)\s+(?:of|about|toward|towards|with|on)?\s*(?:this|that|it|these|those)(?:\s+one)?\b/i.test(body) ||
    /\b(?:want|wanna|like|love|picked|chose|choose|prefer)\s+(?:something\s+)?(?:like\s+|closer\s+to\s+|based\s+on\s+)?(?:this|that|it|these|those)(?:\s+one)?\b/i.test(body) ||
    /\b(?:can|could|would)\s+(?:i|we|you)\s+(?:do|make|get|use)\s+(?:something\s+)?(?:like\s+)?(?:this|that|it)(?!\s+(?:this|that)\s+way)(?:\s+one)?\b/i.test(body) ||
    /\b(?:something|anything|a\s+piece|a\s+tattoo|a\s+design)\s+(?:more\s+)?(?:like|similar\s+to|based\s+on)\s+(?:this|that|it)\b/i.test(body) ||
    /\b(?:along\s+(?:these|those)\s+lines|same\s+(?:energy|vibe|style|idea|look)\s+as\s+(?:this|that)|closer\s+to\s+(?:this|that)|more\s+like\s+(?:this|that))\b/i.test(body) ||
    /\b(?:go|going|lean|leaning|thinking|looking|want(?:ing)?|something|anything|more)\b.{0,40}\b(?:in|toward|towards)\s+(?:this|that)\s+(?:direction|style|vibe|look)\b/i.test(body) ||
    /\b(?:what\s+about|how\s+about)\s+(?:this|that)(?:\s+one)?\b/i.test(body) ||
    /^(?:this|that|these|those)(?:\s+one)?[.!?\s]*$/i.test(body) ||
    /\b(?:this|that)\s+(?:pic|photo|picture|image|reference|ref|post|screenshot|design|style|vibe|idea|look|piece)\b/i.test(body) ||
    /\b(?:this|that|these|those)\s+(?:is|are|was|were)\b.{0,55}\b(?:what|how)\s+(?:i|we)\s+(?:had\s+in\s+mind|(?:was|were)\s+thinking(?:\s+of)?|wanted|want)\b/i.test(body) ||
    /(?:이거|이걸|이런\s*(?:느낌|스타일|디자인)|저거|저런\s*(?:느낌|스타일|디자인)).{0,35}(?:생각|원해|하고\s*싶|가능|비슷)/i.test(body)
  )
}

// A later pronoun can be fully grounded by a concrete noun phrase introduced
// earlier in the same client message.  For example:
//   "I want a black and gray portrait. I want it detailed, not too dark."
// The second sentence depends on "it", but not on an unseen attachment.  Keep
// this authority narrow: the antecedent must precede the pointer, carry a
// concrete lexical anchor, and must not itself depend on "this/that/it".
// This resolves the discourse relation only; the separate design-intake gate
// still decides whether the supplied idea is concrete enough to offer a form.
function sameTurnIntroducesReferentBeforePointer(value) {
  const body = stripVoiceWrapper(value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!body) return false

  // A client can also define an earlier opaque pronoun inside the same clause:
  //   "It's a black and gray portrait of a woman. I want it detailed."
  // The copular complement supplies the object identity directly; it is not a
  // request to infer an unseen image. Keep the grant narrow: require an article
  // or possessive plus a concrete lexical anchor, reject transactional/generic
  // placeholders, and reject any complement that still points to this/that/it.
  const firstClause = body.split(/[.!?;\r\n]+/)[0].trim()
  const copularDefinition = firstClause.match(
    /^(?:it|this|that)(?:'s|\s+(?:is|was))\s+(?:a|an|the|my|our|his|her|their)\s+(.+)$/i
  )
  if (copularDefinition) {
    const candidate = String(copularDefinition[1] || '')
      .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '')
      .trim()
    const genericOrTransactional = /^(?:thing|one|part|bit|piece|element|aspect|detail|vibe|style|design|idea|reference|ref|photo|picture|image|screenshot|post|form|link|application|booking|appointment|date|day|time|deposit|address|location|price|rate|cost|process|next\s+step)$/i
    const unresolvedPointer = /\b(?:this|that|it|these|those)(?:\s+one)?\b/i
    if (
      candidate &&
      !genericOrTransactional.test(candidate) &&
      !unresolvedPointer.test(candidate) &&
      !attachmentDependentVisualReference(candidate) &&
      antecedentTextCarriesReferentAuthority(candidate)
    ) return true
  }

  const clauses = body
    .split(/(?:[.!?;]+|[\r\n]+|,\s+(?=(?:and|but|then)\b))/i)
    .map((clause) => clause.trim())
    .filter(Boolean)
  if (clauses.length < 2) return false

  const introductionPatterns = [
    /\b(?:want(?:ed)?|would\s+(?:like|love)|(?:am|are|was|were|'m|'re)\s+(?:thinking\s+(?:of|about)|considering)|(?:have|has|had)\s+been\s+(?:thinking\s+(?:of|about)|considering)|have\s+in\s+mind)\s+(?:a|an|the|my|our)\s+(.+)$/i,
    /\b(?:my|our)\s+(?:idea|design|piece|tattoo|plan)\s+(?:is|was|would\s+be)\s+(?:(?:a|an|the|my|our)\s+)?(.+)$/i
  ]

  for (let index = 0; index < clauses.length - 1; index += 1) {
    const clause = clauses[index]
    let candidate = ''
    for (const pattern of introductionPatterns) {
      const match = clause.match(pattern)
      if (!match) continue
      candidate = String(match[1] || '').replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').trim()
      if (candidate) break
    }
    if (!candidate) continue

    // "a tattoo like this" still relies on missing visual evidence and cannot
    // manufacture authority for a later "it".
    if (
      attachmentDependentVisualReference(candidate) ||
      !antecedentTextCarriesReferentAuthority(candidate)
    ) continue

    const laterText = clauses.slice(index + 1).join('. ')
    // The later clause does not have to look like an attachment request. A
    // normal question such as "How much is it?" still carries an anaphoric
    // pronoun whose authority comes from the concrete noun phrase above. The
    // introduction gate is deliberately stronger than this pointer check, so
    // opaque openings such as "I want a tattoo like this" remain rejected.
    const laterAnaphoricPointer = /\b(?:it|them|they|this|that|these|those)\b/i.test(laterText)
    if (attachmentDependentVisualReference(laterText) || laterAnaphoricPointer) return true
  }
  return false
}

function structuralDiscourseRelation(value, state = {}, recentHistory = []) {
  const body = stripVoiceWrapper(value)
  const compact = normalizeText(body)
  if (!compact) return DISCOURSE_RELATIONS.COHERENT

  // Real current-turn visual evidence owns the turn immediately. Directional
  // language paired with an actual image is grounded; the same words without
  // that image remain unresolved below.
  if (currentTurnHasAuthoritativeVisualReference(state)) {
    return DISCOURSE_RELATIONS.COHERENT
  }

  // A requested-reference chain is a complete bounded discourse object.  This
  // includes the transport-shadow variant where Instagram rendered the image
  // but ManyChat omitted its media-only webhook.  The chain proves only that the
  // requested reference was delivered; downstream wording remains forbidden
  // from inventing visual details.
  if (requestedReferenceFulfillmentChain(recentHistory, value)) {
    return DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY
  }

  // The current client turn itself names the object. No historical guess or
  // model-created antecedent is required.
  if (contextualVisualAsrReferentNomination(body, recentHistory)) {
    return DISCOURSE_RELATIONS.COHERENT
  }

  // An unnamed spatial/directional pointer is not automatically a request for
  // an attachment.  Keep this broader ambiguity family ahead of the narrower
  // visual-pointer detector so phrases such as "over there" or "in that
  // direction" ask what the client means rather than falsely demanding a
  // photo.  Only an immediately answerable closed choice can resolve it.
  if (openSpatialDirectionalDeicticDependency(body)) {
    if (shortReplyCanResolveFromHistory(body, recentHistory)) {
      return DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY
    }
    return DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT
  }

  // A concrete antecedent supplied earlier in this same message is direct
  // client evidence.  It resolves a later "it/that" without borrowing an old
  // image, a model guess, or a generated clarification.
  if (sameTurnIntroducesReferentBeforePointer(body)) {
    return DISCOURSE_RELATIONS.COHERENT
  }

  // A design-shaped visual pointer is a stronger structural object than a
  // candidate transaction flag. It can be grounded only by a current visual,
  // the immediately adjacent prior client visual, or an explicit closed choice.
  // This prevents stale deposit/form state or an LLM intent label from washing
  // an unseen "this one" into a coherent booking continuation.
  const attachmentDependent = attachmentDependentVisualReference(body)
  if (attachmentDependent) {
    if (
      recentHistoryHasAuthoritativeReference(recentHistory, value) ||
      shortReplyCanResolveFromHistory(body, recentHistory)
    ) {
      return DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY
    }
    return DISCOURSE_RELATIONS.MISSING_ATTACHMENT
  }

  if (liveTurnHasDirectTransactionalAuthority(state)) {
    return DISCOURSE_RELATIONS.COHERENT
  }

  // Emoji-only turns are real, self-contained social input.  They are not an
  // empty attachment envelope and may not inherit an old tattoo/form route.
  if (!/[\p{L}\p{N}]/u.test(body) && /\p{Extended_Pictographic}/u.test(body)) {
    return DISCOURSE_RELATIONS.SELF_CONTAINED_TOPIC_SHIFT
  }

  // Self-contained demonstratives are not missing context.
  if (
    /\bthis\s+(?:saturday|sunday|weekend|week|month|morning|afternoon|evening|time|date|address|location)\b/i.test(body) ||
    /^(?:this|that)\s+(?:is|was|sounds?|looks?)\s+(?:perfect|good|fine|okay|ok|right|correct|great)[.!?\s]*$/i.test(body) ||
    /^(?:that|it)\s+works(?:\s+for\s+me)?[.!?\s]*$/i.test(body)
  ) return DISCOURSE_RELATIONS.COHERENT

  // Open-vocabulary deictic floor.  A short turn can depend on an unnamed
  // direction/object without using the familiar "this one" wording.  The
  // finite part of this problem is the English deictic system (this/that/it,
  // here/there, one/ones), not a catalog of complete user sentences.  Two or
  // more unresolved pointers, or a spatial pointer attached to movement, are
  // therefore context-dependent until an authoritative antecedent is found.
  // A high-confidence classifier may still resolve the turn from an exact
  // grounded antecedent later in applyDiscourseClassification.
  const deicticMarkers = compact.match(/\b(?:this|that|it|these|those|here|there|one|ones|same|former|latter)\b/g) || []
  if (deicticMarkers.length >= 2) {
    if (recentHistoryHasAuthoritativeReference(recentHistory, value) || shortReplyCanResolveFromHistory(body, recentHistory)) {
      return DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY
    }
    return DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT
  }

  // A bare imperative whose object is only it/that/this has no authority by
  // itself.  If an actual transactional offer is open, the direct-live gate at
  // the top already owns it.  Otherwise require the model/history resolver to
  // identify a grounded antecedent instead of guessing a form, photo, or action.
  const actionPointer = /^(?:please\s+)?(?:send|share|show|drop|forward|give|use|do|make|change|fix|open|remove|delete)\s+(?:it|that|this|one)(?:\s+please)?[?？.!,\s]*$/i.test(body)
  if (actionPointer) return DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT

  const ambiguousDependent = (
    /^(?:how|why|what)\s+(?:about|does|is|was|with)?\s*(?:that|this|it)(?:\s+work)?[?？.!\s]*$/i.test(body) ||
    /\b(?:can|could|would)\s+you\s+(?:do|make|change|fix|use)\s+(?:that|this|it)(?:\s+(?:this|that)\s+way|\s+way)?\b/i.test(body) ||
    /^(?:that|this|it)\s+(?:part|one|thing|way)[?？.!\s]*$/i.test(body) ||
    /^(?:the\s+)?(?:other|same|first|second|third|last)(?:\s+one)?[?？.!\s]*$/i.test(body) ||
    /\b(?:what|which)\s+(?:one|part|thing|way)\b/i.test(body) ||
    /^(?:(?:but|so|yeah|nah|okay|ok)\s+)?(?:he|she|they)\s+(?:said|told|asked|wants?|doesn['’]?t|didn['’]?t|won['’]?t|can['’]?t|is|was)\b/i.test(body)
  )

  if (ambiguousDependent) {
    if (shortReplyCanResolveFromHistory(body, recentHistory)) return DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY
    return DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT
  }

  return DISCOURSE_RELATIONS.COHERENT
}

function normalizeDiscourseClassification(value = {}) {
  const raw = value && typeof value === 'object' ? value : {}
  const relation = String(raw.context_relation || raw.relation || '').trim().toLowerCase()
  const confidence = String(raw.context_confidence || raw.confidence || '').trim().toLowerCase()
  return {
    relation: DISCOURSE_RELATION_SET.has(relation) ? relation : DISCOURSE_RELATIONS.COHERENT,
    confidence: CONFIDENCE_SET.has(confidence) ? confidence : 'low',
    reason_code: String(raw.context_reason_code || raw.reason_code || '').trim().slice(0, 80),
    antecedent: String(raw.context_antecedent_quote || raw.antecedent || '').replace(/\s+/g, ' ').trim().slice(0, 180)
  }
}

function applyDiscourseClassification(stateValue = {}, classificationValue = null, value = '', recentHistory = []) {
  const state = stateValue && typeof stateValue === 'object' ? stateValue : {}
  const requestedReferenceChain = requestedReferenceFulfillmentChain(recentHistory, value)
  const structural = structuralDiscourseRelation(value, state, recentHistory)
  const classified = normalizeDiscourseClassification(classificationValue || {})
  let relation = structural
  let confidence = structural === DISCOURSE_RELATIONS.COHERENT ? 'low' : 'high'
  let source = structural === DISCOURSE_RELATIONS.COHERENT ? 'none' : 'structural_floor'

  // The model creates no facts. It may only select one bounded discourse route.
  // High-confidence semantic classification generalizes beyond phrase lists.
  if (classified.confidence === 'high') {
    if (structural === DISCOURSE_RELATIONS.COHERENT) {
      if (classified.relation === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY) {
        if (
          classifierResolutionHasReferentAuthority(classified, value, recentHistory, structural)
        ) {
          relation = classified.relation
          confidence = classified.confidence
          source = 'llm_history_resolution_verified'
        } else {
          relation = DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT
          confidence = 'high'
          source = 'llm_history_resolution_rejected_no_grounded_antecedent'
        }
      } else {
        relation = classified.relation
        confidence = classified.confidence
        source = 'llm_inductive_classifier'
      }
    } else if (
      classified.relation === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY &&
      classifierResolutionHasReferentAuthority(classified, value, recentHistory, structural)
    ) {
      relation = classified.relation
      confidence = classified.confidence
      source = 'llm_history_resolution_verified'
    }
  }

  if (
    currentTurnHasAuthoritativeVisualReference(state) ||
    (
      liveTurnHasDirectTransactionalAuthority(state) &&
      structural !== DISCOURSE_RELATIONS.MISSING_ATTACHMENT
    )
  ) {
    relation = DISCOURSE_RELATIONS.COHERENT
    confidence = 'high'
    source = state.live_turn_context_resolution_source === 'prior_rejected_client_date_continuation'
      ? 'prior_rejected_client_date_continuation'
      : 'direct_live_authority'
  }

  if (contextualVisualAsrReferentNomination(value, recentHistory)) {
    relation = DISCOURSE_RELATIONS.COHERENT
    confidence = 'high'
    source = explicitConcreteReferentNomination(value)
      ? 'explicit_concrete_referent_authority'
      : 'contextual_visual_asr_referent_authority'
  }

  if (sameTurnIntroducesReferentBeforePointer(value)) {
    relation = DISCOURSE_RELATIONS.COHERENT
    confidence = 'high'
    source = 'same_turn_referent_authority'
  }

  state.live_turn_context_relation = relation
  state.live_turn_context_confidence = confidence
  state.live_turn_context_resolution_source = source
  state.live_turn_context_reason_code = classified.reason_code
  state.live_turn_context_missing = (
    relation === DISCOURSE_RELATIONS.MISSING_ATTACHMENT ||
    relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT ||
    relation === DISCOURSE_RELATIONS.UNINTELLIGIBLE
  )
  state.live_turn_context_missing_attachment = relation === DISCOURSE_RELATIONS.MISSING_ATTACHMENT
  state.live_turn_context_needs_clarification = (
    relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT ||
    relation === DISCOURSE_RELATIONS.UNINTELLIGIBLE
  )
  state.live_turn_context_resolved_from_history = relation === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY
  state.live_turn_self_contained_topic_shift = relation === DISCOURSE_RELATIONS.SELF_CONTAINED_TOPIC_SHIFT
  state.live_turn_reference_authority_kind = requestedReferenceChain
    ? String(requestedReferenceChain.authority_kind || '')
    : ''
  state.live_turn_transport_shadow_reference = Boolean(
    state.live_turn_context_resolved_from_history === true &&
    requestedReferenceChain?.authority_kind === 'transport_shadow_requested_reference'
  )

  // Compatibility flag consumed by the already-locked transport grace path.
  state.live_turn_reference_pointer_without_media = state.live_turn_context_missing_attachment
  return state
}

function buildDiscourseClassifierHistory(recentHistory = [], limit = 24, maxChars = 8000) {
  const lines = recentEvents(recentHistory, limit).map((event) => {
    const role = isConversationVisibleAssistantEvent(event) ? 'Studio' : 'Client'
    const text = String(event.text || event.message || '').replace(/\s+/g, ' ').trim().slice(0, 600)
    return `${role}: ${text}`
  })
  let joined = lines.join('\n')
  if (joined.length > maxChars) joined = joined.slice(joined.length - maxChars)
  return joined
}

module.exports = {
  SCV_DISCOURSE_CONTINUITY_VERSION,
  DISCOURSE_RELATIONS,
  stripVoiceWrapper,
  eventHasAuthoritativeVisualReference,
  lightweightReferenceBridge,
  bridgeSignalsDeliveredReference,
  assistantRequestsActualReference,
  assistantMaintainsVisualSelectionFocus,
  transportShadowReferenceFulfillmentChain,
  requestedReferenceFulfillmentChain,
  recentHistoryHasAuthoritativeReference,
  attachmentDependentVisualReference,
  sameTurnIntroducesReferentBeforePointer,
  assistantQuestionCanGroundShortReply,
  shortReplyCanResolveFromHistory,
  classifierAntecedentIsGrounded,
  antecedentTextCarriesReferentAuthority,
  explicitConcreteReferentNomination,
  contextualVisualAsrReferentNomination,
  classifierAntecedentHasIndependentAuthority,
  classifierResolutionHasReferentAuthority,
  openSpatialDirectionalDeicticDependency,
  structuralDiscourseRelation,
  normalizeDiscourseClassification,
  applyDiscourseClassification,
  buildDiscourseClassifierHistory
}
