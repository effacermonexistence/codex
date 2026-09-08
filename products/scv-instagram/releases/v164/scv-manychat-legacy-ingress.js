#!/usr/bin/env node
// Secure compatibility gate for the April 2026 ManyChat External Request.
//
// The legacy automation posts exactly five JSON fields and cannot attach the
// newer shared-secret header. The normal token-authenticated ingress remains
// authoritative. Only a request with no credential at all may enter this
// compatibility lane, and it is admitted only after ManyChat's authenticated
// getInfo response independently proves the contact, current input, username
// (when usable), and a fresh Instagram interaction timestamp.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SCV_MANYCHAT_LEGACY_INGRESS_LOCK_VERSION =
  'scv-manychat-legacy-ingress-lock-2026-08-21-v2-two-phase-provider-proof-ledger'
const OFFICIAL_MANYCHAT_SUBSCRIBER_INFO_URL =
  'https://api.manychat.com/fb/subscriber/getInfo'
const EXPECTED_BODY_KEYS = Object.freeze([
  'contact_id',
  'instagram_username',
  'message_text',
  'thread_id',
  'user_id'
])
const DEFAULT_TIMEOUT_MS = 1_500
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000
const DEFAULT_FUTURE_SKEW_MS = 2 * 60 * 1000
const DEFAULT_PENDING_TTL_MS = 30 * 1000
const REPLAY_LOCK_RECORD_SCHEMA = 'scv-manychat-legacy-replay-owner-2026-08-22-v1'
const STALE_RECOVERY_SUFFIX = '.stale-recovery'

function envFlag(value, fallback = false) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return fallback
  return /^(1|true|yes|on)$/i.test(normalized)
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.round(parsed)))
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function canonicalProviderId(value) {
  const normalized = String(value ?? '').trim()
  return /^[1-9][0-9]{0,31}$/.test(normalized) &&
    BigInt(normalized) <= BigInt(Number.MAX_SAFE_INTEGER)
}

function normalizeManyChatText(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
}

function requestCredential(req) {
  const headers = req?.headers || {}
  if (Object.prototype.hasOwnProperty.call(headers, 'x-scv-ingress-token')) {
    return String(headers['x-scv-ingress-token'] ?? '').trim() || '__present_empty_ingress_credential__'
  }
  if (!Object.prototype.hasOwnProperty.call(headers, 'authorization')) return ''
  const authorization = String(headers.authorization ?? '').trim()
  if (!authorization) return '__present_empty_ingress_credential__'
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  // Any Authorization header means the caller supplied a credential. Even a
  // malformed or non-Bearer value must stay on the normal rejection path.
  return match ? match[1].trim() : authorization
}

function legacyCompatibilityEnabled(env = process.env) {
  // This exception to shared-secret ingress is production-only and must be
  // deliberately sealed into the golden environment. Missing means disabled.
  return envFlag(env.SCV_LEGACY_MANYCHAT_INGRESS_COMPAT, false)
}

function legacyFallbackEligible(req, options = {}) {
  const required = options.required !== false
  const env = options.env || process.env
  return required && legacyCompatibilityEnabled(env) && !requestCredential(req)
}

function exactLegacyBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'legacy_manychat_body_not_object' }
  }
  const keys = Object.keys(body).sort()
  if (keys.length !== EXPECTED_BODY_KEYS.length ||
      keys.some((key, index) => key !== EXPECTED_BODY_KEYS[index])) {
    return { ok: false, reason: 'legacy_manychat_body_shape_invalid' }
  }

  for (const key of ['contact_id', 'thread_id', 'user_id']) {
    if (typeof body[key] !== 'string' || !canonicalProviderId(body[key])) {
      return { ok: false, reason: 'legacy_manychat_identity_invalid' }
    }
  }
  if (body.contact_id !== body.thread_id || body.contact_id !== body.user_id) {
    return { ok: false, reason: 'legacy_manychat_identity_mismatch' }
  }
  if (typeof body.message_text !== 'string' ||
      body.message_text.length > 16 * 1024 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body.message_text)) {
    return { ok: false, reason: 'legacy_manychat_text_invalid' }
  }
  const normalizedText = normalizeManyChatText(body.message_text)
  if (!normalizedText || normalizedText.length > 8 * 1024 || /^\{\{[^}]+\}\}$/.test(normalizedText)) {
    return { ok: false, reason: 'legacy_manychat_text_invalid' }
  }

  if (typeof body.instagram_username !== 'string' || body.instagram_username.length > 64) {
    return { ok: false, reason: 'legacy_manychat_username_invalid' }
  }
  const rawUsername = body.instagram_username.trim()
  const usernameIsTemplate = /^\{\{[^}]+\}\}$/.test(rawUsername)
  const username = usernameIsTemplate ? '' : rawUsername.toLowerCase()
  if (username && !/^[a-z0-9._]{1,30}$/.test(username)) {
    return { ok: false, reason: 'legacy_manychat_username_invalid' }
  }

  return {
    ok: true,
    contact_id: body.contact_id,
    instagram_username: username,
    normalized_text: normalizedText
  }
}

async function readBoundedResponseBuffer(response, maxBytes) {
  const contentLength = Number(response?.headers?.get?.('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error('manychat_legacy_provider_response_too_large')
    error.code = 'SCV_MANYCHAT_LEGACY_RESPONSE_TOO_LARGE'
    throw error
  }

  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value || [])
        total += chunk.length
        if (total > maxBytes) {
          try { await reader.cancel('manychat_legacy_provider_response_too_large') } catch {}
          const error = new Error('manychat_legacy_provider_response_too_large')
          error.code = 'SCV_MANYCHAT_LEGACY_RESPONSE_TOO_LARGE'
          throw error
        }
        chunks.push(chunk)
      }
      return Buffer.concat(chunks, total)
    } finally {
      try { reader.releaseLock() } catch {}
    }
  }

  if (typeof response?.arrayBuffer === 'function') {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) {
      const error = new Error('manychat_legacy_provider_response_too_large')
      error.code = 'SCV_MANYCHAT_LEGACY_RESPONSE_TOO_LARGE'
      throw error
    }
    return buffer
  }

  const error = new Error('manychat_legacy_provider_response_unreadable')
  error.code = 'SCV_MANYCHAT_LEGACY_RESPONSE_UNREADABLE'
  throw error
}

async function getAuthenticatedSubscriberInfo(contactId, options = {}) {
  const env = options.env || process.env
  const apiKey = options.apiKey === undefined
    ? String(env.MANYCHAT_API_KEY || '')
    : String(options.apiKey || '')
  if (!apiKey) {
    const error = new Error('manychat_legacy_api_key_missing')
    error.code = 'SCV_MANYCHAT_LEGACY_API_KEY_MISSING'
    throw error
  }

  const timeoutMs = boundedNumber(
    options.timeoutMs ?? env.SCV_LEGACY_MANYCHAT_LOOKUP_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    10,
    5_000
  )
  const maxBytes = boundedNumber(
    options.maxResponseBytes ?? env.SCV_LEGACY_MANYCHAT_MAX_RESPONSE_BYTES,
    DEFAULT_MAX_RESPONSE_BYTES,
    1_024,
    2 * 1024 * 1024
  )
  const fetchImpl = options.fetchImpl || fetch
  const url = new URL(OFFICIAL_MANYCHAT_SUBSCRIBER_INFO_URL)
  url.searchParams.set('subscriber_id', String(contactId))
  const controller = new AbortController()
  let timeout
  let operation
  const timeoutPromise = new Promise((resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      const error = new Error('manychat_legacy_lookup_timeout')
      error.code = 'SCV_MANYCHAT_LEGACY_LOOKUP_TIMEOUT'
      reject(error)
    }, timeoutMs)
  })

  try {
    operation = (async () => {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json'
        },
        // Never forward the ManyChat bearer to another origin. The only
        // permitted network target is the exact official HTTPS endpoint above.
        redirect: 'error',
        signal: controller.signal
      })
      if (response?.redirected === true ||
          (response?.url && String(response.url) !== String(url))) {
        const error = new Error('manychat_legacy_provider_final_url_invalid')
        error.code = 'SCV_MANYCHAT_LEGACY_FINAL_URL_INVALID'
        throw error
      }
      const contentType = String(response?.headers?.get?.('content-type') || '')
      if (contentType && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
        const error = new Error('manychat_legacy_provider_content_type_invalid')
        error.code = 'SCV_MANYCHAT_LEGACY_CONTENT_TYPE_INVALID'
        throw error
      }
      const responseBuffer = await readBoundedResponseBuffer(response, maxBytes)
      let body
      try {
        body = responseBuffer.length ? JSON.parse(responseBuffer.toString('utf8')) : {}
      } catch {
        const error = new Error('manychat_legacy_provider_json_invalid')
        error.code = 'SCV_MANYCHAT_LEGACY_JSON_INVALID'
        throw error
      }
      if (Number(response?.status || 0) !== 200 || body?.status !== 'success' ||
          !body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        const error = new Error('manychat_legacy_provider_lookup_failed')
        error.code = 'SCV_MANYCHAT_LEGACY_LOOKUP_FAILED'
        throw error
      }
      return {
        http_status: response.status,
        body,
        response_sha256: sha256(responseBuffer)
      }
    })()
    // A test double may ignore AbortSignal; the explicit race keeps the gate bounded.
    operation.catch(() => {})
    return await Promise.race([operation, timeoutPromise])
  } finally {
    clearTimeout(timeout)
  }
}

