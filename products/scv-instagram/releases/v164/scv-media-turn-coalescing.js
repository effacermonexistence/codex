#!/usr/bin/env node
'use strict'

// Instagram/ManyChat can split one visible user action into two authenticated
// ingresses: an attachment whose text is only a CDN URL, followed immediately
// by a short selector such as "I mean this one". The inbox worker normally
// keeps only the newest turn. This module proves when the preceding attachment
// may be carried into that newest turn without borrowing stale or cross-thread
// media.

const path = require('path')
const { isTrustedMediaUrl } = require(path.join(__dirname, 'scv-media-url-policy.js'))
const {
  lightweightReferenceBridge
} = require(path.join(__dirname, 'scv-discourse-continuity.js'))

const SCV_MEDIA_TURN_COALESCING_VERSION =
  'scv-media-turn-coalescing-2026-09-01-v1-authenticated-adjacent-reference'
const SCV_MEDIA_TURN_COALESCING_MAX_GAP_MS = 20 * 1000
const TRUSTED_MESSAGE_ID_AUTHORITIES = new Set([
  'provider_message_id',
  'provider_verified_legacy_manychat',
  'source_interaction_at'
])

function packetTimeMs(packet = {}) {
  const candidates = [
    packet.source_interaction_at,
    packet.received_at,
    packet.manychat_latest_interaction_at
  ]
  for (const candidate of candidates) {
    const parsed = Date.parse(String(candidate || ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function packetThreadId(packet = {}) {
  return String(packet.thread_id || packet.contact_id || '').trim()
}

function packetHasProviderAuthority(packet = {}) {
  const authority = String(packet.message_id_authority || '').trim()
  const messageId = String(packet.message_id || '').trim()
  const threadId = packetThreadId(packet)
  return Boolean(
    messageId &&
    threadId &&
    TRUSTED_MESSAGE_ID_AUTHORITIES.has(authority) &&
    packet.operator_recovery !== true
  )
}

function trustedPacketMediaUrls(packet = {}) {
  const urls = Array.isArray(packet.media_urls) ? packet.media_urls : []
  return urls
    .map((value) => String(value || '').trim())
    .filter((value) => value && isTrustedMediaUrl(value))
    .slice(0, 3)
}

function packetIsReferenceMediaCarrier(packet = {}) {
  if (!packetHasProviderAuthority(packet)) return false
  if (!trustedPacketMediaUrls(packet).length) return false
  const text = String(packet.text || packet.message || '').trim()
  return /^sent a (?:reference post|photo|voice note)\b/i.test(text)
}

function packetIsAttachmentSelector(packet = {}) {
  if (!packetHasProviderAuthority(packet)) return false
  if (trustedPacketMediaUrls(packet).length) return false
  const text = String(packet.text || packet.message || '').trim()
  return Boolean(text && lightweightReferenceBridge(text))
}

function mediaCarryForwardVerdict(source = {}, target = {}, options = {}) {
  const maxGapMs = Math.max(
    1000,
    Math.min(
      SCV_MEDIA_TURN_COALESCING_MAX_GAP_MS,
      Number(options.maxGapMs) || SCV_MEDIA_TURN_COALESCING_MAX_GAP_MS
    )
  )
  if (!packetIsReferenceMediaCarrier(source)) {
    return { ok: false, reason: 'source_not_authenticated_reference_media' }
  }
  if (!packetIsAttachmentSelector(target)) {
    return { ok: false, reason: 'target_not_authenticated_attachment_selector' }
  }
  if (packetThreadId(source) !== packetThreadId(target)) {
    return { ok: false, reason: 'thread_mismatch' }
  }
  if (String(source.message_id || '') === String(target.message_id || '')) {
    return { ok: false, reason: 'same_message' }
  }

  const sourceAt = packetTimeMs(source)
  const targetAt = packetTimeMs(target)
  const gapMs = targetAt - sourceAt
  if (!sourceAt || !targetAt || gapMs < 0 || gapMs > maxGapMs) {
    return { ok: false, reason: 'outside_adjacent_time_window', gap_ms: gapMs }
  }

  return {
    ok: true,
    reason: 'authenticated_adjacent_reference_selector',
    gap_ms: gapMs,
    media_urls: trustedPacketMediaUrls(source),
    source_message_id: String(source.message_id || ''),
    source_interaction_at: String(source.source_interaction_at || source.received_at || ''),
    source_raw_body_sha256: String(source.raw_body_sha256 || ''),
    media_type: String(source.media_type || '')
  }
}

function coalesceReferenceMediaIntoTarget(source = {}, target = {}, options = {}) {
  const verdict = mediaCarryForwardVerdict(source, target, options)
  if (!verdict.ok) return { adopted: false, verdict, packet: target }
  return {
    adopted: true,
    verdict,
    packet: {
      ...target,
      media_urls: verdict.media_urls,
      media_type: verdict.media_type,
      media_coalescing_version: SCV_MEDIA_TURN_COALESCING_VERSION,
      media_coalesced_from_message_id: verdict.source_message_id,
      media_coalesced_source_interaction_at: verdict.source_interaction_at,
      media_coalesced_source_raw_body_sha256: verdict.source_raw_body_sha256,
      media_coalesced_gap_ms: verdict.gap_ms,
      media_coalesced_at: String(options.now || new Date().toISOString())
    }
  }
}

module.exports = {
  SCV_MEDIA_TURN_COALESCING_VERSION,
  SCV_MEDIA_TURN_COALESCING_MAX_GAP_MS,
  packetTimeMs,
  packetThreadId,
  packetHasProviderAuthority,
  trustedPacketMediaUrls,
  packetIsReferenceMediaCarrier,
  packetIsAttachmentSelector,
  mediaCarryForwardVerdict,
  coalesceReferenceMediaIntoTarget
}
