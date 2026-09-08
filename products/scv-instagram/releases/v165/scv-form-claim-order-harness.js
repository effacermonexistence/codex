#!/usr/bin/env node

// Form-claim ordering seal (live e2e deadlock 2026-08-27): the closed-transition
// route was derived from durable state alone while the Gmail form claim only ran
// inside candidate generation. A recorded-but-unclaimed form therefore produced
// accepted_slot_missing_identity at route time, the deterministic identity
// checkpoint fail-closed at the conversation-receipt gate before any candidate
// could carry the claim, and the recovery commit may not add new facts — the
// funnel livelocked at the deposit doorstep. This harness seals:
//   1. the control plane claims the Gmail form BEFORE route derivation,
//   2. the receipt gate exempts every deterministic fixed booking checkpoint
//      action (model: 'none' by construction),
//   3. the claim itself populates identity fields and re-claims idempotently.

const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

let checked = 0
function check(name, value) { assert.ok(value, name); checked += 1 }

// --- 1+2: control-plane ordering and receipt exemption (source seal) ---
const controlSource = fs.readFileSync(path.join(__dirname, 'scv-single-control-plane.js'), 'utf8')
const claimIndex = controlSource.indexOf('applyGmailFormAutofill')
const deriveIndex = controlSource.indexOf('let transitionPlan = deriveClosedTransitionPlan')
check('control_plane_claims_form_before_route_derivation',
  claimIndex !== -1 && deriveIndex !== -1 && claimIndex < deriveIndex)
const exemptionStart = controlSource.indexOf('explicitVerbatimCheckpoint')
const exemptionBlock = controlSource.slice(exemptionStart, exemptionStart + 1200)
check('receipt_gate_exempts_post_form_identity_checkpoint',
  exemptionBlock.includes('POST_FORM_IDENTITY'))
check('receipt_gate_exempts_post_form_time_checkpoint',
  exemptionBlock.includes('POST_FORM_TIME'))
check('receipt_gate_exempts_slot_progress_checkpoint',
  exemptionBlock.includes('ACCEPTED_SLOT_PROGRESS'))

// --- 3: functional claim in an isolated SCV_ROOT ---
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-form-claim-'))
fs.mkdirSync(path.join(scratch, 'form-submissions'), { recursive: true })
const nowIso = new Date().toISOString()
fs.writeFileSync(path.join(scratch, 'form-submissions', '9001.json'), JSON.stringify({
  name: 'Harness Lead',
  phone: '5551234567',
  instagram: 'harnesslead',
  email_date: nowIso,
  recorded_at: nowIso
}))
const script = `
const { applyGmailFormAutofill } = require(${JSON.stringify(path.join(__dirname, 'dm-authority.js'))})
const history = [
  { role: 'assistant', message_id: 'm1', text: 'fill this form https://www.effacermonexistence.com/apply' },
  { role: 'user', message_id: 'm2', text: 'I just submitted it' }
]
const msg = { thread_id: 'thread-9001', contact_id: 'thread-9001', instagram_username: 'harnesslead' }
const first = applyGmailFormAutofill({ ...msg }, {
  form_link_sent: true, form_offer_asked: true, live_turn_form_submitted_signal: true
}, history)
const second = applyGmailFormAutofill({ ...msg }, {
  form_link_sent: true, form_offer_asked: true, live_turn_form_submitted_signal: true
}, history)
console.log(JSON.stringify({
  first_name: first.known_name_used_on_form || '',
  first_phone: first.known_phone_used_on_form || '',
  first_submitted: first.form_submitted === true,
  reclaim_name: second.known_name_used_on_form || ''
}))
`
const run = spawnSync(process.execPath, ['-e', script], {
  encoding: 'utf8',
  env: { ...process.env, SCV_ROOT: scratch }
})
let result = null
try { result = JSON.parse(String(run.stdout || '').trim().split('\n').pop()) } catch {}
check('claim_populates_identity_fields',
  result && result.first_name === 'Harness Lead' && result.first_phone === '5551234567')
check('claim_latches_form_submitted', result && result.first_submitted === true)
check('same_thread_reclaim_is_idempotent', result && result.reclaim_name === 'Harness Lead')
fs.rmSync(scratch, { recursive: true, force: true })

console.log(`scv-form-claim-order-harness ok checks=${checked}`)

// --- loose handle-prefix claim (Ben 2026-08-27: "Omar syndrome" typo test) ---
const scratch2 = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-form-claim-loose-'))
fs.mkdirSync(path.join(scratch2, 'form-submissions'), { recursive: true })
const now2 = new Date().toISOString()
fs.writeFileSync(path.join(scratch2, 'form-submissions', '9002.json'), JSON.stringify({
  name: 'Codex saw 10',
  phone: '1231234213',
  instagram: 'Omar syndrome',
  email_date: now2,
  recorded_at: now2
}))
const linkAt = new Date(Date.now() - 5 * 60 * 1000).toISOString()
const looseScript = `
const { applyGmailFormAutofill } = require(${JSON.stringify(path.join(__dirname, 'dm-authority.js'))})
const history = [
  { role: 'assistant', message_id: 'm1', at: ${JSON.stringify(linkAt)}, text: 'fill this form https://www.effacermonexistence.com/apply' },
  { role: 'user', message_id: 'm2', at: ${JSON.stringify(linkAt)}, text: 'I just submitted' }
]
const msg = { thread_id: 'thread-9002', contact_id: 'thread-9002', instagram_username: 'omar.system' }
const out = applyGmailFormAutofill({ ...msg }, {
  form_link_sent: true, form_offer_asked: true, live_turn_form_submitted_signal: true
}, history)
console.log(JSON.stringify({ name: out.known_name_used_on_form || '', phone: out.known_phone_used_on_form || '' }))
`
const looseRun = spawnSync(process.execPath, ['-e', looseScript], {
  encoding: 'utf8',
  env: { ...process.env, SCV_ROOT: scratch2 }
})
let looseResult = null
try { looseResult = JSON.parse(String(looseRun.stdout || '').trim().split('\n').pop()) } catch {}
check('whisper_typo_handle_still_claims',
  looseResult && looseResult.name === 'Codex saw 10' && looseResult.phone === '1231234213')

// A genuinely different handle (no shared prefix) must stay refused.
const scratch3 = fs.mkdtempSync(path.join(os.tmpdir(), 'scv-form-claim-foreign-'))
fs.mkdirSync(path.join(scratch3, 'form-submissions'), { recursive: true })
fs.writeFileSync(path.join(scratch3, 'form-submissions', '9003.json'), JSON.stringify({
  name: 'Someone Else',
  phone: '9998887777',
  instagram: 'totally.other.lead',
  email_date: now2,
  recorded_at: now2
}))
const foreignRun = spawnSync(process.execPath, ['-e', looseScript.replace('thread-9002', 'thread-9003').replace("'omar.system'", "'omar.system'")], {
  encoding: 'utf8',
  env: { ...process.env, SCV_ROOT: scratch3 }
})
let foreignResult = null
try { foreignResult = JSON.parse(String(foreignRun.stdout || '').trim().split('\n').pop()) } catch {}
check('foreign_handle_still_refused', foreignResult && foreignResult.name === '')
fs.rmSync(scratch2, { recursive: true, force: true })
fs.rmSync(scratch3, { recursive: true, force: true })
console.log('loose-handle checks appended ok')
