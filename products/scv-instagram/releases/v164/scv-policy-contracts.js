#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const CONTRACT_PATH = path.join(__dirname, 'SCV_POLICY_CONTRACTS.json')

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => key !== 'declared_sha256')
        .map((key) => [key, canonicalize(value[key])])
    )
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function readPolicyContracts(file = CONTRACT_PATH) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const calculated = sha256(canonicalJson(parsed))
  const declared = String(parsed.declared_sha256 || '')
  if (!/^[a-f0-9]{64}$/i.test(declared)) {
    throw new Error('scv_policy_contract_declared_hash_missing')
  }
  if (calculated !== declared) {
    throw new Error(`scv_policy_contract_hash_mismatch:${declared}:${calculated}`)
  }
  return Object.freeze({
    ...parsed,
    calculated_sha256: calculated
  })
}

function assertPolicyContractSemantics(contracts = readPolicyContracts()) {
  const failures = []
  const booking = contracts.booking_policy || {}
  const design = contracts.design_intake_policy || {}
  const progression = contracts.conversation_progression_policy || {}
  const fail = (condition, code) => {
    if (!condition) failures.push(code)
  }

  fail(booking.timezone === 'America/Los_Angeles', 'timezone')
  fail(booking.minimum_lead_days === 7, 'minimum_lead_days')
  fail(booking.maximum_horizon_days === null, 'maximum_horizon_days')
  fail(booking.external_calendar_present === false, 'external_calendar_present')
  fail(booking.availability_source === 'minimum_date_plus_code_slots', 'availability_source')
  fail(design.rules?.includes('placement and exact size are decided in person and are not required booking gates'), 'size_placement_gate')
  fail(progression.macro_convergence === 'human_relationship_continuity', 'macro_convergence')
  fail(progression.micro_convergence === 'tattoo_booking_after_client_tattoo_signal', 'micro_convergence')
  fail(progression.verifier_failure_policy === 'one model reauthor then route bounded deterministic recovery', 'verifier_failure_policy')
  fail(progression.forbidden?.includes('empty reply for valid unsuppressed inbound'), 'empty_reply_forbidden')
  fail(progression.forbidden?.includes('reasking a known field'), 'known_field_reask_forbidden')
  fail(progression.forbidden?.includes('guessing an ambiguous month'), 'ambiguous_month_guess_forbidden')

  if (failures.length) {
    throw new Error(`scv_policy_contract_semantic_failure:${failures.join(',')}`)
  }
  return true
}

const POLICY_CONTRACTS = readPolicyContracts()

module.exports = {
  CONTRACT_PATH,
  POLICY_CONTRACTS,
  POLICY_CONTRACTS_SHA256: POLICY_CONTRACTS.calculated_sha256,
  canonicalize,
  canonicalJson,
  sha256,
  readPolicyContracts,
  assertPolicyContractSemantics
}
