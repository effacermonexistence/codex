#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const conversation = require('./scv-openai-conversation.js')
const {
  buildResponsesVisibleSystemPrompt,
  buildControllerActionGuidance
} = require('./codex-dm-runner.js')

let checked = 0
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? ` :: ${detail}` : ''}`)
  checked += 1
}

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'codex-dm-output-schema.json'), 'utf8'))
const longHistory = []
for (let turn = 1; turn <= 24; turn += 1) {
  const messageId = `model-turn-${turn}`
  let userText = `conversation turn ${turn}`
  let assistantText = `reply to turn ${turn}`
  if (turn === 2) userText = 'my name is Maya and my phone is 4155550199'
  if (turn === 5) userText = 'i want a black and grey heron with water around it'
  if (turn === 9) userText = 'august 30 would work for me'
  if (turn === 12) assistantText = 'would 2pm work for you?'
  longHistory.push({ role: 'user', message_id: messageId, text: userText })
  longHistory.push({
    role: 'assistant',
    message_id: messageId,
    reply_to_message_id: messageId,
    text: assistantText
  })
}

const base = {
  message_id: 'live-turn-25',
  contact_id: 'parity-contact',
  thread_id: 'parity-thread',
  live_message: 'sure thing',
  recent_history: longHistory,
  structured_state: {
    openai_previous_response_id: 'resp_parity_previous_12345678',
    openai_conversation_last_message_id: 'model-turn-24',
    tattoo_intent_active: true,
    known_name_used_on_form: 'Maya',
    known_phone_used_on_form: '4155550199',
    known_design_context: 'black and grey heron with water around it',
    known_requested_date: '2026-08-30',
    last_offered_time: '2pm'
  },
  control_transition_contract: {
    action: 'accepted_slot_progress',
    reason: 'accepted_exact_offered_slot',
    obligations: ['preserve_booking_context']
  }
}

const chained = conversation.buildResponsesRequest({
  model: 'gpt-5.4-mini',
  systemPrompt: buildResponsesVisibleSystemPrompt(),
  input: base,
  outputSchema: schema,
  previousResponseId: base.structured_state.openai_previous_response_id,
  reasoningEffort: 'medium'
})

check('quality_model_is_exact', chained.model === 'gpt-5.4-mini')
check('native_chain_is_used', chained.previous_response_id === 'resp_parity_previous_12345678')
check('native_chain_avoids_48_message_duplication', chained.input.length === 1)
check('current_reply_is_last', chained.input.at(-1).content === 'sure thing')
check('reasoning_context_is_model_compatible_auto', chained.reasoning.context === 'auto')
check('quality_reasoning_effort_is_medium', chained.reasoning.effort === 'medium')
check('strict_output_contract_is_kept', chained.text.format.strict === true)
check('context_anchor_targets_slot', chained.instructions.includes('"required_referent":"offered_booking_slot"'))
check('trusted_identity_is_projected', chained.instructions.includes('"known_name_used_on_form":"Maya"'))
check('trusted_design_is_projected', chained.instructions.includes('black and grey heron with water around it'))
check('trusted_date_is_projected', chained.instructions.includes('2026-08-30'))
check('responses_author_prompt_is_bounded', Buffer.byteLength(buildResponsesVisibleSystemPrompt()) < 40000)
check('responses_author_begins_with_exact_talek_identity',
  buildResponsesVisibleSystemPrompt().startsWith('✅✅ T ALEK-LUA SELF-IDENTITY CORE PROMPT'))
check('legacy_225kb_authority_is_not_in_responses_author',
  !buildResponsesVisibleSystemPrompt().includes('OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED'))

const sendFormGuidance = buildControllerActionGuidance({
  action: 'send_form',
  reason: 'explicit_form_request_or_open_offer_consent',
  obligations: ['send_exact_form_link']
})
check('send_form_route_requires_exact_link',
  sendFormGuidance.includes('https://www.effacermonexistence.com/apply'))
check('send_form_route_requires_same_turn_availability',
  /available dates|availability/i.test(sendFormGuidance))
check('compact_conversation_prompt_requires_same_turn_availability',
  /same form-link handoff ask the client for a couple of available dates/i.test(buildResponsesVisibleSystemPrompt()))

const withDeterministicCheckpoint = {
  ...base,
  message_id: 'live-turn-27',
  live_message: 'yes that is all correct',
  recent_history: longHistory.concat([
    { role: 'user', message_id: 'deterministic-turn-26', text: '2pm is perfect' },
    {
      role: 'assistant',
      message_id: 'deterministic-turn-26',
      reply_to_message_id: 'deterministic-turn-26',
      text: 'name: Maya\nphone number: 4155550199\nappointment date: august 30\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤'
    }
  ]),
  structured_state: {
    ...base.structured_state,
    name_phone_date_time_double_check_sent: true,
    double_check_sent: true
  },
  control_transition_contract: {
    action: 'deposit_handoff',
    reason: 'double_check_confirmed',
    obligations: ['send_atomic_deposit_handoff']
  }
}
const reconciled = conversation.buildResponsesRequest({
  model: 'gpt-5.4-mini',
  systemPrompt: buildResponsesVisibleSystemPrompt(),
  input: withDeterministicCheckpoint,
  outputSchema: schema,
  previousResponseId: withDeterministicCheckpoint.structured_state.openai_previous_response_id
})
check('deterministic_checkpoint_does_not_break_native_chain',
  reconciled.previous_response_id === 'resp_parity_previous_12345678')
check('deterministic_checkpoint_is_reconciled_after_chain_boundary',
  reconciled.input.length === 3 && reconciled.input[0].content === '2pm is perfect')
check('exact_visible_checkpoint_is_supplied', reconciled.input[1].content.includes('phone number: 4155550199'))
check('confirmation_is_resolved_against_checkpoint',
  reconciled.instructions.includes('"required_referent":"booking_double_check"'))
check('booking_does_not_reset_to_design',
  reconciled.instructions.includes('never_backtrack_to_design_after_booking_has_advanced'))

const sideQuestion = conversation.buildResponsesRequest({
  model: 'gpt-5.4-mini',
  systemPrompt: buildResponsesVisibleSystemPrompt(),
  outputSchema: schema,
  previousResponseId: 'resp_parity_previous_12345678',
  input: {
    ...base,
    live_message: 'black and grey is okay right and 2pm still works for me',
    recent_history: longHistory.concat([
      { role: 'user', message_id: 'pending-side-question', text: 'black and grey is okay right' }
    ]),
    structured_state: {
      ...base.structured_state,
      pending_unanswered_user_messages: ['black and grey is okay right']
    }
  }
})
check('compound_latest_turn_remains_intact', sideQuestion.input.at(-1).content.includes('2pm still works for me'))
check('already_visible_pending_text_is_not_duplicated',
  !sideQuestion.input.at(-1).content.includes('Earlier user messages still awaiting a reply'))
check('side_question_keeps_settled_state', sideQuestion.instructions.includes('"known_requested_date":"2026-08-30"'))

const voiceAndImage = conversation.buildResponsesRequest({
  model: 'gpt-5.4-mini',
  systemPrompt: buildResponsesVisibleSystemPrompt(),
  outputSchema: schema,
  input: {
    ...base,
    live_message: 'Can I please get more information?',
    recent_history: [],
    structured_state: {
      live_turn_is_voice_note: true,
      live_turn_is_media_reference: true,
      live_turn_media_category: 'image',
      live_turn_media_tattoo_reference: true
    },
    control_transition_contract: {
      action: 'tattoo_continue',
      reason: 'resolved_voice_and_media_turn',
      obligations: []
    }
  }
})
check('voice_transcript_is_current_user_message', voiceAndImage.input.at(-1).content === 'Can I please get more information?')
check('voice_authority_is_projected', voiceAndImage.instructions.includes('"live_turn_is_voice_note":true'))
check('image_authority_is_projected', voiceAndImage.instructions.includes('"live_turn_media_tattoo_reference":true'))
check('model_led_open_conversation_is_not_forced', voiceAndImage.instructions.includes('"model_led_open_conversation":true'))

const missingBoundary = conversation.buildResponsesRequest({
  model: 'gpt-5.4-mini',
  systemPrompt: buildResponsesVisibleSystemPrompt(),
  input: {
    ...base,
    structured_state: {
      ...base.structured_state,
      openai_conversation_last_message_id: 'missing-model-turn'
    }
  },
  outputSchema: schema,
  previousResponseId: 'resp_parity_previous_12345678'
})
check('missing_local_boundary_fails_safe_to_reseed', !Object.hasOwn(missingBoundary, 'previous_response_id'))
check('missing_local_boundary_replays_full_visible_ledger', missingBoundary.input.length === 49)
check('missing_local_boundary_preserves_early_identity',
  JSON.stringify(missingBoundary.input).includes('my name is Maya and my phone is 4155550199'))
check('reseed_reason_is_auditable',
  missingBoundary.metadata.conversation_reseed_reason === 'model_turn_delivery_not_in_visible_ledger')

process.stdout.write(JSON.stringify({
  ok: true,
  checked,
  native_chain_turns_represented: 24,
  seeded_visible_messages: longHistory.length,
  responses_author_prompt_bytes: Buffer.byteLength(buildResponsesVisibleSystemPrompt())
}) + '\n')
