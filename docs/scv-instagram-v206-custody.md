# SCV Instagram v206 tattoo-intent authority custody (2026-09-18)

Build-lane release replacing v205. It does not promote Gold, enable customer traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v206` |
| content fingerprint | `79506140d421e1274b1df1a2d9aafc1b5eeb1f50f7177f40d4df7ff4d071630a` |
| release manifest sha256 | `3d4439260496889fc7815ae9dcbf66b4a7150f6797649cb9adec330bd28ae2b4` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260918T052119Z/v206/runtime/scv-instagram-single-20260914-v206-runtime.tar.gz` sha256 `f95c749472c10cc4ba60af9d78ba1dcdd2552c02904835ca6180e05b9696c3f7` (2069073 bytes) |

## Requested change (owner order 2026-09-18)

"tattoo_intent_active를 아무 detector나 직접 켤 수 있게 두면 안 돼 … state transition은 하나의 중앙
reducer만 할 수 있어야 돼 … TOPIC ≠ USER INTENT ≠ SERVICE REFERENT ≠ BOOKING INTENT … 모델의 분류가
state authority가 되면 안 돼 … assistant_tattoo_context != user_tattoo_intent … 이전 에이전트의 진단을
검증된 사실로 취급하지 말고 실제 코드와 실행 기록으로 확인해라."

Reported symptom: after plain chat in which the BOT raised its own drawing work, an English
"When do you have time on weekends?" landed in tattoo consultation / the application form.

## What the logs do and do not establish

The reported conversation is NOT in production thread-history, nor in the pre-reset snapshot taken at
2026-09-18T03:41:11Z. The nearest match (2026-09-16T23:17Z) is different text and routed
`social_continue` correctly. **Which release produced the owner's screenshot remains UNKNOWN.**
Everything below was measured by executing the deployed bytes.

## Executed cause (measured on the deployed v205 bytes)

| probe | result |
| --- | --- |
| clean state + the availability question | `social_continue` |
| durable `tattoo_intent_active` only | `design_intake` |
| durable `known_design_context` only | **`offer_form`** |
| client-authored tattoo intent in history | tattoo lane (correct) |

Availability language alone never created the intent — the owner's English-detector hypothesis is not
supported on these bytes. What reproduces is CONTAMINATED DURABLE STATE, and the two fields each open
the funnel independently. Four structural facts made it permanent:

1. **13 write sites** for `tattoo_intent_active` across three files; no single authority.
2. **Self-reinforcing:** `hasTattooIntentSignal()` is true BECAUSE the flag is set, and the control
   plane writes the flag again from that signal. Nothing re-checked it against a client message.
3. **The classifier was an authority:** `intent.tattoo_intent_active` / `intent.is_tattoo_intent`
   wrote durable state at three sites with no client-authored span required.
4. **The speaker filter was bypassed.** `isConversationVisibleAssistantEvent` is the strict
   DELIVERY-TRUTH predicate (role `assistant`, or a reconciled boundary marker). Production persists
   every assistant turn as `assistant_attempted` and only reconciles it on a later inbound, so an
   unreconciled assistant sentence fell through and was read as CLIENT text in
   `buildStructuredState`. Measured on v205: an assistant-only "drawing a tattoo design for a client
   right now" produced `tattoo_intent_active: true`, and the owner's chat shape produced
   `known_design_context: "What animal and what flower"` — the client's question about the ARTIST's
   drawing stored as the client's brief.

## Change

`scv-tattoo-intent-authority.js` (new) is the single provenance-bound admission: durable tattoo state
requires client-authored evidence and records `source`, `evidence_message_id`, `evidence_span`,
`level`. Scheduling/price/place language inherits only from an existing client-authored referent. A
classifier verdict is a proposal. Assistant-authored context is never client intent. Absence of a
history window is not evidence of absence, so an established customer keeps their lane; nothing is
deleted and no thread is mass-reset. `detectFabricatedWorkReport` additionally refuses an invented
client job, completion deadline or posting promise while leaving the v205 subject improvisation
licensed.

## Executed verification

- Active deployment `91e61c3f-35de-4d91-ae7a-dc48a4e3bc97`; 308 installed sealed-file hashes verified; 30 installed harnesses
- Regression ledger: 126 commands, all rc 0, on the final sealed bytes outside the sandbox
- Deterministic battery on the DEPLOYED v206 bytes: 13 cases, all_ok True — every negative
  (availability after chat-only, after assistant-authored tattoo, Korean surface, both contaminated
  fields, the v205 own-work press) stays plain; every positive (explicit booking, tattoo+scheduling,
  client brief, inherited scheduling, Korean canonicals) enters the funnel
- Real-provider no-send probe on `gpt-5.4-nano-2026-03-17`: 5 cases, 5 author calls,
  0 customer sends, 0 unsolicited form CTAs, 0 invented commitments,
  0 deflections, 0 errors
- Fresh code-locked reset for both debug identities at `2026-09-18T05:21:16.783Z`: residual
  0 to 0, 10 workers paused and resumed, pre/post snapshots restore-drilled
  and R2 custody verified
- Runtime archive readback and cold restore: 308 files, 30 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260918T052119Z/v206/v206-r2-manifest.json` sha256 `88b31320158c7aa329fe9ab60f2c71b887e3f639437bcbdc7b69cf571eceef3f`; 12 evidence objects
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 unchanged

## Known boundaries

inherited_scheduling_after_client_referent: the durable state and its provenance are correct (tattoo_intent_active true, evidence user_inherited, measured 5/5 design_intake on repeat), but when the classifier labels the turn a question latestTurnOwnsStandaloneConversation claims it as social before the tattoo branches. That precedence is pre-existing and untouched by v206.

The release removes the contamination at its sources and refuses to open the funnel on ungrounded
state. It does not rewrite thread state already on disk, and it does not establish which release
produced the owner's screenshot.

## Sentinel alignment

v65/v206 Worker version `60ceed86-fb7c-4397-af87-c1da55b05d28`, first v65 scheduled run `2026-09-18T05:25:19.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-18/20260918T052519000Z.json` sha256 `12b6b1db64ac72fb380671f58746c901dc9fe39bf7011c82142bc02c6ff4f261` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
