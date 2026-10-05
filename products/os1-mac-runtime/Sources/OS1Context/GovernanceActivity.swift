import Darwin
import Foundation
import OS1System

/// A local, content-free observability lane. Never used to authorize or replay work.
public struct GovernanceAttempt: Codable, Equatable, Sendable {
    public var id: String
    public var startedAt: Date
    /// The monitor's own per-attempt identity.
    public var scope: String
    /// Binding hash of the completion-feedback ledger this attempt was
    /// recorded in. It differs from `scope`: the ledger's input digest is
    /// taken under a drift-instruction revision, the monitor's is not. An
    /// owner retry must address the ledger, so it needs this hash — without
    /// it the revision opened a file that does not exist and did nothing.
    /// Optional so records written before it still decode.
    public var ledgerScope: String? = nil
    public var provider: String
    public var model: String
    public var effort: String
    public var observation: CompletionFeedbackObservation?
    /// Actual executed mode, not a request preference. Optional for existing
    /// receipts; no chat mode is inferred from legacy model/backend records.
    public var surface: String? = nil
    public var route: String {
        let resolved = ProviderSurface.resolveExecuted(rawSurface: surface, provider: provider)
        // Only new explicit chat evidence introduces a new mode key. Full
        // agent and historical keys retain their established identity.
        let identity = resolved?.forcesChatLane == true ? resolved!.rawValue : provider
        return [identity, model, effort].joined(separator: " / ")
    }
    public var displayRoute: String {
        let name = ProviderSurface.resolveExecuted(rawSurface: surface, provider: provider)?.routeTitle
            ?? (provider == "local" ? "OS-1" : provider)
        return [name, model, effort].joined(separator: " / ")
    }
}

public struct GovernanceTask: Codable, Equatable, Sendable {
    public var schema = 1
    public var id: String
    public var startedAt: Date
    public var endedAt: Date?
    public var initialEndedAt: Date?
    public var recoveredAt: Date?
    public var initialDisposition: String?
    public var pid: Int32
    public var disposition: String // running, adopted, not_adopted, cancelled
    public var attempts: [GovernanceAttempt]
    public var revision = CompletionFeedbackScope.validationRevision
    /// When the owner had to send a retry or correction after this task
    /// "completed". Optional: records written before it existed still decode.
    public var ownerRetryAt: Date? = nil
    public var isTerminal: Bool { endedAt != nil }
    public var isAdopted: Bool { isTerminal && disposition == "adopted" }
    /// Done in one click: adopted, and the owner never had to ask again.
    /// This — not adoption, not tokens — is what a completed task means.
    public var isFirstPass: Bool { isAdopted && ownerRetryAt == nil }
    /// Existing receipts certify delivery/adoption, not the user's objective. Never infer that verdict.
    public var verifiedCompletion: Bool? { nil }
    public var route: String {
        let routes = Set(attempts.map(\.route))
        return routes.count == 1 ? routes.first! : (routes.isEmpty ? "local / preparation / none" : "mixed / recovery / multiple")
    }
    public var displayRoute: String {
        let routes = Set(attempts.map(\.displayRoute))
        return routes.count == 1 ? routes.first! : (routes.isEmpty
            ? os1Tr("OS-1 내부 준비", "OS-1 local preparation")
            : os1Tr("여러 실행 경로 / 복구", "Multiple execution routes / recovery"))
    }
    public var tokens: Int? {
        guard !attempts.isEmpty else { return nil } // no provider call is not zero-priced measured work
        let values = attempts.map { $0.observation.flatMap(GovernanceSnapshot.tokens) }
        guard values.allSatisfy({ $0 != nil }) else { return nil }
        return values.compactMap { $0 }.reduce(0, +)
    }
}

public struct GovernanceHistoricalAttempt: Sendable {
    public let scope: String
    public let observation: CompletionFeedbackObservation
}

public struct GovernanceRoute: Identifiable, Sendable {
    public var id: String
    public var attempts = 0
    public var adoptedAttempts = 0
    public var measuredAttempts = 0
    public var tokens = 0
    public var cacheTokens = 0
    public var cacheMeasuredAttempts = 0
    public var durationMS = 0
    public var terminalTasks = 0
    public var adoptedTasks = 0
    public var firstPassTasks = 0
    public var meteredTasks = 0
    public var meteredAdoptedTasks = 0
    public var taskTokens = 0
    public var taskDurationSeconds: Double = 0
    public var adoptionInterval95: ClosedRange<Double>? { GovernanceStatistics.wilson(success: adoptedAttempts, total: attempts) }
    public var completionRate: Double? { terminalTasks > 0 ? Double(adoptedTasks) / Double(terminalTasks) : nil }
    /// Share of terminal tasks the owner never had to re-ask about.
    public var firstPassRate: Double? { terminalTasks > 0 ? Double(firstPassTasks) / Double(terminalTasks) : nil }
    /// Tokens spent on every terminal task on this route, divided by adopted
    /// tasks. Retries and failures stay in the cost; missing usage disables
    /// the ratio rather than turning an unknown cost into zero.
    public var tokensPerCompletedTask: Double? {
        guard terminalTasks > 0, meteredTasks == terminalTasks, taskTokens > 0, adoptedTasks > 0 else { return nil }
        return Double(taskTokens) / Double(adoptedTasks)
    }
    public var adoptionRate: Double? { attempts > 0 ? Double(adoptedAttempts) / Double(attempts) : nil }
    public var meanTokens: Double? { measuredAttempts > 0 ? Double(tokens) / Double(measuredAttempts) : nil }
    // Costs of failed/retried tasks stay in the denominator. Missing usage disables the ratio.
    public var completionsPerMillionTokens: Double? {
        guard terminalTasks > 0, meteredTasks == terminalTasks, taskTokens > 0 else { return nil }
        return Double(adoptedTasks) * 1_000_000 / Double(taskTokens)
    }
}

