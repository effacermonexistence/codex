#!/usr/bin/env node
const path = require('path')

const {
  compareOutboxEntriesForSendOrder,
  isAtomicDepositHandoffPacket,
  shouldBypassStaleForAtomicDepositHandoff,
  OUTBOX_SEND_ORDER_LOCK_VERSION
} = require(path.join(__dirname, 'outbox-worker.js'))

function runScvOutboxOrderHarness() {
  const failures = []
  const check = (name, condition, detail = '') => {
    if (!condition) failures.push({ name, detail })
  }

  check('outbox_order_lock_version_exact', OUTBOX_SEND_ORDER_LOCK_VERSION === 'scv-outbox-send-order-lock-2026-07-10-v2', OUTBOX_SEND_ORDER_LOCK_VERSION)
  check('compare_export_present', typeof compareOutboxEntriesForSendOrder === 'function', typeof compareOutboxEntriesForSendOrder)
  check('atomic_deposit_helper_export_present', typeof isAtomicDepositHandoffPacket === 'function', typeof isAtomicDepositHandoffPacket)
  check('atomic_deposit_stale_bypass_export_present', typeof shouldBypassStaleForAtomicDepositHandoff === 'function', typeof shouldBypassStaleForAtomicDepositHandoff)

  const sameDue = Date.parse('2026-06-23T10:00:00.000Z')
  const laterDue = sameDue + 1
  const bubble1EarlierFile = {
    file: '/app/outbox/aaa.json',
    due_at_ms: sameDue,
    queued_at_ms: sameDue,
    thread_id: '1537753982',
    message_id: '1782236456209',
    bubble_index: 1
  }
  const bubble0LaterFile = {
    file: '/app/outbox/zzz.json',
    due_at_ms: sameDue,
    queued_at_ms: sameDue,
    thread_id: '1537753982',
    message_id: '1782236456209',
    bubble_index: 0
  }
  const otherLaterDue = {
    file: '/app/outbox/000.json',
    due_at_ms: laterDue,
    queued_at_ms: sameDue,
    thread_id: '1537753982',
    message_id: '1782236456209',
    bubble_index: 0
  }

  const sorted = [bubble1EarlierFile, otherLaterDue, bubble0LaterFile].sort(compareOutboxEntriesForSendOrder)
  check('same_message_same_due_sorts_by_bubble_index_not_filename', sorted[0].bubble_index === 0 && sorted[1].bubble_index === 1, JSON.stringify(sorted))
  check('due_at_still_primary_order', sorted[2].due_at_ms === laterDue, JSON.stringify(sorted))

  const completeAtomicDeposit = {
    authority_transport_flags: {
      atomic_deposit_handoff: true
    },
    bubbles: [
      { text: 'perfect thank you' },
      { text: 'to confirm your appointment the deposit is 100' },
      { text: 'zelle is contact@omarprotocol.com' },
      { text: 'once you send it just lmk so i can double check everything on my side and confirm your appointment on my calendar' }
    ],
    bubble: { text: 'once you send it just lmk so i can double check everything on my side and confirm your appointment on my calendar' }
  }
  const incompleteAtomicDeposit = {
    authority_transport_flags: {
      atomic_deposit_handoff: true
    },
    bubbles: [
      { text: 'to confirm your appointment the deposit is 100' },
      { text: 'zelle is contact@omarprotocol.com' }
    ],
    bubble: { text: 'zelle is contact@omarprotocol.com' }
  }
  const normalPacket = {
    bubbles: completeAtomicDeposit.bubbles,
    bubble: completeAtomicDeposit.bubble
  }
  check('complete_atomic_deposit_packet_detected', isAtomicDepositHandoffPacket(completeAtomicDeposit) === true, JSON.stringify(completeAtomicDeposit))
  check('incomplete_atomic_deposit_packet_not_detected', isAtomicDepositHandoffPacket(incompleteAtomicDeposit) === false, JSON.stringify(incompleteAtomicDeposit))
  check('normal_deposit_without_atomic_flag_not_detected', isAtomicDepositHandoffPacket(normalPacket) === false, JSON.stringify(normalPacket))
  check('atomic_deposit_never_bypasses_stale_generation_gate', shouldBypassStaleForAtomicDepositHandoff(completeAtomicDeposit) === false, JSON.stringify(completeAtomicDeposit))

  if (failures.length) {
    const err = new Error(`scv_outbox_order_harness_failed:${JSON.stringify(failures)}`)
    err.failures = failures
    throw err
  }

  return {
    ok: true,
    locked: true,
    lock_version: OUTBOX_SEND_ORDER_LOCK_VERSION,
    checked: 10
  }
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(runScvOutboxOrderHarness(), null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), failures: err.failures || [] }, null, 2))
    process.exit(1)
  }
}

module.exports = {
  runScvOutboxOrderHarness
}
