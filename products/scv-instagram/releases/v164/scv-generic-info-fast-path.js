#!/usr/bin/env node
'use strict'

// ============================================================
// GENERIC INFO FAST PATH (owner directive 2026-09-02, live incident
// legacy-manychat-6818f3db…): "Can I please get more information?" from the
// code-locked debug identity spent 53 s in the model/verifier reauthor loop
// (non_authoring_guard -> info_opener_requires_customization_open_door ->
// placement_possibility_branch) and then shipped the generic recovery line
// "got you i have your message but i haven't changed anything while i verify
// the next step what would you like me to handle first?".
//
// A self-contained general information request that carries no concrete motif,
// no media, no booking fact and no money question is now answered by a bounded
// deterministic packet BEFORE the optional intent classifier and before any
// model call. The packet is still contract-checked by deterministicAuthorityOutput;
// if the live contract rejects it the turn falls back to the model lane exactly
// as before, so this path can only remove a failure surface, never add one.
//
// Boundaries that stay owned by the existing lanes:
//   - a concrete motif inside the question ("more info about a capybara tattoo")
//   - price / rate / cost questions (pricing floor owes a visible rate answer)
//   - media turns, deposit-sent claims, controller repair passes
//   - an ungrounded "how does this work" (existing referent clarification lane)
//   - non-Latin live text (visible-English contract + model authoring)
// ============================================================

const crypto = require('crypto')

const SCV_GENERIC_INFO_FAST_PATH_VERSION =
  'scv-generic-info-fast-path-2026-09-04-v3-live-text-authority'
const GENERIC_INFO_FAST_PATH_EXECUTOR = 'deterministic_generic_info_fast_path'
const GENERIC_INFO_FAST_PATH_KIND = 'self_contained_generic_info_request'
const GENERIC_INFO_FAST_PATH_ROUTE = 'self_contained_generic_info_request_fast_path'
const GENERIC_INFO_FAST_PATH_ALLOWED_ACTIONS = Object.freeze([
  'design_intake',
  'general_continue',
  'tattoo_continue'
])
const MAX_SELF_CONTAINED_INFO_REQUEST_CHARS = 240

// ------------------------------------------------------------
// 2026-09-03 live incident (Omar.system, "Hi, can I please get more
// information?" sent right after the four-field checkpoint had gone out). The
// v142 route read the client-anchored reference from durable state as "concrete
// design direction", so the direct-info route was lost, the fast path was
// refused at the await stage, the model lane exhausted three verifier passes
// (88 s) and the route-aware recovery shipped the which-field revision ask to a
// client who had asked for information. A self-contained information request
// while the checkpoint is open is a SIDE QUESTION: the thread stays at
// await_double_check_confirmation under the reason below, the fast path is
// admitted there, the answer explains the model spot and hands the thread back
// to the pending confirmation. The checkpoint is neither confirmed, revised nor
// abandoned by it.
// ------------------------------------------------------------
const GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_ACTION = 'await_double_check_confirmation'
const GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON = 'side_question_info_request_keep_checkpoint_open'
// Second bubble at the open checkpoint: no greeting, no design question, no
// comma / trailing period / dash, none of the deposit or payment vocabulary the
// await-stage verifier reads as a second confirmation request, and a "tell me /
// lmk" host lead motion so the await stage is not a dead end.
// Each line also keeps the customization door open (profile / highlights as
// inspo, own idea welcome, "customize"), because the info-opener verifier
// requires that door on every reply to an information request.
const CHECKPOINT_RESUME_LINES = Object.freeze([
  'you can use my profile or story highlights as inspo or bring your own idea and i can customize it 🖤 everything i sent you right above is still the same on my side just tell me if you want anything changed',
  'my highlights work as inspo and your own idea is totally open to customize too everything i sent right before this still stands nothing moved on my end lmk if you want to change any of it',
  'feel free to pull inspo from my profile or send your own idea and i can customize it for you 🖤 all the info above is still exactly how i have it so let me know if anything on there needs changing'
])

