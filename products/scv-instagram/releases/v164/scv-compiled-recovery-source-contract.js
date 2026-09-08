#!/usr/bin/env node
// Aggregate-only contract for the compiled non-debug recovery source.
//
// The private compiler receipt remains outside git. Its self hash, private
// evidence-file hash, archive hash, and aggregate counts are carried through
// inventory, preparation, Ben authorization, durable intent, and execution.
// Raw predecessor archives are provenance only and are never restore inputs.
const crypto = require('crypto')

const COMPILED_RECOVERY_RECEIPT_SCHEMA =
  'scv-compiled-real-non-debug-memory-2026-08-21-v1'
const COMPILED_RECOVERY_SOURCE_PACKAGE_COUNT = 1
const APPROVED_COMPILED_RECOVERY_ARCHIVE_SHA256 =
  '1578786e93ee80c755a255f92fc42df348e2a2d512434b175f68322b58826003'
const APPROVED_COMPILED_RECOVERY_STATE_FILE_COUNT = 114
const APPROVED_COMPILED_RECOVERY_HISTORY_FILE_COUNT = 114
const SHA256_RE = /^[a-f0-9]{64}$/

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

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
}

function normalizeCompiledReceiptBinding(value) {
  return {
    schema: String(value?.schema || ''),
    file_sha256: String(value?.file_sha256 || ''),
    self_sha256: String(value?.self_sha256 || ''),
    archive_sha256: String(value?.archive_sha256 || ''),
    file_count: Number(value?.file_count || 0),
    thread_state_file_count: Number(value?.thread_state_file_count || 0),
    thread_history_file_count: Number(value?.thread_history_file_count || 0),
    queue_file_count: Number(value?.queue_file_count || 0),
    omar_debug_file_count: Number(value?.omar_debug_file_count || 0),
    synthetic_nonnumeric_file_count:
      Number(value?.synthetic_nonnumeric_file_count || 0),
    queues_excluded: value?.queues_excluded === true,
    omar_debug_excluded: value?.omar_debug_excluded === true,
    numeric_real_threads_only: value?.numeric_real_threads_only === true,
    raw_archives_unchanged: value?.raw_archives_unchanged === true
  }
}

function compiledReceiptBindingFromEvidence(receipt, fileSha256) {
  const withoutSelfHash = JSON.parse(JSON.stringify(receipt || {}))
  delete withoutSelfHash.receipt_sha256
  const counts = receipt?.counts || {}
  const safety = receipt?.safety || {}
  const binding = normalizeCompiledReceiptBinding({
    schema: receipt?.schema,
    file_sha256: fileSha256,
    self_sha256: receipt?.receipt_sha256,
    archive_sha256: receipt?.compiled_archive_sha256,
    file_count: Number(counts.thread_state || 0) + Number(counts.thread_history || 0),
    thread_state_file_count: counts.thread_state,
    thread_history_file_count: counts.thread_history,
    queue_file_count: counts.queues,
    omar_debug_file_count: counts.omar_debug_files,
    synthetic_nonnumeric_file_count: counts.synthetic_nonnumeric_files,
    queues_excluded: safety.queues_excluded,
    omar_debug_excluded: safety.omar_debug_excluded,
    numeric_real_threads_only: safety.numeric_real_threads_only,
    raw_archives_unchanged: safety.raw_archives_unchanged
  })
  const failures = verifyCompiledReceiptBinding(binding)
  if (!hasExactKeys(receipt, [
    'schema',
    'generated_at',
    'source_archive_sha256',
    'restore_dry_run_sha256',
    'restore_execute_sha256',
    'compiled_archive_sha256',
    'counts',
    'safety',
    'receipt_sha256'
  ]) || !hasExactKeys(receipt?.counts, [
    'thread_state',
    'thread_history',
    'queues',
    'omar_debug_files',
    'synthetic_nonnumeric_files'
  ]) || !hasExactKeys(receipt?.safety, [
    'raw_archives_unchanged',
    'queues_excluded',
    'omar_debug_excluded',
    'numeric_real_threads_only',
    'files_private'
  ])) failures.push('compiled_recovery_receipt_keys_invalid')
  const generatedAt = Date.parse(String(receipt?.generated_at || ''))
  if (!Number.isFinite(generatedAt) || new Date(generatedAt).toISOString() !== receipt?.generated_at) {
    failures.push('compiled_recovery_receipt_time_invalid')
  }
  if (receipt?.safety?.files_private !== true) {
    failures.push('compiled_recovery_receipt_private_files_not_asserted')
  }
  if (!Array.isArray(receipt?.source_archive_sha256) ||
      receipt.source_archive_sha256.length !== 2 ||
      receipt.source_archive_sha256.some((item) => !SHA256_RE.test(String(item || '')))) {
    failures.push('compiled_recovery_receipt_source_provenance_invalid')
  }
  if (!SHA256_RE.test(String(receipt?.restore_dry_run_sha256 || '')) ||
      !SHA256_RE.test(String(receipt?.restore_execute_sha256 || ''))) {
    failures.push('compiled_recovery_receipt_restore_proof_invalid')
  }
  if (sha256(stableJson(withoutSelfHash)) !== binding.self_sha256) {
    failures.push('compiled_recovery_receipt_self_hash_mismatch')
  }
  if (failures.length) {
    throw new Error(`compiled_recovery_receipt_rejected:${failures.join(',')}`)
  }
  return binding
}

