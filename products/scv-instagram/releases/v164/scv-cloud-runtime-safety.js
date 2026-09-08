#!/usr/bin/env node
const {
  readReleaseManifest,
  releaseMode,
  verifyProductionSafety,
  verifyStagingIsolation
} = require('./scv-golden-release.js')
const {
  isSingleReleaseRequested,
  verifySingleRelease,
  singleReleaseRuntimeIdentityVerdict
} = require('./scv-single-release.js')
const {
  stagingCapabilityBoundary
} = require('./scv-staging-capability-boundary.js')
const {
  modelContractVerdict,
  runtimeBehaviorContractVerdict
} = require('./scv-runtime-behavior-contract.js')

const SCV_PREFLIGHT_PROOF_SCHEMA = 'scv-production-preflight-proof-2026-08-19-v1'

function runtimeMode(env = process.env, manifest = null) {
  if (manifest) return releaseMode(env, manifest)
  const railway = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const release = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  if (railway === 'production' || release === 'production') return 'production'
  if (railway === 'staging' || release === 'staging') return 'staging'
  if (String(env.SCV_CLOUD_RUNTIME || '').trim() === '1') return 'unknown_cloud'
  return 'local'
}

function verifyCommonCloudSafety(env = process.env, now = Date.now()) {
  const failures = []
  if (String(env.SCV_INBOUND_AUTH_REQUIRED || '') !== '1') failures.push('cloud_ingress_auth_required')
  if (String(env.SCV_ADMIN_AUTH_REQUIRED || '') !== '1') failures.push('cloud_admin_auth_required')
  if (String(env.SCV_LEGACY_INTERNAL_QUEUE_HTTP || '') !== '0') failures.push('cloud_legacy_queue_http_must_be_off')
  if (String(env.SCV_VISION_ALLOW_ANY_HOST || '0').trim() !== '0') failures.push('cloud_vision_arbitrary_host_override_forbidden')
  if (String(env.SCV_MANYCHAT_INGRESS_SECRET || '').length < 32) failures.push('cloud_ingress_secret_too_short')
  if (String(env.SCV_ADMIN_SHARED_SECRET || '').length < 32) failures.push('cloud_admin_secret_too_short')
  const recoveryCutover = Date.parse(String(env.SCV_RECOVERY_CUTOVER_AT || ''))
  if (!Number.isFinite(recoveryCutover)) failures.push('cloud_recovery_cutover_required')
  else if (recoveryCutover > now + (5 * 60 * 1000)) failures.push('cloud_recovery_cutover_cannot_be_future')
  if (String(env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE || '') !== '1') failures.push('cloud_stale_backlog_hold_required')
  if (String(env.SCV_INTERNAL_BIND_HOST || '') !== '127.0.0.1') failures.push('cloud_internal_bind_host_must_be_loopback')
  const outboundLoopback = (name, portName) => {
    try {
      const url = new URL(String(env[name] || ''))
      const expectedPort = String(env[portName] || '')
      return url.protocol === 'http:' &&
        url.hostname === '127.0.0.1' &&
        url.pathname === '/' &&
        !url.username && !url.password &&
        (!expectedPort || url.port === expectedPort)
    } catch {
      return false
    }
  }
  if (!outboundLoopback('SCV_OUTBOUND1_URL', 'SCV_OUTBOUND1_PORT')) failures.push('cloud_outbound1_url_must_be_exact_loopback')
  if (!outboundLoopback('SCV_OUTBOUND2_URL', 'SCV_OUTBOUND2_PORT')) failures.push('cloud_outbound2_url_must_be_exact_loopback')
  return failures
}

