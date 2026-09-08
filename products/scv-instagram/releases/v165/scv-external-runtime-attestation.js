#!/usr/bin/env node
'use strict'

// Read-only verifier for drift outside the sealed application inventory:
// Railway production/staging identity, the live ManyChat flow target/status,
// and an independently restored point-in-time copy of mutable /data state.
//
// This module does not deploy, write state, call a provider, or claim that a
// provider/operator observation is stronger than it is. Missing, stale,
// redirected, partial, or inconsistent evidence fails closed.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  SCV_SINGLE_RELEASE_SCHEMA: SINGLE_RELEASE_SCHEMA,
  SCV_SINGLE_RELEASE_PROTOCOL: SINGLE_RELEASE_PROTOCOL
} = require('./scv-single-release.js')

const ATTESTATION_SCHEMA =
  'scv-instagram-external-runtime-attestation-2026-08-29-v1'
const EXPECTATIONS_SCHEMA =
  'scv-instagram-external-runtime-expectations-2026-08-29-v1'
const PROCESS_IDENTITY_SCHEMA = 'scv-active-process-identity-2026-08-20-v1'
const RAILWAY_CAPTURE_SOURCE =
  'railway_cli_plus_instance_identity_plus_readyz_read_only'
const MANYCHAT_CAPTURE_SOURCE =
  'authenticated_manychat_workspace_operator_visual'
const STATE_SCAN_SCHEMA =
  'scv-instagram-mutable-state-read-only-scan-2026-08-30-v1'
const STATE_LIVE_CAPTURE_SOURCE =
  'railway_ssh_read_only_namespace_scan'
const STATE_RESTORED_CAPTURE_SOURCE =
  'independent_restored_namespace_scan'
const SHA256_RE = /^[a-f0-9]{64}$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_RAW_JSON_BYTES = 8 * 1024 * 1024
const MAX_STATE_FILE_BYTES = 64 * 1024 * 1024
const MAX_STATE_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
const MAX_STATE_ENTRIES = 200000

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
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

function pathToken(value) {
  return sha256(String(value || '')).slice(0, 16)
}

function canonicalUrl(value) {
  try {
    const parsed = new URL(String(value || ''))
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
        parsed.hash || parsed.search) return ''
    return parsed.toString()
  } catch { return '' }
}

function parseRawJson(raw, label) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) < 1 ||
      Buffer.byteLength(raw) > MAX_RAW_JSON_BYTES) {
    throw new Error(label + '_raw_json_size_invalid')
  }
  try { return JSON.parse(raw) } catch {
    throw new Error(label + '_raw_json_invalid')
  }
}

function deploymentList(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value && value.deployments)) return value.deployments
  return []
}

function freshnessFailures(value, nowMs, maxAgeMs, label) {
  const failures = []
  const observed = Date.parse(String(value || ''))
  if (!Number.isFinite(observed)) return [label + '_time_invalid']
  if (observed > nowMs + 5 * 60 * 1000) failures.push(label + '_from_future')
  if (nowMs - observed > maxAgeMs) failures.push(label + '_stale')
  return failures
}

function releaseManifestBytes(descriptor) {
  return Buffer.from(JSON.stringify(descriptor, null, 2) + '\n', 'utf8')
}

function minimalReleaseFailures(descriptor) {
  const failures = []
  const check = (condition, label) => { if (!condition) failures.push(label) }
  check(descriptor && descriptor.schema === SINGLE_RELEASE_SCHEMA,
    'release_schema_mismatch')
  check(typeof (descriptor && descriptor.release_id) === 'string' &&
    descriptor.release_id.length >= 8, 'release_id_invalid')
  check(SHA256_RE.test(String(
    descriptor && descriptor.content_fingerprint_sha256 || ''
  )), 'release_fingerprint_invalid')
  check(UUID_RE.test(String(
    descriptor && descriptor.railway && descriptor.railway.project_id || ''
  )), 'release_railway_project_invalid')
  for (const lane of ['production', 'staging']) {
    const target = descriptor && descriptor.railway && descriptor.railway[lane]
    check(UUID_RE.test(String(target && target.environment_id || '')),
      'release_' + lane + '_environment_invalid')
    check(UUID_RE.test(String(target && target.service_id || '')),
      'release_' + lane + '_service_invalid')
  }
  const persistence = descriptor && descriptor.persistence || {}
  check(String(persistence.root || '') === '/data', 'release_persist_root_invalid')
  check(Boolean(String(persistence.production_namespace || '')),
    'release_production_namespace_missing')
  check(Boolean(String(persistence.staging_namespace || '')),
    'release_staging_namespace_missing')
  check(persistence.production_namespace !== persistence.staging_namespace,
    'release_state_namespaces_not_isolated')
  return failures
}

