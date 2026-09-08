#!/usr/bin/env node

// Safe recovery for archived Instagram conversation memory.
//
// Contract:
// - dry-run is the default;
// - --execute is refused unless SCV_PAUSE_ALL=1;
// - only thread-state/*.json and thread-history/*.json are read or restored;
// - the canonical Omar/Omal debug identity is always excluded;
// - target/live state wins unless a source state has a newer interaction time;
// - histories are unioned deterministically and target events win collisions;
// - every pre-existing target memory file is backed up before any write;
// - committed JSON writes are atomic;
// - a synchronous write failure rolls all attempted memory writes back;
// - a private durable journal makes a killed process recoverable on the next
//   paused --execute, which rolls back and forces a fresh dry-run;
// - the emitted receipt contains aggregate counts and hashes, never message or
//   contact data.

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  DEBUG_CONTACT_IDS,
  DEBUG_USERNAMES
} = require('./scv-debug-identity')
const { shouldPurgeRecord } = require('./scv-test-account-purge')
const {
  namespacedPersistRoot,
  pathInside,
  runtimeNamespaceFromEnv
} = require('./scv-runtime-namespace')

const STATE_DIR = 'thread-state'
const HISTORY_DIR = 'thread-history'
const RECEIPT_DIR = 'recovery-receipts'
const BACKUP_DIR = '.scv-recovery-backups'
const TRANSACTION_JOURNAL = '.scv-recovery-transaction.json'
const JSON_FILE_RE = /^[A-Za-z0-9._-]+\.json$/
const SHA256_RE = /^[a-f0-9]{64}$/
const BACKUP_TOKEN_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024
const STATE_TIME_FIELDS = Object.freeze([
  'source_interaction_at',
  'recovered_from_ig_last_interaction',
  'manychat_latest_interaction_at',
  'recovered_from_at',
  'received_at',
  'at',
  'queued_at',
  'created_at',
  'last_interaction_at',
  'last_message_at'
])
const EVENT_TIME_FIELDS = Object.freeze([
  'at',
  'source_interaction_at',
  'received_at',
  'created_at',
  'timestamp'
])

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableObject(value[key])])
  )
}

function stableJson(value) {
  return JSON.stringify(stableObject(value))
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function jsonOutput(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function parseTime(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return value < 1e12 ? value * 1000 : value
  }
  const raw = String(value).trim()
  if (!raw) return null
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw)
    return raw.length <= 10 ? numeric * 1000 : numeric
  }
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function firstKnownTime(object, fields) {
  for (const field of fields) {
    const parsed = parseTime(object?.[field])
    if (parsed !== null) return parsed
  }
  return null
}

function stateTime(record) {
  // Filesystem mtime is deployment/migration bookkeeping, not evidence of when
  // a customer interacted. Unknown source time can never prove a source is
  // newer than live state.
  return firstKnownTime(record.value, STATE_TIME_FIELDS)
}

function safeBaseName(filePath) {
  const base = path.basename(filePath)
  if (!JSON_FILE_RE.test(base) || base !== filePath) {
    throw new Error(`unsafe memory filename: ${base}`)
  }
  return base
}

function isCanonicalDebugRecord(value, basename, raw = '') {
  const serialized = raw || JSON.stringify(value)
  return shouldPurgeRecord(
    serialized,
    basename,
    [...DEBUG_USERNAMES],
    [...DEBUG_CONTACT_IDS]
  )
}

function canonicalThreadKey(value, basename) {
  const contactId = String(value?.contact_id || '').trim()
  const threadId = String(value?.thread_id || '').trim()
  const fileId = basename.replace(/\.json$/i, '')
  if (contactId && threadId && contactId !== threadId) {
    throw new Error('contact_id and thread_id disagree')
  }
  const key = contactId || threadId || fileId
  if (!key || /[\\/\0]/.test(key)) throw new Error('missing or unsafe thread identity')
  if ((contactId || threadId) && fileId !== key) {
    throw new Error('filename and JSON thread identity disagree')
  }
  return key
}

