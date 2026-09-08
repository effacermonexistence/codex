#!/usr/bin/env node
'use strict'

// Regression harness for the generic info fast path (owner directive
// 2026-09-02, live incident legacy-manychat-6818f3db…).
//
// Locks:
//   - the exact production phrase and its natural variants are answered by a
//     bounded deterministic packet before the optional intent classifier and
//     before any model call (child process proves no provider call happened)
//   - stale double-check / deposit / form / date state never resumes an old
//     stage: the information request owns the live turn
//   - every packet variant passes the contract harness, the closed-transition
//     verifier and the surface locks, explains the model spot, keeps the
//     custom door open, points at profile / highlights, leaves exactly one
//     next move and carries no form / rate / date / deposit / double-check
//     wording and no generic recovery wording
//   - concrete motifs, price questions, media, deposit claims, negations and
//     controller repair passes stay on their existing lanes
//   - the full controller adopts the packet on the first pass with zero
//     verifier rejections and no route-aware recovery

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const fastPath = require(path.join(__dirname, 'scv-generic-info-fast-path.js'))
const contract = require(path.join(__dirname, 'scv-contract-harness.js'))
const transition = require(path.join(__dirname, 'scv-closed-transition-contract.js'))
const { humanWordChoiceHit } = require(path.join(__dirname, 'scv-human-word-choice.js'))
const { annotateStructuredStateForLiveTurn } = require(path.join(__dirname, 'dm-authority.js'))

const HARNESS_VERSION = 'scv-generic-info-fast-path-harness-2026-09-04-v3-live-text-authority'
const INCIDENT_MESSAGE = 'Can I please get more information?'

let checked = 0
const failures = []
function check(name, condition, detail = '') {
  checked += 1
  if (!condition) failures.push({ name, detail: String(detail || '').slice(0, 1200) })
}

function baseInput(message, extra = {}) {
  return {
    contact_id: 'generic-info-harness',
    thread_id: 'generic-info-harness',
    instagram_username: 'omar.system',
    message_id: extra.message_id || 'generic-info-harness-1',
    message,
    live_message: message,
    received_at: '2026-09-02T04:10:21.721Z',
    recent_history: extra.recent_history || [],
    structured_state: Object.assign({}, extra.structured_state || {}),
    structured_output_required: extra.structured_output_required === true,
    control_transition_contract: extra.control_transition_contract === undefined
      ? { action: 'design_intake', reason: 'direct_info_request_owns_live_turn', obligations: [], fields: {} }
      : extra.control_transition_contract,
    control_transition_repair: extra.control_transition_repair || '',
    media_urls: extra.media_urls || []
  }
}

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
  deposit_requested: true
}

// ───────────────────────── A. eligibility ─────────────────────────
const eligiblePhrases = [
  INCIDENT_MESSAGE,
  'Hi, can I get more info?',
  'Can you tell me how this works?',
  'I’m interested, could you give me some details?',
  'More info please',
  'How do I book?',
  'can i plz get some infos',
  'CAN I PLEASE GET MORE INFORMATION',
  'can i please get more informaton?',
  'more info pls!!',
  'hello can i plz get some infos?',
  'Could you tell me more about this?'
]
for (const phrase of eligiblePhrases) {
  const verdict = runner.evaluateGenericInfoFastPathForInput(baseInput(phrase))
  check(`eligible :: ${phrase}`, verdict.eligible === true, JSON.stringify(verdict))
}