function expectationsFailures(expectations) {
  const failures = []
  const check = (condition, label) => { if (!condition) failures.push(label) }
  check(expectations && expectations.schema === EXPECTATIONS_SCHEMA,
    'expectations_schema_mismatch')
  check(expectations && expectations.scope ===
    'instagram_dm_single_release_only', 'expectations_scope_invalid')
  const manychat = expectations && expectations.manychat || {}
  check(canonicalUrl(manychat.ingress_url) === String(manychat.ingress_url || ''),
    'manychat_expected_url_invalid')
  check(manychat.request_method === 'POST', 'manychat_expected_method_invalid')
  check(manychat.provider_cryptographic_proof_available === false,
    'manychat_proof_class_must_be_honest')
  const railway = expectations && expectations.railway || {}
  for (const lane of ['production', 'staging']) {
    const value = railway[lane + '_health_url']
    check(canonicalUrl(value) === String(value || ''),
      'railway_' + lane + '_health_url_invalid')
  }
  const mutableState = expectations && expectations.mutable_state || {}
  check(mutableState.persist_root === '/data',
    'state_expected_persist_root_invalid')
  check(mutableState.namespace_parent === 'scv-runtime-namespaces',
    'state_expected_namespace_parent_invalid')
  const required = mutableState.required_directories
  check(Array.isArray(required) && required.length > 0,
    'state_required_directories_missing')
  if (Array.isArray(required)) {
    check(new Set(required).size === required.length,
      'state_required_directories_duplicate')
    check(required.every((item) =>
      /^[a-z0-9][a-z0-9_-]*$/.test(String(item))),
    'state_required_directory_invalid')
  }
  const maxAge = expectations && expectations.evidence_max_age_ms
  check(Number.isSafeInteger(maxAge) && maxAge >= 60000 &&
    maxAge <= 24 * 60 * 60 * 1000, 'evidence_max_age_invalid')
  return failures
}

function verifyRailwayLane(options) {
  const lane = options.lane
  const descriptor = options.descriptor || {}
  const expectations = options.expectations || {}
  const evidence = options.evidence || {}
  const nowMs = options.nowMs
  const failures = []
  const check = (condition, label) => { if (!condition) failures.push(label) }
  const prefix = 'railway_' + lane
  check(evidence.capture_source === RAILWAY_CAPTURE_SOURCE,
    prefix + '_capture_source_invalid')
  failures.push(...freshnessFailures(
    evidence.captured_at_utc, nowMs, expectations.evidence_max_age_ms, prefix
  ))
  const target = descriptor.railway && descriptor.railway[lane] || {}
  const scope = evidence.scope || {}
  check(scope.project_id === (descriptor.railway && descriptor.railway.project_id),
    prefix + '_project_mismatch')
  check(scope.environment_id === target.environment_id,
    prefix + '_environment_mismatch')
  check(scope.service_id === target.service_id, prefix + '_service_mismatch')

  let deployments = []
  let identity = null
  let readyz = null
  try {
    const raw = String(evidence.deployment_list_raw_json || '')
    check(sha256(raw) === evidence.deployment_list_sha256,
      prefix + '_deployment_list_hash_mismatch')
    deployments = deploymentList(parseRawJson(raw, prefix + '_deployment_list'))
    check(deployments.length > 0, prefix + '_deployment_list_empty')
  } catch (error) { failures.push(String(error && error.message || error)) }
  try {
    const raw = String(evidence.instance_identity_raw_json || '')
    check(sha256(raw) === evidence.instance_identity_sha256,
      prefix + '_instance_identity_hash_mismatch')
    identity = parseRawJson(raw, prefix + '_instance_identity')
  } catch (error) { failures.push(String(error && error.message || error)) }
  try {
    const raw = String(evidence.readyz_raw_json || '')
    check(sha256(raw) === evidence.readyz_sha256,
      prefix + '_readyz_hash_mismatch')
    readyz = parseRawJson(raw, prefix + '_readyz')
  } catch (error) { failures.push(String(error && error.message || error)) }

  const transport = evidence.readyz_transport || {}
  const expectedUrl = String(
    expectations.railway && expectations.railway[lane + '_health_url'] || ''
  )
  check(transport.method === 'GET', prefix + '_readyz_method_invalid')
  check(transport.http_status === 200, prefix + '_readyz_http_status_invalid')
  check(transport.redirected === false, prefix + '_readyz_redirected')
  check(transport.requested_url === expectedUrl,
    prefix + '_readyz_requested_url_mismatch')
  check(transport.final_url === expectedUrl, prefix + '_readyz_final_url_mismatch')
  check(transport.body_sha256 === evidence.readyz_sha256,
    prefix + '_readyz_transport_hash_mismatch')
  check(transport.captured_at_utc === evidence.captured_at_utc,
    prefix + '_capture_times_not_atomic')
  failures.push(...freshnessFailures(
    transport.captured_at_utc, nowMs, expectations.evidence_max_age_ms,
    prefix + '_readyz_transport'
  ))

  const deploymentId = String(identity && identity.deployment_id || '')
  const deployment = deployments.find((item) =>
    String(item && item.id || '') === deploymentId)
  check(identity && identity.schema === PROCESS_IDENTITY_SCHEMA,
    prefix + '_instance_identity_schema_mismatch')
  check(identity && identity.release_protocol === SINGLE_RELEASE_PROTOCOL,
    prefix + '_instance_protocol_mismatch')
  check(UUID_RE.test(deploymentId), prefix + '_deployment_id_invalid')
  check(Boolean(deployment), prefix + '_deployment_not_in_provider_list')
  check(String(deployment && deployment.status || '') ===
    (expectations.railway && expectations.railway.required_deployment_status),
  prefix + '_deployment_not_success')
  check(identity && identity.release_id === descriptor.release_id,
    prefix + '_instance_release_id_mismatch')
  check(identity && identity.content_fingerprint_sha256 ===
    descriptor.content_fingerprint_sha256, prefix + '_instance_fingerprint_mismatch')
  check(identity && identity.release_manifest_sha256 ===
    options.releaseManifestSha256, prefix + '_instance_manifest_hash_mismatch')

  const readyRelease = readyz && readyz.release || {}
  check(readyz && readyz.ok === true, prefix + '_readyz_not_ok')
  check(readyz && readyz.preflight_verified === true,
    prefix + '_preflight_not_verified')
  check(readyRelease.ok === true, prefix + '_readyz_release_not_ok')
  check(readyRelease.mode === lane, prefix + '_readyz_mode_mismatch')
  check(readyRelease.release_id === descriptor.release_id,
    prefix + '_readyz_release_id_mismatch')
  check(readyRelease.content_fingerprint_sha256 ===
    descriptor.content_fingerprint_sha256, prefix + '_readyz_fingerprint_mismatch')
  check(readyRelease.release_manifest_sha256 === options.releaseManifestSha256,
    prefix + '_readyz_manifest_hash_mismatch')
  return {
    ok: failures.length === 0,
    lane,
    deployment_id: UUID_RE.test(deploymentId) ? deploymentId : '',
    release_id: String(readyRelease.release_id || ''),
    evidence_sha256: sha256(stableJson({
      deployment_list: evidence.deployment_list_sha256,
      instance_identity: evidence.instance_identity_sha256,
      readyz: evidence.readyz_sha256
    })),
    failures
  }
}

