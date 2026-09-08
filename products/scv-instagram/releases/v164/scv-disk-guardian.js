#!/usr/bin/env node
// Disk guardian — kills the "full volume => silent inbound loss" class at the root.
//
// Live 2026-07-28: a runaway machine journal (control-events/2124122710.ndjson,
// 4.69GB of repeated safety records) filled /data to 100%. Every inbound persist
// below that point threw ENOSPC with no stdout trace, so brand-new contacts
// vanished with zero footprint (7 leads lost: cams__rolls, tammyessj, 5 more).
// Per-file caps (control ledger rotation) only protect files we already know
// about; this loop protects the volume itself, so ANY future runaway journal is
// rotated before the disk can reach the failure point again.
//
// Boundary: only machine journals (*.ndjson append logs) are ever rotated.
// Conversation memory (thread-history/*.json, thread-state/*.json), queues
// (inbox/outbox *.json) and form ledgers are never touched.
const fs = require('fs')
const path = require('path')
const {
  redactedPathList,
  artifactSha256,
  errorMetrics
} = require(path.join(__dirname, 'scv-machine-log.js'))

const ROOT = process.env.SCV_ROOT || __dirname
const LOCK_VERSION = 'scv-disk-guardian-lock-2026-07-29-v1'
const DEFAULT_INTERVAL_MS = Number(process.env.SCV_DISK_GUARDIAN_INTERVAL_MS || 10 * 60 * 1000)
const WARN_PCT = Number(process.env.SCV_DISK_GUARDIAN_WARN_PCT || 70)
const CRITICAL_PCT = Number(process.env.SCV_DISK_GUARDIAN_CRITICAL_PCT || 85)
const NDJSON_MAX_BYTES = Number(process.env.SCV_DISK_GUARDIAN_NDJSON_MAX_BYTES || 5 * 1024 * 1024)
const NDJSON_KEEP_BYTES = Number(process.env.SCV_DISK_GUARDIAN_NDJSON_KEEP_BYTES || 1024 * 1024)
// Below this much free space, persistence is considered at risk regardless of
// percentage (small volumes can sit "green" by pct while too full to work).
const EMERGENCY_FREE_FLOOR_BYTES = Number(process.env.SCV_DISK_GUARDIAN_FREE_FLOOR_BYTES || 64 * 1024 * 1024)
const SCAN_DEPTH = Number(process.env.SCV_DISK_GUARDIAN_SCAN_DEPTH || 3)

// The state dirs are symlinks into the persistent volume (/app/inbox ->
// /data/...). statfs on the app dir itself measures the container overlay fs
// (terabytes, never full) and would miss the small volume actually at risk —
// live boot receipt 2026-07-29 showed exactly that (3.1TB/40.8% instead of
// 5GB/7%). Anchor usage measurement on where the queues really live.
function volumeAnchorPath(root = ROOT) {
  for (const name of ['inbox', 'thread-state', 'logs']) {
    try { return fs.realpathSync(path.join(root, name)) } catch {}
  }
  return root
}

function getDiskUsage(root = ROOT) {
  try {
    const s = fs.statfsSync(volumeAnchorPath(root))
    const total = Number(s.blocks) * Number(s.bsize)
    const free = Number(s.bavail) * Number(s.bsize)
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)) return null
    return {
      total_bytes: total,
      free_bytes: free,
      used_pct: Math.round(((total - free) / total) * 1000) / 10
    }
  } catch {
    return null
  }
}

// State dirs are symlinks into the /data volume, so directory checks must
// follow links (Dirent.isDirectory() is false for a symlinked dir).
function isDirectoryFollowingLinks(entry, fullPath) {
  if (entry.isDirectory()) return true
  if (!entry.isSymbolicLink()) return false
  try { return fs.statSync(fullPath).isDirectory() } catch { return false }
}

function listMachineJournals(root = ROOT, depth = SCAN_DEPTH) {
  const out = []
  const seenDirs = new Set()
  const walk = (dir, level) => {
    let real
    try { real = fs.realpathSync(dir) } catch { return }
    if (seenDirs.has(real)) return
    seenDirs.add(real)
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const fullPath = path.join(dir, entry.name)
      if (isDirectoryFollowingLinks(entry, fullPath)) {
        if (level < depth) walk(fullPath, level + 1)
      } else if (entry.name.endsWith('.ndjson')) {
        out.push(fullPath)
      }
    }
  }
  walk(root, 0)
  return out
}

function rotateJournalKeepTail(file, { maxBytes = NDJSON_MAX_BYTES, keepBytes = NDJSON_KEEP_BYTES } = {}) {
  let size
  try { size = fs.statSync(file).size } catch { return { file, rotated: false, reason: 'stat_failed' } }
  if (size <= maxBytes) return { file, rotated: false, reason: 'under_cap', size }
  try {
    const fd = fs.openSync(file, 'r')
    const start = Math.max(0, size - keepBytes)
    const buf = Buffer.alloc(Math.min(keepBytes, size))
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    const text = buf.toString('utf8')
    const firstNewline = text.indexOf('\n')
    const tail = firstNewline >= 0 ? text.slice(firstNewline + 1) : text
    const tmp = `${file}.rotate-tmp`
    fs.writeFileSync(tmp, tail)
    fs.renameSync(tmp, file)
    return { file, rotated: true, previous_bytes: size, kept_bytes: Buffer.byteLength(tail) }
  } catch (err) {
    // Hard-full disk can refuse even the 1MB tmp write. Truncating in place
    // drops the journal tail, but restoring inbound persistence outranks
    // machine history.
    try {
      fs.truncateSync(file, 0)
      return { file, rotated: true, truncated_in_place: true, previous_bytes: size }
    } catch (err2) {
      return { file, rotated: false, reason: String((err2 && err2.message) || err2 || (err && err.message) || err) }
    }
  }
}