const ineligibleCases = [
  ['concrete motif inside the question', baseInput('Can I get more information about booking a capybara tattoo?')],
  ['price question keeps the rate lane', baseInput('can i get more info on the price?')],
  ['unresolved referent stays on clarification lane', baseInput('what should i do over there?')],
  ['negated interest', baseInput("I'm not interested")],
  ['booking process inside an active tattoo thread', baseInput('how does booking work?', {
    structured_state: { tattoo_intent_active: true, booking_stage_hint: 'design_intake', known_design_context: 'moth' }
  })],
  ['media turn', baseInput('sent a photo', { media_urls: ['https://example.invalid/photo.jpg'], structured_state: { live_turn_is_media_reference: true } })],
  ['deposit sent claim', baseInput('i just sent the deposit can i get more info', { structured_state: { live_turn_deposit_sent: true } })],
  ['controller repair pass', baseInput(INCIDENT_MESSAGE, { control_transition_repair: 'CONTROLLER REPAIR: previous candidate rejected' })],
  ['controller route offer_form', baseInput(INCIDENT_MESSAGE, { control_transition_contract: { action: 'offer_form', reason: 'design_direction_ready_for_form_offer', obligations: [], fields: {} } })],
  ['controller route resolve_context', baseInput(INCIDENT_MESSAGE, { control_transition_contract: { action: 'resolve_context', reason: 'ambiguous_missing_referent', obligations: [], fields: {} } })],
  ['non latin live text', baseInput('더 자세한 정보 받을 수 있을까요?')],
  ['ungrounded how does this work with history', baseInput('how does this work?', {
    recent_history: [{ role: 'user', text: 'lol' }, { role: 'assistant', text: 'haha what do you mean' }]
  })]
]
for (const [label, input] of ineligibleCases) {
  const verdict = runner.evaluateGenericInfoFastPathForInput(input)
  check(`ineligible :: ${label}`, verdict.eligible === false, JSON.stringify(verdict))
  check(`no packet :: ${label}`, runner.buildPreIntentGenericInfoPacket(input) === null)
}

