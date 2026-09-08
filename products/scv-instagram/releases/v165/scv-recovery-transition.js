#!/usr/bin/env node
// Two-release recovery transition lock.
//
// A recovery_bootstrap release may run only while SCV_PAUSE_ALL=1. Once that
// exact deployment is alive and authenticated pause evidence exists, a
// separate signed authorization binds the preparation receipt and permits the
// memory restore. The restore writes one private aggregate execution receipt.
// A distinct active manifest must bind that exact file hash, and production
// startup re-verifies it before loading any worker or sender.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  runtimeNamespaceFromEnv,
  namespacedPersistRoot
} = require('./scv-runtime-namespace.js')
const {
  normalizeCompiledReceiptBinding,
  verifyCompiledReceiptBinding,
  normalizeCompiledSourcePackages,
  verifyCompiledSourcePackages
} = require('./scv-compiled-recovery-source-contract.js')

const TRANSITION_PROTOCOL =
  'scv-two-release-non-debug-recovery-transition-2026-08-20-v1'
const EXECUTION_RECEIPT_SCHEMA =
  'scv-approved-non-debug-recovery-execution-2026-08-20-v3-private-durable-authorized'
const EXECUTION_INTENT_SCHEMA =
  'scv-approved-non-debug-recovery-intent-2026-08-20-v1-private-durable'
const PREPARATION_RECEIPT_SCHEMA =
  'scv-non-debug-recovery-preparation-2026-08-20-v1'
const TRANSITION_DIRECTORY = 'release-transitions'
const MAX_RECEIPT_BYTES = 1024 * 1024
const MAX_INTENT_BYTES = 8 * 1024 * 1024
const MAX_MEMORY_OUTPUT_BYTES = 64 * 1024 * 1024
const SHA256_RE = /^[a-f0-9]{64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MEMORY_BASENAME_RE = /^[A-Za-z0-9._-]+\.json$/
const SOURCE_PACKAGE_PATH_RE =
  /^\/data\/scv-runtime-namespaces\/prod\/recovery-sources\/[A-Za-z0-9._-]+\.tar\.gz$/

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sha256File(file) {
  return sha256(fs.readFileSync(file))
}

// Read, parse, and hash one immutable snapshot from a single no-follow file
// descriptor. Callers must never parse one pathname read and bind the hash of
// a later pathname read: a rename between those operations would authorize
// different bytes than the bytes that were verified.
function readJsonFileSnapshot(file, options = {}) {
  const resolved = path.resolve(String(file || ''))
  const label = String(options.label || 'recovery_transition_json')
  const maxBytes = Number(options.maxBytes || MAX_RECEIPT_BYTES)
  const privateFile = options.privateFile === true
  const regularFileError = privateFile
    ? `${label}_must_be_private_regular_file`
    : `${label}_must_be_regular_file`
  let descriptor
  let before
  let content
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    descriptor = fs.openSync(resolved, flags)
    before = fs.fstatSync(descriptor)
    if (
      !before.isFile() || before.size <= 0 || before.size > maxBytes ||
      (privateFile && (before.mode & 0o077) !== 0)
    ) throw new Error(regularFileError)
    content = fs.readFileSync(descriptor)
    const after = fs.fstatSync(descriptor)
    let pathStat
    try { pathStat = fs.lstatSync(resolved) } catch { throw new Error(`${label}_changed_during_read`) }
    if (
      pathStat.isSymbolicLink() || !pathStat.isFile() ||
      pathStat.dev !== after.dev || pathStat.ino !== after.ino ||
      before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs || content.length !== after.size
    ) throw new Error(`${label}_changed_during_read`)
  } catch (error) {
    if (error?.message === regularFileError ||
        error?.message === `${label}_changed_during_read`) throw error
    if (['ELOOP', 'EMLINK'].includes(String(error?.code || ''))) {
      throw new Error(regularFileError)
    }
    throw error
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  let value
  try { value = JSON.parse(content.toString('utf8')) } catch {
    throw new Error(`${label}_json_invalid`)
  }
  if (
    !value || typeof value !== 'object' ||
    (Array.isArray(value) && options.allowArray !== true)
  ) {
    throw new Error(`${label}_json_invalid`)
  }
  return { file: resolved, value, sha256: sha256(content) }
}

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

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
}

function normalizedSourcePackages(value) {
  return normalizeCompiledSourcePackages(value)
}

