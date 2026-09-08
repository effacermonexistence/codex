#!/usr/bin/env node
'use strict'

// Regression for the 2026-08-26 identity-gate incident.
//
// The final sender re-derives the release inventory for every send. The
// single-control plane writes a transient delivery publication for each
// attempt; because its directory was not on the mutable-surface exclusion
// list, the sender's own bookkeeping changed the computed fingerprint and
// every delivery attempt was rejected with 423 while idle checks passed.
// Runtime-transient surfaces must never be part of the release inventory,
// and true unexpected artifacts must still be detected.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildSingleReleaseDescriptor } = require(path.join(__dirname, 'scv-single-release.js'))

const RUNTIME_TRANSIENT_DIRS = [
  'accepted-unverified-boundary-pending',
  'accepted-unverified-delivery-publications',
  'inbox_quarantine_corrupt',
  'outbox_quarantine_corrupt_adoption'
]

function fail(reason, extra) {
  console.log(JSON.stringify({
    type: 'runtime_surface_exclusion_harness_fail',
    reason,
    ...extra
  }))
  process.exit(1)
}

function buildDescriptorFor(root) {
  return buildSingleReleaseDescriptor({
    root,
    releaseId: 'scv-instagram-single-harness-v1',
    projectId: '00000000-0000-4000-8000-000000000000',
    productionEnvironmentId: '00000000-0000-4000-8000-000000000001',
    productionServiceId: '00000000-0000-4000-8000-000000000002',
    stagingEnvironmentId: '00000000-0000-4000-8000-000000000003',
    stagingServiceId: '00000000-0000-4000-8000-000000000004',
    productionNamespace: 'prod',
    stagingNamespace: 'staging-harness'
  })
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-surface-exclusion-'))
  fs.writeFileSync(path.join(root, 'artifact.js'), '// sealed artifact\n', { mode: 0o600 })

  // Mid-send snapshot: every runtime-transient surface holds one live file.
  for (const dir of RUNTIME_TRANSIENT_DIRS) {
    fs.mkdirSync(path.join(root, dir), { recursive: true, mode: 0o700 })
    fs.writeFileSync(
      path.join(root, dir, 'in-flight.json'),
      JSON.stringify({ transient: dir }),
      { mode: 0o600 }
    )
  }

  const during = buildDescriptorFor(root)
  const duringPaths = during.files.map((file) => file.path)
  const leaked = duringPaths.filter((p) => RUNTIME_TRANSIENT_DIRS.some((d) => p.startsWith(`${d}/`)))
  if (leaked.length) {
    fail('runtime_transient_surface_counted_in_inventory', { leaked })
  }
  if (!duringPaths.includes('artifact.js')) {
    fail('sealed_artifact_missing_from_inventory', { paths: duringPaths })
  }

  // The idle fingerprint must equal the mid-send fingerprint.
  for (const dir of RUNTIME_TRANSIENT_DIRS) {
    fs.unlinkSync(path.join(root, dir, 'in-flight.json'))
  }
  const idle = buildDescriptorFor(root)
  if (idle.content_fingerprint_sha256 !== during.content_fingerprint_sha256) {
    fail('fingerprint_differs_between_idle_and_mid_send', {
      idle: idle.content_fingerprint_sha256,
      during: during.content_fingerprint_sha256
    })
  }

  // Tamper detection must still work: a real unexpected artifact changes it.
  fs.writeFileSync(path.join(root, 'unexpected-artifact.js'), '// tamper\n', { mode: 0o600 })
  const tampered = buildDescriptorFor(root)
  if (tampered.content_fingerprint_sha256 === idle.content_fingerprint_sha256) {
    fail('true_tamper_not_detected')
  }

  console.log(JSON.stringify({
    type: 'runtime_surface_exclusion_harness_pass',
    excluded_surfaces: RUNTIME_TRANSIENT_DIRS.length,
    fingerprint_stable_mid_send: true,
    tamper_still_detected: true
  }))
  process.exit(0)
}

main()
