#!/usr/bin/env node
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { spawnSync } = require('child_process')

const producer = require('./scv-prepare-recovery-evidence.js')
const {
  COMPILED_RECOVERY_RECEIPT_SCHEMA
} = require('./scv-compiled-recovery-source-contract.js')
const {
  OMAR_SYSTEM_PURGE_RECEIPT_SCHEMA
} = require('./scv-test-account-purge.js')
const {
  DEBUG_CONTACT_IDS,
  DEBUG_USERNAMES
} = require('./scv-debug-identity.js')

const RELEASE_ID = 'scv-instagram-golden-production-preparation-harness'
const DEPLOYMENT_ID = '77777777-7777-4777-8777-777777777777'
const FINGERPRINT = 'a'.repeat(64)
const MANIFEST_SHA = 'b'.repeat(64)

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function compiledPackage(value, label = 'fixture') {
  return {
    ...value,
    file_count: value.thread_state_file_count + value.thread_history_file_count,
    queue_file_count: 0,
    omar_debug_file_count: 0,
    synthetic_nonnumeric_file_count: 0,
    compiled_receipt_schema: COMPILED_RECOVERY_RECEIPT_SCHEMA,
    compiled_receipt_file_sha256: digest(Buffer.from(`compiled-file:${label}`)),
    compiled_receipt_self_sha256: digest(Buffer.from(`compiled-self:${label}`))
  }
}

function compiledReceiptForPackage(item) {
  return {
    schema: item.compiled_receipt_schema,
    file_sha256: item.compiled_receipt_file_sha256,
    self_sha256: item.compiled_receipt_self_sha256,
    archive_sha256: item.sha256,
    file_count: item.file_count,
    thread_state_file_count: item.thread_state_file_count,
    thread_history_file_count: item.thread_history_file_count,
    queue_file_count: 0,
    omar_debug_file_count: 0,
    synthetic_nonnumeric_file_count: 0,
    queues_excluded: true,
    omar_debug_excluded: true,
    numeric_real_threads_only: true,
    raw_archives_unchanged: true
  }
}

function tarOctalField(bytes) {
  const raw = bytes.toString('ascii').replace(/\0.*$/, '').trim()
  if (!/^[0-7]+$/.test(raw)) return raw === '' ? 0 : NaN
  return Number.parseInt(raw, 8)
}

// The deployed staging regression copies only immutable runtime artifacts into
// its throwaway tree. Keep the archive check self-contained there, while the
// normal repository run below also cross-checks the independent ops verifier.
function inspectPrivateMemoryBackupForHarness(file) {
  const bytes = fs.readFileSync(file)
  assert.ok(bytes.length >= 32)
  assert.strictEqual(bytes[0], 0x1f)
  assert.strictEqual(bytes[1], 0x8b)
  const tar = zlib.gunzipSync(bytes)
  let offset = 0
  let regularFiles = 0
  let sawEnd = false
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) {
      sawEnd = true
      break
    }
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const fullName = prefix ? `${prefix}/${name}` : name
    const normalized = path.posix.normalize(fullName)
    assert.ok(fullName && normalized === fullName.replace(/^\.\//, ''))
    assert.ok(!normalized.startsWith('/') && !normalized.split('/').includes('..'))
    const size = tarOctalField(header.subarray(124, 136))
    assert.ok(Number.isSafeInteger(size) && size >= 0)
    const type = String.fromCharCode(header[156] || 0)
    assert.ok(['\u0000', '0', '5'].includes(type))
    const segments = normalized.toLowerCase().split('/')
    assert.ok(!segments.some((segment) => [
      'inbox', 'outbox', 'reactbox', 'reactionbox', 'processed', 'dead-letter'
    ].includes(segment)))
    if (type === '\u0000' || type === '0') {
      assert.ok(segments.includes('thread-state') || segments.includes('thread-history'))
      regularFiles += 1
    }
    offset += 512 + Math.ceil(size / 512) * 512
    assert.ok(offset <= tar.length)
  }
  assert.ok(sawEnd && regularFiles > 0)
  return {
    sha256: digest(bytes),
    size_bytes: bytes.length,
    format: 'tar.gz',
    file_count: regularFiles
  }
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  return directory
}

