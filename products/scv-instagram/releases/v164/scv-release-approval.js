#!/usr/bin/env node
// Cryptographic Ben-approval gate for production promotion.
//
// Staging never needs this receipt. Production accepts a candidate only when a
// detached Ed25519 signature binds the exact release id, content fingerprint,
// manifest hash, and approval purpose. The signing key is never committed.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  runtimeNamespaceFromEnv,
  namespacedPersistRoot
} = require(path.join(__dirname, 'scv-runtime-namespace.js'))
const {
  normalizeCompiledReceiptBinding,
  verifyCompiledReceiptBinding,
  normalizeCompiledSourcePackages,
  verifyCompiledSourcePackages
} = require(path.join(__dirname, 'scv-compiled-recovery-source-contract.js'))

const SCV_RELEASE_APPROVAL_VERSION =
  'scv-ben-production-approval-2026-08-20-v4-exact-evidence-bound'
const SCV_FAIL_CLOSE_CLEAR_APPROVAL_VERSION = 'scv-ben-fail-close-clear-2026-07-25-v1'
const SCV_RECOVERY_EXECUTION_AUTHORIZATION_VERSION =
  'scv-ben-recovery-execution-authorization-2026-08-20-v1'
const PUBLIC_KEY_FILE = path.join(__dirname, 'SCV_BEN_APPROVAL_ED25519_PUBLIC.pem')

function canonicalApprovalPayload(receipt = {}) {
  return JSON.stringify({
    schema: String(receipt.schema || ''),
    action: String(receipt.action || ''),
    release_id: String(receipt.release_id || ''),
    content_fingerprint_sha256: String(receipt.content_fingerprint_sha256 || ''),
    release_manifest_sha256: String(receipt.release_manifest_sha256 || ''),
    release_phase: String(receipt.release_phase || ''),
    full_regression_sha256: String(receipt.full_regression_sha256 || ''),
    real_e2e_sha256: String(receipt.real_e2e_sha256 || ''),
    manychat_handoff_sha256: String(receipt.manychat_handoff_sha256 || ''),
    april_tone_sha256: String(receipt.april_tone_sha256 || ''),
    recovery_preparation_sha256: String(receipt.recovery_preparation_sha256 || ''),
    recovery_execution_sha256: String(receipt.recovery_execution_sha256 || ''),
    approval_id: String(receipt.approval_id || ''),
    approved_by: String(receipt.approved_by || ''),
    approved_at_utc: String(receipt.approved_at_utc || ''),
    reason: String(receipt.reason || '')
  })
}

function canonicalFailCloseClearPayload(receipt = {}) {
  return JSON.stringify({
    schema: String(receipt.schema || ''),
    action: String(receipt.action || ''),
    release_id: String(receipt.release_id || ''),
    release_fingerprint_sha256: String(receipt.release_fingerprint_sha256 || ''),
    latch_activated_at_utc: String(receipt.latch_activated_at_utc || ''),
    approved_by: String(receipt.approved_by || ''),
    approved_at_utc: String(receipt.approved_at_utc || ''),
    reason: String(receipt.reason || '')
  })
}

function normalizedRecoverySourcePackages(value) {
  return normalizeCompiledSourcePackages(value)
}

function canonicalRecoveryExecutionAuthorizationPayload(receipt = {}) {
  return JSON.stringify({
    schema: String(receipt.schema || ''),
    action: String(receipt.action || ''),
    bootstrap_release_id: String(receipt.bootstrap_release_id || ''),
    bootstrap_content_fingerprint_sha256:
      String(receipt.bootstrap_content_fingerprint_sha256 || ''),
    bootstrap_release_manifest_sha256:
      String(receipt.bootstrap_release_manifest_sha256 || ''),
    bootstrap_deployment_id: String(receipt.bootstrap_deployment_id || ''),
    recovery_preparation_sha256: String(receipt.recovery_preparation_sha256 || ''),
    omar_system_purge_receipt_sha256:
      String(receipt.omar_system_purge_receipt_sha256 || ''),
    dry_run_input_inventory_sha256: String(receipt.dry_run_input_inventory_sha256 || ''),
    dry_run_plan_sha256: String(receipt.dry_run_plan_sha256 || ''),
    source_packages: normalizedRecoverySourcePackages(receipt.source_packages),
    authorization_id: String(receipt.authorization_id || ''),
    authorized_by: String(receipt.authorized_by || ''),
    authorized_at_utc: String(receipt.authorized_at_utc || ''),
    reason: String(receipt.reason || '')
  })
}

