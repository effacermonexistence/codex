#!/usr/bin/env node
// ============================================================
// SCV APPROVED CONFIG LOCK — Ben-ratified values (2026-07-04).
//
// This is the anti-drift firewall for the configuration Ben approved. If ANY of these
// values drift, this harness fails -> the 7-stones commit gate blocks the commit -> it
// cannot deploy. Changing an approved value is only possible by DELIBERATELY editing it
// here too; there is no silent drift.
//
// Honest boundary: this catches accidental / silent drift and forces any change to be a
// visible, deliberate act. It cannot stop an authorized editor from intentionally changing
// both the value AND this lock at once (that is exactly how the delay drifted 3-12min ->
// 20-60min in June). The real anti-drift is: approved values snapshotted (R2 + this file +
// SCV_DESIGN_INTENT_LOCK.md) + hard-asserted here + a change requires touching this lock.
// ============================================================
const path = require('path')
const fs = require('fs')
const pacing = require(path.join(__dirname, 'scv-delivery-pacing.js'))
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))
const harness = require(path.join(__dirname, 'scv-contract-harness.js'))
const authority = require(path.join(__dirname, 'dm-authority.js'))
const promptAuthority = require(path.join(__dirname, 'scv-api-prompt-authority.js'))
const bookingPolicy = require(path.join(__dirname, 'scv-booking-policy.js'))
const policyContracts = require(path.join(__dirname, 'scv-policy-contracts.js'))
const stateSchema = require(path.join(__dirname, 'scv-structured-state-schema.js'))
const structuredOutput = require(path.join(__dirname, 'scv-structured-output-contract.js'))
const recovery = require(path.join(__dirname, 'scv-deterministic-recovery.js'))
const clock = require(path.join(__dirname, 'scv-clock.js'))
const tone = require(path.join(__dirname, 'scv-april-tone-regression.js'))
const realE2E = require(path.join(__dirname, 'scv-real-e2e-receipt.js'))
const PROMPT = fs.readFileSync(path.join(__dirname, 'lua-dm-master-prompt-v17.txt'), 'utf8')
const RUNNER_SRC = fs.readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
const AUTHORITY_SRC = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

