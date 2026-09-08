#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const ROOT = process.env.SCV_ROOT || __dirname
const DARWIN_PATH = path.join(ROOT, 'dm_darwin_state.json')
const HINTON_PATH = path.join(ROOT, 'dm_hinton_state.json')
const CONVERSION_EVENTS_PATH = path.join(ROOT, 'dm_conversion_events.jsonl')
const CONVERSION_STATE_PATH = path.join(ROOT, 'dm_conversion_state.json')

function immutableGoldenRelease(env = process.env) {
  return String(env.SCV_IMMUTABLE_GOLDEN_RELEASE || '0').trim() === '1'
}

const TATTOO_SHOP_RE = /\b(tattoo|tattoos|ink|studio|shop|piercing|collective|parlor|parlour|supply)\b/i
const BOOKING_RE = /\b(name|phone|number|form|deposit|available|availability|date|time|schedule|scheduled|under the form|works for you|what day|which day|am|pm|appointment|book|booking|submit|submitted)\b/i
const EMOTIONAL_RE = /\b(sad|depressed|depression|heartbroken|hurt|cry|crying|overwhelmed|alone|lonely|anxious|anxiety|panic|spiral|not okay|low)\b/i
const LINK_RE = /https?:\/\/|www\./i
const LONGFORM_RE = /\n|.{180,}/s
const FORMAL_MC_RE = /\b(which|would you|can i|do i|should i|what if)\b/i

function safeReadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch {}
  return fallback
}

function safeWriteJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n')
}

function appendNdjson(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n')
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function defaultState() {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    cluster_biases: {},
    username_biases: {}
  }
}

function defaultConversionState() {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    cluster_stats: {},
    username_stats: {},
    thread_last_state: {}
  }
}

function loadState(file) {
  return safeReadJson(file, defaultState())
}

function loadConversionState() {
  return safeReadJson(CONVERSION_STATE_PATH, defaultConversionState())
}

function ensureEntry(map, key) {
  if (!map[key]) {
    map[key] = {
      darwin_risk: 0,
      hinton_risk: 0,
      counts: {}
    }
  }
  return map[key]
}