// Typo / casing / punctuation tolerant shapes of the same request. The exact
// production phrase is covered by the first alternative; the rest cover the
// live variants the owner listed ("Hi, can I get more info?", "More info
// please", "I'm interested, could you give me some details?").
const INFO_REQUEST_TYPO_TOLERANT_RE = new RegExp([
  '\\b(?:can|could|may|cud|cn)\\s+(?:i|u|you)\\s+(?:please\\s+|plz\\s+|pls\\s+|pleas\\s+)?(?:get|have|know|recieve|receive|give\\s+me|send\\s+me|tell\\s+me)\\s+(?:some\\s+|a\\s+(?:little|bit)\\s+)?(?:more\\s+)?(?:info|infos|information|informaton|infomation|imformation|informatio|details|detials|deets)\\b',
  '\\b(?:more|some)\\s+(?:info|infos|information|informaton|infomation|imformation|details|detials|deets)\\b',
  '\\binfo\\s*(?:please|pls|plz)\\b',
  '\\bi(?:[\'’]?m|\\s+am)\\s+(?:really\\s+|very\\s+|so\\s+|super\\s+|def(?:initely)?\\s+)?(?:interested|intrested|interessted)\\b'
].join('|'), 'i')

const GENERIC_BOOKING_PROCESS_RE = new RegExp([
  '\\bhow\\s+(?:do|can|could|would|should)\\s+(?:i|we)\\s+(?:go\\s+about\\s+)?(?:book|get\\s+booked|make\\s+an?\\s+(?:appointment|booking)|schedule|get\\s+started|start)\\b',
  '\\bhow\\s+does\\s+(?:the\\s+)?(?:booking|this\\s+process|the\\s+process)\\s+work\\b',
  '\\bwhat(?:[\'’]?s|\\s+is)\\s+the\\s+(?:booking\\s+)?process\\b',
  '\\bhow\\s+to\\s+book\\b'
].join('|'), 'i')

const GENERIC_HOW_THIS_WORKS_RE =
  /\b(?:can|could|would)\s+(?:you|u)\s+(?:please\s+)?(?:tell|explain\s+to|walk)\s+me\s+how\s+(?:this|that|it|the\s+(?:model\s+spots?|offer|booking|process))\s+works?\b/i

const NEGATED_INTEREST_RE = /\b(?:not|no\s+longer|never|isn[’']?t|aren[’']?t)\s+(?:really\s+)?(?:interested|intrested)\b|\bnot\s+interested\b/i
const NON_LATIN_TEXT_RE = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Thai}]/u
const PRICING_QUESTION_RE = /\b(price|prices|pricing|rate|rates|cost|costs|charge|charges|how much|quote)\b|얼마|가격|요금/i

// Every variant: bubble 1 explains the model spot (limited / a few spots, made
// from what the client wants, finished piece stays in the artist's style);
// bubble 2 points at profile / story highlights as inspiration, keeps custom
// ideas open, and leaves exactly one easy next move. No commas, no trailing
// periods, no dashes, no hey opener, no form / rate / date / deposit words,
// none of the banned consultant vocabulary. Wording varies per message so the
// same thread never receives the same visible text twice in a row.
const GENERIC_INFO_VARIANTS = Object.freeze([
  Object.freeze({
    first: 'sure!! so a model spot is one of the few spots i open for pieces made from what you want while the finished tattoo stays in my style 🖤',
    second: 'you can look through my profile and story highlights for inspo or if you already have something in mind i can customize a piece for you :) just send me any loose idea or reference'
  }),
  Object.freeze({
    first: 'yess of course!! the model spot is basically a limited spot i keep open for a few pieces in my style and the tattoo gets made around what you want 🖤',
    second: 'my highlights have some flashes you can use as inspo and custom ideas are totally open too :) what kind of piece or vibe were you thinking?'
  }),
  Object.freeze({
    first: 'of course!! so i only open a few model spots and those are for pieces made from what you want while the finished piece stays in my own style',
    second: 'if you want ideas the flashes on my story highlights are a good place to look and if you have your own idea i can customize something for you 🖤 lmk what you have in mind'
  }),
  Object.freeze({
    first: 'sure thing!! a model spot is a limited spot i open for a few pieces in my style and we make the tattoo from what you want 🖤',
    second: 'you can scroll my profile and highlights for inspo or if there is already an idea in your head i can customize it for you :) tell me what you are thinking'
  }),
  Object.freeze({
    first: 'yes!! so the model spot is one of the few spots i open for pieces in my style and the piece itself gets made from what you actually want 🖤',
    second: 'the flashes in my story highlights work as inspo and i can also customize an idea of your own :) send me whatever you have in mind even if it is loose'
  }),
  Object.freeze({
    first: 'sure!! a model spot is a spot i keep open for just a few pieces in my style and the tattoo is made from what you want 🖤',
    second: 'my profile and story highlights are there for inspo and if you already have an idea i can customize it for you :) just lmk what you are into'
  })
])

