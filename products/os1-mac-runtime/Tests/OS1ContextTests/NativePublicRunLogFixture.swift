import Foundation
import OS1Context

/// Derived software fixtures. No provider, UI, native tool or user data read.
func runNativePublicRunLogFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
    let conversation = UUID(), submission = UUID()
    let hash = SourceContextStore.digest(Data("fixture request".utf8))
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    var log = NativePublicRunLog(conversationID: conversation, submissionID: submission, requestSHA256: hash)
    var identity = NativePublicRunLog(conversationID: conversation, submissionID: UUID(), requestSHA256: hash)
    let session = UUID().uuidString.lowercased()
    let fallback = identity.resolveStream(provider: "claude", nativeSessionID: session, observedStream: nil)
    check(identity.resolveStream(provider: "claude", nativeSessionID: session, observedStream: "aaaaaaaaaaaa") == fallback,
        "first valid optional metadata links to original producer namespace")
    check(identity.resolveStream(provider: "claude", nativeSessionID: session, observedStream: nil) == fallback,
        "metadata-only final cannot duplicate prose in a fallback namespace")
    check(identity.resolveStream(provider: "claude", nativeSessionID: session, observedStream: "bbbbbbbbbbbb") != fallback,
        "real known stream change starts a new convergence namespace")
    check(identity.resolveStream(provider: "claude", nativeSessionID: UUID().uuidString, observedStream: nil) != fallback,
        "different native producer session stays separate")
    check(identity.resolveStream(provider: "claude", nativeSessionID: UUID().uuidString, observedStream: "aaaaaaaaaaaa") != fallback,
        "equal progress token cannot merge different known producer sessions")
    check(log.observe(provider: "claude", surface: "claude", stream: "segment-a", text: "First public sentence.",
        candidate: false, origin: .nativeAssistant, receivedAt: now), "first public prose")
    check(log.observe(provider: "claude", surface: "claude", stream: "segment-a", text: "First public sentence. More public text.",
        candidate: false, origin: .nativeAssistant, receivedAt: now), "cumulative delta")
    check(log.entries.count == 1 && log.entries[0].text == "First public sentence. More public text.", "native cumulative prose not duplicated")
    var contraction = NativePublicRunLog(conversationID: conversation, submissionID: UUID(), requestSHA256: hash)
    let body = String(repeating: "Public source line. ", count: 60)
    _ = contraction.observe(provider: "claude", stream: "same-stream", text: body + "\n\n\n", candidate: false,
        origin: .legacyUnattributed, receivedAt: now)
    check(!contraction.observe(provider: "claude", stream: "same-stream", text: body, candidate: false,
        origin: .legacyUnattributed, receivedAt: now), "shorter exact prefix is not new public text")
    check(contraction.entries.count == 1 && contraction.entries[0].text == body + "\n\n\n", "contraction preserves history without whole-body duplication")
    _ = contraction.observe(provider: "claude", stream: "same-stream", text: body + "NEW", candidate: false,
        origin: .legacyUnattributed, receivedAt: now)
    check(contraction.entries[0].text == body + "\n\n\nNEW", "continuation after contraction advances from contracted cursor")
    let anchor = log.displayText
    log.checkpoint()
    check(log.observeAction(id: "0|abc", provider: "claude", surface: "claude", text: "Read · Sources/App.swift — requested", receivedAt: now), "main action")
    check(!log.observeAction(id: "0|abc", provider: "claude", surface: "claude", text: "Read · Sources/App.swift — requested", receivedAt: now), "poll dedup")
    check(log.observeAction(id: "0|abc", provider: "claude", surface: "claude", text: "Read · Sources/App.swift — returned", receivedAt: now), "actual return transition")
    check(log.displayText.hasPrefix(anchor), "steering anchor survives appended action transitions")
    let retained = log.displayText
    check(!log.observe(provider: "claude", stream: "segment-b", text: "", candidate: false, origin: .nativeAssistant, receivedAt: now), "empty READY does not erase")
    check(log.displayText == retained, "preparing/source/nil emits have no public observation")
    check(log.observe(provider: "codex", surface: "codex", stream: "segment-b", text: "Second native segment.", candidate: false,
        origin: .nativeAssistant, receivedAt: now.addingTimeInterval(3)), "convergence second source")
    check(log.displayText.contains("First public sentence.") && log.displayText.contains("Second native segment.") && log.displayText.contains("Sources/App.swift"),
        "prose and main actions retained across providers")
    check(log.observe(provider: "codex", surface: "codex", stream: "segment-b", text: "Exact candidate", candidate: true,
        origin: .nativeAssistant, receivedAt: now.addingTimeInterval(4)), "provisional candidate separate")
    check(log.entries.last?.kind == .candidate && log.entries.last?.text == "Exact candidate" && log.displayText.contains("미채택"), "candidate is not adopted final")
    check(!log.observe(provider: "codex", surface: "codex", stream: "segment-b", text: "Exact candidate", candidate: true,
        origin: .nativeAssistant, receivedAt: now), "candidate snapshot duplicate")
    var chat = NativePublicRunLog(conversationID: conversation, submissionID: UUID(), requestSHA256: hash)
    _ = chat.observe(provider: "codex", surface: "gpt-chat", stream: "chat", text: "Public GPT text", candidate: false,
        origin: .nativeAssistant, receivedAt: now)
    _ = chat.observe(provider: "claude", surface: "claude-chat", stream: "chat", text: "Public Claude text", candidate: false,
        origin: .nativeAssistant, receivedAt: now)
    check(chat.displayText.contains(ProviderSurface.gptChat.routeTitle) && chat.displayText.contains(ProviderSurface.claudeChat.routeTitle), "four actual surfaces preserved")
    _ = chat.observe(provider: "claude", stream: "old", text: "Legacy public text", candidate: false, origin: .legacyUnattributed, receivedAt: now)
    check(chat.displayText.contains("출처 미확인"), "legacy origin not promoted to native")
    check(!log.belongs(conversationID: UUID(), submissionID: submission, requestSHA256: hash) &&
          !log.belongs(conversationID: conversation, submissionID: UUID(), requestSHA256: hash) &&
          !log.belongs(conversationID: conversation, submissionID: submission, requestSHA256: String(repeating: "0", count: 64)), "scope isolation")
    let decoded = try JSONDecoder().decode(NativePublicRunLog.self, from: JSONEncoder().encode(log))
    check(log.isValid && decoded == log, "origin/state Codable")
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-public-run-fixture-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = NativePublicRunLogStore(root: root)
    try store.save(log)
    check(store.load(conversationID: conversation, submissionID: submission, requestSHA256: hash) == log, "exact scoped persisted snapshot")
    check(store.load(conversationID: conversation, submissionID: UUID(), requestSHA256: hash).entries.isEmpty, "new submission has no stale progress")
    let file = root.appendingPathComponent(submission.uuidString.lowercased() + ".json")
    let mode = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber
    check(mode?.intValue == 0o600, "private file mode")
    let alias = root.appendingPathComponent("alias")
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: root)
    check(NativePublicRunLogStore(root: alias).load(conversationID: conversation, submissionID: submission, requestSHA256: hash).entries.isEmpty, "symlink root denied")
    try Data("malformed fixture".utf8).write(to: file)
    check(store.load(conversationID: conversation, submissionID: submission, requestSHA256: hash).entries.isEmpty, "corrupt persisted data fail closed")
    let writer = NativePublicRunLogWriter(), semaphore = DispatchSemaphore(value: 0)
    let old = log
    _ = log.observe(provider: "codex", stream: "segment-c", text: "Newest public text", candidate: false, origin: .nativeAssistant, receivedAt: now)
    let newest = log
    Task.detached {
        await writer.enqueue(newest, store: store)
        await writer.enqueue(old, store: store)
        await writer.flush(submission)
        semaphore.signal()
    }
    check(semaphore.wait(timeout: .now() + 5) == .success, "off-main writer terminated")
    check(store.load(conversationID: conversation, submissionID: submission, requestSHA256: hash) == newest, "older queued snapshot cannot overwrite newest")
    typealias Step = NativeExecutionProgress.Step
    func progress(_ step: Step, _ sequence: Int) -> NativeExecutionProgress {
        NativeExecutionProgress(sequence: sequence, kind: .toolWorking, tool: step.tool, scope: "main", toolsRequested: 0,
            toolsReturned: 0, activeTools: 0, observedAt: now,
            events: [.init(sequence: sequence, kind: .toolWorking, tool: step.tool, scope: "main", observedAt: now)],
            steps: [step], stream: "aaaaaaaaaaaa")
    }
    var steps = NativeStepLog()
    steps.merge(progress(Step(id: "000000000001", sequence: 1, tool: "plan", scope: "main", verb: "plan", label: "First plan",
        state: .observed, startedAt: now), 1), provider: "codex", surface: "codex")
    steps.merge(progress(Step(id: "000000000001", sequence: 2, tool: "plan", scope: "main", verb: "plan", label: "Revised plan",
        state: .observed, startedAt: now), 2), provider: "claude", surface: "claude")
    check(steps.entries[0].step.label == "Revised plan" && steps.entries[0].provider == "codex", "native observed plan updates, original source retained")
    steps.merge(progress(Step(id: "000000000001", sequence: 3, tool: "plan", scope: "main", state: .requested, startedAt: now), 3))
    check(steps.entries[0].step.state == .requested, "observed to actual requested")
    steps.merge(progress(Step(id: "000000000001", sequence: 4, tool: "plan", scope: "main", state: .returned, startedAt: now, endedAt: now), 4))
    steps.merge(progress(Step(id: "000000000001", sequence: 5, tool: "plan", scope: "main", state: .observed, startedAt: now), 5))
    check(steps.entries[0].step.state == .returned, "returned never downgraded on poll")
    print("Native public run log fixtures: " + String(checks) + " checks passed; provider calls 0")
}
