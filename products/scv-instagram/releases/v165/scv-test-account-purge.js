#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  DEBUG_USERNAMES,
  DEBUG_CONTACT_IDS,
  DEBUG_USERNAMES_CSV,
  DEBUG_CONTACT_IDS_CSV,
  isDebugIdentity
} = require(path.join(__dirname, 'scv-debug-identity.js'))

const TEST_ACCOUNT_PURGE_ID = 'omar-system-20260712-v19-reset-watermark'
const OMAR_SYSTEM_PURGE_ACKNOWLEDGEMENT =
  'I_ACKNOWLEDGE_PAUSED_EXACT_OMAR_SYSTEM_PURGE'
const OMAR_SYSTEM_PURGE_RECEIPT_SCHEMA =
  'scv-paused-exact-omar-system-purge-2026-08-20-v1-private'
const TEST_ACCOUNT_GMAIL_TOMBSTONE_FILENAME = '.debug-reset-tombstones.json'
const TEST_ACCOUNT_RESET_WATERMARK_FILENAME = '.debug-reset-watermarks.json'
const TEST_ACCOUNT_PURGE_DIRS = [
  'inbox',
  'outbox',
  'reactbox',
  'reactbox_done',
  'reactbox_failed',
  'thread-state',
  'thread-state_pre_migration',
  'thread-history',
  'thread-state_quarantine_contaminated',
  'thread-history_quarantine_contaminated',
  'inbox_quarantine_superseded',
  'inbox_quarantine_deadletter',
  'outbox_quarantine_stale',
  'outbox_quarantine_non_authoritative',
  'outbox_quarantine_contract_harness',
  'outbox_quarantine_failed',
  'outbox_human_agent_required',
  'outbox_quarantine_pre_single_control',
  'outbox-idempotency',
  'control-events',
  'control-decisions',
  'control-locks',
  'form-submissions'
]

function splitCsv(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
  return String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
}

function shouldPurgeText(value, usernames, contactIds = []) {
  const lower = String(value || '').toLowerCase()
  return usernames.some((name) => name && lower.includes(name)) &&
    contactIds.some((id) => id && lower.includes(String(id).toLowerCase()))
}

const USERNAME_IDENTITY_PATHS = new Set([
  'instagramusername',
  'instagram',
  'igusername',
  'username'
])

const CONTACT_IDENTITY_PATHS = new Set([
  'contactid',
  'subscriberid',
  'threadid',
  'senderid',
  'recipientid',
  'userid',
  'claimedby',
  'fromid',
  'toid'
])

function normalizeIdentity(value) {
  // Gmail form MIME can expose quoted-printable punctuation before the reader
  // decodes it (live example: `omar=2Esystem`). Debug reset must still recognize
  // and tombstone that record or it can re-enter a later replay.
  const decoded = String(value || '').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  return decoded.trim().toLowerCase().replace(/^@+/, '')
}

function normalizeIdentityPath(parts) {
  return parts.join('').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function identityValueMatches(value, identities) {
  const normalized = normalizeIdentity(value)
  if (!normalized) return false
  return identities.some((identity) => normalizeIdentity(identity) === normalized)
}

function pathMatchesIdentityKind(normalizedPath, paths) {
  return paths.has(normalizedPath) || [...paths].some((key) => normalizedPath.endsWith(key))
}

function structuredIdentityEvidence(value, usernames, contactIds, pathParts = [], evidence = {
  username: false,
  contact_id: false
}) {
  if (Array.isArray(value)) {
    for (const item of value) {
      structuredIdentityEvidence(item, usernames, contactIds, pathParts, evidence)
    }
    return evidence
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      structuredIdentityEvidence(item, usernames, contactIds, [...pathParts, key], evidence)
    }
    return evidence
  }
  const normalizedPath = normalizeIdentityPath(pathParts)
  if (pathMatchesIdentityKind(normalizedPath, USERNAME_IDENTITY_PATHS) &&
      identityValueMatches(value, usernames)) evidence.username = true
  if (pathMatchesIdentityKind(normalizedPath, CONTACT_IDENTITY_PATHS) &&
      identityValueMatches(value, contactIds)) evidence.contact_id = true
  return evidence
}