function expectedManyChatConfiguration(expectations) {
  const value = expectations && expectations.manychat || {}
  return {
    account_ref: String(value.account_ref || ''),
    flow_id: String(value.flow_id || ''),
    flow_status: String(value.flow_status || ''),
    request_method: String(value.request_method || ''),
    ingress_url: String(value.ingress_url || '')
  }
}

function verifyManyChat(options) {
  const expectations = options.expectations || {}
  const evidence = options.evidence || {}
  const failures = []
  const check = (condition, label) => { if (!condition) failures.push(label) }
  const expected = expectedManyChatConfiguration(expectations)
  check(evidence.capture_source === MANYCHAT_CAPTURE_SOURCE,
    'manychat_capture_source_invalid')
  failures.push(...freshnessFailures(
    evidence.captured_at_utc, options.nowMs, expectations.evidence_max_age_ms,
    'manychat'
  ))
  check(evidence.authenticated === true, 'manychat_capture_not_authenticated')
  check(evidence.operator_reviewed === true, 'manychat_operator_review_missing')
  check(evidence.secrets_included === false, 'manychat_capture_contains_secrets')
  check(evidence.provider_cryptographic_proof === false,
    'manychat_capture_proof_class_invalid')
  for (const [key, value] of Object.entries(expected)) {
    check(evidence.configuration && evidence.configuration[key] === value,
      'manychat_' + key + '_mismatch')
  }
  const expectedHash = sha256(stableJson(expected))
  check(evidence.configuration_sha256 === expectedHash,
    'manychat_configuration_hash_mismatch')
  check(SHA256_RE.test(String(evidence.visual_artifact_sha256 || '')),
    'manychat_visual_artifact_hash_invalid')
  return {
    ok: failures.length === 0,
    evidence_class: MANYCHAT_CAPTURE_SOURCE,
    configuration_sha256: expectedHash,
    provider_cryptographic_proof: false,
    failures
  }
}

function safeRelative(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target))
    .split(path.sep).join('/')
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative) ||
      relative.split('/').includes('..') || relative.includes('\u0000')) {
    throw new Error('state_path_escape')
  }
  return relative
}

function readStableStateFile(file) {
  const before = fs.lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink() ||
      before.size > MAX_STATE_FILE_BYTES) {
    throw new Error('state_file_unsafe')
  }
  const fd = fs.openSync(
    file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  )
  try {
    const opened = fs.fstatSync(fd)
    if (opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('state_file_changed_before_read')
    }
    const bytes = fs.readFileSync(fd)
    const after = fs.fstatSync(fd)
    if (after.dev !== opened.dev || after.ino !== opened.ino ||
        after.size !== opened.size || after.mtimeMs !== opened.mtimeMs ||
        after.ctimeMs !== opened.ctimeMs || bytes.length !== opened.size) {
      throw new Error('state_file_changed_during_read')
    }
    return { bytes, stat: after }
  } finally { fs.closeSync(fd) }
}

function scanStateTreeOnce(root, requiredDirectories) {
  const failures = []
  const entries = []
  let totalBytes = 0
  const resolvedRoot = path.resolve(String(root || ''))
  const expected = new Set(requiredDirectories || [])
  let rootStat
  try { rootStat = fs.lstatSync(resolvedRoot) } catch {
    return { ok: false, failures: ['state_root_missing'] }
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { ok: false, failures: ['state_root_unsafe'] }
  }
  if ((rootStat.mode & 0o077) !== 0) failures.push('state_root_not_owner_only')
  let rootEntries
  try { rootEntries = fs.readdirSync(resolvedRoot, { withFileTypes: true }) } catch {
    return { ok: false, failures: ['state_root_unreadable'] }
  }
  const present = new Set(rootEntries.map((entry) => entry.name))
  for (const required of expected) {
    if (!present.has(required)) {
      failures.push('state_required_directory_missing:' + required)
    }
  }
  for (const entry of rootEntries) {
    if (!expected.has(entry.name)) {
      failures.push('state_unexpected_root_entry:' + pathToken(entry.name))
    }
  }

  const walk = (directory) => {
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const target = path.join(directory, child.name)
      const relative = safeRelative(resolvedRoot, target)
      const stat = fs.lstatSync(target)
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        failures.push('state_special_entry:' + pathToken(relative))
        continue
      }
      if ((stat.mode & 0o077) !== 0) {
        failures.push('state_entry_not_owner_only:' + pathToken(relative))
      }
      if (stat.isDirectory()) {
        entries.push({
          path: relative + '/', type: 'directory', mode: stat.mode & 0o777
        })
        if (entries.length > MAX_STATE_ENTRIES) {
          throw new Error('state_entry_limit_exceeded')
        }
        walk(target)
        continue
      }
      try {
        const loaded = readStableStateFile(target)
        totalBytes += loaded.bytes.length
        if (totalBytes > MAX_STATE_TOTAL_BYTES) {
          throw new Error('state_byte_limit_exceeded')
        }
        entries.push({
          path: relative,
          type: 'file',
          mode: loaded.stat.mode & 0o777,
          bytes: loaded.bytes.length,
          sha256: sha256(loaded.bytes)
        })
      } catch (error) {
        failures.push(String(error && error.message || 'state_file_read_failed') +
          ':' + pathToken(relative))
      }
      if (entries.length > MAX_STATE_ENTRIES) {
        throw new Error('state_entry_limit_exceeded')
      }
    }
  }

  try {
    for (const required of [...expected].sort()) {
      const target = path.join(resolvedRoot, required)
      if (!fs.existsSync(target)) continue
      const stat = fs.lstatSync(target)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        failures.push('state_required_directory_unsafe:' + required)
        continue
      }
      entries.push({
        path: required + '/', type: 'directory', mode: stat.mode & 0o777
      })
      walk(target)
    }
  } catch (error) {
    failures.push(String(error && error.message || 'state_scan_failed'))
  }
  entries.sort((left, right) => left.path.localeCompare(right.path))
  return {
    ok: failures.length === 0,
    inventory_sha256: sha256(stableJson(entries)),
    entry_count: entries.length,
    file_count: entries.filter((entry) => entry.type === 'file').length,
    directory_count: entries.filter((entry) => entry.type === 'directory').length,
    total_bytes: totalBytes,
    failures
  }
}