function writePrivate(file, value, raw = false) {
  privateDirectory(path.dirname(file))
  const bytes = raw
    ? Buffer.from(value)
    : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'w' })
  fs.chmodSync(file, 0o600)
  return bytes
}

function memoryFile(root, directory, id, value) {
  writePrivate(path.join(root, directory, `${id}.json`), value)
}

function state(id, at, username = `lead_${id}`) {
  return {
    contact_id: String(id),
    thread_id: String(id),
    instagram_username: username,
    source_interaction_at: at,
    stage: 'design'
  }
}

function history(id, events, username = `lead_${id}`) {
  return {
    contact_id: String(id),
    thread_id: String(id),
    instagram_username: username,
    events
  }
}

function archiveFromRoot(root, output) {
  const snapshot = producer.captureMemorySnapshot(root, {
    label: 'harness_source',
    memoryOnlyRoot: true
  })
  const bytes = producer.buildMemoryTarGz(snapshot.files)
  writePrivate(output, bytes, true)
  return compiledPackage({
    remote_path: output,
    sha256: digest(bytes),
    thread_state_file_count: snapshot.counts['thread-state'],
    thread_history_file_count: snapshot.counts['thread-history']
  }, path.basename(output))
}

function writeOctal(header, offset, length, value) {
  const encoded = Number(value).toString(8).padStart(length - 1, '0')
  header.write(encoded, offset, length - 1, 'ascii')
  header[offset + length - 1] = 0
}

function unsafeTarHeader(name, size, type = '0', link = '') {
  const header = Buffer.alloc(512)
  header.write(name, 0, Math.min(100, Buffer.byteLength(name)), 'utf8')
  writeOctal(header, 100, 8, type === '5' ? 0o700 : 0o600)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = type.charCodeAt(0)
  if (link) header.write(link, 157, Math.min(100, Buffer.byteLength(link)), 'utf8')
  header.write('ustar\0', 257, 6, 'binary')
  header.write('00', 263, 2, 'ascii')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'binary')
  return header
}

function rawArchive(entries) {
  const chunks = []
  for (const entry of entries) {
    const bytes = Buffer.from(entry.bytes || '')
    chunks.push(unsafeTarHeader(entry.name, bytes.length, entry.type || '0', entry.link || ''))
    if ((entry.type || '0') === '0') {
      chunks.push(bytes)
      const padding = (512 - (bytes.length % 512)) % 512
      if (padding) chunks.push(Buffer.alloc(padding))
    }
  }
  chunks.push(Buffer.alloc(1024))
  return zlib.gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 })
}

