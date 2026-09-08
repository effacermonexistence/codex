#!/usr/bin/env node
// Verify and privately extract the exact recovery source archives bound by the
// post-bootstrap recovery authorization. No arbitrary directory can become a
// restore source, and no queue, link, special file, or traversal entry is ever
// admitted from an archive.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const {
  normalizeCompiledSourcePackages,
  verifyCompiledSourcePackages
} = require('./scv-compiled-recovery-source-contract.js')

const SOURCE_PACKAGE_ROOT = '/data/scv-runtime-namespaces/prod/recovery-sources'
const MAX_SOURCE_PACKAGE_BYTES = 512 * 1024 * 1024
const MAX_SOURCE_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
const MAX_SOURCE_ENTRY_BYTES = 64 * 1024 * 1024
const MAX_SOURCE_FILES = 100000
const SHA256_RE = /^[a-f0-9]{64}$/
const BASENAME_RE = /^[A-Za-z0-9._-]+\.json$/
const ARCHIVE_BASENAME_RE = /^[A-Za-z0-9._-]+\.tar\.gz$/
const MEMORY_DIRECTORIES = Object.freeze(['thread-state', 'thread-history'])
const CANONICAL_DEBUG_CONTACT_IDS = new Set(['1537753982'])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function ensurePrivateDirectory(directory) {
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('recovery_source_private_directory_required')
  }
}

