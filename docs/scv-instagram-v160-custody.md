# SCV Instagram v160 custody record (2026-09-07)

Voice-continuity repair, independently verified during the Claude-to-Codex
handover. This record identifies the **running private release**, not the
historical public source mirror and not a promotion of recovery Gold.

## Active release and private acquisition

| Field | Verified value |
| --- | --- |
| Release | `scv-instagram-single-20260907-v160` |
| Base release | `scv-instagram-single-20260907-v159` |
| Content fingerprint | `bcebc9bd25df0ca8a116394879959ec46fa0d1de582f25b35a6648848a2be507` |
| Release descriptor SHA-256 | `9e41f9f7d8f750bc8a3a75c9c5e6abb0a312496f1a44b8699347c2b1cd5c4dbb` |
| Runtime inventory | 256 files, plus `SCV_SINGLE_RELEASE.json` |
| Node | `20.20.2` |
| Staging deployment | `1735d6b7-3995-4a20-ab0c-ba6d80bb1e6f` |
| Production deployment | `1c098ab6-6c27-4a97-be52-4ba48fa59566` |
| Approved recovery Gold, unchanged | `scv-instagram-recovery-gold-20260905T054647Z-v151` |

Private bucket: `omar-private-archive`.

Runtime key:
`scv-instagram-automation/release-ready/20260907T180929Z/v160/scv-instagram-single-20260907T180929Z-v160-voice-continuity.tar.gz`.

Archive SHA-256:
`fa0267138bc7ac106c3765ba96407c7bb98c3f021cad9bccee92cc8e760e31e4`;
size: **1,451,425 bytes**. R2 download matched that hash and size. Extraction
verified every descriptor entry, rejected unsafe paths, and found exactly the
256 declared runtime files plus the descriptor. Staging and production installed
file hashes independently matched this artifact.

Authorized operational preparation must acquire this private artifact through
existing authenticated R2 access into a new private directory, verify the archive
and descriptor hashes, and verify every runtime entry. A Git checkout of
`products/scv-instagram` remains **v122 public-source-mirror-only,
deployment_allowed=false**; it is not a substitute for this source. Never place
the private runtime, customer state, credentials, or audio URLs in public Git.

## Failure boundary and repair

The owner's voice question about black-and-gray tattoo capability reached an
ASR disagreement boundary. Orthographic variants could reject an otherwise
equivalent transcript; the failed-voice recovery path could lose authenticated
enrichment and choose an image/form response instead of answering the voice
question or requesting a resend.

The existing architecture is retained:
authenticated audio -> bounded ASR comparison -> authenticated turn context ->
routing/recovery -> verified immutable decision -> delivery.

- Consensus comparison normalizes only the bounded whole-word spelling pairs
  grey/gray and colour/color. It preserves the adopted original transcript.
  Negation, time, amount, and other semantic disagreements remain gated.
- Recovery carries the authenticated voice enrichment associated with ingress.
  User-supplied prose cannot grant itself that authority.
- Unresolved voice input takes its explicit resend/type clarification path, not
  an image-reference or booking-form fallback. Resolved voice retains its text
  intent. There is no new model-selection loop or booking-policy change.
- Regression harness clock inputs are fixed to their declared fixture time;
  this does not change production booking time rules.

Exactly nine runtime files differ from the independently downloaded and
hash-verified v159 base; none were removed: `SCV_DESIGN_INTENT_LOCK.md`,
`codex-dm-runner.js`, `dm-authority.js`, `package.json`,
`scv-double-check-divergence-harness.js`, `scv-hard-harness-lock.js`,
`scv-media-context-resolver.js`, `scv-single-control-plane.js`, and the new
`scv-voice-continuity-harness.js`.

## Executed acceptance checks

- Local full suite: **81/81 stages passed** using the pinned Node runtime.
- Local release verification runner: **24/24 steps passed**.
- Staging: all **256 installed runtime hashes** and descriptor matched, then
  **105/105 steps passed** in a fresh isolated copy with an empty environment
  (release suite, full suite, voice continuity, and divergence harness).
- Targeted checks passed: voice continuity **12/12**, price memory **21/21**,
  compound intent **31/31**, divergence harness **416/416**.
- The original hash-pinned v148 GOLD-3 A/B/C fixtures were replayed against both
  the freshly acquired v159 base and v160. All **42 turns** had identical
  replies, actions, and verdicts between the base and candidate.
