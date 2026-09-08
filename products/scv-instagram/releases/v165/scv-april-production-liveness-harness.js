#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  MODE_EXACT,
  MODE_ONE_OF,
  SCV_RUNTIME_BEHAVIOR_CONTRACT_VERSION
} = require('./scv-runtime-behavior-contract.js')
const {
  verifySingleReleaseOperationalSafety
} = require('./scv-cloud-runtime-safety.js')

function runHarness() {
  let checked = 0
  const ok = (condition, label) => {
    checked += 1
    if (!condition) throw new Error(label)
  }

  ok(
    SCV_RUNTIME_BEHAVIOR_CONTRACT_VERSION.includes('production-business-lane'),
    'behavior_contract_version_must_name_business_lane'
  )
  ok(MODE_EXACT.production.SCV_PAUSE_NON_TEST === '0',
    'production_contract_must_pin_non_test_pause_off')
  ok(!Object.prototype.hasOwnProperty.call(MODE_ONE_OF.production, 'SCV_PAUSE_NON_TEST'),
    'production_contract_must_not_allow_pause_variants')
  ok(MODE_EXACT.staging.SCV_PAUSE_NON_TEST === '1',
    'staging_contract_must_keep_non_test_isolation')

  const base = {
    SCV_RELEASE_PHASE: 'active',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_PURGE_TEST_ACCOUNT_ON_STARTUP: '0',
    SCV_MANYCHAT_INPUT_SWEEP: '0',
    SCV_INBOUND_AUTH_REQUIRED: '1',
    SCV_ADMIN_AUTH_REQUIRED: '1',
    SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE: '1',
    OPENAI_API_KEY: 'present',
    MANYCHAT_API_KEY: 'present',
    GMAIL_IMAP_USER: 'present',
    GMAIL_IMAP_APP_PASSWORD: 'present'
  }
  const open = verifySingleReleaseOperationalSafety('production', {
    ...base,
    SCV_PAUSE_NON_TEST: '0'
  })
  const silent = verifySingleReleaseOperationalSafety('production', {
    ...base,
    SCV_PAUSE_NON_TEST: '1'
  })
  ok(!open.includes('single_release_production_non_test_pause_must_be_zero'),
    'business_lane_open_must_pass_operational_gate')
  ok(silent.includes('single_release_production_non_test_pause_must_be_zero'),
    'business_lane_silent_must_fail_operational_gate')

  const inbound = fs.readFileSync(path.join(__dirname, 'inbound-scv.js'), 'utf8')
  ok(inbound.includes('pauseEnabled(process.env) === false'),
    'production_readiness_must_require_open_business_lane')
  ok(inbound.includes("'non_test_accounts_paused'"),
    'production_readiness_must_expose_pause_failure')
  ok(!inbound.includes('owner_lockdown_allowlist_missing'),
    'debug_allowlist_must_not_make_silent_production_ready')

  const contract = fs.readFileSync(path.join(__dirname, 'scv-runtime-behavior-contract.js'), 'utf8')
  ok(contract.includes("SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE: '1'"),
    'unpause_must_preserve_stale_backlog_hold')
  ok(contract.includes("SCV_HOLD_STALE_BACKLOG_MS: '900000'"),
    'unpause_must_preserve_stale_backlog_window')

  return {
    ok: true,
    schema: 'scv-april-production-liveness-harness-2026-09-01-v1',
    checked
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runHarness(), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exit(1)
  }
}

module.exports = { runHarness }