function validateMemoryValue(kind, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${kind} must be a JSON object`)
  }
  if (kind === 'history') {
    if (!Array.isArray(value.events)) throw new Error('history events must be an array')
    for (const event of value.events) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new Error('history event must be a JSON object')
      }
    }
  }
}

function ensureFlatMemoryDirectory(directory, allowMissing, allowedSymlinkTarget = '') {
  if (!fs.existsSync(directory)) {
    if (allowMissing) return []
    throw new Error(`memory directory does not exist: ${path.basename(directory)}`)
  }
  const dirStat = fs.lstatSync(directory)
  if (dirStat.isSymbolicLink()) {
    if (!allowedSymlinkTarget) {
      throw new Error(`memory directory symlink is not authorized: ${path.basename(directory)}`)
    }
    const actual = fs.realpathSync(directory)
    const expected = fs.realpathSync(allowedSymlinkTarget)
    if (path.resolve(actual) !== path.resolve(expected) || !fs.statSync(actual).isDirectory()) {
      throw new Error(`memory directory symlink target mismatch: ${path.basename(directory)}`)
    }
  } else if (!dirStat.isDirectory()) {
    throw new Error(`memory path is not a real directory: ${path.basename(directory)}`)
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`memory directory must be flat and contain regular files only: ${entry.name}`)
    }
  }
  return entries.filter((entry) => entry.name.endsWith('.json')).map((entry) => entry.name).sort()
}

function readCollection(root, directoryName, kind, origin, counts, inventory, options = {}) {
  const directory = path.join(root, directoryName)
  const names = ensureFlatMemoryDirectory(
    directory,
    origin.type === 'target',
    String(options.allowedSymlinkTarget || '')
  )
  const records = []
  for (const name of names) {
    if (!JSON_FILE_RE.test(name)) {
      counts.invalid_schema_files += 1
      continue
    }
    const file = path.join(directory, name)
    const fileStat = fs.lstatSync(file)
    const raw = fs.readFileSync(file, 'utf8')
    const rawHash = sha256(raw)
    inventory.push(`${origin.type}:${origin.index}:${kind}:${name}:${rawHash}`)
    counts[`${origin.type}_${kind}_files`] += 1
    let value
    try {
      value = JSON.parse(raw)
    } catch {
      counts.invalid_json_files += 1
      continue
    }
    try {
      validateMemoryValue(kind, value)
      const key = canonicalThreadKey(value, name)
      records.push({
        basename: name,
        file,
        isCanonicalDebug: isCanonicalDebugRecord(value, name, raw),
        key,
        kind,
        mtimeMs: fileStat.mtimeMs,
        origin,
        raw,
        rawHash,
        value
      })
    } catch {
      counts.invalid_schema_files += 1
    }
  }
  return records
}

function applyIdentityExclusions(records, counts, debugKeys) {
  return records.filter((record) => {
    // Debug identity is a thread-level property. If any state/history record in
    // any archive identifies the key as canonical debug, every record for that
    // key is excluded. This prevents an incomplete sibling record from leaking
    // Omar/Omal memory into a restore.
    if (debugKeys.has(record.key)) {
      counts.excluded_debug_files += 1
      return false
    }
    // Preserve every non-debug memory key, including non-numeric historical
    // keys. The operator contract excludes only the canonical Omar/Omal debug
    // identity; active queues are never restored by this tool.
    return true
  })
}

function detectDuplicateRecords(records, counts) {
  const seen = new Set()
  for (const record of records) {
    const key = `${record.origin.type}:${record.origin.index}:${record.kind}:${record.key}`
    if (seen.has(key)) counts.duplicate_thread_files += 1
    seen.add(key)
  }
}

function sourceRank(record) {
  if (record.origin.type === 'target') return -1
  return record.origin.index
}

function selectNewestState(records) {
  const ordered = [...records].sort((left, right) => {
    const leftTime = stateTime(left)
    const rightTime = stateTime(right)
    if (leftTime !== null || rightTime !== null) {
      if (leftTime === null) return 1
      if (rightTime === null) return -1
      const timeDifference = rightTime - leftTime
      if (timeDifference) return timeDifference
    }
    const targetDifference = sourceRank(left) - sourceRank(right)
    if (targetDifference) return targetDifference
    const hashDifference = left.rawHash.localeCompare(right.rawHash)
    if (hashDifference) return hashDifference
    return left.basename.localeCompare(right.basename)
  })
  const target = ordered.find((record) => record.origin.type === 'target')
  if (!target) return ordered[0]
  const targetTime = stateTime(target)
  if (targetTime === null) return target
  return ordered.find((record) =>
    record.origin.type !== 'target' &&
    stateTime(record) !== null &&
    stateTime(record) > targetTime
  ) || target
}

function eventIdentity(event) {
  const explicit = event.event_id ?? event.ig_event_id ?? event.webhook_event_id ?? event.id
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    return `event:${sha256(String(explicit).trim())}`
  }
  const messageId = event.message_id ?? event.mid ?? event.instagram_message_id
  if (messageId !== undefined && messageId !== null && String(messageId).trim()) {
    const stableIdentity = {
      bubble_index: event.bubble_index ?? null,
      direction: event.direction ?? null,
      message_id: String(messageId).trim(),
      role: event.role ?? null,
      type: event.type ?? null
    }
    return `message:${sha256(stableJson(stableIdentity))}`
  }
  return `hash:${sha256(stableJson(event))}`
}

function eventTime(event) {
  return firstKnownTime(event, EVENT_TIME_FIELDS) ?? Number.MAX_SAFE_INTEGER
}

function eventWithoutTimeFields(event) {
  return Object.fromEntries(
    Object.entries(event).filter(([key]) => !EVENT_TIME_FIELDS.includes(key))
  )
}

function isAssistantAttempt(event) {
  return event?.role === 'assistant_attempted' || event?.type === 'assistant_attempted'
}

function resolveHistoryIdentity(identity, candidates, counts) {
  const uniqueByPayload = new Map()
  for (const candidate of candidates) {
    const payload = stableJson(candidate.event)
    if (!uniqueByPayload.has(payload)) uniqueByPayload.set(payload, candidate)
  }
  let variants = [...uniqueByPayload.values()]
  if (variants.length === 1) return variants.map((candidate) => ({ identity, event: candidate.event }))

  counts.history_event_conflict_groups_seen += 1
  const targetVariants = variants.filter((candidate) => candidate.record.origin.type === 'target')
  if (targetVariants.length) {
    // Existing live history is authoritative over archived variants for the
    // same provider identity. Ambiguity inside the target itself is still
    // resolved by the narrow rules below or fails validation.
    counts.history_event_target_conflict_groups_resolved += 1
    variants = targetVariants
    if (variants.length === 1) return variants.map((candidate) => ({ identity, event: candidate.event }))
  }

  const contentShapes = new Set(
    variants.map((candidate) => stableJson(eventWithoutTimeFields(candidate.event)))
  )
  if (contentShapes.size === 1) {
    counts.history_event_temporal_conflict_groups_resolved += 1
    const earliest = [...variants].sort((left, right) => {
      const timeDifference = eventTime(left.event) - eventTime(right.event)
      if (timeDifference) return timeDifference
      return stableJson(left.event).localeCompare(stableJson(right.event))
    })[0]
    return [{ identity, event: earliest.event }]
  }

  if (variants.every((candidate) => isAssistantAttempt(candidate.event))) {
    counts.history_event_attempt_conflict_groups_preserved += 1
    counts.history_event_attempt_variants_preserved += variants.length
    return variants.map((candidate) => ({ identity, event: candidate.event }))
  }

  counts.history_event_unresolved_conflict_groups += 1
  // Keep the plan deterministic for audit output, but validation fails and
  // execute is refused while any unresolved identity conflict exists.
  return [{ identity, event: variants[0].event }]
}

function mergeHistory(records, counts) {
  const orderedRecords = [...records].sort((left, right) => {
    const rankDifference = sourceRank(left) - sourceRank(right)
    if (rankDifference) return rankDifference
    return left.rawHash.localeCompare(right.rawHash)
  })
  const byIdentity = new Map()
  for (const record of orderedRecords) {
    for (const event of record.value.events) {
      counts.history_events_seen += 1
      const identity = eventIdentity(event)
      if (!byIdentity.has(identity)) byIdentity.set(identity, [])
      byIdentity.get(identity).push({ event, record })
    }
  }
  const events = [...byIdentity.entries()]
    .flatMap(([identity, candidates]) => resolveHistoryIdentity(identity, candidates, counts))
    .sort((left, right) => {
      const timeDifference = eventTime(left.event) - eventTime(right.event)
      if (timeDifference) return timeDifference
      const identityDifference = left.identity.localeCompare(right.identity)
      if (identityDifference) return identityDifference
      return stableJson(left.event).localeCompare(stableJson(right.event))
    })
    .map(({ event }) => event)
  counts.history_events_unique += events.length
  counts.history_events_deduped += orderedRecords.reduce(
    (total, record) => total + record.value.events.length,
    0
  ) - events.length

  const target = orderedRecords.find((record) => record.origin.type === 'target')
  const base = target || [...orderedRecords].sort((left, right) => {
    const leftNewest = Math.max(...left.value.events.map(eventTime), stateTime(left))
    const rightNewest = Math.max(...right.value.events.map(eventTime), stateTime(right))
    if (rightNewest !== leftNewest) return rightNewest - leftNewest
    return left.rawHash.localeCompare(right.rawHash)
  })[0]
  return { ...base.value, events }
}

function groupByThread(records) {
  const groups = new Map()
  for (const record of records) {
    if (!groups.has(record.key)) groups.set(record.key, [])
    groups.get(record.key).push(record)
  }
  return groups
}

function planCollection(kind, sourceRecords, targetRecords, counts) {
  const sourceGroups = groupByThread(sourceRecords)
  const targetGroups = groupByThread(targetRecords)
  const keys = [...new Set([...sourceGroups.keys(), ...targetGroups.keys()])].sort()
  const writes = []
  for (const key of keys) {
    const sources = sourceGroups.get(key) || []
    const targets = targetGroups.get(key) || []
    const records = [...targets, ...sources]
    if (!sources.length) continue
    counts[`${kind}_threads_considered`] += 1
    const target = targets[0]
    let value
    let basename
    if (kind === 'state') {
      const chosen = selectNewestState(records)
      value = chosen.value
      basename = target?.basename || chosen.basename
      if (chosen.origin.type === 'target') counts.state_target_preserved += 1
    } else {
      value = mergeHistory(records, counts)
      basename = target?.basename || sources[0].basename
    }
    const existingHash = target ? sha256(stableJson(target.value)) : null
    const outputHash = sha256(stableJson(value))
    if (existingHash === outputHash) {
      counts[`${kind}_unchanged`] += 1
      continue
    }
    counts[`${kind}_writes_planned`] += 1
    writes.push({
      basename,
      kind,
      outputHash,
      targetRawHash: target?.rawHash || null,
      value
    })
  }
  return writes
}

function initialCounts(sourceCount) {
  return {
    sources: sourceCount,
    source_state_files: 0,
    source_history_files: 0,
    target_state_files: 0,
    target_history_files: 0,
    invalid_json_files: 0,
    invalid_schema_files: 0,
    duplicate_thread_files: 0,
    excluded_debug_files: 0,
    excluded_synthetic_files: 0,
    state_threads_considered: 0,
    history_threads_considered: 0,
    state_target_preserved: 0,
    state_unchanged: 0,
    history_unchanged: 0,
    state_writes_planned: 0,
    history_writes_planned: 0,
    history_events_seen: 0,
    history_events_unique: 0,
    history_events_deduped: 0,
    history_event_conflict_groups_seen: 0,
    history_event_target_conflict_groups_resolved: 0,
    history_event_temporal_conflict_groups_resolved: 0,
    history_event_attempt_conflict_groups_preserved: 0,
    history_event_attempt_variants_preserved: 0,
    history_event_unresolved_conflict_groups: 0,
    target_files_backed_up: 0,
    writes_committed: 0,
    writes_rolled_back: 0,
    queue_directories_touched: 0
  }
}

function canonicalRoot(candidate) {
  const resolved = path.resolve(candidate)
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) {
    throw new Error('refusing broad recovery root')
  }
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error('recovery roots may not be symlinks')
  }
  return resolved
}

function allowedTargetDirectorySymlinks(env = process.env) {
  const persistRoot = String(env.SCV_PERSIST_ROOT || env.RAILWAY_VOLUME_MOUNT_PATH || '').trim()
  if (!persistRoot || !path.isAbsolute(persistRoot)) return {}
  const effectiveRoot = namespacedPersistRoot(persistRoot, runtimeNamespaceFromEnv(env))
  if (!fs.existsSync(persistRoot) || !fs.statSync(persistRoot).isDirectory()) {
    throw new Error('configured persistent recovery root is unavailable')
  }
  if (!fs.existsSync(effectiveRoot)) {
    throw new Error('configured persistent recovery namespace is unavailable')
  }
  const effectiveStat = fs.lstatSync(effectiveRoot)
  if (!effectiveStat.isDirectory() || effectiveStat.isSymbolicLink()) {
    throw new Error('persistent recovery namespace must be a real directory')
  }
  const realPersistRoot = fs.realpathSync(persistRoot)
  const realEffectiveRoot = fs.realpathSync(effectiveRoot)
  if (!pathInside(realPersistRoot, realEffectiveRoot)) {
    throw new Error('persistent recovery namespace escapes configured root')
  }
  const targets = {
    [STATE_DIR]: path.join(effectiveRoot, STATE_DIR),
    [HISTORY_DIR]: path.join(effectiveRoot, HISTORY_DIR)
  }
  for (const [directoryName, target] of Object.entries(targets)) {
    if (!fs.existsSync(target)) {
      throw new Error(`persistent recovery directory is unavailable: ${directoryName}`)
    }
    const targetStat = fs.lstatSync(target)
    const realTarget = fs.realpathSync(target)
    if (!targetStat.isDirectory() || targetStat.isSymbolicLink() || !pathInside(realEffectiveRoot, realTarget)) {
      throw new Error(`persistent recovery directory escapes namespace: ${directoryName}`)
    }
  }
  return targets
}

function recoveryArtifactRoot(targetRoot, targetSymlinks = {}) {
  const configured = [STATE_DIR, HISTORY_DIR].filter((name) => targetSymlinks[name])
  if (!configured.length) return targetRoot
  if (configured.length !== 2) throw new Error('persistent recovery directory map is incomplete')

  const roots = []
  for (const directoryName of configured) {
    const liveDirectory = path.join(targetRoot, directoryName)
    if (!fs.existsSync(liveDirectory) || !fs.lstatSync(liveDirectory).isSymbolicLink()) {
      throw new Error(`persistent recovery binding missing: ${directoryName}`)
    }
    const actual = fs.realpathSync(liveDirectory)
    const expected = fs.realpathSync(targetSymlinks[directoryName])
    if (path.resolve(actual) !== path.resolve(expected)) {
      throw new Error(`persistent recovery binding mismatch: ${directoryName}`)
    }
    roots.push(path.dirname(expected))
  }
  if (path.resolve(roots[0]) !== path.resolve(roots[1])) {
    throw new Error('persistent recovery directories do not share a namespace')
  }
  return roots[0]
}

function buildRecoveryPlan({ sources, target, env = process.env }) {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('at least one --source is required')
  if (!target) throw new Error('--target is required')
  const sourceRoots = sources.map(canonicalRoot)
  const targetRoot = canonicalRoot(target)
  const targetSymlinks = allowedTargetDirectorySymlinks(env)
  if (sourceRoots.includes(targetRoot)) throw new Error('target may not also be a source')
  for (const root of sourceRoots) {
    if (!fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
      throw new Error('source root does not exist or is not a directory')
    }
  }

  const counts = initialCounts(sourceRoots.length)
  const inventory = []
  const sourceStateAll = []
  const sourceHistoryAll = []
  sourceRoots.forEach((root, index) => {
    sourceStateAll.push(...readCollection(
      root,
      STATE_DIR,
      'state',
      { type: 'source', index },
      counts,
      inventory
    ))
    sourceHistoryAll.push(...readCollection(
      root,
      HISTORY_DIR,
      'history',
      { type: 'source', index },
      counts,
      inventory
    ))
  })

  const targetStateAll = readCollection(
    targetRoot,
    STATE_DIR,
    'state',
    { type: 'target', index: 0 },
    counts,
    inventory,
    { allowedSymlinkTarget: targetSymlinks[STATE_DIR] }
  )
  const targetHistoryAll = readCollection(
    targetRoot,
    HISTORY_DIR,
    'history',
    { type: 'target', index: 0 },
    counts,
    inventory,
    { allowedSymlinkTarget: targetSymlinks[HISTORY_DIR] }
  )
  const allRecords = [
    ...sourceStateAll,
    ...sourceHistoryAll,
    ...targetStateAll,
    ...targetHistoryAll
  ]
  const debugKeys = new Set(
    allRecords.filter((record) => record.isCanonicalDebug).map((record) => record.key)
  )
  const sourceState = applyIdentityExclusions(sourceStateAll, counts, debugKeys)
  const sourceHistory = applyIdentityExclusions(sourceHistoryAll, counts, debugKeys)
  const targetState = applyIdentityExclusions(targetStateAll, counts, debugKeys)
  const targetHistory = applyIdentityExclusions(targetHistoryAll, counts, debugKeys)
  const artifactRoot = recoveryArtifactRoot(targetRoot, targetSymlinks)
  detectDuplicateRecords([...sourceState, ...sourceHistory, ...targetState, ...targetHistory], counts)

  const writes = [
    ...planCollection('state', sourceState, targetState, counts),
    ...planCollection('history', sourceHistory, targetHistory, counts)
  ].sort((left, right) => {
    const kindDifference = left.kind.localeCompare(right.kind)
    if (kindDifference) return kindDifference
    return left.basename.localeCompare(right.basename)
  })
  const validationPassed = counts.invalid_json_files === 0 &&
    counts.invalid_schema_files === 0 &&
    counts.duplicate_thread_files === 0 &&
    counts.history_event_unresolved_conflict_groups === 0
  return {
    counts,
    hashes: {
      input_inventory_sha256: sha256(inventory.sort().join('\n')),
      plan_sha256: sha256(writes.map((write) => `${write.kind}:${write.basename}:${write.outputHash}`).join('\n'))
    },
    sourceRoots,
    targetRoot,
    targetSymlinks,
    artifactRoot,
    validationPassed,
    writes
  }
}

function ensureTargetDirectories(targetRoot, targetSymlinks = {}) {
  if (!fs.existsSync(targetRoot)) fs.mkdirSync(targetRoot, { recursive: true, mode: 0o700 })
  if (!fs.lstatSync(targetRoot).isDirectory() || fs.lstatSync(targetRoot).isSymbolicLink()) {
    throw new Error('target root must be a real directory')
  }
  for (const directoryName of [STATE_DIR, HISTORY_DIR]) {
    const directory = path.join(targetRoot, directoryName)
    if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 })
    ensureFlatMemoryDirectory(directory, false, targetSymlinks[directoryName])
  }
}

function atomicWrite(file, content) {
  const directory = path.dirname(file)
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  )
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, content, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.renameSync(temporary, file)
    const directoryDescriptor = fs.openSync(directory, 'r')
    try {
      fs.fsyncSync(directoryDescriptor)
    } finally {
      fs.closeSync(directoryDescriptor)
    }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    throw error
  }
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function transactionJournalPath(artifactRoot) {
  return path.join(artifactRoot, TRANSACTION_JOURNAL)
}

function pathEntryExists(file) {
  try {
    fs.lstatSync(file)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function validateTransactionJournal(value) {
  if (!hasExactKeys(value, ['schema', 'backup_token', 'plan_sha256', 'writes']) ||
      value.schema !== 'scv_non_debug_history_recovery_transaction_v1' ||
      !BACKUP_TOKEN_RE.test(String(value.backup_token || '')) ||
      !SHA256_RE.test(String(value.plan_sha256 || '')) ||
      !Array.isArray(value.writes) || value.writes.length > 100000) {
    throw new Error('invalid recovery transaction journal')
  }
  const seen = new Set()
  for (const write of value.writes) {
    if (!hasExactKeys(write, ['kind', 'basename', 'original_sha256', 'output_sha256']) ||
        !['state', 'history'].includes(write.kind) ||
        safeBaseName(String(write.basename || '')) !== write.basename ||
        (write.original_sha256 !== null && !SHA256_RE.test(String(write.original_sha256 || ''))) ||
        !SHA256_RE.test(String(write.output_sha256 || ''))) {
      throw new Error('invalid recovery transaction write entry')
    }
    const key = `${write.kind}:${write.basename}`
    if (seen.has(key)) throw new Error('duplicate recovery transaction write entry')
    seen.add(key)
  }
  return value
}

function readTransactionJournal(artifactRoot) {
  const file = transactionJournalPath(artifactRoot)
  const stat = fs.lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > MAX_JOURNAL_BYTES) {
    throw new Error('recovery transaction journal is not a private regular file')
  }
  let value
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error('recovery transaction journal is not valid JSON')
  }
  return validateTransactionJournal(value)
}

function createTransactionJournal(artifactRoot, journal) {
  validateTransactionJournal(journal)
  const file = transactionJournalPath(artifactRoot)
  if (pathEntryExists(file)) throw new Error('pending recovery transaction already exists')
  const temporary = path.join(
    artifactRoot,
    `.${TRANSACTION_JOURNAL}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  )
  let descriptor
  let linked = false
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.fchmodSync(descriptor, 0o600)
    fs.writeFileSync(descriptor, jsonOutput(journal), 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    fs.linkSync(temporary, file)
    linked = true
    fsyncDirectory(artifactRoot)
    fs.unlinkSync(temporary)
    fsyncDirectory(artifactRoot)
    return file
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    // Once linked, leave the durable journal in place. No memory write may
    // begin because this function did not return successfully.
    if (linked && fs.existsSync(file)) {
      try { fsyncDirectory(artifactRoot) } catch {}
    }
    throw error
  }
}

