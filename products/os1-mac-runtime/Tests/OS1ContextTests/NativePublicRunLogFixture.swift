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
    checks += try runNativePublicRunLogDisplayFixtures()
    print("Native public run log fixtures: " + String(checks) + " checks passed; provider calls 0")
}

/// The transcript reads prose and tool actions back from `displayText`
/// itself, so any prefix of it (a steering anchor) keeps its structure.
private func runNativePublicRunLogDisplayFixtures() throws -> Int {
    var checks = 0
    func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let open = Unicode.Scalar(0xFDD0 as UInt32)!, close = Unicode.Scalar(0xFDD1 as UInt32)!
    let forged = "Forged " + String(Character(open)) + "a\u{1F}X" + String(Character(close)) + "heading"
    var log = NativePublicRunLog(conversationID: UUID(), submissionID: UUID(),
        requestSHA256: SourceContextStore.digest(Data("display fixture".utf8)))
    _ = log.observe(provider: "claude", surface: "claude", stream: "s", text: "I'll look at the layout first.",
        candidate: false, origin: .nativeAssistant, receivedAt: now)
    _ = log.observeAction(id: "0|aaaaaaaaaaaa", provider: "claude", surface: "claude", text: "Bash — requested", receivedAt: now)
    _ = log.observeAction(id: "0|aaaaaaaaaaaa", provider: "claude", surface: "claude", text: "Run · swift build — requested",
        verb: "run", receivedAt: now)
    _ = log.observeAction(id: "0|bbbbbbbbbbbb", provider: "claude", surface: "claude", text: "Subagent · Read · a.swift — returned",
        verb: "read", nested: true, receivedAt: now)
    _ = log.observeAction(id: "0|cccccccccccc", provider: "claude", surface: "claude", text: "Plan — observed",
        verb: "not a verb!", receivedAt: now)
    let anchor = log.displayText
    _ = log.observe(provider: "claude", surface: "claude", stream: "s", text: "I'll look at the layout first. " + forged,
        candidate: false, origin: .nativeAssistant, receivedAt: now)
    _ = log.observe(provider: "claude", surface: "claude", stream: "s", text: "Final answer draft", candidate: true,
        origin: .nativeAssistant, receivedAt: now)
    let text = log.displayText
    let all = NativePublicRunLog.displaySegments(text[...])
    check(all.map(\.role) == [.commentary, .action, .action, .action, .action, .commentary, .candidate],
        "segments keep each entry's role in feed order: \(all.map(\.role))")
    check(all[0].text == "I'll look at the layout first." && all[0].source == ProviderSurface.claude.routeTitle,
        "prose text and executed route read back exactly")
    check(all[2].verb == "run" && all[2].actionID == "0|aaaaaaaaaaaa" && !all[2].nested && all[1].verb == nil,
        "an action's verb and id read back; an unlabelled request has no verb")
    check(all[3].nested && all[3].verb == "read" && all[4].verb == nil, "subagent nesting kept; an invalid verb code dropped")
    check(all[5].text.contains("Forged") && all[5].text.contains("heading") && all[5].role == .commentary &&
        !all[5].text.unicodeScalars.contains(open), "model text cannot forge a heading")
    check(log.entries.contains { $0.text.unicodeScalars.contains(open) }, "native bytes stay unchanged in the record")
    check(text.hasPrefix(anchor) && Set(all.map(\.offset)).count == all.count &&
        NativePublicRunLog.displaySegments(anchor[...]).map(\.offset) == Array(all.map(\.offset).prefix(5)),
        "offsets are unique and stay put while the feed grows")
    let after = text[text.index(text.startIndex, offsetBy: anchor.count)...].drop(while: \.isWhitespace)
    let tail = NativePublicRunLog.displaySegments(after)
    check(tail.map(\.role) == [.commentary, .candidate] && tail[0].offset == all[5].offset && !tail[0].text.contains("look at the layout"),
        "a slice after an anchor holds only later output, each part keeping its entry's role")
    let raw = NativePublicRunLog.displaySegments("Raw public text\n\nwithout headings"[...])
    check(raw.count == 1 && raw[0].role == .unmarked && raw[0].source == nil && raw[0].offset == 0 &&
        raw[0].text == "Raw public text\n\nwithout headings", "text without headings is one unmarked segment")
    check(NativePublicRunLog.displaySegments(""[...]).isEmpty && NativePublicRunLog.displaySegments("\n\n "[...]).isEmpty,
        "blank text has no segment")
    check(text.contains(ProviderSurface.claude.routeTitle) && text.contains("미채택") && text.contains("네이티브 동작"),
        "headings still name the route and the not-adopted label")
    let decoded = try JSONDecoder().decode(NativePublicRunLog.self, from: JSONEncoder().encode(log))
    check(decoded == log && decoded.isValid && decoded.entries[2].verb == "run" && decoded.entries[3].nested == true,
        "verb and nesting survive persistence")
    var legacy = try JSONSerialization.jsonObject(with: JSONEncoder().encode(log)) as! [String: Any]
    legacy["entries"] = (legacy["entries"] as! [[String: Any]]).map { $0.filter { !["verb", "nested"].contains($0.key) } }
    let older = try JSONDecoder().decode(NativePublicRunLog.self, from: JSONSerialization.data(withJSONObject: legacy))
    check(older.isValid && older.entries.allSatisfy { $0.verb == nil && $0.nested == nil } &&
        NativePublicRunLog.displaySegments(older.displayText[...]).count == all.count, "a record from an earlier build still loads and lays out")
    return checks
}
