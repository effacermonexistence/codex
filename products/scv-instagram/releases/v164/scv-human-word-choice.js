#!/usr/bin/env node
'use strict'

const SCV_HUMAN_WORD_CHOICE_LOCK_VERSION =
  'scv-human-word-choice-2026-09-01-v1-private-reference-distillation'

// These patterns intentionally cover only high-confidence client-surface tells.
// They do not rewrite copy. A hit rejects the candidate and sends the exact
// controller move back to the visible author for a fresh human rewording.
const HUMAN_WORD_CHOICE_PATTERNS = Object.freeze([
  { re: /\b(?:build|builds|building|built)\b/i, label: 'consultant verb build' },
  { re: /\bexplor(?:e|es|ed|ing)\b/i, label: 'consultant verb explore' },
  { re: /\bconcepts?\b/i, label: 'abstract concept framing' },
  { re: /\b(?:creative|design|visual)\s+directions?\b/i, label: 'abstract direction framing' },
  { re: /\bvisual\s+language\b/i, label: 'visual language framing' },
  { re: /\b(?:your|the|this|that|a)\s+vision\b/i, label: 'vision framing' },
  { re: /\bbring(?:ing|s)?\b.{0,45}\b(?:vision|idea|concept)\b.{0,25}\bto\s+life\b/i, label: 'bring it to life framing' },
  { re: /\b(?:craft|crafts|crafted|crafting|curate|curates|curated|curating|elevate|elevates|elevated|elevating|refine|refines|refined|refining|iterate|iterates|iterated|iterating)\b/i, label: 'polished creative consultancy verb' },
  { re: /\b(?:align|aligns|aligned|aligning|resonate|resonates|resonated|resonating)\b/i, label: 'alignment or resonance framing' },
  { re: /\bcollaborat(?:e|es|ed|ing|ion|ions|ive)\b/i, label: 'collaboration framing' },
  { re: /\b(?:our|this|the|your|an?)\s+approach\b/i, label: 'abstract approach framing' },
  { re: /\b(?:your|this|the)(?:\s+tattoo)?\s+journey\b/i, label: 'journey framing' },
  { re: /\blean(?:ing)?\s+into\b/i, label: 'lean into framing' },
  { re: /\bmoving\s+forward\b/i, label: 'moving forward framing' },
  { re: /\bbased\s+on\s+what\s+you\s+(?:shared|said|sent)\b/i, label: 'based on what you shared framing' },
  { re: /\bfrom\s+there\s+we\s+can\b/i, label: 'from there we can framing' }
])

function humanWordChoiceHit(value) {
  const text = String(value || '')
  for (const pattern of HUMAN_WORD_CHOICE_PATTERNS) {
    if (pattern.re.test(text)) return { label: pattern.label }
  }
  return null
}

function packetHumanWordChoiceHit(packet) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  for (const bubble of bubbles) {
    const hit = humanWordChoiceHit(bubble?.text)
    if (hit) return hit
  }
  return null
}

module.exports = {
  SCV_HUMAN_WORD_CHOICE_LOCK_VERSION,
  HUMAN_WORD_CHOICE_PATTERNS,
  humanWordChoiceHit,
  packetHumanWordChoiceHit
}
