#!/usr/bin/env node
'use strict'

// A deliberately small release contract for the real Instagram runtime.
//
// This is not a replacement security/evidence platform. It binds one sealed
// source inventory to one Railway production target and one isolated staging
// target. The legacy golden/approval path remains the default. This path is
// reachable only when SCV_RELEASE_PROTOCOL is the exact explicit value below.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  SCV_VISIBLE_MODEL_SNAPSHOT,
  SCV_VISIBLE_EXECUTOR,
  SCV_VISIBLE_API,
  MODEL_ENV_EXPECTED,
  modelContractVerdict,
  runtimeBehaviorContractVerdict
} = require('./scv-runtime-behavior-contract.js')

const SCV_SINGLE_RELEASE_PROTOCOL = 'single_release_v1'
const SCV_SINGLE_RELEASE_SCHEMA = 'scv-instagram-single-release-2026-08-29-v2'
const SCV_SINGLE_RELEASE_FILE = 'SCV_SINGLE_RELEASE.json'
const SCV_PREFLIGHT_PROOF_SCHEMA = 'scv-production-preflight-proof-2026-08-19-v1'
const CANONICAL_BEHAVIOR = 'instagram-dm-mid-april-2026'
const SHA256_RE = /^[a-f0-9]{64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RELEASE_ID_RE = /^[a-z0-9][a-z0-9._-]{7,127}$/

// These are the exact protected legacy surfaces. single_release_v1 neither
// reads nor hashes them. They remain available only to the unchanged legacy
// release path.
const PROTECTED_LEGACY_FILES = new Set([
  'SCV_GOLDEN_PRODUCTION_RELEASE.json',
  'SCV_GOLDEN_SNAPSHOT_MANIFEST.json',
  'SCV_IMMUTABLE_DRIFT_SEAL.json',
  'scv-immutable-drift-firewall.js'
])

const MUTABLE_ROOT_FILES = new Set([
  'dm_conversion_events.jsonl',
  'dm_conversion_state.json',
  'dm_darwin_state.json',
  'dm_hinton_state.json'
])

// These worktree files belong to the excluded legacy activation path and are
// intentionally not part of the one deployable single-release artifact.
const NON_ARTIFACT_ROOT_FILES = new Set([
  'scv-production-entry.js',
  'scv-production-activation-latch.js',
  'scv-production-activation-latch-harness.js'
])

const MUTABLE_OR_NON_ARTIFACT_DIRS = new Set([
  '.git', '.wrangler', '.bkit', '.omc', 'node_modules', 'ops', 'artifacts',
  // Runtime-transient delivery surfaces. The single-control plane creates a
  // delivery publication for every send attempt and clears it afterwards;
  // counting those instants in the release inventory made the final sender's
  // own bookkeeping reject the release fingerprint mid-send (2026-08-26:
  // every delivery attempt returned 423 identity-rejected while idle checks
  // passed). Corrupt-quarantine surfaces are runtime-created the same way.
  'accepted-unverified-boundary-pending',
  'accepted-unverified-delivery-publications',
  'inbox_quarantine_corrupt', 'outbox_quarantine_corrupt_adoption',
  'inbox', 'outbox', 'reactbox', 'reactbox_done', 'reactbox_failed',
  'logs', 'form-submissions', 'thread-state', 'thread-state_pre_migration',
  'thread-history', 'thread-state_quarantine_contaminated',
  'thread-history_quarantine_contaminated', 'inbox_quarantine_superseded',
  'inbox_quarantine_deadletter', 'outbox_quarantine_stale',
  'outbox_quarantine_non_authoritative',
  'outbox_quarantine_contract_harness', 'outbox_quarantine_failed',
  'outbox_human_agent_required', 'outbox_quarantine_pre_single_control',
  'outbox-idempotency', 'control-events', 'control-decisions',
  'control-locks'
])

const DESCRIPTOR_KEYS = Object.freeze([
  'canonical_behavior', 'content_fingerprint_sha256', 'created_at_utc',
  'files', 'models', 'persistence', 'railway', 'release_id', 'runtime', 'schema'
])
const FILE_KEYS = Object.freeze(['bytes', 'path', 'sha256'])
const RAILWAY_KEYS = Object.freeze(['production', 'project_id', 'staging'])
const TARGET_KEYS = Object.freeze(['environment_id', 'service_id'])
const PERSISTENCE_KEYS = Object.freeze([
  'production_namespace', 'root', 'staging_namespace'
])
const RUNTIME_KEYS = Object.freeze([
  'entrypoint', 'final_sender', 'node_version'
])
const MODEL_KEYS = Object.freeze([
  'api', 'asr_adjudicator_model', 'asr_primary_model',
  'asr_secondary_model', 'enforce_identity', 'executor', 'intent_model',
  'reasoning_effort', 'visible_model', 'vision_model'
])
const REQUIRED_MODELS = Object.freeze({
  // Official OpenAI dated snapshots are used instead of mutable aliases. The
  // runtime behavior contract binds every auxiliary model to the same release.
  visible_model: SCV_VISIBLE_MODEL_SNAPSHOT,
  executor: SCV_VISIBLE_EXECUTOR,
  api: SCV_VISIBLE_API,
  reasoning_effort: 'medium',
  enforce_identity: '1',
  vision_model: MODEL_ENV_EXPECTED.OPENAI_VISION_MODEL,
  intent_model: MODEL_ENV_EXPECTED.OPENAI_INTENT_MODEL,
  asr_adjudicator_model: MODEL_ENV_EXPECTED.OPENAI_ASR_ADJUDICATOR_MODEL,
  asr_primary_model: MODEL_ENV_EXPECTED.SCV_TRANSCRIBE_MODEL,
  asr_secondary_model: MODEL_ENV_EXPECTED.SCV_TRANSCRIBE_SECONDARY_MODEL
})

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function exactKeys(value, expected) {
  return Boolean(value && !Array.isArray(value) && typeof value === 'object') &&
    Object.keys(value).sort().join('\n') === [...expected].sort().join('\n')
}

function canonicalIso(value) {
  const raw = String(value || '')
  const parsed = new Date(raw)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === raw
}

function isSingleReleaseRequested(env = process.env) {
  return String(env.SCV_RELEASE_PROTOCOL || '').trim() ===
    SCV_SINGLE_RELEASE_PROTOCOL
}

function safeNamespace(value) {
  const raw = String(value || '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(raw) ? raw : ''
}

function ignoredRootFile(name) {
  if (name === SCV_SINGLE_RELEASE_FILE || name === '.gitignore') return true
  if (PROTECTED_LEGACY_FILES.has(name) || MUTABLE_ROOT_FILES.has(name)) return true
  if (NON_ARTIFACT_ROOT_FILES.has(name)) return true
  if (name === 'SCV_PRODUCTION_RELEASE_APPROVAL.json') return true
  if (name === '.env' || name.startsWith('.env.')) return true
  if (name !== 'package-lock.json' && (/\.lock$/i.test(name) || /\.tmp$/i.test(name))) {
    return true
  }
  if (/^npm-debug\.log/i.test(name)) return true
  if (/\.key$/i.test(name) || /PRIVATE.*\.pem$/i.test(name)) return true
  return false
}

function safeRelativePath(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
    .split(path.sep).join('/')
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative) ||
      relative.includes('\u0000')) {
    throw new Error('single_release_inventory_path_escape')
  }
  return relative
}

