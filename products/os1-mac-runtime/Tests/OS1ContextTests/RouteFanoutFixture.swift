import Foundation
import OS1Context

/// Owner, 2026-10-02: "자 내가 하나만 요청해볼게. 1+1 GPT한테. 2+2 Codex한테. 3+3
/// Claude한테. 4+4 Claudecode한테. 라우팅 시켜서 답변 받아와." came back as one
/// local "8" — the whole sentence reached the router as arithmetic. Each part
/// must run on the surface it names; a sentence about routing, work on this
/// machine, or a refused name must never split.
func runRouteFanoutFixtures() throws {
    try runProviderSurfacePresentationFixtures()
    try RouteFanout.selfTest()
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Route fan-out: " + message); count += 1
    }
    let owner = "자 내가 하나만 요청해볼게. 1+1 GPT한테. 2+2 Codex한테. 3+3 Claude한테. 4+4 Claudecode한테. 라우팅 시켜서 답변 받아와."
    let plan = RouteFanout.plan(owner)
    check(plan?.targets.map(\.surface) == [.gptChat, .codex, .claudeChat, .claude], "the owner's sentence reaches four surfaces")
    check(plan?.targets.map(\.payload) == ["1+1", "2+2", "3+3", "4+4"], "each surface is sent only its own part")
    check(plan?.targets.allSatisfy { $0.surface.gatewayPreference != nil } == true, "all four parts execute; none is a handoff")
    check(plan?.targets.filter(\.surface.forcesChatLane).map(\.surface) == [.gptChat, .claudeChat],
          "GPT and Claude run on the bounded chat lanes, Codex and Claude Code on the full lanes")
    check(plan?.executionOrder == [0, 1, 2, 3], "executors run in the owner's order")
    check(plan?.frame.contains("라우팅 시켜서 답변 받아와") == true, "the routing instruction is framing, never a part")
    check(RouteFanout.plan("1+1 ChatGPT한테. 2+2 Codex한테.")?.targets.first?.surface == .chatgpt,
          "ChatGPT by name is the app handoff, not GPT on the Codex account")
    // Owner, 2026-10-04: one particle after four listed names reached only
    // Claude Code. Every listed name is a destination for the same part.
    let listed = RouteFanout.plan("야 라우팅 잘 됐는지 일단 확인해 보자. GPT랑 코덱스랑 클로드랑 클로드 코드한테 1+2 이런거 해봐. 간단한 거.")
    check(listed?.targets.map(\.surface) == [.gptChat, .codex, .claudeChat, .claude], "a listed name shares the last name's particle")
    check(listed?.targets.map(\.payload) == ["1+2", "1+2", "1+2", "1+2"], "every listed surface is sent the same part, without the hedge")
    check(listed?.targets.map(\.mention) == ["GPT랑", "코덱스랑", "클로드랑", "클로드 코드한테"], "each name is kept as written")
    check(listed?.executionOrder == [0, 1, 2, 3], "listed executors run in the owner's order")
    // Real owner texts that mention several backends but ask no question of them.
    for text in [
        "그리고 클로드한테도 넘기게 해 왜 코덱스한테만 넘기냐? 항상 전체적으로 토큰 다 감시해야 돼",
        "그리고 이거 존나 헷갈리거든? 봐봐 이게 코덱스의 라우팅이 된건지, GPT의 라우팅이 된건지, 클로드 코드의 라우팅이 된건지, 클로드의 라우팅이 된건지 구분이 안가. 그것 좀 고쳐.",
        "코덱스한테 시키지 말고 클로드한테 시켜",
        "Codex한테 이 함수 만들고 Claude Code한테 테스트 작성해",
        "1+1 GPT한테",
    ] {
        check(RouteFanout.plan(text) == nil, "no split: \(text.prefix(40))")
    }
    // A list makes a complaint about routing name several backends at once;
    // it is still a remark, not a question for each of them.
    for text in ["GPT랑 코덱스랑 클로드한테는 안 갔잖아", "코덱스랑 클로드한테 라우팅이 이상해", "GPT랑 클로드한테 1+2 보냈어?"] {
        check(RouteFanout.plan(text) == nil, "no list split: \(text.prefix(40))")
    }
    print("Route fan-out: \(count) checks passed")
}
