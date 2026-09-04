# SCV Instagram GOLD-3 custody record (2026-09-03)

GOLD-3 is the v148 production state: the owner-verified v145 (GOLD-2) plus the one polish item the owner ordered after accepting it (ordinal-word days such as "fifth of September", and the deterministic outside-window date answer before the form match), plus the fixes for the two drifts that the v146 live red-team exposed on production (the date answer must survive the intent classifier; one assistant reply is one double-check object; the executed four-field block persists state whichever executor produced it). It was sealed through the GOLD-2 guard with a declared change card, staging-tested in an isolated container, live red-teamed on the debug identity, and frozen on 2026-09-03. The owner has not yet red-teamed v146 or v148 himself. This record carries identities and hashes only; every artifact lives in the private R2 bucket and the private archives. GOLD-3 supersedes GOLD-2 as the behavioral bar; GOLD-2 stays in R2 as the previous gold.

## What is frozen

| object | identity |
|---|---|
| runtime release | `scv-instagram-single-20260902-v148`, fingerprint `3a9a18631443f4738d13dd803f080979ff4d21ab0d9de1f5054b2f26e2ea3609`, manifest sha `b3e9d7ba794fa9c6cb33a32727cf1870c9af2a2c54a1e191c0321cab9ff0f0ec` |
| runtime artifact in R2 | `scv-instagram-automation/release-ready/20260903T204032Z/v148/scv-instagram-single-20260903T204032Z-v148-acknowledge-and-defer-placement-size-on-the-design-turn.tar.gz` (sha `a8b26655c3418173541cc474f71037d487bb9415f83a63901ffd072ac461aba4`, read back byte-identical) |
| production state snapshot (non-destructive, all workers paused, in-place restore drill) | `scv-instagram-automation/timestamped-snapshots/gold/20260903T205411Z/prod-v148-gold.tar.gz` (sha `9b8fa2605dec31d3709641fc77d529b9febc47b144d827f7ad3eef081224e795`, namespace tree sha `f759274531aa6d8122e3fd4b7c91ae9aa00f4abba0887a976f10b34e547556dc`, `1904` entries, receipt sha `c5eb5a22f3a7203fbec5247fb7dbe1987c8538ab297715b5e1ce4801e9803f95`) |
| clean baseline | R2 control `20260903T205303Z`, current snapshot `scv-instagram-20260903T205146Z-v148-post-omar-reset-current` |
| environment | production variables recorded by name, length and value hash (secret values never stored); model pins unchanged from GOLD-2 (`gpt-5.4-mini-2026-03-17` DM, `gpt-4.1-mini-2025-04-14` intent, vision, ASR) |
| golden conversations | `gold-a-v145-live-red-team.json` (sha `693280cd7f43aabbc97c3af3381b86053cebc535bab5652f6fca96d694d78231`, 17 turns), `gold-b-owner-red-team.json` (sha `5abedc78256df9e263fc9c2eda92b39fb3d90f558502fcccf28579cd1ffeee41`, 7 turns), `gold-c-v148-live-red-team.json` (sha `53ce4ba1f09c7d3978256eb4d8522260429aae85c88ad7ae0fdc46a6c25e9341`, 18 turns) |
| gold manifest | sha `31ea4507381e6ec2c3ce4458d70af4a311f331a4a26651f5d9234a01312766cc` (R2 `scv-instagram-automation/gold/SCV_GOLD_MANIFEST_v148.json`, pointer `scv-instagram-automation/gold/LATEST.json`) |
| sentinel | `scv-instagram-drift-sentinel` v12 (schema `scv-instagram-drift-sentinel-2026-09-03-v12-v148-ordinal-dates-pointer-pointer`) pins the v148 release, the v148 control and the GOLD-3 manifest hash; first attestation `None` ok |

## What changed from GOLD-2

- Booking policy v5: ordinal words first through thirty-first read as calendar days before every calendar scan.
- Closed-transition contract v76: a date answer to the assistant's date ask after the form link is an availability turn before the form match lands; the outside-window decline is the deterministic packet (earliest opening, no model call).
- dm-authority: the contextual calendar-day reply ("can we do the fifth?") also opens after the form link when the assistant's open question is the date, routing to the month clarification instead of a generic model turn.
- dm-authority: the assistant's open date ask after the form link is booking context, so the live date status exists before the form match.
- Closed-transition contract v77: a resolved live calendar proposal outranks the classifier's stand-alone/question flags.
- Runner: the outside-window date decline is authored before the intent classifier (pre-intent deterministic lane).
- Contract-harness lock v119: the four-field double-check detector reads one assistant reply as one object and never fuses bubbles across client turns.
- Control plane: the executed four-field block persists identity and the open checkpoint whichever executor produced it.
- Hard harness lock v163, booking policy harness v10, divergence harness v8 pin all of it.