public struct GovernanceComparison: Identifiable, Sendable {
    public let id: String
    public let baseline: String
    public let matchedScopes: Int
    public let candidateAttempts: Int
    public let baselineAttempts: Int
    public let tokenSavings: Double?
    public let adoptionDelta: Double
    public let latencySavings: Double?
    /// Matched scopes in which every attempt on both routes has supported
    /// measured usage. Every token, cost and efficiency figure below is
    /// computed over exactly these scopes (complete-case): a scope with any
    /// unmeasured attempt is excluded from those sums rather than priced at
    /// zero. At most `matchedScopes`; when it is zero those figures are nil.
    public var measuredScopes = 0
    /// Scopes inside the measured cohort where the route completed at least once.
    public var measuredBaselineCompletions = 0
    public var measuredCandidateCompletions = 0
    /// Equal-weight means over the measured matched-scope cohort. Nil until at
    /// least one matched scope is fully measured; descriptive, not a causal
    /// estimate of model or governance uplift.
    public var baselineMeanTokens: Double? = nil
    public var candidateMeanTokens: Double? = nil
    /// Cost per completed task, candidate vs baseline (positive = candidate
    /// cheaper per completion). Nil until both routes completed one.
    public var completionCostSavings: Double? = nil
    /// Candidate minus baseline terminal-task completion rate. This is a
    /// percentage-point delta, not a percent change and not attempt adoption.
    public var taskCompletionDelta: Double? = nil
    /// Completion rates for the exact same matched scope cohort used by the
    /// token and efficiency deltas. They must never be substituted with each
    /// route's unrelated all-task completion rate.
    public var baselineTaskCompletionRate: Double? = nil
    public var candidateTaskCompletionRate: Double? = nil
    /// Relative change in completed tasks per million measured tokens. Failed
    /// and retried terminal tasks stay in the denominator. Missing task usage
    /// keeps this nil instead of silently becoming zero cost.
    public var completionEfficiencyDelta: Double? = nil
    /// When the newest receipt behind this comparison was recorded (attempt
    /// end). `latestEvidenceAt` spans every matched scope (completion delta);
    /// `latestMeasuredEvidenceAt` only the fully measured ones (token figures).
    /// Nil when that evidence is untimestamped legacy ledger data.
    public var latestEvidenceAt: Date? = nil
    public var latestMeasuredEvidenceAt: Date? = nil
    /// Summed measured tokens over the measured cohort (the numerator and
    /// denominator of `tokenSavings`). Nil without measured usage.
    public var baselineMeasuredTokens: Double? = nil
    public var candidateMeasuredTokens: Double? = nil
    /// Evidence-time series: cumulative token savings after each fully
    /// measured scope, and cumulative completion Δ after each matched scope,
    /// ordered by that scope's last attempt end. Untimestamped legacy scopes
    /// are folded into the cumulative state before the first point. The last
    /// point always equals `tokenSavings` / `taskCompletionDelta`.
    public var tokenEvidence: [GovernanceEvidencePoint] = []
    public var completionEvidence: [GovernanceEvidencePoint] = []
    /// Matched scopes in which the baseline ran before the candidate's first
    /// attempt and was never adopted: the candidate only ever ran after the
    /// baseline failed. When this equals `matchedScopes`
    /// the completion Δ is selection-biased and must not read as an A/B.
    public var candidateAfterBaselineFailureScopes = 0
    public var completionDeltaIsSelectionBiased: Bool {
        matchedScopes > 0 && candidateAfterBaselineFailureScopes == matchedScopes
    }
    /// Matched scopes where each route completed (adopted at least once).
    public var baselineCompletedScopes = 0
    public var candidateCompletedScopes = 0
}

/// One point of a comparison's evidence-time series: the cumulative value
/// after the matched scope recorded at `id` (that scope's last attempt end)
/// joined the cohort. Points sit on real receipt dates, so a frozen cohort
/// shows as a line that stops at its last receipt, never as a fresh sample.
public struct GovernanceEvidencePoint: Identifiable, Equatable, Sendable {
    public let id: Date
    /// Cumulative token savings (`1 − candidate/baseline`) or completion Δ;
    /// nil while the cumulative ratio is undefined (zero-token baseline).
    public let value: Double?
    /// Scopes in the cumulative cohort at this point (measured scopes for
    /// the token series, matched scopes for the completion series).
    public let scopes: Int
    public init(id: Date, value: Double?, scopes: Int) {
        self.id = id; self.value = value; self.scopes = scopes
    }
}

/// What an Overview Δ headline may show. The order of the checks is the
/// contract: an undefined value is unavailable; evidence older than the
/// freshness cutoff (or untimestamped) is stale and never presented as a
/// current number; a defined, fresh value over fewer than `minimumScopes`
/// scopes is "too few to compare"; only then is the value the headline.
public enum GovernanceDeltaHeadline: Equatable, Sendable {
    case unavailable
    case stale(since: Date?)
    case tooFew(scopes: Int)
    case value(Double)

    public static let minimumScopes = 5

    public static func evaluate(value: Double?, scopes: Int, latestEvidence: Date?, freshAfter cutoff: Date,
                                minimum: Int = minimumScopes) -> GovernanceDeltaHeadline {
        guard let value, value.isFinite else { return .unavailable }
        guard let latestEvidence, latestEvidence >= cutoff else { return .stale(since: latestEvidence) }
        guard scopes >= minimum else { return .tooFew(scopes: scopes) }
        return .value(value)
    }
}

/// Owner-facing wording for the monitor's comparison figures. Kept beside
/// the arithmetic so the sign, units and empty states are tested with it.
public enum GovernanceMonitorText {
    /// Savings are `1 − candidate/baseline`; a cut in tokens reads as a
    /// minus. 0.696 → "−69.6%", −0.2 → "+20.0%".
    public static func tokenChange(savings: Double?) -> String {
        guard let savings, savings.isFinite else { return "—" }
        let change = -savings * 100
        let magnitude = String(format: "%.1f%%", abs(change))
        if magnitude == "0.0%" { return "±0.0%" }
        return (change < 0 ? "\u{2212}" : "+") + magnitude
    }
    public static func percentagePoints(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        let points = value * 100
        let magnitude = String(format: "%.1fpp", abs(points))
        if magnitude == "0.0pp" { return "±0.0pp" }
        return (points < 0 ? "\u{2212}" : "+") + magnitude
    }
    /// Token amount in the unit of `scale` (default: its own magnitude), so
    /// a pair reads in one unit: "1.40M → 0.42M", not "1.40M → 424K".
    public static func tokenAmount(_ value: Double, scale: Double? = nil) -> String {
        let magnitude = abs(scale ?? value)
        if magnitude >= 1_000_000_000 { return String(format: "%.2fB", value / 1_000_000_000) }
        if magnitude >= 1_000_000 { return String(format: "%.2fM", value / 1_000_000) }
        if magnitude >= 1_000 { return String(format: "%.0fK", value / 1_000) }
        return String(format: "%.0f", value)
    }
    /// Month/day in the local calendar ("9/20"), identical in both languages.
    public static func shortDate(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.month, .day], from: date)
        return "\(parts.month ?? 0)/\(parts.day ?? 0)"
    }
    /// "1.40M → 0.42M · n=2 · 9/20": measured totals, the cohort size and
    /// the date of the newest receipt behind the token figure.
    public static func tokenCohort(_ item: GovernanceComparison) -> String {
        var parts: [String] = []
        if let a = item.baselineMeasuredTokens, let b = item.candidateMeasuredTokens {
            let scale = max(abs(a), abs(b))
            parts.append("\(tokenAmount(a, scale: scale)) → \(tokenAmount(b, scale: scale))")
        }
        parts.append("n=\(item.measuredScopes)")
        if let date = item.latestMeasuredEvidenceAt { parts.append(shortDate(date)) }
        return parts.joined(separator: " · ")
    }
    public static func staleTitle(since: Date?) -> String {
        guard let since else { return os1Tr("최근 경로 비교 없음", "No recent route comparison") }
        let day = shortDate(since)
        return os1Tr("\(day) 이후 경로 비교 없음", "No route comparison since \(day)")
    }
    public static var staleReason: String {
        os1Tr("현재 라우팅은 요청당 경로 하나만 실행", "current routing runs one route per request")
    }
    public static func tooFew(scopes: Int) -> String {
        os1Tr("n=\(scopes), 비교하기엔 너무 적음", "n=\(scopes), too few to compare")
    }
    /// Goal verdicts have no writer yet. The card says so instead of showing
    /// a "0/N" ratio that reads as zero successes.
    public static func goalValue(_ quality: GovernanceQualitySummary) -> String {
        guard let rate = quality.rate else { return os1Tr("미연결", "Not connected") }
        return String(format: "%.1f%%", rate * 100)
    }
    /// Route keys share provider and model on every effort-escalation pair;
    /// then the effort alone names the side ("medium after low failed").
    public static func sideNames(baseline: String, candidate: String) -> (String, String) {
        let a = baseline.components(separatedBy: " / "), b = candidate.components(separatedBy: " / ")
        if a.count == 3, b.count == 3, a[0] == b[0], a[1] == b[1] { return (a[2], b[2]) }
        let display = { (route: String) in ProviderSurface.displayRouteKey(route).replacingOccurrences(of: " / ", with: " · ") }
        return (display(baseline), display(candidate))
    }
}

