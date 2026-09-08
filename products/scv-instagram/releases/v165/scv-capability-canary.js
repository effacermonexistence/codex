#!/usr/bin/env node
'use strict'

// Real provider canary for the three external model surfaces used by the
// Instagram runtime. A production cycle retries three times, persists a
// machine-readable status on the namespaced volume, and permanently
// fail-closes automatic replies if every attempt fails. The latch requires an
// explicit operator recovery; a provider regression can never silently degrade
// the conversation lane.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  transcribeInboundAudio,
  describeImageBuffer
} = require(path.join(__dirname, 'codex-dm-runner.js'))
const { activateFailClose } = require(path.join(__dirname, 'scv-golden-fail-close.js'))

const SCV_CAPABILITY_CANARY_SCHEMA = 'scv-capability-canary-2026-08-31-v2-fail-close'
const ROOT = process.env.SCV_ROOT || __dirname
const STATUS_FILE = path.join(ROOT, 'logs', 'capability-canary-status.json')
const CANARY_ENABLED = String(process.env.SCV_CAPABILITY_CANARY || '1').trim() !== '0'
const CANARY_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.SCV_CAPABILITY_CANARY_INTERVAL_MS || 60 * 60 * 1000)
)
const CANARY_ATTEMPTS = Math.max(
  1,
  Math.min(5, Number(process.env.SCV_CAPABILITY_CANARY_ATTEMPTS || 3))
)
const RETRY_DELAYS_MS = [0, 5_000, 20_000, 45_000, 90_000]
const VOICE_FIXTURE = path.join(__dirname, 'canary-voice.m4a')
const IMAGE_FIXTURE = path.join(__dirname, 'canary-image.png')

function isProduction(env = process.env) {
  return String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production' ||
    String(env.SCV_RELEASE_MODE || '').trim().toLowerCase() === 'production'
}

function safeError(value) {
  return String(value?.message || value || '')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 240)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function responseOutputText(response = {}) {
  if (typeof response.output_text === 'string') return response.output_text
  const chunks = []
  for (const item of Array.isArray(response.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === 'string') chunks.push(content.text)
      if (typeof content?.output_text === 'string') chunks.push(content.output_text)
    }
  }
  return chunks.join('\n')
}

