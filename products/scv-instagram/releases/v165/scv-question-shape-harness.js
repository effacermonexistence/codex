#!/usr/bin/env node
// Regression lock: unpunctuated questions must route to the model lane, and a
// money question must never be answered by a fixed booking script.
//
// Behaviour audit 2026-08-01 replayed 120 real recorded turns and caught the
// four-line double-check checkpoint fired as the reply to "What is the model
// rate ?" — the lead asked a price and got another person's name and phone
// number back. The gate had keyed on the "?" glyph alone.
const path = require('path')
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const asksRealQuestion = runner.liveTurnAsksRealQuestion
const buildBooking = runner.buildDeterministicBookingPacket

let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

if (typeof asksRealQuestion !== 'function' || typeof buildBooking !== 'function') {
  console.error('FAIL required functions not exported from codex-dm-runner.js')
  process.exit(1)
}

const turn = (text) => ({
  text,
  contact_id: '999000222',
  thread_id: '999000222',
  structured_state: {
    form_submitted: true,
    form_link_sent: true,
    known_name_used_on_form: 'Test Lead',
    known_phone_used_on_form: '4155550123',
    booking_date: '8th of August',
    booking_time: '2pm'
  }
})

// 1) Unpunctuated questions count as questions
{
  const cases = [
    'What is the model rate',
    'how much',
    'how much is it',
    'Where are you located',
    "We're r u located",
    'what time do you open',
    'how long does it take',
    'can i get more info'
  ]
  for (const c of cases) check(`unpunctuated question :: ${c}`, asksRealQuestion(turn(c)) === true)
}

// 2) Punctuated questions still count
{
  check('punctuated question', asksRealQuestion(turn('What is the model rate ?')) === true)
}

// 3) Bare confirmations are NOT questions (the double-check answer must still work)
{
  for (const c of ['yes', 'yeah', 'ok', 'okay', 'perfect', 'sounds good', 'bet', 'k']) {
    check(`bare confirmation not a question :: ${c}`, asksRealQuestion(turn(c)) === false)
  }
}

// 4) Plain statements are NOT questions
{
  for (const c of ['Maybe a snake coming out of a cowrie shell', 'i love your work', 'sent it']) {
    check(`statement not a question :: ${c.slice(0, 24)}`, asksRealQuestion(turn(c)) === false)
  }
}

// 5) A money question never returns a fixed booking packet
{
  for (const c of ['What is the model rate ?', 'What are your prices?', 'how much', 'whats the rate', '얼마예요']) {
    let out = 'threw'
    try { out = buildBooking(turn(c)) } catch { out = 'threw' }
    check(`price question never fixed-script :: ${c.slice(0, 22)}`, out === null || out === 'threw', String(out && out.packet ? 'packet' : out))
  }
}

console.log(`scv-question-shape-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
