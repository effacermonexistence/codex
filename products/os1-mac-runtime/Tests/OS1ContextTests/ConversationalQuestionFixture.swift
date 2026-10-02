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
    ] {
        check(!ClaudeChatLane.conversationalQuestion(request), "agent keeps: \(request.prefix(40))")
    }
    check(!ClaudeChatLane.conversationalQuestion(String(repeating: "왜 그래? ", count: 40)), "a long message keeps the agent")
    print("Conversational question: \(count) checks passed; owner's side questions take the chat lane, lookups and work keep the agent")
}
