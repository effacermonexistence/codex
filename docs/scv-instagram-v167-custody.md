# SCV Instagram v167 custody record (2026-09-08)

v167 treats every successfully described client picture as valid tattoo-design
reference authority, regardless of whether vision labels it as a product,
screenshot, selfie, document, or other non-tattoo content. Payment/deposit
evidence and attachments that could not be opened remain excluded.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260908-v167` |
| content fingerprint | `6b85a63a25c23e9815491413eeb895e6b78ed8faa523f18aefea6b88f392faa7` |
| release manifest sha256 | `2f12a00d12114bbbb05080438dda88a6278a82ae65a9fc9aaaff70a2a25ad4b6` |
| base | `scv-instagram-single-20260908-v166` |
| latest recovery Gold | `scv-instagram-recovery-gold-20260908T231500Z-v167` |
| previous recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (byte-identical and independently restorable) |
| staging deployment | `1b95a721-aac8-4086-9ce1-e9082dfc3aa1` |
| production deployment | `1f4fa0bf-5834-45a0-8648-27afeea929bc` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260908T203126Z/v167/scv-instagram-single-20260908-v167-any-picture-is-a-design-r2.tar.gz` sha256 `94ce2f59b5f3724118cfcabe16cfb7f267f00f7c6f01841be42dbf6c77e56afe` (1494324 bytes, readback byte-identical) |

## Verification and boundaries

- The sealed source has 259 manifest-listed files. Its local full suite passed.
  Staging verified all 259 installed files against the sealed manifest, then
  passed both the isolated single-release suite and the full suite. Production
  also reported the exact sealed release, fingerprint, and manifest after its
  deployment reached `SUCCESS`.
- The owner-passed live state was captured without a purge at `20260908T221005Z`
  (sha256 `0afeceee3d477e332c3e768ff675911560aa61882152d03c0570a6f9ed5b1fb0`),
  restore-drilled, uploaded under a separate Gold snapshot prefix, and read back
  byte-identically. The later code-locked Omar.system reset produced distinct
  pre/post snapshots at `20260908T221105Z` and `20260908T221109Z`; the post-audit
  found zero residual matches and all ten workers resumed.
- Recovery point `scv-instagram-20260908T221557Z-v167-clean-current` pins the
  sealed runtime, clean production state, owner-passed pre-reset capture,
  environment hashes, reset receipt, readiness, and red-team evidence. Its
  extension pins a 238,162,938-byte OS/dependency closure and seven server-side
  duplicated Secrets Store entries without exporting plaintext. A fresh Linux
  staging restore verified 259 runtime files and 2,609 state entries, then the
  full test suite passed in an empty allowlisted environment.
- v167 was explicitly promoted as a second dated Gold at `20260908T231500Z`.
  The v151 dated record remains 2,645 bytes with sha256
  `df23980a283223bd37517a55753f23ea3c56568ec2c443eceab6822a0ade9a6a`.
  Both Gold ids resolve independently; behavioral GOLD-3 v148 and the April
  Golden remain separate and unchanged.
- ManyChat configuration, customer identities and state, credentials, signed
  media URLs, private reset artifacts, and customer messages are excluded from
  this public record.

## Drift sentinel

Sentinel v29 (Worker version `6ae09ef5-0c85-40d7-a786-fda5ae532845`)
pins the exact v167 running release, the v167 recovery point, the v167 approved
Gold record and closure extension, while retaining v151 as the previous point.
Its first post-pointer scheduled run passed at `2026-09-08T23:25:45.000Z` with
15/15 pinned objects verified and zero consecutive failures. The immutable R2
attestation is
`scv-instagram-automation/drift-attestations/2026-09-08/20260908T232545000Z.json`
(sha256 `ade3ba6b478b82e582e590b9725214b008103bfb6158c77ceed85678e9b240db`),
verified by independent readback.
