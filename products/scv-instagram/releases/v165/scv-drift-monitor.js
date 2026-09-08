#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const {
  SCV_CONTRACT_HARNESS_LOCK_VERSION,
  packetLiteralizesEmojiName,
  packetHasNamePhoneDateTimeDoubleCheck,
  liveConfirmsDoubleCheck,
  packetSendsDepositDetails,
  packetGatesExactAddressBehindDeposit,
  formPermissionTextWasAsked,
  PREFERRED_FORM_LINK
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  runStateQuarantineSweep
} = require(path.join(__dirname, 'scv-state-quarantine.js'))
const {
  SCV_DELIVERY_PACING_LOCK_VERSION
} = require(path.join(__dirname, 'scv-delivery-pacing.js'))
const {
  SCV_HARD_HARNESS_LOCK_VERSION,
  runScvHardHarnessLock
} = require(path.join(__dirname, 'scv-hard-harness-lock.js'))
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))
const { hmacSha256, errorMetrics } = require(path.join(__dirname, 'scv-machine-log.js'))
const {
  activateFailClose,
  readFailClose,
  isProductionEnv
} = require(path.join(__dirname, 'scv-golden-fail-close.js'))
const {
  operatorPauseReasonForPacket
} = require(path.join(__dirname, 'scv-pause-gate.js'))

// Tests may isolate mutable drift receipts without changing SCV_ROOT, because
// SCV_ROOT is also the authority root used by the nested hard harness.
const ROOT = process.env.SCV_DRIFT_ROOT || process.env.SCV_ROOT || __dirname
const {
  deliveryVisibilityAlerts
} = require(path.join(__dirname, 'scv-delivery-visibility.js'))
const DELIVERY_VISIBILITY_ALERT_AFTER_MS = Math.max(
  60000,
  Number(process.env.SCV_DELIVERY_VISIBILITY_ALERT_AFTER_MS || (15 * 60 * 1000))
)
const LOG_DIR = path.join(ROOT, 'logs')
const DRIFT_ALERTS_FILE = path.join(LOG_DIR, 'drift-alerts.ndjson')
const DRIFT_STATUS_FILE = path.join(LOG_DIR, 'drift-status.json')
const MONITOR_INTERVAL_MS = Math.max(5000, Number(process.env.SCV_DRIFT_MONITOR_INTERVAL_MS || 60000))
const QUEUE_STALE_MS = Math.max(60000, Number(process.env.SCV_QUEUE_STALE_MS || (10 * 60 * 1000)))

const SCV_DRIFT_STATUS_SCHEMA = 'scv-drift-status-2026-09-01-v4-causal-queue-hold'
const OPERATIONAL_ALERT_REASONS = new Set([
  // A quarantine is durable evidence that a packet was held instead of being
  // delivered unsafely. It remains visible and actionable, but an old held
  // packet is not proof that the sealed runtime contract itself has drifted.
  'quarantine_not_empty',
  // Queue files deliberately held by the operator's test-only policy are not
  // proof of runtime drift. Likewise, once a verified persistent latch is
  // active, packets received after activation are consequences of that latch,
  // not independent causes. Both remain visible as operational debt.
  'queue_file_intentionally_held',
  'queue_file_blocked_by_fail_close',
  // Provider-accepted replies whose Instagram visibility was never confirmed.
  // Production has no thread client, so this backlog is honest operational
  // debt that must stay visible; it is not runtime drift and never latches.
  'delivery_visibility_unconfirmed_backlog'
])

const QUEUE_DIRS = [
  'inbox',
  'outbox',
  'reactbox'
]

const QUARANTINE_DIRS = [
  'inbox_quarantine_deadletter',
  'outbox_quarantine_contract_harness',
  'outbox_quarantine_failed',
  'outbox_human_agent_required',
  'thread-state_quarantine_contaminated',
  'thread-history_quarantine_contaminated'
]

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