function verifySingleReleaseOperationalSafety(mode, env = process.env) {
  const failures = [
    ...modelContractVerdict(env).failures,
    ...runtimeBehaviorContractVerdict(env, { mode }).failures
  ]
  const requireValue = (key, value, label) => {
    if (String(env[key] || '') !== value) failures.push(label)
  }
  requireValue('SCV_RELEASE_PHASE', 'active', 'single_release_active_phase_required')
  requireValue('SCV_PAUSE_ALL', '0', 'single_release_pause_all_must_be_zero')
  requireValue('SCV_PAUSE_DEBUG_ACCOUNTS', '0',
    'single_release_omar_route_must_be_active')
  requireValue('SCV_PURGE_TEST_ACCOUNT_ON_STARTUP', '0',
    'single_release_destructive_purge_must_be_off')
  requireValue('SCV_MANYCHAT_INPUT_SWEEP', '0',
    'single_release_manychat_sweep_must_be_off')
  requireValue('SCV_INBOUND_AUTH_REQUIRED', '1',
    'single_release_ingress_auth_required')
  requireValue('SCV_ADMIN_AUTH_REQUIRED', '1',
    'single_release_admin_auth_required')
  requireValue('SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE', '1',
    'single_release_stale_backlog_hold_required')
  if (!String(env.OPENAI_API_KEY || '')) {
    failures.push('single_release_openai_capability_missing')
  }
  if (!String(env.MANYCHAT_API_KEY || '')) {
    failures.push('single_release_manychat_capability_missing')
  }
  if (mode === 'production') {
    requireValue('SCV_PAUSE_NON_TEST', '0',
      'single_release_production_non_test_pause_must_be_zero')
    if (!String(env.GMAIL_IMAP_USER || '') ||
        !String(env.GMAIL_IMAP_APP_PASSWORD || '')) {
      failures.push('single_release_production_gmail_capability_missing')
    }
  } else if (mode === 'staging') {
    requireValue('SCV_PAUSE_NON_TEST', '1',
      'single_release_staging_non_test_pause_required')
    requireValue('SCV_STAGING_CAPABILITY_MODE', 'provider_bound',
      'single_release_staging_provider_bound_required')
    requireValue('SCV_STAGING_GMAIL_MODE', 'withheld',
      'single_release_staging_gmail_must_be_withheld')
    requireValue('SCV_STAGING_REAL_E2E_ARMED', '1',
      'single_release_staging_arm_required')
    if (String(env.GMAIL_IMAP_USER || '') ||
        String(env.GMAIL_IMAP_APP_PASSWORD || '')) {
      failures.push('single_release_staging_gmail_credentials_forbidden')
    }
    const staging = stagingCapabilityBoundary(env)
    if (!staging.ok) failures.push(...staging.failures)
  } else {
    failures.push('single_release_operational_mode_invalid')
  }
  return failures
}

