#!/usr/bin/env node
// ============================================================
// SCV CANONICAL BOOKING POLICY
//
// This module is the single authority for calendar-date interpretation and
// booking-window policy. It never authors visible DM prose and it never invents
// calendar availability. The model receives only the already-classified result.
// ============================================================
const crypto = require('crypto')
const {
  resolveClockDate
} = require('./scv-clock.js')

const SCV_BOOKING_POLICY_VERSION =
  'scv-booking-policy-2026-09-03-v5-ordinal-word-days'
const BOOKING_TIME_ZONE = 'America/Los_Angeles'
const MINIMUM_LEAD_DAYS = 7
const MAXIMUM_HORIZON_DAYS = null
const MINIMUM_BOOKING_TIME_MINUTES = 13 * 60
const MINIMUM_BOOKING_TIME_LABEL = '1pm'

const MONTHS = Object.freeze([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
])
const MONTH_ALIASES = Object.freeze({
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
})
const MONTH_TOKEN =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const WEEKDAYS = Object.freeze([
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
])

const BOOKING_POLICY_INVARIANTS = Object.freeze({
  ordinal_word_days_policy: 'first through thirty-first (hyphenated or spaced) read as calendar days before every calendar scan (2026-09-03 v5)',
  authority: 'deterministic_calendar_policy',
  timezone: BOOKING_TIME_ZONE,
  minimum_lead_days: MINIMUM_LEAD_DAYS,
  maximum_horizon_days: MAXIMUM_HORIZON_DAYS,
  minimum_booking_time_minutes: MINIMUM_BOOKING_TIME_MINUTES,
  minimum_booking_time_label: MINIMUM_BOOKING_TIME_LABEL,
  maximum_booking_time_minutes: null,
  ambiguous_month_policy: 'clarify_without_guessing',
  legal_future_date_policy: 'accept_exact_client_date',
  availability_policy: 'legal_date_available_unless_exact_external_calendar_evidence_says_otherwise',
  missing_calendar_evidence_policy: 'never_invent_unavailability',
  query_range_policy: 'absence_from_a_bounded_result_set_is_not_unavailability',
  open_revision_policy: 'date_and_time_proposals_are_classified_by_grammar_not_exact_phrase',
  revision_filler_policy: 'modal_revision_frames_accept_discourse_fillers_such_as_actually_honestly_just',
  checkpoint_bare_hour_policy: 'suffixless_hour_is_a_clock_candidate_only_inside_an_open_time_slot_or_checkpoint_using_the_tattoo_day_clock',
  model_role: 'surface_wording_only'
})
const BOOKING_POLICY_FINGERPRINT = crypto
  .createHash('sha256')
  .update(JSON.stringify(BOOKING_POLICY_INVARIANTS))
  .digest('hex')

function stripVoiceTransport(value) {
  return String(value || '')
    .replace(/^sent\s+a\s+voice\s+note\s+saying\s*:?\s*/i, '')
    .replace(/^voice\s+note\s*:?\s*/i, '')
    .trim()
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function partsToIso(parts) {
  if (!parts || !isValidCalendarDate(parts.year, parts.month, parts.day)) return ''
  return `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}`
}

function isoToParts(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  return isValidCalendarDate(parts.year, parts.month, parts.day) ? parts : null
}

function isValidCalendarDate(year, month, day) {
  if (
    !Number.isInteger(year) || year < 1900 || year > 9999 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(day) || day < 1 || day > 31
  ) return false
  const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  )
}

function addCalendarDays(parts, days) {
  if (!parts || !isValidCalendarDate(parts.year, parts.month, parts.day)) return null
  const value = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + Number(days || 0), 12, 0, 0))
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate()
  }
}

function compareCalendarDates(left, right) {
  const a = partsToIso(left)
  const b = partsToIso(right)
  if (!a || !b) return NaN
  return a < b ? -1 : a > b ? 1 : 0
}

function weekdayForParts(parts) {
  if (!parts || !isValidCalendarDate(parts.year, parts.month, parts.day)) return ''
  return WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0)).getUTCDay()]
}

function datePartsInTimeZone(value, timeZone = BOOKING_TIME_ZONE) {
  let date = null
  try {
    date = resolveClockDate({ referenceTime: value })
  } catch {
    return null
  }
  const fields = {}
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)) {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      fields[part.type] = Number(part.value)
    }
  }
  return isValidCalendarDate(fields.year, fields.month, fields.day)
    ? { year: fields.year, month: fields.month, day: fields.day }
    : null
}

function parseLongDateLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const iso = isoToParts(raw)
  if (iso) return iso

  const monthFirst = raw.match(
    new RegExp(`^\\s*${MONTH_TOKEN}\\s+([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\s*$`, 'i')
  )
  if (monthFirst) {
    const month = MONTH_ALIASES[String(monthFirst[1]).toLowerCase()]
    const day = Number(monthFirst[2])
    const year = Number(monthFirst[3])
    if (Number.isInteger(year) && isValidCalendarDate(year, month, day)) return { year, month, day }
  }

  const dayFirst = raw.match(
    new RegExp(`^\\s*([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_TOKEN}(?:,?\\s+(\\d{4}))?\\s*$`, 'i')
  )
  if (dayFirst) {
    const month = MONTH_ALIASES[String(dayFirst[2]).toLowerCase()]
    const day = Number(dayFirst[1])
    const year = Number(dayFirst[3])
    if (Number.isInteger(year) && isValidCalendarDate(year, month, day)) return { year, month, day }
  }
  return null
}

function referenceDateParts(options = {}) {
  const stateLabel = parseLongDateLabel(options.currentDateLocal)
  if (stateLabel) return stateLabel
  let reference = null
  try {
    reference = resolveClockDate({
      clock: options.clock,
      referenceTime: options.referenceTime,
      receivedAt: options.receivedAt
    })
  } catch {
    return null
  }
  return datePartsInTimeZone(reference, options.timeZone || BOOKING_TIME_ZONE)
}

function nextOccurrence(month, day, current, explicitYear = null) {
  if (!current || !isValidCalendarDate(current.year, current.month, current.day)) return null
  if (explicitYear) {
    return isValidCalendarDate(explicitYear, month, day)
      ? { year: explicitYear, month, day }
      : null
  }
  let year = current.year
  let candidate = isValidCalendarDate(year, month, day) ? { year, month, day } : null
  if (!candidate) return null
  if (compareCalendarDates(candidate, current) < 0) {
    year += 1
    candidate = isValidCalendarDate(year, month, day) ? { year, month, day } : null
  }
  return candidate
}

function nextWeekday(current, weekday, forceFollowingWeek = false) {
  const target = WEEKDAYS.indexOf(String(weekday || '').toLowerCase())
  if (target < 0 || !current) return null
  const currentDay = WEEKDAYS.indexOf(weekdayForParts(current))
  let offset = (target - currentDay + 7) % 7
  if (offset === 0) offset = 7
  // "next weekend" means the weekend after the immediately upcoming one when
  // said before Saturday. A named "next Friday" remains the next occurrence;
  // the seven-day policy then decides whether it is too soon.
  if (forceFollowingWeek && target === 6 && offset < 7) offset += 7
  return addCalendarDays(current, offset)
}


