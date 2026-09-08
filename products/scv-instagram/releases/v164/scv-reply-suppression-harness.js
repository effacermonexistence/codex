#!/usr/bin/env node
// ============================================================
// SCV REPLY SUPPRESSION HARNESS — Ben law: a username HEURISTIC may never silence
// an inbound reply. Live case: wondercrushstudio ("studio" in the handle) asked
// "Hello, can I get more info on this?" and the compact heuristic suppressed 28
// straight replies while the sweep looped recovering the same turn. Explicit
// operator suppressions (ManyChat 'flag' tag, known-shop list) stay authoritative.
// ============================================================
const path = require('path')
const fs = require('fs')
const sup = require(path.join(__dirname, 'instagram-thread-suppression.js'))

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

async function runScvReplySuppressionHarness() {
  let checked = 0
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }

  // 1. THE LIVE CASE: heuristic verdicts are marked heuristic:true.
  const wc = await sup.getInstagramSuppressionForUsername('wondercrushstudio', { text: 'Hello, can I get more info on this?' })
  ok(wc.suppressed === true && wc.heuristic === true, 'shop_heuristic_marked_heuristic', JSON.stringify(wc))
  ok(wc.matched_tag === 'tattoo_shop_username_compact_heuristic', 'wondercrush_matches_compact_heuristic', JSON.stringify(wc))

  // 2. A normal lead handle is not suppressed at all.
  const normal = await sup.getInstagramSuppressionForUsername('luv444kiki', { text: 'hi' })
  ok(normal.suppressed !== true, 'normal_lead_not_suppressed', JSON.stringify(normal))

  // 3. Reply lane bypasses heuristics (inbox-worker) — both the live-evaluated verdict
  //    and a previously stamped thread-state tag.
  const workerSrc = fs.readFileSync(path.join(__dirname, 'inbox-worker.js'), 'utf8')
  ok(/REPLY_LANE_HEURISTIC_TAGS/.test(workerSrc) && /tattoo_shop_username_compact_heuristic/.test(workerSrc), 'worker_bypass_set_present')
  ok(/heuristic === true[\s\S]{0,120}heuristic_bypassed_for_inbound_reply/.test(workerSrc), 'worker_live_verdict_bypass')
  ok(/inbox_worker_heuristic_suppression_bypassed/.test(workerSrc), 'worker_stamped_state_bypass_logged')

  // 3b. SEND lane (outbox-worker) bypasses heuristics too — it was the second ambush
  //     that killed the queued opener right after the inbox fix.
  const outboxSrc = fs.readFileSync(path.join(__dirname, 'outbox-worker.js'), 'utf8')
  ok(/REPLY_LANE_HEURISTIC_TAGS/.test(outboxSrc) && /tattoo_shop_username_compact_heuristic/.test(outboxSrc), 'outbox_bypass_set_present')
  ok(/heuristic === true[\s\S]{0,120}heuristic_bypassed_for_inbound_reply/.test(outboxSrc), 'outbox_live_verdict_bypass')
  ok(/outbox_worker_heuristic_suppression_bypassed/.test(outboxSrc), 'outbox_stamped_state_bypass_logged')

  // 4. Inbound stamping: heuristic verdicts become advisory fields, never
  //    automation_suppressed (which silences replies downstream).
  const inboundSrc = fs.readFileSync(path.join(__dirname, 'inbound-scv.js'), 'utf8')
  ok(/verdict\.heuristic === true[\s\S]{0,220}instagram_shop_heuristic: true/.test(inboundSrc), 'inbound_heuristic_advisory_only')

  // 5. Explicit suppressions stay authoritative (no heuristic flag on them).
  const src = fs.readFileSync(path.join(__dirname, 'instagram-thread-suppression.js'), 'utf8')
  ok(!/known_tattoo_shop_username'[\s\S]{0,80}heuristic: true/.test(src), 'known_shop_list_not_marked_heuristic')

  return { ok: true, checked }
}

if (require.main === module) {
  runScvReplySuppressionHarness()
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => {
      console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
      process.exit(1)
    })
}

module.exports = { runScvReplySuppressionHarness }
