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
    // Owner, 2026-10-06: no name carried a particle, so the whole sentence
    // reached Claude Code alone. "하나씩" hands out the next sentence's parts in order.
    let oneEach = RouteFanout.plan("그럼 클로드랑 클로드 코드 GPT 코덱스 다 라우팅 하나씩 시켜봐. 1 plus 1, 2 plus 2, 3 plus 3, 4 plus 4.")
    check(oneEach?.targets.map(\.surface) == [.claudeChat, .claude, .gptChat, .codex], "one each reaches all four surfaces in the owner's order")
    check(oneEach?.targets.map(\.payload) == ["1 plus 1", "2 plus 2", "3 plus 3", "4 plus 4"], "the n-th name gets the n-th part")
    check(oneEach?.targets.allSatisfy { $0.surface.gatewayPreference != nil } == true, "every one-each part executes")
    check(oneEach?.executionOrder == [0, 1, 2, 3], "one-each executors run in the owner's order")
    let screenshot = "GPT랑 코덱스랑 클로드랑 다 병렬로 간단한 거 돌려봐. 아니 뭐 GPT랑 코덱스 클로드 코드 클로드 이거 네 개 병렬로 뭐 원 플러스 원 투 플러스 투 이런 거 돌려봐."
    let broadcast = RouteFanout.plan(screenshot)
    check(broadcast?.targets.map(\.surface) == [.gptChat, .codex, .claude, .claudeChat], "the screenshot's final four-surface roster is preserved")
    check(broadcast?.targets.map(\.payload) == Array(repeating: "1+1, 2+2", count: 4), "self-contained dictated sums are broadcast; no log-search task is invented")
    check(RouteFanout.requestsProviderFanout(screenshot), "provider fanout bypasses a project/research planner")
    check(RouteFanout.plan("GPT랑 Codex 병렬로 1+1, 2+2 돌려봐")?.targets.count == 2, "explicit parallel arithmetic broadcast")
    for rejected in [
        "GPT랑 Codex 병렬로 1+1 돌려봐. 로그를 다 찾아봐",
        "GPT랑 Codex 병렬로 버그 고쳐줘",
        "GPT랑 Codex 병렬로 1+1 돌려봐. 그리고 배포해",
        "GPT랑 Codex 병렬로 1-10, 11-20 돌려봐",
        "GPT랑 Codex 병렬로 하지 마. 1+1",
        "GPT랑 Codex 병렬로 1+1 돌렸어?",
        "GPT랑 Codex 병렬로 1+1 돌려봐. Claude랑 Claude Code로 2+2 돌려봐",
    ] { check(RouteFanout.plan(rejected) == nil, "parallel broadcast never drops extra or unsafe content: \(rejected.prefix(50))") }
    check(RouteFanout.requestsProviderFanout("GPT랑 Codex 병렬로 로그 조사 돌려봐"), "unclear provider payload preserves provider intent without authorizing dispatch")
    check(!RouteFanout.requestsProviderFanout("GPT랑 Codex 차이가 뭐야?"), "comparison is not a parallel request")
    check(RouteFanout.plan("클로드랑 GPT 하나씩 시켜봐. 1+1, 2+2, 3+3") == nil, "a count that does not match never splits")
    // A question in words is never cut: the whole request reaches one route
    // with its "하나씩" (hunt of build 334: word parts read the same as complaints).
    check(RouteFanout.plan("GPT한테 사과 10개를 3명에게 하나씩 나눠주면 몇 개 남아? 클로드한테 2+2") == nil, "a question in words keeps the request whole, 하나씩 intact")
    check(RouteFanout.plan("GPT한테 하나씩 세어 보면 몇 개야? 클로드한테 2+2") == nil, "a question starting with 하나씩 keeps the request whole")
    check(RouteFanout.plan("사과 열 개를 세 명이 한 개씩 가져가면 몇 개 남아 GPT한테 물어봐. 같은 질문 클로드한테도.") == nil, "a shared word question is never trimmed")
    check(RouteFanout.plan("GPT한테 하나씩 1+1, Codex한테 2+2")?.targets.map(\.payload) == ["1+1", "2+2"], "an unambiguous arithmetic route prefix is removed")
    check(RouteFanout.plan("클로드랑 GPT 하나씩 시켜봐. 1 plus 1 2 plus 2")?.targets.map(\.payload) == ["1 plus 1", "2 plus 2"], "dictated parts require a nonempty separator")
    check(RouteFanout.plan("클로드랑 GPT 하나씩 시켜봐. 1+12+2") == nil, "adjacent digits never become separate expressions")
    let hostile = "클로드랑 GPT 하나씩 시켜봐. " + (0..<40).map { String(1234 + $0 * 13) }.joined(separator: "+") + " 얼마야"
    let parseStarted = Date()
    check(RouteFanout.plan(hostile) == nil, "a long arithmetic question stays whole")
    check(Date().timeIntervalSince(parseStarted) < 1, "invalid arithmetic suffix does not cause nested backtracking")
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
