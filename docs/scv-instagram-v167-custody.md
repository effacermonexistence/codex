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
| recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (unchanged) |
| staging deployment | `1b95a721-aac8-4086-9ce1-e9082dfc3aa1` |
| production deployment | `1f4fa0bf-5834-45a0-8648-27afeea929bc` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260908T203126Z/v167/scv-instagram-single-20260908-v167-any-picture-is-a-design-r2.tar.gz` sha256 `94ce2f59b5f3724118cfcabe16cfb7f267f00f7c6f01841be42dbf6c77e56afe` (1494324 bytes, readback byte-identical) |

## Verification and boundaries

- The sealed source has 259 manifest-listed files. Its local full suite passed.
  Staging verified all 259 installed files against the sealed manifest, then
  passed both the isolated single-release suite and the full suite. Production
  also reported the exact sealed release, fingerprint, and manifest after its
  deployment reached `SUCCESS`.
- A fresh code-locked Omar.system reset completed after the v167 production
  deployment. The pre-reset snapshot (`20260908T203613Z`, sha256
  `e7f0de3f1522c729eb95f9ab79fdcbbead57081962ee95def66189708d7f9c76`)
  and distinct post-reset snapshot (`20260908T203619Z`, sha256
  `8e4a5e8d3ca8ba6f357767ac4a3bbb0042a297328ddfa8d41723e24a7528e602`)
  both passed restore drills. The post-audit found zero residual matches, all
  ten workers resumed, and the two snapshots plus the private execution
  receipt were uploaded to the timestamped R2 prefix and read back
  byte-identically.
- The recovery Gold remains v151. Behavioral GOLD-3 v148 and the April Golden
  remain separate and unchanged. This record is neither a Gold promotion nor a
  production restore request.
- ManyChat configuration, customer identities and state, credentials, signed
  media URLs, private reset artifacts, and customer messages are excluded from
  this public record.

## Drift sentinel

Sentinel v28 (Worker version `231b8be8-ccf2-4f1d-83cb-ab9b6682a9a3`)
pins the exact v167 release while preserving recovery Gold v151. Its first
scheduled run passed at `2026-09-08T20:40:19.000Z` with zero consecutive
failures. The immutable R2 attestation is
`scv-instagram-automation/drift-attestations/2026-09-08/20260908T204019000Z.json`
(sha256 `95949000c31175290ab7ab2668d7207ca0894b72d449af7c79243e97b4ed711b`),
verified by independent readback.
