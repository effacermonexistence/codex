#!/usr/bin/env node
// ============================================================
// SCV OPENAI UPSTREAM RESILIENCE HARNESS
//
// Network-free executed-path proof for the provider failure family that delayed
// Omar.system's "Sorry imean the girl" correction:
//   500 / 503 / concurrency / connection failures
//     -> bounded jittered executor retry
//     -> typed upstream exhaustion
//     -> no semantic reauthor amplification
//     -> short bounded inbox retry rather than a five-minute outage backoff.
//
// Fake fetch responses only. No OpenAI, ManyChat, Instagram, or live-state calls.
// ============================================================
const fs = require('fs')
const os = require('os')
const path = require('path')

const SCV_OPENAI_RESILIENCE_HARNESS_VERSION =
  'scv-openai-resilience-harness-2026-07-25-v2-model-pin-error-separation'
const HARNESS_MODEL_ID = 'gpt-4.1-mini-2025-04-14'

const sourceRoot = __dirname
const harnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-openai-resilience-'))
process.env.SCV_ROOT = harnessRoot

for (const rel of [
  'prompt-authority/OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED.txt',
  'prompt-authority/TALEK_LUA_SELF_IDENTITY_CORE_PROMPT.txt',
  'lua-dm-master-prompt-v17.txt'
]) {
  const source = path.join(sourceRoot, rel)
  const dest = path.join(harnessRoot, rel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(source, dest)
}

const {
  runOpenAI,
  isTransientCodexError,
  computeOpenAIRetryDelayMs,
  retryAfterMsFromResponse
} = require(path.join(__dirname, 'codex-dm-runner.js'))
const {
  executeSingleControlTurn
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  isTransientRunnerError,
  nextRetryDelayMs,
  retryDelayForError
} = require(path.join(__dirname, 'inbox-worker.js'))

function fakeResponse(status, body, headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)])
  )
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalized[String(name || '').toLowerCase()] || null
      }
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body)
    }
  }
}

function successResponse(content = '{"ok":true}') {
  return fakeResponse(200, {
    model: HARNESS_MODEL_ID,
    choices: [{ message: { content } }]
  })
}

function sequenceFetch(sequence, calls) {
  let index = 0
  return async function fakeFetch(url, options) {
    calls.push({
      url: String(url || ''),
      method: String(options?.method || ''),
      authorization_present: /^Bearer\s+\S+/.test(String(options?.headers?.authorization || ''))
    })
    const item = sequence[Math.min(index, sequence.length - 1)]
    index += 1
    if (item instanceof Error) throw item
    return item
  }
}

async function runScvOpenAIResilienceHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({
      name,
      detail: typeof detail === 'string' ? detail : JSON.stringify(detail)
    })
  }

  try {
    const transientMatrix = [
      'openai_http_500:server had an error',
      'openai_http_502:bad gateway',
      'openai_http_503:Too many concurrent requests',
      'openai_http_504:gateway timeout',
      'upstream connect error or disconnect/reset before headers',
      'fetch failed ECONNRESET',
      'The operation was aborted'
    ]
    check(
      'transient_provider_matrix_is_recognized',
      transientMatrix.every((text) => isTransientCodexError(text)),
      transientMatrix.filter((text) => !isTransientCodexError(text))
    )
    check(
      'quota_exhaustion_is_not_blindly_retried',
      isTransientCodexError('openai_http_429 insufficient_quota exceeded your current quota') === false
    )
    check(
      'rate_limit_is_retryable',
      isTransientCodexError('openai_http_429 rate limit reached') === true
    )

    const calls1 = []
    const sleeps1 = []
    const recovered = await runOpenAI('return json', HARNESS_MODEL_ID, 30000, 0, {
      apiKey: 'harness-only-key',
      enforceModelIdentity: true,
      fetchImpl: sequenceFetch([
        fakeResponse(503, { error: { message: 'Too many concurrent requests', type: 'server_error' } }),
        fakeResponse(500, { error: { message: 'The server had an error', type: 'server_error' } }),
        successResponse()
      ], calls1),
      sleepImpl: async (ms) => { sleeps1.push(ms) },
      randomImpl: () => 0.5,
      maxAttempts: 4,
      retryBaseMs: 100,
      retryMaxMs: 1000,
      perAttemptTimeoutMs: 5000
    })
    check(
      '503_then_500_recovers_before_return',
      recovered.status === 0 && recovered.lastMessage === '{"ok":true}' &&
        calls1.length === 3 && recovered.attempts.length === 3,
      recovered
    )
    check(
      'provider_retry_uses_bounded_exponential_wait',
      JSON.stringify(sleeps1) === JSON.stringify([100, 200]),
      sleeps1
    )
    check(
      'provider_retry_keeps_authorization_and_post_shape',
      calls1.every((call) =>
        call.url === 'https://api.openai.com/v1/chat/completions' &&
        call.method === 'POST' &&
        call.authorization_present === true
      ),
      calls1
    )

    const calls2 = []
    const exhausted = await runOpenAI('return json', HARNESS_MODEL_ID, 30000, 0, {
      apiKey: 'harness-only-key',
      enforceModelIdentity: true,
      fetchImpl: sequenceFetch([
        fakeResponse(503, { error: { message: 'Too many concurrent requests' } })
      ], calls2),
      sleepImpl: async () => {},
      randomImpl: () => 0.5,
      maxAttempts: 4,
      retryBaseMs: 1,
      retryMaxMs: 4,
      perAttemptTimeoutMs: 5000
    })
    check(
      'transient_exhaustion_is_typed_after_exact_budget',
      exhausted.status !== 0 &&
        calls2.length === 4 &&
        exhausted.attempts.length === 4 &&
        exhausted.attempts.every((attempt) => attempt.transient === true) &&
        String(exhausted.error).startsWith('openai_upstream_transient_exhausted:'),
      exhausted
    )

    const calls3 = []
    const permanent = await runOpenAI('return json', HARNESS_MODEL_ID, 30000, 0, {
      apiKey: 'harness-only-key',
      enforceModelIdentity: true,
      fetchImpl: sequenceFetch([
        fakeResponse(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } })
      ], calls3),
      sleepImpl: async () => { throw new Error('non_transient_must_not_sleep') },
      maxAttempts: 4
    })
    check(
      'nontransient_auth_error_does_not_retry',
      permanent.status === 401 && calls3.length === 1 &&
        permanent.attempts.length === 1 && permanent.attempts[0].transient === false,
      permanent
    )

    const calls4 = []
    const networkRecovered = await runOpenAI('return json', HARNESS_MODEL_ID, 30000, 0, {
      apiKey: 'harness-only-key',
      enforceModelIdentity: true,
      fetchImpl: sequenceFetch([
        new TypeError('fetch failed: ECONNRESET'),
        successResponse()
      ], calls4),
      sleepImpl: async () => {},
      randomImpl: () => 0.5,
      maxAttempts: 3,
      retryBaseMs: 1,
      retryMaxMs: 3,
      perAttemptTimeoutMs: 5000
    })
    check(
      'network_reset_recovers_inside_executor',
      networkRecovered.status === 0 && calls4.length === 2 &&
        networkRecovered.attempts[0].transient === true,
      networkRecovered
    )

    const retryAfterResponse = fakeResponse(503, {}, { 'retry-after': '2' })
    check(
      'retry_after_seconds_is_honored',
      retryAfterMsFromResponse(retryAfterResponse, 0) === 2000 &&
        computeOpenAIRetryDelayMs(1, 2000, {
          retryBaseMs: 100,
          retryMaxMs: 5000,
          randomImpl: () => 0
        }) === 2000
    )

    let semanticCalls = 0
    let typedControllerError = ''
    try {
      executeSingleControlTurn({
        contact_id: 'provider-test-contact',
        thread_id: 'provider-test-thread',
        message_id: 'provider-test-message',
        instagram_username: 'provider.test',
        text: 'Sorry imean the girl',
        received_at: new Date().toISOString()
      }, {
        root: harnessRoot,
        recent_history_override: [{
          role: 'user',
          message_id: 'provider-test-image',
          text: 'sent a reference post: a portrait photo of a girl'
        }],
        max_control_reauthor_passes: 3,
        candidateGenerator() {
          semanticCalls += 1
          throw new Error(
            'codex_runner_failed_1 :: Error: codex_exec_failed_503 :: openai_upstream_transient_exhausted:openai_http_503:Too many concurrent requests'
          )
        }
      })
    } catch (err) {
      typedControllerError = String(err?.message || err)
    }
    check(
      'provider_outage_does_not_burn_semantic_reauthor_budget',
      semanticCalls === 1 && typedControllerError.startsWith('single_control_upstream_retryable:'),
      { semanticCalls, typedControllerError }
    )
    check(
      'typed_controller_error_is_transient_to_inbox',
      isTransientRunnerError(typedControllerError) === true,
      typedControllerError
    )

    const upstreamDelay = retryDelayForError(typedControllerError, 8, () => 0.5)
    const ordinaryDelay = nextRetryDelayMs(8, { randomImpl: () => 0.5 })
    check(
      'upstream_queue_backoff_is_capped_at_one_minute',
      upstreamDelay > 0 && upstreamDelay <= 60000,
      upstreamDelay
    )
    check(
      'provider_backoff_is_shorter_than_generic_persistent_backoff',
      upstreamDelay < ordinaryDelay && ordinaryDelay === 300000,
      { upstreamDelay, ordinaryDelay }
    )

    const result = {
      ok: failures.length === 0,
      checked,
      failures,
      lock_version: SCV_OPENAI_RESILIENCE_HARNESS_VERSION,
      proof_mode: 'local_network_free_provider_failure_injection',
      network: false,
      live_actions: false
    }
    if (!result.ok) {
      throw new Error(`scv_openai_resilience_harness_failed:${JSON.stringify(result)}`)
    }
    return result
  } finally {
    try { fs.rmSync(harnessRoot, { recursive: true, force: true }) } catch {}
  }
}

if (require.main === module) {
  runScvOpenAIResilienceHarness()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((err) => {
      console.error(String(err && err.message ? err.message : err))
      process.exit(1)
    })
}

module.exports = {
  SCV_OPENAI_RESILIENCE_HARNESS_VERSION,
  runScvOpenAIResilienceHarness
}
