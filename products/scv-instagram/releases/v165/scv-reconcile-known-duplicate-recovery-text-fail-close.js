#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { verifySingleRelease } = require('./scv-single-release.js')
const {
  KNOWN_DUPLICATE_RECOVERY_TEXT_INCIDENT,
  reconcileKnownDuplicateRecoveryTextFailClose
} = require('./scv-golden-fail-close.js')
const { ROUTE_AWARE_VISIBLE_RECOVERY_VERSION } = require('./scv-deterministic-recovery.js')

// Newest receipted Omar.system purge executed after the latch activated. The
// receipt directory names are timestamp tokens, so a reverse sort is newest
// first; a receipt from before the latch can never satisfy the reconciliation.
function latestPurgeReceipt(snapshotRoot) {
  if (!snapshotRoot || !fs.existsSync(snapshotRoot)) return null
  const activatedMs = Date.parse(KNOWN_DUPLICATE_RECOVERY_TEXT_INCIDENT.activated_at_utc)
  const candidates = fs.readdirSync(snapshotRoot)
    .filter((name) => /^omar-system-reset-\d{8}T\d{6}Z$/.test(name))
    .sort()
    .reverse()
  for (const name of candidates) {
    const file = path.join(snapshotRoot, name, 'execution.omar-system-purge.json')
    if (!fs.existsSync(file)) continue
    try {
      const receipt = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Date.parse(String(receipt.executed_at_utc || '')) > activatedMs) return { file, receipt }
    } catch {}
  }
  return null
}

function main() {
  const release = verifySingleRelease({ root: __dirname, env: process.env })
  if (release?.ok !== true) {
    throw new Error(`replacement_single_release_invalid:${(release?.failures || []).join(',')}`)
  }
  const driftFile = path.join(__dirname, 'logs', 'drift-status.json')
  const driftStatus = JSON.parse(fs.readFileSync(driftFile, 'utf8'))
  const snapshotRoot = String(process.env.SCV_SNAPSHOT_ROOT || path.join(
    String(process.env.SCV_PERSIST_ROOT || process.env.RAILWAY_VOLUME_MOUNT_PATH || ''),
    'scv-current-snapshots'
  ))
  const purge = latestPurgeReceipt(snapshotRoot)
  const result = reconcileKnownDuplicateRecoveryTextFailClose({
    env: process.env,
    root: __dirname,
    driftStatus,
    currentReleaseId: release.release_id,
    currentReleaseFingerprint: release.content_fingerprint_sha256,
    currentRecoveryVersion: ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
    purgeReceipt: purge ? purge.receipt : null
  })
  process.stdout.write(`${JSON.stringify({
    ok: result.reconciled === true,
    reconciled: result.reconciled === true,
    reason: String(result.reason || ''),
    failures: result.failures || [],
    purge_receipt_directory: purge ? path.basename(path.dirname(purge.file)) : '',
    replacement_release_id: String(result.replacement_release_id || ''),
    replacement_release_fingerprint_sha256: String(result.replacement_release_fingerprint_sha256 || ''),
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