function appendNdjson(file, obj) {
  ensureLogDir()
  fs.appendFileSync(file, JSON.stringify(obj) + '\n')
}

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return []
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFilesRecursive(file))
    else if (entry.isFile()) files.push(file)
  }
  return files
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function driftAlertSeverity(alert = {}) {
  return OPERATIONAL_ALERT_REASONS.has(String(alert.reason || ''))
    ? 'operational'
    : 'critical'
}

function classifyDriftAlerts(alerts = []) {
  const classified = (Array.isArray(alerts) ? alerts : []).map((alert) => ({
    ...alert,
    severity: driftAlertSeverity(alert)
  }))
  const critical = classified.filter((alert) => alert.severity === 'critical')
  const operational = classified.filter((alert) => alert.severity === 'operational')
  return {
    alerts: classified,
    critical,
    operational,
    critical_ok: critical.length === 0
  }
}

function criticalDriftReasons(status = {}) {
  const alerts = Array.isArray(status.alerts) ? status.alerts : []
  const reasons = alerts
    .filter((alert) => String(alert?.severity || driftAlertSeverity(alert)) === 'critical')
    .map((alert) => String(alert?.reason || '').slice(0, 160))
    .filter(Boolean)
  return Array.from(new Set(reasons.length ? reasons : ['critical_drift_unknown']))
}

// Bridge drift detection into the same persistent latch read by the queue,
// final sender, and reaction gates. In production, a critical drift result is
// therefore a durable stop signal rather than a monitoring-only notification.
function enforceCriticalDriftFailClose(status = {}, {
  env = process.env,
  root = env.SCV_ROOT || ROOT,
  activateFn = activateFailClose
} = {}) {
  const required = status.critical_ok === false || Number(status.critical_alert_count || 0) > 0
  if (!required || !isProductionEnv(env)) {
    return {
      required,
      production: isProductionEnv(env),
      activated: false,
      reason: required ? 'non_production_no_persistent_latch' : 'critical_drift_clear'
    }
  }
  const failedChecks = criticalDriftReasons(status)
  const activation = activateFn({
    env,
    root,
    releaseId: String(env.SCV_RELEASE_ID || ''),
    releaseFingerprint: String(env.SCV_CONTENT_FINGERPRINT || ''),
    reason: 'critical_drift_detected',
    failedChecks,
    detail: {
      drift_status_schema: String(status.schema || SCV_DRIFT_STATUS_SCHEMA),
      critical_alert_count: Number(status.critical_alert_count || failedChecks.length),
      critical_reasons: failedChecks
    }
  })
  return {
    required: true,
    production: true,
    activated: activation?.state?.active === true,
    reason: 'critical_drift_detected'
  }
}

function enforceDriftMonitorErrorFailClose(error, options = {}) {
  return enforceCriticalDriftFailClose({
    schema: SCV_DRIFT_STATUS_SCHEMA,
    critical_ok: false,
    critical_alert_count: 1,
    alerts: [{ reason: 'drift_monitor_execution_error', severity: 'critical' }]
  }, options)
}

function packetFromText(text) {
  return { bubbles: [{ text: String(text || '') }] }
}

function eventInput(historyEvents, idx) {
  const recent = historyEvents.slice(Math.max(0, idx - 8), idx).map((event) => ({
    role: isConversationVisibleAssistantEvent(event) ? 'assistant' : String(event.role || ''),
    text: String(event.text || event.message || ''),
    message_id: String(event.message_id || '')
  }))
  const live = historyEvents[idx] || {}
  return {
    message: String(live.text || live.message || ''),
    recent_history: recent,
    structured_state: {}
  }
}

function hasConsecutiveDuplicateAssistant(events, idx) {
  const event = events[idx]
  if (!isConversationVisibleAssistantEvent(event)) return false
  const text = normalizeText(event?.text || '')
  if (!text) return false
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = events[i]
    if (!isConversationVisibleAssistantEvent(prev)) continue
    return normalizeText(prev?.text || '') === text
  }
  return false
}

