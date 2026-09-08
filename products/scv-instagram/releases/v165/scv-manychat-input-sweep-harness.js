#!/usr/bin/env node
// ============================================================
// SCV MANYCHAT INPUT SWEEP HARNESS — "ManyChat got it, webhook didn't" recovery.
//
// Live case it guards: christian.bolanos.35977's phone number "4157602883" sat in
// ManyChat (getInfo last_input_text) while our webhook never received it -> no reply.
// Asserts: phone-shaped turns are recoverable, fresh missed inputs are enqueued,
// handled/aged/test inputs are not, and the sweep loop is wired into cloud-start.
// ============================================================
const path = require('path')
const fs = require('fs')
const os = require('os')
const {
  SCV_MANYCHAT_INPUT_SWEEP_LOCK_VERSION,
  classifySweepCandidate,
  sweepOnce,
  defaultSkipLists,
  defaultWatchContactIds,
  listSweepContactIds
} = require(path.join(__dirname, 'scv-manychat-input-sweep.js'))
const { buildRecoveryPacket } = require(path.join(__dirname, 'scv-manychat-orphan-recovery.js'))

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

async function runScvManychatInputSweepHarness() {
  let checked = 0
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }
  const NOW = Date.parse('2026-07-06T00:00:00Z')
  const skip = { contactIds: new Set(['1537753982']), usernames: new Set(['omar.system']) }
  const fresh = new Date(NOW - 60 * 60 * 1000).toISOString()      // 1h ago
  const stale = new Date(NOW - 40 * 60 * 60 * 1000).toISOString() // 40h ago
  const mediaUrl = 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset=omar-latest-media'

  ok(SCV_MANYCHAT_INPUT_SWEEP_LOCK_VERSION === 'scv-manychat-input-sweep-lock-2026-07-12-v2-media-debug-watch', 'sweep_lock_version_exact')

  // 1. THE CHRISTIAN CASE: phone-number-only last input is a recoverable human turn.
  const phonePacket = buildRecoveryPacket({ id: '1190493356', ig_username: 'christian.bolanos.35977', last_input_text: '4157602883', ig_last_interaction: fresh })
  ok(phonePacket.text === '4157602883', 'phone_only_input_builds_packet')

  const phoneVerdict = classifySweepCandidate({ info: { id: '1190493356', ig_username: 'c', last_input_text: '4157602883', ig_last_interaction: fresh }, now: NOW, maxAgeMs: 24 * 3600e3, skip })
  ok(phoneVerdict.action === 'recover', 'phone_missed_input_recovered', JSON.stringify(phoneVerdict))

  // 2. Fresh human text -> recover; aged-out (>24h, undeliverable 3031) -> skip.
  ok(classifySweepCandidate({ info: { id: '2', last_input_text: 'hey can i book?', ig_last_interaction: fresh }, now: NOW, maxAgeMs: 24 * 3600e3, skip }).action === 'recover', 'fresh_text_recovered')
  const aged = classifySweepCandidate({ info: { id: '3', last_input_text: 'hello?', ig_last_interaction: stale }, now: NOW, maxAgeMs: 24 * 3600e3, skip })
  ok(aged.action === 'skip' && aged.reason === 'aged_out_window_closed', 'aged_out_skipped')

  // 3. Explicit excludes and junk inputs never sweep; trusted IG media does.
  ok(classifySweepCandidate({ info: { id: '1537753982', last_input_text: 'test', ig_last_interaction: fresh }, now: NOW, maxAgeMs: 24 * 3600e3, skip }).reason === 'explicitly_skipped_account', 'explicit_contact_id_skipped')
  ok(classifySweepCandidate({ info: { id: '9', ig_username: 'OMAR.SYSTEM', last_input_text: 'x', ig_last_interaction: fresh }, now: NOW, maxAgeMs: 24 * 3600e3, skip }).reason === 'explicitly_skipped_account', 'explicit_username_skipped_case_insensitive')
  ok(classifySweepCandidate({ info: { id: '4', last_input_text: 'https://x.co/y', ig_last_interaction: fresh }, now: NOW, maxAgeMs: 24 * 3600e3, skip }).action === 'skip', 'url_input_skipped')
  const mediaVerdict = classifySweepCandidate({ info: { id: '7', last_input_text: mediaUrl, ig_last_interaction: fresh }, now: NOW, maxAgeMs: 24 * 3600e3, skip: { contactIds: new Set(), usernames: new Set() } })
  ok(mediaVerdict.action === 'recover', 'trusted_media_url_recovered', JSON.stringify(mediaVerdict))
  ok(mediaVerdict.packet.text === 'sent a reference post' && mediaVerdict.packet.media_urls[0] === mediaUrl, 'trusted_media_packet_preserves_url_outside_text')
  ok(classifySweepCandidate({ info: { id: '5', last_input_text: '{{placeholder}}', ig_last_interaction: fresh }, now: NOW, maxAgeMs: 24 * 3600e3, skip }).action === 'skip', 'placeholder_skipped')
  ok(classifySweepCandidate({ info: { id: '6', last_input_text: '12', ig_last_interaction: fresh }, now: NOW, maxAgeMs: 24 * 3600e3, skip }).action === 'skip', 'too_short_digits_skipped')

  // 4. sweepOnce end-to-end with injected deps: recovers exactly the unprocessed fresh turn.
  const written = []
  const summary = await sweepOnce({
    root: '/tmp/unused',
    now: NOW,
    maxAgeMs: 24 * 3600e3,
    skip,
    callGapMs: 0,
    contactIds: ['1190493356', '777', '888'],
    getInfo: async (id) => ({
      '1190493356': { id, ig_username: 'christian', last_input_text: '4157602883', ig_last_interaction: fresh },
      '777': { id, ig_username: 'answered', last_input_text: 'already answered', ig_last_interaction: fresh },
      '888': { id, ig_username: 'old', last_input_text: 'too old', ig_last_interaction: stale }
    }[id]),
    hasProcessed: (r, p) => p.contact_id === '777',
    writePacket: (r, p) => { written.push(p.contact_id); return { ok: true, skipped: false } }
  })
  ok(summary.scanned === 3 && summary.recovered === 1, 'sweep_recovers_only_missed', JSON.stringify(summary))
  ok(written.length === 1 && written[0] === '1190493356', 'christian_class_enqueued')
  ok(summary.skipped.already_processed === 1 && summary.skipped.aged_out_window_closed === 1, 'dedup_and_age_gate_applied', JSON.stringify(summary.skipped))

  // 5. Wiring: cloud-start spawns the sweep loop; kill switch present.
  const bootSrc = fs.readFileSync(path.join(__dirname, 'cloud-start.js'), 'utf8')
  ok(/manychat-input-sweep.*scv-manychat-input-sweep\.js.*--loop/.test(bootSrc), 'cloud_start_spawns_sweep_loop')
  const sweepSrc = fs.readFileSync(path.join(__dirname, 'scv-manychat-input-sweep.js'), 'utf8')
  ok(/SCV_MANYCHAT_INPUT_SWEEP/.test(sweepSrc) && /hasProcessedLatestInput/.test(sweepSrc), 'kill_switch_and_dedup_present')

  // 6. Debug accounts are watched, not skipped, even after startup purge removed
  // their thread-state. Canary remains the only default exclusion.
  const env = {
    SCV_FAST_TARGET_USERNAMES: 'omar.system',
    SCV_FAST_TARGET_CONTACT_IDS: '1537753982',
    SCV_PURGE_TEST_CONTACT_IDS: '1537753982',
    SCV_CANARY_INSTAGRAM_USERNAME: 'scv.canary',
    SCV_CANARY_CONTACT_ID: '999'
  }
  const skips = defaultSkipLists(env)
  ok(!skips.usernames.has('omar.system') && !skips.contactIds.has('1537753982'), 'debug_target_not_default_skipped')
  ok(skips.usernames.has('scv.canary') && skips.contactIds.has('999'), 'canary_remains_default_skipped')
  const watched = defaultWatchContactIds(env)
  ok(watched.has('1537753982'), 'debug_target_is_default_watched')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-sweep-watch-'))
  fs.mkdirSync(path.join(tmp, 'thread-state'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'thread-state', '123.json'), '{}\n')
  const sweepIds = listSweepContactIds(tmp, 300, env)
  ok(sweepIds.includes('1537753982') && sweepIds.includes('123'), 'watch_target_survives_missing_thread_state', JSON.stringify(sweepIds))

  return { ok: true, checked }
}

if (require.main === module) {
  runScvManychatInputSweepHarness()
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => {
      console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
      process.exit(1)
    })
}

module.exports = { runScvManychatInputSweepHarness }
