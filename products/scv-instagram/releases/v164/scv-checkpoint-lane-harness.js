#!/usr/bin/env node
// Regression lock: a closed booking checkpoint stays closed.
//
// Audit 2026-08-02. A thread that had already reached the deposit went silent on:
//
//   "Yeah that makes perfect sense! I'm sure I'd be happy with whatever you do
//    — I love the work that you have posted."
//
// That is agreement with the artist's explanation of the trade, in reply to
// "does that make sense to you or do you want to talk it through a bit more?".
// It is not a booking confirmation. liveConfirmsDoubleCheck matched the bare
// "yeah" sitting inside a sentence about something else, the contract demanded
// deposit details, no packet could satisfy it, the reauthor budget drained, the
// runner threw, and the lead got nothing.
//
// The first reading of this was wrong and section 6 has the correction: the
// checkpoint gate was open because an OFFER to send the double-check counted as
// having sent it. No double-check was ever sent in that thread.
//
// Two guards, in the order they were found. Section 6 is the root cause.
// Sections 1-3 are the closure that keeps a finished checkpoint finished, which
// is still worth having for threads that really do complete: depositHandoffAlready
// Sent inspects only the latest assistant turn, a restart-recovery path, so it
// cannot see a handoff further back.
const path = require('path')
const contract = require(path.join(__dirname, 'scv-contract-harness.js'))
const closed = contract.depositHandoffClosedLatestDoubleCheck

let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

if (typeof closed !== 'function') {
  console.error('FAIL depositHandoffClosedLatestDoubleCheck not exported')
  process.exit(1)
}

const DOUBLE_CHECK = 'Name : Jayde M\nPhone Number : 9254303106\nAppointment date : 8th of August\nTime : 2pm\n\ncan you double check this just to make sure'
const DEPOSIT = 'To confirm your appointment the deposit would be 100.\nThis is my zelle!\ncontact@omarprotocol.com'
const history = (...rows) => ({ recent_history: rows.map(([role, text], i) => ({ role, text, message_id: 'h' + i })) })

// 1) Deposit after the double-check closes the lane.
{
  check('deposit after double-check closes it', closed(history(
    ['assistant', DOUBLE_CHECK], ['user', 'yes that looks right'], ['assistant', DEPOSIT]
  )) === true)
  check('closed stays closed across later chatter', closed(history(
    ['assistant', DOUBLE_CHECK], ['user', 'yes'], ['assistant', DEPOSIT],
    ['user', 'sent it'], ['assistant', 'got it'], ['user', 'yeah that makes perfect sense']
  )) === true)
}

// 2) A reschedule reopens it. This is why the check reads the order instead of
// asking whether a deposit was ever sent.
{
  check('newer double-check reopens the lane', closed(history(
    ['assistant', DOUBLE_CHECK], ['user', 'yes'], ['assistant', DEPOSIT],
    ['user', 'can we move it to the 20th'], ['assistant', DOUBLE_CHECK]
  )) === false)
}

// 3) Nothing sent yet, or only a double-check, leaves it open.
{
  check('double-check alone stays open', closed(history(['assistant', DOUBLE_CHECK], ['user', 'yes'])) === false)
  check('empty history stays open', closed({ recent_history: [] }) === false)
  check('missing history stays open', closed({}) === false)
  check('only chatter stays open', closed(history(['user', 'hi'], ['assistant', 'hey whats good'])) === false)
}

// 4) The gate consults it. Without the wiring the silence returns.
{
  const src = require('fs').readFileSync(path.join(__dirname, 'scv-contract-harness.js'), 'utf8')
  check('confirmation context consults the closure', /function doubleCheckConfirmationContext\(input\)[\s\S]{0,200}?depositHandoffClosedLatestDoubleCheck\(input\)\) return false/.test(src))
}

// 5) The over-match that made this reachable is worth stating outright: a bare
// affirmation word inside a sentence about something else is not a confirmation
// of a booking checkpoint. The closure above is what protects the thread today;
// this records the input that exposed it.
{
  const confirms = contract.liveConfirmsDoubleCheck
  if (typeof confirms === 'function') {
    const turn = "Yeah that makes perfect sense! I'm sure I'd be happy with whatever you do — I love the work that you have posted."
    const ctx = contract.doubleCheckConfirmationContext
    if (typeof ctx === 'function') {
      const input = {
        message: turn, text: turn, live_message: turn, structured_state: {},
        ...history(['assistant', DOUBLE_CHECK], ['user', 'yes'], ['assistant', DEPOSIT], ['assistant', 'does that make sense to you'])
      }
      check('closed checkpoint does not re-demand the deposit', ctx(input) === false, String(ctx(input)))
    }
  }
}

// 6) Offering to send the checkpoint is not sending it.
//
// This is the actual root cause of the silent turn above, and it corrects what
// the first pass assumed. The double-check was never sent in that thread. Turn 25
// was "if you want i can send the double check for your name phone date and time
// next" — a promise. The loose matcher needs only the four field NAMES, and that
// sentence lists all four, so it counted as sent. Every later affirmation then
// confirmed a checkpoint that did not exist.
//
// The same offered-is-not-sent rule already governs the form link. This is it
// applied to the booking checkpoint.
{
  const sent = contract.doubleCheckSentContext
  check('doubleCheckSentContext exported', typeof sent === 'function')
  if (typeof sent === 'function') {
    const withHistory = (text) => ({
      message: 'yeah', text: 'yeah', structured_state: {},
      recent_history: [{ role: 'assistant', message_id: 'a1', text }]
    })
    const offers = [
      'if you want i can send the double check for your name phone date and time next',
      'ill send the double check with your name phone date and time',
      'want me to send the double check for name phone date and time',
      'let me put together the double check with your name phone date and time',
      'should i send the double check with your name phone date and time'
    ]
    for (const offer of offers) {
      check(`offer is not sent :: ${offer.slice(0, 38)}`, sent(withHistory(offer)) === false, String(sent(withHistory(offer))))
    }
    const actuallySent = [
      DOUBLE_CHECK,
      'can you double check this  name Jayde  phone number 9254303106  appointment date 8th of August  time 2pm'
    ]
    for (const block of actuallySent) {
      check(`real checkpoint counts :: ${block.replace(/\n/g, ' ').slice(0, 34)}`, sent(withHistory(block)) === true, String(sent(withHistory(block))))
    }
  }
}

console.log(`scv-checkpoint-lane-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
