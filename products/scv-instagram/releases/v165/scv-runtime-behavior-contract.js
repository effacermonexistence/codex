#!/usr/bin/env node
'use strict'

// One non-secret runtime contract for the single-release Instagram service.
//
// Source bytes are already covered by SCV_SINGLE_RELEASE.json. Keeping the
// expected public behavior values here therefore makes the source inventory,
// boot verifier, executor and /readyz consume the same immutable authority.
// Provider credentials are presence-checked elsewhere and are never copied or
// hashed into this receipt.

const crypto = require('crypto')
const {
  DEBUG_USERNAMES_CSV,
  DEBUG_CONTACT_IDS_CSV
} = require('./scv-debug-identity.js')

const SCV_RUNTIME_BEHAVIOR_CONTRACT_VERSION =
  'scv-runtime-behavior-contract-2026-09-01-v3-production-business-lane'
const SCV_VISIBLE_MODEL_SNAPSHOT = 'gpt-5.4-mini-2026-03-17'
const SCV_VISIBLE_EXECUTOR = 'openai_responses'
const SCV_VISIBLE_API = 'responses_v1'

const MODEL_ENV_EXPECTED = Object.freeze({
  OPENAI_DM_MODEL: SCV_VISIBLE_MODEL_SNAPSHOT,
  OPENAI_VISION_MODEL: 'gpt-4.1-mini-2025-04-14',
  OPENAI_INTENT_MODEL: 'gpt-4.1-mini-2025-04-14',
  OPENAI_ASR_ADJUDICATOR_MODEL: 'gpt-4.1-mini-2025-04-14',
  SCV_TRANSCRIBE_MODEL: 'gpt-4o-mini-transcribe-2025-03-20',
  SCV_TRANSCRIBE_SECONDARY_MODEL: 'gpt-4o-mini-transcribe-2025-12-15',
  OPENAI_RESPONSES_REASONING_EFFORT: 'medium',
  SCV_DM_EXECUTOR: SCV_VISIBLE_EXECUTOR,
  SCV_OPENAI_EXECUTOR: SCV_VISIBLE_API,
  SCV_OPENAI_RESPONSES_REQUIRED: '1',
  SCV_ENFORCE_OPENAI_MODEL_IDENTITY: '1',
  // Compatibility mirror only. Runtime execution and readiness never read it.
  SCV_ENFORCE_MODEL_IDENTITY: '1'
})

