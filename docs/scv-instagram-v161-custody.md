# SCV Instagram v161 custody record (2026-09-07)

Tenth fix of the owner's experiment round. Root-caused from production logs and fixed by Claude. Branched from
the sealed v160, gold-guarded against v160, reversible to the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260907-v161` |
| content fingerprint | `7aecbf021cbaba1c9519b57120c4467f4e58c1caa2ce94c05af4844ac4881b7f` |
| release manifest sha256 | `b2cf21886d8df57dbd63b15f7c9d6d779370839dcddac152ed707c35628ae112` |
| base | `scv-instagram-single-20260907-v160` (production since 2026-09-07 18:22Z) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `1a681bf6-e8e1-4609-9558-2a17d527076a` |
| production deployment | `966680e6-b2f4-4288-a14b-5fa7cdbfc649` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260907T195236Z/v161/scv-instagram-single-20260907T195236Z-v161-reference-nomination.tar.gz` sha256 `589cdda1437576d13d80231754a31a07b8636397716acbab339b2876d2d64758` (1459983 bytes, readback byte-identical) |

## The incident (production v160, omar.system, 2026-09-07 19:11–19:14Z)

The client sent a picture of an aftercare cream (vision: a product listing / tube of ointment). The host lead
answered "That looks like aftercare ointment, not the tattoo itself — if you meant a tattoo reference, send me
the actual picture or tell me the vibe" (the first filter is acceptable). The client then wrote "I mean I just
want the after cream ointment as a reference" and the reply was "Got you / that screenshot is just aftercare
tho …". Owner law: any object the client names as their reference IS the design direction; the image's file
category (product, screenshot, package, object) never outranks that decision.

## Root cause (reproduced locally on the sealed v160)

- The anchored-inspiration verifier only knew the "isn't a tattoo reference" wording, so "is just aftercare",
  "not the tattoo itself" and "send me the actual picture" passed after the nomination.
- `clientAnchoredInspirationReference` required the tattoo-lane latch before reading the nomination; without
  the latch the turn was `design_intake`, the correct affirmation + form offer was rejected
  (`closed_transition_form_before_design`) and the recovery line was the generic "what are you thinking of
  getting?".
- The nomination grammar only recognised sentence-initial "I mean … / just …"; "I just want the X as a
  reference", "use the X as the design", "can you do X as the reference?" and pointer + frame right after the
  picture were not nominations.

## What v161 changes

- `textNominatesNamedObjectAsReference` (contract-harness lock v127): a reference frame ("as a/the/my reference |
  ref | inspo | design | tattoo | piece | idea | starting point | base | source | subject | motif", "is / that's the
  reference") plus a concrete lexical anchor, or (live only) a pointer to the adjacent picture. Evaluative
  questions, negations, withdrawals, hypotheticals and booking-process sentences fail closed; "can/could/would you
  do X as the reference?" counts as the request to do it.
- `liveNominatesPriorVisualObjectAsReference`: the nomination binds to the adjacent prior client picture
  (authoritative visual event), or one turn further back across a lightweight split; a caption on the picture
  itself counts. It is itself the tattoo signal: `clientAnchoredInspirationReference` returns true before the
  lane-latch gate, so the non-tattoo host lead never fires again for that object and the plan is `offer_form`
  (or the already open form gate).
- Verifier: after a nomination, re-grading the object ("is just aftercare / a product / a screenshot", "not the
  tattoo itself", "not really a tattoo/design", "send me the actual or a different picture", "if you meant a
  tattoo reference", "hard to use as a reference") or asking for a resend is
  `anchored_inspiration_reference_cannot_reopen_design_interview`.
- Memory: the nomination sentence is readable design memory; the control plane stores it as
  `known_design_context` when the anchored latch is set and no design memory exists yet.
- Runner: the nominated-object law in the photo/reference design-commit guidance and route lock.
- Recovery (route-aware v13): an anchored nomination takes the reference acknowledgement line and the form ask
  instead of a bare form ask.
- Boundaries preserved: a bare "this one" on a non-tattoo screenshot still gets the host lead once (v153); a
  nomination without any picture is not visual authority; a random share plus an apology gains no design
  authority; booking-process sentences ("I want the next steps for a tattoo") stay design intake.

Files: `scv-contract-harness.js` (lock v127, self-test 363), `scv-single-control-plane.js`, `codex-dm-runner.js`,
`scv-deterministic-recovery.js` (route-aware recovery v13), `scv-double-check-divergence-harness.js` (v21),
`scv-hard-harness-lock.js` (v175), `SCV_DESIGN_INTENT_LOCK.md`. No policy, schema, model pin, price rule or
April-tone file changed; the closed-transition contract stays v84.

## Verification

- Gold guard against the sealed v160 (`gold-v161/gate/scv-gold-guard.sh`, baseline materialized from the
  hash-verified R2 readback of the v160 runtime, sha `fa026713…`): every changed file declared in
  `change-card-v161.json` (7 files), no undeclared, added, locked or removed file; `problems: []`.
- Contract self-test 363 checks (16 new): the production sequence with no lane latch is design authority and
  leaves the non-tattoo host lead; "I just want the aftercare cream as a reference", "use the ointment tube as the
  design", "use that as a reference" and "can you do the ointment tube as the reference?" are nominations;
  withdrawals, evaluative questions, a bare "this one" on the screenshot and a nomination without any picture are
  not; re-grading ("just aftercare", "not the tattoo itself") and asking for the actual picture are rejected; the
  affirmation + form offer is valid; the nomination sentence is design memory and a pointer-only sentence is not.
- Divergence harness v21 (428/428) including the exact executed path through the single control plane: the
  re-grading draft is rejected, the affirmation + form offer ships, the thread persists the anchored latch, the
  open form gate and readable design memory; the recovery line acknowledges the reference and offers the form.
- Closed-transition harness 10010 checks (booking-process sentences such as "I want the next steps for a
  tattoo" stay design intake); hard harness lock v175, 117 checks in both modes (`SCV_OPENAI_RESPONSES_REQUIRED=1`
  included).
- Regressions preserved: Codex's `verify-compound.cjs` 31/31 and `verify-price-once.cjs` 21/21 on v161; voice
  continuity harness (v160) still in `test:oneshot`, ok.
- Golden conversation replays on the candidate: gold-a 16/17 exact, gold-b 6/7 exact; the divergences are the v152-inherited "yes 3pm works"
  turns declared in the change card; no unexpected divergence.
- Full local suite on the sealed tree: 81 stages, 75 passed and 6 blocked only by sandbox port-binding EPERM; no other
  failure; the tree hash is identical before and after, so the seal is unchanged.
- `test:single-release` split on the sealed tree: 20/22 ok, the 2 failures are the sandbox port-binding EPERM
  harnesses (`outbox-strict-marker-gate`, `outbox-adoption`); the seal fingerprint is unchanged after the tests.
- Installed-byte and isolated-suite verification: staging deployment `1a681bf6-e8e1-4609-9558-2a17d527076a` and production
  deployment `966680e6-b2f4-4288-a14b-5fa7cdbfc649` each matched all 256 manifest entries and the v161 descriptor exactly;
  `test:single-release` and the full `npm test` suite both passed from a fresh isolated copy with an empty environment
  on each deployment.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched. No signed media URL, recording, customer
  message or credential in this record.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.

## Superseded

v161 served production from 2026-09-07 20:15Z (deployment `966680e6-b2f4-4288-a14b-5fa7cdbfc649`) until v162 replaced it; the owner's v161 red-team found the two incidents recorded in `scv-instagram-v161-custody.md`'s successor, so no hand-over reset or sentinel pin was made for v161.
