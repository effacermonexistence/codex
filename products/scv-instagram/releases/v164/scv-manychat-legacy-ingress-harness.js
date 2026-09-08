#!/usr/bin/env node
const assert = require('assert')
const { spawn } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  OFFICIAL_MANYCHAT_SUBSCRIBER_INFO_URL,
  legacyFallbackEligible,
  parseProviderInteractionTimestamp,
  replayKeyForProof,
  replayLedgerPath,
  reserveReplayLedger,
  commitReplayLedger,
  releaseReplayReservation,
  withReplayLock,
  verifyLegacyManyChatIngress
} = require('./scv-manychat-legacy-ingress.js')

const NOW = Date.parse('2026-08-21T12:00:00.000Z')
const API_KEY = 'manychat-test-key-never-written-to-ledger'
const CONTACT_ID = '1537753982'
const tempRoots = []
let checked = 0

function ok(condition, label, detail = '') {
  assert.ok(condition, `${label}${detail ? `:${detail}` : ''}`)
  checked++
}

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-manychat-legacy-ingress-'))
  tempRoots.push(root)
  return root
}

function replayProof() {
  const proof = {
    contact_id: CONTACT_ID,
    normalized_text: 'Hello there',
    provider_interaction_at: new Date(NOW - 30_000).toISOString(),
    provider_interaction_source: 'ig_last_interaction',
    provider_response_sha256: crypto.createHash('sha256').update('provider-proof').digest('hex')
  }
  const replayKey = replayKeyForProof(proof)
  return {
    ...proof,
    expected_message_id: `legacy-manychat-${replayKey.slice(0, 32)}`
  }
}

function seedStalePrimary(root, proof, nowMs = NOW) {
  const replayKey = replayKeyForProof(proof)
  const ledgerFile = replayLedgerPath(root, replayKey)
  const lockFile = `${ledgerFile}.lock`
  const recoveryFile = `${lockFile}.stale-recovery`
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 })
  fs.writeFileSync(lockFile, `${JSON.stringify({ stale_test_owner: true })}\n`, { mode: 0o600 })
  const staleTime = new Date(nowMs - 5_000)
  fs.utimesSync(lockFile, staleTime, staleTime)
  return { ledgerFile, lockFile, recoveryFile }
}

function writeBarrier(file) {
  fs.writeFileSync(file, `${process.pid}\n`, { flag: 'wx', mode: 0o600 })
}

function waitForBarrierSync(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`barrier_timeout:${path.basename(file)}`)
    Atomics.wait(sleeper, 0, 0, 20)
  }
}