function approvalPathForRelease(releaseId, env = process.env) {
  const production = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production' ||
    String(env.SCV_RELEASE_MODE || '').trim().toLowerCase() === 'production'
  const persistRoot = String(
    env.SCV_PERSIST_ROOT ||
    env.RAILWAY_VOLUME_MOUNT_PATH ||
    (production ? '' : path.join(__dirname, 'control-data'))
  ).trim()
  if (!persistRoot) throw new Error('production_release_approval_persistent_root_missing')
  if (production && !path.isAbsolute(persistRoot)) {
    throw new Error(`production_release_approval_persistent_root_not_absolute:${persistRoot}`)
  }
  const safeId = String(releaseId || '').replace(/[^a-zA-Z0-9._-]+/g, '-')
  return path.join(
    namespacedPersistRoot(persistRoot, runtimeNamespaceFromEnv(env)),
    'release-approvals',
    `${safeId}.json`
  )
}

function readApprovalReceipt(file) {
  const resolved = path.resolve(String(file || ''))
  const pathStat = fs.lstatSync(resolved)
  if (!pathStat.isFile() || pathStat.isSymbolicLink() ||
      (pathStat.mode & 0o077) !== 0 || pathStat.size < 2 || pathStat.size > 1024 * 1024) {
    throw new Error('release_approval_receipt_file_unsafe')
  }
  const descriptor = fs.openSync(
    resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  )
  try {
    const opened = fs.fstatSync(descriptor)
    if (opened.dev !== pathStat.dev || opened.ino !== pathStat.ino) {
      throw new Error('release_approval_receipt_changed_before_read')
    }
    const bytes = fs.readFileSync(descriptor)
    const after = fs.fstatSync(descriptor)
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs ||
        opened.ctimeMs !== after.ctimeMs || bytes.length !== opened.size) {
      throw new Error('release_approval_receipt_changed_during_read')
    }
    return JSON.parse(bytes.toString('utf8'))
  } finally { fs.closeSync(descriptor) }
}

function verifyApprovalReceipt(receipt, releaseManifest, publicKeyPem = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8')) {
  const failures = []
  const check = (condition, reason) => {
    if (!condition) failures.push(reason)
  }
  check(receipt?.schema === SCV_RELEASE_APPROVAL_VERSION, 'approval_schema_mismatch')
  check(receipt?.action === 'promote_scv_golden_release_to_production', 'approval_action_mismatch')
  check(receipt?.release_id === releaseManifest?.release_id, 'approval_release_id_mismatch')
  check(
    receipt?.content_fingerprint_sha256 === releaseManifest?.content_fingerprint_sha256,
    'approval_content_fingerprint_mismatch'
  )
  check(
    receipt?.release_manifest_sha256 === releaseManifest?.release_manifest_sha256,
    'approval_manifest_hash_mismatch'
  )
  const phase = String(releaseManifest?.deployment?.release_phase || '')
  check(receipt?.release_phase === phase, 'approval_release_phase_mismatch')
  for (const [field, reason] of [
    ['full_regression_sha256', 'approval_full_regression_hash_missing'],
    ['real_e2e_sha256', 'approval_real_e2e_hash_missing'],
    ['manychat_handoff_sha256', 'approval_manychat_handoff_hash_missing'],
    ['april_tone_sha256', 'approval_april_tone_hash_missing']
  ]) check(/^[a-f0-9]{64}$/.test(String(receipt?.[field] || '')), reason)
  if (phase === 'recovery_bootstrap') {
    check(!receipt?.recovery_preparation_sha256, 'approval_bootstrap_preparation_hash_forbidden')
    check(!receipt?.recovery_execution_sha256, 'approval_bootstrap_execution_hash_forbidden')
  } else if (phase === 'active') {
    check(!receipt?.recovery_preparation_sha256, 'approval_active_preparation_hash_forbidden')
    check(
      /^[a-f0-9]{64}$/.test(String(receipt?.recovery_execution_sha256 || '')),
      'approval_recovery_execution_hash_missing'
    )
    check(
      receipt?.recovery_execution_sha256 ===
        releaseManifest?.deployment?.recovery_transition?.execution_receipt_sha256,
      'approval_recovery_execution_hash_mismatch'
    )
  } else {
    check(false, 'approval_release_phase_invalid')
  }
  check(
    /^scv-ben-approval-[a-f0-9]{24}$/.test(String(receipt?.approval_id || '')),
    'approval_id_invalid'
  )
  check(receipt?.approved_by === 'Ben', 'approval_actor_mismatch')
  check(/^\d{4}-\d{2}-\d{2}T/.test(String(receipt?.approved_at_utc || '')), 'approval_time_missing')
  check(typeof receipt?.reason === 'string' && receipt.reason.trim().length >= 3, 'approval_reason_missing')
  check(typeof receipt?.signature_base64 === 'string' && receipt.signature_base64.length > 40, 'approval_signature_missing')

  let signatureValid = false
  if (failures.length === 0) {
    try {
      signatureValid = crypto.verify(
        null,
        Buffer.from(canonicalApprovalPayload(receipt)),
        publicKeyPem,
        Buffer.from(receipt.signature_base64, 'base64')
      )
    } catch {
      signatureValid = false
    }
    check(signatureValid, 'approval_signature_invalid')
  }
  return {
    ok: failures.length === 0,
    signature_valid: signatureValid,
    failures,
    approval_id: String(receipt?.approval_id || ''),
    approved_at_utc: String(receipt?.approved_at_utc || '')
  }
}