function scanThreadHistory(file) {
  const history = safeReadJson(file)
  const events = Array.isArray(history?.events) ? history.events : []
  const alerts = []
  let formOfferSeen = false
  let formLinkSeen = false

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    const text = String(event?.text || '')
    if (!text) continue

    if (isConversationVisibleAssistantEvent(event)) {
      const packet = packetFromText(text)
      const asksFormPermission = formPermissionTextWasAsked(text)
      const sendsFormLink = text.includes(PREFERRED_FORM_LINK)
      if (sendsFormLink) formLinkSeen = true
      if (asksFormPermission) {
        if (formOfferSeen || formLinkSeen) {
          alerts.push({ reason: 'repeated_form_link_permission_offer_visible_history', file, index: i, message_id: event.message_id || '', text: text.slice(0, 180) })
        }
        formOfferSeen = true
      }
      if (packetLiteralizesEmojiName(packet)) {
        alerts.push({ reason: 'emoji_name_literalization_visible_history', file, index: i, message_id: event.message_id || '' })
      }
      if (packetGatesExactAddressBehindDeposit(packet)) {
        alerts.push({ reason: 'address_gated_behind_deposit_visible_history', file, index: i, message_id: event.message_id || '' })
      }
      if (hasConsecutiveDuplicateAssistant(events, i)) {
        alerts.push({ reason: 'duplicate_assistant_text_visible_history', file, index: i, message_id: event.message_id || '' })
      }
    }

    if (String(event.role || '') === 'user' && liveConfirmsDoubleCheck(eventInput(events, i))) {
      const prior = events.slice(Math.max(0, i - 8), i)
      const sawDoubleCheck = prior.some((prev) => (
        isConversationVisibleAssistantEvent(prev) &&
        packetHasNamePhoneDateTimeDoubleCheck(packetFromText(prev.text || ''))
      ))
      if (sawDoubleCheck) {
        const nextAssistant = events.slice(i + 1).find(isConversationVisibleAssistantEvent)
        if (nextAssistant && !packetSendsDepositDetails(packetFromText(nextAssistant.text || ''))) {
          alerts.push({ reason: 'double_check_confirmed_without_deposit_history', file, index: i, message_id: event.message_id || '', next_text: String(nextAssistant.text || '').slice(0, 180) })
        }
      }
    }
  }

  return alerts
}

function scanQueueDir(dirName, {
  env = process.env,
  root = ROOT,
  now = Date.now(),
  failClose = readFailClose({ env, root })
} = {}) {
  const dir = path.join(root, dirName)
  const files = listFilesRecursive(dir)
  const stale = []
  const intentionally_held = []
  const blocked_by_fail_close = []
  const future_due = []
  const failCloseActivatedMs = Number.isFinite(Date.parse(String(failClose?.activated_at_utc || '')))
    ? Date.parse(String(failClose.activated_at_utc))
    : 0
  for (const file of files) {
    try {
      const stat = fs.statSync(file)
      const packet = safeReadJson(file)
      const dueAtMs = Number.isFinite(Date.parse(String(packet?.due_at || ''))) ? Date.parse(String(packet?.due_at || '')) : null
      if (dirName === 'outbox' && dueAtMs && dueAtMs > now) {
        future_due.push({ file, due_in_ms: Math.round(dueAtMs - now) })
        continue
      }
      const ageBasisMs = dirName === 'outbox' && dueAtMs ? dueAtMs : stat.mtimeMs
      if (now - ageBasisMs > QUEUE_STALE_MS) {
        const entry = {
          file,
          age_ms: Math.round(now - ageBasisMs),
          due_at: dueAtMs ? new Date(dueAtMs).toISOString() : undefined
        }
        const operatorHoldReason = packet
          ? operatorPauseReasonForPacket(packet, env)
          : ''
        if (operatorHoldReason) {
          intentionally_held.push({ ...entry, hold_reason: operatorHoldReason })
        } else if (
          failClose?.active === true &&
          failCloseActivatedMs > 0 &&
          stat.mtimeMs >= failCloseActivatedMs
        ) {
          blocked_by_fail_close.push({
            ...entry,
            latch_activated_at_utc: String(failClose.activated_at_utc || '')
          })
        } else {
          stale.push(entry)
        }
      }
    } catch {}
  }
  return {
    dir: dirName,
    count: files.length,
    stale,
    intentionally_held: intentionally_held.slice(0, 10),
    blocked_by_fail_close: blocked_by_fail_close.slice(0, 10),
    future_due: future_due.slice(0, 10)
  }
}