function hashPrivateRegularFile(file, maxBytes = MAX_SOURCE_PACKAGE_BYTES) {
  const resolved = path.resolve(String(file || ''))
  let descriptor
  let before
  const digest = crypto.createHash('sha256')
  try {
    descriptor = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    before = fs.fstatSync(descriptor)
    if (
      !before.isFile() || before.size <= 0 || before.size > maxBytes ||
      (before.mode & 0o077) !== 0
    ) throw new Error('recovery_source_archive_must_be_private_regular_file')
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (position < before.size) {
      const count = fs.readSync(
        descriptor,
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position
      )
      if (count <= 0) throw new Error('recovery_source_archive_short_read')
      digest.update(buffer.subarray(0, count))
      position += count
    }
    const after = fs.fstatSync(descriptor)
    const pathStat = fs.lstatSync(resolved)
    if (
      pathStat.isSymbolicLink() || !pathStat.isFile() ||
      pathStat.dev !== after.dev || pathStat.ino !== after.ino ||
      before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) throw new Error('recovery_source_archive_changed_during_hash')
  } catch (error) {
    if (['ELOOP', 'EMLINK'].includes(String(error?.code || ''))) {
      throw new Error('recovery_source_archive_must_be_private_regular_file')
    }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  return {
    file: resolved,
    sha256: digest.digest('hex'),
    size_bytes: before.size,
    dev: before.dev,
    ino: before.ino
  }
}

function copyPrivateArchiveSnapshot(file, snapshotParent) {
  const resolved = path.resolve(String(file || ''))
  ensurePrivateDirectory(snapshotParent)
  const snapshotDirectory = fs.mkdtempSync(path.join(snapshotParent, '.archive-snapshot-'))
  fs.chmodSync(snapshotDirectory, 0o700)
  const snapshotFile = path.join(snapshotDirectory, 'source.tar.gz')
  let sourceDescriptor
  let snapshotDescriptor
  let sourceBefore
  let complete = false
  const digest = crypto.createHash('sha256')
  try {
    sourceDescriptor = fs.openSync(
      resolved,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    sourceBefore = fs.fstatSync(sourceDescriptor)
    if (
      !sourceBefore.isFile() || sourceBefore.size <= 0 ||
      sourceBefore.size > MAX_SOURCE_PACKAGE_BYTES || (sourceBefore.mode & 0o077) !== 0
    ) throw new Error('recovery_source_archive_must_be_private_regular_file')
    snapshotDescriptor = fs.openSync(snapshotFile, 'wx', 0o600)
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let position = 0
    while (position < sourceBefore.size) {
      const count = fs.readSync(
        sourceDescriptor,
        buffer,
        0,
        Math.min(buffer.length, sourceBefore.size - position),
        position
      )
      if (count <= 0) throw new Error('recovery_source_archive_short_read')
      let written = 0
      while (written < count) {
        written += fs.writeSync(snapshotDescriptor, buffer, written, count - written)
      }
      digest.update(buffer.subarray(0, count))
      position += count
    }
    fs.fsyncSync(snapshotDescriptor)
    fs.fchmodSync(snapshotDescriptor, 0o400)
    fs.fsyncSync(snapshotDescriptor)
    const sourceAfter = fs.fstatSync(sourceDescriptor)
    const pathStat = fs.lstatSync(resolved)
    if (
      pathStat.isSymbolicLink() || !pathStat.isFile() ||
      pathStat.dev !== sourceAfter.dev || pathStat.ino !== sourceAfter.ino ||
      sourceBefore.dev !== sourceAfter.dev || sourceBefore.ino !== sourceAfter.ino ||
      sourceBefore.size !== sourceAfter.size ||
      sourceBefore.mtimeMs !== sourceAfter.mtimeMs ||
      sourceBefore.ctimeMs !== sourceAfter.ctimeMs
    ) throw new Error('recovery_source_archive_changed_during_snapshot')
    fs.closeSync(snapshotDescriptor)
    snapshotDescriptor = undefined
    fs.closeSync(sourceDescriptor)
    sourceDescriptor = undefined
    fsyncDirectory(snapshotDirectory)
    const result = {
      source: {
        file: resolved,
        sha256: digest.digest('hex'),
        size_bytes: sourceBefore.size,
        dev: sourceBefore.dev,
        ino: sourceBefore.ino
      },
      snapshot_file: snapshotFile,
      snapshot_directory: snapshotDirectory
    }
    complete = true
    return result
  } catch (error) {
    if (['ELOOP', 'EMLINK'].includes(String(error?.code || ''))) {
      throw new Error('recovery_source_archive_must_be_private_regular_file')
    }
    throw error
  } finally {
    if (snapshotDescriptor !== undefined) fs.closeSync(snapshotDescriptor)
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor)
    if (!complete && fs.existsSync(snapshotDirectory)) {
      fs.rmSync(snapshotDirectory, { recursive: true, force: true })
      try { fsyncDirectory(snapshotParent) } catch {}
    }
  }
}

function runTar(tarBin, args, label) {
  const result = spawnSync(tarBin, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024
  })
  if (result.error || result.status !== 0) {
    throw new Error(`${label}_failed:${String(result.error?.message || result.stderr || result.status)}`)
  }
  return result.stdout
}