const GREETING_RETURN_PREFIXES = Object.freeze([
  'hiii!!',
  'hi hi!!',
  'hiii tysm for reaching out!!'
])

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

// v159 (live 2026-09-07 04:28Z, Omar.system): a voice note asking "Hi, can I please get more
// information?" was transcribed, yet the audio attachment made this turn count as media — the
// fixed info answer stayed off, the model lane failed, and the recovery sent the image-part ask
// ("I see the image what part of it…"). A resolved voice transcript is TEXT: the audio is transport.
function liveTurnIsResolvedVoiceText(input) {
  const state = input?.structured_state || {}
  const text = String(input?.live_message || input?.message || input?.text || state.live_turn_text || '').trim()
  const transcribed = /^sent\s+a\s+voice\s+note\s+saying\s*:\s*\S/i.test(text)
  if (!transcribed) return false
  if (state.live_turn_voice_transcribe_failed === true || state.live_turn_voice_context_unresolved === true) return false
  if (/\b(could not be understood|couldn'?t be understood|unintelligible|transcription failed)\b/i.test(text)) return false
  return true
}

function hasLiveMedia(input) {
  const state = input?.structured_state || {}
  if (liveTurnIsResolvedVoiceText(input)) return false
  if (Array.isArray(input?.media_urls) && input.media_urls.length > 0) return true
  if (String(input?.media_type || '').trim()) return true
  return Boolean(
    state.live_turn_is_media_reference === true ||
    state.live_turn_context_missing_attachment === true ||
    state.live_turn_reference_pointer_without_media === true ||
    state.live_turn_deposit_proof_media === true ||
    state.live_turn_media_kind
  )
}

function planIsCheckpointSideQuestion(plan) {
  if (!plan || typeof plan !== 'object') return false
  return (
    String(plan.action || '').trim() === GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_ACTION &&
    String(plan.reason || '').trim() === GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON
  )
}

// The single admission rule shared by the runner (eligibility) and the control
// plane (receipt gate) so the two cannot drift: the non-transactional routes,
// or the await stage under the checkpoint side-question reason only.
function genericInfoFastPathAdmitsPlan(plan) {
  if (!plan || typeof plan !== 'object') return true
  const action = String(plan.action || '').trim()
  if (!action) return true
  if (GENERIC_INFO_FAST_PATH_ALLOWED_ACTIONS.includes(action)) return true
  return planIsCheckpointSideQuestion(plan)
}

function controllerActionCompatible(input) {
  return genericInfoFastPathAdmitsPlan(input?.control_transition_contract)
}

function inputIsCheckpointSideQuestion(input) {
  return planIsCheckpointSideQuestion(input?.control_transition_contract)
}

// Text-level shape of a generic information request, independent of the
// controller plan and of durable design state. The closed-transition contract
// uses it to recognise the side question while the checkpoint is open; the
// pricing / negation / non-Latin / length boundaries mirror
// evaluateGenericInfoFastPath so the contract never routes a turn here that the
// fast path would then refuse.
function liveTextIsGenericInfoRequest(rawText, options = {}) {
  const raw = String(rawText || '').trim()
  if (!raw) return false
  if (raw.length > MAX_SELF_CONTAINED_INFO_REQUEST_CHARS) return false
  if (NON_LATIN_TEXT_RE.test(raw)) return false
  if (PRICING_QUESTION_RE.test(raw)) return false
  if (NEGATED_INTEREST_RE.test(raw)) return false
  if (typeof options.liveInfoAskOpener === 'function' && options.liveInfoAskOpener()) return true
  return INFO_REQUEST_TYPO_TOLERANT_RE.test(raw)
}

function historyEvents(input) {
  return Array.isArray(input?.recent_history) ? input.recent_history : []
}

function hasAnyHistory(input) {
  return historyEvents(input).some((event) => {
    const role = String(event?.role || event?.sender || '').toLowerCase()
    return role === 'user' || role === 'assistant' || role === 'assistant_attempted'
  })
}

// Every assistant text that has already gone out (visible, or provider-accepted
// but visibility-unknown) counts. The drift monitor treats a consecutive
// duplicate visible assistant text as a critical alert, so an accepted attempt
// must be avoided exactly like a confirmed one.
function recentAssistantTexts(input) {
  return historyEvents(input)
    .filter((event) => {
      const role = String(event?.role || '').toLowerCase()
      return role === 'assistant' || role === 'assistant_attempted'
    })
    .map((event) => normalizeText(event?.text || event?.message || ''))
    .filter(Boolean)
}

function evaluateGenericInfoFastPath(input, deps = {}) {
  const requireDep = (name) => {
    if (typeof deps[name] !== 'function') throw new Error(`generic_info_fast_path_dependency_missing:${name}`)
    return deps[name]
  }
  const liveInputText = requireDep('liveInputText')
  const stripMachineMediaNarration = requireDep('stripMachineMediaNarration')
  const liveInfoAskOpener = requireDep('liveInfoAskOpener')
  const liveHasConcreteDesignDirection = requireDep('liveHasConcreteDesignDirection')
  const liveGenericHowWorksNeedsReferent = requireDep('liveGenericHowWorksNeedsReferent')
  const liveDetailedTattooIdea = requireDep('liveDetailedTattooIdea')
  const liveDepositHoldSignal = requireDep('liveDepositHoldSignal')
  const threadHasTattooProgress = requireDep('threadHasTattooProgress')

  const ineligible = (reason) => ({ eligible: false, reason, trigger: '' })
  const raw = String(stripMachineMediaNarration(liveInputText(input)) || '').trim()
  if (!raw) return ineligible('live_text_empty')
  if (raw.length > MAX_SELF_CONTAINED_INFO_REQUEST_CHARS) return ineligible('live_text_not_self_contained_length')
  if (NON_LATIN_TEXT_RE.test(raw)) return ineligible('non_latin_live_text_model_lane')
  if (String(input?.control_transition_repair || '').trim()) return ineligible('control_repair_pass_requires_model_reauthor')
  if (!controllerActionCompatible(input)) return ineligible('controller_route_not_generic_info')
  if (hasLiveMedia(input)) return ineligible('live_turn_carries_media')
  if (liveDepositHoldSignal(input)) return ineligible('deposit_hold_lane')
  if (PRICING_QUESTION_RE.test(raw)) return ineligible('pricing_question_owes_rate_answer')
  if (NEGATED_INTEREST_RE.test(raw)) return ineligible('negated_interest')

  let trigger = ''
  if (liveInfoAskOpener(input)) {
    trigger = 'info_ask_opener'
  } else if (INFO_REQUEST_TYPO_TOLERANT_RE.test(raw)) {
    trigger = 'info_request_typo_tolerant'
  } else if (GENERIC_HOW_THIS_WORKS_RE.test(raw)) {
    // "can you tell me how this works?" is only self-explanatory when the
    // offer is already the shared referent: either the thread already carries
    // the tattoo/model context, or this is the first message of the thread
    // (the ManyChat ad flow is the only thing "this" can point at).
    if (liveGenericHowWorksNeedsReferent(input) && hasAnyHistory(input)) {
      return ineligible('generic_how_works_referent_unresolved')
    }
    trigger = 'generic_how_this_works'
  } else if (GENERIC_BOOKING_PROCESS_RE.test(raw)) {
    if (threadHasTattooProgress(input)) return ineligible('booking_process_question_inside_active_tattoo_thread')
    trigger = 'generic_booking_process'
  } else {
    return ineligible('not_a_generic_info_request')
  }

  if (inputIsCheckpointSideQuestion(input)) {
    // With the four-field checkpoint open the design is already settled, so the
    // durable design-direction / reference evidence in state describes the
    // booking, not this turn. The live text was already bounded above (no
    // motif, no price, no media); the contract only derives the side-question
    // reason from these shapes. Letting durable state refuse the side question
    // is exactly what pushed the live turn into the model lane and onto the
    // which-field recovery ask.
    if (trigger !== 'info_ask_opener' && trigger !== 'info_request_typo_tolerant') return ineligible('checkpoint_side_question_shape_mismatch')
    return { eligible: true, reason: 'self_contained_generic_info_request', trigger, checkpoint_side_question: true }
  }
  // Eligibility belongs to the current utterance, not to durable thread memory.
  // v150 evaluated these guards against the whole structured state, so a prior
  // dagger/reference made the self-contained live sentence "hi can i please get
  // more information" look like a concrete design brief.  The controller then
  // resumed POST_FORM_IDENTITY and the turn could exhaust into silence.  Retain
  // the motif exclusion, but evaluate it on an isolated view of this live text.
  const liveOnlyInput = {
    message: raw,
    live_message: raw,
    recent_history: [],
    media_urls: [],
    media_type: '',
    structured_state: { live_turn_text: raw }
  }
  if (liveHasConcreteDesignDirection(liveOnlyInput)) return ineligible('concrete_design_direction_present')
  if (liveDetailedTattooIdea(liveOnlyInput)) return ineligible('detailed_tattoo_idea_present')
  return { eligible: true, reason: 'self_contained_generic_info_request', trigger, checkpoint_side_question: false }
}

// Deterministic side-question bubbles at the open checkpoint: an explanation
// variant the thread has not seen (only the two most recent assistant lines are
// excluded when every variant has been used, mirroring the drift monitor's
// consecutive-duplicate rule) plus a resume line that hands the thread back to
// the pending confirmation. No greeting by construction: the assistant just
// sent the four-field block, so the thread is mid-conversation.
function buildCheckpointSideQuestionBubbles(input, liveText) {
  const { startIndex } = selectVariant(input, liveText)
  const recentTexts = recentAssistantTexts(input)
  const seen = new Set(recentTexts)
  const lastTwo = new Set(recentTexts.slice(-2))
  let chosenIndex = -1
  for (let offset = 0; offset < GENERIC_INFO_VARIANTS.length; offset += 1) {
    const variantIndex = (startIndex + offset) % GENERIC_INFO_VARIANTS.length
    if (!seen.has(normalizeText(GENERIC_INFO_VARIANTS[variantIndex].first))) { chosenIndex = variantIndex; break }
  }
  if (chosenIndex < 0) {
    for (let offset = 0; offset < GENERIC_INFO_VARIANTS.length; offset += 1) {
      const variantIndex = (startIndex + offset) % GENERIC_INFO_VARIANTS.length
      if (!lastTwo.has(normalizeText(GENERIC_INFO_VARIANTS[variantIndex].first))) { chosenIndex = variantIndex; break }
    }
  }
  if (chosenIndex < 0) return null
  const resumeStart = parseInt(sha256(`${normalizeText(liveText)}|${chosenIndex}`).slice(0, 8), 16) % CHECKPOINT_RESUME_LINES.length
  let resume = ''
  for (let offset = 0; offset < CHECKPOINT_RESUME_LINES.length; offset += 1) {
    const candidate = CHECKPOINT_RESUME_LINES[(resumeStart + offset) % CHECKPOINT_RESUME_LINES.length]
    if (!lastTwo.has(normalizeText(candidate))) { resume = candidate; break }
  }
  if (!resume) return null
  return {
    bubbles: [
      { text: GENERIC_INFO_VARIANTS[chosenIndex].first, delay_ms: 0 },
      { text: resume, delay_ms: 0 }
    ],
    variant_index: chosenIndex,
    greeting_returned: false,
    checkpoint_side_question: true
  }
}

function selectVariant(input, liveText) {
  const seed = sha256(
    `${String(input?.thread_id || input?.contact_id || '')}|${String(input?.message_id || '')}|${normalizeText(liveText)}`
  )
  const startIndex = parseInt(seed.slice(0, 8), 16) % GENERIC_INFO_VARIANTS.length
  const greetingIndex = parseInt(seed.slice(8, 16), 16) % GREETING_RETURN_PREFIXES.length
  return { startIndex, greetingIndex }
}

function buildGenericInfoFastPathBubbles(input, deps = {}) {
  const liveInputText = deps.liveInputText
  const stripMachineMediaNarration = deps.stripMachineMediaNarration
  const freshInfoGreetingReturnRequired = deps.freshInfoGreetingReturnRequired
  if (
    typeof liveInputText !== 'function' ||
    typeof stripMachineMediaNarration !== 'function' ||
    typeof freshInfoGreetingReturnRequired !== 'function'
  ) throw new Error('generic_info_fast_path_dependency_missing:bubbles')

  const liveText = String(stripMachineMediaNarration(liveInputText(input)) || '').trim()
  if (inputIsCheckpointSideQuestion(input)) return buildCheckpointSideQuestionBubbles(input, liveText)
  const { startIndex, greetingIndex } = selectVariant(input, liveText)
  const greetingReturned = freshInfoGreetingReturnRequired(input) === true
  const prefix = greetingReturned ? `${GREETING_RETURN_PREFIXES[greetingIndex]} ` : ''
  const seen = new Set(recentAssistantTexts(input))

  for (let offset = 0; offset < GENERIC_INFO_VARIANTS.length; offset += 1) {
    const variantIndex = (startIndex + offset) % GENERIC_INFO_VARIANTS.length
    const variant = GENERIC_INFO_VARIANTS[variantIndex]
    const first = `${prefix}${variant.first}`.trim()
    const second = variant.second
    if (seen.has(normalizeText(first)) || seen.has(normalizeText(second))) continue
    return {
      bubbles: [
        { text: first, delay_ms: 0 },
        { text: second, delay_ms: 0 }
      ],
      variant_index: variantIndex,
      greeting_returned: greetingReturned,
      checkpoint_side_question: false
    }
  }
  return null
}

function genericInfoFastPathAuthorityMarker(details = {}) {
  return {
    executor: GENERIC_INFO_FAST_PATH_EXECUTOR,
    deterministic_fast_path: GENERIC_INFO_FAST_PATH_KIND,
    fast_path_version: SCV_GENERIC_INFO_FAST_PATH_VERSION,
    fast_path_trigger: String(details.trigger || ''),
    fast_path_variant_index: Number.isInteger(details.variant_index) ? details.variant_index : -1,
    fast_path_greeting_returned: details.greeting_returned === true,
    fast_path_checkpoint_side_question: details.checkpoint_side_question === true,
    model_call_skipped: true,
    intent_classifier_skipped: true
  }
}

function candidateIsGenericInfoFastPath(candidate) {
  const authority = candidate?.authority || {}
  const flags = candidate?.packet?.authority_transport_flags || {}
  const bubbles = Array.isArray(candidate?.packet?.bubbles) ? candidate.packet.bubbles : []
  return Boolean(
    String(authority.executor || '') === GENERIC_INFO_FAST_PATH_EXECUTOR &&
    String(authority.deterministic_fast_path || '') === GENERIC_INFO_FAST_PATH_KIND &&
    String(authority.fast_path_version || '') === SCV_GENERIC_INFO_FAST_PATH_VERSION &&
    String(authority.model || 'none') === 'none' &&
    flags.generic_info_fast_path === true &&
    String(flags.reason || '') === GENERIC_INFO_FAST_PATH_ROUTE &&
    bubbles.length >= 1 && bubbles.length <= 2 &&
    bubbles.every((bubble) => String(bubble?.text || '').trim())
  )
}

module.exports = {
  SCV_GENERIC_INFO_FAST_PATH_VERSION,
  GENERIC_INFO_FAST_PATH_EXECUTOR,
  GENERIC_INFO_FAST_PATH_KIND,
  GENERIC_INFO_FAST_PATH_ROUTE,
  GENERIC_INFO_FAST_PATH_ALLOWED_ACTIONS,
  GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_ACTION,
  GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON,
  CHECKPOINT_RESUME_LINES,
  GENERIC_INFO_VARIANTS,
  GREETING_RETURN_PREFIXES,
  INFO_REQUEST_TYPO_TOLERANT_RE,
  GENERIC_BOOKING_PROCESS_RE,
  GENERIC_HOW_THIS_WORKS_RE,
  evaluateGenericInfoFastPath,
  buildGenericInfoFastPathBubbles,
  buildCheckpointSideQuestionBubbles,
  genericInfoFastPathAuthorityMarker,
  genericInfoFastPathAdmitsPlan,
  planIsCheckpointSideQuestion,
  inputIsCheckpointSideQuestion,
  liveTextIsGenericInfoRequest,
  hasLiveMedia,
  liveTurnIsResolvedVoiceText,
  candidateIsGenericInfoFastPath
}
