#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { verifySingleRelease } = require('./scv-single-release.js')
const {
  reconcileKnownFalsePositiveFailClose
} = require('./scv-golden-fail-close.js')

function main() {
  const release = verifySingleRelease({ root: __dirname, env: process.env })
  if (release?.ok !== true) {
    throw new Error(`replacement_single_release_invalid:${(release?.failures || []).join(',')}`)
  }
  const driftFile = path.join(__dirname, 'logs', 'drift-status.json')
  const driftStatus = JSON.parse(fs.readFileSync(driftFile, 'utf8'))
  const result = reconcileKnownFalsePositiveFailClose({
    env: process.env,
    root: __dirname,
    driftStatus,
    currentReleaseId: release.release_id,
    currentReleaseFingerprint: release.content_fingerprint_sha256
  })
  process.stdout.write(`${JSON.stringify({
    ok: result.reconciled === true,
    reconciled: result.reconciled === true,
    reason: String(result.reason || ''),
    failures: result.failures || [],
    replacement_release_id: String(result.replacement_release_id || ''),
    replacement_release_fingerprint_sha256:
      String(result.replacement_release_fingerprint_sha256 || ''),
    archived_file_name: result.archived_file ? path.basename(result.archived_file) : '',
    audit_file_name: result.audit_file ? path.basename(result.audit_file) : ''
  }, null, 2)}\n`)
  if (result.reconciled !== true) process.exitCode = 2
}

try {
  main()
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: String(error?.message || error).slice(0, 1000)
  })}\n`)
  process.exitCode = 1
}
