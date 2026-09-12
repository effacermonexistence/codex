# SCV Instagram v172 source custody (2026-09-12)

This records read-only acquisition of an already-running release for OS1.
It does not deploy, reset, promote Gold, or enable customer traffic.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260912-v172` |
| content fingerprint | `5efa093308ef32400b20e7c193d38e387180b31a43ea0c2af5d36b91c2747acc` |
| release manifest sha256 | `eca63fd9b8e36ff0a7253b77b5c86a802871af9cfff989f55a6d8120f547dd56` |
| runtime archive (R2) | `scv-instagram-automation/source-custody/8fbc80f0e45c5d8d27cedfe2a0cb8b8f4074dc22d134c4b4fff1d55df285baca/source.tar.gz` sha256 `8fbc80f0e45c5d8d27cedfe2a0cb8b8f4074dc22d134c4b4fff1d55df285baca` (1575198 bytes, readback byte-identical) |

At 2026-09-12T20:25:12Z the authenticated operator checked /readyz before and
after acquiring only the current container's 267 manifest-listed source files
and SCV_SINGLE_RELEASE.json. Every source size and SHA-256 matched the live
manifest. Symlinks, traversal and state/credential archive paths were rejected.
The archive uses portable ustar; R2 readback matched its SHA-256 and byte count.
Installed OS1 build 103 source-register independently accepted all 267 files
against the live manifest without changing production.

The server reported production active, critical alerts 0, operational alerts 2.
Its behavior-contract identity remains Omar.system-only. This acquisition does
not verify customer-visible delivery or change audience/pause/ManyChat settings.
Sources remain in the existing private bucket; this public record contains only
identifiers, hashes and retrieval metadata. Recovery pointers, dated Gold and
historical baselines are unchanged.