// Live red-team 2026-09-03 (owner, v145): "Can we do fifth of September?" carried
// no calendar candidate because the day was an ordinal WORD, so the turn left
// the booking lane and burned 70 s in the model lane. Ordinal words are days.
const ORDINAL_WORDS = Object.freeze({
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, 'twenty-first': 21, 'twenty first': 21, 'twenty-second': 22, 'twenty second': 22,
  'twenty-third': 23, 'twenty third': 23, 'twenty-fourth': 24, 'twenty fourth': 24, 'twenty-fifth': 25, 'twenty fifth': 25,
  'twenty-sixth': 26, 'twenty sixth': 26, 'twenty-seventh': 27, 'twenty seventh': 27, 'twenty-eighth': 28, 'twenty eighth': 28,
  'twenty-ninth': 29, 'twenty ninth': 29, thirtieth: 30, 'thirty-first': 31, 'thirty first': 31
})
const ORDINAL_WORD_PATTERN = new RegExp(`\\b(${Object.keys(ORDINAL_WORDS).sort((a, b) => b.length - a.length).join('|')})\\b`, 'gi')
function expandOrdinalWordDays(text) {
  return String(text || '').replace(ORDINAL_WORD_PATTERN, (match) => {
    const day = ORDINAL_WORDS[match.toLowerCase()]
    if (!day) return match
    const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'
    return `${day}${suffix}`
  })
}

function extractCalendarCandidate(text, options = {}) {
  const raw = expandOrdinalWordDays(stripVoiceTransport(text))
  const current = referenceDateParts(options)
  if (!raw || !current) return { kind: 'missing', phrase: '', date: null }

  const isoMatch = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (isoMatch) {
    const date = isoToParts(isoMatch[0])
    return date
      ? { kind: 'explicit', phrase: isoMatch[0], date }
      : { kind: 'invalid', phrase: isoMatch[0], date: null }
  }

  // A correction can contain more than one date ("not August 1, I mean
  // August 15"). The latest explicit date owns the live turn. Selecting the
  // first match would preserve the stale/rejected date and recreate the exact
  // booking drift this module exists to prevent.
  const namedCandidates = []
  const monthFirstPattern = new RegExp(
    `\\b${MONTH_TOKEN}\\s+(?:the\\s+)?([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    'gi'
  )
  for (const match of raw.matchAll(monthFirstPattern)) {
    namedCandidates.push({
      index: match.index || 0,
      phrase: match[0],
      month: MONTH_ALIASES[String(match[1]).toLowerCase()],
      day: Number(match[2]),
      year: match[3] ? Number(match[3]) : null
    })
  }
  const dayFirstPattern = new RegExp(
    `\\b([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_TOKEN}(?:,?\\s+(\\d{4}))?\\b`,
    'gi'
  )
  for (const match of raw.matchAll(dayFirstPattern)) {
    namedCandidates.push({
      index: match.index || 0,
      phrase: match[0],
      month: MONTH_ALIASES[String(match[2]).toLowerCase()],
      day: Number(match[1]),
      year: match[3] ? Number(match[3]) : null
    })
  }
  if (namedCandidates.length > 0) {
    namedCandidates.sort((left, right) => left.index - right.index)
    const selected = namedCandidates[namedCandidates.length - 1]
    const date = nextOccurrence(selected.month, selected.day, current, selected.year)
    return date
      ? { kind: 'explicit', phrase: selected.phrase, date }
      : { kind: 'invalid', phrase: selected.phrase, date: null }
  }

  const numeric = raw.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?\b/)
  if (numeric) {
    const first = Number(numeric[1])
    const second = Number(numeric[2])
    const explicitYear = numeric[3]
      ? (Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]))
      : null
    if (first <= 12 && second <= 12 && options.numericOrder !== 'mdy' && options.numericOrder !== 'dmy') {
      return { kind: 'ambiguous_numeric', phrase: numeric[0], date: null }
    }
    const resolvedOrder =
      options.numericOrder === 'dmy' || options.numericOrder === 'mdy'
        ? options.numericOrder
        : first > 12 && second <= 12
          ? 'dmy'
          : 'mdy'
    const month = resolvedOrder === 'dmy' ? second : first
    const day = resolvedOrder === 'dmy' ? first : second
    const date = nextOccurrence(month, day, current, explicitYear)
    return date
      ? { kind: 'explicit', phrase: numeric[0], date }
      : { kind: 'invalid', phrase: numeric[0], date: null }
  }

  const lower = raw.toLowerCase().trim().replace(/[.!?]+$/g, '')
  if (/\btomorrow\b/i.test(lower)) {
    return { kind: 'relative', phrase: raw.match(/\btomorrow\b/i)[0], date: addCalendarDays(current, 1) }
  }
  if (/\btoday\b/i.test(lower)) {
    return { kind: 'relative', phrase: raw.match(/\btoday\b/i)[0], date: { ...current } }
  }
  const weekdayMatch = lower.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (weekdayMatch) {
    const date = nextWeekday(current, weekdayMatch[2], Boolean(weekdayMatch[1]))
    return { kind: 'relative', phrase: weekdayMatch[0], date }
  }
  const weekendMatch = lower.match(/\b(this|next)\s+weekend\b/i)
  if (weekendMatch) {
    const date = nextWeekday(current, 'saturday', weekendMatch[1].toLowerCase() === 'next')
    return { kind: 'relative', phrase: weekendMatch[0], date }
  }

  const ordinal = raw.match(/\b(?:the\s+)?([1-9]|[12]\d|3[01])(?:st|nd|rd|th)\b/i)
  if (ordinal && options.allowAmbiguousDay === true) {
    const day = Number(ordinal[1])
    const month = Number(options.contextMonth || 0)
    if (!month) {
      return { kind: 'ambiguous_month', phrase: ordinal[0], date: null, day }
    }
    const date = nextOccurrence(month, day, current, options.contextYear || null)
    return date
      ? { kind: 'contextual', phrase: ordinal[0], date }
      : { kind: 'invalid', phrase: ordinal[0], date: null }
  }

  return { kind: 'missing', phrase: '', date: null }
}

// Calendar/time token extraction answers only "what temporal token is present".
// The helpers below separately prove that the CLIENT is positively proposing
// that exact token for this appointment. This boundary is intentionally
// conservative: incidental facts, third-party events, negations, exclusions,
// and range boundaries cannot become booking state merely because they contain
// a parseable date or clock time.
function normalizedSpeechActText(text) {
  return stripVoiceTransport(text)
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc\uff07]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function collectCalendarSpeechActCandidates(raw) {
  const patterns = [
    { pattern: new RegExp(`\\b${MONTH_TOKEN}\\s+(?:the\\s+)?(?:[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, 'gi'), priority: 3 },
    { pattern: new RegExp(`\\b(?:[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_TOKEN}(?:,?\\s+\\d{4})?\\b`, 'gi'), priority: 3 },
    { pattern: /\b\d{4}-\d{2}-\d{2}\b/g, priority: 3 },
    { pattern: /\b\d{1,2}[/-]\d{1,2}(?:[/-](?:\d{2}|\d{4}))?\b/g, priority: 3 },
    { pattern: /\b(?:today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:this|next)\s+weekend)\b/gi, priority: 2 },
    { pattern: /\b(?:the\s+)?(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)\b/gi, priority: 1 }
  ]
  const candidates = []
  for (const spec of patterns) {
    const { pattern, priority } = spec
    pattern.lastIndex = 0
    for (const match of raw.matchAll(pattern)) {
      const start = Number(match.index || 0)
      const end = start + String(match[0] || '').length
      if (!match[0]) continue
      candidates.push({ start, end, text: match[0], priority })
    }
  }
  return candidates
    .sort((left, right) => left.start - right.start || right.priority - left.priority || right.end - left.end)
    .filter((candidate, index, all) => !all.some((other, otherIndex) => (
      otherIndex !== index &&
      other.start < candidate.end &&
      other.end > candidate.start &&
      (
        other.priority > candidate.priority ||
        (
          other.priority === candidate.priority &&
          (other.end - other.start) > (candidate.end - candidate.start)
        )
      )
    )))
}