function verifyCompiledReceiptBinding(value, prefix = 'compiled_recovery_receipt') {
  const binding = normalizeCompiledReceiptBinding(value)
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(`${prefix}_${reason}`) }
  check(binding.schema === COMPILED_RECOVERY_RECEIPT_SCHEMA, 'schema_invalid')
  check(SHA256_RE.test(binding.file_sha256), 'file_hash_invalid')
  check(SHA256_RE.test(binding.self_sha256), 'self_hash_invalid')
  check(SHA256_RE.test(binding.archive_sha256), 'archive_hash_invalid')
  check(Number.isSafeInteger(binding.thread_state_file_count) &&
    binding.thread_state_file_count > 0, 'thread_state_count_invalid')
  check(Number.isSafeInteger(binding.thread_history_file_count) &&
    binding.thread_history_file_count > 0, 'thread_history_count_invalid')
  check(Number.isSafeInteger(binding.file_count) && binding.file_count > 0 &&
    binding.file_count === binding.thread_state_file_count +
      binding.thread_history_file_count, 'file_count_invalid')
  check(binding.queue_file_count === 0, 'queue_count_nonzero')
  check(binding.omar_debug_file_count === 0, 'omar_debug_count_nonzero')
  check(binding.synthetic_nonnumeric_file_count === 0,
    'synthetic_nonnumeric_count_nonzero')
  check(binding.queues_excluded === true, 'queues_not_excluded')
  check(binding.omar_debug_excluded === true, 'omar_debug_not_excluded')
  check(binding.numeric_real_threads_only === true, 'numeric_real_threads_not_locked')
  check(binding.raw_archives_unchanged === true, 'raw_archives_not_unchanged')
  return failures
}

function normalizeCompiledSourcePackages(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    remote_path: String(item?.remote_path || ''),
    sha256: String(item?.sha256 || ''),
    file_count: Number(item?.file_count || 0),
    thread_state_file_count: Number(item?.thread_state_file_count || 0),
    thread_history_file_count: Number(item?.thread_history_file_count || 0),
    queue_file_count: Number(item?.queue_file_count || 0),
    omar_debug_file_count: Number(item?.omar_debug_file_count || 0),
    synthetic_nonnumeric_file_count:
      Number(item?.synthetic_nonnumeric_file_count || 0),
    compiled_receipt_schema: String(item?.compiled_receipt_schema || ''),
    compiled_receipt_file_sha256: String(item?.compiled_receipt_file_sha256 || ''),
    compiled_receipt_self_sha256: String(item?.compiled_receipt_self_sha256 || '')
  })).sort((left, right) => left.remote_path.localeCompare(right.remote_path))
}

function bindCompiledReceiptToSourcePackage(observed, receiptBinding) {
  const binding = normalizeCompiledReceiptBinding(receiptBinding)
  return normalizeCompiledSourcePackages([{
    remote_path: observed?.remote_path,
    sha256: observed?.sha256,
    file_count: observed?.file_count,
    thread_state_file_count: observed?.thread_state_file_count,
    thread_history_file_count: observed?.thread_history_file_count,
    queue_file_count: 0,
    omar_debug_file_count: 0,
    synthetic_nonnumeric_file_count: 0,
    compiled_receipt_schema: binding.schema,
    compiled_receipt_file_sha256: binding.file_sha256,
    compiled_receipt_self_sha256: binding.self_sha256
  }])[0]
}