function structuredValueHasTargetIdentityPair(value, usernames, contactIds, fileKeyContact = false) {
  // A top-level JSON array is treated as independent records so two different
  // customers cannot be combined into one destructive identity by aggregation.
  if (Array.isArray(value)) {
    return value.some((item) => structuredValueHasTargetIdentityPair(
      item, usernames, contactIds, fileKeyContact
    ))
  }
  const evidence = structuredIdentityEvidence(value, usernames, contactIds)
  return evidence.username && (evidence.contact_id || fileKeyContact)
}

function fileKeyHasTargetContactId(fileKey, contactIds) {
  const value = String(fileKey || '')
  return contactIds.some((id) => {
    const escaped = String(id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return escaped && new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(value)
  })
}

function labeledTextHasTargetIdentityPair(raw, usernames, contactIds, fileKeyContact = false) {
  const text = String(raw || '')
  const usernameLabels = '(?:instagram[_-]?username|instagram|ig[_-]?username|username|claimed[_-]?by)'
  const contactLabels = '(?:contact[_-]?id|subscriber[_-]?id|thread[_-]?id|sender[_-]?id|recipient[_-]?id|user[_-]?id|from[_-]?id|to[_-]?id)'
  const labeledMatch = (identities, labels) => identities.some((identity) => {
    const escaped = String(identity || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return escaped && new RegExp(`["']?${labels}["']?\\s*[:=]\\s*["']?@?${escaped}(?:["'\\s,}]|$)`, 'i').test(text)
  })
  return labeledMatch(usernames, usernameLabels) &&
    (fileKeyContact || labeledMatch(contactIds, contactLabels))
}

function shouldPurgeRecord(raw, fileKey, usernames, contactIds) {
  const fileKeyContact = fileKeyHasTargetContactId(fileKey, contactIds)
  const text = String(raw || '')
  try {
    return structuredValueHasTargetIdentityPair(
      JSON.parse(text), usernames, contactIds, fileKeyContact
    )
  } catch {}
  // NDJSON and legacy labeled text are evaluated one record/line at a time;
  // a username on one customer's line and a contact id on another line may
  // never be combined into purge authority.
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    try {
      if (structuredValueHasTargetIdentityPair(
        JSON.parse(line), usernames, contactIds, fileKeyContact
      )) return true
    } catch {
      if (labeledTextHasTargetIdentityPair(
        line, usernames, contactIds, fileKeyContact
      )) return true
    }
  }
  return false
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(file))
    else if (entry.isFile()) files.push(file)
  }
  return files
}

function debugResetTombstonePath(root = __dirname) {
  return path.join(root, 'form-submissions', TEST_ACCOUNT_GMAIL_TOMBSTONE_FILENAME)
}

function readDebugResetTombstones(root = __dirname) {
  const file = debugResetTombstonePath(root)
  try {
    if (!fs.existsSync(file)) return { uids: [], updated_at: '' }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      uids: Array.from(new Set(Array.isArray(parsed.uids) ? parsed.uids.map((uid) => String(uid || '').trim()).filter(Boolean) : [])),
      updated_at: String(parsed.updated_at || '')
    }
  } catch {
    return { uids: [], updated_at: '' }
  }
}

function writeDebugResetTombstones(root, uids) {
  const unique = Array.from(new Set((uids || []).map((uid) => String(uid || '').trim()).filter(Boolean)))
  if (!unique.length) return { written: false, uids: [] }
  const file = debugResetTombstonePath(root)
  const current = readDebugResetTombstones(root)
  const merged = Array.from(new Set([...(current.uids || []), ...unique])).sort()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ updated_at: new Date().toISOString(), uids: merged }, null, 2) + '\n')
  return { written: true, file, uids: merged }
}

