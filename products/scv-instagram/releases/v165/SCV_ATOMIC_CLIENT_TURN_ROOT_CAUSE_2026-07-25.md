# SCV Atomic Client Turn Root-Cause Receipt — 2026-07-25

## Locked incident

Omar.system sent two adjacent messages before any assistant reply was delivered:

1. `1784990480493` at `2026-07-25T14:41:20.493Z` — `OK, send it over`
2. `1784990492225` at `2026-07-25T14:41:32.225Z` — `By the way, is is it free?`

The preceding assistant packet had offered the application form. The required single assistant turn therefore had two simultaneous obligations:

- fulfill the accepted form offer by sending `https://www.effacermonexistence.com/apply` and the availability continuation;
- answer the direct price question with the locked model-rate facts.

No assistant reply was emitted.

## Executed-path trace

- The first message entered `/app/inbox/1784990480493.json` and was picked by the inbox worker.
- The second message arrived before the first turn committed.
- Latest-ingress arbitration rejected the first file with:
  `single_control_nonlatest_inbound_rejected:1784990480493:1784990492225`.
- The first file moved to `/app/inbox_quarantine_superseded/1784990480493.json`.
- The controller routed the remaining latest message from its text alone as ordinary tattoo continuation plus a price question.
- The runner and post-filter still saw the prior unanswered form consent in recent history and required form-link fulfillment.
- Candidate generation repeatedly failed with `pending_form_link_fulfillment_reauthor_required`, including `pending_form_link_missing` and, in some attempts, `pending_form_availability_tail_missing`.
- The message was requeued repeatedly as `persistent_internal_control`.
- The failure occurred before outbox creation and before any ManyChat `sendContent` call.

## Multi-perspective causal audit

| Perspective | Finding | Verdict |
|---|---|---|
| Ingress ordering | Latest-only arbitration superseded the consent packet before semantic adoption. | Causal |
| Atomic-turn timing | Adjacent unanswered user messages were coalesced after route selection instead of before all semantic decisions. | Causal |
| Transaction provenance | Direct client consent remained in history, but the controller required consent in latest text only. | Causal |
| Router/verifier consistency | Controller selected no-form continuation while the downstream verifier required form fulfillment. | Causal |
| Retry/adoption | Retry reused the same contradictory route and could not reduce the broken layer. | Amplifier |
| Provider/model transport | Candidate output was rejected locally before outbound transport. | Ruled out |
| ManyChat delivery | No outbox payload reached ManyChat for this incident. | Ruled out |
| Delay/pacing | The turn failed in semantic adoption, not a due-time gate. | Ruled out |
| Stale state | The form-offer state was correctly present as `awaiting_form_permission_answer`. | Ruled out |

### Convergence

The causal views converge on one boundary defect: the controller, runner, verifier, and adoption gate did not share one authoritative representation of the same unanswered human turn.

### Divergence

Provider availability, ManyChat transport, delay settings, and stale booking state do not explain the observed trace and were rejected by executed-path evidence.

### RCC taxonomy

This is a composition/boundary repair, not a new phrase-specific failure family:

`latest-ingress supersession + pre-commit adjacent user messages + split semantic authority + unchanged retry route`

## Structural repair

1. Added one shared `pendingUnansweredUserTurnTexts` extractor for the trailing unanswered user burst.
2. Only a delivered `role === "assistant"` event closes that burst; attempted/rejected/internal receipts do not.
3. Preserved explicit form consent across a newer side question until the form URL is delivered.
4. Added explicit consent-withdrawal handling so `wait`, `not yet`, `never mind`, or a direct stop instruction cancels the pending form obligation.
5. Derived direct side-question obligations over the whole atomic unanswered turn, not only the last physical message.
6. Made controller transition planning, runner enforcement, verifier expectations, and final adoption consume the same shared authority helpers.
7. Kept visible wording model-authored; the repair changes semantic authority and obligations, not conversational scripts.

## Regression contract

The harness now covers:

- exact live order: form consent, then price question;
- reverse physical order;
- form link present exactly once;
- price answer required in the same reply;
- missing form link rejected;
- missing price answer rejected;
- explicit withdrawal cancels prior consent;
- attempted assistant output does not falsely close the unanswered human turn.

## Local verification receipt

- Full `npm test`: PASS.
- Closed transition harness: `9922` checks, PASS.
- Single control plane harness: `96` checks, PASS.
- Contract harness: `207` checks, PASS.
- Runner semantic repair harness: `182` checks, PASS.
- Coalescing harness: `19` checks, PASS.
- Golden snapshot guard: `363` checks, PASS.
- Immutable drift firewall: `178` checks, PASS.
- Snapshot isolation harness: `123` checks, PASS.
- New contract version: `scv-closed-transition-contract-2026-07-25-v49-atomic-client-turn-authority`.
- New hard harness version: `scv-hard-harness-lock-2026-07-25-v113-atomic-client-turn-authority`.
- New manifest SHA-256: `a719a800386b3c9781f5162b525db99569ddaf0cc8bf13f61233a0bd6b56f03c`.
- New immutable seal SHA-256: `e0f9df33fdbe9999687aed08e17fc56ddd9638d62486828f604db76ce9b88ce9`.

## Proof boundary

Local regression proof establishes the repaired semantic path and non-regression floor. Production completion still requires the deployed version to process the queued Omar.system turn through control commit, outbox, ManyChat acceptance, and an Instagram-visible receipt. No `STABLE_READY` claim is made from local tests alone.

## Production executed-path receipt

- Git commit: `6f4c2fb9d0e3eeefe48093ed25f1cc0cdd0e83a1`.
- Railway deployment: `83ad0d30-52f6-4d26-8ec3-df9d71886b6c`, status `SUCCESS`.
- Production boot loaded contract `v49`, harness `v51`, hard lock `v113`, manifest `a719a800...`, and seal `e0f9df33...`.
- The preserved queued message `1784990492225` retried under the new build at `2026-07-25T15:07:32.702Z`.
- Route lock changed from the old failing `tattoo_continue` path to `send_form`.
- Control decision committed at `2026-07-25T15:07:50.182Z`.
- Four ordered bubbles entered outbox and received HTTP 200 / ManyChat success acceptance:
  1. model-rate answer;
  2. form handoff transition;
  3. exact application URL;
  4. availability continuation.
- All four outbox idempotency receipts exist; inbox and outbox no longer contain the message.
- Thread state advanced to `awaiting_form_submission`.
- The persistent history records all four assistant bubbles with `manychat_success_unverified`.

### Final boundary

The internal executed path and ManyChat acceptance are proven. The available API marks `delivery_accepted=true` but `delivery_confirmed=false`; the browser session available to Codex was not authenticated to Instagram, so an independent Instagram-visible UI receipt was not established in this run. This is therefore production transport success, not a `STABLE_READY` claim.
