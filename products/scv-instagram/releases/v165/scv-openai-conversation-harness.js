#!/usr/bin/env node

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const conversation = require('./scv-openai-conversation.js')

let checked = 0
function check(name, condition) { assert.ok(condition, name); checked += 1 }

const schema = { type: 'object', additionalProperties: false, required: ['bubbles'], properties: { bubbles: { type: 'array', items: { type: 'string' } } } }
const input = {
  message_id: 'legacy-manychat-0123456789abcdef0123456789abcdef',
  contact_id: '1537753982', thread_id: '1537753982', live_message: 'yes plz',
  recent_history: [
    { role: 'user', message_id: 'msg_form_offer', text: 'can you send me the form?' },
    { role: 'assistant', message_id: 'msg_form_offer', reply_to_message_id: 'msg_form_offer', bubble_index: 0, text: 'yeah of course want me to send it here?' },
    { role: 'assistant_attempted', message_id: 'msg_form_offer', text: 'invisible failed answer' },
    { role: 'assistant', message_id: 'msg_form_offer', reply_to_message_id: 'msg_form_offer', bubble_index: 1, text: 'visible accepted answer' }
  ],
  structured_state: { form_offer_asked: true, pending_unanswered_user_messages: [] },
  control_transition_contract: { action: 'send_form', reason: 'explicit_form_consent', obligations: ['send_exact_form_link'] }
}

const seeded = conversation.buildResponsesRequest({ model: 'gpt-5.6-terra', systemPrompt: 'SYSTEM', input, routeLock: 'LOCK', outputSchema: schema, reasoningEffort: 'medium' })
check('seeded_has_no_previous_response', !Object.hasOwn(seeded, 'previous_response_id'))
check('seeded_uses_native_history', seeded.input.length === 4)
check('seeded_excludes_invisible_attempt', !JSON.stringify(seeded.input).includes('invisible failed answer'))
check('seeded_includes_visible_attempt', JSON.stringify(seeded.input).includes('visible accepted answer'))
check('seeded_current_user_last', seeded.input.at(-1).role === 'user' && seeded.input.at(-1).content === 'yes plz')
check('responses_reasoning_model_compatible_auto', seeded.reasoning.effort === 'medium' && seeded.reasoning.context === 'auto')
check('responses_standard_mode_default', !Object.hasOwn(seeded.reasoning, 'mode'))
check('responses_strict_schema', seeded.text.format.type === 'json_schema' && seeded.text.format.strict === true)
check('responses_store_enabled', seeded.store === true)
check('responses_tools_parallel_disabled', seeded.parallel_tool_calls === false)
check('trusted_transition_in_instructions', seeded.instructions.includes('send_exact_form_link'))
check('rcc_revas_convergence_field_is_first', seeded.instructions.startsWith('RCC / REVAS PRE-INFERENCE CONVERGENCE FIELD\n\n'))
check('chatgpt_quality_is_convergence_baseline', seeded.instructions.includes('"convergence_baseline":"chatgpt_contextual_conversation_quality"'))
check('trusted_turn_is_inside_convergence_field', seeded.instructions.includes('"trusted_turn_authority"'))
check('convergence_field_precedes_author_prompt', seeded.instructions.indexOf('"trusted_turn_authority"') < seeded.instructions.indexOf('SYSTEM'))
check('author_prompt_precedes_route_repair_lock', seeded.instructions.indexOf('SYSTEM') < seeded.instructions.indexOf('LOCK'))
check('convergence_field_preserves_state_over_script', seeded.instructions.includes('do_not_replace_model_authorship_with_fixed_scripts'))
check('short_reply_anchor_is_context_dependent', conversation.conversationAnchor(input).context_dependent === true)
check('short_reply_anchor_targets_form_offer', conversation.conversationAnchor(input).required_referent === 'open_form_offer')
check('short_reply_anchor_keeps_preceding_assistant', conversation.conversationAnchor(input).immediately_preceding_assistant_message === 'visible accepted answer')
check('short_reply_anchor_in_instructions', seeded.instructions.includes('"required_referent":"open_form_offer"'))

