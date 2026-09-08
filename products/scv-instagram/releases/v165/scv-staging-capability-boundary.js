#!/usr/bin/env node
'use strict'

// This module is intentionally dependency-free. It is loaded before any SCV
// worker is started and defines the fail-closed staging capability boundary.
// Production and local runtimes retain their existing service topology.

const CAPABILITY_MODE_WITHHELD = 'withheld'
const CAPABILITY_MODE_PROVIDER_BOUND = 'provider_bound'
const GMAIL_MODE_WITHHELD = 'withheld'
const GMAIL_MODE_SEPARATE_TEST_ROUTE = 'separate_test_route'
const STAGING_CAPABILITY_KEYS = Object.freeze([
  'OPENAI_API_KEY',
  'MANYCHAT_API_KEY',
  'GMAIL_IMAP_USER',
  'GMAIL_IMAP_APP_PASSWORD'
])
const CREDENTIALLESS_SERVICE_ALLOWLIST = Object.freeze([])

function flag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim())
}

function runtimeModeFromEnv(env = process.env) {
  const railway = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const configured = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  if (railway === 'production' || configured === 'production') return 'production'
  if (railway === 'staging' || configured === 'staging') return 'staging'
  // A partial staging variable set must never fall through to the permissive
  // local topology. Railway staging environments use generated names, so the
  // explicit capability namespace itself is a fail-closed staging hint.
  if ([
    'SCV_STAGING_CAPABILITY_MODE', 'SCV_STAGING_GMAIL_MODE',
    'SCV_STAGING_REAL_E2E_ARMED', 'SCV_STAGING_TEST_FORM_AUTHORITY_SHA256'
  ].some((key) => String(env[key] || '').trim())) return 'staging'
  return 'local'
}