function verifySourcePackages(value, prefix, failures) {
  const verdict = verifyCompiledSourcePackages(value, { prefix })
  failures.push(...verdict.failures)
  const packages = verdict.packages
  for (const item of packages) {
    if (!SOURCE_PACKAGE_PATH_RE.test(item.remote_path)) failures.push(`${prefix}_path_invalid`)
  }
  return packages
}

function safeReleaseId(value) {
  const raw = String(value || '')
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-')
  if (!raw || safe !== raw || safe === '.' || safe === '..') {
    throw new Error('recovery_transition_release_id_invalid')
  }
  return safe
}

function persistentNamespaceRoot(env = process.env) {
  const persistRoot = String(
    env.SCV_PERSIST_ROOT || env.RAILWAY_VOLUME_MOUNT_PATH || ''
  ).trim()
  if (!persistRoot || !path.isAbsolute(persistRoot)) {
    throw new Error('recovery_transition_persistent_root_missing')
  }
  return namespacedPersistRoot(persistRoot, runtimeNamespaceFromEnv(env))
}

function preparationReceiptPath(releaseId, env = process.env) {
  return path.join(
    persistentNamespaceRoot(env),
    'release-approvals',
    `${safeReleaseId(releaseId)}.recovery-preparation.json`
  )
}

function executionReceiptPath(bootstrapReleaseId, env = process.env) {
  return path.join(
    persistentNamespaceRoot(env),
    TRANSITION_DIRECTORY,
    `${safeReleaseId(bootstrapReleaseId)}.non-debug-memory-recovery.json`
  )
}

function executionIntentPath(bootstrapReleaseId, env = process.env) {
  return path.join(
    persistentNamespaceRoot(env),
    TRANSITION_DIRECTORY,
    `${safeReleaseId(bootstrapReleaseId)}.non-debug-memory-recovery.intent.json`
  )
}

function privateReceiptFile(file) {
  const loaded = readJsonFileSnapshot(file, {
    label: 'recovery_transition_receipt',
    maxBytes: MAX_RECEIPT_BYTES,
    privateFile: true
  })
  return { file: loaded.file, receipt: loaded.value, sha256: loaded.sha256 }
}

function verifyPreparationReceipt(receipt, manifest, options = {}) {
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  const expectedTargetRoot = path.resolve(
    String(options.expectedTargetRoot || '/data/scv-runtime-namespaces/prod')
  )
  check(receipt?.schema === PREPARATION_RECEIPT_SCHEMA, 'transition_preparation_schema_mismatch')
  check(receipt?.ok === true, 'transition_preparation_not_ok')
  check(receipt?.release_id === manifest?.release_id, 'transition_preparation_release_id_mismatch')
  check(
    receipt?.content_fingerprint_sha256 === manifest?.content_fingerprint_sha256,
    'transition_preparation_fingerprint_mismatch'
  )
  check(
    receipt?.release_manifest_sha256 === manifest?.release_manifest_sha256,
    'transition_preparation_manifest_hash_mismatch'
  )
  check(UUID_RE.test(String(receipt?.bootstrap_deployment_id || '')),
    'transition_preparation_bootstrap_deployment_invalid')
  if (options.bootstrapDeploymentId !== undefined) {
    check(
      receipt?.bootstrap_deployment_id === String(options.bootstrapDeploymentId || ''),
      'transition_preparation_bootstrap_deployment_mismatch'
    )
  }
  check(receipt?.production_memory_mutated === false, 'transition_preparation_memory_was_mutated')
  check(receipt?.actual_execute === false, 'transition_preparation_execute_not_pending')
  check(receipt?.secrets_included === false, 'transition_preparation_contains_secrets')
  check(
    SHA256_RE.test(String(receipt?.omar_system_purge_receipt_sha256 || '')),
    'transition_preparation_omar_purge_hash_invalid'
  )
  check(receipt?.pause?.verified === true, 'transition_preparation_pause_unverified')
  check(receipt?.pause?.pause_all === true, 'transition_preparation_pause_all_not_true')
  check(
    path.resolve(String(receipt?.target_root || '')) === expectedTargetRoot,
    'transition_preparation_target_root_invalid'
  )
  check(receipt?.queue_policy?.restore_inbox === false, 'transition_preparation_inbox_forbidden')
  check(receipt?.queue_policy?.restore_outbox === false, 'transition_preparation_outbox_forbidden')
  check(receipt?.queue_policy?.restore_reactbox === false, 'transition_preparation_reactbox_forbidden')
  check(receipt?.queue_policy?.blind_send === false, 'transition_preparation_blind_send_forbidden')
  check(
    receipt?.queue_policy?.stale_items_to_human_hold === true,
    'transition_preparation_stale_hold_missing'
  )
  check(
    SHA256_RE.test(String(receipt?.dry_run?.input_inventory_sha256 || '')),
    'transition_preparation_input_hash_invalid'
  )
  check(
    SHA256_RE.test(String(receipt?.dry_run?.plan_sha256 || '')),
    'transition_preparation_plan_hash_invalid'
  )
  const compiledReceipt = normalizeCompiledReceiptBinding(receipt?.compiled_source_receipt)
  failures.push(...verifyCompiledReceiptBinding(
    compiledReceipt,
    'transition_preparation_compiled_receipt'
  ))
  const sourcePackages = verifySourcePackages(
    receipt?.source_packages,
    'transition_preparation_source_packages',
    failures
  )
  const boundSources = verifyCompiledSourcePackages(sourcePackages, {
    prefix: 'transition_preparation_compiled_source',
    receiptBinding: compiledReceipt
  })
  failures.push(...boundSources.failures)
  return { ok: failures.length === 0, failures }
}

