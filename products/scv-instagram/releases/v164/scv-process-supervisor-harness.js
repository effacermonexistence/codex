#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { ScvProcessSupervisor } = require('./scv-process-supervisor.js')
const { sanitizeMachineLogObject } = require('./scv-machine-log.js')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitUntil(check, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await sleep(20)
  }
  throw new Error(`timeout:${label}`)
}

async function runHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-supervisor-'))
  const launches = path.join(root, 'launches.ndjson')
  const childScript = path.join(root, 'fake-loop-child.js')
  const capturedStdout = []
  const capturedStderr = []
  let checked = 0
  const ok = (condition, label) => {
    checked += 1
    if (!condition) throw new Error(label)
  }
  fs.writeFileSync(childScript, [
    "const fs = require('fs')",
    `fs.appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ pid: process.pid, argv: process.argv.slice(2) }) + '\\n')`,
    "process.stdout.write('{\"type\":\"split_probe\",\"contact_id\":\"raw-')",
    "setTimeout(() => process.stdout.write('contact-991\",\"text\":\"private dm text\",\"ok\":true}\\n'), 5)",
    "process.stderr.write('stderr private')",
    "setTimeout(() => process.stderr.write(' message 772\\n'), 5)",
    "setTimeout(() => process.stdout.write('===SCV_TEST_MARKER===\\n'), 10)",
    "setInterval(() => {}, 1000)"
  ].join('\n') + '\n')
  const supervisor = new ScvProcessSupervisor({
    root,
    services: [['loop-service', 'fake-loop-child.js', ['--loop', '--sentinel']]],
    statusFile: path.join(root, 'logs', 'supervisor-status.json'),
    restartBaseMs: 10,
    restartMaxMs: 20,
    heartbeatMs: 50,
    stdoutWrite: (value) => capturedStdout.push(String(value)),
    stderrWrite: (value) => capturedStderr.push(String(value))
  })
  try {
    supervisor.startAll()
    await waitUntil(() => fs.existsSync(launches) && fs.readFileSync(launches, 'utf8').trim().split('\n').length >= 1, 'first_launch')
    const firstPid = supervisor.children.get('loop-service')?.pid
    ok(Number(firstPid) > 0, 'first_child_running')
    supervisor.children.get('loop-service').kill('SIGTERM')
    await waitUntil(() => fs.readFileSync(launches, 'utf8').trim().split('\n').length >= 2, 'restart')
    const records = fs.readFileSync(launches, 'utf8').trim().split('\n').map(JSON.parse)
    ok(records.length >= 2, 'child_restarted')
    ok(records[0].argv.join(' ') === '--loop --sentinel', 'initial_argv_exact')
    ok(records[1].argv.join(' ') === '--loop --sentinel', 'restart_argv_preserved')
    ok(records[1].pid !== records[0].pid, 'replacement_process_is_new')
    const status = supervisor.status()
    ok(status.services['loop-service'].restarts >= 1, 'restart_count_recorded')
    ok(status.services['loop-service'].args.join(' ') === '--loop --sentinel', 'status_records_argv')
    await waitUntil(() => capturedStdout.join('').includes('SCV_TEST_MARKER') && capturedStderr.length > 0, 'sanitized_relay')
    const relayed = `${capturedStdout.join('')}\n${capturedStderr.join('')}`
    for (const forbidden of ['raw-contact-991', 'private dm text', 'stderr private message 772']) {
      ok(!relayed.includes(forbidden), `relay_redacts_${forbidden}`)
    }
    ok(/contact_id_hmac_sha256/.test(relayed), 'split_json_identity_hmac_present')
    ok(/text_hmac_sha256/.test(relayed), 'split_json_text_hmac_present')
    ok(/scv_child_nonjson_redacted/.test(relayed), 'split_nonjson_redacted')
    ok(/===SCV_TEST_MARKER===/.test(relayed), 'known_marker_preserved')
    const hmacProbe = "process.stdout.write(require('./scv-machine-log.js').hmacSha256('low_entropy_username'))"
    const firstHmac = spawnSync(process.execPath, ['-e', hmacProbe], { cwd: __dirname, encoding: 'utf8', env: { PATH: process.env.PATH || '' } }).stdout
    const secondHmac = spawnSync(process.execPath, ['-e', hmacProbe], { cwd: __dirname, encoding: 'utf8', env: { PATH: process.env.PATH || '' } }).stdout
    ok(/^[a-f0-9]{64}$/.test(firstHmac) && /^[a-f0-9]{64}$/.test(secondHmac), 'local_ephemeral_hmac_shape')
    ok(firstHmac !== secondHmac, 'local_ephemeral_hmac_differs_between_processes')
    const numericIdentity = JSON.stringify(sanitizeMachineLogObject({
      contact_id: 1537753982,
      message_id: 99112233,
      queue_count: 7
    }))
    ok(!numericIdentity.includes('1537753982') && !numericIdentity.includes('99112233'), 'numeric_identity_scalars_are_hmac_redacted')
    ok(numericIdentity.includes('"queue_count":7'), 'non_sensitive_numeric_metrics_remain_visible')
    return { ok: true, lock_version: 'scv-process-supervisor-harness-2026-08-20-v2-line-buffered-redaction', checked }
  } finally {
    supervisor.shutdown('SIGTERM')
    await sleep(50)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  runHarness().then((receipt) => {
    console.log(JSON.stringify(receipt, null, 2))
  }).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exit(1)
  })
}

module.exports = { runHarness }
