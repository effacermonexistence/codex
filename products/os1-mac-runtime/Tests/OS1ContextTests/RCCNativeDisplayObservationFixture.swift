import Darwin
import Foundation
import OS1Context

private enum RCCNativeDisplayFixtureError: Error { case failed(String) }
func runRCCNativeDisplayObservationFixtures() throws {
    typealias C = RCCRuntimeContract
    typealias O = RCCNativeDisplayObservation
    var checks = 0
    func check(_ condition: Bool, _ name: String) throws {
        guard condition else { throw RCCNativeDisplayFixtureError.failed(name) }; checks += 1
    }
    let now = Date(), session = UUID().uuidString.lowercased(), turn = UUID().uuidString.lowercased()
    try check(RCCRuntimeProjection.shouldRefreshDisplay(previousRevision:-1,previousAt:nil,revision:1,now:now),"first Core snapshot emits immediately")
    try check(!RCCRuntimeProjection.shouldRefreshDisplay(previousRevision:1,previousAt:now,revision:1,now:now.addingTimeInterval(0.99)),"same-revision display refresh bounded below one hertz")
    try check(RCCRuntimeProjection.shouldRefreshDisplay(previousRevision:1,previousAt:now,revision:1,now:now.addingTimeInterval(1)),"same Core revision refreshes native observation on existing poll")
    try check(RCCRuntimeProjection.shouldRefreshDisplay(previousRevision:1,previousAt:now,revision:2,now:now.addingTimeInterval(0.1)),"new lifecycle revision is not delayed by display throttle")
    try check(!RCCRuntimeProjection.shouldRefreshDisplay(previousRevision:2,previousAt:now,revision:1,now:now.addingTimeInterval(5)),"display throttle never admits a regressed Core revision")

    let attempt = UUID().uuidString.lowercased(), receiptID = UUID().uuidString.lowercased()
    let h = C.digest(Data("display-fixture".utf8)), conversation = UUID(), submission = UUID()
    let config = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture",
        model: "requested-model", effort: .high, tools: ["read"], scope: .readOnly, permissionProfile: .readOnly,
        quotaPool: .openAICodex, allowedPaths: [], configurationSHA256: h)
    let ticket = C.ExecutionTicket(taskID: "task", nodeID: "child", attemptID: attempt, candidateID: "candidate",
        requestSHA256: h, policySHA256: h, policySourceSHA256: h, sourceFingerprint: h,
        configurationSHA256: h, selectedConfig: config, objective: "fixture", instruction: "fixture", contextRefs: [], ownedPaths: [])
    let temp = FileManager.default.temporaryDirectory.appendingPathComponent("os1-ui-observation-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: temp) }
    let receiptPath = temp.appendingPathComponent(".os1/rcc-runtime/native-receipts/" + receiptID + ".json").path
    let nativePath = temp.appendingPathComponent("rollout-" + session + ".jsonl").path
    let metadata = try [
        ["type": "session_meta", "payload": ["id": session]],
        ["type": "turn_context", "payload": ["turn_id": turn, "model": "observed-model", "effort": "medium"]],
        ["type": "response_item", "payload": ["type": "reasoning", "text": "SECRET_REASONING_MUST_NOT_SURFACE"]]
    ].map { try JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys]) + Data([10]) }.reduce(Data(), +)
    try metadata.write(to: URL(fileURLWithPath: nativePath)); try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: nativePath)
    try check(RCCNativeDisplayStore.readNativeMetadata(nativePath) == metadata, "exact owner0600 native metadata accepted")
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: nativePath)
    try check(RCCNativeDisplayStore.readNativeMetadata(nativePath) == metadata, "provider-owned0644 metadata accepted without changing source")
    for mode in [0o620, 0o602, 0o666, 0o755] {
        try FileManager.default.setAttributes([.posixPermissions: mode], ofItemAtPath: nativePath)
        try check(RCCNativeDisplayStore.readNativeMetadata(nativePath) == nil, "unsafe native mode rejected: " + String(mode, radix: 8))
    }
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: nativePath)
    let linkedNative = temp.appendingPathComponent("linked-native.jsonl")
    try FileManager.default.linkItem(at: URL(fileURLWithPath: nativePath), to: linkedNative)
    try check(RCCNativeDisplayStore.readNativeMetadata(nativePath) == nil, "multi-link native metadata rejected")
    try FileManager.default.removeItem(at: linkedNative)
    let aliasedNative = temp.appendingPathComponent("aliased-native.jsonl")
    try FileManager.default.createSymbolicLink(at: aliasedNative, withDestinationURL: URL(fileURLWithPath: nativePath))
    try check(RCCNativeDisplayStore.readNativeMetadata(aliasedNative.path) == nil, "native symlink rejected")
    let nativeFIFO = temp.appendingPathComponent("native-fifo.jsonl")
    try check(mkfifo(nativeFIFO.path,0o600) == 0, "native FIFO fixture created")
    try check(RCCNativeDisplayStore.readNativeMetadata(nativeFIFO.path) == nil, "native FIFO rejected without blocking")
    let settings = O.observedSettings(metadata, provider: "codex", sessionID: session, turnID: turn)
    try check(settings?.model == "observed-model" && settings?.effort == "medium", "exact native turn settings, not selected values")
    try check(O.observedSettings(metadata, provider: "codex", sessionID: UUID().uuidString, turnID: turn) == nil, "foreign native session rejected")
    try check(O.observedSettings(metadata, provider: "codex", sessionID: session, turnID: UUID().uuidString) == nil, "old turn context cannot be selected")
    try check(O.observedSettings(metadata.dropLast(), provider: "codex", sessionID: session, turnID: turn) == nil, "partial native row is not observation")
    let conflict = metadata + (try JSONSerialization.data(withJSONObject: ["type":"turn_context","payload":["turn_id":turn,"model":"other","effort":"high"]])) + Data([10])
    try check(O.observedSettings(conflict, provider: "codex", sessionID: session, turnID: turn) == nil, "conflicting exact-turn settings omitted")
    func claudeRow(_ model: String, _ text: String, sessionID: String = session, timestamp: Date = now) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["type":"assistant", "sessionId":sessionID, "timestamp":ISO8601DateFormatter().string(from:timestamp),
            "message":["model":model, "content":[["type":"thinking","thinking":"SECRET"], ["type":"text","text":text]]]]) + Data([10])
    }
    let outputHash = C.digest(Data("CURRENT_VISIBLE_OUTPUT".utf8))
    let claude = try claudeRow("claude-old", "OLD_OUTPUT") + claudeRow("claude-actual", "CURRENT_VISIBLE_OUTPUT")
    let cs = O.observedSettings(claude, provider: "claude", sessionID: session, turnID: nil, finalOutputSHA256: outputHash, notBefore:now.addingTimeInterval(-1),notAfter:now.addingTimeInterval(1))
    try check(cs?.model == "claude-actual" && cs?.effort == nil && cs?.outputSHA256 == outputHash, "Claude exact output-linked model never invents reasoning")
    try check(O.observedSettings(claude,provider:"claude",sessionID:session,turnID:nil)==nil,"Claude session alone is not an exact-attempt model witness")
    let late = try claude + claudeRow("claude-late", "OTHER_OUTPUT")
    try check(O.observedSettings(late,provider:"claude",sessionID:session,turnID:nil,finalOutputSHA256:outputHash,notBefore:now.addingTimeInterval(-1),notAfter:now.addingTimeInterval(1))?.model == "claude-actual", "late different-output same-session assistant cannot replace current model")
    let ambiguous = try claude + claudeRow("claude-late", "CURRENT_VISIBLE_OUTPUT")
    try check(O.observedSettings(ambiguous,provider:"claude",sessionID:session,turnID:nil,finalOutputSHA256:outputHash,notBefore:now.addingTimeInterval(-1),notAfter:now.addingTimeInterval(1))==nil,"repeated same-output old/current/late assistant is ambiguous, not last-row guess")
    try check(O.observedSettings(try claudeRow("claude-other", "CURRENT_VISIBLE_OUTPUT", sessionID:UUID().uuidString),provider:"claude",sessionID:session,turnID:nil,finalOutputSHA256:outputHash,notBefore:now.addingTimeInterval(-1),notAfter:now.addingTimeInterval(1))==nil,"foreign same-output Claude session rejected")
    let oldOnly = try claudeRow("claude-old", "CURRENT_VISIBLE_OUTPUT", timestamp:now.addingTimeInterval(-10)) + JSONSerialization.data(withJSONObject:["type":"system","timestamp":ISO8601DateFormatter().string(from:now)]) + Data([10])
    try check(O.observedSettings(oldOnly,provider:"claude",sessionID:session,turnID:nil,finalOutputSHA256:outputHash,notBefore:now.addingTimeInterval(-1),notAfter:now.addingTimeInterval(1)) == nil,"old same-output assistant plus unrelated new event cannot supply current model")
    try check(O.observedSettings(claude,provider:"claude",sessionID:session,turnID:nil,finalOutputSHA256:outputHash) == nil,"Claude missing current-attempt time anchor stays unknown")
    let progress = NativeExecutionProgress(sequence: 1, kind: .processing, tool: nil, scope: "main",
        toolsRequested: 0, toolsReturned: 0, activeTools: 0, observedAt: now,
        events: [.init(sequence: 1, kind: .processing, tool: nil, scope: "main", observedAt: now)], stream: "0123456789ab")
    var observation = O(ticket: ticket, nativeReceipt: receiptPath, workspace: temp.path, observedAt: now)
    observation.sessionID = session; observation.progress = progress
    var core = C.Snapshot(taskID: "task", requestSHA256: h, state: .running, revision: 1,
        children: [.init(id: "child", state: .running, attemptID: attempt, candidateID: "candidate", selectedConfig: config,
            startedAtMS: Int64(now.timeIntervalSince1970 * 1000))], result: nil, error: nil)
    func graph(_ value: O?, receipts: [String: Data] = [:], current: C.Snapshot? = nil,
               previous: ParallelAgentTask.Snapshot? = nil) throws -> ParallelAgentTask.Snapshot {
        var evidence = receipts
        if let value { evidence[O.key(attempt)] = try JSONEncoder().encode(value) }
        return try RCCRuntimeProjection.project(current ?? core, conversationID: conversation, submissionID: submission,
            objective: "fixture", observedAt: now.addingTimeInterval(60), firstObservedAt: now,
            maxParallelism: 2, expectedRequestSHA256: h, previous: previous, nativeReceipts: evidence)
    }
    try check(observation.isValid, "constructed running observation valid")
    try check(O.decode(try JSONEncoder().encode(observation)) != nil, "running observation roundtrip valid")
    let live = try graph(observation)
    try check(live.nodes.count == 2 && live.nodes.last?.nativeProgress?.sequence == progress.sequence && live.nodes.last?.workspace == temp.path,
        "one actual child displays own progress and cwd while running")
    try check(live.nodes.last?.provider == "codex" && live.nodes.last?.model == nil && live.nodes.last?.effort == nil && live.nodes[0].state == .running,
        "live observation is not selected settings, execution verification or completion")
    try check(try graph(nil).nodes.last?.nativeProgress == nil, "missing evidence remains unknown")
    var cancelled=core; cancelled.state = .cancelled; cancelled.children[0].state = .cancelled
    cancelled.children[0].finishedAtMS=Int64(now.timeIntervalSince1970*1000)
    try check(try graph(observation,current:cancelled).nodes.last?.nativeProgress == nil,"cancelled current attempt cannot inherit unsealed live event")

    // Publisher/session scope is isolated; no activity file, backend, model or HOME access.
    let publisher = RCCNativeDisplayStore.Publisher(ticket: ticket, nativeReceipt: receiptPath, workspace: temp.path, homeDirectory: temp, now: now)
    publisher.activity(.init(.executing,provider:"codex",progress:progress))
    try check(RCCNativeDisplayStore.load(core,homeDirectory:temp).isEmpty,"progress before own native session/dispatch cannot decorate child")
    publisher.session(session)
    // Match production's ASYNC withValue overload. The optimized synchronous
    // overload crashes in task-local push on this host, even inside a Task.
    // Keep the same real sink/publication assertions, with a bounded completion.
    let sinkFinished = DispatchSemaphore(value: 0)
    Task.detached {
        await RuntimeActivity.Observation.$sink.withValue({ publisher.activity($0) }, operation: { () async -> Void in
            RuntimeActivity.emit(.executing, provider: "codex", model: "REQUESTED_NOT_ACTUAL", effort: "ultra", publicText: "SECRET_PUBLIC_PROSE_NOT_COPIED", progress: progress)
        })
        sinkFinished.signal()
    }
    guard sinkFinished.wait(timeout: .now() + 10) == .success else {
        throw RCCNativeDisplayFixtureError.failed("async scoped sink did not complete within fixture budget")
    }
    let loaded = RCCNativeDisplayStore.load(core, homeDirectory: temp)
    let captured = loaded[O.key(attempt)].flatMap(O.decode)
    try check(captured?.progress == progress && captured?.model == nil && captured?.effort == nil, "scoped sink works without activity env and excludes requested settings")
    try check(!String(decoding: loaded[O.key(attempt)] ?? Data(), as: UTF8.self).contains("SECRET_PUBLIC_PROSE"), "sink never copies output/prose")
    let summary = try JSONSerialization.data(withJSONObject: ["steps": [["provider":"codex", "surface":"codex", "session_id":session, "exit_code":0,
        "native_record":["record_path":nativePath,"persistence":"verified","turn_id":turn]]]])
    let record = C.ExecutionRecord(taskID:"task",nodeID:"child",attemptID:attempt,candidateID:"candidate",configurationSHA256:h,
        selectedConfig:config,acknowledgedConfig:config,observedConfig:nil,status:.succeeded,output:"PRIVATE_ANSWER",executionVerified:true,
        taskVerified:false,taskQuality:.executionOnly,parityState:.unverified,nativeReceipt:receiptPath,sideEffects:.none,usage:nil,
        dispatchStage:.dispatched,nativeSummary:String(decoding:summary,as:UTF8.self))
    let receipt = try C.encode(record)
    core.children[0].nativeReceipt = receiptPath; core.children[0].state = .completed
    core.children[0].finishedAtMS = Int64(now.timeIntervalSince1970 * 1000)
    core.state = .returnedUnverified
    core.result = .init(output:"PRIVATE_ANSWER",executionVerified:true,taskVerified:false,parityState:.unverified,nativeReceipt:receiptPath)
    publisher.finish(sessionID:session,turnID:turn,nativePath:nativePath,persistence:"verified",receipt:receipt)
    var terminal = RCCNativeDisplayStore.load(core,homeDirectory:temp)
    terminal[receiptPath] = receipt
    let terminalGraph = try RCCRuntimeProjection.project(core,conversationID:conversation,submissionID:submission,objective:"fixture",
        observedAt:Date().addingTimeInterval(2),firstObservedAt:now,maxParallelism:2,expectedRequestSHA256:h,nativeReceipts:terminal)
    try check(terminalGraph.nodes.last?.model == "observed-model" && terminalGraph.nodes.last?.effort == "medium",
        "actual publisher/native metadata/receipt/loader/projection path displays observed model+effort")
    try check(terminalGraph.nodes[0].state == .blocked && terminalGraph.nodes.last?.progressText?.contains("selected codex / requested-model / high") == true,
        "observed settings do not upgrade parent quality or replace selected configuration")
    let publicBytes = String(decoding:try terminalGraph.encoded(),as:UTF8.self)
    try check(!publicBytes.contains("SECRET_REASONING") && !publicBytes.contains("PRIVATE_ANSWER") && !publicBytes.contains(nativePath) && !publicBytes.contains(receiptPath),
        "no native path, reasoning, raw answer or receipt bytes enter public graph")
    var final = try JSONDecoder().decode(O.self,from:terminal[O.key(attempt)]!)
    func omitted(_ name:String,_ mutate:(inout O)->Void) throws {
        var value=final;mutate(&value)
        let child=try graph(value,receipts:[receiptPath:receipt]).nodes.last!
        try check(child.model == nil && child.effort == nil && child.nativeProgress == nil && child.workspace == nil,name)
    }
    try omitted("future observation omitted") {$0.observedAt=now.addingTimeInterval(200)}
    try omitted("old native session omitted") {$0.sessionID=UUID().uuidString.lowercased()}
    try omitted("old native turn omitted") {$0.turnID=UUID().uuidString.lowercased()}
    try omitted("receipt hash mismatch omitted") {$0.receiptSHA256=String(repeating:"b",count:64)}
    try omitted("selected basis cannot claim actual") {$0.settingsBasis="selected_config"}
    try omitted("ACK basis cannot claim actual") {$0.settingsBasis="acknowledged_config"}
    var next=core;next.children[0].attemptID=UUID().uuidString.lowercased()
    let nextGraph=try graph(final,receipts:[receiptPath:receipt],current:next,previous:terminalGraph)
    try check(nextGraph.nodes.last?.model == nil && nextGraph.nodes.last?.nativeProgress == nil,"prior graph cannot carry old attempt data")
    var raw=try JSONSerialization.jsonObject(with:JSONEncoder().encode(final)) as! [String:Any]
    for (key,bad) in [("taskID","other"),("nodeID","other"),("candidateID","other"),("configurationSHA256",String(repeating:"b",count:64)),("requestSHA256",String(repeating:"b",count:64)),("nativeReceipt","/tmp/"+UUID().uuidString+".json")] {
        var changed=raw;changed[key]=bad
        let bytes=try JSONSerialization.data(withJSONObject:changed)
        let child=try RCCRuntimeProjection.project(core,conversationID:conversation,submissionID:submission,objective:"fixture",observedAt:Date().addingTimeInterval(2),firstObservedAt:now,maxParallelism:2,
            nativeReceipts:[O.key(attempt):bytes,receiptPath:receipt]).nodes.last!
        try check(child.model == nil && child.nativeProgress == nil,"bound field mismatch omitted: "+key)
    }
    var oldStart = raw; oldStart["attemptStartedAt"] = now.addingTimeInterval(-10).timeIntervalSinceReferenceDate
    let oldStartGraph = try RCCRuntimeProjection.project(core,conversationID:conversation,submissionID:submission,objective:"fixture",observedAt:Date().addingTimeInterval(2),firstObservedAt:now,maxParallelism:2,
        nativeReceipts:[O.key(attempt):try JSONSerialization.data(withJSONObject:oldStart),receiptPath:receipt])
    try check(oldStartGraph.nodes.last?.model == nil && oldStartGraph.nodes.last?.nativeProgress == nil,"observation cannot widen attempt history before Core child start")
    raw["publicOutput"]="SECRET"
    try check(O.decode(try JSONSerialization.data(withJSONObject:raw)) == nil,"unknown fields fail closed")
    let file=temp.appendingPathComponent(".os1/rcc-runtime/native-display/"+attempt+".json")
    try FileManager.default.setAttributes([.posixPermissions:0o644],ofItemAtPath:file.path)
    try check(RCCNativeDisplayStore.load(core,homeDirectory:temp).isEmpty,"public-readable observation rejected")
    try FileManager.default.removeItem(at:file)
    try FileManager.default.createSymbolicLink(at:file,withDestinationURL:URL(fileURLWithPath:nativePath))
    try check(RCCNativeDisplayStore.load(core,homeDirectory:temp).isEmpty,"symlink observation rejected")
    try FileManager.default.removeItem(at:file)
    try check(mkfifo(file.path,0o600)==0,"FIFO fixture created")
    try check(RCCNativeDisplayStore.load(core,homeDirectory:temp).isEmpty,"FIFO rejected without blocking")
    try FileManager.default.removeItem(at:file)
    final.model=nil;final.effort=nil;final.settingsBasis=nil;final.settingsSourceSHA256=nil;final.settingsOutputSHA256=nil
    try check(final.isValid,"legitimate metadata gap remains valid unknown")
    print("RCC native display observation: \(checks) deterministic checks PASS; model/SDK/RPC calls 0; temporary fixture custody only")
}
