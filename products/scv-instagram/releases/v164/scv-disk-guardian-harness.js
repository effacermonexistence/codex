#!/usr/bin/env node
// Regression locks for scv-disk-guardian.js — the "full volume => silent
// inbound loss" class kill (live incident 2026-07-28, 7 vanished leads).
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  listMachineJournals,
  rotateJournalKeepTail,
  emergencyDiskRelief,
  diskNeedsEmergencyRelief,
  runDiskGuardianOnce,
  getDiskUsage,
  volumeAnchorPath,
  EMERGENCY_FREE_FLOOR_BYTES
} = require(path.join(__dirname, 'scv-disk-guardian.js'))

let passed = 0
let failed = 0
function check(name, cond) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}`) }
}

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-disk-guardian-'))
  fs.mkdirSync(path.join(root, 'control-events-real'), { recursive: true })
  // Prod state dirs are symlinks into the volume — the walker must follow them.
  fs.symlinkSync(path.join(root, 'control-events-real'), path.join(root, 'control-events'))
  fs.mkdirSync(path.join(root, 'thread-history'), { recursive: true })
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
  return root
}

function ndjsonLines(count, tag) {
  let out = ''
  for (let i = 0; i < count; i += 1) out += JSON.stringify({ seq: i, tag, pad: 'x'.repeat(200) }) + '\n'
  return out
}

// 1) Rotation keeps the tail and respects the cap
{
  const root = makeSandbox()
  const fat = path.join(root, 'control-events', 'vampire.ndjson')
  fs.writeFileSync(fat, ndjsonLines(4000, 'vampire')) // ~900KB lines
  const receipt = rotateJournalKeepTail(fat, { maxBytes: 64 * 1024, keepBytes: 16 * 1024 })
  const after = fs.readFileSync(fat, 'utf8')
  const lines = after.split('\n').filter(Boolean)
  check('rotation triggers over cap', receipt.rotated === true)
  check('rotation keeps only the tail', fs.statSync(fat).size <= 16 * 1024)
  check('rotation preserves whole trailing lines', lines.every((l) => { try { JSON.parse(l); return true } catch { return false } }))
  check('rotation keeps the newest record', lines.length > 0 && JSON.parse(lines[lines.length - 1]).seq === 3999)
}

// 2) Under-cap journals are untouched
{
  const root = makeSandbox()
  const small = path.join(root, 'logs', 'small.ndjson')
  fs.writeFileSync(small, ndjsonLines(5, 'small'))
  const before = fs.readFileSync(small, 'utf8')
  const receipt = rotateJournalKeepTail(small, { maxBytes: 64 * 1024, keepBytes: 16 * 1024 })
  check('under-cap journal untouched', receipt.rotated === false && fs.readFileSync(small, 'utf8') === before)
}

// 3) Walker finds journals through symlinked dirs; never lists conversation .json
{
  const root = makeSandbox()
  fs.writeFileSync(path.join(root, 'control-events', 'a.ndjson'), ndjsonLines(2, 'a'))
  fs.writeFileSync(path.join(root, 'logs', 'b.ndjson'), ndjsonLines(2, 'b'))
  fs.writeFileSync(path.join(root, 'thread-history', 'lead.json'), JSON.stringify({ history: ['hi'] }))
  const found = listMachineJournals(root)
  check('walker follows symlinked state dirs', found.some((f) => f.includes('control-events') && f.endsWith('a.ndjson')))
  check('walker finds plain-dir journals', found.some((f) => f.endsWith('b.ndjson')))
  check('walker never lists conversation .json', found.every((f) => f.endsWith('.ndjson')))
}

// 4) Emergency relief rotates every fat journal, leaves conversation memory intact
{
  const root = makeSandbox()
  const fat = path.join(root, 'control-events', 'fat.ndjson')
  fs.writeFileSync(fat, ndjsonLines(4000, 'fat'))
  const memory = path.join(root, 'thread-history', 'lead.json')
  fs.writeFileSync(memory, JSON.stringify({ history: ['precious'] }))
  const relief = emergencyDiskRelief(root, { maxBytes: 64 * 1024, keepBytes: 16 * 1024 })
  check('relief rotates fat journal', relief.rotated_count === 1 && fs.statSync(fat).size <= 16 * 1024)
  check('relief never touches conversation memory', fs.readFileSync(memory, 'utf8') === JSON.stringify({ history: ['precious'] }))
}

// 5) Threshold logic: pct and free-floor both trip; healthy disk does not
{
  const total = 5 * 1024 * 1024 * 1024
  check('critical pct trips relief', diskNeedsEmergencyRelief('/nonexistent', { total_bytes: total, free_bytes: total * 0.1, used_pct: 90 }) === true)
  check('low free floor trips relief even at low pct', diskNeedsEmergencyRelief('/nonexistent', { total_bytes: total, free_bytes: EMERGENCY_FREE_FLOOR_BYTES - 1, used_pct: 10 }) === true)
  check('healthy disk does not trip', diskNeedsEmergencyRelief('/nonexistent', { total_bytes: total, free_bytes: total * 0.9, used_pct: 10 }) === false)
  check('missing usage fails closed (no relief)', diskNeedsEmergencyRelief('/nonexistent', null) === false)
}

// 6) Guardian tick: critical usage => relief + human-agent alert receipt
{
  const root = makeSandbox()
  const fat = path.join(root, 'control-events', 'fat.ndjson')
  fs.writeFileSync(fat, ndjsonLines(60000, 'fat')) // > default 5MB cap
  const receipt = runDiskGuardianOnce({
    root,
    usageOverride: { total_bytes: 5e9, free_bytes: 1e8, used_pct: 98 }
  })
  check('critical tick executes relief', receipt.status === 'critical_relief_executed' && receipt.relief_rotated >= 1)
  check('critical tick writes human-agent alert', !!receipt.alert_file && fs.existsSync(receipt.alert_file))
  const alert = JSON.parse(fs.readFileSync(receipt.alert_file, 'utf8'))
  check('alert carries reason + usage', alert.type === 'disk_guardian_critical_alert' && alert.usage.used_pct === 98)
}

// 7) Guardian tick: warn and ok statuses
{
  const root = makeSandbox()
  const warn = runDiskGuardianOnce({ root, usageOverride: { total_bytes: 5e9, free_bytes: 1.4e9, used_pct: 72 } })
  const ok = runDiskGuardianOnce({ root, usageOverride: { total_bytes: 5e9, free_bytes: 4e9, used_pct: 20 } })
  check('warn band reports warn without relief', warn.status === 'warn' && warn.relief_rotated === undefined)
  check('healthy band reports ok', ok.status === 'ok')
}

// 8) Real statfs works on this machine (shape only)
{
  const usage = getDiskUsage(__dirname)
  check('getDiskUsage returns sane shape', !!usage && usage.total_bytes > 0 && usage.used_pct >= 0 && usage.used_pct <= 100)
}

// 9) Usage is measured on the VOLUME behind the symlinked state dirs, not the
// app dir itself (live 2026-07-29: measuring /app read the container overlay
// fs and would never see /data fill up)
{
  const root = makeSandbox()
  fs.mkdirSync(path.join(root, 'volume-real', 'inbox'), { recursive: true })
  fs.symlinkSync(path.join(root, 'volume-real', 'inbox'), path.join(root, 'inbox'))
  const anchor = volumeAnchorPath(root)
  check('usage anchor resolves through the inbox symlink', anchor === fs.realpathSync(path.join(root, 'volume-real', 'inbox')))
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-disk-anchor-'))
  check('usage anchor falls back to root without state dirs', volumeAnchorPath(bare) === bare)
}

console.log(`scv-disk-guardian-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
