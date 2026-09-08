# Claude Code Handoff — SCV Instagram DM Missed Inbound Audit / Recovery

## Source of truth
Repo:
`/Users/effacermonexistencecodex/Code/omar-migration/omar-os1`

SCV executable dir:
`/Users/effacermonexistencecodex/Code/omar-migration/omar-os1/codex_vault/restored_materials/SCV_INSTAGRAM_AUTOMATION_LONG_IDEA_RECOVERY_LOCK_V42_2026-06-21/files`

Railway:
- project: `58160ba5-dff6-45f5-8f53-599cbaf180e0`
- environment: `production`
- service: `scv-dm-cloud-survival`
- URL: `https://scv-dm-cloud-survival-production.up.railway.app`

Current live health as of 2026-06-23:
- contract harness: `scv-contract-harness-lock-2026-06-21-v47`
- delivery pacing: `scv-delivery-pacing-lock-2026-06-16-v5`
- hard harness: `scv-hard-harness-lock-2026-06-23-v18`

Latest commits:
- `8a32194 Make SCV deposit handoff atomic`
- `06d4f25 Lock SCV outbox bubble send order`
- `126cbf0 Set SCV model rate to 150`
- `a83e603 Hard lock booking double-check format`
- `58b914a Fix double-check confirmation deposit handoff`

## Ben's live complaint
Ben is not asking for more prompt polish. He is saying the system still misses too many inbound DMs and he has to manually respond.

Core failure object:
`Every real inbound must produce exactly one of: visible DM send, explicit quarantine with reason, explicit human-agent-required handoff, or retry-with-reason. No silent loss.`

Do not treat this as a personality/tone issue first. Treat it as an end-to-end reliability audit.

## Known recent fixes already done
1. Double-check format hard lock:
   - Name / phone number / appointment date / time must be one field per line.
   - File: `codex-dm-runner.js`
   - Harness: `scv-contract-harness.js`, `scv-critical-route-harness.js`, `scv-runner-semantic-repair-harness.js`

2. Double-check confirmation → deposit handoff:
   - User confirms with yes / ok / perfect / correct / this correct etc.
   - Must immediately send deposit details.
   - Commit: `58b914a`, then strengthened in `a83e603`.

3. Rate policy:
   - Model discounted rate is now `150 per hour`.
   - Do not mention price unless explicitly asked.
   - Commit: `126cbf0`.

4. Omar.system fast-test ordering:
   - Zero-delay bubbles could send out of order due same `due_at` and filename sorting.
   - Fixed by sorting same message by `bubble_index`.
   - Commit: `06d4f25`.

5. Deposit handoff atomicity:
   - Deposit handoff has atomic flag.
   - Atomic deposit packet bypasses stale gate so final CTA does not get dropped if a newer inbound appears before later bubbles.
   - Commit: `8a32194`.

## Still unresolved / handoff objective
Build a real missed-inbound audit and recovery layer.

Ben's reported examples from thread:
- Carlos Lopez Meza: asked `is there any cost?` / asked location and got no answer at times.
- KAHBRANM12: user replied but no answer.
- People sharing posts/images/reels only: sometimes no reply.
- First tattoo tolerance / bigger shoulder message: no reply.
- Heart reaction users like SRTA.AVALOS: no reply.
- ALLIE / DONOVAN / BABY BOY examples: inbound text existed but no outbound visible response.

These may be caused by multiple layers, so do not patch one symptom and claim stable.

## Required debug route
Trace exact path for every missed case:

Instagram DM
→ ManyChat External Request
→ `inbound-scv.js`
→ inbox JSON write
→ `inbox-worker.js`
→ `dm-authority.js`
→ `codex-dm-runner.js`
→ packet returned
→ `outbound-scv1.js`
→ outbox JSON queued
→ `outbox-worker.js`
→ `outbound-scv2.js`
→ ManyChat sendContent
→ Instagram visible DM

Use executed path only. Do not infer success from health endpoint.

## Immediate tasks for Claude

### Task 1 — Create missed-inbound ledger
Add a durable ledger under `logs/` that records for each inbound `contact_id/message_id`:
- inbound received
- inbox file path
- worker picked
- runner returned packet or failed
- 3101 queued or failed
- each outbox bubble created
- each bubble sent / quarantined / stale / duplicate / failed / human-agent
- final disposition: `sent_all`, `sent_partial`, `quarantined`, `deadletter`, `human_agent_required`, `retry_pending`, `silent_missing`

The ledger must allow a single command to list all unresolved inbound messages.

### Task 2 — Add watchdog for unresolved inbound
Add a watchdog or harness that scans:
- `logs/inbound-raw.ndjson`
- `thread-state/`
- `thread-history/`
- `inbox/`, `outbox/`, quarantine dirs, failed dirs
- delivery receipts

It must detect any inbound where the user message exists but no assistant reply/delivery/quarantine exists after a threshold.

Output must be actionable:
- contact_id
- instagram_username
- message_id
- inbound text preview
- last known layer
- recommended recovery action

### Task 3 — Recovery action, not just report
For unresolved real inbounds, either:
- enqueue recovery inbox item, or
- write `outbox_human_agent_required` with exact reason.

Do not silently drop.

### Task 4 — Harnesses
Add tests proving:
1. inbound with pricing question cannot end without visible answer/quarantine.
2. inbound with media/reference-only cannot end silent.
3. heart reaction inbound cannot end silent.
4. long/awkward text cannot end silent.
5. runner failure creates retry/deadletter, not silence.
6. ManyChat 24h human-agent requirement writes human-agent handoff, not silence.
7. stale/duplicate skip is recorded in ledger, not invisible.
8. atomic deposit handoff sends all deposit bubbles or records failure.

### Task 5 — Do not break existing locks
Run full verification:
```bash
cd /Users/effacermonexistencecodex/Code/omar-migration/omar-os1/codex_vault/restored_materials/SCV_INSTAGRAM_AUTOMATION_LONG_IDEA_RECOVERY_LOCK_V42_2026-06-21/files
npm run test
node scv-contract-harness.js
node scv-critical-route-harness.js
node scv-hard-harness-lock.js
node scv-outbox-order-harness.js
node scv-runner-semantic-repair-harness.js
curl -fsS https://scv-dm-cloud-survival-production.up.railway.app/health | python3 -m json.tool
```

## Non-negotiable product rules
- Every real inbound gets a reply or an explicit recorded reason it did not.
- Lua must be the last visible speaker for normal inbound unless suppressed/human-agent/quarantine is explicit.
- Middleware is transport-only; semantic authorship stays in runner/authority layer.
- No secrets printed or committed.
- Do not merge WML or robotics branches into Omar main.
- Do not claim STABLE_READY without visible Instagram DM receipt.
- Omar.system is fast-test target and delay should remain zero for tests.
- General accounts keep 20–60 minute initial delay and length-based bubble gaps.

## What not to do
- Do not only edit the prompt.
- Do not say “health ok” as proof.
- Do not treat ManyChat API accepted as visible Instagram confirmation.
- Do not hide missed messages in deadletter without a readable recovery report.
- Do not loosen harnesses to pass.

## Expected final deliverable
1. Code changes implementing ledger/watchdog/recovery.
2. New harnesses proving no silent loss.
3. `npm run test` pass.
4. Live deploy.
5. Live health + startup self-test proof.
6. A command Ben can run to see unresolved messages.
7. Clear statement of whether there are currently unresolved missed inbounds.
