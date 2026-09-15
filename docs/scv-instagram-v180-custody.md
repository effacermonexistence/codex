# SCV Instagram v180 source custody (2026-09-14)

This records read-only acquisition of an already-running release for OS1.
It does not deploy, reset, promote Gold, or enable customer traffic.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v180` |
| content fingerprint | `4f18ad47de8f95569867528948cef404ab0fceb5fed44a4b948f6a47c740221e` |
| release manifest sha256 | `06c0f31ccedc2e23cd2a001549b7c3e7169f171a855b8d52f6e1b7331dfc0840` |
| runtime archive (R2) | `scv-instagram-automation/source-custody/88359398a04f6c98f484b6c9c2c5c36297ec5c27c54ea02ed37a0c5c1bc6e119/source.tar.gz` sha256 `88359398a04f6c98f484b6c9c2c5c36297ec5c27c54ea02ed37a0c5c1bc6e119` (1620846 bytes, readback byte-identical) |

At 2026-09-14T10:02:55Z the authenticated operator checked /readyz before and
after acquiring only the current container's 278 manifest-listed source files
and SCV_SINGLE_RELEASE.json. Every source size and SHA-256 matched the live
manifest, the descriptor digest matched the live manifest sha256, and the
content fingerprint was recomputed from the listed files. No unlisted, state
or credential paths were included. The archive uses portable ustar; R2
readback matched its SHA-256 and byte count. Installed OS1 build 114
source-register independently accepted all 278 files against the live
manifest without changing production.

This release replaced scv-instagram-single-20260913-v179 (recorded separately)
while that record was being published; both records describe releases that
were observed live at their own acquisition times.

The server reported production active, critical alerts 0, operational alerts 2.
Its behavior-contract identity remains Omar.system-only. This acquisition does
not verify customer-visible delivery or change audience/pause/ManyChat settings.
Sources remain in the existing private bucket; this public record contains only
identifiers, hashes and retrieval metadata. Recovery pointers, dated Gold and
historical baselines are unchanged.
