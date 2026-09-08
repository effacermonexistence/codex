#!/usr/bin/env node
'use strict'

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  ATTESTATION_SCHEMA,
  PROCESS_IDENTITY_SCHEMA,
  SINGLE_RELEASE_SCHEMA,
  SINGLE_RELEASE_PROTOCOL,
  RAILWAY_CAPTURE_SOURCE,
  MANYCHAT_CAPTURE_SOURCE,
  STATE_SCAN_SCHEMA,
  STATE_LIVE_CAPTURE_SOURCE,
  STATE_RESTORED_CAPTURE_SOURCE,
  sha256,
  stableJson,
  releaseManifestBytes,
  expectedManyChatConfiguration,
  scanStableStateTree,
  buildStateScanReceipt,
  verifyExternalRuntimeAttestation
} = require('./scv-external-runtime-attestation.js')

const EXPECTATIONS_FILE = path.join(
  __dirname, 'SCV_EXTERNAL_RUNTIME_EXPECTATIONS.json'
)
const NOW_MS = Date.parse('2026-08-30T04:00:00.000Z')
const CAPTURED_AT = new Date(NOW_MS - 60 * 1000).toISOString()

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function fixtureDescriptor(expectationsBytes) {
  return {
    schema: SINGLE_RELEASE_SCHEMA,
    release_id: 'scv-instagram-single-test-v122',
    created_at_utc: '2026-08-30T03:30:00.000Z',
    canonical_behavior: 'instagram-dm-mid-april-2026',
    content_fingerprint_sha256: 'a'.repeat(64),
    railway: {
      project_id: '11111111-1111-4111-8111-111111111111',
      production: {
        environment_id: '22222222-2222-4222-8222-222222222222',
        service_id: '33333333-3333-4333-8333-333333333333'
      },
      staging: {
        environment_id: '44444444-4444-4444-8444-444444444444',
        service_id: '55555555-5555-4555-8555-555555555555'
      }
    },
    persistence: {
      root: '/data',
      production_namespace: 'prod',
      staging_namespace: 'single-staging-v122'
    },
    runtime: {
      node_version: 'v20.20.2',
      entrypoint: 'scv-single-release-entry.js',
      final_sender: 'outbound-scv2.js'
    },
    models: {
      visible_model: 'gpt-test',
      executor: 'responses_v1',
      reasoning_effort: 'medium',
      enforce_identity: '1'
    },
    files: [
      {
        path: 'SCV_EXTERNAL_RUNTIME_EXPECTATIONS.json',
        sha256: sha256(expectationsBytes),
        bytes: expectationsBytes.length
      },
      {
        path: 'scv-external-runtime-attestation.js',
        sha256: 'b'.repeat(64),
        bytes: 1
      }
    ]
  }
}

function railwayLaneFixture(lane, descriptor, expectations, manifestSha256) {
  const deploymentId = lane === 'production'
    ? '66666666-6666-4666-8666-666666666666'
    : '77777777-7777-4777-8777-777777777777'
  const target = descriptor.railway[lane]
  const deploymentsRaw = JSON.stringify([{
    id: deploymentId,
    status: 'SUCCESS',
    createdAt: CAPTURED_AT
  }])
  const identityRaw = JSON.stringify({
    schema: PROCESS_IDENTITY_SCHEMA,
    release_protocol: SINGLE_RELEASE_PROTOCOL,
    deployment_id: deploymentId,
    release_id: descriptor.release_id,
    content_fingerprint_sha256: descriptor.content_fingerprint_sha256,
    release_manifest_sha256: manifestSha256,
    boot_nonce_sha256: 'c'.repeat(64),
    pid: 42,
    started_at_utc: CAPTURED_AT
  })
  const readyzRaw = JSON.stringify({
    ok: true,
    preflight_verified: true,
    release: {
      ok: true,
      mode: lane,
      release_phase: 'active',
      phase_ready: true,
      release_id: descriptor.release_id,
      content_fingerprint_sha256: descriptor.content_fingerprint_sha256,
      release_manifest_sha256: manifestSha256
    }
  })
  const healthUrl = expectations.railway[lane + '_health_url']
  return {
    capture_source: RAILWAY_CAPTURE_SOURCE,
    captured_at_utc: CAPTURED_AT,
    scope: {
      project_id: descriptor.railway.project_id,
      environment_id: target.environment_id,
      service_id: target.service_id
    },
    deployment_list_raw_json: deploymentsRaw,
    deployment_list_sha256: sha256(deploymentsRaw),
    instance_identity_raw_json: identityRaw,
    instance_identity_sha256: sha256(identityRaw),
    readyz_raw_json: readyzRaw,
    readyz_sha256: sha256(readyzRaw),
    readyz_transport: {
      method: 'GET',
      requested_url: healthUrl,
      final_url: healthUrl,
      redirected: false,
      http_status: 200,
      captured_at_utc: CAPTURED_AT,
      body_sha256: sha256(readyzRaw)
    }
  }
}

