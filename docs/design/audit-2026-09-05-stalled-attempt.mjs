// Read-only forensic baseline. Confirms the incident, NOT that the product is fixed.
// No network, model call, customer-state mutation, credential read, or raw reasoning output.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const root = '/Users/lua/Library/Application Support/OS-1';
const executionID = '3bf49a99-843d-4def-90a2-65d4ace5e159';
const sessionID = '6199FAA7-5C53-4D9A-8D07-A01D44DFEDFA';
const codexPath = '/Users/lua/.codex/sessions/2026/09/05/rollout-2026-09-05T18-25-14-01a07451-d17a-7291-8927-59a5d7dc6699.jsonl';
const claudePath = '/Users/lua/.claude/projects/-Users-lua/1a1a9e2e-2057-435a-9acd-9c8494b5d129.jsonl';
const ledgerPath = root + '/completion-feedback/5ffe9faab96542b3b2f09ebecd4dae8b092e9145c686a449898ee56de2b99a38.json';
const json = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const jsonl = path => fs.readFileSync(path, 'utf8').trim().split('\n').map(JSON.parse);
const digest = path => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const before = digest(root + '/sessions.json');
const store = json(root + '/sessions.json');
const session = store.sessions.find(s => s.id === sessionID);
assert.ok(session);
const user = session.messages.find(m => m.role === 'user');
const terminal = session.messages.find(m => m.role === 'system');
assert.ok(user && terminal);
const codex = jsonl(codexPath);
const failed = codex.find(r => r.payload?.type === 'task_complete' && r.payload?.error);
assert.equal(failed.payload.error.codex_error_info, 'usage_limit_exceeded');
const ledger = json(ledgerPath);
assert.ok(ledger.observations.every(o => o.execution_id === executionID));
assert.equal(ledger.observations[0].outcome, 'quality_failure');
assert.equal(ledger.observations[1].outcome, 'verification_unavailable');
const claude = jsonl(claudePath);
const messages = claude.filter(r => r.type === 'assistant');
const publicText = messages.flatMap(r => (r.message?.content || [])
  .filter(b => b.type === 'text').map(b => ({ time: r.timestamp, text: b.text })));
assert.equal(publicText.length, 2);
assert.equal(session.messages.filter(m => m.role === 'assistant').length, 0);
const usageByMessage = new Map();
for (const row of messages) {
  if (row.message?.usage) usageByMessage.set(row.message.id, row.message.usage);
}
assert.equal(usageByMessage.size, 17);
const totals = { uncachedInput: 0, cacheCreationInput: 0, cacheReadInput: 0, output: 0 };
for (const usage of usageByMessage.values()) {
  totals.uncachedInput += usage.input_tokens || 0;
  totals.cacheCreationInput += usage.cache_creation_input_tokens || 0;
  totals.cacheReadInput += usage.cache_read_input_tokens || 0;
  totals.output += usage.output_tokens || 0;
}
const totalInput = totals.uncachedInput + totals.cacheCreationInput + totals.cacheReadInput;
assert.equal(totalInput, ledger.observations[1].input_tokens);
assert.equal(totals.output, ledger.observations[1].output_tokens);
const tools = messages.flatMap(r => (r.message?.content || []).filter(b => b.type === 'tool_use'));
const counts = tools.reduce((a, b) => (a[b.name] = (a[b.name] || 0) + 1, a), {});
assert.equal(tools.length, 27);
const timeouts = claude.filter(r => (r.message?.content || []).some?.(b =>
  b.type === 'tool_result' && b.is_error && typeof b.content === 'string' &&
  b.content.includes('timed out after 20 seconds')));
assert.equal(timeouts.length, 1);
const config = json('/Users/lua/Applications/OS-1 CLODEX.app/Contents/Resources/config.json');
const localGateway = json(new URL('../../products/os1-route-core/wrangler.jsonc', import.meta.url));
const ticketSeconds = Number(localGateway.vars.TICKET_TTL_SECONDS);
assert.equal(ticketSeconds, 300);
assert.equal(config.execution_timeout_seconds, 1800);
assert.ok(ledger.observations[1].duration_ms > ticketSeconds * 1000);
assert.equal(before, digest(root + '/sessions.json'));
console.log(JSON.stringify({
  kind: 'confirmed_failure_baseline_not_product_acceptance',
  sessionID, executionID, sessionCount: store.sessions.length,
  latencyMs: Math.round((terminal.timestamp - user.timestamp) * 1000),
  firstNativePublicTextAt: publicText[0].time,
  finalNativePublicTextAt: publicText.at(-1).time,
  finalNativeTextCharacters: publicText.at(-1).text.length,
  displayedAssistantMessages: 0,
  providerFailure: failed.payload.error.codex_error_info,
  incorrectlyRecordedOutcome: ledger.observations[0].outcome,
  finalDisposition: ledger.observations[1].outcome,
  claudeDurationMs: ledger.observations[1].duration_ms,
  installedRuntimeTimeoutSeconds: config.execution_timeout_seconds,
  checkedInTicketTTLSeconds: ticketSeconds,
  liveTicketTTL: 'separately verified via Wrangler versions view; not queried by this script',
  originalHTTPError: 'not retained; unknown',
  uniqueUsageMessages: usageByMessage.size, usage: totals, totalInput,
  toolCounts: counts, globTimeouts: timeouts.length,
  billedCost: null, sessionStateUnchanged: true,
  evidenceHashes: { codex: digest(codexPath), claude: digest(claudePath), ledger: digest(ledgerPath) }
}, null, 2));
