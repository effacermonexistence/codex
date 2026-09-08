#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pathToFileURL } = require('url')
const { getInstagramSuppressionForUsername } = require(path.join(__dirname, 'instagram-thread-suppression.js'))
const { isPausedForPacket } = require(path.join(__dirname, 'scv-pause-gate.js'))
const {
  immutableIngressTimeMs,
  recoveryCutoverVerdict,
  recoveryQueueSafetyVerdict
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))
const { recordLearningOutcome } = require(path.join(__dirname, 'dm-learning-sidecar.js'))
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))
const {
  redactedIdentity,
  artifactSha256,
  textMetrics,
  errorMetrics,
  safeEnum
} = require(path.join(__dirname, 'scv-machine-log.js'))

function logIdentity(job) {
  return redactedIdentity(job || {})
}

function logPaths(file, dest) {
  return {
    file_hmac_sha256: artifactSha256(file),
    ...(dest ? { destination_hmac_sha256: artifactSha256(dest) } : {})
  }
}

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env')
  if (!fs.existsSync(envPath)) return

  const raw = fs.readFileSync(envPath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue

    const idx = trimmed.indexOf('=')
    const key = trimmed.slice(0, idx).trim()
    let value = trimmed.slice(idx + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (key && !process.env[key]) {
      process.env[key] = value
    }
  }
}

loadLocalEnv()

const ROOT = process.env.SCV_ROOT || __dirname
const REACTBOX_DIR = path.join(ROOT, 'reactbox')
const DONE_DIR = path.join(ROOT, 'reactbox_done')
const FAILED_DIR = path.join(ROOT, 'reactbox_failed')
const HUMAN_AGENT_DIR = path.join(ROOT, 'outbox_human_agent_required')
const THREAD_STATE_DIR = path.join(ROOT, 'thread-state')
const THREAD_HISTORY_DIR = path.join(ROOT, 'thread-history')
const EMPTY_POLL_MS = 1000
const RETRY_BASE_MS = 15000
const RETRY_MAX_MS = 300000
const MAX_RETRIES = 6
const ACTION_TIMEOUT_MS = 25000
const DM_GATE_POLL_MS = 15000
const DM_GATE_TIMEOUT_MS = 45 * 60 * 1000
const USER_HOME = process.env.HOME || os.homedir()
const IG_CLIENT_PATH = process.env.IG_CLIENT_PATH || path.join(USER_HOME, '.openclaw', 'plugins-src', 'instagram-cli-4llm', 'dist', 'client.js')

function resolveInstagramUsername() {
  const fromEnv = String(process.env.SCV_REACTION_IG_USERNAME || '').trim()
  if (fromEnv) return fromEnv

  const configPath = path.join(USER_HOME, '.instagram-cli', 'config.ts.yaml')
  if (!fs.existsSync(configPath)) return undefined

  const raw = fs.readFileSync(configPath, 'utf8')
  const match = raw.match(/^\s*currentUsername:\s*([^\n]+)\s*$/m)
  if (!match) return undefined

  const username = String(match[1] || '').trim().replace(/^['"]|['"]$/g, '')
  return username || undefined
}

const IG_USERNAME = resolveInstagramUsername()

let activeClient = null

function ensureDirs() {
  fs.mkdirSync(REACTBOX_DIR, { recursive: true })
  fs.mkdirSync(DONE_DIR, { recursive: true })
  fs.mkdirSync(FAILED_DIR, { recursive: true })
  fs.mkdirSync(HUMAN_AGENT_DIR, { recursive: true })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, label, ms = ACTION_TIMEOUT_MS) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer)
  })
}

function safeReadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function safeWriteJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n')
}

