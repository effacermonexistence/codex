#!/usr/bin/env node

const {
  applyDeterministicPacketLocks,
  runModelAuthoredFlow,
  verifyPostFilterAdoption,
  visibleEnglishOutputVerdict
} = require('./codex-dm-runner.js')

const SCV_VISIBLE_ENGLISH_OUTPUT_HARNESS_VERSION =
  'scv-visible-english-output-harness-2026-08-25-v4-context-bound-english-recovery'

function packet(text) {
  return { bubbles: [{ text: String(text), delay_ms: 0 }] }
}

function structuredPacket(text) {
  return JSON.stringify({
    reply_text: text,
    acknowledged_fields: [],
    questioned_fields: ['missing_context'],
    next_action_reflected: 'resolve_context',
    bubbles: [{ text, delay_ms: 0 }]
  })
}

function resolveContextInput() {
  return {
    contact_id: 'visible-english-output',
    thread_id: 'visible-english-output',
    instagram_username: 'omar.system',
    message: 'send it',
    live_message: 'send it',
    received_at: '2026-08-20T12:00:00-07:00',
    recent_history: [],
    structured_output_required: true,
    structured_state: {
      live_turn_reply_required: true,
      live_turn_text: 'send it',
      live_turn_context_missing: true,
      live_turn_context_needs_clarification: true,
      live_turn_context_relation: 'ambiguous_missing_referent',
      next_action: 'resolve_context'
    },
    control_transition_contract: {
      action: 'resolve_context',
      reason: 'ambiguous_missing_referent',
      obligations: [],
      fields: {}
    }
  }
}

function executorFrom(candidates, calls) {
  let index = 0
  return async () => {
    calls.count += 1
    const lastMessage = candidates[Math.min(index, candidates.length - 1)]
    index += 1
    return {
      status: 0,
      stderr: '',
      error: '',
      modelUsed: 'focused-harness-model',
      executor: 'focused_visible_english_harness',
      lastMessage
    }
  }
}

