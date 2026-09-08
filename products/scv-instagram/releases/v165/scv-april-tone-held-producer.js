#!/usr/bin/env node

// Produce release-bound April-tone evidence inside an isolated staging
// container. This command calls the real visible-author model lane directly,
// verifies its normal adoption guard, and then stops before every queue or
// transport surface. It does not import or call an outbox/ManyChat sender.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  canonicalJson
} = require('./scv-policy-contracts.js')
const {
  APRIL_TONE_STAGING_EVIDENCE_SCHEMA,
  APRIL_TONE_PRODUCER_VERSION,
  APRIL_TONE_CASE_SOURCE_KIND,
  MINIMUM_HELD_OUTPUT_CASES,
  MAXIMUM_VISIBLE_MESSAGES_PER_CASE,
  heldEvidencePayloadSha256,
  runAprilToneRegression
} = require('./scv-april-tone-regression.js')

const PRODUCER_PATH = __filename
const ACTIVE_PROMPT_PATH = path.join(__dirname, 'lua-dm-master-prompt-v17.txt')
const MANIFEST_PATH = path.join(__dirname, 'SCV_GOLDEN_PRODUCTION_RELEASE.json')

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function heldCase(caseId, message, options = {}) {
  const id = String(caseId)
  const state = {
    live_turn_text: String(message),
    live_turn_reply_required: true,
    intent_flags_resolved: true,
    ...JSON.parse(JSON.stringify(options.structured_state || {}))
  }
  return {
    case_id: id,
    input: {
      contact_id: `scv-held-tone-${id}`,
      thread_id: `scv-held-tone-${id}`,
      instagram_username: `held.tone.${id}`,
      message: String(message),
      text: String(message),
      live_message: String(message),
      received_at: '2026-08-20T12:00:00.000Z',
      intent_flags_resolved: true,
      recent_history: JSON.parse(JSON.stringify(options.recent_history || [])),
      structured_state: state
    }
  }
}

