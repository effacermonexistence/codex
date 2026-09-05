# SCV Instagram v151 custody and current recovery point (2026-09-04)

v151 is the running production and staging release. It closes the two liveness regressions reported
after v150 and establishes a separate, timestamped recovery point for the exact clean production state.
The April origin snapshot remains a separate frozen reference; it is not overwritten by the current point.

## Deployed recovery extension (2026-09-05 UTC)

The complete system recovery claim is **not yet verified**. The new evidence now proves an actual
fresh staging container restored from the saved source, state, OS/dependencies and reconstructed
environment, rather than only an extracted directory or an offline harness.

- Successful restored staging deployment: `a4b49244-bc1e-4866-b925-f85078863738`.
- Image: `sha256:8eca4e8a72a7aa4529e5ef579deeee7efbe9d20ff72ce7c4ade420a0672fdb7d`.
- All 254 canonical source files and the exact 2,128-entry pre-worker state matched.
- All 112 production environment values were reconstructed, including seven actual frozen secret
  reads. The new container verified 98 image/application values after an explicit staging safety
  translation. Authentic new platform IDs and staging's own authentication boundaries were used.
- Nine staging workers are alive; customer sends and customer Gmail reading remain withheld.
  This is not a claim that the ten-worker production topology was restored unchanged in staging.
- Node 20.20.2 and ffmpeg run with real OCI devices and `/proc`. The fresh live model, voice and
  vision canary passed at `2026-09-05T00:26:32.218Z`.
- A `FROM scratch` build used the captured OS closure, with no base-image, npm or apt downloads.
  A lossless xz encoding fixed the upload-size rejection without removing runtime files. Its full
  R2 readback matched; both gzip and xz decode to the same SHA-256-bound tar stream.
- The previous staging namespace was backed up, restore-drilled, read back from R2 and preserved
  on the volume. The original production point, April reference and GOLD-3 were not overwritten.

Read the non-secret extension pointer at
`products/scv-instagram/recovery/20260905T003000Z-v151-deployed-extension.json`.
It locates two private R2 extensions; the latest manifest is SHA-256
`16729e0f0a749ca3c70828329d9f1251953a4f9a7178c5a3f36202bb7b9d8a32`, with 30 fully read-back
proof/tooling components. Failed attempts are retained in that evidence, including the unchanged
source correctly rejecting production-only capabilities in staging before workers started.

Still unproved: restoring full ManyChat flow/trigger/External Request definitions, a genuine
ManyChat-origin inbound plus Instagram-visible reply, and an actual production cutover. The current
ManyChat API inventory is not a flow definition. The task-scoped browser has not exposed an
authenticated ManyChat tab; this is not evidence that the user is logged out elsewhere.
Recovered ManyChat/Gmail authentication and `/readyz` must not be substituted for visible E2E proof.
No production fix or new live red-team/reset was performed by this deployed restore drill.

## Portable artifact recovery entry point (2026-09-05 UTC)

`products/scv-instagram/scripts/recover-v151.mjs` now collects the exact point and both
extensions without relying on this Mac's historical work directories. See
`products/scv-instagram/recovery/RECOVER-V151.md` for the command and remaining gates.
A fresh authenticated R2 run verified all 60 pinned objects and restored the 254 canonical
files plus the exact 2,128-entry state tree. A second offline run into a different directory
passed the same checks. All 21 rejection/verification tests passed. The tool never executes
restored source, reads secret values, changes production, routes traffic, or treats this
artifact-level success as full-system recovery.

The private portable-recovery extension is pinned in `recovery/LATEST.json` at
`scv-instagram-automation/recovery-extensions/20260905T023116Z-v151-portable-b3a949eb/SCV_PORTABLE_RECOVERY_EXTENSION.json`,
SHA-256 `e557bad9768e7be9cce5f8a293cd5bbfea77cab3566fc1734dc1b87096b5106d`.
Its seven tooling/evidence objects and the manifest were fully downloaded from R2 and byte-matched.

Existing v17/v50 ManyChat route screenshots and route-attestation JSON were located in a
historical migration restore. They show old routing, but not a complete current flow export
or the full External Request body/headers. They do not close the current ManyChat/E2E gap.

## Active release

- Release: `scv-instagram-single-20260904-v151`
- Content fingerprint: `d60dfc9f1f082f9d5e268556c0eb43364b5f1d9b1217f6a1f95d04546043c151`
- Release manifest SHA-256: `b307c86bb59e1287afe746f50d8ccd036d7b1bea70820ef3f1facce6baef7d6c`
- Production deployment: `2bb8c04a-6645-41a1-ab5e-10109a193d99`
- Staging deployment at initial release: `83b839b5-1e06-420f-8f7d-5dd432e0deb6`
- Current restored staging deployment: `a4b49244-bc1e-4866-b925-f85078863738`
- Exact private runtime archive: `scv-instagram-automation/release-ready/20260904T221512Z/v151/scv-instagram-single-20260904T221512Z-v151-liveness-and-recoverability.tar.gz`
- Runtime archive SHA-256: `5b70ce46742e342a855152734be267ad5b98807918c68c174eddf024ee467fdd`

