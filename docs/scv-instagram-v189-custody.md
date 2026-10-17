# SCV Instagram v189 archive-convergence custody (2026-09-15)

This records the build-lane release that replaced v188 on the same night. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v189` |
| content fingerprint | `6348e0488bacd50148191a7b0bc31cda0fef5610cd04c2a14e5a2bb4d423fe85` |
| release manifest sha256 | `de2850214f8241d440bcd5dd5498c48ac9c531f5c89cd7a851f1481cde78f457` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260915T175656Z/v189/runtime/scv-instagram-single-20260914-v189-runtime.tar.gz` sha256 `624cc6e0b0e7c12263ce7251792cfaa44673fcfb43bf86bbd0ae39c7f90595b9` (1682254 bytes) |

## Requested conversation change (owner order 2026-09-15)

On sealed v188 (nano) the Omar.system red team received a question in three turns of three ("너 지금 집이야 밖이야?", "지금 체크인
중이야 아니면 쉬는 중이야", "…그게 제일 궁금해"), the owner's own state restated ("나도 적당히 잘 지내고 있어" then "나도 잘 지내고 있어")
and unsolicited advice ("오늘은 딱 10분만 복도나 창가로 나가서 바람 한번 쐬고 다시 들어와"). The alternative and indirect questions carried
no "?" and were invisible to the streak law; the v188 voice-liveness rule then adopted the worst of three candidates by recency.

v189 measures the shape on the owner's own archive (66,391 outbound messages grouped into turns, and the two-sided 150-thread
sample, aggregates only): a turn asks about one time in five (22.1% Korean, 19.1% English; 22.4% after a client question, 24.7% after a
client statement), a question follows a question 29.4% of the time, three or more questions in four consecutive turns 7.9%, passive
streaks p50 2 / p75 3 (Korean), unsolicited wellness advice 0.33% / 0.04%. `scv-client-voice-law.js` v6 counts alternative, indirect
and inverted questions; allows at most two asking turns in any window of four and re-authors a question right after a question
(allowed on the final pass); rejects unsolicited advice and a restated motif as hard laws; sets the passive-turn limit to two.
`scv-single-control-plane.js` wires the laws, keeps advice and motif out of the liveness adoption, and drops the trailing question
bubble from an adopted question-shape line. `scv-discourse-continuity.js` v29 refuses a classifier's missing-referent label on a turn
that carries no referring expression and recognizes the assistant's own question-mark-less questions in the answer anchor. The social
author states the shape. Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, the v180–v188 laws, ManyChat
configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `28573382-4663-48a2-8478-1a9cc999e0a1`; 285 installed sealed-file hashes verified; 18 installed harnesses
- Regression ledger: 114 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 4 of 4 adopted after at most one
  emulated re-author pass, 13 author calls, including the exact live three-turn sequence (잘 지내냐 / 호텔인데 / 히키코모리); 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-15T17:56:14.829Z`: residual 7 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 285 files, 18 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260915T175656Z/v189/v189-r2-manifest.json` sha256 `e9471c0a1aab249e462c09bfbfb06c8541815b65718f013df26fa75d31120d01`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; v188 stays in the pointer chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v51/v189 Worker version `3c5d510b-0837-4a99-8f89-519827f2a68b`, first v51 scheduled run `2026-09-15T18:05:26.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-15/20260915T180526000Z.json` sha256 `de4f831d5c7c2c2329b1eff64222514c9ff64e4c9bca9c040fe71e5bdf006a61` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
