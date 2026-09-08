#!/usr/bin/env node
'use strict'

const assert = require('assert')
const {
  stagingCapabilityBoundary,
  filterServiceDefinitions
} = require('./scv-staging-capability-boundary.js')

const SERVICES = [
  ['outbound-scv2', 'outbound-scv2.js'],
  ['outbound-scv1', 'outbound-scv1.js'],
  ['inbox-worker', 'inbox-worker.js'],
  ['outbox-worker', 'outbox-worker.js'],
  ['reaction-worker', 'reaction-worker.js'],
  ['drift-monitor', 'scv-drift-monitor.js'],
  ['auto-recovery', 'scv-auto-recovery-loop.js'],
  ['manychat-input-sweep', 'scv-manychat-input-sweep.js'],
  ['gmail-form-reader', 'scv-gmail-form-reader.js'],
  ['capability-canary', 'scv-capability-canary.js'],
  ['disk-guardian', 'scv-disk-guardian.js'],
  ['inbound-scv', 'inbound-scv.js']
]

function withheldEnv() {
  return {
    RAILWAY_ENVIRONMENT_NAME: 'golden-stg-test',
    SCV_RELEASE_MODE: 'staging',
    SCV_STAGING_CAPABILITY_MODE: 'withheld',
    SCV_STAGING_GMAIL_MODE: 'withheld',
    SCV_STAGING_REAL_E2E_ARMED: '0',
    SCV_PAUSE_ALL: '1',
    SCV_PAUSE_NON_TEST: '1',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982',
    SCV_FAST_TARGET_DELAY_MULTIPLIER: '0',
    SCV_FAST_TARGET_FORCE_ZERO: '1',
    SCV_MANYCHAT_INPUT_SWEEP: '0'
  }
}

function providerEnv() {
  return {
    ...withheldEnv(),
    SCV_STAGING_CAPABILITY_MODE: 'provider_bound',
    SCV_STAGING_REAL_E2E_ARMED: '1',
    SCV_PAUSE_ALL: '0',
    OPENAI_API_KEY: 'sk-staging-openai-not-a-real-key',
    MANYCHAT_API_KEY: 'staging-manychat-not-a-real-key'
  }
}

function labels(env) {
  return filterServiceDefinitions(SERVICES, env).map(([label]) => label)
}

