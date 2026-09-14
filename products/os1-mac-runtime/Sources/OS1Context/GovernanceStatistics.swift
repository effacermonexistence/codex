import Foundation

/// Pure measurement mathematics. No calls, ratings, synthetic baselines or inferred verdicts.
/// A nil verdict means no objective verifier receipt, not failure or success.
public struct GovernanceQualitySummary: Sendable {
    public let eligible: Int
    public let verifiedSuccesses: Int
    public let verifiedFailures: Int
    public let unknown: Int
    public let totalTokens: Int?
    public var rate: Double? { eligible > 0 && unknown == 0 ? Double(verifiedSuccesses) / Double(eligible) : nil }
    /// Identification bounds, NOT a confidence interval. Pending work is excluded upstream.
    public var bounds: ClosedRange<Double>? {
        guard eligible > 0 else { return nil }
        return Double(verifiedSuccesses) / Double(eligible)...Double(verifiedSuccesses + unknown) / Double(eligible)
    }
    public var successesPerMillion: Double? {
        guard let t = totalTokens, t > 0, rate != nil else { return nil }
        return Double(verifiedSuccesses) * 1_000_000 / Double(t)
    }
    public init(outcomes: [Bool?], tokens: [Int?]) {
        eligible = outcomes.count
        verifiedSuccesses = outcomes.filter { $0 == true }.count
        verifiedFailures = outcomes.filter { $0 == false }.count
        unknown = outcomes.filter { $0 == nil }.count
        // Ratio of sums; never discard failures or silently zero unknown/invalid costs.
        if !outcomes.isEmpty, tokens.count == outcomes.count, tokens.allSatisfy({ ($0 ?? -1) >= 0 }) {
            var sum = 0, overflow = false
            for token in tokens { let next = sum.addingReportingOverflow(token!); overflow = overflow || next.overflow; sum = next.partialValue }
            totalTokens = overflow ? nil : sum
        } else { totalTokens = nil }
    }
}

public enum GovernanceStatistics {
    /// Negative savings are retained. Undefined denominators remain unmeasured.
    public static func savings(baseline: Double?, candidate: Double?) -> Double? {
        guard let a = baseline, let b = candidate, a.isFinite, b.isFinite, a > 0, b >= 0 else { return nil }
        let value = 1 - b / a
        return value.isFinite ? value : nil
    }
    /// Wilson score interval for a fully observed binary proportion; descriptive, not causal.
    public static func wilson(success: Int, total: Int) -> ClosedRange<Double>? {
        guard total > 0, success >= 0, success <= total else { return nil }
        let z = 1.959963984540054, n = Double(total), p = Double(success) / n
        let d = 1 + z*z/n, center = (p + z*z/(2*n))/d
        let half = z*sqrt(p*(1-p)/n + z*z/(4*n*n))/d
        return max(0, center-half)...min(1, center+half)
    }
    public static func efficiencyGain(baseline: GovernanceQualitySummary, candidate: GovernanceQualitySummary) -> Double? {
        guard baseline.eligible == candidate.eligible,
              let a = baseline.successesPerMillion, let b = candidate.successesPerMillion, a > 0 else { return nil }
        let value = b/a - 1
        return value.isFinite ? value : nil
    }
    /// Sample-level Pareto classification. This is NOT a significance claim or proof of no regressions.
    public static func pareto(tokenSavings: Double?, completionDelta: Double?) -> String {
        guard let t = tokenSavings, let q = completionDelta, t.isFinite, q.isFinite else { return "unmeasured" }
        if t == 0 && q == 0 { return "unchanged" }
        if t >= 0 && q >= 0 { return "pareto_improvement" }
        if t <= 0 && q <= 0 { return "pareto_regression" }
        return "tradeoff"
    }
}

/// Exact paired calculations require a predeclared complete cohort, NOT a join of retry history.
/// This function verifies row identities and missingness, not the authenticity of a caller's evidence.
/// The caller must establish matched input/environment/verifier and gold-blind final lock first.
public struct GovernancePairedSummary: Sendable {
    public struct Row: Sendable {
        public let id: String
        public let baselineSuccess: Bool?
        public let candidateSuccess: Bool?
        public let baselineTokens: Int?
        public let candidateTokens: Int?
        public init(id: String, baselineSuccess: Bool?, candidateSuccess: Bool?, baselineTokens: Int?, candidateTokens: Int?) {
            self.id = id; self.baselineSuccess = baselineSuccess; self.candidateSuccess = candidateSuccess
            self.baselineTokens = baselineTokens; self.candidateTokens = candidateTokens
        }
    }
    public let baseline: GovernanceQualitySummary
    public let candidate: GovernanceQualitySummary
    public let gains: Int
    public let regressions: Int
    public var completionDelta: Double? { guard let a = baseline.rate, let b = candidate.rate else { return nil }; return b-a }
    public var tokenSavings: Double? {
        GovernanceStatistics.savings(baseline: baseline.totalTokens.map(Double.init), candidate: candidate.totalTokens.map(Double.init))
    }
    public var efficiencyGain: Double? { GovernanceStatistics.efficiencyGain(baseline: baseline, candidate: candidate) }
    public var pareto: String { GovernanceStatistics.pareto(tokenSavings: tokenSavings, completionDelta: completionDelta) }
    /// Two-sided exact paired McNemar/binomial p, not an independent two-proportion test.
    /// Repeated looks, adaptive tuning or non-independent tasks invalidate a significance interpretation.
    public var discordanceP: Double? {
        guard baseline.rate != nil, candidate.rate != nil else { return nil }
        let n = gains + regressions
        if n == 0 { return 1 }
        let k = min(gains, regressions)
        var logs: [Double] = [], logTerm = -Double(n) * log(2.0)
        for i in 0...k {
            if i > 0 { logTerm += log(Double(n-i+1)) - log(Double(i)) }
            logs.append(logTerm)
        }
        let m = logs.max()!
        return min(1, 2 * exp(m) * logs.reduce(0) { $0 + exp($1-m) })
    }
    public init?(expectedIDs: [String], rows: [Row]) {
        guard !expectedIDs.isEmpty, expectedIDs.count <= 1_000_000,
              expectedIDs.allSatisfy({ !$0.isEmpty }), Set(expectedIDs).count == expectedIDs.count,
              rows.count == expectedIDs.count, Set(rows.map(\.id)) == Set(expectedIDs) else { return nil }
        baseline = GovernanceQualitySummary(outcomes: rows.map(\.baselineSuccess), tokens: rows.map(\.baselineTokens))
        candidate = GovernanceQualitySummary(outcomes: rows.map(\.candidateSuccess), tokens: rows.map(\.candidateTokens))
        gains = rows.filter { $0.baselineSuccess == false && $0.candidateSuccess == true }.count
        regressions = rows.filter { $0.baselineSuccess == true && $0.candidateSuccess == false }.count
    }
}