function replayLedgerPath(root, replayKey) {
  return path.join(root, 'logs', 'legacy-manychat-ingress-replay', `${replayKey}.json`)
}

function parseProviderInteractionTimestamp(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^(?:\d{10}|\d{13})$/.test(value.trim()))) {
    const numeric = Number(value)
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return NaN
    // ManyChat/export adapters have emitted both epoch seconds and millis.
    return numeric < 100_000_000_000 ? numeric * 1000 : numeric
  }
  const normalized = String(value ?? '').trim()
  // RFC3339 only: an explicit Z/offset is required so host locale cannot alter
  // freshness decisions.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
    return NaN
  }
  return Date.parse(normalized)
}

function providerInteractionTimestamp(provider = {}) {
  for (const field of ['ig_last_interaction', 'last_interaction', 'last_interaction_at']) {
    if (!Object.prototype.hasOwnProperty.call(provider, field)) continue
    const timestampMs = parseProviderInteractionTimestamp(provider[field])
    if (Number.isFinite(timestampMs)) return { field, timestamp_ms: timestampMs }
    return { field, timestamp_ms: NaN }
  }
  return { field: '', timestamp_ms: NaN }
}

function replayKeyForProof(proof) {
  return sha256(Buffer.from([
    SCV_MANYCHAT_LEGACY_INGRESS_LOCK_VERSION,
    proof.contact_id,
    proof.provider_interaction_at,
    proof.normalized_text
  ].join('\n')))
}

function fsyncDirectory(dir) {
  try {
    const dirFd = fs.openSync(dir, 'r')
    try { fs.fsyncSync(dirFd) } finally { fs.closeSync(dirFd) }
  } catch {}
}

function atomicWritePrivateJson(file, value) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  let fd
  try {
    fd = fs.openSync(tmp, 'wx', 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8')
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tmp, file)
    fsyncDirectory(dir)
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch {}
  }
}

function readLedger(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function lockIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino)
  }
}

function sameLockIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino)
}

function inspectReplayLock(file) {
  let fd
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW || 0)
    fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow)
    const stat = fs.fstatSync(fd, { bigint: true })
    if (!stat.isFile() || stat.size > 4_096n) {
      return {
        exists: true,
        safe_regular_file: false,
        ...lockIdentity(stat)
      }
    }
    const raw = fs.readFileSync(fd, 'utf8')
    let record = null
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed
    } catch {}
    return {
      exists: true,
      safe_regular_file: true,
      mtime_ms: Number(stat.mtimeMs),
      nonce: typeof record?.nonce === 'string' ? record.nonce : '',
      record,
      ...lockIdentity(stat)
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false }
    // A symlink, directory, unreadable file, or malformed filesystem object is
    // an occupied lock. Recovery must fail closed rather than following it.
    return { exists: true, safe_regular_file: false, inspection_error: error?.code || 'unknown' }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
  }
}