function parseDueAt(packet) {
  const parsed = Date.parse(String(packet?.due_at || ''))
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function staleReactionHoldThresholdMs(env = process.env) {
  const parsed = Number(env.SCV_HOLD_STALE_BACKLOG_MS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000
}

function staleReactionLockThresholdMs(env = process.env) {
  const parsed = Number(env.SCV_STALE_LOCK_RECOVERY_MS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 15 * 60 * 1000
}

function reactionRecoverySafetyVerdict(job, file, env = process.env, now = Date.now()) {
  return recoveryQueueSafetyVerdict(
    job,
    env,
    file,
    now,
    staleReactionHoldThresholdMs(env)
  )
}

function holdReactionForHuman(file, job, verdict, meta = {}) {
  ensureDirs()
  const base = path.basename(file).replace(/\.lock$/, '')
  const dest = path.join(HUMAN_AGENT_DIR, `recovery-reaction-hold-${Date.now()}-${base}`)
  safeWriteJson(dest, {
    ...job,
    type: 'recovery_reaction_human_agent_required',
    manual_reason: String(verdict?.reason || 'recovery_queue_safety_hold'),
    human_agent_required: true,
    queued_for_human_agent_at: new Date().toISOString(),
    held_from_reaction_file: base,
    immutable_ingress_timestamp_ms: Number(verdict?.timestamp_ms || 0),
    immutable_ingress_timestamp_source: String(verdict?.source || 'unknown'),
    recovery_cutover_ms: Number(verdict?.cutover_ms || 0),
    stale_backlog_age_ms: verdict?.age_ms,
    stale_backlog_threshold_ms: verdict?.threshold_ms,
    ...meta
  })
  fs.unlinkSync(file)
  return dest
}

function fileAgeMs(file, now = Date.now()) {
  try { return now - fs.statSync(file).mtimeMs } catch { return 0 }
}

function recoverStaleReactionLockFile(file, env = process.env, now = Date.now()) {
  if (!file.endsWith('.json.lock')) return null
  const ageMs = fileAgeMs(file, now)
  const thresholdMs = staleReactionLockThresholdMs(env)
  if (!Number.isFinite(ageMs) || ageMs < thresholdMs) return null

  let job
  try { job = safeReadJson(file) } catch { return null }

  const cutover = recoveryCutoverVerdict(job, env, file, now)
  const dest = holdReactionForHuman(file, job, {
    ...cutover,
    hold: true,
    reason: cutover.hold ? cutover.reason : 'abandoned_reaction_lock_no_blind_retry',
    age_ms: ageMs,
    threshold_ms: thresholdMs
  }, {
    stale_lock_age_ms: ageMs,
    stale_lock_threshold_ms: thresholdMs
  })
  return {
    action: 'human_agent_hold',
    file,
    dest,
    age_ms: ageMs,
    threshold_ms: thresholdMs,
    reason: cutover.hold ? cutover.reason : 'abandoned_reaction_lock_no_blind_retry'
  }
}

function sweepStaleReactionLockFiles({ env = process.env, now = Date.now() } = {}) {
  ensureDirs()
  const held = []
  for (const name of fs.readdirSync(REACTBOX_DIR).filter((entry) => entry.endsWith('.json.lock'))) {
    const result = recoverStaleReactionLockFile(path.join(REACTBOX_DIR, name), env, now)
    if (result) held.push(result)
  }
  if (held.length) {
    console.log(JSON.stringify({
      type: 'reaction_worker_stale_lock_human_agent_hold_batch',
      count: held.length,
      held_hmac_sha256: artifactSha256(JSON.stringify(held))
    }))
  }
  return held
}

function listDueFiles({ env = process.env, now = Date.now() } = {}) {
  ensureDirs()
  sweepStaleReactionLockFiles({ env, now })
  const entries = []

  for (const name of fs.readdirSync(REACTBOX_DIR).filter((entry) => entry.endsWith('.json'))) {
    const file = path.join(REACTBOX_DIR, name)
    try {
      const job = safeReadJson(file)
      const verdict = reactionRecoverySafetyVerdict(job, file, env, now)
      if (verdict.hold) {
        const dest = holdReactionForHuman(file, job, verdict)
        console.log(JSON.stringify({
          type: 'reaction_worker_recovery_human_agent_hold',
          ...logPaths(file, dest),
          ...logIdentity(job),
          reason: verdict.reason,
          timestamp_source: verdict.source,
          age_ms: verdict.age_ms,
          cutover_ms: verdict.cutover_ms
        }))
        continue
      }

      // Live-surgery pause: hold reactions in place.
      if (isPausedForPacket(job, env)) continue
      entries.push({
        file,
        due_at_ms: parseDueAt(job),
        retry_after_ms: Date.parse(String(job?.retry_after || ''))
      })
    } catch {
      entries.push({ file, due_at_ms: Number.POSITIVE_INFINITY, retry_after_ms: Number.POSITIVE_INFINITY })
    }
  }

  return entries
    .filter((entry) => {
      if (Number.isFinite(entry.retry_after_ms) && entry.retry_after_ms > now) return false
      return entry.due_at_ms <= now
    })
    .sort((a, b) => {
      if (a.due_at_ms !== b.due_at_ms) return a.due_at_ms - b.due_at_ms
      return a.file.localeCompare(b.file)
    })
}

function lockPath(file) {
  return `${file}.lock`
}

function tryLock(file) {
  const locked = lockPath(file)
  fs.renameSync(file, locked)
  return locked
}

function releaseReactionLockForPause(lockFile, job, stage = 'final_reaction_recheck') {
  const original = lockFile.replace(/\.lock$/, '')
  if (fs.existsSync(original)) {
    const cutover = recoveryCutoverVerdict(job, process.env, lockFile)
    return holdReactionForHuman(lockFile, job, {
      ...cutover,
      hold: true,
      reason: 'pause_recheck_lock_collision',
      age_ms: Date.now() - immutableIngressTimeMs(job, lockFile),
      threshold_ms: staleReactionHoldThresholdMs(process.env)
    }, { pause_stage: stage })
  }

  fs.renameSync(lockFile, original)
  console.log(JSON.stringify({
    type: 'reaction_worker_pause_recheck_hold',
    ...logPaths(original),
    ...logIdentity(job),
    stage
  }))
  return original
}

function nextRetryDelayMs(attempts) {
  const n = Math.max(1, Number(attempts) || 1)
  const exp = Math.min(RETRY_BASE_MS * (2 ** (n - 1)), RETRY_MAX_MS)
  const jitter = Math.floor(Math.random() * 5000)
  return Math.min(exp + jitter, RETRY_MAX_MS)
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function parseAtMs(value, fallback = 0) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function safeThreadKey(thread_id) {
  return String(thread_id || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function threadStatePath(thread_id) {
  return path.join(THREAD_STATE_DIR, `${safeThreadKey(thread_id)}.json`)
}

function readLatestThreadState(thread_id) {
  const file = threadStatePath(thread_id)
  if (!fs.existsSync(file)) return null

  try {
    return safeReadJson(file)
  } catch {
    return null
  }
}

async function getAutomationSuppression(job) {
  const latest = readLatestThreadState(job.thread_id || job.contact_id)
  const suppressed = !!(latest?.automation_suppressed || job?.automation_suppressed)

  if (suppressed) {
    return {
      suppressed,
      matched_tag: String(latest?.automation_suppressed_tag || job?.automation_suppressed_tag || ''),
      reason: String(latest?.automation_suppressed_reason || job?.automation_suppressed_reason || '')
    }
  }

  const instagramSuppression = await getInstagramSuppressionForUsername(
    latest?.instagram_username || job?.instagram_username
  )

  return {
    suppressed: !!instagramSuppression?.suppressed,
    matched_tag: String(instagramSuppression?.matched_tag || ''),
    reason: String(instagramSuppression?.reason || '')
  }
}

function extractMessageText(message) {
  if (!message || typeof message !== 'object') return ''
  if (typeof message.text === 'string') return message.text
  if (typeof message?.link?.text === 'string') return message.link.text
  return ''
}

function classifyReactionError(errorText) {
  const text = String(errorText || '').toLowerCase()

  if (
    text.includes('reaction_login_failed') ||
    text.includes('real-time client not connected') ||
    text.includes('sendreaction failed') ||
    text.includes('mqtt') ||
    text.includes('network') ||
    text.includes('timeout') ||
    text.includes('temporar') ||
    text.includes('rate limit') ||
    text.includes('overloaded') ||
    text.includes('failed to fetch threads') ||
    text.includes('failed to fetch messages') ||
    text.includes('reaction_target_message_not_found') ||
    text.includes('reaction_thread_lookup_failed') ||
    text.includes('reaction_user_pk_missing')
  ) {
    return 'transient'
  }

  return 'permanent'
}

function findMatchingUserTurn(events, job) {
  const targetMessageId = String(job?.message_id || '').trim()
  const targetText = normalizeText(job?.text || '')
  const receivedAtMs = parseAtMs(job?.received_at || job?.created_at, 0)

  let exact = events.find((event) => (
    event?.role === 'user' &&
    String(event?.message_id || '').trim() === targetMessageId
  ))
  if (exact) return exact

  if (!targetText) return null

  const candidates = events.filter((event) => {
    if (event?.role !== 'user') return false
    if (normalizeText(event?.text || '') !== targetText) return false
    const atMs = parseAtMs(event?.at, 0)
    if (!receivedAtMs || !atMs) return true
    return Math.abs(atMs - receivedAtMs) <= (3 * 60 * 1000)
  })

  if (!candidates.length) return null

  candidates.sort((a, b) => Math.abs(parseAtMs(a?.at, receivedAtMs) - receivedAtMs) - Math.abs(parseAtMs(b?.at, receivedAtMs) - receivedAtMs))
  return candidates[0]
}

function getDmGateStatus(job) {
  const threadId = String(job?.thread_id || job?.contact_id || '').trim()
  const createdAtMs = parseAtMs(job?.created_at || job?.received_at, Date.now())
  const threadFile = path.join(THREAD_HISTORY_DIR, `${threadId}.json`)

  if (!threadId || !fs.existsSync(threadFile)) {
    if (Date.now() - createdAtMs > DM_GATE_TIMEOUT_MS) {
      return { status: 'skip', reason: 'dm_gate_timeout_missing_thread_history' }
    }
    return { status: 'wait', reason: 'awaiting_thread_history' }
  }

  const state = safeReadJson(threadFile) || {}
  const events = Array.isArray(state.events) ? state.events : []
  const userTurn = findMatchingUserTurn(events, job)

  if (!userTurn) {
    if (Date.now() - createdAtMs > DM_GATE_TIMEOUT_MS) {
      return { status: 'skip', reason: 'dm_gate_timeout_missing_user_turn' }
    }
    return { status: 'wait', reason: 'awaiting_user_turn_match' }
  }

  const userAtMs = parseAtMs(userTurn.at, createdAtMs)
  const assistantForTurn = events
    .filter((event) => (
      isConversationVisibleAssistantEvent(event) &&
      String(event?.reply_to_message_id || event?.message_id || '').trim() === String(userTurn?.message_id || '').trim()
    ))
    .sort((a, b) => parseAtMs(a?.at, 0) - parseAtMs(b?.at, 0))

  if (!assistantForTurn.length) {
    const supersededByNewerUser = events.some((event) => (
      event?.role === 'user' &&
      String(event?.message_id || '').trim() !== String(userTurn?.message_id || '').trim() &&
      parseAtMs(event?.at, 0) > userAtMs
    ))
    if (supersededByNewerUser) {
      return { status: 'skip', reason: 'superseded_by_newer_user_turn' }
    }
    if (Date.now() - userAtMs > DM_GATE_TIMEOUT_MS) {
      return { status: 'skip', reason: 'dm_gate_timeout_no_assistant_reply' }
    }
    return { status: 'wait', reason: 'awaiting_first_assistant_reply' }
  }

  const firstAssistantAtMs = parseAtMs(assistantForTurn[0]?.at, Date.now())
  const afterDmLagMs = Math.max(0, Number(job?.reaction_delay_ms || 0))
  const readyAtMs = firstAssistantAtMs + afterDmLagMs

  if (Date.now() < readyAtMs) {
    return {
      status: 'wait',
      reason: 'waiting_post_reply_reaction_lag',
      ready_at_ms: readyAtMs,
      first_assistant_at_ms: firstAssistantAtMs
    }
  }

  return {
    status: 'ready',
    reason: 'assistant_reply_sent',
    ready_at_ms: readyAtMs,
    first_assistant_at_ms: firstAssistantAtMs
  }
}

async function loadInstagramClientClass() {
  const mod = await import(pathToFileURL(IG_CLIENT_PATH).href)
  return mod.InstagramClient
}

async function getClient(forceRefresh = false) {
  if (activeClient && !forceRefresh) return activeClient

  const InstagramClient = await loadInstagramClientClass()
  const client = new InstagramClient(IG_USERNAME)
  const login = await withTimeout(
    client.loginBySession({ initializeRealtime: true }),
    'reaction_login'
  )
  if (!login?.success) {
    throw new Error(`reaction_login_failed_${login?.error || 'unknown'}`)
  }

  activeClient = client
  return activeClient
}

async function resolveThreadAndTarget(job) {
  const client = await getClient(false)
  const hits = await withTimeout(
    client.searchThreadByUsername(String(job.instagram_username || ''), { forceExact: true }),
    'reaction_search_thread'
  )
  if (!Array.isArray(hits) || hits.length === 0) {
    throw new Error('reaction_thread_lookup_failed')
  }

  const userPk = hits[0]?.thread?.users?.[0]?.pk
  if (!userPk) {
    throw new Error('reaction_user_pk_missing')
  }

  const thread = await withTimeout(client.ensureThread(userPk), 'reaction_ensure_thread')
  const messagePage = await withTimeout(client.getMessages(thread.id), 'reaction_get_messages')
  const messages = Array.isArray(messagePage?.messages) ? messagePage.messages : []
  const inbound = messages.filter((message) => !message.isOutgoing)
  const desiredText = normalizeText(job.text)
  const receivedAtMs = Date.parse(String(job.received_at || job.created_at || '')) || 0

  let target = [...inbound].reverse().find((message) => {
    const text = normalizeText(extractMessageText(message))
    if (!text || text !== desiredText) return false
    if (!receivedAtMs) return true
    return Math.abs(new Date(message.timestamp).getTime() - receivedAtMs) <= (12 * 60 * 60 * 1000)
  })

  if (!target && receivedAtMs) {
    target = [...inbound].reverse().find((message) => (
      Math.abs(new Date(message.timestamp).getTime() - receivedAtMs) <= (3 * 60 * 1000)
    ))
  }

  if (!target) {
    throw new Error('reaction_target_message_not_found')
  }

  const selfUserId = String(messages.find((message) => message.isOutgoing)?.userId || '')
  const alreadyReacted = Boolean(
    selfUserId &&
    Array.isArray(target.reactions) &&
    target.reactions.some((reaction) => (
      String(reaction?.senderId || '') === selfUserId &&
      String(reaction?.emoji || '') === String(job.emoji || '❤️')
    ))
  )

  return {
    client,
    thread,
    target,
    alreadyReacted
  }
}

function moveToDone(lockFile, job, meta = {}) {
  const dest = path.join(DONE_DIR, path.basename(lockFile).replace(/\.lock$/, ''))
  safeWriteJson(dest, {
    ...job,
    ...meta,
    completed_at: new Date().toISOString()
  })
  fs.unlinkSync(lockFile)
  return dest
}

function moveToFailed(lockFile, job, errorText) {
  const dest = path.join(FAILED_DIR, path.basename(lockFile).replace(/\.lock$/, ''))
  safeWriteJson(dest, {
    ...job,
    attempts: Number(job.attempts || 0) + 1,
    failed_reason: String(errorText || 'unknown_error'),
    failed_at: new Date().toISOString()
  })
  fs.unlinkSync(lockFile)
  return dest
}

function releaseForRetry(lockFile, job, errorText) {
  const original = lockFile.replace(/\.lock$/, '')
  const attempts = Number(job.attempts || 0) + 1
  const delayMs = nextRetryDelayMs(attempts)
  const payload = {
    ...job,
    attempts,
    retry_after: new Date(Date.now() + delayMs).toISOString(),
    updated_at: new Date().toISOString(),
    last_error: String(errorText || 'unknown_error'),
    last_error_kind: 'transient'
  }
  safeWriteJson(original, payload)
  fs.unlinkSync(lockFile)

  console.log(JSON.stringify({
    type: 'reaction_worker_requeued',
    ...logPaths(original),
    ...logIdentity(job),
    attempts,
    retry_after: payload.retry_after,
    ...errorMetrics(payload.last_error, 'last_error')
  }))
}

function releaseForDmGate(lockFile, job, gate) {
  const original = lockFile.replace(/\.lock$/, '')
  const nextDueMs = gate?.ready_at_ms && Number.isFinite(gate.ready_at_ms)
    ? Math.max(Date.now() + 1000, gate.ready_at_ms)
    : Date.now() + DM_GATE_POLL_MS
  const payload = {
    ...job,
    updated_at: new Date().toISOString(),
    due_at: new Date(nextDueMs).toISOString(),
    dm_gate_last_reason: String(gate?.reason || 'awaiting_dm_gate'),
    dm_gate_checks: Number(job?.dm_gate_checks || 0) + 1
  }
  safeWriteJson(original, payload)
  fs.unlinkSync(lockFile)

  const shouldLog =
    payload.dm_gate_checks <= 2 ||
    payload.dm_gate_checks % 5 === 0 ||
    String(job?.dm_gate_last_reason || '') !== String(payload.dm_gate_last_reason || '')

  if (shouldLog) {
    console.log(JSON.stringify({
      type: 'reaction_worker_waiting_for_dm',
      ...logPaths(original),
      ...logIdentity(job),
      due_at: payload.due_at,
      dm_gate_last_reason: payload.dm_gate_last_reason,
      dm_gate_checks: payload.dm_gate_checks
    }))
  }
}

async function processLockedFile(lockFile) {
  const job = safeReadJson(lockFile)
  const suppression = await getAutomationSuppression(job)

  console.log(JSON.stringify({
    type: 'reaction_worker_pick',
    ...logPaths(lockFile),
    ...logIdentity(job),
    ...textMetrics(job.text)
  }))

  if (suppression.suppressed) {
    recordLearningOutcome(job, 'suppressed')
    const dest = moveToDone(lockFile, job, {
      reaction_result: 'skipped',
      skip_reason: 'automation_suppressed_tag',
      matched_tag: suppression.matched_tag
    })
    console.log(JSON.stringify({
      type: 'reaction_worker_done',
      result: 'skipped',
      ...logPaths(lockFile, dest),
      ...logIdentity(job),
      skip_reason: 'automation_suppressed_tag',
      matched_tag: suppression.matched_tag
    }))
    return
  }

  const gate = getDmGateStatus(job)
  if (gate.status === 'skip') {
    const dest = moveToDone(lockFile, job, {
      reaction_result: 'skipped',
      skip_reason: gate.reason
    })
    console.log(JSON.stringify({
      type: 'reaction_worker_done',
      result: 'skipped',
      ...logPaths(lockFile, dest),
      ...logIdentity(job),
      skip_reason: gate.reason
    }))
    return
  }

  if (gate.status !== 'ready') {
    releaseForDmGate(lockFile, job, gate)
    return
  }

  const { client, thread, target, alreadyReacted } = await resolveThreadAndTarget(job)
  if (alreadyReacted) {
    recordLearningOutcome(job, 'reaction_success')
    const dest = moveToDone(lockFile, job, {
      reaction_result: 'already_reacted',
      ig_thread_id: String(thread.id || ''),
      ig_item_id: String(target.id || '')
    })
    console.log(JSON.stringify({
      type: 'reaction_worker_done',
      result: 'already_reacted',
      ...logPaths(lockFile, dest),
      ...logIdentity(job)
    }))
    return
  }

  // Thread resolution and DM-gate waiting can span a pause/cutover change.
  // Recheck at the last possible point before Instagram is mutated.
  const finalRecoveryVerdict = reactionRecoverySafetyVerdict(job, lockFile, process.env, Date.now())
  if (finalRecoveryVerdict.hold) {
    const dest = holdReactionForHuman(lockFile, job, finalRecoveryVerdict, {
      hold_stage: 'final_reaction_recheck'
    })
    console.log(JSON.stringify({
      type: 'reaction_worker_final_recovery_human_agent_hold',
      ...logPaths(lockFile, dest),
      ...logIdentity(job),
      reason: finalRecoveryVerdict.reason,
      timestamp_source: finalRecoveryVerdict.source
    }))
    return
  }

  if (isPausedForPacket(job, process.env)) {
    releaseReactionLockForPause(lockFile, job)
    return
  }

  await withTimeout(
    client.sendReaction(String(thread.id || ''), String(target.id || ''), String(job.emoji || '❤️')),
    'reaction_send'
  )

  recordLearningOutcome(job, 'reaction_success')
  const dest = moveToDone(lockFile, job, {
    reaction_result: 'sent',
    ig_thread_id: String(thread.id || ''),
    ig_item_id: String(target.id || ''),
    reacted_text: extractMessageText(target)
  })

  console.log(JSON.stringify({
    type: 'reaction_worker_done',
    result: 'sent',
    ...logPaths(lockFile, dest),
    ...logIdentity(job),
    ig_thread_hmac_sha256: artifactSha256(thread.id),
    ig_item_hmac_sha256: artifactSha256(target.id)
  }))
}

async function loop() {
  ensureDirs()

  while (true) {
    try {
      const files = listDueFiles()
      if (!files.length) {
        await sleep(EMPTY_POLL_MS)
        continue
      }

      const file = files[0].file
      let locked

      try {
        locked = tryLock(file)
      } catch {
        await sleep(EMPTY_POLL_MS)
        continue
      }

      try {
        await processLockedFile(locked)
      } catch (err) {
        let job = null
        try {
          job = safeReadJson(locked)
        } catch {}

        const errorText = String(err?.message || err || 'unknown_error')
        console.log(JSON.stringify({
          type: 'reaction_worker_error',
          ...logPaths(locked),
          ...logIdentity(job),
          ...errorMetrics(errorText)
        }))

        if (errorText.toLowerCase().includes('real-time client not connected') || errorText.toLowerCase().includes('sendreaction failed')) {
          activeClient = null
        }

        if (!job) {
          try {
            fs.unlinkSync(locked)
          } catch {}
          await sleep(EMPTY_POLL_MS)
          continue
        }

        const attempts = Number(job.attempts || 0) + 1
        const kind = classifyReactionError(errorText)
        if (kind === 'transient' && attempts < MAX_RETRIES) {
          recordLearningOutcome(job, 'reaction_failed')
          releaseForRetry(locked, job, errorText)
        } else {
          recordLearningOutcome(job, 'reaction_failed')
          const dest = moveToFailed(locked, job, errorText)
          console.log(JSON.stringify({
            type: 'reaction_worker_failed',
            ...logPaths(locked, dest),
            ...logIdentity(job),
            ...errorMetrics(errorText),
            attempts
          }))
        }
      }
    } catch {
      await sleep(EMPTY_POLL_MS)
    }
  }
}

if (require.main === module) {
  loop()
}

module.exports = {
  staleReactionHoldThresholdMs,
  staleReactionLockThresholdMs,
  reactionRecoverySafetyVerdict,
  holdReactionForHuman,
  recoverStaleReactionLockFile,
  sweepStaleReactionLockFiles,
  listDueFiles,
  getDmGateStatus,
  releaseReactionLockForPause,
  processLockedFile,
  loop
}
