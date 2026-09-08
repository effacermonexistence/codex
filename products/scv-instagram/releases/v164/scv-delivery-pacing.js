#!/usr/bin/env node

const SCV_DELIVERY_PACING_LOCK_VERSION = 'scv-delivery-pacing-lock-2026-07-04-v6-first-reply-3to12min'
const SCV_DELIVERY_PACING_HARD_LOCKED = true
const SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY = 'ignored_by_default_hard_lock'

const DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS = 3 * 60 * 1000
const DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS = 12 * 60 * 1000
const DEFAULT_BUBBLE_GAP_MIN_MS = 1500
const DEFAULT_BUBBLE_GAP_MAX_MS = 22000

const EXPECTED_DELIVERY_PACING_SETTINGS = Object.freeze({
  lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
  hard_locked: SCV_DELIVERY_PACING_HARD_LOCKED,
  env_override_policy: SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY,
  non_fast_initial_delay_min_ms: DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS,
  non_fast_initial_delay_max_ms: DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS,
  bubble_gap_min_ms: DEFAULT_BUBBLE_GAP_MIN_MS,
  bubble_gap_max_ms: DEFAULT_BUBBLE_GAP_MAX_MS
})

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function randomBetweenMs(min, max, rng = Math.random) {
  const lo = Math.max(0, Math.round(Number(min) || 0))
  const hi = Math.max(lo, Math.round(Number(max) || lo))
  if (hi === lo) return lo
  const roll = clamp(Number(rng()), 0, 0.999999999)
  return lo + Math.floor(roll * (hi - lo + 1))
}

function lockedPacingSettings() {
  return { ...EXPECTED_DELIVERY_PACING_SETTINGS }
}

function pacingSettingsFromEnv(_env = process.env) {
  return lockedPacingSettings()
}