function isPurgedTestAccountGmailUid(root, uid) {
  const id = String(uid || '').trim()
  if (!id) return false
  return readDebugResetTombstones(root).uids.includes(id)
}

function debugResetWatermarkPath(root = __dirname) {
  return path.join(root, 'form-submissions', TEST_ACCOUNT_RESET_WATERMARK_FILENAME)
}

function readDebugResetWatermarks(root = __dirname) {
  const file = debugResetWatermarkPath(root)
  try {
    if (!fs.existsSync(file)) return { updated_at: '', contact_ids: {}, usernames: {} }
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      updated_at: String(parsed.updated_at || ''),
      contact_ids: parsed.contact_ids && typeof parsed.contact_ids === 'object' ? parsed.contact_ids : {},
      usernames: parsed.usernames && typeof parsed.usernames === 'object' ? parsed.usernames : {}
    }
  } catch {
    return { updated_at: '', contact_ids: {}, usernames: {} }
  }
}

function writeDebugResetWatermarks(root, { usernames = [], contactIds = [], resetAt = new Date().toISOString() } = {}) {
  const file = debugResetWatermarkPath(root)
  const current = readDebugResetWatermarks(root)
  const at = String(resetAt || new Date().toISOString())
  const next = {
    updated_at: at,
    contact_ids: { ...(current.contact_ids || {}) },
    usernames: { ...(current.usernames || {}) }
  }
  for (const id of splitCsv(contactIds)) next.contact_ids[normalizeIdentity(id)] = at
  for (const username of splitCsv(usernames)) next.usernames[normalizeIdentity(username)] = at
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n')
  return { written: true, file, updated_at: at, contact_ids: next.contact_ids, usernames: next.usernames }
}

function debugResetBoundaryVerdict(root, packet, options = {}) {
  if (!isDebugIdentity(packet)) {
    return {
      predates: false,
      reason: 'not_exact_debug_identity_pair',
      source: '',
      interaction_at: '',
      reset_at: ''
    }
  }
  const watermarks = readDebugResetWatermarks(root)
  const contactId = normalizeIdentity(packet?.contact_id || packet?.thread_id || '')
  const username = normalizeIdentity(packet?.instagram_username || '')
  const cutoffs = [
    contactId ? watermarks.contact_ids?.[contactId] : '',
    username ? watermarks.usernames?.[username] : ''
  ].map((value) => Date.parse(String(value || ''))).filter(Number.isFinite)
  if (!cutoffs.length) {
    return { predates: false, reason: 'no_debug_reset_watermark', source: '', interaction_at: '', reset_at: '' }
  }

  // A debug reset is a source-time boundary. `received_at` and a locally generated
  // fallback message_id only describe when our webhook endpoint saw a packet; they
  // cannot prove that the Instagram turn itself happened after the reset. Direct
  // ManyChat webhooks and orphan recovery therefore share the same gate, using the
  // strongest externally anchored interaction timestamp available.
  const candidates = [
    ['source_interaction_at', packet?.source_interaction_at],
    ['recovered_from_ig_last_interaction', packet?.recovered_from_ig_last_interaction],
    ['manychat_latest_interaction_at', packet?.manychat_latest_interaction_at],
    ['recovered_from_at', packet?.recovered_from_at]
  ]
  let source = ''
  let interactionAtRaw = ''
  let interactionAt = NaN
  for (const [candidateSource, candidateValue] of candidates) {
    const raw = String(candidateValue || '').trim()
    const parsed = Date.parse(raw)
    if (!raw || !Number.isFinite(parsed)) continue
    source = candidateSource
    interactionAtRaw = raw
    interactionAt = parsed
    break
  }
  if (!Number.isFinite(interactionAt)) {
    return {
      // A reset watermark exists, but local receipt time cannot prove the
      // Instagram interaction happened afterward. Treat unknown source time as
      // pre-reset so delayed/replayed debug traffic cannot resurrect wiped state.
      predates: true,
      reason: 'missing_external_interaction_timestamp_fail_closed',
      source: '',
      interaction_at: '',
      reset_at: new Date(Math.max(...cutoffs)).toISOString()
    }
  }
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now()
  if (interactionAt > now + (5 * 60 * 1000)) {
    return {
      predates: true,
      reason: 'external_interaction_timestamp_in_future_fail_closed',
      source,
      interaction_at: interactionAtRaw,
      reset_at: new Date(Math.max(...cutoffs)).toISOString()
    }
  }
  const resetAt = Math.max(...cutoffs)
  return {
    predates: interactionAt <= resetAt,
    reason: interactionAt <= resetAt ? 'interaction_at_or_before_debug_reset' : 'interaction_after_debug_reset',
    source,
    interaction_at: interactionAtRaw,
    reset_at: new Date(resetAt).toISOString()
  }
}

