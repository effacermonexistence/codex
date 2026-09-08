#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const ROOT = process.env.SCV_ROOT || __dirname
const INBOUND_PATH = path.join(ROOT, 'inbound-scv.js')
const RUNNER_PATH = path.join(ROOT, 'codex-dm-runner.js')

function replaceOnce(text, oldText, newText, label, missing) {
  if (text.includes(newText)) return text
  if (!text.includes(oldText)) {
    missing.push(label)
    return text
  }
  return text.replace(oldText, newText)
}

function hasExplicitEnvValue(name) {
  return Object.prototype.hasOwnProperty.call(process.env, name) && String(process.env[name] || '').trim() !== ''
}

function enforceRuntimeDelayHarness() {
  process.env.SCV_FAST_TARGET_USERNAMES = process.env.SCV_FAST_TARGET_USERNAMES || process.env.SCV_PURGE_TEST_USERNAMES || 'omar.system'
  process.env.SCV_FAST_TARGET_DELAY_MULTIPLIER = process.env.SCV_FAST_TARGET_DELAY_MULTIPLIER || '0'
  process.env.SCV_FAST_TARGET_FORCE_ZERO = process.env.SCV_FAST_TARGET_FORCE_ZERO || '1'

  if (!hasExplicitEnvValue('SCV_FIRST_BUBBLE_MIN_DELAY_MS')) {
    process.env.SCV_FIRST_BUBBLE_MIN_DELAY_MS = '600000'
  }
  if (!hasExplicitEnvValue('SCV_FIRST_BUBBLE_MAX_DELAY_MS')) {
    process.env.SCV_FIRST_BUBBLE_MAX_DELAY_MS = '1800000'
  }

  console.log(JSON.stringify({
    event: 'scv_runtime_delay_harness',
    mode: 'delay_and_semantic_no_visible_script_copy_respects_explicit_test_zero',
    first_bubble_min_delay_ms: process.env.SCV_FIRST_BUBBLE_MIN_DELAY_MS,
    first_bubble_max_delay_ms: process.env.SCV_FIRST_BUBBLE_MAX_DELAY_MS,
    fast_target_usernames: process.env.SCV_FAST_TARGET_USERNAMES,
    fast_target_force_zero: process.env.SCV_FAST_TARGET_FORCE_ZERO
  }))
}

function patchInboundMediaRecovery() {
  const missing = []
  let text = fs.readFileSync(INBOUND_PATH, 'utf8')

  text = replaceOnce(
    text,
    "function looksLikeHumanText(value) {\n  const text = String(value || '').trim()\n  if (!text) return false\n  if (/^https?:\\/\\//i.test(text)) return false",
    "function isInboundMediaReferenceUrl(value) {\n  const text = String(value || '').trim()\n  if (!text) return false\n  if (/^https?:\\/\\/lookaside\\.fbsbx\\.com\\/ig_messaging_cdn\\//i.test(text)) return true\n  return /^https?:\\/\\/.+\\.(jpg|jpeg|png|gif|webp|mp4|mov|m4v)(\\?|$)/i.test(text)\n}\n\nfunction looksLikeHumanText(value) {\n  const text = String(value || '').trim()\n  if (!text) return false\n  if (/^https?:\\/\\//i.test(text) && !isInboundMediaReferenceUrl(text)) return false",
    'media-aware human text predicate',
    missing
  )

  text = replaceOnce(
    text,
    "function normalize(body) {\n  const contact_id = String(body.contact_id || body.subscriber_id || body.user_id || '').trim()\n  const thread_id = String(body.thread_id || contact_id || '').trim()\n  const message_id = String(body.message_id || `${Date.now()}`).trim()\n  const instagram_username = String(body.instagram_username || '').trim()\n  const pickedText = pickInboundText(body)\n  const rawBody = JSON.stringify(body)",
    "function collectInboundMediaReferences(value, pathParts = [], out = []) {\n  if (out.length > 50) return out\n  if (typeof value === 'string') {\n    const media = value.trim()\n    if (isInboundMediaReferenceUrl(media)) {\n      out.push({ path: pathParts.join('.') || '<root>', media })\n    }\n    return out\n  }\n  if (!value || typeof value !== 'object' || pathParts.length > 8) return out\n  if (Array.isArray(value)) {\n    value.forEach((item, index) => collectInboundMediaReferences(item, pathParts.concat(String(index)), out))\n    return out\n  }\n  for (const [key, nested] of Object.entries(value)) {\n    collectInboundMediaReferences(nested, pathParts.concat(key), out)\n  }\n  return out\n}\n\nfunction pickInboundMediaReference(body) {\n  const matches = collectInboundMediaReferences(body)\n  const selected = matches[0]\n  if (!selected) return { text: '', source: '', candidates: [] }\n  return {\n    text: selected.media,\n    source: `media_reference:${selected.path}`,\n    candidates: matches.slice(0, 8).map((candidate) => ({\n      path: candidate.path,\n      length: candidate.media.length,\n      preview: candidate.media.slice(0, 160)\n    }))\n  }\n}\n\nfunction normalize(body) {\n  const contact_id = String(body.contact_id || body.subscriber_id || body.user_id || '').trim()\n  const thread_id = String(body.thread_id || contact_id || '').trim()\n  const message_id = String(body.message_id || `${Date.now()}`).trim()\n  const instagram_username = String(body.instagram_username || '').trim()\n  const pickedText = pickInboundText(body)\n  if (!pickedText.text) {\n    const mediaText = pickInboundMediaReference(body)\n    if (mediaText.text) {\n      Object.assign(pickedText, mediaText)\n    }\n  }\n  const rawBody = JSON.stringify(body)",
    'media reference fallback in normalize',
    missing
  )

  if (text !== fs.readFileSync(INBOUND_PATH, 'utf8')) {
    fs.writeFileSync(INBOUND_PATH, text)
  }

  console.log(JSON.stringify({
    event: 'scv_runtime_hotfix',
    target: INBOUND_PATH,
    changed: missing.length === 0,
    missing
  }))
}

