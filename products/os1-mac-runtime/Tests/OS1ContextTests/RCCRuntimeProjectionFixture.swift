import Foundation
import OS1Context

private enum RCCRuntimeProjectionFixtureError: Error { case failed(String) }
func runRCCRuntimeProjectionFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ name: String) throws {
        guard condition else { throw RCCRuntimeProjectionFixtureError.failed(name) }; checks += 1
    }
    func rejects(_ name: String, _ body: () throws -> Void) throws {
        do { try body() } catch { checks += 1; return }
        throw RCCRuntimeProjectionFixtureError.failed("accepted invalid: " + name)
    }
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let conversation = UUID(), submission = UUID()
    let request = "Inspect the requested project only."
    let hash = SourceContextStore.digest(Data(request.utf8))
    func project(_ core: RCCRuntimeContract.Snapshot, at: Date = now, previous: ParallelAgentTask.Snapshot? = nil,
                 nativeReceipts: [String: Data] = [:]) throws -> ParallelAgentTask.Snapshot {
        try RCCRuntimeProjection.project(core, conversationID: conversation, submissionID: submission,
            objective: request, observedAt: at, firstObservedAt: now, maxParallelism: 4,
            expectedRequestSHA256: hash, previous: previous, nativeReceipts: nativeReceipts)
    }
    var core = RCCRuntimeContract.Snapshot(taskID: "task", requestSHA256: hash, state: .queued, revision: 1,
        children: [], result: nil, error: nil)
    let queued = try project(core)
    try check(queued.nodes.count == 1 && queued.nodes[0].state == .pending, "no fabricated children before plan")
    var interpreting = core
    interpreting.state = .planning
    interpreting.routingIntent = .init(state: .resolving, notices: [])
    let interpretingGraph = try project(interpreting)
    try check(interpretingGraph.nodes.count == 1 && interpretingGraph.nodes[0].state == .running &&
        interpretingGraph.nodes[0].progressText?.contains("interpreting the original request") == true,
        "Core interpretation is a real recorded root, not invented parallel workers")
    interpreting.state = .held
    interpreting.routingIntent = .init(state: .held, notices: [], reason: "ambiguous_recipient")
    let intentHeldGraph = try project(interpreting)
    try check(intentHeldGraph.nodes.count == 1 && intentHeldGraph.nodes[0].state == .blocked &&
        intentHeldGraph.nodes[0].progressText?.contains("ambiguous_recipient") == true &&
        intentHeldGraph.nodes[0].progressText == RCCRuntimeProjection.rootDescription(interpreting),
        "Core intent hold remains visible before provider dispatch")
    core.state = .running
    core.children = [.init(id: "one", state: .running, attemptID: "attempt", candidateID: "candidate")]
    let single = try project(core)
    try check(single.nodes.count == 2 && single.nodes.filter { $0.role == .worker }.count == 1, "one actual child visible")
    try check(single.nodes.allSatisfy { $0.model == nil && $0.effort == nil && $0.provider == nil }, "unknown execution configuration not invented")
    try check(single.nodes.last?.title == "Task 1 · one", "legacy child without requested identity keeps existing title")
    try check(single.nodes.last?.progressText?.contains("first observation") == true, "missing native timestamp stays labelled observation")
    let later = try project(core, at: now.addingTimeInterval(2), previous: single)
    try check(single.planID == later.planID && single.nodes.map(\.id) == later.nodes.map(\.id), "stable display identities")
    try check(single.nodes.last?.startedAt == later.nodes.last?.startedAt, "observer clock does not reset on each poll")
    var heldTargets = core; heldTargets.state = .held
    let targetSurfaces: [RCCRuntimeContract.Surface] = [.chatgpt, .codex, .claudeChat, .claude]
    heldTargets.children = targetSurfaces.enumerated().map { index, surface in
        .init(id: "requested-\(index + 1)", state: .held, attemptID: nil, candidateID: nil,
              instruction: "\(index + 1)+\(index + 1)", requestedSurface: surface)
    }
    let heldTargetGraph = try project(heldTargets)
    let heldWorkers = heldTargetGraph.nodes.filter { $0.role == .worker }
    try check(heldWorkers.map(\.title) == ["ChatGPT · 1+1", "Codex · 2+2", "Claude chat · 3+3", "Claude Code · 4+4"],
              "four literal requested target names and probes survive unavailable route hold")
    try check(heldWorkers.count == 4 && heldWorkers.allSatisfy { $0.state == .blocked },
              "unavailable explicit targets remain four held children, never fabricated execution")
    try check(heldWorkers.allSatisfy { $0.provider == nil && $0.surface == nil && $0.model == nil &&
        $0.effort == nil && $0.nativeSessionID == nil }, "requested title never upgrades to native observation")
    try check(heldWorkers[0].progressText?.contains("requested ChatGPT") == true &&
        heldWorkers[0].progressText?.contains("execution configuration not exposed") == true,
              "requested and execution configuration are explicitly separated")
    heldTargets.children[0].instruction = "Private source or credential details must not enter a public title"
    try check(try project(heldTargets).nodes[1].title == "ChatGPT",
              "arbitrary private instruction does not leak through a requested target title")
    core.children = (0..<4).map { .init(id: "node\($0)", state: .running, attemptID: "attempt\($0)", candidateID: "candidate\($0)",
                                    startedAtMS: Int64(now.timeIntervalSince1970 * 1000)) }
    let four = try project(core)
    try check(four.nodes.filter { $0.role == .worker && $0.state == .running }.count == 4, "four real parallel children")
    core.children[1].dependencies = ["node0"]
    try rejects("running before dependency succeeds") { _ = try project(core) }
    core.children[0].state = .succeeded
    core.children[0].finishedAtMS = Int64(now.timeIntervalSince1970 * 1000)
    _ = try project(core); checks += 1
    core.children[1].state = .effectsUncertain
    core.children[1].dependencies = nil
    let uncertain = try project(core)
    try check(uncertain.nodes.first { $0.id == four.nodes[2].id }?.state == .interrupted, "uncertain effect never success")
    core.children = [.init(id: "one", state: .succeeded, attemptID: "attempt", candidateID: "candidate", startedAtMS: 1_800_000_000_000,
                           finishedAtMS: 1_800_000_000_000)]
    core.state = .returnedUnverified
    core.result = .init(output: "Private raw result must not enter public graph", executionVerified: true,
                        taskVerified: false, parityState: .unverified, nativeReceipt: "private-record")
    let candidate = try project(core)
    try check(candidate.nodes[0].state != .succeeded, "unverified return not task success")
    try check(!String(decoding: try candidate.encoded(), as: UTF8.self).contains("Private raw result"), "raw output not leaked to public graph")
    // One owner-facing label per Core state: OS-1 Fleet's signed receipt
    // carries the same text (`rootDescription`) as this root's progress.
    try check(candidate.nodes[0].progressText == RCCRuntimeProjection.rootDescription(core)
              && RCCRuntimeProjection.rootDescription(core) == "Output returned · task quality unverified; candidate retained.",
              "graph root and fleet share the unverified label")
    var staged = core
    staged.state = .awaitingInstall
    staged.installHandoff = .init(taskID: staged.taskID, requestSHA256: hash, nodeID: "one", parentAttemptID: "attempt",
        sourceFingerprint: String(repeating: "a", count: 64), sourceRoot: "/tmp/fixture-source",
        sourceHead: String(repeating: "b", count: 40), protectedSourceSHA256: String(repeating: "c", count: 64),
        stagedIntentID: "fixture-intent", stagedReceiptSHA256: String(repeating: "d", count: 64), state: .staged)
    let stagingGraph = try project(staged)
    try check(stagingGraph.nodes[0].state == .running && stagingGraph.nodes[0].finishedAt == nil,
              "awaiting installation is unfinished, never task success")
    try check(stagingGraph.nodes[0].progressText == RCCRuntimeProjection.rootDescription(staged)
              && RCCRuntimeProjection.rootDescription(staged).contains("installation pending; task is not complete"),
              "graph root and fleet share the pending-installation label")
    let binding = try RCCRuntimeProjection.InstallationBinding(staged, submissionID: submission, objective: request, firstObservedAt: now)
    let decodedBinding = try JSONDecoder().decode(RCCRuntimeProjection.InstallationBinding.self, from: JSONEncoder().encode(binding))
    try check(binding == decodedBinding && (try binding.accepts(staged)), "original install binding persists across GUI restart")
    var installed = staged; installed.state = .returnedUnverified; installed.revision += 1
    installed.installHandoff?.state = .installed; installed.installHandoff?.installedReceipt = "/tmp/private-install-receipt.json"
    try check(try binding.accepts(installed), "exact installed receipt reconciles original staged task")
    try check(RCCRuntimeProjection.InstallationBinding.isResolved(installed) && !RCCRuntimeProjection.InstallationBinding.isResolved(staged),
              "observer delivery is separate from original task resolution")
    var heldStage = staged; heldStage.state = .held
    try check(!RCCRuntimeProjection.InstallationBinding.isResolved(heldStage), "temporary stage hold cannot discard unfinished installation")
    var unknownInstall = staged; unknownInstall.state = .effectsUncertain; unknownInstall.installHandoff?.state = .effectsUncertain
    try check(!RCCRuntimeProjection.InstallationBinding.isResolved(unknownInstall), "uncertain installation retains eventual receipt observation")
    var wrongInstall = installed; wrongInstall.installHandoff?.stagedIntentID = "another-intent"
    try check(try !binding.accepts(wrongInstall), "another staged artifact cannot complete this task")
    wrongInstall = installed; wrongInstall.installHandoff?.protectedSourceSHA256 = String(repeating: "e", count: 64)
    try check(try !binding.accepts(wrongInstall), "source mutation cannot inherit prior stage proof")
    wrongInstall = installed; wrongInstall.revision = 0
    try check(try !binding.accepts(wrongInstall), "stale installation observation rejected")
    var noHandoff = installed; noHandoff.installHandoff = nil
    try check(try !binding.accepts(noHandoff), "new build alone is not proof this task installed")
    core.state = .completed; core.result?.taskVerified = true
    let complete = try project(core)
    try check(complete.nodes[0].state == .succeeded, "task-verified completion represented faithfully")
    var foreign = core; foreign.requestSHA256 = String(repeating: "b", count: 64)
    try rejects("request binding") { _ = try project(foreign) }
    var overflow = core; overflow.children = (0..<9).map { .init(id: "n\($0)", state: .pending, attemptID: nil, candidateID: nil) }
    try rejects("do not silently omit extra children") { _ = try project(overflow) }
    var future = core; future.children[0].startedAtMS = 1_800_000_001_000
    try rejects("future timestamp") { _ = try project(future) }
    try check(try ParallelAgentTask.Snapshot.decode(complete.encoded(), conversationID: conversation,
        submissionID: submission, requestSHA256: hash).isValid, "existing UI wire roundtrip")

    // Match the real one-step native receipt shape without reading HOME, native
    // records or any provider. A returned parent remains quality-unverified.
    typealias C = RCCRuntimeContract
    let nativeSession = "01a1308f-84b1-71c3-b092-7489ccd3184b"
    let nativeTurn = "01a13181-abde-7ec3-8e4d-82879aa03824"
    let receiptPath = "/tmp/private-native-display/439aa224-a623-479e-a48c-38ddb32cba29.json"
    let nativePath = "/tmp/private-native-detail/rollout-" + nativeSession + ".jsonl"
    let privacyMarker = "PRIVATE_NATIVE_OUTPUT_AND_INSTRUCTIONS_MUST_NOT_LEAK"
    let configuration = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture-account",
        model: "fixture-model", effort: .high, tools: ["read", "execute"], scope: .readOnly,
        permissionProfile: .readOnly, quotaPool: .openAICodex, allowedPaths: [], configurationSHA256: hash)
    func summary(provider: String = "codex", surface: String = "codex", session: String = nativeSession,
                 persistence: String = "verified", path: String = nativePath,
                 turn: String? = nativeTurn, count: Int = 1, exitCode: Any = 0) throws -> String {
        let record: [String: Any] = ["persistence": persistence, "record_path": path,
                                    "turn_id": turn as Any? ?? NSNull()]
        let step: [String: Any] = ["provider": provider, "surface": surface, "session_id": session,
            "exit_code": exitCode, "native_record": record, "output": privacyMarker,
            "stderr": privacyMarker, "model": "PRIVATE_REQUESTED_MODEL", "effort": "PRIVATE_REQUESTED_EFFORT"]
        return String(decoding: try JSONSerialization.data(withJSONObject:
            ["status": "returned_unverified", "steps": Array(repeating: step, count: count),
             "private_instructions": privacyMarker], options: [.sortedKeys, .withoutEscapingSlashes]), as: UTF8.self)
    }
    let proofCore = C.Snapshot(taskID: "task", requestSHA256: hash, state: .returnedUnverified, revision: 10,
        children: [.init(id: "one", state: .completed, attemptID: "attempt", candidateID: "candidate",
            selectedConfig: configuration, startedAtMS: 1_800_000_000_000,
            finishedAtMS: 1_800_000_000_000, nativeReceipt: receiptPath)],
        result: .init(output: privacyMarker, executionVerified: true, taskVerified: false,
                      parityState: .unverified, nativeReceipt: receiptPath), error: nil)
    let proofRecord = C.ExecutionRecord(taskID: proofCore.taskID, nodeID: "one", attemptID: "attempt",
        candidateID: "candidate", configurationSHA256: hash, selectedConfig: configuration,
        acknowledgedConfig: configuration, observedConfig: nil, status: .succeeded, output: privacyMarker,
        executionVerified: true, taskVerified: false, taskQuality: .executionOnly, parityState: .unverified,
        nativeReceipt: receiptPath, sideEffects: .none, usage: nil, dispatchStage: .dispatched,
        nativeSummary: try summary())
    func graph(_ record: C.ExecutionRecord, core: C.Snapshot? = nil,
               previous: ParallelAgentTask.Snapshot? = nil, at: Date = now) throws -> ParallelAgentTask.Snapshot {
        try project(core ?? proofCore, at: at, previous: previous, nativeReceipts: [receiptPath: try C.encode(record)])
    }
    func omitted(_ name: String, _ mutate: (inout C.ExecutionRecord) throws -> Void) throws {
        var record = proofRecord; try mutate(&record)
        let value = try graph(record)
        let worker = value.nodes.last!
        try check(worker.provider == nil && worker.surface == nil && worker.nativeSessionID == nil &&
            worker.model == nil && worker.effort == nil && value.nodes[0].state == .blocked, name)
    }
    let nativeGraph = try graph(proofRecord)
    try check(nativeGraph.nodes.last?.provider == "codex" && nativeGraph.nodes.last?.surface == "codex" &&
        nativeGraph.nodes.last?.nativeSessionID == nativeSession, "exact witnessed native provider/surface/session displayed")
    try check(nativeGraph.nodes.last?.model == nil && nativeGraph.nodes.last?.effort == nil &&
        nativeGraph.nodes[0].state == .blocked && nativeGraph.nodes.last?.state == .succeeded,
        "selected/ACK never upgrades model/effort or parent quality; child state preserved")
    try check(nativeGraph.nodes.last?.startedAt == proofCore.children[0].startedAtMS.map { Date(timeIntervalSince1970: Double($0) / 1000) } &&
        nativeGraph.nodes.last?.finishedAt == now, "native display does not rewrite authoritative timestamps")
    let publicGraph = String(decoding: try nativeGraph.encoded(), as: UTF8.self)
    try check(!publicGraph.contains(privacyMarker) && !publicGraph.contains(nativePath) && !publicGraph.contains(receiptPath) &&
        !publicGraph.contains("PRIVATE_REQUESTED_MODEL") && !publicGraph.contains("PRIVATE_REQUESTED_EFFORT"),
        "raw outputs/instructions/native paths/requested settings remain private")
    let noReceipt = try project(proofCore)
    try check(noReceipt.nodes.last?.provider == nil && noReceipt.nodes.last?.nativeSessionID == nil,
              "selected configuration alone has no native display authority")
    var observedRecord = proofRecord; observedRecord.observedConfig = configuration
    try check(try graph(observedRecord).nodes.last?.model == nil && graph(observedRecord).nodes.last?.effort == nil,
              "first display patch does not surface model/effort even with compatible observed config")
    try omitted("wrong task omitted") { $0.taskID = "other-task" }
    try omitted("wrong node omitted") { $0.nodeID = "other-node" }
    try omitted("old attempt omitted") { $0.attemptID = "old-attempt" }
    try omitted("wrong candidate omitted") { $0.candidateID = "other-candidate" }
    try omitted("wrong configuration digest omitted") { $0.configurationSHA256 = String(repeating: "b", count: 64) }
    try omitted("different exact configuration omitted") {
        $0.selectedConfig.model = "another-model"; $0.acknowledgedConfig = $0.selectedConfig
    }
    try omitted("wrong receipt self path omitted") { $0.nativeReceipt = "/tmp/another-receipt.json" }
    try omitted("incompatible observed config omitted") { $0.observedConfig = configuration; $0.observedConfig?.model = "other" }
    try omitted("missing acknowledged/observed config omitted") { $0.acknowledgedConfig = nil }
    try omitted("known wrong provider omitted") { $0.nativeSummary = try summary(provider: "claude") }
    try omitted("unsupported provider omitted") { $0.nativeSummary = try summary(provider: "openai") }
    try omitted("consumer surface cannot decorate a Codex relay") { $0.nativeSummary = try summary(surface: "chatgpt") }
    try omitted("invalid native session omitted") { $0.nativeSummary = try summary(session: "not-a-session") }
    try omitted("session/native filename mismatch omitted") { $0.nativeSummary = try summary(session: UUID().uuidString) }
    try omitted("spoofed Codex native filename prefix omitted") {
        $0.nativeSummary = try summary(path: "/tmp/private-native-detail/not-rollout-" + nativeSession + ".jsonl")
    }
    try omitted("extra native filename suffix omitted") {
        $0.nativeSummary = try summary(path: "/tmp/private-native-detail/rollout-" + nativeSession + "-copy.jsonl")
    }
    try omitted("session token embedded elsewhere in native filename omitted") {
        $0.nativeSummary = try summary(path: "/tmp/private-native-detail/" + nativeSession + "-rollout-other.jsonl")
    }
    try omitted("unverified native persistence omitted") { $0.nativeSummary = try summary(persistence: "unverified") }
    try omitted("relative native record path omitted") { $0.nativeSummary = try summary(path: "rollout-" + nativeSession + ".jsonl") }
    try omitted("traversal native record path omitted") { $0.nativeSummary = try summary(path: "/tmp/../private/" + nativeSession + ".jsonl") }
    try omitted("control-character native path omitted") { $0.nativeSummary = try summary(path: "/tmp/private\n/" + nativeSession + ".jsonl") }
    try omitted("non-jsonl native record path omitted") { $0.nativeSummary = try summary(path: "/tmp/" + nativeSession + ".txt") }
    try omitted("missing Codex turn omitted") { $0.nativeSummary = try summary(turn: nil) }
    try omitted("invalid Codex turn omitted") { $0.nativeSummary = try summary(turn: "invalid-turn") }
    try omitted("nonzero native exit omitted") { $0.nativeSummary = try summary(exitCode: 1) }
    try omitted("boolean exit cannot impersonate zero") { $0.nativeSummary = try summary(exitCode: false) }
    try omitted("unverified execution omitted") { $0.executionVerified = false; $0.taskQuality = .unverified }
    try omitted("not dispatched omitted") { $0.dispatchStage = .notDispatched }
    try omitted("failed execution omitted") { $0.status = .failed }
    try omitted("malformed native summary omitted") { $0.nativeSummary = "not-json" }
    try omitted("missing native summary omitted") { $0.nativeSummary = nil }
    try omitted("multiple native steps cannot be guessed") { $0.nativeSummary = try summary(count: 2) }
    try omitted("empty native steps omitted") { $0.nativeSummary = try summary(count: 0) }
    try omitted("oversized native summary omitted") { $0.nativeSummary = String(repeating: "x", count: 512_001) }
    let duplicated = try summary().replacingOccurrences(of: "\"provider\":\"codex\"",
                                                       with: "\"provider\":\"codex\",\"provider\":\"codex\"")
    try check(duplicated.contains("\"provider\":\"codex\",\"provider\":\"codex\""), "duplicate-key fixture is genuinely adversarial")
    try omitted("duplicate nested native keys omitted") { $0.nativeSummary = duplicated }
    let malformedGraph = try project(proofCore, nativeReceipts: [receiptPath: Data("not-json".utf8)])
    try check(malformedGraph.nodes.last?.provider == nil && malformedGraph.nodes[0].state == .blocked,
              "malformed receipt does not invalidate a valid graph")
    var nextAttempt = proofCore; nextAttempt.children[0].attemptID = "next-attempt"; nextAttempt.revision += 1
    let nextGraph = try graph(proofRecord, core: nextAttempt, previous: nativeGraph, at: now.addingTimeInterval(1))
    try check(nextGraph.nodes.last?.provider == nil && nextGraph.nodes.last?.nativeSessionID == nil,
              "previous graph native evidence cannot carry into a fresh attempt")
    var duplicatePaths = proofCore
    var secondChild = duplicatePaths.children[0]; secondChild.id = "two"; secondChild.attemptID = "second-attempt"
    duplicatePaths.children.append(secondChild)
    let sharedReceiptGraph = try graph(proofRecord, core: duplicatePaths)
    try check(sharedReceiptGraph.nodes.filter { $0.role == .worker }.allSatisfy { $0.provider == nil },
              "duplicate receipt path cannot decorate multiple children")
    let secondPath = "/tmp/private-native-display/701302b6-d049-463c-a1d3-d1ff999c780b.json"
    duplicatePaths.children[1].nativeReceipt = secondPath
    var secondRecord = proofRecord; secondRecord.nodeID = "two"; secondRecord.attemptID = "second-attempt"
    secondRecord.nativeReceipt = secondPath
    let sharedTurnGraph = try project(duplicatePaths, nativeReceipts:
        [receiptPath: try C.encode(proofRecord), secondPath: try C.encode(secondRecord)])
    try check(sharedTurnGraph.nodes.filter { $0.role == .worker }.allSatisfy { $0.provider == nil },
              "same witnessed native turn cannot wash separate child records")
    var claudeRecord = proofRecord, claudeCore = proofCore
    claudeRecord.selectedConfig.surface = .claude; claudeRecord.selectedConfig.transport = .claudeCLI
    claudeRecord.selectedConfig.quotaPool = .anthropicShared
    claudeRecord.acknowledgedConfig = claudeRecord.selectedConfig
    claudeRecord.nativeSummary = try summary(provider: "claude", surface: "claude",
                                           path: "/tmp/private-native-detail/" + nativeSession + ".jsonl", turn: nil)
    claudeCore.children[0].selectedConfig = claudeRecord.selectedConfig
    let claudeGraph = try graph(claudeRecord, core: claudeCore)
    try check(claudeGraph.nodes.last?.provider == "claude" && claudeGraph.nodes.last?.surface == "claude" &&
        claudeGraph.nodes.last?.nativeSessionID == nativeSession && claudeGraph.nodes.last?.model == nil,
        "Claude native session may display without an unexposed separate turn ID")
    claudeRecord.nativeSummary = try summary(provider: "claude", surface: "claude", turn: nil)
    try check(try graph(claudeRecord, core: claudeCore).nodes.last?.provider == nil,
              "Claude native record must have exact session filename, not Codex-style suffix")
    // K12b: a v2 partial (a failed task) names its coverage on the root: the
    // counts first, at most three unresolved ids (a display holds at most
    // eight workers, and the public label redaction keeps a short prefix).
    func partialCore(_ unresolved: [String]) -> RCCRuntimeContract.Snapshot {
        .init(taskID: "task", requestSHA256: hash, state: .failed, revision: 9,
            children: [.init(id: "done", state: .completed, attemptID: "attempt-done", candidateID: nil, instruction: "Return 2",
                             dependencies: [])] + unresolved.map { .init(id: $0, state: .failed, attemptID: nil, candidateID: nil,
                             instruction: "Return 4", dependencies: []) },
            result: .init(output: "done: 2", executionVerified: true, taskVerified: false, parityState: .unverified,
                nativeReceipt: "/private/fixture/partial.json", taskQuality: .executionOnly,
                partial: .init(coverage: .init(completedNodeIDs: ["done"], unresolvedNodeIDs: unresolved),
                    parent: .init(taskID: "task", requestSHA256: hash, revision: 8),
                    nodes: [.init(nodeID: "done", attemptID: "attempt-done", outputSHA256: SourceContextStore.digest(Data("2".utf8)))])),
            error: "verified_not_dispatched_retry_exhausted")
    }
    let shortRoot = try project(partialCore((1...7).map { "u\($0)" })).nodes[0]
    try check(shortRoot.state == .failed && shortRoot.resultSummary?.contains("1/8") == true &&
              shortRoot.resultSummary?.contains("u1, u2, u3 +4") == true && shortRoot.resultSummary?.contains("u4") == false,
              "a partial root names its coverage counts and at most three unresolved ids")
    let longRoot = try project(partialCore((1...7).map { "unresolved-obligation-\($0)-" + String(repeating: "x", count: 60) })).nodes[0]
    try check(longRoot.resultSummary?.contains("1/8") == true && (longRoot.resultSummary?.utf8.count ?? 0) <= 1_000,
              "long unresolved ids keep the counts and stay within the summary bound")
    var wholeCore = partialCore(["u1"]); wholeCore.result?.partial = nil; wholeCore.state = .returnedUnverified
    try check(try project(wholeCore).nodes[0].resultSummary?.hasPrefix("Returned output is retained") == true,
              "a whole answer's root summary is unchanged")
    try runRCCNativeDisplayObservationFixtures()
    print("RCC Runtime UI projection: \(checks) deterministic checks PASS; no scheduling/provider/model calls")
}
