#!/usr/bin/env node
// Regression lock: the banned commitment verbs stay banned in every tense.
//
// Ben banned lock/hold language because the appointment is not held until the
// deposit is in, and saying otherwise is a promise the shop cannot keep. Three
// separate fixes have been made here and each one matched a spelling rather than
// the verb: "locks your appointment" was added, then "locks IN your appointment"
// walked through; "holding that spot for you" was added, then "ill be holding
// your spot" walked through because the pattern needed a trailing "for you".
//
// So this harness enumerates the conjugations instead of the sentences, and also
// checks the rewrite is grammatical — scrubbing a banned word into broken
// English ("im appointment confirmation for you") is its own tell.
const path = require('path')
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const clean = runner.enforceDmSurfaceText

let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

// Kept in sync with the behaviour auditor's banned_lock_language rule.
const BANNED = /\block(?:s|ed|ing)?\s+(?:it\s+)?in\b|\blocks?\s+(?:your|the)\s+(?:appointment|booking|date|time|slot|spot)\b|\bhold(?:s|ed|ing)?\s+(?:the|your|that)\s+(?:slot|spot)\b/i

// 1) Every conjugation of the banned verbs, across the objects they attach to.
{
  const subjects = ['i can', 'ill', 'we can', 'that', 'the form', 'the deposit']
  const verbs = ['lock in', 'locks in', 'locked in', 'locking in', 'lock', 'locks', 'locked', 'locking']
  const objects = ['your appointment', 'the appointment', 'your spot', 'the slot', 'your date', 'that time', 'the 17th']
  let cases = 0
  let leaked = 0
  for (const s of subjects) {
    for (const v of verbs) {
      for (const o of objects) {
        cases += 1
        const out = clean(`${s} ${v} ${o}`)
        if (BANNED.test(out)) { leaked += 1; if (leaked <= 5) console.error(`  leak: ${s} ${v} ${o} -> ${out}`) }
      }
    }
  }
  check(`lock family scrubbed in every tense (${cases} cases)`, leaked === 0, `${leaked} leaked`)
}

{
  const holds = ['hold', 'holds', 'held', 'holding']
  const dets = ['your', 'the', 'that']
  const tails = ['', ' for you', ' till friday', ' for now']
  let cases = 0
  let leaked = 0
  for (const h of holds) {
    for (const d of dets) {
      for (const noun of ['spot', 'slot']) {
        for (const t of tails) {
          cases += 1
          const out = clean(`ill be ${h} ${d} ${noun}${t}`)
          if (BANNED.test(out)) { leaked += 1; if (leaked <= 5) console.error(`  leak: ${h} ${d} ${noun}${t} -> ${out}`) }
        }
      }
    }
  }
  check(`hold family scrubbed in every tense (${cases} cases)`, leaked === 0, `${leaked} leaked`)
}

// 2) The exact sentences the audits caught, one per past failure.
{
  const live = [
    'the $100 deposit is what locks your appointment on my calendar',
    'that locks in your appointment',
    'the form locks in your appointment',
    'locking in your date now',
    'ill be holding your spot',
    'im holding the slot for you',
    'your spot is held tight',
    "the slot can't be officially confirmed until the deposit is in"
  ]
  for (const s of live) {
    const out = clean(s)
    check(`live case scrubbed :: ${s.slice(0, 34)}`, !BANNED.test(out), out)
  }
}

// 3) The rewrite must be readable English. Broken grammar is its own AI tell.
{
  const grammar = [
    // The artist as subject loses the subject on purpose: "im keeping that time
    // open" is still a promise to hold it, and nothing is held until the deposit
    // is in. The neutral statement of availability is the approved wording.
    ['im holding the slot for you', /^that time is still open for you$/],
    ['ill be holding your spot', /^that time is still open for you$/],
    // Without the artist as subject there is no promise to strip, so the
    // conjugated form is fine and reads better.
    ['she holds the spot', /^she keeps that time open$/],
    ['the deposit locks the spot', /^the deposit confirms your appointment$/],
    ['we can lock it in', /^we can confirm it$/],
    ['i locked in your appointment', /^i confirmed your appointment$/],
    ['locking in your date now', /^confirming your appointment now$/]
  ]
  for (const [input, shape] of grammar) {
    const out = clean(input)
    check(`grammatical :: ${input.slice(0, 30)}`, shape.test(out), out)
  }
  for (const input of ['the deposit locks the spot', 'im holding the slot for you', 'we can lock it in']) {
    const out = clean(input)
    check(`no doubled article :: ${input.slice(0, 26)}`, !/\b(the the|a a|your your)\b/i.test(out), out)
  }
}

// 4) Ordinary uses of these words are not touched. "lock" is a real word.
{
  const innocent = [
    'i love that lock of hair in the reference',
    'the studio door has a lock',
    'hold on let me check my calendar',
    'ill hold that thought'
  ]
  for (const s of innocent) {
    check(`untouched :: ${s.slice(0, 30)}`, clean(s) === s, clean(s))
  }
}

console.log(`scv-commitment-language-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
