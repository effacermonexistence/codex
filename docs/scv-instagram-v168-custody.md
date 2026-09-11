# SCV Instagram v168 custody record (2026-09-11)

v168 is an emergency containment release, sealed and deployed by Codex on
2026-09-11 after bot messages reached a real account while production ran with
the non-test pause off. Production is now hard-coded to the single debug
identity: every packet that is not the exact `omar.system` username plus
contact id pair is held by the pause gate, the operational preflight requires
the non-test pause to be on, the behavior contract pins the allow-list values
exactly, and readiness verifies both that the debug route is open and that a
non-debug route is closed. No customer-facing wording changed against v167.

## Active release

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260911-v168` |
| content fingerprint | `b8fe57d29bc953f63841df793566ffaedb85d32ffd6b6a60edbb96d963cc12a9` |
| release manifest sha256 | `ff8210a07688022481e5c12b4562e24e53a5531633fe3b0248ce56072cf556ec` |
| base | `scv-instagram-single-20260908-v167` |
| latest recovery Gold | `scv-instagram-recovery-gold-20260908T231500Z-v167` (unchanged; v168 is not a recovery Gold) |
| previous recovery Gold | `scv-instagram-recovery-gold-20260905T054647Z-v151` (byte-identical and independently restorable) |
| staging deployment | `1f2201a7-8c82-4a47-8e25-8d20eec54adc` (the same sealed v168, deployed for sentinel parity on 2026-09-11 17:57Z) |
| production deployment | `2a3929e3-7e44-4843-9218-96853517980b` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260911T174414Z/v168/scv-instagram-single-20260911-v168-omar-only-emergency-r2.tar.gz` sha256 `88e1e5b548082865c849b15df22537c6e2b140f99fd21d3cd8a313c7cecc2300` (1494693 bytes, readback byte-identical) |

## Verification and boundaries

- The sealed source has 259 manifest-listed files; ten differ from v167
  (`scv-pause-gate.js`, `scv-cloud-runtime-safety.js`,
  `scv-runtime-behavior-contract.js`, `inbound-scv.js` readiness, and their
  harnesses). Codex reported the full single-release verification passing before
  the production upload, and the production container reported the exact sealed
  release, fingerprint, and manifest at `/readyz` after deployment
  `2a3929e3-7e44-4843-9218-96853517980b` reached `SUCCESS`.
- Earlier attempts to restart v167 under the containment environment failed the
  production preflight by design (`0b13a0e0-75f3-4c74-bdd4-b5dd4d505661`
  `FAILED`); v168 exists because the omar.system-only posture had to be sealed
  into code rather than left to an environment flip.
- The code-locked Omar.system reset ran after deployment against
  `2a3929e3-7e44-4843-9218-96853517980b` (receipt sha256
  `c04f93cc03bbf8f2be056ae968277abebe9f53304004501a46a35985f22d1fbc`); the
  post-reset audit found zero residual entries before and after, all ten
  workers were paused, verified and resumed, and no send attempt was recorded
  after the reset.
- The runtime archive above was packaged from the sealed tree on 2026-09-11 and
  read back from R2 byte-identically. v168 has no recovery point of its own; the
  v167 recovery point, its extension, and both dated Golds remain the restore
  baselines.
- ManyChat configuration, customer identities and state, credentials, signed
  media URLs, private reset artifacts, and customer messages are excluded from
  this public record.

## Drift sentinel

Sentinel v30 (Worker version `f5edb45e-27ea-49bd-94f3-1bc9f4632e36`) pins the exact v168
running release while retaining the v167 recovery point, the v167 approved Gold record and
closure extension, and v151 as the previous point. Its first passing scheduled run against both
production and staging on v168 completed at `2026-09-11T18:00:23.000Z` with zero consecutive failures. The immutable
R2 attestation is `scv-instagram-automation/drift-attestations/2026-09-11/20260911T180023000Z.json` (sha256 `7228edb085566d6af72966464a1f42bea2bc0f28f5e17e91bd59202a50e5238f`), verified by independent readback.
