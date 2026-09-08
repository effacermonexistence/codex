#!/usr/bin/env node
// Produce the three machine receipts that may be used to authorize a later
// non-debug memory restore. This command runs only inside the exact paused
// recovery_bootstrap deployment. It never restores memory and never reads or
// writes a queue payload as part of the recovery plan.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const {
  buildRecoveryPlan,
  runRecovery,
  stableJson
} = require('./scv-restore-non-debug-history.js')
const {
  SOURCE_PACKAGE_ROOT,
  descriptorFor,
  inspectArchive,
  prepareRecoverySourcePackages
} = require('./scv-recovery-source-packages.js')
const {
  normalizeCompiledReceiptBinding,
  verifyCompiledReceiptBinding,
  verifyCompiledSourcePackages
} = require('./scv-compiled-recovery-source-contract.js')
const {
  OMAR_SYSTEM_PURGE_RECEIPT_SCHEMA,
  TEST_ACCOUNT_PURGE_DIRS,
  shouldPurgeRecord
} = require('./scv-test-account-purge.js')
const {
  DEBUG_CONTACT_IDS,
  DEBUG_USERNAMES
} = require('./scv-debug-identity.js')

const PREPARATION_PRODUCER_SCHEMA =
  'scv-paused-bootstrap-recovery-evidence-producer-2026-08-20-v1'
const BACKUP_RECEIPT_SCHEMA =
  'scv-private-prewrite-memory-backup-receipt-2026-08-20-v1'
