# SCV Instagram v130 custody

This is a product-specific custody record. It must not be copied into global
Codex or Claude instructions. Customer-derived state, the deployable runtime,
and private writing references remain private in R2 or the production platform
and must never be committed to this public repository.

## Active release

- Release ID: `scv-instagram-single-20260901-v130`
- Content fingerprint:
  `21fd9e5f430e54236d00495b823686b9a0a042944d86211b6e701d5aee852b59`
- Release manifest SHA-256:
  `7ed809bd67c32f5a479a467e0a8acf4e99baf396de9d9e6087805d794c43f2f5`
- Private application archive:
  `scv-instagram-automation/release-ready/20260901T070849Z/v130/scv-instagram-single-20260901T070849Z-v130-double-check-divergence.tar.gz`
- Application archive SHA-256:
  `338fc56d5ac3c6d381bddaa84dcb6fc49ec2761ed3b608c6a2c23da68c79d0f8`
- Production deployment: `b83bc42d-a01e-4788-88c1-98c1838f7ce6`
- Production image:
  `sha256:1befd782e5ca5e23f233872834a6764183af1091d2ddae4587d9eb4d06b8a809`
- Staging deployment: `ee88c421-02b0-454b-ae8a-f1371022d219`
- Staging image:
  `sha256:b3fefcf62b9eb7d1993e30c4930e2cced81a2af7f217c9c0a1b535f92bfae502`

The release fixes the post-checkpoint revision boundary. A client message that
changes a name, phone number, date, or time after the visible four-field double
check now outranks the older assistant checkpoint, invalidates confirmation,
and re-enters the matching field route. Exact, ambiguous, vague, bounded, and
rejected date/time forms are handled separately. The open revision grammar
covers modal and filler variants, change/move/switch/reschedule wording,
field-label forms, case, and punctuation.

The reply path also has a route-aware liveness invariant. If an input cannot be
classified or every semantic candidate is rejected, the first complete
verifier cycle arms a visible, non-transactional answer. It does not silently
confirm, change, send, or mark a booking or deposit.

No customer identifiers or message text are present in this repository.

## Verification

The focused divergence suite passed all 78 checks from the source tree, the
staging container, the production container, and an R2-restored runtime. It
includes the production-shaped checkpoint sequence, open grammar families,
exact and non-exact revisions, all four booking fields, and the unclassified
minimum-visible-reply path.

The supported single-release suite also passed under the pinned Node 20
toolchain. Its gates included 756 booking-policy, 140 booking-history, 17
checkpoint-lane, 25 deterministic-recovery, 55 recovery-surface, 22 transport-
timeout, 59 closed-lifecycle, 271 contract, 10,010 closed-transition, 141
single-control, 83 accepted-boundary, and 109 hard-lock checks.

Production and staging returned HTTP 200 from `/deployz` and `/readyz`, reported
the exact release ID and hashes above, zero critical drift alerts, valid voice
and vision canaries, and the dated visible model. The production operational
alert is historical durable quarantine evidence and is not a critical drift.

## Timestamped recovery

- Private catalog pointer:
  `scv-instagram-automation/timestamped-snapshots/LATEST.json`
- Catalog control version: `20260901T082132Z`
- Snapshot count: `19`
- April golden snapshot:
  `scv-instagram-20260420T152810-local-origin`
- Previous current v130 fix snapshot, retained as history:
  `scv-instagram-20260901T070849Z-v130-double-check-divergence-current`
- Pre-reset v130 snapshot:
  `scv-instagram-20260901T081723Z-v130-pre-omar-reset`
- Current post-reset v130 snapshot:
  `scv-instagram-20260901T081724Z-v130-post-omar-reset-current`
- Catalog SHA-256:
  `67749b5bd4fd5ebe8ef44e53e360799abc13ee35eef879faf680dc854b06aa5f`
- Catalog seal SHA-256:
  `e22fe4c7bcf02a489263c00fa77529837e5f47b124336108099742d8e608fe10`
- Pre-reset production-state archive SHA-256:
  `331a9ffb55acd00ab8cca395ace5f0a8f426c7edf727d449e1f2a142bd8cd316`
- Post-reset production-state archive SHA-256:
  `ad388411fd8f27ffb1fda76d94d87b9457495ba4c58b67f4b54535a9f0435cca`
- Exact-target reset receipt SHA-256:
  `00d848e32b6da27b11af67a0587c51ea2bf892da0c15382e74ac2cb0d51f68c1`
- Pre-reset staged-restore receipt SHA-256:
  `3e5a9c2ce190fc75b36785501dda26dc329dd2bb8c526a6ff945a715cf978348`
- Post-reset staged-restore receipt SHA-256:
  `5637d657cdd65f73dedaddbcdf4f582b60f8910659617b54f78a3bea6061fec5`

The golden pointer was not moved or overlaid. All ten production workers were
paused for each state capture. The code-locked Omar.system audit went from 19
matching artifacts before reset to zero afterward, then the exact ten-worker
set resumed and production readiness stayed healthy. The two timestamps remain
separately addressable by exact snapshot ID.

The restore tool downloaded the v130 runtime and both state archives from R2,
verified their hashes, sizes, and tar inventories, and restored them into new
staging directories with `production_mutated: false`. The restored pre-reset
state independently audited to 19 matches and the restored post-reset state to
zero. After publication, every control object was downloaded again and compared
byte-for-byte with its local source. The downloaded control set then completed
a second exact-ID restore of both timestamps with the same 19/zero audit result.
`LATEST.json` was published last.

## Independent drift sentinel

- Worker: `scv-instagram-drift-sentinel`
- Worker version: `916603e6-292a-46e9-b01c-b06bd74d05fa`
- Schedule: every five minutes
- Safe health endpoint:
  `https://scv-instagram-drift-sentinel.omar-git-r2-backup.workers.dev/health`
- Private attestation pointer:
  `scv-instagram-automation/drift-attestations/LATEST.json`

The Worker checks the exact v130 release ID, source fingerprint, release
manifest, critical drift status, voice and vision capabilities, and dated
visible model. It also verifies the private R2 control version, catalog object
hash, snapshot count, distinct golden and current pointers, exact-ID restore
requirement, and disabled automatic production cutover. Its source contains no
credentials, customer messages, or private writing-reference content.
