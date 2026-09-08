#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const zlib = require('zlib')
const { spawnSync } = require('child_process')
const {
  TRANSITION_PROTOCOL,
  EXECUTION_RECEIPT_SCHEMA,
  preparationReceiptPath,
  executionReceiptPath,
  executionIntentPath,
  privateReceiptFile,
  readExecutionIntent,
  verifyExecutionReceipt,
  verifyManifestTransition,
  requireProductionTransition,
  writePrivateExecutionReceipt
} = require('./scv-recovery-transition.js')
const {
  TRANSACTION_JOURNAL,
  STATE_DIR,
  HISTORY_DIR,
  buildRecoveryPlan,
  runRecovery
} = require('./scv-restore-non-debug-history.js')
const {
  executeApprovedRecovery
} = require('./scv-execute-approved-recovery.js')
const {
  prepareOneSourcePackage,
  prepareRecoverySourcePackages
} = require('./scv-recovery-source-packages.js')
const {
  COMPILED_RECOVERY_RECEIPT_SCHEMA
} = require('./scv-compiled-recovery-source-contract.js')

function compiledPackage(value, label = 'fixture') {
  const stateCount = Number(value.thread_state_file_count || 0)
  const historyCount = Number(value.thread_history_file_count || 0)
  return {
    ...value,
    file_count: stateCount + historyCount,
    thread_state_file_count: stateCount,
    thread_history_file_count: historyCount,
    queue_file_count: 0,
    omar_debug_file_count: 0,
    synthetic_nonnumeric_file_count: 0,
    compiled_receipt_schema: COMPILED_RECOVERY_RECEIPT_SCHEMA,
    compiled_receipt_file_sha256: crypto.createHash('sha256')
      .update(`compiled-receipt-file:${label}`).digest('hex'),
    compiled_receipt_self_sha256: crypto.createHash('sha256')
      .update(`compiled-receipt-self:${label}`).digest('hex')
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

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return file
}

function fixtureReceipt() {
  return {
    schema: EXECUTION_RECEIPT_SCHEMA,
    ok: true,
    transition_protocol: TRANSITION_PROTOCOL,
    release_phase: 'recovery_bootstrap',
    bootstrap_release_id: 'scv-instagram-golden-production-bootstrap-test',
    bootstrap_content_fingerprint_sha256: 'a'.repeat(64),
    bootstrap_release_manifest_sha256: 'b'.repeat(64),
    bootstrap_deployment_id: '11111111-1111-4111-8111-111111111111',
    recovery_execution_authorization_id: 'authorization-test',
    recovery_execution_authorization_sha256: 'c'.repeat(64),
    recovery_preparation_sha256: 'd'.repeat(64),
    omar_system_purge_receipt_sha256: '8'.repeat(64),
    source_packages: [compiledPackage({
        remote_path: '/data/scv-runtime-namespaces/prod/recovery-sources/dm-test.tar.gz',
        sha256: '6'.repeat(64),
        thread_state_file_count: 1,
        thread_history_file_count: 1
      }, 'aggregate-receipt')],
    executed_at_utc: '2026-08-20T12:00:00.000Z',
    target_root: '/data/scv-runtime-namespaces/prod',
    input_inventory_sha256: 'e'.repeat(64),
    plan_sha256: 'f'.repeat(64),
    restore_receipt_sha256: '1'.repeat(64),
    writes_committed: 2,
    safety: {
      pause_all_verified: true,
      canonical_debug_identity_excluded: true,
      queue_directories_touched: 0,
      restore_inbox: false,
      restore_outbox: false,
      restore_reactbox: false,
      blind_send: false
    },
    secrets_included: false,
    message_content_included: false
  }
}

function executorFixture(root, label, nowIso, fixtureOptions = {}) {
  const fixtureRoot = path.join(root, `executor-${label}`)
  const sourcePackageRoot = path.join(fixtureRoot, 'recovery-sources')
  const extractionRoot = path.join(sourcePackageRoot, '.verified-extractions')
  const source = path.join(extractionRoot, '6'.repeat(64))
  const persistRoot = path.join(fixtureRoot, 'persist')
  const target = fixtureOptions.productionShapedEnv === true
    ? path.join(persistRoot, 'scv-runtime-namespaces', 'prod')
    : path.join(fixtureRoot, 'target')
  for (const base of [source, target]) {
    fs.mkdirSync(path.join(base, STATE_DIR), { recursive: true, mode: 0o700 })
    fs.mkdirSync(path.join(base, HISTORY_DIR), { recursive: true, mode: 0o700 })
  }
  const sourceState = {
    contact_id: '9901',
    thread_id: '9901',
    instagram_username: 'durable.client',
    received_at: '2026-04-20T10:00:00.000Z'
  }
  writePrivate(path.join(source, STATE_DIR, '9901.json'), sourceState)
  const sourceHistory = {
    contact_id: '9901',
    thread_id: '9901',
    events: [{ event_id: 'fixture-history', at: '2026-04-20T10:00:00.000Z', role: 'user' }]
  }
  writePrivate(path.join(source, HISTORY_DIR, '9901.json'), sourceHistory)
  writePrivate(path.join(target, HISTORY_DIR, '9901.json'), sourceHistory)
  if (fixtureOptions.targetAlreadyCurrent === true) {
    writePrivate(path.join(target, STATE_DIR, '9901.json'), sourceState)
  }
  const env = {
    SCV_EXECUTE_NON_DEBUG_RECOVERY: 'I_ACKNOWLEDGE_SIGNED_NON_DEBUG_RECOVERY',
    SCV_PAUSE_ALL: '1',
    SCV_RELEASE_PHASE: 'recovery_bootstrap',
    SCV_PERSIST_ROOT: persistRoot,
    SCV_RUNTIME_NAMESPACE: fixtureOptions.productionShapedEnv === true ? 'prod' : 'fault',
    RAILWAY_DEPLOYMENT_ID: '77777777-7777-4777-8777-777777777777'
  }
  const recoveryEnv = { SCV_PAUSE_ALL: '1' }
  const sourcePackages = [compiledPackage({
      remote_path: `/data/scv-runtime-namespaces/prod/recovery-sources/dm-${label}.tar.gz`,
      sha256: '6'.repeat(64),
      thread_state_file_count: 1,
      thread_history_file_count: 1
    }, label)]
  const plan = buildRecoveryPlan({ sources: [source], target, env: recoveryEnv })
  const releaseId = `scv-instagram-golden-production-durable-${label}`
  const manifest = {
    release_id: releaseId,
    content_fingerprint_sha256: '4'.repeat(64),
    release_manifest_sha256: '5'.repeat(64),
    deployment: {
      release_phase: 'recovery_bootstrap',
      recovery_transition: {
        protocol: TRANSITION_PROTOCOL,
        role: 'bootstrap',
        execution_receipt_required: false,
        active_release_requires_execution_receipt: true
      }
    }
  }
  const preparation = {
    schema: 'scv-non-debug-recovery-preparation-2026-08-20-v1',
    ok: true,
    release_id: releaseId,
    content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    release_manifest_sha256: manifest.release_manifest_sha256,
    production_memory_mutated: false,
    actual_execute: false,
    secrets_included: false,
    bootstrap_deployment_id: env.RAILWAY_DEPLOYMENT_ID,
    omar_system_purge_receipt_sha256: '8'.repeat(64),
    source_packages: sourcePackages,
    compiled_source_receipt: compiledReceiptForPackage(sourcePackages[0]),
    target_root: target,
    pause: { verified: true, pause_all: true },
    dry_run: {
      input_inventory_sha256: plan.hashes.input_inventory_sha256,
      plan_sha256: plan.hashes.plan_sha256
    },
    queue_policy: {
      restore_inbox: false,
      restore_outbox: false,
      restore_reactbox: false,
      blind_send: false,
      stale_items_to_human_hold: true
    }
  }
  const manifestFile = writePrivate(path.join(fixtureRoot, 'manifest.json'), manifest)
  const preparationFile = writePrivate(path.join(fixtureRoot, 'preparation.json'), preparation)
  const preparationSha = privateReceiptFile(preparationFile).sha256
  const authorization = {
    authorization_id: `authorization-${label}`,
    recovery_preparation_sha256: preparationSha
  }
  const authorizationFile = writePrivate(
    path.join(fixtureRoot, 'recovery-authorization.json'),
    authorization
  )
  const options = {
    execute: true,
    target,
    manifest: manifestFile,
    preparation: preparationFile,
    authorization: authorizationFile
  }
  const dependencies = {
    env,
    now: new Date(nowIso),
    expectedTargetRoot: target,
    expectedSourcePackageRoot: sourcePackageRoot,
    verifyRecoveryExecutionAuthorizationReceipt: () => ({ ok: true, failures: [] }),
    prepareRecoverySourcePackages: () => ({
      sourceRoots: [source],
      observedPackages: sourcePackages
    })
  }
  if (fixtureOptions.useDefaultRecoveryEnv !== true) {
    dependencies.recoveryEnv = recoveryEnv
  }
  return {
    fixtureRoot,
    source,
    target,
    env,
    manifest,
    recoveryEnv,
    sourcePackages,
    plan,
    options,
    dependencies,
    authorizationFile,
    intentFile: executionIntentPath(releaseId, env),
    outputFile: executionReceiptPath(releaseId, env),
    targetFile: path.join(target, STATE_DIR, '9901.json')
  }
}

function restoreReceiptCount(intent) {
  const directory = path.dirname(intent.restore_receipt_path)
  return fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => name.endsWith('.json')).length
    : 0
}