function orphanPacketPredatesDebugReset(root, packet) {
  return debugResetBoundaryVerdict(root, packet).predates
}

function formSubmissionTombstoneUids(file, raw) {
  const base = path.basename(file).replace(/\.json$/i, '')
  const uids = [base]
  try {
    const parsed = JSON.parse(String(raw || '{}'))
    if (parsed && parsed.uid) uids.push(String(parsed.uid))
  } catch {}
  return uids
}

function auditTestAccountDebugState(options = {}) {
  const root = options.root || __dirname
  const usernames = [...DEBUG_USERNAMES]
  const contactIds = [...DEBUG_CONTACT_IDS]
  const remaining = []

  for (const dir of TEST_ACCOUNT_PURGE_DIRS) {
    const abs = path.join(root, dir)
    for (const file of walkFiles(abs)) {
      try {
        const raw = fs.readFileSync(file, 'utf8')
        const fileKey = `${path.basename(file)} ${path.relative(root, file)}`
        if (shouldPurgeRecord(raw, fileKey, usernames, contactIds)) {
          remaining.push(path.relative(root, file))
        }
      } catch {}
    }
  }

  const rawLog = path.join(root, 'logs', 'inbound-raw.ndjson')
  let remainingLogLines = 0
  try {
    if (fs.existsSync(rawLog)) {
      for (const line of fs.readFileSync(rawLog, 'utf8').split(/\r?\n/).filter(Boolean)) {
        if (shouldPurgeRecord(line, '', usernames, contactIds)) remainingLogLines += 1
      }
    }
  } catch {}

  return {
    usernames,
    contact_ids: contactIds,
    remaining_count: remaining.length + remainingLogLines,
    remaining_files: remaining,
    remaining_log_lines: remainingLogLines
  }
}

