import Foundation
import OS1Context

/// Derived protocol/metadata fixtures only. No provider, private reasoning,
/// command, real tool result, or runtime success record is generated here.
func runNativeExecutionProgressFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
    let session = UUID().uuidString.lowercased(), other = UUID().uuidString.lowercased()
    var now = Date(timeIntervalSince1970: 1_000)
    let stream = ExecutionStream(claudeSessionID: session, observedTime: { now })
    func feed(_ row: [String: Any], fragmented: Bool = false) throws {
        var object = row
        if object["session_id"] == nil { object["session_id"] = session }
        let bytes = try JSONSerialization.data(withJSONObject: object) + Data([10])
        if fragmented { for byte in bytes { stream.ingestClaude(Data([byte])) } }
        else { stream.ingestClaude(bytes) }
    }
    try feed(["type":"system", "subtype":"init", "message":"PRIVATE INIT"])
    check(stream.progress?.kind == .ready && stream.progress?.observedAt == now, "real init metadata uses receive time")
    let ready = stream.eventCount
    try feed(["type":"system", "subtype":"init"])
    check(stream.eventCount == ready, "duplicate init does not invent progress")
    try feed(["type":"stream_event", "event":["type":"message_start", "message":["id":"message-main"]]], fragmented:true)
    check(stream.progress?.kind == .responseStarted && stream.turnOpen, "fragmented message-start admitted")
    let thinking: [String:Any] = ["type":"stream_event", "event":["type":"content_block_delta", "delta":["type":"thinking_delta", "thinking":"PRIVATE THINKING BODY"]]]
    try feed(thinking)
    check(stream.progress?.kind == .processing && stream.text.isEmpty, "thinking frame presence only, no body")
    let processing = stream.eventCount
    now = now.addingTimeInterval(0.2); try feed(thinking)
    check(stream.eventCount == processing, "processing signals throttled, not frame-count percentages")
    now = now.addingTimeInterval(1); try feed(thinking)
    check(stream.eventCount > processing, "fresh incoming frame can renew processing signal")
    try feed(["type":"assistant", "message":["id":"tool-message", "content":[["type":"tool_use", "id":"tool-main", "name":"Bash", "input":["command":"PRIVATE COMMAND"]]]]])
    check(stream.progress?.toolsRequested == 1 && stream.progress?.activeTools == 1 && stream.tool == "Bash", "ordinary assistant tool-only request visible")
    let requested = stream.eventCount
    try feed(["type":"stream_event", "event":["type":"content_block_start", "content_block":["type":"tool_use", "id":"tool-main", "name":"Bash", "input":["private":"SECRET"]]]])
    check(stream.eventCount == requested && stream.progress?.toolsRequested == 1, "partial/full tool request identity dedup")
    try feed(["type":"tool_progress", "tool_use_id":"tool-main", "elapsed_time_seconds":1])
    check(stream.progress?.kind == .toolWorking, "native tool-progress signal admitted without payload")
    let working = stream.eventCount
    try feed(["type":"tool_progress", "tool_use_id":"tool-main", "elapsed_time_seconds":1])
    check(stream.eventCount == working, "duplicate working signal ignored")
    try feed(["type":"user", "message":["content":[["type":"tool_result", "tool_use_id":"tool-main", "is_error":true, "content":"PRIVATE ERROR/RESULT"]]]])
    check(stream.progress?.kind == .toolFailed && stream.progress?.toolsReturned == 1 && stream.progress?.activeTools == 0 && stream.tool == nil,
          "explicit tool error returned, active ID cleared, no task verdict")
    let returned = stream.eventCount
    try feed(["type":"user", "message":["content":[["type":"tool_result", "tool_use_id":"tool-main", "is_error":true]]]])
    check(stream.eventCount == returned && stream.progress?.toolsReturned == 1, "duplicate result dedup")
    try feed(["type":"assistant", "session_id":other, "message":["id":"foreign", "content":[["type":"text","text":"FOREIGN TEXT"],["type":"tool_use","id":"foreign-tool","name":"Write"]]]])
    check(stream.eventCount == returned && stream.text.isEmpty, "foreign root session cannot mutate text/progress")
    try feed(["type":"assistant", "message":["id":"parent-message", "content":[["type":"tool_use","id":"parent-tool","name":"Agent"]]]])
    try feed(["type":"assistant", "session_id":other, "parent_tool_use_id":"parent-tool",
              "message":["id":"child", "content":[["type":"text","text":"PRIVATE CHILD TEXT"],["type":"tool_use","id":"child-tool","name":"Read","input":["path":"PRIVATE PATH"]]]]])
    check(stream.progress?.scope.hasPrefix("subagent:") == true && stream.progress?.toolsRequested == 3 && stream.text.isEmpty && stream.tool == "Agent",
          "linked child metadata scoped separately, never child text or main tool replacement")
    try feed(["type":"user", "session_id":other, "parent_tool_use_id":"parent-tool",
              "message":["content":[["type":"tool_result","tool_use_id":"child-tool","content":"PRIVATE CHILD RESULT"]]]])
    check(stream.progress?.toolsReturned == 2 && stream.progress?.activeTools == 1, "child return matches its scoped request")
    try feed(["type":"stream_event", "event":["type":"content_block_delta", "delta":["type":"text_delta","text":"Public 👋"]]])
    try feed(["type":"assistant", "message":["id":"message-main", "content":[["type":"text","text":"Public 👋"]]]])
    check(stream.text == "Public 👋", "public assistant bytes preserved with lifecycle metadata")
    try feed(["type":"stream_event", "event":["type":"message_stop"]])
    check(stream.turnOpen, "API message-stop is not whole agent-turn completion")
    try feed(["type":"system", "subtype":"api_retry", "attempt":1, "error":"PRIVATE DIAGNOSTIC"])
    check(stream.progress?.kind == .retrying, "retry signal excludes raw error")
    try feed(["type":"result", "session_id":other, "is_error":false, "result":"FOREIGN FINAL"])
    check(stream.resultCount == 0, "foreign final cannot consume current result cursor")
    try feed(["type":"result", "is_error":false, "result":"EXACT FINAL 👋"])
    var cursor = 0
    check(stream.takeClaudePublicFinal(sessionID:session, after:&cursor) == "EXACT FINAL 👋", "bound final unchanged")
    check(stream.takeClaudePublicFinal(sessionID:session, after:&cursor) == nil, "final still consumed once")
    let encoded = try JSONEncoder().encode(stream.progress!)
    let publicJSON = String(decoding:encoded, as:UTF8.self)
    check(!publicJSON.contains("PRIVATE") && !publicJSON.contains("SECRET") && !publicJSON.contains("FOREIGN") && !publicJSON.contains("parent-tool"), "only content-free DTO can leave parser")
    check(try JSONDecoder().decode(NativeExecutionProgress.self, from:encoded).isValid, "typed DTO roundtrip")
    var malformed = try JSONSerialization.jsonObject(with:encoded) as! [String:Any]
    malformed["toolsRequested"] = -1
    do { _ = try JSONDecoder().decode(NativeExecutionProgress.self, from:JSONSerialization.data(withJSONObject:malformed)); check(false,"negative counter admitted") }
    catch { checks += 1 }
    malformed = try JSONSerialization.jsonObject(with:encoded) as! [String:Any]; malformed["tool"] = "Bash PRIVATE/COMMAND"
    do { _ = try JSONDecoder().decode(NativeExecutionProgress.self, from:JSONSerialization.data(withJSONObject:malformed)); check(false,"unsafe tool admitted") }
    catch { checks += 1 }
    for index in 0..<15 { try feed(["type":"stream_event","event":["type":"message_start","message":["id":"history-\(index)"]]]) }
    check(stream.progress!.events.count == 12 && stream.progress!.isValid, "history bounded to12 metadata events")

    let codex = ExecutionStream()
    func codexEvent(_ method:String, _ item:[String:Any], thread:String="thread") {
        codex.ingestCodex(["method":method,"params":["threadId":thread,"turnId":"turn","item":item]],threadID:"thread",turnID:"turn")
    }
    codexEvent("item/started", ["id":"command","type":"commandExecution","command":"PRIVATE"])
    codexEvent("item/started", ["id":"command","type":"commandExecution"])
    check(codex.progress?.toolsRequested == 1, "Codex request duplicate ignored")
    codexEvent("item/completed", ["id":"command","type":"commandExecution","status":"failed","output":"PRIVATE"])
    check(codex.progress?.kind == .toolFailed && codex.progress?.toolsReturned == 1 && codex.tool == nil, "Codex error return clears active")
    let codexCount = codex.eventCount
    codexEvent("item/started", ["id":"foreign","type":"fileChange"],thread:"foreign")
    check(codex.eventCount == codexCount, "Codex foreign scope ignored")
    let snapshot = ExecutionStream()
    let item:[String:Any] = ["id":"snap-command","type":"commandExecution","status":"inProgress","command":"PRIVATE"]
    snapshot.ingestCodexTurnSnapshot(items:[item],status:"inProgress",threadID:"t",turnID:"u")
    let first = snapshot.eventCount
    snapshot.ingestCodexTurnSnapshot(items:[item],status:"inProgress",threadID:"t",turnID:"u")
    check(snapshot.eventCount == first, "unchanged Desktop polling adds no progress")
    snapshot.ingestCodexTurnSnapshot(items:[["id":"snap-command","type":"commandExecution","status":"completed"]],status:"inProgress",threadID:"t",turnID:"u")
    check(snapshot.progress?.toolsReturned == 1 && snapshot.tool == nil, "Desktop snapshot item status change observed")
    let complete = snapshot.eventCount
    snapshot.ingestCodexTurnSnapshot(items:[item],status:"inProgress",threadID:"other",turnID:"u")
    check(snapshot.eventCount == complete, "Desktop snapshot foreign identity rejected")
    let firstCompleted = ExecutionStream()
    firstCompleted.ingestCodexTurnSnapshot(items:[["id":"done","type":"mcpToolCall","status":"completed"]],status:"completed",threadID:"t",turnID:"u")
    check(firstCompleted.progress?.toolsRequested == 1 && firstCompleted.progress?.toolsReturned == 1 &&
          firstCompleted.progress?.events.contains(where:{$0.kind == .toolStarted}) == false, "first-seen completed snapshot creates no fabricated start notification")
    let strictRetry = ExecutionStream(claudeSessionID: session)
    strictRetry.ingestClaude(try JSONSerialization.data(withJSONObject: ["type":"system", "subtype":"api_retry", "session_id":session, "attempt":true]) + Data([10]))
    check(strictRetry.progress == nil, "JSON boolean cannot fabricate retry attempt one")
    strictRetry.ingestClaude(try JSONSerialization.data(withJSONObject: ["type":"system", "subtype":"api_retry", "session_id":session, "attempt":1]) + Data([10]))
    check(strictRetry.progress?.kind == .retrying, "actual integer retry remains visible")
    let mixed = ExecutionStream(claudeSessionID: session)
    mixed.ingestCodex(["method":"item/started", "params":["threadId":"mixed-thread", "turnId":"mixed-turn", "item":["id":"codex-parent", "type":"commandExecution"]]], threadID:"mixed-thread", turnID:"mixed-turn")
    let mixedCount = mixed.eventCount
    mixed.ingestClaude(try JSONSerialization.data(withJSONObject: ["type":"system", "subtype":"init", "session_id":other, "parent_tool_use_id":"codex-parent"]) + Data([10]))
    check(mixed.eventCount == mixedCount, "Codex request identity cannot authorize foreign Claude child metadata")
    let longSnapshot = ExecutionStream()
    let longItem: [String: Any] = ["id":"long-public", "type":"agentMessage", "text":String(repeating:"public",count:6000)]
    longSnapshot.ingestCodexTurnSnapshot(items:[longItem],status:"inProgress",threadID:"t",turnID:"u")
    let longCount = longSnapshot.eventCount
    longSnapshot.ingestCodexTurnSnapshot(items:[longItem],status:"inProgress",threadID:"t",turnID:"u")
    check(longSnapshot.eventCount == longCount, "unchanged oversized public text does not fabricate polling activity")
    print("Native progress: \(checks) deterministic metadata/privacy/lifecycle checks PASS; no provider calls")
}
