#!/usr/bin/env node
const path = require('path')
const {
  evaluateScvContractHarness
} = require(path.join(__dirname, 'scv-contract-harness.js'))

function assert(condition, message, detail = {}) {
  if (!condition) {
    const err = new Error(message)
    err.detail = detail
    throw err
  }
}

function runFirstTattooToleranceHarness() {
  const input = {
    contact_id: 'first-tattoo-tolerance',
    thread_id: 'first-tattoo-tolerance',
    instagram_username: 'prettyfac3.promise',
    received_at: '2026-06-21T08:55:00.000Z',
    message: "A bigger for the shoulder spot and that's gonna be my first tattoo so I don't know how much I can tolerate",
    recent_history: [
      { role: 'assistant', text: 'were you thinking something small and delicate or a bit bigger for that shoulder spot?' }
    ],
    structured_state: {
      booking_stage_hint: 'design_intake',
      known_design_context: 'butterflies around a mic with flowers',
      known_placement_context: 'shoulder'
    }
  }

  const badEmpty = evaluateScvContractHarness(input, { bubbles: [] })
  assert(
    badEmpty.valid === false && badEmpty.reason === 'first_tattoo_tolerance_requires_reassurance',
    'empty first-tattoo tolerance answer must fail',
    badEmpty
  )

  const badSkip = evaluateScvContractHarness(input, {
    bubbles: [
      { text: 'a bigger one on the shoulder sounds cool' },
      { text: 'do you want me to send the form?' }
    ]
  })
  assert(
    badSkip.valid === false && badSkip.reason === 'first_tattoo_tolerance_requires_reassurance',
    'first-tattoo tolerance answer cannot skip comfort/tolerance reassurance',
    badSkip
  )

  const good = evaluateScvContractHarness(input, {
    bubbles: [
      { text: 'yeah that makes sense for a first tattoo' },
      { text: 'we can keep you comfortable and dial the exact shoulder placement and sizing in at the appointment so you are not overdoing it for your tolerance' },
      { text: 'want me to send the form so we can start checking dates from there?' }
    ]
  })
  assert(good.valid === true, 'first-tattoo tolerance reassurance should pass', good)

  return { ok: true, checked: 3 }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runFirstTattooToleranceHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      error: String(err && err.message ? err.message : err),
      detail: err.detail || {}
    }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  runFirstTattooToleranceHarness
}