function readStableRegularFile(file, maxBytes = 16 * 1024 * 1024) {
  const before = fs.lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error(`single_release_inventory_file_unsafe:${path.basename(file)}`)
  }
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  )
  try {
    const opened = fs.fstatSync(descriptor)
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('single_release_inventory_file_changed_before_read')
    }
    const bytes = fs.readFileSync(descriptor)
    const after = fs.fstatSync(descriptor)
    if (after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs || bytes.length !== opened.size) {
      throw new Error('single_release_inventory_file_changed_during_read')
    }
    return bytes
  } finally {
    fs.closeSync(descriptor)
  }
}

function collectRuntimeInputs(root = __dirname) {
  const resolvedRoot = path.resolve(root)
  const files = []
  const walk = (directory, topLevel = false) => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (topLevel && MUTABLE_OR_NON_ARTIFACT_DIRS.has(entry.name)) continue
      if (topLevel && ignoredRootFile(entry.name)) continue
      const target = path.join(directory, entry.name)
      const relative = safeRelativePath(resolvedRoot, target)
      if (entry.isSymbolicLink()) {
        throw new Error(`single_release_inventory_symlink_forbidden:${relative}`)
      }
      if (entry.isDirectory()) {
        walk(target, false)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`single_release_inventory_special_file_forbidden:${relative}`)
      }
      const bytes = readStableRegularFile(target)
      files.push({ path: relative, sha256: sha256(bytes), bytes: bytes.length })
      if (files.length > 10000) {
        throw new Error('single_release_inventory_file_limit_exceeded')
      }
    }
  }
  walk(resolvedRoot, true)
  return files.sort((left, right) => {
    if (left.path < right.path) return -1
    if (left.path > right.path) return 1
    return 0
  })
}

