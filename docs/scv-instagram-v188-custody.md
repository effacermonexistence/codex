# SCV Instagram v188 no-template-in-conversation custody (2026-09-15)

This records the build-lane release that replaced v187 on the same night. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v188` |
| content fingerprint | `02e10736092d6cf78d79b0a1992ecd73277b480fb819939b04f798b315b6a2a6` |
| release manifest sha256 | `5296a24b3a50b386ed6fa84dd880e9f3f01930316403c6069947264486566d4a` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260915T164647Z/v188/runtime/scv-instagram-single-20260914-v188-runtime.tar.gz` sha256 `5f3ee442e299a987869140dc33f07eda24daac930f803610a46a40f1798e0211` (1662347 bytes) |

## Requested conversation change (owner order 2026-09-15)

On sealed v187 (nano) the Omar.system red team received "너는 지금 뭐에 꽂혀 있어" bolted onto "야, 뭐 하냐?", and for "몰라 씹할" the
template "방금 답이 안 나갔어 한 번만 다시 해줄래?" after three voice rejections (voice_double_ask, voice_mirror_back_tail ×2):
the post-loop liveness scan skipped every voice-rejected candidate unconditionally, so three model lines became a template on a
plain conversation — the owner had already forbidden templates outside the tattoo lanes.

v188: `scv-single-control-plane.js` adopts, after the re-author budget is spent on a social_continue / general_continue turn, the
newest model line that passed every hard gate and failed only a question-shape voice law (`control_candidate_voice_liveness_adopted`,
reason `voice:<law>`); the final pass of a social turn asks for a plain line without a question; identity leaks (persona
disclaimer, unsolicited helper offer) stay hard and the booking lanes keep their deterministic recovery unchanged.
`scv-client-voice-law.js` rejects an interest survey (뭐에 꽂혀 있어 / what are you into: 1 of 4,619 Korean and 0 of 61,772 English
lines in the owner's archive) and the author's bare-opener lead is a short 왜 / what's up beat or none. Preserved: models (nano),
routes, literals, identity source bytes (`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates,
the v180–v187 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `7ce687c0-d974-4c9b-9c4d-61a53638e3f6`; 284 installed sealed-file hashes verified; 17 installed harnesses
- Regression ledger: 113 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 4 of 4 adopted after at most one
  emulated re-author pass, 5 author calls, including the exact live 몰라 씹할 turn; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-15T16:46:33.223Z`: residual 5 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 284 files, 17 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260915T164647Z/v188/v188-r2-manifest.json` sha256 `ea832ed569906230df222da4374f8f8c2b240a3420f8bfe1c369a61ca1ee5a75`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v187 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v50/v188 Worker version `a2a766d7-cf1f-49cb-b656-2d0597ed86e4`, first v50 scheduled run `2026-09-15T16:50:26.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-15/20260915T165026000Z.json` sha256 `c2c63ad7c9f4fe2aa1d13b3405d87c9690b6c01cd7419b41ff8519b94b62b0ec` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
