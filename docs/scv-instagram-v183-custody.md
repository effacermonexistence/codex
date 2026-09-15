# SCV Instagram v183 conversation lead + any client language custody (2026-09-14)

This records the build-lane release that replaced v182 on the same day. It does not promote Gold,
enable customer traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v183` |
| content fingerprint | `6fe861b48bd12aedb02306b64f4a3d461dcc94722ecbfdf8211edf1ce92b5a4c` |
| release manifest sha256 | `0e93b11cbfc308e6c62dbe5c9965a4b51400cd30a5ac1ff1f8e441397562304f` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260914T133149Z/v183/runtime/scv-instagram-single-20260914-v183-runtime.tar.gz` sha256 `af1d0bb6a9485268e793a8c768bb05aa0e6e35b5e6304baa00af38e19c7cee79` (1645917 bytes) |

## Requested conversation change (owner orders 2026-09-14)

On sealed v182 the Omar.system red team (12:46–12:50Z) received five adopted lines in a row that only reported the
owner's own day ("지금 잠깐 쉬는 중이야 좀 정신 없었어" … "정리만 했는데도 하루가 훅 갔네"); the client had to dig four times.
Every turn's first candidate closed on "너는?" and was rejected by the v182 mirror-back ban, whose instruction named no
replacement move, and no law required a lead. The owner's order: the persona must lead the conversation toward closer
familiarity. The second order: every client-visible line, deterministic lines included, must ship in whatever language the
client writes, not only in the fr/es/ko fast-path catalog.

v183: `scv-client-voice-law.js` v4 adds the lead law (`verifyConversationLead`: a social reply without a question, a
proposal or an address to the client, right after a delivered turn without one, is rejected as `voice_passive_no_lead`
and re-authored with a lead; the mirror-back and streak instructions now name the replacement move); the control plane
runs it with the pass budget so the final pass never falls to the clarification recovery; `scv-client-language.js`
renders a deterministic line through the bounded translator (token-verified, repeat-gated, Korean register carried)
before any English fallback, on any valid language tag; the social author and the convergence / relationship locks carry
the lead sentence. Preserved: identity source bytes (`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`),
the v180 persona, v181 answer-continuity and v182 social-referent laws, CLIENT_LANGUAGE_VERSION and the catalog pin,
booking/deposit gates, the romantic-boundary sentences, transport/durability paths, ManyChat configuration, staging v168,
Gold pins.

## Executed verification

- Active Railway deployment `e8c856d2-1547-4ea8-a8dd-b8e90612ea86`; 281 installed sealed-file hashes verified; 14 installed harnesses
- Regression ledger: 110 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-mini-2026-03-17` in the production container scratch root: 9 of 9 adopted,
  including the exact live passive sequence (one emulated re-author pass) and deterministic lines rendered by the real
  translator on Japanese, German and Korean threads; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-14T13:30:59.477Z`: residual 7 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 281 files, 14 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260914T133149Z/v183/v183-r2-manifest.json` sha256 `bd959c6d7c9c9cb98f4207af488b3c53a87181c3e499a050b29a09eb21304142`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v182 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v44/v183 Worker version `76d8560d-edc4-40c0-81de-293c791a80fa`, first v44 scheduled run `2026-09-14T13:35:04.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-14/20260914T133504000Z.json` sha256 `bbc4c4f4000de709cda7406b356aaafaa4ccd469deba840c841d541789894aa5` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
