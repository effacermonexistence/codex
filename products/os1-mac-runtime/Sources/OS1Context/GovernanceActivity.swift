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
    public var route: String { [provider, model, effort].joined(separator: " / ") }
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
    /// Tokens spent on every task on this route, divided by the tasks that
    /// were completed in one click. Retries and failures stay in the cost.
    public var tokensPerCompletedTask: Double? {
        guard terminalTasks > 0, meteredTasks == terminalTasks, taskTokens > 0, firstPassTasks > 0 else { return nil }
        return Double(taskTokens) / Double(firstPassTasks)
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
    /// Cost per one-click-completed task, candidate vs baseline (positive =
    /// candidate cheaper per completion). Nil until both routes completed one.
    public var completionCostSavings: Double? = nil
}

public struct GovernanceBucket: Identifiable, Sendable {
    public var id: Date
    public var completions = 0
    public var nonAdopted = 0
    public var tokens = 0
    public var measured = 0
    public var attempts = 0
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
        for (_, o) in samples(since: since, includeHistorical: includeHistorical) {
            let key = [o.provider, o.model, o.effort].joined(separator: " / ")
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

    /// Equal-weight scope-standardized means, ratio of sums (not mean of percentages), never cross-provider comparisons or causal uplift.
    /// Legacy scopes bind initial requests, not necessarily every recovery prompt.
    /// Includes failures in token/time means. Sequential attempts remain selection-biased observations.
    public func comparisons(baseline: String, since: Date?, includeHistorical: Bool) -> [GovernanceComparison] {
        let grouped = Dictionary(grouping: samples(since: since, includeHistorical: includeHistorical), by: { $0.0 })
        let provider = baseline.components(separatedBy: " / ").first
        let routeIDs = routes(since: since, includeHistorical: includeHistorical).map(\.id).filter {
            $0 != baseline && $0.components(separatedBy: " / ").first == provider
        }
        return routeIDs.compactMap { route in
            var tokenA: [Double] = [], tokenB: [Double] = [], adoptionDeltas: [Double] = [], timeA: [Double] = [], timeB: [Double] = []
            var count = 0, candidateN = 0, baselineN = 0
            for entries in grouped.values {
                func select(_ key: String) -> [CompletionFeedbackObservation] {
                    entries.map(\.1).filter { [$0.provider, $0.model, $0.effort].joined(separator: " / ") == key }
                }
                let a = select(baseline), b = select(route)
                guard !a.isEmpty, !b.isEmpty else { continue }
                count += 1; baselineN += a.count; candidateN += b.count
                // Written as small sub-expressions on purpose: as one line the
                // adoption delta mixed Int/Double conversions, filters and
                // division, and the CI toolchain gave up type-checking it.
                let aAdopted: Int = a.filter { $0.outcome == .adopted }.count
                let bAdopted: Int = b.filter { $0.outcome == .adopted }.count
                let aRate: Double = Double(aAdopted) / Double(a.count)
                let bRate: Double = Double(bAdopted) / Double(b.count)
                adoptionDeltas.append(bRate - aRate)
                let at = a.compactMap(Self.tokens), bt = b.compactMap(Self.tokens)
                if at.count == a.count, bt.count == b.count {
                    let atSum: Int = at.reduce(0, +)
                    let btSum: Int = bt.reduce(0, +)
                    let am: Double = Double(atSum) / Double(at.count)
                    let bm: Double = Double(btSum) / Double(bt.count)
                    tokenA.append(am); tokenB.append(bm)
                }
                let aDurationSum: Int = a.map(\.durationMS).reduce(0, +)
                let bDurationSum: Int = b.map(\.durationMS).reduce(0, +)
                let ams: Double = Double(aDurationSum) / Double(a.count)
                let bms: Double = Double(bDurationSum) / Double(b.count)
                timeA.append(ams); timeB.append(bms)
            }
            guard count > 0 else { return nil }
            let rows = routes(since: since, includeHistorical: includeHistorical)
            let baselineCost = rows.first { $0.id == baseline }?.tokensPerCompletedTask
            let candidateCost = rows.first { $0.id == route }?.tokensPerCompletedTask
            var comparison = GovernanceComparison(id: route, baseline: baseline, matchedScopes: count,
                candidateAttempts: candidateN, baselineAttempts: baselineN,
                tokenSavings: tokenA.count == count ? GovernanceStatistics.savings(baseline: tokenA.reduce(0,+), candidate: tokenB.reduce(0,+)) : nil,
                adoptionDelta: adoptionDeltas.reduce(0,+) / Double(count),
                latencySavings: timeA.count == count ? GovernanceStatistics.savings(baseline: timeA.reduce(0,+), candidate: timeB.reduce(0,+)) : nil)
            if let baselineCost, let candidateCost {
                comparison.completionCostSavings = GovernanceStatistics.savings(baseline: baselineCost, candidate: candidateCost)
            }
            return comparison
        }
    }

    public func timeline(since: Date, until: Date, bucketSeconds: Double) -> [GovernanceBucket] {
        guard bucketSeconds.isFinite, bucketSeconds > 0, until >= since else { return [] }
        var buckets: [Date: GovernanceBucket] = [:]
        func key(_ d: Date) -> Date { Date(timeIntervalSince1970: floor(d.timeIntervalSince1970 / bucketSeconds) * bucketSeconds) }
        for task in tasks {
            if let end = task.endedAt, end >= since, end <= until {
                let k = key(end); var b = buckets[k] ?? GovernanceBucket(id: k)
                if task.isAdopted { b.completions += 1 } else { b.nonAdopted += 1 }; buckets[k] = b
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
                        ledgerScope: CompletionFeedbackScope? = nil) throws {
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
        if let index = task.attempts.firstIndex(where: { $0.id == key }) {
            // Repeated completion notification is idempotent; a start may never erase usage.
            if observation != nil {
                item.ledgerScope = item.ledgerScope ?? task.attempts[index].ledgerScope
                task.attempts[index] = item
            } else if task.attempts[index].ledgerScope == nil {
                task.attempts[index].ledgerScope = item.ledgerScope
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
    private static func read(_ path: URL) throws -> Data {
        guard path.resolvingSymlinksInPath().path == path.standardizedFileURL.path,
              let attrs = try? FileManager.default.attributesOfItem(atPath: path.path),
              attrs[.type] as? FileAttributeType == .typeRegular,
              let size = attrs[.size] as? Int, size > 0, size <= 512_000 else { throw CompletionFeedbackError.invalid }
        return try Data(contentsOf: path)
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
