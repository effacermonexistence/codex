#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-capability-canary-'))
process.env.SCV_ROOT = root

const {
  SCV_CAPABILITY_CANARY_SCHEMA,
  runCanaryCycle
} = require('./scv-capability-canary.js')

const env = {
  SCV_ROOT: root,
  RAILWAY_ENVIRONMENT_NAME: 'production',
  SCV_RELEASE_MODE: 'production',
  SCV_RELEASE_ID: 'scv-test-release-v1',
  SCV_CONTENT_FINGERPRINT: 'a'.repeat(64),
  OPENAI_DM_MODEL: 'gpt-test-snapshot'
}

async function main() {
  try {
    let activationCalls = 0
    const successful = await runCanaryCycle({
      env,
      root,
      attempts: 3,
      now: () => new Date('2026-08-31T22:00:00.000Z'),
      sleepImpl: async () => {},
      checkImpl: async () => ({
        voice_ok: true,
        vision_ok: true,
        visible_model_ok: true,
        provider_model: 'gpt-test-snapshot'
      }),
      activateFn: () => {
        activationCalls += 1
        return { state: { active: true } }
      }
    })
    assert.strictEqual(successful.schema, SCV_CAPABILITY_CANARY_SCHEMA)
    assert.strictEqual(successful.ok, true)
    assert.strictEqual(successful.attempt_count, 1)
    assert.strictEqual(activationCalls, 0)

    let failedChecks = []
    const failed = await runCanaryCycle({
      env,
      root,
      attempts: 3,
      now: () => new Date('2026-08-31T23:00:00.000Z'),
      sleepImpl: async () => {},
      checkImpl: async () => ({
        voice_ok: false,
        vision_ok: false,
        visible_model_ok: false,
        voice_error: 'fixture mismatch',
        vision_error: 'fixture mismatch',
        visible_model_error: 'provider mismatch'
      }),
      activateFn: (options) => {
        activationCalls += 1
        failedChecks = options.failedChecks
        return { state: { active: true } }
      }
    })
    assert.strictEqual(failed.ok, false)
    assert.strictEqual(failed.attempt_count, 3)
    assert.strictEqual(failed.fail_close_required, true)
    assert.strictEqual(failed.fail_close_activated, true)
    assert.strictEqual(activationCalls, 1)
    assert.deepStrictEqual(failedChecks.sort(), [
      'visible_model_identity',
      'vision_description',
      'voice_transcription'
    ])

    const statusFile = path.join(root, 'logs', 'capability-canary-status.json')
    const persisted = JSON.parse(fs.readFileSync(statusFile, 'utf8'))
    assert.strictEqual(persisted.ok, false)
    assert.strictEqual(persisted.schema, SCV_CAPABILITY_CANARY_SCHEMA)
    assert.strictEqual(fs.statSync(statusFile).mode & 0o777, 0o600)

    process.stdout.write(`${JSON.stringify({
      ok: true,
      schema: SCV_CAPABILITY_CANARY_SCHEMA,
      successful_cycle_passes: true,
      three_failed_attempts_fail_close: true,
      status_persisted_mode_0600: true
    }, null, 2)}\n`)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: String(error?.stack || error) })}\n`)
  process.exit(1)
})