/// Cheap directory-level change token used by the native monitor. OS-1 writes
/// activity files atomically, so a receipt mutation changes the parent
/// directory metadata. Unchanged polls can therefore avoid reparsing up to
/// 20,000 JSON files and avoid publishing an identical SwiftUI snapshot.
public struct GovernanceActivityRevision: Equatable, Sendable {
    public let activityModifiedAt: Date?
    public let legacyModifiedAt: Date?

    public init(activityModifiedAt: Date?, legacyModifiedAt: Date?) {
        self.activityModifiedAt = activityModifiedAt
        self.legacyModifiedAt = legacyModifiedAt
    }
}

public struct GovernanceActivitySnapshotUpdate: Sendable {
    public let revision: GovernanceActivityRevision
    public let snapshot: GovernanceSnapshot
    /// Number of JSON files decoded for this update. Full legacy callers leave
    /// this nil; the incremental monitor path reports it for regression proof.
    public let decodedFiles: Int?

    public init(revision: GovernanceActivityRevision, snapshot: GovernanceSnapshot, decodedFiles: Int? = nil) {
        self.revision = revision
        self.snapshot = snapshot
        self.decodedFiles = decodedFiles
    }
}

/// Precomputed monitor state. Expensive route/comparison aggregation is built
/// off the SwiftUI actor and published once per source/filter change.
public struct GovernanceDashboardProjection: Sendable {
    public let snapshot: GovernanceSnapshot
    public let tasks: [GovernanceTask]
    public let terminalTasks: [GovernanceTask]
    public let rows: [GovernanceRoute]
    public let samples: [(String, CompletionFeedbackObservation)]
    public let quality: GovernanceQualitySummary
    public let observedTaskHours: Double
    public let comparisonsByBaseline: [String: [GovernanceComparison]]
    /// Adopted and finished tasks over the whole history (same provider
    /// filter), so a period card can name the all-time figure beside it.
    public var allTimeAdopted = 0
    public var allTimeTerminal = 0

    /// The pair the monitor opens on: the comparison with the newest
    /// evidence, then the most measured scopes, then the most matched
    /// scopes. Remaining ties keep the route table order (baseline with the
    /// most measured tokens first). Never chosen by token volume alone — that
    /// picked a pair whose last receipt was two weeks old.
    public func defaultComparison() -> GovernanceComparison? {
        let order = Dictionary(rows.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
        let all = comparisonsByBaseline.values.flatMap { $0 }
        return all.min { x, y in
            let xd = x.latestEvidenceAt ?? .distantPast, yd = y.latestEvidenceAt ?? .distantPast
            if xd != yd { return xd > yd }
            if x.measuredScopes != y.measuredScopes { return x.measuredScopes > y.measuredScopes }
            if x.matchedScopes != y.matchedScopes { return x.matchedScopes > y.matchedScopes }
            let xo = order[x.baseline] ?? .max, yo = order[y.baseline] ?? .max
            if xo != yo { return xo < yo }
            let xc = order[x.id] ?? .max, yc = order[y.id] ?? .max
            if xc != yc { return xc < yc }
            return (x.baseline, x.id) < (y.baseline, y.id)
        }
    }
}

/// Display-only check for receipts still marked "running": is the process
/// that began the task still alive? A PID that now belongs to a process
/// started after the task (PID reuse) does not count. Never writes a
/// receipt; the monitor only labels such tasks as unfinished.
public enum GovernanceProcessLiveness {
    /// Process start time for `pid`, or nil when no such process exists.
    public static func startTime(pid: Int32) -> Date? {
        guard pid > 0 else { return nil }
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0, size > 0,
              info.kp_proc.p_pid == pid else { return nil }
        let start = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000)
    }
    /// Alive when the PID exists and its process started no later than the
    /// task (one second of slack for clock rounding).
    public static func isAlive(pid: Int32, taskStartedAt: Date,
                               startTime: (Int32) -> Date? = GovernanceProcessLiveness.startTime) -> Bool {
        guard let started = startTime(pid) else { return false }
        return started <= taskStartedAt.addingTimeInterval(1)
    }
    /// Running receipts whose process is gone: unfinished, never complete.
    public static func orphaned(_ tasks: [GovernanceTask],
                                startTime: (Int32) -> Date? = GovernanceProcessLiveness.startTime) -> [GovernanceTask] {
        tasks.filter { !$0.isTerminal && !isAlive(pid: $0.pid, taskStartedAt: $0.startedAt, startTime: startTime) }
    }
}

public struct GovernanceBucket: Identifiable, Sendable {
    public var id: Date
    public var completions = 0
    /// Adopted tasks for which no owner retry/correction was recorded.
    public var firstPassCompletions = 0
    /// Adopted tasks for which an owner retry/correction was recorded.
    public var ownerAssistedCompletions = 0
    public var nonAdopted = 0
    public var tokens = 0
    public var measured = 0
    public var attempts = 0
}

/// One sample of the live activity strip: receipts that started or finished
/// inside the bucket this sample represents. The strip is dense over its whole
/// window, so a flat line at zero is a measured zero, never a missing sample.
public struct GovernanceActivityStripPoint: Identifiable, Equatable, Sendable {
    public let id: Date
    public let started: Double
    public let finished: Double
    public init(id: Date, started: Double, finished: Double) {
        self.id = id; self.started = started; self.finished = finished
    }
}

/// Activity-Monitor-style strip for the governance monitor. The window
/// `[end - span, end]` is anchored to the current detector tick, buckets sit
/// on absolute boundaries so interior samples keep their time while the
/// window slides, and every bucket is present (zero-filled). The first and
/// last samples are pinned to the window edges so the line always spans the
/// full width; the head carries the bucket that contains `end`, so a receipt
/// written this second appears at the right edge immediately.
public struct GovernanceActivityStrip: Equatable, Sendable {
    public static let maximumBuckets = 2_000
    public let start: Date
    public let end: Date
    public let bucketSeconds: TimeInterval
    public let points: [GovernanceActivityStripPoint]
    public var maxValue: Double { points.map { max($0.started, $0.finished) }.max() ?? 0 }
    public var startedTotal: Double { points.reduce(0) { $0 + $1.started } }
    public var finishedTotal: Double { points.reduce(0) { $0 + $1.finished } }

    /// Axis ticks for a sliding window: local-time multiples of `interval`
    /// (midnight, 4:00, 4:05 … in the given zone) kept `edgeMargin` inside
    /// both ends so a label is never clipped at the plot edge. As the window
    /// slides the ticks move with the data, like Activity Monitor's grid.
    public static func axisTicks(from start: Date, to end: Date, every interval: TimeInterval,
                                 edgeMargin: TimeInterval, timeZone: TimeZone = .current) -> [Date] {
        guard interval.isFinite, interval > 0, edgeMargin.isFinite, edgeMargin >= 0, end > start else { return [] }
        let low = start.timeIntervalSince1970 + edgeMargin
        let high = end.timeIntervalSince1970 - edgeMargin
        guard low.isFinite, high.isFinite, high >= low else { return [] }
        let offset = TimeInterval(timeZone.secondsFromGMT(for: end))
        var tick = ceil((low + offset) / interval) * interval - offset
        var ticks: [Date] = []
        while tick <= high, ticks.count < 64 {
            ticks.append(Date(timeIntervalSince1970: tick))
            tick += interval
        }
        return ticks
    }

