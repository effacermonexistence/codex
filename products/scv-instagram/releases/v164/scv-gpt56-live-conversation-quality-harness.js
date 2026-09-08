#!/usr/bin/env node

const assert = require('assert')
const {
  runOpenAIResponses,
  buildControllerActionGuidance,
  detectGenericAiTone
} = require('./codex-dm-runner.js')

const MODEL = String(process.env.OPENAI_DM_MODEL || 'gpt-5.6-sol').trim()
const FORM_URL = 'https://www.effacermonexistence.com/apply'
const syntheticThreadId = `gpt56-quality-${Date.now()}`
const history = []
const state = {
  tattoo_intent_active: true,
  booking_stage_hint: 'open_conversation'
}
const results = []

function plan(action, reason, obligations = [], fields = {}) {
  return { action, reason, obligations, fields }
}

function routeLock(transition) {
  return [
    'CONTROLLER CLOSED-TRANSITION ROUTE',
    `- Required semantic action: ${transition.action}.`,
    `- Route reason: ${transition.reason}.`,
    buildControllerActionGuidance(transition),
    '- Answer every direct side question in the newest message.',
    '- Generate the wording fresh and preserve all settled conversation facts.'
  ].filter(Boolean).join('\n')
}

function packetText(packet) {
  return (Array.isArray(packet?.bubbles) ? packet.bubbles : [])
    .map((bubble) => String(bubble?.text || '').trim())
    .filter(Boolean)
    .join('\n')
}

function addVisibleTurn(messageId, userText, packet) {
  history.push({ role: 'user', message_id: messageId, text: userText })
  for (const [bubbleIndex, bubble] of packet.bubbles.entries()) {
    history.push({
      role: 'assistant',
      message_id: messageId,
      reply_to_message_id: messageId,
      bubble_index: bubbleIndex,
      text: String(bubble.text || '')
    })
  }
}

async function executeTurn(index, userText, transition, mutateState = () => {}) {
  mutateState(state)
  const messageId = `synthetic-live-${index}`
  const input = {
    message_id: messageId,
    contact_id: syntheticThreadId,
    thread_id: syntheticThreadId,
    message: userText,
    live_message: userText,
    received_at: new Date(Date.now() + index * 1000).toISOString(),
    recent_history: history.slice(),
    structured_state: { ...state },
    control_transition_contract: transition
  }
  const response = await runOpenAIResponses(
    input,
    routeLock(transition),
    MODEL,
    Number(process.env.SCV_GPT56_LIVE_QUALITY_TIMEOUT_MS || 120000),
    {
      reasoningEffort: String(process.env.OPENAI_RESPONSES_REASONING_EFFORT || 'medium'),
      enforceModelIdentity: true,
      maxAttempts: 3
    }
  )
  assert.equal(response.status, 0, `turn_${index}_provider_failed :: ${response.error || response.stderr}`)
  assert.ok(response.conversation?.response_id, `turn_${index}_response_id_missing`)
  const packet = JSON.parse(response.lastMessage)
  const text = packetText(packet)
  assert.ok(text, `turn_${index}_visible_text_missing`)
  assert.equal(detectGenericAiTone(packet, input), null, `turn_${index}_generic_ai_tone :: ${text}`)
  addVisibleTurn(messageId, userText, packet)
  state.openai_previous_response_id = response.conversation.response_id
  state.openai_conversation_last_message_id = messageId
  results.push({
    index,
    user: userText,
    visible_text: text,
    response_id: response.conversation.response_id,
    previous_response_id: response.conversation.previous_response_id,
    context_mode: response.conversation.conversation_context_mode,
    reasoning_context: response.conversation.reasoning_context
  })
  return { packet, text, response }
}

