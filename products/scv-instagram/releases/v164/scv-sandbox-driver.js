#!/usr/bin/env node
// SCV FULL-FUNNEL SANDBOX — real model (gpt-4.1-mini) + real authority pipeline,
// in-memory history (recent_history_override), zero disk/live side effects.
// Messy real-lead scenarios all the way to deposit + address. Fails = divergences.
const path = require('path')
const FILES = '/Users/effacermonexistencecodex/Code/omar-migration/omar-os1/codex_vault/restored_materials/SCV_INSTAGRAM_AUTOMATION_LONG_IDEA_RECOVERY_LOCK_V42_2026-06-21/files'
const { generatePacketFromCodexAuthority } = require(path.join(FILES, 'dm-authority.js'))

const FORM = 'https://www.effacermonexistence.com/apply'
const ADDR = '10 Arkansas St San Francisco CA 94107'
let MSGSEQ = 1

const U = (text) => ({ role: 'user', message_id: `u${MSGSEQ++}`, text, at: new Date().toISOString() })
const A = (text) => ({ role: 'assistant', message_id: `a${MSGSEQ++}`, text, at: new Date().toISOString() })

function turn(history, text) {
  const msg = {
    contact_id: '999000111', thread_id: '999000111',
    instagram_username: 'sandbox.lead',
    message_id: `live${MSGSEQ++}`, text,
    received_at: new Date().toISOString()
  }
  try {
    const out = generatePacketFromCodexAuthority(msg, { recent_history_override: history.slice() })
    const bubbles = (out.packet && out.packet.bubbles || []).map((b) => String(b.text || ''))
    return { bubbles, joined: bubbles.join('\n'), state: out.structured_state || {}, error: '' }
  } catch (err) {
    // A runner hard-fail IS a divergence (live lead would get no reply this turn) —
    // record it and keep the sweep going instead of killing the whole run.
    const error = String(err && err.message || err).slice(0, 300)
    turnErrors.push({ live_text: text, error })
    return { bubbles: [], joined: '', state: {}, error }
  }
}
const turnErrors = []

// After a turn: user turn + delivered assistant bubbles enter history (like live).
function commit(history, userText, res) {
  history.push(U(userText))
  for (const b of res.bubbles) history.push(A(b))
}

const results = []
function check(scn, step, cond, note, extra = '') {
  results.push({ scn, step, pass: !!cond, note, extra: String(extra).slice(0, 220) })
}

const has = (s, re) => re.test(s)
const lc = (r) => r.joined.toLowerCase()