- The older change card listed two inherited v152 time-change acknowledgements
  but omitted the equivalent Gold C case `gold-c-10-08-actually-3pm`. Fresh v159
  replay proved that third case already existed. The comparison explicitly
  accounts for that exact inherited case; no fixture bytes, Gold pins, or
  production behavior were changed to make a new divergence pass.
- Sentinel unit tests: **8/8 passed**; syntax, current configuration/types,
  deployment dry run, and public-mirror integrity verification passed.

These are individual non-compensating checks, not a claim of global routing
optimality. Initial failed environment/fixture-custody runs remain in private
forensics; they are not counted as passing results.

## Controlled production replay

After the first fresh exact-target reset, the original owner audio was submitted
through authenticated **synthetic debug ingress** on the deployed v160. It was
not a new Instagram-client-origin recording.

The preserved transcript asked whether black-and-gray work is offered. The
actual reply answered yes and invited a reference or idea. It used **one answer
candidate, zero verifier rejections, and zero repair cycles**. Both reply bubbles
were accepted by the delivery provider; measured ingress-to-provider-acceptance
latency was **15,587 ms**. No image/form fallback or deterministic recovery ran.

Provider acceptance is **not recipient visibility**. No authenticated Instagram
recipient screen was available for this replay. Phone-visible delivery and
Instagram-client-origin capture are therefore not claimed. Token totals were
not measured; this single incident does not establish optimal model pricing or
universal first-attempt success.

## Fresh handover reset and recovery custody

After that live replay, a **second, fresh** reset removed only the code-locked
Omar.system debug state. It did not reuse the pretest reset receipt. The operator
verified the exact v160 deployment, paused all **10 expected workers**, captured
and restore-drilled distinct pre/post snapshots, wrote the reset receipt and
tombstone/watermark records, audited **zero residual debug records**, and resumed
all **10 workers**. A subsequent read-only audit at 18:34Z still found zero.

| Artifact | Timestamp / SHA-256 |
| --- | --- |
| Pre-reset snapshot | `20260907T182839Z` / `59e0a4cf573c6409c8f3c33c4f1e59eaeb76f79194ddb0ff99070ba00dbff6be` |
| Post-reset snapshot | `20260907T182843Z` / `7da6157ab668cc4b58304a0b0b43b4a5ebc9b126b554db08753139151565e7a3` |
| Execution receipt | `df487d1fdeb8f54af56df86e8fe6d60366c9a8f847d3401305ca7aa58554f83a` |

All three objects were uploaded to the private R2 prefix
`scv-instagram-automation/timestamped-snapshots/omar-system-reset/20260907T182843Z/`
and downloaded again with identical hashes. Suffixes are
`pre-reset/prod-v160.tar.gz`, `post-reset/prod-v160.tar.gz`, and
`execution.omar-system-purge.json`. These snapshots are recovery evidence, not
authorization to overwrite historical customer state.

Non-debug identities, existing customer appointments and delivery state,
unrelated quarantine, and ManyChat configuration were preserved. Recovery Gold
v151, April Gold, and behavioral GOLD-3 v148 were not changed or promoted.

## Scheduled drift attestation

The deployed sentinel v23 pins the running v160 separately from the unchanged
v151 recovery point and v148 behavioral Gold. Worker version:
`abd3b475-8b8b-4fe0-b462-2d5228a5b0db`.

The scheduled attestation **after the final reset**, at
`2026-09-07T18:30:27.000Z`, passed production, staging, recovery custody, and
behavioral Gold checks. Production was active, critical drift was zero, and the
capability canary passed. Existing noncritical quarantine alerts are retained,
not erased or relabeled as zero.

R2 attestation key:
`scv-instagram-automation/drift-attestations/2026-09-07/20260907T183027000Z.json`.
Readback SHA-256:
`a1ac87de3ad4fe015dc079da4ee5cb543d353e07642b3a46e11ee6780f2d253d`.

## Private verification archive

The selected closeout evidence (test result manifests, release inventories,
reset custody receipts, live acceptance measurements, and final runtime audit)
was packaged and restore-drilled, then uploaded and read back identically:

- Key: `scv-instagram-automation/verification/20260907T183502Z/v160/closeout-evidence.tar.gz`
- SHA-256: `9262e7b8034ee4e6bfd6b515f39132e57f1e2eea9215eb48b8ba3877ddee932e`
- Bytes: `41873`

This evidence archive excludes customer-state archives, authentication caches,
credentials, and audio URLs. The separately scoped private reset snapshots
above retain their own custody records. Public Git contains only the sanitized
release description and sentinel pins; the exact runtime stays private in R2.