function acquireReplayLockOwner(file, nowMs, kind) {
  const nonce = crypto.randomBytes(32).toString('hex')
  let fd
  let owner
  try {
    const noFollow = Number(fs.constants.O_NOFOLLOW || 0)
    fd = fs.openSync(
      file,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600
    )
    const stat = fs.fstatSync(fd, { bigint: true })
    owner = {
      file,
      nonce,
      kind,
      ...lockIdentity(stat)
    }
    fs.writeFileSync(fd, `${JSON.stringify({
      schema: REPLAY_LOCK_RECORD_SCHEMA,
      kind,
      nonce,
      pid: process.pid,
      acquired_at_utc: new Date(nowMs).toISOString()
    })}\n`, 'utf8')
    // Base staleness on the caller's clock, just like the ledger timestamps.
    // This also makes recovery tests independent of the host wall clock.
    fs.futimesSync(fd, new Date(nowMs), new Date(nowMs))
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    fsyncDirectory(path.dirname(file))
    return owner
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd) } catch {}
    }
    if (error?.code === 'EEXIST') return null
    // Clean up only when the complete nonce-bearing record still identifies
    // this inode. A partial write is left as a fail-closed manual-recovery lock.
    if (owner) releaseReplayLockOwner(owner)
    throw error
  }
}

function releaseReplayLockOwner(owner) {
  if (!owner?.file || !owner?.nonce) return false
  const current = inspectReplayLock(owner.file)
  // The inode prevents pathname reuse (ABA), while the nonce proves that a
  // same-path record was created by this owner. Never unlink a replacement.
  if (!current.safe_regular_file ||
      !sameLockIdentity(current, owner) ||
      current.nonce !== owner.nonce ||
      current.record?.schema !== REPLAY_LOCK_RECORD_SCHEMA ||
      current.record?.kind !== owner.kind) {
    return false
  }
  try {
    fs.unlinkSync(owner.file)
    fsyncDirectory(path.dirname(owner.file))
    return true
  } catch {
    return false
  }
}

function replayLockIsStale(snapshot, nowMs, pendingTtlMs) {
  return snapshot?.safe_regular_file === true &&
    Number.isFinite(snapshot.mtime_ms) &&
    nowMs - snapshot.mtime_ms > pendingTtlMs
}

