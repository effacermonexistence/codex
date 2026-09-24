import Foundation

/// What the routing loop has learned, in the units the server ledger learns
/// in (owner order 2026-09-24: every task's completion and tokens recorded,
/// routing improving toward fewer tokens, more finished tasks and less time).
///
/// Read-only projection of the governance records. Tokens are weighted to
/// input-token equivalents — fresh input + 0.1 × cache reads + 5 × output —
/// the same conversion the route core applies before ranking routes.
public struct GovernanceLearningRoute: Identifiable, Equatable, Sendable {
    public let id: String
    public let provider: String
    public let model: String
    public let effort: String
    /// Attempts that say something about the route: adopted, quality
    /// failure, timeout, capability failure. Quota and verifier outages are
    /// infrastructure, not the route, and are left out as the server does.
    public let attempts: Int
    public let adopted: Int
    public let measuredAttempts: Int
    /// Geometric mean over measured attempts, failures included.
    public let tokensPerAttempt: Double?
    public let meanSecondsCompleted: Double?

    public var completionRate: Double { attempts > 0 ? Double(adopted) / Double(attempts) : 0 }
    /// Tokens it takes this route to produce one verified result.
    public var tokensPerCompletion: Double? {
        guard let tokensPerAttempt, adopted > 0 else { return nil }
        return tokensPerAttempt / completionRate
    }
}

public struct GovernanceLearningWindow: Equatable, Sendable {
    public let attempts: Int
    public let adopted: Int
    /// Verified results whose attempt had trustworthy token accounting.
    public let measuredCompletions: Int
    /// Verified results with a recorded duration.
    public let timedCompletions: Int
    public let tokensPerCompletion: Double?
    public let secondsPerCompletion: Double?
    public var completionRate: Double? { attempts > 0 ? Double(adopted) / Double(attempts) : nil }
}

/// One backend's last `days` against the `days` before. A week-over-week
/// change is only a comparison when both weeks hold enough of the same kind
/// of evidence; otherwise the view shows the recent value alone.
public struct GovernanceLearningTrend: Equatable, Sendable {
    public let provider: String?
    public let recent: GovernanceLearningWindow
    public let previous: GovernanceLearningWindow

    public var completionComparable: Bool { Self.enough(recent.attempts, previous.attempts) }
    public var tokensComparable: Bool { Self.enough(recent.measuredCompletions, previous.measuredCompletions) }
    public var secondsComparable: Bool { Self.enough(recent.timedCompletions, previous.timedCompletions) }

    static func enough(_ recent: Int, _ previous: Int) -> Bool {
        recent >= GovernanceLearning.minimumTrendSamples && previous >= GovernanceLearning.minimumTrendSamples
    }
}

public enum GovernanceLearning {
    public static let cacheReadWeight = 0.1
    public static let outputWeight = 5.0
    /// Fewest samples per week before a week-over-week change is shown.
    public static let minimumTrendSamples = 10
    static let routeOutcomes: Set<String> = ["adopted", "quality_failure", "timeout", "capability_failure"]

    /// Input-token equivalents of one attempt, or nil when its usage is not
    /// trustworthy (the same accounting rule as the token totals elsewhere).
    public static func weightedTokens(_ observation: CompletionFeedbackObservation) -> Double? {
        guard GovernanceSnapshot.tokens(observation) != nil,
              let input = observation.inputTokens, let output = observation.outputTokens,
              input >= 0, output >= 0 else { return nil }
        let cache = min(max(observation.cacheTokens ?? 0, 0), input)
        let weighted = Double(input - cache) + cacheReadWeight * Double(cache) + outputWeight * Double(output)
        // An attempt that spent nothing never reached inference: unmeasured,
        // not a one-token attempt that drags the route's average to zero.
        return weighted > 0 ? weighted : nil
    }

    static func counted(_ attempt: GovernanceAttempt) -> CompletionFeedbackObservation? {
        guard let observation = attempt.observation, routeOutcomes.contains(observation.outcome.rawValue),
              ["codex", "claude"].contains(attempt.provider) else { return nil }
        return observation
    }

