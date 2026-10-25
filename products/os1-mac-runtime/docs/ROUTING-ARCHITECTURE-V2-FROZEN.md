# OS-1 라우팅 아키텍처 v2 — 동결본 (2026-10-24)

## 동결 기록

- **동결 지시.** 오너, 2026-10-24: "그럼 그 구조로 아키텍처 동결하고 구현 시작해".
- **동결 대상.** 아래 본문인 v2 수렴안(Claude ↔ Codex 합의안)이다. 기준 소스는 `os1/live-routing-20261023` HEAD `3d62dad6`이다. 원본은 `/Users/LUA/Documents/Codex/artifacts/OS1_ARCH_20261024/OS1_CONVERGED_ROUTING_ARCHITECTURE.md`이고, 본문은 그 바이트 그대로 붙였다.
- **동결 뒤 바꾸는 방법.** 오너의 명시 지시가 있거나, D3/D4 측정 artifact가 본문의 가정을 깰 때만 바꾼다. 바꿀 때는 이 기록에 변경 항목, 근거, 날짜를 추가한다.

### §8 오너 질문 기본값 (오너가 따로 정하기 전까지 적용)

1. **검사 없는 저가 전달.**
   - 꺼짐. request class별로 켜는 설정은 만들지 않는다.
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

| 항목 | 상태 | 브랜치·커밋 |
|---|---|---|
| K1 `admitBoundedAutoPlan`을 법칙 아래에 둠 | 구현, D1 fixture 통과 | `os1/one-law-20261024` |
| K2 `executionPolicyChoice` 삭제, `_runTask` 우회 삭제, `_reResolve`·`_spreadAcrossPools` 법칙화, 옛 `execution_only` child → 레퍼런스 | 구현, D1 fixture 통과 | `os1/one-law-20261024` |
| 부수: 행 선택에 `permission_profile === scope` 조건 추가, 미래 시각 telemetry를 dispatch 불가로 처리 | 구현 | 같은 커밋 |
| K6 App의 새 제출마다 `--max-native-dispatches 16`을 생성 시점에 고정해 `os1 run` argv로 전달(`RCCRunBudgetOptions.appNativeDispatches`, `PendingSubmission.maxNativeDispatches`). 이전 빌드가 저장한 제출은 retry·재시작에서도 cap 없음(nil)을 유지한다: budget은 Core 제출 fingerprint의 일부라서 같은 task ID에 cap을 더하면 idempotency_conflict로 그 결과가 고아가 된다. cap 도달은 typed hold(`native_dispatch_budget_exhausted`)이고 더 싼 전달이 아니다. 직접 CLI 실행에서 플래그가 없으면 여전히 legacy nil. 부수(RT settle): held 정산은 검증이 받아들이지 않은 certified descent 출력을 partial에 넣지 않고, owner collection의 control unknown은 어느 자식이 먼저 hold되었든 task 전체를 결과 없이 hold한다 (이전에는 앞선 형제가 다른 이유로 먼저 hold되면 뒤쪽 control-unknown descent의 미수락 출력이 returned_unverified로 전달됐다) | 구현, D1 fixture 통과(cap 4 → 5번째 hold·refund/refill 없음, 8 obligation에서 cap 16·null → 8 node, 15 → 1 node, 앞선 pre-dispatch hold + 뒤쪽 control-unknown descent → held·result null, App self-test: 새 제출 16 고정, 이전 빌드 항목은 같은 ID로 cap 없이 retry). D3 IG-00 typed cap 실측은 NOT_RUN. 참고: 16 = 2×8은 Core의 plan 시점 적격 조건(ownerCollectionPlanEligible의 cap ≥ 2×obligation, _calibratedContext의 여유 ≥ 2)과만 일치한다. descent bind 시점에 cap 여유를 읽는 조건은 없으므로 I1의 노드당 재실행 여유는 보장되지 않는다: cap은 무과금 ladder descent와 무료 사전 실행 거부까지 모든 native dispatch를 세므로, 뒤쪽 노드의 descent가 여유 2 미만으로 bind된 뒤 `native_dispatch_budget_exhausted`로 hold될 수 있다(fail-closed). bind 시점 여유 조건은 K1/I1의 미해결 항목. handback·repair_source가 pending descent의 수락 검사를 건너뛰는 I2 구멍은 K4(D5) 몫 | `os1/one-law-20261024` |
| K13 C3(native 하위 에이전트 parity 회복 주장) 철회. C3는 구현된 적이 없다(Core는 `allow_native_subagents`를 한 번도 넣지 않았다). 거짓 주장은 CT `ExecutionTicket.allowNativeSubagents` 주석과 MS RCC native adapter 주석에서 철회. CT `validate(ExecutionTicket)`는 모든 surface에서 `true`를 거부(decodeTicket도 같음, dispatch 전 실패). MS는 `managedDelegation.withValue(true)`로 고정. typed `delegation{max_children, child_tuple:'parent', cancel:'propagate', usage:'children_required', enforced}`는 주석으로만 예약(wire·ticketShape 변경 없음) | 구현, D1 fixture 통과(C3 trigger 모양인 Auto·단일 노드·Codex 레퍼런스·재개 세션, Claude 레퍼런스, 검증 실패 descent → escalation: 모든 ticket에 flag·delegation 없음. Swift: false는 managed로 통과, true는 decode·validate 모두 거부). 켜려면 D3 adapter 능력 증거(CLI로 확인), record의 자식 receipt 필드, Claude 하위 에이전트 usage 읽기가 필요하다. 자식 receipt 누락·초과 → incomplete/hold fixture는 그 채널이 생긴 뒤에만 가능(이번 범위 밖). harness parity(H0 vs native)는 미검증 | `os1/one-law-20261024` |
| K3–K5, K7–K12, K14–K16 | 미착수 | — |
| D2 설치 앱 확인 | 미실행 | — |
| D3 native 왕복, D4 품질·쿼터 수락 | **NOT_RUN** (오너 승인, RunCard, 예산 필요) | — |

`delivery_policy_valid`(검사 없는 저가 전달 0)는 D1 fixture로만 확인했다. 실제 품질 동등성과 쿼터 절감은 아직 측정하지 않았다.

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
