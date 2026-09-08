#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))

const CERTAINTY_GATE_LOCK_VERSION = 'scv-reply-certainty-gate-lock-2026-07-09-v1'

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function safeThreadKey(threadId) {
  return String(threadId || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function safeReadJson(file) {
  try {
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function threadHistoryEvents(root, threadId) {
  const key = safeThreadKey(threadId)
  if (!root || !key || key === 'unknown') return []
  const file = path.join(root, 'thread-history', `${key}.json`)
  const parsed = safeReadJson(file)
  if (!parsed) return []
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed.events)) return parsed.events
  if (Array.isArray(parsed.history)) return parsed.history
  return []
}

function hasUsefulThreadContext(root, threadId) {
  const events = threadHistoryEvents(root, threadId)
  if (events.length < 2) return false
  return events.some((event) => (
    isConversationVisibleAssistantEvent(event) &&
    String(event?.text || event?.message || '').trim()
  ))
}

function clearReplyIntentReason(text) {
  const normalized = normalizeText(text)
  if (!normalized) return ''

  if (/(?:^|\b)(?:how much|price|cost|rate|deposit|quote|estimate|minimum|hourly|per hour)(?:\b|$)/i.test(normalized)) {
    return 'clear_cost_or_price_question'
  }

  if (/(?:^|\b)(?:where are you|located|location|address|studio|shop|san francisco|sf)(?:\b|$)/i.test(normalized)) {
    return 'clear_location_question'
  }

  if (/(?:^|\b)(?:form|apply|application|link|submitted|sent it|i sent|filled it out)(?:\b|$)/i.test(normalized)) {
    return 'clear_form_process_turn'
  }

  if (/(?:^|\b)(?:book|booking|appointment|available|availability|date|time|weekend|weekday|saturday|sunday|monday|tuesday|wednesday|thursday|friday)(?:\b|$)/i.test(normalized)) {
    return 'clear_booking_or_availability_turn'
  }

  if (/(?:^|\b)(?:tattoo|flash|design|piece|custom|reference|inspo|photo|picture|image|placement|size|shoulder|arm|forearm|leg|thigh|back|chest|neck|wrist|ankle|black and gray|black and grey|color|colour|vibrant|minimal|fine line|traditional)(?:\b|$)/i.test(normalized)) {
    return 'clear_tattoo_design_turn'
  }

  if (/^\+?\d[\d\s().-]{6,}$/.test(normalized.replace(/[^\d\s+().-]/g, ''))) {
    return 'clear_phone_or_number_turn'
  }

  return ''
}

function ambiguousShortAckReason(text) {
  const normalized = normalizeText(text).replace(/[.!?]+$/g, '').trim()
  if (!normalized) return 'empty_or_media_only_without_context'
  if (/^(?:ok|okay|kk|k|yes|yeah|yep|sure|for sure|perfect|sounds good|cool|nice|bet|done|sent|i did|thank you|thanks|ty|lol|lmao|haha|ha|❤️|💕|💖|🔥)$/i.test(normalized)) {
    return 'ambiguous_short_ack_without_context'
  }
  if (normalized.length <= 4) return 'too_short_without_context'
  return ''
}

function classifyPendingReplyCertainty(record, opts = {}) {
  const root = opts.root || process.env.SCV_ROOT || __dirname
  const threadId = String(record?.thread_id || record?.contact_id || '').trim()

  if (hasUsefulThreadContext(root, threadId)) {
    return { certain: true, reason: 'thread_history_context_present', lock_version: CERTAINTY_GATE_LOCK_VERSION }
  }

  const text = String(record?.text || record?.message || record?.last_input_text || '').trim()
  const clearReason = clearReplyIntentReason(text)
  if (clearReason) {
    return { certain: true, reason: clearReason, lock_version: CERTAINTY_GATE_LOCK_VERSION }
  }

  return {
    certain: false,
    reason: ambiguousShortAckReason(text) || 'missing_context_for_pending_reply',
    lock_version: CERTAINTY_GATE_LOCK_VERSION
  }
}

module.exports = {
  CERTAINTY_GATE_LOCK_VERSION,
  normalizeText,
  threadHistoryEvents,
  hasUsefulThreadContext,
  clearReplyIntentReason,
  ambiguousShortAckReason,
  classifyPendingReplyCertainty
}
