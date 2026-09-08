#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  sha256,
  validateRealE2EReceipt,
  SCV_REAL_E2E_RECEIPT_VERSION,
  SCV_REAL_E2E_RECEIPT_SCHEMA_SHA256,
  SCV_REAL_E2E_ROUTE,
  SCV_REAL_E2E_OUTBOUND_ADAPTER,
  SCV_REAL_E2E_OUTBOUND_ENDPOINT
} = require('./scv-real-e2e-receipt.js')

const REAL_E2E_RECEIPT_HARNESS_VERSION =
  'scv-real-e2e-receipt-harness-2026-07-26-v2-exclusive-owner-required'

function buildValidFixture(root) {
  const screenshotFile = 'evidence/omar-system-visible-dm.png'
  const screenshotPath = path.join(root, screenshotFile)
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
  fs.writeFileSync(screenshotPath, Buffer.from('fixture-not-a-real-production-receipt'))
  const exclusionFile = 'evidence/production-test-route.json'
  const exclusionPath = path.join(root, exclusionFile)
  const configurationSha256 = 'c'.repeat(64)
  const exclusionEvidence = {
    schema: 'scv-production-test-route-evidence-2026-07-26-v1',
    checked_at_utc: '2026-07-26T01:00:00.500Z',
    source: 'railway_variable_list_read_only',
    environment_id: '11111111-1111-4111-8111-111111111111',
    service_id: '22222222-2222-4222-8222-222222222222',
    instagram_username: 'omar.system',
    contact_id: '1537753982',
    can_reply_to_test_account: false,
    reason: 'production_non_test_pause_excludes_target',
    redacted_configuration_sha256: configurationSha256,
    raw_variable_list_sha256: 'd'.repeat(64),
    production_mutated: false,
    secrets_included: false
  }
  fs.writeFileSync(
    exclusionPath,
    `${JSON.stringify(exclusionEvidence, null, 2)}\n`
  )
  const visibleTextSha256 = sha256('fixture visible reply')
  return {
    manifest: {
      release_id: 'scv-instagram-golden-production-harness',
      content_fingerprint_sha256: '1'.repeat(64),
      release_manifest_sha256: '2'.repeat(64),
      deployment: {
        railway_identity: {
          RAILWAY_ENVIRONMENT_ID: '11111111-1111-4111-8111-111111111111',
          RAILWAY_SERVICE_ID: '22222222-2222-4222-8222-222222222222'
        }
      }
    },
    receipt: {
      schema: SCV_REAL_E2E_RECEIPT_VERSION,
      ok: true,
      release_id: 'scv-instagram-golden-production-harness',
      content_fingerprint_sha256: '1'.repeat(64),
      release_manifest_sha256: '2'.repeat(64),
      started_at_utc: '2026-07-26T01:00:00.000Z',
      completed_at_utc: '2026-07-26T01:00:05.000Z',
      test_window_hours: 24,
      staging: {
        environment_id: '33333333-3333-4333-8333-333333333333',
        service_id: '44444444-4444-4444-8444-444444444444',
        deployment_id: '55555555-5555-4555-8555-555555555555',
        image_digest: `sha256:${'6'.repeat(64)}`
      },
      isolation: {
        pause_all: false,
        pause_non_test: true,
        other_accounts_blocked: true,
        allowed_usernames: ['omar.system'],
        allowed_contact_ids: ['1537753982']
      },
      production_exclusion: {
        source: 'railway_variable_list_read_only',
        checked_at_utc: '2026-07-26T01:00:00.500Z',
        environment_id: '11111111-1111-4111-8111-111111111111',
        service_id: '22222222-2222-4222-8222-222222222222',
        instagram_username: 'omar.system',
        contact_id: '1537753982',
        can_reply_to_test_account: false,
        configuration_sha256: configurationSha256,
        evidence_file: exclusionFile,
        evidence_sha256: sha256(fs.readFileSync(exclusionPath))
      },
      ingress: {
        route: SCV_REAL_E2E_ROUTE,
        instagram_username: 'omar.system',
        contact_id: '1537753982',
        message_id: 'manychat-inbound-fixture-1',
        source_interaction_at_utc: '2026-07-26T01:00:01.000Z',
        manychat_observed: true,
        direct_http_canary: false,
        external_24h_window_open: true
      },
      decision: {
        state_before_sha256: '7'.repeat(64),
        state_after_sha256: '8'.repeat(64),
        policy_decision: 'social_continue',
        next_action: 'social_continue',
        model_output_sha256: '9'.repeat(64),
        structured_output_valid: true,
        semantic_verifier_valid: true,
        candidate_adopted: true
      },
      outbound: {
        adapter: SCV_REAL_E2E_OUTBOUND_ADAPTER,
        endpoint: SCV_REAL_E2E_OUTBOUND_ENDPOINT,
        contact_id: '1537753982',
        accepted: true,
        http_status: 200,
        sent_at_utc: '2026-07-26T01:00:03.000Z',
        visible_text_sha256: visibleTextSha256,
        provider_receipt_id: 'manychat-sendcontent-fixture-1'
      },
      visible_receipt: {
        channel: 'instagram_dm',
        instagram_username: 'omar.system',
        observed: true,
        observed_at_utc: '2026-07-26T01:00:04.000Z',
        visible_text_sha256: visibleTextSha256,
        screenshot_file: screenshotFile,
        screenshot_sha256: sha256(fs.readFileSync(screenshotPath))
      },
      production_mutation: false,
      secrets_included: false
    }
  }
}

