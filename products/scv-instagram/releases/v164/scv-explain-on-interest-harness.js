#!/usr/bin/env node
// April sole-authority regression: information replies must be model-authored,
// and generic "how does this/that/it work" cannot be relabeled as a tattoo/model
// question without a grounded referent.
const path = require('path')
const authority = require(path.join(__dirname, 'dm-authority.js'))
const contract = require(path.join(__dirname, 'scv-contract-harness.js'))
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const {
  deriveClosedTransitionPlan
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))

const floor = authority.applyExplainOnInterestFloor
let passed = 0
let failed = 0
function check(name, cond, got) {
  if (cond) { passed += 1; console.log(`PASS ${name}`) }
  else { failed += 1; console.error(`FAIL ${name}${got === undefined ? '' : ` :: got [${got}]`}`) }
}

if (typeof floor !== 'function') {
  console.error('FAIL applyExplainOnInterestFloor not exported')
  process.exit(1)
}

const EXPLANATION = 'the model spot means i design the tattoo around what you want while the finished piece stays in my style'
const CLARIFICATION = 'what are you referring to there?'
const packet = (...texts) => ({ bubbles: texts.map((text) => ({ text, delay_ms: 0 })) })
const run = (msg, ...texts) => floor(msg, packet(...texts))
const throws = (fn, prefix) => {
  try { fn(); return '' } catch (error) {
    const message = String(error?.message || error)
    return message.startsWith(prefix) ? message : `wrong_error:${message}`
  }
}

// 1) Explicit ad-interest openers keep a valid model-authored explanation.
const explicitOpeners = [
  'Hi, can I please get more information?',
  'Hello, can I get more info on this?',
  'can i get some more information',
  'Could I please have more details?',
  'May I know more information?',
  'Could you tell me a little more about this?',
  'I would like some more details',
  'Where can I find more information?',
  'Hi! I would be interested',
  "I'm interested",
  'i am interested',
  'Hi! More info please',
  'what are the requirements'
]
for (const opener of explicitOpeners) {
  const out = run({ text: opener, contact_id: 'c1' }, EXPLANATION)
  check(`model explanation kept :: ${opener.slice(0, 24)}`,
    out.bubbles.length === 1 && out.bubbles[0].text === EXPLANATION,
    out.bubbles.map((bubble) => bubble.text).join(' | '))
}

// 2) No deterministic sentence is inserted when the model omitted the answer.
for (const opener of explicitOpeners) {
  const error = throws(
    () => run({ text: opener, contact_id: 'c1' }, 'check my highlights'),
    'info_opener_requires_model_authored_explanation'
  )
  check(`missing explanation fails closed :: ${opener.slice(0, 20)}`,
    error.startsWith('info_opener_requires_model_authored_explanation'), error)
}

// 3) A generic deictic question with no tattoo/ad/model context asks for its
// referent. It never gets an assumed model-spot explanation.
for (const text of ['how does this work', 'how does that work', 'how does it work']) {
  const msg = {
    text,
    recent_history: [],
    structured_state: {
      booking_stage_hint: 'open_conversation',
      tattoo_intent_active: text === 'how does that work',
      live_turn_context_missing: true,
      live_turn_context_needs_clarification: true
    }
  }
  const annotated = authority.annotateStructuredStateForLiveTurn(
    { text, message: text },
    { tattoo_intent_active: text === 'how does that work', booking_stage_hint: 'open_conversation' },
    []
  )
  const route = deriveClosedTransitionPlan({
    message: text,
    live_message: text,
    recent_history: [],
    structured_state: annotated
  })
  check(`generic has no tattoo context :: ${text}`,
    authority.genericHowWorksHasTattooContext(msg) === false &&
      annotated.live_turn_context_needs_clarification === true &&
      route.action === 'resolve_context' &&
      route.reason === 'ambiguous_missing_referent',
    JSON.stringify({ annotated, route }))
  const clarified = run(msg, CLARIFICATION)
  check(`generic clarification accepted :: ${text}`,
    clarified.bubbles[0].text === CLARIFICATION, clarified.bubbles[0].text)
  const error = throws(
    () => run(msg, EXPLANATION),
    'generic_how_works_requires_referent_clarification'
  )
  check(`generic tattoo assumption rejected :: ${text}`,
    error.startsWith('generic_how_works_requires_referent_clarification'), error)
}

// 4) The same wording is an information opener when authoritative context
// actually establishes the tattoo/model/ad referent.
const contextual = [
  {
    text: 'how does this work',
    recent_history: [{ role: 'assistant', text: 'you here about the model spots?' }],
    structured_state: { booking_stage_hint: 'design_intake' }
  },
  {
    text: 'how does that work',
    recent_history: [{ role: 'user', text: 'i saw your tattoo ad' }],
    structured_state: { booking_stage_hint: 'open_conversation' }
  },
  {
    text: 'how does it work',
    recent_history: [],
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
  }
]
for (const msg of contextual) {
  check(`context grounds offer :: ${msg.text}`,
    authority.genericHowWorksHasTattooContext(msg) === true)
  const out = run(msg, EXPLANATION)
  check(`contextual explanation accepted :: ${msg.text}`,
    out.bubbles[0].text === EXPLANATION, out.bubbles[0].text)
  const error = throws(
    () => run(msg, 'what are you curious about?'),
    'info_opener_requires_model_authored_explanation'
  )
  check(`contextual omission rejected :: ${msg.text}`,
    error.startsWith('info_opener_requires_model_authored_explanation'), error)
}

