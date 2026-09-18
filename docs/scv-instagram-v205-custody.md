# SCV Instagram v205 press-context custody (2026-09-18)

This records the build-lane release that replaced v204. It does not promote Gold, enable customer
traffic or change ManyChat.

| field | value |
| --- | --- |
| release id | `scv-instagram-single-20260914-v205` |
| content fingerprint | `f6fcb85f67c647052b023fa11cb1fc15e12d45b771ea61c2ea234b0084a24b32` |
| release manifest sha256 | `199ecd7f93762d5425ab9ab78247567a6c2b3fc84397b14d8c44da2bb5944c5a` |
| runtime archive (R2) | `scv-instagram-automation/release-ready/20260918T034121Z/v205/runtime/scv-instagram-single-20260914-v205-runtime.tar.gz` sha256 `76ad9fccab0b0d5ba786450adec6e0b795a0d1b010fb6ded50df711e8998c318` (2049691 bytes) |

## Requested conversation change (owner order 2026-09-18)

Verbatim: "아..씨X 제발.. 로그 다 까봐.. 도대체.. 왜.. 어? 내가 따닥따닥.. 어? 끝까지 밀고 늘어.. 질문을
늘어지면 왜 대답을 못하고 왜.. 계속.. 타투로 빠져.. 난 아직 타투 얘기도 안 했는데.. 안 했는데.. 내가 계속
꼬치꼬치 개무르면은 상상력을 발휘해서 대충 띄워 맞춰서 대답을 해야지 아 로우 다 까봐 시발 아 왜 계속 타투
상담으로 빠지는데 시발"

LIVE DRIFT (Omar.system thread-history 1537753982, 2026-09-18 03:02:54-03:05:15Z, on sealed v204):

  client     "야, 뭐 하냐?"
  ASSISTANT  "나 지금 작업실에서 드로잉 라인 좀 정리 중"            <- v204's own-activity law, correct
  client     "뭐 드로잉 하는데?"
  ASSISTANT  "대충 동물하고 꽃이 같이 나오는 캐릭터 그리는 중"        <- v198/v202's own-work licence, correct
  client     "무슨 동물이랑 무슨 꽃 무슨 캐릭터"
  ASSISTANT  "동물이랑 꽃이랑 캐릭터 조합은 아직 네가 원하는 걸로 맞춰서 잡는 중이야"
  ASSISTANT  "원하면 이대로 커스텀해서 작업 들어갈 수 있게 신청서 먼저 보내줄까"

Control events for `…4228d49897e9`: `control_turn_route_locked` at pass 1 -> `offer_form` /
`design_direction_ready_for_form_offer` on closed-transition contract v88, one transition rejection
(`closed_transition_form_offer_missing`) and a re-author. The owner never used the word tattoo.

EXECUTED CAUSE, measured on the DEPLOYED v204 bytes with the real control-decision history:

| probe | result |
| --- | --- |
| `liveIsFollowUpAboutAssistantWork(live, history)` | true — the v199 law already knew |
| `deriveClosedTransitionPlan(stub state + real history)` | `general_continue` — the route law was fine |
| `annotateStructuredStateForLiveTurn(msg, {}, history)` on a CLEAN state | `known_design_context` = "What animal, what flower, what character", `live_turn_gave_design_idea` / `live_turn_is_tattoo_intent` / `tattoo_intent_active` = true |
| `deriveClosedTransitionPlan(that produced state)` | `offer_form` / `design_direction_ready_for_form_offer` |

The route was not the cause; the DURABLE STATE WRITER was. `annotateStructuredStateForLiveTurn` grades
the live sentence through `textGivesConcreteDesignDirection`, which pins `recent_history` to `[]` on
purpose — a correct stale-state protection from the 2026-09-02 regression where booking turns were
overwriting the design context. That protection stays. What it structurally cannot see is that the
motif nouns in this sentence came FROM the assistant one turn earlier, so the client's question is not
a brief the client gave. v199-v202 taught the ROUTE this; nothing taught the WRITER.

