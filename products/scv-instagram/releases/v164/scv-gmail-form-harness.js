#!/usr/bin/env node
// ============================================================
// SCV GMAIL FORM HARNESS — the friction kill must be lossless and safe.
//
// Guards: (1) Squarespace notification parsing extracts name/phone/instagram from
// realistic layouts; (2) junk never parses into fake identities; (3) the ledger
// claim logic matches by instagram handle/corroborated thread evidence, never uses
// queue cardinality as identity, never steals another thread's claim, and respects
// the age/current-form-link window; (4) dm-authority
// auto-fills known_name/phone ONLY on a submitted signal and never overwrites
// values that already exist; (5) boot wiring (poller spawned, dir on the volume).
// ============================================================
const path = require('path')
const fs = require('fs')
const os = require('os')
const { spawnSync } = require('child_process')
const reader = require(path.join(__dirname, 'scv-gmail-form-reader.js'))
const authority = require(path.join(__dirname, 'dm-authority.js'))
const transition = require(path.join(__dirname, 'scv-closed-transition-contract.js'))

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

function runScvGmailFormHarness() {
  let checked = 0
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }

  // 1. Squarespace-style plain text notification.
  const plain = `You have a new form submission.\n\nName: Benny Kim\nEmail: benny@x.com\nPhone: (415) 760-2883\nInstagram: @benny.ink\nWhat do you want?: snake dagger forearm\n`
  let p = reader.parseFormEmail(plain)
  ok(p && p.name === 'Benny Kim', 'plain_name_parsed', JSON.stringify(p))
  ok(p.phone === '4157602883', 'plain_phone_normalized', JSON.stringify(p))
  ok(p.instagram === 'benny.ink', 'plain_instagram_parsed', JSON.stringify(p))

  // 2. HTML-ish layout with label/value on separate lines.
  const html = `<div><p>Name:</p><p>Leticia W</p><p>Phone Number:</p><p>628 555 0199</p><p>Email:</p><p>leti@x.com</p></div>`
  p = reader.parseFormEmail(html)
  ok(p && p.name === 'Leticia W', 'html_name_parsed', JSON.stringify(p))
  ok(p.phone === '6285550199', 'html_phone_parsed', JSON.stringify(p))

  // 3. First/last split fields + bare phone in body.
  p = reader.parseFormEmail('First Name: Tori\nLast Name: C\nreach me at 415.222.3344 anytime')
  ok(p && p.name === 'Tori C' && p.phone === '4152223344', 'split_name_and_loose_phone', JSON.stringify(p))
  p = reader.parseFormEmail('Name: Omar System E2E\nPhone: 415-555-0142\nInstagram: omar=2Esystem')
  ok(p && p.instagram === 'omar.system', 'quoted_printable_instagram_handle_decoded', JSON.stringify(p))

  // 4. Junk does not fabricate an identity.
  ok(reader.parseFormEmail('Your weekly analytics digest is ready! Visits: 1234') === null, 'junk_rejected')

  // 5. Notification detection.
  ok(reader.looksLikeFormNotification({ from: [{ address: 'no-reply@squarespace.com' }], subject: 'Form Submission - Apply' }) === true, 'squarespace_notification_detected')
  ok(reader.looksLikeFormNotification({ from: [{ address: 'friend@gmail.com' }], subject: 'lunch?' }) === false, 'ordinary_mail_ignored')

  // 6. Ledger claim logic (isolated temp dir via env override not available — use the
  //    real dir path pattern against a temp LIVE root by writing through the module's
  //    submissionPath? claimLatestFormSubmission reads LIVE_DIR/form-submissions; drive
  //    it with real files in that dir under a guard prefix, then clean up).
  const dir = path.join(__dirname, 'form-submissions')
  fs.mkdirSync(dir, { recursive: true })
  const mkSub = (uid, rec) => fs.writeFileSync(path.join(dir, `${uid}.json`), JSON.stringify(rec, null, 2))
  const nowIso = new Date().toISOString()
  const oldIso = new Date(Date.now() - 48 * 3600e3).toISOString()
  try {
    mkSub('hx-old', { uid: 'hx-old', name: 'Old', phone: '1112223333', instagram: '', email_date: oldIso, recorded_at: oldIso, claimed_by: '' })
    mkSub('hx-ig', { uid: 'hx-ig', name: 'IG Match', phone: '2223334444', instagram: 'lead.handle', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    mkSub('hx-new', { uid: 'hx-new', name: 'Newest', phone: '3334445555', instagram: '', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    mkSub('hx-taken', { uid: 'hx-taken', name: 'Taken', phone: '4445556666', instagram: '', email_date: nowIso, recorded_at: nowIso, claimed_by: 'someone-else' })

    // instagram handle match wins
    let got = authority.claimLatestFormSubmission('thread-1', 'Lead.Handle')
    ok(got && got.name === 'IG Match', 'claim_prefers_instagram_match', JSON.stringify(got))
    // claimed record is re-served to the SAME thread only
    got = authority.claimLatestFormSubmission('thread-1', 'lead.handle')
    ok(got && got.name === 'IG Match', 'claim_idempotent_same_thread')
    // WHO-IS-WHO: with no handle match and MULTIPLE unclaimed candidates, refuse to
    // guess (funnel asks instead of pinning someone else's identity).
    mkSub('hx-new2', { uid: 'hx-new2', name: 'Second New', phone: '9990001111', instagram: '', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    got = authority.claimLatestFormSubmission('thread-2', '')
    ok(got === null, 'ambiguous_multiple_unclaimed_refused', JSON.stringify(got))
    // fuzzy handle: form typo dvklbrr matches lead dvklbr (edit distance 1)
    mkSub('hx-fuzzy', { uid: 'hx-fuzzy', name: 'Leticia W', phone: '6285550199', instagram: 'dvklbrr', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    got = authority.claimLatestFormSubmission('thread-4', 'dvklbr')
    ok(got && got.name === 'Leticia W', 'fuzzy_handle_typo_matched', JSON.stringify(got))
    // A single unclaimed candidate is not identity evidence. It may be a stale
    // debug form or another lead whose peers were already claimed.
    mkSub('hx-solo', { uid: 'hx-solo', name: 'Solo Lead', phone: '5556667777', instagram: '', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('hx-')) continue
      const fp = path.join(dir, f)
      const rec = JSON.parse(fs.readFileSync(fp, 'utf8'))
      if (rec.uid !== 'hx-solo' && !rec.claimed_by) { rec.claimed_by = 'someone'; fs.writeFileSync(fp, JSON.stringify(rec, null, 2)) }
    }
    got = authority.claimLatestFormSubmission('thread-5', '')
    ok(got === null, 'single_unclaimed_candidate_without_identity_refused', JSON.stringify(got))
    // aged-out submissions are never claimed
    got = authority.claimLatestFormSubmission('thread-6', '')
    ok(!got || got.name !== 'Old', 'aged_submission_not_claimed', JSON.stringify(got))

    // 7. Auto-fill: only on submitted signal, never overwrites existing values.
    mkSub('hx-fill', { uid: 'hx-fill', name: 'Fill Me', phone: '7778889999', instagram: 'fill.lead', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    let state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-9', instagram_username: 'fill.lead' },
      { live_turn_form_submitted_signal: true, known_name_used_on_form: '', known_phone_used_on_form: '' }
    )
    ok(state.known_name_used_on_form === 'Fill Me' && state.known_phone_used_on_form === '7778889999', 'autofill_on_submit_signal', JSON.stringify(state))
    ok(state.form_submitted === true, 'autofill_on_submit_signal_marks_form_submitted', JSON.stringify(state))
    ok(state.form_submission_source === 'gmail_form_email', 'autofill_source_tagged')

    // 8. WHO-IS-WHO SCORER (Ben 2026-07-08: 광고 볼륨=미청구 다발+핸들 쓰레기).
    //    핸들이 "idk"여도 스레드 신호(전화/이름/아이디어)로 매핑, 신호 없으면 거부.
    const soon = new Date().toISOString()
    mkSub('hx-idk1', { uid: 'hx-idk1', name: '테스트원', phone: '1234123412', instagram: 'idk i dont know', email_date: soon, recorded_at: soon, claimed_by: '' })
    mkSub('hx-idk2', { uid: 'hx-idk2', name: 'Other Person', phone: '8887776666', instagram: 'idk', email_date: soon, recorded_at: soon, claimed_by: '' })
    // (a) 전화 교차매칭 — DM에서 흘린 번호 = 폼 번호 → 프로액티브(말 없이)도 매핑
    got = authority.claimLatestFormSubmission('thread-20', 'omar.system', { handle_match_only: true, recent_history: [
      { role: 'user', text: 'sure my number is 123 412 3412', at: soon }
    ] })
    ok(got && got.name === '테스트원', 'scorer_phone_crossmatch_proactive', JSON.stringify(got))
    // (b) 이름 교차매칭 — DM에서 말한 이름 = 폼 이름 → 말 신호 모드에서 매핑
    mkSub('hx-nm1', { uid: 'hx-nm1', name: 'Maria Lopez', phone: '1112224444', instagram: 'idk', email_date: soon, recorded_at: soon, claimed_by: '' })
    mkSub('hx-nm2', { uid: 'hx-nm2', name: 'Someone Else', phone: '2223335555', instagram: '', email_date: soon, recorded_at: soon, claimed_by: '' })
    got = authority.claimLatestFormSubmission('thread-21', 'omar.system', { recent_history: [
      { role: 'user', text: 'Maria Lopez', at: soon }
    ] })
    ok(got && got.name === 'Maria Lopez', 'scorer_name_crossmatch_verbal', JSON.stringify(got))
    // (c) 아이디어 겹침 — 폼 메시지 ≈ 대화한 디자인 → 매핑
    mkSub('hx-ov1', { uid: 'hx-ov1', name: 'Idea Person', phone: '3334446666', instagram: '', message: 'blush flower on my forearm delicate', email_date: soon, recorded_at: soon, claimed_by: '' })
    mkSub('hx-ov2', { uid: 'hx-ov2', name: 'No Overlap', phone: '4445557777', instagram: '', message: 'skull snake dark sleeve', email_date: soon, recorded_at: soon, claimed_by: '' })
    got = authority.claimLatestFormSubmission('thread-22', '', { recent_history: [
      { role: 'user', text: 'i want a blush flower piece really delicate', at: soon }
    ] })
    ok(got && got.name === 'Idea Person', 'scorer_idea_overlap_verbal', JSON.stringify(got))
    // (d) 신호 제로 + 다발 → 프로액티브 거부 (오배정보다 거부)
    got = authority.claimLatestFormSubmission('thread-23', 'omar.system', { handle_match_only: true, recent_history: [] })
    ok(got === null, 'scorer_no_signal_proactive_refused', JSON.stringify(got))
    // (e) 오타 관용: 인접 뒤바꿈(제일 흔함) + 긴 핸들 2글자 오타 → 매핑; 전혀 다른 핸들 → 거부
    mkSub('hx-swap', { uid: 'hx-swap', name: 'Swap Typo', phone: '5551112222', instagram: 'omarsytsem', email_date: soon, recorded_at: soon, claimed_by: '' })
    got = authority.claimLatestFormSubmission('thread-24', 'omar.system', { handle_match_only: true, recent_history: [] })
    ok(got && got.name === 'Swap Typo', 'fuzzy_transposition_matched', JSON.stringify(got))
    mkSub('hx-2sub', { uid: 'hx-2sub', name: 'Two Sub', phone: '5553334444', instagram: 'omer.systen', email_date: soon, recorded_at: soon, claimed_by: '' })
    got = authority.claimLatestFormSubmission('thread-25', 'omar.system', { handle_match_only: true, recent_history: [] })
    ok(got && got.name === 'Two Sub', 'fuzzy_two_edits_long_handle_matched', JSON.stringify(got))
    mkSub('hx-diff', { uid: 'hx-diff', name: 'Different', phone: '5556667777', instagram: 'totally.other', email_date: soon, recorded_at: soon, claimed_by: '' })
    got = authority.claimLatestFormSubmission('thread-26', 'omar.system', { handle_match_only: true, recent_history: [] })
    ok(got === null || got.name !== 'Different', 'unrelated_handle_not_matched', JSON.stringify(got))
    // 9. ASR 시제 복구 (라이브 2026-07-08: "I just sent you"를 whisper가 "I'll just
    //    send you"로 받아적어 제출 시그널 암전 → "send it when you can" 봇 tell).
    //    폼 링크 후 보이스에서 문장이 send/sent로 끝나면 시제 무관 제출 주장.
    const vst = { form_link_sent: true }
    ok(authority.voiceTranscriptClaimsSubmission("sent a voice note saying: Yeah, I'll just send you.", vst) === true, 'asr_future_tense_submitted_claim')
    ok(authority.voiceTranscriptClaimsSubmission('sent a voice note saying: I just sent it.', vst) === true, 'asr_past_tense_submitted_claim')
    ok(authority.voiceTranscriptClaimsSubmission("sent a voice note saying: I'll just send you my idea tonight.", vst) === false, 'asr_real_future_plan_not_claimed')
    ok(authority.voiceTranscriptClaimsSubmission('sent a voice note saying: can you send it again?', vst) === false, 'asr_question_not_claimed')
    ok(authority.voiceTranscriptClaimsSubmission('ill just send you', vst) === false, 'typed_future_not_claimed')
    ok(authority.voiceTranscriptClaimsSubmission('sent a voice note saying: i just sent it', { form_link_sent: false }) === false, 'no_link_no_claim')
    // 10. ROOT FIX 유니언: 리졸버의 의미 플래그가 자동주입 이전 상태에 승격되고,
    //     그 플래그로 verbal-mode 장부 청구까지 이어지는지 (체인 유닛).
    let ust = authority.applyMediaContextToState({ form_link_sent: true }, {
      is_voice_note: true, state_flags: { live_turn_form_submitted_signal: true }
    }, { text: 'sent a voice note saying: yeah ill just send you' })
    ok(ust.live_turn_form_submitted_signal === true && ust.live_turn_is_voice_note === true, 'media_context_intent_union_promotes')
    const rootLinkAt = new Date(Date.now() - 2000).toISOString()
    mkSub('hx-root', { uid: 'hx-root', name: 'Root Fix', phone: '9998887777', instagram: 'omar.system', email_date: soon, recorded_at: soon, claimed_by: '' })
    // 다른 미청구 전부 청구 처리해 단일화
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('hx-')) continue
      const fp = path.join(dir, f)
      const rec = JSON.parse(fs.readFileSync(fp, 'utf8'))
      if (rec.uid !== 'hx-root' && !rec.claimed_by) { rec.claimed_by = 'x'; fs.writeFileSync(fp, JSON.stringify(rec, null, 2)) }
    }
    ust = authority.applyGmailFormAutofill(
      { thread_id: 'thread-30', instagram_username: 'omar.system' },
      ust,
      [{ role: 'assistant', text: 'https://www.effacermonexistence.com/apply', at: rootLinkAt }]
    )
    ok(ust.known_name_used_on_form === 'Root Fix', 'intent_union_unlocks_verbal_claim', JSON.stringify(ust.known_name_used_on_form))
    // 11. DESIGN GATE (Ben 2026-07-08: "디자인이 정해져야 날짜를 잡지"): 폼이 들어와도
    //     스레드에 디자인 대화가 없으면 awaiting_design_direction, 있으면 awaiting_date.
    const FORM_LINK_TURN = { role: 'assistant', text: 'here you go https://www.effacermonexistence.com/apply lmk once its in!' }
    let bst = authority.buildStructuredState(
      { contact_id: 'dg-1', thread_id: 'dg-1', instagram_username: 'dg', text: 'i love your style' },
      [FORM_LINK_TURN, { role: 'user', text: 'i submitted the form' }]
    )
    ok(bst.booking_stage_hint === 'awaiting_design_direction', 'form_in_but_no_design_gates_design_first', bst.booking_stage_hint)
    bst = authority.buildStructuredState(
      { contact_id: 'dg-2', thread_id: 'dg-2', instagram_username: 'dg', text: 'sounds good' },
      [ { role: 'user', text: 'i want a skull piece in black and grey' }, FORM_LINK_TURN, { role: 'user', text: 'i submitted the form' } ]
    )
    ok(bst.booking_stage_hint === 'awaiting_date', 'design_established_moves_to_date', bst.booking_stage_hint)

    // Live regression 2026-08-28: Whisper/typing delivered "Aaja submitted"
    // after the application link. "submitted" is sufficient process authority,
    // but the unexplained prefix is not a name, design, or object and may never
    // be echoed back as if understood ("Aaja's in").
    const noisySubmissionHistory = [
      { role: 'user', text: 'i want a blackwork snake' },
      FORM_LINK_TURN,
      { role: 'user', text: 'Aaja submitted' }
    ]
    let noisyState = authority.buildStructuredState(
      { contact_id: 'asr-residue-1', thread_id: 'asr-residue-1', instagram_username: 'omar.system', text: 'Aaja submitted' },
      noisySubmissionHistory
    )
    ok(noisyState.form_submitted === true, 'noisy_submission_keeps_clear_form_fact', JSON.stringify(noisyState))
    ok(noisyState.known_design_context === 'i want a blackwork snake', 'noisy_submission_cannot_overwrite_prior_design', JSON.stringify(noisyState))
    ok(!/aaja/i.test(String(noisyState.known_design_context || '')), 'noisy_submission_residue_not_design_state', JSON.stringify(noisyState))

    noisyState = authority.annotateStructuredStateForLiveTurn(
      { contact_id: 'asr-residue-2', thread_id: 'asr-residue-2', instagram_username: 'omar.system', text: 'Aaja submitted' },
      {
        form_offer_asked: true,
        form_link_sent: true,
        form_submitted: false,
        tattoo_intent_active: true,
        known_design_context: 'blackwork snake'
      },
      noisySubmissionHistory.slice(0, 2)
    )
    ok(
      noisyState.live_turn_form_submitted_signal === true &&
      noisyState.live_turn_gave_design_idea !== true &&
      noisyState.known_design_context === 'blackwork snake',
      'live_noisy_submission_is_process_only_not_design',
      JSON.stringify(noisyState)
    )
    const noisyInput = {
      contact_id: 'asr-residue-2',
      thread_id: 'asr-residue-2',
      instagram_username: 'omar.system',
      message: 'Aaja submitted',
      structured_state: noisyState,
      recent_history: noisySubmissionHistory.slice(0, 2)
    }
    const noisyPlan = transition.deriveClosedTransitionPlan(noisyInput)
    ok(noisyPlan.action === transition.ACTIONS.POST_FORM_AVAILABILITY, 'noisy_submission_moves_to_date_checkpoint', JSON.stringify(noisyPlan))
    const noisyBadResult = transition.evaluateClosedTransitionContract(noisyInput, {
      bubbles: [{ text: "Got it, Aaja's in. What dates work for you?" }]
    }, noisyPlan)
    ok(
      noisyBadResult.valid === false &&
      noisyBadResult.reason === 'closed_transition_ungrounded_submission_residue_echo_forbidden',
      'verifier_rejects_ungrounded_asr_residue_echo',
      JSON.stringify(noisyBadResult)
    )
    const noisyGoodResult = transition.evaluateClosedTransitionContract(noisyInput, {
      bubbles: [{ text: 'Got it, the form is in. What dates work for you?' }]
    }, noisyPlan)
    ok(noisyGoodResult.valid === true, 'verifier_accepts_grounded_submission_ack', JSON.stringify(noisyGoodResult))

    // 12. VOICE-NOTE != DESIGN REFERENCE (Ben live 2026-07-08): voice notes are
    //     committed to history as "sent a reference post"; that bare blob was setting
    //     known_reference_media_received=true and unlocking the funnel on voice-only
    //     turns. A reference is a design direction only if it carries actual content.
    const vnref = authority.buildStructuredState(
      { contact_id: 'vn-1', thread_id: 'vn-1', instagram_username: 'x', text: 'sent a voice note saying: how are you' },
      [{ role: 'user', text: 'sent a reference post' }, { role: 'assistant', text: 'hi!' }, { role: 'user', text: 'sent a voice note saying: how are you' }]
    )
    ok(vnref.known_reference_media_received !== true, 'bare_reference_blob_not_design_reference', String(vnref.known_reference_media_received))
    const dnref = authority.buildStructuredState(
      { contact_id: 'vn-2', thread_id: 'vn-2', instagram_username: 'x', text: 'sent a reference post: a skull tattoo design in black and grey' },
      [{ role: 'user', text: 'sent a reference post: a skull tattoo design in black and grey' }]
    )
    ok(dnref.known_reference_media_received === true, 'described_image_reference_counts', String(dnref.known_reference_media_received))

    state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-10', instagram_username: '' },
      { live_turn_form_submitted_signal: false, form_submitted: false, known_name_used_on_form: '', known_phone_used_on_form: '' }
    )
    ok(!state.known_name_used_on_form, 'no_autofill_without_submit_signal')

    // Live regression 2026-07-08/09: Omar.system was reset, but a prior Gmail form
    // submission with the same handle stayed unclaimed. A fresh "what do you mean
    // by model?" turn has no form link / no form offer / no submitted claim, so
    // proactive Gmail matching must NOT contaminate the new thread as post-form.
    mkSub('hx-fresh-gate', { uid: 'hx-fresh-gate', name: 'Fresh Gate Leak', phone: '3213214321', instagram: 'omar.system', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-fresh-gate', instagram_username: 'omar.system', text: "sent a voice note saying: I'm okay. What do you mean by model?" },
      {
        form_link_sent: false,
        form_offer_asked: false,
        live_turn_form_submitted_signal: false,
        form_submitted: false,
        known_name_used_on_form: '',
        known_phone_used_on_form: ''
      },
      []
    )
    ok(!state.form_submitted && !state.live_turn_form_submitted_signal && !state.known_name_used_on_form, 'no_proactive_gmail_autofill_before_form_gate', JSON.stringify(state))

    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('hx-')) continue
      const fp = path.join(dir, f)
      const rec = JSON.parse(fs.readFileSync(fp, 'utf8'))
      const recIg = String(rec.instagram || '').toLowerCase().replace(/^@/, '').replace(/[._]/g, '')
      if (recIg === 'omarsystem' && !rec.claimed_by) {
        rec.claimed_by = 'stale-test-guard'
        fs.writeFileSync(fp, JSON.stringify(rec, null, 2))
      }
    }
    // Omar.system stays independent from OLD same-handle Gmail forms after the
    // form gate opens. The form email must be after the form-link turn to count
    // as this replay's artifact.
    const beforeGateIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const linkAtIso = new Date(Date.now() - 60 * 1000).toISOString()
    mkSub('hx-omar-gated', { uid: 'hx-omar-gated', name: 'Omar Old Form', phone: '5551110000', instagram: 'omar.system', email_date: beforeGateIso, recorded_at: beforeGateIso, claimed_by: '' })
    state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-omar-gated', instagram_username: 'omar.system', text: 'what do you mean by model?' },
      {
        form_link_sent: true,
        form_offer_asked: true,
        live_turn_form_submitted_signal: false,
        form_submitted: false,
        known_name_used_on_form: '',
        known_phone_used_on_form: ''
      },
      [{ role: 'assistant', text: 'here you go https://www.effacermonexistence.com/apply', at: linkAtIso }]
    )
    ok(!state.form_submitted && !state.known_name_used_on_form, 'omar_system_independent_no_old_proactive_gmail_even_after_gate', JSON.stringify(state))
    mkSub('hx-omar-after-link', { uid: 'hx-omar-after-link', name: 'Omar Fresh Form', phone: '5551119999', instagram: 'Omarsystem', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-omar-after-link', instagram_username: 'omar.system', text: 'sent a voice note saying: I just saw a mirror.' },
      {
        form_link_sent: true,
        form_offer_asked: true,
        live_turn_form_submitted_signal: false,
        form_submitted: false,
        known_name_used_on_form: '',
        known_phone_used_on_form: ''
      },
      [{ role: 'assistant', text: 'here you go https://www.effacermonexistence.com/apply', at: linkAtIso }]
    )
    ok(
      state.form_submitted === true &&
      state.live_turn_form_submitted_signal === true &&
      state.known_name_used_on_form === 'Omar Fresh Form' &&
      state.known_phone_used_on_form === '5551119999',
      'omar_system_fresh_after_link_gmail_beats_asr_mirror_miss',
      JSON.stringify(state)
    )
    // Live regression 2026-07-14: an explicit `just submitted` verbal signal
    // previously disabled the Omar temporal gate and claimed the only stale form
    // (phone 4039463225) seconds before the fresh Gmail email arrived. Verbal intent
    // cannot waive artifact identity or current-replay time.
    const staleOnlyAt = new Date(Date.now() - 8 * 60 * 1000).toISOString()
    const currentReplayLinkAt = new Date(Date.now() - 30 * 1000).toISOString()
    mkSub('hx-omar-verbal-stale', { uid: 'hx-omar-verbal-stale', name: 'Prior Replay', phone: '4039463225', instagram: '', email_date: staleOnlyAt, recorded_at: staleOnlyAt, claimed_by: '' })
    state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-omar-verbal-stale', instagram_username: 'omar.system', text: 'just submitted' },
      {
        form_link_sent: true,
        form_offer_asked: true,
        live_turn_form_submitted_signal: true,
        form_submitted: true,
        known_name_used_on_form: '',
        known_phone_used_on_form: ''
      },
      [{ role: 'assistant', text: 'https://www.effacermonexistence.com/apply', at: currentReplayLinkAt }]
    )
    ok(!state.known_name_used_on_form && !state.known_phone_used_on_form, 'omar_verbal_submit_cannot_claim_stale_single_unclaimed', JSON.stringify(state))
    mkSub('hx-omar-verbal-fresh', { uid: 'hx-omar-verbal-fresh', name: 'Omar System E2E', phone: '4155550142', instagram: 'omar.system', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-omar-verbal-stale', instagram_username: 'omar.system', text: 'weekends work' },
      state,
      [{ role: 'assistant', text: 'https://www.effacermonexistence.com/apply', at: currentReplayLinkAt }]
    )
    ok(
      state.known_name_used_on_form === 'Omar System E2E' && state.known_phone_used_on_form === '4155550142',
      'omar_fresh_exact_handle_after_link_adopted_on_next_turn',
      JSON.stringify(state)
    )
    mkSub('hx-real-gated', { uid: 'hx-real-gated', name: 'Real Lead Gate', phone: '5552220000', instagram: 'real.lead', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-real-gated', instagram_username: 'real.lead', text: 'ok' },
      {
        form_link_sent: true,
        form_offer_asked: true,
        live_turn_form_submitted_signal: false,
        form_submitted: false,
        known_name_used_on_form: '',
        known_phone_used_on_form: ''
      },
      [{ role: 'assistant', text: 'here you go https://www.effacermonexistence.com/apply', at: nowIso }]
    )
    ok(state.form_submitted === true && state.known_name_used_on_form === 'Real Lead Gate', 'real_account_keeps_proactive_gmail_after_form_gate', JSON.stringify(state))

    mkSub('hx-keep', { uid: 'hx-keep', name: 'Other', phone: '0001112222', instagram: 'keep.lead', email_date: nowIso, recorded_at: nowIso, claimed_by: '' })
    state = authority.applyGmailFormAutofill(
      { thread_id: 'thread-11', instagram_username: 'keep.lead' },
      { live_turn_form_submitted_signal: true, known_name_used_on_form: 'Already Known', known_phone_used_on_form: '9998887777' }
    )
    ok(state.known_name_used_on_form === 'Already Known' && state.known_phone_used_on_form === '9998887777', 'existing_values_never_overwritten')

    const preserved = authority.applyDurableStructuredState(
      {
        contact_id: '1537753982',
        thread_id: '1537753982',
        text: 'sent a voice note saying: Okay, I think 18 would be perfect.'
      },
      {
        form_link_sent: true,
        form_submitted: true,
        known_name_used_on_form: 'Fill Me',
        known_phone_used_on_form: '7778889999'
      }
    )
    ok(
      preserved.form_submitted === true &&
      preserved.known_name_used_on_form === 'Fill Me' &&
      preserved.known_phone_used_on_form === '7778889999',
      'durable_form_identity_survives_next_inbound_state',
      JSON.stringify(preserved)
    )

    const childRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-durable-state-'))
    fs.mkdirSync(path.join(childRoot, 'thread-state'), { recursive: true })
    fs.mkdirSync(path.join(childRoot, 'thread-history'), { recursive: true })
    fs.writeFileSync(path.join(childRoot, 'thread-state', '1537753982.json'), JSON.stringify({
      contact_id: '1537753982',
      thread_id: '1537753982',
      text: 'sent a voice note saying: Okay, I just submitted.',
      form_link_sent: true,
      form_submitted: true,
      known_name_used_on_form: 'Fill Me',
      known_phone_used_on_form: '7778889999'
    }, null, 2) + '\n')
    const child = spawnSync(process.execPath, ['-e', `
      process.env.SCV_ROOT = ${JSON.stringify(childRoot)};
      const auth = require(${JSON.stringify(path.join(__dirname, 'dm-authority.js'))});
      const st = auth.buildStructuredState(
        { contact_id: '1537753982', thread_id: '1537753982', instagram_username: 'omar.system', text: 'sent a voice note saying: Okay, I think 18 would be perfect.' },
        [{ role: 'assistant', text: 'i’ve got july 18 and 19 open at 2pm those are the closest weekend spots if either fits your vibe' }]
      );
      console.log(JSON.stringify(st));
    `], { encoding: 'utf8' })
    ok(child.status === 0, 'durable_state_child_build_exits', child.stderr || child.stdout)
    const childState = JSON.parse(String(child.stdout || '').trim())
    ok(
      childState.form_submitted === true &&
      childState.known_name_used_on_form === 'Fill Me' &&
      childState.known_phone_used_on_form === '7778889999',
      'build_structured_state_seeds_durable_identity',
      JSON.stringify(childState)
    )
  } finally {
    for (const f of fs.readdirSync(dir)) if (f.startsWith('hx-')) fs.unlinkSync(path.join(dir, f))
  }

  // 8. Boot wiring: poller spawned, ledger dir bound to the volume list.
  const bootSrc = fs.readFileSync(path.join(__dirname, 'cloud-start.js'), 'utf8')
  ok(/gmail-form-reader.*scv-gmail-form-reader\.js.*--loop/.test(bootSrc), 'cloud_start_spawns_gmail_reader')
  ok(/'form-submissions'/.test(bootSrc), 'submissions_dir_on_volume')
  const readerSrc = fs.readFileSync(path.join(__dirname, 'scv-gmail-form-reader.js'), 'utf8')
  ok(/SCV_GMAIL_POLL_INTERVAL_MS \|\| 10 \* 1000/.test(readerSrc), 'gmail_reader_default_poll_10s')
  ok(/if \(pollInFlight\)/.test(readerSrc) && /previous_poll_in_flight/.test(readerSrc), 'gmail_reader_poll_nonoverlap_guard')
  const authSrc = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')
  ok(/applyGmailFormAutofill\(\s*msg,/.test(authSrc), 'authority_autofill_wired')

  return { ok: true, checked }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvGmailFormHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  }
}

module.exports = { runScvGmailFormHarness }
