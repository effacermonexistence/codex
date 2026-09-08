#!/usr/bin/env node
// Immutable golden production release verifier.
//
// This is the release-level gate above the existing SCV behavioral firewall.
// It binds code, prompts, model snapshots, tool schema, behavior-affecting
// environment variables, deployment identity/config, and booking invariants.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  DEBUG_USERNAMES,
  DEBUG_CONTACT_IDS,
  debugIdentityConfigurationVerdict,
  isDebugIdentity
} = require('./scv-debug-identity.js')
const {
  verifyManifestTransition
} = require('./scv-recovery-transition.js')

const SCV_GOLDEN_RELEASE_GATE_VERSION =
  'scv-golden-production-release-gate-2026-07-26-v4-exclusive-e2e-owner'
const SCV_RELEASE_PHASES = Object.freeze([
  'recovery_bootstrap',
  'active'
])
const RELEASE_MANIFEST_FILE = 'SCV_GOLDEN_PRODUCTION_RELEASE.json'
const RELEASE_MANIFEST_PATH = path.join(__dirname, RELEASE_MANIFEST_FILE)

const RELEVANT_ENV_PATTERN = /^(?:SCV_|OPENAI_|CODEX_DM_|MANYCHAT_|GMAIL_)/
const RELEVANT_RAILWAY_KEYS = new Set([
  'RAILWAY_PROJECT_ID',
  'RAILWAY_PROJECT_NAME',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_SERVICE_NAME',
  'RAILWAY_PRIVATE_DOMAIN',
  'RAILWAY_PUBLIC_DOMAIN',
  'RAILWAY_STATIC_URL',
  'RAILWAY_SERVICE_SCV_DM_CLOUD_SURVIVAL_URL',
  'RAILWAY_VOLUME_ID',
  'RAILWAY_VOLUME_MOUNT_PATH',
  'RAILWAY_VOLUME_NAME'
])
const RAILWAY_RUNTIME_KEYS = new Set([
  'RAILWAY_PROJECT_ID',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_SERVICE_NAME'
])
const REAL_E2E_TEST_USERNAME = 'omar.system'
const REAL_E2E_TEST_CONTACT_ID = '1537753982'
const REQUIRED_PRODUCTION_SAFETY_ENV_KEYS = Object.freeze([
  'SCV_RELEASE_PHASE',
  'SCV_PAUSE_ALL',
  'SCV_PAUSE_NON_TEST',
  'SCV_PAUSE_DEBUG_ACCOUNTS',
  'SCV_DEBUG_ACCOUNT_USERNAMES',
  'SCV_DEBUG_ACCOUNT_CONTACT_IDS',
  'SCV_PURGE_TEST_USERNAMES',
  'SCV_PURGE_TEST_CONTACT_IDS',
  'SCV_PURGE_TEST_ACCOUNT_ON_STARTUP',
  'SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE',
  'SCV_HOLD_STALE_BACKLOG_MS',
  'SCV_RECOVERY_CUTOVER_AT',
  'SCV_AUTO_RECOVERY_ENABLED',
  'SCV_AUTO_RECOVERY_MAX_ENQUEUES_PER_TICK',
  'SCV_MANYCHAT_INPUT_SWEEP',
  'SCV_INBOUND_AUTH_REQUIRED',
  'SCV_LEGACY_MANYCHAT_INGRESS_COMPAT',
  'SCV_MANYCHAT_INGRESS_SECRET',
  'SCV_ADMIN_AUTH_REQUIRED',
  'SCV_ADMIN_SHARED_SECRET',
  'SCV_LEGACY_INTERNAL_QUEUE_HTTP'
])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hashFile(file) {
  return sha256(fs.readFileSync(file))
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const key of Object.keys(value).sort()) out[key] = stableObject(value[key])
  return out
}

function stableJson(value) {
  return JSON.stringify(stableObject(value))
}

function releaseManifestPayload(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest || {}))
  delete copy.release_manifest_sha256
  return copy
}

function releaseManifestPayloadSha256(manifest) {
  return sha256(stableJson(releaseManifestPayload(manifest)))
}

function readReleaseManifest(root = __dirname) {
  return JSON.parse(fs.readFileSync(path.join(root, RELEASE_MANIFEST_FILE), 'utf8'))
}

function fingerprintEnvironmentValue(salt, key, value) {
  return sha256(`${String(salt || '')}\u0000${String(key || '')}\u0000${String(value ?? '')}`)
}