function readPreflightProof(env = process.env) {
  const encoded = String(env.SCV_PREFLIGHT_PROOF_B64 || '').trim()
  if (!encoded || encoded.length > 16 * 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null
  try {
    const proof = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return proof && typeof proof === 'object' && !Array.isArray(proof) ? proof : null
  } catch {
    return null
  }
}

function verifyPreflightProof(manifest, mode, env = process.env) {
  const failures = []
  const proof = readPreflightProof(env)
  const gates = proof?.gates && typeof proof.gates === 'object' ? proof.gates : {}
  const check = (condition, label) => { if (!condition) failures.push(label) }
  check(String(env.SCV_IMMUTABLE_GOLDEN_RELEASE || '') === '1', 'cloud_immutable_golden_release_required')
  check(proof?.schema === SCV_PREFLIGHT_PROOF_SCHEMA, 'cloud_preflight_schema_mismatch')
  check(proof?.mode === mode, 'cloud_preflight_mode_mismatch')
  check(proof?.release_id === String(manifest?.release_id || ''), 'cloud_preflight_release_id_mismatch')
  check(
    proof?.content_fingerprint_sha256 === String(manifest?.content_fingerprint_sha256 || ''),
    'cloud_preflight_content_fingerprint_mismatch'
  )
  check(
    proof?.release_manifest_sha256 === String(manifest?.release_manifest_sha256 || ''),
    'cloud_preflight_manifest_hash_mismatch'
  )
  check(gates.release_verified === true, 'cloud_preflight_release_gate_missing')
  check(gates.immutable_firewall_verified === true, 'cloud_preflight_firewall_gate_missing')
  check(gates.node_runtime_verified === true, 'cloud_preflight_node_gate_missing')
  if (mode === 'production') {
    check(gates.environment_values_verified === true, 'cloud_preflight_environment_gate_missing')
    check(gates.railway_identity_verified === true, 'cloud_preflight_railway_gate_missing')
    check(gates.persistent_storage_verified === true, 'cloud_preflight_persistence_gate_missing')
    check(gates.production_approval_verified === true, 'cloud_preflight_approval_gate_missing')
    check(gates.recovery_transition_verified === true, 'cloud_preflight_recovery_transition_gate_missing')
  } else if (mode === 'staging') {
    check(gates.staging_isolation_verified === true, 'cloud_preflight_staging_gate_missing')
  }
  return failures
}

function verifyCloudRuntimeSafety({ env = process.env, manifest } = {}) {
  if (isSingleReleaseRequested(env)) {
    const release = verifySingleRelease({
      root: String(env.SCV_ROOT || __dirname),
      env
    })
    const identity = singleReleaseRuntimeIdentityVerdict({ receipt: release, env })
    const failures = [
      ...release.failures,
      ...identity.failures,
      ...verifyCommonCloudSafety(env),
      ...verifySingleReleaseOperationalSafety(release.mode, env)
    ]
    return {
      ok: failures.length === 0,
      protocol: release.protocol,
      mode: release.mode,
      release_id: release.release_id,
      content_fingerprint_sha256: release.content_fingerprint_sha256,
      release_manifest_sha256: release.release_manifest_sha256,
      failures: [...new Set(failures)]
    }
  }
  const initialMode = runtimeMode(env)
  if (initialMode === 'local') return { ok: true, mode: initialMode, failures: [] }
  const releaseManifest = manifest || readReleaseManifest(__dirname)
  const mode = runtimeMode(env, releaseManifest)
  const responsesFailures = releaseManifest?.models?.visible_reply_api === 'responses_v1'
    ? [
        ...(String(env.SCV_DM_EXECUTOR || '') === 'openai_responses' ? [] : ['cloud_responses_executor_required']),
        ...(String(env.SCV_OPENAI_RESPONSES_REQUIRED || '') === '1' ? [] : ['cloud_responses_receipt_required']),
        ...(String(env.OPENAI_RESPONSES_REASONING_EFFORT || '') === String(releaseManifest?.models?.visible_reply_reasoning_effort || '')
          ? [] : ['cloud_responses_reasoning_effort_mismatch'])
      ]
    : []
  const failures = [
    ...((mode === 'production' || mode === 'staging') ? [] : ['cloud_release_mode_required']),
    ...verifyPreflightProof(releaseManifest, mode, env),
    ...verifyCommonCloudSafety(env),
    ...responsesFailures,
    ...(mode === 'production'
      ? verifyProductionSafety(env, {
          releasePhase: String(env.SCV_RELEASE_PHASE || 'active')
        })
      : (mode === 'staging' ? verifyStagingIsolation(releaseManifest, env) : []))
  ]
  return { ok: failures.length === 0, mode, failures }
}

function requireCloudRuntimeSafety(options = {}) {
  const receipt = verifyCloudRuntimeSafety(options)
  if (!receipt.ok) throw new Error(`cloud_runtime_safety_rejected:${receipt.failures.join(',')}`)
  return receipt
}

module.exports = {
  SCV_PREFLIGHT_PROOF_SCHEMA,
  runtimeMode,
  readPreflightProof,
  verifyPreflightProof,
  verifyCommonCloudSafety,
  verifySingleReleaseOperationalSafety,
  verifyCloudRuntimeSafety,
  requireCloudRuntimeSafety
}
