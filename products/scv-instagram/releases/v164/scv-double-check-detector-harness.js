#!/usr/bin/env node

// Double-check recognition + expression core seal (live 2026-08-27): the model
// authored the four-field double-check twice ("Name: ..." then "Name on file
// ...") without the explicit "double check this" ask, the detector refused to
// count either block as sent, and the client's confirmation produced a second
// identical block instead of the deposit handoff. Labeled four-field blocks now
// count as the double-check object in every live format; the owner-installed
// expression core is pinned into the visible authoring instructions.

const assert = require('assert')
const {
  packetHasLooseNamePhoneDateTimeDoubleCheck,
  assistantSentNamePhoneDateTimeDoubleCheck
} = require('./scv-contract-harness.js')
const { buildResponsesVisibleSystemPrompt } = require('./codex-dm-runner.js')

let checked = 0
function check(name, value) { assert.ok(value, name); checked += 1 }
const packetOf = (...texts) => ({ bubbles: texts.map((text) => ({ text })) })

// Format A: model colon block WITHOUT the ask (live 18:36 incident shape).
check('colon_block_without_ask_counts', packetHasLooseNamePhoneDateTimeDoubleCheck(packetOf(
  'Name: Codex 09', 'Phone: 1231234213', 'Appointment date: September 5 2026', 'Appointment time: 1 PM'
)))
// Format B: "on file" block WITHOUT the ask (live 18:38 incident shape).
check('on_file_block_without_ask_counts', packetHasLooseNamePhoneDateTimeDoubleCheck(packetOf(
  'Name on file Codex 09', 'Phone on file 1231234213', 'Appointment date September 5 2026', 'Appointment time 1 PM'
)))
// Format C: the deterministic single-bubble checkpoint (unchanged, still counts).
check('locked_checkpoint_format_counts', packetHasLooseNamePhoneDateTimeDoubleCheck(packetOf(
  'Name : Codex 09\nPhone Number : 1231234213\nAppointment date : September 5 2026\nTime : 1 PM\n\ncan you double check this just to make sure'
)))
// A promise to send one is still NOT a sent double-check.
check('promise_to_double_check_not_counted', !packetHasLooseNamePhoneDateTimeDoubleCheck(packetOf(
  "i'll send a quick double check with your name phone date and time next"
)))
// Loose four words without labels and without the ask stay uncounted.
check('unlabelled_prose_not_counted', !packetHasLooseNamePhoneDateTimeDoubleCheck(packetOf(
  'what name and phone number did you use and what date and time work for you'
)))

// History recognition: the model-format block in visible history counts as sent.
check('history_with_model_block_counts_as_sent', assistantSentNamePhoneDateTimeDoubleCheck({
  recent_history: [
    { role: 'assistant', message_id: 'a1', text: 'Name: Codex 09' },
    { role: 'assistant', message_id: 'a1', text: 'Phone: 1231234213' },
    { role: 'assistant', message_id: 'a1', text: 'Appointment date: September 5 2026' },
    { role: 'assistant', message_id: 'a1', text: 'Appointment time: 1 PM' }
  ]
}))

// Owner-installed expression core pinned into the authoring instructions.
const visiblePrompt = buildResponsesVisibleSystemPrompt()
check('expression_core_installed', visiblePrompt.includes('SELF-IDENTITY CORE PROMPT'))
check('final_expression_gate_installed', visiblePrompt.includes('Final Expression Gate'))
check('generic_ai_tone_ban_installed', visiblePrompt.includes('GENERIC AI TONE BAN'))
check('internal_identity_stays_internal',
  visiblePrompt.includes('Never print Ben') || visiblePrompt.includes('never printed'))
check('prompt_stays_bounded', Buffer.byteLength(visiblePrompt) < 40000)

console.log(`scv-double-check-detector-harness ok checks=${checked}`)