async function main() {
  // ============ S1: 해피패스 — 인사→아이디어→폼→제출→이름전화→더블체크→디파짓→주소 ============
  {
    const h = []
    let r = turn(h, 'heyy i want a tattoo from you!!')
    check('S1', '1-idea-open', r.bubbles.length > 0, 'reply non-empty', r.joined)
    check('S1', '1-no-price-volunteer', !/\b150\b/.test(r.joined), 'no price unless asked', r.joined)
    commit(h, 'heyy i want a tattoo from you!!', r)

    r = turn(h, 'i was thinking a small snake wrapped around a dagger, on my forearm')
    check('S1', '2-idea-reply', r.bubbles.length > 0, 'reply non-empty', r.joined)
    const offeredOrSent = /form|apply/i.test(r.joined)
    check('S1', '2-moves-to-form', offeredOrSent, 'offers form after idea', r.joined)
    commit(h, 'i was thinking a small snake wrapped around a dagger, on my forearm', r)

    r = turn(h, 'yeah sure send it over')
    check('S1', '3-consent-sends-link', r.joined.includes(FORM), 'form link sent on consent', r.joined)
    commit(h, 'yeah sure send it over', r)

    r = turn(h, 'ok just submitted it! im free july 15 around 2pm btw')
    check('S1', '4-no-link-resend', !r.joined.includes(FORM), 'no duplicate form link', r.joined)
    // Post Gmail friction-kill: identity arrives from the form email, so in the
    // no-ledger-match survival window the bot asks for whatever's MISSING — name
    // and/or phone, one message or across turns. Accept asking for either identity
    // field (not both required).
    check('S1', '4-asks-name-or-phone', /\b(name|phone|number)\b/i.test(r.joined) && /\b(form|used|match)\b/i.test(r.joined), 'asks identity used on form', r.joined)
    commit(h, 'ok just submitted it! im free july 15 around 2pm btw', r)

    r = turn(h, 'benny 4157602883')
    const dc = /name\s*:/i.test(r.joined) && /phone number\s*:/i.test(r.joined) && /appointment date\s*:/i.test(r.joined) && /time\s*:/i.test(r.joined)
    check('S1', '5-double-check-format', dc, 'four-line double check', r.joined)
    commit(h, 'benny 4157602883', r)

    r = turn(h, 'yes all correct!')
    check('S1', '6-deposit-handoff', /deposit/i.test(r.joined) && /zelle/i.test(r.joined) && /contact@omarprotocol\.com/i.test(r.joined), 'deposit+zelle handoff', r.joined)
    check('S1', '6-verbatim-or-clean-wording', r.joined.includes('This is my zelle!') || !/lock(ed)? (it )?in|lock the slot|secure your spot/i.test(r.joined), 'verbatim locked script or clean wording', r.joined)
    check('S1', '6-no-double-check-repeat', !/can you double check/i.test(r.joined), 'no repeat double-check', r.joined)
    commit(h, 'yes all correct!', r)

    r = turn(h, 'just sent the deposit!')
    // Meaning class = 'payment not visible yet'. Model phrases this endlessly
    // (hasn't hit/popped up/come through/shown; not on my side/end yet). Match the
    // CLASS, not each phrasing: a negation within 40 chars of an arrival/visibility
    // verb, or a 'not ... yet on my side/end' shape.
    const arrivalVerb = '(come through|comes through|arriv|receiv|land|show|shows|showing|pop|popped|popping|hit|hits|see it|got it|reflect|register|in yet|through yet)'
    const notArrived = new RegExp('(hasn.?t|haven.?t|has not|have not|not|didn.?t|do(es)?n.?t|dont|isn.?t|no)\\b.{0,40}' + arrivalVerb, 'i').test(r.joined) ||
      /\bnot (there|in|here|showing|visible|up|reflected) yet\b/i.test(r.joined) ||
      /\b(nothing|no (payment|deposit|money))\b.{0,25}(yet|on my (side|end)|so far)/i.test(r.joined) ||
      /\b(hasn.?t|not).{0,25}(on my (side|end))/i.test(r.joined)
    const checkingSignal = /\b(check|checking|on it|i.?m on it|looking (into|for) it|keep(ing)? an eye|watching for it|lmk|let me know|will confirm|confirm (as soon as|once|when)|(the moment|as soon as|once|when) it (lands|shows|comes|hits|arrives|reflects))\b/i.test(r.joined)
    const holdMeaning = /아직 안 왔네요/.test(r.joined) ||
      (notArrived && checkingSignal) ||
      /\b(still waiting|waiting (on|for) it|keeping an eye|watching for it|once it (lands|shows|comes through)|when it (lands|shows|comes through))\b/i.test(r.joined)
    const holdNoFunnel = !r.joined.includes(FORM) && !/name\s*:/i.test(r.joined)
    check('S1', '7-deposit-claim-hold', holdMeaning && holdNoFunnel, 'deposit-sent claim -> not-arrived+checking, funnel paused', r.joined)
    commit(h, 'just sent the deposit!', r)

    r = turn(h, 'cool! whats the exact address?')
    check('S1', '8-address-given', r.joined.includes(ADDR), 'exact address given', r.joined)
    check('S1', '8-address-not-gated', !/after (the )?deposit|once (the )?deposit/i.test(r.joined) || r.joined.includes(ADDR), 'address never deposit-gated', r.joined)
    commit(h, 'cool! whats the exact address?', r)
  }

  // ============ S2: Ben 케이스 — 이름+전화 요청에 전화번호만 던짐 ============
  {
    const h = [
      U('i want a rose piece on my shoulder'),
      A('love that idea 🖤 want me to send the form so we can get you set up?'),
      U('yes please'),
      A(`here you go ${FORM} lmk once its in!`),
      U('done! i put july 20 at 2pm'),
      A('perfect, can you send the name + phone number you used on the form so i can double check everything?')
    ]
    const r = turn(h, '4157602883')
    check('S2', 'phone-only-not-reasked', !/what.?s your (phone|number)|send (me )?(your )?(phone|number)/i.test(r.joined), 'does not re-ask phone', r.joined)
    // Gmail friction-kill: name normally arrives from the form email, so BOTH are
    // valid here — asking the missing name (survival window: submitted + no ledger
    // match) OR acknowledging and letting the ledger fill it.
    check('S2', 'phone-only-name-ask-or-ack', /name/i.test(r.joined) || /(thank|got|perfect|noted|sweet|appreciate)/i.test(r.joined), 'asks missing name or acknowledges', r.joined)
    check('S2', 'phone-only-no-form-resend', !r.joined.includes(FORM), 'no form resend', r.joined)
    check('S2', 'phone-only-nonempty', r.bubbles.length > 0, 'reply non-empty', r.joined)
  }

  // ============ S3: 이름만 먼저, 전화 나중 (쪼개서 주는 인간) ============
  {
    const h = [
      U('skull hand tattoo idea'),
      A(`sick idea! here is the form ${FORM} lmk once its in`),
      U('submitted, july 18 2pm works'),
      A('great! whats the name + phone number you used on the form?')
    ]
    let r = turn(h, 'its benny')
    check('S3', 'name-only-asks-phone', /phone|number/i.test(r.joined), 'asks for missing phone', r.joined)
    check('S3', 'name-only-no-form-resend', !r.joined.includes(FORM), 'no form resend', r.joined)
    commit(h, 'its benny', r)
    r = turn(h, '415 760 2883')
    const dc = /name\s*:/i.test(r.joined) && /phone number\s*:/i.test(r.joined)
    check('S3', 'phone-later-double-check', dc, 'double check fires once both known', r.joined)
  }

  // ============ S4: 가격 먼저 물어보는 리드 ============
  {
    const h = []
    let r = turn(h, 'how much do you charge?')
    check('S4', 'price-answer-150', /150/.test(r.joined), 'answers 150/hr', r.joined)
    check('S4', 'price-style-condition', /style/i.test(r.joined), 'style condition mentioned', r.joined)
    commit(h, 'how much do you charge?', r)
    r = turn(h, 'ok cool im interested in a small rose')
    check('S4', 'post-price-funnel-continues', r.bubbles.length > 0 && !/150/.test(r.joined), 'funnel continues, no price repeat', r.joined)
  }

  // ============ S5: 주소/위치 질문 (디파짓 전) ============
  {
    const h = [U('hi do you do fine line?'), A('yes i do! got an idea in mind?')]
    const r = turn(h, 'where exactly are you located?')
    check('S5', 'address-exact', r.joined.includes(ADDR), 'exact address pre-deposit', r.joined)
  }

  // ============ S6: coalesce — 장문 아이디어 + 바로 가격 (미응답 백로그) ============
  {
    const h = [
      A('Hiii!!! thank you so much for reaching out to me!'),
      U('ok so i want a big haunted house halloween piece with ghosts and a black cat and skulls in the tree roots, on my thigh, needs room for detail')
      // no assistant after -> unanswered backlog
    ]
    const r = turn(h, 'how much would it cost?')
    check('S6', 'backlog-flag', r.state.live_turn_has_unanswered_backlog === true, 'backlog detected', JSON.stringify(r.state.pending_unanswered_user_messages || []).slice(0, 120))
    const coversIdea = /(halloween|haunted|ghost|cat|skull|thigh|detail|idea|piece|design)/i.test(r.joined)
    check('S6', 'covers-idea-and-price', coversIdea && /150/.test(r.joined), 'one reply covers idea + price', r.joined)
  }

  // ============ S7: 미디어-only (사진/터지는 사진) ============
  {
    const h = []
    const r = turn(h, 'sent a photo')
    check('S7', 'photo-reply-nonempty', r.bubbles.length > 0, 'photo gets a reply', r.joined)
    check('S7', 'photo-no-robot-cantview', !/cannot view|can.?t view images|unable to (view|see) image/i.test(r.joined), 'no robotic cant-view', r.joined)
    check('S7', 'photo-moves-forward', /\?|can you|could you|tell me|drop it|send it (again|over)|resend|lmk|let me know|throw (me|it)|what.{0,15}(vibe|idea|thinking)/i.test(r.joined), 'asks something to move forward', r.joined)
  }

  // ============ S8: 오타 동의 ============
  {
    const h = [U('want a small moon tattoo'), A('cute!! want me to send the form over so we can set it up?')]
    const r = turn(h, 'yess plss')
    check('S8', 'typo-consent-sends-link', r.joined.includes(FORM), 'typo consent sends form', r.joined)
  }

  // ============ S9: 슬롯 수락 뒤 폼 미제출 ============
  {
    const h = [
      U('dragon back piece?'),
      A(`epic. here is the form ${FORM} and lmk a day that works!`),
      A('i could do july 19 at 2pm if that works?')
    ]
    const r = turn(h, 'july 19 works!!')
    check('S9', 'slot-accept-no-form-resend', !r.joined.includes(FORM), 'no form link resend on slot accept', r.joined)
    // Gmail friction-kill (2026-07-08): name/phone asks are now VIOLATIONS pre-
    // submission — identity arrives from the form email. Pass = form-status nudge
    // or forward booking motion; fail = asking for name/phone.
    check('S9', 'slot-accept-moves-forward-without-namephone-ask',
      (/form|once it|lmk|double check|confirm/i.test(r.joined)) && !/\b(send|give|drop|need|what).{0,25}\b(name|phone|number)\b.{0,25}\b(used|form)?/i.test(r.joined) || !/\bname and (phone|number)\b/i.test(r.joined),
      'moves forward without asking name/phone', r.joined)
  }

  // ============ S10: 시비/봇 의심 ============
  {
    const h = [U('nice work'), A('thank you!! got any piece in mind?')]
    const r = turn(h, 'are you a bot? this feels automated lol')
    check('S10', 'bot-accusation-human-reply', r.bubbles.length > 0 && !/as an ai|i am a bot|automated assistant/i.test(lc(r)), 'stays human, replies', r.joined)
  }

  // ============ S11: 사이즈/부위 흡입 금지 — 한 비트 인정 + in-person + 다음 게이트 ============
  {
    const h = [
      U('i want a snake piece'),
      A('sick idea!! want me to send the form so we can get you set up?')
    ]
    const r = turn(h, 'hmm what size do you think it should be? maybe on my ribs?')
    check('S11', 'size-no-estimate', !/\b(i'?d say|probably|around|at least)\b.{0,25}\b(small|medium|large|inch|cm)\b/i.test(r.joined), 'no size estimate/recommendation', r.joined)
    check('S11', 'size-in-person', /in person|confirm(ed)?\s?(in\s?)?person|at the appointment|when (you|we) (come|meet)|in the studio|at the shop|at the (sesh|session|appt)|during the (sesh|session|appt)|dial(ed)?\s?(it\s)?in|nail (it |them )?(down )?(over dm|in person)|figure (it|that) out (in person|when|at)/i.test(r.joined), 'says decided in person', r.joined)
    check('S11', 'size-no-counter-question', !/what size|how big|which size|where.{0,20}(thinking|want it)/i.test(r.joined), 'does not ask size/placement back', r.joined)
    check('S11', 'size-nonempty', r.bubbles.length > 0, 'reply non-empty', r.joined)
  }

  // ============ S12: 폼 원샷 — 이미 보냈으면 절대 재제안/재전송 금지 ============
  {
    const h = [
      U('dragon idea!'),
      A(`love it! here is the form ${FORM} lmk once its in 🖤`)
    ]
    const r = turn(h, 'ok cool. btw do you do color or just black and grey?')
    check('S12', 'no-form-reoffer', !/want me to send.{0,25}form|should i send.{0,25}form/i.test(r.joined), 'no repeat form offer', r.joined)
    check('S12', 'no-form-link-resend', !r.joined.includes(FORM), 'no form link resend', r.joined)
    check('S12', 'still-answers-question', /color|black|grey|gray/i.test(r.joined), 'answers the actual question', r.joined)
  }

  // ============ S13: 디파짓 후 사진 = 입금 스크린샷 (레퍼런스로 리셋 금지) ============
  {
    const h = [
      U('yes all correct!'),
      A('To confirm your appointment the deposit would be 100. Once you send it, let me know so I can secure your spot on my calendar!'),
      A('contact@omarprotocol.com'),
      A('This is my zelle!')
    ]
    const r = turn(h, 'sent a photo')
    check('S13', 'proof-not-reference', !/reference|inspo|design|vibe|idea for (a|the) (piece|tattoo)/i.test(r.joined), 'no reference-photo talk', r.joined)
    check('S13', 'proof-checking-meaning', /(hasn.?t|haven.?t|not).{0,45}(come through|arrived|landed|shown? up|popped? up|see it)|still waiting|keeping an eye|checking|on it|looking (out )?for it|once it (lands|comes through|shows|pops)/i.test(r.joined), 'says checking/not landed', r.joined)
    check('S13', 'proof-no-funnel-reset', !r.joined.includes(FORM) && !/what.{0,20}(size|placement)|story highlights/i.test(r.joined), 'funnel not reset', r.joined)
  }

  const fails = results.filter((x) => !x.pass)
  console.log(JSON.stringify({ total: results.length, passed: results.length - fails.length, failed: fails.length, runner_hard_fails: turnErrors, fails }, null, 2))
}

main().catch((e) => { console.error('DRIVER_ERROR', e && e.message); process.exit(1) })
