#!/usr/bin/env node
// ============================================================
// SCV WINDOW RECOVERY HARNESS — 24h-window (3031) HUMAN_AGENT tag retry.
//
// Root cause it guards: when a lead's last IG interaction is >24h old, ManyChat
// refuses delivery (400 code 3031/3011). The direct IG fallback module is dead
// (instagram-cli-4llm not present in the container, source not recoverable), so the
// reply used to die in outbox_human_agent_required with no retry.
//
// Fix under test: on an explicit ManyChat 3031/3011 result, outbound-scv2 retries ONCE with the
// Meta HUMAN_AGENT message tag (replies allowed up to 7 days). Fail-open: if the
// retry fails (tag not approved / any error), the original blocked result and the
// existing human-agent quarantine path are preserved. Kill switch:
// SCV_HUMAN_AGENT_TAG_RETRY=0. Content is additionally covered by the coalesce
// layer (undelivered turns merge into the next reply when the lead returns).
// ============================================================
const path = require('path')
const fs = require('fs')
const scv2 = require(path.join(__dirname, 'outbound-scv2.js'))

function assert(cond, label, detail = '') {
  if (!cond) {
    const err = new Error(`${label}${detail ? ` :: ${detail}` : ''}`)
    err.label = label
    throw err
  }
}

async function runScvWindowRecoveryHarness() {
  let checked = 0
  const ok = (cond, label, detail = '') => { assert(cond, label, detail); checked++ }

  // 1. Window-blocked detection (the exact live 3031 shape).
  ok(scv2.isManyChatWindowBlocked({ status: 400, body: { code: 3031, message: "Content can't be sent to this subscriber without a Notification Reason. Subscriber's last interaction was more than 24 hours ago" } }) === true, 'detects_3031')
  ok(scv2.isManyChatWindowBlocked({ status: 400, body: { code: 3011, message: 'x' } }) === true, 'detects_3011')
  ok(scv2.isManyChatWindowBlocked({ status: 400, body: { message: 'subscriber last interaction was too old' } }) === false, 'prose_only_error_does_not_authorize_privileged_retry')
  ok(scv2.isManyChatWindowBlocked({ status: 200, body: { status: 'success' } }) === false, 'success_not_blocked')
  ok(scv2.isManyChatWindowBlocked({ status: 400, body: { code: 1234, message: 'other error' } }) === false, 'other_400_not_blocked')

  // 2. Send body: default has NO message_tag (normal in-window sends unchanged).
  const bubble = { text: 'hey!' }
  const normal = scv2.buildSendBody('123', bubble)
  ok(normal.subscriber_id === 123 && normal.data.content.messages[0].text === 'hey!', 'normal_body_shape')
  ok(!('message_tag' in normal), 'normal_send_has_no_tag')

  // 3. Retry body: HUMAN_AGENT override present, text identical (same bubble, only tagged).
  const tagged = scv2.buildSendBody('123', bubble, 'HUMAN_AGENT')
  ok(tagged.message_tag === 'HUMAN_AGENT', 'retry_body_has_human_agent_tag')
  ok(tagged.data.content.messages[0].text === 'hey!', 'retry_body_same_text')

  // 4. Behavior: retry fires only on a coded window block, once, with the tag;
  //    on retry success the result is adopted. This exercises the injected send
  //    boundary instead of depending on implementation-specific source spelling.
  const calls = []
  const result = await scv2.sendWithVisibilityGuarantee('123', '', bubble, {
    sendBubble: async (_contactId, _bubble, tag) => {
      calls.push(tag || '')
      if (calls.length === 1) return { status: 400, body: { code: 3031, message: 'window closed' } }
      return { status: 200, body: { status: 'success' } }
    },
    env: {
      RAILWAY_ENVIRONMENT_NAME: 'local',
      SCV_RELEASE_MODE: 'local',
      SCV_PAUSE_ALL: '0',
      SCV_PAUSE_NON_TEST: '0',
      SCV_PAUSE_DEBUG_ACCOUNTS: '0'
    },
    getInstagramRuntimeStatus: () => ({ client_exists: false })
  })
  ok(calls.length === 2, 'coded_window_block_retries_once')
  ok(calls[0] === '' && calls[1] === 'HUMAN_AGENT', 'retry_uses_human_agent_tag')
  ok(result.ok === true && result.body.delivery_accepted === true, 'successful_tagged_retry_is_adopted')

  // 5. Static guard: the kill switch and observability remain wired.
  const src = fs.readFileSync(path.join(__dirname, 'outbound-scv2.js'), 'utf8')
  ok(/HUMAN_AGENT_TAG_RETRY && isManyChatWindowBlocked\(transport\.manychat\)/.test(src), 'retry_gated_on_window_blocked')
  ok(/SCV_HUMAN_AGENT_TAG_RETRY/.test(src), 'kill_switch_env_present')
  ok(/manychat_human_agent_tag_retry/.test(src), 'retry_logged_for_observability')
  ok(/human_agent_tag_retry: transport\.human_agent_tag_retry \|\| null/.test(src), 'retry_surfaced_in_blocked_response')

  return { ok: true, checked }
}

if (require.main === module) {
  runScvWindowRecoveryHarness().then((result) => {
    console.log(JSON.stringify(result, null, 2))
  }).catch((err) => {
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err), label: err.label || '' }, null, 2))
    process.exit(1)
  })
}

module.exports = { runScvWindowRecoveryHarness }