function inspectArchive(file, expectedDescriptor, tarBin = 'tar', options = {}) {
  const listed = runTar(tarBin, ['-tzf', file], 'recovery_source_archive_list')
    .split(/\r?\n/).filter(Boolean)
  if (listed.length < 1 || listed.length > MAX_SOURCE_FILES + 2) {
    throw new Error('recovery_source_archive_entry_count_invalid')
  }
  const seen = new Set()
  const seenDirectories = new Set()
  const counts = { 'thread-state': 0, 'thread-history': 0 }
  for (const entry of listed) {
    if (entry.includes('\\') || entry.startsWith('/') || entry.includes('\0') ||
        entry.split('/').includes('..') || entry.split('/').includes('.')) {
      throw new Error('recovery_source_archive_path_unsafe')
    }
    const directory = MEMORY_DIRECTORIES.includes(entry.replace(/\/$/, '')) && entry.endsWith('/')
    const memoryFile = options.allowAnyMemoryBasename === true
      ? /^(thread-state|thread-history)\/([A-Za-z0-9._-]+\.json)$/.exec(entry)
      : /^(thread-state|thread-history)\/(\d+)\.json$/.exec(entry)
    if (!directory && !memoryFile) throw new Error('recovery_source_archive_entry_forbidden')
    if (memoryFile && options.allowAnyMemoryBasename !== true && !/^\d+$/.test(memoryFile[2])) {
      throw new Error('recovery_source_archive_basename_invalid')
    }
    if (memoryFile && options.allowAnyMemoryBasename !== true &&
        CANONICAL_DEBUG_CONTACT_IDS.has(memoryFile[2])) {
      throw new Error('recovery_source_archive_debug_identity_forbidden')
    }
    if (seen.has(entry)) throw new Error('recovery_source_archive_duplicate_entry')
    seen.add(entry)
    if (directory) seenDirectories.add(entry.replace(/\/$/, ''))
    if (memoryFile) counts[memoryFile[1]] += 1
  }
  if (MEMORY_DIRECTORIES.some((item) => !seenDirectories.has(item))) {
    throw new Error('recovery_source_archive_memory_directory_missing')
  }
  const files = counts['thread-state'] + counts['thread-history']
  if (
    files !== expectedDescriptor.file_count || files < 1 ||
    counts['thread-state'] !== expectedDescriptor.thread_state_file_count ||
    counts['thread-history'] !== expectedDescriptor.thread_history_file_count
  ) {
    throw new Error('recovery_source_archive_file_count_mismatch')
  }
  const verbose = runTar(tarBin, ['-tvzf', file], 'recovery_source_archive_verbose_list')
    .split(/\r?\n/).filter(Boolean)
  if (verbose.length !== listed.length) throw new Error('recovery_source_archive_type_list_mismatch')
  let uncompressedBytes = 0
  for (let index = 0; index < verbose.length; index += 1) {
    const expectedType = listed[index].endsWith('/') ? 'd' : '-'
    if (verbose[index][0] !== expectedType) {
      throw new Error('recovery_source_archive_link_or_special_entry_forbidden')
    }
    if (expectedType === '-') {
      const tokens = verbose[index].trim().split(/\s+/)
      let size = null
      for (let tokenIndex = 1; tokenIndex < tokens.length - 1; tokenIndex += 1) {
        if (!/^\d+$/.test(tokens[tokenIndex])) continue
        if (/^\d{4}-\d{2}-\d{2}$/.test(tokens[tokenIndex + 1]) ||
            /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(
              tokens[tokenIndex + 1]
            )) {
          size = Number(tokens[tokenIndex])
          break
        }
      }
      if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SOURCE_ENTRY_BYTES) {
        throw new Error('recovery_source_archive_entry_size_invalid')
      }
      uncompressedBytes += size
      if (uncompressedBytes > MAX_SOURCE_UNCOMPRESSED_BYTES) {
        throw new Error('recovery_source_archive_uncompressed_size_exceeded')
      }
    }
  }
  return {
    file_count: files,
    thread_state_file_count: counts['thread-state'],
    thread_history_file_count: counts['thread-history'],
    entries: listed,
    uncompressed_bytes: uncompressedBytes
  }
}

