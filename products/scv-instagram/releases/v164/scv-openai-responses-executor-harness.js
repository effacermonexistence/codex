#!/usr/bin/env node

const assert = require('assert')
const { runOpenAIResponses } = require('./codex-dm-runner.js')
const { canonicalizeFieldList } = require('./scv-structured-output-contract.js')

let checked = 0
function check(name, value) { assert.ok(value, name); checked += 1 }
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => '' }, text: async () => JSON.stringify(body) }
}
function input(previous = '') {
  return {
    message_id: 'legacy-manychat-0123456789abcdef0123456789abcdef',
    contact_id: '1537753982', thread_id: '1537753982', live_message: 'yes plz',
    recent_history: [
      { role: 'user', message_id: 'msg_offer_form', text: 'send the form?' },
      { role: 'assistant', message_id: 'msg_offer_form', reply_to_message_id: 'msg_offer_form', text: 'want me to send it here?' }
    ],
    structured_state: {
      openai_previous_response_id: previous,
      openai_conversation_last_message_id: previous ? 'msg_offer_form' : '',
      form_offer_asked: true
    },
    control_transition_contract: { action: 'send_form', reason: 'explicit_form_consent', obligations: ['send_exact_form_link'] }
  }
}

async function main() {
  const canonicalMetadata = canonicalizeFieldList(['customization', 'photo', 'made_up_field', 'photo'])
  check('metadata_aliases_canonicalized_without_duplicates',
    JSON.stringify(canonicalMetadata.canonical) === JSON.stringify(['design_direction', 'reference_media']))
  check('unknown_metadata_is_dropped_not_reply_blocking',
    JSON.stringify(canonicalMetadata.dropped) === JSON.stringify(['made_up_field']))
  const calls = []
  const success = await runOpenAIResponses(input(), '', 'gpt-5.6-terra', 5000, {
    apiKey: 'test-key', enforceModelIdentity: true, maxAttempts: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) })
      return response(200, { id: 'resp_0123456789abcdef', model: 'gpt-5.6-terra', output_text: '{"bubbles":["here you go https://form.jotform.com/251688329950064"],"quick_replies":[],"next_action":"wait_for_form"}' })
    }
  })
  check('success_status', success.status === 0)
  check('responses_endpoint', calls[0].url === 'https://api.openai.com/v1/responses')
  check('success_receipt', success.conversation?.response_id === 'resp_0123456789abcdef')
  check('success_model_verified', success.modelIdentityVerified === true)
  check('success_native_seed', success.conversation?.native_history_seeded === true)
  check('strict_format_sent', calls[0].body.text?.format?.strict === true)
  check('executor_receives_rcc_revas_convergence_field_first', calls[0].body.instructions.startsWith('RCC / REVAS PRE-INFERENCE CONVERGENCE FIELD\n\n'))
  check('executor_receives_chatgpt_quality_floor', calls[0].body.instructions.includes('CHATGPT CONVERSATION QUALITY FLOOR'))
  check('executor_instructions_are_bounded_not_full_rcc_corpus', Buffer.byteLength(calls[0].body.instructions) < 40000)
  check('executor_receives_visible_ledger_as_conversation', calls[0].body.input.length === 3 && calls[0].body.input.at(-1).content === 'yes plz')

  const ledgerReplayCalls = []
  const ledgerReplay = await runOpenAIResponses(input('resp_aaaaaaaaaaaaaaaa'), '', 'gpt-5.6-terra', 5000, {
    apiKey: 'test-key', enforceModelIdentity: true, maxAttempts: 1, sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); ledgerReplayCalls.push(body)
      return response(200, { id: 'resp_bbbbbbbbbbbbbbbb', model: 'gpt-5.6-terra', output_text: '{"bubbles":["ok"],"quick_replies":[],"next_action":"continue"}' })
    }
  })
  check('ledger_replay_success', ledgerReplay.status === 0)
  check('native_chain_uses_adopted_response', ledgerReplayCalls[0].previous_response_id === 'resp_aaaaaaaaaaaaaaaa')
  check('native_chain_sends_only_current_delta', ledgerReplayCalls[0].input.length === 1)
  check('native_chain_receipt', ledgerReplay.conversation?.native_history_seeded === false)
  check('native_chain_receipt_binds_previous', ledgerReplay.conversation?.previous_response_id === 'resp_aaaaaaaaaaaaaaaa')
  check('native_chain_reconciles_visible_ledger', ledgerReplay.conversation?.authoritative_visible_ledger_reconciled === true)

  const reseedCalls = []
  const reseeded = await runOpenAIResponses(input('resp_aaaaaaaaaaaaaaaa'), '', 'gpt-5.6-terra', 5000, {
    apiKey: 'test-key', enforceModelIdentity: true, maxAttempts: 2, sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); reseedCalls.push(body)
      if (reseedCalls.length === 1) return response(404, { error: { message: 'previous response not found' } })
      return response(200, { id: 'resp_bbbbbbbbbbbbbbbc', model: 'gpt-5.6-terra', output_text: '{"bubbles":["reseeded"],"quick_replies":[],"next_action":"continue"}' })
    }
  })
  check('invalid_provider_chain_reseeds_full_visible_ledger',
    reseeded.status === 0 && reseedCalls.length === 2 &&
    reseedCalls[0].previous_response_id === 'resp_aaaaaaaaaaaaaaaa' &&
    !Object.hasOwn(reseedCalls[1], 'previous_response_id') &&
    reseedCalls[1].input.length === 3)
  check('reseed_receipt_binds_failed_prior', reseeded.conversation?.reseeded_from_response_id === 'resp_aaaaaaaaaaaaaaaa')

  const mismatch = await runOpenAIResponses(input(), '', 'gpt-5.6-terra', 5000, {
    apiKey: 'test-key', enforceModelIdentity: true, maxAttempts: 1,
    fetchImpl: async () => response(200, { id: 'resp_cccccccccccccccc', model: 'wrong-model', output_text: '{"bubbles":["no"],"quick_replies":[],"next_action":"continue"}' })
  })
  check('model_mismatch_fails', mismatch.status !== 0 && mismatch.error.includes('openai_model_identity_mismatch'))

  const missingId = await runOpenAIResponses(input(), '', 'gpt-5.6-terra', 5000, {
    apiKey: 'test-key', maxAttempts: 1,
    fetchImpl: async () => response(200, { model: 'gpt-5.6-terra', output_text: '{"bubbles":["no id"],"quick_replies":[],"next_action":"continue"}' })
  })
  check('missing_response_id_uses_local_ledger_authority',
    missingId.status === 0 &&
    missingId.error === '' &&
    missingId.conversation?.provider_response_id_present === false &&
    missingId.conversation?.response_id === '')

  const completionCalls = []
  const incompleteThenComplete = await runOpenAIResponses(input(), '', 'gpt-5.6-terra', 5000, {
    apiKey: 'test-key', maxAttempts: 2, maxOutputTokens: 1200,
    sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      completionCalls.push(JSON.parse(options.body))
      if (completionCalls.length === 1) {
        return response(200, {
          id: 'resp_dddddddddddddddd', model: 'gpt-5.6-terra', status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' }, output: []
        })
      }
      return response(200, {
        id: 'resp_eeeeeeeeeeeeeeee', model: 'gpt-5.6-terra', status: 'completed',
        output_text: '{"bubbles":["recovered"],"quick_replies":[],"next_action":"continue"}'
      })
    }
  })
  check('incomplete_200_retries_instead_of_receipt_failure',
    incompleteThenComplete.status === 0 && completionCalls.length === 2)
  check('incomplete_retry_expands_completion_budget',
    completionCalls[0].max_output_tokens === 1200 && completionCalls[1].max_output_tokens === 4096)
  check('incomplete_retry_boosts_reasoning_only_for_completion',
    completionCalls[0].reasoning.effort === 'medium' && completionCalls[1].reasoning.effort === 'high')
  process.stdout.write(JSON.stringify({ ok: true, checked }) + '\n')
}

main().catch((error) => { process.stderr.write(String(error?.stack || error) + '\n'); process.exit(1) })