function withReplayLock(file, nowMs, pendingTtlMs, callback, options = {}) {
  const lockFile = `${file}.lock`
  const recoveryFile = `${lockFile}${STALE_RECOVERY_SUFFIX}`

  // A recovery coordinator is deliberately never age-reaped. If its process
  // crashes, all later callers fail closed until an operator examines it.
  if (inspectReplayLock(recoveryFile).exists) return { locked: false }

  let owner = acquireReplayLockOwner(lockFile, nowMs, 'primary')
  // Close the check/create race with a coordinator that was installed after
  // the first probe. Its owner will revalidate the primary it originally saw;
  // this contender must not enter the callback while recovery is in flight.
  if (owner && inspectReplayLock(recoveryFile).exists) {
    releaseReplayLockOwner(owner)
    return { locked: false }
  }
  if (!owner) {
    const observed = inspectReplayLock(lockFile)
    if (!replayLockIsStale(observed, nowMs, pendingTtlMs)) return { locked: false }

    const recoveryOwner = acquireReplayLockOwner(recoveryFile, nowMs, 'stale-recovery')
    if (!recoveryOwner) return { locked: false }

    let recoveryIntegrity = true
    try {
      if (typeof options.afterRecoveryCoordinatorAcquired === 'function') {
        options.afterRecoveryCoordinatorAcquired({ lockFile, recoveryFile })
      }

      // Re-read under the per-ledger coordinator. A changed pathname is an ABA
      // event and is never removed on the evidence collected before the lock.
      const revalidated = inspectReplayLock(lockFile)
      if (!replayLockIsStale(revalidated, nowMs, pendingTtlMs) ||
          !sameLockIdentity(observed, revalidated)) {
        return { locked: false }
      }
      const finalCheck = inspectReplayLock(lockFile)
      if (!replayLockIsStale(finalCheck, nowMs, pendingTtlMs) ||
          !sameLockIdentity(revalidated, finalCheck) ||
          revalidated.nonce !== finalCheck.nonce) {
        return { locked: false }
      }
      try {
        fs.unlinkSync(lockFile)
        fsyncDirectory(path.dirname(lockFile))
      } catch {
        return { locked: false }
      }

      if (typeof options.afterStalePrimaryRemoved === 'function') {
        options.afterStalePrimaryRemoved({ lockFile, recoveryFile })
      }

      // The coordinator stays owned across the otherwise vulnerable missing-
      // primary window and is released only after primary reacquisition.
      owner = acquireReplayLockOwner(lockFile, nowMs, 'primary')
      if (!owner) return { locked: false }
    } finally {
      recoveryIntegrity = releaseReplayLockOwner(recoveryOwner)
    }

    if (!recoveryIntegrity) {
      releaseReplayLockOwner(owner)
      return { locked: false }
    }
  }

  try {
    return { locked: true, value: callback() }
  } finally {
    releaseReplayLockOwner(owner)
  }
}

function baseLedger(proof) {
  return {
    schema: 'scv-manychat-legacy-ingress-replay-2026-08-21-v2',
    lock_version: SCV_MANYCHAT_LEGACY_INGRESS_LOCK_VERSION,
    provider_interaction_at: proof.provider_interaction_at,
    provider_interaction_source: String(proof.provider_interaction_source || ''),
    expected_message_id_sha256: sha256(Buffer.from(String(proof.expected_message_id || ''))),
    contact_id_sha256: sha256(Buffer.from(proof.contact_id)),
    normalized_text_sha256: sha256(Buffer.from(proof.normalized_text)),
    provider_response_sha256: proof.provider_response_sha256,
    raw_identity_included: false,
    raw_text_included: false,
    secrets_included: false
  }
}

function reserveReplayLedger(root, proof, options = {}) {
  const nowMs = Number(options.nowMs || Date.now())
  const pendingTtlMs = boundedNumber(options.pendingTtlMs, DEFAULT_PENDING_TTL_MS, 1_000, 5 * 60 * 1000)
  const replayKey = replayKeyForProof(proof)
  const file = replayLedgerPath(root, replayKey)
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { fs.chmodSync(dir, 0o700) } catch {}
  const locked = withReplayLock(file, nowMs, pendingTtlMs, () => {
    const existing = readLedger(file)
    if (existing?.status === 'accepted') {
      return { ok: false, replay: true, reason: 'legacy_manychat_replay' }
    }
    if (existing) {
      if (existing.status !== 'pending' || !existing.reservation_id ||
          existing.lock_version !== SCV_MANYCHAT_LEGACY_INGRESS_LOCK_VERSION) {
        const error = new Error('legacy_manychat_replay_ledger_invalid')
        error.code = 'SCV_MANYCHAT_LEGACY_LEDGER_INVALID'
        throw error
      }
      const reservedMs = Date.parse(String(existing.reserved_at_utc || ''))
      if (!Number.isFinite(reservedMs) || nowMs - reservedMs <= pendingTtlMs) {
        return { ok: false, replay: true, reason: 'legacy_manychat_replay_pending' }
      }
      let durable = false
      if (typeof options.durableIngressProbe === 'function') {
        durable = options.durableIngressProbe({
          replay_key: replayKey,
          expected_message_id: proof.expected_message_id,
          contact_id: proof.contact_id
        }) === true
      }
      if (durable) {
        atomicWritePrivateJson(file, {
          ...existing,
          status: 'accepted',
          accepted_at_utc: new Date(nowMs).toISOString(),
          reconciled_from_durable_ingress: true,
          durable_ingress_sha256: sha256(Buffer.from(`${proof.expected_message_id}.json`))
        })
        return { ok: false, replay: true, reason: 'legacy_manychat_replay' }
      }
    }

    const reservationId = crypto.randomBytes(32).toString('hex')
    atomicWritePrivateJson(file, {
      ...baseLedger(proof),
      status: 'pending',
      reservation_id: reservationId,
      reserved_at_utc: new Date(nowMs).toISOString(),
      pending_expires_at_utc: new Date(nowMs + pendingTtlMs).toISOString()
    })
    return {
      ok: true,
      replay: false,
      replay_key: replayKey,
      ledger_file: file,
      reservation_id: reservationId
    }
  }, options.replayLockOptions)
  if (!locked.locked) {
    return { ok: false, replay: true, reason: 'legacy_manychat_replay_pending' }
  }
  return locked.value
}