function verifyRecoveryExecutionAuthorizationReceipt(
  receipt,
  bootstrapManifest,
  preparation,
  options = {},
  publicKeyPem = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8')
) {
  const failures = []
  const check = (condition, reason) => { if (!condition) failures.push(reason) }
  const sha = (value) => /^[a-f0-9]{64}$/.test(String(value || ''))
  check(receipt?.schema === SCV_RECOVERY_EXECUTION_AUTHORIZATION_VERSION,
    'recovery_authorization_schema_mismatch')
  check(receipt?.action === 'authorize_scv_non_debug_recovery_execution',
    'recovery_authorization_action_mismatch')
  check(bootstrapManifest?.deployment?.release_phase === 'recovery_bootstrap',
    'recovery_authorization_manifest_not_bootstrap')
  check(receipt?.bootstrap_release_id === bootstrapManifest?.release_id,
    'recovery_authorization_release_id_mismatch')
  check(receipt?.bootstrap_content_fingerprint_sha256 ===
      bootstrapManifest?.content_fingerprint_sha256,
  'recovery_authorization_fingerprint_mismatch')
  check(receipt?.bootstrap_release_manifest_sha256 ===
      bootstrapManifest?.release_manifest_sha256,
  'recovery_authorization_manifest_hash_mismatch')
  check(/^[0-9a-f-]{36}$/i.test(String(receipt?.bootstrap_deployment_id || '')),
    'recovery_authorization_deployment_id_invalid')
  check(receipt?.bootstrap_deployment_id === String(options.bootstrapDeploymentId || ''),
    'recovery_authorization_deployment_id_mismatch')
  check(preparation?.bootstrap_deployment_id === receipt?.bootstrap_deployment_id,
    'recovery_authorization_preparation_deployment_mismatch')
  check(sha(receipt?.recovery_preparation_sha256),
    'recovery_authorization_preparation_hash_invalid')
  check(receipt?.recovery_preparation_sha256 === String(options.preparationSha256 || ''),
    'recovery_authorization_preparation_hash_mismatch')
  check(sha(receipt?.omar_system_purge_receipt_sha256),
    'recovery_authorization_omar_purge_hash_invalid')
  check(receipt?.omar_system_purge_receipt_sha256 ===
      preparation?.omar_system_purge_receipt_sha256,
  'recovery_authorization_omar_purge_preparation_mismatch')
  check(receipt?.omar_system_purge_receipt_sha256 ===
      String(options.omarSystemPurgeReceiptSha256 || ''),
  'recovery_authorization_omar_purge_observed_mismatch')
  check(receipt?.dry_run_input_inventory_sha256 ===
      preparation?.dry_run?.input_inventory_sha256 &&
      sha(receipt?.dry_run_input_inventory_sha256),
  'recovery_authorization_input_hash_mismatch')
  check(receipt?.dry_run_plan_sha256 === preparation?.dry_run?.plan_sha256 &&
      sha(receipt?.dry_run_plan_sha256),
  'recovery_authorization_plan_hash_mismatch')
  const receiptPackages = normalizedRecoverySourcePackages(receipt?.source_packages)
  const preparationPackages = normalizedRecoverySourcePackages(preparation?.source_packages)
  const optionPackages = normalizedRecoverySourcePackages(options.sourcePackages)
  const compiledReceipt = normalizeCompiledReceiptBinding(preparation?.compiled_source_receipt)
  failures.push(...verifyCompiledReceiptBinding(
    compiledReceipt,
    'recovery_authorization_compiled_receipt'
  ))
  const packageVerdict = verifyCompiledSourcePackages(receiptPackages, {
    prefix: 'recovery_authorization_source_package',
    receiptBinding: compiledReceipt
  })
  failures.push(...packageVerdict.failures)
  for (const item of receiptPackages) {
    check(/^\/data\/scv-runtime-namespaces\/prod\/recovery-sources\/[a-zA-Z0-9._-]+\.tar\.gz$/.test(
      item.remote_path), 'recovery_authorization_source_path_invalid')
  }
  check(JSON.stringify(receiptPackages) === JSON.stringify(preparationPackages),
    'recovery_authorization_preparation_sources_mismatch')
  check(JSON.stringify(receiptPackages) === JSON.stringify(optionPackages),
    'recovery_authorization_observed_sources_mismatch')
  check(/^scv-ben-recovery-authorization-[a-f0-9]{24}$/.test(
    String(receipt?.authorization_id || '')), 'recovery_authorization_id_invalid')
  check(receipt?.authorized_by === 'Ben', 'recovery_authorization_actor_mismatch')
  check(/^\d{4}-\d{2}-\d{2}T/.test(String(receipt?.authorized_at_utc || '')),
    'recovery_authorization_time_missing')
  check(typeof receipt?.reason === 'string' && receipt.reason.trim().length >= 3,
    'recovery_authorization_reason_missing')
  check(typeof receipt?.signature_base64 === 'string' && receipt.signature_base64.length > 40,
    'recovery_authorization_signature_missing')
  let signatureValid = false
  if (failures.length === 0) {
    try {
      signatureValid = crypto.verify(
        null,
        Buffer.from(canonicalRecoveryExecutionAuthorizationPayload(receipt)),
        publicKeyPem,
        Buffer.from(receipt.signature_base64, 'base64')
      )
    } catch { signatureValid = false }
    check(signatureValid, 'recovery_authorization_signature_invalid')
  }
  return { ok: failures.length === 0, signature_valid: signatureValid, failures }
}