function removeTransactionJournal(artifactRoot) {
  const file = transactionJournalPath(artifactRoot)
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('refusing unsafe recovery transaction journal removal')
    }
    fs.unlinkSync(file)
    fsyncDirectory(artifactRoot)
  }
}

function removeAbortedBackup(artifactRoot, backupToken) {
  if (!BACKUP_TOKEN_RE.test(String(backupToken || ''))) {
    throw new Error('refusing invalid aborted recovery backup token')
  }
  const resolvedArtifactRoot = path.resolve(artifactRoot)
  const backupParent = path.join(resolvedArtifactRoot, BACKUP_DIR)
  const backupRoot = path.join(backupParent, backupToken)
  if (!pathEntryExists(backupRoot)) return false
  if (!pathEntryExists(backupParent)) {
    throw new Error('aborted recovery backup parent is missing')
  }
  const parentStat = fs.lstatSync(backupParent)
  const rootStat = fs.lstatSync(backupRoot)
  if (
    !parentStat.isDirectory() || parentStat.isSymbolicLink() ||
    !rootStat.isDirectory() || rootStat.isSymbolicLink() ||
    path.dirname(path.resolve(backupRoot)) !== path.resolve(backupParent)
  ) throw new Error('refusing unsafe aborted recovery backup removal')

  const pending = [backupRoot]
  let checked = 0
  while (pending.length) {
    const current = pending.pop()
    const currentStat = fs.lstatSync(current)
    if (currentStat.isSymbolicLink() || (!currentStat.isDirectory() && !currentStat.isFile())) {
      throw new Error('aborted recovery backup contains unsafe entry')
    }
    checked += 1
    if (checked > 200000) throw new Error('aborted recovery backup entry limit exceeded')
    if (currentStat.isDirectory()) {
      for (const name of fs.readdirSync(current)) pending.push(path.join(current, name))
    }
  }
  fs.rmSync(backupRoot, { recursive: true, force: false })
  fsyncDirectory(backupParent)
  return true
}

