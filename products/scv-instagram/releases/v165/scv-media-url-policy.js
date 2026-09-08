#!/usr/bin/env node

// One fail-closed URL boundary for inbound Instagram / Facebook CDN media.
// Untrusted DM text can name a URL, so string suffix tests are not sufficient:
// every URL must have an exact DNS-label relationship to a Meta CDN host, and
// the final server-side fetch must reject redirects or DNS answers that leave
// the public Internet.
const dns = require('dns')
const net = require('net')

const EXACT_MEDIA_HOSTS = Object.freeze(['lookaside.fbsbx.com'])
const MEDIA_HOST_SUFFIXES = Object.freeze(['fbcdn.net', 'cdninstagram.com'])
const MAX_MEDIA_URL_CHARS = 8192
const MAX_MEDIA_REDIRECTS = 3
const URL_CANDIDATE_RE = /https?:\/\/[^\s"'<>\\]+/gi

function normalizedHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '')
}

function mediaHostnameAllowed(hostname) {
  const host = normalizedHostname(hostname)
  if (!host || net.isIP(host)) return false
  if (EXACT_MEDIA_HOSTS.includes(host)) return true
  return MEDIA_HOST_SUFFIXES.some((suffix) =>
    host === suffix || host.endsWith(`.${suffix}`)
  )
}

function trustedMediaUrlVerdict(value) {
  const raw = String(value || '').trim()
  if (!raw || raw.length > MAX_MEDIA_URL_CHARS) {
    return { ok: false, reason: 'trusted_media_url_length_invalid', url: '' }
  }
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return { ok: false, reason: 'trusted_media_url_invalid', url: '' }
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'trusted_media_url_https_required', url: '' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'trusted_media_url_credentials_forbidden', url: '' }
  }
  // URL normalizes an explicit :443 to an empty port. Any remaining port is
  // non-standard and unnecessary for the official CDN path.
  if (parsed.port) {
    return { ok: false, reason: 'trusted_media_url_port_forbidden', url: '' }
  }
  if (!mediaHostnameAllowed(parsed.hostname)) {
    return { ok: false, reason: 'trusted_media_url_host_not_allowed', url: '' }
  }
  return {
    ok: true,
    reason: 'trusted_media_url_allowed',
    url: parsed.href,
    hostname: normalizedHostname(parsed.hostname)
  }
}

function isTrustedMediaUrl(value) {
  return trustedMediaUrlVerdict(value).ok
}

function collectTrustedMediaUrls(value, maxUrls = 3) {
  const limit = Number.isSafeInteger(maxUrls) && maxUrls > 0 ? maxUrls : 3
  const candidates = String(value || '').match(URL_CANDIDATE_RE) || []
  const urls = []
  const seen = new Set()
  for (const candidate of candidates) {
    const decoded = String(candidate)
      .replace(/\\\//g, '/')
      .replace(/\\u0026/gi, '&')
      .replace(/&amp;/gi, '&')
    const verdict = trustedMediaUrlVerdict(decoded)
    if (!verdict.ok || seen.has(verdict.url)) continue
    seen.add(verdict.url)
    urls.push(verdict.url)
    if (urls.length >= limit) break
  }
  return urls
}

function parseIpv4(address) {
  const parts = String(address || '').split('.')
  if (parts.length !== 4) return null
  const bytes = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN
    const value = Number(part)
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : NaN
  })
  return bytes.every(Number.isFinite) ? bytes : null
}

function ipv4Blocked(address) {
  const bytes = Array.isArray(address) ? address : parseIpv4(address)
  if (!bytes) return true
  const [a, b, c] = bytes
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
}

function ipv6Bytes(address) {
  let raw = String(address || '').trim().toLowerCase()
  if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1)
  if (raw.includes('%')) return null
  if (raw.includes('.')) {
    const separator = raw.lastIndexOf(':')
    if (separator < 0) return null
    const ipv4 = parseIpv4(raw.slice(separator + 1))
    if (!ipv4) return null
    raw = `${raw.slice(0, separator)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`
  }
  const halves = raw.split('::')
  if (halves.length > 2) return null
  const parseHalf = (half) => half
    ? half.split(':').map((part) => (/^[a-f0-9]{1,4}$/.test(part) ? Number.parseInt(part, 16) : NaN))
    : []
  const left = parseHalf(halves[0])
  const right = parseHalf(halves[1] || '')
  if (![...left, ...right].every(Number.isFinite)) return null
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const words = halves.length === 2
    ? [...left, ...new Array(missing).fill(0), ...right]
    : left
  if (words.length !== 8) return null
  return words.flatMap((word) => [(word >> 8) & 0xff, word & 0xff])
}