function patchInboundDiagnostics() {
  const missing = []
  let text = fs.readFileSync(INBOUND_PATH, 'utf8')

  text = replaceOnce(
    text,
    "        raw_inbound_audit: RAW_INBOUND_AUDIT,\n        inbox: INBOX_DIR,\n        outbox: OUTBOX_DIR\n      })",
    "        raw_inbound_audit: RAW_INBOUND_AUDIT,\n        inbox: INBOX_DIR,\n        outbox: OUTBOX_DIR,\n        runtime_delay: {\n          first_bubble_min_delay_ms: String(process.env.SCV_FIRST_BUBBLE_MIN_DELAY_MS || ''),\n          first_bubble_max_delay_ms: String(process.env.SCV_FIRST_BUBBLE_MAX_DELAY_MS || ''),\n          fast_target_usernames: String(process.env.SCV_FAST_TARGET_USERNAMES || ''),\n          fast_target_force_zero: String(process.env.SCV_FAST_TARGET_FORCE_ZERO || '')\n        },\n        redacted_queue_counts: {\n          inbox_json: fs.existsSync(INBOX_DIR) ? fs.readdirSync(INBOX_DIR).filter((name) => name.endsWith('.json')).length : 0,\n          inbox_locks: fs.existsSync(INBOX_DIR) ? fs.readdirSync(INBOX_DIR).filter((name) => name.endsWith('.lock')).length : 0,\n          outbox_json: fs.existsSync(OUTBOX_DIR) ? fs.readdirSync(OUTBOX_DIR).filter((name) => name.endsWith('.json')).length : 0,\n          outbox_locks: fs.existsSync(OUTBOX_DIR) ? fs.readdirSync(OUTBOX_DIR).filter((name) => name.endsWith('.lock')).length : 0,\n          outbox_failed: fs.existsSync(path.join(ROOT, 'outbox_quarantine_failed')) ? fs.readdirSync(path.join(ROOT, 'outbox_quarantine_failed')).filter((name) => name.endsWith('.json')).length : 0,\n          outbox_human_agent_required: fs.existsSync(path.join(ROOT, 'outbox_human_agent_required')) ? fs.readdirSync(path.join(ROOT, 'outbox_human_agent_required')).filter((name) => name.endsWith('.json')).length : 0,\n          outbox_stale: fs.existsSync(path.join(ROOT, 'outbox_quarantine_stale')) ? fs.readdirSync(path.join(ROOT, 'outbox_quarantine_stale')).filter((name) => name.endsWith('.json')).length : 0,\n          inbox_deadletter: fs.existsSync(path.join(ROOT, 'inbox_quarantine_deadletter')) ? fs.readdirSync(path.join(ROOT, 'inbox_quarantine_deadletter')).filter((name) => name.endsWith('.json')).length : 0,\n          inbox_superseded: fs.existsSync(path.join(ROOT, 'inbox_quarantine_superseded')) ? fs.readdirSync(path.join(ROOT, 'inbox_quarantine_superseded')).filter((name) => name.endsWith('.json')).length : 0\n        }\n      })",
    'health redacted queue diagnostics',
    missing
  )

  if (text !== fs.readFileSync(INBOUND_PATH, 'utf8')) {
    fs.writeFileSync(INBOUND_PATH, text)
  }

  console.log(JSON.stringify({
    event: 'scv_inbound_diagnostics_hotfix',
    target: INBOUND_PATH,
    changed: missing.length === 0,
    missing
  }))
}