async function runScvVisibleEnglishOutputHarness() {
  const checks = []
  const check = (name, condition, detail = '') => {
    checks.push({ name, pass: Boolean(condition), detail: String(detail || '') })
  }
  const checkLanguage = (name, input, text, expected) => {
    const verdict = visibleEnglishOutputVerdict(input, packet(text))
    check(name, verdict.valid === expected, JSON.stringify(verdict))
  }

  const knownIdentityInput = {
    structured_state: {
      known_name_used_on_form: '김민수',
      known_phone_used_on_form: '4157602883',
      known_requested_date: 'August 27',
      known_requested_time: '2pm'
    }
  }
  checkLanguage('ordinary_english_passes', {}, 'yeah i can do that and the exact details get dialed in at the appointment', true)
  checkLanguage('current_rate_and_address_pass', {}, 'the model rate is $150 per hour and the studio is at 10 Arkansas St San Francisco CA 94107', true)
  checkLanguage('emoji_only_is_not_a_language_violation', {}, '🖤💀✨', true)
  checkLanguage('known_non_latin_name_in_english_passes', knownIdentityInput, 'thank you 김민수 🖤 i have your booking here', true)
  checkLanguage('double_check_identity_lines_are_exempt', knownIdentityInput, 'Name : 김민수\nPhone Number : 4157602883\nAppointment date : August 27\nTime : 2pm\n\ncan you give this a quick look and make sure it\'s all right? 🖤', true)
  checkLanguage('accented_names_are_not_foreign_prose', {}, 'thank you José and François 🖤', true)
  checkLanguage('noncanonical_address_is_not_foreign_prose', {}, 'meet me at 12 Rue de la Paix Paris 🖤', true)
  checkLanguage('korean_prose_is_rejected', {}, '응 가능해 폼 보내줄까?', false)
  checkLanguage('spanish_prose_is_rejected', {}, 'claro que sí puedo enviarte el formulario para la cita', false)
  checkLanguage('french_prose_is_rejected', {}, 'bonjour je peux envoyer le formulaire pour votre rendez vous', false)
  checkLanguage('portuguese_prose_is_rejected', {}, 'ola posso enviar o formulario para voce', false)
  checkLanguage('short_spanish_natural_sentence_is_rejected', {}, 'te puedo ayudar con eso', false)
  checkLanguage('short_french_natural_sentence_is_rejected', {}, 'je peux vous aider avec ca', false)
  checkLanguage('short_portuguese_natural_sentence_is_rejected', {}, 'posso ajudar com isso', false)
  checkLanguage('short_italian_natural_sentence_is_rejected', {}, 'posso aiutare con questo', false)
  checkLanguage('mixed_english_spanish_sentence_is_rejected', {}, 'yeah te puedo ayudar con eso', false)
  checkLanguage('mixed_english_french_sentence_is_rejected', {}, 'yeah je peux vous aider avec ca', false)
  checkLanguage('mixed_english_portuguese_sentence_is_rejected', {}, 'yeah posso ajudar com isso', false)
  checkLanguage('mixed_english_italian_sentence_is_rejected', {}, 'yeah posso aiutare con questo', false)
  checkLanguage('japanese_prose_is_rejected', {}, 'もちろん予約フォームを送れるよ', false)
  checkLanguage('chinese_prose_is_rejected', {}, '当然可以我现在给你发申请表', false)
  checkLanguage('arabic_prose_is_rejected', {}, 'أكيد أقدر أرسل لك النموذج الآن', false)

  const directVerdict = verifyPostFilterAdoption({}, packet('감사합니다 지금 확인할게요'))
  check(
    'executed_post_filter_returns_language_reauthor_instruction',
    directVerdict.valid === false &&
      directVerdict.reason === 'visible_output_non_english' &&
      /entirely in natural English/.test(directVerdict.instruction || ''),
    JSON.stringify(directVerdict)
  )

  const identityBase = {
    form_submitted: true,
    known_requested_date: 'August 27',
    known_requested_time: '2pm'
  }
  const allowedBoth = applyDeterministicPacketLocks(
    { structured_state: identityBase },
    packet('send me the name and phone number you used on the form')
  )
  check('failed_ledger_can_ask_both_missing_fields_after_date_time', allowedBoth.bubbles.length === 1, JSON.stringify(allowedBoth))
  const earlyIdentity = applyDeterministicPacketLocks(
    { structured_state: { form_submitted: true } },
    packet('send me the name and phone number you used on the form')
  )
  check('identity_ask_is_blocked_before_date_time', earlyIdentity.bubbles.length === 0, JSON.stringify(earlyIdentity))
  const missingNameOnly = applyDeterministicPacketLocks(
    { structured_state: { ...identityBase, known_phone_used_on_form: '4157602883' } },
    packet('what name did you use on the form?')
  )
  check('only_missing_name_is_allowed', missingNameOnly.bubbles.length === 1, JSON.stringify(missingNameOnly))
  const reasksKnownPhone = applyDeterministicPacketLocks(
    { structured_state: { ...identityBase, known_phone_used_on_form: '4157602883' } },
    packet('send me the name and phone number you used on the form')
  )
  check('known_phone_cannot_be_reasked_with_missing_name', reasksKnownPhone.bubbles.length === 0, JSON.stringify(reasksKnownPhone))

  const input = resolveContextInput()
  const retryCalls = { count: 0 }
  const retryOutput = await runModelAuthoredFlow(input, '', {
    authorityExecutor: executorFrom([
      structuredPacket('정확히 뭘 보내달라는 건지 말해줄래?'),
      structuredPacket('just to be sure what exactly do you want me to send')
    ], retryCalls)
  })
  check('non_english_first_candidate_is_reauthored_once', retryCalls.count === 2, retryCalls.count)
  check('only_english_second_candidate_is_adopted', retryOutput.packet.bubbles[0].text === 'just to be sure what exactly do you want me to send', JSON.stringify(retryOutput.packet))
  check('language_rejection_is_visible_in_authority_receipt', retryOutput.authority.semantic_contract_violations.some((entry) => entry.reason === 'visible_output_non_english'), JSON.stringify(retryOutput.authority.semantic_contract_violations))

  const holdCalls = { count: 0 }
  let holdOutput = null
  let holdError = ''
  try {
    holdOutput = await runModelAuthoredFlow(input, '', {
      authorityExecutor: executorFrom([
        structuredPacket('정확히 뭘 보내달라는 건지 말해줄래?'),
        structuredPacket('어떤 걸 보내달라는 건지 다시 말해줘')
      ], holdCalls)
    })
  } catch (error) {
    holdError = String(error?.message || error)
  }
  check(
    'ambiguous_referent_non_english_exhaustion_stays_on_original_route',
    holdCalls.count === 3 &&
      holdError.startsWith('post_filter_adoption_rejected_after_reauthor_visible_output_non_english') &&
      holdOutput === null,
    holdError || JSON.stringify(holdOutput?.authority || null)
  )

  const unintelligibleInput = {
    ...input,
    message: 'sent a voice note that could not be understood',
    live_message: 'sent a voice note that could not be understood',
    structured_state: {
      ...input.structured_state,
      live_turn_is_voice_note: true,
      live_turn_voice_transcribe_failed: true,
      live_turn_voice_context_unresolved: true,
      live_turn_context_relation: 'unintelligible'
    },
    control_transition_contract: {
      ...input.control_transition_contract,
      reason: 'unintelligible'
    }
  }
  const safeCalls = { count: 0 }
  const safeOutput = await runModelAuthoredFlow(unintelligibleInput, '', {
    authorityExecutor: executorFrom([
      structuredPacket('다시 보내줄래?'),
      structuredPacket('잘 들리지 않았어'),
      structuredPacket('말을 다시 해줘')
    ], safeCalls)
  })
  check(
    'unintelligible_non_english_exhaustion_uses_bounded_safe_recovery',
    safeCalls.count === 3 &&
      safeOutput?.authority?.executor === 'deterministic_safe_clarification_after_model_exhaustion' &&
      safeOutput?.authority?.deterministic_recovery === true &&
      safeOutput?.authority?.deterministic_recovery_kind === 'safe_clarification' &&
      safeOutput?.authority?.deterministic_recovery_reason === 'visible_output_non_english',
    JSON.stringify(safeOutput?.authority || null)
  )
  const holdLanguage = visibleEnglishOutputVerdict(unintelligibleInput, safeOutput?.packet || { bubbles: [] })
  check(
    'context_authorized_safe_recovery_remains_nonempty_english_after_model_exhaustion',
    holdLanguage.valid === true &&
      String(safeOutput?.packet?.reply_text || '').trim().length > 0 &&
      Array.isArray(safeOutput?.packet?.bubbles) &&
      safeOutput.packet.bubbles.some((bubble) => String(bubble?.text || '').trim().length > 0),
    JSON.stringify({ holdLanguage, packet: safeOutput?.packet || null })
  )

  const failed = checks.filter((item) => !item.pass)
  return {
    ok: failed.length === 0,
    harness_version: SCV_VISIBLE_ENGLISH_OUTPUT_HARNESS_VERSION,
    checked: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks
  }
}

if (require.main === module) {
  runScvVisibleEnglishOutputHarness()
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
  SCV_VISIBLE_ENGLISH_OUTPUT_HARNESS_VERSION,
  runScvVisibleEnglishOutputHarness
}