function commitReplayLedger(reservation, options = {}) {
  const nowMs = Number(options.nowMs || Date.now())
  const file = String(reservation?.ledger_file || '')
  const reservationId = String(reservation?.reservation_id || '')
  if (!file || !reservationId) throw new Error('legacy_manychat_reservation_invalid')
  const locked = withReplayLock(file, nowMs, DEFAULT_PENDING_TTL_MS, () => {
    const existing = readLedger(file)
    if (existing?.status === 'accepted') return { ok: true, already_accepted: true }
    if (existing?.status !== 'pending' || existing.reservation_id !== reservationId) {
      return { ok: false, reason: 'legacy_manychat_reservation_lost' }
    }
    const accepted = {
      ...existing,
      status: 'accepted',
      accepted_at_utc: new Date(nowMs).toISOString(),
      durable_ingress_sha256: sha256(Buffer.from(String(options.durableIngressIdentity || '')))
    }
    atomicWritePrivateJson(file, accepted)
    return { ok: true, already_accepted: false, ledger_file: file }
  })
  if (!locked.locked) return { ok: false, reason: 'legacy_manychat_replay_lock_busy' }
  return locked.value
}

function releaseReplayReservation(reservation, options = {}) {
  const nowMs = Number(options.nowMs || Date.now())
  const file = String(reservation?.ledger_file || '')
  const reservationId = String(reservation?.reservation_id || '')
  if (!file || !reservationId) return { ok: false, released: false }
  const locked = withReplayLock(file, nowMs, DEFAULT_PENDING_TTL_MS, () => {
    const existing = readLedger(file)
    if (existing?.status !== 'pending' || existing.reservation_id !== reservationId) {
      return { ok: true, released: false }
    }
    fs.unlinkSync(file)
    fsyncDirectory(path.dirname(file))
    return { ok: true, released: true }
  })
  return locked.locked ? locked.value : { ok: false, released: false }
}

function failure(reason, status = 401) {
  return { ok: false, status, reason }
}