function purgeTestAccountDebugState(options = {}) {
  const root = options.root || __dirname
  // Destructive purge scope is code-locked. Callers and mutable environment
  // variables may never expand this operation to a real customer identity.
  const usernames = [...DEBUG_USERNAMES]
  const contactIds = [...DEBUG_CONTACT_IDS]
  const purgeId = String(options.purgeId || TEST_ACCOUNT_PURGE_ID)
  const resetAt = String(options.resetAt || new Date().toISOString())
  const deleted = []
  const tombstoneUids = []

  for (const dir of TEST_ACCOUNT_PURGE_DIRS) {
    const abs = path.join(root, dir)
    for (const file of walkFiles(abs)) {
      try {
        const raw = fs.readFileSync(file, 'utf8')
        const fileKey = `${path.basename(file)} ${path.relative(root, file)}`
        if (shouldPurgeRecord(raw, fileKey, usernames, contactIds)) {
          if (dir === 'form-submissions' && path.basename(file) !== TEST_ACCOUNT_GMAIL_TOMBSTONE_FILENAME) {
            tombstoneUids.push(...formSubmissionTombstoneUids(file, raw))
          }
          fs.unlinkSync(file)
          deleted.push(path.relative(root, file))
        }
      } catch {}
    }
  }

  const rawLog = path.join(root, 'logs', 'inbound-raw.ndjson')
  let removedLogLines = 0
  try {
    if (fs.existsSync(rawLog)) {
      const raw = fs.readFileSync(rawLog, 'utf8')
      const lines = raw.split(/\r?\n/).filter(Boolean)
      const kept = []
      for (const line of lines) {
        if (shouldPurgeRecord(line, '', usernames, contactIds)) removedLogLines += 1
        else kept.push(line)
      }
      if (removedLogLines) fs.writeFileSync(rawLog, kept.join('\n') + (kept.length ? '\n' : ''))
    }
  } catch {}
  const tombstones = writeDebugResetTombstones(root, tombstoneUids)
  const resetWatermarks = writeDebugResetWatermarks(root, { usernames, contactIds, resetAt })
  const audit = auditTestAccountDebugState({ root, usernames, contactIds })

  return {
    event: 'scv_test_account_chat_purge',
    purge_id: purgeId,
    usernames,
    contact_ids: contactIds,
    deleted_count: deleted.length,
    deleted,
    gmail_tombstone_count: tombstones.uids.length,
    reset_watermark_at: resetWatermarks.updated_at,
    reset_watermark_contact_count: Object.keys(resetWatermarks.contact_ids || {}).length,
    reset_watermark_username_count: Object.keys(resetWatermarks.usernames || {}).length,
    removed_log_lines: removedLogLines,
    remaining_count: audit.remaining_count,
    remaining_files: audit.remaining_files,
    remaining_log_lines: audit.remaining_log_lines
  }
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function writePrivateReceiptExclusive(file, value) {
  const resolved = path.resolve(String(file || ''))
  if (!path.isAbsolute(String(file || '')) || !/\.omar-system-purge\.json$/.test(resolved)) {
    throw new Error('omar_system_purge_receipt_path_invalid')
  }
  const directory = path.dirname(resolved)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStat = fs.lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
      (directoryStat.mode & 0o077) !== 0) {
    throw new Error('omar_system_purge_receipt_directory_not_private')
  }
  if (fs.existsSync(resolved)) throw new Error('omar_system_purge_receipt_already_exists')
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  )
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    fs.fchmodSync(descriptor, 0o600)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.linkSync(temporary, resolved)
    fs.unlinkSync(temporary)
    fsyncDirectory(directory)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
  return resolved
}

