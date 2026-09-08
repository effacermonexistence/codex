# SCV Instagram v165 custody record (2026-09-08)

v165 replaces the robotic double-check copy with the owner-approved natural
wording while retaining the exact four booking fields. It also repairs visible
checkpoint reconstruction so a later client correction is compared against the
actual previously sent checkpoint, rather than being treated as absent.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260908-v165` |
| content fingerprint | `312b964f793c82ae6f73dbce9e60c4dfeab5a4c97d644f3b662e5092ce266aa8` |
| release manifest sha256 | `569002bf3392725473c48dc136964ed558ce93a6bee4d164a71a7ecde768210c` |
| base | `scv-instagram-single-20260908-v164` |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `e6d0c85d-654d-4b15-96bd-fc2cf37fc773` |
| production deployment | `cd34a8d2-8e74-49b6-b94f-e727a4708c12` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260908T055826Z/v165/scv-instagram-single-20260908-v165-checkpoint-human-history-parser-r2.tar.gz` sha256 `c9e6bc2de56c59fbcf0e5e1f7e1203ba7aafce7f78f2bef59090577622c463d1` (1481467 bytes, readback byte-identical) |

## Verification and boundaries

- The sealed source has 258 manifest-listed files. It passed the full local
  suite, the hard harness, release seal checks, and the focused human-wording
  harness. In staging, all 258 installed files verified against the manifest;
  isolated single-release and full suites both passed.
- Production readiness returned the exact v165 release, fingerprint, and
  manifest with `fail_close_active: false` before the reset and again after it.
  The fresh code-locked Omar.system reset recorded independent pre/post
  snapshots (`20260908T060332Z` and `20260908T060338Z`), passed both restore
  drills, found zero residual records after purge, and paused then resumed all
  10 runtime workers. The three private reset artifacts were read back
  byte-identically from the timestamped R2 custody prefix.
- The recovery Gold remains v151. Behavioral GOLD-3 v148 and the April Golden
  remain separate and unchanged. This record is neither a Gold promotion nor a
  production restore request.
- ManyChat configuration, customer identities and state, credentials, signed
  media URLs, and customer messages are excluded from this public record.

## Drift sentinel

The v26 sentinel pins this v165 release independently of recovery Gold v151.
Cloudflare Worker version `3392d999-45af-47a0-8c7e-0f232584e7a5` completed its
first scheduled healthy run at `2026-09-08T06:10:01Z`: both production and
staging matched the exact v165 pins, with zero consecutive failures. Its
private R2 attestation SHA-256 is
`28831bfdd2cdefa6d783d09a13de6c6b7dd52ad7eacc4e7a23a3f76152fae30a`.
