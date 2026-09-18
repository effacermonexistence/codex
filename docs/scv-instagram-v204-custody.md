# SCV Instagram v204 own-activity custody (2026-09-18)

This records the build-lane release that replaced v203. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v204` |
| content fingerprint | `c9a51c823d1b604af7474c570f27c976a190c3689d7ad5253141918d01e30a82` |
| release manifest sha256 | `f79d7fe00404c76d131af67265e01f5de219ef7f2b4c43ae10ffc5ca947c3caa` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260918T024903Z/v204/runtime/scv-instagram-single-20260914-v204-runtime.tar.gz` sha256 `1990b3ccf79db2e36469097c3f539dbe99c54f0a94985333a4a4bad0d9427c8c` (2040666 bytes) |

## Requested conversation change (owner order 2026-09-18)

Verbatim: "지금 작업중이라매 무슨 작업하는데 하니까? 지금 대화 흐름이랑 말 정리하고 있지? 키키 시발 AI냐?
작업중이라매! 그럼 그 작업에 대해서 왜 맥락 보존이 안돼 도대체가 아키텍쳐 시발 다 뜯어 고쳐야 되는거 아니야?"

LIVE DRIFT (Omar.system thread-history, 2026-09-18 02:29:06-02:30:36Z, on sealed v203):

  client     "야, 씹할 뭐 하냐?"
  ASSISTANT  "지금 작업 중이지"
  client     "무슨 작업 하는데?"
  ASSISTANT  "지금 대화 흐름이랑 말 정리하고 있지 ㅋㅋ"

Control receipt: route social_continue, 3 control passes, 2 rejections (both korean_textbook_phrase),
one executed-path rejection at pass 1 (generic_ai_tone_alignment_or_resonance_framing), and
final_verifier_reason "valid". The shipped line passed every gate.

THIS RELEASE FIXES A DEFECT THE PREVIOUS ONE INTRODUCED. v203 injected the owner's 904KB engine into
the author prompt. Differential on the live container, same thread and model, five runs per arm:

| arm | meta answers | what it said |
| --- | --- | --- |
| engine injected (v203) | 2/5 explicit | "prepping the next reply", "reworking the wording of my DM reply"; the other three were caption/sentence polishing; zero mentioned drawing |
| engine stripped (v202 shape) | 0/5 | "sketching an animal", "drawing a deer and some flowers", "cleaning up lines" |
| v204, engine present + this law | 0/5 | studio work on every run, with no verifier rejection needed |

The engine describes Lua as a reasoning presence whose object IS conversation, routing and claims, so
with it in context a nano author answers an activity question with conversation work. The engine stays
— the owner ordered it and it governs reasoning — but its ROLE is now explicitly bounded away from the
owner's JOB.

SECOND, INDEPENDENT GAP: the rule already existed in prose in the identity boundary ("Replying, reading
messages or waiting is never the answer to what you were doing") and no verifier enforced it. That is
why final_verifier_reason was valid. It is now enforced at the executed-path verifier that already
rejects and re-authors on tone.

OVER-FIRING CAUGHT BEFORE SEALING: a bare "정리/다듬 + 중" clause matched "오늘 라인 정리하는 중" — the
owner tidying his LINEWORK, which is the answer the law wants. Every alternative now names a
conversation-referential object.

Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), the owner engine and its pin,
booking/deposit gates, templates, delivery-truth semantics, the v180-v203 laws, ManyChat configuration,
staging v168, Gold pins.

## Executed verification

- Active Railway deployment `130451cd-62f0-4665-9741-d433619486c5`; 304 installed sealed-file hashes verified; 28 installed harnesses
- Regression ledger: 124 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probe on `gpt-5.4-nano-2026-03-17` against the DEPLOYED bytes: the exact live drift thread replayed 5 times,
  0 own-activity violations against a measured v203 baseline of 2/5; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-18T02:49:00.964Z`: residual 4 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 304 files, 28 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260918T024903Z/v204/v204-r2-manifest.json` sha256 `1163666cf7ae1943be81e08e2ea70e21e3b01c3f87adf0fa43096ba1366be048`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; the previous pointer is preserved in the chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v63/v204 Worker version `ef6cd3f9-bcf8-43fe-8c41-6e8e30d64893`, first v63 scheduled run `2026-09-18T02:55:19.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-18/20260918T025519000Z.json` sha256 `9635f9079a6964f27199c340a84204ac472b7021b4eca876b9965cd05329d6a4` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
