#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  SCV_HUMAN_WORD_CHOICE_LOCK_VERSION,
  humanWordChoiceHit,
  packetHumanWordChoiceHit
} = require('./scv-human-word-choice.js')

const SCV_HUMAN_WORD_CHOICE_HARNESS_VERSION =
  'scv-human-word-choice-harness-2026-09-01-v1'

function runScvHumanWordChoiceHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  const rejected = [
    'we can build something around that',
    'i would love to explore that direction',
    'we can refine the concept together',
    'i can bring your vision to life',
    'that aligns with my visual language',
    'we can collaborate on the approach',
    'moving forward we can iterate on it',
    'based on what you shared i can curate a few options',
    'we can lean into a stronger visual direction',
    'this can be part of your tattoo journey'
  ]
  for (const [index, sample] of rejected.entries()) {
    check(`reject_ai_word_choice_${index + 1}`, Boolean(humanWordChoiceHit(sample)), sample)
  }

  const accepted = [
    'what are you thinking?',
    'send me the reference and i can make it custom',
    'yeah i can do that',
    'which date works for you?',
    'when the form is in send me a couple dates',
    'around fist size would take about 4 hours',
    'i can change that part and make my own version',
    'does 2pm work for you?'
  ]
  for (const [index, sample] of accepted.entries()) {
    check(`accept_plain_dm_word_choice_${index + 1}`, !humanWordChoiceHit(sample), sample)
  }

  check(
    'packet_gate_checks_every_bubble',
    packetHumanWordChoiceHit({ bubbles: [
      { text: 'yeah i can do that' },
      { text: 'then we can build it out together' }
    ] })?.label === 'consultant verb build'
  )

  const lock = fs.readFileSync(path.join(__dirname, 'lua-dm-human-word-choice-lock-v1.txt'), 'utf8')
  check('lock_version_exact', SCV_HUMAN_WORD_CHOICE_LOCK_VERSION === 'scv-human-word-choice-2026-09-01-v1-private-reference-distillation')
  check('lock_states_private_distillation', lock.includes('private owner-provided writing reference') && lock.includes('not a phrase library'))
  check('lock_has_everyday_verb_rule', lock.includes('Prefer the plain everyday verb'))
  check('lock_has_no_email_address', !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(lock))
  check('lock_has_no_phone_number', !/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/.test(lock))
  check('lock_has_no_street_address', !/\b\d{2,6}\s+[A-Za-z][A-Za-z .'-]{2,40}\b(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct)\b/i.test(lock))

  if (failures.length) {
    const error = new Error(`scv_human_word_choice_harness_failed:${JSON.stringify(failures)}`)
    error.failures = failures
    throw error
  }
  return {
    ok: true,
    version: SCV_HUMAN_WORD_CHOICE_HARNESS_VERSION,
    lock_version: SCV_HUMAN_WORD_CHOICE_LOCK_VERSION,
    checked
  }
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runScvHumanWordChoiceHarness(), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: String(error?.message || error),
      failures: error?.failures || []
    }, null, 2)}\n`)
    process.exit(1)
  }
}

module.exports = {
  SCV_HUMAN_WORD_CHOICE_HARNESS_VERSION,
  runScvHumanWordChoiceHarness
}
