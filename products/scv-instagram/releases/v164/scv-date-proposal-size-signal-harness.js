#!/usr/bin/env node
'use strict'

// Regression for the 2026-08-26 date-negotiation livelock.
//
// Live failure: "Then how about 29" (a booking-day proposal after a full date
// was rejected) matched the approximate-size rule as "about 29". The size
// verifier then demanded acknowledge-and-defer on a pure date turn, every
// reauthored candidate was rejected
// (after_reauthor_volunteered_placement_size_requires_acknowledge_and_defer),
// and the customer got silence. Date-proposal idioms must never read as size;
// genuine size signals must keep matching.

const path = require('path')
const h = require(path.join(__dirname, 'scv-contract-harness.js'))

function fail(reason, extra) {
  console.log(JSON.stringify({
    type: 'date_proposal_size_signal_harness_fail',
    reason,
    ...extra
  }))
  process.exit(1)
}

function main() {
  if (typeof h.textHasApproximateSizeSignal !== 'function' ||
      typeof h.livePlacementSizeDimensions !== 'function') {
    fail('predicates_not_exported')
  }

  // Booking-day proposals must NOT read as size.
  const proposals = [
    'Then how about 29',
    'how about 29?',
    'what about the 30',
    'ok then what about 15',
    'how about 8'
  ]
  for (const text of proposals) {
    if (h.textHasApproximateSizeSignal(text)) {
      fail('date_proposal_read_as_size', { text })
    }
    const dims = h.livePlacementSizeDimensions({
      text,
      structured_state: { tattoo_intent_active: true }
    })
    if (dims.size || dims.any) {
      fail('date_proposal_triggered_dimензions'.replace('ензions','ensions'), { text, dims })
    }
  }

  // Genuine size signals must keep matching.
  const sizes = [
    ['around 8 or so', true],
    ['about 6 inches', true],
    ['maybe 4 by 4', true],
    ['something small and clean', true],
    ['roughly 12ish', true]
  ]
  for (const [text, expected] of sizes) {
    const got = h.textHasApproximateSizeSignal(text)
    if (got !== expected) fail('genuine_size_signal_regressed', { text, got, expected })
  }

  console.log(JSON.stringify({
    type: 'date_proposal_size_signal_harness_pass',
    proposals_clean: proposals.length,
    sizes_still_detected: sizes.length
  }))
  process.exit(0)
}

main()
