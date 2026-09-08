#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  canonicalJson
} = require('./scv-policy-contracts.js')

const APRIL_TONE_FLOOR_PATH = path.join(__dirname, 'SCV_APRIL_TONE_FLOOR.json')
const ACTIVE_PROMPT_PATH = path.join(__dirname, 'lua-dm-master-prompt-v17.txt')
const APRIL_TONE_REGRESSION_VERSION =
  'scv-april-tone-regression-2026-08-25-v5-responses-authority'
const APRIL_TONE_HELD_OUTPUT_SCHEMA =
  'scv-april-tone-held-output-corpus-2026-08-25-v4-responses-authority'
const APRIL_TONE_STAGING_EVIDENCE_SCHEMA =
  'scv-april-tone-staging-held-evidence-2026-08-25-v3-responses-authority'
const APRIL_TONE_CAPTURE_VERSION =
  'scv-april-tone-held-capture-2026-08-25-v3-responses-authority'
const APRIL_TONE_PRODUCER_VERSION =
  'scv-april-tone-held-producer-2026-08-25-v3-responses-authority'
const APRIL_TONE_CASE_SOURCE_KIND =
  'release_bound_synthetic_held_cases_not_april_floor_fixture'
const MINIMUM_HELD_OUTPUT_CASES = 19
const MAXIMUM_HELD_OUTPUT_CASES = 64
const MAXIMUM_VISIBLE_MESSAGES_PER_CASE = 4
const MODEL_AUTHORED_EXECUTORS = new Set([
  'openai_responses_conversation'
])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function payloadSha256(value, field) {
  const copy = JSON.parse(JSON.stringify(value || {}))
  delete copy[field]
  return sha256(canonicalJson(copy))
}

function heldEvidencePayloadSha256(value) {
  return payloadSha256(value, 'evidence_payload_sha256')
}

function heldCandidatePayloadSha256(value) {
  return payloadSha256(value, 'candidate_payload_sha256')
}

function readAprilToneFloor(file = APRIL_TONE_FLOOR_PATH) {
  const floor = JSON.parse(fs.readFileSync(file, 'utf8'))
  const calculated = sha256(canonicalJson(floor))
  if (calculated !== String(floor.declared_sha256 || '')) {
    throw new Error(
      `scv_april_tone_floor_hash_mismatch:${floor.declared_sha256 || ''}:${calculated}`
    )
  }
  return { ...floor, calculated_sha256: calculated }
}

function normalizeMessage(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9' ]+/g, '')
    .trim()
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return 0
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)
  )
  return sortedValues[index]
}

function containsEmoji(value) {
  return /\p{Extended_Pictographic}/u.test(String(value || ''))
}

function visibleMessagesFromEntry(entry) {
  if (typeof entry === 'string') return entry.trim() ? [entry] : []
  if (!entry || typeof entry !== 'object') return []
  // Instagram delivers packet bubbles as separate visible messages. Held
  // evidence therefore carries the exact sanitized bubble strings explicitly;
  // treating their newline-joined display form as one message inflates every
  // length metric and evaluates a transport unit that never exists.
  if (Object.prototype.hasOwnProperty.call(entry, 'visible_messages')) {
    return (Array.isArray(entry.visible_messages) ? entry.visible_messages : [])
      .filter((message) => typeof message === 'string' && message.trim())
  }
  if (Array.isArray(entry.bubbles)) {
    return entry.bubbles
      .map((bubble) => typeof bubble?.text === 'string' ? bubble.text.trim() : '')
      .filter(Boolean)
  }
  for (const key of ['visible_text', 'reply_text', 'text']) {
    if (typeof entry[key] === 'string' && entry[key].trim()) return [entry[key]]
  }
  return []
}

function corpusFrom(value) {
  if (Array.isArray(value)) return value.flatMap(visibleMessagesFromEntry).filter(Boolean)
  if (value && typeof value === 'object') {
    for (const key of ['outputs', 'messages', 'replies', 'corpus', 'source_visible_fixture_corpus']) {
      if (Array.isArray(value[key])) return corpusFrom(value[key])
    }
  }
  return []
}

