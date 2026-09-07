# SCV Instagram v157 custody record (2026-09-06)

Sixth fix of the owner's experiment round, continued from Claude's v156 incident handoff and independently reproduced in code by Codex.
Branched from the sealed v156, gold-guarded against v156, reversible to the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260906-v157` |
| content fingerprint | `6f4205fb91005b074b69cca4f2da72e353c690235a93d3c87eb4065f878ba9e5` |
| release manifest sha256 | `1311f9577b5feb4ca6cd917dd4fec0e37b74ba9414d240439080d1860de8db4d` |
| base | `scv-instagram-single-20260906-v156` (production since 2026-09-06 21:10Z) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `2c3564c9-cea4-4859-9a43-02fb435cc7e1` |
| production deployment | `1a457c90-3a48-4cba-8e63-17afef1e71b0` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260906T230617Z/v157/scv-instagram-single-20260906T230617Z-v157-price-once.tar.gz` sha256 `d74cb331eac33465c043a5f3f59286c6a7198dda39ce8ef0c1a28e20b7873ad0` (1441639 bytes, readback byte-identical) |

## The incident

During the owner's v156 test, the first direct price question received the correct rate. A later challenge about whether the service was free repeated that amount. The requirement is at most one rate disclosure per thread, with later questions answered from persistent memory. Raw DM logs and customer records are not included in this public record.

The incident sequence is from Claude's handoff; Codex's narrow historical log query did not return those records. Independent source reproduction confirmed that every direct price question created the
`answer_model_rate` obligation and the closed-transition contract enforced the locked rate answer; nothing
remembered that the rate had already been given in the thread.

## What v157 changes

- Thread memory: `known_model_rate_disclosed` is latched on the accepted commit and by verified visible assistant history and persists monotonically as a durable field. Old retained control history (up to 500 events) repairs the flag before the 30-event prompt window is reduced; user quotes or unverified attempted sends do not count.
- Once the rate was given, a later price question — even a direct one — carries
  `acknowledge_rate_already_given` instead of `answer_model_rate`: the reply is answered from memory with no
  number ("nah it's not free — it's the model rate i mentioned earlier, that part stays the same"), then the
  current step continues. A draft that states the rate again is rejected
  (`price_restated_after_disclosure` / `closed_transition_rate_restated_after_disclosure`); a silent reply is
  rejected (`price_follow_up_requires_memory_answer`). The memory answer counts as forward motion.
- The runner pricing floor follows the shared detector and flips after disclosure; deterministic recovery
  answers from memory, including the fixed send-form recovery path. Prompt: PRICE ONCE law, with the old direct-reask exception removed.
- Both gates reject alternative rate spellings, multiple rate mentions in the first packet, and repeated amounts after disclosure. The memory answer must actually refer to the earlier rate; silence, a bare acknowledgement, unrelated checkpoint text, an affirmative "free" claim, or hourly rewording is not sufficient.

Files: `scv-contract-harness.js` (lock v124), `scv-closed-transition-contract.js` (v83),
`scv-deterministic-recovery.js` (v11), `scv-durable-structured-state.js`, `dm-authority.js`,
`codex-dm-runner.js` (pricing floor + prompt), `scv-hard-harness-lock.js` (v171),
`scv-double-check-divergence-harness.js` (v17), `scv-single-control-plane.js`, `SCV_DESIGN_INTENT_LOCK.md`. No policy, schema, model or
April-tone file changed.

## Verification

- Gold guard against the sealed v156 (`gold-v157/gate/scv-gold-guard.sh`, baseline materialized from the
  newly downloaded and hash-verified R2 v156 runtime): every changed file declared in
  `change-card-v157.json` (10 files), no undeclared, locked or removed file; `problems: []`.
- Divergence harness v17 (403/403) replays the production sequence end to end through the control plane: the
  first "How much is it by the way?" gets the rate once; "I thought it's free though" carries
  `acknowledge_rate_already_given` (never `answer_model_rate`); a draft that re-states the rate is rejected
  (`price_restated_after_disclosure` / `closed_transition_rate_restated_after_disclosure`) and the memory
  answer ships; `known_model_rate_disclosed` is latched in the persisted state; the deterministic recovery
  answers from memory without a number. Contract self-test 319 checks.
- Claude's pending multi-agent workflow did not produce an available terminal result before its session limit. Codex read the saved probes and performed the remaining review locally; no unobserved agent result is counted as evidence. Twenty-one additional executable checks pass, covering amount spellings, substantive answers, first-packet duplication, monotonic persistence, legacy history beyond the prompt window, both recovery paths, bad-draft rejection, idempotent committed retries, and first-then-repeat recovery under required server receipt admission.
- Golden conversation replays on the candidate: gold-a 16/17 exact, gold-b 6/7 exact; the two divergences are the
  v152-inherited "yes 3pm works" turns declared in the change card; no unexpected divergence.
- Full local suite: all 81 steps pass on the final source. No permission-error exemptions.
- `test:single-release` on the final sealed tree: all 22 steps pass. All 255 file hashes are checked again while packaging; no permission-error exemptions.
- Startup gate (`scv-executed-path-startup-gate-harness.js`) passes on the sealed code.
- Installed staging tree: all 255 hashes and the exact descriptor verified inside deployment `2c3564c9-cea4-4859-9a43-02fb435cc7e1`. An isolated temporary copy with an empty environment passes both `npm run test:single-release` and `npm test`. No live credentials or customer volume are included in that copy.
- The R2 runtime was extracted into a new temporary directory, all 255 hashes checked, and the 21 additional price-memory checks passed on those recovered bytes. The temporary local copy was removed after verification.

The original Claude seal (`a664b3d8…`) was superseded after reproducing and fixing six boundaries: alternate amount spellings, non-answer acceptance, legacy history truncation, contradictory reask guidance, fixed send-form memory omission, and multiple rate mentions within the first packet. The first staging candidate (`bc20cc26…`, failed deployments `074004b4-6a4c-4634-a62f-b427b0df94b0` and `11816ea0-f776-407d-ad4a-04b73784f642`) then exposed a seventh boundary: latching price memory before the Responses/recovery admission gate mutated the shared verification state and blocked the first price recovery. This was reproduced with `SCV_OPENAI_RESPONSES_REQUIRED=1`, fixed by latching only after admission, and verified by the 109-check startup hard harness in that mode. No gate was weakened. Neither rejected candidate reached production. The original descriptor remains in private evidence. Only the new fingerprint above is approved for this deployment.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.
- Finite adversarial and regression tests are evidence for the listed cases, not a proof for every possible future natural-language input.

## Hand-over reset

Fresh Omar.system reset on production deployment `1a457c90-3a48-4cba-8e63-17afef1e71b0` after the v157 deploy: post-reset snapshot `20260906T232206Z` (sha `93541cb05c8e37fa999287d2de791c3a132086cd089df048774b3e516c8aa93f`), pre-reset snapshot `20260906T232201Z` (sha `410656bfdc62f9839aa8a5023b9414f75d62cd53f9cdbb2a164a1c7c5a1c2cea`), receipt sha `21284409391aa403860e47e0824858929ae54e53b313023d4d58d6a08f6e044a`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260906T232206Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v20 (Worker version `8835c291-a3b2-46fd-adef-f9d777513153`) pins the running release v157 separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `2026-09-06T23:25:03.000Z`.