function verifyCompiledSourcePackages(value, options = {}) {
  const prefix = String(options.prefix || 'compiled_recovery_source_package')
  const packages = normalizeCompiledSourcePackages(value)
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(`${prefix}_${reason}`) }
  check(packages.length === COMPILED_RECOVERY_SOURCE_PACKAGE_COUNT, 'count_invalid')
  check(new Set(packages.map((item) => item.remote_path)).size === packages.length,
    'paths_duplicate')
  const expectedBinding = options.receiptBinding === undefined
    ? null
    : normalizeCompiledReceiptBinding(options.receiptBinding)
  for (const item of packages) {
    check(SHA256_RE.test(item.sha256), 'archive_hash_invalid')
    check(Number.isSafeInteger(item.thread_state_file_count) &&
      item.thread_state_file_count > 0, 'thread_state_count_invalid')
    check(Number.isSafeInteger(item.thread_history_file_count) &&
      item.thread_history_file_count > 0, 'thread_history_count_invalid')
    check(Number.isSafeInteger(item.file_count) && item.file_count > 0 &&
      item.file_count === item.thread_state_file_count + item.thread_history_file_count,
    'file_count_invalid')
    check(item.queue_file_count === 0, 'queue_count_nonzero')
    check(item.omar_debug_file_count === 0, 'omar_debug_count_nonzero')
    check(item.synthetic_nonnumeric_file_count === 0,
      'synthetic_nonnumeric_count_nonzero')
    check(item.compiled_receipt_schema === COMPILED_RECOVERY_RECEIPT_SCHEMA,
      'receipt_schema_invalid')
    check(SHA256_RE.test(item.compiled_receipt_file_sha256), 'receipt_file_hash_invalid')
    check(SHA256_RE.test(item.compiled_receipt_self_sha256), 'receipt_self_hash_invalid')
    if (expectedBinding) {
      check(item.sha256 === expectedBinding.archive_sha256, 'receipt_archive_hash_mismatch')
      check(item.file_count === expectedBinding.file_count, 'receipt_file_count_mismatch')
      check(item.thread_state_file_count === expectedBinding.thread_state_file_count,
        'receipt_thread_state_count_mismatch')
      check(item.thread_history_file_count === expectedBinding.thread_history_file_count,
        'receipt_thread_history_count_mismatch')
      check(item.queue_file_count === expectedBinding.queue_file_count,
        'receipt_queue_count_mismatch')
      check(item.omar_debug_file_count === expectedBinding.omar_debug_file_count,
        'receipt_omar_debug_count_mismatch')
      check(item.synthetic_nonnumeric_file_count ===
        expectedBinding.synthetic_nonnumeric_file_count,
      'receipt_synthetic_nonnumeric_count_mismatch')
      check(item.compiled_receipt_schema === expectedBinding.schema,
        'receipt_schema_mismatch')
      check(item.compiled_receipt_file_sha256 === expectedBinding.file_sha256,
        'receipt_file_hash_mismatch')
      check(item.compiled_receipt_self_sha256 === expectedBinding.self_sha256,
        'receipt_self_hash_mismatch')
    }
    if (options.requireApprovedArtifact === true) {
      check(item.sha256 === APPROVED_COMPILED_RECOVERY_ARCHIVE_SHA256,
        'approved_archive_hash_mismatch')
      check(item.thread_state_file_count ===
        APPROVED_COMPILED_RECOVERY_STATE_FILE_COUNT,
      'approved_thread_state_count_mismatch')
      check(item.thread_history_file_count ===
        APPROVED_COMPILED_RECOVERY_HISTORY_FILE_COUNT,
      'approved_thread_history_count_mismatch')
    }
  }
  return { ok: failures.length === 0, packages, failures }
}

module.exports = {
  COMPILED_RECOVERY_RECEIPT_SCHEMA,
  COMPILED_RECOVERY_SOURCE_PACKAGE_COUNT,
  APPROVED_COMPILED_RECOVERY_ARCHIVE_SHA256,
  APPROVED_COMPILED_RECOVERY_STATE_FILE_COUNT,
  APPROVED_COMPILED_RECOVERY_HISTORY_FILE_COUNT,
  SHA256_RE,
  stableJson,
  normalizeCompiledReceiptBinding,
  compiledReceiptBindingFromEvidence,
  verifyCompiledReceiptBinding,
  normalizeCompiledSourcePackages,
  bindCompiledReceiptToSourcePackage,
  verifyCompiledSourcePackages
}
