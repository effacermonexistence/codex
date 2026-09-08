#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  MODEL_ENV_EXPECTED,
  COMMON_EXACT,
  MODE_EXACT,
  modelContractVerdict,
  modelReadinessReceipt,
  runtimeBehaviorContractVerdict
} = require('./scv-runtime-behavior-contract.js')

let checked = 0
function check(name, condition, detail = '') {
  checked += 1
  assert.ok(condition, `${name}${detail ? `:${detail}` : ''}`)
}

function validEnv(mode = 'production') {
  const production = mode === 'production'
  return {
    ...MODEL_ENV_EXPECTED,
    ...COMMON_EXACT,
    ...MODE_EXACT[mode],
    SCV_PAUSE_NON_TEST: production ? '0' : '1',
    SCV_RUNTIME_NAMESPACE: production ? 'prod' : 'single-staging-v122',
    SCV_RECOVERY_CUTOVER_AT: '2026-08-29T00:00:00.000Z',
    RAILWAY_ENVIRONMENT_NAME: mode,
    RAILWAY_PROJECT_ID: '11111111-1111-4111-8111-111111111111',
    RAILWAY_ENVIRONMENT_ID: production
      ? '22222222-2222-4222-8222-222222222222'
      : '33333333-3333-4333-8333-333333333333',
    RAILWAY_SERVICE_ID: production
      ? '44444444-4444-4444-8444-444444444444'
      : '55555555-5555-4555-8555-555555555555',
    RAILWAY_DEPLOYMENT_ID: '66666666-6666-4666-8666-666666666666',
    OPENAI_API_KEY: 'secret-openai-fixture',
    MANYCHAT_API_KEY: 'secret-manychat-fixture',
    SCV_MANYCHAT_INGRESS_SECRET: 'i'.repeat(40),
    SCV_ADMIN_SHARED_SECRET: 'a'.repeat(40),
    ...(production
      ? {
          GMAIL_IMAP_USER: 'fixture@example.invalid',
          GMAIL_IMAP_APP_PASSWORD: 'secret-gmail-fixture',
          SCV_REACTION_IG_USERNAME: 'fixture-owner',
          SCV_RELEASE_EVIDENCE_HMAC_SECRET: 'h'.repeat(40)
        }
      : {})
  }
}

function rejectedMutation(name, value, expectedFailure) {
  const env = validEnv('production')
  if (value === undefined) delete env[name]
  else env[name] = value
  const verdict = runtimeBehaviorContractVerdict(env, { mode: 'production' })
  check(`${name}_mutation_rejected`,
    verdict.ok === false && verdict.failures.includes(expectedFailure),
  JSON.stringify(verdict.failures))
}

