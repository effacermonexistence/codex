#!/usr/bin/env node
const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  executionIntentFrom,
  executeApprovedRecovery
} = require('./scv-execute-approved-recovery.js')
const { TRANSACTION_JOURNAL } = require('./scv-restore-non-debug-history.js')
const {
  EXECUTION_INTENT_SCHEMA,
  PREPARATION_RECEIPT_SCHEMA,
  executionIntentPath,
  readExecutionIntent,
  verifyExecutionIntent
} = require('./scv-recovery-transition.js')
const {
  COMPILED_RECOVERY_RECEIPT_SCHEMA
} = require('./scv-compiled-recovery-source-contract.js')
const {
  DEBUG_CONTACT_IDS,
  DEBUG_USERNAMES
} = require('./scv-debug-identity.js')

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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  return directory
}

function writePrivate(file, value) {
  privateDirectory(path.dirname(file))
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return file
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function runHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-approved-recovery-harness-'))
  fs.chmodSync(root, 0o700)
  let checked = 0
  try {
    const deploymentId = '77777777-7777-4777-8777-777777777777'
    const expectedSourceRoot = '/data/scv-runtime-namespaces/prod/recovery-sources'
    const extractionRoot = path.join(expectedSourceRoot, '.verified-extractions')
    const sourcePackages = [
      {
        remote_path: path.join(expectedSourceRoot, 'a-history.tar.gz'),
        sha256: '1'.repeat(64),
        file_count: 2,
        thread_state_file_count: 1,
        thread_history_file_count: 1,
        queue_file_count: 0,
        omar_debug_file_count: 0,
        synthetic_nonnumeric_file_count: 0,
        compiled_receipt_schema: COMPILED_RECOVERY_RECEIPT_SCHEMA,
        compiled_receipt_file_sha256: 'a'.repeat(64),
        compiled_receipt_self_sha256: 'b'.repeat(64)
      }
    ]
    const sourceRoots = sourcePackages.map((item) =>
      path.join(extractionRoot, item.sha256))
    const targetRoot = privateDirectory(path.join(root, 'intent-target'))
    const outputHash = '3'.repeat(64)
    const inputInventorySha256 = '4'.repeat(64)
    const planSha256 = sha256(`state:9901.json:${outputHash}`)
    const manifest = {
      release_id: 'scv-instagram-golden-production-execution-audit-test',
      content_fingerprint_sha256: '5'.repeat(64),
      release_manifest_sha256: '6'.repeat(64),
      deployment: { release_phase: 'recovery_bootstrap' }
    }
    const authorization = { authorization_id: 'authorization-execution-audit-test' }
    const intent = executionIntentFrom({
      plan: {
        validationPassed: true,
        sourceRoots,
        targetRoot,
        artifactRoot: targetRoot,
        hashes: { input_inventory_sha256: inputInventorySha256, plan_sha256: planSha256 },
        writes: [{ kind: 'state', basename: '9901.json', outputHash }]
      },
      manifest,
      authorization,
      authorizationSha256: '7'.repeat(64),
      preparationSha256: '8'.repeat(64),
      omarPurgeReceiptSha256: '9'.repeat(64),
      sourcePackages,
      env: { RAILWAY_DEPLOYMENT_ID: deploymentId },
      now: new Date('2026-08-20T23:00:00.000Z')
    })
    assert.strictEqual(intent.schema, EXECUTION_INTENT_SCHEMA)
    const intentOptions = {
      manifest,
      authorizationSha256: '7'.repeat(64),
      preparationSha256: '8'.repeat(64),
      omarPurgeReceiptSha256: '9'.repeat(64),
      deploymentId,
      targetRoot,
      sourcePackages,
      expectedSourceRoot,
      inputInventorySha256,
      planSha256
    }
    const intentVerdict = verifyExecutionIntent(intent, intentOptions)
    assert.strictEqual(intentVerdict.ok, true, intentVerdict.failures.join(','))
    checked += 1
    const validIntentFile = writePrivate(path.join(root, 'valid-resume-intent.json'), intent)
    assert.strictEqual(
      readExecutionIntent(validIntentFile, intentOptions).intent.plan_sha256,
      planSha256
    )
    checked += 1

    const inputTampered = clone(intent)
    inputTampered.input_inventory_sha256 = 'a'.repeat(64)
    assert.strictEqual(verifyExecutionIntent(inputTampered, intentOptions).ok, false)
    checked += 1
    assert.throws(
      () => readExecutionIntent(
        writePrivate(path.join(root, 'input-tampered-resume-intent.json'), inputTampered),
        intentOptions
      ),
      /recovery_intent_current_input_inventory_mismatch/
    )
    checked += 1

    const planTampered = clone(intent)
    planTampered.plan_sha256 = 'b'.repeat(64)
    assert.strictEqual(verifyExecutionIntent(planTampered, intentOptions).ok, false)
    checked += 1
    assert.throws(
      () => readExecutionIntent(
        writePrivate(path.join(root, 'plan-tampered-resume-intent.json'), planTampered),
        intentOptions
      ),
      /recovery_intent_write_plan_hash_mismatch|recovery_intent_current_plan_mismatch/
    )
    checked += 1

    const rootTampered = clone(intent)
    rootTampered.source_roots[0] = path.join(extractionRoot, 'c'.repeat(64))
    assert.strictEqual(verifyExecutionIntent(rootTampered, intentOptions).ok, false)
    checked += 1
    assert.throws(
      () => readExecutionIntent(
        writePrivate(path.join(root, 'root-tampered-resume-intent.json'), rootTampered),
        intentOptions
      ),
      /recovery_intent_source_roots_not_bound_to_packages/
    )
    checked += 1

    const persistRoot = privateDirectory(path.join(root, 'persist'))
    const liveTarget = privateDirectory(
      path.join(persistRoot, 'scv-runtime-namespaces', 'prod')
    )
    privateDirectory(path.join(liveTarget, 'thread-state'))
    privateDirectory(path.join(liveTarget, 'thread-history'))
    // Destructive debug identity is intentionally a bound username/contact-id
    // pair. Use the canonical pair here; a username attached to an unrelated
    // customer id must not become purge or restore authority.
    const debugContactId = DEBUG_CONTACT_IDS[0]
    const debugUsername = DEBUG_USERNAMES[0]
    const residueFile = writePrivate(path.join(
      liveTarget,
      'thread-history',
      `${debugContactId}.json`
    ), {
      contact_id: debugContactId,
      thread_id: debugContactId,
      events: [{ sender: { profile: { username: debugUsername } } }]
    })
    const liveManifest = {
      release_id: 'scv-instagram-golden-production-live-residue-test',
      content_fingerprint_sha256: 'd'.repeat(64),
      release_manifest_sha256: 'e'.repeat(64),
      deployment: {
        release_phase: 'recovery_bootstrap',
        recovery_transition: { role: 'bootstrap' }
      }
    }
    const livePackages = sourcePackages.map((item, index) => ({
      ...item,
      remote_path: path.join(expectedSourceRoot, `live-${index}.tar.gz`)
    }))
    const livePreparation = {
      schema: PREPARATION_RECEIPT_SCHEMA,
      ok: true,
      release_id: liveManifest.release_id,
      content_fingerprint_sha256: liveManifest.content_fingerprint_sha256,
      release_manifest_sha256: liveManifest.release_manifest_sha256,
      bootstrap_deployment_id: deploymentId,
      production_memory_mutated: false,
      actual_execute: false,
      secrets_included: false,
      omar_system_purge_receipt_sha256: 'f'.repeat(64),
      source_packages: livePackages,
      compiled_source_receipt: compiledReceiptForPackage(livePackages[0]),
      target_root: liveTarget,
      pause: { verified: true, pause_all: true },
      dry_run: {
        input_inventory_sha256: '1'.repeat(64),
        plan_sha256: '2'.repeat(64)
      },
      queue_policy: {
        restore_inbox: false,
        restore_outbox: false,
        restore_reactbox: false,
        blind_send: false,
        stale_items_to_human_hold: true
      }
    }
    const manifestFile = writePrivate(path.join(root, 'live-manifest.json'), liveManifest)
    const preparationFile = writePrivate(path.join(root, 'live-preparation.json'), livePreparation)
    const authorizationFile = writePrivate(path.join(root, 'live-authorization.json'), {
      authorization_id: 'authorization-live-residue-test'
    })
    const env = {
      SCV_EXECUTE_NON_DEBUG_RECOVERY: 'I_ACKNOWLEDGE_SIGNED_NON_DEBUG_RECOVERY',
      SCV_PAUSE_ALL: '1',
      SCV_RELEASE_PHASE: 'recovery_bootstrap',
      SCV_PERSIST_ROOT: persistRoot,
      SCV_RUNTIME_NAMESPACE: 'prod',
      RAILWAY_DEPLOYMENT_ID: deploymentId
    }
    let sourcePreparationCalled = false
    assert.throws(() => executeApprovedRecovery({
      execute: true,
      target: liveTarget,
      manifest: manifestFile,
      preparation: preparationFile,
      authorization: authorizationFile
    }, {
      env,
      now: new Date('2026-08-20T23:01:00.000Z'),
      expectedTargetRoot: liveTarget,
      expectedSourcePackageRoot: expectedSourceRoot,
      verifyRecoveryExecutionAuthorizationReceipt: () => ({ ok: true, failures: [] }),
      prepareRecoverySourcePackages: () => {
        sourcePreparationCalled = true
        throw new Error('source_preparation_must_not_run_with_live_debug_residue')
      }
    }), /approved_recovery_live_debug_residue_present/)
    checked += 1
    assert.strictEqual(sourcePreparationCalled, false)
    checked += 1
    assert.strictEqual(fs.existsSync(executionIntentPath(liveManifest.release_id, env)), false)
    checked += 1
    assert.strictEqual(fs.existsSync(residueFile), true)
    checked += 1

    fs.unlinkSync(residueFile)
    const journalFile = writePrivate(path.join(liveTarget, TRANSACTION_JOURNAL), {
      simulated: 'legacy_inner_journal_without_outer_intent'
    })
    let rolledBackFirst = false
    let prepareObservedReconciliation = false
    assert.throws(() => executeApprovedRecovery({
      execute: true,
      target: liveTarget,
      manifest: manifestFile,
      preparation: preparationFile,
      authorization: authorizationFile
    }, {
      env,
      now: new Date('2026-08-20T23:02:00.000Z'),
      expectedTargetRoot: liveTarget,
      expectedSourcePackageRoot: expectedSourceRoot,
      verifyRecoveryExecutionAuthorizationReceipt: () => ({ ok: true, failures: [] }),
      runRecovery: () => {
        fs.unlinkSync(journalFile)
        rolledBackFirst = true
        throw new Error('pending recovery transaction rolled back; rerun dry-run before execute')
      },
      prepareRecoverySourcePackages: () => {
        prepareObservedReconciliation = rolledBackFirst && !fs.existsSync(journalFile)
        throw new Error('stop_after_early_journal_reconciliation')
      }
    }), /stop_after_early_journal_reconciliation/)
    checked += 1
    assert.strictEqual(rolledBackFirst, true)
    checked += 1
    assert.strictEqual(prepareObservedReconciliation, true)
    checked += 1
    assert.strictEqual(fs.existsSync(journalFile), false)
    checked += 1
    assert.strictEqual(fs.existsSync(executionIntentPath(liveManifest.release_id, env)), false)
    checked += 1

    writePrivate(journalFile, { simulated: 'committed_inner_journal_without_outer_intent' })
    let committedPrepareCalled = false
    assert.throws(() => executeApprovedRecovery({
      execute: true,
      target: liveTarget,
      manifest: manifestFile,
      preparation: preparationFile,
      authorization: authorizationFile
    }, {
      env,
      now: new Date('2026-08-20T23:03:00.000Z'),
      expectedTargetRoot: liveTarget,
      expectedSourcePackageRoot: expectedSourceRoot,
      verifyRecoveryExecutionAuthorizationReceipt: () => ({ ok: true, failures: [] }),
      runRecovery: () => {
        fs.unlinkSync(journalFile)
        throw new Error('pending committed recovery finalized; rerun dry-run before execute')
      },
      prepareRecoverySourcePackages: () => {
        committedPrepareCalled = true
        throw new Error('committed_without_intent_must_not_prepare_sources')
      }
    }), /approved_recovery_committed_restore_without_execution_intent/)
    checked += 1
    assert.strictEqual(committedPrepareCalled, false)
    checked += 1
    assert.strictEqual(fs.existsSync(journalFile), false)
    checked += 1

    return {
      ok: true,
      version: 'scv-approved-recovery-execution-adversarial-2026-08-20-v1',
      checked,
      signed_input_and_plan_bound: true,
      extraction_paths_bound_on_resume: true,
      nested_live_debug_residue_rejected_before_intent: true,
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
