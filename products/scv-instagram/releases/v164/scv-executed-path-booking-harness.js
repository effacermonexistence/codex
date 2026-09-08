#!/usr/bin/env node
// ============================================================
// SCV EXECUTED-PATH BOOKING HARNESS
// ------------------------------------------------------------
// Independent production-path lock for the "How about 26?" family and the
// no-silent-loss contract. Unlike helper-level harnesses, every scenario here
// drives the production SEMANTIC SEAM — executeSingleControlTurn(msg,{root}) — the
// exact per-turn function inbox-worker.processLockedFile() invokes in live
// processing. The ONLY side effect replaced is the LLM candidate, injected at the
// real `candidateGenerator` adapter of executeSingleControlTurn (the same seam the
// runner default `generatePacketFromCodexAuthority` occupies in production). The
// deterministic detectors (extractContextualBookingDayReply / month reply / media
// authority) are the REAL exported dm-authority functions — never re-faked — and
// the inbox-worker failure DISPOSITION (classifyInboxFailureDisposition) is the
// real exported classifier.
//
// Scope boundary: this harness does NOT itself run processLockedFile's file
// locking, the post3101 transport, outbox-worker, or the ManyChat sendContent
// call — those remain part of the live Instagram receipt boundary (see note).
//
// This harness IS registered in the immutable golden manifest + drift seal (via
// the canonical self-referential reseal) and wired into `npm test`, so a future
// regression that reintroduces silence / neat-number / repeated-form-ack fails
// here. It asserts the sealed closed_contract policies (see
// SCV_GOLDEN_SNAPSHOT_MANIFEST.json -> closed_contract.*) at the live seam.
//
// Proof mode: LOCAL EXECUTED-PATH HARNESS PROOF. Not a visible Instagram receipt.
// ============================================================
const fs = require('fs')
const os = require('os')
const path = require('path')

// Isolate ALL disk state under one temp root BEFORE requiring the SCV modules.
// dm-authority captures its thread-history dir from process.env.SCV_ROOT at load
// time, so this makes its runner-side history loader read our fixtures and never
// the live tree. No live/production file is touched by this harness.
const HARNESS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-exec-path-'))
process.env.SCV_ROOT = HARNESS_ROOT

const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_CONTROL_EPOCH,
  executeSingleControlTurn,
  ensureControlDirs,
  recordIngressEvent,
  appendControlHistoryEvent,
  readControlState,
  mediaContextAuthorityRank,
  selectAuthoritativeMediaText,
  statePath,
  historyPath
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  extractContextualBookingDayReply,
  extractContextualBookingMonthReply,
  assistantPacketOpensDateAvailability,
  loadRecentThreadHistory,
  resolveMonotonicInboundMediaContext
} = require(path.join(__dirname, 'dm-authority.js'))
const {
  classifyInboxFailureDisposition,
  isPersistentInternalControlError
} = require(path.join(__dirname, 'inbox-worker.js'))

const AVAIL_ASK = 'what dates or weekend days are easiest for you?'
const FORM_ACK = 'perfect i got the form'

// A valid single-control candidate envelope. Mirrors the shape the live runner
// (dm-authority.generatePacketFromCodexAuthority) returns; only the visible
// wording is controlled per scenario.
function mkCandidate(opts, over = {}) {
  const c = {
    source: 'codex_exec_dm_authority',
    authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
    raw_text: over.raw_text || 'model authored reply',
    packet: { bubbles: over.bubbles || [{ text: over.text || '' }] },
    structured_state: { ...(opts && opts.structured_state_override), ...(over.structured_state || {}) },
    intent_adoption_state: over.intent_adoption_state || {},
    recent_history: over.recent_history || []
  }
  if (over.media_context_resolved !== undefined) c.media_context_resolved = over.media_context_resolved
  if (over.authority_observed_live_turn_text !== undefined) c.authority_observed_live_turn_text = over.authority_observed_live_turn_text
  return c
}

// executeSingleControlTurn ends at the committed-decision boundary. Production
// publishes each accepted bubble into the conversation ledger only after the
// transport confirms it; this harness intentionally replaces the transport, so
// explicitly publish the same visible-history boundary between sequential turns.
// Without this seam, an already-answered direct question remains falsely pending
// and contaminates the next turn's obligations.
function publishDeliveredResult(root, inbound, result) {
  const bubbles = Array.isArray(result?.packet?.bubbles) ? result.packet.bubbles : []
  bubbles.forEach((bubble, bubbleIndex) => {
    appendControlHistoryEvent(root, {
      contact_id: String(inbound?.contact_id || inbound?.thread_id || ''),
      thread_id: String(inbound?.thread_id || inbound?.contact_id || ''),
      instagram_username: String(inbound?.instagram_username || ''),
      message_id: String(inbound?.message_id || ''),
      bubble_index: bubbleIndex,
      bubble
    }, 'assistant', {
      delivery_status: 'harness_visible',
      delivery_confirmed: true,
      proof_mode: 'local_executed_path_harness_proof'
    })
  })
}

function appendVisibleAssistantText(root, threadId, messageId, text) {
  appendControlHistoryEvent(root, {
    contact_id: threadId,
    thread_id: threadId,
    instagram_username: 'omar.system',
    message_id: messageId,
    bubble_index: 0,
    bubble: { text }
  }, 'assistant', {
    delivery_status: 'harness_visible',
    delivery_confirmed: true,
    proof_mode: 'local_executed_path_harness_proof'
  })
}

function seedState(root, threadId, state) {
  fs.writeFileSync(
    path.join(root, 'thread-state', `${threadId}.json`),
    JSON.stringify({ contact_id: threadId, thread_id: threadId, ...state }, null, 2) + '\n'
  )
}

function bubbleText(result) {
  const bubbles = result && result.packet && Array.isArray(result.packet.bubbles) ? result.packet.bubbles : []
  return bubbles.map((b) => String((b && b.text) || '')).join(' ‖ ')
}

function canonicalClockForHarness(value) {
  const match = String(value || '').match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.?|p\.m\.?|am|pm)(?![a-z0-9_])/i)
  return match
    ? `${Number(match[1])}:${match[2] || '00'}${String(match[3]).toLowerCase().replace(/\./g, '')}`
    : ''
}

// Exact transactional formats the contract harness requires (business facts stay
// exact; only these two are verbatim, everything else is model-authored variation).
function doubleCheckText(who) {
  return `Name: ${who.name}\nPhone number: ${who.phone}\nAppointment date: ${who.date}\nTime: ${who.time}\ndoes that all look right?`
}
const DEPOSIT_TEXT = 'a $100 deposit locks in your appointment — send it via Zelle to contact@omarprotocol.com, then let me know once it is sent.'
const FORM_LINK = 'https://www.effacermonexistence.com/apply'