    public static func build(tasks: [GovernanceTask], until end: Date, span: TimeInterval,
                             bucketSeconds requested: TimeInterval) -> GovernanceActivityStrip {
        guard end.timeIntervalSince1970.isFinite, span.isFinite, span > 0,
              requested.isFinite, requested > 0 else {
            return GovernanceActivityStrip(start: end, end: end, bucketSeconds: 1, points: [])
        }
        // A pathological window/bucket pair is coarsened, never truncated:
        // the strip must always cover its whole window.
        let bucket = max(requested, span / Double(maximumBuckets))
        let start = end.addingTimeInterval(-span)
        func key(_ date: Date) -> Date {
            Date(timeIntervalSince1970: floor(date.timeIntervalSince1970 / bucket) * bucket)
        }
        var counts: [Date: (started: Double, finished: Double)] = [:]
        for task in tasks {
            if task.startedAt >= start, task.startedAt <= end {
                counts[key(task.startedAt), default: (started: 0, finished: 0)].started += 1
            }
            if let endedAt = task.endedAt, endedAt >= start, endedAt <= end {
                counts[key(endedAt), default: (started: 0, finished: 0)].finished += 1
            }
        }
        var points: [GovernanceActivityStripPoint] = []
        points.reserveCapacity(Int(span / bucket) + 3)
        func push(_ x: Date, bucket sample: Date) {
            let clamped = min(max(x, start), end)
            guard points.last.map({ $0.id < clamped }) ?? true else { return }
            let value = counts[sample] ?? (started: 0, finished: 0)
            points.append(GovernanceActivityStripPoint(id: clamped, started: value.started, finished: value.finished))
        }
        push(start, bucket: key(start))
        var cursor = key(start)
        while cursor <= end {
            push(cursor.addingTimeInterval(bucket / 2), bucket: cursor)
            cursor = cursor.addingTimeInterval(bucket)
        }
        push(end, bucket: key(end))
        return GovernanceActivityStrip(start: start, end: end, bucketSeconds: bucket, points: points)
    }
}

public struct GovernanceSnapshot: Sendable {
    public var tasks: [GovernanceTask] = []
    public var historical: [GovernanceHistoricalAttempt] = []
    public var rejectedRecords = 0
    public var omittedFiles = 0
    public var loadedAt = Date()
    public init() {}

    /// Normalized input includes the cache subset for both providers. Do not add cache again.
    public static func tokens(_ o: CompletionFeedbackObservation) -> Int? {
        guard let r = o.usageResource,
              (o.provider == "codex" && r.format == .codexRolloutJSONL && r.accountingVersion == 2) ||
              (o.provider == "claude" && [.claudeJSONL, .claudeResultJSON].contains(r.format) && r.accountingVersion == 1),
              let input = o.inputTokens, let output = o.outputTokens else { return nil }
        return input + output
    }

    public func selectedTasks(since: Date?) -> [GovernanceTask] {
        tasks.filter { since == nil || $0.startedAt >= since! }
    }
    public func quality(since: Date?) -> GovernanceQualitySummary {
        let eligible = selectedTasks(since: since).filter(\.isTerminal)
        return GovernanceQualitySummary(outcomes: eligible.map(\.verifiedCompletion), tokens: eligible.map(\.tokens))
    }
    /// A requested lookback is not proof that telemetry existed throughout that period.
    /// Untimestamped historical attempts cannot establish a task observation window.
    public func observedTaskHours(now: Date, since: Date?) -> Double {
        guard let first = tasks.map(\.startedAt).min() else { return 0 }
        let start = since.map { max(first, $0) } ?? first
        return max(0, now.timeIntervalSince(start) / 3600)
    }
    public func routes(since: Date?, includeHistorical: Bool) -> [GovernanceRoute] {
        var rows: [String: GovernanceRoute] = [:]
        for (_, key, o) in routeSamples(since: since, includeHistorical: includeHistorical) {
            var row = rows[key] ?? GovernanceRoute(id: key)
            row.attempts += 1; row.adoptedAttempts += o.outcome == .adopted ? 1 : 0
            row.durationMS += o.durationMS
            if let value = Self.tokens(o) {
                row.tokens += value; row.measuredAttempts += 1
                if let cache = o.cacheTokens { row.cacheTokens += cache; row.cacheMeasuredAttempts += 1 }
            }
            rows[key] = row
        }
        for t in selectedTasks(since: since) where t.isTerminal {
            var row = rows[t.route] ?? GovernanceRoute(id: t.route)
            row.terminalTasks += 1; row.adoptedTasks += t.isAdopted ? 1 : 0; row.firstPassTasks += t.isFirstPass ? 1 : 0
            if let value = t.tokens { row.meteredTasks += 1; row.taskTokens += value; row.meteredAdoptedTasks += t.isAdopted ? 1 : 0 }
            row.taskDurationSeconds += t.endedAt!.timeIntervalSince(t.startedAt)
            rows[t.route] = row
        }
        return rows.values.sorted { $0.tokens == $1.tokens ? $0.id < $1.id : $0.tokens > $1.tokens }
    }

    public func samples(since: Date?, includeHistorical: Bool) -> [(String, CompletionFeedbackObservation)] {
        var seen = Set<String>(); var result: [(String, CompletionFeedbackObservation)] = []
        // New timestamped records win. Exclude their IDs from the old ledger even outside the chosen window.
        let currentIDs = Set(tasks.flatMap(\.attempts).map(\.id))
        for task in selectedTasks(since: since) {
            for a in task.attempts {
                if let o = a.observation, seen.insert(a.id).inserted { result.append((a.scope, o)) }
            }
        }
        if includeHistorical {
            for a in historical {
                let id = a.observation.executionID + ":" + String(a.observation.sequence)
                if !currentIDs.contains(id), seen.insert(id).inserted { result.append((a.scope, a.observation)) }
            }
        }
        return result
    }

    /// Observation accounting still names the actual provider. Join its
    /// immutable execution ID to the monitor's recorded mode to group new
    /// chat evidence separately; historical ledger-only samples stay legacy.
    private func routeSamples(since: Date?, includeHistorical: Bool)
        -> [(scope: String, route: String, observation: CompletionFeedbackObservation)] {
        let keys = Dictionary(tasks.flatMap(\.attempts).map { ($0.id, $0.route) },
                              uniquingKeysWith: { first, _ in first })
        return samples(since: since, includeHistorical: includeHistorical).map { scope, observation in
            let id = observation.executionID + ":" + String(observation.sequence)
            let route = keys[id] ?? [observation.provider, observation.model, observation.effort].joined(separator: " / ")
            return (scope, route, observation)
        }
    }

