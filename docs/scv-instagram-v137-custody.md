# SCV Instagram v137 custody

This is a product-specific custody record. It must not be copied into global
Codex or Claude instructions. Customer-derived state, the deployable runtime,
and private media remain private in R2 or the production platform and must
never be committed to this public repository.

## Active release

- Release ID: `scv-instagram-single-20260901-v137`
- Content fingerprint:
  `3138693d3cd33dc2dc58169e8f8f0b429b110946ee2ca817d9d71c7d1f2e8e17`
- Release manifest SHA-256:
  `4589e691360dbe78fb8d22a5d5298d38db2b1769df52859f65c59393df73cb4f`
- Private application archive:
  `scv-instagram-automation/release-ready/20260902T020631Z/v137/scv-instagram-single-20260902T020631Z-v137-april-production-business-lane.tar.gz`
- Application archive SHA-256:
  `7dcec7602da931d76d215569c4caa2359db7ad77c9695631b713510ad5d18b7e`
- Production deployment: `c5b92e67-1cbf-4865-95ba-455690a5360b`
- Staging deployment: `2cad42be-c456-4d21-9e75-aaeaa7ff04c5`

The regression was a control-plane mismatch rather than a new conversation
classifier failure. Production had `SCV_PAUSE_NON_TEST=1`, which held every
non-debug inbound before the ordinary reply pipeline. The readiness and
behavior contracts still accepted that test-lockdown state as healthy, so a
green deployment could remain silent for real business traffic. The April
golden configuration did not include that global business-lane hold.

v137 makes the production contract require `SCV_PAUSE_NON_TEST=0` exactly,
while staging retains its isolated test posture. Strict readiness now rejects
a production runtime when the global non-test hold is active. A dedicated
April-production liveness harness covers ordinary information requests,
late date or time changes during double-check, and visible fallback handling
without weakening the existing authority, media, identity, or safety gates.

## Verification

The exact Node `v20.20.2` full suite and sealed single-release suite passed.
Focused evidence includes the following:

- 11 April-production liveness checks for the production business lane and
  the exact hold-state regression;
- 756 booking checks, 10,010 closed-transition cases, 145 discourse cases,
  and 500 time-change fuzz cases; and
- the complete existing identity, authority, reply-liveness, media,
  date-change, drift, prompt, and April-tone regression suite.

The sealed v137 archive contains 246 manifest-listed files plus its manifest.
Every manifest hash was reproduced from a fresh local restore before upload.
Staging and production both return HTTP 200 from `/readyz` with the exact v137
release coordinates, zero critical drift, inactive fail-close, healthy voice
and vision canaries, and the dated visible model. All ten production workers
were running with zero restarts after the required reset. Production's one
operational alert remains unrelated preserved queue or quarantine state and
is not a critical drift alert.

## Timestamped recovery

- Private catalog pointer:
  `scv-instagram-automation/timestamped-snapshots/LATEST.json`
- Catalog control version: `20260902T020820Z`
- Snapshot count: `27`
- April golden snapshot, unchanged:
  `scv-instagram-20260420T152810-local-origin`
- v137 state immediately before the required post-fix Omar.system reset:
  `scv-instagram-20260902T020530Z-v137-pre-omar-reset`
- Current v137 state immediately after the reset:
  `scv-instagram-20260902T020532Z-v137-post-omar-reset-current`
- Catalog SHA-256:
  `a9417af1e899fb57694305c5b34887ea7587264072b2aabc87d6480de2789c69`
- Catalog seal SHA-256:
  `7f0c1fbffa5f0b23db58f08a86281d72a871d4c349ca095212a21aa3e0a564c4`
- Pre-reset production-state archive SHA-256:
  `d73b7ee267d9f39ee772917a485253398880e4df8722404108429a90c6ebdd1e`
- Post-reset production-state archive SHA-256:
  `4ad814fe0264f845b78c3887d50231b3ab73b93e636c065a9efdb74cadf3379b`
- Exact-target reset receipt SHA-256:
  `1a5ecd99fcf328de399e7a08685dc27b443aecfd8ce2c0229c8f6fe2808ff7aa`
- Pre-reset staged-restore receipt SHA-256:
  `6caebfe98c054c0d907bbeafd2380b6de144f8c38c61d93ce108c604e10f60fe`
- Post-reset staged-restore receipt SHA-256:
  `edb712a4a15bf51bc9712e6446a081eabab78366348e9121899a25adb696aeed`

All ten production workers were stopped and verified before capture. The
code-locked debug audit was zero both before and after the exact-target purge;
the zero-residual gate still ran, and the reset watermark, Gmail tombstones,
and private execution receipt were written. Every worker then resumed. The
pre-reset tree has 1,429 entries with tree hash
`ea148cb74bde5d705cec0f9516414a0392d1b3a959953d622d67e7151f3314bb`.
The post-reset tree has 1,429 entries with tree hash
`d12b61469b53c7728ddf53a916b50d4493f93dfe7416cd61fa196dbf6cdb7aab`.

The runtime archive, both state archives, reset receipt, catalog, seal, and
restore receipts were downloaded from R2 and checked byte for byte. The
published restore tool then restored both exact v137 timestamps into new
directories without mutating production. The April golden pointer remained
separate, the v137 post-reset point became current, and all earlier current
points were retained as history.

## Independent drift sentinel

- Worker: `scv-instagram-drift-sentinel`
- Worker version: `31da32c6-1ff4-4e9a-a645-08237974cdaa`
- Schedule: every five minutes
- Safe health endpoint:
  `https://scv-instagram-drift-sentinel.omar-git-r2-backup.workers.dev/health`
- Private attestation pointer:
  `scv-instagram-automation/drift-attestations/LATEST.json`

The Worker checks the exact v137 release ID, source fingerprint, release
manifest, critical drift, fail-close state, voice and vision capabilities, and
dated visible model. It also verifies the sealed 27-snapshot R2 timeline, the
distinct April golden and v137 current pointers, the pre-to-post reset link,
the zero-to-zero debug audit, the reset receipt hash, and both exact-ID staged
restore receipt hashes. Its source contains no credentials or customer message
content. The first scheduled v137 attestation at
`2026-09-02T02:20:03.000Z` passed production, staging, and snapshot control with
zero consecutive failures; its SHA-256 is
`dd2502410b26f1bc7e71cfdcf844ad461cffbac09f9957288e2ab18d7e831c9b`.