function scanStableStateTree(root, requiredDirectories, options = {}) {
  const first = scanStateTreeOnce(root, requiredDirectories)
  if (typeof options.betweenScans === 'function') options.betweenScans()
  const second = scanStateTreeOnce(root, requiredDirectories)
  const failures = [...first.failures, ...second.failures]
  if (first.inventory_sha256 !== second.inventory_sha256 ||
      first.entry_count !== second.entry_count ||
      first.total_bytes !== second.total_bytes) {
    failures.push('state_changed_between_read_only_scans')
  }
  return {
    ok: failures.length === 0,
    stable_point_in_time_only: true,
    inventory_sha256: failures.length ? '' : first.inventory_sha256,
    entry_count: first.entry_count || 0,
    file_count: first.file_count || 0,
    directory_count: first.directory_count || 0,
    total_bytes: first.total_bytes || 0,
    failures: [...new Set(failures)]
  }
}

function stateNamespace(descriptor, lane) {
  const persistence = descriptor && descriptor.persistence || {}
  return lane === 'production'
    ? String(persistence.production_namespace || '')
    : String(persistence.staging_namespace || '')
}

function expectedStateRoot(descriptor, expectations, lane) {
  const mutable = expectations && expectations.mutable_state || {}
  return path.join(
    String(mutable.persist_root || '/data'),
    String(mutable.namespace_parent || 'scv-runtime-namespaces'),
    stateNamespace(descriptor, lane)
  )
}

function sealedExpectationsVerdict(
  descriptor,
  expectations,
  expectationsBytes
) {
  const failures = []
  let parsed
  try { parsed = JSON.parse(expectationsBytes.toString('utf8')) } catch {
    failures.push('expectations_manifest_bytes_invalid')
  }
  if (stableJson(parsed) !== stableJson(expectations)) {
    failures.push('expectations_manifest_bytes_value_mismatch')
  }
  const digest = sha256(expectationsBytes)
  const sealed = Array.isArray(descriptor && descriptor.files)
    ? descriptor.files.find((item) =>
        item && item.path === 'SCV_EXTERNAL_RUNTIME_EXPECTATIONS.json')
    : null
  if (!sealed || sealed.sha256 !== digest ||
      sealed.bytes !== expectationsBytes.length) {
    failures.push('expectations_not_bound_to_sealed_release_inventory')
  }
  return { ok: failures.length === 0, sha256: digest, failures }
}