// These are synthetic inputs, not retained April replies and not a transcript.
// They exercise varied current model-authored surfaces while avoiding exact
// deterministic booking checkpoints. The case-set hash is release evidence.
const HELD_TONE_CASES = Object.freeze([
  heldCase('social-week', 'this week has been kinda chaotic honestly'),
  heldCase('social-good-news', 'i finally got the job i wanted'),
  heldCase('social-travel', 'im heading out of town for a few days'),
  heldCase('question-permission', 'can i ask you something real quick'),
  heldCase('tattoo-process', 'how does booking a tattoo with you work?', {
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'open_conversation' }
  }),
  heldCase('direct-price', 'what do you charge per hour?', {
    structured_state: { tattoo_intent_active: true, live_turn_asks_price: true }
  }),
  heldCase('black-gray', 'do you do black and gray work too?', {
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
  }),
  heldCase('work-compliment', 'your work is seriously beautiful', {
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'open_conversation' }
  }),
  heldCase('moth-idea', 'i want a moth with one broken wing', {
    structured_state: {
      tattoo_intent_active: true,
      live_turn_gave_design_idea: true,
      known_design_context: 'moth with one broken wing'
    }
  }),
  heldCase('snake-idea', 'im thinking a thin snake wrapping around a small flower', {
    structured_state: {
      tattoo_intent_active: true,
      live_turn_gave_design_idea: true,
      known_design_context: 'thin snake wrapping around a small flower'
    }
  }),
  heldCase('volunteer-placement', 'i was thinking upper arm for it', {
    recent_history: [{ role: 'user', text: 'i want a small moth piece' }],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'small moth piece',
      live_turn_placement_only: true,
      known_placement_context: 'upper arm'
    }
  }),
  heldCase('volunteer-size', 'probably around four inches but im flexible', {
    recent_history: [{ role: 'user', text: 'i want a snake and peony piece' }],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'snake and peony',
      live_turn_size_only: true,
      known_size_context: 'around four inches'
    }
  }),
  heldCase('first-tattoo', 'it would be my first tattoo and im a little nervous', {
    structured_state: {
      tattoo_intent_active: true,
      live_turn_needs_emotional_care: true,
      known_design_context: 'first tattoo'
    }
  }),
  heldCase('missing-reference', 'i mean this one', {
    structured_state: {
      tattoo_intent_active: true,
      live_turn_reference_pointer_without_media: true,
      live_turn_context_missing: true
    }
  }),
  heldCase('form-request', 'can you send me the application form?', {
    recent_history: [{ role: 'user', text: 'i want a blackwork chrysanthemum' }],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'blackwork chrysanthemum',
      live_turn_explicit_form_link_request: true
    }
  }),
  heldCase('form-consent', 'yeah send it please', {
    recent_history: [
      { role: 'user', text: 'i want a blackwork chrysanthemum' },
      { role: 'assistant', text: 'want me to send the form?' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'blackwork chrysanthemum',
      form_offer_asked: true,
      live_turn_form_consent: true
    }
  }),
  heldCase('not-sure-yet', 'i know i want something from you but i dont know the subject yet', {
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
  }),
  heldCase('emotional-design', 'the piece is for my brother and its hard to explain without getting emotional', {
    structured_state: {
      tattoo_intent_active: true,
      live_turn_needs_emotional_care: true,
      live_turn_gave_design_idea: true,
      known_design_context: 'memorial piece for brother'
    }
  }),
  heldCase('tattoo-followup', 'would that kind of linework age okay?', {
    recent_history: [{ role: 'user', text: 'i like really fine abstract linework' }],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'fine abstract linework'
    }
  }),
  heldCase('calendar-general', 'how far out are you usually booking?', {
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'open_conversation' }
  }),
  heldCase('reference-description', 'i like the curved shape in the reference more than the details', {
    structured_state: {
      tattoo_intent_active: true,
      live_turn_gave_design_idea: true,
      known_reference_media_received: true,
      known_design_context: 'curved shape from reference'
    }
  }),
  heldCase('style-question', 'could you reinterpret the idea in your own style?', {
    recent_history: [{ role: 'user', text: 'the idea is a wilted tulip' }],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'wilted tulip'
    }
  }),
  heldCase('availability-boundary', 'i can only do sundays later in the day', {
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'abstract floral piece',
      form_submitted: true,
      live_turn_date_constraint: 'sundays later in the day'
    }
  }),
  heldCase('social-after-context', 'also sorry if my messages are all over the place today', {
    recent_history: [{ role: 'user', text: 'i have been collecting tattoo ideas' }],
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
  })
])

function heldCaseDescriptors() {
  return HELD_TONE_CASES.map((entry) => ({
    case_id: entry.case_id,
    input_sha256: sha256(canonicalJson(entry.input))
  }))
}

function heldCaseSetSha256() {
  return sha256(canonicalJson(HELD_TONE_CASES))
}