function runScvApprovedConfigLock() {
  let checked = 0
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }
  const mk = (m) => ({ message: m, recent_history: [], structured_state: { live_turn_reply_required: true, booking_stage_hint: 'open_conversation' } })

  // 0. HARDENED POLICY / STATE / RELEASE CONTRACTS (Ben, 2026-07-25).
  //    These extend the existing firewall. They are not a second control plane.
  policyContracts.assertPolicyContractSemantics(policyContracts.POLICY_CONTRACTS)
  ok(
    policyContracts.POLICY_CONTRACTS_SHA256 ===
      'fb98093e90b0bcb0817f5686acf430a075f9eedce3ba787db7ffd17681e62aca',
    'approved_policy_contract_hash'
  )
  ok(
    stateSchema.STRUCTURED_STATE_SCHEMA_SHA256 ===
      '3385af6c6e830ce99a98da781403eb9aee2a3708af2d3afe5320302580abf7ac',
    'approved_structured_state_schema_hash'
  )
  ok(
    structuredOutput.STRUCTURED_OUTPUT_CONTRACT_VERSION ===
      'scv-structured-output-contract-2026-09-03-v3-action-bound-invalidated-checkpoint-reask',
    'approved_structured_output_contract_version'
  )
  ok(
    recovery.DETERMINISTIC_RECOVERY_VERSION ===
      'scv-explicit-verbatim-checkpoints-and-send-form-liveness-2026-08-25-v12-context-only-clarification',
    'approved_deterministic_recovery_version'
  )
  ok(
    clock.SCV_CLOCK_VERSION ===
      'scv-clock-2026-07-26-v1-single-prod-test-path',
    'approved_clock_single_prod_test_path'
  )
  ok(
    bookingPolicy.MINIMUM_LEAD_DAYS === 7 &&
      bookingPolicy.MAXIMUM_HORIZON_DAYS === null,
    'approved_booking_minimum_and_unbounded_horizon'
  )
  ok(
    policyContracts.POLICY_CONTRACTS.booking_policy.external_calendar_present === false &&
      policyContracts.POLICY_CONTRACTS.booking_policy.availability_source ===
        'minimum_date_plus_code_slots',
    'approved_no_external_calendar'
  )
  const toneFloor = tone.readAprilToneFloor()
  ok(
    toneFloor.calculated_sha256 ===
      '81ee1fe068c958c12b188b34ecfb947a388d627b395a4e2f014ac76b91233bd5',
    'approved_april_tone_floor_hash'
  )
  ok(
    realE2E.SCV_REAL_E2E_RECEIPT_SCHEMA_SHA256 ===
      'd77a5428bc9f5f0d1fc238d4786c6707b0706283e45452339a1b1d3e8bb87d23',
    'approved_real_instagram_e2e_receipt_schema_hash'
  )

  // 1. DELAY — first reply 3-12 min, hard-locked (restored from June's 20-60min drift)
  ok(pacing.DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS === 180000, 'approved_delay_min_3min', String(pacing.DEFAULT_NON_FAST_INITIAL_DELAY_MIN_MS))
  ok(pacing.DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS === 720000, 'approved_delay_max_12min', String(pacing.DEFAULT_NON_FAST_INITIAL_DELAY_MAX_MS))
  ok(pacing.SCV_DELIVERY_PACING_LOCK_VERSION === 'scv-delivery-pacing-lock-2026-07-04-v6-first-reply-3to12min', 'approved_pacing_lock_version', String(pacing.SCV_DELIVERY_PACING_LOCK_VERSION))

  // 2. MODEL RATE — lock the atomic fact, never a reusable outward sentence.
  //    The model authors fresh client-facing wording only after a direct price ask.
  ok(
    /amount:\s*150,\s*unit:\s*HOUR,\s*rate_type:\s*MODEL_DISCOUNT,\s*eligibility_code:\s*ARTIST_VISUAL_LANGUAGE_REQUIRED/i.test(PROMPT),
    'approved_rate_150_atomic_fact_present'
  )
  ok(!/\b200 per hour\b/i.test(PROMPT), 'approved_rate_200_absent')
  ok(/Do not mention price first/i.test(PROMPT), 'approved_price_only_when_asked')

  // 3. STUDIO ADDRESS — public, answered directly, never deposit-gated
  ok(harness.EXACT_ADDRESS === '10 Arkansas St San Francisco CA 94107', 'approved_exact_address', String(harness.EXACT_ADDRESS))
  ok(/10 Arkansas St San Francisco CA 94107/i.test(PROMPT), 'approved_address_in_prompt')
  ok(/never say the exact address comes only after deposit/i.test(PROMPT), 'approved_address_not_deposit_gated')

  // 4. CONVERGENCE HIERARCHY (Ben 2026-07-08): the BIG convergence is bestie-mode
  //    friendship; the tattoo funnel is the SMALL convergence behind THEIR signal.
  //    A plain greeting gets a social reply. Explicit info-asks are tattoo-door
  //    openers, but the old fixed opener script is retired; the model lane must
  //    write fresh human copy under the opener semantic contract.
  ok(runner.buildDeterministicOpenerPacket(mk('Hi, how are you doing?')) == null, 'approved_greeting_stays_social_no_opener')
  ok(runner.buildDeterministicOpenerPacket(mk('whats up')) == null, 'approved_whatsup_stays_social_no_opener')
  ok(harness.liveInfoAskOpener(mk('can i get more info?')) === true, 'approved_info_ask_detected')
  ok(runner.buildDeterministicOpenerPacket(mk('can i get more info?')) == null, 'approved_info_ask_uses_model_lane_no_fixed_script')
  ok(runner.buildDeterministicOpenerPacket(mk('i want a skull tattoo')) == null, 'approved_opener_not_on_idea')

  // 5. FORM CONSENT — robust (combos + Korean), questions excluded (LLM-intent + regex floor)
  ok(runner.isAffirmingFormPermission('okay sure') === true, 'approved_consent_okay_sure')
  ok(runner.isAffirmingFormPermission('yeah ok') === true, 'approved_consent_yeah_ok')
  ok(runner.isAffirmingFormPermission('주세요') === true, 'approved_consent_korean')
  ok(runner.isAffirmingFormPermission('how much is it?') === false, 'approved_consent_rejects_question')

  // 6. TWO VERBATIM BOOKING CHECKPOINTS present (four-field double-check, deposit handoff).
  //    The deprecated opener must stay rejected, not allowlisted.
  ok(/old 3-bubble opener greeting is retired/i.test(PROMPT), 'approved_opener_retired_prompt')
  ok(PROMPT.includes('Phone Number :'), 'approved_doublecheck_format')
  const depositJoined = harness.LOCKED_DEPOSIT_HANDOFF_BUBBLES.join('\n')
  ok(depositJoined.includes('contact@omarprotocol.com') && depositJoined.includes('This is my zelle!'), 'approved_deposit_handoff')

  // 6b. TEMPORAL/SIZE COLLISION — calendar and clock numbers must never become
  //     tattoo size state. Closed booking checkpoints bypass optional model intent
  //     classification and preserve the exact four-field adoption surface.
  ok(harness.textHasApproximateSizeSignal('August 1st around 2 pm would be perfect for me') === false, 'approved_calendar_clock_not_size')
  ok(harness.textHasApproximateSizeSignal('roughly 8 in or so') === true, 'approved_explicit_size_still_size')
  const temporalState = authority.annotateStructuredStateForLiveTurn(
    { text: 'August 1st around 2 pm would be perfect for me', instagram_username: 'omar.system' },
    {
      current_message_date_local: 'July 19, 2026',
      minimum_booking_date_local: 'July 26, 2026',
      form_offer_asked: true,
      form_link_sent: true,
      form_submitted: true,
      known_design_context: 'black and grey tiger',
      known_placement_context: 'upper arm',
      known_size_context: '',
      known_name_used_on_form: 'Omar Test One',
      known_phone_used_on_form: '4155550111',
      booking_stage_hint: 'awaiting_date'
    },
    [{ role: 'assistant', text: 'August 1st or 2nd around 2pm both work on my side which one feels better for you?' }]
  )
  ok(!String(temporalState.known_size_context || '').trim(), 'approved_calendar_clock_does_not_persist_size')
  const temporalPacket = runner.buildPreIntentDeterministicBookingPacket({
    message: 'August 1st around 2 pm would be perfect for me',
    recent_history: [{ role: 'assistant', text: 'August 1st or 2nd around 2pm both work on my side which one feels better for you?' }],
    structured_state: temporalState
  })
  ok(temporalPacket?.packet?.bubbles?.length === 1, 'approved_closed_booking_preintent_bypass')
  ok(
    temporalPacket?.packet?.bubbles?.[0]?.text === 'Name : Omar Test One\nPhone Number : 4155550111\nAppointment date : 1st of August\nTime : 2pm\n\ncan you double check this just to make sure',
    'approved_temporal_slot_exact_doublecheck',
    JSON.stringify(temporalPacket)
  )
  ok(
    runner.buildPreIntentDeterministicBookingPacket({
      message: 'i want a tiger wrapping around my arm',
      recent_history: [],
      structured_state: { booking_stage_hint: 'design_intake' }
    }) === null,
    'approved_open_design_preserves_model_lane'
  )

  // 7. TALEK-LUA CORE + HUMAN SURFACE injected (Ben directive)
  ok(PROMPT.includes('TALEK-LUA SELF-IDENTITY CORE'), 'approved_talek_lua_core_present')
  ok(PROMPT.includes('HUMAN SURFACE LOCK'), 'approved_human_surface_lock_present')
  // Ben directive 2026-07-07: the FULL Expression Quality Addendum, verbatim — no
  // trimmed sections (3.4/3.7/3.8 were silently missing once).
  ok(PROMPT.includes('3.4 Surface Calibration Examples'), 'approved_addendum_34_present')
  ok(PROMPT.includes('3.7 Outreach Rule'), 'approved_addendum_37_present')
  ok(PROMPT.includes('3.8 Internal-Term Translation'), 'approved_addendum_38_present')
  ok(PROMPT.includes('3.9 Final Expression Gate'), 'approved_addendum_39_present')
  const visibleReplyPrompt = runner.buildPrompt({
    message: 'can i get more info',
    recent_history: [],
    structured_state: { live_turn_reply_required: true }
  })
  const visibleReplyMessages = runner.buildOpenAIChatMessages(visibleReplyPrompt, { visibleReply: true })
  const exactPromptAuthority = promptAuthority.loadApiPromptAuthority({ root: __dirname })
  const visibleSystem = String(visibleReplyMessages[0]?.content || '')
  const v26Index = visibleSystem.indexOf(exactPromptAuthority.sources.v26.text)
  const identityIndex = visibleSystem.indexOf(exactPromptAuthority.sources.identity.text)
  const masterIndex = visibleSystem.indexOf(exactPromptAuthority.sources.dm_master.text)
  ok(visibleReplyMessages[0]?.role === 'system', 'approved_talek_lua_actual_system_role')
  ok(v26Index === 0, 'approved_v26_leads_system_role', String(v26Index))
  ok(identityIndex > v26Index, 'approved_exact_talek_identity_follows_v26', JSON.stringify({ v26Index, identityIndex }))
  ok(masterIndex > identityIndex, 'approved_full_master_prompt_follows_identity', JSON.stringify({ identityIndex, masterIndex }))
  ok(visibleSystem.includes('Recipient-Aware Surface Collapse'), 'approved_expression_core_in_system_role')
  ok(visibleSystem.includes('INSTAGRAM CLIENT VISIBLE SURFACE LOCK'), 'approved_instagram_surface_lock_in_system_role')
  ok(visibleReplyMessages[1]?.role === 'user', 'approved_untrusted_live_payload_user_role')
  ok(!visibleReplyMessages[1]?.content.includes('TALEK-LUA SELF-IDENTITY CORE'), 'approved_identity_not_duplicated_into_user_payload')
  const boundedMessages = runner.buildOpenAIChatMessages('classify this payload', { authorityPurpose: 'approved_config_probe' })
  const boundedSystem = String(boundedMessages[0]?.content || '')
  ok(boundedSystem.indexOf(exactPromptAuthority.sources.v26.text) === 0, 'approved_bounded_v26_leads_system_role')
  ok(boundedSystem.includes(exactPromptAuthority.sources.identity.text), 'approved_bounded_identity_internal')
  ok(!boundedSystem.includes(exactPromptAuthority.sources.dm_master.text.slice(0, 256)), 'approved_bounded_dm_master_excluded')
  ok(boundedSystem.includes('Persona stays internal'), 'approved_bounded_persona_output_off')
  ok(
    runner.detectGenericAiTone(
      { bubbles: [{ text: 'hey hey how are you doing' }] },
      { message: 'hi' }
    )?.label === 'duplicated hey opener',
    'approved_duplicate_hey_adoption_blocked'
  )
  ok(
    runner.detectGenericAiTone(
      { bubbles: [{ text: 'hey yeah i can help with that' }] },
      { message: 'can i get more info' }
    )?.label === 'habitual hey opener without client greeting',
    'approved_habitual_hey_adoption_blocked'
  )

  // 8. SOUL LOCK (Ben, 2026-07-07): June's drift rewrote the origin persona SILENTLY —
  //    bubbly service-bot injection, ask-first flipped to guess-first, anti-template
  //    law deleted — and nothing screamed because only mechanics had anchors. The
  //    restored 2026-04-20 origin soul is now anchor-locked. Persona evolution stays
  //    possible, but only as a deliberate commit that updates this lock in the same
  //    change — visible change yes, invisible drift no.
  ok(/slightly selective/.test(PROMPT), 'soul_selective_artist_identity_present')
  ok(/do NOT guess/.test(PROMPT), 'soul_ask_dont_guess_present')
  ok(PROMPT.includes('These are examples of direction not templates'), 'soul_anti_template_law_present')
  ok(/target frequency is very low around 5 percent/.test(PROMPT), 'soul_emoji_restraint_present')
  ok(!PROMPT.includes('GLOBAL SOCIAL ENERGY LOCK'), 'soul_bubbly_energy_section_absent')
  ok(!PROMPT.includes('SOCIAL HOSTING RULE'), 'soul_hosting_section_absent')
  ok(!/golden-retriever/.test(PROMPT), 'soul_golden_retriever_absent')
  ok(!/30 to 40 percent of positive or excited/.test(PROMPT), 'soul_exclamation_quota_absent')
  ok(!/if a reply feels emotionally dead add a little typed warmth/.test(PROMPT), 'soul_forced_warmth_absent')
  ok(PROMPT.includes('APRIL SOUL OVERLAY'), 'april_soul_overlay_present')
  ok(!/Everyone who DMs this account is a tattoo lead/.test(PROMPT), 'april_soul_no_everyone_lead_prompt')
  ok(!/Everyone who DMs is a tattoo lead/.test(RUNNER_SRC), 'april_soul_no_everyone_lead_runner')
  ok(!/golden-retriever/.test(RUNNER_SRC), 'april_soul_no_golden_retriever_runner')
  ok(!/golden_retriever/.test(AUTHORITY_SRC), 'april_soul_no_golden_retriever_authority_state')
  ok(!/commas and sentence periods are allowed/i.test(PROMPT), 'soul_old_comma_period_allowance_absent')
  ok(PROMPT.includes('- sentence commas are banned'), 'soul_sentence_comma_ban_present')
  ok(PROMPT.includes('- sentence ending full stops / periods are banned'), 'soul_terminal_period_ban_present')

  // 8b. ENGLISH-ONLY (Ben 2026-07-08: every client speaks English; output must always
  //     be English — the old 'Korean in -> Korean out' rule made the bot reply in
  //     Korean when whisper mis-transcribed accented English as Korean).
  ok(/ALWAYS reply in English/.test(PROMPT), 'english_only_output_lock_present')
  ok(!/Korean in -> Korean out/.test(PROMPT), 'old_korean_out_rule_removed')

  // 9. SOUL STONES (Ben stone doctrine, 2026-07-07: "한국에 있는 돌이랑 프랑스에 있는
  //    돌이 서로 상호작용을 안 하잖아"). Anchors are a guard watching the soul; stones
  //    remove the contact surface entirely. Each file in prompt-stones/ is one soul
  //    section, byte-exact. The live prompt must contain every stone VERBATIM — a
  //    single changed character anywhere in a soul section kills the build. Mechanics
  //    work has no reason to open prompt-stones/, so it physically cannot drift the
  //    soul; evolving a stone means editing the stone file itself — visible, deliberate.
  const stonesDir = path.join(__dirname, 'prompt-stones')
  const stoneFiles = fs.readdirSync(stonesDir).filter((f) => f.startsWith('stone-') && f.endsWith('.txt'))
  ok(stoneFiles.length >= 7, 'soul_stones_present', `found ${stoneFiles.length}`)
  for (const f of stoneFiles) {
    const stone = fs.readFileSync(path.join(stonesDir, f), 'utf8')
    ok(stone.trim().length > 0, `soul_stone_nonempty:${f}`)
    ok(PROMPT.includes(stone), `soul_stone_verbatim_in_prompt:${f}`)
  }

  return { ok: true, checked }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvApprovedConfigLock(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  }
}

module.exports = { runScvApprovedConfigLock }