    /// Equal-weight scope-standardized means, ratio of sums (not mean of percentages), never cross-provider comparisons or causal uplift.
    /// Legacy scopes bind initial requests, not necessarily every recovery prompt.
    /// Includes failures and retries in token/time costs. The completion delta
    /// spans every matched scope; token, cost and efficiency deltas span the
    /// fully measured subset of that same cohort (`measuredScopes`), so an
    /// unmeasured failed attempt drops its scope from the token figures instead
    /// of entering them as a free attempt. Unrelated route tasks cannot change
    /// any of these deltas.
    public func comparisons(baseline: String, since: Date?, includeHistorical: Bool) -> [GovernanceComparison] {
        let grouped = Dictionary(grouping: routeSamples(since: since, includeHistorical: includeHistorical), by: { $0.scope })
        let provider = ProviderSurface.providerForRouteKey(baseline)
        let routeRows = routes(since: since, includeHistorical: includeHistorical)
        let routeIDs = routeRows.map(\.id).filter {
            $0 != baseline && provider != nil && ProviderSurface.providerForRouteKey($0) == provider
        }
        // When each timestamped receipt was recorded (attempt end) and when
        // it started. Legacy ledger observations carry no time and stay absent.
        let recordedAt = attemptRecordedAt()
        let startedAt = Dictionary(tasks.flatMap(\.attempts).map { ($0.id, $0.startedAt) },
                                   uniquingKeysWith: { first, _ in first })
        func key(_ o: CompletionFeedbackObservation) -> String { o.executionID + ":" + String(o.sequence) }
        return routeIDs.compactMap { route in
            struct Scope {
                var recordedAt: Date?
                var aCompleted: Bool, bCompleted: Bool
                var aTokens: Double?, bTokens: Double?
                var adoptionDelta: Double
                var aDuration: Double, bDuration: Double
                var aAttempts: Int, bAttempts: Int
                var candidateAfterBaselineFailure: Bool
            }
            var scopes: [Scope] = []
            for entries in grouped.values {
                func select(_ key: String) -> [CompletionFeedbackObservation] {
                    entries.filter { $0.route == key }.map(\.observation)
                }
                let a = select(baseline), b = select(route)
                guard !a.isEmpty, !b.isEmpty else { continue }
                // Written as small sub-expressions on purpose: as one line the
                // adoption delta mixed Int/Double conversions, filters and
                // division, and the CI toolchain gave up type-checking it.
                let aAdopted: Int = a.filter { $0.outcome == .adopted }.count
                let bAdopted: Int = b.filter { $0.outcome == .adopted }.count
                let aRate: Double = Double(aAdopted) / Double(a.count)
                let bRate: Double = Double(bAdopted) / Double(b.count)
                let at = a.compactMap(Self.tokens), bt = b.compactMap(Self.tokens)
                // Complete-case cohort: the scope enters the token sums only
                // when every attempt on both routes was measured. A scope with
                // an unmeasured attempt (typically a failed attempt whose usage
                // was never captured) is left out rather than counted at zero.
                let measured = at.count == a.count && bt.count == b.count
                let aStarts = a.compactMap { startedAt[key($0)] }, bStarts = b.compactMap { startedAt[key($0)] }
                // The baseline ran (and, below, failed) before the candidate's
                // first attempt. A later re-run of both (low → medium → … →
                // low → medium) is still "candidate after baseline failure".
                let ordered = aStarts.count == a.count && bStarts.count == b.count
                    && aStarts.min()! < bStarts.min()!
                let aDurationSum: Int = a.map(\.durationMS).reduce(0, +)
                let bDurationSum: Int = b.map(\.durationMS).reduce(0, +)
                scopes.append(Scope(recordedAt: (a + b).compactMap { recordedAt[key($0)] }.max(),
                    aCompleted: aAdopted > 0, bCompleted: bAdopted > 0,
                    aTokens: measured ? Double(at.reduce(0, +)) : nil, bTokens: measured ? Double(bt.reduce(0, +)) : nil,
                    adoptionDelta: bRate - aRate, aDuration: Double(aDurationSum), bDuration: Double(bDurationSum),
                    aAttempts: a.count, bAttempts: b.count,
                    candidateAfterBaselineFailure: ordered && aAdopted == 0))
            }
            guard !scopes.isEmpty else { return nil }
            // One accumulation order for the series and the final figures, so
            // the last evidence point is exactly the headline value. Legacy
            // (untimestamped) scopes come first and add no point of their own.
            scopes.sort { ($0.recordedAt ?? .distantPast) < ($1.recordedAt ?? .distantPast) }
            var count = 0, measured = 0, completedA = 0, completedB = 0
            var measuredCompletedA = 0, measuredCompletedB = 0, baselineN = 0, candidateN = 0, biased = 0
            var baselineTokens = 0.0, candidateTokens = 0.0, timeA = 0.0, timeB = 0.0, adoptionSum = 0.0
            var latestEvidence: Date?, latestMeasuredEvidence: Date?
            var tokenEvidence: [GovernanceEvidencePoint] = [], completionEvidence: [GovernanceEvidencePoint] = []
            func push(_ point: GovernanceEvidencePoint, into series: inout [GovernanceEvidencePoint]) {
                // Two scopes recorded at the same instant are one point: the
                // later accumulation wins, so chart identities stay unique.
                if series.last?.id == point.id { series.removeLast() }
                series.append(point)
            }
            for scope in scopes {
                count += 1; baselineN += scope.aAttempts; candidateN += scope.bAttempts
                completedA += scope.aCompleted ? 1 : 0; completedB += scope.bCompleted ? 1 : 0
                adoptionSum += scope.adoptionDelta; timeA += scope.aDuration; timeB += scope.bDuration
                biased += scope.candidateAfterBaselineFailure ? 1 : 0
                if let date = scope.recordedAt {
                    latestEvidence = max(latestEvidence ?? date, date)
                    push(GovernanceEvidencePoint(id: date, value: Double(completedB) / Double(count) - Double(completedA) / Double(count),
                                                 scopes: count), into: &completionEvidence)
                }
                if let aTokens = scope.aTokens, let bTokens = scope.bTokens {
                    measured += 1; baselineTokens += aTokens; candidateTokens += bTokens
                    measuredCompletedA += scope.aCompleted ? 1 : 0
                    measuredCompletedB += scope.bCompleted ? 1 : 0
                    if let date = scope.recordedAt {
                        latestMeasuredEvidence = max(latestMeasuredEvidence ?? date, date)
                        push(GovernanceEvidencePoint(id: date,
                            value: GovernanceStatistics.savings(baseline: baselineTokens, candidate: candidateTokens),
                            scopes: measured), into: &tokenEvidence)
                    }
                }
            }
            let hasMeasuredUsage = measured > 0
            let baselineCompletionRate = Double(completedA) / Double(count)
            let candidateCompletionRate = Double(completedB) / Double(count)
            var comparison = GovernanceComparison(id: route, baseline: baseline, matchedScopes: count,
                candidateAttempts: candidateN, baselineAttempts: baselineN,
                tokenSavings: hasMeasuredUsage ? GovernanceStatistics.savings(baseline: baselineTokens, candidate: candidateTokens) : nil,
                adoptionDelta: adoptionSum / Double(count),
                latencySavings: GovernanceStatistics.savings(baseline: timeA, candidate: timeB))
            comparison.measuredScopes = measured
            comparison.measuredBaselineCompletions = measuredCompletedA
            comparison.measuredCandidateCompletions = measuredCompletedB
            comparison.baselineMeanTokens = hasMeasuredUsage ? baselineTokens / Double(measured) : nil
            comparison.candidateMeanTokens = hasMeasuredUsage ? candidateTokens / Double(measured) : nil
            comparison.baselineMeasuredTokens = hasMeasuredUsage ? baselineTokens : nil
            comparison.candidateMeasuredTokens = hasMeasuredUsage ? candidateTokens : nil
            comparison.baselineTaskCompletionRate = baselineCompletionRate
            comparison.candidateTaskCompletionRate = candidateCompletionRate
            comparison.baselineCompletedScopes = completedA
            comparison.candidateCompletedScopes = completedB
            comparison.taskCompletionDelta = candidateCompletionRate - baselineCompletionRate
            comparison.latestEvidenceAt = latestEvidence
            comparison.latestMeasuredEvidenceAt = hasMeasuredUsage ? latestMeasuredEvidence : nil
            comparison.tokenEvidence = hasMeasuredUsage ? tokenEvidence : []
            comparison.completionEvidence = completionEvidence
            comparison.candidateAfterBaselineFailureScopes = biased
            if hasMeasuredUsage {
                // Completions and tokens come from the same measured scopes, so
                // a completion whose cost is unknown never inflates efficiency.
                if measuredCompletedA > 0, measuredCompletedB > 0 {
                    comparison.completionCostSavings = GovernanceStatistics.savings(
                        baseline: baselineTokens / Double(measuredCompletedA),
                        candidate: candidateTokens / Double(measuredCompletedB))
                }
                if baselineTokens > 0, candidateTokens > 0, measuredCompletedA > 0 {
                    let baselineEfficiency = Double(measuredCompletedA) / baselineTokens
                    let candidateEfficiency = Double(measuredCompletedB) / candidateTokens
                    comparison.completionEfficiencyDelta = candidateEfficiency / baselineEfficiency - 1
                }
            }
            return comparison
        }
    }