function mutate(value, callback) {
  const copy = JSON.parse(JSON.stringify(value))
  callback(copy)
  return copy
}

function runRealE2EReceiptHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-real-e2e-receipt-'))
  const checks = []
  const check = (name, condition, detail = '') => {
    checks.push({ name, pass: Boolean(condition), detail: String(detail || '') })
  }
  try {
    const { manifest, receipt } = buildValidFixture(root)
    const options = {
      manifest,
      evidenceRoot: root,
      nowMs: Date.parse('2026-07-26T01:00:06.000Z')
    }
    const valid = validateRealE2EReceipt(receipt, options)
    check('valid_real_route_receipt_passes', valid.valid, valid.failures.join(','))
    check(
      'schema_hash_is_bound',
      /^[a-f0-9]{64}$/.test(SCV_REAL_E2E_RECEIPT_SCHEMA_SHA256),
      SCV_REAL_E2E_RECEIPT_SCHEMA_SHA256
    )

    const directCanary = validateRealE2EReceipt(
      mutate(receipt, (copy) => {
        copy.ingress.route = 'direct_http_canary'
        copy.ingress.direct_http_canary = true
      }),
      options
    )
    check(
      'direct_http_canary_cannot_impersonate_real_e2e',
      !directCanary.valid &&
        directCanary.failures.includes('e2e_ingress_route_not_real_instagram') &&
        directCanary.failures.includes('e2e_direct_http_canary_forbidden'),
      directCanary.failures.join(',')
    )

    const paused = validateRealE2EReceipt(
      mutate(receipt, (copy) => { copy.isolation.pause_all = true }),
      options
    )
    check(
      'paused_service_cannot_claim_send_e2e',
      !paused.valid && paused.failures.includes('e2e_pause_all_must_be_false'),
      paused.failures.join(',')
    )

    const broadAllowlist = validateRealE2EReceipt(
      mutate(receipt, (copy) => { copy.isolation.allowed_usernames.push('someone.else') }),
      options
    )
    check(
      'non_test_account_exposure_is_rejected',
      !broadAllowlist.valid &&
        broadAllowlist.failures.includes('e2e_username_allowlist_not_exact'),
      broadAllowlist.failures.join(',')
    )

    const productionStillOwns = validateRealE2EReceipt(
      mutate(receipt, (copy) => {
        copy.production_exclusion.can_reply_to_test_account = true
      }),
      options
    )
    check(
      'production_and_staging_cannot_both_own_test_route',
      !productionStillOwns.valid &&
        productionStillOwns.failures.includes(
          'e2e_production_still_owns_test_route'
        ),
      productionStillOwns.failures.join(',')
    )

    const missingExclusionEvidence = validateRealE2EReceipt(
      mutate(receipt, (copy) => {
        copy.production_exclusion.evidence_file =
          'evidence/missing-production-route.json'
      }),
      options
    )
    check(
      'production_exclusion_requires_hashed_tool_evidence',
      !missingExclusionEvidence.valid &&
        missingExclusionEvidence.failures.includes(
          'e2e_production_exclusion_evidence_missing'
        ),
      missingExclusionEvidence.failures.join(',')
    )

    const productionService = validateRealE2EReceipt(
      mutate(receipt, (copy) => {
        copy.staging.service_id =
          manifest.deployment.railway_identity.RAILWAY_SERVICE_ID
      }),
      options
    )
    check(
      'production_service_cannot_be_used_as_staging_proof',
      !productionService.valid &&
        productionService.failures.includes('staging_service_equals_production'),
      productionService.failures.join(',')
    )

    const noManyChat = validateRealE2EReceipt(
      mutate(receipt, (copy) => { copy.ingress.manychat_observed = false }),
      options
    )
    check(
      'manychat_ingress_is_mandatory',
      !noManyChat.valid &&
        noManyChat.failures.includes('e2e_manychat_ingress_not_observed'),
      noManyChat.failures.join(',')
    )

    const wrongAdapter = validateRealE2EReceipt(
      mutate(receipt, (copy) => { copy.outbound.adapter = 'fake_sender' }),
      options
    )
    check(
      'sendcontent_adapter_is_mandatory',
      !wrongAdapter.valid && wrongAdapter.failures.includes('e2e_outbound_adapter'),
      wrongAdapter.failures.join(',')
    )

    const invisible = validateRealE2EReceipt(
      mutate(receipt, (copy) => { copy.visible_receipt.observed = false }),
      options
    )
    check(
      'provider_accepted_without_visible_instagram_receipt_is_rejected',
      !invisible.valid &&
        invisible.failures.includes('e2e_visible_delivery_not_observed'),
      invisible.failures.join(',')
    )

    const textMismatch = validateRealE2EReceipt(
      mutate(receipt, (copy) => {
        copy.visible_receipt.visible_text_sha256 = 'a'.repeat(64)
      }),
      options
    )
    check(
      'visible_and_outbound_text_must_match',
      !textMismatch.valid &&
        textMismatch.failures.includes('e2e_visible_outbound_text_mismatch'),
      textMismatch.failures.join(',')
    )

    const screenshotMismatch = validateRealE2EReceipt(
      mutate(receipt, (copy) => {
        copy.visible_receipt.screenshot_sha256 = 'b'.repeat(64)
      }),
      options
    )
    check(
      'visible_screenshot_hash_must_match_evidence',
      !screenshotMismatch.valid &&
        screenshotMismatch.failures.includes('e2e_screenshot_hash_mismatch'),
      screenshotMismatch.failures.join(',')
    )

    const stale = validateRealE2EReceipt(receipt, {
      ...options,
      nowMs: Date.parse('2026-07-28T01:00:06.000Z')
    })
    check(
      'receipt_older_than_24h_is_rejected',
      !stale.valid && stale.failures.includes('receipt_older_than_24h'),
      stale.failures.join(',')
    )

    const secretLeak = validateRealE2EReceipt(
      mutate(receipt, (copy) => { copy.secrets_included = true }),
      options
    )
    check(
      'secret_bearing_receipt_is_rejected',
      !secretLeak.valid &&
        secretLeak.failures.includes('receipt_must_exclude_secrets'),
      secretLeak.failures.join(',')
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }

  const failed = checks.filter((item) => !item.pass)
  return {
    ok: failed.length === 0,
    harness_version: REAL_E2E_RECEIPT_HARNESS_VERSION,
    checked: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks
  }
}

if (require.main === module) {
  const receipt = runRealE2EReceiptHarness()
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  if (!receipt.ok) process.exit(1)
}

module.exports = {
  REAL_E2E_RECEIPT_HARNESS_VERSION,
  buildValidFixture,
  runRealE2EReceiptHarness
}