const EXPECTED_TARGET_ROOT = '/data/scv-runtime-namespaces/prod'
const EXPECTED_MANIFEST_PATH = path.join(__dirname, 'SCV_GOLDEN_PRODUCTION_RELEASE.json')
const EVIDENCE_DIRECTORY = 'recovery-preparation-evidence'
const MEMORY_DIRECTORIES = Object.freeze(['thread-state', 'thread-history'])
const OUTPUT_FILES = Object.freeze(['backup.tar.gz', 'backup.json', 'dry-run.json'])
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_RE = /^[a-f0-9]{64}$/
const RELEASE_ID_RE = /^scv-instagram-golden-production-[A-Za-z0-9._-]+$/
const JSON_BASENAME_RE = /^[A-Za-z0-9._-]+\.json$/
const MAX_CONTROL_JSON_BYTES = 8 * 1024 * 1024
const MAX_MEMORY_JSON_BYTES = 8 * 1024 * 1024
const MAX_MEMORY_FILES = 50000
const MAX_MEMORY_TOTAL_BYTES = 192 * 1024 * 1024
const MAX_BACKUP_ARCHIVE_BYTES = 64 * 1024 * 1024
const MAX_QUEUE_FILES = 100000
const MAX_QUEUE_FILE_BYTES = 64 * 1024 * 1024
const MAX_QUEUE_TOTAL_BYTES = 512 * 1024 * 1024

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function pathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (
    relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  )
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function stableRegularFileSnapshot(file, options = {}) {
  const resolved = path.resolve(String(file || ''))
  const maxBytes = Number(options.maxBytes || MAX_CONTROL_JSON_BYTES)
  const requirePrivate = options.requirePrivate === true
  const allowEmpty = options.allowEmpty === true
  let descriptor
  try {
    descriptor = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    const before = fs.fstatSync(descriptor)
    if (
      !before.isFile() || (!allowEmpty && before.size < 1) ||
      before.size > maxBytes || (requirePrivate && (before.mode & 0o077) !== 0)
    ) throw new Error(`${options.label || 'file'}_private_regular_file_required`)
    const bytes = Buffer.alloc(before.size)
    let position = 0
    while (position < bytes.length) {
      const count = fs.readSync(
        descriptor,
        bytes,
        position,
        bytes.length - position,
        position
      )
      if (count <= 0) throw new Error(`${options.label || 'file'}_short_read`)
      position += count
    }
    const after = fs.fstatSync(descriptor)
    const pathStat = fs.lstatSync(resolved)
    if (
      pathStat.isSymbolicLink() || !pathStat.isFile() ||
      pathStat.dev !== after.dev || pathStat.ino !== after.ino ||
      before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs || bytes.length !== after.size
    ) throw new Error(`${options.label || 'file'}_changed_during_snapshot`)
    return {
      bytes,
      file: resolved,
      mode: before.mode,
      sha256: sha256(bytes),
      size_bytes: before.size
    }
  } catch (error) {
    if (['ELOOP', 'EMLINK'].includes(String(error?.code || ''))) {
      throw new Error(`${options.label || 'file'}_private_regular_file_required`)
    }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function readJsonSnapshot(file, options = {}) {
  const loaded = stableRegularFileSnapshot(file, options)
  try {
    loaded.value = JSON.parse(loaded.bytes.toString('utf8'))
  } catch {
    throw new Error(`${options.label || 'json'}_invalid_json`)
  }
  return loaded
}

function assertRealDirectory(directory, label, options = {}) {
  const resolved = path.resolve(directory)
  const stat = fs.lstatSync(resolved)
  if (
    !stat.isDirectory() || stat.isSymbolicLink() ||
    (options.requirePrivate === true && (stat.mode & 0o077) !== 0)
  ) throw new Error(`${label}_real_private_directory_required`)
  return resolved
}

function captureMemorySnapshot(root, options = {}) {
  const resolvedRoot = assertRealDirectory(root, options.label || 'memory_root', {
    requirePrivate: options.requirePrivate === true
  })
  const rootEntries = fs.readdirSync(resolvedRoot).sort()
  if (options.memoryOnlyRoot === true && rootEntries.some((name) =>
    !MEMORY_DIRECTORIES.includes(name))) {
    throw new Error(`${options.label || 'memory_root'}_non_memory_root_entry_forbidden`)
  }
  const files = []
  let totalBytes = 0
  const counts = { 'thread-state': 0, 'thread-history': 0 }
  for (const directoryName of MEMORY_DIRECTORIES) {
    const directory = path.join(resolvedRoot, directoryName)
    const resolvedDirectory = assertRealDirectory(
      directory,
      `${options.label || 'memory_root'}_${directoryName}`,
      { requirePrivate: options.requirePrivate === true }
    )
    for (const basename of fs.readdirSync(resolvedDirectory).sort()) {
      if (!JSON_BASENAME_RE.test(basename)) {
        throw new Error(`${options.label || 'memory_root'}_non_json_entry_forbidden`)
      }
      const relativePath = `${directoryName}/${basename}`
      if (Buffer.byteLength(relativePath, 'utf8') > 100) {
        throw new Error(`${options.label || 'memory_root'}_tar_path_too_long`)
      }
      const loaded = stableRegularFileSnapshot(path.join(resolvedDirectory, basename), {
        label: `${options.label || 'memory_root'}_json`,
        maxBytes: MAX_MEMORY_JSON_BYTES,
        requirePrivate: options.requirePrivate === true
      })
      let value
      try { value = JSON.parse(loaded.bytes.toString('utf8')) } catch {
        throw new Error(`${options.label || 'memory_root'}_malformed_json`)
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${options.label || 'memory_root'}_json_object_required`)
      }
      totalBytes += loaded.size_bytes
      if (totalBytes > MAX_MEMORY_TOTAL_BYTES) {
        throw new Error(`${options.label || 'memory_root'}_total_bytes_exceeded`)
      }
      files.push({
        bytes: loaded.bytes,
        relative_path: relativePath,
        sha256: loaded.sha256,
        size_bytes: loaded.size_bytes
      })
      counts[directoryName] += 1
      if (files.length > MAX_MEMORY_FILES) {
        throw new Error(`${options.label || 'memory_root'}_file_count_exceeded`)
      }
    }
  }
  const inventory = files.map((item) => ({
    relative_path: item.relative_path,
    sha256: item.sha256,
    size_bytes: item.size_bytes
  }))
  return {
    counts,
    file_count: files.length,
    files,
    inventory_sha256: sha256(stableJson(inventory)),
    total_bytes: totalBytes
  }
}

function isQueueDirectoryName(name) {
  const value = String(name || '').toLowerCase()
  return /^(?:inbox|outbox|reactbox|reactionbox)(?:$|[-_])/.test(value) ||
    /^(?:processed|dead[-_]?letter)(?:$|[-_])/.test(value) ||
    /(?:^|[-_])queue(?:$|[-_])/.test(value)
}

function hashStableTreeFile(file, aggregate) {
  const loaded = stableRegularFileSnapshot(file, {
    label: 'queue_snapshot',
    maxBytes: MAX_QUEUE_FILE_BYTES,
    allowEmpty: true,
    requirePrivate: true
  })
  aggregate.files += 1
  aggregate.bytes += loaded.size_bytes
  if (aggregate.files > MAX_QUEUE_FILES || aggregate.bytes > MAX_QUEUE_TOTAL_BYTES) {
    throw new Error('queue_snapshot_bounds_exceeded')
  }
  return loaded.sha256
}

function captureQueueSurface(root) {
  const resolvedRoot = assertRealDirectory(root, 'queue_target_root', {
    requirePrivate: true
  })
  const rows = []
  const aggregate = { files: 0, bytes: 0 }
  function walk(directory, relative) {
    const entries = fs.readdirSync(directory).sort()
    for (const name of entries) {
      const absolute = path.join(directory, name)
      const nextRelative = relative ? `${relative}/${name}` : name
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new Error('queue_snapshot_link_or_special_entry_forbidden')
      }
      if (stat.isDirectory()) {
        if ((stat.mode & 0o077) !== 0) {
          throw new Error('queue_snapshot_directory_not_private')
        }
        rows.push(`d:${nextRelative}`)
        walk(absolute, nextRelative)
      } else {
        rows.push(`f:${nextRelative}:${stat.size}:${hashStableTreeFile(absolute, aggregate)}`)
      }
    }
  }
  for (const name of fs.readdirSync(resolvedRoot).sort().filter(isQueueDirectoryName)) {
    const directory = path.join(resolvedRoot, name)
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error('queue_surface_root_entry_unsafe')
    }
    rows.push(`d:${name}`)
    walk(directory, name)
  }
  return {
    directory_count: rows.filter((row) => row.startsWith('d:') && !row.slice(2).includes('/')).length,
    file_count: aggregate.files,
    inventory_sha256: sha256(rows.join('\n'))
  }
}

function captureCanonicalDebugResidue(root) {
  const resolvedRoot = assertRealDirectory(root, 'debug_audit_target_root', {
    requirePrivate: true
  })
  const rows = []
  let fileCount = 0
  let totalBytes = 0
  let remainingCount = 0

  function inspectFile(file, relative) {
    const loaded = stableRegularFileSnapshot(file, {
      label: 'debug_audit_file',
      maxBytes: MAX_QUEUE_FILE_BYTES,
      allowEmpty: true,
      requirePrivate: true
    })
    fileCount += 1
    totalBytes += loaded.size_bytes
    if (fileCount > MAX_QUEUE_FILES || totalBytes > MAX_QUEUE_TOTAL_BYTES) {
      throw new Error('debug_audit_bounds_exceeded')
    }
    rows.push(`f:${relative}:${loaded.size_bytes}:${loaded.sha256}`)
    if (shouldPurgeRecord(
      loaded.bytes.toString('utf8'),
      relative,
      [...DEBUG_USERNAMES],
      [...DEBUG_CONTACT_IDS]
    )) remainingCount += 1
  }

  function walk(directory, relative) {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name)
      const nextRelative = relative ? `${relative}/${name}` : name
      const stat = fs.lstatSync(absolute)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new Error('debug_audit_link_or_special_entry_forbidden')
      }
      if (stat.isDirectory()) {
        if ((stat.mode & 0o077) !== 0) {
          throw new Error('debug_audit_directory_not_private')
        }
        rows.push(`d:${nextRelative}`)
        walk(absolute, nextRelative)
      } else {
        inspectFile(absolute, nextRelative)
      }
    }
  }

  for (const directoryName of TEST_ACCOUNT_PURGE_DIRS) {
    const directory = path.join(resolvedRoot, directoryName)
    if (!fs.existsSync(directory)) {
      rows.push(`m:${directoryName}`)
      continue
    }
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error('debug_audit_root_directory_unsafe')
    }
    rows.push(`d:${directoryName}`)
    walk(directory, directoryName)
  }

  const rawLog = path.join(resolvedRoot, 'logs', 'inbound-raw.ndjson')
  if (fs.existsSync(rawLog)) {
    const loaded = stableRegularFileSnapshot(rawLog, {
      label: 'debug_audit_raw_log',
      maxBytes: MAX_QUEUE_FILE_BYTES,
      allowEmpty: true,
      requirePrivate: true
    })
    fileCount += 1
    totalBytes += loaded.size_bytes
    if (fileCount > MAX_QUEUE_FILES || totalBytes > MAX_QUEUE_TOTAL_BYTES) {
      throw new Error('debug_audit_bounds_exceeded')
    }
    rows.push(`f:logs/inbound-raw.ndjson:${loaded.size_bytes}:${loaded.sha256}`)
    for (const line of loaded.bytes.toString('utf8').split(/\r?\n/).filter(Boolean)) {
      if (shouldPurgeRecord(
        line,
        '',
        [...DEBUG_USERNAMES],
        [...DEBUG_CONTACT_IDS]
      )) remainingCount += 1
    }
  } else {
    rows.push('m:logs/inbound-raw.ndjson')
  }

  return {
    remaining_count: remainingCount,
    file_count: fileCount,
    total_bytes: totalBytes,
    inventory_sha256: sha256(rows.join('\n'))
  }
}

function writeOctal(header, offset, length, value) {
  const encoded = Number(value).toString(8).padStart(length - 1, '0')
  if (encoded.length > length - 1) throw new Error('tar_numeric_field_overflow')
  header.write(encoded, offset, length - 1, 'ascii')
  header[offset + length - 1] = 0
}

function tarHeader(name, size, type) {
  if (!name || Buffer.byteLength(name, 'utf8') > 100 || name.includes('\0')) {
    throw new Error('tar_entry_name_invalid')
  }
  const header = Buffer.alloc(512)
  header.write(name, 0, 100, 'utf8')
  writeOctal(header, 100, 8, type === '5' ? 0o700 : 0o600)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = type.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'binary')
  header.write('00', 263, 2, 'ascii')
  header.write('scv', 265, 3, 'ascii')
  header.write('scv', 297, 3, 'ascii')
  let checksum = 0
  for (const byte of header) checksum += byte
  const encodedChecksum = checksum.toString(8).padStart(6, '0')
  header.write(`${encodedChecksum}\0 `, 148, 8, 'binary')
  return header
}

function buildMemoryTarGz(files) {
  if (!Array.isArray(files) || files.length < 1) {
    throw new Error('memory_backup_must_contain_at_least_one_file')
  }
  const chunks = []
  for (const directoryName of MEMORY_DIRECTORIES) {
    chunks.push(tarHeader(`${directoryName}/`, 0, '5'))
  }
  for (const item of [...files].sort((left, right) =>
    left.relative_path.localeCompare(right.relative_path))) {
    if (!/^(thread-state|thread-history)\/[A-Za-z0-9._-]+\.json$/.test(
      item.relative_path)) throw new Error('memory_backup_entry_path_invalid')
    chunks.push(tarHeader(item.relative_path, item.bytes.length, '0'))
    chunks.push(item.bytes)
    const padding = (512 - (item.bytes.length % 512)) % 512
    if (padding) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1024))
  const compressed = zlib.gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 })
  if (compressed.length > MAX_BACKUP_ARCHIVE_BYTES) {
    throw new Error('memory_backup_archive_size_exceeded')
  }
  return compressed
}

function writePrivateFileExclusive(file, bytes) {
  let descriptor
  try {
    descriptor = fs.openSync(file, 'wx', 0o600)
    let position = 0
    while (position < bytes.length) {
      position += fs.writeSync(descriptor, bytes, position, bytes.length - position)
    }
    fs.fchmodSync(descriptor, 0o600)
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function ensurePrivateDirectoryPath(base, target) {
  const resolvedBase = assertRealDirectory(base, 'evidence_base', { requirePrivate: true })
  const resolvedTarget = path.resolve(target)
  if (!pathInside(resolvedBase, resolvedTarget) || resolvedBase === resolvedTarget) {
    throw new Error('evidence_directory_outside_target')
  }
  const relative = path.relative(resolvedBase, resolvedTarget)
  let cursor = resolvedBase
  for (const segment of relative.split(path.sep)) {
    if (!segment || !/^[A-Za-z0-9._-]+$/.test(segment)) {
      throw new Error('evidence_directory_segment_invalid')
    }
    cursor = path.join(cursor, segment)
    if (!fs.existsSync(cursor)) fs.mkdirSync(cursor, { mode: 0o700 })
    assertRealDirectory(cursor, 'evidence_directory', { requirePrivate: true })
  }
  return resolvedTarget
}

function safeCleanupPending(directory) {
  if (!fs.existsSync(directory)) return false
  const stat = fs.lstatSync(directory)
  if (
    !stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())
  ) throw new Error('stale_preparation_pending_directory_unsafe')
  for (const name of fs.readdirSync(directory)) {
    if (!OUTPUT_FILES.includes(name) && !/^\.[A-Za-z0-9._-]+\.tmp$/.test(name)) {
      throw new Error('stale_preparation_pending_entry_unsafe')
    }
    const file = path.join(directory, name)
    const fileStat = fs.lstatSync(file)
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_MEMORY_TOTAL_BYTES) {
      throw new Error('stale_preparation_pending_entry_unsafe')
    }
  }
  fs.rmSync(directory, { recursive: true, force: false })
  fsyncDirectory(path.dirname(directory))
  return true
}

function normalizedPackages(packages) {
  return packages.map(descriptorFor)
    .sort((left, right) => left.remote_path.localeCompare(right.remote_path))
}

function packagesFromOptions(options) {
  const direct = Array.isArray(options.sourcePackages) ? options.sourcePackages : []
  if (options.sourcePackagesFile && direct.length) {
    throw new Error('source_package_input_modes_are_mutually_exclusive')
  }
  if (options.sources?.length || options.sourceRoots?.length) {
    throw new Error('arbitrary_recovery_source_directories_forbidden')
  }
  if (options.sourcePackagesFile) {
    const loaded = readJsonSnapshot(options.sourcePackagesFile, {
      label: 'source_packages',
      maxBytes: 1024 * 1024,
      requirePrivate: true
    })
    const value = Array.isArray(loaded.value)
      ? loaded.value
      : loaded.value?.source_packages
    return { packages: value, evidence: loaded }
  }
  return { packages: direct, evidence: null }
}

function validatePausedBootstrap({ env, manifest, manifestSha256, options, pause, purge }) {
  const deploymentId = String(env.RAILWAY_DEPLOYMENT_ID || '')
  const releaseId = String(options.releaseId || '')
  if (String(env.SCV_PAUSE_ALL || '') !== '1') {
    throw new Error('recovery_preparation_requires_pause_all')
  }
  if (String(env.SCV_RELEASE_PHASE || '') !== 'recovery_bootstrap') {
    throw new Error('recovery_preparation_requires_bootstrap_phase')
  }
  if (String(env.SCV_RUNTIME_NAMESPACE || 'prod') !== 'prod') {
    throw new Error('recovery_preparation_requires_prod_namespace')
  }
  if (!UUID_RE.test(deploymentId) || deploymentId !== options.bootstrapDeploymentId) {
    throw new Error('recovery_preparation_deployment_id_mismatch')
  }
  if (!RELEASE_ID_RE.test(releaseId) || manifest?.release_id !== releaseId) {
    throw new Error('recovery_preparation_release_id_mismatch')
  }
  if (env.SCV_GOLDEN_RELEASE_ID && String(env.SCV_GOLDEN_RELEASE_ID) !== releaseId) {
    throw new Error('recovery_preparation_environment_release_id_mismatch')
  }
  if (
    manifest?.deployment?.release_phase !== 'recovery_bootstrap' ||
    manifest?.deployment?.recovery_transition?.role !== 'bootstrap' ||
    !SHA256_RE.test(String(manifest?.content_fingerprint_sha256 || '')) ||
    !SHA256_RE.test(String(manifest?.release_manifest_sha256 || ''))
  ) throw new Error('recovery_preparation_bootstrap_manifest_invalid')
  if (
    pause?.pause_all !== true || pause?.automation_paused !== true ||
    pause?.candidate_release_id !== releaseId ||
    pause?.candidate_content_fingerprint_sha256 !== manifest.content_fingerprint_sha256 ||
    pause?.candidate_release_manifest_sha256 !== manifest.release_manifest_sha256 ||
    pause?.railway?.deployment_id !== deploymentId ||
    pause?.production_mutated !== false || pause?.secrets_included !== false
  ) throw new Error('recovery_preparation_pause_evidence_mismatch')
  if (
    purge?.schema !== OMAR_SYSTEM_PURGE_RECEIPT_SCHEMA || purge?.ok !== true ||
    purge?.bootstrap_release_id !== releaseId ||
    purge?.bootstrap_content_fingerprint_sha256 !== manifest.content_fingerprint_sha256 ||
    purge?.bootstrap_release_manifest_sha256 !== manifest.release_manifest_sha256 ||
    purge?.bootstrap_deployment_id !== deploymentId ||
    purge?.pause_all_verified !== true || purge?.release_phase !== 'recovery_bootstrap' ||
    purge?.post_audit_remaining_count !== 0 ||
    purge?.non_debug_identity_scope_allowed !== false ||
    purge?.raw_message_content_included !== false || purge?.secrets_included !== false
  ) throw new Error('recovery_preparation_omar_purge_receipt_mismatch')
  if (!SHA256_RE.test(manifestSha256)) {
    throw new Error('recovery_preparation_manifest_file_hash_invalid')
  }
  return { deploymentId, releaseId }
}

function assertDryRun(plan, receipt, compiledPackage) {
  const counts = receipt?.counts || {}
  if (
    plan.validationPassed !== true || plan.counts?.sources !== 1 ||
    plan.counts?.source_state_files !== compiledPackage.thread_state_file_count ||
    plan.counts?.source_history_files !== compiledPackage.thread_history_file_count ||
    plan.counts?.invalid_json_files !== 0 || plan.counts?.invalid_schema_files !== 0 ||
    plan.counts?.history_event_unresolved_conflict_groups !== 0 ||
    plan.counts?.excluded_synthetic_files !== 0 ||
    plan.counts?.excluded_debug_files !== 0 ||
    plan.counts?.queue_directories_touched !== 0 ||
    receipt?.schema !== 'scv_non_debug_history_recovery_receipt_v1' ||
    receipt?.mode !== 'dry_run' || receipt?.safety?.backup_created !== false ||
    receipt?.safety?.canonical_debug_identity_excluded !== true ||
    receipt?.safety?.pause_all_verified !== true ||
    receipt?.safety?.queue_directories_touched !== 0 ||
    receipt?.safety?.validation_passed !== true || counts.sources !== 1 ||
    counts.source_state_files !== compiledPackage.thread_state_file_count ||
    counts.source_history_files !== compiledPackage.thread_history_file_count ||
    counts.invalid_json_files !== 0 || counts.invalid_schema_files !== 0 ||
    counts.history_event_unresolved_conflict_groups !== 0 ||
    counts.excluded_synthetic_files !== 0 || counts.excluded_debug_files !== 0 ||
    counts.writes_committed !== 0 ||
    counts.queue_directories_touched !== 0 ||
    receipt?.hashes?.input_inventory_sha256 !== plan.hashes.input_inventory_sha256 ||
    receipt?.hashes?.plan_sha256 !== plan.hashes.plan_sha256
  ) throw new Error('recovery_preparation_dry_run_contract_rejected')
}

function defaultOutputDirectory(targetRoot, releaseId, deploymentId) {
  return path.join(targetRoot, EVIDENCE_DIRECTORY, releaseId, deploymentId)
}

function prepareRecoveryEvidence(options = {}, dependencies = {}) {
  const env = dependencies.env || process.env
  const now = dependencies.now || new Date()
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('recovery_preparation_time_invalid')
  }
  const expectedTargetRoot = path.resolve(
    dependencies.expectedTargetRoot || EXPECTED_TARGET_ROOT
  )
  const expectedSourceRoot = path.resolve(
    dependencies.expectedSourceRoot || SOURCE_PACKAGE_ROOT
  )
  const expectedManifestPath = path.resolve(
    dependencies.expectedManifestPath || EXPECTED_MANIFEST_PATH
  )
  const preparePackages = dependencies.prepareRecoverySourcePackages ||
    prepareRecoverySourcePackages
  const buildPlan = dependencies.buildRecoveryPlan || buildRecoveryPlan
  const run = dependencies.runRecovery || runRecovery
  const targetRoot = path.resolve(String(options.target || ''))
  if (targetRoot !== expectedTargetRoot) {
    throw new Error('recovery_preparation_target_must_equal_prod_namespace')
  }
  if (path.resolve(String(options.manifest || '')) !== expectedManifestPath) {
    throw new Error('recovery_preparation_manifest_path_not_canonical')
  }
  assertRealDirectory(targetRoot, 'recovery_preparation_target', { requirePrivate: true })
  const manifestLoaded = readJsonSnapshot(options.manifest, {
    label: 'recovery_manifest',
    maxBytes: MAX_CONTROL_JSON_BYTES
  })
  const pauseLoaded = readJsonSnapshot(options.pauseEvidence, {
    label: 'recovery_pause_evidence',
    maxBytes: MAX_CONTROL_JSON_BYTES,
    requirePrivate: true
  })
  const purgeLoaded = readJsonSnapshot(options.omarSystemPurgeReceipt, {
    label: 'omar_system_purge_receipt',
    maxBytes: 1024 * 1024,
    requirePrivate: true
  })
  const identity = validatePausedBootstrap({
    env,
    manifest: manifestLoaded.value,
    manifestSha256: manifestLoaded.sha256,
    options,
    pause: pauseLoaded.value,
    purge: purgeLoaded.value
  })
  const expectedPurgeReceipt = path.join(
    targetRoot,
    'release-transitions',
    `${identity.releaseId}.omar-system-purge.json`
  )
  if (purgeLoaded.file !== expectedPurgeReceipt) {
    throw new Error('recovery_preparation_omar_purge_receipt_path_not_canonical')
  }
  const packageInput = packagesFromOptions(options)
  if (!Array.isArray(packageInput.packages) || packageInput.packages.length !== 1) {
    throw new Error('recovery_preparation_exactly_one_compiled_source_package_required')
  }
  if (packageInput.evidence) {
    const evidence = packageInput.evidence.value
    if (
      !Array.isArray(evidence) && (
        evidence?.bootstrap_release_id !== identity.releaseId ||
        evidence?.bootstrap_deployment_id !== identity.deploymentId
      )
    ) throw new Error('recovery_preparation_source_package_evidence_mismatch')
    const receiptBinding = normalizeCompiledReceiptBinding(evidence?.compiled_receipt)
    const receiptFailures = verifyCompiledReceiptBinding(
      receiptBinding,
      'recovery_preparation_compiled_receipt'
    )
    const evidencePackageVerdict = verifyCompiledSourcePackages(packageInput.packages, {
      prefix: 'recovery_preparation_compiled_package',
      receiptBinding
    })
    if (receiptFailures.length || !evidencePackageVerdict.ok) {
      throw new Error('recovery_preparation_compiled_source_evidence_invalid')
    }
  }
  const requestedPackages = normalizedPackages(packageInput.packages)
  const requestedPackageVerdict = verifyCompiledSourcePackages(requestedPackages, {
    prefix: 'recovery_preparation_compiled_package'
  })
  if (
    !requestedPackageVerdict.ok ||
    new Set(requestedPackages.map((item) => item.remote_path)).size !== 1 ||
    requestedPackages.some((item) =>
      path.dirname(item.remote_path) !== expectedSourceRoot ||
      !SHA256_RE.test(item.sha256) ||
      !Number.isSafeInteger(item.file_count) || item.file_count < 1)
  ) throw new Error('recovery_preparation_source_package_descriptor_invalid')
  const prepared = preparePackages(requestedPackages, {
    expectedSourceRoot,
    tarBin: dependencies.tarBin || 'tar'
  })
  if (
    normalizedPackages(prepared.observedPackages).map(stableJson).join('\n') !==
      requestedPackages.map(stableJson).join('\n') ||
    !Array.isArray(prepared.sourceRoots) || prepared.sourceRoots.length !== 1 ||
    new Set(prepared.sourceRoots.map((item) => path.resolve(item))).size !== 1
  ) throw new Error('recovery_preparation_observed_source_packages_mismatch')
  for (const sourceRoot of prepared.sourceRoots) {
    if (!pathInside(path.join(expectedSourceRoot, '.verified-extractions'), sourceRoot)) {
      throw new Error('recovery_preparation_unverified_source_root')
    }
    captureMemorySnapshot(sourceRoot, {
      label: 'verified_source',
      memoryOnlyRoot: true,
      requirePrivate: true
    })
  }

  // Bootstrap startup preflights the entire namespaced tree and tightens live
  // memory to 0700 directories / 0600 files before workers start. Preparation
  // treats any weaker mode as bootstrap drift and fails closed.
  const baselineMemory = captureMemorySnapshot(targetRoot, {
    label: 'target_memory',
    requirePrivate: true
  })
  const baselineQueues = captureQueueSurface(targetRoot)
  const baselineDebugAudit = captureCanonicalDebugResidue(targetRoot)
  if (baselineDebugAudit.remaining_count !== 0) {
    throw new Error('recovery_preparation_live_debug_residue_present')
  }
  const archive = buildMemoryTarGz(baselineMemory.files)
  const recoveryEnv = dependencies.recoveryEnv || { SCV_PAUSE_ALL: '1' }
  if (String(recoveryEnv.SCV_PAUSE_ALL || '') !== '1') {
    throw new Error('recovery_preparation_internal_dry_run_pause_missing')
  }
  const plan = buildPlan({
    sources: prepared.sourceRoots,
    target: targetRoot,
    env: recoveryEnv
  })
  const dryRun = run({
    sources: prepared.sourceRoots,
    target: targetRoot,
    execute: false,
    env: recoveryEnv,
    now
  })
  assertDryRun(plan, dryRun, requestedPackages[0])

  const afterDryMemory = captureMemorySnapshot(targetRoot, {
    label: 'target_memory_after_dry_run',
    requirePrivate: true
  })
  const afterDryQueues = captureQueueSurface(targetRoot)
  const afterDryDebugAudit = captureCanonicalDebugResidue(targetRoot)
  if (
    baselineMemory.inventory_sha256 !== afterDryMemory.inventory_sha256 ||
    baselineQueues.inventory_sha256 !== afterDryQueues.inventory_sha256 ||
    baselineDebugAudit.inventory_sha256 !== afterDryDebugAudit.inventory_sha256 ||
    afterDryDebugAudit.remaining_count !== 0
  ) throw new Error('recovery_preparation_dry_run_mutated_target')

  const outputDirectory = path.resolve(
    options.outputDirectory || defaultOutputDirectory(
      targetRoot, identity.releaseId, identity.deploymentId
    )
  )
  const exactOutputDirectory = defaultOutputDirectory(
    targetRoot, identity.releaseId, identity.deploymentId
  )
  if (outputDirectory !== exactOutputDirectory) {
    throw new Error(`recovery_preparation_output_directory_must_equal:${exactOutputDirectory}`)
  }
  const outputParent = ensurePrivateDirectoryPath(
    targetRoot,
    path.dirname(outputDirectory)
  )
  const pendingDirectory = `${outputDirectory}.pending`
  safeCleanupPending(pendingDirectory)
  if (fs.existsSync(outputDirectory)) {
    throw new Error('recovery_preparation_output_already_exists')
  }
  fs.mkdirSync(pendingDirectory, { mode: 0o700 })
  let published = false
  try {
    const archiveFile = path.join(pendingDirectory, 'backup.tar.gz')
    const backupReceiptFile = path.join(pendingDirectory, 'backup.json')
    const dryRunFile = path.join(pendingDirectory, 'dry-run.json')
    writePrivateFileExclusive(archiveFile, archive)
    const archiveInspection = inspectArchive(
      archiveFile,
      {
        file_count: baselineMemory.file_count,
        thread_state_file_count: baselineMemory.counts['thread-state'],
        thread_history_file_count: baselineMemory.counts['thread-history']
      },
      dependencies.tarBin || 'tar',
      { allowAnyMemoryBasename: true }
    )
    if (archiveInspection.file_count !== baselineMemory.file_count) {
      throw new Error('recovery_preparation_backup_archive_verification_failed')
    }
    dependencies.afterArchiveWritten?.({ pendingDirectory, archiveFile })
    const backupReceipt = {
      schema: BACKUP_RECEIPT_SCHEMA,
      ok: true,
      release_id: identity.releaseId,
      content_fingerprint_sha256: manifestLoaded.value.content_fingerprint_sha256,
      release_manifest_sha256: manifestLoaded.value.release_manifest_sha256,
      release_manifest_file_sha256: manifestLoaded.sha256,
      bootstrap_deployment_id: identity.deploymentId,
      created_at_utc: now.toISOString(),
      pause_all_verified: true,
      pause_evidence_sha256: pauseLoaded.sha256,
      omar_system_purge_receipt_file: path.basename(purgeLoaded.file),
      omar_system_purge_receipt_sha256: purgeLoaded.sha256,
      omar_system_purge_post_audit_remaining_count: 0,
      target_root: targetRoot,
      memory_only: true,
      queue_directories_included: false,
      target_memory_mutated: false,
      archive_file: 'backup.tar.gz',
      archive_sha256: sha256(archive),
      archive_size_bytes: archive.length,
      archive_format: 'tar.gz',
      file_count: baselineMemory.file_count,
      state_file_count: baselineMemory.counts['thread-state'],
      history_file_count: baselineMemory.counts['thread-history'],
      target_memory_inventory_sha256: baselineMemory.inventory_sha256,
      queue_inventory_sha256: baselineQueues.inventory_sha256,
      canonical_debug_audit_inventory_sha256: baselineDebugAudit.inventory_sha256,
      canonical_debug_remaining_count: 0,
      source_package_count: requestedPackages.length,
      source_package_set_sha256: sha256(JSON.stringify(requestedPackages)),
      receipt_contains_raw_message_content: false,
      archive_contains_private_memory: true,
      secrets_included: false
    }
    writePrivateFileExclusive(backupReceiptFile, jsonBytes(backupReceipt))
    dependencies.afterBackupReceiptWritten?.({ pendingDirectory, backupReceiptFile })
    writePrivateFileExclusive(dryRunFile, jsonBytes(dryRun))
    dependencies.afterDryRunWritten?.({ pendingDirectory, dryRunFile })
    for (const name of OUTPUT_FILES) {
      stableRegularFileSnapshot(path.join(pendingDirectory, name), {
        label: 'recovery_preparation_output',
        maxBytes: name.endsWith('.tar.gz')
          ? MAX_BACKUP_ARCHIVE_BYTES
          : MAX_CONTROL_JSON_BYTES,
        requirePrivate: true
      })
    }
    const finalMemory = captureMemorySnapshot(targetRoot, {
      label: 'target_memory_before_publish',
      requirePrivate: true
    })
    const finalQueues = captureQueueSurface(targetRoot)
    const finalDebugAudit = captureCanonicalDebugResidue(targetRoot)
    if (
      baselineMemory.inventory_sha256 !== finalMemory.inventory_sha256 ||
      baselineQueues.inventory_sha256 !== finalQueues.inventory_sha256 ||
      baselineDebugAudit.inventory_sha256 !== finalDebugAudit.inventory_sha256 ||
      finalDebugAudit.remaining_count !== 0
    ) throw new Error('recovery_preparation_target_changed_before_publish')
    fsyncDirectory(pendingDirectory)
    fs.renameSync(pendingDirectory, outputDirectory)
    fsyncDirectory(outputParent)
    published = true
    return {
      schema: PREPARATION_PRODUCER_SCHEMA,
      ok: true,
      output_directory: outputDirectory,
      backup_archive_path: path.join(outputDirectory, 'backup.tar.gz'),
      backup_receipt_path: path.join(outputDirectory, 'backup.json'),
      dry_run_receipt_path: path.join(outputDirectory, 'dry-run.json'),
      archive_sha256: backupReceipt.archive_sha256,
      pause_evidence_sha256: pauseLoaded.sha256,
      omar_system_purge_receipt_sha256: purgeLoaded.sha256,
      input_inventory_sha256: dryRun.hashes.input_inventory_sha256,
      plan_sha256: dryRun.hashes.plan_sha256,
      source_package_count: requestedPackages.length,
      source_file_count: requestedPackages.reduce((sum, item) => sum + item.file_count, 0),
      target_memory_file_count: baselineMemory.file_count,
      canonical_debug_remaining_count: 0,
      canonical_debug_audit_inventory_sha256: baselineDebugAudit.inventory_sha256,
      planned_write_count:
        dryRun.counts.state_writes_planned + dryRun.counts.history_writes_planned,
      queue_directories_touched: 0,
      target_memory_mutated: false,
      secrets_included: false,
      message_content_in_summary: false,
      backup_archive_contains_private_memory: true
    }
  } finally {
    if (!published && fs.existsSync(pendingDirectory)) {
      safeCleanupPending(pendingDirectory)
    }
  }
}

function parseArguments(argv) {
  const options = { sourcePackages: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--source-package') {
      throw new Error('direct_source_package_arguments_forbidden_use_private_inventory')
    }
    const value = argv[index + 1]
    if (!item.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`invalid_argument:${item}`)
    }
    const key = item.slice(2)
    if (key === 'manifest') options.manifest = value
    else if (key === 'pause-evidence') options.pauseEvidence = value
    else if (key === 'omar-system-purge-receipt') options.omarSystemPurgeReceipt = value
    else if (key === 'bootstrap-deployment-id') options.bootstrapDeploymentId = value
    else if (key === 'release-id') options.releaseId = value
    else if (key === 'source-packages-file') options.sourcePackagesFile = value
    else if (key === 'target') options.target = value
    else if (key === 'output-directory') options.outputDirectory = value
    else throw new Error(`unknown_argument:${item}`)
    index += 1
  }
  return options
}

function usage() {
  return [
    'Usage:',
    '  SCV_PAUSE_ALL=1 SCV_RELEASE_PHASE=recovery_bootstrap node scv-prepare-recovery-evidence.js \\',
    '    --manifest <bootstrap-manifest.json> --pause-evidence <private-pause.json> \\',
    '    --omar-system-purge-receipt <private-purge.json> \\',
    '    --release-id <release-id> --bootstrap-deployment-id <current-deployment-uuid> \\',
    '    --source-packages-file <private-authenticated-inventory.json> \\',
    '    --target /data/scv-runtime-namespaces/prod',
    '',
    'Exactly one compiled archive bound by its private compiler receipt is required.'
  ].join('\n')
}

if (require.main === module) {
  try {
    if (process.argv.slice(2).some((item) => item === '--help' || item === '-h')) {
      process.stdout.write(`${usage()}\n`)
      process.exit(0)
    }
    const summary = prepareRecoveryEvidence(parseArguments(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(summary)}\n`)
  } catch {
    process.stderr.write('scv_recovery_preparation_evidence_refused\n')
    process.exit(1)
  }
}

module.exports = {
  BACKUP_RECEIPT_SCHEMA,
  EVIDENCE_DIRECTORY,
  EXPECTED_MANIFEST_PATH,
  EXPECTED_TARGET_ROOT,
  PREPARATION_PRODUCER_SCHEMA,
  buildMemoryTarGz,
  captureMemorySnapshot,
  captureCanonicalDebugResidue,
  captureQueueSurface,
  defaultOutputDirectory,
  isQueueDirectoryName,
  parseArguments,
  prepareRecoveryEvidence,
  readJsonSnapshot,
  safeCleanupPending,
  stableRegularFileSnapshot
}
