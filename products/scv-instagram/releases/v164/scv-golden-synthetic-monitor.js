#!/usr/bin/env node
// Silent background synthetic monitor for the immutable production release.
//
// Success is silent. A repeated failure atomically latches the persistent global
// pause, preserves the running golden artifact, and attempts exactly one warning.
const fs = require('fs')
const path = require('path')
const tls = require('tls')
const {
  runGoldenReleaseVerification
} = require(path.join(__dirname, 'scv-golden-release.js'))
const {
  runScvBookingPolicyHarness
} = require(path.join(__dirname, 'scv-booking-policy-harness.js'))
const {
  readFailClose,
  activateFailClose,
  claimSingleAlertAttempt,
  completeSingleAlertAttempt,
  alertTerminal,
  safeDetail
} = require(path.join(__dirname, 'scv-golden-fail-close.js'))
const { isPausedForPacket } = require(path.join(__dirname, 'scv-pause-gate.js'))

const SCV_GOLDEN_SYNTHETIC_VERSION = 'scv-golden-synthetic-monitor-2026-07-25-v1'
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_RETRY_DELAYS_MS = [0, 5000, 20000]
let monitorStarted = false
let monitorTimer = null
let monitorRunning = false

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function retryCheck(name, check, {
  delays = DEFAULT_RETRY_DELAYS_MS,
  sleepImpl = sleep
} = {}) {
  const attempts = []
  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await sleepImpl(delays[index])
    try {
      const value = await check()
      const ok = value === true || value?.ok === true
      attempts.push({ attempt: index + 1, ok, reason: String(value?.reason || '') })
      if (ok) return { name, ok: true, attempts }
    } catch (error) {
      attempts.push({
        attempt: index + 1,
        ok: false,
        reason: String(error && error.message ? error.message : error).slice(0, 300)
      })
    }
  }
  return { name, ok: false, attempts }
}

function releaseIntegrityCheck(releaseManifest) {
  const receipt = runGoldenReleaseVerification({
    root: __dirname,
    env: process.env,
    verifyEnvironmentValues: false,
    verifyRailway: false,
    verifyFiles: true,
    verifyStaging: false
  })
  return {
    ok: receipt.ok &&
      receipt.release_id === releaseManifest.release_id &&
      receipt.content_fingerprint_sha256 === releaseManifest.content_fingerprint_sha256,
    reason: receipt.failures.join(',')
  }
}

function bookingPolicyCheck() {
  const receipt = runScvBookingPolicyHarness()
  return {
    ok: receipt.ok === true &&
      receipt.golden_cases >= 64 &&
      receipt.policy_fingerprint === '92dc927073042e8ee255acd70ab2a8f70b350b56ce03cb880a32fa5509e27d2d',
    reason: receipt.ok ? '' : (receipt.failures || []).map((entry) => entry.name).slice(0, 10).join(',')
  }
}