function main() {
  const production = validEnv('production')
  const staging = validEnv('staging')
  const prodVerdict = runtimeBehaviorContractVerdict(production, {
    mode: 'production'
  })
  const stagingVerdict = runtimeBehaviorContractVerdict(staging, {
    mode: 'staging'
  })
  check('sealed_production_contract_accepted', prodVerdict.ok, JSON.stringify(prodVerdict.failures))
  check('sealed_staging_contract_accepted', stagingVerdict.ok, JSON.stringify(stagingVerdict.failures))
  check('contract_receipt_contains_no_secrets',
    prodVerdict.secret_values_included === false &&
    prodVerdict.raw_secret_hashes_included === false &&
    !JSON.stringify(prodVerdict).includes(production.OPENAI_API_KEY) &&
    !JSON.stringify(prodVerdict).includes(production.SCV_ADMIN_SHARED_SECRET))

  rejectedMutation(
    'SCV_ENFORCE_OPENAI_MODEL_IDENTITY',
    undefined,
    'runtime_behavior_env_mismatch:SCV_ENFORCE_OPENAI_MODEL_IDENTITY'
  )
  rejectedMutation(
    'SCV_ENFORCE_MODEL_IDENTITY',
    '0',
    'runtime_behavior_env_mismatch:SCV_ENFORCE_MODEL_IDENTITY'
  )
  rejectedMutation(
    'SCV_DM_EXECUTOR',
    'codex_exec',
    'runtime_behavior_env_mismatch:SCV_DM_EXECUTOR'
  )
  rejectedMutation(
    'SCV_OPENAI_EXECUTOR',
    'chat_completions_v1',
    'runtime_behavior_env_mismatch:SCV_OPENAI_EXECUTOR'
  )
  rejectedMutation(
    'OPENAI_DM_MODEL',
    'gpt-5.4-mini',
    'runtime_behavior_env_mismatch:OPENAI_DM_MODEL'
  )
  rejectedMutation(
    'OPENAI_RESPONSES_REASONING_EFFORT',
    'high',
    'runtime_behavior_env_mismatch:OPENAI_RESPONSES_REASONING_EFFORT'
  )
  rejectedMutation(
    'OPENAI_INTENT_MODEL',
    'gpt-4.1-mini',
    'runtime_behavior_env_mismatch:OPENAI_INTENT_MODEL'
  )
  rejectedMutation(
    'SCV_REACTION_RATE',
    '0.99',
    'runtime_behavior_env_mismatch:SCV_REACTION_RATE'
  )
  rejectedMutation(
    'CODEX_DM_FALLBACK_MODEL',
    'gpt-5-mini',
    'runtime_behavior_env_forbidden:CODEX_DM_FALLBACK_MODEL'
  )

  const modelVerdict = modelContractVerdict(production)
  const readiness = modelReadinessReceipt(production)
  check('model_contract_accepted', modelVerdict.ok)
  check('readiness_reports_actual_executor_flag',
    readiness.executor === production.SCV_DM_EXECUTOR &&
    readiness.executor !== production.SCV_OPENAI_EXECUTOR)
  check('readiness_reports_actual_enforcement_flag',
    readiness.enforced === true &&
    readiness.enforcement_source === 'SCV_ENFORCE_OPENAI_MODEL_IDENTITY')
  check('readiness_declares_no_cross_model_fallback',
    readiness.cross_model_fallback_allowed === false)

  const childEnv = {
    ...production,
    PORT: '3000',
    SCV_INBOUND_PORT: '3000'
  }
  const childVerdict = runtimeBehaviorContractVerdict(childEnv, {
    mode: 'production'
  })
  check('derived_inbound_port_keeps_contract_stable',
    childVerdict.ok === true &&
    childVerdict.contract_sha256 === prodVerdict.contract_sha256,
  JSON.stringify(childVerdict.failures))
  childEnv.SCV_INBOUND_PORT = '3001'
  const wrongPort = runtimeBehaviorContractVerdict(childEnv, {
    mode: 'production'
  })
  check('wrong_derived_inbound_port_rejected',
    wrongPort.ok === false &&
    wrongPort.failures.includes('runtime_inbound_port_not_railway_port'))

  const legacyOnly = { ...production }
  delete legacyOnly.SCV_ENFORCE_OPENAI_MODEL_IDENTITY
  const legacyOnlyReadiness = modelReadinessReceipt(legacyOnly)
  check('legacy_mirror_cannot_fake_enforcement',
    legacyOnly.SCV_ENFORCE_MODEL_IDENTITY === '1' &&
    legacyOnlyReadiness.enforced === false &&
    legacyOnlyReadiness.contract_ok === false)

  const inboundSource = fs.readFileSync(path.join(__dirname, 'inbound-scv.js'), 'utf8')
  check('readyz_uses_pure_actual_model_receipt',
    inboundSource.includes('? modelReadinessReceipt(process.env)'))
  check('readyz_exposes_behavior_contract_receipt',
    inboundSource.includes('behavior_contract: readiness.behavior_contract'))

  process.stdout.write(`${JSON.stringify({
    ok: true,
    checked,
    model: readiness.visible_model,
    executor: readiness.executor,
    enforcement_source: readiness.enforcement_source,
    cross_model_fallback_allowed: false,
    secret_values_included: false
  })}\n`)
}

try { main() } catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    checked,
    error: String(error?.stack || error)
  })}\n`)
  process.exit(1)
}