function makeFixture(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `scv-prep-${label}-`))
  fs.chmodSync(root, 0o700)
  const target = privateDirectory(path.join(root, 'target'))
  for (const directory of ['thread-state', 'thread-history', 'inbox', 'outbox', 'reactbox']) {
    privateDirectory(path.join(target, directory))
  }
  memoryFile(target, 'thread-state', '100', state('100', '2026-04-10T10:00:00.000Z'))
  memoryFile(target, 'thread-history', '100', history('100', [
    { event_id: 'target-100-1', at: '2026-04-10T10:00:00.000Z', role: 'user', text: 'old' }
  ]))
  writePrivate(path.join(target, 'inbox', 'pending.json'), { queue: 'inbox', marker: 'unchanged' })
  writePrivate(path.join(target, 'outbox', 'pending.json'), { queue: 'outbox', marker: 'unchanged' })
  writePrivate(path.join(target, 'reactbox', 'pending.json'), { queue: 'reactbox', marker: 'unchanged' })

  const sourcePackageRoot = privateDirectory(path.join(target, 'recovery-sources'))
  const sourceA = privateDirectory(path.join(root, 'compiled-source'))
  for (const sourceRoot of [sourceA]) {
    privateDirectory(path.join(sourceRoot, 'thread-state'))
    privateDirectory(path.join(sourceRoot, 'thread-history'))
  }
  memoryFile(sourceA, 'thread-state', '100', state('100', '2026-04-18T10:00:00.000Z'))
  memoryFile(sourceA, 'thread-history', '100', history('100', [
    { event_id: 'source-100-2', at: '2026-04-18T10:00:00.000Z', role: 'user', text: 'new' }
  ]))
  memoryFile(sourceA, 'thread-state', '200', state('200', '2026-04-19T10:00:00.000Z'))
  memoryFile(sourceA, 'thread-history', '200', history('200', [
    { event_id: 'source-200-1', at: '2026-04-19T10:00:00.000Z', role: 'user', text: 'other' }
  ]))

  const packages = [
    archiveFromRoot(sourceA, path.join(sourcePackageRoot, 'compiled-memory.tar.gz'))
  ]
  const manifest = {
    release_id: RELEASE_ID,
    content_fingerprint_sha256: FINGERPRINT,
    release_manifest_sha256: MANIFEST_SHA,
    deployment: {
      release_phase: 'recovery_bootstrap',
      recovery_transition: { role: 'bootstrap' }
    }
  }
  const manifestFile = path.join(root, 'manifest.json')
  writePrivate(manifestFile, manifest)
  const pauseFile = path.join(root, 'pause.json')
  writePrivate(pauseFile, {
    schema: 'scv-production-pause-readiness-authenticated-snapshot-2026-08-20-v1',
    ok: true,
    candidate_release_id: RELEASE_ID,
    candidate_content_fingerprint_sha256: FINGERPRINT,
    candidate_release_manifest_sha256: MANIFEST_SHA,
    railway: { deployment_id: DEPLOYMENT_ID },
    pause_all: true,
    automation_paused: true,
    production_mutated: false,
    secrets_included: false
  })
  const purgeFile = path.join(
    privateDirectory(path.join(target, 'release-transitions')),
    `${RELEASE_ID}.omar-system-purge.json`
  )
  writePrivate(purgeFile, {
    schema: OMAR_SYSTEM_PURGE_RECEIPT_SCHEMA,
    ok: true,
    bootstrap_release_id: RELEASE_ID,
    bootstrap_content_fingerprint_sha256: FINGERPRINT,
    bootstrap_release_manifest_sha256: MANIFEST_SHA,
    bootstrap_deployment_id: DEPLOYMENT_ID,
    pause_all_verified: true,
    release_phase: 'recovery_bootstrap',
    post_audit_remaining_count: 0,
    non_debug_identity_scope_allowed: false,
    raw_message_content_included: false,
    secrets_included: false
  })
  const options = {
    manifest: manifestFile,
    pauseEvidence: pauseFile,
    omarSystemPurgeReceipt: purgeFile,
    releaseId: RELEASE_ID,
    bootstrapDeploymentId: DEPLOYMENT_ID,
    sourcePackages: packages,
    target
  }
  const env = {
    SCV_PAUSE_ALL: '1',
    SCV_RELEASE_PHASE: 'recovery_bootstrap',
    SCV_RUNTIME_NAMESPACE: 'prod',
    SCV_GOLDEN_RELEASE_ID: RELEASE_ID,
    RAILWAY_DEPLOYMENT_ID: DEPLOYMENT_ID
  }
  return {
    root,
    target,
    sourcePackageRoot,
    packages,
    manifest,
    manifestFile,
    pauseFile,
    purgeFile,
    options,
    env,
    dependencies: {
      env,
      expectedTargetRoot: target,
      expectedSourceRoot: sourcePackageRoot,
      expectedManifestPath: manifestFile,
      recoveryEnv: { SCV_PAUSE_ALL: '1' },
      now: new Date('2026-08-20T20:00:00.000Z')
    }
  }
}

function rewriteJson(file, mutate) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  mutate(value)
  writePrivate(file, value)
}