async function openAiModelIdentityCheck(releaseManifest, options = {}) {
  const {
    extractResponsesOutputText
  } = require(path.join(__dirname, 'scv-openai-conversation.js'))
  const expected = String(releaseManifest.models.chat || '')
  const responsesRequired = releaseManifest?.models?.visible_reply_api === 'responses_v1'
  if (!responsesRequired) {
    return { ok: false, reason: 'synthetic_responses_api_manifest_pin_missing' }
  }
  if (!String(process.env.OPENAI_API_KEY || '').trim()) {
    return { ok: false, reason: 'openai_api_key_missing' }
  }
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs || 45000)))
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
      instructions: 'This is a read-only release identity check. Return only the requested JSON object.',
      input: [{ role: 'user', content: 'Return {"ok":true}.' }],
      reasoning: {
        effort: String(releaseManifest.models.visible_reply_reasoning_effort || 'medium'),
        context: String(releaseManifest.models.visible_reply_reasoning_context || 'all_turns')
      },
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'scv_release_model_identity',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: { ok: { type: 'boolean', const: true } },
            required: ['ok']
          }
        }
      },
      max_output_tokens: 256,
      store: false,
      parallel_tool_calls: false
      })
    })
    const raw = await response.text()
    let result = null
    try { result = JSON.parse(raw) } catch {}
    let parsed = null
    try { parsed = JSON.parse(extractResponsesOutputText(result || {})) } catch {}
    const providerModel = String(result?.model || '')
    return {
      ok: response.ok === true &&
        providerModel === expected &&
        parsed?.ok === true,
      reason: response.ok === true
        ? `provider_model=${providerModel || 'missing'}`
        : `responses_http_${Number(response.status || 0)}`
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function capabilityCheck() {
  const { checkOnce } = require(path.join(__dirname, 'scv-capability-canary.js'))
  const result = await checkOnce({ silent: true })
  return {
    ok: result.voice_ok === true && result.vision_ok === true,
    reason: [
      result.voice_ok ? '' : `voice:${result.voice_error || 'fixture_mismatch'}`,
      result.vision_ok ? '' : `vision:${result.vision_error || 'fixture_mismatch'}`
    ].filter(Boolean).join(',')
  }
}

async function manyChatReadOnlyCheck() {
  const contactId = String(process.env.SCV_FAST_TARGET_CONTACT_IDS || process.env.SCV_PURGE_TEST_CONTACT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .find((value) => /^\d+$/.test(value))
  if (!process.env.MANYCHAT_API_KEY || !contactId) {
    return { ok: false, reason: 'manychat_read_only_credentials_or_debug_id_missing' }
  }
  const {
    getSubscriberInfo
  } = require(path.join(__dirname, 'scv-manychat-orphan-recovery.js'))
  const info = await getSubscriberInfo(contactId)
  const returnedId = String(info?.id || info?.subscriber_id || '')
  return {
    ok: returnedId === contactId,
    reason: returnedId === contactId ? '' : 'manychat_debug_subscriber_identity_mismatch'
  }
}

async function gmailReadOnlyCheck() {
  const user = String(process.env.GMAIL_IMAP_USER || '').trim()
  const pass = String(process.env.GMAIL_IMAP_APP_PASSWORD || '').replace(/\s+/g, '')
  if (!user || !pass) return { ok: false, reason: 'gmail_credentials_missing' }
  const { ImapFlow } = require('imapflow')
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false
  })
  await client.connect()
  await client.logout().catch(() => {})
  return { ok: true }
}

async function runSyntheticSuite({
  mode = 'production',
  releaseManifest,
  delays = DEFAULT_RETRY_DELAYS_MS,
  sleepImpl = sleep,
  checks = {},
  includeExternalReadOnly = mode === 'production'
} = {}) {
  const selected = {
    release_integrity: checks.release_integrity || (() => releaseIntegrityCheck(releaseManifest)),
    booking_policy: checks.booking_policy || bookingPolicyCheck,
    openai_model_identity: checks.openai_model_identity || (() => openAiModelIdentityCheck(releaseManifest)),
    voice_vision_capability: checks.voice_vision_capability || capabilityCheck
  }
  if (includeExternalReadOnly) {
    selected.manychat_read_only = checks.manychat_read_only || manyChatReadOnlyCheck
    selected.gmail_read_only = checks.gmail_read_only || gmailReadOnlyCheck
  }
  const results = []
  for (const [name, check] of Object.entries(selected)) {
    results.push(await retryCheck(name, check, { delays, sleepImpl }))
  }
  return {
    ok: results.every((result) => result.ok),
    version: SCV_GOLDEN_SYNTHETIC_VERSION,
    checked_at_utc: new Date().toISOString(),
    mode,
    results
  }
}

