import Foundation

/// One shared Claude plan-quota observation for every OS-1 process: the app's
/// health poll, the fleet heartbeat, each `os1 rcc-catalog` build, each native
/// attempt and the older run path. Before this change each of them spawned its
/// own get_usage probe on a cache miss and never shared the result.
///
/// Anthropic's usage endpoint answers about once per two minutes per sign-in
/// (2026-10-19, 13 polls: every fetch about 62 s after the previous attempt
/// got HTTP 429; fetches 121-184 s apart succeeded). After a 429 the CLI
/// answers with a fallback body that OS-1 correctly refuses, so the record
/// lost Claude's quota and the catalog made the Claude pool undispatchable.
///
/// The rules here: at most one process probes at a time (an advisory file
/// lock; a waiter reads the winner's result), no probe within
/// `minimumProbeSpacing` of the last attempt for that account by any
/// process, and a failed probe keeps the last good observation with its own
/// observedAt. Callers get the newest retainable observation; whether it is
/// dispatch evidence is `QuotaSnapshot.estimate`'s decision, not this store's.
public struct ClaudeQuotaStore: Codable, Equatable, Sendable {
    public var accountID: String
    public var snapshot: BackendHealth.QuotaSnapshot?
    public var probe: BackendHealth.QuotaProbe?
    public init(accountID: String, snapshot: BackendHealth.QuotaSnapshot? = nil, probe: BackendHealth.QuotaProbe? = nil) {
        self.accountID = accountID; self.snapshot = snapshot; self.probe = probe
    }

    /// Just over the observed per-sign-in budget of one fetch per ~2 minutes.
    public static let minimumProbeSpacing: TimeInterval = 125
    /// A waiter's bound: the probe's own 8 s timeout plus its process exit.
    public static let lockWait: TimeInterval = 12

