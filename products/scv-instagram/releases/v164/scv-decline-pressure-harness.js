#!/usr/bin/env node
// Regression lock: after a lead declines the deposit, the bot acknowledges and
// stops selling. Live thread 164179328 (2026-08-01): the lead said twice that
// they were not comfortable paying before meeting, and got the requirement back
// three turns in a row, including "the slot can't be officially confirmed".
//
// Also locks the widened pressure/lock surface rewrites, which leaked because the
// old pattern only covered lock + slot/spot.
const path = require('path')
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const floor = runner.enforceDepositDeclineFloor
const surface = runner.enforceDmSurfaceText
const declines = runner.liveTurnDeclinesDeposit

let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

for (const fn of [floor, surface, declines]) {
  if (typeof fn !== 'function') { console.error('FAIL required exports missing'); process.exit(1) }
}

const turn = (text) => ({ text, structured_state: {} })
const pack = (...texts) => ({ bubbles: texts.map((t) => ({ text: t })) })
const texts = (p) => p.bubbles.map((b) => b.text)

// 1) Decline detection
{
  const yes = [
    "Understood! I'm not comfortable sending any deposit before we actually meet",
    "I'm just not comfortable making a deposit before we've met in person",
    'i would prefer not to send a deposit until the day of',
    "i'd rather not pay anything up front"
  ]
  for (const t of yes) check(`decline detected :: ${t.slice(0, 30)}`, declines(turn(t)) === true)
  const no = ['ok sounds good', 'i sent the deposit', 'what is the deposit', 'yeah lets do it']
  for (const t of no) check(`not a decline :: ${t.slice(0, 24)}`, declines(turn(t)) === false)
}

// 2) After a decline the requirement is not restated
{
  const out = floor(turn("I'm not comfortable sending a deposit before we meet"), pack(
    'i get that sending a deposit before meeting feels off to you',
    'just so you know the $100 deposit is what confirms your appointment on my calendar',
    'the appointment is confirmed once the deposit is in'
  ))
  check('requirement bubbles stripped', texts(out).length === 1, texts(out).join(' | ').slice(0, 60))
  check('acknowledgement survives', /i get that/i.test(texts(out)[0]), texts(out)[0])
}

// 3) If stripping removes the whole draft, require model re-author. The guard
// does not fill the turn with a canned acceptance.
{
  const input = turn("i'm not comfortable paying a deposit yet")
  const out = floor(input, pack(
    'the deposit is required before i can confirm'
  ))
  const verdict = runner.verifyPostFilterAdoption(input, out)
  check('all-pressure draft is stripped', texts(out).length === 0, texts(out).join(''))
  check('all-pressure draft requires model reauthor',
    out.non_authoring_surface_mutations?.includes('deposit_requirement_repeated_after_decline') &&
      verdict.valid === false && verdict.reason === 'non_authoring_guard_requires_model_reauthor',
    JSON.stringify(verdict))
}

// 4) Normal turns keep deposit copy
{
  const out = floor(turn('ok sounds good'), pack('the deposit confirms your appointment'))
  check('normal turn untouched', texts(out)[0] === 'the deposit confirms your appointment', texts(out)[0])
}

// 5) Pressure and lock surface rewrites
{
  const cases = [
    ['just so you know the $100 deposit is what locks your appointment on my calendar', /confirms your appointment/i],
    ['i want to make sure your spot is held tight for the 17th at 3p', /still open/i],
    ['the slot cant be officially confirmed until its in', /confirmed once the deposit/i],
    ['im holding that 8/17 at 3p spot for you', /still open for you/i],
    ['lets lock in your spot', /confirm/i]
  ]
  for (const [input, want] of cases) {
    const got = surface(input)
    check(`pressure rewritten :: ${input.slice(0, 30)}`, want.test(got) && !/\block(s|ed)?\s+(your|the|it)\b/i.test(got), got)
  }
  check('no doubled article', !/\bthe\s+the\b/i.test(surface('the slot cant be officially confirmed until its in')))
}

console.log(`scv-decline-pressure-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
