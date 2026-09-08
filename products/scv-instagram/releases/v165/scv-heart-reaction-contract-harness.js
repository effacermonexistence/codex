#!/usr/bin/env node
const path = require('path')
const { evaluateScvContractHarness } = require(path.join(__dirname, 'scv-contract-harness.js'))

function assert(condition, message, detail = {}) {
  if (!condition) {
    const err = new Error(message)
    err.detail = detail
    throw err
  }
}

function runHeartReactionContractHarness() {
  const input = {
    contact_id: 'heart-reaction-contract',
    thread_id: 'heart-reaction-contract',
    instagram_username: 'srta.avalos',
    received_at: '2026-06-21T09:00:00.000Z',
    message: 'sent a heart reaction',
    recent_history: [
      { role: 'assistant', text: 'hehe wait i knew you would like that one' }
    ],
    structured_state: {
      live_turn_text: 'sent a heart reaction',
      booking_stage_hint: 'open_conversation'
    }
  }

  const badEmpty = evaluateScvContractHarness(input, { bubbles: [] })
  assert(
    badEmpty.valid === false && badEmpty.reason === 'heart_reaction_requires_visible_reply',
    'heart reaction cannot go silent',
    badEmpty
  )

  const badBookingPush = evaluateScvContractHarness(input, {
    bubbles: [{ text: 'what design, placement, and size do you want for your tattoo?' }]
  })
  assert(
    badBookingPush.valid === false && badBookingPush.reason === 'heart_reaction_no_cold_booking_push',
    'heart reaction cannot cold-push tattoo intake',
    badBookingPush
  )

  const good = evaluateScvContractHarness(input, {
    bubbles: [
      { text: 'hehe i knew you’d like that one' },
      { text: 'do you want it more soft/cute or a little sharper?' }
    ]
  })
  assert(good.valid === true, 'heart reaction warm reply should pass', good)

  return { ok: true, checked: 3 }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runHeartReactionContractHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      error: String(err && err.message ? err.message : err),
      detail: err.detail || {}
    }, null, 2))
    process.exit(1)
  }
}

module.exports = { runHeartReactionContractHarness }
