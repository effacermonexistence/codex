#!/usr/bin/env node
// ============================================================
// SCV SINGLE CONTROL PLANE
//
// One authoritative path owns conversation state, funnel stage, output adoption,
// and control receipts. Inbound / recovery / delivery processes may transport or
// append observations only; they may not invent or overwrite semantic state.
// ============================================================
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const {
  DURABLE_TRUE_FIELDS,
  DURABLE_STRING_FIELDS,
  applyDurableStructuredState,
  extractDurableStructuredState
} = require(path.join(__dirname, 'scv-durable-structured-state.js'))
const {
  evaluateScvContractHarness,
  liveHasConcreteDesignDirection,
  storedDesignContextIsDesign,
  packetStatesModelRate,
  modelRateAlreadyDisclosed,
  knownTattooReferenceMediaReceived,
  clientAnchoredInspirationReference,
  textNominatesNamedObjectAsReference,
  hasTattooIntentSignal,
  liveArtistBiographyQuestion,
  liveAcceptsOfferedBookingSlot,
  classifyReferenceMediaDescription,
  packetHasNamePhoneDateTimeDoubleCheck
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
  ACTIONS: CLOSED_TRANSITION_ACTIONS,
  deriveClosedTransitionPlan,
  deriveVerifierRebasePlan,
  evaluateClosedTransitionContract,
  evaluateClosedTransitionLivenessFloor,
  buildClosedTransitionRepairLock
} = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const {
  applyDiscourseClassification
} = require(path.join(__dirname, 'scv-discourse-continuity.js'))
const {
  SCV_BOOKING_POLICY_VERSION,
  BOOKING_POLICY_FINGERPRINT,
  buildBookingPolicySnapshot,
  calendarBookingProposalFrame,
  clockTimeBookingProposalFrame,
  classifyBookingDateText,
  classifyBookingClockTimeText,
  bookingDayConstraintPreference,
  MINIMUM_BOOKING_TIME_LABEL
} = require(path.join(__dirname, 'scv-booking-policy.js'))
const {
  STRUCTURED_STATE_SCHEMA_VERSION,
  STRUCTURED_STATE_SCHEMA_SHA256,
  nextActionForStage,
  stampStructuredState,
  assertStructuredState
} = require(path.join(__dirname, 'scv-structured-state-schema.js'))
const {
  immutableIngressTimeMs
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))
const {
  ACCEPTED_UNVERIFIED_BOUNDARY_SEMANTICS,
  ACCEPTED_UNVERIFIED_BOUNDARY_SCHEMA,
  ACCEPTED_UNVERIFIED_BOUNDARY_REASON,
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))
const {
  SCV_OPENAI_CONVERSATION_VERSION,
  SCV_RESPONSES_CONVERGENCE_BASELINE,
  validResponseId
} = require(path.join(__dirname, 'scv-openai-conversation.js'))
const {
  extractBookingPhone,
  extractBookingNameNextToPhone,
  extractExplicitFourFieldBookingPayload,
  extractVisibleAssistantDoubleCheckFields,
  extractLabeledBookingFields,
  sanitizeBookingIdentityName,
  textFramesThirdPartyBookingIdentity
} = require(path.join(__dirname, 'scv-booking-identity.js'))
const {
  DETERMINISTIC_RECOVERY_VERSION,
  SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES,
  ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
  buildDeterministicRecoveryPacket,
  isDoubleCheckRevisionReason,
  buildSafeClarificationRecoveryPacket,
  buildRouteAwareVisibleRecoveryPacket,
  isSafeClarificationRecoveryPacket,
  isRouteAwareVisibleRecoveryPacket,
  isSendFormRecoveryPacket
} = require(path.join(__dirname, 'scv-deterministic-recovery.js'))
const {
  validateStructuredOutputContract,
  decorateDeterministicPacket
} = require(path.join(__dirname, 'scv-structured-output-contract.js'))
const {
  genericInfoFastPathAdmitsPlan,
  candidateIsGenericInfoFastPath
} = require(path.join(__dirname, 'scv-generic-info-fast-path.js'))

const SCV_SINGLE_CONTROL_PLANE_ID = 'scv-single-control-plane-2026-07-12-v3-route-frozen-liveness'
const SCV_SINGLE_CONTROL_SOURCE = 'scv_single_control_plane'
const SCV_CONTROL_EPOCH = 'scv-control-epoch-2026-07-12-v3-route-frozen-liveness'
const CONTROL_RECEIPT_VERSION = 'scv-control-receipt-v2-payload-bound'
const CONTROL_LOCK_STALE_MS = 30 * 1000
const CONTROL_LOCK_WAIT_MS = 10
const CONTROL_LOCK_MAX_WAIT_MS = 5 * 1000
// The visible-reply runner owns exactly one model re-author followed by bounded
// deterministic recovery. The outer controller gets at most one additional pass,
// solely for a typed route rebase after newly resolved authority evidence.
// Accuracy is the deployment priority. Two total model attempts still produced
// sampled no-reply outcomes when both candidates missed the same closed-route
// obligation. Allow one additional bounded reauthor before handing the event to
// the slower inbox retry lifecycle; this remains finite and route-frozen.
const DEFAULT_CONTROL_REAUTHOR_PASSES = 3
const MAX_CONTROL_REAUTHOR_PASSES = 3
const CONTROL_REPAIR_LEDGER_LIMIT = 12
const CONTROL_REPAIR_LOOP_VERSION = 'scv-verifier-feedback-loop-2026-07-25-v1'
const ACCEPTED_UNVERIFIED_DELIVERY_RECEIPTS_MAX_BYTES = 64 * 1024 * 1024
const ACCEPTED_UNVERIFIED_PROVIDER_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
const LEGACY_ACCEPTED_UNVERIFIED_PENDING_SCHEMA =
  'scv-accepted-unverified-boundary-pending-2026-08-22-v1'
const ACCEPTED_UNVERIFIED_PENDING_SCHEMA =
  'scv-accepted-unverified-boundary-pending-2026-08-22-v2-message-correlation'
const DELIVERY_PUBLICATION_SCHEMA =
  'scv-accepted-unverified-delivery-publication-2026-08-22-v1'
const AUTHENTICATED_INGRESS_SOURCES = new Set([
  'shared_secret',
  'provider_verified_legacy_manychat'
])

const TRANSPORT_STATE_FIELDS = [
  'contact_id',
  'thread_id',
  'message_id',
  'message_id_authority',
  'message_id_retry_window_ms',
  'instagram_username',
  'text',
  'text_source',
  'media_type',
  'manychat_tags',
  'recovered_via',
  'recovered_from_ig_last_interaction',
  'recovered_from_last_seen',
  'recovered_from_message_id',
  'recovered_from_at',
  'source_interaction_at',
  'manychat_latest_interaction_at',
  'operator_recovery',
  'operator_recovery_lock_version',
  'automation_suppressed',
  'automation_suppressed_tag',
  'automation_suppressed_reason',
  'raw_body_sha256',
  'received_at'
]

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function safeThreadKey(threadId) {
  return String(threadId || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function compactRepairText(value, maxLength = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function normalizeControlRepairEntry(entry = {}) {
  const reason = compactRepairText(entry.reason || 'unknown_verifier_rejection', 240)
  return {
    pass: Math.max(0, Number(entry.pass) || 0),
    cycle: Math.max(0, Number(entry.cycle) || 0),
    phase: compactRepairText(entry.phase || 'verifier', 80),
    reason,
    instruction: compactRepairText(entry.instruction || '', 1200),
    route_action: compactRepairText(entry.route_action || '', 80),
    candidate_sha256: /^[a-f0-9]{64}$/i.test(String(entry.candidate_sha256 || ''))
      ? String(entry.candidate_sha256)
      : '',
    repeated_candidate: entry.repeated_candidate === true
  }
}

function controlRepairLedgerFromMessage(msg = {}) {
  const raw = Array.isArray(msg.control_repair_ledger) ? msg.control_repair_ledger : []
  return raw
    .map((entry) => normalizeControlRepairEntry(entry))
    .filter((entry) => entry.reason)
    .slice(-CONTROL_REPAIR_LEDGER_LIMIT)
}

function appendControlRepairEntry(ledger, entry) {
  ledger.push(normalizeControlRepairEntry(entry))
  if (ledger.length > CONTROL_REPAIR_LEDGER_LIMIT) {
    ledger.splice(0, ledger.length - CONTROL_REPAIR_LEDGER_LIMIT)
  }
}

function parseCandidateVerifierFailure(errorText) {
  const text = String(errorText || '')
  const mutationMatch = text.match(/non_authoring_surface_mutations=(\[[^\]\r\n]{2,800}\])/i)
  let nonAuthoringMutations = []
  if (mutationMatch) {
    try {
      const parsed = JSON.parse(mutationMatch[1])
      if (Array.isArray(parsed)) {
        nonAuthoringMutations = parsed
          .map((value) => compactRepairText(value, 120))
          .filter(Boolean)
          .slice(0, 12)
      }
    } catch {}
  }
  const patterns = [
    {
      phase: 'post_filter_route_rebase',
      route_rebase_required: true,
      re: /post_filter_route_rebase_required_([a-z0-9_]+)/i
    },
    {
      phase: 'semantic_route_rebase',
      route_rebase_required: true,
      re: /semantic_route_rebase_required_([a-z0-9_]+)/i
    },
    {
      phase: 'post_filter_adoption',
      route_rebase_required: false,
      re: /post_filter_adoption_rejected_([a-z0-9_]+)/i
    },
    {
      phase: 'semantic_contract',
      route_rebase_required: false,
      re: /semantic_contract_unresolved_no_visible_reply_([a-z0-9_]+)/i
    },
    {
      phase: 'semantic_contract',
      route_rebase_required: false,
      re: /scv_contract_harness_locked_violation_([a-z0-9_]+)/i
    },
    {
      phase: 'outer_final_verifier',
      route_rebase_required: false,
      re: /single_control_(?:internal_retryable:)?final_verifier_rejected:(?:semantic|transition):([a-z0-9_]+)/i
    }
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern.re)
    if (!match) continue
    return {
      valid: false,
      phase: pattern.phase,
      reason: String(match[1] || 'unknown_verifier_rejection'),
      route_rebase_required: pattern.route_rebase_required,
      instruction: [
        nonAuthoringMutations.length
          ? `Exact deterministic mutations: ${nonAuthoringMutations.join(', ')}.`
          : '',
        // 2026-08-26 livelock: the opaque mutation label alone did not change the
        // model's next candidate, so the same filter deletion recurred every
        // cycle. Spell out the deterministic policy consequence in prose.
        nonAuthoringMutations.includes('size_or_placement_question_violation')
          ? 'Policy deleted your size/placement question. Never ask about size or placement in any sentence; if it comes up, state that sizing and placement get dialed in at the consult. Put the customization open door in its own statement sentence with no question attached.'
          : '',
        'Re-author against this exact verifier reason. Preserve the locked route and facts, remove the rejected semantic behavior, and submit a materially new candidate for full verification.'
      ].filter(Boolean).join(' ')
    }
  }
  return null
}

// v154 (live 2026-09-06 01:24Z, Omar.system): the same 91-character line answered two
// consecutive client turns. A client-visible line that this thread already heard is not an
// answer, whoever authored it: the candidate is rejected with a repair instruction so the
// model says it differently. Only the conversational lanes are gated. Booking-state
// structures (checkpoint block, form link, deposit handoff/hold, form-permission
// clarification, post-form date/time/identity asks) legitimately re-ask the same required
// field after a non-answer — a third party's phone number, an unrelated remark — so they
// are exempt; the deterministic recovery builders rotate their own variants against
// recent assistant lines, so recovery candidates are not gated here either.
const REPEAT_GATE_MIN_CHARS = 20
const REPEAT_GATED_ACTIONS = new Set([
  CLOSED_TRANSITION_ACTIONS.DESIGN_INTAKE,
  CLOSED_TRANSITION_ACTIONS.TATTOO_CONTINUE,
  CLOSED_TRANSITION_ACTIONS.SOCIAL_CONTINUE,
  CLOSED_TRANSITION_ACTIONS.GENERAL_CONTINUE,
  CLOSED_TRANSITION_ACTIONS.BUDGET_OBJECTION_HOLD,
  CLOSED_TRANSITION_ACTIONS.RESOLVE_CONTEXT,
  CLOSED_TRANSITION_ACTIONS.OFFER_FORM,
  CLOSED_TRANSITION_ACTIONS.KEEP_CONSULTATION_IN_DM,
  CLOSED_TRANSITION_ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION
])
function comparableVisibleLine(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}$@#]+/gu, ' ')
    .trim()
}
function repeatedVisibleLineVerdict(packet, history, plan) {
  const action = String(plan?.action || '')
  if (!REPEAT_GATED_ACTIONS.has(action)) return { valid: true, reason: '', instruction: '' }
  const seen = new Set()
  for (const event of (Array.isArray(history) ? history : []).slice(-40)) {
    const role = String(event?.role || event?.sender || event?.actor || '').trim().toLowerCase()
    if (!['assistant', 'lua', 'artist', 'bot', 'business'].includes(role)) continue
    if (String(event?.delivery_status || '').toLowerCase() === 'failed') continue
    const text = comparableVisibleLine(event?.text || event?.message || event?.content || (event?.bubble || {}).text)
    if (text.length >= REPEAT_GATE_MIN_CHARS) seen.add(text)
  }
  if (!seen.size) return { valid: true, reason: '', instruction: '' }
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  const repeated = bubbles
    .map((bubble) => comparableVisibleLine(bubble?.text))
    .filter((text) => text.length >= REPEAT_GATE_MIN_CHARS && seen.has(text))
  if (!repeated.length) return { valid: true, reason: '', instruction: '' }
  return {
    valid: false,
    reason: 'visible_line_repeats_previous_assistant_line',
    instruction: 'This exact line was already sent to this client earlier in the thread. Never repeat a sentence they already received: answer the live turn again in fresh words with the same facts, or move the conversation forward instead of restating.'
  }
}

function candidatePacketSha256(candidate) {
  const bubbles = Array.isArray(candidate?.packet?.bubbles)
    ? candidate.packet.bubbles.map((bubble) => ({
        text: normalizeText(bubble?.text),
        delay_ms: Math.max(0, Number(bubble?.delay_ms || 0))
      }))
    : []
  return sha256(JSON.stringify(bubbles))
}

function independentCandidateLivenessVerdict(verificationInput, candidate, semanticVerdict) {
  // Lazy loading avoids adding runner/provider initialization to the control
  // plane startup path.  The verifier itself is pure and independently reruns
  // visibility, language, structured output, mutation/consent, semantic reason,
  // and closed-transition route checks over the packet seen here.
  const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
  const receiptSoftReason = String(candidate?.authority?.liveness_soft_reason || '').trim()
  const rejectedVerdict = !semanticVerdict?.valid
    ? semanticVerdict
    : { reason: receiptSoftReason }
  return runner.candidateLivenessAdoptionVerdict(
    {
      ...verificationInput,
      // Production authority packets are always schema-constrained.  Recompute
      // that policy here instead of trusting a child receipt or a caller-owned
      // verification object to preserve the flag across the process boundary.
      structured_output_required: true
    },
    candidate?.packet,
    rejectedVerdict
  )
}

function candidateIsSafeClarificationRecovery(candidate) {
  return Boolean(
    candidate?.authority?.deterministic_recovery === true &&
    candidate?.authority?.deterministic_recovery_kind === 'safe_clarification' &&
    candidate?.authority?.executor === 'deterministic_safe_clarification_after_model_exhaustion' &&
    isSafeClarificationRecoveryPacket(candidate?.packet)
  )
}

function candidateIsRouteAwareVisibleRecovery(candidate, input, originalPlan) {
  return Boolean(
    candidate?.authority?.deterministic_recovery === true &&
    candidate?.authority?.deterministic_recovery_kind === 'route_aware_visible' &&
    candidate?.authority?.executor === 'deterministic_route_aware_visible_after_failure_exhaustion' &&
    candidate?.authority?.deterministic_recovery_version === ROUTE_AWARE_VISIBLE_RECOVERY_VERSION &&
    isRouteAwareVisibleRecoveryPacket(candidate?.packet, input, originalPlan)
  )
}

function candidateIsSendFormCheckpointRecovery(candidate) {
  const authorityCount = Number(candidate?.authority?.model_candidate_count || 0)
  const packetCount = Number(candidate?.packet?.authority_transport_flags?.model_candidate_count || 0)
  return Boolean(
    candidate?.authority?.deterministic_recovery === true &&
    candidate?.authority?.deterministic_recovery_kind === 'send_form_checkpoint' &&
    candidate?.authority?.executor === 'deterministic_send_form_checkpoint_after_model_exhaustion' &&
    authorityCount === SEND_FORM_RECOVERY_MIN_MODEL_CANDIDATES &&
    packetCount === authorityCount &&
    candidate?.authority?.deterministic_recovery_version === DETERMINISTIC_RECOVERY_VERSION &&
    isSendFormRecoveryPacket(candidate?.packet)
  )
}

function safeClarificationRecoveryPlan(state = {}, previousPlan = null) {
  return {
    version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
    action: CLOSED_TRANSITION_ACTIONS.RESOLVE_CONTEXT,
    reason: 'unintelligible',
    obligations: [],
    stage: String(state.booking_stage_hint || previousPlan?.stage || 'open_conversation'),
    fields: {},
    live_intent: {},
    recovery: {
      source: 'bounded_model_adoption_exhaustion',
      previous_action: String(previousPlan?.action || ''),
      previous_reason: String(previousPlan?.reason || '')
    }
  }
}

function safeClarificationRecoveryVerdict(candidate) {
  const valid = candidateIsSafeClarificationRecovery(candidate)
  return {
    valid,
    reason: valid
      ? 'safe_nontransactional_clarification_recovery_valid'
      : 'safe_nontransactional_clarification_recovery_invalid',
    failures: valid ? [] : ['exact_safe_clarification_packet_required'],
    instruction: valid ? '' : 'Use the exact bounded safe clarification packet.',
    lock_version: CONTROL_REPAIR_LOOP_VERSION
  }
}

function routeAwareVisibleRecoveryPlan(state = {}, previousPlan = null) {
  return {
    version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
    action: CLOSED_TRANSITION_ACTIONS.RESOLVE_CONTEXT,
    reason: 'verifier_exhausted_route_recovery',
    obligations: [],
    stage: String(state.booking_stage_hint || previousPlan?.stage || 'open_conversation'),
    fields: {},
    live_intent: {},
    recovery: {
      source: 'bounded_internal_or_unclassified_failure_exhaustion',
      previous_action: String(previousPlan?.action || ''),
      previous_reason: String(previousPlan?.reason || '')
    }
  }
}

function routeAwareVisibleRecoveryVerdict(candidate, input, originalPlan) {
  const valid = candidateIsRouteAwareVisibleRecovery(candidate, input, originalPlan)
  return {
    valid,
    reason: valid
      ? 'route_aware_nontransactional_visible_recovery_valid'
      : 'route_aware_nontransactional_visible_recovery_invalid',
    failures: valid ? [] : ['exact_route_aware_visible_recovery_packet_required'],
    instruction: valid ? '' : 'Use the exact bounded route-aware nontransactional recovery packet.',
    lock_version: CONTROL_REPAIR_LOOP_VERSION
  }
}

