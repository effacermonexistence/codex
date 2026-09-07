# SCV Instagram v159 custody record (2026-09-07)

Eighth fix of the owner's experiment round, root-caused from the production log of his v158 red-team.
Branched from the sealed v158, gold-guarded against v158, reversible to the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260907-v159` |
| content fingerprint | `c5a02fb607a46904ed70dc8dbb839bb55c04b9fa42c5cd145fc25cf7aaa83b05` |
| release manifest sha256 | `d276dbb540ff1414159df423013eb8e34296f0bad43f0fb52435dea3e5568493` |
| base | `scv-instagram-single-20260907-v158` (production since 2026-09-07 04:13Z) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `7f38825e-cfe4-4598-974c-0d6d0c843981` |
| production deployment | `4c210bdc-fce9-4d22-9664-8d0711f71370` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260907T044603Z/v159/scv-instagram-single-20260907T044603Z-v159-voice-note-is-text.tar.gz` sha256 `b142a094884d7e0e5a717927cbc63c7052cd13b5259fdd9c73353cae52a7ec2f` (1447199 bytes, readback byte-identical) |

## The incident (production v158, omar.system, 2026-09-07 04:28Z)

A voice note saying "Hi, can I please get more information?" arrived with no text and an audio attachment.
The transcript resolved in 4 s (`authority_media_context_resolved`, voice), yet the turn went to the model lane,
failed at generation on the repair pass, and 31 s after the inbound the route-aware recovery sent a single
70-character bubble: "I see the image what part of it are you thinking about for the tattoo?".

From the production log (`railway logs --json`) and the code, reproduced locally on the sealed v158: the audio
attachment (`media_urls` / `media_type`) made the turn count as media, so the fixed generic-info answer was
ineligible (`live_turn_carries_media`) and the contract could not take the direct-info route
(`liveIsSelfContainedGenericInfoRequest` excludes media turns); the recovery lines treat a media turn as an
image.

## What v159 changes

- A resolved voice transcript ("sent a voice note saying: …") is the client's words: the audio is transport.
  The generic-info fast path and, through the same shared predicate, the contract's direct-info route treat it
  as text, so a spoken "can I get more information?" is answered by the fixed model-spot explanation without
  the model lane.
- A voice note is never "non-tattoo media context" (contract-harness lock v126); the recovery lines never use
  the image-part ask on a voice turn under any route (route-aware recovery v12); a reply that claims to see an
  image/photo/reference or asks "what part of it" on a voice-note turn is rejected
  (`voice_note_answered_as_an_image`).
- An unintelligible voice note keeps its own clarification path. A real image turn keeps the image-part ask.

Files: `scv-generic-info-fast-path.js`, `scv-contract-harness.js` (lock v126), `scv-deterministic-recovery.js`
(v12), `scv-hard-harness-lock.js` (v173), `scv-double-check-divergence-harness.js` (v19),
`SCV_DESIGN_INTENT_LOCK.md`. No policy, schema, model or April-tone file changed; the closed-transition contract
stays v84.

## Verification

- Gold guard against the sealed v158 (`gold-v159/gate/scv-gold-guard.sh`, baseline materialized from the
  hash-verified R2 readback of the v158 runtime, sha `1a577ff0…`): every changed file declared in
  `change-card-v159.json` (6 files), no undeclared, locked or removed file; `problems: []`.
- Divergence harness v19 (416/416): the voice info request with audio fields takes the fixed info answer and the
  direct-info route; the recovery never answers a voice note as an image under design_intake, general_continue
  or tattoo_continue; a model reply claiming an image on a voice turn is rejected; a real image turn keeps the
  image-part ask. Contract self-test 347 checks.
- Regressions preserved: Codex's `verify-compound.cjs` 31/31 and `verify-price-once.cjs` 21/21 on v159; the
  responses-required hard harness (`SCV_OPENAI_RESPONSES_REQUIRED=1`) 109 checks ok.
- Golden conversation replays on the candidate: gold-a 16/17 exact, gold-b 6/7 exact; the two divergences are the
  v152-inherited "yes 3pm works" turns declared in the change card; no unexpected divergence.
- Full local suite on the sealed tree: 81 stages, 75 passed and 6 blocked only by sandbox port-binding EPERM; no other failure.
- Codex closed the environment gap on staging deployment `7f38825e-cfe4-4598-974c-0d6d0c843981`: all 255 installed files and the release descriptor match the v159 hashes. Both `test:single-release` and the full `npm test` passed in a fresh isolated copy with an empty environment. This includes the voice-info regression and the formerly port-blocked transport tests.
- `test:single-release` split on the sealed tree: 20/22 ok, the 2 failures are the sandbox port-binding EPERM
  harnesses (`outbox-strict-marker-gate`, `outbox-adoption`); the seal fingerprint is unchanged after the tests.
- Startup gate (`scv-executed-path-startup-gate-harness.js`) passes on the sealed code.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.

## Hand-over reset

Fresh Omar.system reset on production deployment `4c210bdc-fce9-4d22-9664-8d0711f71370` after the v159 deploy: post-reset snapshot `20260907T045919Z` (sha `3af39a3e0e1b1ecf7929e472a8994377fbbeb8b5dafa815417a463ddcf7cc794`), pre-reset snapshot `20260907T045914Z` (sha `a868d87ea9f1647a11c46beab06b4e88be8d77b96334a19404816ac056b5b559`), receipt sha `05424f399231e1522aec3a453b93815c7d98c31b4256745fa8340dda919364d1`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260907T045919Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v22 (Worker version `d43051b3-7986-4043-a422-c4829c347598`) pins the running release v159 separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `2026-09-07T04:55:14.000Z`.