function makeTransactionJournal(plan, destinations, backupToken) {
  return validateTransactionJournal({
    schema: 'scv_non_debug_history_recovery_transaction_v1',
    backup_token: backupToken,
    plan_sha256: plan.hashes.plan_sha256,
    writes: destinations.map(({ write }) => ({
      kind: write.kind,
      basename: write.basename,
      original_sha256: write.targetRawHash,
      output_sha256: sha256(jsonOutput(write.value))
    }))
  })
}

function rollbackAttemptedWrites(attempted, backupRoot, counts) {
  let rollbackError = null
  for (const item of [...attempted].reverse()) {
    try {
      if (item.write.targetRawHash) {
        const backup = path.join(backupRoot, item.directoryName, safeBaseName(item.write.basename))
        if (!fs.existsSync(backup)) throw new Error('pre-recovery backup is missing')
        atomicWrite(item.destination, fs.readFileSync(backup, 'utf8'))
      } else if (fs.existsSync(item.destination)) {
        fs.unlinkSync(item.destination)
        fsyncDirectory(path.dirname(item.destination))
      }
      counts.writes_rolled_back += 1
    } catch (error) {
      if (!rollbackError) rollbackError = error
    }
  }
  counts.writes_committed = 0
  if (rollbackError) throw rollbackError
}

