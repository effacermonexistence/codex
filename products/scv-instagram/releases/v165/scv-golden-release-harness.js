#!/usr/bin/env node
// Network-free regression gate for the immutable golden release controls.
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')
const {
  readReleaseManifest,
  verifyManifestShape,
  verifyArtifactFiles,
  verifyBookingPolicy,
  verifyBoundContracts,
  verifyModelPins,
  verifyEnvironment,
  fingerprintEnvironmentValue,
  applyPinnedModels,
  productionIdentityMatch,
  productionTestRouteVerdict,
  releaseMode,
  verifyExclusiveStagingTestRoute,
  verifyStagingIsolation,
  verifyProductionSafety,
  runGoldenReleaseVerification,
  hashFile
} = require(path.join(__dirname, 'scv-golden-release.js'))
const {
  activateFailClose,
  readFailClose,
  claimSingleAlertAttempt,
  completeSingleAlertAttempt,
  clearFailCloseWithVerifiedApproval
} = require(path.join(__dirname, 'scv-golden-fail-close.js'))
const {
  canonicalApprovalPayload,
  canonicalFailCloseClearPayload,
  verifyApprovalReceipt,
  SCV_RELEASE_APPROVAL_VERSION,
  SCV_FAIL_CLOSE_CLEAR_APPROVAL_VERSION
} = require(path.join(__dirname, 'scv-release-approval.js'))
const {
  assertSupportedReleaseMode
} = require(path.join(__dirname, 'scv-production-entry.js'))

const SCV_GOLDEN_RELEASE_HARNESS_VERSION =
  'scv-golden-release-harness-2026-07-26-v4-exclusive-e2e-owner'

function runHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail: String(detail || '').slice(0, 1000) })
  }

  const manifest = readReleaseManifest(__dirname)
  check('manifest_shape', verifyManifestShape(manifest).length === 0, verifyManifestShape(manifest).join(','))
  check('artifact_files_exact', verifyArtifactFiles(manifest, __dirname).length === 0, verifyArtifactFiles(manifest, __dirname).join(','))
  check('model_pins_dated', verifyModelPins(manifest).length === 0, verifyModelPins(manifest).join(','))
  check(
    'only_exact_gpt56_terra_alias_is_allowed_for_visible_chat',
    verifyModelPins({ ...manifest, models: { ...manifest.models, chat: 'gpt-5.6' } }).includes('model_pin_not_dated:chat')
  )
  check('booking_policy_locked', verifyBookingPolicy(manifest, __dirname).length === 0, verifyBookingPolicy(manifest, __dirname).join(','))
  check(
    'hardened_contracts_locked',
    verifyBoundContracts(manifest, __dirname).length === 0,
    verifyBoundContracts(manifest, __dirname).join(',')
  )
  check(
    'tool_schema_hash_locked',
    manifest.tool_schema?.file === 'codex-dm-output-schema.json' &&
      manifest.tool_schema?.sha256 === hashFile(path.join(__dirname, 'codex-dm-output-schema.json')),
    JSON.stringify(manifest.tool_schema)
  )

  const fakeSalt = 'test-salt'
  const fakeEnv = { SCV_TEST_VALUE: 'a', OPENAI_TEST_VALUE: 'b' }
  const fakeManifest = {
    environment: {
      salt: fakeSalt,
      expected_keys: Object.keys(fakeEnv).sort(),
      fingerprints: Object.fromEntries(
        Object.entries(fakeEnv).map(([key, value]) => [key, fingerprintEnvironmentValue(fakeSalt, key, value)])
      )
    }
  }
  check('environment_exact_match', verifyEnvironment(fakeManifest, fakeEnv).length === 0, verifyEnvironment(fakeManifest, fakeEnv).join(','))
  check(
    'environment_value_drift_rejected',
    verifyEnvironment(fakeManifest, { ...fakeEnv, SCV_TEST_VALUE: 'changed' }).includes('environment_value_mismatch:SCV_TEST_VALUE'),
    verifyEnvironment(fakeManifest, { ...fakeEnv, SCV_TEST_VALUE: 'changed' }).join(',')
  )
  check(
    'environment_unknown_key_rejected',
    verifyEnvironment(fakeManifest, { ...fakeEnv, SCV_NEW_UNAPPROVED: '1' }).includes('environment_key_unapproved:SCV_NEW_UNAPPROVED'),
    verifyEnvironment(fakeManifest, { ...fakeEnv, SCV_NEW_UNAPPROVED: '1' }).join(',')
  )
  check(
    'environment_missing_key_rejected',
    verifyEnvironment(fakeManifest, { SCV_TEST_VALUE: 'a' }).includes('environment_key_missing:OPENAI_TEST_VALUE'),
    verifyEnvironment(fakeManifest, { SCV_TEST_VALUE: 'a' }).join(',')
  )

  let localEntryRejected = false
  try {
    assertSupportedReleaseMode('local', {})
  } catch {
    localEntryRejected = true
  }
  check('production_entry_rejects_local_mode', localEntryRejected)
  const stagingEnv = {
    RAILWAY_ENVIRONMENT_NAME: 'scv-golden-staging',
    RAILWAY_PROJECT_ID: 'project',
    RAILWAY_ENVIRONMENT_ID: 'environment',
    RAILWAY_SERVICE_ID: 'service',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '1',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_STAGING_REAL_E2E_ARMED: '1',
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982',
    SCV_PERSIST_ROOT: '/data',
    SCV_RUNTIME_NAMESPACE: 'golden-harness'
  }
  const stagingEntry = assertSupportedReleaseMode('staging', stagingEnv, manifest)
  check('production_entry_accepts_explicit_railway_staging', stagingEntry.mode === 'staging')
  check(
    'staging_identity_isolated_from_production',
    verifyStagingIsolation(manifest, stagingEnv).length === 0,
    verifyStagingIsolation(manifest, stagingEnv).join(',')
  )

  const productionIdentity = manifest.deployment.railway_identity
  const spoofedStagingEnv = {
    RAILWAY_ENVIRONMENT_NAME: 'scv-golden-staging',
    RAILWAY_PROJECT_ID: productionIdentity.RAILWAY_PROJECT_ID,
    RAILWAY_ENVIRONMENT_ID: productionIdentity.RAILWAY_ENVIRONMENT_ID,
    RAILWAY_SERVICE_ID: productionIdentity.RAILWAY_SERVICE_ID,
    SCV_RELEASE_MODE: 'staging',
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '1',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_STAGING_REAL_E2E_ARMED: '1',
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982',
    SCV_PERSIST_ROOT: '/data',
    SCV_RUNTIME_NAMESPACE: 'golden-spoof'
  }
  check(
    'production_identity_forces_production_mode',
    releaseMode(spoofedStagingEnv, manifest) === 'production',
    JSON.stringify(productionIdentityMatch(manifest, spoofedStagingEnv))
  )
  let spoofedStagingEntryRejected = false
  try {
    assertSupportedReleaseMode(
      releaseMode(spoofedStagingEnv, manifest),
      spoofedStagingEnv,
      manifest
    )
  } catch (error) {
    spoofedStagingEntryRejected =
      String(error?.message || error).includes('production_release_environment_mismatch')
  }
  check('production_identity_cannot_enter_staging_entry', spoofedStagingEntryRejected)
  const spoofedIsolationFailures = verifyStagingIsolation(manifest, spoofedStagingEnv)
  check(
    'staging_rejects_production_environment_id',
    spoofedIsolationFailures.includes('staging_cannot_use_production_environment_id'),
    spoofedIsolationFailures.join(',')
  )
  check(
    'staging_rejects_production_service_id',
    spoofedIsolationFailures.includes('staging_cannot_use_production_service_id'),
    spoofedIsolationFailures.join(',')
  )
  check(
    'partial_production_environment_identity_rejected',
    verifyStagingIsolation(manifest, {
      ...stagingEnv,
      RAILWAY_ENVIRONMENT_ID: productionIdentity.RAILWAY_ENVIRONMENT_ID
    }).includes('staging_cannot_use_production_environment_id')
  )
  check(
    'partial_production_service_identity_rejected',
    verifyStagingIsolation(manifest, {
      ...stagingEnv,
      RAILWAY_SERVICE_ID: productionIdentity.RAILWAY_SERVICE_ID
    }).includes('staging_cannot_use_production_service_id')
  )

  const productionOwnsTest = {
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '1',
    SCV_PAUSE_DEBUG_ACCOUNTS: '0',
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982'
  }
  const productionOwnsVerdict = productionTestRouteVerdict(productionOwnsTest)
  check(
    'production_test_allowlist_blocks_staging_ownership',
    productionOwnsVerdict.can_reply_to_test_account === true &&
      verifyExclusiveStagingTestRoute(productionOwnsTest).ok === false,
    JSON.stringify(productionOwnsVerdict)
  )
  const productionExcludesTest = {
    SCV_PAUSE_ALL: '0',
    SCV_PAUSE_NON_TEST: '0',
    SCV_PAUSE_DEBUG_ACCOUNTS: '1',
    SCV_DEBUG_ACCOUNT_USERNAMES: 'omar.system,omar_system,omarsystem,omar system,omal.system,omal_system,omalsystem,omal system',
    SCV_DEBUG_ACCOUNT_CONTACT_IDS: '1537753982',
    SCV_PURGE_TEST_USERNAMES: 'omar.system,omar_system,omarsystem,omar system,omal.system,omal_system,omalsystem,omal system',
    SCV_PURGE_TEST_CONTACT_IDS: '1537753982'
  }
  const productionExcludesVerdict =
    productionTestRouteVerdict(productionExcludesTest)
  check(
    'production_exclusion_allows_single_staging_owner',
    productionExcludesVerdict.can_reply_to_test_account === false &&
      verifyExclusiveStagingTestRoute(productionExcludesTest).ok === true,
    JSON.stringify(productionExcludesVerdict)
  )
  check(
    'production_exclusion_keeps_real_accounts_flowing',
    productionTestRouteVerdict(productionExcludesTest, 'real.lead', '2002').can_reply_to_test_account === true
  )
  const productionSafetyEnv = {
    ...productionExcludesTest,
    SCV_RELEASE_PHASE: 'active',
    SCV_PURGE_TEST_ACCOUNT_ON_STARTUP: '0',
    SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE: '1',
    SCV_HOLD_STALE_BACKLOG_MS: String(15 * 60 * 1000),
    SCV_RECOVERY_CUTOVER_AT: '2026-08-19T00:00:00.000Z',
    SCV_AUTO_RECOVERY_ENABLED: '0',
    SCV_AUTO_RECOVERY_MAX_ENQUEUES_PER_TICK: '1',
    SCV_MANYCHAT_INPUT_SWEEP: '0',
    SCV_INBOUND_AUTH_REQUIRED: '1',
    SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1',
    SCV_MANYCHAT_INGRESS_SECRET: 'i'.repeat(32),
    SCV_ADMIN_AUTH_REQUIRED: '1',
    SCV_ADMIN_SHARED_SECRET: 'a'.repeat(32),
    SCV_LEGACY_INTERNAL_QUEUE_HTTP: '0'
  }
  check('production_safety_contract_accepts_real-flow_debug-isolation', verifyProductionSafety(productionSafetyEnv).length === 0)
  check(
    'production_safety_contract_rejects_non_test_pause',
    verifyProductionSafety({ ...productionSafetyEnv, SCV_PAUSE_NON_TEST: '1' }).includes('production_must_not_pause_real_accounts')
  )
  check(
    'safe_unarmed_staging_must_be_pause_all',
    verifyStagingIsolation(manifest, {
      ...stagingEnv,
      SCV_STAGING_REAL_E2E_ARMED: '0',
      SCV_PAUSE_ALL: '1'
    }).length === 0
  )

  const pinnedEnv = {}
  applyPinnedModels(manifest, pinnedEnv)
  check('chat_model_applied', pinnedEnv.OPENAI_DM_MODEL === manifest.models.chat, JSON.stringify(pinnedEnv))
  check('intent_model_applied', pinnedEnv.OPENAI_INTENT_MODEL === manifest.models.intent, JSON.stringify(pinnedEnv))
  check('primary_asr_applied', pinnedEnv.SCV_TRANSCRIBE_MODEL === manifest.models.asr_primary, JSON.stringify(pinnedEnv))
  check('secondary_asr_applied', pinnedEnv.SCV_TRANSCRIBE_SECONDARY_MODEL === manifest.models.asr_secondary, JSON.stringify(pinnedEnv))
  check('model_identity_enforcement_applied', pinnedEnv.SCV_ENFORCE_OPENAI_MODEL_IDENTITY === '1', JSON.stringify(pinnedEnv))

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-golden-release-harness-'))
  const latchEnv = {
    SCV_ROOT: tempRoot,
    SCV_RELEASE_MODE: 'local',
    SCV_RUNTIME_NAMESPACE: 'harness'
  }
  try {
    const first = activateFailClose({
      env: latchEnv,
      root: tempRoot,
      releaseId: manifest.release_id,
      releaseFingerprint: manifest.content_fingerprint_sha256,
      failedChecks: ['harness_failure']
    })
    check('fail_close_created', first.created === true, JSON.stringify(first))
    check('fail_close_persistent', readFailClose({ env: latchEnv, root: tempRoot }).active === true)
    const firstClaim = claimSingleAlertAttempt({ env: latchEnv, root: tempRoot })
    const secondClaim = claimSingleAlertAttempt({ env: latchEnv, root: tempRoot })
    check('single_alert_first_claim', firstClaim.claimed === true, JSON.stringify(firstClaim))
    check(
      'single_alert_second_denied_while_lease_active',
      secondClaim.claimed === false && secondClaim.reason === 'alert_attempt_in_progress',
      JSON.stringify(secondClaim)
    )
    const completed = completeSingleAlertAttempt({
      env: latchEnv,
      root: tempRoot,
      claimId: firstClaim.claim_id,
      delivered: true,
      channel: 'harness'
    })
    check('single_alert_delivery_recorded', completed.alert?.delivery_status === 'delivered', JSON.stringify(completed))
    const terminalClaim = claimSingleAlertAttempt({ env: latchEnv, root: tempRoot })
    check(
      'single_alert_terminal_state_prevents_duplicate',
      terminalClaim.claimed === false && terminalClaim.reason === 'alert_terminal',
      JSON.stringify(terminalClaim)
    )
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }

  let missingProductionPersistenceRejected = false
  try {
    readFailClose({
      env: {
        SCV_RELEASE_MODE: 'production',
        SCV_RUNTIME_NAMESPACE: 'prod'
      },
      root: tempRoot
    })
  } catch (error) {
    missingProductionPersistenceRejected =
      String(error?.message || error).includes('production_persistent_control_root_missing')
  }
  check('production_ephemeral_fail_close_forbidden', missingProductionPersistenceRejected)

  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-golden-alert-lease-'))
  const leaseEnv = {
    SCV_ROOT: leaseRoot,
    SCV_RELEASE_MODE: 'local',
    SCV_RUNTIME_NAMESPACE: 'lease-harness'
  }
  try {
    activateFailClose({
      env: leaseEnv,
      root: leaseRoot,
      releaseId: manifest.release_id,
      releaseFingerprint: manifest.content_fingerprint_sha256,
      failedChecks: ['lease_recovery_harness']
    })
    const abandoned = claimSingleAlertAttempt({
      env: leaseEnv,
      root: leaseRoot,
      leaseMs: 1000,
      nowMs: 1000
    })
    const recovered = claimSingleAlertAttempt({
      env: leaseEnv,
      root: leaseRoot,
      leaseMs: 1000,
      nowMs: 2501
    })
    check('abandoned_alert_claim_created', abandoned.claimed === true, JSON.stringify(abandoned))
    check(
      'stale_alert_claim_recovered',
      recovered.claimed === true && recovered.claim_id !== abandoned.claim_id,
      JSON.stringify(recovered)
    )
    const completed = completeSingleAlertAttempt({
      env: leaseEnv,
      root: leaseRoot,
      claimId: recovered.claim_id,
      delivered: false,
      error: 'harness terminal failure'
    })
    check(
      'recovered_alert_claim_terminalized',
      completed.completion_applied === true && completed.alert?.delivery_status === 'failed',
      JSON.stringify(completed)
    )
  } finally {
    fs.rmSync(leaseRoot, { recursive: true, force: true })
  }

  const learningRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-golden-learning-'))
  try {
    for (const file of ['dm_darwin_state.json', 'dm_hinton_state.json']) {
      fs.copyFileSync(path.join(__dirname, file), path.join(learningRoot, file))
    }
    const before = {
      darwin: hashFile(path.join(learningRoot, 'dm_darwin_state.json')),
      hinton: hashFile(path.join(learningRoot, 'dm_hinton_state.json'))
    }
    const child = spawnSync(process.execPath, ['-e', `
      const sidecar = require(${JSON.stringify(path.join(__dirname, 'dm-learning-sidecar.js'))})
      const result = sidecar.recordLearningOutcome(
        { instagram_username: 'golden.harness', text: 'booking form date' },
        'send_failure'
      )
      if (result.mutation_adopted !== false || result.immutable_golden_release !== true) process.exit(3)
    `], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SCV_ROOT: learningRoot,
        SCV_IMMUTABLE_GOLDEN_RELEASE: '1'
      }
    })
    const after = {
      darwin: hashFile(path.join(learningRoot, 'dm_darwin_state.json')),
      hinton: hashFile(path.join(learningRoot, 'dm_hinton_state.json'))
    }
    check('adaptive_policy_freeze_child_passes', child.status === 0, child.stderr)
    check('darwin_state_immutable', before.darwin === after.darwin, JSON.stringify({ before, after }))
    check('hinton_state_immutable', before.hinton === after.hinton, JSON.stringify({ before, after }))
  } finally {
    fs.rmSync(learningRoot, { recursive: true, force: true })
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const approvalPhase = String(manifest.deployment?.release_phase || '')
  const unsignedApproval = {
    schema: SCV_RELEASE_APPROVAL_VERSION,
    action: 'promote_scv_golden_release_to_production',
    release_id: manifest.release_id,
    content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    release_manifest_sha256: manifest.release_manifest_sha256,
    release_phase: approvalPhase,
    full_regression_sha256: '1'.repeat(64),
    real_e2e_sha256: '2'.repeat(64),
    manychat_handoff_sha256: '3'.repeat(64),
    april_tone_sha256: '4'.repeat(64),
    recovery_preparation_sha256: '',
    recovery_execution_sha256:
      approvalPhase === 'active'
        ? String(manifest.deployment?.recovery_transition?.execution_receipt_sha256 || '')
        : '',
    approval_id: 'scv-ben-approval-1234567890abcdef12345678',
    approved_by: 'Ben',
    approved_at_utc: '2026-07-25T12:00:00.000Z',
    reason: 'harness verification'
  }
  const signedApproval = {
    ...unsignedApproval,
    signature_base64: crypto.sign(null, Buffer.from(canonicalApprovalPayload(unsignedApproval)), privateKey).toString('base64')
  }
  const approvalOk = verifyApprovalReceipt(
    signedApproval,
    manifest,
    publicKey.export({ type: 'spki', format: 'pem' })
  )
  check(
    'approval_signature_valid',
    approvalOk.ok === true && approvalOk.signature_valid === true,
    JSON.stringify(approvalOk)
  )
  const approvalTampered = verifyApprovalReceipt(
    { ...signedApproval, reason: 'tampered' },
    manifest,
    publicKey.export({ type: 'spki', format: 'pem' })
  )
  check(
    'approval_tamper_rejected',
    approvalTampered.ok === false &&
      approvalTampered.signature_valid === false &&
      approvalTampered.failures.length === 1 &&
      approvalTampered.failures[0] === 'approval_signature_invalid',
    JSON.stringify(approvalTampered)
  )
  const approvalIdTampered = verifyApprovalReceipt(
    { ...signedApproval, approval_id: 'scv-ben-approval-abcdefabcdefabcdefabcdef' },
    manifest,
    publicKey.export({ type: 'spki', format: 'pem' })
  )
  check(
    'approval_id_tamper_rejected',
    approvalIdTampered.ok === false &&
      approvalIdTampered.signature_valid === false &&
      approvalIdTampered.failures.length === 1 &&
      approvalIdTampered.failures[0] === 'approval_signature_invalid',
    JSON.stringify(approvalIdTampered)
  )

  const clearRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-golden-clear-'))
  const clearEnv = {
    SCV_ROOT: clearRoot,
    SCV_RELEASE_MODE: 'local',
    SCV_RUNTIME_NAMESPACE: 'clear-harness'
  }
  try {
    activateFailClose({
      env: clearEnv,
      root: clearRoot,
      releaseId: manifest.release_id,
      releaseFingerprint: manifest.content_fingerprint_sha256,
      failedChecks: ['clear_harness_failure']
    })
    const latch = readFailClose({ env: clearEnv, root: clearRoot })
    const unsignedClear = {
      schema: SCV_FAIL_CLOSE_CLEAR_APPROVAL_VERSION,
      action: 'clear_scv_golden_fail_close',
      release_id: latch.release_id,
      release_fingerprint_sha256: latch.release_fingerprint_sha256,
      latch_activated_at_utc: latch.activated_at_utc,
      approved_by: 'Ben',
      approved_at_utc: '2026-07-25T12:00:00.000Z',
      reason: 'harness clear verification'
    }
    const signedClear = {
      ...unsignedClear,
      signature_base64: crypto.sign(
        null,
        Buffer.from(canonicalFailCloseClearPayload(unsignedClear)),
        privateKey
      ).toString('base64')
    }
    let tamperedRejected = false
    try {
      clearFailCloseWithVerifiedApproval({
        env: clearEnv,
        root: clearRoot,
        approval: { ...signedClear, reason: 'tampered' },
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
      })
    } catch {
      tamperedRejected = true
    }
    check('fail_close_tampered_clear_rejected', tamperedRejected)
    const cleared = clearFailCloseWithVerifiedApproval({
      env: clearEnv,
      root: clearRoot,
      approval: signedClear,
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' })
    })
    check('fail_close_signed_clear_accepted', cleared.cleared === true, JSON.stringify(cleared))
  } finally {
    fs.rmSync(clearRoot, { recursive: true, force: true })
  }

  const docker = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8')
  check(
    'docker_node_digest_pinned',
    /node:20\.20\.2-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0/.test(docker),
    docker.slice(0, 300)
  )
  const railway = JSON.parse(fs.readFileSync(path.join(__dirname, 'railway.json'), 'utf8'))
  check('railway_dockerfile_builder', railway.build?.builder === 'DOCKERFILE', JSON.stringify(railway))
  check('railway_health_gate', railway.deploy?.healthcheckPath === '/readyz', JSON.stringify(railway))
  check('railway_single_replica', railway.deploy?.multiRegionConfig?.['us-west2']?.numReplicas === 1, JSON.stringify(railway))
  check('railway_failed_candidate_no_restart', railway.deploy?.restartPolicyType === 'NEVER', JSON.stringify(railway))

  const verification = runGoldenReleaseVerification({
    root: __dirname,
    env: {},
    verifyEnvironmentValues: false,
    verifyRailway: false,
    verifyFiles: true,
    verifyStaging: false
  })
  check('whole_release_local_verification', verification.ok === true, JSON.stringify(verification.failures))

  return {
    ok: failures.length === 0,
    locked: failures.length === 0,
    version: SCV_GOLDEN_RELEASE_HARNESS_VERSION,
    release_id: manifest.release_id,
    content_fingerprint_sha256: manifest.content_fingerprint_sha256,
    checked,
    failures,
    network: false,
    production_mutation: false
  }
}

if (require.main === module) {
  try {
    const receipt = runHarness()
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
    if (!receipt.ok) process.exit(1)
  } catch (error) {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`)
    process.exit(1)
  }
}

module.exports = {
  SCV_GOLDEN_RELEASE_HARNESS_VERSION,
  runScvGoldenReleaseHarness: runHarness,
  runHarness
}
