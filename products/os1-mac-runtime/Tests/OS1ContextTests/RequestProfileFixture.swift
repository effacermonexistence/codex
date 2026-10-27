import Foundation
import OS1Context

/// Build 441 (owner order, 2026-10-27): the host's deterministic request
/// profile. Pure: request text and host facts only; no model, provider or
/// network. The Core side (graded admission on Swift-built catalogs) is in
/// `RCCAdmissionFactsFixture`.
func runRequestProfileFixtures() throws {
    typealias P = RequestProfile
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "RequestProfileFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    func profile(_ text: String, shell: Bool = false, material: Bool = false) -> P {
        P.classify(text, shellNeed: shell, hasMaterial: material)
    }
    func show(_ value: P) -> String {
        "\(value.answerKind.rawValue)/\(value.toolNeed.rawValue)/\(value.difficulty.rawValue) \(value.signals)"
    }
    if ProcessInfo.processInfo.environment["OS1_REQUEST_PROFILE_PRINT"] == "1" {
        for line in (ProcessInfo.processInfo.environment["OS1_REQUEST_PROFILE_TEXTS"] ?? "").split(separator: "\n") {
            print(show(profile(String(line))) + "  <= " + line)
        }
    }

    // ---- The owner's general explanations: answer-only, no tool, standard.
    // The trace request (task 4c836d82) and its spellings, in every ending.
    let standard: [String] = [
        "슈뢰딩거 방정식 설명해봐", "야, 쇼레든거 방조식 설명해봐", "뉴턴 운동법칙 쉽게 설명해줘",
        "파이썬 list와 tuple 차이 설명해봐", "Explain the difference between TCP and UDP.",
        "Swift에서 actor reentrancy가 왜 생겨?",
    ]
    for text in standard {
        let value = profile(text)
        try check(value.answerKind == .answerOnly && value.toolNeed == .none && value.difficulty == .standard &&
                  value.gradable && value.valid, "standard answer: \(text) -> \(show(value))")
    }
    // Stability: the ending, politeness and "?" never change the profile.
    for (stem, endings) in [
        ("뉴턴 운동법칙 쉽게 설명", ["해봐", "해줘", "해 주세요", "해줄래?", "해", " 좀", " 좀 해줘", "해 줘", "해봐?", "해줘?",
                             "해 주세요?", "해줄래", "해?", " 좀?"]),
        ("슈뢰딩거 방정식 설명", ["해봐", "해줘", "해 주세요", "해줄래?", "해", " 좀", "해봐?", "해줘?"]),
        ("슈뢰딩거 방정식이 뭐", ["야?", "야"]),
    ] {
        let profiles = endings.map { profile(stem + $0) }
        try check(Set(profiles.map(show)).count == 1,
                  "the same content gives one profile in every ending: \(stem) -> \(Set(profiles.map(show)))")
    }
    // A short definitional question is light; an explanation is standard.
    for text in ["슈뢰딩거 방정식이 뭐야?", "co가 무슨 뜻이야?", "엔트로피의 의미가 뭐야", "What is entropy?"] {
        let value = profile(text)
        try check(value.answerKind == .answerOnly && value.toolNeed == .none && value.difficulty == .light && value.gradable,
                  "light: \(text) -> \(show(value))")
    }
    // Deep: a proof, derivation, design, review, rigor marker, a long or
    // multi-part request, a list or a code block (never the topic).
    for text in ["슈뢰딩거 방정식을 엄밀하게 유도해줘", "피타고라스 정리를 증명해봐", "이 두 접근을 심층 비교해줘 장단점까지",
                 "Prove that sqrt(2) is irrational.",
                 "X가 뭐야? Y는 왜 그래? Z랑 비교해줘", "다음을 설명해줘:\n1. 엔트로피\n2. 엔탈피",
                 "설명해줘 ```let x = 1```", String(repeating: "양자역학의 해석 문제를 설명해줘. ", count: 12)] {
        let value = profile(text)
        try check(value.difficulty == .deep && !value.gradable || value.answerKind != .answerOnly,
                  "deep or not an answer keeps the reference: \(text.prefix(40)) -> \(show(value))")
    }
    for text in ["피타고라스 정리를 증명해봐", "슈뢰딩거 방정식을 엄밀하게 유도해줘", "Prove that sqrt(2) is irrational."] {
        let value = profile(text)
        try check(value.answerKind == .answerOnly && value.difficulty == .deep, "a proof or derivation is a deep answer: \(text)")
    }
    // Topic never raises difficulty: science and code topics stay standard.
    try check(profile("양자 얽힘 설명해줘").difficulty == .standard && profile("파이썬 데코레이터 설명해줘").difficulty == .standard,
              "a science or programming topic alone is standard")

    // ---- Not gradable: work, tools, files, current facts, prior artifacts.
    let notGradable: [(String, P.ToolNeed?)] = [
        ("그럼 실제로 해봐", nil), ("그럼 실제로 해봐 다 되는지 하나씩 하나씩 4개 다 해봐", nil),
        ("README.md 설명해줘", .workspace), ("/tmp/report.txt 설명해줘", .workspace),
        ("이 함수 설명해봐", .workspace), ("아까 그거 설명해줘", .workspace), ("그게 왜 그래?", .workspace),
        ("이 코드 설명하고 고쳐줘", .write), ("로그 확인해봐", .workspace), ("빌드 설명해줘", .workspace),
        ("OS1 라우팅 설명해줘", .workspace), ("codex 쿼터 얼마 남았어?", .workspace),
        ("오늘 환율 설명해줘", .currentFacts), ("최신 아이폰 가격 알려줘", .currentFacts),
        ("비트코인 시세 왜 떨어졌는지 설명해줘", .currentFacts),
        ("R2 연결 설명해줘", .workspace), ("왜 안 돼?", .workspace), ("설치됐어?", .workspace), ("너 되냐?", .workspace),
        ("슈뢰딩거 방정식 설명해서 파일에 저장해줘", nil), ("슈뢰딩거 방정식 설명해봐 그리고 실행해봐", nil),
        ("다음 문장을 영문으로 번역해줘: 왜 그는 떠났을까?", nil), ("Fix the failing test in the repo", nil),
        ("Run the nightly job now", nil), ("Write a haiku about autumn.", nil), ("구매해줘 그리고 설명해줘", nil),
    ]
    for (text, tool) in notGradable {
        let value = profile(text)
        try check(!value.gradable && !value.answersWithoutTools && (tool.map { value.toolNeed == $0 } ?? true) && value.valid,
                  "keeps the reference: \(text) -> \(show(value))")
    }
    // A bare pro-verb with no content stem is work, never an answer.
    try check(profile("그럼 실제로 해봐").answerKind == .work, "a bare pro-verb is work")
    // Host facts: a shell need or attached material is never answer-only.
    try check(profile("슈뢰딩거 방정식 설명해봐", shell: true).toolNeed == .shell &&
              !profile("슈뢰딩거 방정식 설명해봐", shell: true).answersWithoutTools &&
              profile("슈뢰딩거 방정식 설명해봐", material: true).toolNeed == .workspace &&
              !profile("슈뢰딩거 방정식 설명해봐", material: true).answersWithoutTools,
              "the host's shell and material facts keep the reference")

    // ---- The conflation fix: an imperative after a communicative stem is
    // not work for the profile; the bare ending and any other stem stay
    // work. The native lane predicates keep `asksForWork` as it was (a
    // "?"-ended "…설명해줘?" never reaches the native chat lane).
    for text in ["슈뢰딩거 방정식 설명해봐", "설명 좀 해줘", "둘 비교해줘", "다시 말해봐", "정의해 줘", "피타고라스 정리를 증명해봐"] {
        try check(!ClaudeChatLane.asksForWorkBeyondAnswer(text), "an explanation imperative is not work: \(text)")
        try check(ClaudeChatLane.asksForWork(text) && ClaudeChatLane.asksForWork(text + "?"),
                  "the native predicate's work reading is unchanged: \(text)")
    }
    for text in ["그럼 실제로 해봐", "실행해봐", "정리해줘", "이거 고쳐줘", "방금 그거 다시 해줘", "설명해봐 그리고 실행해봐",
                 "거짓말해봐", "그래서 했냐고"] {
        try check(ClaudeChatLane.asksForWorkBeyondAnswer(text) && ClaudeChatLane.asksForWork(text), "work stays work: \(text)")
    }
    for text in ["왜 그런지 설명해줘?", "어떻게 하는 건지 설명해줘?", "차이 설명해줘?"] {
        try check(!ClaudeChatLane.conversationalQuestion(text) && !ClaudeChatLane.readOnlyQuestion(text),
                  "a \"?\"-ended explanation imperative is not a native conversational question: \(text)")
    }

    // ---- Review of build 441 (2026-10-27): each kept the reference before
    // the profile was tightened. An order of any kind is work: writing the
    // answer down, placing it, delivering it, defining a code object.
    for text in ["슈뢰딩거 방정식 설명 정리해서 노션에 올려줘", "슈뢰딩거 방정식 설명을 노트에 적어줘",
                 "슈뢰딩거 방정식 설명을 메모에 남겨줘", "슈뢰딩거 방정식 설명 구글 독스에 써줘", "슈뢰딩거 방정식 설명하는 PPT 짜줘",
                 "Explain the Schrödinger equation and email it to Sebastien",
                 "Explain the Schrödinger equation and post it to Notion",
                 "Explain the Schrödinger equation and save it as a note", "주석으로 설명 달아줘", "PR 설명 써줘",
                 "README 설명 적어줘", "차이점 정리해서 올려줘", "User 타입 정의해줘", "enum 정의해줘", "상수 정의해줘",
                 "팀장한테 말해줘", "메일로 설명해줘", "팀원들한테 설명해줘", "민주주의가 왜 중요한지 에세이 써줘"] {
        let value = profile(text)
        try check(value.answerKind == .work && !value.answersWithoutTools && !value.gradable && value.valid,
                  "an order keeps the reference: \(text) -> \(show(value))")
    }
    // Current facts: the chat lane's lookup words, a year, a versioned name.
    for text in ["What is the current exchange rate between USD and KRW?", "엔비디아 시가총액이 얼마인지 알려줘",
                 "애플 신제품 발표 내용 알려줘", "What's the newest version of Swift?", "미국 대통령이 누군지 알려줘",
                 "What's the population of Seoul now?", "이번 주 OpenAI 발표 내용 알려줘", "작년 노벨 물리학상이 뭐야?",
                 "요새 유행하는 밈 설명해줘", "macOS 27 업데이트가 뭐야?", "GPT-6.1 출시 내용 설명해줘",
                 "2026년 노벨 물리학상 수상 이유 설명해줘", "Explain the new iPhone 17 features"] {
        let value = profile(text)
        try check(value.toolNeed == .currentFacts && !value.gradable, "current facts keep the reference: \(text) -> \(show(value))")
    }
    // The workspace's own state, code and systems, OS-1 in its ASR
    // spellings, and the owner's projects need the agent that can read them.
    for text in ["변경사항 설명해줘", "작업 내용 설명해줘", "PR 설명해줘", "에러 메시지 설명해줘", "explain the error",
                 "Explain what changed in the PR", "라우팅 규칙이 뭐야?", "쿼터 계산 방식이 뭐야?", "모델 선택 기준이 뭐야?",
                 "오에스원 라우팅이 어떻게 동작하는지 설명해줘", "알씨씨 레바스 원리 설명해줘", "REVAS가 뭐야?",
                 "Daybreak가 뭐야?", "OmarAGI 사업 전략 설명해줘", "API 스키마 정의해줘"] {
        let value = profile(text)
        try check(value.toolNeed == .workspace && !value.answersWithoutTools, "workspace material: \(text) -> \(show(value))")
    }
    // A reference to an earlier turn of this conversation.
    for text in ["네가 전에 말한 방법 다시 설명해줘", "Explain what you said before in simpler terms",
                 "너가 마지막에 한 답변 무슨 뜻이야?", "우리가 얘기한 라우팅 설계 다시 설명해줘", "왜 그런지 설명해줘?",
                 "왜 그렇게 되는지 설명해줘"] {
        let value = profile(text)
        try check(value.toolNeed == .workspace && value.signals.contains("deictic") && !value.gradable,
                  "a prior turn keeps the reference: \(text) -> \(show(value))")
    }
    // Deep: a deliverable, an exact computation, the owner asking for the
    // strongest model or more thinking, three asks however joined, inline
    // code, and step-by-step in other words.
    for text in ["think hard and explain TCP congestion control", "Can you write an essay explaining why the Roman Empire fell?",
                 "How do I implement a red-black tree in Rust? Give me the full implementation.",
                 "Rust로 레드블랙트리 전체 구현 어떻게 하는지 알려줘", "∫ x sin x dx 어떻게 풀어?",
                 "Solve the integral of x*sin(x) and explain each step",
                 "양자역학이 뭔지, 상대성이론이 뭔지, 그리고 둘의 차이를 설명해줘",
                 "양자역학이 뭔지 상대성이론이 뭔지 그리고 둘의 차이를 설명해줘",
                 "Explain what quantum entanglement is, how it differs from classical correlation, and why it matters for cryptography",
                 "Explain the Schrödinger equation one step at a time", "슈뢰딩거 방정식 하나하나 차근차근 설명해줘"] {
        let value = profile(text)
        try check(value.answerKind == .answerOnly && value.difficulty == .deep && !value.gradable,
                  "deep keeps the reference: \(text) -> \(show(value))")
    }
    for text in ["제일 똑똑한 모델로 TCP 혼잡 제어 설명해줘", "가장 좋은 모델 써서 TCP 혼잡 제어 설명해줘",
                 "use your best model to explain TCP congestion control",
                 "def fib(n): return n if n < 2 else fib(n-1) + fib(n-2) 어떻게 동작하는지 설명해줘",
                 "1부터 1000까지 소수의 합이 얼마인지 계산해서 알려줘"] {
        try check(!profile(text).gradable, "never graded: \(text) -> \(show(profile(text)))")
    }
    // ... and none of this reaches an ordinary explanation.
    for text in ["5살 아이에게 설명하듯이 양자역학 설명해줘", "뉴턴 운동법칙 쉽게 풀어서 설명해줘", "X와 Y의 차이가 뭔지, 왜 중요한지 설명해줘",
                 "양자역학이 왜 어려운지 설명해줘", "TCP 혼잡 제어 자세히 설명해줘"] {
        let value = profile(text)
        try check(value.answerKind == .answerOnly && value.toolNeed == .none && value.difficulty == .standard && value.gradable,
                  "an ordinary explanation stays standard: \(text) -> \(show(value))")
    }

    // ---- Wire: Codable round trip and the structural rules.
    let sample = profile("슈뢰딩거 방정식 설명해봐")
    let bytes = try RCCRuntimeContract.encode(sample)
    let object = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
    try check(Set(object.keys) == ["schema", "policy", "answer_kind", "tool_need", "difficulty", "signals"] &&
              object["schema"] as? Int == 1 && object["policy"] as? String == "host_profile_v1" &&
              object["answer_kind"] as? String == "answer_only" && object["tool_need"] as? String == "none" &&
              object["difficulty"] as? String == "standard", "the wire keys and values: \(object)")
    try check(try JSONDecoder().decode(P.self, from: bytes) == sample, "the profile round-trips")
    var bad = sample; bad.difficulty = .unknown
    try check(!bad.valid, "an answer always has a difficulty")
    bad = sample; bad.answerKind = .work
    try check(!bad.valid, "work never has a difficulty")
    bad = sample; bad.signals = ["b", "a"]
    try check(!bad.valid, "signals are sorted")
    bad = sample; bad.signals = ["Answer"]
    try check(!bad.valid, "signals are lower-case tokens")
    bad = sample; bad.policy = "host_profile_v2"
    try check(!bad.valid, "an unknown policy is not this profile")

    print("Request profile (441): \(checks) checks PASS; provider calls 0")
}