// ───────────────────────── B. packet quality for every variant ─────────────────────────
const FORBIDDEN_FUNNEL_RE = /\b(form|application|apply|deposit|zelle|double\s*check|rate|rates|price|pricing|cost|per\s*hour|\/h|date|dates|calendar|schedule|appointment|book it|booking)\b|\$\d/i
const GENERIC_RECOVERY_RE = /haven[’']?t changed anything|handle first|verify the next step|i have your message|what would you like me to handle/i
const CTA_RE = /\?|\b(lmk|let me know|send me|tell me|show me|drop|throw)\b/i

function packetTexts(output) {
  return (output?.packet?.bubbles || []).map((bubble) => String(bubble.text || ''))
}

function assertPacketQuality(label, input, output) {
  const texts = packetTexts(output)
  check(`${label} :: packet present`, output && texts.length === 2, JSON.stringify(output && output.packet))
  if (!output) return
  const packet = output.packet
  const authority = output.authority || {}
  check(`${label} :: executor`, authority.executor === fastPath.GENERIC_INFO_FAST_PATH_EXECUTOR &&
    authority.model === 'none' && authority.model_call_skipped === true && authority.intent_classifier_skipped === true &&
    authority.deterministic_fast_path === fastPath.GENERIC_INFO_FAST_PATH_KIND &&
    authority.fast_path_version === fastPath.SCV_GENERIC_INFO_FAST_PATH_VERSION, JSON.stringify(authority))
  check(`${label} :: transport flags`, packet.authority_transport_flags?.generic_info_fast_path === true &&
    packet.authority_transport_flags?.reason === fastPath.GENERIC_INFO_FAST_PATH_ROUTE, JSON.stringify(packet.authority_transport_flags))
  check(`${label} :: controller predicate`, fastPath.candidateIsGenericInfoFastPath(output) === true)
  const contractVerdict = contract.evaluateScvContractHarness(input, packet)
  check(`${label} :: contract harness valid`, contractVerdict.valid === true, JSON.stringify(contractVerdict))
  const plan = transition.deriveClosedTransitionPlan(input)
  const transitionVerdict = transition.evaluateClosedTransitionContract(input, packet, plan)
  check(`${label} :: closed transition valid`, transitionVerdict.valid === true, JSON.stringify({ plan, transitionVerdict }))
  check(`${label} :: no generic ai tone`, runner.detectGenericAiTone(packet, input) === null, JSON.stringify(runner.detectGenericAiTone(packet, input)))
  for (const text of texts) {
    check(`${label} :: human word choice :: ${text.slice(0, 40)}`, humanWordChoiceHit(text) === null, JSON.stringify(humanWordChoiceHit(text)))
    check(`${label} :: no comma / trailing period / dash :: ${text.slice(0, 40)}`,
      !text.includes(',') && !/\.\s*$/.test(text) && !/[-–—]/.test(text), text)
    check(`${label} :: no hey opener :: ${text.slice(0, 40)}`, !/^\s*hey\b/i.test(text), text)
    check(`${label} :: bounded length :: ${text.slice(0, 40)}`, text.length > 0 && text.length <= 260, String(text.length))
    check(`${label} :: no funnel / money / calendar words :: ${text.slice(0, 40)}`, !FORBIDDEN_FUNNEL_RE.test(text), text)
    check(`${label} :: no generic recovery wording :: ${text.slice(0, 40)}`, !GENERIC_RECOVERY_RE.test(text), text)
  }
  check(`${label} :: explains model spot`, contract.MODEL_OFFER_EXPLANATION_RE.test(texts.join('\n')) && /\bmodel spots?\b/i.test(texts[0]), texts[0])
  check(`${label} :: profile or highlights inspiration door`, /\b(profile|highlights?)\b/i.test(texts[1]), texts[1])
  check(`${label} :: customization open door`, contract.packetHasCustomizationOpenDoor(packet) === true, texts.join(' | '))
  check(`${label} :: host lead motion`, contract.packetHasHostLeadMotion(input, packet) === true, texts.join(' | '))
  check(`${label} :: no repeated lead motion`, contract.packetHasRepeatedOpenLeadMotion(packet) === false, texts.join(' | '))
  check(`${label} :: no size or placement question`, contract.packetAsksSizeOrPlacement(packet) === false, texts.join(' | '))
  check(`${label} :: exactly one next move in the final bubble`,
    !CTA_RE.test(texts[0]) && CTA_RE.test(texts[1]), texts.join(' | '))
  check(`${label} :: no sentence-final comma-stripped artifacts`, texts.every((text) => !/\s{2,}/.test(text)), texts.join(' | '))
}

function collectVariants(message, extra = {}) {
  const seen = new Map()
  for (let index = 0; index < 400 && seen.size < fastPath.GENERIC_INFO_VARIANTS.length; index += 1) {
    const input = baseInput(message, { ...extra, message_id: `variant-probe-${index}` })
    const output = runner.buildPreIntentGenericInfoPacket(input)
    const variant = output?.authority?.fast_path_variant_index
    if (output && Number.isInteger(variant) && !seen.has(variant)) seen.set(variant, { input, output })
  }
  return seen
}

const plainVariants = collectVariants(INCIDENT_MESSAGE)
check('every variant reachable without greeting', plainVariants.size === fastPath.GENERIC_INFO_VARIANTS.length, String(plainVariants.size))
for (const [variant, { input, output }] of plainVariants) {
  assertPacketQuality(`plain variant ${variant}`, input, output)
  check(`plain variant ${variant} :: no greeting return when client did not greet`,
    output.authority.fast_path_greeting_returned === false && !/^\s*(hi+|hello)\b/i.test(packetTexts(output)[0]), packetTexts(output)[0])
}

const greetingVariants = collectVariants('Hi, can I get more info?')
check('every variant reachable with greeting', greetingVariants.size === fastPath.GENERIC_INFO_VARIANTS.length, String(greetingVariants.size))
for (const [variant, { input, output }] of greetingVariants) {
  assertPacketQuality(`greeting variant ${variant}`, input, output)
  check(`greeting variant ${variant} :: greeting returned`,
    output.authority.fast_path_greeting_returned === true && /^\s*hi+\b/i.test(packetTexts(output)[0]) &&
    contract.packetReturnsFreshGreeting(output.packet) === true, packetTexts(output)[0])
}

// Greeting is NOT returned once the thread already has an assistant turn.
const secondTurnGreeting = runner.buildPreIntentGenericInfoPacket(baseInput('Hi can I get more info?', {
  recent_history: [
    { role: 'user', text: 'hey', message_id: 'h-0' },
    { role: 'assistant', text: 'heyy how is it going', message_id: 'h-0', bubble_index: 0 }
  ]
}))
check('greeting not returned after an assistant turn already exists',
  secondTurnGreeting && secondTurnGreeting.authority.fast_path_greeting_returned === false &&
  !/^\s*hi+\b/i.test(packetTexts(secondTurnGreeting)[0]), JSON.stringify(secondTurnGreeting && secondTurnGreeting.packet))

// ───────────────────────── C. stale state never resumes an old stage ─────────────────────────
const annotatedStale = annotateStructuredStateForLiveTurn(
  { text: INCIDENT_MESSAGE, message: INCIDENT_MESSAGE }, staleBookingState, [])
const staleInput = baseInput(INCIDENT_MESSAGE, { structured_state: annotatedStale, structured_output_required: true })
const stalePlan = transition.deriveClosedTransitionPlan(staleInput)
check('stale double-check + deposit state still routes to direct info request',
  stalePlan.action === transition.ACTIONS.DESIGN_INTAKE && stalePlan.reason === 'direct_info_request_owns_live_turn', JSON.stringify(stalePlan))
const staleOutput = runner.buildPreIntentGenericInfoPacket(staleInput)
assertPacketQuality('stale state', staleInput, staleOutput)
check('stale state :: next action reflects the info route not the old checkpoint',
  staleOutput && staleOutput.packet.next_action_reflected === 'design_intake' &&
  Array.isArray(staleOutput.packet.questioned_fields) && staleOutput.packet.questioned_fields.length === 0,
  JSON.stringify(staleOutput && { next: staleOutput.packet.next_action_reflected, q: staleOutput.packet.questioned_fields }))
check('stale state :: nothing about the old name / phone / date / time is repeated',
  !/omar|5555555555|september 15|3pm/i.test(packetTexts(staleOutput).join(' ')), packetTexts(staleOutput).join(' | '))

for (const [label, state] of [
  ['stale form offer pending', { form_offer_asked: true, booking_stage_hint: 'awaiting_form_permission', tattoo_intent_active: true }],
  ['stale form link sent', { form_link_sent: true, booking_stage_hint: 'awaiting_form_submission', tattoo_intent_active: true }],
  ['stale date exchange', { form_submitted: true, known_requested_date: 'october 2', booking_stage_hint: 'post_form_availability', tattoo_intent_active: true }]
]) {
  const input = baseInput(INCIDENT_MESSAGE, { structured_state: annotateStructuredStateForLiveTurn({ text: INCIDENT_MESSAGE, message: INCIDENT_MESSAGE }, state, []) })
  const output = runner.buildPreIntentGenericInfoPacket(input)
  check(`${label} :: fast path answers the info request`, output !== null && packetTexts(output).length === 2, JSON.stringify(output && output.packet))
  check(`${label} :: no funnel words`, output && !FORBIDDEN_FUNNEL_RE.test(packetTexts(output).join(' ')), packetTexts(output || {}).join(' | '))
}

// Exact v150 production topology before incident 07b: the form, date, time and
// a prior concrete design are durable, but identity is still missing. Historical
// design memory must not turn the current self-contained info request into a
// design/identity answer or force a provider call.
{
  const state = {
    tattoo_intent_active: true,
    known_design_context: 'small dagger on the inner forearm black and grey',
    known_client_anchored_inspiration: true,
    form_offer_asked: true,
    form_link_sent: true,
    form_submitted: true,
    known_requested_date: 'september 12',
    known_requested_time: '2:00pm',
    booking_stage_hint: 'awaiting_form_identity_match'
  }
  const annotated = annotateStructuredStateForLiveTurn(
    { text: 'hi can i please get more information', message: 'hi can i please get more information' },
    state,
    []
  )
  const input = baseInput('hi can i please get more information', {
    structured_state: annotated,
    control_transition_contract: null
  })
  input.control_transition_contract = transition.deriveClosedTransitionPlan(input)
  check('v151 incident topology routes current info above missing identity',
    input.control_transition_contract.action === transition.ACTIONS.DESIGN_INTAKE &&
    input.control_transition_contract.reason === 'direct_info_request_owns_live_turn',
    JSON.stringify(input.control_transition_contract))
  const output = runner.buildPreIntentGenericInfoPacket(input)
  check('v151 incident topology answers without model',
    output?.authority?.executor === fastPath.GENERIC_INFO_FAST_PATH_EXECUTOR &&
    output?.authority?.model_call_skipped === true,
    JSON.stringify(output?.authority))
}

// ───────────────────────── D. consecutive duplicate avoidance ─────────────────────────
const firstOutput = runner.buildPreIntentGenericInfoPacket(baseInput(INCIDENT_MESSAGE, { message_id: 'dup-1' }))
const repeatHistory = packetTexts(firstOutput).map((text, index) => ({ role: 'assistant_attempted', delivery_status: 'manychat_accepted_unverified', text, message_id: 'dup-1', bubble_index: index }))
const secondOutput = runner.buildPreIntentGenericInfoPacket(baseInput(INCIDENT_MESSAGE, { message_id: 'dup-1', recent_history: repeatHistory }))
check('same seed with the previous text already in history picks a different variant',
  secondOutput && packetTexts(secondOutput)[0] !== packetTexts(firstOutput)[0], JSON.stringify({ first: packetTexts(firstOutput), second: packetTexts(secondOutput || {}) }))
const allTextsHistory = fastPath.GENERIC_INFO_VARIANTS.flatMap((variant, index) => [
  { role: 'assistant', text: variant.first, message_id: `all-${index}`, bubble_index: 0 },
  { role: 'assistant', text: variant.second, message_id: `all-${index}`, bubble_index: 1 }
])
check('all variants already used falls back to the model lane instead of repeating',
  runner.buildPreIntentGenericInfoPacket(baseInput(INCIDENT_MESSAGE, { recent_history: allTextsHistory })) === null)

// ───────────────────────── E. child process: no provider call, deterministic latency ─────────────────────────
function spawnRunner(message, extra = {}) {
  const input = baseInput(message, extra)
  const started = Date.now()
  const result = spawnSync(process.execPath, [path.join(__dirname, 'codex-dm-runner.js'), JSON.stringify(input)], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      OPENAI_API_KEY: '',
      SCV_LLM_INTENT: '1',
      SCV_ROOT: __dirname
    }
  })
  let output = null
  try { output = JSON.parse(result.stdout) } catch {}
  return { result, output, elapsed_ms: Date.now() - started }
}
const child = spawnRunner(INCIDENT_MESSAGE, { structured_state: annotatedStale, structured_output_required: true })
check('child runner exits 0 without any provider key', child.result.status === 0, String(child.result.stderr || '').slice(0, 600))
check('child runner adopts the fast path', child.output?.authority?.executor === fastPath.GENERIC_INFO_FAST_PATH_EXECUTOR, JSON.stringify(child.output?.authority))
check('child runner logs adoption and never attempts a model or classifier call',
  /generic_info_fast_path_adopted/.test(String(child.result.stderr || '')) &&
  !/openai|codex_exec_failed|attempts=/i.test(String(child.result.stderr || '')), String(child.result.stderr || '').slice(0, 600))