function patchRunnerSemanticHarness() {
  const missing = []
  let text = fs.readFileSync(RUNNER_PATH, 'utf8')

  text = replaceOnce(
    text,
    "const { spawnSync } = require('child_process')",
    "const { spawnSync } = require('child_process')\nconst { evaluateScvContractHarness, appendSemanticContractCorrection } = require(path.join(__dirname, 'scv-contract-harness.js'))",
    'semantic harness import',
    missing
  )

  text = replaceOnce(
    text,
    "function detectGenericAiTone(packet) {\n  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []",
    "async function runSemanticContractLoop(input, packet, currentPromptText, result, maxPasses = 3) {\n  let promptText = currentPromptText\n  let currentResult = result\n  let currentPacket = packet\n  const seenViolations = []\n\n  for (let pass = 0; pass < maxPasses; pass++) {\n    const verdict = evaluateScvContractHarness(input, currentPacket)\n    if (verdict.valid) {\n      currentResult.semantic_contract_violations = seenViolations\n      return { packet: currentPacket, promptText, result: currentResult, verdict }\n    }\n\n    seenViolations.push({ pass: pass + 1, reason: verdict.reason })\n    const repairPromptText = buildPrompt(input, appendSemanticContractCorrection('', verdict))\n    const repairResult = await runAuthorityExecutor(repairPromptText)\n    if (repairResult.status !== 0) {\n      throw new Error(\n        `codex_exec_failed_${repairResult.status || 'unknown'} :: attempts=${JSON.stringify(repairResult.attempts || [])} :: ${(repairResult.stderr || '').trim()} :: ${(repairResult.error || '').trim()}`\n      )\n    }\n\n    promptText = repairPromptText\n    currentResult = repairResult\n    currentPacket = parsePacketOrThrow(currentResult)\n  }\n\n  const finalVerdict = evaluateScvContractHarness(input, currentPacket)\n  if (!finalVerdict.valid) {\n    throw new Error(`semantic_contract_unresolved_${finalVerdict.reason} :: ${JSON.stringify(seenViolations)}`)\n  }\n\n  currentResult.semantic_contract_violations = seenViolations\n  return { packet: currentPacket, promptText, result: currentResult, verdict: finalVerdict }\n}\n\nfunction detectGenericAiTone(packet) {\n  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []",
    'semantic contract loop insertion',
    missing
  )

  text = replaceOnce(
    text,
    "let packet = parsePacketOrThrow(result)\n  const genericHit = detectGenericAiTone(packet)",
    "let packet = parsePacketOrThrow(result)\n  let semanticContract = await runSemanticContractLoop(input, packet, promptText, result)\n  packet = semanticContract.packet\n  promptText = semanticContract.promptText\n  result = semanticContract.result\n  const genericHit = detectGenericAiTone(packet)",
    'semantic correction loop before generic tone check',
    missing
  )

  text = replaceOnce(
    text,
    "    packet = parsePacketOrThrow(result)\n  }\n\n  const output = {",
    "    packet = parsePacketOrThrow(result)\n    semanticContract = await runSemanticContractLoop(input, packet, promptText, result)\n    packet = semanticContract.packet\n    promptText = semanticContract.promptText\n    result = semanticContract.result\n  }\n\n  const output = {",
    'semantic correction loop after generic tone rewrite',
    missing
  )

  if (text !== fs.readFileSync(RUNNER_PATH, 'utf8')) {
    fs.writeFileSync(RUNNER_PATH, text)
  }

  console.log(JSON.stringify({
    event: 'scv_runner_semantic_harness',
    target: RUNNER_PATH,
    mode: 'semantic_repair_loop_no_visible_script_copy',
    changed: missing.length === 0,
    missing
  }))
}

try {
  enforceRuntimeDelayHarness()
} catch (err) {
  console.error(JSON.stringify({
    event: 'scv_runtime_delay_harness_failed',
    error: String(err && err.message ? err.message : err)
  }))
}

try {
  patchInboundMediaRecovery()
} catch (err) {
  console.error(JSON.stringify({
    event: 'scv_runtime_hotfix_failed',
    error: String(err && err.message ? err.message : err)
  }))
}

try {
  patchInboundDiagnostics()
} catch (err) {
  console.error(JSON.stringify({
    event: 'scv_inbound_diagnostics_hotfix_failed',
    error: String(err && err.message ? err.message : err)
  }))
}

try {
  patchRunnerSemanticHarness()
} catch (err) {
  console.error(JSON.stringify({
    event: 'scv_runner_semantic_harness_failed',
    error: String(err && err.message ? err.message : err)
  }))
}
