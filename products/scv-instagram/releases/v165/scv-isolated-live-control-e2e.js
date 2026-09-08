#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const sourceRoot = path.resolve(process.env.SCV_E2E_SOURCE_ROOT || (__dirname === '.' ? process.cwd() : __dirname))
const scenarioName = String(process.argv[2] || 'form').trim().toLowerCase()
const scenarios = Object.freeze({
  form: Object.freeze([
    'Hi can I please get more information?',
    'I am thinking of a black and grey heron with water around it. How much is it by the way?',
    'YES PLEASE'
  ]),
  submit: Object.freeze([
    'Hi can I please get more information?',
    'I am thinking of a black and grey heron with water around it. How much is it by the way?',
    'YES PLEASE',
    'I just submit'
  ]),
  explicit_date: Object.freeze([
    'Hi can I please get more information?',
    'I am thinking of a black and grey heron with water around it. How much is it by the way?',
    'YES PLEASE',
    'I just submit',
    'How about 26 August?'
  ]),
  date_continuation: Object.freeze([
    'Hi can I please get more information?',
    'I am thinking of a black and grey heron with water around it. How much is it by the way?',
    'YES PLEASE',
    'I just submit',
    'Can we do 27 of August?',
    'Can we do 28?'
  ]),
  deposit: Object.freeze([
    'Hi can I please get more information?',
    'I am thinking of a black and grey heron with water around it. How much is it by the way?',
    'YES PLEASE',
    'I just sent it. How about August 30?',
    '2pm works for me. Black and grey is okay right?',
    'My name is Ben Lee and my phone is 415-555-0136',
    'Yes that is all correct'
  ]),
  slot_acceptance: Object.freeze([
    'Hi can I please get more information?',
    'I am thinking of a black and grey heron with water around it. How much is it by the way?',
    'YES PLEASE',
    'I just sent it. How about August 30?',
    '2pm works for me. Black and grey is okay right?'
  ]),
  runner_form_stress: Object.freeze([]),
  runner_chain_stress: Object.freeze([])
})

if (!Object.prototype.hasOwnProperty.call(scenarios, scenarioName)) {
  throw new Error(`unknown_scenario:${scenarioName}`)
}
if (!fs.existsSync(path.join(sourceRoot, 'scv-single-control-plane.js'))) {
  throw new Error(`source_root_invalid:${sourceRoot}`)
}

function buildIsolatedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-live-control-e2e-'))
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (entry.isFile()) {
      fs.copyFileSync(path.join(sourceRoot, entry.name), path.join(root, entry.name))
    }
  }
  for (const name of ['prompt-authority', 'prompt-stones']) {
    const from = path.join(sourceRoot, name)
    if (fs.existsSync(from)) fs.cpSync(from, path.join(root, name), { recursive: true })
  }
  return root
}

function visibleBubbles(result) {
  return (Array.isArray(result?.packet?.bubbles) ? result.packet.bubbles : [])
    .map((bubble) => String(bubble?.text || '').trim())
    .filter(Boolean)
}

