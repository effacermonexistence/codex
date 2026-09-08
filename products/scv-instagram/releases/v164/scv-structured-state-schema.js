#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { canonicalJson } = require(path.join(__dirname, 'scv-policy-contracts.js'))

const STATE_SCHEMA_PATH = path.join(__dirname, 'SCV_STRUCTURED_STATE_SCHEMA.json')

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function readStateSchema(file = STATE_SCHEMA_PATH) {
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'))
  const calculated = sha256(canonicalJson(schema))
  const declared = String(schema.declared_sha256 || '')
  if (!/^[a-f0-9]{64}$/i.test(declared)) {
    throw new Error('scv_structured_state_schema_declared_hash_missing')
  }
  if (calculated !== declared) {
    throw new Error(`scv_structured_state_schema_hash_mismatch:${declared}:${calculated}`)
  }
  return Object.freeze({ ...schema, calculated_sha256: calculated })
}

const STRUCTURED_STATE_SCHEMA = readStateSchema()
const STRUCTURED_STATE_SCHEMA_VERSION = STRUCTURED_STATE_SCHEMA.schema_version
const STRUCTURED_STATE_SCHEMA_SHA256 = STRUCTURED_STATE_SCHEMA.calculated_sha256
const VALID_STAGES = new Set(STRUCTURED_STATE_SCHEMA.properties.booking_stage_hint.enum)

const DEFAULT_NEXT_ACTION_BY_STAGE = Object.freeze({
  open_conversation: 'general_continue',
  design_intake: 'design_intake',
  awaiting_form_permission_answer: 'send_form',
  awaiting_form_submission: 'post_form_availability',
  awaiting_form_submission_for_accepted_slot: 'post_form_identity',
  awaiting_design_direction: 'design_intake',
  awaiting_date: 'post_form_availability',
  awaiting_time: 'post_form_time',
  awaiting_form_identity_match: 'post_form_identity',
  awaiting_name_used_on_form: 'post_form_identity',
  awaiting_phone_used_on_form: 'post_form_identity',
  ready_for_double_check: 'double_check',
  awaiting_double_check_confirmation: 'await_double_check_confirmation',
  deposit_pending: 'deposit_pending_continue',
  deposit_requested: 'deposit_pending_continue'
})

function nextActionForStage(stage) {
  return DEFAULT_NEXT_ACTION_BY_STAGE[String(stage || '')] || 'general_continue'
}

function stampStructuredState(state = {}, { stage, nextAction } = {}) {
  const out = state && typeof state === 'object' && !Array.isArray(state) ? state : {}
  out.structured_state_schema_version = STRUCTURED_STATE_SCHEMA_VERSION
  out.structured_state_schema_sha256 = STRUCTURED_STATE_SCHEMA_SHA256
  if (stage) out.booking_stage_hint = String(stage)
  if (nextAction) out.next_action = String(nextAction)
  if (!String(out.next_action || '').trim()) {
    out.next_action = nextActionForStage(out.booking_stage_hint)
  }
  return out
}

function validateStructuredState(state = {}, { requireIdentity = true } = {}) {
  const failures = []
  const fail = (condition, code) => {
    if (!condition) failures.push(code)
  }
  fail(state && typeof state === 'object' && !Array.isArray(state), 'state_object')
  fail(state.structured_state_schema_version === STRUCTURED_STATE_SCHEMA_VERSION, 'schema_version')
  fail(state.structured_state_schema_sha256 === STRUCTURED_STATE_SCHEMA_SHA256, 'schema_sha256')
  if (requireIdentity) {
    fail(Boolean(String(state.thread_id || '').trim()), 'thread_id')
    fail(Boolean(String(state.contact_id || '').trim()), 'contact_id')
  }
  fail(VALID_STAGES.has(String(state.booking_stage_hint || '')), 'booking_stage_hint')
  fail(Boolean(String(state.next_action || '').trim()), 'next_action')
  for (const field of ['control_revision', 'ingress_revision']) {
    if (state[field] !== undefined) {
      fail(Number.isInteger(Number(state[field])) && Number(state[field]) >= 0, field)
    }
  }
  return {
    valid: failures.length === 0,
    failures,
    schema_version: STRUCTURED_STATE_SCHEMA_VERSION,
    schema_sha256: STRUCTURED_STATE_SCHEMA_SHA256
  }
}

function assertStructuredState(state = {}, options = {}) {
  const verdict = validateStructuredState(state, options)
  if (!verdict.valid) {
    throw new Error(`scv_structured_state_schema_rejected:${verdict.failures.join(',')}`)
  }
  return true
}

module.exports = {
  STATE_SCHEMA_PATH,
  STRUCTURED_STATE_SCHEMA,
  STRUCTURED_STATE_SCHEMA_VERSION,
  STRUCTURED_STATE_SCHEMA_SHA256,
  VALID_STAGES,
  DEFAULT_NEXT_ACTION_BY_STAGE,
  nextActionForStage,
  readStateSchema,
  stampStructuredState,
  validateStructuredState,
  assertStructuredState
}
