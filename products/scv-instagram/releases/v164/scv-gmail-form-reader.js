#!/usr/bin/env node
// ============================================================
// SCV GMAIL FORM READER — kill the name/phone friction (Ben directive 2026-07-06).
//
// The apply form (Squarespace) emails each submission to Ben's Gmail. Asking the
// lead "what name and phone did you use?" is friction that costs conversions.
// This poller reads those notification emails over IMAP (app password), parses
// name / phone / email / instagram, and writes each submission to the
// form-submissions/ ledger (on the volume). dm-authority then auto-fills
// known_name_used_on_form / known_phone_used_on_form the moment the lead says
// the form is in -> the deterministic double-check fires with real values and
// nobody gets asked. The double-check itself is the correction net if a
// concurrent submission ever mismatches.
//
// Dark until creds exist: GMAIL_IMAP_USER + GMAIL_IMAP_APP_PASSWORD env.
// Kill switch: SCV_GMAIL_FORM_READER=0.
// ============================================================
const fs = require('fs')
const path = require('path')
const {
  isPurgedTestAccountGmailUid
} = require(path.join(__dirname, 'scv-test-account-purge.js'))
const {
  redactedIdentity,
  hmacSha256,
  errorMetrics
} = require(path.join(__dirname, 'scv-machine-log.js'))

const ROOT = process.env.SCV_ROOT || __dirname
const SUBMISSIONS_DIR = path.join(ROOT, 'form-submissions')
const GMAIL_USER = String(process.env.GMAIL_IMAP_USER || '').trim()
const GMAIL_APP_PASSWORD = String(process.env.GMAIL_IMAP_APP_PASSWORD || '').replace(/\s+/g, '')
const READER_ENABLED = String(process.env.SCV_GMAIL_FORM_READER || '1').trim() !== '0'
// Ten seconds keeps the email artifact ahead of the next booking turn in normal
// conversation. The previous 60-second default allowed a lead to submit, choose a
// date, and reach identity double-check before Gmail had recorded the form.
const POLL_INTERVAL_MS = Number(process.env.SCV_GMAIL_POLL_INTERVAL_MS || 10 * 1000)
const LOOKBACK_DAYS = Number(process.env.SCV_GMAIL_LOOKBACK_DAYS || 3)

// Squarespace form notifications: "Form Submission - Apply" style subjects, fields as
// "Label: value" lines. Parser is defensive about layout variants (plain text or html-ish).
function decodeQuotedPrintable(rawText) {
  const source = String(rawText || '').replace(/=\r?\n/g, '')
  const chunks = []
  let literal = ''
  const flush = () => {
    if (!literal) return
    chunks.push(Buffer.from(literal, 'utf8'))
    literal = ''
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '=' && /^[0-9a-f]{2}$/i.test(source.slice(i + 1, i + 3))) {
      flush()
      chunks.push(Buffer.from([parseInt(source.slice(i + 1, i + 3), 16)]))
      i += 2
    } else {
      literal += source[i]
    }
  }
  flush()
  return Buffer.concat(chunks).toString('utf8')
}