async function main() {
  const root = buildIsolatedRoot()
  const previousRoot = process.env.SCV_ROOT
  const threadId = `isolated-${scenarioName}-${Date.now()}`
  const startedAt = Date.now()
  const outputs = []
  process.env.SCV_ROOT = root
  process.env.SCV_QA_TRACE_REJECTED = process.env.SCV_QA_TRACE_REJECTED || '1'

  try {
    if (scenarioName === 'runner_chain_stress') {
      const authority = require(path.join(sourceRoot, 'dm-authority.js'))
      const { deriveClosedTransitionPlan } = require(path.join(sourceRoot, 'scv-closed-transition-contract.js'))
      const attempts = Math.max(1, Math.min(8, Number(process.env.SCV_E2E_ATTEMPTS) || 3))
      const chainMessages = scenarios.submit
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        let recentHistory = []
        let structuredState = {}
        let chainOk = true
        for (const [index, text] of chainMessages.entries()) {
          const turn = index + 1
          const messageId = `${threadId}-${attempt}-${turn}`
          const message = {
            source: 'scv-isolated-live-control-e2e',
            thread_id: `${threadId}-${attempt}`,
            contact_id: `${threadId}-${attempt}`,
            instagram_username: 'isolated_live_control_e2e',
            message_id: messageId,
            text,
            message: text,
            received_at: new Date(startedAt + ((attempt - 1) * 10 + index) * 60_000).toISOString()
          }
          const transitionPlan = deriveClosedTransitionPlan({
            ...message,
            recent_history: recentHistory,
            structured_state: structuredState
          })
          try {
            const result = authority.generatePacketFromCodexAuthority(message, {
              recent_history_override: recentHistory,
              structured_state_override: structuredState,
              control_transition_contract: transitionPlan
            })
            const bubbles = visibleBubbles(result)
            const conversation = result?.authority?.openai_conversation || null
            recentHistory.push({ role: 'user', text, message_id: messageId })
            for (const [bubbleIndex, bubbleText] of bubbles.entries()) {
              recentHistory.push({
                role: 'assistant',
                text: bubbleText,
                message_id: messageId,
                reply_to_message_id: messageId,
                bubble_index: bubbleIndex,
                delivery_confirmed: true,
                delivery_status: 'success_visible'
              })
            }
            structuredState = { ...(result?.structured_state || structuredState) }
            if (transitionPlan.action === 'offer_form') structuredState.form_offer_asked = true
            if (transitionPlan.action === 'send_form') {
              structuredState.form_offer_asked = true
              structuredState.form_link_sent = true
            }
            structuredState.openai_previous_response_id = String(conversation?.response_id || '')
            structuredState.openai_conversation_last_message_id = messageId
            const row = {
              attempt,
              turn,
              ok: true,
              action: transitionPlan.action,
              reason: transitionPlan.reason,
              bubbles,
              repair: Number(result?.authority?.model_reauthor_passes || 0),
              conversation
            }
            outputs.push(row)
            process.stdout.write(`${JSON.stringify(row)}\n`)
          } catch (error) {
            chainOk = false
            const row = {
              attempt,
              turn,
              ok: false,
              action: transitionPlan.action,
              reason: transitionPlan.reason,
              error: String(error?.message || error)
            }
            outputs.push(row)
            process.stdout.write(`${JSON.stringify(row)}\n`)
            break
          }
        }
        process.stdout.write(`${JSON.stringify({ type: 'chain_result', attempt, ok: chainOk })}\n`)
      }
      process.stdout.write(`${JSON.stringify({
        ok: outputs.every((row) => row.ok === true),
        scenario: scenarioName,
        attempt_count: attempts,
        failure_count: outputs.filter((row) => row.ok !== true).length
      })}\n`)
      return
    }

    if (scenarioName === 'runner_form_stress') {
      const authority = require(path.join(sourceRoot, 'dm-authority.js'))
      const { deriveClosedTransitionPlan } = require(path.join(sourceRoot, 'scv-closed-transition-contract.js'))
      const history = [
        { role: 'user', text: 'Hi can I please get more information?' },
        { role: 'assistant', text: 'Hii yes 🤍 I only open a few model spots at a time' },
        { role: 'assistant', text: 'A model spot is a tattoo designed around what you want while the finished piece stays in my own visual language' },
        { role: 'assistant', text: 'My profile and highlights can be inspo rather than a strict copy or you can bring a custom idea' },
        { role: 'assistant', text: 'What subject or vibe are you thinking?' },
        { role: 'user', text: 'I am thinking of a black and grey heron with water around it. How much is it by the way?' },
        { role: 'assistant', text: 'That heron and water direction would work beautifully as a custom piece rather than an exact copy' },
        { role: 'assistant', text: 'The model rate is $150 an hour as long as the finished piece stays in my visual language' },
        { role: 'assistant', text: 'Want me to send you the application form?' }
      ]
      const attempts = Math.max(1, Math.min(12, Number(process.env.SCV_E2E_ATTEMPTS) || 6))
      for (let index = 0; index < attempts; index += 1) {
        const message = {
          source: 'scv-isolated-live-control-e2e',
          thread_id: `${threadId}-${index + 1}`,
          contact_id: `${threadId}-${index + 1}`,
          instagram_username: 'isolated_live_control_e2e',
          message_id: `${threadId}-${index + 1}-consent`,
          text: 'YES PLEASE',
          message: 'YES PLEASE',
          received_at: new Date(startedAt + index * 60_000).toISOString()
        }
        const structuredState = {
          form_offer_asked: true,
          form_link_sent: false,
          known_reference_media_received: true,
          known_design_context: 'black and grey heron with water around it',
          booking_stage_hint: 'awaiting_form_permission_answer',
          live_turn_text: 'YES PLEASE',
          live_turn_reply_required: true
        }
        const transitionPlan = deriveClosedTransitionPlan({
          ...message,
          recent_history: history,
          structured_state: structuredState
        })
        try {
          const result = authority.generatePacketFromCodexAuthority(message, {
            recent_history_override: history,
            structured_state_override: structuredState,
            control_transition_contract: transitionPlan
          })
          const row = {
            attempt: index + 1,
            ok: true,
            action: transitionPlan.action,
            reason: transitionPlan.reason,
            bubbles: visibleBubbles(result),
            repair: Number(result?.authority?.model_reauthor_passes || 0)
          }
          outputs.push(row)
          process.stdout.write(`${JSON.stringify(row)}\n`)
        } catch (error) {
          const row = {
            attempt: index + 1,
            ok: false,
            action: transitionPlan.action,
            reason: transitionPlan.reason,
            error: String(error?.message || error)
          }
          outputs.push(row)
          process.stdout.write(`${JSON.stringify(row)}\n`)
        }
      }
      process.stdout.write(`${JSON.stringify({
        ok: outputs.every((row) => row.ok === true),
        scenario: scenarioName,
        attempt_count: outputs.length,
        failure_count: outputs.filter((row) => row.ok !== true).length
      })}\n`)
      return
    }

    const control = require(path.join(sourceRoot, 'scv-single-control-plane.js'))
    for (const [index, text] of scenarios[scenarioName].entries()) {
      const turn = index + 1
      const messageId = `${threadId}-${turn}`
      const receivedAt = new Date(startedAt + index * 60_000).toISOString()
      if (scenarioName === 'date_continuation' && turn === 6) {
        const priorState = control.readControlState(root, threadId)
        const historyFile = path.join(root, 'thread-history', `${threadId}.json`)
        const priorHistory = JSON.parse(fs.readFileSync(historyFile, 'utf8'))
        const { extractContextualBookingDayReply } = require(path.join(sourceRoot, 'dm-authority.js'))
        const contextualDay = extractContextualBookingDayReply(text, priorState, priorHistory.events)
        process.stdout.write(`${JSON.stringify({
          type: 'date_continuation_pre_route',
          last_control_message_id: String(priorState?.last_control_message_id || ''),
          prior_user_message_ids: priorHistory.events
            .filter((event) => String(event?.role || '') === 'user')
            .map((event) => String(event?.message_id || '')),
          prior_assistant_packet: Array.isArray(priorState?.last_control_decision?.packet?.bubbles)
            ? priorState.last_control_decision.packet.bubbles.map((bubble) => String(bubble?.text || ''))
            : [],
          contextual_day: contextualDay
        })}\n`)
      }
      const ingress = {
        source: 'scv-isolated-live-control-e2e',
        thread_id: threadId,
        contact_id: threadId,
        instagram_username: 'isolated_live_control_e2e',
        message_id: messageId,
        text,
        message: text,
        received_at: receivedAt,
        source_interaction_at: receivedAt
      }
      control.recordIngressEvent(root, ingress, { authentication_source: 'isolated_live_control_e2e' })
      process.stdout.write(`${JSON.stringify({ type: 'turn_start', turn, input: text })}\n`)
      let result
      try {
        result = await control.executeSingleControlTurn(ingress, { root })
      } catch (error) {
        process.stdout.write(`${JSON.stringify({
          type: 'turn_failure',
          turn,
          input: text,
          code: String(error?.code || ''),
          message: String(error?.message || error),
          control_retry_context: error?.control_retry_context || null
        })}\n`)
        throw error
      }
      const bubbles = visibleBubbles(result)
      for (const [bubbleIndex, bubbleText] of bubbles.entries()) {
        control.appendControlHistoryEvent(root, {
          thread_id: threadId,
          contact_id: threadId,
          message_id: messageId,
          bubble_index: bubbleIndex,
          bubble: { text: bubbleText }
        }, 'assistant', {
          delivery_confirmed: true,
          delivery_status: 'success_visible',
          at: new Date(startedAt + index * 60_000 + 1_000 + bubbleIndex).toISOString()
        })
      }
      const row = {
        turn,
        input: text,
        action: String(result?.authority?.closed_transition_action || ''),
        reason: String(result?.authority?.closed_transition_reason || ''),
        bubbles,
        repair: Number(result?.authority?.control_verifier_rejection_count || 0),
        model: String(result?.authority?.candidate_authority?.model || ''),
        conversation: result?.authority?.candidate_authority?.openai_conversation || null,
        booking_state: process.env.SCV_E2E_DEBUG_BOOKING_STATE === '1'
          ? {
              known_requested_date: String(result?.structured_state?.known_requested_date || ''),
              known_requested_time: String(result?.structured_state?.known_requested_time || ''),
              last_offered_date: String(result?.structured_state?.last_offered_date || ''),
              last_offered_time: String(result?.structured_state?.last_offered_time || ''),
              accepted_offered_date: String(result?.structured_state?.accepted_offered_date || ''),
              accepted_offered_time: String(result?.structured_state?.accepted_offered_time || '')
            }
          : undefined
      }
      outputs.push(row)
      process.stdout.write(`${JSON.stringify(row)}\n`)
    }
    if (scenarioName === 'deposit') {
      const monthNumber = Object.freeze({
        january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
        july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
      })
      const visibleDates = (value) => {
        const text = String(value || '')
        const found = []
        for (const match of text.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/gi)) {
          found.push({ index: match.index, month: monthNumber[match[1].toLowerCase()], day: Number(match[2]) })
        }
        for (const match of text.matchAll(/\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\s+of\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi)) {
          found.push({ index: match.index, month: monthNumber[match[2].toLowerCase()], day: Number(match[1]) })
        }
        return found.sort((left, right) => left.index - right.index)
      }
      const availabilityTurn = outputs.find((row) => row.turn === 4)
      const doubleCheckTurn = outputs.find((row) => row.turn === 6)
      const availabilityDates = visibleDates((availabilityTurn?.bubbles || []).join('\n'))
      const doubleCheckDates = visibleDates((doubleCheckTurn?.bubbles || []).join('\n'))
      // The minimum booking date moves with the injected clock. Bind the test
      // to the actual grounded replacement visible in turn 4 instead of a
      // hard-coded August 31 that becomes stale after midnight.
      const offeredReplacement = availabilityDates[availabilityDates.length - 1] || null
      const doubleCheckedDate = doubleCheckDates[doubleCheckDates.length - 1] || null
      const acceptedReplacementVisible = Boolean(
        offeredReplacement &&
        !(offeredReplacement.month === 8 && offeredReplacement.day === 30)
      )
      const doubleCheckUsesAcceptedReplacement = Boolean(
        offeredReplacement && doubleCheckedDate &&
        offeredReplacement.month === doubleCheckedDate.month &&
        offeredReplacement.day === doubleCheckedDate.day
      )
      const doubleCheckRevertedToRejectedRequest = outputs.some((row) =>
        row.turn === 6 && row.bubbles.some((text) => /Appointment date\s*:\s*30th of August\b/i.test(text))
      )
      if (!acceptedReplacementVisible || !doubleCheckUsesAcceptedReplacement || doubleCheckRevertedToRejectedRequest) {
        throw new Error(`deposit_date_continuity_failed:${JSON.stringify({
          acceptedReplacementVisible,
          doubleCheckUsesAcceptedReplacement,
          doubleCheckRevertedToRejectedRequest
        })}`)
      }
    }
    if (scenarioName === 'explicit_date') {
      const dateTurn = outputs.find((row) => row.turn === 5)
      const visible = Array.isArray(dateTurn?.bubbles) ? dateTurn.bubbles.join('\n') : ''
      const stayedOnAvailabilityRoute = dateTurn?.action === 'post_form_availability'
      const answeredDate = /\b26(?:th)?\b/i.test(visible)
      const offeredGroundedAlternative = /\b(?:august\s+3[01]|september\s+[1-9])\b/i.test(visible)
      const driftedToReferentClarification = /what do you mean|which one|send (?:it|that|the .*) again|actual (?:photo|screenshot)/i.test(visible)
      if (!stayedOnAvailabilityRoute || !answeredDate || !offeredGroundedAlternative || driftedToReferentClarification) {
        throw new Error(`explicit_date_continuity_failed:${JSON.stringify({
          stayedOnAvailabilityRoute,
          answeredDate,
          offeredGroundedAlternative,
          driftedToReferentClarification,
          dateTurn
        })}`)
      }
    }
    if (scenarioName === 'date_continuation') {
      const counterproposalTurn = outputs.find((row) => row.turn === 6)
      const visible = Array.isArray(counterproposalTurn?.bubbles) ? counterproposalTurn.bubbles.join('\n') : ''
      const stayedOnAvailabilityRoute = counterproposalTurn?.action === 'post_form_availability'
      const classifiedOutsideWindow = counterproposalTurn?.reason === 'submitted_form_date_counterproposal_outside_window'
      const answeredCounterproposal = /\b(?:august\s+28|(?:the\s+)?28th|28(?:\s+of)?\s+august)\b/i.test(visible)
      const offeredGroundedAlternative = /\b(?:august\s+3[01]|september\s+[1-9])\b/i.test(visible)
      const driftedToReferentClarification = /what do you mean|which one|send (?:it|that|the .*) again|actual (?:photo|screenshot)/i.test(visible)
      if (!stayedOnAvailabilityRoute || !classifiedOutsideWindow || !answeredCounterproposal || !offeredGroundedAlternative || driftedToReferentClarification) {
        throw new Error(`date_continuation_failed:${JSON.stringify({
          stayedOnAvailabilityRoute,
          classifiedOutsideWindow,
          answeredCounterproposal,
          offeredGroundedAlternative,
          driftedToReferentClarification,
          counterproposalTurn
        })}`)
      }
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      scenario: scenarioName,
      turn_count: outputs.length,
      form_link_visible: outputs.some((row) => row.bubbles.some((text) => text.includes('https://www.effacermonexistence.com/apply'))),
      post_submit_availability_visible: scenarioName !== 'submit' || outputs.some((row) =>
        row.input === 'I just submit' && row.bubbles.some((text) => /\b(day|date|dates|availability|available|schedule)\b/i.test(text))
      ),
      deposit_handoff_visible: outputs.some((row) => row.bubbles.some((text) => /contact@omarprotocol\.com|\bdeposit\b/i.test(text)))
    })}\n`)
  } finally {
    if (previousRoot === undefined) delete process.env.SCV_ROOT
    else process.env.SCV_ROOT = previousRoot
    const resolved = path.resolve(root)
    const expectedPrefix = `${path.resolve(os.tmpdir())}${path.sep}scv-live-control-e2e-`
    if (!resolved.startsWith(expectedPrefix)) throw new Error(`unsafe_cleanup_path:${resolved}`)
    fs.rmSync(resolved, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || String(error)}\n`)
  process.exitCode = 1
})