    /// Ceiling the runtime applies to `durationMS` (main.swift caps an
    /// attempt's recorded duration at one hour).
    public static let recordedDurationCapMS = 3_600_000

    /// When each timestamped attempt's receipt was recorded: start plus its
    /// duration. A duration at the one-hour cap is a floor, not the real
    /// length, so the last attempt of a finished task then uses the task's
    /// end instead of understating how recent the evidence is.
    public func attemptRecordedAt() -> [String: Date] {
        var result: [String: Date] = [:]
        for task in tasks {
            for (index, attempt) in task.attempts.enumerated() {
                guard let o = attempt.observation, result[attempt.id] == nil else { continue }
                var end = attempt.startedAt.addingTimeInterval(Double(o.durationMS) / 1000)
                if o.durationMS >= Self.recordedDurationCapMS, index == task.attempts.count - 1,
                   let taskEnd = task.endedAt, taskEnd > end {
                    end = taskEnd
                }
                result[attempt.id] = end
            }
        }
        return result
    }

    public func dashboardProjection(provider: String?, since: Date?, includeHistorical: Bool,
                                    now: Date = Date()) -> GovernanceDashboardProjection {
        var filtered = self
        if let provider {
            // Preserve mixed-route retry cost whenever the selected provider
            // participated in the task.
            filtered.tasks = filtered.tasks.filter { $0.attempts.contains { $0.provider == provider } }
            filtered.historical = filtered.historical.filter { $0.observation.provider == provider }
        }
        let tasks = filtered.selectedTasks(since: since)
        let terminal = tasks.filter(\.isTerminal)
        let rows = filtered.routes(since: since, includeHistorical: includeHistorical)
        let samples = filtered.samples(since: since, includeHistorical: includeHistorical)
        var comparisons: [String: [GovernanceComparison]] = [:]
        for row in rows where row.attempts > 0 {
            comparisons[row.id] = filtered.comparisons(baseline: row.id, since: since,
                                                       includeHistorical: includeHistorical)
        }
        var projection = GovernanceDashboardProjection(snapshot: filtered, tasks: tasks, terminalTasks: terminal,
            rows: rows, samples: samples, quality: filtered.quality(since: since),
            observedTaskHours: filtered.observedTaskHours(now: now, since: since),
            comparisonsByBaseline: comparisons)
        let allTerminal = since == nil ? terminal : filtered.tasks.filter(\.isTerminal)
        projection.allTimeTerminal = allTerminal.count
        projection.allTimeAdopted = allTerminal.filter(\.isAdopted).count
        return projection
    }

    public func timeline(since: Date, until: Date, bucketSeconds: Double) -> [GovernanceBucket] {
        guard bucketSeconds.isFinite, bucketSeconds > 0, until >= since else { return [] }
        var buckets: [Date: GovernanceBucket] = [:]
        func key(_ d: Date) -> Date { Date(timeIntervalSince1970: floor(d.timeIntervalSince1970 / bucketSeconds) * bucketSeconds) }
        for task in tasks {
            if let end = task.endedAt, end >= since, end <= until {
                let k = key(end); var b = buckets[k] ?? GovernanceBucket(id: k)
                if task.isAdopted {
                    b.completions += 1
                    if task.isFirstPass { b.firstPassCompletions += 1 }
                    if task.ownerRetryAt != nil { b.ownerAssistedCompletions += 1 }
                } else { b.nonAdopted += 1 }
                buckets[k] = b
            }
            for attempt in task.attempts {
                guard let o = attempt.observation else { continue }
                let end = attempt.startedAt.addingTimeInterval(Double(o.durationMS) / 1000)
                guard end >= since, end <= until else { continue }
                let k = key(end); var b = buckets[k] ?? GovernanceBucket(id: k)
                b.attempts += 1
                if let tokens = Self.tokens(o) { b.tokens += tokens; b.measured += 1 }
                buckets[k] = b
            }
        }
        return buckets.values.sorted { $0.id < $1.id }
    }
}

