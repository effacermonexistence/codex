#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  isSingleReleaseRequested
} = require(path.join(__dirname, 'scv-single-release.js'))
const SINGLE_RELEASE_REQUESTED = isSingleReleaseRequested(process.env)
const {
  runScvContractHarnessSelfTest,
  SCV_CONTRACT_HARNESS_LOCK_VERSION
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  runScvCriticalRouteHarness
} = require(path.join(__dirname, 'scv-critical-route-harness.js'))
const {
  runStateQuarantineSweep
} = require(path.join(__dirname, 'scv-state-quarantine.js'))
const {
  runScvDriftMonitorOnce,
  driftStatusLogSummary
} = require(path.join(__dirname, 'scv-drift-monitor.js'))
const {
  sanitizeMachineLogObject,
  errorMetrics
} = require(path.join(__dirname, 'scv-machine-log.js'))

function machineLog(value, error = false) {
  const line = JSON.stringify(sanitizeMachineLogObject(value))
  if (error) console.error(line)
  else console.log(line)
}
const {
  runScvDeliveryPacingHarnessSelfTest,
  SCV_DELIVERY_PACING_LOCK_VERSION,
  pacingSettingsFromEnv
} = require(path.join(__dirname, 'scv-delivery-pacing.js'))
const {
  runScvHardHarnessLock,
  SCV_HARD_HARNESS_LOCK_VERSION
} = require(path.join(__dirname, 'scv-hard-harness-lock.js'))
const {
  runScvOutboxOrderHarness
} = require(path.join(__dirname, 'scv-outbox-order-harness.js'))
const {
  purgeTestAccountDebugState
} = require(path.join(__dirname, 'scv-test-account-purge.js'))
const {
  pauseAll
} = require(path.join(__dirname, 'scv-pause-gate.js'))
let runScvGoldenSnapshotGuard
let runScvImmutableDriftFirewall
if (!SINGLE_RELEASE_REQUESTED) {
  ;({ runScvGoldenSnapshotGuard } = require(path.join(
    __dirname, 'scv-golden-snapshot-guard.js'
  )))
  ;({ runScvImmutableDriftFirewall } = require(path.join(
    __dirname, 'scv-immutable-drift-firewall.js'
  )))
}
const {
  safeRuntimeNamespace,
  runScvRuntimeNamespaceGuard
} = require(path.join(__dirname, 'scv-runtime-namespace.js'))
const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  SCV_CONTROL_EPOCH,
  CONTROL_RECEIPT_VERSION,
  SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
  migrateAllThreadStates,
  quarantinePreSingleControlOutbox
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  SCV_SINGLE_CONTROL_HARNESS_LOCK_VERSION,
  runScvSingleControlPlaneHarness
} = require(path.join(__dirname, 'scv-single-control-plane-harness.js'))
const {
  SCV_CLOSED_TRANSITION_HARNESS_VERSION,
  runClosedTransitionHarness
} = require(path.join(__dirname, 'scv-closed-transition-contract-harness.js'))
const {
  SCV_CLOSED_LIFECYCLE_HARNESS_VERSION,
  runScvClosedLifecycleHarness
} = require(path.join(__dirname, 'scv-closed-lifecycle-harness.js'))
const {
  SCV_API_PROMPT_AUTHORITY_LOCK_VERSION,
  apiPromptAuthorityReceipt
} = require(path.join(__dirname, 'scv-api-prompt-authority.js'))
const {
  SCV_EXECUTED_PATH_STARTUP_GATE_VERSION,
  runExecutedPathStartupSelfTest
} = require(path.join(__dirname, 'scv-executed-path-startup-gate.js'))
const {
  SCV_BOOKING_POLICY_VERSION,
  BOOKING_POLICY_FINGERPRINT,
  MINIMUM_LEAD_DAYS,
  MAXIMUM_HORIZON_DAYS
} = require(path.join(__dirname, 'scv-booking-policy.js'))
const {
  DEBUG_USERNAMES_CSV,
  DEBUG_CONTACT_IDS_CSV
} = require(path.join(__dirname, 'scv-debug-identity.js'))
const { requireCloudRuntimeSafety } = require(path.join(__dirname, 'scv-cloud-runtime-safety.js'))
const {
  stagingCapabilityBoundary,
  filterServiceDefinitions
} = require(path.join(__dirname, 'scv-staging-capability-boundary.js'))