function replacePackage(fixture, index, bytes, fileCount = 2, basename = '') {
  const file = path.join(
    fixture.sourcePackageRoot,
    basename || `replacement-${index}-${crypto.randomBytes(4).toString('hex')}.tar.gz`
  )
  writePrivate(file, bytes, true)
  const stateCount = Math.max(1, Math.floor(fileCount / 2))
  const historyCount = Math.max(1, fileCount - stateCount)
  fixture.options.sourcePackages[index] = compiledPackage({
    remote_path: file,
    sha256: digest(bytes),
    thread_state_file_count: stateCount,
    thread_history_file_count: historyCount
  }, path.basename(file))
  return file
}

function expectFailure(label, mutate, pattern = /./) {
  const fixture = makeFixture(label)
  try {
    mutate(fixture)
    let refusal = null
    try {
      producer.prepareRecoveryEvidence(fixture.options, fixture.dependencies)
    } catch (error) { refusal = error }
    assert.ok(refusal, `${label}: producer unexpectedly accepted unsafe evidence`)
    const refusalMessage = String(refusal.message || refusal)
    assert.ok(pattern.test(refusalMessage), `${label}: wrong refusal: ${refusalMessage}`)
    const output = producer.defaultOutputDirectory(targetOf(fixture), RELEASE_ID, DEPLOYMENT_ID)
    assert.strictEqual(fs.existsSync(output), false, `${label}: final output escaped refusal`)
    return 1
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
  }
}

function targetOf(fixture) {
  return fixture.target
}

