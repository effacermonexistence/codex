#!/usr/bin/env node
'use strict'

// Transport truthfulness harness (owner directive 2026-09-02).
//
// Locks the four visibility states, the provider-acceptance vs visibility
// separation, the reconciliation ledger, the operational (never critical)
// backlog alert, the operator resolution path, evidence preservation, and the
// rule that a newer inbound never turns an accepted-unverified reply into a
// confirmed-visible one.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-delivery-visibility-truth-'))
process.env.SCV_ROOT = root
const previousEnv = {}
for (const [key, value] of Object.entries({
  RAILWAY_ENVIRONMENT_NAME: 'local',
  SCV_RELEASE_MODE: 'local',
  SCV_PAUSE_ALL: '0',
  SCV_PAUSE_NON_TEST: '0',
  SCV_PAUSE_DEBUG_ACCOUNTS: '0'
})) { previousEnv[key] = process.env[key]; process.env[key] = value }

const { sendWithVisibilityGuarantee } = require(path.join(__dirname, 'outbound-scv2.js'))
const outbox = require(path.join(__dirname, 'outbox-worker.js'))
const visibility = require(path.join(__dirname, 'scv-delivery-visibility.js'))
const history = require(path.join(__dirname, 'scv-history-visibility.js'))
const control = require(path.join(__dirname, 'scv-single-control-plane.js'))
const drift = require(path.join(__dirname, 'scv-drift-monitor.js'))
const reconcileCli = require(path.join(__dirname, 'scv-delivery-visibility-reconcile.js'))