function readPrivateJson(file, options = {}) {
  const resolved = path.resolve(String(file || ''))
  let descriptor
  try {
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size <= 0 || stat.size > 1024 * 1024 ||
        (options.privateFile !== false && (stat.mode & 0o077) !== 0)) {
      throw new Error('omar_system_purge_private_artifact_invalid')
    }
    const bytes = fs.readFileSync(descriptor)
    const after = fs.fstatSync(descriptor)
    const pathStat = fs.lstatSync(resolved)
    if (pathStat.isSymbolicLink() || pathStat.dev !== after.dev || pathStat.ino !== after.ino ||
        stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
      throw new Error('omar_system_purge_private_artifact_changed')
    }
    return JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    if (['ELOOP', 'EMLINK'].includes(String(error?.code || ''))) {
      throw new Error('omar_system_purge_private_artifact_invalid')
    }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function executePausedOmarSystemPurge(options = {}) {
  const env = options.env || process.env
  if (String(env.SCV_PAUSE_ALL || '') !== '1') {
    throw new Error('omar_system_purge_requires_pause_all')
  }
  if (String(env.SCV_RELEASE_PHASE || '') !== 'recovery_bootstrap') {
    throw new Error('omar_system_purge_requires_recovery_bootstrap_phase')
  }
  if (String(env.SCV_EXECUTE_OMAR_SYSTEM_PURGE || '') !== OMAR_SYSTEM_PURGE_ACKNOWLEDGEMENT) {
    throw new Error('omar_system_purge_exact_acknowledgement_missing')
  }
  const releaseId = String(env.SCV_GOLDEN_RELEASE_ID || '')
  const deploymentId = String(env.RAILWAY_DEPLOYMENT_ID || '')
  if (!/^scv-instagram-golden-production-[A-Za-z0-9._-]+$/.test(releaseId)) {
    throw new Error('omar_system_purge_bootstrap_release_id_missing')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(deploymentId)) {
    throw new Error('omar_system_purge_bootstrap_deployment_id_missing')
  }
  const root = path.resolve(String(options.root || __dirname))
  const manifest = options.manifest || readPrivateJson(
    path.join(root, 'SCV_GOLDEN_PRODUCTION_RELEASE.json'),
    { privateFile: false }
  )
  if (
    manifest?.release_id !== releaseId ||
    manifest?.deployment?.release_phase !== 'recovery_bootstrap' ||
    manifest?.deployment?.recovery_transition?.role !== 'bootstrap' ||
    !/^[a-f0-9]{64}$/.test(String(manifest?.content_fingerprint_sha256 || '')) ||
    !/^[a-f0-9]{64}$/.test(String(manifest?.release_manifest_sha256 || ''))
  ) throw new Error('omar_system_purge_bootstrap_manifest_mismatch')
  const now = options.now || new Date()
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('omar_system_purge_time_invalid')
  }
  const receiptPath = path.resolve(String(options.receipt || ''))
  const intentPath = receiptPath.replace(
    /\.omar-system-purge\.json$/,
    '.intent.omar-system-purge.json'
  )
  if (intentPath === receiptPath) throw new Error('omar_system_purge_receipt_path_invalid')
  let intent
  if (fs.existsSync(intentPath)) {
    intent = readPrivateJson(intentPath)
    if (
      intent?.schema !== 'scv-paused-exact-omar-system-purge-intent-2026-08-20-v1-private' ||
      intent?.bootstrap_release_id !== releaseId ||
      intent?.bootstrap_content_fingerprint_sha256 !== manifest.content_fingerprint_sha256 ||
      intent?.bootstrap_release_manifest_sha256 !== manifest.release_manifest_sha256 ||
      intent?.bootstrap_deployment_id !== deploymentId ||
      intent?.root !== root || intent?.receipt_path !== receiptPath ||
      !Number.isSafeInteger(intent?.pre_audit_remaining_count)
    ) throw new Error('omar_system_purge_intent_mismatch')
  } else {
    const before = auditTestAccountDebugState({ root })
    intent = {
      schema: 'scv-paused-exact-omar-system-purge-intent-2026-08-20-v1-private',
      bootstrap_release_id: releaseId,
      bootstrap_content_fingerprint_sha256: manifest.content_fingerprint_sha256,
      bootstrap_release_manifest_sha256: manifest.release_manifest_sha256,
      bootstrap_deployment_id: deploymentId,
      root,
      receipt_path: receiptPath,
      started_at_utc: now.toISOString(),
      pre_audit_remaining_count: before.remaining_count,
      raw_message_content_included: false,
      secrets_included: false
    }
    writePrivateReceiptExclusive(intentPath, intent)
  }
  if (fs.existsSync(receiptPath)) {
    const existing = readPrivateJson(receiptPath)
    if (
      existing?.schema !== OMAR_SYSTEM_PURGE_RECEIPT_SCHEMA || existing?.ok !== true ||
      existing?.bootstrap_release_id !== releaseId ||
      existing?.bootstrap_content_fingerprint_sha256 !== manifest.content_fingerprint_sha256 ||
      existing?.bootstrap_release_manifest_sha256 !== manifest.release_manifest_sha256 ||
      existing?.bootstrap_deployment_id !== deploymentId ||
      existing?.post_audit_remaining_count !== 0
    ) throw new Error('omar_system_purge_existing_receipt_mismatch')
    fs.unlinkSync(intentPath)
    fsyncDirectory(path.dirname(intentPath))
    return existing
  }
  const purged = purgeTestAccountDebugState({
    root,
    resetAt: now.toISOString()
  })
  const after = auditTestAccountDebugState({ root })
  if (after.remaining_count !== 0 || purged.remaining_count !== 0) {
    throw new Error('omar_system_purge_post_audit_not_zero')
  }
  const receipt = {
    schema: OMAR_SYSTEM_PURGE_RECEIPT_SCHEMA,
    ok: true,
    action: 'purge_exact_canonical_debug_identity_while_bootstrap_paused',
    bootstrap_release_id: releaseId,
    bootstrap_content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    bootstrap_release_manifest_sha256: manifest.release_manifest_sha256,
    bootstrap_deployment_id: deploymentId,
    executed_at_utc: now.toISOString(),
    pause_all_verified: true,
    release_phase: 'recovery_bootstrap',
    usernames: [...DEBUG_USERNAMES],
    contact_ids: [...DEBUG_CONTACT_IDS],
    pre_audit_remaining_count: intent.pre_audit_remaining_count,
    deleted_file_count: purged.deleted_count,
    removed_log_lines: purged.removed_log_lines,
    post_audit_remaining_count: after.remaining_count,
    non_debug_identity_scope_allowed: false,
    raw_message_content_included: false,
    secrets_included: false
  }
  const writeReceipt = options.writeReceipt || writePrivateReceiptExclusive
  writeReceipt(receiptPath, receipt)
  fs.unlinkSync(intentPath)
  fsyncDirectory(path.dirname(intentPath))
  return receipt
}