function scanExtracted(root, options = {}) {
  const requirePrivate = options.requirePrivate === true
  const entries = []
  const rootEntries = fs.readdirSync(root).sort()
  if (rootEntries.some((name) => !MEMORY_DIRECTORIES.includes(name))) {
    throw new Error('recovery_source_extraction_contains_forbidden_root_entry')
  }
  for (const directoryName of MEMORY_DIRECTORIES) {
    const directory = path.join(root, directoryName)
    if (!fs.existsSync(directory)) throw new Error('recovery_source_extraction_directory_missing')
    const directoryStat = fs.lstatSync(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('recovery_source_extraction_directory_unsafe')
    }
    if (requirePrivate && (directoryStat.mode & 0o077) !== 0) {
      throw new Error('recovery_source_extraction_directory_not_private')
    }
    for (const basename of fs.readdirSync(directory).sort()) {
      if (!BASENAME_RE.test(basename)) {
        throw new Error('recovery_source_extraction_entry_forbidden')
      }
      const file = path.join(directory, basename)
      let descriptor
      let stat
      let raw
      try {
        descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
        stat = fs.fstatSync(descriptor)
        if (!stat.isFile()) throw new Error('recovery_source_extraction_non_regular_file')
        if (requirePrivate && (stat.mode & 0o077) !== 0) {
          throw new Error('recovery_source_extraction_file_not_private')
        }
        raw = fs.readFileSync(descriptor)
        const after = fs.fstatSync(descriptor)
        const pathStat = fs.lstatSync(file)
        if (
          pathStat.isSymbolicLink() || !pathStat.isFile() ||
          pathStat.dev !== after.dev || pathStat.ino !== after.ino ||
          stat.dev !== after.dev || stat.ino !== after.ino ||
          stat.size !== after.size || stat.mtimeMs !== after.mtimeMs ||
          stat.ctimeMs !== after.ctimeMs || raw.length !== after.size
        ) throw new Error('recovery_source_extraction_file_changed')
      } catch (error) {
        if (['ELOOP', 'EMLINK'].includes(String(error?.code || ''))) {
          throw new Error('recovery_source_extraction_non_regular_file')
        }
        throw error
      } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor)
      }
      try { JSON.parse(raw.toString('utf8')) } catch {
        throw new Error('recovery_source_extraction_json_invalid')
      }
      entries.push({
        relative_path: `${directoryName}/${basename}`,
        sha256: sha256(raw),
        size_bytes: stat.size
      })
    }
  }
  return {
    entries,
    file_count: entries.length,
    inventory_sha256: sha256(stableJson(entries))
  }
}

function privatizeExtraction(root) {
  fs.chmodSync(root, 0o700)
  for (const directoryName of MEMORY_DIRECTORIES) {
    const directory = path.join(root, directoryName)
    fs.chmodSync(directory, 0o700)
    for (const basename of fs.readdirSync(directory)) {
      fs.chmodSync(path.join(directory, basename), 0o600)
    }
  }
}

function descriptorFor(value) {
  const normalized = normalizeCompiledSourcePackages([value])[0]
  return { ...normalized, remote_path: path.resolve(normalized.remote_path) }
}

