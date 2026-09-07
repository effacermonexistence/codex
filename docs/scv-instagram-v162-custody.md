# SCV Instagram v162 custody record (2026-09-07)

Eleventh fix of the owner's experiment round. Root-caused from production logs and fixed by Claude. Branched from
the sealed v161, gold-guarded against v161, reversible to the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260907-v162` |
| content fingerprint | `e89c0c5a1f4876f6ce1d0e9166295ac161f5bf55b750d7d5d97a24900f71ae20` |
| release manifest sha256 | `fd12d15c9734d51639081b34e09b2b86126048ae9825cc6a21e28e66a6608e8f` |
| base | `scv-instagram-single-20260907-v161` (production 2026-09-07 20:15Z–2026-09-07 22:20Z; its own record is `scv-instagram-v161-custody.md`) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `e5d8bc97-c1b5-4419-b011-8d6e868cc7d5` |
| production deployment | `d3e2a5dc-10bd-4511-ba8d-9689265dfcde` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260907T223350Z/v162/scv-instagram-single-20260907T223350Z-v162-budget-objection.tar.gz` sha256 `ef803695b4f2fccbb50835272a18fff293d3086a4ea945fcd963729078f5263a` (1469638 bytes, readback byte-identical) |

## The incidents (production v161, omar.system, 2026-09-07 21:15Z and 21:18Z)

1. After the form link and a Gmail-matched submission, "How much is it by the way?" (first price question of the
   thread) was answered with the post-form recovery line "Got it, I have your form. What day would you like me to
   check?" — no price. The model lane had failed and the route-aware recovery for the post-form availability lane
   did not carry the first price answer; the rate only arrived one turn later through the pending-question rule.
2. "I thought it's free though. My budget is tight." was answered with "I get it. It's still the model rate I
   mentioned earlier and nothing's changed." + "if you want a weekend spot, September 9th or 20th at 2pm are open".
   Owner law: a cost objection is not a booking turn. Keep them as a potential client: warm acknowledgement, ask
   what budget they are working with, say the model spots / this rate are limited and only open right now, and
   shape the piece around their number later. No amount, no discount, no dates.

## Root cause (reproduced locally on the sealed v161)

- `routeAwareRecoveryText` honoured `acknowledge_rate_already_given` but not `answer_model_rate`; the post-form
  availability core line shipped without the first price answer whenever the model lane was exhausted.
