#!/usr/bin/env node
// Network-free proof that the golden synthetic monitor retries transient
// failures, stays silent/healthy on success, and persistently fail-closes
// production after a repeated failure.
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  runSyntheticSuite,
  runAndEnforce,
  sendManyChatDebugWarning,
  openAiModelIdentityCheck
} = require(path.join(__dirname, 'scv-golden-synthetic-monitor.js'))
const {
  readFailClose
} = require(path.join(__dirname, 'scv-golden-fail-close.js'))

const SCV_GOLDEN_SYNTHETIC_HARNESS_VERSION =
  'scv-golden-synthetic-harness-2026-08-19-v2-pause-safe-alerts'

async function runHarness() {
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'synthetic-harness-key'
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail: String(detail || '').slice(0, 1000) })
  }
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'SCV_GOLDEN_PRODUCTION_RELEASE.json'), 'utf8')
  )
  const names = [
    'release_integrity',
    'booking_policy',
    'openai_model_identity',
    'voice_vision_capability',
    'manychat_read_only',
    'gmail_read_only'
  ]
  const healthyChecks = Object.fromEntries(names.map((name) => [name, async () => ({ ok: true })]))

  let identityRequest = null
  const identity = await openAiModelIdentityCheck(manifest, {
    fetchImpl: async (url, init) => {
      identityRequest = { url, init, body: JSON.parse(init.body) }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'resp_synthetic_identity_12345678',
          model: manifest.models.chat,
          output_text: '{"ok":true}'
        })
      }
    }
  })
  check('model_identity_uses_responses_endpoint', identity.ok === true && identityRequest?.url === 'https://api.openai.com/v1/responses', JSON.stringify(identityRequest))
  check('model_identity_binds_manifest_model', identityRequest?.body?.model === manifest.models.chat, JSON.stringify(identityRequest?.body))
  check('model_identity_uses_strict_schema', identityRequest?.body?.text?.format?.strict === true && identityRequest?.body?.text?.format?.schema?.additionalProperties === false, JSON.stringify(identityRequest?.body?.text))
  const mismatchedIdentity = await openAiModelIdentityCheck(manifest, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ model: 'gpt-5.6-terra-tampered', output_text: '{"ok":true}' })
    })
  })
  check('model_identity_rejects_provider_mismatch', mismatchedIdentity.ok === false, JSON.stringify(mismatchedIdentity))
  const healthy = await runSyntheticSuite({
    mode: 'production',
    releaseManifest: manifest,
    delays: [0],
    sleepImpl: async () => {},
    checks: healthyChecks
  })
  check('healthy_suite_passes', healthy.ok === true, JSON.stringify(healthy))
  check('healthy_suite_checks_all_six', healthy.results.length === 6, JSON.stringify(healthy.results))

  let retryCalls = 0
  const retry = await runSyntheticSuite({
    mode: 'staging',
    releaseManifest: manifest,
    delays: [0, 0, 0],
    sleepImpl: async () => {},
    checks: {
      release_integrity: async () => ({ ok: ++retryCalls >= 3 }),
      booking_policy: async () => ({ ok: true }),
      openai_model_identity: async () => ({ ok: true }),
      voice_vision_capability: async () => ({ ok: true })
    }
  })
  check('transient_failure_recovers', retry.ok === true && retryCalls === 3, JSON.stringify(retry))

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-golden-synthetic-'))
  const env = {
    SCV_ROOT: tempRoot,
    SCV_PERSIST_ROOT: tempRoot,
    SCV_RELEASE_MODE: 'production',
    SCV_RUNTIME_NAMESPACE: 'synthetic-harness'
  }
  let warningCalls = 0
  try {
    const failed = await runAndEnforce({
      mode: 'production',
      releaseManifest: manifest,
      delays: [0],
      sleepImpl: async () => {},
      env,
      root: tempRoot,
      warningSender: async () => {
        warningCalls += 1
        return { ok: true, channel: 'harness' }
      },
      checks: Object.fromEntries(names.map((name) => [
        name,
        async () => ({ ok: name !== 'openai_model_identity', reason: 'forced_harness_failure' })
      ]))
    })
    const latch = readFailClose({ env, root: tempRoot })
    check('permanent_failure_rejected', failed.ok === false, JSON.stringify(failed))
    check('permanent_failure_latched', latch.active === true, JSON.stringify(latch))
    check(
      'latch_preserves_release_identity',
      latch.release_id === manifest.release_id &&
        latch.release_fingerprint_sha256 === manifest.content_fingerprint_sha256,
      JSON.stringify(latch)
    )
    check('warning_called_once_for_failure_event', warningCalls === 1, String(warningCalls))

    let fetchCalls = 0
    const originalFetch = global.fetch
    global.fetch = async () => {
      fetchCalls += 1
      throw new Error('network_must_not_be_called')
    }
    let pauseBlocked = false
    try {
      await sendManyChatDebugWarning({
        releaseManifest: manifest,
        failureSummary: 'forced',
        env: {
          ...env,
          SCV_PAUSE_ALL: '1',
          MANYCHAT_API_KEY: 'fake',
          SCV_FAST_TARGET_CONTACT_IDS: '1537753982'
        }
      })
    } catch (error) {
      pauseBlocked = String(error?.message || error) === 'manychat_warning_blocked_by_pause_gate'
    } finally {
      global.fetch = originalFetch
    }
    check('pause_blocks_manychat_warning', pauseBlocked, String(pauseBlocked))
    check('pause_blocks_warning_before_network', fetchCalls === 0, String(fetchCalls))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  return {
    ok: failures.length === 0,
    locked: failures.length === 0,
    version: SCV_GOLDEN_SYNTHETIC_HARNESS_VERSION,
    checked,
    failures,
    network: false,
    production_mutation: false
  }
}

if (require.main === module) {
  runHarness()
    .then((receipt) => {
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
      if (!receipt.ok) process.exit(1)
    })
    .catch((error) => {
      process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`)
      process.exit(1)
    })
}

module.exports = {
  SCV_GOLDEN_SYNTHETIC_HARNESS_VERSION,
  runScvGoldenSyntheticHarness: runHarness,
  runHarness
}