function evaluateToneCorpus(messagesInput, floor = readAprilToneFloor()) {
  const messages = corpusFrom(messagesInput)
  const thresholds = floor.thresholds || {}
  const lengths = messages.map((message) => [...String(message)].length).sort((a, b) => a - b)
  const mean = lengths.length
    ? lengths.reduce((sum, length) => sum + length, 0) / lengths.length
    : 0
  const normalized = messages.map(normalizeMessage).filter(Boolean)
  const duplicates = Math.max(0, normalized.length - new Set(normalized).size)
  const emojiFlags = messages.map(containsEmoji)
  const emojiCount = emojiFlags.filter(Boolean).length
  let consecutiveEmojiPairs = 0
  for (let index = 1; index < emojiFlags.length; index += 1) {
    if (emojiFlags[index - 1] && emojiFlags[index]) consecutiveEmojiPairs += 1
  }
  const greetingCount = messages.filter((message) =>
    /^\s*(?:h+i+|hey+|hello+|yo)\b/i.test(String(message || ''))
  ).length
  const exclamationCount = messages.filter((message) => /!/.test(String(message || ''))).length
  const emDashCount = messages.filter((message) => /—/.test(String(message || ''))).length
  const genericPhrases = (floor.generic_ai_phrases || []).map((phrase) =>
    normalizeMessage(phrase)
  )
  const genericMatches = messages.filter((message) => {
    const candidate = normalizeMessage(message)
    return genericPhrases.some((phrase) => phrase && candidate.includes(phrase))
  }).length
  const denominator = Math.max(1, messages.length)
  const metrics = {
    message_count: messages.length,
    mean_characters_per_message: Number(mean.toFixed(4)),
    p95_characters_per_message: percentile(lengths, 0.95),
    maximum_single_message_characters: lengths[lengths.length - 1] || 0,
    emoji_message_ratio: Number((emojiCount / denominator).toFixed(4)),
    greeting_opener_ratio: Number((greetingCount / denominator).toFixed(4)),
    exclamation_message_ratio: Number((exclamationCount / denominator).toFixed(4)),
    normalized_duplicate_ratio: Number((duplicates / denominator).toFixed(4)),
    generic_ai_phrase_ratio: Number((genericMatches / denominator).toFixed(4)),
    em_dash_message_ratio: Number((emDashCount / denominator).toFixed(4)),
    consecutive_emoji_pairs: consecutiveEmojiPairs
  }
  const checks = [
    ['corpus_nonempty', messages.length > 0],
    [
      'mean_length_floor',
      metrics.mean_characters_per_message <= thresholds.maximum_mean_characters_per_message
    ],
    [
      'p95_length_floor',
      metrics.p95_characters_per_message <= thresholds.maximum_p95_characters_per_message
    ],
    [
      'single_message_length_floor',
      metrics.maximum_single_message_characters <= thresholds.maximum_single_message_characters
    ],
    ['emoji_frequency_floor', metrics.emoji_message_ratio <= thresholds.maximum_emoji_message_ratio],
    ['selective_greeting_floor', metrics.greeting_opener_ratio <= thresholds.maximum_greeting_opener_ratio],
    [
      'exclamation_restraint_floor',
      metrics.exclamation_message_ratio <= thresholds.maximum_exclamation_message_ratio
    ],
    [
      'anti_template_duplicate_floor',
      metrics.normalized_duplicate_ratio <= thresholds.maximum_normalized_duplicate_ratio
    ],
    [
      'generic_ai_phrase_floor',
      metrics.generic_ai_phrase_ratio <= thresholds.maximum_generic_ai_phrase_ratio
    ],
    ['em_dash_floor', metrics.em_dash_message_ratio <= thresholds.maximum_em_dash_message_ratio],
    [
      'no_consecutive_emoji_messages',
      metrics.consecutive_emoji_pairs <= thresholds.maximum_consecutive_emoji_pairs
    ]
  ].map(([name, pass]) => ({ name, pass: Boolean(pass) }))
  return {
    valid: checks.every((check) => check.pass),
    metrics,
    thresholds,
    checks
  }
}