function buildStateScanReceipt(options = {}) {
  const descriptor = options.descriptor || {}
  const expectations = options.expectations || {}
  const lane = String(options.lane || '')
  const role = String(options.role || '')
  const nowMs = options.nowMs == null ? Date.now() : options.nowMs
  const failures = [
    ...minimalReleaseFailures(descriptor),
    ...expectationsFailures(expectations)
  ]
  if (!['production', 'staging'].includes(lane)) {
    failures.push('state_scan_lane_invalid')
  }
  if (!['live', 'restored'].includes(role)) {
    failures.push('state_scan_role_invalid')
  }
  const releaseBytes = Buffer.isBuffer(options.releaseBytes)
    ? options.releaseBytes
    : releaseManifestBytes(descriptor)
  let parsedRelease
  try { parsedRelease = JSON.parse(releaseBytes.toString('utf8')) } catch {
    failures.push('release_manifest_bytes_invalid')
  }
  if (stableJson(parsedRelease) !== stableJson(descriptor)) {
    failures.push('release_manifest_bytes_descriptor_mismatch')
  }
  const manifestSha256 = sha256(releaseBytes)
  const expectationsBytes = Buffer.isBuffer(options.expectationsBytes)
    ? options.expectationsBytes
    : Buffer.from(JSON.stringify(expectations, null, 2) + '\n', 'utf8')
  const expectationsVerdict = sealedExpectationsVerdict(
    descriptor, expectations, expectationsBytes
  )
  failures.push(...expectationsVerdict.failures)
  const namespace = stateNamespace(descriptor, lane)
  const rootInput = String(options.root || '').trim()
  if (!rootInput || !path.isAbsolute(rootInput)) {
    failures.push('state_scan_root_absolute_required')
  }
  const root = path.resolve(
    rootInput || path.join(path.parse(process.cwd()).root, '__scv_missing_state_root__')
  )
  const canonicalRoot = path.resolve(
    expectedStateRoot(descriptor, expectations, lane)
  )
  let deploymentId = ''
  let instanceIdentitySha256 = ''
  if (role === 'live') {
    if (root !== canonicalRoot) failures.push('state_live_root_not_canonical')
    let identity
    const identityRaw = String(options.instanceIdentityRaw || '')
    instanceIdentitySha256 = sha256(identityRaw)
    try {
      identity = parseRawJson(
        identityRaw, 'state_live_instance_identity'
      )
    } catch (error) {
      failures.push(String(error && error.message || error))
    }
    deploymentId = String(identity && identity.deployment_id || '')
    if (!identity || identity.schema !== PROCESS_IDENTITY_SCHEMA) {
      failures.push('state_live_instance_identity_schema_mismatch')
    }
    if (!identity || identity.release_protocol !== SINGLE_RELEASE_PROTOCOL) {
      failures.push('state_live_instance_protocol_mismatch')
    }
    if (!UUID_RE.test(deploymentId)) {
      failures.push('state_live_deployment_id_invalid')
    }
    if (!identity || identity.release_id !== descriptor.release_id) {
      failures.push('state_live_release_id_mismatch')
    }
    if (!identity || identity.content_fingerprint_sha256 !==
        descriptor.content_fingerprint_sha256) {
      failures.push('state_live_fingerprint_mismatch')
    }
    if (!identity || identity.release_manifest_sha256 !== manifestSha256) {
      failures.push('state_live_manifest_hash_mismatch')
    }
  } else {
    if (!SHA256_RE.test(String(options.archiveSha256 || ''))) {
      failures.push('state_restored_archive_hash_invalid')
    }
    if (!SHA256_RE.test(String(options.providerReceiptSha256 || ''))) {
      failures.push('state_restored_provider_receipt_hash_invalid')
    }
  }
  const scan = scanStableStateTree(
    root,
    expectations && expectations.mutable_state &&
      expectations.mutable_state.required_directories || [],
    options.scanOptions || {}
  )
  failures.push(...scan.failures.map((item) =>
    'state_scan:' + item))
  const uniqueFailures = [...new Set(failures)]
  return {
    ok: uniqueFailures.length === 0,
    schema: STATE_SCAN_SCHEMA,
    capture_source: role === 'live'
      ? STATE_LIVE_CAPTURE_SOURCE
      : STATE_RESTORED_CAPTURE_SOURCE,
    captured_at_utc: new Date(nowMs).toISOString(),
    lane,
    role,
    release_id: String(descriptor.release_id || ''),
    content_fingerprint_sha256:
      String(descriptor.content_fingerprint_sha256 || ''),
    release_manifest_sha256: manifestSha256,
    expectations_sha256: expectationsVerdict.sha256,
    railway_deployment_id: role === 'live' ? deploymentId : '',
    instance_identity_sha256: role === 'live'
      ? instanceIdentitySha256
      : '',
    namespace,
    root_class: role === 'live'
      ? 'canonical_railway_namespace'
      : 'independent_restored_namespace',
    archive_sha256: role === 'restored'
      ? String(options.archiveSha256 || '')
      : '',
    provider_receipt_sha256: role === 'restored'
      ? String(options.providerReceiptSha256 || '')
      : '',
    stable_point_in_time_only: true,
    future_writes_covered: false,
    secrets_included: false,
    scan: {
      ok: scan.ok === true,
      inventory_sha256: String(scan.inventory_sha256 || ''),
      entry_count: Number(scan.entry_count || 0),
      file_count: Number(scan.file_count || 0),
      directory_count: Number(scan.directory_count || 0),
      total_bytes: Number(scan.total_bytes || 0)
    },
    failures: uniqueFailures
  }
}

