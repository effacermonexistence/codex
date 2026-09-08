#!/usr/bin/env node

const {
  isConversationVisibleAssistantEvent
} = require('./scv-history-visibility.js')

const FORBIDDEN_DM_DASH_CHARS_RE = /[\u002d\u2010\u2011\u2012\u2013\u2014\u2015\u2212\ufe58\ufe63\uff0d]/g
const DEFAULT_DOUBLE_CHECK_DELAY_MIN_MS = 10 * 60 * 1000
const DEFAULT_DOUBLE_CHECK_DELAY_MAX_MS = 30 * 60 * 1000
const DEFAULT_DEPOSIT_DELAY_MIN_MS = 10 * 60 * 1000
const DEFAULT_DEPOSIT_DELAY_MAX_MS = 30 * 60 * 1000
const DEFAULT_DEPOSIT_AMOUNT = '100'
const DEFAULT_DEPOSIT_ACCOUNT = 'contact@omarprotocol.com'

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizedRandom(randomFn = Math.random) {
  try {
    const value = Number(typeof randomFn === 'function' ? randomFn() : Math.random())
    if (Number.isFinite(value)) return clamp(value, 0, 0.999999999)
  } catch {}
  return Math.random()
}

function randomDelayMs(minMs, maxMs, randomFn = Math.random) {
  const min = Math.max(0, Math.round(Number(minMs) || 0))
  const max = Math.max(min, Math.round(Number(maxMs) || min))
  if (max <= min) return min
  return min + Math.floor(normalizedRandom(randomFn) * (max - min + 1))
}