function verifyActivePromptToneAnchors(
  floor = readAprilToneFloor(),
  prompt = fs.readFileSync(ACTIVE_PROMPT_PATH, 'utf8')
) {
  const checks = (floor.required_active_prompt_anchors || []).map((anchor) => ({
    anchor,
    pass: prompt.includes(anchor)
  }))
  return {
    valid: checks.every((check) => check.pass),
    active_prompt_sha256: sha256(Buffer.from(prompt)),
    checks
  }
}

function runAprilToneRegression(options = {}) {
  const floor = readAprilToneFloor(options.floorPath || APRIL_TONE_FLOOR_PATH)
  const hasExplicitCandidate = Object.prototype.hasOwnProperty.call(options, 'candidate')
  const verifyFloorFixture = options.verifyFloorFixture === true
  if (hasExplicitCandidate && verifyFloorFixture) {
    throw new Error('scv_april_tone_candidate_mode_conflict')
  }
  if (!hasExplicitCandidate && !verifyFloorFixture) {
    throw new Error('scv_april_tone_explicit_candidate_required')
  }
  const candidate = verifyFloorFixture
    ? floor.source_visible_fixture_corpus
    : options.candidate
  const corpus = evaluateToneCorpus(candidate, floor)
  const prompt = verifyActivePromptToneAnchors(
    floor,
    options.prompt === undefined
      ? fs.readFileSync(ACTIVE_PROMPT_PATH, 'utf8')
      : String(options.prompt)
  )
  return {
    ok: corpus.valid && prompt.valid,
    regression_version: APRIL_TONE_REGRESSION_VERSION,
    tone_floor_schema_version: floor.schema_version,
    tone_floor_sha256: floor.calculated_sha256,
    source_kind: floor.source_boundary?.source_kind || '',
    source_boundary: floor.source_boundary,
    evaluation_mode: verifyFloorFixture
      ? 'floor_fixture_self_test_only'
      : 'explicit_candidate_outputs',
    explicit_candidate_supplied: hasExplicitCandidate,
    corpus,
    prompt
  }
}