Because `tattoo_intent_active` is durable, the contamination outlives the turn: replayed with the
post-turn state the same thread routes `tattoo_continue` from then on. That is the reported symptom —
a permanent flag set by a message in which the owner never mentioned a tattoo.

SECOND, INDEPENDENT GAP: the own-work commitment law has said since v198 "name it plainly … you never
hedge it", in the author prompt only. The reply hedged and handed the subject to the client, and every
gate returned valid. Same shape as v204: a prose rule with no verifier is a suggestion.

Law: a turn the trigger-context predicate already calls a follow-up about the assistant's own work may
not author durable design or tattoo state (a scrub that restores the pre-turn value of each protected
key, never a new classifier, and never applied to a turn carrying media); and when they press about the
owner's own work the answer names it, adding a new concrete detail on each further press, with
approximation explicitly licensed.

TRANSITIONED, NOT DELETED: two ratified checks pinned `scv-own-work-commitment` at
`2026-09-17-v1-self-only-subject`. The module moved to v2 when the press-escalation law and its
verifier were added; the criterion those checks carry is unchanged and only the pin moved.

KNOWN BOUNDARY: this stops the contamination at its source. It does not retroactively clear a
`tattoo_intent_active` already written into a live thread by an earlier release. The red-team accounts
are cleared by this release's reset; no customer thread state is mutated.

Preserved: models (nano), routes, literals, identity source bytes
(`ead356e792ec513097c1926c61d137bbebe4e5f5d0d2ea9d437079d9cbb8807a`), the owner engine and its pin
(`33d490540c0c1df9333349c06c8c1f55d989cfdfff2e332aa9649e2eaaeec767`), booking/deposit gates, templates,
delivery-truth semantics, the v180-v204 laws, ManyChat configuration, staging v168, Gold pins.

## Executed verification

- Active Railway deployment `f08172cb-3c42-4b5a-8e60-72136a984126`; 306 installed sealed-file hashes verified; 29 installed harnesses
- Regression ledger: 125 commands, all rc 0, on the final sealed bytes outside the sandbox
- Real-provider no-send probe on `gpt-5.4-nano-2026-03-17` against the DEPLOYED bytes: 3 press cases and 3 funnel controls,
  9 author calls, 0 customer sends. Press cases leaving the plain lane: 0; press cases authoring
  durable tattoo state: 0; press answers that deflected: 0. Controls wrongly plain: 0;
  controls missing tattoo state: 0
- Fresh code-locked debug-identity reset at `2026-09-18T03:41:18.490Z`: residual 6 to 0,
  10 workers paused and resumed, pre/post state snapshots with restore drills, downloaded from private R2 and restored
  into isolated directories with matching namespace tree digests
- Runtime archive readback and cold restore: 306 files, 29 harnesses
- Custody manifest `scv-instagram-automation/release-ready/20260918T034121Z/v205/v205-r2-manifest.json` sha256 `9700c839c6b3e42260d834d68746afa89df388ee8072791d96e6f45eb34ecf3e`; 12 evidence objects and the
  non-Gold `LATEST-RELEASE-PACKAGE.json` pointer downloaded/hash verified; the previous pointer is preserved in the chain
- Approved recovery Gold v167, April Golden and behavioral GOLD-3 are unchanged

## Sentinel alignment

v64/v205 Worker version `b5a4d472-7fc4-4220-ab9b-22e41523aeb4`, first v64 scheduled run `2026-09-18T03:55:19.000Z`, attestation `scv-instagram-automation/drift-attestations/2026-09-18/20260918T035519000Z.json` sha256 `85f151c23b755149dd951f2f63620c9a032881241456726491ff09abd63ec747` (R2 readback hash matched). Production check passed; staging v168 remains the intended aggregate boundary.

Owner Instagram red-team acceptance remains pending. No ChatGPT parity or permanent drift immunity is claimed.
