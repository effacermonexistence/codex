#!/usr/bin/env node
// ============================================================
// SCV MEDIA CONTEXT RESOLVER — dm-authority가 structured_state를 만들기 전에
// 보이스/이미지를 해석하기 위한 동기 스폰용 헬퍼.
//
// 왜: 러너 안에서는 전사→의도분류 순서라 그 턴의 모델은 알아듣지만,
// dm-authority의 결정론 상태(제출 시그널, 디파짓, 날짜 수락, Gmail 자동주입,
// thread-state 영구 기억)는 전사 전의 "sent a reference post"만 봐서 장님이었다.
// 라이브 증거(2026-07-08 클린런): 보이스로 "I just sent you"라고 했는데
// known_form_submitted가 영구화되지 않아 두 턴 뒤 "did you get the form yet"을
// 다시 물었다. 이 헬퍼가 상태 조립 전에 텍스트를 진실로 바꾼다.
//
// stdin이 아니라 argv[2]로 {text, media_urls} JSON을 받고, stdout 마지막 줄에
// {ok, resolved, text, is_voice_note, is_media_reference, deposit_proof} JSON을
// 찍는다. 어떤 실패든 fail-open(resolved:false) — 기존 러너 경로가 그대로 커버.
// ============================================================
const path = require('path')
const runner = require(path.join(__dirname, 'codex-dm-runner.js'))

async function main() {
  let out = { ok: true, resolved: false, text: '', is_voice_note: false, is_media_reference: false, media_category: '', is_tattoo_reference: false, deposit_proof: false, voice_transcribe_failed: false, voice_context_unresolved: false }
  try {
    const arg = JSON.parse(process.argv[2] || '{}')
    const originalText = String(arg.text || '')
    out.text = originalText
    const pseudo = {
      message: originalText,
      media_type: String(arg.media_type || ''),
      media_urls: Array.isArray(arg.media_urls) ? arg.media_urls.slice(0, 3) : [],
      recent_history: Array.isArray(arg.recent_history) ? arg.recent_history.slice(-8) : [],
      structured_state: { live_turn_text: originalText }
    }
    await runner.describeInboundMediaForContext(pseudo)
    const st = pseudo.structured_state || {}
    const newText = String(st.live_turn_text || pseudo.message || originalText)
    if (newText && newText !== originalText) {
      out.resolved = true
      out.text = newText
      out.is_voice_note = st.live_turn_is_voice_note === true
      out.is_media_reference = st.live_turn_is_media_reference === true
      out.media_category = String(st.live_turn_media_category || '')
      out.is_tattoo_reference = st.live_turn_media_tattoo_reference === true
      out.deposit_proof = st.live_turn_deposit_proof_media === true
      out.voice_transcribe_failed = st.live_turn_voice_transcribe_failed === true
      out.voice_context_unresolved = st.live_turn_voice_context_unresolved === true
      out.voice_transcription_diagnostic = st.live_turn_voice_transcription_diagnostic || null

      // ROOT FIX (Ben 2026-07-08: "패치 말고 오류 루트를 잡아라"): ASR transcripts
      // are noisy by nature (whisper heard "I'll just send you" for "I just sent
      // you"), so meaning-critical gates must not read them as exact strings.
      // Classify the transcript's MEANING with conversation-stage context and
      // return the promoted state flags; string regexes stay as the floor.
      if (out.is_voice_note && !out.voice_transcribe_failed && !out.voice_context_unresolved && runner.llmIntentEnabled()) {
        try {
          const pseudo2 = {
            message: newText,
            recent_history: Array.isArray(arg.recent_history) ? arg.recent_history.slice(-8) : [],
            structured_state: { live_turn_text: newText }
          }
          const intent = await runner.classifyLiveTurnIntent(pseudo2)
          if (intent) {
            runner.mergeIntentFlags(pseudo2, intent)
            const flags = {}
            for (const [k, v] of Object.entries(pseudo2.structured_state || {})) {
              if (v === true && k !== 'live_turn_text') flags[k] = true
            }
            out.state_flags = flags
            // Preserve the complete bounded discourse decision across the helper
            // process boundary.  Boolean-only export discarded relation,
            // confidence, reason, and grounded antecedent, then told the main
            // runner to skip classification.  That made semantically detected
            // missing referents disappear for variants not covered by the
            // structural floor.
            out.intent_adoption_state = runner.buildIntentAdoptionState(pseudo2)
            out.intent_classified = true
          }
        } catch {}
      }
    }
  } catch (err) {
    out.ok = false
    out.error = String(err && err.message ? err.message : err).slice(0, 120)
  }
  console.log(JSON.stringify(out))
}

if (require.main === module) {
  main().catch((err) => {
    console.log(JSON.stringify({ ok: false, resolved: false, error: String(err && err.message ? err.message : err).slice(0, 120) }))
  })
}
