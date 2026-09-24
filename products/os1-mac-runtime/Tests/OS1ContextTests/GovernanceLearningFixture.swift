import Foundation
import OS1Context

/// The 학습 view shows what routing learned, in the ledger's own units. These
/// checks pin the arithmetic the owner reads: weighted tokens, tokens per
/// verified result, which outcomes count, and the week-over-week trend.
func runGovernanceLearningFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) {
        precondition(value, "Governance learning: " + label); checks += 1
    }
    func resource(_ provider: String) -> CompletionUsageResourceMetadata {
        provider == "codex"
            ? CompletionUsageResourceMetadata(format: .codexRolloutJSONL, byteCount: 1, sha256: String(repeating: "a", count: 64),
                                              usageRecordCount: 1, accountingVersion: 2)
            : CompletionUsageResourceMetadata(format: .claudeResultJSON, byteCount: 1, sha256: String(repeating: "a", count: 64),
                                              usageRecordCount: 1, accountingVersion: 1)
    }
    func attempt(_ provider: String, _ model: String, _ effort: String, _ outcome: CompletionOutcome,
                 input: Int?, cache: Int? = 0, output: Int?, seconds: Int, trusted: Bool = true) -> GovernanceAttempt {
        let usage = input == nil && output == nil ? nil : CompletionMeasuredUsage(inputTokens: input, outputTokens: output,
            cacheTokens: cache, resource: trusted ? resource(provider)
                : CompletionUsageResourceMetadata(format: .codexRolloutJSONL, byteCount: 1, sha256: String(repeating: "a", count: 64),
                                                  usageRecordCount: 1, accountingVersion: 1))
        let observation = CompletionFeedbackObservation(executionID: UUID().uuidString, sequence: 1, provider: provider,
            model: model, effort: effort, outcome: outcome, usage: usage, durationMS: seconds * 1000)
        // The records are public only as Codable, exactly as they are stored.
        let object: [String: Any] = ["id": UUID().uuidString + ":1", "startedAt": Date().timeIntervalSinceReferenceDate,
            "scope": String(repeating: "b", count: 64), "provider": provider, "model": model, "effort": effort,
            "observation": try! JSONSerialization.jsonObject(with: JSONEncoder().encode(observation))]
        return try! JSONDecoder().decode(GovernanceAttempt.self, from: JSONSerialization.data(withJSONObject: object))
    }
    func task(_ attempts: [GovernanceAttempt], at date: Date) -> GovernanceTask {
        let object: [String: Any] = ["schema": 1, "id": UUID().uuidString, "startedAt": date.timeIntervalSinceReferenceDate,
            "endedAt": date.addingTimeInterval(60).timeIntervalSinceReferenceDate, "pid": 1, "disposition": "adopted",
            "attempts": attempts.map { try! JSONSerialization.jsonObject(with: JSONEncoder().encode($0)) },
            "revision": CompletionFeedbackScope.validationRevision]
        return try! JSONDecoder().decode(GovernanceTask.self, from: JSONSerialization.data(withJSONObject: object))
    }

    // Weighting: fresh input + 0.1 x cache reads + 5 x output.
    let weighted = attempt("claude", "sonnet", "medium", .adopted, input: 1_000_000, cache: 990_000, output: 2_000, seconds: 10)
    check(GovernanceLearning.weightedTokens(weighted.observation!) == 10_000 + 99_000 + 10_000, "weighted tokens")
    // Untrusted accounting is unmeasured, never a guess.
    let untrusted = attempt("codex", "gpt-6-sol", "medium", .adopted, input: 500, output: 5, seconds: 10, trusted: false)
    check(GovernanceLearning.weightedTokens(untrusted.observation!) == nil, "old Codex accounting is unmeasured")
    let empty = attempt("claude", "opus", "max", .capabilityFailure, input: 0, cache: 0, output: 0, seconds: 1)
    check(GovernanceLearning.weightedTokens(empty.observation!) == nil, "a zero-token attempt never ran and is unmeasured")

    let now = Date(timeIntervalSince1970: 1_790_000_000)
    var snapshot = GovernanceSnapshot()
    snapshot.tasks = [
        // Route A (codex luna/low): 2 of 3 adopted, 100k per attempt.
        task([attempt("codex", "gpt-5.6-luna", "low", .adopted, input: 100_000, output: 0, seconds: 20)], at: now.addingTimeInterval(-3_600)),
        task([attempt("codex", "gpt-5.6-luna", "low", .qualityFailure, input: 100_000, output: 0, seconds: 30)], at: now.addingTimeInterval(-7_200)),
        task([attempt("codex", "gpt-5.6-luna", "low", .adopted, input: 100_000, output: 0, seconds: 20)], at: now.addingTimeInterval(-9_000)),
        // Route B (codex astra/high): 3 of 3 adopted, 400k per attempt.
        task([attempt("codex", "gpt-6-astra", "high", .adopted, input: 400_000, output: 0, seconds: 40)], at: now.addingTimeInterval(-3_600)),
        task([attempt("codex", "gpt-6-astra", "high", .adopted, input: 400_000, output: 0, seconds: 40)], at: now.addingTimeInterval(-3_700)),
        task([attempt("codex", "gpt-6-astra", "high", .adopted, input: 400_000, output: 0, seconds: 40)], at: now.addingTimeInterval(-3_800)),
        // Infrastructure outcomes say nothing about the route.
        task([attempt("codex", "gpt-6-astra", "high", .quotaExhausted, input: nil, output: nil, seconds: 1),
              attempt("claude", "sonnet", "medium", .verificationUnavailable, input: 10, output: 1, seconds: 1)], at: now.addingTimeInterval(-3_900)),
    ]
    let routes = GovernanceLearning.routes(snapshot)
    let luna = routes.first { $0.id == "codex / gpt-5.6-luna / low" }!
    let astra = routes.first { $0.id == "codex / gpt-6-astra / high" }!
    check(routes.count == 2, "infrastructure-only routes are not listed")
    check(luna.attempts == 3 && luna.adopted == 2 && astra.attempts == 3 && astra.adopted == 3, "route outcomes counted")
    check(abs(luna.tokensPerCompletion! - 150_000) < 1, "tokens per verified result include the failed attempt")
    check(abs(astra.tokensPerCompletion! - 400_000) < 1, "a route that always finishes costs its per-attempt tokens")
    check(routes.first?.id == luna.id, "within a provider, fewer tokens per verified result ranks first")
    check(GovernanceLearning.leaders(routes)["codex"] == luna.id, "the leader is the cheapest route that finishes")
    check(GovernanceLearning.leaders(routes, minimumAttempts: 4).isEmpty, "a route needs enough attempts to lead")
    check(abs((astra.meanSecondsCompleted ?? 0) - 40) < 0.01, "time counts verified results only")
    check(GovernanceLearning.routes(snapshot, provider: "claude").isEmpty, "provider filter")

    // Trend: this week vs last week.
    var trending = GovernanceSnapshot()
    trending.tasks = [
        task([attempt("codex", "gpt-5.6-luna", "low", .qualityFailure, input: 300_000, output: 0, seconds: 90)], at: now.addingTimeInterval(-10 * 86_400)),
        task([attempt("codex", "gpt-5.6-luna", "low", .adopted, input: 300_000, output: 0, seconds: 90)], at: now.addingTimeInterval(-9 * 86_400)),
        task([attempt("codex", "gpt-6-sol", "low", .adopted, input: 100_000, output: 0, seconds: 30)], at: now.addingTimeInterval(-2 * 86_400)),
        task([attempt("codex", "gpt-6-sol", "low", .adopted, input: 100_000, output: 0, seconds: 30)], at: now.addingTimeInterval(-86_400)),
    ]
    let trend = GovernanceLearning.trend(trending, now: now)
    check(trend.previous.completionRate == 0.5 && trend.recent.completionRate == 1.0, "completion rose")
    check(trend.previous.tokensPerCompletion == 600_000 && trend.recent.tokensPerCompletion == 100_000,
          "tokens per verified result fell, failures charged")
    check(trend.previous.secondsPerCompletion == 90 && trend.recent.secondsPerCompletion == 30, "time per verified result fell")
    check(GovernanceLearning.trend(GovernanceSnapshot(), now: now).recent.completionRate == nil, "no data is no rate, not zero")

    print("Governance learning: \(checks) checks passed; weighted tokens, per-verified-result cost, trend")
}