const socialProjection = conversation.transitionAuthorityProjection({
  action: 'social_continue', reason: 'plain_social_lane', obligations: []
})
check('social_lane_is_model_led', socialProjection.model_led_open_conversation === true)
check('social_lane_is_not_forced_action', socialProjection.required_semantic_action === '')
const transactionalProjection = conversation.transitionAuthorityProjection({
  action: 'deposit_handoff', reason: 'confirmed', obligations: []
})
check('transaction_lane_remains_forced', transactionalProjection.required_semantic_action === 'deposit_handoff')

const slotAnchor = conversation.conversationAnchor({
  live_message: 'sure thing',
  recent_history: [{ role: 'assistant', text: 'would august 29 at 2pm work for you?' }],
  structured_state: {
    form_offer_asked: true,
    form_link_sent: true,
    last_offered_date: '2026-08-29',
    last_offered_time: '2pm'
  }
})
check('slot_ack_targets_offered_slot_not_design', slotAnchor.required_referent === 'offered_booking_slot')
check('slot_anchor_binds_exact_offer', slotAnchor.immediately_preceding_assistant_message.includes('august 29 at 2pm'))
check('independent_question_has_no_forced_referent', conversation.conversationAnchor({ live_message: 'what do you charge per hour?' }).context_dependent === false)
check('natural_confirmation_remains_context_dependent', conversation.isContextDependentReply('yes that is all correct') === true)
check('mixed_consent_and_price_remains_context_dependent', conversation.isContextDependentReply('YES PLEASE how much is it by the way?') === true)
check('explicit_reversal_is_not_forced_into_prior_offer', conversation.isContextDependentReply("yes but I don't want that date") === false)

const chainedInput = {
  ...input,
  structured_state: {
    ...input.structured_state,
    openai_conversation_last_message_id: 'msg_form_offer'
  }
}
const chained = conversation.buildResponsesRequest({ model: 'gpt-5.6-terra', systemPrompt: 'SYSTEM', input: chainedInput, outputSchema: schema, previousResponseId: 'resp_0123456789abcdef' })
check('provider_chain_continues_from_adopted_response', chained.previous_response_id === 'resp_0123456789abcdef')
check('provider_chain_avoids_full_history_duplication', chained.input.length === 1 && chained.input.at(-1).content === 'yes plz')
check('provider_chain_mode_bound_in_instructions', chained.instructions.includes('provider_chain_with_visible_delivery_delta'))
check('instructions_resent_on_chain', chained.instructions.includes('SYSTEM'))
const invalid = conversation.buildResponsesRequest({ model: 'gpt-5.6-terra', systemPrompt: 'SYSTEM', input, outputSchema: schema, previousResponseId: 'bad' })
check('invalid_previous_response_reseeds', !Object.hasOwn(invalid, 'previous_response_id') && invalid.input.length === 4)
check('response_id_validation', conversation.validResponseId('resp_0123456789abcdef') && !conversation.validResponseId('chatcmpl_123'))