function ensureConversionEntry(map, key) {
  if (!map[key]) {
    map[key] = {
      lead_count: 0,
      form_link_sent: 0,
      form_submitted: 0,
      date_time_selected: 0,
      identity_match_complete: 0,
      ready_for_double_check: 0,
      deposit_requested: 0,
      deposit_paid_signal: 0,
      booking_locked_signal: 0
    }
  }
  return map[key]
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function classifyDmCluster(packet) {
  const username = String(packet?.instagram_username || '').trim().toLowerCase()
  const bubbleText = Array.isArray(packet?.bubbles)
    ? packet.bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
    : ''
  const text = `${String(packet?.text || '')}\n${String(packet?.bubble?.text || '')}\n${bubbleText}`.trim()
  const lower = normalizeText(text)

  if (TATTOO_SHOP_RE.test(username)) return 'shop_like'
  if (BOOKING_RE.test(lower)) return 'booking_logistics'
  if (LINK_RE.test(text)) return 'link_heavy'
  if (EMOTIONAL_RE.test(lower)) return 'emotional_support'
  if (FORMAL_MC_RE.test(lower)) return 'formal_question'
  if (LONGFORM_RE.test(text)) return 'longform_social'
  return 'general_social'
}

function getAdaptiveDeliveryPolicy(packet) {
  const darwin = loadState(DARWIN_PATH)
  const hinton = loadState(HINTON_PATH)
  const cluster = classifyDmCluster(packet)
  const username = String(packet?.instagram_username || '').trim().toLowerCase()

  const clusterD = darwin.cluster_biases?.[cluster] || {}
  const clusterH = hinton.cluster_biases?.[cluster] || {}
  const userD = username ? (darwin.username_biases?.[username] || {}) : {}
  const userH = username ? (hinton.username_biases?.[username] || {}) : {}

  const riskScore =
    Number(clusterD.darwin_risk || 0) +
    Number(clusterH.hinton_risk || 0) +
    Number(userD.darwin_risk || 0) +
    Number(userH.hinton_risk || 0)

  let delayMultiplier = 1
  if (riskScore >= 1) delayMultiplier = 1.25
  if (riskScore >= 2) delayMultiplier = 1.5
  if (riskScore >= 4) delayMultiplier = 2

  let reactionRateMultiplier = 1
  if (cluster === 'booking_logistics' || cluster === 'link_heavy' || cluster === 'shop_like') {
    reactionRateMultiplier = 0
  } else if (riskScore >= 3) {
    reactionRateMultiplier = 0.2
  } else if (riskScore >= 1) {
    reactionRateMultiplier = 0.5
  }

  return {
    cluster,
    risk_score: Number(riskScore.toFixed(3)),
    delay_multiplier: delayMultiplier,
    reaction_rate_multiplier: reactionRateMultiplier
  }
}

function getAdaptiveReactionRate(packet, baseRate) {
  const policy = getAdaptiveDeliveryPolicy(packet)
  const multiplier = policy && policy.reaction_rate_multiplier !== undefined
    ? Number(policy.reaction_rate_multiplier)
    : 1
  return clamp(Number(baseRate || 0) * multiplier, 0, 1)
}

function applyDelta(entry, outcome) {
  const map = {
    success_visible: { d: -0.12, h: -0.03 },
    manychat_success_unverified: { d: -0.04, h: -0.01 },
    manychat_accepted_unverified: { d: 0.08, h: 0.02 },
    reaction_success: { d: -0.03, h: -0.01 },
    suppressed: { d: 0.08, h: 0.02 },
    stale: { d: 0.35, h: 0.08 },
    duplicate: { d: 0.7, h: 0.18 },
    inbound_duplicate_drop: { d: 0.9, h: 0.22 },
    fail_closed_unverified: { d: 1.25, h: 0.3 },
    synthetic_drop: { d: 1.5, h: 0.35 },
    send_failure: { d: 0.45, h: 0.12 },
    reaction_failed: { d: 0.2, h: 0.05 }
  }
  const delta = map[outcome] || { d: 0, h: 0 }
  entry.darwin_risk = clamp(Number(entry.darwin_risk || 0) + delta.d, -1.5, 8)
  entry.hinton_risk = clamp(Number(entry.hinton_risk || 0) + delta.h, -0.5, 4)
  entry.counts = entry.counts || {}
  entry.counts[outcome] = Number(entry.counts[outcome] || 0) + 1
}

function recordLearningOutcome(packet, outcome) {
  const cluster = classifyDmCluster(packet)
  const username = String(packet?.instagram_username || '').trim().toLowerCase()

  const darwin = loadState(DARWIN_PATH)
  const hinton = loadState(HINTON_PATH)

  const dCluster = ensureEntry(darwin.cluster_biases, cluster)
  const hCluster = ensureEntry(hinton.cluster_biases, cluster)

  // Golden production may observe outcomes, but it may not silently retrain its
  // own delivery behavior. The bundled Darwin/Hinton states are immutable
  // release inputs; a changed state requires a new manifest and Ben approval.
  if (immutableGoldenRelease()) {
    return {
      cluster,
      username,
      darwin_cluster_risk: Number((darwin.cluster_biases?.[cluster] || {}).darwin_risk || 0),
      hinton_cluster_risk: Number((hinton.cluster_biases?.[cluster] || {}).hinton_risk || 0),
      immutable_golden_release: true,
      mutation_adopted: false
    }
  }

  applyDelta(dCluster, outcome)
  applyDelta(hCluster, outcome)
  if (username) {
    const dUser = ensureEntry(darwin.username_biases, username)
    const hUser = ensureEntry(hinton.username_biases, username)
    applyDelta(dUser, outcome)
    applyDelta(hUser, outcome)
  }

  darwin.updated_at = new Date().toISOString()
  hinton.updated_at = new Date().toISOString()
  safeWriteJson(DARWIN_PATH, darwin)
  safeWriteJson(HINTON_PATH, hinton)

  return {
    cluster,
    username,
    darwin_cluster_risk: dCluster.darwin_risk,
    hinton_cluster_risk: hCluster.hinton_risk
  }
}

function buildConversionFlags(packet, structuredState, authorityPacket) {
  const state = structuredState && typeof structuredState === 'object' ? structuredState : {}
  const userText = String(packet?.text || '').trim()
  const assistantText = Array.isArray(authorityPacket?.bubbles)
    ? authorityPacket.bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
    : ''
  const combined = `${userText}\n${assistantText}`.toLowerCase()

  return {
    form_link_sent: !!state.form_link_sent,
    form_submitted: !!state.form_submitted,
    date_time_selected: !!(state.known_requested_date && state.known_requested_time),
    identity_match_complete: !!(state.known_name_used_on_form && state.known_phone_used_on_form),
    ready_for_double_check: String(state.booking_stage_hint || '') === 'ready_for_double_check',
    deposit_requested:
      !!state.deposit_requested ||
      /\bdeposit is 100\b|that['’]s my zelle|send the deposit|deposit details/i.test(assistantText),
    deposit_paid_signal:
      /\bi sent (the )?deposit\b|\bjust sent (the )?deposit\b|\bsent deposit\b|\bdeposit sent\b|\bzelle sent\b|\bjust filled\b|\bi just submitted\b|\bsubmitted it\b|\bfilled it out\b/i.test(userText.toLowerCase()),
    booking_locked_signal:
      /\blocked on my end\b|\blocked in\b|\bappointment is locked\b|\bbooked\b|\bconfirmed\b|\bcan i tell my clients\b/i.test(combined)
  }
}

function recordConversionSnapshot(packet, structuredState, authorityPacket) {
  const username = String(packet?.instagram_username || '').trim().toLowerCase()
  const threadId = String(packet?.thread_id || packet?.contact_id || '').trim()
  if (!threadId) {
    return { cluster: '', transitions: [], recorded: false }
  }

  const cluster = classifyDmCluster({
    instagram_username: username,
    text: String(packet?.text || ''),
    bubbles: authorityPacket?.bubbles
  })

  const state = loadConversionState()
  const prev = state.thread_last_state[threadId] || {}
  const flags = buildConversionFlags(packet, structuredState, authorityPacket)
  const clusterStats = ensureConversionEntry(state.cluster_stats, cluster)
  const userKey = username || '__unknown__'
  const usernameStats = ensureConversionEntry(state.username_stats, userKey)
  const transitions = []

  if (!prev.__lead_counted) {
    clusterStats.lead_count += 1
    usernameStats.lead_count += 1
    transitions.push('lead_count')
  }

  for (const key of Object.keys(flags)) {
    if (flags[key] && !prev[key]) {
      clusterStats[key] += 1
      usernameStats[key] += 1
      transitions.push(key)

      appendNdjson(CONVERSION_EVENTS_PATH, {
        at: new Date().toISOString(),
        thread_id: threadId,
        instagram_username: username,
        cluster,
        event: key,
        message_id: String(packet?.message_id || ''),
        text_preview: String(packet?.text || '').slice(0, 240),
        booking_stage_hint: String(structuredState?.booking_stage_hint || '')
      })
    }
  }

  state.thread_last_state[threadId] = {
    ...prev,
    ...flags,
    __lead_counted: true,
    last_message_id: String(packet?.message_id || ''),
    last_seen_at: new Date().toISOString(),
    cluster,
    instagram_username: username
  }
  state.updated_at = new Date().toISOString()
  safeWriteJson(CONVERSION_STATE_PATH, state)

  return {
    cluster,
    transitions,
    recorded: true
  }
}

module.exports = {
  immutableGoldenRelease,
  classifyDmCluster,
  getAdaptiveDeliveryPolicy,
  getAdaptiveReactionRate,
  recordLearningOutcome,
  recordConversionSnapshot
}