function run() {
  let checks = 0
  const check = (value, message) => {
    checks += 1
    assert(value, message)
  }

  const withheld = stagingCapabilityBoundary(withheldEnv())
  check(withheld.ok === true, 'valid withheld boundary rejected')
  check(withheld.external_workers_allowed === false,
    'withheld boundary allowed external workers')
  check(labels(withheldEnv()).length === 0,
    'withheld boundary started a child worker')
  const forbidden = new Set([
    'inbound-scv', 'gmail-form-reader', 'inbox-worker', 'outbox-worker',
    'reaction-worker', 'manychat-input-sweep', 'auto-recovery'
  ])
  check(labels(withheldEnv()).every((label) => !forbidden.has(label)),
    'withheld boundary exposed ingress/polling/sending worker')
  const partialStagingHint = { ...withheldEnv() }
  delete partialStagingHint.SCV_RELEASE_MODE
  check(stagingCapabilityBoundary(partialStagingHint).staging === true &&
    labels(partialStagingHint).length === 0,
  'partial staging variables fell through to permissive local workers')

  const invalidCases = [
    ['unknown mode', { SCV_STAGING_CAPABILITY_MODE: 'unknown' }],
    ['missing OpenAI', { SCV_STAGING_CAPABILITY_MODE: 'provider_bound', SCV_STAGING_REAL_E2E_ARMED: '1', SCV_PAUSE_ALL: '0', OPENAI_API_KEY: '', MANYCHAT_API_KEY: 'x'.repeat(24) }],
    ['missing ManyChat', { SCV_STAGING_CAPABILITY_MODE: 'provider_bound', SCV_STAGING_REAL_E2E_ARMED: '1', SCV_PAUSE_ALL: '0', OPENAI_API_KEY: 'x'.repeat(24), MANYCHAT_API_KEY: '' }],
    ['bad pause', { ...providerEnv(), SCV_PAUSE_ALL: '1' }],
    ['not armed', { ...providerEnv(), SCV_STAGING_REAL_E2E_ARMED: '0' }],
    ['wrong Omar username', { ...providerEnv(), SCV_FAST_TARGET_USERNAMES: 'someone.else' }],
    ['wrong Omar contact', { ...providerEnv(), SCV_FAST_TARGET_CONTACT_IDS: '1' }],
    ['missing Omar zero multiplier', { ...providerEnv(), SCV_FAST_TARGET_DELAY_MULTIPLIER: '' }],
    ['nonzero Omar multiplier', { ...providerEnv(), SCV_FAST_TARGET_DELAY_MULTIPLIER: '1' }],
    ['missing Omar force zero', { ...providerEnv(), SCV_FAST_TARGET_FORCE_ZERO: '' }],
    ['disabled Omar force zero', { ...providerEnv(), SCV_FAST_TARGET_FORCE_ZERO: '0' }],
    ['truthy but noncanonical Omar force zero', { ...providerEnv(), SCV_FAST_TARGET_FORCE_ZERO: 'true' }],
    ['supplemental username allowlist', { ...providerEnv(), SCV_PAUSE_ALLOW_USERNAMES: 'other.lead' }],
    ['supplemental contact allowlist', { ...providerEnv(), SCV_PAUSE_ALLOW_CONTACT_IDS: '999' }],
    ['supplemental canary username', { ...providerEnv(), SCV_CANARY_INSTAGRAM_USERNAME: 'other.lead' }],
    ['supplemental canary contact', { ...providerEnv(), SCV_CANARY_CONTACT_ID: '999' }],
    ['sweep enabled', { ...providerEnv(), SCV_MANYCHAT_INPUT_SWEEP: '1' }],
    ['partial Gmail', { ...providerEnv(), GMAIL_IMAP_USER: 'test@example.com' }],
    ['Gmail without proof', {
      ...providerEnv(),
      GMAIL_IMAP_USER: 'test@example.com',
      GMAIL_IMAP_APP_PASSWORD: 'x'.repeat(16),
      SCV_STAGING_GMAIL_MODE: 'separate_test_route'
    }]
  ]
  for (const [name, mutation] of invalidCases) {
    const env = name === 'unknown mode'
      ? { ...withheldEnv(), ...mutation }
      : { ...providerEnv(), ...mutation }
    const verdict = stagingCapabilityBoundary(env)
    check(verdict.ok === false, `${name} was accepted`)
    check(verdict.external_workers_allowed === false,
      `${name} allowed external workers`)
    check(labels(env).length === 0, `${name} started a child worker`)
  }

  const provider = stagingCapabilityBoundary(providerEnv())
  check(provider.ok === true, `valid provider boundary rejected:${provider.failures}`)
  check(provider.external_workers_allowed === true,
    'valid provider boundary did not allow workers')
  check(!labels(providerEnv()).includes('gmail-form-reader'),
    'withheld Gmail reader was started')
  const gmail = {
    ...providerEnv(),
    GMAIL_IMAP_USER: 'staging-test@example.com',
    GMAIL_IMAP_APP_PASSWORD: 'x'.repeat(16),
    SCV_STAGING_GMAIL_MODE: 'separate_test_route',
    SCV_STAGING_TEST_FORM_AUTHORITY_SHA256: 'a'.repeat(64)
  }
  check(stagingCapabilityBoundary(gmail).ok === true,
    'separate Gmail/test-form boundary rejected')
  check(labels(gmail).includes('gmail-form-reader'),
    'verified separate Gmail reader not started')

  const production = { RAILWAY_ENVIRONMENT_NAME: 'production' }
  check(labels(production).length === SERVICES.length,
    'production service topology changed')

  process.stdout.write(`${JSON.stringify({
    ok: true,
    version:
      'scv-staging-capability-boundary-harness-2026-08-25-v4-exact-omar-bracket',
    checks
  })}\n`)
}

if (require.main === module) run()

module.exports = { SERVICES, withheldEnv, providerEnv, run }