function makeSourceArchive(packageRoot, label, records = [], options = {}) {
  const payload = path.join(packageRoot, `.payload-${label}`)
  fs.mkdirSync(path.join(payload, STATE_DIR), { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.join(payload, HISTORY_DIR), { recursive: true, mode: 0o700 })
  const materialized = [...records]
  if (!materialized.some((item) => item.kind !== 'history')) {
    materialized.push({
      kind: 'state', basename: '998001.json',
      value: { contact_id: '998001', thread_id: '998001' }
    })
  }
  if (!materialized.some((item) => item.kind === 'history')) {
    materialized.push({
      kind: 'history', basename: '998001.json',
      value: { contact_id: '998001', thread_id: '998001', events: [] }
    })
  }
  for (const record of materialized) {
    const directory = record.kind === 'history' ? HISTORY_DIR : STATE_DIR
    writePrivate(path.join(payload, directory, record.basename), record.value)
  }
  if (options.symlink) {
    fs.symlinkSync(
      path.join(payload, STATE_DIR, materialized.find((item) => item.kind !== 'history').basename),
      path.join(payload, STATE_DIR, 'linked.json')
    )
  }
  if (options.queue) {
    fs.mkdirSync(path.join(payload, 'inbox'), { mode: 0o700 })
    writePrivate(path.join(payload, 'inbox', 'queued.json'), { forbidden: true })
  }
  const archive = path.join(packageRoot, `${label}.tar.gz`)
  const entries = [STATE_DIR, HISTORY_DIR]
  if (options.queue) entries.push('inbox')
  const tar = spawnSync('tar', ['-czf', archive, '-C', payload, ...entries], {
    encoding: 'utf8'
  })
  if (tar.error || tar.status !== 0) {
    throw new Error(`fixture_tar_failed:${String(tar.error?.message || tar.stderr)}`)
  }
  fs.chmodSync(archive, 0o600)
  return compiledPackage({
    remote_path: archive,
    sha256: sha256File(archive),
    thread_state_file_count: materialized.filter((item) => item.kind !== 'history').length,
    thread_history_file_count: materialized.filter((item) => item.kind === 'history').length
  }, label)
}

function makeRawSourceArchive(packageRoot, label, entryName, value) {
  const content = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  const header = Buffer.alloc(512)
  header.write(entryName, 0, Math.min(Buffer.byteLength(entryName), 100), 'utf8')
  header.write('0000600\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`, 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii')
  header[154] = 0
  header[155] = 0x20
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512)
  const tar = Buffer.concat([header, content, padding, Buffer.alloc(1024)])
  const archive = path.join(packageRoot, `${label}.tar.gz`)
  fs.writeFileSync(archive, zlib.gzipSync(tar), { mode: 0o600 })
  fs.chmodSync(archive, 0o600)
  return compiledPackage({
    remote_path: archive,
    sha256: sha256File(archive),
    thread_state_file_count: 1,
    thread_history_file_count: 1
  }, label)
}

