'use strict'

// v152 (owner directive 2026-09-05): when the client changes the TIME of the open
// four-field checkpoint ("Can we do 5 PM?"), the reply must answer the question
// first ("yes 5pm works") and only then re-issue the corrected block. Before this
// the corrected block was the whole reply. One predicate, used by every producer
// of the checkpoint (runner fixed lane, control-plane deterministic recovery, the
// dm-authority canonicalizer) so the three paths cannot drift apart.
//
// Never fires for: the first checkpoint (nothing was revised), a date-only
// revision (the contract re-asks the time instead of re-issuing the block), a
// too-early time (the decline lane owns it), name/phone revisions (the corrected
// block is the natural answer), or a bare re-confirmation.
const CHECKPOINT_REVISION_ACK_VERSION =
  'scv-checkpoint-revision-ack-2026-09-05-v1-yes-time-works-before-corrected-block'

const ACKNOWLEDGEMENT_RE = /^yes\b[^\n:]{1,80}\bworks$/i
const FIELD_LABEL_RE = /\b(?:name|phone(?:\s+number)?|appointment\s+date|time)\s*:/i

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function resolvedCheckpointRevisionAcknowledgement(state = {}, fields = {}) {
  if (!state || typeof state !== 'object') return ''
  // Only an OPEN checkpoint that this live turn revised. dm-authority and the
  // control plane both raise live_turn_checkpoint_invalidated when a committed
  // value was replaced; the durable checkpoint_superseded_by_revision flag is not
  // carried into the control plane's live override state, so it is not required.
  if (state.live_turn_checkpoint_invalidated !== true) return ''
  const intent = compact(state.live_turn_checkpoint_revision_intent).toLowerCase()
  if (['name', 'phone', 'identity'].includes(intent)) return ''
  const liveTime = compact(state.live_turn_time_candidate || state.live_turn_time_phrase)
  if (!liveTime) return ''
  if (compact(state.live_turn_time_status).toLowerCase() === 'too_early') return ''
  // Mirror the block's own Time value so the affirmation and the block never disagree.
  const time = compact(fields && fields.time).toLowerCase()
  if (!time) return ''
  const liveDate = compact(state.live_turn_date_phrase).toLowerCase()
  const dateChangedThisTurn = Boolean(liveDate && compact(state.live_turn_date_iso))
  return dateChangedThisTurn ? `yes ${liveDate} at ${time} works` : `yes ${time} works`
}

function isCheckpointRevisionAcknowledgementText(text) {
  const value = compact(text)
  return Boolean(value) && ACKNOWLEDGEMENT_RE.test(value) && !FIELD_LABEL_RE.test(value)
}

module.exports = {
  CHECKPOINT_REVISION_ACK_VERSION,
  resolvedCheckpointRevisionAcknowledgement,
  isCheckpointRevisionAcknowledgementText
}