function verifyExecutionReceipt(receipt, options = {}) {
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  const manifest = options.manifest || null
  const transition = manifest?.deployment?.recovery_transition || {}
  const expectedTargetRoot = path.resolve(
    String(options.expectedTargetRoot || '/data/scv-runtime-namespaces/prod')
  )
  check(receipt?.schema === EXECUTION_RECEIPT_SCHEMA, 'transition_execution_schema_mismatch')
  check(receipt?.ok === true, 'transition_execution_not_ok')
  check(receipt?.transition_protocol === TRANSITION_PROTOCOL, 'transition_execution_protocol_mismatch')
  check(receipt?.release_phase === 'recovery_bootstrap', 'transition_execution_source_phase_invalid')
  check(
    /^scv-instagram-golden-production-/.test(String(receipt?.bootstrap_release_id || '')),
    'transition_execution_bootstrap_release_id_invalid'
  )
  check(
    SHA256_RE.test(String(receipt?.bootstrap_content_fingerprint_sha256 || '')),
    'transition_execution_bootstrap_fingerprint_invalid'
  )
  check(
    SHA256_RE.test(String(receipt?.bootstrap_release_manifest_sha256 || '')),
    'transition_execution_bootstrap_manifest_hash_invalid'
  )
  check(
    UUID_RE.test(String(receipt?.bootstrap_deployment_id || '')),
    'transition_execution_bootstrap_deployment_id_invalid'
  )
  check(
    typeof receipt?.recovery_execution_authorization_id === 'string' &&
      receipt.recovery_execution_authorization_id.length > 0,
    'transition_execution_authorization_id_missing'
  )
  for (const [field, reason] of [
    ['recovery_execution_authorization_sha256', 'transition_execution_authorization_hash_invalid'],
    ['recovery_preparation_sha256', 'transition_execution_preparation_hash_invalid'],
    ['omar_system_purge_receipt_sha256', 'transition_execution_omar_purge_hash_invalid'],
    ['input_inventory_sha256', 'transition_execution_input_hash_invalid'],
    ['plan_sha256', 'transition_execution_plan_hash_invalid'],
    ['restore_receipt_sha256', 'transition_execution_restore_receipt_hash_invalid']
  ]) check(SHA256_RE.test(String(receipt?.[field] || '')), reason)
  const executedAt = Date.parse(String(receipt?.executed_at_utc || ''))
  check(Number.isFinite(executedAt), 'transition_execution_time_invalid')
  check(
    path.resolve(String(receipt?.target_root || '')) === expectedTargetRoot,
    'transition_execution_target_root_invalid'
  )
  check(Number.isSafeInteger(receipt?.writes_committed) && receipt.writes_committed >= 0,
    'transition_execution_writes_invalid')
  check(receipt?.safety?.pause_all_verified === true, 'transition_execution_pause_unverified')
  check(
    receipt?.safety?.canonical_debug_identity_excluded === true,
    'transition_execution_debug_identity_not_excluded'
  )
  check(receipt?.safety?.queue_directories_touched === 0, 'transition_execution_queue_touched')
  check(receipt?.safety?.restore_inbox === false, 'transition_execution_inbox_restore_forbidden')
  check(receipt?.safety?.restore_outbox === false, 'transition_execution_outbox_restore_forbidden')
  check(receipt?.safety?.restore_reactbox === false, 'transition_execution_reactbox_restore_forbidden')
  check(receipt?.safety?.blind_send === false, 'transition_execution_blind_send_forbidden')
  check(receipt?.secrets_included === false, 'transition_execution_contains_secrets')
  check(receipt?.message_content_included === false, 'transition_execution_contains_message_content')
  verifySourcePackages(receipt?.source_packages, 'transition_execution_source_packages', failures)

  if (manifest) {
    check(
      manifest?.deployment?.release_phase === 'active',
      'transition_execution_target_manifest_not_active'
    )
    check(transition?.protocol === TRANSITION_PROTOCOL, 'transition_manifest_protocol_mismatch')
    check(transition?.role === 'active', 'transition_manifest_role_mismatch')
    check(
      transition?.bootstrap_release_id === receipt?.bootstrap_release_id,
      'transition_manifest_bootstrap_release_id_mismatch'
    )
    check(
      transition?.bootstrap_content_fingerprint_sha256 ===
        receipt?.bootstrap_content_fingerprint_sha256,
      'transition_manifest_bootstrap_fingerprint_mismatch'
    )
    check(
      transition?.bootstrap_release_manifest_sha256 ===
        receipt?.bootstrap_release_manifest_sha256,
      'transition_manifest_bootstrap_manifest_hash_mismatch'
    )
    check(
      transition?.bootstrap_deployment_id === receipt?.bootstrap_deployment_id,
      'transition_manifest_bootstrap_deployment_id_mismatch'
    )
    check(
      transition?.execution_receipt_sha256 === String(options.receiptSha256 || ''),
      'transition_manifest_execution_receipt_hash_mismatch'
    )
    check(
      manifest?.release_id !== receipt?.bootstrap_release_id,
      'transition_active_release_must_be_distinct'
    )
    check(
      manifest?.deployment?.pre_freeze_baseline?.deployment_id ===
        receipt?.bootstrap_deployment_id,
      'transition_active_baseline_not_bootstrap_deployment'
    )
  }
  return { ok: failures.length === 0, failures }
}