function buildCumulativeControlRepairLock(plan, ledger) {
  const entries = Array.isArray(ledger) ? ledger.slice(-CONTROL_REPAIR_LEDGER_LIMIT) : []
  if (!entries.length) return ''

  const latest = entries[entries.length - 1]
  const unique = []
  const seen = new Set()
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const key = `${entry.phase}:${entry.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.unshift(entry)
  }

  const lines = [
    'CONTROLLER VERIFIER FEEDBACK LOOP',
    `- Loop version: ${CONTROL_REPAIR_LOOP_VERSION}.`,
    '- Every candidate listed below was rejected and is forbidden from adoption.',
    '- Re-evaluate the locked semantic action against the same authoritative inbound, then generate a materially corrected candidate.',
    '- Do not merely paraphrase a rejected semantic move. Correct the verifier failure itself.',
    '- The corrected candidate must pass the semantic verifier and the closed-transition verifier before it can be committed.'
  ]
  for (const entry of unique.slice(-6)) {
    lines.push(`- Rejected at ${entry.phase}: ${entry.reason}.`)
    if (entry.instruction) lines.push(`- Verifier requirement: ${entry.instruction}`)
  }
  if (latest.repeated_candidate) {
    lines.push('- The last output repeated a previously rejected candidate. Change the semantic move as well as the wording.')
  }
  lines.push(buildClosedTransitionRepairLock(plan, {
    valid: false,
    reason: latest.reason,
    instruction: latest.instruction
  }))
  return lines.filter(Boolean).join('\n')
}

function buildControlVerifierRetryError(msg, lastReason, transitionPlan, rejectionLedger) {
  const retryCycle = Math.max(0, Number(msg?.control_repair_cycle) || 0) + 1
  const error = new Error(`single_control_internal_retryable:final_verifier_rejected:${lastReason}`)
  error.code = 'SCV_CONTROL_VERIFIER_RETRY_REQUIRED'
  error.control_retry_context = {
    version: CONTROL_REPAIR_LOOP_VERSION,
    retry_cycle: retryCycle,
    thread_id: String(msg?.thread_id || msg?.contact_id || ''),
    message_id: String(msg?.message_id || ''),
    required_action: String(transitionPlan?.action || ''),
    route_reason: String(transitionPlan?.reason || ''),
    rejection_ledger: (Array.isArray(rejectionLedger) ? rejectionLedger : [])
      .map((entry) => normalizeControlRepairEntry(entry))
      .slice(-CONTROL_REPAIR_LEDGER_LIMIT)
  }
  return error
}

// Media authority is monotonic per inbound message. A later controller repair pass
// may retry ASR/vision, but a timeout or rejected transcript is not allowed to erase
// an exact transcript/description already accepted for the same immutable message.
// This is source governance only; it does not author visible reply copy.
function mediaContextAuthorityRank(value) {
  const raw = String(value || '').trim()
  const normalized = normalizeText(raw)
  if (!normalized) return 0

  const unresolvedVoice = (
    /^sent a voice note\b/i.test(raw) &&
    /\b(could not be understood|couldn'?t be understood|could not understand|couldn'?t understand|unintelligible|transcription failed|could not transcribe|couldn'?t transcribe|could not be safely loaded|couldn'?t be safely loaded|media unavailable|audio unavailable)\b/i.test(raw)
  )
  if (unresolvedVoice) return 100

  if (/^sent a voice note saying:\s*\S/i.test(raw)) return 500
  if (/^sent a voice note\b/i.test(raw)) return 50
  if (/^sent a (?:reference post|photo|media):\s*\S/i.test(raw)) return 400
  if (/^sent a (?:reference post|photo|media)\b/i.test(raw)) return 50

  // Ordinary typed client text is already the direct source. A media helper must
  // never replace it merely because the transport payload happened to carry URLs.
  return 1000
}

function selectAuthoritativeMediaText(currentValue, candidateValue) {
  const current = String(currentValue || '').trim()
  const candidate = String(candidateValue || '').trim()
  const currentRank = mediaContextAuthorityRank(current)
  const candidateRank = mediaContextAuthorityRank(candidate)

  if (!candidate || normalizeText(current) === normalizeText(candidate)) {
    return {
      text: current || candidate,
      adopted: false,
      reason: candidate ? 'same_media_context' : 'empty_media_context_candidate',
      current_rank: currentRank,
      candidate_rank: candidateRank
    }
  }
  if (!current || candidateRank > currentRank) {
    return {
      text: candidate,
      adopted: true,
      reason: current ? 'higher_authority_media_context' : 'first_media_context',
      current_rank: currentRank,
      candidate_rank: candidateRank
    }
  }
  return {
    text: current,
    adopted: false,
    reason: candidateRank < currentRank
      ? 'media_context_downgrade_blocked'
      : 'equal_authority_media_context_conflict_first_source_preserved',
    current_rank: currentRank,
    candidate_rank: candidateRank
  }
}

function explicitClockTime(value) {
  const match = String(value || '').match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.?|p\.m\.?|am|pm)(?![a-z0-9_])/i)
  if (!match) return ''
  return `${Number(match[1])}${match[2] ? `:${match[2]}` : ''}${String(match[3]).toLowerCase().replace(/\./g, '')}`
}

function canonicalClockTimeKey(value) {
  const explicit = explicitClockTime(value)
  const match = explicit.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i)
  if (!match) return ''
  return `${Number(match[1])}:${match[2] || '00'}${match[3].toLowerCase()}`
}

function parseTime(value) {
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function rootPath(root) {
  return path.resolve(String(root || process.env.SCV_ROOT || __dirname))
}

function statePath(root, threadId) {
  return path.join(rootPath(root), 'thread-state', `${safeThreadKey(threadId)}.json`)
}

function historyPath(root, threadId) {
  return path.join(rootPath(root), 'thread-history', `${safeThreadKey(threadId)}.json`)
}

function controlEventPath(root, threadId) {
  return path.join(rootPath(root), 'control-events', `${safeThreadKey(threadId)}.ndjson`)
}

function controlDecisionPath(root, receiptSha256) {
  const key = String(receiptSha256 || '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(key)) return ''
  return path.join(rootPath(root), 'control-decisions', `${key}.json`)
}

function acceptedUnverifiedPendingPath(root, threadId) {
  return path.join(
    rootPath(root),
    'accepted-unverified-boundary-pending',
    `${safeThreadKey(threadId)}.json`
  )
}

function deliveryPublicationPath(root, threadId) {
  return path.join(rootPath(root), 'accepted-unverified-delivery-publications', `${safeThreadKey(threadId)}.json`)
}

function ensureControlDirs(root) {
  const resolved = rootPath(root)
  for (const dir of [
    'thread-state',
    'thread-history',
    'control-events',
    'control-decisions',
    'control-locks',
    'accepted-unverified-boundary-pending',
    'accepted-unverified-delivery-publications',
    'outbox_quarantine_pre_single_control'
  ]) {
    fs.mkdirSync(path.join(resolved, dir), { recursive: true })
  }
  return resolved
}

function fsyncDirectory(directory) {
  let descriptor
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY)
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function durableAtomicWriteText(file, text) {
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  let descriptor
  try {
    descriptor = fs.openSync(tmp, 'wx', 0o600)
    fs.fchmodSync(descriptor, 0o600)
    fs.writeFileSync(descriptor, String(text))
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  try {
    fs.renameSync(tmp, file)
    fsyncDirectory(directory)
  } catch (error) {
    try { fs.unlinkSync(tmp) } catch {}
    throw error
  }
  return file
}

function durableAtomicWriteJson(file, value) {
  return durableAtomicWriteText(file, JSON.stringify(value, null, 2) + '\n')
}

function safeReadJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function atomicWriteJson(file, value) {
  // All controller writes are ordering authority for the durable outbox. A
  // process-safe rename without file+directory fsync can be lost behind a
  // queue entry that did reach stable storage, so the historical helper now
  // delegates to the durable primitive at every call site.
  return durableAtomicWriteJson(file, value)
}

function sleepSync(ms) {
  const wait = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(wait, 0, 0, Math.max(1, Number(ms) || 1))
}

function readControlLockSnapshot(file) {
  let descriptor
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
    )
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > 4096) throw new Error('single_control_lock_file_invalid')
    const raw = fs.readFileSync(descriptor, 'utf8')
    let owner = null
    try { owner = JSON.parse(raw) } catch {}
    return {
      stat,
      raw_sha256: sha256(raw),
      owner_nonce: String(owner?.owner_nonce || ''),
      owner_pid: Number(owner?.pid)
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
}

function controlLockOwnerIsLive(snapshot) {
  try {
    const ownerPid = Number(snapshot?.owner_pid)
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
      process.kill(ownerPid, 0)
      return true
    }
  } catch (error) {
    return error?.code === 'EPERM'
  }
  return false
}

function sameControlLockSnapshot(left, right) {
  return Boolean(
    left && right &&
    left.stat.dev === right.stat.dev && left.stat.ino === right.stat.ino &&
    left.owner_nonce === right.owner_nonce &&
    (left.owner_nonce || left.raw_sha256 === right.raw_sha256) &&
    left.stat.mtimeMs === right.stat.mtimeMs &&
    left.stat.size === right.stat.size
  )
}

function releaseRecoveryCoordinator(file, descriptor, ownedStat, ownerNonce) {
  try { fs.closeSync(descriptor) } catch {}
  try {
    const current = readControlLockSnapshot(file)
    if (
      ownedStat && current.stat.dev === ownedStat.dev && current.stat.ino === ownedStat.ino &&
      current.owner_nonce === ownerNonce
    ) fs.unlinkSync(file)
  } catch {}
}

function withThreadControlLock(root, threadId, fn) {
  const resolved = ensureControlDirs(root)
  const safeKey = safeThreadKey(threadId)
  const lock = path.join(resolved, 'control-locks', `${safeKey}.lock`)
  const recoveryCoordinator = path.join(resolved, 'control-locks', `${safeKey}.recovery`)
  const started = Date.now()
  let fd = null
  let ownedStat = null
  const ownerNonce = crypto.randomBytes(32).toString('hex')

  const initializePrimaryOwner = (descriptor) => {
    fs.writeFileSync(descriptor, JSON.stringify({
      pid: process.pid,
      owner_nonce: ownerNonce,
      at: new Date().toISOString(),
      control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID
    }) + '\n')
    fs.fsyncSync(descriptor)
    ownedStat = fs.fstatSync(descriptor)
    fd = descriptor
  }

  while (fd === null) {
    try {
      const descriptor = fs.openSync(lock, 'wx', 0o600)
      initializePrimaryOwner(descriptor)
    } catch (err) {
      if (err && err.code !== 'EEXIST') throw err
      try {
        const candidate = readControlLockSnapshot(lock)
        const age = Date.now() - candidate.stat.mtimeMs
        if (age > CONTROL_LOCK_STALE_MS && !controlLockOwnerIsLive(candidate)) {
          let recoveryFd
          let recoveryStat
          const recoveryNonce = crypto.randomBytes(32).toString('hex')
          try {
            recoveryFd = fs.openSync(recoveryCoordinator, 'wx', 0o600)
            fs.writeFileSync(recoveryFd, JSON.stringify({
              pid: process.pid,
              owner_nonce: recoveryNonce,
              at: new Date().toISOString(),
              control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
              purpose: 'serialized_stale_lock_recovery'
            }) + '\n')
            fs.fsyncSync(recoveryFd)
            recoveryStat = fs.fstatSync(recoveryFd)
          } catch (recoveryError) {
            if (recoveryFd !== undefined) {
              try { fs.closeSync(recoveryFd) } catch {}
            }
            if (recoveryError?.code !== 'EEXIST') throw recoveryError
            recoveryFd = undefined
          }
          if (recoveryFd !== undefined) {
            try {
              const confirmed = readControlLockSnapshot(lock)
              if (
                sameControlLockSnapshot(candidate, confirmed) &&
                Date.now() - confirmed.stat.mtimeMs > CONTROL_LOCK_STALE_MS &&
                !controlLockOwnerIsLive(confirmed)
              ) {
                // Only the recovery-coordinator owner may unlink a stale primary.
                // It retains that coordinator through its own O_EXCL reacquire.
                fs.unlinkSync(lock)
                try {
                  const descriptor = fs.openSync(lock, 'wx', 0o600)
                  initializePrimaryOwner(descriptor)
                } catch (reacquireError) {
                  // An ordinary contender may win the absent-path race. That is
                  // a normal loss; never path-unlink its replacement.
                  if (reacquireError?.code !== 'EEXIST') throw reacquireError
                }
              }
            } finally {
              // Recovery coordinators are nonce/inode released and are never
              // themselves auto-reaped. A crashed coordinator therefore fails
              // stale recovery closed for explicit/manual inspection.
              releaseRecoveryCoordinator(
                recoveryCoordinator,
                recoveryFd,
                recoveryStat,
                recoveryNonce
              )
            }
          }
        }
      } catch {}
      if (fd !== null) continue
      if (Date.now() - started >= CONTROL_LOCK_MAX_WAIT_MS) {
        throw new Error(`single_control_lock_timeout:${safeThreadKey(threadId)}`)
      }
      sleepSync(CONTROL_LOCK_WAIT_MS)
    }
  }

  try {
    return fn()
  } finally {
    try { fs.closeSync(fd) } catch {}
    try {
      const current = readControlLockSnapshot(lock)
      if (
        ownedStat && current.stat.dev === ownedStat.dev && current.stat.ino === ownedStat.ino &&
        current.owner_nonce === ownerNonce
      ) {
        fs.unlinkSync(lock)
      }
    } catch {}
  }
}

function deriveBookingStage(state = {}) {
  const hasName = !!String(state.known_name_used_on_form || '').trim()
  const hasPhone = !!String(state.known_phone_used_on_form || '').trim()
  const hasDate = !!String(state.known_requested_date || '').trim()
  const hasTime = !!String(state.known_requested_time || '').trim()
  const hasDesign = !!String(state.known_design_context || '').trim() || state.known_client_anchored_inspiration === true || knownTattooReferenceMediaReceived({ structured_state: state }) || state.live_turn_gave_design_idea === true
  const acceptedSlot = !!String(state.accepted_offered_date || '').trim() && !!String(state.accepted_offered_time || '').trim()

  if (state.deposit_requested === true) return 'deposit_requested'
  if (
    hasName &&
    hasPhone &&
    hasDate &&
    hasTime &&
    (
      state.double_check_sent === true ||
      state.name_phone_date_time_double_check_sent === true
    )
  ) return 'awaiting_double_check_confirmation'
  if (hasName && hasPhone && hasDate && hasTime) return 'ready_for_double_check'
  if (acceptedSlot && state.form_link_sent === true && state.form_submitted !== true) return 'awaiting_form_submission_for_accepted_slot'
  if (hasName && !hasPhone) return 'awaiting_phone_used_on_form'
  if (!hasName && !hasPhone && state.form_submitted === true && hasDate && hasTime) return 'awaiting_form_identity_match'
  if (!hasName && state.form_submitted === true && hasDate && hasTime) return 'awaiting_name_used_on_form'
  if (hasDate && !hasTime) return 'awaiting_time'
  if (!hasDate && state.form_submitted === true && !hasDesign) return 'awaiting_design_direction'
  if (!hasDate && state.form_submitted === true) return 'awaiting_date'
  if (state.form_link_sent === true && state.form_submitted !== true) return 'awaiting_form_submission'
  if (state.form_offer_asked === true && state.form_link_sent !== true) return 'awaiting_form_permission_answer'
  if (
    state.tattoo_intent_active === true ||
    hasDesign ||
    String(state.known_placement_context || '').trim() ||
    String(state.known_size_context || '').trim()
  ) return 'design_intake'
  return 'open_conversation'
}

function explicitFourFieldBookingPayload(value, baseline = {}) {
  const raw = String(value || '').trim()
  if (!raw || baseline.form_submitted !== true) return null
  const parsed = extractExplicitFourFieldBookingPayload(raw)
  if (!parsed.valid) return null
  const time = explicitClockTime(parsed.time_text)
  if (!time) return null
  return {
    name: parsed.name,
    phone: parsed.phone,
    date_text: parsed.date_text,
    time_text: time
  }
}

function liveBookingIdentityAnswer(value, baseline = {}) {
  const raw = String(value || '').trim()
  const stage = String(baseline.booking_stage_hint || deriveBookingStage(baseline))
  const rawPhone = extractBookingPhone(raw)
  const calendarFrame = calendarBookingProposalFrame(raw)
  const clockFrame = clockTimeBookingProposalFrame(raw)
  const explicitFourFieldPayload = explicitFourFieldBookingPayload(raw, baseline)
  const labeledFields = extractLabeledBookingFields(raw)
  const labeledIdentityOnly = Boolean(
    labeledFields.detected &&
    labeledFields.valid &&
    labeledFields.present_fields.length === 2 &&
    labeledFields.present_fields.includes('name') &&
    labeledFields.present_fields.includes('phone') &&
    labeledFields.name &&
    labeledFields.phone
  )
  const strongFourFieldPayload = Boolean(
    baseline.form_submitted === true &&
    rawPhone &&
    (
      (calendarFrame.proposal === true && clockFrame.proposal === true) ||
      explicitFourFieldPayload !== null
    )
  )
  const activeIdentityLane = Boolean(
    baseline.form_submitted === true &&
    (
      (
        String(baseline.known_requested_date || '').trim() &&
        String(baseline.known_requested_time || '').trim() &&
        [
          'awaiting_form_identity_match',
          'awaiting_name_used_on_form',
          'awaiting_phone_used_on_form'
        ].includes(stage)
      ) ||
      strongFourFieldPayload
    )
  )
  if (!raw || !activeIdentityLane) return { name: '', phone: '' }

  // Contact details about another person are ordinary conversation facts, not
  // booking identity. This is deliberately checked before any digit parser.
  const thirdPartyIdentity = textFramesThirdPartyBookingIdentity(raw)
  if (thirdPartyIdentity) return { name: '', phone: '' }

  const phone = rawPhone
  const explicitPhoneCue = /\b(?:my\s+|the\s+)?(?:phone(?:\s+number)?|number|cell|mobile)(?:\s+(?:on|used\s+on)\s+(?:the\s+)?form)?\s*(?:(?:is|was)\b|[:=])/i.test(raw)
  const explicitNameCue = (
    /\b(?:my\s+)?name(?:\s+(?:on|used\s+on)\s+(?:the\s+)?form)?\s*(?:(?:is|was)\b|[:=])/i.test(raw) ||
    /\b(?:i\s+(?:used|put|entered)|i\s+submitted(?:\s+it)?\s+under)\b/i.test(raw)
  )
  const withoutPhone = raw
    .replace(/[+\d][+\d\s().-]{5,}\d/g, ' ')
    .replace(/\b(?:phone(?:\s+number)?|number|cell|mobile)\b\s*[:=]?/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
  const barePhoneAnswer = Boolean(
    phone &&
    stage === 'awaiting_phone_used_on_form' &&
    !withoutPhone
  )
  // The identity lane explicitly asks for the name and phone used on the form.
  // A natural answer such as "Omar System 4155550199" is therefore just as
  // authoritative as a labelled payload.  v150 required a literal name/phone
  // cue, discarded both fields, and left the controller on POST_FORM_IDENTITY.
  // Keep this admission narrow: the form must already be submitted, date/time
  // must already be known, the controller must be waiting for identity, and the
  // same live turn must contain both a valid phone and a non-empty name next to
  // it.  Third-party framing and malformed labelled payloads are still rejected
  // above, so arbitrary numbers in ordinary conversation cannot become booking
  // identity.
  const adjacentName = phone ? extractBookingNameNextToPhone(raw) : ''
  const bareNamePhoneAnswer = Boolean(
    phone &&
    adjacentName &&
    !explicitPhoneCue &&
    !explicitNameCue &&
    !labeledFields.detected &&
    baseline.form_submitted === true &&
    String(baseline.known_requested_date || '').trim() &&
    String(baseline.known_requested_time || '').trim() &&
    [
      'awaiting_form_identity_match',
      'awaiting_name_used_on_form',
      'awaiting_phone_used_on_form'
    ].includes(stage)
  )
  // A detected structured payload with extra/duplicate/invalid labels may not
  // fall through to broad adjacent-name parsing. Likewise, once a sentence
  // explicitly labels only the phone (for example "my phone ... 415..., Lua"),
  // the leftover prose is not an authoritative name. The bare-pair admission
  // above is exclusively for genuinely unlabeled answers such as
  // "Omar System 4155550199".
  if (labeledFields.detected && !explicitFourFieldPayload && !labeledIdentityOnly) {
    return { name: '', phone: '' }
  }
  const acceptedPhone = phone && (explicitPhoneCue || explicitNameCue || barePhoneAnswer || bareNamePhoneAnswer || strongFourFieldPayload || labeledIdentityOnly)
    ? phone
    : ''

  let acceptedName = ''
  // Exact four-field payloads have the strongest grammar.  Parse those before
  // broad "name:" cues so the remaining Phone/Date/Time labels can never be
  // swallowed into the name field.
  if (explicitFourFieldPayload) {
    acceptedName = explicitFourFieldPayload.name
  } else if (labeledIdentityOnly) {
    acceptedName = labeledFields.name
  } else if (explicitNameCue) {
    if (phone) {
      acceptedName = extractBookingNameNextToPhone(raw)
    } else {
      const match = raw.match(
        /\b(?:my\s+)?name(?:\s+(?:on|used\s+on)\s+(?:the\s+)?form)?\s*(?:is|was|:|=)\s*([^,;\n]+)|\b(?:i\s+(?:used|put|entered)|i\s+submitted(?:\s+it)?\s+under)\s+([^,;\n]+)/i
      )
      acceptedName = sanitizeBookingIdentityName(match?.[1] || match?.[2] || '')
    }
  } else if (strongFourFieldPayload && phone) {
    const phoneSpan = raw.match(/[+\d][+\d\s().-]{5,}\d/)
    const leadingIdentity = phoneSpan && Number.isInteger(phoneSpan.index)
      ? raw.slice(0, phoneSpan.index)
      : ''
    acceptedName = sanitizeBookingIdentityName(leadingIdentity)
  } else if (bareNamePhoneAnswer) {
    acceptedName = adjacentName
  }

  return {
    name: acceptedName,
    phone: acceptedPhone || ''
  }
}

function assistantPacketOpensBookingTimeSelection(value) {
  const raw = String(value || '')
  return Boolean(
    /\b(?:what|which|any|around)\b.{0,45}\btime\b/i.test(raw) ||
    /\btime\b.{0,45}\b(?:work|works|best|good|better|thinking|prefer|available|free)\b/i.test(raw) ||
    /\b(?:send|give|tell|drop|message|let\s+me\s+know)\b.{0,40}\b(?:a|the|your|what|which)?\s*time\b/i.test(raw) ||
    /\bwhat\s+part\s+of\s+(?:the\s+)?day\b/i.test(raw) ||
    /\b(?:morning|afternoon|evening)\b.{0,24}\bor\b.{0,24}\b(?:morning|afternoon|evening)\b/i.test(raw)
  )
}

function assistantPacketOpensBookingDateSelection(value) {
  const raw = String(value || '')
  return Boolean(
    /\b(?:what|which|any|couple|some)\b.{0,55}\b(?:date|dates|day|days|weekend|weekends|availability)\b/i.test(raw) ||
    /\b(?:date|dates|day|days|weekend|weekends|availability)\b.{0,55}\b(?:work|works|thinking|easiest|best|good|free|available)\b/i.test(raw) ||
    /\bwhen\b.{0,45}\b(?:free|available|open|work|works|come|do it)\b/i.test(raw)
  )
}

function latestVisibleAssistantText(history = []) {
  const event = [...(Array.isArray(history) ? history : [])]
    .reverse()
    .find((entry) => isConversationVisibleAssistantEvent(entry))
  return String(event?.text || event?.message || '')
}

// A suffixless hour is only meaningful when the submitted-form lane already
// has a date and the immediately preceding visible assistant turn opened the
// time slot. Keep this grammar deliberately narrow so calendar days and random
// numbers never become appointment times. In the tattoo-day clock 8 through 11
// mean morning 12 means noon and 1 through 7 mean afternoon.
function contextualBareBookingHourFrame(value, allowBareTime = false) {
  if (!allowBareTime) return null
  const raw = String(value || '')
    .toLowerCase()
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const match = raw.match(
    /^(?:(?:how|what)\s+about\s+|(?:can|could|would)\s+(?:we|i|you|u)\s+(?:do|make|book|try)\s+|(?:let'?s)\s+(?:do|try)\s+|(?:at|around)\s+)?(1[0-2]|[1-9])(?::([0-5]\d))?(?:\s*(?:please|pls|plz))?$/i
  )
  if (!match) return null
  const hour = Number(match[1])
  const minute = String(match[2] || '')
  const suffix = hour === 12 ? 'pm' : hour >= 8 ? 'am' : 'pm'
  return {
    proposal: true,
    rejection: false,
    bounded: false,
    ambiguous: false,
    candidate_text: `${hour}${minute ? `:${minute}` : ''}${suffix}`,
    reason: 'contextual_bare_hour_answer_to_active_time_question'
  }
}

function liveBookingClockFrame(value, baseline = {}, recentHistory = []) {
  const raw = String(value || '').trim()
  const stage = String(baseline.booking_stage_hint || deriveBookingStage(baseline))
  const allowBareTime = Boolean(
    baseline.form_submitted === true &&
    String(baseline.known_requested_date || '').trim() &&
    !String(baseline.known_requested_time || '').trim() &&
    stage === 'awaiting_time' &&
    assistantPacketOpensBookingTimeSelection(latestVisibleAssistantText(recentHistory))
  )
  const frame = clockTimeBookingProposalFrame(raw, { allowBareTime })
  if (frame.proposal === true) return frame
  const contextualBareHour = contextualBareBookingHourFrame(raw, allowBareTime)
  if (contextualBareHour) return contextualBareHour
  const fourFieldPayload = explicitFourFieldBookingPayload(raw, baseline)
  return fourFieldPayload
    ? {
        proposal: true,
        rejection: false,
        bounded: false,
        ambiguous: false,
        candidate_text: fourFieldPayload.time_text,
        reason: 'explicit_four_field_booking_payload'
      }
    : frame
}

// next_action_reflected is controller-owned routing metadata rather than client
// copy. Bind it at the outer adoption boundary for live candidates so a good
// visible response cannot deadlock merely because the model did not echo an
// invisible field. Injected harness candidates remain untouched so forged
// metadata tests continue to fail closed.
function bindLiveControllerPacketMetadata(candidate = {}, transitionPlan = {}, injectedCandidateGenerator = false) {
  if (
    !injectedCandidateGenerator &&
    candidate?.packet &&
    typeof candidate.packet === 'object' &&
    String(transitionPlan?.action || '').trim()
  ) {
    candidate.packet.next_action_reflected = String(transitionPlan.action).trim()
  }
  return candidate
}

function liveBookingClockTime(value, baseline = {}, recentHistory = []) {
  const frame = liveBookingClockFrame(value, baseline, recentHistory)
  return frame.proposal === true && frame.candidate_text
    ? explicitClockTime(frame.candidate_text)
    : ''
}

function bookingDateIsoForTurn(value, event = {}, state = {}) {
  const ingressTimeMs = immutableIngressTimeMs(event)
  const decision = classifyBookingDateText(String(value || ''), {
    referenceTime: ingressTimeMs ? new Date(ingressTimeMs).toISOString() : undefined,
    currentDateLocal: state.current_message_date_local,
    minimumDateLocal: state.minimum_booking_date_local,
    allowAmbiguousDay: false
  })
  return String(decision?.date_iso || '')
}

function extractOfferedSlotsFromPacket(packet = {}) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  const slots = []
  for (let index = 0; index < bubbles.length; index += 1) {
    const raw = String(bubbles[index]?.text || '')
    const monthDays = Array.from(raw.matchAll(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi))
    const ordinalDays = Array.from(raw.matchAll(/\b(?:the\s+)?(\d{1,2})(st|nd|rd|th)\b/gi))
    const weekdays = Array.from(raw.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi))
    const times = Array.from(raw.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.?|p\.m\.?|am|pm)(?![a-z0-9_])/gi))
    const dateKind = monthDays.length > 0
      ? 'month_day'
      : ordinalDays.length > 0
        ? 'ordinal_day'
        : weekdays.length > 0
          ? 'weekday'
          : ''
    const dateMatches = dateKind === 'month_day'
      ? monthDays
      : dateKind === 'ordinal_day'
        ? ordinalDays
        : weekdays
    for (let dateIndex = 0; dateIndex < dateMatches.length; dateIndex += 1) {
      const dateMatch = dateMatches[dateIndex]
      const nextDateOffset = Number(dateMatches[dateIndex + 1]?.index ?? Number.POSITIVE_INFINITY)
      // Bind each time to the date immediately before it. This preserves every
      // option in "Sept 7 at 2pm or Sept 8 at 2pm" instead of retaining only
      // the last date/time pair.
      const timeMatch = times.find((match) => (
        Number(match.index) >= Number(dateMatch.index) &&
        Number(match.index) < nextDateOffset
      ))
      let date = ''
      if (dateKind === 'month_day') date = `${dateMatch[1].toLowerCase()} ${dateMatch[2]}`
      else if (dateKind === 'ordinal_day') date = `the ${dateMatch[1]}${dateMatch[2].toLowerCase()}`
      else date = dateMatch[1].toLowerCase()
      const minute = timeMatch?.[2] ? `:${timeMatch[2]}` : ''
      const time = timeMatch
        ? `${timeMatch[1]}${minute}${String(timeMatch[3]).toLowerCase().replace(/\./g, '')}`
        : ''
      slots.push({ date, time, bubble_index: index })
    }
  }
  return slots
}

function extractLatestOfferedSlotFromPacket(packet = {}) {
  const slots = extractOfferedSlotsFromPacket(packet)
  return slots.at(-1) || null
}

function historicalOfferedSlotForDate(recentHistory = [], targetDateIso = '', event = {}, state = {}) {
  const wantedIso = String(targetDateIso || '').trim()
  if (!wantedIso) return null
  const visibleAssistantBubbles = (Array.isArray(recentHistory) ? recentHistory.slice(-30) : [])
    .filter((historyEvent) => isConversationVisibleAssistantEvent(historyEvent))
    .map((historyEvent) => ({ text: String(historyEvent?.text || historyEvent?.message || '') }))
  const slots = extractOfferedSlotsFromPacket({ bubbles: visibleAssistantBubbles })
  for (let index = slots.length - 1; index >= 0; index -= 1) {
    const slot = slots[index]
    if (!String(slot?.time || '').trim()) continue
    const timeDecision = classifyBookingClockTimeText(slot.time)
    if (timeDecision.status !== 'legal') continue
    if (bookingDateIsoForTurn(slot.date, event, state) !== wantedIso) continue
    return {
      date: String(slot.date || '').trim(),
      time: String(timeDecision.canonical_label || slot.time || '').trim()
    }
  }
  return null
}

function semanticSnapshot(state = {}) {
  const out = {}
  for (const field of DURABLE_TRUE_FIELDS) out[field] = state[field] === true
  for (const field of DURABLE_STRING_FIELDS) out[field] = String(state[field] || '').trim()
  out.structured_state_schema_version = String(state.structured_state_schema_version || '')
  out.structured_state_schema_sha256 = String(state.structured_state_schema_sha256 || '')
  out.booking_stage_hint = deriveBookingStage(state)
  out.next_action = String(state.next_action || '')
  return out
}

function migrateStateObject(previous = {}, threadId = '') {
  const prior = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}
  const out = {}
  for (const field of TRANSPORT_STATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(prior, field)) out[field] = prior[field]
  }
  Object.assign(out, extractDurableStructuredState(prior))
  out.thread_id = String(out.thread_id || threadId || out.contact_id || '')
  out.contact_id = String(out.contact_id || out.thread_id || '')
  out.control_plane_id = SCV_SINGLE_CONTROL_PLANE_ID
  out.control_epoch = SCV_CONTROL_EPOCH
  out.control_revision = prior.control_epoch === SCV_CONTROL_EPOCH ? Math.max(0, Number(prior.control_revision) || 0) : 0
  out.ingress_revision = prior.control_epoch === SCV_CONTROL_EPOCH ? Math.max(0, Number(prior.ingress_revision) || 0) : 0
  out.control_event_revision = prior.control_epoch === SCV_CONTROL_EPOCH ? Math.max(0, Number(prior.control_event_revision) || 0) : 0
  out.latest_ingress_message_id = String(
    prior.control_epoch === SCV_CONTROL_EPOCH
      ? (prior.latest_ingress_message_id || out.message_id || '')
      : (out.message_id || '')
  )
  out.latest_ingress_at = String(
    prior.control_epoch === SCV_CONTROL_EPOCH
      ? (prior.latest_ingress_at || out.received_at || '')
      : (out.received_at || '')
  )
  out.latest_ingress_text_sha256 = String(
    prior.control_epoch === SCV_CONTROL_EPOCH
      ? (prior.latest_ingress_text_sha256 || sha256(normalizeText(out.text || '')))
      : sha256(normalizeText(out.text || ''))
  )
  out.control_recent_receipts = prior.control_epoch === SCV_CONTROL_EPOCH && Array.isArray(prior.control_recent_receipts)
    ? prior.control_recent_receipts.slice(-24)
    : []
  if (prior.control_epoch === SCV_CONTROL_EPOCH) {
    out.last_control_message_id = String(prior.last_control_message_id || '')
    out.last_control_committed_at = String(prior.last_control_committed_at || '')
    out.control_state_sha256 = String(prior.control_state_sha256 || '')
    if (prior.last_control_decision && typeof prior.last_control_decision === 'object') {
      out.last_control_decision = prior.last_control_decision
    }
    if (prior.migrated_to_single_control_at) {
      out.migrated_to_single_control_at = String(prior.migrated_to_single_control_at)
    }
  }
  const bookingStage = deriveBookingStage(out)
  stampStructuredState(out, {
    stage: bookingStage,
    nextAction: nextActionForStage(bookingStage)
  })
  if (prior.control_epoch && prior.control_epoch !== SCV_CONTROL_EPOCH) {
    out.legacy_control_epoch = String(prior.control_epoch)
  } else if (!prior.control_epoch && Object.keys(prior).length) {
    out.legacy_control_epoch = 'pre_single_control'
  }
  return out
}

function readControlState(root, threadId) {
  const file = statePath(root, threadId)
  return migrateStateObject(safeReadJson(file, {}), threadId)
}

function recentControlHistoryBeforeTurn(root, msg, limit = 30) {
  const threadId = String(msg?.thread_id || msg?.contact_id || '')
  const messageId = String(msg?.message_id || '')
  const history = safeReadJson(historyPath(root, threadId), {})
  return (Array.isArray(history?.events) ? history.events : [])
    .filter((event) => !messageId || String(event?.message_id || '') !== messageId)
    .slice(-Math.max(1, Number(limit) || 30))
}

const GROUNDED_DESIGN_HISTORY_MARKER_RE = /\b(?:tattoo|piece|design|reference|portrait|sleeve|flash|linework|black\s*(?:and|&)\s*gr[ae]y)\b|\bsent\s+(?:a|an)\s+(?:photo|image|post|screenshot)\b/i

// A verified user reference can predate the form by several turns. If an older
// build failed to persist that evidence, form submission must not regress the
// thread to DESIGN_INTAKE after the visible conversation already advanced. Only
// user-authored, independently concrete design language is eligible; assistant
// paraphrases and generic pointer turns never become durable design authority.
function recoverGroundedDesignContextFromHistory(root, threadId, limit = 40) {
  const history = safeReadJson(historyPath(root, threadId), {})
  const events = Array.isArray(history?.events) ? history.events.slice(-Math.max(1, Number(limit) || 40)) : []

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (String(event?.role || '').toLowerCase() !== 'user') continue
    const text = String(event?.text || event?.content || '').trim()
    if (!text || !GROUNDED_DESIGN_HISTORY_MARKER_RE.test(text)) continue
    if (!liveHasConcreteDesignDirection({
      message: text,
      recent_history: [],
      structured_state: { live_turn_text: text }
    })) continue
    return text
  }

  return ''
}

// Live 2026-07-28: one contact stuck in a recovery loop appended 4.69GB of
// control events, filled the /data volume to 100%, and silenced every real
// lead (all writes became 0-byte). The audit ledger is telemetry, not
// conversation state — it must never be able to take the service down. Cap
// each thread ledger; on overflow keep the newest tail and drop the oldest.
const CONTROL_EVENT_LEDGER_MAX_BYTES = Number(process.env.SCV_CONTROL_EVENT_LEDGER_MAX_BYTES || 5 * 1024 * 1024)
const CONTROL_EVENT_LEDGER_KEEP_BYTES = Number(process.env.SCV_CONTROL_EVENT_LEDGER_KEEP_BYTES || 1 * 1024 * 1024)

function rotateControlLedgerIfOversized(file) {
  let size = 0
  try { size = fs.statSync(file).size } catch { return }
  if (size <= CONTROL_EVENT_LEDGER_MAX_BYTES) return
  const keep = Math.min(CONTROL_EVENT_LEDGER_KEEP_BYTES, size)
  const fd = fs.openSync(file, 'r')
  const buf = Buffer.alloc(keep)
  fs.readSync(fd, buf, 0, keep, size - keep)
  fs.closeSync(fd)
  const tail = buf.toString('utf8')
  const clean = tail.slice(tail.indexOf('\n') + 1)
  durableAtomicWriteText(file, clean)
  console.log(JSON.stringify({
    type: 'control_event_ledger_rotated',
    file: path.basename(file),
    previous_bytes: size,
    kept_bytes: clean.length
  }))
}

function appendControlAuditUnlocked(root, threadId, event) {
  const file = controlEventPath(root, threadId)
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  rotateControlLedgerIfOversized(file)
  let descriptor
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_APPEND |
        (fs.constants.O_NOFOLLOW || 0),
      0o600
    )
    fs.fchmodSync(descriptor, 0o600)
    fs.writeFileSync(descriptor, JSON.stringify({
      at: new Date().toISOString(),
      control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
      control_epoch: SCV_CONTROL_EPOCH,
      ...event
    }) + '\n')
    fs.fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
  }
  fsyncDirectory(directory)
  return file
}

function recordControlLifecycleEvent(root, packet, event = {}) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  if (!threadId) return null
  return withThreadControlLock(root, threadId, () => appendControlAuditUnlocked(root, threadId, {
    type: String(event.type || 'control_lifecycle_event'),
    message_id: String(packet?.message_id || event.message_id || ''),
    ...event
  }))
}

function historyEventExists(events, next) {
  const messageId = String(next.message_id || '')
  const role = String(next.role || '')
  const bubbleIndex = Number(next.bubble_index || 0)
  if (messageId) {
    return events.some((event) =>
      String(event?.message_id || '') === messageId &&
      String(event?.role || '') === role &&
      Number(event?.bubble_index || 0) === bubbleIndex &&
      normalizeText(event?.text || '') === normalizeText(next.text || '')
    )
  }
  return events.some((event) =>
    String(event?.role || '') === role &&
    normalizeText(event?.text || '') === normalizeText(next.text || '') &&
    String(event?.at || '') === String(next.at || '')
  )
}

function mutableHistoryForPacket(root, packet, suppliedHistory) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  const file = historyPath(root, threadId)
  const prior = suppliedHistory && typeof suppliedHistory === 'object' && Array.isArray(suppliedHistory.events)
    ? suppliedHistory
    : safeReadJson(file, {})
  return {
    contact_id: String(packet?.contact_id || prior?.contact_id || threadId),
    thread_id: threadId,
    instagram_username: String(packet?.instagram_username || prior?.instagram_username || ''),
    events: Array.isArray(prior?.events) ? prior.events.slice() : []
  }
}

function appendHistoryEventInMemory(history, packet, role, extra = {}) {
  if (!history || !Array.isArray(history.events)) {
    throw new Error('single_control_history_object_invalid')
  }
  const normalizedRole = String(role || 'user')
  const immutableUserAtMs = normalizedRole === 'user' ? immutableIngressTimeMs(packet) : 0
  const next = {
    role: normalizedRole,
    message_id: String(packet?.message_id || ''),
    bubble_index: Number(packet?.bubble_index || 0),
    text: String(role === 'user' ? (packet?.text || '') : (packet?.bubble?.text || packet?.text || '')),
    at: String(
      normalizedRole === 'user'
        ? (immutableUserAtMs ? new Date(immutableUserAtMs).toISOString() : (extra.at || new Date().toISOString()))
        : (extra.at || new Date().toISOString())
    ),
    ...extra
  }
  let event = history.events.find((candidate) => historyEventExists([candidate], next))
  if (!event) {
    history.events.push(next)
    event = next
  }
  // Keep a deeper persistent conversation ledger than the active model window.
  // The live resolver reads a bounded recent slice, while the /data-backed source
  // retains enough prior turns for restart recovery and future context compaction.
  history.events = history.events.slice(-500)
  return event
}

function appendHistoryUnlocked(root, packet, role, extra = {}, options = {}) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  const file = historyPath(root, threadId)
  const history = mutableHistoryForPacket(root, packet, options?.history)
  appendHistoryEventInMemory(history, packet, role, extra)
  atomicWriteJson(file, history)
  return file
}

function appendControlHistoryEvent(root, packet, role, extra = {}) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  if (!threadId) throw new Error('single_control_history_missing_thread_id')
  return withThreadControlLock(root, threadId, () => {
    const file = appendHistoryUnlocked(root, packet, role, extra)
    appendControlAuditUnlocked(root, threadId, {
      type: 'history_event_adopted',
      role: String(role || ''),
      message_id: String(packet?.message_id || ''),
      bubble_index: Number(packet?.bubble_index || 0),
      text_sha256: sha256(normalizeText(role === 'user' ? packet?.text : packet?.bubble?.text))
    })
    return file
  })
}

function appendAcceptedUnverifiedDeliveryEvidence(root, packet, extra = {}, persistReceipt) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  const messageId = String(packet?.message_id || '')
  const bubbleIndex = Number(packet?.bubble_index || 0)
  const text = String(packet?.bubble?.text || '')
  if (!threadId || !messageId || !text) {
    throw new Error('accepted_unverified_delivery_evidence_identity_missing')
  }
  if (String(extra?.delivery_status || '') !== 'manychat_accepted_unverified') {
    throw new Error('accepted_unverified_delivery_evidence_status_invalid')
  }
  if (typeof persistReceipt !== 'function') {
    throw new Error('accepted_unverified_delivery_evidence_receipt_writer_missing')
  }

  return withThreadControlLock(root, threadId, () => {
    const historyExtra = { ...extra }
    delete historyExtra.delivery_publication_id
    // Receipt first, history second, while holding the same per-thread lock used
    // by inbound reconciliation. A newer inbound can observe neither or both,
    // never an attempted event before its accepted-delivery evidence exists.
    const receipt = persistReceipt()
    const identity = {
      thread_id: threadId,
      contact_id: String(packet?.contact_id || packet?.thread_id || ''),
      message_id: messageId,
      bubble_index: bubbleIndex,
      text_sha256: sha256(text),
      text_length: text.length
    }
    if (
      !acceptedUnverifiedReceiptValid(receipt, identity) ||
      !acceptedUnverifiedProviderResponseValid(root, receipt)
    ) throw new Error('accepted_unverified_delivery_evidence_receipt_invalid')

    const file = appendHistoryUnlocked(root, packet, 'assistant_attempted', historyExtra)
    appendControlAuditUnlocked(root, threadId, {
      type: 'accepted_unverified_delivery_evidence_adopted',
      role: 'assistant_attempted',
      message_id: messageId,
      bubble_index: bubbleIndex,
      text_sha256: identity.text_sha256,
      delivery_status: 'manychat_accepted_unverified',
      delivery_accepted: true,
      delivery_confirmed: false,
      provider_receipt_id_present: false,
      transport_attempt_id: String(receipt.transport_attempt_id || '')
    })
    const pending_reconciliation = finalizeAcceptedUnverifiedPendingUnlocked(root, threadId)
    // If the provider response landed after the first observer, retain the
    // exact A↔B correlation. A later authenticated C can prove visibility
    // without ever misattributing A's reply to B.
    if (String(extra?.delivery_publication_id || '')) {
      clearDeliveryPublicationUnlocked(root, threadId, String(extra.delivery_publication_id))
    }
    return { history_file: file, receipt, pending_reconciliation }
  })
}

function confirmedReceiptMatchesPacket(receipt, packet, publication) {
  const text = String(packet?.bubble?.text || '')
  return Boolean(
    receipt?.delivery_confirmed === true &&
    String(receipt?.delivery_status || '') === 'success_visible' &&
    String(receipt?.thread_id || '') === String(packet?.thread_id || packet?.contact_id || '') &&
    String(receipt?.contact_id || '') === String(packet?.contact_id || packet?.thread_id || '') &&
    String(receipt?.message_id || '') === String(packet?.message_id || '') &&
    Number(receipt?.bubble_index) === Number(packet?.bubble_index) &&
    String(receipt?.control_receipt_sha256 || '') === String(publication?.control_receipt_sha256 || '') &&
    String(receipt?.text_sha256 || '') === sha256(text) &&
    Number(receipt?.text_length) === text.length &&
    parseTime(receipt?.transport_response_received_at || receipt?.at) > 0
  )
}

function appendConfirmedDeliveryEvidence(root, packet, extra = {}, persistReceipt) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  const publicationId = String(extra?.delivery_publication_id || '')
  if (!threadId || !publicationId || typeof persistReceipt !== 'function') {
    throw new Error('confirmed_delivery_publication_identity_missing')
  }
  return withThreadControlLock(root, threadId, () => {
    const publication = readDeliveryPublication(root, threadId)
    if (!publication || String(publication.publication_id || '') !== publicationId) {
      throw new Error('confirmed_delivery_publication_owner_mismatch')
    }
    const ledgerBefore = readDeliveryReceiptRows(root)
    const existingReceipts = ledgerBefore.valid
      ? ledgerBefore.rows.filter((row) => confirmedReceiptMatchesPacket(row, packet, publication))
      : []
    if (existingReceipts.length > 1) throw new Error('confirmed_delivery_receipt_ambiguous')
    const receipt = existingReceipts[0] || persistReceipt()
    if (!confirmedReceiptMatchesPacket(receipt, packet, publication)) {
      throw new Error('confirmed_delivery_receipt_binding_invalid')
    }
    if (
      parseTime(extra?.at || packet?.transport_response_received_at) !==
      parseTime(receipt?.transport_response_received_at || receipt?.at)
    ) throw new Error('confirmed_delivery_receipt_chronology_binding_invalid')
    if (extra?.test_fault_after_receipt === true) {
      throw new Error('confirmed_delivery_test_fault_after_receipt')
    }
    const historyExtra = { ...extra }
    delete historyExtra.delivery_publication_id
    for (const key of Object.keys(historyExtra)) {
      if (key.startsWith('test_fault_')) delete historyExtra[key]
    }
    historyExtra.reply_to_message_id = String(packet?.message_id || '')
    historyExtra.control_receipt_sha256 = String(publication.control_receipt_sha256 || '')
    const file = historyPath(root, threadId)
    const history = mutableHistoryForPacket(root, packet)
    const deliveredEvent = appendHistoryEventInMemory(history, packet, 'assistant', historyExtra)
    const pending = readAcceptedUnverifiedPending(root, threadId)
    let pendingReconciliation = {
      applied: false,
      reason: 'accepted_unverified_pending_absent',
      bubble_count: 0
    }
    let mayClearPending = false
    if (
      pending &&
      String(pending.prior_message_id || '') === String(packet?.message_id || '') &&
      String(pending.control_receipt_sha256 || '') === String(publication.control_receipt_sha256 || '')
    ) {
      pendingReconciliation = finalizeAcceptedUnverifiedPendingUnlocked(root, threadId, {
        history,
        persist_history: false,
        clear_pending: false,
        append_audit: false
      })
      const priorAssistantEvents = history.events
        .filter((event) =>
          ['assistant', 'assistant_attempted'].includes(String(event?.role || '')) &&
          String(event?.message_id || '') === String(packet?.message_id || '')
        )
        .sort((left, right) => Number(left?.bubble_index) - Number(right?.bubble_index))
      const withoutPriorAssistant = history.events.filter((event) => !priorAssistantEvents.includes(event))
      const observerIndex = withoutPriorAssistant.findIndex((event) =>
        event?.role === 'user' && String(event?.message_id || '') === String(pending.observed_by_message_id || '')
      )
      if (observerIndex < 0) throw new Error('confirmed_delivery_pending_observer_missing')
      const responseAt = parseTime(extra?.at || receipt?.transport_response_received_at || receipt?.at)
      const observerAt = parseTime(pending.observed_inbound_at)
      const entireUnionPredatesObserver = priorAssistantEvents.every((event) => {
        const eventAt = parseTime(event?.at)
        return eventAt > 0 && observerAt > eventAt
      })
      if (responseAt > 0 && observerAt > responseAt && entireUnionPredatesObserver) {
        withoutPriorAssistant.splice(observerIndex, 0, ...priorAssistantEvents)
        history.events = withoutPriorAssistant
      } else {
        if (deliveredEvent) {
          deliveredEvent.late_prior_message_delivery = true
          deliveredEvent.reply_to_message_id = String(packet?.message_id || '')
        }
      }
      const attempted = priorAssistantEvents.filter((event) => event?.role === 'assistant_attempted')
      mayClearPending = attempted.length === 0 || pendingReconciliation.applied === true
    }
    if (extra?.test_fault_before_history_write === true) {
      throw new Error('confirmed_delivery_test_fault_before_history_write')
    }
    // The confirmed row, accepted-unverified markers, and packet ordering become
    // visible in one fsync-backed rename. No crash can expose a half-finalized
    // mixed packet in history.
    durableAtomicWriteJson(file, history)
    if (extra?.test_fault_after_history_write === true) {
      throw new Error('confirmed_delivery_test_fault_after_history_write')
    }
    clearDeliveryPublicationUnlocked(root, threadId, publicationId)
    if (extra?.test_fault_after_publication_clear === true) {
      throw new Error('confirmed_delivery_test_fault_after_publication_clear')
    }
    if (mayClearPending) clearAcceptedUnverifiedPending(root, threadId)
    if (extra?.test_fault_after_pending_clear === true) {
      throw new Error('confirmed_delivery_test_fault_after_pending_clear')
    }
    if (pendingReconciliation.applied && !pendingReconciliation.already_applied) {
      appendControlAuditUnlocked(root, threadId, {
        type: 'accepted_unverified_conversation_boundary_reconciled_from_pending',
        message_id: String(pendingReconciliation.prior_message_id || ''),
        observed_by_message_id: String(pendingReconciliation.observed_by_message_id || ''),
        bubble_count: Number(pendingReconciliation.bubble_count || 0),
        authentication_source: String(pending?.authentication_source || ''),
        delivery_accepted: true,
        delivery_confirmed: false,
        visibility_confirmed: false,
        visibility_state: 'provider_accepted_visibility_unknown',
        boundary_semantics: ACCEPTED_UNVERIFIED_BOUNDARY_SEMANTICS,
        newer_inbound_is_visibility_proof: false,
        no_resend: true,
        atomic_mixed_finalization: true
      })
    }
    appendControlAuditUnlocked(root, threadId, {
      type: 'confirmed_delivery_publication_adopted',
      message_id: String(packet?.message_id || ''),
      bubble_index: Number(packet?.bubble_index || 0),
      delivery_status: String(extra?.delivery_status || ''),
      provider_confirmed: true
    })
    return { history_file: file, receipt, pending_reconciliation: pendingReconciliation }
  })
}

function enrichControlHistoryUserEvent(root, packet, enrichedText) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  const messageId = String(packet?.message_id || '')
  const nextText = String(enrichedText || '').trim()
  if (!threadId || !messageId || !nextText) return false
  return withThreadControlLock(root, threadId, () => {
    const file = historyPath(root, threadId)
    const history = safeReadJson(file, null)
    if (!history || !Array.isArray(history.events)) return false
    let changed = false
    for (let i = history.events.length - 1; i >= 0; i -= 1) {
      const event = history.events[i]
      if (!event || String(event.role || '') !== 'user') continue
      if (String(event.message_id || '') !== messageId) continue
      const selection = selectAuthoritativeMediaText(event.text, nextText)
      if (!selection.adopted) {
        if (selection.reason !== 'same_media_context') {
          appendControlAuditUnlocked(root, threadId, {
            type: 'history_user_media_context_downgrade_blocked',
            message_id: messageId,
            reason: selection.reason,
            current_rank: selection.current_rank,
            candidate_rank: selection.candidate_rank,
            current_text_sha256: sha256(normalizeText(event.text)),
            candidate_text_sha256: sha256(normalizeText(nextText))
          })
        }
        return false
      }
      if (!String(event.raw_text_before_authority_enrichment || '').trim()) {
        event.raw_text_before_authority_enrichment = String(event.text || '')
      }
      event.text = selection.text
      event.text_source = [
        String(event.text_source || '').trim(),
        'single_control_media_context_enriched'
      ].filter(Boolean).join('|')
      event.authority_media_context_enriched_at = new Date().toISOString()
      changed = true
      break
    }
    if (!changed) return false
    atomicWriteJson(file, history)
    appendControlAuditUnlocked(root, threadId, {
      type: 'history_user_media_context_enriched',
      message_id: messageId,
      text_sha256: sha256(normalizeText(nextText))
    })
    return true
  })
}

function sourceAuthenticatedEnrichedInboundTurn(root, packet) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  const messageId = String(packet?.message_id || '')
  const rawLiveText = String(packet?.text || packet?.message || '').trim()
  const hasMediaSource = Boolean(
    (Array.isArray(packet?.media_urls) && packet.media_urls.some((value) => String(value || '').trim())) ||
    String(packet?.media_type || '').trim().toLowerCase() === 'voice'
  )
  if (!threadId || !messageId || !rawLiveText || !hasMediaSource) return null

  const history = safeReadJson(historyPath(root, threadId), null)
  const events = Array.isArray(history?.events) ? history.events : []
  const event = [...events].reverse().find((item) =>
    String(item?.role || '') === 'user' &&
    String(item?.message_id || '') === messageId
  )
  if (!event) return null

  const enrichedText = String(event.text || '').trim()
  const preservedRawText = String(event.raw_text_before_authority_enrichment || '').trim()
  const sourceTags = String(event.text_source || '').split('|').map((value) => value.trim())
  if (!sourceTags.includes('single_control_media_context_enriched')) return null
  if (normalizeText(preservedRawText) !== normalizeText(rawLiveText)) return null
  if (mediaContextAuthorityRank(enrichedText) <= mediaContextAuthorityRank(rawLiveText)) return null

  const expectedTextSha256 = sha256(normalizeText(enrichedText))
  let auditBound = false
  try {
    auditBound = fs.readFileSync(controlEventPath(root, threadId), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => {
        try {
          const audit = JSON.parse(line)
          return (
            audit?.type === 'history_user_media_context_enriched' &&
            String(audit?.message_id || '') === messageId &&
            String(audit?.text_sha256 || '') === expectedTextSha256
          )
        } catch {
          return false
        }
      })
  } catch {
    auditBound = false
  }
  if (!auditBound) return null

  return {
    text: enrichedText,
    text_sha256: expectedTextSha256,
    text_source: 'single_control_media_context_enriched',
    message_id: messageId
  }
}

function readDeliveryReceiptRows(root) {
  const file = path.join(rootPath(root), 'logs', 'delivery-receipts.ndjson')
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ACCEPTED_UNVERIFIED_DELIVERY_RECEIPTS_MAX_BYTES) {
      return { valid: false, reason: 'accepted_unverified_delivery_receipt_ledger_invalid', rows: [] }
    }
    const rows = []
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line)
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { valid: false, reason: 'accepted_unverified_delivery_receipt_row_invalid', rows: [] }
      }
      rows.push(row)
    }
    return { valid: true, reason: 'accepted_unverified_delivery_receipt_ledger_valid', rows }
  } catch {
    return { valid: false, reason: 'accepted_unverified_delivery_receipt_ledger_unreadable', rows: [] }
  }
}

function acceptedUnverifiedReceiptValid(receipt, identity) {
  return Boolean(
    String(receipt?.thread_id || '') === identity.thread_id &&
    String(receipt?.contact_id || '') === identity.contact_id &&
    String(receipt?.message_id || '') === identity.message_id &&
    Number(receipt?.bubble_index) === identity.bubble_index &&
    String(receipt?.text_sha256 || '') === identity.text_sha256 &&
    Number(receipt?.text_length) === identity.text_length &&
    String(receipt?.delivery_status || '') === 'manychat_accepted_unverified' &&
    receipt?.delivery_accepted === true &&
    receipt?.delivery_confirmed === false &&
    Number(receipt?.http_status) === 200 &&
    Number(receipt?.manychat_status) === 200 &&
    String(receipt?.delivery_method || '') === 'manychat_api_accepted_unverified' &&
    receipt?.provider_receipt_id_present === false &&
    !String(receipt?.provider_receipt_id || '') &&
    !String(receipt?.provider_receipt_id_path || '') &&
    /^[a-f0-9]{64}$/i.test(String(receipt?.control_receipt_sha256 || '')) &&
    /^[a-f0-9]{64}$/i.test(String(receipt?.provider_response_sha256 || '')) &&
    /^[a-f0-9]{64}$/i.test(String(receipt?.transport_attempt_id || '')) &&
    Number.isSafeInteger(Number(receipt?.provider_response_size_bytes)) &&
    Number(receipt?.provider_response_size_bytes) > 0 &&
    Number.isFinite(Date.parse(String(receipt?.at || '')))
  )
}

function extractAcceptedUnverifiedProviderReceipt(body) {
  const candidates = [
    ['data', 'message_id'],
    ['data', 'messageId'],
    ['data', 'id'],
    ['data', 0, 'message_id'],
    ['data', 0, 'messageId'],
    ['data', 0, 'id'],
    ['data', 'result', 'message_id'],
    ['data', 'result', 'messageId'],
    ['result', 'message_id'],
    ['result', 'messageId'],
    ['message_id'],
    ['messageId'],
    ['id']
  ]
  for (const segments of candidates) {
    let value = body
    for (const segment of segments) value = value?.[segment]
    if (!['string', 'number', 'bigint'].includes(typeof value)) continue
    const normalized = String(value).trim()
    if (normalized && normalized.length <= 512 && !/[\u0000-\u001f\u007f]/u.test(normalized)) {
      return { present: true, id: normalized, path: segments.join('.') }
    }
  }
  return { present: false, id: '', path: '' }
}

function acceptedUnverifiedProviderResponseValid(root, receipt) {
  const fileName = String(receipt?.provider_response_file || '')
  const responseSha256 = String(receipt?.provider_response_sha256 || '')
  const transportAttemptId = String(receipt?.transport_attempt_id || '')
  const declaredSize = Number(receipt?.provider_response_size_bytes)
  if (
    !fileName || fileName !== path.basename(fileName) ||
    !/^[a-f0-9]{64}$/.test(responseSha256) ||
    !/^[a-f0-9]{64}$/.test(transportAttemptId) ||
    !Number.isSafeInteger(declaredSize) || declaredSize < 1 ||
    declaredSize > ACCEPTED_UNVERIFIED_PROVIDER_RESPONSE_MAX_BYTES ||
    fileName !== `manychat-send-${transportAttemptId}-${responseSha256}.raw.json`
  ) return false

  const directory = path.join(rootPath(root), 'logs', 'provider-send-responses')
  const file = path.join(directory, fileName)
  let descriptor
  try {
    const directoryStat = fs.lstatSync(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o077) !== 0) {
      return false
    }
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size !== declaredSize || (stat.mode & 0o077) !== 0) return false
    const bytes = fs.readFileSync(descriptor)
    if (
      bytes.length !== declaredSize ||
      crypto.createHash('sha256').update(bytes).digest('hex') !== responseSha256
    ) return false
    let body
    try { body = JSON.parse(bytes.toString('utf8')) } catch { return false }
    if (!body || typeof body !== 'object' || Array.isArray(body) || String(body.status || '').toLowerCase() !== 'success') {
      return false
    }
    const providerReceipt = extractAcceptedUnverifiedProviderReceipt(body)
    return providerReceipt.present === false && providerReceipt.id === '' && providerReceipt.path === ''
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
  }
}

function acceptedUnverifiedPendingHash(pending) {
  const material = {
    schema: String(pending?.schema || ''),
    thread_id: String(pending?.thread_id || ''),
    contact_id: String(pending?.contact_id || ''),
    prior_message_id: String(pending?.prior_message_id || ''),
    prior_ingress_at: String(pending?.prior_ingress_at || ''),
    observed_by_message_id: String(pending?.observed_by_message_id || ''),
    observed_inbound_at: String(pending?.observed_inbound_at || ''),
    observed_text_sha256: String(pending?.observed_text_sha256 || ''),
    authentication_source: String(pending?.authentication_source || ''),
    control_receipt_sha256: String(pending?.control_receipt_sha256 || ''),
    control_decision_artifact_sha256: String(pending?.control_decision_artifact_sha256 || ''),
    packet_bubble_count: Number(pending?.packet_bubble_count || 0),
    visible_bubble_count: Number(pending?.visible_bubble_count || 0)
  }
  if (String(pending?.schema || '') !== LEGACY_ACCEPTED_UNVERIFIED_PENDING_SCHEMA) {
    material.first_observed_by_message_id = String(pending?.first_observed_by_message_id || '')
    material.first_observed_inbound_at = String(pending?.first_observed_inbound_at || '')
    material.first_observed_text_sha256 = String(pending?.first_observed_text_sha256 || '')
    material.first_authentication_source = String(pending?.first_authentication_source || '')
  }
  return sha256(JSON.stringify(material))
}

function buildAcceptedUnverifiedPendingObservation(packet, previous, incomingAt, authenticationSource, evidence) {
  const pending = {
    schema: ACCEPTED_UNVERIFIED_PENDING_SCHEMA,
    thread_id: String(packet?.thread_id || packet?.contact_id || ''),
    contact_id: String(packet?.contact_id || packet?.thread_id || ''),
    prior_message_id: String(previous?.latest_ingress_message_id || ''),
    prior_ingress_at: String(previous?.latest_ingress_at || previous?.received_at || ''),
    observed_by_message_id: String(packet?.message_id || ''),
    observed_inbound_at: new Date(incomingAt).toISOString(),
    observed_text_sha256: sha256(normalizeText(packet?.text || '')),
    authentication_source: String(authenticationSource || ''),
    first_observed_by_message_id: String(packet?.message_id || ''),
    first_observed_inbound_at: new Date(incomingAt).toISOString(),
    first_observed_text_sha256: sha256(normalizeText(packet?.text || '')),
    first_authentication_source: String(authenticationSource || ''),
    control_receipt_sha256: String(evidence?.control_receipt_sha256 || ''),
    control_decision_artifact_sha256: String(evidence?.control_decision_artifact_sha256 || ''),
    packet_bubble_count: Number(evidence?.packet_bubble_count || evidence?.bubble_count || 0),
    visible_bubble_count: Number(evidence?.visible_bubble_count || evidence?.bubble_count || 0)
  }
  pending.pending_sha256 = acceptedUnverifiedPendingHash(pending)
  return pending
}

function validAcceptedUnverifiedPending(pending, threadId = '') {
  const schema = String(pending?.schema || '')
  const legacy = schema === LEGACY_ACCEPTED_UNVERIFIED_PENDING_SCHEMA
  const current = schema === ACCEPTED_UNVERIFIED_PENDING_SCHEMA
  const firstObservedAt = parseTime(pending?.first_observed_inbound_at)
  const observedAt = parseTime(pending?.observed_inbound_at)
  const currentCorrelationValid = legacy || Boolean(
    String(pending?.first_observed_by_message_id || '') &&
    String(pending?.first_observed_text_sha256 || '').match(/^[a-f0-9]{64}$/i) &&
    AUTHENTICATED_INGRESS_SOURCES.has(String(pending?.first_authentication_source || '')) &&
    firstObservedAt > parseTime(pending?.prior_ingress_at) &&
    observedAt >= firstObservedAt &&
    (
      (
        String(pending?.observed_by_message_id || '') !== String(pending?.first_observed_by_message_id || '') &&
        observedAt > firstObservedAt
      ) ||
      (
        String(pending?.observed_inbound_at || '') === String(pending?.first_observed_inbound_at || '') &&
        String(pending?.observed_text_sha256 || '') === String(pending?.first_observed_text_sha256 || '') &&
        String(pending?.authentication_source || '') === String(pending?.first_authentication_source || '')
      )
    )
  )
  return Boolean(
    pending && typeof pending === 'object' && !Array.isArray(pending) &&
    (legacy || current) && currentCorrelationValid &&
    (!threadId || String(pending.thread_id || '') === String(threadId)) &&
    String(pending.thread_id || '') && String(pending.contact_id || '') &&
    String(pending.prior_message_id || '') && String(pending.observed_by_message_id || '') &&
    pending.prior_message_id !== pending.observed_by_message_id &&
    parseTime(pending.prior_ingress_at) > 0 && parseTime(pending.observed_inbound_at) > parseTime(pending.prior_ingress_at) &&
    /^[a-f0-9]{64}$/i.test(String(pending.observed_text_sha256 || '')) &&
    AUTHENTICATED_INGRESS_SOURCES.has(String(pending.authentication_source || '')) &&
    /^[a-f0-9]{64}$/i.test(String(pending.control_receipt_sha256 || '')) &&
    /^[a-f0-9]{64}$/i.test(String(pending.control_decision_artifact_sha256 || '')) &&
    Number.isInteger(Number(pending.packet_bubble_count)) &&
    Number(pending.packet_bubble_count) >= 1 && Number(pending.packet_bubble_count) <= 4 &&
    Number.isInteger(Number(pending.visible_bubble_count)) &&
    Number(pending.visible_bubble_count) >= 1 &&
    Number(pending.visible_bubble_count) <= Number(pending.packet_bubble_count) &&
    String(pending.pending_sha256 || '') === acceptedUnverifiedPendingHash(pending)
  )
}

function readAcceptedUnverifiedPending(root, threadId) {
  const file = acceptedUnverifiedPendingPath(root, threadId)
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 || (stat.mode & 0o077) !== 0) return null
    const pending = JSON.parse(fs.readFileSync(file, 'utf8'))
    return validAcceptedUnverifiedPending(pending, threadId) ? pending : null
  } catch {
    return null
  }
}

function persistAcceptedUnverifiedPending(root, pending) {
  if (!validAcceptedUnverifiedPending(pending, pending?.thread_id)) {
    throw new Error('accepted_unverified_pending_invalid')
  }
  return durableAtomicWriteJson(acceptedUnverifiedPendingPath(root, pending.thread_id), pending)
}

function clearAcceptedUnverifiedPending(root, threadId) {
  const file = acceptedUnverifiedPendingPath(root, threadId)
  try {
    fs.unlinkSync(file)
    const directory = path.dirname(file)
    let descriptor
    try {
      descriptor = fs.openSync(directory, fs.constants.O_RDONLY)
      fs.fsyncSync(descriptor)
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor)
    }
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function advanceAcceptedUnverifiedPendingObservationUnlocked(root, packet, incomingAt, options, history) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  const incomingMessageId = String(packet?.message_id || '').trim()
  const authenticationSource = String(options?.authentication_source || '')
  const pending = readAcceptedUnverifiedPending(root, threadId)
  const noChange = (reason) => ({ advanced: false, reason, pending })
  if (!pending) return noChange('accepted_unverified_pending_absent')
  if (options?.authenticated_inbound !== true || !AUTHENTICATED_INGRESS_SOURCES.has(authenticationSource)) {
    return noChange('accepted_unverified_pending_advance_requires_authenticated_inbound')
  }

  const firstObservedBy = String(
    pending.first_observed_by_message_id || pending.observed_by_message_id || ''
  )
  const firstObservedAt = String(
    pending.first_observed_inbound_at || pending.observed_inbound_at || ''
  )
  const firstObservedTextSha256 = String(
    pending.first_observed_text_sha256 || pending.observed_text_sha256 || ''
  )
  const firstAuthenticationSource = String(
    pending.first_authentication_source || pending.authentication_source || ''
  )
  if (
    !incomingMessageId || incomingMessageId === String(pending.prior_message_id || '') ||
    incomingMessageId === String(pending.observed_by_message_id || '') ||
    String(pending.observed_by_message_id || '') !== firstObservedBy ||
    !(incomingAt > parseTime(firstObservedAt))
  ) return noChange('accepted_unverified_pending_advance_not_distinct_newer_observer')

  const events = Array.isArray(history?.events) ? history.events : []
  const firstObservers = events.filter((event) =>
    event?.role === 'user' && String(event?.message_id || '') === firstObservedBy
  )
  if (
    firstObservers.length !== 1 ||
    String(firstObservers[0]?.at || '') !== firstObservedAt ||
    sha256(normalizeText(firstObservers[0]?.text || '')) !== firstObservedTextSha256
  ) return noChange('accepted_unverified_pending_advance_first_observer_missing')
  const newerUsers = events.filter((event) =>
    event?.role === 'user' && parseTime(event?.at) > parseTime(pending.prior_ingress_at)
  )
  if (
    newerUsers.length < 1 ||
    String(newerUsers[0]?.message_id || '') !== firstObservedBy
  ) return noChange('accepted_unverified_pending_advance_intervening_user_ambiguous')

  const deliveryLedger = readDeliveryReceiptRows(root)
  if (!deliveryLedger.valid) return noChange(deliveryLedger.reason)
  const receipts = deliveryLedger.rows.filter((row) =>
    String(row?.thread_id || '') === threadId &&
    String(row?.message_id || '') === String(pending.prior_message_id || '')
  )
  if (receipts.length !== Number(pending.visible_bubble_count)) {
    return noChange('accepted_unverified_pending_advance_receipt_count_ambiguous')
  }
  const indexes = new Set()
  let sawAcceptedUnverified = false
  let latestResponseAt = 0
  for (const receipt of receipts) {
    const bubbleIndex = Number(receipt?.bubble_index)
    const responseAt = parseTime(receipt?.transport_response_received_at || receipt?.at)
    if (
      !Number.isInteger(bubbleIndex) || bubbleIndex < 0 || bubbleIndex > 3 || indexes.has(bubbleIndex) ||
      String(receipt?.control_receipt_sha256 || '') !== String(pending.control_receipt_sha256 || '') ||
      !(responseAt > 0 && incomingAt > responseAt)
    ) return noChange('accepted_unverified_pending_advance_receipt_binding_invalid')
    indexes.add(bubbleIndex)
    latestResponseAt = Math.max(latestResponseAt, responseAt)
    if (String(receipt?.delivery_status || '') === 'manychat_accepted_unverified') {
      if (!acceptedUnverifiedProviderResponseValid(root, receipt)) {
        return noChange('accepted_unverified_pending_advance_provider_response_invalid')
      }
      sawAcceptedUnverified = true
    } else if (!(receipt?.delivery_confirmed === true && String(receipt?.delivery_status || '') === 'success_visible')) {
      return noChange('accepted_unverified_pending_advance_terminal_status_invalid')
    }
  }
  if (!sawAcceptedUnverified || !(latestResponseAt > parseTime(firstObservedAt))) {
    return noChange('accepted_unverified_pending_advance_no_late_accepted_delivery')
  }

  const decision = readControlDecisionArtifact(root, String(pending.control_receipt_sha256 || ''))
  if (
    !decision.valid ||
    String(decision.artifact?.thread_id || '') !== threadId ||
    String(decision.artifact?.message_id || '') !== String(pending.prior_message_id || '') ||
    String(decision.artifact?.artifact_sha256 || '') !== String(pending.control_decision_artifact_sha256 || '') ||
    (Array.isArray(decision.artifact?.packet?.bubbles) ? decision.artifact.packet.bubbles.length : 0) !==
      Number(pending.packet_bubble_count)
  ) return noChange('accepted_unverified_pending_advance_control_binding_invalid')

  const advanced = {
    ...pending,
    schema: ACCEPTED_UNVERIFIED_PENDING_SCHEMA,
    observed_by_message_id: incomingMessageId,
    observed_inbound_at: new Date(incomingAt).toISOString(),
    observed_text_sha256: sha256(normalizeText(packet?.text || '')),
    authentication_source: authenticationSource,
    first_observed_by_message_id: firstObservedBy,
    first_observed_inbound_at: firstObservedAt,
    first_observed_text_sha256: firstObservedTextSha256,
    first_authentication_source: firstAuthenticationSource
  }
  advanced.pending_sha256 = acceptedUnverifiedPendingHash(advanced)
  persistAcceptedUnverifiedPending(root, advanced)
  appendControlAuditUnlocked(root, threadId, {
    type: 'accepted_unverified_pending_observer_advanced',
    message_id: String(advanced.prior_message_id || ''),
    first_observed_by_message_id: firstObservedBy,
    observed_by_message_id: incomingMessageId,
    authentication_source: authenticationSource,
    no_resend: true
  })
  return { advanced: true, reason: 'accepted_unverified_pending_observer_advanced', pending: advanced }
}

function deliveryPublicationHash(publication) {
  return sha256(JSON.stringify({
    schema: String(publication?.schema || ''),
    publication_id: String(publication?.publication_id || ''),
    thread_id: String(publication?.thread_id || ''),
    contact_id: String(publication?.contact_id || ''),
    message_id: String(publication?.message_id || ''),
    bubble_index: Number(publication?.bubble_index),
    text_sha256: String(publication?.text_sha256 || ''),
    control_receipt_sha256: String(publication?.control_receipt_sha256 || ''),
    control_decision_artifact_sha256: String(publication?.control_decision_artifact_sha256 || ''),
    packet_bubble_count: Number(publication?.packet_bubble_count || 0),
    started_at: String(publication?.started_at || '')
  }))
}

function validDeliveryPublication(publication, threadId = '') {
  return Boolean(
    publication && typeof publication === 'object' && !Array.isArray(publication) &&
    publication.schema === DELIVERY_PUBLICATION_SCHEMA &&
    /^[a-f0-9]{64}$/i.test(String(publication.publication_id || '')) &&
    String(publication.thread_id || '') && (!threadId || String(publication.thread_id) === String(threadId)) &&
    String(publication.contact_id || '') && String(publication.message_id || '') &&
    Number.isInteger(Number(publication.bubble_index)) && Number(publication.bubble_index) >= 0 && Number(publication.bubble_index) <= 3 &&
    /^[a-f0-9]{64}$/i.test(String(publication.text_sha256 || '')) &&
    /^[a-f0-9]{64}$/i.test(String(publication.control_receipt_sha256 || '')) &&
    /^[a-f0-9]{64}$/i.test(String(publication.control_decision_artifact_sha256 || '')) &&
    Number.isInteger(Number(publication.packet_bubble_count)) && Number(publication.packet_bubble_count) >= 1 && Number(publication.packet_bubble_count) <= 4 &&
    parseTime(publication.started_at) > 0 &&
    String(publication.publication_sha256 || '') === deliveryPublicationHash(publication)
  )
}

function readDeliveryPublication(root, threadId) {
  const file = deliveryPublicationPath(root, threadId)
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 || (stat.mode & 0o077) !== 0) return null
    const publication = JSON.parse(fs.readFileSync(file, 'utf8'))
    return validDeliveryPublication(publication, threadId) ? publication : null
  } catch {
    return null
  }
}

function beginAcceptedUnverifiedDeliveryPublication(root, packet) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  if (!threadId) throw new Error('delivery_publication_thread_missing')
  return withThreadControlLock(root, threadId, () => {
    if (readDeliveryPublication(root, threadId)) throw new Error('delivery_publication_already_active')
    const currentState = readControlState(root, threadId)
    if (
      String(currentState?.latest_ingress_message_id || '') !== String(packet?.message_id || '') ||
      Number(currentState?.ingress_revision || 0) !== Number(packet?.control_receipt?.ingress_revision || 0)
    ) throw new Error('delivery_publication_stale_against_latest_ingress')
    const controlReceiptSha256 = String(packet?.control_receipt?.receipt_sha256 || '')
    const decision = readControlDecisionArtifact(root, controlReceiptSha256)
    if (!decision.valid) throw new Error(`delivery_publication_${decision.reason}`)
    const bubbles = Array.isArray(decision.artifact?.packet?.bubbles) ? decision.artifact.packet.bubbles : []
    const bubbleIndex = Number(packet?.bubble_index)
    if (
      String(decision.artifact?.thread_id || '') !== threadId ||
      String(decision.artifact?.message_id || '') !== String(packet?.message_id || '') ||
      !Number.isInteger(bubbleIndex) || bubbleIndex < 0 || bubbleIndex >= bubbles.length ||
      String(packet?.bubble?.text || '') !== String(bubbles[bubbleIndex]?.text || '')
    ) throw new Error('delivery_publication_packet_binding_invalid')
    const receiptVerdict = validateControlReceipt({
      source: SCV_SINGLE_CONTROL_SOURCE,
      thread_id: threadId,
      message_id: String(packet?.message_id || ''),
      bubbles,
      bubble: packet.bubble,
      bubble_index: bubbleIndex,
      control_receipt: decision.artifact.control_receipt
    }, { root, requireLedger: true, requirePayload: true })
    if (!receiptVerdict.valid) throw new Error(`delivery_publication_${receiptVerdict.reason}`)
    const publication = {
      schema: DELIVERY_PUBLICATION_SCHEMA,
      publication_id: crypto.randomBytes(32).toString('hex'),
      thread_id: threadId,
      contact_id: String(packet?.contact_id || packet?.thread_id || ''),
      message_id: String(packet?.message_id || ''),
      bubble_index: bubbleIndex,
      text_sha256: sha256(String(packet?.bubble?.text || '')),
      control_receipt_sha256: controlReceiptSha256,
      control_decision_artifact_sha256: String(decision.artifact.artifact_sha256 || ''),
      packet_bubble_count: bubbles.length,
      started_at: new Date().toISOString()
    }
    publication.publication_sha256 = deliveryPublicationHash(publication)
    durableAtomicWriteJson(deliveryPublicationPath(root, threadId), publication)
    return publication
  })
}

function clearDeliveryPublicationUnlocked(root, threadId, publicationId, clearObserverPending = false) {
  const publication = readDeliveryPublication(root, threadId)
  if (!publication) return false
  if (String(publication.publication_id || '') !== String(publicationId || '')) {
    throw new Error('delivery_publication_owner_mismatch')
  }
  const file = deliveryPublicationPath(root, threadId)
  fs.unlinkSync(file)
  if (clearObserverPending) {
    const pending = readAcceptedUnverifiedPending(root, threadId)
    if (
      pending &&
      String(pending.prior_message_id || '') === String(publication.message_id || '') &&
      String(pending.control_receipt_sha256 || '') === String(publication.control_receipt_sha256 || '')
    ) clearAcceptedUnverifiedPending(root, threadId)
  }
  return true
}

function clearAcceptedUnverifiedDeliveryPublication(root, packet, publicationId) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  if (!threadId) return false
  return withThreadControlLock(root, threadId, () =>
    clearDeliveryPublicationUnlocked(root, threadId, publicationId, true)
  )
}

function recoverPreNetworkDeliveryPublication(root, packet) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  if (!threadId) return { recovered: false, ambiguous: false, reason: 'delivery_publication_thread_missing' }
  return withThreadControlLock(root, threadId, () => {
    const publication = readDeliveryPublication(root, threadId)
    if (!publication) return { recovered: false, ambiguous: false, reason: 'delivery_publication_absent' }
    if (
      String(publication.message_id || '') !== String(packet?.message_id || '') ||
      Number(publication.bubble_index) !== Number(packet?.bubble_index) ||
      String(publication.text_sha256 || '') !== sha256(String(packet?.bubble?.text || '')) ||
      String(publication.control_receipt_sha256 || '') !== String(packet?.control_receipt?.receipt_sha256 || '')
    ) return { recovered: false, ambiguous: true, reason: 'delivery_publication_packet_mismatch' }
    const ledger = path.join(rootPath(root), 'logs', 'transport-attempts.ndjson')
    let attemptExists = false
    try {
      if (fs.existsSync(ledger)) {
        const stat = fs.lstatSync(ledger)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ACCEPTED_UNVERIFIED_DELIVERY_RECEIPTS_MAX_BYTES) {
          return { recovered: false, ambiguous: true, reason: 'delivery_publication_attempt_ledger_invalid' }
        }
        attemptExists = fs.readFileSync(ledger, 'utf8').split(/\r?\n/).filter(Boolean).some((line) => {
          const row = JSON.parse(line)
          return row?.record_type === 'attempt_started' &&
            String(row?.contact_id || '') === String(packet?.contact_id || '') &&
            String(row?.message_id || '') === String(packet?.message_id || '') &&
            Number(row?.bubble_index) === Number(packet?.bubble_index) &&
            String(row?.text_sha256 || '') === sha256(String(packet?.bubble?.text || ''))
        })
      }
    } catch {
      return { recovered: false, ambiguous: true, reason: 'delivery_publication_attempt_ledger_unreadable' }
    }
    if (attemptExists) {
      return { recovered: false, ambiguous: true, reason: 'delivery_publication_transport_attempt_exists' }
    }
    clearDeliveryPublicationUnlocked(root, threadId, publication.publication_id, true)
    return { recovered: true, ambiguous: false, reason: 'delivery_publication_pre_network_crash_recovered' }
  })
}

function pendingEvidenceFromDeliveryPublicationUnlocked(root, packet, previous, incomingAt, options, history) {
  const publication = readDeliveryPublication(root, String(packet?.thread_id || packet?.contact_id || ''))
  if (!publication) return null
  if (
    options?.authenticated_inbound !== true ||
    !AUTHENTICATED_INGRESS_SOURCES.has(String(options?.authentication_source || '')) ||
    String(publication.message_id || '') !== String(previous?.latest_ingress_message_id || '') ||
    String(packet?.message_id || '') === String(publication.message_id || '') ||
    incomingAt <= parseTime(previous?.latest_ingress_at || previous?.received_at)
  ) return null
  const events = Array.isArray(history?.events) ? history.events : []
  const priorUserIndexes = []
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.role === 'user' &&
        String(events[index]?.message_id || '') === String(publication.message_id || '')) {
      priorUserIndexes.push(index)
    }
  }
  if (priorUserIndexes.length !== 1) return null
  const priorUserIndex = priorUserIndexes[0]
  let boundaryIndex = -1
  for (let index = priorUserIndex - 1; index >= 0; index -= 1) {
    if (isConversationVisibleAssistantEvent(events[index])) { boundaryIndex = index; break }
  }
  if (priorUserIndex !== boundaryIndex + 1) return null
  const priorAttempts = events.slice(priorUserIndex + 1)
  if (!priorAttempts.every((event) => {
    if (String(event?.message_id || '') !== String(publication.message_id || '')) return false
    if (event?.role === 'assistant') return isConversationVisibleAssistantEvent(event)
    return event?.role === 'assistant_attempted' &&
      String(event?.delivery_status || '') === 'manychat_accepted_unverified' &&
      isConversationVisibleAssistantEvent(event) === false
  })) return null
  const visibleIndexes = new Set(priorAttempts.map((event) => Number(event?.bubble_index)))
  if (
    visibleIndexes.size !== priorAttempts.length ||
    visibleIndexes.has(Number(publication.bubble_index)) ||
    priorAttempts.length + 1 > Number(publication.packet_bubble_count)
  ) return null
  return {
    control_receipt_sha256: String(publication.control_receipt_sha256 || ''),
    control_decision_artifact_sha256: String(publication.control_decision_artifact_sha256 || ''),
    packet_bubble_count: Number(publication.packet_bubble_count || 0),
    visible_bubble_count: priorAttempts.length + 1
  }
}

function partialAcceptedUnverifiedEvidenceUnlocked(root, packet, previous, incomingAt, options, history) {
  const authenticationSource = String(options?.authentication_source || '')
  if (options?.authenticated_inbound !== true || !AUTHENTICATED_INGRESS_SOURCES.has(authenticationSource)) return null
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  const contactId = String(packet?.contact_id || packet?.thread_id || '')
  const priorMessageId = String(previous?.latest_ingress_message_id || '')
  const incomingMessageId = String(packet?.message_id || '')
  const priorIngressAt = parseTime(previous?.latest_ingress_at || previous?.received_at)
  if (!threadId || !priorMessageId || !incomingMessageId || priorMessageId === incomingMessageId) return null
  if (!(incomingAt > 0 && priorIngressAt > 0 && incomingAt > priorIngressAt)) return null

  const events = Array.isArray(history?.events) ? history.events : []
  let boundaryIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (isConversationVisibleAssistantEvent(events[index])) {
      boundaryIndex = index
      break
    }
  }
  const suffix = events.slice(boundaryIndex + 1)
  const firstAttempt = suffix.findIndex((event) => event?.role !== 'user')
  if (firstAttempt !== 1) return null
  const userEvents = suffix.slice(0, firstAttempt)
  const attemptEvents = suffix.slice(firstAttempt)
  if (
    userEvents[0]?.role !== 'user' ||
    String(userEvents[0]?.message_id || '') !== priorMessageId ||
    attemptEvents.length < 1 || attemptEvents.length > 3
  ) return null
  if (!attemptEvents.every((event) =>
    event?.role === 'assistant_attempted' &&
    String(event?.delivery_status || '') === 'manychat_accepted_unverified' &&
    !event?.accepted_unverified_conversation_boundary &&
    String(event?.text || '').length > 0 &&
    parseTime(event?.at) >= parseTime(userEvents[0]?.at) &&
    incomingAt > parseTime(event?.at)
  )) return null

  const deliveryLedger = readDeliveryReceiptRows(root)
  if (!deliveryLedger.valid) return null
  const receipts = deliveryLedger.rows.filter((row) =>
    String(row?.thread_id || '') === threadId && String(row?.message_id || '') === priorMessageId
  )
  if (receipts.length !== attemptEvents.length) return null
  const receiptsByBubble = new Map()
  for (const receipt of receipts) {
    const index = Number(receipt?.bubble_index)
    if (!Number.isInteger(index) || receiptsByBubble.has(index)) return null
    receiptsByBubble.set(index, receipt)
  }

  const controlReceipts = new Set()
  for (const event of attemptEvents) {
    const bubbleIndex = Number(event?.bubble_index)
    const text = String(event?.text || '')
    const receipt = receiptsByBubble.get(bubbleIndex)
    if (!acceptedUnverifiedReceiptValid(receipt, {
      thread_id: threadId,
      contact_id: contactId,
      message_id: priorMessageId,
      bubble_index: bubbleIndex,
      text_sha256: sha256(text),
      text_length: text.length
    })) return null
    if (!acceptedUnverifiedProviderResponseValid(root, receipt)) return null
    if (parseTime(receipt.at) < parseTime(event.at) || incomingAt <= parseTime(receipt.at)) return null
    controlReceipts.add(String(receipt.control_receipt_sha256 || ''))
  }
  if (controlReceipts.size !== 1) return null
  const controlReceiptSha256 = Array.from(controlReceipts)[0]
  const decision = readControlDecisionArtifact(root, controlReceiptSha256)
  if (!decision.valid) return null
  const artifact = decision.artifact
  const bubbles = Array.isArray(artifact?.packet?.bubbles) ? artifact.packet.bubbles : []
  if (
    String(artifact?.thread_id || '') !== threadId ||
    String(artifact?.message_id || '') !== priorMessageId ||
    bubbles.length <= attemptEvents.length || bubbles.length > 4 ||
    String(artifact?.control_receipt?.receipt_sha256 || '') !== controlReceiptSha256 ||
    !controlAuditContainsReceipt(root, threadId, controlReceiptSha256)
  ) return null
  const receiptVerdict = validateControlReceipt({
    source: SCV_SINGLE_CONTROL_SOURCE,
    thread_id: threadId,
    message_id: priorMessageId,
    bubbles,
    control_receipt: artifact.control_receipt
  }, { root, requireLedger: true, requirePayload: true })
  if (!receiptVerdict.valid) return null
  const seenIndexes = new Set()
  for (const event of attemptEvents) {
    const index = Number(event?.bubble_index)
    if (!Number.isInteger(index) || index < 0 || index >= bubbles.length || seenIndexes.has(index)) return null
    seenIndexes.add(index)
    if (String(event.text || '') !== String(bubbles[index]?.text || '')) return null
  }
  return {
    control_receipt_sha256: controlReceiptSha256,
    control_decision_artifact_sha256: String(artifact.artifact_sha256 || ''),
    packet_bubble_count: bubbles.length
  }
}

function reconcileAcceptedUnverifiedBoundaryUnlocked(root, packet, previous, incomingAt, options, history) {
  const noChange = (reason) => ({ applied: false, reason, bubble_count: 0 })
  const authenticationSource = String(options?.authentication_source || '')
  if (options?.authenticated_inbound !== true || !AUTHENTICATED_INGRESS_SOURCES.has(authenticationSource)) {
    return noChange('accepted_unverified_boundary_requires_authenticated_inbound')
  }

  const incomingMessageId = String(packet?.message_id || '').trim()
  const priorMessageId = String(previous?.latest_ingress_message_id || '').trim()
  const priorIngressAt = parseTime(previous?.latest_ingress_at || previous?.received_at)
  if (!incomingMessageId || !priorMessageId || incomingMessageId === priorMessageId) {
    return noChange('accepted_unverified_boundary_requires_distinct_message_id')
  }
  if (!(incomingAt > 0 && priorIngressAt > 0 && incomingAt > priorIngressAt)) {
    return noChange('accepted_unverified_boundary_requires_strictly_newer_ingress')
  }

  const events = Array.isArray(history?.events) ? history.events : []
  const pendingObservation = options?.pending_observation
  let deferredFirstObservation = null
  let userEvents
  let attemptEvents
  let confirmedEvents = []
  if (pendingObservation) {
    if (
      !validAcceptedUnverifiedPending(pendingObservation, String(packet?.thread_id || packet?.contact_id || '')) ||
      String(pendingObservation.prior_message_id || '') !== priorMessageId ||
      String(pendingObservation.observed_by_message_id || '') !== incomingMessageId ||
      String(pendingObservation.authentication_source || '') !== authenticationSource ||
      String(pendingObservation.observed_inbound_at || '') !== new Date(incomingAt).toISOString()
    ) return noChange('accepted_unverified_boundary_pending_observation_invalid')
    const observedUsers = events.filter((event) =>
      event?.role === 'user' && String(event?.message_id || '') === incomingMessageId
    )
    if (
      observedUsers.length !== 1 ||
      sha256(normalizeText(observedUsers[0]?.text || '')) !== String(pendingObservation.observed_text_sha256 || '') ||
      String(observedUsers[0]?.at || '') !== String(pendingObservation.observed_inbound_at || '')
    ) return noChange('accepted_unverified_boundary_pending_observer_history_missing')
    const firstObservedBy = String(
      pendingObservation.first_observed_by_message_id || pendingObservation.observed_by_message_id || ''
    )
    if (firstObservedBy !== incomingMessageId) {
      const firstObservedUsers = events.filter((event) =>
        event?.role === 'user' && String(event?.message_id || '') === firstObservedBy
      )
      if (
        firstObservedUsers.length !== 1 ||
        sha256(normalizeText(firstObservedUsers[0]?.text || '')) !== String(pendingObservation.first_observed_text_sha256 || '') ||
        String(firstObservedUsers[0]?.at || '') !== String(pendingObservation.first_observed_inbound_at || '') ||
        parseTime(pendingObservation.first_observed_inbound_at) >= incomingAt
      ) return noChange('accepted_unverified_boundary_first_observer_history_missing')
      const interveningUsers = events.filter((event) => {
        if (event?.role !== 'user') return false
        const at = parseTime(event?.at)
        return at > priorIngressAt && at <= incomingAt
      })
      if (
        interveningUsers.length < 2 ||
        String(interveningUsers[0]?.message_id || '') !== firstObservedBy ||
        String(interveningUsers[interveningUsers.length - 1]?.message_id || '') !== incomingMessageId
      ) return noChange('accepted_unverified_boundary_intervening_user_ambiguous')
      deferredFirstObservation = {
        message_id: firstObservedBy,
        at: String(pendingObservation.first_observed_inbound_at || '')
      }
    }
    const priorEvents = events.filter((event) => String(event?.message_id || '') === priorMessageId)
    userEvents = priorEvents.filter((event) => event?.role === 'user')
    confirmedEvents = priorEvents.filter((event) => event?.role === 'assistant')
    attemptEvents = priorEvents.filter((event) => !['user', 'assistant'].includes(event?.role))
  } else {
    let boundaryIndex = -1
    for (let index = events.length - 1; index >= 0; index -= 1) {
      // A confirmed bubble from the same packet is part of the packet union,
      // not the boundary before that packet. Starting after it would orphan a
      // later accepted-unverified bubble and lose the original user turn.
      if (
        isConversationVisibleAssistantEvent(events[index]) &&
        String(events[index]?.message_id || '') !== priorMessageId
      ) {
        boundaryIndex = index
        break
      }
    }
    const suffix = events.slice(boundaryIndex + 1)
    if (!suffix.length) return noChange('accepted_unverified_boundary_history_suffix_empty')
    const firstAttempt = suffix.findIndex((event) => event?.role !== 'user')
    if (firstAttempt < 1) return noChange('accepted_unverified_boundary_prior_user_missing')
    userEvents = suffix.slice(0, firstAttempt)
    const packetEvents = suffix.slice(firstAttempt)
    if (!packetEvents.every((event) =>
      String(event?.message_id || '') === priorMessageId &&
      ['assistant', 'assistant_attempted'].includes(String(event?.role || ''))
    )) return noChange('accepted_unverified_boundary_packet_union_ambiguous')
    confirmedEvents = packetEvents.filter((event) => event?.role === 'assistant')
    attemptEvents = packetEvents.filter((event) => event?.role === 'assistant_attempted')
  }
  if (!userEvents.every((event) => event?.role === 'user')) {
    return noChange('accepted_unverified_boundary_user_suffix_ambiguous')
  }
  // A real Instagram turn can contain several authenticated user events before
  // ManyChat's accepted response becomes observable. The reply marker below is
  // still scoped to priorMessageId, so earlier unanswered message IDs remain
  // pending instead of being incorrectly closed by this boundary.
  if (userEvents.length < 1) {
    return noChange('accepted_unverified_boundary_requires_prior_user_turn')
  }
  if (attemptEvents.length < 1 || attemptEvents.length > 4) {
    return noChange('accepted_unverified_boundary_packet_size_invalid')
  }
  if (!attemptEvents.every((event) =>
    event?.role === 'assistant_attempted' &&
    String(event?.delivery_status || '') === 'manychat_accepted_unverified' &&
    !event?.accepted_unverified_conversation_boundary &&
    String(event?.message_id || '').trim() === priorMessageId &&
    String(event?.text || event?.message || '').length > 0
  )) return noChange('accepted_unverified_boundary_attempt_group_ambiguous')

  const lastUser = userEvents[userEvents.length - 1]
  if (String(lastUser?.message_id || '').trim() !== priorMessageId) {
    return noChange('accepted_unverified_boundary_attempt_user_mismatch')
  }

  const orderedAttempts = attemptEvents.slice().sort((left, right) =>
    Number(left?.bubble_index) - Number(right?.bubble_index)
  )
  const orderedConfirmed = confirmedEvents.slice().sort((left, right) =>
    Number(left?.bubble_index) - Number(right?.bubble_index)
  )
  const deliveredIndexes = orderedAttempts.concat(orderedConfirmed).map((event) => Number(event?.bubble_index))
  if (
    !deliveredIndexes.every((index) => Number.isInteger(index) && index >= 0 && index <= 3) ||
    new Set(deliveredIndexes).size !== deliveredIndexes.length
  ) return noChange('accepted_unverified_boundary_packet_union_index_set_invalid')
  const visibleBubbleIndexes = orderedAttempts.map((event) => Number(event?.bubble_index))
  if (!visibleBubbleIndexes.every((index) => Number.isInteger(index) && index >= 0 && index <= 3) ||
      new Set(visibleBubbleIndexes).size !== visibleBubbleIndexes.length) {
    return noChange('accepted_unverified_boundary_bubble_index_set_invalid')
  }
  if (!orderedAttempts.every((event) => {
    const attemptedAt = parseTime(event?.at)
    return attemptedAt > 0 && incomingAt > attemptedAt
  })) return noChange('accepted_unverified_boundary_attempt_not_before_inbound')
  const priorUserAt = parseTime(lastUser?.at)
  if (!priorUserAt || !orderedAttempts.every((event) => parseTime(event?.at) >= priorUserAt)) {
    return noChange('accepted_unverified_boundary_user_attempt_chronology_invalid')
  }

  const deliveryLedger = readDeliveryReceiptRows(root)
  if (!deliveryLedger.valid) return noChange(deliveryLedger.reason)
  const packetReceipts = deliveryLedger.rows.filter((row) =>
    String(row?.thread_id || '') === String(packet?.thread_id || packet?.contact_id || '') &&
    String(row?.message_id || '') === priorMessageId
  )
  const acceptedPacketReceipts = packetReceipts.filter((row) =>
    String(row?.delivery_status || '') === 'manychat_accepted_unverified'
  )
  const confirmedPacketReceipts = packetReceipts.filter((row) =>
    row?.delivery_confirmed === true && String(row?.delivery_status || '') === 'success_visible'
  )
  if (
    packetReceipts.length !== orderedAttempts.length + confirmedEvents.length ||
    acceptedPacketReceipts.length !== orderedAttempts.length ||
    confirmedPacketReceipts.length !== confirmedEvents.length
  ) {
    return noChange('accepted_unverified_boundary_delivery_receipt_count_ambiguous')
  }

  const receiptsByBubble = new Map()
  for (const receipt of acceptedPacketReceipts) {
    const bubbleIndex = Number(receipt?.bubble_index)
    if (!Number.isInteger(bubbleIndex) || receiptsByBubble.has(bubbleIndex)) {
      return noChange('accepted_unverified_boundary_delivery_receipt_index_ambiguous')
    }
    receiptsByBubble.set(bubbleIndex, receipt)
  }

  const confirmedReceiptsByBubble = new Map()
  for (const receipt of confirmedPacketReceipts) {
    const index = Number(receipt?.bubble_index)
    if (!Number.isInteger(index) || confirmedReceiptsByBubble.has(index)) {
      return noChange('accepted_unverified_boundary_confirmed_receipt_index_ambiguous')
    }
    confirmedReceiptsByBubble.set(index, receipt)
  }
  const controlReceiptSet = new Set()
  const receiptEvidence = []
  let latestAcceptedDeliveryAt = 0
  for (const event of orderedAttempts) {
    const bubbleIndex = Number(event.bubble_index)
    const text = String(event.text || event.message || '')
    const receipt = receiptsByBubble.get(bubbleIndex)
    const identity = {
      thread_id: String(packet?.thread_id || packet?.contact_id || ''),
      contact_id: String(packet?.contact_id || packet?.thread_id || ''),
      message_id: priorMessageId,
      bubble_index: bubbleIndex,
      text_sha256: sha256(text),
      text_length: text.length
    }
    if (!acceptedUnverifiedReceiptValid(receipt, identity)) {
      return noChange('accepted_unverified_boundary_delivery_receipt_binding_invalid')
    }
    if (!acceptedUnverifiedProviderResponseValid(root, receipt)) {
      return noChange('accepted_unverified_boundary_provider_response_binding_invalid')
    }
    const deliveryAcceptedAt = parseTime(receipt.transport_response_received_at || receipt.at)
    if (!(incomingAt > deliveryAcceptedAt)) {
      return noChange('accepted_unverified_boundary_receipt_not_before_inbound')
    }
    if (deliveryAcceptedAt < parseTime(event.at)) {
      return noChange('accepted_unverified_boundary_attempt_receipt_chronology_invalid')
    }
    latestAcceptedDeliveryAt = Math.max(latestAcceptedDeliveryAt, deliveryAcceptedAt)
    controlReceiptSet.add(String(receipt.control_receipt_sha256 || ''))
    receiptEvidence.push({ event, receipt, receipt_sha256: sha256(JSON.stringify(receipt)) })
  }
  if (controlReceiptSet.size !== 1) {
    return noChange('accepted_unverified_boundary_control_receipt_ambiguous')
  }

  const controlReceiptSha256 = Array.from(controlReceiptSet)[0]
  if (
    deferredFirstObservation &&
    !(latestAcceptedDeliveryAt > parseTime(deferredFirstObservation.at) && incomingAt > latestAcceptedDeliveryAt)
  ) return noChange('accepted_unverified_boundary_deferred_observer_chronology_invalid')
  for (const event of confirmedEvents) {
    const receipt = confirmedReceiptsByBubble.get(Number(event?.bubble_index))
    const deliveryAt = parseTime(receipt?.transport_response_received_at || receipt?.at)
    if (
      !receipt ||
      String(receipt?.control_receipt_sha256 || '') !== controlReceiptSha256 ||
      String(receipt?.text_sha256 || '') !== sha256(String(event?.text || '')) ||
      Number(receipt?.text_length) !== String(event?.text || '').length ||
      deliveryAt <= 0 || incomingAt <= deliveryAt
    ) return noChange('accepted_unverified_boundary_confirmed_receipt_binding_invalid')
  }
  const decision = readControlDecisionArtifact(root, controlReceiptSha256)
  if (!decision.valid) return noChange(`accepted_unverified_boundary_${decision.reason}`)
  const artifact = decision.artifact
  const artifactBubbles = Array.isArray(artifact?.packet?.bubbles) ? artifact.packet.bubbles : []
  if (
    String(artifact?.thread_id || '') !== String(packet?.thread_id || packet?.contact_id || '') ||
    String(artifact?.message_id || '') !== priorMessageId ||
    String(artifact?.control_receipt?.receipt_sha256 || '') !== controlReceiptSha256 ||
    artifactBubbles.length < orderedAttempts.length || artifactBubbles.length > 4 ||
    !controlAuditContainsReceipt(root, artifact.thread_id, controlReceiptSha256)
  ) return noChange('accepted_unverified_boundary_control_evidence_binding_invalid')
  const controlReceiptVerdict = validateControlReceipt({
    source: SCV_SINGLE_CONTROL_SOURCE,
    thread_id: String(artifact.thread_id || ''),
    message_id: String(artifact.message_id || ''),
    bubbles: artifactBubbles,
    control_receipt: artifact.control_receipt
  }, { root, requireLedger: true, requirePayload: true })
  if (!controlReceiptVerdict.valid) {
    return noChange(`accepted_unverified_boundary_${controlReceiptVerdict.reason}`)
  }
  if (pendingObservation && (
    String(pendingObservation.control_receipt_sha256 || '') !== controlReceiptSha256 ||
    String(pendingObservation.control_decision_artifact_sha256 || '') !== String(artifact.artifact_sha256 || '') ||
    Number(pendingObservation.packet_bubble_count) !== artifactBubbles.length ||
    Number(pendingObservation.visible_bubble_count) !== orderedAttempts.length + confirmedEvents.length
  )) return noChange('accepted_unverified_boundary_pending_control_binding_invalid')

  for (const event of orderedAttempts) {
    const index = Number(event.bubble_index)
    if (index >= artifactBubbles.length ||
        sha256(String(artifactBubbles[index]?.text || '')) !== sha256(String(event?.text || ''))) {
      return noChange('accepted_unverified_boundary_control_bubble_binding_invalid')
    }
  }
  for (const event of orderedConfirmed) {
    const index = Number(event.bubble_index)
    if (index >= artifactBubbles.length ||
        sha256(String(artifactBubbles[index]?.text || '')) !== sha256(String(event?.text || ''))) {
      return noChange('accepted_unverified_boundary_confirmed_control_bubble_binding_invalid')
    }
  }

  for (const evidence of receiptEvidence) {
    const event = evidence.event
    const receipt = evidence.receipt
    event.accepted_unverified_conversation_boundary = {
      schema: ACCEPTED_UNVERIFIED_BOUNDARY_SCHEMA,
      reason: ACCEPTED_UNVERIFIED_BOUNDARY_REASON,
      attempt_message_id: priorMessageId,
      observed_by_message_id: incomingMessageId,
      attempted_at: String(event.at || ''),
      observed_inbound_at: new Date(incomingAt).toISOString(),
      bubble_index: Number(event.bubble_index),
      packet_bubble_count: artifactBubbles.length,
      visible_bubble_count: orderedAttempts.length,
      visible_bubble_indexes: visibleBubbleIndexes,
      text_sha256: sha256(String(event.text || event.message || '')),
      delivery_accepted: true,
      delivery_confirmed: false,
      provider_receipt_id_present: false,
      no_resend: true,
      authentication_source: authenticationSource,
      delivery_receipt_sha256: evidence.receipt_sha256,
      control_receipt_sha256: controlReceiptSha256,
      control_decision_artifact_sha256: String(artifact.artifact_sha256 || ''),
      provider_response_sha256: String(receipt.provider_response_sha256 || ''),
      transport_attempt_id: String(receipt.transport_attempt_id || ''),
      // 2026-09-02: dialogue-ledger inclusion only. A newer client message is
      // not evidence that this attempt was visible in the Instagram thread.
      visibility_confirmed: false,
      visibility_state: 'provider_accepted_visibility_unknown',
      boundary_semantics: ACCEPTED_UNVERIFIED_BOUNDARY_SEMANTICS,
      newer_inbound_is_visibility_proof: false
    }
    event.reply_to_message_id = priorMessageId
    if (deferredFirstObservation) event.late_prior_message_delivery = true
  }

  return {
    applied: true,
    reason: ACCEPTED_UNVERIFIED_BOUNDARY_REASON,
    bubble_count: orderedAttempts.length,
    packet_bubble_count: artifactBubbles.length,
    prior_message_id: priorMessageId,
    observed_by_message_id: incomingMessageId,
    control_receipt_sha256: controlReceiptSha256,
    control_decision_artifact_sha256: String(artifact.artifact_sha256 || '')
  }
}

function finalizedAcceptedUnverifiedPendingUnionValid(root, pending, history) {
  const events = Array.isArray(history?.events) ? history.events : []
  const observerId = String(pending?.observed_by_message_id || '')
  const priorMessageId = String(pending?.prior_message_id || '')
  const observedUsers = events.filter((event) =>
    event?.role === 'user' && String(event?.message_id || '') === observerId
  )
  if (
    observedUsers.length !== 1 ||
    String(observedUsers[0]?.at || '') !== String(pending?.observed_inbound_at || '') ||
    sha256(normalizeText(observedUsers[0]?.text || '')) !== String(pending?.observed_text_sha256 || '')
  ) return false
  const delivered = events.filter((event) =>
    ['assistant', 'assistant_attempted'].includes(String(event?.role || '')) &&
    String(event?.message_id || '') === priorMessageId
  )
  if (delivered.length !== Number(pending?.visible_bubble_count)) return false
  const indexes = new Set()
  for (const event of delivered) {
    const index = Number(event?.bubble_index)
    if (!Number.isInteger(index) || index < 0 || index > 3 || indexes.has(index)) return false
    indexes.add(index)
    if (event?.role === 'assistant_attempted') {
      const marker = event?.accepted_unverified_conversation_boundary
      if (
        !isConversationVisibleAssistantEvent(event) ||
        String(marker?.observed_by_message_id || '') !== observerId ||
        String(marker?.authentication_source || '') !== String(pending?.authentication_source || '') ||
        String(event?.reply_to_message_id || event?.message_id || '') !== priorMessageId
      ) return false
    } else if (String(event?.reply_to_message_id || event?.message_id || '') !== priorMessageId) {
      return false
    }
  }
  const ledger = readDeliveryReceiptRows(root)
  if (!ledger.valid) return false
  const receipts = ledger.rows.filter((row) =>
    String(row?.thread_id || '') === String(pending?.thread_id || '') &&
    String(row?.message_id || '') === priorMessageId
  )
  if (receipts.length !== delivered.length) return false
  const receiptsByIndex = new Map()
  for (const receipt of receipts) {
    const index = Number(receipt?.bubble_index)
    if (!Number.isInteger(index) || receiptsByIndex.has(index)) return false
    receiptsByIndex.set(index, receipt)
  }
  for (const event of delivered) {
    const receipt = receiptsByIndex.get(Number(event?.bubble_index))
    if (
      !receipt ||
      String(receipt?.control_receipt_sha256 || '') !== String(pending?.control_receipt_sha256 || '') ||
      String(receipt?.text_sha256 || '') !== sha256(String(event?.text || '')) ||
      Number(receipt?.text_length) !== String(event?.text || '').length
    ) return false
    if (event?.role === 'assistant_attempted') {
      if (!acceptedUnverifiedReceiptValid(receipt, {
        thread_id: String(pending?.thread_id || ''),
        contact_id: String(pending?.contact_id || ''),
        message_id: priorMessageId,
        bubble_index: Number(event?.bubble_index),
        text_sha256: sha256(String(event?.text || '')),
        text_length: String(event?.text || '').length
      }) || !acceptedUnverifiedProviderResponseValid(root, receipt)) return false
    } else if (!(receipt?.delivery_confirmed === true && String(receipt?.delivery_status || '') === 'success_visible')) {
      return false
    }
  }
  const decision = readControlDecisionArtifact(root, String(pending?.control_receipt_sha256 || ''))
  return Boolean(
    decision.valid &&
    String(decision.artifact?.thread_id || '') === String(pending?.thread_id || '') &&
    String(decision.artifact?.message_id || '') === priorMessageId &&
    String(decision.artifact?.artifact_sha256 || '') === String(pending?.control_decision_artifact_sha256 || '') &&
    (Array.isArray(decision.artifact?.packet?.bubbles) ? decision.artifact.packet.bubbles.length : 0) ===
      Number(pending?.packet_bubble_count)
  )
}

function clearFinalizedPendingArtifactsUnlocked(root, pending, history) {
  const threadId = String(pending?.thread_id || '')
  const publication = readDeliveryPublication(root, threadId)
  if (
    publication &&
    String(publication.message_id || '') === String(pending?.prior_message_id || '') &&
    String(publication.control_receipt_sha256 || '') === String(pending?.control_receipt_sha256 || '') &&
    (Array.isArray(history?.events) ? history.events : []).some((event) =>
      ['assistant', 'assistant_attempted'].includes(String(event?.role || '')) &&
      String(event?.message_id || '') === String(publication.message_id || '') &&
      Number(event?.bubble_index) === Number(publication.bubble_index)
    )
  ) clearDeliveryPublicationUnlocked(root, threadId, publication.publication_id)
  clearAcceptedUnverifiedPending(root, threadId)
}

function finalizeAcceptedUnverifiedPendingUnlocked(root, threadId, options = {}) {
  const pending = readAcceptedUnverifiedPending(root, threadId)
  if (!pending) return { applied: false, reason: 'accepted_unverified_pending_absent', bubble_count: 0 }
  const file = historyPath(root, threadId)
  const history = options?.history && Array.isArray(options.history.events)
    ? options.history
    : safeReadJson(file, {})
  const persistHistory = options?.persist_history !== false
  const clearPending = options?.clear_pending !== false
  const appendAudit = options?.append_audit !== false
  if (!history || !Array.isArray(history.events)) {
    return { applied: false, reason: 'accepted_unverified_pending_history_absent', bubble_count: 0 }
  }
  const observedUsers = history.events.filter((event) =>
    event?.role === 'user' && String(event?.message_id || '') === String(pending.observed_by_message_id || '')
  )
  const priorAttempts = history.events.filter((event) =>
    event?.role === 'assistant_attempted' &&
    String(event?.message_id || '') === String(pending.prior_message_id || '')
  )
  const alreadyApplied = finalizedAcceptedUnverifiedPendingUnionValid(root, pending, history)
  if (alreadyApplied) {
    if (clearPending) clearFinalizedPendingArtifactsUnlocked(root, pending, history)
    return {
      applied: true,
      reason: 'accepted_unverified_pending_already_applied',
      bubble_count: Number(pending.visible_bubble_count),
      already_applied: true
    }
  }

  const observedUser = observedUsers[0]
  if (!observedUser) {
    return { applied: false, reason: 'accepted_unverified_pending_observer_history_missing', bubble_count: 0 }
  }
  const packet = {
    thread_id: String(pending.thread_id || ''),
    contact_id: String(pending.contact_id || ''),
    message_id: String(pending.observed_by_message_id || ''),
    text: String(observedUser.text || ''),
    received_at: String(pending.observed_inbound_at || '')
  }
  const previous = {
    latest_ingress_message_id: String(pending.prior_message_id || ''),
    latest_ingress_at: String(pending.prior_ingress_at || '')
  }
  const reconciliation = reconcileAcceptedUnverifiedBoundaryUnlocked(
    root,
    packet,
    previous,
    parseTime(pending.observed_inbound_at),
    {
      authenticated_inbound: true,
      authentication_source: String(pending.authentication_source || ''),
      pending_observation: pending
    },
    history
  )
  if (!reconciliation.applied) return reconciliation
  const reconciledAttempts = history.events
    .filter((event) =>
      event?.role === 'assistant_attempted' &&
      String(event?.message_id || '') === String(pending.prior_message_id || '')
    )
    .sort((left, right) => Number(left?.bubble_index) - Number(right?.bubble_index))
  const withoutAttempts = history.events.filter((event) => !reconciledAttempts.includes(event))
  const observerIndex = withoutAttempts.findIndex((event) =>
    event?.role === 'user' && String(event?.message_id || '') === String(pending.observed_by_message_id || '')
  )
  if (observerIndex < 0) {
    return { applied: false, reason: 'accepted_unverified_pending_observer_reorder_missing', bubble_count: 0 }
  }
  withoutAttempts.splice(observerIndex, 0, ...reconciledAttempts)
  history.events = withoutAttempts
  if (persistHistory) durableAtomicWriteJson(file, history)
  if (appendAudit) {
    appendControlAuditUnlocked(root, threadId, {
      type: 'accepted_unverified_conversation_boundary_reconciled_from_pending',
      message_id: String(reconciliation.prior_message_id || ''),
      observed_by_message_id: String(reconciliation.observed_by_message_id || ''),
      bubble_count: Number(reconciliation.bubble_count || 0),
      authentication_source: String(pending.authentication_source || ''),
      delivery_accepted: true,
      delivery_confirmed: false,
      no_resend: true
    })
  }
  if (clearPending) clearFinalizedPendingArtifactsUnlocked(root, pending, history)
  return { ...reconciliation, pending }
}

function acceptedUnverifiedBoundaryPending(root, threadId) {
  return readAcceptedUnverifiedPending(root, String(threadId || '')) !== null
}

function conversationContextPublicationPending(root, threadId) {
  const resolvedThreadId = String(threadId || '')
  if (!resolvedThreadId) return false
  if (acceptedUnverifiedBoundaryPending(root, resolvedThreadId)) return true
  if (readDeliveryPublication(root, resolvedThreadId)) return true
  try {
    return fs.lstatSync(path.join(
      rootPath(root),
      'control-locks',
      `${safeThreadKey(resolvedThreadId)}.lock`
    )).isFile()
  } catch {
    return false
  }
}

function recordIngressEvent(root, packet, options = {}) {
  const threadId = String(packet?.thread_id || packet?.contact_id || '')
  if (!threadId) throw new Error('single_control_ingress_missing_thread_id')
  const messageId = String(packet?.message_id || '')
  const normalized = normalizeText(packet?.text || '')
  const mediaIdentity = Array.isArray(packet?.media_urls)
    ? packet.media_urls.map((value) => String(value || '').trim()).filter(Boolean).join('\n')
    : ''
  const eventMaterial = normalized || mediaIdentity || String(packet?.raw_body_sha256 || '').trim()
  if (!messageId || !eventMaterial) throw new Error('single_control_ingress_missing_event_identity')

  return withThreadControlLock(root, threadId, () => {
    const pendingRecoveryBeforeIngress = finalizeAcceptedUnverifiedPendingUnlocked(root, threadId)
    const file = statePath(root, threadId)
    const previous = migrateStateObject(safeReadJson(file, {}), threadId)
    const next = { ...previous }
    const incomingAt = immutableIngressTimeMs(packet)
    const currentAt = parseTime(previous.latest_ingress_at || previous.received_at)
    const incomingHash = sha256(eventMaterial)
    const sameLatest =
      messageId === String(previous.latest_ingress_message_id || '') &&
      incomingHash === String(previous.latest_ingress_text_sha256 || '')
    const becomesLatest =
      sameLatest ||
      !previous.latest_ingress_message_id ||
      (incomingAt > 0 && (!currentAt || incomingAt >= currentAt))
    const historyFilePath = historyPath(root, threadId)
    const priorHistory = safeReadJson(historyFilePath, {})
    const history = {
      contact_id: String(packet?.contact_id || priorHistory?.contact_id || threadId),
      thread_id: threadId,
      instagram_username: String(packet?.instagram_username || priorHistory?.instagram_username || ''),
      events: Array.isArray(priorHistory?.events) ? priorHistory.events.slice() : []
    }
    const pendingAdvance = becomesLatest && !sameLatest
      ? advanceAcceptedUnverifiedPendingObservationUnlocked(root, packet, incomingAt, options, history)
      : { advanced: false, reason: 'accepted_unverified_pending_advance_not_new_latest' }
    const activeDeliveryPublication = readDeliveryPublication(root, threadId)
    const publicationDefersBoundary = Boolean(
      becomesLatest && !sameLatest && activeDeliveryPublication &&
      String(activeDeliveryPublication.message_id || '') === String(previous.latest_ingress_message_id || '')
    )
    let acceptedUnverifiedBoundary = becomesLatest && !sameLatest && !publicationDefersBoundary && !pendingAdvance.advanced
      ? reconcileAcceptedUnverifiedBoundaryUnlocked(root, packet, previous, incomingAt, options, history)
      : pendingAdvance.advanced
        ? { applied: false, reason: 'accepted_unverified_boundary_deferred_pending_observer_advanced', bubble_count: 0 }
      : publicationDefersBoundary
        ? { applied: false, reason: 'accepted_unverified_delivery_publication_in_flight', bubble_count: 0 }
      : { applied: false, reason: 'accepted_unverified_boundary_not_new_latest', bubble_count: 0 }

    const existingPending = readAcceptedUnverifiedPending(root, threadId)
    let pendingPersistedForIngress = false
    if (!existingPending && becomesLatest && !sameLatest) {
      const pendingEvidence = acceptedUnverifiedBoundary.applied
        ? {
            control_receipt_sha256: acceptedUnverifiedBoundary.control_receipt_sha256,
            control_decision_artifact_sha256: acceptedUnverifiedBoundary.control_decision_artifact_sha256,
            packet_bubble_count: acceptedUnverifiedBoundary.packet_bubble_count,
            visible_bubble_count: acceptedUnverifiedBoundary.bubble_count
          }
        : pendingEvidenceFromDeliveryPublicationUnlocked(root, packet, previous, incomingAt, options, history)
      if (pendingEvidence) {
        const pending = buildAcceptedUnverifiedPendingObservation(
          packet,
          previous,
          incomingAt,
          String(options?.authentication_source || ''),
          pendingEvidence
        )
        persistAcceptedUnverifiedPending(root, pending)
        pendingPersistedForIngress = true
      }
    }

    next.control_plane_id = SCV_SINGLE_CONTROL_PLANE_ID
    next.control_epoch = SCV_CONTROL_EPOCH
    next.control_event_revision = Math.max(0, Number(previous.control_event_revision) || 0) + (sameLatest ? 0 : 1)

    if (becomesLatest) {
      for (const field of TRANSPORT_STATE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(packet || {}, field)) next[field] = packet[field]
      }
      next.thread_id = threadId
      next.contact_id = String(packet?.contact_id || previous.contact_id || threadId)
      next.latest_ingress_message_id = messageId
      next.latest_ingress_at = incomingAt ? new Date(incomingAt).toISOString() : new Date().toISOString()
      next.latest_ingress_text_sha256 = incomingHash
      if (!sameLatest) next.ingress_revision = Math.max(0, Number(previous.ingress_revision) || 0) + 1
    }

    const ingressStage = deriveBookingStage(next)
    stampStructuredState(next, {
      stage: ingressStage,
      nextAction: nextActionForStage(ingressStage)
    })
    assertStructuredState(next)
    atomicWriteJson(file, next)
    if (options?.test_fault_after_state_write === true) {
      throw new Error('accepted_unverified_test_fault_after_state_write')
    }
    const historyFile = appendHistoryUnlocked(root, packet, 'user', {
      text_source: String(packet?.text_source || ''),
      message_id_authority: String(packet?.message_id_authority || ''),
      message_id_retry_window_ms: Number(packet?.message_id_retry_window_ms || 0),
      recovered_via: String(packet?.recovered_via || ''),
      source_interaction_at: String(packet?.source_interaction_at || ''),
      manychat_latest_interaction_at: String(packet?.manychat_latest_interaction_at || ''),
      recovered_from_ig_last_interaction: String(packet?.recovered_from_ig_last_interaction || ''),
      recovered_from_at: String(packet?.recovered_from_at || ''),
      operator_recovery: packet?.operator_recovery === true,
      raw_body_sha256: String(packet?.raw_body_sha256 || '')
    }, { history })
    if (acceptedUnverifiedBoundary.applied) {
      appendControlAuditUnlocked(root, threadId, {
        type: 'accepted_unverified_conversation_boundary_reconciled',
        message_id: String(acceptedUnverifiedBoundary.prior_message_id || ''),
        observed_by_message_id: String(acceptedUnverifiedBoundary.observed_by_message_id || ''),
        bubble_count: Number(acceptedUnverifiedBoundary.bubble_count || 0),
        reason: String(acceptedUnverifiedBoundary.reason || ''),
        control_receipt_sha256: String(acceptedUnverifiedBoundary.control_receipt_sha256 || ''),
        control_decision_artifact_sha256: String(acceptedUnverifiedBoundary.control_decision_artifact_sha256 || ''),
        authentication_source: String(options?.authentication_source || ''),
        delivery_accepted: true,
        delivery_confirmed: false,
        visibility_confirmed: false,
        visibility_state: 'provider_accepted_visibility_unknown',
        boundary_semantics: ACCEPTED_UNVERIFIED_BOUNDARY_SEMANTICS,
        newer_inbound_is_visibility_proof: false,
        no_resend: true
      })
    }
    if (acceptedUnverifiedBoundary.applied && pendingPersistedForIngress) {
      clearAcceptedUnverifiedPending(root, threadId)
    } else {
      const pendingRecoveryAfterHistory = finalizeAcceptedUnverifiedPendingUnlocked(root, threadId)
      if (pendingRecoveryAfterHistory.applied && !pendingRecoveryAfterHistory.already_applied) {
        acceptedUnverifiedBoundary = pendingRecoveryAfterHistory
      }
    }
    const auditFile = appendControlAuditUnlocked(root, threadId, {
      type: 'ingress_observation_adopted',
      message_id: messageId,
      ingress_revision: next.ingress_revision,
      control_event_revision: next.control_event_revision,
      became_latest: becomesLatest,
      duplicate_latest: sameLatest,
      text_sha256: incomingHash,
      source: String(packet?.text_source || packet?.recovered_via || 'inbound')
    })

    return {
      ok: true,
      state_file: file,
      history_file: historyFile,
      control_event_file: auditFile,
      ingress_revision: next.ingress_revision,
      latest_ingress_message_id: next.latest_ingress_message_id,
      became_latest: becomesLatest,
      duplicate_latest: sameLatest,
      accepted_unverified_boundary_reconciled: acceptedUnverifiedBoundary.applied === true,
      accepted_unverified_boundary_reason: String(acceptedUnverifiedBoundary.reason || ''),
      accepted_unverified_boundary_bubble_count: Number(acceptedUnverifiedBoundary.bubble_count || 0),
      accepted_unverified_boundary_pending: Boolean(readAcceptedUnverifiedPending(root, threadId)),
      accepted_unverified_pending_observer_advanced: pendingAdvance.advanced === true,
      accepted_unverified_delivery_publication_pending: Boolean(readDeliveryPublication(root, threadId)),
      accepted_unverified_pending_recovered_before_ingress: pendingRecoveryBeforeIngress.applied === true
    }
  })
}

function textLooksLikeSchedulingProposal(value) {
  const text = String(value || '')
  const schedulingToken = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|tomorrow|tonight|today|weekend|next\s+(?:week|month)|noon|\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\d{1,2}(?:st|nd|rd|th)\b)/i
  if (!schedulingToken.test(text)) return false
  return (
    /\b(?:can|could|would|does|do|will|is|are|should)\b[^?.!]{0,40}\b(?:do|work|works|be|make|meet|come|book|schedule|fit|ok|okay|good|fine|free|open|available)\b/i.test(text) ||
    /^\s*(?:how about|what about|maybe|or)\b/i.test(text) ||
    /\b(?:works?|available|free|open|fit)\s+for\s+(?:me|us|you)\b/i.test(text)
  )
}

function textLooksLikeBusinessProcessQuestion(value) {
  return /\bwhy\b.{0,80}\b(?:doing|do|offer|offering|give|giving)\b.{0,80}\b(?:free|model|discount|tattoo|work)\b/i.test(String(value || ''))
}

function enforceControllerIdentityAuthority(stateValue, liveTextValue, baselineValue = {}) {
  const state = stateValue && typeof stateValue === 'object' ? stateValue : {}
  const baseline = baselineValue && typeof baselineValue === 'object' ? baselineValue : {}
  const liveText = String(liveTextValue || '')
  const identity = liveBookingIdentityAnswer(liveText, baseline)

  // A client revising the name or phone of a pending four-field checkpoint owns
  // that field (live red-team 2026-09-02 v141 case 15: "the number is wrong its
  // 4155550188" was rebound to the persisted number below and the corrected
  // checkpoint repeated the old one). The checkpoint is pending until it is
  // confirmed, superseded, or invalidated, so the revision grammar shared with
  // dm-authority decides here, before the active-slot parser falls back to the
  // baseline.
  const checkpointPending = Boolean(
    baseline.double_check_sent === true ||
    baseline.name_phone_date_time_double_check_sent === true ||
    String(baseline.booking_stage_hint || '').trim() === 'awaiting_double_check_confirmation'
  )
  let revisionPhone = ''
  let revisionName = ''
  if (checkpointPending && liveText.trim()) {
    const {
      extractCheckpointPhoneRevision,
      extractCheckpointNameRevision
    } = require(path.join(__dirname, 'dm-authority.js'))
    revisionPhone = String(extractCheckpointPhoneRevision(liveText) || '').trim()
    revisionName = revisionPhone ? '' : String(extractCheckpointNameRevision(liveText) || '').trim()
  }

  // The downstream annotator is useful for discourse and booking cues, but its
  // broad extraction is not identity authority. Rebind both durable and
  // current-turn identity fields to the controller's active-slot parser after
  // every annotation pass. This prevents an unlabeled trailing token after a
  // phone number from manufacturing the missing name and freezing DOUBLE_CHECK.
  state.known_name_used_on_form = String(
    revisionName || identity.name || baseline.known_name_used_on_form || ''
  ).trim()
  state.known_phone_used_on_form = String(
    revisionPhone || identity.phone || baseline.known_phone_used_on_form || ''
  ).trim()
  state.live_turn_name_candidate = String(revisionName || identity.name || '').trim()
  state.live_turn_phone_candidate = String(revisionPhone || identity.phone || '').trim()
  if (revisionPhone || revisionName) {
    state.live_turn_checkpoint_invalidated = true
    state.live_turn_checkpoint_revision_intent = revisionPhone ? 'phone' : 'name'
    state.checkpoint_superseded_by_revision = true
    delete state.double_check_sent
    delete state.name_phone_date_time_double_check_sent
  }
  return state
}

function preserveSameEventCheckpointInvalidation(stateValue, eventValue, baselineValue = {}) {
  const state = stateValue && typeof stateValue === 'object' ? stateValue : {}
  const event = eventValue && typeof eventValue === 'object' ? eventValue : {}
  const baseline = baselineValue && typeof baselineValue === 'object' ? baselineValue : {}
  const eventMessageId = String(event.message_id || '').trim()
  const eventText = String(event.text || event.message || '').trim()
  if (
    baseline.live_turn_checkpoint_invalidated === true &&
    eventMessageId &&
    eventMessageId === String(baseline.message_id || '').trim() &&
    eventText === String(baseline.text || '').trim()
  ) state.live_turn_checkpoint_invalidated = true
  return state
}

function reduceConversationState({ root, persisted, candidate, event, intentEvidence } = {}) {
  const threadId = String(event?.thread_id || event?.contact_id || candidate?.thread_id || '')
  const current = migrateStateObject(
    persisted && typeof persisted === 'object' ? persisted : readControlState(root, threadId),
    threadId
  )
  const proposed = candidate && typeof candidate === 'object' ? { ...candidate } : {}
  // Candidate state is evidence used by the verifier, never durable authority.
  // Start the reducer with its transient annotations only, then overlay the
  // already-committed controller floor.  Verified live/controller evidence is
  // promoted explicitly below and verified transition-owned fields are applied
  // once, immediately before commit.
  const transientCandidate = { ...proposed }
  for (const field of DURABLE_TRUE_FIELDS) delete transientCandidate[field]
  for (const field of DURABLE_STRING_FIELDS) delete transientCandidate[field]
  const state = applyDurableStructuredState(transientCandidate, current, {
    overwrite_strings: false
  })
  // These fields are controller receipts, not model-writable conversation
  // facts.  Preserve only the committed baseline here; commitControlDecision
  // advances them after a verified calendar transition is adopted.
  state.last_rejected_client_date = String(current.last_rejected_client_date || '').trim()
  state.last_rejected_client_date_message_id = String(current.last_rejected_client_date_message_id || '').trim()
  // Identity belongs to the controller event/persisted thread, not to a model
  // candidate. A candidate is allowed to omit these fields, but it can never
  // erase or replace them before schema validation and commit.
  state.thread_id = String(current.thread_id || threadId)
  state.contact_id = String(current.contact_id || event?.contact_id || state.thread_id)
  // Controller/ingress receipts are source-owned metadata. Candidate state may
  // contain a stale copy from the prior turn (or a forged future revision), but
  // it cannot supply the generation fence used by commitControlDecision.
  for (const field of [
    'control_revision',
    'ingress_revision',
    'control_event_revision',
    'latest_ingress_message_id',
    'latest_ingress_at',
    'latest_ingress_text_sha256',
    'control_recent_receipts',
    'last_control_message_id',
    'last_control_committed_at',
    'control_state_sha256',
    'last_control_decision'
  ]) {
    if (Object.prototype.hasOwnProperty.call(current, field)) {
      const value = current[field]
      state[field] = value && typeof value === 'object'
        ? JSON.parse(JSON.stringify(value))
        : value
    } else {
      delete state[field]
    }
  }
  state.message_id = String(event?.message_id || current.message_id || '')
  state.instagram_username = String(event?.instagram_username || current.instagram_username || '')
  state.text = String(event?.text || event?.message || '')
  state.received_at = String(event?.received_at || current.received_at || '')
  state.text_source = String(event?.text_source || current.text_source || '')
  const intent = intentEvidence && typeof intentEvidence === 'object' ? intentEvidence : {}
  const live = String(event?.text || event?.message || '').trim()
  // A candidate parser may surface any phone-looking span. Only the current
  // client turn, inside the active identity slot, can add identity authority.
  // Restore the committed baseline first, then apply the narrow positive
  // identity payload. This prevents a friend's or relative's contact details
  // from promoting the route to DOUBLE_CHECK on a repair pass.
  enforceControllerIdentityAuthority(state, live, current)
  const controllerHistory = root && event
    ? recentControlHistoryBeforeTurn(root, event, 30)
    : []
  const controllerInput = {
    ...event,
    message: live,
    live_message: live,
    recent_history: controllerHistory,
    structured_state: state
  }
  // Asking about the artist's background does not request a customer service.
  // A model's provisional flags cannot turn that side question into the first
  // durable tattoo-interest or design fact. Existing customer state survives.
  const liveBiographyOnly = liveArtistBiographyQuestion(controllerInput)
  if (liveBiographyOnly) {
    state.live_turn_is_tattoo_intent = false
    state.live_turn_gave_design_idea = false
  }
  // The route resolver and durable reducer must agree on whether the tattoo lane
  // is active.  Live 2026-08-24: the route selected DESIGN_INTAKE for a fresh
  // information request while the committed state stayed open_conversation;
  // the immediately following image was then quarantined as unrelated media.
  if (!liveBiographyOnly && hasTattooIntentSignal(controllerInput)) state.tattoo_intent_active = true
  const latestAssistantText = latestVisibleAssistantText(controllerHistory)
  const allowBareCalendarAnswer = Boolean(
    current.form_submitted === true &&
    ['awaiting_date', 'awaiting_time'].includes(String(current.booking_stage_hint || deriveBookingStage(current))) &&
    assistantPacketOpensBookingDateSelection(latestAssistantText)
  )
  const liveCalendarFrame = calendarBookingProposalFrame(live, {
    allowBareDate: allowBareCalendarAnswer
  })
  const liveClockFrame = liveBookingClockFrame(live, current, controllerHistory)
  const liveCalendarAmbiguity = Boolean(
    current.form_submitted === true && liveCalendarFrame.ambiguous === true
  )
  const liveClockAmbiguity = Boolean(
    current.form_submitted === true && liveClockFrame.ambiguous === true
  )
  state.live_turn_calendar_ambiguity = liveCalendarAmbiguity
  state.live_turn_clock_ambiguity = liveClockAmbiguity
  const liveExplicitTimeCandidate = liveClockFrame.proposal === true && liveClockFrame.candidate_text
    ? explicitClockTime(liveClockFrame.candidate_text)
    : ''
  const liveTimeDecision = liveExplicitTimeCandidate
    ? classifyBookingClockTimeText(liveExplicitTimeCandidate)
    : { status: 'missing', canonical_label: '', minimum_booking_time_label: MINIMUM_BOOKING_TIME_LABEL }
  const liveTimeTooEarly = liveTimeDecision.status === 'too_early'
  const liveExplicitTime = liveTimeDecision.status === 'legal'
    ? liveExplicitTimeCandidate
    : ''
  const fourFieldPayload = explicitFourFieldBookingPayload(live, current)
  const liveCalendarCandidateText = liveCalendarFrame.proposal === true
    ? String(liveCalendarFrame.candidate_text || '').trim()
    : String(fourFieldPayload?.date_text || '').trim()
  const liveCalendarCandidateIso = liveCalendarCandidateText
    ? bookingDateIsoForTurn(liveCalendarCandidateText, event, current)
    : ''
  const matchedHistoricalOffer = (
    liveCalendarCandidateIso && !liveExplicitTime
  )
    ? historicalOfferedSlotForDate(controllerHistory, liveCalendarCandidateIso, event, current)
    : null
  const matchedHistoricalOfferTime = String(matchedHistoricalOffer?.time || '').trim()
  const currentRequestedDateIso = bookingDateIsoForTurn(current.known_requested_date, event, current)
  const rejectedCalendarCandidateIso = (
    (liveCalendarFrame.rejection === true || liveCalendarFrame.bounded === true) &&
    liveCalendarFrame.candidate_text
  )
    ? bookingDateIsoForTurn(liveCalendarFrame.candidate_text, event, current)
    : ''
  const rejectsPersistedDate = Boolean(
    current.form_submitted === true &&
    currentRequestedDateIso &&
    rejectedCalendarCandidateIso &&
    rejectedCalendarCandidateIso === currentRequestedDateIso
  )
  const rejectsPersistedTime = Boolean(
    current.form_submitted === true &&
    String(current.known_requested_time || '').trim() &&
    (liveClockFrame.rejection === true || liveClockFrame.bounded === true) &&
    liveClockFrame.candidate_text &&
    canonicalClockTimeKey(liveClockFrame.candidate_text) === canonicalClockTimeKey(current.known_requested_time)
  )
  const replacesPersistedDate = Boolean(
    current.form_submitted === true &&
    currentRequestedDateIso &&
    liveCalendarCandidateIso &&
    liveCalendarCandidateIso !== currentRequestedDateIso
  )
  const replacesPersistedTime = Boolean(
    current.form_submitted === true &&
    String(current.known_requested_time || '').trim() &&
    liveExplicitTime &&
    canonicalClockTimeKey(liveExplicitTime) !== canonicalClockTimeKey(current.known_requested_time)
  )
  state.known_requested_date = String(current.known_requested_date || '').trim()
  state.known_requested_time = String(current.known_requested_time || '').trim()
  state.live_turn_historical_offered_time = matchedHistoricalOfferTime
  state.live_turn_time_phrase = ''
  state.live_turn_time_candidate = liveTimeDecision.status === 'missing'
    ? ''
    : (liveTimeDecision.canonical_label || liveExplicitTimeCandidate)
  state.live_turn_time_status = liveTimeDecision.status === 'missing'
    ? ''
    : liveTimeDecision.status
  state.minimum_booking_time_local = liveTimeDecision.minimum_booking_time_label || MINIMUM_BOOKING_TIME_LABEL
  const sameControllerEvent = Boolean(
    String(current.message_id || '').trim() &&
    String(current.message_id || '').trim() === String(event?.message_id || '').trim() &&
    String(current.text || '').trim() === live
  )
  // executeSingleControlTurn reduces the same ingress once to freeze the route
  // and again after candidate observation. Preserve checkpoint invalidation only
  // for that exact source event so the second reduction cannot revive an older
  // assistant double-check after a replacement date or time.
  state.live_turn_checkpoint_invalidated = Boolean(
    sameControllerEvent && current.live_turn_checkpoint_invalidated === true
  )
  const proposedDatePhrase = String(proposed.live_turn_date_phrase || '').trim()
  const proposedDateIso = proposedDatePhrase
    ? bookingDateIsoForTurn(proposedDatePhrase, event, current)
    : ''
  const contextualDateAuthority = Boolean(
    proposed.live_turn_contextual_booking_reply === true ||
    proposed.live_turn_date_needs_month === true
  )
  const framedDateAuthority = Boolean(
    liveCalendarCandidateText &&
    (
      !proposedDatePhrase ||
      !liveCalendarCandidateIso ||
      !proposedDateIso ||
      liveCalendarCandidateIso === proposedDateIso
    )
  )
  const liveDatePhrase = (framedDateAuthority || contextualDateAuthority)
    ? (proposedDatePhrase || liveCalendarCandidateText)
    : ''
  const currentExplicitDateProposal = !!(
    liveDatePhrase ||
    contextualDateAuthority
  )
  if (!currentExplicitDateProposal) {
    state.live_turn_date_phrase = ''
    state.live_turn_date_status = ''
    state.live_turn_date_iso = ''
    state.live_turn_date_needs_month = false
  }
  const offeredTime = String(proposed.last_offered_time || current.last_offered_time || '').trim()
  const coarseDayConstraint = bookingDayConstraintPreference(live)
  const explicitTimeConflictsWithOffer = !!(
    liveExplicitTime &&
    offeredTime &&
    canonicalClockTimeKey(liveExplicitTime) !== canonicalClockTimeKey(offeredTime)
  )

  if (intent.llm_intent_applied === true) state.llm_intent_applied = true
  for (const field of [
    'live_turn_form_consent',
    'live_turn_explicit_form_request',
    'live_turn_accepts_offered_slot',
    'live_turn_form_submitted_signal',
    'live_turn_deposit_sent',
    'live_turn_pricing_question',
    'live_turn_is_question',
    'live_turn_declines'
  ]) {
    if (
      intent[field] === true &&
      !(
        field === 'live_turn_accepts_offered_slot' &&
        (explicitTimeConflictsWithOffer || currentExplicitDateProposal || liveTimeTooEarly || coarseDayConstraint)
      )
    ) state[field] = true
  }
  if (coarseDayConstraint) {
    state.live_turn_accepts_offered_slot = false
    state.live_turn_accepted_offered_date = ''
    state.live_turn_accepted_offered_time = ''
  }
  if (intent.context_classifier_applied === true) {
    state.context_classifier_applied = true
    for (const field of [
      'live_turn_context_missing',
      'live_turn_context_missing_attachment',
      'live_turn_context_needs_clarification',
      'live_turn_context_resolved_from_history',
      'live_turn_self_contained_topic_shift',
      'live_turn_reference_pointer_without_media'
    ]) state[field] = intent[field] === true
    for (const field of [
      'live_turn_context_relation',
      'live_turn_context_confidence',
      'live_turn_context_resolution_source',
      'live_turn_context_reason_code',
      'live_turn_context_antecedent_quote'
    ]) state[field] = String(intent[field] || '')
    if (state.live_turn_context_missing === true) state.live_turn_declines = false
  }

  // Direct current-client clock time outranks stale assistant proposal state and
  // model intent labels. A different time is a counterproposal, never acceptance
  // of the assistant's last offered time.
  if (liveExplicitTime && !rejectsPersistedDate) {
    // Keep the current-turn time as explicit transient authority. The closed
    // transition planner intentionally ignores an old durable time whenever the
    // client supplies a new date, so the same current message must carry its own
    // clock time through that gate (for example: "7th of August, 2pm").
    state.live_turn_time_phrase = liveExplicitTime
    state.known_requested_time = liveExplicitTime
    if (!String(state.known_requested_date || '').trim() && String(state.last_offered_date || '').trim()) {
      state.known_requested_date = String(state.last_offered_date).trim()
    }
    if (explicitTimeConflictsWithOffer) {
      state.live_turn_accepts_offered_slot = false
      state.live_turn_accepted_offered_date = ''
      state.live_turn_accepted_offered_time = ''
      state.accepted_offered_date = ''
      state.accepted_offered_time = ''
    }
  }
  if (currentExplicitDateProposal) {
    state.live_turn_accepts_offered_slot = false
    state.live_turn_accepted_offered_date = ''
    state.live_turn_accepted_offered_time = ''
    state.accepted_offered_date = ''
    state.accepted_offered_time = ''
    if (matchedHistoricalOfferTime) {
      state.last_offered_date = liveDatePhrase || String(matchedHistoricalOffer?.date || '').trim()
      state.last_offered_time = matchedHistoricalOfferTime
    }
  }
  if (replacesPersistedDate || replacesPersistedTime) {
    state.live_turn_checkpoint_invalidated = true
    state.live_turn_accepts_offered_slot = false
    state.live_turn_accepted_offered_date = ''
    state.live_turn_accepted_offered_time = ''
    state.accepted_offered_date = ''
    state.accepted_offered_time = ''
    delete state.double_check_sent
    delete state.name_phone_date_time_double_check_sent
    state.checkpoint_superseded_by_revision = true
  }
  // Contradictory polarity, alternative lists, and multi-endpoint ranges own a
  // controller clarification route. They invalidate the old visible checkpoint
  // but never choose an endpoint or preserve it as client-confirmed.
  if (liveCalendarAmbiguity) {
    state.live_turn_checkpoint_invalidated = true
    state.known_requested_date = ''
    state.known_requested_time = ''
    state.live_turn_time_phrase = ''
    state.live_turn_accepts_offered_slot = false
    state.live_turn_accepted_offered_date = ''
    state.live_turn_accepted_offered_time = ''
    state.accepted_offered_date = ''
    state.accepted_offered_time = ''
    state.live_turn_declines = false
    delete state.double_check_sent
    delete state.name_phone_date_time_double_check_sent
    state.checkpoint_superseded_by_revision = true
  } else if (liveClockAmbiguity) {
    state.live_turn_checkpoint_invalidated = true
    state.known_requested_time = ''
    state.live_turn_time_phrase = ''
    state.live_turn_accepts_offered_slot = false
    state.live_turn_accepted_offered_time = ''
    state.accepted_offered_date = ''
    state.accepted_offered_time = ''
    state.live_turn_declines = false
    delete state.double_check_sent
    delete state.name_phone_date_time_double_check_sent
    state.checkpoint_superseded_by_revision = true
  } else if (liveTimeTooEarly) {
    state.live_turn_checkpoint_invalidated = true
    state.known_requested_time = ''
    state.live_turn_time_phrase = ''
    state.live_turn_accepts_offered_slot = false
    state.live_turn_accepted_offered_time = ''
    state.accepted_offered_date = ''
    state.accepted_offered_time = ''
    state.live_turn_declines = false
    delete state.double_check_sent
    delete state.name_phone_date_time_double_check_sent
    state.checkpoint_superseded_by_revision = true
  } else if (rejectsPersistedDate) {
    state.live_turn_checkpoint_invalidated = true
    state.known_requested_date = ''
    state.known_requested_time = ''
    state.live_turn_time_phrase = ''
    state.live_turn_accepts_offered_slot = false
    state.live_turn_accepted_offered_date = ''
    state.live_turn_accepted_offered_time = ''
    state.accepted_offered_date = ''
    state.accepted_offered_time = ''
    state.live_turn_declines = false
    delete state.double_check_sent
    delete state.name_phone_date_time_double_check_sent
    state.checkpoint_superseded_by_revision = true
  } else if (rejectsPersistedTime) {
    state.live_turn_checkpoint_invalidated = true
    state.known_requested_time = ''
    state.live_turn_time_phrase = ''
    state.live_turn_accepts_offered_slot = false
    state.live_turn_accepted_offered_time = ''
    state.accepted_offered_date = ''
    state.accepted_offered_time = ''
    state.live_turn_declines = false
    delete state.double_check_sent
    delete state.name_phone_date_time_double_check_sent
    state.checkpoint_superseded_by_revision = true
  }
  const directLiveDesignIdea = !liveBiographyOnly && liveHasConcreteDesignDirection({
    message: live,
    live_message: live,
    recent_history: [],
    // Direct current-turn evidence is judged without stale durable reference
    // flags. Unknown concrete subjects remain valid; generic tattoo interest does
    // not become a design merely because an older image existed.
    structured_state: {
      live_turn_text: live,
      live_turn_is_media_reference: proposed.live_turn_is_media_reference === true,
      live_turn_media_category: String(proposed.live_turn_media_category || ''),
      live_turn_media_tattoo_reference: proposed.live_turn_media_tattoo_reference === true
    }
  })
  const historyAnchoredDesignIdea = !liveBiographyOnly && clientAnchoredInspirationReference(controllerInput)
  const intentGroundedDesignIdea = !liveBiographyOnly && intent.live_turn_gave_design_idea === true && liveHasConcreteDesignDirection({
    message: live,
    recent_history: [],
    structured_state: state
  })
  const groundedDesignIdea = directLiveDesignIdea || historyAnchoredDesignIdea || intentGroundedDesignIdea
  if (historyAnchoredDesignIdea) state.known_client_anchored_inspiration = true
  const proposedKnownDesign = String(state.known_design_context || '').trim()
  // v155: stored design text is judged by the shared stored-context reader — the strict detector plus
  // legacy style-only statements, never a stored question or capability text (the v154 residue).
  // Current-turn media flags must not launder a stale generic opener into design memory.
  const proposedKnownDesignGrounded = !!(proposedKnownDesign && storedDesignContextIsDesign(proposedKnownDesign))
  // Candidate structured state is evidence, not authority. If this turn tried to
  // create the first design memory from generic tattoo interest, quarantine that
  // mutation before route derivation and persistence. Existing trusted design
  // memory is never erased by this live-turn gate.
  if (!String(current.known_design_context || '').trim() && proposedKnownDesign && !proposedKnownDesignGrounded) {
    state.known_design_context = ''
  }
  const currentKnownDesign = String(current.known_design_context || '').trim()
  const currentKnownDesignGrounded = !!(currentKnownDesign && storedDesignContextIsDesign(currentKnownDesign))
  const baselineHasDesignAuthority = !!(
    currentKnownDesignGrounded ||
    current.known_client_anchored_inspiration === true ||
    knownTattooReferenceMediaReceived({ structured_state: current })
  )
  // Durable state can contain a model-authored capability answer from an older
  // build. It is a claim, not design authority. Quarantine the field so it cannot
  // keep reopening form/date routes after the classifier is repaired.
  if (
    currentKnownDesign &&
    !currentKnownDesignGrounded &&
    !proposedKnownDesignGrounded &&
    !knownTattooReferenceMediaReceived({ structured_state: current })
  ) {
    state.known_design_context = ''
  }
  const candidateAttemptedUngroundedDesignAdvance = !!(
    proposed.live_turn_gave_design_idea === true ||
    String(proposed.known_design_context || '').trim() ||
    (proposed.form_offer_asked === true && current.form_offer_asked !== true) ||
    (proposed.form_link_sent === true && current.form_link_sent !== true)
  )
  // A model candidate cannot turn a generic booking/info/process inquiry into
  // durable design authority or a form stage. Restore every funnel-bearing field
  // from the pre-candidate controller floor while preserving the independently
  // grounded tattoo-intent latch. This is family-general: the gate asks whether
  // an independent design subject exists, not whether one exact sentence matched.
  if (!baselineHasDesignAuthority && !groundedDesignIdea && candidateAttemptedUngroundedDesignAdvance) {
    restoreFunnelDurableStateFromBaseline(state, current)
  }
  if (current.live_turn_gave_design_idea !== true && !groundedDesignIdea && !proposedKnownDesignGrounded) {
    state.live_turn_gave_design_idea = false
  }
  if (
    !liveBiographyOnly && (
      intent.tattoo_intent_active === true ||
      intent.live_turn_is_tattoo_intent === true ||
      groundedDesignIdea
    )
  ) {
    state.tattoo_intent_active = true
    state.live_turn_is_tattoo_intent = true
  }
  if (groundedDesignIdea) {
    state.live_turn_gave_design_idea = true
    if (
      (directLiveDesignIdea || intentGroundedDesignIdea) &&
      live &&
      !String(state.known_design_context || '').trim() &&
      !textLooksLikeBusinessProcessQuestion(live) &&
      // Live 2026-09-03 (Omar.system): "Can we do September 5?" was stamped as
      // the design context. A scheduling proposal is booking text, never a
      // design brief.
      !textLooksLikeSchedulingProposal(live)
    ) {
      state.known_design_context = live
    } else if (historyAnchoredDesignIdea && live && !String(state.known_design_context || '').trim() && textNominatesNamedObjectAsReference(live)) {
      // v161: the client named the object in their own picture as the reference ("I mean I just want the
      // after cream ointment as a reference"); that sentence is readable design memory for every later turn.
      state.known_design_context = live
    }
  }

  if (
    intent.live_turn_accepts_offered_slot === true &&
    !explicitTimeConflictsWithOffer &&
    !currentExplicitDateProposal
  ) {
    if (!String(state.accepted_offered_date || '').trim()) {
      state.accepted_offered_date = String(state.last_offered_date || current.last_offered_date || '').trim()
    }
    if (!String(state.accepted_offered_time || '').trim()) {
      state.accepted_offered_time = String(state.last_offered_time || current.last_offered_time || '').trim()
    }
  }
  if (
    intent.live_turn_form_submitted_signal === true &&
    (state.form_link_sent === true || current.form_link_sent === true)
  ) {
    state.form_submitted = true
  }

  if (
    state.form_submitted === true &&
    !String(state.known_design_context || '').trim()
  ) {
    const recoveredDesign = recoverGroundedDesignContextFromHistory(root, threadId)
    if (recoveredDesign) state.known_design_context = recoveredDesign
  }

  // Persist a current, legal post-form date counter-proposal as the requested
  // appointment. The authority already resolved relative/voice date language and
  // classified the allowed window. Invalid dates remain negotiation-only.
  const liveDateStatus = String(proposed.live_turn_date_status || '').trim()
  if (
    liveDatePhrase &&
    liveDateStatus === 'too_soon' &&
    (state.form_submitted === true || current.form_submitted === true) &&
    !String(state.accepted_offered_date || '').trim()
  ) {
    // The authority history pass may observe the same current user date before it
    // classifies the allowed window. Never let that rejected proposal survive as
    // a durable requested slot and promote the next retry to time/identity/double-check.
    state.known_requested_date = ''
    state.known_requested_time = ''
  }
  if (
    liveDatePhrase &&
    liveDateStatus === 'legal' &&
    (state.form_submitted === true || current.form_submitted === true)
  ) {
    state.known_requested_date = liveDatePhrase
    // A date-only client counterproposal normally reopens time selection. The
    // one safe exception is an exact date/time pair that the assistant already
    // offered in visible history. Preserve that paired time, even when another
    // option was the most recently persisted slot, and issue a fresh checkpoint.
    state.known_requested_time = liveExplicitTime || matchedHistoricalOfferTime || (
      !replacesPersistedDate ? String(current.known_requested_time || '').trim() : ''
    )
  }

  state.control_plane_id = SCV_SINGLE_CONTROL_PLANE_ID
  state.control_epoch = SCV_CONTROL_EPOCH
  state.control_base_revision = Math.max(0, Number(current.control_revision) || 0)
  state.control_base_ingress_revision = Math.max(0, Number(current.ingress_revision) || 0)
  state.control_base_message_id = String(current.latest_ingress_message_id || event?.message_id || '')
  const reducedStage = deriveBookingStage(state)
  stampStructuredState(state, {
    stage: reducedStage,
    nextAction: nextActionForStage(reducedStage)
  })
  assertStructuredState(state)
  return state
}

function restoreFunnelDurableStateFromBaseline(stateValue = {}, baselineValue = {}) {
  const state = stateValue && typeof stateValue === 'object' ? stateValue : {}
  const baseline = baselineValue && typeof baselineValue === 'object' ? baselineValue : {}
  const guardedTrueFields = DURABLE_TRUE_FIELDS.filter((field) => field !== 'tattoo_intent_active')
  for (const field of guardedTrueFields) {
    if (baseline[field] === true) state[field] = true
    else delete state[field]
  }
  for (const field of DURABLE_STRING_FIELDS) {
    const value = String(baseline[field] || '').trim()
    if (value) state[field] = value
    else delete state[field]
  }
  state.live_turn_gave_design_idea = false
  return state
}

function restoreAllDurableStateFromControllerFloor(stateValue = {}, floorValue = {}) {
  const state = stateValue && typeof stateValue === 'object' ? stateValue : {}
  const floor = floorValue && typeof floorValue === 'object' ? floorValue : {}
  for (const field of DURABLE_TRUE_FIELDS) delete state[field]
  for (const field of DURABLE_STRING_FIELDS) delete state[field]
  Object.assign(state, extractDurableStructuredState(floor))
  return state
}

function promoteControllerObservedContextFloor(floorValue = {}, observedValue = {}) {
  const floor = floorValue && typeof floorValue === 'object' ? floorValue : {}
  const observed = observedValue && typeof observedValue === 'object' ? observedValue : {}
  for (const field of [
    'tattoo_intent_active',
    'known_reference_media_received',
    'known_tattoo_reference_media_received',
    'known_client_anchored_inspiration'
  ]) {
    if (observed[field] === true) floor[field] = true
  }
  for (const field of [
    'known_design_context',
    'known_placement_context',
    'known_size_context',
    'reference_request_context'
  ]) {
    const value = String(observed[field] || '').trim()
    if (value) floor[field] = value
  }
  return floor
}

function quarantineUnresolvedTurnDurableMutations(stateValue = {}, baselineValue = {}) {
  const state = stateValue && typeof stateValue === 'object' ? stateValue : {}
  const baseline = baselineValue && typeof baselineValue === 'object' ? baselineValue : {}
  if (state.live_turn_context_missing !== true) return state

  // A candidate may describe an unresolved pointer as a "direction" and thereby
  // try to write permanent design/form state even when the route itself correctly
  // says RESOLVE_CONTEXT.  That is recursive misinterpretation: the hallucinated
  // interpretation becomes next-turn evidence.  Restore every funnel-bearing
  // durable field from the pre-candidate controller state.  Tattoo-lane activity
  // may remain true, but no missing referent can become design readiness.
  return restoreFunnelDurableStateFromBaseline(state, baseline)
}

function packetPayloadSha256(packet) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  return sha256(JSON.stringify(bubbles.map((bubble) => String(bubble?.text || ''))))
}

function receiptHash(receipt) {
  return sha256([
    receipt.receipt_version,
    receipt.control_plane_id,
    receipt.control_epoch,
    receipt.thread_id,
    receipt.message_id,
    receipt.control_revision,
    receipt.ingress_revision,
    receipt.state_sha256,
    receipt.packet_sha256
  ].join('\n'))
}

function buildControlReceipt(state, messageId, packet) {
  const receipt = {
    receipt_version: CONTROL_RECEIPT_VERSION,
    control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
    control_epoch: SCV_CONTROL_EPOCH,
    thread_id: String(state.thread_id || state.contact_id || ''),
    message_id: String(messageId || ''),
    control_revision: Math.max(0, Number(state.control_revision) || 0),
    ingress_revision: Math.max(0, Number(state.ingress_revision) || 0),
    state_sha256: String(state.control_state_sha256 || ''),
    packet_sha256: packetPayloadSha256(packet)
  }
  receipt.receipt_sha256 = receiptHash(receipt)
  return receipt
}

function controlDecisionArtifactHash(artifact) {
  return sha256(JSON.stringify({
    artifact_version: String(artifact?.artifact_version || ''),
    source: String(artifact?.source || ''),
    thread_id: String(artifact?.thread_id || ''),
    message_id: String(artifact?.message_id || ''),
    receipt_sha256: String(artifact?.control_receipt?.receipt_sha256 || ''),
    packet_sha256: String(artifact?.control_receipt?.packet_sha256 || ''),
    bubble_texts: (Array.isArray(artifact?.packet?.bubbles) ? artifact.packet.bubbles : [])
      .map((bubble) => String(bubble?.text || '')),
    authority: artifact?.authority && typeof artifact.authority === 'object' ? artifact.authority : {}
  }))
}

function buildControlDecisionArtifact(decision, receipt, state) {
  const artifact = {
    artifact_version: 'scv-control-decision-artifact-2026-07-12-v1',
    source: SCV_SINGLE_CONTROL_SOURCE,
    thread_id: String(receipt?.thread_id || ''),
    message_id: String(receipt?.message_id || ''),
    control_revision: Math.max(0, Number(receipt?.control_revision) || 0),
    ingress_revision: Math.max(0, Number(receipt?.ingress_revision) || 0),
    authority: decision?.authority && typeof decision.authority === 'object' ? decision.authority : {},
    packet: decision?.packet && typeof decision.packet === 'object' ? decision.packet : { bubbles: [] },
    control_receipt: receipt,
    state_sha256: String(state?.control_state_sha256 || ''),
    created_at: new Date().toISOString()
  }
  artifact.artifact_sha256 = controlDecisionArtifactHash(artifact)
  return artifact
}

function readControlDecisionArtifact(root, receiptSha256) {
  const file = controlDecisionPath(root, receiptSha256)
  if (!file) return { valid: false, reason: 'control_decision_artifact_key_invalid', file: '' }
  const artifact = safeReadJson(file, null)
  if (!artifact || typeof artifact !== 'object') return { valid: false, reason: 'control_decision_artifact_missing', file }
  if (artifact.artifact_version !== 'scv-control-decision-artifact-2026-07-12-v1') return { valid: false, reason: 'control_decision_artifact_version_mismatch', file }
  if (artifact.source !== SCV_SINGLE_CONTROL_SOURCE) return { valid: false, reason: 'control_decision_artifact_source_mismatch', file }
  if (artifact.artifact_sha256 !== controlDecisionArtifactHash(artifact)) return { valid: false, reason: 'control_decision_artifact_hash_mismatch', file }
  if (String(artifact.control_receipt?.receipt_sha256 || '') !== String(receiptSha256 || '')) return { valid: false, reason: 'control_decision_artifact_receipt_mismatch', file }
  if (artifact.control_receipt?.receipt_sha256 !== receiptHash(artifact.control_receipt || {})) return { valid: false, reason: 'control_decision_artifact_receipt_hash_mismatch', file }
  if (packetPayloadSha256(artifact.packet) !== String(artifact.control_receipt?.packet_sha256 || '')) return { valid: false, reason: 'control_decision_artifact_packet_hash_mismatch', file }
  return { valid: true, reason: 'control_decision_artifact_valid', file, artifact }
}

function controlAuditContainsReceipt(root, threadId, receiptSha256) {
  const file = controlEventPath(root, threadId)
  try {
    if (!fs.existsSync(file)) return false
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => {
        try {
          const event = JSON.parse(line)
          return event?.type === 'control_decision_committed' && String(event?.receipt_sha256 || '') === String(receiptSha256 || '')
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}

function ensureControlCommitAuditUnlocked(root, threadId, receipt, state, decisionArtifact) {
  const file = controlEventPath(root, threadId)
  if (controlAuditContainsReceipt(root, threadId, receipt?.receipt_sha256)) return file
  return appendControlAuditUnlocked(root, threadId, {
    type: 'control_decision_committed',
    message_id: String(receipt?.message_id || ''),
    control_revision: Math.max(0, Number(receipt?.control_revision) || 0),
    ingress_revision: Math.max(0, Number(receipt?.ingress_revision) || 0),
    booking_stage_hint: String(state?.booking_stage_hint || deriveBookingStage(state || {})),
    state_sha256: String(receipt?.state_sha256 || state?.control_state_sha256 || ''),
    receipt_sha256: String(receipt?.receipt_sha256 || ''),
    packet_sha256: String(receipt?.packet_sha256 || ''),
    control_decision_artifact: String(decisionArtifact?.file || ''),
    control_decision_artifact_sha256: String(decisionArtifact?.artifact?.artifact_sha256 || ''),
    commit_audit_materialized: true
  })
}

function ensureControlCommitAudit(root, threadId, receipt, state, decisionArtifact) {
  return withThreadControlLock(root, threadId, () =>
    ensureControlCommitAuditUnlocked(root, threadId, receipt, state, decisionArtifact)
  )
}

function persistControlDecisionArtifact(root, decision, receipt, state) {
  const file = controlDecisionPath(root, receipt?.receipt_sha256)
  if (!file) throw new Error('single_control_decision_artifact_path_invalid')
  const existing = readControlDecisionArtifact(root, receipt.receipt_sha256)
  if (existing.valid) return existing
  const artifact = buildControlDecisionArtifact(decision, receipt, state)
  atomicWriteJson(file, artifact)
  const verified = readControlDecisionArtifact(root, receipt.receipt_sha256)
  if (!verified.valid) throw new Error(`single_control_decision_artifact_write_invalid:${verified.reason}`)
  return verified
}

function repairTransportPacketFromDecisionArtifact(root, packet) {
  const receiptSha = String(packet?.control_receipt?.receipt_sha256 || '')
  const decision = readControlDecisionArtifact(root, receiptSha)
  if (!decision.valid) return { repaired: false, reason: decision.reason }
  const artifact = decision.artifact
  if (String(packet?.thread_id || packet?.contact_id || '') !== String(artifact.thread_id || '')) return { repaired: false, reason: 'control_decision_repair_thread_mismatch' }
  if (String(packet?.message_id || '') !== String(artifact.message_id || '')) return { repaired: false, reason: 'control_decision_repair_message_mismatch' }
  const index = Number(packet?.bubble_index)
  const bubbles = Array.isArray(artifact.packet?.bubbles) ? artifact.packet.bubbles : []
  if (!Number.isInteger(index) || index < 0 || index >= bubbles.length) return { repaired: false, reason: 'control_decision_repair_bubble_index_invalid' }
  const repairedPacket = {
    ...packet,
    source: artifact.source,
    authority: artifact.authority,
    control_receipt: artifact.control_receipt,
    bubble_index: index,
    bubble_count: bubbles.length,
    bubbles,
    bubble: {
      ...(packet?.bubble && typeof packet.bubble === 'object' ? packet.bubble : {}),
      text: String(bubbles[index]?.text || '')
    },
    control_payload_repaired: true,
    control_payload_repaired_at: new Date().toISOString(),
    control_decision_artifact_sha256: artifact.artifact_sha256
  }
  const verdict = validateControlReceipt(repairedPacket, { root, requireLedger: true, requirePayload: true })
  if (!verdict.valid) return { repaired: false, reason: `control_decision_repair_receipt_invalid:${verdict.reason}` }
  return { repaired: true, reason: 'control_decision_payload_restored', packet: repairedPacket, artifact_file: decision.file }
}

function commitControlDecision(root, msg, structuredState, decision = {}) {
  const threadId = String(msg?.thread_id || msg?.contact_id || '')
  const messageId = String(msg?.message_id || '')
  if (!threadId || !messageId) throw new Error('single_control_commit_missing_event_identity')

  return withThreadControlLock(root, threadId, () => {
    const file = statePath(root, threadId)
    const current = migrateStateObject(safeReadJson(file, {}), threadId)
    const expectedIngressRevision = Math.max(0, Number(structuredState?.control_base_ingress_revision) || 0)
    const expectedMessageId = String(structuredState?.control_base_message_id || messageId)
    const actualMessageId = String(current.latest_ingress_message_id || '')
    const actualIngressRevision = Math.max(0, Number(current.ingress_revision) || 0)

    if (actualMessageId && actualMessageId !== messageId) {
      throw new Error(`single_control_nonlatest_inbound_rejected:${messageId}:${actualMessageId}`)
    }
    if (
      String(current.last_control_message_id || '') === messageId &&
      current.last_control_decision &&
      typeof current.last_control_decision === 'object'
    ) {
      const decisionArtifact = persistControlDecisionArtifact(
        root,
        current.last_control_decision,
        current.last_control_decision.control_receipt,
        current
      )
      const auditFile = ensureControlCommitAuditUnlocked(
        root,
        threadId,
        current.last_control_decision.control_receipt,
        current,
        decisionArtifact
      )
      return {
        ok: true,
        replayed: true,
        state_file: file,
        control_event_file: auditFile,
        state: current,
        receipt: current.last_control_decision.control_receipt,
        decision: current.last_control_decision,
        decision_artifact_file: decisionArtifact.file
      }
    }
    if (actualMessageId && expectedMessageId && actualMessageId !== expectedMessageId) {
      throw new Error(`single_control_stale_generation_message:${expectedMessageId}:${actualMessageId}`)
    }
    if (expectedIngressRevision && actualIngressRevision !== expectedIngressRevision) {
      throw new Error(`single_control_stale_generation_revision:${expectedIngressRevision}:${actualIngressRevision}`)
    }
    let next = applyDurableStructuredState({ ...current }, structuredState, { overwrite_strings: true })
    next.last_rejected_client_date = String(current.last_rejected_client_date || '').trim()
    next.last_rejected_client_date_message_id = String(current.last_rejected_client_date_message_id || '').trim()
    const committedAction = String(decision?.authority?.closed_transition_action || '')
    const committedReason = String(decision?.authority?.closed_transition_reason || '')
    const committedClientText = String(msg?.text || msg?.message || '').trim()
    const committedCalendarFrame = calendarBookingProposalFrame(committedClientText)
    const committedClockFrame = clockTimeBookingProposalFrame(committedClientText)
    const currentCommittedDateIso = bookingDateIsoForTurn(current.known_requested_date, msg, current)
    const rejectedCommittedDateIso = (
      (committedCalendarFrame.rejection === true || committedCalendarFrame.bounded === true) &&
      committedCalendarFrame.candidate_text
    )
      ? bookingDateIsoForTurn(committedCalendarFrame.candidate_text, msg, current)
      : ''
    const adoptedPersistedDateReversal = Boolean(
      next.form_submitted === true &&
      committedAction === CLOSED_TRANSITION_ACTIONS.POST_FORM_AVAILABILITY &&
      currentCommittedDateIso &&
      rejectedCommittedDateIso === currentCommittedDateIso
    )
    const adoptedPersistedTimeReversal = Boolean(
      next.form_submitted === true &&
      committedAction === CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME &&
      String(current.known_requested_time || '').trim() &&
      (committedClockFrame.rejection === true || committedClockFrame.bounded === true) &&
      committedClockFrame.candidate_text &&
      canonicalClockTimeKey(committedClockFrame.candidate_text) === canonicalClockTimeKey(current.known_requested_time)
    )
    const adoptedCalendarAmbiguityClarification = Boolean(
      next.form_submitted === true &&
      structuredState?.live_turn_calendar_ambiguity === true &&
      committedAction === CLOSED_TRANSITION_ACTIONS.POST_FORM_AVAILABILITY
    )
    const adoptedClockAmbiguityClarification = Boolean(
      next.form_submitted === true &&
      structuredState?.live_turn_clock_ambiguity === true &&
      committedAction === CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME
    )
    const adoptedTooEarlyTimeClarification = Boolean(
      next.form_submitted === true &&
      structuredState?.live_turn_time_status === 'too_early' &&
      committedAction === CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME
    )
    // Empty durable strings normally mean "no update", but a current calendar
    // counterproposal is an authoritative replacement event. It must be able to
    // clear the prior offered/accepted time and slot at commit, otherwise the
    // verified POST_FORM_TIME reply is persisted as READY_FOR_DOUBLE_CHECK and
    // the next turn jumps back to the stale date.
    const currentDateStatus = String(structuredState?.live_turn_date_status || '').trim()
    const currentDatePhrase = String(structuredState?.live_turn_date_phrase || '').trim()
    const committedPositiveDateIso = currentDateStatus === 'legal' && currentDatePhrase
      ? bookingDateIsoForTurn(currentDatePhrase, msg, current)
      : ''
    const committedClockDecision = committedClockFrame.proposal === true
      ? classifyBookingClockTimeText(committedClockFrame.candidate_text)
      : { status: 'missing' }
    const committedPositiveTime = String(
      structuredState?.live_turn_time_phrase ||
      structuredState?.live_turn_historical_offered_time ||
      ''
    ).trim() || (
      committedClockDecision.status === 'legal'
        ? String(committedClockFrame.candidate_text || '').trim()
        : ''
    )
    const activeSubmittedFormLane = next.form_submitted === true
    const adoptedPersistedDateReplacement = Boolean(
      activeSubmittedFormLane &&
      currentCommittedDateIso &&
      committedPositiveDateIso &&
      committedPositiveDateIso !== currentCommittedDateIso &&
      [
        CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME,
        CLOSED_TRANSITION_ACTIONS.POST_FORM_IDENTITY,
        CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK
      ].includes(committedAction)
    )
    const adoptedPersistedTimeReplacement = Boolean(
      activeSubmittedFormLane &&
      String(current.known_requested_time || '').trim() &&
      committedPositiveTime &&
      canonicalClockTimeKey(committedPositiveTime) !== canonicalClockTimeKey(current.known_requested_time) &&
      [
        CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME,
        CLOSED_TRANSITION_ACTIONS.POST_FORM_IDENTITY,
        CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK
      ].includes(committedAction)
    )
    const adoptedOutsideWindowCounterproposal = Boolean(
      activeSubmittedFormLane &&
      committedAction === CLOSED_TRANSITION_ACTIONS.POST_FORM_AVAILABILITY &&
      committedReason === 'submitted_form_date_counterproposal_outside_window' &&
      currentDateStatus === 'too_soon'
    )
    const adoptedLegalCalendarTransition = Boolean(
      activeSubmittedFormLane &&
      currentDateStatus === 'legal' &&
      [
        CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME,
        CLOSED_TRANSITION_ACTIONS.POST_FORM_IDENTITY,
        CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK
      ].includes(committedAction)
    )
    if (
      currentDatePhrase &&
      (adoptedOutsideWindowCounterproposal || adoptedLegalCalendarTransition)
    ) {
      next.accepted_offered_date = ''
      next.accepted_offered_time = ''
      if (adoptedLegalCalendarTransition) {
        next.known_requested_date = currentDatePhrase
        next.known_requested_time = String(
          structuredState?.live_turn_time_phrase ||
          structuredState?.live_turn_historical_offered_time ||
          ''
        ).trim()
        next.last_rejected_client_date = ''
        next.last_rejected_client_date_message_id = ''
      } else {
        next.known_requested_date = ''
        next.known_requested_time = ''
        next.last_rejected_client_date = currentDatePhrase
        next.last_rejected_client_date_message_id = messageId
      }
    }
    // Exact client reversal of an already committed slot is an authoritative
    // clear, not an empty-string no-op. A different rejected date/time leaves
    // the active booking untouched. Clear prior confirmation receipts as well
    // so a replacement value cannot skip straight to deposit on an old check.
    if (adoptedCalendarAmbiguityClarification) {
      next.known_requested_date = ''
      next.known_requested_time = ''
      next.accepted_offered_date = ''
      next.accepted_offered_time = ''
      delete next.double_check_sent
      delete next.name_phone_date_time_double_check_sent
      next.checkpoint_superseded_by_revision = true
    } else if (adoptedClockAmbiguityClarification) {
      next.known_requested_time = ''
      next.accepted_offered_date = ''
      next.accepted_offered_time = ''
      delete next.double_check_sent
      delete next.name_phone_date_time_double_check_sent
      next.checkpoint_superseded_by_revision = true
    } else if (adoptedTooEarlyTimeClarification) {
      next.known_requested_time = ''
      next.accepted_offered_date = ''
      next.accepted_offered_time = ''
      delete next.double_check_sent
      delete next.name_phone_date_time_double_check_sent
      next.checkpoint_superseded_by_revision = true
    } else if (adoptedPersistedDateReversal) {
      next.known_requested_date = ''
      next.known_requested_time = ''
      next.accepted_offered_date = ''
      next.accepted_offered_time = ''
      delete next.double_check_sent
      delete next.name_phone_date_time_double_check_sent
      next.checkpoint_superseded_by_revision = true
    } else if (adoptedPersistedTimeReversal) {
      next.known_requested_time = ''
      next.accepted_offered_date = ''
      next.accepted_offered_time = ''
      delete next.double_check_sent
      delete next.name_phone_date_time_double_check_sent
      next.checkpoint_superseded_by_revision = true
    }
    if (adoptedPersistedDateReplacement || adoptedPersistedTimeReplacement) {
      next.accepted_offered_date = ''
      next.accepted_offered_time = ''
      if (committedAction !== CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK) {
        delete next.double_check_sent
        delete next.name_phone_date_time_double_check_sent
        next.checkpoint_superseded_by_revision = true
      }
    }
    next.control_plane_id = SCV_SINGLE_CONTROL_PLANE_ID
    next.control_epoch = SCV_CONTROL_EPOCH
    next.control_revision = Math.max(0, Number(current.control_revision) || 0) + 1
    next.last_control_message_id = messageId
    next.last_control_committed_at = new Date().toISOString()
    const adoptedPacket = decision.packet && typeof decision.packet === 'object'
      ? decision.packet
      : { bubbles: [] }
    if (!Array.isArray(adoptedPacket.bubbles) || !adoptedPacket.bubbles.some((bubble) => String(bubble?.text || '').trim())) {
      throw new Error('single_control_commit_empty_packet_rejected')
    }
    if ([
      CLOSED_TRANSITION_ACTIONS.POST_FORM_AVAILABILITY,
      CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME
    ].includes(committedAction)) {
      if (next.form_submitted === true && !String(next.known_design_context || '').trim()) {
        const recoveredDesign = recoverGroundedDesignContextFromHistory(root, threadId)
        if (recoveredDesign) next.known_design_context = recoveredDesign
      }
      const offered = extractLatestOfferedSlotFromPacket(adoptedPacket)
      if (offered) {
        next.last_offered_date = offered.date
        next.last_offered_time = offered.time
      }
    }
    const committedStage = deriveBookingStage(next)
    stampStructuredState(next, {
      stage: committedStage,
      nextAction: nextActionForStage(committedStage)
    })
    assertStructuredState(next)
    next.control_state_sha256 = sha256(JSON.stringify(semanticSnapshot(next)))
    const receipt = buildControlReceipt(next, messageId, adoptedPacket)
    const recent = Array.isArray(current.control_recent_receipts) ? current.control_recent_receipts.slice(-23) : []
    next.control_recent_receipts = recent.concat([receipt])
    next.last_control_decision = {
      source: SCV_SINGLE_CONTROL_SOURCE,
      authority: decision.authority && typeof decision.authority === 'object' ? decision.authority : {},
      raw_text: String(decision.raw_text || ''),
      packet: adoptedPacket,
      contact_id: String(msg?.contact_id || threadId),
      thread_id: threadId,
      instagram_username: String(msg?.instagram_username || ''),
      message_id: messageId,
      control_receipt: receipt
    }
    atomicWriteJson(file, next)
    if (
      process.env.SCV_SINGLE_CONTROL_TEST_HARNESS === '1' &&
      decision?.test_fault_after_durable_state_write === 'sigkill'
    ) {
      process.kill(process.pid, 'SIGKILL')
    }
    const decisionArtifact = persistControlDecisionArtifact(root, next.last_control_decision, receipt, next)
    const auditFile = ensureControlCommitAuditUnlocked(root, threadId, receipt, next, decisionArtifact)

    return {
      ok: true,
      state_file: file,
      control_event_file: auditFile,
      state: next,
      receipt,
      decision: next.last_control_decision,
      decision_artifact_file: decisionArtifact.file
    }
  })
}

function replayCommittedDecision(root, msg) {
  const threadId = String(msg?.thread_id || msg?.contact_id || '')
  const messageId = String(msg?.message_id || '')
  if (!threadId || !messageId) return null
  const state = readControlState(root, threadId)
  const latestMessageId = String(state.latest_ingress_message_id || '')
  if (latestMessageId && latestMessageId !== messageId) {
    throw new Error(`single_control_nonlatest_inbound_rejected:${messageId}:${latestMessageId}`)
  }
  if (String(state.last_control_message_id || '') !== messageId) return null
  const stored = state.last_control_decision
  if (!stored || typeof stored !== 'object' || !Array.isArray(stored.packet?.bubbles)) return null
  const result = {
    ...stored,
    structured_state: state,
    control_state_file: statePath(root, threadId),
    control_event_file: controlEventPath(root, threadId),
    replayed_control_decision: true
  }
  const decisionArtifact = persistControlDecisionArtifact(root, stored, stored.control_receipt, state)
  ensureControlCommitAudit(root, threadId, stored.control_receipt, state, decisionArtifact)
  assertSingleControlEnvelope(result, { root, requireLedger: true })
  return result
}

function envelopeBubbles(packet) {
  if (Array.isArray(packet?.packet?.bubbles)) return packet.packet.bubbles
  if (Array.isArray(packet?.bubbles)) return packet.bubbles
  return null
}

function validatePayloadBinding(packet, receipt, requirePayload) {
  const bubbles = envelopeBubbles(packet)
  if (!bubbles) {
    return requirePayload
      ? { valid: false, reason: 'single_control_payload_missing' }
      : { valid: true, reason: 'payload_not_required' }
  }
  if (packetPayloadSha256({ bubbles }) !== String(receipt.packet_sha256 || '')) {
    return { valid: false, reason: 'single_control_packet_payload_hash_mismatch' }
  }
  if (packet?.bubble && typeof packet.bubble === 'object') {
    const index = Number(packet.bubble_index)
    if (!Number.isInteger(index) || index < 0 || index >= bubbles.length) {
      return { valid: false, reason: 'single_control_bubble_index_invalid' }
    }
    if (String(packet.bubble.text || '') !== String(bubbles[index]?.text || '')) {
      return { valid: false, reason: 'single_control_bubble_payload_mismatch' }
    }
  }
  return { valid: true, reason: 'payload_hash_valid' }
}

function validateControlReceipt(packetOrReceipt, { root, requireLedger = true, requirePayload = false } = {}) {
  const packet = packetOrReceipt && typeof packetOrReceipt === 'object' ? packetOrReceipt : {}
  const receipt = packet.control_receipt && typeof packet.control_receipt === 'object'
    ? packet.control_receipt
    : packet
  if (String(packet.source || SCV_SINGLE_CONTROL_SOURCE) !== SCV_SINGLE_CONTROL_SOURCE) {
    return { valid: false, reason: 'single_control_source_mismatch' }
  }
  if (receipt.receipt_version !== CONTROL_RECEIPT_VERSION) return { valid: false, reason: 'single_control_receipt_version_mismatch' }
  if (receipt.control_plane_id !== SCV_SINGLE_CONTROL_PLANE_ID) return { valid: false, reason: 'single_control_plane_id_mismatch' }
  if (receipt.control_epoch !== SCV_CONTROL_EPOCH) return { valid: false, reason: 'single_control_epoch_mismatch' }
  if (!String(receipt.thread_id || '') || !String(receipt.message_id || '')) return { valid: false, reason: 'single_control_receipt_identity_missing' }
  if (!/^[a-f0-9]{64}$/i.test(String(receipt.packet_sha256 || ''))) return { valid: false, reason: 'single_control_packet_hash_missing' }
  if (packet.thread_id && String(packet.thread_id) !== String(receipt.thread_id)) return { valid: false, reason: 'single_control_thread_mismatch' }
  if (packet.message_id && String(packet.message_id) !== String(receipt.message_id)) return { valid: false, reason: 'single_control_message_mismatch' }
  if (receipt.receipt_sha256 !== receiptHash(receipt)) return { valid: false, reason: 'single_control_receipt_hash_mismatch' }
  const payloadVerdict = validatePayloadBinding(packet, receipt, requirePayload)
  if (!payloadVerdict.valid) return payloadVerdict
  if (!requireLedger) return { valid: true, reason: 'shape_hash_and_payload_valid' }

  const state = readControlState(root, receipt.thread_id)
  const recent = Array.isArray(state.control_recent_receipts) ? state.control_recent_receipts : []
  const adopted = recent.some((item) =>
    item &&
    String(item.receipt_sha256 || '') === String(receipt.receipt_sha256 || '') &&
    String(item.message_id || '') === String(receipt.message_id || '')
  )
  const decisionArtifact = adopted ? null : readControlDecisionArtifact(root, receipt.receipt_sha256)
  const artifactAdopted = !!(
    decisionArtifact?.valid &&
    String(decisionArtifact.artifact?.thread_id || '') === String(receipt.thread_id || '') &&
    String(decisionArtifact.artifact?.message_id || '') === String(receipt.message_id || '') &&
    controlAuditContainsReceipt(root, receipt.thread_id, receipt.receipt_sha256)
  )
  return (adopted || artifactAdopted)
    ? { valid: true, reason: 'receipt_in_control_ledger' }
    : { valid: false, reason: 'single_control_receipt_not_in_ledger' }
}

function assertSingleControlEnvelope(result, { root, requireLedger = true } = {}) {
  if (!result || result.source !== SCV_SINGLE_CONTROL_SOURCE) throw new Error('single_control_envelope_source_invalid')
  if (result.authority?.controller !== SCV_SINGLE_CONTROL_PLANE_ID) throw new Error('single_control_envelope_controller_invalid')
  if (result.authority?.runner !== 'scv-single-control-plane') throw new Error('single_control_envelope_runner_invalid')
  const verdict = validateControlReceipt(result, { root, requireLedger, requirePayload: true })
  if (!verdict.valid) throw new Error(`single_control_envelope_receipt_invalid:${verdict.reason}`)
  return true
}

function executeSingleControlTurn(msg, opts = {}) {
  const root = rootPath(opts.root || process.env.SCV_ROOT || __dirname)
  const replay = replayCommittedDecision(root, msg)
  if (replay) return replay
  if (
    msg?.control_final_recovery_version ===
      'scv-inbox-monotonic-final-recovery-2026-08-30-v2' &&
    [
      'committed_pre_network_final_replay',
      'postcommit_delivery_reconciliation'
    ].includes(String(msg?.control_final_recovery_phase || ''))
  ) {
    // Every committed recovery phase is authorized to replay only the already
    // committed receipt/payload. If that decision is missing or corrupt, fresh
    // generation could mutate the funnel and create a second semantic reply.
    throw new Error(
      msg.control_final_recovery_phase === 'committed_pre_network_final_replay'
        ? 'single_control_committed_pre_network_replay_commit_missing'
        : 'single_control_delivery_replay_commit_missing'
    )
  }

  const configuredCandidateGenerator = typeof opts.candidateGenerator === 'function'
    ? opts.candidateGenerator
    : require(path.join(__dirname, 'dm-authority.js')).generatePacketFromCodexAuthority
  const injectedCandidateGenerator = typeof opts.candidateGenerator === 'function'
  const baseAuthorityOptions = opts.authority_options && typeof opts.authority_options === 'object'
    ? { ...opts.authority_options }
    : {}
  const transitionRecentHistory = Array.isArray(baseAuthorityOptions.recent_history_override)
    ? baseAuthorityOptions.recent_history_override
    : recentControlHistoryBeforeTurn(root, msg, baseAuthorityOptions.history_limit || 30)
  let forcedSafeClarificationRecovery = Boolean(
    msg?.control_force_safe_clarification_recovery === true &&
    msg?.control_safe_clarification_recovery_version ===
      'scv-inbox-safe-clarification-recovery-2026-08-25-v2-context-bound' &&
    Number(msg?.control_safe_clarification_recovery_after_attempts || 0) > 0 &&
    msg?.last_error_kind === 'persistent_internal_control' &&
    msg?.control_safe_clarification_recovery_reason === 'verifier_or_adoption_exhausted'
  )
  const forcedRouteAwareVisibleRecovery = Boolean(
    msg?.control_force_route_aware_visible_recovery === true &&
    msg?.control_route_aware_visible_recovery_version === ROUTE_AWARE_VISIBLE_RECOVERY_VERSION &&
    Number(msg?.control_route_aware_visible_recovery_after_attempts || 0) > 0 &&
    [
      'persistent_internal_control',
      'persistent_unclassified_fail_closed',
      'transient_upstream'
    ].includes(
      String(msg?.last_error_kind || '')
    ) &&
    [
      'persistent_failure_exhausted',
      'unclassified_failure_exhausted',
      'transient_upstream_exhausted'
    ].includes(
      String(msg?.control_route_aware_visible_recovery_reason || '')
    )
  )
  // v160: final recovery used the raw reference-post transport placeholder even
  // though the authenticated same-message history already identified failed ASR.
  // Keep the original envelope/receipt identity; only recovery's semantic input is
  // enriched. Text or candidate flags alone cannot forge this history+audit proof.
  const recoveryMediaEvidence = sourceAuthenticatedEnrichedInboundTurn(root, msg)
  const recoveryUnresolvedVoice = Boolean(
    forcedRouteAwareVisibleRecovery && recoveryMediaEvidence &&
    /^sent a voice note\b/i.test(recoveryMediaEvidence.text) &&
    mediaContextAuthorityRank(recoveryMediaEvidence.text) === 100
  )
  if (recoveryUnresolvedVoice) forcedSafeClarificationRecovery = true
  let candidateGenerator = configuredCandidateGenerator
  if (forcedSafeClarificationRecovery) {
    candidateGenerator = (_msg, authorityOptions = {}) => {
        const recoveryInput = {
          message: String(recoveryMediaEvidence?.text || msg?.text || msg?.message || ''),
          live_message: String(recoveryMediaEvidence?.text || msg?.text || msg?.message || ''),
          media_type: String(msg?.media_type || ''),
          structured_state: {
            ...(authorityOptions.structured_state_override || {}),
            ...(recoveryUnresolvedVoice ? {
              live_turn_is_voice_note: true,
              live_turn_voice_transcribe_failed: true,
              live_turn_voice_context_unresolved: true,
              live_turn_is_media_reference: false,
              live_turn_is_media_only_no_content: false
            } : {})
          },
          control_transition_contract: authorityOptions.control_transition_contract || null
        }
        const packet = buildSafeClarificationRecoveryPacket(recoveryInput)
        return {
          source: 'codex_exec_dm_authority',
          authority: {
            runner: 'scv-single-control-plane',
            model: 'none',
            executor: 'deterministic_safe_clarification_after_model_exhaustion',
            deterministic_recovery: true,
            deterministic_recovery_kind: 'safe_clarification',
            deterministic_recovery_reason: 'durable_verifier_or_adoption_exhaustion',
            deterministic_recovery_version: DETERMINISTIC_RECOVERY_VERSION,
            openai_conversation: null
          },
          raw_text: packet.reply_text,
          packet,
          structured_state: recoveryInput.structured_state,
          intent_adoption_state: {},
          recent_history: transitionRecentHistory
        }
      }
  } else if (forcedRouteAwareVisibleRecovery) {
    candidateGenerator = (_msg, authorityOptions = {}) => {
      const originalPlan = authorityOptions.control_transition_contract || {
        action: 'general_continue',
        reason: 'missing_route_after_failure_exhaustion',
        obligations: [],
        fields: {}
      }
      const recoveryInput = {
        message: String(msg?.text || msg?.message || ''),
        live_message: String(msg?.text || msg?.message || ''),
        recent_history: transitionRecentHistory,
        structured_state: {
          ...(authorityOptions.structured_state_override || {})
        },
        control_transition_contract: originalPlan
      }
      // A retry ledger describes why an earlier state could not be adopted; it
      // is not authority to ignore booking facts that became complete before
      // this bounded recovery pass. Exact double-check and deposit checkpoints
      // already have their own fully verified deterministic packets. Use those
      // packets under their original transactional route instead of downgrading
      // the turn to generic resolve_context copy such as "while I verify".
      const checkpointRecovered = [
        CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK,
        CLOSED_TRANSITION_ACTIONS.DEPOSIT_HANDOFF
      ].includes(String(originalPlan.action || ''))
      const packet = checkpointRecovered
        ? buildDeterministicRecoveryPacket(recoveryInput, originalPlan)
        : buildRouteAwareVisibleRecoveryPacket(recoveryInput, originalPlan)
      return {
        source: 'codex_exec_dm_authority',
        authority: {
          runner: 'scv-single-control-plane',
          model: 'none',
          executor: checkpointRecovered
            ? 'deterministic_fixed_booking_checkpoint'
            : 'deterministic_route_aware_visible_after_failure_exhaustion',
          deterministic_recovery: !checkpointRecovered,
          deterministic_recovery_kind: checkpointRecovered
            ? ''
            : 'route_aware_visible',
          deterministic_recovery_reason: checkpointRecovered
            ? ''
            : String(
                msg?.control_route_aware_visible_recovery_reason || 'persistent_failure_exhausted'
              ),
          deterministic_recovery_version: checkpointRecovered
            ? ''
            : ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
          openai_conversation: null
        },
        raw_text: packet.reply_text,
        packet,
        structured_state: recoveryInput.structured_state,
        intent_adoption_state: {},
        recent_history: transitionRecentHistory
      }
    }
  }
  // Lock the pre-candidate semantic floor before any interpretation of the live
  // turn. reduceConversationState may provisionally classify current wording as
  // a design idea; that provisional value must never become the baseline used to
  // quarantine an unresolved referent from the same turn.
  const persistedBaseline = readControlState(root, String(msg?.thread_id || msg?.contact_id || ''))
  // Upgrade older threads from retained assistant evidence before the prompt's 30-event window.
  // Only the monotonic price flag is recovered; the model context window stays bounded.
  if (persistedBaseline.known_model_rate_disclosed !== true && modelRateAlreadyDisclosed({
    recent_history: recentControlHistoryBeforeTurn(root, msg, 500)
  })) persistedBaseline.known_model_rate_disclosed = true
  const controllerIngressTimeMs = immutableIngressTimeMs(msg)
  if (!controllerIngressTimeMs) {
    throw new Error('single_control_immutable_ingress_time_required')
  }
  const controllerIngressReference = new Date(controllerIngressTimeMs).toISOString()
  const inputState = reduceConversationState({
    root,
    persisted: persistedBaseline,
    candidate: baseAuthorityOptions.structured_state_override,
    event: msg
  })
  // Calendar grounding must exist before the first route is frozen.  The
  // downstream authoring path already builds this snapshot, but the controller
  // previously classified a too-soon date first and left its transition fields
  // with no minimum/earliest legal alternative. Every correct candidate date
  // then looked "invented" and all passes could exhaust into silence. Recompute
  // the deterministic snapshot from the immutable ingress timestamp at the
  // controller boundary so route, generator, strict gate, and liveness gate see
  // the same legal calendar object from pass one.
  Object.assign(inputState, buildBookingPolicySnapshot({
    receivedAt: controllerIngressReference
  }))
  // Source-boundary booking identity: the controller must see the name/phone in
  // this exact inbound before it freezes the route. Previously only dm-authority
  // annotated these fields after POST_FORM_IDENTITY was already locked. Its model
  // candidate then correctly triggered the four-field verifier, but the outer
  // controller retried the stale identity route until silence. Use the shared
  // parser here so controller, runner, and verifier start from one state object.
  const liveIdentity = liveBookingIdentityAnswer(
    String(msg?.text || msg?.message || ''),
    persistedBaseline
  )
  inputState.live_turn_phone_candidate = liveIdentity.phone
  inputState.live_turn_name_candidate = liveIdentity.name
  // Resolve only the structural dialogue-slot fact needed before candidate
  // generation.  The single controller previously derived its first route
  // before dm-authority bound a short numeric reply to the immediately open
  // calendar question.  That split let controller, generator, and verifier see
  // different objects for "How about 26?".  Do not run the full downstream
  // annotator here: it also owns time-window metadata available later in the
  // authority path and would erase an already supplied date-status fact.  This
  // bounded detector adds no visible prose and does not replace model authorship.
  const {
    extractContextualBookingDayReply,
    assistantPacketOpensDateAvailability,
    buildStructuredState,
    annotateStructuredStateForLiveTurn
  } = require(path.join(__dirname, 'dm-authority.js'))
  Object.assign(
    inputState,
    annotateStructuredStateForLiveTurn(msg, inputState, transitionRecentHistory)
  )
  enforceControllerIdentityAuthority(
    inputState,
    String(msg?.text || msg?.message || ''),
    persistedBaseline
  )
  preserveSameEventCheckpointInvalidation(inputState, msg, persistedBaseline)
  const latestVisibleAssistantEvent = [...transitionRecentHistory]
    .reverse()
    .find((event) => isConversationVisibleAssistantEvent(event))
  const latestVisibleAssistantPacketText = String(
    latestVisibleAssistantEvent?.text || latestVisibleAssistantEvent?.message || ''
  )
  // The revision boundary applies to the latest checkpoint that is still
  // pending, even when clarification or recovery turns were sent after it
  // ("wait can i change something" -> ask -> "the number is wrong its ...").
  const latestVisibleCheckpointText = String(
    [...transitionRecentHistory]
      .reverse()
      .find((event) => isConversationVisibleAssistantEvent(event) &&
        extractVisibleAssistantDoubleCheckFields(String(event?.text || event?.message || '')))
      ?.text || ''
  )
  const checkpointStillPending = Boolean(
    persistedBaseline?.double_check_sent === true ||
    persistedBaseline?.name_phone_date_time_double_check_sent === true ||
    String(persistedBaseline?.booking_stage_hint || '').trim() === 'awaiting_double_check_confirmation'
  )
  const visibleDoubleCheckPayload = extractVisibleAssistantDoubleCheckFields(
    latestVisibleAssistantPacketText
  ) || (checkpointStillPending ? extractVisibleAssistantDoubleCheckFields(latestVisibleCheckpointText) : null)
  const controllerAcceptanceInput = {
    ...msg,
    message: String(msg?.text || msg?.message || ''),
    live_message: String(msg?.text || msg?.message || ''),
    recent_history: transitionRecentHistory,
    structured_state: inputState
  }
  if (
    inputState.form_submitted === true &&
    liveAcceptsOfferedBookingSlot(controllerAcceptanceInput)
  ) {
    const historicalOffer = extractLatestOfferedSlotFromPacket({
      bubbles: transitionRecentHistory
        .filter((event) => isConversationVisibleAssistantEvent(event))
        .map((event) => ({ text: String(event?.text || event?.message || '') }))
    })
    const offeredDate = String(
      inputState.last_offered_date || historicalOffer?.date || ''
    ).trim()
    const offeredTime = String(
      inputState.last_offered_time || historicalOffer?.time || ''
    ).trim()
    if (offeredDate && offeredTime) {
      inputState.last_offered_date = offeredDate
      inputState.last_offered_time = offeredTime
      inputState.accepted_offered_date = offeredDate
      inputState.accepted_offered_time = offeredTime
      inputState.known_requested_date = offeredDate
      inputState.known_requested_time = offeredTime
      inputState.live_turn_accepts_offered_slot = true
      inputState.live_turn_accepted_offered_date = offeredDate
      inputState.live_turn_accepted_offered_time = offeredTime
      const acceptedStage = deriveBookingStage(inputState)
      stampStructuredState(inputState, {
        stage: acceptedStage,
        nextAction: nextActionForStage(acceptedStage)
      })
    }
  }
  const assistantDateSlotOpen = Boolean(
    inputState.form_submitted === true &&
    (
      assistantPacketOpensDateAvailability(latestVisibleAssistantPacketText) ||
      visibleDoubleCheckPayload
    )
  )
  const controllerLiveClockCandidate = liveBookingClockTime(
    String(msg?.text || msg?.message || ''),
    persistedBaseline,
    transitionRecentHistory
  )
  const controllerLiveClockDecision = controllerLiveClockCandidate
    ? classifyBookingClockTimeText(controllerLiveClockCandidate)
    : { status: 'missing', canonical_label: '', minimum_booking_time_label: MINIMUM_BOOKING_TIME_LABEL }
  const controllerLiveClockTime = controllerLiveClockDecision.status === 'legal'
    ? controllerLiveClockCandidate
    : ''
  if (controllerLiveClockDecision.status === 'too_early') {
    // Enforce the time floor before the first route is frozen. The client time
    // remains visible as a transient proposal, but it cannot satisfy the time
    // field, inherit an old offered slot, or promote the turn to DOUBLE_CHECK.
    inputState.live_turn_time_candidate =
      controllerLiveClockDecision.canonical_label || controllerLiveClockCandidate
    inputState.live_turn_time_status = 'too_early'
    inputState.minimum_booking_time_local =
      controllerLiveClockDecision.minimum_booking_time_label || MINIMUM_BOOKING_TIME_LABEL
    inputState.live_turn_time_phrase = ''
    inputState.known_requested_time = ''
    inputState.live_turn_accepts_offered_slot = false
    inputState.live_turn_accepted_offered_time = ''
    inputState.accepted_offered_date = ''
    inputState.accepted_offered_time = ''
    inputState.live_turn_checkpoint_invalidated = true
    delete inputState.double_check_sent
    delete inputState.name_phone_date_time_double_check_sent
  }
  const controllerFourFieldPayload = explicitFourFieldBookingPayload(
    String(msg?.text || msg?.message || ''),
    persistedBaseline
  )
  const contextualDayReply = extractContextualBookingDayReply(
    String(msg?.text || msg?.message || ''),
    {
      ...inputState,
      // reduceConversationState intentionally emits semantic state only and
      // strips the receipt-bound last control envelope. The dialogue-slot
      // resolver needs that envelope solely as prior packet evidence when the
      // provider left history in assistant_attempted state.
      last_control_message_id: String(persistedBaseline?.last_control_message_id || ''),
      last_control_decision: persistedBaseline?.last_control_decision
    },
    transitionRecentHistory
  )
  if (contextualDayReply) {
    inputState.live_turn_contextual_booking_reply = true
    inputState.live_turn_monthless_day_candidate = String(contextualDayReply.day)
    inputState.live_turn_contextual_month_anchor = String(contextualDayReply.month_anchor || '')
    inputState.live_turn_date_needs_month = !contextualDayReply.month_anchor
    inputState.live_turn_context_relation = 'resolved_from_history'
    inputState.live_turn_context_confidence = 'high'
    inputState.live_turn_context_resolution_source = String(
      contextualDayReply.month_resolution_source || 'open_booking_question_slot_authority'
    )
    inputState.live_turn_context_missing = false
    inputState.live_turn_context_missing_attachment = false
    inputState.live_turn_context_needs_clarification = false
    inputState.live_turn_context_resolved_from_history = true
    inputState.live_turn_self_contained_topic_shift = false
    inputState.live_turn_reference_pointer_without_media = false

    // A contextual day can be a complete date when the immediately preceding
    // rejected client proposal supplies the month ("27 August" -> "28?").
    // Previously the controller recorded the day/month relation but left the
    // date status empty until the downstream model path. The first route then
    // froze as submitted_form_missing_date while the model correctly reasoned
    // over August 28; the adoption gate saw incompatible objects and rejected
    // every candidate. Classify the resolved calendar object before route lock
    // so controller, model, verifier, and adoption all see the same date.
    if (contextualDayReply.month_anchor) {
      const contextualDate = classifyBookingDateText(
        `${contextualDayReply.month_anchor} ${contextualDayReply.day}`,
        {
          referenceTime: controllerIngressReference,
          currentDateLocal: inputState.current_message_date_local,
          minimumDateLocal: inputState.minimum_booking_date_local,
          allowAmbiguousDay: true
        }
      )
      if (contextualDate && ['legal', 'too_soon'].includes(contextualDate.status)) {
        const currentContextualTime = controllerLiveClockTime
        const contextualHistoricalOffer = currentContextualTime
          ? null
          : historicalOfferedSlotForDate(
              transitionRecentHistory,
              contextualDate.date_iso,
              msg,
              persistedBaseline
            )
        const contextualHistoricalTime = String(contextualHistoricalOffer?.time || '').trim()
        inputState.live_turn_date_phrase = contextualDate.phrase || `${contextualDayReply.month_anchor} ${contextualDayReply.day}`
        inputState.live_turn_date_status = contextualDate.status
        inputState.live_turn_date_iso = contextualDate.date_iso
        inputState.live_turn_date_availability = contextualDate.availability
        inputState.live_turn_date_availability_source = contextualDate.availability_source
        inputState.booking_policy_version = SCV_BOOKING_POLICY_VERSION
        inputState.booking_policy_fingerprint = BOOKING_POLICY_FINGERPRINT
        inputState.live_turn_time_phrase = currentContextualTime
        inputState.live_turn_historical_offered_time = contextualHistoricalTime
        inputState.live_turn_accepts_offered_slot = false
        inputState.live_turn_accepted_offered_date = ''
        inputState.live_turn_accepted_offered_time = ''
        inputState.accepted_offered_date = ''
        inputState.accepted_offered_time = ''
        if (contextualDate.status === 'legal' && inputState.form_submitted === true) {
          inputState.known_requested_date = contextualDate.phrase
          inputState.known_requested_time = currentContextualTime || contextualHistoricalTime || ''
          if (contextualHistoricalTime) {
            inputState.last_offered_date = contextualDate.phrase
            inputState.last_offered_time = contextualHistoricalTime
          }
        }
        if (contextualDate.status === 'too_soon' && inputState.form_submitted === true) {
          inputState.known_requested_date = ''
          inputState.known_requested_time = ''
        }
        const contextualDateStage = deriveBookingStage(inputState)
        stampStructuredState(inputState, {
          stage: contextualDateStage,
          nextAction: nextActionForStage(contextualDateStage)
        })
      }
    }
  } else {
    // A fully specified calendar date is also structural authority and must be
    // present before the first candidate is generated. Previously
    // "15th of August" was interpreted only inside the downstream authority
    // process, while the outer controller pre-locked a stale/social route.
    // Rejected candidates then retried against the wrong route and went silent.
    const liveCalendarText = String(msg?.text || msg?.message || '')
    const calendarFrame = calendarBookingProposalFrame(liveCalendarText, {
      allowBareDate: assistantDateSlotOpen
    })
    const explicitDateCandidate = calendarFrame.proposal === true && calendarFrame.candidate_text
      ? calendarFrame.candidate_text
      : String(controllerFourFieldPayload?.date_text || '')
    const explicitDate = explicitDateCandidate
      ? classifyBookingDateText(explicitDateCandidate, {
        referenceTime: controllerIngressReference,
        currentDateLocal: inputState.current_message_date_local,
        minimumDateLocal: inputState.minimum_booking_date_local,
        allowAmbiguousDay: false
      })
      : null
    if (explicitDate && ['legal', 'too_soon'].includes(explicitDate.status)) {
      const currentExplicitTime = controllerLiveClockTime
      const explicitHistoricalOffer = currentExplicitTime
        ? null
        : historicalOfferedSlotForDate(
            transitionRecentHistory,
            explicitDate.date_iso,
            msg,
            persistedBaseline
          )
      const explicitHistoricalTime = String(explicitHistoricalOffer?.time || '').trim()
      inputState.live_turn_date_phrase = explicitDate.phrase
      inputState.live_turn_date_status = explicitDate.status
      inputState.live_turn_date_iso = explicitDate.date_iso
      inputState.live_turn_date_availability = explicitDate.availability
      inputState.live_turn_date_availability_source = explicitDate.availability_source
      inputState.booking_policy_version = SCV_BOOKING_POLICY_VERSION
      inputState.booking_policy_fingerprint = BOOKING_POLICY_FINGERPRINT
      inputState.live_turn_date_needs_month = false
      inputState.live_turn_time_phrase = currentExplicitTime
      inputState.live_turn_historical_offered_time = explicitHistoricalTime
      inputState.live_turn_accepts_offered_slot = false
      inputState.live_turn_accepted_offered_date = ''
      inputState.live_turn_accepted_offered_time = ''
      inputState.accepted_offered_date = ''
      inputState.accepted_offered_time = ''
      if (explicitDate.status === 'legal' && inputState.form_submitted === true) {
        const persistedExplicitDateIso = bookingDateIsoForTurn(
          persistedBaseline?.known_requested_date,
          msg,
          persistedBaseline
        )
        const reaffirmsPersistedDate = Boolean(
          explicitDate.date_iso &&
          persistedExplicitDateIso &&
          explicitDate.date_iso === persistedExplicitDateIso
        )
        inputState.known_requested_date = explicitDate.phrase
        // A clock time from this exact live turn is authoritative. An exact
        // date/time pair previously offered in visible history is also safe to
        // reuse; arbitrary old/default times remain forbidden.
        inputState.known_requested_time = currentExplicitTime || explicitHistoricalTime || (
          reaffirmsPersistedDate
            ? String(persistedBaseline?.known_requested_time || '').trim()
            : ''
        )
        if (explicitHistoricalTime) {
          inputState.last_offered_date = explicitDate.phrase
          inputState.last_offered_time = explicitHistoricalTime
        }
      }
      if (explicitDate.status === 'too_soon' && inputState.form_submitted === true) {
        inputState.known_requested_date = ''
        inputState.known_requested_time = ''
      }
      const dateUpdatedStage = deriveBookingStage(inputState)
      stampStructuredState(inputState, {
        stage: dateUpdatedStage,
        nextAction: nextActionForStage(dateUpdatedStage)
      })
    }
  }
  // A visible four-field checkpoint is not an irreversible state latch. Any
  // current client attempt to revise, reject, or clarify one of its fields owns
  // the next turn. Reconstruct the latest client-authoritative booking values,
  // apply only the current exact replacement, invalidate the old checkpoint,
  // and let the controller issue a fresh checkpoint or one bounded clarification.
  // This is a grammar/class invariant, not a phrase patch: date, time, identity,
  // explicit replacements, negative corrections, and ambiguous alternatives all
  // pass through the same revision boundary.
  if (visibleDoubleCheckPayload) {
    const liveRevisionText = String(msg?.text || msg?.message || '').trim()
    const liveRevisionClockFrame = liveBookingClockFrame(
      liveRevisionText,
      { ...persistedBaseline, form_submitted: true },
      transitionRecentHistory
    )
    const liveRevisionCalendarFrame = calendarBookingProposalFrame(
      liveRevisionText,
      { allowBareDate: true }
    )
    const currentFourFieldRevision = explicitFourFieldBookingPayload(
      liveRevisionText,
      { ...persistedBaseline, form_submitted: true }
    )
    const explicitPhoneRevision = extractBookingPhone(liveRevisionText) &&
      /\b(?:my\s+|the\s+|new\s+|correct\s+)?(?:phone(?:\s+number)?|number|cell|mobile)\b/i.test(liveRevisionText)
      ? extractBookingPhone(liveRevisionText)
      : ''
    const explicitNameRevisionMatch = liveRevisionText.match(
      /\b(?:my\s+|the\s+|new\s+|correct\s+)?name(?:\s+(?:on|used\s+on)\s+(?:the\s+)?form)?\s*(?:is|was|:|=)\s*([^,;\n?!]+)/i
    )
    const explicitNameRevision = sanitizeBookingIdentityName(
      explicitNameRevisionMatch?.[1] || ''
    )
    const genericRevisionCue = Boolean(
      /\b(?:actually|instead|rather|change|changed|switch|move|update|correct|correction|wrong|not\s+that|make\s+it|use)\b/i.test(liveRevisionText) &&
      /\b(?:name|phone|number|date|day|time|slot|appointment|booking|earlier|later)\b/i.test(liveRevisionText)
    )
    const revisionRequested = Boolean(
      currentFourFieldRevision ||
      explicitPhoneRevision ||
      explicitNameRevision ||
      genericRevisionCue ||
      liveRevisionClockFrame.proposal === true ||
      liveRevisionClockFrame.rejection === true ||
      liveRevisionClockFrame.bounded === true ||
      liveRevisionClockFrame.ambiguous === true ||
      liveRevisionCalendarFrame.proposal === true ||
      liveRevisionCalendarFrame.rejection === true ||
      liveRevisionCalendarFrame.bounded === true ||
      liveRevisionCalendarFrame.ambiguous === true
    )

    if (revisionRequested) {
      const historyBookingState = buildStructuredState(msg, transitionRecentHistory)
      const historyDate = String(historyBookingState.known_requested_date || '').trim()
      const historyTime = String(historyBookingState.known_requested_time || '').trim()
      const liveDateLegal = String(inputState.live_turn_date_status || '') === 'legal'
        ? String(inputState.live_turn_date_phrase || '').trim()
        : ''
      const liveTimeLegal = controllerLiveClockDecision.status === 'legal'
        ? String(controllerLiveClockTime || controllerLiveClockDecision.canonical_label || '').trim()
        : ''

      inputState.form_submitted = true
      inputState.known_name_used_on_form = String(
        currentFourFieldRevision?.name ||
        explicitNameRevision ||
        historyBookingState.known_name_used_on_form ||
        visibleDoubleCheckPayload.name ||
        ''
      ).trim()
      inputState.known_phone_used_on_form = String(
        currentFourFieldRevision?.phone ||
        explicitPhoneRevision ||
        historyBookingState.known_phone_used_on_form ||
        visibleDoubleCheckPayload.phone ||
        ''
      ).trim()
      inputState.known_requested_date = String(
        currentFourFieldRevision?.date_text ||
        liveDateLegal ||
        historyDate ||
        visibleDoubleCheckPayload.date_text ||
        ''
      ).trim()
      inputState.known_requested_time = String(
        currentFourFieldRevision?.time_text ||
        liveTimeLegal ||
        historyTime ||
        visibleDoubleCheckPayload.time_text ||
        ''
      ).trim()

      const mentionsDate = /\b(?:date|day|appointment)\b/i.test(liveRevisionText)
      const mentionsTime = /\b(?:time|slot|earlier|later|a\.?m\.?|p\.?m\.?)\b/i.test(liveRevisionText)
      const mentionsName = /\bname\b/i.test(liveRevisionText)
      const mentionsPhone = /\b(?:phone|number|cell|mobile)\b/i.test(liveRevisionText)
      if (
        liveRevisionCalendarFrame.ambiguous === true ||
        liveRevisionCalendarFrame.rejection === true ||
        liveRevisionCalendarFrame.bounded === true ||
        (genericRevisionCue && mentionsDate && !liveDateLegal && !currentFourFieldRevision)
      ) {
        inputState.known_requested_date = ''
        inputState.known_requested_time = ''
      }
      if (
        liveRevisionClockFrame.ambiguous === true ||
        liveRevisionClockFrame.rejection === true ||
        liveRevisionClockFrame.bounded === true ||
        (genericRevisionCue && mentionsTime && !liveTimeLegal && !currentFourFieldRevision)
      ) inputState.known_requested_time = ''
      if (genericRevisionCue && mentionsName && !explicitNameRevision && !currentFourFieldRevision) {
        inputState.known_name_used_on_form = ''
      }
      if (genericRevisionCue && mentionsPhone && !explicitPhoneRevision && !currentFourFieldRevision) {
        inputState.known_phone_used_on_form = ''
      }

      inputState.live_turn_checkpoint_invalidated = true
      inputState.live_turn_accepts_offered_slot = false
      inputState.live_turn_accepted_offered_date = ''
      inputState.live_turn_accepted_offered_time = ''
      inputState.accepted_offered_date = ''
      inputState.accepted_offered_time = ''
      delete inputState.double_check_sent
      delete inputState.name_phone_date_time_double_check_sent
      const revisionStage = deriveBookingStage(inputState)
      stampStructuredState(inputState, {
        stage: revisionStage,
        nextAction: nextActionForStage(revisionStage)
      })
    }
  }
  // The first controller route must see the same structural discourse floor as
  // dm-authority.  Previously the controller pre-locked DESIGN_INTAKE before the
  // candidate resolver saw an ungrounded "this/that/it" turn.  Even when the
  // candidate later detected missing context, the provisional route contaminated
  // generation.  Context dependency now enters the one-way controller before the
  // first candidate; model classification may refine it only through the bounded
  // adoption gate.
  applyDiscourseClassification(
    inputState,
    null,
    String(msg?.text || msg?.message || ''),
    transitionRecentHistory
  )
  quarantineUnresolvedTurnDurableMutations(inputState, persistedBaseline)
  let controllerCommitFloor = { ...inputState }
  const configuredMaxPasses = Number(opts.max_control_reauthor_passes)
  const maxPasses = Math.max(
    1,
    Math.min(
      MAX_CONTROL_REAUTHOR_PASSES,
      Number.isFinite(configuredMaxPasses) && configuredMaxPasses > 0
        ? configuredMaxPasses
        : DEFAULT_CONTROL_REAUTHOR_PASSES
    )
  )
  const repairCycle = Math.max(0, Number(msg?.control_repair_cycle) || 0)
  const rejectionLedger = controlRepairLedgerFromMessage(msg)
  const rejectedCandidateHashes = new Set(
    rejectionLedger
      .map((entry) => String(entry.candidate_sha256 || ''))
      .filter((hash) => /^[a-f0-9]{64}$/i.test(hash))
  )
  let workingState = inputState
  // 2026-08-27 funnel deadlock (live e2e): the closed-transition route was
  // derived from durable state alone, so a recorded-but-unclaimed Gmail form
  // left name/phone empty at route time (accepted_slot_missing_identity), the
  // deterministic identity checkpoint died at the receipt gate before any model
  // candidate could carry the claim, and the recovery commit may not add new
  // facts — a livelock. Reconcile the Gmail form claim BEFORE route derivation
  // so identity facts exist when the plan is chosen; the enriched fields flow
  // into the durable commit. The claim keeps all its own authority gates
  // (handle match, after-link window, same-thread idempotent re-claim).
  try {
    const { applyGmailFormAutofill } = require(path.join(__dirname, 'dm-authority.js'))
    workingState = applyGmailFormAutofill({ ...msg }, { ...workingState }, transitionRecentHistory)
  } catch {}
  let candidate = null
  let state = null
  let verificationInput = null
  let verdict = null
  let structuredVerdict = null
  let transitionPlan = deriveClosedTransitionPlan({
    ...msg,
    message: String(msg?.text || msg?.message || ''),
    structured_state: workingState,
    recent_history: transitionRecentHistory
  })
  // v150 (live 2026-09-04 05:18Z): on a design turn where the client volunteered a
  // placement or a size, the model kept drafting a size/placement question, the
  // deterministic stripper removed it, and the non-authoring guard forced another
  // re-author — three passes, 44 s, and the turn still ended in the deterministic
  // recovery line. That recovery text is already correct and verifier-clean for this
  // exact route, so one honest model attempt is worth the latency and a second is not.
  const volunteeredDimensionOfferForm = (
    String(transitionPlan?.action || '') === CLOSED_TRANSITION_ACTIONS.OFFER_FORM &&
    Array.isArray(transitionPlan?.obligations) &&
    transitionPlan.obligations.includes('acknowledge_and_defer_placement_size')
  )
  // v153 (live 2026-09-05 21:56Z): on the design / general / tattoo-continue routes the
  // model drafted a size or placement question three times in a row (each one
  // stripped, each re-author 10 s) before the deterministic recovery line went out.
  // The route lock already forbids that question; a second identical attempt has no
  // information the first one lacked, so these routes get one re-author, not two.
  // general_continue keeps its full budget except on the non-tattoo media host lead
  // (the live route); a price question on general_continue still gets every pass.
  const sizeQuestionProneRoute = (
    [CLOSED_TRANSITION_ACTIONS.DESIGN_INTAKE, CLOSED_TRANSITION_ACTIONS.TATTOO_CONTINUE]
      .includes(String(transitionPlan?.action || '')) ||
    (
      String(transitionPlan?.action || '') === CLOSED_TRANSITION_ACTIONS.GENERAL_CONTINUE &&
      String(transitionPlan?.reason || '') === 'non_tattoo_media_requires_contextual_host_lead'
    )
  )
  const passBudget = volunteeredDimensionOfferForm
    ? Math.min(maxPasses, 1)
    : sizeQuestionProneRoute
      ? Math.min(maxPasses, 2)
      : maxPasses

  let transitionVerdict = null
  let lastReason = 'candidate_not_generated'
  let acceptedPass = 0
  let routeLocked = false
  let livenessAdopted = false
  let livenessStrictReason = ''
  let livenessSoftReason = ''
  let livenessBoundaryVersion = ''
  let routeRebase = null
  let routeAwareRecoveryOriginalPlan = null
  const attemptedCandidates = []

  for (let pass = 0; pass < passBudget; pass += 1) {
    stampStructuredState(workingState, {
      stage: deriveBookingStage(workingState),
      nextAction: transitionPlan.action
    })
    assertStructuredState(workingState)
    const authorityOptions = {
      ...baseAuthorityOptions,
      structured_state_override: workingState,
      control_transition_contract: transitionPlan,
      control_repair_cycle: repairCycle,
      control_reauthor_pass: pass + 1,
      control_verifier_rejection_ledger: rejectionLedger.slice(-CONTROL_REPAIR_LEDGER_LIMIT)
    }
    if (rejectionLedger.length > 0) {
      authorityOptions.control_transition_repair = buildCumulativeControlRepairLock(
        transitionPlan,
        rejectionLedger
      )
    }

    try {
      candidate = candidateGenerator(msg, authorityOptions)
    } catch (err) {
      const candidateError = String(err?.message || err)
      // Provider transport/outage failures are not semantic candidate failures.
      // Burning the controller's reauthor budget here multiplied one 503 into
      // three immediate full runner calls, then mislabeled the outage as verifier
      // rejection. Preserve semantic retries for actual candidate defects and
      // return one typed retry signal to the inbox lifecycle instead.
      if (
        /openai_upstream_transient_exhausted|single_control_upstream_retryable/i.test(candidateError)
      ) {
        const typedError = `single_control_upstream_retryable:${candidateError.slice(0, 1200)}`
        recordControlLifecycleEvent(root, msg, {
          type: 'control_upstream_provider_retry_required',
          pass: pass + 1,
          reason: typedError,
          required_action: transitionPlan.action
        })
        throw new Error(typedError)
      }
      const verifierFeedback = parseCandidateVerifierFailure(candidateError)
      if (verifierFeedback) {
        appendControlRepairEntry(rejectionLedger, {
          pass: pass + 1,
          cycle: repairCycle,
          phase: verifierFeedback.phase,
          reason: verifierFeedback.reason,
          instruction: verifierFeedback.instruction,
          route_action: transitionPlan.action
        })
        lastReason = `${verifierFeedback.phase}:${verifierFeedback.reason}`
        recordControlLifecycleEvent(root, msg, {
          type: 'control_verifier_rejection_returned_for_reauthor',
          pass: pass + 1,
          cycle: repairCycle,
          verifier_phase: verifierFeedback.phase,
          verifier_reason: verifierFeedback.reason,
          required_action: transitionPlan.action,
          repair_ledger_count: rejectionLedger.length,
          repair_loop_version: CONTROL_REPAIR_LOOP_VERSION
        })
      }
      const proposedRebase = routeRebase
        ? null
        : deriveVerifierRebasePlan({
            ...msg,
            message: String(msg?.text || msg?.message || ''),
            structured_state: workingState,
            recent_history: transitionRecentHistory
          }, transitionPlan, verifierFeedback)
      if (proposedRebase) {
        routeRebase = proposedRebase
        transitionPlan = proposedRebase
        lastReason = `verifier_route_rebased:${proposedRebase.reason}`
        recordControlLifecycleEvent(root, msg, {
          type: 'control_route_rebased_after_verifier_rejection',
          pass: pass + 1,
          verifier_reason: String(verifierFeedback?.reason || ''),
          previous_action: String(proposedRebase?.rebase?.previous_action || ''),
          previous_reason: String(proposedRebase?.rebase?.previous_reason || ''),
          required_action: proposedRebase.action,
          route_reason: proposedRebase.reason,
          closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
        })
        candidate = null
        // Live 2026-07-27: a rebase that lands on the final pass left zero
        // budget to actually generate under the corrected route, so the turn
        // still ended as a retryable rejection. A rebase is not a candidate
        // attempt — return its pass to the budget. Single-rebase law above
        // (routeRebase guard) keeps this bounded to one refund.
        pass -= 1
        continue
      }
      if (verifierFeedback) {
        candidate = null
        continue
      }
      lastReason = `single_control_candidate_generation_error:${candidateError.slice(0, 240)}`
      appendControlRepairEntry(rejectionLedger, {
        pass: pass + 1,
        cycle: repairCycle,
        phase: 'candidate_generation',
        reason: 'candidate_generation_error',
        instruction: 'Generate a fresh packet under the locked route and output contract. Do not repeat malformed, empty, or non-packet output.',
        route_action: transitionPlan.action
      })
      recordControlLifecycleEvent(root, msg, {
        type: 'control_candidate_generation_failed',
        pass: pass + 1,
        reason: lastReason,
        required_action: transitionPlan.action
      })
      candidate = null
      continue
    }
    if (!candidate || candidate.source !== 'codex_exec_dm_authority' || !Array.isArray(candidate.packet?.bubbles)) {
      lastReason = 'single_control_candidate_invalid'
      appendControlRepairEntry(rejectionLedger, {
        pass: pass + 1,
        cycle: repairCycle,
        phase: 'candidate_shape',
        reason: lastReason,
        instruction: 'Return one valid authority packet with a bubbles array and at least one route-appropriate visible reply.',
        route_action: transitionPlan.action
      })
      recordControlLifecycleEvent(root, msg, {
        type: 'control_candidate_rejected',
        pass: pass + 1,
        reason: lastReason
      })
      continue
    }

    const authenticatedEnrichedTurn = sourceAuthenticatedEnrichedInboundTurn(root, msg)
    const verificationLiveTurn = authenticatedEnrichedTurn
      ? authenticatedEnrichedTurn.text
      : String(msg?.text || msg?.message || '')
    // Candidate output may omit history, but omission is not authority to erase
    // the controller's already-observed dialogue pair.  An empty candidate
    // history previously deleted the immediately preceding availability
    // question at the final verifier and relabeled a calendar day as tattoo
    // size. Preserve the controller source unless the authority resolver returns
    // an actual non-empty history.
    const observedHistory = Array.isArray(candidate.recent_history) && candidate.recent_history.length > 0
      ? candidate.recent_history
      : transitionRecentHistory
    const observedEvent = {
      ...msg,
      text: verificationLiveTurn,
      message: verificationLiveTurn
    }
    const observedState = reduceConversationState({
      root,
      persisted: controllerCommitFloor,
      candidate: candidate.structured_state,
      event: observedEvent,
      intentEvidence: candidate.intent_adoption_state
    })
    const classifierEvidence = candidate.intent_adoption_state?.context_classifier_applied === true
      ? {
          context_relation: String(candidate.intent_adoption_state.live_turn_context_relation || ''),
          context_confidence: String(candidate.intent_adoption_state.live_turn_context_confidence || ''),
          context_reason_code: String(candidate.intent_adoption_state.live_turn_context_reason_code || ''),
          context_antecedent_quote: String(candidate.intent_adoption_state.live_turn_context_antecedent_quote || '')
        }
      : null

    // Source-boundary repair: the authority resolver may replace a transport
    // placeholder (for example "sent a reference post") with an actual voice
    // transcript or vision description.  State reduction used to happen before
    // that resolved live turn was selected, so the route and verifier could see
    // different objects.  Re-derive discourse here, inside the outer one-way
    // controller, from the exact atomic turn the final verifier will inspect.
    // Candidate flags may refine the bounded route, but their absence can no
    // longer erase the structural missing-referent floor.
    Object.assign(
      observedState,
      annotateStructuredStateForLiveTurn(observedEvent, observedState, observedHistory)
    )
    enforceControllerIdentityAuthority(
      observedState,
      verificationLiveTurn,
      controllerCommitFloor
    )
    preserveSameEventCheckpointInvalidation(
      observedState,
      observedEvent,
      controllerCommitFloor
    )
    if (
      authenticatedEnrichedTurn &&
      !/^sent a voice note\b/i.test(verificationLiveTurn) &&
      /^sent a (?:reference post|photo|media)\b/i.test(String(msg?.text || msg?.message || ''))
    ) {
      const mediaCategory = classifyReferenceMediaDescription(verificationLiveTurn)
      observedState.live_turn_is_media_reference = true
      observedState.live_turn_media_category = mediaCategory
      observedState.live_turn_media_tattoo_reference = mediaCategory === 'tattoo_reference'
      if (mediaCategory === 'tattoo_reference') {
        observedState.known_reference_media_received = true
        observedState.known_tattoo_reference_media_received = true
        observedState.tattoo_intent_active = true
        if (liveHasConcreteDesignDirection({
          message: verificationLiveTurn,
          recent_history: [],
          structured_state: {
            live_turn_text: verificationLiveTurn,
            live_turn_media_category: mediaCategory,
            live_turn_media_tattoo_reference: true
          }
        })) {
          observedState.live_turn_gave_design_idea = true
          observedState.known_design_context = verificationLiveTurn
        }
      }
    }
    applyDiscourseClassification(
      observedState,
      classifierEvidence,
      verificationLiveTurn,
      observedHistory
    )
    quarantineUnresolvedTurnDurableMutations(observedState, persistedBaseline)
    promoteControllerObservedContextFloor(controllerCommitFloor, observedState)
    observedState.live_turn_text = verificationLiveTurn
    const safeClarificationRecovery = candidateIsSafeClarificationRecovery(candidate) &&
      (
        forcedSafeClarificationRecovery ||
        (
          transitionPlan.action === CLOSED_TRANSITION_ACTIONS.RESOLVE_CONTEXT &&
          transitionPlan.reason === 'unintelligible'
        )
      )
    if (safeClarificationRecovery) {
      observedState.live_turn_context_missing = true
      observedState.live_turn_context_missing_attachment = false
      observedState.live_turn_context_needs_clarification = true
      observedState.live_turn_context_resolved_from_history = false
      observedState.live_turn_self_contained_topic_shift = false
      observedState.live_turn_reference_pointer_without_media = false
      observedState.live_turn_context_relation = 'unintelligible'
      observedState.live_turn_context_confidence = 'high'
      observedState.live_turn_context_resolution_source = 'bounded_model_adoption_exhaustion'
      quarantineUnresolvedTurnDurableMutations(observedState, persistedBaseline)
    }
    const observedVerificationInput = {
      contact_id: String(msg?.contact_id || ''),
      thread_id: String(msg?.thread_id || msg?.contact_id || ''),
      instagram_username: String(msg?.instagram_username || ''),
      message: verificationLiveTurn,
      received_at: String(msg?.received_at || ''),
      recent_history: observedHistory,
      structured_state: observedState
    }
    const routeAwareVisibleRecovery = Boolean(
      forcedRouteAwareVisibleRecovery &&
      candidateIsRouteAwareVisibleRecovery(
        candidate,
        observedVerificationInput,
        transitionPlan
      )
    )

    // One-way route adoption: evidence from the first authority-resolved candidate
    // locks the turn. A rejected candidate may not mutate state or promote the
    // next repair pass into another funnel stage. The sole bounded exception is a
    // typed verifier-feedback rebase derived above: it changes only the semantic
    // action, preserves the pre-rejection state floor, and must pass both verifiers
    // again before adoption. This blocks stale-state promotion without converting
    // a valid verifier rejection into repeated same-route silence.
    if (safeClarificationRecovery) {
      const previousPlan = transitionPlan
      state = observedState
      workingState = observedState
      verificationInput = observedVerificationInput
      transitionPlan = safeClarificationRecoveryPlan(observedState, previousPlan)
      verificationInput.control_transition_contract = transitionPlan
      routeLocked = true
      recordControlLifecycleEvent(root, msg, {
        type: 'control_safe_clarification_recovery_adopted_for_verification',
        pass: pass + 1,
        previous_action: String(previousPlan?.action || ''),
        previous_reason: String(previousPlan?.reason || ''),
        required_action: transitionPlan.action,
        route_reason: transitionPlan.reason,
        closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
      })
    } else if (routeAwareVisibleRecovery) {
      const previousPlan = transitionPlan
      routeAwareRecoveryOriginalPlan = previousPlan
      state = observedState
      workingState = observedState
      verificationInput = observedVerificationInput
      transitionPlan = routeAwareVisibleRecoveryPlan(observedState, previousPlan)
      verificationInput.control_transition_contract = transitionPlan
      routeLocked = true
      recordControlLifecycleEvent(root, msg, {
        type: 'control_route_aware_visible_recovery_adopted_for_verification',
        pass: pass + 1,
        previous_action: String(previousPlan?.action || ''),
        previous_reason: String(previousPlan?.reason || ''),
        required_action: transitionPlan.action,
        route_reason: transitionPlan.reason,
        recovery_version: ROUTE_AWARE_VISIBLE_RECOVERY_VERSION,
        closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
      })
    } else if (!routeLocked) {
      state = observedState
      workingState = observedState
      verificationInput = observedVerificationInput
      if (!routeRebase) transitionPlan = deriveClosedTransitionPlan(verificationInput)
      verificationInput.control_transition_contract = transitionPlan
      routeLocked = true
      recordControlLifecycleEvent(root, msg, {
        type: 'control_turn_route_locked',
        pass: pass + 1,
        required_action: transitionPlan.action,
        route_reason: transitionPlan.reason,
        closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
      })
    } else {
      state = workingState
      verificationInput = {
        ...verificationInput,
        structured_state: workingState,
        control_transition_contract: transitionPlan
      }
    }

    // Legacy in-process harness candidates predate structured packet metadata.
    // Decorate only a completely metadata-absent injected test candidate; never
    // repair a partially present or malformed claim, and never decorate the live
    // dm-authority path. This keeps the production boundary independently strict
    // while old semantic fixtures remain usable. Adversarial seam tests provide
    // their forged fields and must therefore fail this validator unchanged.
    if (
      injectedCandidateGenerator &&
      candidate.packet?.reply_text === undefined &&
      candidate.packet?.acknowledged_fields === undefined &&
      candidate.packet?.questioned_fields === undefined &&
      candidate.packet?.next_action_reflected === undefined
    ) {
      candidate.packet = decorateDeterministicPacket(
        verificationInput,
        candidate.packet,
        { plan: transitionPlan, nextAction: transitionPlan.action }
      )
    }
    bindLiveControllerPacketMetadata(
      candidate,
      transitionPlan,
      Boolean(injectedCandidateGenerator)
    )
    structuredVerdict = validateStructuredOutputContract(
      verificationInput,
      candidate.packet,
      transitionPlan
    )
    verdict = safeClarificationRecovery
      ? safeClarificationRecoveryVerdict(candidate)
      : routeAwareVisibleRecovery
        ? routeAwareVisibleRecoveryVerdict(
            candidate,
            observedVerificationInput,
            routeAwareRecoveryOriginalPlan
          )
        : evaluateScvContractHarness(verificationInput, candidate.packet)
    transitionVerdict = routeAwareVisibleRecovery
      ? {
          valid: true,
          reason: 'route_aware_nontransactional_visible_recovery_transition_valid',
          instruction: '',
          lock_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
        }
      : evaluateClosedTransitionContract(verificationInput, candidate.packet, transitionPlan)
    const candidateSha256 = candidatePacketSha256(candidate)
    const repeatedRejectedCandidate = rejectedCandidateHashes.has(candidateSha256)
    attemptedCandidates.push({
      pass: pass + 1,
      candidate,
      state,
      verificationInput,
      verdict,
      structuredVerdict,
      transitionVerdict,
      transitionPlan,
      candidate_sha256: candidateSha256
    })
    const repeatVerdict = (routeAwareVisibleRecovery || safeClarificationRecovery)
      ? { valid: true, reason: '', instruction: '' }
      : repeatedVisibleLineVerdict(candidate.packet, observedHistory, transitionPlan)
    if (structuredVerdict.valid && verdict.valid && transitionVerdict.valid && repeatVerdict.valid) {
      acceptedPass = pass + 1
      break
    }

    const failedVerdicts = []
    if (!structuredVerdict.valid) failedVerdicts.push({ phase: 'structured_output', verdict: structuredVerdict })
    if (!verdict.valid) failedVerdicts.push({ phase: 'semantic', verdict })
    if (!transitionVerdict.valid) failedVerdicts.push({ phase: 'transition', verdict: transitionVerdict })
    if (!repeatVerdict.valid) failedVerdicts.push({ phase: 'semantic', verdict: repeatVerdict })
    for (const failure of failedVerdicts) {
      appendControlRepairEntry(rejectionLedger, {
        pass: pass + 1,
        cycle: repairCycle,
        phase: failure.phase,
        reason: failure.verdict.reason,
        instruction: failure.verdict.instruction,
        route_action: transitionPlan.action,
        candidate_sha256: candidateSha256,
        repeated_candidate: repeatedRejectedCandidate
      })
    }
    rejectedCandidateHashes.add(candidateSha256)
    const primaryFailure = failedVerdicts[0]
    lastReason = `${primaryFailure.phase}:${primaryFailure.verdict.reason}`
    recordControlLifecycleEvent(root, msg, {
      type: 'control_candidate_rejected',
      pass: pass + 1,
      reason: lastReason,
      semantic_reason: String(!verdict.valid ? verdict.reason : ''),
      transition_reason: String(!transitionVerdict.valid ? transitionVerdict.reason : ''),
      candidate_sha256: candidateSha256,
      repeated_rejected_candidate: repeatedRejectedCandidate,
      repair_ledger_count: rejectionLedger.length,
      required_action: transitionPlan.action,
      repair_loop_version: CONTROL_REPAIR_LOOP_VERSION,
      closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
    })
    if (!routeRebase) {
      const proposedRebase = deriveVerifierRebasePlan(
        { ...verificationInput, control_transition_contract: transitionPlan },
        transitionPlan,
        !verdict.valid ? verdict : transitionVerdict
      )
      if (proposedRebase) {
        routeRebase = proposedRebase
        transitionPlan = proposedRebase
        verificationInput.control_transition_contract = proposedRebase
        recordControlLifecycleEvent(root, msg, {
          type: 'control_route_rebased_after_verifier_rejection',
          pass: pass + 1,
          verifier_reason: String((!verdict.valid ? verdict : transitionVerdict)?.reason || ''),
          previous_action: String(proposedRebase?.rebase?.previous_action || ''),
          previous_reason: String(proposedRebase?.rebase?.previous_reason || ''),
          required_action: proposedRebase.action,
          route_reason: proposedRebase.reason,
          closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
        })
        // Live 2026-07-27: a rebase is not a candidate attempt — return its
        // pass to the budget so the corrected route gets a real generation.
        // The single-rebase law (routeRebase guard) bounds this to one refund.
        pass -= 1
      }
    }
    candidate = null
  }

  if (!candidate || !state || !structuredVerdict?.valid || !verdict?.valid || !transitionVerdict?.valid) {
    // Adoption-not-generation liveness: if the model already produced a packet that
    // passed the full semantic harness, the strict transition detector may not turn
    // a harmless wording miss into permanent outbox=0. The route-specific liveness
    // floor is deliberately unavailable to form/double-check/deposit authority.
    for (let index = attemptedCandidates.length - 1; index >= 0; index -= 1) {
      const attempt = attemptedCandidates[index]
      if (!attempt.structuredVerdict?.valid) continue
      let livenessVerdict = null
      let softBoundaryVerdict = null
      if (attempt.verdict?.valid) {
        livenessVerdict = evaluateClosedTransitionLivenessFloor(
          attempt.verificationInput,
          attempt.candidate.packet,
          attempt.transitionPlan
        )
        if (!livenessVerdict.valid || livenessVerdict.liveness_floor !== true) continue
      } else {
        softBoundaryVerdict = independentCandidateLivenessVerdict(
          attempt.verificationInput,
          attempt.candidate,
          attempt.verdict
        )
        if (!softBoundaryVerdict.valid) continue
        livenessVerdict = softBoundaryVerdict.transition_verdict
      }
      candidate = attempt.candidate
      state = attempt.state
      verificationInput = attempt.verificationInput
      structuredVerdict = attempt.structuredVerdict
      verdict = softBoundaryVerdict
        ? {
            valid: true,
            reason: softBoundaryVerdict.reason,
            instruction: '',
            lock_version: softBoundaryVerdict.boundary_version,
            soft_reason: softBoundaryVerdict.soft_reason
          }
        : attempt.verdict
      transitionPlan = attempt.transitionPlan
      transitionVerdict = livenessVerdict
      acceptedPass = attempt.pass
      livenessAdopted = true
      livenessStrictReason = String(livenessVerdict.strict_reason || lastReason)
      livenessSoftReason = String(softBoundaryVerdict?.soft_reason || '')
      livenessBoundaryVersion = String(softBoundaryVerdict?.boundary_version || '')
      recordControlLifecycleEvent(root, msg, {
        type: softBoundaryVerdict
          ? 'control_candidate_soft_quality_liveness_adopted'
          : 'control_candidate_liveness_adopted',
        pass: acceptedPass,
        reason: livenessSoftReason || livenessStrictReason,
        transition_strict_reason: livenessStrictReason,
        required_action: transitionPlan.action,
        liveness_boundary_version: livenessBoundaryVersion,
        closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
      })
      break
    }
    if (!candidate || !state || !structuredVerdict?.valid || !verdict?.valid || !transitionVerdict?.valid) {
      throw buildControlVerifierRetryError(
        msg,
        lastReason,
        transitionPlan,
        rejectionLedger
      )
    }
  }

  // Rebase every durable field onto the controller-owned pre-candidate state.
  // Candidate packets and intent receipts may help the closed verifier choose a
  // route, but they cannot smuggle funnel latches or identity/calendar strings
  // into the committed state.  Only the verified action below can advance its
  // own fields.
  restoreAllDurableStateFromControllerFloor(
    state,
    controllerCommitFloor
  )

  if (transitionPlan.action === CLOSED_TRANSITION_ACTIONS.OFFER_FORM) state.form_offer_asked = true
  if (transitionPlan.action === CLOSED_TRANSITION_ACTIONS.SEND_FORM) {
    state.form_offer_asked = true
    state.form_link_sent = true
  }
  if ([
    CLOSED_TRANSITION_ACTIONS.POST_FORM_AVAILABILITY,
    CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME,
    CLOSED_TRANSITION_ACTIONS.POST_FORM_IDENTITY,
    CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK
  ].includes(transitionPlan.action) && transitionPlan.live_intent?.form_submitted) {
    state.form_submitted = true
  }
  if (transitionPlan.live_intent?.accepts_offered_slot === true) {
    const acceptedDate = String(
      transitionPlan.fields?.date || transitionPlan.fields?.last_offered_date || ''
    ).trim()
    const acceptedTime = String(
      transitionPlan.fields?.time || transitionPlan.fields?.last_offered_time || ''
    ).trim()
    if (acceptedDate && acceptedTime) {
      state.accepted_offered_date = acceptedDate
      state.accepted_offered_time = acceptedTime
      state.known_requested_date = acceptedDate
      state.known_requested_time = acceptedTime
    }
  }
  if (transitionPlan.action === CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK) {
    for (const [field, value] of [
      ['known_name_used_on_form', transitionPlan.fields?.name],
      ['known_phone_used_on_form', transitionPlan.fields?.phone],
      ['known_requested_date', transitionPlan.fields?.date],
      ['known_requested_time', transitionPlan.fields?.time]
    ]) {
      const normalized = String(value || '').trim()
      if (normalized) state[field] = normalized
    }
    state.double_check_sent = true
    state.name_phone_date_time_double_check_sent = true
  }
  if (transitionPlan.action === CLOSED_TRANSITION_ACTIONS.DEPOSIT_HANDOFF) state.deposit_requested = true
  const conversation = candidate?.authority?.openai_conversation
  const responsesRequired = String(process.env.SCV_OPENAI_RESPONSES_REQUIRED || '0').trim() === '1'
  if (conversation && typeof conversation === 'object') {
    const acceptedPreviousResponseId = String(state?.openai_previous_response_id || '').trim()
    const receiptPreviousResponseId = String(conversation.previous_response_id || '').trim()
    const reseededFromResponseId = String(conversation.reseeded_from_response_id || '').trim()
    const chainBindingValid = acceptedPreviousResponseId
      ? (
          (receiptPreviousResponseId === acceptedPreviousResponseId && conversation.native_history_seeded === false && !reseededFromResponseId) ||
          (!receiptPreviousResponseId && conversation.native_history_seeded === true && reseededFromResponseId === acceptedPreviousResponseId)
        )
      : (!receiptPreviousResponseId && conversation.native_history_seeded === true && !reseededFromResponseId)
    if (
      conversation.version !== SCV_OPENAI_CONVERSATION_VERSION ||
      conversation.api !== 'responses_v1' ||
      !(
        (conversation.provider_response_id_present === true && validResponseId(conversation.response_id)) ||
        (conversation.provider_response_id_present === false && !String(conversation.response_id || '').trim())
      ) ||
      (conversation.provider_response_id_present === true && conversation.response_id === receiptPreviousResponseId) ||
      !chainBindingValid ||
      conversation.stored !== true ||
      conversation.authoritative_visible_ledger_reconciled !== true ||
      ![
        'provider_chain_with_visible_delivery_delta',
        'full_visible_ledger_reseed'
      ].includes(String(conversation.conversation_context_mode || '')) ||
      conversation.rcc_revas_pre_inference_convergence_field !== true ||
      conversation.convergence_baseline !== SCV_RESPONSES_CONVERGENCE_BASELINE ||
      !String(conversation.model || '').trim()
    ) {
      throw new Error('single_control_openai_conversation_receipt_invalid')
    }
    const pinnedModel = String(process.env.OPENAI_DM_MODEL || '').trim()
    // The provider resolves alias ids to dated snapshots (gpt-5-nano ->
    // gpt-5-nano-2025-08-07), so the receipt carries the snapshot id. Accept
    // the pin or its dated snapshot; any other model id still fails closed.
    const { modelIdentityMatches } = require(path.join(__dirname, 'codex-dm-runner.js'))
    if (pinnedModel && !modelIdentityMatches(pinnedModel, String(conversation.model))) {
      throw new Error('single_control_openai_conversation_model_mismatch')
    }
    state.openai_previous_response_id = conversation.provider_response_id_present === true
      ? String(conversation.response_id)
      : ''
    state.openai_conversation_model = String(conversation.model)
    state.openai_conversation_api_version = String(conversation.version)
    state.openai_conversation_last_message_id = String(msg?.message_id || '')
  } else if (responsesRequired) {
    const checkpointExecutor = String(candidate?.authority?.executor || '')
    const explicitVerbatimCheckpoint =
      checkpointExecutor === 'deterministic_fixed_booking_checkpoint' &&
      [
        CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK,
        CLOSED_TRANSITION_ACTIONS.DEPOSIT_HANDOFF,
        // 2026-08-27 live e2e deadlock: the deterministic booking lane also
        // authors the post-form identity/time asks and the slot-progress
        // checkpoint with model: 'none' by construction. Requiring an OpenAI
        // conversation receipt from those packets fail-closed the whole turn in
        // 24ms per cycle and silenced the funnel at the deposit doorstep.
        CLOSED_TRANSITION_ACTIONS.POST_FORM_IDENTITY,
        CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME,
        CLOSED_TRANSITION_ACTIONS.POST_FORM_AVAILABILITY,
        CLOSED_TRANSITION_ACTIONS.ACCEPTED_SLOT_PROGRESS
      ].includes(transitionPlan.action)
    const explicitSendFormCheckpoint = candidateIsSendFormCheckpointRecovery(candidate) &&
      transitionPlan.action === CLOSED_TRANSITION_ACTIONS.SEND_FORM &&
      [
        'explicit_form_request_or_open_offer_consent',
        'accepted_slot_requires_form_link'
      ].includes(String(transitionPlan.reason || ''))
    const explicitSafeClarificationRecovery = candidateIsSafeClarificationRecovery(candidate) &&
      transitionPlan.action === CLOSED_TRANSITION_ACTIONS.RESOLVE_CONTEXT &&
      transitionPlan.reason === 'unintelligible'
    const explicitRouteAwareVisibleRecovery = candidateIsRouteAwareVisibleRecovery(
      candidate,
      verificationInput,
      routeAwareRecoveryOriginalPlan
    ) &&
      transitionPlan.action === CLOSED_TRANSITION_ACTIONS.RESOLVE_CONTEXT &&
      transitionPlan.reason === 'verifier_exhausted_route_recovery'
    // 2026-09-02 generic info fast path: a self-contained information request
    // is answered by a bounded deterministic packet with model: 'none' before
    // any model call, so it carries no OpenAI conversation receipt by
    // construction. It is admitted only under the non-transactional routes the
    // runner itself allows for that packet.
    // v143: the same admission rule the runner uses — the non-transactional
    // routes, or the await stage under the checkpoint side-question reason.
    const explicitGenericInfoFastPath = candidateIsGenericInfoFastPath(candidate) &&
      genericInfoFastPathAdmitsPlan(transitionPlan)
    // 2026-09-02 checkpoint revision asks: an unresolved revision of the open
    // four-field checkpoint is answered by a bounded deterministic question with
    // model: 'none' before any model call. It is admitted only under the four
    // revision reasons the contract itself derives.
    const explicitDoubleCheckRevisionAsk =
      checkpointExecutor === 'deterministic_double_check_revision_ask' &&
      isDoubleCheckRevisionReason(String(transitionPlan.reason || '')) &&
      [
        CLOSED_TRANSITION_ACTIONS.POST_FORM_TIME,
        CLOSED_TRANSITION_ACTIONS.POST_FORM_AVAILABILITY,
        CLOSED_TRANSITION_ACTIONS.POST_FORM_IDENTITY,
        CLOSED_TRANSITION_ACTIONS.AWAIT_DOUBLE_CHECK_CONFIRMATION
      ].includes(transitionPlan.action)
    if (
      !explicitVerbatimCheckpoint &&
      !explicitSendFormCheckpoint &&
      !explicitSafeClarificationRecovery &&
      !explicitRouteAwareVisibleRecovery &&
      !explicitGenericInfoFastPath &&
      !explicitDoubleCheckRevisionAsk
    ) {
      throw new Error('single_control_openai_conversation_receipt_required')
    }
  }
  // Final adoption gate: a route locked to context resolution may preserve only
  // durable facts that existed before this turn. This protects the commit path
  // even if a future reducer or repair pass tries to reintroduce candidate state.
  if (
    transitionPlan.action === CLOSED_TRANSITION_ACTIONS.RESOLVE_CONTEXT &&
    ![
      'verifier_conflict_booking_day_or_size',
      'verifier_exhausted_route_recovery'
    ].includes(transitionPlan.reason)
  ) {
    state.live_turn_context_missing = true
    quarantineUnresolvedTurnDurableMutations(state, persistedBaseline)
  }
  // Latch only after every admission check. verificationInput can share this
  // state object: latching before the Responses/recovery receipt gate changes
  // its expected first-price packet into a repeat-price packet during validation.
  if (packetStatesModelRate(candidate?.packet)) state.known_model_rate_disclosed = true
  const adoptedStage = deriveBookingStage(state)
  stampStructuredState(state, {
    stage: adoptedStage,
    nextAction: nextActionForStage(adoptedStage)
  })
  assertStructuredState(state)

  const authority = {
      controller: SCV_SINGLE_CONTROL_PLANE_ID,
      runner: 'scv-single-control-plane',
      control_epoch: SCV_CONTROL_EPOCH,
      candidate_source: candidate.source,
      candidate_authority: candidate.authority || {},
      recent_history: Array.isArray(candidate.recent_history) ? candidate.recent_history : [],
      final_verifier_lock_version: verdict.lock_version || '',
      final_verifier_reason: verdict.reason || 'valid',
      closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
      closed_transition_action: transitionPlan.action,
      closed_transition_reason: transitionPlan.reason,
      closed_transition_obligations: transitionPlan.obligations,
      closed_transition_verifier_reason: transitionVerdict.reason,
      control_candidate_passes: acceptedPass,
      control_reauthor_budget: passBudget,
      control_verifier_rejection_count: rejectionLedger.length,
      control_verifier_rejection_reasons: rejectionLedger.map((entry) => `${entry.phase}:${entry.reason}`),
      control_repair_cycle: repairCycle,
      control_repair_loop_version: CONTROL_REPAIR_LOOP_VERSION,
      control_route_frozen: routeLocked,
      control_route_rebased: !!routeRebase,
      control_route_rebase_reason: String(routeRebase?.reason || ''),
      control_route_rebase_verifier_reason: String(routeRebase?.rebase?.verifier_reason || ''),
      control_liveness_adopted: livenessAdopted,
      control_liveness_strict_reason: livenessStrictReason,
      control_liveness_soft_reason: livenessSoftReason,
      control_liveness_boundary_version: livenessBoundaryVersion,
      control_route_aware_visible_recovery: transitionPlan.reason === 'verifier_exhausted_route_recovery',
      control_route_aware_visible_recovery_version: transitionPlan.reason === 'verifier_exhausted_route_recovery'
        ? ROUTE_AWARE_VISIBLE_RECOVERY_VERSION
        : '',
      control_recovery_original_action: String(transitionPlan?.recovery?.previous_action || ''),
      control_recovery_original_reason: String(transitionPlan?.recovery?.previous_reason || '')
  }
  // Live 2026-09-03 03:01Z (Omar.system): the deterministic fixed checkpoint
  // shipped the four-field block while the plan still said post_form_identity
  // (the route had locked before the form match landed), so double_check_sent
  // and the form identity never reached durable state and the stage hint stayed
  // "awaiting_form_identity_match" under a visible open checkpoint. The executed
  // visible text is the truth: when the adopted packet IS the four-field block,
  // record the checkpoint as sent and persist the identity it displayed.
  // v147 (live 2026-09-03 16:40Z): the same drift with a MODEL-authored block.
  // The deterministic checkpoint was rejected on pass 1, the model authored the
  // identical four-field block on pass 2 under post_form_identity, and because
  // only the deterministic executor was recorded here, the identity and the
  // open checkpoint never reached durable state; the next three turns routed as
  // "identity missing" through the model and the recovery line. The executed
  // visible block is the truth whichever executor produced it.
  if (
    transitionPlan.action !== CLOSED_TRANSITION_ACTIONS.DOUBLE_CHECK &&
    packetHasNamePhoneDateTimeDoubleCheck(candidate?.packet || {})
  ) {
    const block = (Array.isArray(candidate?.packet?.bubbles) ? candidate.packet.bubbles : [])
      .map((bubble) => String(bubble?.text || '')).join('\n')
    const shown = (label) => {
      const match = block.match(new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i'))
      return match ? String(match[1] || '').trim() : ''
    }
    for (const [field, value] of [
      ['known_name_used_on_form', shown('Name')],
      ['known_phone_used_on_form', shown('Phone Number')],
      ['known_requested_date', shown('Appointment date')],
      ['known_requested_time', shown('Time')]
    ]) {
      if (value && !String(state[field] || '').trim()) state[field] = value
    }
    state.double_check_sent = true
    state.name_phone_date_time_double_check_sent = true
    delete state.checkpoint_superseded_by_revision
    recordControlLifecycleEvent(root, msg, {
      type: 'control_visible_checkpoint_recorded_from_executed_packet',
      required_action: transitionPlan.action,
      route_reason: String(transitionPlan.reason || ''),
      closed_transition_contract_version: SCV_CLOSED_TRANSITION_CONTRACT_VERSION
    })
  }
  const committed = commitControlDecision(root, msg, state, {
    authority,
    raw_text: candidate.raw_text,
    packet: candidate.packet
  })
  const result = {
    ...committed.decision,
    structured_state: committed.state,
    control_state_file: committed.state_file,
    control_event_file: committed.control_event_file,
    replayed_control_decision: committed.replayed === true
  }
  assertSingleControlEnvelope(result, { root, requireLedger: true })
  return result
}

function migrateAllThreadStates(root) {
  const resolved = ensureControlDirs(root)
  const dir = path.join(resolved, 'thread-state')
  const backupDir = path.join(resolved, 'thread-state_pre_migration')
  fs.mkdirSync(backupDir, { recursive: true })
  const migrated = []
  let backedUp = 0
  for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.json'))) {
    const threadId = name.replace(/\.json$/, '')
    withThreadControlLock(resolved, threadId, () => {
      const file = path.join(dir, name)
      const prior = safeReadJson(file, {})
      const next = migrateStateObject(prior, threadId)
      if (prior.control_epoch !== SCV_CONTROL_EPOCH || prior.control_plane_id !== SCV_SINGLE_CONTROL_PLANE_ID) {
        const backup = path.join(backupDir, name)
        if (!fs.existsSync(backup)) {
          fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
          backedUp += 1
        }
        next.migrated_to_single_control_at = new Date().toISOString()
        atomicWriteJson(file, next)
        appendControlAuditUnlocked(resolved, threadId, {
          type: 'legacy_state_migrated',
          previous_control_epoch: String(prior.control_epoch || 'pre_single_control'),
          preserved_semantic_sha256: sha256(JSON.stringify(semanticSnapshot(next)))
        })
        migrated.push(file)
      }
    })
  }
  return {
    ok: true,
    checked: fs.readdirSync(dir).filter((entry) => entry.endsWith('.json')).length,
    migrated: migrated.length,
    backed_up: backedUp,
    backup_directory: 'thread-state_pre_migration'
  }
}

function quarantinePreSingleControlOutbox(root) {
  const resolved = ensureControlDirs(root)
  const dir = path.join(resolved, 'outbox')
  const quarantineDir = path.join(resolved, 'outbox_quarantine_pre_single_control')
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(quarantineDir, { recursive: true })
  const quarantined = []
  for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.json') || entry.endsWith('.json.lock'))) {
    const file = path.join(dir, name)
    const packet = safeReadJson(file, {})
    const verdict = validateControlReceipt(packet, { root: resolved, requireLedger: true, requirePayload: true })
    if (packet.source === SCV_SINGLE_CONTROL_SOURCE && verdict.valid) continue
    const dest = path.join(quarantineDir, `${Date.now()}-${name.replace(/\.lock$/, '')}`)
    atomicWriteJson(dest, {
      ...packet,
      quarantined_at: new Date().toISOString(),
      quarantine_reason: verdict.reason || 'pre_single_control_packet',
      required_control_plane_id: SCV_SINGLE_CONTROL_PLANE_ID,
      required_control_epoch: SCV_CONTROL_EPOCH
    })
    try { fs.unlinkSync(file) } catch {}
    quarantined.push(dest)
  }
  return { ok: true, quarantined: quarantined.length, files: quarantined }
}

module.exports = {
  repeatedVisibleLineVerdict,
  textLooksLikeSchedulingProposal,
  SCV_SINGLE_CONTROL_PLANE_ID,
  SCV_SINGLE_CONTROL_SOURCE,
  SCV_CONTROL_EPOCH,
  CONTROL_RECEIPT_VERSION,
  DEFAULT_CONTROL_REAUTHOR_PASSES,
  MAX_CONTROL_REAUTHOR_PASSES,
  CONTROL_REPAIR_LEDGER_LIMIT,
  CONTROL_REPAIR_LOOP_VERSION,
  SCV_CLOSED_TRANSITION_CONTRACT_VERSION,
  parseCandidateVerifierFailure,
  deriveBookingStage,
  liveBookingIdentityAnswer,
  contextualBareBookingHourFrame,
  liveBookingClockFrame,
  bindLiveControllerPacketMetadata,
  extractOfferedSlotsFromPacket,
  extractLatestOfferedSlotFromPacket,
  historicalOfferedSlotForDate,
  recoverGroundedDesignContextFromHistory,
  semanticSnapshot,
  migrateStateObject,
  readControlState,
  reduceConversationState,
  recordIngressEvent,
  appendControlHistoryEvent,
  appendAcceptedUnverifiedDeliveryEvidence,
  appendConfirmedDeliveryEvidence,
  beginAcceptedUnverifiedDeliveryPublication,
  clearAcceptedUnverifiedDeliveryPublication,
  recoverPreNetworkDeliveryPublication,
  acceptedUnverifiedBoundaryPending,
  conversationContextPublicationPending,
  recordControlLifecycleEvent,
  enrichControlHistoryUserEvent,
  sourceAuthenticatedEnrichedInboundTurn,
  mediaContextAuthorityRank,
  selectAuthoritativeMediaText,
  commitControlDecision,
  replayCommittedDecision,
  buildControlReceipt,
  packetPayloadSha256,
  controlDecisionArtifactHash,
  buildControlDecisionArtifact,
  readControlDecisionArtifact,
  persistControlDecisionArtifact,
  repairTransportPacketFromDecisionArtifact,
  validateControlReceipt,
  assertSingleControlEnvelope,
  parseCandidateVerifierFailure,
  buildCumulativeControlRepairLock,
  buildControlVerifierRetryError,
  executeSingleControlTurn,
  migrateAllThreadStates,
  quarantinePreSingleControlOutbox,
  statePath,
  historyPath,
  controlDecisionPath,
  ensureControlDirs,
  withThreadControlLock
}