function runHarness() {
  let checked = 0
  const roots = []
  try {
    const success = makeFixture('success')
    roots.push(success.root)
    const memoryBefore = producer.captureMemorySnapshot(success.target, { label: 'before' })
    const queuesBefore = producer.captureQueueSurface(success.target)
    const queueBytesBefore = fs.readFileSync(path.join(success.target, 'outbox', 'pending.json'))
    const summary = producer.prepareRecoveryEvidence(success.options, success.dependencies)
    assert.strictEqual(summary.ok, true)
    assert.strictEqual(summary.source_package_count, 1)
    assert.strictEqual(summary.queue_directories_touched, 0)
    assert.strictEqual(summary.target_memory_mutated, false)
    assert.strictEqual(summary.message_content_in_summary, false)
    assert.strictEqual(summary.backup_archive_contains_private_memory, true)
    assert.strictEqual(summary.canonical_debug_remaining_count, 0)
    assert.match(summary.canonical_debug_audit_inventory_sha256, /^[a-f0-9]{64}$/)
    const memoryAfter = producer.captureMemorySnapshot(success.target, { label: 'after' })
    const queuesAfter = producer.captureQueueSurface(success.target)
    assert.strictEqual(memoryAfter.inventory_sha256, memoryBefore.inventory_sha256)
    assert.strictEqual(queuesAfter.inventory_sha256, queuesBefore.inventory_sha256)
    assert.deepStrictEqual(
      fs.readFileSync(path.join(success.target, 'outbox', 'pending.json')),
      queueBytesBefore
    )
    const backup = JSON.parse(fs.readFileSync(summary.backup_receipt_path, 'utf8'))
    const dry = JSON.parse(fs.readFileSync(summary.dry_run_receipt_path, 'utf8'))
    assert.strictEqual(backup.omar_system_purge_receipt_sha256, digest(
      fs.readFileSync(success.purgeFile)
    ))
    assert.strictEqual(backup.omar_system_purge_post_audit_remaining_count, 0)
    assert.strictEqual(backup.queue_directories_included, false)
    assert.strictEqual(backup.canonical_debug_remaining_count, 0)
    assert.strictEqual(
      backup.canonical_debug_audit_inventory_sha256,
      summary.canonical_debug_audit_inventory_sha256
    )
    assert.strictEqual(dry.mode, 'dry_run')
    assert.strictEqual(dry.counts.sources, 1)
    assert.strictEqual(dry.counts.writes_committed, 0)
    assert.strictEqual(dry.counts.queue_directories_touched, 0)
    assert.strictEqual(dry.counts.excluded_synthetic_files, 0)
    assert.strictEqual(dry.counts.excluded_debug_files, 0)
    assert.strictEqual(dry.counts.source_state_files,
      success.packages[0].thread_state_file_count)
    assert.strictEqual(dry.counts.source_history_files,
      success.packages[0].thread_history_file_count)
    assert.ok(dry.counts.state_writes_planned + dry.counts.history_writes_planned > 0)
    const inspected = inspectPrivateMemoryBackupForHarness(summary.backup_archive_path)
    assert.strictEqual(inspected.sha256, backup.archive_sha256)
    assert.strictEqual(inspected.file_count, backup.file_count)
    assert.strictEqual(inspected.format, 'tar.gz')
    const verifierPath = path.join(
      __dirname,
      '../../../../ops/scv-instagram-golden-release/verify-recovery-preparation.js'
    )
    if (fs.existsSync(verifierPath)) {
      const external = require(verifierPath).inspectPrivateMemoryBackup(summary.backup_archive_path)
      assert.deepStrictEqual(external, inspected)
    }
    const parsedInventoryFile = path.join(success.root, 'parsed-source-inventory.json')
    writePrivate(parsedInventoryFile, {
      bootstrap_release_id: RELEASE_ID,
      bootstrap_deployment_id: DEPLOYMENT_ID,
      compiled_receipt: compiledReceiptForPackage(success.packages[0]),
      source_packages: success.packages
    })
    const parsedArguments = producer.parseArguments([
      '--manifest', success.manifestFile,
      '--pause-evidence', success.pauseFile,
      '--omar-system-purge-receipt', success.purgeFile,
      '--release-id', RELEASE_ID,
      '--bootstrap-deployment-id', DEPLOYMENT_ID,
      '--source-packages-file', parsedInventoryFile,
      '--target', success.target
    ])
    assert.strictEqual(parsedArguments.sourcePackages.length, 0)
    assert.strictEqual(parsedArguments.sourcePackagesFile, parsedInventoryFile)
    assert.strictEqual(parsedArguments.target, success.target)
    const summaryText = JSON.stringify(summary)
    for (const forbidden of ['1537753982', 'lead_100', '"old"', '"new"', '"other"', '"debug"']) {
      assert.strictEqual(summaryText.includes(forbidden), false, `summary leaked ${forbidden}`)
    }
    assert.strictEqual(fs.lstatSync(summary.backup_archive_path).mode & 0o077, 0)
    assert.strictEqual(fs.lstatSync(summary.backup_receipt_path).mode & 0o077, 0)
    assert.strictEqual(fs.lstatSync(summary.dry_run_receipt_path).mode & 0o077, 0)
    checked += 34

    checked += expectFailure('pause-off', (fixture) => {
      fixture.dependencies.env = { ...fixture.env, SCV_PAUSE_ALL: '0' }
    }, /requires_pause_all/)
    checked += expectFailure('wrong-env-phase', (fixture) => {
      fixture.dependencies.env = { ...fixture.env, SCV_RELEASE_PHASE: 'active' }
    }, /requires_bootstrap_phase/)
    checked += expectFailure('wrong-manifest-phase', (fixture) => {
      rewriteJson(fixture.manifestFile, (value) => { value.deployment.release_phase = 'active' })
    }, /bootstrap_manifest_invalid/)
    checked += expectFailure('noncanonical-manifest-path', (fixture) => {
      const copy = path.join(fixture.root, 'manifest-copy.json')
      writePrivate(copy, fixture.manifest)
      fixture.options.manifest = copy
    }, /manifest_path_not_canonical/)
    checked += expectFailure('wrong-deployment', (fixture) => {
      fixture.options.bootstrapDeploymentId = '88888888-8888-4888-8888-888888888888'
    }, /deployment_id_mismatch/)
    checked += expectFailure('wrong-target', (fixture) => {
      fixture.options.target = path.join(fixture.root, 'arbitrary-target')
    }, /target_must_equal_prod_namespace/)
    checked += expectFailure('purge-not-zero', (fixture) => {
      rewriteJson(fixture.purgeFile, (value) => { value.post_audit_remaining_count = 1 })
    }, /omar_purge_receipt_mismatch/)
    checked += expectFailure('live-debug-residue', (fixture) => {
      // The purge boundary requires the exact canonical username/contact pair;
      // a username on an unrelated customer's id is deliberately non-debug.
      const debugContactId = DEBUG_CONTACT_IDS[0]
      memoryFile(fixture.target, 'thread-history', debugContactId, {
        contact_id: debugContactId,
        thread_id: debugContactId,
        instagram_username: DEBUG_USERNAMES[0],
        events: [{ sender: { username: DEBUG_USERNAMES[0] }, role: 'user' }]
      })
    }, /live_debug_residue_present/)
    checked += expectFailure('debug-residue-race', (fixture) => {
      fixture.dependencies.afterBackupReceiptWritten = () => {
        memoryFile(fixture.target, 'thread-state', '778', {
          contact_id: '778',
          thread_id: '778',
          instagram_username: 'omal.system'
        })
      }
    }, /target_changed_before_publish/)
    checked += expectFailure('noncanonical-purge-path', (fixture) => {
      const copy = path.join(fixture.root, 'copied.omar-system-purge.json')
      writePrivate(copy, JSON.parse(fs.readFileSync(fixture.purgeFile, 'utf8')))
      fixture.options.omarSystemPurgeReceipt = copy
    }, /purge_receipt_path_not_canonical/)
    checked += expectFailure('arbitrary-source-root', (fixture) => {
      fixture.options.sources = [path.join(fixture.root, 'source-a')]
    }, /arbitrary_recovery_source_directories_forbidden/)
    checked += expectFailure('archive-symlink', (fixture) => {
      const real = fixture.packages[0].remote_path
      const linked = path.join(fixture.sourcePackageRoot, 'linked.tar.gz')
      fs.symlinkSync(real, linked)
      fixture.options.sourcePackages[0] = {
        ...fixture.packages[0],
        remote_path: linked
      }
    }, /private_regular_file|required/)
    checked += expectFailure('archive-special-entry', (fixture) => {
      replacePackage(fixture, 0, rawArchive([
        { name: 'thread-state/', type: '5' },
        { name: 'thread-history/', type: '5' },
        { name: 'thread-state/100.json', type: '2', link: '../outside' },
        { name: 'thread-history/100.json', bytes: '{"contact_id":"100","events":[]}' }
      ]), 1)
    }, /link_or_special|entry_forbidden/)
    checked += expectFailure('archive-queue-entry', (fixture) => {
      replacePackage(fixture, 0, rawArchive([
        { name: 'thread-state/', type: '5' },
        { name: 'thread-history/', type: '5' },
        { name: 'outbox/', type: '5' },
        { name: 'outbox/leak.json', bytes: '{"ok":true}' }
      ]), 1)
    }, /entry_forbidden/)
    checked += expectFailure('archive-malformed-json', (fixture) => {
      replacePackage(fixture, 0, rawArchive([
        { name: 'thread-state/', type: '5' },
        { name: 'thread-history/', type: '5' },
        { name: 'thread-state/300.json', bytes: '{' },
        { name: 'thread-history/300.json', bytes: '{"contact_id":"300","events":[]}' }
      ]), 2)
    }, /json_invalid|malformed_json/)
    checked += expectFailure('archive-oversize-json', (fixture) => {
      const oversized = Buffer.from(`{"payload":"${'x'.repeat(8 * 1024 * 1024)}"}`)
      replacePackage(fixture, 0, rawArchive([
        { name: 'thread-state/', type: '5' },
        { name: 'thread-history/', type: '5' },
        { name: 'thread-state/300.json', bytes: oversized },
        { name: 'thread-history/300.json', bytes: '{"contact_id":"300","events":[]}' }
      ]), 2)
    }, /private_regular_file_required|archive_entry_size|json/)
    checked += expectFailure('archive-canonical-debug-id', (fixture) => {
      replacePackage(fixture, 0, rawArchive([
        { name: 'thread-state/', type: '5' },
        { name: 'thread-history/', type: '5' },
        { name: 'thread-state/1537753982.json', bytes:
          '{"contact_id":"1537753982","thread_id":"1537753982"}' },
        { name: 'thread-history/1537753982.json', bytes:
          '{"contact_id":"1537753982","thread_id":"1537753982","events":[]}' }
      ]), 2)
    }, /debug_identity_forbidden/)
    checked += expectFailure('archive-debug-content', (fixture) => {
      const debugContactId = DEBUG_CONTACT_IDS[0]
      const debugUsername = DEBUG_USERNAMES[0]
      replacePackage(fixture, 0, rawArchive([
        { name: 'thread-state/', type: '5' },
        { name: 'thread-history/', type: '5' },
        // Keep a noncanonical basename so this case proves structured content
        // detection rather than the separate canonical-file-id rejection.
        { name: 'thread-state/301.json', bytes:
          JSON.stringify({
            contact_id: debugContactId,
            thread_id: debugContactId,
            instagram_username: debugUsername
          }) },
        { name: 'thread-history/301.json', bytes:
          JSON.stringify({
            contact_id: debugContactId,
            thread_id: debugContactId,
            instagram_username: debugUsername,
            events: []
          }) }
      ]), 2)
    }, /dry_run_contract_rejected/)
    checked += expectFailure('target-memory-symlink', (fixture) => {
      const stateFile = path.join(fixture.target, 'thread-state', '100.json')
      const outside = path.join(fixture.root, 'outside.json')
      writePrivate(outside, state('100', '2026-04-10T10:00:00.000Z'))
      fs.unlinkSync(stateFile)
      fs.symlinkSync(outside, stateFile)
    }, /private_regular_file_required/)
    checked += expectFailure('target-memory-special', (fixture) => {
      privateDirectory(path.join(fixture.target, 'thread-history', 'special.json'))
    }, /private_regular_file_required/)
    checked += expectFailure('target-root-public-mode', (fixture) => {
      fs.chmodSync(fixture.target, 0o755)
    }, /real_private_directory_required/)
    checked += expectFailure('target-memory-directory-public-mode', (fixture) => {
      fs.chmodSync(path.join(fixture.target, 'thread-state'), 0o755)
    }, /real_private_directory_required/)
    checked += expectFailure('target-memory-file-public-mode', (fixture) => {
      fs.chmodSync(path.join(fixture.target, 'thread-state', '100.json'), 0o644)
    }, /private_regular_file_required/)
    checked += expectFailure('target-queue-file-public-mode', (fixture) => {
      fs.chmodSync(path.join(fixture.target, 'outbox', 'pending.json'), 0o644)
    }, /private_regular_file_required/)
    checked += expectFailure('source-descriptor-public-json', (fixture) => {
      const file = path.join(fixture.root, 'source-packages.json')
      writePrivate(file, { source_packages: fixture.packages })
      fs.chmodSync(file, 0o644)
      fixture.options.sourcePackages = []
      fixture.options.sourcePackagesFile = file
    }, /private_regular_file_required/)

    const privateDescriptor = makeFixture('private-descriptor')
    roots.push(privateDescriptor.root)
    const descriptorFile = path.join(privateDescriptor.root, 'source-packages.json')
    writePrivate(descriptorFile, {
      bootstrap_release_id: RELEASE_ID,
      bootstrap_deployment_id: DEPLOYMENT_ID,
      compiled_receipt: compiledReceiptForPackage(privateDescriptor.packages[0]),
      source_packages: privateDescriptor.packages
    })
    privateDescriptor.options.sourcePackages = []
    privateDescriptor.options.sourcePackagesFile = descriptorFile
    const descriptorSummary = producer.prepareRecoveryEvidence(
      privateDescriptor.options,
      privateDescriptor.dependencies
    )
    assert.strictEqual(descriptorSummary.ok, true)
    assert.strictEqual(descriptorSummary.source_package_count, 1)
    checked += 2

    const noOp = makeFixture('no-op')
    roots.push(noOp.root)
    memoryFile(noOp.target, 'thread-state', '100', state(
      '100', '2026-04-18T10:00:00.000Z'
    ))
    memoryFile(noOp.target, 'thread-history', '100', history('100', [
      { event_id: 'source-100-2', at: '2026-04-18T10:00:00.000Z', role: 'user', text: 'new' }
    ]))
    memoryFile(noOp.target, 'thread-state', '200', state(
      '200', '2026-04-19T10:00:00.000Z'
    ))
    memoryFile(noOp.target, 'thread-history', '200', history('200', [
      { event_id: 'source-200-1', at: '2026-04-19T10:00:00.000Z', role: 'user', text: 'other' }
    ]))
    const noOpSummary = producer.prepareRecoveryEvidence(noOp.options, noOp.dependencies)
    const noOpDry = JSON.parse(fs.readFileSync(noOpSummary.dry_run_receipt_path, 'utf8'))
    assert.strictEqual(noOpSummary.planned_write_count, 0)
    assert.strictEqual(noOpDry.counts.state_writes_planned, 0)
    assert.strictEqual(noOpDry.counts.history_writes_planned, 0)
    assert.strictEqual(noOpDry.counts.writes_committed, 0)
    checked += 4

    const fault = makeFixture('fault-cleanup')
    roots.push(fault.root)
    assert.throws(() => producer.prepareRecoveryEvidence(fault.options, {
      ...fault.dependencies,
      afterArchiveWritten: () => { throw new Error('simulated_after_archive_failure') }
    }), /simulated_after_archive_failure/)
    const faultOutput = producer.defaultOutputDirectory(
      fault.target, RELEASE_ID, DEPLOYMENT_ID
    )
    assert.strictEqual(fs.existsSync(faultOutput), false)
    assert.strictEqual(fs.existsSync(`${faultOutput}.pending`), false)
    checked += 3

    const crash = makeFixture('sigkill-cleanup')
    roots.push(crash.root)
    const child = [
      `const p=require(${JSON.stringify(path.join(__dirname, 'scv-prepare-recovery-evidence.js'))});`,
      `const options=${JSON.stringify(crash.options)};`,
      `const env=${JSON.stringify(crash.env)};`,
      `p.prepareRecoveryEvidence(options,{env,expectedTargetRoot:${JSON.stringify(crash.target)},expectedSourceRoot:${JSON.stringify(crash.sourcePackageRoot)},expectedManifestPath:${JSON.stringify(crash.manifestFile)},recoveryEnv:{SCV_PAUSE_ALL:'1'},now:new Date('2026-08-20T20:00:00.000Z'),afterArchiveWritten(){process.kill(process.pid,'SIGKILL')}});`
    ].join('')
    const killed = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8' })
    assert.strictEqual(killed.signal, 'SIGKILL')
    const crashOutput = producer.defaultOutputDirectory(
      crash.target, RELEASE_ID, DEPLOYMENT_ID
    )
    assert.strictEqual(fs.existsSync(crashOutput), false)
    assert.strictEqual(fs.existsSync(`${crashOutput}.pending`), true)
    const resumed = producer.prepareRecoveryEvidence(crash.options, crash.dependencies)
    assert.strictEqual(resumed.ok, true)
    assert.strictEqual(fs.existsSync(`${crashOutput}.pending`), false)
    assert.strictEqual(fs.existsSync(crashOutput), true)
    checked += 6

    return { ok: true, checked }
  } finally {
    for (const root of roots) {
      try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
    }
  }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runHarness(), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: String(error?.message || error),
      stack: String(error?.stack || '')
    }, null, 2)}\n`)
    process.exit(1)
  }
}

module.exports = { runHarness }
