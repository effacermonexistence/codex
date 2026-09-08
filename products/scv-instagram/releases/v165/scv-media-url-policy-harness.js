#!/usr/bin/env node

const {
  trustedMediaUrlVerdict,
  collectTrustedMediaUrls,
  networkAddressBlocked,
  fetchTrustedMediaUrl
} = require('./scv-media-url-policy.js')
const { describeInboundMediaForContext } = require('./codex-dm-runner.js')
const { buildRecoveryPacket } = require('./scv-manychat-orphan-recovery.js')

async function runHarness() {
  let checked = 0
  const ok = (condition, label) => {
    checked += 1
    if (!condition) throw new Error(label)
  }
  const rejects = async (factory, pattern, label) => {
    let error = null
    try { await factory() } catch (value) { error = value }
    ok(error && pattern.test(String(error?.message || error)), label)
  }
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]
  const headers = (values = {}) => ({
    get(name) {
      const key = String(name || '').toLowerCase()
      const entry = Object.entries(values).find(([candidate]) => candidate.toLowerCase() === key)
      return entry ? String(entry[1]) : null
    }
  })

  for (const url of [
    'https://lookaside.fbsbx.com/x',
    'https://fbcdn.net/x',
    'https://scontent.example.fbcdn.net/x',
    'https://cdninstagram.com/x',
    'https://scontent.example.cdninstagram.com/x'
  ]) ok(trustedMediaUrlVerdict(url).ok, `trusted_host_accepted:${url}`)

  for (const url of [
    'https://attackerfbcdn.net/x',
    'https://attackercdninstagram.com/x',
    'http://lookaside.fbsbx.com/x',
    'https://lookaside.fbsbx.com@evil.example/x',
    'https://lookaside.fbsbx.com:444/x',
    'https://127.0.0.1/x',
    'https://fbcdn.net.evil.example/x'
  ]) ok(!trustedMediaUrlVerdict(url).ok, `untrusted_url_rejected:${url}`)

  const collected = collectTrustedMediaUrls([
    'https://attackerfbcdn.net/a',
    'https://lookaside.fbsbx.com/good',
    'https://attackercdninstagram.com/b'
  ].join(' '))
  ok(JSON.stringify(collected) === JSON.stringify(['https://lookaside.fbsbx.com/good']),
    'collector_keeps_only_label_bound_https_url')

  for (const address of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1',
    '::', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', 'ff02::1',
    '2001:db8::1', '2002:7f00:1::'
  ]) ok(networkAddressBlocked(address), `non_public_address_rejected:${address}`)
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    ok(!networkAddressBlocked(address), `public_address_accepted:${address}`)
  }

  let attackerFetches = 0
  let attackerLookups = 0
  await rejects(
    () => fetchTrustedMediaUrl('https://attackerfbcdn.net/x', {
      lookupImpl: async () => { attackerLookups += 1; return [{ address: '8.8.8.8', family: 4 }] },
      fetchImpl: async () => { attackerFetches += 1; throw new Error('must_not_fetch') }
    }),
    /trusted_media_url_host_not_allowed/,
    'suffix_confusion_rejected_before_fetch'
  )
  ok(attackerFetches === 0 && attackerLookups === 0, 'suffix_confusion_has_zero_network_seams')

  let privateFetches = 0
  await rejects(
    () => fetchTrustedMediaUrl('https://lookaside.fbsbx.com/x', {
      lookupImpl: async () => [{ address: '169.254.169.254', family: 4 }],
      fetchImpl: async () => { privateFetches += 1; throw new Error('must_not_fetch') }
    }),
    /trusted_media_dns_non_public_address/,
    'private_dns_answer_rejected'
  )
  ok(privateFetches === 0, 'private_dns_answer_rejected_before_fetch')

  let redirectCancelled = false
  let redirectFetches = 0
  await rejects(
    () => fetchTrustedMediaUrl('https://lookaside.fbsbx.com/start', {
      lookupImpl: publicLookup,
      fetchImpl: async (_url, init) => {
        redirectFetches += 1
        ok(init.redirect === 'manual', 'fetch_redirect_mode_is_manual')
        return {
          status: 302,
          headers: headers({ location: 'http://169.254.169.254/latest/meta-data' }),
          body: { cancel: async () => { redirectCancelled = true } }
        }
      }
    }),
    /trusted_media_redirect_target_rejected/,
    'redirect_to_private_target_rejected'
  )
  ok(redirectFetches === 1 && redirectCancelled, 'rejected_redirect_not_followed_and_body_cancelled')

  const followed = []
  const allowedRedirectResponse = await fetchTrustedMediaUrl('https://lookaside.fbsbx.com/start', {
    lookupImpl: publicLookup,
    fetchImpl: async (url, init) => {
      followed.push({ url, redirect: init.redirect })
      if (followed.length === 1) {
        return {
          status: 302,
          headers: headers({ location: 'https://scontent.example.fbcdn.net/final' }),
          body: { cancel: async () => {} }
        }
      }
      return { status: 200, ok: true, headers: headers(), body: null }
    }
  })
  ok(allowedRedirectResponse.status === 200, 'trusted_redirect_returns_final_response')
  ok(followed.length === 2 && followed.every((entry) => entry.redirect === 'manual'),
    'every_redirect_hop_is_manual_and_revalidated')

  let unexpectedFinalCancelled = false
  await rejects(
    () => fetchTrustedMediaUrl('https://lookaside.fbsbx.com/start', {
      lookupImpl: publicLookup,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        url: 'http://169.254.169.254/latest/meta-data',
        headers: headers(),
        body: { cancel: async () => { unexpectedFinalCancelled = true } }
      })
    }),
    /trusted_media_unexpected_final_url/,
    'unexpected_followed_final_url_rejected'
  )
  ok(unexpectedFinalCancelled, 'unexpected_final_response_body_cancelled')

  let runnerFetches = 0
  let runnerLookups = 0
  process.env.SCV_VISION_ALLOW_ANY_HOST = '1'
  await describeInboundMediaForContext({
    media_urls: ['https://attackerfbcdn.net/x'],
    structured_state: {}
  }, {
    lookupImpl: async () => { runnerLookups += 1; return [{ address: '8.8.8.8', family: 4 }] },
    fetchImpl: async () => { runnerFetches += 1; throw new Error('must_not_fetch') },
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {}
  })
  delete process.env.SCV_VISION_ALLOW_ANY_HOST
  ok(runnerFetches === 0 && runnerLookups === 0,
    'legacy_allow_any_host_flag_cannot_bypass_runner_boundary')

  let orphanRejected = false
  try {
    buildRecoveryPacket({
      id: '123456789',
      ig_username: 'client',
      last_input_text: 'https://attackerfbcdn.net/x',
      ig_last_interaction: '2026-08-20T00:00:00.000Z'
    })
  } catch (error) {
    orphanRejected = /missing_human_last_input_text/.test(String(error?.message || error))
  }
  ok(orphanRejected, 'orphan_recovery_suffix_confusion_rejected')
  const orphanAllowed = buildRecoveryPacket({
    id: '123456789',
    ig_username: 'client',
    last_input_text: 'https://scontent.example.fbcdn.net/x',
    ig_last_interaction: '2026-08-20T00:00:00.000Z'
  })
  ok(orphanAllowed.media_urls[0] === 'https://scontent.example.fbcdn.net/x',
    'orphan_recovery_label_bound_media_preserved')

  return {
    ok: true,
    lock_version: 'scv-media-url-policy-harness-2026-08-20-v1-label-dns-redirect-lock',
    checked,
    network: false
  }
}

if (require.main === module) {
  runHarness()
    .then((receipt) => console.log(JSON.stringify(receipt, null, 2)))
    .catch((error) => {
      console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2))
      process.exit(1)
    })
}

module.exports = { runHarness }
