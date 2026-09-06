# SCV Instagram v156 custody record (2026-09-06)

Fifth fix of the owner's experiment round, root-caused from the production log of his v155 red-team.
Branched from the sealed v155, gold-guarded against v155, reversible to the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260906-v156` |
| content fingerprint | `3e406a8e6a64d203a56d7f7de9aae09875c3d774f66481a39f726ff02dd66032` |
| release manifest sha256 | `b2acb96d3456159246d4f3d0a13724f1225a0e3346fd002589ff7f533a1a277c` |
| base | `scv-instagram-single-20260906-v155` (production since 2026-09-06 07:35Z) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `31d63a95-31cb-4224-8660-8dd7bad400ac` |
| production deployment | `29e15416-d11b-4ccc-8090-4890bcfbada5` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260906T210649Z/v156/scv-instagram-single-20260906T210649Z-v156-price-boundary.tar.gz` sha256 `68f90bf02d436956f5795fe425160b11037342671ee73041f6d6cc0bfdd0abc8` (1436890 bytes, readback byte-identical) |

## The incident (production v155, omar.system, 2026-09-06 15:33–15:36Z)

After the form link: "I'm only available on weekends. Also, is it free?" was answered with the rate (correct,
132-character bubble). The next turn, "So, oops, my budget is tight. How long do you think it's gonna take?",
was answered 110 s later with four bubbles that re-stated the $150 rate. The owner's law: the price is a
boundary, spoken only when directly asked, hidden otherwise, and never repeated once explained.

From the production log (`railway logs --json`) and the code: the price-question detector accepted any
sentence carrying a money word ("budget") and, since v154, cost-concern words ("expensive", "afford"); the
closed-transition contract then made the rate an obligation (`answer_model_rate`) and rejected every draft
without it, so the model had no way to leave the price out.

## What v156 changes

- The price-question detector accepts direct asks only ("how much", "is it free", "what's your rate", "do i
  have to pay", "price?"). Money words, a budget remark, a cost concern or a duration question never open the
  pricing lane (contract-harness lock v123).
- A draft that states the model rate without a direct price question in the live turn or an unanswered
  earlier turn is rejected (`price_disclosed_without_direct_question`), so a rate already explained is never
  restated unasked. The deposit amount is not the rate.
- The runner prompt carries the PRICE BOUNDARY law (acknowledge a cost concern in one warm beat with no
  number, no re-quote, no discount; continue the step) and the DURATION law (a time answer with no money: it
  depends on the piece and is set at the appointment).

Files: `scv-contract-harness.js` (lock v123), `codex-dm-runner.js` (prompt), `scv-hard-harness-lock.js` (v170),
`scv-double-check-divergence-harness.js` (v16), `SCV_DESIGN_INTENT_LOCK.md`. No policy, schema, model or
April-tone file changed; the closed-transition contract stays v82.

## Verification

- Gold guard against the sealed v155 (`gold-v156/gate/scv-gold-guard.sh`, baseline materialized from the
  hash-verified R2 readback of the v155 runtime, sha `158af43a…`): every changed file declared in
  `change-card-v156.json` (5 files), no undeclared, locked or removed file; `problems: []`.
- Divergence harness v16 (398/398) replays the production sequence end to end: the direct "is it free?" turn
  after the form link gets the rate; the budget turn carries no `answer_model_rate` obligation; a draft that
  re-states the rate is rejected (`price_disclosed_without_direct_question`) and the reply without a number
  ships. Contract self-test 313 checks (money words, budget, cost concern and duration never open pricing;
  direct asks including "how much was it again?" still do; the deposit line is not the rate).
- Golden conversation replays on the candidate: gold-a 16/17 exact, gold-b 6/7 exact; the two divergences are the
  v152-inherited "yes 3pm works" turns declared in the change card; no unexpected divergence.
- Full local suite, run step by step because the sandbox cannot bind ports: 81 steps on the sealed tree, 75 ok, 0 real failures, 6 failures only from the sandbox port-binding EPERM harnesses (`single-control-transport`, `final-sender-payload`, `outbox-adoption`, `inbound-post-share`, `heart-reaction-inbound`, `inbox-transport-timeout`; identical on the untouched v155).
- `test:single-release` split on the sealed tree: 20/22 ok, the 2 failures are the sandbox port-binding EPERM
  harnesses (`outbox-strict-marker-gate`, `outbox-adoption`); the seal fingerprint is unchanged after the tests.
- Startup gate (`scv-executed-path-startup-gate-harness.js`) passes on the sealed code.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.

## Hand-over reset

Fresh Omar.system reset on production deployment `29e15416-d11b-4ccc-8090-4890bcfbada5` after the v156 deploy: post-reset snapshot `20260906T211010Z` (sha `d99f34e3b1f8ca0fd82aa818605a20c9a97aa4cd3771e24f029d1de15ed3aa17`), pre-reset snapshot `20260906T211005Z` (sha `334f544e7accd368608d2753a3f0320f35805b3edebc17f08aae7440d682e826`), receipt sha `3e95848e6e4dd966109b8becc91257cb35c01d47a9795191248ebaf332d5992b`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260906T211010Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v19 (Worker version `698c39c6-0220-431d-8548-2a8a45df7f0f`) pins the running release v156 separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `2026-09-06T21:15:03.000Z`.
