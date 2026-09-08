#!/usr/bin/env node

const crypto = require('crypto')
const path = require('path')
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))

const SCV_OPENAI_CONVERSATION_VERSION =
  'scv-openai-responses-conversation-2026-08-24-v7-native-chain-visible-reconciliation'
const SCV_RESPONSES_CONVERGENCE_BASELINE = 'chatgpt_contextual_conversation_quality'
const SCV_RESPONSES_CONVERGENCE_FIELD_VERSION =
  'scv-rcc-revas-pre-inference-convergence-field-2026-08-24-v1'
const RESPONSE_ID_RE = /^resp_[A-Za-z0-9_-]{8,240}$/
const MAX_VISIBLE_LEDGER_EVENTS = 200
const MAX_VISIBLE_LEDGER_CHARS = 180000

const CONTEXT_DEPENDENT_REPLY_RE = /^(?:yes+(?: please| pls| plz)?|yea+h?(?: please| pls| plz)?|yep(?: please)?|yup(?: please)?|sure(?: thing| please)?|ok(?:ay)?(?: sure)?|perfect|sounds good|that works|works for me|go ahead|send it|please|pls|plz|done|i sent it|sent it|correct|looks good|all good|for sure|of course|absolutely|definitely|let'?s do it|lets do it)[\s!.?,]*$/i
const CONTEXT_DEPENDENT_REPLY_PREFIX_RE = /^(?:yes+|yea+h?|yep|yup|sure|ok(?:ay)?|perfect|correct|absolutely|definitely|please|go ahead|send it|sounds good|that works|works for me|looks good|all good|for sure|of course|let'?s do it|lets do it)\b/i
const CONTEXT_REVERSAL_RE = /\b(?:but|actually|instead|rather|except|not|don'?t|do not|change|different|nevermind|never mind)\b/i

function isContextDependentReply(value) {
  const normalized = String(value || '').normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (!normalized || normalized.length > 240) return false
  if (CONTEXT_DEPENDENT_REPLY_RE.test(normalized)) return true
  return CONTEXT_DEPENDENT_REPLY_PREFIX_RE.test(normalized) && !CONTEXT_REVERSAL_RE.test(normalized)
}

const MODEL_LED_ACTIONS = new Set([
  'general_continue',
  'social_continue',
  'tattoo_continue'
])

function transitionAuthorityProjection(transition = {}) {
  const action = String(transition?.action || '').trim()
  const obligations = Array.isArray(transition?.obligations)
    ? transition.obligations.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  const modelLed = MODEL_LED_ACTIONS.has(action) && obligations.length === 0
  return {
    required_semantic_action: modelLed ? '' : action,
    advisory_conversation_lane: modelLed ? action : '',
    route_reason: modelLed ? '' : String(transition?.reason || ''),
    obligations,
    model_led_open_conversation: modelLed
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function validResponseId(value) {
  return RESPONSE_ID_RE.test(String(value || '').trim())
}

function visibleHistoryEvents(recentHistory = [], limit = 60) {
  const rows = Array.isArray(recentHistory) ? recentHistory : []
  return rows
    .filter((event) => {
      const role = String(event?.role || event?.sender || '').toLowerCase()
      return role === 'user' || role === 'assistant' || role === 'assistant_attempted'
    })
    .filter((event) => {
      if (String(event?.role || '').toLowerCase() !== 'assistant_attempted') return true
      return isConversationVisibleAssistantEvent(event)
    })
    .slice(-Math.max(1, Math.min(200, Number(limit) || 60)))
    .map((event) => ({
      role: String(event?.role || event?.sender || '').toLowerCase() === 'user'
        ? 'user'
        : 'assistant',
      content: String(event?.text || event?.message || event?.content || '').trim(),
      message_id: String(event?.message_id || ''),
      reply_to_message_id: String(event?.reply_to_message_id || ''),
      bubble_index: Number.isFinite(Number(event?.bubble_index)) ? Number(event.bubble_index) : 0
    }))
    .filter((item) => item.content)
}

function visibleHistoryItems(recentHistory = [], limit = 60) {
  return visibleHistoryEvents(recentHistory, limit).map((event) => ({
    role: event.role,
    content: event.content
  }))
}

function authoritativeVisibleLedgerItems(recentHistory = [], options = {}) {
  const maxEvents = Math.max(1, Math.min(
    MAX_VISIBLE_LEDGER_EVENTS,
    Number(options.maxEvents || MAX_VISIBLE_LEDGER_EVENTS) || MAX_VISIBLE_LEDGER_EVENTS
  ))
  const maxChars = Math.max(4000, Math.min(
    MAX_VISIBLE_LEDGER_CHARS,
    Number(options.maxChars || MAX_VISIBLE_LEDGER_CHARS) || MAX_VISIBLE_LEDGER_CHARS
  ))
  const visible = visibleHistoryItems(recentHistory, maxEvents)
  const kept = []
  let usedChars = 0
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const item = visible[index]
    const cost = item.content.length + 32
    if (kept.length > 0 && usedChars + cost > maxChars) break
    kept.push(item)
    usedChars += cost
  }
  return kept.reverse()
}

function continuationVisibleLedgerItems(recentHistory = [], lastModelMessageId = '', options = {}) {
  const anchor = String(lastModelMessageId || '').trim()
  if (!anchor) {
    return { chain_eligible: false, reason: 'model_turn_anchor_missing', items: [] }
  }
  const maxEvents = Math.max(1, Math.min(
    MAX_VISIBLE_LEDGER_EVENTS,
    Number(options.maxEvents || MAX_VISIBLE_LEDGER_EVENTS) || MAX_VISIBLE_LEDGER_EVENTS
  ))
  const visible = visibleHistoryEvents(recentHistory, maxEvents)
  let boundaryIndex = -1
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const event = visible[index]
    if (
      event.role === 'assistant' &&
      (event.message_id === anchor || event.reply_to_message_id === anchor)
    ) {
      boundaryIndex = index
      break
    }
  }
  if (boundaryIndex < 0) {
    return { chain_eligible: false, reason: 'model_turn_delivery_not_in_visible_ledger', items: [] }
  }
  return {
    chain_eligible: true,
    reason: 'provider_chain_reconciled_after_last_model_delivery',
    items: visible.slice(boundaryIndex + 1).map((event) => ({
      role: event.role,
      content: event.content
    }))
  }
}

function trustedStateProjection(state = {}) {
  const source = state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  const allowed = [
    'booking_stage_hint', 'next_action', 'tattoo_intent_active',
    'form_offer_asked', 'form_link_sent', 'form_submitted',
    'known_name_used_on_form', 'known_phone_used_on_form',
    'known_requested_date', 'known_requested_time',
    'last_offered_date', 'last_offered_time',
    'accepted_offered_date', 'accepted_offered_time',
    'known_design_context', 'known_reference_media_received',
    'known_tattoo_reference_media_received', 'known_client_anchored_inspiration', 'double_check_sent',
    'name_phone_date_time_double_check_sent', 'deposit_requested',
    'minimum_booking_date_local', 'current_message_date_local',
    'close_booking_options_local', 'pending_unanswered_user_messages',
    'live_turn_is_voice_note', 'live_turn_voice_transcribe_failed',
    'live_turn_is_media_reference', 'live_turn_media_category',
    'live_turn_media_tattoo_reference', 'live_turn_deposit_proof_media',
    'live_turn_context_relation', 'live_turn_context_missing',
    'live_turn_context_missing_attachment', 'live_turn_context_needs_clarification',
    'live_turn_phone_candidate', 'live_turn_name_candidate',
    'live_turn_date_phrase', 'live_turn_date_status', 'live_turn_date_iso',
    'live_turn_time_phrase', 'live_turn_accepts_offered_slot',
    'live_turn_form_submitted_signal', 'live_turn_booking_match_signal'
  ]
  const out = {}
  for (const key of allowed) {
    const value = source[key]
    if (value === undefined || value === '' || value === false || value === null) continue
    out[key] = value
  }
  return out
}

function latestVisibleAssistantText(recentHistory = []) {
  const visible = visibleHistoryItems(recentHistory, 60)
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    if (visible[index].role === 'assistant') return visible[index].content.slice(0, 2400)
  }
  return ''
}

function conversationAnchor(input = {}) {
  const live = String(input?.live_message || input?.message || input?.text || '').trim()
  const normalized = live.normalize('NFC').replace(/\s+/gu, ' ').trim()
  const state = input?.structured_state && typeof input.structured_state === 'object'
    ? input.structured_state
    : {}
  const contextDependent = isContextDependentReply(normalized)
  if (!contextDependent) return { context_dependent: false }

  let referent = 'immediately_preceding_assistant_turn'
  if (state.deposit_requested === true) {
    referent = /sent it|done/i.test(normalized) ? 'deposit_sent_claim' : 'deposit_request'
  } else if (state.double_check_sent === true || state.name_phone_date_time_double_check_sent === true) {
    referent = 'booking_double_check'
  } else if (
    String(state.last_offered_date || '').trim() ||
    String(state.last_offered_time || '').trim()
  ) {
    referent = 'offered_booking_slot'
  } else if (state.form_offer_asked === true && state.form_link_sent !== true) {
    referent = 'open_form_offer'
  } else if (state.form_link_sent === true && /sent it|done/i.test(normalized)) {
    referent = 'form_submission_claim'
  }

  return {
    context_dependent: true,
    current_reply: normalized.slice(0, 400),
    required_referent: referent,
    immediately_preceding_assistant_message: latestVisibleAssistantText(input?.recent_history),
    last_offered_date: String(state.last_offered_date || '').trim(),
    last_offered_time: String(state.last_offered_time || '').trim()
  }
}

function buildResponsesInstructions({
  systemPrompt,
  input = {},
  routeLock = '',
  outputContract = '',
  conversationContext = {}
} = {}) {
  const transition = input?.control_transition_contract &&
    typeof input.control_transition_contract === 'object'
      ? input.control_transition_contract
      : {}
  const transitionAuthority = transitionAuthorityProjection(transition)
  const trusted = {
    thread_state: trustedStateProjection(input?.structured_state),
    conversation_anchor: conversationAnchor(input),
    visible_ledger_authority: {
      source: 'locally_persisted_delivered_instagram_dialogue',
      replay_mode: String(conversationContext.mode || 'full_visible_ledger_reseed'),
      supplied_event_count: Number(conversationContext.supplied_event_count || 0),
      provider_response_chain_continuation: conversationContext.provider_chain_continuation === true,
      local_visible_ledger_remains_delivery_source_of_truth: true
    },
    required_semantic_action: transitionAuthority.required_semantic_action,
    advisory_conversation_lane: transitionAuthority.advisory_conversation_lane,
    route_reason: transitionAuthority.route_reason,
    obligations: transitionAuthority.obligations,
    model_led_open_conversation: transitionAuthority.model_led_open_conversation,
    current_message_id: String(input?.message_id || ''),
    received_at: String(input?.received_at || '')
  }
  const convergenceField = {
    version: SCV_RESPONSES_CONVERGENCE_FIELD_VERSION,
    convergence_baseline: SCV_RESPONSES_CONVERGENCE_BASELINE,
    state: trusted.thread_state,
    pressure: trusted.route_reason || 'continue_the_actual_conversation_without_forcing_a_funnel_move',
    frame: 'one_continuous_grounded_instagram_conversation',
    objective: trusted.required_semantic_action || 'answer_the_person_directly_and_preserve_continuity',
    boundary: [
      'do_not_invent_facts_or_media_understanding',
      'do_not_skip_transactional_gates',
      'do_not_replace_model_authorship_with_fixed_scripts'
    ],
    memory: {
      visible_ledger: trusted.visible_ledger_authority,
      conversation_anchor: trusted.conversation_anchor
    },
    permission: {
      required_semantic_action: trusted.required_semantic_action,
      advisory_conversation_lane: trusted.advisory_conversation_lane,
      obligations: trusted.obligations,
      model_led_open_conversation: trusted.model_led_open_conversation
    },
    output_shape: 'strict_json_dm_packet_with_natural_newly_generated_visible_bubbles',
    drift_guard: [
      'never_reset_a_short_reply_away_from_its_immediate_referent',
      'never_repeat_a_question_already_answered',
      'never_leave_the_newest_user_message_unanswered',
      'never_backtrack_to_design_after_booking_has_advanced'
    ],
    recovery_rule: 'a_rejected_candidate_is_reauthored_against_verifier_feedback_and_is_never_adopted_as_visible_truth',
    revas_floor: 'candidate_must_preserve_chatgpt_level_contextual_coherence_and_pass_route_verifiers_before_adoption',
    trusted_turn_authority: trusted
  }
  return [
    'RCC / REVAS PRE-INFERENCE CONVERGENCE FIELD',
    JSON.stringify(convergenceField),
    String(systemPrompt || '').trim(),
    'CURRENT VERIFIER REPAIR / ROUTE LOCK',
    String(routeLock || '').trim(),
    String(outputContract || '').trim()
  ].filter(Boolean).join('\n\n')
}

function currentUserText(input = {}, alreadySuppliedItems = []) {
  const live = String(input?.live_message || input?.message || input?.text || '').trim()
  const supplied = new Set((Array.isArray(alreadySuppliedItems) ? alreadySuppliedItems : [])
    .filter((item) => String(item?.role || '').toLowerCase() === 'user')
    .map((item) => String(item?.content || '').normalize('NFC').replace(/\s+/gu, ' ').trim())
    .filter(Boolean))
  const pending = Array.isArray(input?.structured_state?.pending_unanswered_user_messages)
    ? input.structured_state.pending_unanswered_user_messages
        .map((value) => String(value || '').trim())
        .filter((value) => value && !supplied.has(value.normalize('NFC').replace(/\s+/gu, ' ').trim()))
    : []
  if (!pending.length) return live
  return [
    'Earlier user messages still awaiting a reply:',
    ...pending.map((value) => `• ${value}`),
    '',
    'Newest user message:',
    live
  ].join('\n')
}

function buildResponsesRequest({
  model,
  systemPrompt,
  input = {},
  routeLock = '',
  outputSchema,
  previousResponseId = '',
  reasoningEffort = 'medium',
  reasoningMode = '',
  maxOutputTokens = 1200
} = {}) {
  const previous = String(previousResponseId || '').trim()
  const continuation = validResponseId(previous)
    ? continuationVisibleLedgerItems(
        input?.recent_history,
        input?.structured_state?.openai_conversation_last_message_id
      )
    : { chain_eligible: false, reason: 'provider_response_id_missing', items: [] }
  const useProviderChain = validResponseId(previous) && continuation.chain_eligible === true
  // Continue native Responses state whenever the locally persisted delivery ledger
  // proves the exact adopted model-turn boundary. Any deterministic visible turns
  // after that boundary are appended as a reconciliation delta. If the boundary is
  // unavailable, fail safely back to a full visible-ledger replay instead of risking
  // a provider/local history fork.
  const items = useProviderChain
    ? continuation.items.slice()
    : authoritativeVisibleLedgerItems(input?.recent_history)
  items.push({ role: 'user', content: currentUserText(input, items) })
  const conversationContext = {
    mode: useProviderChain
      ? 'provider_chain_with_visible_delivery_delta'
      : 'full_visible_ledger_reseed',
    supplied_event_count: Math.max(0, items.length - 1),
    provider_chain_continuation: useProviderChain,
    continuation_reason: continuation.reason
  }
  const request = {
    model: String(model || 'gpt-5.4-mini'),
    instructions: buildResponsesInstructions({
      systemPrompt,
      input,
      routeLock,
      outputContract: 'Return only the strict structured reply object.',
      conversationContext
    }),
    input: items,
    reasoning: {
      effort: String(reasoningEffort || 'medium'),
      // 'all_turns' is a gpt-5.6-family-only value; the approved quality ladder
      // (gpt-5 / gpt-5.4 nano and mini) accepts only 'auto' or 'current_turn'
      // and returns HTTP 400 unsupported_value otherwise. 'auto' is valid on
      // every model this lane is allowed to run.
      context: 'auto'
    },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'scv_dm_structured_output',
        strict: true,
        schema: outputSchema
      }
    },
    max_output_tokens: Math.max(256, Math.min(4096, Number(maxOutputTokens) || 1200)),
    store: true,
    parallel_tool_calls: false,
    safety_identifier: sha256(`scv-contact:${String(input?.contact_id || '')}`).slice(0, 64),
    prompt_cache_key: sha256(`scv-thread:${String(input?.thread_id || input?.contact_id || '')}`).slice(0, 64)
  }
  const mode = String(reasoningMode || '').trim()
  if (mode) request.reasoning.mode = mode
  if (useProviderChain) {
    request.previous_response_id = previous
  } else if (validResponseId(previous)) {
    request.metadata = {
      prior_adopted_response_id: previous,
      dialogue_authority: 'local_visible_ledger',
      conversation_reseed_reason: continuation.reason
    }
  }
  return request
}

