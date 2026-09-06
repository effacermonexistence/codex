# SCV Instagram v153 custody record (2026-09-05)

Second fix of the owner's experiment round, root-caused from the production log of his own v152 red-team.
Branched from the sealed v152, gold-guarded against v152, reversible to the v151 recovery Gold at any time.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260905-v153` |
| content fingerprint | `a62b7c21ba0498c1fc44e7f4993265d204fcbcdf8d8eca8ef6ca17875e5088fb` |
| release manifest sha256 | `ea0da362d9814fb9817a4de04843cc04dd581a8b262e524f680dec91111c1e0d` |
| base | `scv-instagram-single-20260905-v152` (production since 2026-09-05 21:52Z) |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `85553ad6-706a-4c9f-af7a-68de6c4f7eca` |
| production deployment | `d91dfd36-d539-464d-b866-d1a57c81e0e7` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260905T230047Z/v153/scv-instagram-single-20260905T230047Z-v153-nominated-visual-is-design-authority-and-pre-checkpoint-recovery.tar.gz` sha256 `1abd156963ec938b0b242283bbbe4e5f5322757ed300db20462d04781dab7832` (1421582 bytes, readback byte-identical) |

## The incident (production v152, omar.system, 2026-09-05 21:56Z)

After "Can you also do black and gray?" the client sent an image and, six seconds later, "I'm thinking of this
one". The reply came 80 s later and read "i see your message nothing is changed on my side yet what should i
take care of first?" — a line written for an open booking checkpoint.

From the production log (`railway logs`, timestamps) and the code:

1. Image at 21:56:24 (media-only), words at 21:56:30. The image turn ran vision (32 s) and a model attempt,
   then was superseded by the text turn, which reused the vision description (authority rank 400).
2. The coalesced live text was replaced by the vision description; the client's own words vanished from
   state, so no anchoring rule could read them.
3. Vision did not label the drawing a tattoo (`unknown`), and anchoring a visual as the design required
   creative-use language, so the turn fell to the non-tattoo host lead (`general_continue`).
4. The model asked a size/placement question three times (stripped each time, 21:57:15 to 21:57:50), the
   route-aware recovery armed, and `general_continue` had no recovery line of its own, so the generic
   checkpoint ask went out.

## What v153 changes

- The client's words on a media turn survive as `live_turn_client_selector_text` (dm-authority).
- A current visual the client nominates in plain words ("I'm thinking of this one", "something like this",
  "can you do this", bare "this one" with the image) is design authority; a screenshot, selfie, document or
  payment image keeps the contextual host lead (contract-harness lock v120). The route becomes `offer_form`,
  so the reply is the reference acknowledgement plus the form offer, and its recovery line is "yeah we can
  use that as a starting point and make it custom in my style want me to send the application form?".
- Every pre-checkpoint route owns an answerable recovery line (route-aware recovery v8); the generic
  "nothing is changed on my side" ask is reserved for turns after a form, checkpoint or deposit exists.
- design_intake / general_continue / tattoo_continue get one re-author instead of two (control plane).

Files: `dm-authority.js`, `scv-contract-harness.js` (lock v120), `scv-hard-harness-lock.js` (v167),
`scv-deterministic-recovery.js` (v8), `scv-single-control-plane.js`, `scv-double-check-divergence-harness.js`
(v13), `SCV_DESIGN_INTENT_LOCK.md`. No prompt, policy, schema, model or April-tone file changed.

## Verification

- Gold guard (`gold-v153/gate/scv-gold-guard.sh`, baseline = the v152 runtime, materialized from the hash-verified
  R2 readback copy because this sandbox could no longer refresh wrangler's OAuth token): candidate diff = exactly
  the seven declared files, no undeclared change.
- Full local suite on the candidate: 81 steps, 75 pass, 0 real failures; the 6 that fail do so only because the
  sandbox forbids binding a local TCP port (`listen EPERM 127.0.0.1`), identical to v151/v152:
  single-control-transport, final-sender-payload, outbox-adoption, inbound-post-share, heart-reaction-inbound,
  inbox-transport-timeout. `test:single-release` on the sealed tree: 20 of 22 sub-steps pass; the other 2 are the
  same port-binding outbox harnesses.
- Golden replays: gold-a 17 turns (16 exact), gold-b 7 turns (6 exact); the only non-exact turns are the two
  v152 divergences (`gold-a-08-actually-3pm`, `gold-b-06`) inherited unchanged.
- Divergence harness v13: 380/380, including the live reproduction (unknown image + "I'm thinking of this one"
  -> offer_form with the reference acknowledgement recovery line), the screenshot boundary, the no-media pointer,
  the design-lead recovery, the predicate boundaries and the two-pass budget on the design route.
- Behavioural port-binding harnesses are to be re-run inside the staging container (Part B) where they can bind.

## Boundaries

- Customer state untouched; code-only release. ManyChat untouched.
- No claim of Instagram-visible delivery; readiness and fingerprint are what was verified.

## Hand-over reset

Fresh Omar.system reset on production deployment `d91dfd36-d539-464d-b866-d1a57c81e0e7` after the v153 deploy: post-reset snapshot `20260905T230336Z` (sha `38bdf49ee4a6ba1c27c7a29cd7a93442dab3dd8010713f00cb69ef1eb446a552`), pre-reset snapshot `20260905T230330Z` (sha `cad5845f6d8f4af1b87c5b53761a0d03c0f088ddd534901f78399b477c865da9`), receipt sha `ab95e5df133f0efd1e36311582c54315e9d6a044e235597c390052408f9cdbc2`; all three read back byte-identical from R2 `scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260905T230336Z/`. The debug identity (omar.system / 1537753982) is the only scope the operator may purge; residual 0; every worker resumed.

## Drift sentinel

`scv-instagram-drift-sentinel` v16 (Worker version `2e767d02-71a8-4cbf-b603-6153d095b18d`) pins the running release v153 separately from the current recovery point, which stays the v151 Gold; GOLD-3 (v148) pins are unchanged. First passing scheduled run: `2026-09-05T23:55:54.000Z`.
