#!/usr/bin/env node

const crypto = require('crypto')
const fs = require('fs')
const {
  ACTIVE_PROMPT_PATH,
  APRIL_TONE_HELD_OUTPUT_SCHEMA,
  readAprilToneFloor,
  runAprilToneRegression,
  verifyHeldOutputCandidate
} = require('./scv-april-tone-regression.js')

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function runScvAprilToneReleaseHarness() {
  const checks = []
  const check = (name, condition, detail = '') => {
    checks.push({ name, pass: Boolean(condition), detail: String(detail || '') })
  }
  const floor = readAprilToneFloor()

  let missingCandidateError = ''
  try {
    runAprilToneRegression()
  } catch (error) {
    missingCandidateError = String(error?.message || error)
  }
  check('default_mode_fails_closed_without_candidate',
    missingCandidateError === 'scv_april_tone_explicit_candidate_required',
    missingCandidateError)

  const fixtureSelfTest = runAprilToneRegression({ verifyFloorFixture: true })
  check('fixture_self_test_is_explicit_and_valid',
    fixtureSelfTest.ok === true &&
      fixtureSelfTest.evaluation_mode === 'floor_fixture_self_test_only' &&
      fixtureSelfTest.explicit_candidate_supplied === false,
    JSON.stringify(fixtureSelfTest))

  const explicit = runAprilToneRegression({ candidate: floor.source_visible_fixture_corpus })
  check('explicit_candidate_mode_is_distinct',
    explicit.ok === true &&
      explicit.evaluation_mode === 'explicit_candidate_outputs' &&
      explicit.explicit_candidate_supplied === true,
    JSON.stringify(explicit))

  const releaseId = 'scv-held-tone-harness-release'
  const fingerprint = 'a'.repeat(64)
  const heldCandidate = {
    schema: APRIL_TONE_HELD_OUTPUT_SCHEMA,
    source_kind: 'held_isolated_staging_outputs',
    capture_mode: 'isolated_staging_hold_no_send',
    visible_author_kind: 'model_authored',
    production_mutation: false,
    production_delivery: false,
    release_id: releaseId,
    content_fingerprint_sha256: fingerprint,
    active_prompt_sha256: sha256File(ACTIVE_PROMPT_PATH),
    outputs: floor.source_visible_fixture_corpus.map((visibleText, index) => ({
      case_id: `held-case-${index + 1}`,
      held: true,
      delivered: false,
      visible_author_kind: 'model_authored',
      input_sha256: String(index + 1).padStart(64, '0'),
      output_sha256: crypto.createHash('sha256').update(visibleText).digest('hex'),
      visible_messages_sha256: crypto
        .createHash('sha256')
        .update(JSON.stringify([visibleText]))
        .digest('hex'),
      visible_messages: [visibleText],
      visible_text: visibleText
    }))
  }
  const held = verifyHeldOutputCandidate(heldCandidate, {
    releaseId,
    contentFingerprintSha256: fingerprint,
    activePromptSha256: sha256File(ACTIVE_PROMPT_PATH)
  })
  check('floor_fixture_cannot_be_promoted_by_held_metadata_alone',
    held.valid === false &&
      held.failures.some((failure) => failure.startsWith('held_output_matches_floor_fixture:')) &&
      held.failures.includes('held_output_source_evidence_schema_invalid'),
    JSON.stringify(held))

  const fixtureMasqueradingAsHeld = verifyHeldOutputCandidate(
    { messages: floor.source_visible_fixture_corpus },
    {
      releaseId,
      contentFingerprintSha256: fingerprint,
      activePromptSha256: sha256File(ACTIVE_PROMPT_PATH)
    }
  )
  check('plain_fixture_cannot_masquerade_as_held_outputs',
    fixtureMasqueradingAsHeld.valid === false &&
      fixtureMasqueradingAsHeld.failures.includes('held_output_schema_mismatch') &&
      fixtureMasqueradingAsHeld.failures.includes('held_output_source_kind_invalid') &&
      fixtureMasqueradingAsHeld.failures.includes('held_output_production_mutation_not_false'),
    JSON.stringify(fixtureMasqueradingAsHeld))

  const undersized = verifyHeldOutputCandidate(
    { ...heldCandidate, outputs: heldCandidate.outputs.slice(0, 1) },
    {
      releaseId,
      contentFingerprintSha256: fingerprint,
      activePromptSha256: sha256File(ACTIVE_PROMPT_PATH)
    }
  )
  check('undersized_held_corpus_is_rejected',
    undersized.valid === false && undersized.failures.includes('held_output_case_count_too_small'),
    JSON.stringify(undersized))

  const failed = checks.filter((item) => !item.pass)
  return {
    ok: failed.length === 0,
    checked: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks
  }
}

if (require.main === module) {
  const receipt = runScvAprilToneReleaseHarness()
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  if (!receipt.ok) process.exit(1)
}

module.exports = {
  runScvAprilToneReleaseHarness
}