function relevantEnvironmentKeys(env = process.env) {
  return Object.keys(env)
    .filter((key) => RELEVANT_ENV_PATTERN.test(key) || RELEVANT_RAILWAY_KEYS.has(key))
    .sort()
}

function csvValues(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

// This extends the existing SCV pause/firewall semantics; it is not a second
// routing or locking system. A staging instance may own the real omar.system
// E2E route only when the currently deployed production configuration cannot
// also answer the same username/contact. The verdict is conservative: any
// allowlist match means production can reply.
function productionTestRouteVerdict(
  env = process.env,
  username = REAL_E2E_TEST_USERNAME,
  contactId = REAL_E2E_TEST_CONTACT_ID
) {
  const normalizedUsername = String(username || '').trim().toLowerCase()
  const normalizedContactId = String(contactId || '').trim().toLowerCase()
  const pauseAll = String(env.SCV_PAUSE_ALL || '0').trim() === '1'
  const pauseNonTest = String(env.SCV_PAUSE_NON_TEST || '0').trim() === '1'
  const pauseDebug = String(env.SCV_PAUSE_DEBUG_ACCOUNTS || '0').trim() === '1'
  const debugTarget = isDebugIdentity({
    instagram_username: normalizedUsername,
    contact_id: normalizedContactId
  }, env)
  const effectiveFastUsernames =
    String(env.SCV_FAST_TARGET_USERNAMES || '').trim() ||
    String(env.SCV_PURGE_TEST_USERNAMES || '').trim()
  const effectiveFastContactIds =
    String(env.SCV_FAST_TARGET_CONTACT_IDS || '').trim() ||
    String(env.SCV_PURGE_TEST_CONTACT_IDS || '').trim()
  const allowedUsernames = new Set([
    ...csvValues(effectiveFastUsernames),
    ...csvValues(env.SCV_CANARY_INSTAGRAM_USERNAME),
    ...csvValues(env.SCV_PAUSE_ALLOW_USERNAMES)
  ])
  const allowedContactIds = new Set([
    ...csvValues(effectiveFastContactIds),
    ...csvValues(env.SCV_CANARY_CONTACT_ID),
    ...csvValues(env.SCV_PAUSE_ALLOW_CONTACT_IDS)
  ])
  const usernameAllowed =
    Boolean(normalizedUsername) && allowedUsernames.has(normalizedUsername)
  const contactAllowed =
    Boolean(normalizedContactId) && allowedContactIds.has(normalizedContactId)

  let canReply = true
  let reason = 'production_unpaused_for_all_accounts'
  if (pauseAll) {
    canReply = false
    reason = 'production_pause_all'
  } else if (pauseDebug && debugTarget) {
    canReply = false
    reason = 'production_debug_account_isolated'
  } else if (pauseNonTest && !usernameAllowed && !contactAllowed) {
    canReply = false
    reason = 'production_non_test_pause_excludes_target'
  } else if (pauseNonTest) {
    reason = usernameAllowed
      ? 'production_username_allowlist_includes_target'
      : 'production_contact_allowlist_includes_target'
  }

  const redactedConfiguration = {
    SCV_PAUSE_ALL: pauseAll ? '1' : '0',
    SCV_PAUSE_NON_TEST: pauseNonTest ? '1' : '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: pauseDebug ? '1' : '0',
    allowed_usernames: [...allowedUsernames].sort(),
    allowed_contact_ids: [...allowedContactIds].sort(),
    target_username: normalizedUsername,
    target_contact_id: normalizedContactId
  }
  return {
    can_reply_to_test_account: canReply,
    reason,
    username_allowed: usernameAllowed,
    contact_allowed: contactAllowed,
    redacted_configuration: redactedConfiguration,
    redacted_configuration_sha256: sha256(stableJson(redactedConfiguration))
  }
}

function exactCsv(value, expected) {
  const actual = new Set(csvValues(value))
  const wanted = new Set(expected)
  return actual.size === wanted.size && [...actual].every((item) => wanted.has(item))
}

function releasePhaseFromManifest(manifest = {}) {
  const phase = String(manifest?.deployment?.release_phase || '').trim()
  return SCV_RELEASE_PHASES.includes(phase) ? phase : 'active'
}

function verifyProductionSafety(env = process.env, options = {}) {
  const failures = []
  const requireValue = (condition, label) => { if (!condition) failures.push(label) }
  const releasePhase = String(options.releasePhase || 'active').trim()
  requireValue(SCV_RELEASE_PHASES.includes(releasePhase), 'production_release_phase_invalid')
  const expectedPauseAll = releasePhase === 'recovery_bootstrap' ? '1' : '0'
  requireValue(
    String(env.SCV_RELEASE_PHASE || '') === releasePhase,
    'production_release_phase_environment_mismatch'
  )
  requireValue(
    String(env.SCV_PAUSE_ALL || '') === expectedPauseAll,
    releasePhase === 'recovery_bootstrap'
      ? 'production_recovery_bootstrap_must_pause_all'
      : 'production_pause_all_must_be_zero'
  )
  requireValue(String(env.SCV_PAUSE_NON_TEST || '') === '0', 'production_must_not_pause_real_accounts')
  requireValue(String(env.SCV_PAUSE_DEBUG_ACCOUNTS || '') === '1', 'production_must_isolate_debug_account')
  requireValue(debugIdentityConfigurationVerdict(env).ok, 'production_debug_identity_not_canonical')
  requireValue(exactCsv(env.SCV_DEBUG_ACCOUNT_USERNAMES, DEBUG_USERNAMES), 'production_debug_usernames_not_exact')
  requireValue(exactCsv(env.SCV_DEBUG_ACCOUNT_CONTACT_IDS, DEBUG_CONTACT_IDS), 'production_debug_contact_ids_not_exact')
  requireValue(exactCsv(env.SCV_PURGE_TEST_USERNAMES, DEBUG_USERNAMES), 'production_purge_usernames_not_exact')
  requireValue(exactCsv(env.SCV_PURGE_TEST_CONTACT_IDS, DEBUG_CONTACT_IDS), 'production_purge_contact_ids_not_exact')
  requireValue(String(env.SCV_PURGE_TEST_ACCOUNT_ON_STARTUP || '') === '0', 'production_startup_purge_must_be_off')
  requireValue(String(env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE || '') === '1', 'production_stale_backlog_hold_required')
  requireValue(Number(env.SCV_HOLD_STALE_BACKLOG_MS) >= 15 * 60 * 1000, 'production_stale_backlog_window_too_short')
  requireValue(Number.isFinite(Date.parse(String(env.SCV_RECOVERY_CUTOVER_AT || ''))), 'production_recovery_cutover_required')
  requireValue(String(env.SCV_AUTO_RECOVERY_ENABLED || '') === '0', 'production_initial_auto_recovery_must_be_off')
  requireValue(String(env.SCV_AUTO_RECOVERY_MAX_ENQUEUES_PER_TICK || '') === '1', 'production_auto_recovery_cap_must_be_one')
  requireValue(String(env.SCV_MANYCHAT_INPUT_SWEEP || '') === '0', 'production_initial_manychat_sweep_must_be_off')
  requireValue(String(env.SCV_INBOUND_AUTH_REQUIRED || '') === '1', 'production_ingress_auth_required')
  requireValue(
    String(env.SCV_LEGACY_MANYCHAT_INGRESS_COMPAT || '') === '1',
    'production_legacy_manychat_ingress_compat_required'
  )
  requireValue(String(env.SCV_ADMIN_AUTH_REQUIRED || '') === '1', 'production_admin_auth_required')
  requireValue(String(env.SCV_LEGACY_INTERNAL_QUEUE_HTTP || '') === '0', 'production_legacy_queue_http_must_be_off')
  requireValue(String(env.SCV_MANYCHAT_INGRESS_SECRET || '').length >= 32, 'production_ingress_secret_too_short')
  requireValue(String(env.SCV_ADMIN_SHARED_SECRET || '').length >= 32, 'production_admin_secret_too_short')
  return failures
}

function verifyExclusiveStagingTestRoute(productionEnv = process.env) {
  const verdict = productionTestRouteVerdict(productionEnv)
  return {
    ok: verdict.can_reply_to_test_account === false,
    failures: verdict.can_reply_to_test_account
      ? ['production_can_reply_to_omar_system']
      : [],
    verdict
  }
}

function productionIdentityMatch(manifest, env = process.env) {
  const expected = manifest?.deployment?.railway_identity || {}
  const observed = {
    project_id: String(env.RAILWAY_PROJECT_ID || '').trim(),
    environment_id: String(env.RAILWAY_ENVIRONMENT_ID || '').trim(),
    service_id: String(env.RAILWAY_SERVICE_ID || '').trim()
  }
  const matches = {
    project:
      Boolean(observed.project_id) &&
      observed.project_id === String(expected.RAILWAY_PROJECT_ID || '').trim(),
    environment:
      Boolean(observed.environment_id) &&
      observed.environment_id === String(expected.RAILWAY_ENVIRONMENT_ID || '').trim(),
    service:
      Boolean(observed.service_id) &&
      observed.service_id === String(expected.RAILWAY_SERVICE_ID || '').trim()
  }
  return {
    observed,
    matches,
    // Environment + service identify the production runtime. The project may
    // still be wrong or missing; that becomes a production identity failure,
    // never a route into the weaker staging gate.
    production_runtime: matches.environment && matches.service,
    exact: matches.project && matches.environment && matches.service
  }
}

function releaseMode(env = process.env, manifest = null) {
  // Runtime identity outranks the mutable environment-name label. A production
  // environment/service pair can never opt into staging gates by renaming the
  // environment or setting SCV_RELEASE_MODE.
  if (manifest && productionIdentityMatch(manifest, env).production_runtime) {
    return 'production'
  }
  const railwayName = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  if (railwayName === 'production') return 'production'
  if (railwayName) return 'staging'
  const explicit = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  if (explicit === 'production' || explicit === 'staging') return explicit
  return 'local'
}

function verifyManifestShape(manifest) {
  const failures = []
  const check = (condition, reason) => {
    if (!condition) failures.push(reason)
  }
  check(manifest?.schema === SCV_GOLDEN_RELEASE_GATE_VERSION, 'release_schema_mismatch')
  check(/^scv-instagram-golden-production-/.test(String(manifest?.release_id || '')), 'release_id_invalid')
  check(/^[a-f0-9]{40}$/.test(String(manifest?.behavior_base_commit || '')), 'behavior_base_commit_invalid')
  check(/^[a-f0-9]{40}$/.test(String(manifest?.release_payload_commit || '')), 'release_payload_commit_invalid')
  check(/^[a-f0-9]{64}$/.test(String(manifest?.content_fingerprint_sha256 || '')), 'content_fingerprint_invalid')
  check(/^[a-f0-9]{64}$/.test(String(manifest?.release_manifest_sha256 || '')), 'release_manifest_hash_invalid')
  check(
    manifest?.release_manifest_sha256 === releaseManifestPayloadSha256(manifest),
    'release_manifest_hash_mismatch'
  )
  check(manifest?.secrets_included === false, 'release_manifest_must_not_contain_secrets')
  check(manifest?.runtime_state_included === false, 'release_manifest_must_not_contain_runtime_state')
  check(Object.keys(manifest?.artifact?.files || {}).length >= 15, 'release_file_inventory_too_small')
  check(Object.keys(manifest?.control_plane?.files || {}).length >= 6, 'release_control_plane_inventory_too_small')
  check(
    /^[0-9a-f-]{36}$/.test(String(manifest?.deployment?.pre_freeze_baseline?.deployment_id || '')),
    'release_baseline_deployment_id_missing'
  )
  check(
    /^sha256:[a-f0-9]{64}$/.test(String(manifest?.deployment?.pre_freeze_baseline?.image_digest || '')),
    'release_baseline_image_digest_missing'
  )
  check(
    /^https:\/\/[^/]+\/readyz$/.test(String(manifest?.deployment?.production_health_url || '')),
    'release_production_health_url_invalid'
  )
  check(
    SCV_RELEASE_PHASES.includes(String(manifest?.deployment?.release_phase || '')),
    'release_phase_invalid'
  )
  failures.push(...verifyManifestTransition(manifest))
  check(
    manifest?.deployment?.persistence?.required === true,
    'release_persistent_control_storage_not_required'
  )
  const persistentRoot = String(manifest?.deployment?.persistence?.root || '')
  check(
    path.isAbsolute(persistentRoot),
    'release_persistent_control_root_invalid'
  )
  check(
    String(manifest?.deployment?.persistence?.runtime_namespace || '') ===
      String(manifest?.deployment?.runtime_namespace || ''),
    'release_persistent_namespace_mismatch'
  )
  check(Array.isArray(manifest?.environment?.expected_keys), 'release_environment_keys_missing')
  check(typeof manifest?.environment?.fingerprints === 'object', 'release_environment_fingerprints_missing')
  for (const key of REQUIRED_PRODUCTION_SAFETY_ENV_KEYS) {
    check(manifest?.environment?.expected_keys?.includes(key), `release_safety_environment_key_missing:${key}`)
  }
  check(
    manifest?.contracts?.authority ===
      'existing_scv_immutable_drift_firewall_extended_not_parallel',
    'release_contract_authority_not_existing_firewall'
  )
  check(
    manifest?.contracts?.external_calendar_present === false,
    'release_external_calendar_must_be_absent'
  )
  check(
    manifest?.contracts?.real_instagram_e2e_required === true,
    'release_real_instagram_e2e_not_required'
  )
  check(
    manifest?.contracts?.phase13_required_mutants === 7,
    'release_phase13_mutant_count_mismatch'
  )
  return failures
}

function verifyArtifactFiles(manifest, root = __dirname) {
  const failures = []
  const files = manifest?.artifact?.files || {}
  for (const [relative, expected] of Object.entries(files)) {
    if (path.isAbsolute(relative) || relative.includes('..')) {
      failures.push(`artifact_bad_path:${relative}`)
      continue
    }
    const file = path.join(root, relative)
    if (!fs.existsSync(file)) {
      failures.push(`artifact_missing:${relative}`)
      continue
    }
    const actual = hashFile(file)
    if (actual !== expected) failures.push(`artifact_hash_mismatch:${relative}`)
  }
  return failures
}

function verifyEnvironment(manifest, env = process.env) {
  const failures = []
  const environment = manifest?.environment || {}
  const expectedKeys = Array.isArray(environment.expected_keys)
    ? [...environment.expected_keys].sort()
    : []
  const actualKeys = relevantEnvironmentKeys(env)
  const expectedSet = new Set(expectedKeys)
  const actualSet = new Set(actualKeys)
  for (const key of expectedKeys) {
    if (!actualSet.has(key)) failures.push(`environment_key_missing:${key}`)
  }
  for (const key of actualKeys) {
    if (!expectedSet.has(key)) failures.push(`environment_key_unapproved:${key}`)
  }
  for (const key of expectedKeys) {
    if (!actualSet.has(key)) continue
    const expected = String(environment.fingerprints?.[key] || '')
    const actual = fingerprintEnvironmentValue(environment.salt, key, env[key])
    if (!expected || expected !== actual) failures.push(`environment_value_mismatch:${key}`)
  }
  return failures
}

function verifyRailwayIdentity(manifest, env = process.env) {
  const failures = []
  const expected = manifest?.deployment?.railway_identity || {}
  // Local/staging harnesses can omit Railway runtime variables. Production may not.
  for (const key of RAILWAY_RUNTIME_KEYS) {
    const expectedValue = String(expected[key] || '')
    if (!expectedValue) continue
    if (String(env[key] || '') !== expectedValue) failures.push(`railway_identity_mismatch:${key}`)
  }
  return failures
}

function verifyPersistentControlStorage(manifest, env = process.env) {
  const failures = []
  const expected = String(manifest?.deployment?.persistence?.root || '').trim()
  const actual = String(env.SCV_PERSIST_ROOT || env.RAILWAY_VOLUME_MOUNT_PATH || '').trim()
  if (!expected || !path.isAbsolute(expected)) failures.push('persistent_control_expected_root_invalid')
  if (!actual) failures.push('persistent_control_runtime_root_missing')
  else if (!path.isAbsolute(actual)) failures.push('persistent_control_runtime_root_not_absolute')
  if (expected && actual && path.resolve(expected) !== path.resolve(actual)) {
    failures.push('persistent_control_runtime_root_mismatch')
  }
  if (actual) {
    try {
      if (!fs.statSync(actual).isDirectory()) failures.push('persistent_control_runtime_root_not_directory')
      else fs.accessSync(actual, fs.constants.R_OK | fs.constants.W_OK)
    } catch {
      failures.push('persistent_control_runtime_root_unavailable')
    }
  }
  const expectedNamespace = String(manifest?.deployment?.persistence?.runtime_namespace || '').trim()
  const actualNamespace = String(env.SCV_RUNTIME_NAMESPACE || 'prod').trim()
  if (!expectedNamespace || expectedNamespace !== actualNamespace) {
    failures.push('persistent_control_runtime_namespace_mismatch')
  }
  return failures
}

function verifyBookingPolicy(manifest, root = __dirname) {
  const failures = []
  try {
    const policy = require(path.join(root, 'scv-booking-policy.js'))
    const expected = manifest?.booking_policy || {}
    if (policy.SCV_BOOKING_POLICY_VERSION !== expected.version) failures.push('booking_policy_version_mismatch')
    if (policy.BOOKING_POLICY_FINGERPRINT !== expected.fingerprint_sha256) failures.push('booking_policy_fingerprint_mismatch')
    if (policy.MINIMUM_LEAD_DAYS !== 7 || expected.minimum_lead_days !== 7) failures.push('booking_minimum_not_seven_days')
    if (policy.MAXIMUM_HORIZON_DAYS !== null || expected.maximum_horizon_days !== null) failures.push('booking_maximum_must_be_unbounded')

    const referenceTime = '2026-07-25T12:00:00-07:00'
    const ambiguous = policy.classifyBookingDateText('How about the 26th?', {
      referenceTime,
      allowAmbiguousDay: true
    })
    if (ambiguous.status !== 'ambiguous_month' || ambiguous.day !== 26) {
      failures.push('booking_ambiguous_month_must_clarify')
    }
    const legal = policy.classifyBookingDateText('15th of August', { referenceTime })
    if (legal.status !== 'legal' || legal.date_iso !== '2026-08-15') failures.push('booking_legal_future_date_rejected')
    const tooSoon = policy.classifyBookingDateText('July 27', { referenceTime })
    if (tooSoon.status !== 'too_soon') failures.push('booking_seven_day_floor_not_enforced')
  } catch (error) {
    failures.push(`booking_policy_verification_error:${String(error && error.message ? error.message : error).slice(0, 200)}`)
  }
  return failures
}

function verifyModelPins(manifest) {
  const failures = []
  const models = manifest?.models || {}
  const required = ['chat', 'vision', 'intent', 'asr_adjudicator', 'asr_primary', 'asr_secondary']
  for (const key of required) {
    const value = String(models[key] || '')
    if (!value) failures.push(`model_pin_missing:${key}`)
    const exactLatestVisibleModel = key === 'chat' &&
      value === 'gpt-5.6-sol' &&
      models.alias_allowed === true &&
      models.visible_reply_api === 'responses_v1'
    if (key !== 'asr_secondary' && !exactLatestVisibleModel && !/\d{4}-\d{2}-\d{2}$/.test(value)) {
      failures.push(`model_pin_not_dated:${key}`)
    }
  }
  // The secondary is also required to be a dated snapshot in this release. The
  // separate branch exists for diversity, not as an alias that can drift.
  if (!/\d{4}-\d{2}-\d{2}$/.test(String(models.asr_secondary || ''))) {
    failures.push('model_pin_not_dated:asr_secondary')
  }
  return failures
}

function verifyBoundContracts(manifest, root = __dirname) {
  const failures = []
  const expected = manifest?.contracts || {}
  try {
    const policy = require(path.join(root, 'scv-policy-contracts.js'))
    const state = require(path.join(root, 'scv-structured-state-schema.js'))
    const output = require(path.join(root, 'scv-structured-output-contract.js'))
    const recovery = require(path.join(root, 'scv-deterministic-recovery.js'))
    const clock = require(path.join(root, 'scv-clock.js'))
    const tone = require(path.join(root, 'scv-april-tone-regression.js'))
    const e2e = require(path.join(root, 'scv-real-e2e-receipt.js'))
    const phase13 = require(path.join(root, 'scv-phase13-destructive-harness.js'))

    policy.assertPolicyContractSemantics(policy.POLICY_CONTRACTS)
    if (expected.policy_contract_sha256 !== policy.POLICY_CONTRACTS_SHA256) {
      failures.push('policy_contract_hash_mismatch')
    }
    if (expected.state_schema_sha256 !== state.STRUCTURED_STATE_SCHEMA_SHA256) {
      failures.push('state_schema_hash_mismatch')
    }
    if (
      expected.structured_output_contract_version !==
      output.STRUCTURED_OUTPUT_CONTRACT_VERSION
    ) failures.push('structured_output_contract_version_mismatch')
    if (
      expected.deterministic_recovery_version !==
      recovery.DETERMINISTIC_RECOVERY_VERSION
    ) failures.push('deterministic_recovery_version_mismatch')
    if (expected.clock_version !== clock.SCV_CLOCK_VERSION) {
      failures.push('clock_version_mismatch')
    }
    if (expected.timezone !== clock.SCV_CLOCK_TIME_ZONE) {
      failures.push('clock_timezone_mismatch')
    }
    const toneFloor = tone.readAprilToneFloor()
    if (expected.april_tone_floor_sha256 !== toneFloor.calculated_sha256) {
      failures.push('april_tone_floor_hash_mismatch')
    }
    if (
      expected.real_e2e_receipt_schema_sha256 !==
      e2e.SCV_REAL_E2E_RECEIPT_SCHEMA_SHA256
    ) failures.push('real_e2e_receipt_schema_hash_mismatch')
    if (
      expected.phase13_harness_version !==
      phase13.PHASE13_DESTRUCTIVE_HARNESS_VERSION
    ) failures.push('phase13_harness_version_mismatch')
    if (expected.phase13_required_mutants !== 7) {
      failures.push('phase13_required_mutants_mismatch')
    }
    if (expected.external_calendar_present !== false) {
      failures.push('external_calendar_present_must_be_false')
    }
    if (
      expected.clock_path !==
      'same_injected_clock_module_for_production_and_tests'
    ) failures.push('clock_path_not_single')
    if (
      expected.real_instagram_e2e_required !== true ||
      expected.real_instagram_e2e_username !== 'omar.system' ||
      String(expected.real_instagram_e2e_contact_id || '') !== '1537753982'
    ) failures.push('real_instagram_e2e_identity_mismatch')
  } catch (error) {
    failures.push(
      `bound_contract_verification_error:${String(
        error?.message || error
      ).slice(0, 300)}`
    )
  }
  return failures
}

function applyPinnedModels(manifest, env = process.env) {
  const models = manifest?.models || {}
  const mapping = {
    OPENAI_DM_MODEL: models.chat,
    OPENAI_VISION_MODEL: models.vision,
    OPENAI_INTENT_MODEL: models.intent,
    OPENAI_ASR_ADJUDICATOR_MODEL: models.asr_adjudicator,
    SCV_TRANSCRIBE_MODEL: models.asr_primary,
    SCV_TRANSCRIBE_SECONDARY_MODEL: models.asr_secondary
  }
  for (const [key, value] of Object.entries(mapping)) {
    if (!value) throw new Error(`cannot_apply_missing_model_pin:${key}`)
    env[key] = String(value)
  }
  env.SCV_ENFORCE_OPENAI_MODEL_IDENTITY = '1'
  env.SCV_DM_EXECUTOR = 'openai_responses'
  env.SCV_OPENAI_RESPONSES_REQUIRED = '1'
  env.OPENAI_RESPONSES_REASONING_EFFORT = String(models.visible_reply_reasoning_effort || 'medium')
  return {
    ...mapping,
    SCV_ENFORCE_OPENAI_MODEL_IDENTITY: '1',
    SCV_DM_EXECUTOR: 'openai_responses',
    SCV_OPENAI_RESPONSES_REQUIRED: '1',
    OPENAI_RESPONSES_REASONING_EFFORT: String(models.visible_reply_reasoning_effort || 'medium')
  }
}

function verifyStagingIsolation(manifest, env = process.env) {
  const failures = []
  const csv = (value) =>
    String(value || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  const realE2EArmed =
    String(env.SCV_STAGING_REAL_E2E_ARMED || '0').trim() === '1'
  const expectedPauseAll = realE2EArmed ? '0' : '1'
  if (String(env.SCV_PAUSE_ALL || '') !== expectedPauseAll) {
    failures.push(
      realE2EArmed
        ? 'staging_real_e2e_requires_pause_all_zero'
        : 'staging_safe_validation_requires_pause_all_one'
    )
  }
  if (String(env.SCV_PAUSE_NON_TEST || '') !== '1') {
    failures.push('staging_requires_non_test_pause')
  }
  if (String(env.SCV_PAUSE_DEBUG_ACCOUNTS || '') !== '0') {
    failures.push('staging_requires_debug_account_unpaused')
  }
  const usernames = csv(env.SCV_FAST_TARGET_USERNAMES)
  const contacts = csv(env.SCV_FAST_TARGET_CONTACT_IDS)
  if (usernames.length !== 1 || usernames[0] !== 'omar.system') {
    failures.push('staging_username_allowlist_not_exact')
  }
  if (contacts.length !== 1 || contacts[0] !== '1537753982') {
    failures.push('staging_contact_allowlist_not_exact')
  }
  const persistRoot = String(
    env.SCV_PERSIST_ROOT || env.RAILWAY_VOLUME_MOUNT_PATH || ''
  ).trim()
  if (persistRoot !== '/data') {
    failures.push('staging_requires_isolated_data_volume')
  }
  if (String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production') {
    failures.push('staging_cannot_use_production_environment')
  }
  const identity = productionIdentityMatch(manifest, env)
  if (!identity.observed.environment_id) {
    failures.push('staging_railway_environment_id_missing')
  } else if (identity.matches.environment) {
    failures.push('staging_cannot_use_production_environment_id')
  }
  if (!identity.observed.service_id) {
    failures.push('staging_railway_service_id_missing')
  } else if (identity.matches.service) {
    failures.push('staging_cannot_use_production_service_id')
  }
  const namespace = String(env.SCV_RUNTIME_NAMESPACE || '').trim().toLowerCase()
  if (!namespace || namespace === 'prod' || namespace === 'production') {
    failures.push('staging_requires_isolated_runtime_namespace')
  }
  return failures
}

function runGoldenReleaseVerification(options = {}) {
  const {
    root = __dirname,
    env = process.env,
    verifyFiles = true
  } = options
  const manifest = readReleaseManifest(root)
  const mode = releaseMode(env, manifest)
  const verifyEnvironmentValues =
    options.verifyEnvironmentValues === undefined
      ? mode === 'production'
      : options.verifyEnvironmentValues
  const verifyRailway =
    options.verifyRailway === undefined
      ? mode === 'production'
      : options.verifyRailway
  const verifyPersistence =
    options.verifyPersistence === undefined
      ? mode === 'production'
      : options.verifyPersistence
  const verifyStaging =
    options.verifyStaging === undefined
      ? mode === 'staging'
      : options.verifyStaging
  const failures = [
    ...verifyManifestShape(manifest),
    ...(verifyFiles ? verifyArtifactFiles(manifest, root) : []),
    ...verifyModelPins(manifest),
    ...verifyBookingPolicy(manifest, root),
    ...verifyBoundContracts(manifest, root),
    ...(verifyEnvironmentValues ? verifyEnvironment(manifest, env) : []),
    ...(verifyRailway ? verifyRailwayIdentity(manifest, env) : []),
    ...(verifyPersistence ? verifyPersistentControlStorage(manifest, env) : []),
    ...(mode === 'production'
      ? verifyProductionSafety(env, { releasePhase: releasePhaseFromManifest(manifest) })
      : []),
    ...(verifyStaging ? verifyStagingIsolation(manifest, env) : [])
  ]
  return {
    ok: failures.length === 0,
    gate_version: SCV_GOLDEN_RELEASE_GATE_VERSION,
    release_id: String(manifest.release_id || ''),
    content_fingerprint_sha256: String(manifest.content_fingerprint_sha256 || ''),
    release_manifest_sha256: String(manifest.release_manifest_sha256 || ''),
    mode,
    checked_files: Object.keys(manifest?.artifact?.files || {}).length,
    failures,
    manifest
  }
}

function requireGoldenRelease(options = {}) {
  const receipt = runGoldenReleaseVerification(options)
  if (!receipt.ok) throw new Error(`golden_release_rejected:${receipt.failures.join(',')}`)
  return receipt
}

module.exports = {
  SCV_GOLDEN_RELEASE_GATE_VERSION,
  SCV_RELEASE_PHASES,
  RELEASE_MANIFEST_FILE,
  RELEASE_MANIFEST_PATH,
  RELEVANT_ENV_PATTERN,
  RELEVANT_RAILWAY_KEYS,
  REQUIRED_PRODUCTION_SAFETY_ENV_KEYS,
  sha256,
  hashFile,
  stableObject,
  stableJson,
  releaseManifestPayload,
  releaseManifestPayloadSha256,
  readReleaseManifest,
  fingerprintEnvironmentValue,
  relevantEnvironmentKeys,
  productionIdentityMatch,
  releaseMode,
  verifyManifestShape,
  verifyArtifactFiles,
  verifyEnvironment,
  verifyRailwayIdentity,
  verifyPersistentControlStorage,
  verifyProductionSafety,
  releasePhaseFromManifest,
  verifyBookingPolicy,
  verifyModelPins,
  verifyBoundContracts,
  applyPinnedModels,
  productionTestRouteVerdict,
  verifyExclusiveStagingTestRoute,
  verifyStagingIsolation,
  runGoldenReleaseVerification,
  requireGoldenRelease
}
