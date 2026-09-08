#!/usr/bin/env node

const {
  describeInboundMediaForContext,
  readMediaResponseBodyWithLimit,
  MEDIA_FETCH_MAX_BYTES
} = require('./codex-dm-runner.js')

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`PASS ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ''}`)
}

function headers(values) {
  const normalized = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])
  )
  return { get: (name) => normalized[String(name || '').toLowerCase()] || null }
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]

async function run() {
  check('production hard cap is exactly 24 MiB', MEDIA_FETCH_MAX_BYTES === 24 * 1024 * 1024)

  const missingVoiceUrlInput = {
    message: 'sent a voice note',
    media_type: 'voice',
    media_urls: [],
    structured_state: { live_turn_text: 'sent a voice note' }
  }
  await describeInboundMediaForContext(missingVoiceUrlInput, {
    lookupImpl: async () => { throw new Error('missing URL must not resolve DNS') },
    fetchImpl: async () => { throw new Error('missing URL must not fetch') }
  })
  check('missing voice URL retains voice classification', missingVoiceUrlInput.structured_state.live_turn_is_voice_note === true)
  check('missing voice URL requests visible clarification',
    missingVoiceUrlInput.structured_state.live_turn_voice_transcribe_failed === true &&
    missingVoiceUrlInput.structured_state.live_turn_voice_context_unresolved === true)
  check('missing voice URL cannot drift to photo/reference',
    missingVoiceUrlInput.structured_state.live_turn_is_media_reference === false &&
    missingVoiceUrlInput.structured_state.live_turn_media_tattoo_reference === false)
  check('missing voice URL is marked resolved for deterministic routing', missingVoiceUrlInput.media_context_resolved === true)

  let unavailableVoiceFetches = 0
  const unavailableVoiceInput = {
    message: 'sent a voice note',
    media_type: 'voice',
    media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=unavailable'],
    structured_state: { live_turn_text: 'sent a voice note' }
  }
  await describeInboundMediaForContext(unavailableVoiceInput, {
    lookupImpl: publicLookup,
    setTimeoutImpl: () => 99,
    clearTimeoutImpl: () => {},
    fetchImpl: async () => {
      unavailableVoiceFetches += 1
      throw new Error('simulated_cdn_unavailable')
    }
  })
  check('unavailable voice URL attempted only through injected fetch', unavailableVoiceFetches === 1, String(unavailableVoiceFetches))
  check('unavailable voice URL retains voice classification', unavailableVoiceInput.structured_state.live_turn_is_voice_note === true)
  check('unavailable voice URL requests visible clarification',
    unavailableVoiceInput.structured_state.live_turn_voice_transcribe_failed === true &&
    unavailableVoiceInput.structured_state.live_turn_voice_context_unresolved === true)
  check('unavailable voice URL cannot drift to photo/reference',
    unavailableVoiceInput.structured_state.live_turn_is_media_reference === false &&
    unavailableVoiceInput.structured_state.live_turn_media_tattoo_reference === false)
  check('unavailable voice URL is marked resolved for deterministic routing', unavailableVoiceInput.media_context_resolved === true)

  let headerCancelled = false
  let headerTimerCleared = 0
  let headerSignal
  const headerInput = {
    message: 'sent a reference post',
    media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=oversized'],
    structured_state: { live_turn_text: 'sent a reference post' }
  }
  await describeInboundMediaForContext(headerInput, {
    maxMediaBytes: 10,
    lookupImpl: publicLookup,
    setTimeoutImpl: () => 101,
    clearTimeoutImpl: () => { headerTimerCleared += 1 },
    fetchImpl: async (_url, init) => {
      headerSignal = init.signal
      return {
        ok: true,
        status: 200,
        headers: headers({ 'content-type': 'image/jpeg', 'content-length': '11' }),
        body: {
          cancel: async () => { headerCancelled = true },
          getReader: () => { throw new Error('reader_must_not_open_after_oversized_header') }
        }
      }
    }
  })
  check('oversized header cancels response body', headerCancelled)
  check('oversized header aborts request', headerSignal?.aborted === true)
  check('oversized header clears timeout in finally', headerTimerCleared === 1, String(headerTimerCleared))
  check('oversized header holds unresolved media', headerInput.structured_state.live_turn_media_fetch_held === true)
  check('oversized header cannot become tattoo evidence', headerInput.structured_state.live_turn_reference_pointer_without_media === true)

  let streamCancelled = false
  let streamReleased = false
  let streamTimerCleared = 0
  let streamSignal
  let readIndex = 0
  const streamInput = {
    message: 'sent a reference post',
    media_urls: ['https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=chunked'],
    structured_state: { live_turn_text: 'sent a reference post' }
  }
  await describeInboundMediaForContext(streamInput, {
    maxMediaBytes: 10,
    lookupImpl: publicLookup,
    setTimeoutImpl: () => 202,
    clearTimeoutImpl: () => { streamTimerCleared += 1 },
    fetchImpl: async (_url, init) => {
      streamSignal = init.signal
      return {
        ok: true,
        status: 200,
        headers: headers({ 'content-type': 'image/jpeg' }),
        body: {
          getReader: () => ({
            read: async () => {
              readIndex += 1
              if (readIndex === 1) return { done: false, value: new Uint8Array(8) }
              if (readIndex === 2) return { done: false, value: new Uint8Array(5) }
              return { done: true }
            },
            cancel: async () => { streamCancelled = true },
            releaseLock: () => { streamReleased = true }
          })
        }
      }
    }
  })
  check('chunked overflow cancels reader', streamCancelled)
  check('chunked overflow aborts request', streamSignal?.aborted === true)
  check('chunked overflow releases reader lock', streamReleased)
  check('chunked overflow clears timeout in finally', streamTimerCleared === 1, String(streamTimerCleared))
  check('chunked overflow holds unresolved media', streamInput.structured_state.live_turn_media_oversized === true)

  const exactReader = {
    index: 0,
    read: async function () {
      this.index += 1
      if (this.index === 1) return { done: false, value: new Uint8Array([1, 2, 3, 4, 5]) }
      if (this.index === 2) return { done: false, value: new Uint8Array([6, 7, 8, 9, 10]) }
      return { done: true }
    },
    releaseLock: () => {}
  }
  const exact = await readMediaResponseBodyWithLimit({
    headers: headers({ 'content-length': '10' }),
    body: { getReader: () => exactReader }
  }, { maxBytes: 10 })
  check('exact cap remains readable', exact.length === 10, String(exact.length))

  console.log(`scv-media-fetch-cap-harness: ${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err && err.stack ? err.stack : String(err))
    process.exit(1)
  })
}

module.exports = { run }