public struct GovernanceActivityStore: Sendable {
    public let root: URL
    public init(root: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/governance-activity")) {
        self.root = root.standardizedFileURL
    }
    private func url(_ id: String) throws -> URL {
        guard UUID(uuidString: id) != nil, root.resolvingSymlinksInPath().path == root.path else { throw CompletionFeedbackError.invalid }
        let path = root.appendingPathComponent(id.lowercased() + ".json")
        guard path.resolvingSymlinksInPath().path == path.path else { throw CompletionFeedbackError.invalid }
        return path
    }
    private func save(_ task: GovernanceTask) throws {
        try Self.validate(task)
        let path = try url(task.id)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(task)
        try data.write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        guard try JSONDecoder().decode(GovernanceTask.self, from: Self.read(path)) == task else { throw CompletionFeedbackError.invalid }
    }
    private func withLock<T>(_ id: String, _ body: () throws -> T) throws -> T {
        _ = try url(id)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let lock = root.appendingPathComponent(id.lowercased() + ".lock")
        let fd = lock.path.withCString { Darwin.open($0, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, mode_t(0o600)) }
        guard fd >= 0 else { throw CompletionFeedbackError.lockUnavailable }
        defer { Darwin.close(fd) }
        var acquired = false
        for _ in 0..<20 {
            if os1_flock(fd, LOCK_EX | LOCK_NB) == 0 { acquired = true; break }
            guard errno == EWOULDBLOCK || errno == EAGAIN else { throw CompletionFeedbackError.lockUnavailable }
            usleep(10_000)
        }
        guard acquired else { throw CompletionFeedbackError.lockUnavailable }
        defer { _ = os1_flock(fd, LOCK_UN) }
        return try body()
    }
    public func begin(id: String, now: Date = Date()) throws {
        try withLock(id) {
        guard !FileManager.default.fileExists(atPath: try url(id).path) else { throw CompletionFeedbackError.invalid }
        try save(GovernanceTask(id: id, startedAt: now, pid: getpid(), disposition: "running", attempts: []))
        }
    }
    public func attempt(id: String, executionID: String, sequence: Int, scope: CompletionFeedbackScope,
                        provider: String, model: String, effort: String, startedAt: Date,
                        observation: CompletionFeedbackObservation? = nil,
                        ledgerScope: CompletionFeedbackScope? = nil, surface: String? = nil) throws {
        try scope.validate()
        try ledgerScope?.validate()
        try withLock(id) {
        let path = try url(id)
        var task = try JSONDecoder().decode(GovernanceTask.self, from: Self.read(path))
        try Self.validate(task)
        let key = executionID.lowercased() + ":" + String(sequence)
        var item = GovernanceAttempt(id: key, startedAt: startedAt, scope: scope.bindingSHA256,
            provider: provider, model: model, effort: effort, observation: observation)
        item.ledgerScope = ledgerScope?.bindingSHA256
        if let surface,
           ProviderSurface.resolveExecuted(rawSurface: surface, provider: provider)?.rawValue == surface {
            item.surface = surface
        }
        if let index = task.attempts.firstIndex(where: { $0.id == key }) {
            // Repeated completion notification is idempotent; a start may never erase usage.
            if observation != nil {
                item.ledgerScope = item.ledgerScope ?? task.attempts[index].ledgerScope
                item.surface = item.surface ?? task.attempts[index].surface
                task.attempts[index] = item
            } else {
                if task.attempts[index].ledgerScope == nil { task.attempts[index].ledgerScope = item.ledgerScope }
                if task.attempts[index].surface == nil { task.attempts[index].surface = item.surface }
            }
        } else { task.attempts.append(item) }
        try save(task)
        }
    }
    /// The owner sent a retry or correction after this task completed.
    public func markOwnerRetry(id: String, now: Date = Date()) throws {
        try withLock(id) {
            var task = try JSONDecoder().decode(GovernanceTask.self, from: Self.read(try url(id)))
            try Self.validate(task)
            guard task.isTerminal, task.ownerRetryAt == nil else { return }
            task.ownerRetryAt = now
            try save(task)
        }
    }
    public func finish(id: String, adopted: Bool, cancelled: Bool = false, now: Date = Date()) throws {
        try withLock(id) {
            var task = try JSONDecoder().decode(GovernanceTask.self, from: Self.read(try url(id)))
            try Self.validate(task)
            guard task.endedAt == nil else { return } // immutable initial termination; recovery is a separate gate
            task.endedAt = now; task.disposition = adopted ? "adopted" : (cancelled ? "cancelled" : "not_adopted")
            try save(task)
        }
    }
    /// Caller must first verify the signed outbox, native persistence and server adoption.
    /// Reconciles existing metadata only; never creates a call, estimates usage, or replays work.
    public func deliveryAdopted(executionID: String, sequence: Int, now: Date = Date()) throws {
        let key = executionID.lowercased() + ":" + String(sequence)
        let matches = snapshot(legacyRoot: nil).tasks.filter { $0.attempts.contains { $0.id == key } }
        guard matches.count == 1 else { throw CompletionFeedbackError.invalid }
        try withLock(matches[0].id) {
            var task = try JSONDecoder().decode(GovernanceTask.self, from: Self.read(try url(matches[0].id)))
            try Self.validate(task)
            guard !task.isAdopted else { return }
            guard let end = task.endedAt, now >= end else { throw CompletionFeedbackError.invalid }
            task.initialEndedAt = end; task.initialDisposition = task.disposition
            task.recoveredAt = now; task.endedAt = now; task.disposition = "adopted"
            try save(task)
        }
    }
    fileprivate static func read(_ path: URL) throws -> Data {
        guard path.resolvingSymlinksInPath().path == path.standardizedFileURL.path,
              let attrs = try? FileManager.default.attributesOfItem(atPath: path.path),
              attrs[.type] as? FileAttributeType == .typeRegular,
              let size = attrs[.size] as? Int, size > 0, size <= 512_000 else { throw CompletionFeedbackError.invalid }
        return try Data(contentsOf: path)
    }
    private static func directoryModifiedAt(_ directory: URL?) -> Date? {
        guard let directory,
              directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path,
              let attributes = try? FileManager.default.attributesOfItem(atPath: directory.path),
              attributes[.type] as? FileAttributeType == .typeDirectory else { return nil }
        return attributes[.modificationDate] as? Date
    }
    public func revision(legacyRoot: URL? = CompletionFeedbackStore().root) -> GovernanceActivityRevision {
        GovernanceActivityRevision(activityModifiedAt: Self.directoryModifiedAt(root),
                                   legacyModifiedAt: Self.directoryModifiedAt(legacyRoot))
    }
    /// Returns nil when no activity directory changed. Callers retain their
    /// existing snapshot and avoid a main-thread redraw in that case.
    public func snapshotIfChanged(after previous: GovernanceActivityRevision?,
                                  legacyRoot: URL? = CompletionFeedbackStore().root) -> GovernanceActivitySnapshotUpdate? {
        let current = revision(legacyRoot: legacyRoot)
        guard previous == nil || previous != current else { return nil }
        return GovernanceActivitySnapshotUpdate(revision: current, snapshot: snapshot(legacyRoot: legacyRoot))
    }
    public static func validate(_ task: GovernanceTask) throws {
        guard task.schema == 1, UUID(uuidString: task.id) != nil, task.pid > 0,
              task.startedAt.timeIntervalSince1970.isFinite, task.revision == CompletionFeedbackScope.validationRevision,
              task.endedAt.map({ $0.timeIntervalSince1970.isFinite && $0 >= task.startedAt }) ?? true,
              (task.recoveredAt == nil) == (task.initialEndedAt == nil),
              (task.recoveredAt == nil) == (task.initialDisposition == nil),
              task.recoveredAt.map({ $0 == task.endedAt && task.disposition == "adopted" && task.initialEndedAt! >= task.startedAt && task.initialEndedAt! <= $0 && ["not_adopted", "cancelled"].contains(task.initialDisposition!) }) ?? true,
              ["running", "adopted", "not_adopted", "cancelled"].contains(task.disposition),
              (task.disposition == "running") == (task.endedAt == nil), task.attempts.count <= 64,
              Set(task.attempts.map(\.id)).count == task.attempts.count else { throw CompletionFeedbackError.invalid }
        for a in task.attempts {
            let parts = a.id.split(separator: ":")
            guard parts.count == 2, UUID(uuidString: String(parts[0])) != nil,
                  let sequence = Int(parts[1]), (1...16).contains(sequence),
                  CompletionFeedbackScope.isDigest(a.scope), a.startedAt.timeIntervalSince1970.isFinite, a.startedAt >= task.startedAt,
                  ["local", "codex", "claude"].contains(a.provider),
                  a.model.wholeMatch(of: /^[A-Za-z0-9._-]{1,96}$/) != nil,
                  a.effort.wholeMatch(of: /^[A-Za-z0-9._-]{1,96}$/) != nil else { throw CompletionFeedbackError.invalid }
            if let surface = a.surface,
               ProviderSurface.resolveExecuted(rawSurface: surface, provider: a.provider)?.rawValue != surface {
                throw CompletionFeedbackError.invalid
            }
            if let o = a.observation {
                try o.validate()
                guard o.executionID + ":" + String(o.sequence) == a.id,
                      o.provider == a.provider, o.model == a.model, o.effort == a.effort else { throw CompletionFeedbackError.invalid }
            }
        }
    }
    public func snapshot(legacyRoot: URL? = CompletionFeedbackStore().root) -> GovernanceSnapshot {
        var result = GovernanceSnapshot()
        for (directory, isLegacy) in [(root, false)] + (legacyRoot.map { [($0, true)] } ?? []) {
            guard directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path else { result.rejectedRecords += 1; continue }
            guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else {
                if FileManager.default.fileExists(atPath: directory.path) { result.rejectedRecords += 1 }; continue
            }
            let json = files.filter { $0.pathExtension == "json" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
            result.omittedFiles += max(0, json.count - 20_000)
            for file in json.prefix(20_000) {
                do {
                    let data = try Self.read(file)
                    if isLegacy {
                        let ledger = try JSONDecoder().decode(CompletionFeedbackLedger.self, from: data)
                        try ledger.validate()
                        guard file.deletingPathExtension().lastPathComponent == ledger.scope.bindingSHA256 else { throw CompletionFeedbackError.invalid }
                        result.historical += ledger.observations.map { GovernanceHistoricalAttempt(scope: ledger.scope.bindingSHA256, observation: $0) }
                    } else {
                        let task = try JSONDecoder().decode(GovernanceTask.self, from: data); try Self.validate(task)
                        guard file.deletingPathExtension().lastPathComponent == task.id.lowercased() else { throw CompletionFeedbackError.invalid }
                        result.tasks.append(task)
                    }
                } catch { result.rejectedRecords += 1 }
            }
        }
        return result
    }
}

private struct GovernanceCachedFileSignature: Equatable {
    let byteCount: UInt64
    let modifiedAt: Date
    let fileNumber: UInt64
    let type: String