const ROOT = __dirname
process.env.SCV_ROOT = process.env.SCV_ROOT || ROOT
process.env.SCV_CLOUD_RUNTIME = process.env.SCV_CLOUD_RUNTIME || '1'
process.env.SCV_BIND_HOST = process.env.SCV_BIND_HOST || '0.0.0.0'
process.env.SCV_INTERNAL_BIND_HOST = process.env.SCV_INTERNAL_BIND_HOST || '127.0.0.1'
process.env.SCV_INBOUND_PORT = process.env.SCV_INBOUND_PORT || process.env.PORT || '3000'
process.env.SCV_OUTBOUND1_PORT = process.env.SCV_OUTBOUND1_PORT || '3101'
process.env.SCV_OUTBOUND2_PORT = process.env.SCV_OUTBOUND2_PORT || '3102'
process.env.SCV_OUTBOUND1_URL = process.env.SCV_OUTBOUND1_URL || `http://127.0.0.1:${process.env.SCV_OUTBOUND1_PORT}/`
process.env.SCV_OUTBOUND2_URL = process.env.SCV_OUTBOUND2_URL || `http://127.0.0.1:${process.env.SCV_OUTBOUND2_PORT}/`
process.env.SCV_DEBUG_ACCOUNT_USERNAMES = process.env.SCV_DEBUG_ACCOUNT_USERNAMES || DEBUG_USERNAMES_CSV
process.env.SCV_DEBUG_ACCOUNT_CONTACT_IDS = process.env.SCV_DEBUG_ACCOUNT_CONTACT_IDS || DEBUG_CONTACT_IDS_CSV
process.env.SCV_PURGE_TEST_USERNAMES = process.env.SCV_PURGE_TEST_USERNAMES || DEBUG_USERNAMES_CSV
process.env.SCV_PURGE_TEST_CONTACT_IDS = process.env.SCV_PURGE_TEST_CONTACT_IDS || DEBUG_CONTACT_IDS_CSV
process.env.SCV_FAST_TARGET_USERNAMES = process.env.SCV_FAST_TARGET_USERNAMES || process.env.SCV_PURGE_TEST_USERNAMES
process.env.SCV_FAST_TARGET_CONTACT_IDS = process.env.SCV_FAST_TARGET_CONTACT_IDS || process.env.SCV_PURGE_TEST_CONTACT_IDS
if (!String(process.env.SCV_PAUSE_DEBUG_ACCOUNTS || '').trim()) {
  process.env.SCV_PAUSE_DEBUG_ACCOUNTS =
    String(process.env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production' ||
    String(process.env.SCV_RELEASE_MODE || '').trim().toLowerCase() === 'production'
      ? '1'
      : '0'
}
process.env.SCV_FAST_TARGET_DELAY_MULTIPLIER = process.env.SCV_FAST_TARGET_DELAY_MULTIPLIER || '0'
process.env.SCV_FAST_TARGET_FORCE_ZERO = process.env.SCV_FAST_TARGET_FORCE_ZERO || '1'
process.env.SCV_NON_FAST_INITIAL_DELAY_MIN_MS = process.env.SCV_NON_FAST_INITIAL_DELAY_MIN_MS || String(3 * 60 * 1000)
process.env.SCV_NON_FAST_INITIAL_DELAY_MAX_MS = process.env.SCV_NON_FAST_INITIAL_DELAY_MAX_MS || String(12 * 60 * 1000)
process.env.SCV_BUBBLE_GAP_MIN_MS = process.env.SCV_BUBBLE_GAP_MIN_MS || String(1500)
process.env.SCV_BUBBLE_GAP_MAX_MS = process.env.SCV_BUBBLE_GAP_MAX_MS || String(22 * 1000)
process.env.SCV_ALLOW_DELIVERY_PACING_ENV_OVERRIDE = '0'
process.env.SCV_CONTRACT_HARNESS_LOCKED = process.env.SCV_CONTRACT_HARNESS_LOCKED || '1'
process.env.SCV_FAIL_CLOSED_RECOVERY = process.env.SCV_FAIL_CLOSED_RECOVERY || '1'
process.env.SCV_RUNTIME_NAMESPACE = safeRuntimeNamespace(process.env.SCV_RUNTIME_NAMESPACE || 'prod')

// This is the last process-local gate before any state file is created or child
// worker is spawned. single_release_v1 re-verifies the descriptor inventory,
// exact Railway target, /data namespace, and inherited entrypoint proof here.
const cloudRuntimeSafety = requireCloudRuntimeSafety({ env: process.env })

// An authenticated exact-instance SSH capture uses this per-process identity to
// prove that a restart actually replaced the supervised runtime. Only the hash
// of a fresh nonce is persisted; the nonce itself and no secrets leave memory.
const PROCESS_IDENTITY_FILE = '/tmp/scv-process-identity.json'
const processIdentity = {
  schema: 'scv-active-process-identity-2026-08-20-v1',
  release_protocol: String(process.env.SCV_RELEASE_PROTOCOL || 'legacy_golden'),
  deployment_id: String(process.env.RAILWAY_DEPLOYMENT_ID || ''),
  release_id: String(process.env.SCV_RELEASE_ID || ''),
  content_fingerprint_sha256: String(process.env.SCV_CONTENT_FINGERPRINT || ''),
  release_manifest_sha256: String(process.env.SCV_RELEASE_MANIFEST_SHA256 || ''),
  boot_nonce_sha256: crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
  pid: process.pid,
  started_at_utc: new Date().toISOString()
}
fs.writeFileSync(PROCESS_IDENTITY_FILE, `${JSON.stringify(processIdentity)}\n`, {
  encoding: 'utf8', mode: 0o600, flag: 'w'
})
fs.chmodSync(PROCESS_IDENTITY_FILE, 0o600)

console.log(JSON.stringify({
  event: 'scv_cloud_runtime_safety',
  ...cloudRuntimeSafety
}))

const dirs = [
  'inbox',
  'outbox',
  'reactbox',
  'reactbox_done',
  'reactbox_failed',
  'logs',
  'thread-state',
  'thread-state_pre_migration',
  'thread-history',
  'thread-state_quarantine_contaminated',
  'thread-history_quarantine_contaminated',
  'inbox_quarantine_superseded',
  'inbox_quarantine_deadletter',
  'outbox_quarantine_stale',
  'outbox_quarantine_non_authoritative',
  'outbox_quarantine_contract_harness',
  'outbox_quarantine_failed',
  'outbox_human_agent_required',
  'outbox_quarantine_pre_single_control',
  'outbox-idempotency',
  'control-events',
  'control-decisions',
  'control-locks',
  'form-submissions',
  // v122 persistence P1 (2026-08-30): these four runtime surfaces were created
  // by workers under ephemeral /app and lost on every deploy/restart —
  // accepted-unverified boundary observations, in-flight delivery publications,
  // and both corrupt quarantines must survive restarts like every other queue.
  'accepted-unverified-boundary-pending',
  'accepted-unverified-delivery-publications',
  'inbox_quarantine_corrupt',
  'outbox_quarantine_corrupt_adoption'
]

// Persist all queue/thread state on the Railway volume (/data): without this every
// deploy/restart wiped pending outbox replies and thread history (ephemeral /app),
// silently killing queued replies (confirmed live: christian.bolanos.35977).
const {
  ensurePersistentStateDirs,
  persistentStateRequired
} = require(path.join(__dirname, 'scv-persistent-state.js'))
if (SINGLE_RELEASE_REQUESTED) {
  console.log(JSON.stringify({
    event: 'scv_single_release_startup_identity_check',
    ok: cloudRuntimeSafety.ok === true,
    protocol: String(cloudRuntimeSafety.protocol || ''),
    release_id: String(cloudRuntimeSafety.release_id || ''),
    content_fingerprint_sha256:
      String(cloudRuntimeSafety.content_fingerprint_sha256 || ''),
    release_manifest_sha256:
      String(cloudRuntimeSafety.release_manifest_sha256 || ''),
    legacy_firewall_invoked: false,
    legacy_snapshot_guard_invoked: false
  }))
} else {
  console.log(JSON.stringify({
    event: 'scv_immutable_drift_firewall_startup_check',
    ...runScvImmutableDriftFirewall({ root: ROOT })
  }))
  console.log(JSON.stringify({
    event: 'scv_golden_snapshot_guard_startup_check',
    ...runScvGoldenSnapshotGuard({ root: ROOT })
  }))
}
const persistentState = ensurePersistentStateDirs(
  ROOT,
  dirs,
  process.env.SCV_PERSIST_ROOT || '/data',
  process.env.SCV_RUNTIME_NAMESPACE,
  { required: persistentStateRequired(process.env), env: process.env }
)
process.env.SCV_PERSISTENCE_READY = persistentState.persistent ? '1' : '0'
machineLog({ event: 'scv_persistent_state', ...persistentState })
machineLog({
  event: 'scv_runtime_namespace_guard_startup_check',
  ...runScvRuntimeNamespaceGuard({ appRoot: ROOT, dirs, persistRoot: process.env.SCV_PERSIST_ROOT || '/data', namespace: process.env.SCV_RUNTIME_NAMESPACE })
})

let apiPromptAuthority = null
try {
  apiPromptAuthority = apiPromptAuthorityReceipt({ root: ROOT })
  console.log(JSON.stringify({
    event: 'scv_api_prompt_authority_startup_check',
    ...apiPromptAuthority
  }))
  console.log(JSON.stringify({
    event: 'scv_single_control_state_migration',
    ...migrateAllThreadStates(ROOT)
  }))
  machineLog({
    event: 'scv_single_control_stale_outbox_quarantine',
    ...quarantinePreSingleControlOutbox(ROOT)
  })
  if (!SINGLE_RELEASE_REQUESTED) {
    console.log(JSON.stringify({
      event: 'scv_closed_transition_harness_self_test',
      ...runClosedTransitionHarness()
    }))
    console.log(JSON.stringify({
      event: 'scv_closed_lifecycle_harness_self_test',
      ...runScvClosedLifecycleHarness()
    }))
    console.log(JSON.stringify({
      event: 'scv_single_control_harness_self_test',
      ...runScvSingleControlPlaneHarness()
    }))
    // The sealed single-release is regression-tested before the descriptor is
    // written. Only the legacy path runs isolated harnesses during live boot.
    try {
      console.log(JSON.stringify({
        event: 'scv_executed_path_startup_self_test',
        ...runExecutedPathStartupSelfTest({
          timeoutMs: Number(process.env.SCV_EXECUTED_PATH_SELFTEST_TIMEOUT_MS) || 90000
        })
      }))
    } catch (executedPathSelfTestErr) {
      machineLog({
        event: 'scv_executed_path_startup_self_test_failed',
        gate_version: SCV_EXECUTED_PATH_STARTUP_GATE_VERSION,
        ...errorMetrics(executedPathSelfTestErr)
      }, true)
      throw executedPathSelfTestErr
    }
  }
  machineLog({
    event: 'scv_state_quarantine_startup_sweep',
    ...runStateQuarantineSweep()
  })
  if (!SINGLE_RELEASE_REQUESTED) {
    console.log(JSON.stringify({
      event: 'scv_contract_harness_self_test',
      ...runScvContractHarnessSelfTest()
    }))
    console.log(JSON.stringify({
      event: 'scv_critical_route_harness_self_test',
      ...runScvCriticalRouteHarness()
    }))
    console.log(JSON.stringify({
      event: 'scv_delivery_pacing_harness_self_test',
      ...runScvDeliveryPacingHarnessSelfTest()
    }))
    console.log(JSON.stringify({
      event: 'scv_hard_harness_lock_self_test',
      ...runScvHardHarnessLock()
    }))
    console.log(JSON.stringify({
      event: 'scv_outbox_order_harness_self_test',
      ...runScvOutboxOrderHarness()
    }))
  } else {
    console.log(JSON.stringify({
      event: 'scv_single_release_presealed_regressions',
      ok: true,
      live_boot_harnesses_started: 0,
      release_id: String(process.env.SCV_RELEASE_ID || '')
    }))
  }
  machineLog({
    event: 'scv_drift_monitor_startup_check',
    ...driftStatusLogSummary(runScvDriftMonitorOnce())
  })
} catch (err) {
  machineLog({
    event: 'scv_startup_harness_self_test_failed',
    lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION,
    ...errorMetrics(err)
  }, true)
  process.exit(1)
}


// Deploy/restart must not silently erase an in-flight Omar.system debug turn.
// Reset is an explicit operator action AND requires the global hold barrier. A
// stale/queued Railway deployment can carry an older purge flag, so opt-in alone
// is not enough: destructive reset is legal only while every sender is paused.
const purgeTestAccountRequested = String(process.env.SCV_PURGE_TEST_ACCOUNT_ON_STARTUP || '0').trim() === '1'
const destructiveDebugResetBarrierActive = pauseAll(process.env)
if (purgeTestAccountRequested && destructiveDebugResetBarrierActive) {
  try { machineLog(purgeTestAccountDebugState({ root: ROOT })) } catch (err) { machineLog({ event: 'scv_test_account_chat_purge_failed', ...errorMetrics(err) }, true) }
} else {
  console.log(JSON.stringify({
    event: 'scv_test_account_chat_purge_skipped',
    reason: purgeTestAccountRequested
      ? 'pause_all_required_for_destructive_debug_reset'
      : 'explicit_opt_in_required',
    env_flag: 'SCV_PURGE_TEST_ACCOUNT_ON_STARTUP',
    purge_requested: purgeTestAccountRequested,
    pause_all: destructiveDebugResetBarrierActive
  }))
}

const serviceDefinitions = [
  ['outbound-scv2', 'outbound-scv2.js'],
  ['outbound-scv1', 'outbound-scv1.js'],
  ['inbox-worker', 'inbox-worker.js'],
  ['outbox-worker', 'outbox-worker.js'],
  ['reaction-worker', 'reaction-worker.js'],
  ['drift-monitor', 'scv-drift-monitor.js', ['--loop']],
  ['auto-recovery', 'scv-auto-recovery-loop.js', ['--loop']],
  ['manychat-input-sweep', 'scv-manychat-input-sweep.js', ['--loop']],
  ['gmail-form-reader', 'scv-gmail-form-reader.js', ['--loop']],
  ['capability-canary', 'scv-capability-canary.js', ['--loop']],
  ['disk-guardian', 'scv-disk-guardian.js', ['--loop']],
  ['inbound-scv', 'inbound-scv.js']
]
const stagingCapability = stagingCapabilityBoundary(process.env)
const services = filterServiceDefinitions(serviceDefinitions, process.env)
  .filter(([label]) => {
  if (label === 'auto-recovery') return String(process.env.SCV_AUTO_RECOVERY_ENABLED || '0').trim() === '1'
  if (label === 'manychat-input-sweep') return String(process.env.SCV_MANYCHAT_INPUT_SWEEP || '0').trim() === '1'
  return true
  })

const SUPERVISOR_STATUS_FILE = path.join(ROOT, 'logs', 'supervisor-status.json')
const { ScvProcessSupervisor } = require(path.join(__dirname, 'scv-process-supervisor.js'))
const supervisor = new ScvProcessSupervisor({
  root: ROOT,
  services,
  statusFile: SUPERVISOR_STATUS_FILE
})

machineLog({
  event: 'scv_cloud_start',
  root: ROOT,
  release_protocol: String(process.env.SCV_RELEASE_PROTOCOL || 'legacy_golden'),
  release_id: String(process.env.SCV_RELEASE_ID || ''),
  content_fingerprint_sha256:
    String(process.env.SCV_CONTENT_FINGERPRINT || ''),
  release_manifest_sha256:
    String(process.env.SCV_RELEASE_MANIFEST_SHA256 || ''),
  runtime_namespace: process.env.SCV_RUNTIME_NAMESPACE,
  inbound_port: process.env.SCV_INBOUND_PORT,
  outbound1_port: process.env.SCV_OUTBOUND1_PORT,
  outbound2_port: process.env.SCV_OUTBOUND2_PORT,
  manychat_api_key_present: !!process.env.MANYCHAT_API_KEY,
  openai_api_key_present: !!process.env.OPENAI_API_KEY,
  staging_capability_mode: stagingCapability.capability_mode,
  staging_capability_boundary_ok: stagingCapability.ok,
  external_workers_allowed: stagingCapability.external_workers_allowed,
  gmail_reader_allowed: stagingCapability.gmail_reader_allowed,
  supervised_service_labels: services.map(([label]) => label),
  codex_bin_present: fs.existsSync(process.env.CODEX_BIN || '/Applications/Codex.app/Contents/Resources/codex'),
  fast_target_usernames: process.env.SCV_FAST_TARGET_USERNAMES,
  fast_target_contact_ids: process.env.SCV_FAST_TARGET_CONTACT_IDS,
  fast_target_force_zero: process.env.SCV_FAST_TARGET_FORCE_ZERO,
  delivery_pacing_lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
  hard_harness_lock_version: SCV_HARD_HARNESS_LOCK_VERSION,
  single_control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
  single_control_source: SCV_SINGLE_CONTROL_SOURCE,
  single_control_epoch: SCV_CONTROL_EPOCH,
  single_control_harness_lock_version: SCV_SINGLE_CONTROL_HARNESS_LOCK_VERSION,
  control_receipt_version: CONTROL_RECEIPT_VERSION,
  payload_bound_receipts: true,
  closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
  closed_transition_harness_version: SCV_CLOSED_TRANSITION_HARNESS_VERSION,
  closed_lifecycle_harness_version: SCV_CLOSED_LIFECYCLE_HARNESS_VERSION,
  booking_policy_version: SCV_BOOKING_POLICY_VERSION,
  booking_policy_fingerprint: BOOKING_POLICY_FINGERPRINT,
  booking_minimum_lead_days: MINIMUM_LEAD_DAYS,
  booking_maximum_horizon_days: MAXIMUM_HORIZON_DAYS,
  api_prompt_authority_lock_version: SCV_API_PROMPT_AUTHORITY_LOCK_VERSION,
  api_prompt_authority_source_sha256: apiPromptAuthority?.source_sha256 || {},
  api_prompt_authority_visible_system_sha256: apiPromptAuthority?.visible_system_sha256 || '',
  persistent_internal_retry: true,
  transport_semantic_mutation: false,
  fail_closed_recovery: String(process.env.SCV_FAIL_CLOSED_RECOVERY || '1').trim() !== '0',
  auto_recovery_enabled: String(process.env.SCV_AUTO_RECOVERY_ENABLED || '0').trim() === '1',
  manychat_input_sweep_enabled: String(process.env.SCV_MANYCHAT_INPUT_SWEEP || '0').trim() === '1',
  pause_all: String(process.env.SCV_PAUSE_ALL || '0').trim() === '1',
  pause_non_test: String(process.env.SCV_PAUSE_NON_TEST || '0').trim() === '1',
  pause_debug_accounts: String(process.env.SCV_PAUSE_DEBUG_ACCOUNTS || '0').trim() === '1',
  persistence_ready: process.env.SCV_PERSISTENCE_READY === '1',
  delivery_pacing_settings: pacingSettingsFromEnv(process.env),
  contract_harness_locked: process.env.SCV_CONTRACT_HARNESS_LOCKED,
  contract_harness_lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION
})

supervisor.startAll()

function shutdown(signal) {
  supervisor.shutdown(signal)
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