function runHarness() {
  let checked = 0
  const check = (condition, message) => {
    checked += 1
    assert(condition, message)
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-two-release-transition-'))
  try {
    const env = {
      SCV_PERSIST_ROOT: root,
      SCV_RUNTIME_NAMESPACE: 'prod',
      SCV_PAUSE_ALL: '1'
    }
    const receipt = fixtureReceipt()
    const output = executionReceiptPath(receipt.bootstrap_release_id, env)
    const written = writePrivateExecutionReceipt(output, receipt)
    check(fs.existsSync(output), 'private execution receipt missing')
    check((fs.statSync(output).mode & 0o077) === 0, 'execution receipt mode is not private')
    check(privateReceiptFile(output).sha256 === written.sha256, 'execution receipt hash drift')
    check(verifyExecutionReceipt(receipt).ok, 'valid aggregate receipt rejected')
    check(
      !JSON.stringify(receipt).includes('message text'),
      'aggregate receipt contains message content'
    )

    const activeManifest = {
      release_id: 'scv-instagram-golden-production-active-test',
      deployment: {
        release_phase: 'active',
        pre_freeze_baseline: { deployment_id: receipt.bootstrap_deployment_id },
        recovery_transition: {
          protocol: TRANSITION_PROTOCOL,
          role: 'active',
          execution_receipt_required: true,
          bootstrap_release_id: receipt.bootstrap_release_id,
          bootstrap_content_fingerprint_sha256:
            receipt.bootstrap_content_fingerprint_sha256,
          bootstrap_release_manifest_sha256:
            receipt.bootstrap_release_manifest_sha256,
          bootstrap_deployment_id: receipt.bootstrap_deployment_id,
          execution_receipt_schema: EXECUTION_RECEIPT_SCHEMA,
          execution_receipt_sha256: written.sha256
        }
      }
    }
    check(verifyManifestTransition(activeManifest).length === 0, 'active transition shape rejected')
    check(
      verifyExecutionReceipt(receipt, {
        manifest: activeManifest,
        receiptSha256: written.sha256
      }).ok,
      'active manifest did not accept exact execution receipt'
    )
    const activeGate = requireProductionTransition({
      manifest: activeManifest,
      approval: { recovery_execution_sha256: written.sha256 },
      env
    })
    check(activeGate.ok && activeGate.execution_receipt_verified, 'active runtime gate failed')
    check(
      !verifyExecutionReceipt(receipt, {
        manifest: {
          ...activeManifest,
          release_id: receipt.bootstrap_release_id
        },
        receiptSha256: written.sha256
      }).ok,
      'same release accepted as bootstrap and active'
    )
    check(
      !verifyExecutionReceipt(receipt, {
        manifest: activeManifest,
        receiptSha256: '9'.repeat(64)
      }).ok,
      'unbound execution receipt hash accepted'
    )
    const tampered = JSON.parse(fs.readFileSync(output, 'utf8'))
    tampered.safety.queue_directories_touched = 1
    writePrivate(output, tampered)
    assert.throws(
      () => requireProductionTransition({
        manifest: activeManifest,
        approval: { recovery_execution_sha256: written.sha256 },
        env
      }),
      /active_recovery_execution_rejected|execution_receipt_hash_mismatch/
    )
    checked += 1

    const bootstrapManifest = {
      release_id: receipt.bootstrap_release_id,
      content_fingerprint_sha256: receipt.bootstrap_content_fingerprint_sha256,
      release_manifest_sha256: receipt.bootstrap_release_manifest_sha256,
      deployment: {
        release_phase: 'recovery_bootstrap',
        recovery_transition: {
          protocol: TRANSITION_PROTOCOL,
          role: 'bootstrap',
          execution_receipt_required: false,
          active_release_requires_execution_receipt: true
        }
      }
    }
    const preparation = {
      schema: 'scv-non-debug-recovery-preparation-2026-08-20-v1',
      ok: true,
      release_id: bootstrapManifest.release_id,
      content_fingerprint_sha256: bootstrapManifest.content_fingerprint_sha256,
      release_manifest_sha256: bootstrapManifest.release_manifest_sha256,
      production_memory_mutated: false,
      actual_execute: false,
      secrets_included: false,
      target_root: '/data/scv-runtime-namespaces/prod',
      pause: { verified: true, pause_all: true },
      dry_run: {
        input_inventory_sha256: '2'.repeat(64),
        plan_sha256: '3'.repeat(64)
      },
      queue_policy: {
        restore_inbox: false,
        restore_outbox: false,
        restore_reactbox: false,
        blind_send: false,
        stale_items_to_human_hold: true
      }
    }
    const preparationFile = preparationReceiptPath(bootstrapManifest.release_id, env)
    check(!fs.existsSync(preparationFile), 'bootstrap unexpectedly required pre-start preparation')
    check(verifyManifestTransition(bootstrapManifest).length === 0, 'bootstrap shape rejected')
    const bootstrapGate = requireProductionTransition({
      manifest: bootstrapManifest,
      approval: {},
      env
    })
    check(
      bootstrapGate.ok && bootstrapGate.preparation_receipt_verified === false,
      'paused bootstrap did not start before post-deploy preparation'
    )

    const source = path.join(root, 'source')
    const target = path.join(root, 'target')
    for (const base of [source, target]) {
      fs.mkdirSync(path.join(base, STATE_DIR), { recursive: true })
      fs.mkdirSync(path.join(base, HISTORY_DIR), { recursive: true })
    }
    writePrivate(path.join(source, STATE_DIR, '9001.json'), {
      contact_id: '9001',
      thread_id: '9001',
      received_at: '2026-04-20T10:00:00.000Z'
    })
    const dry = runRecovery({ sources: [source], target, env: { SCV_PAUSE_ALL: '1' } })
    assert.throws(() => runRecovery({
      sources: [source],
      target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      expectedInputInventorySha256: dry.hashes.input_inventory_sha256,
      expectedPlanSha256: '0'.repeat(64)
    }), /plan differs from signed preparation/)
    checked += 1
    check(
      !fs.existsSync(path.join(target, STATE_DIR, '9001.json')),
      'mismatched signed plan wrote target memory'
    )
    const executed = runRecovery({
      sources: [source],
      target,
      execute: true,
      env: { SCV_PAUSE_ALL: '1' },
      expectedInputInventorySha256: dry.hashes.input_inventory_sha256,
      expectedPlanSha256: dry.hashes.plan_sha256,
      now: new Date('2026-08-20T12:00:01.000Z')
    })
    check(executed.counts.writes_committed === 1, 'exact signed plan did not execute')

    const packageRoot = path.join(root, 'source-packages')
    fs.mkdirSync(packageRoot, { mode: 0o700 })
    const compiledSourcePackage = makeSourceArchive(packageRoot, 'compiled-memory', [{
      kind: 'state',
      basename: '7101.json',
      value: { contact_id: '7101', thread_id: '7101', received_at: '2026-04-18T10:00:00.000Z' }
    }, {
      kind: 'history',
      basename: '7102.json',
      value: [{ role: 'user', content: 'private fixture content' }]
    }])
    const preparedPackages = prepareRecoverySourcePackages(
      [compiledSourcePackage],
      { expectedSourceRoot: packageRoot }
    )
    check(preparedPackages.sourceRoots.length === 1, 'compiled source archive was not extracted')
    check(
      preparedPackages.sourceRoots.every((item) => (fs.statSync(item).mode & 0o077) === 0),
      'source archive extraction was not private'
    )
    const preparedAgain = prepareRecoverySourcePackages(
      [compiledSourcePackage],
      { expectedSourceRoot: packageRoot }
    )
    check(
      JSON.stringify(preparedAgain.sourceRoots) === JSON.stringify(preparedPackages.sourceRoots),
      'identical authorized archives did not reuse exact verified extraction roots'
    )
    writePrivate(path.join(preparedPackages.sourceRoots[0], STATE_DIR, '7101.json'), {
      contact_id: 'tampered'
    })
    assert.throws(
      () => prepareRecoverySourcePackages(
        [compiledSourcePackage],
        { expectedSourceRoot: packageRoot }
      ),
      /existing_extraction_mismatch/
    )
    checked += 1
    const linkedPackage = makeSourceArchive(packageRoot, 'linked-history', [{
      kind: 'state',
      basename: '7201.json',
      value: { contact_id: '7201', thread_id: '7201' }
    }], { symlink: true })
    assert.throws(
      () => prepareRecoverySourcePackages(
        [linkedPackage],
        { expectedSourceRoot: packageRoot }
      ),
      /link_or_special_entry_forbidden|entry_forbidden/
    )
    checked += 1
    const queuedPackage = makeSourceArchive(packageRoot, 'queued-history', [{
      kind: 'state',
      basename: '7301.json',
      value: { contact_id: '7301', thread_id: '7301' }
    }], { queue: true })
    assert.throws(
      () => prepareRecoverySourcePackages(
        [queuedPackage],
        { expectedSourceRoot: packageRoot }
      ),
      /entry_forbidden/
    )
    checked += 1
    const traversalPackage = makeRawSourceArchive(
      packageRoot,
      'traversal-history',
      '../escape.json',
      { forbidden: true }
    )
    assert.throws(
      () => prepareOneSourcePackage(
        traversalPackage,
        { expectedSourceRoot: packageRoot }
      ),
      /archive_(list_failed|path_unsafe)/
    )
    checked += 1
    const wrongCountPackage = makeSourceArchive(packageRoot, 'wrong-count-history', [{
      kind: 'state',
      basename: '7401.json',
      value: { contact_id: '7401', thread_id: '7401' }
    }])
    assert.throws(
      () => prepareOneSourcePackage(
        { ...wrongCountPackage, file_count: 3 },
        { expectedSourceRoot: packageRoot }
      ),
        /descriptor_invalid|file_count/
    )
    checked += 1
    const wrongHashPackage = makeSourceArchive(packageRoot, 'wrong-hash-history', [{
      kind: 'state',
      basename: '7501.json',
      value: { contact_id: '7501', thread_id: '7501' }
    }])
    assert.throws(
      () => prepareOneSourcePackage(
        { ...wrongHashPackage, sha256: '0'.repeat(64) },
        { expectedSourceRoot: packageRoot }
      ),
      /archive_hash_mismatch/
    )
    checked += 1
    const publicModePackage = makeSourceArchive(packageRoot, 'public-mode-history', [{
      kind: 'state',
      basename: '7601.json',
      value: { contact_id: '7601', thread_id: '7601' }
    }])
    fs.chmodSync(publicModePackage.remote_path, 0o644)
    assert.throws(
      () => prepareOneSourcePackage(
        publicModePackage,
        { expectedSourceRoot: packageRoot }
      ),
      /must_be_private_regular_file/
    )
    checked += 1
    const changingPackage = makeSourceArchive(packageRoot, 'aa-changing-history', [{
      kind: 'state',
      basename: '7701.json',
      value: { contact_id: '7701', thread_id: '7701' }
    }])
    const tarWrapper = path.join(packageRoot, 'tar-swap-wrapper.sh')
    const swapMarker = path.join(packageRoot, '.tar-swap-once')
    fs.writeFileSync(tarWrapper, [
      '#!/bin/sh',
      'if [ ! -e "$SCV_TEST_TAR_SWAP_MARKER" ]; then',
      '  printf x >> "$SCV_TEST_TAR_SWAP_ORIGINAL"',
      '  : > "$SCV_TEST_TAR_SWAP_MARKER"',
      'fi',
      'exec /usr/bin/tar "$@"',
      ''
    ].join('\n'), { mode: 0o700 })
    fs.chmodSync(tarWrapper, 0o700)
    process.env.SCV_TEST_TAR_SWAP_ORIGINAL = changingPackage.remote_path
    process.env.SCV_TEST_TAR_SWAP_MARKER = swapMarker
    try {
      assert.throws(
        () => prepareOneSourcePackage(
          changingPackage,
          { expectedSourceRoot: packageRoot, tarBin: tarWrapper }
        ),
        /archive_changed_during_extraction/
      )
      checked += 1
    } finally {
      delete process.env.SCV_TEST_TAR_SWAP_ORIGINAL
      delete process.env.SCV_TEST_TAR_SWAP_MARKER
    }

    const arbitraryFixture = executorFixture(root, 'arbitrary-source', '2026-08-20T12:10:00.000Z')
    assert.throws(
      () => executeApprovedRecovery({
        ...arbitraryFixture.options,
        sources: [arbitraryFixture.source]
      }, arbitraryFixture.dependencies),
      /arbitrary_source_directories_forbidden/
    )
    checked += 1
    check(!fs.existsSync(arbitraryFixture.intentFile), 'arbitrary source created durable intent')

    const nofollowFixture = executorFixture(root, 'nofollow', '2026-08-20T12:11:00.000Z')
    const authorizationLink = path.join(nofollowFixture.fixtureRoot, 'authorization-link.json')
    fs.symlinkSync(nofollowFixture.authorizationFile, authorizationLink)
    assert.throws(
      () => executeApprovedRecovery({
        ...nofollowFixture.options,
        authorization: authorizationLink
      }, nofollowFixture.dependencies),
      /approved_recovery_authorization_must_be_private_regular_file/
    )
    checked += 1
    check(!fs.existsSync(nofollowFixture.intentFile), 'nofollow rejection created durable intent')

    const noOpFixture = executorFixture(
      root,
      'no-op',
      '2026-08-20T12:11:30.000Z',
      { targetAlreadyCurrent: true }
    )
    check(noOpFixture.plan.writes.length === 0, 'no-op fixture unexpectedly planned writes')
    const noOpResult = executeApprovedRecovery(noOpFixture.options, noOpFixture.dependencies)
    check(noOpResult.ok && noOpResult.writes_committed === 0, 'valid no-op recovery rejected')
    check(fs.existsSync(noOpFixture.outputFile), 'no-op recovery receipt missing')
    check(!fs.existsSync(noOpFixture.intentFile), 'no-op recovery retained durable intent')

    const directPersistentFixture = executorFixture(
      root,
      'direct-persistent-target',
      '2026-08-20T12:11:45.000Z',
      { productionShapedEnv: true, useDefaultRecoveryEnv: true }
    )
    const directPersistentResult = executeApprovedRecovery(
      directPersistentFixture.options,
      directPersistentFixture.dependencies
    )
    check(
      directPersistentResult.ok && directPersistentResult.writes_committed === 1,
      'production-shaped direct persistent target was rejected'
    )
    check(
      fs.existsSync(directPersistentFixture.targetFile),
      'production-shaped direct persistent target was not restored'
    )

    const killFixture = executorFixture(root, 'sigkill', '2026-08-20T12:12:00.000Z')
    const executorModule = path.join(__dirname, 'scv-execute-approved-recovery.js')
    const childCode = `
      const { executeApprovedRecovery } = require(${JSON.stringify(executorModule)})
      const options = ${JSON.stringify(killFixture.options)}
      const env = ${JSON.stringify(killFixture.env)}
      const recoveryEnv = ${JSON.stringify(killFixture.recoveryEnv)}
      const sourcePackages = ${JSON.stringify(killFixture.sourcePackages)}
      executeApprovedRecovery(options, {
        env,
        recoveryEnv,
        now: new Date('2026-08-20T12:12:00.000Z'),
        expectedTargetRoot: ${JSON.stringify(killFixture.target)},
        verifyRecoveryExecutionAuthorizationReceipt: () => ({ ok: true, failures: [] }),
        prepareRecoverySourcePackages: () => ({
          sourceRoots: [${JSON.stringify(killFixture.source)}],
          observedPackages: sourcePackages
        }),
        afterRestoreCommitted: () => process.kill(process.pid, 'SIGKILL')
      })
    `
    const killed = spawnSync(process.execPath, ['-e', childCode], { encoding: 'utf8' })
    check(killed.signal === 'SIGKILL', `fault child was not SIGKILLed: ${killed.stderr}`)
    check(fs.existsSync(killFixture.intentFile), 'SIGKILL lost durable recovery intent')
    check(fs.existsSync(killFixture.targetFile), 'SIGKILL occurred before committed restore')
    check(!fs.existsSync(killFixture.outputFile), 'SIGKILL unexpectedly wrote aggregate receipt')
    const killedIntent = readExecutionIntent(killFixture.intentFile).intent
    check(fs.existsSync(killedIntent.restore_receipt_path), 'SIGKILL lost restore commit receipt')
    check(restoreReceiptCount(killedIntent) === 1, 'SIGKILL created duplicate restore receipts')
    const committedTargetSha = sha256File(killFixture.targetFile)
    const resumedAfterKill = executeApprovedRecovery(killFixture.options, {
      ...killFixture.dependencies,
      now: new Date('2026-08-20T12:13:00.000Z'),
      runRecovery: () => { throw new Error('duplicate_restore_called') },
      prepareRecoverySourcePackages: () => { throw new Error('source_archive_reread_after_commit') }
    })
    check(
      resumedAfterKill.ok && resumedAfterKill.resumed_from_durable_intent,
      'SIGKILL recovery did not finalize from durable intent'
    )
    check(sha256File(killFixture.targetFile) === committedTargetSha, 'resume rewrote restored memory')
    check(fs.existsSync(killFixture.outputFile), 'resume did not write aggregate execution receipt')
    check(!fs.existsSync(killFixture.intentFile), 'resume did not remove finalized intent')
    check(restoreReceiptCount(killedIntent) === 1, 'resume duplicated underlying restore')

    const journalCommitFixture = executorFixture(
      root,
      'receipt-and-journal',
      '2026-08-20T12:13:30.000Z'
    )
    const journalCommitChildCode = `
      const fs = require('fs')
      const path = require('path')
      const { executeApprovedRecovery } = require(${JSON.stringify(executorModule)})
      const options = ${JSON.stringify(journalCommitFixture.options)}
      const env = ${JSON.stringify(journalCommitFixture.env)}
      const recoveryEnv = ${JSON.stringify(journalCommitFixture.recoveryEnv)}
      const sourcePackages = ${JSON.stringify(journalCommitFixture.sourcePackages)}
      const originalRename = fs.renameSync
      fs.renameSync = function (source, destination) {
        const result = originalRename.apply(this, arguments)
        if (destination.includes(path.sep + 'recovery-receipts' + path.sep)) {
          process.kill(process.pid, 'SIGKILL')
        }
        return result
      }
      executeApprovedRecovery(options, {
        env,
        recoveryEnv,
        now: new Date('2026-08-20T12:13:30.000Z'),
        expectedTargetRoot: ${JSON.stringify(journalCommitFixture.target)},
        expectedSourcePackageRoot: ${JSON.stringify(journalCommitFixture.dependencies.expectedSourcePackageRoot)},
        verifyRecoveryExecutionAuthorizationReceipt: () => ({ ok: true, failures: [] }),
        prepareRecoverySourcePackages: () => ({
          sourceRoots: [${JSON.stringify(journalCommitFixture.source)}],
          observedPackages: sourcePackages
        })
      })
    `
    const journalCommittedChild = spawnSync(
      process.execPath,
      ['-e', journalCommitChildCode],
      { encoding: 'utf8' }
    )
    check(
      journalCommittedChild.signal === 'SIGKILL',
      `receipt+journal child was not SIGKILLed: ${journalCommittedChild.stderr}`
    )
    check(fs.existsSync(journalCommitFixture.intentFile), 'receipt+journal crash lost outer intent')
    const journalCommittedIntent = readExecutionIntent(journalCommitFixture.intentFile).intent
    check(
      fs.existsSync(journalCommittedIntent.restore_receipt_path),
      'receipt+journal crash lost committed restore receipt'
    )
    const journalFile = path.join(journalCommitFixture.target, TRANSACTION_JOURNAL)
    check(fs.existsSync(journalFile), 'receipt+journal crash lost internal journal')
    check(!fs.existsSync(journalCommitFixture.outputFile), 'receipt+journal crash wrote aggregate receipt')
    const journalCommittedTargetSha = sha256File(journalCommitFixture.targetFile)
    const journalCommittedResume = executeApprovedRecovery(journalCommitFixture.options, {
      ...journalCommitFixture.dependencies,
      prepareRecoverySourcePackages: () => {
        throw new Error('source_archive_reread_after_committed_journal')
      }
    })
    check(journalCommittedResume.ok, 'receipt+journal resume did not finalize')
    check(!fs.existsSync(journalFile), 'receipt+journal resume retained internal journal')
    check(
      sha256File(journalCommitFixture.targetFile) === journalCommittedTargetSha,
      'receipt+journal resume rewrote committed output'
    )
    check(
      restoreReceiptCount(journalCommittedIntent) === 1,
      'receipt+journal resume duplicated underlying receipt'
    )
    check(fs.existsSync(journalCommitFixture.outputFile), 'receipt+journal resume lost aggregate receipt')

    const writerFixture = executorFixture(root, 'receipt-writer', '2026-08-20T12:14:00.000Z')
    assert.throws(
      () => executeApprovedRecovery(writerFixture.options, {
        ...writerFixture.dependencies,
        writeExecutionReceipt: () => { throw new Error('simulated_aggregate_receipt_write_failure') }
      }),
      /simulated_aggregate_receipt_write_failure/
    )
    checked += 1
    check(fs.existsSync(writerFixture.intentFile), 'receipt-write failure lost durable intent')
    const writerIntent = readExecutionIntent(writerFixture.intentFile).intent
    check(fs.existsSync(writerIntent.restore_receipt_path), 'receipt-write failure lost restore receipt')
    check(!fs.existsSync(writerFixture.outputFile), 'failed writer left ambiguous aggregate receipt')
    const writerResume = executeApprovedRecovery(writerFixture.options, {
      ...writerFixture.dependencies,
      runRecovery: () => { throw new Error('duplicate_restore_called') },
      prepareRecoverySourcePackages: () => { throw new Error('source_archive_reread_after_commit') }
    })
    check(writerResume.ok, 'receipt-write failure could not be safely finalized')
    check(restoreReceiptCount(writerIntent) === 1, 'receipt-write retry duplicated restore')

    const aggregateFixture = executorFixture(root, 'post-aggregate', '2026-08-20T12:15:00.000Z')
    assert.throws(
      () => executeApprovedRecovery(aggregateFixture.options, {
        ...aggregateFixture.dependencies,
        afterExecutionReceiptWritten: () => { throw new Error('simulated_post_aggregate_crash') }
      }),
      /simulated_post_aggregate_crash/
    )
    checked += 1
    check(fs.existsSync(aggregateFixture.outputFile), 'post-aggregate crash lost aggregate receipt')
    check(fs.existsSync(aggregateFixture.intentFile), 'post-aggregate crash lost finalize intent')
    const aggregateResume = executeApprovedRecovery(aggregateFixture.options, {
      ...aggregateFixture.dependencies,
      runRecovery: () => { throw new Error('duplicate_restore_called') },
      prepareRecoverySourcePackages: () => { throw new Error('source_archive_reread_after_commit') }
    })
    check(aggregateResume.ok, 'existing exact aggregate receipt did not safely finalize')
    check(!fs.existsSync(aggregateFixture.intentFile), 'finalized aggregate retained intent')

    const tamperFixture = executorFixture(root, 'tampered-output', '2026-08-20T12:16:00.000Z')
    assert.throws(
      () => executeApprovedRecovery(tamperFixture.options, {
        ...tamperFixture.dependencies,
        afterRestoreCommitted: () => { throw new Error('simulated_after_restore_crash') }
      }),
      /simulated_after_restore_crash/
    )
    checked += 1
    writePrivate(tamperFixture.targetFile, {
      contact_id: '9901',
      thread_id: '9901',
      tampered: true
    })
    assert.throws(
      () => executeApprovedRecovery(tamperFixture.options, {
        ...tamperFixture.dependencies,
        runRecovery: () => { throw new Error('duplicate_restore_called') },
        prepareRecoverySourcePackages: () => { throw new Error('source_archive_reread_after_commit') }
      }),
      /committed_restore_output_hash_mismatch/
    )
    checked += 1
    check(fs.existsSync(tamperFixture.intentFile), 'tampered committed output discarded audit intent')
    check(!fs.existsSync(tamperFixture.outputFile), 'tampered committed output got aggregate receipt')

    const intentTamperFixture = executorFixture(root, 'tampered-intent', '2026-08-20T12:17:00.000Z')
    assert.throws(
      () => executeApprovedRecovery(intentTamperFixture.options, {
        ...intentTamperFixture.dependencies,
        afterRestoreCommitted: () => { throw new Error('simulated_after_restore_crash') }
      }),
      /simulated_after_restore_crash/
    )
    checked += 1
    const tamperedIntent = JSON.parse(fs.readFileSync(intentTamperFixture.intentFile, 'utf8'))
    tamperedIntent.writes[0].output_sha256 = '9'.repeat(64)
    writePrivate(intentTamperFixture.intentFile, tamperedIntent)
    assert.throws(
      () => executeApprovedRecovery(intentTamperFixture.options, intentTamperFixture.dependencies),
      /recovery_intent_write_plan_hash_mismatch/
    )
    checked += 1
    check(fs.existsSync(intentTamperFixture.intentFile), 'tampered intent was silently discarded')
    check(!fs.existsSync(intentTamperFixture.outputFile), 'tampered intent got aggregate receipt')

    return {
      ok: true,
      version: 'scv-recovery-transition-harness-2026-08-20-v2-durable-resume',
      checked,
      network: false,
      production_mutation: false
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runHarness())}\n`)
  } catch (error) {
    process.stderr.write(`${String(error?.stack || error)}\n`)
    process.exit(1)
  }
}

module.exports = { runHarness }
