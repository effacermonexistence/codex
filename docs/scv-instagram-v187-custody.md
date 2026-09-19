# SCV Instagram v187 question-register custody (2026-09-15)

This records the build-lane release that replaced v186 on the same night. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v187` |
| content fingerprint | `721e3ff1d6e612f7f98fe09819a9817b67edb2fc24aeb6363dd1db6007e28181` |
| release manifest sha256 | `4618b94e12d0386ba41f91baab00f1ff1c7fd6fde3982abfed526136446f5c2e` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260915T020226Z/v187/runtime/scv-instagram-single-20260914-v187-runtime.tar.gz` sha256 `b8b34c633599410e5b8f070447b793316f4f30e3f914511e22a3f6f1662812ad` (1656718 bytes) |

## Requested conversation change (owner order 2026-09-15)

On sealed v186 (nano) the Omar.system red team received "너 지금 뭐 보고 있어 장르랑 분위기 알려줘" ("What are you watching right now
Tell me the genre and the vibe") — an interview line no verifier knew. The owner's own outbound archive (sha
`9c16de2f979eaf0d698f027903f32151bdb0db13577f64a3574f73b88b30ad68`, aggregates only, no line copied into the runtime) says his
Korean questions are three words at the median and thirteen at p99, details-request imperatives are 0.28 percent of his Korean
lines and two question words in one question 0.5 percent; his English questions are twenty words at p99 with two wh-words in
0.4 percent.

v187: `scv-client-voice-law.js` v5 (`verifyQuestionRegister`: a details-request imperative, a double ask or a question past the
owner's p99 is `voice_details_request` / `voice_double_ask` / `voice_question_too_long` in the social lanes, re-authored with the
answer kept and one short question or none, never on the final pass; funnel lanes exempt), the control plane runs it after the
lead law, and the author's lead sentence plus the mirror-back instruction say the same. Preserved: models (nano), routes,
literals, identity source bytes (`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, the
v180–v186 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `9d7f239a-2788-4bca-99ab-20151756c2f7`; 283 installed sealed-file hashes verified; 16 installed harnesses
- Regression ledger: 112 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 4 of 4 adopted after at most one
  emulated re-author pass, 4 author calls, including the exact live Netflix turn; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-15T01:56:44.141Z`: residual 6 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 283 files, 16 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260915T020226Z/v187/v187-r2-manifest.json` sha256 `ef707d67a3ca8fa9058be8bd4f0de25a398d63f1e1745edc93b28915d1d8ba40`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v186 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v49/v187 Worker version `bf5c0251-c6e6-41ed-b94d-689baccccf9c`, first v49 scheduled run `2026-09-15T02:00:57.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-15/20260915T020057000Z.json` sha256 `58b6e516559a2aa5765954f36b74c36d310d9e480d510d282a60ad648b497f83` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
