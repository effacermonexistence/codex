#!/usr/bin/env node
// ============================================================
// SCV EXECUTED-PATH STARTUP GATE HARNESS
// Proves the fail-closed startup gate's isolation and failure behavior WITHOUT the
// live process: success receipt, receipt-not-ok / non-zero-exit / invalid-json /
// timeout all throw (fail closed), the booking harness is NEVER require()'d into
// this process (child-process only), and the caller's SCV_ROOT + live tree are
// untouched. No network, no live actions.
// ============================================================
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const {
  runExecutedPathStartupSelfTest,
  SCV_EXECUTED_PATH_STARTUP_GATE_VERSION
} = require(path.join(__dirname, 'scv-executed-path-startup-gate.js'))

const BOOKING_HARNESS = path.join(__dirname, 'scv-executed-path-booking-harness.js')

function snapshotJsonDirectory(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      name,
      sha256: crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(directory, name)))
        .digest('hex')
    }))
}

function runScvExecutedPathStartupGateHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
  }
  const throwsWith = (fn, re) => {
    try { fn(); return { threw: false, message: '' } } catch (e) { return { threw: true, message: String(e && e.message || e), matched: re.test(String(e && e.message || e)) } }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-gate-harness-'))
  const writeScript = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p }
  const liveThreadState = path.join(__dirname, 'thread-state')
  const liveThreadStateBefore = snapshotJsonDirectory(liveThreadState)

  try {
    // 1) Success path: the REAL booking harness runs as a child and returns ok.
    const sandboxBefore = process.env.SCV_ROOT
    const ok = runExecutedPathStartupSelfTest({ timeoutMs: 90000 })
    check('gate_success_receipt_ok',
      ok && ok.ok === true && Number.isInteger(ok.checked) && ok.checked >= 1 &&
      ok.gate_version === SCV_EXECUTED_PATH_STARTUP_GATE_VERSION && ok.network === false &&
      Array.isArray(ok.children) &&
      ok.children.some((child) => child.child === 'scv-booking-policy-harness.js') &&
      ok.children.some((child) => child.child === 'scv-executed-path-booking-harness.js') &&
      ok.children.some((child) => child.child === 'scv-openai-resilience-harness.js'),
      ok)

    // 2) NEVER imported into this process: the booking harness must not be in
    //    require.cache (it was spawned as a child, not require()'d).
    check('booking_harness_not_required_into_live_process',
      !Object.keys(require.cache).some((k) => k === BOOKING_HARNESS),
      Object.keys(require.cache).filter((k) => k.includes('scv-executed-path-booking-harness')))

    // 3) Caller isolation: parent SCV_ROOT is unchanged by the child run.
    check('parent_scv_root_untouched_by_child',
      process.env.SCV_ROOT === sandboxBefore,
      { before: sandboxBefore, after: process.env.SCV_ROOT })

    const ambientIsolationScript = writeScript(
      'ambient-responses-isolation.js',
      'const ok=process.env.SCV_OPENAI_RESPONSES_REQUIRED==="0";console.log(JSON.stringify({ok,checked:1,failures:ok?[]:[{name:"ambient_responses_required_not_isolated"}]}))\n'
    )
    const ambientIsolation = runExecutedPathStartupSelfTest({
      harnessPath: ambientIsolationScript,
      env: { ...process.env, SCV_OPENAI_RESPONSES_REQUIRED: '1' }
    })
    check(
      'production_responses_requirement_is_isolated_from_fixture_children',
      ambientIsolation.ok === true && ambientIsolation.checked === 1,
      ambientIsolation
    )

    // 4) receipt.ok === false -> fail closed (throws).
    const failScript = writeScript('fail-receipt.js', 'console.log(JSON.stringify({ok:false,checked:33,failures:[{name:"x"}]}))\n')
    const r4 = throwsWith(() => runExecutedPathStartupSelfTest({ harnessPath: failScript }), /receipt_not_ok/)
    check('receipt_not_ok_fails_closed', r4.threw && r4.matched, r4)

    // 5) non-zero exit -> fail closed.
    const exitScript = writeScript('nonzero-exit.js', 'process.stderr.write("boom");process.exit(3)\n')
    const r5 = throwsWith(() => runExecutedPathStartupSelfTest({ harnessPath: exitScript }), /nonzero_exit_3/)
    check('nonzero_exit_fails_closed', r5.threw && r5.matched, r5)

    // 6) invalid JSON -> fail closed.
    const junkScript = writeScript('junk.js', 'console.log("this is not json at all")\n')
    const r6 = throwsWith(() => runExecutedPathStartupSelfTest({ harnessPath: junkScript }), /invalid_json/)
    check('invalid_json_fails_closed', r6.threw && r6.matched, r6)

    // 7) timeout -> fail closed (bounded).
    const hangScript = writeScript('hang.js', 'setInterval(() => {}, 1000)\n')
    const r7 = throwsWith(() => runExecutedPathStartupSelfTest({ harnessPath: hangScript, timeoutMs: 1500 }), /timeout/)
    check('timeout_fails_closed', r7.threw && r7.matched, r7)

    // 8) empty/zero-check receipt -> fail closed (cannot pass with 0 assertions).
    const emptyScript = writeScript('empty.js', 'console.log(JSON.stringify({ok:true,checked:0,failures:[]}))\n')
    const r8 = throwsWith(() => runExecutedPathStartupSelfTest({ harnessPath: emptyScript }), /receipt_not_ok/)
    check('zero_check_receipt_fails_closed', r8.threw && r8.matched, r8)

    // 9) Isolation: the run did not add or alter live thread-state. A staging
    // worker may already have valid state before this harness starts, so zero
    // files is not a legitimate global precondition.
    const liveThreadStateAfter = snapshotJsonDirectory(liveThreadState)
    check(
      'live_thread_state_unchanged_by_child',
      JSON.stringify(liveThreadStateAfter) === JSON.stringify(liveThreadStateBefore),
      { before: liveThreadStateBefore, after: liveThreadStateAfter }
    )

    const okAll = failures.length === 0
    const result = { ok: okAll, checked, failures, gate_version: SCV_EXECUTED_PATH_STARTUP_GATE_VERSION }
    if (!okAll) throw new Error(`scv_executed_path_startup_gate_harness_failed:${JSON.stringify(result)}`)
    return result
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvExecutedPathStartupGateHarness(), null, 2))
  } catch (err) {
    console.error(String(err && err.message ? err.message : err))
    process.exit(1)
  }
}

module.exports = { runScvExecutedPathStartupGateHarness }
