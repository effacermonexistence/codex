#!/usr/bin/env node
// ============================================================
// SCV ONE-SHOT LOCK HARNESS — Ben hard rule (2026-07-06): the form offer/link and
// the deposit-zelle handoff go out ONCE per account. The semantic contract flags
// repeats, so enforceOneShotCheckpoints is the deterministic semantic floor that
// rejects repeated checkpoint content. If rejection empties the draft, the packet
// is marked for model re-authoring; the controller must never invent fixed filler.
// Also guards: size/placement hard lock present in the prompt, deterministic
// deposit handoff never refires.
// ============================================================
const path = require('path')
const fs = require('fs')
const r = require(path.join(__dirname, 'codex-dm-runner.js'))

const FORM = 'https://www.effacermonexistence.com/apply'

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

function runScvOneShotLockHarness() {
  let checked = 0
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }
  const A = (text) => ({ role: 'assistant', text })
  const mk = (live, history = [], state = {}) => ({
    message: live,
    recent_history: history,
    structured_state: { live_turn_text: live, ...state }
  })
  const pkt = (...texts) => ({ bubbles: texts.map((t) => ({ text: t, delay_ms: 0 })) })

  // 1. FORM ONE-SHOT: form already sent -> a repeat offer/link is stripped.
  const sentHist = [A(`here you go ${FORM} lmk once its in!`)]
  let out = r.enforceOneShotCheckpoints(mk('what do you think?', sentHist), pkt('love it!!', `want me to send the form over so we can set it up?`))
  ok(out.bubbles.length === 1 && out.bubbles[0].text === 'love it!!', 'repeat_form_offer_stripped', JSON.stringify(out.bubbles))

  out = r.enforceOneShotCheckpoints(mk('sounds good', sentHist), pkt(`here is the form again ${FORM}`))
  ok(!out.bubbles.some((b) => b.text.includes(FORM)), 'repeat_form_link_stripped', JSON.stringify(out.bubbles))
  ok(out.bubbles.length === 0, 'stripped_empty_stays_non_authored', JSON.stringify(out.bubbles))
  ok(
    out.non_authoring_surface_mutations?.includes('one_shot_checkpoint_violation'),
    'stripped_empty_requires_model_reauthor',
    JSON.stringify(out)
  )

  // 1b. VERIFIER-NET ALIGNMENT (live 2026-07-29, contact 1955263859, 50+ silent
  //     retry cycles): re-offer wording the verifier flags (packetAsksFormPermission:
  //     "i can send you the form…") but the local shapes miss must be stripped here
  //     too, and the rest of the answer — the pricing bubble — must survive.
  out = r.enforceOneShotCheckpoints(
    mk('what would you charge for something like that?', sentHist),
    pkt(
      'the rate is 150 an hour and it applies when the piece stays in my style and visual language',
      'i can send you the form whenever you are ready'
    )
  )
  ok(
    out.bubbles.length === 1 && /150/.test(out.bubbles[0].text),
    'verifier_net_offer_stripped_pricing_answer_survives',
    JSON.stringify(out.bubbles)
  )
  ok(
    out.non_authoring_surface_mutations?.includes('one_shot_checkpoint_violation'),
    'verifier_net_strip_marks_reauthor',
    JSON.stringify(out)
  )

  // 2. Explicit re-request allows the resend.
  out = r.enforceOneShotCheckpoints(mk('can you send the form again? i lost it', sentHist), pkt(`ofc! ${FORM}`))
  ok(out.bubbles.some((b) => b.text.includes(FORM)), 'explicit_form_request_allows_resend')
  out = r.enforceOneShotCheckpoints(mk('resend', sentHist, { live_turn_form_link_resend_requested: true }), pkt(`${FORM}`))
  ok(out.bubbles.some((b) => b.text.includes(FORM)), 'resend_flag_allows_resend')
  // 2b. Resend intent WITHOUT the word "form" must also deliver (live bug: "asked for
  //     the form and nothing came" — the strip ate the link on these turns).
  for (const ask of ['can you send it again', 'i didnt get it', 'wheres it?', 'it didnt work', 'never got anything', '다시 보내줘']) {
    out = r.enforceOneShotCheckpoints(mk(ask, sentHist), pkt(`here! ${FORM}`))
    ok(out.bubbles.some((b) => b.text.includes(FORM)), `resend_intent_allows_link:${ask.slice(0, 14)}`, JSON.stringify(out.bubbles))
  }

  // 2c. RESEND-OFFER NAGS (라이브 누출 2026-07-08, 3턴 연속): 링크 나간 뒤 봇발
  //     상태 질문/재전송 오퍼는 재오퍼 = 스트립. 승인된 모양은 서술문 "lmk once it's in".
  for (const nag of [
    'have you gotten the form in yet or should i resend it',
    'and did you get the form yet or want me to send it again',
    'if you’ve got the form in yet or need me to resend'
  ]) {
    out = r.enforceOneShotCheckpoints(mk('what do you think?', sentHist), pkt('love the ref!!', nag))
    ok(out.bubbles.length === 1 && out.bubbles[0].text === 'love the ref!!', `resend_nag_stripped:${nag.slice(0, 22)}`, JSON.stringify(out.bubbles))
  }
  // 서술문 리마인드와 유저 요청 재전송은 그대로 살아야 함.
  out = r.enforceOneShotCheckpoints(mk('nice', sentHist), pkt('lmk once it’s in and throw me a couple dates'))
  ok(out.bubbles.length === 1, 'statement_reminder_untouched', JSON.stringify(out.bubbles))

  // 3. First-ever offer is untouched.
  out = r.enforceOneShotCheckpoints(mk('i want a rose piece', []), pkt('cute!! want me to send the form over?'))
  ok(out.bubbles.length === 1 && /form/.test(out.bubbles[0].text), 'first_offer_untouched')

  // 3b. CRITICAL: consent to a PENDING offer (offer asked, link NOT yet sent) must still
  //     deliver the link — one-shot blocks re-asking/re-sending, not first fulfillment.
  const offeredHist = [A('sick idea!! want me to send the form so we can get you set up?')]
  out = r.enforceOneShotCheckpoints(mk('yeah sure send it over', offeredHist), pkt(`sweet! ${FORM} lmk once its in`))
  ok(out.bubbles.some((b) => b.text.includes(FORM)), 'consent_after_offer_keeps_link', JSON.stringify(out.bubbles))
  // ...but a REPEAT offer question in the same situation is still stripped.
  out = r.enforceOneShotCheckpoints(mk('hmm maybe', offeredHist), pkt('no rush!', 'want me to send the form over?'))
  ok(out.bubbles.length === 1 && out.bubbles[0].text === 'no rush!', 'repeat_offer_question_stripped_when_pending', JSON.stringify(out.bubbles))

  // 4. DEPOSIT ONE-SHOT: zelle handoff already out -> model repeat stripped; user asking again allowed.
  const zelleHist = [A('To confirm your appointment the deposit would be 100.'), A('This is my zelle!'), A('contact@omarprotocol.com'), A('Once you send it just let me know so I can double check everything on my side and confirm your appointment on my calendar! I will be waiting:3')]
  out = r.enforceOneShotCheckpoints(mk('ok!', zelleHist), pkt('sweet!', 'deposit is 100 and my zelle is contact@omarprotocol.com'))
  ok(out.bubbles.length === 1 && out.bubbles[0].text === 'sweet!', 'repeat_deposit_handoff_stripped', JSON.stringify(out.bubbles))
  out = r.enforceOneShotCheckpoints(mk('wait what was the zelle again?', zelleHist), pkt('contact@omarprotocol.com'))
  ok(out.bubbles.some((b) => /omarprotocol/.test(b.text)), 'explicit_zelle_question_allows_repeat')

  // 5. The locked atomic handoff packet itself is exempt (fires once via its own guarded lane).
  const atomic = { authority_transport_flags: { atomic_deposit_handoff: true }, bubbles: [{ text: 'This is my zelle!', delay_ms: 0 }] }
  out = r.enforceOneShotCheckpoints(mk('yes correct', zelleHist), atomic)
  ok(out.bubbles.length === 1 && out.bubbles[0].text === 'This is my zelle!', 'atomic_handoff_exempt')

  // 6. Deterministic handoff refire guard + detection helpers.
  ok(r.depositHandoffAlreadySent(mk('x', zelleHist)) === true, 'handoff_detected_in_history')
  ok(r.depositHandoffAlreadySent(mk('x', [])) === false, 'no_handoff_no_detection')
  ok(r.formAlreadyOfferedOrSent(mk('x', sentHist)) === true, 'form_link_detected_in_history')
  ok(r.formAlreadyOfferedOrSent(mk('x', [], { form_offer_asked: true })) === true, 'form_offer_state_detected')
  const src = fs.readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
  ok(/doubleCheckConfirmationContext\(input\) && !depositHandoffAlreadySent\(input\)/.test(src), 'deterministic_handoff_refire_guarded')
  ok(/packet = enforceOneShotCheckpoints\(input, packet\)/.test(src), 'one_shot_enforced_on_final_packet')

  // 7. SIZE/PLACEMENT HARD LOCK present in prompt (never ask/estimate size, in-person, move on).
  ok(/SIZE \/ PLACEMENT HARD LOCK/.test(src) && /NEVER ask what size or placement/.test(src) && /dialed in precisely in person/.test(src), 'size_placement_hard_lock_present')

  // 8. SIZE/PLACEMENT CLASS-KILL (Ben: "또 regex 넓히고 또 새는 루프가 싫다"): asking
  //    shape × size/placement lexicon dies REGARDLESS of phrasing — including the exact
  //    bubble that shipped live to a real lead (2026-07-07T01:06 UTC, pre-strip).
  const askBattery = [
    'what size were you thinking and do you have a day in mind to get it done',
    "what's the size you're going for",
    'how many inches are we talking',
    'what sizing did you have in mind',
    'did you decide on placement',
    'which arm do you want it on',
    'forearm or upper arm?',
    'lmk what size works best',
    'size?',
    'how big r we talking',
    'u thinking small or a bigger piece?',
    'where were you thinking of putting it',
    'whereabouts on your body',
    'got a size in mind',
    'any placement ideas?',
    // 라이브 누출 2026-07-08T01:07 (omar.system 클린런에서 발사됨): bare 'body'가
    // lexicon에 없어서 샜다 — 어휘 1단어 추가로 계열 폐쇄.
    'you thinking anywhere on the body yet or just throwing the idea out there',
    'got a spot anywhere in mind',
    // strict semantics: even a statement+tag-question touching size dies — the bot can
    // put "sound good?" in its own bubble instead.
    'we can dial in the exact size and placement in person, sound good?'
  ]
  for (const q of askBattery) ok(r.bubbleAsksSizeOrPlacement(q), `size_ask_dies:${q.slice(0, 20)}`)

  const stmtBattery = [
    'exact sizing can stay flexible and we’ll dial it in when you’re here',
    'small to medium sounds like a solid sweet spot',
    'will do, exact size stays flexible till youre here',
    'want me to send the form so you can confirm a spot for when you get back?',
    'that would look sick on the forearm',
    'we can go bigger or smaller on the day, no stress',
    'the sizing and exact spot get dialed in person since chat\u2019s tricky for that',
    'it will sit clean on the body'
  ]
  for (const s of stmtBattery) ok(!r.bubbleAsksSizeOrPlacement(s), `size_statement_passes:${s.slice(0, 20)}`)

  // 8b. All-bubbles-violating packet must NOT fail open (single-bubble "what size?"
  //     used to ship untouched). It stays empty and explicitly requests model
  //     re-authoring rather than substituting a canned in-person fallback.
  out = r.enforceSizePlacementLock(mk('cool', []), pkt('what size were you thinking'))
  ok(out.bubbles.length === 0, 'all_stripped_stays_non_authored', JSON.stringify(out.bubbles))
  ok(
    out.non_authoring_surface_mutations?.includes('size_or_placement_question_violation'),
    'all_stripped_requires_model_reauthor',
    JSON.stringify(out)
  )

  // 9. NAME SANITIZER: confirmation tokens must not ride into the double-check name
  //    (live: "Name : Oki Leticia W" shipped after the lead typed "Oki\nLeticia W").
  ok(r.sanitizeLeadName('Oki Leticia W') === 'Leticia W', 'name_ack_prefix_stripped', r.sanitizeLeadName('Oki Leticia W'))
  ok(r.sanitizeLeadName('yes! John Smith') === 'John Smith', 'name_yes_prefix_stripped')
  ok(r.sanitizeLeadName('ok sure its Maria Lopez') === 'Maria Lopez', 'name_stacked_ack_stripped')
  ok(r.sanitizeLeadName('Oki') === 'Oki', 'bare_ack_like_name_kept')
  ok(r.sanitizeLeadName('Yara Kim') === 'Yara Kim', 'real_name_untouched')
  ok(r.sanitizeLeadName('Beth Okafor') === 'Beth Okafor', 'ack_like_substring_names_untouched')

  // 10. DESIGN-INTERVIEW LOCK (라이브 2026-07-08: "what part of this vibe do you wanna
  //     lean into the most" — 스타일은 항상 아티스트 스타일; 폼 이후 인터뷰 금지).
  out = r.enforceDesignInterviewLock(mk('sent a reference post: a profile screenshot', sentHist), pkt('cool ref!!', 'what part of this vibe do you wanna lean into the most'))
  ok(out.bubbles.length === 1 && out.bubbles[0].text === 'cool ref!!', 'postform_design_interview_stripped', JSON.stringify(out.bubbles))
  out = r.enforceDesignInterviewLock(mk('sent a photo', []), pkt('tell me the vibe you’re going for 🖤'))
  ok(out.bubbles.length === 1, 'preform_idea_invitation_untouched')
  ok(!r.bubbleAsksDesignInterview('just tell me the vibe you’re going for'), 'invitation_not_interview')
  ok(!r.bubbleAsksDesignInterview('which day were you thinking about for the appointment'), 'date_question_unaffected')
  ok(/packet = enforceDesignInterviewLock\(input, packet\)/.test(src), 'design_interview_enforced_on_final_packet')
  // 10b. COLD REFERENCE (감사 2026-08-02: 참고 사진만 툭 보낸 리드에게 "which part or
  //      element are you thinking about" — 매처는 잡는데 게이트가 안 열려서 나갔다.
  //      사전 설명 메시지가 없어도 참고 이미지가 오면 인터뷰는 금지다.)
  const coldRef = { structured_state: { tattoo_intent_active: true, known_tattoo_reference_media_received: true } }
  out = r.enforceDesignInterviewLock(coldRef, pkt("there's a lot going on in this pic", 'which part or element are you thinking about for your tattoo'))
  ok(out.bubbles.length === 1 && !/which part/i.test(out.bubbles[0].text), 'cold_reference_design_interview_stripped', JSON.stringify(out.bubbles))
  // 필수 DESIGN_INTAKE 질문은 잠금이 걸린 상태에서도 살아남아야 한다.
  out = r.enforceDesignInterviewLock(coldRef, pkt('do you have an idea in mind for the tattoo'))
  ok(out.bubbles.length === 1, 'cold_reference_intake_ask_survives', JSON.stringify(out.bubbles))
  out = r.enforceDesignInterviewLock({ structured_state: {} }, pkt('what kind of tattoo are you thinking about'))
  ok(out.bubbles.length === 1, 'no_reference_intake_ask_untouched')

  // 11. AUTHORITY MEDIA CONTEXT (라이브 2026-07-08: 보이스 "I just submitted"이 결정론
  //     상태에 영구화 안 됨 → 두 턴 뒤 재질문). 상태 조립 전 해석 배선이 살아있어야 함.
  ok(fs.existsSync(path.join(__dirname, 'scv-media-context-resolver.js')), 'media_resolver_exists')
  const authSrc = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')
  ok(/resolveMonotonicInboundMediaContext\(msg, recentHistory/.test(authSrc), 'authority_resolves_media_monotonically_before_state')
  ok(/selectAuthoritativeMediaText/.test(authSrc), 'authority_blocks_media_context_downgrade')
  ok(/media_context_resolved: mediaContext \? true : false/.test(authSrc), 'runner_input_carries_resolved_flag')
  ok(/input\?\.media_context_resolved === true\) return/.test(src), 'runner_skips_double_resolution')
  const mediaResolverSrc = fs.readFileSync(path.join(__dirname, 'scv-media-context-resolver.js'), 'utf8')
  ok(/voice_transcribe_failed = st\.live_turn_voice_transcribe_failed === true/.test(mediaResolverSrc), 'media_resolver_exports_voice_rejection_state')
  ok(/mediaContext\.voice_transcribe_failed === true\) state\.live_turn_voice_transcribe_failed = true/.test(authSrc), 'authority_adopts_voice_rejection_state')

  // 12. GMAIL FRICTION-KILL FLOOR (라이브 2026-07-08: 실제 폼 제출했는데 이름/전화
  //     요청 발사 — 병목). 제출전/자동주입후 요청은 물리 차단, 생존창(제출주장+
  //     장부무매칭)만 허용, 더블체크 4줄 서술은 무사.
  out = r.enforceNamePhoneAskLock(mk('sounds good', []), pkt('july 14 at 2pm works for you then', 'just need the name and phone number you used on the form so i can line everything up'))
  ok(!out.bubbles.some((b) => /name and phone/.test(b.text)), 'preSubmit_namephone_ask_stripped', JSON.stringify(out.bubbles))
  out = r.enforceNamePhoneAskLock(mk('done!', [], { form_submitted: true, known_name_used_on_form: 'x', known_phone_used_on_form: 'y' }), pkt('send me the name and phone you used on the form'))
  ok(!out.bubbles.some((b) => /name/.test(b.text)), 'postAutofill_namephone_ask_stripped')
  out = r.enforceNamePhoneAskLock(mk('i submitted', [], {
    form_link_sent: true,
    form_submitted: true,
    live_turn_form_submitted_signal: true,
    accepted_offered_date: 'july 14',
    accepted_offered_time: '2pm'
  }), pkt('can you send me the name and phone you used on the form'))
  ok(out.bubbles.length === 1 && /name/.test(out.bubbles[0].text), 'survival_window_allows_ask')
  out = r.enforceNamePhoneAskLock(mk('ok', [], { form_submitted: true, known_name_used_on_form: 'x', known_phone_used_on_form: 'y' }), pkt('Name : t\nPhone Number : p\nAppointment date : d\nTime : t'))
  ok(out.bubbles.length === 1 && /Phone Number/.test(out.bubbles[0].text), 'doublecheck_lines_untouched')
  ok(/packet = enforceNamePhoneAskLock\(input, packet\)/.test(src), 'namephone_lock_enforced_on_final_packet')
  const authSrc2 = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')
  ok(/handle_match_only: !submittedSignal/.test(authSrc2), 'gmail_autofill_proactive_with_handle_gate')
  ok(!/mode:\s*'single_unclaimed'/.test(authSrc2), 'single_unclaimed_identity_fallback_absent')
  ok(/require_after_link: testAccount/.test(authSrc2), 'debug_account_all_gmail_adoption_current_link_only')

  // 13. FUNNEL-ORDER FLOOR (Ben 2026-07-08 live: "what do you mean by model?" got a
  //     volunteered rate + form offer + date ask with ZERO design idea). Order is
  //     design -> form -> date; premature pushes die until a design direction exists.
  const modelMk = (live, st) => ({ message: live, recent_history: [{ role: 'user', text: live }], structured_state: { live_turn_text: live, ...(st || {}) } })
  out = r.enforceFunnelOrderLock(modelMk('what do you mean by model?'), pkt(
    'the model thing means i only open a few spots for pieces that fit my style',
    'if you want i can send over the form so you can grab one if it feels right',
    'also what day were you thinking about for the appointment?'
  ))
  ok(out.bubbles.length === 1 && /model thing means/.test(out.bubbles[0].text), 'premature_form_and_date_stripped_no_design', JSON.stringify(out.bubbles.map((b) => b.text)))
  out = r.enforceFunnelOrderLock(modelMk('what do you mean by model?'), pkt('model is exclusive spots', 'the rate is a moderate discount at 150 an hour'))
  ok(!out.bubbles.some((b) => /150/.test(b.text)), 'volunteered_rate_stripped_when_price_not_asked')
  out = r.enforceFunnelOrderLock(modelMk('how much per hour?', { live_turn_pricing_question: true }), pkt('its 150 an hour for model work'))
  ok(out.bubbles.some((b) => /150/.test(b.text)), 'asked_price_rate_passes')
  out = r.enforceFunnelOrderLock(modelMk('i want a skull piece in black and grey', { known_design_context: 'skull black and grey' }), pkt('love that!', 'want me to send the form?'))
  ok(out.bubbles.some((b) => /form/.test(b.text)), 'design_present_form_offer_passes')
  out = r.enforceFunnelOrderLock(modelMk('yes july 15', { known_requested_date: 'july 15' }), pkt('july 15 works!', 'what time works for you?'))
  ok(out.bubbles.length === 2, 'booking_advanced_untouched')
  ok(/packet = enforceFunnelOrderLock\(input, packet\)/.test(src), 'funnel_order_enforced_on_final_packet')

  // 13b. VOICE-NOTE turns must NOT read as a design direction (Ben live 2026-07-08):
  //      history 'sent a reference post' (a voice-note mislabel) once exempted the
  //      floor via threadHasDesignDirection. Structured signals only now.
  ok(r.threadHasDesignDirection({ structured_state: {} }) === false, 'empty_state_no_design_direction')
  ok(r.threadHasDesignDirection({ structured_state: { known_reference_media_received: true } }) === true, 'described_reference_is_design_direction')
  ok(r.threadHasDesignDirection({ structured_state: { known_design_context: 'skull black and grey' } }) === true, 'known_design_is_design_direction')
  // the exact live leak: no design signals set -> floor fires on the date-ask
  const vnLeakInput = {
    message: 'sent a voice note saying: what do you mean by model',
    structured_state: { live_turn_text: 'sent a voice note saying: what do you mean by model' }
  }
  const vnLeak = r.enforceFunnelOrderLock(vnLeakInput, pkt('okay so you asked about moral right? what part of that were you thinking about?', 'also to get your spot nailed down what day and time were you thinking for your tattoo?'))
  ok(vnLeak.bubbles.length === 0, 'voice_only_forbidden_moves_strip_to_empty_without_fixed_copy', JSON.stringify(vnLeak.bubbles.map((b) => b.text)))
  ok(r.verifyPostFilterAdoption(vnLeakInput, vnLeak).valid === false, 'empty_post_filter_packet_requires_model_reauthor')

  // 14. ASR DOMAIN-TERM REPAIR (Ben live 2026-07-08: Korean-accented "model" ->
  //     whisper "moral" -> bot treated it as a design topic). Repair model-homophones
  //     in model-context only; leave ordinary 'moral' alone.
  const modelOfferRepairContext = mk('sent a voice note', [A('i have a few model spots for tattoos in my own style')], { live_turn_is_voice_note: true })
  ok(r.repairAsrDomainTerms('what do you mean by moral?', modelOfferRepairContext) === 'what do you mean by model?', 'asr_moral_to_model_clarify')
  ok(r.repairAsrDomainTerms('how do the moral spots work', modelOfferRepairContext) === 'how do the model spots work', 'asr_moral_spots_to_model')
  ok(r.repairAsrDomainTerms('what is the motto rate', modelOfferRepairContext) === 'what is the model rate', 'asr_motto_rate_to_model')
  ok(r.repairAsrDomainTerms('what do you mean by moto?', modelOfferRepairContext) === 'what do you mean by model?', 'asr_moto_to_model_clarify')
  ok(r.repairAsrDomainTerms('the moral of the story is') === 'the moral of the story is', 'asr_real_moral_untouched')
  ok(r.repairAsrDomainTerms('thats morally wrong') === 'thats morally wrong', 'asr_morally_untouched')
  const typedMottoInput = r.repairIncomingDomainTermsForInterpretation({
    message: 'i saw your ad what do you mean by motto?',
    live_message: 'i saw your ad what do you mean by motto?',
    structured_state: { live_turn_text: 'i saw your ad what do you mean by motto?' }
  })
  ok(
    typedMottoInput.live_message === 'i saw your ad what do you mean by model?' &&
      typedMottoInput.message === 'i saw your ad what do you mean by model?' &&
      typedMottoInput.structured_state.live_turn_contextual_text_repair === 'model_term_clarification',
    'typed_model_homophone_is_repaired_for_runner_interpretation'
  )
  const ordinaryMottoInput = r.repairIncomingDomainTermsForInterpretation({
    message: 'my motto is keep going',
    live_message: 'my motto is keep going',
    structured_state: { live_turn_text: 'my motto is keep going' }
  })
  ok(ordinaryMottoInput.live_message === 'my motto is keep going', 'ordinary_motto_is_not_rewritten')
  // The live "Shorting" failure is now a regression row, not a word-replacement
  // architecture. Two audio candidates are selected by conversation fit; the
  // resolver can only adopt one exact candidate or reject the turn.
  const formOfferContext = mk('sent a voice note', [A('want me to send the form so we can get it rolling?')], { live_turn_is_voice_note: true, booking_stage_hint: 'awaiting_form_permission_answer' })
  const liveCandidates = [
    { model: 'gpt-4o-mini-transcribe', text: 'Shorting' },
    { model: 'gpt-4o-transcribe', text: 'Sure thing.' }
  ]
  let asr = r.applyAsrCandidateAdjudication(liveCandidates, formOfferContext)
  ok(asr.needs_adjudication === true, 'asr_divergent_candidates_require_context_adjudication')
  asr = r.applyAsrCandidateAdjudication(liveCandidates, formOfferContext, { candidate_index: 2, confidence: 'high', context_fit: true })
  ok(asr.ok === true && asr.text === 'Sure thing.', 'asr_live_failure_selects_exact_context_fit_candidate', JSON.stringify(asr))
  ok(r.isAffirmingFormPermission(asr.text) === true, 'adjudicated_asr_consent_unlocks_form_fulfillment')
  ok(r.repairAsrDomainTerms('Shorting', formOfferContext) === 'Shorting', 'asr_shorting_has_no_special_case_rewrite')

  // Inductive/general row: an unrelated future ASR split at a different stage is
  // handled by the same selector without adding either phrase to a dictionary.
  const styleContext = mk('sent a voice note', [A('were you thinking black and gray or color for this one?')], { live_turn_is_voice_note: true, booking_stage_hint: 'design_consult' })
  const futureCandidates = [
    { model: 'gpt-4o-mini-transcribe', text: 'Back in the grade.' },
    { model: 'gpt-4o-transcribe', text: 'Black and gray.' }
  ]
  asr = r.applyAsrCandidateAdjudication(futureCandidates, styleContext, { candidate_index: 2, confidence: 'high', context_fit: true })
  ok(asr.ok === true && asr.text === 'Black and gray.', 'asr_unseen_error_family_uses_same_context_selector', JSON.stringify(asr))
  asr = r.applyAsrCandidateAdjudication(futureCandidates, styleContext, { candidate_index: 0, confidence: 'low', context_fit: false })
  ok(asr.ok === false, 'asr_unresolved_conflict_fails_closed')

  // Independent dual consensus is adopted directly. A single surviving transcript
  // is context-gated instead of becoming truth merely because the other model failed.
  const consensusCandidates = [
    { model: 'gpt-4o-mini-transcribe', text: 'Sounds good.' },
    { model: 'gpt-4o-transcribe', text: 'Sounds good!' }
  ]
  asr = r.applyAsrCandidateAdjudication(consensusCandidates, styleContext)
  ok(asr.ok === true && asr.text === 'Sounds good.' && asr.method === 'dual_consensus', 'asr_dual_consensus_is_independent_evidence_gate')
  asr = r.applyAsrCandidateAdjudication([{ model: 'gpt-4o-transcribe', text: 'Sounds good.' }], styleContext)
  ok(asr.needs_adjudication === true, 'asr_single_survivor_requires_context_fit')
  const previousTranscribeModel = process.env.SCV_TRANSCRIBE_MODEL
  delete process.env.SCV_TRANSCRIBE_MODEL
  ok(r.effectiveTranscribeModel() === 'gpt-4o-mini-transcribe', 'asr_default_model_is_high_fidelity_transcribe')
  if (previousTranscribeModel === undefined) delete process.env.SCV_TRANSCRIBE_MODEL
  else process.env.SCV_TRANSCRIBE_MODEL = previousTranscribeModel
  ok(/await Promise\.all\(\[\s*transcribeInboundAudio\(buf, mime, \{ model: primaryModel \}\)/.test(src), 'asr_dual_transcription_wired_in_parallel')
  ok(/const resolved = await resolveAsrCandidates\(rawCandidates, input\)/.test(src), 'asr_context_resolver_wired_into_voice_adoption')
  ok(/Do not repair, paraphrase, merge, or invent any transcript/.test(src), 'asr_adjudicator_is_exact_candidate_only')

  // 15. PRE-FORM DESIGN INTERVIEW (Ben live 2026-07-08: 'what part of that reference
  //     are you feeling the most for your tattoo?' escaped every gate — the design-
  //     interview lock is form-gated, the funnel floor didn't cover interviews).
  ok(r.bubbleAsksDesignInterview('hey what part of that reference are you feeling the most for your tattoo?'), 'wide_design_interview_caught')
  ok(!r.bubbleAsksDesignInterview('just tell me any idea or vibe you have and we go from there'), 'open_idea_invitation_not_interview')
  ok(r.bubbleIsBroadOpenDesignIntake('what kind of vibe or piece have you been thinking about?'), 'broad_open_design_intake_classified')
  ok(!r.bubbleIsBroadOpenDesignIntake('what part of that reference are you feeling the most?'), 'detailed_existing_reference_probe_not_open_intake')
  const broadIntake = r.enforceFunnelOrderLock({ structured_state: {} }, pkt('you can use the highlights as inspo', 'what kind of vibe or piece have you been thinking about?'))
  ok(broadIntake.bubbles.length === 2, 'broad_open_design_intake_survives_preform_funnel', JSON.stringify(broadIntake.bubbles.map((b) => b.text)))
  const dInt = r.enforceFunnelOrderLock({ structured_state: {} }, pkt('glad youre doing great!!!', 'hey what part of that reference are you feeling the most for your tattoo?'))
  ok(dInt.bubbles.length === 1 && !/what part/i.test(dInt.bubbles[0].text), 'preform_design_interview_stripped_no_design', JSON.stringify(dInt.bubbles.map((b) => b.text)))
  const dIntOk = r.enforceFunnelOrderLock({ structured_state: { known_design_context: 'skull black and grey' } }, pkt('love it', 'what part of the skull vibe are you feeling most'))
  ok(dIntOk.bubbles.length === 2, 'design_present_interview_passes_consult')

  // 16. TRANSCRIPT VERIFIER (Ben REVAS 2026-07-08: 'where is the verifier?'). Wrong-
  //     language whisper output is REJECTED at the adoption gate, not adopted.
  ok(r.verifyTranscript('what do you mean by model').ok === true, 'verifier_accepts_english')
  ok(r.verifyTranscript('뭐라고 말하는거지?').ok === false, 'verifier_rejects_korean_gibberish')
  ok(r.verifyTranscript('tattoo 문의 있어요').ok === false, 'verifier_rejects_korean_dominant')
  ok(r.verifyTranscript('').ok === false, 'verifier_rejects_empty')
  ok(r.verifyTranscript('ok').ok === true, 'verifier_accepts_short_english')
  // Voice we could not make out -> give the model semantic resend/type guidance,
  // never a client-visible canned sentence, and never invent a reference/design.
  const vfLock = r.buildAiVisibleRouteLock({ structured_state: { live_turn_voice_transcribe_failed: true } })
  ok(
    /voice note we could not make out/i.test(vfLock) &&
    /ask for either a resend or typed text/i.test(vfLock) &&
    /authored for this turn/i.test(vfLock) &&
    /No supplied sentence is a template/i.test(vfLock),
    'voice_fail_routes_to_model_authored_ask_repeat'
  )
  ok(/NEVER call it a reference/i.test(vfLock), 'voice_fail_forbids_reference_invention')
  ok(/const verdict = verifyTranscript\(rawText\)/.test(src), 'verifier_wired_before_candidate_adoption')

  // 17. BOOKING-TIME DATE-ASK CLASS (Ben live 2026-07-08: 'have you thought about
  //     when you might want to come in yet?' escaped — 'come in' wasn't a date word).
  for (const q of ['have you thought about when you might want to come in yet?', 'when do you wanna come through?', 'want me to get you in this week?', 'when do you want to get it done?', 'have you thought about when you want to book?']) {
    ok(r.bubbleAsksForDate(q), `booking_time_ask_caught:${q.slice(0, 22)}`)
  }
  for (const s of ['so what kind of idea or vibe are you feeling?', 'the flashes are in my highlights for inspo', 'i can make that look amazing for you']) {
    ok(!r.bubbleAsksForDate(s), `non_date_line_not_flagged:${s.slice(0, 20)}`)
  }
  const cInLeak = r.enforceFunnelOrderLock({ structured_state: {} }, pkt('hey you doing alright over there?', 'have you thought about when you might want to come in yet?'))
  ok(cInLeak.bubbles.length === 1 && !/come in/i.test(cInLeak.bubbles[0].text), 'greeting_turn_come_in_stripped', JSON.stringify(cInLeak.bubbles.map((b) => b.text)))
  // 17b. STALE FORM AUTOFILL must not unlock scheduling by itself. Live 2026-07-08:
  //      omar.system sent a voice/social greeting, Gmail autofill marked an old form
  //      submitted, and the funnel-order floor exempted the date ask via
  //      form_submitted=true. Form submitted alone is NOT design direction and does
  //      NOT settle consultation order.
  const staleFormGreetingLeak = r.enforceFunnelOrderLock(
    { structured_state: { form_submitted: true, live_turn_text: 'sent a voice note saying: Hey, um, how are you doing?' } },
    pkt('hey you doing alright over there?', 'have you thought about when you might want to come in yet?')
  )
  ok(staleFormGreetingLeak.bubbles.length === 1 && !/come in|when/i.test(staleFormGreetingLeak.bubbles[0].text), 'stale_form_social_greeting_date_ask_stripped', JSON.stringify(staleFormGreetingLeak.bubbles.map((b) => b.text)))

  return { ok: true, checked }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvOneShotLockHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  }
}

module.exports = { runScvOneShotLockHarness }
