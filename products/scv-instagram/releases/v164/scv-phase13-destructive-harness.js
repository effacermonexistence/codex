#!/usr/bin/env node

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const {
  POLICY_CONTRACTS,
  assertPolicyContractSemantics
} = require('./scv-policy-contracts.js')
const {
  validateStructuredOutputContract
} = require('./scv-structured-output-contract.js')
const {
  ACTIONS,
  evaluateClosedTransitionContract
} = require('./scv-closed-transition-contract.js')
const {
  runScvDeterministicRecoveryHarness
} = require('./scv-deterministic-recovery-harness.js')
const {
  evaluateToneCorpus,
  readAprilToneFloor
} = require('./scv-april-tone-regression.js')
const {
  verifyArtifactFiles
} = require('./scv-golden-release.js')

const PHASE13_DESTRUCTIVE_HARNESS_VERSION =
  'scv-phase13-destructive-harness-2026-08-25-v6-context-only-clarification'

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function structuredPacket(text, action, options = {}) {
  return {
    reply_text: text,
    acknowledged_fields: options.acknowledged_fields || [],
    questioned_fields: options.questioned_fields || [],
    next_action_reflected: action,
    bubbles: [{ text, delay_ms: 0 }]
  }
}

function phase13PolicyMutant() {
  const mutant = clone(POLICY_CONTRACTS)
  mutant.booking_policy.minimum_lead_days = 6
  try {
    assertPolicyContractSemantics(mutant)
    return { killed: false, reason: 'mutant_not_detected' }
  } catch (error) {
    return {
      killed: /minimum_lead_days/.test(String(error?.message || error)),
      reason: String(error?.message || error)
    }
  }
}

function phase13KnownPlacementMutant() {
  const input = {
    structured_state: {
      tattoo_intent_active: true,
      known_placement_context: 'upper arm'
    },
    control_transition_contract: { action: ACTIONS.TATTOO_CONTINUE }
  }
  const verdict = validateStructuredOutputContract(
    input,
    structuredPacket(
      'where were you thinking of placing it?',
      ACTIONS.TATTOO_CONTINUE,
      { questioned_fields: ['placement'] }
    )
  )
  return {
    killed:
      !verdict.valid &&
      verdict.failures.includes('known_field_reasked:placement'),
    reason: verdict.failures.join(',')
  }
}

function phase13MonthGuessMutant() {
  const input = {
    message: 'How about the 27th?',
    recent_history: [
      {
        role: 'assistant',
        text: 'what date were you thinking?',
        message_id: 'assistant-date-question'
      }
    ],
    structured_state: {
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      live_turn_contextual_booking_reply: true,
      live_turn_date_needs_month: true,
      live_turn_monthless_day_candidate: '27',
      current_message_date_local: 'July 25, 2026',
      minimum_booking_date_local: 'August 1, 2026'
    }
  }
  const plan = {
    action: ACTIONS.POST_FORM_AVAILABILITY,
    reason: 'submitted_form_monthless_day_requires_month_clarification',
    obligations: [],
    fields: {
      monthless_day: '27',
      date_status: 'ambiguous_month',
      proposed_date: '27th'
    }
  }
  const packet = structuredPacket(
    'August 27 works. what time were you thinking?',
    ACTIONS.POST_FORM_AVAILABILITY,
    { acknowledged_fields: ['appointment_date'], questioned_fields: ['appointment_time'] }
  )
  const verdict = evaluateClosedTransitionContract(input, packet, plan)
  return {
    killed:
      !verdict.valid &&
      [
        'closed_transition_monthless_day_requires_month',
        'closed_transition_visible_date_state_authority_missing'
      ].includes(verdict.reason),
    reason: verdict.reason
  }
}

function phase13FalseUnavailabilityMutant() {
  const input = {
    message: '15th of August 2032',
    structured_state: {
      tattoo_intent_active: true,
      form_link_sent: true,
      form_submitted: true,
      current_message_date_local: 'July 25, 2026',
      minimum_booking_date_local: 'August 1, 2026'
    }
  }
  const plan = {
    action: ACTIONS.POST_FORM_TIME,
    reason: 'submitted_form_legal_date_missing_time',
    obligations: [],
    fields: {
      date: '15th of August 2032',
      proposed_date: '15th of August 2032',
      date_status: 'legal',
      date_iso: '2032-08-15',
      close_booking_options: [
        'August 1, 2026 at 2pm',
        'August 2, 2026 at 2pm'
      ]
    }
  }
  const packet = structuredPacket(
    'August 15 is not available since it is not in my close slots. how about August 2?',
    ACTIONS.POST_FORM_TIME,
    { questioned_fields: ['appointment_time'] }
  )
  const verdict = evaluateClosedTransitionContract(input, packet, plan)
  return {
    killed:
      !verdict.valid &&
      verdict.reason === 'closed_transition_legal_date_rejection_forbidden',
    reason: verdict.reason
  }
}