const COMMON_EXACT = Object.freeze({
  SCV_RELEASE_PROTOCOL: 'single_release_v1',
  SCV_RELEASE_PHASE: 'active',
  SCV_CLOUD_RUNTIME: '1',
  SCV_PERSIST_ROOT: '/data',
  SCV_BIND_HOST: '0.0.0.0',
  SCV_INTERNAL_BIND_HOST: '127.0.0.1',
  SCV_INBOUND_AUTH_REQUIRED: '1',
  SCV_ADMIN_AUTH_REQUIRED: '1',
  SCV_LEGACY_INTERNAL_QUEUE_HTTP: '0',
  SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1',
  SCV_VISION_ALLOW_ANY_HOST: '0',
  SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE: '1',
  SCV_HOLD_STALE_BACKLOG_MS: '900000',
  SCV_FAIL_CLOSED_RECOVERY: '1',
  SCV_FAIL_CLOSED_SEND_FAILURES: '0',
  SCV_INTERNAL_RETRYABLE_MAX_ATTEMPTS: '3',
  SCV_TRANSIENT_SEND_MAX_RETRIES: '2',
  SCV_PURGE_TEST_ACCOUNT_ON_STARTUP: '0',
  SCV_DEBUG_ACCOUNT_USERNAMES: DEBUG_USERNAMES_CSV,
  SCV_DEBUG_ACCOUNT_CONTACT_IDS: DEBUG_CONTACT_IDS_CSV,
  SCV_PURGE_TEST_USERNAMES: DEBUG_USERNAMES_CSV,
  SCV_PURGE_TEST_CONTACT_IDS: DEBUG_CONTACT_IDS_CSV,
  SCV_MANYCHAT_INPUT_SWEEP: '0',
  SCV_PAUSE_ALL: '0',
  SCV_PAUSE_DEBUG_ACCOUNTS: '0',
  SCV_FAST_TARGET_USERNAMES: 'omar.system',
  SCV_FAST_TARGET_CONTACT_IDS: '1537753982',
  SCV_FAST_TARGET_DELAY_MULTIPLIER: '0',
  SCV_FAST_TARGET_FORCE_ZERO: '1',
  SCV_FAST_TARGET_INBOX_KICK: '1',
  SCV_FAST_TARGET_INBOX_KICK_MODE: 'restart',
  SCV_AUTO_RECOVERY_ENABLED: '0',
  SCV_AUTO_RECOVERY_CERTAIN_ONLY: '1',
  SCV_AUTO_RECOVERY_MAX_ENQUEUES_PER_TICK: '1',
  SCV_AUTOMATION_SUPPRESS_TAGS: 'flag',
  SCV_INSTAGRAM_SUPPRESS_THREAD_LABELS: '1',
  SCV_REACTION_ENABLED: '1',
  SCV_REACTION_RATE: '0.50',
  SCV_REACTION_EMOJI: '❤️',
  SCV_REACTION_DELAY_MIN_MS: '3000',
  SCV_REACTION_DELAY_MAX_MS: '12000',
  SCV_DELAY_MULTIPLIER: '1',
  SCV_NON_FAST_INITIAL_DELAY_MIN_MS: '180000',
  SCV_NON_FAST_INITIAL_DELAY_MAX_MS: '720000',
  SCV_BUBBLE_GAP_MIN_MS: '1500',
  SCV_BUBBLE_GAP_MAX_MS: '22000',
  SCV_ALLOW_DELIVERY_PACING_ENV_OVERRIDE: '0',
  SCV_CONTRACT_HARNESS_LOCKED: '1',
  SCV_TRANSCRIBE_LANGUAGE: 'en',
  SCV_OUTBOUND1_PORT: '3101',
  SCV_OUTBOUND2_PORT: '3102',
  SCV_OUTBOUND1_URL: 'http://127.0.0.1:3101/',
  SCV_OUTBOUND2_URL: 'http://127.0.0.1:3102/'
})

const MODE_EXACT = Object.freeze({
  production: Object.freeze({
    SCV_RELEASE_MODE: 'production',
    // Production exists to answer real customer inbound. A test-only global
    // hold must never satisfy the sealed behavior contract or readiness.
    SCV_PAUSE_NON_TEST: '0',
    // Preserve the v121 rollback inputs while binding them so they cannot drift
    // underneath the active single-release runtime.
    SCV_ALLOW_MANYCHAT_UNVERIFIED_SUCCESS: '1',
    SCV_FAST_DELAY_FORCE_ZERO: '1',
    SCV_FAST_DELAY_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_DELAY_TARGET_CONTACT_IDS: '1537753982',
    SCV_ORPHAN_MAX_THREADS: '120',
    SCV_RECONCILE_MAX_THREADS: '120',
    SCV_REQUIRE_IG_VISIBILITY: '0',
    SCV_CAPABILITY_CANARY: '1'
  }),
  staging: Object.freeze({
    SCV_RELEASE_MODE: 'staging',
    SCV_PAUSE_NON_TEST: '1',
    SCV_STAGING_CAPABILITY_MODE: 'provider_bound',
    SCV_STAGING_GMAIL_MODE: 'withheld',
    SCV_STAGING_REAL_E2E_ARMED: '1',
    SCV_STAGING_TEST_FORM_AUTHORITY_SHA256: '',
    // Provider-bound staging is the promotion gate for the same real voice,
    // vision, and dated visible-model checks required in production.
    SCV_CAPABILITY_CANARY: '1'
  })
})

const MODE_ONE_OF = Object.freeze({
  production: Object.freeze({}),
  staging: Object.freeze({})
})