function localTemporalSpeechAct(raw, candidate) {
  return {
    before: raw.slice(Math.max(0, candidate.start - 110), candidate.start),
    after: raw.slice(candidate.end, Math.min(raw.length, candidate.end + 110))
  }
}

function temporalCandidatePolarity(raw, candidate) {
  const { before: rawBefore, after } = localTemporalSpeechAct(raw, candidate)
  const before = rawBefore.replace(/\bthe\s*$/i, '')
  const negativeBefore = /(?:\b(?:cannot|can't|cant|couldn't|couldnt|won't|wont|don't|dont|do\s+not|not\s+able\s+to|unable\s+to)\s+(?:do|make|book|schedule|take|come|go|attend|meet)?|\b(?:am|i'm|im|are|we're|were)\s+not\s+(?:free|available)|\banything\s+(?:except|but)|\bexcept|\bother\s+than|\bavoid|\bexclude|\bnot|\bno)\s*$/i.test(before)
  const negativeAfter = /^\s*(?:does(?:\s+not|n't)|won(?:\s+not|'t)|would(?:\s+not|n't)|can(?:\s+not|'t)|no\s+longer)\s+works?\b|^\s*(?:is|would\s+be)\s+not\s+(?:available|free|good|okay|ok|possible)\b|^\s*isn'?t\s+(?:available|free|good|okay|ok|possible)\b|^\s*(?:doesn'?t\s+works?|isn'?t\s+available)\s+anymore\b/i.test(after)
  const boundaryBefore = /\b(?:before|after|until|through|from|starting|ending|earlier\s+than|later\s+than|no\s+earlier\s+than|no\s+later\s+than|on\s+or\s+after|on\s+or\s+before|at\s+least|at\s+most)\s*$/i.test(before)
  const boundaryAfter = /^\s*(?:or\s+(?:later|earlier|after|before)|and\s+(?:later|after|onward)|onward|onwards|or\s+any\s+time\s+after)\b/i.test(after)
  const multiCandidateRange = (
    collectCalendarSpeechActCandidates(raw).length > 1 &&
    /\b(?:between|from)\b/i.test(raw) &&
    /\b(?:and|to|through|until)\b/i.test(raw)
  )
  return {
    rejected: negativeBefore || negativeAfter,
    bounded: boundaryBefore || boundaryAfter || multiCandidateRange
  }
}

function temporalCandidateIsNegatedOrBounded(raw, candidate) {
  const polarity = temporalCandidatePolarity(raw, candidate)
  return polarity.rejected || polarity.bounded
}

function calendarSpeechActCandidateKey(value) {
  const raw = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const monthFirst = raw.match(new RegExp(`^${MONTH_TOKEN}\\s+(?:the\\s+)?([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`, 'i'))
  if (monthFirst) {
    return `named:${monthFirst[3] || ''}:${MONTH_ALIASES[String(monthFirst[1]).toLowerCase()]}:${Number(monthFirst[2])}`
  }
  const dayFirst = raw.match(new RegExp(`^([1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_TOKEN}(?:,?\\s+(\\d{4}))?$`, 'i'))
  if (dayFirst) {
    return `named:${dayFirst[3] || ''}:${MONTH_ALIASES[String(dayFirst[2]).toLowerCase()]}:${Number(dayFirst[1])}`
  }
  const ordinal = raw.match(/^(?:the\s+)?([1-9]|[12]\d|3[01])(?:st|nd|rd|th)$/i)
  if (ordinal) return `day:${Number(ordinal[1])}`
  return raw.replace(/[\s,.]+/g, '')
}