function verifyFailCloseClearApprovalReceipt(
  receipt,
  latch,
  publicKeyPem = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8')
) {
  const failures = []
  const check = (condition, reason) => {
    if (!condition) failures.push(reason)
  }
  check(receipt?.schema === SCV_FAIL_CLOSE_CLEAR_APPROVAL_VERSION, 'clear_approval_schema_mismatch')
  check(receipt?.action === 'clear_scv_golden_fail_close', 'clear_approval_action_mismatch')
  check(receipt?.release_id === latch?.release_id, 'clear_approval_release_id_mismatch')
  check(
    receipt?.release_fingerprint_sha256 === latch?.release_fingerprint_sha256,
    'clear_approval_release_fingerprint_mismatch'
  )
  check(
    receipt?.latch_activated_at_utc === latch?.activated_at_utc,
    'clear_approval_latch_identity_mismatch'
  )
  check(receipt?.approved_by === 'Ben', 'clear_approval_actor_mismatch')
  check(/^\d{4}-\d{2}-\d{2}T/.test(String(receipt?.approved_at_utc || '')), 'clear_approval_time_missing')
  check(typeof receipt?.reason === 'string' && receipt.reason.trim().length >= 3, 'clear_approval_reason_missing')
  check(typeof receipt?.signature_base64 === 'string' && receipt.signature_base64.length > 40, 'clear_approval_signature_missing')

  let signatureValid = false
  if (failures.length === 0) {
    try {
      signatureValid = crypto.verify(
        null,
        Buffer.from(canonicalFailCloseClearPayload(receipt)),
        publicKeyPem,
        Buffer.from(receipt.signature_base64, 'base64')
      )
    } catch {
      signatureValid = false
    }
    check(signatureValid, 'clear_approval_signature_invalid')
  }
  return {
    ok: failures.length === 0,
    signature_valid: signatureValid,
    failures,
    approval_id: String(receipt?.approval_id || '')
  }
}

function requireProductionApproval({ releaseManifest, env = process.env, receiptPath = '' } = {}) {
  const persistent = approvalPathForRelease(releaseManifest?.release_id, env)
  const file = receiptPath || persistent
  if (!fs.existsSync(file)) {
    throw new Error(`production_release_requires_ben_approval:${releaseManifest?.release_id || 'unknown'}`)
  }
  const receipt = readApprovalReceipt(file)
  const verification = verifyApprovalReceipt(receipt, releaseManifest)
  if (!verification.ok) {
    throw new Error(`production_release_approval_rejected:${verification.failures.join(',')}`)
  }
  return { ...verification, file }
}

module.exports = {
  SCV_RELEASE_APPROVAL_VERSION,
  SCV_FAIL_CLOSE_CLEAR_APPROVAL_VERSION,
  SCV_RECOVERY_EXECUTION_AUTHORIZATION_VERSION,
  PUBLIC_KEY_FILE,
  canonicalApprovalPayload,
  canonicalFailCloseClearPayload,
  canonicalRecoveryExecutionAuthorizationPayload,
  normalizedRecoverySourcePackages,
  approvalPathForRelease,
  readApprovalReceipt,
  verifyApprovalReceipt,
  verifyFailCloseClearApprovalReceipt,
  verifyRecoveryExecutionAuthorizationReceipt,
  requireProductionApproval
}
