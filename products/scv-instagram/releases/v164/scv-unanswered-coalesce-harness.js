#!/usr/bin/env node
// ============================================================
// SCV UNANSWERED-COALESCE HARNESS — "no dropped message" verification.
//
// Root cause it guards: outbox-worker drops (quarantines) a reply whose message_id
// is not the thread's latest (newer_inbound_exists_for_thread). If a lead sends A
// (a long idea) then B (a short follow-up) before A's delayed reply is delivered,
// A's reply is discarded and B's reply only addresses B -> A's content is lost.
//
// Fix under test: dm-authority.collectPendingUnansweredUserTurns() surfaces every
// earlier user turn that has NOT received a DELIVERED assistant reply, so the live
// reply must cover them all. This harness asserts that set is computed with ZERO
// dropped messages across the scenarios that produced the live bug.
// ============================================================
const path = require('path')
const {
  collectPendingUnansweredUserTurns,
  buildCoalescedRunnerMessage
} = require(path.join(__dirname, 'dm-authority.js'))

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

const u = (text, message_id = String(Math.random())) => ({ role: 'user', message_id, text })
const a = (text = 'reply') => ({ role: 'assistant', text })
const aAttempt = (text = 'reply') => ({ role: 'assistant_attempted', text })
const aHuman = (text = 'reply') => ({ role: 'assistant_human_agent_required', text })

function runScvUnansweredCoalesceHarness() {
  let checked = 0
  const eq = (got, want, label) => {
    assert(JSON.stringify(got) === JSON.stringify(want), label, `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`)
    checked++
  }
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }

  // recentHistory ALWAYS excludes the current live inbound (loadRecentThreadHistory filters it),
  // so these arrays are "everything before the live turn B".

  // 1. SIERRA CASE: opener delivered, then a long unanswered idea (A). Live turn = pricing (B, excluded).
  //    Backlog must carry the long idea so B's reply covers it.
  eq(
    collectPendingUnansweredUserTurns([a('Hiii!!! thank you so much for reaching out to me!'), u('big halloween haunted house piece with skulls in the tree roots, outer thigh, how big?')]),
    ['big halloween haunted house piece with skulls in the tree roots, outer thigh, how big?'],
    'sierra_long_idea_stays_in_backlog'
  )

  // 2. Already answered: user A got a delivered assistant reply -> backlog empty.
  eq(collectPendingUnansweredUserTurns([u('A'), a('answered A')]), [], 'answered_message_not_in_backlog')

  // 3. Two consecutive unanswered user messages -> both in backlog, oldest first.
  eq(collectPendingUnansweredUserTurns([u('A first'), u('B second')]), ['A first', 'B second'], 'two_unanswered_both_kept_in_order')

  // 4. Mixed: answered A, then two unanswered B,C -> only B,C.
  eq(collectPendingUnansweredUserTurns([u('A'), a('answered A'), u('B'), u('C')]), ['B', 'C'], 'only_after_last_delivered_assistant')

  // 5. ZERO-DROP INVARIANT: K consecutive user messages with no delivered reply ->
  //    backlog has exactly all of them; nothing is dropped.
  const many = [u('m1'), u('m2'), u('m3'), u('m4'), u('m5')]
  eq(collectPendingUnansweredUserTurns(many), ['m1', 'm2', 'm3', 'm4', 'm5'], 'zero_drop_all_consecutive_user_turns_kept')

  // 6. assistant_attempted (delivery failed, user never saw it) does NOT close the backlog.
  eq(collectPendingUnansweredUserTurns([u('A'), aAttempt('failed reply')]), ['A'], 'attempted_reply_does_not_answer')

  // 7. assistant_human_agent_required (never delivered) does NOT close the backlog either.
  eq(collectPendingUnansweredUserTurns([u('A'), aHuman('stuck')]), ['A'], 'human_agent_required_does_not_answer')

  // 8. A delivered assistant AFTER attempted ones still closes correctly (last delivered wins).
  eq(collectPendingUnansweredUserTurns([u('A'), aAttempt(), a('finally delivered'), u('B')]), ['B'], 'last_delivered_assistant_is_boundary')

  // 9. Empty / assistant-only / whitespace robustness.
  eq(collectPendingUnansweredUserTurns([]), [], 'empty_history_empty_backlog')
  eq(collectPendingUnansweredUserTurns([a('hi')]), [], 'assistant_only_empty_backlog')
  eq(collectPendingUnansweredUserTurns([u('   '), u('real')]), ['real'], 'blank_user_text_skipped')
  eq(collectPendingUnansweredUserTurns(null), [], 'null_history_safe')

  // 10. Single normal turn (no earlier unanswered): backlog empty -> no false coalesce, no dup.
  eq(collectPendingUnansweredUserTurns([a('prev reply')]), [], 'normal_single_turn_no_backlog')

  // 11. Field-shape contract used by dm-authority injection (live_turn_has_unanswered_backlog).
  const backlog = collectPendingUnansweredUserTurns([u('idea one'), u('idea two')])
  ok(Array.isArray(backlog) && backlog.length === 2, 'backlog_is_array')
  ok((backlog.length > 0) === true, 'has_backlog_flag_true_when_pending')
  ok((collectPendingUnansweredUserTurns([a()]).length > 0) === false, 'has_backlog_flag_false_when_none')

  // 12. Model context may include the unanswered backlog, but deterministic live
  // gates receive the current atomic turn through a separate immutable field.
  const split = buildCoalescedRunnerMessage('Just submitted', [
    'sent a voice note saying: I just sent you the form.',
    'sent a voice note saying: I just sent you the form I just submitted.'
  ])
  ok(split.live_message === 'Just submitted', 'atomic_live_message_is_not_contaminated_by_backlog', JSON.stringify(split))
  ok(split.message.includes('earlier message 1') && split.message.includes('their latest message just now'), 'model_message_keeps_unanswered_backlog', JSON.stringify(split))
  ok(split.message.endsWith('Just submitted'), 'model_message_keeps_latest_turn_last', JSON.stringify(split))

  return { ok: true, checked }
}

if (require.main === module) {
  try {
    const r = runScvUnansweredCoalesceHarness()
    console.log(JSON.stringify(r, null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  }
}

module.exports = { runScvUnansweredCoalesceHarness }