    init(byteCount: UInt64, modifiedAt: Date, fileNumber: UInt64, type: String) {
        self.byteCount = byteCount
        self.modifiedAt = modifiedAt
        self.fileNumber = fileNumber
        self.type = type
    }

    init(path: URL) throws {
        let attributes = try FileManager.default.attributesOfItem(atPath: path.path)
        guard let byteCount = (attributes[.size] as? NSNumber)?.uint64Value,
              let modifiedAt = attributes[.modificationDate] as? Date,
              let fileNumber = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value,
              let fileType = attributes[.type] as? FileAttributeType else {
            throw CompletionFeedbackError.invalid
        }
        self.byteCount = byteCount
        self.modifiedAt = modifiedAt
        self.fileNumber = fileNumber
        self.type = fileType.rawValue
    }
}

private enum GovernanceCachedRecord {
    case task(GovernanceTask)
    case historical([GovernanceHistoricalAttempt])
    case rejected
}

private struct GovernanceCachedFile {
    let signature: GovernanceCachedFileSignature
    let record: GovernanceCachedRecord
}

/// Incremental receipt loader used by the live monitor. A changed directory is
/// enumerated, but unchanged files retain their already validated decoded form;
/// only added/replaced JSON is read again. All mutable state is protected by the
/// lock, and callers execute this cache away from the SwiftUI actor.
public final class GovernanceActivityIncrementalCache: @unchecked Sendable {
    private let store: GovernanceActivityStore
    private let legacyRoot: URL?
    private let lock = NSLock()
    private var loaded = false
    private var revisionValue: GovernanceActivityRevision?
    private var activityFiles: [String: GovernanceCachedFile] = [:]
    private var legacyFiles: [String: GovernanceCachedFile] = [:]

    public init(store: GovernanceActivityStore = GovernanceActivityStore(),
                legacyRoot: URL? = CompletionFeedbackStore().root) {
        self.store = store
        self.legacyRoot = legacyRoot?.standardizedFileURL
    }

    public func snapshotIfChanged() -> GovernanceActivitySnapshotUpdate? {
        lock.lock()
        defer { lock.unlock() }
        let current = store.revision(legacyRoot: legacyRoot)
        guard !loaded || current != revisionValue else { return nil }

        var decodedFiles = 0
        var snapshot = GovernanceSnapshot()
        refresh(directory: store.root, isLegacy: false, cache: &activityFiles,
                snapshot: &snapshot, decodedFiles: &decodedFiles)
        if let legacyRoot {
            refresh(directory: legacyRoot, isLegacy: true, cache: &legacyFiles,
                    snapshot: &snapshot, decodedFiles: &decodedFiles)
        } else {
            legacyFiles.removeAll(keepingCapacity: false)
        }
        snapshot.loadedAt = Date()
        loaded = true
        revisionValue = current
        return GovernanceActivitySnapshotUpdate(revision: current, snapshot: snapshot,
                                                decodedFiles: decodedFiles)
    }

    private func refresh(directory: URL, isLegacy: Bool,
                         cache: inout [String: GovernanceCachedFile],
                         snapshot: inout GovernanceSnapshot, decodedFiles: inout Int) {
        guard directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path else {
            cache.removeAll(keepingCapacity: false)
            snapshot.rejectedRecords += 1
            return
        }
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory,
                includingPropertiesForKeys: nil) else {
            cache.removeAll(keepingCapacity: false)
            if FileManager.default.fileExists(atPath: directory.path) { snapshot.rejectedRecords += 1 }
            return
        }
        let json = files.filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        snapshot.omittedFiles += max(0, json.count - 20_000)
        let selected = Array(json.prefix(20_000))
        let activePaths = Set(selected.map(\.path))
        cache = cache.filter { activePaths.contains($0.key) }

        for file in selected {
            let signature: GovernanceCachedFileSignature
            do {
                signature = try GovernanceCachedFileSignature(path: file)
            } catch {
                cache[file.path] = GovernanceCachedFile(
                    signature: GovernanceCachedFileSignature(byteCount: 0, modifiedAt: .distantPast,
                                                             fileNumber: 0, type: "invalid"),
                    record: .rejected)
                decodedFiles += 1
                continue
            }
            if cache[file.path]?.signature != signature {
                decodedFiles += 1
                let record: GovernanceCachedRecord
                do {
                    let data = try GovernanceActivityStore.read(file)
                    if isLegacy {
                        let ledger = try JSONDecoder().decode(CompletionFeedbackLedger.self, from: data)
                        try ledger.validate()
                        guard file.deletingPathExtension().lastPathComponent == ledger.scope.bindingSHA256 else {
                            throw CompletionFeedbackError.invalid
                        }
                        record = .historical(ledger.observations.map {
                            GovernanceHistoricalAttempt(scope: ledger.scope.bindingSHA256, observation: $0)
                        })
                    } else {
                        let task = try JSONDecoder().decode(GovernanceTask.self, from: data)
                        try GovernanceActivityStore.validate(task)
                        guard file.deletingPathExtension().lastPathComponent == task.id.lowercased() else {
                            throw CompletionFeedbackError.invalid
                        }
                        record = .task(task)
                    }
                } catch {
                    record = .rejected
                }
                cache[file.path] = GovernanceCachedFile(signature: signature, record: record)
            }
        }

        for file in cache.values {
            switch file.record {
            case .task(let task): snapshot.tasks.append(task)
            case .historical(let attempts): snapshot.historical.append(contentsOf: attempts)
            case .rejected: snapshot.rejectedRecords += 1
            }
        }
        snapshot.tasks.sort { $0.id < $1.id }
        snapshot.historical.sort {
            ($0.scope, $0.observation.executionID, $0.observation.sequence) <
            ($1.scope, $1.observation.executionID, $1.observation.sequence)
        }
    }
}
