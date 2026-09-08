#!/usr/bin/env node
const { DEBUG_USERNAMES_CSV, DEBUG_CONTACT_IDS_CSV } = require('./scv-debug-identity.js')
const {
  SCV_PREFLIGHT_PROOF_SCHEMA,
  verifyCloudRuntimeSafety
} = require('./scv-cloud-runtime-safety.js')

function encodedProductionProof(manifest, overrides = {}) {
  return Buffer.from(JSON.stringify({
    schema: SCV_PREFLIGHT_PROOF_SCHEMA,
    created_at_utc: '2026-08-19T00:00:00.000Z',
    mode: 'production',
    release_id: manifest.release_id,
    content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    release_manifest_sha256: manifest.release_manifest_sha256,
    gates: {
      release_verified: true,
      immutable_firewall_verified: true,
      environment_values_verified: true,
      railway_identity_verified: true,
      persistent_storage_verified: true,
      staging_isolation_verified: false,
      node_runtime_verified: true,
      production_approval_verified: true,
      recovery_transition_verified: true
    },
    ...overrides
  }), 'utf8').toString('base64url')
}

function runHarness() {
  let checked = 0
  const ok = (condition, label) => {
    checked += 1
    if (!condition) throw new Error(label)
  }
  const identity = {
    RAILWAY_PROJECT_ID: 'project-id',
    RAILWAY_ENVIRONMENT_ID: 'production-environment-id',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    RAILWAY_SERVICE_ID: 'production-service-id',
    RAILWAY_SERVICE_NAME: 'scv-dm'
  }
  const manifest = {
    release_id: 'scv-cloud-runtime-safety-test-release',
    content_fingerprint_sha256: 'a'.repeat(64),
    release_manifest_sha256: 'b'.repeat(64),
    deployment: { railway_identity: identity }
  }
  const production = {
    ...identity,
    SCV_RELEASE_MODE: 'production',
    SCV_RELEASE_PHASE: 'active',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: '1',
    SCV_DEBUG_ACCOUNT_USERNAMES: DEBUG_USERNAMES_CSV,
    SCV_DEBUG_ACCOUNT_CONTACT_IDS: DEBUG_CONTACT_IDS_CSV,
    SCV_PURGE_TEST_USERNAMES: DEBUG_USERNAMES_CSV,
    SCV_PURGE_TEST_CONTACT_IDS: DEBUG_CONTACT_IDS_CSV,
    SCV_PURGE_TEST_ACCOUNT_ON_STARTUP: '0',
    SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE: '1',
    SCV_HOLD_STALE_BACKLOG_MS: String(15 * 60 * 1000),
    SCV_RECOVERY_CUTOVER_AT: '2026-08-19T00:00:00.000Z',
    SCV_AUTO_RECOVERY_ENABLED: '0',
    SCV_AUTO_RECOVERY_MAX_ENQUEUES_PER_TICK: '1',
    SCV_MANYCHAT_INPUT_SWEEP: '0',
    SCV_INBOUND_AUTH_REQUIRED: '1',
    SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1',
    SCV_MANYCHAT_INGRESS_SECRET: 'i'.repeat(32),
    SCV_ADMIN_AUTH_REQUIRED: '1',
    SCV_ADMIN_SHARED_SECRET: 'a'.repeat(32),
    SCV_LEGACY_INTERNAL_QUEUE_HTTP: '0',
    SCV_INTERNAL_BIND_HOST: '127.0.0.1',
    SCV_OUTBOUND1_PORT: '3101',
    SCV_OUTBOUND2_PORT: '3102',
    SCV_OUTBOUND1_URL: 'http://127.0.0.1:3101/',
    SCV_OUTBOUND2_URL: 'http://127.0.0.1:3102/',
    SCV_IMMUTABLE_GOLDEN_RELEASE: '1',
    SCV_PREFLIGHT_PROOF_B64: encodedProductionProof(manifest)
  }
  ok(verifyCloudRuntimeSafety({ env: production, manifest }).ok, 'safe_production_accepted')
  const arbitraryVisionHost = verifyCloudRuntimeSafety({
    env: { ...production, SCV_VISION_ALLOW_ANY_HOST: '1' },
    manifest
  })
  ok(
    !arbitraryVisionHost.ok &&
      arbitraryVisionHost.failures.includes('cloud_vision_arbitrary_host_override_forbidden'),
    'cloud_arbitrary_vision_host_override_rejected'
  )
  const directCloudStart = { ...production }
  delete directCloudStart.SCV_IMMUTABLE_GOLDEN_RELEASE
  delete directCloudStart.SCV_PREFLIGHT_PROOF_B64
  const directBypassVerdict = verifyCloudRuntimeSafety({ env: directCloudStart, manifest })
  ok(
    !directBypassVerdict.ok &&
      directBypassVerdict.failures.includes('cloud_immutable_golden_release_required') &&
      directBypassVerdict.failures.includes('cloud_preflight_schema_mismatch'),
    'direct_cloud_start_without_entry_preflight_rejected'
  )
  ok(!verifyCloudRuntimeSafety({
    env: { ...directCloudStart, SCV_IMMUTABLE_GOLDEN_RELEASE: '1' },
    manifest
  }).ok, 'immutable_marker_without_preflight_proof_rejected')
  ok(!verifyCloudRuntimeSafety({
    env: {
      ...production,
      SCV_PREFLIGHT_PROOF_B64: encodedProductionProof(manifest, {
        content_fingerprint_sha256: 'c'.repeat(64)
      })
    },
    manifest
  }).ok, 'preflight_proof_for_other_artifact_rejected')
  const missingApprovalProof = JSON.parse(Buffer.from(production.SCV_PREFLIGHT_PROOF_B64, 'base64url').toString('utf8'))
  missingApprovalProof.gates.production_approval_verified = false
  ok(!verifyCloudRuntimeSafety({
    env: {
      ...production,
      SCV_PREFLIGHT_PROOF_B64: Buffer.from(JSON.stringify(missingApprovalProof), 'utf8').toString('base64url')
    },
    manifest
  }).ok, 'preflight_proof_missing_required_gate_rejected')
  ok(!verifyCloudRuntimeSafety({ env: { ...production, SCV_PAUSE_NON_TEST: '1' }, manifest }).ok, 'real_account_pause_rejected')
  ok(!verifyCloudRuntimeSafety({ env: { ...production, SCV_PAUSE_DEBUG_ACCOUNTS: '0' }, manifest }).ok, 'debug_flow_in_production_rejected')
  ok(!verifyCloudRuntimeSafety({ env: { ...production, SCV_MANYCHAT_INGRESS_SECRET: '' }, manifest }).ok, 'missing_ingress_secret_rejected')
  ok(!verifyCloudRuntimeSafety({ env: { ...production, SCV_RECOVERY_CUTOVER_AT: '' }, manifest }).ok, 'missing_cutover_rejected')
  for (const [name, value, failure] of [
    ['SCV_INTERNAL_BIND_HOST', '0.0.0.0', 'cloud_internal_bind_host_must_be_loopback'],
    ['SCV_OUTBOUND1_URL', 'http://0.0.0.0:3101/', 'cloud_outbound1_url_must_be_exact_loopback'],
    ['SCV_OUTBOUND2_URL', 'http://localhost:3102/', 'cloud_outbound2_url_must_be_exact_loopback']
  ]) {
    const verdict = verifyCloudRuntimeSafety({ env: { ...production, [name]: value }, manifest })
    ok(!verdict.ok && verdict.failures.includes(failure), `${name}_non_exact_loopback_rejected`)
  }
  ok(!verifyCloudRuntimeSafety({
    env: { ...production, SCV_RECOVERY_CUTOVER_AT: '2099-01-01T00:00:00.000Z' },
    manifest
  }).ok, 'future_cutover_rejected')
  const mislabeledProduction = verifyCloudRuntimeSafety({
    env: {
      ...production,
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      SCV_RELEASE_MODE: 'staging'
    },
    manifest
  })
  ok(mislabeledProduction.ok && mislabeledProduction.mode === 'production', 'production_identity_cannot_downgrade_to_staging')
  ok(!verifyCloudRuntimeSafety({ env: { SCV_CLOUD_RUNTIME: '1' }, manifest }).ok, 'unknown_cloud_mode_fails_closed')
  ok(verifyCloudRuntimeSafety({ env: {}, manifest }).ok, 'local_runtime_unaffected')

  // Production must keep the real-customer business lane open. Test isolation
  // belongs in staging and cannot be reported ready in production.
  const { verifySingleReleaseOperationalSafety } = require('./scv-cloud-runtime-safety.js')
  const singleProdEnv = (pause) => ({
    SCV_RELEASE_PHASE: 'active',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_PAUSE_NON_TEST: pause,
    SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE: '1',
    OPENAI_API_KEY: 'test',
    MANYCHAT_API_KEY: 'test',
    GMAIL_IMAP_USER: 'test',
    GMAIL_IMAP_APP_PASSWORD: 'test'
  })
  const lockdownLabel = 'single_release_production_non_test_pause_must_be_zero'
  const businessLane = verifySingleReleaseOperationalSafety('production', singleProdEnv('0'))
  const testLockdown = verifySingleReleaseOperationalSafety('production', singleProdEnv('1'))
  const invalidPause = verifySingleReleaseOperationalSafety('production', singleProdEnv('2'))
  ok(!businessLane.includes(lockdownLabel),
    'production_business_lane_pause_zero_accepted')
  ok(testLockdown.includes(lockdownLabel),
    'production_owner_test_lockdown_pause_one_rejected')
  ok(invalidPause.includes(lockdownLabel), 'production_garbage_pause_value_fails_closed')

  // The readiness layer mirrors the safety contract and cannot call a silent
  // real-customer lane healthy merely because the debug allowlist still flows.
  const inboundSource = require('fs').readFileSync(require('path').join(__dirname, 'inbound-scv.js'), 'utf8')
  ok(inboundSource.includes('pauseEnabled(process.env) === false'),
    'readiness_hard_requires_business_lane')
  ok(inboundSource.includes("'non_test_accounts_paused'"),
    'readiness_reports_closed_business_lane')
  ok(!inboundSource.includes('owner_lockdown_allowlist_missing'),
    'readiness_has_no_owner_lockdown_escape')

  return { ok: true, lock_version: 'scv-cloud-runtime-safety-harness-2026-09-01-v6-production-business-lane', checked }
}

if (require.main === module) {
  try { console.log(JSON.stringify(runHarness(), null, 2)) }
  catch (error) { console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2)); process.exit(1) }
}

module.exports = { runHarness }
