#!/usr/bin/env node

const DURABLE_TRUE_FIELDS = [
  'known_model_rate_disclosed',
  // Monotonic conversation-domain latch. Once a client opens the tattoo lane,
  // an ambiguous follow-up must not collapse the thread back into generic social
  // chat. Only an explicit thread purge/reset removes this persisted true value.
  'tattoo_intent_active',
  'form_link_sent',
  'form_offer_asked',
  'form_submitted',
  'deposit_requested',
  'double_check_sent',
  'name_phone_date_time_double_check_sent',
  'checkpoint_superseded_by_revision',
  'known_reference_media_received',
  'known_tattoo_reference_media_received',
  // A client may intentionally choose source material that is not already a
  // tattoo (a portrait, screenshot, object, painting, etc.) and ask for it to
  // be reinterpreted as one.  The media classifier describes the file; this
  // durable latch records the client's separate design decision so later turns
  // cannot reopen the same reference interview.
  'known_client_anchored_inspiration'
]

const DURABLE_STRING_FIELDS = [
  'known_name_used_on_form',
  'known_phone_used_on_form',
  'known_requested_date',
  'known_requested_time',
  'last_offered_date',
  'last_offered_time',
  'accepted_offered_date',
  'accepted_offered_time',
  // Calendar ellipsis ("27 August" -> rejected -> "Can we do 28?") must be
  // bound to a controller-owned fact, not inferred from arbitrary prose in the
  // previous user turn.  The message id makes this authority one-turn-local so
  // an old rejected date cannot leak into a later numeric reply.
  'last_rejected_client_date',
  'last_rejected_client_date_message_id',
  'known_design_context',
  'known_placement_context',
  'known_size_context',
  'reference_request_context',
  'form_submission_source',
  // Only an end-to-end adopted model response is committed here. Rejected
  // candidates never advance the chain. The next turn can therefore use native
  // Responses API conversation continuity without making provider storage the
  // booking source of truth.
  'openai_previous_response_id',
  'openai_conversation_model',
  'openai_conversation_api_version',
  'openai_conversation_last_message_id'
]

function applyDurableStructuredState(target = {}, source = {}, options = {}) {
  const out = { ...(target && typeof target === 'object' ? target : {}) }
  const src = source && typeof source === 'object' ? source : {}
  const overwriteStrings = options.overwrite_strings !== false

  for (const field of DURABLE_TRUE_FIELDS) {
    if (src[field] === true) out[field] = true
  }

  for (const field of DURABLE_STRING_FIELDS) {
    const value = String(src[field] || '').trim()
    if (!value) continue
    if (overwriteStrings || !String(out[field] || '').trim()) {
      out[field] = value
    }
  }

  return out
}

function extractDurableStructuredState(source = {}) {
  return applyDurableStructuredState({}, source)
}

module.exports = {
  DURABLE_TRUE_FIELDS,
  DURABLE_STRING_FIELDS,
  applyDurableStructuredState,
  extractDurableStructuredState
}