function fixtureEvidence(
  descriptor,
  releaseBytes,
  expectations,
  expectationsBytes
) {
  const manifestSha256 = sha256(releaseBytes)
  const manychatConfiguration = expectedManyChatConfiguration(expectations)
  return {
    schema: ATTESTATION_SCHEMA,
    captured_at_utc: CAPTURED_AT,
    release_id: descriptor.release_id,
    content_fingerprint_sha256: descriptor.content_fingerprint_sha256,
    release_manifest_sha256: manifestSha256,
    expectations_sha256: sha256(expectationsBytes),
    secrets_included: false,
    railway: {
      production: railwayLaneFixture(
        'production', descriptor, expectations, manifestSha256
      ),
      staging: railwayLaneFixture(
        'staging', descriptor, expectations, manifestSha256
      )
    },
    manychat: {
      capture_source: MANYCHAT_CAPTURE_SOURCE,
      captured_at_utc: CAPTURED_AT,
      authenticated: true,
      operator_reviewed: true,
      secrets_included: false,
      provider_cryptographic_proof: false,
      configuration: manychatConfiguration,
      configuration_sha256: sha256(stableJson(manychatConfiguration)),
      visual_artifact_sha256: 'd'.repeat(64)
    }
  }
}

function makeStateRoot(requiredDirectories, seed) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-ext-attest-'))
  fs.chmodSync(root, 0o700)
  for (const directory of requiredDirectories) {
    const target = path.join(root, directory)
    fs.mkdirSync(target, { mode: 0o700 })
    fs.chmodSync(target, 0o700)
  }
  const stateFile = path.join(root, 'thread-state', 'thread.json')
  const controlFile = path.join(root, 'control-events', 'events.ndjson')
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ state: seed, customer_text: 'private-customer-fixture' }),
    { mode: 0o600 }
  )
  fs.writeFileSync(
    controlFile,
    JSON.stringify({ event: 'durable', sequence: 1 }) + '\n',
    { mode: 0o600 }
  )
  fs.chmodSync(stateFile, 0o600)
  fs.chmodSync(controlFile, 0o600)
  return root
}

function makeStateRoots(requiredDirectories) {
  return {
    production: {
      live: makeStateRoot(requiredDirectories, 'production'),
      restored: makeStateRoot(requiredDirectories, 'production')
    },
    staging: {
      live: makeStateRoot(requiredDirectories, 'staging'),
      restored: makeStateRoot(requiredDirectories, 'staging')
    }
  }
}

function cleanupStateRoots(roots) {
  for (const lane of ['production', 'staging']) {
    for (const kind of ['live', 'restored']) {
      const target = roots[lane][kind]
      if (target && target.startsWith(os.tmpdir() + path.sep +
          'scv-ext-attest-')) {
        fs.rmSync(target, { recursive: true, force: true })
      }
    }
  }
}