function verifyStateScanReceiptPair(options = {}) {
  const lane = String(options.lane || '')
  const descriptor = options.descriptor || {}
  const expectations = options.expectations || {}
  const pair = options.evidence || {}
  const nowMs = options.nowMs == null ? Date.now() : options.nowMs
  const failures = []
  const check = (condition, label) => { if (!condition) failures.push(label) }
  let live
  let restored
  for (const [role, target] of [
    ['live', pair.live_receipt_raw_json],
    ['restored', pair.restored_receipt_raw_json]
  ]) {
    try {
      const raw = String(target || '')
      check(
        sha256(raw) === pair[role + '_receipt_sha256'],
        'state_' + lane + '_' + role + '_receipt_hash_mismatch'
      )
      const parsed = parseRawJson(
        raw, 'state_' + lane + '_' + role + '_receipt'
      )
      if (role === 'live') live = parsed
      else restored = parsed
    } catch (error) {
      failures.push(String(error && error.message || error))
    }
  }
  const namespace = stateNamespace(descriptor, lane)
  const manifestSha256 = String(options.releaseManifestSha256 || '')
  const expectationsSha256 = String(options.expectationsSha256 || '')
  for (const [role, receipt, source] of [
    ['live', live, STATE_LIVE_CAPTURE_SOURCE],
    ['restored', restored, STATE_RESTORED_CAPTURE_SOURCE]
  ]) {
    check(receipt && receipt.schema === STATE_SCAN_SCHEMA,
      'state_' + lane + '_' + role + '_schema_mismatch')
    check(receipt && receipt.capture_source === source,
      'state_' + lane + '_' + role + '_capture_source_mismatch')
    check(receipt && receipt.ok === true,
      'state_' + lane + '_' + role + '_not_ok')
    check(receipt && Array.isArray(receipt.failures) &&
      receipt.failures.length === 0,
    'state_' + lane + '_' + role + '_failures_not_empty')
    check(receipt && receipt.lane === lane,
      'state_' + lane + '_' + role + '_lane_mismatch')
    check(receipt && receipt.role === role,
      'state_' + lane + '_' + role + '_role_mismatch')
    check(receipt && receipt.release_id === descriptor.release_id,
      'state_' + lane + '_' + role + '_release_id_mismatch')
    check(receipt && receipt.content_fingerprint_sha256 ===
      descriptor.content_fingerprint_sha256,
    'state_' + lane + '_' + role + '_fingerprint_mismatch')
    check(receipt && receipt.release_manifest_sha256 === manifestSha256,
      'state_' + lane + '_' + role + '_manifest_hash_mismatch')
    check(receipt && receipt.expectations_sha256 === expectationsSha256,
      'state_' + lane + '_' + role + '_expectations_hash_mismatch')
    check(receipt && receipt.namespace === namespace,
      'state_' + lane + '_' + role + '_namespace_mismatch')
    check(receipt && receipt.stable_point_in_time_only === true &&
      receipt.future_writes_covered === false,
    'state_' + lane + '_' + role + '_temporal_scope_invalid')
    check(receipt && receipt.secrets_included === false,
      'state_' + lane + '_' + role + '_may_contain_secrets')
    check(receipt && receipt.scan && receipt.scan.ok === true &&
      SHA256_RE.test(String(receipt.scan.inventory_sha256 || '')),
    'state_' + lane + '_' + role + '_scan_invalid')
    for (const key of [
      'entry_count', 'file_count', 'directory_count', 'total_bytes'
    ]) {
      check(receipt && receipt.scan &&
        Number.isSafeInteger(receipt.scan[key]) && receipt.scan[key] >= 0,
      'state_' + lane + '_' + role + '_scan_' + key + '_invalid')
    }
    failures.push(...freshnessFailures(
      receipt && receipt.captured_at_utc,
      nowMs,
      expectations.evidence_max_age_ms,
      'state_' + lane + '_' + role
    ))
  }
  check(live && live.root_class === 'canonical_railway_namespace',
    'state_' + lane + '_live_root_class_invalid')
  check(restored && restored.root_class === 'independent_restored_namespace',
    'state_' + lane + '_restored_root_class_invalid')
  check(live && live.railway_deployment_id ===
    String(options.railwayDeploymentId || ''),
  'state_' + lane + '_deployment_id_mismatch')
  check(live && SHA256_RE.test(String(live.instance_identity_sha256 || '')),
    'state_' + lane + '_live_instance_identity_hash_invalid')
  check(live && live.instance_identity_sha256 ===
    String(options.railwayInstanceIdentitySha256 || ''),
  'state_' + lane + '_instance_identity_hash_mismatch')
  check(live && live.archive_sha256 === '' &&
    live.provider_receipt_sha256 === '',
  'state_' + lane + '_live_restore_fields_not_empty')
  check(restored && restored.railway_deployment_id === '' &&
    restored.instance_identity_sha256 === '',
  'state_' + lane + '_restored_live_fields_not_empty')
  check(restored && SHA256_RE.test(String(restored.archive_sha256 || '')),
    'state_' + lane + '_restored_archive_hash_invalid')
  check(restored &&
    SHA256_RE.test(String(restored.provider_receipt_sha256 || '')),
  'state_' + lane + '_provider_receipt_hash_invalid')
  for (const key of [
    'inventory_sha256', 'entry_count', 'file_count',
    'directory_count', 'total_bytes'
  ]) {
    check(live && restored && live.scan && restored.scan &&
      live.scan[key] === restored.scan[key],
    'state_' + lane + '_restored_' + key + '_mismatch')
  }
  const uniqueFailures = [...new Set(failures)]
  return {
    ok: uniqueFailures.length === 0,
    lane,
    namespace,
    inventory_sha256: uniqueFailures.length
      ? ''
      : String(live && live.scan && live.scan.inventory_sha256 || ''),
    entry_count: Number(live && live.scan && live.scan.entry_count || 0),
    total_bytes: Number(live && live.scan && live.scan.total_bytes || 0),
    stable_point_in_time_only: true,
    future_writes_covered: false,
    archive_sha256:
      String(restored && restored.archive_sha256 || ''),
    provider_receipt_sha256:
      String(restored && restored.provider_receipt_sha256 || ''),
    evidence_sha256: sha256(stableJson({
      live_receipt_sha256: String(pair.live_receipt_sha256 || ''),
      restored_receipt_sha256: String(pair.restored_receipt_sha256 || '')
    })),
    failures: uniqueFailures
  }
}