function validateCommittedTransactionReceipt(file, journal, targetRoot) {
  const directoryStat = fs.lstatSync(path.dirname(file))
  const fileStat = fs.lstatSync(file)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
      !fileStat.isFile() || fileStat.isSymbolicLink() ||
      (fileStat.mode & 0o077) !== 0 || fileStat.size > MAX_JOURNAL_BYTES) {
    throw new Error('pending recovery receipt path is unsafe')
  }
  let receipt
  try {
    receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new Error('pending recovery receipt is not valid JSON')
  }
  if (!hasExactKeys(receipt, ['schema', 'generated_at', 'mode', 'safety', 'counts', 'hashes']) ||
      receipt.schema !== 'scv_non_debug_history_recovery_receipt_v1' ||
      receipt.mode !== 'execute' ||
      !hasExactKeys(receipt.safety, [
        'backup_created',
        'canonical_debug_identity_excluded',
        'pause_all_verified',
        'queue_directories_touched',
        'validation_passed'
      ]) ||
      receipt.safety.backup_created !== true ||
      receipt.safety.canonical_debug_identity_excluded !== true ||
      receipt.safety.pause_all_verified !== true ||
      receipt.safety.queue_directories_touched !== 0 ||
      receipt.safety.validation_passed !== true ||
      !receipt.counts || typeof receipt.counts !== 'object' || Array.isArray(receipt.counts) ||
      receipt.counts.writes_committed !== journal.writes.length ||
      receipt.counts.writes_rolled_back !== 0 ||
      !hasExactKeys(receipt.hashes, [
        'input_inventory_sha256',
        'plan_sha256',
        'receipt_sha256'
      ]) ||
      !SHA256_RE.test(String(receipt.hashes.input_inventory_sha256 || '')) ||
      receipt.hashes.plan_sha256 !== journal.plan_sha256 ||
      !SHA256_RE.test(String(receipt.hashes.receipt_sha256 || ''))) {
    throw new Error('pending recovery receipt contract mismatch')
  }
  const generated = new Date(receipt.generated_at)
  if (!Number.isFinite(generated.getTime()) || generated.toISOString() !== receipt.generated_at ||
      timestampToken(generated) !== journal.backup_token) {
    throw new Error('pending recovery receipt timestamp mismatch')
  }
  const claimedReceiptHash = receipt.hashes.receipt_sha256
  const receiptWithoutHash = JSON.parse(JSON.stringify(receipt))
  delete receiptWithoutHash.hashes.receipt_sha256
  if (sha256(stableJson(receiptWithoutHash)) !== claimedReceiptHash) {
    throw new Error('pending recovery receipt hash mismatch')
  }
  for (const write of journal.writes) {
    const directoryName = write.kind === 'state' ? STATE_DIR : HISTORY_DIR
    const destination = path.join(targetRoot, directoryName, safeBaseName(write.basename))
    if (!fs.existsSync(destination)) {
      throw new Error('pending committed recovery output is missing')
    }
    const destinationStat = fs.lstatSync(destination)
    if (!destinationStat.isFile() || destinationStat.isSymbolicLink() ||
        sha256(fs.readFileSync(destination, 'utf8')) !== write.output_sha256) {
      throw new Error('pending committed recovery output hash mismatch')
    }
  }
  return receipt
}

