# SCV Instagram v182 social referent custody (2026-09-14)

This records the build-lane release that replaced v181 on the same day. It does not promote Gold,
enable customer traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v182` |
| content fingerprint | `05f9e84745f93b0bcb86835702e391b4183671bed4b57c23b6e615227ffcfac2` |
| release manifest sha256 | `17da72563c358ca48947d0f845e654b6226f3fde80960b828255516a840b7fd6` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260914T122623Z/v182/runtime/scv-instagram-single-20260914-v182-runtime.tar.gz` sha256 `ab41a7a60e7f4d3f7945b2123c6aefe7b5802a7c75605e569da9c27376595f56` (1635591 bytes) |

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

- Active Railway deployment `677a4dac-8f06-4718-aa5a-e091f8b7be60`; 280 installed sealed-file hashes verified; 13 installed harnesses
- Regression ledger: 109 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-mini-2026-03-17` in the production container scratch root: 3 of 6 adopted,
  including the exact live turn and its variants; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-14T12:25:17.143Z`: residual 12 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 280 files, 13 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260914T122623Z/v182/v182-r2-manifest.json` sha256 `dc92856085136faf0390fdef2e75f47eb6b650e13b50c9a38d5defb6c8fedd11`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v181 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v43/v182 Worker version `1a0236d5-7fcd-4a50-947a-199d9dada843`, first v43 scheduled run `2026-09-14T12:35:04.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-14/20260914T123504000Z.json` sha256 `df4e098b8a65e3a50a52d0072e187f62fd16d11f77c5136c0693b2b7edf51bd9` downloaded from R2 and hash verified; the aggregate stays 503 by design while staging v168 remains pinned apart.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