function csv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function stagingCapabilityBoundary(env = process.env) {
  const runtimeMode = runtimeModeFromEnv(env)
  const capabilityMode = String(env.SCV_STAGING_CAPABILITY_MODE || '').trim()
  const gmailMode = String(env.SCV_STAGING_GMAIL_MODE || '').trim()
  const failures = []
  const capabilityPresence = Object.fromEntries(
    STAGING_CAPABILITY_KEYS.map((key) => [key, Boolean(String(env[key] || '').trim())])
  )
  const staging = runtimeMode === 'staging'

  if (!staging) {
    return {
      ok: true,
      staging: false,
      runtime_mode: runtimeMode,
      capability_mode: 'not_applicable',
      gmail_mode: 'not_applicable',
      capability_presence: capabilityPresence,
      external_capabilities_verified: false,
      external_workers_allowed: true,
      gmail_reader_allowed: true,
      readiness_scope: ['existing_runtime_contract']
    }
  }

  if (![CAPABILITY_MODE_WITHHELD, CAPABILITY_MODE_PROVIDER_BOUND]
    .includes(capabilityMode)) {
    failures.push('staging_capability_mode_invalid')
  }
  if (String(env.SCV_PAUSE_NON_TEST || '') !== '1') {
    failures.push('staging_non_test_pause_missing')
  }
  if (String(env.SCV_PAUSE_DEBUG_ACCOUNTS || '') !== '0') {
    failures.push('staging_debug_account_pause_invalid')
  }
  const usernames = csv(env.SCV_FAST_TARGET_USERNAMES)
  const contacts = csv(env.SCV_FAST_TARGET_CONTACT_IDS)
  if (usernames.length !== 1 || usernames[0] !== 'omar.system') {
    failures.push('staging_omar_username_not_exact')
  }
  if (contacts.length !== 1 || contacts[0] !== '1537753982') {
    failures.push('staging_omar_contact_not_exact')
  }
  // The debug identity is also the interactive acceptance-test identity. Merely
  // routing it through the fast-target list is insufficient: an inherited or
  // provider-supplied pacing override can otherwise make a healthy reply look
  // like a no-reply for minutes. Enforce the exact zero-delay contract before
  // any staging worker is allowed to start.
  if (String(env.SCV_FAST_TARGET_DELAY_MULTIPLIER || '').trim() !== '0') {
    failures.push('staging_omar_delay_multiplier_not_zero')
  }
  if (String(env.SCV_FAST_TARGET_FORCE_ZERO || '').trim() !== '1') {
    failures.push('staging_omar_force_zero_not_exact')
  }
  for (const key of [
    'SCV_CANARY_INSTAGRAM_USERNAME', 'SCV_CANARY_CONTACT_ID',
    'SCV_PAUSE_ALLOW_USERNAMES', 'SCV_PAUSE_ALLOW_CONTACT_IDS'
  ]) {
    if (String(env[key] || '').trim()) {
      failures.push(`staging_supplemental_allowlist_forbidden:${key}`)
    }
  }
  if (String(env.SCV_MANYCHAT_INPUT_SWEEP || '') !== '0') {
    failures.push('staging_manychat_sweep_must_be_disabled')
  }

  if (capabilityMode === CAPABILITY_MODE_WITHHELD) {
    if (String(env.SCV_PAUSE_ALL || '') !== '1') {
      failures.push('withheld_capability_requires_pause_all')
    }
    if (flag(env.SCV_STAGING_REAL_E2E_ARMED)) {
      failures.push('withheld_capability_cannot_be_armed')
    }
    if (gmailMode !== GMAIL_MODE_WITHHELD) {
      failures.push('withheld_capability_requires_gmail_withheld')
    }
    for (const key of STAGING_CAPABILITY_KEYS) {
      if (capabilityPresence[key]) failures.push(`withheld_capability_value_present:${key}`)
    }
    if (String(env.SCV_STAGING_TEST_FORM_AUTHORITY_SHA256 || '').trim()) {
      failures.push('withheld_capability_forbids_test_form_authority')
    }
  }

  if (capabilityMode === CAPABILITY_MODE_PROVIDER_BOUND) {
    if (String(env.SCV_PAUSE_ALL || '') !== '0') {
      failures.push('provider_bound_capability_requires_pause_all_zero')
    }
    if (!flag(env.SCV_STAGING_REAL_E2E_ARMED)) {
      failures.push('provider_bound_capability_requires_armed_deployment')
    }
    if (!capabilityPresence.OPENAI_API_KEY) {
      failures.push('provider_bound_openai_key_missing')
    }
    if (!capabilityPresence.MANYCHAT_API_KEY) {
      failures.push('provider_bound_manychat_key_missing')
    }
    const gmailUser = capabilityPresence.GMAIL_IMAP_USER
    const gmailPassword = capabilityPresence.GMAIL_IMAP_APP_PASSWORD
    if (gmailUser !== gmailPassword) failures.push('provider_bound_gmail_partial_credentials')
    if (!gmailUser) {
      if (gmailMode !== GMAIL_MODE_WITHHELD) {
        failures.push('provider_bound_absent_gmail_requires_withheld_mode')
      }
      if (String(env.SCV_STAGING_TEST_FORM_AUTHORITY_SHA256 || '').trim()) {
        failures.push('provider_bound_absent_gmail_forbids_test_form_authority')
      }
    } else {
      if (gmailMode !== GMAIL_MODE_SEPARATE_TEST_ROUTE) {
        failures.push('provider_bound_gmail_requires_separate_test_route')
      }
      if (!/^[a-f0-9]{64}$/.test(String(
        env.SCV_STAGING_TEST_FORM_AUTHORITY_SHA256 || ''
      ))) failures.push('provider_bound_test_form_authority_missing')
    }
  }

  const providerBound = capabilityMode === CAPABILITY_MODE_PROVIDER_BOUND
  const boundaryOk = failures.length === 0
  const gmailReaderAllowed = boundaryOk && providerBound &&
    gmailMode === GMAIL_MODE_SEPARATE_TEST_ROUTE &&
    capabilityPresence.GMAIL_IMAP_USER &&
    capabilityPresence.GMAIL_IMAP_APP_PASSWORD
  return {
    ok: boundaryOk,
    failures,
    staging: true,
    runtime_mode: runtimeMode,
    capability_mode: capabilityMode,
    gmail_mode: gmailMode,
    capability_presence: capabilityPresence,
    // Provider proof is verified by the control plane and represented in the
    // deployment receipt. Runtime configuration alone is never called proof.
    external_capabilities_verified: false,
    external_workers_allowed: boundaryOk && providerBound,
    gmail_reader_allowed: gmailReaderAllowed,
    readiness_scope: capabilityMode === CAPABILITY_MODE_WITHHELD
      ? ['artifact_integrity', 'runtime_identity', 'persistence_isolation']
      : ['artifact_integrity', 'runtime_identity', 'persistence_isolation', 'provider_binding']
  }
}

function filterServiceDefinitions(serviceDefinitions, env = process.env) {
  const boundary = stagingCapabilityBoundary(env)
  if (!boundary.staging) return [...serviceDefinitions]
  // Unknown or invalid staging modes are treated as capability-withheld. This
  // is the earliest enforceable worker boundary and remains safe even if the
  // later preflight rejects the deployment.
  if (!boundary.external_workers_allowed) {
    const allowed = new Set(CREDENTIALLESS_SERVICE_ALLOWLIST)
    return serviceDefinitions.filter(([label]) => allowed.has(label))
  }
  return serviceDefinitions.filter(([label]) =>
    label !== 'gmail-form-reader' || boundary.gmail_reader_allowed
  )
}

module.exports = {
  CAPABILITY_MODE_WITHHELD,
  CAPABILITY_MODE_PROVIDER_BOUND,
  GMAIL_MODE_WITHHELD,
  GMAIL_MODE_SEPARATE_TEST_ROUTE,
  STAGING_CAPABILITY_KEYS,
  CREDENTIALLESS_SERVICE_ALLOWLIST,
  runtimeModeFromEnv,
  stagingCapabilityBoundary,
  filterServiceDefinitions
}
