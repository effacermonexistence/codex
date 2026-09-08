#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const orphan = require(path.join(__dirname, 'scv-manychat-orphan-recovery.js'))
const outbox = require(path.join(__dirname, 'outbox-worker.js'))
const authority = require(path.join(__dirname, 'dm-authority.js'))
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const contract = require(path.join(__dirname, 'scv-contract-harness.js'))
const durable = require(path.join(__dirname, 'scv-durable-structured-state.js'))

function runKandoRegressionHarness() {
  const failures = []
  const check = (name, condition, detail = '') => {
    if (!condition) failures.push({ name, detail })
  }

  // KANDO root cause #1: a real webhook turn was already processed into the
  // delayed outbox, but the 10-minute ManyChat sweep saw no delivered assistant
  // history yet and re-ingested the exact same text as an operator recovery.
  // Successful inbox -> 3101 adoption needs its own durable receipt.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-kando-'))
  const original = {
    contact_id: '1737076034',
    thread_id: '1737076034',
    message_id: 'real-webhook-1',
    instagram_username: 'kando_intenchanel_boatman',
    text: 'I have two partial sleeves that I want to finish',
    received_at: '2026-07-10T17:46:00.634Z'
  }
  const recovered = orphan.buildRecoveryPacket({
    id: '1737076034',
    ig_username: 'kando_intenchanel_boatman',
    last_input_text: original.text,
    ig_last_interaction: '2026-07-10T10:45:59-07:00'
  }, { now: '2026-07-10T17:56:00.000Z' })

  check(
    'processing_receipt_writer_exported',
    typeof orphan.recordInboundProcessingReceipt === 'function',
    typeof orphan.recordInboundProcessingReceipt
  )
  if (typeof orphan.recordInboundProcessingReceipt === 'function') {
    const inboxDir = path.join(tmp, 'inbox')
    fs.mkdirSync(inboxDir, { recursive: true })
    const activeOriginal = path.join(inboxDir, 'real-webhook-1.json.lock')
    fs.writeFileSync(activeOriginal, JSON.stringify(original))
    check(
      'inflight_real_webhook_not_recovered_as_orphan',
      orphan.hasProcessedLatestInput(tmp, recovered) === true,
      'the original message can have a different message id while it is actively processing'
    )
    fs.unlinkSync(activeOriginal)
    check(
      'unadopted_missing_turn_remains_recoverable',
      orphan.hasProcessedLatestInput(tmp, recovered) === false,
      'without an active pipeline packet or adoption receipt the sweep must recover it'
    )

    orphan.recordInboundProcessingReceipt(tmp, original, {
      adopted_at: '2026-07-10T17:46:03.000Z',
      adoption: 'outbound_3101_accepted'
    })
    check(
      'processed_delayed_turn_not_recovered_as_orphan',
      orphan.hasProcessedLatestInput(tmp, recovered) === true,
      'a queued-but-not-delivered turn must still count as processed'
    )

    const laterSameWords = orphan.buildRecoveryPacket({
      id: '1737076034',
      ig_username: 'kando_intenchanel_boatman',
      last_input_text: original.text,
    ig_last_interaction: '2026-07-10T10:46:11-07:00'
    }, { now: '2026-07-10T17:56:11.000Z' })
    check(
      'later_repeated_words_are_not_false_deduped',
      orphan.hasProcessedLatestInput(tmp, laterSameWords) === false,
      'text match alone cannot suppress a genuinely later inbound'
    )
  }

  // KANDO root cause #2: the latest form-offer bubble was suppressed because an
  // older packet with identical text was still in outbox even though that older
  // packet was already stale against the newest inbound.
  check(
    'pending_duplicate_helper_exported',
    typeof outbox.pendingOutboundDuplicate === 'function',
    typeof outbox.pendingOutboundDuplicate
  )
  if (typeof outbox.pendingOutboundDuplicate === 'function') {
    const outboxDir = path.join(tmp, 'outbox')
    fs.mkdirSync(outboxDir, { recursive: true })
    const oldFile = path.join(outboxDir, 'old-form-offer.json')
    fs.writeFileSync(oldFile, JSON.stringify({
      thread_id: '1737076034',
      message_id: 'old-real-message',
      bubble: { text: 'want me to send the form so we can start locking it in?' }
    }))
    const latest = {
      thread_id: '1737076034',
      message_id: 'new-recovery-message',
      bubble: { text: 'want me to send the form so we can start locking it in?' }
    }
    check(
      'stale_pending_packet_cannot_starve_latest_form_offer',
      outbox.pendingOutboundDuplicate(latest, path.join(outboxDir, 'current.json'), {
        outboxDir,
        latestState: { message_id: 'new-recovery-message' }
      }) === false,
      'the matching pending packet belongs to an older, doomed message id'
    )

    fs.writeFileSync(path.join(outboxDir, 'same-message-form-offer.json'), JSON.stringify({
      thread_id: '1737076034',
      message_id: 'new-recovery-message',
      bubble: { text: 'want me to send the form so we can start locking it in?' }
    }))
    check(
      'same_live_message_duplicate_is_still_blocked',
      outbox.pendingOutboundDuplicate(latest, path.join(outboxDir, 'current.json'), {
        outboxDir,
        latestState: { message_id: 'new-recovery-message' }
      }) === true,
      'real duplicate protection must remain intact'
    )
  }

  // KANDO root cause #3: a business/process question containing "doing free
  // tattoo work" overwrote the actual design direction because "doing ... tattoo"
  // was classified as a tattoo subject.
  const design = 'I want a hand crown tattoo touched up and the logo worked into my arm'
  const structured = authority.buildStructuredState({
    contact_id: 'kando-regression-no-durable-file',
    thread_id: 'kando-regression-no-durable-file',
    received_at: '2026-07-10T18:12:00.000Z'
  }, [
    { role: 'user', text: design, at: '2026-07-10T18:10:00.000Z' },
    { role: 'user', text: 'No I mean why are you doing free tattoo work?', at: '2026-07-10T18:11:00.000Z' }
  ])
  check(
    'business_question_does_not_overwrite_design_context',
    structured.known_design_context === design,
    structured.known_design_context
  )

  // KANDO root cause #5: the semantic model understood "two partial sleeves"
  // as tattoo work, but the authoritative state extractor did not. No durable
  // tattoo-domain latch survived into "Would you want to meet and discuss".
  const sleeveState = authority.buildStructuredState({
    contact_id: 'kando-sleeve-intent-no-durable-file',
    thread_id: 'kando-sleeve-intent-no-durable-file',
    received_at: '2026-07-10T17:50:25.035Z'
  }, [
    { role: 'user', text: 'I have two partial sleeves I want to finish them off', at: '2026-07-10T17:50:25.035Z' }
  ])
  check(
    'partial_sleeves_lock_tattoo_domain',
    sleeveState.tattoo_intent_active === true,
    JSON.stringify(sleeveState)
  )
  check(
    'partial_sleeves_persist_design_direction',
    sleeveState.known_design_context === 'I have two partial sleeves I want to finish them off',
    sleeveState.known_design_context
  )
  check(
    'partial_sleeves_enter_design_intake',
    sleeveState.booking_stage_hint === 'design_intake',
    sleeveState.booking_stage_hint
  )

  const intentInput = {
    message: 'I have two partial sleeves I want to finish them off',
    structured_state: { booking_stage_hint: 'open_conversation' }
  }
  runner.mergeIntentFlags(intentInput, {
    is_tattoo_intent: true,
    gave_design_idea: true,
    form_consent: false,
    explicit_form_request: false,
    accepts_offered_slot: false,
    form_submitted: false,
    deposit_sent: false,
    asks_price: false,
    is_question: false,
    declines: false
  })
  const runnerIntentState = runner.buildIntentAdoptionState(intentInput)
  check(
    'runner_exposes_llm_tattoo_intent_for_parent_adoption',
    runnerIntentState.llm_intent_applied === true &&
      runnerIntentState.tattoo_intent_active === true &&
      runnerIntentState.live_turn_is_tattoo_intent === true &&
      runnerIntentState.live_turn_gave_design_idea === true,
    JSON.stringify(runnerIntentState)
  )

  const parentAdopted = authority.adoptRunnerIntentState({
    booking_stage_hint: 'open_conversation',
    known_design_context: ''
  }, runnerIntentState, 'I have two partial sleeves I want to finish them off')
  check(
    'parent_adopts_child_llm_intent_instead_of_overwriting_it',
    parentAdopted.tattoo_intent_active === true &&
      parentAdopted.booking_stage_hint === 'design_intake' &&
      parentAdopted.known_design_context === 'I have two partial sleeves I want to finish them off',
    JSON.stringify(parentAdopted)
  )

  const complimentState = authority.adoptRunnerIntentState({
    tattoo_intent_active: true,
    booking_stage_hint: 'design_intake',
    known_design_context: ''
  }, {
    llm_intent_applied: true,
    tattoo_intent_active: true,
    live_turn_is_tattoo_intent: true,
    live_turn_gave_design_idea: true
  }, 'sent a voice note saying: I love your style.')
  check(
    'parent_quarantines_style_compliment_from_design_memory',
    complimentState.live_turn_gave_design_idea !== true && complimentState.known_design_context === '',
    JSON.stringify(complimentState)
  )

  const durableState = durable.extractDurableStructuredState(parentAdopted)
  check(
    'tattoo_domain_latch_is_durable_true_state',
    durableState.tattoo_intent_active === true,
    JSON.stringify(durableState)
  )

  // Simulate a fresh process against only the persisted thread-state file. This
  // proves restart adoption rather than same-process memory.
  const restartRoot = path.join(tmp, 'restart-root')
  fs.mkdirSync(path.join(restartRoot, 'thread-state'), { recursive: true })
  fs.mkdirSync(path.join(restartRoot, 'thread-history'), { recursive: true })
  fs.writeFileSync(path.join(restartRoot, 'thread-state', 'restart-thread.json'), JSON.stringify({
    thread_id: 'restart-thread',
    contact_id: 'restart-thread',
    tattoo_intent_active: true
  }))
  const restartScript = [
    `const a=require(${JSON.stringify(path.join(__dirname, 'dm-authority.js'))})`,
    `const s=a.buildStructuredState({thread_id:'restart-thread',contact_id:'restart-thread',received_at:'2026-07-10T18:04:01.929Z'},[])`,
    `process.stdout.write(JSON.stringify({tattoo_intent_active:s.tattoo_intent_active,booking_stage_hint:s.booking_stage_hint}))`
  ].join(';')
  const restartProbe = spawnSync(process.execPath, ['-e', restartScript], {
    encoding: 'utf8',
    env: { ...process.env, SCV_ROOT: restartRoot }
  })
  let restartState = null
  try { restartState = JSON.parse(String(restartProbe.stdout || '')) } catch {}
  check(
    'fresh_process_restores_tattoo_domain_latch',
    restartProbe.status === 0 && restartState?.tattoo_intent_active === true && restartState?.booking_stage_hint === 'design_intake',
    JSON.stringify({ status: restartProbe.status, stdout: restartProbe.stdout, stderr: restartProbe.stderr })
  )

  const meetingInput = {
    contact_id: '1737076034',
    thread_id: '1737076034',
    message: 'Would you want to meet and discuss',
    recent_history: [
      { role: 'user', text: 'I have two partial sleeves I want to finish them off' },
      { role: 'assistant', text: 'send me any refs or describe what you want finished' }
    ],
    structured_state: {
      tattoo_intent_active: true,
      known_design_context: 'I have two partial sleeves I want to finish them off',
      booking_stage_hint: 'design_intake',
      live_turn_text: 'Would you want to meet and discuss'
    }
  }
  const badMeetingVerdict = contract.evaluateScvContractHarness(meetingInput, {
    bubbles: [{ text: 'yeah for sure we can meet up and chat about it' }]
  })
  check(
    'prebooking_meet_up_commitment_is_rejected',
    badMeetingVerdict.valid === false && badMeetingVerdict.reason === 'prebooking_in_person_consultation_forbidden',
    JSON.stringify(badMeetingVerdict)
  )

  const dmRedirectVerdict = contract.evaluateScvContractHarness(meetingInput, {
    bubbles: [{ text: 'we can go over all of it right here in the dm just send me the ideas or refs you have' }]
  })
  check(
    'tattoo_meeting_request_stays_in_dm',
    dmRedirectVerdict.valid === true,
    JSON.stringify(dmRedirectVerdict)
  )

  const meetingRouteLock = runner.buildAiVisibleRouteLock(meetingInput)
  check(
    'meeting_request_gets_explicit_dm_only_route_lock',
    /active tattoo inquiry asks to meet and discuss/i.test(meetingRouteLock) && /do not agree to meet up/i.test(meetingRouteLock),
    meetingRouteLock
  )

  // KANDO root cause #4: semantic verification accepted an ack + banned size
  // question. The deterministic lock then removed the only next move, and no
  // verifier ran after that mutation. The post-filter packet must be rejected and
  // re-authored rather than shipped as a flat acknowledgement.
  const nextStepInput = {
    contact_id: '1737076034',
    thread_id: '1737076034',
    message_id: 'kando-next-step',
    message: 'Ok what are next steps?',
    recent_history: [
      { role: 'user', text: design },
      { role: 'assistant', text: 'yeah i get the direction with finishing the sleeves and working the hand piece in' }
    ],
    structured_state: {
      live_turn_text: 'Ok what are next steps?',
      known_design_context: design,
      form_offer_asked: false,
      form_link_sent: false,
      form_submitted: false,
      booking_stage_hint: 'design_intake'
    }
  }
  const preFilterPacket = {
    bubbles: [
      { text: 'okkk i’m with you so far on finishing those sleeves up' },
      { text: 'what rough size were you thinking for the hand piece?' }
    ]
  }
  const postFilterPacket = runner.enforceSizePlacementLock(
    nextStepInput,
    JSON.parse(JSON.stringify(preFilterPacket))
  )
  const postFilterVerdict = contract.evaluateScvContractHarness(nextStepInput, postFilterPacket)
  check(
    'post_filter_flat_ack_is_rejected_for_form_ready_next_steps',
    postFilterVerdict.valid === false && postFilterVerdict.reason === 'design_ready_next_steps_requires_form_offer',
    JSON.stringify({ packet: postFilterPacket, verdict: postFilterVerdict })
  )
  check(
    'post_filter_adoption_verifier_exported',
    typeof runner.verifyPostFilterAdoption === 'function',
    typeof runner.verifyPostFilterAdoption
  )
  if (typeof runner.verifyPostFilterAdoption === 'function') {
    const verdict = runner.verifyPostFilterAdoption(nextStepInput, postFilterPacket)
    check(
      'post_filter_adoption_verifier_rejects_dead_end',
      verdict.valid === false &&
        verdict.reason === 'non_authoring_guard_requires_model_reauthor' &&
        postFilterPacket.non_authoring_surface_mutations?.includes('size_or_placement_question_violation'),
      JSON.stringify(verdict)
    )
  }

  if (failures.length) {
    const err = new Error(`scv_kando_regression_harness_failed:${JSON.stringify(failures)}`)
    err.failures = failures
    throw err
  }

  return {
    ok: true,
    locked: true,
    checked: 23,
    regression: 'kando_intenchanel_boatman_state_authority_meeting_gate_2026-07-10'
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runKandoRegressionHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      error: String(err && err.message ? err.message : err),
      failures: err.failures || []
    }, null, 2))
    process.exit(1)
  }
}

module.exports = { runKandoRegressionHarness }