## Restore drill (staging sandbox)

> Custody note, 2026-09-03: a recoverability audit re-fetched every object the sealed timestamped
> catalog declares. Three objects belonging to two v139 rollback points were absent from R2 (a
> custody run that stopped before its second reset was uploaded); they were re-uploaded from
> byte-identical local copies and read back. A deep verifier now walks all 112 declared objects and
> fails closed on any miss: `112/112 present and hash-exact`. The restore tool's own `verify` only
> hashes the local catalog, which is why the gap survived six control publishes with a green seal.


Inside the staging container (namespace `single-staging-v148`, the same sealed v148 runtime as production): every runtime worker was killed with SIGKILL and the process supervisor revived the full set with new PIDs (9 workers); all workers were then SIGSTOPped, the staging namespace was deleted outright (30 entries gone), the gold archive was delivered from the R2 read-back copy and extracted, and the restored tree hashed to `f759274531aa6d8122e3fd4b7c91ae9aa00f4abba0887a976f10b34e547556dc` with 1904 entries, identical to the capture receipt; the workers resumed (9 running, none stopped). Finding from the first destructive pass: deleting the namespace outright kills the process supervisor (its status writer needs `/app/logs`, a symlink into the namespace) and the container exits; a Railway redeploy of the same sealed image boots again with a fresh empty namespace (30 entries), after which the R2 restore rebuilds the gold state. Recovery from a wiped volume is therefore redeploy, then restore from R2, then verify the tree hash. Readiness after restore: ok. Isolated container suites on the restored namespace: `test:single-release` exit 0, full `npm test` 172 step lines, 0 failures. Golden conversation replays inside the restored container with the model stubbed (`live_model: false`; deterministic turns must reproduce byte for byte, model turns are replayed with the recorded gold reply as the candidate and must stay contract-valid under the locked route): gold-a 17 turns, 17 exact, 10 deterministic executors, 0 failed (gold replies as model candidates); gold-b 7 turns, 7 exact, 5 deterministic executors, 0 failed (gold replies as model candidates); gold-c 18 turns, 18 exact, 11 deterministic executors, 0 failed (gold replies as model candidates).

## Anti-drift gate

`scv-gold-guard.sh <candidate-tree> <change-card.json>` (private tooling, `gold-v148/gate/`): materializes the gold runtime from R2 and verifies its fingerprint; diffs the candidate against gold and requires every changed, added or removed file to be declared with a reason in the change card (locked files need `owner_approval: true`); runs the full local suite without the single-release protocol variable; runs `scv-gold-conversation-replay.js` on both golden conversations (deterministic executors must match byte for byte or within the generic-info rotation family; model-authored turns must stay contract-valid under the locked route). Self-test on the sealed v145 tree with an empty change card: pending. Local replays on the sealed tree: gold-a 17 turns, 17 exact, 10 deterministic executors, 0 failed (gold replies as model candidates); gold-b 7 turns, 7 exact, 5 deterministic executors, 0 failed (gold replies as model candidates); gold-c 18 turns, 18 exact, 11 deterministic executors, 0 failed (gold replies as model candidates).

## Laws

- The production tree is the R2 gold artifact; working folders on any machine are consumable and never the source of truth.
- A change reaches a seal only through the gold guard: a declared change card, a diff against gold materialized from R2, the full local suite, and the golden conversation replays (deterministic turns byte-identical, model turns contract-valid under the locked route). Locked files (prompt authority, policy contracts, April tone floor, booking policy, structured-state schema, config lock, prompt stones) need explicit owner approval.
- Every deployed release is sealed, staging-tested in an isolated container, live red-teamed on the debug identity, left with a fresh hand-over reset, published to R2 with readback and restore drills, and pinned by a new sentinel version.
- Model identity is pinned and enforced at boot; deterministic lanes answer booking turns; a resolved revision outranks classifier flags; ordinal words are calendar days.