function recoverPendingTransaction(targetRoot, artifactRoot, targetSymlinks = {}) {
  const journal = readTransactionJournal(artifactRoot)
  const pendingReceipt = path.join(
    artifactRoot,
    RECEIPT_DIR,
    `non-debug-memory-recovery-${journal.backup_token}.json`
  )
  for (const directoryName of [STATE_DIR, HISTORY_DIR]) {
    ensureFlatMemoryDirectory(
      path.join(targetRoot, directoryName),
      false,
      targetSymlinks[directoryName]
    )
  }
  if (pathEntryExists(pendingReceipt)) {
    validateCommittedTransactionReceipt(pendingReceipt, journal, targetRoot)
    removeTransactionJournal(artifactRoot)
    return { files_checked: journal.writes.length, outcome: 'committed_finalized' }
  }

  const backupRoot = path.join(artifactRoot, BACKUP_DIR, journal.backup_token)
  if (fs.existsSync(backupRoot)) {
    const backupStat = fs.lstatSync(backupRoot)
    if (!backupStat.isDirectory() || backupStat.isSymbolicLink() ||
        !pathInside(fs.realpathSync(artifactRoot), fs.realpathSync(backupRoot))) {
      throw new Error('pending recovery backup path is unsafe')
    }
  }

  const actions = []
  for (const write of journal.writes) {
    const directoryName = write.kind === 'state' ? STATE_DIR : HISTORY_DIR
    const destination = path.join(targetRoot, directoryName, safeBaseName(write.basename))
    const exists = fs.existsSync(destination)
    let currentHash = null
    if (exists) {
      const stat = fs.lstatSync(destination)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('pending recovery destination is unsafe')
      }
      currentHash = sha256(fs.readFileSync(destination, 'utf8'))
    }

    if (write.original_sha256 === null) {
      if (!exists) {
        actions.push({ action: 'none', destination, write })
      } else if (currentHash === write.output_sha256) {
        actions.push({ action: 'delete', destination, write })
      } else {
        throw new Error('pending recovery destination has an unknown mutation')
      }
      continue
    }

    if (currentHash === write.original_sha256) {
      actions.push({ action: 'none', destination, write })
      continue
    }
    if (currentHash !== write.output_sha256) {
      throw new Error('pending recovery destination has an unknown mutation')
    }
    const backup = path.join(backupRoot, directoryName, safeBaseName(write.basename))
    if (!fs.existsSync(backup)) throw new Error('pending recovery file backup is missing')
    const backupFileStat = fs.lstatSync(backup)
    if (!backupFileStat.isFile() || backupFileStat.isSymbolicLink() ||
        sha256(fs.readFileSync(backup, 'utf8')) !== write.original_sha256) {
      throw new Error('pending recovery file backup is invalid')
    }
    actions.push({ action: 'restore', backup, destination, write })
  }

  for (const item of [...actions].reverse()) {
    if (item.action === 'restore') {
      atomicWrite(item.destination, fs.readFileSync(item.backup, 'utf8'))
    } else if (item.action === 'delete' && fs.existsSync(item.destination)) {
      fs.unlinkSync(item.destination)
      fsyncDirectory(path.dirname(item.destination))
    }
  }
  for (const item of actions) {
    const exists = fs.existsSync(item.destination)
    if (item.write.original_sha256 === null) {
      if (exists) throw new Error('pending recovery rollback verification failed')
    } else if (!exists || sha256(fs.readFileSync(item.destination, 'utf8')) !== item.write.original_sha256) {
      throw new Error('pending recovery rollback verification failed')
    }
  }
  removeAbortedBackup(artifactRoot, journal.backup_token)
  removeTransactionJournal(artifactRoot)
  return { files_checked: actions.length, outcome: 'rolled_back' }
}

