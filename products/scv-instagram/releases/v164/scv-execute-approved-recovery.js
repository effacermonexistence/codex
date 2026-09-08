#!/usr/bin/env node
// Explicit post-bootstrap recovery executor. It is never called by startup or
// promotion. A distinct post-bootstrap Ben authorization must bind the exact
// preparation receipt, live bootstrap deployment, and source packages, and
// a fresh in-container dry-run must reproduce its plan before writes begin.
const fs = require('fs')
const path = require('path')
const {
  TRANSACTION_JOURNAL,
  buildRecoveryPlan,
  runRecovery,
  stableJson
} = require('./scv-restore-non-debug-history.js')
const {
  verifyRecoveryExecutionAuthorizationReceipt
} = require('./scv-release-approval.js')
const {
  SOURCE_PACKAGE_ROOT,
  prepareRecoverySourcePackages
} = require('./scv-recovery-source-packages.js')
const {
  captureCanonicalDebugResidue
} = require('./scv-prepare-recovery-evidence.js')
const {
  TRANSITION_PROTOCOL,
  EXECUTION_RECEIPT_SCHEMA,
  EXECUTION_INTENT_SCHEMA,
  executionReceiptPath,
  executionIntentPath,
  expectedRestoreReceiptPath,
  privateReceiptFile,
  readJsonFileSnapshot,
  readExecutionIntent,
  normalizedSourcePackages,
  removePrivateExecutionIntent,
  validateCommittedRestoreForIntent,
  verifyPreparationReceipt,
  verifyExecutionReceipt,
  writePrivateExecutionIntent,
  writePrivateExecutionReceipt
} = require('./scv-recovery-transition.js')

