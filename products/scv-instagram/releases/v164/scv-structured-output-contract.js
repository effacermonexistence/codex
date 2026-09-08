#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const STRUCTURED_OUTPUT_CONTRACT_VERSION =
  'scv-structured-output-contract-2026-09-03-v3-action-bound-invalidated-checkpoint-reask'
const OUTPUT_SCHEMA_PATH = path.join(__dirname, 'codex-dm-output-schema.json')
const OUTPUT_SCHEMA_SHA256 = crypto
  .createHash('sha256')
  .update(fs.readFileSync(OUTPUT_SCHEMA_PATH))
  .digest('hex')

const CANONICAL_FIELDS = Object.freeze([
  'social_context',
  'tattoo_intent',
  'design_direction',
  'reference_media',
  'placement',
  'size',
  'form_offer',
  'form_link',
  'form_submission',
  'appointment_date',
  'appointment_month',
  'appointment_time',
  'name',
  'phone_number',
  'double_check_confirmation',
  'deposit',
  'price',
  'studio_location',
  'missing_context',
  'human_handoff',
  'double_check_revision_field'
])
const CANONICAL_FIELD_SET = new Set(CANONICAL_FIELDS)
const FIELD_ALIASES = Object.freeze({
  custom: 'design_direction',
  customization: 'design_direction',
  customised: 'design_direction',
  customized: 'design_direction',
  custom_idea: 'design_direction',
  customized_idea: 'design_direction',
  idea: 'design_direction',
  design: 'design_direction',
  reference: 'reference_media',
  image: 'reference_media',
  photo: 'reference_media',
  screenshot: 'reference_media',
  date: 'appointment_date',
  month: 'appointment_month',
  time: 'appointment_time',
  phone: 'phone_number',
  phone_no: 'phone_number',
  form: 'form_offer',
  form_sent: 'form_link',
  form_submitted: 'form_submission',
  confirmation: 'double_check_confirmation'
})