function prepareOneSourcePackage(value, options = {}) {
  const descriptor = descriptorFor(value)
  const sourceRoot = path.resolve(String(options.expectedSourceRoot || SOURCE_PACKAGE_ROOT))
  if (
    path.dirname(descriptor.remote_path) !== sourceRoot ||
    !ARCHIVE_BASENAME_RE.test(path.basename(descriptor.remote_path))
  ) throw new Error('recovery_source_archive_path_not_authorized')
  if (!SHA256_RE.test(descriptor.sha256)) throw new Error('recovery_source_archive_hash_invalid')
  const descriptorVerdict = verifyCompiledSourcePackages([descriptor], {
    prefix: 'recovery_source_archive_descriptor'
  })
  if (!descriptorVerdict.ok) {
    throw new Error(`recovery_source_archive_descriptor_invalid:${descriptorVerdict.failures.join(',')}`)
  }
  ensurePrivateDirectory(sourceRoot)
  const extractionBase = path.join(sourceRoot, '.verified-extractions')
  ensurePrivateDirectory(extractionBase)
  const archiveSnapshot = copyPrivateArchiveSnapshot(descriptor.remote_path, extractionBase)
  const first = archiveSnapshot.source
  if (first.sha256 !== descriptor.sha256) {
    fs.rmSync(archiveSnapshot.snapshot_directory, { recursive: true, force: true })
    fsyncDirectory(extractionBase)
    throw new Error('recovery_source_archive_hash_mismatch')
  }
  const destination = path.join(extractionBase, descriptor.sha256)
  let temporary = ''
  try {
    inspectArchive(
      archiveSnapshot.snapshot_file,
      descriptor,
      options.tarBin || 'tar'
    )
    temporary = fs.mkdtempSync(
      path.join(extractionBase, `.tmp-${descriptor.sha256.slice(0, 12)}-`)
    )
    fs.chmodSync(temporary, 0o700)
    runTar(options.tarBin || 'tar', [
      '--extract',
      '--gzip',
      '--file', archiveSnapshot.snapshot_file,
      '--directory', temporary,
      '--no-same-owner',
      '--no-same-permissions'
    ], 'recovery_source_archive_extract')
    const extracted = scanExtracted(temporary)
    if (extracted.file_count !== descriptor.file_count) {
      throw new Error('recovery_source_extracted_file_count_mismatch')
    }
    privatizeExtraction(temporary)
    const privateExtracted = scanExtracted(temporary, { requirePrivate: true })
    if (!fs.existsSync(destination)) {
      fs.renameSync(temporary, destination)
      temporary = ''
      fsyncDirectory(extractionBase)
    } else {
      const existingStat = fs.lstatSync(destination)
      if (!existingStat.isDirectory() || existingStat.isSymbolicLink() ||
          (existingStat.mode & 0o077) !== 0) {
        throw new Error('recovery_source_existing_extraction_unsafe')
      }
      const existing = scanExtracted(destination, { requirePrivate: true })
      if (stableJson(existing.entries) !== stableJson(privateExtracted.entries)) {
        throw new Error('recovery_source_existing_extraction_mismatch')
      }
    }
    const snapshotAfter = hashPrivateRegularFile(archiveSnapshot.snapshot_file)
    if (snapshotAfter.sha256 !== first.sha256) {
      throw new Error('recovery_source_archive_snapshot_changed')
    }
    const second = hashPrivateRegularFile(descriptor.remote_path)
    if (
      second.sha256 !== first.sha256 || second.dev !== first.dev ||
      second.ino !== first.ino || second.size_bytes !== first.size_bytes
    ) throw new Error('recovery_source_archive_changed_during_extraction')
    const finalInventory = scanExtracted(destination, { requirePrivate: true })
    return {
      descriptor,
      source_root: destination,
      extracted_inventory_sha256: finalInventory.inventory_sha256
    }
  } finally {
    if (temporary && fs.existsSync(temporary)) {
      fs.rmSync(temporary, { recursive: true, force: true })
    }
    if (fs.existsSync(archiveSnapshot.snapshot_directory)) {
      fs.rmSync(archiveSnapshot.snapshot_directory, { recursive: true, force: true })
    }
  }
}

function prepareRecoverySourcePackages(sourcePackages, options = {}) {
  if (!Array.isArray(sourcePackages) || sourcePackages.length !== 1) {
    throw new Error('recovery_source_packages_exactly_one_compiled_archive_required')
  }
  const normalized = sourcePackages.map(descriptorFor)
    .sort((left, right) => left.remote_path.localeCompare(right.remote_path))
  const packageVerdict = verifyCompiledSourcePackages(normalized, {
    prefix: 'recovery_source_packages'
  })
  if (!packageVerdict.ok) {
    throw new Error(`recovery_source_packages_contract_invalid:${packageVerdict.failures.join(',')}`)
  }
  if (new Set(normalized.map((item) => item.remote_path)).size !== normalized.length) {
    throw new Error('recovery_source_package_paths_duplicate')
  }
  if (new Set(normalized.map((item) => item.sha256)).size !== normalized.length) {
    throw new Error('recovery_source_package_hashes_duplicate')
  }
  const prepared = normalized.map((item) => prepareOneSourcePackage(item, options))
  return {
    sourceRoots: prepared.map((item) => item.source_root),
    observedPackages: prepared.map((item) => item.descriptor),
    extractedInventorySha256: prepared.map((item) => item.extracted_inventory_sha256)
  }
}

module.exports = {
  SOURCE_PACKAGE_ROOT,
  MEMORY_DIRECTORIES,
  hashPrivateRegularFile,
  copyPrivateArchiveSnapshot,
  inspectArchive,
  scanExtracted,
  descriptorFor,
  prepareOneSourcePackage,
  prepareRecoverySourcePackages
}
