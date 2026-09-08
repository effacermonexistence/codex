#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  canonicalJson
} = require('./scv-policy-contracts.js')

const SCV_REAL_E2E_RECEIPT_VERSION =
  'scv-real-instagram-e2e-receipt-2026-07-26-v2-exclusive-owner'
const SCV_REAL_E2E_RECEIPT_SCHEMA_PATH =
  path.join(__dirname, 'SCV_REAL_E2E_RECEIPT_SCHEMA.json')
const SCV_REAL_E2E_USERNAME = 'omar.system'
const SCV_REAL_E2E_CONTACT_ID = '1537753982'
const SCV_REAL_E2E_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SCV_REAL_E2E_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const SCV_REAL_E2E_ROUTE = 'instagram_dm_to_manychat_to_scv'
const SCV_REAL_E2E_OUTBOUND_ADAPTER = 'manychat_sendContent'
const SCV_REAL_E2E_OUTBOUND_ENDPOINT =
  'https://api.manychat.com/fb/sending/sendContent'

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hashFile(file) {
  return sha256(fs.readFileSync(file))
}

function readRealE2ESchema(file = SCV_REAL_E2E_RECEIPT_SCHEMA_PATH) {
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'))
  const calculated = sha256(canonicalJson(schema))
  if (schema.schema_version !== SCV_REAL_E2E_RECEIPT_VERSION) {
    throw new Error('scv_real_e2e_schema_version_mismatch')
  }
  if (calculated !== String(schema.declared_sha256 || '')) {
    throw new Error(
      `scv_real_e2e_schema_hash_mismatch:${schema.declared_sha256 || ''}:${calculated}`
    )
  }
  return Object.freeze({ ...schema, calculated_sha256: calculated })
}

const SCV_REAL_E2E_RECEIPT_SCHEMA = readRealE2ESchema()
const SCV_REAL_E2E_RECEIPT_SCHEMA_SHA256 =
  SCV_REAL_E2E_RECEIPT_SCHEMA.calculated_sha256

function timestamp(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : NaN
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ''))
}

function safeEvidencePath(root, relative) {
  const raw = String(relative || '')
  if (!raw || path.isAbsolute(raw) || raw.split(/[\\/]+/).includes('..')) return ''
  const base = path.resolve(root)
  const resolved = path.resolve(base, raw)
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return ''
  return resolved
}

