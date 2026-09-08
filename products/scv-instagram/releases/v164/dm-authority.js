#!/usr/bin/env node
const fs = require('fs')
const { isCheckpointRevisionAcknowledgementText } = require('./scv-checkpoint-revision-ack.js')
const path = require('path')
const { spawnSync } = require('child_process')
const { isCanonicalDebugUsername } = require(path.join(__dirname, 'scv-debug-identity.js'))
const {
  loadCleanThreadHistory,
  loadCleanThreadState
} = require(path.join(__dirname, 'scv-state-quarantine.js'))
const {
  applyDurableStructuredState
} = require(path.join(__dirname, 'scv-durable-structured-state.js'))
const {
  enrichControlHistoryUserEvent,
  historicalOfferedSlotForDate,
  mediaContextAuthorityRank,
  selectAuthoritativeMediaText
} = require(path.join(__dirname, 'scv-single-control-plane.js'))
const {
  livePortfolioStyleComplimentOnly,
  liveHasConcreteDesignDirection,
  textHasApproximateSizeSignal,
  formPermissionTextWasAsked,
  assistantHistoryHasFormOffer,
  liveInfoAskOpener,
  classifyReferenceMediaDescription,
  knownTattooReferenceMediaReceived,
  clientAnchoredInspirationReference,
  textAsksPricingOrPolicy,
  textStatesModelRate,
  pendingUnansweredUserTurnTexts
} = require(path.join(__dirname, 'scv-contract-harness.js'))
const {
  isConversationVisibleAssistantEvent
} = require(path.join(__dirname, 'scv-history-visibility.js'))
const {
  extractBookingPhone,
  extractBookingNameNextToPhone,
  extractExplicitFourFieldBookingPayload,
  extractVisibleAssistantDoubleCheckFields,
  extractLabeledBookingFields,
  sanitizeBookingIdentityName,
  textFramesThirdPartyBookingIdentity
} = require(path.join(__dirname, 'scv-booking-identity.js'))
const {
  SCV_BOOKING_POLICY_VERSION,
  BOOKING_POLICY_FINGERPRINT,
  buildBookingPolicySnapshot,
  calendarBookingProposalFrame,
  clockTimeBookingProposalFrame,
  classifyBookingDateText,
  classifyBookingClockTimeText,
  bookingDayConstraintPreference,
  expandOrdinalWordDays,
  MINIMUM_BOOKING_TIME_LABEL
} = require(path.join(__dirname, 'scv-booking-policy.js'))
const {
  liveTurnHasUnresolvedReferencePointer,
  buildReferenceAttachmentGraceFlags
} = require(path.join(__dirname, 'scv-reference-attachment-coalescing.js'))
const {
  applyDiscourseClassification
} = require(path.join(__dirname, 'scv-discourse-continuity.js'))
const {
  redactedIdentity,
  sha256,
  textMetrics,
  errorMetrics
} = require(path.join(__dirname, 'scv-machine-log.js'))
const {
  immutableIngressTimeMs
} = require(path.join(__dirname, 'scv-immutable-ingress-time.js'))

const LIVE_DIR = process.env.SCV_ROOT || __dirname
const THREAD_HISTORY_DIR = path.join(LIVE_DIR, 'thread-history')
const RUNNER_PATH = path.join(LIVE_DIR, 'codex-dm-runner.js')
const RUNNER_TIMEOUT_MS = 90 * 1000
const PREFERRED_FORM_LINK = 'https://www.effacermonexistence.com/apply'

function summarizeRunnerFailure(stderr) {
  const lines = String(stderr || '').split('\n').map((line) => line.trim()).filter(Boolean)
  // Preserve the actual runner exception instead of collapsing new verifier
  // families to the final stack frame. The prior allowlist hid
  // deterministic_recovery_contract_rejected_* and made every retry look like
  // an opaque failure at main(). Error text is bounded below and contains no
  // prompt/body dump, so the first terminal exception is the useful diagnosis.
  const terminal = [...lines].reverse().find((line) => /^Error:\s+\S/.test(line))
  const diagnostics = lines.filter((line) => /^\{.*\}$/.test(line)).slice(-3)
  return [terminal || lines.at(-1) || 'runner_exit_without_stderr', ...diagnostics]
    .join(' :: ')
    .slice(0, 1200)
}

function safeThreadKey(thread_id) {
  return String(thread_id || '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown'
}

function threadHistoryPath(thread_id) {
  return path.join(THREAD_HISTORY_DIR, `${safeThreadKey(thread_id)}.json`)
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function textIsBareAffirmativeConfirmation(value) {
  const compact = normalizeText(value)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(?:oh\s+|ah\s+)?(?:yes+|yea+h?|yep|yup|sure|ok(?:ay)?|right|correct|exactly)(?:\s+(?:of\s+course|for\s+sure|absolutely|definitely|totally))?$/.test(compact)
}

function textOpensTattooLane(value) {
  const raw = String(value || '')
  if (!raw.trim()) return false

  return (
    /\b(tattoo|tattoos|tat|flash|flashes|cover\s*up|touch\s*up|appointment|booking|deposit)\b/i.test(raw) ||
    /\b(?:partial\s+)?sleeves?\b.{0,80}\b(?:finish|finished|finishing|complete|completed|continue|continued|extend|extended|fill|filled|touch)\b/i.test(raw) ||
    /\b(?:finish|finished|finishing|complete|completed|continue|continued|extend|extended|fill|filled|touch)\b.{0,80}\b(?:partial\s+)?sleeves?\b/i.test(raw)
  )
}

function textGivesTattooContinuationDirection(value) {
  const raw = String(value || '')
  if (!raw.trim()) return false
  return (
    /\b(?:partial\s+)?sleeves?\b.{0,80}\b(?:finish|finished|finishing|complete|completed|continue|continued|extend|extended|fill|filled|touch)\b/i.test(raw) ||
    /\b(?:finish|finished|finishing|complete|completed|continue|continued|extend|extended|fill|filled|touch)\b.{0,80}\b(?:partial\s+)?sleeves?\b/i.test(raw) ||
    /\b(?:finish|complete|continue|extend|add\s+to|fill\s+in|touch\s+up)\b.{0,80}\b(?:existing\s+)?(?:tattoo|piece|work)\b/i.test(raw)
  )
}

function textGivesPlacementContext(value) {
  const normalized = normalizeText(value)
  return (
    normalized.includes('neck') ||
    normalized.includes('arm') ||
    normalized.includes('forearm') ||
    normalized.includes('wrist') ||
    normalized.includes('hand') ||
    normalized.includes('shoulder') ||
    normalized.includes('thigh') ||
    normalized.includes('leg') ||
    normalized.includes('ankle') ||
    normalized.includes('rib') ||
    normalized.includes('chest') ||
    normalized.includes('back') ||
    normalized.includes('placement') ||
    normalized.includes('side neck') ||
    normalized.includes('front') ||
    normalized.includes('butt') ||
    normalized.includes('penis')
  )
}

function textGivesSizeContext(value) {
  return textHasApproximateSizeSignal(value)
}

function textGivesConcreteDesignDirection(value, state = {}) {
  const raw = String(value || '').trim()
  if (!raw || textIsTattooBusinessProcessQuestion(raw)) return false
  return liveHasConcreteDesignDirection({
    message: raw,
    live_message: raw,
    recent_history: [],
    // Judge this atomic turn on its own. Stale media/design state cannot promote
    // a generic current message, while current media authority remains usable.
    structured_state: {
      live_turn_text: raw,
      live_turn_is_media_reference: state.live_turn_is_media_reference === true,
      live_turn_context_missing: state.live_turn_context_missing === true,
      live_turn_context_missing_attachment: state.live_turn_context_missing_attachment === true,
      live_turn_context_needs_clarification: state.live_turn_context_needs_clarification === true,
      live_turn_reference_pointer_without_media: state.live_turn_reference_pointer_without_media === true
    }
  })
}

function textIsTattooBusinessProcessQuestion(value) {
  const raw = String(value || '')
  return /\bwhy\b.{0,80}\b(?:doing|do|offer|offering|give|giving)\b.{0,80}\b(?:free|model|discount|tattoo|work)\b/i.test(raw)
}

function isTestAccount(username) {
  return isCanonicalDebugUsername(username)
}

function assistantTextLooksLikeNamePhoneDateTimeDoubleCheck(value) {
  const raw = String(value || '')
  const text = normalizeText(raw).replace(/\bcorrect(?:ed)?\b/g, 'right')
  return (
    /\bname\b/i.test(raw) &&
    /\b(phone\s+number|phone|number)\b/i.test(raw) &&
    /\bappointment\s+date\b/i.test(raw) &&
    /\btime\b/i.test(raw) &&
    (
      /\bdouble[- ]check\b/i.test(raw) ||
      /\bcheck this\b/i.test(raw) ||
      /\bmake sure\b/i.test(raw) ||
      /\bis this\b.{0,40}\b(right|correct)\b/i.test(raw) ||
      /\bdoes\s+(?:(?:this|that|it)(?:\s+all)?|all\s+of\s+(?:this|that))\b.{0,40}\blook\b.{0,20}\b(right|correct)\b/i.test(raw) ||
      /\bis this right\b/i.test(text)
    )
  )
}

function isExplicitFormLinkRequest(value, username = '') {
  const raw = String(value || '').toLowerCase()
  const normalized = normalizeText(raw).replace(/[?!.]+$/g, '').trim()
  const formMentioned = /\b(form|link|application|apply)\b/i.test(raw)
  const asksBareForm =
    normalized === 'form' ||
    normalized === 'the form' ||
    normalized === 'link' ||
    normalized === 'the link'

  if (asksBareForm) return true

  return formMentioned && (
    /\b(can|could|may)\s+i\s+(?:get|have|see)\b/i.test(raw) ||
    /\b(can|could|would)\s+you\s+(?:send|share|drop|forward|give)\b/i.test(raw) ||
    /\b(send|share|drop|forward|give|send over|send through)\s+(?:me\s+)?(?:the\s+)?(?:form|link|application|apply)\b/i.test(raw) ||
    /\b(?:need|want|looking for)\s+(?:the\s+)?(?:form|link|application|apply)\b/i.test(raw) ||
    /\b(resend|again|one more|send it again|send me again|send the form again|send the link again)\b/i.test(raw) ||
    /\b(lost|can't find|cant find|cannot find|don’t see|don't see|dont see|not seeing|not showing|didn’t get|didn't get|didnt get|never got|didn’t receive|didn't receive|didnt receive)\b/i.test(raw) ||
    /\b(link doesn’t work|link doesn't work|link doesnt work|link does not work|link isn’t working|link isn't working|link isnt working|not opening|won’t open|won't open|wont open|broken link)\b/i.test(raw) ||
    /\b(you didn’t send|you didn't send|you didnt send|forgot to send|forgot to paste|did you send|where is|where’s|where's)\b/i.test(raw)
  )
}

function packetContainsPreferredFormLink(packet) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  return bubbles.some((bubble) => String(bubble?.text || '').includes(PREFERRED_FORM_LINK))
}

function isMediaReferenceUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return false
  if (/^sent a reference (post|reel|story|media)(?::|$)/i.test(raw)) return true
  if (/^shared a reference (post|reel|story|media)(?::|$)/i.test(raw)) return true
  if (/^https?:\/\/lookaside\.fbsbx\.com\/ig_messaging_cdn\//i.test(raw)) return true
  if (/^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|stories)\//i.test(raw)) return true
  if (/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|mp4|mov|m4v)(\?|$)/i.test(raw)) return true
  return false
}

function cleanNameCandidate(value) {
  return sanitizeBookingIdentityName(value)
}

function extractPhone(text) {
  return extractBookingPhone(text)
}

function extractNameNextToPhone(text) {
  return extractBookingNameNextToPhone(text)
}

function extractTime(text) {
  const match = String(text || '').match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.?|p\.m\.?|am|pm)(?![a-z0-9_])/i)
  if (!match) return ''
  const hour = match[1]
  const minute = match[2] || '00'
  const suffix = match[3].toLowerCase().replace(/\./g, '')
  return `${hour}:${minute}${suffix}`
}

function canonicalClockTime(value) {
  const match = String(value || '').trim().match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.?|p\.m\.?|am|pm)(?![a-z0-9_])/i)
  if (!match) return ''
  return `${Number(match[1])}:${match[2] || '00'}${String(match[3]).toLowerCase().replace(/\./g, '')}`
}

function extractDatePhrase(text) {
  const raw = String(text || '').trim()
  const lower = raw.toLowerCase()
  const month =
    '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
  const patterns = [
    new RegExp(`\\b${month}\\s+(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'i'),
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}(?:,?\\s+\\d{4})?\\b`, 'i'),
    /\b\d{1,2}(?:st|nd|rd|th)\b/i
  ]

  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match) return match[0]
  }

  if (/^(today|tomorrow|this weekend|next weekend)$/i.test(lower)) {
    return raw
  }
  const relative = raw.match(/\b(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (relative) return relative[0]
  const iso = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)
  if (iso) return iso[0]
  const numeric = raw.match(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/)
  if (numeric) return numeric[0]

  return ''
}

function extractOfferedSlot(text) {
  const raw = String(text || '')
  // Recognise an offered appointment from natural chat. Date can be month+day ("june 30"),
  // an ordinal day ("the 30th" / "30th" — the ordinal suffix is required so a bare number like
  // "$30" / "30 min" / "30 inches" is never mistaken for a date), or a weekday ("monday").
  // Time is optional, so a date-only offer ("would the 30th work?") still counts as a slot.
  const monthDay = raw.match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
  const ordinalDay = raw.match(/\b(?:the\s+)?(\d{1,2})(st|nd|rd|th)\b/i)
  const weekday = raw.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  const timeMatch = raw.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.m\.?|p\.m\.?|am|pm)(?![a-z0-9_])/i)
  let date = ''
  if (monthDay) date = `${monthDay[1].toLowerCase()} ${monthDay[2]}`
  else if (ordinalDay) date = `the ${ordinalDay[1]}${ordinalDay[2].toLowerCase()}`
  else if (weekday) date = weekday[1].toLowerCase()
  if (!date) return null
  const minute = timeMatch && timeMatch[2] ? timeMatch[2] : ''
  const time = timeMatch
    ? `${timeMatch[1]}${minute ? `:${minute}` : ''}${timeMatch[3].toLowerCase().replace(/\./g, '')}`
    : ''
  return { date, time }
}

