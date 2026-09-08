#!/usr/bin/env node

// Exact-snapshot visible model regression harness. Provider lifecycle changes
// are release events, never implicit cross-model behavior changes.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  CHEAPEST_MODEL_LADDER,
  modelIdentityMatches,
  openAIModelGoneError,
  nextCheapestAvailableModel,
  runOpenAIResponses
} = require('./codex-dm-runner.js')
const { buildResponsesRequest } = require('./scv-openai-conversation.js')

let checked = 0
function check(name, value) { assert.ok(value, name); checked += 1 }
function response(status, body) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => '' }, text: async () => JSON.stringify(body) }
}
function goneBody(model) {
  return { error: { message: `The model \`${model}\` does not exist or you do not have access to it.`, type: 'invalid_request_error', param: null, code: 'model_not_found' } }
}
function okBody(model, id) {
  return { id, model, output_text: '{"bubbles":["ok"],"quick_replies":[],"next_action":"continue"}' }
}
function input() {
  return {
    message_id: 'legacy-manychat-0123456789abcdef0123456789abcdef',
    contact_id: '1537753982', thread_id: '1537753982', live_message: 'hi there',
    recent_history: [],
    structured_state: {},
    control_transition_contract: { action: 'continue', reason: 'info', obligations: [] }
  }
}