function verifyHeldOutputCandidate(candidate, options = {}) {
  const floor = options.floor || readAprilToneFloor(options.floorPath || APRIL_TONE_FLOOR_PATH)
  const failures = []
  const check = (condition, reason) => {
    if (!condition) failures.push(reason)
  }
  const value = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate
    : {}
  const messages = corpusFrom(candidate)
  const outputs = Array.isArray(value.outputs) ? value.outputs : []
  const minimumCases = MINIMUM_HELD_OUTPUT_CASES
  const inputHashes = new Set()
  const floorFixtureNormalized = new Set(
    corpusFrom(floor.source_visible_fixture_corpus)
      .map(normalizeMessage)
      .filter(Boolean)
  )
  const sourceEvidence = value.source_evidence &&
    typeof value.source_evidence === 'object' &&
    !Array.isArray(value.source_evidence)
    ? value.source_evidence
    : {}
  const sourceOutputs = Array.isArray(sourceEvidence.outputs)
    ? sourceEvidence.outputs
    : []
  const stagingEvidence = value.staging_evidence &&
    typeof value.staging_evidence === 'object' &&
    !Array.isArray(value.staging_evidence)
    ? value.staging_evidence
    : {}
  const noSendProof = value.no_send_proof &&
    typeof value.no_send_proof === 'object' &&
    !Array.isArray(value.no_send_proof)
    ? value.no_send_proof
    : {}

  check(value.schema === APRIL_TONE_HELD_OUTPUT_SCHEMA, 'held_output_schema_mismatch')
  check(value.capture_tool_version === APRIL_TONE_CAPTURE_VERSION, 'held_output_capture_tool_version_invalid')
  check(value.producer_version === APRIL_TONE_PRODUCER_VERSION, 'held_output_producer_version_invalid')
  check(value.source_kind === 'held_isolated_staging_outputs', 'held_output_source_kind_invalid')
  check(value.source_case_kind === APRIL_TONE_CASE_SOURCE_KIND, 'held_output_case_source_kind_invalid')
  check(value.capture_mode === 'isolated_staging_hold_no_send', 'held_output_capture_mode_invalid')
  check(value.visible_author_kind === 'model_authored', 'held_output_visible_author_kind_invalid')
  check(value.production_mutation === false, 'held_output_production_mutation_not_false')
  check(value.production_delivery === false, 'held_output_production_delivery_not_false')
  check(value.floor_fixture_used === false, 'held_output_floor_fixture_use_not_false')
  // Case diversity and message-unit count are separate gates. A single model
  // turn split into many bubbles can never satisfy the held-case floor.
  check(outputs.length >= minimumCases, 'held_output_case_count_too_small')
  check(outputs.length <= MAXIMUM_HELD_OUTPUT_CASES, 'held_output_case_count_too_large')
  check(/^[a-f0-9]{64}$/.test(String(value.release_manifest_sha256 || '')), 'held_output_release_manifest_hash_invalid')
  check(/^[a-f0-9]{64}$/.test(String(value.effective_visible_authority_sha256 || '')), 'held_output_effective_authority_hash_invalid')
  check(/^[a-f0-9]{64}$/.test(String(value.producer_sha256 || '')), 'held_output_producer_hash_invalid')
  check(/^[a-f0-9]{64}$/.test(String(value.case_set_sha256 || '')), 'held_output_case_set_hash_invalid')
  check(
    String(value.outputs_sha256 || '') === sha256(canonicalJson(outputs)),
    'held_output_outputs_hash_mismatch'
  )
  check(
    String(value.source_evidence_sha256 || '') === sha256(canonicalJson(sourceEvidence)),
    'held_output_source_evidence_hash_mismatch'
  )
  check(
    String(value.candidate_payload_sha256 || '') === heldCandidatePayloadSha256(value),
    'held_output_candidate_payload_hash_mismatch'
  )
  const outputIds = new Set()
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index] && typeof outputs[index] === 'object' ? outputs[index] : {}
    const id = String(output.case_id || '')
    const declaredVisibleMessages = output.visible_messages
    const visibleMessages = Array.isArray(declaredVisibleMessages)
      ? declaredVisibleMessages
        .filter((message) => typeof message === 'string' && message.trim())
      : []
    const visibleMessagesAreSanitized =
      Array.isArray(declaredVisibleMessages) &&
      declaredVisibleMessages.length > 0 &&
      visibleMessages.length === declaredVisibleMessages.length &&
      declaredVisibleMessages.every((message) => message === message.trim())
    const visibleText = visibleMessages.join('\n')
    if (!id || outputIds.has(id)) failures.push(`held_output_case_id_invalid:${index}`)
    if (id) outputIds.add(id)
    if (output.held !== true) failures.push(`held_output_not_held:${index}`)
    if (output.delivered !== false) failures.push(`held_output_delivery_not_false:${index}`)
    if (output.visible_author_kind !== 'model_authored') failures.push(`held_output_author_kind_invalid:${index}`)
    if (!visibleMessagesAreSanitized) failures.push(`held_output_visible_messages_invalid:${index}`)
    if (visibleMessages.length > MAXIMUM_VISIBLE_MESSAGES_PER_CASE) {
      failures.push(`held_output_visible_message_count_too_large:${index}`)
    }
    if (String(output.visible_text || '') !== visibleText) {
      failures.push(`held_output_visible_message_join_mismatch:${index}`)
    }
    if (!visibleText) failures.push(`held_output_visible_text_missing:${index}`)
    if (!/^[a-f0-9]{64}$/.test(String(output.input_sha256 || ''))) {
      failures.push(`held_output_input_hash_invalid:${index}`)
    }
    if (inputHashes.has(String(output.input_sha256 || ''))) {
      failures.push(`held_output_input_hash_duplicate:${index}`)
    }
    if (/^[a-f0-9]{64}$/.test(String(output.input_sha256 || ''))) {
      inputHashes.add(String(output.input_sha256))
    }
    if (String(output.output_sha256 || '') !== sha256(visibleText)) {
      failures.push(`held_output_visible_hash_mismatch:${index}`)
    }
    if (String(output.visible_messages_sha256 || '') !== sha256(canonicalJson(visibleMessages))) {
      failures.push(`held_output_visible_messages_hash_mismatch:${index}`)
    }
    if (visibleMessages.some((message) => floorFixtureNormalized.has(normalizeMessage(message)))) {
      failures.push(`held_output_matches_floor_fixture:${index}`)
    }
    if (output.transport_invoked !== false) failures.push(`held_output_transport_invoked_not_false:${index}`)
    if (output.outbox_enqueued !== false) failures.push(`held_output_outbox_enqueued_not_false:${index}`)
    if (output.send_attempted !== false) failures.push(`held_output_send_attempted_not_false:${index}`)
    if (output.manychat_sendcontent_called !== false) failures.push(`held_output_manychat_call_not_false:${index}`)
    if (output.authority_source !== 'codex_exec_dm_authority') {
      failures.push(`held_output_authority_source_invalid:${index}`)
    }
    if (!MODEL_AUTHORED_EXECUTORS.has(String(output.authority_executor || ''))) {
      failures.push(`held_output_authority_executor_invalid:${index}`)
    }
    if (!String(output.model_id || '').trim()) failures.push(`held_output_model_id_missing:${index}`)
    if (output.deterministic_recovery !== false) {
      failures.push(`held_output_deterministic_recovery_not_false:${index}`)
    }
    for (const field of [
      'model_prompt_sha256',
      'identity_prompt_sha256',
      'structured_output_schema_sha256',
      'author_receipt_sha256'
    ]) {
      if (!/^[a-f0-9]{64}$/.test(String(output[field] || ''))) {
        failures.push(`held_output_${field}_invalid:${index}`)
      }
    }
  }

  check(sourceEvidence.schema === APRIL_TONE_STAGING_EVIDENCE_SCHEMA, 'held_output_source_evidence_schema_invalid')
  check(sourceEvidence.producer_version === APRIL_TONE_PRODUCER_VERSION, 'held_output_source_evidence_producer_invalid')
  check(sourceEvidence.source_kind === 'held_isolated_staging_outputs', 'held_output_source_evidence_kind_invalid')
  check(sourceEvidence.source_case_kind === APRIL_TONE_CASE_SOURCE_KIND, 'held_output_source_evidence_case_kind_invalid')
  check(sourceEvidence.capture_mode === 'isolated_staging_hold_no_send', 'held_output_source_evidence_capture_mode_invalid')
  check(sourceEvidence.floor_fixture_used === false, 'held_output_source_evidence_floor_fixture_use_not_false')
  check(sourceEvidence.release_id === value.release_id, 'held_output_source_evidence_release_id_mismatch')
  check(sourceEvidence.content_fingerprint_sha256 === value.content_fingerprint_sha256, 'held_output_source_evidence_fingerprint_mismatch')
  check(sourceEvidence.release_manifest_sha256 === value.release_manifest_sha256, 'held_output_source_evidence_manifest_hash_mismatch')
  check(sourceEvidence.active_prompt_sha256 === value.active_prompt_sha256, 'held_output_source_evidence_prompt_hash_mismatch')
  check(sourceEvidence.effective_visible_authority_sha256 === value.effective_visible_authority_sha256, 'held_output_source_evidence_authority_hash_mismatch')
  check(sourceEvidence.producer_sha256 === value.producer_sha256, 'held_output_source_evidence_producer_hash_mismatch')
  check(sourceEvidence.case_set_sha256 === value.case_set_sha256, 'held_output_source_evidence_case_set_hash_mismatch')
  check(sourceEvidence.outputs_sha256 === value.outputs_sha256, 'held_output_source_evidence_outputs_hash_mismatch')
  check(
    String(sourceEvidence.evidence_payload_sha256 || '') === heldEvidencePayloadSha256(sourceEvidence),
    'held_output_source_evidence_payload_hash_mismatch'
  )
  check(
    canonicalJson(sourceOutputs) === canonicalJson(outputs),
    'held_output_source_outputs_mismatch'
  )
  check(sourceEvidence.runtime?.release_mode === 'staging', 'held_output_source_runtime_mode_invalid')
  check(/^[0-9a-f-]{36}$/.test(String(sourceEvidence.runtime?.project_id || '')), 'held_output_source_project_id_invalid')
  check(/^[0-9a-f-]{36}$/.test(String(sourceEvidence.runtime?.environment_id || '')), 'held_output_source_environment_id_invalid')
  check(/^[0-9a-f-]{36}$/.test(String(sourceEvidence.runtime?.service_id || '')), 'held_output_source_service_id_invalid')
  check(sourceEvidence.runtime?.persistence_root === '/data', 'held_output_source_persistence_root_invalid')
  check(sourceEvidence.runtime?.pause_all === true, 'held_output_source_pause_all_not_true')
  check(sourceEvidence.runtime?.pause_non_test === true, 'held_output_source_pause_non_test_not_true')
  check(sourceEvidence.runtime?.real_e2e_armed === false, 'held_output_source_real_e2e_not_false')
  check(sourceEvidence.isolation?.production_environment_mutated === false, 'held_output_source_production_environment_mutated')
  check(sourceEvidence.isolation?.production_service_mutated === false, 'held_output_source_production_service_mutated')
  check(sourceEvidence.isolation?.environment_isolated_from_production === true, 'held_output_source_environment_not_isolated')
  check(sourceEvidence.isolation?.service_isolated_from_production === true, 'held_output_source_service_not_isolated')

  check(value.no_send_proof_sha256 === sha256(canonicalJson(noSendProof)), 'held_output_no_send_proof_hash_mismatch')
  check(canonicalJson(noSendProof) === canonicalJson(sourceEvidence.no_send_proof || {}), 'held_output_no_send_proof_source_mismatch')
  check(noSendProof.transport_path_invoked === false, 'held_output_transport_path_invoked_not_false')
  check(noSendProof.outbox_enqueued === false, 'held_output_no_send_outbox_not_false')
  check(noSendProof.delivery_attempted === false, 'held_output_delivery_attempted_not_false')
  check(noSendProof.manychat_sendcontent_called === false, 'held_output_no_send_manychat_call_not_false')
  check(noSendProof.visible_instagram_delivery === false, 'held_output_visible_delivery_not_false')
  check(noSendProof.terminal_state === 'held_before_transport', 'held_output_terminal_state_invalid')

  check(stagingEvidence.environment_id === sourceEvidence.runtime?.environment_id, 'held_output_staging_environment_mismatch')
  check(stagingEvidence.service_id === sourceEvidence.runtime?.service_id, 'held_output_staging_service_mismatch')
  check(/^[0-9a-f-]{36}$/.test(String(stagingEvidence.deployment_id || '')), 'held_output_staging_deployment_id_invalid')
  check(/^sha256:[a-f0-9]{64}$/.test(String(stagingEvidence.image_digest || '')), 'held_output_staging_image_digest_invalid')
  check(/^[a-f0-9]{64}$/.test(String(stagingEvidence.validation_receipt_sha256 || '')), 'held_output_staging_receipt_hash_invalid')
  check(stagingEvidence.before?.deployment_id === stagingEvidence.deployment_id, 'held_output_staging_before_deployment_mismatch')
  check(stagingEvidence.after?.deployment_id === stagingEvidence.deployment_id, 'held_output_staging_after_deployment_mismatch')
  check(stagingEvidence.before?.status === 'SUCCESS', 'held_output_staging_before_status_invalid')
  check(stagingEvidence.after?.status === 'SUCCESS', 'held_output_staging_after_status_invalid')
  check(stagingEvidence.before?.image_digest === stagingEvidence.image_digest, 'held_output_staging_before_image_mismatch')
  check(stagingEvidence.after?.image_digest === stagingEvidence.image_digest, 'held_output_staging_after_image_mismatch')
  check(/^[a-f0-9]{64}$/.test(String(stagingEvidence.before?.deployment_list_sha256 || '')), 'held_output_staging_before_list_hash_invalid')
  check(/^[a-f0-9]{64}$/.test(String(stagingEvidence.after?.deployment_list_sha256 || '')), 'held_output_staging_after_list_hash_invalid')
  check(/^[a-f0-9]{64}$/.test(String(stagingEvidence.remote_evidence_sha256 || '')), 'held_output_remote_evidence_hash_invalid')
  if (options.releaseId !== undefined) {
    check(String(value.release_id || '') === String(options.releaseId || ''), 'held_output_release_id_mismatch')
  }
  if (options.contentFingerprintSha256 !== undefined) {
    check(
      String(value.content_fingerprint_sha256 || '') === String(options.contentFingerprintSha256 || ''),
      'held_output_fingerprint_mismatch'
    )
  }
  if (options.activePromptSha256 !== undefined) {
    check(
      String(value.active_prompt_sha256 || '') === String(options.activePromptSha256 || ''),
      'held_output_prompt_hash_mismatch'
    )
  }
  if (options.releaseManifestSha256 !== undefined) {
    check(
      String(value.release_manifest_sha256 || '') === String(options.releaseManifestSha256 || ''),
      'held_output_release_manifest_hash_mismatch'
    )
  }
  return {
    valid: failures.length === 0,
    schema: String(value.schema || ''),
    source_kind: String(value.source_kind || ''),
    case_count: outputs.length,
    message_count: messages.length,
    minimum_case_count: minimumCases,
    maximum_visible_messages_per_case: MAXIMUM_VISIBLE_MESSAGES_PER_CASE,
    failures
  }
}

