#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const contract = require('./scv-contract-harness.js')
const closed = require('./scv-closed-transition-contract.js')
const control = require('./scv-single-control-plane.js')
const runner = require('./codex-dm-runner.js')

const SCV_CONTEXT_GROUNDING_HARNESS_VERSION =
  'scv-context-grounding-harness-2026-09-08-v1-evidence-bound-model-and-biography-routing'

function runScvContextGroundingHarness() {
  const failures = []
  let checked = 0
  const check = (name, fn) => {
    checked += 1
    try { fn() } catch (error) {
      failures.push({ name, error: String(error && error.message ? error.message : error) })
    }
  }
  const input = (message, history = [], state = {}) => ({
    message,
    live_message: message,
    recent_history: history,
    structured_state: { booking_stage_hint: 'open_conversation', live_turn_text: message, ...state }
  })
  const packet = (...texts) => ({ bubbles: texts.map(text => ({ text, delay_ms: 0 })) })
  const liveText = value => String(
    value?.live_message || value?.message || value?.text || value?.bubble?.text ||
    value?.last_input_text || value?.structured_state?.live_turn_text || ''
  ).trim()
  const visible = draft => (draft?.bubbles || []).map(bubble => String(bubble?.text || '')).join(' ')
  const valid = (name, live, draft) => check(name, () => {
    const verdict = contract.evaluateScvContractHarness(live, draft)
    assert.equal(verdict.valid, true, JSON.stringify(verdict))
  })
  const invalid = (name, live, draft) => check(name, () => {
    const verdict = contract.evaluateScvContractHarness(live, draft)
    assert.equal(verdict.valid, false, JSON.stringify(verdict))
    assert.ok(String(verdict.reason || '').trim())
  })

  const exact = 'Oh yeah, I saw your ad. What do you mean by motto?'
  const interpreted = 'Oh yeah, I saw your ad. What do you mean by model?'
  const history = [
    { role: 'user', text: 'I saw your ad and wanted to hear about the model offer' },
    { role: 'assistant', text: 'i have a few model spots for tattoos in my own style' }
  ]
  const explanation = packet(
    'a model spot is a tattoo built around what you want while the finished piece stays in my style',
    'if you have an idea send it over and we can shape it together'
  )

  check('exact_incident_uses_ad_evidence_to_interpret_model', () => {
    const original = input(exact)
    const before = JSON.stringify(original)
    const repaired = runner.repairIncomingDomainTermsForInterpretation(original)
    assert.equal(liveText(repaired), interpreted)
    assert.equal(JSON.stringify(original), before)
    assert.equal(contract.liveModelOfferMeaningQuestion(repaired), true)
    assert.equal(contract.liveInfoAskOpener(repaired), true)
    assert.equal(contract.hasTattooIntentSignal(repaired), true)
    assert.equal(contract.liveIsPlainSocial(repaired), false)
  })

  for (const [label, shaped] of [
    ['message', { message: exact }],
    ['live_message', { live_message: exact }],
    ['text', { text: exact }],
    ['bubble_text', { bubble: { text: exact, marker: 'preserve' } }],
    ['last_input_text', { last_input_text: exact }],
    ['state_live_text', { structured_state: { live_turn_text: exact } }],
    ['duplicate_message_text', { message: exact, text: exact }],
    ['authoritative_live_turn', { message: `earlier backlog\n${exact}`, live_message: exact }]
  ]) check(`input_shape_${label}`, () => {
    const before = JSON.stringify(shaped)
    const repaired = runner.repairIncomingDomainTermsForInterpretation(shaped)
    assert.equal(liveText(repaired), interpreted)
    assert.equal(JSON.stringify(shaped), before)
    if (!Object.prototype.hasOwnProperty.call(shaped, 'live_message') && label !== 'state_live_text') {
      assert.equal(Object.prototype.hasOwnProperty.call(repaired, 'live_message'), false)
    }
  })

  for (const [heard, expected] of [
    ['What do you mean by moto?', 'What do you mean by model?'],
    ['How do moto spots work?', 'How do model spots work?'],
    ['the motto spots are interesting', 'the model spots are interesting'],
    ['motto spots', 'model spots'],
    ['What do you mean by “motto”?', 'What do you mean by “model”?']
  ]) check(`offer_history_repairs_only_domain_term_${heard}`, () => {
    assert.equal(runner.repairAsrDomainTerms(heard, input(heard, history)), expected)
  })

  check('voice_wrapper_keeps_transport_and_repairs_grounded_term', () => {
    const heard = 'sent a voice note saying: Oh yeah, I saw your ad. What do you mean by motto?'
    const repaired = runner.repairIncomingDomainTermsForInterpretation(input(heard))
    assert.equal(liveText(repaired), heard.replace('motto', 'model'))
    assert.equal(contract.liveModelOfferMeaningQuestion(repaired), true)
  })

  for (const literal of [
    'What is your motto?',
    'What does your motto mean?',
    'What do you mean by motto?',
    'My motto is keep going',
    "I didn't see your ad. What do you mean by motto?",
    'My friend said "I saw your ad". What is your motto?',
    'How did you get started? My motto is keep going'
  ]) check(`literal_or_ungrounded_motto_stays_literal_${literal}`, () => {
    const repaired = runner.repairIncomingDomainTermsForInterpretation(input(literal))
    assert.equal(liveText(repaired), literal)
  })

  check('literal_slogan_history_keeps_motto_literal', () => {
    const literal = 'What do you mean by motto?'
    const repaired = runner.repairIncomingDomainTermsForInterpretation(input(literal, [
      { role: 'user', text: 'Do you have a personal slogan you live by?' },
      { role: 'assistant', text: 'my motto is keep going' }
    ]))
    assert.equal(liveText(repaired), literal)
  })
  check('separate_literal_motto_clause_survives_offer_history', () => {
    const literal = 'How did you get started? My motto is keep going'
    const repaired = runner.repairIncomingDomainTermsForInterpretation(input(literal, history))
    assert.equal(liveText(repaired), literal)
  })

  const grounded = runner.repairIncomingDomainTermsForInterpretation(input(exact))
  valid('direct_model_offer_explanation_is_valid', grounded, explanation)
  for (const [label, draft] of [
    ['screenshot', packet('can you send a screenshot of the ad?')],
    ['clarification', packet('do you mean model spots?')],
    ['dictionary', packet('a motto is a short phrase expressing a belief')],
    ['forced_choice', packet('do you mean your personal slogan or the model offer?')],
    ['explanation_plus_screenshot', packet(explanation.bubbles[0].text, 'send a screenshot of the ad')],
    ['unsolicited_price', packet(explanation.bubbles[0].text, 'the model rate is 150 an hour')]
  ]) invalid(`grounded_question_rejects_${label}`, grounded, draft)

  check('stale_missing_context_flags_cannot_steal_grounded_question', () => {
    const repaired = runner.repairIncomingDomainTermsForInterpretation(input(exact, [], {
      live_turn_context_missing: true,
      live_turn_context_missing_attachment: true,
      live_turn_context_needs_clarification: true,
      live_turn_reference_pointer_without_media: true
    }))
    for (const field of [
      'live_turn_context_missing', 'live_turn_context_missing_attachment',
      'live_turn_context_needs_clarification', 'live_turn_reference_pointer_without_media'
    ]) assert.equal(repaired.structured_state[field], false, field)
    runner.reconcileControllerPlanAfterAuthorityEvidence(repaired)
    assert.notEqual(repaired.control_transition_contract?.action, 'resolve_context')
    const direct = runner.buildPreIntentGenericInfoPacket(repaired)
    assert.ok(direct?.packet?.bubbles?.length)
    assert.match(visible(direct.packet), /model spot/i)
    assert.doesNotMatch(visible(direct.packet), /\b150\b|screenshot|what do you mean/i)
  })

  check('duplicate_raw_history_does_not_block_direct_answer', () => {
    const repaired = runner.repairIncomingDomainTermsForInterpretation(input(exact, [{ role: 'user', text: exact }]))
    runner.reconcileControllerPlanAfterAuthorityEvidence(repaired)
    const direct = runner.buildPreIntentGenericInfoPacket(repaired)
    assert.ok(direct?.packet?.bubbles?.length)
    assert.match(visible(direct.packet), /model spot/i)
  })

  const biographyQuestions = [
    'Why did you start tattooing in the first place?',
    'How long have you been doing tattoos?',
    'When did you start your tattoo career?'
  ]
  for (const question of biographyQuestions) {
    check(`biography_remains_social_${question}`, () => {
      const live = input(question)
      const plan = closed.deriveClosedTransitionPlan(live)
      assert.equal(contract.liveArtistBiographyQuestion(live), true)
      assert.equal(contract.hasTattooIntentSignal(live), false)
      assert.equal(plan.action, 'social_continue')
      assert.equal(plan.reason, 'artist_biography_question_owns_social_turn')
    })
    valid(
      `biography_answer_needs_no_sales_cta_${question}`,
      input(question),
      packet('i started from drawing all the time and tattooing grew naturally out of that')
    )
    invalid(`biography_rejects_bare_ack_${question}`, input(question), packet('yeah'))
    for (const solicitation of [
      'you into tattoos too?', 'what tattoos are you into?', 'what designs do you have in mind?'
    ]) invalid(
      `biography_rejects_intake_${question}_${solicitation}`,
      input(question),
      packet('i started from drawing all the time', solicitation)
    )
  }

  for (const answer of [
    'i loved drawing and saw tattooing as another art form',
    'i started tattooing because i wanted to tell stories through tattoo designs',
    'i love to share ideas through tattoos'
  ]) check(`biography_vocabulary_is_not_solicitation_${answer}`, () => {
    assert.equal(contract.packetSolicitsClientTattoo(packet(answer)), false)
    const live = input(biographyQuestions[0])
    const plan = closed.deriveClosedTransitionPlan(live)
    assert.equal(closed.evaluateClosedTransitionContract(live, packet(answer), plan).valid, true)
  })

  check('classifier_cannot_promote_biography_to_client_intent', () => {
    const live = input(biographyQuestions[0])
    runner.mergeIntentFlags(live, {
      is_tattoo_intent: true, is_question: true,
      context_relation: 'coherent', context_confidence: 'high'
    })
    assert.notEqual(live.structured_state.tattoo_intent_active, true)
    assert.notEqual(live.structured_state.live_turn_is_tattoo_intent, true)
    assert.equal(contract.hasTattooIntentSignal(live), false)
  })

  check('state_reducer_drops_new_biography_classifier_bits', () => {
    const noisy = { tattoo_intent_active: true, live_turn_is_tattoo_intent: true, live_turn_gave_design_idea: true }
    const reduced = control.reduceConversationState({
      persisted: {}, candidate: noisy, intentEvidence: noisy,
      event: {
        thread_id: 'synthetic-biography', contact_id: 'synthetic-biography',
        message_id: 'synthetic-biography-1', text: biographyQuestions[0],
        received_at: '2026-09-08T00:00:00Z'
      }
    })
    assert.equal(Boolean(reduced.tattoo_intent_active), false)
    assert.equal(Boolean(reduced.live_turn_is_tattoo_intent), false)
    assert.equal(Boolean(reduced.live_turn_gave_design_idea), false)
    assert.equal(reduced.booking_stage_hint, 'open_conversation')
  })

  for (const text of [
    'Why did you start tattooing? I want a snake tattoo.',
    'How did you get into tattooing? Could you also tattoo a snake for me?'
  ]) check(`compound_real_client_request_keeps_intent_${text}`, () => {
    const live = input(text)
    assert.equal(contract.liveArtistBiographyQuestion(live), false)
    assert.equal(contract.hasTattooIntentSignal(live), true)
    assert.notEqual(closed.deriveClosedTransitionPlan(live).reason, 'artist_biography_question_owns_social_turn')
  })

  check('assistant_prompt_alone_does_not_create_client_intent', () => {
    assert.equal(contract.hasTattooIntentSignal(input(
      'Just wanted to say hi', [{ role: 'assistant', text: 'are you into tattoos?' }]
    )), false)
  })
  check('biography_history_does_not_poison_next_social_turn', () => {
    const live = input('How was your weekend?', [
      { role: 'user', text: biographyQuestions[0] },
      { role: 'assistant', text: 'i started from drawing all the time' }
    ])
    assert.equal(contract.hasTattooIntentSignal(live), false)
    assert.equal(contract.liveIsPlainSocial(live), true)
  })
  check('genuine_tattoo_request_still_establishes_intent', () => {
    assert.equal(contract.hasTattooIntentSignal(input('I want a snake tattoo')), true)
  })

  check('model_question_is_not_form_consent', () => {
    assert.equal(contract.shouldSendFormNow(grounded), false)
    assert.equal(contract.liveExplicitFormLinkRequest(grounded), false)
    assert.equal(runner.formLinkAuthorizedThisTurn(grounded), false)
  })
  invalid(
    'design_alone_cannot_receive_form_url',
    input('I want a snake tattoo', [], { tattoo_intent_active: true, known_design_context: 'a snake tattoo' }),
    packet('here is the form https://www.effacermonexistence.com/apply')
  )
  valid(
    'design_alone_can_receive_form_permission_offer',
    input('I want a snake tattoo', [], { tattoo_intent_active: true, known_design_context: 'a snake tattoo' }),
    packet('a snake would work beautifully in my style', 'want me to send the application form?')
  )
  check('explicit_form_consent_after_offer_is_preserved', () => {
    const live = input('yes please send it', [
      { role: 'user', text: 'I want a snake tattoo' },
      { role: 'assistant', text: 'want me to send the application form?' }
    ], { tattoo_intent_active: true, known_design_context: 'a snake tattoo', form_offer_asked: true })
    assert.equal(contract.shouldSendFormNow(live), true)
    assert.equal(runner.formLinkAuthorizedThisTurn(live), true)
  })

  return {
    ok: failures.length === 0,
    checked,
    failures,
    version: SCV_CONTEXT_GROUNDING_HARNESS_VERSION,
    remote_calls: 0
  }
}

if (require.main === module) {
  const result = runScvContextGroundingHarness()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exitCode = 1
}

module.exports = { SCV_CONTEXT_GROUNDING_HARNESS_VERSION, runScvContextGroundingHarness }
