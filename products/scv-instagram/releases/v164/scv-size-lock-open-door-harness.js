#!/usr/bin/env node
'use strict'

// Regression for the 2026-08-26 verifier livelock.
//
// The model habitually welds the verifier-required customization open door and
// a size/placement question into one bubble. The old size/placement lock
// deleted the WHOLE bubble, so the surviving packet failed
// info_opener_requires_customization_open_door, the reauthor loop regenerated
// the same combination, and the customer got silence. The lock must keep Ben's
// rule (no size/placement question ever reaches the customer) while preserving
// statement segments so the open door survives.

const path = require('path')
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const harness = require(path.join(__dirname, 'scv-contract-harness.js'))

function fail(reason, extra) {
  console.log(JSON.stringify({
    type: 'size_lock_open_door_harness_fail',
    reason,
    ...extra
  }))
  process.exit(1)
}

function main() {
  if (typeof runner.enforceSizePlacementLock !== 'function') {
    fail('enforce_size_placement_lock_not_exported')
  }
  if (typeof harness.packetHasCustomizationOpenDoor !== 'function') {
    fail('open_door_predicate_not_exported')
  }

  // The incident shape: open door + size question welded into one bubble.
  const welded = {
    bubbles: [
      { text: 'everything we do is custom — what size and placement are you thinking?' },
      { text: 'our rate is 200/hr and the consult is free' }
    ]
  }
  const filtered = runner.enforceSizePlacementLock({}, welded)
  const texts = filtered.bubbles.map((b) => String(b.text))
  if (texts.some((t) => /\b(size|placement)\b.{0,60}\?/i.test(t))) {
    fail('size_placement_question_survived_filter', { texts })
  }
  if (!harness.packetHasCustomizationOpenDoor(filtered)) {
    fail('open_door_lost_after_filter', { texts })
  }

  // Pure question bubble with no statement clause must still die entirely.
  const pure = { bubbles: [{ text: 'what size are you thinking?' }, { text: 'sounds good!' }] }
  const pureFiltered = runner.enforceSizePlacementLock({}, pure)
  if (pureFiltered.bubbles.length !== 1 ||
      !/sounds good/i.test(String(pureFiltered.bubbles[0].text))) {
    fail('pure_question_bubble_not_removed', {
      texts: pureFiltered.bubbles.map((b) => String(b.text))
    })
  }

  // Statement-only bubbles must pass untouched.
  const statement = { bubbles: [{ text: 'sizing gets dialed in at the consult, no stress' }] }
  const statementFiltered = runner.enforceSizePlacementLock({}, statement)
  if (statementFiltered.bubbles.length !== 1 ||
      statementFiltered.bubbles[0].text !== statement.bubbles[0].text) {
    fail('statement_bubble_mutated')
  }

  console.log(JSON.stringify({
    type: 'size_lock_open_door_harness_pass',
    welded_open_door_survives: true,
    question_removed: true,
    pure_question_still_dies: true,
    statements_untouched: true
  }))
  process.exit(0)
}

main()