check('nested_output_text_extracted', conversation.extractResponsesOutputText({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"bubbles":["ok"]}' }] }] }) === '{"bubbles":["ok"]}')
check('direct_output_text_extracted', conversation.extractResponsesOutputText({ output_text: '{"bubbles":["direct"]}' }) === '{"bubbles":["direct"]}')
const receipt = conversation.conversationReceipt({ id: 'resp_0123456789abcdef', model: 'gpt-5.6-terra' }, chained)
check('receipt_response_bound', receipt.response_id === 'resp_0123456789abcdef')
check('receipt_binds_provider_chain', receipt.previous_response_id === 'resp_0123456789abcdef')
check('receipt_marks_native_continuation', receipt.native_history_seeded === false)
check('receipt_marks_visible_reconciliation', receipt.authoritative_visible_ledger_reconciled === true)
check('receipt_marks_chain_context_mode', receipt.conversation_context_mode === 'provider_chain_with_visible_delivery_delta')
check('receipt_binds_rcc_revas_pre_inference', receipt.rcc_revas_pre_inference_convergence_field === true)
check('receipt_binds_chatgpt_convergence_baseline', receipt.convergence_baseline === 'chatgpt_contextual_conversation_quality')
check('receipt_store_bound', receipt.stored === true)

const runnerSource = fs.readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
check('runner_uses_responses_endpoint', runnerSource.includes("'https://api.openai.com/v1/responses'"))
const executorSource = runnerSource.slice(
  runnerSource.indexOf('async function runAuthorityExecutor('),
  runnerSource.indexOf('function buildAiVisibleRouteLock(')
)
check('runner_uses_responses_as_only_visible_executor',
  executorSource.includes('runOpenAIResponses(') &&
  !executorSource.includes('runCodexWithFailover(') &&
  !executorSource.includes("executor = 'codex_cli'"))
check('runner_defaults_quality_ladder_head', runnerSource.includes('|| CHEAPEST_MODEL_LADDER[0]'))
check('runner_carries_conversation_receipt', runnerSource.includes('openai_conversation: result.conversation'))
check('runner_defaults_medium_reasoning', runnerSource.includes("process.env.OPENAI_RESPONSES_REASONING_EFFORT || 'medium'"))
check('runner_defaults_standard_mode', runnerSource.includes("process.env.OPENAI_RESPONSES_REASONING_MODE || ''"))
check('runner_does_not_force_open_conversation_route', runnerSource.includes("!['general_continue', 'social_continue', 'tattoo_continue'].includes(action)"))

const compactPrompt = fs.readFileSync(
  path.join(__dirname, 'lua-dm-gpt56-conversation-prompt-v1.txt'),
  'utf8'
)
check('compact_prompt_explains_information_openers',
  compactPrompt.includes('asks for more info / more information') &&
  compactPrompt.includes('resolved voice-note transcript') &&
  compactPrompt.includes('only a few model spots') &&
  compactPrompt.includes('tattoo is made from what the client wants') &&
  compactPrompt.includes("artist's own style") &&
  compactPrompt.includes('do not answer only with a question'))
check('compact_prompt_binds_context_anchor',
  compactPrompt.includes('context-dependent conversation anchor') &&
  compactPrompt.includes('required referent as binding'))

const longHistory = Array.from({ length: 120 }, (_, index) => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  message_id: `long-${index}`,
  text: index === 0 ? 'my name is Ledger Client and my phone is 4155550101' : `turn ${index}`
}))
const longReplay = conversation.buildResponsesRequest({
  model: 'gpt-5.6-terra', systemPrompt: 'SYSTEM',
  input: { ...input, live_message: 'yes that is correct', recent_history: longHistory },
  outputSchema: schema
})
check('long_ledger_replays_early_identity', JSON.stringify(longReplay.input).includes('Ledger Client'))
check('long_ledger_keeps_current_reply_last', longReplay.input.at(-1).content === 'yes that is correct')

const deterministicSuffix = conversation.buildResponsesRequest({
  model: 'gpt-5.6-terra', systemPrompt: 'SYSTEM', outputSchema: schema,
  previousResponseId: 'resp_bbbbbbbbbbbbbbbb',
  input: {
    ...input,
    live_message: 'yes that is right',
    recent_history: [
      { role: 'user', message_id: 'model-turn-1', text: 'i sent the form' },
      { role: 'assistant', message_id: 'model-turn-1', reply_to_message_id: 'model-turn-1', text: 'what date works for you?' },
      { role: 'user', message_id: 'deterministic-turn-1', text: 'august 30 at 2pm' },
      { role: 'assistant', message_id: 'deterministic-turn-1', reply_to_message_id: 'deterministic-turn-1', text: 'name: Ledger Client\nphone number: 4155550101\nappointment date: august 30\ntime: 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤' }
    ],
    structured_state: {
      openai_conversation_last_message_id: 'model-turn-1',
      name_phone_date_time_double_check_sent: true
    }
  }
})
check('deterministic_suffix_keeps_provider_chain', deterministicSuffix.previous_response_id === 'resp_bbbbbbbbbbbbbbbb')
check('deterministic_suffix_reconciles_exact_visible_turns',
  deterministicSuffix.input.length === 3 &&
  deterministicSuffix.input[0].content === 'august 30 at 2pm' &&
  deterministicSuffix.input[1].content.includes("can you give this a quick look and make sure it's all right? 🖤") &&
  deterministicSuffix.input[2].content === 'yes that is right')

process.stdout.write(JSON.stringify({ ok: true, checked }) + '\n')