function calendarCandidateHasPositiveProposal(raw, candidate) {
  const { before: rawBefore, after } = localTemporalSpeechAct(raw, candidate)
  const before = rawBefore.replace(/\bthe\s*$/i, '')
  const proposalBefore = (
    /\b(?:how|what)\s+about\s*$/i.test(before) ||
    /\b(?:can|could|would|will|should)\s+(?:i|we|you|u)\s+(?:(?:definitely|really|probably|maybe|still|absolutely|totally|actually|honestly|just|also|perhaps|possibly|then|now|please|pls|plz|kindly|even|like|prob|def|tho|though)\s+){0,3}(?:do|make|book|schedule|reschedule|fit|take|hold|try|get|switch|move|push|bump|shift|set|put|change|plan|go\s+with)(?:\s+(?:it|that|this|me|us|the\s+(?:appointment|booking|date|day|slot)))?(?:\s+(?:for|on|to|until|till))?\s*$/i.test(before) ||
    /\b(?:i|we)\s+(?:can|could|would|should)\s+(?:(?:definitely|really|probably|maybe|still|absolutely|totally|actually|honestly|just|also|perhaps|possibly|then|now|please|pls|plz|kindly|even|like|prob|def|tho|though)\s+){0,3}(?:do|make|book|schedule|reschedule|take|hold|try|switch|move|push|bump|shift|change|go\s+with)(?:\s+(?:it|that|this))?(?:\s+(?:for|on|to))?\s*$/i.test(before) ||
    /\b(?:i|we)(?:'d|\s+would)?\s+(?:want|wanna|prefer|like)(?:\s+to\s+(?:do|book|schedule|take))?\s*$/i.test(before) ||
    /\b(?:i(?:'m|\s+am)|we(?:'re|\s+are))\s+(?:free|available|thinking|leaning|aiming|hoping)(?:\s+(?:of|about|for|on|toward|towards))?\s*$/i.test(before) ||
    /\b(?:let'?s|lets)\s+(?:do|try|book|schedule|make|go\s+with)\s*$/i.test(before) ||
    /\b(?:move|switch|reschedule|change|push|bump|shift|set|put)\s+(?:(?:it|that|this|the\s+(?:appointment|booking|date|day))\s+)?(?:for|to|on)\s*$/i.test(before) ||
    /\b(?:make|move|switch|reschedule|change|push|bump|shift|set|put)\s+(?:(?:it|that|this|the\s+(?:appointment|booking|date|day))\s+)?(?:(?:for|to|on|at)\s+)?$/i.test(before) ||
    /\b(?:appointment\s+)?(?:date|day)\s*(?:(?:is|was)\s+|[:=]\s*)?$/i.test(before) ||
    /\b(?:book|schedule)\s+(?:me|us|my\s+appointment|our\s+appointment)\s+(?:for|on)\s*$/i.test(before) ||
    /\bput\s+(?:me|us)\s+down\s+(?:for|on)\s*$/i.test(before) ||
    /\block\s+(?:(?:me|us|it)\s+)?in(?:\s+(?:for|on))?\s*$/i.test(before) ||
    /\bgo\s+with\s*$/i.test(before) ||
    /\bi(?:'ll|\s+will)\s+take\s*$/i.test(before) ||
    /\b(?:i\s+mean|actually|instead|rather)\s*$/i.test(before)
  )
  const auxiliaryAvailability = (
    /\b(?:would|does|will|is|could|can)\s*$/i.test(before) &&
    /^\s*(?:work|works|be\s+(?:available|free|good|okay|ok|fine|possible|doable)|available|free|good|okay|ok|fine|possible|doable)\b/i.test(after)
  )
  const proposalAfter = (
    /^\s*(?:work|works|would\s+work|could\s+work|should\s+work)(?:\s+for\s+(?:me|us|you))?\b/i.test(after) ||
    /^\s*(?:is|would\s+be|should\s+be)\s+(?:available|free|good|okay|ok|fine|possible|doable|better)\b/i.test(after) ||
    /^\s*(?:please|pls|plz|instead|rather)\b/i.test(after)
  )
  const selfContainedDateTimeProposal = (
    /^(?:\s*|\s*(?:yes|yeah|yep|sure|okay|ok|actually|maybe|probably|i\s+mean)[,\s]*)$/i.test(before) &&
    /^\s*(?:at|around|for)\s+(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)\s+(?:(?:would|should|could)\s+be\s+(?:perfect|good|great|fine|okay|ok|better)|(?:work|works)|is\s+(?:perfect|good|great|fine|okay|ok))\b/i.test(after)
  )
  const deicticBookingAfter = /^.{0,55}\b(?:can|could|would|will)\s+(?:i|we|you|u)\s+(?:book|schedule|do|make|take|hold|try|get)\s+(?:(?:it\s+)?(?:on\s+)?)?(?:that|this)\s+(?:date|day)\b/i.test(after)
  return proposalBefore || auxiliaryAvailability || proposalAfter || selfContainedDateTimeProposal || deicticBookingAfter
}

function calendarBookingProposalFrame(text, options = {}) {
  const raw = normalizedSpeechActText(expandOrdinalWordDays(text))
  const candidates = collectCalendarSpeechActCandidates(raw)
  if (!raw || candidates.length === 0) {
    return {
      proposal: false,
      rejection: false,
      bounded: false,
      candidate_text: '',
      ambiguous: false,
      reason: 'no_calendar_candidate'
    }
  }

  const positiveCandidates = []
  const rejectedCandidates = []
  const boundedCandidates = []
  for (const candidate of candidates) {
    const polarity = temporalCandidatePolarity(raw, candidate)
    if (polarity.rejected) {
      rejectedCandidates.push(candidate)
      continue
    }
    if (polarity.bounded) {
      boundedCandidates.push(candidate)
      continue
    }
    if (calendarCandidateHasPositiveProposal(raw, candidate)) {
      positiveCandidates.push(candidate)
    }
  }

  const positiveKeys = new Set(positiveCandidates.map((candidate) => calendarSpeechActCandidateKey(candidate.text)))
  const rejectedKeys = new Set(rejectedCandidates.map((candidate) => calendarSpeechActCandidateKey(candidate.text)))
  const boundedKeys = new Set(boundedCandidates.map((candidate) => calendarSpeechActCandidateKey(candidate.text)))
  const sameCandidateConflict = [...positiveKeys].some((key) => rejectedKeys.has(key))
  const unnegatedAlternativeList = (
    candidates.length > 1 &&
    rejectedCandidates.length === 0 &&
    /\b(?:or|either)\b/i.test(raw)
  )
  if (sameCandidateConflict || positiveKeys.size > 1 || boundedKeys.size > 1 || unnegatedAlternativeList) {
    return {
      proposal: false,
      rejection: false,
      bounded: false,
      ambiguous: true,
      candidate_text: '',
      reason: sameCandidateConflict
        ? 'conflicting_calendar_candidate_polarity'
        : boundedKeys.size > 1
          ? 'calendar_range_has_no_exact_candidate'
          : 'multiple_positive_calendar_candidates'
    }
  }
  if (positiveCandidates.length > 0) {
    return {
      proposal: true,
      rejection: false,
      bounded: false,
      ambiguous: false,
      candidate_text: positiveCandidates.at(-1).text,
      reason: 'explicit_positive_booking_speech_act'
    }
  }

  if (options.allowBareDate === true && candidates.length === 1) {
    const candidate = candidates[0]
    if (!temporalCandidateIsNegatedOrBounded(raw, candidate)) {
      const before = raw.slice(0, candidate.start).trim()
      const after = raw.slice(candidate.end).trim()
      const bareBefore = /^(?:(?:yes|yeah|yep|sure|okay|ok|actually|maybe|probably|i\s+mean|it(?:'s|\s+is)|the\s+date\s+is|hmm+|hm+|um+|uh+|well|so|oh|erm|honestly|then|and|or|like|preferably|ideally)\s*[,\-:]?\s*)*$/i.test(before)
      const bareAfter = /^(?:[,\-:]?\s*(?:please|pls|plz|thanks|thank\s+you|works?)?\s*[.!?]*)$/i.test(after)
      if (bareBefore && bareAfter) {
        return {
          proposal: true,
          rejection: false,
          bounded: false,
          ambiguous: false,
          candidate_text: candidate.text,
          reason: 'bare_date_answer_to_active_question'
        }
      }
    }
  }

  if (rejectedKeys.size > 1) {
    return {
      proposal: false,
      rejection: false,
      bounded: false,
      ambiguous: true,
      candidate_text: '',
      reason: 'multiple_rejected_calendar_candidates'
    }
  }
  if (rejectedCandidates.length > 0) {
    return {
      proposal: false,
      rejection: true,
      bounded: false,
      ambiguous: false,
      candidate_text: rejectedCandidates.at(-1).text,
      reason: 'explicit_calendar_candidate_rejection'
    }
  }
  if (boundedCandidates.length > 0) {
    return {
      proposal: false,
      rejection: false,
      bounded: true,
      ambiguous: false,
      candidate_text: boundedCandidates.at(-1).text,
      reason: 'calendar_range_boundary_not_exact_proposal'
    }
  }
  return {
    proposal: false,
    rejection: false,
    bounded: false,
    ambiguous: false,
    candidate_text: '',
    reason: 'calendar_candidate_not_positive_booking_proposal'
  }
}

function textFramesCalendarCandidateAsBookingProposal(text, options = {}) {
  return calendarBookingProposalFrame(text, options).proposal === true
}

function collectClockSpeechActCandidates(raw) {
  const pattern = /\b(?:[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:(?:a\.m\.?|p\.m\.?|am|pm)(?![a-z0-9_])|in\s+(?:the\s+)?(?:morning|afternoon|evening|night)\b)/gi
  return [...raw.matchAll(pattern)].map((match) => ({
    start: Number(match.index || 0),
    end: Number(match.index || 0) + String(match[0] || '').length,
    text: (() => {
      const surface = String(match[0] || '')
      const natural = surface.match(/^([1-9]|1[0-2])(?::([0-5]\d))?\s*in\s+(?:the\s+)?(morning|afternoon|evening|night)$/i)
      if (!natural) return surface
      const hour = Number(natural[1])
      const minute = natural[2] ? `:${natural[2]}` : ''
      const part = natural[3].toLowerCase()
      const suffix = part === 'morning' || (part === 'night' && hour === 12) ? 'am' : 'pm'
      return `${hour}${minute}${suffix}`
    })()
  }))
}

function clockCandidatePolarity(raw, candidate) {
  const { before, after } = localTemporalSpeechAct(raw, candidate)
  const rejected = (
    /(?:\b(?:cannot|can't|cant|couldn't|couldnt|won't|wont|don't|dont|do\s+not|not\s+able\s+to|unable\s+to)\s+(?:do|make|come|meet|book|schedule)?|\b(?:am|i'm|im|are|we're|were)\s+not\s+(?:free|available)|\banything\s+(?:except|but)|\bexcept|\bother\s+than|\bavoid|\bexclude|\bnot|\bno)\s*$/i.test(before) ||
    /^\s*(?:does(?:\s+not|n't)|won(?:\s+not|'t)|would(?:\s+not|n't)|can(?:\s+not|'t)|no\s+longer)\s+works?\b|^\s*(?:is|would\s+be)\s+not\s+(?:available|free|good|okay|ok|possible)\b|^\s*isn'?t\s+(?:available|free|good|okay|ok|possible)\b|^\s*(?:doesn'?t\s+works?|isn'?t\s+available)\s+anymore\b/i.test(after)
  )
  const bounded = (
    /\b(?:before|after|until|from|between|starting|ending|earlier\s+than|later\s+than|no\s+earlier\s+than|no\s+later\s+than|at\s+least|at\s+most|any\s+time\s+after|any\s+time\s+before)\s*$/i.test(before) ||
    /^\s*(?:or\s+(?:later|earlier)|onward|onwards)\b/i.test(after) ||
    (collectClockSpeechActCandidates(raw).length > 1 && /\b(?:between|from)\b/i.test(raw) && /\b(?:and|to|through|until)\b/i.test(raw))
  )
  return { rejected, bounded }
}

function clockCandidateIsNegatedOrBounded(raw, candidate) {
  const polarity = clockCandidatePolarity(raw, candidate)
  return polarity.rejected || polarity.bounded
}

function clockCandidateHasPositiveProposal(raw, candidate) {
  const { before, after } = localTemporalSpeechAct(raw, candidate)
  return (
    /\b(?:how|what)\s+about\s*$/i.test(before) ||
    /\b(?:can|could|would|will|should)\s+(?:i|we|you|u)\s+(?:(?:definitely|really|probably|maybe|still|absolutely|totally|actually|honestly|just|also|perhaps|possibly|then|now|please|pls|plz|kindly|even|like|prob|def|tho|though)\s+){0,3}(?:do|make|book|schedule|reschedule|come|meet|take|try|move|switch|change|push|bump|shift|set|put|start|begin|plan)(?:\s+(?:it|that|this|me|us|the\s+(?:appointment|booking|time|slot|session)))?(?:\s+(?:at|for|to|until|till))?\s*$/i.test(before) ||
    /\b(?:i|we)\s+(?:can|could|would|should)\s+(?:(?:definitely|really|probably|maybe|still|absolutely|totally|actually|honestly|just|also|perhaps|possibly|then|now|please|pls|plz|kindly|even|like|prob|def|tho|though)\s+){0,3}(?:do|make|come|meet|book|schedule|reschedule|move|switch|change|push|bump|shift|set|put|start)(?:\s+(?:it|that|this))?(?:\s+(?:at|for|to))?\s*$/i.test(before) ||
    /\b(?:i|we)(?:'d|\s+would)?\s+(?:want|prefer|like)(?:\s+to\s+(?:do|come|meet|book|schedule))?(?:\s+(?:at|for))?\s*$/i.test(before) ||
    /\b(?:let'?s|lets)\s+(?:do|try|book|schedule|meet)(?:\s+(?:it|that))?(?:\s+(?:at|for))?\s*$/i.test(before) ||
    /\b(?:book|schedule)\s+(?:me|us|my\s+appointment|our\s+appointment)\s+(?:for|at)\s*$/i.test(before) ||
    /\bput\s+(?:me|us)\s+down\s+(?:for|at)\s*$/i.test(before) ||
    /\block\s+(?:(?:me|us|it)\s+)?in(?:\s+(?:for|at))?\s*$/i.test(before) ||
    /\bgo\s+with\s*$/i.test(before) ||
    /\bi(?:'ll|\s+will)\s+take\s*$/i.test(before) ||
    /\b(?:actually|instead|rather|i\s+mean)\s*$/i.test(before) ||
    /\b(?:make|move|switch|reschedule|change|push|bump|shift|set|put)\s+(?:(?:it|that|this|the\s+(?:appointment|booking|time|slot))\s+)?(?:(?:for|to|at)\s+)?$/i.test(before) ||
    /\b(?:appointment\s+)?(?:time|slot)\s*(?:(?:is|was)\s+|[:=]\s*)?$/i.test(before) ||
    /^\s*(?:work|works|would\s+work|could\s+work|should\s+work)(?:\s+for\s+(?:me|us|you))?\b/i.test(after) ||
    /^\s*(?:is|would\s+be|should\s+be)\s+(?:available|free|good|okay|ok|fine|possible|doable|better)\b/i.test(after) ||
    (/\b(?:would|does|will|is|could|can)\s*$/i.test(before) &&
      /^\s*(?:work|works|be\s+(?:available|free|good|okay|ok|fine|possible|doable)|available|free|good|okay|ok|fine|possible|doable)\b/i.test(after)) ||
    /^\s*(?:please|pls|plz|instead|rather)\b/i.test(after)
  )
}

function clockCandidateAttachedToPositiveDate(raw, candidate) {
  const calendarFrame = calendarBookingProposalFrame(raw)
  if (calendarFrame.proposal !== true || !calendarFrame.candidate_text) return false
  const dateIndex = raw.toLowerCase().lastIndexOf(String(calendarFrame.candidate_text).toLowerCase())
  const bridge = dateIndex >= 0
    ? raw.slice(dateIndex + String(calendarFrame.candidate_text).length, candidate.start)
    : ''
  return dateIndex >= 0 && dateIndex < candidate.start && /^\s*(?:at|around|for)\s*$/i.test(bridge)
}

function clockCandidateAttachedToRejectedDate(raw, candidate) {
  const calendarFrame = calendarBookingProposalFrame(raw)
  if (calendarFrame.rejection !== true || !calendarFrame.candidate_text) return false
  const dateIndex = raw.toLowerCase().lastIndexOf(String(calendarFrame.candidate_text).toLowerCase())
  const bridge = dateIndex >= 0
    ? raw.slice(dateIndex + String(calendarFrame.candidate_text).length, candidate.start)
    : ''
  return dateIndex >= 0 && dateIndex < candidate.start && /^\s*(?:at|around|for)\s*$/i.test(bridge)
}

// Tattoo-day clock for a suffixless hour: 8 through 11 mean morning, 12 means
// noon, 1 through 7 mean afternoon. This mirrors the control plane's contextual
// bare-hour convention so state authority and route liveness never disagree.
const BARE_HOUR_NUMBER_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
})

function bareHourLabel(hour, minute) {
  const suffix = hour === 12 ? 'pm' : hour >= 8 ? 'am' : 'pm'
  return `${hour}${minute ? `:${minute}` : ''}${suffix}`
}

// A suffixless hour ("3", "3:30", "three") is a clock candidate only when the
// caller has an open time slot or an open four-field checkpoint (allowBareHour).
// Phone numbers, money, sizes, quantities, ordinals, and calendar days are
// excluded so a bare number never becomes an appointment time by accident.
function collectBareHourSpeechActCandidates(raw) {
  const text = String(raw || '')
  if (!text.trim()) return []
  if ((text.match(/\d/g) || []).length >= 7) return []
  if (/[$€£]\s*\d|\d\s*(?:k\b|%|[$€£])/i.test(text)) return []
  const out = []
  const digitPattern = /(?<![\d:$#.\/@+-])\b(1[0-2]|[1-9])(?::([0-5]\d))?\b(?!\s*(?:st|nd|rd|th|am|pm|a\.m|p\.m|[:\/.-]\d|%|k\b|x\b|by\b|"|”|in\b|inch|inches|cm|mm|hours?|hrs?|mins?|minutes?|days?|weeks?|months?|years?|people|ppl|persons?|of\s+(?:us|them|you)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b))/gi
  const wordPattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?!\s*(?:of\s+(?:us|them|you)|people|ppl|persons?|hours?|hrs?|days?|weeks?|months?|years?|tattoos?|pieces?|inch|inches|cm|mm|sec|second|seconds|minute|minutes|more|thing|things))/gi
  const blockedBefore = /(?:\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*|\bthe|\bon|\bsize|\bby|\bx|\bpart|\bstep|\bpage|\bround|\bversion|\bv|\bnumber|\bno|#|\bthis|\bthat|\banother|\bonly|\bjust\s+the)\s*$/i
  for (const pattern of [digitPattern, wordPattern]) {
    for (const match of text.matchAll(pattern)) {
      const start = Number(match.index || 0)
      if (blockedBefore.test(text.slice(0, start))) continue
      const token = String(match[1] || '').toLowerCase()
      const hour = /^\d+$/.test(token) ? Number(token) : BARE_HOUR_NUMBER_WORDS[token]
      if (!hour || hour < 1 || hour > 12) continue
      const minute = String(match[2] || '')
      out.push({ start, end: start + String(match[0] || '').length, text: bareHourLabel(hour, minute), bare_hour: true })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

function clockTimeBookingProposalFrame(text, options = {}) {
  const raw = normalizedSpeechActText(text)
  const explicitCandidates = collectClockSpeechActCandidates(raw)
  if (explicitCandidates.length > 0 || options.allowBareHour !== true) {
    return clockTimeProposalFrameForCandidates(raw, explicitCandidates, options)
  }
  const bareCandidates = collectBareHourSpeechActCandidates(raw)
  if (!bareCandidates.length) return clockTimeProposalFrameForCandidates(raw, [], options)
  return {
    ...clockTimeProposalFrameForCandidates(raw, bareCandidates, options),
    bare_hour: true,
    meridiem_inferred: true
  }
}

function clockTimeProposalFrameForCandidates(raw, candidates, options = {}) {
  if (!raw || candidates.length === 0) {
    return { proposal: false, rejection: false, bounded: false, ambiguous: false, candidate_text: '', reason: 'no_clock_candidate' }
  }

  const positiveCandidates = []
  const rejectedCandidates = []
  const boundedCandidates = []
  for (const candidate of candidates) {
    const polarity = clockCandidatePolarity(raw, candidate)
    if (polarity.rejected || clockCandidateAttachedToRejectedDate(raw, candidate)) {
      rejectedCandidates.push(candidate)
      continue
    }
    if (polarity.bounded) {
      boundedCandidates.push(candidate)
      continue
    }
    if (
      clockCandidateHasPositiveProposal(raw, candidate) ||
      clockCandidateAttachedToPositiveDate(raw, candidate)
    ) {
      positiveCandidates.push(candidate)
    }
  }

  const unnegatedAlternativeList = (
    candidates.length > 1 &&
    rejectedCandidates.length === 0 &&
    /\b(?:or|either)\b/i.test(raw)
  )
  const positiveKeys = new Set(positiveCandidates.map((candidate) => String(candidate.text || '').toLowerCase().replace(/[.\s]+/g, '')))
  const rejectedKeys = new Set(rejectedCandidates.map((candidate) => String(candidate.text || '').toLowerCase().replace(/[.\s]+/g, '')))
  const boundedKeys = new Set(boundedCandidates.map((candidate) => String(candidate.text || '').toLowerCase().replace(/[.\s]+/g, '')))
  const sameCandidateConflict = [...positiveKeys].some((key) => rejectedKeys.has(key))
  if (sameCandidateConflict || positiveCandidates.length > 1 || boundedKeys.size > 1 || unnegatedAlternativeList) {
    return {
      proposal: false,
      rejection: false,
      bounded: false,
      ambiguous: true,
      candidate_text: '',
      alternatives: [...new Set(candidates.map((candidate) => String(candidate.text || '').toLowerCase().replace(/\s+/g, '')))],
      reason: sameCandidateConflict
        ? 'conflicting_clock_candidate_polarity'
        : boundedKeys.size > 1
          ? 'clock_range_has_no_exact_candidate'
          : 'multiple_positive_clock_candidates'
    }
  }
  if (positiveCandidates.length === 1) {
    return {
      proposal: true,
      rejection: false,
      bounded: false,
      ambiguous: false,
      candidate_text: positiveCandidates[0].text,
      reason: 'explicit_positive_clock_speech_act'
    }
  }

  if (options.allowBareTime === true && candidates.length === 1) {
    const candidate = candidates[0]
    if (!clockCandidateIsNegatedOrBounded(raw, candidate)) {
      const before = raw.slice(0, candidate.start).trim()
      const after = raw.slice(candidate.end).trim()
      if (
        /^(?:(?:yes|yeah|yep|sure|okay|ok|actually|maybe|probably|at|around|about|i\s+mean|it(?:'s|\s+is)|hmm+|hm+|um+|uh+|well|so|oh|erm|honestly|then|and|or|like|what\s+about|how\s+about|preferably|ideally)\s*[,\-:]?\s*)*$/i.test(before) &&
        /^(?:[,\-:]?\s*(?:please|pls|plz|thanks|thank\s+you)?\s*[.!?]*)$/i.test(after)
      ) {
        return {
          proposal: true,
          rejection: false,
          bounded: false,
          ambiguous: false,
          candidate_text: candidate.text,
          reason: 'bare_clock_answer_to_active_question'
        }
      }
    }
  }

  if (rejectedCandidates.length === 1) {
    return {
      proposal: false,
      rejection: true,
      bounded: false,
      ambiguous: false,
      candidate_text: rejectedCandidates[0].text,
      reason: 'explicit_clock_candidate_rejection'
    }
  }
  if (boundedCandidates.length > 0) {
    return {
      proposal: false,
      rejection: false,
      bounded: true,
      ambiguous: false,
      candidate_text: boundedCandidates.at(-1).text,
      reason: 'clock_range_boundary_not_exact_proposal'
    }
  }
  return { proposal: false, rejection: false, bounded: false, ambiguous: false, candidate_text: '', reason: 'clock_candidate_not_positive_booking_proposal' }
}

function textFramesClockTimeAsBookingProposal(text, options = {}) {
  return clockTimeBookingProposalFrame(text, options).proposal === true
}

function parseBookingClockTime(value) {
  const match = String(value || '').trim().match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)(?![a-z0-9_])/i
  )
  if (!match) return null
  const hour12 = Number(match[1])
  const minute = Number(match[2] || 0)
  if (!Number.isInteger(hour12) || hour12 < 1 || hour12 > 12 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) return null
  const suffix = String(match[3]).toLowerCase().replace(/\./g, '')
  const hour24 = (hour12 % 12) + (suffix === 'pm' ? 12 : 0)
  return {
    phrase: match[0],
    hour12,
    minute,
    suffix,
    minutes_after_midnight: (hour24 * 60) + minute,
    canonical_label: `${hour12}${minute ? `:${pad2(minute)}` : ''}${suffix}`
  }
}

function classifyBookingClockTimeText(text) {
  const parsed = parseBookingClockTime(text)
  const base = {
    policy_version: SCV_BOOKING_POLICY_VERSION,
    policy_fingerprint: BOOKING_POLICY_FINGERPRINT,
    phrase: parsed?.phrase || '',
    canonical_label: parsed?.canonical_label || '',
    minutes_after_midnight: parsed?.minutes_after_midnight ?? null,
    minimum_booking_time_minutes: MINIMUM_BOOKING_TIME_MINUTES,
    minimum_booking_time_label: MINIMUM_BOOKING_TIME_LABEL,
    maximum_booking_time_minutes: null
  }
  if (!String(text || '').trim()) return { ...base, status: 'missing' }
  if (!parsed) return { ...base, status: 'invalid' }
  if (parsed.minutes_after_midnight < MINIMUM_BOOKING_TIME_MINUTES) {
    return { ...base, status: 'too_early' }
  }
  return { ...base, status: 'legal' }
}

function formatDateLong(parts) {
  if (!parts || !isValidCalendarDate(parts.year, parts.month, parts.day)) return ''
  return `${MONTHS[parts.month - 1][0].toUpperCase()}${MONTHS[parts.month - 1].slice(1)} ${parts.day}, ${parts.year}`
}

function formatDateShort(parts) {
  if (!parts || !isValidCalendarDate(parts.year, parts.month, parts.day)) return ''
  return `${MONTHS[parts.month - 1]} ${parts.day}`
}

function ordinalDay(day) {
  const mod100 = day % 100
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : day % 10 === 1
      ? 'st'
      : day % 10 === 2
        ? 'nd'
        : day % 10 === 3
          ? 'rd'
          : 'th'
  return `${day}${suffix}`
}

function formatDateDayFirst(parts, includeYear = false) {
  if (!parts || !isValidCalendarDate(parts.year, parts.month, parts.day)) return ''
  const base = `${ordinalDay(parts.day)} of ${MONTHS[parts.month - 1][0].toUpperCase()}${MONTHS[parts.month - 1].slice(1)}`
  return includeYear ? `${base} ${parts.year}` : base
}

function classifyBookingDateText(text, options = {}) {
  const current = referenceDateParts(options)
  if (!current) {
    return {
      policy_version: SCV_BOOKING_POLICY_VERSION,
      policy_fingerprint: BOOKING_POLICY_FINGERPRINT,
      status: 'invalid_reference_time',
      phrase: '',
      date: null,
      date_iso: '',
      availability: 'unknown'
    }
  }
  const minimum =
    parseLongDateLabel(options.minimumDateLocal) ||
    addCalendarDays(current, MINIMUM_LEAD_DAYS)
  const candidate = extractCalendarCandidate(text, { ...options, currentDateLocal: formatDateLong(current) })
  const base = {
    policy_version: SCV_BOOKING_POLICY_VERSION,
    policy_fingerprint: BOOKING_POLICY_FINGERPRINT,
    phrase: candidate.phrase || '',
    current_date_iso: partsToIso(current),
    minimum_date_iso: partsToIso(minimum),
    maximum_date_iso: '',
    date: candidate.date,
    date_iso: partsToIso(candidate.date),
    canonical_label: formatDateShort(candidate.date),
    canonical_day_first: formatDateDayFirst(candidate.date),
    availability: 'not_evaluated',
    availability_source: 'none'
  }
  if (candidate.kind === 'missing') return { ...base, status: 'missing' }
  if (candidate.kind === 'ambiguous_month') {
    return { ...base, status: 'ambiguous_month', day: candidate.day, availability: 'unknown' }
  }
  if (candidate.kind === 'ambiguous_numeric') {
    return { ...base, status: 'ambiguous_numeric', availability: 'unknown' }
  }
  if (candidate.kind === 'invalid' || !candidate.date) {
    return { ...base, status: 'invalid', availability: 'unknown' }
  }
  if (compareCalendarDates(candidate.date, minimum) < 0) {
    return {
      ...base,
      status: 'too_soon',
      availability: 'outside_policy_floor',
      availability_source: 'minimum_lead_time_policy'
    }
  }
  return {
    ...base,
    status: 'legal',
    availability: 'available',
    availability_source: 'unbounded_legal_date_policy'
  }
}

function buildCloseBookingOptions(minimum) {
  const parts = typeof minimum === 'string' ? parseLongDateLabel(minimum) : minimum
  if (!parts) return []
  const options = []
  const seen = new Set()
  const push = (date) => {
    const label = `${formatDateShort(date)} (${weekdayForParts(date)}) at 2pm`
    if (!seen.has(label)) {
      seen.add(label)
      options.push(label)
    }
  }
  push(parts)
  push(addCalendarDays(parts, 1))
  push(addCalendarDays(parts, 2))
  let weekendCount = 0
  for (let offset = 0; offset < 14 && weekendCount < 2; offset += 1) {
    const date = addCalendarDays(parts, offset)
    const weekday = weekdayForParts(date)
    if (weekday === 'saturday' || weekday === 'sunday') {
      push(date)
      weekendCount += 1
    }
  }
  return options
}

// A coarse scheduling constraint is not acceptance of any exact slot that may
// have appeared in the preceding assistant packet.  The live failure behind
// this guard was "OK then let's do weekend" after three dated alternatives:
// generic acknowledgement matching promoted it to an accepted booking even
// though the client had only narrowed the calendar to Saturday or Sunday.
// Keep this detector deliberately narrower than relative-date parsing.  "this
// weekend" and "next weekend" remain concrete relative date proposals.
function bookingDayConstraintPreference(value) {
  const raw = stripVoiceTransport(value)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return null
  if (/\b(?:this|next|that)\s+weekend\b/i.test(raw)) return null
  if (/\b(?:not|never|cannot|can'?t|unavailable|except)\b/i.test(raw)) return null

  const weekend = /\bweekends?\b/i.test(raw)
  const weekday = /\bweekdays?\b/i.test(raw)
  if (!weekend && !weekday) return null

  const directChoice = /\b(?:let'?s|lets)\s+(?:do|try|go(?:\s+with)?)\s+(?:the\s+)?(?:weekends?|weekdays?)\b/i.test(raw)
  const statedFit = /\b(?:weekends?|weekdays?)\b.{0,35}\b(?:works?|good|fine|best|easiest|available|free|open|better|preferred?)\b/i.test(raw)
  const availability = /\b(?:available|free|open|only|mostly|usually|prefer|preferred|easiest|best)\b.{0,35}\b(?:on\s+)?(?:weekends?|weekdays?)\b/i.test(raw)
  const bareConstraint = /^(?:(?:ok(?:ay)?|yeah|sure|then|maybe|probably)\s+)*(?:on\s+)?(?:weekends?|weekdays?)(?:\s+for\s+me)?[.!?]*$/i.test(raw)
  if (!(directChoice || statedFit || availability || bareConstraint)) return null

  return {
    kind: weekend ? 'weekend' : 'weekday',
    label: weekend ? 'weekend' : 'weekday',
    days: weekend
      ? ['saturday', 'sunday']
      : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
  }
}

function selectCloseBookingOptionForDayConstraint(options, preference, preferredTime = '2pm') {
  const wanted = new Set(Array.isArray(preference?.days) ? preference.days : [])
  if (!wanted.size) return null
  for (const option of Array.isArray(options) ? options : []) {
    const raw = String(option || '').trim()
    const weekdayMatch = raw.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
    const weekday = String(weekdayMatch?.[1] || '').toLowerCase()
    if (!wanted.has(weekday)) continue
    const dateMatch = raw.match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i)
    if (!dateMatch) continue
    const monthNumber = MONTH_ALIASES[String(dateMatch[1]).toLowerCase()]
    const month = MONTHS[Number(monthNumber) - 1] || String(dateMatch[1]).toLowerCase()
    const timeMatch = raw.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm))\b/i)
    return {
      date: `${month} ${Number(dateMatch[2])}`,
      time: timeMatch
        ? String(timeMatch[1]).toLowerCase().replace(/\./g, '').replace(/\s+/g, '')
        : String(preferredTime || '2pm').trim(),
      weekday,
      source: raw
    }
  }
  return null
}

function buildBookingPolicySnapshot(referenceTimeOrOptions) {
  const options =
    referenceTimeOrOptions &&
    typeof referenceTimeOrOptions === 'object' &&
    !(referenceTimeOrOptions instanceof Date)
      ? referenceTimeOrOptions
      : { referenceTime: referenceTimeOrOptions }
  const current = referenceDateParts(options)
  if (!current) throw new Error('booking_policy_invalid_reference_time')
  const minimum = addCalendarDays(current, MINIMUM_LEAD_DAYS)
  const closeOptions = buildCloseBookingOptions(minimum)
  return {
    booking_policy_version: SCV_BOOKING_POLICY_VERSION,
    booking_policy_fingerprint: BOOKING_POLICY_FINGERPRINT,
    booking_policy_timezone: BOOKING_TIME_ZONE,
    booking_policy_minimum_lead_days: MINIMUM_LEAD_DAYS,
    booking_policy_maximum_horizon_days: null,
    minimum_booking_time_minutes: MINIMUM_BOOKING_TIME_MINUTES,
    minimum_booking_time_local: MINIMUM_BOOKING_TIME_LABEL,
    maximum_booking_time_minutes: null,
    current_message_date_local: formatDateLong(current),
    current_message_date_iso: partsToIso(current),
    minimum_booking_date_local: formatDateLong(minimum),
    minimum_booking_date_iso: partsToIso(minimum),
    maximum_booking_date_local: '',
    maximum_booking_date_iso: '',
    earliest_booking_option_local: closeOptions[0] || '',
    close_booking_options_local: closeOptions,
    date_selection_rule:
      'The date boundary is the seven-day minimum. A fully specified client date on or after that minimum is valid and available with no maximum future horizon. Never invent a closed date from a bounded query, stale offer, prompt preference, or missing calendar evidence.',
    time_selection_rule:
      'Appointment start times are valid at 1pm or later. A client proposal before 1pm must remain uncommitted and must be answered with the 1pm floor plus one grounded later-time question. There is no maximum late-time boundary.'
  }
}

function contradictoryPolicyPhrases(text) {
  const raw = String(text || '')
  const rules = [
    ['maximum_horizon_six_months', /\b(?:do\s+not|don'?t|never)\s+(?:schedule|book).{0,40}\b(?:six|6)\s+months?\b/i],
    ['maximum_horizon_far_edge', /\b(?:six|6)\s+months?\s+out.{0,35}\b(?:edge|maximum|max|limit)\b/i],
    ['far_future_rejection', /\bfar\s+future\s+date\b.{0,80}\b(?:reject|decline|unavailable|too\s+far)\b/i],
    ['closer_date_overrides_legal_request', /\bprefer\s+the\s+earliest\s+workable\s+option\s+not\s+a\s+far\s+future\s+date\b/i]
  ]
  return rules
    .filter(([, pattern]) => pattern.test(raw))
    .map(([code]) => code)
}

module.exports = {
  expandOrdinalWordDays,
  SCV_BOOKING_POLICY_VERSION,
  BOOKING_POLICY_FINGERPRINT,
  BOOKING_POLICY_INVARIANTS,
  BOOKING_TIME_ZONE,
  MINIMUM_LEAD_DAYS,
  MAXIMUM_HORIZON_DAYS,
  MINIMUM_BOOKING_TIME_MINUTES,
  MINIMUM_BOOKING_TIME_LABEL,
  MONTHS,
  MONTH_ALIASES,
  stripVoiceTransport,
  partsToIso,
  isoToParts,
  isValidCalendarDate,
  addCalendarDays,
  compareCalendarDates,
  weekdayForParts,
  datePartsInTimeZone,
  parseLongDateLabel,
  referenceDateParts,
  formatDateLong,
  formatDateShort,
  formatDateDayFirst,
  classifyBookingDateText,
  calendarBookingProposalFrame,
  textFramesCalendarCandidateAsBookingProposal,
  clockTimeBookingProposalFrame,
  collectBareHourSpeechActCandidates,
  textFramesClockTimeAsBookingProposal,
  parseBookingClockTime,
  classifyBookingClockTimeText,
  buildCloseBookingOptions,
  bookingDayConstraintPreference,
  selectCloseBookingOptionForDayConstraint,
  buildBookingPolicySnapshot,
  contradictoryPolicyPhrases
}
