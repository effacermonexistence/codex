#!/usr/bin/env node
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  liveInfoAskOpener
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  annotateStructuredStateForLiveTurn
} = require(path.join(__dirname, 'dm-authority.js'))
const {
  ACTIONS,
  deriveClosedTransitionPlan
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const {
  ensureControlDirs,
  recordIngressEvent,
  executeSingleControlTurn
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  SCV_OPENAI_CONVERSATION_VERSION,
  SCV_RESPONSES_CONVERGENCE_BASELINE
} = require(path.join(__dirname, 'scv-openai-conversation.js'))

let checked = 0
const failures = []
function check(name, condition, detail = '') {
  checked += 1
  if (!condition) failures.push({ name, detail })
}

const directInfoRequests = [
  'Hi, can I please get more info here?',
  'Could I please have more details on this?',
  'Can I learn a little more?',
  'Could you explain this?',
  'Please tell me more',
  'What else should I know?',
  'I need more information',
  'More details please',
  'I am looking for more information about working with you'
]
for (const message of directInfoRequests) {
  check(`direct info recognized :: ${message}`,
    liveInfoAskOpener({ message, live_message: message, structured_state: {} }) === true)
}

for (const message of [
  'I put the info in the form',
  'the details are correct',
  'what do you mean by over there?',
  'how does this work?'
]) {
  check(`unrelated or ungrounded wording stays out :: ${message}`,
    liveInfoAskOpener({ message, live_message: message, recent_history: [], structured_state: {} }) === false)
}

const incidentMessage = 'Hi, can I please get more info here?'
const staleBookingState = {
  booking_stage_hint: 'ready_for_double_check',
  next_action: 'ready_for_double_check',
  tattoo_intent_active: true,
  form_offer_asked: true,
  form_link_sent: true,
  form_submitted: true,
  known_name_used_on_form: 'Omar',
  known_phone_used_on_form: '5555555555',
  known_requested_date: 'september 15',
  known_requested_time: '3pm',
  double_check_sent: true,
  deposit_requested: true,
  live_turn_context_missing: true,
  live_turn_context_missing_attachment: false,
  live_turn_context_needs_clarification: true,
  live_turn_reference_pointer_without_media: true,
  live_turn_context_relation: 'ambiguous_missing_referent'
}

const annotated = annotateStructuredStateForLiveTurn(
  { text: incidentMessage, message: incidentMessage },
  staleBookingState,
  []
)
check('incident clears provisional missing-context flags',
  annotated.live_turn_context_missing === false &&
  annotated.live_turn_context_missing_attachment === false &&
  annotated.live_turn_context_needs_clarification === false &&
  annotated.live_turn_reference_pointer_without_media === false,
  JSON.stringify(annotated))
check('incident is classifier-independent self-contained information intent',
  annotated.live_turn_context_relation === 'self_contained_topic_shift' &&
  annotated.live_turn_context_resolution_source === 'deterministic_direct_info_request' &&
  annotated.live_turn_is_question === true &&
  annotated.live_turn_is_tattoo_intent === true,
  JSON.stringify(annotated))

const plan = deriveClosedTransitionPlan({
  message: incidentMessage,
  live_message: incidentMessage,
  recent_history: [],
  structured_state: annotated
})
check('direct information request outranks stale double-check and deposit state',
  plan.action === ACTIONS.DESIGN_INTAKE &&
  plan.reason === 'direct_info_request_owns_live_turn' &&
  plan.live_intent.direct_info_request === true,
  JSON.stringify(plan))

const concreteInfoPlan = deriveClosedTransitionPlan({
  message: 'Can I get more information about booking a capybara tattoo?',
  live_message: 'Can I get more information about booking a capybara tattoo?',
  recent_history: [],
  structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake' }
})
check('concrete motif inside information question keeps design-complete route',
  concreteInfoPlan.action === ACTIONS.OFFER_FORM &&
  concreteInfoPlan.reason === 'design_direction_ready_for_form_offer',
  JSON.stringify(concreteInfoPlan))

const ambiguous = annotateStructuredStateForLiveTurn(
  { text: 'what should i do over there?', message: 'what should i do over there?' },
  { booking_stage_hint: 'design_intake', tattoo_intent_active: true },
  []
)
const ambiguousPlan = deriveClosedTransitionPlan({
  message: 'what should i do over there?',
  live_message: 'what should i do over there?',
  recent_history: [],
  structured_state: ambiguous
})
check('unidentified referent still requires context',
  ambiguousPlan.action === ACTIONS.RESOLVE_CONTEXT,
  JSON.stringify({ ambiguous, ambiguousPlan }))

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-info-precedence-'))
try {
  ensureControlDirs(root)
  const inbound = {
    contact_id: 'info-precedence-e2e',
    thread_id: 'info-precedence-e2e',
    instagram_username: 'omar.system',
    message_id: 'info-precedence-e2e-1',
    text: incidentMessage,
    received_at: '2026-09-01T21:32:02.667Z',
    source_interaction_at: '2026-09-01T21:32:00.000Z'
  }
  recordIngressEvent(root, inbound)
  let observedPlan = null
  const result = executeSingleControlTurn(inbound, {
    root,
    authority_options: { structured_state_override: staleBookingState },
    candidateGenerator: (_msg, options) => {
      observedPlan = options.control_transition_contract
      return {
        source: 'codex_exec_dm_authority',
        authority: {
          runner: 'test',
          model: 'fixture',
          executor: 'bounded_candidate_only',
          // Production and staging require the same conversation-chain receipt
          // as a provider-authored packet. Keep the no-send fixture realistic
          // so it cannot pass locally by relying on a looser environment.
          openai_conversation: {
            version: SCV_OPENAI_CONVERSATION_VERSION,
            api: 'responses_v1',
            response_id: 'resp_info_precedence_fixture_0001',
            provider_response_id_present: true,
            previous_response_id: '',
            native_history_seeded: true,
            reseeded_from_response_id: '',
            stored: true,
            authoritative_visible_ledger_reconciled: true,
            conversation_context_mode: 'full_visible_ledger_reseed',
            rcc_revas_pre_inference_convergence_field: true,
            convergence_baseline: SCV_RESPONSES_CONVERGENCE_BASELINE,
            model: String(process.env.OPENAI_DM_MODEL || 'gpt-5.4-mini-2026-03-17')
          }
        },
        raw_text: 'info response fixture',
        packet: {
          bubbles: [
            { text: 'hii yeah the model spot is a tattoo i shape around what you want while the finished piece stays in my style' },
            { text: 'my profile and highlights can be inspo but custom ideas are open too so send me any loose idea or reference you have' }
          ]
        },
        structured_state: { ...options.structured_state_override },
        intent_adoption_state: {},
        recent_history: []
      }
    }
  })
  check('full controller accepts information reply on first pass without recovery',
    observedPlan?.action === ACTIONS.DESIGN_INTAKE &&
    observedPlan?.reason === 'direct_info_request_owns_live_turn' &&
    result.authority?.control_verifier_rejection_count === 0 &&
    result.authority?.control_route_aware_visible_recovery !== true &&
    result.packet?.bubbles?.length === 2,
    JSON.stringify({ observedPlan, authority: result.authority, packet: result.packet }))
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  checked,
  failed: failures.length,
  failures
}, null, 2))
if (failures.length) process.exit(1)
