#!/usr/bin/env node
const crypto = require('crypto')

// Persisted delivery truth and conversational visibility are related but not
// identical. ManyChat can accept sendContent without returning a provider
// message id. That remains an assistant_attempted / accepted-unverified event.
// Only a later authenticated client turn, backed by exact delivery + controller
// evidence, may add this marker and make the attempt a dialogue boundary.
const ACCEPTED_UNVERIFIED_BOUNDARY_SCHEMA =
  'scv-accepted-unverified-conversation-boundary-2026-08-22-v1'
const ACCEPTED_UNVERIFIED_BOUNDARY_REASON =
  'strictly_newer_authenticated_inbound_after_manychat_acceptance'
const AUTHENTICATED_BOUNDARY_SOURCES = new Set([
  'shared_secret',
  'provider_verified_legacy_manychat'
])

// 2026-09-02 owner directive. The boundary marker decides only whether an
// accepted-unverified attempt is part of the dialogue ledger the model reads
// (so the artist does not repeat herself). It is NOT visibility evidence: a
// strictly newer client message may arrive precisely because the reply never
// appeared in the Instagram thread. Delivery truth stays in the delivery
// receipts / visibility reconciliation ledger and is upgraded only by a real
// probe or an explicit operator resolution.
const ACCEPTED_UNVERIFIED_BOUNDARY_SEMANTICS =
  'conversation_ledger_inclusion_only_not_visibility_proof'
const CONFIRMED_VISIBLE_DELIVERY_STATUS = 'success_visible'

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value || ''))
}

function validTime(value) {
  return Number.isFinite(Date.parse(String(value || '')))
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function acceptedUnverifiedBoundaryMarker(event) {
  if (event?.role !== 'assistant_attempted') return null
  if (String(event?.delivery_status || '') !== 'manychat_accepted_unverified') return null

  const marker = event?.accepted_unverified_conversation_boundary
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null
  if (marker.schema !== ACCEPTED_UNVERIFIED_BOUNDARY_SCHEMA) return null
  if (marker.reason !== ACCEPTED_UNVERIFIED_BOUNDARY_REASON) return null
  if (marker.delivery_accepted !== true || marker.delivery_confirmed !== false) return null
  if (marker.provider_receipt_id_present !== false || marker.no_resend !== true) return null
  if (!AUTHENTICATED_BOUNDARY_SOURCES.has(String(marker.authentication_source || ''))) return null

  const attemptMessageId = String(event?.message_id || '').trim()
  const markedAttemptMessageId = String(marker.attempt_message_id || '').trim()
  const observedByMessageId = String(marker.observed_by_message_id || '').trim()
  if (!attemptMessageId || markedAttemptMessageId !== attemptMessageId) return null
  if (!observedByMessageId || observedByMessageId === attemptMessageId) return null
  if (!validTime(marker.attempted_at) || !validTime(marker.observed_inbound_at)) return null
  if (String(marker.attempted_at) !== String(event?.at || '')) return null
  if (Date.parse(marker.observed_inbound_at) <= Date.parse(marker.attempted_at)) return null
  const bubbleIndex = Number(event?.bubble_index)
  if (!Number.isInteger(bubbleIndex) || bubbleIndex < 0 || bubbleIndex > 3) return null
  if (Number(marker.bubble_index) !== bubbleIndex) return null
  if (String(marker.text_sha256 || '') !== sha256(String(event?.text || event?.message || ''))) return null
  if (!Number.isInteger(Number(marker.packet_bubble_count)) || Number(marker.packet_bubble_count) < 1 || Number(marker.packet_bubble_count) > 4) return null
  if (bubbleIndex >= Number(marker.packet_bubble_count)) return null
  if (!Number.isInteger(Number(marker.visible_bubble_count)) || Number(marker.visible_bubble_count) < 1 || Number(marker.visible_bubble_count) > Number(marker.packet_bubble_count)) return null
  if (!Array.isArray(marker.visible_bubble_indexes) || marker.visible_bubble_indexes.length !== Number(marker.visible_bubble_count)) return null
  if (!marker.visible_bubble_indexes.every((index) => Number.isInteger(Number(index)) && Number(index) >= 0 && Number(index) < Number(marker.packet_bubble_count))) return null
  if (new Set(marker.visible_bubble_indexes.map(Number)).size !== marker.visible_bubble_indexes.length) return null
  if (!marker.visible_bubble_indexes.map(Number).includes(bubbleIndex)) return null
  if (!validSha256(marker.delivery_receipt_sha256)) return null
  if (!validSha256(marker.control_receipt_sha256)) return null
  if (!validSha256(marker.control_decision_artifact_sha256)) return null
  if (!validSha256(marker.provider_response_sha256)) return null
  if (!validSha256(marker.transport_attempt_id)) return null

  return marker
}

function isConversationVisibleAssistantEvent(event) {
  return event?.role === 'assistant' || acceptedUnverifiedBoundaryMarker(event) !== null
}

function isConversationBoundaryEvent(event) {
  return isConversationVisibleAssistantEvent(event)
}

// True only when the delivery itself was confirmed visible (thread probe or an
// operator resolution recorded on the event). A boundary marker alone never
// makes this true.
function isDeliveryVisibilityConfirmedEvent(event) {
  if (!event || typeof event !== 'object') return false
  if (event.visibility_confirmed === true) return true
  if (String(event.visibility_state || '') === 'confirmed_visible') return true
  if (event.role === 'assistant' && String(event.delivery_status || '') === CONFIRMED_VISIBLE_DELIVERY_STATUS) return true
  return false
}

module.exports = {
  ACCEPTED_UNVERIFIED_BOUNDARY_SCHEMA,
  ACCEPTED_UNVERIFIED_BOUNDARY_REASON,
  ACCEPTED_UNVERIFIED_BOUNDARY_SEMANTICS,
  CONFIRMED_VISIBLE_DELIVERY_STATUS,
  isDeliveryVisibilityConfirmedEvent,
  acceptedUnverifiedBoundaryMarker,
  isConversationVisibleAssistantEvent,
  isConversationBoundaryEvent
}