check('child runner latency is deterministic-path level', child.elapsed_ms < 5000, String(child.elapsed_ms))
const childModelLane = spawnRunner('Can I get more information about booking a capybara tattoo?')
check('concrete motif still goes to the model lane (fails only because no key here)',
  childModelLane.result.status !== 0 && /openai_api_key_missing/.test(String(childModelLane.result.stderr || '')), String(childModelLane.result.stderr || '').slice(0, 300))

// ───────────────────────── F. full controller with the real runner ─────────────────────────
const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-generic-info-app-'))
const previousEnv = {}
function setEnv(key, value) { previousEnv[key] = process.env[key]; process.env[key] = value }
try {
  for (const name of fs.readdirSync(__dirname)) {
    if (['node_modules', 'logs', 'thread-history', 'thread-state', 'inbox', 'outbox', 'control-events', 'control-decisions', 'control-locks', 'form-submissions'].includes(name)) continue
    if (/_quarantine_|^outbox|^inbox|^reactbox|-idempotency$|^accepted-unverified|^release-|^recovery-|^debug-reset|^\./.test(name)) continue
    fs.symlinkSync(path.join(__dirname, name), path.join(appRoot, name))
  }
  setEnv('SCV_ROOT', appRoot)
  setEnv('OPENAI_API_KEY', '')
  setEnv('SCV_OPENAI_RESPONSES_REQUIRED', '1')
  setEnv('SCV_LLM_INTENT', '1')
  setEnv('SCV_PAUSE_NON_TEST', '0')
  setEnv('SCV_PAUSE_ALL', '0')
  setEnv('SCV_PAUSE_DEBUG_ACCOUNTS', '0')
  setEnv('SCV_RELEASE_MODE', 'local')
  setEnv('RAILWAY_ENVIRONMENT_NAME', 'local')
  const control = require(path.join(__dirname, 'scv-single-control-plane.js'))
  control.ensureControlDirs(appRoot)
  const controllerCases = [
    ['fresh thread exact incident', INCIDENT_MESSAGE, undefined],
    ['stale double-check + deposit state', INCIDENT_MESSAGE, staleBookingState],
    ['missing identity with historical design', INCIDENT_MESSAGE, {
      tattoo_intent_active: true,
      known_design_context: 'small dagger on the inner forearm black and grey',
      known_client_anchored_inspiration: true,
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_requested_date: 'september 12',
      known_requested_time: '2:00pm',
      booking_stage_hint: 'awaiting_form_identity_match'
    }],
    ['greeting + typo', 'Hi can i plz get some infos?', undefined]
  ]
  for (const [label, text, override] of controllerCases) {
    const contact = `generic-info-controller-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
    const inbound = {
      contact_id: contact, thread_id: contact, instagram_username: 'omar.system', message_id: `${contact}-1`, text,
      received_at: new Date().toISOString(), source_interaction_at: new Date(Date.now() - 2000).toISOString()
    }
    control.recordIngressEvent(appRoot, inbound)
    const started = Date.now()
    let result = null
    let error = ''
    try {
      result = control.executeSingleControlTurn(inbound, { root: appRoot, authority_options: override ? { structured_state_override: override } : {} })
    } catch (err) { error = String(err?.message || err) }
    const elapsed = Date.now() - started
    const authority = result?.authority || {}
    check(`controller :: ${label} :: adopted without error`, !error, error.slice(0, 600))
    check(`controller :: ${label} :: fast path executor on first pass`,
      authority.candidate_authority?.executor === fastPath.GENERIC_INFO_FAST_PATH_EXECUTOR &&
      Number(authority.control_verifier_rejection_count) === 0 &&
      authority.control_route_aware_visible_recovery !== true &&
      authority.closed_transition_action === 'design_intake' &&
      authority.final_verifier_reason === 'valid', JSON.stringify(authority))
    check(`controller :: ${label} :: two bubbles`, Array.isArray(result?.packet?.bubbles) && result.packet.bubbles.length === 2, JSON.stringify(result?.packet?.bubbles))
    check(`controller :: ${label} :: no funnel words`, result && !FORBIDDEN_FUNNEL_RE.test(result.packet.bubbles.map((b) => b.text).join(' ')), JSON.stringify(result?.packet?.bubbles))
    check(`controller :: ${label} :: latency`, elapsed < 8000, String(elapsed))
    check(`controller :: ${label} :: adopted stage is the info route`, result?.structured_state?.next_action === 'design_intake', JSON.stringify(result?.structured_state?.next_action))
  }
  const motifContact = 'generic-info-controller-motif'
  const motifInbound = {
    contact_id: motifContact, thread_id: motifContact, instagram_username: 'omar.system', message_id: `${motifContact}-1`,
    text: 'Can I get more information about booking a capybara tattoo?',
    received_at: new Date().toISOString(), source_interaction_at: new Date(Date.now() - 2000).toISOString()
  }
  control.recordIngressEvent(appRoot, motifInbound)
  let motifError = ''
  try { control.executeSingleControlTurn(motifInbound, { root: appRoot }) } catch (err) { motifError = String(err?.message || err) }
  check('controller :: concrete motif still reaches the model lane', /openai_api_key_missing/.test(motifError), motifError.slice(0, 300))
} finally {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(appRoot, { recursive: true, force: true })
}

// ───────────────────────── G. controller predicate tamper resistance ─────────────────────────
const genuine = runner.buildPreIntentGenericInfoPacket(baseInput(INCIDENT_MESSAGE))
check('predicate accepts genuine fast path candidate', fastPath.candidateIsGenericInfoFastPath(genuine) === true)
check('predicate rejects a model-authored impostor',
  fastPath.candidateIsGenericInfoFastPath({ ...genuine, authority: { ...genuine.authority, model: 'gpt-5.4-mini-2026-03-17' } }) === false)
check('predicate rejects a missing transport flag',
  fastPath.candidateIsGenericInfoFastPath({ ...genuine, packet: { ...genuine.packet, authority_transport_flags: {} } }) === false)
check('predicate rejects a wrong version',
  fastPath.candidateIsGenericInfoFastPath({ ...genuine, authority: { ...genuine.authority, fast_path_version: 'other' } }) === false)
check('allowed controller actions are non-transactional only',
  JSON.stringify(fastPath.GENERIC_INFO_FAST_PATH_ALLOWED_ACTIONS) === JSON.stringify(['design_intake', 'general_continue', 'tattoo_continue']))


// ───────────────────────── H. open four-field checkpoint: side question keeps it open (v143) ─────────────────────────
// Live incident 2026-09-03 (Omar.system): "Hi, can I please get more information?"
// straight after the checkpoint. The durable client-anchored reference in state
// must not push the turn to the model lane / which-field recovery, and the
// answer must not re-greet or end on a design question.
{
  const checkpointBlock = 'Name : Omar System\nPhone Number : 4155550199\nAppointment date : 12th of September\nTime : 2:00pm\n\ncan you double check this just to make sure'
  const openCheckpointState = {
    tattoo_intent_active: true,
    known_design_context: 'small dagger on the inner forearm black and grey',
    known_client_anchored_inspiration: true,
    form_offer_asked: true,
    form_link_sent: true,
    form_submitted: true,
    known_requested_date: 'september 12',
    known_requested_time: '2:00pm',
    known_name_used_on_form: 'Omar System',
    known_phone_used_on_form: '4155550199',
    double_check_sent: true,
    name_phone_date_time_double_check_sent: true,
    booking_stage_hint: 'awaiting_double_check_confirmation'
  }
  const historyBeforeInfo = [
    { role: 'user', text: 'i’m thinking a small dagger on my inner forearm, black and grey', message_id: 'h-1' },
    { role: 'assistant', text: 'love that want me to send the application form?', message_id: 'h-1', bubble_index: 0 },
    { role: 'user', text: 'Omar System 4155550199', message_id: 'h-2' },
    { role: 'assistant', text: checkpointBlock, message_id: 'h-2', bubble_index: 0 }
  ]
  const WHICH_FIELD_RE = /\b(?:date|day)\b[\s\S]*\btime\b[\s\S]*\b(?:name|number)\b|\btime\b[\s\S]*\bdate\b[\s\S]*\b(?:name|number)\b/i
  const DESIGN_QUESTION_RE = /what kind of piece|what (?:are|were) you thinking|send me any loose idea|lmk what you (?:are into|have in mind)|tell me what you are thinking|send me whatever you have in mind/i
  function checkpointInput(text, extra = {}) {
    const state = annotateStructuredStateForLiveTurn({ text, message: text }, { ...openCheckpointState, ...(extra.state || {}) }, extra.history || historyBeforeInfo)
    const input = baseInput(text, {
      message_id: extra.message_id || 'checkpoint-side-question-1',
      recent_history: extra.history || historyBeforeInfo,
      structured_state: state,
      structured_output_required: true,
      control_transition_contract: null
    })
    input.control_transition_contract = transition.deriveClosedTransitionPlan(input)
    return input
  }
  for (const text of ['hi can i please get more information', INCIDENT_MESSAGE, 'more info pls!!', 'can i plz get some infos']) {
    const input = checkpointInput(text)
    const plan = input.control_transition_contract
    check(`checkpoint side question :: route :: ${text}`, plan.action === 'await_double_check_confirmation' && plan.reason === fastPath.GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON, JSON.stringify(plan))
    const verdict = runner.evaluateGenericInfoFastPathForInput(input)
    check(`checkpoint side question :: eligible :: ${text}`, verdict.eligible === true && verdict.checkpoint_side_question === true, JSON.stringify(verdict))
    const output = runner.buildPreIntentGenericInfoPacket(input)
    const texts = packetTexts(output)
    check(`checkpoint side question :: packet :: ${text}`, output && texts.length === 2, JSON.stringify(output && output.packet))
    if (!output) continue
    check(`checkpoint side question :: executor marker :: ${text}`, output.authority.executor === fastPath.GENERIC_INFO_FAST_PATH_EXECUTOR && output.authority.fast_path_checkpoint_side_question === true && output.authority.fast_path_greeting_returned === false && output.authority.model === 'none', JSON.stringify(output.authority))
    check(`checkpoint side question :: predicate :: ${text}`, fastPath.candidateIsGenericInfoFastPath(output) === true)
    check(`checkpoint side question :: explains model spot :: ${text}`, /\bmodel spots?\b/i.test(texts[0]), texts[0])
    check(`checkpoint side question :: resume line :: ${text}`, fastPath.CHECKPOINT_RESUME_LINES.includes(texts[1]), texts[1])
    check(`checkpoint side question :: no regreet / no design question / no which-field :: ${text}`, !/^\s*(?:hi+|hello|hey)\b/i.test(texts[0]) && !DESIGN_QUESTION_RE.test(texts.join(' ')) && !WHICH_FIELD_RE.test(texts.join(' ')) && !GENERIC_RECOVERY_RE.test(texts.join(' ')), texts.join(' | '))
    check(`checkpoint side question :: no funnel / money words :: ${text}`, !FORBIDDEN_FUNNEL_RE.test(texts.join(' ')), texts.join(' | '))
    for (const t of texts) {
      check(`checkpoint side question :: human word choice :: ${t.slice(0, 40)}`, humanWordChoiceHit(t) === null, JSON.stringify(humanWordChoiceHit(t)))
    }
    check(`checkpoint side question :: host lead motion :: ${text}`, contract.packetHasHostLeadMotion(input, output.packet) === true, texts.join(' | '))
    check(`checkpoint side question :: contract harness valid :: ${text}`, contract.evaluateScvContractHarness(input, output.packet).valid === true, JSON.stringify(contract.evaluateScvContractHarness(input, output.packet)))
    const transitionVerdict = transition.evaluateClosedTransitionContract(input, output.packet, plan)
    check(`checkpoint side question :: closed transition valid at await :: ${text}`, transitionVerdict.valid === true, JSON.stringify(transitionVerdict))
    check(`checkpoint side question :: reflects await stage :: ${text}`, output.packet.next_action_reflected === 'await_double_check_confirmation', JSON.stringify({ next: output.packet.next_action_reflected, q: output.packet.questioned_fields }))
  }
  // Exhaustion on the owner's debug thread: every explanation variant already
  // used still yields a deterministic answer at the open checkpoint (only the
  // two most recent assistant lines are excluded — the drift monitor's rule).
  const burnedHistory = historyBeforeInfo.concat(fastPath.GENERIC_INFO_VARIANTS.flatMap((variant, index) => [
    { role: 'user', text: 'more info?', message_id: `burn-${index}` },
    { role: 'assistant', text: variant.first, message_id: `burn-${index}`, bubble_index: 0 },
    { role: 'assistant', text: variant.second, message_id: `burn-${index}`, bubble_index: 1 }
  ]), [{ role: 'assistant', text: checkpointBlock, message_id: 'h-3', bubble_index: 0 }])
  const burnedInput = checkpointInput('hi can i please get more information', { history: burnedHistory, message_id: 'checkpoint-side-question-burned' })
  const burnedOutput = runner.buildPreIntentGenericInfoPacket(burnedInput)
  const burnedTexts = packetTexts(burnedOutput)
  check('checkpoint side question :: all variants burned still deterministic', burnedOutput !== null && burnedTexts.length === 2 && fastPath.CHECKPOINT_RESUME_LINES.includes(burnedTexts[1]), JSON.stringify(burnedOutput && burnedOutput.packet))
  // The side-question reason cannot be forged onto another stage.
  const forged = runner.evaluateGenericInfoFastPathForInput(baseInput(INCIDENT_MESSAGE, { control_transition_contract: { action: 'double_check', reason: fastPath.GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON, obligations: [], fields: {} } }))
  check('checkpoint side question :: reason on a transactional action is refused', forged.eligible === false && forged.reason === 'controller_route_not_generic_info', JSON.stringify(forged))
  check('await stage is admitted only under the checkpoint side-question reason',
    fastPath.genericInfoFastPathAdmitsPlan({ action: 'await_double_check_confirmation', reason: fastPath.GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON }) === true &&
    fastPath.genericInfoFastPathAdmitsPlan({ action: 'await_double_check_confirmation', reason: 'four_field_double_check_already_sent_wait_without_repeating' }) === false &&
    fastPath.genericInfoFastPathAdmitsPlan({ action: 'double_check', reason: fastPath.GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON }) === false &&
    fastPath.genericInfoFastPathAdmitsPlan({ action: 'deposit_handoff', reason: 'x' }) === false)
  // A revision, a confirmation and a price question at the open checkpoint are not side questions.
  for (const text of ['wait can i change something', 'looks good', 'can i get more info on the price?']) {
    const input = checkpointInput(text, { message_id: `not-side-${text.length}` })
    check(`checkpoint side question :: not hijacked :: ${text}`, input.control_transition_contract.reason !== fastPath.GENERIC_INFO_CHECKPOINT_SIDE_QUESTION_REASON, JSON.stringify(input.control_transition_contract))
  }
}

console.log(JSON.stringify({ ok: failures.length === 0, harness_version: HARNESS_VERSION, checked, failed: failures.length, failures }, null, 2))
if (failures.length) process.exit(1)
