# SCV Instagram v158 custody record (2026-09-07)

Seventh fix of the owner's experiment round, root-caused from the production debug ledger of his v157 red-team
(investigation handed over by Codex). Branched from the sealed v157, gold-guarded against v157, reversible to
the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260907-v158` |
| content fingerprint | `920a6c0ccb392dbc5639f52794c1399ec1e40ddfe8bd2474fe20f8ff1dddc675` |
| release manifest sha256 | `6dda6f228355c39fe08cbed15f3413aa3babf062f0d0ba463ed0520d1999e52c` |
| base | `scv-instagram-single-20260906-v157` (production since 2026-09-06 23:2xZ) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `525f9928-e5a1-4597-b4cc-06af5bac4ffd` |
| production deployment | `d698a44b-b0b7-442d-aba4-b4f46c43e291` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260907T040941Z/v158/scv-instagram-single-20260907T040941Z-v158-compound-form-consent-and-price.tar.gz` sha256 `1a577ff0284364421812ca80548a4d8fff45dcd186cddeaa8f48ea09539bac2a` (1444706 bytes, readback byte-identical) |

## The incident (production v157, omar.system, 2026-09-07 01:15Z)

After "want me to send the application form?" the client wrote "Yeah, sure is it free?" — consent to the form
and a price question in one turn. The reply, 52 s later, was the price line alone; no form link. The private
debug ledger shows the controller planned `tattoo_continue` with `answer_model_rate`, the runner treated the
turn as form consent, two drafts died between the layers
(`after_reauthor_non_authoring_guard_requires_model_reauthor`,
`after_reauthor_form_link_missing_consent_source`), and the route-aware recovery emitted the rate alone.

Root cause: the shared compound-consent predicate judged the price half with a private regex that did not know
"free", while the runner's copy used the shared price detector; the two layers disagreed on the same text.
`explicitFormConsentText` also dropped any consent carrying a question mark, so a compound consent read back
from history did not survive a follow-up turn.

## What v158 changes

- One shared predicate judges compound consent in both layers (strong consent words + the shared direct-price
  detector; negation, conditional and questioning consent excluded; the declarative "Sure it's free?" is
  doubt, not consent). The runner imports it (contract-harness lock v125).
- A price question that merely mentions the form ("Is the application form free?") is neither consent nor a
  link request. A compound consent read back from history stays explicit consent until the link is sent or a
  withdrawal arrives.
- The `send_form` plan carries the price obligation (`answer_model_rate`, or `acknowledge_rate_already_given`
  after disclosure): the reply must carry the link exactly once, the availability ask and the price answer;
  price-only and link-only drafts are rejected. The repair lock says so (contract v84). Deterministic send-form
  recovery already answered the price with the link; unchanged.

Files: `scv-contract-harness.js` (lock v125), `codex-dm-runner.js`, `scv-closed-transition-contract.js` (v84),
`scv-hard-harness-lock.js` (v172), `scv-double-check-divergence-harness.js` (v18), `SCV_DESIGN_INTENT_LOCK.md`.
No policy, schema, model or April-tone file changed.

## Verification

- Gold guard against the sealed v157 (`gold-v158/gate/scv-gold-guard.sh`, baseline materialized from the
  hash-verified R2 readback of the v157 runtime, sha `d74cb331…`): every changed file declared in
  `change-card-v158.json` (6 files), no undeclared, locked or removed file; `problems: []`.
- The exact production turn reproduced on the sealed v157 before the patch (Codex's `verify-compound.cjs`:
  10/31 on v157) and fixed on v158 (31/31): runner and controller agree on compound consent; the plan is
  `send_form` with `answer_model_rate`; price-only and link-only drafts are rejected; the link appears exactly
  once; the deterministic send-form recovery satisfies both obligations; prior compound consent survives an
  unanswered follow-up until the link is sent; a withdrawal cancels it; an already-sent link is never repeated.
- Divergence harness v18 (410/410) replays the turn through the control plane: `send_form` + `answer_model_rate`,
  the price-only reply rejected, link + price + availability shipped, `form_link_sent` and
  `known_model_rate_disclosed` latched; consent boundaries ("Is it free?", "Are you sure it is free?",
  "Is the application form free?", "sure if it is free", "ok but how much is it?", "not yet, is it free?",
  "Sure it's free?" are not consent). Contract self-test 344 checks.
- v157's rate memory preserved: Codex's `verify-price-once.cjs` 21/21 on v158; the responses-required
  hard harness run (`SCV_OPENAI_RESPONSES_REQUIRED=1`) 109 checks ok.
- Golden conversation replays on the candidate: gold-a 16/17 exact, gold-b 6/7 exact; the two divergences are the
  v152-inherited "yes 3pm works" turns declared in the change card; no unexpected divergence.
- Full local suite, run step by step because the sandbox cannot bind ports: 81 steps on the sealed tree, 75 ok, 0 real failures, 6 failures only from the sandbox port-binding EPERM harnesses (`single-control-transport`, `final-sender-payload`, `outbox-adoption`, `inbound-post-share`, `heart-reaction-inbound`, `inbox-transport-timeout`; identical on the untouched v157).
- `test:single-release` split on the sealed tree: 20/22 ok, the 2 failures are the sandbox port-binding EPERM
  harnesses (`outbox-strict-marker-gate`, `outbox-adoption`); the seal fingerprint is unchanged after the tests.
- Startup gate (`scv-executed-path-startup-gate-harness.js`) passes on the sealed code.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.

## Hand-over reset

Fresh Omar.system reset on production deployment `d698a44b-b0b7-442d-aba4-b4f46c43e291` after the v158 deploy: post-reset snapshot `20260907T041303Z` (sha `12d354cda1a8a516268cf2d4305ef5c81f74db99edf201e46e3343e1c7474b6f`), pre-reset snapshot `20260907T041257Z` (sha `c5b6786913404cc1d5072a702704f5ecb0c49ada1119469adc1fb79c77e49ae1`), receipt sha `363b8756dc427ff456a93f7508d3d10e863f3c8c8cde1d8074296b3306f1f61f`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260907T041303Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v21 (Worker version `69bd0874-2bd7-4625-9b1e-0a979afe7bab`) pins the running release v158 separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `2026-09-07T04:15:14.000Z`.
