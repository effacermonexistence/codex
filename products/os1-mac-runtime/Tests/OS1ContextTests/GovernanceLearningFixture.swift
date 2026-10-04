import Foundation
import OS1Context

/// The 학습 view shows what routing learned, in the ledger's own units. These
/// checks pin measured raw token/adoption arithmetic. These are synthetic
/// formula fixtures, not actual user performance or causal uplift evidence.
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

    // Normalized input already includes cached input. No price weights and no
    // second addition of cache tokens are allowed in a token-count metric.
    let weighted = attempt("claude", "sonnet", "medium", .adopted, input: 1_000_000, cache: 990_000, output: 2_000, seconds: 10)
    check(GovernanceLearning.measuredTokens(weighted.observation!) == 1_002_000, "raw normalized input plus output, cache once")
    // Untrusted accounting is unmeasured, never a guess.
    let untrusted = attempt("codex", "gpt-6-sol", "medium", .adopted, input: 500, output: 5, seconds: 10, trusted: false)
    check(GovernanceLearning.measuredTokens(untrusted.observation!) == nil, "old Codex accounting is unmeasured")
    let empty = attempt("claude", "opus", "max", .capabilityFailure, input: 0, cache: 0, output: 0, seconds: 1)
    check(GovernanceLearning.measuredTokens(empty.observation!) == 0, "an explicitly measured zero remains zero, not inferred usage")

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
    check(abs((astra.meanSecondsCompleted ?? 0) - 40) < 0.01, "all-counted-attempt time per adopted receipt")
    check(luna.meanSecondsCompleted == 35, "all failed and adopted attempt durations are charged per adoption")
    check(GovernanceLearning.routes(snapshot, provider: "claude").isEmpty, "provider filter")

    // Variable costs expose the former geometric-mean error: sqrt(10*1000)
    // divided by 1/2 reports 200, but measured cost per adoption is 1010.
    var variable = GovernanceSnapshot()
    variable.tasks = [
        task([attempt("codex", "gpt-variable", "max", .adopted, input: 10, output: 0, seconds: 1)], at: now.addingTimeInterval(-100)),
        task([attempt("codex", "gpt-variable", "max", .qualityFailure, input: 1000, output: 0, seconds: 100)], at: now.addingTimeInterval(-90)),
    ]
    let variableRoute = GovernanceLearning.routes(variable).first!
    check(variableRoute.tokensPerAttempt == 505 && variableRoute.tokensPerCompletion == 1010, "ratio of raw-cost sums, not geometric mean")
    check(variableRoute.meanSecondsCompleted == 101, "failed 100 seconds plus adopted 1 second equals 101 per adoption")
    let variableWindow = GovernanceLearning.trend(variable, now: now).recent
    check(variableWindow.tokensPerCompletion == 1010 && variableWindow.secondsPerCompletion == 101, "route and window use identical whole-attempt denominators")

    var missing = GovernanceSnapshot()
    missing.tasks = [
        task([attempt("codex", "gpt-missing", "max", .adopted, input: 100, output: 0, seconds: 1)], at: now.addingTimeInterval(-100)),
        task([attempt("codex", "gpt-missing", "max", .qualityFailure, input: nil, output: nil, seconds: 100)], at: now.addingTimeInterval(-90)),
    ]
    let missingRoute = GovernanceLearning.routes(missing).first!
    check(missingRoute.measuredAttempts == 1 && missingRoute.attempts == 2 && missingRoute.tokensPerCompletion == nil,
          "a failed attempt with unknown usage cannot become a free attempt")
    check(missingRoute.tokensPerAttempt == nil && GovernanceLearning.trend(missing, now: now).recent.tokensPerCompletion == nil,
          "partial route and window cost are unmeasured")
    check(GovernanceLearning.leaders([missingRoute], minimumAttempts: 1).isEmpty, "unknown-cost route cannot become efficiency leader")
    var missingTime = GovernanceSnapshot()
    missingTime.tasks = [
        task([attempt("codex", "gpt-time", "max", .adopted, input: 100, output: 0, seconds: 1)], at: now.addingTimeInterval(-100)),
        task([attempt("codex", "gpt-time", "max", .timeout, input: 100, output: 0, seconds: 0)], at: now.addingTimeInterval(-90)),
    ]
    check(GovernanceLearning.routes(missingTime).first!.meanSecondsCompleted == nil &&
          GovernanceLearning.trend(missingTime, now: now).recent.secondsPerCompletion == nil,
          "unknown failed duration disables time-per-adoption instead of entering at zero")

    var leader = GovernanceSnapshot()
    leader.tasks = [1, 1, 10_000].map { cost in
        task([attempt("codex", "gpt-variable", "max", .adopted, input: cost, output: 0, seconds: 1)], at: now.addingTimeInterval(-100))
    } + (0..<3).map { _ in
        task([attempt("codex", "gpt-stable", "max", .adopted, input: 100, output: 0, seconds: 1)], at: now.addingTimeInterval(-100))
    }
    check(GovernanceLearning.leaders(GovernanceLearning.routes(leader))["codex"] == "codex / gpt-stable / max",
          "a cheap tail cannot hide one very costly attempt and reverse the leader")

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
    check(trend.previous.secondsPerCompletion == 180 && trend.recent.secondsPerCompletion == 30, "all failed time charged per adoption")
    check(GovernanceLearning.trend(GovernanceSnapshot(), now: now).recent.completionRate == nil, "no data is no rate, not zero")

    // Regression 2026-09-24: last week was nearly all Claude, this week nearly
    // all Codex. The blended trend read as a token regression that no route
    // caused; per backend, neither week-over-week change is a comparison.
    var shifted = GovernanceSnapshot()
    shifted.tasks = (0..<12).map { index in
        task([attempt("claude", "sonnet", "medium", .adopted, input: 20_000, output: 0, seconds: 20)],
             at: now.addingTimeInterval(-10 * 86_400 - Double(index) * 60))
    } + (0..<12).map { index in
        task([attempt("codex", "gpt-5.6-sol", "medium", .adopted, input: 200_000, output: 0, seconds: 20)],
             at: now.addingTimeInterval(-86_400 - Double(index) * 60))
    }
    let blended = GovernanceLearning.trend(shifted, now: now)
    check(blended.previous.tokensPerCompletion == 20_000 && blended.recent.tokensPerCompletion == 200_000,
          "the blended figure moves with the provider mix")
    let perBackend = GovernanceLearning.trends(shifted, now: now)
    check(perBackend.map(\.provider) == ["codex", "claude"], "one trend per backend with evidence")
    check(perBackend.allSatisfy { !$0.completionComparable && !$0.tokensComparable && !$0.secondsComparable },
          "a backend absent from one week is never compared across weeks")
    check(perBackend.first { $0.provider == "codex" }?.recent.tokensPerCompletion == 200_000,
          "the recent value is still shown")

    // Comparable only with enough samples in both weeks.
    func week(_ provider: String, _ count: Int, daysAgo: Double, input: Int) -> [GovernanceTask] {
        (0..<count).map { index in
            task([attempt(provider, "sonnet", "medium", .adopted, input: input, output: 0, seconds: 20)],
                 at: now.addingTimeInterval(-daysAgo * 86_400 - Double(index) * 60))
        }
    }
    var enough = GovernanceSnapshot()
    enough.tasks = week("claude", GovernanceLearning.minimumTrendSamples, daysAgo: 10, input: 40_000)
        + week("claude", GovernanceLearning.minimumTrendSamples, daysAgo: 2, input: 30_000)
    let claudeTrend = GovernanceLearning.trend(enough, now: now, provider: "claude")
    check(claudeTrend.completionComparable && claudeTrend.tokensComparable && claudeTrend.secondsComparable,
          "ten verified results in each week compare")
    check(claudeTrend.previous.tokensPerCompletion == 40_000 && claudeTrend.recent.tokensPerCompletion == 30_000,
          "same-backend descriptive values measured, not matched causal evidence")
    var incompleteWeek = enough
    incompleteWeek.tasks.append(task([attempt("claude", "sonnet", "medium", .qualityFailure,
                                             input: nil, output: nil, seconds: 0)], at: now.addingTimeInterval(-86_400)))
    let incompleteTrend = GovernanceLearning.trend(incompleteWeek, now: now, provider: "claude")
    check(!incompleteTrend.tokensComparable && !incompleteTrend.secondsComparable,
          "ten known adoptions do not wash one missing failed usage or duration")
    var thin = GovernanceSnapshot()
    thin.tasks = week("claude", GovernanceLearning.minimumTrendSamples - 1, daysAgo: 10, input: 40_000)
        + week("claude", GovernanceLearning.minimumTrendSamples, daysAgo: 2, input: 30_000)
    check(!GovernanceLearning.trend(thin, now: now, provider: "claude").completionComparable, "nine samples do not compare")
    check(GovernanceLearning.trends(GovernanceSnapshot(), now: now).isEmpty, "no evidence, no rows")

    print("Governance learning: \(checks) checks passed; raw-token and whole-attempt-duration/adoption arithmetic, descriptive trends only")
}
