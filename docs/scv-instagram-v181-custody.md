# SCV Instagram v181 answer continuity custody (2026-09-14)

This records the build-lane release that replaced v180 on the same day. It does not promote Gold,
enable customer traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v181` |
| content fingerprint | `7df1aba96905e7bc6728b9bc65bb14008c6172e6a3cce4041b03c8d1a08b39f6` |
| release manifest sha256 | `b5e6007b01127519496b6ed61b8a565905be7bd1f2abdbe8162b578fe39a33c5` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260914T110000Z/v181/runtime/scv-instagram-single-20260914-v181-runtime.tar.gz` sha256 `f6edb16a17e36767573faf7472e21e990f8ac9333a792d5dbe8631af633140f3` (1628319 bytes) |

## Requested conversation change (owner order 2026-09-14)

On sealed v180 the Omar.system red team hit: assistant "어디까지 봤어?" → client "나 지금 A 에피소드 원인데 존나 여러번 보고 있음"
→ route `resolve_context` (`ambiguous_missing_referent`), three natural answers rejected, and the clarification template
"뭘 말하는 거예요? 조금만 더 알려줘요" (해요체) shipped into a banmal thread. Storage was intact (eight persisted events);
the interpretation layer counted the numeral "one" plus "it" as two unresolved pointers and never modelled the client
answering the assistant's own question (archive law: RCC PART 13 ICC — never judge surface words before modelling the
system that produced them).

v181: `scv-discourse-continuity.js` v25 treats a non-question reply to the assistant's immediately preceding question as
the answer (never a missing referent) and stops counting a numeral "one" as a pointer; `scv-client-language-templates.js`
v2 renders the eight clarification / recovery lines in banmal when the client's own Korean is banmal (`koreanRegisterFromHistory`);
`verifyProtectedTokens` lets a spelled canonical number render as its digit; the commit-time renderer receives the thread
history. Preserved: identity source bytes (`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), the v180
unified owner persona law, booking/deposit gates, punctuation policy, transport/durability paths, ManyChat configuration,
staging v168, Gold pins.

## Executed verification

- Active Railway deployment `0b7efa22-c9bf-4bfa-9d99-ce8f41f1c7f1`; 279 installed sealed-file hashes verified; 12 installed harnesses
- Regression ledger: 108 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-mini-2026-03-17` in the production container scratch root: 6 of 7 adopted,
  including the exact live turn and its variants; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-14T10:58:47.019Z`: residual 6 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 279 files, 12 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260914T110000Z/v181/v181-r2-manifest.json` sha256 `3b5b51c4292294af52ba4bad10bc00cf91d0edfc063c3ab50695336fefcd64ae`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v180 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v42/v181 Worker version `73a470b5-1cb2-4d2c-9c45-8adb7878a2ca`, first v42 scheduled run `2026-09-14T11:05:47.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-14/20260914T110547000Z.json` sha256 `333c948626239cb0dbcc8357978fb6de993757e82f7efcb07b729a9df4cc7be3` downloaded from R2 and hash verified; the aggregate stays 503 by design while staging v168 remains pinned apart.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