The exact runtime is kept in the private R2 bucket because the source contains production-derived
material that is not eligible for public Git. Git contains this custody record, the non-secret pointer,
and the drift sentinel; the existing `products/scv-instagram/runtime` directory remains an explicitly
non-deployable sanitized mirror rather than pretending to be the private v151 artifact.

## What v151 fixes

1. A self-contained general-information question now outranks a durable funnel stage. The reply uses
   the current live information packet and preserves an existing double-check checkpoint instead of
   answering with stale remembered text or silently changing state.
2. The post-form identity lane accepts an unlabeled `name + phone` turn only when date and time are
   already known. Explicitly labelled third-party details and phone-only trailing prose remain rejected.
3. A date or time change at the checkpoint reprints the corrected checkpoint. Unanticipated input still
   produces a bounded answer; it is not allowed to disappear because it does not match a fixed script.

## Verification

- Executed-path target suite: 71 checks passed.
- Double-check divergence suite: 360 checks passed.
- Hard harness: 109 checks passed.
- Full local suite and sealed-release suite: exit 0.
- Isolated staging container: all 172 full-suite steps passed; release tree was 254 manifest files plus
  the descriptor.
- Live production red-team: 18/18 inputs were provider accepted and 18/18 passed semantic evaluation;
  template hits 0 and repeated assistant lines 0.
- Production and staging readiness both reported the exact v151 release and manifest, `ok: true`,
  `fail_close_active: false`, and zero critical drift alerts.

Provider acceptance is not proof that Instagram displayed the message. This record makes no Instagram
visibility claim.

## Exact clean current point

- Recovery point: `scv-instagram-20260904T222549Z-v151-clean-current`
- Manifest: `scv-instagram-automation/recovery-points/20260904T222549Z/SCV_RECOVERY_POINT.json`
- Manifest SHA-256: `75440f5063fb7deab879df404ea8fa7011fece7c3da1f7af93c042ee9a337a5a`
- Clean post-reset state SHA-256: `493382b7c383ffe0c7ad17a7d09a17b4b9095f1baca0eeeebd83e1949da322bb`
- State tree SHA-256: `336e513903a4b12022885e798d415250b8dd9da91cad7b0296ab6f59a9351e62`
- State entries: 2,128
- Restore tool SHA-256: `b03571cee66bbb7bf08bcecda38a6ba7657a0426e51b0f6c61337171f39883a3`

The final reset paused and resumed all 10 workers, removed 33 debug-identity matches, left zero
Omar.system residuals, and restore-drilled distinct pre- and post-reset snapshots. Every component was
downloaded again from R2 and byte-matched. The R2 copy of the restore tool then rebuilt a new staging
directory with all 254 runtime files and the exact 2,128-entry state tree.

The previous clean current point remains separately addressable as
`scv-instagram-20260904T210539Z-v150-clean-current-before-v151`. The stable pointer is mirrored without
credentials at `products/scv-instagram/recovery/LATEST.json`.

## April reference and frozen GOLD

- April origin snapshot: `scv-instagram-20260420T152810-local-origin`, SHA-256
  `1e5225d4d494e55cefec5ee0a58be61e92eeccab6e2d3ea9d1d0f02ccdceba98`.
- Frozen behavioral GOLD-3 remains v148, manifest SHA-256
  `31ea4507381e6ec2c3ce4458d70af4a311f331a4a26651f5d9234a01312766cc`.

The April reference, frozen GOLD-3, v150 history and v151 current state have different identities and
timestamps. Restoration always requires an exact recovery-point ID and never performs an automatic
production cutover.

## Ongoing drift detection and restore boundary

Drift sentinel v14 pins the exact v151 release, current and previous recovery manifests, catalog,
restore tool, all nine v151 components, and the April origin object by SHA-256 and byte count every five
minutes. It also keeps the v148 GOLD-3 check separate from the running release.

Worker version `baef157e-4d83-4150-9107-9d8ff4e95534` produced its first passing scheduled
attestation at `2026-09-04T22:40:33.000Z`: production and staging passed, 11/11 pinned R2 objects
passed, GOLD-3 passed, and consecutive failures returned to zero. The attestation was downloaded again
from R2 and matched SHA-256 `bda874db69c4bb9ffffc4015ea82871b3ebc539c8738531e43e71cc7783cd4af`.

The later extensions close the formerly missing OS/dependency and secret-value reconstruction
gaps; a compatible Linux/OCI host and authorized external accounts/services remain necessary.
R2 objects and timestamped secret copies are append-only by operator policy, not provider-enforced
immutable storage. Account loss, provider revocation/outages and future model availability are not
guaranteed by an archive. This is timestamp recovery, not replication of all future messages.
Production cutover remains an explicit operator action after staged validation.

The sentinel attestation above is historical evidence, not proof of current scheduler freshness.
An observation on 2026-09-05 still returned a last-success timestamp of `2026-09-04T23:25:29.000Z`;
therefore do not claim a fresh five-minute attestation from that response. The deployed restore
extension is separately hash-verified and has not been added to the sentinel's original pin set.
