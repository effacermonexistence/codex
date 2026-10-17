# SCV Instagram v191 internet-register custody (2026-09-15)

This records the build-lane release that replaced v190 on the same night. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v191` |
| content fingerprint | `829de31e667d4413f6ed5104341e4bb0f361a7c2e3a1e730cc05fc47b6d537a8` |
| release manifest sha256 | `8f3d0d8f9ac19a1251a1a081cb9cff77a1f0ec493dd9daa5a52f8cc82bd8ac8b` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260915T194132Z/v191/runtime/scv-instagram-single-20260914-v191-runtime.tar.gz` sha256 `b4349a7673d9c490c27b807ea1cd3eafa9f31d2b8716c40b48dc7091fd9b509a` (1706200 bytes) |

## Requested conversation change (owner order 2026-09-15)

On sealed v190 (nano) the Omar.system red team sent "주말에 노실?" — the clipped -(으)실래요? invitation of Korean internet chat — and the
canonicalizer read it as "Are you free on the weekend?", so the reply reported the owner's own weekend instead of answering the
invitation; "같이 놀자고" then got "이번 주말엔 뭐가 끌려?", the assistant's question. The owner's own forms: "놀지 / 어 나도 놀지 / 아 난 노실?"
and "뭐할건데?".

v191 adds `scv-internet-register.js`: per-language glossaries of the forms people actually type (read as written) in the
canonicalization prompt for Korean, French and Spanish, an explicit hint that a -실? line invites the reader, the 뭐가 끌려 class in
the Korean register law (v2) with the invitation answer in the owner's forms, the owner's English register measured on his 54,020
English lines (lowercase 98.5%, "!" 27%, deffo / oki / ouh / tysm / lmk / plz; the assistant phrases at zero) as a law of its own on
English threads, and one author register block per supported language (French and Spanish inheriting the Latin shape plus a glossary).
Preserved: models (nano), routes, literals, identity source bytes (`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`),
booking/deposit gates, templates, the translator's existing rules, the v180–v190 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `dd1476d8-bd9e-43c6-8fc6-38d163710e53`; 289 installed sealed-file hashes verified; 20 installed harnesses
- Regression ledger: 116 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 2 of 3 adopted after at most one
  emulated re-author pass, 11 author calls, including the exact live invitation turns (주말에 노실? / 같이 놀자고); 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-15T19:42:24.079Z`: residual 9 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 289 files, 20 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260915T194132Z/v191/v191-r2-manifest.json` sha256 `0eef4aa52999427778b9929b1dc74125f20d89e59514d2bb0a3420a95c328d08`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v190 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v53/v191 Worker version `0e26dc9b-ffe3-4c81-82b3-22f1e5713ff1`, first v53 scheduled run `2026-09-15T19:50:26.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-15/20260915T195026000Z.json` sha256 `96edd47ceb32816de8296e086dde68c5e9754b5ec7c52065be47d68a09ef161e` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
