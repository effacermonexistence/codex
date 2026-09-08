#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  SCV_CONTROL_EPOCH,
  CONTROL_RECEIPT_VERSION,
  DEFAULT_CONTROL_REAUTHOR_PASSES,
  CONTROL_REPAIR_LOOP_VERSION,
  deriveBookingStage,
  contextualBareBookingHourFrame,
  bindLiveControllerPacketMetadata,
  extractOfferedSlotsFromPacket,
  extractLatestOfferedSlotFromPacket,
  recoverGroundedDesignContextFromHistory,
  readControlState,
  reduceConversationState,
  recordIngressEvent,
  appendControlHistoryEvent,
  enrichControlHistoryUserEvent,
  commitControlDecision,
  readControlDecisionArtifact,
  repairTransportPacketFromDecisionArtifact,
  validateControlReceipt,
  executeSingleControlTurn,
  migrateAllThreadStates,
  quarantinePreSingleControlOutbox,
  ensureControlDirs
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  applyMediaContextToState
} = require(path.join(__dirname, 'dm-authority.js'))
const {
  PREFERRED_FORM_LINK
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  DETERMINISTIC_RECOVERY_VERSION,
  SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES,
  ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
  buildDeterministicRecoveryPacket,
  buildSafeClarificationRecoveryPacket
} = require(path.join(__dirname, 'scv-deterministic-recovery.js'))
const {
  buildDeterministicBookingPacket
} = require(path.join(__dirname, 'codex-dm-runner.js'))

const SCV_SINGLE_CONTROL_HARNESS_LOCK_VERSION = 'scv-single-control-harness-2026-08-29-v48-bare-hour-and-recovery-durability'

function runScvSingleControlPlaneHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-single-control-'))
  // This is a deterministic, network-free controller harness. Production may
  // require a real Responses API receipt, but the harness candidate generators
  // are deliberately local fixtures. Do not let an ambient production executor
  // flag silently change the meaning of this startup self-test.
  const responsesRequiredWasPresent = Object.prototype.hasOwnProperty.call(
    process.env,
    'SCV_OPENAI_RESPONSES_REQUIRED'
  )
  const responsesRequiredBefore = process.env.SCV_OPENAI_RESPONSES_REQUIRED
  process.env.SCV_OPENAI_RESPONSES_REQUIRED = '0'
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  try {
    ensureControlDirs(root)
    const threadId = 'single-control-thread-1'
    const stateFile = path.join(root, 'thread-state', `${threadId}.json`)
    fs.writeFileSync(stateFile, JSON.stringify({
      contact_id: threadId,
      thread_id: threadId,
      tattoo_intent_active: true,
      form_offer_asked: true,
      known_design_context: 'black and gray custom reference piece'
    }, null, 2) + '\n')

    const inbound = {
      contact_id: threadId,
      thread_id: threadId,
      instagram_username: 'single.control.test',
      message_id: 'single-control-message-1',
      text: 'would you want to meet up and discuss the tattoo?',
      text_source: 'manychat_webhook',
      received_at: '2026-07-10T20:00:00.000Z'
    }
    const ingress = recordIngressEvent(root, inbound)
    const afterIngress = readControlState(root, threadId)
    check('control_constants_exact',
      SCV_SINGLE_CONTROL_PLANE_ID === 'scv-single-control-plane-2026-07-12-v3-route-frozen-liveness' &&
      SCV_SINGLE_CONTROL_SOURCE === 'scv_single_control_plane' &&
      SCV_CONTROL_EPOCH === 'scv-control-epoch-2026-07-12-v3-route-frozen-liveness' &&
      CONTROL_RECEIPT_VERSION === 'scv-control-receipt-v2-payload-bound',
      JSON.stringify({ SCV_SINGLE_CONTROL_PLANE_ID, SCV_SINGLE_CONTROL_SOURCE, SCV_CONTROL_EPOCH, CONTROL_RECEIPT_VERSION }))
    check('legacy_semantic_state_survives_ingress',
      afterIngress.tattoo_intent_active === true &&
      afterIngress.form_offer_asked === true &&
      afterIngress.known_design_context === 'black and gray custom reference piece',
      JSON.stringify(afterIngress))
    check('ingress_is_owned_by_single_control',
      ingress.ingress_revision === 1 &&
      afterIngress.control_plane_id === SCV_SINGLE_CONTROL_PLANE_ID &&
      afterIngress.control_epoch === SCV_CONTROL_EPOCH,
      JSON.stringify({ ingress, afterIngress }))

    recordIngressEvent(root, inbound)
    const historyAfterDuplicate = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
    check('duplicate_ingress_history_is_idempotent',
      historyAfterDuplicate.events.filter((event) => event.message_id === inbound.message_id && event.role === 'user').length === 1,
      JSON.stringify(historyAfterDuplicate.events))

    const staleRecovery = {
      ...inbound,
      message_id: 'stale-recovery-message',
      text: 'older recovered input',
      recovered_via: 'manychat_subscriber_getinfo',
      received_at: '2026-07-10T19:00:00.000Z'
    }
    const staleIngress = recordIngressEvent(root, staleRecovery)
    const afterStale = readControlState(root, threadId)
    check('stale_recovery_cannot_replace_latest_ingress',
      staleIngress.became_latest === false && afterStale.latest_ingress_message_id === inbound.message_id,
      JSON.stringify({ staleIngress, afterStale }))
    check('stale_recovery_cannot_erase_semantic_latch',
      afterStale.tattoo_intent_active === true && afterStale.known_design_context === 'black and gray custom reference piece',
      JSON.stringify(afterStale))

    check('stage_reducer_ready_for_double_check', deriveBookingStage({
      known_name_used_on_form: 'Ben',
      known_phone_used_on_form: '4155550100',
      known_requested_date: '7th of August',
      known_requested_time: '2pm'
    }) === 'ready_for_double_check')
    const reduced = reduceConversationState({
      root,
      event: inbound,
      candidate: {},
      intentEvidence: { llm_intent_applied: true, live_turn_is_tattoo_intent: true }
    })
    check('llm_intent_is_adopted_monotonically_by_controller',
      reduced.llm_intent_applied === true && reduced.tattoo_intent_active === true,
      JSON.stringify(reduced))
    const allIntentFlags = reduceConversationState({
      root,
      event: inbound,
      candidate: {
        form_link_sent: true,
        last_offered_date: '7th of August',
        last_offered_time: '2pm'
      },
      intentEvidence: {
        llm_intent_applied: true,
        live_turn_form_consent: true,
        live_turn_explicit_form_request: true,
        live_turn_accepts_offered_slot: true,
        live_turn_form_submitted_signal: true,
        live_turn_deposit_sent: true,
        live_turn_pricing_question: true,
        live_turn_is_question: true,
        live_turn_declines: true
      }
    })
    check('all_live_intent_flags_cross_process_boundary',
      allIntentFlags.live_turn_form_consent === true &&
      allIntentFlags.live_turn_explicit_form_request === true &&
      allIntentFlags.live_turn_accepts_offered_slot === true &&
      allIntentFlags.live_turn_form_submitted_signal === true &&
      allIntentFlags.live_turn_deposit_sent === true &&
      allIntentFlags.live_turn_pricing_question === true &&
      allIntentFlags.live_turn_is_question === true &&
      allIntentFlags.live_turn_declines === true,
      JSON.stringify(allIntentFlags))

    const coarseWeekendFalseAcceptance = reduceConversationState({
      root,
      persisted: {
        contact_id: 'coarse-weekend-intent-floor',
        thread_id: 'coarse-weekend-intent-floor',
        form_offer_asked: true,
        form_link_sent: true,
        booking_stage_hint: 'awaiting_form_submission',
        next_action: 'post_form_availability',
        minimum_booking_date_local: 'September 5, 2026',
        close_booking_options_local: [
          'september 5 (saturday) at 2pm',
          'september 6 (sunday) at 2pm',
          'september 7 (monday) at 2pm'
        ]
      },
      candidate: {
        live_turn_accepts_offered_slot: true,
        live_turn_accepted_offered_date: 'september 5',
        live_turn_accepted_offered_time: '2pm'
      },
      event: {
        contact_id: 'coarse-weekend-intent-floor',
        thread_id: 'coarse-weekend-intent-floor',
        message_id: 'coarse-weekend-intent-floor-message',
        text: "OK then let's do weekend"
      },
      intentEvidence: {
        llm_intent_applied: true,
        live_turn_accepts_offered_slot: true
      }
    })
    check(
      'coarse_weekend_constraint_cannot_cross_as_llm_slot_acceptance',
      coarseWeekendFalseAcceptance.live_turn_accepts_offered_slot === false &&
        !String(coarseWeekendFalseAcceptance.live_turn_accepted_offered_date || '').trim() &&
        !String(coarseWeekendFalseAcceptance.live_turn_accepted_offered_time || '').trim() &&
        !String(coarseWeekendFalseAcceptance.known_requested_date || '').trim() &&
        !String(coarseWeekendFalseAcceptance.known_requested_time || '').trim(),
      JSON.stringify(coarseWeekendFalseAcceptance)
    )

    const legalDateProposal = reduceConversationState({
      root,
      persisted: {
        contact_id: 'legal-date-thread',
        thread_id: 'legal-date-thread',
        form_link_sent: true,
        form_submitted: true,
        last_offered_date: '26th of July',
        last_offered_time: '2pm'
      },
      candidate: {
        form_link_sent: true,
        form_submitted: true,
        live_turn_date_phrase: '25th of July',
        live_turn_date_status: 'legal',
        preferred_time_primary: '2pm'
      },
      event: {
        contact_id: 'legal-date-thread',
        thread_id: 'legal-date-thread',
        message_id: 'legal-date-message',
        text: 'sent a voice note saying: How about 25th of July?'
      }
    })
    check('controller_persists_legal_post_form_date_without_inventing_time',
      legalDateProposal.known_requested_date === '25th of July' &&
      !String(legalDateProposal.known_requested_time || '').trim() &&
      legalDateProposal.booking_stage_hint === 'awaiting_time',
      JSON.stringify(legalDateProposal))

    const legalDateReplacesStaleSlot = reduceConversationState({
      root,
      persisted: {
        contact_id: 'legal-date-replaces-stale-slot',
        thread_id: 'legal-date-replaces-stale-slot',
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Omar System',
        known_phone_used_on_form: '4155550199',
        known_requested_date: 'august 27',
        known_requested_time: '2pm',
        accepted_offered_date: 'august 1',
        accepted_offered_time: '2pm',
        last_offered_date: 'august 1',
        last_offered_time: '2pm'
      },
      candidate: {
        form_link_sent: true,
        form_submitted: true,
        live_turn_date_phrase: '15th of August',
        live_turn_date_status: 'legal'
      },
      event: {
        contact_id: 'legal-date-replaces-stale-slot',
        thread_id: 'legal-date-replaces-stale-slot',
        message_id: 'legal-date-replaces-stale-slot-message',
        text: 'OK, then can we do 15th of August?'
      },
      intentEvidence: {
        // Hostile classifier false-positive: the current date remains a
        // counterproposal rather than acceptance of August 1 at 2pm.
        live_turn_accepts_offered_slot: true
      }
    })
    check('controller_legal_date_replaces_stale_date_time_and_false_slot_acceptance',
      legalDateReplacesStaleSlot.known_requested_date === '15th of August' &&
      !String(legalDateReplacesStaleSlot.known_requested_time || '').trim() &&
      !String(legalDateReplacesStaleSlot.accepted_offered_date || '').trim() &&
      !String(legalDateReplacesStaleSlot.accepted_offered_time || '').trim() &&
      legalDateReplacesStaleSlot.live_turn_accepts_offered_slot === false &&
      legalDateReplacesStaleSlot.booking_stage_hint === 'awaiting_time',
      JSON.stringify(legalDateReplacesStaleSlot))

    const explicitTimeCounterproposal = reduceConversationState({
      root,
      persisted: {
        contact_id: 'time-counterproposal-thread',
        thread_id: 'time-counterproposal-thread',
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Omar Replay',
        known_phone_used_on_form: '4155550198',
        known_requested_date: '22nd of August',
        last_offered_date: '22nd of August',
        last_offered_time: '2pm'
      },
      candidate: {
        form_link_sent: true,
        form_submitted: true,
        known_requested_date: '22nd of August',
        known_requested_time: '1:00pm',
        last_offered_date: '22nd of August',
        last_offered_time: '2pm',
        live_turn_accepts_offered_slot: false,
        live_turn_time_phrase: '1:00pm'
      },
      event: {
        contact_id: 'time-counterproposal-thread',
        thread_id: 'time-counterproposal-thread',
        message_id: 'time-counterproposal-message',
        text: '1pm works for me'
      },
      intentEvidence: {
        // Hostile classifier false-positive: current explicit time must still win.
        live_turn_accepts_offered_slot: true
      }
    })
    check('controller_current_explicit_time_overrides_stale_offer_and_false_acceptance',
      explicitTimeCounterproposal.known_requested_date === '22nd of August' &&
      explicitTimeCounterproposal.known_requested_time === '1pm' &&
      explicitTimeCounterproposal.live_turn_accepts_offered_slot === false &&
      !String(explicitTimeCounterproposal.accepted_offered_time || '').trim() &&
      explicitTimeCounterproposal.booking_stage_hint === 'ready_for_double_check',
      JSON.stringify(explicitTimeCounterproposal))

    const tooSoonDateProposal = reduceConversationState({
      root,
      persisted: {
        contact_id: 'too-soon-date-thread',
        thread_id: 'too-soon-date-thread',
        form_link_sent: true,
        form_submitted: true,
        last_offered_date: '25th of July',
        last_offered_time: '2pm'
      },
      candidate: {
        form_link_sent: true,
        form_submitted: true,
        live_turn_date_phrase: '18th of July',
        live_turn_date_status: 'too_soon'
      },
      event: {
        contact_id: 'too-soon-date-thread',
        thread_id: 'too-soon-date-thread',
        message_id: 'too-soon-date-message',
        text: 'sent a voice note saying: How about 18th of July?'
      }
    })
    check('controller_does_not_persist_out_of_window_date_counterproposal',
      !String(tooSoonDateProposal.known_requested_date || '').trim() &&
      !String(tooSoonDateProposal.known_requested_time || '').trim(),
      JSON.stringify(tooSoonDateProposal))

    const contaminatedTooSoonDateProposal = reduceConversationState({
      root,
      persisted: {
        contact_id: 'contaminated-too-soon-date-thread',
        thread_id: 'contaminated-too-soon-date-thread',
        form_link_sent: true,
        form_submitted: true,
        known_requested_date: '18th',
        known_requested_time: '2pm',
        last_offered_date: '25th of July',
        last_offered_time: '2pm'
      },
      candidate: {
        form_link_sent: true,
        form_submitted: true,
        known_requested_date: '18th',
        known_requested_time: '2pm',
        last_offered_date: '25th of July',
        last_offered_time: '2pm',
        live_turn_date_phrase: '18th of July',
        live_turn_date_status: 'too_soon'
      },
      event: {
        contact_id: 'contaminated-too-soon-date-thread',
        thread_id: 'contaminated-too-soon-date-thread',
        message_id: 'contaminated-too-soon-date-message',
        text: 'sent a voice note saying: How about 18th of July?'
      }
    })
    check('controller_purges_history_contaminated_out_of_window_date_and_preserves_last_offer',
      !String(contaminatedTooSoonDateProposal.known_requested_date || '').trim() &&
      !String(contaminatedTooSoonDateProposal.known_requested_time || '').trim() &&
      contaminatedTooSoonDateProposal.last_offered_date === '25th of July' &&
      contaminatedTooSoonDateProposal.last_offered_time === '2pm',
      JSON.stringify(contaminatedTooSoonDateProposal))

    // Live regression 2026-07-12: ManyChat exposed a voice note as a CDN URL. The
    // orphan packet correctly entered as "sent a reference post", authority resolved
    // it to "Hi, can I please get more information?", but the final controller kept
    // verifying the fallback label and demanded a form offer. That impossible route
    // retried forever. Verification must consume the authority-observed transcript.
    const voiceThread = 'single-control-voice-media-info'
    const voiceInbound = {
      contact_id: voiceThread,
      thread_id: voiceThread,
      instagram_username: 'omar.system',
      message_id: 'voice-media-info-1',
      text: 'sent a reference post',
      media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset=voice-info'],
      received_at: '2026-07-12T21:37:59.000Z'
    }
    recordIngressEvent(root, voiceInbound)
    const resolvedVoiceText = 'sent a voice note saying: Hi, can I please get more information?'
    enrichControlHistoryUserEvent(root, voiceInbound, resolvedVoiceText)
    const voiceResult = executeSingleControlTurn(voiceInbound, {
      root,
      candidateGenerator: (_msg, opts) => ({
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'resolved voice info candidate',
        packet: {
          bubbles: [
            { text: 'hii yeah of course the model spot means i build the tattoo around what you want while it stays in my style' },
            { text: 'i can tell you more about it' },
            { text: 'you can check out my profile and the highlights for some inspo too' },
            { text: 'custom stuff is totally cool so just send me any idea or vibe you are thinking about' }
          ]
        },
        structured_state: {
          ...opts.structured_state_override,
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true,
          live_turn_is_voice_note: true,
          live_turn_is_media_reference: false,
          live_turn_is_media_only_no_content: false,
          live_turn_text: resolvedVoiceText,
          known_reference_media_received: false,
          known_design_context: '',
          booking_stage_hint: 'design_intake'
        },
        intent_adoption_state: {
          llm_intent_applied: true,
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true
        },
        recent_history: [{ role: 'user', message_id: voiceInbound.message_id, text: resolvedVoiceText }],
        media_context_resolved: true,
        authority_observed_live_turn_text: resolvedVoiceText
      })
    })
    check('resolved_voice_info_verifies_as_design_intake_not_form_offer',
      voiceResult.authority?.closed_transition_action === 'design_intake' &&
      voiceResult.packet?.bubbles?.some((bubble) => /idea or vibe/i.test(String(bubble?.text || ''))),
      JSON.stringify({ authority: voiceResult.authority, packet: voiceResult.packet }))

    // Live full-funnel attempt regression 2026-07-19: "more info about booking a
    // tattoo" was copied into known_design_context, promoted to OFFER_FORM, and
    // shipped a premature form question. The first candidate below reproduces
    // both the false state and false visible move. The one-way controller must
    // quarantine the state, reject the packet, and keep the repair on DESIGN_INTAKE.
    const genericBookingThread = 'single-control-generic-booking-info'
    const genericBookingInbound = {
      contact_id: genericBookingThread,
      thread_id: genericBookingThread,
      instagram_username: 'omar.system',
      message_id: 'generic-booking-info-1',
      text: 'Hey, can I get more info about booking a tattoo?',
      received_at: '2026-07-19T23:00:00.000Z'
    }
    recordIngressEvent(root, genericBookingInbound)
    let genericBookingCalls = 0
    const genericBookingResult = executeSingleControlTurn(genericBookingInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        genericBookingCalls += 1
        const contaminatedState = {
          ...opts.structured_state_override,
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true,
          live_turn_gave_design_idea: true,
          known_design_context: genericBookingInbound.text,
          form_offer_asked: true,
          booking_stage_hint: 'awaiting_form_permission_answer'
        }
        if (genericBookingCalls === 1) {
          return {
            source: 'codex_exec_dm_authority',
            authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
            raw_text: 'premature generic booking form offer',
            packet: { bubbles: [{ text: 'want me to send the form so you can get started?' }] },
            structured_state: contaminatedState,
            intent_adoption_state: {
              llm_intent_applied: true,
              tattoo_intent_active: true,
              live_turn_is_tattoo_intent: true,
              live_turn_gave_design_idea: true
            },
            recent_history: [{ role: 'user', message_id: genericBookingInbound.message_id, text: genericBookingInbound.text }]
          }
        }
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'generic booking design intake repair',
          packet: { bubbles: [
            { text: 'hii yeah of course the model spot means i build the tattoo around what you want while it stays in my style' },
            { text: 'i can walk you through it' },
            { text: 'you can check out my profile and the highlights for some flash inspo too' },
            { text: 'custom stuff is totally cool so send me any subject idea or vibe you are leaning toward' }
          ] },
          structured_state: contaminatedState,
          intent_adoption_state: {
            llm_intent_applied: true,
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            live_turn_gave_design_idea: true
          },
          recent_history: [{ role: 'user', message_id: genericBookingInbound.message_id, text: genericBookingInbound.text }]
        }
      }
    })
    check('generic_booking_info_cannot_create_design_or_form_stage',
      genericBookingCalls === 2 &&
      genericBookingResult.authority?.closed_transition_action === 'design_intake' &&
      !String(genericBookingResult.structured_state?.known_design_context || '').trim() &&
      genericBookingResult.structured_state?.live_turn_gave_design_idea !== true &&
      genericBookingResult.structured_state?.form_offer_asked !== true &&
      !/send the form/i.test(String(genericBookingResult.packet?.bubbles?.map((bubble) => bubble.text).join(' ') || '')),
      JSON.stringify({ calls: genericBookingCalls, authority: genericBookingResult.authority, state: genericBookingResult.structured_state, packet: genericBookingResult.packet }))

    // Live Omar.system regression 2026-07-25: asking "do you also do black and
    // gray?" was mistaken for a completed design because a style token doubled
    // as the concrete-design detector. That prematurely consumed the one-shot
    // form offer; the later real portrait brief then collided with the one-shot
    // verifier and produced no visible reply. Lock the two-turn causal path.
    const capabilityThread = 'single-control-capability-before-design'
    const capabilityInbound = {
      contact_id: capabilityThread,
      thread_id: capabilityThread,
      instagram_username: 'omar.system',
      message_id: 'capability-before-design-1',
      text: 'do you also do black and gray?',
      received_at: '2026-07-25T11:21:45.000Z'
    }
    recordIngressEvent(root, capabilityInbound)
    let capabilityCalls = 0
    const capabilityTurn = executeSingleControlTurn(capabilityInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        capabilityCalls += 1
        const contaminatedState = {
          ...opts.structured_state_override,
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true,
          live_turn_gave_design_idea: true,
          known_design_context: capabilityInbound.text,
          form_offer_asked: true,
          booking_stage_hint: 'awaiting_form_permission_answer'
        }
        if (capabilityCalls === 1) {
          return {
            source: 'codex_exec_dm_authority',
            authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
            raw_text: 'premature capability form offer',
            packet: { bubbles: [
              { text: 'yeah i do black and gray too' },
              { text: 'want me to send the form so we can start locking it in?' }
            ] },
            structured_state: contaminatedState,
            intent_adoption_state: {
              tattoo_intent_active: true,
              live_turn_is_tattoo_intent: true,
              live_turn_gave_design_idea: true
            },
            recent_history: []
          }
        }
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'capability answered and design requested',
          packet: { bubbles: [
            { text: 'yeah i do black and gray too' },
            { text: 'what subject or reference are you thinking about?' }
          ] },
          structured_state: contaminatedState,
          intent_adoption_state: {
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            live_turn_gave_design_idea: true
          },
          recent_history: []
        }
      }
    })
    check('capability_question_cannot_consume_form_gate_or_design_memory',
      capabilityCalls === 2 &&
      capabilityTurn.authority?.closed_transition_action === 'design_intake' &&
      capabilityTurn.authority?.closed_transition_obligations?.includes('answer_tattoo_capability_scope') &&
      !String(capabilityTurn.structured_state?.known_design_context || '').trim() &&
      capabilityTurn.structured_state?.form_offer_asked !== true,
      JSON.stringify({ calls: capabilityCalls, authority: capabilityTurn.authority, state: capabilityTurn.structured_state, packet: capabilityTurn.packet }))

    const portraitBrief = 'I want a black and gray portrait of a woman with a soft surreal feel, around 6 inches on my upper arm. I want it detailed but not too dark.'
    const portraitInbound = {
      contact_id: capabilityThread,
      thread_id: capabilityThread,
      instagram_username: 'omar.system',
      message_id: 'capability-before-design-2',
      text: portraitBrief,
      received_at: '2026-07-25T11:22:27.000Z'
    }
    recordIngressEvent(root, portraitInbound)
    const portraitTurn = executeSingleControlTurn(portraitInbound, {
      root,
      candidateGenerator: (_msg, opts) => ({
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'real portrait brief opens form once',
        packet: { bubbles: [
          { text: 'yeah the softer black and gray portrait direction around 6 inches on the upper arm makes sense, we can dial the exact placement and sizing in person' },
          { text: 'want me to send the application form?' }
        ] },
        structured_state: {
          ...opts.structured_state_override,
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true,
          live_turn_gave_design_idea: true,
          known_design_context: portraitBrief,
          known_placement_context: 'upper arm',
          known_size_context: 'around 6 inches'
        },
        intent_adoption_state: {
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true,
          live_turn_gave_design_idea: true
        },
        recent_history: [
          { role: 'assistant', text: 'yeah i do black and gray too' },
          { role: 'assistant', text: 'what subject or reference are you thinking about?' }
        ]
      })
    })
    check('real_design_after_capability_opens_form_exactly_once_without_silence',
      portraitTurn.authority?.closed_transition_action === 'offer_form' &&
      portraitTurn.structured_state?.known_design_context === portraitBrief &&
      portraitTurn.structured_state?.form_offer_asked === true &&
      portraitTurn.packet?.bubbles?.filter((bubble) => /form/i.test(String(bubble?.text || ''))).length === 1,
      JSON.stringify({ authority: portraitTurn.authority, state: portraitTurn.structured_state, packet: portraitTurn.packet }))

    // Live Omar.system regression 2026-08-23: the user supplied a concrete
    // portrait/reference before the form, but the legacy state omitted durable
    // design memory. The post-form reply visibly offered dates while persisted
    // state regressed to awaiting_design_direction. Recover only the concrete
    // user-authored reference so the next date-selection turn remains in funnel.
    const postFormMemoryThread = 'single-control-post-form-history-design-memory'
    fs.writeFileSync(path.join(root, 'thread-state', `${postFormMemoryThread}.json`), JSON.stringify({
      contact_id: postFormMemoryThread,
      thread_id: postFormMemoryThread,
      tattoo_intent_active: true,
      form_offer_asked: true,
      form_link_sent: true
    }, null, 2) + '\n')
    const concreteReferenceText = 'sent a reference post: A portrait photo showing a man with face tattoos, glasses, and jewelry lying down.'
    appendControlHistoryEvent(root, {
      contact_id: postFormMemoryThread,
      thread_id: postFormMemoryThread,
      message_id: 'post-form-memory-reference',
      text: concreteReferenceText
    }, 'user', { at: '2026-08-23T23:16:52.000Z' })
    appendControlHistoryEvent(root, {
      contact_id: postFormMemoryThread,
      thread_id: postFormMemoryThread,
      message_id: 'post-form-memory-generic-pointer',
      text: "I'm thinking of this one"
    }, 'user', { at: '2026-08-23T23:16:48.000Z' })
    const recoveredDesign = recoverGroundedDesignContextFromHistory(root, postFormMemoryThread)
    const postFormMemoryState = reduceConversationState({
      root,
      persisted: readControlState(root, postFormMemoryThread),
      candidate: {
        form_link_sent: true,
        form_submitted: true,
        live_turn_form_submitted_signal: true
      },
      event: {
        contact_id: postFormMemoryThread,
        thread_id: postFormMemoryThread,
        message_id: 'post-form-memory-submit',
        text: 'I just submit it'
      },
      intentEvidence: {
        live_turn_form_submitted_signal: true
      }
    })
    check('post_form_recovers_concrete_user_reference_not_generic_pointer',
      recoveredDesign === concreteReferenceText &&
      postFormMemoryState.known_design_context === concreteReferenceText &&
      deriveBookingStage(postFormMemoryState) === 'awaiting_date' &&
      postFormMemoryState.next_action === 'post_form_availability',
      JSON.stringify({ recoveredDesign, state: postFormMemoryState }))

    // Live Omar.system regression 2026-07-19: the authority resolver correctly
    // transcribed a voice note as "I'm thinking of something like this", but the
    // single controller reduced the stale transport label "sent a reference post".
    // That erased the structural missing-attachment state and let an unseen-content
    // evaluation ("oh nice that's a good start") ship as DESIGN_INTAKE. The
    // authority-resolved atomic live turn must own state reduction, route lock, and
    // final verification even when the runner skipped its optional intent classifier.
    const resolvedPointerThread = 'single-control-resolved-voice-missing-reference'
    fs.writeFileSync(path.join(root, 'thread-state', `${resolvedPointerThread}.json`), JSON.stringify({
      contact_id: resolvedPointerThread,
      thread_id: resolvedPointerThread,
      tattoo_intent_active: true
    }, null, 2) + '\n')
    appendControlHistoryEvent(root, {
      contact_id: resolvedPointerThread,
      thread_id: resolvedPointerThread,
      message_id: 'resolved-pointer-prior-assistant',
      bubble_index: 0,
      bubble: { text: 'anything in my highlights or posts catching your eye so far?' }
    }, 'assistant', { at: '2026-07-19T22:08:48.550Z' })
    const resolvedPointerInbound = {
      contact_id: resolvedPointerThread,
      thread_id: resolvedPointerThread,
      instagram_username: 'omar.system',
      message_id: 'resolved-pointer-live-message',
      text: 'sent a reference post',
      media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset=voice-pointer'],
      received_at: '2026-07-19T22:12:17.640Z'
    }
    recordIngressEvent(root, resolvedPointerInbound)
    const resolvedPointerText = "sent a voice note saying: I'm thinking of something like this."
    enrichControlHistoryUserEvent(root, resolvedPointerInbound, resolvedPointerText)
    let resolvedPointerCalls = 0
    const resolvedPointerResult = executeSingleControlTurn(resolvedPointerInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        resolvedPointerCalls += 1
        const base = {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            live_turn_is_voice_note: true,
            live_turn_is_media_reference: false,
            live_turn_text: resolvedPointerText,
            known_reference_media_received: false,
            booking_stage_hint: 'design_intake'
          },
          // The media resolver already classified intent, so production skipped
          // the optional runner classifier. Structural context must still cross.
          intent_adoption_state: {
            llm_intent_applied: true,
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            context_classifier_applied: false
          },
          recent_history: [{
            role: 'assistant',
            text: 'anything in my highlights or posts catching your eye so far?'
          }],
          media_context_resolved: true,
          authority_observed_live_turn_text: resolvedPointerText
        }
        if (resolvedPointerCalls === 1) {
          return {
            ...base,
            raw_text: 'hallucinated unseen-reference acceptance',
            packet: { bubbles: [
              { text: 'oh nice that\u2019s a good start' },
              { text: 'can you tell me a bit more about what you\u2019re feeling for with it?' }
            ] }
          }
        }
        return {
          ...base,
          raw_text: 'authority-resolved clarification repair',
          packet: { bubbles: [{ text: 'wait something like what? send me the photo or link so i can actually see it' }] }
        }
      }
    })
    check('authority_resolved_atomic_turn_owns_controller_route_without_optional_classifier',
      resolvedPointerResult.authority?.closed_transition_action === 'resolve_context' &&
      resolvedPointerResult.authority?.closed_transition_reason === 'missing_attachment',
      JSON.stringify({ authority: resolvedPointerResult.authority, state: resolvedPointerResult.structured_state }))
    check('unseen_reference_acceptance_is_rejected_then_reauthored',
      resolvedPointerCalls === 2 &&
      resolvedPointerResult.authority?.control_candidate_passes === 2 &&
      /photo|link/i.test(String(resolvedPointerResult.packet?.bubbles?.[0]?.text || '')) &&
      !/good start|nice|what.*feeling.*with it/i.test(String(resolvedPointerResult.raw_text || '')),
      JSON.stringify({ resolvedPointerCalls, authority: resolvedPointerResult.authority, packet: resolvedPointerResult.packet }))

    // Exact live production regression 2026-07-21. Instagram transported every
    // voice note as "sent a reference post"; ASR replaced the visible text but
    // retained `reference_post...media_context_enriched` in text_source. The
    // history resolver treated that ancestry as an image, so "I'm thinking of
    // this one" was falsely accepted and old deposit state authored a second
    // bubble. The current voice transcript has no visual referent. Source residue
    // and completed booking memory must both lose to the live missing attachment.
    const voiceVisualContaminationThread = 'single-control-voice-source-cannot-be-visual'
    fs.writeFileSync(path.join(root, 'thread-state', `${voiceVisualContaminationThread}.json`), JSON.stringify({
      contact_id: voiceVisualContaminationThread,
      thread_id: voiceVisualContaminationThread,
      tattoo_intent_active: true,
      known_design_context: 'pomegranate branch on the ribs around seven inches',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Omar Test Five',
      known_phone_used_on_form: '4155550199',
      known_requested_date: 'July 22',
      known_requested_time: '1pm',
      double_check_sent: true,
      deposit_requested: true,
      booking_stage_hint: 'deposit_requested'
    }, null, 2) + '\n')
    const contaminatedSource = 'reference_post.message_text|single_control_media_context_enriched|authority_media_context_enriched'
    appendControlHistoryEvent(root, {
      contact_id: voiceVisualContaminationThread,
      thread_id: voiceVisualContaminationThread,
      message_id: 'voice-source-info',
      text: 'sent a voice note saying: Hey, can I please get more information?',
      received_at: '2026-07-21T05:30:39.683Z'
    }, 'user', { text_source: contaminatedSource })
    appendControlHistoryEvent(root, {
      contact_id: voiceVisualContaminationThread,
      thread_id: voiceVisualContaminationThread,
      message_id: 'voice-source-info-reply',
      bubble_index: 0,
      bubble: { text: 'you can check my highlights and send me anything that catches your eye' }
    }, 'assistant', { at: '2026-07-21T05:30:45.000Z' })
    appendControlHistoryEvent(root, {
      contact_id: voiceVisualContaminationThread,
      thread_id: voiceVisualContaminationThread,
      message_id: 'voice-source-compliment',
      text: 'sent a voice note saying: I love your style.',
      received_at: '2026-07-21T05:31:00.192Z'
    }, 'user', { text_source: contaminatedSource })
    appendControlHistoryEvent(root, {
      contact_id: voiceVisualContaminationThread,
      thread_id: voiceVisualContaminationThread,
      message_id: 'voice-source-compliment-reply',
      bubble_index: 0,
      bubble: { text: 'did anything in the highlights or flashes pull you in?' }
    }, 'assistant', { at: '2026-07-21T05:31:08.000Z' })
    const contaminatedVoiceInbound = {
      contact_id: voiceVisualContaminationThread,
      thread_id: voiceVisualContaminationThread,
      instagram_username: 'omar.system',
      message_id: '1784611892434-regression',
      text: 'sent a reference post',
      text_source: 'reference_post.message_text',
      media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset=voice-no-image'],
      received_at: '2026-07-21T05:31:32.435Z'
    }
    recordIngressEvent(root, contaminatedVoiceInbound)
    const contaminatedVoiceResolvedText = "sent a voice note saying: I'm thinking of this one."
    enrichControlHistoryUserEvent(root, contaminatedVoiceInbound, contaminatedVoiceResolvedText)
    const contaminatedHistory = [
      { role: 'user', text: 'sent a voice note saying: Hey, can I please get more information?', text_source: contaminatedSource },
      { role: 'assistant', text: 'you can check my highlights and send me anything that catches your eye' },
      { role: 'user', text: 'sent a voice note saying: I love your style.', text_source: contaminatedSource },
      { role: 'assistant', text: 'did anything in the highlights or flashes pull you in?' },
      { role: 'user', text: contaminatedVoiceResolvedText, text_source: contaminatedSource }
    ]
    let contaminatedVoiceCalls = 0
    const contaminatedVoiceResult = executeSingleControlTurn(contaminatedVoiceInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        contaminatedVoiceCalls += 1
        const base = {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          structured_state: {
            ...opts.structured_state_override,
            live_turn_is_voice_note: true,
            live_turn_is_media_reference: false,
            live_turn_text: contaminatedVoiceResolvedText,
            deposit_requested: true
          },
          intent_adoption_state: {
            llm_intent_applied: true,
            context_classifier_applied: true,
            live_turn_context_missing: false,
            live_turn_context_missing_attachment: false,
            live_turn_context_resolved_from_history: true,
            live_turn_context_relation: 'resolved_from_history',
            live_turn_context_confidence: 'high',
            live_turn_context_resolution_source: 'llm_history_resolution_claim',
            live_turn_context_reason_code: 'claimed_prior_reference',
            live_turn_context_antecedent_quote: 'I love your style'
          },
          recent_history: contaminatedHistory,
          media_context_resolved: true,
          authority_observed_live_turn_text: contaminatedVoiceResolvedText
        }
        if (contaminatedVoiceCalls === 1) {
          return {
            ...base,
            raw_text: 'false image acceptance plus stale deposit continuation',
            packet: { bubbles: [
              { text: 'that sounds like a solid choice' },
              { text: 'the deposit info is all with you now so just lmk when you send it' }
            ] }
          }
        }
        return {
          ...base,
          raw_text: 'request the actual unseen reference',
          packet: { bubbles: [{ text: 'wait which one do you mean? send me the pic or post so i can actually see it' }] }
        }
      }
    })
    const contaminatedVoiceVisible = contaminatedVoiceResult.packet.bubbles.map((bubble) => bubble.text).join('\n')
    check('voice_reference_post_source_residue_cannot_resolve_unseen_visual_pointer',
      contaminatedVoiceResult.authority?.control_route_frozen === true &&
      contaminatedVoiceResult.authority?.closed_transition_reason === 'missing_attachment',
      JSON.stringify(contaminatedVoiceResult.authority))
    check('missing_visual_pointer_outranks_completed_deposit_memory_in_one_way_controller',
      contaminatedVoiceResult.authority?.closed_transition_action === 'resolve_context' &&
      contaminatedVoiceResult.structured_state?.deposit_requested === true &&
      contaminatedVoiceResult.structured_state?.booking_stage_hint === 'deposit_requested',
      JSON.stringify({ authority: contaminatedVoiceResult.authority, state: contaminatedVoiceResult.structured_state }))
    check('false_solid_choice_and_stale_deposit_copy_are_rejected_before_visible_send',
      contaminatedVoiceCalls === 2 &&
      /pic|post/i.test(contaminatedVoiceVisible) &&
      !/solid choice|deposit info|when you send it/i.test(contaminatedVoiceVisible),
      JSON.stringify({ contaminatedVoiceCalls, packet: contaminatedVoiceResult.packet }))

    // Open-vocabulary/ASR variant: this wording intentionally falls outside the
    // structural phrase matrix. The media helper's bounded semantic relation must
    // survive its process boundary and own the exact same controller route.
    const inductivePointerThread = 'single-control-inductive-voice-missing-reference'
    fs.writeFileSync(path.join(root, 'thread-state', `${inductivePointerThread}.json`), JSON.stringify({
      contact_id: inductivePointerThread,
      thread_id: inductivePointerThread,
      tattoo_intent_active: true
    }, null, 2) + '\n')
    const inductivePointerInbound = {
      contact_id: inductivePointerThread,
      thread_id: inductivePointerThread,
      instagram_username: 'omar.system',
      message_id: 'inductive-pointer-live-message',
      text: 'sent a reference post',
      media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset=voice-inductive-pointer'],
      received_at: '2026-07-19T22:13:17.640Z'
    }
    recordIngressEvent(root, inductivePointerInbound)
    const inductivePointerText = 'sent a voice note saying: the thing i was trying to show you'
    enrichControlHistoryUserEvent(root, inductivePointerInbound, inductivePointerText)
    let inductivePointerCalls = 0
    const inductivePointerResult = executeSingleControlTurn(inductivePointerInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        inductivePointerCalls += 1
        const base = {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            live_turn_is_voice_note: true,
            live_turn_is_media_reference: false,
            live_turn_text: inductivePointerText
          },
          intent_adoption_state: {
            llm_intent_applied: true,
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            context_classifier_applied: true,
            live_turn_context_missing: true,
            live_turn_context_missing_attachment: true,
            live_turn_reference_pointer_without_media: true,
            live_turn_context_relation: 'missing_attachment',
            live_turn_context_confidence: 'high',
            live_turn_context_resolution_source: 'llm_inductive_classifier',
            live_turn_context_reason_code: 'deictic_unseen_object',
            live_turn_context_antecedent_quote: ''
          },
          recent_history: [],
          media_context_resolved: true,
          authority_observed_live_turn_text: inductivePointerText
        }
        if (inductivePointerCalls === 1) {
          return {
            ...base,
            raw_text: 'inductive unseen-reference acceptance',
            packet: { bubbles: [{ text: 'yeah i like where that is heading' }] }
          }
        }
        return {
          ...base,
          raw_text: 'inductive missing-reference clarification',
          packet: { bubbles: [{ text: 'wait send me the pic or link you mean so i can actually see it' }] }
        }
      }
    })
    check('classifier_only_missing_referent_owns_outer_controller_route',
      inductivePointerResult.authority?.closed_transition_action === 'resolve_context' &&
      inductivePointerResult.authority?.closed_transition_reason === 'missing_attachment',
      JSON.stringify(inductivePointerResult.authority))
    check('classifier_only_unseen_acceptance_is_rejected_before_send',
      inductivePointerCalls === 2 &&
      inductivePointerResult.authority?.control_candidate_passes === 2 &&
      /pic|link/i.test(String(inductivePointerResult.packet?.bubbles?.[0]?.text || '')) &&
      !/like where.*heading/i.test(String(inductivePointerResult.raw_text || '')),
      JSON.stringify({ inductivePointerCalls, authority: inductivePointerResult.authority, packet: inductivePointerResult.packet }))

    // Live E2E regression 2026-07-19: the first unresolved direction correctly
    // routed to missing_attachment, but the candidate also wrote that same
    // unresolved sentence into known_design_context.  The next open-vocabulary
    // pointer inherited the fabricated design fact and advanced to OFFER_FORM.
    // Missing context must quarantine all candidate-authored durable funnel state,
    // then remain unresolved across paraphrases until real media or a self-contained
    // design brief arrives.
    const contaminationThread = 'single-control-unresolved-state-contamination'
    fs.writeFileSync(path.join(root, 'thread-state', `${contaminationThread}.json`), JSON.stringify({
      contact_id: contaminationThread,
      thread_id: contaminationThread,
      tattoo_intent_active: true
    }, null, 2) + '\n')

    const firstContaminationInbound = {
      contact_id: contaminationThread,
      thread_id: contaminationThread,
      instagram_username: 'omar.system',
      message_id: 'unresolved-contamination-first',
      text: 'I want something in that direction',
      received_at: '2026-07-19T22:35:50.790Z'
    }
    recordIngressEvent(root, firstContaminationInbound)
    let firstContaminationCalls = 0
    const firstContaminationResult = executeSingleControlTurn(firstContaminationInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        firstContaminationCalls += 1
        const base = {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            live_turn_gave_design_idea: true,
            known_design_context: firstContaminationInbound.text,
            form_offer_asked: true,
            booking_stage_hint: 'awaiting_form_permission_answer'
          },
          intent_adoption_state: {
            llm_intent_applied: true,
            tattoo_intent_active: true,
            live_turn_gave_design_idea: true,
            context_classifier_applied: true,
            live_turn_context_missing: true,
            live_turn_context_missing_attachment: true,
            live_turn_reference_pointer_without_media: true,
            live_turn_context_relation: 'missing_attachment',
            live_turn_context_confidence: 'high',
            live_turn_context_resolution_source: 'structural_floor'
          },
          recent_history: []
        }
        if (firstContaminationCalls === 1) {
          return {
            ...base,
            raw_text: 'polluted direction acceptance and form advance',
            packet: { bubbles: [
              { text: 'yeah i get that direction for sure' },
              { text: 'want me to send the form so we can confirm a day?' }
            ] }
          }
        }
        return {
          ...base,
          raw_text: 'request actual unresolved reference',
          packet: { bubbles: [{ text: 'wait what are you pointing to exactly? could you send the actual photo or reference?' }] }
        }
      }
    })
    check('missing_reference_candidate_cannot_persist_design_or_form_state',
      firstContaminationCalls === 2 &&
      firstContaminationResult.authority?.closed_transition_action === 'resolve_context' &&
      firstContaminationResult.authority?.closed_transition_reason === 'ambiguous_missing_referent' &&
      !String(firstContaminationResult.structured_state?.known_design_context || '').trim() &&
      firstContaminationResult.structured_state?.form_offer_asked !== true,
      JSON.stringify({ calls: firstContaminationCalls, authority: firstContaminationResult.authority, state: firstContaminationResult.structured_state }))

    const secondContaminationInbound = {
      contact_id: contaminationThread,
      thread_id: contaminationThread,
      instagram_username: 'omar.system',
      message_id: 'unresolved-contamination-second',
      text: 'im tryna go kinda over there with it',
      received_at: '2026-07-19T22:36:19.965Z'
    }
    recordIngressEvent(root, secondContaminationInbound)
    const liveFailedClarificationHistory = [
      { role: 'user', text: 'I love your style' },
      { role: 'assistant', text: 'hey thanks so much what caught your eye from the stuff on my profile or highlights?' },
      { role: 'user', text: "I'm thinking of something like this" },
      { role: 'assistant', text: 'hey what did you want to show me exactly? i dont see the pic or post here' },
      { role: 'user', text: firstContaminationInbound.text },
      { role: 'assistant', text: 'hey can you send me the actual pic or post you meant? i dont see it here yet' }
    ]
    let secondContaminationCalls = 0
    const secondContaminationResult = executeSingleControlTurn(secondContaminationInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        secondContaminationCalls += 1
        const base = {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            live_turn_gave_design_idea: true,
            // Exact live failure: the model recycled the earlier unresolved
            // pointer as a supposed durable design fact.
            known_design_context: firstContaminationInbound.text,
            form_offer_asked: true,
            booking_stage_hint: 'awaiting_form_permission_answer'
          },
          intent_adoption_state: {
            llm_intent_applied: true,
            tattoo_intent_active: true,
            live_turn_gave_design_idea: true,
            context_classifier_applied: true,
            live_turn_context_missing: false,
            live_turn_context_missing_attachment: false,
            live_turn_context_needs_clarification: false,
            live_turn_context_resolved_from_history: true,
            live_turn_context_relation: 'resolved_from_history',
            live_turn_context_confidence: 'high',
            live_turn_context_resolution_source: 'llm_history_resolution_verified',
            live_turn_context_reason_code: 'continuation_of_prior_direction',
            live_turn_context_antecedent_quote: firstContaminationInbound.text
          },
          recent_history: liveFailedClarificationHistory
        }
        if (secondContaminationCalls === 1) {
          return {
            ...base,
            raw_text: 'recursive polluted form advance',
            packet: { bubbles: [
              { text: 'got it yeah that direction works well' },
              { text: 'want me to send the form so we can confirm a day?' }
            ] }
          }
        }
        return {
          ...base,
          raw_text: 'clarify open vocabulary deictic pointer',
          packet: { bubbles: [{ text: 'wait what do you mean by over there?' }] }
        }
      }
    })
    check('open_vocabulary_pointer_cannot_inherit_unresolved_design_fact',
      secondContaminationCalls === 2 &&
      secondContaminationResult.authority?.closed_transition_action === 'resolve_context' &&
      secondContaminationResult.authority?.closed_transition_reason === 'ambiguous_missing_referent' &&
      !String(secondContaminationResult.structured_state?.known_design_context || '').trim() &&
      secondContaminationResult.structured_state?.form_offer_asked !== true,
      JSON.stringify({ calls: secondContaminationCalls, authority: secondContaminationResult.authority, state: secondContaminationResult.structured_state }))
    check('live_failed_classifier_quote_cannot_override_structural_referent_floor',
      secondContaminationResult.authority?.control_candidate_passes === 2 &&
      /what do you mean by over there/i.test(String(secondContaminationResult.packet?.bubbles?.[0]?.text || '')) &&
      !/get the vibe|send the form/i.test(String(secondContaminationResult.packet?.bubbles?.map((bubble) => bubble.text).join(' ') || '')),
      JSON.stringify({ calls: secondContaminationCalls, authority: secondContaminationResult.authority, packet: secondContaminationResult.packet }))

    // Exact live failure 2026-07-19: the intent classifier copied the prior
    // acknowledgement "yeah sure" and labeled it a verified antecedent for
    // "over there". That washed the correct structural floor into DESIGN_INTAKE,
    // and the first candidate opened with false approval ("okay cool"). Neither
    // the acknowledgement nor a positive preface may cross the adoption gate.
    const ackWashThreadId = 'single-control-generic-ack-antecedent-wash'
    fs.writeFileSync(path.join(root, 'thread-state', `${ackWashThreadId}.json`), JSON.stringify({
      contact_id: ackWashThreadId,
      thread_id: ackWashThreadId,
      tattoo_intent_active: true
    }, null, 2) + '\n')
    const ackWashHistory = [
      { role: 'user', text: 'yeah sure' },
      { role: 'assistant', text: 'yesss what’s on your mind lately' }
    ]
    fs.writeFileSync(path.join(root, 'thread-history', `${ackWashThreadId}.json`), JSON.stringify({
      contact_id: ackWashThreadId,
      thread_id: ackWashThreadId,
      instagram_username: 'omar.system',
      events: ackWashHistory
    }, null, 2) + '\n')
    const ackWashInbound = {
      contact_id: ackWashThreadId,
      thread_id: ackWashThreadId,
      instagram_username: 'omar.system',
      message_id: 'generic-ack-wash-live-message',
      text: "I'm tryna go kinda over there with it",
      received_at: '2026-07-20T00:49:58.382Z'
    }
    recordIngressEvent(root, ackWashInbound)
    let ackWashCalls = 0
    const ackWashResult = executeSingleControlTurn(ackWashInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        ackWashCalls += 1
        const base = {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            live_turn_gave_design_idea: true,
            known_design_context: 'yeah sure',
            form_offer_asked: true
          },
          intent_adoption_state: {
            llm_intent_applied: true,
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            context_classifier_applied: true,
            live_turn_context_missing: false,
            live_turn_context_needs_clarification: false,
            live_turn_context_resolved_from_history: true,
            live_turn_context_relation: 'resolved_from_history',
            live_turn_context_confidence: 'high',
            live_turn_context_resolution_source: 'llm_history_resolution_verified',
            live_turn_context_reason_code: 'continuation_of_ack',
            live_turn_context_antecedent_quote: 'yeah sure'
          },
          recent_history: ackWashHistory
        }
        if (ackWashCalls === 1) {
          return {
            ...base,
            raw_text: 'false approval before unresolved clarification',
            packet: { bubbles: [{ text: 'okay cool where’s that over there for you? like a spot or vibe?' }] }
          }
        }
        return {
          ...base,
          raw_text: 'open unresolved clarification',
          packet: { bubbles: [{ text: 'what do you mean by over there?' }] }
        }
      }
    })
    check('generic_ack_cannot_override_structural_referent_route',
      ackWashCalls === 2 &&
      ackWashResult.authority?.closed_transition_action === 'resolve_context' &&
      ackWashResult.authority?.closed_transition_reason === 'ambiguous_missing_referent',
      JSON.stringify({ calls: ackWashCalls, authority: ackWashResult.authority, state: ackWashResult.structured_state }))
    check('positive_unresolved_ack_is_rejected_then_open_question_adopted',
      ackWashResult.authority?.control_candidate_passes === 2 &&
      /what do you mean by over there/i.test(String(ackWashResult.packet?.bubbles?.[0]?.text || '')) &&
      !/okay cool|got the vibe|send the form/i.test(String(ackWashResult.packet?.bubbles?.map((bubble) => bubble.text).join(' ') || '')) &&
      !String(ackWashResult.structured_state?.known_design_context || '').trim() &&
      ackWashResult.structured_state?.form_offer_asked !== true,
      JSON.stringify({ calls: ackWashCalls, authority: ackWashResult.authority, packet: ackWashResult.packet, state: ackWashResult.structured_state }))

    // Exact production composition: a valid concrete tattoo brief and open form
    // offer exist in durable history, but the next live turn is still only an
    // opaque spatial pointer.  A model may not treat the old snake/arm sentence
    // as proof that it understood "over there" and jump to a date or form step.
    const opaquePointerThreadId = 'single-control-concrete-history-opaque-pointer'
    fs.writeFileSync(path.join(root, 'thread-state', `${opaquePointerThreadId}.json`), JSON.stringify({
      contact_id: opaquePointerThreadId,
      thread_id: opaquePointerThreadId,
      tattoo_intent_active: true,
      known_design_context: 'I am thinking of a black and grey snake wrapping around my arm',
      known_placement_context: 'arm',
      form_offer_asked: true,
      booking_stage_hint: 'awaiting_form_permission_answer'
    }, null, 2) + '\n')
    const opaquePointerHistory = [
      { role: 'user', text: 'I am thinking of a black and grey snake wrapping around my arm' },
      { role: 'assistant', text: 'want me to send the form so we can get things rolling?' }
    ]
    fs.writeFileSync(path.join(root, 'thread-history', `${opaquePointerThreadId}.json`), JSON.stringify({
      contact_id: opaquePointerThreadId,
      thread_id: opaquePointerThreadId,
      instagram_username: 'omar.system',
      events: opaquePointerHistory
    }, null, 2) + '\n')
    const opaquePointerInbound = {
      contact_id: opaquePointerThreadId,
      thread_id: opaquePointerThreadId,
      instagram_username: 'omar.system',
      message_id: 'concrete-history-opaque-pointer-live-message',
      text: "I'm tryna go kinda over there with it",
      received_at: '2026-07-20T01:12:59.764Z'
    }
    recordIngressEvent(root, opaquePointerInbound)
    let opaquePointerCalls = 0
    const opaquePointerResult = executeSingleControlTurn(opaquePointerInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        opaquePointerCalls += 1
        const base = {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            live_turn_gave_design_idea: true,
            known_design_context: 'I am thinking of a black and grey snake wrapping around my arm',
            known_placement_context: 'arm',
            form_offer_asked: true,
            booking_stage_hint: 'awaiting_form_permission_answer'
          },
          intent_adoption_state: {
            llm_intent_applied: true,
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            context_classifier_applied: true,
            live_turn_context_missing: false,
            live_turn_context_needs_clarification: false,
            live_turn_context_resolved_from_history: true,
            live_turn_context_relation: 'resolved_from_history',
            live_turn_context_confidence: 'high',
            live_turn_context_resolution_source: 'llm_history_resolution_verified',
            live_turn_context_reason_code: 'claimed_design_continuation',
            live_turn_context_antecedent_quote: 'black and grey snake wrapping around my arm'
          },
          recent_history: opaquePointerHistory
        }
        if (opaquePointerCalls === 1) {
          return {
            ...base,
            raw_text: 'false concrete history understanding and date jump',
            packet: { bubbles: [
              { text: 'yeah i get that spot vibe for sure' },
              { text: 'any rough idea when you might wanna book the day?' }
            ] }
          }
        }
        return {
          ...base,
          raw_text: 'open clarification without claimed understanding',
          packet: { bubbles: [{ text: 'what do you mean by over there?' }] }
        }
      }
    })
    check('concrete_history_cannot_override_opaque_live_referent_route',
      opaquePointerCalls === 2 &&
      opaquePointerResult.authority?.closed_transition_action === 'resolve_context' &&
      opaquePointerResult.authority?.closed_transition_reason === 'ambiguous_missing_referent' &&
      opaquePointerResult.structured_state?.form_offer_asked === true &&
      /black and grey snake/i.test(String(opaquePointerResult.structured_state?.known_design_context || '')),
      JSON.stringify({ calls: opaquePointerCalls, authority: opaquePointerResult.authority, state: opaquePointerResult.structured_state }))
    check('concrete_history_false_understanding_is_rejected_then_open_question_adopted',
      opaquePointerResult.authority?.control_candidate_passes === 2 &&
      /what do you mean by over there/i.test(String(opaquePointerResult.packet?.bubbles?.[0]?.text || '')) &&
      !/get that|spot vibe|book|date|send the form/i.test(String(opaquePointerResult.packet?.bubbles?.map((bubble) => bubble.text).join(' ') || '')),
      JSON.stringify({ calls: opaquePointerCalls, authority: opaquePointerResult.authority, packet: opaquePointerResult.packet }))

    // Once the client resolves that opaque pointer with a concrete directional
    // placement, the preserved open form question still owns the transaction
    // boundary. The new placement is useful consultation state, not permission
    // to skip directly into dates or booking.
    const groundedDirectionalInbound = {
      contact_id: opaquePointerThreadId,
      thread_id: opaquePointerThreadId,
      instagram_username: 'omar.system',
      message_id: 'concrete-history-grounded-directional-placement',
      text: "I'm tryna wrap the snake over my forearm",
      received_at: '2026-07-20T01:13:31.000Z'
    }
    recordIngressEvent(root, groundedDirectionalInbound)
    let groundedDirectionalCalls = 0
    const groundedDirectionalResult = executeSingleControlTurn(groundedDirectionalInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        groundedDirectionalCalls += 1
        const base = {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            known_design_context: 'I am thinking of a black and grey snake wrapping around my arm',
            known_placement_context: 'forearm',
            form_offer_asked: true,
            booking_stage_hint: 'awaiting_form_permission_answer'
          },
          intent_adoption_state: {
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            live_turn_gave_design_idea: true
          },
          recent_history: opaquePointerHistory
        }
        if (groundedDirectionalCalls === 1) {
          return {
            ...base,
            raw_text: 'invalid directional placement acknowledgement plus calendar jump',
            packet: { bubbles: [
              { text: 'got it wrapping the snake over your forearm sounds tight' },
              { text: 'do you have a rough time frame in mind for when you want to get started' }
            ] }
          }
        }
        return {
          ...base,
          raw_text: 'directional placement acknowledged with pending gate preserved',
          packet: { bubbles: [{ text: 'got it, forearm noted and we can dial the exact placement and sizing in at the appointment' }] }
        }
      }
    })
    const groundedDirectionalText = groundedDirectionalResult.packet.bubbles
      .map((bubble) => String(bubble?.text || ''))
      .join('\n')
    check('grounded_directional_placement_preserves_open_form_gate_after_context_repair',
      groundedDirectionalCalls === 2 &&
      groundedDirectionalResult.authority?.closed_transition_action === 'general_continue' &&
      groundedDirectionalResult.authority?.closed_transition_reason === 'open_form_offer_received_nonconsent_size_or_placement_detail' &&
      groundedDirectionalResult.structured_state?.form_offer_asked === true &&
      groundedDirectionalResult.structured_state?.form_link_sent !== true,
      JSON.stringify({ calls: groundedDirectionalCalls, authority: groundedDirectionalResult.authority, state: groundedDirectionalResult.structured_state }))
    check('grounded_directional_calendar_jump_rejected_then_natural_ack_adopted',
      groundedDirectionalResult.authority?.control_candidate_passes === 2 &&
      /forearm/i.test(groundedDirectionalText) &&
      !/when|book|booking|session|date|time|calendar|get started|want me to send|effacermonexistence\.com\/apply/i.test(groundedDirectionalText),
      JSON.stringify({ calls: groundedDirectionalCalls, authority: groundedDirectionalResult.authority, packet: groundedDirectionalResult.packet }))

    // Exact live-pipeline regression 2026-07-25: stale August 1 / August 27
    // state existed when the client counter-proposed "15th of August". The
    // first controller route, both verifiers, and the durable commit must agree
    // that this legal date replaces the stale slot and leaves only time open.
    const unboundedDateThread = 'single-control-unbounded-legal-date'
    fs.writeFileSync(path.join(root, 'thread-state', `${unboundedDateThread}.json`), JSON.stringify({
      contact_id: unboundedDateThread,
      thread_id: unboundedDateThread,
      tattoo_intent_active: true,
      known_design_context: 'black and gray reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Omar System',
      known_phone_used_on_form: '4155550199',
      known_requested_date: 'august 27',
      known_requested_time: '2pm',
      accepted_offered_date: 'august 1',
      accepted_offered_time: '2pm',
      last_offered_date: 'august 1',
      last_offered_time: '2pm'
    }, null, 2) + '\n')
    const unboundedDateHistory = [{
      role: 'assistant',
      message_id: 'unbounded-date-prior-packet',
      text: 'about july 27, the earliest i can book is august 1 at 2pm. august 2 or 3 would also be at 2pm'
    }]
    fs.writeFileSync(path.join(root, 'thread-history', `${unboundedDateThread}.json`), JSON.stringify({
      contact_id: unboundedDateThread,
      thread_id: unboundedDateThread,
      instagram_username: 'omar.system',
      events: unboundedDateHistory
    }, null, 2) + '\n')
    const unboundedDateInbound = {
      contact_id: unboundedDateThread,
      thread_id: unboundedDateThread,
      instagram_username: 'omar.system',
      message_id: 'unbounded-date-live-message',
      text: 'OK, then can we do 15th of August?',
      received_at: '2026-07-25T22:39:11-07:00'
    }
    recordIngressEvent(root, unboundedDateInbound)
    let unboundedDateCalls = 0
    let unboundedDateFirstPlan = null
    const unboundedDateResult = executeSingleControlTurn(unboundedDateInbound, {
      root,
      authority_options: { recent_history_override: unboundedDateHistory },
      candidateGenerator: (_msg, opts) => {
        unboundedDateCalls += 1
        if (!unboundedDateFirstPlan) unboundedDateFirstPlan = opts.control_transition_contract
        const date = String(
          opts.control_transition_contract?.fields?.proposed_date ||
          opts.control_transition_contract?.fields?.date ||
          '15th of August'
        )
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'legal explicit date progresses to time',
          packet: { bubbles: [{ text: `${date} works. would 2pm work for you?` }] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {
            llm_intent_applied: true,
            // Deliberately adversarial false-positive.
            live_turn_accepts_offered_slot: true,
            live_turn_is_question: true
          },
          recent_history: unboundedDateHistory
        }
      }
    })
    check('legal_date_owns_first_route_without_retry_or_stale_slot_acceptance',
      unboundedDateCalls === 1 &&
      unboundedDateFirstPlan?.action === 'post_form_time' &&
      unboundedDateFirstPlan?.reason === 'submitted_form_missing_time' &&
      unboundedDateFirstPlan?.stage === 'awaiting_time' &&
      unboundedDateFirstPlan?.live_intent?.accepts_offered_slot === false &&
      unboundedDateResult.authority?.closed_transition_action === 'post_form_time' &&
      unboundedDateResult.authority?.control_candidate_passes === 1,
      JSON.stringify({ unboundedDateCalls, unboundedDateFirstPlan, authority: unboundedDateResult.authority }))
    check('legal_date_commit_clears_stale_date_time_and_preserves_only_time_gate',
      unboundedDateResult.structured_state?.known_requested_date === '15th of August' &&
      !String(unboundedDateResult.structured_state?.known_requested_time || '').trim() &&
      !String(unboundedDateResult.structured_state?.accepted_offered_date || '').trim() &&
      !String(unboundedDateResult.structured_state?.accepted_offered_time || '').trim() &&
      unboundedDateResult.structured_state?.booking_stage_hint === 'awaiting_time' &&
      /15th of august works/i.test(String(unboundedDateResult.packet?.bubbles?.[0]?.text || '')) &&
      /2pm/i.test(String(unboundedDateResult.packet?.bubbles?.[0]?.text || '')),
      JSON.stringify({ state: unboundedDateResult.structured_state, packet: unboundedDateResult.packet }))

    // Exact live-pipeline regression: an accepted assistant offer is parsed from
    // history as `july 26`, while the one-bubble checkpoint is rendered as
    // `26th of July`. The controller must adopt it on pass one, not reject it and
    // enter a model-repair retry loop.
    const canonicalDateThread = 'single-control-canonical-double-check-date'
    fs.writeFileSync(path.join(root, 'thread-state', `${canonicalDateThread}.json`), JSON.stringify({
      contact_id: canonicalDateThread,
      thread_id: canonicalDateThread,
      tattoo_intent_active: true,
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_reference_media_received: true,
      known_name_used_on_form: 'Omar System Replay Three',
      known_phone_used_on_form: '4155550166',
      known_design_context: 'black and grey snake upper arm wrap'
    }, null, 2) + '\n')
    const canonicalDateHistory = [
      { role: 'assistant', text: 'sundays work i have july 26 at 2pm as the closest sunday spot' },
      { role: 'assistant', text: 'does that work for you?' }
    ]
    fs.writeFileSync(path.join(root, 'thread-history', `${canonicalDateThread}.json`), JSON.stringify({
      contact_id: canonicalDateThread,
      thread_id: canonicalDateThread,
      instagram_username: 'omar.system',
      events: canonicalDateHistory
    }, null, 2) + '\n')
    const canonicalDateInbound = {
      contact_id: canonicalDateThread,
      thread_id: canonicalDateThread,
      instagram_username: 'omar.system',
      message_id: 'canonical-double-check-date-message',
      text: 'yeah that works perfectly',
      received_at: '2026-07-15T03:30:31.044Z'
    }
    recordIngressEvent(root, canonicalDateInbound)
    let canonicalDateCandidateCalls = 0
    const canonicalDateResult = executeSingleControlTurn(canonicalDateInbound, {
      root,
      max_control_reauthor_passes: 3,
      authority_options: { recent_history_override: canonicalDateHistory },
      candidateGenerator: (_msg, opts) => {
        canonicalDateCandidateCalls += 1
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'ready_booking_identity_fixed_double_check' },
          raw_text: 'canonical date checkpoint candidate',
          packet: {
            bubbles: [{
              text: 'Name : Omar System Replay Three\nPhone Number : 4155550166\nAppointment date : 26th of July\nTime : 2pm\n\ncan you double check this just to make sure'
            }]
          },
          structured_state: {
            ...opts.structured_state_override,
            last_offered_date: 'july 26',
            last_offered_time: '2pm',
            accepted_offered_date: 'july 26',
            accepted_offered_time: '2pm',
            known_requested_date: 'july 26',
            known_requested_time: '2pm',
            live_turn_accepts_offered_slot: true
          },
          intent_adoption_state: {
            live_turn_accepts_offered_slot: true
          },
          recent_history: canonicalDateHistory
        }
      }
    })
    check('accepted_slot_canonical_date_checkpoint_adopted_on_first_control_pass',
      canonicalDateCandidateCalls === 1 &&
      canonicalDateResult.authority?.closed_transition_action === 'double_check' &&
      canonicalDateResult.authority?.control_candidate_passes === 1 &&
      canonicalDateResult.packet?.bubbles?.[0]?.text.includes('Appointment date : 26th of July'),
      JSON.stringify({ canonicalDateCandidateCalls, authority: canonicalDateResult.authority, packet: canonicalDateResult.packet }))

    let candidateCalls = 0
    const candidateGenerator = (_msg, opts) => {
      candidateCalls += 1
      check('candidate_receives_controller_reduced_state',
        opts?.structured_state_override?.control_plane_id === SCV_SINGLE_CONTROL_PLANE_ID &&
        opts?.structured_state_override?.tattoo_intent_active === true,
        JSON.stringify(opts?.structured_state_override || {}))
      return {
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'candidate raw output',
        packet: {
          bubbles: [{
            text: 'we can go over the design right here in the dm. send me the references and the direction you want me to pull from'
          }]
        },
        structured_state: {
          ...opts.structured_state_override,
          tattoo_intent_active: true,
          known_design_context: 'black and gray custom reference piece'
        },
        intent_adoption_state: {
          llm_intent_applied: true,
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true
        },
        recent_history: []
      }
    }

    const first = executeSingleControlTurn(inbound, { root, candidateGenerator })
    const receiptVerdict = validateControlReceipt(first, { root, requireLedger: true, requirePayload: true })
    check('only_controller_can_author_final_envelope',
      first.source === SCV_SINGLE_CONTROL_SOURCE &&
      first.authority?.controller === SCV_SINGLE_CONTROL_PLANE_ID &&
      first.authority?.runner === 'scv-single-control-plane',
      JSON.stringify(first.authority))
    check('control_receipt_is_ledger_backed', receiptVerdict.valid === true, JSON.stringify(receiptVerdict))
    check('control_receipt_binds_exact_visible_payload',
      /^[a-f0-9]{64}$/i.test(String(first.control_receipt?.packet_sha256 || '')),
      JSON.stringify(first.control_receipt))
    const decisionArtifact = readControlDecisionArtifact(root, first.control_receipt.receipt_sha256)
    check('committed_decision_has_immutable_recovery_artifact',
      decisionArtifact.valid === true &&
      JSON.stringify(decisionArtifact.artifact?.packet) === JSON.stringify(first.packet),
      JSON.stringify(decisionArtifact))
    const tamperedPacket = {
      ...first,
      packet: { bubbles: [{ text: `${first.packet.bubbles[0].text} changed after adoption` }] }
    }
    const tamperedPacketVerdict = validateControlReceipt(tamperedPacket, { root, requireLedger: true, requirePayload: true })
    check('post_adoption_packet_text_mutation_is_rejected',
      tamperedPacketVerdict.valid === false && tamperedPacketVerdict.reason === 'single_control_packet_payload_hash_mismatch',
      JSON.stringify(tamperedPacketVerdict))
    const tamperedBubbleVerdict = validateControlReceipt({
      ...first,
      bubble_index: 0,
      bubble: { text: 'transport tried to replace controller text' }
    }, { root, requireLedger: true, requirePayload: true })
    check('post_adoption_single_bubble_mutation_is_rejected',
      tamperedBubbleVerdict.valid === false && tamperedBubbleVerdict.reason === 'single_control_bubble_payload_mismatch',
      JSON.stringify(tamperedBubbleVerdict))
    const badIndexVerdict = validateControlReceipt({
      ...first,
      bubble_index: first.packet.bubbles.length,
      bubble: first.packet.bubbles[0]
    }, { root, requireLedger: true, requirePayload: true })
    check('post_adoption_bubble_index_mutation_is_rejected',
      badIndexVerdict.valid === false && badIndexVerdict.reason === 'single_control_bubble_index_invalid',
      JSON.stringify(badIndexVerdict))
    const repairVerdict = repairTransportPacketFromDecisionArtifact(root, {
      ...first,
      bubble_index: 0,
      bubble_count: first.packet.bubbles.length,
      bubbles: [{ text: 'corrupted queue payload' }],
      bubble: { text: 'corrupted queue payload', delay_ms: 1234 }
    })
    check('corrupted_transport_payload_restores_from_decision_artifact',
      repairVerdict.repaired === true &&
      String(repairVerdict.packet?.bubble?.text || '') === String(first.packet.bubbles[0]?.text || '') &&
      Number(repairVerdict.packet?.bubble?.delay_ms) === 1234 &&
      JSON.stringify(repairVerdict.packet?.bubbles) === JSON.stringify(first.packet.bubbles),
      JSON.stringify(repairVerdict))
    const repairedReceiptVerdict = validateControlReceipt(repairVerdict.packet, { root, requireLedger: true, requirePayload: true })
    check('artifact_restored_transport_packet_revalidates_end_to_end',
      repairedReceiptVerdict.valid === true,
      JSON.stringify(repairedReceiptVerdict))
    const persistedOfferProbe = extractLatestOfferedSlotFromPacket({
      bubbles: [
        { text: 'the earliest date i can offer is august 30' },
        { text: 'would august 30 work for you?' }
      ]
    })
    const replacementOfferProbe = extractLatestOfferedSlotFromPacket({
      bubbles: [{ text: 'August 30 is a little too soon but I can do Monday August 31 at 2pm. Would that work?' }]
    })
    const multiOfferProbe = extractOfferedSlotsFromPacket({
      bubbles: [{ text: 'I can do Sept 7 at 2pm or Sept 8 at 3:30pm which one works?' }]
    })
    check('controller_preserves_each_date_time_pair_in_multi_offer',
      multiOfferProbe.length === 2 &&
      multiOfferProbe[0]?.date === 'sept 7' && multiOfferProbe[0]?.time === '2pm' &&
      multiOfferProbe[1]?.date === 'sept 8' && multiOfferProbe[1]?.time === '3:30pm',
      JSON.stringify(multiOfferProbe))
    check('controller_persists_replacement_offer_not_rejected_date',
      replacementOfferProbe?.date === 'august 31' && replacementOfferProbe?.time === '2pm',
      JSON.stringify(replacementOfferProbe))
    check('controller_commits_monotonic_state',
      first.structured_state.tattoo_intent_active === true &&
      first.structured_state.control_revision === 1 &&
      persistedOfferProbe?.date === 'august 30' &&
      persistedOfferProbe?.time === '',
      JSON.stringify(first.structured_state))

    const duplicateCommit = commitControlDecision(root, inbound, first.structured_state, {
      authority: { controller: 'must-not-replace-first-decision' },
      packet: { bubbles: [{ text: 'must not replace first decision' }] }
    })
    check('concurrent_same_event_commit_adopts_first_decision_only',
      duplicateCommit.replayed === true &&
      duplicateCommit.state.control_revision === 1 &&
      JSON.stringify(duplicateCommit.decision.packet) === JSON.stringify(first.packet),
      JSON.stringify(duplicateCommit))

    const replay = executeSingleControlTurn(inbound, { root, candidateGenerator })
    check('same_event_replays_exact_adopted_decision',
      replay.replayed_control_decision === true &&
      JSON.stringify(replay.packet) === JSON.stringify(first.packet) &&
      replay.control_receipt.receipt_sha256 === first.control_receipt.receipt_sha256,
      JSON.stringify(replay))
    check('replay_does_not_call_candidate_twice_or_advance_revision',
      candidateCalls === 1 && replay.structured_state.control_revision === 1,
      JSON.stringify({ candidateCalls, revision: replay.structured_state.control_revision }))

    const controlModulePath = require.resolve(path.join(__dirname, 'scv-single-control-plane.js'))
    delete require.cache[controlModulePath]
    const restartedControl = require(controlModulePath)
    const restartReplay = restartedControl.executeSingleControlTurn(inbound, {
      root,
      candidateGenerator: () => { throw new Error('candidate_must_not_run_after_restart') }
    })
    check('restart_replays_same_atomic_control_decision_without_regeneration',
      restartReplay.replayed_control_decision === true &&
      restartReplay.control_receipt.receipt_sha256 === first.control_receipt.receipt_sha256 &&
      restartReplay.structured_state.control_revision === 1,
      JSON.stringify(restartReplay))

    const commitAuditFile = path.join(root, 'control-events', `${threadId}.ndjson`)
    fs.unlinkSync(commitAuditFile)
    const auditRecoveryReplay = restartedControl.executeSingleControlTurn(inbound, {
      root,
      candidateGenerator: () => { throw new Error('candidate_must_not_run_during_commit_audit_recovery') }
    })
    const recoveredAuditEvents = fs.readFileSync(commitAuditFile, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    check('restart_recreates_missing_commit_audit_from_immutable_decision',
      auditRecoveryReplay.replayed_control_decision === true &&
      recoveredAuditEvents.some((event) => event.type === 'control_decision_committed' && event.receipt_sha256 === first.control_receipt.receipt_sha256),
      JSON.stringify(recoveredAuditEvents))
    check('recreated_commit_audit_keeps_artifact_fallback_ledger_valid',
      restartedControl.validateControlReceipt(first, { root, requireLedger: true, requirePayload: true }).valid === true,
      JSON.stringify(first.control_receipt))

    const repairThreadId = 'single-control-repair-thread'
    fs.writeFileSync(path.join(root, 'thread-state', `${repairThreadId}.json`), JSON.stringify({
      contact_id: repairThreadId,
      thread_id: repairThreadId,
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Ben',
      known_phone_used_on_form: '4155550100',
      known_requested_date: '7th of August',
      known_requested_time: '2pm'
    }, null, 2) + '\n')
    const repairInbound = {
      contact_id: repairThreadId,
      thread_id: repairThreadId,
      instagram_username: 'single.control.repair',
      message_id: 'single-control-repair-message',
      text: 'yeah perfect',
      received_at: '2026-07-10T20:02:00.000Z'
    }
    recordIngressEvent(root, repairInbound)
    const doubleCheckHistory = [{
      role: 'assistant',
      text: 'Name: Ben\nPhone Number: 4155550100\nAppointment date: 7th of August\nTime: 2pm\n\ncan you double check this just to make sure?'
    }]
    let repairCalls = 0
    let repairLockObserved = false
    const repairGenerator = (_msg, opts) => {
      repairCalls += 1
      if (repairCalls > 1) repairLockObserved = /Required semantic action: deposit_handoff/.test(String(opts?.control_transition_repair || ''))
      return {
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: repairCalls === 1 ? 'invalid first candidate' : 'valid repaired candidate',
        packet: repairCalls === 1
          ? { bubbles: [{ text: 'perfect, 7th of August at 2pm works on my side' }] }
          : { bubbles: [
              { text: 'To confirm your appointment the deposit would be 100.' },
              { text: 'This is my zelle!' },
              { text: 'contact@omarprotocol.com' },
              { text: 'Once you send it just let me know so I can double check everything on my side and confirm your appointment on my calendar! I will be waiting:3' }
            ] },
        structured_state: { ...opts.structured_state_override },
        intent_adoption_state: { llm_intent_applied: true },
        recent_history: doubleCheckHistory
      }
    }
    const repaired = executeSingleControlTurn(repairInbound, {
      root,
      candidateGenerator: repairGenerator,
      authority_options: { recent_history_override: doubleCheckHistory }
    })
    check('controller_reauthors_after_rejected_semantic_candidate',
      repairCalls === 2 && repairLockObserved === true && repaired.authority?.control_candidate_passes === 2,
      JSON.stringify({ repairCalls, repairLockObserved, authority: repaired.authority }))
    check('controller_adopts_only_verified_reauthored_deposit_handoff',
      repaired.authority?.closed_transition_action === 'deposit_handoff' &&
      repaired.packet.bubbles.some((bubble) => /contact@omarprotocol\.com/i.test(String(bubble.text || ''))),
      JSON.stringify(repaired))

    // Exact live regression, 2026-08-28: a noisy submission transcript arrived
    // as "Aaja submitted". The clear process verb may advance the form checkpoint,
    // but the unexplained prefix cannot become a name/design or reach visible copy.
    const noisySubmissionThread = 'single-control-noisy-submission-residue'
    fs.writeFileSync(path.join(root, 'thread-state', `${noisySubmissionThread}.json`), JSON.stringify({
      contact_id: noisySubmissionThread,
      thread_id: noisySubmissionThread,
      tattoo_intent_active: true,
      known_design_context: 'blackwork snake',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: false
    }, null, 2) + '\n')
    const noisySubmissionInbound = {
      contact_id: noisySubmissionThread,
      thread_id: noisySubmissionThread,
      instagram_username: 'omar.system',
      message_id: 'single-control-noisy-submission-message',
      text: 'Aaja submitted',
      received_at: '2026-08-29T06:13:52.000Z'
    }
    recordIngressEvent(root, noisySubmissionInbound)
    const noisySubmissionHistory = [
      { role: 'user', text: 'i want a blackwork snake' },
      { role: 'assistant', text: `here you go ${PREFERRED_FORM_LINK}` }
    ]
    let noisySubmissionCalls = 0
    let noisySubmissionRepairObserved = false
    const noisySubmissionResult = executeSingleControlTurn(noisySubmissionInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        noisySubmissionCalls += 1
        if (noisySubmissionCalls > 1) {
          noisySubmissionRepairObserved = /ungrounded|ASR-damaged|name-like/i.test(String(opts?.control_transition_repair || ''))
        }
        const visible = noisySubmissionCalls === 1
          ? "Got it, Aaja's in. What dates work for you?"
          : 'Got it, the form is in. What dates work for you?'
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: visible,
          packet: { bubbles: [{ text: visible }] },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            known_design_context: 'blackwork snake',
            form_offer_asked: true,
            form_link_sent: true,
            form_submitted: true,
            live_turn_form_submitted_signal: true,
            live_turn_gave_design_idea: false
          },
          intent_adoption_state: {
            llm_intent_applied: true,
            live_turn_form_submitted_signal: true
          },
          recent_history: noisySubmissionHistory
        }
      },
      authority_options: { recent_history_override: noisySubmissionHistory }
    })
    check('noisy_submission_echo_is_rejected_and_reauthored',
      noisySubmissionCalls === 2 &&
      noisySubmissionRepairObserved === true &&
      noisySubmissionResult.authority?.control_candidate_passes === 2,
      JSON.stringify({ noisySubmissionCalls, noisySubmissionRepairObserved, authority: noisySubmissionResult.authority }))
    check('noisy_submission_residue_never_reaches_visible_packet',
      !/aaja/i.test(noisySubmissionResult.packet.bubbles.map((bubble) => String(bubble.text || '')).join('\n')) &&
      /form is in/i.test(noisySubmissionResult.packet.bubbles.map((bubble) => String(bubble.text || '')).join('\n')),
      JSON.stringify(noisySubmissionResult.packet))
    check('noisy_submission_residue_cannot_mutate_identity_or_design_state',
      noisySubmissionResult.structured_state.form_submitted === true &&
      noisySubmissionResult.structured_state.known_design_context === 'blackwork snake' &&
      !String(noisySubmissionResult.structured_state.known_name_used_on_form || '').trim(),
      JSON.stringify(noisySubmissionResult.structured_state))

    // A single executor failure is not allowed to abort the whole turn. The same
    // controller invocation must continue through its bounded candidate budget.
    const transientThreadId = 'single-control-transient-candidate-thread'
    const transientInbound = {
      contact_id: transientThreadId,
      thread_id: transientThreadId,
      instagram_username: 'single.control.transient',
      message_id: 'single-control-transient-message',
      text: 'hey how are you doing?',
      received_at: '2026-07-12T23:00:00.000Z'
    }
    recordIngressEvent(root, transientInbound)
    let transientCalls = 0
    const transientResult = executeSingleControlTurn(transientInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        transientCalls += 1
        if (transientCalls === 1) throw new Error('simulated_one_pass_executor_failure')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'hey im good, hows your day going?',
          packet: { bubbles: [{ text: 'hey im good, hows your day going?' }] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('single_candidate_executor_failure_recovers_inside_same_control_turn',
      transientCalls === 2 && transientResult.authority?.control_candidate_passes === 2,
      JSON.stringify({ transientCalls, authority: transientResult.authority }))

    // A safe-clarification packet is not authority to relabel a clear form or
    // deposit answer unintelligible. A compromised or stale inner runner that
    // returns that packet on a transactional route must exhaust the outer budget
    // without advancing state; only an actual unintelligible controller route or
    // an explicitly marked durable recovery may adopt it.
    for (const scenario of [
      {
        id: 'send-form',
        state: {
          tattoo_intent_active: true,
          known_design_context: 'black and gray snake',
          form_offer_asked: true
        },
        inbound: 'yes please',
        history: [{ role: 'assistant', text: 'want me to send the application form?' }],
        forbiddenState: 'form_link_sent'
      },
      {
        id: 'deposit',
        state: {
          tattoo_intent_active: true,
          known_design_context: 'black and gray snake',
          form_offer_asked: true,
          form_link_sent: true,
          form_submitted: true,
          known_name_used_on_form: 'Mina',
          known_phone_used_on_form: '4157602883',
          known_requested_date: 'August 30',
          known_requested_time: '2pm',
          double_check_sent: true,
          name_phone_date_time_double_check_sent: true
        },
        inbound: 'yes that all looks right',
        history: [{ role: 'assistant', text: 'can you double check this just to make sure' }],
        forbiddenState: 'deposit_requested'
      }
    ]) {
      const recoveryThreadId = `single-control-exhausted-${scenario.id}`
      fs.writeFileSync(path.join(root, 'thread-state', `${recoveryThreadId}.json`), JSON.stringify({
        contact_id: recoveryThreadId,
        thread_id: recoveryThreadId,
        ...scenario.state
      }, null, 2) + '\n')
      const recoveryInbound = {
        contact_id: recoveryThreadId,
        thread_id: recoveryThreadId,
        instagram_username: 'omar.system',
        message_id: `${recoveryThreadId}-message`,
        text: scenario.inbound,
        received_at: '2026-08-25T20:00:00.000Z'
      }
      recordIngressEvent(root, recoveryInbound)
      let recoveryCalls = 0
      let recoveryError = ''
      try {
        executeSingleControlTurn(recoveryInbound, {
          root,
          authority_options: { recent_history_override: scenario.history },
          candidateGenerator: (_msg, opts) => {
            recoveryCalls += 1
            const recoveryInput = {
              message: scenario.inbound,
              structured_state: { ...opts.structured_state_override },
              control_transition_contract: opts.control_transition_contract
            }
            return {
              source: 'codex_exec_dm_authority',
              authority: {
                runner: 'codex exec',
                executor: 'deterministic_safe_clarification_after_model_exhaustion',
                deterministic_recovery: true,
                deterministic_recovery_kind: 'safe_clarification'
              },
              raw_text: 'rejected model candidates replaced by safe clarification',
              packet: buildSafeClarificationRecoveryPacket(recoveryInput),
              structured_state: { ...opts.structured_state_override },
              intent_adoption_state: {},
              recent_history: scenario.history
            }
          }
        })
      } catch (error) {
        recoveryError = String(error?.message || error)
      }
      const recoveryState = readControlState(root, recoveryThreadId)
      check(`clear_${scenario.id}_cannot_rebase_to_unintelligible_recovery`,
        recoveryCalls === DEFAULT_CONTROL_REAUTHOR_PASSES &&
          recoveryError.startsWith('single_control_internal_retryable:final_verifier_rejected:') &&
          recoveryState?.[scenario.forbiddenState] !== true,
        JSON.stringify({ recoveryCalls, recoveryError, recoveryState }))
      check(`clear_${scenario.id}_rejected_recovery_never_commits_checkpoint`,
        recoveryState?.[scenario.forbiddenState] !== true,
        JSON.stringify({ forbiddenState: scenario.forbiddenState, recoveryState }))
    }

    // Rejected candidate state cannot promote a repair pass into a later funnel
    // stage. This reproduces the live 18 July -> stale double-check contamination.
    // The only route change allowed below is an explicit verifier-feedback rebase
    // whose new action is independently derived and then reverified.
    const frozenRouteThreadId = 'single-control-frozen-date-route-thread'
    fs.writeFileSync(path.join(root, 'thread-state', `${frozenRouteThreadId}.json`), JSON.stringify({
      contact_id: frozenRouteThreadId,
      thread_id: frozenRouteThreadId,
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Eloise',
      known_phone_used_on_form: '4155550199',
      known_requested_date: '18th',
      known_requested_time: '2pm',
      last_offered_date: '25th of July',
      last_offered_time: '2pm'
    }, null, 2) + '\n')
    const frozenRouteInbound = {
      contact_id: frozenRouteThreadId,
      thread_id: frozenRouteThreadId,
      instagram_username: 'single.control.frozen',
      message_id: 'single-control-frozen-date-message',
      text: 'sent a voice note saying: How about 18th of July?',
      received_at: '2026-07-12T23:01:00.000Z'
    }
    recordIngressEvent(root, frozenRouteInbound)
    const frozenRouteHistory = [
      { role: 'assistant', text: 'here is the form https://www.effacermonexistence.com/apply' },
      { role: 'assistant', text: 'weekends work i have 25th of July at 2pm as the closest weekend spot' }
    ]
    let frozenRouteCalls = 0
    let secondPassRoute = ''
    let secondPassKnownDate = 'contaminated'
    const frozenRouteResult = executeSingleControlTurn(frozenRouteInbound, {
      root,
      authority_options: { recent_history_override: frozenRouteHistory },
      candidateGenerator: (_msg, opts) => {
        frozenRouteCalls += 1
        if (frozenRouteCalls === 2) {
          secondPassRoute = String(opts?.control_transition_contract?.action || '')
          secondPassKnownDate = String(opts?.structured_state_override?.known_requested_date || '')
        }
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: frozenRouteCalls === 1 ? 'rejected stale route' : 'correct date negotiation',
          packet: frozenRouteCalls === 1
            ? { bubbles: [{ text: 'perfect, the 18th at 2pm works' }] }
            : { bubbles: [{ text: 'the 18th is a little earlier than i can do. 25th of July at 2pm is the closest spot on my side, does that work for you?' }] },
          structured_state: {
            ...opts.structured_state_override,
            live_turn_date_phrase: '18th of July',
            live_turn_date_status: 'too_soon'
          },
          intent_adoption_state: {},
          recent_history: frozenRouteHistory
        }
      }
    })
    check('rejected_candidate_cannot_change_frozen_transition_route',
      frozenRouteCalls === 2 && secondPassRoute === 'post_form_availability' && secondPassKnownDate === '',
      JSON.stringify({ frozenRouteCalls, secondPassRoute, secondPassKnownDate, authority: frozenRouteResult.authority }))
    check('frozen_out_of_window_route_adopts_date_negotiation_not_double_check',
      frozenRouteResult.authority?.closed_transition_action === 'post_form_availability' &&
      frozenRouteResult.authority?.control_route_frozen === true &&
      !/Name\s*:/i.test(frozenRouteResult.packet.bubbles.map((bubble) => bubble.text).join('\n')),
      JSON.stringify(frozenRouteResult))

    // Live Omar.system regression 2026-07-23: after the form, the studio asked for
    // available dates and the client replied "How about 26?". Immediate dialogue
    // adjacency owns the numeric dimension: it is a booking day missing a month,
    // not a tattoo-size ambiguity. The valid path stays on one frozen date route.
    const verifierRebaseThreadId = 'single-control-verifier-date-size-rebase'
    fs.writeFileSync(path.join(root, 'thread-state', `${verifierRebaseThreadId}.json`), JSON.stringify({
      contact_id: verifierRebaseThreadId,
      thread_id: verifierRebaseThreadId,
      tattoo_intent_active: true,
      known_design_context: 'black and gray reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date'
    }, null, 2) + '\n')
    const verifierRebaseInbound = {
      contact_id: verifierRebaseThreadId,
      thread_id: verifierRebaseThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-verifier-date-size-message',
      text: 'How about 26?',
      received_at: '2026-07-23T20:00:00.000Z'
    }
    const verifierRebaseHistory = [
      { role: 'assistant', message_id: 'form-date-packet', text: 'perfect i got the form' },
      { role: 'assistant', message_id: 'form-date-packet', text: 'what dates or weekend days are easiest for you?' }
    ]
    recordIngressEvent(root, verifierRebaseInbound)
    let verifierRebaseCalls = 0
    const verifierRebaseObservedPlans = []
    const verifierRebaseResult = executeSingleControlTurn(verifierRebaseInbound, {
      root,
      authority_options: { recent_history_override: verifierRebaseHistory },
      candidateGenerator: (_msg, opts) => {
        verifierRebaseCalls += 1
        verifierRebaseObservedPlans.push({
          action: String(opts?.control_transition_contract?.action || ''),
          reason: String(opts?.control_transition_contract?.reason || '')
        })
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'model-authored month clarification',
          packet: {
            bubbles: [{
              text: 'which month were you thinking for the 26th?'
            }]
          },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: verifierRebaseHistory
        }
      }
    })
    check('adjacent_date_question_stays_on_single_date_route',
      verifierRebaseCalls === 1 &&
      verifierRebaseObservedPlans[0]?.action === 'post_form_availability' &&
      verifierRebaseObservedPlans[0]?.reason === 'submitted_form_monthless_day_requires_month_clarification',
      JSON.stringify({ verifierRebaseCalls, verifierRebaseObservedPlans }))
    check('month_only_candidate_is_reverified_then_adopted_without_rebase',
      verifierRebaseResult.authority?.control_route_rebased === false &&
      verifierRebaseResult.authority?.closed_transition_action === 'post_form_availability' &&
      verifierRebaseResult.authority?.closed_transition_verifier_reason === 'closed_transition_valid',
      JSON.stringify(verifierRebaseResult.authority))
    check('month_clarification_preserves_day_without_silent_month_adoption',
      !String(verifierRebaseResult.structured_state?.known_requested_date || '').trim() &&
      !String(verifierRebaseResult.structured_state?.known_size_context || '').trim() &&
      /\b26(?:th)?\b/i.test(String(verifierRebaseResult.packet?.bubbles?.[0]?.text || '')) &&
      /month/i.test(String(verifierRebaseResult.packet?.bubbles?.[0]?.text || '')) &&
      !/size|inch/i.test(String(verifierRebaseResult.packet?.bubbles?.[0]?.text || '')),
      JSON.stringify({
        state: verifierRebaseResult.structured_state,
        packet: verifierRebaseResult.packet
      }))

    // Live Omar.system regression 2026-08-24: the full day-month proposal was
    // parsed correctly, then the model discourse classifier mislabeled "How
    // about" as an unnamed referent during adoption. Every candidate was asked
    // to clarify a nonexistent object and the turn exhausted into silence.
    const explicitDayMonthThreadId = 'single-control-explicit-day-month-date'
    fs.writeFileSync(path.join(root, 'thread-state', `${explicitDayMonthThreadId}.json`), JSON.stringify({
      contact_id: explicitDayMonthThreadId,
      thread_id: explicitDayMonthThreadId,
      tattoo_intent_active: true,
      known_design_context: 'black and gray reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      last_offered_date: 'September 1',
      last_offered_time: '2pm'
    }, null, 2) + '\n')
    const explicitDayMonthInbound = {
      contact_id: explicitDayMonthThreadId,
      thread_id: explicitDayMonthThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-explicit-day-month-message',
      text: 'How about 26 August?',
      received_at: '2026-08-25T20:00:00.000Z'
    }
    const explicitDayMonthHistory = [
      { role: 'assistant', message_id: 'form-date-packet', text: 'perfect i got the form' },
      { role: 'assistant', message_id: 'form-date-packet', text: 'what dates or weekend days are easiest for you?' }
    ]
    recordIngressEvent(root, explicitDayMonthInbound)
    let explicitDayMonthCalls = 0
    const explicitDayMonthPlans = []
    const explicitDayMonthResult = executeSingleControlTurn(explicitDayMonthInbound, {
      root,
      authority_options: { recent_history_override: explicitDayMonthHistory },
      candidateGenerator: (_msg, opts) => {
        explicitDayMonthCalls += 1
        explicitDayMonthPlans.push({
          action: String(opts?.control_transition_contract?.action || ''),
          reason: String(opts?.control_transition_contract?.reason || ''),
          date_status: String(opts?.structured_state_override?.live_turn_date_status || ''),
          context_relation: String(opts?.structured_state_override?.live_turn_context_relation || '')
        })
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'grounded alternative date offer',
          packet: {
            bubbles: [{
              text: 'the 26th is earlier than i can do. would September 1 at 2pm work for you instead?'
            }]
          },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {
            context_classifier_applied: true,
            live_turn_context_relation: 'ambiguous_missing_referent',
            live_turn_context_confidence: 'high',
            live_turn_context_reason_code: 'missing_referent'
          },
          recent_history: explicitDayMonthHistory
        }
      }
    })
    check('explicit_day_month_date_stays_on_availability_route_despite_hostile_classifier',
      explicitDayMonthCalls === 1 &&
      explicitDayMonthPlans[0]?.action === 'post_form_availability' &&
      explicitDayMonthPlans[0]?.date_status === 'too_soon' &&
      explicitDayMonthPlans[0]?.context_relation === 'coherent' &&
      explicitDayMonthResult.authority?.closed_transition_action === 'post_form_availability' &&
      explicitDayMonthResult.authority?.control_route_rebased === false,
      JSON.stringify({ explicitDayMonthCalls, explicitDayMonthPlans, authority: explicitDayMonthResult.authority }))
    check('explicit_day_month_date_emits_grounded_replacement_instead_of_context_clarification',
      /26th/i.test(String(explicitDayMonthResult.packet?.bubbles?.[0]?.text || '')) &&
      /September 1/i.test(String(explicitDayMonthResult.packet?.bubbles?.[0]?.text || '')) &&
      !/what do you mean|which one|send.*again/i.test(String(explicitDayMonthResult.packet?.bubbles?.[0]?.text || '')),
      JSON.stringify(explicitDayMonthResult.packet))

    // A model-authored outside-window reply must not merely state the closest
    // slot and stop. It must directly handle the rejected date and leave one
    // answerable, state-grounded alternative. That stronger shape should pass
    // the strict gate on the first candidate rather than depending on fail-open.
    const livenessThreadId = 'single-control-date-liveness-thread'
    fs.writeFileSync(path.join(root, 'thread-state', `${livenessThreadId}.json`), JSON.stringify({
      contact_id: livenessThreadId,
      thread_id: livenessThreadId,
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Eloise',
      known_phone_used_on_form: '4155550199',
      last_offered_date: '25th of July',
      last_offered_time: '2pm'
    }, null, 2) + '\n')
    const livenessInbound = {
      contact_id: livenessThreadId,
      thread_id: livenessThreadId,
      instagram_username: 'single.control.liveness',
      message_id: 'single-control-date-liveness-message',
      text: 'sent a voice note saying: How about 18th of July?',
      received_at: '2026-07-12T23:02:00.000Z'
    }
    recordIngressEvent(root, livenessInbound)
    let livenessCalls = 0
    const livenessResult = executeSingleControlTurn(livenessInbound, {
      root,
      authority_options: { recent_history_override: frozenRouteHistory },
      candidateGenerator: (_msg, opts) => {
        livenessCalls += 1
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'safe model reply with grounded answerable calendar move',
          packet: { bubbles: [{ text: 'the 18th is earlier than i can do. would 25th of July at 2pm work for you instead?' }] },
          structured_state: {
            ...opts.structured_state_override,
            live_turn_date_phrase: '18th of July',
            live_turn_date_status: 'too_soon'
          },
          intent_adoption_state: {},
          recent_history: frozenRouteHistory
        }
      }
    })
    check('grounded_answerable_outside_window_candidate_passes_strict_first_call',
      livenessCalls === 1 &&
      livenessResult.authority?.control_liveness_adopted !== true &&
      livenessResult.authority?.closed_transition_verifier_reason === 'closed_transition_valid' &&
      livenessResult.packet.bubbles.length > 0,
      JSON.stringify({ livenessCalls, authority: livenessResult.authority, packet: livenessResult.packet }))

    // Reproduce the live Omar.system failure: a normal greeting reached the
    // controller, all model candidates passed the semantic harness, and the
    // host-motion detector alone converted them into an infinite retry. The
    // non-transactional social liveness floor must preserve safe model copy.
    const socialLivenessThreadId = 'single-control-social-liveness-thread'
    const socialLivenessInbound = {
      contact_id: socialLivenessThreadId,
      thread_id: socialLivenessThreadId,
      instagram_username: 'single.control.social.liveness',
      message_id: 'single-control-social-liveness-message',
      text: 'hey, how are you doing?',
      received_at: '2026-07-14T20:00:00.000Z'
    }
    recordIngressEvent(root, socialLivenessInbound)
    let socialLivenessCalls = 0
    const socialLivenessResult = executeSingleControlTurn(socialLivenessInbound, {
      root,
      authority_options: { recent_history_override: [] },
      candidateGenerator: (_msg, opts) => {
        socialLivenessCalls += 1
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'safe social model reply with strict host-motion miss',
          packet: { bubbles: [{ text: 'hey im good over here' }] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('safe_social_candidate_cannot_die_on_host_motion_false_negative',
      socialLivenessCalls === DEFAULT_CONTROL_REAUTHOR_PASSES &&
      socialLivenessResult.authority?.closed_transition_action === 'social_continue' &&
      socialLivenessResult.authority?.control_liveness_adopted === true &&
      socialLivenessResult.authority?.control_liveness_strict_reason === 'closed_transition_social_dead_end' &&
      socialLivenessResult.packet.bubbles[0]?.text === 'hey im good over here',
      JSON.stringify({ socialLivenessCalls, authority: socialLivenessResult.authority, packet: socialLivenessResult.packet }))

    // Live Omar.system regression 2026-07-25: "is it free?" was misrouted as
    // social, three candidates were rejected for host motion, then a salesy
    // non-answer was adopted through the social liveness floor. The direct price
    // obligation must own the route before generation, reject the bad packet, and
    // adopt only a fresh candidate containing both the locked hourly rate and
    // style condition.
    const freePriceThreadId = 'single-control-free-price-thread'
    const freePriceInbound = {
      contact_id: freePriceThreadId,
      thread_id: freePriceThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-free-price-message',
      text: 'By the way, is it free?',
      received_at: '2026-07-25T13:03:01.296Z'
    }
    recordIngressEvent(root, freePriceInbound)
    let freePriceCalls = 0
    let freePriceRepairLock = ''
    const freePriceResult = executeSingleControlTurn(freePriceInbound, {
      root,
      authority_options: { recent_history_override: [] },
      candidateGenerator: (_msg, opts) => {
        freePriceCalls += 1
        if (freePriceCalls > 1) freePriceRepairLock = String(opts.control_transition_repair || '')
        const bad = freePriceCalls === 1
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: bad ? 'salesy price deflection' : 'direct locked model rate',
          packet: bad
            ? { bubbles: [
                { text: "haha no it's not free but i promise it's worth every penny" },
                { text: "what's got you curious about that today?" }
              ] }
            : { bubbles: [{ text: "nah the discounted model rate is 150 per hour as long as we're keeping the design in my style" }] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check(
      'free_price_rejection_reauthors_and_adopts_direct_answer_without_social_liveness',
      freePriceCalls === 2 &&
        freePriceResult.authority?.closed_transition_action === 'general_continue' &&
        freePriceResult.authority?.closed_transition_reason === 'direct_question_obligation_owns_turn_without_cold_funnel_push' &&
        freePriceResult.authority?.closed_transition_obligations?.includes('answer_model_rate') &&
        freePriceResult.authority?.control_liveness_adopted !== true &&
        freePriceResult.authority?.control_candidate_passes === 2 &&
        freePriceResult.authority?.control_verifier_rejection_count >= 1 &&
        freePriceResult.authority?.control_repair_loop_version === CONTROL_REPAIR_LOOP_VERSION &&
        freePriceRepairLock.includes('pricing_question_requires_visible_answer') &&
        freePriceRepairLock.includes('CONTROLLER VERIFIER FEEDBACK LOOP') &&
        /150\s+per\s+hour/i.test(String(freePriceResult.packet?.bubbles?.[0]?.text || '')) &&
        /\bmy\s+style\b/i.test(String(freePriceResult.packet?.bubbles?.[0]?.text || '')),
      JSON.stringify({ freePriceCalls, freePriceRepairLock, authority: freePriceResult.authority, packet: freePriceResult.packet })
    )

    // A child runner can exhaust its executed post-filter pass and return only a
    // typed verifier reason. The outer controller must feed that exact reason
    // back into a new route/executor candidate instead of stopping or replacing
    // it with a generic generation error.
    const returnedFeedbackThreadId = 'single-control-returned-verifier-feedback-thread'
    const returnedFeedbackInbound = {
      ...freePriceInbound,
      contact_id: returnedFeedbackThreadId,
      thread_id: returnedFeedbackThreadId,
      message_id: 'single-control-returned-verifier-feedback-message'
    }
    recordIngressEvent(root, returnedFeedbackInbound)
    let returnedFeedbackCalls = 0
    let returnedFeedbackRepairLock = ''
    const returnedFeedbackResult = executeSingleControlTurn(returnedFeedbackInbound, {
      root,
      authority_options: { recent_history_override: [] },
      candidateGenerator: (_msg, opts) => {
        returnedFeedbackCalls += 1
        if (returnedFeedbackCalls === 1) {
          throw new Error('post_filter_adoption_rejected_pricing_question_requires_visible_answer')
        }
        returnedFeedbackRepairLock = String(opts.control_transition_repair || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'verifier_feedback_reauthor' },
          raw_text: 'fresh direct model-rate answer after returned verifier reason',
          packet: { bubbles: [{ text: "not free the discounted model rate is 150 per hour when the piece stays in my style" }] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check(
      'runner_verifier_rejection_returns_exact_reason_to_outer_reauthor_loop',
      returnedFeedbackCalls === 2 &&
        returnedFeedbackRepairLock.includes('post_filter_adoption') &&
        returnedFeedbackRepairLock.includes('pricing_question_requires_visible_answer') &&
        returnedFeedbackResult.authority?.control_candidate_passes === 2 &&
        returnedFeedbackResult.authority?.control_verifier_rejection_reasons?.includes('post_filter_adoption:pricing_question_requires_visible_answer') &&
        /150\s+per\s+hour/i.test(String(returnedFeedbackResult.packet?.bubbles?.[0]?.text || '')),
      JSON.stringify({
        returnedFeedbackCalls,
        returnedFeedbackRepairLock,
        authority: returnedFeedbackResult.authority,
        packet: returnedFeedbackResult.packet
      })
    )

    const durableFeedbackThreadId = 'single-control-durable-feedback-thread'
    const durableFeedbackInbound = {
      ...freePriceInbound,
      contact_id: durableFeedbackThreadId,
      thread_id: durableFeedbackThreadId,
      message_id: 'single-control-durable-feedback-message',
      control_repair_cycle: 3,
      control_repair_ledger: [{
        pass: 12,
        cycle: 2,
        phase: 'post_filter_adoption',
        reason: 'pricing_question_requires_visible_answer',
        instruction: 'answer the direct pricing question instead of deflecting',
        route_action: 'general_continue',
        candidate_sha256: 'b'.repeat(64),
        repeated_candidate: true
      }]
    }
    recordIngressEvent(root, durableFeedbackInbound)
    let durableFeedbackRepairLock = ''
    const durableFeedbackResult = executeSingleControlTurn(durableFeedbackInbound, {
      root,
      authority_options: { recent_history_override: [] },
      candidateGenerator: (_msg, opts) => {
        durableFeedbackRepairLock = String(opts.control_transition_repair || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'durable_feedback_reauthor' },
          raw_text: 'durable feedback direct model-rate answer',
          packet: { bubbles: [{ text: "it isnt free my discounted model rate is 150 per hour for work kept in my style" }] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check(
      'durable_retry_rehydrates_prior_verifier_feedback_before_first_new_candidate',
      durableFeedbackRepairLock.includes('pricing_question_requires_visible_answer') &&
        durableFeedbackRepairLock.includes('repeated a previously rejected candidate') &&
        durableFeedbackResult.authority?.control_candidate_passes === 1 &&
        durableFeedbackResult.authority?.control_repair_cycle === 3 &&
        /150\s+per\s+hour/i.test(String(durableFeedbackResult.packet?.bubbles?.[0]?.text || '')),
      JSON.stringify({
        durableFeedbackRepairLock,
        authority: durableFeedbackResult.authority,
        packet: durableFeedbackResult.packet
      })
    )

    // Exact live Omar.system compound-turn regression 2026-07-25. The client
    // accepted the form offer, then sent a price side-question before the first
    // physical inbound committed. The one-way controller must adopt both direct
    // client instructions as one atomic turn instead of routing only the latest
    // price text and deadlocking against the runner's pending-form verifier.
    const compoundFormPriceThreadId = 'single-control-compound-form-price-thread'
    const compoundFormPriceInbound = {
      contact_id: compoundFormPriceThreadId,
      thread_id: compoundFormPriceThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-compound-form-price-message',
      text: 'By the way, is is it free?',
      received_at: '2026-07-25T14:41:32.225Z'
    }
    const compoundFormPriceHistory = [
      {
        role: 'assistant',
        message_id: 'compound-form-offer',
        text: 'once you are ready i will send over the form so we can confirm a date'
      },
      {
        role: 'user',
        message_id: 'compound-form-consent',
        text: 'OK, send it over'
      }
    ]
    recordIngressEvent(root, compoundFormPriceInbound)
    let compoundFormPriceCalls = 0
    const compoundFormPriceResult = executeSingleControlTurn(compoundFormPriceInbound, {
      root,
      authority_options: { recent_history_override: compoundFormPriceHistory },
      candidateGenerator: (_msg, opts) => {
        compoundFormPriceCalls += 1
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'atomic compound form and price answer',
          packet: {
            bubbles: [
              { text: "it isnt free the discounted model rate is 150 per hour when we're keeping the piece in my style" },
              { text: `here is the form ${PREFERRED_FORM_LINK}` },
              { text: 'once it is in, send me a couple days here too so i can check what works' }
            ]
          },
          structured_state: {
            ...opts.structured_state_override,
            tattoo_intent_active: true,
            known_design_context: 'black and gray portrait',
            form_offer_asked: true,
            form_link_sent: false,
            booking_stage_hint: 'awaiting_form_permission_answer'
          },
          intent_adoption_state: {},
          recent_history: compoundFormPriceHistory
        }
      }
    })
    check(
      'compound_form_consent_and_price_commit_once_without_verifier_deadlock',
      compoundFormPriceCalls === 1 &&
        compoundFormPriceResult.authority?.closed_transition_action === 'send_form' &&
        compoundFormPriceResult.authority?.closed_transition_reason === 'explicit_form_request_or_open_offer_consent' &&
        compoundFormPriceResult.authority?.closed_transition_obligations?.includes('answer_model_rate') &&
        compoundFormPriceResult.authority?.control_candidate_passes === 1 &&
        compoundFormPriceResult.packet.bubbles.filter((bubble) => String(bubble.text || '').includes(PREFERRED_FORM_LINK)).length === 1 &&
        /150\s+per\s+hour/i.test(compoundFormPriceResult.packet.bubbles.map((bubble) => bubble.text).join('\n')),
      JSON.stringify({
        compoundFormPriceCalls,
        authority: compoundFormPriceResult.authority,
        packet: compoundFormPriceResult.packet
      })
    )

    // Production requires a Responses receipt for model-authored copy. The
    // bounded SEND_FORM checkpoint is intentionally deterministic after three
    // rejected model drafts, like the exact double-check/deposit checkpoints.
    // Its narrowly validated packet must therefore remain live under the real
    // production flag, while any forged or under-budget lookalike stays denied.
    const sendFormRecoveryThreadId = 'single-control-send-form-recovery-receipt-thread'
    const sendFormRecoveryHistory = [
      { role: 'assistant', text: 'want me to send the application form?' }
    ]
    fs.writeFileSync(path.join(root, 'thread-state', `${sendFormRecoveryThreadId}.json`), JSON.stringify({
      contact_id: sendFormRecoveryThreadId,
      thread_id: sendFormRecoveryThreadId,
      tattoo_intent_active: true,
      known_design_context: 'black and gray snake',
      form_offer_asked: true
    }, null, 2) + '\n')
    const sendFormRecoveryInbound = {
      contact_id: sendFormRecoveryThreadId,
      thread_id: sendFormRecoveryThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-send-form-recovery-receipt-message',
      text: 'yes please',
      received_at: '2026-08-25T20:05:00.000Z'
    }
    recordIngressEvent(root, sendFormRecoveryInbound)
    let sendFormRecoveryResult = null
    let sendFormRecoveryError = ''
    process.env.SCV_OPENAI_RESPONSES_REQUIRED = '1'
    try {
      sendFormRecoveryResult = executeSingleControlTurn(sendFormRecoveryInbound, {
        root,
        authority_options: { recent_history_override: sendFormRecoveryHistory },
        candidateGenerator: (_msg, opts) => {
          const structuredState = {
            ...opts.structured_state_override,
            live_turn_form_consent: true
          }
          const packet = buildDeterministicRecoveryPacket({
            message: sendFormRecoveryInbound.text,
            live_message: sendFormRecoveryInbound.text,
            recent_history: sendFormRecoveryHistory,
            structured_state: structuredState,
            control_transition_contract: opts.control_transition_contract
          }, null, {
            model_drafts_exhausted: true,
            model_candidate_count: SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES
          })
          return {
            source: 'codex_exec_dm_authority',
            authority: {
              runner: 'codex exec',
              executor: 'deterministic_send_form_checkpoint_after_model_exhaustion',
              deterministic_recovery: true,
              deterministic_recovery_kind: 'send_form_checkpoint',
              deterministic_recovery_version: DETERMINISTIC_RECOVERY_VERSION,
              model_candidate_count: SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES,
              openai_conversation: null
            },
            raw_text: packet.reply_text,
            packet,
            structured_state: structuredState,
            intent_adoption_state: { live_turn_form_consent: true },
            recent_history: sendFormRecoveryHistory
          }
        }
      })
    } catch (error) {
      sendFormRecoveryError = String(error?.message || error)
    } finally {
      process.env.SCV_OPENAI_RESPONSES_REQUIRED = '0'
    }
    check('production_responses_required_allows_exact_send_form_checkpoint_after_budget',
      !sendFormRecoveryError &&
        sendFormRecoveryResult?.authority?.closed_transition_action === 'send_form' &&
        sendFormRecoveryResult?.structured_state?.form_link_sent === true &&
        sendFormRecoveryResult?.authority?.candidate_authority?.openai_conversation === null &&
        sendFormRecoveryResult?.packet?.reply_text?.split(PREFERRED_FORM_LINK).length - 1 === 1,
      JSON.stringify({ sendFormRecoveryError, sendFormRecoveryResult }))

    const forgedRecoveryThreadId = 'single-control-forged-send-form-recovery-thread'
    fs.writeFileSync(path.join(root, 'thread-state', `${forgedRecoveryThreadId}.json`), JSON.stringify({
      contact_id: forgedRecoveryThreadId,
      thread_id: forgedRecoveryThreadId,
      tattoo_intent_active: true,
      known_design_context: 'black and gray snake',
      form_offer_asked: true
    }, null, 2) + '\n')
    const forgedRecoveryInbound = {
      ...sendFormRecoveryInbound,
      contact_id: forgedRecoveryThreadId,
      thread_id: forgedRecoveryThreadId,
      message_id: 'single-control-forged-send-form-recovery-message'
    }
    recordIngressEvent(root, forgedRecoveryInbound)
    let forgedRecoveryError = ''
    process.env.SCV_OPENAI_RESPONSES_REQUIRED = '1'
    try {
      executeSingleControlTurn(forgedRecoveryInbound, {
        root,
        authority_options: { recent_history_override: sendFormRecoveryHistory },
        candidateGenerator: (_msg, opts) => {
          const structuredState = {
            ...opts.structured_state_override,
            live_turn_form_consent: true
          }
          const packet = buildDeterministicRecoveryPacket({
            message: forgedRecoveryInbound.text,
            live_message: forgedRecoveryInbound.text,
            recent_history: sendFormRecoveryHistory,
            structured_state: structuredState,
            control_transition_contract: opts.control_transition_contract
          }, null, {
            model_drafts_exhausted: true,
            model_candidate_count: SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES
          })
          return {
            source: 'codex_exec_dm_authority',
            authority: {
              runner: 'codex exec',
              executor: 'deterministic_send_form_checkpoint_after_model_exhaustion',
              deterministic_recovery: true,
              deterministic_recovery_kind: 'send_form_checkpoint',
              deterministic_recovery_version: DETERMINISTIC_RECOVERY_VERSION,
              model_candidate_count: SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES - 1,
              openai_conversation: null
            },
            raw_text: packet.reply_text,
            packet,
            structured_state: structuredState,
            intent_adoption_state: { live_turn_form_consent: true },
            recent_history: sendFormRecoveryHistory
          }
        }
      })
    } catch (error) {
      forgedRecoveryError = String(error?.message || error)
    } finally {
      process.env.SCV_OPENAI_RESPONSES_REQUIRED = '0'
    }
    check('production_responses_required_rejects_under_budget_send_form_lookalike',
      forgedRecoveryError === 'single_control_openai_conversation_receipt_required',
      forgedRecoveryError)

    const rejectedFreePriceThreadId = 'single-control-free-price-all-bad-thread'
    const rejectedFreePriceInbound = {
      ...freePriceInbound,
      contact_id: rejectedFreePriceThreadId,
      thread_id: rejectedFreePriceThreadId,
      message_id: 'single-control-free-price-all-bad-message'
    }
    recordIngressEvent(root, rejectedFreePriceInbound)
    let rejectedFreePriceCalls = 0
    let rejectedFreePriceError = ''
    let rejectedFreePriceRetryContext = null
    try {
      executeSingleControlTurn(rejectedFreePriceInbound, {
        root,
        authority_options: { recent_history_override: [] },
        candidateGenerator: (_msg, opts) => {
          rejectedFreePriceCalls += 1
          return {
            source: 'codex_exec_dm_authority',
            authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
            raw_text: 'repeated salesy price deflection',
            packet: { bubbles: [{ text: "no but i promise it's worth every penny" }] },
            structured_state: { ...opts.structured_state_override },
            intent_adoption_state: {},
            recent_history: []
          }
        }
      })
    } catch (err) {
      rejectedFreePriceError = String(err?.message || err)
      rejectedFreePriceRetryContext = err?.control_retry_context || null
    }
    check(
      'free_price_all_bad_candidates_fail_closed_without_liveness_adoption',
      rejectedFreePriceCalls === DEFAULT_CONTROL_REAUTHOR_PASSES &&
        /single_control_internal_retryable:final_verifier_rejected:semantic:pricing_question_requires_visible_answer/.test(rejectedFreePriceError) &&
        rejectedFreePriceRetryContext?.version === CONTROL_REPAIR_LOOP_VERSION &&
        rejectedFreePriceRetryContext?.retry_cycle === 1 &&
        rejectedFreePriceRetryContext?.rejection_ledger?.length >= DEFAULT_CONTROL_REAUTHOR_PASSES &&
        rejectedFreePriceRetryContext?.rejection_ledger?.length <= 12 &&
        rejectedFreePriceRetryContext?.rejection_ledger?.some((entry) => entry.repeated_candidate === true),
      JSON.stringify({
        rejectedFreePriceCalls,
        DEFAULT_CONTROL_REAUTHOR_PASSES,
        rejectedFreePriceError,
        rejectedFreePriceRetryContext
      })
    )

    // Live regression: the intent model mislabeled generic tattoo interest as a
    // finished design brief. Candidate state cannot author that transition.
    const genericTattooThreadId = 'single-control-generic-tattoo-interest-thread'
    const genericTattooInbound = {
      contact_id: genericTattooThreadId,
      thread_id: genericTattooThreadId,
      instagram_username: 'single.control.generic.tattoo',
      message_id: 'single-control-generic-tattoo-interest-message',
      text: 'doing good. i wanted to ask about getting a tattoo',
      received_at: '2026-07-14T20:01:00.000Z'
    }
    recordIngressEvent(root, genericTattooInbound)
    const genericTattooResult = executeSingleControlTurn(genericTattooInbound, {
      root,
      authority_options: { recent_history_override: [] },
      candidateGenerator: (_msg, opts) => ({
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'design intake after contaminated intent candidate',
        packet: { bubbles: [{ text: 'yeah for sure what kind of idea have you been thinking about for it?' }] },
        structured_state: {
          ...opts.structured_state_override,
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true,
          live_turn_gave_design_idea: true,
          known_design_context: 'doing good. i wanted to ask about getting a tattoo'
        },
        intent_adoption_state: {
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true,
          live_turn_gave_design_idea: true
        },
        recent_history: []
      })
    })
    check('generic_tattoo_interest_cannot_be_promoted_to_form_offer_by_candidate_state',
      genericTattooResult.authority?.closed_transition_action === 'design_intake' &&
      !String(genericTattooResult.structured_state?.known_design_context || '').trim() &&
      genericTattooResult.structured_state?.form_offer_asked !== true &&
      !/form|apply/i.test(genericTattooResult.packet.bubbles.map((bubble) => bubble.text).join(' ')),
      JSON.stringify(genericTattooResult))

    // Live regression 2026-07-18: a complete first-turn moth brief was routed as
    // design intake because the subject was outside a closed motif dictionary.
    // The first one-way action must now be OFFER_FORM and the same packet must
    // survive final verification without a retry/silence loop.
    const openVocabularyThreadId = 'single-control-open-vocabulary-design-thread'
    const openVocabularyText = "Hi, I'm thinking about a colorful moth on my shoulder, around 4 by 4 inches."
    const openVocabularyInbound = {
      contact_id: openVocabularyThreadId,
      thread_id: openVocabularyThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-open-vocabulary-design-message',
      text: openVocabularyText,
      received_at: '2026-07-18T04:05:22.549Z'
    }
    recordIngressEvent(root, openVocabularyInbound)
    let openVocabularyFirstAction = ''
    let openVocabularyCalls = 0
    const openVocabularyResult = executeSingleControlTurn(openVocabularyInbound, {
      root,
      authority_options: { recent_history_override: [] },
      candidateGenerator: (_msg, opts) => {
        openVocabularyCalls += 1
        if (!openVocabularyFirstAction) openVocabularyFirstAction = String(opts.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'open vocabulary design form offer',
          packet: { bubbles: [
            { text: 'yeah colorful moth on the shoulder around 4 by 4 is clear, we can dial the exact placement and sizing in at the appointment' },
            { text: 'want me to send the form over so we can start moving it forward?' }
          ] },
          structured_state: {
            ...opts.structured_state_override,
            known_design_context: openVocabularyText,
            known_placement_context: openVocabularyText,
            known_size_context: openVocabularyText,
            tattoo_intent_active: true,
            live_turn_gave_design_idea: true
          },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('unknown_motif_first_route_is_offer_form_and_commits_without_retry',
      openVocabularyFirstAction === 'offer_form' &&
      openVocabularyCalls === 1 &&
      openVocabularyResult.authority?.closed_transition_action === 'offer_form' &&
      openVocabularyResult.structured_state?.form_offer_asked === true &&
      openVocabularyResult.structured_state?.known_design_context === openVocabularyText &&
      /form/i.test(openVocabularyResult.packet.bubbles.map((bubble) => bubble.text).join(' ')),
      JSON.stringify({ openVocabularyFirstAction, openVocabularyCalls, openVocabularyResult }))

    // Live regression 2026-07-25: a client-supplied Joji screenshot was labeled
    // `non_tattoo` by vision even though the client explicitly granted creative
    // freedom within the Joji subject. File category cannot override current
    // client design authority or reopen a design interview.
    const jojiCreativeThreadId = 'single-control-joji-creative-freedom'
    fs.writeFileSync(path.join(root, 'thread-state', `${jojiCreativeThreadId}.json`), JSON.stringify({
      contact_id: jojiCreativeThreadId,
      thread_id: jojiCreativeThreadId,
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake',
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }, null, 2) + '\n')
    appendControlHistoryEvent(root, {
      contact_id: jojiCreativeThreadId,
      thread_id: jojiCreativeThreadId,
      message_id: 'joji-pointer',
      text: "I'm thinking of this one"
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: jojiCreativeThreadId,
      thread_id: jojiCreativeThreadId,
      message_id: 'joji-reference-request',
      bubble_index: 0,
      bubble: { text: 'send me the actual photo or reference so i can see it' }
    }, 'assistant')
    appendControlHistoryEvent(root, {
      contact_id: jojiCreativeThreadId,
      thread_id: jojiCreativeThreadId,
      message_id: 'joji-image',
      text: 'sent a reference post: The image shows a screenshot of a media app displaying several portrait photos of a singer named Joji.'
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: jojiCreativeThreadId,
      thread_id: jojiCreativeThreadId,
      message_id: 'joji-apology',
      text: 'Sorry, my bad'
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: jojiCreativeThreadId,
      thread_id: jojiCreativeThreadId,
      message_id: 'joji-selection-question',
      bubble_index: 0,
      bubble: { text: 'what part of that image or Joji were you thinking about for your piece?' }
    }, 'assistant')
    const jojiCreativeInbound = {
      contact_id: jojiCreativeThreadId,
      thread_id: jojiCreativeThreadId,
      instagram_username: 'omar.system',
      message_id: 'joji-creative-answer',
      text: 'You can choose anything you want if its related to Joji',
      received_at: '2026-07-25T21:30:00.000Z'
    }
    recordIngressEvent(root, jojiCreativeInbound)
    let jojiCreativeFirstAction = ''
    let jojiCreativeCalls = 0
    const jojiCreativeResult = executeSingleControlTurn(jojiCreativeInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        jojiCreativeCalls += 1
        if (!jojiCreativeFirstAction) jojiCreativeFirstAction = String(opts.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'joji creative freedom form offer',
          packet: { bubbles: [
            { text: 'yeah i can build a custom Joji piece from that and keep the composition open on my side' },
            { text: 'want me to send the application form over?' }
          ] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('joji_subject_bounded_creative_freedom_is_one_pass_offer_form',
      jojiCreativeFirstAction === 'offer_form' &&
      jojiCreativeCalls === 1 &&
      jojiCreativeResult.authority?.closed_transition_action === 'offer_form' &&
      jojiCreativeResult.structured_state?.form_offer_asked === true,
      JSON.stringify({ jojiCreativeFirstAction, jojiCreativeCalls, jojiCreativeResult }))

    // The same authority must hold when the client names one required element
    // after the studio asks a visual-selection question. "His face" is enough;
    // the controller must not let `non_tattoo` classification demand another
    // part/vibe question.
    const jojiFaceThreadId = 'single-control-joji-required-element'
    fs.writeFileSync(path.join(root, 'thread-state', `${jojiFaceThreadId}.json`), JSON.stringify({
      contact_id: jojiFaceThreadId,
      thread_id: jojiFaceThreadId,
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake',
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }, null, 2) + '\n')
    appendControlHistoryEvent(root, {
      contact_id: jojiFaceThreadId,
      thread_id: jojiFaceThreadId,
      message_id: 'joji-face-image',
      text: 'sent a reference post: The image shows a screenshot with portrait photos of a singer.'
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: jojiFaceThreadId,
      thread_id: jojiFaceThreadId,
      message_id: 'joji-face-question',
      bubble_index: 0,
      bubble: { text: 'is there a specific part or vibe from him you want for your piece?' }
    }, 'assistant')
    const jojiFaceInbound = {
      contact_id: jojiFaceThreadId,
      thread_id: jojiFaceThreadId,
      instagram_username: 'omar.system',
      message_id: 'joji-face-answer',
      text: 'At least his face needs to be included',
      received_at: '2026-07-25T21:31:00.000Z'
    }
    recordIngressEvent(root, jojiFaceInbound)
    let jojiFaceFirstAction = ''
    let jojiFaceCalls = 0
    const jojiFaceResult = executeSingleControlTurn(jojiFaceInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        jojiFaceCalls += 1
        if (!jojiFaceFirstAction) jojiFaceFirstAction = String(opts.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'joji required face element form offer',
          packet: { bubbles: [
            { text: 'keeping his face in it gives me enough to build a custom piece around' },
            { text: 'want me to send the form?' }
          ] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('joji_required_face_element_is_one_pass_offer_form',
      jojiFaceFirstAction === 'offer_form' &&
      jojiFaceCalls === 1 &&
      jojiFaceResult.authority?.closed_transition_action === 'offer_form' &&
      jojiFaceResult.structured_state?.form_offer_asked === true,
      JSON.stringify({ jojiFaceFirstAction, jojiFaceCalls, jojiFaceResult }))

    // Exact live transport omission: Safari/Instagram rendered the image, but
    // ManyChat never emitted a media ingress event. Backend history contained
    // only pointer -> assistant media request -> correction/selector. The first
    // bad candidate must be rejected and re-authored under the same OFFER_FORM
    // route; the thread may neither clarify again nor go silent.
    const transportShadowThreadId = 'single-control-transport-shadow-requested-reference'
    fs.writeFileSync(path.join(root, 'thread-state', `${transportShadowThreadId}.json`), JSON.stringify({
      contact_id: transportShadowThreadId,
      thread_id: transportShadowThreadId,
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake'
    }, null, 2) + '\n')
    appendControlHistoryEvent(root, {
      contact_id: transportShadowThreadId,
      thread_id: transportShadowThreadId,
      message_id: 'transport-shadow-pointer',
      text: "I'm thinking of something like this"
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: transportShadowThreadId,
      thread_id: transportShadowThreadId,
      message_id: 'transport-shadow-reference-request',
      bubble_index: 0,
      bubble: { text: 'ooo can you drop the pic or send the reference over? it might not have come through' }
    }, 'assistant')
    const transportShadowInbound = {
      contact_id: transportShadowThreadId,
      thread_id: transportShadowThreadId,
      instagram_username: 'omar.system',
      message_id: 'transport-shadow-correction',
      text: 'Sorry, my bad this one',
      received_at: '2026-07-26T11:07:29.739Z'
    }
    recordIngressEvent(root, transportShadowInbound)
    const transportShadowActions = []
    let transportShadowCalls = 0
    let transportShadowStateObserved = false
    const transportShadowResult = executeSingleControlTurn(transportShadowInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        transportShadowCalls += 1
        transportShadowActions.push(String(opts.control_transition_contract?.action || ''))
        transportShadowStateObserved = transportShadowStateObserved || Boolean(
          opts.structured_state_override?.live_turn_transport_shadow_reference === true &&
          opts.structured_state_override?.live_turn_reference_authority_kind === 'transport_shadow_requested_reference'
        )
        if (transportShadowCalls === 1) {
          return {
            source: 'codex_exec_dm_authority',
            authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
            raw_text: 'invalid missing-image clarification',
            packet: { bubbles: [
              { text: "sorry i’m a little lost here what exactly are you referring to?" }
            ] },
            structured_state: { ...opts.structured_state_override },
            intent_adoption_state: {},
            recent_history: []
          }
        }
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'transport-shadow generic form offer',
          packet: { bubbles: [
            { text: 'all good, i can work from that and make the piece custom from there' },
            { text: 'want me to send the application form over?' }
          ] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('transport_shadow_rejects_clarification_and_reauthors_offer_form',
      transportShadowCalls === 2 &&
      transportShadowActions.length === 2 &&
      transportShadowActions.every((action) => action === 'offer_form') &&
      transportShadowStateObserved === true &&
      transportShadowResult.authority?.closed_transition_action === 'offer_form' &&
      transportShadowResult.authority?.control_candidate_passes === 2 &&
      transportShadowResult.structured_state?.form_offer_asked === true &&
      !/not seeing|lost here|send it again|drop it again/i.test(
        transportShadowResult.packet.bubbles.map((bubble) => bubble.text).join(' ')
      ),
      JSON.stringify({
        transportShadowCalls,
        transportShadowActions,
        transportShadowStateObserved,
        transportShadowResult
      }))

    // If an older release already emitted the bad visual-selection question,
    // the client's answer remains attached to the same transport-shadow chain.
    // Their current text names "number", so that client-supplied detail may be
    // used; the missing-image loop still may not reopen.
    const transportShadowNumberThreadId = 'single-control-transport-shadow-number-followup'
    fs.writeFileSync(path.join(root, 'thread-state', `${transportShadowNumberThreadId}.json`), JSON.stringify({
      contact_id: transportShadowNumberThreadId,
      thread_id: transportShadowNumberThreadId,
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake'
    }, null, 2) + '\n')
    appendControlHistoryEvent(root, {
      contact_id: transportShadowNumberThreadId,
      thread_id: transportShadowNumberThreadId,
      message_id: 'transport-shadow-number-pointer',
      text: "I'm thinking of something like this"
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: transportShadowNumberThreadId,
      thread_id: transportShadowNumberThreadId,
      message_id: 'transport-shadow-number-request',
      bubble_index: 0,
      bubble: { text: 'send me the actual image or reference' }
    }, 'assistant')
    appendControlHistoryEvent(root, {
      contact_id: transportShadowNumberThreadId,
      thread_id: transportShadowNumberThreadId,
      message_id: 'transport-shadow-number-correction',
      text: 'Sorry, my bad this one'
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: transportShadowNumberThreadId,
      thread_id: transportShadowNumberThreadId,
      message_id: 'transport-shadow-number-question',
      bubble_index: 0,
      bubble: { text: 'what part of this direction feels right to you or is catching your eye?' }
    }, 'assistant')
    const transportShadowNumberInbound = {
      contact_id: transportShadowNumberThreadId,
      thread_id: transportShadowNumberThreadId,
      instagram_username: 'omar.system',
      message_id: 'transport-shadow-number-answer',
      text: "I don't know, I just like that number",
      received_at: '2026-07-26T11:08:10.000Z'
    }
    recordIngressEvent(root, transportShadowNumberInbound)
    let transportShadowNumberCalls = 0
    let transportShadowNumberFirstAction = ''
    let transportShadowNumberStateObserved = false
    const transportShadowNumberResult = executeSingleControlTurn(transportShadowNumberInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        transportShadowNumberCalls += 1
        if (!transportShadowNumberFirstAction) {
          transportShadowNumberFirstAction = String(opts.control_transition_contract?.action || '')
        }
        transportShadowNumberStateObserved = Boolean(
          opts.structured_state_override?.live_turn_transport_shadow_reference === true &&
          opts.structured_state_override?.live_turn_reference_authority_kind === 'transport_shadow_requested_reference'
        )
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'transport-shadow client-named number form offer',
          packet: { bubbles: [
            { text: 'yeah the number is enough, i can build the custom piece around that' },
            { text: 'want me to send the form over?' }
          ] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('transport_shadow_number_followup_is_one_pass_offer_form',
      transportShadowNumberFirstAction === 'offer_form' &&
      transportShadowNumberCalls === 1 &&
      transportShadowNumberStateObserved === true &&
      transportShadowNumberResult.authority?.closed_transition_action === 'offer_form' &&
      transportShadowNumberResult.structured_state?.form_offer_asked === true &&
      !/not seeing|send it again|drop it again/i.test(
        transportShadowNumberResult.packet.bubbles.map((bubble) => bubble.text).join(' ')
      ),
      JSON.stringify({
        transportShadowNumberFirstAction,
        transportShadowNumberCalls,
        transportShadowNumberStateObserved,
        transportShadowNumberResult
      }))

    // If the requested image is superseded by an adjacent lightweight
    // correction/selector before vision finishes, the latest event still owns
    // the already-fulfilled reference pair. This exact live shape ("sorry, my
    // bad this one") previously quarantined the image and reopened a fake
    // design interview.
    const supersededReferenceThreadId = 'single-control-requested-image-superseded-by-apology'
    fs.writeFileSync(path.join(root, 'thread-state', `${supersededReferenceThreadId}.json`), JSON.stringify({
      contact_id: supersededReferenceThreadId,
      thread_id: supersededReferenceThreadId,
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake',
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }, null, 2) + '\n')
    appendControlHistoryEvent(root, {
      contact_id: supersededReferenceThreadId,
      thread_id: supersededReferenceThreadId,
      message_id: 'superseded-pointer',
      text: "I'm thinking of this one"
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: supersededReferenceThreadId,
      thread_id: supersededReferenceThreadId,
      message_id: 'superseded-reference-request',
      bubble_index: 0,
      bubble: { text: 'send me the actual image or reference' }
    }, 'assistant')
    appendControlHistoryEvent(root, {
      contact_id: supersededReferenceThreadId,
      thread_id: supersededReferenceThreadId,
      message_id: 'superseded-image',
      text: 'sent a reference post: The image shows a screenshot with several portrait photos.'
    }, 'user')
    const supersededReferenceInbound = {
      contact_id: supersededReferenceThreadId,
      thread_id: supersededReferenceThreadId,
      instagram_username: 'omar.system',
      message_id: 'superseded-apology',
      text: 'Sorry, my bad this one',
      received_at: '2026-07-25T21:32:00.000Z'
    }
    recordIngressEvent(root, supersededReferenceInbound)
    let supersededReferenceFirstAction = ''
    const supersededReferenceResult = executeSingleControlTurn(supersededReferenceInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        if (!supersededReferenceFirstAction) supersededReferenceFirstAction = String(opts.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'requested image survived supersession',
          packet: { bubbles: [
            { text: 'all good, i can use that as the base and customize the piece from there' },
            { text: 'want me to send the application form over?' }
          ] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('requested_image_supersession_is_one_way_offer_form',
      supersededReferenceFirstAction === 'offer_form' &&
      supersededReferenceResult.authority?.closed_transition_action === 'offer_form' &&
      supersededReferenceResult.structured_state?.form_offer_asked === true,
      JSON.stringify({ supersededReferenceFirstAction, supersededReferenceResult }))

    // Recovery must also work if the previously deployed controller already
    // emitted the invalid visual-selection question. The client's grounded
    // answer ("I just like that number") still belongs to the requested image
    // and must move forward rather than hallucinating that the image is absent.
    const requestedNumberFollowupThreadId = 'single-control-requested-number-reference-followup'
    fs.writeFileSync(path.join(root, 'thread-state', `${requestedNumberFollowupThreadId}.json`), JSON.stringify({
      contact_id: requestedNumberFollowupThreadId,
      thread_id: requestedNumberFollowupThreadId,
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake',
      reference_media_classification_observed: true,
      known_reference_media_received: true
    }, null, 2) + '\n')
    appendControlHistoryEvent(root, {
      contact_id: requestedNumberFollowupThreadId,
      thread_id: requestedNumberFollowupThreadId,
      message_id: 'number-pointer',
      text: "I'm thinking of something like this"
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: requestedNumberFollowupThreadId,
      thread_id: requestedNumberFollowupThreadId,
      message_id: 'number-reference-request',
      bubble_index: 0,
      bubble: { text: 'send me the actual image or reference' }
    }, 'assistant')
    appendControlHistoryEvent(root, {
      contact_id: requestedNumberFollowupThreadId,
      thread_id: requestedNumberFollowupThreadId,
      message_id: 'number-reference-image',
      text: 'sent a reference post: The image shows a smartphone screen displaying the number "1249" in large white digits.',
      text_source: 'reference_post.message_text|single_control_media_context_enriched'
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: requestedNumberFollowupThreadId,
      thread_id: requestedNumberFollowupThreadId,
      message_id: 'number-reference-correction',
      text: 'Sorry, my bad this one'
    }, 'user')
    appendControlHistoryEvent(root, {
      contact_id: requestedNumberFollowupThreadId,
      thread_id: requestedNumberFollowupThreadId,
      message_id: 'number-selection-question',
      bubble_index: 0,
      bubble: { text: 'what part of this direction feels right to you or is catching your eye?' }
    }, 'assistant')
    const requestedNumberFollowupInbound = {
      contact_id: requestedNumberFollowupThreadId,
      thread_id: requestedNumberFollowupThreadId,
      instagram_username: 'omar.system',
      message_id: 'number-selection-answer',
      text: "I don't know, I just like that number",
      received_at: '2026-07-25T21:33:00.000Z'
    }
    recordIngressEvent(root, requestedNumberFollowupInbound)
    let requestedNumberFollowupFirstAction = ''
    let requestedNumberFollowupCalls = 0
    const requestedNumberFollowupResult = executeSingleControlTurn(requestedNumberFollowupInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        requestedNumberFollowupCalls += 1
        if (!requestedNumberFollowupFirstAction) {
          requestedNumberFollowupFirstAction = String(opts.control_transition_contract?.action || '')
        }
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'requested number reference followup form offer',
          packet: { bubbles: [
            { text: 'yeah the number is enough, i can build the custom piece around that' },
            { text: 'want me to send the application form over?' }
          ] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('requested_number_followup_is_one_pass_offer_form_not_missing_attachment',
      requestedNumberFollowupFirstAction === 'offer_form' &&
      requestedNumberFollowupCalls === 1 &&
      requestedNumberFollowupResult.authority?.closed_transition_action === 'offer_form' &&
      requestedNumberFollowupResult.structured_state?.form_offer_asked === true &&
      !/not seeing|send it again|drop it again/i.test(
        requestedNumberFollowupResult.packet.bubbles.map((bubble) => bubble.text).join(' ')
      ),
      JSON.stringify({
        requestedNumberFollowupFirstAction,
        requestedNumberFollowupCalls,
        requestedNumberFollowupResult
      }))

    // Live regression 2026-07-19: simple-past / perfect-aspect grammar must use
    // the exact same design authority as present progressive grammar. The prior
    // split froze DESIGN_INTAKE, while downstream size logic required OFFER_FORM;
    // the two valid-looking gates deadlocked into repeated candidate rejection.
    const pastTenseDesignThreadId = 'single-control-past-tense-open-vocabulary-design'
    const pastTenseDesignText = 'I was thinking about a red and black peony on my shoulder, middle size'
    const pastTenseDesignInbound = {
      contact_id: pastTenseDesignThreadId,
      thread_id: pastTenseDesignThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-past-tense-design-message',
      text: pastTenseDesignText,
      received_at: '2026-07-20T04:46:58.147Z'
    }
    appendControlHistoryEvent(root, {
      contact_id: pastTenseDesignThreadId,
      thread_id: pastTenseDesignThreadId,
      message_id: 'single-control-past-tense-prior-assistant',
      bubble_index: 0,
      bubble: { text: 'is there something you have been thinking about for your tattoo?' }
    }, 'assistant', { at: '2026-07-20T04:46:28.539Z' })
    recordIngressEvent(root, pastTenseDesignInbound)
    let pastTenseDesignFirstAction = ''
    let pastTenseDesignCalls = 0
    const pastTenseDesignResult = executeSingleControlTurn(pastTenseDesignInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        pastTenseDesignCalls += 1
        if (!pastTenseDesignFirstAction) pastTenseDesignFirstAction = String(opts.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'past tense open vocabulary design form offer',
          packet: { bubbles: [
            { text: 'red and black peony on the shoulder, middle size, got it and we can dial the exact placement and sizing in at the appointment' },
            { text: 'want me to send the application form so we can start moving it?' }
          ] },
          structured_state: {
            ...opts.structured_state_override,
            known_design_context: pastTenseDesignText,
            known_placement_context: pastTenseDesignText,
            known_size_context: pastTenseDesignText,
            tattoo_intent_active: true,
            live_turn_gave_design_idea: true
          },
          intent_adoption_state: {},
          recent_history: [
            { role: 'assistant', text: 'is there something you have been thinking about for your tattoo?' }
          ]
        }
      }
    })
    check('past_tense_unknown_motif_first_route_is_offer_form_and_commits_without_retry',
      pastTenseDesignFirstAction === 'offer_form' &&
      pastTenseDesignCalls === 1 &&
      pastTenseDesignResult.authority?.closed_transition_action === 'offer_form' &&
      pastTenseDesignResult.structured_state?.form_offer_asked === true &&
      pastTenseDesignResult.structured_state?.known_design_context === pastTenseDesignText &&
      /form/i.test(pastTenseDesignResult.packet.bubbles.map((bubble) => bubble.text).join(' ')),
      JSON.stringify({ pastTenseDesignFirstAction, pastTenseDesignCalls, pastTenseDesignResult }))

    // Live Safari regression 2026-07-17: the assistant's broad "what kind of
    // idea?" prompt was copied as a grounded antecedent for "I'm thinking of this
    // one" even though no object or media existed.  The controller also prelocked
    // DESIGN_INTAKE before dm-authority's discourse resolver ran.  Missing context
    // must own the very first candidate route.
    const missingReferentThreadId = 'single-control-missing-referent-first-route'
    fs.writeFileSync(path.join(root, 'thread-state', `${missingReferentThreadId}.json`), JSON.stringify({
      contact_id: missingReferentThreadId,
      thread_id: missingReferentThreadId,
      tattoo_intent_active: true
    }, null, 2) + '\n')
    appendControlHistoryEvent(root, {
      contact_id: missingReferentThreadId,
      thread_id: missingReferentThreadId,
      message_id: 'missing-referent-prior-assistant',
      bubble_index: 0,
      bubble: { text: 'what kind of vibe or idea have you been thinking about? throw me anything you’re feeling' }
    }, 'assistant', { at: '2026-07-18T03:45:48.263Z' })
    const missingReferentInbound = {
      contact_id: missingReferentThreadId,
      thread_id: missingReferentThreadId,
      instagram_username: 'omar.system',
      message_id: 'missing-referent-live-message',
      text: "I'm thinking of this one",
      received_at: '2026-07-18T03:46:07.543Z'
    }
    recordIngressEvent(root, missingReferentInbound)
    let missingReferentFirstAction = ''
    const missingReferentTurn = executeSingleControlTurn(missingReferentInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        if (!missingReferentFirstAction) missingReferentFirstAction = String(opts.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'ask for the actual missing reference',
          packet: { bubbles: [{ text: 'send me the actual pic when you get a sec so i can see what you mean' }] },
          structured_state: {
            ...opts.structured_state_override,
            live_turn_context_missing: true,
            live_turn_context_missing_attachment: true,
            live_turn_reference_pointer_without_media: true,
            live_turn_context_relation: 'missing_attachment'
          },
          intent_adoption_state: {
            context_classifier_applied: true,
            live_turn_context_missing: true,
            live_turn_context_missing_attachment: true,
            live_turn_reference_pointer_without_media: true,
            live_turn_context_relation: 'missing_attachment',
            live_turn_context_confidence: 'high',
            live_turn_context_resolution_source: 'structural_floor'
          },
          recent_history: [{
            role: 'assistant',
            text: 'what kind of vibe or idea have you been thinking about? throw me anything you’re feeling'
          }]
        }
      }
    })
    check('missing_referent_owns_first_controller_candidate_route',
      missingReferentFirstAction === 'resolve_context',
      missingReferentFirstAction)
    check('missing_referent_visible_packet_requests_real_media_without_pretending',
      missingReferentTurn.authority?.closed_transition_action === 'resolve_context' &&
      /send me the actual pic/i.test(String(missingReferentTurn.packet?.bubbles?.[0]?.text || '')) &&
      !/what part|clicked|cool|vibe feels/i.test(String(missingReferentTurn.packet?.bubbles?.[0]?.text || '')),
      JSON.stringify(missingReferentTurn))

    // Live OMAR 2026-08-24: the first info route was DESIGN_INTAKE while the
    // committed durable state remained open_conversation.  That state/route
    // split made the immediately following screenshot look unrelated.  The
    // reducer must latch the same tattoo lane the route resolver already sees.
    const infoLatchThreadId = 'single-control-info-opener-tattoo-latch'
    const infoLatchInbound = {
      contact_id: infoLatchThreadId,
      thread_id: infoLatchThreadId,
      instagram_username: 'omar.system',
      message_id: 'info-opener-live-message',
      text: 'Hi, can I please get more information?',
      received_at: '2026-08-24T07:22:09.000Z'
    }
    recordIngressEvent(root, infoLatchInbound)
    const infoLatchedState = reduceConversationState({ root, event: infoLatchInbound })
    check('info_opener_route_and_durable_tattoo_lane_are_aligned',
      infoLatchedState.tattoo_intent_active === true &&
      infoLatchedState.booking_stage_hint === 'design_intake',
      JSON.stringify(infoLatchedState))

    // The exact inspected failure: an authoritative screenshot is present, the
    // assistant asks a closed visual confirmation, and the client says yes.
    // That confirmation becomes a durable design checkpoint and the very first
    // candidate route must offer the form instead of repeating the question.
    const visualConfirmationThreadId = 'single-control-visual-confirmation-forward'
    fs.writeFileSync(path.join(root, 'thread-state', `${visualConfirmationThreadId}.json`), JSON.stringify({
      contact_id: visualConfirmationThreadId,
      thread_id: visualConfirmationThreadId,
      tattoo_intent_active: true,
      booking_stage_hint: 'design_intake'
    }, null, 2) + '\n')
    const visualHistoryMessage = {
      contact_id: visualConfirmationThreadId,
      thread_id: visualConfirmationThreadId,
      instagram_username: 'omar.system',
      message_id: 'visual-reference-message',
      text: 'sent a reference post: This is a chat/app screenshot with an image of a woman standing in front of robot figures.',
      text_source: 'reference_post.message_text|single_control_media_context_enriched',
      received_at: '2026-08-24T07:22:51.000Z'
    }
    recordIngressEvent(root, visualHistoryMessage)
    appendControlHistoryEvent(root, {
      contact_id: visualConfirmationThreadId,
      thread_id: visualConfirmationThreadId,
      message_id: 'visual-confirmation-question',
      bubble_index: 0,
      bubble: { text: 'Do you mean the woman with the robots rather than the chat screenshot?' }
    }, 'assistant', { at: '2026-08-24T07:24:26.025Z' })
    const visualConfirmationInbound = {
      contact_id: visualConfirmationThreadId,
      thread_id: visualConfirmationThreadId,
      instagram_username: 'omar.system',
      message_id: 'visual-confirmation-yes',
      text: 'Oh yeah, of course',
      received_at: '2026-08-24T07:25:01.000Z'
    }
    recordIngressEvent(root, visualConfirmationInbound)
    let visualConfirmationFirstAction = ''
    const visualConfirmationTurn = executeSingleControlTurn(visualConfirmationInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        if (!visualConfirmationFirstAction) visualConfirmationFirstAction = String(opts.control_transition_contract?.action || '')
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'confirmed visual direction moves to form offer',
          packet: { bubbles: [
            { text: 'got you, i can reinterpret that woman and robot composition in my own style' },
            { text: 'want me to send the application form over?' }
          ] },
          structured_state: {
            ...opts.structured_state_override,
            known_client_anchored_inspiration: true,
            live_turn_gave_design_idea: true,
            tattoo_intent_active: true
          },
          intent_adoption_state: {
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            live_turn_gave_design_idea: true
          }
        }
      }
    })
    check('closed_visual_confirmation_owns_first_offer_form_route',
      visualConfirmationFirstAction === 'offer_form' &&
      visualConfirmationTurn.authority?.closed_transition_action === 'offer_form',
      JSON.stringify({ visualConfirmationFirstAction, visualConfirmationTurn }))
    check('closed_visual_confirmation_checkpoint_is_durable_and_not_reasked',
      visualConfirmationTurn.structured_state?.known_client_anchored_inspiration === true &&
      visualConfirmationTurn.structured_state?.form_offer_asked === true &&
      !visualConfirmationTurn.packet?.bubbles?.some((bubble) => /you mean|which part|what part/i.test(String(bubble?.text || ''))),
      JSON.stringify(visualConfirmationTurn))

    // Live Safari regression 2026-07-15: an image turn was correctly understood
    // and offered the form, but only the one-turn media flag survived.  The next
    // "yeah sure thing. how much is it though?" reloaded a stale generic opener as
    // known_design_context, routed back to DESIGN_INTAKE, and retried into silence.
    // Resolved visual evidence must replace that placeholder durably and the next
    // turn must send the form + answer the price on the first closed route.
    const mediaLedgerSeed = {
      tattoo_intent_active: true,
      known_design_context: 'hey can i get some more info about doing a custom piece?'
    }
    const resolvedMediaState = applyMediaContextToState(
      { ...mediaLedgerSeed },
      {
        resolved: true,
        is_media_reference: true,
        text: 'black and grey snake wrapping around the upper arm'
      },
      { text: 'black and grey snake wrapping around the upper arm' }
    )
    check('resolved_media_context_becomes_durable_design_evidence',
      resolvedMediaState.known_reference_media_received === true &&
      resolvedMediaState.live_turn_gave_design_idea === true &&
      resolvedMediaState.known_design_context === 'black and grey snake wrapping around the upper arm',
      JSON.stringify(resolvedMediaState))

    const mediaThreadId = 'single-control-resolved-media-cross-turn'
    fs.writeFileSync(path.join(root, 'thread-state', `${mediaThreadId}.json`), JSON.stringify({
      contact_id: mediaThreadId,
      thread_id: mediaThreadId,
      tattoo_intent_active: true,
      known_design_context: 'hey can i get some more info about doing a custom piece?'
    }, null, 2) + '\n')
    const mediaInbound = {
      contact_id: mediaThreadId,
      thread_id: mediaThreadId,
      instagram_username: 'omar.system',
      message_id: 'resolved-media-cross-turn-image',
      text: 'sent a reference post',
      media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset=snake-reference'],
      received_at: '2026-07-15T04:55:17.697Z'
    }
    recordIngressEvent(root, mediaInbound)
    const mediaTurn = executeSingleControlTurn(mediaInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        enrichControlHistoryUserEvent(
          root,
          mediaInbound,
          'black and grey snake wrapping around the upper arm'
        )
        const structured = applyMediaContextToState(
          { ...opts.structured_state_override },
          {
            resolved: true,
            is_media_reference: true,
            text: 'black and grey snake wrapping around the upper arm'
          },
          { text: 'black and grey snake wrapping around the upper arm' }
        )
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'resolved visual form offer',
          packet: { bubbles: [
            { text: 'got it, black and grey snake wrapping around the upper arm and we can dial the exact placement and sizing in at the appointment' },
            { text: 'do you want me to send over the form so we can start locking in the details?' }
          ] },
          structured_state: structured,
          intent_adoption_state: {
            tattoo_intent_active: true,
            live_turn_is_tattoo_intent: true,
            live_turn_gave_design_idea: true
          },
          recent_history: [{ role: 'user', message_id: mediaInbound.message_id, text: 'black and grey snake wrapping around the upper arm' }],
          media_context_resolved: true,
          authority_observed_live_turn_text: 'black and grey snake wrapping around the upper arm'
        }
      }
    })
    check('resolved_media_offer_commits_actual_design_not_generic_opener',
      mediaTurn.authority?.closed_transition_action === 'offer_form' &&
      mediaTurn.structured_state?.form_offer_asked === true &&
      mediaTurn.structured_state?.known_reference_media_received === true &&
      mediaTurn.structured_state?.known_design_context === 'black and grey snake wrapping around the upper arm',
      JSON.stringify(mediaTurn))

    const consentPriceInbound = {
      contact_id: mediaThreadId,
      thread_id: mediaThreadId,
      instagram_username: 'omar.system',
      message_id: 'resolved-media-cross-turn-consent-price',
      text: 'yeah sure thing. how much is it though?',
      received_at: '2026-07-15T04:56:05.338Z'
    }
    recordIngressEvent(root, consentPriceInbound)
    const consentPriceTurn = executeSingleControlTurn(consentPriceInbound, {
      root,
      candidateGenerator: (_msg, opts) => ({
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'form and price fulfilled after resolved media',
        packet: { bubbles: [
          { text: 'yeah i got you' },
          { text: 'https://www.effacermonexistence.com/apply' },
          { text: 'the discounted model rate is 150 per hour as long as the design stays in my style' },
          { text: 'once it is in let me know and send me a couple days that work for you' }
        ] },
        structured_state: {
          ...opts.structured_state_override,
          live_turn_form_consent: true,
          live_turn_pricing_question: true
        },
        intent_adoption_state: {
          live_turn_form_consent: true,
          live_turn_pricing_question: true,
          live_turn_is_question: true
        },
        recent_history: [{ role: 'assistant', text: 'do you want me to send over the form so we can start locking in the details?' }]
      })
    })
    check('resolved_media_next_turn_sends_form_and_answers_price_without_retry_silence',
      consentPriceTurn.authority?.closed_transition_action === 'send_form' &&
      consentPriceTurn.authority?.control_candidate_passes === 1 &&
      consentPriceTurn.structured_state?.form_link_sent === true &&
      consentPriceTurn.structured_state?.known_design_context === 'black and grey snake wrapping around the upper arm' &&
      consentPriceTurn.packet?.bubbles?.some((bubble) => String(bubble?.text || '').includes('https://www.effacermonexistence.com/apply')) &&
      consentPriceTurn.packet?.bubbles?.some((bubble) => /150\s+per\s+hour/i.test(String(bubble?.text || ''))),
      JSON.stringify(consentPriceTurn))

    // Live Safari regression 2026-07-19: the first turn offered the form, an
    // intervening size detail correctly left the offer pending, then a queued
    // deploy purged the thread before "yeah sure" arrived. A second verifier bug
    // also treated the required same-packet availability tail as scheduling before
    // form delivery. Lock the complete three-turn state path, not isolated rows.
    const pendingOfferThreadId = 'single-control-pending-form-offer-three-turn'
    const pendingOfferTurn1Inbound = {
      contact_id: pendingOfferThreadId,
      thread_id: pendingOfferThreadId,
      instagram_username: 'omar.system',
      message_id: 'pending-form-offer-turn-1',
      text: 'I am thinking of a black and grey snake wrapping around my arm',
      received_at: '2026-07-20T00:47:49.000Z'
    }
    recordIngressEvent(root, pendingOfferTurn1Inbound)
    const pendingOfferTurn1 = executeSingleControlTurn(pendingOfferTurn1Inbound, {
      root,
      candidateGenerator: (_msg, opts) => ({
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'snake design acknowledged and form offered once',
        packet: { bubbles: [
          { text: 'got it, black and grey snake wrapping around your arm and we can dial the exact placement and sizing in at the appointment' },
          { text: 'want me to send the form so we can start locking it in?' }
        ] },
        structured_state: {
          ...opts.structured_state_override,
          tattoo_intent_active: true,
          known_design_context: 'black and grey snake wrapping around the arm',
          known_placement_context: 'arm'
        },
        intent_adoption_state: {
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true,
          live_turn_gave_design_idea: true
        },
        recent_history: []
      })
    })
    const pendingOfferTurn1Text = pendingOfferTurn1.packet.bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
    check('three_turn_offer_opens_once_without_sending_link',
      pendingOfferTurn1.authority?.closed_transition_action === 'offer_form' &&
      pendingOfferTurn1.structured_state?.form_offer_asked === true &&
      pendingOfferTurn1.structured_state?.form_link_sent !== true &&
      !pendingOfferTurn1Text.includes('https://www.effacermonexistence.com/apply'),
      JSON.stringify(pendingOfferTurn1))

    const pendingOfferTurn2Inbound = {
      contact_id: pendingOfferThreadId,
      thread_id: pendingOfferThreadId,
      instagram_username: 'omar.system',
      message_id: 'pending-form-offer-turn-2',
      text: 'roughly 8 inches or so',
      received_at: '2026-07-20T00:48:24.000Z'
    }
    recordIngressEvent(root, pendingOfferTurn2Inbound)
    const pendingOfferTurn2 = executeSingleControlTurn(pendingOfferTurn2Inbound, {
      root,
      candidateGenerator: (_msg, opts) => ({
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'size acknowledged while existing form offer stays pending',
        packet: { bubbles: [{ text: 'yeah around 8 inches gives that wrap enough room to breathe and we can dial the exact size in person' }] },
        structured_state: {
          ...opts.structured_state_override,
          tattoo_intent_active: true,
          known_size_context: 'roughly 8 inches'
        },
        intent_adoption_state: {
          tattoo_intent_active: true,
          live_turn_is_tattoo_intent: true
        },
        recent_history: [
          { role: 'assistant', text: 'want me to send the form so we can start locking it in?' }
        ]
      })
    })
    const pendingOfferTurn2Text = pendingOfferTurn2.packet.bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
    check('three_turn_size_detail_preserves_open_offer_without_link_repeat_or_calendar',
      pendingOfferTurn2.authority?.closed_transition_action === 'general_continue' &&
      pendingOfferTurn2.authority?.closed_transition_reason === 'open_form_offer_received_nonconsent_size_or_placement_detail' &&
      pendingOfferTurn2.structured_state?.form_offer_asked === true &&
      pendingOfferTurn2.structured_state?.form_link_sent !== true &&
      // Durable memory is the controller-observed client wording, not the
      // candidate's rewritten/normalized paraphrase.
      pendingOfferTurn2.structured_state?.known_design_context === pendingOfferTurn1Inbound.text &&
      pendingOfferTurn2.structured_state?.known_size_context === pendingOfferTurn2Inbound.text &&
      !/want me to send|form|apply|date|time|calendar/i.test(pendingOfferTurn2Text),
      JSON.stringify(pendingOfferTurn2))

    const pendingOfferTurn3Inbound = {
      contact_id: pendingOfferThreadId,
      thread_id: pendingOfferThreadId,
      instagram_username: 'omar.system',
      message_id: 'pending-form-offer-turn-3',
      text: 'sent a voice note saying: Yeah, sure. Go ahead.',
      received_at: '2026-07-20T00:49:14.000Z'
    }
    recordIngressEvent(root, pendingOfferTurn3Inbound)
    const pendingOfferTurn3 = executeSingleControlTurn(pendingOfferTurn3Inbound, {
      root,
      candidateGenerator: (_msg, opts) => ({
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'plain consent fulfills the pending form handoff',
        packet: { bubbles: [
          { text: 'yeah i got you' },
          { text: 'https://www.effacermonexistence.com/apply' },
          { text: 'once it is in let me know and send me a couple days that work for you' }
        ] },
        structured_state: {
          ...opts.structured_state_override,
          live_turn_form_consent: true
        },
        intent_adoption_state: {
          live_turn_form_consent: true
        },
        recent_history: [
          { role: 'assistant', text: 'want me to send the form so we can start locking it in?' },
          { role: 'user', text: 'roughly 8 inches or so' },
          { role: 'assistant', text: 'yeah around 8 inches gives that wrap enough room to breathe and we can dial the exact size in person' }
        ]
      })
    })
    const pendingOfferTurn3Text = pendingOfferTurn3.packet.bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
    check('three_turn_voice_wrapped_consent_sends_exact_form_once_with_availability_tail',
      pendingOfferTurn3.authority?.closed_transition_action === 'send_form' &&
      pendingOfferTurn3.authority?.closed_transition_reason === 'explicit_form_request_or_open_offer_consent' &&
      pendingOfferTurn3.authority?.control_candidate_passes === 1 &&
      pendingOfferTurn3.structured_state?.form_link_sent === true &&
      pendingOfferTurn3.structured_state?.form_offer_asked === true &&
      pendingOfferTurn3.structured_state?.known_size_context === pendingOfferTurn2Inbound.text &&
      pendingOfferTurn3Text.split('https://www.effacermonexistence.com/apply').length - 1 === 1 &&
      /couple days|availability/i.test(pendingOfferTurn3Text),
      JSON.stringify(pendingOfferTurn3))

    const adversarialThreadId = 'single-control-adversarial-topic-shift'
    fs.writeFileSync(path.join(root, 'thread-state', `${adversarialThreadId}.json`), JSON.stringify({
      contact_id: adversarialThreadId,
      thread_id: adversarialThreadId,
      tattoo_intent_active: true,
      known_design_context: 'black and gray snake reference',
      booking_stage_hint: 'design_intake'
    }, null, 2) + '\n')
    const noisyQuestionInbound = {
      contact_id: adversarialThreadId,
      thread_id: adversarialThreadId,
      instagram_username: 'omar.system',
      message_id: 'adversarial-noisy-question-1',
      text: 'can i as,uou a qurstion',
      received_at: '2026-07-15T05:00:00.000Z'
    }
    recordIngressEvent(root, noisyQuestionInbound)
    const noisyQuestionTurn = executeSingleControlTurn(noisyQuestionInbound, {
      root,
      candidateGenerator: (_msg, opts) => ({
        source: 'codex_exec_dm_authority',
        authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
        raw_text: 'fresh noisy-question repair',
        packet: { bubbles: [{ text: 'yeah of course ask away, what’s up?' }] },
        structured_state: { ...opts.structured_state_override },
        intent_adoption_state: {
          llm_intent_applied: true,
          live_turn_is_question: true,
          context_classifier_applied: true,
          live_turn_context_relation: 'self_contained_topic_shift',
          live_turn_context_confidence: 'high',
          live_turn_context_resolution_source: 'llm_inductive_classifier',
          live_turn_self_contained_topic_shift: true
        },
        recent_history: []
      })
    })
    check('single_control_noisy_question_outranks_stale_design_route',
      noisyQuestionTurn.authority?.closed_transition_action === 'social_continue' &&
      noisyQuestionTurn.structured_state?.form_offer_asked !== true &&
      noisyQuestionTurn.packet?.bubbles?.some((bubble) => /ask away/i.test(String(bubble?.text || ''))),
      JSON.stringify(noisyQuestionTurn))

    const assistantPacket = {
      ...inbound,
      bubble_index: 0,
      bubble: first.packet.bubbles[0]
    }
    appendControlHistoryEvent(root, assistantPacket, 'assistant', { delivery_status: 'verified' })
    appendControlHistoryEvent(root, assistantPacket, 'assistant', { delivery_status: 'verified' })
    const historyAfterAssistant = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
    check('assistant_delivery_history_is_controller_owned_and_idempotent',
      historyAfterAssistant.events.filter((event) => event.message_id === inbound.message_id && event.role === 'assistant').length === 1,
      JSON.stringify(historyAfterAssistant.events))

    const nextInbound = {
      ...inbound,
      message_id: 'single-control-message-2',
      text: 'one more thing',
      received_at: '2026-07-10T20:01:00.000Z'
    }
    recordIngressEvent(root, nextInbound)
    let staleRejected = false
    try { executeSingleControlTurn(inbound, { root, candidateGenerator }) } catch (err) {
      staleRejected = String(err?.message || err).includes('single_control_nonlatest_inbound_rejected')
    }
    check('older_event_cannot_reenter_after_newer_ingress', staleRejected === true)

    const outboxDir = path.join(root, 'outbox')
    fs.mkdirSync(outboxDir, { recursive: true })
    fs.writeFileSync(path.join(outboxDir, 'legacy.json'), JSON.stringify({
      source: 'codex_exec_dm_authority',
      authority: { runner: 'codex exec' },
      thread_id: 'legacy-thread',
      message_id: 'legacy-message'
    }, null, 2))
    fs.writeFileSync(path.join(outboxDir, 'valid.json'), JSON.stringify({
      ...first,
      bubble: first.packet.bubbles[0],
      bubble_index: 0
    }, null, 2))
    const quarantine = quarantinePreSingleControlOutbox(root)
    check('pre_single_control_outbox_is_quarantined',
      quarantine.quarantined === 1 && !fs.existsSync(path.join(outboxDir, 'legacy.json')),
      JSON.stringify(quarantine))
    check('valid_controller_receipt_outbox_survives_quarantine',
      fs.existsSync(path.join(outboxDir, 'valid.json')),
      JSON.stringify(fs.readdirSync(outboxDir)))

    fs.writeFileSync(path.join(root, 'thread-state', 'legacy-thread-2.json'), JSON.stringify({
      thread_id: 'legacy-thread-2',
      contact_id: 'legacy-thread-2',
      form_link_sent: true
    }, null, 2))
    const migration = migrateAllThreadStates(root)
    const migratedState = readControlState(root, 'legacy-thread-2')
    check('startup_migration_preserves_durable_semantics',
      migration.migrated >= 1 && migratedState.form_link_sent === true && migratedState.control_epoch === SCV_CONTROL_EPOCH,
      JSON.stringify({ migration, migratedState }))
    const preMigrationState = JSON.parse(fs.readFileSync(path.join(root, 'thread-state_pre_migration', 'legacy-thread-2.json'), 'utf8'))
    check('startup_migration_backs_up_original_state_once',
      migration.backed_up >= 1 && preMigrationState.form_link_sent === true && !preMigrationState.control_epoch,
      JSON.stringify({ migration, preMigrationState }))

    // Live regression 2026-08-25: name/phone were first extracted inside the
    // downstream authority after POST_FORM_IDENTITY had already been frozen.
    // The semantic verifier demanded DOUBLE_CHECK, but retries stayed on the stale
    // route and the user received silence. The controller must parse this exact
    // inbound before deriving its first route, and the accepted replacement slot
    // must outrank the older rejected request in the plan fields.
    const identityBoundaryThreadId = 'single-control-live-identity-boundary'
    fs.writeFileSync(path.join(root, 'thread-state', `${identityBoundaryThreadId}.json`), JSON.stringify({
      contact_id: identityBoundaryThreadId,
      thread_id: identityBoundaryThreadId,
      tattoo_intent_active: true,
      known_design_context: 'black and grey heron with water',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_requested_date: 'august 30',
      known_requested_time: '2pm',
      accepted_offered_date: 'august 31',
      accepted_offered_time: '2pm',
      last_offered_date: 'august 31',
      last_offered_time: '2pm'
    }, null, 2) + '\n')
    const identityBoundaryInbound = {
      contact_id: identityBoundaryThreadId,
      thread_id: identityBoundaryThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-live-identity-boundary-1',
      text: 'My name is Ben Lee and my phone is 415-555-0136',
      received_at: '2026-08-25T03:20:00.000Z'
    }
    recordIngressEvent(root, identityBoundaryInbound)
    let identityBoundaryPlan = null
    const identityBoundaryResult = executeSingleControlTurn(identityBoundaryInbound, {
      root,
      candidateGenerator: (_msg, opts) => {
        identityBoundaryPlan = opts.control_transition_contract
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: 'accepted replacement exact double check',
          packet: { bubbles: [{
            text: 'Name : Ben Lee\nPhone Number : 4155550136\nAppointment date : 31st of August\nTime : 2pm\n\ncan you double check this just to make sure'
          }] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: []
        }
      }
    })
    check('live_identity_is_parsed_before_first_route_lock_and_accepted_replacement_wins',
      identityBoundaryPlan?.action === 'double_check' &&
      String(identityBoundaryPlan?.fields?.name || '') === 'Ben Lee' &&
      String(identityBoundaryPlan?.fields?.phone || '') === '4155550136' &&
      /august\s+31/i.test(String(identityBoundaryPlan?.fields?.date || '')) &&
      !/august\s+30/i.test(String(identityBoundaryPlan?.fields?.date || '')) &&
      identityBoundaryResult.authority?.closed_transition_action === 'double_check' &&
      identityBoundaryResult.authority?.control_candidate_passes === 1,
      JSON.stringify({ identityBoundaryPlan, identityBoundaryResult }))

    // Exact live Omar regression 2026-08-29: the submitted-form lane asked for
    // dates and received "How about tomorrow?". The controller understood the
    // relative date but the persisted state did not contain the policy snapshot
    // fields required by the verifier. Every candidate was rejected before a
    // late generic recovery ignored the understood proposal. The closed plan
    // now derives its legal alternative directly from immutable ingress time and
    // the fixed checkpoint must adopt on the first controller pass.
    const relativeTomorrowThreadId = 'single-control-relative-tomorrow-liveness'
    fs.writeFileSync(path.join(root, 'thread-state', `${relativeTomorrowThreadId}.json`), JSON.stringify({
      contact_id: relativeTomorrowThreadId,
      thread_id: relativeTomorrowThreadId,
      tattoo_intent_active: true,
      known_design_context: 'black and grey custom reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date'
    }, null, 2) + '\n')
    const relativeTomorrowHistory = [{
      role: 'assistant',
      message_id: 'relative-tomorrow-open-date-question',
      text: 'what dates are you thinking'
    }]
    fs.writeFileSync(path.join(root, 'thread-history', `${relativeTomorrowThreadId}.json`), JSON.stringify({
      contact_id: relativeTomorrowThreadId,
      thread_id: relativeTomorrowThreadId,
      instagram_username: 'omar.system',
      events: relativeTomorrowHistory
    }, null, 2) + '\n')
    const relativeTomorrowInbound = {
      contact_id: relativeTomorrowThreadId,
      thread_id: relativeTomorrowThreadId,
      instagram_username: 'omar.system',
      message_id: 'relative-tomorrow-live-message',
      text: 'How about tomorrow?',
      received_at: '2026-08-29T23:24:47.764Z'
    }
    recordIngressEvent(root, relativeTomorrowInbound)
    let relativeTomorrowCalls = 0
    let relativeTomorrowPlan = null
    const relativeTomorrowResult = executeSingleControlTurn(relativeTomorrowInbound, {
      root,
      authority_options: { recent_history_override: relativeTomorrowHistory },
      candidateGenerator: (_msg, opts) => {
        relativeTomorrowCalls += 1
        relativeTomorrowPlan = opts.control_transition_contract
        const runnerInput = {
          ..._msg,
          message: _msg.text,
          live_message: _msg.text,
          received_at: _msg.received_at,
          structured_state: opts.structured_state_override,
          recent_history: relativeTomorrowHistory,
          control_transition_contract: opts.control_transition_contract
        }
        const generated = buildDeterministicBookingPacket(runnerInput)
        if (!generated) throw new Error('relative_tomorrow_fixed_checkpoint_missing')
        return {
          ...generated,
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: relativeTomorrowHistory
        }
      }
    })
    const relativeTomorrowText = relativeTomorrowResult.packet.bubbles
      .map((bubble) => String(bubble?.text || ''))
      .join('\n')
    check('relative_tomorrow_first_route_has_policy_derived_anchor',
      relativeTomorrowPlan?.action === 'post_form_availability' &&
      relativeTomorrowPlan?.reason === 'submitted_form_date_counterproposal_outside_window' &&
      /september 5/i.test(String(relativeTomorrowPlan?.fields?.minimum_booking_date || '')) &&
      /september 5/i.test(String(relativeTomorrowPlan?.fields?.earliest_booking_option || '')),
      JSON.stringify(relativeTomorrowPlan))
    check('relative_tomorrow_adopts_once_without_recovery_or_retry',
      relativeTomorrowCalls === 1 &&
      relativeTomorrowResult.authority?.closed_transition_action === 'post_form_availability' &&
      relativeTomorrowResult.authority?.closed_transition_reason === 'submitted_form_date_counterproposal_outside_window' &&
      relativeTomorrowResult.authority?.control_candidate_passes === 1 &&
      relativeTomorrowResult.authority?.executor !== 'deterministic_route_aware_visible_after_failure_exhaustion',
      JSON.stringify({ relativeTomorrowCalls, authority: relativeTomorrowResult.authority }))
    check('relative_tomorrow_visible_reply_is_grounded_and_owner_punctuated',
      /tomorrow/i.test(relativeTomorrowText) &&
      /september 5/i.test(relativeTomorrowText) &&
      !/form|submitted|received|got it|i have that/i.test(relativeTomorrowText) &&
      !/[,，]/.test(relativeTomorrowText) &&
      !/[.。．]+\s*(?:\n|$)/m.test(relativeTomorrowText),
      relativeTomorrowText)
    check('relative_tomorrow_commit_preserves_funnel_and_rejected_date',
      relativeTomorrowResult.structured_state?.last_rejected_client_date === 'tomorrow' &&
      relativeTomorrowResult.structured_state?.booking_stage_hint === 'awaiting_date' &&
      !String(relativeTomorrowResult.structured_state?.known_requested_date || '').trim() &&
      !String(relativeTomorrowResult.structured_state?.known_requested_time || '').trim(),
      JSON.stringify(relativeTomorrowResult.structured_state))

    // Exact live Omar regression 2026-08-29: after the date was selected the
    // client wrote "How about 12?". Suffixless 12 belongs to the open time
    // question and means noon. It must hit the 1pm floor instead of producing
    // date-style wording such as "12 isnt open".
    const bareHourThreadId = 'single-control-bare-hour-time-floor'
    fs.writeFileSync(path.join(root, 'thread-state', `${bareHourThreadId}.json`), JSON.stringify({
      contact_id: bareHourThreadId,
      thread_id: bareHourThreadId,
      tattoo_intent_active: true,
      known_design_context: 'custom reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_requested_date: 'september 5',
      known_requested_time: '',
      booking_stage_hint: 'awaiting_time'
    }, null, 2) + '\n')
    const bareHourHistory = [{
      role: 'assistant',
      message_id: 'bare-hour-open-time-question',
      text: 'yeah september 5 works what time are you thinking?'
    }]
    fs.writeFileSync(path.join(root, 'thread-history', `${bareHourThreadId}.json`), JSON.stringify({
      contact_id: bareHourThreadId,
      thread_id: bareHourThreadId,
      instagram_username: 'omar.system',
      events: bareHourHistory
    }, null, 2) + '\n')
    const bareHourInbound = {
      contact_id: bareHourThreadId,
      thread_id: bareHourThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-bare-hour-live-message',
      text: 'How about 12?',
      received_at: '2026-08-29T23:40:00.000Z'
    }
    recordIngressEvent(root, bareHourInbound)
    let bareHourPlan = null
    let bareHourCalls = 0
    const bareHourResult = executeSingleControlTurn(bareHourInbound, {
      root,
      authority_options: { recent_history_override: bareHourHistory },
      candidateGenerator: (_msg, opts) => {
        bareHourCalls += 1
        bareHourPlan = opts.control_transition_contract
        return {
          source: 'codex_exec_dm_authority',
          authority: { runner: 'codex exec', route: 'bounded_candidate_only' },
          raw_text: '12 is a little too early for me i start at 1pm would 1 or 2 work?',
          packet: { bubbles: [{ text: '12 is a little too early for me i start at 1pm would 1 or 2 work?' }] },
          structured_state: { ...opts.structured_state_override },
          intent_adoption_state: {},
          recent_history: bareHourHistory
        }
      }
    })
    const bareHourText = bareHourResult.packet.bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
    check('bare_hour_context_maps_12_to_noon_only_inside_open_time_slot',
      contextualBareBookingHourFrame('How about 12?', true)?.candidate_text === '12pm' &&
      contextualBareBookingHourFrame('How about 12?', false) === null &&
      contextualBareBookingHourFrame('September 12', true) === null)
    check('bare_hour_first_route_is_minimum_time_boundary',
      bareHourCalls === 1 &&
      bareHourPlan?.action === 'post_form_time' &&
      bareHourPlan?.reason === 'submitted_form_time_before_minimum' &&
      bareHourPlan?.fields?.proposed_time === '12pm',
      JSON.stringify({ bareHourCalls, bareHourPlan }))
    check('bare_hour_visible_reply_uses_time_floor_not_date_open_wording',
      /too early/i.test(bareHourText) && /1pm/i.test(bareHourText) &&
      !/\bopen(?:ing)?\b/i.test(bareHourText) &&
      !/[,，]/.test(bareHourText) && !/[.。．]+\s*(?:\n|$)/m.test(bareHourText),
      bareHourText)
    check('bare_hour_commit_keeps_date_and_leaves_time_unset',
      bareHourResult.structured_state?.known_requested_date === 'september 5' &&
      !String(bareHourResult.structured_state?.known_requested_time || '').trim() &&
      bareHourResult.structured_state?.booking_stage_hint === 'awaiting_time',
      JSON.stringify(bareHourResult.structured_state))

    const liveMetadataCandidate = { packet: { next_action_reflected: 'wrong_route' } }
    bindLiveControllerPacketMetadata(liveMetadataCandidate, { action: 'post_form_identity' }, false)
    check('live_controller_owns_invisible_next_action_metadata',
      liveMetadataCandidate.packet.next_action_reflected === 'post_form_identity')
    const forgedInjectedMetadata = { packet: { next_action_reflected: 'forged_route' } }
    bindLiveControllerPacketMetadata(forgedInjectedMetadata, { action: 'post_form_identity' }, true)
    check('injected_adversarial_metadata_is_not_repaired',
      forgedInjectedMetadata.packet.next_action_reflected === 'forged_route')

    // Exact live Omar regression 2026-08-29: "yeah sure" accepted the offered
    // September 5 at 2pm slot but all model candidates exhausted. The bounded
    // visible recovery must preserve the accepted controller state and move to
    // identity without claiming that nothing is locked or rolling back to time.
    const acceptedRecoveryThreadId = 'single-control-accepted-slot-recovery-durability'
    fs.writeFileSync(path.join(root, 'thread-state', `${acceptedRecoveryThreadId}.json`), JSON.stringify({
      contact_id: acceptedRecoveryThreadId,
      thread_id: acceptedRecoveryThreadId,
      tattoo_intent_active: true,
      known_design_context: 'custom reference',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_requested_date: 'september 5',
      known_requested_time: '',
      last_offered_date: 'september 5',
      last_offered_time: '2pm',
      booking_stage_hint: 'awaiting_time'
    }, null, 2) + '\n')
    const acceptedRecoveryHistory = [{
      role: 'assistant',
      message_id: 'accepted-recovery-slot-offer',
      text: 'I can do September 5 at 2pm if you want that'
    }]
    fs.writeFileSync(path.join(root, 'thread-history', `${acceptedRecoveryThreadId}.json`), JSON.stringify({
      contact_id: acceptedRecoveryThreadId,
      thread_id: acceptedRecoveryThreadId,
      instagram_username: 'omar.system',
      events: acceptedRecoveryHistory
    }, null, 2) + '\n')
    const acceptedRecoveryInbound = {
      contact_id: acceptedRecoveryThreadId,
      thread_id: acceptedRecoveryThreadId,
      instagram_username: 'omar.system',
      message_id: 'single-control-accepted-recovery-live-message',
      text: 'yeah sure',
      received_at: '2026-08-29T23:41:00.000Z',
      control_force_route_aware_visible_recovery: true,
      control_route_aware_visible_recovery_version: ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
      control_route_aware_visible_recovery_after_attempts: 3,
      last_error_kind: 'persistent_internal_control',
      control_route_aware_visible_recovery_reason: 'persistent_failure_exhausted'
    }
    recordIngressEvent(root, acceptedRecoveryInbound)
    const acceptedRecoveryResult = executeSingleControlTurn(acceptedRecoveryInbound, {
      root,
      authority_options: { recent_history_override: acceptedRecoveryHistory }
    })
    const acceptedRecoveryText = acceptedRecoveryResult.packet.bubbles
      .map((bubble) => String(bubble?.text || ''))
      .join('\n')
    check('accepted_slot_recovery_uses_route_aware_liveness_once',
      acceptedRecoveryResult.authority?.closed_transition_action === 'resolve_context' &&
      acceptedRecoveryResult.authority?.closed_transition_reason === 'verifier_exhausted_route_recovery' &&
      acceptedRecoveryResult.authority?.control_recovery_original_action === 'post_form_identity' &&
      acceptedRecoveryResult.authority?.control_candidate_passes === 1,
      JSON.stringify(acceptedRecoveryResult.authority))
    check('accepted_slot_recovery_surface_is_human_and_moves_to_identity',
      /perfect september 5 at 2pm works/i.test(acceptedRecoveryText) &&
      /name and phone number/i.test(acceptedRecoveryText) &&
      !/nothing is locked|while i verify|haven.?t changed/i.test(acceptedRecoveryText) &&
      !/[,，]/.test(acceptedRecoveryText) && !/[.。．]+\s*(?:\n|$)/m.test(acceptedRecoveryText),
      acceptedRecoveryText)
    check('accepted_slot_recovery_preserves_controller_committed_date_and_time',
      acceptedRecoveryResult.structured_state?.known_requested_date === 'september 5' &&
      acceptedRecoveryResult.structured_state?.known_requested_time === '2pm' &&
      acceptedRecoveryResult.structured_state?.accepted_offered_date === 'september 5' &&
      acceptedRecoveryResult.structured_state?.accepted_offered_time === '2pm',
      JSON.stringify(acceptedRecoveryResult.structured_state))
    check('accepted_slot_recovery_stage_does_not_roll_back_to_time',
      acceptedRecoveryResult.structured_state?.booking_stage_hint === 'awaiting_form_identity_match' &&
      acceptedRecoveryResult.structured_state?.next_action === 'post_form_identity',
      JSON.stringify(acceptedRecoveryResult.structured_state))

    const inboundSource = fs.readFileSync(path.join(__dirname, 'inbound-scv.js'), 'utf8')
    const recoverySource = fs.readFileSync(path.join(__dirname, 'scv-manychat-orphan-recovery.js'), 'utf8')
    const inboxSource = fs.readFileSync(path.join(__dirname, 'inbox-worker.js'), 'utf8')
    const outbound1Source = fs.readFileSync(path.join(__dirname, 'outbound-scv1.js'), 'utf8')
    const outbound2Source = fs.readFileSync(path.join(__dirname, 'outbound-scv2.js'), 'utf8')
    const outboxSource = fs.readFileSync(path.join(__dirname, 'outbox-worker.js'), 'utf8')
    const authoritySource = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')
    const cloudStartSource = fs.readFileSync(path.join(__dirname, 'cloud-start.js'), 'utf8')
    check('topology_ingress_delegates_state_and_history_to_controller',
      inboundSource.includes('recordIngressEvent(ROOT, packet, authenticatedIngressOptions)') &&
      inboundSource.includes('authorization.required === true') &&
      !inboundSource.includes('function writeThreadState(packet)'),
      'inbound-scv.js')
    check('topology_recovery_cannot_overwrite_semantic_state',
      recoverySource.includes('recordIngressEvent(root, packet)') && !recoverySource.includes('function writeThreadState(root, packet)'),
      'scv-manychat-orphan-recovery.js')
    check('topology_inbox_executes_only_single_control_turn',
      inboxSource.includes('executeSingleControlTurn(msg, { root: LIVE_DIR })') && !inboxSource.includes('generatePacketFromCodexAuthority(msg)'),
      'inbox-worker.js')
    check('topology_queue_gate_requires_controller_receipt',
      outbound1Source.includes('validateControlReceipt(body, { root: ROOT, requireLedger: true, requirePayload: true })') && outbound1Source.includes('authority.controller !== SCV_SINGLE_CONTROL_PLANE_ID'),
      'outbound-scv1.js')
    check('topology_final_send_gate_requires_controller_receipt',
      outbound2Source.includes('validateControlReceipt(body, { root: process.env.SCV_ROOT || __dirname, requireLedger: true, requirePayload: true })') && outbound2Source.includes('authority.controller !== SCV_SINGLE_CONTROL_PLANE_ID'),
      'outbound-scv2.js')
    check('topology_queue_transport_cannot_rewrite_split_or_dedupe',
      outbound1Source.includes('const bubbles = body.bubbles') &&
      !outbound1Source.includes('expandBubblesForReadability(body.bubbles)') &&
      !outbound1Source.includes('filterDuplicateUrlBubbles(expandBubblesForReadability'),
      'outbound-scv1.js')
    check('topology_outbox_worker_cannot_content_dedupe_controller_packet',
      !outboxSource.includes('recentAssistantDuplicate(packet) || pendingOutboundDuplicate(packet, file)'),
      'outbox-worker.js')
    check('topology_outbox_worker_repairs_payload_from_immutable_decision',
      outboxSource.includes('repairTransportPacketFromDecisionArtifact(ROOT, packet)') &&
      outboxSource.includes("type: 'worker_controller_payload_restored_from_artifact'"),
      'outbox-worker.js')
    check('topology_post_adoption_semantic_audit_cannot_discard_reply',
      outboxSource.includes("action: 'controller_adoption_preserved'") &&
      !outboxSource.includes('quarantineContractHarness(lock, packet, outboundHarnessVerdict)'),
      'outbox-worker.js')
    check('topology_internal_sender_gate_failure_is_persistently_retryable',
      outboxSource.includes("return 'internal_control'") &&
      outboxSource.includes("classification === 'internal_control'") &&
      outboxSource.includes("'persistent_internal_send_control'"),
      'outbox-worker.js')
    check('topology_decision_artifacts_are_restart_persistent',
      cloudStartSource.includes("'control-decisions'") && cloudStartSource.includes('ensurePersistentStateDirs'),
      'cloud-start.js')
    check('topology_health_verifies_persistent_decision_artifacts',
      inboundSource.includes("'control-decisions'") &&
      /runScvRuntimeNamespaceGuard\(\{\s*appRoot:\s*ROOT,\s*dirs:\s*RUNTIME_GUARD_DIRS\b/s.test(inboundSource) &&
      inboundSource.includes("requireCheck(namespaceGuard?.ok === true, 'runtime_namespace_guard')") &&
      inboundSource.includes("namespaceGuard?.persistent === true, 'persistent_state'"),
      'inbound-scv.js')
    check('topology_internal_semantic_failures_are_persistently_retryable',
      inboxSource.includes('function isPersistentInternalControlError(errorText)') &&
      inboxSource.includes('single_control_internal_retryable:') &&
      inboxSource.includes('releaseForRetry(locked, msg, err)') &&
      inboxSource.includes('control_repair_ledger'),
      'inbox-worker.js')
    check('topology_delivery_history_delegates_to_controller',
      outboxSource.includes('appendControlHistoryEvent(ROOT, packet, role') && !outboxSource.includes('history.events.push({'),
      'outbox-worker.js')
    check('topology_media_enrichment_delegates_to_controller',
      authoritySource.includes('enrichControlHistoryUserEvent(LIVE_DIR, msg, nextText)') && !authoritySource.includes("fs.writeFileSync(file, JSON.stringify(history"),
      'dm-authority.js')

    if (failures.length) {
      const err = new Error(`scv_single_control_plane_harness_failed:${JSON.stringify(failures)}`)
      err.failures = failures
      throw err
    }
    return {
      ok: true,
      locked: true,
      lock_version: SCV_SINGLE_CONTROL_HARNESS_LOCK_VERSION,
      control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
      control_epoch: SCV_CONTROL_EPOCH,
      checked
    }
  } finally {
    if (responsesRequiredWasPresent) {
      process.env.SCV_OPENAI_RESPONSES_REQUIRED = responsesRequiredBefore
    } else {
      delete process.env.SCV_OPENAI_RESPONSES_REQUIRED
    }
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvSingleControlPlaneHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      error: String(err?.message || err),
      failures: err?.failures || [],
      control_retry_context: err?.control_retry_context || null
    }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  SCV_SINGLE_CONTROL_HARNESS_LOCK_VERSION,
  runScvSingleControlPlaneHarness
}
