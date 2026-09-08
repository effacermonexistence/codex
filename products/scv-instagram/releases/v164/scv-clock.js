#!/usr/bin/env node

const SCV_CLOCK_VERSION = 'scv-clock-2026-07-26-v1-single-prod-test-path'
const SCV_CLOCK_TIME_ZONE = 'America/Los_Angeles'

function parseClockInput(value) {
  if (value instanceof Date) {
    const copy = new Date(value.getTime())
    if (!Number.isNaN(copy.getTime())) return copy
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  const text = String(value || '').trim()
  if (text) {
    const parsed = new Date(text)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

// Production and tests enter through this exact function. Tests inject the
// same `clock` dependency that production uses; there is no test-only time path.
function resolveClockDate({ clock, referenceTime, receivedAt } = {}) {
  const explicit = parseClockInput(referenceTime) || parseClockInput(receivedAt)
  if (explicit) return explicit

  if (clock && typeof clock.now === 'function') {
    const injected = parseClockInput(clock.now())
    if (!injected) throw new Error('scv_clock_injected_now_invalid')
    return injected
  }

  return new Date(Date.now())
}

function resolveClockMs(options = {}) {
  return resolveClockDate(options).getTime()
}

function resolveClockIso(options = {}) {
  return resolveClockDate(options).toISOString()
}

function systemClock() {
  return Object.freeze({
    version: SCV_CLOCK_VERSION,
    now: () => Date.now()
  })
}

function fixedClock(value) {
  const fixed = resolveClockDate({ referenceTime: value })
  return Object.freeze({
    version: SCV_CLOCK_VERSION,
    now: () => fixed.getTime()
  })
}

module.exports = {
  SCV_CLOCK_VERSION,
  SCV_CLOCK_TIME_ZONE,
  parseClockInput,
  resolveClockDate,
  resolveClockMs,
  resolveClockIso,
  systemClock,
  fixedClock
}