function scanQuarantineDir(dirName) {
  const dir = path.join(ROOT, dirName)
  const files = listFilesRecursive(dir)
  return { dir: dirName, count: files.length, recent: files.slice(-5) }
}

function runScvDriftMonitorOnce() {
  ensureLogDir()
  const stateSweep = runStateQuarantineSweep()
  const alerts = []
  const pausedMaintenance = String(process.env.SCV_PAUSE_ALL || '') === '1'
  const existingFailClose = readFailClose({ env: process.env, root: ROOT })

  for (const file of listFilesRecursive(path.join(ROOT, 'thread-history')).filter((name) => name.endsWith('.json'))) {
    alerts.push(...scanThreadHistory(file))
  }

  const queues = QUEUE_DIRS.map((dir) => scanQueueDir(dir, {
    env: process.env,
    root: ROOT,
    failClose: existingFailClose
  }))
  if (!pausedMaintenance) {
    for (const queue of queues) {
      for (const stale of queue.stale) {
        alerts.push({ reason: 'queue_file_stale', queue: queue.dir, file: stale.file, age_ms: stale.age_ms })
      }
      for (const held of queue.intentionally_held) {
        alerts.push({
          reason: 'queue_file_intentionally_held',
          queue: queue.dir,
          file: held.file,
          age_ms: held.age_ms,
          hold_reason: held.hold_reason
        })
      }
      for (const blocked of queue.blocked_by_fail_close) {
        alerts.push({
          reason: 'queue_file_blocked_by_fail_close',
          queue: queue.dir,
          file: blocked.file,
          age_ms: blocked.age_ms,
          latch_activated_at_utc: blocked.latch_activated_at_utc
        })
      }
    }
  }

  const quarantines = QUARANTINE_DIRS.map(scanQuarantineDir)
  if (!pausedMaintenance) {
    for (const q of quarantines) {
      if (q.count > 0) {
        alerts.push({ reason: 'quarantine_not_empty', dir: q.dir, count: q.count, recent: q.recent })
      }
    }
  }

  for (const quarantined of stateSweep.quarantined || []) {
    alerts.push({ reason: 'state_quarantine_sweep_moved_file', ...quarantined })
  }

  // 2026-09-02 transport truthfulness: keep the visibility-unconfirmed backlog
  // visible as an operational (never critical) alert.
  try {
    alerts.push(...deliveryVisibilityAlerts(ROOT, { alertAfterMs: DELIVERY_VISIBILITY_ALERT_AFTER_MS }))
  } catch (err) {
    alerts.push({
      reason: 'delivery_visibility_unconfirmed_backlog',
      ledger_read_error: String(err && err.message ? err.message : err).slice(0, 300)
    })
  }

  let hardHarness = null
  try {
    hardHarness = runScvHardHarnessLock()
  } catch (err) {
    hardHarness = { ok: false, lock_version: SCV_HARD_HARNESS_LOCK_VERSION, error: String(err && err.message ? err.message : err), failures: err.failures || [] }
    alerts.push({ reason: 'hard_harness_lock_failed', hard_harness: hardHarness })
  }

  const classified = classifyDriftAlerts(alerts)
  const classifiedAlerts = classified.alerts
  const criticalAlerts = classified.critical
  const operationalAlerts = classified.operational

  const status = {
    schema: SCV_DRIFT_STATUS_SCHEMA,
    ok: alerts.length === 0,
    critical_ok: classified.critical_ok,
    at: new Date().toISOString(),
    lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION,
    delivery_pacing_lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
    hard_harness_lock_version: SCV_HARD_HARNESS_LOCK_VERSION,
    hard_harness: hardHarness,
    paused_maintenance: pausedMaintenance,
    alert_count: classifiedAlerts.length,
    critical_alert_count: criticalAlerts.length,
    operational_alert_count: operationalAlerts.length,
    alerts: classifiedAlerts.slice(-50),
    queues,
    quarantines,
    state_sweep: stateSweep
  }

  const enforcement = enforceCriticalDriftFailClose(status)
  status.fail_close_required = enforcement.required === true
  status.fail_close_activated = enforcement.activated === true
  status.fail_close_reason = String(enforcement.reason || '')

  fs.writeFileSync(DRIFT_STATUS_FILE, JSON.stringify(status, null, 2) + '\n', { mode: 0o600 })
  if (alerts.length) {
    appendNdjson(DRIFT_ALERTS_FILE, {
      at: status.at,
      lock_version: SCV_CONTRACT_HARNESS_LOCK_VERSION,
      alert_count: classifiedAlerts.length,
      critical_alert_count: criticalAlerts.length,
      operational_alert_count: operationalAlerts.length,
      alerts: classifiedAlerts.slice(-25)
    })
  }

  return status
}