function timestampToken(now) {
  return now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')
}

function backupPreexistingMemory(targetRoot, artifactRoot, now, counts, targetSymlinks = {}) {
  const backupRoot = path.join(artifactRoot, BACKUP_DIR, timestampToken(now))
  for (const directoryName of [STATE_DIR, HISTORY_DIR]) {
    const sourceDirectory = path.join(targetRoot, directoryName)
    const names = ensureFlatMemoryDirectory(
      sourceDirectory,
      false,
      targetSymlinks[directoryName]
    )
    const backupDirectory = path.join(backupRoot, directoryName)
    fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
    for (const name of names) {
      const source = path.join(sourceDirectory, name)
      const destination = path.join(backupDirectory, name)
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
      const descriptor = fs.openSync(destination, 'r')
      try {
        fs.fsyncSync(descriptor)
      } finally {
        fs.closeSync(descriptor)
      }
      counts.target_files_backed_up += 1
    }
    fsyncDirectory(backupDirectory)
  }
  fsyncDirectory(backupRoot)
  fsyncDirectory(path.dirname(backupRoot))
  fsyncDirectory(artifactRoot)
  return backupRoot
}

function makeReceipt({ plan, mode, now, pauseAllVerified, backupCreated }) {
  const receipt = {
    schema: 'scv_non_debug_history_recovery_receipt_v1',
    generated_at: now.toISOString(),
    mode,
    safety: {
      backup_created: backupCreated,
      canonical_debug_identity_excluded: true,
      pause_all_verified: pauseAllVerified,
      queue_directories_touched: plan.counts.queue_directories_touched,
      validation_passed: plan.validationPassed
    },
    counts: { ...plan.counts },
    hashes: { ...plan.hashes }
  }
  receipt.hashes.receipt_sha256 = sha256(stableJson(receipt))
  return receipt
}

function executePlan(plan, now) {
  ensureTargetDirectories(plan.targetRoot, plan.targetSymlinks)
  const destinations = plan.writes.map((write) => {
    const directoryName = write.kind === 'state' ? STATE_DIR : HISTORY_DIR
    const destination = path.join(plan.targetRoot, directoryName, safeBaseName(write.basename))
    return { write, directoryName, destination }
  })
  for (const { write, destination } of destinations) {
    const exists = fs.existsSync(destination)
    if (!write.targetRawHash && exists) {
      throw new Error('target changed after recovery plan was built')
    }
    if (write.targetRawHash) {
      if (!exists || sha256(fs.readFileSync(destination, 'utf8')) !== write.targetRawHash) {
        throw new Error('target changed after recovery plan was built')
      }
    }
  }
  const backupToken = timestampToken(now)
  // Older interrupted builds could create the timestamped backup before the
  // durable journal. Never reuse that directory: in a zero-write plan there
  // may be no COPYFILE_EXCL collision to reveal the stale contents. The exact
  // receipt path was already checked by runRecovery(), so a same-token backup
  // with neither receipt nor journal is an aborted orphan and is removed using
  // the same bounded no-link validation as normal rollback cleanup.
  removeAbortedBackup(plan.artifactRoot, backupToken)
  createTransactionJournal(
    plan.artifactRoot,
    makeTransactionJournal(plan, destinations, backupToken)
  )
  let backupRoot = path.join(plan.artifactRoot, BACKUP_DIR, backupToken)
  const attempted = []
  try {
    backupRoot = backupPreexistingMemory(
      plan.targetRoot,
      plan.artifactRoot,
      now,
      plan.counts,
      plan.targetSymlinks
    )
    for (const item of destinations) {
      attempted.push(item)
      atomicWrite(item.destination, jsonOutput(item.write.value))
      plan.counts.writes_committed += 1
    }
  } catch (error) {
    try {
      rollbackAttemptedWrites(attempted, backupRoot, plan.counts)
      removeAbortedBackup(plan.artifactRoot, backupToken)
      removeTransactionJournal(plan.artifactRoot)
    } catch (rollbackError) {
      throw new Error(`${error.message}; rollback failed: ${rollbackError.message}`)
    }
    throw new Error(`${error.message}; recovery writes rolled back`)
  }
  return { backupRoot, destinations, journalCreated: true }
}

function writeReceipt(artifactRoot, receipt, now) {
  const directory = path.join(artifactRoot, RECEIPT_DIR)
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) {
    throw new Error('receipt path must be a real directory')
  }
  const file = path.join(directory, `non-debug-memory-recovery-${timestampToken(now)}.json`)
  atomicWrite(file, jsonOutput(receipt))
  return file
}

function expectedReceiptPath(artifactRoot, now) {
  return path.join(
    artifactRoot,
    RECEIPT_DIR,
    `non-debug-memory-recovery-${timestampToken(now)}.json`
  )
}