// 5) Unrelated turns are untouched.
for (const text of [
  'Maybe a snake coming out of a cowrie shell',
  'yes that all looks right',
  'august 17th at 3pm works'
]) {
  const out = run({ text }, 'sounds good')
  check(`unrelated untouched :: ${text.slice(0, 24)}`,
    out.bubbles.length === 1 && out.bubbles[0].text === 'sounds good')
}

// 6) The live turn may arrive through any of the authority input fields.
for (const shape of [
  { text: "i'm interested" },
  { live_message: "i'm interested" },
  { message: "i'm interested" },
  { live_message: '', message: 'can i get more info' }
]) {
  const out = run(shape, EXPLANATION)
  check(`reads ${Object.keys(shape).join('+')}`, out.bubbles[0].text === EXPLANATION)
}

// 7) Empty required replies fail closed; irrelevant empty packets remain inert.
{
  const error = throws(
    () => run({ text: "i'm interested" }),
    'info_opener_requires_model_authored_explanation'
  )
  check('empty explicit info packet fails closed',
    error.startsWith('info_opener_requires_model_authored_explanation'), error)
  const out = run({ text: 'thanks' })
  check('empty unrelated packet remains inert', Array.isArray(out.bubbles) && out.bubbles.length === 0)
}

// 8) Adoption checks never rewrite the already-authored surface.
for (const text of [
  'the model spot is a tattoo built around your idea in my style',
  'i take a few spots for tattoos that stay in my style',
  'the finished piece stays in my visual language and i design it for you',
  'a model spot is custom to you while the piece fits my style'
]) {
  const out = run({ text: "i'm interested" }, text)
  check(`authored surface unchanged :: ${text.slice(0, 26)}`,
    out.bubbles.length === 1 && out.bubbles[0].text === text,
    out.bubbles.map((bubble) => bubble.text).join(' | '))
}

// 9) The runner verifier carries the same semantic boundary, so it gets one
// bounded re-author attempt before a visible non-transactional clarification.
for (const text of ['how does this work', 'how does that work', 'how does it work']) {
  const input = {
    text,
    message: text,
    live_message: text,
    recent_history: [],
    structured_state: {
      live_turn_context_missing: true,
      live_turn_context_needs_clarification: true,
      booking_stage_hint: 'open_conversation'
    }
  }
  const verdict = contract.evaluateScvContractHarness(input, packet(EXPLANATION))
  check(`contract rejects generic assumption :: ${text}`,
    verdict.valid === false && verdict.reason === 'generic_how_works_requires_referent_clarification',
    verdict.reason)
}

for (const opener of explicitOpeners.slice(0, 3)) {
  const greeting = /^\s*(?:hey+|hi+|hello)\b/i.test(opener) ? 'hii yeah of course ' : ''
  const verdict = contract.evaluateScvContractHarness(
    { text: opener, message: opener, live_message: opener, recent_history: [], structured_state: {} },
    packet(`${greeting}check my highlights and send me a reference?`)
  )
  check(`contract rejects missing explanation :: ${opener.slice(0, 20)}`,
    verdict.valid === false && verdict.reason === 'info_opener_requires_model_authored_explanation',
    verdict.reason)
}

for (const opener of explicitOpeners.slice(0, 3)) {
  const greeting = /^\s*(?:hey+|hi+|hello)\b/i.test(opener) ? 'hii yeah of course ' : ''
  const verdict = contract.evaluateScvContractHarness(
    { text: opener, message: opener, live_message: opener, recent_history: [], structured_state: {} },
    packet(
      `${greeting}the model spot means i build the tattoo around your idea while it stays in my style`,
      'send me any loose idea or reference you have in mind?'
    )
  )
  check(`contract accepts authored explanation :: ${opener.slice(0, 20)}`,
    verdict.valid === true, verdict.reason)
}

async function runFlowCheck() {
  const input = {
    contact_id: 'ambiguous-how-flow',
    thread_id: 'ambiguous-how-flow',
    text: 'how does that work',
    message: 'how does that work',
    live_message: 'how does that work',
    recent_history: [],
    structured_output_required: true,
    structured_state: {
      live_turn_reply_required: true,
      live_turn_context_missing: true,
      live_turn_context_needs_clarification: true,
      live_turn_context_relation: 'ambiguous_missing_referent',
      booking_stage_hint: 'open_conversation'
    },
    control_transition_contract: {
      action: 'resolve_context',
      reason: 'ambiguous_missing_referent',
      obligations: [],
      fields: {}
    }
  }
  const rejected = JSON.stringify({
    reply_text: EXPLANATION,
    acknowledged_fields: [],
    questioned_fields: ['design_direction'],
    next_action_reflected: 'resolve_context',
    bubbles: [{ text: EXPLANATION, delay_ms: 0 }]
  })
  let calls = 0
  let output = null
  let error = ''
  try {
    output = await runner.runModelAuthoredFlow(input, '', {
      authorityExecutor: async () => {
        calls += 1
        return {
          status: 0,
          stderr: '',
          error: '',
          modelUsed: 'explain-harness-model',
          executor: 'explain_harness_rejected_candidate',
          lastMessage: rejected
        }
      }
    })
  } catch (caught) {
    error = String(caught?.message || caught)
  }
  check('runner spends three cumulative model candidates', calls === 3, calls)
  check('ambiguous_referent_exhaustion_stays_on_original_route_for_outer_reauthor',
    output === null &&
      error.startsWith('post_filter_adoption_rejected_after_reauthor_'),
    error || JSON.stringify(output))

  console.log(`scv-explain-on-interest-harness: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

runFlowCheck().catch((error) => {
  console.error(String(error?.stack || error))
  process.exitCode = 1
})
