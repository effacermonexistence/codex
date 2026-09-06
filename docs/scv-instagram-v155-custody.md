# SCV Instagram v155 custody record (2026-09-06)

Fourth fix of the owner's experiment round, root-caused from the production log of his v154 red-team.
Branched from the sealed v154, gold-guarded against v154, reversible to the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260906-v155` |
| content fingerprint | `50f86ceee3fb96dc333db443d956d6af45ca48360371baad55f77791ef75bde2` |
| release manifest sha256 | `501be9c0c775f0094114c8b72c46dd67e0a2fa6f3bb2d7c5a992d69e439b8f9c` |
| base | `scv-instagram-single-20260906-v154` (production since 2026-09-06 03:32Z) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `eae115c2-957e-4948-ad08-64b8f084c008` |
| production deployment | `4bf22f32-007c-4216-9dc4-d71ca99e2b15` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260906T073301Z/v155/scv-instagram-single-20260906T073301Z-v155-design-before-form.tar.gz` sha256 `158af43a33f248479f077923e9297cd90c221ce3467da9877b2230c85f82f17a` (1433181 bytes, readback byte-identical) |

## The incident (production v154, omar.system, 2026-09-06 04:26Z)

Second turn of a fresh thread, after the fixed info opener: "Do you also do black and gray and or line work".
The reply was "yeah i can do black and gray and line work" followed by "if you want i can send the form", and
the thread state moved to an open form offer. The owner's law: the design — what they want, a subject, an
idea or a reference — is always seen first; the form comes after. A style question is not a design.

From the production log (`railway logs --json`) and the code, reproduced locally on the sealed v154:

1. The anchored capability-question grammar knew neither "line work" nor a list shape ("X and or Y"), so
   the turn was not recognised as a capability question.
2. The design-direction predicate counted "black and gray" alone as a concrete design direction. The
   question was promoted into `known_design_context`, the plan became `offer_form`
   (`design_direction_ready_for_form_offer`) and the accepted packet flipped `form_offer_asked`.
3. The closed-transition contract forbade a form offer only under the `design_intake` plan.

## What v155 changes

- A style / technique word alone (black and gray, line work, fine line, color, realism, blackwork …) is
  never a design direction and never opens the form; a design direction is a subject, an idea, a reference
  or a continuation of existing work (contract-harness lock v122).
- A question whose content is nothing but style terms and glue ("black and gray or color?", "do you do line
  work", "X and or Y") is a capability question: it is answered, then one idea / reference is pulled
  (lock v122; the style vocabulary now includes line work, black and white, gray scale, dot work, micro
  realism, single needle, watercolor and others).
- The form is offered only under the `offer_form` plan and sent only under `send_form`; `tattoo_continue`,
  `social_continue` and `general_continue` packets that offer or send the form are rejected like
  `design_intake` (`closed_transition_form_before_design`, contract v82).
- The deterministic design-intake / tattoo recovery answers a pending capability question first, then pulls
  the idea (route-aware recovery v10).
- Stored design memory is read through one shared reader (strict detector plus legacy style-only statements;
  a stored question or capability text is quarantined) in the contract, the control plane and the runner, so
  threads already past the form keep their booking stage while live promotion stays strict.

Files: `scv-contract-harness.js` (lock v122), `scv-closed-transition-contract.js` (v82),
`scv-deterministic-recovery.js` (v10), `scv-hard-harness-lock.js` (v169),
`scv-double-check-divergence-harness.js` (v15), `scv-single-control-plane.js`, `codex-dm-runner.js`,
`SCV_DESIGN_INTENT_LOCK.md`. No prompt, policy, schema, model or April-tone file changed.

## Verification

- Gold guard against the sealed v154 (`gold-v155/gate/scv-gold-guard.sh`, baseline materialized from the
  hash-verified R2 readback of the v154 runtime, sha `bc52c5f5…`): every changed file declared in
  `change-card-v155.json` (8 files), no undeclared, locked or removed file; `problems: []`.
- Local reproduction on the sealed v154 (fixed info opener, then the production text with a stub generator)
  showed the incident exactly: plan `offer_form`, the question stored as design context, `form_offer_asked`
  flipped. On v155 the same replay plans `design_intake` with the capability obligation, rejects the form
  offer (`closed_transition_form_before_design`), ships the answer plus the idea pull, and leaves no design
  context and no open form offer (divergence harness v15, 394/394).
- Golden conversation replays on the candidate: gold-a 16/17 exact, gold-b 6/7 exact; the two divergences are the
  v152-inherited "yes 3pm works" turns declared in the change card; no unexpected divergence.
- Full local suite, run step by step because the sandbox cannot bind ports: 81 steps on the sealed tree, 75 ok, 0 real failures, 6 failures only from the sandbox port-binding EPERM harnesses (`single-control-transport`, `final-sender-payload`, `outbox-adoption`, `inbound-post-share`, `heart-reaction-inbound`, `inbox-transport-timeout`; identical on the untouched v154).
- `test:single-release` split on the sealed tree: 20/22 ok, the 2 failures are the sandbox port-binding EPERM
  harnesses (`outbox-strict-marker-gate`, `outbox-adoption`); the seal fingerprint is unchanged after the tests.
- Startup gate (`scv-executed-path-startup-gate-harness.js`) passes on the sealed code.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.

## Hand-over reset

Fresh Omar.system reset on production deployment `4bf22f32-007c-4216-9dc4-d71ca99e2b15` after the v155 deploy: post-reset snapshot `20260906T073451Z` (sha `716cb430f8af574dc8a17ff72081e8afecbe51ab8a5d929fe990efa008ef7d65`), pre-reset snapshot `20260906T073445Z` (sha `68db19e17edf23e63ae916a422e57dd1c40f89e58ad347a418b748a7732ded9f`), receipt sha `915b2f08905f34e6b8e4d495a3e1bf7bd815704ed5d526e9d0c580cde65e24b5`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260906T073451Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v18 (Worker version `fde64230-b5b3-499c-b366-66cadfc376dd`) pins the running release v155 separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `2026-09-06T07:35:54.000Z`.
