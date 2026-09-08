# SCV Instagram v164 custody record (2026-09-08)

v164 fixes the verified context-grounding regression: an artist-biography
question remains a biography answer rather than an intake prompt, and an
ad-grounded transcription/context typo such as “motto” is treated as “model”
only when the current conversation provides evidence for that reading. The
release has deterministic local regressions for both the positive case and the
literal/negative/quoted counterexamples.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260908-v164` |
| content fingerprint | `2a0df8936a5fc6cfb2c1f00269ee2e532bc3874126b14f1b81228ebefc997baf` |
| release manifest sha256 | `b4ff6613aa8bc9931c7176d79b20874154c5f8308bd6559a02ead46326d7bd16` |
| base | `scv-instagram-single-20260907-v163` |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `329aaa60-73cd-4db8-bcda-ac9a311f9c2a` |
| production deployment | `e4a599e7-33a1-4157-b3c3-e646b02deeed` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260908T030000Z/v164/scv-instagram-single-20260908T030000Z-v164-context-grounded-intent.tar.gz` sha256 `feefe24fa14216543eafc5e589cd189d0c65d7e58ce40971df1b7e615fea0bdc` (1479451 bytes, readback byte-identical) |

## Verification and boundaries

- The sealed release passed the full local suite, the 65-case context-grounding
  harness, the 122-check hard lock, and the focused incident controls (56/56
  and 50/50). The staged container verified all 257 manifest-listed files and
  completed its isolated single-release and full suites without live runtime
  variables.
- After production readiness verified the exact release pin, the fresh
  code-locked Omar.system reset recorded pre/post snapshots, restore drills,
  residual count 0, and pause/resume verification for all 10 runtime workers.
  The three private artifacts were read back byte-identically from the separate
  timestamped R2 custody prefix. This release's reset does not reuse a prior
  release receipt.
- The recovery Gold remains v151. Behavioral GOLD-3 v148 and the April Golden
  remain separate and unchanged. This record is not a Gold promotion or a
  production restore request.
- ManyChat configuration, customer identities and state, credentials, signed
  media URLs, and customer messages are excluded from this public record.

## Drift sentinel

The drift sentinel v25 pins the active v164 release separately from the v151
recovery Gold. Its deployment attestation is recorded alongside the sentinel
source after the first healthy scheduled run.