function candidatePathFromArgv(argv) {
  const index = argv.indexOf('--candidate')
  if (index < 0) return ''
  if (!argv[index + 1]) throw new Error('candidate_path_missing')
  return path.resolve(argv[index + 1])
}

if (require.main === module) {
  try {
    const argv = process.argv.slice(2)
    const candidatePath = candidatePathFromArgv(argv)
    const verifyFloorFixture = argv.includes('--verify-floor-fixture')
    const candidate = candidatePath
      ? JSON.parse(fs.readFileSync(candidatePath, 'utf8'))
      : undefined
    const options = verifyFloorFixture
      ? { verifyFloorFixture: true }
      : (candidatePath ? { candidate } : {})
    const receipt = runAprilToneRegression(options)
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
    if (!receipt.ok) process.exit(1)
  } catch (error) {
    process.stderr.write(`${String(error?.stack || error)}\n`)
    process.exit(1)
  }
}

module.exports = {
  APRIL_TONE_FLOOR_PATH,
  ACTIVE_PROMPT_PATH,
  APRIL_TONE_REGRESSION_VERSION,
  APRIL_TONE_HELD_OUTPUT_SCHEMA,
  APRIL_TONE_STAGING_EVIDENCE_SCHEMA,
  APRIL_TONE_CAPTURE_VERSION,
  APRIL_TONE_PRODUCER_VERSION,
  APRIL_TONE_CASE_SOURCE_KIND,
  MINIMUM_HELD_OUTPUT_CASES,
  MAXIMUM_HELD_OUTPUT_CASES,
  MAXIMUM_VISIBLE_MESSAGES_PER_CASE,
  heldEvidencePayloadSha256,
  heldCandidatePayloadSha256,
  readAprilToneFloor,
  normalizeMessage,
  visibleMessagesFromEntry,
  evaluateToneCorpus,
  verifyActivePromptToneAnchors,
  verifyHeldOutputCandidate,
  runAprilToneRegression
}