const REQUIRED_PRESENT = Object.freeze([
  'OPENAI_API_KEY',
  'MANYCHAT_API_KEY',
  'SCV_MANYCHAT_INGRESS_SECRET',
  'SCV_ADMIN_SHARED_SECRET'
])

const PRODUCTION_REQUIRED_PRESENT = Object.freeze([
  'GMAIL_IMAP_USER',
  'GMAIL_IMAP_APP_PASSWORD',
  // These are retained only for current production behavior and immediate
  // v121 rollback. Values never enter a receipt or source inventory.
  'SCV_REACTION_IG_USERNAME',
  'SCV_RELEASE_EVIDENCE_HMAC_SECRET'
])

// These values can change per deployment or are injected by the verified
// entrypoint. They are independently checked by the single-release identity,
// persistence and cloud-safety gates and are not behavior-policy overrides.
const EXEMPT_DYNAMIC = new Set([
  'PORT', 'NODE_ENV', 'HOME',
  'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_PRIVATE_DOMAIN', 'RAILWAY_PROJECT_ID', 'RAILWAY_PROJECT_NAME',
  'RAILWAY_PUBLIC_DOMAIN', 'RAILWAY_SERVICE_ID', 'RAILWAY_SERVICE_NAME',
  'RAILWAY_STATIC_URL', 'RAILWAY_VOLUME_ID', 'RAILWAY_VOLUME_MOUNT_PATH',
  'RAILWAY_VOLUME_NAME',
  'SCV_RECOVERY_CUTOVER_AT', 'SCV_RUNTIME_NAMESPACE',
  // Derived by cloud-start from Railway's dynamic PORT. It is checked below
  // when present but excluded from the stable contract hash so entry and child
  // processes retain the same receipt.
  'SCV_INBOUND_PORT',
  'SCV_ROOT', 'SCV_PERSISTENCE_READY', 'SCV_PREFLIGHT_PROOF_B64',
  'SCV_RELEASE_ID', 'SCV_CONTENT_FINGERPRINT',
  'SCV_RELEASE_MANIFEST_SHA256', 'SCV_GOLDEN_RELEASE_ID',
  'SCV_GOLDEN_RELEASE_FINGERPRINT',
  'SCV_RELEASE_RAILWAY_PROJECT_ID', 'SCV_RELEASE_RAILWAY_ENVIRONMENT_ID',
  'SCV_RELEASE_RAILWAY_ENVIRONMENT_NAME', 'SCV_RELEASE_RAILWAY_SERVICE_ID',
  'SCV_RELEASE_RAILWAY_DEPLOYMENT_ID',
  // Request-local child-process evidence. These are not Railway configuration.
  'SCV_AUTHORITY_MEDIA_CONTEXT', 'SCV_LLM_INTENT', 'SCV_VISION_MEDIA',
  'SCV_QA_TRACE_REJECTED'
])

const FORBIDDEN_AMBIENT = new Set([
  // Alternate executors and model selection paths are not production policy.
  'CODEX_DM_MODEL', 'CODEX_DM_FALLBACK_MODEL',
  'OPENAI_RESPONSES_REASONING_MODE',
  // Test-only fault injectors must never cross into a cloud release.
  'SCV_OUTBOUND1_TEST_FAIL_AFTER_QUEUE_RECEIPT',
  'SCV_OUTBOUND1_TEST_HARNESS', 'SCV_OUTBOX_TEST_HARNESS',
  'SCV_SINGLE_CONTROL_TEST_HARNESS',
  'SCV_CANARY_INSTAGRAM_USERNAME', 'SCV_CANARY_CONTACT_ID',
  'SCV_PAUSE_ALLOW_USERNAMES', 'SCV_PAUSE_ALLOW_CONTACT_IDS'
])

