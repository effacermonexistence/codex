#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const ROOT = process.env.SCV_ROOT || __dirname
const THREAD_STATE_DIR = path.join(ROOT, 'thread-state')
const THREAD_HISTORY_DIR = path.join(ROOT, 'thread-history')
const STATE_QUARANTINE_DIR = path.join(ROOT, 'thread-state_quarantine_contaminated')
const HISTORY_QUARANTINE_DIR = path.join(ROOT, 'thread-history_quarantine_contaminated')

const ALLOWED_HISTORY_ROLES = new Set([
  'user',
  'assistant',
  'assistant_attempted',
  'assistant_human_agent_required'
])

function ensureStateQuarantineDirs() {
  fs.mkdirSync(THREAD_STATE_DIR, { recursive: true })
  fs.mkdirSync(THREAD_HISTORY_DIR, { recursive: true })
  fs.mkdirSync(STATE_QUARANTINE_DIR, { recursive: true })
  fs.mkdirSync(HISTORY_QUARANTINE_DIR, { recursive: true })
}

function safeThreadKey(thread_id) {
  return String(thread_id || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function threadStatePath(thread_id) {
  return path.join(THREAD_STATE_DIR, `${safeThreadKey(thread_id)}.json`)
}

function threadHistoryPath(thread_id) {
  return path.join(THREAD_HISTORY_DIR, `${safeThreadKey(thread_id)}.json`)
}

function quarantinePath(destDir, file, reason) {
  const base = path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_')
  const stamp = new Date().toISOString().replace(/[^0-9T]/g, '').slice(0, 15)
  return path.join(destDir, `${stamp}--${reason}--${base}`)
}

function quarantineFile(file, destDir, reason, details = {}) {
  ensureStateQuarantineDirs()
  const dest = quarantinePath(destDir, file, String(reason || 'contaminated').replace(/[^a-zA-Z0-9._-]/g, '_'))
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch {}
  const payload = {
    quarantined_at: new Date().toISOString(),
    source_file: file,
    reason: String(reason || 'contaminated'),
    details,
    raw
  }
  fs.writeFileSync(dest, JSON.stringify(payload, null, 2) + '\n')
  try { fs.unlinkSync(file) } catch {}
  return dest
}

function parseJsonOrQuarantine(file, destDir) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) }
  } catch (err) {
    const dest = quarantineFile(file, destDir, 'invalid_json', { error: String(err?.message || err) })
    return { ok: false, reason: 'invalid_json', quarantine_file: dest }
  }
}

