#!/usr/bin/env node
// Regression lock: a money turn always gets the rate, and never gets the booking
// checkpoint. Behaviour audit 2026-08-01 caught "What is the model rate ?"
// answered with another lead's name, phone number, date and time.
//
// Routing was fixed first and the failure survived: the model lane then authored
// the same block from the prompt's format instruction. Only the output floor
// held, so this harness guards the floor, not the routing.
const path = require('path')
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const floor = runner.enforcePricingAnswerFloor

let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

if (typeof floor !== 'function') {
  console.error('FAIL enforcePricingAnswerFloor not exported')
  process.exit(1)
}

const CHECKPOINT = 'Name : Jayde M\nPhone Number : 9254303106\nAppointment date : 8th of August\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤'
const run = (text, bubbles) => floor({ text, structured_state: {} }, { bubbles: bubbles.map((t) => ({ text: t })) })
const joined = (p) => p.bubbles.map((b) => b.text).join('\n')

// 1) The booking checkpoint is never the answer to a money question
{
  for (const q of ['What is the model rate ?', 'What are your prices?', 'how much', 'whats the rate', '얼마예요']) {
    const out = run(q, [CHECKPOINT])
    check(`checkpoint dropped :: ${q.slice(0, 22)}`, !/Phone Number/i.test(joined(out)), joined(out).slice(0, 40))
  }
}

// 2) A missing rate is rejected for model re-author; the guard does not write it.
{
  for (const q of ['What are your prices?', 'how much is it', 'What is the model rate ?']) {
    const out = run(q, ['anything else on your mind or just curious right now'])
    const verdict = runner.verifyPostFilterAdoption({ text: q, structured_state: {} }, out)
    check(`missing rate requires reauthor :: ${q.slice(0, 22)}`,
      !/\b150\b/.test(joined(out)) &&
      out.non_authoring_surface_mutations?.includes('pricing_question_missing_visible_rate') &&
      verdict.valid === false &&
      verdict.reason === 'non_authoring_guard_requires_model_reauthor',
      JSON.stringify({ out, verdict }))
  }
}

// 3) A reply that already answers the rate is left alone
{
  const good = 'the rate is 150 an hour and it only applies if the piece stays in my style'
  const out = run('how much', [good])
  check('good rate answer untouched', out.bubbles.length === 1 && out.bubbles[0].text === good, joined(out))
}

// 4) Non-money turns are never touched, including the real double-check moment
{
  const out = run('yes that all looks right', [CHECKPOINT])
  check('non-money turn keeps checkpoint', /Phone Number/i.test(joined(out)), joined(out).slice(0, 40))
  const out2 = run('Maybe a snake coming out of a cowrie shell', ['that snake idea sounds sick'])
  check('non-money turn gets no rate injection', !/\b150\b/.test(joined(out2)), joined(out2))
}

// 5) Empty input remains non-authoring and is marked for re-author.
{
  const out = run('how much', [])
  check('empty packet requires model reauthor',
    out.bubbles.length === 0 &&
      out.non_authoring_surface_mutations?.includes('pricing_question_missing_visible_rate'))
}

// 6) The floor must see the turn no matter which field carries it.
// Audit 2026-08-02: liveInputText returned '' whenever live_message existed but
// was empty, so every gate reading it went blind and "What are your prices?"
// shipped with no rate. Non-empty live_message must still win (atomic turn).
{
  const shapes = [
    ['text only', { text: 'What are your prices?', structured_state: {} }],
    ['live_message', { live_message: 'What are your prices?', message: '', structured_state: {} }],
    ['message only', { message: 'What are your prices?', structured_state: {} }],
    ['empty live_message + message', { live_message: '', message: 'What are your prices?', structured_state: {} }],
    ['blank live_message + message', { live_message: '   ', message: 'how much', structured_state: {} }]
  ]
  for (const [name, input] of shapes) {
    const out = floor(input, { bubbles: [{ text: 'what kind of vibe do you have in mind' }] })
    check(`floor sees turn :: ${name}`,
      out.non_authoring_surface_mutations?.includes('pricing_question_missing_visible_rate') &&
      !/\b150\b/.test(out.bubbles.map((b) => b.text).join(' ')))
  }
  const atomicWins = runner.liveTurnAsksRealQuestion({ live_message: 'ok', message: 'What are your prices?', structured_state: {} })
  check('non-empty live_message still wins', atomicWins === false)
}

// 7) The authority exit is a fail-closed assertion, never a second prose author.
{
  const authority = require(path.join(__dirname, 'dm-authority.js'))
  const finalFloor = authority.applyFinalPricingFloor
  if (typeof finalFloor !== 'function') {
    check('applyFinalPricingFloor exported', false)
  } else {
    const run2 = (msg, bubbles) => finalFloor(msg, { bubbles: bubbles.map((t) => ({ text: t })) })
    const errorFor = (msg, bubbles) => {
      try { run2(msg, bubbles); return '' } catch (error) { return String(error?.message || error) }
    }

    const deflect = errorFor({ text: 'What are your prices?' }, ['what kind of idea or vibe were you thinking about'])
    check('authority rejects rate-less reply',
      deflect === 'final_pricing_contract_rejected_model_authored_rate_missing', deflect)

    const cp = errorFor({ live_message: 'What is the model rate ?' }, [CHECKPOINT])
    check('authority rejects booking checkpoint',
      cp === 'final_pricing_contract_rejected_booking_checkpoint', cp)

    const good = run2({ message: 'how much' }, ['the rate is 150 an hour if it stays in my style'])
    check('authority accepts model-authored answer',
      good.bubbles.length === 1 && /\b150\b/.test(good.bubbles[0].text), joined(good))

    const untouched = run2({ text: 'i want a snake tattoo' }, ['that snake idea sounds sick'])
    check('authority skips non-money',
      untouched.bubbles.length === 1 && !/\b150\b/.test(untouched.bubbles[0].text), joined(untouched))

    for (const shape of [{ text: 'how much' }, { live_message: 'how much' }, { message: 'how much' }, { live_message: '', message: 'how much' }]) {
      const error = errorFor(shape, ['no rate here'])
      check(`authority floor reads ${Object.keys(shape).join('+')}`,
        error === 'final_pricing_contract_rejected_model_authored_rate_missing', error)
    }
  }
}

console.log(`scv-pricing-floor-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
