# OS-1 라우팅 아키텍처 v2 — 동결본 (2026-10-24)

## 동결 기록

- **동결 지시.** 오너, 2026-10-24: "그럼 그 구조로 아키텍처 동결하고 구현 시작해".
- **동결 대상.** 아래 본문인 v2 수렴안(Claude ↔ Codex 합의안)이다. 기준 소스는 `os1/live-routing-20261023` HEAD `3d62dad6`이다. 원본은 `/Users/LUA/Documents/Codex/artifacts/OS1_ARCH_20261024/OS1_CONVERGED_ROUTING_ARCHITECTURE.md`이고, 본문은 그 바이트 그대로 붙였다.
- **동결 뒤 바꾸는 방법.** 오너의 명시 지시가 있거나, D3/D4 측정 artifact가 본문의 가정을 깰 때만 바꾼다. 바꿀 때는 이 기록에 변경 항목, 근거, 날짜를 추가한다.
- **변경 1 (2026-10-27, 오너 지시, build 440).** 오너, 2026-10-27: "무슨 아스트라를 또 또 아스트라를 쓰면 또 고쳐야 되잖아 … 왜 이게 안 고쳐지는데". App에서 가벼운 시험 초대("자 이제 네가 얼마나 잘 되는지 보자")가 `readonly_lookup`으로 분류되어 Codex `gpt-6-astra` ultra로 돌았다(routing ledger 140행: `stratum.request_class` `readonly_lookup`, `delivery_basis` `owner_words`, native `duration_ms` 27019). V2 이전 같은 ledger에는 `gpt-6-luna` low tier route가 있었으나 V2 이후 모든 요청이 레퍼런스에 묶였다. 근거는 오너의 상시 규칙(2026-10-14: 쉬운 일은 fast tier low effort, 실패 신호가 있으면 REVAS가 레퍼런스로 올린다, 품질이 걸린 생성은 레퍼런스)이다. 바뀐 것은 아래 넷뿐이다.
  - **§8-1 예외 하나.** request class `chat_explanatory`(chat lane 질문 중 text operation이 아닌 것) 하나만 검사 있는 저가 전달을 켠다. tuple은 (codex, `gpt-6-luna`, low), 답별 검사는 `nonempty_text`이고, 검사가 실패하면 bind 때 고정한 레퍼런스로 1회 escalation한다(R9, 기존 Core 경로 그대로). runtime 설정은 만들지 않았다. compiled class 표의 항목 하나다.
  - **인증 근거.** 그 한 class에 한해 D4 측정 artifact 대신 binary에 compiled된 오너 결정 artifact(`RCCClassOwnerDecision`, 종류 `os1_rcc_class_owner_decision_v1`, 검토용 사본 `Resources/rcc-class-owner-decision.json`, sha256 `af958f76401c42133b8f90db2fcae11fd5eb62c5c4f51a27e9df54e780cce36f`)를 쓴다. 날짜, 오너의 말, class 하나, 정확한 tuple을 담는다. class 표를 재서명했다(`Resources/rcc-class-table.json`, pin `41bdb810b4d04e6d271d743d8ba98b249f4d26a64b2c731e3e17849fe9e66957`). 인증서의 `measurement_sha256`이 이 결정의 hash다. 결정은 디스크에서 읽거나 lookup하지 않으므로 custody 파일이 만들거나 넓히거나 연장할 수 없다. K11에서 유지하는 검사: compiled 바이트가 pin과 같을 것, 인증서가 그 hash를 가리킬 것, strict decode, class가 `chat_explanatory`일 것(코드에도 고정), 인증서 id·tuple·format check가 결정과 같을 것, 그 pool에 현재 레퍼런스가 있을 것(Core가 escalation target으로 고정한다), host가 harness를 attest할 것. 적용하지 않는 검사와 이유: executor contract와 harness version(묶을 측정이 없다), 유효 구간(오너가 다음 build에서 거둘 때까지 선다), PASS 결과(측정이 아니다), 레퍼런스 모델 지정(결정이 레퍼런스 모델을 묶지 않으므로 새 frontier가 결정을 무효로 만들지 않는다). 어긋나면 지금과 똑같이 인증서만 떨어지고 레퍼런스로 간다.
  - **감지.** `StatusCheckIn`에 문장 표가 아니라 구조로 된 시험 초대 문법(`testInvitation`)을 더했다. 틀 단어(자·야·그럼·일단·이제·한번·아니) 뒤에 2인칭 주어(네가·너가·니가·너·넌, 그 뒤 선택적 얼마나·잘)가 오거나, 주어가 없으면 정확히 '얼마나 잘'이 와야 한다. 상태 동사는 되는지·잘하는지·작동하는지다(맨 '하는지'는 아니다). 그 뒤 선택적 한번, 끝은 보자·볼까·볼게·볼께·확인해 보자·확인해 볼까다. 쉼표·물결표·끝의 ㅋ/ㅎ, '되는 지' 띄어쓰기는 같은 문장의 표기로 본다. 초대는 요청 전체일 때만 check-in이다(`standaloneTestInvitation`: 중립 문장과 자기 확인 opener는 뺀다). 사물이 주어이거나("빌드 잘 되는지 보자", "테스트가 통과하는지 볼까"), 응답자를 부르지 않거나("그럼 되는지 보자": 이 오너의 '해 보고 보자' 주문), 다른 문장이 하나라도 붙으면(질문 포함: "최신 아이폰 가격 얼마니? 이제 너 얼마나 잘하는지 보자", "빌드 끝났어? 그럼 이제 잘 되는지 보자", "…보자. 빌드 다시 해볼래?") build 439와 같이 판정되어 일이다. build 439의 `checkOpener`와 문장 판정은 그대로다. 그래서 오너의 시험 초대는 card check-in이고 chat lane 대상이며 class는 `chat_explanatory`다. 처음 커밋(`9ea9e90b`)은 문장 단위 `checkOpener` 확장과 앵커 없는 `openerAsking` gate로 위의 질문·주문·주어 없는 형태까지 check-in으로 넓혀서, 같은 브랜치의 리뷰 수정 커밋에서 철회했다(세부 기록).
  - **harness.** chat-lane 술어(H0 구성요소 `chat_lane_predicate_v1`)가 바뀌지만 harness profile은 `H0@1`로 둔다. K15 bump 규칙의 예외이고 이유는 이렇다. H0 parity는 unverified이고 H0@1에 묶인 D4 측정이 하나도 없다(NOT_RUN). 오너 결정 인증서는 harness version을 묶지 않는다(harness attest만 확인). H0 golden의 chat-lane vector 40개에는 초대 문장이 없어 고정 rendering `4ecd97ffe17a…`은 그대로다. 그래서 golden은 이 변경을 잡지 않는다. 초대 양성·음성은 `StatusCheckIn.selfTest`와 `providerSurfaceRoutingSelfTest`가 고정한다. D4 arm ②가 H0을 재기 전에 새 descriptor로 올릴지 정해야 한다(남은 미해결 항목).
  - **결정의 범위 (lead 좁힘, 같은 날 리뷰 뒤).** 인증서는 `chat_explanatory` 안에서도 상태만 묻는 check-in에만 실린다(`RCCClassOwnerDecision.admits` = `StatusCheckIn.stateOnly`: 오너의 시험 초대, "너 되냐?", "설치됐어?", "다 끝났어? 너 되냐?"처럼 opener·중립 문장을 뺀 모든 문장이 상태를 묻는 것). chat lane이 함께 받는 지식·현재 사실·코드 질문, 이어지는 턴, 상태 질문 옆에 붙은 다른 질문("Swift에서 actor reentrancy가 왜 생겨?", "co가 무슨 뜻이야?", "그게 왜 그래?", "최신 아이폰 가격 얼마니? 너 되냐?", "되는지 확인해보자. 빌드 다시 해볼래?")은 품질이 걸린 답이라 host가 인증서를 내지 않고(`scope_mismatch`) 레퍼런스에 묶인다. 판정은 host가 오너 요청 원문으로 catalog를 만들 때 한다(Swift만, JS·bridge pin 무변경).
  - **그대로인 것.** `text_operation`(품질이 걸린 텍스트 생성), `readonly_lookup`, `readonly_material`, `writer`, `explicit_route`는 인증서가 없고 레퍼런스에 묶인다. 이 class들의 인증에는 여전히 D4 arm ③과 별도 재서명이 필요하다. JS Core와 bridge pin은 바뀌지 않았다. `chat_explanatory` 인증서의 품질 동등성은 측정하지 않았다(D4 NOT_RUN 그대로).
- **변경 2 (2026-10-27, 오너 지시, build 441).** 오너가 Codex 브리프를 "고쳐"로 승인했다. 지시의 요지: 최상위 모델의 최대 reasoning은 품질 **기준(reference)**이지 모든 요청의 실행 설정이 아니다. route·모델·effort는 과제의 필요(종류·난이도·도구 필요), 쓸 수 있는 자원, 실패 신호로 고른다. 늘 luna, 늘 low, 늘 max는 금지다. 측정하지 않은 route를 품질 동등이라고 표시하지 않는다. 인증서가 없다는 이유만으로 일반 설명이 모두 최상위 모델 최대 effort로 가는 구조를 고친다. OpenClaw의 단일 task 소유는 유지하고, UI·adapter 재시도 루프는 더하지 않는다. requested·selected·observed 구성은 구별한다. 계기는 "야, 쇼레든거 방조식 설명해봐"(task 4c836d82)다. "해봐"가 일 동사로 읽혀 chat 자격이 꺼지고, owner_scope `workspace_write`, class `readonly_lookup`, `admitted_reference_uncertified`로 Codex `gpt-6-astra` ultra가 50 s 돌았다. 오너는 라우팅 단어를 쓰지 않았는데도 기록은 `route_explicit`·`owner_words`였다. 이 항목은 A 부분(라우팅 core, 브랜치 `os1/adaptive-routing-20261027`)이다. envelope(B)와 App 라벨(D)은 각자의 기록을 따른다. 바뀐 것은 아래다.
  - **host 요청 프로필.** Swift `RequestProfile`(OS1Context, policy `host_profile_v1`)은 오너 요청 원문과 host 사실(shell 필요, 첨부 material)만으로 정해진다. 모델 출력은 들어가지 않는다(R0). 축은 셋이다. `answer_kind`(`answer_only`·`work`·`unknown`): 설명·알려·뭐야·차이·왜·explain·what is 같은 답 요청 어간이 있거나 대화형 질문이면서, write scope·shell·이름 붙은 경로·이미지·material·machine/project/external-system 용어·외부 행동 주문·실패 호소가 없을 때만 `answer_only`다. 내용 어간 없는 "그럼 실제로 해봐"는 `work`, text operation은 `unknown`이다. `tool_need`(`write`·`shell`·`workspace`·`current_facts`·`none`): workspace는 machine 용어, 이전 산출물·작업공간 지시어(이거·그거·아까·방금·"이 함수"·this), 상태 check-in이고, current_facts는 최신·오늘·현재·지금·가격·환율·시세·뉴스·검색 등이다. `difficulty`(`light`·`standard`·`deep`·`unknown`)는 과제 모양으로만 정한다(주제는 보지 않는다). deep은 증명·유도·설계·디버그·원인·최적화·리뷰·엄밀·심층 표지, 280자 초과, 세 부분 이상, 목록, 코드 블록이다. light는 40자 이하의 정의 질문("X 뜻", "X가 뭐야")이고, 나머지 `answer_only`가 standard다. 어미와 "?"(설명해봐·설명해줘·설명해 주세요·설명해줄래?·설명해·설명 좀)는 프로필을 바꾸지 않는다. catalog의 새 선택 키 `request_profile`({schema 1, policy, answer_kind, tool_need, difficulty, 정렬된 고유 signals})은 admission facts 옆에만 실린다. Swift `RCCRuntimeContract`와 Core `validateCatalog`의 닫힌 key 집합을 넓혔다. 형식이 어긋나면 `catalog_binding_invalid`다.
  - **분류 수정.** 도구가 필요 없는 `answer_only` 요청은 어미와 관계없이 RCC catalog의 chat-lane 사실(`chat_explanatory`, `claude-chat` 행)이 되고 read-only로 돈다(owner_scope `read_only`, `ownerRequestRunsReadOnly`). 단 오너가 고른 chat lane의 조건(machine material·shell·경로·이미지·source 없음)을 그대로 지켜야 하고, RCC adapter가 claude-chat dispatch 전에 다시 확인한다. `ClaudeChatLane.asksForWorkBeyondAnswer`(프로필만 읽는다)는 의사소통 어간(설명·비교·정의·말·증명·유도) 뒤의 명령 어미를 일로 세지 않는다. 어미만 있는 경우와 다른 어간("실행해봐", "정리해줘", "고쳐줘")은 그대로 일이다. native 술어가 읽는 `asksForWork`는 리뷰 뒤 build 440 그대로 되돌렸다(처음 커밋은 이것을 바꿔 "…설명해줘?"처럼 "?"로 끝난 명령이 native chat lane과 read-only 술어로 넘어갔다). 실제 파일·배포·실행·쓰기 요청은 chat으로 가지 않는다. 기존 음성 self-test는 모두 그대로 통과한다. native(비 RCC) lane 술어(`claudeChatLane`·`codexChatLane`)는 그대로이고, H0 golden digest도 바뀌지 않았다. build 440의 오너 결정 인증서는 그대로이며, 여전히 상태만 묻는 check-in에만 적용된다.
  - **Core graded admission (`rcc-runtime.mjs`).** `admittedRoute`에 인증하지 않는 셋째 결과 `{class: 'graded', source: 'host_profile', grade}`를 더했다. 다음을 모두 만족할 때만 나온다. 인증 출처(contract·verifier·exact·class certificate)가 없을 것(이것들이 우선이다). 오너 라우팅 제약(explicit route test, auto가 아닌 provider, v2 surface·model·family·effort·quality·native-ceiling 단어)이 없을 것. agent node, read-only scope, node instruction이 요청 원문, material 없음, catalog owner_scope `read_only`일 것. `request_profile`이 유효하고 `answer_only`·`none`·`light` 또는 `standard`일 것. 목록은 light [[fast,low],[efficient,low],[workhorse,low]], standard [[workhorse,medium],[efficient,medium],[workhorse,high]]이다. deep·unknown은 레퍼런스다. bind 규칙: dispatch 가능한 레퍼런스가 escalation target으로 있어야 한다(K2). bind 시점 여유가 있어야 한다(`max_attempts` − 과금된 시도 ≥ 2, cap − native dispatch ≥ 2). 없으면 레퍼런스를 `admitted_reference_uncertified`로 bind하고 note `graded_<grade>_requires_dispatch_headroom`(또는 `_tuple_undispatchable`·`_requires_runnable_reference`)를 남긴다. route kind는 `graded`(인증된 `tier`와 구별), route_class는 `standard`, reason token은 `admitted_graded_<grade>`, delivery basis는 `graded:<grade>`(`LEDGER_BASIS`, `deliveryBasisOf`, `route-replay.mjs`)다. ladder 기계(`source: 'tier'`, `admitted_by: 'host_profile'`, `grade`)를 재사용하지만 `check_id`·`check_label`은 null이고 `task_quality`는 `execution_only`, parity는 `unverified`다. 수락은 기존 구조 screen(`descentStructurallySound`: 비지 않음, 오류 없음, 실행 검증, partial 아님)이고, ledger `check_outcome`은 `screen_pass`(실패는 `screen_fail`·`not_returned`, 실패 신호 verifier는 `fail`)로 남는다. 인증 `pass`로는 남지 않는다. 실패 신호가 있으면 기존 `_ladderFailed`/`_escalateLadder`로 bind 때 고정한 레퍼런스에 1회 escalation한다. 새 loop는 없다. graded 시도는 하강처럼 새 native session으로 돈다.
  - **리뷰 뒤 좁힘 (같은 날, 독립 리뷰 결과).** 처음 프로필은 쓰기·전달 주문과 작업공간·현재 사실 질문을 `answer_only`·`none`으로 읽어 graded와 도구 없는 chat lane으로 보냈다. 좁힌 것: (1) 어떤 주문도 없어야 `answer_only`다. chat lane의 `orderTerms`(써줘·적어·정리해·보내…), 답을 어딘가에 두는 동사(올려·남겨·달아·붙여·짜줘…), 코드 객체 정의("User 타입 정의해줘"), 사람·채널로 전달("팀장한테 말해줘", "메일로 설명해줘", "… and email it to X")은 `work`다. (2) chat lane의 code·system·OS-1 용어(`technicalTerms`), 작업공간 상태 명사(변경사항·작업 내용·PR·에러 메시지), OS-1의 ASR 표기와 오너 프로젝트 이름(오에스원·알씨씨·레바스·REVAS·OmarAGI·Daybreak…)은 workspace다. (3) current_facts는 chat lane의 `lookupTerms` 전체와 연도·버전 붙은 이름("GPT-6.1", "iPhone 17", "2026년")을 포함한다. (4) 이전 턴 지시("네가 전에 말한 …", "what you said")는 deictic이다. (5) deep에 품질이 걸린 결과물·정확한 계산(에세이·보고서·이메일·구현·풀어줘·계산해·solve…), 가장 강한 모델·더 깊은 생각 요청("제일 똑똑한 모델로", "think hard"), 쉼표·그리고·and·"…지"로 이어진 세 개의 질문, 펜스 없는 코드, step-by-step의 다른 말("one step at a time", "차근차근")을 더했다. (6) RCC chat-lane 사실의 프로필 경로는 chat lane 자신의 내용 검사(`answerNeedsNoLookup`: lookup·technical·영어 work 동사·상태 질문 없음, 숫자·점 붙은 이름 없음)를 함께 통과해야 한다. (7) 이 요청에 등록된 workspace-write 오너 계약이 있으면 owner_scope와 chat lane은 프로필을 읽지 않는다(writer 행 유지). 넓히는 방향의 지적(주제어가 deep·current_facts·deictic을 켜는 과잉 상승, 어미 사이 부사·"?" 유무·ASR 띄어쓰기에 따른 차이, "어떻게 만들어져?"의 쓰기 판정)은 비용만 늘리고 품질을 낮추지 않으므로 이번에는 고치지 않았다(아래 미해결 항목).
  - **라벨 수정.** route kind `explicit`과 basis `owner_words`는 v2 intent에 실제 제약이 있을 때만 붙는다(RT `intentConstrains`, 옛 1270·1371행). 모든 필드가 비어 있는 resolved v2 intent는 레퍼런스(`route_reference`, basis `reference`)다. 옛 catalog의 `routing_intent`와 explicit route의 자기 단어는 원래 비어 있지 않으므로 그대로다.
  - **수정된 I1과 §8-1.** I1: 레퍼런스보다 낮은 행은 (가) `certified`이거나 (나) 변경 2의 `graded`일 때만 bind된다. 둘 다 dispatch 가능한 레퍼런스가 `ladder.reference_candidate_id`로 고정되어야 한다. graded는 bind 시점 재실행 여유(위 수치)도 있어야 하고, 그 여유가 task의 것이므로 노드가 하나인 plan에서만 bind된다(리뷰 뒤: 주입된 두 노드 plan의 두 graded 형제가 같은 여유 2를 함께 세어 첫 escalation이 거부될 수 있었다. 둘 이상이면 레퍼런스와 note `graded_<grade>_requires_single_node_plan`. host Auto plan은 늘 노드 하나다). certified 하강의 bind 시점 여유는 아래 '남은 미해결 항목'에 그대로 남는다. graded에만 넣은 이유: 하강의 실패 시도는 과금되지 않으므로 기존 certified 경로는 `max_attempts` 1에서도 escalation이 돈다. 이것을 바꾸면 7개 fixture 파일의 9개 test가 고정한 K6·K10·K5 동작이 바뀐다(실험으로 확인했다). §8-1: 검사 없는 저가 전달은 계속 꺼져 있다. 예외는 변경 1의 class 인증서와 변경 2의 graded route이고, graded는 '예측 경로 · 품질 미검증'으로 공시한다. `delivery_policy_valid`는 이제 basis `graded:<grade>`도 받는다. 단 그 attempt의 `screen_pass`가 있고 check id·label이 없어야 한다. route-replay는 이를 `graded` 모집단으로 따로 센다.
  - **그대로인 것.** `TIER_ROUTES`, 모든 인증 출처와 그 우선순위, R6 공시 전달, K6 cap(16)과 무환불, K10, 오너 결정 인증서와 그 범위, explicit route test, `noDispatchableReason`, OpenClaw 단일 task 소유가 그대로다. 품질 동등성과 쿼터 절감은 측정하지 않았다(D4 NOT_RUN). graded route는 예측이지 인증이 아니다. bridge pin `rccRuntimeModuleSHA256`을 다시 고정했다. 103행의 낡은 주석("empty as shipped")도 이번에 고쳤다.
  - **변경 2 추가: local classifier, 가격 기반 선택, local chat (같은 날 오너 지시, DESIGN-2, build 441 part 2).** 오너 지시: 요청은 무료인 **local LLM**으로 분류한다(키워드 router는 "QMGR 통합하게 스키마 좀 짜봐"를 읽지 못한다). 최신 모델 가격표로 비용을 비교한다(모두 astra로 보내는 것은 틀렸다). 애매하다고 최대로 보내지 않는다. 아주 쉬운 잡담은 local 모델이 답해도 되고, 산수는 LLM이 아니라 계산기가 답한다. 깊은 작업은 오너가 B를 고를 때까지 정책 **A**(레퍼런스)다. 바뀐 것은 아래다.
    - **local classifier (Swift, OS1Context `LocalRequestClassifier`).** OS-1의 Ollama client 하나(`RoutingOrderInterpreter.ollamaAsk`, loopback, proxy 없음)에 이 schema, 답 상한, `keep_alive` 30m을 넘긴다. think off, temperature 0, seed 7. 모델은 `qwen3.5:9b`가 설치되어 있으면 그것, 아니면 `qwen3.5:4b`다(inventory는 host의 `LocalRouterBridge.installedModelNames`가 같은 `/api/tags`에서 읽고, Ollama가 꺼져 있으면 바로 실패한다). 시스템 프롬프트는 2026-10-27 측정(`cls.py`) 그대로이고 ASR 오기 힌트를 포함한다. 입력은 요청 원문 앞 2,000자다. 상한 12 s의 근거: warm 9B는 약 6 s(부하 아래 두 배까지 허용)이고, cold 적재 10-16 s는 끊고 키워드 프로필로 간다. schema 밖 답, 시간 초과, 전송 오류, 모델 없음, Ollama 꺼짐은 'local 분류 없음'이다. host(`rccNativeCatalog`)는 분류를 다른 준비보다 먼저(`RuntimeConfig.load()` 전) 시작하고 provider probe(4-6 s)와 나란히 돌린 뒤, probe가 끝나서야 기다린다. task당 한 번만 묻는다. 첫 catalog의 receipt(enum, 모델, 결과, 지연; 원문 없음)를 `~/.os1/rcc-runtime/request-classifications/`(0700/0600, 24 h, 최대 512개)에 두고, 같은 task의 이후 catalog(dispatch 전 refresh)가 재사용한다. 다른 읽기가 bind한 행(예: local 행)을 지우는 일(`selected_candidate_disappeared`)을 막기 위해서다. 실패한 첫 읽기도 보관하므로 그 task 전체가 키워드로 간다. 키워드 rail이 이미 route를 정하면(`RequestProfile.railsDecide`: 일, 작업공간 필요, text operation, 가장 강한 모델 요청) local 모델에 묻지 않는다.
    - **조합 (`RequestProfile.combine`).** 키워드의 hard rail이 먼저이고 local 모델은 그것을 낮출 수 없다. write, shell, 주문, 외부 행동은 `work`이다. material, 경로, 이미지, machine material, project, external system, deictic, 상태 check-in과 질문, 실패 호소는 workspace이다. current_facts는 current_facts이고, text operation은 `write` task, 가장 강한 모델 요청은 deep(오너 단어)이다. local 모델은 current_facts, workspace, execution(→ work)로 올릴 수만 있다. work로 올리는 것은 needs_tools `execution`뿐이다. rail이 없는 요청에 execution 필요 없이 붙은 `action` 표지는 `explain` answer로 읽는다(실측 2026-10-27: 9B가 "오늘 환율 알려줘"와 "지금 비트코인 시세 알려줘"를 action/light/current_facts로 읽었다. 신호 `llm_action_without_execution`). 그 밖에는 local의 task_type, difficulty, needs_tools가 정한다(주제어 deep 표지도 local이 정하고 신호 `llm_sets_difficulty`가 남는다). local 결과가 없으면 키워드 프로필이고, rail 없는 키워드 `unknown`은 answer·standard(task `explain`, 신호 `keyword_unknown_default`)가 된다. `request_profile`에 새 키 `classifier`(`keyword_v1` 또는 `local_llm:<model>`)와 `task_type`(chat, explain, design, write, action, unknown)이 함께 실린다. 둘 다 있거나 둘 다 없고, answer는 action이 아니며, local은 unknown이 아니다. local의 읽기는 `llm_task_*`, `llm_difficulty_*`, `llm_tools_*` 신호로 남는다. Swift `RCCRuntimeContract`와 Core `validRequestProfile`이 둘 다 엄격히 받는다. RCC catalog의 owner scope는 조합 프로필을 읽는다. 도구 없음 또는 current_facts만 필요한 answer는 read-only다(read-only agent가 찾아본다). native 경로의 키워드 scope는 그대로이고, 등록된 workspace-write 오너 계약이 있으면 프로필을 읽지 않는다.
    - **Core 매핑 (`hostProfileGrade`, `GRADED_LISTS`).** local이 읽은 chat·light·도구 없음은 `chat_light` [[local,none],[fast,low]]이다. 첫 턴이면 Auto local 행(OpenClaw가 이미 돌리는 `qwen3.5:4b`, read-only, 도구 없음, 쿼터 없음)이고, 아니면 fast/low다. explain(또는 chat)·light는 `explain_light` [[fast,low],[efficient,low]], standard는 `explain_standard` [[workhorse,medium],[efficient,medium]]이다. explain(또는 chat) light/standard에 current_facts면 `current_facts` [[workhorse,medium]]이고 agent surface만 받는다(도구 없는 chat 행은 안 된다). (2026-10-27 정정: 이 목록이 위 'Core graded admission'의 part 1 목록을 대체했다. light의 [workhorse,low]와 standard의 [workhorse,high]는 빠졌고, 코드(`GRADED_LISTS`)에는 part 2 목록만 있다.) design, write, 모든 deep은 `DEEP_POLICY = 'reference_first'`(정책 A)로 레퍼런스이고 reason에 `deep_policy_reference_first`가 남는다. `'workhorse_first'`(B: `deep_workhorse` [[workhorse,xhigh]] 뒤 레퍼런스 1회, basis `graded:deep`)는 구현과 fixture가 있지만 내보내지 않는다. resolver의 fixture 전용 `deepPolicy` 옵션만 B를 쓴다. B도 read-only answer node에만 적용된다. workspace writer, workspace 필요, 일은 어느 정책이든 레퍼런스다(실패한 싼 writer가 이미 작업공간을 바꾼 뒤에는 escalation할 수 없다). Auto local 행은 Swift가 조합 프로필이 local chat일 때만 넣는다(`autoLocalRowEligible`, 실시간 준비 probe). Core plan 검사(`local_agent_node_not_explicit`)는 Auto에서 그 경우(요청 원문, 첫 턴, material 없음)만 받는다.
    - **가격 기반 선택.** Swift가 행마다 `estimated_cost_units`에 `ModelPriceTable.current()`(하루 한 번 refresh, 아니면 compiled)의 typical call USD를 싣는다(local 행은 0). Core는 고른 목록 안에서 **모든 pool**의 dispatch 가능한 행 가운데 가장 싼 것을 고르고, 같으면 R11 순서(pin, affinity, quota score, pool 순서, 그다음 목록 순서)로 정한다. quota 소진 행과 stale 행은 그대로 빠진다. 가격 없는 catalog(옛 host)는 part 1 순서 그대로다(`cost_unpriced`). cheap-first 판단을 reason에 남긴다. 기대 비용 = cheap + p_fail × reference를 reference와 비교한다. p_fail은 tier별 사전값이다(옛 ledger: luna low 11회 중 3회, sol medium 14회 중 0회; Laplace (f+1)/(n+2); 기록 없는 tier와 local은 1/2; `TIER_FAILURE_PRIORS`). token `cheap_first`/`reference_first`와 `expected_usd_*`, `reference_usd_*`, `p_fail_*`가 남는다. `reference_first`면 레퍼런스를 bind하고 note `graded_<grade>_reference_first`를 남긴다. 품질 주장은 하지 않는다. reason에는 `graded_profile_<list>`와 `classifier_local_llm`/`classifier_keyword`도 붙는다.
    - **변경 2 I2: 하루 한 번 가격 refresh (2026-10-27, DESIGN-2 I2, 커밋 8bb27a60·ee43ef6b; 리뷰 뒤 같은 날 기록).** 명령 `os1 pricing refresh [--dry-run]`(`ModelPriceRefresh`)이 provider 자신의 page를 읽는다(OpenAI pricing page와 그 Markdown, Anthropic pricing page와 그 Markdown). 규칙은 다음과 같다. (1) provider마다 두 first-party 읽기가 정확히 일치해야 그 행을 받는다(불일치는 `sources_disagree`). (2) compiled 표의 모델이 하나라도 없거나, 쓰고 있는 표(refresh된 것, 아니면 compiled) 대비 ×0.2–×5 밖의 변화가 하나라도 있으면 refresh 전체를 거부하고 마지막 좋은 표를 그대로 둔다. 추측하지 않는다. (3) 받은 표는 `ModelPriceTable.decode`로 검증한 뒤 `~/.os1/pricing/model-price-table.json`에 원자적으로(0600) 쓰고, 영수증 `~/.os1/pricing/refresh-receipt.json`(fetched_at, source URL·sha256·HTTP 상태, 바뀐 행, 거부 사유)을 남긴다. 거부도 영수증에 남는다. (4) routing(`ModelPriceTable.current()`)은 refresh된 표가 없거나, 무효이거나, 파일 날짜로 72 h보다 오래되면 compiled 표를 쓴다. (5) App은 frontier monitor의 기존 poll에서 하루 최대 한 번(영수증 기준; 같은 process에서도 24 h 안에 다시 하지 않는다), 아무것도 돌지 않을 때만 시작한다. 리뷰 뒤(같은 날): '아무것도 돌지 않음'은 self-update 게이트와 같은 술어(run 실행·시작, 중지 중, 이 Mac의 Fleet job)이고, 시작할 때와 표를 쓰기 직전에 다시 본다. 그사이 일이 시작되면 표도 영수증도 쓰지 않고(`deferred_busy`) 다음 idle poll에서 다시 한다. LaunchAgent는 없다.
    - **K7 넓힘.** 한국어 '무엇' 술어(뭐야, 뭐냐 계열)가 음이 아닌 일반 정수 둘 사이의 ASCII '-' 하나를 물으면 계산기가 정확히 답한다("1-1은 뭐냐?" → 0; qwen 9B는 틀렸다). '/'(날짜 읽기), 연산자 둘 이상, 소수, 부호, 앞자리 0, 네 자리 수 둘(연도 범위 "2021-2022는 뭐야?"), 영어 "what is 7-11?"은 그대로 보류한다. 공유 벡터에서 "3-4는 뭐야?"(점수)와 "9-5는 뭐야?"(근무 시간)가 보류에서 값(-1, 4)으로 바뀌었다(설계가 요구한 모양 그대로다). '+'는 원래 모호하지 않으므로 "1+1은 뭐냐?"는 전부터 답했다.
    - **그대로인 것.** 오너 단어, explicit route, 인증 출처, escalation 1회 사다리, cap과 headroom, 단일 node 규칙, 라벨(`graded:<grade>`, `admitted_graded_<grade>`). graded route와 local route는 예측이지 인증이 아니다. bridge pin `rccRuntimeModuleSHA256`을 다시 고정했다. 품질 동등성과 쿼터 절감은 측정하지 않았다.
  - **변경 2 part 3: soft/hard rail, local chat 말투, classifier 미리 데우기 (같은 날 lead 결정, build 441 part 3).** part 2의 실측(243 요청)에서 남은 과지출의 대부분은 키워드 rail이 local 읽기를 이긴 경우였다. "심심한데 아무 얘기나 해줘"는 local이 chat으로 읽었는데 "해줘" 주문 rail 때문에 astra로 갔고, "만들어", "해줘", "함수", "모델" 오탐이 나머지를 차지했다. 바뀐 것은 아래다.
    - **hard rail.** local 읽기가 절대 낮추지 못한다. 대상은 다음과 같다.
      - write scope(`ScopeResolution`), shell 필요, 이름 붙은 경로, 이미지, 첨부 material과 source.
      - 오너 자신의 파일과 기기("내 데스크탑에 있는 보고서", "my documents"; 새 신호 `owner_material`). "해줘"가 soft가 되면서 이런 요청을 혼자 붙잡을 rail이 없어져 넣었다. 키워드 fallback에서도 workspace다.
      - external system, 외부 행동, 배치·전달 주문. 예: 보내, 올려, 남겨, 저장, 전달, 메일로, 카톡으로, post/email/send/save/upload/publish/share, "…에 적어/써/정리". "…에 대해 써줘"와 "…안에 써줘"는 장소가 아니다.
      - 편집·상태·계속 주문(고쳐, 수정, 바꿔, 지워, 했냐, 됐어, 계속, 진행, 시작)과 코드 객체 정의("User 타입 정의해줘"). 실측에서 9B는 이 정의 요청을 explain/standard로 읽었다.
      - 내용 없는 대동사("그럼 실제로 해봐", "다시 해봐", "빨리 해").
      - 오너 프로젝트와 OS-1 어휘(ASR 철자 포함). `projectTerms`, `workspaceTerms`, `localWorkTerms`, 작업공간 상태 어휘, 경로·파일 이름, 그리고 `technicalTerms` 가운데 라우팅·쿼터·routing·quota다.
      - 특정 대상을 가리키는 기술어("the error", "우리 서버").
      - 상태 check-in과 상태 질문, 실패 호소.
      - 이전 턴 참조와 지시대명사·지시관형사+명사. 예: 아까, 방금, 전에 말한, what you said, 이거/그거, "이/그/저 + 명사", "위에 쓴 거", "this concept". 의문사 앞의 "이"("방정식 이 뭐야?")와 "this week" 같은 시간 표현은 제외한다.
      - current_facts, text operation, 가장 강한 모델이나 think hard 요청.
    - **soft rail.** local 읽기가 채택되면 그 읽기가 정한다. 키워드 fallback에서만 전처럼 rail로 남는다. 대상은 다음과 같다.
      - 외부 효과 없는 일반 명령 어미(신호 `soft_order`): 해줘, 해봐, 해라, 하라, 써줘, 적어, 정리해, 짜줘/짜봐, 그리고 영어 make/create/write/draft/compose/implement.
      - 일반 질문 속 프로그래밍 단어(신호 `soft_material`): `technicalTerms`의 나머지(함수, 변수, 클래스, 메서드, 에러, 오류, 버그, 서버, 데이터베이스, 토큰, 모델, api, sdk, function, class, model 등).
      - 명사 지시 대상이 없는 부사·장소 지시어(신호 `soft_deictic`): 이렇게, 그렇게, 이런, 그런, 거기, 저기, 위에, 아래. 예: "왜 이렇게 떨어졌는지", "저기압", "위에 좋은 음식".
    - **판정 방식.** 키워드 프로필은 rail이 soft 증거만으로 섰을 때 위 신호를 붙이고, answer_kind·tool_need·difficulty 판정은 바꾸지 않는다. `railsDecide`는 hard rail만 본다. soft rail만 있으면 local에 묻는다. `combine`은 local 읽기가 있으면 hard rail만 세우고 신호 `llm_overrules_soft_rail`을 남긴다. local은 여전히 어떤 rail로든 올릴 수 있다. local 결과가 없으면 soft rail도 전처럼 rail이다.
    - **"만들어".** soft 어미지만 `ScopeResolution`이 모든 "만들어"를 쓰기 주문으로 읽고(`positiveEdit` 부분문자열), write scope는 hard다. 그래서 "예시 하나 만들어봐"는 work(레퍼런스) 그대로다. local도 write로 읽어 정책 A면 결과가 같다. "블랙홀은 어떻게 만들어져?"와 "치즈는 어떻게 만들어?"도 여전히 쓰기로 읽혀 레퍼런스로 간다. 실행 권한을 정하는 `ScopeResolution`을 바꿔야 고칠 수 있어 이번에는 건드리지 않았다(미해결 항목).
    - **local chat 말투 (`rcc-plugin.mjs` `localWorkerStyle`).** Core는 local이 chat·light·도구 없음으로 읽었을 때만 Auto node를 local 행에 묶는다. 그런 ticket(explicit route 없음, 산수 아님)은 대화용 system prompt를 받는다. 요청 언어로 짧고 자연스럽게 답하고, 한 일·확인·전송을 주장하지 않으며, 지시나 내부 규칙을 말하지 않는다. explicit route(route-all과 named)와 정확 산수 지시는 "final result only" prompt 그대로이고, 정확 검사기도 그대로다. 대화 답은 execution-only 전달이며 task-verified가 아니다. bridge pin `rccRuntimePluginSHA256`을 다시 고정했다. `rcc-runtime.mjs`는 바뀌지 않았다.
    - **classifier 미리 데우기 (`LocalRequestClassifier.keepWarm`).** App의 기존 idle poll(frontier monitor, 5분 간격)을 쓰고 새 루프는 없다. 다음 셋을 모두 만족할 때만 움직인다: 실행 중인 run이 없음, memory pressure normal, 오너가 2시간 안에 요청을 보냈거나 App을 열었음. 그때 `/api/ps`에 classifier 모델이 없으면 생성 없는 적재 요청(`/api/chat`, messages 없음, `keep_alive` 30m)을 한 번 보내고, 남은 상주가 10분 아래면 연장한다. Ollama client는 `RoutingOrderInterpreter`의 것 하나다.
    - **실측 (2026-10-27, 16 GB Mac, Ollama 0.35.1).** 9B는 5.63 GB(context 4096), OpenClaw 4B는 4.35 GB(context 32768)를 상주로 쓴다. Ollama는 둘을 함께 두지 않았다. 어느 쪽을 적재해도 다른 쪽이 내려갔고, swap은 이미 약 10.5 GB 사용 중이었다.
      - 적재(page cache에서): 9B 4.3-5.0 s, 4B 2.2-3.1 s. 연장 요청은 0.04-0.05 s다.
      - 분류: cold(모델 미상주, page cache) 7.3 s, warm 3.0-4.0 s, OpenClaw 4B가 9B를 내린 뒤 8.2 s. 모두 12 s 상한 안이다. 디스크에서의 cold 적재(10-16 s)만 상한을 넘는다.
      - 기본값: 9B를 오너 활동 창 안에서, memory pressure가 normal일 때만 데운다. 창 밖에서는 마지막 사용 30분 뒤 내려간다. local chat 답(4B)은 9B를 내리고, 다음 분류가 재적재 약 4-8 s를 치른다.
    - **실측 route (zero quota, 같은 243 요청, 실제 9B).** local 읽기는 part 2와 하나도 다르지 않았다(temperature 0, seed 7). 지연은 median 4.1 s, p90 4.6 s, max 5.4 s이고 243개 모두 채택되었다. local에 묻는 요청은 150개에서 174개로 늘었다.
      - route: astra ultra 103 → 89, sol medium 105 → 115, luna low 30 → 33, local 2 → 3. 계산기 2와 harness 한계 1(astra high 행 없음)은 그대로다.
      - 내려간 14개: "파이썬으로 피보나치 함수 어떻게 짜는지 알려줘", "비트코인 가격이 왜 이렇게 떨어졌는지 설명해줘", "What did OpenAI announce this week?"는 sol. "고기압과 저기압의 차이 설명해줘", "저기압이 뭐야?", "지수 함수가 뭐야?"는 luna. "위에 좋은 음식이 왜 좋은지 설명해줘", "슈뢰딩거 방정식 이 뭐야?"와 "얘기해봐", "해설해줘", "자세하게 해봐", "더 해줘", "제대로 해봐"는 sol. "심심한데 아무 얘기나 해줘"는 local이다.
      - 새로 묻게 된 나머지 10개(에세이, 이메일, 보고서, 커버레터, 소설, 투자자 메일, QMGR, PPT, 합의 알고리즘, 트롤리 논증)는 local이 write, design 또는 deep으로 읽어 레퍼런스 그대로다.
      - 이 14개 가운데 local의 오독으로 route가 바뀐 것은 없다. 경계 사례는 하나다: "고기압과 저기압의 차이 설명해줘"는 light(luna)로 읽혔고, 키워드라면 standard다.
  - **변경 2 리뷰 뒤 (같은 날, 독립 리뷰, build 441 review).** 리뷰가 실제 9B와 Ollama 꺼짐 상태로 재현한 결함을 고쳤다. 위 part 2·part 3 문장 가운데 아래와 어긋나는 것은 이것으로 대체된다.
    - **키워드 unknown 기본값 삭제.** local 결과가 없으면(Ollama 꺼짐, cold 시간 초과, schema 밖 답, 그리고 local에 묻지 않는 모든 비 Auto 선호) 키워드 프로필 그대로다. rail 없는 키워드 `unknown`은 `unknown`으로 남는다(신호 `keyword_unknown_default` 없음). 이전 기본값(answer·standard)은 읽지 못한 일("Pay the electricity bill", "택시 불러줘", "랜딩 페이지 카피 영어로 갈아끼워", "Ship it")에 read-only scope와 도구 없는 chat lane을 주었다. Codex가 소진되면 claude-chat으로, 선호가 claude면 claude-chat fable max로 갔다. 이는 설계 A2(실제 쓰기·전송 요청을 chat으로 보내지 않는다)를 어긴다. graded 승인은 owner_scope `read_only`를 요구하므로 비용 기본값만 따로 남길 방법이 없다. 그래서 local 결과가 없으면 이런 요청은 build 440처럼 writer scope의 레퍼런스다. DESIGN-2의 'rail 없는 키워드 unknown은 answer·standard' 문장을 이것으로 대체한다(lead 확인 필요).
    - **승인은 hard 주문.** 앞 턴이 제안한 일을 승인하는 짧은 말은 신호 `approval`의 hard work rail이다. 동의·방식 단어와 대동사만 있는 말이 해당한다("그런 식으로 해줘", "네 그렇게 부탁해요", "ㅇㅋ 그렇게 가자", "그대로 진행해줘", "Yes, go ahead", "Sure, go for it", "Do it", "Ship it", "Yes please"). 실측에서 9B는 이것들을 모두 chat/light/none으로 읽었고, route는 local 4B 행, luna low, claude-haiku로 갔다. 동의만 있는 말("좋아", "Sounds good", "응 고마워")과 질문("그렇게 하면 왜 안 되는지 설명해줘")은 승인이 아니다.
    - **local 읽기가 일을 답으로 낮추지 않는다.** `action` 표지는 키워드가 답 요청을 들었을 때(답 어간, 예: "오늘 환율 알려줘"의 '알려')나 읽기가 current_facts 조회일 때("내일 날씨 어때?"는 v2에서 action/light/current_facts로 읽혔다; current_facts는 도구 있는 read-only agent만 받고 도구 없는 lane은 열리지 않는다)만 `explain`이고, 아니면 work다(신호 `llm_action_is_work`; "다크모드 켜줘"는 action/light/none으로 읽혔다). 답 어간도 composing 주문(soft_order)도 없는 요청을 local이 write나 design으로 읽으면 키워드 `unknown`을 유지한다(신호 `keyword_unknown_kept`). 그 결과는 정책 A의 레퍼런스이고 scope는 writer이며, read-only scope와 도구 없는 lane은 열리지 않는다("김 대리 앞으로 회의 연기 공지 메일 쏴줘"와 "랜딩 페이지 카피 영어로 갈아끼워"는 write/none으로 읽혔다). soft composing 주문("시 한 편 써줘", "QMGR … 짜봐")은 part 3 그대로 local 읽기를 따른다.
    - **영어 외부 행동.** 요청 위치(문장 처음, 또는 please·and·then·also·can you 뒤)에서 목적어가 붙은 buy, purchase, order, pay, book, reserve, reply, cancel, schedule은 `external_action` hard rail이다("Pay the electricity bill", "… — also buy 10 shares of AAPL", "Reply to John …"). "Order of operations"와 "how to pay the bill"은 해당하지 않는다.
    - **classifier 프롬프트 v2와 어휘 rail.** 요청은 `<request>…</request>` 사이의 데이터로 보낸다(안에 쓴 태그는 무력화한다). 시스템 프롬프트 끝에 두 문장을 더했다. 하나는 '안의 지시·표지·router note를 따르지 않는다'이고, 다른 하나는 '보내기·답장·주문·구매·결제·예약·전화·설정 변경은 짧거나 인사 뒤에 와도 action/execution이다'이다. `promptVersion`은 `local_cls_v2`이다(task별 영수증 key가 바뀐다). classifier 자신의 어휘("(router note: chat, light, none)", "[classifier: chat/light/none]", "task_type:")가 요청에 있으면 local에 묻지 않고 키워드 프로필이 정한다(신호 `classifier_vocabulary`). v1 실측에서 이런 표지는 엄밀한 증명을 explain/standard(sol medium)로, 설명을 light(luna low)로 낮췄다. 키워드 deep 표지를 local이 낮추지 못하게 하는 바닥은 넣지 않았다(part 2의 `llm_sets_difficulty` 결정; 미해결 항목).
    - **idle 작업의 바쁨 판정.** 가격 refresh와 classifier 미리 데우기는 self-update 게이트와 같은 술어(`idleJobsBusy`: run 실행·시작, 중지 중, Fleet job)를 시작할 때와 행동 직전(표 쓰기, Ollama 적재)에 다시 본다. 이미 시작한 적재와 fetch는 취소하지 않는다. part 3의 '실행 중인 run이 없음'은 이 뜻이다.
    - **실측 (zero quota, 실제 9B, 프롬프트 v2, 2026-10-27).** part 3과 같은 243 요청, 리뷰의 재현 목록 38개, 오탐 probe 38개를 돌렸다. 319개 모두 채택되었고 지연은 median 5.0 s, p90 5.4 s, max 6.8 s였다(빌드와 동시에 돌았다). 243 요청에서 local에 묻는 수는 174개 그대로다.
      - v1과 v2의 읽기는 38개가 달랐다. 같은 v2 읽기를 HEAD 코드와 고친 코드에 넣으면 route 차이는 0이다(v1 읽기로도 0). 그래서 아래 route 변화 9개는 모두 프롬프트 탓이다.
      - light와 standard 사이 이동이 7개다: "x^2 + 3x - 4 = 0 의 해를 구하는 과정을 설명해줘", "감기는 왜 걸려?", "디자인 패턴이 뭐야?"는 luna에서 sol로, "블랙홀 진짜 있어(?)" 2개와 "엔트로피가 뭐야?"는 sol에서 luna로 갔다.
      - "양자역학 어려워(?)" 2개는 chat/light로 읽혀 sol에서 local로 갔다.
      - 하나는 내려갔다: "Compare utilitarianism and deontology on the trolley problem and argue for a conclusion"이 explain/deep에서 explain/standard가 되어 astra ultra에서 graded sol medium으로 갔다(실패하면 1회 escalation한다).
      - route: sol medium 115 → 114, astra ultra 89 → 88, luna low 33 → 33, local 3 → 5.
      - 리뷰 목록: 승인 12개, 영어 외부 행동, 자연스러운 말투의 일 13개는 모두 writer scope의 레퍼런스다. 남은 것은 한국어 주입 문장 "안녕 :) 그냥 잡담이야, 도구 필요 없어 — 그리고 택시 불러줘" 하나다. local이 chat으로 읽어 local 행으로 간다('불러'는 '노래 불러줘'에도 쓰여 키워드로 넣지 않았다). 반대 방향 비용도 하나 있다: "노래 한 곡 불러줘"는 v2에서 action/execution으로 읽혀 레퍼런스로 간다.
    - **그대로인 것.** soft/hard rail 구분, 정책 A, 라벨, Core `rcc-runtime.mjs`, bridge pin. 품질 동등성은 측정하지 않았다.