function parseTimeMs(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function isFutureSkew(value, maxSkewMs = 10 * 60 * 1000) {
  const parsed = parseTimeMs(value)
  return parsed && parsed > Date.now() + maxSkewMs
}

function hasInternalLeak(text) {
  return /\b(prompt_sha256|input_sha256|codex_exec_dm_authority|semantic_contract_harness|SCV_ROOT|OPENAI_API_KEY|MANYCHAT_API_KEY|Bearer\s+[A-Za-z0-9._-]+)\b/i.test(String(text || ''))
}

function validateThreadStateObject(obj, expectedThreadId = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { valid: false, reason: 'state_not_object' }
  const threadId = String(obj.thread_id || obj.contact_id || '').trim()
  if (!threadId) return { valid: false, reason: 'state_missing_thread_id' }
  if (expectedThreadId && safeThreadKey(threadId) !== safeThreadKey(expectedThreadId)) {
    return { valid: false, reason: 'state_thread_id_mismatch', thread_id: threadId, expected_thread_id: expectedThreadId }
  }
  if (isFutureSkew(obj.received_at)) return { valid: false, reason: 'state_received_at_future_skew', received_at: obj.received_at }
  if (String(obj.text || '').length > 5000) return { valid: false, reason: 'state_text_too_long' }
  if (hasInternalLeak(obj.text)) return { valid: false, reason: 'state_internal_leak' }
  return { valid: true }
}

function validateThreadHistoryObject(obj, expectedThreadId = '') {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { valid: false, reason: 'history_not_object' }
  const threadId = String(obj.thread_id || obj.contact_id || '').trim()
  if (!threadId) return { valid: false, reason: 'history_missing_thread_id' }
  if (expectedThreadId && safeThreadKey(threadId) !== safeThreadKey(expectedThreadId)) {
    return { valid: false, reason: 'history_thread_id_mismatch', thread_id: threadId, expected_thread_id: expectedThreadId }
  }
  if (!Array.isArray(obj.events)) return { valid: false, reason: 'history_events_not_array' }
  if (obj.events.length > 500) return { valid: false, reason: 'history_events_unbounded', count: obj.events.length }
  for (let idx = 0; idx < obj.events.length; idx += 1) {
    const event = obj.events[idx]
    if (!event || typeof event !== 'object' || Array.isArray(event)) return { valid: false, reason: 'history_event_not_object', index: idx }
    const role = String(event.role || '').trim()
    if (!ALLOWED_HISTORY_ROLES.has(role)) return { valid: false, reason: 'history_event_role_invalid', role, index: idx }
    if (String(event.text || '').length > 5000) return { valid: false, reason: 'history_event_text_too_long', index: idx }
    if (hasInternalLeak(event.text)) return { valid: false, reason: 'history_event_internal_leak', index: idx }
    if (isFutureSkew(event.at)) return { valid: false, reason: 'history_event_at_future_skew', at: event.at, index: idx }
  }
  return { valid: true }
}

function loadCleanThreadState(thread_id) {
  ensureStateQuarantineDirs()
  const file = threadStatePath(thread_id)
  if (!fs.existsSync(file)) return null
  const parsed = parseJsonOrQuarantine(file, STATE_QUARANTINE_DIR)
  if (!parsed.ok) return null
  const verdict = validateThreadStateObject(parsed.value, thread_id)
  if (!verdict.valid) {
    quarantineFile(file, STATE_QUARANTINE_DIR, verdict.reason, verdict)
    return null
  }
  return parsed.value
}

function loadCleanThreadHistory(thread_id) {
  ensureStateQuarantineDirs()
  const file = threadHistoryPath(thread_id)
  if (!fs.existsSync(file)) return null
  const parsed = parseJsonOrQuarantine(file, HISTORY_QUARANTINE_DIR)
  if (!parsed.ok) return null
  const verdict = validateThreadHistoryObject(parsed.value, thread_id)
  if (!verdict.valid) {
    quarantineFile(file, HISTORY_QUARANTINE_DIR, verdict.reason, verdict)
    return null
  }
  return parsed.value
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name))
}

function runStateQuarantineSweep() {
  ensureStateQuarantineDirs()
  const result = {
    ok: true,
    checked_state: 0,
    checked_history: 0,
    quarantined: []
  }

  for (const file of listJsonFiles(THREAD_STATE_DIR)) {
    result.checked_state += 1
    const expected = path.basename(file, '.json')
    const parsed = parseJsonOrQuarantine(file, STATE_QUARANTINE_DIR)
    if (!parsed.ok) {
      result.quarantined.push({ file, reason: parsed.reason, quarantine_file: parsed.quarantine_file })
      continue
    }
    const verdict = validateThreadStateObject(parsed.value, expected)
    if (!verdict.valid) {
      const dest = quarantineFile(file, STATE_QUARANTINE_DIR, verdict.reason, verdict)
      result.quarantined.push({ file, reason: verdict.reason, quarantine_file: dest })
    }
  }

  for (const file of listJsonFiles(THREAD_HISTORY_DIR)) {
    result.checked_history += 1
    const expected = path.basename(file, '.json')
    const parsed = parseJsonOrQuarantine(file, HISTORY_QUARANTINE_DIR)
    if (!parsed.ok) {
      result.quarantined.push({ file, reason: parsed.reason, quarantine_file: parsed.quarantine_file })
      continue
    }
    const verdict = validateThreadHistoryObject(parsed.value, expected)
    if (!verdict.valid) {
      const dest = quarantineFile(file, HISTORY_QUARANTINE_DIR, verdict.reason, verdict)
      result.quarantined.push({ file, reason: verdict.reason, quarantine_file: dest })
    }
  }

  result.ok = result.quarantined.length === 0
  return result
}

if (require.main === module) {
  const result = runStateQuarantineSweep()
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

module.exports = {
  ensureStateQuarantineDirs,
  safeThreadKey,
  threadStatePath,
  threadHistoryPath,
  loadCleanThreadState,
  loadCleanThreadHistory,
  runStateQuarantineSweep,
  validateThreadStateObject,
  validateThreadHistoryObject
}
