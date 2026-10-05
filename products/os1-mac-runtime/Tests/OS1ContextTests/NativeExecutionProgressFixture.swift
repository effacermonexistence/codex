import Foundation
import OS1Context

/// Derived protocol/metadata fixtures only. No provider, private reasoning,
/// command, real tool result, or runtime success record is generated here.
/// Step labels are the backend's own redacted words; every PRIVATE/SECRET
/// payload below sits in a field that must never be read.
func runNativeExecutionProgressFixtures() throws {
    try runNativeStepLabelFixtures()
    var checks = 0
    func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
    let session = UUID().uuidString.lowercased(), other = UUID().uuidString.lowercased()
    var now = Date(timeIntervalSince1970: 1_000)
    let stream = ExecutionStream(claudeSessionID: session, workspace: "/fixture/ws", observedTime: { now })
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
    // Real Claude ordering: the partial start (input `{}`) first, the full block after it.
    try feed(["type":"stream_event", "event":["type":"content_block_start", "content_block":["type":"tool_use", "id":"tool-main", "name":"Bash", "input":["private":"SECRET"]]]])
    check(stream.progress?.toolsRequested == 1 && stream.progress?.activeTools == 1 && stream.tool == "Bash", "partial tool request visible")
    check(stream.progress?.steps?.count == 1 && stream.progress?.steps?.first?.label == nil && stream.progress?.steps?.first?.state == .requested,
          "partial start opens an unlabelled step; its input is never read")
    let requested = stream.eventCount
    let fullBash: [String: Any] = ["type":"assistant", "message":["id":"tool-message", "content":[["type":"tool_use", "id":"tool-main", "name":"Bash",
        "input":["command":"PRIVATE COMMAND", "description":"DESC-VISIBLE"]]]]]
    try feed(fullBash)
    check(stream.eventCount == requested + 1 && stream.progress?.toolsRequested == 1 && stream.progress?.steps?.count == 1,
          "full block after the partial start labels the same step, no second request")
    check(stream.progress?.steps?.first?.label == "DESC-VISIBLE" && stream.progress?.steps?.first?.verb == nil,
          "Bash description relayed verbatim; command not shown when a description exists")
    let labelled = stream.eventCount
    try feed(fullBash)
    check(stream.eventCount == labelled, "identical repeat of a labelled call changes nothing")
    try feed(["type":"tool_progress", "tool_use_id":"tool-main", "elapsed_time_seconds":1])
    check(stream.progress?.kind == .toolWorking, "native tool-progress signal admitted without payload")
    let working = stream.eventCount
    try feed(["type":"tool_progress", "tool_use_id":"tool-main", "elapsed_time_seconds":1])
    check(stream.eventCount == working, "duplicate working signal ignored")
    try feed(["type":"user", "message":["content":[["type":"tool_result", "tool_use_id":"tool-main", "is_error":true, "content":"PRIVATE ERROR/RESULT"]]]])
    check(stream.progress?.kind == .toolFailed && stream.progress?.toolsReturned == 1 && stream.progress?.activeTools == 0 && stream.tool == nil,
          "explicit tool error returned, active ID cleared, no task verdict")
    check(stream.progress?.steps?.first?.state == .failed && stream.progress?.steps?.first?.endedAt == now,
          "step moves to failed at the result's receipt time")
    let returned = stream.eventCount
    try feed(["type":"user", "message":["content":[["type":"tool_result", "tool_use_id":"tool-main", "is_error":true]]]])
    check(stream.eventCount == returned && stream.progress?.toolsReturned == 1, "duplicate result dedup")
    try feed(["type":"assistant", "session_id":other, "message":["id":"foreign", "content":[["type":"text","text":"FOREIGN TEXT"],["type":"tool_use","id":"foreign-tool","name":"Write"]]]])
    check(stream.eventCount == returned && stream.text.isEmpty, "foreign root session cannot mutate text/progress")
    try feed(["type":"assistant", "message":["id":"parent-message", "content":[["type":"tool_use","id":"parent-tool","name":"Agent",
        "input":["prompt":"PRIVATE PROMPT"]]]]])
    check(stream.progress?.steps?.last?.label == nil, "Agent prompt is never a label")
    try feed(["type":"system", "subtype":"task_started", "tool_use_id":"parent-tool", "description":"Investigate the parser", "task_type":"local_agent"])
    check(stream.progress?.steps?.last?.label == "Investigate the parser" && stream.progress?.steps?.last?.verb == "agent",
          "task_started description labels the named tool's step")
    let started = stream.eventCount
    try feed(["type":"system", "subtype":"task_started", "session_id":other, "tool_use_id":"parent-tool", "description":"FOREIGN TASK"])
    check(stream.eventCount == started, "foreign session task event ignored")
    try feed(["type":"system", "subtype":"task_progress", "tool_use_id":"parent-tool", "description":"Investigate the parser",
              "last_tool_name":"Read", "usage":["tool_uses":3, "total_tokens":9, "duration_ms":5]])
    check(stream.progress?.steps?.last?.childToolUses == 3 && stream.progress?.steps?.last?.lastChildTool == "Read",
          "task_progress relays the subagent's own tool count")
    let progressed = stream.eventCount
    try feed(["type":"system", "subtype":"task_progress", "tool_use_id":"parent-tool", "last_tool_name":"Read", "usage":["tool_uses":3]])
    check(stream.eventCount == progressed, "unchanged task count adds no revision")
    try feed(["type":"assistant", "session_id":other, "parent_tool_use_id":"parent-tool",
              "message":["id":"child", "content":[["type":"text","text":"PRIVATE CHILD TEXT"],["type":"tool_use","id":"child-tool","name":"Read","input":["path":"PRIVATE PATH"]]]]])
    check(stream.progress?.scope.hasPrefix("subagent:") == true && stream.progress?.toolsRequested == 3 && stream.text.isEmpty && stream.tool == "Agent",
          "linked child metadata scoped separately, never child text or main tool replacement")
    check(stream.progress?.steps?.last?.scope.hasPrefix("subagent:") == true && stream.progress?.steps?.last?.label == nil,
          "child step scoped; a non-allowlisted `path` key is never read")
    try feed(["type":"assistant", "session_id":other, "parent_tool_use_id":"parent-tool",
              "message":["id":"child-2", "content":[["type":"tool_use","id":"child-read","name":"Read","input":["file_path":"/fixture/ws/Sources/App.swift"]]]]])
    check(stream.progress?.steps?.last?.label == "Sources/App.swift" && stream.progress?.steps?.last?.verb == "read" &&
          stream.progress?.steps?.last?.scope.hasPrefix("subagent:") == true, "subagent full block alone opens a labelled step")
    try feed(["type":"system", "subtype":"status", "status":"compacting"])
    check(stream.progress?.backendStatus == "compacting", "backend compaction status relayed")
    try feed(["type":"system", "subtype":"compact_boundary"])
    check(stream.progress?.backendStatus == nil, "compaction boundary clears the status")
    try feed(["type":"user", "session_id":other, "parent_tool_use_id":"parent-tool",
              "message":["content":[["type":"tool_result","tool_use_id":"child-tool","content":"PRIVATE CHILD RESULT"]]]])
    check(stream.progress?.toolsReturned == 2 && stream.progress?.activeTools == 2, "child return matches its scoped request")
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
    check(!stream.text.contains("DESC-VISIBLE") && !stream.text.contains("Investigate"), "step labels never enter public text")
    let encoded = try JSONEncoder().encode(stream.progress!)
    let publicJSON = String(decoding:encoded, as:UTF8.self)
    check(!publicJSON.contains("PRIVATE") && !publicJSON.contains("SECRET") && !publicJSON.contains("FOREIGN") && !publicJSON.contains("parent-tool") &&
          !publicJSON.contains("tool-main") && !publicJSON.contains("child-tool"), "only lifecycle metadata and redacted step labels leave parser")
    check(publicJSON.contains("DESC-VISIBLE") && stream.progress!.steps!.allSatisfy { $0.id.range(of: #"^[0-9a-f]{12}$"#, options: .regularExpression) != nil },
          "labels relayed under digest step ids")
    check(try JSONDecoder().decode(NativeExecutionProgress.self, from:encoded).isValid, "typed DTO roundtrip")
    check(try JSONDecoder().decode(NativeExecutionProgress.self, from:encoded) == stream.progress!, "steps survive the roundtrip unchanged")
    var badSteps = try JSONSerialization.jsonObject(with:encoded) as! [String:Any]
    var rows = badSteps["steps"] as! [[String:Any]]
    rows[0]["id"] = "parent-tool"
    badSteps["steps"] = rows
    let softened = try JSONDecoder().decode(NativeExecutionProgress.self, from:JSONSerialization.data(withJSONObject:badSteps))
    check(softened.steps == nil && softened.sequence == stream.progress!.sequence && softened.isValid,
          "malformed steps drop only the steps, never the lifecycle telemetry")
    rows = (try JSONSerialization.jsonObject(with:encoded) as! [String:Any])["steps"] as! [[String:Any]]
    rows[0]["label"] = "export TOKEN=" + "sk-" + "ant-api03-PRIVATEPRIVATEPRIVATE \u{202E}x"
    rows[0]["state"] = "returned"
    badSteps["steps"] = rows
    let reRedacted = try JSONDecoder().decode(NativeExecutionProgress.self, from:JSONSerialization.data(withJSONObject:badSteps))
    check(reRedacted.steps?.first.map { !($0.label ?? "").contains("PRIVATE") && !($0.label ?? "").contains("\u{202E}") } == true,
          "decoder re-applies redaction to labels written by anyone")
    rows[0]["state"] = "finished-in-future"
    badSteps["steps"] = rows
    check(try JSONDecoder().decode(NativeExecutionProgress.self, from:JSONSerialization.data(withJSONObject:badSteps)).steps == nil,
          "unknown step state drops the steps only")
    var malformed = try JSONSerialization.jsonObject(with:encoded) as! [String:Any]
    malformed["toolsRequested"] = -1
    do { _ = try JSONDecoder().decode(NativeExecutionProgress.self, from:JSONSerialization.data(withJSONObject:malformed)); check(false,"negative counter admitted") }
    catch { checks += 1 }
    malformed = try JSONSerialization.jsonObject(with:encoded) as! [String:Any]; malformed["tool"] = "Bash PRIVATE/COMMAND"
    do { _ = try JSONDecoder().decode(NativeExecutionProgress.self, from:JSONSerialization.data(withJSONObject:malformed)); check(false,"unsafe tool admitted") }
    catch { checks += 1 }
    for index in 0..<15 { try feed(["type":"stream_event","event":["type":"message_start","message":["id":"history-\(index)"]]]) }
    check(stream.progress!.events.count == 12 && stream.progress!.isValid, "history bounded to12 metadata events")
    check(stream.progress!.steps?.count == 4, "processing/lifecycle signals cannot push steps out")
    for index in 0..<30 {
        try feed(["type":"assistant", "message":["id":"ring-\(index)", "content":[["type":"tool_use", "id":"ring-\(index)", "name":"Bash",
            "input":["description":"Step \(index)"]]]]])
    }
    check(stream.progress!.steps?.count == 24 && stream.progress!.steps?.last?.label == "Step 29" &&
          stream.progress!.steps?.first?.label == "Step 6" && stream.progress!.isValid, "step ring capped at 24, oldest dropped")

    let codex = ExecutionStream(workspace: "/fixture/ws")
    func codexEvent(_ method:String, _ item:[String:Any], thread:String="thread") {
        codex.ingestCodex(["method":method,"params":["threadId":thread,"turnId":"turn","item":item]],threadID:"thread",turnID:"turn")
    }
    codexEvent("item/started", ["id":"command","type":"commandExecution","command":"/bin/zsh -lc 'sed -n 1,20p PRIVATE.swift'",
        "cwd":"/fixture/ws","commandActions":[["type":"read","command":"PRIVATE ACTION COMMAND","name":"App.swift","path":"/fixture/ws/Sources/App.swift"]]])
    codexEvent("item/started", ["id":"command","type":"commandExecution"])
    check(codex.progress?.toolsRequested == 1, "Codex request duplicate ignored")
    check(codex.progress?.steps?.first?.label == "App.swift" && codex.progress?.steps?.first?.verb == "read",
          "Codex read action labels the step; raw command not used when actions explain it")
    codexEvent("item/completed", ["id":"command","type":"commandExecution","status":"failed","output":"PRIVATE","aggregatedOutput":"PRIVATE OUTPUT"])
    check(codex.progress?.kind == .toolFailed && codex.progress?.toolsReturned == 1 && codex.tool == nil, "Codex error return clears active")
    check(codex.progress?.steps?.first?.state == .failed, "Codex step state follows the item status")
    codexEvent("item/started", ["id":"shell","type":"commandExecution","command":["/bin/zsh","-lc","GITHUB_TOKEN=" + "gh" + "p_PRIVATEPRIVATEPRIVATE1234 gh pr list"],
        "commandActions":[["type":"unknown","command":"PRIVATE ACTION"]]])
    check(codex.progress?.steps?.last?.verb == "run" && codex.progress?.steps?.last?.label == "GITHUB_TOKEN=… gh pr list",
          "Codex command shown without its shell wrapper, redacted")
    codexEvent("item/started", ["id":"mcp","type":"mcpToolCall","server":"github","tool":"create_issue","arguments":["body":"PRIVATE ARGUMENT"]])
    codexEvent("item/completed", ["id":"mcp","type":"mcpToolCall","server":"github","tool":"create_issue","status":"completed","result":"PRIVATE RESULT"])
    codexEvent("item/started", ["id":"patch","type":"fileChange","changes":[["path":"/fixture/ws/README.md","kind":["type":"add"],"diff":"PRIVATE DIFF"],
        ["path":"/fixture/ws/b.txt","kind":["type":"update"],"diff":"PRIVATE DIFF"]]])
    codexEvent("item/started", ["id":"web","type":"webSearch","query":"swift regex lookbehind"])
    let codexSteps = codex.progress?.steps ?? []
    check(codexSteps.map(\.label) == ["App.swift", "GITHUB_TOKEN=… gh pr list", "github.create_issue", "README.md (+1)", "swift regex lookbehind"] &&
          codexSteps.map(\.verb) == ["read", "run", "mcp", "add", "webSearch"], "Codex item labels by type")
    let codexJSON = String(decoding: try JSONEncoder().encode(codex.progress!), as: UTF8.self)
    check(!codexJSON.contains("PRIVATE") && !codexJSON.contains("gh" + "p_"), "Codex arguments, outputs, diffs and action commands never relayed")
    let codexCount = codex.eventCount
    codexEvent("item/started", ["id":"foreign","type":"fileChange"],thread:"foreign")
    check(codex.eventCount == codexCount, "Codex foreign scope ignored")
    let snapshot = ExecutionStream(workspace: "/fixture/ws")
    let item:[String:Any] = ["id":"snap-command","type":"commandExecution","status":"inProgress","command":"swift build",
        "aggregatedOutput":"PRIVATE OUTPUT"]
    snapshot.ingestCodexTurnSnapshot(items:[item],status:"inProgress",threadID:"t",turnID:"u")
    let first = snapshot.eventCount
    snapshot.ingestCodexTurnSnapshot(items:[item],status:"inProgress",threadID:"t",turnID:"u")
    check(snapshot.eventCount == first, "unchanged Desktop polling adds no progress")
    check(snapshot.progress?.steps?.first?.label == "swift build" && snapshot.progress?.steps?.first?.verb == "run",
          "Desktop snapshot path labels the same way")
    snapshot.ingestCodexTurnSnapshot(items:[["id":"snap-command","type":"commandExecution","status":"completed"]],status:"inProgress",threadID:"t",turnID:"u")
    check(snapshot.progress?.toolsReturned == 1 && snapshot.tool == nil, "Desktop snapshot item status change observed")
    let complete = snapshot.eventCount
    snapshot.ingestCodexTurnSnapshot(items:[item],status:"inProgress",threadID:"other",turnID:"u")
    check(snapshot.eventCount == complete, "Desktop snapshot foreign identity rejected")
    let firstCompleted = ExecutionStream()
    firstCompleted.ingestCodexTurnSnapshot(items:[["id":"done","type":"mcpToolCall","status":"completed"]],status:"completed",threadID:"t",turnID:"u")
    check(firstCompleted.progress?.toolsRequested == 1 && firstCompleted.progress?.toolsReturned == 1 &&
          firstCompleted.progress?.events.contains(where:{$0.kind == .toolStarted}) == false, "first-seen completed snapshot creates no fabricated start notification")
    check(firstCompleted.progress?.steps?.first.map { $0.state == .returned && $0.endedAt == $0.startedAt } == true,
          "first-seen completed snapshot opens a returned step, not a waiting one")
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

    // Size budget: the app ignores activity files over 150,000 bytes.
    let stamp = Date(timeIntervalSince1970: 2_000)
    let longest = NativeStepLabel.redact(String(repeating: "가", count: 400))!
    let fullRing = (1...24).map { index in
        NativeExecutionProgress.Step(id: String(format: "%012x", index), sequence: index, tool: "mcp__server_with_a_long_name__tool_with_a_long_name",
            scope: "subagent:0123456789ab", verb: "webSearch", label: longest, childToolUses: 999_999,
            lastChildTool: String(repeating: "T", count: 96), state: .failed, startedAt: stamp, endedAt: stamp)
    }
    let ringEvents = (13...24).map { NativeExecutionProgress.Event(sequence: $0, kind: .toolFailed, tool: "Bash", scope: "main", observedAt: stamp) }
    let heavy = NativeExecutionProgress(sequence: 24, kind: .toolFailed, tool: "Bash", scope: "main", toolsRequested: 24, toolsReturned: 24,
        activeTools: 0, observedAt: stamp, events: ringEvents, steps: fullRing, backendStatus: "compacting")
    check(heavy.isValid, "maximal step ring is valid")
    let budget = try JSONEncoder().encode(RuntimeActivity(.executing, provider: "claude", publicText: String(repeating: "가", count: 24_000),
                                                          tool: "Bash", progress: heavy))
    check(budget.count < 150_000, "24,000 Korean characters of public text plus a full step ring fit the app's 150,000-byte cap")
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("os1-step-budget-\(UUID())")
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    let activityURL = root.appendingPathComponent("activity.json")
    let oldActivity = ProcessInfo.processInfo.environment["OS1_ACTIVITY_FILE"]
    let oldJournal = ProcessInfo.processInfo.environment["OS1_EVENT_JOURNAL"]
    setenv("OS1_ACTIVITY_FILE", activityURL.path, 1); unsetenv("OS1_EVENT_JOURNAL")
    defer {
        if let oldActivity { setenv("OS1_ACTIVITY_FILE", oldActivity, 1) } else { unsetenv("OS1_ACTIVITY_FILE") }
        if let oldJournal { setenv("OS1_EVENT_JOURNAL", oldJournal, 1) }
    }
    RuntimeActivity.emit(.executing, provider: "claude", publicText: "짧은 공개 응답", tool: "Bash", progress: heavy)
    check(try JSONDecoder().decode(RuntimeActivity.self, from: Data(contentsOf: activityURL)).progress?.steps?.count == 24,
          "steps reach the activity file")
    let oversized = String(repeating: "가", count: 43_000)
    RuntimeActivity.emit(.executing, provider: "claude", publicText: oversized, tool: "Bash", progress: heavy)
    let written = try Data(contentsOf: activityURL)
    let shed = try JSONDecoder().decode(RuntimeActivity.self, from: written)
    check(written.count <= 150_000 && shed.publicText == oversized && shed.progress?.steps == nil && shed.progress?.sequence == 24,
          "near the cap, step labels are shed before public text or lifecycle progress")
    print("Native progress: \(checks) deterministic metadata/privacy/lifecycle checks PASS; no provider calls")
}

/// Field allowlist and redaction, independent of any stream.
func runNativeStepLabelFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
    func redact(_ raw: String) -> String { NativeStepLabel.redact(raw) ?? "<nil>" }
    typealias Ex = NativeStepLabel.Extract
    // Token shapes are assembled at run time: no credential-shaped literal sits
    // in the source, where OS-1's own self-repair secret scan reads diffs.
    let sk = "sk-" + "ant-api03-", ghp = "gh" + "p_", pat = "github_" + "pat_", xox = "xo" + "xb-"
    let akia = "AK" + "IA" + "IOSFODNN7EXAMPLE", aiza = "AI" + "za" + "SyA-1234567890abcdefghijklmnopqrstu"
    let secrets: [(String, [String])] = [
        ("export ANTHROPIC_API_KEY=" + sk + "abcdefghijklmnopqrstuvwxyz0123 && ./run", [sk, "abcdefghijklmnop"]),
        ("curl -H 'Authorization: Bearer abc.def.ghi' https://user:pw@api.example.com/v1?token=XYZSECRET#frag", ["abc.def", "pw@", "XYZSECRET", "frag"]),
        ("mysql --password hunter2 -u root", ["hunter2"]),
        ("psql password=hunter2 host=db", ["hunter2"]),
        ("GITHUB_TOKEN=" + ghp + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 gh pr list", [ghp, "ABCDEFGHIJ"]),
        ("echo " + pat + "11ABCDEFG0123456789_abcdefghijklmnop", [pat]),
        ("slack " + xox + "1234-5678-abcdefghijkl", [xox]),
        ("aws " + akia + " s3 ls", [akia]),
        ("key " + aiza, [aiza]),
        ("jwt " + "ey" + "JhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", ["JhbGci"]),
        ("curl -u x -H 'Authorization: Basic dXNlcjpwYXNzd29yZA=='", ["dXNlcjpwYXNzd29yZA"]),
        ("checksum 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", ["9f86d081884c7d659a2feaa0c55ad015"]),
        ("token a8F3kQ9zL2mX7pR4tY6wB1nC5vH0jD3s here", ["a8F3kQ9zL2mX7pR4tY6wB1nC5vH0jD3s"]),
        ("blob aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3QgcGF5bG9hZA+/== end", ["aGVsbG8gd29ybGQ"]),
        ("API_KEY='quoted secret value' make deploy", ["quoted secret value"]),
        // A cut at 160 characters can expose a fragment that only then looks random.
        (String(repeating: "x ", count: 65) + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5" + String(repeating: "m", count: 240), ["a1b2c3d4e5f6"]),
    ]
    for (raw, forbidden) in secrets {
        let shown = redact(raw)
        check(!forbidden.contains { shown.contains($0) }, "secret survived redaction: \(raw) -> \(shown)")
        check(NativeStepLabel.redact(shown) == shown && NativeStepLabel.isDisplayable(shown), "redaction is idempotent and displayable: \(shown)")
    }
    check(redact("export ANTHROPIC_API_KEY=" + sk + "abcdefghijklmnopqrstuvwxyz0123 && ./run") == "export ANTHROPIC_API_KEY=… && ./run",
          "env assignment keeps its name")
    check(redact("mysql --password hunter2 -u root") == "mysql --password … -u root", "secret flag keeps its name")
    let kept = ["Run the unit tests", "Check token usage in logs", "Sources/OS1Context/NativeExecutionProgress.swift",
                "~/Documents/Codex/OS1-queue-slot-visibility-build224/products/os1-mac-runtime", "git show e0fa67d",
                "Poll the new deployment until terminal status", "읽기 경로 확인", "NativeExecutionProgressFixtureTestsHelpers.swift"]
    for text in kept { check(redact(text) == text, "ordinary label altered: \(text) -> \(redact(text))") }
    check(redact("line1\n\n\t  line2\r\nline3") == "line1 line2 line3", "newlines and runs of whitespace collapse to one space")
    check(redact("abc\u{202E}def\u{2066}ghi\u{0007}") == "abcdefghi", "bidi overrides removed; control character removed")
    check(NativeStepLabel.redact("   \n\t ") == nil && NativeStepLabel.redact("\u{202E}") == nil, "empty after normalisation is no label")
    for long in [String(repeating: "x", count: 1_000), String(repeating: "가", count: 1_000), String(repeating: "🧪", count: 300),
                 String(repeating: "word ", count: 400)] {
        let shown = redact(long)
        check(shown.count <= NativeStepLabel.maximumCharacters && shown.utf8.count <= NativeStepLabel.maximumBytes && shown.hasSuffix("…"),
              "label capped to 160 characters and 480 bytes")
        check(NativeStepLabel.redact(shown) == shown, "a capped label is stable")
    }
    let multiMegabyte = "echo start; " + String(repeating: "A", count: 3_000_000)
    check(redact(multiMegabyte).count <= NativeStepLabel.maximumCharacters, "huge command bounded")

    // Field allowlist per Claude tool.
    func claude(_ tool: String, _ input: [String: Any]?) -> NativeStepLabel.Extract? {
        NativeStepLabel.claude(tool: tool, input: input, workspace: "/ws/proj")
    }
    check(claude("Bash", ["description": "Check available CLIs", "command": "PRIVATE"]) == Ex(verb: nil, label: "Check available CLIs"),
          "Bash description wins over the command")
    check(claude("Bash", ["command": "cd /x && API_KEY=secret123 ./run.sh --token abc"]) == Ex(verb: .run, label: "cd /x && API_KEY=… ./run.sh --token …"),
          "Bash without description shows its command, redacted")
    check(claude("Bash", ["command": String(repeating: "ls -la; ", count: 100)])?.label?.count ?? 999 <= 160, "long command capped")
    check(claude("Bash", [:]) == nil && claude("Bash", nil) == nil, "partial `{}` input gives no label")
    check(claude("Read", ["file_path": "/ws/proj/Sources/a.swift", "offset": 3]) == Ex(verb: .read, label: "Sources/a.swift"), "Read path workspace-relative")
    check(claude("Edit", ["file_path": "/ws/proj/a.swift", "old_string": "PRIVATE OLD", "new_string": "PRIVATE NEW"]) == Ex(verb: .edit, label: "a.swift"),
          "Edit strings never read")
    check(claude("Write", ["file_path": "/ws/proj/b.md", "content": "PRIVATE CONTENT"]) == Ex(verb: .write, label: "b.md"), "Write content never read")
    check(claude("NotebookEdit", ["notebook_path": "/ws/proj/n.ipynb", "new_source": "PRIVATE"]) == Ex(verb: .edit, label: "n.ipynb"), "notebook path")
    check(claude("Agent", ["description": "Explore code", "prompt": "PRIVATE PROMPT"]) == Ex(verb: .agent, label: "Explore code"), "Agent prompt never read")
    check(claude("Task", ["prompt": "PRIVATE PROMPT"]) == nil, "Task without description gives no label")
    check(claude("WebFetch", ["url": "https://u:p@example.com/a/b?key=PRIVATE#x", "prompt": "PRIVATE PROMPT"]) == Ex(verb: .fetch, label: "https://example.com/a/b"),
          "WebFetch URL loses credentials, query, fragment; prompt never read")
    check(claude("WebSearch", ["query": "swift 6 sendable"]) == Ex(verb: .webSearch, label: "swift 6 sendable"), "search query")
    check(claude("Grep", ["pattern": "func observe", "path": "/ws/proj/Sources", "output_mode": "content"]) == Ex(verb: .search, label: "func observe · Sources"),
          "Grep pattern and path")
    check(claude("Glob", ["pattern": "**/*.swift"]) == Ex(verb: .find, label: "**/*.swift"), "Glob pattern")
    check(claude("TodoWrite", ["todos": [["content": "A", "status": "completed", "activeForm": "Doing A"],
                                         ["content": "B", "status": "in_progress", "activeForm": "Running B"]]]) == Ex(verb: nil, label: "Running B"),
          "TodoWrite shows the in-progress activeForm")
    check(claude("mcp__github__create_issue", ["body": "PRIVATE ARGUMENT"]) == Ex(verb: .mcp, label: "github.create_issue"), "MCP name only")
    check(claude("ExitPlanMode", ["plan": "PRIVATE PLAN"]) == nil && claude("Skill", ["skill": "x", "args": "PRIVATE"]) == nil,
          "tools outside the allowlist give no label")
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    check(NativeStepLabel.displayPath(home + "/notes/x.txt", workspace: "/ws/proj") == "~/notes/x.txt", "home-relative path")
    check(NativeStepLabel.displayPath("/ws/proj", workspace: "/ws/proj/") == "." &&
          NativeStepLabel.displayPath("/ws/projector/a", workspace: "/ws/proj") == "/ws/projector/a", "workspace prefix is a path boundary")
    check(NativeStepLabel.displayPath("file:///ws/proj/c.swift", workspace: "/ws/proj") == "c.swift", "file URI reduced to a path")

    // Codex items.
    func codex(_ item: [String: Any]) -> NativeStepLabel.Extract? { NativeStepLabel.codex(item: item, workspace: "/ws/proj") }
    check(codex(["type": "commandExecution", "command": "rg -n PRIVATE", "cwd": "/ws/proj",
                 "commandActions": [["type": "search", "command": "PRIVATE", "query": "observe", "path": "Sources"]]]) ==
          Ex(verb: .search, label: "observe · Sources"), "Codex search action")
    check(codex(["type": "commandExecution", "command": "ls", "commandActions": [["type": "listFiles", "command": "PRIVATE", "path": "/ws/proj/docs"],
                                                                                  ["type": "read", "command": "PRIVATE", "name": "a.md", "path": "a.md"]]]) ==
          Ex(verb: .list, label: "docs (+1)"), "Codex action list with a count")
    check(codex(["type": "commandExecution", "command": "bash -c \"npm test -- --password=hunter2\"", "commandActions": [["type": "unknown", "command": "x"]]]) ==
          Ex(verb: .run, label: "npm test -- --password=…"), "Codex unknown action shows the redacted command")
    check(codex(["type": "commandExecution", "command": 42]) == nil, "unknown command shape gives no label")
    check(codex(["type": "fileChange", "changes": [["path": "/ws/proj/gone.txt", "kind": ["type": "delete"], "diff": "PRIVATE"]]]) ==
          Ex(verb: .delete, label: "gone.txt"), "Codex delete")
    check(codex(["type": "webSearch", "query": "", "action": ["type": "openPage", "url": "https://example.com/p?sig=PRIVATE"]]) ==
          Ex(verb: .fetch, label: "https://example.com/p"), "Codex open page")
    check(codex(["type": "mcpToolCall", "server": "fs", "arguments": ["path": "PRIVATE"]]) == nil, "MCP without a tool name gives no label")
    print("Native step labels: \(checks) allowlist/redaction/idempotence checks PASS; no provider calls")
}