- The budget turn derived `post_form_availability` (the form was submitted and no date existed), whose contract
  demands a grounded availability move — so the verifier forced the slot push. The v156 law ("acknowledge without
  numbers, then continue the current step") had no objection lane at all.

## What v162 changes

- Contract-harness lock v128: `textExpressesBudgetObjection` (cost concern, "thought it was free / cheaper",
  "can't afford", "too expensive", "out of my budget"), `packetAsksBudget`, `packetFramesLimitedAvailability`,
  `packetPushesBookingSlot`, `packetOffersDiscountOrDeal`, `packetAcknowledgesBudgetFit`, `textStatesBudgetAmount`;
  rules `budget_objection_cannot_push_booking`, `budget_objection_requires_budget_question`,
  `budget_objection_requires_limited_spot_framing`, `stated_budget_cannot_trigger_discount`,
  `stated_budget_requires_fit_acknowledgement`. Price rules keep owning any number (memory answer, once per thread).
  A money-shaped number answering the studio's budget question is never read as a size.
- Closed-transition contract v85: action `budget_objection_hold` (`cost_objection_holds_booking_motion`) ahead of
  every post-form availability branch; its contract forbids form offers, discounts and slot pushes and requires the
  budget question plus the limited-spot framing; a stated budget carries `acknowledge_budget_fit`; the liveness floor
  never falls open on the hold.
- Route-aware recovery v14: the first price answer travels with every route; `BUDGET_OBJECTION_LINES` for the hold;
  a budget-fit prefix when the client has named a number.
- Runner: the cost-objection law and the hold's obligations; the disclosed-rate route lock no longer continues the
  booking step on an objection.
- Boundaries preserved: a direct price question still gets the price once and later the memory answer; a client who
  names a day keeps the booking branches; the rate is never lowered or discounted.

Files: `scv-contract-harness.js` (lock v128, self-test 374), `scv-closed-transition-contract.js` (v85),
`scv-deterministic-recovery.js` (route-aware recovery v14), `codex-dm-runner.js`, `scv-single-control-plane.js`,
`scv-double-check-divergence-harness.js` (v22), `scv-hard-harness-lock.js` (v176), `SCV_DESIGN_INTENT_LOCK.md`.
No policy, schema, model pin, April-tone file or the $150 rate itself changed.

## Verification

- Gold guard against the sealed v161 (`gold-v162/gate/scv-gold-guard.sh`, baseline materialized from the sha-verified
  sealed v161 package, sha `589cdda1…`; v161's R2 upload was still pending when v162 was cut): every changed file
  declared in `change-card-v162.json` (8 files), no undeclared, added, locked or removed file; `problems: []`.
- Contract self-test 374 checks (11 new): the objection detector and its boundaries, the budget-amount detector, the
  production reply (memory line + weekend slots) rejected as a booking push, the budget question without the limited
  framing rejected, a discount rejected, the compliant reply valid, a stated budget without the fit line rejected, a
  discount on a stated budget rejected, the fitted reply valid; the v156/v157 budget expectations now follow the
  v162 law (no date push on a budget remark).
- Divergence harness v22 (445/445) including the executed paths: the v156 budget turn routes to the hold and the
  compliant second draft ships; "I thought it's free though" after the disclosure routes to the hold with the memory
  obligation and the memory answer + budget question ships; the post-form first price question carries
  `answer_model_rate` and its recovery line now states the rate before the date ask; the exact production reply is
  rejected on both contracts; the stated budget resumes the step with the fit obligation and never a discount; a
  client-named day keeps the booking branch.
- Closed-transition harness 10010 checks; hard harness lock v176, 121 checks in both modes
  (`SCV_OPENAI_RESPONSES_REQUIRED=1` included).
- Regressions preserved: Codex's `verify-compound.cjs` 31/31 and `verify-price-once.cjs` 21/21 on v162; voice
  continuity harness (v160) and the nominated-reference checks (v161) still green.
- Golden conversation replays on the candidate: gold-a 16/17 exact, gold-b 6/7 exact; the divergences are the v152-inherited "yes 3pm works"
  turns declared in the change card; no unexpected divergence.
- Full local suite on the sealed tree: 81 stages, 75 passed and 6 blocked only by sandbox port-binding EPERM; no other
  failure; the tree hash is identical before and after, so the seal is unchanged.
- `test:single-release` split on the sealed tree: 20/22 ok, the 2 failures are the sandbox port-binding EPERM
  harnesses (`outbox-strict-marker-gate`, `outbox-adoption`); the seal fingerprint is unchanged after the tests.
- Installed-byte and isolated-suite verification: staging deployment `e5d8bc97-c1b5-4419-b011-8d6e868cc7d5` and production
  deployment `d3e2a5dc-10bd-4511-ba8d-9689265dfcde` each matched all 256 manifest entries, release fingerprint
  `e89c0c5a1f4876f6ce1d0e9166295ac161f5bf55b750d7d5d97a24900f71ae20`, and manifest sha256
  `fd12d15c9734d51639081b34e09b2b86126048ae9825cc6a21e28e66a6608e8f`; `test:single-release` and the full
  `npm test` suite both passed from a fresh isolated copy with an empty environment on each deployment.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched. No signed media URL, recording, customer
  message or credential in this record.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.

## Hand-over reset

Fresh Omar.system reset on production deployment `d3e2a5dc-10bd-4511-ba8d-9689265dfcde` after the v162 deploy: post-reset snapshot `20260907T223835Z` (sha `f457145bf78a4152fd026d7278c281eef7a3274def83365fe0e3226e27bce11e`), pre-reset snapshot `20260907T223829Z` (sha `8d2414beb05d09a0b29b4093cdf098d28e235b0e0cc404ca2bd574c4533af29c`), receipt sha `2aed3080da30670f67af829484acde897ed4e2b6a02dab392890dafd5462d7a2`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260907T223835Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v24 (Worker version `5a2d61df-d933-4db0-aae3-90b83bcda20f`) pins the running release v162 separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `2026-09-07T22:45:01.000Z`.