async function main() {
  assert.ok(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY is required for the live quality harness')
  assert.equal(MODEL, 'gpt-5.6-sol', `live quality harness requires gpt-5.6-sol but received ${MODEL}`)

  const first = await executeTurn(
    1,
    'Hi can I please get more information?',
    plan('tattoo_continue', 'fresh_tattoo_information_request')
  )
  assert.match(first.text, /\b(?:few|limited|model spots?)\b/i, 'turn_1_did_not_explain_limited_model_offer')
  assert.match(first.text, /\b(?:style|visual language)\b/i, 'turn_1_did_not_explain_artist_language')
  assert.doesNotMatch(first.text, /thanks for reaching out|certainly|how can i assist/i, 'turn_1_customer_service_voice')

  const second = await executeTurn(
    2,
    "I'm thinking of a black and grey heron with water around it. How much is it by the way?",
    plan('offer_form', 'concrete_design_ready', ['answer_current_price_question', 'offer_form_without_link']),
    (next) => {
      next.known_design_context = 'black and grey heron with water around it'
      next.booking_stage_hint = 'design_intake'
    }
  )
  assert.match(second.text, /\b150\b/i, 'turn_2_price_missing')
  assert.match(second.text, /\b(?:hour|hourly)\b/i, 'turn_2_hourly_basis_missing')
  assert.match(second.text, /\bform\b/i, 'turn_2_form_offer_missing')
  assert.ok(!second.text.includes(FORM_URL), 'turn_2_sent_form_before_consent')
  assert.match(second.text, /\b(?:heron|water|black|grey|gray)\b/i, 'turn_2_specific_design_not_received')

  const third = await executeTurn(
    3,
    'YES PLEASE',
    plan('send_form', 'explicit_form_consent', ['send_exact_form_link']),
    (next) => {
      next.form_offer_asked = true
      next.booking_stage_hint = 'awaiting_form_permission_answer'
    }
  )
  assert.equal(third.text.split(FORM_URL).length - 1, 1, 'turn_3_form_link_not_sent_exactly_once')
  assert.match(third.text, /\b(?:available|availability|days|dates|works for you|work for you)\b/i, 'turn_3_availability_tail_missing')
  assert.doesNotMatch(third.text, /what design|what placement|what size/i, 'turn_3_reopened_design_intake')

  const fourth = await executeTurn(
    4,
    'I just sent it. How about August 30?',
    plan('post_form_time', 'submitted_form_with_date_needs_time', ['ask_missing_appointment_time']),
    (next) => {
      next.form_link_sent = true
      next.form_submitted = true
      next.known_requested_date = '2026-08-30'
      next.booking_stage_hint = 'awaiting_time'
    }
  )
  assert.match(fourth.text, /\b(?:time|am|pm|morning|afternoon)\b/i, 'turn_4_did_not_ask_for_time')
  assert.doesNotMatch(fourth.text, /send (?:me )?the form|form link|what design|what placement/i, 'turn_4_backtracked')

  const fifth = await executeTurn(
    5,
    '2pm works for me. Black and grey is okay right?',
    plan('post_form_identity', 'date_and_time_known_identity_missing', ['answer_current_capability_question', 'ask_missing_name_and_phone']),
    (next) => {
      next.known_requested_time = '2pm'
      next.accepted_offered_date = '2026-08-30'
      next.accepted_offered_time = '2pm'
      next.booking_stage_hint = 'awaiting_identity'
    }
  )
  assert.match(fifth.text, /\bblack\b/i, 'turn_5_capability_answer_missing')
  assert.match(fifth.text, /\bgr(?:e|a)y\b/i, 'turn_5_black_and_grey_answer_missing')
  assert.match(fifth.text, /\bname\b/i, 'turn_5_name_request_missing')
  assert.match(fifth.text, /\b(?:phone|number)\b/i, 'turn_5_phone_request_missing')
  assert.doesNotMatch(fifth.text, /what date|when works|send the form|what design/i, 'turn_5_lost_booking_stage')

  const sixth = await executeTurn(
    6,
    'My name is Ben Lee and my phone number is 415-555-0136',
    plan(
      'double_check',
      'all_booking_fields_ready',
      ['send_four_field_double_check'],
      { name: 'Ben Lee', phone: '415-555-0136', date: '2026-08-30', time: '2pm' }
    ),
    (next) => {
      next.known_name = 'Ben Lee'
      next.known_phone = '415-555-0136'
      next.booking_stage_hint = 'ready_for_double_check'
    }
  )
  assert.match(sixth.text, /\bBen Lee\b/i, 'turn_6_name_missing')
  assert.match(sixth.text, /\b415-555-0136\b/i, 'turn_6_phone_missing')
  assert.match(sixth.text, /(?:2026-08-30|August\s+30|Aug\.?\s+30)/i, 'turn_6_date_missing')
  assert.match(sixth.text, /\b2\s*pm\b/i, 'turn_6_time_missing')
  assert.match(sixth.text, /\b(?:right|correct|double check|look good)\b/i, 'turn_6_confirmation_request_missing')

  const seventh = await executeTurn(
    7,
    'Yes that is all correct',
    plan('deposit_handoff', 'four_field_double_check_confirmed', ['send_deposit_now']),
    (next) => {
      next.double_check_sent = true
      next.booking_stage_hint = 'awaiting_double_check_confirmation'
    }
  )
  assert.match(seventh.text, /\b100\b/i, 'turn_7_deposit_amount_missing')
  assert.match(seventh.text, /\bcontact@omarprotocol\.com\b/i, 'turn_7_zelle_address_missing')
  assert.match(seventh.text, /\b(?:sent|send|let me know|lmk)\b/i, 'turn_7_deposit_followup_missing')
  assert.doesNotMatch(seventh.text, /what date|what time|which date|send the form/i, 'turn_7_backtracked')

  assert.equal(results[0].context_mode, 'full_visible_ledger_reseed', 'first_turn_should_seed_visible_ledger')
  for (const result of results.slice(1)) {
    assert.equal(result.context_mode, 'provider_chain_with_visible_delivery_delta', `turn_${result.index}_did_not_continue_native_chain`)
    assert.ok(result.previous_response_id, `turn_${result.index}_missing_previous_response_id`)
    assert.ok(['auto', 'current_turn', 'all_turns'].includes(result.reasoning_context), `turn_${result.index}_reasoning_context_invalid`)
  }
  assert.equal(new Set(results.map((result) => result.visible_text)).size, results.length, 'visible_turn_repetition_detected')

  process.stdout.write(JSON.stringify({
    ok: true,
    model: MODEL,
    synthetic_only: true,
    turns: results.length,
    native_continuations: results.filter((result) => result.context_mode === 'provider_chain_with_visible_delivery_delta').length,
    results
  }, null, 2) + '\n')
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error) + '\n')
  process.exit(1)
})