function contentFingerprint(files) {
  return sha256(Buffer.from(JSON.stringify(files), 'utf8'))
}

function buildSingleReleaseDescriptor({
  root = __dirname,
  releaseId,
  projectId,
  productionEnvironmentId,
  productionServiceId,
  stagingEnvironmentId,
  stagingServiceId,
  productionNamespace,
  stagingNamespace,
  createdAt = new Date()
} = {}) {
  const files = collectRuntimeInputs(root)
  return {
    schema: SCV_SINGLE_RELEASE_SCHEMA,
    release_id: String(releaseId || '').trim(),
    created_at_utc: createdAt.toISOString(),
    canonical_behavior: CANONICAL_BEHAVIOR,
    content_fingerprint_sha256: contentFingerprint(files),
    railway: {
      project_id: String(projectId || '').trim(),
      production: {
        environment_id: String(productionEnvironmentId || '').trim(),
        service_id: String(productionServiceId || '').trim()
      },
      staging: {
        environment_id: String(stagingEnvironmentId || '').trim(),
        service_id: String(stagingServiceId || '').trim()
      }
    },
    persistence: {
      root: '/data',
      production_namespace: String(productionNamespace || '').trim(),
      staging_namespace: String(stagingNamespace || '').trim()
    },
    runtime: {
      node_version: 'v20.20.2',
      entrypoint: 'scv-single-release-entry.js',
      final_sender: 'outbound-scv2.js'
    },
    models: { ...REQUIRED_MODELS },
    files
  }
}

function descriptorStructureFailures(descriptor) {
  const failures = []
  const check = (condition, label) => { if (!condition) failures.push(label) }
  check(exactKeys(descriptor, DESCRIPTOR_KEYS), 'single_release_descriptor_keys_invalid')
  check(descriptor?.schema === SCV_SINGLE_RELEASE_SCHEMA, 'single_release_schema_mismatch')
  check(RELEASE_ID_RE.test(String(descriptor?.release_id || '')), 'single_release_id_invalid')
  check(canonicalIso(descriptor?.created_at_utc), 'single_release_created_at_invalid')
  check(descriptor?.canonical_behavior === CANONICAL_BEHAVIOR,
    'single_release_canonical_behavior_mismatch')
  check(SHA256_RE.test(String(descriptor?.content_fingerprint_sha256 || '')),
    'single_release_content_fingerprint_invalid')
  check(exactKeys(descriptor?.railway, RAILWAY_KEYS), 'single_release_railway_keys_invalid')
  check(exactKeys(descriptor?.railway?.production, TARGET_KEYS),
    'single_release_production_target_keys_invalid')
  check(exactKeys(descriptor?.railway?.staging, TARGET_KEYS),
    'single_release_staging_target_keys_invalid')
  check(UUID_RE.test(String(descriptor?.railway?.project_id || '')),
    'single_release_project_id_invalid')
  for (const [name, target] of [
    ['production', descriptor?.railway?.production],
    ['staging', descriptor?.railway?.staging]
  ]) {
    check(UUID_RE.test(String(target?.environment_id || '')),
      `single_release_${name}_environment_id_invalid`)
    check(UUID_RE.test(String(target?.service_id || '')),
      `single_release_${name}_service_id_invalid`)
  }
  check(
    descriptor?.railway?.production?.environment_id !==
      descriptor?.railway?.staging?.environment_id,
    'single_release_staging_environment_not_isolated'
  )
  check(
    descriptor?.railway?.production?.service_id !==
      descriptor?.railway?.staging?.service_id,
    'single_release_staging_service_not_isolated'
  )
  check(exactKeys(descriptor?.persistence, PERSISTENCE_KEYS),
    'single_release_persistence_keys_invalid')
  check(descriptor?.persistence?.root === '/data', 'single_release_persist_root_invalid')
  const productionNamespace = safeNamespace(
    descriptor?.persistence?.production_namespace
  )
  const stagingNamespace = safeNamespace(descriptor?.persistence?.staging_namespace)
  check(Boolean(productionNamespace), 'single_release_production_namespace_invalid')
  check(Boolean(stagingNamespace), 'single_release_staging_namespace_invalid')
  check(Boolean(productionNamespace && stagingNamespace &&
    productionNamespace !== stagingNamespace), 'single_release_namespaces_not_isolated')
  check(exactKeys(descriptor?.runtime, RUNTIME_KEYS), 'single_release_runtime_keys_invalid')
  check(descriptor?.runtime?.node_version === 'v20.20.2',
    'single_release_node_version_invalid')
  check(descriptor?.runtime?.entrypoint === 'scv-single-release-entry.js',
    'single_release_entrypoint_invalid')
  check(descriptor?.runtime?.final_sender === 'outbound-scv2.js',
    'single_release_final_sender_invalid')
  check(exactKeys(descriptor?.models, MODEL_KEYS), 'single_release_model_keys_invalid')
  for (const [key, value] of Object.entries(REQUIRED_MODELS)) {
    check(descriptor?.models?.[key] === value, `single_release_model_mismatch:${key}`)
  }
  check(Array.isArray(descriptor?.files) && descriptor.files.length > 0,
    'single_release_files_missing')
  let previous = ''
  const seen = new Set()
  for (const file of Array.isArray(descriptor?.files) ? descriptor.files : []) {
    check(exactKeys(file, FILE_KEYS), 'single_release_file_keys_invalid')
    const relative = String(file?.path || '')
    check(Boolean(relative) && !relative.startsWith('/') &&
      !relative.split('/').includes('..') && !relative.includes('\\'),
    'single_release_file_path_invalid')
    check(relative > previous, 'single_release_files_not_strictly_sorted')
    check(!seen.has(relative), 'single_release_file_duplicate')
    check(SHA256_RE.test(String(file?.sha256 || '')), 'single_release_file_hash_invalid')
    check(Number.isSafeInteger(file?.bytes) && file.bytes >= 0,
      'single_release_file_size_invalid')
    previous = relative
    seen.add(relative)
  }
  for (const required of [
    'cloud-start.js', 'inbound-scv.js', 'outbound-scv2.js',
    'scv-single-release-entry.js', 'scv-single-release.js',
    'scv-single-control-plane.js', 'inbox-worker.js', 'outbox-worker.js',
    'package.json', 'package-lock.json', 'Dockerfile', 'railway.json',
    'prompt-authority/OMAR_LUA_RCC_ENGINE_v26_CLEAN_CONSOLIDATED.txt',
    'prompt-authority/TALEK_LUA_SELF_IDENTITY_CORE_PROMPT.txt',
    'SCV_APRIL_TONE_FLOOR.json'
  ]) check(seen.has(required), `single_release_required_file_missing:${required}`)
  for (const protectedFile of PROTECTED_LEGACY_FILES) {
    check(!seen.has(protectedFile), `single_release_protected_file_included:${protectedFile}`)
  }
  for (const mutableFile of MUTABLE_ROOT_FILES) {
    check(!seen.has(mutableFile), `single_release_mutable_file_included:${mutableFile}`)
  }
  return failures
}

