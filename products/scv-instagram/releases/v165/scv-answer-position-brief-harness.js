#!/usr/bin/env node
// Regression lock: naming a subject counts as a design direction even when the
// client answers with the bare thing, and only then.
//
// Audit 2026-08-02: "like a jelly fish/ seahorse / mermaid type of sensual on my
// thigh" scored as no design direction, so the funnel floor stripped the form
// offer and the bot could only keep asking design questions. That is the loop
// behind the design_given_no_form_move family.
//
// Two paths existed and neither could see it. concreteSubject is a motif
// dictionary that does not contain jellyfish and never will contain every motif.
// liveHasOpenVocabularyDesignSubject is open-vocabulary but requires an intent
// sentence, and on Instagram people answer a question with the noun.
//
// The gate is therefore discourse plus answer shape, not vocabulary. The failure
// mode on the other side is worse than the loop — a form offer on a price turn
// is the premature push Ben rejected on 2026-07-08 — so most of this file is the
// negative battery.
const path = require('path')
const contract = require(path.join(__dirname, 'scv-contract-harness.js'))
const hasDirection = contract.liveHasConcreteDesignDirection

let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

const ASKED = [{ role: 'assistant', message_id: 'a1', text: 'do you have an idea in mind for the tattoo?' }]
const NOT_ASKED = [{ role: 'assistant', message_id: 'a1', text: 'the rate is 150 an hour' }]
const direction = (text, history) => hasDirection({
  message: text, text, structured_state: { live_turn_text: text }, recent_history: history
})

// 1) A named subject in answer position is a design direction, whatever the motif
// is. These are all outside the motif dictionary on purpose.
{
  const briefs = [
    'like a jelly fish/ seahorse / mermaid type of sensual on my thigh',
    'a koi fish',
    'octopus on my forearm',
    'moth and moon, small',
    'a cicada',
    'some peonies',
    'a luna moth on my ribs'
  ]
  for (const brief of briefs) {
    check(`brief accepted :: ${brief.slice(0, 40)}`, direction(brief, ASKED) === true)
  }
}

// 2) Being asked does not make every following turn a brief. A form offer on any
// of these would be the premature funnel push.
{
  const notBriefs = [
    'how much is it', 'whats the price', 'do you have a price list',
    'where are you located', 'can i get more info', 'what time do you open',
    'do you take walk ins', 'is there parking',
    'im not comfortable sending a deposit', 'can i pay the deposit later',
    'august 17th at 3pm works', 'monday would be better',
    'yes that looks right', 'im interested', 'sounds good', 'ok', 'thanks',
    'idk', 'not sure yet', 'whatever you think', 'up to you', 'anything you want'
  ]
  for (const turn of notBriefs) {
    check(`not a brief :: ${turn.slice(0, 34)}`, direction(turn, ASKED) === false, String(direction(turn, ASKED)))
  }
}

// 3) Without the question, nothing changes. The discourse gate is the whole point
// — this branch must not become a general noun-phrase detector.
{
  for (const turn of ['a koi fish', 'octopus on my forearm', 'some peonies']) {
    check(`unasked stays unchanged :: ${turn.slice(0, 30)}`, direction(turn, NOT_ASKED) === false)
  }
  check('no history stays unchanged', direction('a koi fish', []) === false)
}

// 4) The question has to be the open idea-pull. The banned detailed interview
// must not become a way to arm this.
{
  const asks = [
    ['do you have an idea in mind for the tattoo?', true],
    ['what kind of piece are you thinking about?', true],
    ['any references or vibes you like?', true],
    ['the rate is 150 an hour', false],
    ['what day works for you?', false],
    ['can you double check this?', false]
  ]
  for (const [ask, shouldArm] of asks) {
    const armed = direction('a koi fish', [{ role: 'assistant', message_id: 'a1', text: ask }])
    check(`arming :: ${ask.slice(0, 34)}`, armed === shouldArm, String(armed))
  }
}

// 5) The pre-existing paths still work, so this is additive.
{
  check('motif dictionary still fires', direction('I was thinking about a dragon', NOT_ASKED) === true)
  check('open vocabulary still fires', direction('i want a jellyfish tattoo', NOT_ASKED) === true)
  check('empty turn is not a brief', direction('', ASKED) === false)
}

console.log(`scv-answer-position-brief-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
