#!/usr/bin/env node
// Generated adversarial matrix for the post-form date/time authority boundary.
// A preferred assistant time is an offer, never client truth. The current
// client's explicit clock time wins even when a stale/model intent label says
// the prior offer was accepted.
const path = require('path')
const {
  buildDeterministicBookingPacket,
  resolveBookingFunnelStage
} = require(path.join(__dirname, 'codex-dm-runner.js'))
const {
  reduceConversationState
} = require(path.join(__dirname, 'scv-single-control-plane.js'))

const SCV_TIME_AUTHORITY_FUZZ_LOCK_VERSION =
  'scv-time-authority-fuzz-lock-2026-07-15-v1'

function assert(condition, label, detail = '') {
  if (!condition) throw new Error(`${label}${detail ? `:${detail}` : ''}`)
}

function packetText(result) {
  return (result?.packet?.bubbles || []).map((bubble) => String(bubble?.text || '')).join('\n')
}

function runScvTimeAuthorityFuzzHarness() {
  const months = ['August', 'September', 'October', 'November']
  const dateOpeners = ['how about', 'i can do', 'would', 'lets use', 'i am free']
  const explicitTimes = ['1pm', '3pm', '4pm', '5pm', '2pm']
  let checked = 0
  let dateOnlyCases = 0
  let explicitTimeCases = 0
  let syntheticTimeAuthorityLeaks = 0
  let staleOfferWins = 0

  for (let i = 0; i < 400; i += 1) {
    const month = months[Math.floor(i / 28) % months.length]
    const day = (i % 28) + 1
    const date = `${month} ${day}`
    const message = `${dateOpeners[i % dateOpeners.length]} ${date}`
    const input = {
      contact_id: `date-only-${i}`,
      thread_id: `date-only-${i}`,
      instagram_username: 'omar.system',
      message,
      received_at: '2026-07-15T05:29:27.885Z',
      recent_history: [{ role: 'assistant', text: 'what date works best for you?' }],
      structured_state: {
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Replay Date',
        known_phone_used_on_form: `415555${String(i).padStart(4, '0')}`,
        known_requested_date: date,
        preferred_time_primary: '2pm',
        live_turn_date_phrase: date,
        live_turn_date_status: 'legal',
        booking_stage_hint: 'awaiting_time'
      }
    }
    const result = buildDeterministicBookingPacket(input)
    const stage = resolveBookingFunnelStage(input)
    const text = packetText(result)
    const leaked = /Name\s*:/i.test(text) || /Phone Number\s*:/i.test(text) || /\nTime\s*:/i.test(text)
    if (leaked) syntheticTimeAuthorityLeaks += 1
    assert(stage.stage === 'time_after_form', 'date_only_wrong_semantic_route', `${i}:${JSON.stringify(stage)}`)
    assert(result === null, 'date_only_visible_offer_must_be_model_authored', `${i}:${text}`)
    assert(!leaked, 'date_only_synthesized_time_authority', `${i}:${text}`)
    checked += 1
    dateOnlyCases += 1
  }

  for (let i = 0; i < 100; i += 1) {
    const currentTime = explicitTimes[i % explicitTimes.length]
    const threadId = `explicit-time-${i}`
    const date = `${months[i % months.length]} ${(i % 28) + 1}`
    const persisted = {
      contact_id: threadId,
      thread_id: threadId,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Replay Client',
      known_phone_used_on_form: `628555${String(i).padStart(4, '0')}`,
      known_requested_date: date,
      last_offered_date: date,
      last_offered_time: '2pm'
    }
    const state = reduceConversationState({
      root: __dirname,
      persisted,
      candidate: {
        ...persisted,
        // Hostile stale candidate: the executed controller must re-read the
        // current user turn rather than trusting this proposed value.
        known_requested_time: '2pm',
        live_turn_accepts_offered_slot: true,
        live_turn_time_phrase: currentTime
      },
      event: {
        contact_id: threadId,
        thread_id: threadId,
        message_id: `explicit-time-message-${i}`,
        text: `${currentTime} works for me`
      },
      intentEvidence: { live_turn_accepts_offered_slot: true }
    })
    const result = buildDeterministicBookingPacket({
      ...persisted,
      message: `${currentTime} works for me`,
      received_at: '2026-07-15T05:29:27.885Z',
      recent_history: [{ role: 'assistant', text: `${date} works on my side. would 2pm work for you?` }],
      structured_state: state
    })
    const text = packetText(result)
    const wrongOldOffer = currentTime !== '2pm' && /Time\s*:\s*2pm\b/i.test(text)
    if (wrongOldOffer) staleOfferWins += 1
    assert(/double_check/.test(String(result?.authority?.route_lock || '')), 'explicit_time_missing_double_check', `${i}:${text}`)
    assert(new RegExp(`Time\\s*:\\s*${currentTime}\\b`, 'i').test(text), 'current_time_not_adopted', `${i}:${text}`)
    assert(!wrongOldOffer, 'stale_offer_overrode_current_time', `${i}:${text}`)
    checked += 1
    explicitTimeCases += 1
  }

  return {
    ok: true,
    locked: true,
    lock_version: SCV_TIME_AUTHORITY_FUZZ_LOCK_VERSION,
    checked,
    date_only_cases: dateOnlyCases,
    explicit_time_cases: explicitTimeCases,
    synthetic_time_authority_leaks: syntheticTimeAuthorityLeaks,
    stale_offer_wins: staleOfferWins
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvTimeAuthorityFuzzHarness(), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  SCV_TIME_AUTHORITY_FUZZ_LOCK_VERSION,
  runScvTimeAuthorityFuzzHarness
}