function readSingleReleaseDescriptor(root = __dirname) {
  const file = path.join(root, SCV_SINGLE_RELEASE_FILE)
  const bytes = readStableRegularFile(file, 8 * 1024 * 1024)
  let descriptor
  try { descriptor = JSON.parse(bytes.toString('utf8')) } catch {
    throw new Error('single_release_descriptor_json_invalid')
  }
  return { file, bytes, descriptor, sha256: sha256(bytes) }
}

function runtimeMode(env = process.env) {
  const railwayName = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase()
  const configured = String(env.SCV_RELEASE_MODE || '').trim().toLowerCase()
  if (railwayName === 'production' || configured === 'production') {
    return railwayName === 'production' && configured === 'production'
      ? 'production'
      : 'invalid'
  }
  if (configured === 'staging' && railwayName && railwayName !== 'production') {
    return 'staging'
  }
  return 'invalid'
}

function proveSingleReleasePersistence(descriptor, mode, env = process.env) {
  if (String(env.SCV_PERSIST_ROOT || '') !== '/data') {
    throw new Error('single_release_runtime_persist_root_mismatch')
  }
  const expectedNamespace = mode === 'production'
    ? descriptor?.persistence?.production_namespace
    : descriptor?.persistence?.staging_namespace
  if (!expectedNamespace || String(env.SCV_RUNTIME_NAMESPACE || '') !== expectedNamespace) {
    throw new Error('single_release_runtime_namespace_mismatch')
  }
  const rootStat = fs.lstatSync('/data')
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('single_release_persist_root_unsafe')
  }
  const namespaceParent = path.join('/data', 'scv-runtime-namespaces')
  fs.mkdirSync(namespaceParent, { recursive: true, mode: 0o700 })
  const parentStat = fs.lstatSync(namespaceParent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('single_release_persist_namespace_parent_unsafe')
  }
  const namespaceRoot = path.join(namespaceParent, expectedNamespace)
  fs.mkdirSync(namespaceRoot, { recursive: true, mode: 0o700 })
  const namespaceStat = fs.lstatSync(namespaceRoot)
  if (!namespaceStat.isDirectory() || namespaceStat.isSymbolicLink()) {
    throw new Error('single_release_persist_namespace_unsafe')
  }
  const probe = path.join(
    namespaceRoot,
    `.single-release-probe-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
  )
  const payload = crypto.randomBytes(32)
  let descriptorFd
  try {
    descriptorFd = fs.openSync(probe, 'wx', 0o600)
    fs.writeFileSync(descriptorFd, payload)
    fs.fsyncSync(descriptorFd)
    fs.closeSync(descriptorFd)
    descriptorFd = undefined
    if (!fs.readFileSync(probe).equals(payload)) {
      throw new Error('single_release_persist_probe_readback_mismatch')
    }
  } finally {
    if (descriptorFd !== undefined) fs.closeSync(descriptorFd)
    try { fs.unlinkSync(probe) } catch {}
  }
  const directoryFd = fs.openSync(namespaceRoot, 'r')
  try { fs.fsyncSync(directoryFd) } finally { fs.closeSync(directoryFd) }
  return {
    ok: true,
    root: '/data',
    namespace: expectedNamespace,
    write_fsync_read_delete_verified: true
  }
}

function verifySingleRelease({
  root = __dirname,
  env = process.env,
  verifyPersistence = true,
  persistenceProbe = proveSingleReleasePersistence
} = {}) {
  const failures = []
  const check = (condition, label) => { if (!condition) failures.push(label) }
  check(isSingleReleaseRequested(env), 'single_release_protocol_not_explicit')
  let loaded = null
  try { loaded = readSingleReleaseDescriptor(root) } catch (error) {
    failures.push(String(error?.message || 'single_release_descriptor_unreadable'))
  }
  const descriptor = loaded?.descriptor || null
  failures.push(...descriptorStructureFailures(descriptor))
  let actualFiles = []
  try { actualFiles = collectRuntimeInputs(root) } catch (error) {
    failures.push(String(error?.message || 'single_release_inventory_unreadable'))
  }
  if (descriptor && actualFiles.length) {
    check(JSON.stringify(actualFiles) === JSON.stringify(descriptor.files),
      'single_release_inventory_mismatch')
    check(contentFingerprint(actualFiles) === descriptor.content_fingerprint_sha256,
      'single_release_content_fingerprint_mismatch')
  }
  const mode = runtimeMode(env)
  check(mode === 'production' || mode === 'staging', 'single_release_runtime_mode_invalid')
  const target = mode === 'production'
    ? descriptor?.railway?.production
    : descriptor?.railway?.staging
  check(String(env.RAILWAY_PROJECT_ID || '') === String(descriptor?.railway?.project_id || ''),
    'single_release_railway_project_mismatch')
  check(String(env.RAILWAY_ENVIRONMENT_ID || '') === String(target?.environment_id || ''),
    'single_release_railway_environment_mismatch')
  check(String(env.RAILWAY_SERVICE_ID || '') === String(target?.service_id || ''),
    'single_release_railway_service_mismatch')
  check(UUID_RE.test(String(env.RAILWAY_DEPLOYMENT_ID || '')),
    'single_release_railway_deployment_id_invalid')
  check(String(env.SCV_PERSIST_ROOT || '') === '/data',
    'single_release_runtime_persist_root_mismatch')
  const expectedNamespace = mode === 'production'
    ? descriptor?.persistence?.production_namespace
    : descriptor?.persistence?.staging_namespace
  check(String(env.SCV_RUNTIME_NAMESPACE || '') === String(expectedNamespace || ''),
    'single_release_runtime_namespace_mismatch')
  check(process.version === String(descriptor?.runtime?.node_version || ''),
    'single_release_node_runtime_mismatch')
  for (const [key, value] of [
    ['OPENAI_DM_MODEL', descriptor?.models?.visible_model],
    ['OPENAI_VISION_MODEL', descriptor?.models?.vision_model],
    ['OPENAI_INTENT_MODEL', descriptor?.models?.intent_model],
    ['OPENAI_ASR_ADJUDICATOR_MODEL', descriptor?.models?.asr_adjudicator_model],
    ['SCV_TRANSCRIBE_MODEL', descriptor?.models?.asr_primary_model],
    ['SCV_TRANSCRIBE_SECONDARY_MODEL', descriptor?.models?.asr_secondary_model],
    ['SCV_DM_EXECUTOR', descriptor?.models?.executor],
    ['SCV_OPENAI_EXECUTOR', descriptor?.models?.api],
    ['OPENAI_RESPONSES_REASONING_EFFORT', descriptor?.models?.reasoning_effort],
    ['SCV_ENFORCE_OPENAI_MODEL_IDENTITY', descriptor?.models?.enforce_identity],
    ['SCV_ENFORCE_MODEL_IDENTITY', descriptor?.models?.enforce_identity],
    ['SCV_OPENAI_RESPONSES_REQUIRED', '1']
  ]) check(String(env[key] || '') === String(value || ''),
    `single_release_model_env_mismatch:${key}`)
  const behaviorContract = runtimeBehaviorContractVerdict(env, { mode })
  failures.push(...behaviorContract.failures)
  let persistence = {
    ok: false,
    root: String(env.SCV_PERSIST_ROOT || ''),
    namespace: String(env.SCV_RUNTIME_NAMESPACE || ''),
    write_fsync_read_delete_verified: false
  }
  if (verifyPersistence && descriptor && (mode === 'production' || mode === 'staging')) {
    try { persistence = persistenceProbe(descriptor, mode, env) } catch (error) {
      failures.push(String(error?.message || 'single_release_persistence_probe_failed'))
    }
  } else if (!verifyPersistence) {
    persistence = {
      ...persistence,
      ok: true,
      inherited_preflight_required: true
    }
  }
  return {
    ok: failures.length === 0,
    protocol: SCV_SINGLE_RELEASE_PROTOCOL,
    mode,
    failures,
    descriptor,
    release_id: String(descriptor?.release_id || ''),
    content_fingerprint_sha256: String(descriptor?.content_fingerprint_sha256 || ''),
    release_manifest_sha256: String(loaded?.sha256 || ''),
    manifest: descriptor
      ? {
          release_id: descriptor.release_id,
          content_fingerprint_sha256: descriptor.content_fingerprint_sha256,
          release_manifest_sha256: String(loaded?.sha256 || ''),
          deployment: {
            release_phase: 'active',
            railway_identity: {
              RAILWAY_PROJECT_ID: descriptor.railway.project_id,
              RAILWAY_ENVIRONMENT_ID:
                descriptor.railway.production.environment_id,
              RAILWAY_SERVICE_ID: descriptor.railway.production.service_id,
              RAILWAY_ENVIRONMENT_NAME: 'production'
            }
          }
        }
      : null,
    railway_deployment_id: String(env.RAILWAY_DEPLOYMENT_ID || ''),
    persistence,
    behavior_contract: behaviorContract,
    models: descriptor?.models ? { ...descriptor.models } : null
  }
}

function requireSingleRelease(options = {}) {
  const receipt = verifySingleRelease(options)
  if (!receipt.ok) {
    throw new Error(`single_release_rejected:${receipt.failures.join(',')}`)
  }
  return receipt
}

const RUNTIME_BINDINGS = Object.freeze([
  ['SCV_RELEASE_RAILWAY_PROJECT_ID', 'RAILWAY_PROJECT_ID'],
  ['SCV_RELEASE_RAILWAY_ENVIRONMENT_ID', 'RAILWAY_ENVIRONMENT_ID'],
  ['SCV_RELEASE_RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_ENVIRONMENT_NAME'],
  ['SCV_RELEASE_RAILWAY_SERVICE_ID', 'RAILWAY_SERVICE_ID'],
  ['SCV_RELEASE_RAILWAY_DEPLOYMENT_ID', 'RAILWAY_DEPLOYMENT_ID']
])

function installSingleReleaseRuntimeIdentity(receipt, env = process.env) {
  if (!receipt?.ok || receipt.protocol !== SCV_SINGLE_RELEASE_PROTOCOL) {
    throw new Error('single_release_identity_requires_verified_receipt')
  }
  const values = {
    SCV_RELEASE_ID: String(receipt.release_id || ''),
    SCV_CONTENT_FINGERPRINT: String(receipt.content_fingerprint_sha256 || ''),
    SCV_RELEASE_MANIFEST_SHA256: String(receipt.release_manifest_sha256 || ''),
    SCV_GOLDEN_RELEASE_ID: String(receipt.release_id || ''),
    SCV_GOLDEN_RELEASE_FINGERPRINT: String(receipt.content_fingerprint_sha256 || '')
  }
  for (const [captured, live] of RUNTIME_BINDINGS) {
    values[captured] = String(env[live] || '')
  }
  if (!RELEASE_ID_RE.test(values.SCV_RELEASE_ID) ||
      !SHA256_RE.test(values.SCV_CONTENT_FINGERPRINT) ||
      !SHA256_RE.test(values.SCV_RELEASE_MANIFEST_SHA256) ||
      RUNTIME_BINDINGS.some(([captured]) => !values[captured])) {
    throw new Error('single_release_identity_values_invalid')
  }
  Object.assign(env, values)
  return { ...values }
}

function buildSingleReleasePreflightProof(receipt, env = process.env, now = new Date()) {
  if (!receipt?.ok || receipt.protocol !== SCV_SINGLE_RELEASE_PROTOCOL) {
    throw new Error('single_release_proof_requires_verified_receipt')
  }
  if (receipt.persistence?.write_fsync_read_delete_verified !== true) {
    throw new Error('single_release_proof_requires_durable_persistence_probe')
  }
  return {
    schema: SCV_PREFLIGHT_PROOF_SCHEMA,
    created_at_utc: now.toISOString(),
    mode: receipt.mode,
    protocol: SCV_SINGLE_RELEASE_PROTOCOL,
    release_id: receipt.release_id,
    content_fingerprint_sha256: receipt.content_fingerprint_sha256,
    release_manifest_sha256: receipt.release_manifest_sha256,
    railway_deployment_id: String(env.RAILWAY_DEPLOYMENT_ID || ''),
    gates: {
      release_verified: true,
      immutable_firewall_verified: false,
      environment_values_verified: receipt.behavior_contract?.ok === true,
      railway_identity_verified: true,
      persistent_storage_verified: true,
      staging_isolation_verified: receipt.mode === 'staging',
      node_runtime_verified: true,
      production_approval_verified: false,
      recovery_transition_verified: false,
      production_activation_latch_verified: false,
      credentialless_activation_pending_only: false,
      single_release_inventory_verified: true,
      single_release_behavior_environment_verified:
        receipt.behavior_contract?.ok === true,
      single_release_railway_identity_verified: true,
      single_release_persistence_verified: true,
      single_release_staging_isolation_verified: receipt.mode === 'staging'
    },
    behavior_contract_sha256:
      String(receipt.behavior_contract?.contract_sha256 || '')
  }
}

function readPreflightProof(env = process.env) {
  const encoded = String(env.SCV_PREFLIGHT_PROOF_B64 || '').trim()
  if (!encoded || encoded.length > 16 * 1024 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null
  }
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return value && !Array.isArray(value) && typeof value === 'object' ? value : null
  } catch { return null }
}

function singleReleaseRuntimeIdentityVerdict({ receipt, env = process.env } = {}) {
  const failures = []
  const check = (condition, label) => { if (!condition) failures.push(label) }
  const proof = readPreflightProof(env)
  const gates = proof?.gates && typeof proof.gates === 'object' ? proof.gates : {}
  check(isSingleReleaseRequested(env), 'single_release_protocol_not_explicit')
  check(receipt?.ok === true, 'single_release_receipt_not_verified')
  check(proof?.schema === SCV_PREFLIGHT_PROOF_SCHEMA,
    'single_release_preflight_schema_mismatch')
  check(proof?.protocol === SCV_SINGLE_RELEASE_PROTOCOL,
    'single_release_preflight_protocol_mismatch')
  check(proof?.mode === receipt?.mode, 'single_release_preflight_mode_mismatch')
  check(proof?.release_id === receipt?.release_id,
    'single_release_preflight_release_id_mismatch')
  check(proof?.content_fingerprint_sha256 === receipt?.content_fingerprint_sha256,
    'single_release_preflight_content_fingerprint_mismatch')
  check(proof?.release_manifest_sha256 === receipt?.release_manifest_sha256,
    'single_release_preflight_manifest_hash_mismatch')
  check(proof?.railway_deployment_id === String(env.RAILWAY_DEPLOYMENT_ID || ''),
    'single_release_preflight_deployment_mismatch')
  check(gates.single_release_inventory_verified === true,
    'single_release_preflight_inventory_gate_missing')
  check(gates.single_release_behavior_environment_verified === true,
    'single_release_preflight_behavior_environment_gate_missing')
  check(proof?.behavior_contract_sha256 ===
    String(receipt?.behavior_contract?.contract_sha256 || ''),
  'single_release_preflight_behavior_contract_mismatch')
  check(gates.single_release_railway_identity_verified === true,
    'single_release_preflight_railway_gate_missing')
  check(gates.single_release_persistence_verified === true,
    'single_release_preflight_persistence_gate_missing')
  if (receipt?.mode === 'staging') {
    check(gates.single_release_staging_isolation_verified === true,
      'single_release_preflight_staging_gate_missing')
  }
  const expected = {
    SCV_RELEASE_ID: receipt?.release_id,
    SCV_CONTENT_FINGERPRINT: receipt?.content_fingerprint_sha256,
    SCV_RELEASE_MANIFEST_SHA256: receipt?.release_manifest_sha256,
    SCV_GOLDEN_RELEASE_ID: receipt?.release_id,
    SCV_GOLDEN_RELEASE_FINGERPRINT: receipt?.content_fingerprint_sha256
  }
  for (const [key, value] of Object.entries(expected)) {
    check(String(env[key] || '') === String(value || ''),
      `single_release_runtime_binding_mismatch:${key}`)
  }
  for (const [captured, live] of RUNTIME_BINDINGS) {
    check(Boolean(String(env[live] || '')) &&
      String(env[captured] || '') === String(env[live] || ''),
    `single_release_runtime_binding_mismatch:${captured}`)
  }
  check(String(env.SCV_PERSIST_ROOT || '') === '/data',
    'single_release_runtime_persist_root_mismatch')
  check(String(env.SCV_RUNTIME_NAMESPACE || '') ===
    String(receipt?.persistence?.namespace || ''),
  'single_release_runtime_namespace_mismatch')
  for (const [key, value] of [
    ['OPENAI_DM_MODEL', receipt?.models?.visible_model],
    ['OPENAI_VISION_MODEL', receipt?.models?.vision_model],
    ['OPENAI_INTENT_MODEL', receipt?.models?.intent_model],
    ['OPENAI_ASR_ADJUDICATOR_MODEL', receipt?.models?.asr_adjudicator_model],
    ['SCV_TRANSCRIBE_MODEL', receipt?.models?.asr_primary_model],
    ['SCV_TRANSCRIBE_SECONDARY_MODEL', receipt?.models?.asr_secondary_model],
    ['SCV_DM_EXECUTOR', receipt?.models?.executor],
    ['SCV_OPENAI_EXECUTOR', receipt?.models?.api],
    ['OPENAI_RESPONSES_REASONING_EFFORT', receipt?.models?.reasoning_effort],
    ['SCV_ENFORCE_OPENAI_MODEL_IDENTITY', receipt?.models?.enforce_identity],
    ['SCV_ENFORCE_MODEL_IDENTITY', receipt?.models?.enforce_identity],
    ['SCV_OPENAI_RESPONSES_REQUIRED', '1']
  ]) check(String(env[key] || '') === String(value || ''),
    `single_release_runtime_model_mismatch:${key}`)
  const modelContract = modelContractVerdict(env)
  const behaviorContract = runtimeBehaviorContractVerdict(env, {
    mode: receipt?.mode
  })
  failures.push(...modelContract.failures, ...behaviorContract.failures)
  check(behaviorContract.contract_sha256 ===
    String(receipt?.behavior_contract?.contract_sha256 || ''),
  'single_release_runtime_behavior_contract_mismatch')
  return {
    ok: failures.length === 0,
    required: true,
    protocol: SCV_SINGLE_RELEASE_PROTOCOL,
    mode: String(receipt?.mode || ''),
    release_id: String(receipt?.release_id || ''),
    content_fingerprint_sha256: String(receipt?.content_fingerprint_sha256 || ''),
    release_manifest_sha256: String(receipt?.release_manifest_sha256 || ''),
    railway_deployment_id: String(env.RAILWAY_DEPLOYMENT_ID || ''),
    model_contract: modelContract,
    behavior_contract: behaviorContract,
    failures,
    reason: failures.length ? 'single_release_runtime_identity_rejected' :
      'single_release_runtime_identity_verified'
  }
}

function requireSingleReleaseRuntimeIdentity(options = {}) {
  const verdict = singleReleaseRuntimeIdentityVerdict(options)
  if (!verdict.ok) {
    throw new Error(`single_release_runtime_identity_rejected:${verdict.failures.join(',')}`)
  }
  return verdict
}

module.exports = {
  SCV_SINGLE_RELEASE_PROTOCOL,
  SCV_SINGLE_RELEASE_SCHEMA,
  SCV_SINGLE_RELEASE_FILE,
  SCV_PREFLIGHT_PROOF_SCHEMA,
  CANONICAL_BEHAVIOR,
  PROTECTED_LEGACY_FILES,
  MUTABLE_ROOT_FILES,
  NON_ARTIFACT_ROOT_FILES,
  MUTABLE_OR_NON_ARTIFACT_DIRS,
  REQUIRED_MODELS,
  sha256,
  isSingleReleaseRequested,
  collectRuntimeInputs,
  contentFingerprint,
  buildSingleReleaseDescriptor,
  descriptorStructureFailures,
  readSingleReleaseDescriptor,
  runtimeMode,
  proveSingleReleasePersistence,
  verifySingleRelease,
  requireSingleRelease,
  installSingleReleaseRuntimeIdentity,
  buildSingleReleasePreflightProof,
  readPreflightProof,
  singleReleaseRuntimeIdentityVerdict,
  requireSingleReleaseRuntimeIdentity
}