function verifyManifestTransition(manifest) {
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  const phase = String(manifest?.deployment?.release_phase || '')
  const transition = manifest?.deployment?.recovery_transition || {}
  check(transition.protocol === TRANSITION_PROTOCOL, 'release_transition_protocol_invalid')
  if (phase === 'recovery_bootstrap') {
    check(transition.role === 'bootstrap', 'release_transition_bootstrap_role_invalid')
    check(transition.execution_receipt_required === false,
      'release_transition_bootstrap_cannot_require_prior_execution')
    check(transition.active_release_requires_execution_receipt === true,
      'release_transition_active_receipt_requirement_missing')
    check(!transition.execution_receipt_sha256, 'release_transition_bootstrap_execution_hash_forbidden')
  } else if (phase === 'active') {
    check(transition.role === 'active', 'release_transition_active_role_invalid')
    check(transition.execution_receipt_required === true,
      'release_transition_active_execution_receipt_required')
    check(/^scv-instagram-golden-production-/.test(String(transition.bootstrap_release_id || '')),
      'release_transition_bootstrap_release_id_invalid')
    check(SHA256_RE.test(String(transition.bootstrap_content_fingerprint_sha256 || '')),
      'release_transition_bootstrap_fingerprint_invalid')
    check(SHA256_RE.test(String(transition.bootstrap_release_manifest_sha256 || '')),
      'release_transition_bootstrap_manifest_hash_invalid')
    check(UUID_RE.test(String(transition.bootstrap_deployment_id || '')),
      'release_transition_bootstrap_deployment_id_invalid')
    check(SHA256_RE.test(String(transition.execution_receipt_sha256 || '')),
      'release_transition_execution_receipt_hash_invalid')
    check(transition.execution_receipt_schema === EXECUTION_RECEIPT_SCHEMA,
      'release_transition_execution_receipt_schema_invalid')
    check(manifest?.release_id !== transition.bootstrap_release_id,
      'release_transition_release_ids_must_differ')
    check(
      manifest?.deployment?.pre_freeze_baseline?.deployment_id ===
        transition.bootstrap_deployment_id,
      'release_transition_active_baseline_must_equal_bootstrap_deployment'
    )
  }
  return failures
}

function timestampToken(now) {
  return now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')
}

function expectedRestoreReceiptPath(artifactRoot, startedAt) {
  return path.join(
    artifactRoot,
    'recovery-receipts',
    `non-debug-memory-recovery-${timestampToken(startedAt)}.json`
  )
}