function isSlotAcceptanceText(text) {
  const raw = String(text || '')
  if (/\?/.test(raw)) return false
  if (bookingDayConstraintPreference(raw)) return false
  const normalized = normalizeText(raw).replace(/[,:;]+/g, ' ').replace(/[?!.]+$/g, '').replace(/\s+/g, ' ').trim()
  if (!normalized) return false
  if (/\b(no|nope|nah|not|cant|can'?t|doesnt|does'?nt|wont|won'?t|another|different|other day|reschedule|instead|too early|too late|cannot)\b/i.test(normalized)) return false
  if (/\b(how much|what time|how many|how long|which day|which time)\b/i.test(normalized)) return false
  if (/^(oh\s+)?(yes+|yea+h?|yep|yup|sure|ok|okay|okk+|okie|perfect|sounds good|sounds great|sounds perfect|that works|works for me|good with me|bet|totally|absolutely|definitely|great|cool|nice|down|deal)\b/i.test(normalized)) return true
  if (/\b(perfect|works for me|works for us|that works|this works|that time works|that day works|that date works|sounds good|sounds great|sounds perfect|looks good|good with me|fine with me|thats fine|that is fine|im good|i'?m good|im down|i'?m down|i am down|down for (it|that)|book it|lets book|let'?s book|lock it in|lock that in|lets do it|let'?s do it|lets do that|let'?s do that|lets do|let'?s do|do it|go for it)\b/i.test(normalized)) return true
  if (/\b(is good|is fine|is perfect|is great|works?)\b/i.test(normalized) && !/^(does|do|is|are|can|could|would|will|what|when|how|why|where|which)\b/i.test(normalized)) return true
  return false
}

function acceptedProviderAttemptEvent(event) {
  return Boolean(
    event &&
    event.role === 'assistant_attempted' &&
    event.delivery_status === 'manychat_accepted_unverified'
  )
}

// ASR tense repair (live 2026-07-08): the lead voice-said "I just sent you" and
// whisper transcribed "I'll just send you" — one phoneme flips completed into
// future, the submitted signal stays dark, and the bot answers "send it when you
// can" to someone who already submitted (instant bot tell). On a VOICE transcript
// after the form link is out, a bare "i('ll) just send/sent you/it" that ENDS the
// sentence is a submitted claim regardless of tense; a real future plan carries an
// object ("i'll just send you my idea tonight") and stays future.
function voiceTranscriptClaimsSubmission(liveText, state) {
  if (!state || state.form_link_sent !== true) return false
  const raw = String(liveText || '')
  if (!/^sent a voice note saying:/i.test(raw)) return false
  const t = raw.replace(/^sent a voice note saying:\s*/i, '').trim().toLowerCase()
  return /(^|[.!?]\s*)(yeah|yep|ok(ay)?|oh)?[,\s]*(i just|i'?ll just|ill just|i will just|just)\s+sen[dt]\s*(it|you|this|that|the form)?\s*(in|over|now|already|to you)?\s*[.!]?\s*$/i.test(t)
}

function looksLikeFormSubmitted(normalized, raw) {
  const n = String(normalized || '')
  if (/\?/.test(String(raw || ''))) return false
  if (/\b(how|where|not yet|not done|not finished|not working|havent|haven'?t|cant|can'?t|isnt|isn'?t|wont|won'?t|cannot|didnt|didn'?t|need help|confused|trouble|broken|error)\b/i.test(n)) return false
  return (
    n.includes('i alrdy sent') || n.includes('i already sent') || n.includes('i sent it') ||
    n.includes('i sent the form') || n.includes('sent the form') || n.includes('just sent') ||
    n.includes('already sent') || n.includes('form is in') || n.includes('form is submitted') ||
    n.includes('submitted') || n.includes('submitted it') || n.includes('filled it out') ||
    n.includes('filled out the form') || n.includes('completed the form') || n.includes('done with the form') ||
    /\b(all done|ok done|okay done|im done|i'?m done|all set|form done|its in|it'?s in|it is in|just did it|did it|did the form|did the application|sent the application|filled it)\b/i.test(n) ||
    /^done[\s!.]*$/i.test(n) || /^done\b[\s!.,]/i.test(n) || /\bfinished\b/i.test(n) ||
    n === 'sent' || n === 'sent it' ||
    n.includes('보냈') || n.includes('제출') || n.includes('작성') || n.includes('완료')
  )
}

const MONTH_NAME_ALIASES = Object.freeze({
  jan: 'january',
  january: 'january',
  feb: 'february',
  february: 'february',
  mar: 'march',
  march: 'march',
  apr: 'april',
  april: 'april',
  may: 'may',
  jun: 'june',
  june: 'june',
  jul: 'july',
  july: 'july',
  aug: 'august',
  august: 'august',
  sep: 'september',
  sept: 'september',
  september: 'september',
  oct: 'october',
  october: 'october',
  nov: 'november',
  november: 'november',
  dec: 'december',
  december: 'december'
})

const MONTH_NAME_RE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/gi

function stripVoiceTransportForCalendar(value) {
  return String(value || '')
    .replace(/^sent\s+a\s+voice\s+note\s+saying\s*:?\s*/i, '')
    .replace(/^voice\s+note\s*:?\s*/i, '')
    .trim()
}

// Dialogue-pair authority is local. Recover only the immediately preceding
// delivered assistant packet, never an old scheduling question from elsewhere
// in the thread. Multi-bubble packets share message_id; legacy rows without one
// are recovered only while assistant rows remain contiguous.
function committedAssistantPacketText(state = {}, recentHistory = []) {
  const decision = state?.last_control_decision
  const packet = decision?.packet
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  const decisionMessageId = String(decision?.message_id || '').trim()
  const lastControlMessageId = String(state?.last_control_message_id || decisionMessageId).trim()
  if (!decisionMessageId || decisionMessageId !== lastControlMessageId || !bubbles.length) return ''

  // A receipt-bound committed packet may still be recorded as
  // assistant_attempted when ManyChat accepted the send without returning a
  // provider message id. Once a strictly newer inbound is in control state,
  // the exact last committed packet is the only safe dialogue predecessor.
  // Bind it only to its matching immediately preceding user turn; never revive
  // an older decision from elsewhere in the thread.
  const priorUsers = (Array.isArray(recentHistory) ? recentHistory : [])
    .filter((event) => String(event?.role || '').toLowerCase() === 'user')
  const latestPriorUser = priorUsers[priorUsers.length - 1]
  if (!latestPriorUser || String(latestPriorUser?.message_id || '').trim() !== lastControlMessageId) return ''

  return bubbles
    .map((bubble) => String(bubble?.text || '').trim())
    .filter(Boolean)
    .join(' \n ')
}

function latestAssistantPacketText(recentHistory = [], state = {}) {
  const events = Array.isArray(recentHistory) ? recentHistory : []
  let latestIndex = -1
  for (let i = events.length - 1; i >= 0; i--) {
    const role = String(events[i]?.role || '').toLowerCase()
    if (isConversationVisibleAssistantEvent(events[i]) || role === 'user') {
      if (!isConversationVisibleAssistantEvent(events[i])) {
        return committedAssistantPacketText(state, events)
      }
      latestIndex = i
      break
    }
  }
  if (latestIndex < 0) return committedAssistantPacketText(state, events)

  const messageId = String(events[latestIndex]?.message_id || '').trim()
  if (messageId) {
    return events
      .filter((event) =>
        isConversationVisibleAssistantEvent(event) &&
        String(event?.message_id || '').trim() === messageId
      )
      .map((event) => String(event?.text || event?.message || '').trim())
      .filter(Boolean)
      .join(' \n ')
  }

  const parts = []
  for (let i = latestIndex; i >= 0; i--) {
    if (!isConversationVisibleAssistantEvent(events[i])) break
    const text = String(events[i]?.text || events[i]?.message || '').trim()
    if (text) parts.unshift(text)
  }
  return parts.join(' \n ')
}

function priorRejectedClientMonthAnchor(state = {}, recentHistory = [], assistantPacket = '') {
  const committedMessageId = String(
    state?.last_control_message_id || state?.last_control_decision?.message_id || ''
  ).trim()
  const events = Array.isArray(recentHistory) ? recentHistory : []
  let visiblePacketMessageId = ''
  // The downstream authority state intentionally contains semantic fields only,
  // so it may not carry the controller's receipt envelope. In the normal
  // confirmed-delivery path, recover the same exact packet binding from the
  // newest conversation-visible assistant event. If a newer user turn appears
  // first, there is no open assistant packet to inherit from.
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (isConversationVisibleAssistantEvent(event)) {
      visiblePacketMessageId = String(event?.message_id || '').trim()
      break
    }
    if (String(event?.role || '').toLowerCase() === 'user') break
  }
  const priorMessageId = committedMessageId || visiblePacketMessageId
  if (!priorMessageId || !assistantPacket) return ''

  const priorUsers = events
    .filter((event) =>
      String(event?.role || '').toLowerCase() === 'user' &&
      String(event?.message_id || '').trim() === priorMessageId
    )
  if (!priorUsers.length) return ''

  // One ingress message may be preserved more than once when media authority is
  // upgraded (unresolved voice placeholder -> exact transcript). Select the
  // highest-authority revision for the same immutable message id; the durable
  // rejected-date receipt below still has to match its exact parsed date.
  const authoritativePrior = priorUsers.reduce((best, event) => {
    if (!best) return event
    const bestText = String(best?.text || best?.message || '')
    const eventText = String(event?.text || event?.message || '')
    return mediaContextAuthorityRank(eventText) >= mediaContextAuthorityRank(bestText)
      ? event
      : best
  }, null)

  const priorText = stripVoiceTransportForCalendar(
    String(authoritativePrior?.text || authoritativePrior?.message || '')
  )
  const months = monthAnchorsInText(priorText)
  const days = [...priorText.matchAll(/\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/gi)]
  if (months.length !== 1 || days.length !== 1) return ''

  const day = Number(days[0][1])

  // Rejected-date continuity is controller-owned.  Never infer it merely from
  // an arbitrary prior date plus model prose: "my birthday is August 27" is not
  // a rejected booking proposal.  The durable fact is written only after the
  // outside-window transition is adopted, and its exact message id makes the
  // authority valid for this immediately adjacent exchange only.
  const rejectedMessageId = String(state?.last_rejected_client_date_message_id || '').trim()
  const rejectedDateText = String(state?.last_rejected_client_date || '').trim()
  const rejectedMonths = monthAnchorsInText(rejectedDateText)
  const rejectedDays = [
    ...rejectedDateText.matchAll(/\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/gi)
  ]
  const rejectedMatchesPrior = Boolean(
    rejectedMessageId === priorMessageId &&
    rejectedMonths.length === 1 && rejectedMonths[0] === months[0] &&
    rejectedDays.length === 1 && Number(rejectedDays[0][1]) === day
  )

  // Backward-compatible authority for a v88 state committed immediately before
  // the durable fields existed.  This still relies on the controller's frozen
  // route and exact message id, never on assistant wording.
  const decision = state?.last_control_decision
  const decisionReason = String(decision?.authority?.closed_transition_reason || '').trim()
  const decisionMatchesPrior = Boolean(
    String(decision?.message_id || '').trim() === priorMessageId &&
    decisionReason === 'submitted_form_date_counterproposal_outside_window'
  )

  return rejectedMatchesPrior || decisionMatchesPrior ? months[0] : ''
}

function assistantPacketOpensDateAvailability(packetText) {
  const raw = String(packetText || '')
  if (!raw) return false
  const genericDateQuestion = (
    /\b(?:what|which|any)\b.{0,45}\b(?:date|dates|day|days|weekend|weekends|availability)\b/i.test(raw) ||
    /\b(?:date|dates|day|days|weekend|weekends|availability)\b.{0,55}\b(?:work|works|thinking|easiest|best|good|free|available)\b/i.test(raw) ||
    /\bwhen\b.{0,45}\b(?:free|available|open|work|works|come|do it)\b/i.test(raw) ||
    /\b(?:send|give|throw|drop|lmk|let me know)\b.{0,50}\b(?:couple|some|any)?\s*(?:date|dates|day|days|availability)\b/i.test(raw) ||
    /\b(?:do|did)\s+you\s+have\b.{0,35}\b(?:date|day|weekend)\b.{0,25}\b(?:mind|thinking)\b/i.test(raw)
  )
  const explicitSlotQuestion = (
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(raw) &&
    (
      /[?？]/.test(raw) ||
      /\b(?:work|works|available|free|good|okay|ok|possible|doable|instead|opening|open|earliest|first|soonest|fit)\b/i.test(raw) ||
      /\b(?:lmk|let\s+me\s+know)\b/i.test(raw)
    )
  )
  return genericDateQuestion || explicitSlotQuestion
}

function assistantPacketOpensTimeSelection(packetText) {
  const raw = String(packetText || '')
  if (!raw) return false
  return (
    /\b(?:what|which|any|around)\b.{0,45}\btime\b/i.test(raw) ||
    /\btime\b.{0,45}\b(?:work|works|best|good|better|thinking|prefer|available|free)\b/i.test(raw) ||
    /\b(?:send|give|tell|drop|message|let\s+me\s+know)\b.{0,40}\b(?:a|the|your|what|which)?\s*time\b/i.test(raw) ||
    /\bwhat\s+part\s+of\s+(?:the\s+)?day\b/i.test(raw) ||
    /\b(?:morning|afternoon|evening)\b.{0,24}\bor\b.{0,24}\b(?:morning|afternoon|evening)\b/i.test(raw)
  )
}

function assistantPacketOpensFormIdentity(packetText) {
  const raw = String(packetText || '')
  if (!raw) return false
  return (
    /\b(?:what|which|confirm|double\s*check|send|give|tell)\b.{0,65}\b(?:name|phone|number)\b.{0,45}\b(?:form|application)\b/i.test(raw) ||
    /\b(?:form|application)\b.{0,55}\b(?:name|phone|number)\b/i.test(raw) ||
    /\b(?:phone\s+number|number)\s+(?:you\s+)?used\s+on\s+(?:the\s+)?form\b/i.test(raw) ||
    /\bwhat\s+name\s+is\s+it\s+under\b/i.test(raw)
  )
}

function bookingFieldPayloadAuthority(text, state = {}) {
  const fields = extractLabeledBookingFields(text)
  const completePayload = extractExplicitFourFieldBookingPayload(text)
  const invalid = (reason) => ({
    detected: fields.detected === true || completePayload.detected === true,
    valid: false,
    kind: 'invalid',
    reason,
    fields,
    complete_payload: completePayload
  })

  const identityOnly = (
    fields.detected === true &&
    fields.valid === true &&
    fields.name &&
    fields.phone &&
    fields.present_fields.length === 2 &&
    fields.present_fields.includes('name') &&
    fields.present_fields.includes('phone')
  )
  if (identityOnly) {
    return {
      detected: true,
      valid: true,
      kind: 'identity',
      name: fields.name,
      phone: fields.phone,
      date: '',
      time: '',
      date_decision: null,
      fields
    }
  }

  if (!completePayload.detected) return invalid('not_structured_booking_fields')
  if (!completePayload.valid) return invalid(completePayload.reason || 'invalid_complete_booking_fields')
  const time = canonicalClockTime(completePayload.time_text)
  const dateDecision = classifyBookingDateText(completePayload.date_text, {
        currentDateLocal: state.current_message_date_local,
        minimumDateLocal: state.minimum_booking_date_local,
        allowAmbiguousDay: false
      })
  if (
    !time ||
    !dateDecision ||
    ['missing', 'invalid', 'ambiguous_month', 'ambiguous_numeric'].includes(String(dateDecision.status || ''))
  ) return invalid('invalid_complete_booking_fields')

  return {
    detected: true,
    valid: true,
    kind: 'complete',
    name: completePayload.name,
    phone: completePayload.phone,
    date: String(dateDecision.canonical_label || dateDecision.phrase || '').trim(),
    time,
    date_decision: dateDecision,
    fields,
    complete_payload: completePayload
  }
}

function textFramesPhoneAsFormIdentity(text, state = {}, recentHistory = []) {
  const sourceText = String(text || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc\uff07]/g, "'")
  const raw = sourceText
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw || !extractPhone(raw)) return false
  if (textFramesThirdPartyBookingIdentity(raw)) return false
  const bookingFieldAuthority = bookingFieldPayloadAuthority(sourceText, state)
  if (bookingFieldAuthority.detected) {
    return bookingFieldAuthority.valid === true && ['identity', 'complete'].includes(bookingFieldAuthority.kind)
  }

  const explicitSelfFormIdentity = (
    /\b(?:my|the)\s+(?:phone(?:\s+number)?|number)\b.{0,55}\b(?:form|application)\b/i.test(raw) ||
    /\b(?:form|application)\b.{0,55}\b(?:my|the)?\s*(?:phone(?:\s+number)?|number)\b/i.test(raw) ||
    /\b(?:phone(?:\s+number)?|number)\s+(?:i|we)\s+used\s+on\s+(?:the\s+)?(?:form|application)\b/i.test(raw) ||
    (
      looksLikeFormSubmitted(normalizeText(raw), raw) &&
      /\b(?:my\s+)?(?:name|phone|number)\b/i.test(raw)
    )
  )
  if (explicitSelfFormIdentity) return true

  const stage = String(state.booking_stage_hint || '').trim()
  const activeIdentityStage = [
    'awaiting_form_identity_match',
    'awaiting_name_used_on_form',
    'awaiting_phone_used_on_form'
  ].includes(stage)
  const assistantPacket = latestAssistantPacketText(recentHistory, state)
  const identitySlotOpen = Boolean(
    state.form_submitted === true &&
    (activeIdentityStage || assistantPacketOpensFormIdentity(assistantPacket))
  )
  if (!identitySlotOpen) return false

  const withoutPhone = raw
    .replace(/[+\d][+\d\s().-]{5,}\d/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '')
  const barePhoneAnswer = !withoutPhone
  const explicitSelfAnswer = (
    /\bmy\s+(?:phone(?:\s+number)?|number|cell|mobile)\b/i.test(raw) ||
    /\b(?:phone(?:\s+number)?|number|cell|mobile)\s+(?:is|was)\b/i.test(raw) ||
    /\b(?:phone(?:\s+number)?|number|cell|mobile)\b.{0,24}\b(?:is|was)\s+mine\b/i.test(raw) ||
    /\b(?:i\s+(?:used|put|entered)|mine\s+is|it(?:'s|\s+is)|(?:call|text|reach)\s+me\s+at)\b/i.test(raw)
  )
  const adjacentIdentityName = extractFormIdentityNameWithPhone(raw)
  return Boolean(barePhoneAnswer || explicitSelfAnswer || adjacentIdentityName)
}

function extractFormIdentityNameWithPhone(text) {
  const raw = String(text || '').trim()
  const labeled = extractLabeledBookingFields(raw)
  if (labeled.detected) {
    return labeled.valid && labeled.name && labeled.phone ? labeled.name : ''
  }
  const metadataWords = /\b(?:phone|number|form|application|submitted|friend|mom|mother|dad|father|parent|sister|brother|partner|wife|husband|cousin|aunt|uncle|roommate|coworker|colleague|client|customer|assistant|manager|artist|doctor|nurse|lawyer|boss|call|text|contact|reach|his|her|their)\b/i
  const trailing = raw.match(/(?:\+?\d|\()[\d\s().-]{6,}\d\s*[,;:/-]+\s*([\p{L}][\p{L} ._'’\-]{1,48})\s*$/u)
  const trailingName = trailing ? cleanNameCandidate(trailing[1]) : ''
  if (trailingName && !metadataWords.test(trailingName) && isLikelyName(trailingName)) return trailingName

  const adjacent = cleanNameCandidate(extractNameNextToPhone(raw))
  if (adjacent && !metadataWords.test(adjacent) && isLikelyName(adjacent)) return adjacent
  return ''
}

function monthAnchorsInText(value) {
  const aliases = []
  MONTH_NAME_RE.lastIndex = 0
  for (const match of String(value || '').matchAll(MONTH_NAME_RE)) {
    const canonical = MONTH_NAME_ALIASES[String(match[1] || '').toLowerCase()]
    if (canonical && !aliases.includes(canonical)) aliases.push(canonical)
  }
  MONTH_NAME_RE.lastIndex = 0
  return aliases
}

// A short numeric answer inherits the semantic slot of the immediately open
// booking question. This is a family-level ellipsis resolver, not a "26" patch:
// "the 8th", "how about 19", "can you do 26?" all become date proposals only
// inside an active post-form date exchange. Currency, size, time, age, phone,
// quantity, and arithmetic dimensions are explicitly excluded.
function extractContextualBookingDayReply(text, state = {}, recentHistory = []) {
  const knownRequestedDate = String(state.known_requested_date || '').trim()
  // v146 (owner red-team 2026-09-03): a day offered after the form link while
  // the assistant's open question is the date ("send me a couple dates") is a
  // contextual date reply before the form match too. It still needs the
  // assistant-opened date slot below; before the form link a bare number
  // stays a quantity.
  const beforeFormMatchDateReply = (
    state.form_submitted !== true &&
    state.form_link_sent === true &&
    !knownRequestedDate
  )
  if (state.form_submitted !== true && !beforeFormMatchDateReply) return null
  const stage = String(state.booking_stage_hint || '').trim()
  if (!beforeFormMatchDateReply && stage && ![
    'awaiting_date',
    'awaiting_form_identity_match',
    'awaiting_time'
  ].includes(stage)) return null

  const assistantPacket = latestAssistantPacketText(recentHistory, state)
  const assistantOpensDateSlot = assistantPacketOpensDateAvailability(assistantPacket)
  const assistantOpensTimeSlot = assistantPacketOpensTimeSelection(assistantPacket)

  // Ordinal words are calendar days here too ("the fifth" == "the 5th").
  const body = expandOrdinalWordDays(stripVoiceTransportForCalendar(text))
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc\uff07]/g, "'")
  MONTH_NAME_RE.lastIndex = 0
  if (!body || MONTH_NAME_RE.test(body)) {
    MONTH_NAME_RE.lastIndex = 0
    return null
  }
  MONTH_NAME_RE.lastIndex = 0

  if (
    /[$€£¥₩%]/.test(body) ||
    /\b(?:dollars?|bucks?|usd|price|cost|rate|hourly|inch|inches|in\.|cm|mm|feet|foot|ft|years?\s+old|age|birthday|minutes?|mins?|seconds?|secs?|hours?|hrs?|am|pm|people|persons?|followers?|items?|pieces?|times?)\b/i.test(body) ||
    /\b\d{1,2}\s*[x×]\s*\d{1,2}\b/i.test(body) ||
    /\b\d{1,2}\s*[:/]\s*\d{1,2}\b/.test(body) ||
    /\b(?:call|text|phone|number)\b/i.test(body)
  ) return null

  const dayMatches = [...body.matchAll(/\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/gi)]
  if (dayMatches.length !== 1) return null
  const day = Number(dayMatches[0][1])
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  // Once a date is already known, a bare number is usually a time/size/other
  // quantity.  Reopen the date slot only for an explicit revision formulation
  // while the controller is still waiting for time.  This supports natural
  // "Can we do 31 instead?" continuity without turning "Can we do 3?" into a
  // silent calendar mutation.
  const hasExplicitOrdinal = new RegExp(
    `\\b${day}(?:st|nd|rd|th)\\b`,
    'i'
  ).test(body)
  const hasExplicitDateNoun = (
    /\b(?:date|day)\b/i.test(body) &&
    new RegExp(`\\b${day}(?:st|nd|rd|th)?\\b`, 'i').test(body)
  )
  const cannotBeOrdinaryClockHour = day > 23
  const hasUnambiguousDateDimension = hasExplicitOrdinal || hasExplicitDateNoun || cannotBeOrdinaryClockHour
  const hasDateRevisionMove = (
    /\b(?:instead|rather|actually|change|switch|move|reschedul(?:e|ing)|different\s+(?:date|day))\b/i.test(body) ||
    /\b(?:how|what)\s+about\b/i.test(body) ||
    /\b(?:can|could|would)\s+(?:i|you|we)\s+(?:do|do\s+it\s+on|make|make\s+it|book|get|switch|go\s+with)\b/i.test(body) ||
    /\b(?:move|make)\s+(?:it|that)\b/i.test(body) ||
    /\b(?:work|works|better|sound)\b/i.test(body) ||
    /\b(?:maybe|probably|possibly)\b/i.test(body)
  )
  const isKnownDateRevision = Boolean(
    knownRequestedDate &&
    stage === 'awaiting_time' &&
    hasUnambiguousDateDimension &&
    (hasDateRevisionMove || hasExplicitOrdinal)
  )
  if (knownRequestedDate && !isKnownDateRevision) return null
  if (
    !assistantOpensDateSlot &&
    !(assistantOpensTimeSlot && isKnownDateRevision)
  ) return null

  const dayToken = `(?:the\\s+)?${day}(?:st|nd|rd|th)?`
  const dateReplyShape = new RegExp([
    `^\\s*${dayToken}(?:\\s+instead)?\\s*[?!.]*\\s*$`,
    `^\\s*(?:maybe|probably|possibly|around|about|on)\\s+${dayToken}\\s*[?!.]*\\s*$`,
    `^\\s*(?:how|what)\\s+about\\s+${dayToken}\\s*[?!.]*\\s*$`,
    `^\\s*(?:how|what)\\s+(?:does|would)\\s+${dayToken}\\s+(?:sound|be)\\s*[?!.]*\\s*$`,
    `^\\s*would\\s+${dayToken}\\s+be\\s+better\\s*[?!.]*\\s*$`,
    // Live 2026-07-27: "I'm thinking of 29" missed every shape here, the route
    // fell to submitted_form_missing_date, and the model freestyled "got it 29
    // works" then flipped to "too soon" next turn without ever asking the
    // month. Proposal-verb answers are first-class day replies.
    `^\\s*(?:i(?:'m|\\s+am|m)?\\s+)?(?:thinking|leaning)(?:\\s+(?:of|about|towards?))?\\s+${dayToken}\\s*[?!.]*\\s*$`,
    `^\\s*(?:let'?s|lets)\\s+(?:do|go\\s+with|try)\\s+${dayToken}\\s*[?!.]*\\s*$`,
    `^\\s*i\\s+(?:want|wanna|prefer|like|was\\s+thinking)\\s+${dayToken}\\s*[?!.]*\\s*$`,
    `^\\s*(?:can|could|would|will)\\s+(?:i|you|u|we)\\s+(?:do|make|fit|take|book|hold)(?:\\s+it)?(?:\\s+on)?\\s+${dayToken}(?:\\s+instead)?\\s*[?!.]*\\s*$`,
    `^\\s*(?:can|could|would)\\s+(?:i|we)\\s+(?:switch|move|go\\s+with|get)(?:\\s+(?:it|the\\s+(?:date|day)))?(?:\\s+to)?\\s+${dayToken}(?:\\s+instead)?\\s*[?!.]*\\s*$`,
    `^\\s*(?:can|could|does|would|will|is)\\s+${dayToken}\\s+(?:work|works|look|(?:be\\s+)?(?:good|okay|ok|available|free|fine))\\s*[?!.]*\\s*$`,
    `^\\s*${dayToken}\\s+(?:work|works)(?:\\s+for\\s+(?:me|us))?(?:\\s+instead)?\\s*[?!.]*\\s*$`,
    `^\\s*${dayToken}\\s+(?:is\\s+(?:good|okay|ok|fine|available|free|better)|should\\s+work(?:\\s+for\\s+(?:me|us))?|could\\s+work(?:\\s+for\\s+(?:me|us))?)(?:\\s+instead)?\\s*[?!.]*\\s*$`,
    `^\\s*${dayToken}\\s+(?:please|pls|plz)\\s*[?!.]*\\s*$`,
    `^\\s*(?:i|we)\\s+(?:can|could|would|should)\\s+(?:do|make)\\s+${dayToken}\\s*[?!.]*\\s*$`,
    `^\\s*actually[,\\s]+${dayToken}\\s*[?!.]*\\s*$`,
    `^\\s*(?:move|make)\\s+(?:it|that)(?:\\s+to)?\\s+${dayToken}(?:\\s+(?:please|pls|plz))?\\s*[?!.]*\\s*$`,
    `^\\s*(?:maybe|probably|possibly)\\s+${dayToken}(?:\\s+instead)?\\s*[?!.]*\\s*$`,
    `^\\s*${dayToken}\\s+would\\s+be\\s+better\\s*[?!.]*\\s*$`
  ].join('|'), 'i')
  if (!dateReplyShape.test(body)) return null

  const knownDateMonths = isKnownDateRevision ? monthAnchorsInText(knownRequestedDate) : []
  let knownDateMonth = knownDateMonths.length === 1 ? knownDateMonths[0] : ''
  const currentDateMonths = monthAnchorsInText(String(state.current_message_date_local || ''))
  const currentDateDays = [
    ...String(state.current_message_date_local || '').matchAll(/\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/gi)
  ]
  const wouldSilentlyRollToNextYear = Boolean(
    knownDateMonth &&
    currentDateMonths.length === 1 && currentDateMonths[0] === knownDateMonth &&
    currentDateDays.length === 1 && day < Number(currentDateDays[0][1])
  )
  if (wouldSilentlyRollToNextYear) knownDateMonth = ''
  const priorRejectedMonth = knownDateMonth
    ? ''
    : priorRejectedClientMonthAnchor(state, recentHistory, assistantPacket)
  const monthAnchors = monthAnchorsInText(assistantPacket)
  const monthAnchor = wouldSilentlyRollToNextYear
    ? ''
    : knownDateMonth || priorRejectedMonth || (monthAnchors.length === 1 ? monthAnchors[0] : '')
  return {
    day,
    day_label: `${day}${day % 100 >= 11 && day % 100 <= 13 ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'}`,
    month_anchor: monthAnchor,
    month_resolution_source: wouldSilentlyRollToNextYear
      ? 'accepted_date_reschedule_year_ambiguous'
      : knownDateMonth
      ? 'accepted_date_reschedule_continuation'
      : priorRejectedMonth
        ? 'prior_rejected_client_date_continuation'
        : monthAnchor
          ? 'immediately_open_assistant_date_slot'
          : '',
    assistant_packet: assistantPacket
  }
}

// The inverse half of the same dialogue slot:
// assistant: "which month did you mean for the 26th?"
// client:    "July"
//
// The day is recovered only from the immediately preceding, verifier-approved
// assistant packet. A free-floating month elsewhere in the thread is never
// enough. This keeps the exchange restart-safe without a phrase script or a
// hidden guessed month.
function extractContextualBookingMonthReply(text, state = {}, recentHistory = []) {
  if (state.form_submitted !== true || String(state.known_requested_date || '').trim()) return null
  const stage = String(state.booking_stage_hint || '').trim()
  if (stage && !['awaiting_date', 'awaiting_form_identity_match'].includes(stage)) return null

  const assistantPacket = latestAssistantPacketText(recentHistory)
  if (
    !assistantPacket ||
    !/\b(?:which|what)\s+month\b|\bmonth\s+(?:did|do|were|are)\b/i.test(assistantPacket)
  ) return null

  const assistantDayMatches = [
    ...assistantPacket.matchAll(/\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/gi)
  ]
  if (assistantDayMatches.length !== 1) return null
  const day = Number(assistantDayMatches[0][1])
  if (!Number.isInteger(day) || day < 1 || day > 31) return null

  const body = stripVoiceTransportForCalendar(text)
  let monthAnchors = monthAnchorsInText(body)
  let relativeMonthKind = ''
  // Live 2026-07-27: "I mean this month" answered the open month question but
  // carried no month NAME, so this lane missed, the route fell back to
  // submitted_form_missing_date, and the model was forced to re-ask a date it
  // already had (shipped as a self-contradictory "this month for the 30th /
  // which day in august" packet). A relative month is a complete month answer:
  // resolve it against the studio-local booking clock already carried in
  // state.current_message_date_local, then let the normal window validation
  // (too_soon -> grounded counterproposal) own the reply.
  if (!monthAnchors.length) {
    const rel = body.match(
      /^\s*(?:(?:yeah|yes|yep|sure|actually|maybe|probably|i\s+(?:mean|meant|think)|it(?:'s|\s+is))\s+)*(this|next)\s+month(?:\s+(?:actually|i\s+think|works?|would\s+work|is\s+(?:good|fine)|for\s+me|please|yeah|yep|sure))*\s*[.!?]*\s*$/i
    )
    const currentAnchor = monthAnchorsInText(String(state.current_message_date_local || ''))
    if (rel && currentAnchor.length === 1) {
      const MONTH_ORDER = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
      const idx = MONTH_ORDER.findIndex((name) => name.startsWith(String(currentAnchor[0]).slice(0, 3).toLowerCase()))
      if (idx >= 0) {
        relativeMonthKind = rel[1].toLowerCase()
        monthAnchors = [relativeMonthKind === 'this' ? MONTH_ORDER[idx] : MONTH_ORDER[(idx + 1) % 12]]
      }
    }
  }
  if (monthAnchors.length !== 1 || /\d/.test(body)) return null

  // Keep this as a bounded answer-to-question resolver. A longer sentence that
  // merely happens to mention a month remains ordinary model context.
  const monthOnlyReply = new RegExp(
    "^\\s*(?:(?:yeah|yes|yep|sure|actually|maybe|probably|i\\s+(?:mean|meant|think)|it(?:'s|\\s+is))\\s+)*" +
    '(?:in\\s+|the\\s+month\\s+of\\s+)?' +
    '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)' +
    '(?:\\s+(?:actually|i\\s+think|works?|would\\s+work|is\\s+(?:good|fine)|for\\s+me|please|yeah|yep|sure))*\\s*[.!?]*\\s*$',
    'i'
  )
  // The relative-month branch above already validated the full answer shape;
  // its body carries no month name for this regex to find.
  if (!relativeMonthKind && !monthOnlyReply.test(body)) return null

  return {
    day,
    day_label: `${day}${day % 100 >= 11 && day % 100 <= 13 ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'}`,
    month_anchor: monthAnchors[0],
    relative_month: relativeMonthKind || '',
    assistant_packet: assistantPacket,
    continuation_kind: 'month_answer_to_open_day'
  }
}

function classifyExplicitBookingDateForState(text, state = {}, referenceTime = '', options = {}) {
  const proposalFrame = calendarBookingProposalFrame(text, {
    allowBareDate: options.allowBareDate === true
  })
  if (proposalFrame.proposal !== true || !proposalFrame.candidate_text) return null
  const decision = classifyBookingDateText(proposalFrame.candidate_text, {
    referenceTime: referenceTime || undefined,
    currentDateLocal: state.current_message_date_local,
    minimumDateLocal: state.minimum_booking_date_local,
    allowAmbiguousDay: false
  })
  if (!['too_soon', 'legal'].includes(decision.status) || !decision.date_iso) return null
  return {
    phrase: decision.phrase,
    status: decision.status,
    date: new Date(`${decision.date_iso}T12:00:00.000Z`),
    date_iso: decision.date_iso,
    canonical_label: decision.canonical_label,
    canonical_day_first: decision.canonical_day_first,
    availability: decision.availability,
    availability_source: decision.availability_source,
    policy_version: decision.policy_version,
    policy_fingerprint: decision.policy_fingerprint
  }
}

const WEEKDAY_ONLY_RE = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i

function normalizeDateLabelFromCloseOption(option) {
  const raw = String(option || '').trim().toLowerCase()
  const match = raw.match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/)
  if (!match) return ''
  const monthMap = {
    jan: 'january',
    feb: 'february',
    mar: 'march',
    apr: 'april',
    jun: 'june',
    jul: 'july',
    aug: 'august',
    sep: 'september',
    sept: 'september',
    oct: 'october',
    nov: 'november',
    dec: 'december'
  }
  const month = monthMap[match[1]] || match[1]
  return `${month} ${match[2]}`
}

function resolveWeekdayDateFromCloseOptions(weekday, state) {
  const target = String(weekday || '').trim().toLowerCase()
  if (!target) return ''
  const options = Array.isArray(state?.close_booking_options_local) ? state.close_booking_options_local : []
  for (const option of options) {
    const raw = String(option || '').toLowerCase()
    if (raw.includes(`(${target})`) || new RegExp(`\\b${target}\\b`, 'i').test(raw)) {
      const label = normalizeDateLabelFromCloseOption(raw)
      if (label) return label
    }
  }
  return ''
}

function normalizeAppointmentDateForState(date, state) {
  const raw = String(date || '').trim()
  const normalized = raw.toLowerCase().replace(/[.,!?]+$/g, '').trim()
  if (!normalized) return raw
  if (WEEKDAY_ONLY_RE.test(normalized)) {
    return resolveWeekdayDateFromCloseOptions(normalized, state) || normalized
  }
  if (/^(this\s+)?weekend$|^next weekend$/i.test(normalized)) {
    return resolveWeekdayDateFromCloseOptions('saturday', state) ||
      resolveWeekdayDateFromCloseOptions('sunday', state) ||
      normalized
  }
  return raw
}

function normalizeBookingCalendarDates(state) {
  if (!state || typeof state !== 'object') return state
  for (const key of [
    'known_requested_date',
    'last_offered_date',
    'accepted_offered_date',
    'live_turn_accepted_offered_date'
  ]) {
    if (String(state[key] || '').trim()) {
      state[key] = normalizeAppointmentDateForState(state[key], state)
    }
  }
  return state
}

function isLikelyName(text) {
  const raw = cleanNameCandidate(text)
  if (!raw) return false
  // Short acknowledgements belong to the open conversational checkpoint. They
  // are never a person's name merely because they contain only letters.
  if (isSlotAcceptanceText(raw) || /^(?:please|thanks?|thank you|done|all good|correct|looks good)$/i.test(raw)) return false
  if (extractPhone(raw)) return false
  if (extractTime(raw)) return false
  if (extractDatePhrase(raw)) return false
  if (/https?:\/\//i.test(raw)) return false
  if (raw.length > 60) return false
  return /^[\p{L}가-힣][\p{L}가-힣0-9 ._'’\-]{0,40}$/u.test(raw)
}

function loadRecentThreadHistory(msg, limit = 30) {
  const thread_id = String(msg.thread_id || msg.contact_id || '')
  const parsed = loadCleanThreadHistory(thread_id)
  if (!parsed) return []

  try {
    const events = Array.isArray(parsed?.events) ? parsed.events : []
    return events
      .filter((event) => {
        if (!event || typeof event !== 'object') return false

        const liveMessageId = String(msg.message_id || '')
        const sameLiveInbound =
          event.role === 'user' &&
          (
            (
              liveMessageId &&
              String(event.message_id || '') === liveMessageId
            ) ||
            (
              !liveMessageId &&
              String(event.text || '') === String(msg.text || '')
            )
          )

        return !sameLiveInbound
      })
      .slice(-limit)
      .map((event) => ({
        role: String(event.role || ''),
        message_id: String(event.message_id || ''),
        bubble_index: Number.isFinite(Number(event.bubble_index)) ? Number(event.bubble_index) : undefined,
        text: String(event.text || ''),
        delivery_status: String(event.delivery_status || ''),
        accepted_unverified_conversation_boundary:
          event.accepted_unverified_conversation_boundary &&
          typeof event.accepted_unverified_conversation_boundary === 'object' &&
          !Array.isArray(event.accepted_unverified_conversation_boundary)
            ? { ...event.accepted_unverified_conversation_boundary }
            : undefined,
        text_source: String(event.text_source || ''),
        raw_text_before_authority_enrichment: String(event.raw_text_before_authority_enrichment || ''),
        at: String(event.at || '')
      }))
  } catch {
    return []
  }
}

function loadPersistedInboundUserEvent(msg) {
  const threadId = String(msg?.thread_id || msg?.contact_id || '')
  const messageId = String(msg?.message_id || '')
  if (!threadId || !messageId) return null
  const parsed = loadCleanThreadHistory(threadId)
  const events = Array.isArray(parsed?.events) ? parsed.events : []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || String(event.role || '') !== 'user') continue
    if (String(event.message_id || '') !== messageId) continue
    return {
      role: 'user',
      message_id: messageId,
      text: String(event.text || ''),
      text_source: String(event.text_source || ''),
      raw_text_before_authority_enrichment: String(event.raw_text_before_authority_enrichment || ''),
      at: String(event.at || '')
    }
  }
  return null
}

// No-dropped-message coalesce: collect the trailing user turns that have NOT yet
// received a DELIVERED assistant reply. recentHistory already excludes the current
// live inbound, so this returns the earlier messages (A) that arrived before the
// live turn (B) with no reply in between — the exact set the stale-drop would discard.
// A delivered role==='assistant' event closes the backlog. A narrowly reconciled
// accepted-unverified attempt also closes it after a strictly newer authenticated
// inbound proves the dialogue advanced. All other attempted/human-required events
// remain internal and keep their triggering messages pending.
function collectPendingUnansweredUserTurns(recentHistory) {
  return pendingUnansweredUserTurnTexts(recentHistory)
}

function buildCoalescedRunnerMessage(liveMessageValue, pendingUnansweredValue) {
  const liveMessage = String(liveMessageValue || '')
  const pendingUnanswered = Array.isArray(pendingUnansweredValue)
    ? pendingUnansweredValue.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  if (pendingUnanswered.length === 0) {
    return { message: liveMessage, live_message: liveMessage }
  }
  const earlier = pendingUnanswered
    .map((text, index) => `(earlier message ${index + 1} from them that you have NOT replied to yet) ${text}`)
    .join('\n')
  return {
    message: `${earlier}\n(their latest message just now) ${liveMessage}`.trim(),
    live_message: liveMessage
  }
}

// Inbound transport writes thread-history before authority enriches voice/image
// media. If a second user turn arrives before the first delayed reply is delivered,
// the no-drop coalescer reads thread-history as the only source of the earlier
// unanswered turn. Live failure 2026-07-09: a voice note saying "I want something
// like this" was stored as a raw fallback, so the next image turn lost the design
// commit phrase. Persist the enriched authority text back onto the matching user
// history event so future coalesced turns carry the real transcript / vision context.
function persistEnrichedInboundHistoryText(msg, enrichedText) {
  const threadId = String(msg?.thread_id || msg?.contact_id || '')
  const messageId = String(msg?.message_id || '')
  const nextText = String(enrichedText || '').trim()
  if (!threadId || !messageId || !nextText) return false
  try {
    const changed = enrichControlHistoryUserEvent(LIVE_DIR, msg, nextText)
    if (!changed) return false
    console.error(JSON.stringify({
      type: 'thread_history_user_enriched',
      ...redactedIdentity({ thread_id: threadId, message_id: messageId }),
      chars: nextText.length
    }))
    return true
  } catch (err) {
    console.error(JSON.stringify({
      type: 'thread_history_user_enrich_failed',
      ...redactedIdentity({ thread_id: threadId, message_id: messageId }),
      ...errorMetrics(err)
    }))
    return false
  }
}

function buildStructuredState(msg, recentHistory) {
  const ingressTimeMs = immutableIngressTimeMs(msg)
  const bookingPolicy = buildBookingPolicySnapshot({
    receivedAt: ingressTimeMs ? new Date(ingressTimeMs).toISOString() : (msg.received_at || undefined)
  })

  const state = {
    ...bookingPolicy,
    preferred_time_primary: '2pm',
    preferred_time_backup: '1pm',
    earliest_allowed_time: MINIMUM_BOOKING_TIME_LABEL,
    form_link_sent: false,
    form_offer_asked: false,
    form_submitted: false,
    deposit_requested: false,
    double_check_sent: false,
    name_phone_date_time_double_check_sent: false,
    checkpoint_superseded_by_revision: false,
    known_name_used_on_form: '',
    known_phone_used_on_form: '',
    known_requested_date: '',
    known_requested_time: '',
    last_offered_date: '',
    last_offered_time: '',
    accepted_offered_date: '',
    accepted_offered_time: '',
    tattoo_intent_active: false,
    known_design_context: '',
    known_placement_context: '',
    known_size_context: '',
    known_reference_media_received: false,
    known_tattoo_reference_media_received: false,
    known_client_anchored_inspiration: false,
    known_model_rate_disclosed: false,
    reference_media_classification_observed: false,
    latest_reference_media_category: '',
    reference_request_context: '',
    booking_stage_hint: ''
  }

  Object.assign(state, applyDurableStructuredState(state, loadCleanThreadState(msg.thread_id || msg.contact_id), { overwrite_strings: false }))

  const events = Array.isArray(recentHistory) ? recentHistory : []

  for (let eventIndex = 0; eventIndex < events.length; eventIndex++) {
    const event = events[eventIndex]
    const text = String(event.text || '')
    const normalized = normalizeText(text)

    if (isConversationVisibleAssistantEvent(event)) {
      const offeredSlot = extractOfferedSlot(text)
      const assistantCheckpoint = assistantTextLooksLikeNamePhoneDateTimeDoubleCheck(text)
      const assistantCheckpointFields = assistantCheckpoint
        ? extractVisibleAssistantDoubleCheckFields(text)
        : null
      let assistantCheckpointMismatch = false
      if (offeredSlot) {
        state.last_offered_date = offeredSlot.date
        state.last_offered_time = offeredSlot.time
        // An assistant offer is proposal evidence only. "Works on my side" is
        // not client acceptance and must never write requested/accepted time.
        // The exact four-field checkpoint is the only assistant surface from
        // which accepted state may be reconstructed after restart.
        if (
          normalized.includes('double check the name number date and time') ||
          normalized.includes('double check the name / number / date / time') ||
          assistantCheckpoint
        ) {
          const priorDate = classifyBookingDateText(state.known_requested_date, {
            currentDateLocal: state.current_message_date_local,
            minimumDateLocal: state.minimum_booking_date_local,
            allowAmbiguousDay: false
          })
          const offeredDate = classifyBookingDateText(
            assistantCheckpointFields?.date_text || offeredSlot.date,
            {
              currentDateLocal: state.current_message_date_local,
              minimumDateLocal: state.minimum_booking_date_local,
              allowAmbiguousDay: false
            }
          )
          const priorTime = canonicalClockTime(state.known_requested_time)
          const offeredTime = canonicalClockTime(
            assistantCheckpointFields?.time_text || offeredSlot.time
          )
          assistantCheckpointMismatch = Boolean(
            (priorDate.date_iso && offeredDate.date_iso && priorDate.date_iso !== offeredDate.date_iso) ||
            (priorTime && offeredTime && priorTime !== offeredTime)
          )
          // Client speech is authority; a visible assistant checkpoint may fill
          // missing reconstruction fields, but it may never overwrite a client
          // date/time already recovered from history.
          if (!state.known_requested_date) {
            state.known_requested_date = String(
              offeredDate.canonical_label ||
              offeredDate.phrase ||
              assistantCheckpointFields?.date_text ||
              offeredSlot.date
            ).trim()
          }
          if (!state.known_requested_time) {
            state.known_requested_time = String(
              canonicalClockTime(assistantCheckpointFields?.time_text) ||
              offeredSlot.time
            ).trim()
          }
          state.accepted_offered_date = state.known_requested_date
          state.accepted_offered_time = state.known_requested_time
        }
      }
      if (text.includes('https://www.effacermonexistence.com/apply')) {
        state.form_link_sent = true
      }
      // v157: the rate is spoken at most once per thread — remember that it was given
      if (textStatesModelRate(text)) {
        state.known_model_rate_disclosed = true
      }
      if (
        normalized.includes('let me check it on my side') ||
        normalized.includes('once it is in') ||
        normalized.includes('once it’s in') ||
        normalized.includes('once you send it just lmk')
      ) {
        state.booking_stage_hint = 'awaiting_form_submission'
      }
      if (
        normalized.includes('to confirm your appointment the deposit is 100') ||
        normalized.includes('that’s my zelle') ||
        normalized.includes("that's my zelle")
      ) {
        state.deposit_requested = true
      }
      if (assistantCheckpoint) {
        state.double_check_sent = !assistantCheckpointMismatch
        state.name_phone_date_time_double_check_sent = !assistantCheckpointMismatch
        state.checkpoint_superseded_by_revision = false
      }
      const asksNameOnForm =
        normalized.includes('what name is it under') ||
        normalized.includes('name used on the form')
      const asksPhoneOnForm =
        normalized.includes('phone number you used on the form') ||
        normalized.includes('what phone number did you use on the form')

      if (asksNameOnForm && asksPhoneOnForm) {
        state.booking_stage_hint = 'awaiting_form_identity_match'
      } else if (asksNameOnForm) {
        state.booking_stage_hint = 'awaiting_name_used_on_form'
      } else if (asksPhoneOnForm) {
        state.booking_stage_hint = 'awaiting_phone_used_on_form'
      }
      if (normalized.includes('what time were you thinking')) {
        state.booking_stage_hint = 'awaiting_time'
      }
      if (
        normalized.includes('send me a pic of what you want covered') ||
        normalized.includes('send me a pic of the tattoo you want covered')
      ) {
        state.reference_request_context = 'coverup_target'
      } else if (
        normalized.includes('send me 2 or 3 reference pics') ||
        normalized.includes('send me 1 or 2 more refs') ||
        normalized.includes('reference pics you like')
      ) {
        state.reference_request_context = 'design_references'
      } else if (
        normalized.includes('send me a pic of the prayer area')
      ) {
        state.reference_request_context = 'prayer_area'
      } else if (
        normalized.includes('send me a pic') ||
        normalized.includes('send me a photo') ||
        normalized.includes('send me a reference') ||
        normalized.includes('send me refs')
      ) {
        state.reference_request_context = 'generic_reference'
      }
      continue
    }

    if (textOpensTattooLane(text)) {
      state.tattoo_intent_active = true
    }

    if (isMediaReferenceUrl(text)) {
      // A reference is a DESIGN direction only if vision classified it as tattoo
      // content. A bare image URL proves media existence, not design authority.
      // A BARE "sent a reference post" is an unresolved blob —
      // and voice notes are labeled exactly that at inbound, then committed to
      // history — so counting it as a design reference falsely unlocked the funnel
      // on voice-only turns (Ben live 2026-07-08: "hello"/"model" voice notes ->
      // known_reference_media_received=true -> date/form pushed with no design).
      const isDescribedReference = /^(sent|shared) a reference (post|reel|story|media|photo)\s*:\s*\S/i.test(text)
      if (isDescribedReference) {
        const category = classifyReferenceMediaDescription(text)
        state.reference_media_classification_observed = true
        state.latest_reference_media_category = category
        if (category === 'tattoo_reference') {
          state.known_tattoo_reference_media_received = true
          state.known_reference_media_received = true
        }
      } else if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(text)) {
        // A URL proves that media exists, not that it is a tattoo design. Vision
        // evidence must classify it before it may advance the booking funnel.
        state.latest_reference_media_category = 'unknown'
        state.reference_media_classification_observed = true
      }
      continue
    }

    const historicalFormSubmittedSignal = looksLikeFormSubmitted(normalized, text)
    if (historicalFormSubmittedSignal) {
      state.form_submitted = true
    }

    const historyBeforeEvent = events.slice(0, eventIndex)
    const immediatelyPriorAssistantPacket = latestAssistantPacketText(historyBeforeEvent, state)
    const priorAssistantCheckpoint = extractVisibleAssistantDoubleCheckFields(
      immediatelyPriorAssistantPacket
    )
    // The checkpoint stays open until confirmed, superseded, or invalidated,
    // even when clarification or recovery turns were sent after it (matches
    // the live annotation; 2026-09-02 red-team).
    const assistantCheckpointOpen = Boolean(
      (priorAssistantCheckpoint &&
        assistantTextLooksLikeNamePhoneDateTimeDoubleCheck(immediatelyPriorAssistantPacket)) ||
      state.double_check_sent === true ||
      state.name_phone_date_time_double_check_sent === true
    )
    const assistantOpensDateSlot =
      assistantPacketOpensDateAvailability(immediatelyPriorAssistantPacket) ||
      assistantCheckpointOpen
    const assistantOpensTimeSlot =
      assistantPacketOpensTimeSelection(immediatelyPriorAssistantPacket) ||
      assistantCheckpointOpen

    // Rebuild the same dialogue-slot authority used on the live turn. Without
    // this history-side guard, a successfully handled reply such as
    // "How about 26?" can be re-imported after restart as tattoo size because
    // its surface contains "about" + a number.
    const historicalContextualDayReply = extractContextualBookingDayReply(
      text,
      {
        ...state,
        booking_stage_hint:
          state.form_submitted === true && !String(state.known_requested_date || '').trim()
            ? 'awaiting_date'
            : state.booking_stage_hint
      },
      historyBeforeEvent
    )

    // A complete labeled client payload is one atomic booking speech act. The
    // live controller already treats all four fields that way; history rebuild
    // must do the same or a restart can splice new identity onto an older slot.
    // Any detected-but-invalid labeled block owns the parse and fails closed —
    // broad phone/date/time extractors may not salvage fragments from it.
    const bookingFieldAuthority = bookingFieldPayloadAuthority(text, state)
    if (bookingFieldAuthority.detected && bookingFieldAuthority.valid) {
      const priorName = String(state.known_name_used_on_form || '').trim()
      const priorPhone = String(state.known_phone_used_on_form || '').trim()
      let checkpointChanged = assistantCheckpointOpen || (
        priorName.toLowerCase() !== String(bookingFieldAuthority.name || '').trim().toLowerCase() ||
        priorPhone !== String(bookingFieldAuthority.phone || '').trim()
      )
      state.known_name_used_on_form = bookingFieldAuthority.name
      state.known_phone_used_on_form = bookingFieldAuthority.phone

      if (bookingFieldAuthority.kind === 'complete' && state.form_submitted === true) {
        const priorDateDecision = classifyBookingDateText(state.known_requested_date, {
          currentDateLocal: state.current_message_date_local,
          minimumDateLocal: state.minimum_booking_date_local,
          allowAmbiguousDay: false
        })
        const priorDateIso = String(priorDateDecision.date_iso || '')
        const nextDateIso = String(bookingFieldAuthority.date_decision?.date_iso || '')
        const priorTime = canonicalClockTime(state.known_requested_time)
        checkpointChanged = checkpointChanged || priorDateIso !== nextDateIso || priorTime !== bookingFieldAuthority.time

        state.accepted_offered_date = ''
        state.accepted_offered_time = ''
        if (bookingFieldAuthority.date_decision?.status === 'legal') {
          state.known_requested_date = bookingFieldAuthority.date
          state.known_requested_time = bookingFieldAuthority.time
        } else {
          // Mirror the live too-soon transition: retain verified identity but
          // reopen date/time instead of resurrecting the prior committed slot.
          state.known_requested_date = ''
          state.known_requested_time = ''
          checkpointChanged = true
        }
      }

      if (checkpointChanged) {
        state.double_check_sent = false
        state.name_phone_date_time_double_check_sent = false
        state.checkpoint_superseded_by_revision = true
      }
    }

    const phone = bookingFieldAuthority.detected ? '' : extractPhone(text)
    if (!historicalFormSubmittedSignal && phone && textFramesPhoneAsFormIdentity(text, state, historyBeforeEvent)) {
      state.known_phone_used_on_form = phone
      const nameWithPhone = extractFormIdentityNameWithPhone(text)
      if (nameWithPhone) {
        state.known_name_used_on_form = nameWithPhone
      }
    }

    if (
      !bookingFieldAuthority.detected &&
      !historicalFormSubmittedSignal &&
      assistantCheckpointOpen
    ) {
      const historicalPhoneRevision = extractCheckpointPhoneRevision(text)
      const historicalNameRevision = historicalPhoneRevision ? '' : extractCheckpointNameRevision(text)
      if (historicalPhoneRevision) {
        state.known_phone_used_on_form = historicalPhoneRevision
        const nameWithPhone = extractFormIdentityNameWithPhone(text)
        if (nameWithPhone) state.known_name_used_on_form = nameWithPhone
        state.double_check_sent = false
        state.name_phone_date_time_double_check_sent = false
        state.checkpoint_superseded_by_revision = true
      } else if (historicalNameRevision) {
        state.known_name_used_on_form = historicalNameRevision
        state.double_check_sent = false
        state.name_phone_date_time_double_check_sent = false
        state.checkpoint_superseded_by_revision = true
      }
    }

    const timeProposalFrame = bookingFieldAuthority.detected
      ? { proposal: false, candidate_text: '' }
      : clockTimeBookingProposalFrame(text, {
          allowBareTime: assistantOpensTimeSlot,
          allowBareHour: assistantCheckpointOpen
        })
    const time = timeProposalFrame.proposal === true
      ? extractTime(timeProposalFrame.candidate_text)
      : ''
    const proposalFrame = bookingFieldAuthority.detected
      ? { proposal: false, candidate_text: '' }
      : calendarBookingProposalFrame(text, {
          allowBareDate: state.form_submitted === true && assistantOpensDateSlot
        })
    // A monthless ordinal offered while the four-field checkpoint is open belongs
    // to the checkpoint's month (mirrors the live annotation; 2026-09-02).
    let historicalCheckpointAnchoredDateText = ''
    if (
      !bookingFieldAuthority.detected &&
      !historicalContextualDayReply?.month_anchor &&
      assistantCheckpointOpen &&
      proposalFrame.proposal === true
    ) {
      const ordinal = String(proposalFrame.candidate_text || '').trim().match(/^(?:the\s+)?([1-9]|[12]\d|3[01])(?:st|nd|rd|th)$/i)
      const monthAnchor = monthAnchorsInText(
        String(priorAssistantCheckpoint?.date_text || state.known_requested_date || state.last_offered_date || '')
      )[0]
      if (ordinal && monthAnchor) historicalCheckpointAnchoredDateText = `${monthAnchor} ${ordinal[1]}`
    }
    const contextualDateText = !bookingFieldAuthority.detected && historicalContextualDayReply?.month_anchor
      ? `${historicalContextualDayReply.month_anchor} ${historicalContextualDayReply.day}`
      : historicalCheckpointAnchoredDateText
    if (
      state.form_submitted === true &&
      (contextualDateText || (proposalFrame.proposal === true && proposalFrame.candidate_text))
    ) {
      const dateDecision = classifyBookingDateText(
        contextualDateText || proposalFrame.candidate_text,
        {
          currentDateLocal: state.current_message_date_local,
          minimumDateLocal: state.minimum_booking_date_local,
          allowAmbiguousDay: Boolean(contextualDateText)
        }
      )
      if (dateDecision.status === 'legal' && dateDecision.date_iso) {
        state.known_requested_date = dateDecision.canonical_label || dateDecision.phrase
        const matchedOffer = historicalOfferedSlotForDate(
          historyBeforeEvent,
          dateDecision.date_iso,
          event,
          state
        )
        if (matchedOffer?.time) state.known_requested_time = matchedOffer.time
        if (assistantCheckpointOpen) {
          state.double_check_sent = false
          state.name_phone_date_time_double_check_sent = false
          state.checkpoint_superseded_by_revision = true
        }
      }
    }

    const activeTimeSlot = Boolean(
      (
        state.form_submitted === true ||
        (
          String(state.last_offered_date || '').trim() &&
          String(state.last_offered_time || '').trim()
        )
      ) &&
      (
        String(state.known_requested_date || '').trim() ||
        String(state.last_offered_date || '').trim() ||
        String(state.booking_stage_hint || '').trim() === 'awaiting_time'
      )
    )
    if (
      time &&
      activeTimeSlot
    ) {
      state.known_requested_time = time
      if (assistantCheckpointOpen) {
        state.double_check_sent = false
        state.name_phone_date_time_double_check_sent = false
        state.checkpoint_superseded_by_revision = true
      }
    }

    if (
      !historicalFormSubmittedSignal &&
      isLikelyName(text) &&
      (
        state.booking_stage_hint === 'awaiting_name_used_on_form' ||
        state.booking_stage_hint === 'awaiting_form_identity_match' ||
        (
          state.booking_stage_hint === 'awaiting_phone_used_on_form' &&
          !state.known_name_used_on_form
        )
      )
    ) {
      state.known_name_used_on_form = cleanNameCandidate(text)
      continue
    }

    if (!historicalFormSubmittedSignal && textGivesPlacementContext(text)) {
      state.known_placement_context = String(text || '').trim()
    }

    if (!historicalFormSubmittedSignal && !historicalContextualDayReply && textGivesSizeContext(text)) {
      state.known_size_context = String(text || '').trim()
    }

    // One design authority for history, live routing, controller reduction, and
    // final filtering. Open-vocabulary subject detection lives in the contract
    // harness; this prevents unknown motifs from falling through a stale list.
    const historicalClientAnchoredInspiration = clientAnchoredInspirationReference({
      message: text,
      live_message: text,
      recent_history: events.slice(0, eventIndex),
      structured_state: {
        ...state,
        live_turn_text: text,
        live_turn_context_missing: false,
        live_turn_context_missing_attachment: false,
        live_turn_context_needs_clarification: false,
        live_turn_reference_pointer_without_media: false
      }
    })
    if (
      !historicalFormSubmittedSignal &&
      (textGivesConcreteDesignDirection(text) || historicalClientAnchoredInspiration)
    ) {
      state.known_design_context = String(text || '').trim()
      state.tattoo_intent_active = true
    }
  }

  // One packet-local detector owns form-offer state. Never concatenate unrelated
  // assistant turns: "pic or link" in one turn plus "drop it" in another is not
  // an application-form offer.
  if (!state.form_link_sent && assistantHistoryHasFormOffer({ recent_history: events })) {
    state.form_offer_asked = true
  }

  if (state.deposit_requested) state.booking_stage_hint = 'deposit_requested'
  else if (
    state.known_name_used_on_form &&
    state.known_phone_used_on_form &&
    state.known_requested_date &&
    state.known_requested_time &&
    (state.double_check_sent === true || state.name_phone_date_time_double_check_sent === true)
  ) state.booking_stage_hint = 'awaiting_double_check_confirmation'
  else if (state.known_name_used_on_form && state.known_phone_used_on_form && state.known_requested_date && state.known_requested_time) state.booking_stage_hint = 'ready_for_double_check'
  else if (state.known_name_used_on_form && !state.known_phone_used_on_form) state.booking_stage_hint = 'awaiting_phone_used_on_form'
  else if (!state.known_name_used_on_form && !state.known_phone_used_on_form && state.form_submitted && state.known_requested_date && state.known_requested_time) state.booking_stage_hint = 'awaiting_form_identity_match'
  else if (!state.known_name_used_on_form && state.form_submitted && state.known_requested_date && state.known_requested_time) state.booking_stage_hint = 'awaiting_name_used_on_form'
  else if (state.known_requested_date && !state.known_requested_time) state.booking_stage_hint = 'awaiting_time'
  // Ben funnel law (2026-07-08 live: form auto-claimed on turn 1, bot jumped to
  // "do you have a day in mind" with ZERO design discussion — "디자인이 정해져야
  // 날짜를 잡지"): the form being in does NOT mean the design is settled. The
  // design direction must exist in THIS thread before dates.
  else if (!state.known_requested_date && state.form_submitted && !String(state.known_design_context || '').trim() && state.known_client_anchored_inspiration !== true && !knownTattooReferenceMediaReceived({ structured_state: state }) && state.live_turn_gave_design_idea !== true) state.booking_stage_hint = 'awaiting_design_direction'
  else if (!state.known_requested_date && state.form_submitted) state.booking_stage_hint = 'awaiting_date'
  else if (state.form_link_sent && !state.form_submitted) state.booking_stage_hint = 'awaiting_form_submission'
  else if (state.form_offer_asked && !state.form_link_sent) state.booking_stage_hint = 'awaiting_form_permission_answer'
  else if (state.known_design_context || state.known_placement_context || state.known_size_context || state.tattoo_intent_active) state.booking_stage_hint = 'design_intake'
  else state.booking_stage_hint = 'open_conversation'

  return normalizeBookingCalendarDates(state)
}

function mergeStructuredState(msg, recentHistory, override) {
  const base = buildStructuredState(msg, recentHistory)
  if (!override || typeof override !== 'object') return base

  const merged = {
    ...base,
    ...override
  }

  if (!Array.isArray(merged.close_booking_options_local) || merged.close_booking_options_local.length === 0) {
    merged.close_booking_options_local = base.close_booking_options_local
  }

  if (!merged.earliest_booking_option_local) {
    merged.earliest_booking_option_local =
      merged.close_booking_options_local[0] || base.earliest_booking_option_local || ''
  }

  if (!merged.date_selection_rule) {
    merged.date_selection_rule = base.date_selection_rule
  }

  return normalizeBookingCalendarDates(merged)
}

function adoptRunnerIntentState(structuredState, runnerIntentState, liveMessage = '') {
  const state = structuredState && typeof structuredState === 'object' ? structuredState : {}
  const intent = runnerIntentState && typeof runnerIntentState === 'object' ? runnerIntentState : {}

  if (intent.llm_intent_applied === true) state.llm_intent_applied = true
  for (const field of [
    'live_turn_form_consent',
    'live_turn_explicit_form_request',
    'live_turn_accepts_offered_slot',
    'live_turn_form_submitted_signal',
    'live_turn_deposit_sent',
    'live_turn_pricing_question',
    'live_turn_is_question',
    'live_turn_declines'
  ]) {
    if (intent[field] === true) state[field] = true
  }

  // The discourse classifier may only select a bounded context route. Copy its
  // complete result, including false values that clear a provisional structural
  // floor after recent-history resolution. It never supplies referent facts or
  // visible wording.
  if (intent.context_classifier_applied === true) {
    state.context_classifier_applied = true
    for (const field of [
      'live_turn_context_missing',
      'live_turn_context_missing_attachment',
      'live_turn_context_needs_clarification',
      'live_turn_context_resolved_from_history',
      'live_turn_self_contained_topic_shift',
      'live_turn_reference_pointer_without_media'
    ]) state[field] = intent[field] === true
    for (const field of [
      'live_turn_context_relation',
      'live_turn_context_confidence',
      'live_turn_context_resolution_source',
      'live_turn_context_reason_code',
      'live_turn_context_antecedent_quote'
    ]) state[field] = String(intent[field] || '')

    // Missing discourse context owns the turn before any lexical decline flag.
    // This prevents an embedded third-party "no" from becoming the client's own
    // refusal while preserving a genuine, context-grounded "not yet" decline.
    if (state.live_turn_context_missing === true) state.live_turn_declines = false
  }

  const groundedDesignIdea = state.live_turn_context_missing !== true && intent.live_turn_gave_design_idea === true && liveHasConcreteDesignDirection({
    message: liveMessage,
    recent_history: [],
    structured_state: state
  })

  if (intent.tattoo_intent_active === true || intent.live_turn_is_tattoo_intent === true || groundedDesignIdea) {
    state.tattoo_intent_active = true
    state.live_turn_is_tattoo_intent = true
    if (!String(state.booking_stage_hint || '').trim() || String(state.booking_stage_hint) === 'open_conversation') {
      state.booking_stage_hint = 'design_intake'
    }
  }

  if (groundedDesignIdea) {
    state.live_turn_gave_design_idea = true
    const candidate = String(liveMessage || '').trim()
    if (
      candidate &&
      !String(state.known_design_context || '').trim() &&
      !textIsTattooBusinessProcessQuestion(candidate)
    ) {
      state.known_design_context = candidate
    }
  }

  return state
}

// ---------------------------------------------------------------------------
// Four-field checkpoint revisions (live incident 2026-09-02, Omar.system).
// After the hotel-style double-check the client may change one field instead of
// confirming. A revision with a resolvable value re-opens the checkpoint with
// the corrected field; a revision without a resolvable value is classified so
// the controller can ask for exactly that field instead of freezing on
// "await confirmation" and falling to a generic recovery line.
// ---------------------------------------------------------------------------
const CHECKPOINT_CONFIRMATION_OPENERS = /^(?:(?:looks|all|sounds)\s+good|(?:that'?s|that’s|thats|this\s+is|it'?s|it’s|its)\s+(?:right|correct|it|perfect|good|fine|all\s+good)|yes+|yep|yup|yeah+|yea|correct|perfect(?:o)?|bet|sure|ok(?:ay)?|k|confirmed|confirm|good|great|right|exactly)\b/i
const CHECKPOINT_CHANGE_VERB = /\b(?:change|changing|switch|move|push|bump|shift|reschedule|update|fix|edit|redo|adjust|correct|swap|different|another|other|wrong|typo|mistake|instead|rather|later|earlier|sooner|revise|modify|amend)\b/i
const CHECKPOINT_CHANGE_REQUEST = /\b(?:can|could|may|wanna|want\s+to|need\s+to|gotta|have\s+to|like\s+to|able\s+to)\s+(?:i|we|you|u|to)?\s*(?:change|switch|update|fix|edit|redo|adjust|correct|swap|move|revise|modify|amend)\b/i
const CHECKPOINT_TIME_WORD = /\b(?:time|hour|hours|clock|o'?clock|am|pm|morning|afternoon|evening|noon|start\s+time)\b/i
const CHECKPOINT_DATE_WORD = /\b(?:date|day|days|dates|week|weekend|month|calendar)\b/i
const CHECKPOINT_NAME_WORD = /\b(?:name|spelled|spelling|spell)\b/i
const CHECKPOINT_PHONE_WORD = /\b(?:number|phone|digits|cell|mobile|contact)\b/i

function extractCheckpointPhoneRevision(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  if (textFramesThirdPartyBookingIdentity(raw)) return ''
  return extractPhone(raw) || ''
}

function extractCheckpointNameRevision(text) {
  const raw = String(text || '')
    .normalize('NFKC')
    .replace(/[‘’ʼ＇]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw || extractPhone(raw) || extractTime(raw) || extractDatePhrase(raw)) return ''
  if (textFramesThirdPartyBookingIdentity(raw)) return ''
  const patterns = [
    /\b(?:my\s+)?name(?:\s+on\s+(?:the\s+)?(?:form|application))?\s*(?:is|was|should\s+be|'s|:)\s*(?:actually\s+|just\s+|really\s+)?([\p{L}][\p{L}.'\-]*(?:\s+[\p{L}][\p{L}.'\-]*){0,3})\s*[.!?]*$/iu,
    /^(?:actually|no|nah|wait)[,\s]+(?:it'?s|its|i'?m|im)\s+([\p{L}][\p{L}.'\-]*(?:\s+[\p{L}][\p{L}.'\-]*){0,2})\s*[.!?]*$/iu,
    /^(?:it'?s|its)\s+([A-Z][\p{L}.'\-]*(?:\s+[A-Z][\p{L}.'\-]*){0,2})\s+(?:actually|not\s+.+)\s*[.!?]*$/u,
    /\b(?:spell(?:ed)?|spelling)\s+(?:it\s+|is\s+|as\s+|like\s+)?([\p{L}][\p{L}.'\-]*(?:\s+[\p{L}][\p{L}.'\-]*){0,3})\s*[.!?]*$/iu,
    /\b(?:put|use|write)\s+(?:it\s+(?:down\s+)?(?:as|under)\s+|down\s+)?([A-Z][\p{L}.'\-]*(?:\s+[A-Z][\p{L}.'\-]*){0,2})\s+(?:instead|for\s+the\s+name|as\s+the\s+name)\b/u
  ]
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (!match) continue
    const candidate = cleanNameCandidate(match[1])
    if (!candidate || !isLikelyName(candidate)) continue
    if (/^(?:the|a|an|my|your|our|this|that|wrong|right|correct|different|another|same|form|application|name|number|phone|time|date|day)$/i.test(candidate)) continue
    return candidate
  }
  return ''
}

function sameCommittedClockTime(candidate, committed) {
  const a = canonicalClockTime(candidate)
  const b = canonicalClockTime(committed)
  return Boolean(a && b && a === b)
}

function sameCommittedCalendarDate(candidate, committed, options = {}) {
  const a = classifyBookingDateText(String(candidate || ''), { ...options, allowAmbiguousDay: false })
  const b = classifyBookingDateText(String(committed || ''), { ...options, allowAmbiguousDay: false })
  return Boolean(a?.date_iso && b?.date_iso && a.date_iso === b.date_iso)
}

function classifyCheckpointRevisionIntent(liveText, frames = {}) {
  const raw = String(liveText || '').trim()
  if (!raw) return null
  const lower = normalizeText(raw)
  if (textIsBareAffirmativeConfirmation(raw) || isSlotAcceptanceText(raw)) return null
  if (CHECKPOINT_CONFIRMATION_OPENERS.test(lower) && !CHECKPOINT_CHANGE_VERB.test(lower) && !CHECKPOINT_CHANGE_REQUEST.test(lower)) return null
  const timeFrame = frames.timeFrame || {}
  const dateFrame = frames.dateFrame || {}
  const committedTime = String(frames.committedTime || '')
  const committedDate = String(frames.committedDate || '')
  const dateOptions = frames.dateOptions || {}
  // Committed-slot polarity (v134 law): rejecting some OTHER value ("I can't do
  // 3pm" while the checkpoint says 2pm) is not a revision of the checkpoint.
  // Only rejecting the committed value itself reopens the field.
  if (timeFrame.ambiguous === true) return { kind: 'time', alternatives: Array.isArray(timeFrame.alternatives) ? timeFrame.alternatives : [], frame_reason: String(timeFrame.reason || '') }
  if (timeFrame.rejection === true) {
    if (committedTime && !sameCommittedClockTime(timeFrame.candidate_text, committedTime)) return null
    return { kind: 'time', rejected: String(timeFrame.candidate_text || ''), frame_reason: String(timeFrame.reason || '') }
  }
  if (timeFrame.bounded === true) return { kind: 'time', bounded: true, boundary: String(timeFrame.candidate_text || ''), frame_reason: String(timeFrame.reason || '') }
  if (dateFrame.ambiguous === true) return { kind: 'date', ambiguous: true, frame_reason: String(dateFrame.reason || '') }
  if (dateFrame.rejection === true) {
    if (committedDate && !sameCommittedCalendarDate(dateFrame.candidate_text, committedDate, dateOptions)) return null
    return { kind: 'date', rejected: String(dateFrame.candidate_text || ''), frame_reason: String(dateFrame.reason || '') }
  }
  if (dateFrame.bounded === true) return { kind: 'date', bounded: true, boundary: String(dateFrame.candidate_text || ''), frame_reason: String(dateFrame.reason || '') }
  if (CHECKPOINT_CHANGE_VERB.test(lower) || CHECKPOINT_CHANGE_REQUEST.test(lower)) {
    const time = CHECKPOINT_TIME_WORD.test(lower)
    const date = CHECKPOINT_DATE_WORD.test(lower)
    const name = CHECKPOINT_NAME_WORD.test(lower)
    const phone = CHECKPOINT_PHONE_WORD.test(lower)
    if (time && !date && !name && !phone) return { kind: 'time', vague: true }
    if (date && !time && !name && !phone) return { kind: 'date', vague: true }
    if (name && !phone && !time && !date) return { kind: 'name', vague: true }
    if (phone && !name && !time && !date) return { kind: 'phone', vague: true }
    if ((name || phone) && !time && !date) return { kind: 'identity', vague: true }
    return { kind: 'unspecified', vague: true }
  }
  return null
}

function annotateStructuredStateForLiveTurn(msg, structuredState, recentHistory = []) {
  const state = {
    ...(structuredState || {})
  }

  const liveText = String(msg?.text || msg?.message || '').trim()
  const liveNormalized = normalizeText(liveText)
  const ingressTimeMs = immutableIngressTimeMs(msg)
  const ingressReferenceTime = ingressTimeMs
    ? new Date(ingressTimeMs).toISOString()
    : (msg?.received_at || undefined)

  state.live_turn_text = liveText
  // Pricing authority is current-turn evidence, not a model-authored flag.
  // Stamp it during structural annotation as well as the later tone overlay so
  // every caller sees the same route before candidate generation.
  state.live_turn_pricing_question = textAsksPricingOrPolicy(liveText)
  state.live_turn_form_link_resend_requested = isExplicitFormLinkRequest(
    liveText,
    msg?.instagram_username
  )
  state.live_turn_is_media_reference = isMediaReferenceUrl(liveText) || /^sent a (photo|reference post|media)\b/i.test(liveText)
  state.live_turn_is_voice_note =
    String(msg?.media_type || '').trim().toLowerCase() === 'voice' ||
    /^sent a voice note\b/i.test(liveText)
  if (state.live_turn_is_voice_note) state.live_turn_is_media_reference = false
  // Media-only / view-once inbound: they sent a photo we can't necessarily open (no
  // forwardable content). Still must reply like a human who noticed it.
  state.live_turn_is_media_only_no_content = /^sent a photo$/i.test(liveText)
  state.live_turn_is_heart_reaction = /^sent a heart reaction$/i.test(liveText)
  applyDiscourseClassification(state, null, liveText, recentHistory)

  // A direct, self-contained information request owns its own referent.  The
  // live incident "Hi, can I please get more info here?" was structurally
  // tagged as ambiguous because of the final word "here".  When the optional
  // intent model was unavailable, that provisional flag survived into the
  // controller and conflicted with the mandatory information-answer verifier:
  // every authored answer was rejected and the turn fell into generic
  // resolve-context recovery.  Resolve this at the shared deterministic state
  // boundary so controller, model, verifiers, and recovery all see the same
  // current-turn object without depending on a successful classifier call.
  if (liveInfoAskOpener({
    ...msg,
    message: liveText,
    live_message: liveText,
    recent_history: recentHistory,
    structured_state: state
  })) {
    state.live_turn_context_missing = false
    state.live_turn_context_missing_attachment = false
    state.live_turn_context_needs_clarification = false
    state.live_turn_reference_pointer_without_media = false
    state.live_turn_context_resolved_from_history = false
    state.live_turn_self_contained_topic_shift = true
    state.live_turn_context_relation = 'self_contained_topic_shift'
    state.live_turn_context_confidence = 'high'
    state.live_turn_context_resolution_source = 'deterministic_direct_info_request'
    state.live_turn_is_question = true
    state.live_turn_is_tattoo_intent = true
    state.tattoo_intent_active = true
    if (!String(state.booking_stage_hint || '').trim() || String(state.booking_stage_hint) === 'open_conversation') {
      state.booking_stage_hint = 'design_intake'
    }
  }

  state.live_turn_date_phrase = ''
  state.live_turn_date_status = ''
  state.live_turn_date_iso = ''
  state.live_turn_date_availability = ''
  state.live_turn_date_availability_source = ''
  state.booking_policy_version = SCV_BOOKING_POLICY_VERSION
  state.booking_policy_fingerprint = BOOKING_POLICY_FINGERPRINT
  state.live_turn_contextual_booking_reply = false
  state.live_turn_monthless_day_candidate = ''
  state.live_turn_date_needs_month = false
  state.live_turn_contextual_month_anchor = ''
  state.live_turn_name_candidate = ''
  state.live_turn_phone_candidate = ''
  state.live_turn_form_submitted_signal = false
  state.live_turn_accepts_offered_slot = false
  state.live_turn_accepted_offered_date = ''
  state.live_turn_accepted_offered_time = ''
  state.live_turn_time_phrase = ''
  state.live_turn_time_candidate = ''
  state.live_turn_time_status = ''
  const liveFormSubmittedSignal = (
    state.form_link_sent === true &&
    !/\b(deposit|payment|money|zelle|venmo|cash\s*app|paypal)\b/i.test(liveText) &&
    (looksLikeFormSubmitted(liveNormalized, liveText) || voiceTranscriptClaimsSubmission(liveText, state))
  )
  state.live_turn_form_submitted_signal = liveFormSubmittedSignal

  // Resolve the open dialogue slot before generic design/placement/size
  // extraction. The immediately preceding assistant date question owns a bare
  // day proposal such as "How about 26?"; a lower-level approximate-size
  // matcher may not relabel it.
  const contextualDayReply = (
    extractContextualBookingDayReply(liveText, state, recentHistory) ||
    extractContextualBookingMonthReply(liveText, state, recentHistory)
  )

  // Current-turn evidence must enter structured state before route generation.
  // Inbound history timing is transport-dependent and cannot be the only source
  // of design/placement/size truth. This is the liveness fix for a complete first
  // brief such as an unknown motif + shoulder + 4 by 4 inches.
  const priorAssistantPacket = latestAssistantPacketText(recentHistory, state)
  const priorAssistantCheckpoint = extractVisibleAssistantDoubleCheckFields(
    priorAssistantPacket
  )
  const assistantCheckpointImmediatelyOpen = Boolean(
    priorAssistantCheckpoint &&
    assistantTextLooksLikeNamePhoneDateTimeDoubleCheck(priorAssistantPacket)
  )
  // The checkpoint stays open until it is confirmed, superseded, or invalidated,
  // even when clarification or recovery turns were sent after it (live
  // red-team 2026-09-02: "2 or 4?" -> ask -> "4" must still revise the
  // checkpoint although the immediately preceding assistant turn was the ask).
  const assistantCheckpointOpen = Boolean(
    assistantCheckpointImmediatelyOpen ||
    state.double_check_sent === true ||
    state.name_phone_date_time_double_check_sent === true ||
    String(state.booking_stage_hint || '').trim() === 'awaiting_double_check_confirmation'
  )
  const liveClientAnchoredInspiration = clientAnchoredInspirationReference({
    message: liveText,
    live_message: liveText,
    recent_history: recentHistory,
    structured_state: state
  })
  // A durable anchored-inspiration flag is memory, not a current-turn design
  // statement. Only the turn that establishes the anchor, or a turn that itself
  // gives concrete design direction, may author known_design_context. Live
  // regression 2026-09-02 (Omar.system): after the reference post every booking
  // turn ("How about fifth of September?", "Can we actually do 3 PM?", "looks
  // good") overwrote the design context with scheduling text and was stamped as
  // a design idea.
  const anchoredBeforeLiveTurn = state.known_client_anchored_inspiration === true
  const liveTextGivesDesign = textGivesConcreteDesignDirection(liveText, state)
  const liveEstablishesAnchor = liveClientAnchoredInspiration && !anchoredBeforeLiveTurn
  const liveConcreteDesign = liveTextGivesDesign || liveEstablishesAnchor
  // While the four-field checkpoint is open the live turn is a confirmation or a
  // revision of booking fields, never a new design statement.
  if (!liveFormSubmittedSignal && !assistantCheckpointOpen && liveConcreteDesign && state.live_turn_context_missing !== true) {
    if (liveClientAnchoredInspiration) state.known_client_anchored_inspiration = true
    if (
      liveTextGivesDesign ||
      (liveEstablishesAnchor && !textIsBareAffirmativeConfirmation(liveText))
    ) state.known_design_context = liveText
    state.live_turn_gave_design_idea = true
    state.live_turn_is_tattoo_intent = true
    state.tattoo_intent_active = true
  }
  const liveTattooContext = (
    (!liveFormSubmittedSignal && (liveConcreteDesign || liveClientAnchoredInspiration)) ||
    state.tattoo_intent_active === true ||
    !!String(state.known_design_context || '').trim()
  )
  if (!liveFormSubmittedSignal && liveTattooContext && textGivesPlacementContext(liveText)) state.known_placement_context = liveText
  if (!liveFormSubmittedSignal && liveTattooContext && !contextualDayReply && textGivesSizeContext(liveText)) state.known_size_context = liveText
  if (
    contextualDayReply &&
    normalizeText(state.known_size_context) === normalizeText(liveText)
  ) {
    state.known_size_context = ''
  }
  state.live_turn_reference_context = String(state.reference_request_context || '')

  const assistantOpensDateSlot =
    assistantPacketOpensDateAvailability(priorAssistantPacket) ||
    assistantCheckpointOpen
  const assistantOpensTimeSlot =
    assistantPacketOpensTimeSelection(priorAssistantPacket) ||
    assistantCheckpointOpen
  // v147 (live 2026-09-03 16:38Z): "Can we do fifth of September?" right after
  // the form link, before the form match, carried no live date status because
  // booking context began only at the form match; the intent classifier then
  // labelled the turn a stand-alone question and the route flipped to social.
  // The assistant's open date ask after the form link IS booking context.
  const liveActiveBookingContext =
    state.form_submitted === true ||
    state.live_turn_form_submitted_signal === true ||
    (state.form_link_sent === true && assistantOpensDateSlot)

  const phone = extractPhone(liveText)
  if (!liveFormSubmittedSignal && phone && textFramesPhoneAsFormIdentity(liveText, state, recentHistory)) {
    state.live_turn_phone_candidate = phone
    const nameWithPhone = extractFormIdentityNameWithPhone(liveText)
    if (nameWithPhone) {
      state.live_turn_name_candidate = nameWithPhone
    }
  }

  if (
    !state.live_turn_name_candidate &&
    !liveFormSubmittedSignal &&
    !state.live_turn_is_heart_reaction &&
    !contextualDayReply &&
    isLikelyName(liveText)
  ) {
    // "my name is actually Omar Sys" carries the name inside a revision frame;
    // take the framed name before falling back to the whole-text candidate.
    state.live_turn_name_candidate = extractCheckpointNameRevision(liveText) || cleanNameCandidate(liveText)
  }

  const liveDateProposalFrame = calendarBookingProposalFrame(liveText, {
    allowBareDate: liveActiveBookingContext && assistantOpensDateSlot
  })
  // A monthless ordinal offered as a revision of the open four-field checkpoint
  // ("actually can we do the 10th instead") belongs to the checkpoint's month.
  let checkpointAnchoredDateText = ''
  if (
    !contextualDayReply?.month_anchor &&
    assistantCheckpointOpen &&
    liveDateProposalFrame.proposal === true
  ) {
    const ordinal = String(liveDateProposalFrame.candidate_text || '').trim().match(/^(?:the\s+)?([1-9]|[12]\d|3[01])(?:st|nd|rd|th)$/i)
    const monthAnchor = monthAnchorsInText(
      String(priorAssistantCheckpoint?.date_text || state.known_requested_date || state.last_offered_date || '')
    )[0]
    if (ordinal && monthAnchor) checkpointAnchoredDateText = `${monthAnchor} ${ordinal[1]}`
  }
  const contextualDateText = contextualDayReply?.month_anchor
    ? `${contextualDayReply.month_anchor} ${contextualDayReply.day}`
    : checkpointAnchoredDateText
  const dateDecision = liveActiveBookingContext && (
    contextualDateText ||
    (liveDateProposalFrame.proposal === true && liveDateProposalFrame.candidate_text)
  )
    ? classifyBookingDateText(contextualDateText || liveDateProposalFrame.candidate_text, {
      referenceTime: ingressReferenceTime,
      currentDateLocal: state.current_message_date_local,
      minimumDateLocal: state.minimum_booking_date_local,
      allowAmbiguousDay: contextualDateText ? true : false
    })
    : { status: 'missing', phrase: '', date: null }
  const suggestedDate = ['too_soon', 'legal'].includes(dateDecision.status)
    ? dateDecision.date
    : null
  // A suffixless hour is read on the tattoo-day clock only while the four-field
  // checkpoint is open (a time already exists to revise). Open time questions
  // keep the narrower contextual bare-hour law owned by the control plane.
  const liveTimeProposalFrame = clockTimeBookingProposalFrame(liveText, {
    allowBareTime: assistantOpensTimeSlot,
    allowBareHour: assistantCheckpointOpen
  })
  const parsedLiveTime = liveTimeProposalFrame.proposal === true
    ? extractTime(liveTimeProposalFrame.candidate_text)
    : ''
  const liveActiveTimeSlot = Boolean(
    (
      liveActiveBookingContext ||
      (
        String(state.last_offered_date || '').trim() &&
        String(state.last_offered_time || '').trim()
      )
    ) &&
    (
      suggestedDate ||
      String(state.known_requested_date || '').trim() ||
      String(state.last_offered_date || '').trim() ||
      String(state.booking_stage_hint || '').trim() === 'awaiting_time'
    )
  )
  const liveTimeDecision = parsedLiveTime && liveActiveTimeSlot
    ? classifyBookingClockTimeText(parsedLiveTime)
    : { status: 'missing', canonical_label: '', minimum_booking_time_label: MINIMUM_BOOKING_TIME_LABEL }
  const explicitLiveTime = (
    parsedLiveTime &&
    liveActiveTimeSlot &&
    liveTimeDecision.status === 'legal'
  ) ? parsedLiveTime : ''

  if (contextualDayReply) {
    state.live_turn_contextual_booking_reply = true
    state.live_turn_monthless_day_candidate = String(contextualDayReply.day)
    state.live_turn_contextual_month_anchor = contextualDayReply.month_anchor
    state.live_turn_date_needs_month = !contextualDayReply.month_anchor
    // The immediately open scheduling question grounds the number as a calendar
    // day. A later intent classifier may not relabel this turn as unrelated
    // small talk merely because the month is still missing.
    state.live_turn_context_relation = 'resolved_from_history'
    state.live_turn_context_confidence = 'high'
    state.live_turn_context_resolution_source = String(
      contextualDayReply.month_resolution_source || 'open_booking_question_slot_authority'
    )
    state.live_turn_context_missing = false
    state.live_turn_context_missing_attachment = false
    state.live_turn_context_needs_clarification = false
    state.live_turn_context_resolved_from_history = true
    state.live_turn_self_contained_topic_shift = false
    state.live_turn_reference_pointer_without_media = false
  }

  if (liveTimeDecision.status !== 'missing') {
    state.live_turn_time_candidate = liveTimeDecision.canonical_label || parsedLiveTime
    state.live_turn_time_status = liveTimeDecision.status
    state.minimum_booking_time_local = liveTimeDecision.minimum_booking_time_label
  }

  if (liveTimeDecision.status === 'too_early') {
    // A readable but prohibited time is not missing context and is never
    // durable booking authority. Keep only the transient candidate so the
    // visible layer can respond to it, then remain on the time checkpoint.
    state.known_requested_time = ''
    state.accepted_offered_date = ''
    state.accepted_offered_time = ''
    state.live_turn_accepted_offered_time = ''
    state.live_turn_accepts_offered_slot = false
    state.live_turn_checkpoint_invalidated = true
    delete state.double_check_sent
    delete state.name_phone_date_time_double_check_sent
    state.checkpoint_superseded_by_revision = true
  } else if (explicitLiveTime) {
    // Committed-slot polarity: restating the committed time ("not 3pm, 2pm
    // works") re-affirms the open checkpoint; only a different time revises it.
    const committedTimeBeforeLiveTurn = String(state.known_requested_time || state.accepted_offered_time || '').trim()
    const reaffirmsCommittedTime = Boolean(
      committedTimeBeforeLiveTurn &&
      canonicalClockTime(explicitLiveTime) === canonicalClockTime(committedTimeBeforeLiveTurn)
    )
    state.live_turn_time_phrase = explicitLiveTime
    state.known_requested_time = explicitLiveTime
    if (assistantCheckpointOpen && !reaffirmsCommittedTime) {
      state.live_turn_checkpoint_invalidated = true
      delete state.double_check_sent
      delete state.name_phone_date_time_double_check_sent
      state.checkpoint_superseded_by_revision = true
    }
    // A time-only reply to a concrete offer keeps that offer's date while
    // replacing only the time. This is a counterproposal when it differs.
    if (!suggestedDate && state.last_offered_date && !state.known_requested_date) {
      state.known_requested_date = state.last_offered_date
    }
  }

  if (suggestedDate) {
    // Committed-slot polarity: restating the committed date re-affirms the open
    // checkpoint; only a different calendar date revises it.
    const committedDateBeforeLiveTurn = String(state.known_requested_date || state.accepted_offered_date || '').trim()
    const committedDateDecision = committedDateBeforeLiveTurn
      ? classifyBookingDateText(committedDateBeforeLiveTurn, {
        referenceTime: ingressReferenceTime,
        currentDateLocal: state.current_message_date_local,
        minimumDateLocal: state.minimum_booking_date_local,
        allowAmbiguousDay: false
      })
      : null
    const reaffirmsCommittedDate = Boolean(
      committedDateDecision?.date_iso &&
      dateDecision.date_iso &&
      committedDateDecision.date_iso === dateDecision.date_iso
    )
    state.live_turn_date_phrase = contextualDateText || dateDecision.phrase || dateDecision.canonical_label
    state.live_turn_date_status = dateDecision.status
    state.live_turn_date_iso = dateDecision.date_iso
    state.live_turn_date_availability = dateDecision.availability
    state.live_turn_date_availability_source = dateDecision.availability_source
    if (assistantCheckpointOpen && !reaffirmsCommittedDate) {
      state.live_turn_checkpoint_invalidated = true
      delete state.double_check_sent
      delete state.name_phone_date_time_double_check_sent
      state.checkpoint_superseded_by_revision = true
      // Live red-team 2026-09-03 (v143 case 11): the closed-transition contract
      // treats a replaced date as invalidating its sibling time and re-asks the
      // time, but the durable time survived here, so the runner's funnel stage
      // still read "ready for the checkpoint" and the structured contract read
      // the time as known. Every candidate then violated one side or the other
      // (checkpoint under the time-ask route, or re-asking a "known" time) and
      // the turn burned three passes into the generic recovery ask. A date-only
      // revision at the open checkpoint clears the sibling time in state too, so
      // route, runner and contract agree: ask the time for the new date, then
      // the next time answer re-issues the checkpoint deterministically.
      if (!String(state.live_turn_time_phrase || '').trim() && !parsedLiveTime) {
        state.known_requested_time = ''
        state.accepted_offered_time = ''
        state.live_turn_accepted_offered_time = ''
      }
    }
  }

  if (
    assistantCheckpointOpen &&
    !liveFormSubmittedSignal &&
    state.live_turn_checkpoint_invalidated !== true
  ) {
    const phoneRevision = extractCheckpointPhoneRevision(liveText)
    const nameRevision = phoneRevision ? '' : extractCheckpointNameRevision(liveText)
    if (phoneRevision) {
      state.live_turn_phone_candidate = phoneRevision
      state.known_phone_used_on_form = phoneRevision
      const nameWithPhone = extractFormIdentityNameWithPhone(liveText)
      if (nameWithPhone) {
        state.live_turn_name_candidate = nameWithPhone
        state.known_name_used_on_form = nameWithPhone
      }
      state.live_turn_checkpoint_invalidated = true
      state.live_turn_checkpoint_revision_intent = 'phone'
      state.live_turn_checkpoint_revision_detail = { kind: 'phone', value_resolved: true }
      delete state.double_check_sent
      delete state.name_phone_date_time_double_check_sent
      state.checkpoint_superseded_by_revision = true
    } else if (nameRevision) {
      state.live_turn_name_candidate = nameRevision
      state.known_name_used_on_form = nameRevision
      state.live_turn_checkpoint_invalidated = true
      state.live_turn_checkpoint_revision_intent = 'name'
      state.live_turn_checkpoint_revision_detail = { kind: 'name', value_resolved: true }
      delete state.double_check_sent
      delete state.name_phone_date_time_double_check_sent
      state.checkpoint_superseded_by_revision = true
    } else {
      const revision = classifyCheckpointRevisionIntent(liveText, {
        timeFrame: liveTimeProposalFrame,
        dateFrame: liveDateProposalFrame,
        committedTime: state.known_requested_time || state.accepted_offered_time || '',
        committedDate: state.known_requested_date || state.accepted_offered_date || '',
        dateOptions: {
          referenceTime: ingressReferenceTime,
          currentDateLocal: state.current_message_date_local,
          minimumDateLocal: state.minimum_booking_date_local
        }
      })
      if (revision) {
        state.live_turn_checkpoint_revision_intent = revision.kind
        state.live_turn_checkpoint_revision_detail = revision
      }
    }
  }
  // A resolved checkpoint revision ("can we make it 3?") is a booking turn; the
  // pronoun inside it is not an unresolved media pointer.
  if (assistantCheckpointOpen && state.live_turn_checkpoint_invalidated === true) {
    state.live_turn_reference_pointer_without_media = false
    state.live_turn_context_missing_attachment = false
    state.live_turn_context_missing = false
    state.live_turn_context_needs_clarification = false
    state.live_turn_context_relation = 'resolved_from_history'
    state.live_turn_context_resolved_from_history = true
  }

  // v147 (GOLD-2 replay gold-b-05): once the assistant's open slot question is
  // booking context before the form match, "Yeah, we can do September 10" after
  // "does september 10 (thursday) at 2pm work for you" resolves as a live date;
  // restating the offered day is acceptance of that slot, not a counter-proposal.
  const liveDateRestatesOfferedSlot = Boolean(
    suggestedDate &&
    String(state.last_offered_date || '').trim() &&
    String(dateDecision.date_iso || '').trim() &&
    classifyBookingDateText(String(state.last_offered_date), {
      referenceTime: ingressReferenceTime,
      currentDateLocal: state.current_message_date_local,
      minimumDateLocal: state.minimum_booking_date_local,
      allowAmbiguousDay: true
    }).date_iso === dateDecision.date_iso
  )
  // v147 (GOLD-2 replay gold-b-07): "Yeah, perfect" while the four-field
  // checkpoint is open confirms THAT checkpoint (the corrected 3pm); it must
  // not be re-read as accepting the older offered slot (2pm) and silently
  // rewrite the durable time behind the confirmed block.
  const openCheckpointAwaitsConfirmation = Boolean(
    assistantCheckpointOpen &&
    state.double_check_sent === true &&
    state.live_turn_checkpoint_invalidated !== true &&
    !suggestedDate &&
    !explicitLiveTime
  )
  if (
    !openCheckpointAwaitsConfirmation &&
    (!suggestedDate || liveDateRestatesOfferedSlot) &&
    isSlotAcceptanceText(liveText) &&
    state.last_offered_date &&
    (
      !explicitLiveTime ||
      !state.last_offered_time ||
      canonicalClockTime(explicitLiveTime) === canonicalClockTime(state.last_offered_time)
    )
  ) {
    const acceptedTime = state.last_offered_time || state.known_requested_time || state.accepted_offered_time || ''
    state.live_turn_accepts_offered_slot = true
    state.live_turn_accepted_offered_date = state.last_offered_date
    state.live_turn_accepted_offered_time = acceptedTime
    state.accepted_offered_date = state.last_offered_date
    state.accepted_offered_time = acceptedTime
    state.known_requested_date = state.last_offered_date
    if (acceptedTime) state.known_requested_time = acceptedTime
    if (state.form_submitted && !acceptedTime) {
      state.booking_stage_hint = 'awaiting_time'
    } else if (state.form_submitted && (!state.known_name_used_on_form || !state.known_phone_used_on_form)) {
      state.booking_stage_hint = 'awaiting_form_identity_match'
    } else if (state.form_link_sent && !state.form_submitted) {
      state.booking_stage_hint = 'awaiting_form_submission_for_accepted_slot'
    }
  }

  state.live_turn_booking_match_signal =
    (state.form_submitted || state.live_turn_accepts_offered_slot) &&
    !!state.known_requested_date &&
    !!state.known_requested_time &&
    (
      state.booking_stage_hint === 'awaiting_form_identity_match' ||
      state.booking_stage_hint === 'awaiting_name_used_on_form' ||
      state.booking_stage_hint === 'awaiting_phone_used_on_form' ||
      state.booking_stage_hint === 'awaiting_form_submission_for_accepted_slot'
    )

  state.live_turn_is_ack = !!liveNormalized && (
    liveNormalized === 'ok' ||
    liveNormalized === 'okay' ||
    liveNormalized === 'okk' ||
    liveNormalized === 'sure' ||
    liveNormalized === 'sounds good' ||
    liveNormalized === 'perfect' ||
    liveNormalized === 'perfecttt' ||
    liveNormalized === 'tysm'
  )

  return normalizeBookingCalendarDates(state)
}

function applyAudienceAndToneOverlay(msg, structuredState) {
  const state = {
    ...(structuredState || {})
  }

  const username = String(msg?.instagram_username || '').trim().toLowerCase()
  const liveText = String(msg?.text || msg?.message || '').trim()
  const lineCount = liveText ? liveText.split(/\n+/).filter(Boolean).length : 0
  const sentenceLikeCount = (liveText.match(/[.!?]+/g) || []).length
  const longform =
    liveText.length >= 120 ||
    lineCount >= 2 ||
    sentenceLikeCount >= 2
  const emotionallyLive =
    /(\?|lol|lmao|lmaoo|haha|hehe|omg|wait|can't wait|cant wait|love|excited|wtf|fuck|sad|cry|crying|depressed|depression|anxious|anxiety|overwhelmed|hard time|hurts?|heartbroken|broke up|breakup|miss him|miss her|lonely|tired of|spiraling|😭|🥺|❤️)/i.test(liveText)
  const pricingQuestion = textAsksPricingOrPolicy(liveText)
  const explicitQuestion =
    /[?？]/.test(liveText) ||
    pricingQuestion ||
    /\b(can|could|would|do|does|did|is|are|where|when|what|why|how|price|pricing|cost|costs|charge|charges|fee|fees|rate|rates|available|availability|form|link|address|location)\b/i.test(liveText)
  const hardStopOnly = /^(stop|unsubscribe|do not message me|dont message me|don t message me|please stop|leave me alone|wrong person|not interested stop)[?!. ]*$/i.test(liveText.trim())

  state.assistant_surface_energy = 'april_soul_warm_casual_selective_boutique_dm_presence'
  state.assistant_tone_floor = 'warm_natural_specific_not_forced_delight'
  state.assistant_default_social_mode = 'relationship_first_human_dm_not_lead_record'
  state.assistant_emotional_response_style = 'specific_human_care_before_any_route_move'
  state.live_turn_is_substantive = longform
  state.live_turn_multiline = lineCount >= 2
  state.live_turn_line_count = lineCount
  state.live_turn_sentence_like_count = sentenceLikeCount
  state.live_turn_explicit_question = !!explicitQuestion
  state.live_turn_pricing_question = !!pricingQuestion
  state.live_turn_hard_stop_only = !!hardStopOnly
  state.live_turn_reply_required = !!(liveText && !hardStopOnly)
  state.live_turn_longform_reply_mode = longform ? 'engage_major_points' : 'normal'
  state.live_turn_needs_emotional_care = !!emotionallyLive
  state.special_account_mode = ''
  state.special_account_overlay = ''

  if (username === 'yesiyumy') {
    state.special_account_mode = 'gentle_supportive'
    state.special_account_overlay =
      'be especially gentle warm and emotionally supportive here. if they sound hurt low overwhelmed or heartbroken, first comfort them and help them feel safe talking. show you get it in natural language without sounding scripted or therapeutic. soften the room and make it easy for them to keep opening up. do not sound clinical distant or like a therapy app. keep it sweet caring lightly playful when appropriate.'
  } else if (username === 'tharealimmanuel') {
    state.special_account_mode = 'engaged_longform'
    state.special_account_overlay =
      'this person sends long detailed messages. answer the substance directly and keep momentum. do not drop into silence just because the message is long.'
  }

  return state
}

function normalizePacketBubbleText(text) {
  const value = String(text || '')
  if (normalizeText(value) === 'thats my zelle') {
    return 'that’s my zelle'
  }
  return value
}

function ordinalDayForDoubleCheck(day) {
  const n = Number(day)
  if (!Number.isFinite(n)) return String(day || '').trim()
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  if (n % 10 === 1) return `${n}st`
  if (n % 10 === 2) return `${n}nd`
  if (n % 10 === 3) return `${n}rd`
  return `${n}th`
}

function canonicalDoubleCheckDateSurface(value) {
  const raw = String(value || '').trim().replace(/[.,!?]+$/g, '').trim()
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]
  const monthPattern = '(january|february|march|april|may|june|july|august|september|october|november|december)'
  const monthFirst = raw.match(new RegExp(`^${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+\\d{4})?$`, 'i'))
  if (monthFirst) {
    const month = months.find((item) => item.toLowerCase() === monthFirst[1].toLowerCase())
    return `${ordinalDayForDoubleCheck(monthFirst[2])} of ${month}`
  }
  const dayFirst = raw.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${monthPattern}(?:\\s+\\d{4})?$`, 'i'))
  if (dayFirst) {
    const month = months.find((item) => item.toLowerCase() === dayFirst[2].toLowerCase())
    return `${ordinalDayForDoubleCheck(dayFirst[1])} of ${month}`
  }
  return raw
}

// Money questions must be model-authored with the rate visible and must never be
// answered by the four-line booking checkpoint. This is an adoption assertion:
// it rejects a missing fact rather than inserting visible prose at this boundary.
const FINAL_PRICING_QUESTION_RE = /\b(price|prices|pricing|rate|rates|cost|costs|charge|charges|how much|quote)\b|얼마|가격|요금/i
const FINAL_HOURLY_RATE_RE = /\b150\b/
const FINAL_CHECKPOINT_RE = /^\s*name\s*:/im

function livePricingQuestionText(msg) {
  return [msg?.live_message, msg?.message, msg?.text]
    .map((value) => String(value || ''))
    .find((value) => value.trim()) || ''
}

function applyFinalPricingFloor(msg, packet) {
  if (!packet || !Array.isArray(packet.bubbles)) return packet
  if (!FINAL_PRICING_QUESTION_RE.test(livePricingQuestionText(msg))) return packet

  const joined = packet.bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
  if (FINAL_CHECKPOINT_RE.test(joined)) {
    throw new Error('final_pricing_contract_rejected_booking_checkpoint')
  }
  if (!FINAL_HOURLY_RATE_RE.test(joined)) {
    throw new Error('final_pricing_contract_rejected_model_authored_rate_missing')
  }
  return packet
}

// EXPLAIN ON INTEREST ADOPTION ASSERTION.
// The model remains the sole visible prose author. This boundary verifies that
// explicit ad-interest turns were actually explained and that a generic deictic
// question did not get silently relabeled as tattoo/model interest.
const GENERIC_HOW_WORKS_RE = /\bhow does (?:this|that|it) work\b/i
const TATTOO_OFFER_CONTEXT_RE = /\b(?:tattoo|tattoos|model\s+spots?|model\s+rate|tattoo\s+model|ad|advert|booking|appointment|application|apply|flash|piece|ink|studio)\b/i
const MODEL_EXPLAINED_RE = /\bmodel spots?\b|\ba few spots?\b|\bin my (?:own )?style\b|\bfits? my style\b|\bmy visual language\b|\bstays? in my style\b/i
const REFERENT_CLARIFICATION_RE = /\bwhat (?:do you mean|are you referring to|part|thing|one)\b|\bwhich (?:part|thing|one)\b|\bwhat exactly\b.{0,40}\b(?:mean|referring|asking|talking)\b|\bwhat are you asking about\b/i

function infoContextText(msg) {
  const history = Array.isArray(msg?.recent_history) ? msg.recent_history : []
  return history
    .filter((entry) => entry?.role === 'user' || isConversationVisibleAssistantEvent(entry))
    .map((entry) => String(entry?.text || entry?.message || ''))
    .filter(Boolean)
    .join('\n')
}

function genericHowWorksHasTattooContext(msg) {
  const state = msg?.structured_state && typeof msg.structured_state === 'object'
    ? msg.structured_state
    : {}
  if (
    state.live_turn_context_missing === true ||
    state.live_turn_context_needs_clarification === true
  ) return false
  if (
    state.tattoo_intent_active === true ||
    state.live_turn_is_tattoo_intent === true ||
    state.live_turn_pricing_question === true ||
    String(state.booking_stage_hint || '') !== '' && String(state.booking_stage_hint || '') !== 'open_conversation'
  ) return true
  return TATTOO_OFFER_CONTEXT_RE.test(
    `${livePricingQuestionText(msg)}\n${infoContextText(msg)}\n${String(state.live_turn_context_antecedent_quote || '')}`
  )
}

function applyExplainOnInterestFloor(msg, packet) {
  if (!packet || !Array.isArray(packet.bubbles)) return packet
  const live = livePricingQuestionText(msg)
  const genericHowWorks = GENERIC_HOW_WORKS_RE.test(live)
  // The route, verifier and adoption floor share one open-vocabulary detector.
  // Independent regexes previously disagreed on valid variants such as
  // "Could I please have more details?", allowing one layer to accept a packet
  // that the next layer did not protect.
  const explicitInfoOpener = liveInfoAskOpener(msg)
  if (!genericHowWorks && !explicitInfoOpener) return packet
  const joined = packet.bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
  if (genericHowWorks && !genericHowWorksHasTattooContext(msg)) {
    if (REFERENT_CLARIFICATION_RE.test(joined)) return packet
    throw new Error('generic_how_works_requires_referent_clarification')
  }
  if (!MODEL_EXPLAINED_RE.test(joined)) {
    throw new Error('info_opener_requires_model_authored_explanation')
  }
  return packet
}

function canonicalizeDoubleCheckPacket(packet) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  const raw = bubbles.map((bubble) => String(bubble?.text || '')).join('\n')
  if (!/\b(double check|double-check|check this|make sure)\b/i.test(raw)) return null
  const lines = raw.split(/\r?\n+/).map((line) => line.trim()).filter(Boolean)
  const field = (pattern) => {
    const line = lines.find((candidate) => pattern.test(candidate))
    return line ? line.replace(pattern, '').trim() : ''
  }
  const name = field(/^name\s*:\s*/i)
  const phone = field(/^(?:phone\s+number|phone|number)\s*:\s*/i)
  const date = field(/^appointment\s+date\s*:\s*/i)
  const time = field(/^time\s*:\s*/i)
  if (!(name && phone && date && time)) return null
  const canonicalText =
    `Name : ${name}\nPhone Number : ${phone}\nAppointment date : ${canonicalDoubleCheckDateSurface(date)}\nTime : ${time}\n\ncan you double check this just to make sure`
  // v152 (owner, 2026-09-05): a leading revision acknowledgement ("yes 3pm works")
  // is part of the checkpoint object and keeps its own bubble in front of the
  // canonical block. Any other surrounding prose is still stripped.
  const acknowledgement = lines.length && isCheckpointRevisionAcknowledgementText(lines[0]) ? lines[0] : ''
  return {
    ...packet,
    reply_text: acknowledgement ? `${acknowledgement}\n${canonicalText}` : canonicalText,
    bubbles: acknowledgement
      ? [{ text: acknowledgement, delay_ms: 0 }, { text: canonicalText, delay_ms: 0 }]
      : [{ text: canonicalText, delay_ms: 0 }]
  }
}

function normalizePacket(packet) {
  const bubbles = Array.isArray(packet?.bubbles) ? packet.bubbles : []
  const normalized = {
    ...(packet && typeof packet === 'object' ? packet : {}),
    bubbles: bubbles.map((bubble) => ({
      ...bubble,
      text: normalizePacketBubbleText(bubble.text)
    }))
  }
  return canonicalizeDoubleCheckPacket(normalized) || normalized
}

// ============================================================
// GMAIL FORM AUTO-FILL (Ben directive 2026-07-06): the Squarespace apply form
// emails every submission to Ben's Gmail; scv-gmail-form-reader records them in
// form-submissions/. When the lead says the form is in, fill name/phone from the
// ledger instead of ASKING (asking is friction that costs conversions). Matching:
// exact instagram handle first, then independently corroborated thread signals.
// A bare "only unclaimed form" is never identity evidence: it can be a stale form
// from an earlier debug run or a concurrent lead. The four-field double-check is a
// correction net, not permission to import another person's identity.
// ============================================================
const FORM_SUBMISSIONS_DIR = path.join(LIVE_DIR, 'form-submissions')
const FORM_SUBMISSION_MAX_AGE_MS = Number(process.env.SCV_FORM_SUBMISSION_MAX_AGE_MS || 12 * 60 * 60 * 1000)
const FORM_LINK_MATCH_WINDOW_MS = 45 * 60 * 1000
const FORM_LINK_CLOCK_SKEW_MS = 15 * 1000

// ── WHO-IS-WHO SCORER (Ben, 2026-07-08: "절대로 12시간에 하나만 나오지 않을 거야,
// 핸들 말고 더 정확한 방법 없냐") ── At ad volume the single-unclaimed fallback is
// dead and handles are often garbage ("idk"). Every signal that exists on BOTH
// sides gets scored; adoption needs a threshold AND a margin over the runner-up,
// otherwise refuse — misassigning someone else's identity is worse than asking.
const FORM_MATCH_STOPWORDS = new Set(['that','this','with','want','would','like','tattoo','tatt','piece','idea','know','dont','just','have','some','style','your','yours','from','been','what','when','really','maybe','something','anything','thinking','getting'])

function normPhoneDigits(v) {
  const d = String(v || '').replace(/\D/g, '')
  return d.length >= 7 ? d.slice(-10) : ''
}

function collectThreadIdentitySignals(recentHistory) {
  const phones = new Set()
  const names = []
  const userChunks = []
  let linkSentAt = 0
  for (const e of Array.isArray(recentHistory) ? recentHistory : []) {
    const text = String(e?.text || '')
    const at = Date.parse(String(e?.at || e?.recorded_at || '')) || 0
    if (e?.role === 'user') {
      for (const m of text.match(/\+?[\d\s().-]{7,}/g) || []) {
        const p = normPhoneDigits(m)
        if (p) phones.add(p)
      }
      if (isLikelyName(text)) {
        const n = cleanNameCandidate(text)
        if (n) names.push(String(n).toLowerCase())
      }
      userChunks.push(text.toLowerCase())
    } else if (
      (isConversationVisibleAssistantEvent(e) || acceptedProviderAttemptEvent(e)) &&
      /effacermonexistence\.com\/apply/i.test(text)
    ) {
      if (at > linkSentAt) linkSentAt = at
    }
  }
  return { phones, names, userText: userChunks.join(' '), linkSentAt }
}

function scoreSubmissionCandidate(rec, igNorm, signals, nowMs, helpers) {
  let score = 0
  const why = []
  const recIg = helpers.norm(rec.instagram)
  if (igNorm && recIg) {
    if (recIg === igNorm) { score += 100; why.push('handle_exact') }
    else if (helpers.closeEnough(recIg, igNorm)) { score += 80; why.push('handle_fuzzy') }
    // Ben 2026-08-27 live: he typed the handle as a whisper artifact ("Omar
    // syndrome" for omar.system) and the claim was refused — real leads mistype
    // their own handles too. A long shared prefix is weaker than fuzzy but real
    // evidence; alone it stays below every adoption gate and only crosses the
    // verbal threshold combined with after-link timing + freshness.
    else if (typeof helpers.looseEnough === 'function' && helpers.looseEnough(recIg, igNorm)) { score += 35; why.push('handle_prefix') }
  }
  const recPhone = normPhoneDigits(rec.phone)
  if (recPhone && signals.phones.has(recPhone)) { score += 90; why.push('phone_match') }
  const recName = String(rec.name || '').trim().toLowerCase()
  if (recName && signals.names.length) {
    const recFirst = recName.split(/\s+/)[0]
    const hit = signals.names.some((n) => {
      if (!n) return false
      if (n === recName) return true
      const nFirst = n.split(/\s+/)[0]
      return (recFirst.length >= 4 && nFirst === recFirst) || helpers.closeEnough(n.replace(/\s+/g, ''), recName.replace(/\s+/g, ''))
    })
    if (hit) { score += 55; why.push('name_match') }
  }
  const at = Date.parse(String(rec.email_date || rec.recorded_at || '')) || 0
  if (
    signals.linkSentAt &&
    at >= signals.linkSentAt - FORM_LINK_CLOCK_SKEW_MS &&
    at - signals.linkSentAt <= FORM_LINK_MATCH_WINDOW_MS
  ) { score += 25; why.push('after_link_45m') }
  if (at && nowMs - at <= 10 * 60 * 1000) { score += 15; why.push('fresh_10m') }
  const msgTokens = String(rec.message || '').toLowerCase().match(/[a-z]{4,}/g) || []
  let overlap = 0
  for (const t of new Set(msgTokens)) {
    if (FORM_MATCH_STOPWORDS.has(t)) continue
    if (signals.userText.includes(t)) overlap++
  }
  if (overlap >= 2) { score += 40; why.push('idea_overlap') }
  else if (overlap === 1) { score += 15; why.push('idea_overlap_weak') }
  return { score, why }
}

function claimLatestFormSubmission(threadId, instagramUsername = '', opts = {}) {
  let entries = []
  try { entries = fs.readdirSync(FORM_SUBMISSIONS_DIR).filter((f) => f.endsWith('.json')) } catch { return null }
  const now = Date.now()
  const candidates = []
  for (const f of entries) {
    try {
      const file = path.join(FORM_SUBMISSIONS_DIR, f)
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'))
      const at = Date.parse(rec.email_date || rec.recorded_at || '') || 0
      if (!at || now - at > FORM_SUBMISSION_MAX_AGE_MS) continue
      const claimedBy = String(rec.claimed_by || '')
      if (claimedBy && claimedBy !== String(threadId)) continue
      candidates.push({ file, rec, at })
    } catch {}
  }
  if (!candidates.length) return null

  // WHO-IS-WHO policy (Ben 2026-07-07): instagram handle is the primary key (exact,
  // then fuzzy for typos like dvklbrr/dvklbr). With no corroborating identity
  // signal, refuse even when only one unclaimed record exists. Queue cardinality is
  // transport state, not proof that the form belongs to this person.
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/^@/, '').replace(/[._\s]/g, '')
  // Typo tolerance (Ben 2026-07-08: "오타가 나도 비슷하게는 적는다"): bounded
  // Damerau-Levenshtein — adjacent transposition (the most common typo) counts as
  // ONE edit, and longer handles (>=8 chars) get 2-edit tolerance. Safety stays in
  // the scorer: two candidates both fuzzy-matching -> margin fails -> refuse & ask.
  const editDistance2 = (a, b) => {
    const al = a.length; const bl = b.length
    if (Math.abs(al - bl) > 2) return 3
    let prev2 = null
    let prev = Array.from({ length: bl + 1 }, (_, j) => j)
    for (let i = 1; i <= al; i++) {
      const cur = [i]
      for (let j = 1; j <= bl; j++) {
        let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          d = Math.min(d, prev2[j - 2] + 1)
        }
        cur[j] = d
      }
      prev2 = prev; prev = cur
    }
    return prev[bl]
  }
  const closeEnough = (a, b) => {
    if (!a || !b) return false
    if (a === b) return true
    if (a.includes(b) || b.includes(a)) return Math.abs(a.length - b.length) <= 2
    const dist = editDistance2(a, b)
    if (dist <= 1) return true
    return dist === 2 && Math.min(a.length, b.length) >= 8
  }
  const looseEnough = (a, b) => {
    if (!a || !b) return false
    let shared = 0
    const cap = Math.min(a.length, b.length)
    while (shared < cap && a[shared] === b[shared]) shared += 1
    return shared >= 5
  }
  const ig = norm(instagramUsername)
  const signals = collectThreadIdentitySignals(opts.recent_history || [])
  const requireAfterLink = opts.require_after_link === true
  const eligibleCandidates = requireAfterLink
    ? candidates.filter((c) => (
        signals.linkSentAt > 0 &&
        c.at >= signals.linkSentAt - FORM_LINK_CLOCK_SKEW_MS &&
        c.at - signals.linkSentAt <= FORM_LINK_MATCH_WINDOW_MS
      ))
    : candidates
  if (!eligibleCandidates.length) {
    console.log(JSON.stringify({
      type: 'form_submission_refused',
      mode: opts.handle_match_only === true ? 'proactive' : 'verbal',
      reason: requireAfterLink ? 'no_submission_after_current_form_link' : 'no_eligible_submission',
      candidates: candidates.length,
      link_sent_at: signals.linkSentAt ? new Date(signals.linkSentAt).toISOString() : ''
    }))
    return null
  }
  // Re-claim my own previous claim first (idempotent across turns).
  // On resettable test accounts require_after_link also applies here; otherwise a
  // record claimed by the same numeric thread in an older run can re-enter forever.
  const alreadyMine = eligibleCandidates.filter((c) => String(c.rec.claimed_by || '') === String(threadId))
  let picked = alreadyMine.length ? alreadyMine.sort((a, b) => b.at - a.at)[0] : null
  if (!picked) {
    const unclaimed = eligibleCandidates.filter((c) => !String(c.rec.claimed_by || ''))
    const scored = unclaimed
      .map((c) => ({ c, ...scoreSubmissionCandidate(c.rec, ig, signals, now, { norm, closeEnough, looseEnough }) }))
      .sort((a, b) => b.score - a.score)
    const top = scored[0]
    const margin = top ? top.score - (scored[1] ? scored[1].score : 0) : 0
    const strict = opts.handle_match_only === true
    const threshold = strict ? 80 : 55
    const marginNeed = strict ? 25 : 20
    const afterLinkOk = !requireAfterLink || (Array.isArray(top?.why) && top.why.includes('after_link_45m'))
    if (top && top.score >= threshold && margin >= marginNeed && afterLinkOk) {
      picked = top.c
      console.log(JSON.stringify({ type: 'form_submission_matched', mode: strict ? 'proactive' : 'verbal', score: top.score, margin, why: top.why, candidates: unclaimed.length }))
    } else {
      if (top) console.log(JSON.stringify({ type: 'form_submission_refused', mode: strict ? 'proactive' : 'verbal', reason: 'identity_evidence_below_gate', top_score: top.score, margin, why: top.why, candidates: unclaimed.length }))
      return null
    }
  }
  try {
    picked.rec.claimed_by = String(threadId)
    picked.rec.claimed_at = new Date().toISOString()
    fs.writeFileSync(picked.file, JSON.stringify(picked.rec, null, 2) + '\n')
  } catch {}
  return picked.rec
}

function gmailAutofillFormGateOpened(structuredState, recentHistory = []) {
  const state = structuredState || {}
  if (state.form_link_sent === true || state.form_offer_asked === true) return true
  return (Array.isArray(recentHistory) ? recentHistory : []).some((event) => {
    if (!isConversationVisibleAssistantEvent(event)) return false
    const text = String(event?.text || event?.message || '')
    return text.includes(PREFERRED_FORM_LINK) || formPermissionTextWasAsked(text)
  })
}

function applyGmailFormAutofill(msg, structuredState, recentHistory = []) {
  try {
    const submittedSignal =
      structuredState.live_turn_form_submitted_signal === true ||
      structuredState.form_submitted === true
    // Ben friction-kill (2026-07-08 live: he submitted the real form and the bot
    // STILL asked for name+phone because autofill waited for him to SAY "i
    // submitted"): the ledger entry IS the submission proof — artifact over
    // verbal. With a handle match we adopt proactively; a bare unclaimed-record
    // count is never accepted as identity evidence, even after a verbal claim.
    if (structuredState.known_name_used_on_form && structuredState.known_phone_used_on_form) return structuredState
    // Test-account isolation: Omar.system is a reset/replay harness, not a normal
    // production lead. It may proactively read Gmail only when the form artifact is
    // newer than the form-link turn in THIS reset. That keeps old same-handle forms
    // quarantined while still surviving ASR misses like "I just submitted" -> "I
    // just saw a mirror."
    const testAccount = isTestAccount(msg?.instagram_username)
    const testAccountProactive = testAccount && structuredState.live_turn_form_submitted_signal !== true
    if (testAccountProactive && !gmailAutofillFormGateOpened(structuredState, recentHistory)) {
      return structuredState
    }
    if (!submittedSignal && !gmailAutofillFormGateOpened(structuredState, recentHistory)) {
      return structuredState
    }

    const sub = claimLatestFormSubmission(msg.thread_id || msg.contact_id, msg.instagram_username, {
      handle_match_only: !submittedSignal,
      // Omar.system reuses the same ManyChat thread id across clean replays. Every
      // Gmail adoption — proactive OR verbal — must therefore belong to the form
      // link in the current replay. A spoken "just submitted" cannot waive this.
      require_after_link: testAccount,
      recent_history: recentHistory
    })
    if (!sub) return structuredState
    structuredState.form_submitted = true
    if (!submittedSignal) {
      structuredState.live_turn_form_submitted_signal = true
      console.log(JSON.stringify({
        type: 'gmail_autofill_proactive_submission',
        ...redactedIdentity({ instagram_username: sub.instagram })
      }))
    }
    if (!structuredState.known_name_used_on_form && sub.name) structuredState.known_name_used_on_form = String(sub.name)
    if (!structuredState.known_phone_used_on_form && sub.phone) structuredState.known_phone_used_on_form = String(sub.phone)
    structuredState.form_submission_source = 'gmail_form_email'
  } catch {}
  return structuredState
}

// Context-aware media routing (Ben directive 2026-07-07): a photo that arrives AFTER
// the deposit-zelle handoff is a payment screenshot, not a tattoo reference. Routing
// it to "thank you for the reference photo" reset the funnel back to design talk on a
// paying lead. Override: flag it as a deposit-sent turn so the deposit-hold lane
// answers (got it, checking, will confirm once it lands).
function applyDepositProofMediaOverride(structuredState, recentHistory) {
  const state = structuredState || {}
  const mediaTurn =
    state.live_turn_is_media_reference === true ||
    state.live_turn_is_media_only_no_content === true
  if (!mediaTurn) return state

  const assistantCorpus = (Array.isArray(recentHistory) ? recentHistory : [])
    .filter((event) => isConversationVisibleAssistantEvent(event))
    .map((event) => String(event?.text || event?.message || ''))
    .join('\n')
  const depositContext =
    state.deposit_requested === true ||
    /contact@omarprotocol\.com|\bmy zelle\b|\bdeposit is 100\b|\bzelle\b.{0,40}\b100\b/i.test(assistantCorpus)
  if (!depositContext) return state

  state.live_turn_deposit_sent = true
  state.live_turn_deposit_proof_media = true
  state.live_turn_is_media_reference = false
  state.live_turn_media_tattoo_reference = false
  state.live_turn_media_category = 'payment'
  state.live_turn_is_media_only_no_content = false
  return state
}

// Voice/vision context BEFORE state assembly (2026-07-08 live hole): the runner
// transcribes for the MODEL, but the deterministic layer here (submitted signal,
// deposit proof, date acceptance, gmail autofill, persistent known_* memory) only
// saw "sent a reference post" — so a voice "I just submitted" was heard once and
// then forgotten ("did you get the form yet" nag two turns later). Resolve the
// media into real text FIRST, synchronously (same spawnSync pattern as the runner).
// Fail-open: on any failure the runner-side path still transcribes as before.
const MEDIA_RESOLVER_PATH = path.join(__dirname, 'scv-media-context-resolver.js')
function unresolvedVoiceMediaContext(source) {
  return {
    ok: true,
    resolved: true,
    text: 'sent a voice note that could not be understood',
    is_voice_note: true,
    is_media_reference: false,
    media_category: '',
    is_tattoo_reference: false,
    deposit_proof: false,
    voice_transcribe_failed: true,
    voice_context_unresolved: true,
    source: String(source || 'voice_media_unavailable')
  }
}

function resolveInboundMediaContext(msg, recentHistory = []) {
  const declaredVoice =
    String(msg?.media_type || '').trim().toLowerCase() === 'voice' ||
    /^sent a voice note\b/i.test(String(msg?.text || ''))
  const coalescedReference = Boolean(
    String(msg?.media_coalesced_from_message_id || '').trim() &&
    String(msg?.media_coalescing_version || '').trim()
  )
  try {
    if (String(process.env.SCV_AUTHORITY_MEDIA_CONTEXT || '1').trim() === '0') return null
    const urls = Array.isArray(msg.media_urls) ? msg.media_urls : []
    if (!urls.length) return declaredVoice ? unresolvedVoiceMediaContext('voice_media_url_missing') : null
    if (
      !coalescedReference &&
      !/^sent a (reference post|photo|voice note)\b/i.test(String(msg.text || ''))
    ) return null
    // The latest selector remains the immutable ingress text, but the media
    // helper needs the attachment transport shape in order to run vision. The
    // source message id, URL policy, same-thread proof, and bounded gap were
    // already locked by the inbox coalescer; no prompt text can create this flag.
    const resolverText = coalescedReference ? 'sent a reference post' : msg.text
    const slimHistory = (Array.isArray(recentHistory) ? recentHistory : []).slice(-8).map((e) => {
      const rawText = String((e && (e.text || e.message)) || '')
      const preserveBoundaryText = (
        e?.role === 'assistant_attempted' &&
        isConversationVisibleAssistantEvent(e)
      )
      return {
        role: e && e.role,
        message_id: String((e && e.message_id) || ''),
        bubble_index: Number.isFinite(Number(e && e.bubble_index)) ? Number(e.bubble_index) : undefined,
        text: preserveBoundaryText ? rawText : rawText.slice(0, 300),
        at: String((e && e.at) || ''),
        delivery_status: String((e && e.delivery_status) || ''),
        accepted_unverified_conversation_boundary:
          e?.accepted_unverified_conversation_boundary &&
          typeof e.accepted_unverified_conversation_boundary === 'object' &&
          !Array.isArray(e.accepted_unverified_conversation_boundary)
            ? { ...e.accepted_unverified_conversation_boundary }
            : undefined
      }
    })
    const run = spawnSync(process.execPath, [MEDIA_RESOLVER_PATH, JSON.stringify({
      text: resolverText,
      attachment_selector_text: coalescedReference ? String(msg.text || '') : '',
      media_type: String(msg.media_type || ''),
      media_urls: urls,
      recent_history: slimHistory
    })], {
      encoding: 'utf8',
      timeout: Number(process.env.SCV_MEDIA_RESOLVER_TIMEOUT_MS || 50000)
    })
    const lines = String(run.stdout || '').trim().split(/\r?\n/)
    const parsed = JSON.parse(lines[lines.length - 1] || '{}')
    if (parsed && parsed.resolved === true && parsed.text) {
      console.log(JSON.stringify({
        type: 'authority_media_context_resolved',
        voice: parsed.is_voice_note === true,
        voice_transcribe_failed: parsed.voice_transcribe_failed === true,
        voice_asr_ok: parsed.voice_transcription_diagnostic?.ok === true,
        voice_asr_reason: String(parsed.voice_transcription_diagnostic?.reason || '').slice(0, 80),
        voice_asr_method: String(parsed.voice_transcription_diagnostic?.method || '').slice(0, 80),
        voice_asr_candidate_count: Number(parsed.voice_transcription_diagnostic?.candidate_count || 0),
        deposit_proof: parsed.deposit_proof === true,
        ...textMetrics(parsed.text, 'resolved_text')
      }))
      return parsed
    }
  } catch (err) {
    console.log(JSON.stringify({ type: 'authority_media_context_skip', ...errorMetrics(err) }))
  }
  return declaredVoice ? unresolvedVoiceMediaContext('voice_media_resolver_unavailable') : null
}

function mediaContextFromAuthorityText(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const isVoiceNote = /^sent a voice note\b/i.test(text)
  const voiceUnresolved = isVoiceNote && mediaContextAuthorityRank(text) === 100
  const isMediaReference = /^sent a (?:reference post|photo|media):\s*\S/i.test(text)
  const mediaCategory = isMediaReference
    ? String(classifyReferenceMediaDescription(text) || 'unknown')
    : ''
  return {
    ok: true,
    resolved: isVoiceNote || isMediaReference,
    text,
    is_voice_note: isVoiceNote,
    is_media_reference: isMediaReference,
    media_category: mediaCategory,
    is_tattoo_reference: mediaCategory === 'tattoo_reference',
    deposit_proof: isMediaReference && /\b(?:deposit|payment|zelle)\b/i.test(text),
    voice_transcribe_failed: voiceUnresolved,
    voice_context_unresolved: voiceUnresolved,
    source: 'persisted_monotonic_media_authority'
  }
}

function resolveMonotonicInboundMediaContext(msg, recentHistory = [], resolver = resolveInboundMediaContext) {
  const persistedEvent = loadPersistedInboundUserEvent(msg)
  const persistedText = String(persistedEvent?.text || msg?.text || '').trim()
  const persistedRank = mediaContextAuthorityRank(persistedText)

  // Once an exact transcript or classified visual description is accepted for an
  // immutable message, repair passes reuse it. Re-running a stochastic resolver is
  // both unnecessary and capable of turning known client speech back into unknown.
  if (persistedRank >= 400 && persistedRank < 1000) {
    console.log(JSON.stringify({
      type: 'authority_media_context_reused',
      ...redactedIdentity(msg),
      authority_rank: persistedRank,
      ...textMetrics(persistedText, 'persisted_text')
    }))
    return mediaContextFromAuthorityText(persistedText)
  }

  const next = typeof resolver === 'function'
    ? resolver(msg, recentHistory)
    : null
  const nextText = String(next?.text || '').trim()
  const selection = selectAuthoritativeMediaText(persistedText, nextText)

  if (selection.adopted) return next
  if (nextText && selection.reason !== 'same_media_context') {
    console.log(JSON.stringify({
      type: 'authority_media_context_downgrade_blocked',
      ...redactedIdentity(msg),
      reason: selection.reason,
      current_rank: selection.current_rank,
      candidate_rank: selection.candidate_rank
    }))
  }

  // An unresolved persisted voice note remains a real unresolved source object:
  // ask for a resend/clarification instead of falling backward to the transport
  // placeholder and replaying the prior booking question.
  if (persistedRank >= 100 && persistedRank < 1000) {
    return mediaContextFromAuthorityText(persistedText)
  }
  return next || null
}

function applyMediaContextToState(state, mediaContext, msg) {
  if (!mediaContext) return state
  state.live_turn_text = String(msg.text || '')
  if (mediaContext.is_voice_note) {
    state.live_turn_is_voice_note = true
    state.live_turn_is_media_reference = false
    state.live_turn_is_media_only_no_content = false
  }
  if (mediaContext.voice_transcribe_failed === true) state.live_turn_voice_transcribe_failed = true
  if (mediaContext.voice_context_unresolved === true) state.live_turn_voice_context_unresolved = true
  if (mediaContext.is_media_reference) {
    state.live_turn_is_media_reference = true
    const mediaCategory = String(
      mediaContext.media_category ||
      classifyReferenceMediaDescription(mediaContext.text || '')
    ).trim() || 'unknown'
    state.live_turn_media_category = mediaCategory
    state.live_turn_media_tattoo_reference = mediaCategory === 'tattoo_reference'
    state.reference_media_classification_observed = true
    state.latest_reference_media_category = mediaCategory
    const resolvedDesign = String(mediaContext.text || '').trim()
    // Only verified tattoo visual evidence is durable design authority. A
    // website/presentation/app screenshot still receives a human reply, but it
    // cannot unlock the form/calendar funnel.
    if (mediaCategory === 'tattoo_reference') {
      state.known_tattoo_reference_media_received = true
      state.known_reference_media_received = true
    }
    if (mediaCategory === 'tattoo_reference' && resolvedDesign && liveHasConcreteDesignDirection({
      message: resolvedDesign,
      recent_history: [],
      structured_state: {
        live_turn_text: resolvedDesign,
        live_turn_media_category: mediaCategory,
        live_turn_media_tattoo_reference: true
      }
    })) {
      state.live_turn_gave_design_idea = true
      state.known_design_context = resolvedDesign
    }
  }
  // Live 2026-07-27: a BYOK-dashboard screenshot sent as a design reference was
  // vision-labeled payment at the design stage, flipped the thread into the
  // deposit lane, and the contradictory floor set that followed rejected every
  // candidate — the lead got silence. applyDepositProofMediaOverride already
  // requires deposit context; this resolver-driven flip must obey the same law:
  // a payment-looking image may mutate transaction state only after the funnel
  // actually asked for a deposit. Before that, the image stays a reference.
  if (mediaContext.deposit_proof) {
    if (state.deposit_requested === true || String(state.booking_stage_hint || '').trim() === 'deposit_requested') {
      state.live_turn_deposit_sent = true
      state.live_turn_deposit_proof_media = true
      state.live_turn_is_media_reference = false
      state.live_turn_media_tattoo_reference = false
      state.live_turn_media_category = 'payment'
    } else {
      console.log(JSON.stringify({
        type: 'deposit_proof_suppressed_stage_gate',
        site: 'authority_media_context',
        booking_stage_hint: String(state.booking_stage_hint || ''),
        deposit_requested: state.deposit_requested === true
      }))
    }
  }
  // Semantic intent from the resolver's classifier (ASR-noise-proof): union only.
  if (mediaContext.state_flags && typeof mediaContext.state_flags === 'object') {
    for (const [k, v] of Object.entries(mediaContext.state_flags)) {
      if (v === true && /^(live_turn_|form_|deposit_)/.test(k) && state[k] !== true) state[k] = true
    }
  }
  if (mediaContext.intent_adoption_state && typeof mediaContext.intent_adoption_state === 'object') {
    adoptRunnerIntentState(state, mediaContext.intent_adoption_state, String(msg?.text || msg?.message || ''))
  }
  return state
}

function isMachineMediaPlaceholderText(value) {
  const text = String(value || '').trim()
  if (!text) return true
  return /^(?:sent|shared)\s+a\s+(?:reference\s+(?:post|reel|story|media|photo)|photo|picture|image|media|voice\s+note)\b/i.test(text)
}

function generatePacketFromCodexAuthority(msg, opts = {}) {
  const recentHistory = Array.isArray(opts.recent_history_override)
    ? opts.recent_history_override
    : loadRecentThreadHistory(msg, opts.history_limit || 200)
  const mediaContext = resolveMonotonicInboundMediaContext(
    msg,
    recentHistory,
    typeof opts.media_context_resolver === 'function'
      ? opts.media_context_resolver
      : resolveInboundMediaContext
  )
  // v153 (live 2026-09-05 21:56Z, Omar.system): when the image arrives first and the
  // words ("I'm thinking of this one") arrive seconds later, the coalesced live text
  // is replaced by the vision description below and the client's own words used to
  // vanish from state, so no anchoring rule could ever see them. Keep them as the
  // client selector text; the description stays the live text for every other reader.
  const clientSelectorText = mediaContext && !isMachineMediaPlaceholderText(msg.text)
    ? String(msg.text || '').trim()
    : ''
  if (mediaContext) {
    persistEnrichedInboundHistoryText(msg, mediaContext.text)
    // recentHistory deliberately excludes this immutable live inbound by
    // message_id. The resolved source is carried only as the atomic live turn.
    msg = { ...msg, text: mediaContext.text }
  }

  let baseStructuredState =
    opts.structured_state_override && typeof opts.structured_state_override === 'object'
      ? mergeStructuredState(msg, recentHistory, opts.structured_state_override)
      : buildStructuredState(msg, recentHistory)
  // Media/voice context must land BEFORE gmail autofill and deposit override so a
  // classifier-confirmed "submitted" claim unlocks the verbal-mode ledger claim in
  // the same turn (union only — flags are promoted, never demoted).
  baseStructuredState = applyMediaContextToState(baseStructuredState, mediaContext, msg)
  if (clientSelectorText && mediaContext?.is_media_reference) {
    baseStructuredState.live_turn_client_selector_text = clientSelectorText
  }

  const structuredState = applyDepositProofMediaOverride(
    applyGmailFormAutofill(
      msg,
      applyAudienceAndToneOverlay(
        msg,
        annotateStructuredStateForLiveTurn(msg, baseStructuredState, recentHistory)
      ),
      recentHistory
    ),
    recentHistory
  )

  // No-dropped-message coalesce: earlier user turns that never got a delivered reply
  // (the stale-drop discards their separate reply). A separate side field alone gets
  // outranked by the model's price-only/stop conditioning, so we MERGE them into the
  // LIVE INPUT the model must reply to, and route the turn as substantive multi-point.
  const pendingUnanswered = collectPendingUnansweredUserTurns(recentHistory)
  structuredState.pending_unanswered_user_messages = pendingUnanswered
  structuredState.live_turn_has_unanswered_backlog = pendingUnanswered.length > 0

  let modelMessage = String(msg.text || msg.message || '')
  // Payment-proof media: rewrite the live text itself so every text-keyed consumer
  // (media route locks, prompt media rules, DEPOSIT_HOLD_RE) sees the truth — the
  // state flags alone were not enough because the runner also triggers on the raw
  // "sent a photo" text.
  if (structuredState.live_turn_deposit_proof_media === true) {
    modelMessage = 'sent the deposit payment screenshot'
    structuredState.live_turn_text = modelMessage
  }
  // Preserve the authoritative atomic inbound before unanswered-turn coalescing.
  // `message` may intentionally become a synthetic multi-turn block so the model
  // answers every missed point, but all live-turn classifiers/verifiers must judge
  // only what the client sent NOW. Without this split, an earlier sentence such as
  // "I just sent you the form" contaminates a later "Just submitted" turn and can
  // be reclassified as a request to resend the link.
  const coalescedRunnerMessage = buildCoalescedRunnerMessage(modelMessage, pendingUnanswered)
  const liveMessage = coalescedRunnerMessage.live_message
  if (pendingUnanswered.length > 0) {
    modelMessage = coalescedRunnerMessage.message
    // Present the merged turn to the model consistently and force the substantive lane
    // so "answer the price and stop" cannot drop the earlier idea. Per-turn signal flags
    // (phone/date/name/price) were already computed from the latest message and stay intact.
    structuredState.live_turn_text = modelMessage
    structuredState.live_turn_is_substantive = true
    structuredState.live_turn_multiline = true
    structuredState.live_turn_longform_reply_mode = 'engage_major_points'
  }

  const input = {
    contact_id: String(msg.contact_id || ''),
    thread_id: String(msg.thread_id || msg.contact_id || ''),
    instagram_username: String(msg.instagram_username || ''),
    message_id: String(msg.message_id || ''),
    message: modelMessage,
    live_message: liveMessage,
    received_at: String(msg.received_at || ''),
    media_type: String(msg.media_type || ''),
    media_urls: Array.isArray(msg.media_urls) ? msg.media_urls.slice(0, 3) : [],
    media_context_resolved: mediaContext ? true : false,
    intent_flags_resolved: mediaContext && mediaContext.intent_classified === true,
    recent_history: recentHistory,
    structured_state: structuredState,
    structured_output_required: true,
    control_transition_contract: opts.control_transition_contract && typeof opts.control_transition_contract === 'object'
      ? opts.control_transition_contract
      : null,
    control_transition_repair: String(opts.control_transition_repair || ''),
    control_repair_cycle: Math.max(0, Number(opts.control_repair_cycle) || 0),
    control_reauthor_pass: Math.max(1, Number(opts.control_reauthor_pass) || 1),
    control_verifier_rejection_ledger: Array.isArray(opts.control_verifier_rejection_ledger)
      ? opts.control_verifier_rejection_ledger.slice(-12)
      : []
  }

  const result = spawnSync(process.execPath, [RUNNER_PATH, JSON.stringify(input)], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: RUNNER_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    env: {
      ...process.env
    }
  })

  if (result.error) {
    throw new Error(
      `codex_runner_spawn_error :: ${(result.error && result.error.message) || 'unknown_spawn_error'}`
    )
  }

  if (result.status !== 0) {
    throw new Error(
      `codex_runner_failed_${result.status || 'unknown'} :: ${summarizeRunnerFailure(result.stderr)}`
    )
  }

  const stdout = String(result.stdout || '').trim()
  const runnerDiag = String(result.stderr || '').split('\n').filter((l) => /vision_media|voice_media|media_mime/.test(l)).slice(0, 4)
  if (runnerDiag.length) console.log(JSON.stringify({
    type: 'runner_media_diag',
    line_count: runnerDiag.length,
    lines_hmac_sha256: sha256(runnerDiag.join('\n'))
  }))
  if (!stdout) {
    throw new Error('codex_runner_empty_stdout')
  }

  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (err) {
    throw new Error(`codex_runner_invalid_json :: ${String(err?.message || err)} :: ${stdout.slice(0, 500)}`)
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.packet?.bubbles)) {
    throw new Error(`codex_runner_invalid_packet :: ${stdout}`)
  }

  parsed.packet = normalizePacket(parsed.packet)
  const adoptedStructuredState = adoptRunnerIntentState(
    structuredState,
    parsed.intent_adoption_state,
    String(msg.text || msg.message || '')
  )
  if (
    adoptedStructuredState.live_turn_form_link_resend_requested &&
    packetContainsPreferredFormLink(parsed.packet)
  ) {
    parsed.packet.allow_duplicate_url_resend = true
    parsed.packet.force_send_urls = [PREFERRED_FORM_LINK]
    parsed.packet.authority_transport_flags = {
      ...(parsed.packet.authority_transport_flags && typeof parsed.packet.authority_transport_flags === 'object'
        ? parsed.packet.authority_transport_flags
        : {}),
      allow_duplicate_url_resend: true,
      reason: 'explicit_live_form_link_request'
    }
  }
  if (
    adoptedStructuredState.live_turn_context_missing_attachment === true ||
    adoptedStructuredState.live_turn_reference_pointer_without_media === true
  ) {
    parsed.packet.authority_transport_flags = {
      ...(parsed.packet.authority_transport_flags && typeof parsed.packet.authority_transport_flags === 'object'
        ? parsed.packet.authority_transport_flags
        : {}),
      ...buildReferenceAttachmentGraceFlags()
    }
  }
  parsed.structured_state = adoptedStructuredState
  parsed.recent_history = recentHistory
  // This is input evidence produced by the authority-side media resolver, not a
  // model claim. The single controller uses it only when media_context_resolved is
  // true so verification evaluates the actual transcript/vision description rather
  // than the transport fallback label.
  parsed.media_context_resolved = mediaContext ? true : false
  parsed.authority_observed_live_turn_text = mediaContext ? String(msg.text || '') : ''

  // FINAL MODEL-AUTHORED ADOPTION ASSERTIONS. Every return path passes here, so a
  // missing required pricing fact or missing info explanation fails closed. This
  // layer verifies visible prose; it never creates or appends that prose.
  const finalAuthorityContext = {
    ...msg,
    recent_history: recentHistory,
    structured_state: adoptedStructuredState
  }
  if (parsed.authority?.deterministic_recovery_kind !== 'safe_clarification') {
    parsed.packet = applyFinalPricingFloor(finalAuthorityContext, parsed.packet)
    parsed.packet = applyExplainOnInterestFloor(finalAuthorityContext, parsed.packet)
  }

  return parsed
}

module.exports = {
  classifyCheckpointRevisionIntent,
  extractCheckpointNameRevision,
  extractCheckpointPhoneRevision,
  applyFinalPricingFloor,
  applyExplainOnInterestFloor,
  genericHowWorksHasTattooContext,
  threadHistoryPath,
  loadRecentThreadHistory,
  loadPersistedInboundUserEvent,
  collectPendingUnansweredUserTurns,
  buildCoalescedRunnerMessage,
  persistEnrichedInboundHistoryText,
  claimLatestFormSubmission,
  collectThreadIdentitySignals,
  applyGmailFormAutofill,
  applyDurableStructuredState,
  applyDepositProofMediaOverride,
  voiceTranscriptClaimsSubmission,
  normalizeBookingCalendarDates,
  resolveInboundMediaContext,
  mediaContextFromAuthorityText,
  resolveMonotonicInboundMediaContext,
  applyMediaContextToState,
  adoptRunnerIntentState,
  textOpensTattooLane,
  textGivesTattooContinuationDirection,
  buildStructuredState,
  annotateStructuredStateForLiveTurn,
  normalizePacket,
  summarizeRunnerFailure,
  generatePacketFromCodexAuthority,
  isSlotAcceptanceText,
  liveTurnHasUnresolvedReferencePointer,
  latestAssistantPacketText,
  assistantPacketOpensDateAvailability,
  extractContextualBookingDayReply,
  extractContextualBookingMonthReply,
  classifyExplicitBookingDateForState
}