module.exports = {
  TEST_ACCOUNT_PURGE_ID,
  OMAR_SYSTEM_PURGE_ACKNOWLEDGEMENT,
  OMAR_SYSTEM_PURGE_RECEIPT_SCHEMA,
  TEST_ACCOUNT_GMAIL_TOMBSTONE_FILENAME,
  TEST_ACCOUNT_RESET_WATERMARK_FILENAME,
  TEST_ACCOUNT_PURGE_DIRS,
  debugResetTombstonePath,
  readDebugResetTombstones,
  writeDebugResetTombstones,
  isPurgedTestAccountGmailUid,
  debugResetWatermarkPath,
  readDebugResetWatermarks,
  writeDebugResetWatermarks,
  debugResetBoundaryVerdict,
  orphanPacketPredatesDebugReset,
  splitCsv,
  shouldPurgeText,
  shouldPurgeRecord,
  auditTestAccountDebugState,
  purgeTestAccountDebugState,
  executePausedOmarSystemPurge,
  writePrivateReceiptExclusive
}

// Explicit operator surface for live debug resets. Deploys never invoke this
// automatically; the command names the one allowlisted account so a shell typo
// cannot widen the purge to customer state.
if (require.main === module) {
  const root = process.env.SCV_ROOT || __dirname
  const options = {
    root,
    usernames: DEBUG_USERNAMES_CSV,
    contactIds: DEBUG_CONTACT_IDS_CSV
  }
  let result
  if (process.argv.includes('--execute-omar-system')) {
    const receiptIndex = process.argv.indexOf('--receipt')
    const receipt = receiptIndex >= 0 ? process.argv[receiptIndex + 1] : ''
    if (!receipt || receipt.startsWith('--')) {
      console.error('omar system purge refused: --receipt is required')
      process.exit(2)
    }
    try {
      result = executePausedOmarSystemPurge({ ...options, receipt })
    } catch (error) {
      console.error(`omar system purge refused: ${String(error?.message || error)}`)
      process.exit(3)
    }
  } else if (process.argv.includes('--audit-omar-system')) {
    result = auditTestAccountDebugState(options)
  } else {
    console.error('usage: node scv-test-account-purge.js --audit-omar-system | --execute-omar-system')
    process.exit(2)
  }
  console.log(JSON.stringify(result, null, 2))
  if (Number(result.remaining_count || 0) !== 0) process.exit(1)
}
