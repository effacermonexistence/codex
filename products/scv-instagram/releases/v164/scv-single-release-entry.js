#!/usr/bin/env node
'use strict'

process.umask(0o077)

// Minimal entrypoint for the explicit single_release_v1 artifact. It seals no
// data and grants no activation authority: it only verifies the already-sealed
// artifact against this Railway instance, proves the configured /data
// namespace, installs the inherited release identity, and starts the existing
// runtime. Any missing or mismatched binding terminates before cloud-start can
// create state or spawn a worker.

const path = require('path')
const { spawnSync } = require('child_process')
const {
  SCV_SINGLE_RELEASE_PROTOCOL,
  isSingleReleaseRequested,
  requireSingleRelease,
  installSingleReleaseRuntimeIdentity,
  buildSingleReleasePreflightProof
} = require('./scv-single-release.js')

const ROOT = __dirname

function verifyVideoPreviewRuntime(env = process.env, spawnImpl = spawnSync) {
  const command = String(env.SCV_FFMPEG_BIN || 'ffmpeg').trim()
  const result = spawnImpl(command, ['-version'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 256 * 1024,
    windowsHide: true
  })
  if (result?.status !== 0 || !/^ffmpeg version\s+/i.test(String(result?.stdout || ''))) {
    throw new Error('single_release_video_preview_runtime_missing')
  }
  return { ok: true, command, version_present: true }
}

function boot(env = process.env) {
  if (!isSingleReleaseRequested(env)) {
    throw new Error('single_release_protocol_not_explicit')
  }
  const receipt = requireSingleRelease({ root: ROOT, env })
  const identity = installSingleReleaseRuntimeIdentity(receipt, env)
  const proof = buildSingleReleasePreflightProof(receipt, env)
  env.SCV_PREFLIGHT_PROOF_B64 = Buffer.from(
    JSON.stringify(proof),
    'utf8'
  ).toString('base64url')
  env.SCV_ROOT = ROOT
  const videoPreviewRuntime = verifyVideoPreviewRuntime(env)

  process.stdout.write(`${JSON.stringify({
    event: 'scv_single_release_entry_verified',
    ok: true,
    protocol: SCV_SINGLE_RELEASE_PROTOCOL,
    mode: receipt.mode,
    release_id: receipt.release_id,
    content_fingerprint_sha256: receipt.content_fingerprint_sha256,
    release_manifest_sha256: receipt.release_manifest_sha256,
    railway_deployment_id: receipt.railway_deployment_id,
    runtime_identity_installed: Boolean(identity.SCV_RELEASE_ID),
    persistence_verified:
      receipt.persistence?.write_fsync_read_delete_verified === true,
    video_preview_runtime_verified: videoPreviewRuntime.ok === true
  })}\n`)

  require(path.join(ROOT, 'cloud-start.js'))
  return { receipt, proof, identity }
}

if (require.main === module) {
  try { boot(process.env) } catch (error) {
    process.stderr.write(`${JSON.stringify({
      event: 'scv_single_release_entry_rejected',
      ok: false,
      reason: String(error?.message || error).slice(0, 2000)
    })}\n`)
    process.exit(1)
  }
}

module.exports = { boot, verifyVideoPreviewRuntime }