function cleanField(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function normalizeFieldList(value) {
  if (!Array.isArray(value)) return null
  return value.map((entry) => cleanField(entry)).filter(Boolean)
}

function canonicalizeFieldList(value) {
  if (!Array.isArray(value)) return null
  const canonical = []
  const dropped = []
  for (const entry of value) {
    const cleaned = cleanField(entry)
    if (!cleaned) continue
    const resolved = FIELD_ALIASES[cleaned] || cleaned
    if (!CANONICAL_FIELD_SET.has(resolved)) {
      dropped.push(cleaned)
      continue
    }
    if (!canonical.includes(resolved)) canonical.push(resolved)
  }
  return { canonical, dropped }
}

function visibleReplyText(packet = {}) {
  return (Array.isArray(packet.bubbles) ? packet.bubbles : [])
    .map((bubble) => String(bubble?.text || '').trim())
    .filter(Boolean)
    .join('\n')
}

function comparable(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function knownFieldsFromState(state = {}) {
  const known = new Set()
  if (state.tattoo_intent_active === true) known.add('tattoo_intent')
  if (String(state.known_design_context || '').trim()) known.add('design_direction')
  if (state.known_client_anchored_inspiration === true) known.add('design_direction')
  if (
    state.known_reference_media_received === true ||
    state.known_tattoo_reference_media_received === true
  ) known.add('reference_media')
  if (String(state.known_placement_context || '').trim()) known.add('placement')
  if (String(state.known_size_context || '').trim()) known.add('size')
  if (state.form_offer_asked === true) known.add('form_offer')
  if (state.form_link_sent === true) known.add('form_link')
  if (state.form_submitted === true) known.add('form_submission')
  if (
    String(state.known_requested_date || '').trim() ||
    String(state.accepted_offered_date || '').trim()
  ) known.add('appointment_date')
  if (
    String(state.known_requested_time || '').trim() ||
    String(state.accepted_offered_time || '').trim()
  ) known.add('appointment_time')
  if (String(state.known_name_used_on_form || '').trim()) known.add('name')
  if (String(state.known_phone_used_on_form || '').trim()) known.add('phone_number')
  if (state.deposit_requested === true) known.add('deposit')
  return known
}

function expectedNextAction(input = {}, planOverride = null) {
  const plan = planOverride || input.control_transition_contract || {}
  return String(plan.action || input.structured_state?.next_action || '').trim()
}

function validateStructuredOutputContract(input = {}, packet = {}, planOverride = null) {
  const failures = []
  const fail = (condition, code) => {
    if (!condition) failures.push(code)
  }
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  const acknowledged = normalizeFieldList(packet?.acknowledged_fields)
  const questioned = normalizeFieldList(packet?.questioned_fields)
  const visible = visibleReplyText(packet)
  const expectedAction = expectedNextAction(input, planOverride)
  const plan = planOverride || input.control_transition_contract || {}

  fail(packet && typeof packet === 'object' && !Array.isArray(packet), 'packet_object')
  fail(bubbles.length > 0, 'visible_bubbles_required')
  fail(bubbles.every((bubble) => bubble && typeof bubble.text === 'string' && String(bubble.text).trim()), 'bubble_text_required')
  fail(typeof packet.reply_text === 'string' && String(packet.reply_text).trim(), 'reply_text_required')
  fail(comparable(packet.reply_text) === comparable(visible), 'reply_text_visible_mismatch')
  fail(Array.isArray(acknowledged), 'acknowledged_fields_required')
  fail(Array.isArray(questioned), 'questioned_fields_required')
  fail(
    Array.isArray(acknowledged) && acknowledged.every((field) => CANONICAL_FIELD_SET.has(field)),
    'acknowledged_field_unknown'
  )
  fail(
    Array.isArray(questioned) && questioned.every((field) => CANONICAL_FIELD_SET.has(field)),
    'questioned_field_unknown'
  )
  fail(
    Array.isArray(acknowledged) && new Set(acknowledged).size === acknowledged.length,
    'acknowledged_field_duplicate'
  )
  fail(
    Array.isArray(questioned) && new Set(questioned).size === questioned.length,
    'questioned_field_duplicate'
  )
  fail(
    typeof packet.next_action_reflected === 'string' && String(packet.next_action_reflected).trim(),
    'next_action_reflected_required'
  )
  if (expectedAction) {
    fail(String(packet.next_action_reflected || '').trim() === expectedAction, 'next_action_reflected_mismatch')
  }

  const known = knownFieldsFromState(input.structured_state || {})
  // Live 2026-08-27 deadlock: when the controller locks a route whose entire
  // job is to (re)ask a field the state already latched (offer_form after
  // form_offer_asked, post_form_identity after a form claim), every compliant
  // candidate violated either the route or this check and only the canned
  // fallback could ship. The controller's explicit route decision outranks this
  // heuristic for the field the locked action itself owns; every other known
  // field stays protected.
  const ACTION_OWNED_QUESTIONS = {
    offer_form: ['form_offer'],
    clarify_form_permission: ['form_offer'],
    post_form_availability: ['appointment_date'],
    post_form_time: ['appointment_time'],
    post_form_identity: ['name', 'phone_number'],
    accepted_slot_progress: ['name', 'phone_number', 'appointment_time']
  }
  const actionOwned = new Set(ACTION_OWNED_QUESTIONS[expectedAction] || [])
  // 2026-09-02 checkpoint revisions: when the client is changing a field that
  // the state already holds (time, date, name, phone), the route's whole job is
  // to ask which new value to put down. The controller's revision reason (or
  // the recovery plan carrying it) owns those fields; every other known field
  // stays protected.
  const revisionReason = /^double_check_(?:time|date|identity)_revision_unresolved$|^double_check_revision_unclassified_ask_which_field$/
  const planReason = String(plan.reason || '')
  const recoveryPreviousReason = String(plan?.recovery?.previous_reason || '')
  if (revisionReason.test(planReason) || revisionReason.test(recoveryPreviousReason)) {
    for (const field of ['appointment_time', 'appointment_date', 'name', 'phone_number', 'double_check_revision_field']) actionOwned.add(field)
  }
  // Live red-team 2026-09-03 (v143 case 11): after a resolved date revision the
  // route legitimately re-asks a booking field the state still latches (the
  // time under the new date), and this heuristic rejected every compliant
  // candidate and the recovery packet ("known_field_reasked:appointment_time")
  // until only the generic ask could ship. A live-turn checkpoint invalidation
  // or a superseded checkpoint is the controller's explicit statement that the
  // latched booking fields are open again: the locked post-form route owns them.
  const state = input.structured_state || {}
  if (
    (state.live_turn_checkpoint_invalidated === true || state.checkpoint_superseded_by_revision === true) &&
    /^(?:post_form_availability|post_form_time|post_form_identity|accepted_slot_progress)$/.test(expectedAction)
  ) {
    for (const field of ['appointment_time', 'appointment_date', 'name', 'phone_number']) actionOwned.add(field)
  }
  if (Array.isArray(questioned)) {
    for (const field of questioned) {
      if (known.has(field) && !actionOwned.has(field)) failures.push(`known_field_reasked:${field}`)
    }
  }

  return {
    valid: failures.length === 0,
    reason: failures[0] || 'structured_output_valid',
    failures,
    contract_version: STRUCTURED_OUTPUT_CONTRACT_VERSION,
    output_schema_sha256: OUTPUT_SCHEMA_SHA256,
    expected_next_action: expectedAction,
    known_fields: [...known].sort()
  }
}

function decorateDeterministicPacket(input = {}, packet = {}, options = {}) {
  const nextAction = String(
    options.nextAction ||
    expectedNextAction(input, options.plan) ||
    'human_handoff'
  )
  const acknowledged = Array.isArray(options.acknowledgedFields)
    ? [...new Set(options.acknowledgedFields.map((entry) => cleanField(entry)).filter(Boolean))]
    : []
  const questioned = Array.isArray(options.questionedFields)
    ? [...new Set(options.questionedFields.map((entry) => cleanField(entry)).filter(Boolean))]
    : []
  return {
    ...packet,
    reply_text: visibleReplyText(packet),
    acknowledged_fields: acknowledged,
    questioned_fields: questioned,
    next_action_reflected: nextAction
  }
}

function structuredOutputPromptContract(input = {}) {
  const known = [...knownFieldsFromState(input.structured_state || {})].sort()
  const action = expectedNextAction(input)
  return [
    'STRUCTURED OUTPUT HARD CONTRACT',
    `- Required next_action_reflected: ${action || 'general_continue'}`,
    `- Known fields that must not be questioned again: ${known.length ? known.join(', ') : 'none'}`,
    '- Output one JSON object with exactly these top-level fields: reply_text, acknowledged_fields, questioned_fields, next_action_reflected, bubbles.',
    '- reply_text must equal the visible bubbles joined in order with newline separators.',
    `- acknowledged_fields and questioned_fields may use only: ${CANONICAL_FIELDS.join(', ')}.`,
    '- questioned_fields must list every information field directly requested in the visible reply.',
    '- Do not list a known field in questioned_fields.',
    '- next_action_reflected is metadata only. Never print it inside visible DM text.',
    '- A schema-invalid or empty candidate is rejected before Instagram delivery.'
  ].join('\n')
}

module.exports = {
  STRUCTURED_OUTPUT_CONTRACT_VERSION,
  OUTPUT_SCHEMA_PATH,
  OUTPUT_SCHEMA_SHA256,
  CANONICAL_FIELDS,
  FIELD_ALIASES,
  visibleReplyText,
  normalizeFieldList,
  canonicalizeFieldList,
  knownFieldsFromState,
  expectedNextAction,
  validateStructuredOutputContract,
  decorateDeterministicPacket,
  structuredOutputPromptContract
}
