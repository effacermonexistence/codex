#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  SCV_DISCOURSE_CONTINUITY_VERSION,
  DISCOURSE_RELATIONS,
  structuralDiscourseRelation,
  eventHasAuthoritativeVisualReference,
  lightweightReferenceBridge,
  bridgeSignalsDeliveredReference,
  transportShadowReferenceFulfillmentChain,
  requestedReferenceFulfillmentChain,
  recentHistoryHasAuthoritativeReference,
  normalizeDiscourseClassification,
  applyDiscourseClassification,
  antecedentTextCarriesReferentAuthority,
  sameTurnIntroducesReferentBeforePointer,
  explicitConcreteReferentNomination,
  contextualVisualAsrReferentNomination,
  openSpatialDirectionalDeicticDependency,
  buildDiscourseClassifierHistory
} = require(path.join(__dirname, 'scv-discourse-continuity.js'))
const {
  evaluateScvContractHarness,
  liveHasConcreteDesignDirection
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  ACTIONS,
  deriveClosedTransitionPlan,
  evaluateClosedTransitionContract
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const {
  mergeIntentFlags,
  buildIntentAdoptionState,
  buildIntentClassifierPrompt
} = require(path.join(__dirname, 'codex-dm-runner.js'))
const {
  annotateStructuredStateForLiveTurn,
  applyMediaContextToState
} = require(path.join(__dirname, 'dm-authority.js'))
const {
  appendControlHistoryEvent
} = require(path.join(__dirname, 'scv-single-control-plane.js'))

const SCV_DISCOURSE_CONTINUITY_HARNESS_VERSION =
  'scv-discourse-continuity-harness-2026-08-25-v27-rejected-date-continuation-authority'

function runScvDiscourseContinuityHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  const noContext = []
  const imageHistory = [{
    role: 'user',
    message_id: 'img-1',
    text: 'sent a reference post: black and grey snake wrapping around an arm',
    text_source: 'single_control_media_context_enriched'
  }]
  const choiceHistory = [{
    role: 'assistant',
    text: 'were you leaning toward the first option or the second one?'
  }]

  check('version_exact',
    SCV_DISCOURSE_CONTINUITY_VERSION === 'scv-discourse-continuity-2026-08-25-v22-rejected-date-continuation-authority',
    SCV_DISCOURSE_CONTINUITY_VERSION)
  check('exact_live_pointer_is_missing_attachment',
    structuralDiscourseRelation("I'm thinking of this one", {}, noContext) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  check('something_like_this_voice_pointer_is_missing_attachment',
    structuralDiscourseRelation("sent a voice note saying: I'm thinking of something like this.", { live_turn_is_voice_note: true }, noContext) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  for (const [name, text] of [
    ['want_something_like_this', 'I want something like this'],
    ['can_we_do_something_like_this', 'Can we do something like this?'],
    ['maybe_one_like_that', 'Maybe one like that'],
    ['thinking_of_this', 'I was thinking of this']
  ]) {
    check(`deictic_design_variant_${name}_requires_attachment`,
      structuralDiscourseRelation(text, {}, noContext) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT,
      text)
  }
  for (const [name, text] of [
    [
      'exact_live_copular_portrait_brief',
      "It's a black and gray portrait of a woman with a soft surreal look, about 6 inches on my upper arm. I want fine detail without making it too dark."
    ],
    [
      'expanded_copular_unknown_subject',
      'It is a mechanical jackalope on my forearm. I want it detailed but still readable.'
    ],
    [
      'that_is_concrete_design_definition',
      "That's a red peony wrapping around my shoulder. Keep it around medium size."
    ]
  ]) {
    check(`copular_referent_${name}_is_coherent`,
      sameTurnIntroducesReferentBeforePointer(text) === true &&
        structuralDiscourseRelation(text, {}, noContext) === DISCOURSE_RELATIONS.COHERENT &&
        liveHasConcreteDesignDirection({ message: text, structured_state: {} }) === true,
      `${text}:${sameTurnIntroducesReferentBeforePointer(text)}:${structuralDiscourseRelation(text, {}, noContext)}:${liveHasConcreteDesignDirection({ message: text, structured_state: {} })}`)
  }
  for (const [name, text] of [
    ['copular_unseen_pointer', "It's a tattoo like this. I want it detailed."],
    ['copular_generic_placeholder', "It's the vibe. I want it softer."],
    ['copular_transaction_object', "It's the form. I want it now."]
  ]) {
    check(`copular_referent_negative_${name}_has_no_local_authority`,
      sameTurnIntroducesReferentBeforePointer(text) === false,
      `${text}:${sameTurnIntroducesReferentBeforePointer(text)}`)
  }
  for (const [name, text] of [
    [
      'exact_live_portrait_brief',
      'I want a black and gray portrait of a woman with a soft surreal feel, around 6 inches on my upper arm. I want it detailed but not too dark.'
    ],
    [
      'peony_brief_with_local_pronoun',
      "I'm thinking of a peony on my shoulder. I'd like it detailed."
    ],
    [
      'comma_joined_local_pronoun',
      'I want a blackwork raven, and I want it around 6 inches.'
    ],
    [
      'compound_design_then_price_pronoun',
      'I am thinking of a black and grey heron with water around it. How much is it by the way?'
    ],
    [
      'compound_design_then_style_pronoun',
      'I am thinking of a koi with waves curling around it. Could it stay mostly black and grey?'
    ]
  ]) {
    check(`same_turn_referent_${name}_is_coherent`,
      sameTurnIntroducesReferentBeforePointer(text) === true &&
        structuralDiscourseRelation(text, {}, noContext) === DISCOURSE_RELATIONS.COHERENT &&
        liveHasConcreteDesignDirection({ message: text, structured_state: {} }) === true,
      `${text}:${sameTurnIntroducesReferentBeforePointer(text)}:${structuralDiscourseRelation(text, {}, noContext)}:${liveHasConcreteDesignDirection({ message: text, structured_state: {} })}`)
  }
  for (const [name, text] of [
    ['bare_this_one', "I'm thinking of this one"],
    ['something_like_this', 'I want something like this'],
    ['unintroduced_it', 'I want it detailed'],
    ['dependent_intro_then_it', 'I want a tattoo like this. I want it detailed.'],
    ['dependent_intro_then_price', 'I am thinking of this one. How much is it by the way?'],
    ['dependent_like_this_then_price', 'I want a tattoo like this. How much is it by the way?']
  ]) {
    check(`same_turn_referent_negative_${name}_has_no_local_authority`,
      sameTurnIntroducesReferentBeforePointer(text) === false,
      `${text}:${sameTurnIntroducesReferentBeforePointer(text)}`)
  }
  const sameTurnAuthorityCannotBeDowngraded = {}
  applyDiscourseClassification(sameTurnAuthorityCannotBeDowngraded, {
    context_relation: 'missing_attachment',
    context_confidence: 'high',
    context_reason_code: 'pronoun_requires_image'
  }, 'I want a black and gray portrait. I want it detailed but not too dark.', noContext)
  check('same_turn_referent_authority_cannot_be_downgraded_by_model_classifier',
    sameTurnAuthorityCannotBeDowngraded.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      sameTurnAuthorityCannotBeDowngraded.live_turn_context_missing === false &&
      sameTurnAuthorityCannotBeDowngraded.live_turn_context_resolution_source === 'same_turn_referent_authority',
    JSON.stringify(sameTurnAuthorityCannotBeDowngraded))
  const copularAuthorityCannotBeDowngraded = {}
  applyDiscourseClassification(copularAuthorityCannotBeDowngraded, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'initial_it_requires_history'
  }, "It's a black and gray portrait of a woman. I want it detailed but not too dark.", noContext)
  check('copular_referent_authority_cannot_be_downgraded_by_model_classifier',
    copularAuthorityCannotBeDowngraded.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      copularAuthorityCannotBeDowngraded.live_turn_context_missing === false &&
      copularAuthorityCannotBeDowngraded.live_turn_context_resolution_source === 'same_turn_referent_authority',
    JSON.stringify(copularAuthorityCannotBeDowngraded))
  for (const [name, text] of [
    ['live_open_vocabulary_over_there', 'im tryna go kinda over there with it'],
    ['two_pointer_paraphrase', 'we could push it more over there with that'],
    ['spatial_pointer_paraphrase', 'i keep leaning over there'],
    ['directional_way_paraphrase', 'trying to head that way with it'],
    ['directional_construction_paraphrase', 'something in this direction']
  ]) {
    const relation = structuralDiscourseRelation(text, {}, noContext)
    check(`open_vocabulary_deictic_${name}_requires_resolution`,
      openSpatialDirectionalDeicticDependency(text) === true &&
        relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT,
      `${text}:${relation}:${openSpatialDirectionalDeicticDependency(text)}`)
  }
  const liveFailedClarificationHistory = [
    { role: 'user', text: 'I love your style' },
    { role: 'assistant', text: 'hey thanks so much what caught your eye from the stuff on my profile or highlights?' },
    { role: 'user', text: "I'm thinking of something like this" },
    { role: 'assistant', text: 'hey what did you want to show me exactly? i dont see the pic or post here' },
    { role: 'user', text: 'I want something in that direction' },
    { role: 'assistant', text: 'hey can you send me the actual pic or post you meant? i dont see it here yet' }
  ]
  check('open_clarification_question_does_not_ground_next_pointer',
    structuralDiscourseRelation('that one', {}, liveFailedClarificationHistory) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  const rejectedRecursiveResolution = {}
  applyDiscourseClassification(rejectedRecursiveResolution, {
    context_relation: 'resolved_from_history',
    context_confidence: 'high',
    context_reason_code: 'continuation_of_prior_direction',
    context_antecedent_quote: 'I want something in that direction'
  }, 'im tryna go kinda over there with it', liveFailedClarificationHistory)
  check('unresolved_prior_turn_cannot_become_classifier_antecedent_authority',
    rejectedRecursiveResolution.live_turn_context_relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT &&
    rejectedRecursiveResolution.live_turn_context_needs_clarification === true &&
    rejectedRecursiveResolution.live_turn_context_resolution_source === 'structural_floor',
    JSON.stringify(rejectedRecursiveResolution))
  check('unresolved_direction_text_is_not_durable_design_evidence',
    liveHasConcreteDesignDirection({
      message: 'I want something in that direction',
      recent_history: [],
      structured_state: { live_turn_text: 'I want something in that direction' }
    }) === false)
  for (const [name, text] of [
    ['generic_ack', 'yeah sure'],
    ['broad_host_prompt', "what's on your mind lately"],
    ['portfolio_compliment', 'I love your style'],
    ['vague_direction', 'something over there in that direction']
  ]) {
    check(`nonreferential_history_${name}_has_no_antecedent_authority`,
      antecedentTextCarriesReferentAuthority(text) === false,
      text)
  }
  for (const [name, text] of [
    ['concrete_design', 'black and grey snake wrapping around the upper arm'],
    ['concrete_person', 'my brother']
  ]) {
    check(`concrete_history_${name}_has_antecedent_authority`,
      antecedentTextCarriesReferentAuthority(text) === true,
      text)
  }
  for (const [name, text] of [
    ['explicit_correction', 'I mean the pink doughnut'],
    ['glued_typo_correction', 'Sorry imean the girl'],
    ['explicit_selection', 'just the little flower in the screenshot'],
    ['explicit_pointer', "I'm talking about the red shape in the corner"]
  ]) {
    check(`concrete_referent_nomination_${name}_is_self_grounding`,
      explicitConcreteReferentNomination(text) === true,
      text)
  }
  for (const [name, text] of [
    ['generic_part', 'I mean that part'],
    ['generic_vibe', 'just the vibe'],
    ['transactional_object', 'I mean the form']
  ]) {
    check(`nonconcrete_referent_nomination_${name}_stays_unresolved`,
      explicitConcreteReferentNomination(text) === false,
      text)
  }
  const explicitSelectionCannotBeDowngraded = {}
  applyDiscourseClassification(explicitSelectionCannotBeDowngraded, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'ambiguous_missing_referent'
  }, 'I mean the pink doughnut', [{
    role: 'user',
    message_id: 'pink-screen',
    text: 'sent a reference post: The image shows a website screenshot with a bright pink doughnut shape.'
  }])
  check('explicit_concrete_referent_cannot_be_downgraded_by_model_classifier',
    explicitSelectionCannotBeDowngraded.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      explicitSelectionCannotBeDowngraded.live_turn_context_missing === false &&
      explicitSelectionCannotBeDowngraded.live_turn_context_resolution_source === 'explicit_concrete_referent_authority',
    JSON.stringify(explicitSelectionCannotBeDowngraded))
  const gluedGirlCorrectionCannotBeDowngraded = {}
  applyDiscourseClassification(gluedGirlCorrectionCannotBeDowngraded, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'typo_not_understood'
  }, 'Sorry imean the girl', [{
    role: 'user',
    message_id: 'girl-photo',
    text: 'sent a reference post: a portrait photo showing a girl with light gray hair and glasses'
  }])
  check('glued_i_mean_visual_correction_cannot_be_downgraded_by_classifier',
    gluedGirlCorrectionCannotBeDowngraded.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      gluedGirlCorrectionCannotBeDowngraded.live_turn_context_missing === false &&
      gluedGirlCorrectionCannotBeDowngraded.live_turn_context_resolution_source === 'explicit_concrete_referent_authority',
    JSON.stringify(gluedGirlCorrectionCannotBeDowngraded))
  const visualAsrHistory = [{
    role: 'user',
    message_id: 'pink-screen',
    text: 'sent a reference post: The image shows a website screenshot with a bright pink doughnut shape.'
  }]
  check('visual_context_repairs_mean_to_im_in_asr_without_phrase_only_guess',
    contextualVisualAsrReferentNomination("I'm in the pink donut", visualAsrHistory) === true &&
      contextualVisualAsrReferentNomination("I'm in San Francisco", visualAsrHistory) === false &&
      contextualVisualAsrReferentNomination("I'm in the pink donut", []) === false)
  const visualAsrSelectionCannotBeDowngraded = {}
  applyDiscourseClassification(visualAsrSelectionCannotBeDowngraded, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'ambiguous_missing_referent'
  }, "I'm in the pink donut", visualAsrHistory)
  check('context_grounded_visual_asr_selection_cannot_be_downgraded_by_classifier',
    visualAsrSelectionCannotBeDowngraded.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      visualAsrSelectionCannotBeDowngraded.live_turn_context_missing === false &&
      visualAsrSelectionCannotBeDowngraded.live_turn_context_resolution_source === 'contextual_visual_asr_referent_authority',
    JSON.stringify(visualAsrSelectionCannotBeDowngraded))
  const selectedElementState = annotateStructuredStateForLiveTurn(
    { text: 'I mean the pink doughnut' },
    { tattoo_intent_active: true, booking_stage_hint: 'design_intake' },
    [{
      role: 'user',
      message_id: 'pink-screen',
      text: 'sent a reference post: The image shows a website screenshot with a bright pink doughnut shape.'
    }]
  )
  check('client_selected_visual_element_persists_as_design_context',
    selectedElementState.live_turn_gave_design_idea === true &&
      selectedElementState.known_design_context === 'I mean the pink doughnut',
    JSON.stringify(selectedElementState))
  for (const [name, text] of [
    ['explicit_snake', "I'm thinking of something like a black and grey snake"],
    ['explicit_flower_wrap', 'I want flowers wrapping around my arm'],
    ['explicit_full_brief', "I'm thinking of a medium black and grey snake on my shoulder"],
    ['unrelated_personal_question', 'what is your sexual identity?'],
    ['unrelated_music_question', 'btw what music are you into?'],
    ['existential_there_question', 'is there parking nearby?'],
    ['existential_there_statement', 'there is parking near me']
  ]) {
    check(`self_contained_variant_${name}_does_not_request_attachment`,
      structuralDiscourseRelation(text, {}, noContext) === DISCOURSE_RELATIONS.COHERENT,
      text)
  }
  check('non_exact_along_these_lines_is_missing_attachment',
    structuralDiscourseRelation('maybe more along these lines', {}, noContext) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  check('deictic_predicate_without_object_is_missing_attachment',
    structuralDiscourseRelation('this is kinda what I had in mind', {}, noContext) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  check('korean_reference_dependency_is_missing_attachment',
    structuralDiscourseRelation('이런 느낌으로 생각 중이에요', {}, noContext) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  check('calendar_demonstrative_is_coherent',
    structuralDiscourseRelation('this Saturday works for me', {}, noContext) === DISCOURSE_RELATIONS.COHERENT)
  check('ordinary_confirmation_is_coherent',
    structuralDiscourseRelation('this is perfect', {}, noContext) === DISCOURSE_RELATIONS.COHERENT)
  check('prior_authoritative_image_resolves_reference',
    structuralDiscourseRelation('something like this', {}, imageHistory) === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY)
  const requestedNumberReferenceHistory = [
    { role: 'user', message_id: 'number-pointer', text: "I'm thinking of something like this" },
    { role: 'assistant', message_id: 'number-request', text: 'send me the actual photo or reference so i can see it' },
    {
      role: 'user',
      message_id: 'number-image',
      text: 'sent a reference post: The image shows a smartphone screen displaying the number "1249" in large white digits.',
      text_source: 'reference_post.message_text|single_control_media_context_enriched'
    },
    { role: 'user', message_id: 'number-correction', text: 'Sorry, my bad this one' }
  ]
  check('correction_plus_selector_is_lightweight_reference_bridge',
    lightweightReferenceBridge('Sorry, my bad this one') === true &&
      lightweightReferenceBridge('I meant that photo') === true &&
      lightweightReferenceBridge('oops wrong one this one') === true)
  check('apology_with_substantive_new_topic_is_not_reference_bridge',
    lightweightReferenceBridge('sorry my bad I love pizza') === false)
  check('delivery_selector_is_stronger_than_generic_apology',
    bridgeSignalsDeliveredReference('Sorry, my bad this one') === true &&
      bridgeSignalsDeliveredReference('I meant that photo') === true &&
      bridgeSignalsDeliveredReference('here it is') === true &&
      bridgeSignalsDeliveredReference('I just sent it') === true &&
      bridgeSignalsDeliveredReference('sorry my bad') === false)

  const omittedMediaRequestedReferenceHistory = [
    { role: 'user', message_id: 'omitted-pointer', text: "I'm thinking of something like this" },
    {
      role: 'assistant',
      message_id: 'omitted-request',
      text: 'ooo can you drop the pic or send the reference over? it might not have come through'
    }
  ]
  const omittedMediaShadow = transportShadowReferenceFulfillmentChain(
    omittedMediaRequestedReferenceHistory,
    'Sorry, my bad this one'
  )
  check('requested_media_omitted_by_transport_gains_bounded_shadow_authority',
    omittedMediaShadow?.authority_kind === 'transport_shadow_requested_reference' &&
      omittedMediaShadow?.visual_event === null &&
      omittedMediaShadow?.pointer_event?.message_id === 'omitted-pointer' &&
      omittedMediaShadow?.request_event?.message_id === 'omitted-request',
    JSON.stringify(omittedMediaShadow))
  check('transport_shadow_correction_resolves_without_claiming_visual_event',
    structuralDiscourseRelation(
      'Sorry, my bad this one',
      {},
      omittedMediaRequestedReferenceHistory
    ) === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY)
  const omittedMediaAnnotated = applyDiscourseClassification(
    {},
    null,
    'Sorry, my bad this one',
    omittedMediaRequestedReferenceHistory
  )
  check('transport_shadow_authority_is_explicit_in_turn_state',
    omittedMediaAnnotated.live_turn_context_resolved_from_history === true &&
      omittedMediaAnnotated.live_turn_transport_shadow_reference === true &&
      omittedMediaAnnotated.live_turn_reference_authority_kind === 'transport_shadow_requested_reference',
    JSON.stringify(omittedMediaAnnotated))
  check('generic_apology_cannot_invent_omitted_media',
    transportShadowReferenceFulfillmentChain(
      omittedMediaRequestedReferenceHistory,
      'sorry my bad'
    ) === null)
  check('assistant_without_media_request_cannot_create_transport_shadow',
    transportShadowReferenceFulfillmentChain([
      { role: 'user', message_id: 'unrequested-pointer', text: "I'm thinking of something like this" },
      { role: 'assistant', message_id: 'unrequested-reply', text: 'tell me more about the idea' }
    ], 'sorry my bad this one') === null)
  check('intervening_user_turn_breaks_transport_shadow',
    transportShadowReferenceFulfillmentChain(
      omittedMediaRequestedReferenceHistory.concat([
        { role: 'user', message_id: 'intervening-price', text: 'by the way how much is it?' }
      ]),
      'sorry my bad this one'
    ) === null)
  check('multiple_assistant_packets_break_transport_shadow',
    transportShadowReferenceFulfillmentChain(
      omittedMediaRequestedReferenceHistory.concat([
        { role: 'assistant', message_id: 'different-packet', text: 'one sec' }
      ]),
      'sorry my bad this one'
    ) === null)
  check('multiple_anonymous_assistant_request_events_cannot_be_assumed_one_packet',
    transportShadowReferenceFulfillmentChain([
      { role: 'user', text: "I'm thinking of something like this" },
      { role: 'assistant', text: 'send me the actual photo or reference' },
      { role: 'assistant', text: 'one sec' }
    ], 'sorry my bad this one') === null)

  const omittedMediaNumberFollowupHistory = omittedMediaRequestedReferenceHistory.concat([
    { role: 'user', message_id: 'omitted-correction', text: 'Sorry, my bad this one' },
    {
      role: 'assistant',
      message_id: 'omitted-selection-question',
      text: 'what part of this direction feels right to you or is catching your eye?'
    }
  ])
  const omittedMediaNumberFollowup = transportShadowReferenceFulfillmentChain(
    omittedMediaNumberFollowupHistory,
    "I don't know I just like that number"
  )
  check('transport_shadow_survives_one_immediate_visual_selection_followup',
    omittedMediaNumberFollowup?.authority_kind === 'transport_shadow_requested_reference' &&
      omittedMediaNumberFollowup?.visual_event === null &&
      omittedMediaNumberFollowup?.bridge_event?.message_id === 'omitted-correction' &&
      omittedMediaNumberFollowup?.selection_question_event?.message_id === 'omitted-selection-question',
    JSON.stringify(omittedMediaNumberFollowup))
  check('transport_shadow_number_followup_resolves_from_history',
    structuralDiscourseRelation(
      "I don't know I just like that number",
      {},
      omittedMediaNumberFollowupHistory
    ) === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY)
  check('multiple_anonymous_selection_events_break_transport_shadow',
    transportShadowReferenceFulfillmentChain(
      [
        { role: 'user', message_id: 'anonymous-followup-pointer', text: "I'm thinking of something like this" },
        { role: 'assistant', message_id: 'anonymous-followup-request', text: 'send me the actual photo or reference' },
        { role: 'user', message_id: 'anonymous-followup-bridge', text: 'sorry my bad this one' },
        { role: 'assistant', text: 'what part of this direction feels right to you?' },
        { role: 'assistant', text: 'or what catches your eye?' }
      ],
      "I don't know I just like that number"
    ) === null)
  check('unrelated_followup_cannot_borrow_transport_shadow',
    transportShadowReferenceFulfillmentChain(
      omittedMediaNumberFollowupHistory,
      'what music are you into?'
    ) === null)

  check('requested_visual_survives_correction_plus_selector_supersession',
    Boolean(requestedReferenceFulfillmentChain(requestedNumberReferenceHistory, 'Sorry, my bad this one')))
  const requestedNumberFollowupHistory = requestedNumberReferenceHistory.concat([
    {
      role: 'assistant',
      message_id: 'number-selection-question',
      text: 'what part of this direction feels right to you or is catching your eye?'
    },
    { role: 'user', message_id: 'number-answer', text: "I don't know I just like that number" }
  ])
  check('referential_answer_after_bounded_visual_chain_resolves_from_history',
    structuralDiscourseRelation(
      "I don't know I just like that number",
      {},
      requestedNumberFollowupHistory
    ) === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY)
  check('unrelated_reply_after_visual_question_cannot_borrow_image_authority',
    requestedReferenceFulfillmentChain(
      requestedNumberReferenceHistory.concat([
        {
          role: 'assistant',
          message_id: 'number-selection-question',
          text: 'what part of this direction feels right to you or is catching your eye?'
        },
        { role: 'user', message_id: 'unrelated-answer', text: 'what music are you into?' }
      ]),
      'what music are you into?'
    ) === null)
  check('random_image_plus_apology_cannot_create_requested_reference_chain',
    requestedReferenceFulfillmentChain([
      { role: 'assistant', message_id: 'random-small-talk', text: 'how has your day been?' },
      {
        role: 'user',
        message_id: 'random-image',
        text: 'sent a reference post: The image shows a dashboard screenshot with a sales chart.'
      },
      { role: 'user', message_id: 'random-apology', text: 'sorry my bad this one' }
    ], 'sorry my bad this one') === null)
  check('unrelated_turn_breaks_requested_reference_chain',
    requestedReferenceFulfillmentChain(requestedNumberReferenceHistory.concat([
      { role: 'user', message_id: 'topic-change', text: 'anyway what music are you into?' },
      { role: 'user', message_id: 'late-pointer', text: 'I like that number' }
    ]), 'I like that number') === null)
  const exactLiveVoiceSourceContaminationHistory = [
    {
      role: 'user',
      message_id: 'voice-info',
      text: 'sent a voice note saying: Hey, can I please get more information?',
      text_source: 'reference_post.message_text|single_control_media_context_enriched|authority_media_context_enriched'
    },
    { role: 'assistant', text: 'you can check my highlights and send me anything that catches your eye' },
    {
      role: 'user',
      message_id: 'voice-compliment',
      text: 'sent a voice note saying: I love your style.',
      text_source: 'reference_post.message_text|single_control_media_context_enriched|authority_media_context_enriched'
    },
    { role: 'assistant', text: 'did anything in the highlights or flashes pull you in?' }
  ]
  check('voice_asr_history_never_becomes_visual_from_reference_post_source_residue',
    recentHistoryHasAuthoritativeReference(exactLiveVoiceSourceContaminationHistory) === false &&
    exactLiveVoiceSourceContaminationHistory
      .filter((event) => event.role === 'user')
      .every((event) => eventHasAuthoritativeVisualReference(event) === false),
    JSON.stringify(exactLiveVoiceSourceContaminationHistory))
  check('exact_live_voice_pointer_with_contaminated_source_history_stays_missing_attachment',
    structuralDiscourseRelation(
      "sent a voice note saying: I'm thinking of this one.",
      { live_turn_is_voice_note: true, live_turn_is_media_reference: false, deposit_requested: true },
      exactLiveVoiceSourceContaminationHistory
    ) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  check('candidate_transaction_flag_cannot_override_visual_pointer_without_visual',
    structuralDiscourseRelation(
      "sent a voice note saying: I'm thinking of this one.",
      { live_turn_is_voice_note: true, live_turn_deposit_sent: true },
      exactLiveVoiceSourceContaminationHistory
    ) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  const staleImageThenVoiceHistory = [
    ...imageHistory,
    { role: 'assistant', text: 'that snake reference can work' },
    {
      role: 'user',
      text: 'sent a voice note saying: I love your style',
      text_source: 'reference_post.message_text|single_control_media_context_enriched'
    },
    { role: 'assistant', text: 'thank you that means a lot' }
  ]
  check('older_visual_cannot_jump_over_newer_nonvisual_client_turn',
    structuralDiscourseRelation('something like this', {}, staleImageThenVoiceHistory) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT)
  check('prior_choice_question_resolves_short_ellipsis',
    structuralDiscourseRelation('the second one', {}, choiceHistory) === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY)
  check('unresolved_general_pronoun_requires_clarification',
    structuralDiscourseRelation('can you do it that way?', {}, noContext) === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT)
  check('unresolved_person_pronoun_requires_clarification',
    structuralDiscourseRelation('he said no though', {}, noContext) === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT)
  check('bare_action_pointer_requires_grounded_antecedent',
    structuralDiscourseRelation('send it', {}, noContext) === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT)
  check('emoji_only_is_real_self_contained_social_input',
    structuralDiscourseRelation('🫠🦐', {}, noContext) === DISCOURSE_RELATIONS.SELF_CONTAINED_TOPIC_SHIFT)
  check('open_form_consent_remains_direct_transactional_authority',
    structuralDiscourseRelation('send it', { live_turn_form_consent: true }, noContext) === DISCOURSE_RELATIONS.COHERENT)
  check('invalid_classifier_label_is_not_authority',
    normalizeDiscourseClassification({ context_relation: 'book_it', context_confidence: 'certain' }).relation === DISCOURSE_RELATIONS.COHERENT)

  const inductiveMissing = {}
  applyDiscourseClassification(inductiveMissing, {
    context_relation: 'missing_attachment',
    context_confidence: 'high',
    context_reason_code: 'points_to_unseen_object'
  }, 'the thing i was trying to show you', noContext)
  check('llm_inductive_variant_promotes_missing_attachment',
    inductiveMissing.live_turn_context_missing_attachment === true &&
    inductiveMissing.live_turn_context_resolution_source === 'llm_inductive_classifier',
    JSON.stringify(inductiveMissing))

  const lowConfidence = {}
  applyDiscourseClassification(lowConfidence, {
    context_relation: 'missing_attachment',
    context_confidence: 'low'
  }, 'by the way where are you located?', noContext)
  check('low_confidence_classifier_cannot_block_self_contained_turn',
    lowConfidence.live_turn_context_missing === false,
    JSON.stringify(lowConfidence))

  const topicShift = {}
  applyDiscourseClassification(topicShift, {
    context_relation: 'self_contained_topic_shift',
    context_confidence: 'high',
    context_reason_code: 'new_complete_question'
  }, 'btw do you have parking?', noContext)
  check('self_contained_topic_shift_is_preserved_not_clarified',
    topicShift.live_turn_self_contained_topic_shift === true && topicShift.live_turn_context_missing === false,
    JSON.stringify(topicShift))

  const repeatedCuriosityFollowup = evaluateScvContractHarness({
    message: 'Are you scared of dying?',
    recent_history: [{ role: 'assistant', text: 'what made you ask?' }],
    structured_state: {
      live_turn_is_question: true,
      live_turn_self_contained_topic_shift: true
    }
  }, { bubbles: [{ text: 'that’s a heavy one. what’s got you thinking about it?' }] })
  check('self_contained_topic_jump_rejects_recycled_curiosity_probe',
    repeatedCuriosityFollowup.valid === false &&
      repeatedCuriosityFollowup.reason === 'self_contained_turn_repeats_recent_followup_function',
    JSON.stringify(repeatedCuriosityFollowup))

  const ambiguous = {}
  applyDiscourseClassification(ambiguous, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'unknown_person'
  }, 'he said no though', noContext)
  check('inductive_missing_person_requires_clarification',
    ambiguous.live_turn_context_needs_clarification === true,
    JSON.stringify(ambiguous))

  const ungroundedResolution = {}
  applyDiscourseClassification(ungroundedResolution, {
    context_relation: 'resolved_from_history',
    context_confidence: 'high',
    context_reason_code: 'claimed_history_resolution',
    context_antecedent_quote: ''
  }, 'he said no though', noContext)
  check('classifier_cannot_claim_history_resolution_without_grounded_antecedent',
    ungroundedResolution.live_turn_context_relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT &&
    ungroundedResolution.live_turn_context_needs_clarification === true,
    JSON.stringify(ungroundedResolution))

  const groundedResolution = {}
  const personHistory = [{ role: 'user', text: 'my brother looked at the sketch yesterday' }]
  applyDiscourseClassification(groundedResolution, {
    context_relation: 'resolved_from_history',
    context_confidence: 'high',
    context_reason_code: 'brother_is_he',
    context_antecedent_quote: 'my brother'
  }, 'he said no though', personHistory)
  check('exact_history_antecedent_allows_inductive_resolution',
    groundedResolution.live_turn_context_relation === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY &&
    groundedResolution.live_turn_context_resolution_source === 'llm_history_resolution_verified',
    JSON.stringify(groundedResolution))

  const genericPromptCannotBecomeReferent = {}
  const genericPromptHistory = [{
    role: 'assistant',
    text: 'what kind of vibe or idea have you been thinking about? throw me anything you’re feeling'
  }]
  applyDiscourseClassification(genericPromptCannotBecomeReferent, {
    context_relation: 'resolved_from_history',
    context_confidence: 'high',
    context_reason_code: 'coherent_latest',
    context_antecedent_quote: 'what kind of vibe or idea have you been thinking about?'
  }, "I'm thinking of this one", genericPromptHistory)
  check('generic_open_prompt_quote_cannot_author_unseen_referent',
    genericPromptCannotBecomeReferent.live_turn_context_relation === DISCOURSE_RELATIONS.MISSING_ATTACHMENT &&
    genericPromptCannotBecomeReferent.live_turn_context_missing_attachment === true &&
    genericPromptCannotBecomeReferent.live_turn_context_resolution_source === 'structural_floor',
    JSON.stringify(genericPromptCannotBecomeReferent))

  const genericAckCannotBecomeReferent = {}
  const genericAckHistory = [
    { role: 'user', text: 'yeah sure' },
    { role: 'assistant', text: 'yesss what’s on your mind lately' }
  ]
  applyDiscourseClassification(genericAckCannotBecomeReferent, {
    context_relation: 'resolved_from_history',
    context_confidence: 'high',
    context_reason_code: 'continuation_of_ack',
    context_antecedent_quote: 'yeah sure'
  }, "I'm tryna go kinda over there with it", genericAckHistory)
  check('generic_ack_quote_cannot_override_open_referent_structural_floor',
    genericAckCannotBecomeReferent.live_turn_context_relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT &&
    genericAckCannotBecomeReferent.live_turn_context_needs_clarification === true &&
    genericAckCannotBecomeReferent.live_turn_context_resolution_source === 'structural_floor',
    JSON.stringify(genericAckCannotBecomeReferent))

  const concreteHistoryCannotGuessOpaquePointer = {}
  const concreteDesignHistory = [
    { role: 'user', text: 'I am thinking of a black and grey snake wrapping around my arm' },
    { role: 'assistant', text: 'want me to send the form so we can get things rolling?' }
  ]
  applyDiscourseClassification(concreteHistoryCannotGuessOpaquePointer, {
    context_relation: 'resolved_from_history',
    context_confidence: 'high',
    context_reason_code: 'claimed_design_continuation',
    context_antecedent_quote: 'black and grey snake wrapping around my arm'
  }, "I'm tryna go kinda over there with it", concreteDesignHistory)
  check('concrete_but_unaligned_history_cannot_guess_opaque_spatial_pointer',
    concreteHistoryCannotGuessOpaquePointer.live_turn_context_relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT &&
    concreteHistoryCannotGuessOpaquePointer.live_turn_context_needs_clarification === true &&
    concreteHistoryCannotGuessOpaquePointer.live_turn_context_resolution_source === 'structural_floor',
    JSON.stringify(concreteHistoryCannotGuessOpaquePointer))
  for (const [name, text] of [
    ['two_pointer', 'we could push it more over there with that'],
    ['spatial_pointer', 'i keep leaning over there'],
    ['directional_way', 'trying to head that way with it']
  ]) {
    const state = {}
    applyDiscourseClassification(state, {
      context_relation: 'resolved_from_history',
      context_confidence: 'high',
      context_reason_code: 'claimed_design_continuation',
      context_antecedent_quote: 'black and grey snake wrapping around my arm'
    }, text, concreteDesignHistory)
    check(`concrete_history_cannot_guess_${name}_dimension`,
      state.live_turn_context_relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT &&
        state.live_turn_context_needs_clarification === true &&
        state.live_turn_context_resolution_source === 'structural_floor',
      `${text}:${JSON.stringify(state)}`)
  }
  check('prior_image_cannot_guess_new_opaque_direction',
    structuralDiscourseRelation('i keep leaning over there', {}, imageHistory) === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT)
  const directionalChoiceHistory = [{
    role: 'assistant',
    text: 'did you mean toward the shoulder or toward the elbow?'
  }]
  check('immediate_closed_choice_can_ground_directional_short_reply',
    structuralDiscourseRelation('yeah that way', {}, directionalChoiceHistory) === DISCOURSE_RELATIONS.RESOLVED_FROM_HISTORY)
  check('live_referent_bearing_paraphrase_remains_coherent',
    structuralDiscourseRelation("I'm tryna wrap the snake over my forearm", {}, concreteDesignHistory) === DISCOURSE_RELATIONS.COHERENT)

  const currentMedia = { live_turn_is_media_reference: true }
  applyDiscourseClassification(currentMedia, {
    context_relation: 'missing_attachment',
    context_confidence: 'high'
  }, 'this is what i mean', noContext)
  check('current_media_authority_clears_missing_attachment',
    currentMedia.live_turn_context_missing === false && currentMedia.live_turn_context_relation === 'coherent',
    JSON.stringify(currentMedia))
  check('current_turn_media_can_ground_open_direction_without_history_guess',
    structuralDiscourseRelation('trying to head that way with it', { live_turn_is_media_reference: true }, imageHistory) === DISCOURSE_RELATIONS.COHERENT)

  const directForm = { live_turn_form_consent: true }
  applyDiscourseClassification(directForm, {
    context_relation: 'missing_attachment',
    context_confidence: 'high'
  }, 'yes send it', noContext)
  check('direct_transactional_authority_cannot_be_overridden',
    directForm.live_turn_context_missing === false,
    JSON.stringify(directForm))

  const contextualBookingReply = { live_turn_contextual_booking_reply: true }
  applyDiscourseClassification(contextualBookingReply, {
    context_relation: 'self_contained_topic_shift',
    context_confidence: 'high',
    context_reason_code: 'new_complete_question'
  }, 'Can you do 26?', [{
    role: 'assistant',
    message_id: 'date-prompt-1',
    text: 'what dates or weekend days are easiest for you?'
  }])
  check('contextual_booking_reply_cannot_be_overridden_as_topic_shift',
    contextualBookingReply.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      contextualBookingReply.live_turn_context_resolution_source === 'direct_live_authority' &&
      contextualBookingReply.live_turn_self_contained_topic_shift === false,
    JSON.stringify(contextualBookingReply))

  const explicitBookingDateCannotBeDowngraded = {
    form_link_sent: true,
    form_submitted: true,
    booking_stage_hint: 'awaiting_date',
    live_turn_date_phrase: '26 August',
    live_turn_date_status: 'too_soon',
    live_turn_date_iso: '2026-08-26'
  }
  applyDiscourseClassification(explicitBookingDateCannotBeDowngraded, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'missing_referent'
  }, 'How about 26 August?', noContext)
  check('explicit_booking_date_cannot_be_downgraded_to_missing_referent',
    explicitBookingDateCannotBeDowngraded.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      explicitBookingDateCannotBeDowngraded.live_turn_context_missing === false &&
      explicitBookingDateCannotBeDowngraded.live_turn_context_resolution_source === 'direct_live_authority',
    JSON.stringify(explicitBookingDateCannotBeDowngraded))

  const rejectedDateContinuationCannotLoseProvenance = {
    form_link_sent: true,
    form_submitted: true,
    booking_stage_hint: 'awaiting_date',
    live_turn_contextual_booking_reply: true,
    live_turn_monthless_day_candidate: '28',
    live_turn_contextual_month_anchor: 'august',
    live_turn_date_needs_month: false,
    live_turn_date_phrase: 'august 28',
    live_turn_date_status: 'too_soon',
    live_turn_date_iso: '2026-08-28',
    live_turn_context_resolution_source: 'prior_rejected_client_date_continuation'
  }
  applyDiscourseClassification(rejectedDateContinuationCannotLoseProvenance, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'missing_referent'
  }, 'Can we do 28?', noContext)
  check('rejected_date_continuation_preserves_contextual_month_provenance',
    rejectedDateContinuationCannotLoseProvenance.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      rejectedDateContinuationCannotLoseProvenance.live_turn_context_missing === false &&
      rejectedDateContinuationCannotLoseProvenance.live_turn_context_resolution_source === 'prior_rejected_client_date_continuation',
    JSON.stringify(rejectedDateContinuationCannotLoseProvenance))

  const runnerExplicitDateInput = {
    message: 'How about 26 August?',
    recent_history: noContext,
    structured_state: {
      form_link_sent: true,
      form_submitted: true,
      booking_stage_hint: 'awaiting_date',
      live_turn_date_phrase: '26 August',
      live_turn_date_status: 'too_soon',
      live_turn_date_iso: '2026-08-26'
    }
  }
  mergeIntentFlags(runnerExplicitDateInput, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'missing_referent'
  })
  check('runner_intent_merge_preserves_explicit_booking_date_authority',
    runnerExplicitDateInput.structured_state.live_turn_context_relation === DISCOURSE_RELATIONS.COHERENT &&
      runnerExplicitDateInput.structured_state.live_turn_context_missing === false &&
      runnerExplicitDateInput.structured_state.live_turn_context_needs_clarification === false,
    JSON.stringify(runnerExplicitDateInput.structured_state))

  const monthlessDateHasNoExplicitAuthority = {
    form_link_sent: true,
    form_submitted: true,
    booking_stage_hint: 'awaiting_date',
    live_turn_date_needs_month: true,
    live_turn_monthless_day_candidate: '26'
  }
  applyDiscourseClassification(monthlessDateHasNoExplicitAuthority, {
    context_relation: 'ambiguous_missing_referent',
    context_confidence: 'high',
    context_reason_code: 'month_missing'
  }, 'How about 26?', noContext)
  check('monthless_date_does_not_gain_full_date_authority',
    monthlessDateHasNoExplicitAuthority.live_turn_context_relation === DISCOURSE_RELATIONS.AMBIGUOUS_MISSING_REFERENT &&
      monthlessDateHasNoExplicitAuthority.live_turn_context_needs_clarification === true,
    JSON.stringify(monthlessDateHasNoExplicitAuthority))

  const annotation = annotateStructuredStateForLiveTurn({ text: 'closer to that one' }, {}, noContext)
  check('authority_annotation_uses_general_resolver',
    annotation.live_turn_context_missing_attachment === true && annotation.live_turn_reference_pointer_without_media === true,
    JSON.stringify(annotation))
  const unresolvedDirectionAnnotation = annotateStructuredStateForLiveTurn(
    { text: 'I want something in that direction' },
    { tattoo_intent_active: true },
    noContext
  )
  check('missing_reference_cannot_write_durable_design_context',
    unresolvedDirectionAnnotation.live_turn_context_missing === true &&
    unresolvedDirectionAnnotation.live_turn_gave_design_idea !== true &&
    !String(unresolvedDirectionAnnotation.known_design_context || '').trim(),
    JSON.stringify(unresolvedDirectionAnnotation))

  const runnerInput = {
    message: 'this is kinda what i had in mind',
    live_message: 'this is kinda what i had in mind',
    recent_history: noContext,
    structured_state: {}
  }
  mergeIntentFlags(runnerInput, {
    is_tattoo_intent: true,
    gave_design_idea: false,
    form_consent: false,
    explicit_form_request: false,
    accepts_offered_slot: false,
    form_submitted: false,
    deposit_sent: false,
    asks_price: false,
    is_question: false,
    declines: false,
    context_relation: 'missing_attachment',
    context_confidence: 'high',
    context_reason_code: 'unseen_demonstrative_object'
  })
  const adoption = buildIntentAdoptionState(runnerInput)
  check('runner_classifier_state_crosses_bounded_adoption_gate',
    adoption.context_classifier_applied === true &&
    adoption.live_turn_context_missing_attachment === true &&
    adoption.live_turn_context_relation === 'missing_attachment',
    JSON.stringify(adoption))

  const resolverCarriedState = applyMediaContextToState({}, {
    is_voice_note: true,
    text: 'sent a voice note saying: im thinkin of smth like dis',
    state_flags: {
      live_turn_context_missing: true,
      live_turn_context_missing_attachment: true,
      live_turn_reference_pointer_without_media: true
    },
    intent_adoption_state: {
      llm_intent_applied: true,
      context_classifier_applied: true,
      live_turn_context_missing: true,
      live_turn_context_missing_attachment: true,
      live_turn_reference_pointer_without_media: true,
      live_turn_context_relation: 'missing_attachment',
      live_turn_context_confidence: 'high',
      live_turn_context_resolution_source: 'llm_inductive_classifier',
      live_turn_context_reason_code: 'deictic_unseen_object',
      live_turn_context_antecedent_quote: ''
    }
  }, { text: 'sent a voice note saying: im thinkin of smth like dis' })
  check('media_resolver_complete_discourse_decision_survives_process_boundary',
    resolverCarriedState.context_classifier_applied === true &&
    resolverCarriedState.live_turn_context_missing_attachment === true &&
    resolverCarriedState.live_turn_context_relation === 'missing_attachment' &&
    resolverCarriedState.live_turn_context_reason_code === 'deictic_unseen_object',
    JSON.stringify(resolverCarriedState))

  const antecedentInput = {
    message: 'the second one',
    live_message: 'the second one',
    recent_history: choiceHistory,
    structured_state: {}
  }
  mergeIntentFlags(antecedentInput, {
    context_relation: 'resolved_from_history',
    context_confidence: 'high',
    context_reason_code: 'closed_choice_answer',
    context_antecedent_quote: 'first option or the second one'
  })
  const antecedentAdoption = buildIntentAdoptionState(antecedentInput)
  check('grounded_antecedent_crosses_runner_adoption_boundary',
    antecedentAdoption.live_turn_context_relation === 'resolved_from_history' &&
    antecedentAdoption.live_turn_context_antecedent_quote === 'first option or the second one',
    JSON.stringify(antecedentAdoption))

  const classifierPrompt = buildIntentClassifierPrompt({
    message: 'that part',
    live_message: 'that part',
    recent_history: Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', text: `turn ${index}` })),
    structured_state: {}
  })
  check('classifier_prompt_has_complete_relation_ontology',
    classifierPrompt.includes('self_contained_topic_shift') &&
    classifierPrompt.includes('ambiguous_missing_referent') &&
    classifierPrompt.includes('missing_attachment'))
  check('classifier_prompt_is_inductive_not_this_one_only',
    classifierPrompt.includes('person, object, choice, action, or prior claim') &&
    classifierPrompt.includes('A topic change is NOT missing context'))
  check('classifier_prompt_requires_grounded_antecedent_quote',
    classifierPrompt.includes('context_antecedent_quote') &&
    classifierPrompt.includes('With empty history, resolved_from_history is impossible') &&
    classifierPrompt.includes('generic acknowledgement, greeting, compliment, open hosting question') &&
    classifierPrompt.includes('"yeah sure"') &&
    classifierPrompt.includes('cannot ground this/that/it/there/over there') &&
    classifierPrompt.includes('Referent evidence must match the missing dimension') &&
    classifierPrompt.includes('prior image does NOT identify a new unnamed direction/location'))
  check('classifier_history_window_is_bounded',
    !buildDiscourseClassifierHistory(Array.from({ length: 40 }, (_, index) => ({ role: 'user', text: `turn-${index}` })), 24, 8000).includes('turn-0') &&
    buildDiscourseClassifierHistory(Array.from({ length: 40 }, (_, index) => ({ role: 'user', text: `turn-${index}` })), 24, 8000).includes('turn-39'))

  const missingInput = {
    message: 'this is kinda what i had in mind',
    recent_history: [],
    structured_state: {
      live_turn_context_missing: true,
      live_turn_context_missing_attachment: true,
      live_turn_context_relation: 'missing_attachment'
    }
  }
  const missingPlan = deriveClosedTransitionPlan(missingInput)
  check('missing_attachment_has_general_resolve_context_route',
    missingPlan.action === ACTIONS.RESOLVE_CONTEXT && missingPlan.reason === 'missing_attachment',
    JSON.stringify(missingPlan))
  check('missing_attachment_accepts_natural_media_request',
    evaluateClosedTransitionContract(missingInput, { bubbles: [{ text: 'send me the actual pic when you get a sec so i can see what you mean' }] }, missingPlan).valid === true)
  const unseenEvaluation = evaluateClosedTransitionContract(missingInput, {
    bubbles: [
      { text: 'that direction feels really solid' },
      { text: 'can you send the pic so i can see it properly?' }
    ]
  }, missingPlan)
  check('missing_attachment_rejects_unseen_evaluation',
    unseenEvaluation.valid === false && unseenEvaluation.reason === 'closed_transition_missing_attachment_assumption_forbidden',
    JSON.stringify(unseenEvaluation))
  const falseUnderstandingThenRequest = evaluateClosedTransitionContract(missingInput, {
    bubbles: [
      { text: 'yeah i get that direction for sure' },
      { text: 'could you send the pic or reference you had in mind?' }
    ]
  }, missingPlan)
  check('missing_attachment_rejects_claimed_understanding_before_media',
    falseUnderstandingThenRequest.valid === false &&
    falseUnderstandingThenRequest.reason === 'closed_transition_missing_attachment_assumption_forbidden',
    JSON.stringify(falseUnderstandingThenRequest))
  const genericAckThenRequest = evaluateClosedTransitionContract(missingInput, {
    bubbles: [{ text: 'got you what do you mean by this though? could you send the actual pic?' }]
  }, missingPlan)
  check('missing_attachment_rejects_generic_acknowledgement_prefix_before_media',
    genericAckThenRequest.valid === false &&
    genericAckThenRequest.reason === 'closed_transition_missing_attachment_assumption_forbidden',
    JSON.stringify(genericAckThenRequest))
  const prematureForm = evaluateClosedTransitionContract(missingInput, {
    bubbles: [{ text: 'send me the pic and do you want me to send the form?' }]
  }, missingPlan)
  check('context_gap_cannot_advance_form',
    prematureForm.valid === false && prematureForm.reason === 'closed_transition_context_gap_cannot_advance_funnel',
    JSON.stringify(prematureForm))

  const ambiguousInput = {
    message: 'he said no though',
    recent_history: [],
    structured_state: {
      live_turn_context_missing: true,
      live_turn_context_needs_clarification: true,
      live_turn_context_relation: 'ambiguous_missing_referent'
    }
  }
  const ambiguousPlan = deriveClosedTransitionPlan(ambiguousInput)
  check('missing_person_has_general_resolve_context_route',
    ambiguousPlan.action === ACTIONS.RESOLVE_CONTEXT && ambiguousPlan.reason === 'ambiguous_missing_referent',
    JSON.stringify(ambiguousPlan))
  const unresolvedCandidateConfirmation = evaluateClosedTransitionContract(
    ambiguousInput,
    { bubbles: [{ text: 'wait do you mean the artist you were talking about earlier?' }] },
    ambiguousPlan
  )
  check('candidate_confirmation_without_authoritative_referent_is_rejected',
    unresolvedCandidateConfirmation.valid === false &&
      unresolvedCandidateConfirmation.reason === 'closed_transition_missing_referent_clarification_required',
    JSON.stringify(unresolvedCandidateConfirmation))
  const lexicalDeclineCollision = {
    ...ambiguousInput,
    structured_state: {
      ...ambiguousInput.structured_state,
      live_turn_declines: true
    }
  }
  const collisionPlan = deriveClosedTransitionPlan(lexicalDeclineCollision)
  check('missing_referent_outranks_false_lexical_decline',
    collisionPlan.action === ACTIONS.RESOLVE_CONTEXT && collisionPlan.reason === 'ambiguous_missing_referent',
    JSON.stringify(collisionPlan))
  const genericStoryQuestion = evaluateClosedTransitionContract(ambiguousInput, {
    bubbles: [{ text: 'what happened exactly?' }]
  }, ambiguousPlan)
  check('generic_story_question_does_not_resolve_missing_referent',
    genericStoryQuestion.valid === false && genericStoryQuestion.reason === 'closed_transition_missing_referent_clarification_required',
    JSON.stringify(genericStoryQuestion))
  check('direct_person_referent_question_is_valid',
    evaluateClosedTransitionContract(ambiguousInput, { bubbles: [{ text: 'wait who do you mean by he?' }] }, ambiguousPlan).valid === true)
  const pretendUnderstanding = evaluateClosedTransitionContract(ambiguousInput, {
    bubbles: [{ text: 'yeah that makes sense we can definitely do that' }]
  }, ambiguousPlan)
  check('pretend_understanding_without_clarification_is_rejected',
    pretendUnderstanding.valid === false && pretendUnderstanding.reason === 'closed_transition_missing_context_assumption_forbidden',
    JSON.stringify(pretendUnderstanding))
  const directionUnderstanding = evaluateClosedTransitionContract(ambiguousInput, {
    bubbles: [
      { text: 'got it yeah that direction works well' },
      { text: 'what did you mean by over there?' }
    ]
  }, ambiguousPlan)
  check('ambiguous_pointer_rejects_claimed_direction_understanding',
    directionUnderstanding.valid === false &&
    directionUnderstanding.reason === 'closed_transition_missing_context_assumption_forbidden',
    JSON.stringify(directionUnderstanding))
  const falseUnderstandingThenOpenQuestion = evaluateClosedTransitionContract(ambiguousInput, {
    bubbles: [
      { text: 'yeah i get that you want something like what you mentioned' },
      { text: 'what do you mean by over there?' }
    ]
  }, ambiguousPlan)
  check('open_question_cannot_wash_prior_false_understanding',
    falseUnderstandingThenOpenQuestion.valid === false &&
    falseUnderstandingThenOpenQuestion.reason === 'closed_transition_missing_context_assumption_forbidden',
    JSON.stringify(falseUnderstandingThenOpenQuestion))

  const historyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-discourse-history-'))
  for (let index = 0; index < 510; index += 1) {
    appendControlHistoryEvent(historyRoot, {
      contact_id: 'context-thread',
      thread_id: 'context-thread',
      message_id: `assistant-${index}`,
      bubble_index: 0,
      bubble: { text: `assistant context turn ${index}` }
    }, 'assistant', { at: new Date(1700000000000 + index * 1000).toISOString() })
  }
  const persisted = JSON.parse(fs.readFileSync(path.join(historyRoot, 'thread-history', 'context-thread.json'), 'utf8'))
  check('persistent_history_retains_500_events', persisted.events.length === 500, String(persisted.events.length))
  check('persistent_history_evicts_only_oldest_beyond_bound',
    persisted.events[0].message_id === 'assistant-10' && persisted.events.at(-1).message_id === 'assistant-509',
    `${persisted.events[0]?.message_id}:${persisted.events.at(-1)?.message_id}`)

  if (failures.length) {
    const err = new Error(`scv_discourse_continuity_harness_failed:${JSON.stringify(failures)}`)
    err.failures = failures
    throw err
  }
  return {
    ok: true,
    locked: true,
    lock_version: SCV_DISCOURSE_CONTINUITY_HARNESS_VERSION,
    discourse_version: SCV_DISCOURSE_CONTINUITY_VERSION,
    checked
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvDiscourseContinuityHarness(), null, 2))
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err))
    process.exit(1)
  }
}

module.exports = {
  SCV_DISCOURSE_CONTINUITY_HARNESS_VERSION,
  runScvDiscourseContinuityHarness
}