function extractResponsesOutputText(response = {}) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim()
  }
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== 'message') continue
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text' && String(content.text || '').trim()) {
        return String(content.text).trim()
      }
    }
  }
  return ''
}

function conversationReceipt(response = {}, request = {}) {
  const responseId = String(response?.id || '').trim()
  const providerResponseIdPresent = validResponseId(responseId)
  return {
    version: SCV_OPENAI_CONVERSATION_VERSION,
    api: 'responses_v1',
    response_id: providerResponseIdPresent ? responseId : '',
    provider_response_id_present: providerResponseIdPresent,
    previous_response_id: validResponseId(request?.previous_response_id)
      ? String(request.previous_response_id)
      : '',
    native_history_seeded: !validResponseId(request?.previous_response_id),
    authoritative_visible_ledger_replayed: !validResponseId(request?.previous_response_id),
    authoritative_visible_ledger_reconciled: true,
    conversation_context_mode: validResponseId(request?.previous_response_id)
      ? 'provider_chain_with_visible_delivery_delta'
      : 'full_visible_ledger_reseed',
    rcc_revas_pre_inference_convergence_field: String(request?.instructions || '')
      .startsWith('RCC / REVAS PRE-INFERENCE CONVERGENCE FIELD\n\n'),
    convergence_baseline: SCV_RESPONSES_CONVERGENCE_BASELINE,
    model: String(response?.model || request?.model || ''),
    reasoning_context: String(response?.reasoning?.context || request?.reasoning?.context || ''),
    reasoning_mode: String(response?.reasoning?.mode || request?.reasoning?.mode || ''),
    stored: request?.store === true
  }
}

module.exports = {
  SCV_OPENAI_CONVERSATION_VERSION,
  SCV_RESPONSES_CONVERGENCE_BASELINE,
  SCV_RESPONSES_CONVERGENCE_FIELD_VERSION,
  RESPONSE_ID_RE,
  sha256,
  validResponseId,
  isContextDependentReply,
  visibleHistoryEvents,
  visibleHistoryItems,
  authoritativeVisibleLedgerItems,
  continuationVisibleLedgerItems,
  trustedStateProjection,
  transitionAuthorityProjection,
  latestVisibleAssistantText,
  conversationAnchor,
  buildResponsesInstructions,
  currentUserText,
  buildResponsesRequest,
  extractResponsesOutputText,
  conversationReceipt
}