function verifyExecutionIntent(intent, options = {}) {
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  check(hasExactKeys(intent, [
    'schema',
    'transition_protocol',
    'bootstrap_release_id',
    'bootstrap_content_fingerprint_sha256',
    'bootstrap_release_manifest_sha256',
    'bootstrap_deployment_id',
    'recovery_execution_authorization_id',
    'recovery_execution_authorization_sha256',
    'recovery_preparation_sha256',
    'omar_system_purge_receipt_sha256',
    'created_at_utc',
    'restore_started_at_utc',
    'source_roots',
    'target_root',
    'artifact_root',
    'restore_receipt_path',
    'source_packages',
    'input_inventory_sha256',
    'plan_sha256',
    'writes',
    'secrets_included',
    'message_content_included'
  ]), 'recovery_intent_keys_invalid')
  check(intent?.schema === EXECUTION_INTENT_SCHEMA, 'recovery_intent_schema_mismatch')
  check(intent?.transition_protocol === TRANSITION_PROTOCOL, 'recovery_intent_protocol_mismatch')
  check(/^scv-instagram-golden-production-/.test(String(intent?.bootstrap_release_id || '')),
    'recovery_intent_release_id_invalid')
  for (const [field, reason] of [
    ['bootstrap_content_fingerprint_sha256', 'recovery_intent_fingerprint_invalid'],
    ['bootstrap_release_manifest_sha256', 'recovery_intent_manifest_hash_invalid'],
    ['recovery_execution_authorization_sha256', 'recovery_intent_authorization_hash_invalid'],
    ['recovery_preparation_sha256', 'recovery_intent_preparation_hash_invalid'],
    ['omar_system_purge_receipt_sha256', 'recovery_intent_omar_purge_hash_invalid'],
    ['input_inventory_sha256', 'recovery_intent_input_hash_invalid'],
    ['plan_sha256', 'recovery_intent_plan_hash_invalid']
  ]) check(SHA256_RE.test(String(intent?.[field] || '')), reason)
  check(UUID_RE.test(String(intent?.bootstrap_deployment_id || '')),
    'recovery_intent_deployment_id_invalid')
  check(
    typeof intent?.recovery_execution_authorization_id === 'string' &&
      intent.recovery_execution_authorization_id.length > 0,
    'recovery_intent_authorization_id_missing'
  )
  const createdAt = new Date(String(intent?.created_at_utc || ''))
  const restoreStartedAt = new Date(String(intent?.restore_started_at_utc || ''))
  check(Number.isFinite(createdAt.getTime()) && createdAt.toISOString() === intent?.created_at_utc,
    'recovery_intent_created_time_invalid')
  check(
    Number.isFinite(restoreStartedAt.getTime()) &&
      restoreStartedAt.toISOString() === intent?.restore_started_at_utc,
    'recovery_intent_restore_time_invalid'
  )
  check(Array.isArray(intent?.source_roots) && intent.source_roots.length > 0,
    'recovery_intent_sources_invalid')
  if (Array.isArray(intent?.source_roots)) {
    const sources = intent.source_roots.map((item) => path.resolve(String(item || '')))
    check(new Set(sources).size === sources.length, 'recovery_intent_sources_duplicate')
    check(sources.every((item, index) => item === intent.source_roots[index] && path.isAbsolute(item)),
      'recovery_intent_source_not_canonical')
  }
  for (const [field, reason] of [
    ['target_root', 'recovery_intent_target_invalid'],
    ['artifact_root', 'recovery_intent_artifact_root_invalid'],
    ['restore_receipt_path', 'recovery_intent_restore_receipt_path_invalid']
  ]) {
    const value = String(intent?.[field] || '')
    check(Boolean(value) && path.isAbsolute(value) && path.resolve(value) === value, reason)
  }
  check(
    path.resolve(String(intent?.artifact_root || '')) ===
      path.resolve(String(intent?.target_root || '')),
    'recovery_intent_artifact_root_must_equal_target'
  )
  if (Number.isFinite(restoreStartedAt.getTime()) && path.isAbsolute(String(intent?.artifact_root || ''))) {
    check(
      intent?.restore_receipt_path ===
        expectedRestoreReceiptPath(intent.artifact_root, restoreStartedAt),
      'recovery_intent_restore_receipt_path_mismatch'
    )
  }
  check(Array.isArray(intent?.writes) && intent.writes.length <= 100000,
    'recovery_intent_writes_invalid')
  const writeKeys = new Set()
  if (Array.isArray(intent?.writes)) {
    for (const write of intent.writes) {
      check(hasExactKeys(write, ['kind', 'basename', 'output_sha256']),
        'recovery_intent_write_keys_invalid')
      check(write?.kind === 'state' || write?.kind === 'history',
        'recovery_intent_write_kind_invalid')
      check(MEMORY_BASENAME_RE.test(String(write?.basename || '')),
        'recovery_intent_write_basename_invalid')
      check(SHA256_RE.test(String(write?.output_sha256 || '')),
        'recovery_intent_write_hash_invalid')
      const key = `${write?.kind}:${write?.basename}`
      check(!writeKeys.has(key), 'recovery_intent_write_duplicate')
      writeKeys.add(key)
    }
    const calculatedPlanHash = sha256(intent.writes
      .map((write) => `${write.kind}:${write.basename}:${write.output_sha256}`)
      .join('\n'))
    check(calculatedPlanHash === intent?.plan_sha256, 'recovery_intent_write_plan_hash_mismatch')
  }
  check(intent?.secrets_included === false, 'recovery_intent_contains_secrets')
  check(intent?.message_content_included === false, 'recovery_intent_contains_message_content')
  const intentSourcePackages = verifySourcePackages(
    intent?.source_packages,
    'recovery_intent_source_packages',
    failures
  )

  const manifest = options.manifest
  if (manifest) {
    check(manifest?.deployment?.release_phase === 'recovery_bootstrap',
      'recovery_intent_manifest_not_bootstrap')
    check(intent?.bootstrap_release_id === manifest?.release_id,
      'recovery_intent_manifest_release_mismatch')
    check(intent?.bootstrap_content_fingerprint_sha256 === manifest?.content_fingerprint_sha256,
      'recovery_intent_manifest_fingerprint_mismatch')
    check(intent?.bootstrap_release_manifest_sha256 === manifest?.release_manifest_sha256,
      'recovery_intent_manifest_hash_mismatch')
  }
  for (const [option, field, reason] of [
    [
      'authorizationSha256',
      'recovery_execution_authorization_sha256',
      'recovery_intent_current_authorization_mismatch'
    ],
    ['preparationSha256', 'recovery_preparation_sha256', 'recovery_intent_current_preparation_mismatch'],
    [
      'omarPurgeReceiptSha256',
      'omar_system_purge_receipt_sha256',
      'recovery_intent_current_omar_purge_mismatch'
    ],
    ['deploymentId', 'bootstrap_deployment_id', 'recovery_intent_current_deployment_mismatch'],
    ['targetRoot', 'target_root', 'recovery_intent_current_target_mismatch'],
    [
      'inputInventorySha256',
      'input_inventory_sha256',
      'recovery_intent_current_input_inventory_mismatch'
    ],
    ['planSha256', 'plan_sha256', 'recovery_intent_current_plan_mismatch']
  ]) {
    if (options[option] !== undefined) {
      const actual = field.endsWith('_root')
        ? path.resolve(String(intent?.[field] || ''))
        : String(intent?.[field] || '')
      const expected = field.endsWith('_root')
        ? path.resolve(String(options[option] || ''))
        : String(options[option] || '')
      check(actual === expected, reason)
    }
  }
  if (options.sourceRoots !== undefined) {
    const expectedSources = options.sourceRoots.map((item) => path.resolve(String(item || '')))
    check(
      JSON.stringify(intent?.source_roots || []) === JSON.stringify(expectedSources),
      'recovery_intent_current_sources_mismatch'
    )
  }
  if (options.sourcePackages !== undefined) {
    check(
      JSON.stringify(intentSourcePackages) ===
        JSON.stringify(normalizedSourcePackages(options.sourcePackages)),
      'recovery_intent_current_source_packages_mismatch'
    )
  }
  if (options.expectedSourceRoot !== undefined && Array.isArray(intentSourcePackages)) {
    const extractionRoot = path.join(
      path.resolve(String(options.expectedSourceRoot || '')),
      '.verified-extractions'
    )
    const expectedRoots = intentSourcePackages.map((item) =>
      path.join(extractionRoot, item.sha256))
    check(
      JSON.stringify(intent?.source_roots || []) === JSON.stringify(expectedRoots),
      'recovery_intent_source_roots_not_bound_to_packages'
    )
  }
  return { ok: failures.length === 0, failures }
}

