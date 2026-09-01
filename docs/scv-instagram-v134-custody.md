# SCV Instagram v134 custody

This is a product-specific custody record. It must not be copied into global
Codex or Claude instructions. Customer-derived state, the deployable runtime,
and private writing references remain private in R2 or the production platform
and must never be committed to this public repository.

## Active release

- Release ID: `scv-instagram-single-20260901-v134`
- Content fingerprint:
  `5ed144c2c4de76c97168a18eed45ae28421b287737d8de96006387d2ffece92d`
- Release manifest SHA-256:
  `88efcb7dbe4124665f72c3451cf4504c024ea9a18a6a0ffb605ca16dbd4a0675`
- Private application archive:
  `scv-instagram-automation/release-ready/20260901T195801Z/v134/scv-instagram-single-20260901T195801Z-v134-info-liveness-recovery.tar.gz`
- Application archive SHA-256:
  `fd180204b155ee87905ecf3629291eb1a8de46f5f0bd45d779ec54f7c214017e`
- Production deployment: `d20a22bb-b606-43bf-bbf8-fb66cb3fbc7f`
- Staging deployment: `a9030a67-369a-405b-ace0-0303ab714ca8`

The incident was not an unsupported wording problem by itself. An intentional
operator hold for non-debug conversations was incorrectly classified as stale
queue drift, which armed the global fail-close latch shortly before the debug
message arrived. The held debug packet then crossed two incompatible recovery
classifications: valid operator recovery metadata also looked like synthetic
traffic to the fail-closed source gate.

v134 separates deliberate operator holds from causal stale drift, lets the
fail-close reconciler use preserved quarantine evidence, and permits a recovery
packet through the synthetic-source gate only when it carries a recent verified
operator envelope and the code-locked debug identity pair. A forged non-debug
identity is rejected. Inbox sweeping runs before authoritative recovery so a
recovered packet cannot be re-held behind its own stale artifact.

The previously missed debug turn was recovered through that exact path. Two
visible reply bubbles reached the ManyChat accepted boundary, after which the
sender correctly stopped instead of blind-resending an unconfirmed delivery.
No customer identifier or message text is included in this repository.

## Verification

The pinned Node 20 single-release suite passed. Focused gates included 68
information-intent explanations, 35 reply-liveness cases, 78 post-double-check
divergence cases, 271 contract cases, 68 pause cases, 50 stale/recovery
lifecycle cases, 59 closed-lifecycle cases, and 74 outbox-adoption cases. All
188 JavaScript files passed syntax checks. The exact recovery harness also
checked the release lock, fail-close evidence, identity lock, newest-user-turn
selection, prior receipt handling, and refusal cases.

Staging repeated the 50-case stale/recovery suite and the exact incident
recovery harness. Production and staging returned HTTP 200 from `/readyz` with
the v134 release ID and hashes, zero critical drift, inactive fail-close,
healthy voice and vision canaries, and the dated visible model. Production's
one operational alert is preserved unrelated quarantine evidence rather than a
critical drift condition.

## Timestamped recovery

- Private catalog pointer:
  `scv-instagram-automation/timestamped-snapshots/LATEST.json`
- Catalog control version: `20260901T200703Z`
- Snapshot count: `21`
- April golden snapshot, unchanged:
  `scv-instagram-20260420T152810-local-origin`
- v134 state immediately before the required post-fix Omar.system reset:
  `scv-instagram-20260901T195957Z-v134-pre-omar-reset`
- Current v134 state immediately after the reset:
  `scv-instagram-20260901T195959Z-v134-post-omar-reset-current`
- Catalog SHA-256:
  `fc538d4934e6656f1032cc376ea0bc86dea862281afa1dadb0ae7009ba416e2c`
- Catalog seal SHA-256:
  `dfb580e30a3448495fa6a648907f64e896909c78aad8181527893b21eb45ef0d`
- Pre-reset production-state archive SHA-256:
  `250dd8c6804bd549210c725c3d3125f3df6acb05e41465f5860adf2345f15177`
- Post-reset production-state archive SHA-256:
  `6fc5862cd98979067eb1fe2425df6b9344ee193d8b9c1daeeaee5c9a0ad3da5b`
- Exact-target reset receipt SHA-256:
  `1769ab22d00d37b050ddbdbf9653fb6d251739636e6474def86090b6951bc3cb`
- Pre-reset staged-restore receipt SHA-256:
  `890a997dcee590fbfee2efa513f18fd67f6fd057453a5f1df2c87e1f9d72895d`
- Post-reset staged-restore receipt SHA-256:
  `3b55847e41f43e2357536bbc50ebff0968ea3dc4fa3cf4619d82d54fc6739d01`

All ten production workers were stopped and verified before capture. The
code-locked debug audit changed from seven matching artifacts to zero, the
reset watermark was advanced, Gmail tombstones remained in place, and all ten
workers resumed. The pre-reset tree contains 1,399 entries with tree hash
`7a6d6a54ded5f355726c96a2de679884a5898644f6feabc9fe90dd8e8da4b2a4`.
The post-reset tree contains 1,392 entries with tree hash
`93ef49771dbb0ca64944c10b1fec063f3a330e3012328219d690fd20f84d12e9`.

The runtime and both state archives were downloaded from R2, checked byte for
byte, and restored into new staging directories. The downloaded pre-reset copy
reproduced seven debug matches and the downloaded post-reset copy reproduced
zero. After the new control objects were published, the control set was
downloaded again and performed a second exact-ID restore of both timestamps.
Every restore receipt records `production_mutated: false`. The golden pointer
was never moved or overlaid, and automatic production cutover remains disabled.

## Independent drift sentinel

- Worker: `scv-instagram-drift-sentinel`
- Worker version: `4a13d39d-6d8f-4076-8414-2f7a1f6c2ef5`
- Schedule: every five minutes
- Safe health endpoint:
  `https://scv-instagram-drift-sentinel.omar-git-r2-backup.workers.dev/health`
- Private attestation pointer:
  `scv-instagram-automation/drift-attestations/LATEST.json`

The Worker checks the exact v134 release ID, source fingerprint, release
manifest, critical drift, fail-close state, voice and vision capabilities, and
dated visible model. It also verifies the sealed 21-snapshot R2 timeline, the
distinct April golden and v134 current pointers, the pre-to-post reset link,
the seven-to-zero debug audit, the reset receipt hash, and both exact-ID staged
restore receipt hashes. Its source contains no credentials or customer message
content.