async function checkVisibleModelIdentity(options = {}) {
  const expected = String(process.env.OPENAI_DM_MODEL || '').trim()
  if (!expected || !process.env.OPENAI_API_KEY) {
    return { ok: false, provider_model: '', error: 'visible_model_identity_prerequisite_missing' }
  }
  const fetchImpl = options.fetchImpl || fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${String(process.env.OPENAI_API_KEY || '').trim()}`
      },
      body: JSON.stringify({
        model: expected,
        instructions: 'This is a read-only availability check. Reply with the single word OK.',
        input: 'Reply OK.',
        reasoning: {
          effort: String(process.env.OPENAI_RESPONSES_REASONING_EFFORT || 'medium')
        },
        max_output_tokens: 256,
        store: false,
        parallel_tool_calls: false
      })
    })
    const raw = await response.text()
    let body = null
    try { body = JSON.parse(raw) } catch {}
    const providerModel = String(body?.model || '')
    const output = responseOutputText(body || {})
    return {
      ok: response.ok === true && providerModel === expected && /\bok\b/i.test(output),
      provider_model: providerModel,
      error: response.ok ? '' : `visible_model_http_${Number(response.status || 0)}`
    }
  } catch (error) {
    return { ok: false, provider_model: '', error: safeError(error) }
  } finally {
    clearTimeout(timer)
  }
}

async function checkOnce(options = {}) {
  const result = {
    type: 'scv_capability_check',
    at: new Date().toISOString(),
    voice_ok: false,
    vision_ok: false,
    visible_model_ok: false,
    provider_model: ''
  }
  try {
    const voiceBuf = fs.readFileSync(VOICE_FIXTURE)
    const transcript = await transcribeInboundAudio(voiceBuf, 'audio/mp4')
    result.voice_ok = /snake|tattoo|test/i.test(String(transcript || ''))
    if (!result.voice_ok) result.voice_error = 'voice_fixture_mismatch'
  } catch (error) {
    result.voice_error = safeError(error)
  }
  try {
    const imageBuf = fs.readFileSync(IMAGE_FIXTURE)
    const description = await describeImageBuffer(imageBuf, 'image/png')
    result.vision_ok = /snake|text|letter|word/i.test(String(description || ''))
    if (!result.vision_ok) result.vision_error = 'vision_fixture_mismatch'
  } catch (error) {
    result.vision_error = safeError(error)
  }
  const visible = await checkVisibleModelIdentity(options)
  result.visible_model_ok = visible.ok === true
  result.provider_model = String(visible.provider_model || '')
  if (!visible.ok) result.visible_model_error = safeError(visible.error)

  if (options.silent !== true) console.log(JSON.stringify(result))
  return result
}

function resultOk(result = {}) {
  return result.voice_ok === true &&
    result.vision_ok === true &&
    result.visible_model_ok === true
}

function attemptReceipt(result = {}, attempt) {
  return {
    attempt,
    ok: resultOk(result),
    voice_ok: result.voice_ok === true,
    vision_ok: result.vision_ok === true,
    visible_model_ok: result.visible_model_ok === true,
    provider_model: String(result.provider_model || ''),
    errors: [
      result.voice_error,
      result.vision_error,
      result.visible_model_error
    ].filter(Boolean).map(safeError)
  }
}

function atomicWriteStatus(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  const bytes = `${JSON.stringify(value, null, 2)}\n`
  fs.writeFileSync(temporary, bytes, { mode: 0o600 })
  const fd = fs.openSync(temporary, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(temporary, file)
  const directoryFd = fs.openSync(path.dirname(file), 'r')
  try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
}

async function runCanaryCycle({
  checkImpl = checkOnce,
  sleepImpl = sleep,
  activateFn = activateFailClose,
  env = process.env,
  root = env.SCV_ROOT || ROOT,
  attempts = CANARY_ATTEMPTS,
  now = () => new Date()
} = {}) {
  const receipts = []
  let last = null
  const boundedAttempts = Math.max(1, Math.min(5, Number(attempts) || CANARY_ATTEMPTS))
  for (let index = 0; index < boundedAttempts; index += 1) {
    const delay = RETRY_DELAYS_MS[index] || 0
    if (delay > 0) await sleepImpl(delay)
    try {
      last = await checkImpl({ silent: true })
    } catch (error) {
      last = {
        voice_ok: false,
        vision_ok: false,
        visible_model_ok: false,
        visible_model_error: safeError(error)
      }
    }
    receipts.push(attemptReceipt(last, index + 1))
    if (resultOk(last)) break
  }

  const checkedAt = now().toISOString()
  const ok = resultOk(last)
  const status = {
    schema: SCV_CAPABILITY_CANARY_SCHEMA,
    ok,
    enabled: true,
    checked_at_utc: checkedAt,
    next_due_at_utc: new Date(Date.parse(checkedAt) + CANARY_INTERVAL_MS).toISOString(),
    release_id: String(env.SCV_RELEASE_ID || ''),
    content_fingerprint_sha256: String(env.SCV_CONTENT_FINGERPRINT || ''),
    expected_visible_model: String(env.OPENAI_DM_MODEL || ''),
    provider_model: String(last?.provider_model || ''),
    voice_ok: last?.voice_ok === true,
    vision_ok: last?.vision_ok === true,
    visible_model_ok: last?.visible_model_ok === true,
    attempt_count: receipts.length,
    attempts: receipts,
    fail_close_required: !ok && isProduction(env)
  }
  atomicWriteStatus(path.join(root, 'logs', 'capability-canary-status.json'), status)

  let failClose = null
  if (!ok && isProduction(env)) {
    failClose = activateFn({
      env,
      root,
      releaseId: String(env.SCV_RELEASE_ID || ''),
      releaseFingerprint: String(env.SCV_CONTENT_FINGERPRINT || ''),
      reason: 'capability_canary_failed',
      failedChecks: [
        status.voice_ok ? '' : 'voice_transcription',
        status.vision_ok ? '' : 'vision_description',
        status.visible_model_ok ? '' : 'visible_model_identity'
      ].filter(Boolean),
      detail: { attempts: receipts }
    })
  }
  return { ...status, fail_close_activated: failClose?.state?.active === true }
}

async function main() {
  if (!CANARY_ENABLED) {
    const status = {
      schema: SCV_CAPABILITY_CANARY_SCHEMA,
      ok: false,
      enabled: false,
      checked_at_utc: new Date().toISOString(),
      reason: 'capability_canary_disabled',
      fail_close_required: isProduction(process.env)
    }
    atomicWriteStatus(STATUS_FILE, status)
    if (isProduction(process.env)) {
      activateFailClose({
        releaseId: String(process.env.SCV_RELEASE_ID || ''),
        releaseFingerprint: String(process.env.SCV_CONTENT_FINGERPRINT || ''),
        reason: 'capability_canary_disabled',
        failedChecks: ['capability_canary_disabled']
      })
    }
    console.error(JSON.stringify(status))
  } else {
    const run = async () => {
      const status = await runCanaryCycle()
      const method = status.ok ? 'log' : 'error'
      console[method](JSON.stringify({
        type: status.ok ? 'scv_capability_check' : 'SCV_CAPABILITY_ALERT',
        ...status
      }))
    }
    await run()
    if (process.argv.includes('--loop')) {
      const timer = setInterval(() => {
        run().catch((error) => console.error(JSON.stringify({
          type: 'SCV_CAPABILITY_ALERT',
          error: safeError(error)
        })))
      }, CANARY_INTERVAL_MS)
      if (typeof timer.unref === 'function') timer.unref()
      setInterval(() => {}, 1 << 30)
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: safeError(error) }))
    process.exit(1)
  })
}

module.exports = {
  SCV_CAPABILITY_CANARY_SCHEMA,
  STATUS_FILE,
  CANARY_INTERVAL_MS,
  CANARY_ATTEMPTS,
  checkVisibleModelIdentity,
  checkOnce,
  resultOk,
  atomicWriteStatus,
  runCanaryCycle
}
