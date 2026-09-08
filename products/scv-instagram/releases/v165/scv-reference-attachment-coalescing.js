#!/usr/bin/env node
// ============================================================
// SCV REFERENCE ATTACHMENT COALESCING
//
// Compatibility transport adapter for the generalized discourse-continuity
// resolver. A likely split attachment receives a short bounded grace. Detection
// is no longer owned by a phrase list in this file and no visible copy is authored.
// ============================================================

const path = require('path')
const {
  DISCOURSE_RELATIONS,
  stripVoiceWrapper,
  structuralDiscourseRelation
} = require(path.join(__dirname, 'scv-discourse-continuity.js'))

const SCV_REFERENCE_ATTACHMENT_COALESCING_VERSION =
  'scv-reference-attachment-coalescing-2026-07-18-v3-inductive-discourse-context'
const SCV_REFERENCE_ATTACHMENT_GRACE_REASON =
  'unresolved_deictic_reference_pointer_waiting_for_attachment'
const SCV_REFERENCE_ATTACHMENT_GRACE_MS = 12 * 1000
const SCV_REFERENCE_ATTACHMENT_GRACE_MAX_MS = 20 * 1000

function liveTurnHasUnresolvedReferencePointer(value, structuredState = {}, recentHistory = []) {
  const state = structuredState && typeof structuredState === 'object'
    ? structuredState
    : {}
  return structuralDiscourseRelation(value, state, recentHistory) === DISCOURSE_RELATIONS.MISSING_ATTACHMENT
}

function referenceAttachmentGraceMs(flags = {}) {
  const safeFlags = flags && typeof flags === 'object' ? flags : {}
  if (safeFlags.reference_attachment_grace_reason !== SCV_REFERENCE_ATTACHMENT_GRACE_REASON) {
    return 0
  }
  const raw = Number(safeFlags.reference_attachment_grace_ms)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.max(0, Math.min(SCV_REFERENCE_ATTACHMENT_GRACE_MAX_MS, Math.round(raw)))
}

function buildReferenceAttachmentGraceFlags() {
  return {
    reference_attachment_grace_version: SCV_REFERENCE_ATTACHMENT_COALESCING_VERSION,
    reference_attachment_grace_reason: SCV_REFERENCE_ATTACHMENT_GRACE_REASON,
    reference_attachment_grace_ms: SCV_REFERENCE_ATTACHMENT_GRACE_MS
  }
}

function referenceAttachmentGraceForBubble(flags = {}, bubbleIndex = 0) {
  return Number(bubbleIndex) === 0 ? referenceAttachmentGraceMs(flags) : 0
}

module.exports = {
  SCV_REFERENCE_ATTACHMENT_COALESCING_VERSION,
  SCV_REFERENCE_ATTACHMENT_GRACE_REASON,
  SCV_REFERENCE_ATTACHMENT_GRACE_MS,
  SCV_REFERENCE_ATTACHMENT_GRACE_MAX_MS,
  stripVoiceWrapper,
  liveTurnHasUnresolvedReferencePointer,
  referenceAttachmentGraceMs,
  buildReferenceAttachmentGraceFlags,
  referenceAttachmentGraceForBubble
}