function removeReceiptArtifactIfPresent(file) {
  if (!fs.existsSync(file)) return
  const directory = path.dirname(file)
  const directoryStat = fs.lstatSync(directory)
  const fileStat = fs.lstatSync(file)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
      !fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error('refusing unsafe recovery receipt cleanup')
  }
  fs.unlinkSync(file)
  fsyncDirectory(directory)
}

function runRecovery({
  sources,
  target,
  execute = false,
  env = process.env,
  now = new Date(),
  expectedInputInventorySha256 = '',
  expectedPlanSha256 = ''
}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('invalid recovery timestamp')
  const pauseAllVerified = String(env.SCV_PAUSE_ALL || '').trim() === '1'
  if (execute && !pauseAllVerified) {
    throw new Error('--execute requires SCV_PAUSE_ALL=1')
  }
  if (!target) throw new Error('--target is required')
  const pendingTargetRoot = canonicalRoot(target)
  const pendingTargetSymlinks = allowedTargetDirectorySymlinks(env)
  const pendingArtifactRoot = recoveryArtifactRoot(pendingTargetRoot, pendingTargetSymlinks)
  const pendingJournal = transactionJournalPath(pendingArtifactRoot)
  if (pathEntryExists(pendingJournal)) {
    if (!execute) {
      throw new Error('pending recovery transaction requires paused --execute rollback')
    }
    const pendingResult = recoverPendingTransaction(
      pendingTargetRoot,
      pendingArtifactRoot,
      pendingTargetSymlinks
    )
    if (pendingResult.outcome === 'committed_finalized') {
      throw new Error('pending committed recovery finalized; rerun dry-run before execute')
    }
    throw new Error('pending recovery transaction rolled back; rerun dry-run before execute')
  }
  const plan = buildRecoveryPlan({ sources, target, env })
  if (execute && !plan.validationPassed) {
    throw new Error('--execute refused because memory validation failed')
  }
  // An approved recovery executes only the exact inventory and plan bound by
  // the signed preparation receipt. This check occurs after the final plan is
  // built and before backup creation or the first destination write.
  const signedPlanLockRequested = Boolean(
    expectedInputInventorySha256 || expectedPlanSha256
  )
  if (execute && signedPlanLockRequested && (
    !expectedInputInventorySha256 ||
    plan.hashes.input_inventory_sha256 !== expectedInputInventorySha256
  )) throw new Error('--execute input inventory differs from signed preparation')
  if (execute && signedPlanLockRequested && (
    !expectedPlanSha256 ||
    plan.hashes.plan_sha256 !== expectedPlanSha256
  )) throw new Error('--execute plan differs from signed preparation')
  const receiptFile = expectedReceiptPath(plan.artifactRoot, now)
  if (execute && fs.existsSync(receiptFile)) {
    throw new Error('recovery receipt timestamp collision')
  }
  const transaction = execute ? executePlan(plan, now) : null
  const receipt = makeReceipt({
    plan,
    mode: execute ? 'execute' : 'dry_run',
    now,
    pauseAllVerified,
    backupCreated: execute
  })
  if (execute) {
    try {
      writeReceipt(plan.artifactRoot, receipt, now)
      if (transaction.journalCreated) removeTransactionJournal(plan.artifactRoot)
    } catch (error) {
      const cleanupErrors = []
      try {
        removeReceiptArtifactIfPresent(receiptFile)
      } catch (receiptCleanupError) {
        cleanupErrors.push(receiptCleanupError)
      }
      try {
        rollbackAttemptedWrites(transaction.destinations, transaction.backupRoot, plan.counts)
      } catch (rollbackError) {
        cleanupErrors.push(rollbackError)
      }
      if (!cleanupErrors.length) {
        try {
          removeAbortedBackup(plan.artifactRoot, path.basename(transaction.backupRoot))
        } catch (backupCleanupError) {
          cleanupErrors.push(backupCleanupError)
        }
      }
      if (!cleanupErrors.length && transaction.journalCreated) {
        try {
          removeTransactionJournal(plan.artifactRoot)
        } catch (journalCleanupError) {
          cleanupErrors.push(journalCleanupError)
        }
      }
      if (cleanupErrors.length) {
        throw new Error(`${error.message}; receipt failure cleanup failed: ${cleanupErrors[0].message}`)
      }
      throw new Error(`${error.message}; receipt failure recovery writes rolled back`)
    }
  }
  return receipt
}

function parseArguments(argv) {
  const sources = []
  let target = ''
  let execute = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--source') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--source requires a directory')
      sources.push(value)
      index += 1
    } else if (argument === '--target') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error('--target requires a directory')
      target = value
      index += 1
    } else if (argument === '--execute') {
      execute = true
    } else if (argument === '--dry-run') {
      execute = false
    } else if (argument === '--help' || argument === '-h') {
      return { help: true, sources, target, execute }
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return { help: false, sources, target, execute }
}

function usage() {
  return [
    'Usage:',
    '  node scv-restore-non-debug-history.js --source <archive-root> [--source <archive-root> ...] --target <live-root> [--dry-run]',
    '  SCV_PAUSE_ALL=1 node scv-restore-non-debug-history.js --source <archive-root> [--source <archive-root> ...] --target <live-root> --execute',
    '',
    'Dry-run is the default. The tool never reads or writes inbox/outbox/reaction queues.'
  ].join('\n')
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2))
    if (options.help) {
      process.stdout.write(`${usage()}\n`)
      process.exit(0)
    }
    const receipt = runRecovery(options)
    process.stdout.write(jsonOutput(receipt))
  } catch (error) {
    process.stderr.write(`scv memory recovery refused: ${error.message}\n`)
    process.exit(1)
  }
}

module.exports = {
  BACKUP_DIR,
  HISTORY_DIR,
  RECEIPT_DIR,
  STATE_DIR,
  TRANSACTION_JOURNAL,
  buildRecoveryPlan,
  allowedTargetDirectorySymlinks,
  recoveryArtifactRoot,
  eventIdentity,
  isCanonicalDebugRecord,
  mergeHistory,
  parseArguments,
  runRecovery,
  selectNewestState,
  stableJson
}