function requireIsolatedStaging(manifest, env) {
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  const production = manifest?.deployment?.railway_identity || {}
  const expectedNamespace = `golden-staging-${String(manifest.content_fingerprint_sha256 || '').slice(0, 12)}`
  check(env.SCV_RELEASE_MODE === 'staging', 'release_mode_not_staging')
  check(env.SCV_PAUSE_ALL === '1', 'pause_all_not_one')
  check(env.SCV_PAUSE_NON_TEST === '1', 'pause_non_test_not_one')
  check(String(env.SCV_STAGING_REAL_E2E_ARMED || '0') === '0', 'real_e2e_armed')
  check(env.SCV_PERSIST_ROOT === '/data', 'persistence_root_not_data')
  check(env.RAILWAY_VOLUME_MOUNT_PATH === '/data', 'volume_mount_not_data')
  check(env.SCV_RUNTIME_NAMESPACE === expectedNamespace, 'runtime_namespace_mismatch')
  check(env.SCV_AUTO_RECOVERY_ENABLED === '0', 'auto_recovery_not_disabled')
  check(env.SCV_MANYCHAT_INPUT_SWEEP === '0', 'manychat_sweep_not_disabled')
  check(env.SCV_LEGACY_INTERNAL_QUEUE_HTTP === '0', 'legacy_queue_http_not_disabled')
  check(env.OPENAI_DM_MODEL === manifest?.models?.chat, 'visible_model_pin_mismatch')
  check(env.SCV_ENFORCE_OPENAI_MODEL_IDENTITY === '1', 'model_identity_gate_not_enabled')
  check(/^[0-9a-f-]{36}$/.test(String(env.RAILWAY_PROJECT_ID || '')), 'project_id_invalid')
  check(/^[0-9a-f-]{36}$/.test(String(env.RAILWAY_ENVIRONMENT_ID || '')), 'environment_id_invalid')
  check(/^[0-9a-f-]{36}$/.test(String(env.RAILWAY_SERVICE_ID || '')), 'service_id_invalid')
  check(env.RAILWAY_PROJECT_ID === production.RAILWAY_PROJECT_ID, 'project_id_mismatch')
  check(env.RAILWAY_ENVIRONMENT_ID !== production.RAILWAY_ENVIRONMENT_ID, 'environment_not_isolated')
  check(env.RAILWAY_SERVICE_ID !== production.RAILWAY_SERVICE_ID, 'service_not_isolated')
  check(String(env.RAILWAY_ENVIRONMENT_NAME || '').toLowerCase() !== 'production', 'environment_name_is_production')
  if (failures.length) throw new Error(`april_tone_staging_isolation_rejected:${failures.join(',')}`)
  return {
    release_mode: 'staging',
    project_id: env.RAILWAY_PROJECT_ID,
    environment_id: env.RAILWAY_ENVIRONMENT_ID,
    environment_name: String(env.RAILWAY_ENVIRONMENT_NAME || ''),
    service_id: env.RAILWAY_SERVICE_ID,
    service_name: String(env.RAILWAY_SERVICE_NAME || ''),
    runtime_namespace: env.SCV_RUNTIME_NAMESPACE,
    persistence_root: '/data',
    pause_all: true,
    pause_non_test: true,
    real_e2e_armed: false
  }
}

function visibleMessagesFromPacket(packet) {
  return (Array.isArray(packet?.bubbles) ? packet.bubbles : [])
    .map((bubble) => String(bubble?.text || '').trim())
    .filter(Boolean)
}

function compactErrorClass(error) {
  const text = String(error?.message || error || 'unknown')
  return text.split(/\s+::\s+|:/, 1)[0].slice(0, 120) || 'unknown'
}

const TONE_FLOOR_FAILURE_CODE = 'april_tone_held_output_floor_failed'
const TONE_FAILURE_METRIC_KEYS = Object.freeze({
  corpus_nonempty: 'message_count',
  mean_length_floor: 'mean_characters_per_message',
  p95_length_floor: 'p95_characters_per_message',
  single_message_length_floor: 'maximum_single_message_characters',
  emoji_frequency_floor: 'emoji_message_ratio',
  selective_greeting_floor: 'greeting_opener_ratio',
  exclamation_restraint_floor: 'exclamation_message_ratio',
  anti_template_duplicate_floor: 'normalized_duplicate_ratio',
  generic_ai_phrase_floor: 'generic_ai_phrase_ratio',
  em_dash_floor: 'em_dash_message_ratio',
  no_consecutive_emoji_messages: 'consecutive_emoji_pairs'
})

// A failed stochastic tone sample must remain blocking, but the operator still
// needs to know which measurable floor moved. Keep this receipt deliberately
// free of generated prose, prompts, identities, and credentials: it contains
// only public check names and numeric aggregate metrics.
function toneFloorFailureDiagnostics(tone) {
  const corpus = tone?.corpus && typeof tone.corpus === 'object' ? tone.corpus : {}
  const metrics = corpus.metrics && typeof corpus.metrics === 'object' ? corpus.metrics : {}
  const failedChecks = (Array.isArray(corpus.checks) ? corpus.checks : [])
    .filter((check) => check?.pass !== true)
    .map((check) => String(check?.name || ''))
    .filter((name) => Object.prototype.hasOwnProperty.call(TONE_FAILURE_METRIC_KEYS, name))
  const observed = {}
  for (const name of failedChecks) {
    const metric = TONE_FAILURE_METRIC_KEYS[name]
    const value = metric === 'message_count'
      ? Number(metrics.message_count || 0)
      : Number(metrics[metric])
    observed[metric] = Number.isFinite(value) ? value : null
  }
  return {
    failed_checks: failedChecks,
    message_count: Number(metrics.message_count || 0),
    observed,
    metrics_sha256: sha256(canonicalJson(metrics))
  }
}