function ipv6Blocked(address) {
  const bytes = ipv6Bytes(address)
  if (!bytes) return true
  const allZero = bytes.every((value) => value === 0)
  const loopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1
  if (allZero || loopback) return true
  const mappedIpv4 = bytes.slice(0, 10).every((value) => value === 0) &&
    bytes[10] === 0xff && bytes[11] === 0xff
  if (mappedIpv4) return ipv4Blocked(bytes.slice(12))
  // Only globally routable 2000::/3 answers are accepted. This excludes ULA,
  // link-local, multicast, IPv4-compatible, NAT64, and other special ranges.
  if ((bytes[0] & 0xe0) !== 0x20) return true
  // Documentation, Teredo, and 6to4 transition ranges are not valid CDN
  // destinations and can encode otherwise forbidden targets.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true
  return false
}

function networkAddressBlocked(address) {
  const value = String(address || '').trim()
  const family = net.isIP(value)
  if (family === 4) return ipv4Blocked(value)
  if (family === 6) return ipv6Blocked(value)
  return true
}

async function assertTrustedMediaResolution(value, options = {}) {
  const verdict = trustedMediaUrlVerdict(value)
  if (!verdict.ok) throw new Error(verdict.reason)
  const lookup = typeof options.lookupImpl === 'function'
    ? options.lookupImpl
    : dns.promises.lookup
  let answers
  try {
    const lookupPromise = Promise.resolve().then(() =>
      lookup(verdict.hostname, { all: true, verbatim: true })
    )
    const signal = options.signal
    if (!signal) {
      answers = await lookupPromise
    } else {
      if (signal.aborted) throw new Error('trusted_media_dns_lookup_aborted')
      let abortListener
      const aborted = new Promise((_, reject) => {
        abortListener = () => reject(new Error('trusted_media_dns_lookup_aborted'))
        signal.addEventListener('abort', abortListener, { once: true })
      })
      try {
        answers = await Promise.race([lookupPromise, aborted])
      } finally {
        signal.removeEventListener('abort', abortListener)
      }
    }
  } catch {
    throw new Error('trusted_media_dns_lookup_failed')
  }
  const entries = Array.isArray(answers) ? answers : [answers]
  if (!entries.length) throw new Error('trusted_media_dns_answer_missing')
  for (const entry of entries) {
    const address = typeof entry === 'string' ? entry : entry?.address
    if (networkAddressBlocked(address)) {
      throw new Error('trusted_media_dns_non_public_address')
    }
  }
  return verdict
}

async function cancelResponseBody(response, reason) {
  try {
    if (response?.body && typeof response.body.cancel === 'function') {
      await response.body.cancel(reason)
    }
  } catch {}
}

async function fetchTrustedMediaUrl(value, options = {}) {
  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch
  const maxRedirects = Number.isSafeInteger(options.maxRedirects)
    ? Math.max(0, Math.min(MAX_MEDIA_REDIRECTS, options.maxRedirects))
    : MAX_MEDIA_REDIRECTS
  const visited = new Set()
  let current = String(value || '')
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const verdict = await assertTrustedMediaResolution(current, {
      ...options,
      signal: options.signal || options.fetchOptions?.signal
    })
    if (visited.has(verdict.url)) throw new Error('trusted_media_redirect_loop')
    visited.add(verdict.url)
    const response = await fetchImpl(verdict.url, {
      ...(options.fetchOptions || {}),
      redirect: 'manual'
    })
    const status = Number(response?.status || 0)
    const redirected = [301, 302, 303, 307, 308].includes(status)
    if (!redirected) {
      const reportedUrl = String(response?.url || '').trim()
      if (reportedUrl) {
        const finalVerdict = trustedMediaUrlVerdict(reportedUrl)
        if (!finalVerdict.ok || finalVerdict.url !== verdict.url) {
          await cancelResponseBody(response, 'trusted_media_unexpected_final_url')
          throw new Error('trusted_media_unexpected_final_url')
        }
      }
      return response
    }
    if (hop >= maxRedirects) {
      await cancelResponseBody(response, 'trusted_media_redirect_limit')
      throw new Error('trusted_media_redirect_limit')
    }
    const location = String(response?.headers?.get?.('location') || '').trim()
    await cancelResponseBody(response, 'trusted_media_redirect_revalidate')
    if (!location) throw new Error('trusted_media_redirect_location_missing')
    let next
    try {
      next = new URL(location, verdict.url).href
    } catch {
      throw new Error('trusted_media_redirect_location_invalid')
    }
    const nextVerdict = trustedMediaUrlVerdict(next)
    if (!nextVerdict.ok) throw new Error('trusted_media_redirect_target_rejected')
    current = nextVerdict.url
  }
  throw new Error('trusted_media_redirect_limit')
}

module.exports = {
  EXACT_MEDIA_HOSTS,
  MEDIA_HOST_SUFFIXES,
  MAX_MEDIA_URL_CHARS,
  MAX_MEDIA_REDIRECTS,
  mediaHostnameAllowed,
  trustedMediaUrlVerdict,
  isTrustedMediaUrl,
  collectTrustedMediaUrls,
  networkAddressBlocked,
  assertTrustedMediaResolution,
  fetchTrustedMediaUrl
}
