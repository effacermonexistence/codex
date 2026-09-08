#!/usr/bin/env node
// Regression lock: the money question is recognized however a lead phrases it.
//
// Audit 2026-08-02 traced a silent thread to one missing plural. The pricing noun
// list carried costs, charges, fees and rates but not "prices", so
// textAsksPricingOrPolicy returned false for "What are your prices?" — the single
// most common way a lead asks. The funnel-order floor then read the turn as
// "client did not ask about price", stripped the rate as a volunteered price,
// emptied the packet, and the runner threw. The lead got nothing.
//
// This is the third plural miss found in two days (vibes, references, prices), so
// the harness checks phrasings rather than one remembered sentence.
const path = require('path')
const contract = require(path.join(__dirname, 'scv-contract-harness.js'))
const asksPricing = contract.textAsksPricingOrPolicy

let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

// 1) Every phrasing a lead actually uses, singular and plural, with and without
// an auxiliary verb.
{
  const money = [
    'What are your prices?', 'what are your prices', 'whats your prices',
    'what is your price', 'whats your rate', 'whats your rates',
    'hows your pricing', 'whats your pricing', 'what are the rates',
    'What is the model rate ?', 'whats the rate', 'how much', 'how much is it',
    'how much do you charge', 'do you charge', 'price?', 'are there any fees',
    'can i get a quote', 'what are your estimates', 'what does it cost',
    'what are the costs'
  ]
  for (const turn of money) {
    check(`money turn :: ${turn.slice(0, 32)}`, asksPricing(turn) === true, String(asksPricing(turn)))
  }
}

// 2) Turns that merely resemble one. A false positive here unlocks rate talk on a
// turn that did not ask for it, which is the volunteered-price failure the funnel
// floor exists to stop.
{
  const notMoney = [
    'what are your hours', 'where are you located', 'i want a dragon',
    'can i get more info', 'august 17th works', 'whats your instagram',
    'what are your styles', 'do you have any openings', 'what time do you open',
    'how much i can tolerate in one sitting'
  ]
  for (const turn of notMoney) {
    check(`not money :: ${turn.slice(0, 32)}`, asksPricing(turn) === false, String(asksPricing(turn)))
  }
}

// 3) A quote can be the tattoo. Found while sweeping for more of the same
// singular/plural class: "can i get a quote tattooed on my arm" and "a quote in
// script on my forearm" were reading as money questions, so a lead describing
// lettering would have been answered with the rate. Pre-existing, not introduced
// by the plural fix, and the same wrong-lane family.
{
  const lettering = [
    'can i get a quote tattooed on my arm',
    'i want quotes on my ribs',
    'a quote in script on my forearm',
    'i want a quote piece',
    'a quote design on my ribs',
    'quote in cursive on my wrist'
  ]
  for (const turn of lettering) {
    check(`quote is the design :: ${turn.slice(0, 32)}`, asksPricing(turn) === false, String(asksPricing(turn)))
  }
  // A money word anywhere else keeps it a money turn, and a bare quote request
  // is still money — the disqualifier is only the adjacent motif marker.
  const stillMoney = [
    'can i get a quote',
    'can you quote me',
    'can i get a quote for a piece on my arm',
    'how much for a quote in script',
    'whats the price for a quote tattoo'
  ]
  for (const turn of stillMoney) {
    check(`still money :: ${turn.slice(0, 32)}`, asksPricing(turn) === true, String(asksPricing(turn)))
  }
}

// 4) The funnel-order floor reads this function to decide whether a rate is
// volunteered or answered. Wiring check: if that link is renamed, this harness
// stops protecting anything.
{
  const src = require('fs').readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
  // Multiline-tolerant: priceAsked became a parenthesised expression when the
  // trade-offer gate was added, and the old single-line pattern went stale.
  check('funnel floor still consults the detector', /const priceAsked =[\s\S]{0,320}?textAsksPricingOrPolicy\(/.test(src))
}

// 5) The same plural class, in the media classifier. A reference photo described
// as "existing tattoos covering both legs" was classified unknown because the
// last-resort test matched only the singular, so the media was never marked a
// tattoo reference and the design-interview lock never armed — which is why a
// banned interview question was still shipping in the final audit.
//
// Fourth plural miss in this pass (vibes, references, prices, tattoos), so this
// walks the singular/plural pairs instead of remembering the one description.
{
  const classify = contract.classifyReferenceMediaDescription
  check('classifier exported', typeof classify === 'function')
  if (typeof classify === 'function') {
    const nouns = ['tattoo', 'tattoos']
    const frames = ['a photo of existing %s covering both legs', 'japanese style %s', 'some %s on a leg', '%s']
    let missed = 0
    for (const noun of nouns) {
      for (const frame of frames) {
        const desc = frame.replace('%s', noun)
        if (classify(desc) !== 'tattoo_reference') { missed += 1; console.error(`  miss: ${desc} -> ${classify(desc)}`) }
      }
    }
    check(`tattoo reference recognized singular and plural (${nouns.length * frames.length} cases)`, missed === 0, String(missed))
    for (const desc of ['tattoo designs on a leg', 'flash sheets', 'tattooed arms', 'existing tattoos']) {
      check(`reference shape :: ${desc.slice(0, 26)}`, classify(desc) === 'tattoo_reference', classify(desc))
    }
    // Non-tattoo media must not be swept in by the widening.
    for (const desc of ['a website screenshot', 'a selfie of a person', 'a landscape photo', 'an app screenshot', 'a chat screenshot', 'a presentation slide']) {
      check(`not a reference :: ${desc.slice(0, 26)}`, classify(desc) !== 'tattoo_reference', classify(desc))
    }
  }
}

// 6) The money lane opens without anyone asking a price. Audit 2026-08-02 traced
// a silent thread to a deadlock between two correct rules:
//
//   funnel_order_stripped        price_asked:false        -> removes the rate
//   stripped_survivor_rejected   closed_transition_rate_missing -> demands the rate
//
// Twelve reauthor passes, then the runner threw and the lead got nothing. The
// lead had said "happy to trade images of my likeness for your talent" — a money
// turn with no price question in it. Same deadlock shape as the 2026-07-29 retry
// limbo, a different pair of rules, so the harness guards the shape.
{
  const raisesMoney = contract.liveTurnRaisesMoneyTerms
  check('money-terms detector exported', typeof raisesMoney === 'function')
  if (typeof raisesMoney === 'function') {
    const money = [
      'I am a professional model and am happy to trade images of my likeness for your talent as a tattoo artist',
      'happy to trade images for the work',
      'can we do a trade for the piece',
      'i will Zelle you $100 flat for making the piece',
      'ill venmo you 100',
      'would you do it for free if i model',
      'i can pay in exposure',
      'in exchange for the tattoo'
    ]
    for (const turn of money) {
      check(`money terms :: ${turn.slice(0, 34)}`, raisesMoney(turn) === true, String(raisesMoney(turn)))
    }
    const notMoney = [
      'i want a dragon on my arm', 'august 17th at 3pm works', 'can i get more info',
      'where are you located', 'i traded my shift at work', 'yes that looks right'
    ]
    for (const turn of notMoney) {
      check(`no money terms :: ${turn.slice(0, 30)}`, raisesMoney(turn) === false, String(raisesMoney(turn)))
    }
    // Wiring: the funnel floor must consult it, otherwise the deadlock returns.
    const src = require('fs').readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
    check('funnel floor consults money-terms', /const priceAsked = \([\s\S]{0,320}?liveTurnRaisesMoneyTerms\(/.test(src))
  }
}

console.log(`scv-price-question-detection-harness: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
