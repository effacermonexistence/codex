#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const {
  POLICY_CONTRACTS,
  POLICY_CONTRACTS_SHA256,
  assertPolicyContractSemantics
} = require('./scv-policy-contracts.js')
const {
  STRUCTURED_STATE_SCHEMA,
  STRUCTURED_STATE_SCHEMA_SHA256,
  VALID_STAGES,
  DEFAULT_NEXT_ACTION_BY_STAGE,
  stampStructuredState,
  validateStructuredState
} = require('./scv-structured-state-schema.js')
const {
  SCV_CLOCK_VERSION,
  fixedClock,
  resolveClockDate
} = require('./scv-clock.js')
const booking = require('./scv-booking-policy.js')
const {
  validateStructuredOutputContract,
  STRUCTURED_OUTPUT_CONTRACT_VERSION
} = require('./scv-structured-output-contract.js')
const {
  DEFAULT_CONTROL_REAUTHOR_PASSES,
  MAX_CONTROL_REAUTHOR_PASSES,
  deriveBookingStage
} = require('./scv-single-control-plane.js')

const HARDENED_CONTRACT_HARNESS_VERSION =
  'scv-hardened-contract-harness-2026-08-25-v2-two-bounded-reauthors'

function runScvHardenedContractHarness() {
  const checks = []
  const check = (name, condition, detail = '') => {
    checks.push({ name, pass: Boolean(condition), detail: String(detail || '') })
  }

  let policySemantics = ''
  try {
    assertPolicyContractSemantics(POLICY_CONTRACTS)
  } catch (error) {
    policySemantics = String(error?.message || error)
  }
  check('policy_contract_hash_is_valid', /^[a-f0-9]{64}$/.test(POLICY_CONTRACTS_SHA256), POLICY_CONTRACTS_SHA256)
  check('policy_contract_semantics_are_valid', !policySemantics, policySemantics)
  check('booking_minimum_is_exactly_seven_days', booking.MINIMUM_LEAD_DAYS === 7, booking.MINIMUM_LEAD_DAYS)
  check('booking_maximum_horizon_is_unbounded', booking.MAXIMUM_HORIZON_DAYS === null, booking.MAXIMUM_HORIZON_DAYS)
  check(
    'booking_contract_has_no_external_calendar',
    POLICY_CONTRACTS.booking_policy.external_calendar_present === false &&
      POLICY_CONTRACTS.booking_policy.availability_source === 'minimum_date_plus_code_slots',
    JSON.stringify(POLICY_CONTRACTS.booking_policy)
  )

  const fixed = fixedClock('2026-07-25T12:00:00-07:00')
  const productionPathSnapshot = booking.buildBookingPolicySnapshot({ clock: fixed })
  const explicitPathSnapshot = booking.buildBookingPolicySnapshot({
    referenceTime: resolveClockDate({ clock: fixed })
  })
  check(
    'prod_and_test_clock_use_same_resolution_path',
    productionPathSnapshot.current_message_date_iso === explicitPathSnapshot.current_message_date_iso &&
      productionPathSnapshot.minimum_booking_date_iso === explicitPathSnapshot.minimum_booking_date_iso &&
      productionPathSnapshot.booking_policy_fingerprint === explicitPathSnapshot.booking_policy_fingerprint,
    JSON.stringify({ productionPathSnapshot, explicitPathSnapshot })
  )
  check('clock_module_is_versioned', /single-prod-test-path/.test(SCV_CLOCK_VERSION), SCV_CLOCK_VERSION)
  check(
    'seven_day_floor_calculates_in_los_angeles',
    productionPathSnapshot.current_message_date_iso === '2026-07-25' &&
      productionPathSnapshot.minimum_booking_date_iso === '2026-08-01',
    JSON.stringify(productionPathSnapshot)
  )

  const tooSoon = booking.classifyBookingDateText('July 31', { clock: fixed })
  const legalAtFloor = booking.classifyBookingDateText('August 1', { clock: fixed })
  const legalFarFuture = booking.classifyBookingDateText('15th of August 2032', { clock: fixed })
  const ambiguous = booking.classifyBookingDateText('How about the 27th?', {
    clock: fixed,
    allowAmbiguousDay: true
  })
  check('date_before_floor_is_too_soon', tooSoon.status === 'too_soon', JSON.stringify(tooSoon))
  check('date_at_floor_is_legal', legalAtFloor.status === 'legal', JSON.stringify(legalAtFloor))
  check(
    'far_future_date_is_legal_without_maximum',
    legalFarFuture.status === 'legal' && legalFarFuture.date_iso === '2032-08-15',
    JSON.stringify(legalFarFuture)
  )
  check(
    'monthless_ordinal_requires_clarification',
    ambiguous.status === 'ambiguous_month' && ambiguous.day === 27,
    JSON.stringify(ambiguous)
  )
  check(
    'close_slot_absence_is_not_unavailability',
    legalFarFuture.availability === 'available' &&
      legalFarFuture.availability_source === 'unbounded_legal_date_policy' &&
      !productionPathSnapshot.close_booking_options_local.some((item) => /2032/i.test(item)),
    JSON.stringify({ legalFarFuture, close: productionPathSnapshot.close_booking_options_local })
  )

  const policyStages = new Set(POLICY_CONTRACTS.conversation_progression_policy.stages)
  const schemaStages = new Set(STRUCTURED_STATE_SCHEMA.properties.booking_stage_hint.enum)
  check(
    'policy_and_state_schema_stage_sets_match',
    policyStages.size === schemaStages.size &&
      [...policyStages].every((stage) => schemaStages.has(stage)) &&
      [...schemaStages].every((stage) => policyStages.has(stage)),
    JSON.stringify({ policy: [...policyStages], schema: [...schemaStages] })
  )
  const policyActions = new Set(POLICY_CONTRACTS.conversation_progression_policy.actions)
  check(
    'every_stage_default_action_is_contract_authorized',
    Object.values(DEFAULT_NEXT_ACTION_BY_STAGE).every((action) => policyActions.has(action)),
    JSON.stringify(DEFAULT_NEXT_ACTION_BY_STAGE)
  )
  check(
    'state_schema_hash_is_valid',
    /^[a-f0-9]{64}$/.test(STRUCTURED_STATE_SCHEMA_SHA256) &&
      STRUCTURED_STATE_SCHEMA_SHA256 === STRUCTURED_STATE_SCHEMA.calculated_sha256,
    STRUCTURED_STATE_SCHEMA_SHA256
  )
  check(
    'state_schema_stage_set_is_loaded',
    VALID_STAGES.size === schemaStages.size,
    JSON.stringify([...VALID_STAGES])
  )

  const stamped = stampStructuredState({
    thread_id: 'hardened-contract-thread',
    contact_id: 'hardened-contract-contact',
    control_revision: 0,
    ingress_revision: 0
  }, {
    stage: 'open_conversation',
    nextAction: 'general_continue'
  })
  const stampedVerdict = validateStructuredState(stamped)
  check('persistent_state_shape_is_schema_valid', stampedVerdict.valid, JSON.stringify(stampedVerdict))

  const readyForDoubleCheck = deriveBookingStage(stampStructuredState({
    thread_id: 'hardened-contract-thread',
    contact_id: 'hardened-contract-contact',
    tattoo_intent_active: true,
    form_offer_asked: true,
    form_link_sent: true,
    form_submitted: true,
    known_name_used_on_form: 'Omar Test',
    known_phone_used_on_form: '4155550111',
    known_requested_date: 'August 15, 2026',
    known_requested_time: '2pm',
    double_check_sent: false
  }, {
    stage: 'ready_for_double_check',
    nextAction: 'double_check'
  }))
  check('four_fields_route_to_single_double_check', readyForDoubleCheck === 'ready_for_double_check', readyForDoubleCheck)

  const awaitingConfirmation = deriveBookingStage(stampStructuredState({
    thread_id: 'hardened-contract-thread',
    contact_id: 'hardened-contract-contact',
    tattoo_intent_active: true,
    form_offer_asked: true,
    form_link_sent: true,
    form_submitted: true,
    known_name_used_on_form: 'Omar Test',
    known_phone_used_on_form: '4155550111',
    known_requested_date: 'August 15, 2026',
    known_requested_time: '2pm',
    double_check_sent: true
  }, {
    stage: 'awaiting_double_check_confirmation',
    nextAction: 'await_double_check_confirmation'
  }))
  check(
    'sent_double_check_routes_to_confirmation_not_reask',
    awaitingConfirmation === 'awaiting_double_check_confirmation',
    awaitingConfirmation
  )

  const knownPlacementInput = {
    structured_output_required: true,
    structured_state: { known_placement_context: 'upper arm' },
    control_transition_contract: { action: 'tattoo_continue' }
  }
  const reaskVerdict = validateStructuredOutputContract(knownPlacementInput, {
    reply_text: 'where on your body were you thinking?',
    acknowledged_fields: [],
    questioned_fields: ['placement'],
    next_action_reflected: 'tattoo_continue',
    bubbles: [{ text: 'where on your body were you thinking?', delay_ms: 0 }]
  })
  check(
    'known_placement_reask_is_rejected',
    !reaskVerdict.valid && reaskVerdict.failures.includes('known_field_reasked:placement'),
    JSON.stringify(reaskVerdict)
  )

  const emptyVerdict = validateStructuredOutputContract({
    structured_state: {},
    control_transition_contract: { action: 'general_continue' }
  }, {
    reply_text: '',
    acknowledged_fields: [],
    questioned_fields: [],
    next_action_reflected: 'general_continue',
    bubbles: []
  })
  check(
    'empty_visible_reply_is_rejected',
    !emptyVerdict.valid &&
      emptyVerdict.failures.includes('visible_bubbles_required') &&
      emptyVerdict.failures.includes('reply_text_required'),
    JSON.stringify(emptyVerdict)
  )
  check(
    'structured_output_contract_is_action_bound',
    /action-bound/.test(STRUCTURED_OUTPUT_CONTRACT_VERSION),
    STRUCTURED_OUTPUT_CONTRACT_VERSION
  )
  check(
    'model_reauthor_budget_is_exactly_two_reauthors',
    DEFAULT_CONTROL_REAUTHOR_PASSES === 3 && MAX_CONTROL_REAUTHOR_PASSES === 3,
    JSON.stringify({ DEFAULT_CONTROL_REAUTHOR_PASSES, MAX_CONTROL_REAUTHOR_PASSES })
  )

  const runtimeSource = fs.readFileSync(path.join(__dirname, 'scv-booking-policy.js'), 'utf8')
  check(
    'booking_policy_has_no_external_calendar_adapter',
    !/(google\s*calendar|calendly|acuity|calendar\s*api)/i.test(runtimeSource),
    'scv-booking-policy.js'
  )

  const failed = checks.filter((item) => !item.pass)
  return {
    ok: failed.length === 0,
    harness_version: HARDENED_CONTRACT_HARNESS_VERSION,
    checked: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    policy_contract_sha256: POLICY_CONTRACTS_SHA256,
    structured_state_schema_sha256: STRUCTURED_STATE_SCHEMA_SHA256,
    checks
  }
}

if (require.main === module) {
  const receipt = runScvHardenedContractHarness()
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
  if (!receipt.ok) process.exit(1)
}

module.exports = {
  HARDENED_CONTRACT_HARNESS_VERSION,
  runScvHardenedContractHarness
}
