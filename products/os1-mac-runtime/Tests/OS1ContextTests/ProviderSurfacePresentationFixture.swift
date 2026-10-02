import Foundation
import OS1Context

/// Route identity must name the executed mode, while truthful transport and
/// quota remain separate details. Never infer a chat lane from a model name.
func runProviderSurfacePresentationFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Provider route presentation: " + message); count += 1
    }
    let surfaces: [ProviderSurface] = [.gptChat, .codex, .claudeChat, .claude]
    let titles = ["GPT (OpenAI)", "Codex (OpenAI)", "Claude (Anthropic)", "Claude Code (Anthropic)"]
    check(surfaces.map(\.routeTitle) == titles, "four choices have four unambiguous identities")
    check(surfaces.map(\.displayName) == ["GPT", "Codex", "Claude", "Claude Code"], "compact names keep chat and agent distinct")
    check(surfaces.map(\.choiceTitle) == titles, "menus and executed-route receipts share the identity vocabulary")
    check(Set(titles).count == 4, "identities do not collapse onto quota or transport")
    for surface in surfaces {
        check(!surface.routeTitle.lowercased().contains("usage") && !surface.routeTitle.lowercased().contains("limit")
              && !surface.routeTitle.contains("한도") && !surface.routeTitle.contains("사용량"), "quota is not route identity")
        check(!surface.executionLine.isEmpty && !surface.usageLine.isEmpty, "execution and metering remain available separately")
    }
    check(ProviderSurface.gptChat.executionLine.contains("Codex") && ProviderSurface.gptChat.executionLine.contains("ChatGPT"),
          "GPT discloses the bounded Codex executor and ChatGPT service boundary")
    check(ProviderSurface.claudeChat.executionLine.contains("Claude Code"), "Claude discloses its bounded Claude Code executor")
    check(ProviderSurface.gptChat.railBadge == "GPT" && ProviderSurface.claudeChat.railBadge == "Claude", "rail badge names the chosen mode")
    check(ProviderSurface.chatgpt.choiceTitle != ProviderSurface.gptChat.choiceTitle && !ProviderSurface.chatgpt.isExecutor,
          "ChatGPT handoff cannot masquerade as an executed GPT answer")
    check(ProviderSurface.gptChat.quotaPool == ProviderSurface.codex.quotaPool
          && ProviderSurface.claudeChat.quotaPool == ProviderSurface.claude.quotaPool, "actual quota pools are unchanged")
    for (surface, provider) in [(ProviderSurface.gptChat, "codex"), (.codex, "codex"), (.claudeChat, "claude"), (.claude, "claude")] {
        check(ProviderSurface.resolveExecuted(rawSurface: surface.rawValue, provider: provider) == surface,
              "matching backend admits its recorded mode")
    }
    check(ProviderSurface.resolveExecuted(rawSurface: "gpt-chat", provider: "claude") == .claude,
          "OpenAI request cannot relabel an Anthropic fallback")
    check(ProviderSurface.resolveExecuted(rawSurface: "claude-chat", provider: "codex") == .codex,
          "Anthropic request cannot relabel an OpenAI fallback")
    for raw in [nil, "chatgpt", "auto", "future-surface"] as [String?] {
        check(ProviderSurface.resolveExecuted(rawSurface: raw, provider: "codex") == .codex,
              "legacy, handoff and unknown surface show only their recorded executor")
    }
    check(ProviderSurface.resolveExecuted(rawSurface: "gpt-chat", provider: "local") == nil
          && ProviderSurface.resolveExecuted(rawSurface: "gpt-chat", provider: nil) == nil,
          "surface alone never proves provider execution")
    check(ProviderSurface.resolveExecuted(rawSurface: "gpt-chat", provider: " CODEX ") == .gptChat,
          "provider normalization does not change the surface")

    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("os1-route-presentation-\(UUID())")
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    let activityURL = root.appendingPathComponent("activity.json")
    let journalURL = root.appendingPathComponent("events.jsonl")
    fm.createFile(atPath: journalURL.path, contents: nil)
    let oldActivity = ProcessInfo.processInfo.environment["OS1_ACTIVITY_FILE"]
    let oldJournal = ProcessInfo.processInfo.environment["OS1_EVENT_JOURNAL"]
    setenv("OS1_ACTIVITY_FILE", activityURL.path, 1)
    setenv("OS1_EVENT_JOURNAL", journalURL.path, 1)
    defer {
        if let oldActivity { setenv("OS1_ACTIVITY_FILE", oldActivity, 1) } else { unsetenv("OS1_ACTIVITY_FILE") }
        if let oldJournal { setenv("OS1_EVENT_JOURNAL", oldJournal, 1) } else { unsetenv("OS1_EVENT_JOURNAL") }
    }
    func activity() throws -> RuntimeActivity { try JSONDecoder().decode(RuntimeActivity.self, from: Data(contentsOf: activityURL)) }
    let session = UUID().uuidString.lowercased()
    RuntimeActivity.emit(.executing, provider: "codex", surface: "gpt-chat", model: "gpt-6-astra", effort: "high",
                         publicText: "GPT answer", nativeSessionID: session)
    check(try activity().surface == "gpt-chat", "actual lane reaches the progress file")
    RuntimeActivity.emit(.executing, provider: "codex", tool: "commandExecution")
    let streamed = try activity()
    check(streamed.surface == "gpt-chat" && streamed.model == "gpt-6-astra" && streamed.nativeSessionID == session,
          "stream events retain matched route evidence")
    RuntimeActivity.emit(.verifying, provider: "codex")
    check(try activity().surface == "gpt-chat", "verification retains the actual mode")
    RuntimeActivity.emit(.syncing, provider: "codex")
    check(try activity().surface == "gpt-chat", "sync retains the actual mode")
    RuntimeActivity.emit(.executing, provider: "codex", surface: "codex")
    let nextLane = try activity()
    check(nextLane.surface == "codex" && nextLane.model == nil && nextLane.effort == nil && nextLane.nativeSessionID == nil,
          "GPT to Codex does not inherit the previous lane's model or session")
    RuntimeActivity.emit(.executing, provider: "claude", surface: "claude-chat", model: "claude-sonnet-5-5", nativeSessionID: session)
    check(try activity().surface == "claude-chat", "provider switch records the new executed mode")
    RuntimeActivity.emit(.routing)
    let cleared = try activity()
    check(cleared.surface == nil && cleared.provider == nil && cleared.model == nil && cleared.nativeSessionID == nil,
          "unselected routing cannot leak the previous route")
    RuntimeActivity.emit(.executing, provider: "codex", model: "gpt-6-astra")
    check(try activity().surface == nil, "a GPT model does not prove GPT chat execution")
    let invalid = RuntimeActivity(.executing, provider: "codex", surface: "claude-chat")
    check(invalid.surface == nil, "mismatched surface is not recorded as actual activity")
    let legacy = RuntimeActivity(.executing, provider: "codex", model: "gpt-6-astra")
    let legacyData = try JSONEncoder().encode(legacy)
    check(!String(decoding: legacyData, as: UTF8.self).contains("\"surface\""), "legacy wire shape may omit surface")
    check(try JSONDecoder().decode(RuntimeActivity.self, from: legacyData).surface == nil, "legacy progress records still decode")
    let events = try String(contentsOf: journalURL, encoding: .utf8).split(separator: "\n")
        .map { try JSONDecoder().decode(RuntimeActivity.self, from: Data($0.utf8)) }
    check(events.count == 8 && events.first?.surface == "gpt-chat" && events[4].surface == "codex"
          && events[5].surface == "claude-chat" && events.last?.surface == nil,
          "persistent journal preserves each executed mode and route reset")

    let notice = BackendFailureNotice(provider: "codex", sessionID: session, blocker: .timeout,
        dispatchStage: .dispatched, surface: "gpt-chat")
    check(try JSONDecoder().decode(BackendFailureNotice.self, from: JSONEncoder().encode(notice)).surface == "gpt-chat",
          "failure transport preserves actual GPT mode")
    let oldNotice = BackendFailureNotice(provider: "claude", sessionID: nil, blocker: .timeout, dispatchStage: .dispatched)
    check(try JSONDecoder().decode(BackendFailureNotice.self, from: JSONEncoder().encode(oldNotice)).surface == nil,
          "old failure records decode without an invented chat lane")
    check(BackendFailureNotice(provider: "claude", sessionID: nil, blocker: .timeout,
        dispatchStage: .dispatched, surface: "gpt-chat").surface == nil, "failure notice rejects a foreign surface")

    let store = GovernanceActivityStore(root: root.appendingPathComponent("governance"))
    let taskID = UUID().uuidString.lowercased(), executionID = UUID().uuidString.lowercased()
    let start = Date()
    let scope = CompletionFeedbackScope(objectiveSHA256: String(repeating: "a", count: 64), sourceSHA256: nil,
        executorContractSHA256: String(repeating: "b", count: 64), assembledInputSHA256: String(repeating: "c", count: 64))
    try store.begin(id: taskID, now: start)
    try store.attempt(id: taskID, executionID: executionID, sequence: 1, scope: scope, provider: "codex",
        model: "gpt-6-astra", effort: "high", startedAt: start, surface: "gpt-chat")
    let attempt = store.snapshot(legacyRoot: nil).tasks.first!.attempts.first!
    check(attempt.surface == "gpt-chat" && attempt.displayRoute.hasPrefix("GPT (OpenAI)"), "governance records and displays actual mode")
    check(attempt.route == "gpt-chat / gpt-6-astra / high", "new explicit GPT mode gets its own metric key")
    try store.attempt(id: taskID, executionID: executionID, sequence: 1, scope: scope, provider: "codex",
        model: "gpt-6-astra", effort: "high", startedAt: start)
    check(store.snapshot(legacyRoot: nil).tasks.first?.attempts.first?.surface == "gpt-chat", "duplicate legacy start cannot erase recorded mode")
    var oldAttempt = attempt
    oldAttempt.surface = nil
    check(try JSONDecoder().decode(GovernanceAttempt.self, from: JSONEncoder().encode(oldAttempt)).surface == nil,
          "legacy governance records preserve unknown surface")
    check(oldAttempt.displayRoute.hasPrefix("Codex (OpenAI)"), "legacy governance shows its recorded executor, not guessed GPT chat")
    check(oldAttempt.route == "codex / gpt-6-astra / high", "legacy grouping key is not retroactively rewritten")
    check(ProviderSurface.displayRouteKey(attempt.route) == attempt.displayRoute, "metric key renders the same mode identity")
    let usage = CompletionMeasuredUsage(inputTokens: 20, outputTokens: 5, cacheTokens: 0,
        resource: CompletionUsageResourceMetadata(format: .codexRolloutJSONL, byteCount: 10,
            sha256: String(repeating: "d", count: 64), usageRecordCount: 1, accountingVersion: 2))
    let observation = CompletionFeedbackObservation(executionID: executionID, sequence: 1, provider: "codex",
        model: "gpt-6-astra", effort: "high", outcome: .adopted, usage: usage, durationMS: 10)
    try store.attempt(id: taskID, executionID: executionID, sequence: 1, scope: scope, provider: "codex",
        model: "gpt-6-astra", effort: "high", startedAt: start, observation: observation)
    check(store.snapshot(legacyRoot: nil).tasks.first?.attempts.first?.surface == "gpt-chat",
          "legacy completion callback cannot erase actual mode recorded at start")
    try store.finish(id: taskID, adopted: true)
    let fullID = UUID().uuidString.lowercased(), fullExecutionID = UUID().uuidString.lowercased()
    try store.begin(id: fullID, now: start)
    let fullObservation = CompletionFeedbackObservation(executionID: fullExecutionID, sequence: 1, provider: "codex",
        model: "gpt-6-astra", effort: "high", outcome: .adopted, usage: usage, durationMS: 20)
    try store.attempt(id: fullID, executionID: fullExecutionID, sequence: 1, scope: scope, provider: "codex",
        model: "gpt-6-astra", effort: "high", startedAt: start, observation: fullObservation, surface: "codex")
    try store.finish(id: fullID, adopted: true)
    let snapshot = store.snapshot(legacyRoot: nil)
    let rows = snapshot.routes(since: nil, includeHistorical: false)
    check(Set(rows.map(\.id)) == Set(["gpt-chat / gpt-6-astra / high", "codex / gpt-6-astra / high"]),
          "same-model GPT and Codex attempts never merge into one metric row")
    check(rows.allSatisfy { $0.attempts == 1 && $0.terminalTasks == 1 && $0.tokens == 25 },
          "per-mode measured attempts and terminal tasks stay aligned")
    check(snapshot.comparisons(baseline: attempt.route, since: nil, includeHistorical: false).first?.id == oldAttempt.route,
          "mode-aware comparison uses real OpenAI accounting boundary")
    check(snapshot.dashboardProjection(provider: "codex", since: nil, includeHistorical: false).rows.count == 2,
          "backend filter includes both OpenAI execution modes without renaming the account")
    check(GovernanceLearning.routes(snapshot).count == 2, "learning route projection preserves distinct actual modes")
    print("Provider route presentation: \(count) checks passed; identity, truthful executor, fallback, legacy records, activity and governance")
}