function argsFrom(argv) {
  const out = { sources: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--execute') { out.execute = true; continue }
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing_argument_value:${item}`)
    if (item === '--source') out.sources.push(value)
    else if (item.startsWith('--')) out[item.slice(2)] = value
    else throw new Error(`unknown_argument:${item}`)
    index += 1
  }
  return out
}

function executionReceiptFrom({
  manifest,
  authorization,
  authorizationSha256,
  preparationSha256,
  omarPurgeReceiptSha256,
  executed,
  sourcePackages,
  env,
  now,
  targetRoot = '/data/scv-runtime-namespaces/prod'
}) {
  return {
    schema: EXECUTION_RECEIPT_SCHEMA,
    ok: true,
    transition_protocol: TRANSITION_PROTOCOL,
    release_phase: 'recovery_bootstrap',
    bootstrap_release_id: manifest.release_id,
    bootstrap_content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    bootstrap_release_manifest_sha256: manifest.release_manifest_sha256,
    bootstrap_deployment_id: String(env.RAILWAY_DEPLOYMENT_ID || ''),
    recovery_execution_authorization_id: authorization.authorization_id,
    recovery_execution_authorization_sha256: authorizationSha256,
    recovery_preparation_sha256: preparationSha256,
    omar_system_purge_receipt_sha256: omarPurgeReceiptSha256,
    source_packages: normalizedSourcePackages(sourcePackages),
    executed_at_utc: now.toISOString(),
    target_root: path.resolve(targetRoot),
    input_inventory_sha256: executed.hashes.input_inventory_sha256,
    plan_sha256: executed.hashes.plan_sha256,
    restore_receipt_sha256: executed.hashes.receipt_sha256,
    writes_committed: executed.counts.writes_committed,
    safety: {
      pause_all_verified: executed.safety.pause_all_verified,
      canonical_debug_identity_excluded:
        executed.safety.canonical_debug_identity_excluded,
      queue_directories_touched: executed.safety.queue_directories_touched,
      restore_inbox: false,
      restore_outbox: false,
      restore_reactbox: false,
      blind_send: false
    },
    secrets_included: false,
    message_content_included: false
  }
}

function executionIntentFrom({
  plan,
  manifest,
  authorization,
  authorizationSha256,
  preparationSha256,
  omarPurgeReceiptSha256,
  sourcePackages,
  env,
  now
}) {
  return {
    schema: EXECUTION_INTENT_SCHEMA,
    transition_protocol: TRANSITION_PROTOCOL,
    bootstrap_release_id: manifest.release_id,
    bootstrap_content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    bootstrap_release_manifest_sha256: manifest.release_manifest_sha256,
    bootstrap_deployment_id: String(env.RAILWAY_DEPLOYMENT_ID || ''),
    recovery_execution_authorization_id: authorization.authorization_id,
    recovery_execution_authorization_sha256: authorizationSha256,
    recovery_preparation_sha256: preparationSha256,
    omar_system_purge_receipt_sha256: omarPurgeReceiptSha256,
    created_at_utc: now.toISOString(),
    restore_started_at_utc: now.toISOString(),
    source_roots: [...plan.sourceRoots],
    target_root: plan.targetRoot,
    artifact_root: plan.artifactRoot,
    restore_receipt_path: expectedRestoreReceiptPath(plan.artifactRoot, now),
    source_packages: normalizedSourcePackages(sourcePackages),
    input_inventory_sha256: plan.hashes.input_inventory_sha256,
    plan_sha256: plan.hashes.plan_sha256,
    writes: plan.writes.map((write) => ({
      kind: write.kind,
      basename: write.basename,
      output_sha256: write.outputHash
    })),
    secrets_included: false,
    message_content_included: false
  }
}

function planMatchesIntent(plan, intent) {
  const compiledPackage = Array.isArray(intent?.source_packages)
    ? intent.source_packages[0]
    : null
  return Boolean(
    plan.validationPassed === true &&
    plan.counts?.sources === 1 &&
    plan.counts?.source_state_files === compiledPackage?.thread_state_file_count &&
    plan.counts?.source_history_files === compiledPackage?.thread_history_file_count &&
    plan.counts?.excluded_debug_files === 0 &&
    plan.counts?.excluded_synthetic_files === 0 &&
    plan.counts?.invalid_json_files === 0 &&
    plan.counts?.invalid_schema_files === 0 &&
    plan.counts?.queue_directories_touched === 0 &&
    plan.hashes.input_inventory_sha256 === intent.input_inventory_sha256 &&
    plan.hashes.plan_sha256 === intent.plan_sha256 &&
    path.resolve(plan.targetRoot) === path.resolve(intent.target_root) &&
    path.resolve(plan.artifactRoot) === path.resolve(intent.artifact_root) &&
    JSON.stringify(plan.sourceRoots) === JSON.stringify(intent.source_roots) &&
    JSON.stringify(plan.writes.map((write) => ({
      kind: write.kind,
      basename: write.basename,
      output_sha256: write.outputHash
    }))) === JSON.stringify(intent.writes)
  )
}

function aggregateReceiptMatches(expected, actual, expectedTargetRoot) {
  const verdict = verifyExecutionReceipt(actual, { expectedTargetRoot })
  return verdict.ok && stableJson(actual) === stableJson(expected)
}

function executionSummary(receipt, receiptSha256, resumed) {
  return {
    schema: 'scv-approved-non-debug-recovery-execution-summary-2026-08-20-v1',
    ok: true,
    bootstrap_release_id: receipt.bootstrap_release_id,
    bootstrap_deployment_id: receipt.bootstrap_deployment_id,
    execution_receipt_sha256: receiptSha256,
    writes_committed: receipt.writes_committed,
    automation_remains_paused: true,
    active_release_required: true,
    resumed_from_durable_intent: resumed,
    raw_message_content_included: false
  }
}

function requireCleanLiveDebugAudit(targetRoot, capture) {
  const audit = capture(targetRoot)
  if (
    !audit || audit.remaining_count !== 0 ||
    !/^[a-f0-9]{64}$/.test(String(audit.inventory_sha256 || ''))
  ) throw new Error('approved_recovery_live_debug_residue_present')
  return audit
}

function executeApprovedRecovery(options = {}, dependencies = {}) {
  const run = dependencies.runRecovery || runRecovery
  const buildPlan = dependencies.buildRecoveryPlan || buildRecoveryPlan
  const verifyAuthorization = dependencies.verifyRecoveryExecutionAuthorizationReceipt ||
    verifyRecoveryExecutionAuthorizationReceipt
  const prepareSources = dependencies.prepareRecoverySourcePackages ||
    prepareRecoverySourcePackages
  const writeIntent = dependencies.writeExecutionIntent || writePrivateExecutionIntent
  const writeReceipt = dependencies.writeExecutionReceipt || writePrivateExecutionReceipt
  const captureLiveDebugResidue = dependencies.captureCanonicalDebugResidue ||
    captureCanonicalDebugResidue
  const now = dependencies.now || new Date()
  const env = dependencies.env || process.env
  // This executor's target is the effective persistent namespace itself, not
  // the app root whose memory directories are symlinks into that namespace.
  // Passing the full production env would make the generic restore layer
  // demand app-root symlinks beneath /data/.../prod and reject the real volume
  // directories. Keep the restore environment deliberately narrow: pause is
  // already verified above, and persistent binding resolution is inapplicable
  // for this direct target.
  const recoveryEnv = dependencies.recoveryEnv || { SCV_PAUSE_ALL: '1' }
  const expectedTargetRoot = path.resolve(
    dependencies.expectedTargetRoot || '/data/scv-runtime-namespaces/prod'
  )
  const expectedSourcePackageRoot = path.resolve(
    dependencies.expectedSourcePackageRoot || SOURCE_PACKAGE_ROOT
  )
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('approved_recovery_execution_time_invalid')
  }
  if (options.execute !== true) throw new Error('approved_recovery_requires_execute_flag')
  if (Array.isArray(options.sources) && options.sources.length) {
    throw new Error('approved_recovery_arbitrary_source_directories_forbidden')
  }
  if (
    env.SCV_EXECUTE_NON_DEBUG_RECOVERY !==
    'I_ACKNOWLEDGE_SIGNED_NON_DEBUG_RECOVERY'
  ) throw new Error('approved_recovery_acknowledgement_missing')
  if (String(env.SCV_PAUSE_ALL || '') !== '1') {
    throw new Error('approved_recovery_requires_live_pause_all')
  }
  if (
    env.SCV_RELEASE_PHASE &&
    String(env.SCV_RELEASE_PHASE) !== 'recovery_bootstrap'
  ) {
    throw new Error('approved_recovery_requires_running_bootstrap_phase')
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(env.RAILWAY_DEPLOYMENT_ID || ''))) {
    throw new Error('approved_recovery_bootstrap_deployment_id_missing')
  }
  const manifestLoaded = readJsonFileSnapshot(options.manifest, {
    label: 'approved_recovery_manifest',
    maxBytes: 8 * 1024 * 1024
  })
  const manifest = manifestLoaded.value
  if (manifest?.deployment?.release_phase !== 'recovery_bootstrap') {
    throw new Error('approved_recovery_requires_bootstrap_release')
  }
  if (manifest?.deployment?.recovery_transition?.role !== 'bootstrap') {
    throw new Error('approved_recovery_bootstrap_transition_missing')
  }
  const authorizationLoaded = readJsonFileSnapshot(options.authorization, {
    label: 'approved_recovery_authorization',
    maxBytes: 1024 * 1024,
    privateFile: true
  })
  const preparationLoaded = readJsonFileSnapshot(options.preparation, {
    label: 'approved_recovery_preparation',
    maxBytes: 8 * 1024 * 1024,
    privateFile: true
  })
  const authorization = authorizationLoaded.value
  const preparation = preparationLoaded.value
  const authorizationSha256 = authorizationLoaded.sha256
  const preparationSha256 = preparationLoaded.sha256
  const preparationVerdict = verifyPreparationReceipt(preparation, manifest, {
    expectedTargetRoot,
    bootstrapDeploymentId: env.RAILWAY_DEPLOYMENT_ID
  })
  if (!preparationVerdict.ok) {
    throw new Error(
      `approved_recovery_preparation_contract_rejected:${preparationVerdict.failures.join(',')}`
    )
  }
  const signedSourcePackages = normalizedSourcePackages(preparation.source_packages)
  const authorizationVerdict = verifyAuthorization(
    authorization,
    manifest,
    preparation,
    {
      preparationSha256,
      omarSystemPurgeReceiptSha256:
        preparation.omar_system_purge_receipt_sha256,
      sourcePackages: signedSourcePackages,
      bootstrapDeploymentId: env.RAILWAY_DEPLOYMENT_ID
    }
  )
  if (!authorizationVerdict.ok) {
    throw new Error(
      `approved_recovery_authorization_rejected:${authorizationVerdict.failures.join(',')}`
    )
  }
  if (!String(authorization.authorization_id || '')) {
    throw new Error('approved_recovery_authorization_id_missing')
  }
  if (
    path.resolve(String(options.target || '')) !==
      path.resolve(String(preparation?.target_root || '')) ||
    path.resolve(String(options.target || '')) !==
      expectedTargetRoot
  ) throw new Error('approved_recovery_target_mismatch')
  const output = executionReceiptPath(manifest.release_id, env)
  const intentFile = executionIntentPath(manifest.release_id, env)
  const internalJournal = path.join(expectedTargetRoot, TRANSACTION_JOURNAL)
  let journalOutcome = ''
  if (fs.existsSync(internalJournal)) {
    // Inner restore recovery comes first, even if an older killed executor did
    // not manage to publish its outer intent. runRecovery reconciles the
    // private journal before it reads sources or builds a new plan.
    const signedExtractionRoots = signedSourcePackages.map((item) => path.join(
      expectedSourcePackageRoot,
      '.verified-extractions',
      item.sha256
    ))
    try {
      run({
        sources: signedExtractionRoots,
        target: expectedTargetRoot,
        execute: true,
        env: recoveryEnv,
        now,
        expectedInputInventorySha256: preparation.dry_run.input_inventory_sha256,
        expectedPlanSha256: preparation.dry_run.plan_sha256
      })
    } catch (error) {
      const message = String(error?.message || error)
      if (message.includes('pending recovery transaction rolled back')) {
        journalOutcome = 'rolled_back'
      } else if (message.includes('pending committed recovery finalized')) {
        journalOutcome = 'committed_finalized'
      } else throw error
    }
    if (!journalOutcome || fs.existsSync(internalJournal)) {
      throw new Error('approved_recovery_internal_journal_not_reconciled')
    }
    if (journalOutcome === 'committed_finalized' && !fs.existsSync(intentFile)) {
      throw new Error('approved_recovery_committed_restore_without_execution_intent')
    }
  }
  let intent
  let preparedSources = null
  let resumed = false

  if (fs.existsSync(intentFile)) {
    resumed = true
    const loaded = readExecutionIntent(intentFile, {
      manifest,
      authorizationSha256,
      preparationSha256,
      omarPurgeReceiptSha256: preparation.omar_system_purge_receipt_sha256,
      deploymentId: env.RAILWAY_DEPLOYMENT_ID,
      targetRoot: expectedTargetRoot,
      sourcePackages: signedSourcePackages,
      expectedSourceRoot: expectedSourcePackageRoot,
      inputInventorySha256: preparation.dry_run.input_inventory_sha256,
      planSha256: preparation.dry_run.plan_sha256
    })
    intent = loaded.intent
  } else {
    if (fs.existsSync(output)) {
      throw new Error('approved_recovery_execution_already_recorded_without_intent')
    }
    // The signed purge/preparation proves the earlier state, not the current
    // paused volume. Audit the actual live namespace again before source
    // extraction, plan creation, or durable execution intent publication.
    requireCleanLiveDebugAudit(expectedTargetRoot, captureLiveDebugResidue)
    preparedSources = prepareSources(signedSourcePackages, {
      expectedSourceRoot: expectedSourcePackageRoot
    })
    if (
      JSON.stringify(normalizedSourcePackages(preparedSources.observedPackages)) !==
        JSON.stringify(signedSourcePackages)
    ) throw new Error('approved_recovery_observed_source_packages_mismatch')
    const observedAuthorizationVerdict = verifyAuthorization(
      authorization,
      manifest,
      preparation,
      {
        preparationSha256,
        omarSystemPurgeReceiptSha256:
          preparation.omar_system_purge_receipt_sha256,
        sourcePackages: preparedSources.observedPackages,
        bootstrapDeploymentId: env.RAILWAY_DEPLOYMENT_ID
      }
    )
    if (!observedAuthorizationVerdict.ok) {
      throw new Error(
        `approved_recovery_observed_sources_not_authorized:` +
        observedAuthorizationVerdict.failures.join(',')
      )
    }
    const plan = buildPlan({
      sources: preparedSources.sourceRoots,
      target: options.target,
      env: recoveryEnv
    })
    if (
      plan.hashes?.input_inventory_sha256 !== preparation?.dry_run?.input_inventory_sha256 ||
      plan.hashes?.plan_sha256 !== preparation?.dry_run?.plan_sha256 ||
      plan.counts?.sources !== 1 ||
      plan.counts?.source_state_files !== signedSourcePackages[0]?.thread_state_file_count ||
      plan.counts?.source_history_files !== signedSourcePackages[0]?.thread_history_file_count ||
      plan.counts?.excluded_debug_files !== 0 ||
      plan.counts?.excluded_synthetic_files !== 0 ||
      plan.counts?.invalid_json_files !== 0 ||
      plan.counts?.invalid_schema_files !== 0 ||
      plan.counts?.queue_directories_touched !== 0 ||
      plan.validationPassed !== true
    ) throw new Error('approved_recovery_fresh_plan_mismatch')
    intent = executionIntentFrom({
      plan,
      manifest,
      authorization,
      authorizationSha256,
      preparationSha256,
      omarPurgeReceiptSha256: preparation.omar_system_purge_receipt_sha256,
      sourcePackages: preparedSources.observedPackages,
      env,
      now
    })
    writeIntent(intentFile, intent)
  }

  let committed = null

  // Reconciliation must precede this gate: a committed receipt plus leftover
  // journal is finalized first, while a rolled-back transaction is brought
  // back to its exact pre-write state. Then independently re-audit the live
  // target so a stale purge receipt or nested Omar/Omal residue cannot authorize
  // either a fresh execution or aggregate-receipt finalization.
  requireCleanLiveDebugAudit(expectedTargetRoot, captureLiveDebugResidue)

  if (fs.existsSync(intent.restore_receipt_path)) {
    // A valid underlying restore receipt is the commit point. Never invoke the
    // restore again after it exists; validate exact outputs and only finalize
    // the missing aggregate transition receipt.
    committed = validateCommittedRestoreForIntent(intent)
  }

  if (!committed) {
      if (!preparedSources) {
        preparedSources = prepareSources(signedSourcePackages, {
          expectedSourceRoot: expectedSourcePackageRoot
        })
        if (
          JSON.stringify(preparedSources.sourceRoots.map((item) => path.resolve(item))) !==
            JSON.stringify(intent.source_roots) ||
          JSON.stringify(normalizedSourcePackages(preparedSources.observedPackages)) !==
            JSON.stringify(signedSourcePackages)
        ) throw new Error('approved_recovery_resumed_source_packages_mismatch')
      }
      const finalPlan = buildPlan({
        sources: intent.source_roots,
        target: intent.target_root,
        env: recoveryEnv
      })
      if (!planMatchesIntent(finalPlan, intent)) {
        throw new Error('approved_recovery_resume_state_mismatch')
      }
      // Source verification and plan construction can be slow. Close the last
      // pre-write race window with the same canonical recursive audit.
      requireCleanLiveDebugAudit(expectedTargetRoot, captureLiveDebugResidue)
      run({
        sources: intent.source_roots,
        target: intent.target_root,
        execute: true,
        env: recoveryEnv,
        now: new Date(intent.restore_started_at_utc),
        expectedInputInventorySha256: intent.input_inventory_sha256,
        expectedPlanSha256: intent.plan_sha256
      })
      if (typeof dependencies.afterRestoreCommitted === 'function') {
        dependencies.afterRestoreCommitted({ intentFile, output, intent })
      }
      committed = validateCommittedRestoreForIntent(intent)
  }

  // The aggregate transition receipt must never coexist with an unresolved
  // inner restore journal. Recheck at the commit boundary as well as directly
  // after reconciliation so a leftover/reappearing journal stays fail-closed.
  if (fs.existsSync(internalJournal)) {
    throw new Error('approved_recovery_internal_journal_not_reconciled')
  }

  const expectedReceipt = executionReceiptFrom({
    manifest,
    authorization,
    authorizationSha256,
    preparationSha256,
    omarPurgeReceiptSha256: intent.omar_system_purge_receipt_sha256,
    executed: committed.receipt,
    sourcePackages: intent.source_packages,
    env,
    now: new Date(intent.restore_started_at_utc),
    targetRoot: expectedTargetRoot
  })
  let written
  if (fs.existsSync(output)) {
    const loaded = privateReceiptFile(output)
    if (!aggregateReceiptMatches(expectedReceipt, loaded.receipt, expectedTargetRoot)) {
      throw new Error('approved_recovery_existing_execution_receipt_mismatch')
    }
    written = { file: output, sha256: loaded.sha256 }
  } else {
    written = writeReceipt(output, expectedReceipt, { expectedTargetRoot })
  }
  if (typeof dependencies.afterExecutionReceiptWritten === 'function') {
    dependencies.afterExecutionReceiptWritten({ intentFile, output, intent })
  }
  removePrivateExecutionIntent(intentFile)
  return executionSummary(expectedReceipt, written.sha256, resumed)
}

if (require.main === module) {
  try {
    const receipt = executeApprovedRecovery(argsFrom(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`approved recovery refused: ${String(error?.message || error)}\n`)
    process.exit(1)
  }
}

module.exports = {
  argsFrom,
  executionReceiptFrom,
  executionIntentFrom,
  planMatchesIntent,
  aggregateReceiptMatches,
  requireCleanLiveDebugAudit,
  executeApprovedRecovery
}
