#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  SCV_MEDIA_CONTAINER_VERSION,
  sniffImageMime,
  inspectIsoBmffTracks,
  classifyDownloadedMedia,
  extractVideoPreviewFrame
} = require(path.join(__dirname, 'scv-media-container.js'))
const {
  SCV_MEDIA_TURN_COALESCING_VERSION,
  mediaCarryForwardVerdict,
  coalesceReferenceMediaIntoTarget
} = require(path.join(__dirname, 'scv-media-turn-coalescing.js'))

const HARNESS_VERSION =
  'scv-media-attachment-continuity-harness-2026-09-01-v1-live-failure-shape'

function box(type, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  const out = Buffer.alloc(8 + body.length)
  out.writeUInt32BE(out.length, 0)
  out.write(type, 4, 4, 'ascii')
  body.copy(out, 8)
  return out
}

function handlerBox(type) {
  return box('hdlr', Buffer.concat([
    Buffer.alloc(8),
    Buffer.from(type, 'ascii'),
    Buffer.alloc(12)
  ]))
}

function isoFixture(handlerTypes) {
  const ftyp = box('ftyp', Buffer.concat([
    Buffer.from('isom', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('isomiso2mp41', 'ascii')
  ]))
  const tracks = handlerTypes.map((type) => box('trak', box('mdia', handlerBox(type))))
  return Buffer.concat([ftyp, box('moov', Buffer.concat(tracks))])
}

function basePacket(overrides = {}) {
  return {
    contact_id: '1537753982',
    thread_id: '1537753982',
    message_id: 'legacy-manychat-source',
    message_id_authority: 'provider_verified_legacy_manychat',
    instagram_username: 'omar.system',
    text: 'sent a reference post',
    text_source: 'reference_post.message_text',
    media_type: '',
    media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=harness'],
    source_interaction_at: '2026-09-01T23:57:33.000Z',
    received_at: '2026-09-01T23:57:33.865Z',
    raw_body_sha256: '1'.repeat(64),
    ...overrides
  }
}

function runHarness() {
  const failures = []
  let checked = 0
  const check = (name, condition, detail = '') => {
    checked += 1
    if (!condition) failures.push({ name, detail })
  }

  const video = isoFixture(['vide', 'soun'])
  const voice = isoFixture(['soun'])
  const videoInfo = inspectIsoBmffTracks(video)
  const voiceInfo = inspectIsoBmffTracks(voice)
  check('video_track_detected', videoInfo.has_video_track && videoInfo.has_audio_track, JSON.stringify(videoInfo))
  check('audio_only_track_detected', !voiceInfo.has_video_track && voiceInfo.has_audio_track, JSON.stringify(voiceInfo))
  check('video_mp4_never_classified_as_voice', classifyDownloadedMedia(video, 'video/mp4', '').kind === 'video')
  check('audio_only_video_mp4_is_voice_eligible', classifyDownloadedMedia(voice, 'video/mp4', '').kind === 'audio')

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120), Buffer.from([0xff, 0xd9])])
  check('jpeg_magic_outranks_empty_media_type', sniffImageMime(jpeg) === 'image/jpeg')
  check('screenshot_jpeg_classified_as_image', classifyDownloadedMedia(jpeg, 'image/jpeg', '').kind === 'image')

  const preview = extractVideoPreviewFrame(video, {
    spawnSyncImpl: () => ({ status: 0, stdout: jpeg, stderr: Buffer.alloc(0) })
  })
  check('video_preview_frame_adopted_only_as_jpeg', preview.ok === true && preview.mime === 'image/jpeg')
  const badPreview = extractVideoPreviewFrame(video, {
    spawnSyncImpl: () => ({ status: 0, stdout: Buffer.from('not an image'), stderr: Buffer.alloc(0) })
  })
  check('non_image_preview_rejected', badPreview.ok === false)
  const { verifyVideoPreviewRuntime } = require(path.join(__dirname, 'scv-single-release-entry.js'))
  const runtimeGate = verifyVideoPreviewRuntime({}, () => ({
    status: 0,
    stdout: 'ffmpeg version 5.1.8 harness\n'
  }))
  check('single_release_startup_requires_ffmpeg', runtimeGate.ok === true)
  let missingRuntimeRejected = false
  try {
    verifyVideoPreviewRuntime({}, () => ({ status: 127, stdout: '' }))
  } catch (error) {
    missingRuntimeRejected = String(error?.message || '') === 'single_release_video_preview_runtime_missing'
  }
  check('single_release_startup_rejects_missing_ffmpeg', missingRuntimeRejected)

  const target = basePacket({
    message_id: 'legacy-manychat-target',
    text: 'I mean this one',
    text_source: 'message_text',
    media_urls: [],
    source_interaction_at: '2026-09-01T23:57:37.000Z',
    received_at: '2026-09-01T23:57:39.198Z',
    raw_body_sha256: '2'.repeat(64)
  })
  const liveShape = mediaCarryForwardVerdict(basePacket(), target)
  check('exact_live_screenshot_selector_shape_admitted', liveShape.ok === true && liveShape.gap_ms === 4000, JSON.stringify(liveShape))
  const adopted = coalesceReferenceMediaIntoTarget(basePacket(), target, { now: '2026-09-02T00:00:00.000Z' })
  check('trusted_url_carried_to_latest_selector', adopted.adopted === true && adopted.packet.media_urls.length === 1)
  check('source_provenance_bound_to_latest_selector', adopted.packet.media_coalesced_from_message_id === 'legacy-manychat-source')
  check('selector_text_preserved_until_media_resolution', adopted.packet.text === 'I mean this one')

  check('cross_thread_media_rejected', mediaCarryForwardVerdict(basePacket(), { ...target, thread_id: 'other' }).ok === false)
  check('stale_media_rejected', mediaCarryForwardVerdict(basePacket(), { ...target, source_interaction_at: '2026-09-01T23:58:33.000Z' }).ok === false)
  check('future_media_rejected', mediaCarryForwardVerdict(basePacket(), { ...target, source_interaction_at: '2026-09-01T23:57:30.000Z' }).ok === false)
  check('guessed_authority_rejected', mediaCarryForwardVerdict({ ...basePacket(), message_id_authority: 'ambiguous_arrival' }, target).ok === false)
  check('untrusted_host_rejected', mediaCarryForwardVerdict({ ...basePacket(), media_urls: ['https://evil.example/x.jpg'] }, target).ok === false)
  check('calendar_divergence_not_media_selector', mediaCarryForwardVerdict(basePacket(), { ...target, text: 'can we do 3 pm' }).ok === false)
  check('self_contained_ack_not_media_selector', mediaCarryForwardVerdict(basePacket(), { ...target, text: 'this is perfect' }).ok === false)
  check('target_with_own_media_not_overwritten', mediaCarryForwardVerdict(basePacket(), { ...target, media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=newer'] }).ok === false)

  // Actual inbox-worker integration: before quarantining the screenshot packet,
  // the authoritative selector file receives the exact trusted media evidence.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-media-coalescing-'))
  try {
    process.env.SCV_ROOT = root
    const inbox = path.join(root, 'inbox')
    const stateDir = path.join(root, 'thread-state')
    fs.mkdirSync(inbox, { recursive: true })
    fs.mkdirSync(stateDir, { recursive: true })
    const sourceFile = path.join(inbox, 'source.json')
    const targetFile = path.join(inbox, 'target.json')
    fs.writeFileSync(sourceFile, `${JSON.stringify(basePacket())}\n`, { mode: 0o600 })
    fs.writeFileSync(targetFile, `${JSON.stringify(target)}\n`, { mode: 0o600 })
    fs.writeFileSync(path.join(stateDir, '1537753982.json'), `${JSON.stringify({
      latest_ingress_message_id: target.message_id,
      latest_ingress_at: target.source_interaction_at
    })}\n`, { mode: 0o600 })

    delete require.cache[require.resolve(path.join(__dirname, 'inbox-worker.js'))]
    const worker = require(path.join(__dirname, 'inbox-worker.js'))
    const quarantined = worker.sweepSupersededInboxFiles()
    const integrated = JSON.parse(fs.readFileSync(targetFile, 'utf8'))
    check('inbox_worker_adopts_media_before_supersession', integrated.media_coalesced_from_message_id === basePacket().message_id, JSON.stringify(integrated))
    check('inbox_worker_preserves_selector_packet_media', integrated.media_urls?.[0] === basePacket().media_urls[0])
    check('inbox_worker_still_quarantines_old_envelope', quarantined.length === 1 && !fs.existsSync(sourceFile), JSON.stringify(quarantined))
  } finally {
    delete process.env.SCV_ROOT
    fs.rmSync(root, { recursive: true, force: true })
  }

  check('container_version_locked', SCV_MEDIA_CONTAINER_VERSION.includes('track-aware-video-preview'))
  check('coalescing_version_locked', SCV_MEDIA_TURN_COALESCING_VERSION.includes('authenticated-adjacent-reference'))

  if (failures.length) {
    const error = new Error(`scv_media_attachment_continuity_harness_failed:${JSON.stringify(failures)}`)
    error.failures = failures
    throw error
  }
  return { ok: true, locked: true, lock_version: HARNESS_VERSION, checked }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runHarness(), null, 2))
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: String(error?.message || error), failures: error?.failures || [] }, null, 2))
    process.exit(1)
  }
}

module.exports = { HARNESS_VERSION, runHarness }