function readExecutionIntent(file, options = {}) {
  const loaded = readJsonFileSnapshot(file, {
    label: 'recovery_execution_intent',
    maxBytes: MAX_INTENT_BYTES,
    privateFile: true
  })
  const intent = loaded.value
  const verdict = verifyExecutionIntent(intent, options)
  if (!verdict.ok) {
    throw new Error(`recovery_execution_intent_rejected:${verdict.failures.join(',')}`)
  }
  return { file: loaded.file, intent, sha256: loaded.sha256 }
}

function requireProductionTransition({ manifest, approval, env = process.env } = {}) {
  const phase = String(manifest?.deployment?.release_phase || '')
  if (phase === 'recovery_bootstrap') {
    const failures = verifyManifestTransition(manifest)
    if (failures.length) {
      throw new Error(`bootstrap_recovery_transition_rejected:${failures.join(',')}`)
    }
    if (String(env.SCV_PAUSE_ALL || '') !== '1') {
      throw new Error('bootstrap_recovery_transition_requires_pause_all')
    }
    // Preparation is deliberately post-bootstrap: authenticated readiness,
    // private backup, uploaded source inventory, and the final dry-run can only
    // be observed after this exact deployment is alive and fully paused.
    if (approval?.recovery_preparation_sha256 || approval?.recovery_execution_sha256) {
      throw new Error('bootstrap_promotion_approval_cannot_bind_post_bootstrap_recovery')
    }
    return {
      ok: true,
      phase,
      preparation_receipt_verified: false,
      recovery_execution_authorization_required: true,
      execution_receipt_verified: false
    }
  }
  if (phase === 'active') {
    const bootstrapReleaseId = manifest?.deployment?.recovery_transition?.bootstrap_release_id
    const file = executionReceiptPath(bootstrapReleaseId, env)
    const loaded = privateReceiptFile(file)
    const verdict = verifyExecutionReceipt(loaded.receipt, {
      manifest,
      receiptSha256: loaded.sha256
    })
    if (!verdict.ok) {
      throw new Error(`active_recovery_execution_rejected:${verdict.failures.join(',')}`)
    }
    if (loaded.sha256 !== String(approval?.recovery_execution_sha256 || '')) {
      throw new Error('active_recovery_execution_approval_hash_mismatch')
    }
    return {
      ok: true,
      phase,
      bootstrap_release_id: bootstrapReleaseId,
      execution_receipt_sha256: loaded.sha256,
      execution_receipt_verified: true
    }
  }
  throw new Error('production_recovery_transition_phase_invalid')
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, 'r')
  try { fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
}

