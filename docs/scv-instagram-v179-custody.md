# SCV Instagram v179 source custody (2026-09-14)

This records read-only acquisition of an already-running release for OS1.
It does not deploy, reset, promote Gold, or enable customer traffic.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260913-v179` |
| content fingerprint | `95a882ff40bfe5c995a990ed8b08d5fbf0702a84d690c33ce4e295f54d3e10b4` |
| release manifest sha256 | `cd571d4009ccea8064b6bb0a6d74ed824464c2d6e6c39ac02216d2ef3eac496e` |
| runtime archive (R2) | `scv-instagram-automation/source-custody/66ac66fa0fa3a1f1b7c4728d12dfa14e28558b04f6622a335368dfb84fb82683/source.tar.gz` sha256 `66ac66fa0fa3a1f1b7c4728d12dfa14e28558b04f6622a335368dfb84fb82683` (1611696 bytes, readback byte-identical) |

At 2026-09-14T09:22:25Z the authenticated operator checked /readyz before and
after acquiring only the current container's 276 manifest-listed source files
and SCV_SINGLE_RELEASE.json. Every source size and SHA-256 matched the live
manifest, the descriptor digest matched the live manifest sha256, and the
content fingerprint was recomputed from the listed files. No unlisted, state
or credential paths were included. The archive uses portable ustar; R2
readback matched its SHA-256 and byte count. Installed OS1 build 114
source-register independently accepted all 276 files against the live
manifest without changing production.

The server reported production active, critical alerts 0, operational alerts 2.
Its behavior-contract identity remains Omar.system-only. This acquisition does
not verify customer-visible delivery or change audience/pause/ManyChat settings.
Sources remain in the existing private bucket; this public record contains only
identifiers, hashes and retrieval metadata. Recovery pointers, dated Gold and
historical baselines are unchanged.