function emergencyDiskRelief(root = ROOT, options = {}) {
  const results = listMachineJournals(root).map((file) => rotateJournalKeepTail(file, options))
  const rotated = results.filter((r) => r.rotated)
  if (rotated.length) {
    console.log('===SCV_DISK_RELIEF===')
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      lock_version: LOCK_VERSION,
      rotated_count: rotated.length,
      rotated_paths: redactedPathList(rotated.map((entry) => entry.file)),
      previous_bytes: rotated.reduce((sum, entry) => sum + Number(entry.previous_bytes || 0), 0),
      kept_bytes: rotated.reduce((sum, entry) => sum + Number(entry.kept_bytes || 0), 0)
    }))
  }
  return { rotated_count: rotated.length, results }
}

function diskNeedsEmergencyRelief(root = ROOT, usage = undefined) {
  const u = usage === undefined ? getDiskUsage(root) : usage
  if (!u) return false
  return u.free_bytes < EMERGENCY_FREE_FLOOR_BYTES || u.used_pct >= CRITICAL_PCT
}

function writeDiskAlert(root, usage, relief, now = Date.now()) {
  try {
    const dir = path.join(root, 'outbox_human_agent_required')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `disk-guardian-alert-${now}.json`)
    fs.writeFileSync(file, JSON.stringify({
      type: 'disk_guardian_critical_alert',
      manual_reason: 'disk_usage_critical_auto_relief_executed',
      at: new Date(now).toISOString(),
      usage,
      relief_rotated: relief ? relief.rotated_count : 0,
      lock_version: LOCK_VERSION
    }, null, 2) + '\n')
    return file
  } catch {
    return null
  }
}

function runDiskGuardianOnce({ root = ROOT, now = Date.now(), usageOverride = undefined } = {}) {
  const usage = usageOverride === undefined ? getDiskUsage(root) : usageOverride
  const receipt = {
    event: 'scv_disk_guardian_tick',
    lock_version: LOCK_VERSION,
    usage,
    warn_pct: WARN_PCT,
    critical_pct: CRITICAL_PCT
  }
  if (!usage) {
    receipt.status = 'usage_unavailable'
    return receipt
  }
  if (diskNeedsEmergencyRelief(root, usage)) {
    const relief = emergencyDiskRelief(root)
    receipt.status = 'critical_relief_executed'
    receipt.relief_rotated = relief.rotated_count
    receipt.alert_file = writeDiskAlert(root, usage, relief, now)
  } else if (usage.used_pct >= WARN_PCT) {
    receipt.status = 'warn'
  } else {
    receipt.status = 'ok'
  }
  return receipt
}

function diskGuardianLogSummary(receipt = {}) {
  return {
    ...receipt,
    alert_file: undefined,
    alert_file_hmac_sha256: artifactSha256(receipt.alert_file)
  }
}

let _running = false
function startDiskGuardianLoop({ root = ROOT, intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const tick = () => {
    if (_running) return
    _running = true
    try {
      const receipt = runDiskGuardianOnce({ root })
      console.log(JSON.stringify(diskGuardianLogSummary(receipt)))
    } catch (err) {
      console.error(JSON.stringify({ event: 'scv_disk_guardian_failed', ...errorMetrics(err) }))
    } finally {
      _running = false
    }
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  if (timer.unref) timer.unref()
  console.log(JSON.stringify({
    event: 'scv_disk_guardian_loop_started',
    lock_version: LOCK_VERSION,
    interval_ms: intervalMs,
    warn_pct: WARN_PCT,
    critical_pct: CRITICAL_PCT,
    ndjson_max_bytes: NDJSON_MAX_BYTES,
    free_floor_bytes: EMERGENCY_FREE_FLOOR_BYTES
  }))
  return timer
}

if (require.main === module) {
  if (process.argv.includes('--loop')) {
    startDiskGuardianLoop({})
    setInterval(() => {}, 1 << 30) // keep the process alive for cloud-start's supervisor
  } else {
    console.log(JSON.stringify(diskGuardianLogSummary(runDiskGuardianOnce({})), null, 2))
  }
}

module.exports = {
  LOCK_VERSION,
  DEFAULT_INTERVAL_MS,
  WARN_PCT,
  CRITICAL_PCT,
  NDJSON_MAX_BYTES,
  NDJSON_KEEP_BYTES,
  EMERGENCY_FREE_FLOOR_BYTES,
  volumeAnchorPath,
  getDiskUsage,
  listMachineJournals,
  rotateJournalKeepTail,
  emergencyDiskRelief,
  diskNeedsEmergencyRelief,
  writeDiskAlert,
  runDiskGuardianOnce,
  diskGuardianLogSummary,
  startDiskGuardianLoop
}