function sanitizeDoubleCheckValue(value) {
  return String(value || '')
    .replace(FORBIDDEN_DM_DASH_CHARS_RE, ' ')
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeDepositAccount(value) {
  return String(value || '')
    .replace(FORBIDDEN_DM_DASH_CHARS_RE, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseDelayRangeMs(env, minKey, maxKey, defaultMin, defaultMax) {
  const parsedMin = Number(env[minKey] || defaultMin)
  const min = Number.isFinite(parsedMin) && parsedMin >= 0 ? Math.round(parsedMin) : defaultMin
  const parsedMax = Number(env[maxKey] || defaultMax)
  const max = Number.isFinite(parsedMax) && parsedMax >= 0 ? Math.round(parsedMax) : defaultMax

  return {
    min,
    max: Math.max(min, max)
  }
}

function bookingDoubleCheckDelayMs(env = process.env, randomFn = Math.random) {
  const range = parseDelayRangeMs(
    env,
    'SCV_BOOKING_DOUBLE_CHECK_DELAY_MIN_MS',
    'SCV_BOOKING_DOUBLE_CHECK_DELAY_MAX_MS',
    DEFAULT_DOUBLE_CHECK_DELAY_MIN_MS,
    DEFAULT_DOUBLE_CHECK_DELAY_MAX_MS
  )
  return randomDelayMs(range.min, range.max, randomFn)
}

function bookingDepositDelayMs(env = process.env, randomFn = Math.random) {
  const range = parseDelayRangeMs(
    env,
    'SCV_BOOKING_DEPOSIT_DELAY_MIN_MS',
    'SCV_BOOKING_DEPOSIT_DELAY_MAX_MS',
    DEFAULT_DEPOSIT_DELAY_MIN_MS,
    DEFAULT_DEPOSIT_DELAY_MAX_MS
  )
  return randomDelayMs(range.min, range.max, randomFn)
}

function bookingDepositAmount(env = process.env) {
  const parsed = Number(env.SCV_BOOKING_DEPOSIT_AMOUNT || DEFAULT_DEPOSIT_AMOUNT)
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.round(parsed)) : DEFAULT_DEPOSIT_AMOUNT
}

function bookingDepositAccount(env = process.env) {
  return sanitizeDepositAccount(
    env.SCV_BOOKING_DEPOSIT_ACCOUNT ||
      env.SCV_BOOKING_DEPOSIT_ACCOUNT_TEXT ||
      DEFAULT_DEPOSIT_ACCOUNT
  )
}

function isReadyForBookingDoubleCheck(state) {
  return !!(
    state &&
    normalizeText(state.booking_stage_hint) === 'ready_for_double_check' &&
    state.known_name_used_on_form &&
    state.known_phone_used_on_form &&
    state.known_requested_date &&
    state.known_requested_time
  )
}

function buildBookingDoubleCheckPacket(state, env = process.env, randomFn = Math.random) {
  if (!isReadyForBookingDoubleCheck(state)) {
    return null
  }

  const name = sanitizeDoubleCheckValue(state.known_name_used_on_form)
  const phone = sanitizeDoubleCheckValue(state.known_phone_used_on_form)
  const date = sanitizeDoubleCheckValue(state.known_requested_date)
  const time = sanitizeDoubleCheckValue(state.known_requested_time)

  if (!name || !phone || !date || !time) {
    return null
  }

  const depositPacket = buildBookingDepositPacketFromReadyStateAck(
    state,
    state.live_turn_text,
    env,
    randomFn
  )
  if (depositPacket) {
    return depositPacket
  }

  return {
    bubbles: [
      {
        text: 'perfect just double checking before i send deposit details',
        delay_ms: bookingDoubleCheckDelayMs(env, randomFn)
      },
      {
        text: `name: ${name}`,
        delay_ms: 0
      },
      {
        text: `number: ${phone}`,
        delay_ms: 0
      },
      {
        text: `date and time: ${date} at ${time}`,
        delay_ms: 0
      },
      {
        text: 'is all of that right?',
        delay_ms: 0
      }
    ]
  }
}

function recentHistoryHasBookingDoubleCheck(recentHistory) {
  const assistantTexts = (Array.isArray(recentHistory) ? recentHistory : [])
    .filter((event) => isConversationVisibleAssistantEvent(event))
    .slice(-12)
    .map((event) => normalizeText(event?.text || ''))
    .filter(Boolean)

  if (!assistantTexts.length) return false

  const hasConfirmationPrompt = assistantTexts.some((text) => (
    text === 'is all of that right?' ||
    text === 'reply yes if all of that is right' ||
    text.includes('can you give this a quick look and make sure it\'s all right? 🖤')
  ))
  const hasNameLine = assistantTexts.some((text) => (
    text.startsWith('name: ') ||
    text.startsWith('name on the form: ')
  ))
  const hasNumberLine = assistantTexts.some((text) => (
    text.startsWith('number: ') ||
    text.startsWith('phone number: ') ||
    text.startsWith('phone on the form: ')
  ))
  const hasDateTimeLine = assistantTexts.some((text) => (
    text.startsWith('date and time: ') ||
    text.startsWith('appointment date: ') ||
    text.startsWith('appointment: ')
  ))

  return hasConfirmationPrompt && hasNameLine && hasNumberLine && hasDateTimeLine
}

function isAffirmativeBookingConfirmation(value) {
  const normalized = normalizeText(value)
    .replace(/[!?,.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return false
  if (/\b(no|not|wrong|incorrect|change|instead|actually|but|except|typo|misspelled|different)\b/.test(normalized)) {
    return false
  }

  const exactAcks = new Set([
    'yes',
    'yeah',
    'yep',
    'yup',
    'correct',
    'right',
    'that is right',
    'thats right',
    "that's right",
    'that is correct',
    'thats correct',
    "that's correct",
    'all good',
    'looks good',
    'it looks good',
    'everything is right',
    'all of that is right',
    'ok',
    'okay',
    'sure',
    'perfect'
  ])

  if (exactAcks.has(normalized)) return true

  return /^(yes|yeah|yep|yup|correct|right|perfect|ok|okay|looks good|all good)\b/.test(normalized) && normalized.length <= 32
}

function buildBookingDepositPacket(state, recentHistory, liveText, env = process.env, randomFn = Math.random) {
  if (state?.deposit_requested) return null
  if (!recentHistoryHasBookingDoubleCheck(recentHistory)) return null
  if (!isAffirmativeBookingConfirmation(liveText)) return null

  const amount = bookingDepositAmount(env)
  const account = bookingDepositAccount(env)

  if (!amount || !account) return null

  return {
    bubbles: [
      {
        text: 'perfecttt',
        delay_ms: bookingDepositDelayMs(env, randomFn)
      },
      {
        text: 'deposit just locks the slot',
        delay_ms: 0
      },
      {
        text: 'that way i keep that time only for you',
        delay_ms: 0
      },
      {
        text: `to confirm your appointment the deposit is ${amount}`,
        delay_ms: 0
      },
      {
        text: account,
        delay_ms: 0
      },
      {
        text: "that's my zelle",
        delay_ms: 0
      },
      {
        text: 'once you send it just lmk so i can double check everything on my side and secure your spot on my calendar',
        delay_ms: 0
      },
      {
        text: "after that i'll send the exact address + prep so it's easy",
        delay_ms: 0
      }
    ]
  }
}

function buildBookingDepositPacketFromReadyStateAck(state, liveText = state?.live_turn_text, env = process.env, randomFn = Math.random) {
  if (!isReadyForBookingDoubleCheck(state)) return null
  if (!isAffirmativeBookingConfirmation(liveText)) return null

  const name = sanitizeDoubleCheckValue(state.known_name_used_on_form)
  const phone = sanitizeDoubleCheckValue(state.known_phone_used_on_form)
  const date = sanitizeDoubleCheckValue(state.known_requested_date)
  const time = sanitizeDoubleCheckValue(state.known_requested_time)

  if (!name || !phone || !date || !time) return null

  return buildBookingDepositPacket(
    state,
    [
      { role: 'assistant', text: `name: ${name}` },
      { role: 'assistant', text: `number: ${phone}` },
      { role: 'assistant', text: `date and time: ${date} at ${time}` },
      { role: 'assistant', text: 'is all of that right?' }
    ],
    liveText,
    env,
    randomFn
  )
}

function assertBookingDoubleCheckPacket(packet) {
  if (packet && Array.isArray(packet.bubbles) && packet.bubbles.length === 8) {
    return assertBookingDepositPacket(packet)
  }

  if (!packet || !Array.isArray(packet.bubbles) || packet.bubbles.length !== 5) {
    throw new Error('booking_double_check_packet_shape')
  }

  const joined = packet.bubbles.map((bubble) => String(bubble.text || '')).join('\n')
  if (FORBIDDEN_DM_DASH_CHARS_RE.test(joined)) {
    throw new Error('booking_double_check_contains_dash')
  }
  if (/[,.]/.test(joined)) {
    throw new Error('booking_double_check_contains_comma_or_period')
  }
  if (!/^perfect just double checking before i send deposit details$/.test(packet.bubbles[0].text)) {
    throw new Error('booking_double_check_intro_drift')
  }
  if (!/^name: .+/.test(packet.bubbles[1].text)) {
    throw new Error('booking_double_check_missing_name_line')
  }
  if (!/^number: .+/.test(packet.bubbles[2].text)) {
    throw new Error('booking_double_check_missing_number_line')
  }
  if (!/^date and time: .+ at .+/.test(packet.bubbles[3].text)) {
    throw new Error('booking_double_check_missing_date_time_line')
  }
  if (!/^is all of that right\?$/.test(packet.bubbles[4].text)) {
    throw new Error('booking_double_check_confirmation_drift')
  }
  if (!(Number(packet.bubbles[0].delay_ms) >= 0)) {
    throw new Error('booking_double_check_invalid_delay')
  }

  return true
}

function assertBookingDepositPacket(packet) {
  if (!packet || !Array.isArray(packet.bubbles) || packet.bubbles.length !== 8) {
    throw new Error('booking_deposit_packet_shape')
  }

  const joined = packet.bubbles.map((bubble) => String(bubble.text || '')).join('\n')
  const nonAccountJoined = packet.bubbles
    .filter((_, index) => index !== 4)
    .map((bubble) => String(bubble.text || ''))
    .join('\n')

  if (FORBIDDEN_DM_DASH_CHARS_RE.test(joined)) {
    throw new Error('booking_deposit_contains_dash')
  }
  if (/[,]/.test(joined) || /[.]/.test(nonAccountJoined)) {
    throw new Error('booking_deposit_contains_comma_or_non_account_period')
  }
  if (!/^perfecttt$/.test(packet.bubbles[0].text)) {
    throw new Error('booking_deposit_intro_drift')
  }
  if (!/^deposit just locks the slot$/.test(packet.bubbles[1].text)) {
    throw new Error('booking_deposit_slot_line_drift')
  }
  if (!/^that way i keep that time only for you$/.test(packet.bubbles[2].text)) {
    throw new Error('booking_deposit_time_hold_line_drift')
  }
  if (!/^to confirm your appointment the deposit is \d+$/.test(packet.bubbles[3].text)) {
    throw new Error('booking_deposit_amount_line_drift')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(packet.bubbles[4].text)) {
    throw new Error('booking_deposit_invalid_zelle_account')
  }
  if (!/^that's my zelle$/.test(packet.bubbles[5].text)) {
    throw new Error('booking_deposit_zelle_line_drift')
  }
  if (!/^once you send it just lmk so i can double check everything on my side and secure your spot on my calendar$/.test(packet.bubbles[6].text)) {
    throw new Error('booking_deposit_followup_line_drift')
  }
  if (!/^after that i'll send the exact address \+ prep so it's easy$/.test(packet.bubbles[7].text)) {
    throw new Error('booking_deposit_address_prep_line_drift')
  }
  if (!(Number(packet.bubbles[0].delay_ms) >= 0)) {
    throw new Error('booking_deposit_invalid_delay')
  }

  return true
}

module.exports = {
  DEFAULT_DOUBLE_CHECK_DELAY_MIN_MS,
  DEFAULT_DOUBLE_CHECK_DELAY_MAX_MS,
  DEFAULT_DEPOSIT_DELAY_MIN_MS,
  DEFAULT_DEPOSIT_DELAY_MAX_MS,
  DEFAULT_DEPOSIT_AMOUNT,
  DEFAULT_DEPOSIT_ACCOUNT,
  randomDelayMs,
  sanitizeDoubleCheckValue,
  sanitizeDepositAccount,
  bookingDoubleCheckDelayMs,
  bookingDepositDelayMs,
  bookingDepositAmount,
  bookingDepositAccount,
  isReadyForBookingDoubleCheck,
  buildBookingDoubleCheckPacket,
  assertBookingDoubleCheckPacket,
  recentHistoryHasBookingDoubleCheck,
  isAffirmativeBookingConfirmation,
  buildBookingDepositPacket,
  buildBookingDepositPacketFromReadyStateAck,
  assertBookingDepositPacket
}
