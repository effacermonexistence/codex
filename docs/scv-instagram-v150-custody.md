# SCV Instagram v150 custody record (2026-09-04)

v150 replaces v148 on production. v149 shipped between them and was superseded within twenty minutes;
it has no custody record of its own and its reset is a point of this control. Both releases carry the
same owner-reported fix; v150 adds the latency fix that v149's own live red-team exposed.

## Active release

- Release id: `scv-instagram-single-20260902-v150`
- Sealed at: `2026-09-04T05:32:54.306Z`
- Content fingerprint (sha256): `ea240f8a53946778211cc98bcf2eadbe819bbde876251e5b865e1a736e689e42`
- Release manifest sha256: `b92b028ed6ba88455325433cdc6038a21b9cddc1653fdc19db036976259befc1`
- Production Railway deployment: `e4a570e9-e151-408a-8eae-226834366336`
- Staging Railway deployment: `ffba488f-614c-4d6e-872f-6d4457716026`
- Runtime archive in R2: `scv-instagram-automation/release-ready/20260904T053332Z/v150/scv-instagram-single-20260904T053332Z-v150-name-authority-and-single-pass-design-turn.tar.gz` (sha256 `6abcb9ef0596e0f67e00430987fdf1907f7f38ce6f020f3241684b7b7c6f97eb`, read back byte-identical)

## What v149 and v150 fix

**The name the client sees stopped changing on its own.** The owner's own red-team of v148 printed
`Name : Open file number` on the first four-field checkpoint and `Name : Open file` on the corrected
one, with no input touching the name. The value came from his submitted form; two read paths then ran
the *utterance* sanitizer over it, whose trailing "and my number" stripper is right for a spoken
sentence and wrong for a field — it also truncates a real name ending in Number, Cell or Mobile. A
stored name is now read with hygiene only (`sanitizeStoredIdentityName`): whitespace, wrapping
punctuation, length and letter validation, nothing else. Only a raw current-turn utterance still goes
through the old sanitizer. Both the contract's field normalizer and the parser that reads back a
checkpoint we already printed use the new path. Closed-transition contract v79, hard harness lock v165,
divergence harness v10 replays the owner's exact sequence end to end.

**The design turn stopped burning three model passes.** v149's live red-team took 44.6 s on
"i'm thinking a small dagger on my inner forearm, black and grey": the model drafted a size/placement
question, the deterministic stripper removed it, the non-authoring guard demanded a re-author, twice
more, and the route-aware recovery line went out anyway — correct content, thirty seconds late. When
the route is `offer_form` and carries the `acknowledge_and_defer_placement_size` obligation, the model
now gets exactly one pass; its recovery text for that route is already correct and verifier-clean.
Same turn on v150: 13 s. Divergence harness v11 pins it.

## Verification

- Gold guard (GOLD-3 gate) on the candidate tree with the declared change card: gold materialized from
  R2 and fingerprint-verified, every changed file declared, full local suite exit 0, golden replays
  clean (gold-a 17/17 exact, gold-b 6 exact with the one declared divergence).
- Staging container: isolated copy of the 254 manifest files plus the descriptor, `test:single-release`
  exit 0 and the full suite green inside the v150 staging container.
- Production readiness after deploy and after each reset: release `scv-instagram-single-20260902-v150`, `ok: true`,
  `fail_close_active: false`, `critical_alert_count: 0`.
- Live red-team on production (debug identity, before the hand-over reset): 18 cases,
  17 provider-accepted, 9 of 11 expected checks passed, 0 template hits, 0 repeated
  assistant lines. The design turn passed at 13 s and the checkpoint name held across the time revision,
  which are the two fixes this release carries. Three cases did not pass and are recorded honestly below.
  Instagram visibility is never claimed; production has no thread client.

### What did not pass, and why it did not block the release

1. `03b-date-before-form-match` was never delivered: the Railway API returned a transport error while
   injecting it, so no receipt exists. Infrastructure, not runtime behaviour.
2. `11-ordinal-date` (45.4 s) and `12-time-again` (72.8 s) fell to the deterministic recovery lines. The
   date revision invalidated the time, the model failed the "time cannot skip to double check" contract
   three times, and the recovery nudge went out; the next turn was then refused as a duplicate
   double-check because the superseded checkpoint had not been recorded as superseded on the recovery
   commit. The client sees a question, never silence or wrong data, and answering it moves the thread
   on. This path is a known open defect, filed against the next release, not a regression introduced
   here: the same sequence passed on v149 when the model happened to comply.

## Hand-over reset

Resets on deployment `e4a570e9-e151-408a-8eae-226834366336`, operator rendered from the hash-pinned base
`d0b2f2ab4b97b512ce816394e1c9ff4197c973ccb492b6497afc6778d9f8812c`. Baseline before the live red-team: pre `20260904T053705Z`,
post `20260904T053710Z`. Hand-over: pre `20260904T054557Z`, post `20260904T054601Z`,
receipt sha `178f127f08e75f3d30814ce2377e7a9f4283e2f22fd335895e4dcbcd0fe63595`, pre-audit remaining 33, deleted 33, post-audit remaining 0,
all workers resumed. All artifacts pulled from the container and hash-verified against the receipts.

## R2 timestamped recovery and sentinel

Control `20260904T054643Z` (sealed `2026-09-04T05:46:43.000Z`) built from the v148 control plus the v149 and v150
reset points: 71 snapshots, current `scv-instagram-20260904T054601Z-v150-post-omar-reset-current`. Every object read back and hash-matched, both
hand-over points restore-drilled from the local and the published control. Drift sentinel
`scv-instagram-drift-sentinel` v13 (schema `scv-instagram-drift-sentinel-2026-09-04-v13-v150-name-authority-pointer`)
pins the v150 release fingerprint and manifest, control `20260904T054643Z` with 71 snapshots, the catalog,
seal, restore tool, both staged restore receipts, the reset receipt and the per-release pre-reset audit count.

## GOLD stays at GOLD-3

The frozen gold is still GOLD-3 (v148, manifest sha `31ea4507381e6ec2c3ce4458d70af4a311f331a4a26651f5d9234a01312766cc`).
Neither v149 nor v150 had a fully clean live red-team, and the standing law is that the gold freezes only
on a release that passes its own. The sentinel's gold check previously compared the gold manifest against
the *running* release and therefore failed by construction once the release moved ahead of the gold; it now
pins the gold's own release identity separately, which is what "frozen reference" actually means.

## Boundaries

- ManyChat acceptance is not Instagram visibility; no reply in this record is claimed visible.
- The v150 live red-team was performed by the operator session on the debug identity; the owner has not
  red-teamed v149 or v150 himself. The hand-over reset above is his clean starting point.
- Private runtime source, incident media, customer messages and CDN URLs stay out of this repository.