function verifyMutableStateLane(options) {
  const lane = options.lane
  const descriptor = options.descriptor || {}
  const expectations = options.expectations || {}
  const failures = []
  const required = expectations.mutable_state &&
    expectations.mutable_state.required_directories || []
  const persistence = descriptor.persistence || {}
  const namespace = lane === 'production'
    ? persistence.production_namespace
    : persistence.staging_namespace
  const expectedRoot = path.join(
    expectations.mutable_state && expectations.mutable_state.persist_root || '/data',
    expectations.mutable_state && expectations.mutable_state.namespace_parent ||
      'scv-runtime-namespaces',
    String(namespace || '')
  )
  const liveProvided = Boolean(String(options.liveRoot || '').trim())
  const restoredProvided = Boolean(String(options.restoredRoot || '').trim())
  if (!liveProvided) failures.push('state_' + lane + '_live_root_missing')
  if (!restoredProvided) failures.push('state_' + lane + '_restored_root_missing')
  if (!liveProvided || !restoredProvided) {
    return {
      ok: false,
      lane,
      namespace: String(namespace || ''),
      inventory_sha256: '',
      entry_count: 0,
      total_bytes: 0,
      stable_point_in_time_only: true,
      future_writes_covered: false,
      failures
    }
  }
  const live = path.resolve(String(options.liveRoot))
  const restored = path.resolve(String(options.restoredRoot))
  if (options.enforceCanonicalPath !== false &&
      live !== path.resolve(expectedRoot)) {
    failures.push('state_' + lane + '_live_root_mismatch')
  }
  const relation = path.relative(live, restored)
  if (live === restored ||
      (!relation.startsWith('..') && !path.isAbsolute(relation))) {
    failures.push('state_' + lane + '_backup_not_independent_path')
  }
  const scanOptions = options.scanOptions || {}
  const liveReceipt = scanStableStateTree(live, required, scanOptions.live)
  const restoredReceipt = scanStableStateTree(
    restored, required, scanOptions.restored
  )
  failures.push(...liveReceipt.failures.map((item) =>
    'state_' + lane + '_live:' + item))
  failures.push(...restoredReceipt.failures.map((item) =>
    'state_' + lane + '_restored:' + item))
  if (liveReceipt.inventory_sha256 !== restoredReceipt.inventory_sha256 ||
      liveReceipt.entry_count !== restoredReceipt.entry_count ||
      liveReceipt.total_bytes !== restoredReceipt.total_bytes) {
    failures.push('state_' + lane + '_restored_inventory_mismatch')
  }
  return {
    ok: failures.length === 0,
    lane,
    namespace: String(namespace || ''),
    inventory_sha256: failures.length ? '' : liveReceipt.inventory_sha256,
    entry_count: liveReceipt.entry_count,
    total_bytes: liveReceipt.total_bytes,
    stable_point_in_time_only: true,
    future_writes_covered: false,
    failures
  }
}

function verifyExternalRuntimeAttestation(options = {}) {
  const descriptor = options.descriptor || {}
  const expectations = options.expectations || {}
  const evidence = options.evidence || {}
  const nowMs = options.nowMs == null ? Date.now() : options.nowMs
  const failures = [
    ...minimalReleaseFailures(descriptor),
    ...expectationsFailures(expectations)
  ]
  const manifestBytes = Buffer.isBuffer(options.releaseBytes)
    ? options.releaseBytes
    : releaseManifestBytes(descriptor)
  let parsedRelease
  try { parsedRelease = JSON.parse(manifestBytes.toString('utf8')) } catch {
    failures.push('release_manifest_bytes_invalid')
  }
  if (stableJson(parsedRelease) !== stableJson(descriptor)) {
    failures.push('release_manifest_bytes_descriptor_mismatch')
  }
  const manifestSha256 = sha256(manifestBytes)
  const expectationsBytes = Buffer.isBuffer(options.expectationsBytes)
    ? options.expectationsBytes
    : Buffer.from(JSON.stringify(expectations, null, 2) + '\n', 'utf8')
  let parsedExpectations
  try {
    parsedExpectations = JSON.parse(expectationsBytes.toString('utf8'))
  } catch {
    failures.push('expectations_manifest_bytes_invalid')
  }
  if (stableJson(parsedExpectations) !== stableJson(expectations)) {
    failures.push('expectations_manifest_bytes_value_mismatch')
  }
  const expectationsSha256 = sha256(expectationsBytes)
  const sealedExpectations = Array.isArray(descriptor.files)
    ? descriptor.files.find((item) =>
        item && item.path === 'SCV_EXTERNAL_RUNTIME_EXPECTATIONS.json')
    : null
  if (!sealedExpectations ||
      sealedExpectations.sha256 !== expectationsSha256 ||
      sealedExpectations.bytes !== expectationsBytes.length) {
    failures.push('expectations_not_bound_to_sealed_release_inventory')
  }
  if (evidence.schema !== ATTESTATION_SCHEMA) {
    failures.push('attestation_schema_mismatch')
  }
  failures.push(...freshnessFailures(
    evidence.captured_at_utc, nowMs, expectations.evidence_max_age_ms || 0,
    'attestation'
  ))
  if (evidence.release_id !== descriptor.release_id) {
    failures.push('attestation_release_id_mismatch')
  }
  if (evidence.content_fingerprint_sha256 !==
      descriptor.content_fingerprint_sha256) {
    failures.push('attestation_fingerprint_mismatch')
  }
  if (evidence.release_manifest_sha256 !== manifestSha256) {
    failures.push('attestation_manifest_hash_mismatch')
  }
  if (evidence.expectations_sha256 !== expectationsSha256) {
    failures.push('attestation_expectations_hash_mismatch')
  }
  if (evidence.secrets_included !== false) {
    failures.push('attestation_may_contain_secrets')
  }

  const production = verifyRailwayLane({
    lane: 'production',
    descriptor,
    expectations,
    evidence: evidence.railway && evidence.railway.production,
    releaseManifestSha256: manifestSha256,
    nowMs
  })
  const staging = verifyRailwayLane({
    lane: 'staging',
    descriptor,
    expectations,
    evidence: evidence.railway && evidence.railway.staging,
    releaseManifestSha256: manifestSha256,
    nowMs
  })
  const manychat = verifyManyChat({
    expectations, evidence: evidence.manychat, nowMs
  })
  const mutableState = evidence.mutable_state || {}
  const productionState = verifyStateScanReceiptPair({
    lane: 'production',
    descriptor,
    expectations,
    evidence: mutableState.production,
    railwayDeploymentId: production.deployment_id,
    railwayInstanceIdentitySha256: evidence.railway &&
      evidence.railway.production &&
      evidence.railway.production.instance_identity_sha256,
    releaseManifestSha256: manifestSha256,
    expectationsSha256,
    nowMs
  })
  const stagingState = verifyStateScanReceiptPair({
    lane: 'staging',
    descriptor,
    expectations,
    evidence: mutableState.staging,
    railwayDeploymentId: staging.deployment_id,
    railwayInstanceIdentitySha256: evidence.railway &&
      evidence.railway.staging &&
      evidence.railway.staging.instance_identity_sha256,
    releaseManifestSha256: manifestSha256,
    expectationsSha256,
    nowMs
  })
  for (const receipt of [
    production, staging, manychat, productionState, stagingState
  ]) failures.push(...receipt.failures)

  const uniqueFailures = [...new Set(failures)]
  return {
    ok: uniqueFailures.length === 0,
    schema: ATTESTATION_SCHEMA,
    release_id: String(descriptor.release_id || ''),
    release_manifest_sha256: manifestSha256,
    expectations_sha256: expectationsSha256,
    operational_release_identity_converged: uniqueFailures.length === 0,
    gate_action: uniqueFailures.length === 0
      ? 'allow_external_convergence_claim'
      : 'block_promotion_and_external_convergence_claim',
    runtime_mutation_authorized: false,
    absolute_future_drift_impossible: false,
    railway: { production, staging },
    manychat,
    mutable_state: { production: productionState, staging: stagingState },
    limitations: [
      'railway_cli_and_instance_capture_is_authenticated_observation_not_provider_signed_attestation',
      'manychat_flow_configuration_is_operator_visual_evidence_not_provider_signed_proof',
      'mutable_state_equivalence_is_a_point_in_time_read_only_observation_not_a_future_write_lock',
      'mutable_state_scan_receipts_are_operator_generated_hash_bound_observations_not_provider_signed_attestations',
      'restored_root_provenance_from_the_named_archive_is_a_procedural_capture_boundary_not_cryptographically_proven_by_this_verifier',
      'backup_storage_retention_and_future_retrievability_require_a_separate_provider_policy',
      'authorized_provider_or_account_administrators_can_change_or_delete_external_state',
      'future_manychat_railway_and_model_provider_behavior_is_outside_the_artifact_hash_boundary'
    ],
    failures: uniqueFailures
  }
}