function truthyFlag(value) {
  if (value === true) return true
  if (value === false || value == null) return false
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function isNonFastInitialOutboundPacket(packet) {
  return Number(packet?.bubble_index || 0) === 0 && !truthyFlag(packet?.fast_delay_target) && !truthyFlag(packet?.force_zero_delay)
}

function parsedTimeMs(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : null
}

function earliestAllowedSendAtMsForPacket(packet, nowMs = Date.now()) {
  if (!isNonFastInitialOutboundPacket(packet)) return null
  const queuedAt = parsedTimeMs(packet?.queued_at)
  const base = queuedAt == null ? nowMs : queuedAt
  return base + DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS
}

function requiredDueAtMsForPacket(packet, nowMs = Date.now()) {
  const dueAt = parsedTimeMs(packet?.due_at)
  const earliest = earliestAllowedSendAtMsForPacket(packet, nowMs)
  if (earliest == null) return dueAt
  if (dueAt == null) return earliest
  return Math.max(dueAt, earliest)
}

function evaluateInitialDelayHardGate(packet, nowMs = Date.now()) {
  const earliest = earliestAllowedSendAtMsForPacket(packet, nowMs)
  const dueAt = parsedTimeMs(packet?.due_at)
  const required = requiredDueAtMsForPacket(packet, nowMs)
  const blocked = required != null && nowMs < required
  return {
    blocked,
    reason: blocked ? 'non_fast_initial_delay_hard_gate' : 'not_blocked',
    non_fast_initial: isNonFastInitialOutboundPacket(packet),
    now_ms: nowMs,
    queued_at_ms: parsedTimeMs(packet?.queued_at),
    due_at_ms: dueAt,
    earliest_allowed_send_at_ms: earliest,
    required_due_at_ms: required,
    min_initial_delay_ms: DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS
  }
}

function assertExactPacingSettings(settings, label = 'settings') {
  const failures = []
  const check = (name, actual, expected) => {
    if (actual !== expected) failures.push({ name: `${label}.${name}`, actual, expected })
  }
  check('lock_version', settings?.lock_version, SCV_DELIVERY_PACING_LOCK_VERSION)
  check('hard_locked', settings?.hard_locked, true)
  check('env_override_policy', settings?.env_override_policy, SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY)
  check('non_fast_initial_delay_min_ms', settings?.non_fast_initial_delay_min_ms, DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS)
  check('non_fast_initial_delay_max_ms', settings?.non_fast_initial_delay_max_ms, DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS)
  check('bubble_gap_min_ms', settings?.bubble_gap_min_ms, DEFAULT_BUBBLE_GAP_MIN_MS)
  check('bubble_gap_max_ms', settings?.bubble_gap_max_ms, DEFAULT_BUBBLE_GAP_MAX_MS)
  if (failures.length) {
    const err = new Error(`scv_delivery_pacing_settings_drift:${JSON.stringify(failures)}`)
    err.failures = failures
    throw err
  }
  return true
}

function bubblePacingProfile(raw) {
  const text = String(raw || '').trim()
  const lower = text.toLowerCase()
  const chars = text.length
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0
  const lines = text ? text.split(/\n+/).filter(Boolean).length : 0
  const hasLinkishText = /https?:\/\/|@|\.[a-z]{2,}/i.test(text)
  const hasOperationalDetail = /\d|\$|zelle|deposit|address|form|apply|appointment|calendar|june|july|august|september|october|november|december|jan|feb|mar|apr|may|pm|am/i.test(lower)
  const linePenalty = Math.max(0, lines - 1) * 1200

  if (hasLinkishText || hasOperationalDetail) {
    return {
      bucket: 'operational_detail',
      min_ms: 9000,
      max_ms: 18000,
      base_ms: 7600 + linePenalty,
      char_factor_ms: 24,
      word_factor_ms: 115,
      extra_max_ms: 2200
    }
  }

  if (chars <= 16 || words <= 3) {
    return {
      bucket: 'micro_followup',
      min_ms: 1500,
      max_ms: 4500,
      base_ms: 1100 + linePenalty,
      char_factor_ms: 55,
      word_factor_ms: 240,
      extra_max_ms: 1000
    }
  }

  if (chars <= 48 || words <= 8) {
    return {
      bucket: 'short_sentence',
      min_ms: 3000,
      max_ms: 8000,
      base_ms: 2300 + linePenalty,
      char_factor_ms: 42,
      word_factor_ms: 170,
      extra_max_ms: 1500
    }
  }

  if (chars <= 120 || words <= 22) {
    return {
      bucket: 'normal_sentence',
      min_ms: 6000,
      max_ms: 13000,
      base_ms: 4700 + linePenalty,
      char_factor_ms: 32,
      word_factor_ms: 125,
      extra_max_ms: 2200
    }
  }

  return {
    bucket: 'long_detail',
    min_ms: 10000,
    max_ms: 22000,
    base_ms: 7600 + linePenalty,
    char_factor_ms: 22,
    word_factor_ms: 100,
    extra_max_ms: 3000
  }
}

function estimateLengthBasedBubbleGapMs(text, settings = pacingSettingsFromEnv(), rng = Math.random) {
  assertExactPacingSettings(settings, 'estimate_settings')
  const raw = String(text || '').trim()
  const chars = raw.length
  const words = raw ? raw.split(/\s+/).filter(Boolean).length : 0
  const profile = bubblePacingProfile(raw)
  const bucketMin = clamp(profile.min_ms, settings.bubble_gap_min_ms, settings.bubble_gap_max_ms)
  const bucketMax = clamp(profile.max_ms, bucketMin, settings.bubble_gap_max_ms)
  const base = profile.base_ms + (chars * profile.char_factor_ms) + (words * profile.word_factor_ms)
  const jitterMultiplier = 0.74 + (clamp(Number(rng()), 0, 0.999999999) * 0.46)
  const extraPause = randomBetweenMs(0, profile.extra_max_ms, rng)
  return clamp(Math.round(base * jitterMultiplier + extraPause), bucketMin, bucketMax)
}

function deliveryDelayForBubble({ bubble, index, multiplier = 1, forceZeroDelay = false, fastDelayTarget = false, settings = pacingSettingsFromEnv(), rng = Math.random }) {
  assertExactPacingSettings(settings, 'delivery_settings')
  const original_delay_ms = Math.max(0, Number(bubble?.delay_ms || 0))
  if (forceZeroDelay || fastDelayTarget) {
    return {
      original_delay_ms,
      delay_ms: 0,
      pacing_rule: 'fast_target_zero_delay'
    }
  }

  if (Number(index) === 0) {
    return {
      original_delay_ms,
      delay_ms: randomBetweenMs(settings.non_fast_initial_delay_min_ms, settings.non_fast_initial_delay_max_ms, rng),
      pacing_rule: 'non_fast_initial_random_3_to_12_min'
    }
  }

  const profile = bubblePacingProfile(bubble?.text || '')
  return {
    original_delay_ms,
    delay_ms: estimateLengthBasedBubbleGapMs(bubble?.text || '', settings, rng),
    pacing_rule: `semantic_length_bucket_bubble_gap:${profile.bucket}`
  }
}

function runScvDeliveryPacingHarnessSelfTest() {
  const settings = pacingSettingsFromEnv({
    SCV_NON_FAST_INITIAL_DELAY_MIN_MS: '1',
    SCV_NON_FAST_INITIAL_DELAY_MAX_MS: '2',
    SCV_BUBBLE_GAP_MIN_MS: '3',
    SCV_BUBBLE_GAP_MAX_MS: '4',
    SCV_ALLOW_DELIVERY_PACING_ENV_OVERRIDE: '1'
  })
  const failures = []
  const check = (name, condition, detail = '') => {
    if (!condition) failures.push({ name, detail })
  }

  try { assertExactPacingSettings(settings, 'hard_locked_settings') } catch (err) { failures.push({ name: 'exact_settings_assertion', detail: String(err.message || err) }) }
  check('lock_version_v6_exact', SCV_DELIVERY_PACING_LOCK_VERSION === 'scv-delivery-pacing-lock-2026-07-04-v6-first-reply-3to12min', SCV_DELIVERY_PACING_LOCK_VERSION)
  check('hard_locked_true', SCV_DELIVERY_PACING_HARD_LOCKED === true, String(SCV_DELIVERY_PACING_HARD_LOCKED))
  check('env_override_policy_ignored', SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY === 'ignored_by_default_hard_lock', SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY)
  check('env_override_does_not_change_initial_min', settings.non_fast_initial_delay_min_ms === DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS, JSON.stringify(settings))
  check('env_override_does_not_change_initial_max', settings.non_fast_initial_delay_max_ms === DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS, JSON.stringify(settings))
  check('env_override_does_not_change_bubble_min', settings.bubble_gap_min_ms === DEFAULT_BUBBLE_GAP_MIN_MS, JSON.stringify(settings))
  check('env_override_does_not_change_bubble_max', settings.bubble_gap_max_ms === DEFAULT_BUBBLE_GAP_MAX_MS, JSON.stringify(settings))
  check('non_fast_first_exact_min_3m_lock', DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS === 180000, String(DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS))
  check('non_fast_first_exact_max_12m_lock', DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS === 720000, String(DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS))
  check('bubble_min_exact_1500_lock', DEFAULT_BUBBLE_GAP_MIN_MS === 1500, String(DEFAULT_BUBBLE_GAP_MIN_MS))
  check('bubble_max_exact_22000_lock', DEFAULT_BUBBLE_GAP_MAX_MS === 22000, String(DEFAULT_BUBBLE_GAP_MAX_MS))

  const fast = deliveryDelayForBubble({
    bubble: { text: 'test', delay_ms: 999999 },
    index: 0,
    fastDelayTarget: true,
    settings,
    rng: () => 0.5
  })
  check('omar_fast_target_zero_delay', fast.delay_ms === 0 && fast.pacing_rule === 'fast_target_zero_delay', JSON.stringify(fast))

  const firstMin = deliveryDelayForBubble({
    bubble: { text: 'hey', delay_ms: 0 },
    index: 0,
    fastDelayTarget: false,
    settings,
    rng: () => 0
  })
  const firstMax = deliveryDelayForBubble({
    bubble: { text: 'hey', delay_ms: 0 },
    index: 0,
    fastDelayTarget: false,
    settings,
    rng: () => 0.999999
  })
  check('non_fast_first_delay_min_3m', firstMin.delay_ms === DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS, JSON.stringify(firstMin))
  check('non_fast_first_delay_max_12m', firstMax.delay_ms >= DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS - 5 && firstMax.delay_ms <= DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS, JSON.stringify(firstMax))
  check('non_fast_first_delay_is_3_to_12_range', firstMin.delay_ms === 180000 && firstMax.delay_ms >= 719995 && firstMin.delay_ms < firstMax.delay_ms, `${firstMin.delay_ms}/${firstMax.delay_ms}`)
  check('bubble_gap_not_old_hard_8_to_18', settings.bubble_gap_min_ms < 8000 && settings.bubble_gap_max_ms > 18000, JSON.stringify(settings))

  const microGap = deliveryDelayForBubble({ bubble: { text: 'yeah' }, index: 1, fastDelayTarget: false, settings, rng: () => 0.2 })
  const shortGap = deliveryDelayForBubble({ bubble: { text: 'yeah that works for me' }, index: 1, fastDelayTarget: false, settings, rng: () => 0.3 })
  const normalGap = deliveryDelayForBubble({ bubble: { text: 'i can work with that, do you want it more visible or a little quieter on the shoulder?' }, index: 1, fastDelayTarget: false, settings, rng: () => 0.4 })
  const longGap = deliveryDelayForBubble({ bubble: { text: 'once you send it just lmk so i can double check everything on my side and confirm your appointment on my calendar' }, index: 1, fastDelayTarget: false, settings, rng: () => 0.5 })
  const operationalGap = deliveryDelayForBubble({ bubble: { text: 'here is the form: https://www.effacermonexistence.com/apply' }, index: 1, fastDelayTarget: false, settings, rng: () => 0.4 })

  check('micro_followup_can_be_under_8s', microGap.delay_ms < 8000 && microGap.delay_ms >= 1500, JSON.stringify(microGap))
  check('micro_followup_bucket_exposed', microGap.pacing_rule.endsWith(':micro_followup'), JSON.stringify(microGap))
  check('short_sentence_within_short_window', shortGap.delay_ms >= 3000 && shortGap.delay_ms <= 8000, JSON.stringify(shortGap))
  check('short_sentence_bucket_exposed', shortGap.pacing_rule.endsWith(':short_sentence'), JSON.stringify(shortGap))
  check('normal_sentence_longer_than_short', normalGap.delay_ms > shortGap.delay_ms && normalGap.delay_ms <= 13000, `${shortGap.delay_ms}/${normalGap.delay_ms}`)
  check('normal_sentence_bucket_exposed', normalGap.pacing_rule.endsWith(':normal_sentence'), JSON.stringify(normalGap))
  check('long_detail_capped_at_22s', longGap.delay_ms <= DEFAULT_BUBBLE_GAP_MAX_MS, JSON.stringify(longGap))
  check('operational_detail_not_too_fast', operationalGap.delay_ms >= 9000 && operationalGap.delay_ms <= 18000, JSON.stringify(operationalGap))
  check('operational_detail_bucket_exposed', operationalGap.pacing_rule.endsWith(':operational_detail'), JSON.stringify(operationalGap))
  check('pacing_rule_exposes_semantic_bucket', /semantic_length_bucket_bubble_gap:/.test(normalGap.pacing_rule), JSON.stringify(normalGap))

  const gateNow = Date.parse('2026-06-16T00:00:00.000Z')
  const earlyPacket = { bubble_index: 0, fast_delay_target: false, force_zero_delay: false, queued_at: new Date(gateNow).toISOString(), due_at: new Date(gateNow + 1 * 60 * 1000).toISOString() }
  const gate = evaluateInitialDelayHardGate(earlyPacket, gateNow + 2 * 60 * 1000)
  const fastGate = evaluateInitialDelayHardGate({ ...earlyPacket, fast_delay_target: true }, gateNow + 2 * 60 * 1000)
  const laterGate = evaluateInitialDelayHardGate({ ...earlyPacket, bubble_index: 1 }, gateNow + 2 * 60 * 1000)
  check('non_fast_first_packet_hard_gate_blocks_under_3m', gate.blocked === true && gate.required_due_at_ms === gateNow + DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS, JSON.stringify(gate))
  check('fast_target_packet_not_initial_hard_gated', fastGate.blocked === false && fastGate.earliest_allowed_send_at_ms === null, JSON.stringify(fastGate))
  check('later_bubble_not_initial_hard_gated', laterGate.blocked === false && laterGate.earliest_allowed_send_at_ms === null, JSON.stringify(laterGate))

  if (failures.length) {
    const err = new Error(`scv_delivery_pacing_harness_failed:${JSON.stringify(failures)}`)
    err.failures = failures
    throw err
  }

  return {
    ok: true,
    locked: true,
    lock_version: SCV_DELIVERY_PACING_LOCK_VERSION,
    hard_locked: SCV_DELIVERY_PACING_HARD_LOCKED,
    checked: 31,
    settings
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvDeliveryPacingHarnessSelfTest(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), failures: err.failures || [] }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  SCV_DELIVERY_PACING_LOCK_VERSION,
  SCV_DELIVERY_PACING_HARD_LOCKED,
  SCV_DELIVERY_PACING_ENV_OVERRIDE_POLICY,
  DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS,
  DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS,
  DEFAULT_BUBBLE_GAP_MIN_MS,
  DEFAULT_BUBBLE_GAP_MAX_MS,
  EXPECTED_DELIVERY_PACING_SETTINGS,
  lockedPacingSettings,
  pacingSettingsFromEnv,
  assertExactPacingSettings,
  truthyFlag,
  isNonFastInitialOutboundPacket,
  parsedTimeMs,
  earliestAllowedSendAtMsForPacket,
  requiredDueAtMsForPacket,
  evaluateInitialDelayHardGate,
  randomBetweenMs,
  bubblePacingProfile,
  estimateLengthBasedBubbleGapMs,
  deliveryDelayForBubble,
  runScvDeliveryPacingHarnessSelfTest
}
