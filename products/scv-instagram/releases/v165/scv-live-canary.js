#!/usr/bin/env node
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { URL } = require('url')

const DEFAULT_BASE_URL = process.env.SCV_PUBLIC_BASE_URL || 'https://scv-dm-cloud-survival-production.up.railway.app'
const DEFAULT_CONTACT_ID = process.env.SCV_CANARY_CONTACT_ID || process.env.SCV_FAST_TARGET_CONTACT_IDS || '1537753982'
const DEFAULT_USERNAME = process.env.SCV_CANARY_INSTAGRAM_USERNAME || process.env.SCV_FAST_TARGET_USERNAMES || 'omar.system'

function argValue(name, fallback = '') {
  const idx = process.argv.indexOf(name)
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function requestJson(method, urlValue, body = null, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue)
    const lib = url.protocol === 'https:' ? https : http
    const raw = body ? JSON.stringify(body) : ''
    const inboundSecret = String(process.env.SCV_MANYCHAT_INGRESS_SECRET || '')
    const adminSecret = String(process.env.SCV_ADMIN_SHARED_SECRET || '')
    const authHeaders = url.pathname === '/stability'
      ? (adminSecret ? { 'x-scv-admin-token': adminSecret } : {})
      : (inboundSecret ? { 'x-scv-ingress-token': inboundSecret } : {})
    const req = lib.request(url, {
      method,
      timeout: timeoutMs,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(raw),
        ...authHeaders
      }
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = data ? JSON.parse(data) : null } catch {}
        resolve({ status: res.statusCode, body: parsed, raw: data })
      })
    })
    req.on('timeout', () => req.destroy(new Error('request_timeout')))
    req.on('error', reject)
    if (raw) req.write(raw)
    req.end()
  })
}

async function runPublicLiveCanary() {
  const baseUrl = argValue('--base-url', DEFAULT_BASE_URL).replace(/\/+$/, '')
  const contactId = argValue('--contact-id', String(DEFAULT_CONTACT_ID).split(',')[0].trim())
  const username = argValue('--username', String(DEFAULT_USERNAME).split(',')[0].trim())
  const canaryId = argValue('--message-id', `scv-live-canary-${Date.now()}`)
  const text = argValue('--text', 'where are you located?')
  const timeoutMs = Number(argValue('--timeout-ms', '90000'))
  const pollMs = Number(argValue('--poll-ms', '2000'))

  if (!hasFlag('--live-send') && process.env.SCV_CANARY_LIVE_SEND !== '1') {
    throw new Error('live_canary_requires_--live-send_or_SCV_CANARY_LIVE_SEND=1')
  }

  const inboundBody = {
    contact_id: contactId,
    thread_id: contactId,
    instagram_username: username,
    message_id: canaryId,
    message_text: text,
    text,
    canary: true,
    canary_kind: 'live_ingress_to_manychat_delivery'
  }

  const post = await requestJson('POST', `${baseUrl}/manychat/inbound`, inboundBody)
  if (!(post.status >= 200 && post.status < 300 && post.body?.ok)) {
    throw new Error(`canary_inbound_failed_${post.status}:${post.raw}`)
  }

  const deadline = Date.now() + timeoutMs
  const canaryMessageSha256 = crypto.createHash('sha256')
    .update(String(canaryId).trim().toLowerCase())
    .digest('hex')
  let lastStability = null
  while (Date.now() < deadline) {
    const stability = await requestJson('GET', `${baseUrl}/stability`)
    lastStability = stability.body
    const last = stability.body?.last_delivery
    if (
      String(last?.message_sha256 || '') === canaryMessageSha256 &&
      (last?.delivery_accepted === true || last?.delivery_confirmed === true)
    ) {
      return {
        ok: true,
        canary_id: canaryId,
        inbound: post.body,
        delivery: last,
        stability: stability.body
      }
    }
    await sleep(pollMs)
  }

  throw new Error(`canary_delivery_timeout:${JSON.stringify({ canary_id: canaryId, last_stability: lastStability }, null, 2)}`)
}

async function main() {
  const result = await runPublicLiveCanary()
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 2))
    process.exit(1)
  })
}

module.exports = {
  runPublicLiveCanary
}