function smtpReplyReader(socket) {
  let buffer = ''
  const waiters = []
  const drain = () => {
    while (waiters.length > 0) {
      const lines = buffer.split(/\r?\n/)
      let terminalIndex = -1
      for (let index = 0; index < lines.length - 1; index += 1) {
        if (/^\d{3} /.test(lines[index])) terminalIndex = index
      }
      if (terminalIndex < 0) break
      const consumed = lines.slice(0, terminalIndex + 1).join('\r\n')
      buffer = lines.slice(terminalIndex + 1).join('\r\n')
      const waiter = waiters.shift()
      waiter.resolve(consumed)
    }
  }
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    drain()
  })
  socket.on('error', (error) => {
    while (waiters.length) waiters.shift().reject(error)
  })
  return () => new Promise((resolve, reject) => {
    waiters.push({ resolve, reject })
    drain()
  })
}

function assertSmtp(reply, allowed, stage) {
  const code = Number(String(reply || '').slice(0, 3))
  if (!allowed.includes(code)) throw new Error(`smtp_${stage}_failed_${code || 'unknown'}`)
}

async function sendSmtpWarning({ releaseManifest, failureSummary }) {
  const user = String(process.env.GMAIL_IMAP_USER || '').trim()
  const pass = String(process.env.GMAIL_IMAP_APP_PASSWORD || '').replace(/\s+/g, '')
  if (!user || !pass) throw new Error('smtp_credentials_missing')

  const socket = tls.connect({
    host: 'smtp.gmail.com',
    port: 465,
    servername: 'smtp.gmail.com',
    rejectUnauthorized: true
  })
  const nextReply = smtpReplyReader(socket)
  const command = async (line, allowed, stage) => {
    socket.write(`${line}\r\n`)
    const reply = await nextReply()
    assertSmtp(reply, allowed, stage)
  }
  try {
    assertSmtp(await nextReply(), [220], 'greeting')
    await command('EHLO scv-golden-monitor.local', [250], 'ehlo')
    await command('AUTH LOGIN', [334], 'auth')
    await command(Buffer.from(user).toString('base64'), [334], 'username')
    await command(Buffer.from(pass).toString('base64'), [235], 'password')
    await command(`MAIL FROM:<${user}>`, [250], 'mail_from')
    await command(`RCPT TO:<${user}>`, [250, 251], 'rcpt_to')
    await command('DATA', [354], 'data')
    const messageId = `<scv-${releaseManifest.release_id}-${releaseManifest.content_fingerprint_sha256.slice(0, 16)}@golden.local>`
    const subject = 'SCV Instagram automation paused: synthetic check failed'
    const body = [
      'The immutable Instagram booking automation stopped new automatic replies.',
      `Release: ${releaseManifest.release_id}`,
      `Fingerprint: ${releaseManifest.content_fingerprint_sha256}`,
      `Failed checks: ${failureSummary}`,
      'The current golden artifact was preserved. No redeploy, restart, or partial patch was performed.'
    ].join('\r\n')
    socket.write([
      `From: ${user}`,
      `To: ${user}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      body,
      '.'
    ].join('\r\n') + '\r\n')
    assertSmtp(await nextReply(), [250], 'message')
    await command('QUIT', [221], 'quit')
    return { ok: true, channel: 'gmail_smtp' }
  } finally {
    socket.end()
  }
}

async function sendManyChatDebugWarning({ releaseManifest, failureSummary, env = process.env }) {
  const key = String(env.MANYCHAT_API_KEY || '')
  const contactId = String(env.SCV_FAST_TARGET_CONTACT_IDS || env.SCV_PURGE_TEST_CONTACT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .find((value) => /^\d+$/.test(value))
  if (!key || !contactId) throw new Error('manychat_warning_credentials_or_debug_id_missing')
  if (isPausedForPacket({ contact_id: contactId, instagram_username: 'omar.system' }, env)) {
    throw new Error('manychat_warning_blocked_by_pause_gate')
  }
  const text = [
    'SCV automation paused itself after a synthetic check failed.',
    `Release: ${releaseManifest.release_id}`,
    `Failed: ${failureSummary}`,
    'Golden release preserved. No customer auto-replies are being sent.'
  ].join('\n')
  const response = await fetch('https://api.manychat.com/fb/sending/sendContent', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      subscriber_id: Number(contactId),
      data: {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text }]
        }
      }
    })
  })
  if (!response.ok) throw new Error(`manychat_warning_http_${response.status}`)
  return { ok: true, channel: 'manychat_debug_account' }
}

async function sendSingleWarning({
  releaseManifest,
  suite,
  env = process.env,
  root = env.SCV_ROOT || __dirname
} = {}) {
  const options = { env, root }
  const claim = claimSingleAlertAttempt(options)
  if (!claim.claimed) {
    return {
      ok: false,
      skipped: true,
      reason: claim.reason,
      retry_after_ms: Number(claim.retry_after_ms || 0)
    }
  }
  const failureSummary = suite.results
    .filter((result) => !result.ok)
    .map((result) => result.name)
    .join(', ')
    .slice(0, 500)
  try {
    const email = await sendSmtpWarning({ releaseManifest, failureSummary })
    completeSingleAlertAttempt({
      ...options,
      claimId: claim.claim_id,
      delivered: true,
      channel: email.channel
    })
    return { ...email, claim_id: claim.claim_id }
  } catch (emailError) {
    try {
      const manychat = await sendManyChatDebugWarning({ releaseManifest, failureSummary, env })
      completeSingleAlertAttempt({
        ...options,
        claimId: claim.claim_id,
        delivered: true,
        channel: manychat.channel
      })
      return { ...manychat, claim_id: claim.claim_id }
    } catch (manychatError) {
      const error = `email=${String(emailError?.message || emailError)};manychat=${String(manychatError?.message || manychatError)}`
      completeSingleAlertAttempt({
        ...options,
        claimId: claim.claim_id,
        delivered: false,
        channel: '',
        error
      })
      return { ok: false, error: safeDetail(error), claim_id: claim.claim_id }
    }
  }
}

async function runAndEnforce({
  mode = 'production',
  releaseManifest,
  delays = DEFAULT_RETRY_DELAYS_MS,
  sleepImpl = sleep,
  checks = {},
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  warningSender = sendSingleWarning,
  includeExternalReadOnly = mode === 'production'
} = {}) {
  const suite = await runSyntheticSuite({
    mode,
    releaseManifest,
    delays,
    sleepImpl,
    checks,
    includeExternalReadOnly
  })
  if (suite.ok) return suite
  if (mode !== 'production') {
    console.error(JSON.stringify({
      event: 'scv_golden_staging_synthetic_failed',
      release_id: releaseManifest.release_id,
      failed_checks: suite.results.filter((result) => !result.ok).map((result) => result.name)
    }))
    return suite
  }

  const failedChecks = suite.results.filter((result) => !result.ok).map((result) => result.name)
  const latch = activateFailClose({
    env,
    root,
    releaseId: releaseManifest.release_id,
    releaseFingerprint: releaseManifest.content_fingerprint_sha256,
    reason: 'golden_synthetic_check_failed',
    failedChecks,
    detail: suite.results.filter((result) => !result.ok)
  })
  console.error(JSON.stringify({
    event: 'scv_golden_synthetic_fail_closed',
    release_id: releaseManifest.release_id,
    failed_checks: failedChecks,
    latch_created: latch.created
  }))
  await warningSender({ releaseManifest, suite, env, root })
  return suite
}

function persistedFailureSuite(existingFailClose) {
  const names = Array.isArray(existingFailClose.failed_checks) &&
    existingFailClose.failed_checks.length
    ? existingFailClose.failed_checks
    : ['persisted_fail_close']
  return {
    results: names.map((name) => ({
      name,
      ok: false,
      attempts: [{
        attempt: 1,
        ok: false,
        reason: existingFailClose.reason || 'persisted_fail_close'
      }]
    }))
  }
}

function schedulePersistedWarningRecovery({
  releaseManifest,
  existingFailClose,
  env = process.env,
  root = env.SCV_ROOT || __dirname,
  initialDelayMs = 1000
} = {}) {
  if (alertTerminal(existingFailClose)) {
    return { scheduled: false, reason: 'alert_terminal' }
  }
  const attempt = async () => {
    const result = await sendSingleWarning({
      releaseManifest,
      suite: persistedFailureSuite(readFailClose({ env, root })),
      env,
      root
    }).catch(() => ({ ok: false, skipped: true, reason: 'alert_recovery_crashed' }))
    if (result.skipped && result.reason === 'alert_attempt_in_progress') {
      const timer = setTimeout(attempt, Math.max(1000, Number(result.retry_after_ms || 1000) + 250))
      if (typeof timer.unref === 'function') timer.unref()
    }
  }
  const timer = setTimeout(attempt, Math.max(0, initialDelayMs))
  if (typeof timer.unref === 'function') timer.unref()
  return { scheduled: true }
}

function startSyntheticMonitor({
  mode = 'production',
  releaseManifest,
  initialGatePassed = false
} = {}) {
  if (monitorStarted || mode === 'local') return { started: false, reason: monitorStarted ? 'already_started' : 'local_mode' }
  monitorStarted = true
  const existingFailClose = readFailClose()
  if (existingFailClose.active) {
    if (mode === 'production') {
      schedulePersistedWarningRecovery({ releaseManifest, existingFailClose })
    }
    return { started: false, reason: 'already_fail_closed' }
  }

  const run = async () => {
    if (monitorRunning) return
    monitorRunning = true
    try {
      await runAndEnforce({ mode, releaseManifest })
    } catch (error) {
      const detail = String(error && error.message ? error.message : error).slice(0, 500)
      console.error(JSON.stringify({
        event: 'scv_golden_synthetic_monitor_crashed',
        error: detail
      }))
      if (mode === 'production') {
        activateFailClose({
          releaseId: releaseManifest.release_id,
          releaseFingerprint: releaseManifest.content_fingerprint_sha256,
          reason: 'golden_synthetic_monitor_crashed',
          failedChecks: ['synthetic_monitor_runtime'],
          detail
        })
        await sendSingleWarning({
          releaseManifest,
          suite: {
            results: [{
              name: 'synthetic_monitor_runtime',
              ok: false,
              attempts: [{ attempt: 1, ok: false, reason: detail }]
            }]
          }
        })
      }
    } finally {
      monitorRunning = false
    }
  }
  if (!initialGatePassed) {
    const initialDelayMs = mode === 'production' ? 15000 : 3000
    const initialTimer = setTimeout(run, initialDelayMs)
    if (typeof initialTimer.unref === 'function') initialTimer.unref()
  }
  if (mode === 'production') {
    monitorTimer = setInterval(run, DEFAULT_INTERVAL_MS)
    if (typeof monitorTimer.unref === 'function') monitorTimer.unref()
  }
  return {
    started: true,
    mode,
    initial_gate_passed: initialGatePassed === true,
    interval_ms: mode === 'production' ? DEFAULT_INTERVAL_MS : 0
  }
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'SCV_GOLDEN_PRODUCTION_RELEASE.json'), 'utf8'))
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))
  const mode = modeArg ? modeArg.split('=')[1] : 'staging'
  const includeExternalReadOnly = process.argv.includes('--full-read-only') ||
    mode === 'production'
  const suite = await runAndEnforce({
    mode,
    releaseManifest: manifest,
    includeExternalReadOnly
  })
  process.stdout.write(`${JSON.stringify(suite, null, 2)}\n`)
  if (!suite.ok) process.exit(1)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }))
    process.exit(1)
  })
}

module.exports = {
  SCV_GOLDEN_SYNTHETIC_VERSION,
  DEFAULT_INTERVAL_MS,
  DEFAULT_RETRY_DELAYS_MS,
  retryCheck,
  releaseIntegrityCheck,
  bookingPolicyCheck,
  openAiModelIdentityCheck,
  capabilityCheck,
  manyChatReadOnlyCheck,
  gmailReadOnlyCheck,
  runSyntheticSuite,
  sendSmtpWarning,
  sendManyChatDebugWarning,
  sendSingleWarning,
  runAndEnforce,
  persistedFailureSuite,
  schedulePersistedWarningRecovery,
  startSyntheticMonitor
}