function phase13PromptDriftMutant() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-phase13-prompt-'))
  try {
    const relative = 'lua-dm-master-prompt-v17.txt'
    const source = path.join(__dirname, relative)
    const target = path.join(root, relative)
    fs.copyFileSync(source, target)
    const manifest = {
      artifact: {
        files: {
          [relative]: sha256(fs.readFileSync(target))
        }
      }
    }
    fs.appendFileSync(target, '\nSILENT UNAPPROVED PROMPT MUTATION\n')
    const failures = verifyArtifactFiles(manifest, root)
    return {
      killed: failures.includes(`artifact_hash_mismatch:${relative}`),
      reason: failures.join(',')
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function phase13ToneMutant() {
  const floor = readAprilToneFloor()
  const corpus = Array.from(
    { length: 20 },
    () =>
      'Hey hey! That sounds absolutely amazing and I would be more than happy to help you with that! What has you curious about that today? 😊'
  )
  const verdict = evaluateToneCorpus(corpus, floor)
  return {
    killed:
      !verdict.valid &&
      verdict.checks.some((check) => !check.pass),
    reason: verdict.checks
      .filter((check) => !check.pass)
      .map((check) => check.name)
      .join(',')
  }
}

async function runScvPhase13DestructiveHarness() {
  const tests = []
  const record = (id, name, result) => {
    tests.push({
      id,
      name,
      mutant_killed: result.killed === true,
      detector_receipt: String(result.reason || '')
    })
  }

  record(
    1,
    'change minimum booking lead from seven days to six',
    phase13PolicyMutant()
  )
  record(
    2,
    're-ask placement after placement is already known',
    phase13KnownPlacementMutant()
  )

  const recovery = await runScvDeterministicRecoveryHarness()
  record(3, 'return empty or invalid candidates', {
    killed:
      recovery.ok === true &&
      recovery.model_candidate_calls === 3 &&
      recovery.checks.some(
        (check) =>
          check.name === 'yes_plz_exhausts_bounded_fresh_drafts_then_sends_form_checkpoint' &&
          check.pass === true
      ) &&
      recovery.checks.some(
        (check) =>
          check.name === 'clear_dialogue_exhaustion_stays_on_route_for_outer_reauthor' &&
          check.pass === true
      ) &&
      recovery.checks.some(
        (check) =>
          check.name === 'genuinely_unintelligible_exhaustion_gets_verified_visible_clarification' &&
          check.pass === true
      ),
    reason: JSON.stringify({
      ok: recovery.ok,
      model_candidate_calls: recovery.model_candidate_calls,
      failed: recovery.failed
    })
  })

  record(
    4,
    'guess a month for the ambiguous date 27th',
    phase13MonthGuessMutant()
  )
  record(
    5,
    'treat absence from close slots as unavailable',
    phase13FalseUnavailabilityMutant()
  )
  record(
    6,
    'silently edit the active prompt without a new release',
    phase13PromptDriftMutant()
  )
  record(
    7,
    'drop visible language below the April source-honest tone floor',
    phase13ToneMutant()
  )

  const failed = tests.filter((test) => !test.mutant_killed)
  return {
    ok: failed.length === 0,
    harness_version: PHASE13_DESTRUCTIVE_HARNESS_VERSION,
    required_mutants: 7,
    mutants_killed: tests.length - failed.length,
    mutants_survived: failed.length,
    tests
  }
}

if (require.main === module) {
  runScvPhase13DestructiveHarness()
    .then((receipt) => {
      process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`)
      if (!receipt.ok) process.exit(1)
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error)}\n`)
      process.exit(1)
    })
}

module.exports = {
  PHASE13_DESTRUCTIVE_HARNESS_VERSION,
  runScvPhase13DestructiveHarness
}