async function waitForPath(file, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!fs.existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`path_timeout:${path.basename(file)}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function startLockWorker(config) {
  const encoded = Buffer.from(JSON.stringify(config)).toString('base64url')
  const child = spawn(process.execPath, [__filename, '--replay-lock-worker', encoded], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const done = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      let result = null
      try { result = stdout.trim() ? JSON.parse(stdout.trim()) : null } catch {}
      resolve({ code, signal, result, stdout, stderr })
    })
  })
  return { child, done }
}

async function replayLockWorkerMain(encoded) {
  const config = JSON.parse(Buffer.from(String(encoded || ''), 'base64url').toString('utf8'))
  const replayLockOptions = {}
  if (config.coordinatorMarker) {
    replayLockOptions.afterRecoveryCoordinatorAcquired = () => {
      writeBarrier(config.coordinatorMarker)
      if (config.crashAfterCoordinator) process.exit(86)
      if (config.coordinatorRelease) waitForBarrierSync(config.coordinatorRelease)
    }
  }
  if (config.removedMarker) {
    replayLockOptions.afterStalePrimaryRemoved = () => {
      writeBarrier(config.removedMarker)
      if (config.removedRelease) waitForBarrierSync(config.removedRelease)
    }
  }
  const result = reserveReplayLedger(config.root, config.proof, {
    nowMs: config.nowMs,
    pendingTtlMs: config.pendingTtlMs,
    replayLockOptions
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

function treeEntries(root, prefix = '') {
  if (!fs.existsSync(root)) return []
  const output = []
  for (const name of fs.readdirSync(root).sort()) {
    const relative = prefix ? path.join(prefix, name) : name
    const file = path.join(root, name)
    output.push(relative)
    if (fs.lstatSync(file).isDirectory()) {
      output.push(...treeEntries(file, relative))
    }
  }
  return output
}

function legacyRequest(extraHeaders = {}) {
  return {
    headers: {
      'user-agent': 'ManyChat',
      ...extraHeaders
    }
  }
}

function legacyBody(overrides = {}) {
  return {
    contact_id: CONTACT_ID,
    instagram_username: 'omar.system',
    message_text: 'Hello there',
    thread_id: CONTACT_ID,
    user_id: CONTACT_ID,
    ...overrides
  }
}

function providerData(overrides = {}) {
  return {
    id: CONTACT_ID,
    ig_username: 'omar.system',
    last_input_text: 'Hello there',
    ig_last_interaction: new Date(NOW - 30_000).toISOString(),
    ...overrides
  }
}

function responseFor(data, options = {}) {
  const raw = options.raw === undefined
    ? JSON.stringify({ status: 'success', data })
    : String(options.raw)
  const headers = new Headers({
    'content-type': 'application/json',
    ...(options.headers || {})
  })
  return new Response(raw, { status: options.status || 200, headers })
}

function verifiedFetch(data, capture = {}) {
  return async (url, options = {}) => {
    capture.calls = Number(capture.calls || 0) + 1
    capture.url = String(url)
    capture.authorization = String(options?.headers?.Authorization || '')
    capture.method = String(options?.method || '')
    capture.redirect = String(options?.redirect || '')
    return responseFor(data)
  }
}

async function verify(root, overrides = {}) {
  return verifyLegacyManyChatIngress({
    req: legacyRequest(),
    body: legacyBody(),
    root,
    env: {
      MANYCHAT_API_KEY: API_KEY,
      SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1'
    },
    nowMs: NOW,
    maxAgeMs: 60_000,
    futureSkewMs: 5_000,
    timeoutMs: 100,
    maxResponseBytes: 8 * 1024,
    fetchImpl: verifiedFetch(providerData()),
    ...overrides
  })
}

async function main() {
  ok(
    legacyFallbackEligible(legacyRequest(), { required: true, env: {} }) === false,
    'compatibility_defaults_fail_closed'
  )
  ok(
    legacyFallbackEligible(legacyRequest(), {
      required: true,
      env: { SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '0' }
    }) === false,
    'compatibility_zero_is_disabled'
  )
  ok(
    legacyFallbackEligible(legacyRequest(), {
      required: true,
      env: { SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1' }
    }) === true,
    'missing_token_is_compatibility_candidate'
  )
  ok(
    legacyFallbackEligible(legacyRequest({ 'x-scv-ingress-token': 'wrong-token' }), {
      required: true,
      env: { SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1' }
    }) === false,
    'supplied_wrong_token_never_falls_back'
  )
  ok(
    legacyFallbackEligible(legacyRequest({ authorization: 'Bearer wrong-token' }), {
      required: true,
      env: { SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1' }
    }) === false,
    'supplied_wrong_bearer_never_falls_back'
  )
  ok(
    legacyFallbackEligible(legacyRequest({ authorization: 'Basic wrong-token' }), {
      required: true,
      env: { SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1' }
    }) === false,
    'supplied_non_bearer_credential_never_falls_back'
  )
  ok(
    legacyFallbackEligible(legacyRequest({ 'x-scv-ingress-token': '' }), {
      required: true,
      env: { SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1' }
    }) === false,
    'present_blank_ingress_header_never_falls_back'
  )
  ok(
    legacyFallbackEligible(legacyRequest({ authorization: '   ' }), {
      required: true,
      env: { SCV_LEGACY_MANYCHAT_INGRESS_COMPAT: '1' }
    }) === false,
    'present_blank_authorization_never_falls_back'
  )

  const spoofUaRoot = tempRoot()
  let spoofUaFetches = 0
  const spoofUa = await verify(spoofUaRoot, {
    req: legacyRequest({ 'user-agent': 'curl/8.7.1' }),
    fetchImpl: async () => {
      spoofUaFetches++
      return responseFor(providerData())
    }
  })
  ok(spoofUa.ok === false && spoofUa.reason === 'legacy_manychat_user_agent_invalid', 'spoof_user_agent_rejected')
  ok(spoofUaFetches === 0, 'spoof_user_agent_never_reaches_provider')
  ok(treeEntries(spoofUaRoot).length === 0, 'spoof_user_agent_has_zero_disk_mutation')

  const spoofBodyRoot = tempRoot()
  let spoofBodyFetches = 0
  const spoofBody = await verify(spoofBodyRoot, {
    body: { ...legacyBody(), attacker_field: '1' },
    fetchImpl: async () => {
      spoofBodyFetches++
      return responseFor(providerData())
    }
  })
  ok(spoofBody.ok === false && spoofBody.reason === 'legacy_manychat_body_shape_invalid', 'spoof_body_rejected')
  ok(spoofBodyFetches === 0, 'spoof_body_never_reaches_provider')
  ok(treeEntries(spoofBodyRoot).length === 0, 'spoof_body_has_zero_disk_mutation')

  const wrongBodyFieldRoot = tempRoot()
  const wrongBodyField = legacyBody()
  wrongBodyField.last_input_text = wrongBodyField.message_text
  delete wrongBodyField.message_text
  const wrongBodyFieldResult = await verify(wrongBodyFieldRoot, { body: wrongBodyField })
  ok(wrongBodyFieldResult.ok === false && wrongBodyFieldResult.reason === 'legacy_manychat_body_shape_invalid',
    'archive_body_requires_message_text_not_last_input_text')

  const identityRoot = tempRoot()
  const identityMismatch = await verify(identityRoot, {
    body: legacyBody({ user_id: '1537753983' })
  })
  ok(identityMismatch.ok === false && identityMismatch.reason === 'legacy_manychat_identity_mismatch', 'conflicting_body_identity_rejected')
  ok(treeEntries(identityRoot).length === 0, 'identity_mismatch_has_zero_disk_mutation')

  const providerMismatchRoot = tempRoot()
  const providerMismatch = await verify(providerMismatchRoot, {
    fetchImpl: verifiedFetch(providerData({ last_input_text: 'Different current input' }))
  })
  ok(providerMismatch.ok === false && providerMismatch.reason === 'legacy_manychat_provider_text_mismatch', 'provider_text_mismatch_rejected')
  ok(treeEntries(providerMismatchRoot).length === 0, 'provider_text_mismatch_has_zero_disk_mutation')

  const wrongProviderFieldRoot = tempRoot()
  const wrongProviderData = providerData()
  wrongProviderData.message_text = wrongProviderData.last_input_text
  delete wrongProviderData.last_input_text
  const wrongProviderField = await verify(wrongProviderFieldRoot, {
    fetchImpl: verifiedFetch(wrongProviderData)
  })
  ok(wrongProviderField.ok === false && wrongProviderField.reason === 'legacy_manychat_provider_text_mismatch',
    'provider_proof_requires_last_input_text_not_message_text')

  const usernameMismatchRoot = tempRoot()
  const usernameMismatch = await verify(usernameMismatchRoot, {
    fetchImpl: verifiedFetch(providerData({ ig_username: 'different.user' }))
  })
  ok(usernameMismatch.ok === false && usernameMismatch.reason === 'legacy_manychat_provider_username_mismatch', 'provider_username_mismatch_rejected')
  ok(treeEntries(usernameMismatchRoot).length === 0, 'provider_username_mismatch_has_zero_disk_mutation')

  const staleRoot = tempRoot()
  const stale = await verify(staleRoot, {
    fetchImpl: verifiedFetch(providerData({
      ig_last_interaction: new Date(NOW - 60_001).toISOString()
    }))
  })
  ok(stale.ok === false && stale.reason === 'legacy_manychat_provider_interaction_stale', 'stale_provider_interaction_rejected')
  ok(treeEntries(staleRoot).length === 0, 'stale_provider_interaction_has_zero_disk_mutation')

  const futureRoot = tempRoot()
  const future = await verify(futureRoot, {
    fetchImpl: verifiedFetch(providerData({
      ig_last_interaction: new Date(NOW + 5_001).toISOString()
    }))
  })
  ok(future.ok === false && future.reason === 'legacy_manychat_provider_interaction_time_future', 'future_provider_interaction_rejected')
  ok(treeEntries(futureRoot).length === 0, 'future_provider_interaction_has_zero_disk_mutation')

  ok(parseProviderInteractionTimestamp('2026-08-21T04:59:30-07:00') === NOW - 30_000,
    'rfc3339_offset_timestamp_supported')
  ok(parseProviderInteractionTimestamp(String(Math.floor((NOW - 30_000) / 1000))) === NOW - 30_000,
    'epoch_seconds_timestamp_supported')
  ok(parseProviderInteractionTimestamp(String(NOW - 30_000)) === NOW - 30_000,
    'epoch_milliseconds_timestamp_supported')
  ok(Number.isNaN(parseProviderInteractionTimestamp('2026-08-21 11:59:30')),
    'ambiguous_unzoned_timestamp_rejected')

  for (const [label, timestampField, timestampValue] of [
    ['last_interaction_alias', 'last_interaction', Math.floor((NOW - 30_000) / 1000)],
    ['last_interaction_at_alias', 'last_interaction_at', String(NOW - 30_000)]
  ]) {
    const root = tempRoot()
    const data = providerData()
    delete data.ig_last_interaction
    data[timestampField] = timestampValue
    const result = await verify(root, { fetchImpl: verifiedFetch(data) })
    ok(result.ok === true, `${label}_supported`)
    releaseReplayReservation(result, { nowMs: NOW })
  }

  const timeoutRoot = tempRoot()
  const timeoutStarted = Date.now()
  const timeout = await verify(timeoutRoot, {
    timeoutMs: 25,
    fetchImpl: () => new Promise(() => {})
  })
  ok(timeout.ok === false && timeout.reason === 'legacy_manychat_lookup_timeout', 'provider_timeout_rejected')
  ok(Date.now() - timeoutStarted < 500, 'provider_timeout_is_bounded')
  ok(treeEntries(timeoutRoot).length === 0, 'provider_timeout_has_zero_disk_mutation')

  const oversizedRoot = tempRoot()
  const oversized = await verify(oversizedRoot, {
    maxResponseBytes: 1_024,
    fetchImpl: async () => responseFor({}, {
      raw: JSON.stringify({ status: 'success', data: providerData(), padding: 'x'.repeat(2_000) }),
      headers: { 'content-length': '4096' }
    })
  })
  ok(oversized.ok === false && oversized.reason === 'legacy_manychat_provider_unavailable', 'oversized_provider_response_rejected')
  ok(treeEntries(oversizedRoot).length === 0, 'oversized_provider_response_has_zero_disk_mutation')

  const validRoot = tempRoot()
  const capture = {}
  const valid = await verify(validRoot, {
    body: legacyBody({ message_text: '  Hello\n\tthere  ' }),
    fetchImpl: verifiedFetch(providerData({ last_input_text: 'Hello there' }), capture)
  })
  ok(valid.ok === true && valid.reason === 'legacy_manychat_provider_proof_accepted', 'valid_provider_proof_admitted_once')
  ok(capture.calls === 1, 'valid_provider_lookup_exactly_once')
  ok(capture.url.startsWith(`${OFFICIAL_MANYCHAT_SUBSCRIBER_INFO_URL}?subscriber_id=`), 'provider_lookup_locked_to_official_endpoint')
  ok(capture.authorization === `Bearer ${API_KEY}`, 'provider_lookup_uses_expected_bearer')
  ok(capture.method === 'GET' && capture.redirect === 'error', 'provider_lookup_forbids_redirects')
  ok(fs.existsSync(valid.ledger_file), 'valid_provider_proof_writes_replay_ledger')
  ok((fs.statSync(valid.ledger_file).mode & 0o777) === 0o600, 'replay_ledger_is_private_mode')
  const ledgerRaw = fs.readFileSync(valid.ledger_file, 'utf8')
  ok(!ledgerRaw.includes(CONTACT_ID), 'replay_ledger_omits_raw_contact_id')
  ok(!ledgerRaw.includes('omar.system'), 'replay_ledger_omits_raw_username')
  ok(!ledgerRaw.includes('Hello there'), 'replay_ledger_omits_raw_text')
  ok(!ledgerRaw.includes(API_KEY), 'replay_ledger_omits_api_key')
  ok(JSON.parse(ledgerRaw).status === 'pending', 'provider_proof_only_reserves_pending_ledger')
  ok(!fs.existsSync(path.join(validRoot, 'inbox')), 'provider_gate_never_writes_inbox')
  ok(!fs.existsSync(path.join(validRoot, 'thread-state')), 'provider_gate_never_writes_thread_state')
  ok(!fs.existsSync(path.join(validRoot, 'thread-history')), 'provider_gate_never_writes_thread_history')

  const concurrentPending = await verify(validRoot, {
    body: legacyBody({ message_text: 'Hello there' }),
    fetchImpl: verifiedFetch(providerData({ last_input_text: 'Hello there' }))
  })
  ok(concurrentPending.ok === false && concurrentPending.status === 409 &&
    concurrentPending.reason === 'legacy_manychat_replay_pending', 'concurrent_pending_rejected')
  const committed = commitReplayLedger(valid, {
    nowMs: NOW,
    durableIngressIdentity: 'inbox/legacy-manychat-test.json'
  })
  ok(committed.ok === true, 'pending_ledger_commits_after_durable_ingress')
  const replay = await verify(validRoot)
  ok(replay.ok === false && replay.status === 409 && replay.reason === 'legacy_manychat_replay',
    'accepted_replay_never_reopens')

  const releasedRoot = tempRoot()
  const failedAfterProof = await verify(releasedRoot)
  ok(failedAfterProof.ok === true, 'fault_setup_claimed_pending_reservation')
  const released = releaseReplayReservation(failedAfterProof, { nowMs: NOW })
  ok(released.ok === true && released.released === true,
    'failure_immediately_after_proof_releases_pending_reservation')
  const safeRetry = await verify(releasedRoot)
  ok(safeRetry.ok === true, 'released_fault_retries_exactly_once')
  ok(commitReplayLedger(safeRetry, { nowMs: NOW, durableIngressIdentity: 'inbox/retry.json' }).ok,
    'safe_retry_committed')
  const safeRetryReplay = await verify(releasedRoot)
  ok(safeRetryReplay.ok === false && safeRetryReplay.reason === 'legacy_manychat_replay',
    'safe_retry_cannot_be_admitted_twice')

  const crashRoot = tempRoot()
  const crashedPending = await verify(crashRoot, { pendingTtlMs: 1_000 })
  ok(crashedPending.ok === true, 'crash_setup_left_pending_reservation')
  const reclaimed = await verify(crashRoot, {
    nowMs: NOW + 2_000,
    pendingTtlMs: 1_000,
    durableIngressProbe: () => false,
    fetchImpl: verifiedFetch(providerData({
      ig_last_interaction: new Date(NOW - 30_000).toISOString()
    }))
  })
  ok(reclaimed.ok === true && reclaimed.reservation_id !== crashedPending.reservation_id,
    'stale_crash_without_ingress_is_safely_reclaimed')
  commitReplayLedger(reclaimed, { nowMs: NOW + 2_000, durableIngressIdentity: 'inbox/reclaimed.json' })

  const durableCrashRoot = tempRoot()
  const durableCrash = await verify(durableCrashRoot, { pendingTtlMs: 1_000 })
  const durableInboxName = `${durableCrash.expected_message_id}.json`
  const durableInboxDir = path.join(durableCrashRoot, 'inbox')
  const durableInboxFile = path.join(durableInboxDir, durableInboxName)
  fs.mkdirSync(durableInboxDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(durableInboxFile, JSON.stringify({
    message_id: durableCrash.expected_message_id,
    legacy_manychat_replay_key: durableCrash.replay_key
  }) + '\n', { mode: 0o600 })
  const reconciled = await verify(durableCrashRoot, {
    nowMs: NOW + 2_000,
    pendingTtlMs: 1_000,
    durableIngressProbe: (context) =>
      context.expected_message_id === durableCrash.expected_message_id &&
      context.replay_key === durableCrash.replay_key &&
      fs.existsSync(durableInboxFile),
    fetchImpl: verifiedFetch(providerData({
      ig_last_interaction: new Date(NOW - 30_000).toISOString()
    }))
  })
  ok(reconciled.ok === false && reconciled.reason === 'legacy_manychat_replay',
    'crash_after_durable_ingress_reconciles_to_accepted')
  const reconciledLedgerRaw = fs.readFileSync(durableCrash.ledger_file, 'utf8')
  const reconciledLedger = JSON.parse(reconciledLedgerRaw)
  ok(
    reconciledLedger.durable_ingress_sha256 ===
      crypto.createHash('sha256').update(Buffer.from(durableInboxName)).digest('hex'),
    'crash_reconciliation_binds_exact_durable_inbox_filename'
  )
  ok(reconciledLedger.reconciled_from_durable_ingress === true,
    'crash_reconciliation_records_durable_origin')
  ok(!reconciledLedgerRaw.includes(CONTACT_ID),
    'crash_reconciled_ledger_omits_raw_contact_id')
  ok(!reconciledLedgerRaw.includes('omar.system'),
    'crash_reconciled_ledger_omits_raw_username')
  ok(!reconciledLedgerRaw.includes('Hello there'),
    'crash_reconciled_ledger_omits_raw_text')
  ok(!reconciledLedgerRaw.includes(API_KEY),
    'crash_reconciled_ledger_omits_api_key')

  const raceRoot = tempRoot()
  const racers = await Promise.all(Array.from({ length: 8 }, () => verify(raceRoot)))
  ok(racers.filter((result) => result.ok).length === 1,
    'concurrent_duplicates_have_single_reservation_owner')
  ok(racers.filter((result) => !result.ok && result.reason === 'legacy_manychat_replay_pending').length === 7,
    'concurrent_duplicates_are_all_rejected_while_pending')
  releaseReplayReservation(racers.find((result) => result.ok), { nowMs: NOW })

  const ownerReleaseRoot = tempRoot()
  const ownerReleaseFile = path.join(ownerReleaseRoot, 'owner-release-ledger.json')
  let originalOwnerInode = ''
  let replacementInode = ''
  const replacementNonce = crypto.randomBytes(32).toString('hex')
  const ownerReleaseResult = withReplayLock(ownerReleaseFile, NOW, 1_000, () => {
    const lockFile = `${ownerReleaseFile}.lock`
    originalOwnerInode = String(fs.statSync(lockFile, { bigint: true }).ino)
    fs.writeFileSync(lockFile, `${JSON.stringify({
      schema: 'scv-manychat-legacy-replay-owner-2026-08-22-v1',
      kind: 'primary',
      nonce: replacementNonce,
      replacement_test_owner: true
    })}\n`, { mode: 0o600 })
    replacementInode = String(fs.statSync(lockFile, { bigint: true }).ino)
    return 'callback-complete'
  })
  ok(ownerReleaseResult.locked === true && ownerReleaseResult.value === 'callback-complete',
    'owner_callback_completed_after_lock_record_replacement')
  ok(originalOwnerInode === replacementInode,
    'replacement_test_preserves_inode_to_exercise_nonce_guard')
  ok(fs.existsSync(`${ownerReleaseFile}.lock`) &&
    fs.readFileSync(`${ownerReleaseFile}.lock`, 'utf8').includes(replacementNonce),
  'owner_release_does_not_unlink_same_inode_replacement')

  const inodeReleaseFile = path.join(ownerReleaseRoot, 'inode-release-ledger.json')
  let heldOriginalFd
  let originalRaw = ''
  let originalInode = ''
  let recreatedInode = ''
  const inodeReleaseResult = withReplayLock(inodeReleaseFile, NOW, 1_000, () => {
    const lockFile = `${inodeReleaseFile}.lock`
    originalRaw = fs.readFileSync(lockFile, 'utf8')
    heldOriginalFd = fs.openSync(lockFile, 'r')
    originalInode = String(fs.fstatSync(heldOriginalFd, { bigint: true }).ino)
    fs.unlinkSync(lockFile)
    fs.writeFileSync(lockFile, originalRaw, { flag: 'wx', mode: 0o600 })
    recreatedInode = String(fs.statSync(lockFile, { bigint: true }).ino)
    return 'callback-complete'
  })
  try {
    ok(inodeReleaseResult.locked === true && originalInode !== recreatedInode,
      'replacement_test_changes_inode_while_reusing_owner_nonce')
    ok(fs.existsSync(`${inodeReleaseFile}.lock`) &&
      fs.readFileSync(`${inodeReleaseFile}.lock`, 'utf8') === originalRaw,
    'owner_release_does_not_unlink_same_nonce_new_inode_replacement')
  } finally {
    if (heldOriginalFd !== undefined) fs.closeSync(heldOriginalFd)
  }

  const staleRaceRoot = tempRoot()
  const staleRaceProof = replayProof()
  const staleRacePaths = seedStalePrimary(staleRaceRoot, staleRaceProof)
  const coordinatorMarker = path.join(staleRaceRoot, 'coordinator-acquired.barrier')
  const coordinatorRelease = path.join(staleRaceRoot, 'coordinator-release.barrier')
  const removedMarker = path.join(staleRaceRoot, 'stale-primary-removed.barrier')
  const removedRelease = path.join(staleRaceRoot, 'stale-primary-release.barrier')
  const firstReclaimer = startLockWorker({
    root: staleRaceRoot,
    proof: staleRaceProof,
    nowMs: NOW,
    pendingTtlMs: 1_000,
    coordinatorMarker,
    coordinatorRelease,
    removedMarker,
    removedRelease
  })
  await waitForPath(coordinatorMarker)
  ok(fs.existsSync(staleRacePaths.recoveryFile),
    'first_stale_reclaimer_owns_exclusive_recovery_coordinator')

  const secondReclaimer = startLockWorker({
    root: staleRaceRoot,
    proof: staleRaceProof,
    nowMs: NOW,
    pendingTtlMs: 1_000
  })
  const secondReclaimerExit = await secondReclaimer.done
  ok(secondReclaimerExit.code === 0 &&
    secondReclaimerExit.result?.ok === false &&
    secondReclaimerExit.result?.reason === 'legacy_manychat_replay_pending',
  'second_stale_reclaimer_loses_normally_on_coordinator_eexist', secondReclaimerExit.stderr)

  writeBarrier(coordinatorRelease)
  await waitForPath(removedMarker)
  ok(!fs.existsSync(staleRacePaths.lockFile) && fs.existsSync(staleRacePaths.recoveryFile),
    'recovery_coordinator_is_held_across_missing_primary_window')

  const ordinaryContender = startLockWorker({
    root: staleRaceRoot,
    proof: staleRaceProof,
    nowMs: NOW,
    pendingTtlMs: 1_000
  })
  const ordinaryContenderExit = await ordinaryContender.done
  ok(ordinaryContenderExit.code === 0 &&
    ordinaryContenderExit.result?.ok === false &&
    ordinaryContenderExit.result?.reason === 'legacy_manychat_replay_pending',
  'ordinary_contender_loses_normally_while_recovery_coordinator_exists', ordinaryContenderExit.stderr)

  writeBarrier(removedRelease)
  const firstReclaimerExit = await firstReclaimer.done
  const staleRaceResults = [
    firstReclaimerExit.result,
    secondReclaimerExit.result,
    ordinaryContenderExit.result
  ]
  ok(firstReclaimerExit.code === 0 && firstReclaimerExit.result?.ok === true,
    'coordinator_owner_reacquires_primary_and_reserves', firstReclaimerExit.stderr)
  ok(staleRaceResults.filter((result) => result?.ok === true).length === 1,
    'two_stale_reclaimers_and_ordinary_contender_have_exactly_one_reservation')
  ok(!fs.existsSync(staleRacePaths.recoveryFile),
    'successful_reclaimer_releases_its_own_coordinator')
  releaseReplayReservation(firstReclaimerExit.result, { nowMs: NOW })

  const crashedCoordinatorRoot = tempRoot()
  const crashedCoordinatorProof = replayProof()
  const crashedCoordinatorPaths = seedStalePrimary(crashedCoordinatorRoot, crashedCoordinatorProof)
  const crashedCoordinatorMarker = path.join(crashedCoordinatorRoot, 'crashed-coordinator.barrier')
  const crashedCoordinator = startLockWorker({
    root: crashedCoordinatorRoot,
    proof: crashedCoordinatorProof,
    nowMs: NOW,
    pendingTtlMs: 1_000,
    coordinatorMarker: crashedCoordinatorMarker,
    crashAfterCoordinator: true
  })
  const crashedCoordinatorExit = await crashedCoordinator.done
  ok(crashedCoordinatorExit.code === 86 && fs.existsSync(crashedCoordinatorPaths.recoveryFile),
    'crashed_recovery_coordinator_remains_as_fail_closed_fence', crashedCoordinatorExit.stderr)
  const crashedCoordinatorBefore = fs.readFileSync(crashedCoordinatorPaths.recoveryFile, 'utf8')
  const ancientCoordinatorTime = new Date(NOW - 24 * 60 * 60 * 1_000)
  fs.utimesSync(crashedCoordinatorPaths.recoveryFile, ancientCoordinatorTime, ancientCoordinatorTime)

  const blockedDuplicates = await Promise.all([1, 2].map(() => startLockWorker({
    root: crashedCoordinatorRoot,
    proof: crashedCoordinatorProof,
    nowMs: NOW + 60_000,
    pendingTtlMs: 1_000
  }).done))
  ok(blockedDuplicates.every((entry) => entry.code === 0 &&
    entry.result?.ok === false && entry.result?.reason === 'legacy_manychat_replay_pending'),
  'duplicates_remain_fail_closed_behind_crashed_coordinator')
  ok(fs.existsSync(crashedCoordinatorPaths.recoveryFile) &&
    fs.readFileSync(crashedCoordinatorPaths.recoveryFile, 'utf8') === crashedCoordinatorBefore,
  'crashed_coordinator_is_never_automatically_reaped')
  ok(!fs.existsSync(crashedCoordinatorPaths.ledgerFile),
    'crashed_coordinator_never_allows_duplicate_ledger_reservation')

  const redirectRoot = tempRoot()
  const redirected = await verify(redirectRoot, {
    fetchImpl: async () => {
      const response = responseFor(providerData())
      Object.defineProperty(response, 'redirected', { value: true })
      Object.defineProperty(response, 'url', { value: 'https://attacker.invalid/steal' })
      return response
    }
  })
  ok(redirected.ok === false && redirected.reason === 'legacy_manychat_provider_unavailable',
    'redirected_or_wrong_final_url_is_rejected')

  const inboundSource = fs.readFileSync(path.join(__dirname, 'inbound-scv.js'), 'utf8')
  ok(inboundSource.includes("const legacyFallback = pathname === '/manychat/inbound' &&"),
    'legacy_fallback_is_locked_to_exact_manychat_path')
  ok(!inboundSource.includes("const legacyFallback = (pathname === '/'"),
    'root_route_cannot_open_legacy_fallback')

  console.log(JSON.stringify({
    ok: true,
    checked,
    lock: 'scv-manychat-legacy-ingress-harness-2026-08-21-v2'
  }))
}

const entrypoint = process.argv[2] === '--replay-lock-worker'
  ? replayLockWorkerMain(process.argv[3])
  : main()

entrypoint
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error)
    process.exitCode = 1
  })
  .finally(() => {
    if (process.argv[2] === '--replay-lock-worker') return
    for (const root of tempRoots) {
      try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
    }
  })