function argsFrom(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) throw new Error('unexpected_argument:' + key)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error('missing_argument:' + key)
    }
    result[key.slice(2)] = value
    index += 1
  }
  return result
}

function readJsonFile(file) {
  const bytes = fs.readFileSync(path.resolve(String(file || '')))
  return { bytes, value: JSON.parse(bytes.toString('utf8')) }
}

if (require.main === module) {
  try {
    const args = argsFrom(process.argv.slice(2))
    const release = readJsonFile(args.release)
    const expectations = readJsonFile(args.expectations)
    if (args['state-scan-role']) {
      const role = args['state-scan-role']
      const identityRaw = args['instance-identity']
        ? fs.readFileSync(path.resolve(args['instance-identity']), 'utf8')
        : ''
      const receipt = buildStateScanReceipt({
        descriptor: release.value,
        releaseBytes: release.bytes,
        expectations: expectations.value,
        expectationsBytes: expectations.bytes,
        role,
        lane: args['state-lane'],
        root: args['state-root'],
        instanceIdentityRaw: identityRaw,
        archiveSha256: args['archive-sha256'],
        providerReceiptSha256: args['provider-receipt-sha256']
      })
      process.stdout.write(JSON.stringify(receipt, null, 2) + '\n')
      if (!receipt.ok) process.exitCode = 1
      return
    }
    const evidence = readJsonFile(args.evidence)
    const receipt = verifyExternalRuntimeAttestation({
      descriptor: release.value,
      releaseBytes: release.bytes,
      expectations: expectations.value,
      expectationsBytes: expectations.bytes,
      evidence: evidence.value
    })
    process.stdout.write(JSON.stringify(receipt, null, 2) + '\n')
    if (!receipt.ok) process.exitCode = 1
  } catch (error) {
    process.stderr.write(JSON.stringify({
      ok: false,
      error: String(error && error.message || error).slice(0, 1000)
    }) + '\n')
    process.exitCode = 1
  }
}

module.exports = {
  ATTESTATION_SCHEMA,
  EXPECTATIONS_SCHEMA,
  PROCESS_IDENTITY_SCHEMA,
  SINGLE_RELEASE_SCHEMA,
  SINGLE_RELEASE_PROTOCOL,
  RAILWAY_CAPTURE_SOURCE,
  MANYCHAT_CAPTURE_SOURCE,
  STATE_SCAN_SCHEMA,
  STATE_LIVE_CAPTURE_SOURCE,
  STATE_RESTORED_CAPTURE_SOURCE,
  sha256,
  stableObject,
  stableJson,
  parseRawJson,
  deploymentList,
  releaseManifestBytes,
  minimalReleaseFailures,
  expectationsFailures,
  verifyRailwayLane,
  expectedManyChatConfiguration,
  verifyManyChat,
  scanStateTreeOnce,
  scanStableStateTree,
  stateNamespace,
  expectedStateRoot,
  sealedExpectationsVerdict,
  buildStateScanReceipt,
  verifyStateScanReceiptPair,
  verifyMutableStateLane,
  verifyExternalRuntimeAttestation,
  argsFrom
}