    public static func routes(_ snapshot: GovernanceSnapshot, since: Date? = nil,
                              provider: String? = nil) -> [GovernanceLearningRoute] {
        struct Totals { var attempts = 0, adopted = 0, measured = 0; var logTokens = 0.0; var logSeconds = 0.0, timed = 0 }
        var totals: [String: (String, String, String, Totals)] = [:]
        for task in snapshot.selectedTasks(since: since) {
            for attempt in task.attempts {
                guard let observation = counted(attempt), provider == nil || attempt.provider == provider else { continue }
                var entry = totals[attempt.route] ?? (attempt.provider, attempt.model, attempt.effort, Totals())
                entry.3.attempts += 1
                if observation.outcome.rawValue == "adopted" {
                    entry.3.adopted += 1
                    let ms = observation.durationMS
                    if ms > 0 {
                        entry.3.logSeconds += log(max(1, Double(ms) / 1000)); entry.3.timed += 1
                    }
                }
                if let tokens = weightedTokens(observation) {
                    entry.3.measured += 1
                    entry.3.logTokens += log(max(1, tokens))
                }
                totals[attempt.route] = entry
            }
        }
        return totals.map { id, entry in
            let t = entry.3
            return GovernanceLearningRoute(
                id: id, provider: entry.0, model: entry.1, effort: entry.2,
                attempts: t.attempts, adopted: t.adopted, measuredAttempts: t.measured,
                tokensPerAttempt: t.measured > 0 ? exp(t.logTokens / Double(t.measured)) : nil,
                meanSecondsCompleted: t.timed > 0 ? exp(t.logSeconds / Double(t.timed)) : nil)
        }
        .sorted { lhs, rhs in
            if lhs.provider != rhs.provider { return lhs.provider < rhs.provider }
            switch (lhs.tokensPerCompletion, rhs.tokensPerCompletion) {
            case let (l?, r?) where l != r: return l < r
            case (.some, nil): return true
            case (nil, .some): return false
            default: return lhs.attempts != rhs.attempts ? lhs.attempts > rhs.attempts : lhs.id < rhs.id
            }
        }
    }

    /// The most efficient measured route per provider: fewest tokens per
    /// verified result among routes with enough attempts to mean something.
    public static func leaders(_ routes: [GovernanceLearningRoute], minimumAttempts: Int = 3) -> [String: String] {
        var best: [String: GovernanceLearningRoute] = [:]
        for route in routes where route.attempts >= minimumAttempts {
            guard let cost = route.tokensPerCompletion else { continue }
            if let current = best[route.provider], let currentCost = current.tokensPerCompletion, currentCost <= cost { continue }
            best[route.provider] = route
        }
        return best.mapValues(\.id)
    }

    static func window(_ snapshot: GovernanceSnapshot, from start: Date, to end: Date,
                       provider: String? = nil) -> GovernanceLearningWindow {
        var attempts = 0, adopted = 0, measuredAdopted = 0, timed = 0
        var tokens = 0.0, measured = false, seconds = 0.0
        for task in snapshot.tasks where task.startedAt >= start && task.startedAt < end {
            for attempt in task.attempts {
                guard let observation = counted(attempt), provider == nil || attempt.provider == provider else { continue }
                attempts += 1
                let success = observation.outcome.rawValue == "adopted"
                if success { adopted += 1 }
                if let value = weightedTokens(observation) {
                    tokens += value; measured = true
                    if success { measuredAdopted += 1 }
                }
                if success, observation.durationMS > 0 { seconds += Double(observation.durationMS) / 1000; timed += 1 }
            }
        }
        return GovernanceLearningWindow(
            attempts: attempts, adopted: adopted, measuredCompletions: measuredAdopted, timedCompletions: timed,
            // Every measured attempt's tokens, failures included, per verified result.
            tokensPerCompletion: measured && measuredAdopted > 0 ? tokens / Double(measuredAdopted) : nil,
            secondsPerCompletion: timed > 0 ? seconds / Double(timed) : nil)
    }

    /// The last `days` against the `days` before: is routing getting better?
    /// Pass a provider: Codex and Claude have separate quotas and very
    /// different fixed context, so a shift of work between them is not a
    /// routing gain or loss (2026-09-24: one week was 97% Claude, the next
    /// 86% Codex, and the blended figure read as a 4.7x token regression).
    public static func trend(_ snapshot: GovernanceSnapshot, now: Date = Date(), days: Int = 7,
                             provider: String? = nil) -> GovernanceLearningTrend {
        let span = TimeInterval(days) * 86_400
        return GovernanceLearningTrend(
            provider: provider,
            recent: window(snapshot, from: now.addingTimeInterval(-span), to: now.addingTimeInterval(1), provider: provider),
            previous: window(snapshot, from: now.addingTimeInterval(-2 * span), to: now.addingTimeInterval(-span),
                             provider: provider))
    }

    /// One trend per backend that has route evidence in either week.
    public static func trends(_ snapshot: GovernanceSnapshot, now: Date = Date(), days: Int = 7) -> [GovernanceLearningTrend] {
        ["codex", "claude"].map { trend(snapshot, now: now, days: days, provider: $0) }
            .filter { $0.recent.attempts > 0 || $0.previous.attempts > 0 }
    }
}
