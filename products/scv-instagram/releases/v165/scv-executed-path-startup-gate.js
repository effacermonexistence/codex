#!/usr/bin/env node
// ============================================================
// SCV EXECUTED-PATH STARTUP GATE
// ------------------------------------------------------------
// Fail-closed boot self-test that runs the executed booking path and OpenAI
// provider-resilience harnesses as ISOLATED CHILD PROCESSES and parses their JSON
// receipts. They are NEVER require()'d into the live process: each harness owns a
// throwaway SCV_ROOT, and child execution confines that mutation to a short-lived
// subprocess.
//
// Isolation / safety:
//   - child gets a throwaway sandbox SCV_ROOT/SCV_PERSIST_ROOT (fallback floor;
//     the harness additionally overrides SCV_ROOT with its own mkdtemp);
//   - the destructive startup purge flag is scrubbed from the child env;
//   - bounded timeout; no network calls; no ManyChat / Instagram / live actions.
// On ANY failure (spawn error, timeout, signal kill, non-zero exit, invalid JSON,
// or receipt.ok !== true) it THROWS so cloud-start fails closed (process.exit(1)).
// ============================================================
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const SCV_EXECUTED_PATH_STARTUP_GATE_VERSION =
  'scv-executed-path-startup-gate-2026-07-25-v3-booking-policy-regression'
const DEFAULT_TIMEOUT_MS = 90000
const DEFAULT_HARNESSES = Object.freeze([
  'scv-booking-policy-harness.js',
  'scv-executed-path-booking-harness.js',
  'scv-openai-resilience-harness.js'
])

function runExecutedPathStartupSelfTest(opts = {}) {
  const harnessPaths = opts.harnessPath
    ? [opts.harnessPath]
    : (Array.isArray(opts.harnessPaths) && opts.harnessPaths.length > 0
        ? opts.harnessPaths
        : DEFAULT_HARNESSES.map((name) => path.join(__dirname, name)))
  const nodeBin = opts.nodeBin || process.execPath
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS

  // Belt-and-suspenders isolation: force the child onto a throwaway sandbox root so
  // it can never touch the live /data volume even if the harness self-isolation
  // ever regressed. The harness additionally overrides SCV_ROOT with its own temp
  // dir at load; this sandbox is only the fallback floor.
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-startup-gate-'))
  const childEnv = {
    ...(opts.env || process.env),
    SCV_ROOT: sandboxRoot,
    SCV_PERSIST_ROOT: sandboxRoot,
    // Child harnesses author local fixture candidates, not provider responses.
    // Keep their result independent from the live process' Responses receipt
    // requirement while the actual runtime remains fail-closed.
    SCV_OPENAI_RESPONSES_REQUIRED: '0'
  }
  delete childEnv.SCV_PURGE_TEST_ACCOUNT_ON_STARTUP

  try {
    const receipts = []
    for (const harnessPath of harnessPaths) {
      const result = spawnSync(nodeBin, [harnessPath], {
        timeout: timeoutMs,
        env: childEnv,
        cwd: path.dirname(harnessPath),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      if (result.error) {
        if (result.error.code === 'ETIMEDOUT') throw new Error(`executed_path_startup_self_test_timeout_${timeoutMs}ms`)
        throw new Error(`executed_path_startup_self_test_spawn_error:${String(result.error.message || result.error.code || result.error).slice(0, 200)}`)
      }
      if (result.signal) throw new Error(`executed_path_startup_self_test_killed_signal_${result.signal}`)
      if (result.status !== 0) throw new Error(`executed_path_startup_self_test_nonzero_exit_${result.status}:${String(result.stderr || '').slice(0, 200)}`)

      let receipt
      try { receipt = JSON.parse(String(result.stdout || '').trim()) } catch (err) {
        throw new Error(`executed_path_startup_self_test_invalid_json:${String(result.stdout || '').slice(0, 200)}`)
      }
      if (
        !receipt || receipt.ok !== true ||
        !Number.isInteger(receipt.checked) || receipt.checked < 1 ||
        (Array.isArray(receipt.failures) && receipt.failures.length > 0)
      ) {
        throw new Error(`executed_path_startup_self_test_receipt_not_ok:${JSON.stringify({ ok: receipt && receipt.ok, checked: receipt && receipt.checked, failures: receipt && receipt.failures }).slice(0, 200)}`)
      }
      receipts.push({
        child: path.basename(harnessPath),
        checked: receipt.checked,
        proof_mode: receipt.proof_mode || 'local_executed_path_harness_proof'
      })
    }

    return {
      ok: true,
      gate_version: SCV_EXECUTED_PATH_STARTUP_GATE_VERSION,
      child: receipts.map((receipt) => receipt.child).join(','),
      children: receipts,
      isolation: 'child_process_sandbox_scv_root',
      network: false,
      timeout_ms: timeoutMs,
      checked: receipts.reduce((sum, receipt) => sum + receipt.checked, 0),
      proof_mode: 'local_executed_path_and_provider_failure_injection'
    }
  } finally {
    try { fs.rmSync(sandboxRoot, { recursive: true, force: true }) } catch {}
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runExecutedPathStartupSelfTest(), null, 2))
  } catch (err) {
    console.error(String(err && err.message ? err.message : err))
    process.exit(1)
  }
}

module.exports = { SCV_EXECUTED_PATH_STARTUP_GATE_VERSION, runExecutedPathStartupSelfTest }
