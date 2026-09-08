# SCV Instagram v166 custody record (2026-09-08)

v166 preserves authenticated tattoo-reference picture evidence when a following
text message supersedes the original media turn before its durable state commit.
It also resolves explicit references such as “the picture” against that durable
evidence and keeps an already-open application-form offer from falling back into
another design interview.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260908-v166` |
| content fingerprint | `61816561349e8a36d6657164f2526b0bfbc07b5579ac2472301d7c9e32449555` |
| release manifest sha256 | `a3a649254c1800abb8dcd57a4c3c4c3385461e239552e09c11ba4fd457888a37` |
| base | `scv-instagram-single-20260908-v165` |
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `2b6b3f9d-fc67-4194-af74-a5f793d4d73f` |
| production deployment | `47db2ae7-2e53-4012-8769-6c668bfa55dd` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260908T192900Z/v166/scv-instagram-single-20260908-v166-media-memory-r2.tar.gz` sha256 `c5bec3b38da5b16080658c062c2c732dfe903087dd9d0355be121d30a2e0e6e7` (1489158 bytes, readback byte-identical) |

## Verification and boundaries

- The sealed source has 259 manifest-listed files. Its local full suite passed,
  and staging verified every installed file against the sealed manifest. The
  installed focused harness, isolated single-release suite, and isolated full
  suite also passed.
- Production readiness returned the exact v166 release, fingerprint, and
  manifest with `fail_close_active: false` before the reset and again after it.
  The fresh code-locked Omar.system reset recorded independent pre/post
  snapshots (`20260908T193824Z` and `20260908T193830Z`), passed both restore
  drills, found zero residual records after purge, and paused then resumed all
  10 runtime workers. The three private reset artifacts were read back
  byte-identically from the timestamped R2 custody prefix.
- The recovery Gold remains v151. Behavioral GOLD-3 v148 and the April Golden
  remain separate and unchanged. This record is neither a Gold promotion nor a
  production restore request.
- ManyChat configuration, customer identities and state, credentials, signed
  media URLs, private reset artifacts, and customer messages are excluded from
  this public record.

## Drift sentinel

The v27 sentinel pins this v166 release independently of recovery Gold v151.
Cloudflare Worker version `1c28add7-361c-4554-9389-d874ecd7c39a` completed its
first scheduled healthy run at `2026-09-08T19:40:37Z`: both production and
staging matched the exact v166 pins, with zero consecutive failures. Its
private R2 attestation SHA-256 is
`004c47149c2c6e1efb3ea5f2438119b37fa72124ada5982c97472e8feaddc481`.
