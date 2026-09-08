#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const SCV_CLOSED_LIFECYCLE_HARNESS_VERSION = 'scv-closed-lifecycle-harness-2026-08-30-v14-marker-race-and-prenetwork-replay'

function runScvClosedLifecycleHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-closed-lifecycle-'))
  const previousRoot = process.env.SCV_ROOT
  const previousPauseAll = process.env.SCV_PAUSE_ALL
  const previousPauseNonTest = process.env.SCV_PAUSE_NON_TEST
  const previousHold = process.env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE
  const previousInboxHarness = process.env.SCV_INBOX_TEST_HARNESS
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  try {
    process.env.SCV_ROOT = root
    process.env.SCV_PAUSE_ALL = '0'
    process.env.SCV_PAUSE_NON_TEST = '0'
    process.env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE = '0'
    process.env.SCV_INBOX_TEST_HARNESS = '1'
    const inboxPath = require.resolve(path.join(__dirname, 'inbox-worker.js'))
    delete require.cache[inboxPath]
    const inbox = require(inboxPath)
    const {
      SCV_SINGLE_CONTROL_PLANE_ID,
      SCV_SINGLE_CONTROL_SOURCE,
      recordIngressEvent,
      statePath,
      executeSingleControlTurn,
      commitControlDecision
    } = require(path.join(__dirname, 'scv-single-control-plane.js'))
    const {
      ROUTE_AWARE_VISIBLE_RECOVERY_VERSION
    } = require(path.join(__dirname, 'scv-deterministic-recovery.js'))
    const {
      adoptionPaths,
      durableCreateJson,
      ensureMarkerForPacket,
      inspectMarkerFile,
      adoptOutboxPacket
    } = require(path.join(__dirname, 'scv-durable-outbox-adoption.js'))

    check('lifecycle_contract_version_exact',
      inbox.SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION === 'scv-closed-lifecycle-contract-2026-08-30-v6-monotonic-final-recovery',
      inbox.SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION)

    const retryableFailures = [
      'single_control_internal_retryable:final_verifier_rejected:transition:missing',
      'single_control_candidate_invalid',
      'single_control_immutable_ingress_time_required',
      'single_control_commit_empty_packet_rejected',
      'single_control_envelope_receipt_invalid:single_control_packet_payload_hash_mismatch',
      'codex_runner_invalid_json:unexpected_token',
      'codex_runner_empty_stdout',
      '3101_post_failed_503',
      'fetch failed',
      'TypeError: cannot read properties of undefined'
    ]
    for (const errorText of retryableFailures) {
      check(`retryable_failure_never_deadletters_${checked + 1}`,
        inbox.classifyInboxFailureDisposition(errorText) === 'retry',
        errorText)
    }
    check('missing_immutable_ingress_time_is_bounded_persistent_internal',
      inbox.isPersistentInternalControlError('single_control_immutable_ingress_time_required') === true)
    check('newer_inbound_conflict_is_explicit_supersede',
      inbox.classifyInboxFailureDisposition('single_control_nonlatest_inbound_rejected:old:new') === 'supersede')
    check('nonrecoverable_malformed_input_can_deadletter_explicitly',
      inbox.classifyInboxFailureDisposition('missing_contact_id') === 'deadletter')

    const inboxDir = path.join(root, 'inbox')
    fs.mkdirSync(inboxDir, { recursive: true })
    const retryOriginal = path.join(inboxDir, 'persistent-retry.json')
    const retryLock = `${retryOriginal}.lock`
    const retryPacket = {
      contact_id: 'retry-thread',
      thread_id: 'retry-thread',
      instagram_username: 'retry.test',
      message_id: 'retry-message',
      text: 'sent a voice note that could not be understood',
      live_turn_voice_transcribe_failed: true,
      live_turn_voice_context_unresolved: true,
      live_turn_context_relation: 'unintelligible',
      attempts: 11,
      received_at: '2026-07-12T12:00:00.000Z'
    }
    recordIngressEvent(root, retryPacket)
    fs.writeFileSync(retryLock, JSON.stringify(retryPacket, null, 2) + '\n')
    inbox.releaseForRetry(retryLock, retryPacket, retryableFailures[0])
    // Verifier/adoption exhaustion has a stronger final boundary than unrelated
    // internal faults: after the bounded retry cap it becomes an exact visible
    // nontransactional clarification on the next controller pass. It must not
    // disappear into a human-agent artifact that the client cannot see.
    const humanAgentDir = path.join(root, 'outbox_human_agent_required')
    const exhaustedVerifierRetry = JSON.parse(fs.readFileSync(retryOriginal, 'utf8'))
    check('persistent_verifier_exhaustion_past_cap_forces_visible_recovery',
      exhaustedVerifierRetry.control_force_safe_clarification_recovery === true &&
      exhaustedVerifierRetry.control_safe_clarification_recovery_version ===
        'scv-inbox-safe-clarification-recovery-2026-08-25-v2-context-bound' &&
      exhaustedVerifierRetry.attempts === 12 && !fs.existsSync(retryLock),
      JSON.stringify(exhaustedVerifierRetry))
    const forcedRecoveryResult = executeSingleControlTurn(exhaustedVerifierRetry, { root })
    const forcedRecoveryText = forcedRecoveryResult.packet.bubbles.map((bubble) => bubble.text).join('\n')
    check('forced_verifier_exhaustion_recovery_is_visible',
      forcedRecoveryResult.authority?.closed_transition_action === 'resolve_context' &&
      /didn.?t catch|couldn.?t hear|say that again|send it again/i.test(forcedRecoveryText),
      JSON.stringify(forcedRecoveryResult))
    check('forced_verifier_exhaustion_recovery_never_advances_transaction',
      forcedRecoveryResult.structured_state?.form_link_sent !== true &&
      forcedRecoveryResult.structured_state?.deposit_requested !== true &&
      !/effacermonexistence|contact@omarprotocol|\bdeposit\b|\bzelle\b|\$|\b100\b/i.test(forcedRecoveryText),
      JSON.stringify({ state: forcedRecoveryResult.structured_state, forcedRecoveryText }))
    const deadletterDir = path.join(root, 'inbox_quarantine_deadletter')
    const voiceOperatorArtifacts = fs.readdirSync(humanAgentDir)
      .filter((name) => name.startsWith('visible-recovery-required-'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
      .filter((entry) => entry.contact_id === retryPacket.contact_id)
    check('persistent_verifier_exhaustion_success_is_visible_without_open_handoff',
      (!fs.existsSync(deadletterDir) || fs.readdirSync(deadletterDir).length === 0) &&
      voiceOperatorArtifacts.length === 0,
      JSON.stringify({ deadletters: fs.existsSync(deadletterDir) ? fs.readdirSync(deadletterDir) : [], voiceOperatorArtifacts }))
    const retryAudit = fs.readFileSync(path.join(root, 'control-events', 'retry-thread.ndjson'), 'utf8')
    check('visible_verifier_exhaustion_recovery_is_audited_under_lifecycle_contract',
      retryAudit.includes('control_inbound_safe_clarification_recovery_required') &&
      retryAudit.includes(inbox.SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION),
      retryAudit)

    // Persistent internal corruption is both loud for the operator and visible
    // to the client through a bounded nontransactional controller packet.
    const hardFailureOriginal = path.join(inboxDir, 'hard-internal-failure.json')
    const hardFailureLock = `${hardFailureOriginal}.lock`
    const hardFailurePacket = {
      ...retryPacket,
      contact_id: 'hard-internal-thread',
      thread_id: 'hard-internal-thread',
      message_id: 'hard-internal-message'
    }
    recordIngressEvent(root, hardFailurePacket)
    fs.writeFileSync(hardFailureLock, JSON.stringify(hardFailurePacket, null, 2) + '\n')
    inbox.releaseForRetry(hardFailureLock, hardFailurePacket, 'codex_runner_invalid_json:unexpected_token')
    const hardFailureRetry = JSON.parse(fs.readFileSync(hardFailureOriginal, 'utf8'))
    const hardFailureResult = executeSingleControlTurn(hardFailureRetry, { root })
    const hardFailureText = hardFailureResult.packet.bubbles.map((bubble) => bubble.text).join('\n')
    const hardFailureArtifacts = fs.readdirSync(humanAgentDir)
      .filter((name) => name.startsWith('visible-recovery-required-'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
      .filter((entry) => entry.contact_id === hardFailurePacket.contact_id)
    check('non_verifier_internal_failure_past_cap_is_visible_without_open_handoff',
      hardFailureRetry.control_force_route_aware_visible_recovery === true &&
      hardFailureRetry.attempts === 12 && !fs.existsSync(hardFailureLock) &&
      hardFailureResult.authority?.control_route_aware_visible_recovery === true &&
      hardFailureResult.packet.bubbles.length === 1 && hardFailureText.trim() &&
      hardFailureResult.structured_state?.form_link_sent !== true &&
      hardFailureResult.structured_state?.deposit_requested !== true &&
      hardFailureArtifacts.length === 0,
      JSON.stringify({ hardFailureRetry, hardFailureText, hardFailureArtifacts }))

    const clearExhaustionOriginal = path.join(inboxDir, 'clear-verifier-exhaustion.json')
    const clearExhaustionLock = `${clearExhaustionOriginal}.lock`
    const clearExhaustionPacket = {
      ...retryPacket,
      contact_id: 'clear-verifier-exhaustion-thread',
      thread_id: 'clear-verifier-exhaustion-thread',
      message_id: 'clear-verifier-exhaustion-message',
      text: 'How about August 25th?',
      live_turn_voice_transcribe_failed: false,
      live_turn_voice_context_unresolved: false,
      live_turn_context_relation: 'coherent'
    }
    recordIngressEvent(root, clearExhaustionPacket)
    const clearStateFile = statePath(root, clearExhaustionPacket.thread_id)
    const clearState = JSON.parse(fs.readFileSync(clearStateFile, 'utf8'))
    clearState.form_submitted = true
    clearState.known_design_context = 'blackwork snake reference'
    fs.writeFileSync(clearStateFile, JSON.stringify(clearState, null, 2) + '\n')
    fs.writeFileSync(clearExhaustionLock, JSON.stringify(clearExhaustionPacket, null, 2) + '\n')
    inbox.releaseForRetry(clearExhaustionLock, clearExhaustionPacket, retryableFailures[0])
    const clearExhaustionRetry = JSON.parse(fs.readFileSync(clearExhaustionOriginal, 'utf8'))
    const clearExhaustionResult = executeSingleControlTurn(clearExhaustionRetry, { root })
    const clearExhaustionText = clearExhaustionResult.packet.bubbles.map((bubble) => bubble.text).join('\n')
    const clearExhaustionArtifacts = fs.readdirSync(humanAgentDir)
      .filter((name) => name.startsWith('visible-recovery-required-'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
      .find((entry) => entry.contact_id === clearExhaustionPacket.contact_id)
    check('clear_date_exhaustion_never_becomes_false_unintelligible_recovery',
      inbox.inboundAllowsSafeClarificationRecovery(clearExhaustionPacket) === false &&
        clearExhaustionRetry.control_force_route_aware_visible_recovery === true &&
        !fs.existsSync(clearExhaustionLock) &&
        clearExhaustionResult.authority?.control_recovery_original_action === 'post_form_time' &&
        clearExhaustionResult.packet.bubbles.length === 1 &&
        /august 25|date message|what time/i.test(clearExhaustionText) &&
        !/didn.?t catch|couldn.?t hear|say that again|send it again/i.test(clearExhaustionText) &&
        clearExhaustionResult.structured_state?.form_submitted === true &&
        /august\s+25/i.test(String(clearExhaustionResult.structured_state?.known_requested_date || '')) &&
        clearExhaustionResult.structured_state?.booking_stage_hint === 'awaiting_time' &&
        clearExhaustionResult.structured_state?.deposit_requested !== true &&
        clearExhaustionArtifacts === undefined,
      JSON.stringify({ clearExhaustionRetry, clearExhaustionText, state: clearExhaustionResult.structured_state, clearExhaustionArtifacts }))

    // Below the cap the retry law is unchanged: internal failures keep retrying.
    const underCapOriginal = path.join(inboxDir, 'under-cap-retry.json')
    const underCapLock = `${underCapOriginal}.lock`
    const underCapPacket = { ...retryPacket, contact_id: 'under-cap-thread', thread_id: 'under-cap-thread', message_id: 'under-cap-message', attempts: 3 }
    fs.writeFileSync(underCapLock, JSON.stringify(underCapPacket, null, 2) + '\n')
    inbox.releaseForRetry(underCapLock, underCapPacket, retryableFailures[0])
    const underCapRetried = JSON.parse(fs.readFileSync(underCapOriginal, 'utf8'))
    check('persistent_internal_failure_under_cap_still_retries',
      underCapRetried.attempts === 4 && underCapRetried.last_error_kind === 'persistent_internal_control' && !fs.existsSync(underCapLock),
      JSON.stringify(underCapRetried))

    const verifierRetryOriginal = path.join(inboxDir, 'verifier-feedback-retry.json')
    const verifierRetryLock = `${verifierRetryOriginal}.lock`
    const verifierRetryPacket = {
      ...retryPacket,
      contact_id: 'verifier-feedback-thread',
      thread_id: 'verifier-feedback-thread',
      message_id: 'verifier-feedback-message',
      attempts: 0
    }
    const verifierRetryError = new Error(
      'single_control_internal_retryable:final_verifier_rejected:semantic:pricing_question_requires_visible_answer'
    )
    verifierRetryError.control_retry_context = {
      version: 'scv-verifier-feedback-loop-2026-07-25-v1',
      retry_cycle: 1,
      required_action: 'general_continue',
      route_reason: 'direct_question_obligation_owns_turn_without_cold_funnel_push',
      rejection_ledger: [{
        pass: 12,
        cycle: 0,
        phase: 'semantic',
        reason: 'pricing_question_requires_visible_answer',
        instruction: 'answer the direct pricing question',
        route_action: 'general_continue',
        candidate_sha256: 'a'.repeat(64),
        repeated_candidate: true
      }]
    }
    fs.writeFileSync(verifierRetryLock, JSON.stringify(verifierRetryPacket, null, 2) + '\n')
    inbox.releaseForRetry(verifierRetryLock, verifierRetryPacket, verifierRetryError)
    const verifierRetried = JSON.parse(fs.readFileSync(verifierRetryOriginal, 'utf8'))
    check('verifier_feedback_context_persists_across_durable_retry_cycle',
      verifierRetried.control_repair_loop_version === 'scv-verifier-feedback-loop-2026-07-25-v1' &&
      verifierRetried.control_repair_cycle === 1 &&
      verifierRetried.control_repair_required_action === 'general_continue' &&
      verifierRetried.control_repair_ledger?.[0]?.reason === 'pricing_question_requires_visible_answer' &&
      verifierRetried.last_error_kind === 'persistent_internal_control',
      JSON.stringify(verifierRetried))
    const verifierRetryAudit = fs.readFileSync(path.join(root, 'control-events', 'verifier-feedback-thread.ndjson'), 'utf8')
    check('verifier_feedback_retry_cycle_and_ledger_are_audited',
      verifierRetryAudit.includes('"control_repair_cycle":1') &&
      verifierRetryAudit.includes('"control_repair_ledger_count":1'),
      verifierRetryAudit)

    const unknownOriginal = path.join(inboxDir, 'future-unknown-retry.json')
    const unknownLock = `${unknownOriginal}.lock`
    const unknownPacket = {
      ...retryPacket,
      contact_id: 'future-unknown-thread',
      thread_id: 'future-unknown-thread',
      message_id: 'future-unknown-message'
    }
    recordIngressEvent(root, unknownPacket)
    fs.writeFileSync(unknownLock, JSON.stringify(unknownPacket, null, 2) + '\n')
    inbox.releaseForRetry(unknownLock, unknownPacket, 'TypeError: future unclassified controller failure')
    const unknownRetried = JSON.parse(fs.readFileSync(unknownOriginal, 'utf8'))
    const unknownResult = executeSingleControlTurn(unknownRetried, { root })
    const unknownText = unknownResult.packet.bubbles.map((bubble) => bubble.text).join('\n')
    const unknownArtifacts = fs.readdirSync(humanAgentDir)
      .filter((name) => name.startsWith('visible-recovery-required-'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
      .filter((entry) => entry.contact_id === unknownPacket.contact_id)
    check('future_unclassified_failure_is_bounded_visible_without_open_handoff',
      unknownRetried.attempts === 12 &&
      unknownRetried.last_error_kind === 'persistent_unclassified_fail_closed' &&
      unknownRetried.control_force_route_aware_visible_recovery === true &&
      unknownResult.authority?.control_route_aware_visible_recovery === true &&
      unknownResult.packet.bubbles.length === 1 && unknownText.trim() &&
      unknownResult.structured_state?.form_link_sent !== true &&
      unknownResult.structured_state?.deposit_requested !== true &&
      unknownArtifacts.length === 0 &&
      (!fs.existsSync(deadletterDir) || fs.readdirSync(deadletterDir).length === 0),
      JSON.stringify({ unknownRetried, unknownText, unknownArtifacts }))

    const exerciseCoherentCapRecovery = ({ slug, text, seedState, expectedAction, visiblePattern }) => {
      const packet = {
        contact_id: `${slug}-thread`,
        thread_id: `${slug}-thread`,
        instagram_username: `${slug}.test`,
        message_id: `${slug}-message`,
        text,
        attempts: 11,
        received_at: '2026-08-25T12:00:00.000Z',
        live_turn_context_relation: 'coherent'
      }
      recordIngressEvent(root, packet)
      const file = statePath(root, packet.thread_id)
      const seeded = {
        ...JSON.parse(fs.readFileSync(file, 'utf8')),
        ...seedState
      }
      fs.writeFileSync(file, JSON.stringify(seeded, null, 2) + '\n')
      const original = path.join(inboxDir, `${slug}.json`)
      const lock = `${original}.lock`
      fs.writeFileSync(lock, JSON.stringify(packet, null, 2) + '\n')
      inbox.releaseForRetry(lock, packet, retryableFailures[0])
      const retry = JSON.parse(fs.readFileSync(original, 'utf8'))
      const result = executeSingleControlTurn(retry, { root })
      const visible = result.packet.bubbles.map((bubble) => bubble.text).join('\n')
      const artifacts = fs.readdirSync(humanAgentDir)
        .filter((name) => name.startsWith('visible-recovery-required-'))
        .map((name) => JSON.parse(fs.readFileSync(path.join(humanAgentDir, name), 'utf8')))
        .filter((entry) => entry.contact_id === packet.contact_id)
      const durableFields = [
        'form_offer_asked',
        'form_link_sent',
        'form_submitted',
        'known_requested_date',
        'known_requested_time',
        'double_check_sent',
        'deposit_requested'
      ]
      const durableUnchanged = durableFields.every((fieldName) => (
        result.structured_state?.[fieldName] === seeded[fieldName]
      ))
      check(`${slug}_cap_exhaustion_has_one_visible_nontransactional_reply`,
        retry.control_force_route_aware_visible_recovery === true &&
        retry.attempts === 12 && !fs.existsSync(lock) &&
        result.authority?.control_route_aware_visible_recovery === true &&
        result.authority?.control_recovery_original_action === expectedAction &&
        result.packet.bubbles.length === 1 && visiblePattern.test(visible) &&
        durableUnchanged &&
        !/effacermonexistence|contact@omarprotocol|\bzelle\b/i.test(visible) &&
        artifacts.length === 0,
        JSON.stringify({ retry, visible, authority: result.authority, seeded, state: result.structured_state, artifacts }))
    }

    exerciseCoherentCapRecovery({
      slug: 'yes-plz',
      text: 'yes plz',
      seedState: {
        tattoo_intent_active: true,
        known_design_context: 'blackwork snake',
        form_offer_asked: true
      },
      expectedAction: 'send_form',
      visiblePattern: /said yes|form/i
    })
    exerciseCoherentCapRecovery({
      slug: 'yes-price',
      text: 'YES PLEASE, HOW MUCH IS IT BY THE WAY?',
      seedState: {
        tattoo_intent_active: true,
        known_design_context: 'blackwork snake',
        form_offer_asked: true
      },
      expectedAction: 'send_form',
      visiblePattern: /\$150 per hour|model rate/i
    })
    exerciseCoherentCapRecovery({
      slug: 'form-submitted',
      text: 'I just submitted the form',
      seedState: {
        tattoo_intent_active: true,
        known_design_context: 'blackwork snake',
        form_offer_asked: true,
        form_link_sent: true
      },
      expectedAction: 'post_form_availability',
      visiblePattern: /submitted the form|what date/i
    })

    // Exact live regression, 2026-08-28 21:49 PT: the form identity and date
    // were durable, the artist had just asked what time worked, and the client
    // answered "Can we do 11 AM?". 11 AM is now prohibited by the canonical
    // 1 PM start-time floor. Even when an old retry ledger forces bounded
    // recovery, the turn must stay at the time checkpoint, reject only the
    // invalid time, and never run the four-field double-check or system prose.
    const freshTimePacket = {
      contact_id: 'fresh-time-after-old-repair-thread',
      thread_id: 'fresh-time-after-old-repair-thread',
      instagram_username: 'omar.system',
      message_id: 'fresh-time-after-old-repair-message',
      text: 'Can we do 11 AM?',
      attempts: 11,
      received_at: '2026-08-29T04:49:41.888Z',
      live_turn_context_relation: 'coherent'
    }
    recordIngressEvent(root, freshTimePacket)
    const freshTimeStateFile = statePath(root, freshTimePacket.thread_id)
    const freshTimeSeed = {
      ...JSON.parse(fs.readFileSync(freshTimeStateFile, 'utf8')),
      tattoo_intent_active: true,
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Mina',
      known_phone_used_on_form: '4157602883',
      known_requested_date: 'September 4',
      last_offered_date: 'september 4',
      booking_stage_hint: 'awaiting_time'
    }
    fs.writeFileSync(freshTimeStateFile, JSON.stringify(freshTimeSeed, null, 2) + '\n')
    const freshTimeOriginal = path.join(inboxDir, 'fresh-time-after-old-repair.json')
    const freshTimeLock = `${freshTimeOriginal}.lock`
    fs.writeFileSync(freshTimeLock, JSON.stringify(freshTimePacket, null, 2) + '\n')
    inbox.releaseForRetry(freshTimeLock, freshTimePacket, retryableFailures[0])
    const freshTimeRetry = JSON.parse(fs.readFileSync(freshTimeOriginal, 'utf8'))
    const freshTimeResult = executeSingleControlTurn(freshTimeRetry, { root })
    const freshTimeVisible = freshTimeResult.packet.bubbles.map((entry) => entry.text).join('\n')
    check('too_early_time_after_old_repair_keeps_time_checkpoint_visible',
      freshTimeRetry.control_force_route_aware_visible_recovery === true &&
      freshTimeResult.packet.bubbles.length === 1 &&
      freshTimeResult.authority?.candidate_authority?.executor === 'deterministic_route_aware_visible_after_failure_exhaustion' &&
      freshTimeResult.authority?.control_recovery_original_action === 'post_form_time' &&
      freshTimeResult.authority?.control_recovery_original_reason === 'submitted_form_time_before_minimum' &&
      /11\s*a\.?m\.?/i.test(freshTimeVisible) &&
      /1\s*p\.?m\.?\s+or\s+later/i.test(freshTimeVisible) &&
      /would\s+1\s+or\s+2\s+work/i.test(freshTimeVisible) &&
      !/Name\s*:|Phone Number\s*:|double check/i.test(freshTimeVisible) &&
      !/booking details|while i verify|keep your place/i.test(freshTimeVisible),
      JSON.stringify({
        freshTimeRetry,
        visible: freshTimeVisible,
        authority: freshTimeResult.authority,
        state: freshTimeResult.structured_state
      }))

    const boundedRunnerError =
      'single_control_upstream_retryable:openai_upstream_transient_exhausted:openai_http_503'
    const boundedDeliveryError = '3101_post_failed_503'
    const operatorArtifactsForContact = (contactId) => (
      fs.existsSync(humanAgentDir)
        ? fs.readdirSync(humanAgentDir)
          .filter((name) => name.endsWith('.json'))
          .map((name) => ({
            name,
            text: fs.readFileSync(path.join(humanAgentDir, name), 'utf8')
          }))
          .filter((entry) => JSON.parse(entry.text).contact_id === contactId)
        : []
    )
    const transactionFields = [
      'form_offer_asked',
      'form_link_sent',
      'form_submitted',
      'known_requested_date',
      'known_requested_time',
      'double_check_sent',
      'deposit_requested'
    ]

    // Original regression: OpenAI/provider exhaustion used to be requeued
    // forever. At the cap it now arms one deterministic route-aware pass. A
    // successful pass is exactly one visible bubble and leaves no actionable
    // operator artifact that could trigger a second manual reply.
    const runnerSuccessPacket = {
      ...retryPacket,
      contact_id: 'bounded-runner-success-thread',
      thread_id: 'bounded-runner-success-thread',
      message_id: 'bounded-runner-success-message',
      text: 'yes plz',
      attempts: 11,
      live_turn_voice_transcribe_failed: false,
      live_turn_voice_context_unresolved: false,
      live_turn_context_relation: 'coherent'
    }
    recordIngressEvent(root, runnerSuccessPacket)
    const runnerSuccessStateFile = statePath(root, runnerSuccessPacket.thread_id)
    const runnerSuccessSeed = {
      ...JSON.parse(fs.readFileSync(runnerSuccessStateFile, 'utf8')),
      tattoo_intent_active: true,
      known_design_context: 'blackwork snake',
      form_offer_asked: true,
      form_link_sent: false,
      form_submitted: false,
      known_requested_date: '',
      known_requested_time: '',
      double_check_sent: false,
      deposit_requested: false
    }
    fs.writeFileSync(runnerSuccessStateFile, JSON.stringify(runnerSuccessSeed, null, 2) + '\n')
    const runnerSuccessOriginal = path.join(inboxDir, 'bounded-runner-success.json')
    const runnerSuccessLock = `${runnerSuccessOriginal}.lock`
    fs.writeFileSync(runnerSuccessLock, JSON.stringify(runnerSuccessPacket, null, 2) + '\n')
    inbox.releaseForRetry(runnerSuccessLock, runnerSuccessPacket, boundedRunnerError)
    const runnerSuccessRetry = JSON.parse(fs.readFileSync(runnerSuccessOriginal, 'utf8'))
    check('transient_runner_cap_arms_one_final_deterministic_recovery_without_actionable_alert',
      runnerSuccessRetry.attempts === 12 &&
      runnerSuccessRetry.last_error_kind === 'transient_upstream' &&
      runnerSuccessRetry.control_force_route_aware_visible_recovery === true &&
      runnerSuccessRetry.control_route_aware_visible_recovery_reason === 'transient_upstream_exhausted' &&
      runnerSuccessRetry.control_final_recovery_version ===
        inbox.BOUNDED_TRANSIENT_RECOVERY_VERSION &&
      runnerSuccessRetry.control_final_recovery_phase === 'precommit_final_recovery' &&
      !fs.existsSync(runnerSuccessLock) &&
      operatorArtifactsForContact(runnerSuccessPacket.contact_id).length === 0,
      JSON.stringify({ runnerSuccessRetry, artifacts: operatorArtifactsForContact(runnerSuccessPacket.contact_id) }))
    const runnerSuccessResult = executeSingleControlTurn(runnerSuccessRetry, { root })
    const runnerSuccessText = runnerSuccessResult.packet.bubbles.map((entry) => entry.text).join('\n')
    const runnerSuccessTransactionUnchanged = transactionFields.every((fieldName) => (
      ['known_requested_date', 'known_requested_time'].includes(fieldName)
        ? String(runnerSuccessResult.structured_state?.[fieldName] || '') ===
          String(runnerSuccessSeed[fieldName] || '')
        : Boolean(runnerSuccessResult.structured_state?.[fieldName]) ===
          Boolean(runnerSuccessSeed[fieldName])
    ))
    check('transient_runner_final_recovery_success_is_one_visible_nontransactional_reply_and_zero_alerts',
      runnerSuccessResult.authority?.control_route_aware_visible_recovery === true &&
      runnerSuccessResult.packet.bubbles.length === 1 &&
      runnerSuccessText.trim().length > 0 &&
      /said yes|form/i.test(runnerSuccessText) &&
      runnerSuccessTransactionUnchanged &&
      operatorArtifactsForContact(runnerSuccessPacket.contact_id).length === 0,
      JSON.stringify({
        runnerSuccessText,
        authority: runnerSuccessResult.authority,
        state: runnerSuccessResult.structured_state,
        artifacts: operatorArtifactsForContact(runnerSuccessPacket.contact_id)
      }))

    // If that same deterministic runner pass itself cannot complete, the
    // accepted inbound terminalizes once. The operator artifact precedes lock
    // removal and is stable across a stale-lock/restart replay.
    const runnerTerminalPacket = {
      ...runnerSuccessPacket,
      contact_id: 'bounded-runner-terminal-thread',
      thread_id: 'bounded-runner-terminal-thread',
      message_id: 'bounded-runner-terminal-message'
    }
    recordIngressEvent(root, runnerTerminalPacket)
    const runnerTerminalStateFile = statePath(root, runnerTerminalPacket.thread_id)
    const runnerTerminalStateBefore = fs.readFileSync(runnerTerminalStateFile, 'utf8')
    const runnerTerminalOriginal = path.join(inboxDir, 'bounded-runner-terminal.json')
    const runnerTerminalLock = `${runnerTerminalOriginal}.lock`
    fs.writeFileSync(runnerTerminalLock, JSON.stringify(runnerTerminalPacket, null, 2) + '\n')
    inbox.releaseForRetry(runnerTerminalLock, runnerTerminalPacket, boundedRunnerError)
    const runnerTerminalRetry = JSON.parse(fs.readFileSync(runnerTerminalOriginal, 'utf8'))
    check('transient_runner_final_attempt_is_armed_before_terminal_boundary',
      operatorArtifactsForContact(runnerTerminalPacket.contact_id).length === 0 &&
      runnerTerminalRetry.control_final_recovery_phase === 'precommit_final_recovery',
      JSON.stringify(runnerTerminalRetry))
    fs.renameSync(runnerTerminalOriginal, runnerTerminalLock)
    const runnerTerminal = inbox.releaseForRetry(
      runnerTerminalLock,
      runnerTerminalRetry,
      'codex_runner_invalid_json:mixed_error_after_final_runner_fallback'
    )
    const runnerTerminalArtifacts = operatorArtifactsForContact(runnerTerminalPacket.contact_id)
    check('precommit_final_phase_terminalizes_across_mixed_error_classes_without_requeue',
      runnerTerminal?.terminal === true &&
      runnerTerminal?.operator_alert_created === true &&
      runnerTerminalArtifacts.length === 1 &&
      !fs.existsSync(runnerTerminalOriginal) &&
      !fs.existsSync(runnerTerminalLock) &&
      fs.readFileSync(runnerTerminalStateFile, 'utf8') === runnerTerminalStateBefore &&
      (!fs.existsSync(deadletterDir) || fs.readdirSync(deadletterDir).length === 0),
      JSON.stringify({ runnerTerminal, runnerTerminalArtifacts }))
    const runnerTerminalArtifactText = runnerTerminalArtifacts[0]?.text || ''
    fs.writeFileSync(runnerTerminalLock, JSON.stringify(runnerTerminalRetry, null, 2) + '\n')
    const runnerRestartTerminal = inbox.releaseForRetry(
      runnerTerminalLock,
      runnerTerminalRetry,
      '3101_post_failed_503'
    )
    const runnerRestartArtifacts = operatorArtifactsForContact(runnerTerminalPacket.contact_id)
    check('transient_runner_terminal_restart_is_idempotent_exactly_one_operator_artifact',
      runnerRestartTerminal?.terminal === true &&
      runnerRestartTerminal?.operator_alert_created === false &&
      runnerRestartArtifacts.length === 1 &&
      runnerRestartArtifacts[0].text === runnerTerminalArtifactText &&
      !fs.existsSync(runnerTerminalOriginal) &&
      !fs.existsSync(runnerTerminalLock),
      JSON.stringify({ runnerRestartTerminal, runnerRestartArtifacts }))

    // A 3101-class error is post-commit. If the exact committed decision is
    // absent, neither the inbox boundary nor the controller may reinterpret it
    // as a generation failure and create a new semantic reply.
    const missingDeliveryPacket = {
      ...runnerSuccessPacket,
      contact_id: 'missing-delivery-commit-thread',
      thread_id: 'missing-delivery-commit-thread',
      message_id: 'missing-delivery-commit-message',
      attempts: 0
    }
    recordIngressEvent(root, missingDeliveryPacket)
    const missingDeliveryStateFile = statePath(root, missingDeliveryPacket.thread_id)
    const missingDeliveryStateBefore = fs.readFileSync(missingDeliveryStateFile, 'utf8')
    const missingDeliveryOriginal = path.join(inboxDir, 'missing-delivery-commit.json')
    const missingDeliveryLock = `${missingDeliveryOriginal}.lock`
    fs.writeFileSync(missingDeliveryLock, JSON.stringify(missingDeliveryPacket, null, 2) + '\n')
    const missingDeliveryHold = inbox.releaseForRetry(
      missingDeliveryLock,
      missingDeliveryPacket,
      boundedDeliveryError
    )
    check('delivery_class_without_committed_decision_holds_once_without_generation_or_state_mutation',
      missingDeliveryHold?.terminal === true &&
      missingDeliveryHold?.human_action_pending === true &&
      missingDeliveryHold?.no_blind_resend === true &&
      missingDeliveryHold?.operator_alert_created === true &&
      operatorArtifactsForContact(missingDeliveryPacket.contact_id).length === 1 &&
      !fs.existsSync(missingDeliveryOriginal) &&
      !fs.existsSync(missingDeliveryLock) &&
      fs.readFileSync(missingDeliveryStateFile, 'utf8') === missingDeliveryStateBefore,
      JSON.stringify({ missingDeliveryHold }))
    const missingDeliveryArtifactText = operatorArtifactsForContact(
      missingDeliveryPacket.contact_id
    )[0]?.text || ''
    fs.writeFileSync(missingDeliveryLock, JSON.stringify(missingDeliveryPacket, null, 2) + '\n')
    const missingDeliveryRestart = inbox.releaseForRetry(
      missingDeliveryLock,
      missingDeliveryPacket,
      boundedRunnerError
    )
    const missingDeliveryRestartArtifacts = operatorArtifactsForContact(
      missingDeliveryPacket.contact_id
    )
    check('durable_delivery_hold_is_monotonic_across_restart_and_changed_error_class',
      missingDeliveryRestart?.terminal === true &&
      missingDeliveryRestart?.no_blind_resend === true &&
      missingDeliveryRestart?.operator_alert_created === false &&
      missingDeliveryRestartArtifacts.length === 1 &&
      missingDeliveryRestartArtifacts[0]?.text === missingDeliveryArtifactText &&
      !fs.existsSync(missingDeliveryOriginal) &&
      !fs.existsSync(missingDeliveryLock) &&
      fs.readFileSync(missingDeliveryStateFile, 'utf8') === missingDeliveryStateBefore,
      JSON.stringify({ missingDeliveryRestart, missingDeliveryRestartArtifacts }))
    let forbiddenMissingCommitGeneratorCalls = 0
    let missingCommitGuardError = ''
    try {
      executeSingleControlTurn({
        ...missingDeliveryPacket,
        control_final_recovery_version: inbox.BOUNDED_TRANSIENT_RECOVERY_VERSION,
        control_final_recovery_phase: 'postcommit_delivery_reconciliation'
      }, {
        root,
        candidateGenerator: () => {
          forbiddenMissingCommitGeneratorCalls += 1
          return 'forbidden fresh generation'
        }
      })
    } catch (error) {
      missingCommitGuardError = String(error?.message || error)
    }
    check('controller_delivery_phase_missing_commit_fails_closed_before_generator',
      missingCommitGuardError === 'single_control_delivery_replay_commit_missing' &&
      forbiddenMissingCommitGeneratorCalls === 0 &&
      fs.readFileSync(missingDeliveryStateFile, 'utf8') === missingDeliveryStateBefore,
      JSON.stringify({ missingCommitGuardError, forbiddenMissingCommitGeneratorCalls }))

    const rawFetchPacket = {
      ...runnerSuccessPacket,
      contact_id: 'raw-fetch-precommit-thread',
      thread_id: 'raw-fetch-precommit-thread',
      message_id: 'raw-fetch-precommit-message',
      attempts: 11
    }
    recordIngressEvent(root, rawFetchPacket)
    const rawFetchOriginal = path.join(inboxDir, 'raw-fetch-precommit.json')
    const rawFetchLock = `${rawFetchOriginal}.lock`
    fs.writeFileSync(rawFetchLock, JSON.stringify(rawFetchPacket, null, 2) + '\n')
    inbox.releaseForRetry(rawFetchLock, rawFetchPacket, 'TypeError: fetch failed')
    const rawFetchRetry = JSON.parse(fs.readFileSync(rawFetchOriginal, 'utf8'))
    check('untagged_network_error_stays_precommit_and_never_enters_delivery_hold',
      rawFetchRetry.last_error_kind === 'transient_upstream' &&
      rawFetchRetry.control_final_recovery_phase === 'precommit_final_recovery' &&
      rawFetchRetry.control_force_route_aware_visible_recovery === true &&
      rawFetchRetry.control_route_aware_visible_recovery_reason ===
        'transient_upstream_exhausted' &&
      inbox.isExplicitPost3101DeliveryError('TypeError: fetch failed') === false &&
      operatorArtifactsForContact(rawFetchPacket.contact_id).length === 0 &&
      !fs.existsSync(rawFetchLock),
      JSON.stringify({ rawFetchRetry }))

    const prepareCommittedDeliveryCase = (slug) => {
      const packet = {
        ...runnerSuccessPacket,
        contact_id: `${slug}-thread`,
        thread_id: `${slug}-thread`,
        message_id: `${slug}-message`,
        control_force_route_aware_visible_recovery: true,
        control_route_aware_visible_recovery_version:
          ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
        control_route_aware_visible_recovery_after_attempts: 12,
        control_route_aware_visible_recovery_reason: 'persistent_failure_exhausted',
        last_error_kind: 'persistent_internal_control'
      }
      recordIngressEvent(root, packet)
      const file = statePath(root, packet.thread_id)
      const seed = {
        ...JSON.parse(fs.readFileSync(file, 'utf8')),
        tattoo_intent_active: true,
        known_design_context: 'blackwork snake',
        form_offer_asked: true,
        form_link_sent: false,
        form_submitted: false,
        double_check_sent: false,
        deposit_requested: false
      }
      fs.writeFileSync(file, JSON.stringify(seed, null, 2) + '\n')
      const committed = executeSingleControlTurn(packet, { root })
      return { packet, stateFile: file, committed }
    }
    const committedBubblePacket = (testCase, index) => {
      const bubbles = testCase.committed.packet.bubbles
      return {
        contact_id: testCase.packet.contact_id,
        thread_id: testCase.packet.thread_id,
        instagram_username: testCase.packet.instagram_username,
        message_id: testCase.packet.message_id,
        text: testCase.packet.text,
        bubble_index: index,
        bubble_count: bubbles.length,
        bubble: { text: bubbles[index].text },
        bubbles,
        source: testCase.committed.source,
        authority: testCase.committed.authority,
        control_receipt: testCase.committed.control_receipt
      }
    }
    const adoptCommittedBubbles = (testCase, indices = null) => {
      const bubbles = testCase.committed.packet.bubbles
      const selected = Array.isArray(indices)
        ? indices
        : bubbles.map((_bubble, index) => index)
      return selected.map((index) => adoptOutboxPacket({
        root,
        packet: committedBubblePacket(testCase, index)
      }))
    }

    // Exact queue-take race: reconciliation verifies the active packet, then
    // the outbox worker takes, sends, and removes it before marker repair. The
    // inspector may publish only the strict receipt-bound marker; it must never
    // reconstruct a queue that could send the same customer reply twice.
    const markerRaceCase = prepareCommittedDeliveryCase('marker-only-repair-race')
    const markerRacePacket = committedBubblePacket(markerRaceCase, 0)
    const markerRaceKey =
      `${markerRaceCase.committed.control_receipt.receipt_sha256}-0`
    const markerRacePaths = adoptionPaths(root)
    const markerRaceQueue = path.join(markerRacePaths.outbox, `${markerRaceKey}.json`)
    const markerRaceOutboxLock = `${markerRaceQueue}.lock`
    const markerRaceMarker = path.join(
      markerRacePaths.markers,
      `${markerRaceKey}.json`
    )
    durableCreateJson(markerRaceQueue, markerRacePacket)
    let markerRaceHookCalls = 0
    let markerRaceConcurrentPublishCalls = 0
    inbox.setInboxHarnessHooks({
      afterActiveAdoptionInspection: ({ file, key }) => {
        markerRaceHookCalls += 1
        if (file !== markerRaceQueue || key !== markerRaceKey) {
          throw new Error('marker_race_hook_identity_mismatch')
        }
        fs.renameSync(markerRaceQueue, markerRaceOutboxLock)
        fs.unlinkSync(markerRaceOutboxLock)
      },
      beforeMarkerRepairPublish: ({ marker_file, key, queue_file_sha256 }) => {
        markerRaceConcurrentPublishCalls += 1
        if (marker_file !== markerRaceMarker || key !== markerRaceKey) {
          throw new Error('marker_publish_race_hook_identity_mismatch')
        }
        ensureMarkerForPacket(
          root,
          marker_file,
          markerRacePacket,
          key,
          queue_file_sha256
        )
      }
    })
    const markerRaceInboundLock = path.join(
      inboxDir,
      'marker-only-repair-race.json.lock'
    )
    fs.writeFileSync(
      markerRaceInboundLock,
      JSON.stringify(markerRaceCase.packet, null, 2) + '\n'
    )
    const markerRaceTerminal = inbox.releaseForRetry(
      markerRaceInboundLock,
      markerRaceCase.packet,
      '3101_post_timeout_100'
    )
    inbox.setInboxHarnessHooks(null)
    const markerRaceMarkerVerdict = inspectMarkerFile(
      root,
      markerRaceMarker,
      markerRacePacket,
      markerRaceKey,
      { allowLegacy: false }
    )
    check('adoption_inspection_queue_take_race_repairs_marker_only_without_queue_recreation',
      markerRaceHookCalls === 1 &&
      markerRaceConcurrentPublishCalls === 1 &&
      markerRaceTerminal?.terminal === true &&
      markerRaceTerminal?.adopted === true &&
      markerRaceTerminal?.operator_alert_created === false &&
      markerRaceMarkerVerdict.valid === true &&
      !fs.existsSync(markerRaceQueue) &&
      !fs.existsSync(markerRaceOutboxLock) &&
      !fs.existsSync(markerRaceInboundLock) &&
      operatorArtifactsForContact(markerRaceCase.packet.contact_id).length === 0,
      JSON.stringify({
        markerRaceHookCalls,
        markerRaceConcurrentPublishCalls,
        markerRaceTerminal,
        markerRaceMarkerVerdict
      }))

    // A durable decision followed by local pre-network failure is neither a
    // generation failure nor ambiguous delivery. At the cap it gets exactly
    // one receipt replay without generation or funnel mutation, then a repeated
    // local failure terminalizes in one stable operator alert.
    const preNetworkCase = prepareCommittedDeliveryCase('committed-prenetwork-local-failure')
    const preNetworkStateBefore = fs.readFileSync(preNetworkCase.stateFile, 'utf8')
    const preNetworkReceiptSha =
      preNetworkCase.committed.control_receipt.receipt_sha256
    const preNetworkDecisionArtifact = path.join(
      root,
      'control-decisions',
      `${preNetworkReceiptSha}.json`
    )
    const preNetworkAuditFile = path.join(
      root,
      'control-events',
      `${preNetworkCase.packet.thread_id}.ndjson`
    )
    fs.unlinkSync(preNetworkDecisionArtifact)
    const preNetworkAuditWithoutCommit = fs.readFileSync(
      preNetworkAuditFile,
      'utf8'
    ).split(/\r?\n/).filter(Boolean).filter((line) => {
      try {
        const event = JSON.parse(line)
        return !(
          event?.type === 'control_decision_committed' &&
          event?.receipt_sha256 === preNetworkReceiptSha
        )
      } catch {
        return true
      }
    }).join('\n')
    fs.writeFileSync(
      preNetworkAuditFile,
      preNetworkAuditWithoutCommit
        ? `${preNetworkAuditWithoutCommit}\n`
        : ''
    )
    const preNetworkOriginal = path.join(
      inboxDir,
      'committed-prenetwork-local-failure.json'
    )
    const preNetworkLock = `${preNetworkOriginal}.lock`
    fs.writeFileSync(
      preNetworkLock,
      JSON.stringify(preNetworkCase.packet, null, 2) + '\n'
    )
    const preNetworkError = new Error(
      'single_control_decision_artifact_write_failed_after_state_commit'
    )
    preNetworkError.control_inbox_execution_stage =
      inbox.INBOX_EXECUTION_STAGE_PRECOMMIT
    inbox.releaseForRetry(preNetworkLock, preNetworkCase.packet, preNetworkError)
    const preNetworkRetry = JSON.parse(fs.readFileSync(preNetworkOriginal, 'utf8'))
    let forbiddenPreNetworkGeneratorCalls = 0
    const preNetworkReplay = executeSingleControlTurn(preNetworkRetry, {
      root,
      candidateGenerator: () => {
        forbiddenPreNetworkGeneratorCalls += 1
        throw new Error('committed_prenetwork_replay_must_not_generate')
      }
    })
    check('committed_prenetwork_cap_arms_exact_receipt_replay_without_alert_or_state_mutation',
      preNetworkRetry.control_final_recovery_version ===
        inbox.BOUNDED_TRANSIENT_RECOVERY_VERSION &&
      preNetworkRetry.control_final_recovery_phase ===
        'committed_pre_network_final_replay' &&
      preNetworkRetry.control_inbox_last_failure_stage ===
        inbox.INBOX_EXECUTION_STAGE_COMMITTED_PRENETWORK &&
      preNetworkReplay.replayed_control_decision === true &&
      forbiddenPreNetworkGeneratorCalls === 0 &&
      preNetworkReplay.control_receipt?.receipt_sha256 ===
        preNetworkCase.committed.control_receipt?.receipt_sha256 &&
      fs.existsSync(preNetworkDecisionArtifact) &&
      fs.readFileSync(preNetworkAuditFile, 'utf8').includes(
        preNetworkReceiptSha
      ) &&
      fs.readFileSync(preNetworkCase.stateFile, 'utf8') === preNetworkStateBefore &&
      operatorArtifactsForContact(preNetworkCase.packet.contact_id).length === 0,
      JSON.stringify({ preNetworkRetry, forbiddenPreNetworkGeneratorCalls }))
    fs.renameSync(preNetworkOriginal, preNetworkLock)
    const preNetworkTerminal = inbox.releaseForRetry(
      preNetworkLock,
      preNetworkRetry,
      preNetworkError
    )
    const preNetworkArtifacts = operatorArtifactsForContact(
      preNetworkCase.packet.contact_id
    )
    check('committed_prenetwork_final_replay_failure_terminalizes_once_without_state_mutation',
      preNetworkTerminal?.terminal === true &&
      preNetworkTerminal?.operator_alert_created === true &&
      preNetworkArtifacts.length === 1 &&
      !fs.existsSync(preNetworkOriginal) &&
      !fs.existsSync(preNetworkLock) &&
      fs.readFileSync(preNetworkCase.stateFile, 'utf8') === preNetworkStateBefore,
      JSON.stringify({ preNetworkTerminal, preNetworkArtifacts }))
    const preNetworkArtifactText = preNetworkArtifacts[0]?.text || ''
    fs.writeFileSync(
      preNetworkLock,
      JSON.stringify(preNetworkRetry, null, 2) + '\n'
    )
    const preNetworkRestartTerminal = inbox.releaseForRetry(
      preNetworkLock,
      preNetworkRetry,
      Object.assign(new Error('3101_post_timeout_100'), {
        control_inbox_execution_stage:
          inbox.INBOX_EXECUTION_STAGE_POST3101_ATTEMPT
      })
    )
    const preNetworkRestartArtifacts = operatorArtifactsForContact(
      preNetworkCase.packet.contact_id
    )
    check('committed_prenetwork_terminal_restart_reuses_exactly_one_operator_artifact',
      preNetworkRestartTerminal?.terminal === true &&
      preNetworkRestartTerminal?.operator_alert_created === false &&
      preNetworkRestartArtifacts.length === 1 &&
      preNetworkRestartArtifacts[0]?.text === preNetworkArtifactText &&
      !fs.existsSync(preNetworkOriginal) &&
      !fs.existsSync(preNetworkLock) &&
      fs.readFileSync(preNetworkCase.stateFile, 'utf8') === preNetworkStateBefore,
      JSON.stringify({ preNetworkRestartTerminal, preNetworkRestartArtifacts }))

    const missingPreNetworkPacket = {
      ...runnerSuccessPacket,
      contact_id: 'missing-prenetwork-commit-thread',
      thread_id: 'missing-prenetwork-commit-thread',
      message_id: 'missing-prenetwork-commit-message'
    }
    recordIngressEvent(root, missingPreNetworkPacket)
    const missingPreNetworkStateFile = statePath(
      root,
      missingPreNetworkPacket.thread_id
    )
    const missingPreNetworkStateBefore = fs.readFileSync(
      missingPreNetworkStateFile,
      'utf8'
    )
    let forbiddenMissingPreNetworkGeneratorCalls = 0
    let missingPreNetworkGuardError = ''
    try {
      executeSingleControlTurn({
        ...missingPreNetworkPacket,
        control_final_recovery_version: inbox.BOUNDED_TRANSIENT_RECOVERY_VERSION,
        control_final_recovery_phase: 'committed_pre_network_final_replay'
      }, {
        root,
        candidateGenerator: () => {
          forbiddenMissingPreNetworkGeneratorCalls += 1
          return 'forbidden fresh generation'
        }
      })
    } catch (error) {
      missingPreNetworkGuardError = String(error?.message || error)
    }
    check('controller_committed_prenetwork_phase_missing_commit_fails_closed_before_generator',
      missingPreNetworkGuardError ===
        'single_control_committed_pre_network_replay_commit_missing' &&
      forbiddenMissingPreNetworkGeneratorCalls === 0 &&
      fs.readFileSync(missingPreNetworkStateFile, 'utf8') ===
        missingPreNetworkStateBefore,
      JSON.stringify({
        missingPreNetworkGuardError,
        forbiddenMissingPreNetworkGeneratorCalls
      }))

    // 3101 ambiguity is a different phase from model generation. It gets one
    // same-decision retry: replay must return the already committed receipt and
    // packet without invoking a generator or changing funnel state.
    const deliverySuccessCase = prepareCommittedDeliveryCase('bounded-delivery-success')
    const deliverySuccessOriginal = path.join(inboxDir, 'bounded-delivery-success.json')
    const deliverySuccessLock = `${deliverySuccessOriginal}.lock`
    fs.writeFileSync(deliverySuccessLock, JSON.stringify(deliverySuccessCase.packet, null, 2) + '\n')
    inbox.releaseForRetry(
      deliverySuccessLock,
      deliverySuccessCase.packet,
      boundedDeliveryError
    )
    const deliverySuccessRetry = JSON.parse(fs.readFileSync(deliverySuccessOriginal, 'utf8'))
    const deliveryStateBeforeReplay = fs.readFileSync(deliverySuccessCase.stateFile, 'utf8')
    let forbiddenDeliveryGeneratorCalls = 0
    const deliveryReplay = executeSingleControlTurn(deliverySuccessRetry, {
      root,
      candidateGenerator: () => {
        forbiddenDeliveryGeneratorCalls += 1
        throw new Error('delivery_replay_must_not_generate')
      }
    })
    const outboxDir = path.join(root, 'outbox')
    check('transient_3101_cap_replays_committed_receipt_without_generation_mutation_or_alert',
      deliverySuccessRetry.last_error_kind === 'transient_delivery' &&
      deliverySuccessRetry.control_final_recovery_version ===
        inbox.BOUNDED_TRANSIENT_RECOVERY_VERSION &&
      deliverySuccessRetry.control_final_recovery_phase ===
        'postcommit_delivery_reconciliation' &&
      deliveryReplay.replayed_control_decision === true &&
      forbiddenDeliveryGeneratorCalls === 0 &&
      deliveryReplay.control_receipt?.receipt_sha256 ===
        deliverySuccessCase.committed.control_receipt?.receipt_sha256 &&
      JSON.stringify(deliveryReplay.packet.bubbles) ===
        JSON.stringify(deliverySuccessCase.committed.packet.bubbles) &&
      fs.readFileSync(deliverySuccessCase.stateFile, 'utf8') === deliveryStateBeforeReplay &&
      operatorArtifactsForContact(deliverySuccessCase.packet.contact_id).length === 0 &&
      (!fs.existsSync(outboxDir) || fs.readdirSync(outboxDir).length === 0),
      JSON.stringify({
        deliverySuccessRetry,
        deliveryReplayReceipt: deliveryReplay.control_receipt,
        committedReceipt: deliverySuccessCase.committed.control_receipt,
        forbiddenDeliveryGeneratorCalls,
        artifacts: operatorArtifactsForContact(deliverySuccessCase.packet.contact_id)
      }))
    // Exact timeout-after-adoption regression: 3101 durably published every
    // receipt-bound bubble but its HTTP response was lost. The inbox worker must
    // repair only the processing receipt and retire the inbound, never publish a
    // second outbox packet or open a manual-send handoff.
    const deliveryAdoptions = adoptCommittedBubbles(deliverySuccessCase)
    fs.renameSync(deliverySuccessOriginal, deliverySuccessLock)
    const adoptedTimeoutTerminal = inbox.releaseForRetry(
      deliverySuccessLock,
      deliverySuccessRetry,
      '3101_post_timeout_100'
    )
    const deliveryReceiptSha = deliverySuccessCase.committed.control_receipt.receipt_sha256
    const deliveryQueueNames = fs.readdirSync(outboxDir)
      .filter((name) => name.startsWith(deliveryReceiptSha) && name.endsWith('.json'))
    const deliveryMarkerNames = fs.readdirSync(path.join(root, 'outbox-idempotency'))
      .filter((name) => name.startsWith(deliveryReceiptSha) && name.endsWith('.json'))
    check('timeout_after_full_adoption_repairs_processing_receipt_without_duplicate_or_alert',
      deliveryAdoptions.length === deliverySuccessCase.committed.packet.bubbles.length &&
      adoptedTimeoutTerminal?.terminal === true &&
      adoptedTimeoutTerminal?.adopted === true &&
      adoptedTimeoutTerminal?.operator_alert_created === false &&
      !fs.existsSync(deliverySuccessOriginal) &&
      !fs.existsSync(deliverySuccessLock) &&
      deliveryQueueNames.length === deliverySuccessCase.committed.packet.bubbles.length &&
      deliveryMarkerNames.length === deliverySuccessCase.committed.packet.bubbles.length &&
      fs.readFileSync(deliverySuccessCase.stateFile, 'utf8') === deliveryStateBeforeReplay &&
      operatorArtifactsForContact(deliverySuccessCase.packet.contact_id).length === 0,
      JSON.stringify({
        deliveryAdoptions,
        adoptedTimeoutTerminal,
        deliveryQueueNames,
        deliveryMarkerNames,
        artifacts: operatorArtifactsForContact(deliverySuccessCase.packet.contact_id)
      }))

    const deliveryTerminalCase = prepareCommittedDeliveryCase('bounded-delivery-terminal')
    const deliveryTerminalStateBefore = fs.readFileSync(deliveryTerminalCase.stateFile, 'utf8')
    const deliveryTerminalOriginal = path.join(inboxDir, 'bounded-delivery-terminal.json')
    const deliveryTerminalLock = `${deliveryTerminalOriginal}.lock`
    fs.writeFileSync(deliveryTerminalLock, JSON.stringify(deliveryTerminalCase.packet, null, 2) + '\n')
    inbox.releaseForRetry(
      deliveryTerminalLock,
      deliveryTerminalCase.packet,
      boundedDeliveryError
    )
    const deliveryTerminalRetry = JSON.parse(fs.readFileSync(deliveryTerminalOriginal, 'utf8'))
    fs.renameSync(deliveryTerminalOriginal, deliveryTerminalLock)
    const deliveryTerminal = inbox.releaseForRetry(
      deliveryTerminalLock,
      deliveryTerminalRetry,
      boundedDeliveryError
    )
    const deliveryTerminalArtifacts = operatorArtifactsForContact(deliveryTerminalCase.packet.contact_id)
    check('transient_3101_repeated_failure_terminalizes_once_without_regeneration_or_state_mutation',
      deliveryTerminal?.terminal === true &&
      deliveryTerminal?.operator_alert_created === true &&
      deliveryTerminalArtifacts.length === 1 &&
      !fs.existsSync(deliveryTerminalOriginal) &&
      !fs.existsSync(deliveryTerminalLock) &&
      fs.readFileSync(deliveryTerminalCase.stateFile, 'utf8') === deliveryTerminalStateBefore,
      JSON.stringify({ deliveryTerminal, deliveryTerminalArtifacts }))
    const deliveryTerminalArtifactText = deliveryTerminalArtifacts[0]?.text || ''
    fs.writeFileSync(deliveryTerminalLock, JSON.stringify(deliveryTerminalRetry, null, 2) + '\n')
    const deliveryRestartTerminal = inbox.releaseForRetry(
      deliveryTerminalLock,
      deliveryTerminalRetry,
      boundedDeliveryError
    )
    const deliveryRestartArtifacts = operatorArtifactsForContact(deliveryTerminalCase.packet.contact_id)
    check('transient_3101_terminal_restart_is_idempotent_exactly_one_operator_artifact',
      deliveryRestartTerminal?.terminal === true &&
      deliveryRestartTerminal?.operator_alert_created === false &&
      deliveryRestartArtifacts.length === 1 &&
      deliveryRestartArtifacts[0].text === deliveryTerminalArtifactText &&
      !fs.existsSync(deliveryTerminalOriginal) &&
      !fs.existsSync(deliveryTerminalLock),
      JSON.stringify({ deliveryRestartTerminal, deliveryRestartArtifacts }))

    const persistentTerminalPacket = {
      ...runnerSuccessPacket,
      contact_id: 'persistent-final-terminal-thread',
      thread_id: 'persistent-final-terminal-thread',
      message_id: 'persistent-final-terminal-message'
    }
    recordIngressEvent(root, persistentTerminalPacket)
    const persistentTerminalStateFile = statePath(root, persistentTerminalPacket.thread_id)
    const persistentTerminalStateBefore = fs.readFileSync(persistentTerminalStateFile, 'utf8')
    const persistentTerminalOriginal = path.join(inboxDir, 'persistent-final-terminal.json')
    const persistentTerminalLock = `${persistentTerminalOriginal}.lock`
    fs.writeFileSync(persistentTerminalLock, JSON.stringify(persistentTerminalPacket, null, 2) + '\n')
    inbox.releaseForRetry(
      persistentTerminalLock,
      persistentTerminalPacket,
      'codex_runner_invalid_json:original_persistent_failure'
    )
    const persistentTerminalRetry = JSON.parse(fs.readFileSync(persistentTerminalOriginal, 'utf8'))
    fs.renameSync(persistentTerminalOriginal, persistentTerminalLock)
    const persistentTerminal = inbox.releaseForRetry(
      persistentTerminalLock,
      persistentTerminalRetry,
      'fetch failed: mixed transient classification after persistent final pass'
    )
    check('persistent_final_recovery_failure_is_finite_across_changed_error_class',
      persistentTerminalRetry.control_final_recovery_phase === 'precommit_final_recovery' &&
      persistentTerminal?.terminal === true &&
      persistentTerminal?.operator_alert_created === true &&
      operatorArtifactsForContact(persistentTerminalPacket.contact_id).length === 1 &&
      !fs.existsSync(persistentTerminalOriginal) &&
      !fs.existsSync(persistentTerminalLock) &&
      fs.readFileSync(persistentTerminalStateFile, 'utf8') === persistentTerminalStateBefore,
      JSON.stringify({ persistentTerminalRetry, persistentTerminal }))

    // Partial multi-bubble adoption is not safe to replay as a whole packet.
    // One bubble's strict marker plus one missing bubble must become a stable
    // no-blind-resend reconciliation hold without creating the missing queue.
    const partialPacket = {
      ...runnerSuccessPacket,
      contact_id: 'partial-delivery-thread',
      thread_id: 'partial-delivery-thread',
      message_id: 'partial-delivery-message'
    }
    recordIngressEvent(root, partialPacket)
    const partialStateFile = statePath(root, partialPacket.thread_id)
    const partialState = JSON.parse(fs.readFileSync(partialStateFile, 'utf8'))
    const partialCommit = commitControlDecision(root, partialPacket, partialState, {
      authority: {
        ...deliverySuccessCase.committed.authority,
        controller: SCV_SINGLE_CONTROL_PLANE_ID,
        runner: 'scv-single-control-plane'
      },
      raw_text: 'first adopted bubble\nsecond missing bubble',
      packet: {
        bubbles: [
          { text: 'first adopted bubble', delay_ms: 0 },
          { text: 'second missing bubble', delay_ms: 0 }
        ],
        reply_text: 'first adopted bubble\nsecond missing bubble'
      }
    })
    const partialCase = {
      packet: partialPacket,
      stateFile: partialStateFile,
      committed: {
        source: SCV_SINGLE_CONTROL_SOURCE,
        authority: partialCommit.decision.authority,
        packet: partialCommit.decision.packet,
        control_receipt: partialCommit.receipt
      }
    }
    const partialStateBeforeHold = fs.readFileSync(partialStateFile, 'utf8')
    adoptCommittedBubbles(partialCase, [0])
    const partialReceiptSha = partialCommit.receipt.receipt_sha256
    const partialOriginal = path.join(inboxDir, 'partial-delivery.json')
    const partialLock = `${partialOriginal}.lock`
    fs.writeFileSync(partialLock, JSON.stringify(partialPacket, null, 2) + '\n')
    const partialHold = inbox.releaseForRetry(
      partialLock,
      partialPacket,
      '3101_post_timeout_100'
    )
    const partialArtifacts = operatorArtifactsForContact(partialPacket.contact_id)
    const partialArtifact = partialArtifacts.length
      ? JSON.parse(partialArtifacts[0].text)
      : null
    check('partial_multibubble_adoption_holds_no_blind_resend_without_creating_missing_bubble',
      partialHold?.terminal === true &&
      partialHold?.human_action_pending === true &&
      partialHold?.no_blind_resend === true &&
      partialArtifacts.length === 1 &&
      partialArtifact?.type === 'delivery_reconciliation_human_action_pending' &&
      partialArtifact?.no_blind_resend === true &&
      partialArtifact?.customer_reply_status === 'unconfirmed' &&
      partialArtifact?.manual_send_prohibited_until ===
        'outbox_marker_and_provider_receipt_reconciled' &&
      /reconcile.*marker.*provider delivery receipt.*before any manual/i.test(
        String(partialArtifact?.manual_send_instruction || '')
      ) &&
      partialArtifact?.control_receipt_sha256 === partialCommit.receipt.receipt_sha256 &&
      partialArtifact?.packet_sha256 === partialCommit.receipt.packet_sha256 &&
      JSON.stringify(partialArtifact?.adopted_indices) === JSON.stringify([0]) &&
      JSON.stringify(partialArtifact?.missing_indices) === JSON.stringify([1]) &&
      !fs.existsSync(path.join(outboxDir, `${partialReceiptSha}-1.json`)) &&
      !fs.existsSync(path.join(root, 'outbox-idempotency', `${partialReceiptSha}-1.json`)) &&
      !fs.existsSync(partialOriginal) &&
      !fs.existsSync(partialLock) &&
      fs.readFileSync(partialStateFile, 'utf8') === partialStateBeforeHold,
      JSON.stringify({ partialHold, partialArtifact }))
    const partialArtifactFile = path.join(humanAgentDir, partialArtifacts[0].name)
    const tamperedPartialArtifact = {
      ...partialArtifact,
      manual_send_instruction: 'send now'
    }
    fs.writeFileSync(
      partialArtifactFile,
      JSON.stringify(tamperedPartialArtifact, null, 2) + '\n'
    )
    fs.writeFileSync(partialLock, JSON.stringify(partialPacket, null, 2) + '\n')
    let reconciliationCollisionError = ''
    try {
      inbox.releaseForRetry(partialLock, partialPacket, '3101_post_timeout_100')
    } catch (error) {
      reconciliationCollisionError = String(error?.message || error)
    }
    check('reconciliation_hold_collision_verifier_rejects_manual_send_instruction_tamper',
      reconciliationCollisionError ===
        'inbox_delivery_reconciliation_artifact_collision' &&
      fs.existsSync(partialLock) &&
      fs.readFileSync(partialStateFile, 'utf8') === partialStateBeforeHold,
      JSON.stringify({ reconciliationCollisionError }))
    fs.unlinkSync(partialLock)

    const oldFile = path.join(inboxDir, 'old.json')
    const newFile = path.join(inboxDir, 'new.json')
    const oldInbound = {
      contact_id: 'supersede-thread',
      thread_id: 'supersede-thread',
      message_id: 'old-message',
      text: 'older inbound',
      received_at: '2026-07-13T00:00:00.000Z'
    }
    const newInbound = {
      contact_id: 'supersede-thread',
      thread_id: 'supersede-thread',
      message_id: 'new-message',
      text: 'newer inbound',
      received_at: '2026-07-13T00:01:00.000Z'
    }
    recordIngressEvent(root, oldInbound)
    recordIngressEvent(root, newInbound)
    // Exact live race: the older candidate is rewritten for retry after the
    // newer client image lands. Its mutable updated_at/mtime must not win.
    fs.writeFileSync(oldFile, JSON.stringify({
      ...oldInbound,
      retry_after: '2030-01-01T00:10:00.000Z',
      updated_at: '2030-01-01T00:09:00.000Z'
    }, null, 2) + '\n')
    fs.writeFileSync(newFile, JSON.stringify(newInbound, null, 2) + '\n')
    const futureMtime = new Date('2030-01-01T00:09:30.000Z')
    fs.utimesSync(oldFile, futureMtime, futureMtime)
    const superseded = inbox.sweepSupersededInboxFiles()
    check('retry_rewrite_cannot_supersede_authoritative_newer_inbound',
      superseded.length === 1 &&
      superseded[0].message_id === 'old-message' &&
      superseded[0].superseded_by_message_id === 'new-message' &&
      !fs.existsSync(oldFile) &&
      fs.existsSync(newFile),
      JSON.stringify(superseded))
    const supersedeAudit = fs.readFileSync(path.join(root, 'control-events', 'supersede-thread.ndjson'), 'utf8')
    check('supersede_terminal_state_is_audited',
      supersedeAudit.includes('control_inbound_superseded') &&
      supersedeAudit.includes('newer_inbound_exists_for_thread') &&
      supersedeAudit.includes('new-message'),
      supersedeAudit)

    const lostLatest = {
      contact_id: 'recovery-thread',
      thread_id: 'recovery-thread',
      message_id: 'lost-latest-message',
      text: 'sent a reference post: red snake design',
      received_at: '2026-07-13T00:02:00.000Z',
      superseded_inbox: true,
      quarantined_at: '2026-07-13T00:02:30.000Z',
      superseded_by_message_id: 'wrong-old-message',
      retry_after: '2030-01-01T00:00:00.000Z'
    }
    recordIngressEvent(root, lostLatest)
    const supersededDir = path.join(root, 'inbox_quarantine_superseded')
    fs.mkdirSync(supersededDir, { recursive: true })
    const lostLatestQuarantine = path.join(supersededDir, 'lost-latest.json')
    fs.writeFileSync(lostLatestQuarantine, JSON.stringify(lostLatest, null, 2) + '\n')
    const recovered = inbox.recoverAuthoritativeLatestSupersededInboxFiles()
    const recoveredFile = path.join(inboxDir, 'lost-latest.json')
    const recoveredPacket = JSON.parse(fs.readFileSync(recoveredFile, 'utf8'))
    check('authoritative_uncommitted_latest_is_recovered_from_superseded_quarantine',
      recovered.some((entry) => entry.message_id === 'lost-latest-message') &&
      fs.existsSync(recoveredFile) &&
      !fs.existsSync(lostLatestQuarantine) &&
      recoveredPacket.authoritative_latest_recovered_at &&
      recoveredPacket.superseded_inbox === undefined &&
      recoveredPacket.retry_after === undefined,
      JSON.stringify({ recovered, recoveredPacket }))
    const recoveryAudit = fs.readFileSync(path.join(root, 'control-events', 'recovery-thread.ndjson'), 'utf8')
    check('authoritative_latest_recovery_is_audited',
      recoveryAudit.includes('control_authoritative_latest_recovered') &&
      recoveryAudit.includes(inbox.SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION),
      recoveryAudit)

    // Exact live failure mode (2026-08-23): a recovered authoritative packet
    // returned to superseded quarantine and was recovered 2,971 times in 13s.
    // The packet may cross this recovery boundary once; a repeat must become a
    // loud preserved hold instead of an unbounded recovery loop.
    fs.unlinkSync(recoveredFile)
    const repeatedRecoveryQuarantine = path.join(supersededDir, 'lost-latest-repeat.json')
    fs.writeFileSync(repeatedRecoveryQuarantine, JSON.stringify({
      ...recoveredPacket,
      single_control_superseded: true,
      quarantined_at: '2026-07-13T00:02:45.000Z'
    }, null, 2) + '\n')
    const repeatedRecoveryAttempt = inbox.recoverAuthoritativeLatestSupersededInboxFiles()
    const repeatedRecoveryHolds = fs.readdirSync(humanAgentDir)
      .filter((name) => name.startsWith('authoritative-recovery-repeat-'))
    const repeatedRecoveryHold = repeatedRecoveryHolds.length
      ? JSON.parse(fs.readFileSync(path.join(humanAgentDir, repeatedRecoveryHolds[0]), 'utf8'))
      : null
    check('authoritative_latest_recovery_repeat_is_fused_not_requeued',
      repeatedRecoveryAttempt.some((entry) => (
        entry.action === 'human_agent_hold' &&
        entry.message_id === lostLatest.message_id &&
        entry.reason === 'authoritative_latest_recovery_repeat_blocked'
      )) &&
      !fs.existsSync(repeatedRecoveryQuarantine) &&
      !fs.existsSync(recoveredFile) &&
      repeatedRecoveryHold?.type === 'authoritative_latest_recovery_repeat_human_agent_required' &&
      repeatedRecoveryHold?.human_agent_required === true,
      JSON.stringify({ repeatedRecoveryAttempt, repeatedRecoveryHolds, repeatedRecoveryHold }))
    const repeatedRecoveryAudit = fs.readFileSync(path.join(root, 'control-events', 'recovery-thread.ndjson'), 'utf8')
    check('authoritative_latest_recovery_repeat_fuse_is_audited_once',
      (repeatedRecoveryAudit.match(/"type":"control_authoritative_latest_recovered"/g) || []).length === 1 &&
      (repeatedRecoveryAudit.match(/"type":"control_authoritative_latest_recovery_repeat_blocked"/g) || []).length === 1,
      repeatedRecoveryAudit)

    const committedLatest = {
      contact_id: 'committed-thread',
      thread_id: 'committed-thread',
      message_id: 'already-committed-message',
      text: 'already answered inbound',
      received_at: '2026-07-13T00:03:00.000Z',
      superseded_inbox: true
    }
    recordIngressEvent(root, committedLatest)
    const committedStateFile = statePath(root, 'committed-thread')
    const committedState = JSON.parse(fs.readFileSync(committedStateFile, 'utf8'))
    committedState.last_control_message_id = committedLatest.message_id
    fs.writeFileSync(committedStateFile, JSON.stringify(committedState, null, 2) + '\n')
    const committedQuarantine = path.join(supersededDir, 'already-committed.json')
    fs.writeFileSync(committedQuarantine, JSON.stringify(committedLatest, null, 2) + '\n')
    const committedRecoveryAttempt = inbox.recoverAuthoritativeLatestSupersededInboxFiles()
    check('already_committed_latest_is_not_recovered_or_duplicated',
      fs.existsSync(committedQuarantine) &&
      !committedRecoveryAttempt.some((entry) => entry.message_id === committedLatest.message_id) &&
      !fs.existsSync(path.join(inboxDir, 'already-committed.json')),
      JSON.stringify(committedRecoveryAttempt))

    check('immutable_ingress_clock_ignores_retry_updated_at',
      inbox.immutableIngressTimeMs({
        received_at: '2026-07-13T00:00:00.000Z',
        updated_at: '2030-01-01T00:00:00.000Z'
      }, oldFile) === Date.parse('2026-07-13T00:00:00.000Z'))

    const inboxSource = fs.readFileSync(path.join(__dirname, 'inbox-worker.js'), 'utf8')
    check('runtime_disposition_is_independent_of_retry_count',
      inboxSource.includes('const disposition = classifyInboxFailureDisposition(err.message)') &&
      !inboxSource.includes('attempts > MAX_RETRIES &&'),
      'inbox-worker.js')

    if (failures.length) {
      const err = new Error(`scv_closed_lifecycle_harness_failed:${JSON.stringify(failures)}`)
      err.failures = failures
      throw err
    }

    return {
      ok: true,
      locked: true,
      lock_version: SCV_CLOSED_LIFECYCLE_HARNESS_VERSION,
      lifecycle_contract_version: inbox.SCV_CLOSED_LIFECYCLE_CONTRACT_VERSION,
      failure_classes: retryableFailures.length + 2,
      checked
    }
  } finally {
    if (previousRoot === undefined) delete process.env.SCV_ROOT
    else process.env.SCV_ROOT = previousRoot
    if (previousPauseAll === undefined) delete process.env.SCV_PAUSE_ALL
    else process.env.SCV_PAUSE_ALL = previousPauseAll
    if (previousPauseNonTest === undefined) delete process.env.SCV_PAUSE_NON_TEST
    else process.env.SCV_PAUSE_NON_TEST = previousPauseNonTest
    if (previousHold === undefined) delete process.env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE
    else process.env.SCV_HOLD_STALE_BACKLOG_ON_UNPAUSE = previousHold
    if (previousInboxHarness === undefined) delete process.env.SCV_INBOX_TEST_HARNESS
    else process.env.SCV_INBOX_TEST_HARNESS = previousInboxHarness
    fs.rmSync(root, { recursive: true, force: true })
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvClosedLifecycleHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      error: String(err?.message || err),
      failures: err?.failures || []
    }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  SCV_CLOSED_LIFECYCLE_HARNESS_VERSION,
  runScvClosedLifecycleHarness
}
