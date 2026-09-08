#!/usr/bin/env node
// ============================================================
// SCV MEDIA-ONLY INBOUND HARNESS — "reply to photos, don't drop them".
//
// Root cause it guards: a photo / view-once "burn" pic / voice / sticker arrives with an
// empty message_text and no accessible media object (ManyChat only forwards message_text).
// inbound-scv.js:1370 dropped it with 400 missing_contact_id_or_text -> no reply.
// Confirmed live: christian.bolanos.35977 msg 1783234824176 -> INBOUND_EMPTY_TEXT_DROP.
//
// Fix under test: pickInboundText() gives a real-but-textless inbound a synthetic
// "sent a photo" turn (like heart-reaction / reference-post already do), so normalize()
// returns non-empty text -> it passes the 1370 guard -> gets a warm human reply.
// Deterministic no-drop guarantee lives here; the reply tone is guided in the prompt.
// ============================================================
const path = require('path')
const fs = require('fs')
const inbound = require(path.join(__dirname, 'inbound-scv.js'))

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

function runScvMediaOnlyInboundHarness() {
  let checked = 0
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }
  const eq = (got, want, label) => { assert(got === want, label, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); checked++ }

  const ID = { contact_id: '1190493356', instagram_username: 'christian.bolanos.35977' }

  // 1. THE BUG: empty message_text from a real person (a photo / view-once) -> "sent a photo",
  //    NOT empty. This is what stops the 1370 empty-text drop.
  eq(inbound.normalize({ ...ID, message_text: '' }).text, 'sent a photo', 'media_only_empty_message_text_recovered')
  ok(inbound.normalize({ ...ID, message_text: '' }).text !== '', 'media_only_text_not_empty_so_not_dropped')

  // 2. No message_text key at all but a media/attachment envelope -> still recovered.
  eq(inbound.normalize({ ...ID, attachments: [{ type: 'image' }] }).text, 'sent a photo', 'media_only_attachment_envelope_recovered')
  eq(inbound.normalize({ ...ID, story_reply: {} }).text, 'sent a photo', 'media_only_story_envelope_recovered')

  // 2b. Nested ManyChat / Instagram voice envelopes must preserve their source
  // kind even when the provider gives us no text and no downloadable URL. They
  // are never photos and an object-valued `message` is never human text.
  const nestedVoice = inbound.normalize({
    ...ID,
    message: {
      attachments: [{ type: 'voice', payload: { url: '' } }]
    }
  })
  eq(nestedVoice.text, 'sent a voice note', 'nested_voice_empty_text_is_not_photo')
  eq(nestedVoice.media_type, 'voice', 'nested_voice_media_type_retained')
  ok(nestedVoice.text !== '[object Object]', 'nested_message_object_never_stringified_as_text')

  const nestedAudioMime = inbound.normalize({
    ...ID,
    message: {
      audio: { mime_type: 'audio/ogg', url: '' },
      text: ''
    }
  })
  eq(nestedAudioMime.text, 'sent a voice note', 'nested_audio_mime_empty_text_is_voice')
  eq(nestedAudioMime.media_type, 'voice', 'nested_audio_mime_type_retained')

  const captionedVoice = inbound.normalize({
    ...ID,
    message: {
      attachments: [{ type: 'audio', payload: { url: '' } }],
      text: 'can you tell me more?'
    }
  })
  eq(captionedVoice.text, 'can you tell me more?', 'voice_caption_human_text_preserved')
  eq(captionedVoice.media_type, 'voice', 'captioned_voice_media_type_retained')

  const nestedPhoto = inbound.normalize({
    ...ID,
    message: { image: {} }
  })
  eq(nestedPhoto.text, 'sent a photo', 'nested_photo_stays_photo')
  eq(nestedPhoto.media_type, 'photo', 'nested_photo_media_type_retained')

  // 3. NORMAL text is never overwritten.
  eq(inbound.normalize({ ...ID, message_text: 'hey do you do skulls?' }).text, 'hey do you do skulls?', 'normal_text_preserved')

  // 4. A genuine reference post (media object WITH identity) still routes to "sent a reference
  //    post", not the generic "sent a photo" fallback (fallback is only for no-content media).
  const refBody = { ...ID, attachment: { type: 'ig_reel', media_id: '123', url: 'https://x/y', mime_type: 'video/mp4' } }
  ok(/^sent a reference post/i.test(inbound.normalize(refBody).text), 'reference_post_still_wins_over_generic_photo', inbound.normalize(refBody).text)

  // 5. GARBAGE / no identity -> stays empty -> still correctly drops at 1370 (no false replies
  //    to system pings).
  eq(inbound.normalize({ message_text: '' }).text, '', 'no_identity_stays_empty_drops')
  eq(inbound.bodyHasMessageEnvelope({ contact_id: '1', tag: 'x' }), false, 'identity_without_message_key_not_envelope')
  eq(inbound.bodyHasMessageEnvelope({ contact_id: '1', message_text: '' }), true, 'identity_with_message_key_is_envelope')
  eq(inbound.bodyHasMessageEnvelope({ message_text: '' }), false, 'no_identity_not_envelope')

  // 5b. CONTEXT-AWARE MEDIA (Ben 2026-07-07): a photo AFTER the deposit-zelle handoff
  //     is a payment screenshot, not a reference — it must flip to the deposit-hold
  //     lane instead of resetting the funnel to design talk.
  const authority = require(path.join(__dirname, 'dm-authority.js'))
  const control = require(path.join(__dirname, 'scv-single-control-plane.js'))
  const missingVoiceContext = authority.resolveInboundMediaContext(nestedVoice, [])
  const missingVoiceState = authority.applyMediaContextToState({}, missingVoiceContext, nestedVoice)
  ok(missingVoiceContext?.resolved === true && missingVoiceContext?.is_voice_note === true,
    'normalize_to_authority_preserves_missing_voice_kind', JSON.stringify(missingVoiceContext))
  ok(missingVoiceState.live_turn_voice_transcribe_failed === true &&
    missingVoiceState.live_turn_voice_context_unresolved === true &&
    missingVoiceState.live_turn_is_media_reference !== true,
    'normalize_to_authority_adopts_unresolved_voice_state', JSON.stringify(missingVoiceState))
  const unresolvedVoice = 'sent a voice note'
  const exactVoice = 'sent a voice note saying: can I please get more information'
  ok(control.mediaContextAuthorityRank(unresolvedVoice) < control.mediaContextAuthorityRank(exactVoice),
    'plain_voice_placeholder_never_outranks_exact_transcript')
  ok(control.mediaContextAuthorityRank('sent a voice note that could not be safely loaded') === 100 &&
    control.mediaContextAuthorityRank('sent a voice note that could not be safely loaded') <
      control.mediaContextAuthorityRank(exactVoice),
    'unavailable_voice_placeholder_remains_upgradeable_unresolved_authority')
  const upgradedVoice = authority.resolveMonotonicInboundMediaContext({
    ...ID,
    thread_id: 'voice-upgrade-regression',
    message_id: 'voice-upgrade-regression-1',
    text: unresolvedVoice,
    media_type: 'voice',
    media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=voice-upgrade']
  }, [], () => ({
    resolved: true,
    text: exactVoice,
    is_voice_note: true,
    voice_transcribe_failed: false,
    voice_context_unresolved: false
  }))
  eq(upgradedVoice?.text, exactVoice, 'plain_voice_placeholder_upgrades_to_exact_transcript')
  const zelleHist = [
    { role: 'assistant', text: 'To confirm your appointment the deposit would be 100. Once you send it, let me know so I can secure your spot on my calendar!' },
    { role: 'assistant', text: 'contact@omarprotocol.com' },
    { role: 'assistant', text: 'This is my zelle!' }
  ]
  let st = authority.applyDepositProofMediaOverride({ live_turn_is_media_only_no_content: true }, zelleHist)
  ok(st.live_turn_deposit_sent === true && st.live_turn_deposit_proof_media === true, 'photo_after_handoff_is_payment_proof', JSON.stringify(st))
  ok(st.live_turn_is_media_only_no_content === false && st.live_turn_is_media_reference !== true, 'payment_proof_clears_reference_flags', JSON.stringify(st))
  st = authority.applyDepositProofMediaOverride({ live_turn_is_media_reference: true }, zelleHist)
  ok(st.live_turn_deposit_sent === true, 'reference_post_after_handoff_also_payment_proof', JSON.stringify(st))
  st = authority.applyDepositProofMediaOverride({ live_turn_is_media_reference: true }, [{ role: 'assistant', text: 'love that idea! want the form?' }])
  ok(st.live_turn_deposit_sent !== true && st.live_turn_is_media_reference === true, 'photo_without_deposit_context_stays_reference', JSON.stringify(st))
  st = authority.applyDepositProofMediaOverride({ live_turn_is_media_only_no_content: false, live_turn_is_media_reference: false }, zelleHist)
  ok(st.live_turn_deposit_sent !== true, 'text_turn_not_overridden')
  // The live text itself must be rewritten for the runner (text-keyed media rules /
  // DEPOSIT_HOLD_RE also read the raw message, state flags alone were bypassed live).
  const authoritySrc2 = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')
  ok(/live_turn_deposit_proof_media === true[\s\S]{0,200}sent the deposit payment screenshot/.test(authoritySrc2), 'payment_proof_rewrites_live_text')

  // 5c. VISION MEDIA READER (Ben 2026-07-07): CDN media URLs are collected from the
  //     webhook body, passed through, and the runner actually LOOKS at the image.
  const cdn = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123&signature=abc'
  const normMedia = inbound.normalize({ ...ID, message_text: cdn })
  ok(Array.isArray(normMedia.media_urls) && normMedia.media_urls[0] === cdn, 'cdn_url_collected', JSON.stringify(normMedia.media_urls))
  ok(/^sent a reference post/i.test(normMedia.text), 'cdn_share_still_reference_turn', normMedia.text)
  ok((inbound.normalize({ ...ID, message_text: 'hey check https://evil.example.com/x.jpg' }).media_urls || []).length === 0, 'non_cdn_hosts_never_collected')
  ok((inbound.normalize({ ...ID, message_text: 'https://attackerfbcdn.net/x.jpg' }).media_urls || []).length === 0, 'fbcdn_suffix_confusion_rejected')
  ok((inbound.normalize({ ...ID, message_text: 'https://attackercdninstagram.com/x.jpg' }).media_urls || []).length === 0, 'cdninstagram_suffix_confusion_rejected')
  ok((inbound.normalize({ ...ID, message_text: 'http://lookaside.fbsbx.com/x.jpg' }).media_urls || []).length === 0, 'cdn_http_rejected')
  ok((inbound.normalize({ ...ID, message_text: 'https://lookaside.fbsbx.com@evil.example/x.jpg' }).media_urls || []).length === 0, 'cdn_userinfo_confusion_rejected')
  ok((inbound.normalize({ ...ID, message_text: 'https://scontent.example.fbcdn.net/x.jpg' }).media_urls || [])[0] === 'https://scontent.example.fbcdn.net/x.jpg', 'real_fbcdn_subdomain_collected')
  const runnerSrc2 = fs.readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
  ok(/fetchTrustedMediaUrl/.test(runnerSrc2) && /describeInboundMediaForContext\(input\)/.test(runnerSrc2), 'vision_reader_wired_through_shared_url_policy')
  ok(/SCV_VISION_MEDIA/.test(runnerSrc2), 'vision_kill_switch_present')
  const r2 = require(path.join(__dirname, 'codex-dm-runner.js'))
  ok(r2.visionPaymentScreenshotDetected('A Zelle payment confirmation screenshot showing $100 sent') === true, 'vision_detects_payment_screenshot')
  ok(r2.visionPaymentScreenshotDetected('A flash sheet with a snake and dagger tattoo design') === false, 'vision_flash_not_payment')
  const authoritySrc3 = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')
  ok(/media_urls: Array\.isArray\(msg\.media_urls\)/.test(authoritySrc3), 'authority_passes_media_urls')
  ok(/media_type: String\(msg\.media_type/.test(authoritySrc3), 'authority_passes_inbound_media_type')
  const mediaResolverSource = fs.readFileSync(path.join(__dirname, 'scv-media-context-resolver.js'), 'utf8')
  ok(/media_type: String\(arg\.media_type/.test(mediaResolverSource), 'media_resolver_preserves_inbound_media_type')

  // 5d. STAGE GATE + SOURCE BOUNDARY (live 2026-07-27): a BYOK-dashboard screenshot
  //     sent as a reference was vision-labeled payment at the design stage and the
  //     machine description armed the availability detector; the contradictory
  //     floors that followed silenced the lead. Machine narration must never drive
  //     client-intent detectors, and a payment-looking image must not flip the
  //     deposit lane before a deposit was requested.
  ok(r2.liveProvidesAvailabilityAnswer({ structured_state: { live_turn_text: 'sent a reference post: a dashboard screenshot with results shown at 8 pm' } }) === false, 'machine_media_narration_never_availability')
  ok(r2.liveProvidesAvailabilityAnswer({ structured_state: { live_turn_text: 'sent a voice note saying: im free saturday around 2pm' } }) === true, 'voice_transcript_is_client_speech_availability')
  ok(/deposit_proof_suppressed_stage_gate/.test(authoritySrc3), 'authority_deposit_flip_stage_gated')
  ok(/deposit_proof_suppressed_stage_gate/.test(runnerSrc2), 'runner_vision_deposit_flip_stage_gated')

  // 6. Downstream wiring present (dm-authority flag + prompt rule) so the recovered turn
  //    actually produces a human photo reply, not a claim about unseen content.
  const authoritySrc = fs.readFileSync(path.join(__dirname, 'dm-authority.js'), 'utf8')
  ok(/live_turn_is_media_only_no_content/.test(authoritySrc), 'authority_sets_media_only_flag')
  ok(/sent a \(photo\|reference post\|media\)/.test(authoritySrc), 'authority_recognizes_sent_a_photo_marker')
  const runnerSrc = fs.readFileSync(path.join(__dirname, 'codex-dm-runner.js'), 'utf8')
  ok(/live_turn_is_media_only_no_content true/.test(runnerSrc) && /NEVER go silent/.test(runnerSrc), 'runner_has_media_only_reply_rule')

  // 7. A bare number in the direct text field is the client's message (live
  //    red-team 2026-09-02: "4" was replaced by the ISO received_at timestamp).
  const numericBody = (text) => ({
    contact_id: '1537753982', thread_id: '1537753982', message_id: 'numeric-probe', text, message_text: text,
    received_at: '2026-09-02T20:29:02.354Z', source_interaction_at: '2026-09-02T20:29:02.354Z'
  })
  for (const text of ['4', '31', '3:30', '4155550199', '+1 415 555 0199']) {
    const picked = inbound.pickInboundText(numericBody(text))
    ok(picked.text === text && picked.source === 'text', `numeric_direct_reply_kept_verbatim:${text}`)
  }
  const timestampOnly = inbound.pickInboundText({ contact_id: '1537753982', thread_id: '1537753982', message_id: 'ts-probe', received_at: '2026-09-02T20:29:02.354Z', source_interaction_at: '2026-09-02T20:29:02.354Z' })
  ok(!/^\d{4}-\d{2}-\d{2}T/.test(String(picked_text_of(timestampOnly))), 'timestamp_fields_never_become_client_text')

  return { ok: true, checked }
}

function picked_text_of(picked) { return String(picked?.text || '') }

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvMediaOnlyInboundHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  }
}

module.exports = { runScvMediaOnlyInboundHarness }