const CONTRACT_DECLARED = new Set([
  ...Object.keys(MODEL_ENV_EXPECTED),
  ...Object.keys(COMMON_EXACT),
  ...Object.values(MODE_EXACT).flatMap((value) => Object.keys(value)),
  ...Object.values(MODE_ONE_OF).flatMap((value) => Object.keys(value)),
  ...REQUIRED_PRESENT,
  ...PRODUCTION_REQUIRED_PRESENT,
  ...EXEMPT_DYNAMIC,
  ...FORBIDDEN_AMBIENT
])

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function cloudMode(env = process.env) {
  const railway = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const release = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  if (railway === 'production' || release === 'production') {
    return railway === 'production' && release === 'production'
      ? 'production'
      : 'invalid'
  }
  if (release === 'staging' && railway && railway !== 'production') return 'staging'
  return 'invalid'
}

function modelIdentityEnforced(env = process.env) {
  return String(env.SCV_ENFORCE_OPENAI_MODEL_IDENTITY || '').trim() === '1'
}

function modelContractVerdict(env = process.env) {
  const failures = []
  for (const [name, expected] of Object.entries(MODEL_ENV_EXPECTED)) {
    if (String(env[name] || '') !== expected) {
      failures.push(`runtime_model_env_mismatch:${name}`)
    }
  }
  return {
    ok: failures.length === 0,
    version: SCV_RUNTIME_BEHAVIOR_CONTRACT_VERSION,
    visible_model: String(env.OPENAI_DM_MODEL || ''),
    executor: String(env.SCV_DM_EXECUTOR || ''),
    api: SCV_VISIBLE_API,
    reasoning_effort: String(env.OPENAI_RESPONSES_REASONING_EFFORT || ''),
    enforced: modelIdentityEnforced(env),
    cross_model_fallback_allowed: false,
    failures
  }
}

function modelReadinessReceipt(env = process.env) {
  const verdict = modelContractVerdict(env)
  return {
    visible_model: String(env.OPENAI_DM_MODEL || ''),
    // This is the flag the executed visible path and cloud safety gate use.
    executor: String(env.SCV_DM_EXECUTOR || ''),
    api: String(env.SCV_OPENAI_EXECUTOR || ''),
    reasoning_effort: String(env.OPENAI_RESPONSES_REASONING_EFFORT || ''),
    enforced: modelIdentityEnforced(env),
    enforcement_source: 'SCV_ENFORCE_OPENAI_MODEL_IDENTITY',
    cross_model_fallback_allowed: false,
    contract_ok: verdict.ok,
    failures: verdict.failures
  }
}

function controlledAmbientName(name) {
  // CODEX_* is also used by the desktop host itself. Only application model
  // selection/executor controls belong to this Railway contract.
  return /^(SCV_|OPENAI_|MANYCHAT_|GMAIL_|IG_|CODEX_(?:DM_|BIN$))/.test(
    String(name || '')
  )
}