function stateReceiptFixture(options) {
  const {
    role, lane, descriptor, releaseBytes, expectationsBytes,
    expectations, evidence, root
  } = options
  const scan = scanStableStateTree(
    root, expectations.mutable_state.required_directories
  )
  const railway = evidence.railway[lane]
  const identity = JSON.parse(railway.instance_identity_raw_json)
  return {
    ok: scan.ok === true,
    schema: STATE_SCAN_SCHEMA,
    capture_source: role === 'live'
      ? STATE_LIVE_CAPTURE_SOURCE
      : STATE_RESTORED_CAPTURE_SOURCE,
    captured_at_utc: CAPTURED_AT,
    lane,
    role,
    release_id: descriptor.release_id,
    content_fingerprint_sha256: descriptor.content_fingerprint_sha256,
    release_manifest_sha256: sha256(releaseBytes),
    expectations_sha256: sha256(expectationsBytes),
    railway_deployment_id: role === 'live' ? identity.deployment_id : '',
    instance_identity_sha256: role === 'live'
      ? railway.instance_identity_sha256
      : '',
    namespace: lane === 'production'
      ? descriptor.persistence.production_namespace
      : descriptor.persistence.staging_namespace,
    root_class: role === 'live'
      ? 'canonical_railway_namespace'
      : 'independent_restored_namespace',
    archive_sha256: role === 'restored' ? 'e'.repeat(64) : '',
    provider_receipt_sha256: role === 'restored' ? 'f'.repeat(64) : '',
    stable_point_in_time_only: true,
    future_writes_covered: false,
    secrets_included: false,
    scan: {
      ok: scan.ok === true,
      inventory_sha256: scan.inventory_sha256,
      entry_count: scan.entry_count,
      file_count: scan.file_count,
      directory_count: scan.directory_count,
      total_bytes: scan.total_bytes
    },
    failures: scan.failures
  }
}

function attachStateReceipts(
  baseEvidence,
  roots,
  descriptor,
  releaseBytes,
  expectations,
  expectationsBytes
) {
  const evidence = clone(baseEvidence)
  evidence.mutable_state = {}
  for (const lane of ['production', 'staging']) {
    const live = stateReceiptFixture({
      role: 'live', lane, descriptor, releaseBytes, expectationsBytes,
      expectations, evidence, root: roots[lane].live
    })
    const restored = stateReceiptFixture({
      role: 'restored', lane, descriptor, releaseBytes, expectationsBytes,
      expectations, evidence, root: roots[lane].restored
    })
    const liveRaw = JSON.stringify(live)
    const restoredRaw = JSON.stringify(restored)
    evidence.mutable_state[lane] = {
      live_receipt_raw_json: liveRaw,
      live_receipt_sha256: sha256(liveRaw),
      restored_receipt_raw_json: restoredRaw,
      restored_receipt_sha256: sha256(restoredRaw)
    }
  }
  return evidence
}

function mutateRaw(lane, key, mutate) {
  const rawKey = key + '_raw_json'
  const hashKey = key + '_sha256'
  const value = JSON.parse(lane[rawKey])
  mutate(value)
  lane[rawKey] = JSON.stringify(value)
  lane[hashKey] = sha256(lane[rawKey])
  if (key === 'readyz') lane.readyz_transport.body_sha256 = lane[hashKey]
}

function mutateStateReceipt(pair, role, mutate) {
  const rawKey = role + '_receipt_raw_json'
  const hashKey = role + '_receipt_sha256'
  const receipt = JSON.parse(pair[rawKey])
  mutate(receipt)
  pair[rawKey] = JSON.stringify(receipt)
  pair[hashKey] = sha256(pair[rawKey])
}