function runScvExecutedPathBookingHarness() {
  const root = HARNESS_ROOT
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) })
  }

  try {
    ensureControlDirs(root)

    // ========================================================
    // SCENARIO 1 — form-submitted + prior availability + "How about 26?"
    // Must route to month clarification (day anchored, ask which month).
    // A generic repeated form-ack candidate must be REJECTED, then a
    // materially changed clarifying candidate ADOPTED. No silence, no
    // "neat number", no repeated "what days are easiest" receipt replay.
    // (sealed: month_clarification_continuity_policy, post_form_semantic_antirepeat_policy)
    // ========================================================
    {
      const threadId = 's1-monthless'
      seedState(root, threadId, {
        tattoo_intent_active: true, known_design_context: 'black and gray reference',
        form_offer_asked: true, form_link_sent: true, form_submitted: true,
        booking_stage_hint: 'awaiting_date'
      })
      const inbound = {
        contact_id: threadId, thread_id: threadId, instagram_username: 'omar.system',
        message_id: 's1-msg', text: 'How about 26?', received_at: '2026-07-23T20:00:00.000Z'
      }
      const history = [
        { role: 'assistant', message_id: 'a1', text: FORM_ACK },
        { role: 'assistant', message_id: 'a2', text: AVAIL_ASK }
      ]
      recordIngressEvent(root, inbound)

      // REAL detector must classify "How about 26?" as a monthless day reply here.
      const det = extractContextualBookingDayReply(inbound.text, { form_submitted: true, booking_stage_hint: 'awaiting_date' }, history)
      check('s1_real_detector_binds_day_26_needs_month',
        !!det && det.day === 26 && det.month_anchor === '',
        det)

      const monthlessFlags = {
        form_submitted: true, form_link_sent: true, form_offer_asked: true,
        live_turn_contextual_booking_reply: true,
        live_turn_monthless_day_candidate: String(det ? det.day : 26),
        live_turn_date_needs_month: true
      }
      let calls = 0
      const observed = []
      const result = executeSingleControlTurn(inbound, {
        root,
        authority_options: { recent_history_override: history, structured_state_override: monthlessFlags },
        candidateGenerator: (_m, opts) => {
          calls += 1
          observed.push({
            action: String(opts && opts.control_transition_contract && opts.control_transition_contract.action || ''),
            reason: String(opts && opts.control_transition_contract && opts.control_transition_contract.reason || '')
          })
          if (calls === 1) {
            // The exact historical bad reply: repeated form receipt + generic availability replay.
            return mkCandidate(opts, { text: 'perfect i got the form. what days or weekend days are easiest for you?' })
          }
          // Materially changed, state-grounded forward move that anchors the day.
          // The immediately preceding availability question owns the numeric
          // dimension, so only the missing month is requested.
          return mkCandidate(opts, { text: 'which month were you thinking for the 26th?' })
        }
      })
      // The FIRST route recognizes 26 as a contextual booking day (anti "neat number"),
      // then a rejected generic ack is re-authored on the same frozen date route.
      check('s1_first_route_recognizes_contextual_booking_day_not_smalltalk',
        observed[0] && observed[0].action === 'post_form_availability' &&
        observed[0].reason === 'submitted_form_monthless_day_requires_month_clarification',
        observed)
      check('s1_generic_form_ack_rejected_then_reauthored',
        calls === 2 &&
        result.authority.control_candidate_passes === 2 &&
        result.authority.control_route_rebased === false &&
        observed[1] && observed[1].action === 'post_form_availability' &&
        observed[1].reason === 'submitted_form_monthless_day_requires_month_clarification',
        { calls, authority: result.authority })
      check('s1_adopted_reply_anchors_day_26_and_moves_forward',
        /\b26(?:th)?\b/.test(bubbleText(result)) &&
        /month/i.test(bubbleText(result)) &&
        !/size|inch/i.test(bubbleText(result)),
        bubbleText(result))
      check('s1_no_neat_number_and_no_repeated_form_ack',
        !/neat number/i.test(bubbleText(result)) && !/i got the form/i.test(bubbleText(result)),
        bubbleText(result))
      check('s1_ambiguous_value_not_silently_committed_as_date_or_size',
        !String(result.structured_state.known_requested_date || '').trim() &&
        !String(result.structured_state.known_size_context || '').trim(),
        { date: result.structured_state.known_requested_date, size: result.structured_state.known_size_context })
    }

    // ========================================================
    // SCENARIO 1B — exact live Omar.system failure:
    // user: "27 of August?" -> assistant rejects and offers September 1
    // user: "Can we do 28?"
    //
    // ManyChat accepted the prior packet but did not return a provider message
    // id, so history still carries assistant_attempted rows without a visible
    // boundary marker. The receipt-bound last control decision must recover the
    // exact prior packet, the prior rejected client month must bind 28 to
    // August, and the controller must classify August 28 as too_soon before the
    // first route freezes. A bad acceptance candidate is rejected; a fresh
    // grounded replacement is adopted instead of silence.
    // ========================================================
    {
      const threadId = 's1b-rejected-date-continuation'
      const priorMessageId = 's1b-august-27'
      const priorPacket = {
        // Exact second live wording found by the deployed OpenAI E2E. The
        // Unicode apostrophe must not make calendar continuity depend on a
        // brittle ASCII phrase match.
        reply_text: 'I can’t do August 27 unfortunately\nThe earliest opening is September 1 at 2pm\nWould that work for you?',
        bubbles: [
          { text: 'I can’t do August 27 unfortunately', delay_ms: 0 },
          { text: 'The earliest opening is September 1 at 2pm\nWould that work for you?', delay_ms: 700 }
        ]
      }
      seedState(root, threadId, {
        tattoo_intent_active: true,
        known_design_context: 'black and gray reference',
        form_offer_asked: true,
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Kodak Soul Six',
        known_phone_used_on_form: '1231231233',
        last_offered_date: 'September 1',
        last_offered_time: '2pm',
        last_rejected_client_date: 'August 27',
        last_rejected_client_date_message_id: priorMessageId,
        booking_stage_hint: 'awaiting_date',
        current_message_date_local: 'Tuesday, August 25, 2026',
        minimum_booking_date_local: '2026-09-01',
        control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
        control_epoch: SCV_CONTROL_EPOCH,
        control_revision: 5,
        ingress_revision: 6,
        control_event_revision: 6,
        latest_ingress_message_id: priorMessageId,
        latest_ingress_at: '2026-08-25T07:11:15.000Z',
        last_control_message_id: priorMessageId,
        last_control_decision: {
          source: 'scv_single_control_plane',
          message_id: priorMessageId,
          packet: priorPacket
        }
      })
      const history = [
        { role: 'user', message_id: priorMessageId, text: 'Can we do 27 of August?', at: '2026-08-25T07:11:15.000Z' },
        {
          role: 'assistant_attempted', message_id: priorMessageId, bubble_index: 0,
          text: priorPacket.bubbles[0].text, at: '2026-08-25T07:11:29.810Z',
          delivery_status: 'manychat_accepted_unverified'
        },
        {
          role: 'assistant_attempted', message_id: priorMessageId, bubble_index: 1,
          text: priorPacket.bubbles[1].text, at: '2026-08-25T07:11:30.868Z',
          delivery_status: 'manychat_accepted_unverified'
        }
      ]
      const detectorState = {
        form_submitted: true,
        booking_stage_hint: 'awaiting_date',
        last_rejected_client_date: 'August 27',
        last_rejected_client_date_message_id: priorMessageId,
        last_control_message_id: priorMessageId,
        last_control_decision: { message_id: priorMessageId, packet: priorPacket }
      }
      const det = extractContextualBookingDayReply('Can we do 28?', detectorState, history)
      check('s1b_receipt_bound_prior_packet_recovers_august_context',
        !!det && det.day === 28 && det.month_anchor === 'august' &&
        det.month_resolution_source === 'prior_rejected_client_date_continuation',
        det)
      const confirmedHistory = [
        history[0],
        ...priorPacket.bubbles.map((bubble, bubbleIndex) => ({
          role: 'assistant',
          message_id: priorMessageId,
          bubble_index: bubbleIndex,
          text: bubble.text,
          delivery_confirmed: true,
          delivery_status: 'success_visible'
        }))
      ]
      const confirmedDet = extractContextualBookingDayReply('Can we do 28?', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_date',
        last_rejected_client_date: 'August 27',
        last_rejected_client_date_message_id: priorMessageId
      }, confirmedHistory)
      check('s1b_confirmed_visible_packet_recovers_august_without_control_envelope',
        !!confirmedDet && confirmedDet.day === 28 && confirmedDet.month_anchor === 'august' &&
        confirmedDet.month_resolution_source === 'prior_rejected_client_date_continuation',
        confirmedDet)

      const voiceUpgradeHistory = [
        {
          role: 'user', message_id: priorMessageId,
          text: 'sent a voice note that could not be understood'
        },
        {
          role: 'user', message_id: priorMessageId,
          text: 'sent a voice note saying: Can we do August 27?'
        },
        ...priorPacket.bubbles.map((bubble, bubbleIndex) => ({
          role: 'assistant', message_id: priorMessageId, bubble_index: bubbleIndex,
          text: bubble.text, delivery_confirmed: true, delivery_status: 'success_visible'
        }))
      ]
      const voiceUpgradeDet = extractContextualBookingDayReply('Can we do 28?', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_date',
        last_rejected_client_date: 'August 27',
        last_rejected_client_date_message_id: priorMessageId
      }, voiceUpgradeHistory)
      check('s1b_same_id_voice_upgrade_uses_highest_authority_transcript',
        !!voiceUpgradeDet && voiceUpgradeDet.day === 28 && voiceUpgradeDet.month_anchor === 'august' &&
        voiceUpgradeDet.month_resolution_source === 'prior_rejected_client_date_continuation',
        voiceUpgradeDet)

      const implicitRejectionPacket = {
        reply_text: 'Unfortunately I can’t do that one\nThe earliest opening is September 1 at 2pm\nWould that work for you?',
        bubbles: [
          { text: 'Unfortunately I can’t do that one', delay_ms: 0 },
          { text: 'The earliest opening is September 1 at 2pm\nWould that work for you?', delay_ms: 700 }
        ]
      }
      const implicitRejectionHistory = [
        history[0],
        ...implicitRejectionPacket.bubbles.map((bubble, bubbleIndex) => ({
          role: 'assistant',
          message_id: priorMessageId,
          bubble_index: bubbleIndex,
          text: bubble.text,
          delivery_confirmed: true,
          delivery_status: 'success_visible'
        }))
      ]
      const implicitDet = extractContextualBookingDayReply('Can we do 28?', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_date',
        last_offered_date: 'September 1',
        last_rejected_client_date: 'August 27',
        last_rejected_client_date_message_id: priorMessageId
      }, implicitRejectionHistory)
      check('s1b_pronoun_rejection_keeps_prior_client_month_not_alternative_month',
        !!implicitDet && implicitDet.day === 28 && implicitDet.month_anchor === 'august' &&
        implicitDet.month_resolution_source === 'prior_rejected_client_date_continuation',
        implicitDet)

      const implicitNoExactAlternativeHistory = [
        history[0],
        {
          role: 'assistant',
          message_id: priorMessageId,
          bubble_index: 0,
          text: 'Unfortunately I can’t do that one',
          delivery_confirmed: true,
          delivery_status: 'success_visible'
        },
        {
          role: 'assistant',
          message_id: priorMessageId,
          bubble_index: 1,
          text: 'What other date would work for you?',
          delivery_confirmed: true,
          delivery_status: 'success_visible'
        }
      ]
      const implicitNoAlternativeDet = extractContextualBookingDayReply('Could 28 work?', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_date',
        last_rejected_client_date: 'August 27',
        last_rejected_client_date_message_id: priorMessageId
      }, implicitNoExactAlternativeHistory)
      check('s1b_pronoun_rejection_without_exact_alternative_keeps_prior_client_month',
        !!implicitNoAlternativeDet && implicitNoAlternativeDet.day === 28 &&
        implicitNoAlternativeDet.month_anchor === 'august' &&
        implicitNoAlternativeDet.month_resolution_source === 'prior_rejected_client_date_continuation',
        implicitNoAlternativeDet)

      const naturalDayShapes = [
        'Could 28 work?',
        'Is the 28th available?',
        '28 works for me',
        'Let’s do the 28th',
        'Could I book the 28th?',
        '28th please',
        'The 28th is better',
        'Can we do it on 28?',
        'Could we make it 28?',
        'The 28th should work for me'
      ]
      const naturalShapeFailures = naturalDayShapes.map((text) => ({
        text,
        detected: extractContextualBookingDayReply(text, {
          form_submitted: true,
          booking_stage_hint: 'awaiting_date',
          last_offered_date: '2026-09-01',
          last_rejected_client_date: 'August 27',
          last_rejected_client_date_message_id: priorMessageId
        }, implicitRejectionHistory)
      })).filter((row) =>
        !row.detected || row.detected.day !== 28 || row.detected.month_anchor !== 'august' ||
        row.detected.month_resolution_source !== 'prior_rejected_client_date_continuation'
      )
      check('s1b_natural_monthless_counterproposal_shapes_share_same_calendar_authority',
        naturalShapeFailures.length === 0,
        naturalShapeFailures)

      const birthdayHistory = [
        { role: 'user', message_id: 'birthday-context', text: 'My birthday is August 27. What dates are open?' },
        {
          role: 'assistant', message_id: 'birthday-context',
          text: 'September 1 at 2pm is my first opening instead, let me know.',
          delivery_confirmed: true, delivery_status: 'success_visible'
        }
      ]
      const birthdayDet = extractContextualBookingDayReply('Can we do 28?', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_date'
      }, birthdayHistory)
      check('s1b_arbitrary_prior_date_cannot_masquerade_as_rejected_proposal',
        !!birthdayDet && birthdayDet.month_anchor === 'september' &&
        birthdayDet.month_resolution_source === 'immediately_open_assistant_date_slot',
        birthdayDet)

      check('s1b_accepted_counterproposal_wording_opens_next_calendar_turn',
        assistantPacketOpensDateAvailability(
          'August 27 is too soon. I have September 1 at 2pm instead, let me know.'
        ) === true,
        'opener must agree with the accepted out-of-window reply contract')

      const inbound = {
        contact_id: threadId,
        thread_id: threadId,
        instagram_username: 'omar.system',
        message_id: 's1b-august-28',
        text: 'Can we do 28?',
        received_at: '2026-08-25T07:11:50.553Z'
      }
      recordIngressEvent(root, inbound)
      let calls = 0
      const observed = []
      const result = executeSingleControlTurn(inbound, {
        root,
        authority_options: { recent_history_override: history },
        candidateGenerator: (_msg, opts) => {
          calls += 1
          observed.push({
            action: String(opts?.control_transition_contract?.action || ''),
            reason: String(opts?.control_transition_contract?.reason || ''),
            date_status: String(opts?.structured_state_override?.live_turn_date_status || ''),
            date_phrase: String(opts?.structured_state_override?.live_turn_date_phrase || ''),
            resolution_source: String(opts?.structured_state_override?.live_turn_context_resolution_source || ''),
            repair_count: Array.isArray(opts?.control_verifier_rejection_ledger)
              ? opts.control_verifier_rejection_ledger.length
              : 0
          })
          if (calls === 1) {
            return mkCandidate(opts, {
              text: 'August 28 works, I can lock that in for you.'
            })
          }
          return mkCandidate(opts, {
            text: 'August 28 is still a little too soon. Would September 1 at 2pm work instead?'
          })
        }
      })
      check('s1b_first_route_is_resolved_outside_window_not_missing_date',
        observed[0]?.action === 'post_form_availability' &&
        observed[0]?.reason === 'submitted_form_date_counterproposal_outside_window' &&
        observed[0]?.date_status === 'too_soon' &&
        /august\s+28/i.test(observed[0]?.date_phrase || '') &&
        observed[0]?.resolution_source === 'prior_rejected_client_date_continuation',
        observed)
      check('s1b_gate_rejects_bad_acceptance_then_adopts_fresh_grounded_reply',
        calls === 2 &&
        observed[1]?.repair_count >= 1 &&
        result.authority?.control_candidate_passes === 2 &&
        /August 28/i.test(bubbleText(result)) &&
        /September 1/i.test(bubbleText(result)),
        { calls, observed, authority: result.authority, reply: bubbleText(result) })
      check('s1b_illegal_august_28_never_commits_and_visible_reply_is_nonempty',
        !/august\s+28/i.test(String(result.structured_state?.known_requested_date || '')) &&
        result.packet.bubbles.length > 0 &&
        bubbleText(result).trim().length > 0,
        { known_requested_date: result.structured_state?.known_requested_date, reply: bubbleText(result) })
    }

    // ========================================================
    // SCENARIO 1C — a client can revise an already accepted date while the
    // controller is waiting for time. The new day inherits only the accepted
    // date's month, replaces the stale date, and keeps time unresolved.
    // ========================================================
    {
      const threadId = 's1c-accepted-date-reschedule'
      const priorMessageId = 's1c-august-30'
      seedState(root, threadId, {
        tattoo_intent_active: true,
        known_design_context: 'black and gray reference',
        form_offer_asked: true,
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Ivy',
        known_phone_used_on_form: '4155550170',
        known_requested_date: 'August 30',
        known_requested_time: '',
        booking_stage_hint: 'awaiting_time',
        current_message_date_local: 'Thursday, August 20, 2026',
        minimum_booking_date_local: '2026-08-27',
        control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
        control_epoch: SCV_CONTROL_EPOCH,
        control_revision: 2,
        ingress_revision: 3,
        control_event_revision: 3,
        latest_ingress_message_id: priorMessageId,
        latest_ingress_at: '2026-08-20T18:00:00.000Z',
        last_control_message_id: priorMessageId
      })
      const history = [
        { role: 'user', message_id: priorMessageId, text: 'How about August 30?' },
        {
          role: 'assistant', message_id: priorMessageId,
          text: 'Perfect, what time are you thinking?',
          delivery_confirmed: true, delivery_status: 'success_visible'
        }
      ]
      const revision = extractContextualBookingDayReply('Can we do 31 instead?', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_time',
        known_requested_date: 'August 30',
        current_message_date_local: 'August 20, 2026'
      }, history)
      check('s1c_explicit_reschedule_inherits_accepted_date_month',
        !!revision && revision.day === 31 && revision.month_anchor === 'august' &&
        revision.month_resolution_source === 'accepted_date_reschedule_continuation',
        revision)

      const revisionParaphrases = [
        '31st?',
        'The 31st',
        'Can we do it on 31?',
        'Could we make it 31?',
        'The 31st is better',
        'The 31st should work for me',
        'Actually, the 31st',
        '31 works for me',
        'What about 31?',
        'How about 31?',
        'Would the 31st be better?',
        '31 would be better',
        'Can I switch to 31?',
        'Move it to 31 please',
        'Could we go with 31 instead?',
        'How does 31 sound?',
        'Can I get the 31st?',
        'Make that the 31st',
        'Maybe 31 instead?'
      ]
      const revisionMisses = revisionParaphrases.filter((text) => {
        const detected = extractContextualBookingDayReply(text, {
          form_submitted: true,
          booking_stage_hint: 'awaiting_time',
          known_requested_date: 'August 30',
          current_message_date_local: 'August 20, 2026'
        }, history)
        return !detected || detected.day !== 31 || detected.month_anchor !== 'august'
      })
      check('s1c_natural_explicit_reschedule_paraphrases_share_same_authority',
        revisionMisses.length === 0,
        revisionMisses)

      const naturalTimeOpeners = [
        'Got you for August 30. Send me a time.',
        'Cool, morning or afternoon?',
        'What part of the day works?'
      ]
      const timeOpenerMisses = naturalTimeOpeners.map((assistantText) => ({
        assistantText,
        detected: extractContextualBookingDayReply('Can we do 31 instead?', {
          form_submitted: true,
          booking_stage_hint: 'awaiting_time',
          known_requested_date: 'August 30',
          current_message_date_local: 'August 20, 2026'
        }, [{
          role: 'assistant', text: assistantText,
          delivery_confirmed: true, delivery_status: 'success_visible'
        }])
      })).filter((row) => (
        !row.detected ||
        row.detected.day !== 31 ||
        row.detected.month_anchor !== 'august'
      ))
      check('s1c_natural_time_openers_preserve_date_revision_authority',
        timeOpenerMisses.length === 0,
        timeOpenerMisses)

      const ambiguous = extractContextualBookingDayReply('Can we do 3?', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_time',
        known_requested_date: 'August 30',
        current_message_date_local: 'August 20, 2026'
      }, history)
      check('s1c_bare_number_does_not_reopen_known_date', ambiguous === null, ambiguous)

      const clockLikeAmbiguities = [
        'Actually, 2',
        'Actually, 3',
        'Actually 10',
        'Can we do 1 instead?',
        'Can we do 2 instead?',
        'Can we do 3 instead?',
        'Could we make it 3 instead?'
      ]
      const clockLikeLeaks = clockLikeAmbiguities.map((text) => ({
        text,
        detected: extractContextualBookingDayReply(text, {
          form_submitted: true,
          booking_stage_hint: 'awaiting_time',
          known_requested_date: 'August 30',
          current_message_date_local: 'August 20, 2026'
        }, history)
      })).filter((row) => row.detected !== null)
      check('s1c_clock_like_cardinals_never_silently_replace_known_date',
        clockLikeLeaks.length === 0,
        clockLikeLeaks)

      const rollover = extractContextualBookingDayReply('Can we do the 1st instead?', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_time',
        known_requested_date: 'August 30',
        current_message_date_local: 'August 20, 2026'
      }, history)
      check('s1c_same_month_past_day_cannot_silently_roll_to_next_year',
        !!rollover && rollover.day === 1 && rollover.month_anchor === '' &&
        rollover.month_resolution_source === 'accepted_date_reschedule_year_ambiguous',
        rollover)

      const ordinalRollover = extractContextualBookingDayReply('The 3rd instead', {
        form_submitted: true,
        booking_stage_hint: 'awaiting_time',
        known_requested_date: 'August 30',
        current_message_date_local: 'August 20, 2026'
      }, history)
      check('s1c_bare_ordinal_rollover_cannot_silently_inherit_past_month',
        !!ordinalRollover && ordinalRollover.day === 3 && ordinalRollover.month_anchor === '' &&
        ordinalRollover.month_resolution_source === 'accepted_date_reschedule_year_ambiguous',
        ordinalRollover)

      const inbound = {
        contact_id: threadId,
        thread_id: threadId,
        instagram_username: 'omar.system',
        message_id: 's1c-august-31',
        text: 'Can we do 31 instead?',
        received_at: '2026-08-20T18:03:00.000Z'
      }
      recordIngressEvent(root, inbound)
      const observed = []
      const result = executeSingleControlTurn(inbound, {
        root,
        authority_options: { recent_history_override: history },
        candidateGenerator: (_msg, opts) => {
          observed.push({
            action: String(opts?.control_transition_contract?.action || ''),
            reason: String(opts?.control_transition_contract?.reason || ''),
            date: String(opts?.structured_state_override?.known_requested_date || ''),
            time: String(opts?.structured_state_override?.known_requested_time || ''),
            source: String(opts?.structured_state_override?.live_turn_context_resolution_source || '')
          })
          return mkCandidate(opts, { text: 'August 31 works. What time works best for you?' })
        }
      })
      check('s1c_executed_path_replaces_stale_date_before_route_lock',
        observed[0]?.action === 'post_form_time' &&
        observed[0]?.reason === 'submitted_form_missing_time' &&
        /august\s+31/i.test(observed[0]?.date || '') &&
        observed[0]?.time === '' &&
        ['accepted_date_reschedule_continuation', 'direct_live_authority'].includes(observed[0]?.source) &&
        /august\s+31/i.test(String(result.structured_state?.known_requested_date || '')) &&
        String(result.structured_state?.known_requested_time || '') === '',
        { observed, state: result.structured_state, reply: bubbleText(result) })

      publishDeliveredResult(root, inbound, result)
      const ambiguousTimeInbound = {
        contact_id: threadId,
        thread_id: threadId,
        instagram_username: 'omar.system',
        message_id: 's1c-ambiguous-three-instead',
        text: 'Can we do 3 instead?',
        received_at: '2026-08-20T18:04:00.000Z'
      }
      recordIngressEvent(root, ambiguousTimeInbound)
      const ambiguousObserved = []
      const ambiguousResult = executeSingleControlTurn(ambiguousTimeInbound, {
        root,
        candidateGenerator: (_msg, opts) => {
          ambiguousObserved.push({
            action: String(opts?.control_transition_contract?.action || ''),
            date: String(opts?.structured_state_override?.known_requested_date || ''),
            datePhrase: String(opts?.structured_state_override?.live_turn_date_phrase || '')
          })
          return mkCandidate(opts, { text: 'What time did you mean?' })
        }
      })
      check('s1c_executed_clock_like_cardinal_preserves_date_and_time_route',
        ambiguousObserved[0]?.action === 'post_form_time' &&
        /august\s+31/i.test(ambiguousObserved[0]?.date || '') &&
        ambiguousObserved[0]?.datePhrase === '' &&
        /august\s+31/i.test(String(ambiguousResult.structured_state?.known_requested_date || '')),
        { observed: ambiguousObserved, state: ambiguousResult.structured_state, reply: bubbleText(ambiguousResult) })
    }

    // ========================================================
    // SCENARIO 1C2 — the same accepted-date revision is proven through the
    // production controller for bare ordinals and natural time-selection
    // prompts that do not repeat the date. Past-day rollover stays fail-closed
    // and asks for the missing month instead of silently choosing next year.
    // ========================================================
    {
      const executedRevisionCases = [
        ['bare_ordinal_question', 'Perfect, what time are you thinking?', '31st?', false],
        ['bare_ordinal_phrase', 'Perfect, what time are you thinking?', 'The 31st', false],
        ['imperative_time_prompt', 'Got you for August 30. Send me a time.', 'Can we do 31 instead?', false],
        ['time_of_day_choice', 'Cool, morning or afternoon?', 'Can we do 31 instead?', false],
        ['part_of_day_prompt', 'What part of the day works?', 'Can we do 31 instead?', false],
        ['past_day_ordinal_rollover', 'Perfect, what time are you thinking?', 'The 3rd instead', true]
      ]
      const misses = []
      for (const [id, assistantText, clientText, needsMonth] of executedRevisionCases) {
        const threadId = `s1c2-${id}`
        const priorMessageId = `s1c2-prior-${id}`
        seedState(root, threadId, {
          tattoo_intent_active: true,
          known_design_context: 'black and gray reference',
          form_offer_asked: true,
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Ivy',
          known_phone_used_on_form: '4155550170',
          known_requested_date: 'August 30',
          known_requested_time: '',
          booking_stage_hint: 'awaiting_time',
          current_message_date_local: 'Thursday, August 20, 2026',
          minimum_booking_date_local: '2026-08-27',
          control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
          control_epoch: SCV_CONTROL_EPOCH,
          control_revision: 2,
          ingress_revision: 3,
          control_event_revision: 3,
          latest_ingress_message_id: priorMessageId,
          latest_ingress_at: '2026-08-20T18:00:00.000Z',
          last_control_message_id: priorMessageId
        })
        const history = [
          { role: 'user', message_id: priorMessageId, text: 'August 30 works for me' },
          {
            role: 'assistant', message_id: priorMessageId, text: assistantText,
            delivery_confirmed: true, delivery_status: 'success_visible'
          }
        ]
        const inbound = {
          contact_id: threadId,
          thread_id: threadId,
          instagram_username: 'omar.system',
          message_id: `s1c2-live-${id}`,
          text: clientText,
          received_at: '2026-08-20T18:03:00.000Z'
        }
        recordIngressEvent(root, inbound)
        const observed = []
        const result = executeSingleControlTurn(inbound, {
          root,
          authority_options: { recent_history_override: history },
          candidateGenerator: (_msg, opts) => {
            observed.push({
              action: String(opts?.control_transition_contract?.action || ''),
              reason: String(opts?.control_transition_contract?.reason || ''),
              date: String(opts?.structured_state_override?.known_requested_date || ''),
              datePhrase: String(opts?.structured_state_override?.live_turn_date_phrase || ''),
              monthlessDay: String(opts?.structured_state_override?.live_turn_monthless_day_candidate || ''),
              needsMonth: opts?.structured_state_override?.live_turn_date_needs_month === true,
              source: String(opts?.structured_state_override?.live_turn_context_resolution_source || '')
            })
            return mkCandidate(opts, {
              text: needsMonth
                ? 'The 3rd — which month did you mean?'
                : 'August 31 works. What time works best?'
            })
          }
        })
        const passed = needsMonth
          ? (
              observed.length === 1 &&
              observed[0]?.action === 'post_form_availability' &&
              observed[0]?.reason === 'submitted_form_monthless_day_requires_month_clarification' &&
              observed[0]?.monthlessDay === '3' &&
              observed[0]?.needsMonth === true &&
              /august\s+30/i.test(observed[0]?.date || '') &&
              /august\s+30/i.test(String(result.structured_state?.known_requested_date || '')) &&
              !/august\s+3\b/i.test(String(result.structured_state?.known_requested_date || ''))
            )
          : (
              observed.length === 1 &&
              observed[0]?.action === 'post_form_time' &&
              observed[0]?.reason === 'submitted_form_missing_time' &&
              /august\s+31/i.test(observed[0]?.date || '') &&
              observed[0]?.datePhrase && /31/.test(observed[0].datePhrase) &&
              ['accepted_date_reschedule_continuation', 'direct_live_authority'].includes(observed[0]?.source) &&
              /august\s+31/i.test(String(result.structured_state?.known_requested_date || ''))
            )
        if (!passed) {
          misses.push({ id, assistantText, clientText, observed, state: result.structured_state, reply: bubbleText(result) })
        }
      }
      check('s1c2_real_controller_handles_natural_date_revisions_and_rollover_fail_close',
        misses.length === 0,
        misses)
    }

    // ========================================================
    // SCENARIO 1C3 — a clock token becomes appointment time only through a
    // positive scheduling speech act. Incidental events, negation, and range
    // boundaries cannot promote awaiting_time to DOUBLE_CHECK.
    // ========================================================
    {
      const clockCases = [
        ['incidental_flight_time', 'My flight is at 2pm', false],
        ['incidental_natural_flight_time', 'My flight is at 2 in the afternoon', false],
        ['negated_time', 'I cannot do 2pm', false],
        ['exclusive_after_boundary', 'Any time after 2pm works', false],
        ['bare_time_answer', '2pm', true],
        ['dotted_time_answer', '2 p.m. works.', true],
        ['bare_natural_time_answer', '2 in the afternoon', true],
        ['explicit_time_proposal', 'Can we do 2pm?', true],
        ['natural_time_proposal', 'Could you book me at 2 in the afternoon?', true],
        ['time_works_answer', '2pm works for me', true],
        ['natural_time_works_answer', '2 in the afternoon works for me', true]
      ]
      const misses = []
      for (const [id, text, shouldAdopt] of clockCases) {
        const threadId = `s1c3-${id}`
        const priorMessageId = `s1c3-prior-${id}`
        seedState(root, threadId, {
          tattoo_intent_active: true,
          known_design_context: 'black and gray reference',
          form_offer_asked: true,
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Ivy',
          known_phone_used_on_form: '4155550170',
          known_requested_date: 'August 30',
          known_requested_time: '',
          booking_stage_hint: 'awaiting_time',
          control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
          control_epoch: SCV_CONTROL_EPOCH,
          control_revision: 2,
          ingress_revision: 3,
          control_event_revision: 3,
          latest_ingress_message_id: priorMessageId,
          latest_ingress_at: '2026-08-20T18:00:00.000Z',
          last_control_message_id: priorMessageId
        })
        appendVisibleAssistantText(root, threadId, priorMessageId, 'Perfect, what time are you thinking?')
        const inbound = {
          contact_id: threadId,
          thread_id: threadId,
          instagram_username: 'omar.system',
          message_id: `s1c3-live-${id}`,
          text,
          received_at: '2026-08-20T18:03:00.000Z'
        }
        recordIngressEvent(root, inbound)
        const observed = []
        let result
        try {
          result = executeSingleControlTurn(inbound, {
            root,
            candidateGenerator: (_msg, opts) => {
            const action = String(opts?.control_transition_contract?.action || '')
            observed.push({
              action,
              reason: String(opts?.control_transition_contract?.reason || ''),
              time: String(opts?.structured_state_override?.known_requested_time || ''),
              liveTime: String(opts?.structured_state_override?.live_turn_time_phrase || '')
            })
            if (action === 'double_check') {
              return mkCandidate(opts, {
                text: doubleCheckText({
                  name: 'Ivy', phone: '4155550170', date: 'August 30', time: '2pm'
                })
              })
            }
            if (action === 'social_continue') {
              return mkCandidate(opts, { text: 'hope the flight goes smoothly — where are you headed?' })
            }
            return mkCandidate(opts, { text: 'no problem, what appointment time works better for you?' })
            }
          })
        } catch (err) {
          misses.push({ id, text, error: String(err?.message || err), observed })
          continue
        }
        const adoptedTime = String(result.structured_state?.known_requested_time || '')
        const passed = shouldAdopt
          ? (
              observed[0]?.action === 'double_check' &&
              canonicalClockForHarness(observed[0]?.time || '') === '2:00pm' &&
              canonicalClockForHarness(adoptedTime) === '2:00pm' &&
              result.structured_state?.name_phone_date_time_double_check_sent === true
            )
          : (
              observed[0]?.action !== 'double_check' &&
              !String(observed[0]?.time || '').trim() &&
              !String(observed[0]?.liveTime || '').trim() &&
              !adoptedTime &&
              result.structured_state?.name_phone_date_time_double_check_sent !== true
            )
        if (!passed) misses.push({ id, text, observed, state: result.structured_state, reply: bubbleText(result) })
      }
      check('s1c3_real_controller_requires_positive_clock_time_speech_act',
        misses.length === 0,
        misses)
    }

    // ========================================================
    // SCENARIO 1C4 — phone-like text is booking identity only when the current
    // client is positively answering the active form-identity slot. Third-party
    // contacts and an unlabeled trailing name cannot trigger DOUBLE_CHECK.
    // ========================================================
    {
      const identityCases = [
        ['friend_phone', "My friend Alex's phone is 415-555-0199", '', '', false],
        ['relative_phone', 'Call my mom at 415-555-0199', '', '', false],
        ['pronoun_phone', 'Her phone is 415-555-0199.', '', '', false],
        ['open_role_possessive_phone', "My doctor's phone is 415-555-0199.", '', '', false],
        ['proper_name_possessive_phone', "Alex's phone is 415-555-0199.", '', '', false],
        ['directed_reach_phone', 'You can reach Alex at 415-555-0199.', '', '', false],
        ['passive_reach_phone', 'Alex can be reached at 415-555-0199.', '', '', false],
        ['belongs_to_phone', 'The number belongs to Alex: 415-555-0199.', '', '', false],
        ['someone_else_phone', "Someone else's phone is 415-555-0199.", '', '', false],
        ['phone_with_unlabeled_trailing_name', 'My phone on the form is 415-555-0199, Lua Test', '', '4155550199', false],
        ['labeled_identity_payload', 'Name: Lua Test, Phone: 415-555-0199', 'Lua Test', '4155550199', true],
        ['self_anchored_identity_payload', 'My name is Lua Test and my phone is 415-555-0199', 'Lua Test', '4155550199', true],
        ['self_anchored_identity_terminal_period', 'My name is Lua Test and my phone is 415-555-0199.', 'Lua Test', '4155550199', true],
        ['semicolon_labeled_four_field', 'Name: Lua Test; Phone: 415-555-0199; Date: August 30; Time: 2pm', 'Lua Test', '4155550199', true],
        ['unlabeled_four_field', 'Lua Test, 415-555-0199, August 30, 2pm', 'Lua Test', '4155550199', true]
      ]
      const misses = []
      for (const [id, text, expectedName, expectedPhone, shouldDoubleCheck] of identityCases) {
        const threadId = `s1c4-${id}`
        const priorMessageId = `s1c4-prior-${id}`
        seedState(root, threadId, {
          tattoo_intent_active: true,
          known_design_context: 'black and gray reference',
          form_offer_asked: true,
          form_link_sent: true,
          form_submitted: true,
          known_requested_date: 'August 30',
          known_requested_time: '2pm',
          booking_stage_hint: 'awaiting_form_identity_match',
          control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
          control_epoch: SCV_CONTROL_EPOCH,
          control_revision: 2,
          ingress_revision: 3,
          control_event_revision: 3,
          latest_ingress_message_id: priorMessageId,
          latest_ingress_at: '2026-08-20T18:00:00.000Z',
          last_control_message_id: priorMessageId
        })
        appendVisibleAssistantText(root, threadId, priorMessageId, 'What name and phone number did you use on the form?')
        const inbound = {
          contact_id: threadId,
          thread_id: threadId,
          instagram_username: 'omar.system',
          message_id: `s1c4-live-${id}`,
          text,
          received_at: '2026-08-20T18:03:00.000Z'
        }
        recordIngressEvent(root, inbound)
        const observed = []
        let result
        try {
          result = executeSingleControlTurn(inbound, {
            root,
            candidateGenerator: (_msg, opts) => {
            const action = String(opts?.control_transition_contract?.action || '')
            const name = String(opts?.structured_state_override?.known_name_used_on_form || '')
            const phone = String(opts?.structured_state_override?.known_phone_used_on_form || '')
            observed.push({ action, name, phone })
            if (action === 'double_check') {
              return mkCandidate(opts, {
                text: doubleCheckText({ name, phone, date: 'August 30', time: '2pm' })
              })
            }
            if (action === 'social_continue') {
              return mkCandidate(opts, { text: 'got you — is Alex helping with the appointment?' })
            }
            const missing = [!name ? 'name' : '', !phone ? 'phone number' : ''].filter(Boolean).join(' and ')
            return mkCandidate(opts, { text: `what ${missing} did you use on the form?` })
            }
          })
        } catch (err) {
          misses.push({ id, text, error: String(err?.message || err), observed })
          continue
        }
        const durableName = String(result.structured_state?.known_name_used_on_form || '')
        const durablePhone = String(result.structured_state?.known_phone_used_on_form || '')
        const passed = (
          durableName === expectedName &&
          durablePhone === expectedPhone &&
          (shouldDoubleCheck
            ? observed[0]?.action === 'double_check' && result.structured_state?.name_phone_date_time_double_check_sent === true
            : observed[0]?.action !== 'double_check' && result.structured_state?.name_phone_date_time_double_check_sent !== true)
        )
        if (!passed) misses.push({ id, text, observed, state: result.structured_state, reply: bubbleText(result) })
      }

      const phoneOnlyThread = 's1c4-bare-phone-awaiting-phone'
      const phoneOnlyPrior = 's1c4-bare-phone-prior'
      seedState(root, phoneOnlyThread, {
        tattoo_intent_active: true,
        known_design_context: 'black and gray reference',
        form_offer_asked: true,
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Lua Test',
        known_requested_date: 'August 30',
        known_requested_time: '2pm',
        booking_stage_hint: 'awaiting_phone_used_on_form',
        control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
        control_epoch: SCV_CONTROL_EPOCH,
        control_revision: 2,
        ingress_revision: 3,
        control_event_revision: 3,
        latest_ingress_message_id: phoneOnlyPrior,
        latest_ingress_at: '2026-08-20T18:00:00.000Z',
        last_control_message_id: phoneOnlyPrior
      })
      appendVisibleAssistantText(root, phoneOnlyThread, phoneOnlyPrior, 'What phone number did you use on the form?')
      const phoneOnlyInbound = {
        contact_id: phoneOnlyThread,
        thread_id: phoneOnlyThread,
        instagram_username: 'omar.system',
        message_id: 's1c4-bare-phone-live',
        text: '415-555-0199',
        received_at: '2026-08-20T18:03:00.000Z'
      }
      recordIngressEvent(root, phoneOnlyInbound)
      const phoneOnlyObserved = []
      const phoneOnlyResult = executeSingleControlTurn(phoneOnlyInbound, {
        root,
        candidateGenerator: (_msg, opts) => {
          const name = String(opts?.structured_state_override?.known_name_used_on_form || '')
          const phone = String(opts?.structured_state_override?.known_phone_used_on_form || '')
          phoneOnlyObserved.push({
            action: String(opts?.control_transition_contract?.action || ''), name, phone
          })
          return mkCandidate(opts, {
            text: doubleCheckText({ name, phone, date: 'August 30', time: '2pm' })
          })
        }
      })
      if (!(
        phoneOnlyObserved[0]?.action === 'double_check' &&
        phoneOnlyObserved[0]?.name === 'Lua Test' &&
        phoneOnlyObserved[0]?.phone === '4155550199' &&
        String(phoneOnlyResult.structured_state?.known_phone_used_on_form || '') === '4155550199'
      )) {
        misses.push({ id: 'bare_phone_awaiting_phone', observed: phoneOnlyObserved, state: phoneOnlyResult.structured_state })
      }
      check('s1c4_real_controller_requires_active_self_identity_payload',
        misses.length === 0,
        misses)
    }

    // ========================================================
    // SCENARIO 1C5 — rejecting the exact committed appointment date/time
    // clears only that matching slot and reopens its deterministic question.
    // Rejecting another value preserves the booking. Mixed-polarity turns adopt
    // the sole positive clock candidate rather than the first token in the text.
    // ========================================================
    {
      const reversalCases = [
        ['reject_exact_date', 'I can\'t do August 30', 'date', true, 'August 30', '2pm'],
        ['exclude_exact_date_boundary', 'After August 30 would work', 'date', true, 'August 30', '2pm'],
        ['reject_different_date', 'I can\'t do August 29', 'date', false, 'August 30', '2pm'],
        ['reject_exact_time', '2pm no longer works', 'time', true, 'August 30', '2pm'],
        ['exclude_exact_time_boundary', 'Any time after 2pm works', 'time', true, 'August 30', '2pm'],
        ['reject_different_time', '3pm no longer works', 'time', false, 'August 30', '2pm'],
        ['mixed_clock_negative_first', 'I can\'t do 2pm but 3pm works', 'mixed', false, 'August 30', '3pm'],
        ['mixed_clock_negative_last', '3pm works but not 2pm', 'mixed', false, 'August 30', '3pm']
      ]
      const misses = []
      for (const [id, text, kind, shouldClear, expectedDate, expectedTime] of reversalCases) {
        const threadId = `s1c5-${id}`
        const priorMessageId = `s1c5-prior-${id}`
        const priorDoubleCheck = shouldClear || kind === 'mixed'
        seedState(root, threadId, {
          tattoo_intent_active: true,
          known_design_context: 'black and gray reference',
          form_offer_asked: true,
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Ivy',
          known_phone_used_on_form: '4155550170',
          known_requested_date: 'August 30',
          known_requested_time: '2pm',
          double_check_sent: priorDoubleCheck,
          name_phone_date_time_double_check_sent: priorDoubleCheck,
          booking_stage_hint: priorDoubleCheck ? 'awaiting_double_check_confirmation' : 'ready_for_double_check',
          control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
          control_epoch: SCV_CONTROL_EPOCH,
          control_revision: 2,
          ingress_revision: 3,
          control_event_revision: 3,
          latest_ingress_message_id: priorMessageId,
          latest_ingress_at: '2026-08-25T18:00:00.000Z',
          last_control_message_id: priorMessageId
        })
        appendVisibleAssistantText(
          root,
          threadId,
          priorMessageId,
          kind === 'date'
            ? doubleCheckText({ name: 'Ivy', phone: '4155550170', date: 'August 30', time: '2pm' })
            : kind === 'time'
              ? doubleCheckText({ name: 'Ivy', phone: '4155550170', date: 'August 30', time: '2pm' })
              : 'Perfect, what time are you thinking?'
        )
        const inbound = {
          contact_id: threadId,
          thread_id: threadId,
          instagram_username: 'omar.system',
          message_id: `s1c5-live-${id}`,
          text,
          received_at: '2026-08-25T18:03:00.000Z'
        }
        recordIngressEvent(root, inbound)
        const observed = []
        let result
        try {
          result = executeSingleControlTurn(inbound, {
            root,
            candidateGenerator: (_msg, opts) => {
              const action = String(opts?.control_transition_contract?.action || '')
              const date = String(opts?.structured_state_override?.known_requested_date || '')
              const time = String(opts?.structured_state_override?.known_requested_time || '')
              observed.push({ action, date, time })
              if (action === 'post_form_availability') {
                return mkCandidate(opts, { text: 'No problem — what other date works for you?' })
              }
              if (action === 'post_form_time') {
                return mkCandidate(opts, { text: 'No problem — what exact appointment time works instead?' })
              }
              if (action === 'await_double_check_confirmation') {
                return mkCandidate(opts, { text: 'Got you — were you referring to something else?' })
              }
              return mkCandidate(opts, {
                text: doubleCheckText({ name: 'Ivy', phone: '4155550170', date: date || expectedDate, time: time || expectedTime })
              })
            }
          })
        } catch (err) {
          misses.push({ id, text, error: String(err?.message || err), observed })
          continue
        }

        const durableDate = String(result.structured_state?.known_requested_date || '')
        const durableTime = String(result.structured_state?.known_requested_time || '')
        const passed = shouldClear
          ? (
              kind === 'date'
                ? observed[0]?.action === 'post_form_availability' && !durableDate && !durableTime
                : observed[0]?.action === 'post_form_time' && /august\s+30/i.test(durableDate) && !durableTime
            ) &&
            result.structured_state?.double_check_sent !== true &&
            result.structured_state?.name_phone_date_time_double_check_sent !== true &&
            result.structured_state?.deposit_requested !== true
          : (
              observed[0]?.action === (kind === 'mixed' ? 'double_check' : 'await_double_check_confirmation') &&
              /august\s+30/i.test(durableDate) &&
              canonicalClockForHarness(durableTime) === canonicalClockForHarness(expectedTime)
            )
        if (!passed) misses.push({ id, text, observed, state: result.structured_state, reply: bubbleText(result) })
      }
      check('s1c5_exact_slot_reversal_clears_only_matching_value_and_mixed_clock_selects_positive',
        misses.length === 0,
        misses)
    }

    // ========================================================
    // SCENARIO 1C5A — exact live 2026-09-01 regression. After a delivered
    // four-field checkpoint for Sept 8 at 2pm, the client can switch to Sept 7,
    // which was another explicitly paired option in visible history. The old
    // checkpoint is invalidated and a fresh Sept 7 / 2pm checkpoint is emitted.
    // A date that was never offered still reopens only the missing time field.
    // ========================================================
    {
      const dateChangeCases = [
        { id: 'previously_offered', text: 'Can we do September 7?', action: 'double_check', date: 'September 7', time: '2pm' },
        { id: 'never_offered', text: 'Can we do September 9?', action: 'post_form_time', date: 'September 9', time: '' }
      ]
      const misses = []
      for (const row of dateChangeCases) {
        const threadId = `s1c5a-${row.id}`
        const priorMessageId = `s1c5a-double-check-${row.id}`
        seedState(root, threadId, {
          tattoo_intent_active: true,
          known_design_context: 'black and gray reference',
          form_offer_asked: true,
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Omar System',
          known_phone_used_on_form: '4155550170',
          known_requested_date: 'September 8',
          known_requested_time: '2pm',
          last_offered_date: 'sept 8',
          last_offered_time: '2pm',
          accepted_offered_date: 'sept 8',
          accepted_offered_time: '2pm',
          double_check_sent: true,
          name_phone_date_time_double_check_sent: true,
          booking_stage_hint: 'awaiting_double_check_confirmation',
          control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
          control_epoch: SCV_CONTROL_EPOCH,
          control_revision: 6,
          ingress_revision: 7,
          control_event_revision: 7,
          latest_ingress_message_id: priorMessageId,
          latest_ingress_at: '2026-08-31T17:55:00.000Z',
          last_control_message_id: priorMessageId
        })
        appendVisibleAssistantText(
          root,
          threadId,
          `s1c5a-multi-offer-${row.id}`,
          'I can do Sept 7 at 2pm or Sept 8 at 2pm which one works'
        )
        appendVisibleAssistantText(
          root,
          threadId,
          priorMessageId,
          doubleCheckText({ name: 'Omar System', phone: '4155550170', date: 'September 8', time: '2pm' })
        )
        const inbound = {
          contact_id: threadId,
          thread_id: threadId,
          instagram_username: 'omar.system',
          message_id: `s1c5a-live-${row.id}`,
          text: row.text,
          source_interaction_at: '2026-08-31T18:03:00.000Z',
          received_at: '2026-08-31T18:03:00.000Z'
        }
        recordIngressEvent(root, inbound)
        const observed = []
        let result
        try {
          result = executeSingleControlTurn(inbound, {
            root,
            candidateGenerator: (_msg, opts) => {
              const action = String(opts?.control_transition_contract?.action || '')
              const state = opts?.structured_state_override || {}
              const date = String(state.known_requested_date || '')
              const time = String(state.known_requested_time || '')
              observed.push({
                action,
                date,
                time,
                checkpoint_invalidated: state.live_turn_checkpoint_invalidated === true,
                historical_offered_time: String(state.live_turn_historical_offered_time || '')
              })
              if (action === 'double_check') {
                return mkCandidate(opts, {
                  text: doubleCheckText({ name: 'Omar System', phone: '4155550170', date, time })
                })
              }
              return mkCandidate(opts, { text: 'September 9 can work, what appointment time works for you?' })
            }
          })
        } catch (err) {
          misses.push({ id: row.id, error: String(err?.message || err), observed })
          continue
        }
        const durableDate = String(result.structured_state?.known_requested_date || '')
        const durableTime = String(result.structured_state?.known_requested_time || '')
        const basePass = (
          observed.length > 0 &&
          observed.every((entry) => entry.action === row.action) &&
          observed.every((entry) => entry.checkpoint_invalidated === true) &&
          new RegExp(`\\b${row.date.replace(/\\s+/g, '\\s+')}\\b`, 'i').test(durableDate) &&
          canonicalClockForHarness(durableTime) === canonicalClockForHarness(row.time) &&
          result.structured_state?.deposit_requested !== true &&
          bubbleText(result).trim().length > 0
        )
        const routePass = row.action === 'double_check'
          ? (
              observed.every((entry) => canonicalClockForHarness(entry.historical_offered_time) === '2:00pm') &&
              result.structured_state?.double_check_sent === true &&
              result.structured_state?.name_phone_date_time_double_check_sent === true &&
              /appointment date:\s*september 7/i.test(bubbleText(result)) &&
              /time:\s*2pm/i.test(bubbleText(result))
            )
          : (
              observed.every((entry) => !entry.historical_offered_time) &&
              result.structured_state?.double_check_sent !== true &&
              result.structured_state?.name_phone_date_time_double_check_sent !== true
            )
        if (!(basePass && routePass)) {
          misses.push({ id: row.id, observed, state: result.structured_state, reply: bubbleText(result) })
        }
      }
      check('s1c5a_date_change_reuses_only_exact_historical_offer_and_never_leaks_deposit',
        misses.length === 0,
        misses)
    }

    // ========================================================
    // SCENARIO 1C6 — exhaustive committed-slot polarity matrix at the real
    // controller seam. These 14 calendar and 12 clock turns lock replacement,
    // rejection, reaffirmation, conflict, alternative-list, and open-boundary
    // semantics. Every row starts from the same delivered four-field checkpoint;
    // none may go silent or leak deposit authority.
    // ========================================================
    {
      const polarityCases = [
        { id: 'd1_new_date', text: 'August 31 works.', action: 'post_form_time', date: 'August 31', time: '', checkpoint: false },
        { id: 'd2_reject_exact_date', text: 'I can\'t do August 30.', action: 'post_form_availability', date: '', time: '', checkpoint: false },
        { id: 'd3_reject_other_date', text: 'I can\'t do August 29.', action: 'await_double_check_confirmation', date: 'August 30', time: '2pm', checkpoint: true },
        { id: 'd4_reject_exact_then_new', text: 'I can\'t do August 30; August 31 works.', action: 'post_form_time', date: 'August 31', time: '', checkpoint: false },
        { id: 'd5_new_then_reject_exact', text: 'August 31 works, and I can\'t do August 30.', action: 'post_form_time', date: 'August 31', time: '', checkpoint: false },
        { id: 'd6_same_date_positive_then_negative', text: 'August 30 works, but August 30 does not work.', action: 'post_form_availability', date: '', time: '', checkpoint: false },
        { id: 'd7_same_date_negative_then_positive', text: 'August 30 does not work, but August 30 works.', action: 'post_form_availability', date: '', time: '', checkpoint: false },
        { id: 'd8_date_alternatives', text: 'August 30 or August 31 works.', action: 'post_form_availability', date: '', time: '', checkpoint: false },
        { id: 'd9_date_range', text: 'Between August 30 and August 31 works.', action: 'post_form_availability', date: '', time: '', checkpoint: false },
        { id: 'd10_open_date_boundary', text: 'After August 30 works.', action: 'post_form_availability', date: '', time: '', checkpoint: false },
        { id: 'd11_date_or_later_boundary', text: 'August 30 or later works.', action: 'post_form_availability', date: '', time: '', checkpoint: false },
        { id: 'd12_reaffirm_after_rejecting_other', text: 'Not August 31 — August 30 works.', action: 'await_double_check_confirmation', date: 'August 30', time: '2pm', checkpoint: true },
        { id: 'd13_new_date_then_reject_old', text: 'August 31 works, not August 30.', action: 'post_form_time', date: 'August 31', time: '', checkpoint: false },
        { id: 'd14_reaffirm_then_reject_other', text: 'August 30 works, not August 31.', action: 'await_double_check_confirmation', date: 'August 30', time: '2pm', checkpoint: true },
        { id: 't1_new_time', text: '3pm works.', action: 'double_check', date: 'August 30', time: '3pm', checkpoint: true },
        { id: 't2_reject_exact_time', text: 'I can\'t do 2pm.', action: 'post_form_time', date: 'August 30', time: '', checkpoint: false },
        { id: 't3_reject_other_time', text: 'I can\'t do 3pm.', action: 'await_double_check_confirmation', date: 'August 30', time: '2pm', checkpoint: true },
        { id: 't4_reject_exact_then_new', text: 'I can\'t do 2pm but 3pm works.', action: 'double_check', date: 'August 30', time: '3pm', checkpoint: true },
        { id: 't5_new_then_reject_exact', text: '3pm works but not 2pm.', action: 'double_check', date: 'August 30', time: '3pm', checkpoint: true },
        { id: 't6_same_time_positive_then_negative', text: '2pm works, but 2pm does not work.', action: 'post_form_time', date: 'August 30', time: '', checkpoint: false },
        { id: 't7_same_time_negative_then_positive', text: '2pm does not work, but 2pm works.', action: 'post_form_time', date: 'August 30', time: '', checkpoint: false },
        { id: 't8_time_alternatives', text: '2pm or 3pm works.', action: 'post_form_time', date: 'August 30', time: '', checkpoint: false },
        { id: 't9_time_range', text: 'Between 2pm and 3pm works.', action: 'post_form_time', date: 'August 30', time: '', checkpoint: false },
        { id: 't10_open_time_boundary', text: 'Any time after 2pm works.', action: 'post_form_time', date: 'August 30', time: '', checkpoint: false },
        { id: 't11_time_or_later_boundary', text: '2pm or later works.', action: 'post_form_time', date: 'August 30', time: '', checkpoint: false },
        { id: 't12_reaffirm_after_rejecting_other', text: 'Not 3pm — 2pm works.', action: 'await_double_check_confirmation', date: 'August 30', time: '2pm', checkpoint: true }
      ]
      const expectedPolarityIds = [
        'd1_new_date', 'd2_reject_exact_date', 'd3_reject_other_date', 'd4_reject_exact_then_new',
        'd5_new_then_reject_exact', 'd6_same_date_positive_then_negative', 'd7_same_date_negative_then_positive',
        'd8_date_alternatives', 'd9_date_range', 'd10_open_date_boundary', 'd11_date_or_later_boundary',
        'd12_reaffirm_after_rejecting_other', 'd13_new_date_then_reject_old', 'd14_reaffirm_then_reject_other',
        't1_new_time', 't2_reject_exact_time', 't3_reject_other_time', 't4_reject_exact_then_new',
        't5_new_then_reject_exact', 't6_same_time_positive_then_negative', 't7_same_time_negative_then_positive',
        't8_time_alternatives', 't9_time_range', 't10_open_time_boundary', 't11_time_or_later_boundary',
        't12_reaffirm_after_rejecting_other'
      ]
      const calendarAmbiguityIds = new Set([
        'd6_same_date_positive_then_negative',
        'd7_same_date_negative_then_positive',
        'd8_date_alternatives',
        'd9_date_range'
      ])
      const clockAmbiguityIds = new Set([
        't6_same_time_positive_then_negative',
        't7_same_time_negative_then_positive',
        't8_time_alternatives',
        't9_time_range'
      ])
      const misses = []
      for (const row of polarityCases) {
        const threadId = `s1c6-${row.id}`
        const priorMessageId = `s1c6-prior-${row.id}`
        seedState(root, threadId, {
          tattoo_intent_active: true,
          known_design_context: 'black and gray reference',
          form_offer_asked: true,
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Ivy',
          known_phone_used_on_form: '4155550170',
          known_requested_date: 'August 30',
          known_requested_time: '2pm',
          double_check_sent: true,
          name_phone_date_time_double_check_sent: true,
          booking_stage_hint: 'awaiting_double_check_confirmation',
          current_message_date_local: 'Thursday, August 20, 2026',
          minimum_booking_date_local: '2026-08-27',
          control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
          control_epoch: SCV_CONTROL_EPOCH,
          control_revision: 2,
          ingress_revision: 3,
          control_event_revision: 3,
          latest_ingress_message_id: priorMessageId,
          latest_ingress_at: '2026-08-20T18:00:00.000Z',
          last_control_message_id: priorMessageId
        })
        appendVisibleAssistantText(
          root,
          threadId,
          priorMessageId,
          doubleCheckText({ name: 'Ivy', phone: '4155550170', date: 'August 30', time: '2pm' })
        )
        const inbound = {
          contact_id: threadId,
          thread_id: threadId,
          instagram_username: 'omar.system',
          message_id: `s1c6-live-${row.id}`,
          text: row.text,
          source_interaction_at: '2026-08-20T18:03:00.000Z',
          received_at: '2026-08-20T18:03:00.000Z'
        }
        recordIngressEvent(root, inbound)
        const observed = []
        let result
        try {
          result = executeSingleControlTurn(inbound, {
            root,
            candidateGenerator: (_msg, opts) => {
              const action = String(opts?.control_transition_contract?.action || '')
              const reason = String(opts?.control_transition_contract?.reason || '')
              const candidateState = opts?.structured_state_override || {}
              const date = String(candidateState.known_requested_date || '')
              const time = String(candidateState.known_requested_time || '')
              observed.push({
                action,
                reason,
                date,
                time,
                checkpoint_invalidated: candidateState.live_turn_checkpoint_invalidated === true,
                message_id: String(candidateState.message_id || ''),
                live_text: String(candidateState.text || ''),
                calendar_ambiguity: candidateState.live_turn_calendar_ambiguity === true,
                clock_ambiguity: candidateState.live_turn_clock_ambiguity === true
              })
              if (action === 'post_form_availability') {
                return mkCandidate(opts, { text: 'What one exact appointment date works for you?' })
              }
              if (action === 'post_form_time') {
                return mkCandidate(opts, { text: 'What one exact appointment time works for you?' })
              }
              if (action === 'double_check') {
                return mkCandidate(opts, {
                  text: doubleCheckText({ name: 'Ivy', phone: '4155550170', date: date || row.date, time: time || row.time })
                })
              }
              return mkCandidate(opts, { text: 'Got you — were you referring to something else?' })
            }
          })
        } catch (err) {
          misses.push({ id: row.id, text: row.text, error: String(err?.message || err), observed })
          continue
        }

        const durableDate = String(result.structured_state?.known_requested_date || '').trim()
        const durableTime = String(result.structured_state?.known_requested_time || '').trim()
        const dateMatches = row.date
          ? new RegExp(`\\b${row.date.replace(/\\s+/g, '\\s+')}\\b`, 'i').test(durableDate)
          : durableDate === ''
        const timeMatches = row.time
          ? canonicalClockForHarness(durableTime) === canonicalClockForHarness(row.time)
          : durableTime === ''
        const checkpointMatches = row.checkpoint
          ? result.structured_state?.double_check_sent === true && result.structured_state?.name_phone_date_time_double_check_sent === true
          : result.structured_state?.double_check_sent !== true && result.structured_state?.name_phone_date_time_double_check_sent !== true
        const expectedReason = row.action === 'post_form_availability'
          ? 'submitted_form_missing_date'
          : row.action === 'post_form_time'
            ? 'submitted_form_missing_time'
            : row.action === 'double_check'
              ? 'all_four_booking_fields_ready'
              : 'four_field_double_check_already_sent_wait_without_repeating'
        const actionMatches = observed.length > 0 && observed.every((entry) => (
          entry.action === row.action && entry.reason === expectedReason
        ))
        const ambiguityMatches = (
          observed.every((entry) => entry.calendar_ambiguity === calendarAmbiguityIds.has(row.id)) &&
          observed.every((entry) => entry.clock_ambiguity === clockAmbiguityIds.has(row.id))
        )
        const noSilence = result.packet?.bubbles?.length > 0 && bubbleText(result).trim().length > 0
        const exactFreshCheckpoint = row.action !== 'double_check' || bubbleText(result) === doubleCheckText({
          name: 'Ivy',
          phone: '4155550170',
          date: row.date,
          time: canonicalClockForHarness(row.time) || row.time
        })
        if (!(
          actionMatches &&
          dateMatches &&
          timeMatches &&
          checkpointMatches &&
          ambiguityMatches &&
          exactFreshCheckpoint &&
          noSilence &&
          result.structured_state?.deposit_requested !== true
        )) {
          misses.push({
            id: row.id,
            text: row.text,
            expected: row,
            observed,
            durable: { date: durableDate, time: durableTime },
            checkpoint: {
              double_check_sent: result.structured_state?.double_check_sent,
              name_phone_date_time_double_check_sent: result.structured_state?.name_phone_date_time_double_check_sent
            },
            ambiguity: {
              calendar: result.structured_state?.live_turn_calendar_ambiguity,
              clock: result.structured_state?.live_turn_clock_ambiguity
            },
            reply: bubbleText(result)
          })
        }
      }
      check('s1c6_full_26_case_committed_slot_polarity_matrix_has_no_silence_or_deposit_leak',
        misses.length === 0 &&
        JSON.stringify(polarityCases.map((row) => row.id)) === JSON.stringify(expectedPolarityIds),
        misses)
    }

    // ========================================================
    // SCENARIO 1C6B — a rejected first draft must not resurrect the previous
    // delivered checkpoint while the controller reauthors a replacement time.
    // The exact same ingress remains the authority for every bounded pass.
    // ========================================================
    {
      const threadId = 's1c6b-replacement-time-reauthor'
      const priorMessageId = 's1c6b-prior-double-check'
      seedState(root, threadId, {
        tattoo_intent_active: true,
        known_design_context: 'black and gray reference',
        form_offer_asked: true,
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Ivy',
        known_phone_used_on_form: '4155550170',
        known_requested_date: 'August 30',
        known_requested_time: '2pm',
        double_check_sent: true,
        name_phone_date_time_double_check_sent: true,
        booking_stage_hint: 'awaiting_double_check_confirmation',
        current_message_date_local: 'Thursday, August 20, 2026',
        minimum_booking_date_local: '2026-08-27',
        control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
        control_epoch: SCV_CONTROL_EPOCH,
        control_revision: 2,
        ingress_revision: 3,
        control_event_revision: 3,
        latest_ingress_message_id: priorMessageId,
        latest_ingress_at: '2026-08-20T18:00:00.000Z',
        last_control_message_id: priorMessageId
      })
      appendVisibleAssistantText(
        root,
        threadId,
        priorMessageId,
        doubleCheckText({ name: 'Ivy', phone: '4155550170', date: 'August 30', time: '2pm' })
      )
      const inbound = {
        contact_id: threadId,
        thread_id: threadId,
        instagram_username: 'omar.system',
        message_id: 's1c6b-live-replacement-time',
        text: '3pm works.',
        source_interaction_at: '2026-08-20T18:03:00.000Z',
        received_at: '2026-08-20T18:03:00.000Z'
      }
      recordIngressEvent(root, inbound)
      const observed = []
      let candidateCalls = 0
      const result = executeSingleControlTurn(inbound, {
        root,
        candidateGenerator: (_msg, opts) => {
          candidateCalls += 1
          const state = opts?.structured_state_override || {}
          observed.push({
            action: String(opts?.control_transition_contract?.action || ''),
            reason: String(opts?.control_transition_contract?.reason || ''),
            time: String(state.known_requested_time || ''),
            checkpoint_invalidated: state.live_turn_checkpoint_invalidated === true
          })
          if (candidateCalls === 1) {
            return mkCandidate(opts, { text: 'Got you — were you referring to something else?' })
          }
          return mkCandidate(opts, {
            text: doubleCheckText({
              name: 'Ivy',
              phone: '4155550170',
              date: 'August 30',
              time: canonicalClockForHarness(state.known_requested_time) || state.known_requested_time
            })
          })
        }
      })
      check(
        's1c6b_reauthor_preserves_replacement_checkpoint_route',
        candidateCalls === 2 &&
        observed.length === 2 &&
        observed.every((entry) => (
          entry.action === 'double_check' &&
          entry.reason === 'all_four_booking_fields_ready' &&
          canonicalClockForHarness(entry.time) === '3:00pm' &&
          entry.checkpoint_invalidated === true
        )) &&
        bubbleText(result) === doubleCheckText({
          name: 'Ivy',
          phone: '4155550170',
          date: 'August 30',
          time: '3:00pm'
        }) &&
        canonicalClockForHarness(result.structured_state?.known_requested_time) === '3:00pm' &&
        result.structured_state?.double_check_sent === true &&
        result.structured_state?.name_phone_date_time_double_check_sent === true &&
        result.structured_state?.deposit_requested !== true,
        { candidateCalls, observed, state: result.structured_state, reply: bubbleText(result) }
      )
    }

    // ========================================================
    // SCENARIO 1D — the rejected-date receipt is created by the real commit
    // path, survives the visible-delivery boundary, and authorizes exactly the
    // next monthless counterproposal. This proves the state is not a fixture-only
    // shortcut and the verifier/opener share the same natural reply boundary.
    // ========================================================
    {
      const threadId = 's1d-durable-rejected-date-chain'
      seedState(root, threadId, {
        tattoo_intent_active: true,
        known_design_context: 'black and gray reference',
        form_offer_asked: true,
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Ivy',
        known_phone_used_on_form: '4155550170',
        booking_stage_hint: 'awaiting_date',
        current_message_date_local: 'Tuesday, August 25, 2026',
        minimum_booking_date_local: '2026-09-01',
        control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
        control_epoch: SCV_CONTROL_EPOCH,
        control_revision: 1,
        ingress_revision: 1,
        control_event_revision: 1
      })
      const rejectedInbound = {
        contact_id: threadId,
        thread_id: threadId,
        instagram_username: 'omar.system',
        message_id: 's1d-august-27',
        text: 'Can we do August 27?',
        received_at: '2026-08-25T18:00:00.000Z'
      }
      recordIngressEvent(root, rejectedInbound)
      const rejectedResult = executeSingleControlTurn(rejectedInbound, {
        root,
        candidateGenerator: (_msg, opts) => mkCandidate(opts, {
          text: 'August 27 is too soon. September 1 at 2pm is the earliest I can do. Would that work?'
        })
      })
      check('s1d_commit_persists_exact_rejected_date_receipt',
        /august\s+27/i.test(String(rejectedResult.structured_state?.last_rejected_client_date || '')) &&
        rejectedResult.structured_state?.last_rejected_client_date_message_id === rejectedInbound.message_id &&
        !String(rejectedResult.structured_state?.known_requested_date || '').trim(),
        rejectedResult.structured_state)
      publishDeliveredResult(root, rejectedInbound, rejectedResult)

      const followup = {
        contact_id: threadId,
        thread_id: threadId,
        instagram_username: 'omar.system',
        message_id: 's1d-august-28',
        text: 'Can we do 28?',
        received_at: '2026-08-25T18:01:00.000Z'
      }
      recordIngressEvent(root, followup)
      const observed = []
      const followupResult = executeSingleControlTurn(followup, {
        root,
        candidateGenerator: (_msg, opts) => {
          observed.push({
            action: String(opts?.control_transition_contract?.action || ''),
            reason: String(opts?.control_transition_contract?.reason || ''),
            phrase: String(opts?.structured_state_override?.live_turn_date_phrase || ''),
            status: String(opts?.structured_state_override?.live_turn_date_status || '')
          })
          return mkCandidate(opts, {
            text: 'I won’t have an opening before September 1 at 2pm. Would that work?'
          })
        }
      })
      check('s1d_next_turn_consumes_durable_rejection_and_stays_live',
        observed[0]?.action === 'post_form_availability' &&
        observed[0]?.reason === 'submitted_form_date_counterproposal_outside_window' &&
        /august\s+28/i.test(observed[0]?.phrase || '') &&
        observed[0]?.status === 'too_soon' &&
        followupResult.packet?.bubbles?.length > 0,
        { observed, state: followupResult.structured_state, reply: bubbleText(followupResult) })
    }

    // ========================================================
    // SCENARIO 1E — a named date used as biography/history is not an
    // appointment proposal. The controller may answer the live availability
    // question, but it cannot manufacture a rejected-date receipt from it.
    // ========================================================
    {
      const incidentalTurns = [
        'My birthday is August 27. What dates are open?',
        'My previous appointment was August 27. What dates are open?',
        'My tattoo was done August 27 last year. What dates are open?',
        'My birthday is August 27, and then we had dinner. What dates are open?',
        'My tattoo was done August 27 last year and it works fine now. What dates are open?',
        'My birthday is August 27, and that day I will be away. What dates are open?',
        'My previous appointment was August 27 and I could do nothing after it. What dates are open?'
      ]
      const leaks = []
      for (const [index, text] of incidentalTurns.entries()) {
        const threadId = `s1e-incidental-date-${index}`
        seedState(root, threadId, {
          tattoo_intent_active: true,
          known_design_context: 'black and gray reference',
          form_offer_asked: true,
          form_link_sent: true,
          form_submitted: true,
          booking_stage_hint: 'awaiting_date',
          control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
          control_epoch: SCV_CONTROL_EPOCH,
          control_revision: 1,
          ingress_revision: 1,
          control_event_revision: 1
        })
        const inbound = {
          contact_id: threadId,
          thread_id: threadId,
          instagram_username: 'omar.system',
          message_id: `s1e-message-${index}`,
          text,
          received_at: '2026-08-25T18:00:00.000Z'
        }
        recordIngressEvent(root, inbound)
        const observed = []
        const result = executeSingleControlTurn(inbound, {
          root,
          candidateGenerator: (_msg, opts) => {
            observed.push({
              action: String(opts?.control_transition_contract?.action || ''),
              reason: String(opts?.control_transition_contract?.reason || ''),
              dateStatus: String(opts?.structured_state_override?.live_turn_date_status || ''),
              datePhrase: String(opts?.structured_state_override?.live_turn_date_phrase || '')
            })
            return mkCandidate(opts, {
              text: 'September 1 at 2pm is my first opening. Would that work?'
            })
          }
        })
        if (
          observed[0]?.reason === 'submitted_form_date_counterproposal_outside_window' ||
          observed[0]?.dateStatus || observed[0]?.datePhrase ||
          String(result.structured_state?.last_rejected_client_date || '').trim() ||
          String(result.structured_state?.last_rejected_client_date_message_id || '').trim()
        ) {
          leaks.push({ text, observed, state: result.structured_state })
        }
      }
      check('s1e_incidental_named_dates_never_create_booking_rejection_authority',
        leaks.length === 0,
        leaks)
    }

    // ========================================================
    // SCENARIO 1E2 — a fresh pre-form social/event date cannot create, clear,
    // or replace the controller's rejected-booking-date receipt. Receipt
    // mutation belongs only to an adopted submitted-form calendar transition.
    // ========================================================
    {
      const socialDateCases = [
        {
          id: 'fresh_too_soon_trip_date',
          text: 'My trip starts August 27.',
          rejectedDate: '',
          rejectedMessageId: ''
        },
        {
          id: 'legal_trip_date_preserves_existing_receipt',
          text: 'My trip starts September 10.',
          rejectedDate: 'August 26',
          rejectedMessageId: 'prior-rejected-booking-message'
        }
      ]
      const leaks = []
      for (const row of socialDateCases) {
        const threadId = `s1e2-${row.id}`
        seedState(root, threadId, {
          tattoo_intent_active: false,
          form_offer_asked: false,
          form_link_sent: false,
          form_submitted: false,
          booking_stage_hint: 'open_conversation',
          last_rejected_client_date: row.rejectedDate,
          last_rejected_client_date_message_id: row.rejectedMessageId,
          control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
          control_epoch: SCV_CONTROL_EPOCH,
          control_revision: 1,
          ingress_revision: 1,
          control_event_revision: 1
        })
        const inbound = {
          contact_id: threadId,
          thread_id: threadId,
          instagram_username: 'omar.system',
          message_id: `s1e2-message-${row.id}`,
          text: row.text,
          received_at: '2026-08-25T18:00:00.000Z'
        }
        recordIngressEvent(root, inbound)
        const observed = []
        const result = executeSingleControlTurn(inbound, {
          root,
          candidateGenerator: (_msg, opts) => {
            observed.push({
              action: String(opts?.control_transition_contract?.action || ''),
              reason: String(opts?.control_transition_contract?.reason || ''),
              dateStatus: String(opts?.structured_state_override?.live_turn_date_status || ''),
              datePhrase: String(opts?.structured_state_override?.live_turn_date_phrase || '')
            })
            return mkCandidate(opts, { text: 'that sounds exciting, what are you looking forward to most?' })
          }
        })
        if (
          observed[0]?.action === 'post_form_availability' ||
          observed[0]?.action === 'post_form_time' ||
          result.structured_state?.form_submitted === true ||
          String(result.structured_state?.last_rejected_client_date || '') !== row.rejectedDate ||
          String(result.structured_state?.last_rejected_client_date_message_id || '') !== row.rejectedMessageId
        ) {
          leaks.push({ row, observed, state: result.structured_state, reply: bubbleText(result) })
        }
      }
      check('s1e2_pre_form_social_dates_cannot_mutate_rejected_booking_receipt',
        leaks.length === 0,
        leaks)
    }

    // ========================================================
    // SCENARIO 1F — retry/recovery bookkeeping time cannot move the seven-day
    // floor. The immutable Instagram interaction timestamp owns both the policy
    // snapshot and the explicit-date classifier.
    // ========================================================
    {
      const threadId = 's1f-immutable-calendar-clock'
      seedState(root, threadId, {
        tattoo_intent_active: true,
        known_design_context: 'black and gray reference',
        form_offer_asked: true,
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Ivy',
        known_phone_used_on_form: '4155550170',
        booking_stage_hint: 'awaiting_date',
        control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
        control_epoch: SCV_CONTROL_EPOCH,
        control_revision: 1,
        ingress_revision: 1,
        control_event_revision: 1
      })
      const inbound = {
        contact_id: threadId,
        thread_id: threadId,
        instagram_username: 'omar.system',
        message_id: 's1f-august-28',
        text: 'Can we do August 28?',
        source_interaction_at: '2026-08-20T18:00:00.000Z',
        received_at: '2026-08-25T18:00:00.000Z'
      }
      recordIngressEvent(root, inbound)
      const observed = []
      const result = executeSingleControlTurn(inbound, {
        root,
        candidateGenerator: (_msg, opts) => {
          observed.push({
            action: String(opts?.control_transition_contract?.action || ''),
            reason: String(opts?.control_transition_contract?.reason || ''),
            current: String(opts?.structured_state_override?.current_message_date_iso || ''),
            minimum: String(opts?.structured_state_override?.minimum_booking_date_iso || ''),
            status: String(opts?.structured_state_override?.live_turn_date_status || '')
          })
          return mkCandidate(opts, { text: 'August 28 works. What time works best for you?' })
        }
      })
      check('s1f_immutable_source_time_owns_calendar_floor_across_recovery',
        observed[0]?.action === 'post_form_time' &&
        observed[0]?.reason === 'submitted_form_missing_time' &&
        observed[0]?.current === '2026-08-20' &&
        observed[0]?.minimum === '2026-08-27' &&
        observed[0]?.status === 'legal' &&
        !String(result.structured_state?.last_rejected_client_date || '').trim(),
        { observed, state: result.structured_state, reply: bubbleText(result) })
    }

    // ========================================================
    // SCENARIO 2 — same path from an EXACT voice transcript; a weaker
    // unresolved retry text cannot overwrite it (monotonic media authority).
    // (sealed: monotonic_media_context_authority_policy)
    // ========================================================
    {
      const resolvedVoice = 'sent a voice note saying: How about 26?'
      const unresolvedRetry = 'sent a voice note that could not be understood'
      check('s2_resolved_voice_outranks_unresolved',
        mediaContextAuthorityRank(resolvedVoice) > mediaContextAuthorityRank(unresolvedRetry),
        { resolved: mediaContextAuthorityRank(resolvedVoice), unresolved: mediaContextAuthorityRank(unresolvedRetry) })
      const downgrade = selectAuthoritativeMediaText(resolvedVoice, unresolvedRetry)
      check('s2_weaker_retry_cannot_overwrite_transcript',
        downgrade.adopted === false && downgrade.text === resolvedVoice && downgrade.reason === 'media_context_downgrade_blocked',
        downgrade)
      // Monotonicity is one-directional: an unresolved placeholder MAY still be
      // upgraded to the resolved transcript (never the reverse).
      const upgrade = selectAuthoritativeMediaText(unresolvedRetry, resolvedVoice)
      check('s2_unresolved_placeholder_may_upgrade_to_resolved_transcript',
        upgrade.adopted === true && upgrade.text === resolvedVoice,
        upgrade)

      // Seam-level: the detector still binds day 26 from the exact voice transcript.
      const history = [{ role: 'assistant', message_id: 'a', text: AVAIL_ASK }]
      const det = extractContextualBookingDayReply(resolvedVoice, { form_submitted: true, booking_stage_hint: 'awaiting_date' }, history)
      check('s2_voice_transcript_still_binds_day_26', !!det && det.day === 26, det)
    }

    // ========================================================
    // SCENARIO 3 — month-only follow-up -> window validation -> grounded
    // legal alternative when the resolved date is outside the booking window.
    // (sealed: outside_window_grounded_alternative_policy, month_clarification_continuity_policy)
    // ========================================================
    {
      // Real inverse-slot detector: "July" answers "which month for the 26th?"
      const monthHistory = [{ role: 'assistant', message_id: 'mq', text: 'which month did you mean for the 26th?' }]
      const monthDet = extractContextualBookingMonthReply('July', { form_submitted: true, booking_stage_hint: 'awaiting_date' }, monthHistory)
      check('s3_month_reply_binds_day_and_month',
        !!monthDet && monthDet.day === 26 && String(monthDet.month_anchor).toLowerCase() === 'july',
        monthDet)

      // Live 2026-07-27 #2: "I'm thinking of 29" missed every day-answer shape,
      // the route fell to submitted_form_missing_date, and the model freestyled
      // "got it 29 works" then flipped to "too soon" next turn without asking
      // the month. Proposal-verb day answers are first-class replies.
      const dayHistory = [{ role: 'assistant', message_id: 'dq', text: 'which day were you thinking for your appointment?' }]
      const dayState = { form_submitted: true, booking_stage_hint: 'awaiting_date' }
      const thinkingDet = extractContextualBookingDayReply("I'm thinking of 29", dayState, dayHistory)
      check('s3_proposal_verb_day_binds_and_needs_month',
        !!thinkingDet && thinkingDet.day === 29 && !thinkingDet.month_anchor,
        thinkingDet)
      check('s3_lets_do_day_binds',
        (() => { const d = extractContextualBookingDayReply('lets do 29', dayState, dayHistory); return !!d && d.day === 29 })(),
        'lets do 29 must bind')
      check('s3_numeric_smalltalk_never_binds',
        extractContextualBookingDayReply('i have 29 followers', dayState, dayHistory) === null,
        'follower count must not bind as a date')

      // Live 2026-07-27: "I mean this month" answered the open month question
      // but carried no month name — the lane missed, the route fell back to
      // submitted_form_missing_date, and the shipped packet contradicted itself
      // ("this month for the 30th" + "which day in august?"). Relative months
      // resolve against the studio-local booking clock.
      const relState = {
        form_submitted: true,
        booking_stage_hint: 'awaiting_date',
        current_message_date_local: 'Monday, July 27, 2026'
      }
      const thisMonthDet = extractContextualBookingMonthReply('I mean this month', relState, monthHistory)
      check('s3_relative_this_month_binds_current_month',
        !!thisMonthDet && thisMonthDet.day === 26 && String(thisMonthDet.month_anchor) === 'july' && thisMonthDet.relative_month === 'this',
        thisMonthDet)
      const nextMonthDet = extractContextualBookingMonthReply('next month works', relState, monthHistory)
      check('s3_relative_next_month_binds_following_month',
        !!nextMonthDet && nextMonthDet.day === 26 && String(nextMonthDet.month_anchor) === 'august' && nextMonthDet.relative_month === 'next',
        nextMonthDet)
      check('s3_relative_month_requires_answer_shape',
        extractContextualBookingMonthReply('i was busy this month honestly', relState, monthHistory) === null,
        'loose sentence must not bind')

      const threadId = 's3-window'
      seedState(root, threadId, {
        tattoo_intent_active: true, form_offer_asked: true, form_link_sent: true, form_submitted: true,
        known_name_used_on_form: 'Eloise', known_phone_used_on_form: '4155550199',
        last_offered_date: '25th of July', last_offered_time: '2pm', booking_stage_hint: 'awaiting_date'
      })
      const inbound = {
        contact_id: threadId, thread_id: threadId, instagram_username: 'single.control.window',
        message_id: 's3-msg', text: 'How about the 18th of July?', received_at: '2026-07-12T23:02:00.000Z'
      }
      const history = [{ role: 'assistant', message_id: 'a', text: AVAIL_ASK }]
      recordIngressEvent(root, inbound)
      let calls = 0
      const result = executeSingleControlTurn(inbound, {
        root,
        authority_options: {
          recent_history_override: history,
          structured_state_override: { form_submitted: true, form_link_sent: true, live_turn_date_phrase: '18th of July', live_turn_date_status: 'too_soon' }
        },
        candidateGenerator: (_m, opts) => {
          calls += 1
          if (calls === 1) {
            // Bare rejection with no grounded alternative — must not be the final reply.
            return mkCandidate(opts, { text: "that date doesn't work." })
          }
          // Grounded, answerable, state-legal alternative.
          return mkCandidate(opts, { text: 'the 18th is earlier than i can do — would the 25th of July at 2pm work instead?', structured_state: { live_turn_date_phrase: '18th of July', live_turn_date_status: 'too_soon' } })
        }
      })
      check('s3_outside_window_reply_leaves_grounded_alternative',
        /25th of july|25th|2pm/i.test(bubbleText(result)) && result.packet.bubbles.length > 0,
        bubbleText(result))
      check('s3_outside_window_did_not_commit_illegal_date',
        !/18th/.test(String(result.structured_state.known_requested_date || '')),
        result.structured_state.known_requested_date)
    }

    // ========================================================
    // SCENARIO 4 — the current inbound message_id never appears in its own
    // recent history (dialogue adjacency stays prior-packet-only).
    // (sealed: current_live_event_history_exclusion_policy)
    // ========================================================
    {
      const threadId = 's4-adjacency'
      seedState(root, threadId, { tattoo_intent_active: true, form_submitted: true, booking_stage_hint: 'awaiting_date' })
      const priorInbound = {
        contact_id: threadId, thread_id: threadId, instagram_username: 'adj.test',
        message_id: 's4-prior', text: 'i submitted the form', received_at: '2026-07-23T19:59:00.000Z'
      }
      recordIngressEvent(root, priorInbound)
      const inbound = {
        contact_id: threadId, thread_id: threadId, instagram_username: 'adj.test',
        message_id: 's4-current', text: 'How about 26?', received_at: '2026-07-23T20:00:00.000Z'
      }
      recordIngressEvent(root, inbound)

      // The history file DOES contain the current message id (it was ingressed)...
      const rawHistory = JSON.parse(fs.readFileSync(historyPath(root, threadId), 'utf8'))
      const currentInFile = (rawHistory.events || []).some((e) => String(e.message_id) === 's4-current')
      check('s4_current_message_is_recorded_in_history_file', currentInFile, rawHistory.events)

      // ...but the REAL runner-side history loader must EXCLUDE the current turn,
      // independent of any later enriched text, so adjacency = prior packet only.
      let loaded = null
      try { loaded = loadRecentThreadHistory(inbound) } catch (e) { loaded = { error: String(e && e.message || e) } }
      const loadedArr = Array.isArray(loaded) ? loaded : (loaded && Array.isArray(loaded.events) ? loaded.events : [])
      const currentInLoaded = loadedArr.some((e) => String(e && e.message_id) === 's4-current')
      const priorInLoaded = loadedArr.some((e) => String(e && e.message_id) === 's4-prior')
      check('s4_current_message_excluded_from_its_own_recent_history',
        !currentInLoaded, { currentInLoaded, loadedIds: loadedArr.map((e) => e && e.message_id) })
      check('s4_prior_turn_still_available_for_adjacency',
        priorInLoaded, { priorInLoaded, loadedIds: loadedArr.map((e) => e && e.message_id) })

      // Idempotent: re-ingesting the current message does not duplicate the user event.
      recordIngressEvent(root, inbound)
      const rawHistory2 = JSON.parse(fs.readFileSync(historyPath(root, threadId), 'utf8'))
      const dupUserEvents = (rawHistory2.events || []).filter((e) => String(e.message_id) === 's4-current' && e.role === 'user').length
      check('s4_current_message_not_duplicated_on_reingress', dupUserEvents === 1, { dupUserEvents })
    }

    // ========================================================
    // SCENARIO 5 — invalid first candidate -> verifier reject -> materially
    // CHANGED second candidate -> accepted outbound. No same-candidate loop.
    // ========================================================
    {
      const threadId = 's5-reauthor'
      seedState(root, threadId, {
        tattoo_intent_active: true, form_offer_asked: true, form_link_sent: true, form_submitted: true,
        known_name_used_on_form: 'Ivy', known_phone_used_on_form: '4155550170',
        known_requested_date: '7th of August', known_requested_time: '2pm', booking_stage_hint: 'ready_for_double_check'
      })
      const inbound = {
        contact_id: threadId, thread_id: threadId, instagram_username: 'reauthor.test',
        message_id: 's5-msg', text: "yeah that's all correct", received_at: '2026-07-23T20:05:00.000Z'
      }
      recordIngressEvent(root, inbound)
      let calls = 0
      const seen = []
      const result = executeSingleControlTurn(inbound, {
        root,
        authority_options: {
          recent_history_override: [{ role: 'assistant', message_id: 'dc', text: 'name: Ivy ‖ phone: 4155550170 ‖ date: 7th of August ‖ time: 2pm — all correct?' }],
          structured_state_override: {
            form_submitted: true, form_link_sent: true,
            known_name_used_on_form: 'Ivy', known_phone_used_on_form: '4155550170',
            known_requested_date: '7th of August', known_requested_time: '2pm',
            double_check_shown: true, live_turn_confirms_double_check: true
          }
        },
        candidateGenerator: (_m, opts) => {
          calls += 1
          if (calls === 1) {
            // Dead-end: acknowledgement that fails to send the deposit handoff after confirmation.
            seen.push('flat-ack')
            return mkCandidate(opts, { text: 'awesome, thanks!' })
          }
          seen.push('deposit')
          // Candidate carries only visible wording; the controller commits
          // deposit_requested post-adoption (never the candidate itself).
          return mkCandidate(opts, { text: DEPOSIT_TEXT })
        }
      })
      check('s5_reauthored_after_rejection_two_distinct_candidates',
        calls === 2 && seen[0] !== seen[1] && result.authority.control_candidate_passes === 2,
        { calls, seen, passes: result.authority.control_candidate_passes })
      check('s5_second_candidate_adopted_with_deposit_detail',
        /contact@omarprotocol\.com|deposit/i.test(bubbleText(result)),
        bubbleText(result))
    }

    // ========================================================
    // SCENARIO 6 — TWO invalid candidates in a row -> executeSingleControlTurn
    // fails CLOSED (throws retryable), and the inbox-worker disposition maps
    // that to a bounded retry, never a silent drop / deadletter.
    // (core no-silent-loss contract)
    // ========================================================
    {
      const threadId = 's6-nosilence'
      seedState(root, threadId, {
        tattoo_intent_active: true, form_offer_asked: true, form_link_sent: true, form_submitted: true,
        booking_stage_hint: 'awaiting_date'
      })
      const inbound = {
        contact_id: threadId, thread_id: threadId, instagram_username: 'nosilence.test',
        message_id: 's6-msg', text: 'How about 26?', received_at: '2026-07-23T20:06:00.000Z'
      }
      recordIngressEvent(root, inbound)
      let calls = 0
      let thrown = null
      try {
        executeSingleControlTurn(inbound, {
          root,
          authority_options: {
            recent_history_override: [{ role: 'assistant', message_id: 'a', text: AVAIL_ASK }],
            structured_state_override: {
              form_submitted: true, form_link_sent: true,
              live_turn_contextual_booking_reply: true, live_turn_monthless_day_candidate: '26', live_turn_date_needs_month: true
            }
          },
          candidateGenerator: (_m, opts) => {
            calls += 1
            // Always a hard semantic violation (size/placement ask) — never valid.
            return mkCandidate(opts, { text: 'what size were you thinking and where on your body do you want it?' })
          }
        })
      } catch (e) { thrown = String(e && e.message || e) }
      check('s6_exhausted_candidates_throw_not_silent',
        thrown !== null && /single_control_internal_retryable|final_verifier_rejected|post_filter/i.test(thrown),
        thrown)
      check('s6_multiple_passes_attempted_before_failure', calls >= 2, { calls })
      // The inbox-worker maps this exact failure to a bounded retry (fail-closed).
      const disposition = classifyInboxFailureDisposition(String(thrown || ''))
      check('s6_inbox_worker_disposition_is_retry_never_deadletter',
        disposition === 'retry', { disposition, persistentInternal: isPersistentInternalControlError(String(thrown || '')) })
    }

    // ========================================================
    // SCENARIO 7 — deictic "this one" with reference present vs absent.
    // Absent: must ask for the real media (resolve_context), never pretend.
    // Present: must react to the actual reference and move forward.
    // ========================================================
    {
      // Absent referent.
      const threadIdA = 's7-absent'
      seedState(root, threadIdA, { tattoo_intent_active: true })
      const inboundA = {
        contact_id: threadIdA, thread_id: threadIdA, instagram_username: 'deictic.absent',
        message_id: 's7a', text: "i'm thinking of this one", received_at: '2026-07-23T20:07:00.000Z'
      }
      recordIngressEvent(root, inboundA)
      let aCalls = 0
      const resultA = executeSingleControlTurn(inboundA, {
        root,
        authority_options: { structured_state_override: { live_turn_reference_pointer_without_media: true, live_turn_context_missing: true } },
        candidateGenerator: (_m, opts) => {
          aCalls += 1
          if (aCalls === 1) {
            // Pretending to see it — must be rejected.
            return mkCandidate(opts, { text: 'love that vibe, the linework is amazing!' })
          }
          return mkCandidate(opts, { text: "i can't see it yet — can you send the actual pic or post so i can look?" })
        }
      })
      check('s7_absent_reference_asks_for_real_media_not_pretend',
        /send|pic|post|photo|can't see|cannot see/i.test(bubbleText(resultA)) &&
        !/love that vibe|linework is amazing/i.test(bubbleText(resultA)),
        bubbleText(resultA))

      // Present referent (resolved vision context).
      const threadIdP = 's7-present'
      seedState(root, threadIdP, { tattoo_intent_active: true })
      const inboundP = {
        contact_id: threadIdP, thread_id: threadIdP, instagram_username: 'deictic.present',
        message_id: 's7p', text: 'sent a reference post: fine-line snake wrapping a dagger', received_at: '2026-07-23T20:08:00.000Z'
      }
      recordIngressEvent(root, inboundP)
      const resultP = executeSingleControlTurn(inboundP, {
        root,
        authority_options: { structured_state_override: { live_turn_is_media_reference: true, live_turn_reference_context: 'fine-line snake wrapping a dagger', live_turn_media_tattoo_reference: true } },
        candidateGenerator: (_m, opts) => mkCandidate(opts, {
          text: 'a fine-line snake wrapping a dagger would look sharp — want me to send the booking form so we can lock it in?',
          media_context_resolved: true,
          authority_observed_live_turn_text: 'sent a reference post: fine-line snake wrapping a dagger'
        })
      })
      check('s7_present_reference_reacts_to_actual_content',
        /snake|dagger|fine-line/i.test(bubbleText(resultP)),
        bubbleText(resultP))
    }

    // ========================================================
    // SCENARIO 8 — one-time transitions stay one-time across a full path:
    // form offer -> link exactly once; submitted -> availability;
    // 4 fields -> one-line-per-field double-check; confirmation -> deposit once.
    // (sealed: open_post_form_model_authorship_policy — double-check/deposit exact)
    // ========================================================
    {
      const threadId = 's8-oneshot'
      seedState(root, threadId, {
        tattoo_intent_active: true, known_design_context: 'fine-line fox on the forearm',
        form_offer_asked: true, booking_stage_hint: 'offer_open'
      })

      // Turn A: mixed form consent + price question -> one atomic SEND_FORM.
      // This is the exact live family that exposed the controller/runner split:
      // a valid GPT output carries all three locked pricing facts: discounted
      // model rate, "$150 an hour", and "my visual language".
      const inboundA = { contact_id: threadId, thread_id: threadId, instagram_username: 'oneshot.test', message_id: 's8a', text: 'YES PLEASE HOW MUCH IS IT BY THE WAY', received_at: '2026-07-23T20:09:00.000Z' }
      recordIngressEvent(root, inboundA)
      const resultA = executeSingleControlTurn(inboundA, {
        root,
        authority_options: { structured_state_override: { form_offer_asked: true, live_turn_form_consent: true, live_turn_pricing_question: true } },
        candidateGenerator: (_m, opts) => mkCandidate(opts, { text: `Yep the discounted model rate is $150 an hour when the finished piece stays in my visual language\nHere is the booking form ${FORM_LINK}\nSend me a couple days that work so I can check availability` })
      })
      check('s8_mixed_consent_price_form_link_sent_once',
        resultA.authority.closed_transition_action === 'send_form' &&
        resultA.structured_state.form_link_sent === true &&
        bubbleText(resultA).includes(FORM_LINK) &&
        /150 an hour/i.test(bubbleText(resultA)) &&
        /visual language/i.test(bubbleText(resultA)),
        resultA.authority)
      publishDeliveredResult(root, inboundA, resultA)

      // Turn B: submitted form -> POST_FORM_AVAILABILITY (never flat).
      const stateAfterA = readControlState(root, threadId)
      const inboundB = { contact_id: threadId, thread_id: threadId, instagram_username: 'oneshot.test', message_id: 's8b', text: 'ok submitted it', received_at: '2026-07-23T20:10:00.000Z' }
      recordIngressEvent(root, inboundB)
      const resultB = executeSingleControlTurn(inboundB, {
        root,
        authority_options: { structured_state_override: { ...stateAfterA, form_link_sent: true, live_turn_form_submitted_signal: true } },
        candidateGenerator: (_m, opts) => mkCandidate(opts, { text: 'got your form — what days or weekend days are easiest for you?' })
      })
      check('s8_submitted_form_opens_availability',
        String(resultB.authority.closed_transition_action).startsWith('post_form') || resultB.structured_state.form_submitted === true,
        resultB.authority)
      publishDeliveredResult(root, inboundB, resultB)

      // Turn C: all four identity fields -> exactly one double-check.
      const inboundC = { contact_id: threadId, thread_id: threadId, instagram_username: 'oneshot.test', message_id: 's8c', text: 'Ivy, 4155550170, 7th of August, 2pm', received_at: '2026-07-23T20:11:00.000Z' }
      recordIngressEvent(root, inboundC)
      const resultC = executeSingleControlTurn(inboundC, {
        root,
        authority_options: { structured_state_override: { form_submitted: true, form_link_sent: true, known_name_used_on_form: 'Ivy', known_phone_used_on_form: '4155550170', known_requested_date: '7th of August', known_requested_time: '2pm', booking_stage_hint: 'ready_for_double_check' } },
        candidateGenerator: (_m, opts) => mkCandidate(opts, { text: doubleCheckText({ name: 'Ivy', phone: '4155550170', date: '7th of August', time: '2pm' }) })
      })
      check('s8_double_check_one_field_per_line',
        resultC.authority.closed_transition_action === 'double_check' &&
        /name:\s*ivy/i.test(bubbleText(resultC)) && /phone number:\s*4155550170/i.test(bubbleText(resultC)) &&
        /appointment date:\s*7th of august/i.test(bubbleText(resultC)) && /time:\s*2pm/i.test(bubbleText(resultC)),
        { action: resultC.authority.closed_transition_action, text: bubbleText(resultC) })
      publishDeliveredResult(root, inboundC, resultC)

      // Turn D: positive confirmation -> deposit exactly once.
      const inboundD = { contact_id: threadId, thread_id: threadId, instagram_username: 'oneshot.test', message_id: 's8d', text: 'yes perfect', received_at: '2026-07-23T20:12:00.000Z' }
      recordIngressEvent(root, inboundD)
      const resultD = executeSingleControlTurn(inboundD, {
        root,
        authority_options: {
          recent_history_override: [{ role: 'assistant', message_id: 's8c-dc', text: doubleCheckText({ name: 'Ivy', phone: '4155550170', date: '7th of August', time: '2pm' }) }],
          structured_state_override: { form_submitted: true, form_link_sent: true, known_name_used_on_form: 'Ivy', known_phone_used_on_form: '4155550170', known_requested_date: '7th of August', known_requested_time: '2pm', double_check_sent: true, live_turn_confirms_double_check: true }
        },
        candidateGenerator: (_m, opts) => mkCandidate(opts, { text: DEPOSIT_TEXT })
      })
      check('s8_confirmation_goes_to_deposit_once',
        resultD.authority.closed_transition_action === 'deposit_handoff' && resultD.structured_state.deposit_requested === true,
        resultD.authority)
    }

    // ========================================================
    // SCENARIO 9 — three consecutive full booking-path completions with
    // isolated per-contact state and no cross-run contamination.
    // ========================================================
    {
      const runOneBooking = (threadId, who) => {
        seedState(root, threadId, { tattoo_intent_active: true, known_design_context: `custom piece for ${who.name}`, form_offer_asked: true, booking_stage_hint: 'offer_open' })
        // consent -> link
        const c1 = { contact_id: threadId, thread_id: threadId, instagram_username: who.ig, message_id: `${threadId}-c1`, text: 'yes send it', received_at: '2026-07-23T21:00:00.000Z' }
        recordIngressEvent(root, c1)
        executeSingleControlTurn(c1, { root, authority_options: { structured_state_override: { form_offer_asked: true, live_turn_form_consent: true } }, candidateGenerator: (_m, opts) => mkCandidate(opts, { text: `here's the form: ${FORM_LINK} — fill it out and drop me a couple days that work so i can check availability.` }) })
        // submitted -> availability
        const c2 = { contact_id: threadId, thread_id: threadId, instagram_username: who.ig, message_id: `${threadId}-c2`, text: 'submitted', received_at: '2026-07-23T21:01:00.000Z' }
        recordIngressEvent(root, c2)
        const s2 = readControlState(root, threadId)
        executeSingleControlTurn(c2, { root, authority_options: { structured_state_override: { ...s2, form_link_sent: true, live_turn_form_submitted_signal: true } }, candidateGenerator: (_m, opts) => mkCandidate(opts, { text: 'got it — what days work for you?' }) })
        // four fields -> double check
        const c3 = { contact_id: threadId, thread_id: threadId, instagram_username: who.ig, message_id: `${threadId}-c3`, text: `${who.name}, ${who.phone}, ${who.date}, ${who.time}`, received_at: '2026-07-23T21:02:00.000Z' }
        recordIngressEvent(root, c3)
        executeSingleControlTurn(c3, { root, authority_options: { structured_state_override: { form_submitted: true, form_link_sent: true, known_name_used_on_form: who.name, known_phone_used_on_form: who.phone, known_requested_date: who.date, known_requested_time: who.time, booking_stage_hint: 'ready_for_double_check' } }, candidateGenerator: (_m, opts) => mkCandidate(opts, { text: doubleCheckText(who) }) })
        // confirm -> deposit
        const c4 = { contact_id: threadId, thread_id: threadId, instagram_username: who.ig, message_id: `${threadId}-c4`, text: 'yes perfect', received_at: '2026-07-23T21:03:00.000Z' }
        recordIngressEvent(root, c4)
        const rD = executeSingleControlTurn(c4, { root, authority_options: { recent_history_override: [{ role: 'assistant', message_id: `${threadId}-dc`, text: doubleCheckText(who) }], structured_state_override: { form_submitted: true, form_link_sent: true, known_name_used_on_form: who.name, known_phone_used_on_form: who.phone, known_requested_date: who.date, known_requested_time: who.time, double_check_sent: true, live_turn_confirms_double_check: true } }, candidateGenerator: (_m, opts) => mkCandidate(opts, { text: DEPOSIT_TEXT }) })
        return { final: readControlState(root, threadId), depositAction: rD.authority.closed_transition_action }
      }
      const people = [
        { ig: 'run.one', name: 'Ada', phone: '4155550001', date: '7th of August', time: '2pm' },
        { ig: 'run.two', name: 'Bex', phone: '4155550002', date: '9th of August', time: '3pm' },
        { ig: 'run.three', name: 'Cyd', phone: '4155550003', date: '11th of August', time: '1pm' }
      ]
      const outcomes = people.map((p, i) => runOneBooking(`s9-run-${i + 1}`, p))
      check('s9_three_consecutive_completions_reach_deposit',
        outcomes.every((o) => o.depositAction === 'deposit_handoff' && o.final.deposit_requested === true),
        outcomes.map((o) => ({ action: o.depositAction, deposit: o.final.deposit_requested })))
      check('s9_isolated_state_no_cross_contamination',
        outcomes[0].final.known_name_used_on_form === 'Ada' &&
        outcomes[1].final.known_name_used_on_form === 'Bex' &&
        outcomes[2].final.known_name_used_on_form === 'Cyd' &&
        outcomes[0].final.known_requested_date === '7th of August' &&
        outcomes[1].final.known_requested_date === '9th of August' &&
        outcomes[2].final.known_requested_date === '11th of August',
        outcomes.map((o) => ({ name: o.final.known_name_used_on_form, date: o.final.known_requested_date })))
    }

    // ========================================================
    // SCENARIO 10 — adversarial paraphrase matrix on the REAL detector, so a
    // phrase-specific patch cannot pass while a paraphrase silently regresses.
    // Positive date proposals must bind day 26; non-calendar numerics must not.
    // (sealed: temporal_size_collision_policy)
    // ========================================================
    {
      const history = [{ role: 'assistant', message_id: 'a', text: AVAIL_ASK }]
      const st = { form_submitted: true, booking_stage_hint: 'awaiting_date' }
      const positives = ['How about 26?', 'the 26th', '26?', 'can you do 26', 'could you do the 26th', 'maybe 26', 'probably the 26th', 'does 26 work?', 'would the 26th work', 'how about the 26th?', 'on the 26th']
      const negatives = ['26 inches', '$26', 'age 26', "i'm 26 years old", '26:30', '26 people', 'about 26 bucks', '26 cm', '26%', 'that is a neat number', 'call me at 26']
      let posOk = 0
      const posMiss = []
      for (const t of positives) {
        const d = extractContextualBookingDayReply(t, st, history)
        if (d && d.day === 26) posOk += 1; else posMiss.push(t)
      }
      let negOk = 0
      const negLeak = []
      for (const t of negatives) {
        const d = extractContextualBookingDayReply(t, st, history)
        if (!d) negOk += 1; else negLeak.push({ t, d })
      }
      check('s10_all_date_paraphrases_bind_day_26', posMiss.length === 0, { posOk, posMiss })
      check('s10_no_noncalendar_numeric_leaks_into_date', negLeak.length === 0, { negOk, negLeak })
      // Adjacency guard: identical wording with NO open availability must not bind.
      const noAvail = extractContextualBookingDayReply('How about 26?', st, [{ role: 'assistant', text: 'hey good to hear from you' }])
      check('s10_no_binding_without_open_availability', noAvail === null, noAvail)
    }

    const ok = failures.length === 0
    const result = {
      ok,
      checked,
      failures,
      proof_mode: 'local_executed_path_harness_proof',
      seam: 'executeSingleControlTurn production semantic seam (the per-turn function inbox-worker.processLockedFile invokes) + real dm-authority detectors + inbox-worker disposition classifier; excludes live post3101/outbox/ManyChat transport',
      note: 'Local executed-path proof only. Not a visible Instagram receipt.'
    }
    if (!ok) {
      throw new Error(`scv_executed_path_booking_harness_failed:${JSON.stringify(result)}`)
    }
    return result
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch {}
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvExecutedPathBookingHarness(), null, 2))
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : (err && err.message ? err.message : err)))
    process.exit(1)
  }
}

module.exports = { runScvExecutedPathBookingHarness }
