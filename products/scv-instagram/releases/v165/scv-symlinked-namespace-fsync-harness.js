#!/usr/bin/env node
'use strict'

// Regression for the 2026-08-26 production incident.
//
// Deployed layout: /app/outbox is a trusted namespace symlink to
// /data/scv-runtime-namespaces/<ns>/outbox. outbox-worker's fsyncDirectory
// opened the directory with O_DIRECTORY|O_NOFOLLOW, which refuses a symlink
// final component (ENOTDIR). The call sits inside acquireOutboxLock, OUTSIDE
// handleFile's try/catch, so every delivery attempt escaped to the loop
// catch as `loop_error` and the queued reply was never delivered.
//
// This harness reproduces the exact boundary: handleFile() on a packet whose
// outbox directory is a symlink must not throw ENOTDIR. The synthetic packet
// is non-authoritative, so a fixed worker must quarantine it (visible
// terminal handling) rather than crash before its own error handling.

const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const WORKER = process.env.SCV_SYMLINK_FSYNC_WORKER ||
  path.join(__dirname, 'outbox-worker.js')

function fail(reason, extra) {
  console.log(JSON.stringify({
    type: 'symlinked_namespace_fsync_harness_fail',
    reason,
    ...extra
  }))
  process.exit(1)
}

function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-symlink-fsync-'))
  const realRoot = path.join(base, 'real-namespace')
  const appRoot = path.join(base, 'app-root')
  fs.mkdirSync(realRoot, { recursive: true, mode: 0o700 })
  fs.mkdirSync(appRoot, { recursive: true, mode: 0o700 })

  const linked = [
    'outbox', 'outbox-idempotency', 'outbox_human_agent_required',
    'outbox_quarantine_failed', 'outbox_quarantine_non_authoritative',
    'outbox_quarantine_stale', 'logs', 'thread-history', 'thread-state'
  ]
  for (const name of linked) {
    fs.mkdirSync(path.join(realRoot, name), { recursive: true, mode: 0o700 })
    fs.symlinkSync(path.join(realRoot, name), path.join(appRoot, name))
  }

  const file = path.join(appRoot, 'outbox', 'symlink-harness-0.json')
  fs.writeFileSync(file, JSON.stringify({
    contact_id: 'symlink-harness-contact',
    thread_id: 'symlink-harness-thread',
    message_id: 'symlink-harness-' + crypto.randomBytes(4).toString('hex'),
    bubble_index: 0,
    bubble_count: 1,
    bubble: { text: 'symlink harness bubble' },
    text: 'symlink harness bubble',
    source: 'symlinked-namespace-fsync-harness',
    due_at: new Date(Date.now() - 1000).toISOString(),
    queued_at: new Date().toISOString()
  }), { mode: 0o600 })

  const probe = [
    'const worker = require(process.env.SCV_SYMLINK_FSYNC_WORKER_ABS)',
    'const target = process.env.SCV_SYMLINK_FSYNC_TARGET',
    'worker.handleFile(target).then(',
    '  () => { console.log(JSON.stringify({ probe: "handled" })) },',
    '  (error) => {',
    '    console.log(JSON.stringify({',
    '      probe: "threw",',
    '      error_name: String(error && error.name),',
    '      error_code: String(error && error.code),',
    '      enotdir: /ENOTDIR/.test(String(error && error.message))',
    '    }))',
    '    process.exit(3)',
    '  }',
    ')'
  ].join('\n')

  const result = spawnSync(process.execPath, ['-e', probe], {
    env: {
      ...process.env,
      SCV_ROOT: appRoot,
      SCV_SYMLINK_FSYNC_WORKER_ABS: path.resolve(WORKER),
      SCV_SYMLINK_FSYNC_TARGET: file
    },
    encoding: 'utf8',
    timeout: 30000
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`

  if (/"probe":"threw"/.test(output) || /ENOTDIR/.test(output)) {
    fail('handle_file_threw_on_symlinked_namespace', {
      enotdir: /ENOTDIR/.test(output),
      exit_status: result.status
    })
  }
  if (!/"probe":"handled"/.test(output)) {
    fail('handle_file_did_not_complete', { exit_status: result.status })
  }

  const remaining = fs.readdirSync(path.join(realRoot, 'outbox'))
    .filter((name) => name.endsWith('.json'))
  if (remaining.length !== 0) {
    fail('outbox_entry_not_terminally_handled', { remaining: remaining.length })
  }

  console.log(JSON.stringify({
    type: 'symlinked_namespace_fsync_harness_pass',
    handled: true,
    outbox_remaining: 0
  }))
  process.exit(0)
}

main()