    public static var defaultURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/claude-quota.json")
    }
    public static var defaultLockURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/claude-quota.lock")
    }

    /// What a caller receives: the newest retainable observation for the
    /// account (fresh or older), the latest attempt, and whether this call ran it.
    public struct Observation: Equatable, Sendable {
        public var snapshot: BackendHealth.QuotaSnapshot?
        public var probe: BackendHealth.QuotaProbe?
        public var probed: Bool
        /// A retainable observation existed but predates the latest
        /// account-wide quota rejection, so none is offered.
        public var supersededByRejection: Bool
        public init(snapshot: BackendHealth.QuotaSnapshot?, probe: BackendHealth.QuotaProbe?, probed: Bool,
                    supersededByRejection: Bool = false) {
            self.snapshot = snapshot; self.probe = probe; self.probed = probed
            self.supersededByRejection = supersededByRejection
        }
        /// One public diagnostic line (no body, no credential), e.g. for the
        /// private stderr receipt of a catalog build.
        public func publicLine(accountID: String, now: Date = Date()) -> String {
            let estimate = snapshot?.estimate(accountID: accountID, now: now)
            var parts = ["anthropic_shared quota basis=" + (estimate?.basis.rawValue ?? "unknown")]
            if let snapshot { parts.append("observed_age_s=\(Int(now.timeIntervalSince(snapshot.observedAt).rounded()))") }
            if let estimate { parts.append(String(format: "remaining_pct=%.1f", estimate.remainingPercent)) }
            if let probe {
                parts.append("probe=" + probe.outcome.rawValue)
                parts.append("probe_age_s=\(Int(now.timeIntervalSince(probe.attemptedAt).rounded()))")
            }
            if supersededByRejection { parts.append("superseded_by_quota_rejection=1") }
            parts.append(probed ? "probed_now=1" : "probed_now=0")
            return parts.joined(separator: " ")
        }
    }

    public static func load(from url: URL) -> ClaudeQuotaStore? {
        guard let data = try? Data(contentsOf: url), data.count <= 32_768 else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(ClaudeQuotaStore.self, from: data)
    }

    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        try encoder.encode(self).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    /// The latest attempt for this account by any process: this store's
    /// probe, or another writer's observation (e.g. an older build's health
    /// record). A time from the future is not evidence.
    public static func lastAttempt(_ store: ClaudeQuotaStore?, accountID: String,
                                   other: BackendHealth.QuotaSnapshot?, now: Date) -> Date? {
        let own = store?.accountID == accountID ? [store?.probe?.attemptedAt, store?.snapshot?.observedAt] : []
        let foreign = other?.accountID == accountID ? [other?.observedAt] : []
        return (own + foreign).compactMap { $0 }.filter { $0 <= now.addingTimeInterval(5) }.max()
    }

    public static func needsProbe(_ store: ClaudeQuotaStore?, accountID: String,
                                  other: BackendHealth.QuotaSnapshot?, now: Date) -> Bool {
        guard !accountID.isEmpty else { return false }
        guard let last = lastAttempt(store, accountID: accountID, other: other, now: now) else { return true }
        return now.timeIntervalSince(last) >= minimumProbeSpacing
    }

    /// `rejectedAt` is the latest account-wide quota rejection
    /// (`ClaudeQuotaBackoff.lastAccountRejection`): a real refusal outranks
    /// any plan metadata observed at or before it, fresh or retained.
    public static func view(_ store: ClaudeQuotaStore?, accountID: String, other: BackendHealth.QuotaSnapshot?,
                            now: Date, probed: Bool, rejectedAt: Date? = nil) -> Observation {
        let own = store?.accountID == accountID ? store : nil
        let retainable = [own?.snapshot, other].compactMap { $0 }
            .filter { $0.isRetainable(accountID: accountID, now: now) }
        let snapshot = retainable.filter { candidate in rejectedAt.map { candidate.observedAt > $0 } ?? true }
            .max { $0.observedAt < $1.observedAt }
        return Observation(snapshot: snapshot, probe: own?.probe, probed: probed,
                           supersededByRejection: snapshot == nil && !retainable.isEmpty)
    }

    /// The store after one attempt: a live observation replaces the old one;
    /// any other outcome keeps it (its own observedAt) and records why.
    public func recording(_ outcome: BackendHealth.QuotaProbe.Outcome, snapshot observed: BackendHealth.QuotaSnapshot?,
                          attemptedAt: Date) -> ClaudeQuotaStore {
        var next = self
        if outcome == .ok, let observed, observed.accountID == accountID { next.snapshot = observed }
        if let kept = next.snapshot, !kept.isRetainable(accountID: accountID, now: attemptedAt) { next.snapshot = nil }
        next.probe = .init(outcome: outcome, attemptedAt: attemptedAt,
                           nextEligibleAt: attemptedAt.addingTimeInterval(Self.minimumProbeSpacing))
        return next
    }

    /// The store with another writer's newer retainable observation adopted
    /// (nil when nothing changes), so a writer that later drops it (an older
    /// build replacing its health record) cannot erase it.
    public static func adopting(_ store: ClaudeQuotaStore?, other: BackendHealth.QuotaSnapshot?,
                                accountID: String, now: Date) -> ClaudeQuotaStore? {
        guard let other, other.accountID == accountID, other.isRetainable(accountID: accountID, now: now) else { return nil }
        var next = store?.accountID == accountID ? store! : ClaudeQuotaStore(accountID: accountID)
        if let kept = next.snapshot, kept.observedAt >= other.observedAt { return nil }
        next.snapshot = other
        return next
    }

    /// The one entry point. `probe` runs only when the spacing allows it and
    /// only while this process holds the lock; it returns the classified
    /// outcome and, for `.ok`, the live observation. `rejectedAt` (the
    /// latest account-wide quota rejection) supersedes every observation
    /// made at or before it; see `view`.
    public static func observe(accountID: String, storeURL: URL = defaultURL, lockURL: URL = defaultLockURL,
                               other: BackendHealth.QuotaSnapshot? = nil, lockWait: TimeInterval = lockWait,
                               rejectedAt: Date? = nil, now: () -> Date = Date.init,
                               probe: () -> (outcome: BackendHealth.QuotaProbe.Outcome, snapshot: BackendHealth.QuotaSnapshot?))
        -> Observation {
        let before = load(from: storeURL)
        guard needsProbe(before, accountID: accountID, other: other, now: now()) else {
            // Keep another writer's newer observation, but only while holding
            // the lock: an unlocked write could overwrite a probe's record.
            if adopting(before, other: other, accountID: accountID, now: now()) != nil {
                _ = withExclusiveLock(lockURL, wait: 0) {
                    try? adopting(load(from: storeURL), other: other, accountID: accountID, now: now())?.save(to: storeURL)
                }
            }
            return view(before, accountID: accountID, other: other, now: now(), probed: false, rejectedAt: rejectedAt)
        }
        let locked = withExclusiveLock(lockURL, wait: lockWait) { () -> Observation in
            let current = load(from: storeURL)
            let started = now()
            // Another process may have probed while this one waited.
            guard needsProbe(current, accountID: accountID, other: other, now: started) else {
                return view(current, accountID: accountID, other: other, now: started, probed: false, rejectedAt: rejectedAt)
            }
            let result = probe()
            let own = current?.accountID == accountID ? current! : ClaudeQuotaStore(accountID: accountID)
            let base = adopting(own, other: other, accountID: accountID, now: started) ?? own
            let next = base.recording(result.outcome, snapshot: result.snapshot, attemptedAt: started)
            try? next.save(to: storeURL)
            return view(next, accountID: accountID, other: other, now: now(), probed: true, rejectedAt: rejectedAt)
        }
        return locked ?? view(load(from: storeURL) ?? before, accountID: accountID, other: other, now: now(), probed: false,
                              rejectedAt: rejectedAt)
    }

    /// Runs `body` while holding an exclusive advisory lock on `url`
    /// (flock: released by the kernel if the holder dies). Nil when the lock
    /// was not acquired within `wait` seconds or the file cannot be opened.
    public static func withExclusiveLock<T>(_ url: URL, wait: TimeInterval, _ body: () throws -> T) rethrows -> T? {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                                                 attributes: [.posixPermissions: 0o700])
        let descriptor = open(url.path, O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { return nil }
        defer { close(descriptor) }
        let deadline = Date().addingTimeInterval(max(0, wait))
        while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK || errno == EINTR, Date() < deadline else { return nil }
            usleep(50_000)
        }
        defer { flock(descriptor, LOCK_UN) }
        return try body()
    }
}