function runHarness() {
  const expectationsBytes = fs.readFileSync(EXPECTATIONS_FILE)
  const expectations = JSON.parse(expectationsBytes.toString('utf8'))
  const descriptor = fixtureDescriptor(expectationsBytes)
  const releaseBytes = releaseManifestBytes(descriptor)
  const baseEvidence = fixtureEvidence(
    descriptor, releaseBytes, expectations, expectationsBytes
  )
  const required = expectations.mutable_state.required_directories
  let checks = 0
  const ok = (condition, message) => {
    checks += 1
    assert.ok(condition, message)
  }
  const verify = (evidence, extra = {}) => verifyExternalRuntimeAttestation({
    descriptor,
    releaseBytes,
    expectations,
    expectationsBytes,
    evidence,
    nowMs: NOW_MS,
    ...extra
  })

  let roots = makeStateRoots(required)
  try {
    const valid = verify(attachStateReceipts(
      baseEvidence, roots, descriptor, releaseBytes,
      expectations, expectationsBytes
    ))
    ok(valid.ok === true, JSON.stringify(valid.failures))
    ok(valid.operational_release_identity_converged === true,
      'valid evidence did not converge')
    ok(valid.absolute_future_drift_impossible === false,
      'verifier made an impossible absolute claim')
    ok(valid.gate_action === 'allow_external_convergence_claim',
      'valid evidence did not open only the external claim gate')
    ok(valid.runtime_mutation_authorized === false,
      'read-only verifier authorized a runtime mutation')
    ok(valid.manychat.provider_cryptographic_proof === false,
      'ManyChat visual proof was upgraded to cryptographic proof')
    ok(!JSON.stringify(valid).includes('private-customer-fixture'),
      'state verifier leaked customer content')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    const evidence = attachStateReceipts(
      baseEvidence, roots, descriptor, releaseBytes,
      expectations, expectationsBytes
    )
    const unsealedBytes = Buffer.from(JSON.stringify(expectations))
    const receipt = verify(evidence, { expectationsBytes: unsealedBytes })
    ok(receipt.ok === false && receipt.failures.includes(
      'expectations_not_bound_to_sealed_release_inventory'
    ), 'unsealed external expectations were accepted')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    const receipt = verify(baseEvidence, {
      stateRoots: {
        enforceCanonicalPaths: false,
        production: roots.production,
        staging: roots.staging
      }
    })
    ok(receipt.ok === false && receipt.failures.includes(
      'state_production_live_receipt_raw_json_size_invalid'
    ) && receipt.failures.includes(
      'state_staging_restored_receipt_raw_json_size_invalid'
    ), 'legacy noncanonical root bypass produced an external PASS')
  } finally { cleanupStateRoots(roots) }

  const topLevelCases = [
    {
      name: 'ManyChat target drift',
      mutate: (evidence) => {
        evidence.manychat.configuration.ingress_url =
          'https://wrong.example/manychat/inbound'
      },
      failure: 'manychat_ingress_url_mismatch'
    },
    {
      name: 'false ManyChat cryptographic proof claim',
      mutate: (evidence) => {
        evidence.manychat.provider_cryptographic_proof = true
      },
      failure: 'manychat_capture_proof_class_invalid'
    },
    {
      name: 'failed Railway deployment',
      mutate: (evidence) => mutateRaw(
        evidence.railway.production, 'deployment_list',
        (value) => { value[0].status = 'FAILED' }
      ),
      failure: 'railway_production_deployment_not_success'
    },
    {
      name: 'wrong Railway instance release',
      mutate: (evidence) => mutateRaw(
        evidence.railway.staging, 'instance_identity',
        (value) => { value.release_id = 'different-release' }
      ),
      failure: 'railway_staging_instance_release_id_mismatch'
    },
    {
      name: 'redirected Railway health response',
      mutate: (evidence) => {
        evidence.railway.production.readyz_transport.redirected = true
      },
      failure: 'railway_production_readyz_redirected'
    },
    {
      name: 'stale ManyChat evidence',
      mutate: (evidence) => {
        evidence.manychat.captured_at_utc = new Date(
          NOW_MS - expectations.evidence_max_age_ms - 1
        ).toISOString()
      },
      failure: 'manychat_stale'
    }
  ]
  for (const testCase of topLevelCases) {
    roots = makeStateRoots(required)
    try {
      const evidence = attachStateReceipts(
        baseEvidence, roots, descriptor, releaseBytes,
        expectations, expectationsBytes
      )
      testCase.mutate(evidence)
      const receipt = verify(evidence)
      ok(receipt.ok === false && receipt.failures.includes(testCase.failure),
        testCase.name + ' was accepted')
    } finally { cleanupStateRoots(roots) }
  }

  roots = makeStateRoots(required)
  try {
    fs.writeFileSync(
      path.join(roots.production.restored, 'thread-state', 'thread.json'),
      JSON.stringify({ state: 'tampered' }),
      { mode: 0o600 }
    )
    const evidence = attachStateReceipts(
      baseEvidence, roots, descriptor, releaseBytes,
      expectations, expectationsBytes
    )
    const receipt = verify(evidence)
    ok(receipt.ok === false && receipt.failures.includes(
      'state_production_restored_inventory_sha256_mismatch'
    ), 'non-equivalent restored state receipt was accepted')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    const evidence = attachStateReceipts(
      baseEvidence, roots, descriptor, releaseBytes,
      expectations, expectationsBytes
    )
    mutateStateReceipt(evidence.mutable_state.production, 'live', (receipt) => {
      receipt.railway_deployment_id =
        '88888888-8888-4888-8888-888888888888'
    })
    const receipt = verify(evidence)
    ok(receipt.ok === false && receipt.failures.includes(
      'state_production_deployment_id_mismatch'
    ), 'state receipt from another Railway deployment was accepted')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    const evidence = attachStateReceipts(
      baseEvidence, roots, descriptor, releaseBytes,
      expectations, expectationsBytes
    )
    mutateStateReceipt(evidence.mutable_state.staging, 'live', (receipt) => {
      receipt.instance_identity_sha256 = '9'.repeat(64)
    })
    const receipt = verify(evidence)
    ok(receipt.ok === false && receipt.failures.includes(
      'state_staging_instance_identity_hash_mismatch'
    ), 'state receipt was not bound to the Railway identity capture')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    const evidence = attachStateReceipts(
      baseEvidence, roots, descriptor, releaseBytes,
      expectations, expectationsBytes
    )
    evidence.mutable_state.production.live_receipt_raw_json += ' '
    const receipt = verify(evidence)
    ok(receipt.ok === false && receipt.failures.includes(
      'state_production_live_receipt_hash_mismatch'
    ), 'state receipt raw-byte hash mismatch was accepted')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    const evidence = attachStateReceipts(
      baseEvidence, roots, descriptor, releaseBytes,
      expectations, expectationsBytes
    )
    mutateStateReceipt(evidence.mutable_state.staging, 'restored', (receipt) => {
      receipt.captured_at_utc = new Date(
        NOW_MS - expectations.evidence_max_age_ms - 1
      ).toISOString()
    })
    const receipt = verify(evidence)
    ok(receipt.ok === false && receipt.failures.includes(
      'state_staging_restored_stale'
    ), 'stale restored state receipt was accepted')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    fs.symlinkSync(
      path.join(roots.staging.restored, 'thread-state', 'thread.json'),
      path.join(roots.staging.restored, 'inbox', 'injected-link')
    )
    const scan = scanStableStateTree(roots.staging.restored, required)
    ok(scan.ok === false && scan.failures.some((item) =>
      item.startsWith('state_special_entry:')
    ), 'symlinked state entry was accepted')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    let changed = false
    const scan = scanStableStateTree(roots.production.live, required, {
      betweenScans: () => {
        if (changed) return
        changed = true
        fs.appendFileSync(
          path.join(roots.production.live, 'control-events', 'events.ndjson'),
          JSON.stringify({ event: 'concurrent-write' }) + '\n'
        )
      }
    })
    ok(scan.ok === false && scan.failures.includes(
      'state_changed_between_read_only_scans'
    ), 'concurrent state mutation was accepted as a stable scan')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    fs.chmodSync(
      path.join(roots.production.live, 'thread-state', 'thread.json'), 0o644
    )
    const scan = scanStableStateTree(roots.production.live, required)
    ok(scan.ok === false && scan.failures.some((item) =>
      item.startsWith('state_entry_not_owner_only:')
    ), 'world-readable state was accepted')
  } finally { cleanupStateRoots(roots) }

  roots = makeStateRoots(required)
  try {
    const restored = buildStateScanReceipt({
      descriptor,
      releaseBytes,
      expectations,
      expectationsBytes,
      role: 'restored',
      lane: 'production',
      root: roots.production.restored,
      archiveSha256: 'e'.repeat(64),
      providerReceiptSha256: 'f'.repeat(64),
      nowMs: NOW_MS
    })
    ok(restored.ok === true, JSON.stringify(restored.failures))
    ok(restored.future_writes_covered === false,
      'restored receipt overstated future coverage')
    const live = buildStateScanReceipt({
      descriptor,
      releaseBytes,
      expectations,
      expectationsBytes,
      role: 'live',
      lane: 'production',
      root: roots.production.live,
      instanceIdentityRaw:
        baseEvidence.railway.production.instance_identity_raw_json,
      nowMs: NOW_MS
    })
    ok(live.ok === false && live.failures.includes(
      'state_live_root_not_canonical'
    ), 'live receipt builder accepted a noncanonical test root')
  } finally { cleanupStateRoots(roots) }

  process.stdout.write(JSON.stringify({
    ok: true,
    checks,
    manychat_provider_cryptographic_proof: false,
    mutable_state_scope: 'lane_receipt_pair_stable_point_in_time_only',
    legacy_noncanonical_root_bypass_closed: true
  }) + '\n')
  return { ok: true, checks }
}

if (require.main === module) runHarness()

module.exports = { runHarness }