function writePrivateJsonExclusive(file, value, maxBytes) {
  const resolved = path.resolve(String(file || ''))
  const directory = path.dirname(resolved)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStat = fs.lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('recovery_private_artifact_directory_unsafe')
  }
  if (fs.existsSync(resolved)) throw new Error('recovery_private_artifact_already_exists')
  const content = `${JSON.stringify(value, null, 2)}\n`
  if (Buffer.byteLength(content) > maxBytes) {
    throw new Error('recovery_private_artifact_too_large')
  }
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`
  )
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.fchmodSync(descriptor, 0o600)
    fs.writeFileSync(descriptor, content, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = undefined
    // Hard-link commit is exclusive: unlike rename(), it cannot overwrite a
    // receipt/intent that appeared after the initial existence check.
    fs.linkSync(temporary, resolved)
    fs.unlinkSync(temporary)
    fs.chmodSync(resolved, 0o600)
    fsyncDirectory(directory)
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    throw error
  }
  return { file: resolved, sha256: sha256File(resolved) }
}

function writePrivateExecutionIntent(file, intent) {
  const verdict = verifyExecutionIntent(intent)
  if (!verdict.ok) {
    throw new Error(`recovery_execution_intent_rejected:${verdict.failures.join(',')}`)
  }
  return writePrivateJsonExclusive(file, intent, MAX_INTENT_BYTES)
}

function removePrivateExecutionIntent(file) {
  const resolved = path.resolve(String(file || ''))
  if (!fs.existsSync(resolved)) return false
  const stat = fs.lstatSync(resolved)
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('refusing_unsafe_recovery_execution_intent_removal')
  }
  fs.unlinkSync(resolved)
  fsyncDirectory(path.dirname(resolved))
  return true
}

function validateCommittedRestoreForIntent(intent) {
  const verdict = verifyExecutionIntent(intent)
  if (!verdict.ok) {
    throw new Error(`recovery_execution_intent_rejected:${verdict.failures.join(',')}`)
  }
  const loaded = privateReceiptFile(intent.restore_receipt_path)
  const receipt = loaded.receipt
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  check(receipt?.schema === 'scv_non_debug_history_recovery_receipt_v1',
    'committed_restore_schema_mismatch')
  check(receipt?.mode === 'execute', 'committed_restore_mode_mismatch')
  check(receipt?.generated_at === intent.restore_started_at_utc,
    'committed_restore_time_mismatch')
  check(receipt?.safety?.backup_created === true, 'committed_restore_backup_missing')
  check(receipt?.safety?.canonical_debug_identity_excluded === true,
    'committed_restore_debug_identity_not_excluded')
  check(receipt?.safety?.pause_all_verified === true, 'committed_restore_pause_unverified')
  check(receipt?.safety?.queue_directories_touched === 0, 'committed_restore_queue_touched')
  check(receipt?.safety?.validation_passed === true, 'committed_restore_validation_failed')
  check(receipt?.counts?.writes_committed === intent.writes.length,
    'committed_restore_write_count_mismatch')
  check(receipt?.counts?.writes_rolled_back === 0, 'committed_restore_was_rolled_back')
  check(receipt?.counts?.queue_directories_touched === 0,
    'committed_restore_queue_count_nonzero')
  check(receipt?.hashes?.input_inventory_sha256 === intent.input_inventory_sha256,
    'committed_restore_input_hash_mismatch')
  check(receipt?.hashes?.plan_sha256 === intent.plan_sha256,
    'committed_restore_plan_hash_mismatch')
  check(SHA256_RE.test(String(receipt?.hashes?.receipt_sha256 || '')),
    'committed_restore_receipt_hash_invalid')
  if (receipt?.hashes && typeof receipt.hashes === 'object') {
    const claimed = receipt.hashes.receipt_sha256
    const withoutHash = JSON.parse(JSON.stringify(receipt))
    if (withoutHash.hashes) delete withoutHash.hashes.receipt_sha256
    check(sha256(stableJson(withoutHash)) === claimed, 'committed_restore_receipt_hash_mismatch')
  }

  const targetRoot = path.resolve(intent.target_root)
  for (const write of intent.writes) {
    const directory = write.kind === 'state' ? 'thread-state' : 'thread-history'
    const file = path.resolve(targetRoot, directory, write.basename)
    const expectedParent = path.resolve(targetRoot, directory)
    check(file.startsWith(`${expectedParent}${path.sep}`), 'committed_restore_output_path_escape')
    if (!fs.existsSync(file)) {
      failures.push('committed_restore_output_missing')
      continue
    }
    const stat = fs.lstatSync(file)
    check(
      stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
      'committed_restore_output_unsafe'
    )
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) continue
    let value
    try {
      value = readJsonFileSnapshot(file, {
        label: 'committed_restore_output',
        maxBytes: MAX_MEMORY_OUTPUT_BYTES,
        privateFile: true,
        allowArray: true
      }).value
    } catch {
      failures.push('committed_restore_output_json_invalid_or_changed')
      continue
    }
    check(sha256(stableJson(value)) === write.output_sha256,
      'committed_restore_output_hash_mismatch')
  }
  if (failures.length) {
    throw new Error(`committed_restore_rejected:${failures.join(',')}`)
  }
  return { receipt, receipt_file_sha256: loaded.sha256 }
}

function writePrivateExecutionReceipt(file, receipt, options = {}) {
  const verdict = verifyExecutionReceipt(receipt, options)
  if (!verdict.ok) {
    throw new Error(`recovery_execution_receipt_rejected:${verdict.failures.join(',')}`)
  }
  return writePrivateJsonExclusive(file, receipt, MAX_RECEIPT_BYTES)
}

module.exports = {
  TRANSITION_PROTOCOL,
  EXECUTION_RECEIPT_SCHEMA,
  EXECUTION_INTENT_SCHEMA,
  PREPARATION_RECEIPT_SCHEMA,
  TRANSITION_DIRECTORY,
  sha256,
  sha256File,
  readJsonFileSnapshot,
  normalizedSourcePackages,
  safeReleaseId,
  persistentNamespaceRoot,
  preparationReceiptPath,
  executionReceiptPath,
  executionIntentPath,
  privateReceiptFile,
  verifyPreparationReceipt,
  verifyExecutionReceipt,
  verifyExecutionIntent,
  readExecutionIntent,
  verifyManifestTransition,
  requireProductionTransition,
  writePrivateExecutionReceipt,
  writePrivateExecutionIntent,
  removePrivateExecutionIntent,
  expectedRestoreReceiptPath,
  validateCommittedRestoreForIntent
}