async function verifyLegacyManyChatIngress(options = {}) {
  const req = options.req || {}
  const body = options.body
  const root = options.root || __dirname
  const env = options.env || process.env
  const nowMs = Number(options.nowMs || Date.now())

  if (!legacyFallbackEligible(req, { required: options.authRequired !== false, env })) {
    return failure('legacy_manychat_fallback_ineligible')
  }
  if (String(req?.headers?.['user-agent'] || '').trim() !== 'ManyChat') {
    return failure('legacy_manychat_user_agent_invalid')
  }
  const shaped = exactLegacyBody(body)
  if (!shaped.ok) return failure(shaped.reason)

  let lookup
  try {
    lookup = await getAuthenticatedSubscriberInfo(shaped.contact_id, {
      env,
      apiKey: options.apiKey,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxResponseBytes: options.maxResponseBytes
    })
  } catch (error) {
    const reason = error?.code === 'SCV_MANYCHAT_LEGACY_LOOKUP_TIMEOUT'
      ? 'legacy_manychat_lookup_timeout'
      : 'legacy_manychat_provider_unavailable'
    return failure(reason, 503)
  }

  const provider = lookup.body.data
  const providerId = String(provider.id || provider.subscriber_id || '').trim()
  if (providerId !== shaped.contact_id) {
    return failure('legacy_manychat_provider_identity_mismatch')
  }
  if (shaped.instagram_username &&
      String(provider.ig_username || '').trim().toLowerCase() !== shaped.instagram_username) {
    return failure('legacy_manychat_provider_username_mismatch')
  }
  const providerText = normalizeManyChatText(provider.last_input_text)
  if (!providerText || providerText !== shaped.normalized_text) {
    return failure('legacy_manychat_provider_text_mismatch')
  }

  const interaction = providerInteractionTimestamp(provider)
  const interactionMs = interaction.timestamp_ms
  const maxAgeMs = boundedNumber(
    options.maxAgeMs ?? env.SCV_LEGACY_MANYCHAT_INGRESS_MAX_AGE_MS,
    DEFAULT_MAX_AGE_MS,
    60_000,
    24 * 60 * 60 * 1000
  )
  const futureSkewMs = boundedNumber(
    options.futureSkewMs ?? env.SCV_LEGACY_MANYCHAT_FUTURE_SKEW_MS,
    DEFAULT_FUTURE_SKEW_MS,
    0,
    5 * 60 * 1000
  )
  if (!Number.isFinite(interactionMs)) {
    return failure('legacy_manychat_provider_interaction_time_invalid')
  }
  if (interactionMs > nowMs + futureSkewMs) {
    return failure('legacy_manychat_provider_interaction_time_future')
  }
  if (nowMs - interactionMs > maxAgeMs) {
    return failure('legacy_manychat_provider_interaction_stale')
  }

  let replay
  try {
    const proof = {
      contact_id: shaped.contact_id,
      normalized_text: shaped.normalized_text,
      provider_interaction_at: new Date(interactionMs).toISOString(),
      provider_interaction_source: interaction.field,
      provider_response_sha256: lookup.response_sha256
    }
    proof.expected_message_id = `legacy-manychat-${replayKeyForProof(proof).slice(0, 32)}`
    replay = reserveReplayLedger(root, proof, {
      nowMs,
      pendingTtlMs: options.pendingTtlMs ?? env.SCV_LEGACY_MANYCHAT_PENDING_TTL_MS,
      durableIngressProbe: options.durableIngressProbe
    })
  } catch {
    return failure('legacy_manychat_replay_ledger_unavailable', 503)
  }
  if (!replay.ok) return failure(replay.reason, 409)

  return {
    ok: true,
    status: 200,
    reason: 'legacy_manychat_provider_proof_accepted',
    lock_version: SCV_MANYCHAT_LEGACY_INGRESS_LOCK_VERSION,
    provider_interaction_at: new Date(interactionMs).toISOString(),
    provider_interaction_source: interaction.field,
    provider_response_sha256: lookup.response_sha256,
    replay_key: replay.replay_key,
    ledger_file: replay.ledger_file,
    reservation_id: replay.reservation_id,
    expected_message_id: `legacy-manychat-${replay.replay_key.slice(0, 32)}`,
    manychat_info: lookup
  }
}

module.exports = {
  SCV_MANYCHAT_LEGACY_INGRESS_LOCK_VERSION,
  OFFICIAL_MANYCHAT_SUBSCRIBER_INFO_URL,
  EXPECTED_BODY_KEYS,
  normalizeManyChatText,
  requestCredential,
  legacyCompatibilityEnabled,
  legacyFallbackEligible,
  exactLegacyBody,
  readBoundedResponseBuffer,
  getAuthenticatedSubscriberInfo,
  parseProviderInteractionTimestamp,
  providerInteractionTimestamp,
  replayKeyForProof,
  replayLedgerPath,
  withReplayLock,
  reserveReplayLedger,
  commitReplayLedger,
  releaseReplayReservation,
  verifyLegacyManyChatIngress
}
