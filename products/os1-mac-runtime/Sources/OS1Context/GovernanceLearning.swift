import Foundation

/// Measured local operational-route statistics. The server may rank routes
/// using its separate heuristic; that heuristic is not a raw token measure.
///
/// Read-only projection of operational adoption receipts. Token figures are
/// the measured normalized input + output counts, including input cache tokens
/// once. They are not billed dollars, price-weighted units, objective accuracy,
/// or evidence that a routing change caused an improvement.
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
    /// Arithmetic mean over every counted attempt, failures included. Missing
    /// usage on even one counted attempt leaves this unmeasured.
    public let tokensPerAttempt: Double?
    /// Total duration of every counted attempt per adopted receipt, including
    /// failures/retries. Retained API name; not a success-only geometric mean.
    public let meanSecondsCompleted: Double?

    public var completionRate: Double { attempts > 0 ? Double(adopted) / Double(attempts) : 0 }
    /// All measured counted-attempt tokens per adopted receipt. Adoption is
    /// operational execution/delivery evidence, not an objective-quality verdict.
    public var tokensPerCompletion: Double? {
        guard let tokensPerAttempt, measuredAttempts == attempts, attempts > 0, adopted > 0 else { return nil }
        return tokensPerAttempt / completionRate
    }
}

public struct GovernanceLearningWindow: Equatable, Sendable {
    public let attempts: Int
    public let adopted: Int
    /// Adopted receipts whose attempt had trustworthy token accounting.
    public let measuredCompletions: Int
    /// Adopted receipts with a recorded positive duration.
    public let timedCompletions: Int
    public let tokensPerCompletion: Double?
    public let secondsPerCompletion: Double?
    public var completionRate: Double? { attempts > 0 ? Double(adopted) / Double(attempts) : nil }
}

/// One backend's last `days` against the `days` before. A week-over-week
/// change is descriptive and unpaired even with enough observations: model,
/// task, effort and context mixes may differ. Otherwise the view shows the
/// recent value alone. No adaptive weekly look is a causal uplift proof.
public struct GovernanceLearningTrend: Equatable, Sendable {
    public let provider: String?
    public let recent: GovernanceLearningWindow
    public let previous: GovernanceLearningWindow

    public var completionComparable: Bool { Self.enough(recent.attempts, previous.attempts) }
    public var tokensComparable: Bool {
        Self.enough(recent.measuredCompletions, previous.measuredCompletions) &&
        recent.tokensPerCompletion != nil && previous.tokensPerCompletion != nil
    }
    public var secondsComparable: Bool {
        Self.enough(recent.timedCompletions, previous.timedCompletions) &&
        recent.secondsPerCompletion != nil && previous.secondsPerCompletion != nil
    }

    static func enough(_ recent: Int, _ previous: Int) -> Bool {
        recent >= GovernanceLearning.minimumTrendSamples && previous >= GovernanceLearning.minimumTrendSamples
    }
}

public enum GovernanceLearning {
    /// Fewest samples per week before a week-over-week change is shown.
    public static let minimumTrendSamples = 10
    static let routeOutcomes: Set<String> = ["adopted", "quality_failure", "timeout", "capability_failure"]

    /// Raw normalized input + output of one attempt. Cache is already part of
    /// normalized input and must not be added or discounted again. A recorded
    /// zero remains zero; absent/untrusted usage remains nil.
    public static func measuredTokens(_ observation: CompletionFeedbackObservation) -> Int? {
        guard let resource = observation.usageResource,
              (observation.provider == "codex" && resource.format == .codexRolloutJSONL && resource.accountingVersion == 2) ||
              (observation.provider == "claude" && [.claudeJSONL, .claudeResultJSON].contains(resource.format) && resource.accountingVersion == 1),
              let input = observation.inputTokens, let output = observation.outputTokens,
              input >= 0, output >= 0 else { return nil }
        let sum = input.addingReportingOverflow(output)
        return sum.overflow ? nil : sum.partialValue
    }

    /// Source compatibility only. This is now raw tokens, never a price model.
    @available(*, deprecated, message: "Use measuredTokens; token counts are not price-weighted equivalents")
    public static func weightedTokens(_ observation: CompletionFeedbackObservation) -> Double? {
        measuredTokens(observation).map(Double.init)
    }

    static func counted(_ attempt: GovernanceAttempt) -> CompletionFeedbackObservation? {
        guard let observation = attempt.observation, routeOutcomes.contains(observation.outcome.rawValue),
              ["codex", "claude"].contains(attempt.provider) else { return nil }
        return observation
    }

    public static func routes(_ snapshot: GovernanceSnapshot, since: Date? = nil,
                              provider: String? = nil) -> [GovernanceLearningRoute] {
        struct Totals { var attempts = 0, adopted = 0, measured = 0; var tokens = 0.0; var seconds = 0.0, timed = 0 }
        var totals: [String: (String, String, String, Totals)] = [:]
        for task in snapshot.selectedTasks(since: since) {
            for attempt in task.attempts {
                guard let observation = counted(attempt), provider == nil || attempt.provider == provider else { continue }
                var entry = totals[attempt.route] ?? (attempt.provider, attempt.model, attempt.effort, Totals())
                entry.3.attempts += 1
                if observation.outcome.rawValue == "adopted" {
                    entry.3.adopted += 1
                }
                let ms = observation.durationMS
                if ms > 0 {
                    entry.3.seconds += Double(ms) / 1000; entry.3.timed += 1
                }
                if let tokens = measuredTokens(observation) {
                    entry.3.measured += 1
                    entry.3.tokens += Double(tokens)
                }
                totals[attempt.route] = entry
            }
        }
        return totals.map { id, entry in
            let t = entry.3
            return GovernanceLearningRoute(
                id: id, provider: entry.0, model: entry.1, effort: entry.2,
                attempts: t.attempts, adopted: t.adopted, measuredAttempts: t.measured,
                tokensPerAttempt: t.attempts > 0 && t.measured == t.attempts ? t.tokens / Double(t.attempts) : nil,
                meanSecondsCompleted: t.adopted > 0 && t.timed == t.attempts ? t.seconds / Double(t.adopted) : nil)
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

    /// Lowest observed token cost per adoption among fully measured eligible
    /// routes. This descriptive leader is not a held-out quality or uplift claim.
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
        var tokens = 0.0, measuredAttempts = 0, seconds = 0.0, timedAttempts = 0
        for task in snapshot.tasks where task.startedAt >= start && task.startedAt < end {
            for attempt in task.attempts {
                guard let observation = counted(attempt), provider == nil || attempt.provider == provider else { continue }
                attempts += 1
                let success = observation.outcome.rawValue == "adopted"
                if success { adopted += 1 }
                if let value = measuredTokens(observation) {
                    tokens += Double(value); measuredAttempts += 1
                    if success { measuredAdopted += 1 }
                }
                if observation.durationMS > 0 {
                    seconds += Double(observation.durationMS) / 1000; timedAttempts += 1
                    if success { timed += 1 }
                }
            }
        }
        return GovernanceLearningWindow(
            attempts: attempts, adopted: adopted, measuredCompletions: measuredAdopted, timedCompletions: timed,
            // A failed unknown cost/time cannot become a free attempt.
            tokensPerCompletion: attempts > 0 && measuredAttempts == attempts && adopted > 0 ? tokens / Double(adopted) : nil,
            secondsPerCompletion: attempts > 0 && timedAttempts == attempts && adopted > 0 ? seconds / Double(adopted) : nil)
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