function runtimeBehaviorContractVerdict(env = process.env, options = {}) {
  const mode = String(options.mode || cloudMode(env))
  const failures = []
  const exact = {
    ...MODEL_ENV_EXPECTED,
    ...COMMON_EXACT,
    ...(MODE_EXACT[mode] || {})
  }
  for (const [name, expected] of Object.entries(exact)) {
    if (String(env[name] || '') !== expected) {
      failures.push(`runtime_behavior_env_mismatch:${name}`)
    }
  }
  for (const [name, allowed] of Object.entries(MODE_ONE_OF[mode] || {})) {
    if (!allowed.includes(String(env[name] || ''))) {
      failures.push(`runtime_behavior_env_not_allowed:${name}`)
    }
  }
  for (const name of REQUIRED_PRESENT) {
    if (!String(env[name] || '').trim()) {
      failures.push(`runtime_capability_missing:${name}`)
    }
  }
  if (mode === 'production') {
    for (const name of PRODUCTION_REQUIRED_PRESENT) {
      if (!String(env[name] || '').trim()) {
        failures.push(`runtime_capability_missing:${name}`)
      }
    }
    if (String(env.SCV_RELEASE_EVIDENCE_HMAC_SECRET || '').length < 32) {
      failures.push('runtime_legacy_rollback_hmac_too_short')
    }
  } else if (mode === 'staging') {
    for (const name of PRODUCTION_REQUIRED_PRESENT) {
      if (String(env[name] || '').trim()) {
        failures.push(`runtime_staging_capability_forbidden:${name}`)
      }
    }
  } else {
    failures.push('runtime_behavior_mode_invalid')
  }
  for (const name of FORBIDDEN_AMBIENT) {
    if (String(env[name] || '').trim()) {
      failures.push(`runtime_behavior_env_forbidden:${name}`)
    }
  }
  for (const name of Object.keys(env).sort()) {
    if (!controlledAmbientName(name) || CONTRACT_DECLARED.has(name)) continue
    // Unknown ambient overrides are the main configuration-drift boundary: a
    // new control must first be reviewed and added to this sealed source.
    if (String(env[name] || '').trim()) {
      failures.push(`runtime_behavior_env_unsealed:${name}`)
    }
  }
  const cutover = Date.parse(String(env.SCV_RECOVERY_CUTOVER_AT || ''))
  if (!Number.isFinite(cutover)) failures.push('runtime_recovery_cutover_invalid')
  else if (cutover > Date.now() + (5 * 60 * 1000)) {
    failures.push('runtime_recovery_cutover_future')
  }
  const inboundPort = String(env.SCV_INBOUND_PORT || '').trim()
  if (inboundPort) {
    const numericPort = Number(inboundPort)
    if (!/^[0-9]+$/.test(inboundPort) || !Number.isInteger(numericPort) ||
        numericPort < 1 || numericPort > 65535) {
      failures.push('runtime_inbound_port_invalid')
    }
    const railwayPort = String(env.PORT || '').trim()
    if (railwayPort && inboundPort !== railwayPort) {
      failures.push('runtime_inbound_port_not_railway_port')
    }
  }
  const publicValues = Object.fromEntries(
    Object.keys(exact).sort().map((name) => [name, String(env[name] || '')])
  )
  const oneOfValues = Object.fromEntries(
    Object.keys(MODE_ONE_OF[mode] || {}).sort()
      .map((name) => [name, String(env[name] || '')])
  )
  const canonical = JSON.stringify({
    version: SCV_RUNTIME_BEHAVIOR_CONTRACT_VERSION,
    mode,
    exact: publicValues,
    one_of: oneOfValues,
    required_capabilities_present: Object.fromEntries(
      [...REQUIRED_PRESENT, ...(mode === 'production' ? PRODUCTION_REQUIRED_PRESENT : [])]
        .sort().map((name) => [name, Boolean(String(env[name] || '').trim())])
    )
  })
  return {
    ok: failures.length === 0,
    version: SCV_RUNTIME_BEHAVIOR_CONTRACT_VERSION,
    mode,
    contract_sha256: sha256(canonical),
    secret_values_included: false,
    raw_secret_hashes_included: false,
    checked_public_values: Object.keys(publicValues).length + Object.keys(oneOfValues).length,
    failures: [...new Set(failures)]
  }
}

function requireRuntimeBehaviorContract(env = process.env, options = {}) {
  const verdict = runtimeBehaviorContractVerdict(env, options)
  if (!verdict.ok) {
    throw new Error(`runtime_behavior_contract_rejected:${verdict.failures.join(',')}`)
  }
  return verdict
}

module.exports = {
  SCV_RUNTIME_BEHAVIOR_CONTRACT_VERSION,
  SCV_VISIBLE_MODEL_SNAPSHOT,
  SCV_VISIBLE_EXECUTOR,
  SCV_VISIBLE_API,
  MODEL_ENV_EXPECTED,
  COMMON_EXACT,
  MODE_EXACT,
  MODE_ONE_OF,
  modelIdentityEnforced,
  modelContractVerdict,
  modelReadinessReceipt,
  runtimeBehaviorContractVerdict,
  requireRuntimeBehaviorContract
}