function driftStatusLogSummary(status = {}) {
  const alerts = Array.isArray(status.alerts) ? status.alerts : []
  const alertReasons = alerts.map((alert) => String(alert?.reason || '')).sort()
  return {
    ok: status.ok === true,
    critical_ok: status.critical_ok === true,
    at: String(status.at || ''),
    lock_version: String(status.lock_version || ''),
    delivery_pacing_lock_version: String(status.delivery_pacing_lock_version || ''),
    hard_harness_lock_version: String(status.hard_harness_lock_version || ''),
    alert_count: Number(status.alert_count || alerts.length || 0),
    critical_alert_count: Number(status.critical_alert_count || 0),
    operational_alert_count: Number(status.operational_alert_count || 0),
    alert_reasons_hmac_sha256: hmacSha256(alertReasons.join('\n')),
    queue_count: Array.isArray(status.queues) ? status.queues.length : 0,
    quarantine_count: Array.isArray(status.quarantines) ? status.quarantines.length : 0
  }
}

async function loop() {
  while (true) {
    try {
      const status = runScvDriftMonitorOnce()
      console.log(JSON.stringify({ event: 'scv_drift_monitor_tick', ...driftStatusLogSummary(status) }))
    } catch (err) {
      let failClose = null
      try {
        failClose = enforceDriftMonitorErrorFailClose(err)
      } catch (activationError) {
        console.error(JSON.stringify({
          event: 'scv_drift_monitor_fail_close_error',
          ...errorMetrics(activationError)
        }))
      }
      console.error(JSON.stringify({
        event: 'scv_drift_monitor_error',
        fail_close_required: failClose?.required === true,
        fail_close_activated: failClose?.activated === true,
        ...errorMetrics(err)
      }))
    }
    await new Promise((resolve) => setTimeout(resolve, MONITOR_INTERVAL_MS))
  }
}

if (require.main === module) {
  if (process.argv.includes('--loop')) {
    loop()
  } else {
    const status = runScvDriftMonitorOnce()
    process.stdout.write(JSON.stringify(status, null, 2) + '\n')
    if (!status.ok && process.argv.includes('--fail-on-alert')) process.exit(1)
  }
}

module.exports = {
  SCV_DRIFT_STATUS_SCHEMA,
  runScvDriftMonitorOnce,
  driftStatusLogSummary,
  scanThreadHistory,
  scanQueueDir,
  driftAlertSeverity,
  classifyDriftAlerts,
  criticalDriftReasons,
  enforceCriticalDriftFailClose,
  enforceDriftMonitorErrorFailClose
}