async function main() {
  // --- sealed policy shape ---
  check('sole_model_is_dated_snapshot',
    CHEAPEST_MODEL_LADDER[0] === 'gpt-5.4-mini-2026-03-17')
  check('ladder_frozen', Object.isFrozen(CHEAPEST_MODEL_LADDER))
  check('cross_model_ladder_removed', CHEAPEST_MODEL_LADDER.length === 1)

  const releaseSource = fs.readFileSync(path.join(__dirname, 'scv-single-release.js'), 'utf8')
  check('release_imports_same_snapshot_authority',
    releaseSource.includes('SCV_VISIBLE_MODEL_SNAPSHOT'))
  check('release_reasoning_effort_medium', /reasoning_effort:\s*'medium'/.test(releaseSource))

  const runnerSource = fs.readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
  const conversationSource = fs.readFileSync(path.join(__dirname, 'scv-openai-conversation.js'), 'utf8')
  check('no_expensive_default_in_runner', !runnerSource.includes("'gpt-5.6-sol'"))
  check('no_expensive_default_in_conversation', !conversationSource.includes("'gpt-5.6-sol'"))
  check('no_xhigh_default_in_runner', !runnerSource.includes("|| 'xhigh'"))
  check('no_xhigh_default_in_conversation', !conversationSource.includes("'xhigh'"))

  // --- no implicit replacement mechanics ---
  check('sole_snapshot_has_no_next_model',
    nextCheapestAvailableModel(CHEAPEST_MODEL_LADDER[0]) === '')
  check('off_ladder_pin_collapses_to_quality_head', nextCheapestAvailableModel('gpt-5.6-sol') === CHEAPEST_MODEL_LADDER[0])
  check('gone_error_matches_model_not_found', openAIModelGoneError('The model `x` does not exist | invalid_request_error | model_not_found'))
  check('gone_error_matches_deprecation', openAIModelGoneError('This model has been deprecated and is no longer available'))
  check('gone_error_ignores_rate_limit', !openAIModelGoneError('Rate limit reached for model | rate_limit_exceeded'))
  check('gone_error_ignores_transient_5xx', !openAIModelGoneError('The server had an error while processing your request'))

  // --- request parameter compatibility with the approved tiers ---
  // Incident 2026-08-26: reasoning.context 'all_turns' is gpt-5.6-only; nano and
  // mini tiers return HTTP 400 unsupported_value for it, which silenced every DM.
  const dmSchema = { type: 'object', additionalProperties: false, required: ['bubbles'], properties: { bubbles: { type: 'array', items: { type: 'string' } } } }
  for (const ladderModel of CHEAPEST_MODEL_LADDER) {
    const built = buildResponsesRequest({ model: ladderModel, systemPrompt: 'SYSTEM', input: input(), outputSchema: dmSchema })
    check(`request_reasoning_context_model_compatible:${ladderModel}`,
      built.reasoning.context === 'auto')
    check(`request_effort_defaults_medium:${ladderModel}`, built.reasoning.effort === 'medium')
  }

  // --- provider snapshot identity ---
  check('identity_exact_match', modelIdentityMatches('gpt-5.4-mini', 'gpt-5.4-mini'))
  check('identity_dated_snapshot_match', modelIdentityMatches('gpt-5.4-mini', 'gpt-5.4-mini-2026-04-01'))
  check('dated_release_pin_rejects_alias',
    !modelIdentityMatches(CHEAPEST_MODEL_LADDER[0], 'gpt-5.4-mini'))
  check('dated_release_pin_accepts_only_exact_snapshot',
    modelIdentityMatches(CHEAPEST_MODEL_LADDER[0], CHEAPEST_MODEL_LADDER[0]))
  check('dated_release_pin_rejects_double_date_snapshot',
    !modelIdentityMatches(
      CHEAPEST_MODEL_LADDER[0],
      `${CHEAPEST_MODEL_LADDER[0]}-2026-04-01`
    ))
  check('identity_rejects_other_model', !modelIdentityMatches('gpt-5.4-mini', 'gpt-5-mini-2025-08-07'))
  check('identity_rejects_non_snapshot_suffix', !modelIdentityMatches('gpt-5.4-mini', 'gpt-5.4-mini-preview'))
  check('identity_rejects_missing_provider_model', !modelIdentityMatches('gpt-5.4-mini', ''))
  check('identity_alias_dot_is_literal', !modelIdentityMatches('gpt-5.4-nano', 'gpt-5x4-nano-2026-03-17'))

  // The control plane re-verifies the adopted conversation receipt against the
  // env pin; the receipt carries the provider's dated snapshot id, so that
  // check must use the same snapshot-aware matcher as the executors.
  const controlPlaneSource = fs.readFileSync(path.join(__dirname, 'scv-single-control-plane.js'), 'utf8')
  check('control_plane_receipt_check_is_snapshot_aware',
    controlPlaneSource.includes('modelIdentityMatches(pinnedModel'))
  check('control_plane_has_no_strict_pin_equality',
    !controlPlaneSource.includes('!== pinnedModel'))

  const snapshotCalls = []
  const snapshotIdentity = await runOpenAIResponses(input(), '', '', 5000, {
    apiKey: 'test-key', enforceModelIdentity: true, maxAttempts: 1,
    fetchImpl: async (url, options) => {
      snapshotCalls.push(JSON.parse(options.body).model)
      return response(200, okBody(CHEAPEST_MODEL_LADDER[0], 'resp_0123456789abcdeb'))
    }
  })
  check('enforced_identity_accepts_exact_snapshot',
    snapshotIdentity.status === 0 && snapshotIdentity.modelIdentityVerified === true &&
    snapshotCalls[0] === CHEAPEST_MODEL_LADDER[0])
  const substituted = await runOpenAIResponses(input(), '', '', 5000, {
    apiKey: 'test-key', enforceModelIdentity: true, maxAttempts: 1,
    fetchImpl: async () => response(200, okBody('gpt-5.4-mini', 'resp_0123456789abcdea'))
  })
  check('enforced_identity_rejects_mutable_alias_response',
    substituted.status !== 0 && String(substituted.error || '').includes('openai_model_identity_mismatch'))

  // --- provider deleted the pin -> fail closed, do not rotate ---
  const goneCalls = []
  const gone = await runOpenAIResponses(input(), '', '', 5000, {
    apiKey: 'test-key', enforceModelIdentity: true, maxAttempts: 4, sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body)
      goneCalls.push(body.model)
      return response(404, goneBody(body.model))
    }
  })
  check('deleted_snapshot_fails_closed', gone.status !== 0)
  check('deleted_snapshot_never_rotates',
    goneCalls.length === 1 && goneCalls[0] === CHEAPEST_MODEL_LADDER[0] &&
    !(gone.attempts || []).some((attempt) => attempt.model_gone_fallback))

  // A sealed runtime flag cannot be disabled by a call-site option.
  const before = process.env.SCV_ENFORCE_OPENAI_MODEL_IDENTITY
  process.env.SCV_ENFORCE_OPENAI_MODEL_IDENTITY = '1'
  try {
    const bypass = await runOpenAIResponses(input(), '', '', 5000, {
      apiKey: 'test-key', enforceModelIdentity: false, maxAttempts: 1,
      fetchImpl: async () => response(200, okBody('wrong-model', 'resp_0123456789abcded'))
    })
    check('call_site_cannot_disable_release_enforcement',
      bypass.status !== 0 && String(bypass.error || '').includes('openai_model_identity_mismatch'))
  } finally {
    if (before === undefined) delete process.env.SCV_ENFORCE_OPENAI_MODEL_IDENTITY
    else process.env.SCV_ENFORCE_OPENAI_MODEL_IDENTITY = before
  }

  // --- functional: transient failures never rotate the model ---
  const transientCalls = []
  const transient = await runOpenAIResponses(input(), '', '', 5000, {
    apiKey: 'test-key', enforceModelIdentity: true, maxAttempts: 3, sleepImpl: async () => {},
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body)
      transientCalls.push(body.model)
      if (transientCalls.length === 1) {
        return response(429, { error: { message: 'Rate limit reached', type: 'rate_limit_exceeded', code: 'rate_limit_exceeded' } })
      }
      return response(200, okBody(body.model, 'resp_0123456789abcdec'))
    }
  })
  check('rate_limit_does_not_rotate_model',
    transient.status === 0 &&
    transient.modelUsed === CHEAPEST_MODEL_LADDER[0] &&
    transientCalls.every((m) => m === CHEAPEST_MODEL_LADDER[0]) &&
    (transient.attempts || []).every((a) => !a.model_gone_fallback))

  console.log(`scv-cheapest-model-pin-harness ok checks=${checked}`)
}

main().catch((err) => {
  console.error(String(err?.stack || err))
  process.exit(1)
})