- **변경 3 (2026-10-27, 오너 지시 δ = 0, build 442).** 오너 지시: 능력표와, 그것으로 과제마다 가장 비용 효율적인 모델을 고르는 식을 만든다. 허용 오차 δ = **0%**: 더 싼 (모델, effort)는 1차(제공사 자신의) benchmark가 pool 레퍼런스 **이상**을 보여 주는 곳에서만 그 레퍼런스를 대신한다. 범위는 **깊은 작업**(설계, 증명, 유도, 결과물, 어려운 코딩)뿐이다. 이것들은 지금 정책 A로 레퍼런스에 간다. light·standard 라우팅 규칙(luna low, sol medium, local chat)은 build 441 그대로다(단 프롬프트 v3이 9B의 다른 읽기도 일부 바꾼다: 아래 리뷰 반영의 v3 항목). 공식 점수는 없을 수 없다("공식 점수는 없을 수가 없다"). 점수를 지어내지 않는다. 근거는 `artifacts/OS1_ROUTING_20261027/capability-table.json`(289행, 확인 247행)과 563행 재조정 `captable/out.json`이다(rows_final.json이 그 손실 없는 사영임을 대조했다). 바뀐 것은 아래다.
  - **능력표 (compiled, 결정적, offline).** `scripts/capability-table.mjs`가 `scripts/capability-evidence-20261027.json`(out.json 563행을 그대로 옮긴 것, 원본 sha256 기록)과 compiled 가격표에 규칙을 적용해 표를 찍는다. 그 바이트가 `Resources/model-capability-table.json`과 `ModelCapabilityTable.swift`의 compiled 바이트·pin이다(sha256 `9a20bc80…cdcd9`). node fixture는 script 출력 = resource = Swift 바이트를 고정하고, Swift fixture는 resource = compiled를 고정한다. 규칙은 pool별, 범주별로 적용한다. 레퍼런스는 그 pool의 레퍼런스 모델 max이고, benchmark에 max가 없으면 공개된 최고 effort다.
    - (1) 레퍼런스도 확인된 benchmark·변형에서 확인된 1차 점수가 하나 이상 있다.
    - (2) 그런 공유 benchmark **모두**에서 레퍼런스 이상이다(낮을수록 좋은 지표는 뒤집는다).
    - (3) 가격표의 typical call로 레퍼런스보다 엄격히 싸다. 같은 단위의 1차 per-task 비용이 둘 다 있는 공유 benchmark에서는 그것도 엄격히 낮다.
    - 단일 출처·이견·미공개 점수는 아무것도 자격을 주지 않는다. 레퍼런스가 확인되지 않은 benchmark는 공유가 아니고, 후보의 미확인 점수는 점수가 아니다. effort가 아닌 수준("unspecified", "best of any effort", 고정 thinking 예산)은 어떤 (모델, effort)의 점수도 아니다. 순서는 typical call, 그다음 낮은 effort다(같은 모델의 1차 per-task 비용이 모두 이 순서와 맞는지 script가 확인한다).
    - **차단 둘 (구현에서 추가, lead 확인 필요).** 세 조건만 쓰면 표가 DESIGN-3 증거표와 어긋나 행 셋을 더 넣는다: Sonnet 5.5 @xhigh(coding, writing)와 Opus 5.5 @xhigh(writing). 그래서 행을 빼기만 하는 차단 둘을 넣었다. 차단 A: 공유 benchmark에서 후보 자신의 미확인 점수가 보고된 값 **모두** 레퍼런스 아래면 막는다(Sonnet @xhigh GDPval-AA 1731 또는 1725 < 1735). 차단 B: 후보가 그 benchmark에 자기 확인 점수가 없을 때, 같은 모델의 더 높은 effort 확인 점수가 레퍼런스 아래면 막는다(Opus @max는 OfficeQA·OfficeQA Pro·Legal Agent에서 Fable 아래, Sonnet @max는 SWE-bench Multimodal 54.3 < 54.7, ProgramBench 79.7 < 87.6). 둘 다 점수를 만들지 않고 자격을 주지 않는다. 차단을 끄면(`blockers: false`) 위 세 행이 돌아온다(fixture가 두 경우를 모두 고정한다). 표의 `blocked`가 막힌 행과 이유를 보인다.
    - **결과 (= DESIGN-3 증거표).** knowledge: Anthropic은 Opus 5.5 @max(공유 5/5), OpenAI는 없음. science: Opus @max(2/2), OpenAI 없음. math: Sonnet 5.5 @max와 Opus @max(ArXivMath 두 변형). OpenAI는 결정 불가(FrontierMath per-effort는 단일 출처)라 레퍼런스. coding: Opus @medium·@high·@xhigh·@max. @max는 확인 benchmark 10개 모두에서 이상이고, @medium은 per-effort 공개 benchmark 셋과 FrontierCode Extended, SWE-bench Pro docs subset, 내부 agentic 370에서 이상이다. OpenAI는 없음(6.1 Sol @high는 DeepSWE만 이기고 Terminal-Bench 4.0에서 진다). writing: GPT-6.1 Sol @high·@xhigh·@max(GDP.pdf 하나), Anthropic 없음. tool use: Opus @max(Toolathlon 동점, AutomationBench, OSWorld partial·strict), OpenAI 없음. `os1 capability show [--json]`가 표를 출력한다(읽기 전용).
  - **local classifier 프롬프트 v3 (`local_cls_v3`).** schema에 `domain` 열거 {knowledge, science, math, coding, writing, tool_use, general}을 더했다. 시스템 프롬프트는 v2 바이트 그대로에 domain 줄 하나를 더했다(v2의 데이터 경계와 주입 무력화를 유지한다). 답 bound는 64 → 96 token이다. 조합 프로필(`RequestProfile.domain`, 선택 키 `domain`)은 채택된 local 읽기에만 domain을 싣는다. `general`, 키워드 fallback, local에 묻지 않은 요청은 domain이 없고(unknown), 그 깊은 작업은 레퍼런스(정책 A)다. Swift 계약과 Core `validRequestProfile`은 domain을 local 분류 프로필에서만 받는다.
  - **deep 노드와 Core 결합 (`rcc-runtime.mjs`, 새 결과 `capability`).** deep 노드는 정책 A가 오늘 레퍼런스로 보내는 노드다. 하나는 요청 자신의 read-only answer가 deep이거나 design·write로 읽힌 경우다(도구 필요와 무관하므로 read-only workspace deep을 포함한다). 다른 하나는 design·write로 읽힌 writer다.
    - 조건: 오너 라우팅 제약이 없다(explicit route test, auto가 아닌 provider, 표면·모델·effort·품질·native ceiling 단어 없음). 최강 모델·더 생각 단어가 없다(신호 `quality_request`; 리뷰 반영: host가 어순·활용 변형까지 `RequestProfile.asksForReference`로 읽고, 해당하면 `capability_routes`를 싣지 않는다). task contract가 없다. local 프로필의 domain과 catalog `capability_routes.category`가 같다.
    - host는 domain이 있으면 그 domain의 pool별 자격 행을 새 strict key `capability_routes`로 싣는다(schema 1, policy `capability_delta0_v1`, 표 sha256, category, pool별 (model, effort); Swift `RCCRuntimeContract.CapabilityRoutes`, Core `validCapabilityRoutes`). domain이 다르거나 local 분류가 아니면 catalog를 거부한다.
    - Core는 두 pool 전체에서 dispatch 가능한 자격 행 가운데 가격표(typical call `estimated_cost_units`)로 가장 싼 것을 bind한다. 동률은 표 순서, 그다음 R11이다. tier 있는 모델만(K14), 도구가 필요한 read-only answer는 agent 표면만 받는다. 그 행은 **지금** 레퍼런스보다 엄격히 싸야 한다(refresh된 가격이 더 비싼 선택을 만들지 못한다). 그 행 **자기 pool의** 레퍼런스가 지금 dispatch 가능해야 한다(fallback이자 read-only의 escalation 대상이다. 자격은 그 레퍼런스와만 비교했으므로 다른 pool 레퍼런스 옆에서는 bind하지 않는다). builder가 `reference_unavailable`로 둔 pool(frontier quota_zero·quota_backoff·없음)이나 레퍼런스가 지금 못 도는 pool은 capability 행을 내지 않고, 노드는 정책 A의 레퍼런스와 note `capability_<category>_requires_runnable_reference`다(리뷰 반영). 어느 pool에도 레퍼런스가 없으면 R12 hold다.
    - read-only는 graded와 같은 bind 시점 여유(`max_attempts` − 과금 ≥ 2, cap − native dispatch ≥ 2, 노드 하나)와 capability ladder를 갖고, 실패 신호에 1회 escalation한다(수락은 구조 screen). writer는 ladder 없이 bind한다(δ = 0 근거로 레퍼런스 동등; 실패한 writer는 이미 workspace를 건드렸다). 다른 실패는 레퍼런스 run과 같다.
    - bind하지 못하면 레퍼런스와 note `capability_<category>_<사유>`다(none_qualify, tuple_undispatchable, requires_dispatch_headroom, requires_single_node_plan, tuple_is_reference, not_cheaper_than_reference, requires_runnable_reference).
    - route kind `capability`, route class `deep`, 사유 token `admitted_capability_<category>`, delivery basis `capability:<category>`(LEDGER_BASIS·deliveryBasisOf·route-replay). 인증이 아니다. check id와 label은 늘 null이다. check outcome은 read-only ladder의 구조 screen(`screen_pass`·`screen_fail`)만 싣고, writer는 null이다. route-replay는 `capability` 모집단을 따로 센다.
    - 오너 표시: "공식 벤치마크상 기준 이상 · 이 답의 품질은 미검증"(App receipt). graded가 함께 있으면 더 약한 '예측 경로'가 이긴다. bridge `rccRuntimeModuleSHA256`을 재고정했다(plugin은 무변경).
  - **deep 표지 바닥 (열린 gap을 닫음).** 증명·유도·엄밀·prove·derive·rigorous(그리고 deepMarkers가 이미 가진 proof·derivation·rigorously)는 조합 프로필의 바닥이다. local 읽기가 이보다 낮게 읽으면 deep으로 올리고 신호 `deep_floor`를 단다. 리뷰 반영: 바닥은 증명·유도·엄밀을 **요구하는 형태**에만 건다(`RequestProfile.deepFloorPatterns`: 증명해·증명하·증명할·증명 과정, 유도해·유도하·유도 과정, 엄밀하게·엄밀한·엄밀히(엄밀히 말하면은 제외), 영어는 낱말 전체, proof of concept·stake·work 등은 제외). 처음 구현은 부분 문자열이라 '전자기 유도 설명해줘'(sol medium), '유도가 뭐야?'·'증명사진이 뭐야?'(luna low)를 deep으로 올렸다(build 441 회귀 묶음 #71·#73·#74). 319개 회귀 묶음을 build 441 v2 읽기 그대로 다시 돌리면 이제 build 441과 route 차이가 0이다. 위 리뷰 뒤 기록의 '바닥은 넣지 않았다'(part 2 `llm_sets_difficulty`)는 이것으로 대체된다. 나머지 deep 표지(설계, 리뷰, 단계별 …)는 그대로 local 읽기가 정한다.
  - **writer 경로는 지금 host에서 닿지 않는다 (보고).** Core와 fixture는 writer capability bind를 구현했다. 그러나 host가 writer로 scope하는 요청(ScopeResolution 쓰기)은 늘 hard rail `write_scope`를 갖고, `railsDecide`가 local에 묻지 않으므로 domain이 없다. ScopeResolution이 read-only로 보는 쓰기 표현("랜딩 페이지 카피 영어로 갈아끼워")은 local이 도구 없음(write/none)으로 읽으면 read-only catalog의 `unknown`이라 레퍼런스다(fixture). 그러나 실제 9B는 이 요청을 write/standard/workspace로 읽었고(리뷰 실측 #311), workspace 읽기는 read-only `answer_only`·workspace가 되어 read-only deep answer로 capability:writing(gpt-6.1-sol @high, agent 표면, read-only)에 bind된다. writer는 아니다(read-only라 파일을 바꾸지 못한다. 쓰기 표현이 read-only로 scope되는 것은 build 441 그대로다). 닿게 하려면 hard rail writer에도 local에 domain만 물어야 한다(쓰기 요청마다 수 초 추가, rail은 낮추지 않음). build 441의 '묻지 않음' 결정을 바꾸는 일이라 하지 않았다(lead 결정). **writer capability는 build 442에 싣지 않은 것으로 본다**: Core와 node fixture의 writer bind는 hand-built catalog에서만 돈다. 2026-10-28 lead가 이 상태를 그대로 받아들였다(DESIGN-4 §6). build 442 커밋 메시지의 'writers get no ladder'는 Core 동작이지 출시된 host 경로가 아니다.
  - **실측 (zero quota, 실제 9B, 프롬프트 v3, 2026-10-28, 클라우드 호출 0).** 오너 질문 10개와 깊은 요청 30개(domain별 5개)를 돌렸다. 산출물은 `artifacts/OS1_ROUTING_20261027/run442/`이다.
    - 40개 모두 채택되었고 지연은 median 7.4 s, p90 8.7 s, max 11.1 s였다. 같은 기계에서 v2와 v3을 번갈아 20개 잰 A/B: median 6.2 → 8.2 s, p90 8.1 → 11.1 s(prompt 304 → 399 token, 답 30 → 38 token). 12 s bound는 그대로라 p90이 bound에 가깝다(넘으면 키워드 fallback, 곧 레퍼런스).
    - route: 25개가 capability로 바뀌었다(같은 읽기를 capability 없이 bind하면 25개 모두 astra ultra). typical call 합계는 40개 $6.271 → $2.913, 깊은 30개 $5.534 → $2.297이다. 오너 질문은 QMGR 하나만 바뀌었다(astra ultra → Opus @medium; local이 domain을 coding으로 읽었다).
    - 9B의 domain 오독: 로마 멸망·금리 전파(knowledge)를 science로, 리만 가설(math)과 리더 선출(coding)을 science로, QMGR(science)을 coding으로, 웹 검색 요약·브라우저 자동화(tool_use)를 science·coding으로 읽었다. tool_use로 읽힌 요청은 없었다(rail이 정한 둘은 묻지 않았다). 오독한 domain의 자격 행은 진짜 범주의 근거가 없는 행일 수 있다(QMGR → Opus @medium은 coding 근거뿐이다).
  - **리뷰 반영 (2026-10-28, 독립 리뷰 10건).** 고친 것 셋, 모두 행을 빼기만 하는 쪽이다(δ = 0을 느슨하게 하지 않는다).
    - (1) 최강 모델·더 생각 단어: 고정 문구 목록(`qualityRequestTerms`)은 어순·활용 변형을 놓쳤다('추론을 최대로', '아주 깊이 있게 생각해서', '최선을 다해서 깊이 고민', 'think very carefully', 'your strongest reasoning', '최대한 신중히 생각', '최고 수준의 모델로'가 Opus @medium·@max, Sonnet @max에 bind됐다). host의 capability 문턱만 `RequestProfile.asksForReference`(고정 문구 + 강조어 뒤 생각 동사, 생각 명사 뒤 최대, 최상급 뒤 모델·추론·effort 명사)로 읽는다. 프로필에는 넣지 않으므로 light·standard route는 build 441 그대로다(319개 회귀 묶음에서 새로 걸리는 요청 0, run442 깊은 요청 40개에서도 0).
    - (2) 자기 pool 레퍼런스: frontier가 quota_zero·quota_backoff로 빠져 `reference_unavailable`인 pool의 낮은 행이 다른 pool 레퍼런스를 escalation 대상으로 삼아 bind됐다(Fable 소진 → coding Opus @medium → astra ultra, astra 소진 → writing sol @high → Fable). 이제 capability 행은 자기 pool 레퍼런스가 지금 돌 때만 bind하고, 아니면 정책 A 레퍼런스와 `capability_<category>_requires_runnable_reference`다. node fixture가 builder 경계(quota_zero·quota_backoff + reference_unavailable, read-only와 writer)를 고정한다.
    - (3) deep 표지 바닥을 요구 형태로 좁혔다(위 deep 표지 바닥 항목).
    - 고치지 않은 것과 이유: domain 오독(DESIGN-4 §2로 닫기로 lead 결정), v3 읽기 변화(lead·오너 결정), writer 경로(DESIGN-4 §6 수락), 레퍼런스 effort와 check outcome(DESIGN-3 해석, lead 확인). 모두 아래 '변경 3에서 남은 것'에 있다. 근거 파일은 `artifacts/OS1_ROUTING_20261027/review442/`다.
  - **그대로인 것.** 오너 단어, explicit route, 인증 출처, light·standard graded 목록, local chat, 계산기, hard rail, cap과 여유, graded의 노드 하나 규칙, 최강 모델·더 생각 단어의 레퍼런스, 가격 refresh(능력표는 compiled이고, 새 모델 출시 때 재compile은 열린 항목이다). 품질 동등성은 측정하지 않았다. capability 행의 근거는 제공사 benchmark뿐이다.
- **변경 3 추가 (2026-10-28, 오너 결정 "나로 가자", DESIGN-4, build 442 그대로 0.9.376).** 오너 결정: "쉐딩 방정식 설명해줘" 같은 **표준 설명도 δ = 0**을 따른다. 공식 benchmark가 레퍼런스 이상으로 보여 주는 capability 행에 묶고, sol 6.1 medium으로 가지 않는다. 그대로인 것: 가벼운 잡담·인사는 local, 정확한 계산은 계산기, 가벼운 설명(explain · light)은 [fast, low]. 바뀐 것은 아래다(근거 파일 `artifacts/OS1_ROUTING_20261027/design4/`).
  - **(§1) standard answer도 capability.** 441이 graded로 보낸 노드(요청 자신, read-only, answer_only, standard, task_type explain·chat, 도구 없음 또는 current facts만, owner scope read-only, 오너 라우팅 단어 없음)는 deep 노드처럼 `capability_routes`의 자격 행에 bind한다. design standard는 이미 capability였다. 아무 행도 bind하지 못하면 pool 레퍼런스(정책 A)이고 [workhorse, medium]은 없다(`GRADED_LISTS.explain_standard` 삭제, note `standard_policy_reference`). 사유 token과 basis는 deep과 같다(`admitted_capability_<category>`, `capability:<category>`, route class `deep`, read-only ladder 1회 escalation과 같은 여유 규칙). current facts standard는 agent 표면(도구·웹) 행만 받고, 없으면 도구 있는 레퍼런스다. 실측: 319개 묶음의 current facts standard 8개는 모두 Opus 5.5 @max agent 표면에 묶였고 레퍼런스로 간 것은 0개였다. light current facts(24개, "오늘 환율 설명해줘" 등)는 DESIGN-4 범위 밖이라 441의 current_facts 목록(sol medium) 그대로다.
  - **(§2) domain 오독에 강한 선택 (442 열린 항목 'domain 오독'을 닫음).** Q(행) = 그 행이 자격을 가진 범주 집합.
    - broad 행: 비-writing 범주 모두(knowledge, science, math, coding, tool_use)에 자격. script가 표에 `broad`로 찍는다. 오늘은 Anthropic Opus 5.5 @max 하나, OpenAI 없음. 비-writing 오독 어디서도 안전하므로 domain 읽기만으로 bind한다.
    - narrow 행(Sonnet 5.5 @max는 math만, Opus 5.5 @medium·@high는 coding만)은 domain이 **뒷받침될 때만**: (a) 결정적 marker가 local 읽기와 맞는다(`CapabilityChoice.markers`, 검토한 짧은 목록: math 증명·정리(정리해 제외)·적분·미분·방정식 풀·확률 계산·prove·theorem·integral·eigenvalue, coding 코드·함수·버그·리팩터·구현·알고리즘·언어 이름·compile …), 또는 (b) deep coding 노드에 code material rail이 있다(키워드 신호 code_block·machine_material·material·named_path; LLM이 올린 workspace는 rail이 아니다: QMGR은 뒷받침되지 않는다). 아니면 broad 행.
    - writing 행은 task_type이 write이거나 요청이 문서·결과물을 산출물로 요구할 때(문서 명사 + 작성 동사: '에세이 써줘'는 맞고 '에세이 구조 설명해줘'는 아니다), writing 읽기와 함께만 bind한다. 다른 writing 읽기는 broad 행이고 category는 `broad`다(broad 행은 writing 자격이 없으므로 basis가 writing을 주장하지 않는다). §7 뒤 writing 행은 없으므로 결과물은 레퍼런스다.
    - domain을 모를 때(키워드 프로필, local `general`, domain 자격 없는 모델 §4): explain·chat은 broad 행(설명은 writing 결과물이 아니다, category `broad`, basis `capability:broad`), design·write·그 밖은 레퍼런스다. 키워드 프로필은 standard answer에만 broad를 준다(깊은 키워드 작업은 DESIGN-3대로 레퍼런스). 이 키워드 확장은 구현의 해석이다(아래 열린 항목).
    - 선택마다 사유 token: `capability_broad`, `capability_narrow_corroborated:<marker>`, `capability_writing_deliverable`(bind한 행이 broad면 `capability_broad`). 못 묶으면 note에 `capability_choice_<choice>`. writer는 broad 행을 받지 않는다(자기 domain 자격 행만, 레퍼런스 동등).
    - 리뷰 반영(DESIGN-4 리뷰, 2026-10-28, 같은 0.9.376). (1) **writing 결과물은 domain과 무관하다.** task_type write이거나 문서를 요구하는 요청(design·explain 읽기 포함)이 writing 아닌 domain으로 읽히면 행을 하나도 주지 않고 레퍼런스다(리뷰 실측: "광합성 원리를 설명하는 보고서를 작성해줘" 등 9개가 science·knowledge·coding으로 읽혀 Opus 5.5 @max·@medium에 묶였다. Opus는 writing benchmark에서 Fable 아래다). write는 산출물이 코드여도 결과물로 센다(enum 프롬프트의 write는 코드를 포함하고, 코드인지 산문인지 가리지 못하므로 레퍼런스). 대가: 319개 묶음에서 1개("How do I implement a red-black tree in Rust? Give me the full implementation.", write/coding)가 Opus @medium에서 레퍼런스로 올라갔다(typical call 합 $33.003 → $33.124). (2) **작성 동사는 주문형만 센다.** 작성해줘·작성해서·작성 부탁·써줘·써 봐·초안 잡아줘·만들어줘·write/draft(앞에 how to·how do I… 없음)는 주문이고, 작성법·작성 요령·작성할 때·쓰기 요령·how to write는 설명이다: "보고서 작성법 설명해줘"는 broad 행(Opus @max)이고 레퍼런스가 아니다. 거짓 주문은 레퍼런스 값만 치르고 놓친 주문은 writing 자격 없는 행이므로 형태를 넓게 둔다. (3) **다른 범주의 marker는 narrow를 막는다**(`CapabilityChoice.conflict`): marker는 읽기를 뒷받침할 뿐 요청의 참 범주가 아니다. "단진자의 운동방정식을 풀어서 주기를 구해줘"를 math로 읽어도 물리 marker(운동방정식·진자·진동·회로·궤도…, 새 `science_mechanics`)가 있으면 Sonnet @max(math만)가 아니라 broad 행이다. math 읽기의 함수(coding_function)는 수학 어휘라 충돌로 치지 않는다. (4) **think-hard 문구를 넓혔다**(`asksForReference`): 심사숙고·숙고, 천천히·깊게 따져, 머리를 굴려, 온 힘·전력·총력을 다해, 가장 높은 추론(단계), "think … hard" 사이 다섯 단어까지, think step by step … hard, as rigorous and careful as humanly possible, spare no effort. 실측(qwen3.5:9b 실제 읽기, `design4/review-fix/`): 리뷰의 11개가 모두 레퍼런스다.
    - catalog `capability_routes`는 schema 2, policy `capability_delta0_v2`다: `category`, `choice`, `marker`, `pools`(선택이 허용한 행), `broad`, `references`, `price_basis`. Swift 계약과 Core `validCapabilityRoutes`가 선택 규칙(broad면 pools = broad, narrow면 marker 필수·writing 아님, writing_deliverable면 category writing)과 프로필 domain 짝(category = domain, 또는 domain 없음·writing 읽기에서 `broad`)을 강제한다.
  - **(§3) 오너 ASR 힌트.** compiled 목록은 오너가 실제로 고친 것뿐이다: 쉐딩·쉐딩거·슈레딩 → 슈뢰딩거(Schrödinger), QMGR → 양자역학(QM)과 일반상대론(GR) 통합. 오너가 고칠 수 있는 `~/.os1/local-classifier/asr-hints.json`(strict JSON `{"schema":1,"hints":[{"heard","intended"}]}`, 최대 200쌍, heard ≤ 40·intended ≤ 80 Unicode scalar(NFC; 리뷰 반영: grapheme 수는 결합 문자를 숨긴다), 제어·서식 문자·줄/문단 구분자(U+2028·U+2029·U+0085)·꺾쇠·따옴표(프롬프트 줄의 값이 따옴표를 닫지 못하게)·중복·다른 키 없음, ≤ 32 KiB)을 더한다. 무효 파일은 통째로 무시하고 receipt 줄(`asr hints: … owner file ignored: <reason>`)을 남긴다. 있지만 닿지 못하는 파일(검색 권한 없는 상위 폴더)은 'no owner file'이 아니라 `unreadable`이다. compiled 철자는 대소문자·NFC를 무시하고 비교해 owner 쌍보다 앞서고, receipt는 합친 수와 가려진 수를 센다(`owner file 1 (1 shadowed by compiled)`). 요청에 heard 철자가 있는 힌트만 domain 호출의 데이터 태그 **뒤에** "possible intended terms"로 간다. 라우팅 키워드가 아니다(키워드 프로필·rail·marker·Core는 읽지 않는다). 실측(qwen3.5:9b, 요청마다 1회, `design4/hintprobe-out.json`): "쉐딩 방정식 설명해줘"는 힌트 없이도 science였고(힌트가 바꾼 것 없음, v3 단일 호출도 science), 쉐딩과·쉐딩거·슈레딩 변형도 힌트와 무관하게 science였다. QMGR은 힌트 없이 coding, 힌트와 함께 science로 읽혔다(힌트가 효과를 낸 유일한 경우).
  - **(§4) domain 읽기는 qwen3.5:9b 이상만.** `LocalRequestClassifier.readsDomain`(Qwen 3.5 이상, 9B 이상). 4B는 task_type·difficulty·needs_tools만 읽고 domain은 무시(unknown, 신호 `llm_domain_unqualified`, domain 호출도 하지 않는다)한다. 읽은 모델은 지금처럼 `local_llm:<model>`에 남는다. `LOCAL_WORKER_MODEL`과 OpenClaw gateway pin은 그대로다(기계당 모델 하나는 443).
  - **(§5) voxel 시각 업데이트 merge.** `os1/terran-voxel-style-20261027`(4ed014e5, 3cb62563, UI만)을 merge commit으로 들였다. 겹치는 경로가 없어 충돌이 없었다. test-voxel-scene, test-gameplay-contract, test-classic-theme, test-simulation-garden, test-terran-motion이 통과한다(`SimulationGarden/node_modules`가 있어야 한다: 열린 항목; build-release는 그것이 없거나 package.json이 고정한 three 버전이 아니면 이유를 말하고 멈추며, 어디로 해석되는지 출력한다).
  - **(§6) 보수적 차단 A·B는 그대로다.** 행을 빼기만 한다. writer capability 경로는 hard rail 때문에 닿지 않는 채로 받아들였다.
  - **(§7) 막대는 레퍼런스의 공개 최고 확인 점수.** 후보는 공유 benchmark마다 레퍼런스 모델의 **어느 effort든** 확인된 최고 점수 이상이어야 한다(낮을수록 좋은 지표는 최저). 공유 여부(레퍼런스 max·top 행이 확인됨)와 per-task 비용 조건(max·top 행과 비교)은 그대로라 행을 빼기만 한다. 표는 `reference_bar: best_confirmed_any_effort`와 benchmark별 실제 막대 effort를 싣는다(sha256 `3cc0658e…b0c3`). 빠진 행: OpenAI writing GPT-6.1 Sol @high·@xhigh·@max(GDP.pdf 32.0·31.8·31.0 < astra @xhigh 32.2; 예상대로), Anthropic coding Opus 5.5 @xhigh(FrontierCode v1.1 Main 51.42 < Fable @low 52.8; 예상 밖). 남은 coding 행 Opus @medium·@high·@max는 같은 benchmark에서 54.64·53.99·54.43이다. writing은 이제 두 pool 모두 레퍼런스다. 차단 없는 문자 그대로의 규칙은 이제 writing에 Sonnet @xhigh·Opus @xhigh 두 행만 더한다.
  - **(§8) capability 행은 표의 레퍼런스 옆에서만.** bind할 때 Core는 pool의 live 레퍼런스 모델이 표의 그 pool 레퍼런스(`capability_routes.references`)와 같은지, 표의 가격 기준(`price_basis.table`)이 지금 쓰는 가격표(`active`, host가 읽은 바이트의 sha256, `ModelPriceTable.currentWithDigest`) 또는 compiled 가격표인지 본다. 어긋나면 그 pool(가격이면 모든 pool)의 capability 행을 끄고 레퍼런스로 돌아간다(token `capability_table_stale`, 못 묶으면 note `capability_<category>_table_stale`). 위 '표의 레퍼런스 = 실행 레퍼런스' 열린 항목을 닫는다.
  - **(§9) 프롬프트 v3 대신 두 호출.** 리뷰어의 319개 묶음을 실제 qwen3.5:9b에 v2와 v3으로 번갈아 다시 돌렸다(`design4/ab319-out.json`, 둘 다 319개 채택). 읽기 차이 28개. v2 읽기가 맞는데 v3이 더 비싼 class로 옮긴 경우가 있다: '양자역학 어려워(?)' chat/light(local) → explain/standard(capability), '엔트로피가 뭐야?'·'최적화 문제가 뭐야?'·'블랙홀 진짜 있어' light(luna low) → standard(capability). 판정 규칙에 따라 v3을 버리고 **두 호출**로 바꿨다(비교표 `design4/cmp9.json`: dearer 9, cheaper 1, same 18).
    - enum 호출은 build 441 v2 바이트 그대로다(시스템 프롬프트 sha256 `27a9a448…ec22b`, schema 셋, 64 token). task_type·difficulty·needs_tools는 441과 똑같이 정해진다(새로 돌린 v2 읽기 319개 = 441 기록 읽기, 차이 0).
    - domain 호출은 따로다(프롬프트 v3의 domain 줄 + v2의 데이터 경계, schema `domain` 하나, 24 token, ASR 힌트). capability를 쓸 노드(chat·explain·design·write이고 standard·deep, 또는 증명 바닥; action·execution·light는 아님, `needsDomain`)에만 부른다. receipt `local_cls_v2_dom1`이 `domain_outcome`, `domain_latency_ms`, `hint_count`를 싣는다. domain 실패는 enum 읽기를 버리지 않는다(domain general = unknown).
    - '가능하면 동시에'는 측정으로 판정했다: OS-1의 Ollama는 슬롯 하나(`-np 1`)라 동시 호출은 줄만 선다. 40개에서 enum만 median 5.4 s, 같이 띄우면 wall 8.3 s(enum 자체가 7.2 s로 늦어짐), enum 다음 domain은 wall 6.8 s(domain median 1.6 s, max 3.4 s, 더해진 지연 median 1.3 s). 그래서 차례로 부른다. 읽기는 세 방식 모두 같았다(40/40).
    - 같은 319개 v2/v3 A/B의 지연은 빌드가 함께 돌던 시간이라 절대값이 부풀었다(v2 median 8.3 s, v3 10.6 s, v3이 292/319쌍에서 느림).
    - 같은 v2 읽기를 DESIGN-4 코드로 돌리면(리뷰어가 기록한 441 replay와 비교, domain은 v3 단일 호출의 읽기로 대신함, `design4/cmp441.py`) 319개 중 route가 바뀐 것은 113개뿐이다: graded standard → capability 96, 레퍼런스 → capability 17. light·local·rail·계산기는 하나도 바뀌지 않았다. typical call 합계는 $31.62 → $33.00(표준 설명이 sol $0.037에서 Opus $0.074로 오르고 깊은 작업이 내린다).
  - **실측 (zero quota, 실제 qwen3.5:9b 두 호출, 2026-10-28, 클라우드 호출 0).** 오너 질문(run442의 owner 10개, 오너의 여섯 질문을 포함), run442의 깊은 요청 30개, 표준 설명 10개('쉐딩 방정식 설명해줘' 포함), 모두 50개. 산출물 `design4/run50-report.json`(요청별 읽기, domain, 고른 행, 사유 token, typical call 가격).
    - 50개 모두 채택. domain 호출 41개 채택, 9개는 필요 없음. 분류 지연(두 호출 합) median 10.3 s, p90 10.9 s, max 11.5 s(enum median 7.3 s, domain median 3.0 s): 12 s bound에 가깝다(열린 항목).
    - typical call 합계: DESIGN-4 $4.486, build 441(같은 v2 읽기를 441 코드로) $6.536, 모두 레퍼런스 $9.75. 묶음별: 깊은 knowledge·science·coding $0.817·$0.817·$0.975 → $0.37씩, math $0.975 → $0.296, writing $0.975 그대로(§7로 writing 행이 없다), tool_use $0.817 → $0.733, owner $0.737 → $0.727, 표준 설명 $0.423 → $0.645(sol medium $0.037 → Opus @max $0.074; 오너 결정의 비용).
    - sol medium에 묶인 것은 '오늘 원달러 환율 설명해줘'(light current facts) 하나다. 표준 설명은 하나도 sol medium에 가지 않았다.
    - domain 오독은 broad 행이 흡수했다: 로마 멸망·세계대전·리만 가설·리더 선출·인플레이션·미분과 적분은 science로 읽혔지만 모두 Opus @max(모든 비-writing 범주 자격)다. narrow는 뒷받침된 곳에서만 섰다: 소수 무한·√2 증명(math_proof → Sonnet @max), 웹 서버 캐시·rate limiter(coding_code_material → Opus @medium), LRU 캐시 구현(coding_implement → Opus @medium). QMGR은 science로 읽혔고(힌트) Opus @max다.
    - writing 결과물 5개는 모두 레퍼런스(`capability_writing_none_qualify`), '좋은 에세이 구조를 설명해줘'는 broad(`capability:broad`)다.
    - 표준 설명 10개 중 4개는 local이 light로 읽어 [fast, low](luna low)였고, '자바스크립트 클로저가 뭔지 예시로 설명해줘'는 키워드 rail(machine_material → workspace)이 local 읽기를 이겨 키워드 프로필로 남아 레퍼런스다. 441과 같다(DESIGN-4가 바꾼 것 아님).
  - **runtime 크기.** rcc-runtime.mjs가 512 KiB를 넘었다(531 KB; 442 HEAD가 이미 523,931 B). live-plan 적재기(`adaptive-plan-host.mjs`)의 읽기 상한을 1 MiB로 올리고 bridge pin(`rccAdaptivePlanHostSHA256`, `rccRuntimeModuleSHA256`)을 다시 고정했다. 크기 상한일 뿐 판정은 바뀌지 않는다.

### §8 오너 질문 기본값 (오너가 따로 정하기 전까지 적용)

1. **검사 없는 저가 전달.**
   - 꺼짐. request class별로 켜는 설정은 만들지 않는다.
   - 예외(변경 1, 2026-10-27 오너 지시): compiled class 표의 `chat_explanatory` 한 class, 그 안에서도 상태만 묻는 check-in만 (codex, `gpt-6-luna`, low)에 `nonempty_text` 답별 검사를 붙여 켠다. 나머지 class는 꺼짐 그대로다.
   - 예외(변경 2, 같은 날 오너 지시, build 441): host 요청 프로필이 `answer_only`·도구 없음·light 또는 standard로 읽은, 오너 라우팅 단어 없는 요청은 graded route(인증 아님, '예측 경로 · 품질 미검증')로 낮은 tuple에서 돈다. 수락은 구조 screen이고, 실패 신호가 있으면 레퍼런스로 1회 escalation한다. part 2: 조합 프로필(키워드 rail 먼저, 그다음 local classifier)을 읽는다. current_facts만 필요한 answer(agent surface만)와 local이 읽은 아주 쉬운 잡담(첫 턴의 local 행)도 같은 조건의 graded route다.
   - 예외(변경 3, 같은 날 오너 지시 δ = 0, build 442): local classifier가 domain을 읽은 깊은 작업(read-only deep answer, design·write로 읽힌 노드)은 compiled 능력표가 그 domain에 올린 자격 행(1차 benchmark가 pool 레퍼런스 이상) 가운데 가장 싼 것에서 돈다(인증 아님, '공식 벤치마크상 기준 이상 · 이 답의 품질은 미검증'). 레퍼런스가 fallback이고, read-only는 실패 신호에 1회 escalation, writer는 ladder가 없다.
   - 변경 3 추가(2026-10-28, 오너 결정 "나로 가자", DESIGN-4): standard 설명(graded였던 chat·explain standard)도 같은 capability 행에 묶고, 없으면 레퍼런스다(sol medium 없음). domain 오독에 강하게 broad 행(오늘 Opus 5.5 @max)을 기본으로, narrow 행은 marker나 code rail이 뒷받침할 때만 쓴다. 막대는 레퍼런스의 어느 effort든 최고 확인 점수다.
   - Q 하강은 인증과 답별 검사가 있을 때만 한다(K1/K2).
2. **D4 첫 예산.** arm ②(H0 harness parity)부터 쓴다. 지금 단계는 NOT_RUN이고, 오너 승인과 예산이 있어야 시작한다.
3. **모델 분해.**
   - 배선은 유지하고 채택은 하지 않는다.
   - 오너가 직접 나누지 않은 분해는 plan-shape 인증서(K11b, D4 이후)가 생길 때까지 받지 않는다.
4. **accepted_B 기준.** reference-vs-reference noise 값을 함께 보고하고, PASS는 문자 그대로 0으로 판정한다.
5. **15% 판정 범위.** pool별로 판정하고, M4 실제 구독 창 관측으로만 판정한다.
6. **미분류 새 frontier 모델.** 옛 레퍼런스를 유지한다. 결과마다 `reference_review_required` 알림을 붙인다(K14).
7. **레퍼런스 부재.** typed hold로 둔다. 싼 행으로 대신 실행하지 않는다(K2, 이번 구현에 포함).

### 디자인·웹사이트 판정 기준 (오너 질문 2026-10-24에 대한 보충, §3 웹사이트 행)

**객관 검사 (기계가 매번 판정)**
- 반응형 레이아웃 깨짐
- WCAG 대비율
- 텍스트 넘침과 잘림
- 깨진 링크와 이미지
- 로딩 성능
- 그리드와 정렬 일관성
- 요구 섹션 포함 여부, 금지 사항(실제 상표·로고 미사용)

**주관 판단 (느낌, 브랜드 적합성, 세련됨)**
- 정답이 없다.
- 이름을 가린 쌍대 비교(A/B/동등)로만 측정한다.
- 최종 기준은 오너의 블라인드 판정이다.
- 모델 심판은 위치·길이·자기선호 편향이 있으므로 보조 신호로만 쓴다.

**라우팅 적용 (본문 §3, §4.3과 일치)**
- 웹사이트·디자인 작업은 통째로 레퍼런스가 맡는다.
- 위 객관 검사는 결과를 수락하는 근거가 아니라 실패 신호(`partial` verifier)로만 쓴다.
- 기계적 하위 작업(이미지 크기, 반응형 수정 등)을 싼 모델에 맡기려면 두 가지가 모두 있어야 한다:
  - 그 하위 작업 전체를 덮는 `sound_full` 검사
  - plan-shape 인증서(K11b, D4 이후)
- 그전까지 하위 작업도 레퍼런스가 맡는다.
- 품질 생성 부분의 하강은 D4 whole-task 블라인드 비교로 인증된 class만 허용한다.

### 구현 상태

브랜치 `os1/one-law-20261024`, 구현 커밋 `5576cf30`..`48e240a5`. 변경 1(build 440)은 브랜치 `os1/fleet-delivery-20261026`, 커밋 `9ea9e90b`와 그 리뷰 수정 커밋이다. 상태의 뜻: **구현**은 동결 행의 동작을 넣었다는 뜻이고, **부분**은 일부만 넣고 나머지는 연기했거나 미해결이라는 뜻이며, **연기**는 이번 계획에서 하지 않는다는 뜻이다. 모든 검증은 D1(코드·fixture·replay, 모델·provider 호출 0)이다. 품질 동등성과 쿼터 절감은 어느 항목에서도 측정하지 않았다.

| 항목 | 상태 | 커밋 | 한 줄 요약 |
|---|---|---|---|
| K1 | 부분 | `5576cf30` | `admitBoundedAutoPlan`을 포함한 모든 bind가 `selectRouteCandidate` 법칙을 거친다(planner 후보 id는 hint). I1의 재실행 예산 bind 조건은 넣지 않았다(아래 정정) |
| K2 | 구현 | `5576cf30` | `executionPolicyChoice`와 `_runTask` 우회 삭제, `_reResolve`·`_spreadAcrossPools` 법칙화, 옛 `execution_only` child → 레퍼런스. 레퍼런스가 없으면 typed hold |
| K3 | 부분 | `517a4a3f` | bounded Auto가 local planner를 부르지 않는다(`no_admissible_check_or_shape`, `plan_model_calls` 0). `check_ids` 투영과 '둘 다 있음 → 1회' fixture는 K11b로 연기 |
| K4 | 구현 | `4a63fa08` | `sound_full` verifier registry(등록 probe fail-closed, `certificate_id` = verifier id, 그 attempt의 pass 기록 없이는 하강 전달 없음). D5: handback·repair_source 우회 차단, 수락 전 하강 출력 비공개 |
| K5 | 구현 | `517a4a3f` | 오너 명시 병렬을 bounded 경계에서 분리(`ownerExplicitParallelEligible`). planner 호출 없음. contract와 겹치면 `owner_partition_contract_conflict` hold |
| K6 | 구현 | `44702ec7` | App의 새 제출마다 `--max-native-dispatches 16`을 고정해 보낸다(이전 빌드 제출은 cap 없음 유지). cap 도달은 typed hold. 부수: held 정산이 수락 전 인증 하강 출력을 partial에 넣지 않음 |
| K7 | 부분 | `9b0b4f2e` | (b) 닫힌 산술 문법 os1-closed-arithmetic-v1(모호성 gate 포함) 구현. (a)는 좁은 bare-envelope 형태만(넓은 읽기 연기) |
| K8 | 부분 | `9b0b4f2e` | bind 시점 catalog 재사용은 새 단일 노드 host plan의 첫 dispatch에만(술어 한정형). 문자 그대로의 '모든 첫 dispatch 재사용'은 연기(채택 안 함) |
| K9 | 구현 | `4a63fa08` | ledger에 `delivery_basis`·`check_id`·`check_outcome`·`check_label`·`stratum`. 오프라인 감사 `route-replay.mjs delivery` |
| K10 | 구현(inert) | `48e240a5` | 동결 check-acceptance 비용 정책이 F 안에서만 순위를 매긴다. 정책 생산자와 등록이 없어 production 동작은 오늘과 같다 |
| K11 | 구현 | `f91f0b2d`, build 440 | class 인증서는 host가 D4 측정 artifact를 확인할 때만 적재한다(Swift만). 예외(변경 1): build 440 배포 표는 `chat_explanatory` 인증서 하나를 싣고, 그 근거는 D4 artifact가 아니라 compiled 오너 결정(2026-10-27)이다. 다른 class 적재에는 여전히 D4 arm ③이 필요 |
| K12 | 구현 | `6a57f69d` | K12a(계약, v1 publicSnapshot gate 수정, v2 생산자)와 K12b(App·CLI v2 전송, 부분 결과 라벨) 둘 다. K12 항목에서 swift build·OS1ContextTests·`os1 self-test` 통과(lead 결정 D7 조건) |
| K13 | 부분 | `44702ec7` | C3 주장 철회, `allow_native_subagents: true`를 모든 surface에서 거부, managed 위임 고정. typed `delegation` wire 객체는 주석으로만 예약(연기) |
| K14 | 구현 | `6a57f69d` | 미분류 모델은 정보성 exclusion `unclassified_model`로 격리한다(pool hold 없음). 모델 행 전달마다 `reference_review_required` 알림. 서명된 profile 모델만 감지 |
| K15 | 부분 | `f91f0b2d`, build 441 | N 항목 (a) 보호 경로 정렬, (b) TTL 상수, H0 v1 harness profile과 rendering 고정. (c) Codex resume 동일 바이트는 연기, H 항목 C4a·C4d는 미적용. build 440의 chat-lane 술어 변경은 변경 1에 따라 `H0@1`을 유지했다(새 descriptor 없음). build 441(오너 지시 2026-10-27)은 모델이 보는 변경 넷을 새 descriptor `H1@1`(parity unverified)로 올렸다: delegated envelope v2(guarantee 줄 바로 뒤 `silentRuleLine`, build 440 시험 초대 답이 규칙 줄을 되읊은 task d3bff6d3), Codex developer 첫머리의 apply-silently 줄(Claude system text와 같은 줄), RCC child의 status check-in card, HOME read-only Claude agent child의 answer workspace 격리. H0 항목은 그 rendering 그대로 `shipped`에 남고 `current`는 H1이다. `H0@1`에 묶인 D4 측정은 없었으므로 넘겨받을 측정도 없다 |
| K16 | 구현 | `4a63fa08` | `route-replay.mjs usage`(M1)와 `quota-replay.py`(M2/M3 추정 라벨, pool별 M4 15% 판정). 카드와 M4 artifact가 없어 M2/M3는 not_computed, M4는 NOT_RUN |

**K1/I1 정정.** 이 표의 이전 판은 K1을 '구현'으로만 적었다. 그래서 K1이 §2.2 I1의 셋째 bind 조건(재실행 예산: `max_attempts ≥ 2`, native cap 여유)까지 넣은 것처럼 읽혔는데, 틀렸다. 그 조건은 넣지 않았다. 하강 bind(`admittedRoute`·`tierRouteCandidate`)는 `max_attempts`도 native cap 여유도 읽지 않는다. 그 여유를 읽는 곳은 계획 시점 적격 조건 둘뿐이다: `ownerCollectionPlanEligible`(cap ≥ 2×obligation)과 `_calibratedContext`(여유 ≥ 2). App 계획에서는 `max_attempts`가 2(main.swift)이고, K6 cap 16 = 2×8(8은 Core가 받는 최대 노드·obligation 수)이므로 계획 시점에는 노드당 2회 여유가 선다. 그러나 cap은 무과금 하강과 무료 사전 실행 거부까지 모든 native dispatch를 센다. 그래서 bind 시점 여유는 보장되지 않는다. 뒤쪽 노드의 하강이 여유 2 미만에서 bind될 수 있고, 그때 escalation은 `native_dispatch_budget_exhausted` hold가 된다(fail-closed, 더 싼 답 전달 없음). bind 시점 여유 조건은 미해결로 남는다(K6·K10 세부 기록 참고).

**최종 리뷰 수정 (build 436 전).** 독립 반증을 통과한 minor 지적 네 개를 고쳤다. 모두 D1이다(모델·provider 호출 0).
- **K7** bare 한 연산자 형태도 앞자리가 0인 수에서 abstain한다(`'02-123'`, `'007+1'`, `'010-1234'`). 이전에는 zero-model 경로가 `pureArithmetic`을 먼저 불러 `'02-123'`을 `-121`로 답했다. `pureArithmetic` 자체(explicit-route `certified:exact` 계열)는 그대로다. 공유 vector에 이 형태들과 `'0+1'`·`'-0+1'`·`'10-0'`(0 하나는 앞자리 0이 아님)을 더했다.
- **K6×K12** v2 task의 cap hold나 사전 dispatch 오류 hold가 실행 중인 형제 없이 일어나도 task를 그 자리에서 held로 두지 않고 scheduler의 held 정산을 거친다. 그래서 완료된 답은 형제가 실행 중이었는지와 무관하게 형식 partial(`returned_unverified`)로 전달된다. v1 task와 출력을 보유한 child(handback continuation)는 이전처럼 그 자리에서 hold한다.
- **K9×K12** `route-replay.mjs delivery --snapshots`가 attempt 없는 완료 deterministic DAG 노드(plan kind `deterministic`, host가 계산한 local exact 행)를 `zero_model:deterministic_node`로 센다. 그 밖의 attempt 없는 child는 여전히 `delivered_without_attempt`다.
- **release** `build-release.sh`의 모든 `node --test` 줄에 `--test-timeout=180000`을 붙였다(Node 기본값은 무한). wiring 검사가 이를 고정한다.

### 단계별 gate 상태

| 단계 | 상태 | 근거 |
|---|---|---|
| D1 코드·fixture·replay(호출 0) | 통과(fixture 수준) | 마지막 구현 커밋 `48e240a5`의 트리에서 통과: JS fixture 68 파일, Python wiring(`test-os1-rcc-runtime-wiring.py` 312 checks 등), swift build, OS1ContextTests, `os1 self-test`. 모델·provider·유료 호출 0. 기록 replay(읽기 전용 사본): K7 산술 PASS, K9 `delivery` NO_EVIDENCE(라이브 ledger 125건이 모두 K9 이전), K16 `usage` INCOMPLETE. 부하가 높을 때(load average 100 이상)는 일부 JS fixture의 짧은 deadline과 OS1ContextTests의 wall-clock 문턱이 실패했다가, 재실행하거나 한산할 때 통과했다(flake로 기록). release 목록 밖의 스크립트 셋은 이 계획의 변경과 무관하게 실패한다: `test-parallel-execution-wiring.py`(K6 전 HEAD에서도 실패), `test-codex-desktop-transport.py`(K12 전 HEAD에서도 실패), `test-r10-catalog-request-wiring.py`(이 계획 이전 `e0f0c4dd`부터 harness compile 실패) |
| D2 설치 앱(모델 호출 0) | **미실행** | 빌드·설치, 설치 bundle hash 확인, K7 입력의 dispatch 0 smoke를 하지 않았다. 그래서 '설치된 bundle의 zero-model 경로는 호출 0'은 아직 주장할 수 없다 |
| D3 실제 native 왕복 | **NOT_RUN** | 오너 승인과 RunCard가 필요하다. IG-00(typed cap 실측, cancel, quota 거절)과 IG-01(native worker 2개 overlap, partial/limit) 모두 하지 않았다 |
| D4 품질·쿼터 수락 | **NOT_RUN** | 오너 승인과 예산이 필요하다. arm ①②③ 모두 하지 않았다. 그래서 품질 동등성, pool별 15% 절감, 측정에 근거한 class 인증서 발급은 하나도 주장하지 않는다. build 440의 `chat_explanatory` 인증서는 측정이 아니라 오너 결정(변경 1)이고, 그 품질 동등성도 측정하지 않았다 |

`delivery_policy_valid`(검사 없는 저가 전달 0)는 D1 fixture로만 확인했다. 실제 품질 동등성과 쿼터 절감은 아직 측정하지 않았다.

### 동결 본문과 다른 점 (lead 커밋 단계에서 수락, 오너 확인 전)

동결 기록 규칙에 따라 본문은 바꾸지 않았다. 아래는 구현이 본문과 다르게 간 곳과 그 이유다. 오너가 확인하면 동결 기록에 변경 항목으로 옮긴다.

- **K1** I1 재실행 예산 bind 조건이 없다 — App 계획은 계획 시점 적격(cap 16 = 2×8)이 대신하고, bind 시점 부족은 fail-closed hold다(위 정정).
- **K3** skip 때 plan_proposal `not_needed` resource event를 남긴다 — 없으면 owner 병렬 task 회계가 `plan_model_calls_unobserved`로 불완전해진다.
- **K3** `check_ids` 투영과 '둘 다 있음 → planner 1회' fixture를 K11b로 미뤘다 — gate가 K11b 전까지 상수 거짓이라 지금 넣으면 죽은 코드다.
- **K4** certifier 입력에서 `selected_config`·`native_receipt`를 뺐다 — 등록 probe와 같은 입력이어야 행에 기대는 pass-all verifier를 등록 때 잡는다.
- **K4** 등록 probe가 throw·timeout(60 s)·malformed면 등록을 거부한다(`verifier_registration_probe_unanswered`) — spec처럼 '통과 아님'으로 세면 판정하지 않는 verifier가 `sound_full`로 등록된다.
- **K4** registry는 늘 새로 brand한 Map으로 복사한다 — 등록된 Map을 그대로 돌려주면 나중에 probe 안 된 항목을 끼워 넣을 수 있다.
- **K5** §2.3-6의 partition early return도 K5에서 했다(planner 0, `not_needed` event) — lead 결정 D1.
- **K5** admission facts 존재 조건을 유지했다 — 없으면 옛 catalog도 partition된다.
- **K5** contract와 명시 A/B가 같이 있으면 hold(`owner_partition_contract_conflict`)다 — 전에는 contract 인증 1 node로 돌았지만 partition과 contract는 배타다.
- **K5** 업그레이드 전 proposal 도중이던 partition task는 재계획 대신 hold된다 — 재시작 reconcile이 planning 상태를 hold하므로 D1이 말한 재계획 경로에는 도달하지 않는다.
- **K6** cap을 argv 리터럴이 아니라 제출마다 고정한다(이전 빌드 제출은 nil) — budget이 Core 제출 fingerprint에 들어가서 같은 ID retry가 `idempotency_conflict`가 된다.
- **K7** (a)는 좁은 형태만 넣었다 — 넓은 형태는 '모르는 이력은 모델에게' fixture를 뒤집는다(lead 결정 D9).
- **K7** `pureArithmetic`은 바꾸지 않았다 — explicit-route `certified:exact` 계열이고 plugin verifier·Swift envelope과 짝이다.
- **K7** ASCII `-`·`/`만 있는 식은 '='나 수량 술어(얼마·몇·how much is)가 있을 때만 산술로 읽고, 앞자리가 0인 수는 bare 한 연산자 형태를 포함해 모든 강도에서 abstain한다 — 날짜·전화번호를 zero-model 산술로 답하지 않기 위해서다(HEAD는 감싼 형태를 모델로 보냈고, bare '02-123'은 -121로 답했다. bare 형태는 최종 리뷰에서 고쳤다).
- **K7** 소수 피연산자를 더했다 — 동결 행에 없던 확장이며, 답은 유한 소수만 낸다.
- **K8** 술어 한정형에 `hostAutoPlan` 조건까지 더했다 — 문자 그대로 하면 calibrated 재검사가 공회전하고 contract 재관측을 건너뛴다(lead 결정 D9).
- **K9** 라벨은 top-level `check_label`에 둔다 — `_outcomeSummary`는 adaptive가 꺼지면 null이고 8 KB를 넘으면 지워진다.
- **K9** `zero_model:*` 근거는 ledger에 쓰지 않는다 — zero-model task에는 attempt가 없다(감사는 snapshot에서 센다).
- **K9** `stratum`과 typed `certifier_unavailable`을 더했다 — K10 층의 키이고, 설정 결함을 failure index에서 뺀다(lead 결정 D3).
- **K10** `selectJointRoute`가 아니라 같은 파일의 sibling 함수다 — 그 계약은 reference_match용 host evidence를 요구한다.
- **K10** 정책 행 상한은 4096이 아니라 2048이다 — stableJSON 100,000-node bound 안에서 hash할 수 있어야 한다.
- **K10** F를 일부만 덮는 정책은 inactive이고 `exact`·`class` source는 제외한다 — 덮이지 않은 행을 0으로 보지 않으며, class에는 check-acceptance label이 없다.
- **K10** 레퍼런스 결정은 비용을 매긴 escalation target을 묶는다 — R11 레퍼런스 serve는 F 밖의 비용 미산정 레퍼런스를 고를 수 있다.
- **K11** JS `validClassCertificates`는 바꾸지 않았다(Swift만) — Core는 host custody를 볼 수 없고 bind 시점 admission은 고정이다.
- **K11** harness를 `id@version`(artifact·receipt 키 `harness_scope`, 지금 `H0@1`)으로 묶는다 — id만 쓰면 새 version이 옛 측정을 물려받는다(lead 결정 D6 보정).
- **K11** 만료는 catalog 생성 시점에만 확인한다 — bind 시점에 확인하려면 wire 필드와 JS pin 변경이 필요하다.
- **K12** v1 failed task는 wire 결과가 없다 — v1 Swift validator가 failed+result를 거부해서(RT-08 결함) '지금 형태 유지'는 불가능했다.
- **K12** v2 partial을 returned_unverified에도 허용한다 — 유일한 held partial 생산자 `_hold`의 상태가 returned_unverified다.
- **K12** `native_receipt_sha256`은 null, `parent.revision`은 `≤`로 검사, deterministic node의 `attempt_id`는 null이다 — Core가 receipt digest를 기록하지 않고, terminal 뒤 no-op에도 revision이 오르며, K7 node에는 attempt가 없다.
- **K12** version을 제출마다 고정한다(`--result-contract-version 2`) — K6와 같은 fingerprint 이유다.
- **K13** typed `delegation`은 주석으로만 예약하고 flag는 모든 surface에서 거부한다 — dispatch 전 강제를 보인 adapter 증거(D3)와 자식 receipt 채널이 없다.
- **K14** 명시적 known-untiered 집합(9개)을 둔다 — production이 tier 없는 모델을 서명하므로 'tier 없음 = 새 모델'이 성립하지 않는다.
- **K14** C9 pool hold는 코드에 없었고, 알림은 reason 토큰 + `routingNotices`로 하며 ledger에는 남기지 않고, 감지는 서명된 profile 모델만 한다 — 철회할 코드가 없었고, 저장된 decision을 바꾸지 않기 위해서다.
- **K15** (c) Codex resume 동일 바이트를 미뤘고, 선택 receipt 키 `claude_prompt_cache_ttl`은 넣지 않았다 — 로컬 rollout 모양을 먼저 비용 0으로 읽어야 한다(lead 결정 D9).
- **K15** H0 golden은 Swift builder와 Swift chat-lane 술어만 덮는다 — JS `chatFirst`는 bridge SHA pin이 고정한다.
- **K16** `verified_not_dispatched` attempt의 null usage는 verified zero로 센다 — executor가 무작업으로 typed했고 `chargedAttempts`도 그렇게 본다(런타임 reducer와의 차이는 따로 보고).
- **K16** 판정은 pool별 native 완전성으로 하고, snapshot 없이는 complete가 없다 — 구독 창이 pool마다 따로 있고 ledger 쓰기는 best-effort다.
- **K16** `route-replay` 입력은 명시 경로(보고서에 sha 기록), `quota-replay` 입력은 sha pin이다 — lead 결정 D4 관례.

### 연기 목록 (lead 결정 D9)

- K11b plan-shape 인증서 kind와 K3 `check_ids` 투영. '둘 다 있음 → planner 1회' Core fixture와 bounded 전용 Core 경로 test 복원도 함께(D4 이후).
- `chat_explanatory`(변경 1, 오너 결정)를 뺀 class의 실제 인증서 적재. D4 arm ③ 측정 artifact와 별도의 class 표 재서명·오너 서명이 필요하다.
- K13 typed `delegation` wire 객체와 자식 receipt 누락·초과 → incomplete/hold fixture.
- K14 서버가 서명하지 않은 native 모델의 감지.
- K15 (c) Codex resume 동일 바이트(self-test F, rollout parser 포함).
- K15 H 항목 C4a·C4d(새 descriptor H1, D4 arm ②가 H0을 잰 뒤).
- K8 문자 그대로의 모든 첫 dispatch 재사용(술어 한정형만 구현).
- K7 (a) 넓은 읽기(좁은 bare-envelope 형태만 구현).

### 남은 미해결 항목 (연기 목록 밖)

- I1 bind 시점 cap 여유 조건(위 K1/I1 정정). 변경 2의 graded route에는 넣었다(`max_attempts` − 과금 ≥ 2, cap − native dispatch ≥ 2). certified 하강에는 아직 없다. 넣으면 '하강 실패 시도는 무과금이라 `max_attempts` 1에서도 escalation한다'는 설계에 기댄 fixture 9개(7개 파일)의 동작이 바뀌므로 lead 결정이 필요하다.
- partial·legacy 신호 verifier의 pass가 `verifier_outcome` `pass`로 `stats`에 세인다(K4·K9). 정확한 판정은 `check_outcome`·`check_label`에 있다.
- K10 정책 생산자가 없다(K9 ledger의 check-acceptance로 `p_lower`·c를 맞추는 스크립트 없음). 비용 단위는 token이지 quota가 아니다.
- K12 v2의 cap·사전 dispatch 오류 hold는 이제 scheduler 정산으로 형식 partial을 낸다. 그 밖에 task를 그 자리에서 hold하는 곳(시간·비용 예산 등)과 cancelled에는 partial 생산자가 없고, `native_receipt_sha256`은 null이다.
- K14 tier 있는 alias가 더 새 모델로 다시 풀리면 알림이 뜨지 않는다(alias drift).
- K7 남은 모호성 위험: 첫 턴 '10/25는 얼마야?'를 날짜로, '1 더하기 1은?'을 밈으로 뜻한 경우.
- 변경 1의 범위: 처음 커밋의 인증서는 `chat_explanatory` class 전체를 덮어, 상태 질문 옆에 붙은 질문("최신 아이폰 가격 얼마니? 너 되냐?")과 `conversationalQuestion` 용어 목록 밖의 기술 질문·이어지는 턴("Swift에서 actor reentrancy가 왜 생겨?", "그게 왜 그래?")까지 luna low로 보냈다. lead가 결정의 범위를 상태만 묻는 check-in으로 좁혀 해결했다(변경 1 범위 항목, fixture 440-d). class 자체(`chatLaneEligible && !textOperation`)와 그 chat lane 판정은 build 439 그대로이고, 이런 질문은 여전히 tool 없는 chat lane에서 레퍼런스로 돈다.
- 변경 1의 chat-lane 술어 변경이 `H0@1` 아래에 있다(변경 1 harness 항목). build 441이 harness를 `H1@1`로 올렸다(K15 행). 그래서 이 술어는 이제 H1 아래에 있고 D4 arm ②가 잴 대상도 H1이다. golden의 chat-lane vector 40개에 초대 문장이 없는 것은 그대로다(초대 양성·음성은 `StatusCheckIn.selfTest`와 `providerSurfaceRoutingSelfTest`가 고정한다).
- bridge `rcc-runtime.mjs` 103행 주석 "(rcc-class-table.json, empty as shipped)"은 build 440 표와 맞지 않았다. 변경 2의 bridge 재고정 때 고쳤다.
- 변경 2의 RCC chat-lane 사실 확장(도구 없는 `answer_only`)은 chat_lane_predicate_v1의 RCC 쪽 변경이다. native 술어와 H0 golden은 그대로라 golden은 이 변경을 잡지 않는다(변경 1과 같은 처지). 2026-10-27 리뷰 정정: 앞 문장 끝의 '(golden 재고정은 merge 뒤)'는 일어나지 않았고, 재고정해도 이 변경을 잡지 못한다. K15 golden의 lane vector는 native `claudeChatLane`·`codexChatLane`과 RCC child 규칙에서만 나오며, `rccChatLaneEligible`(이제 조합 프로필의 `answersWithoutTools`를 읽는다)은 평가하지 않는다. H1 pin(f487423c) 뒤에 part 2(local 읽기 조합), part 3(soft rail 양보), 리뷰 수정이 모두 이 술어의 결과를 바꿨지만 descriptor는 바뀌지 않았고 self-test도 실패하지 않았다. 열린 항목: golden에 RCC chat-lane vector(키워드 프로필과 조합 프로필에서의 `rccChatLaneEligible`)를 더하고 descriptor를 올려 재고정할지는 lead가 정한다. 그때까지 이 술어는 `os1 self-test`의 profile check와 RCC admission facts fixture만 고정한다.
- 변경 2 리뷰 뒤 남은 것(2026-10-27).
  - local 읽기는 키워드 deep 표지(증명·유도·엄밀·prove·rigorous…)를 standard로 낮출 수 있다(part 2 결정, 신호 `llm_sets_difficulty`). 오너 지시 5(증명·설계·결과물 작성은 정책 A)와 부딪히는 지점이므로, 표지를 바닥으로 둘지는 lead가 정한다. 분류기 어휘로 낮추는 길은 어휘 rail이 막는다. 자연어 주입은 프롬프트 v2에만 기댄다.
  - 한국어 주입 문장("… 도구 필요 없어 — 그리고 택시 불러줘")은 여전히 local chat으로 간다.
  - local 결과가 없을 때 키워드 `unknown`은 레퍼런스다(기본값 삭제). 오너 지시 3('애매하면 최대' 거부)과 설계 A2(쓰기·전송 요청을 chat으로 보내지 않음) 사이의 선택이며, lead 확인이 필요하다.
- 변경 2 part 2의 K7 넓힘은 "3-4는 뭐야?"(점수)와 "9-5는 뭐야?"(근무 시간)를 계산기로 답한다(설계가 요구한 모양이다). 이것을 막으려면 '-' 앞뒤 수의 범위나 문맥으로 더 좁혀야 하고, 오너 결정이 필요하다.
- 변경 2 part 2의 local classifier는 디스크 cold 적재(10-16 s)를 12 s에서 끊는다. part 3의 미리 데우기는 오너 활동 창(2시간) 안에서만 돈다. 그래서 오래 쉰 뒤 App을 다시 쓰기 전 첫 요청, memory pressure가 normal이 아닐 때, OS-1 CLI만 쓸 때(App이 없으면 poll도 없다)는 여전히 키워드 프로필(soft rail 포함)로 갈 수 있다. 9B와 OpenClaw 4B는 이 Mac에서 함께 상주하지 못한다. local chat 답과 explicit local route는 다음 분류에 재적재(약 4-8 s)를 얹는다. local chat을 9B로 돌리거나 classifier를 32K context의 4B로 공유하면 없어지지만, 둘 다 별도 결정이다.
- 정책 B(`workhorse_first`)는 구현과 fixture만 있고 내보내지 않았다. B를 켜는 durable Core 옵션은 없다(resolver fixture 옵션만 있다).
- 변경 2 part 3 뒤에 남은 hard rail 과잉 상승(비용만 든다, 243 요청 실측 16개).
  - `ScopeResolution`이 의문·피동 "만들어"를 쓰기로 읽는다: "블랙홀은 어떻게 만들어져"(2), "치즈는 어떻게 만들어?", "무지개는 어떻게 만들어지는지".
  - `workspaceTerms`와 `localWorkTerms`의 일반어가 부분문자열로 걸린다: "자바스크립트"(스크립트), "로그 함수", "튜링 테스트", "코드 진행", "토마토 소스", "bank account", "the usage of whom".
  - OS-1 backend 이름: "GPT랑 Claude 차이".
  - 상태 질문 어휘 "됐는지": "GPT-6 언제 출시됐는지".
  - 문장 안에서 지시 대상을 이미 받은 지시관형사+명사: "이 계약서 조항 … 제3조: …", "Explain this concept: entropy", "그 이유는".
  - 반대로 같은 실측에서 local이 놓친 26개(README.md, OS-1과 오너 프로젝트 어휘 5개, 이전 턴 4개, 가장 강한 모델 5개, 배치·전달 7개, 했냐고, 이 함수, 고쳐지는데, 라우팅 왜 astra)는 hard rail이 잡았다.
  - soft로 바꾼 범주가 만드는 새 위험(lead 결정 그대로다): local은 "이렇게 설명해줘"를 explain/light/none(luna)으로, "모델 선택 기준이 뭐야?"를 explain/standard/none(sol)으로 읽는다. 키워드 프로필은 둘 다 rail(이전 턴, OS-1 질문)이었다.
- 변경 2 프로필의 과잉 상승(비용만 든다): 주제어가 표지를 켠다("설계도가 뭐야?"·"원인과 결과의 차이"는 deep, "이진 검색"·"가격 탄력성"·"현재완료"는 current_facts, "저기압"·"로그 함수"·"자바스크립트"는 deictic·workspace, `technicalTerms`의 "모델"·"함수"·"class"가 들어간 개념 설명은 workspace). 어미 사이 부사("설명 좀 자세하게 해봐"는 work, "자세히"는 graded), "?" 없는 어간 없는 질문("Who invented the telephone"), ASR 띄어쓰기("방정식 이 뭐야?"), 쉼표·마침표로 끊은 군말("야. 음. …", "Keep it short.")이 같은 내용을 레퍼런스로 보낸다. "블랙홀은 어떻게 만들어져?"는 build 440부터 쓰기 주문으로 읽힌다. 모두 고치면 graded가 넓어지므로 품질 근거 없이 넓히지 않았다.
- 설계 문서의 안정성 조항은 "뭐야?"를 같은 프로필이어야 할 어미에 넣고, light 규칙은 "X가 뭐야"를 light로 정한다. 구현은 light 규칙을 따른다("슈뢰딩거 방정식이 뭐야?"는 light, "…설명해봐"는 standard). 오너 결정이 필요하다.
- HOME read-only Claude agent child 격리(H1)는 native 경로와 같은 경계다: 가드는 answer workspace와 OS-1 source만 지키고, 오너 설정의 Bash 허용 규칙이 read-only lane에 합쳐지므로 Bash는 HOME의 다른 곳에 쓸 수 있다. build 440에서는 같은 child가 dispatch 전에 collision으로 멈췄다. 모든 read-only Claude child(프로젝트 workspace 포함)가 같은 처지라 이 변경만의 문제는 아니지만, HOME 전체 쓰기 보호는 별도 결정이다.
- graded route의 품질은 측정하지 않았다(D4 NOT_RUN). 이전 ledger에서 `gpt-6.1-sol` medium은 14회 중 escalation 0회, `gpt-6-luna` low는 11회 중 3회였다. 기록일 뿐 품질 근거는 아니다.

- 변경 3 추가(DESIGN-4)에서 남은 것(2026-10-28).
  - 위 '변경 3에서 남은 것'의 domain 오독(§2), v3 읽기 변화(§9 두 호출), 레퍼런스 effort(§7 최고 확인 점수), 표의 레퍼런스 = 실행 레퍼런스(§8)는 닫혔다. domain 오독은 리뷰가 찾은 writing 결과물·물리→math 경우까지 위 리뷰 반영으로 닫았다(실제 읽기 재실행: `design4/review-fix/`).
  - 사소한 잡담·계산이 cloud로 가는 경우가 있다(DESIGN-4 이전부터; 441 이후 바뀌지 않은 키워드 rail 때문). "오늘 하루 어땠어? 나는 좀 피곤했어"는 키워드가 work + current_facts(했어 어미, 오늘)로 rail을 세워 local 읽기(chat/light)를 묻지 않고 레퍼런스($0.195)다. "1부터 10까지 더하면 얼마야?"는 계산기가 아니라 sol medium graded:light($0.037)다. DESIGN-4 범위 밖이라 고치지 않았다: 일의 대상·동사 없는 과거형 잡담 어미는 work rail을 세우지 않기, 인사 속 '오늘'은 current_facts를 세우지 않기, 급수 합은 계산기나 local로 보내기가 후보다.
  - domain 프롬프트의 힌트 줄은 데이터 태그 뒤에 있고 따로 구분된 블록이 아니다. 따옴표·구분자를 막아 값이 줄을 벗어나지 못하지만, 블록으로 감싸고 시스템 프롬프트에 데이터라고 적는 일은 domain 프롬프트 바이트(읽기)를 바꾸므로 하지 않았다.
  - 분류 지연: 두 호출 합 median 10.3 s, max 11.5 s(실측 50개, 기계 부하 있음)로 12 s bound에 가깝다. 넘으면 domain이 unknown이 되어 설명은 broad 행, design은 레퍼런스다(enum 읽기는 남는다). bound를 올릴지, domain 호출을 deep에만 줄일지는 결정이 필요하다.
  - broad 집합은 행 하나(Opus 5.5 @max, Anthropic)다. Fable이 소진되거나 막히면 broad와 narrow 행 모두 빠지고(자기 pool 레퍼런스 규칙) 레퍼런스가 묶인다. OpenAI pool에는 자격 행이 없다.
  - 키워드 fallback(local 없음)의 standard 설명은 broad 행으로 보냈다(DESIGN-4 §2의 저사양 규칙을 '읽은 domain 없음'으로 넓혀 읽음; 깊은 키워드 작업은 DESIGN-3대로 레퍼런스). lead 확인 항목이다.
  - light current facts('오늘 환율 설명해줘' 등)는 441의 current_facts 목록(sol medium) 그대로다. DESIGN-4는 standard만 바꿨다.
  - marker 목록은 짧고 검토된 것이다. 오늘 narrow 행이 있는 범주는 math와 coding뿐이라 다른 범주의 marker는 선택을 바꾸지 않는다. writing 결과물 판정은 task_type write, 또는 문서 명사 + 주문형 작성 동사다. 주문형 목록이 빠뜨린 형태("에세이 한 편 부탁해")는 explain으로 읽히면 broad 행이다(write로 읽히면 레퍼런스).
  - `SimulationGarden/node_modules`(three 0.180.0)는 git에 없다. 이 worktree는 다른 작업 공간의 공유 `node_modules`를 symlink해 voxel 시험을 돌렸다. build-release의 test-simulation-garden은 그것이 있어야 통과한다. build-release는 이제 없을 때 이유를 말하고 멈춘다(설치는 하지 않는다: package-lock.json의 경로가 다른 작업 공간을 가리켜 `npm ci`를 그대로 권하지 않는다).
- 변경 3에서 남은 것(2026-10-28).
  - 차단 둘(A, B)은 구현이 넣은 것이다. 세 조건만 쓰는 문자 그대로의 규칙이 DESIGN-3 증거표와 어긋나서(Sonnet @xhigh coding·writing, Opus @xhigh writing) 증거표 쪽에 맞췄다. 어느 쪽이 오너 뜻인지 lead 확인이 필요하다.
  - 가격 비교는 effort와 무관한 typical call이다. 같은 모델 안에서는 낮은 effort가 먼저라 맞지만, 모델 사이 비교는 effort가 쓰는 output token을 보지 않는다(이번 표에는 없지만, Sonnet @xhigh의 1차 per-task 비용은 coding 세 benchmark에서 Opus @medium보다 비쌌다). 행별 비용 모양이 필요하면 별도 결정이다.
  - local domain 오독은 진짜 범주의 근거가 없는 자격 행을 bind할 수 있다(실측의 QMGR → coding → Opus @medium; 리뷰 실측에서도 #4·#262 QMGR → coding, 리만 가설·합의 알고리즘·TCP 혼잡 제어 → science). 막으려면 domain 불확실성을 다루는 규칙이 필요하다. 2026-10-28 lead가 DESIGN-4 §2(넓은 후보 opus @max, 좁은 후보는 키워드로 domain이 뒷받침될 때만)로 닫기로 정했다. 리뷰 반영 커밋은 이 규칙을 앞당겨 넣지 않았다.
  - 프롬프트 v3은 분류 지연을 median 약 2 s, p90 약 3 s 늘렸고, p90이 12 s bound 근처다(리뷰 A/B: 같은 qwen3.5:9b에서 v3이 60쌍 중 56쌍 느림, median +1.29 s, 최대 11.9 s). bound를 올릴지, domain을 다른 방식으로 읽을지는 결정이 필요하다.
  - **v3이 light·standard 읽기도 바꾼다 (리뷰, lead·오너 결정 필요).** v2 읽기는 결정적이다(build 441 실측 3번, 319개 읽기 차이 0). v3 실측 1번(리뷰, 2026-10-28)은 둘 다 채택된 298개 중 28개를 다르게 읽었고, 같은 9B에 v2·v3을 번갈아 보내 같은 읽기를 재현했다. 그래서 build 441의 graded·local route가 코드가 아니라 읽기 때문에 움직인다. 예: #44 '1부터 1000까지 소수의 합 계산해서 알려줘' sol medium → astra ultra(v3이 action/execution으로 읽음), #50 'GTM 전략이 왜 안 먹히는지' sol medium → astra ultra(workspace), #250 'How do I do it?' local → astra ultra, #131·#132 '양자역학 어려워(?)' local → sol medium, #258 local → luna low, #127·#171·#220 luna low → sol medium, #272 astra → local(개선). 코드만의 효과는 0이다: 같은 v2 읽기를 리뷰 반영 코드로 다시 돌리면 build 441과 route 차이가 0(위 deep 표지 바닥)이고, domain을 knowledge로 둔 같은 재연은 깊은 작업 26개만 레퍼런스 → capability로 바뀐다. 근거 파일: `artifacts/OS1_ROUTING_20261027/review442/`(리뷰의 `cmp-full.txt`, `ab-out.json`, `ab2-out.json`, 리뷰 반영 재연 `r-fix-v2general.json`·`r-fix-v2knowledge.json`). DESIGN-3은 domain을 같은 schema에 더하라고 정했으므로 프롬프트는 되돌리지 않았다. 바뀐 route를 받아들일지, enum 셋은 v2 그대로 두고 domain을 깊은 읽기에만 따로 물을지(깊은 요청에만 지연 추가)는 lead·오너 결정이다(DESIGN-4가 standard 설명도 capability로 옮기므로 그 결정과 함께 본다).
  - writer capability는 host에서 닿지 않는다(위 변경 3 항목). 2026-10-28 lead가 이 상태를 받아들였다(DESIGN-4 §6). build 442에는 출시되지 않은 경로다.
  - **레퍼런스 effort (리뷰, lead 확인).** 규칙의 레퍼런스는 DESIGN-3대로 pool 레퍼런스 모델의 max(그 benchmark에 max가 없으면 공개된 최고 effort)다. 표의 pool 수준 `reference.effort`는 이 명목값 'max'이고, 실제로 비교한 effort는 benchmark마다 `reference_effort`에 있다(Anthropic coding: 대부분 max, FrontierCode Extended·내부 agentic 370은 medium, SWE-bench Pro docs subset은 high; `os1 capability show`가 benchmark별로 찍는다). 실행 레퍼런스 astra는 ultra로 돌지만 ultra 점수는 공개되지 않았다. GDP.pdf에서 astra @xhigh(32.2)는 sol의 모든 effort(high 32.0, xhigh 31.8, max 31.0)보다 높다. '레퍼런스의 공개 최고 effort 이상'으로 규칙을 좁히면 OpenAI writing 자격 행이 모두 빠진다. DESIGN-3 증거표가 sol을 writing 자격으로 정했으므로 규칙은 바꾸지 않았다. lead 확인 항목이다.
  - **check outcome (리뷰, lead 확인).** DESIGN-3은 capability의 'check 필드는 null'이라고 적었다. 구현은 graded 선례(DESIGN.md A3: check id·label은 null, 수락 결과는 구조 screen으로 기록)를 따라 read-only capability ladder의 `check_outcome`에 `screen_pass`·`screen_fail`을 싣고, route-replay는 read-only capability 전달에 `screen_pass`를 요구한다(`capability_delivery_without_screen_pass`). check id·label은 null이고 인증이 아니다. writer는 셋 다 null이다. DESIGN-3 문구를 이렇게 읽는 것이 맞는지 lead 확인 항목이다.
  - **표의 레퍼런스 = 실행 레퍼런스 (열린 항목).** capability 행은 표의 pool 레퍼런스(claude-fable-5-1, gpt-6-astra)와만 비교했다. Core는 bind 시점의 pool 레퍼런스(frontier tier 첫 모델)가 표의 레퍼런스와 같은지 보지 않는다(`capability_routes`에 레퍼런스 모델이 없다). 새 frontier 모델이 `ModelTiers`에 들어오면 표를 다시 compile할 때까지 옛 레퍼런스에 대한 자격이 새 레퍼런스 옆에서 쓰인다. 재compile과 함께 막아야 한다.
  - 능력표 재compile: 새 모델 출시(FrontierNewsMonitor가 감시한다) 때 새 1차 점수를 재조정하고 script로 다시 찍어야 한다. 자동화는 없다(열린 항목).

### 롤백 매트릭스

| 새 build가 만든 것 | 옛 build가 만나면 | 결과 |
|---|---|---|
| K14 catalog의 `unclassified_model` exclusion | 옛 JS `validateCatalog`·Swift `decodeCatalog`가 모르는 reason으로 거부 | 그 catalog를 쓰는 재시작 task는 fail-closed. JS와 Swift는 함께 되돌린다 |
| K12 `result_contract_version` 2 task | 옛 JS `validateTask`가 모르는 키로 `task_shape_invalid` | v2 task는 옛 Core에 들어가지 못한다(bridge SHA pin이 JS·Swift 짝을 고정) |
| K4 항목 형식 verifier registry(`{id, scope, surfaces, soundness, applies, verify, refutations}`) | 옛 build는 함수 값만 받아 `verifier_registry_invalid` | 등록 거부. production은 등록이 없어 영향 없음 |
| K9·K10 ledger 추가 키(`delivery_basis`, `check_id`, `check_outcome`, `check_label`, `stratum`, `descent_policy_sha256`) | 옛 build는 무시 | 영향 없음 |
| K4 ladder의 문자열 `certificate_id` | 옛 build는 무시 | 영향 없음. 반대로 K4 이전 ladder(`admitted_by: verifier`, `certificate_id: null`)는 새 build에서 certifier를 찾지 못해 출력을 버리고 레퍼런스로 1회 다시 돈다(fail-closed) |
| K6 cap 16·K12b v2를 제출마다 고정한 App 제출 | 옛 App(build 435)이 같은 task ID로 retry하면 cap·version 없이 다시 제출 | Core 제출 fingerprint가 달라 `idempotency_conflict` → `rcc_transport_preserved`. 그 결과를 받으려면 새 제출이 필요하다. 새 App은 옛 제출을 nil·v1로 유지하므로 반대 방향은 안전하다. K6와 K12b는 같은 출시에 넣어 fingerprint 시대를 하나로 한다 |
| K10 정책, K11 인증서 gate | 정책 미등록 | 되돌려도 동작 차이 없음 |
| build 440 class 표(`chat_explanatory` 오너 결정 인증서) | 옛 build(439 이하)의 host는 자기 compiled 빈 표로 catalog를 만든다 | 되돌리면 `chat_explanatory`가 다시 레퍼런스에 묶인다. 인증서 wire 모양은 K11 그대로라 이미 저장된 catalog도 옛 Core가 읽고 같은 법칙으로 bind한다 |
| 변경 3 catalog 선택 키 `capability_routes`, `request_profile.domain` | build 441 JS `validateCatalog`의 선택 키 목록에 `capability_routes`가 없고, `validRequestProfile`은 `domain` 키를 거부한다 | 그 catalog를 쓰는 재시작 task는 fail-closed(`catalog_binding_invalid`). Swift 계약도 같은 키를 가지므로 JS와 Swift는 함께 되돌린다 |
| 변경 3 route kind `capability`, ledger basis `capability:<category>`, `check_outcome` screen 결과 | build 441 route-replay는 그 기록을 `unadmitted_delivery` FAIL로 센다(리뷰 실측, 2026-10-28) | 되돌린 뒤 route-replay 감사가 build 442 기록을 거짓 FAIL로 보고한다. 기록 자체와 전달된 답은 그대로다. 감사는 build 442 이후 기록을 빼고 읽는다 |
| 변경 3 local classifier 프롬프트 v3 receipt(`local_cls_v3`, 넷째 키 `domain`) | 옛 host는 v2로만 묻고, v2 decode는 키 셋을 정확히 보므로 v3 답을 받지 않는다 | 영향 없음(receipt는 사설 로그, cache key가 prompt version을 담는다) |
| 변경 3 능력표(`ModelCapabilityTable`, `Resources/model-capability-table.json`, `os1 capability show`) | 옛 build에는 없다 | 영향 없음. 깊은 작업은 정책 A 레퍼런스로 돌아간다 |
| 변경 3 추가 `capability_routes` schema 2(policy `capability_delta0_v2`, `choice`·`marker`·`broad`·`references`·`price_basis`, category `broad`) | 첫 442 커밋(aa41a78e·20d82d10)의 JS·Swift는 schema 1·policy v1만 받는다 | 그 catalog를 쓰는 재시작 task는 fail-closed(`catalog_binding_invalid`). JS와 Swift는 함께 되돌린다 |
| 변경 3 추가 ledger basis `capability:broad` | build 441 route-replay는 변경 3 기록 전체를 `unadmitted_delivery`로 센다(위 행), 첫 442 route-replay는 `capability:broad`를 모르는 basis로 센다 | 감사가 거짓 FAIL을 보고한다. 기록과 전달된 답은 그대로다 |
| 변경 3 추가 receipt `local_cls_v2_dom1`(`domain_outcome`, `domain_latency_ms`, `hint_count`) | cache key가 prompt version을 담아 옛 host는 이 receipt를 쓰지 않는다 | 영향 없음 |
| 변경 3 추가 `~/.os1/local-classifier/asr-hints.json` | 옛 build는 읽지 않는다 | 영향 없음(힌트는 domain 읽기에만 쓰인다) |
| 변경 3 추가 live-plan 적재기 runtime 읽기 상한 1 MiB | 옛 적재기는 512 KiB로 새 runtime(531 KB)을 읽지 못한다 | 짝이 아닌 조합은 bridge pin이 막는다(적재기와 runtime은 함께 되돌린다) |

### 항목별 세부 기록

각 항목을 구현할 때 남긴 기록이다. K 번호 순서로 정렬했다.

| 항목·구현 내용 | 검증·남은 것 | 커밋 |
|---|---|---|
| K1 `admitBoundedAutoPlan`을 법칙 아래에 둠 | 부분, D1 fixture 통과. I1의 재실행 예산 bind 조건은 넣지 않았다(위 K1/I1 정정) | `5576cf30` |
| K2 `executionPolicyChoice` 삭제, `_runTask` 우회 삭제, `_reResolve`·`_spreadAcrossPools` 법칙화, 옛 `execution_only` child → 레퍼런스 | 구현, D1 fixture 통과 | `5576cf30` |
| 부수: 행 선택에 `permission_profile === scope` 조건 추가, 미래 시각 telemetry를 dispatch 불가로 처리 | 구현 | `5576cf30` |
| K3 bounded Auto에서 local planner를 부르지 않음. `_observeAdaptivePlan`(RT:3975)의 `bounded` 조건(RT:3978)에서 `verifierRegistry.size === 0` 결합을 제거했다: 등록된 verifier가 더 이상 bounded Auto를 끄지 않는다. bounded disposition(RT:4019)은 `{plan_proposals_enabled: false, reason: 'no_admissible_check_or_shape'}`다. 오너 자신의 partition은 `hostPlan`이 만들고, 그 밖의 model 분해는 적용 가능한 `sound_full` 검사와 plan-shape 인증서(K11b)가 둘 다 있어야 받아들인다. 닫힌 catalog 키(`validateCatalog`)에 plan-shape kind가 없으므로 이 조건은 K11b 전까지 언제나 거짓이고, 그래서 `proposeLocalPlan` 0회·120 s 대기 없음이다. skip(RT:4039–4045)은 `adaptive_plan_skipped`와 `adaptive_routing{mode:'bounded_auto', state:'not_needed', reason:'no_admissible_check_or_shape', planner_invoked:false}`로 남는다. bounded policy, 120 s deadline, read_only projection scope, observe 시점 `admitBoundedAutoPlan`(이제 registry를 넘김, RT:4140)은 배선된 채 도달 불가(§8-3 wired, not adopted). 바인딩되는 행은 그대로다(같은 `resolveRoutePlan`·`selectRouteCandidate` 법칙, registry 인증 하강도 `hostPlan` 경로로 똑같이 bind). 보이는 변화: `plan_provenance` `host_checked_execution_plan_v1` → `host_exact_request`, decision 접두사 `bounded_plan;` → `resolver;`, `owner_explicit_parallel.local_proposal_admitted` 항상 false. 동결 본문과 다른 점(동결 기록 대상): skip 때 plan_proposal `not_needed` resource event(reason `no_admissible_check_or_shape`)를 기록한다. 없으면 owner 병렬 task가 `plan_model_calls: null`·`plan_model_calls_unobserved`로 회계 불완전이 된다. `createPlannerHostProjection` `check_ids` 채우기와 '둘 다 있음 → 1회 + `check_refs` 검증' Core fixture는 K11b로 미룬다(gate가 그때까지 상수 거짓이라 죽은 코드. `check_refs` 검증 자체는 `local-plan-proposal.test.mjs`가 이미 다룬다). 그래서 §5 K3 test 칸의 '둘 다 있음 → 1회'는 이번 계획 안에서 충족되지 않는다 | 구현, D1 fixture 통과(bounded-auto: verifier 0 → planner 0회·대기 없음·`not_needed` event 1개·`plan_model_calls` 0·`plan_model_calls_unobserved` 없음·no replay, 등록된 `sound_full` verifier만 있음 → 0회·`adaptive_routing.mode` bounded_auto·하강 `cheap` tier·ladder reference 고정, 분해 proposal은 직접 `admitBoundedAutoPlan`에서 `bounded_decomposition_not_admissible`. one-law App bounded options 0회. owner-explicit-parallel: owner topology planner 0회·`local_proposal_admitted` false·`plan_model_calls` 0, catalog 대기 중 cancel → cancelled·ticket 0·planner 0·replay 없음(이전 planner callback 중 cancel test는 planner가 안 불려 영원히 대기했으므로 교체). planner-deadline: harness를 shadow로 바꾸고 bounded 전용 deadline test 2개(40 s 정상, 120 s) 삭제, cap·cancel·quiesce·stale·quota·abort 무시는 shadow 20 s로, K3 zero-wait test 추가. 네 파일의 release 줄에 `--test-timeout` 추가). 남은 것: bounded 전용 Core 경로(120 s deadline, bounded projection scope, observe 시점 admission, RT `host_checked_execution_plan_v1` 의존 handoff)의 Core 수준 test는 K11b가 gate를 열 때 되살린다. `_runTask` `ownerPartitionEnabled`의 registry 결합과 `admitBoundedAutoPlan`의 ownerParallel 분기는 K5 몫 | `517a4a3f` |
| K4 verifier registry 건전성. 항목 형식 `{id, scope:'read_only', surfaces, soundness:'sound_full'\|'partial', applies, verify, refutations}`와 비동기 `registerNodeVerifiers`: 호출자 Map을 복사해 brand하고, `sound_full`은 등록 때 자기 반증 답과 Core nonce 답으로 probe해서 하나라도 통과하면 `verifier_registration_unsound`로 등록을 거부한다. probe는 fail-closed다: live verifier와 같은 60 s 안에 `{passed:false}`로 답하지 않으면(throw·timeout·malformed) `verifier_registration_probe_unanswered`로 거부. certifier는 probe와 같은 입력 모양만 받는다(`selected_config`·`native_receipt`는 null: 답과 지시만으로 판정하므로 행에 기대는 pass-all은 live에서도 통과할 수 없다. escalation 뒤 레퍼런스에 대한 신호 호출과 partial·legacy 신호는 지금처럼 행을 받는다). `applies`가 참인 `sound_full`만 인증하고 `certificate_id = verifier id`다(적용되지 않는 노드는 class 인증서나 레퍼런스로). 하강은 `ladder.certificate_id`가 가리키는 verifier가 그 `attempt_id`에 pass한 기록이 있을 때만 전달된다(`certifiedAnswer` verdict). 채택 시점에 certifier가 없으면 출력을 버리고 레퍼런스로 1회 다시 돈다(레퍼런스가 없으면 hold). legacy family 함수와 `partial`은 실패 신호로만 쓴다. 부수(D5): handback·repair_source가 pending 하강의 수락 검사를 건너뛰지 못한다(현재 결과 검증상 도달할 수 없는 방어선). 수락 전 하강의 출력은 publicSnapshot `output_summary`·event에 나오지 않는다. production은 등록 없음(= 오늘) | 구현, D1 fixture 통과(`openclaw-rcc-verifier-registry.test.mjs` T1–T8. 기존 node fixture 5개와 Swift real-Node fixture 2곳을 등록된 sound 항목으로 이전. T8 행 기반 verdict는 인증 못 함, T1 probe 무응답·config 역참조 pass-all 등록 거부. tier-routing·runtime fixture를 `--test-timeout`과 함께 release 목록에 추가). certifier 부재는 K9에서 `certifier_unavailable`로 해소(failure index에 세지 않음). 남은 것: partial·legacy 신호 pass는 `verifier_outcome` `pass`로 남아 `stats`에 세인다(라벨은 K9 `check_label`만) | `4a63fa08` |
| K5 오너 명시 병렬을 `boundedAutoEligible`에서 분리. 새 술어 `ownerExplicitParallelEligible`(RT:1430): auto, objective===request, admission facts 존재(`SCOPES.has(catalog.owner_scope)`), host scope read-only, `!ownerCollectionFor`, policy binding. bounded 플래그·adaptive mode·`task_contract`·`class_certificates`·verifier registry·`require_native_ceiling`과 무관하다. `_runTask`의 `ownerPartitionEnabled = this.hostAutoPlan`(RT:4404). partition이 도출됐는데 `task_contract`가 있으면 planner 호출·plan 기록 전에 typed hold `owner_partition_contract_conflict`(RT:4408). 같은 배타성을 `assertOwnerExplicitParallelPlan`(RT:1458)에서도 강제하므로 dispatch 전 catalog refresh가 contract를 얻으면 `_ticket`에서 같은 이유로 hold되고, `_settleTask`도 이 typed 이유를 `owner_collection_output_invalid`로 바꾸지 않는다. partition의 plan·decisions·routes·`owner_explicit_parallel`은 원래부터 한 `plan_admitted` `_update`로 기록된다(변경 없음). `_readPoolEligible(candidate, task, state)`(RT:4795)는 판단 대상 plan을 인자로 받는다(기본은 persisted. 모든 호출자가 `plan_admitted` 뒤라 동작 변화 없음). 동결 행과 다른 점(동결 기록 대상): (1) §2.3-6의 K5 몫도 했다. `_observeAdaptivePlan`의 owner-collection 옆에 partition early return(RT:3990)을 두어 bounded·shadow·covered_live 모두 planner를 부르지 않고, plan_proposal `not_needed` resource event(reason `owner_explicit_parallel_partition`)를 남겨 `plan_model_calls` 0이다(K3의 `no_admissible_check_or_shape` skip·`adaptive_routing` 기록은 partition task에 생기지 않음, D1). partition에는 bounded/live 수락 proposal을 보지 않는다. `admitBoundedAutoPlan`의 ownerParallel 분기를 지우고 partition 가능한 task에 대한 proposal은 `bounded_owner_partition_not_planner_owned`로 거부한다. (2) admission facts 존재 조건을 유지했다(없으면 옛 catalog도 partition될 수 있음). (3) contract + 명시 A/B는 오늘 contract 인증 1 node로 돌던 것이 hold로 바뀐다(오너가 둘 중 하나를 지워야 함). 그 밖의 행동 변화: bounded=false·shadow·covered_live·class cert·native ceiling·verifier registry에서도 partition된다. class cert는 unit을 인증하지 않으므로(unit은 원 요청이 아님) unit은 레퍼런스, ceiling이면 unit마다 `owner_words` ceiling, 등록된 `sound_full` verifier가 적용되면 unit마다 인증 하강 + 고정 레퍼런스 escalation이다. 재시작: 업그레이드 전 proposal 도중이던 partition task는 정지·재시작 hold(`owner_stopped_before_dispatch`·`restart_before_dispatch`)라 재생·재계획되지 않는다 | 구현, D1 fixture 통과(owner-explicit-parallel 23개: planner 0·`not_needed` event 1개·`adaptive_routing` 없음, bounded off·shadow·App bounded options(`complete` 0회·`execution_only` 0) 모두 2 ticket, 재개된 Codex 대화 + 새 A/B → fresh 2 ticket·resume null·peak 2, Claude only → peak 1·topology 유지, mixed provider → 둘째 unit `spread_for_parallelism;other_pool;route_reference`, class cert → unit 레퍼런스 `admitted_reference_uncertified`, native ceiling → `explicit`·`admitted_reference_owner_words`·ultra, full contract → hold·ticket 0·planner 0·plan 없음·no replay, refresh가 cert를 얻음 → 2 ticket 완료, refresh가 contract를 얻음 → `_ticket` hold·ticket 0, 등록된 `sound_full` verifier → unit마다 `tier`·`certificate_id`·reference 고정, cheap 오답 → unit마다 1회 escalation·4 ticket·미검사 답 전달 없음, `_readPoolEligible` prospective plan, 재시작 hold. hostPlan 단위 검사(cert·ceiling·contract에서도 2 node, contract는 assert에서 conflict, flag 없음·admission facts 없음 → 1 node), 위조 graph 검사는 `resolveRoutePlan(hostPlan(...))`로 옮기고 `admitBoundedAutoPlan` 거부 추가. one-law: App bounded options + A/B → planner 0·법칙 bind). 남은 것: native 왕복과 실제 overlap은 D3 IG-01, 품질·쿼터는 D4 | `517a4a3f` |
| K6 App의 새 제출마다 `--max-native-dispatches 16`을 생성 시점에 고정해 `os1 run` argv로 전달(`RCCRunBudgetOptions.appNativeDispatches`, `PendingSubmission.maxNativeDispatches`). 이전 빌드가 저장한 제출은 retry·재시작에서도 cap 없음(nil)을 유지한다: budget은 Core 제출 fingerprint의 일부라서 같은 task ID에 cap을 더하면 idempotency_conflict로 그 결과가 고아가 된다. cap 도달은 typed hold(`native_dispatch_budget_exhausted`)이고 더 싼 전달이 아니다. 직접 CLI 실행에서 플래그가 없으면 여전히 legacy nil. 부수(RT settle): held 정산은 검증이 받아들이지 않은 certified descent 출력을 partial에 넣지 않고, owner collection의 control unknown은 어느 자식이 먼저 hold되었든 task 전체를 결과 없이 hold한다 (이전에는 앞선 형제가 다른 이유로 먼저 hold되면 뒤쪽 control-unknown descent의 미수락 출력이 returned_unverified로 전달됐다) | 구현, D1 fixture 통과(cap 4 → 5번째 hold·refund/refill 없음, 8 obligation에서 cap 16·null → 8 node, 15 → 1 node, 앞선 pre-dispatch hold + 뒤쪽 control-unknown descent → held·result null, App self-test: 새 제출 16 고정, 이전 빌드 항목은 같은 ID로 cap 없이 retry). D3 IG-00 typed cap 실측은 NOT_RUN. 참고: 16 = 2×8은 Core의 plan 시점 적격 조건(ownerCollectionPlanEligible의 cap ≥ 2×obligation, _calibratedContext의 여유 ≥ 2)과만 일치한다. descent bind 시점에 cap 여유를 읽는 조건은 없으므로 I1의 노드당 재실행 여유는 보장되지 않는다: cap은 무과금 ladder descent와 무료 사전 실행 거부까지 모든 native dispatch를 세므로, 뒤쪽 노드의 descent가 여유 2 미만으로 bind된 뒤 `native_dispatch_budget_exhausted`로 hold될 수 있다(fail-closed). bind 시점 여유 조건은 K1/I1의 미해결 항목. handback·repair_source가 pending descent의 수락 검사를 건너뛰는 I2 구멍은 K4(D5) 몫 | `44702ec7` |
| K7 zero-model 닫힌 산술(os1-closed-arithmetic-v1). `exactArithmeticQuestion`을 토큰화·재귀 하강 파서·정확 BigInt 유리수 계산으로 바꿨다: 여러 연산자(표준 우선순위, 왼쪽 결합), 괄호(깊이 ≤4), 소수 피연산자(정수·소수 각 1–15자리), 나눗셈, 연산자 단어(더하기 플러스 빼기 마이너스 곱하기 나누기, plus minus times 'multiplied by' 'divided by'; 영어 단어는 앞뒤 공백 필요). 수 단어·그 밖의 글자·`,` `^` `%` `x` U+2212·암묵 곱셈은 받지 않는다. 답은 유한 소수만(분모 2^a·5^b), 반올림 없음, 출력 40자리·입력 160자·토큰 64·피연산자 16·중간값 256자리 상한, 0으로 나눔·무한 소수는 abstain. `KOREAN_ARITHMETIC_SUFFIX`·`ENGLISH_ARITHMETIC_PREFIX`는 바이트 그대로. `_runTask`의 zero-model 자리는 `zeroModelArithmetic(request) = pureArithmetic ?? exactArithmeticQuestion`(export)을 부른다. `withoutConversation(task, {bareEnvelopeIsFirstTurn})`: 이 옵션은 두 zero-model 자리(산술·check-in, local_response check-in)에서만 켜지고, 그때만 `priorMessageCount` 키가 없는 v3 envelope을 첫 턴으로 본다. 단 transcript `''`, source 없음, taskContext·memoryPaging 없음일 때만이다(null context와 같은 정보). `livePlannerContext`·`_calibratedContext`·K9 turn stratum은 그대로 엄격하다. 공용 벡터 `scripts/fixtures/rcc-arithmetic-vectors.json`(163개, limits 블록 = `CLOSED_ARITHMETIC_LIMITS`). Swift: `RCCExactArithmeticOutput.isCanonical`(OS1Context)을 `rccDeterministicArithmeticNotice`가 쓴다(소수 답에도 '모델 호출 없음' 알림). 동결 행과 다른 점(동결 기록 대상): (1) (a)는 좁은 형태만이다. taskContext나 memoryPaging이 있는데 키가 없는 넓은 형태는 '모르는 이력은 모델에게' fixture 셋을 뒤집으므로 채택하지 않았다(GUI는 항상 키를 보내므로 GUI 경로 효과는 없다, CLI·스크립트 context 파일용). (2) `pureArithmetic`은 바꾸지 않았다: explicit-route `certified:exact` 계열이고 plugin verifier `arithmeticResult`·Swift answer-only envelope과 짝이다. (3) 모호성 gate: 괄호가 없고 모든 이항 연산자가 ASCII `-`나 `/`이면 날짜·전화번호·가게 이름·범위·점수·분수일 수 있다('2024-10-24', '010-1234-5678', '7-11', '10/25', '5-3은?'). 말이 값을 물을 때만 산술로 읽는다: '='('10-3-2='→5), 또는 수량 술어(얼마·몇·how much is) 아래 그런 연산자 하나뿐('5-3은 얼마야?'→2, '6/3은 얼마야?'→2). 맨식(BARE), 약한 꼴(WEAK: 끝 기호 제거, 조사+'?'), '무엇' 술어(뭐야 계열, what is·what's)는 abstain한다('2024-10-24는 뭐야?', 'what is 7-11?', '6/3은 뭐야?', '2024-10-24는 얼마야?'). WEAK가 `-`로 시작해도 abstain('-3+5는?'). 앞자리가 0인 수('010', '007')는 번호·코드이므로 모든 꼴에서 abstain('007+1='도). 끝 기호 줄 안의 '…'·'‥'는 호환 문자 검사에서 빼고 구두점으로 본다('1+1이 뭐야…'→2, HEAD와 같음). 맨식 한 연산자는 옛 `pureArithmetic` 읽기 그대로('5-3'→2; 앞자리 0인 '010-1234'→-1224도 HEAD 그대로). scout spec과 다른 점: spec은 STRONG 전체에서 gate를 풀었으나('6/3은 뭐야?'→2), 리뷰에서 '뭐야'·'what is' 꼴이 날짜·전화번호를 0-model 산술로 답하는 것(HEAD는 모델로 보냄)이 확인되어 수량 술어로 좁혔다. (4) 소수 피연산자는 동결 행에 없던 추가다. 남은 위험: 첫 턴 '10/25는 얼마야?'를 날짜로, '1 더하기 1은?'을 귀요미 밈으로 뜻한 경우(벡터에 기록). 더 엄격히 하려면 ASCII `-`·`/`에 '='를 요구하면 된다 | 구현, D1 fixture 통과(새 `openclaw-rcc-exact-arithmetic.test.mjs` 7개, release 목록: 벡터 전부 = `zeroModelArithmetic`, 수락 벡터마다 Core 종단 local-core·model none·event·catalog/plan/execute 0회, abstain 벡터마다 catalog 1회·held, R1 불변(context·세션·첨부·provider·explicit route), explicit-route exact 계열 불변(`admittedRoute`·`arithmeticResult`), bare envelope 4형태 완료·12형태 held, 정확 유리수, replay 판정·텍스트 미출력. `openclaw-rcc-runtime.test.mjs`에서 '1.5+1은?'·'1+1+1은?'을 WRAPPED로 옮김. `openclaw-rcc-live-plan-adoption.test.mjs`에 bare envelope → `live_capability_or_source_unavailable`, priorMessageCount 0 대조 → 통과. OS1ContextTests `RCCExactArithmeticVectorsFixture`(`--rcc-exact-arithmetic-only`): canonical 술어, legacy closed-task 검사기와 값 일치, Node `zeroModelArithmetic` 교차 실행. main.swift self-test: 2.5·0.125·-0.25 알림. wiring 검사 1개). 오프라인 `scripts/arithmetic-replay.mjs`(번들 안 됨, release 아님, exit 0/1/2/64): scratch DB 사본(126 task, Auto 113) 읽기 전용 replay PASS(모호성 gate를 좁힌 뒤 다시 돌려도 같은 값): 수락 16, 기존 local-core 14 모두 출력 동일, 모델 답 1은 정확 값과 같음(→ zero-model로 바뀜 1), 1은 숫자로 읽히지 않음(비교 안 함). 새 Core gate로 다시 넣은 결과 2건은 routed: 둘 다 `priorMessageCount` 키 없이 taskContext·memoryPaging이 있는 옛 GUI envelope (1건은 예전 빌드에서 local-core였다. 이는 K7 이전의 첫 턴 규칙 변경이고 좁은 (a)는 이를 유지한다) | `9b0b4f2e` |
| K8 bind 시점 catalog를 첫 dispatch에 재사용(술어 한정형). `_runTask`(RT:4689)가 `plan_admitted` 스냅숏의 `_readyWaveBinding`을 토큰으로 `_scheduleDAG(taskID, bindReuse)`(RT:5339)에 넘기고, 첫 ready 루프(`bindWave`, RT:5423)의 첫 dispatch만 그 토큰을 쓴다(`bound`, RT:5470). 재사용 조건 `_bindCatalogReusable`(RT:4940): `hostAutoPlan`(host가 만든 plan), bind 뒤 planner 호출 없음(`adaptive_routing.planner_invoked !== true`), agent 노드 하나뿐인 plan, `owner_collection`·`catalog.task_contract`·calibrated `pending_dispatch` 없음, 자식이 queued·attempts 0·이력 없음·repair·continuation·stage·re-resolution·spread 없음, 바인딩이 `plan_admitted` 그대로, 그 행이 지금(`Date.now()`) `dispatchable`. 그 밖의 모든 dispatch(두 노드 이상, 재시도, repair, re-resolution, spread, restart, 주입 plan callback)는 지금처럼 refresh한다. `admissionCurrent`·`_recheckCalibratedRoute`·`_candidate`는 재사용 경로에서도 그대로 실행된다. 행 bind·채택·전달은 바뀌지 않는다(`delivery_policy_valid` 무관). 동결 행과 다른 점(동결 기록 대상): (1) 문자 그대로의 '모든 첫 dispatch 재사용'은 calibrated 재검사를 공회전시키고(bind catalog를 자기 자신과 비교) owner_collection 철회 검사와 task_contract 재관측을 건너뛰므로 채택하지 않았다(scout 시뮬레이션 25 fixture 실패). (2) scout 술어에 `hostAutoPlan` 조건을 더했다: 주입 plan callback은 bind와 dispatch 사이에 시간 제한이 없으므로, 'bind→dispatch 창은 in-process 계획 시간뿐'을 추론이 아니라 구성으로 성립시킨다(production은 `hostAutoPlan: true`라 절약은 같다). 그래서 scout가 제시한 기존 fixture 수정 7곳(count 이동 2, opt-out hook 5)은 필요 없었다. (3) 절약은 task당 동시 catalog build 한 번이다(fee3a4f5 이후 probe가 동시 실행이라 '[이전측정] 약 6 s'는 낡은 값, 재측정 안 함). 남은 위험: bind→첫 dispatch 사이(ms)의 호스트 상태 변화(로그아웃, 계정 전환, quota 0)는 Core refresh 대신 native adapter의 dispatch 직전 fresh 재관측이 typed 거부로 잡는다(inventory·read-only quota 거부는 무과금 re-resolve, auth·계정·writer quota 거부는 hold). 첫 시도의 ledger quota 관측은 bind 시점 관측이다(K16 해석 주의). 새 fixture `openclaw-rcc-bind-catalog-reuse.test.mjs`(9 test, release-gated): catalog 1회·refresh 0·이벤트 없음, 만료 시 refresh, 술어 제외 16+3가지, 주입 plan·task contract·두 노드는 refresh(dispatch 재관측에서 이 요청을 더 묶지 않는 contract → ticket 0·`catalog_binding_invalid` hold, 철회된 contract → 첫 dispatch가 재관측 catalog로 실행), cancel이 admissionCurrent에서 막힘, native 무과금 거부 뒤 다른 pool 레퍼런스로 re-resolve, stop/restart 뒤 재사용 없음. 술어 조항 5개를 각각 지운 변이 모두 fixture가 잡음. `openclaw-rcc-owner-collection.test.mjs`(철회 → catalog 2회)·`openclaw-rcc-calibrated-admission.test.mjs`(calibrated dispatch → catalog 2회, 증거 철회 → 2회 이상)에 catalog 횟수 단언. wiring 검사 1개 추가 | 구현, D1 fixture 통과 | `9b0b4f2e` |
| K9 routing ledger의 전달 근거. 이 빌드가 dispatch 때 고정한 route는 `delivery_basis`(`certified:contract`·`exact`·`verifier:<id>`·`class:<id>`, `reference`, `reference_escalated`, `owner_words`. 그 밖은 `unbound`·`unclassified`·`certified:unrecorded`), `check_id`(`exact_arithmetic_v1`, `contract:<contract_sha256>`, `verifier:<certificate_id>`, `class:<id>:<format_check>`. 답·지시·요청 텍스트는 넣지 않음), `check_outcome`(수락 출처가 그 `attempt_id`에 내린 판정 `pass`·`fail`·`not_returned`·`certifier_unavailable`, 없으면 `not_run`), top-level `check_label`(§4.3: exact·contract·`sound_full` verifier의 `pass`·`fail`·`not_returned`만. class format check·레퍼런스·owner_words는 null), `stratum`(`request_class`, `turn`, `has_materials`, `context_bytes`: 크기만)을 기록한다. 판정은 `attempt_history[].check_outcome`에 남아서 재시작 reconcile도 같은 값을 쓴다. certifier가 채택 시점에 없으면 `check_outcome`과 `verifier_outcome`이 `certifier_unavailable`이 되어 never-rotated failure index에 세지 않는다(K4 남은 것 해소). `verifier_outcome`의 나머지 의미, reduced `ladder`, `stats`, `_outcomeSummary`는 그대로. 오프라인 감사 `scripts/route-replay.mjs delivery --ledger <path>… [--snapshots <checkpointed sqlite copy>] [--include-legacy] [--out <new file>]`: ledger만 주면 출력이 오너에게 가지 않았음이 증명되는 상태 whitelist로 fail-closed 판정, `--snapshots`를 주면 결과가 있는 task(completed·returned_unverified, 그리고 partial 결과를 가진 held·failed·cancelled)에 출력이 있는 child가 전달 모집단이다. 입력은 읽기만 하고(snapshot은 immutable·read-only, 옆에 -wal·-shm이 있으면 거부) exit 0 PASS, 1 FAIL, 2 NO_EVIDENCE·INCOMPLETE, 64 사용·입력 오류. K16 `usage`가 같은 CLI에 붙는다. 동결 본문과 다른 점(동결 기록 대상): 라벨 위치는 `_outcomeSummary`가 아니라 top-level `check_label`(그 요약은 adaptive가 꺼지면 null이고 8 KB 초과 때 지워짐), `zero_model:*` 근거는 ledger에 쓰지 않음(zero-model task에는 attempt가 없다. 감사는 snapshot에서 `zero_model:deterministic_no_model`로 셈), `stratum`·`certifier_unavailable` 추가 | 구현, D1 fixture 통과(`openclaw-rcc-route-replay.test.mjs` 13개: 근거 함수, 합성 위반 → FAIL, 세탁·라벨 과장 → FAIL, fail-closed 상태, legacy → NO_EVIDENCE, torn·충돌 → INCOMPLETE, CLI exit code·`--out` O_EXCL·snapshot 전달 모집단, held·failed·cancelled partial 결과의 기록 누락 → INCOMPLETE·미검사 certified → FAIL, certifier 부재, 재시작(미정산 attempt, 정산된 contract 하강 `pass`·라벨, certifier 부재 `certifier_unavailable`과 빈 failure index), 닫힌 store 종단. admission fixture에서 exact·contract·class·verifier·owner words ledger 단언, 감사 PASS와 위조 unchecked 사본 FAIL. release 목록에 추가). 라이브 ledger 읽기 전용 replay: 125건 모두 K9 이전 기록이라 NO_EVIDENCE, legacy 하위 튜플 전달 중 검사 증명 불가 67건(그중 exact 수락 추정 36건, 추정일 뿐) | `4a63fa08` |
| K10 F 안의 비용 선택(동결 정책, 기본 inert). `joint-route-selector.mjs`에 순수 함수 `prepareCertifiedDescentPolicy`·`isPreparedCertifiedDescentPolicy`·`selectCertifiedDescent`와 `CHECK_ACCEPTANCE_SCORE_SPACE = 'check_acceptance_probability_v1'`을 더했다. `SCORE_SPACE`, `RESOURCE_COMPONENTS`, `estimateTotalResources`, `selectJointRoute`는 바이트 그대로이고 import는 node:crypto뿐이다. 정책 v1: 정확한 키, `label_score_space` `check_acceptance_v1`(K9 label), `resource_unit` `observed_token_estimate_v1`, 유효 구간 `[valid_from_ms, valid_until_ms)`, 문맥 구간 상한 1–16개(엄격 오름차순, 상한 포함), 행 1–2048개. 행 = 층(request_class·scope·admitted_by `contract`\|`verifier`·check_id·turn·has_materials·context_bucket) × 튜플(surface·quota_pool·model·effort). role `reference`(p_lower null, 검사 비용 0) 또는 `descent`(p_lower ∈ [0,1], `verification_tokens_per_sample` = c_check). `retry_reserve_tokens`는 항상 0(선택기가 계산). `policy_sha256` = 그 키를 뺀 본문 digest. 한 번 준비해 module-private WeakMap으로 brand한다(복사본·손으로 만든 값·준비 뒤 원본 변경은 순위를 매기지 못함). 선택: c_ref = 레퍼런스 행 합, descent 총합 = 행 합 + (1−p_lower)·c_ref, 최소 총합, 동률이면 레퍼런스, 그다음 입력 순서. F의 모든 원소(레퍼런스와 모든 descent)가 그 층에 자기 role 행을 가져야 활성이고, 아니면 inactive다(덮이지 않은 행을 0으로 보거나 빼지 않음). 결과는 항상 입력 id다. RT `tierRouteCandidate` certified 분기: source가 `contract`·`verifier`이고 escalation target이 있고 hit이 레퍼런스가 아닐 때만 부른다. F = bind 때 고정한 target + R11 pool `certifiedEntries`의 모든 entry에서 dispatch 가능·비회피 행(레퍼런스 id 제외, TIER_ROUTES·`best` 순서). descent → 그 행, `tier_list_<그 entry>`, 내부 ladder에만 `descent_policy_sha256`(wire ladder는 4필드 그대로), reason에는 admission 토큰 바로 뒤에 `descent_cost_policy_<12hex>`(K14가 뒤쪽 진단 segment부터 자르므로 앞에 둠). 레퍼런스 → `certified_descent_not_cost_effective;descent_cost_policy_<12hex>`와 함께 정책이 비용을 매긴 바로 그 레퍼런스(bind 때 고정한 escalation target)를 묶는다. R11 레퍼런스 serve로 넘기지 않는다: 그 serve는 F 밖·비용 미산정인 다른 pool의 레퍼런스를 고를 수 있다. 정책이 pool의 다른 모델을 묶으면 reason의 점수 토큰은 `pool_scored_by_bound_model`이 아니라 `pool_scored_by_tier_hit_model`이다(pool은 TIER_ROUTES hit 모델의 점수로 순위가 매겨졌다. hit 모델에 점수가 없거나 target이 다른 pool이면 점수 토큰 없음). inactive·null → 오늘과 바이트 동일(토큰 없음). 층은 K9 ledger stratum과 같은 사실이다: request_class, turn = strict `withoutConversation`, has_materials, instruction + task context + host context의 UTF-8 바이트. 여기에 admission(check_id = verifier id, contract는 null)을 더한다. 정책은 `resolveRoutePlan`·`admitBoundedAutoPlan`·`livePlannerContext`·`admitLivePlannerPlan`·`createRCCRuntime({certifiedDescentPolicy})`로 전달된다(plain object가 아니면 `certified_descent_policy_invalid`, 생성 때 한 번만 준비). Core 호출 지점: `_recheckCalibratedRoute`, observe·bind 시점 admission, bind `resolveRoutePlan`, `_reResolve`, `_spreadAcrossPools`(referenceOnly 호출은 해당 없음). ledger는 정책이 고른 descent와 그 escalation 기록에만 `descent_policy_sha256`을 남긴다. plugin은 정책을 넘기지 않으므로 production은 inert다. 동결 본문과 다른 점(동결 기록 대상): `selectJointRoute`가 아니라 같은 파일의 sibling 함수다(그 계약은 reference_match용 host evidence·receipt·관측 hash가 필요해 Core가 증거를 만들어야 함). `estimateTotalResources`는 task 단위 binding이라 재사용하지 않고 component를 직접 합한다. `_calibratedChoice`는 그대로 두고 호출을 옮기지 않고 추가했다. `exact`(오너가 이름 붙인 route의 최저 tier)·`class`(check-acceptance label 없음) source는 제외한다. F를 일부만 덮는 정책은 inactive다. hash 불일치 = 자기 본문 digest(harness binding 없음). 행 상한은 4096이 아니라 2048이다(stableJSON 100,000-node bound 안에서 hash 가능해야 함). 정책 생산자는 없다(offline-route-calibration은 reference_match·Hoeffding). 비용 단위는 token이지 quota가 아니고, pool 선택은 여전히 TIER_ROUTES hit 모델의 quota score로 R11이 한다. (1−p)·c_ref 항은 escalation이 실행 가능하다고 가정하지만 bind 시점 cap 여유 조건은 여전히 없다(K6 행 참고) | 구현, inert(정책 미등록). D1 fixture 통과(descent-policy 16: 무효 정책 이유별 inactive·2048/2049 경계·brand 복사 무효·준비 뒤 변경 무영향, 비용 식·동률 레퍼런스·descent 간 입력 순서, F 미포함 role·층·구간·창 경계 inactive, null·undefined·hash 불일치·만료·미발효·일부만 덮음·준비 안 된 raw 정책 = 오늘과 deepEqual(codex·claude·chat lane), sol/low 선택·reason·내부 ladder hash·wire ladder 4필드, 오늘 행 확인도 토큰 기록, 레퍼런스 선택, F 밖 행(dispatch 불가·다른 pool·frontier 비레퍼런스) 불선택, 레퍼런스 결정은 R11 레퍼런스 serve가 다른 pool을 고를 때도 비용 매긴 target을 묶음(target이 다른 pool일 때 포함), 다른 모델을 묶으면 `pool_scored_by_tier_hit_model`·점수 없는 hit은 토큰 없음, bounded Auto(`admitBoundedAutoPlan`)가 resolver와 같은 정책 선택, 다노드 구간별 선택, 후속 턴 층, contract 적용·exact·class·owner words(intent·provider) 무시, durable: 첫 ticket·escalation 1회·레퍼런스 1 ticket·ledger hash·잘못된 타입 거부·나쁜 hash = 정책 없음·재해석이 새 pool F 안에서·회피 행 제외). 기존 joint-selector 117·tier-routing 46·admission·bounded-auto·calibrated-admission·live-plan-adoption 그대로 통과 | `48e240a5` |
| K11 class 인증서의 D4 측정 artifact gate (Swift만, catalog wire·JS 무변경). 새 `RCCClassMeasurement`(OS1Context): 서명된 class 표의 인증서는 `measurement_sha256`이 가리키는 측정 artifact(`os1_rcc_class_measurement_v1`)가 host custody에 있고 그 hash와 같으며, strict 모양(모든 층 정확한 키, 중복 키 거부, bool·소수를 정수로 받지 않음), 인증서 범위(id·request_class·tuple·format_check), 그 pool의 현재 레퍼런스(catalog 순서상 첫 frontier 모델의 native ceiling, 그 행이 있을 때만. `reference_unavailable`이면 없음), executor contract, harness profile(artifact 키 `harness_scope` = `HarnessProfile`의 `id@version`, 지금 `H0@1`. K15 pre-dispatch receipt의 `harness_scope`와 같은 문자열 한 인코딩이라 D4 생산자가 receipt에서 그대로 복사한다. receipt의 `harness_profile` 키는 id만이고 artifact에는 그 키가 없다), 유효 구간(`issued_at_ms ≤ now < valid_until_ms`), PASS 결과(n ≥ 60, accepted_b 0, hard-check 회귀 0, 0 ≤ tier 불일치 ≤ 레퍼런스 A/A 불일치 ≤ n, evidence가 hash)를 모두 통과할 때만 `admissionFacts`가 싣는다. 레퍼런스는 `build`에서 한 번 계산해 넘긴다(인자 없는 직접 호출은 인증서를 받지 못한다). 실패는 인증서만 떨어뜨린다(첫 실패 이유 하나, wire 밖 진단 `classCertificateRejection`). owner scope·class·chat·contract·pin은 그대로다. `rccNativeCatalog`: `input.harnessProfile = RCCClassMeasurement.harnessScope(HarnessProfile.current)`, 표의 인증서마다 `~/.os1/rcc-runtime/class-measurements/<sha256>.json`을 `rccPrivateInput`으로 읽고(배포 표가 비어 있어 읽기 0회), 미적재 이유는 stderr receipt 한 줄(내용 없음). 배포 표가 비어 있으므로 동작 변화 없음. 동결 본문과 다른 점(동결 기록 대상): JS `validClassCertificates`는 고치지 않는다(Core는 host custody를 볼 수 없고 catalog는 host만 만들며 bind 시점 admission은 고정이다. 그래서 bridge pin 변경 없음). 만료는 catalog 생성 시점에만 확인한다. harness는 lead 결정 D6의 `id`만이 아니라 `id@version`으로 묶는다(새 descriptor가 옛 측정을 물려받지 않음). 그래서 artifact 키 이름을 `harness_scope`로 하고 receipt에도 같은 키를 더했다(D6 보정). 실제 인증서 적재는 D4 arm ③과 별도 표 재서명이 필요하다 | 구현, fixture 통과(RCCAdmissionFactsFixture K11-a..l 포함 117 checks: 유효 적재와 wire 동일, 배포 표 inert 바이트 동일, artifact 없음·hash 불일치·만료·발효 전·범위·레퍼런스·executor·harness·결과·모양 불일치(receipt의 id 키 `harness_profile`로 쓴 artifact 포함) → 미적재, 직접 호출 fail-closed, custody 경로. OS1ContextTests 전체, os1 self-test, wiring 307) | `f91f0b2d` |
| K12 partial result v2 (RT-08). K12a: CT `Request.resultContractVersion`(`result_contract_version`, 없으면 1, 1·2만)과 `requestShape`, JS `validateTask` 선택 키(Swift `rcc-intent`·`rcc-catalog`도 같은 shape로 decode). CT `Result.partial{coverage{completed_node_ids, unresolved_node_ids}, parent{task_id, request_sha256, revision}, nodes[{node_id, attempt_id, output_sha256, native_receipt_sha256}]}`와 `partialShape`(모든 경계에서 미지 키 거부). `validate(Snapshot)`: result는 completed·returned_unverified·install handoff, 또는 failed·held·cancelled 위의 v2 partial일 때만. partial이 있으면 returned_unverified·failed·held·cancelled만, handoff 없음, task_verified 아님, parity unverified, quality execution_only·unverified, parent가 이 task·request와 같고 `0 < revision ≤ snapshot.revision`, coverage가 모든 child를 정확히 한 번(완료 id = completed·succeeded child, 미해결 id = 그 밖, 미해결 ≥ 1), 완료 node는 모두 nodes에 있고 node마다 child의 현재 attempt_id와 hash. RT `publicResult`가 같은 gate를 wire에 적용한다(`PARTIAL_RESULT_STATES`). `_partialResult(taskID, returned, snapshot)`는 원래 task의 version이 2일 때만 `partialContract`를 붙이고, `boundPartialResult`가 붙이는 `_update` 안에서 node마다 attempt·output digest와 coverage를 CAS로 다시 확인한 뒤 `parent.revision`을 그 update의 revision으로 고정한다(경합이면 결과 전체를 버리고 원래 실패·hold 이유 유지: held 경로는 returned_unverified 대신 held). K12b: App의 새 제출마다 `PendingSubmission.resultContractVersion = 2`(`RCCRunBudgetOptions.appResultContractVersion`)를 생성 시점에 고정하고 `os1 run --result-contract-version 2`로 보낸다. 이전 빌드가 저장한 제출은 retry·재시작에서도 없음(v1)을 유지한다(version은 Core 제출 fingerprint의 일부, K6와 같은 이유). 직접 CLI 실행에서 플래그가 없으면 v1. `runOpenClawRCCTask`는 terminal snapshot에 `RCCRuntimeContract.negotiated`(v2를 요청하지 않은 실행에 typed partial이 오면 `rcc_runtime_snapshot_invalid`). 부분 결과 라벨 `PartialCoverage.label()`(완료 X/Y·미해결 id 최대 8개, 품질 주장 없음)을 CLI 출력 앞, task graph root `resultSummary`(id 최대 3개), App에서 답 바로 다음 system 메시지로 보여준다. 동결 행과 다른 점(동결 기록 대상): (1) 'v1 클라이언트는 지금 형태 유지'는 불가능했다: v1 failed task는 지금 result를 실어 보냈고(RT `_scheduleDAG` failed 분기) v1 Swift validator가 그것을 거부해 MS terminal decode가 throw했다(RT-08 결함). 이제 v1 failed task는 wire에서 결과 없는 typed failure이고, partial은 durable 기록(inspector)에 남는다. 옛 build가 저장한 failed+result 행도 wire에서 숨긴다. held-with-retained-output v1 결과(returned_unverified)는 바이트 그대로. (2) 유일한 held partial 생산자는 `_hold`라 상태가 returned_unverified이므로 v2 partial을 returned_unverified에도 허용한다(상태 기계 불변). held·cancelled 위 partial은 계약상 허용, 생산자는 없음(cancel은 동기, aggregate receipt는 비동기 파일 쓰기). (3) Core는 child native receipt digest를 기록하지 않으므로(`native_receipt_hash_status: not_exposed_by_core_record`) `native_receipt_sha256`은 null(추측 금지). (4) `_update`가 terminal 뒤 no-op에도 revision을 올리므로 parent.revision은 `≤`로 검사한다. (5) 보존된 출력이 있는 held child는 nodes와 unresolved 양쪽에 있다(출력은 v1과 같고 '해결됨'으로 표시하지 않음). (6) Gateway client 변경 없음, 실제 관문은 Swift `requestShape`. (7) K9 `route-replay delivery --snapshots`는 durable 결과를 읽으므로 v1 failed task의 durable partial을 전달로 센다(실제 wire 전달보다 엄격한 쪽, 변경 안 함). (8) 롤백: 옛 build는 v2 task를 `task_shape_invalid`로 거부한다(번들 SHA pin이라 허용). 첫 v2 제출부터 새 fingerprint 시대. (9) 완료된 deterministic node(host가 계산한 local exact 행, K7)는 attempt가 없으므로 그 node 항목만 `attempt_id` null이다(JS `partialContract`와 Swift validate: attempt 없음·완료·local exact 행·local worker 모델 아님일 때만). 계약이 type할 수 없는 partial은 v1 결과로 돌아간다: `partial_contract_invalid`가 실패·hold 이유를 대신하거나 답을 버리는 일은 없다. | 구현, D1 fixture 통과(새 `openclaw-rcc-partial-contract.test.mjs` 10개, release 목록: version 협상(0·3·-1·1.5·'2'·true 등 거부, 없음·null·1·2 수락, 다른 version 재제출 → idempotency_conflict), v2 failed partial·event stream·재시작 동일, 독립 3 unit 중 1 실패 → 완료 2·미해결 1, held 경로 v1 결과 키 golden·v2는 같은 답 + partial, attempt·output 경합 → partial 폐기(failed는 결과 없음, held는 held), projection gate(미완료 상태 5개 숨김, v1 failed·held·cancelled 숨김, v2만 표시, 옛 failed+result 행 재시작 뒤에도 숨김·durable 유지), 한 법칙: K6 cap에 걸린 미수락 인증 하강은 nodes에 없고 미해결(출력 노출 없음), 파생 intent task가 version 유지·partial은 원래 task에 bind, deterministic node + 모델 node의 failed·held 경로(v1 답·이유 불변, v2는 deterministic node를 attempt 없이 싣는 typed partial), type 불가 partial → v1 결과·원래 이유 유지. `openclaw-rcc-partial-failure.test.mjs`의 failed partial test 3개를 v1(결과 없음·durable 유지)/v2(typed partial)로 나눔. Swift `RCCRuntimeContractFixture`: request 왕복(없음은 키 없음 = 이전 바이트), 0·3·-1·문자열 거부, snapshot 양성(failed·held·cancelled·returned_unverified, 보존 출력 held child), 음성 37개(협상 부재 failed·held, 미완료·completed 등 8상태, 미지·중복·누락 id, 미해결 0, 완료 id가 미완료 child, 미해결 id가 완료 child, 완료 미포함, 중복·외부 node, 다른 attempt·attempt 없음, attempt 없는 항목이 모델 행·attempt 있는 child·행 없는 child·local worker 모델·미해결 child, 외부 parent task·request, revision 초과·0, hash 아님, task_verified·parity·failed quality, install handoff, partial·coverage·parent·node 미지 키, null partial), `negotiated`·라벨 검사, 실제 Node 차등(Swift가 encode한 v2 request를 실제 Core에 제출: v1 failed → 결과 없음·durable 유지, v2 failed → typed partial decode·왕복, v1 held 불변, v2 held partial, deterministic + 모델 plan의 v2 failed·held: deterministic node만 attempt 없음). `RCCRuntimeProjectionFixture`: root 라벨·id 3개 상한·요약 상한. 변이 검사: RT gate 제거 → Swift 실제 Node decode가 `invalidSnapshot`으로 실패. App self-test: 새 제출 v2 고정·저장 보존·이전 빌드 항목 retry v1·argv·CLI 값 검증·App→CLI→Request v2, `rccPartialResultSelfTest`(failed v2 partial → 답 + 바로 뒤 coverage 라벨, receipt에 typed 실패, graph root 라벨, 재실행·큐·실행 인증 없음). wiring 검사 3개(RT↔Swift version·gate), run-options 검사에 K12b anchor와 `printRunSummary`가 출력 앞에 coverage 라벨을 찍는 anchor). 검증: swift build, OS1ContextTests 전체, `os1 self-test`, OS1App `--self-test`·`--self-test-rcc-intent-ingress`·`--self-test-rcc-installation` 통과. D3 실제 native partial(IG-01 partial/limit)은 NOT_RUN | `6a57f69d` |
| K13 C3(native 하위 에이전트 parity 회복 주장) 철회. C3는 구현된 적이 없다(Core는 `allow_native_subagents`를 한 번도 넣지 않았다). 거짓 주장은 CT `ExecutionTicket.allowNativeSubagents` 주석과 MS RCC native adapter 주석에서 철회. CT `validate(ExecutionTicket)`는 모든 surface에서 `true`를 거부(decodeTicket도 같음, dispatch 전 실패). MS는 `managedDelegation.withValue(true)`로 고정. typed `delegation{max_children, child_tuple:'parent', cancel:'propagate', usage:'children_required', enforced}`는 주석으로만 예약(wire·ticketShape 변경 없음) | 구현, D1 fixture 통과(C3 trigger 모양인 Auto·단일 노드·Codex 레퍼런스·재개 세션, Claude 레퍼런스, 검증 실패 descent → escalation: 모든 ticket에 flag·delegation 없음. Swift: false는 managed로 통과, true는 decode·validate 모두 거부). 켜려면 D3 adapter 능력 증거(CLI로 확인), record의 자식 receipt 필드, Claude 하위 에이전트 usage 읽기가 필요하다. 자식 receipt 누락·초과 → incomplete/hold fixture는 그 채널이 생긴 뒤에만 가능(이번 범위 밖). harness parity(H0 vs native)는 미검증 | `44702ec7` |
| K14 미분류 새 모델 격리. `ModelTiers.knownUntiered`(production이 서명한 tier 없는 9개: gpt-6-sol, gpt-5.6-sol·terra·luna, gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-5.3-codex-spark, gpt-daybreak-blue-latest. tier 표와 겹치지 않음)와 `classification(of:)`(tier 표 → tiered, knownUntiered → known untiered, 그 밖 → unclassified, `[..]` 접미 규칙은 `tier(of:)`와 같음). catalog builder는 Auto 술어(route test·model family·v2 exact model·v2 family 없음) 안에서, 행으로 제공되는 unclassified 모델의 서로 다른 수를 pool별 정보성 exclusion `unclassified_model`로 낸다. 행·순서·`model_tiers`·레퍼런스·`reference_unavailable`은 그대로다: 그 모델은 tier가 없어 pool 맨 뒤로 정렬되고 레퍼런스·인증 하강·escalation 대상이 되지 않으며 오너의 말로만 쓰인다. CT `Exclusion.reasons`와 JS `EXCLUSION_REASONS`, `informational` 부분집합을 함께 고쳤다. 양쪽 validator는 정보성 exclusion에 `model_tiers`와 그 provider의 tier 없는 제공 행을 요구하고, 빈 catalog는 정보성이 아닌 exclusion으로만 설명된다(`catalogShape` 키 불변). pool hold 없음: `referenceEffort`·`noDispatchableReason`은 로직 무변경(주석만). 알림: catalog에 `unclassified_model`이 있으면 Core `publicSnapshot`이 모델 행(transport ≠ local) child의 공개 `routing_decision.reason`에 `;reference_review_required`를 한 번 붙인다. 1 KiB를 넘으면 뒤쪽 진단 세그먼트부터 버리므로 토큰은 항상 남는다(D8). 저장된 decision과 ledger는 그대로다. Swift `RCCRuntimeContract.referenceReviewNotice`는 전달된 child(완료 답의 완료 child, 또는 v2 partial이 싣는 child)의 정확한 토큰만 읽어 `routingNotices`에 넣는다(CLI `[routing]`, App 시스템 메시지). 알림은 레퍼런스가 기존 분류 모델로 유지된다는 것만 말한다(인증 하강의 escalation 레퍼런스도 같음). 어느 행이 답을 냈는지, 새 모델이 낫다는 말은 하지 않는다. local-effects 경계(`constrainCatalogData`)가 행을 걸러내면 정보성 exclusion도 남은 행에 닫힌다: 그 provider에 tier 없는 행이 남을 때만 유지된다(Claude 행 제거·source-bound 전체 제거에서 catalog binding 실패 대신 Codex 레퍼런스 실행·설명된 빈 hold). 동결 본문과 다른 점(동결 기록 대상): "tier 없음 = 새 모델"이 아니라 명시적 known-untiered 집합이 필요하다(production이 tier 없는 9개를 서명함). 알림 채널을 정했다(reason 토큰 + `routingNotices`). C9 pool hold는 코드에 존재한 적이 없어 철회할 것이 없다. 감지는 서명된 profile이 있는 모델만 본다: provider가 내놓았지만 서버가 서명하지 않은 모델은 보이지 않는다(연기). ledger에는 토큰을 기록하지 않는다 | 구현, D1 fixture 통과(`openclaw-rcc-unclassified-model.test.mjs` 9개: 새 frontier·비frontier·다른 pool·미확인 frontier가 exclusion 유무로 plan·route·decision이 같음, runtime 완료·실행 모델 gpt-6-astra·공개 토큰 정확히 1회·저장 decision과 ledger 무변경·exclusion 없으면 토큰 없음, hold 문자열이 exclusion 유무로 같고 dispatch 0, 빈 catalog·legacy·tier 있는 provider의 exclusion → `catalog_binding_invalid`·`quota_zero`는 여전히 `no_routable_candidate`, legacy 무토큰, 토큰 1 KiB 경계·멱등·local 결정 child 무토큰. Swift builder S1–S7, contract `referenceReviewNotice` S8, `os1 self-test` local-effects 경계 2개(미분류 Claude 행 제거 → Codex exclusion만 유지, source-bound → 설명된 빈 hold), wiring: JS·Swift reason 집합 동일, production 서명 모델 전부 분류, main.swift 알림. release 목록에 추가) | `6a57f69d` |
| K15 프롬프트·하네스 안정성 (main.swift C4, Swift만, JS·bridge pin 무변경). N 항목: (a) read-only Claude 실행의 추가 보호 경로를 `rccReadOnlyAdditionalProtectedPaths`(`Array(Set(paths)).sorted()`)로 중복 제거·정렬한다. 전에는 `Array(Set(...))`라 순서가 프로세스마다 달랐다(집합은 같고 순서만 하나로 고정, Claude `--settings` deny 목록·sandbox profile·`execution_configuration_sha256`에 닿는다). (b) one-shot Claude prompt cache TTL을 이름 붙은 상수 `claudeOneShotPromptCacheTTL = "5m"`(오너 결정 2026-10-15)로 바꿨다(동작 불변). 하네스 정체성: 새 `HarnessProfile`(OS1Context) H0 v1, parity `unverified`, 구성요소 6개(lean_projection_v1, chat_lane_predicate_v1, instruction_order_v1, delegated_readonly_claude_hooks_off_empty_mcp_v1, delegated_envelope_v1, managed_delegation_v1), `current = h0`, append-only `shipped`, rendering SHA-256 `4ecd97ffe17a…` 고정. H 항목 C4a(stable-first 재배열)·C4d(tool-free lane의 'Read the original' 줄 삭제)는 `pendingHItems`로 기록만 하고 적용하지 않는다(새 descriptor H1·parity unverified·새 rendering 필요, D4 arm ②가 H0을 잰 뒤에만 권장). pre-dispatch receipt에 `harness_profile`(id), `harness_profile_version`, `harness_parity`, `harness_scope`(K11 artifact와 같은 `id@version` 문자열 `H0@1`)를 기록한다. 모델이 보는 H0 builder 문구·순서·chat-lane 술어가 바뀌면 `os1 self-test`가 실패하고, 새 id/version·parity unverified·`shipped` 추가·rendering 재고정을 함께 요구한다. 동결 행과 다른 점(동결 기록 대상): (1) 'resume 동일 바이트'(spec 항목 (c): Codex verified resume의 projection-note developer text, self-test F, rollout parser)는 연기했다(lead 결정 D9, order.skip_or_defer). 로컬 Codex rollout의 `session_meta.base_instructions` 모양을 먼저 비용 0으로 읽어야 하고, 절약은 Codex resume마다 projection 사본 하나(≤24 KB, n=1)이며 `delivery_policy_valid`와 무관하다. 그래서 지금 Codex resume 바이트는 start와 owner-policy 블록에서 다르다. Claude는 같은 내용이면 이미 같은 바이트라 N 수정이 필요 없다. (2) 'byte-stable prefix'는 같은 내용의 결정성(시간·UUID·attempt id·Set 순서 없음)만 뜻한다. objective별 presentation 지시가 안정 header 앞에 오는 것, owner-note를 고칠 때마다 바뀌는 source SHA·경로 줄은 순서·줄 변경이라 H이므로 H0에서 고치지 않았다. (3) 선택 receipt 키 `claude_prompt_cache_ttl`은 넣지 않았다. (4) H0 golden은 Swift builder와 Swift chat-lane 술어(`claudeChatLane`·`codexChatLane`·`claudeChatLaneRefusal`)만 덮는다. JS `chatFirst`는 chat_lane_predicate_v1의 일부지만 golden에 없다(그 파일 바이트는 bridge SHA pin이 고정하지만 바뀌어도 H0 golden은 깨지지 않는다). (5) K13은 모델이 보는 입력이 같아 bump하지 않았다(D6) | 구현, fixture 통과(`os1 self-test` `harnessProfileSelfTest` 12 checks: A 같은 입력 → 같은 바이트, B 실행 id·sequence·nonce·signature·만료가 지시·argv에 없음, C 다른 action이 `- action:` 줄 앞 바이트를 바꾸지 않음(Claude·Codex, 공유 prefix 길이는 진단만), D 보호 경로 중복 제거·정렬, 순열 입력 → 같은 `--settings`·argv, E TTL 상수, G H0 golden(builder + chat-lane vector 40개, `<ROOT>`·`<HOME>` 정규화). `preDispatchGovernanceSelfTest`의 receipt 키 4개 검사. OS1ContextTests `HarnessProfileFixture`(`--harness-profile-only`, 9 checks), `test-harness-profile-wiring.py`(64 checks, release 목록). digest는 실제 home, `CFFIXED_USER_HOME` 가짜 home, `test-self-test-isolation.mjs --runtime`에서 같다) | `f91f0b2d` |
| K16 오프라인 M1–M4 분리(런타임 무변경, 번들되지 않는 스크립트 둘). `scripts/route-replay.mjs usage --ledger <path>… [--snapshots <checkpointed sqlite copy>] [--out <new file>]`(M1, label `recorded`): attempt마다 ledger usage를 uncached / cache read / cache write / output으로 나누고(native 입력은 cache 포함, 로컬 worker 입력은 제외, reasoning은 더하지 않음) task×pool마다 완전성을 판정한다. usage가 null·부분·범위 밖·미지 basis·미지 key이거나, ledger 기록이 없거나, snapshot에 없는 기록이거나, 두 세대 기록이 충돌하면(충돌 사본이 모두 다른 task를 가리켜도 그 attempt를 나열한 task 쪽도) 그 pool은 incomplete이고 값을 채우지 않는다(0·평균·최댓값 대입 없음, 알려진 부분합은 따로 보고). 모집단은 `--snapshots`의 attempt_history다: ledger만으로는 기록이 쓰이지 않은 attempt를 볼 수 없으므로 snapshot 없이는 complete가 없다. 미전달(held·failed·cancelled·effects_uncertain) task의 소비도 그대로 센다(전달은 보고 차원뿐, partial 결과를 가진 task는 delivered). 런타임 reducer `summarizeTaskResources`와 task마다 대조하고, reducer가 native incomplete로 본 task는 여기서도 incomplete다(fail-closed). 출력은 id·enum·카운터뿐이다(요청·지시·출력 텍스트, 절감·비율·퍼센트 키 없음). exit 0 COMPLETE, 2 INCOMPLETE·NO_EVIDENCE, 64 사용·입력 오류. `scripts/quota-replay.py`(Python 3.9 stdlib, `python3 -I`): `--m1`과 각 입력을 SHA-256 pin으로 읽는다. M1은 pool별로 그대로 통과. M2(PRICE card, 모든 값 label `estimate`)와 M3(CF card, label `estimate_only`, 분모 0 → ratio null·FAIL)는 pool마다 complete task만 쓰고 incomplete task는 빼고 개수를 보고하며, 카드가 없으면 `not_computed`다. 15% 판정은 `m4_verdict`가 M4 quota-window artifact와 M1의 task별 pool만 받아 pool마다 내린다: `1 − (ΔO+q)/(ΔR−q) ≥ 0.15`(q = used_percent 양자, 기본 1), pool 합계 없음. artifact 없음 → NOT_RUN. judged window 없음 → `pool_unobserved`, reset 불일치·시각 순서·감소·두 arm 겹침 → `window_invalid`, 동시 사용 통제 없음, arm task 집합 불일치·M1 밖 task·빈 batch, ΔR−q ≤ 0 → 모두 FAIL. exit 0 PASS, 1 FAIL, 2 NOT_RUN, 64. 판정 객체는 `basis: M4_quota_window_observation_only`, `accepted_B: not_evaluated_by_quota_replay`이고 카드 유무와 바이트까지 같다. 동결 본문과 다른 점(동결 기록 대상): `verified_not_dispatched` attempt의 null usage는 unknown이 아니라 verified zero로 센다(executor가 not dispatched로 typed했고 `chargedAttempts`도 무작업으로 본다. 런타임 reducer는 unknown으로 세므로 parity 차이 `verified_not_dispatched_zero`로 따로 보고). §4.2의 전체 `accounting_complete` 대신 구독 pool별 native 완전성으로 판정한다(로컬 pool `none`과 로컬 이벤트는 따로, 옛 snapshot의 `local_resource_events_missing_or_unbounded`·`plan_model_calls_unobserved`는 쿼터와 무관). M4 판정은 양자화 보수 하한이고 arm 겹침도 FAIL | 구현, D1 fixture 통과(`openclaw-rcc-route-replay-usage.test.mjs` 14개: null usage 6개 상태 → incomplete·채움 없음, verified zero와 parity 차이, 미전달·partial 포함, ladder 하강+레퍼런스 합산, cache 분할·부분·불일치·미지 key, 세대 중복·충돌, legacy·읽을 수 없는 줄, 로컬 pool 분리, zero-model·미dispatch task, 모집단 공백·불일치(ledger 기록 없음, snapshot에 없는 기록, task snapshot 없음, ledger만, pool 미상, history 부족, node 불일치, usage 불일치, 읽을 수 없는 snapshot), reducer fail-closed, 텍스트·절감 키 없음·결정성, CLI와 quota-replay 파이프라인(pin·exit code·M2 제외 개수·M4 PASS), 실제 durable Core 종단 COMPLETE. `quota-replay.py --self-test` 69 checks: M2/M3 제외·라벨, 미전달 포함, 분모 0, M4 없음 NOT_RUN(M3 90%여도), M3와 반대인 M4가 판정, 양자화 경계(0.105 FAIL, 정확히 0.15 PASS), window·통제·batch FAIL, pool별 판정, CLI pin·custody·O_EXCL. 둘 다 release 목록에 추가). 라이브 ledger(125건) + scratch DB 사본(127 task, ledger보다 오래됨) 읽기 전용 replay: INCOMPLETE. openai_codex 59 task 중 54 complete(나머지 5: usage null), anthropic_shared 27 중 24(3: 사본에 task 없음), pool 미상 4(ledger 이전 attempt), 로컬 15 모두 complete, zero-model 43(결정적 23, 미dispatch 20), parity 일치 120·replay가 더 엄격 4·`verified_not_dispatched_zero` 3. M2/M3는 카드가 없어 not_computed, M4는 D4 artifact가 없어 NOT_RUN | `4a63fa08` |
| build 440 `chat_explanatory` 오너 결정 인증서(변경 1, Swift만, JS·bridge pin 무변경). 새 `RCCClassOwnerDecision`(OS1Context): compiled 바이트와 pin, `RCCClassMeasurement.verified`는 인증서의 `measurement_sha256`이 그 pin이면 측정 대신 결정으로 판정하고(custody artifact는 쓰지 않음) 다른 hash는 기존 D4 gate를 그대로 거친다(그 gate는 결정 종류를 `malformed`로 거부). `RCCClassTable` 재서명(인증서 하나, pin 없음). `StatusCheckIn.testInvitation` 구조 문법과 `standaloneTestInvitation`(초대가 중립 문장·자기 확인 opener를 뺀 요청 전체일 때만 check-in, 그 밖에는 build 439 판정 그대로, 쉼표·물결표·끝 ㅋ/ㅎ·'되는 지'는 표기로 정규화). 리뷰 수정: 처음 커밋의 문장 단위 `checkOpener` 둘째 대안과 앵커 없는 `openerAsking` gate는 질문 문장(조회·코드·OS-1 질문), 앞선 작업 질문('빌드 끝났어?'), '…해볼래?' 주문, 주어 없는 '되는지 보자', 사물 주어 '…하는지 볼까'까지 `chat_explanatory`로 넓혀서 철회했다. main.swift: `providerSurfaceRoutingSelfTest`에 오너 시험 초대 → Claude·GPT chat lane, read-only, text operation 아님 확인. rccNativeCatalog의 custody 읽기는 그대로(결정 hash의 파일은 없고 필요도 없음) | RCCAdmissionFactsFixture 440-a..d(배포 표로 `chat_explanatory` 인증서 적재와 Core 계약 수락, 인증 tuple의 read-only Codex 행 존재, `readonly_lookup`·`text_operation`·`writer`·`explicit_route`는 빈 표와 catalog 바이트 동일, 재서명 표의 모델·effort·provider·format check·id·class 변경, 바뀐 결정 바이트(custody 있음 `malformed`, 없음 `artifact_absent`, 직접 호출 `hash_mismatch`), harness 없음, 레퍼런스 없음, 배포 표 변조 → 모두 레퍼런스. Swift가 만든 catalog를 Node Core `hostPlan`→`resolveRoutePlan`으로 bind: chat은 luna low tier, ladder `admitted_by` `class`, `certified:class:owner-chat-fast-20261027`, 나머지는 astra ultra `reference`). `openclaw-rcc-admission.test.mjs` build 440 test(배포 표의 인증서로 durable runtime: 채택과 ledger 기준, 빈 답 1회 escalation, 다른 class 레퍼런스, explicit route owner_words). 범위 좁힘: `StatusCheckIn.stateOnly`와 `RCCClassOwnerDecision.admits`, admissionFacts가 결정 인증서를 상태 전용 check-in에만 싣고 나머지는 `scope_mismatch`(440-d: 상태 check-in 4개 적재, 질문 6개 레퍼런스, 빈 표와 catalog 바이트 동일). StatusCheckIn self-test 양성·음성 추가(stateOnly 양성 12개·음성 9개, 리뷰 수정: 표기 양성 8개, 주어 없음·사물 주어·옆 문장 음성 27개), `providerSurfaceRoutingSelfTest` 쉼표 초대 → GPT chat lane, 질문·주문·주어 없음·사물 주어 6개 → 두 chat lane 모두 아님. 품질 동등성은 측정하지 않았다 | build 440 |

---

# OS-1 라우팅 수렴 아키텍처 v2 (Claude ↔ Codex 합의안)

기준 소스는 `/Users/LUA/Developer/OS1-live-routing-20261023`, HEAD `3d62dad6`이다. 이 문서는 설계만 담는다. 작성하는 동안 코드 편집, 빌드, 커밋, 설치는 하지 않았고 provider 호출도 0회다.

**라벨**
- [src 파일:줄]: HEAD를 직접 읽고 확인함
- [측정]: 이번에 `~/.os1/rcc-runtime/routing-ledger/routing-ledger.jsonl`의 scratchpad 사본을 `python3 -I`로 읽어 계산함
- [이전측정]: 앞선 초안이나 세션의 수치. 이번에 다시 돌리지 않음
- [추론]
- [기억]: 오너 메모리 `os1-routing-objective-function.md`
- [브리프]: 이번 지시문. 출처를 확인하지 못한 내용도 포함

**약어**
- `RT` = `products/os1-mac-runtime/Resources/openclaw-os1-bridge/rcc-runtime.mjs`
- `PL` = 같은 폴더의 `rcc-plugin.mjs`
- `CT` = `Sources/OS1Context/RCCRuntimeContract.swift`
- `MS` = `Sources/OS1/main.swift`
- `BP` = Codex blueprint `/Users/LUA/Documents/Codex/artifacts/OS1_BLUEPRINT_20261024`

---

## 0. 결론

1. **법칙은 하나다.** `admittedRoute`(RT:804-851)는 노드마다 허용 집합 **F(node)**를 정한다. F는 bind할 때 고정한 레퍼런스와 인증된 하강 행으로 이루어진다.
   - 동적 계층은 모두 남긴다: 로컬 분해 제안, `selectJointRoute`, 오프라인 보정. 이 계층은 F 안에서만 고르고, F에 행을 추가할 수 없다.
   - 행을 bind하는 두 번째 함수 `executionPolicyChoice`(RT:1295-1319)만 없앤다. 이 함수의 `why`는 `'host_checked_unmeasured_choice;quality_not_certified'`(RT:1318)이다.
   - C2(bounded 끄기)와 C8(모듈 삭제)은 **철회**한다. `bounded_auto`(LocalRouterBridge.swift:92)도 유지한다.
2. **선택은 N/H/Q 세 갈래다(§1).** Q(튜플 하강)의 답은 그 답을 받아들이는 검사가 있을 때만 전달한다.
3. **첫날 실제로 움직이는 것을 정직하게 적는다.**
   - 움직이는 것: zero-model 닫힌 문법, R11(라이브 quota로 pool 선택), 오너 topology, 오너 계약과 staged writer 하강, explicit route exact, 이미 출하된 H0 harness(lean, chat lane), prefix·cache 장치.
   - 공동 선택기는 동결 비용 정책이 생기면 발화한다. 분해 제안은 D4의 plan-shape 인증서가 생기면 발화한다. 그 전까지는 배선과 fixture만 있다.
   - [측정] 관측 토큰의 98.3%가 입력이다. 출력은 184,392 / 10,941,496 = 1.7%다. 그래서 첫날 절감은 입력 쪽에서 나온다. 튜플 하강이 구독 쿼터를 얼마나 줄이는지는 모델별 가중치에 달렸고, 이 가중치는 측정되지 않았다(D4 M4).
4. **코드가 구성으로 보장하는 값은 `delivery_policy_valid` 하나다.** 아래 네 가지는 D3/D4 gate로 남고, 오너가 승인하기 전까지 NOT_RUN이다.
   - 실제 결과의 accepted_B
   - 구독 쿼터 절감
   - harness parity
   - native 왕복
5. **남은 이견(§8)의 핵심은 '검사 없는 저가 전달'이다.** BP DD-SYS-14와 오너 2026-10-18의 옵션 3은 이를 허용한다. 이 문서는 오너의 최신 발언(2026-10-19)을 근거로 차단하고, 오너 결정 질문을 남긴다.

---

## 1. 합의 원칙

### 1.1 세 갈래 (가설 수정판)

| 갈래 | 정의 | HEAD의 예 | 동적 선택기 권한 |
|---|---|---|---|
| **N 동일 입력** | 모델이 받는 바이트, 도구, 튜플이 같은 선택. 또는 오너가 동등하다고 정한 레퍼런스(Anthropic/OpenAI 최고 모델의 최대 reasoning [기억 10-19]) 사이의 교체. 두 번째는 오너가 채택한 가정이고 측정되지 않았다 | R11 pool 순서(RT:935-966, `quota_scores`). 다른 pool 레퍼런스로 re-resolve(`_reResolve` RT:4403-4459, escalated면 `referenceOnly`). catalog 재사용(RT:5079-5084). lease, spread(`MAX_POOL_SPREADS` RT:174), 병렬 스케줄. byte-stable prefix, resume 동일 바이트, TTL 상수. zero-model 닫힌 문법 | 첫날부터 자유. 증거 불필요 |
| **H 하네스 변경** | 튜플은 같지만 모델이 보는 입력, 도구, 작업 경계가 바뀌는 선택 | **H0(출하된 profile)**: lean projection, 자동 chat lane(`claudeChatLane` MS:4107-4119가 대화형 질문과 자체완결 텍스트 작업을 고름, `chatFirst` RT:927). 그 밖: 분해 topology, dependency DATA(RT:5207-5236), native subagent, 지시 순서 변경, 도구 축소 | 기본은 버전된 `harness_profile` 하나(H0). 작업별 변경은 세 경우만 허용: (a) 오너가 쓴 topology, (b) 바뀐 부분 전체가 `sound_full` 검사로 덮일 때, (c) D4가 그 모양을 인증했을 때 |
| **Q 튜플 하강** | 레퍼런스보다 낮은 model 또는 effort | `TIER_ROUTES.trivial`(RT:119-122), 인증서 튜플 | `admittedRoute`가 `certified`일 때만. 답마다 수락 검사(`certifiedAnswer` RT:2415-2428, `_verifyNode` RT:5895)를 거친다. 실패하면 `ladder.reference_candidate_id`로 1회(`_escalateLadder` RT:6001). 선택기가 정하는 것은 하강할지와 어느 튜플로 할지뿐이다 |

**두 보고서가 지적한 분류 수정**
- chat lane은 N이 아니다. 오너 단어 전용도 아니다. 오너가 실행기로 명시한 "Claude chat"[브리프]이고 지금 자동으로 쓰인다. 그래서 **출하된 H0의 일부**로 두고, parity는 미검증으로 표시하며 D4 arm ②에서 잰다.
- Fable과 Astra 레퍼런스 사이의 선택은 오너가 채택한 동등 가정이다("pick between equal-quality references by quota scarcity" [기억]). 측정 사실이 아니다. D4는 provider별 레퍼런스 arm을 따로 동결한다(BP 60.6).

### 1.2 이 원칙이 오너 목적과 RT-01~RT-10을 함께 만족하는 이유

- **"최상" [기억 10-13, 10-18].** 낮은 튜플의 답은 그 attempt에 묶인 수락 기록 없이는 전달되지 않는다. [측정] 2026-10-24 bounded 경로로 4건이 검사 없이 전달됐다. 모두 `verifier_outcome:not_registered`, route_kind `execution_only`였다.
  - 4012ab89 haiku/none
  - 37801bd9 fable/low
  - 632cf802 astra/low
  - 41dbf0e8 astra/low

  이런 전달은 구조적으로 불가능해진다.
- **"돌리기 전에 알아야" [기억 10-18].** F와 F 안의 선택은 세 가지 입력만으로 정해진다: bind 시점 catalog, 동결된 정책 artifact, task. live 학습은 없다.
- **"1+1에 astra max는 말이 안 된다" [기억 10-14].** zero-model 닫힌 문법 확장(K7)으로 모델 호출 0이 된다.
- **"처음에 다 최강이면 망해" [기억 10-18].** 이때 기각된 것은 "ledger가 싼 경로를 증명할 때까지 레퍼런스"였다. 이 설계는 통계를 기다리지 않는다.
  - 검사 가능성이라는 사전 성질로 즉시 하강한다.
  - 레퍼런스에 남는 것은 검사가 없는 품질 생성뿐이다. 2026-10-19 오너가 직접 그렇게 정했다: "quality-bearing generation must stay on the reference", "Downshift tiers only where the answer is checkable" [기억].
  - 남은 충돌(10-14와 10-18 옵션 3의 등급별 저가 실행)은 §8-1에서 다룬다.
- **"다 검사장치가 있어야지 … 퀄리티가 똑같고 쿼터는 절약" [브리프 10-19].** Q는 검사 없이 존재하지 않는다.
- **RT-01.** 분해, 공동 선택, 보정 코드는 남고 배선된다. 꺼지는 것은 '검사 없는 하강의 전달' 하나다. 품질 미측정 결과에 parity 라벨을 주는 문제와 최적화 기능 삭제는 서로 분리한다.
- **RT-02 ~ RT-10.** §5 변경 목록과 §6 gate에서 반영한다. 대응표는 §7이다.

### 1.3 정직한 한계 (두 레드팀 지적 반영)

1. **모델이 제안한 분해의 절감은 오늘 증명할 수 없다.**
   - coverage를 지키려면 최종 노드가 원문 전체를 다시 수행해야 한다(§2.3-5b).
   - 그러면 레퍼런스의 일은 그대로이고, 준비 노드, 추가 입력, 다노드에서 잃는 resume(`isSingleFullAgent` RT:5181-5193)이 더해진다.
   - 그래서 plan-shape 인증서(D4)가 생길 때까지 planner를 부르지 않는다(K3).
   - 오늘 실제로 레퍼런스의 일을 빼는 분해는 오너가 쓴 것뿐이다: 오너 병렬(K5), 오너 obligation collection(`ownerCollectionFor` RT:1817). 다만 Core 자신도 collection을 `'preregistered_independent_collection_not_measured_resource_saving'`로 기록한다(RT:4277-4278).
2. **읽기 전용 작업에 sound_full 결정적 검사가 있으면 대개 결정적 해법도 있다** [추론]. 이 경우 "저가 모델 + 검사"보다 zero-model(K7)이 더 싸다. 검증이 풀이보다 쉬운 경우(테스트가 있는 코드, 제약 문제)는 writer와 오너 계약 경로에 모여 있고, 이 경로는 이미 있다(RT:828-833).
3. **작은 작업은 입력 prefix가 비용을 지배한다** [측정].
   - 입력 100K 이하인 레퍼런스 attempt 15건: 입력 중앙값 42,073, 출력 837.
   - 10-24에 전달된 저가 4건: 입력 24,367 ~ 72,700.
   - 따라서 튜플 하강으로 줄어드는 관측 토큰은 작다. 쿼터 차이는 모델별 가중치에 달렸다(D4 M4).
4. **하강의 경제성.** 기대 비용이 `E[하강] = c_cheap + c_check + (1−p)·c_ref < c_ref`일 때만 하강이 이득이다.
   - 오너 계약 checker는 로컬 스크립트다(`checkers/<sha>.py`, timeout 30 s, RCCCatalogFacts.swift:113-122 자체시험). 그래서 쿼터는 0이지만 지연이 생긴다.
   - 후속 턴의 하강은 오너 세션을 resume하지 못한다(`pendingEscalation` → resume null, RT:5191). 따라서 c_cheap에 cold prefix가 들어간다.
5. **class certificate의 수락은 통계적이다.** 답마다 하는 검사는 `nonempty_text`뿐이다(RT:125, 2424). 그래서 `certified:class` 전달에 대해서는 accepted_B를 측정된 상한까지만 말할 수 있다.
6. **계약 수락은 레퍼런스 parity가 아니다.** 계약 수락은 "오너가 선언한 성공 정의를 통과했다"는 뜻이다(TaskQuality.swift:370 `declared_task_contract_verified_no_reference_parity`).

---

## 2. 하나의 법칙, 하나의 흐름

### 2.1 흐름

```
submit → Core._runTask (RT:4084)
 ① zero-model exact   RT:4105-4118 exactLocalGreeting | pureArithmetic/exactArithmeticQuestion
                      조건 withoutConversation (RT:2063-2116). K7: 닫힌 문법 확장, envelope 수정 → basis zero_model:*
 ② intent             _resolveTaskIntent (RT:4004)
 ③ catalog bind       validateCatalog (RT:4135) → noDispatchableReason (RT:1030) → typed hold
                      (bounded 우회 RT:4196-4205 삭제, K2)
 ④ 분해 제안(선택)    _observeAdaptivePlan (RT:3804) → proposeLocalPlan (PL:553-571)
                      호출 조건(K3): 적용 가능한 sound_full 검사 ≠ ∅ 그리고 plan-shape 인증서 적재(K11b)
 ⑤ plan               owner collection | 오너 병렬 hostPlan (RT:1225, K5) | admitBoundedAutoPlan (RT:1320, K1) | hostPlan 1 node
 ⑥ 법칙(노드마다)     resolveRoutePlan (RT:1168) → selectRouteCandidate (RT:1076)
                      → tierRouteCandidate (RT:918) → admittedRoute (RT:804)   ← 유일한 법칙: F(node)
 ⑦ F 안의 선택        pool: R11 (RT:935-966, 라이브 quota_scores). pool 안의 하강 여부·튜플:
                      selectJointRoute (joint-route-selector.mjs:225), score space check_acceptance_probability_v1 (K10).
                      동결 정책이 없으면 TIER_ROUTES 순서(오늘 동작)
 ⑧ dispatch           _scheduleDAG → _admitNativeDispatch (RT:6072, typed cap K6) → _ticket (RT:5164)
 ⑨ adoption           _executeNode (RT:6321-6368): 하강이면 certifiedAnswer (RT:2415) [+ _verifyNode RT:5895]
                      불통과 → _ladderFailed (RT:5956) → _escalateLadder (RT:6001) → 레퍼런스 1회
 ⑩ 기록               _ledgerRecord (RT:5777) + delivery_basis·check_id·check_outcome (K9)
                      _outcomeSummary (RT:5800) 검사 라벨 (K9); resource-usage.mjs accounting_complete (:166-171)
 ⑪ 비용 보정(모델 0)  produceOfflineRouteCalibration (offline-route-calibration.mjs:156) → 동결 artifact
                      → loadCalibratedRouteEvidence (calibrated-route-evidence.mjs:167)
                      → createCalibratedRoutePredictor (calibrated-route-predictor.mjs:308) → 다음 버전의 ⑦
 ⑫ 품질 인증(D4 전용) paired 측정 artifact → host loader 확인 → class_certificates / plan-shape (K11)
                      → 다음 버전의 ④⑥
```

브리프는 "공동 선택 → 노드별 법칙" 순서를 제시했다. 이 설계에서는 법칙이 먼저 F를 만들고 선택기가 F 안에서 순위만 매긴다. 선택기가 무엇을 돌려주든 F 밖의 행은 bind될 수 없으므로 두 순서는 같은 집합을 낸다. 다른 점은 법칙이 두 번 실행되지 않는다는 것뿐이다.

### 2.2 법칙과 불변식

`admittedRoute(node, task, catalog, now, {verifierRegistry})`는 다음 셋 중 하나를 돌려준다. 순수 함수이고 bind 시점에 실행된다.
- `reference:<reason>`
- `owner_words`
- `certified:{exact | contract | verifier:<id> | class:<id>}`

**불변식**
- **I1. bind 조건.** 레퍼런스보다 낮은 행은 세 조건을 모두 만족할 때만 bind된다.
  - `certified`일 것
  - dispatch 가능한 레퍼런스가 `ladder.reference_candidate_id`로 고정되어 있을 것(RT:973-998)
  - 재실행 예산이 있을 것(K1): `max_attempts ≥ 2`, native cap 여유. 규칙은 `_calibratedContext` RT:3606-3612와 같다.
- **I2. 전달 조건.** 하강 결과는 그 `attempt_id`에 묶인 수락 기록이 있을 때만 전달된다.
  - verifier 출처는 `ladder.certificate_id`가 가리키는 verifier의 pass 기록이 있어야 한다(K4).
  - 기록이 없으면 버리고 레퍼런스로 1회 다시 돈다.
- **I3. bind 함수는 하나.** 행을 bind하는 함수는 `selectRouteCandidate` 계열뿐이다. 선택기는 F의 원소만 돌려줄 수 있다.
- **`delivery_policy_valid`(코드가 보장하는 유일한 값).** 전달된 모든 child는 아래 둘 중 하나다.
  - basis가 `zero_model:*`, `reference`, `reference_escalated`, `owner_words` 중 하나다.
  - basis가 `certified:<s>`이고 I2를 만족한다.

**이 값은 accepted_B=0의 증명이 아니다(RT-02).**
- 같은 튜플도 별도로 실행하면 다른 답이 나온다. 2026-09-30 기록에서 같은 lean 설정의 두 샘플이 10건 중 3건에서 "clearly" 달랐다[src `~/.os1/recovery/pareto-eval-20260930/README.md:16`].
- 검사 자체가 불완전할 수 있다.
- 결과 accepted_B는 두 경우에만 말할 수 있다.
  - exact와 `sound_full` verifier가 덮는 범위: 구성상 성립
  - 그 밖: D4 측정

### 2.3 `executionPolicyChoice`와 `admitBoundedAutoPlan`을 법칙 아래에 두는 정확한 방법

1. `admitBoundedAutoPlan(compiled, task, catalog, now, verifierRegistry)`처럼 서명에 registry를 추가한다. 호출부 RT:4228에서 이를 넘긴다.
2. 기존 권한 검사는 모두 그대로 둔다: binding hash, 노드 ≤4, writer `host_finalize`, `validatePlan`.
3. RT:1360의 `executionPolicyChoice(checked, …)` 호출을 다음으로 바꾼다.
   - 새 호출: `selectRouteCandidate(checked, task, catalog, now, {widenWrites: finalWriter, verifierRegistry})`
   - `routes[id] = {kind, reference_effort: referenceEffort, ladder}`
   - `decisions[id] = routingDecision(choice.routeClass, choice.candidate, 'bounded_plan;' + choice.why, choice.ladder, choice.tier)`
4. planner의 `proposed_candidate_id`는 기록만 하고 binding에는 쓰지 않는다.
   - kernel 스스로 "Candidate IDs are hints"라고 적는다(local-plan-planner.mjs:39).
   - 선례: `admitLivePlannerPlan`은 이미 "planner 후보 = 독립 R0 선택"을 요구한다(RT:1437-1443).
5. **분해 수락 규칙.** owner partition이 아닌 계획은 아래 셋을 모두 만족해야 한다.
   - (a) 최종이 아닌 노드가 모두 `kind==='tier'`다. 즉 검사로 인증된 노드다.
   - (b) 최종 노드가 `instruction === task.request`인 `host_finalize`다. read-only도 이 노드를 둔다.
   - (c) catalog에 이 `request_class`와 이 모양에 대한 plan-shape 인증서가 있다(K11b, D4 이후).
   - 하나라도 어기면 `bounded_decomposition_not_admissible`을 던진다. 그러면 기존 catch(RT:4231-4239)가 `hostPlan` 1 node로 돌아간다.
   - 수락 비용 gate는 (c)다. 인증서 자체가 "이 모양의 측정 총자원이 단일 레퍼런스보다 작다"는 측정이다. bind 시점에 추정식으로 대신하지 않는다.
6. `ownerParallel` 분기(RT:1337-1338, 1353-1354, 1365)를 제거한다. 오너 topology는 planner 없이 `hostPlan`과 법칙으로 처리한다(K5).
7. 나머지 호출부는 다음과 같이 바꾼다.
   - `_runTask`의 우회(RT:4196-4205): 삭제
   - `_reResolve`(RT:4423)와 `_spreadAcrossPools`(RT:4494): `selectRouteCandidate`
   - 이미 저장된 `execution_only` child: `{referenceOnly:true}`로 재해결
8. `boundedAutoEligible`(RT:1244-1253)은 "모델 분해 제안 대상"을 판정하는 술어로만 남긴다.
   - `verifierRegistry.size === 0` 결합(RT:3805)을 제거한다. 지금은 검증기를 등록하면 분해가 꺼지는데, 이 역전을 없앤다.
   - 오너 병렬은 이 술어에서 분리한다(K5).

### 2.4 F 안의 선택: 공동 선택기의 실제 범위 (K10)

- **입력.**
  - R11로 정해진 pool의 `certifiedEntries`(RT:864) 행 전부. TIER_ROUTES의 첫 dispatch 가능 행만이 아니다.
  - bind 때 고정한 레퍼런스
  - 동결 정책 행 `{p_lower, c_attempt, c_check}`. 층은 family × 튜플 × 문맥 크기 구간 × 첫 턴/후속 턴이다.
- **목적.** 레퍼런스를 포함한 F 안에서 다음 기대 총비용이 최소인 행을 고른다.
  - `c_attempt + c_check + (1−p_lower)·c_ref`
  - 이 값을 기존 `RESOURCE_COMPONENTS`(joint-route-selector.mjs:39-43)의 `verification_tokens_per_sample`과 `retry_reserve_tokens`에 넣는다.
  - 새 score space에서는 품질 하한 threshold를 쓰지 않는다. 품질은 답별 검사가 지킨다.
  - 레퍼런스가 최소면 `certified_descent_not_cost_effective`로 레퍼런스를 bind한다.
- **적용 지점.** 호출을 `_calibratedChoice`(RT:3638) 밖으로 옮겨 `tierRouteCandidate`의 certified 분기 안에서 노드마다 부른다.
  - 동결 정책은 `verifierRegistry`처럼 Core 옵션으로 받는다. 그래서 단일·다노드, 첫·후속 턴에 똑같이 적용된다.
  - cohort 잠금(RT:3671-3673)은 기존 `reference_match_probability_v1` 경로에만 남긴다. 이 경로는 D4 class 수준의 품질 예측용이다.
- **pool 간 선택은 선택기가 하지 않는다.** pool마다 구독 단위가 다르고 쿼터 가중치는 측정되지 않았다. pool 간 선택은 오너 규칙(quota 희소성) 그대로 R11이 한다. R11은 라이브 quota에 따라 매 task 바뀌므로 동적이지만, 비용 최적화는 아니다. 이 점을 숨기지 않는다.

---

## 3. 요청 종류별 규칙

| 종류 | 자유 변경 (N, H0) | 검사·인증이 필요한 것 | 검사 | 실패·부재 시 |
|---|---|---|---|---|
| 정확 계산·인사 | 모델 0 | 대화, 자료, provider 단어가 있으면 zero-model 금지(RT:4105-4108) | 닫힌 문법(K7) | 레퍼런스 |
| explicit route test | 이름 붙은 surface 안의 행 순서 | 산술 payload이고 model/effort 단어가 없을 때만 `certified:exact`(RT:812-815) | exact 일치(RT:2425) | 같은 surface의 레퍼런스 1회. surface가 없으면 `explicit_route_surface_unavailable` hold |
| 단순 질문(검사 불가) | R11, cache, catalog 재사용, H0 chat lane(호스트 술어 MS:4107-4119) | 하강은 D4에서 발급한 `certified:class`로만 | 인증서 범위 + format | 레퍼런스 |
| 읽기 전용 | N, H0 | 원문 그대로의 full read-only owner contract(RT:837-842). 또는 적용 가능한 `sound_full` verifier(K4) | `task_contract_verified` + coverage full, 또는 verifier pass(I2) | bind 때 고정한 레퍼런스 1회. 레퍼런스가 없으면 hold |
| 자료 첨부 | N. 자료가 있으면 chat lane 없음(`chatAllowed`, RCCNativeCatalogBuilder.swift:434) | 위와 같음. 계약이 자료 source를 묶어야 함 | 위와 같음 | 위와 같음 |
| 테스트 있는 writer | N | owner full staged-writer contract + Codex app-server(RT:828-833, 873) | contract verified + `staged_writer.state==='applied'`(RT:2417) | staged 결과 폐기(workspace 무변경) → 레퍼런스 writer 1회 |
| 테스트 없는 writer | N | 하강 없음 | — | 레퍼런스 writer |
| 웹사이트·디자인·산문 | N | 하강 없음. 미래 인증은 D4 whole-task 평가로만("샤넬 같은 웹사이트" [기억 10-19]) | — | 레퍼런스 |
| 여러 부분(오너가 열거하지 않음) | N | planner는 K3 조건에서만 호출. 받아들이는 모양은 §2.3-5뿐 | 준비 노드별 `sound_full` verifier + plan-shape 인증서 | `hostPlan` 1 node 레퍼런스 |
| 오너가 명시한 병렬 | N(lease, 순서) | unit마다 법칙 적용. 대개 레퍼런스. 비용 때문에 합치지 않음. 전체 계약과 공존할 수 없으면 hold(K5) | unit별 | pool 공유가 안 되면 unit끼리 대기(직렬). topology는 유지 |
| 오너 단어(model/effort/provider) | 그 단어가 남기는 범위 안의 N | 해당 없음. `owner_words`(RT:821-824) | — | 오너 튜플. 공시하고 `delivery_policy_valid` 모집단에서는 따로 셈 |
| 레퍼런스 실행 불가 | 다른 pool 레퍼런스(R11) | 낮은 튜플로 대체 금지 | — | typed hold `no_dispatchable_candidate:…`(RT:1053-1054). 알림에 오너 단어 선택지 제시 |
| 쿼터 소진 | 다른 pool 레퍼런스 | 위와 같음(`dispatchFailure`) | — | 위와 같음 |
| 새 모델 | 기존 레퍼런스 유지 | 새 모델만 격리. tier 없는 모델은 tier 라우팅이 고르지 않음(ModelTiers.swift:31-33, RT:695-700) | — | 정보성 exclusion `unclassified_model` + 결과마다 `reference_review_required` 알림. pool hold 없음(K14) |

---

## 4. 유료 실행 없이 생기는 절약, 무료 라벨, 인증

### 4.1 절약원 (쿼터 절감률은 모두 미검증. 판정은 D4 M4)

| 절약원 | 갈래 | 근거 | 성격 |
|---|---|---|---|
| zero-model 닫힌 문법(K7) | N | [이전측정] sqlite: `deterministic_arithmetic` 14건, `local_checkin` 9건(10-10~22). [측정] 작은 레퍼런스 attempt의 입력 중앙값 42,073 | 호출 1회 전액. 토큰은 측정, 쿼터는 추정 |
| H0 lean harness(출하됨) | H0 | [이전측정] 첫 요청 Codex 20–31K vs native 약 180K, Claude 21–30K vs 340–366K. [src pareto README 표] build 279: 입력 −86%, 판정 +0.225(build 277–281, 다른 라우팅) | 가장 큰 레버. parity 미검증(D4 arm ②) |
| byte-stable prefix·resume 동일 바이트·TTL(K15) | N | [추론] | 추정 |
| catalog 재사용(K8) | N | [이전측정] task당 약 6 s | 지연만 |
| planner 호출 생략(K3) | N | [이전측정] 10-23~24 planner 13회, 정착까지 30–127 s | 지연만. 쿼터 0(로컬) |
| 오너 계약·staged writer 하강 | Q | [이전측정] replay 35 node 중 9 node 하강, 모두 레퍼런스 고정. [측정] ledger에서 하강 `pass` 2건 | §1.3-4 조건이 맞을 때만 절약 |
| R11 pool 선택 | N | 라이브 quota 균형 | 가용성. 절감 계산에서 제외 |
| 검사 불가 하강 / 모델 분해 | Q / H | 인증 전 0 | — |

**[측정] 토큰 분포.**
- usage가 있는 attempt는 111건이다. 입력은 10,757,104 토큰이다(native 기준 cache 포함).
- 입력 100K 이하 96건이 입력 전체의 24.8%다.
- 입력 1M 초과 3건이 56.2%다.
- usage가 없는 attempt 11건은 incomplete다.

**[추론] 함의.**
- 작은 작업 라우팅(zero-model, 튜플 하강)이 건드릴 수 있는 것은 관측 입력의 약 25% 이하다.
- 큰 레퍼런스 작업을 줄이는 수단은 H0와 prefix뿐이다.
- 그래서 pool별 15%는 주로 **H0 parity(D4 arm ②)**에 달려 있다. H0가 parity에 실패하면 15% 경로는 모델별 쿼터 가중치(D4 M4)가 크게 다를 때만 남는다. 이 경우 달성 가능성은 불확실하다고 적는다.

### 4.2 지표 분리 (RT-03, RT-04)

| 지표 | 의미 | 쓰임 |
|---|---|---|
| M1 관측 토큰 | uncached / cached / write / output, 완전성(`accounting_complete`, `usage_unknown` [src resource-usage.mjs:41, 166-171]) | 기록 |
| M2 가격 proxy | PRICE-CARD 환산 | 추정 |
| M3 모델링된 native 반사실 CF | 반사실 계산 | 추정 전용 |
| M4 실제 구독 창 관측 | 같은 배치 전후의 quota window | D4 전용. 15% 판정은 M4로만 |

- 사용량을 모르는 attempt가 하나라도 있으면 그 task는 `incomplete`다. 절약 판정에서 빼고 개수를 따로 보고한다.
- 관측 최댓값을 대입하지 않는다. 검증된 상한이 있을 때만 별도 sensitivity lane에서 다룬다.

### 4.3 검사 노드가 보정 라벨을 공짜로 만드는 방법

- **현재.** `_outcomeSummary`는 `origin:'unknown', correctness_label:null, learning_eligible:false`를 고정으로 쓴다[src RT:5800-5809].
- **K9 이후.**
  - 하강한 attempt 중 exact, contract, `sound_full` verifier가 판정한 것만 라벨을 받는다: `{score_space:'check_acceptance_v1', check_id, soundness, outcome}`.
  - 레퍼런스, owner_words, class attempt의 라벨은 null로 남는다.
  - 라벨의 뜻은 "그 검사가 덮는 범위 안에서 받아들여졌다"이다. "레퍼런스와 같은 품질"이 아니다.
- **오프라인 보정(⑪).**
  - complete usage만 써서 층별 p의 Wilson 하한과 c를 계산한다.
  - 결과를 동결 비용 정책으로 내고, K10이 이 정책을 쓴다.
  - 보정이 바꾸는 것은 비용뿐이다. 품질은 검사 범위 안에서 답마다 지켜진다. 그래서 이 보정에는 유료 품질 평가가 필요 없다.
  - 대신 검사 범위 밖의 품질은 이 라벨로 주장할 수 없다(RT-02).
- **라벨 축적 속도.** [측정] ledger 122건(2026-10-14~24) 중 `verifier_outcome:'pass'`는 3건이다. 라벨은 천천히 쌓인다.

### 4.4 검사 불가 family의 인증 (NOT_RUN)

1. 오너가 예산을 승인한다.
2. D4 paired evaluation을 한다. 사전등록, final-lock, 독립 채점을 지킨다.
3. artifact로 인증서를 서명한다. 종류는 둘이다.
   - class 인증서: family × 튜플 × `harness_profile` × reference profile × 만료
   - plan-shape 인증서(K11b): 분해 모양 × family. 측정된 총자원이 단일 레퍼런스보다 작아야 한다.
4. host loader가 artifact를 확인한 경우에만 catalog에 싣는다(K11). 지금 `validClassCertificates`(RT:1911-1920)는 `measurement_sha256`의 형식만 검사한다.
5. 전달 basis는 `certified:class`로 표시한다. accepted_B는 측정된 상한까지만 말한다.

---

## 5. 변경 목록 (HEAD `3d62dad6` 기준)

**공통 사항**
- JS를 바꾸면 bridge SHA pin(LocalRouterBridge.swift:105-121) 갱신과 클라이언트 release가 필요하다.
- 새 signed execution profile은 없으므로 server-first rollout은 필요 없다.
- catalog 키를 바꾸면(K11b, K14) Swift `catalogShape`와 JS `validateCatalog`를 한 변경에서 함께 고친다.
- 새 테스트는 모두 `scripts/build-release.sh`의 테스트 목록(:90-135)에 추가한다.

**D1 필수 항목**

| ID | 파일·함수 | 동작 | 결정적 테스트(모델 0) | 롤백 |
|---|---|---|---|---|
| K1 | RT `admitBoundedAutoPlan` 1320-1368 | §2.3-1~6. 하강 bind에 재실행 예산 조건 추가(I1) | `openclaw-rcc-bounded-auto.test.mjs:184-190` 반전: 레퍼런스 부재 → hold, ticket 0. :63 "두 노드 실행"을 "plan-shape 인증서 없음 → 1노드 레퍼런스"로 갱신. 신규 `openclaw-rcc-one-law.test.mjs`: 실제 `adaptiveRuntimeOptions({pluginConfig:{bounded_auto:true}})`와 PL:622-642 옵션(`hostAutoPlan:true`, `maximumWorkers:4`, `maximumReadWorkersPerPool:4`) 사용. bounded, re-resolve, spread, calibrated 모든 경로에서 tier 노드는 `ladder.reference_candidate_id`를 갖고, 나머지는 frontier ceiling이거나 `owner_words`다. `execution_only` 0 | 이전 build(장애 시만. 검사 없는 전달이 다시 생김) |
| K2 | RT `executionPolicyChoice` 1295-1319 삭제. `_runTask` 4196-4205. `_reResolve` 4423. `_spreadAcrossPools` 4494 | 항상 `noDispatchableReason`. 저장된 `execution_only` child → `referenceOnly:true`. 옛 기록의 `execution_only`는 읽기만 허용 | 재시작 snapshot fixture: execution_only → 레퍼런스 행 | K1과 함께 |
| K3 | RT `_observeAdaptivePlan` 3804-3828. `adaptive-plan-host.mjs` `createPlannerHostProjection` 162-196 | 적용 가능한 sound_full 검사가 비었거나 plan-shape 인증서가 없으면 planner를 부르지 않는다(`adaptive_plan_skipped:no_admissible_check_or_shape`). 있으면 `check_ids`(지금은 `[]`, :184)에 verifier id를 싣는다. RT:3805의 registry 결합 제거 | verifier 0 → `proposeLocalPlan` 0회. verifier만 있음 → 0회. 둘 다 있음 → 1회 + `check_refs` 검증(local-plan-proposal.mjs:273) | gate 제거(Auto마다 30–127 s 대기 재발) |
| K4 | RT `verifiedSurfaceKinds` 778-781, `admittedRoute` (b) 843-844, `certifiedEntries` 870-871, `_nodeVerifier` 5883-5889, `certifiedAnswer` 2423 | registry 항목을 `{id, applies(node,task,catalog), verify, surfaces, soundness:'sound_full'\|'partial', scope}`로 바꾼다. 지금은 verifier 하나가 모든 read-only 노드를 인증한다(843-844). 앞으로는 `applies`가 참이고 `sound_full`인 노드만 인증하며 `certificate_id = verifier id`. `_nodeVerifier`는 `routeFamily`가 아니라 `ladder.certificate_id`로 조회한다. `certifiedAnswer('verifier')`는 무조건 true(2423)가 아니라 이 attempt의 pass 기록을 요구한다. partial verifier는 실패 신호로만 쓴다 | 적용 안 되는 노드 → reference. 적용되는 노드 → tier. verify 실패 → 레퍼런스 1회. **채택 시점 verifier 부재 → 폐기 후 레퍼런스(전달 금지)**. RT-02 등록 fixture 세 가지: (1) 합성 오답을 통과시키는 불완전 verifier는 등록 거부, (2) 다른 family의 node에는 `applies=false`, (3) 같은 설정의 합성 출력 2개(정답·오답) 중 수락된 것만 전달 | registry 비움(= 오늘) |
| K5 | RT `ownerExplicitParallelFor` 1257-1263, `_runTask` 4213-4215, `_readPoolEligible` 4599-4612, `_ticket` 5165-5176 | 새 술어 `ownerExplicitParallelEligible`: auto, objective===request, host scope read-only, `!ownerCollectionFor`, policy binding. bounded 플래그, `task_contract`, `class_certificates`, verifier, `require_native_ceiling`과 무관(지금은 boundedAutoEligible을 거쳐 이들에 묶임, RT:1250-1251, 1258). partition이 도출됐는데 `task_contract`가 있으면 typed hold `owner_partition_contract_conflict`. `ownerPartitionEnabled = this.hostAutoPlan`. eligibility는 prospective plan을 인자로 받는다. partition, plan, decisions, routes는 하나의 `_update`로 기록 | 각 경우 ticket 수 = unit 수 또는 typed hold, unit source coverage, `assertOwnerExplicitParallelPlan`(RT:1274) 통과: 재개된 Codex 대화 + 새 A/B, fresh, Claude, mixed provider, +class cert(unit 레퍼런스), +"최대 reasoning"(unit `owner_words` ceiling), +contract(hold) | 이전 조건 |
| K6 | `OS1App.swift` run argv(:8914 근처) | `--max-native-dispatches` typed cap 항상 전달(1–64, CT:1271) | `openclaw-rcc-native-budget.test.mjs`: cap 4 → 5번째 hold, refund/refill 없음. `test-native-budget-cli-wiring.py` | 이전에 검증된 typed-budget 구현, 또는 dispatch hold. **cap 없이 재실행 금지**(RT-10) |
| K7 | RT `withoutConversation` 2063-2116, `pureArithmetic`/`exactArithmeticQuestion` | (a) `priorMessageCount` 키가 없어도 `transcript===''`이고 나머지가 모두 비었으면 0으로 본다(지금은 키 부재를 대화로 봄, RT:2077). (b) 닫힌 산술 문법: 여러 연산자, 한·영 연산자 단어, 유한 소수 나눗셈. 수 단어는 받지 않는다. **첫날 zero-model 확장으로 필수** | `rcc-arithmetic-vectors.json`(node와 Swift 공용), envelope fixture, 기록 산술 task replay(기록 답 = exact 답) | 항목별 revert |
| K8 | RT 5079-5084 | bind 시점 catalog를 첫 dispatch에도 재사용. `admissionCurrent`·`_recheckCalibratedRoute` 유지 | refresh 카운터 fixture | revert |
| K9 | RT `_ledgerRecord` 5777-5799, `_outcomeSummary` 5800-5809 | `delivery_basis`, `check_id`, `check_outcome`, §4.3 라벨. JSONL에만 넣고 Swift wire는 바꾸지 않음 | `scripts/route-replay.mjs`의 `delivery_policy_valid` 감사. 합성 위반(검사 없는 tier 전달) → FAIL | 필드 제거 |
| K10 | RT `tierRouteCandidate` certified 분기, `joint-route-selector.mjs` 27/39-43/225 | §2.4. 새 score space `check_acceptance_probability_v1`. 동결 정책은 Core 옵션으로 받음. 정책 없음 또는 hash 불일치 → TIER_ROUTES | p가 낮으면 레퍼런스. 다노드·후속 턴 적용. hash 불일치 → 기본값. 선택 결과는 항상 F의 원소 | 정책 미등록(= 오늘) |
| K11 | RT `validClassCertificates` 1911-1920 + Swift catalog builder(:750-752) | 인증서는 D4 artifact를 host가 확인한 경우에만 적재 | builder fixture: artifact 없음·만료·범위 불일치 → 미적재 | 미적재 |
| K12 | CT `Result` 1115-1137·CodingKeys·`resultShape` 1974·`validate(Snapshot)` 1883-1890, RT `_partialResult` 3327, `publicSnapshot`, Gateway, UI | partial result v2: Request에 선택 필드 `result_contract_version`(없으면 1). v2에만 `partial{coverage{completed_node_ids, unresolved_node_ids}, parent{task_id, request_sha256, revision}, nodes[{node_id, attempt_id, output_sha256, native_receipt_sha256}]}`. held/failed/cancelled 상태의 result는 v2 partial일 때만 허용. v1 클라이언트는 지금 형태 유지 | 양방향 decode/encode differential. unknown/foreign/duplicate id. negotiation 부재. 옛 snapshot. parent가 끝나지 않은 partial | v1 |
| K13 | RT `_ticket` 5238-5249, CT 806/1617, MS 19725 | C3(parity 회복 주장) 철회. typed `delegation{max_children, child_tuple:'parent', cancel:'propagate', usage:'children_required', enforced}` 정의. native가 dispatch 전에 강제할 수 있을 때만 `allow_native_subagents`. Core는 자식을 별도 예산으로 셈(`_admitNativeDispatch`는 자동 자식을 세지 않음, RT:6067-6071 주석). 그전까지 managed 유지 | 자식 receipt 누락·초과 → incomplete/hold | 필드 제거(= 오늘) |
| K14 | Swift catalog builder, `ModelTiers.swift:39-47`, CT:306-308, RT:56-58 | C9 pool hold 철회. 새 모델은 그 모델만 격리하고 정보성 exclusion `unclassified_model`을 낸다. 두 허용 목록과 catalogShape fixture를 한 변경에서 함께 고친다. `noDispatchableReason`은 이것을 레퍼런스 부재로 보지 않는다. 전달마다 `reference_review_required` 알림 | negative fixture: 새 비frontier 모델, 미확인 frontier, 다른 pool, legacy catalog | revert |
| K15 | `main.swift`(C4) | N 항목만 기본: 같은 내용의 byte-stable prefix, resume 동일 바이트, TTL 상수. H 항목(순서 변경 C4a, 줄 삭제 C4d)은 `harness_profile` 버전 변경으로 묶고 parity 미검증 표시. chat lane 술어는 H0 profile의 일부로 버전에 포함 | builder byte-diff | 항목별 |
| K16 | `scripts/quota-replay.py`, `scripts/route-replay.mjs`(신규 스크립트, 런타임 무변경) | M1–M4 분리. unknown → incomplete. CF는 추정 라벨. 15% 판정은 M4에서만 | 합성: null usage → incomplete, 미전달 task 소비 포함, 분모 0 → FAIL | 스크립트 삭제 |

**D4 이후 항목**
- **K11b.** plan-shape 인증서 kind. catalog 키를 추가하므로 Swift·JS를 같이 고친다. 이게 생기기 전까지 K3의 planner 호출은 0회다.

**철회 목록**
- C2: bounded 끄기
- C8: 삭제 전부. `joint-route-selector.mjs`, `calibrated-route-*.mjs`, `offline-route-calibration.mjs`, `frozen-route-*`, `local-plan-*.mjs`, `adaptive-plan-host.mjs`를 남긴다.
- C9: pool hold
- C3: parity 회복 주장
- A1: "CF 상한 0.85 = 합격"
- usage-unknown을 관측 최댓값으로 대입하기
- "dev10 + heldout8이면 충분"
- "라우팅 accepted_B=0이 구성으로 보장" → `delivery_policy_valid`로 바꿔 씀
- "Claude A/B를 1노드로 합치기"

---

## 6. 단계별 gate

| 단계 | 내용 | 주장할 수 있는 것 | 주장할 수 없는 것 |
|---|---|---|---|
| **D1** 코드·fixture·replay(호출 0) | K1–K16 fixture. ledger·sqlite 사본 replay | 법칙 집행(`delivery_policy_valid`), hold 형식, cap, partial 계약, 기록 재집계(추정) | 품질 동등성, 쿼터 절감, native 연결 |
| **D2** 설치 앱(모델 호출 0) | K7 입력에서 dispatch 0, planner 0. route-only 승인 smoke(서버 승인만, dispatch 없음). 설치 bundle hash = 빌드 hash | "설치된 bundle X의 zero-model 경로는 호출 0이다" | native 연결, 품질 |
| **D3** 실제 native 왕복 — **NOT_RUN, 오너 승인과 RunCard 필요** | **IG-00**(K1/K2/K6 직후): 레퍼런스 튜플별 native worker 1개로 App→Core→native→App. typed cap 실측, cancel, quota 거절. **IG-01**(K5 직후): native worker 2개의 시간 overlap, partial/limit. **IG-02**: D4 전에 source·harness 동결(BP 51.1) | 연결, 전송, 회계가 동작한다 | 품질 동등성, 절감률 |
| **D4** 품질·쿼터 수락 — **NOT_RUN, 오너 승인·예산 필요** | 사전등록: family, rubric, margin, n 근거, final-lock, 독립 채점, **레퍼런스 대 레퍼런스 noise arm**. arm ①: native 레퍼런스(오너 설정, provider별 동결 reference policy, task마다 pool 고정)의 whole-task 수행 vs 같은 pool에 고정한 OS-1. arm ②: 같은 튜플의 H0 대 native(chat lane 포함), 즉 harness parity. arm ③: class·plan-shape 인증서 후보. M4는 동시 데스크톱 사용을 통제하고 관측 | **PASS = pool마다 M4 기준 arm ① 대비 15% 이상 절감 AND 사전등록 n에서 관측 accepted_B = 0.** 95% 상한과 reference-vs-reference 값을 함께 보고. 인증서 발급 | 측정 범위 밖 family로의 일반화. R11 균형 효과(절감에서 제외) |

**n 근거 [계산]**
- 실패 0건일 때 95% 상한은 다음과 같다: 0/8 → 31.2%, 0/18 → 15.3%, 0/59 → 4.95%.
- 따라서 dev10 + heldout8만으로는 accepted_B를 좁게 묶을 수 없다(RT-07).

**pool별 판정의 이유**
- 구독 창이 pool마다 따로 있어서 pool을 합친 합계는 단위가 정의되지 않는다.
- 모든 pool이 15% 이상이면 pool 배정을 고정한 상태에서 오너 기준("레퍼런스 전부 대비 15%" [기억 10-18])도 함의된다.
- 오너 원문에 "pool별"이라는 말은 없다(OBS-01). 그래서 설계 선택으로 표시한다.

---

## 7. 대응표

**Codex 레드팀**

| 출처 | 내용 | 해결 위치 |
|---|---|---|
| RT-01 | 동적 최적화를 reference-only로 바꿈 | §0-1·3, §1.2, §2.3, §2.4, K1·K3·K10, 철회 목록. 남은 이견 §8-1~3 |
| RT-02 | delivery basis ≠ accepted_B=0 증명 | §2.2, §1.3-5·6, K4 등록 fixture, §6 D4(noise arm) |
| RT-03 | 추정 CF를 쿼터 합격선으로 씀 | §4.2 M1–M4, K16, §6 D4 |
| RT-04 | 미지 사용량을 관측 최댓값으로 채움 | §4.2, K16 |
| RT-05 | 명시 병렬을 비용 때문에 합침, prospective plan | §3 오너 병렬 행, K5 |
| RT-06 | native subagent 허용 ≠ parity | K13, §6 D3 |
| RT-07 | zero-model 검사가 실제 gate를 대체함 | §6 D3(IG-00/01/02) NOT_RUN, n 근거 |
| RT-08 | partial 최소판의 wire·출처 결합 누락 | K12 |
| RT-09 | 새 모델이 pool 전체를 막음, reason 허용 목록 | §3 새 모델 행, K14 |
| RT-10 | rollback이 hard cap을 되돌림 | K6 |
| OBS-01 | 15% per pool의 출처 | §6 pool별 판정의 이유 |

**레드팀 리뷰 지적**

| 출처 | 내용 | 해결 위치 |
|---|---|---|
| 리뷰 criteria-1, objective-2 | 첫날이 reference-only | §0-3, §1.2, K7 필수, §8-1·2 |
| criteria-2, objective-1 | S2 분해는 절감 불가 | §1.3-1, §2.3-5(c), K3, K11b |
| criteria-3 | 공동 선택기 잠금 | §2.4, K10 |
| criteria-4, objective-8 | 인증서·계약이 있으면 오너 병렬 붕괴 | K5 |
| criteria-5 | 검사 수락 과장 | §4.3, K4 |
| criteria-6, objective-3 | 이견 목록 없음 | §8, residual |
| criteria-7 | provider 간 레퍼런스 | §1.1 |
| criteria-8 | D3 순서 | §6 IG |
| criteria-9 | `c_check`·버전 협상 | §1.3-4, K12 |
| objective-4 | chat lane 불일치 | §1.1, K15 |
| objective-5 | accepted_B 수락 누락 | §6 D4 PASS |
| objective-6 | 15%가 H0에 의존 | §4.1 |
| objective-7 | I2 조회 결합 | K4 |

**오너 발언**

| 출처 | 내용 | 해결 위치 |
|---|---|---|
| 2026-10-13 | 최상 품질 + 적은 쿼터 [기억] | §1.1 Q 규칙, §2.2 I2, §6 D4 |
| 2026-10-14 | "1+1에 astra max 말이 안 된다" / trivial→fast | K7 / §8-1 |
| 2026-10-18 | "돌리기 전에 알아야", "다 최강이면 망해", 옵션 3, 15% + accepted_B 0 [기억] | §1.2, §2.1(bind 시점 결정), §8-1·3, §6 D4 |
| 2026-10-19 | 품질 생성은 레퍼런스, 검사 가능한 곳만 하강, 동등 레퍼런스는 quota 희소성으로, 두 arm 측정 [기억]. "다 검사장치" [브리프] | §1.1, §2.4, §3 산문 행, §6 D4 |
| 오너 | "돈 나오는 거 하지 마. 시뮬레이션으로" | D1·D2만 지금, D3·D4는 NOT_RUN |
| 오너 | "단순할수록" | 법칙 하나, 새 서브시스템 없음, K11b 연기 |
| 2026-10-24 | "둘이 맞춰서 정답을 찾아" | 이 문서 전체 + §8 |

**BP 행별 대조**

| BP 항목 | 판정 | 이유 |
|---|---|---|
| 00.2-1·2·4~7 | 채택 | — |
| 00.2-3, 51.3 "미측정이면 초기 정책" | 수정 | 초기 정책 = 검사 가능 하강 + 검사 불가 품질 생성은 레퍼런스. 미측정 저가 전달은 거부(§8-1) |
| 10.4 1~4·6~8 | 채택 | — |
| 10.4-5 "미측정 bounded 선택" | 수정 | N/H0 선택과 인증 행 안에서만 |
| 51.1 IG 순서 | 채택 | D3 |
| 60.2 품질 허용 경로 | exact/full checker·calibrated 채택, "unmeasured policy" 전달 거부 | 자원 회계 규칙은 채택(K16) |
| 60.3 | TARGET 1 거부(K2), TARGET 2 채택(K10·K11), TARGET 3 = plan-shape(K11b·D4) | — |
| 60.4·60.5 | 채택 | K9, D4 |
| 60.6 | 채택 | D4 provider별 동결, R11 고정 |
| DD-SYS-14 (ledgers/design-decisions.json:197) | 부분 채택 | "가짜 confidence → cheap cert 금지" 채택. "기록 없음 → 전부 max 금지"는 '전부 max'가 아님을 근거로 응답(§1.2). bounded unmeasured 전달은 거부(§8-1) |

---

## 8. 남은 이견 (오너 결정 질문 포함)

1. **검사 없는 저가 전달.**
   - Codex: DD-SYS-14와 BP 60.3 TARGET 1에 따라 허용한다.
   - 오너의 이전 발언도 허용 쪽이다: 10-14 trivial→fast/low + REVAS, 10-18 옵션 3.
   - Claude: 차단한다.
   - **판정: 오너 목적에 따라 차단(K2).** 근거는 셋이다.
     - 오너의 최신 발언(10-19): 검사 가능한 곳만 하강하고 품질 생성은 레퍼런스에 둔다.
     - 수락 기준 accepted_B 0.
     - REVAS 실패 신호 `tierFailureSignal`(RT:2405-2407)은 빈 출력과 오류만 잡는다. 비어 있지 않은 오답은 잡지 못한다.
   - 브리프의 "uncertified cheap routing accepted_B 3/10"은 기록에서 찾지 못했다. 찾은 3/10은 같은 설정의 noise floor다. 그래서 근거로 쓰지 않는다.
   - **질문.** "request class별로 '품질 미측정' 저가 실행을 허용하는 설정을 둘까? 기본은 꺼짐. 켜면 `owner_words` 모집단으로 공시하고 `delivery_policy_valid`에서 따로 센다."
2. **첫날 동작.** 검사할 수 없는 비exact 작업은 레퍼런스로 간다. 이것은 두 쪽이 합의한 사실이다.
   - Claude의 해석: 이것은 10-18에 기각된 "원장이 증명할 때까지 레퍼런스"가 아니다. 통계를 기다리지 않고 사전 성질인 검사 가능성으로 결정한다. 첫날 절감 레버는 입력 쪽이다(출력은 관측 토큰의 1.7% [측정]).
   - **질문.** "D4 첫 예산을 H0 parity(arm ②)에 먼저 쓸까, class 인증서 후보(arm ③)에 먼저 쓸까?" 권장은 arm ②다. 15% 경로가 여기에 달려 있다(§4.1).
3. **모델 분해와 frontier planning.**
   - 분해 모듈은 배선된 채로 비활성이다(K3, K11b). 절감을 측정하기 전에는 coverage를 지키는 최종 노드가 일을 다시 하기 때문이다.
   - 오너 옵션 3의 "큰 작업은 frontier planning-only 호출"은 HEAD에 없다. 제안 역할은 로컬 planner가 쿼터 0으로 맡는다. frontier planner는 D4 arm 후보로만 둔다.
4. **accepted_B=0의 문자 그대로 기준.**
   - 같은 설정 noise floor가 3/10이다[src pareto README:16]. 그래서 레퍼런스를 재실행해도 0이 아닐 수 있다.
   - **질문.** "문자 그대로 0을 요구할까, 아니면 'reference-vs-reference 기준치 이하'로 둘까?" 기본은 둘 다 보고하고, PASS는 문자 그대로 0으로 판정한다.
5. **15% 범위.** 오너 원문은 "레퍼런스 전부 대비"다. 이 문서는 pool별로 판정한다(구독 단위가 pool마다 다름). 이것은 설계 선택이다.
6. **새 frontier 모델 미분류 동안.** 옛 레퍼런스가 계속 돈다(RT-09 수용). 그동안 "최신 최고 모델" 정의(H1)를 어길 수 있다. 결과마다 `reference_review_required` 알림을 붙여 드러내고, 오너가 데이터를 갱신하면 해소된다.
7. **레퍼런스 부재 시 동작 변화.** 오늘은 bounded가 저가 행으로 실행한다(test :184-190). 앞으로는 typed hold가 되고 알림에 오너 단어 선택지를 보여준다. 오너가 체감하는 동작 변화다.
