import Foundation
import OS1Context

/// Owner, 2026-10-02, after a domain-name conversation that ran every turn on
/// the full Codex agent: "이렇게 간단한 채팅이면 쿼터 안 쓰는 걸로 라우팅해야
/// 정상 아님?". A short question answered from the conversation takes the chat
/// lane; anything that may need the machine, the web or current facts keeps
/// the agent. The texts are the owner's own, from that conversation.
func runConversationalQuestionFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Conversational question: " + message); count += 1
    }
    for question in [
        "아니 유성 코는 무슨 뜻인데 도대체?",
        "그게 무슨 말이야?",
        "왜 그렇게 생각해?",
        "둘 중에 뭐가 더 나아?",
        "what does co mean?",
        // Build 355's exact misroute and composed bilingual/ASR variants: a
        // self-check announcement is not an instruction to launch an agent.
        "야 나 한번 체크해 볼게. 너 되냐?",
        "너 잘 되냐",
        "한번 체크해보자 되냐",
        "야 나 한번 체크해볼게 너 되냐",
        "Hey, let me check. Are you working?",
        "let me check are you working",
    ] {
        check(ClaudeChatLane.conversationalQuestion(question), "chat lane: \(question)")
    }
    for request in [
        "아니 일단 가능한 도메인 주소를 다 줘봐 인마.최대한 간단하고 단순해야 돼.그럼 무조건 닷컴으로끝나야 돼.",
        "u-sung.com야 너 비싸다. 이걸로 하자. 왜 이렇게 비싸?",
        "쓰고 있으면 다른 거 하자. 다른 거 좀 줘봐. 짧고 단순한 거. 근데 무조건 닷컴이어야 돼.",
        "야 이거 봐봐. 라우팅이 다 왜 코덱스로 되냐?",
        "usung.com 얼마야?",
        "오늘 날씨 어때?",
        "GPT-6 언제 나왔어?",
        "이 버그 왜 생겨?",
        "README.md는 무슨 뜻이야?",
        "그럼 실제로 해봐 다 되는지",
        "OS1 왜 이렇게 느려?",
        "이거 무슨 뜻이야?",
        "유성 코는 무슨 뜻이야?\n그리고 다른 것도 알려줘",
        // Replay of the owner's 369 OS-1 messages: orders that contain a
        // question word, and questions about the state of real work.
        "Continue from where you left off.",
        "이상한 바운더리 문장도 다 빼! 아 우리는 유니버셜... 업리프트를 주장하는게 아니냐 뭐 시발 그런 문장을 왜 넣어!",
        "그래서 챕터를 다 올린거야?",
        "뭐하는데 빨랑해 빨랑해 뭐하는데",
        "그러면 QMGR 통합하려면 어떻게 해야 되는데 스키마 짜봐 Objective function은 QMGR 통합이야",
        "거기서 QM이랑 GR 통합하는 자료가 있거든? 가져와봐",
        "유성 코는 무슨 뜻인지",
        "야 너 한번 체크해봐. 되냐?",
        "너 잘 되냐? 터미널에서 실제로 확인해줘",
        "Are you working? Can you run a shell check?",
        "야 나 한번 체크해 볼게. 서버 되냐?",
    ] {
        check(!ClaudeChatLane.conversationalQuestion(request), "agent keeps: \(request.prefix(40))")
    }
    check(!ClaudeChatLane.conversationalQuestion(String(repeating: "왜 그래? ", count: 40)), "a long message keeps the agent")
    // Classification consumes the current objective, never old routing output.
    // The same availability turn stays chat-shaped after a previous full-agent
    // task; the native wiring additionally verifies detachment and read scope.
    let previousAgentContext = "assistant: Claude Code / Fable 5.1 / max; inspect source and run a tool call."
    let currentCheckIn = "야 나 한번 체크해 볼게. 너 되냐?"
    check(!ClaudeChatLane.conversationalQuestion(previousAgentContext), "prior work context does not itself qualify")
    check(ClaudeChatLane.conversationalQuestion(currentCheckIn) && StatusCheckIn.answersFromCard(currentCheckIn),
          "current objective stays a check-in independent of prior agent route")
    // 2026-10-02: a question that changes nothing runs on the read-only agent
    // (web lookups, no write authority, no OS-1 source lock); the domain
    // conversation's questions ran write-authorized and waited behind a repair.
    for question in [
        "아니 유성 코는 무슨 뜻인데 도대체?",
        "아니 그런 회사가 어딨어? 아니 대기업 중에 마지막에 CO를 붙이는 그런 회사가 있다고?\\",
        "일단은 글로벌해야 되고 대기업 웹페이지 문법을 따라야 되는데?\\",
        "별로 마음에 안 드는데 다른 거 없을까?",
        "usung.com 얼마야?",
        "그래서 챕터를 다 올린거야?",
        "README.md 무슨 내용이야?",
    ] {
        check(ClaudeChatLane.readOnlyQuestion(question), "read-only question: \(question.prefix(40))")
    }
    for request in [
        "아니 그게 아니라 뭐 스퀘어스페이스나 고데리 닷컴 가서 하나 사자고, 씨발.",
        "u-sung.com야 너 비싸다. 이걸로 하자. 왜 이렇게 비싸?",
        "그럼 도메인으로 쓸 수 있는 거 예시 좀 줘봐.",
        "usungcorp.com이걸로 하자.",
        "아 씨발놈아 해라고.",
        "[https://omaragi.com/history?benchmark=abcd-v3](https://omaragi.com/history?benchmark=abcd-v3) 야 이것도 날려 쓰잘데기 없는 페이지잖아",
        "야 너 R2 연결되있지? 그 QM이랑 주야를 가져와봐QM이랑 GR 자료 가져가 보라고",
        "야 너 R2 연결 된거야?",
        "야 이거 봐봐. 라우팅이 다 왜 코덱스로 되냐?",
        "도대체 여기에 대해서 아스트라로 왜 라우팅이 됐는데?",
        "이 버그 왜 생겨?",
        "왜 그래프가 안 나와?",
        "이 파일 고쳐줄 수 있어?",
        "빌드 다 됐어?",
        String(repeating: "이거 맞지? ", count: 60),
    ] {
        check(!ClaudeChatLane.readOnlyQuestion(request), "write lane keeps: \(request.prefix(40))")
    }
    // 2026-10-02 (build 301): a request for information phrased as an order
    // runs read-only too; the owner's domain turns, then work it must not take.
    for request in [
        "아니 일단 가능한 도메인 주소를 다 줘봐 인마.최대한 간단하고 단순해야 돼.그럼 무조건 닷컴으로끝나야 돼.",
        "쓰고 있으면 다른 거 하자. 다른 거 좀 줘봐. 짧고 단순한 거. 근데 무조건 닷컴이어야 돼.",
        "그럼 도메인으로 쓸 수 있는 거 예시 좀 줘봐.",
        "다른 후보 좀 알려줘",
        "이름 추천해줘",
    ] {
        check(ClaudeChatLane.readOnlyInformationRequest(request) && ClaudeChatLane.readOnlyAnswer(request),
              "read-only information request: \(request.prefix(40))")
    }
    for request in [
        "아니 그게 아니라 뭐 스퀘어스페이스나 고데리 닷컴 가서 하나 사자고, 씨발.",
        "usungcorp.com이걸로 하자.",
        "아 씨발놈아 해라고.",
        "야 R2에서 QMGR 자료 가져와봐",
        "야 QMGR 통합하려고 하거든? 스키나 좀 짜봐",
        "야 그 QM이랑 GR 통합하게 스키마 좀 줘봐",
        "앞으로 어떻게 진행해서 스키마 뽑아야 할지 좀 줘봐 objective function은 결론적으로 qm이랑 주암을 통합하는거야",
        "인스타그램 오토매이션 세팅 해야 되거든? 준비 좀 해봐",
        "여기서 리즈닝 모드 선택되는지 안 보이거든. 리즈닝 모드도 다 보이게 해 줘.",
        "그거 설명 좀 해봐 어디까지 됐는데",
        "README.md 예시 좀 보여줘",
        "~/Desktop 파일 목록 보여줘",
        "http://127.0.0.1:4173/ 예시 좀 보여줘",
        "OS1 라우팅 후보 좀 알려줘",
        "다른 거 좀 줘봐! 빨리!",
        "그 파일 다른 거 좀 줘봐",
    ] {
        check(!ClaudeChatLane.readOnlyInformationRequest(request), "write lane keeps: \(request.prefix(40))")
    }
    // The checkout card rides on purchase turns and their short follow-ups.
    let purchaseContext = "assistant: usungcorp.com 구매는 Squarespace에서 결제하면 됩니다."
    check(OwnerAuthorityActions.relevant(request: "스퀘어스페이스나 고데리 닷컴 가서 하나 사자고", context: nil), "purchase request gets the checkout card")
    check(OwnerAuthorityActions.relevant(request: "아 씨발놈아 해라고.", context: purchaseContext), "short follow-up of a purchase gets the card")
    check(!OwnerAuthorityActions.relevant(request: "아 씨발놈아 해라고.", context: "assistant: 빌드 304를 설치했습니다."), "no card without a purchase in play")
    check(!OwnerAuthorityActions.relevant(request: String(repeating: "이 함수 고쳐 ", count: 20), context: purchaseContext), "a long unrelated order gets no card")
    // A stray key is not a request; Korean, emoji, letters and digits are.
    for noise in ["\\", "\\\\\\", "'''''", "\"\"''\"\"", "  ==\\ "] {
        check(ComposerInput.isSymbolsOnly(noise), "symbols only: \(noise)")
    }
    for text in ["ㅋ", "ㅇㅇ", "👍", "1", "qqq=\\\\", "?", "!!", "??\\", "", "   "] {
        check(!ComposerInput.isSymbolsOnly(text), "sendable: \(text)")
    }
    print("Conversational question: \(count) checks passed; owner's side questions take the chat lane, read-only questions the read-only agent, lookups and work keep the agent")
}