function parseFormEmail(rawText) {
  // Squarespace's MIME body is quoted-printable. Without decoding it first,
  // `omar.system` was recorded as `omar=2Esystem`, defeating exact-handle matching.
  const text = decodeQuotedPrintable(rawText)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|tr|td|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')

  const field = (labels) => {
    for (const label of labels) {
      const re = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\-]?\\s*(?:\\n\\s*)?([^\\n]{1,120})`, 'i')
      const m = text.match(re)
      if (m && m[1]) {
        const value = m[1].trim().replace(/\s{2,}/g, ' ')
        if (value && !/^(n\/?a|none|-)$/i.test(value)) return value
      }
    }
    return ''
  }

  let name = field(['name', 'full name', 'first and last name', 'your name'])
  const first = field(['first name'])
  const last = field(['last name'])
  if (!name && (first || last)) name = `${first} ${last}`.trim()
  // A name value that captured a following label line is junk.
  if (/\b(phone|email|instagram)\b\s*[:\-]/i.test(name)) name = name.split(/\b(?:phone|email|instagram)\b/i)[0].trim()

  let phone = field(['phone number', 'phone', 'contact number', 'cell'])
  if (phone) {
    const digits = phone.replace(/\D/g, '')
    phone = digits.length >= 7 && digits.length <= 15 ? digits : ''
  }
  if (!phone) {
    const m = text.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/)
    if (m) phone = m[0].replace(/\D/g, '')
  }

  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0]
  const instagram = field(['instagram', 'instagram handle', 'ig', 'ig handle', '@']).replace(/^@/, '')

  // The idea text is a matching signal at ad volume: leads describe the same
  // piece on the form that they discussed in the DM thread.
  const message = field(['message', 'your message', 'idea', 'tattoo idea', 'describe your idea', 'tell me your idea', 'comments', 'anything else'])

  if (!name && !phone) return null
  return { name, phone, email, instagram, message }
}

// Resolve the runtime root at call time rather than freezing SCV_ROOT when this
// module is first required. The drift monitor executes the hard harness more
// than once in the same process. Its isolated purge harness swaps SCV_ROOT to a
// fresh temporary root on every pass; a require-time root made pass two inspect
// the deleted pass-one directory and falsely report that a purged Gmail UID had
// been rehydrated. Production still resolves to the same persistent /data-backed
// SCV root, while tests can provide an explicit isolated root.
function submissionsDir(rootOverride = '') {
  return path.join(String(rootOverride || process.env.SCV_ROOT || ROOT), 'form-submissions')
}

function submissionPath(uid, rootOverride = '') {
  return path.join(submissionsDir(rootOverride), `${String(uid).replace(/[^a-zA-Z0-9._-]/g, '_')}.json`)
}

function writeSubmission(uid, parsed, meta = {}, options = {}) {
  const root = String(options?.root || process.env.SCV_ROOT || ROOT)
  const dir = submissionsDir(root)
  fs.mkdirSync(dir, { recursive: true })
  const file = submissionPath(uid, root)
  if (isPurgedTestAccountGmailUid(root, uid)) return { ok: true, skipped: true, reason: 'purged_test_account_debug_reset', file }
  if (fs.existsSync(file)) return { ok: true, skipped: true, reason: 'already_recorded', file }
  const record = {
    uid: String(uid),
    ...parsed,
    subject: String(meta.subject || ''),
    email_date: String(meta.date || ''),
    recorded_at: new Date().toISOString(),
    claimed_by: ''
  }
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n')
  console.log(JSON.stringify({
    type: 'gmail_form_submission_recorded',
    gmail_uid_hmac_sha256: hmacSha256(uid),
    ...redactedIdentity({ instagram_username: record.instagram }),
    name_chars: String(record.name || '').length,
    phone_chars: String(record.phone || '').length
  }))
  return { ok: true, skipped: false, file }
}

function looksLikeFormNotification(envelope) {
  const from = ((envelope?.from || [])[0]?.address || '').toLowerCase()
  const subject = String(envelope?.subject || '').toLowerCase()
  return /squarespace/.test(from) ||
    /form submission|new submission|new form|apply/.test(subject)
}

async function pollOnce() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return { ok: false, reason: 'missing_gmail_credentials' }
  }
  // Lazy require so harnesses / syntax checks run without the dependency installed.
  const { ImapFlow } = require('imapflow')
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    logger: false
  })
  const summary = { scanned: 0, recorded: 0, skipped: 0 }
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000)
      for await (const msg of client.fetch({ since }, { envelope: true, uid: true, source: true })) {
        summary.scanned++
        if (!looksLikeFormNotification(msg.envelope)) continue
        if (fs.existsSync(submissionPath(msg.uid))) { summary.skipped++; continue }
        const parsed = parseFormEmail(String(msg.source || ''))
        if (!parsed) { summary.skipped++; continue }
        const r = writeSubmission(msg.uid, parsed, { subject: msg.envelope?.subject, date: msg.envelope?.date })
        if (r.skipped) summary.skipped++
        else summary.recorded++
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }
  console.log(JSON.stringify({ type: 'gmail_form_poll_tick', ...summary }))
  return { ok: true, ...summary }
}

async function main() {
  if (!READER_ENABLED) {
    console.log(JSON.stringify({ type: 'gmail_form_reader_disabled' }))
    if (process.argv.includes('--loop')) setInterval(() => {}, 1 << 30)
    return
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.log(JSON.stringify({ type: 'gmail_form_reader_waiting_for_credentials', need: ['GMAIL_IMAP_USER', 'GMAIL_IMAP_APP_PASSWORD'] }))
    if (process.argv.includes('--loop')) setInterval(() => {}, 1 << 30)
    return
  }
  let pollInFlight = false
  const run = async () => {
    if (pollInFlight) {
      console.log(JSON.stringify({ type: 'gmail_form_poll_skipped', reason: 'previous_poll_in_flight' }))
      return
    }
    pollInFlight = true
    try {
      await pollOnce()
    } catch (err) {
      console.error(JSON.stringify({ type: 'gmail_form_poll_error', ...errorMetrics(err) }))
    } finally {
      pollInFlight = false
    }
  }
  await run()
  if (process.argv.includes('--loop')) setInterval(run, POLL_INTERVAL_MS)
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, ...errorMetrics(err) }))
    process.exit(1)
  })
}

module.exports = { decodeQuotedPrintable, parseFormEmail, writeSubmission, submissionsDir, submissionPath, looksLikeFormNotification, pollOnce, SUBMISSIONS_DIR }
