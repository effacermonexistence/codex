import Foundation
import OS1Context

/// Native public-interface coverage, not additional model generation. All
/// records here are derived fixtures; no provider or actual tool is called.
func runNativePublicItemFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
    let stream = ExecutionStream(workspace:"/fixture/ws")
    func event(_ method:String, _ item:[String:Any], thread:String="t") {
        stream.ingestCodex(["method":method,"params":["threadId":thread,"turnId":"u","item":item]],threadID:"t",turnID:"u")
    }
    let search:[String:Any] = ["id":"search", "type":"webSearch", "query":"swift sendable"]
    event("item/started", search)
    check(stream.progress?.steps?.first?.state == .observed && stream.progress?.steps?.first?.label == "swift sendable",
          "status-less native search query is visible, not a fabricated lifecycle")
    check(stream.progress?.toolsRequested == 0 && stream.progress?.toolsReturned == 0 && stream.progress?.steps?.first?.endedAt == nil,
          "observed item does not invent request/return/finish")
    let count = stream.eventCount
    event("item/started", search)
    check(stream.eventCount == count, "repeated observed item does not resample")
    event("item/completed", search)
    check(stream.progress?.steps?.first?.state == .returned && stream.progress?.toolsRequested == 0 && stream.progress?.toolsReturned == 0,
          "real completion notification updates observed state without invented start counters")
    event("item/started", ["id":"agent", "type":"collabToolCall", "tool":"spawnAgent", "agentNickname":"Curie",
                           "status":"inProgress", "prompt":"PRIVATE CHILD TASK", "agentStatus":"PRIVATE CHILD RESULT"])
    check(stream.progress?.steps?.last?.verb == "agent" && stream.progress?.steps?.last?.label == "spawnAgent · Curie",
          "native collaboration operation and provided nickname visible")
    event("item/completed", ["id":"agent", "type":"collabToolCall", "tool":"spawnAgent", "status":"completed"])
    check(stream.progress?.steps?.last?.state == .returned, "real agent-call return does not claim child task succeeded")
    event("item/started", ["id":"dynamic", "type":"dynamicToolCall", "tool":"repo.lookup", "status":"inProgress",
                           "arguments":["secret":"PRIVATE DYNAMIC INPUT"]])
    check(stream.progress?.steps?.last?.label == "repo.lookup", "dynamic native tool identity visible without arguments")
    event("item/completed", ["id":"dynamic", "type":"dynamicToolCall", "tool":"repo.lookup", "status":"failed",
                             "contentItems":["PRIVATE TOOL OUTPUT"]])
    check(stream.progress?.steps?.last?.state == .failed, "explicit dynamic failure state retained")
    event("item/completed", ["id":"plan-item", "type":"plan", "text":"Inspect source, then verify parser"])
    check(stream.progress?.steps?.last?.verb == "plan" && stream.progress?.steps?.last?.state == .observed,
          "public proposed plan is not treated as executed/completed work")
    stream.ingestCodex(["method":"turn/plan/updated", "params":["turnId":"u","explanation":"Native public plan change",
        "plan":[["step":"Inspect source","status":"completed"],["step":"Verify parser","status":"inProgress"]]]], threadID:"t",turnID:"u")
    check(stream.progress?.steps?.last?.label?.contains("[inProgress] Verify parser") == true &&
          stream.progress?.steps?.last?.label?.contains("Native public plan change") == true,
          "actual public plan explanation and status pass through, not private reasoning")
    let planID = stream.progress?.steps?.last?.id
    stream.ingestCodex(["method":"turn/plan/updated", "params":["turnId":"u","plan":[["step":"Read live result","status":"pending"]]]], threadID:"t",turnID:"u")
    check(stream.progress?.steps?.last?.id == planID && stream.progress?.steps?.last?.label == "[pending] Read live result",
          "native public plan revision replaces only the same observed plan")
    let planStream = ExecutionStream()
    func planDelta(_ delta:String) {
        planStream.ingestCodex(["method":"item/plan/delta","params":["threadId":"t","turnId":"u","itemId":"stream-plan","delta":delta]],threadID:"t",turnID:"u")
    }
    planDelta("Inspect the ")
    check(planStream.progress?.steps == nil, "partial public plan line waits for safe redaction boundary")
    planDelta("active source\n")
    check(planStream.progress?.steps?.last?.label == "Inspect the active source" &&
          planStream.progress?.steps?.last?.state == .observed && planStream.progress?.toolsRequested == 0,
          "fragmented native public plan line visible without executing it")
    planDelta("Then verify result\n")
    check(planStream.progress?.steps?.last?.label == "Then verify result", "actual next public plan line replaces proposed plan text")
    planStream.ingestCodex(["method":"item/completed","params":["threadId":"t","turnId":"u",
        "item":["type":"plan","id":"stream-plan","text":"Final native proposed plan"]]],threadID:"t",turnID:"u")
    check(planStream.progress?.steps?.last?.label == "Final native proposed plan" &&
          planStream.progress?.steps?.last?.state == .observed && planStream.text.isEmpty,
          "authoritative native plan item replaces delta only, never final answer or task status")
    planDelta("Late duplicated delta\n")
    check(planStream.progress?.steps?.last?.label == "Final native proposed plan", "completed native plan remains authoritative over late delta")
    event("item/started", ["id":"image","type":"imageView","path":"/fixture/ws/preview.png"])
    check(stream.progress?.steps?.last?.verb == "view" && stream.progress?.steps?.last?.state == .observed &&
          stream.progress?.steps?.last?.label == "preview.png", "native image path observed without invented finish")
    let stable = stream.eventCount
    event("item/started", ["id":"foreign","type":"collabToolCall","tool":"spawnAgent","status":"inProgress"], thread:"foreign")
    stream.ingestCodex(["method":"turn/plan/updated","params":["threadId":"foreign","turnId":"u","plan":[["step":"FOREIGN PLAN"]]]],threadID:"t",turnID:"u")
    check(stream.eventCount == stable, "foreign native item and plan scopes ignored")
    event("item/completed", ["id":"answer","type":"agentMessage","phase":"final_answer","text":"EXACT FINAL 7"])
    check(stream.text == "EXACT FINAL 7", "strict final text unaffected by all public action metadata")
    let encoded = String(decoding:try JSONEncoder().encode(stream.progress!),as:UTF8.self)
    check(!encoded.contains("PRIVATE") && !stream.text.contains("Inspect source") && !stream.text.contains("repo.lookup"),
          "private prompts/results/explanation and public action metadata never contaminate answer")
    let snapshot = ExecutionStream(workspace:"/fixture/ws")
    let items:[[String:Any]] = [search,["id":"collab","type":"collabToolCall","tool":"wait","status":"inProgress"],
        ["id":"dynamic","type":"dynamicToolCall","tool":"repo.lookup","status":"inProgress"],
        ["id":"plan","type":"plan","text":"Check actual release"],["id":"image","type":"imageView","path":"/fixture/ws/p.png"]]
    snapshot.ingestCodexTurnSnapshot(items:items,status:"inProgress",threadID:"t",turnID:"u")
    let snapshotCount = snapshot.eventCount
    snapshot.ingestCodexTurnSnapshot(items:items,status:"inProgress",threadID:"t",turnID:"u")
    check(snapshot.progress?.steps?.count == 5 && snapshot.progress?.steps?.first?.state == .observed,
          "Desktop snapshots expose the same native public item classes")
    check(snapshot.eventCount == snapshotCount, "unchanged full native item snapshot adds no fake heartbeat")
    check(snapshot.progress?.toolsRequested == 2 && snapshot.progress?.toolsReturned == 0,
          "only actual lifecycle-status items enter request counters")
    let label = NativeStepLabel.codex(item:["type":"webSearch","action":["type":"search","queries":["alpha","beta"]]],workspace:nil)
    check(label?.label == "alpha; beta", "native multi-query public search field retained")
    print("Native public items: \(checks) deterministic passthrough/privacy checks PASS; no prompt changes/provider calls")
}
