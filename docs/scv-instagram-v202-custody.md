# SCV Instagram v202 trigger-context custody (2026-09-17)

This records the build-lane release that replaced v198 (through v199, v200 and v201 on the same day). It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v202` |
| content fingerprint | `f8edfa72a48ef2ab4b9f0709e7d8cb87a2b1d4283715e3af38b781c85c01b5dc` |
| release manifest sha256 | `2e77f80aa274d35655a9610cd4d5be31d00331efcb1515cd234d4a385efa4f3a` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260917T174407Z/v202/runtime/scv-instagram-single-20260914-v202-runtime.tar.gz` sha256 `b458eb9c164bb1f4af99624c6c0891c7ac706ce02ab183c2b5ed50245fb4b331` (1797956 bytes) |

## Requested conversation change (owner order 2026-09-17)

Verbatim: "본인이 뭐 뭐하는지 물어보고 있는데 갑자기 그걸 타투를 왜 잡는데 시발 지금 컨텍스트 맥락이 지금 안 이어지잖아 …
타투 트리거 포인트가 컨텍스트 맥락으로 이어져야 돼 그냥 문자 하나로만 타투 트리거가 되는게 아니라", and
"아 내가 레드팀 계정으로 테스트할 때까지 완료해 그 전까지 멈추지마".

The live thread (Omar.system, sealed v198, 15:58-15:59Z): the client asked what the assistant was doing, the assistant
said it was sketching a composition with an animal and some flowers, and the client's natural follow-up
"무슨 동물이고 무슨 꽃인데?" flipped the route to offer_form and was answered with
"동물이랑 꽃은 아직 확정이 아니고 네가 원하는 걸로 맞춰서 잡아둘게" / "신청서 보내줄까?".

Executed cause: `liveHasConcreteDesignDirection` was true for the client's sentence ALONE — deleting every assistant turn
from the history changed nothing. The detector keys on a subject noun being present, so it could not tell a question
about the assistant's sketch from the client's own brief, and v198's own-work licence is what supplied those nouns.

This release is the end of a four-step chain, each step deployed and then probed against its own DEPLOYED bytes, because
every step uncovered the next defect in the same drift:

| step | what the probe on the deployed bytes showed | law |
| --- | --- | --- |
| v199 | the trigger fired on one message's nouns | `scv-trigger-context.js`: a follow-up about the assistant's own work is not a design direction |
| v200 | with the trigger correctly off, the same turns became `ambiguous_missing_referent` 5/5 → "what are you referring to?" | two same-turn / assistant-subject anchors in `scv-discourse-continuity.js` (v31) |
| v201 | a 20-turn Korean battery: a price ask became a missing referent 4/4 (the STRUCTURAL floor, not the model), and 커버업/예약 fell into plain social chat | price-clause anchor (v32) + the canonical funnel lexicon in both `hasTattooIntentSignal` gates |
| v202 | the route was fixed in both languages, but the CONTENT half held only in Korean: on `general_continue` the v198 own-work licence was absent and the reply handed the question back ("what animal vibe do you want") | the licence reaches every plain lane, in `scv-social-author.js` |

The corrected 20-turn battery was then re-run at three samples per turn — 60 route decisions, 20 of 20 turns correct,
including both v197 weekend cases. The live author probe on the deployed v202 bytes answers the drift turn with its own
subject in both languages ("호랑이 느낌이고 옆에 장미 라인 잡는 중" / "a cat and a rose") and no form offer.

KNOWN COST, not hidden: on the price turn the design_intake author line was rejected by the generic-AI-tone post filter
after the probe's single emulated re-author pass. The route is correct; production carries the full pass budget and the
tattoo-lane recovery behind it. Named in `conversation-quality-receipt.json`.

Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), booking/deposit gates, templates, delivery-truth
semantics, the v180-v198 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `e3a2e3a1-0cf3-4f83-a56d-1933e8c23b5c`; 302 installed sealed-file hashes verified; 27 installed harnesses
- Regression ledger: 123 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probes on `gpt-5.4-nano-2026-03-17` in the production container scratch root: 0 of 3 adopted after at most one
  emulated re-author pass, 7 author calls, replaying the exact live 15:58-15:59Z drift thread in both languages plus the price turn; 0 customer sends
- Fresh code-locked Omar.system reset at `2026-09-17T17:44:04.972Z`: residual 7 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 302 files, 27 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260917T174407Z/v202/v202-r2-manifest.json` sha256 `daea995203c08ea217d2ee6e97ea9fe131403ca575e9f3822fef909bdbeffb75`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; the previous pointer is preserved in the chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v61/v202 Worker version `c7a39d3e-e6c6-4929-b864-08296f4dea75`, first v61 scheduled run `2026-09-17T17:50:51.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-17/20260917T175051000Z.json` sha256 `41a9af7a6d59a00e15e5bf70116435e6984bb44a2e1a90e730a5cfdba2284fbf` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