const HARNESS_VERSION = 'scv-delivery-visibility-truth-harness-2026-09-02-v1'
const S = visibility.VISIBILITY_STATES
let checked = 0
const failures = []
function check(name, condition, detail = '') {
  checked += 1
  if (!condition) failures.push({ name, detail: String(detail || '').slice(0, 1200) })
}
function sha256(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex') }

async function main() {
  // ───────────── 1. final sender bodies ─────────────
  let calls = []
  const acceptedNoClient = await sendWithVisibilityGuarantee('3001', 'real.lead', { text: 'hii' }, {
    sendBubble: async () => { calls.push('attempt'); return { status: 200, body: { status: 'success' } } },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  const b1 = acceptedNoClient.body
  check('accepted without receipt or client :: one provider call', calls.length === 1)
  check('accepted without receipt or client :: visibility unknown',
    b1.visibility_state === S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN && b1.delivery_accepted === true &&
    b1.delivery_confirmed === false && b1.delivery_visibility_unknown === true && b1.visibility_confirmed === false &&
    b1.delivery_outcome_ambiguous === false && b1.delivery_outcome_ambiguity_scope === 'provider_acceptance' &&
    b1.visibility_confirmation_source === 'none' && b1.newer_inbound_is_visibility_proof === false &&
    b1.delivery_method === 'manychat_api_accepted_unverified' && b1.provider_receipt_id_present === false, JSON.stringify(b1))

  calls = []
  const acceptedProbeConfirmed = await sendWithVisibilityGuarantee('3002', 'real.lead', { text: 'hii' }, {
    sendBubble: async () => { calls.push('attempt'); return { status: 200, body: { status: 'success' } } },
    getInstagramRuntimeStatus: () => ({ client_exists: true }),
    confirmOutgoingTextVisible: async () => ({ confirmed: true, reason: 'exact_text_found' })
  })
  check('probe confirmed :: confirmed visible',
    acceptedProbeConfirmed.body.visibility_state === S.CONFIRMED_VISIBLE && acceptedProbeConfirmed.body.visibility_confirmed === true &&
    acceptedProbeConfirmed.body.delivery_confirmed === true && acceptedProbeConfirmed.body.delivery_visibility_unknown === false &&
    acceptedProbeConfirmed.body.visibility_confirmation_source === 'instagram_thread_probe' && calls.length === 1, JSON.stringify(acceptedProbeConfirmed.body))

  calls = []
  const acceptedProbeMismatch = await sendWithVisibilityGuarantee('3003', 'real.lead', { text: 'hii' }, {
    sendBubble: async () => { calls.push('attempt'); return { status: 200, body: { status: 'success' } } },
    getInstagramRuntimeStatus: () => ({ client_exists: true }),
    confirmOutgoingTextVisible: async () => ({ confirmed: false, reason: 'text_not_found_in_thread' })
  })
  check('probe mismatch :: stays visibility unknown and never resends',
    acceptedProbeMismatch.body.visibility_state === S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN &&
    acceptedProbeMismatch.body.visibility_probe_reason === 'text_not_found_in_thread' &&
    acceptedProbeMismatch.body.delivery_accepted === true && acceptedProbeMismatch.body.delivery_confirmed === false &&
    calls.length === 1, JSON.stringify(acceptedProbeMismatch.body))

  calls = []
  const exception = await sendWithVisibilityGuarantee('3004', 'real.lead', { text: 'hii' }, {
    sendBubble: async () => { calls.push('attempt'); throw new Error('socket closed after request write') },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  check('provider exception :: outcome unknown, ambiguous, no resend',
    exception.ok === false && exception.body.visibility_state === S.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN &&
    exception.body.delivery_outcome_ambiguous === true && exception.body.do_not_retry === true &&
    exception.body.delivery_visibility_unknown === true && exception.body.delivery_accepted === false && calls.length === 1, JSON.stringify(exception.body))

  calls = []
  const provider5xx = await sendWithVisibilityGuarantee('3005', 'real.lead', { text: 'hii' }, {
    sendBubble: async () => { calls.push('attempt'); return { status: 503, body: { status: 'error', message: 'unavailable' } } },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  check('provider 5xx :: outcome unknown, ambiguous, no resend',
    provider5xx.ok === false && provider5xx.body.visibility_state === S.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN &&
    provider5xx.body.delivery_outcome_ambiguous === true && calls.length === 1, JSON.stringify(provider5xx.body))

  calls = []
  const timeout408 = await sendWithVisibilityGuarantee('3006', 'real.lead', { text: 'hii' }, {
    sendBubble: async () => { calls.push('attempt'); return { status: 408, body: { status: 'error', message: 'timeout' } } },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  check('provider timeout :: outcome unknown, ambiguous, no resend',
    timeout408.ok === false && timeout408.body.visibility_state === S.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN &&
    timeout408.body.delivery_outcome_ambiguous === true && calls.length === 1, JSON.stringify(timeout408.body))

  calls = []
  const retryException = await sendWithVisibilityGuarantee('3007', 'real.lead', { text: 'hii' }, {
    sendBubble: async (_contact, _bubble, tag = '') => {
      calls.push(tag)
      if (!tag) return { status: 400, body: { status: 'error', code: 3031 } }
      throw new Error('tagged request response lost')
    },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  check('exception during tagged retry :: outcome unknown after exactly two attempts',
    retryException.ok === false && retryException.body.visibility_state === S.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN &&
    retryException.body.delivery_outcome_ambiguous === true && calls.length === 2, JSON.stringify(retryException.body))

  calls = []
  const rejected = await sendWithVisibilityGuarantee('3008', 'real.lead', { text: 'hii' }, {
    sendBubble: async () => { calls.push('attempt'); return { status: 400, body: { status: 'error', code: 9999, message: 'bad request' } } },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  check('definitive provider rejection :: confirmed failure, not ambiguous',
    rejected.ok === false && rejected.body.visibility_state === S.CONFIRMED_FAILURE &&
    rejected.body.delivery_outcome_ambiguous === false && rejected.body.delivery_visibility_unknown === false &&
    rejected.body.visibility_confirmed === false && calls.length === 1, JSON.stringify(rejected.body))

  // ───────────── 2. durable worker metrics / ledger records ─────────────
  const wrap = (body, httpStatus = 200) => ({ http_status: httpStatus, body: { ok: httpStatus === 200, result: { status: httpStatus, body } } })
  const metrics = outbox.finalSenderResultMetrics(wrap(b1))
  check('worker metrics carry visibility truth',
    metrics.visibility_state === S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN && metrics.delivery_visibility_unknown === true &&
    metrics.visibility_confirmed === false && metrics.delivery_outcome_ambiguous === false && metrics.delivery_accepted === true &&
    metrics.delivery_confirmed === false && metrics.newer_inbound_is_visibility_proof === false, JSON.stringify(metrics))
  const legacyMetrics = outbox.finalSenderResultMetrics(wrap({ status: 'success', delivery_accepted: true, delivery_confirmed: false, delivery_method: 'manychat_api_accepted_unverified', manychat_status: 200 }))
  check('legacy body without visibility fields is classified, never upgraded',
    legacyMetrics.visibility_state === S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN && legacyMetrics.delivery_visibility_unknown === true, JSON.stringify(legacyMetrics))
  check('classifier: confirmed body', visibility.classifyVisibilityState({ delivery_accepted: true, delivery_confirmed: true }) === S.CONFIRMED_VISIBLE)
  check('classifier: ambiguous body', visibility.classifyVisibilityState({ delivery_accepted: false, delivery_outcome_ambiguous: true }) === S.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN)
  check('classifier: rejected body', visibility.classifyVisibilityState({ delivery_accepted: false, delivery_confirmed: false }) === S.CONFIRMED_FAILURE)

  const packet = {
    contact_id: '3001', thread_id: '3001', instagram_username: 'real.lead', message_id: 'm-3001', bubble_index: 0,
    bubble: { text: 'hii' }, control_receipt: { receipt_sha256: sha256('control-3001') }, transport_response_received_at: '2026-09-02T04:11:16.219Z'
  }
  const start = outbox.createTransportAttemptStart(packet, new Date('2026-09-02T04:11:14.835Z'))
  const completion = outbox.createTransportAttemptCompletion(start, packet, { result: wrap(b1), now: new Date('2026-09-02T04:11:16.219Z') })
  check('transport ledger completion carries visibility truth',
    completion.outcome === 'accepted' && completion.visibility_state === S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN &&
    completion.delivery_visibility_unknown === true && completion.visibility_confirmed === false &&
    completion.delivery_outcome_ambiguous === false && completion.newer_inbound_is_visibility_proof === false, JSON.stringify(completion))
  const lostCompletion = outbox.createTransportAttemptCompletion(start, packet, { error: new Error('lost') })
  check('lost response completion is transport exception outcome unknown',
    lostCompletion.visibility_state === S.TRANSPORT_EXCEPTION_OUTCOME_UNKNOWN && lostCompletion.delivery_outcome_ambiguous === true &&
    lostCompletion.delivery_visibility_unknown === true, JSON.stringify(lostCompletion))
  check('acceptance stays terminal no-resend', outbox.terminalNoResendReason(wrap(b1)) === 'provider_delivery_accepted')
  check('accepted status label is honest', outbox.acceptedDeliveryStatus(wrap(b1)) === 'manychat_accepted_unverified')

  // ───────────── 3. reconciliation ledger ─────────────
  const attemptId = sha256('attempt-3001')
  const providerDir = path.join(root, 'logs', 'provider-send-responses')
  fs.mkdirSync(providerDir, { recursive: true, mode: 0o700 })
  const providerBytes = Buffer.from(JSON.stringify({ status: 'success' }))
  const providerSha = sha256(providerBytes.toString('utf8'))
  const providerFile = `manychat-send-${attemptId}-${providerSha}.raw.json`
  fs.writeFileSync(path.join(providerDir, providerFile), providerBytes, { mode: 0o600 })
  const details = {
    at: '2026-09-02T04:11:16.219Z', thread_id: '3001', contact_id: '3001', message_id: 'm-3001', bubble_index: 0,
    transport_attempt_id: attemptId, text_sha256: sha256('hii'), text_length: 3, delivery_status: 'manychat_accepted_unverified',
    delivery_accepted: true, delivery_confirmed: false, provider_receipt_id_present: false, provider_response_file: providerFile,
    provider_response_sha256: providerSha, control_receipt_sha256: sha256('control-3001'), visibility_state: S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN
  }
  const first = visibility.recordDeliveryVisibility(root, details)
  const second = visibility.recordDeliveryVisibility(root, details)
  check('ledger: one open entry per attempt, duplicate suppressed', first.duplicate === false && second.duplicate === true &&
    visibility.readLedgerRecords(root).length === 1, JSON.stringify({ first, second }))
  const record = first.record
  check('ledger: evidence pointers preserved without message text',
    record.provider_response_file === providerFile && fs.existsSync(path.join(providerDir, record.provider_response_file)) &&
    record.provider_response_sha256 === providerSha && record.control_receipt_sha256 === sha256('control-3001') &&
    record.text_sha256 === sha256('hii') && !('text' in record) && record.raw_message_text_included === false &&
    record.reconciliation_status === 'open' && record.delivery_visibility_unknown === true, JSON.stringify(record))
  let invalidStateThrown = false
  try { visibility.recordDeliveryVisibility(root, { ...details, transport_attempt_id: sha256('x'), visibility_state: 'seen_by_customer' }) } catch (e) { invalidStateThrown = /state_invalid/.test(String(e.message)) }
  check('ledger: rejects invented visibility states', invalidStateThrown)

  const at = Date.parse(details.at)
  const summaryEarly = visibility.summarizeDeliveryVisibility(root, at + 60000)
  check('summary: open unconfirmed count', summaryEarly.unconfirmed_open_count === 1 && summaryEarly.oldest_unconfirmed_at === details.at &&
    summaryEarly.newer_inbound_is_visibility_proof === false, JSON.stringify(summaryEarly))
  check('alert: none before the backlog age threshold', visibility.deliveryVisibilityAlerts(root, { now: at + 60000 }).length === 0)
  const alerts = visibility.deliveryVisibilityAlerts(root, { now: at + 16 * 60000 })
  check('alert: operational backlog alert after threshold', alerts.length === 1 && alerts[0].reason === 'delivery_visibility_unconfirmed_backlog' &&
    alerts[0].unconfirmed_open_count === 1, JSON.stringify(alerts))
  check('alert: classified operational, never critical', drift.driftAlertSeverity(alerts[0]) === 'operational' &&
    drift.classifyDriftAlerts(alerts).critical_ok === true && drift.classifyDriftAlerts(alerts).operational.length === 1)

  // ───────────── 4. operator resolution ─────────────
  let missingThrown = false
  try { visibility.resolveDeliveryVisibility(root, { transport_attempt_id: sha256('missing'), resolution: 'confirmed_visible', source: 'operator_instagram_thread_review' }) } catch (e) { missingThrown = /pending_record_missing/.test(String(e.message)) }
  check('resolution: unknown attempt id is refused', missingThrown)
  let sourceThrown = false
  try { visibility.resolveDeliveryVisibility(root, { transport_attempt_id: attemptId, resolution: 'confirmed_visible', source: 'none' }) } catch (e) { sourceThrown = /source_required/.test(String(e.message)) }
  check('resolution: requires an explicit confirmation source', sourceThrown)
  const cliResolve = reconcileCli.main(['resolve', '--transport-attempt-id', attemptId, '--resolution', 'confirmed_not_visible', '--source', 'operator_instagram_thread_review', '--note', 'owner did not see the reply'])
  check('resolution: operator cli appends a resolution and performs no resend',
    cliResolve.ok === true && cliResolve.duplicate === false && cliResolve.resend_performed === false && cliResolve.record.resolution === 'confirmed_not_visible', JSON.stringify(cliResolve))
  const summaryResolved = visibility.summarizeDeliveryVisibility(root, at + 16 * 60000)
  check('summary: resolution closes the open entry', summaryResolved.unconfirmed_open_count === 0 && summaryResolved.resolved_not_visible_count === 1, JSON.stringify(summaryResolved))
  check('alert: cleared after resolution', visibility.deliveryVisibilityAlerts(root, { now: at + 16 * 60000 }).length === 0)
  const cliList = reconcileCli.main(['list'])
  check('cli list is redacted and empty after resolution', cliList.ok === true && cliList.open_count === 0)

  // ───────────── 5. newer inbound never becomes visibility proof ─────────────
  const AUTH = { authenticated_inbound: true, authentication_source: 'shared_secret' }
  const BASE_MS = Date.now() - 120000
  const threadId = 'visibility-truth-boundary'
  const firstInbound = {
    contact_id: threadId, thread_id: threadId, instagram_username: 'omar.system', message_id: `${threadId}-info`,
    text: 'Can I please get more information?', text_source: 'manychat_webhook', received_at: new Date(BASE_MS).toISOString()
  }
  control.ensureControlDirs(root)
  control.recordIngressEvent(root, firstInbound, AUTH)
  const bubbles = [{ text: 'sure!! a model spot is a spot i keep open for just a few pieces in my style and the tattoo is made from what you want 🖤' }]
  const committed = control.commitControlDecision(root, firstInbound, control.readControlState(root, threadId), {
    authority: { controller: control.SCV_SINGLE_CONTROL_PLANE_ID, route: 'visibility_truth_harness' },
    raw_text: bubbles[0].text,
    packet: { bubbles }
  })
  const attemptedAt = new Date(BASE_MS + 10000).toISOString()
  control.appendControlHistoryEvent(root, { ...firstInbound, bubble_index: 0, bubble: bubbles[0] }, 'assistant_attempted', {
    at: attemptedAt, delivery_status: 'manychat_accepted_unverified'
  })
  const boundaryAttemptId = sha256('attempt-boundary-0')
  const boundaryProviderFile = `manychat-send-${boundaryAttemptId}-${providerSha}.raw.json`
  fs.writeFileSync(path.join(providerDir, boundaryProviderFile), providerBytes, { mode: 0o600 })
  const receipt = {
    at: new Date(BASE_MS + 11000).toISOString(), contact_id: threadId, thread_id: threadId, instagram_username: 'omar.system',
    message_id: firstInbound.message_id, bubble_index: 0, control_receipt_sha256: committed.receipt.receipt_sha256,
    text_sha256: sha256(bubbles[0].text), text_length: bubbles[0].text.length, delivery_status: 'manychat_accepted_unverified',
    delivery_accepted: true, delivery_confirmed: false, delivery_method: 'manychat_api_accepted_unverified', http_status: 200, manychat_status: 200,
    provider_response_file: boundaryProviderFile, provider_response_sha256: providerSha, provider_response_size_bytes: providerBytes.length,
    provider_receipt_id_present: false, provider_receipt_id: '', provider_receipt_id_path: '', transport_attempt_id: boundaryAttemptId,
    visibility_state: S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN, visibility_confirmed: false, delivery_visibility_unknown: true,
    visibility_confirmation_source: 'none', newer_inbound_is_visibility_proof: false
  }
  const receiptsFile = path.join(root, 'logs', 'delivery-receipts.ndjson')
  fs.appendFileSync(receiptsFile, JSON.stringify(receipt) + '\n')
  visibility.recordDeliveryVisibility(root, {
    at: receipt.at, thread_id: threadId, contact_id: threadId, message_id: receipt.message_id, bubble_index: 0,
    transport_attempt_id: boundaryAttemptId, text_sha256: receipt.text_sha256, text_length: receipt.text_length,
    delivery_status: receipt.delivery_status, delivery_accepted: true, delivery_confirmed: false, provider_receipt_id_present: false,
    provider_response_file: boundaryProviderFile, provider_response_sha256: providerSha, control_receipt_sha256: receipt.control_receipt_sha256,
    visibility_state: S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN
  })
  const newer = { ...firstInbound, message_id: `${threadId}-again`, text: 'hello?? did you get my message', received_at: new Date(BASE_MS + 20000).toISOString() }
  control.recordIngressEvent(root, newer, AUTH)
  const threadHistory = JSON.parse(fs.readFileSync(path.join(root, 'thread-history', `${threadId}.json`), 'utf8'))
  const attempted = threadHistory.events.find((event) => event.role === 'assistant_attempted' && event.message_id === firstInbound.message_id)
  const marker = attempted && attempted.accepted_unverified_conversation_boundary
  check('boundary: newer inbound reconciles the dialogue ledger', marker && history.isConversationVisibleAssistantEvent(attempted) === true, JSON.stringify(attempted))
  check('boundary: marker is labeled ledger inclusion only, never visibility proof',
    marker && marker.visibility_confirmed === false && marker.visibility_state === S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN &&
    marker.boundary_semantics === history.ACCEPTED_UNVERIFIED_BOUNDARY_SEMANTICS && marker.newer_inbound_is_visibility_proof === false &&
    marker.delivery_confirmed === false, JSON.stringify(marker))
  check('boundary: attempt is not a delivery-visibility-confirmed event', history.isDeliveryVisibilityConfirmedEvent(attempted) === false)
  check('boundary: marker validation still accepts the extended marker', history.acceptedUnverifiedBoundaryMarker(attempted) !== null)
  const receiptRows = fs.readFileSync(receiptsFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  const boundaryRow = receiptRows.find((row) => row.transport_attempt_id === boundaryAttemptId)
  check('boundary: delivery receipt row unchanged (still not confirmed)', boundaryRow && boundaryRow.delivery_confirmed === false &&
    boundaryRow.delivery_status === 'manychat_accepted_unverified' && boundaryRow.visibility_state === S.PROVIDER_ACCEPTED_VISIBILITY_UNKNOWN, JSON.stringify(boundaryRow))
  const summaryAfterInbound = visibility.summarizeDeliveryVisibility(root, BASE_MS + 30000)
  check('boundary: reconciliation entry stays open after the newer inbound', summaryAfterInbound.unconfirmed_open_count === 1, JSON.stringify(summaryAfterInbound))
  const audit = fs.existsSync(path.join(root, 'control-events', `${threadId}.ndjson`))
    ? fs.readFileSync(path.join(root, 'control-events', `${threadId}.ndjson`), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : []
  const boundaryAudit = audit.find((row) => String(row.type || '').startsWith('accepted_unverified_conversation_boundary_reconciled'))
  check('boundary: control audit records the non-proof semantics',
    boundaryAudit && boundaryAudit.visibility_confirmed === false && boundaryAudit.boundary_semantics === history.ACCEPTED_UNVERIFIED_BOUNDARY_SEMANTICS &&
    boundaryAudit.newer_inbound_is_visibility_proof === false, JSON.stringify(boundaryAudit || audit.map((row) => row.type)))
  check('boundary: no outbox work was created by reconciliation',
    !fs.existsSync(path.join(root, 'outbox')) || fs.readdirSync(path.join(root, 'outbox')).length === 0)

  // legacy marker without the new fields still never counts as confirmed
  const legacyEvent = JSON.parse(JSON.stringify(attempted))
  delete legacyEvent.accepted_unverified_conversation_boundary.visibility_confirmed
  delete legacyEvent.accepted_unverified_conversation_boundary.visibility_state
  delete legacyEvent.accepted_unverified_conversation_boundary.boundary_semantics
  delete legacyEvent.accepted_unverified_conversation_boundary.newer_inbound_is_visibility_proof
  check('legacy marker (pre-v138) is still ledger-visible and still not delivery-confirmed',
    history.isConversationVisibleAssistantEvent(legacyEvent) === true && history.isDeliveryVisibilityConfirmedEvent(legacyEvent) === false)
  check('confirmed visible assistant event is recognized',
    history.isDeliveryVisibilityConfirmedEvent({ role: 'assistant', delivery_status: 'success_visible', text: 'x' }) === true &&
    history.isDeliveryVisibilityConfirmedEvent({ role: 'assistant', delivery_status: 'manychat_accepted_unverified', text: 'x' }) === false)

  return { ok: failures.length === 0, harness_version: HARNESS_VERSION, checked, failed: failures.length, failures }
}

main()
  .then((result) => {
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exit(1)
  })
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, error: String(error?.stack || error?.message || error) }, null, 2))
    process.exit(1)
  })
  .finally(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    fs.rmSync(root, { recursive: true, force: true })
  })