function toneFloorFailure(tone) {
  const error = new Error(TONE_FLOOR_FAILURE_CODE)
  error.code = TONE_FLOOR_FAILURE_CODE
  error.safe_diagnostics = toneFloorFailureDiagnostics(tone)
  return error
}

function producerErrorLine(error) {
  if (error?.code === TONE_FLOOR_FAILURE_CODE && error?.safe_diagnostics) {
    return canonicalJson({
      ok: false,
      error: TONE_FLOOR_FAILURE_CODE,
      diagnostics: error.safe_diagnostics
    })
  }
  return compactErrorClass(error)
}

async function produceHeldToneEvidence(options = {}) {
  const manifest = options.manifest || JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const env = options.env || process.env
  const runner = options.runner || require('./codex-dm-runner.js')
  const modelFlow = options.modelFlow || runner.runModelAuthoredFlow
  const now = typeof options.now === 'function' ? options.now : () => new Date()
  const producerSource = options.producerSource || fs.readFileSync(PRODUCER_PATH)
  const runtime = requireIsolatedStaging(manifest, env)
  const activePromptSha256 = sha256(fs.readFileSync(ACTIVE_PROMPT_PATH))
  const effectiveVisibleAuthoritySha256 = sha256(runner.buildVisibleReplySystemPrompt())
  const producerSha256 = sha256(producerSource)
  const caseSetSha256 = heldCaseSetSha256()
  const outputs = []
  const failedCases = []

  for (const descriptor of HELD_TONE_CASES) {
    const input = JSON.parse(JSON.stringify(descriptor.input))
    const inputSha256 = sha256(canonicalJson(input))
    try {
      runner.reconcileControllerPlanAfterAuthorityEvidence(input)
      if (
        runner.buildPreIntentDeterministicBookingPacket(input) ||
        runner.buildDeterministicBookingPacket(input) ||
        runner.buildDeterministicOpenerPacket(input)
      ) {
        throw new Error('held_case_routes_to_deterministic_visible_author')
      }
      const routeLock = runner.buildAiVisibleRouteLock(input)
      const result = await modelFlow(input, routeLock)
      const visibleMessages = visibleMessagesFromPacket(result?.packet)
      const visibleText = visibleMessages.join('\n')
      const authority = result?.authority || {}
      if (result?.source !== 'codex_exec_dm_authority') throw new Error('model_authority_source_invalid')
      if (String(authority.executor || '') !== 'openai_responses_conversation') {
        throw new Error('model_authority_executor_invalid')
      }
      if (authority.deterministic_recovery !== false) throw new Error('deterministic_recovery_not_false')
      if (String(authority.model || '') !== String(manifest.models?.chat || '')) {
        throw new Error('model_identity_not_release_pin')
      }
      if (!visibleText) throw new Error('model_visible_text_missing')
      if (visibleMessages.length > MAXIMUM_VISIBLE_MESSAGES_PER_CASE) {
        throw new Error('model_visible_message_count_exceeded')
      }
      for (const field of ['prompt_sha256', 'identity_prompt_sha256', 'output_schema_sha256']) {
        if (!/^[a-f0-9]{64}$/.test(String(authority[field] || ''))) {
          throw new Error(`model_authority_${field}_invalid`)
        }
      }
      const authorReceipt = {
        authority_source: result.source,
        authority_executor: authority.executor,
        model_id: authority.model,
        model_prompt_sha256: authority.prompt_sha256,
        identity_prompt_sha256: authority.identity_prompt_sha256,
        structured_output_schema_sha256: authority.output_schema_sha256,
        model_reauthor_passes: Number(authority.model_reauthor_passes || 0),
        deterministic_recovery: false
      }
      outputs.push({
        case_id: descriptor.case_id,
        held: true,
        delivered: false,
        visible_author_kind: 'model_authored',
        input_sha256: inputSha256,
        output_sha256: sha256(visibleText),
        visible_messages_sha256: sha256(canonicalJson(visibleMessages)),
        visible_messages: visibleMessages,
        visible_text: visibleText,
        transport_invoked: false,
        outbox_enqueued: false,
        send_attempted: false,
        manychat_sendcontent_called: false,
        ...authorReceipt,
        author_receipt_sha256: sha256(canonicalJson(authorReceipt))
      })
    } catch (error) {
      const errorText = String(error?.message || error || 'unknown')
      failedCases.push({
        case_id: descriptor.case_id,
        error_class: compactErrorClass(error),
        error_sha256: sha256(errorText)
      })
    }
  }

  if (outputs.length < MINIMUM_HELD_OUTPUT_CASES) {
    throw new Error(
      `april_tone_held_output_shortfall:${outputs.length}:${MINIMUM_HELD_OUTPUT_CASES}:${failedCases.map((entry) => entry.case_id).join(',')}`
    )
  }
  const tone = runAprilToneRegression({ candidate: { outputs } })
  if (!tone.ok) {
    throw toneFloorFailure(tone)
  }

  const noSendProof = {
    code_path: 'direct_model_authoring_then_hold_without_queue_or_transport_import',
    transport_path_invoked: false,
    outbox_enqueued: false,
    delivery_attempted: false,
    manychat_sendcontent_called: false,
    visible_instagram_delivery: false,
    terminal_state: 'held_before_transport'
  }
  const evidence = {
    schema: APRIL_TONE_STAGING_EVIDENCE_SCHEMA,
    producer_version: APRIL_TONE_PRODUCER_VERSION,
    source_kind: 'held_isolated_staging_outputs',
    source_case_kind: APRIL_TONE_CASE_SOURCE_KIND,
    capture_mode: 'isolated_staging_hold_no_send',
    visible_author_kind: 'model_authored',
    floor_fixture_used: false,
    floor_fixture_used_for_generation: false,
    tone_floor_evaluation_only: true,
    release_id: String(manifest.release_id || ''),
    content_fingerprint_sha256: String(manifest.content_fingerprint_sha256 || ''),
    release_manifest_sha256: String(manifest.release_manifest_sha256 || ''),
    active_prompt_sha256: activePromptSha256,
    effective_visible_authority_sha256: effectiveVisibleAuthoritySha256,
    producer_sha256: producerSha256,
    case_set_sha256: caseSetSha256,
    minimum_case_count: MINIMUM_HELD_OUTPUT_CASES,
    maximum_visible_messages_per_case: MAXIMUM_VISIBLE_MESSAGES_PER_CASE,
    attempted_case_count: HELD_TONE_CASES.length,
    successful_case_count: outputs.length,
    failed_case_count: failedCases.length,
    failed_cases: failedCases,
    captured_at_utc: now().toISOString(),
    runtime,
    isolation: {
      production_environment_mutated: false,
      production_service_mutated: false,
      environment_isolated_from_production: true,
      service_isolated_from_production: true
    },
    no_send_proof: noSendProof,
    tone_regression: {
      regression_version: tone.regression_version,
      tone_floor_sha256: tone.tone_floor_sha256,
      evaluation_mode: tone.evaluation_mode,
      corpus: tone.corpus
    },
    outputs,
    outputs_sha256: sha256(canonicalJson(outputs))
  }
  evidence.evidence_payload_sha256 = heldEvidencePayloadSha256(evidence)
  return evidence
}

async function main() {
  if (process.argv.length > 2) throw new Error('april_tone_held_producer_accepts_no_arguments')
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const release = require('./scv-golden-release.js')
  const verification = release.runGoldenReleaseVerification({
    root: __dirname,
    env: process.env,
    verifyFiles: true,
    verifyEnvironmentValues: false,
    verifyRailway: false,
    verifyPersistence: false,
    verifyStaging: true
  })
  if (!verification.ok) {
    throw new Error(`april_tone_release_verification_rejected:${verification.failures.join(',')}`)
  }
  const evidence = await produceHeldToneEvidence({ manifest })
  // One JSON line makes Railway SSH capture unambiguous. No secrets or private
  // account data are included; all inputs are fixed synthetic release cases.
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${producerErrorLine(error)}\n`)
    process.exit(1)
  })
}

module.exports = {
  HELD_TONE_CASES,
  heldCaseDescriptors,
  heldCaseSetSha256,
  requireIsolatedStaging,
  visibleMessagesFromPacket,
  toneFloorFailureDiagnostics,
  producerErrorLine,
  produceHeldToneEvidence
}
