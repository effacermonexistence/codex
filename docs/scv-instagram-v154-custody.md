# SCV Instagram v154 custody record (2026-09-06)

Third fix of the owner's experiment round, root-caused from the production log of his v153 red-team.
Branched from the sealed v153, gold-guarded against v153, reversible to the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260906-v154` |
| content fingerprint | `b02f81a2d09b4a19497f2ea52082d84d839a941bcc2d8dec77e8ebcd05afb3eb` |
| release manifest sha256 | `fb4ad84d8ffa6389b2822c4b80f7e9028e21fed7de3dc023f98a4383565b84a7` |
| base | `scv-instagram-single-20260905-v153` (production since 2026-09-05 23:03Z) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `b4e4a98b-29ec-49e8-80a2-ceb3525c45e7` |
| production deployment | `ab7e5cb9-9ce2-464e-8102-0b59151c76ca` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260906T033000Z/v154/scv-instagram-single-20260906T033000Z-v154-model-words-ship-and-no-repeated-line.tar.gz` sha256 `bc52c5f5db69c429c13996e9052c23f46c7118a18c2d44a1f3111ba677d5c288` (1427995 bytes, readback byte-identical) |

## The incident (production v153, omar.system, 2026-09-06 01:23–01:27Z)

Five turns. His second message was superseded by his third five seconds later and the merged reply jumped to
the form offer. "Sure it's free?" waited 50 s and received the fixed price line; "It's kinda expensive I
thought it's free?" waited 81 s and received the identical line.

From the production log (`railway logs --json`) and the code:

1. Neither "it's free" nor "expensive" matched the price-question recogniser (it knew only auxiliary-first
   shapes such as "is it free"), so no `answer_model_rate` obligation fired and the tattoo lane demanded
   forward motion from the reply.
2. The model answered the price and appended a size/placement question; the stripper deleted the question and
   the non-authoring guard rejected the whole draft as not model-authored. Every re-author repeated the
   pattern (two, then three passes).
3. After the budget the deterministic price recovery line went out; it had one wording, so the second failure
   sent the same sentence again, and nothing prevented a line already sent from being accepted.
4. The fixed info answer could swallow a message of the client's that arrived after our last reply and was never answered.

## What v154 changes

- Price questions include the tattoo/spot as subject ("it's free?", "this is free", "I thought it was free")
  and cost concern ("expensive", "pricey", "afford"); "feel free", "free time/slot" and availability ("are you
  free tomorrow") are not (contract-harness lock v121).
- A price or exact-address answer the live turn demanded is forward motion for the design/tattoo/social lead
  floor (contract v81).
- A draft whose only deterministic mutations are pure deletions keeps the model's remaining words and passes
  through the normal verifiers instead of being sent back for re-authoring (runner).
- A client-visible line already sent in this thread is never accepted again in the conversational lanes
  (control-plane repeat gate); booking-state structures (checkpoint block, form link, deposit handoff/hold,
  form-permission clarification, post-form date/time/identity asks) re-ask the same required field by design
  and are exempt; the price recovery line rotates over three fact-identical variants and skips what the
  thread already heard (route-aware recovery v9).
- The fixed info fast path yields to the model when a message of theirs arrived after our last reply attempt and is still unanswered (turns already followed by a reply, delivered or attempted, do not count).

Files: `codex-dm-runner.js`, `scv-contract-harness.js` (lock v121), `scv-closed-transition-contract.js` (v81),
`scv-hard-harness-lock.js` (v168), `scv-deterministic-recovery.js` (v9), `scv-single-control-plane.js`,
`scv-double-check-divergence-harness.js` (v14), `SCV_DESIGN_INTENT_LOCK.md`. No prompt, policy, schema, model or
April-tone file changed.

## Verification

- Gold guard against the sealed v153 (`gold-v154/gate/scv-gold-guard.sh`, baseline materialized from the
  hash-verified R2 readback of the v153 runtime, sha `1abd1569…`): every changed file declared in
  `change-card-v154.json` (8 files), no undeclared, locked or removed file; `problems: []`.
- Divergence harness v14: 389/389 (v154 checks: price-question boundaries, the free-question price obligation,
  surgical-deletion shipping vs missing-content re-author, rotating price recovery, fast-path yield only to a
  client turn since our last reply, the repeat gate end to end and its lane boundary).
- Golden conversation replays on the candidate: gold-a 16/17 exact, gold-b 6/7 exact; the two divergences are the
  v152-inherited "yes 3pm works" turns declared in the change card; no unexpected divergence.
- Full local suite, run step by step because the sandbox cannot bind ports: 81 steps on the sealed tree, 75 ok, 0 real failures, 6 failures only from the sandbox port-binding EPERM harnesses (`single-control-transport`, `final-sender-payload`, `outbox-adoption`, `inbound-post-share`, `heart-reaction-inbound`, `inbox-transport-timeout`; identical on the untouched v153). The first pass had
  failed `test:executed-path` / `test:executed-path-gate` (the repeat gate refused the fixed post-form identity
  re-ask after a third party's phone number); the gate was scoped to the conversational lanes and both pass.
- `test:single-release` split on the sealed tree: 20/22 ok, the 2 failures are the sandbox port-binding EPERM
  harnesses (`outbox-strict-marker-gate`, `outbox-adoption`); the seal fingerprint is unchanged after the tests.
- Startup gate (`scv-executed-path-startup-gate-harness.js`) passes on the sealed code, so the runtime's own
  executed-path self-test will not fail-close on deploy.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.

## Hand-over reset

Fresh Omar.system reset on production deployment `ab7e5cb9-9ce2-464e-8102-0b59151c76ca` after the v154 deploy: post-reset snapshot `20260906T033223Z` (sha `cc1e00e93fef6ab874936b53c22282a0918901920931b626cf3eac322e50362b`), pre-reset snapshot `20260906T033218Z` (sha `dda53b5a563248f43690209bebdbc77c34d7bd47ae604ab20fa8aa018368f326`), receipt sha `ae6636ebc13496fdffefd6eb5025ece46835ef25def814cf092fa721396e9c2b`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260906T033223Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v17 (Worker version `92164591-dbf7-474e-bd89-948bc05a3692`) pins the running release v154 separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `2026-09-06T03:40:54.000Z`.