function validateRealE2EReceipt(receipt = {}, options = {}) {
  const failures = []
  const check = (condition, reason) => {
    if (!condition) failures.push(reason)
  }
  const manifest = options.manifest || {}
  const evidenceRoot = path.resolve(options.evidenceRoot || process.cwd())
  const nowMs = Number.isFinite(Number(options.nowMs))
    ? Number(options.nowMs)
    : Date.now()

  check(receipt && typeof receipt === 'object' && !Array.isArray(receipt), 'receipt_object')
  check(receipt.schema === SCV_REAL_E2E_RECEIPT_VERSION, 'receipt_schema')
  check(receipt.ok === true, 'receipt_not_ok')
  check(receipt.secrets_included === false, 'receipt_must_exclude_secrets')
  check(receipt.production_mutation === false, 'receipt_touched_production')
  check(receipt.test_window_hours === 24, 'receipt_test_window_not_24h')
  check(
    receipt.release_id === manifest.release_id,
    'receipt_release_id_mismatch'
  )
  check(
    receipt.content_fingerprint_sha256 === manifest.content_fingerprint_sha256,
    'receipt_fingerprint_mismatch'
  )
  check(
    receipt.release_manifest_sha256 === manifest.release_manifest_sha256,
    'receipt_manifest_hash_mismatch'
  )

  const started = timestamp(receipt.started_at_utc)
  const completed = timestamp(receipt.completed_at_utc)
  check(Number.isFinite(started), 'receipt_started_at_invalid')
  check(Number.isFinite(completed), 'receipt_completed_at_invalid')
  if (Number.isFinite(started) && Number.isFinite(completed)) {
    check(completed >= started, 'receipt_time_order_invalid')
    check(completed - started <= SCV_REAL_E2E_MAX_AGE_MS, 'receipt_run_exceeded_24h')
    check(nowMs - completed <= SCV_REAL_E2E_MAX_AGE_MS, 'receipt_older_than_24h')
    check(completed - nowMs <= SCV_REAL_E2E_MAX_CLOCK_SKEW_MS, 'receipt_from_future')
  }

  const staging = receipt.staging || {}
  const productionIdentity = manifest.deployment?.railway_identity || {}
  check(/^[0-9a-f-]{36}$/.test(String(staging.environment_id || '')), 'staging_environment_id')
  check(/^[0-9a-f-]{36}$/.test(String(staging.service_id || '')), 'staging_service_id')
  check(/^[0-9a-f-]{36}$/.test(String(staging.deployment_id || '')), 'staging_deployment_id')
  check(
    /^sha256:[a-f0-9]{64}$/.test(String(staging.image_digest || '')),
    'staging_image_digest'
  )
  check(
    String(staging.environment_id || '') !==
      String(productionIdentity.RAILWAY_ENVIRONMENT_ID || ''),
    'staging_environment_equals_production'
  )
  check(
    String(staging.service_id || '') !==
      String(productionIdentity.RAILWAY_SERVICE_ID || ''),
    'staging_service_equals_production'
  )

  const isolation = receipt.isolation || {}
  check(isolation.pause_all === false, 'e2e_pause_all_must_be_false')
  check(isolation.pause_non_test === true, 'e2e_pause_non_test_must_be_true')
  check(isolation.other_accounts_blocked === true, 'e2e_other_accounts_not_blocked')
  check(
    Array.isArray(isolation.allowed_usernames) &&
      isolation.allowed_usernames.length === 1 &&
      String(isolation.allowed_usernames[0] || '').toLowerCase() ===
        SCV_REAL_E2E_USERNAME,
    'e2e_username_allowlist_not_exact'
  )
  check(
    Array.isArray(isolation.allowed_contact_ids) &&
      isolation.allowed_contact_ids.length === 1 &&
      String(isolation.allowed_contact_ids[0] || '') === SCV_REAL_E2E_CONTACT_ID,
    'e2e_contact_allowlist_not_exact'
  )

  const productionExclusion = receipt.production_exclusion || {}
  const exclusionAt = timestamp(productionExclusion.checked_at_utc)
  const exclusionSource = String(productionExclusion.source || '')
  const exclusionViaRailway = exclusionSource === 'railway_variable_list_read_only'
  const exclusionViaHandoff =
    exclusionSource === 'manychat_exact_debug_identity_handoff'
  check(
    exclusionViaRailway || exclusionViaHandoff,
    'e2e_production_exclusion_source'
  )
  check(Number.isFinite(exclusionAt), 'e2e_production_exclusion_time')
  check(
    String(productionExclusion.environment_id || '') ===
      String(productionIdentity.RAILWAY_ENVIRONMENT_ID || ''),
    'e2e_production_exclusion_environment'
  )
  check(
    String(productionExclusion.service_id || '') ===
      String(productionIdentity.RAILWAY_SERVICE_ID || ''),
    'e2e_production_exclusion_service'
  )
  check(
    String(productionExclusion.instagram_username || '').toLowerCase() ===
      SCV_REAL_E2E_USERNAME,
    'e2e_production_exclusion_username'
  )
  check(
    String(productionExclusion.contact_id || '') === SCV_REAL_E2E_CONTACT_ID,
    'e2e_production_exclusion_contact'
  )
  check(
    productionExclusion.can_reply_to_test_account === false,
    'e2e_production_still_owns_test_route'
  )
  check(
    isSha256(productionExclusion.configuration_sha256),
    'e2e_production_exclusion_configuration_hash'
  )
  check(
    isSha256(productionExclusion.evidence_sha256),
    'e2e_production_exclusion_evidence_hash'
  )
  const exclusionEvidence = safeEvidencePath(
    evidenceRoot,
    productionExclusion.evidence_file
  )
  check(Boolean(exclusionEvidence), 'e2e_production_exclusion_evidence_path')
  if (exclusionEvidence) {
    check(
      fs.existsSync(exclusionEvidence) &&
        fs.statSync(exclusionEvidence).isFile(),
      'e2e_production_exclusion_evidence_missing'
    )
    if (
      fs.existsSync(exclusionEvidence) &&
      fs.statSync(exclusionEvidence).isFile()
    ) {
      check(
        hashFile(exclusionEvidence) === productionExclusion.evidence_sha256,
        'e2e_production_exclusion_evidence_hash_mismatch'
      )
      try {
        const evidence = JSON.parse(fs.readFileSync(exclusionEvidence, 'utf8'))
        check(evidence.source === exclusionSource, 'e2e_production_exclusion_evidence_source')
        check(
          evidence.production_mutated === false,
          'e2e_production_exclusion_evidence_mutation'
        )
        check(
          evidence.secrets_included === false,
          'e2e_production_exclusion_evidence_secrets'
        )
        if (exclusionViaRailway) {
          check(
            evidence.can_reply_to_test_account === false,
            'e2e_production_exclusion_evidence_route_owned'
          )
          check(
            String(evidence.environment_id || '') ===
              String(productionExclusion.environment_id || '') &&
              String(evidence.service_id || '') ===
                String(productionExclusion.service_id || ''),
            'e2e_production_exclusion_evidence_identity'
          )
          check(
            evidence.redacted_configuration_sha256 ===
              productionExclusion.configuration_sha256,
            'e2e_production_exclusion_configuration_mismatch'
          )
          check(
            isSha256(evidence.raw_variable_list_sha256),
            'e2e_production_exclusion_raw_snapshot_hash'
          )
        } else {
          check(
            evidence.production_route_for_debug_disabled === true &&
              evidence.routing_scope === 'exact_debug_identity_only' &&
              evidence.operator_observed === true,
            'e2e_manychat_handoff_not_exclusive'
          )
          check(
            evidence.configuration_sha256 ===
              productionExclusion.configuration_sha256,
            'e2e_production_exclusion_configuration_mismatch'
          )
        }
        check(
          String(evidence.instagram_username || '').toLowerCase() ===
            SCV_REAL_E2E_USERNAME &&
            String(evidence.contact_id || '') === SCV_REAL_E2E_CONTACT_ID,
          'e2e_production_exclusion_evidence_target'
        )
      } catch {
        check(false, 'e2e_production_exclusion_evidence_invalid_json')
      }
    }
  }

  const ingress = receipt.ingress || {}
  const ingressAt = timestamp(ingress.source_interaction_at_utc)
  check(ingress.route === SCV_REAL_E2E_ROUTE, 'e2e_ingress_route_not_real_instagram')
  check(
    String(ingress.instagram_username || '').toLowerCase() === SCV_REAL_E2E_USERNAME,
    'e2e_ingress_username'
  )
  check(String(ingress.contact_id || '') === SCV_REAL_E2E_CONTACT_ID, 'e2e_ingress_contact')
  check(Boolean(String(ingress.message_id || '').trim()), 'e2e_ingress_message_id')
  check(Number.isFinite(ingressAt), 'e2e_ingress_time')
  check(ingress.manychat_observed === true, 'e2e_manychat_ingress_not_observed')
  check(ingress.direct_http_canary === false, 'e2e_direct_http_canary_forbidden')
  check(ingress.external_24h_window_open === true, 'e2e_manychat_24h_window_not_proven')

  const decision = receipt.decision || {}
  check(Boolean(String(decision.state_before_sha256 || '').match(/^[a-f0-9]{64}$/)), 'e2e_state_before_hash')
  check(Boolean(String(decision.state_after_sha256 || '').match(/^[a-f0-9]{64}$/)), 'e2e_state_after_hash')
  check(Boolean(String(decision.policy_decision || '').trim()), 'e2e_policy_decision')
  check(Boolean(String(decision.next_action || '').trim()), 'e2e_next_action')
  check(Boolean(String(decision.model_output_sha256 || '').match(/^[a-f0-9]{64}$/)), 'e2e_model_output_hash')
  check(decision.structured_output_valid === true, 'e2e_structured_output_not_valid')
  check(decision.semantic_verifier_valid === true, 'e2e_semantic_verifier_not_valid')
  check(decision.candidate_adopted === true, 'e2e_candidate_not_adopted')

  const outbound = receipt.outbound || {}
  const sentAt = timestamp(outbound.sent_at_utc)
  check(outbound.adapter === SCV_REAL_E2E_OUTBOUND_ADAPTER, 'e2e_outbound_adapter')
  check(outbound.endpoint === SCV_REAL_E2E_OUTBOUND_ENDPOINT, 'e2e_outbound_endpoint')
  check(String(outbound.contact_id || '') === SCV_REAL_E2E_CONTACT_ID, 'e2e_outbound_contact')
  check(outbound.accepted === true, 'e2e_outbound_not_accepted')
  check(
    Number(outbound.http_status) >= 200 && Number(outbound.http_status) < 300,
    'e2e_outbound_http_status'
  )
  check(Number.isFinite(sentAt), 'e2e_outbound_time')
  check(isSha256(outbound.visible_text_sha256), 'e2e_outbound_text_hash')
  check(Boolean(String(outbound.provider_receipt_id || '').trim()), 'e2e_provider_receipt_id')

  const visible = receipt.visible_receipt || {}
  const visibleAt = timestamp(visible.observed_at_utc)
  check(visible.channel === 'instagram_dm', 'e2e_visible_channel')
  check(
    String(visible.instagram_username || '').toLowerCase() === SCV_REAL_E2E_USERNAME,
    'e2e_visible_username'
  )
  check(visible.observed === true, 'e2e_visible_delivery_not_observed')
  check(Number.isFinite(visibleAt), 'e2e_visible_time')
  check(isSha256(visible.visible_text_sha256), 'e2e_visible_text_hash')
  check(
    visible.visible_text_sha256 === outbound.visible_text_sha256,
    'e2e_visible_outbound_text_mismatch'
  )
  check(isSha256(visible.screenshot_sha256), 'e2e_screenshot_hash')
  const screenshot = safeEvidencePath(evidenceRoot, visible.screenshot_file)
  check(Boolean(screenshot), 'e2e_screenshot_path')
  if (screenshot) {
    check(fs.existsSync(screenshot) && fs.statSync(screenshot).isFile(), 'e2e_screenshot_missing')
    if (fs.existsSync(screenshot) && fs.statSync(screenshot).isFile()) {
      check(hashFile(screenshot) === visible.screenshot_sha256, 'e2e_screenshot_hash_mismatch')
    }
  }

  if (Number.isFinite(ingressAt) && Number.isFinite(sentAt)) {
    check(sentAt >= ingressAt, 'e2e_outbound_precedes_ingress')
  }
  if (Number.isFinite(sentAt) && Number.isFinite(visibleAt)) {
    check(visibleAt >= sentAt, 'e2e_visible_precedes_outbound')
  }
  if (Number.isFinite(started) && Number.isFinite(ingressAt)) {
    check(ingressAt >= started, 'e2e_ingress_precedes_run')
  }
  if (Number.isFinite(started) && Number.isFinite(exclusionAt)) {
    check(exclusionAt >= started, 'e2e_production_exclusion_precedes_run')
  }
  if (Number.isFinite(exclusionAt) && Number.isFinite(ingressAt)) {
    check(exclusionAt <= ingressAt, 'e2e_production_exclusion_after_ingress')
  }
  if (Number.isFinite(completed) && Number.isFinite(visibleAt)) {
    check(visibleAt <= completed, 'e2e_visible_after_completion')
  }

  return {
    valid: failures.length === 0,
    failures,
    schema_version: SCV_REAL_E2E_RECEIPT_VERSION,
    schema_sha256: SCV_REAL_E2E_RECEIPT_SCHEMA_SHA256,
    username: SCV_REAL_E2E_USERNAME,
    contact_id: SCV_REAL_E2E_CONTACT_ID,
    max_age_hours: 24
  }
}

function assertRealE2EReceipt(receipt = {}, options = {}) {
  const verdict = validateRealE2EReceipt(receipt, options)
  if (!verdict.valid) {
    throw new Error(`scv_real_e2e_receipt_rejected:${verdict.failures.join(',')}`)
  }
  return verdict
}

module.exports = {
  SCV_REAL_E2E_RECEIPT_VERSION,
  SCV_REAL_E2E_RECEIPT_SCHEMA_PATH,
  SCV_REAL_E2E_RECEIPT_SCHEMA,
  SCV_REAL_E2E_RECEIPT_SCHEMA_SHA256,
  SCV_REAL_E2E_USERNAME,
  SCV_REAL_E2E_CONTACT_ID,
  SCV_REAL_E2E_MAX_AGE_MS,
  SCV_REAL_E2E_ROUTE,
  SCV_REAL_E2E_OUTBOUND_ADAPTER,
  SCV_REAL_E2E_OUTBOUND_ENDPOINT,
  sha256,
  hashFile,
  readRealE2ESchema,
  safeEvidencePath,
  validateRealE2EReceipt,
  assertRealE2EReceipt
}
