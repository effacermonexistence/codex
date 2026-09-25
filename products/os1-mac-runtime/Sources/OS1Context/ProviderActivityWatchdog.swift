import Foundation

/// When a provider attempt may be stopped. A backend that keeps producing
/// events is never cut off for being slow — only for going quiet for `idle`
/// seconds or for reaching the attempt's hard `ceiling` (the server lease).
///
/// Between 09-15 and 09-23, seven owner tasks were killed at exactly 30
/// minutes while their backends were still working. All seven were heavy
/// xhigh/max runs. Claude Code and Codex impose no such cap, so a long
/// self-repair or site fix must not end just because it is long.
public struct ProviderActivityWatchdog: Sendable, Equatable {
    public static let timeoutText = "Local provider execution timed out"

    public let ceiling: Date
    public let idle: TimeInterval
    public private(set) var lastActivity: Date
    private let span: TimeInterval

    /// `idle == nil` keeps the historical behavior: only the ceiling applies.
    public init(ceiling: Date, idle: TimeInterval?, now: Date = Date()) {
        self.ceiling = ceiling
        self.idle = idle.map { max(0.05, $0) } ?? .infinity
        lastActivity = now
        span = max(0, ceiling.timeIntervalSince(now))
    }

    public mutating func observeActivity(at now: Date = Date()) {
        if now > lastActivity { lastActivity = now }
    }

    /// The instant the attempt stops unless the backend shows activity first.
    public var deadline: Date {
        idle.isFinite ? min(ceiling, lastActivity.addingTimeInterval(idle)) : ceiling
    }

    public func expired(at now: Date = Date()) -> Bool { now >= deadline }

    /// Always begins with `timeoutText`, which classifies the failure as a
    /// timeout everywhere it is matched.
    public func expiryReason(at now: Date = Date()) -> String {
        let quiet = lastActivity.addingTimeInterval(idle)
        if idle.isFinite, quiet < ceiling, now >= quiet {
            return Self.timeoutText + ": no backend activity for " + Self.duration(idle)
        }
        return Self.timeoutText + ": attempt ceiling of " + Self.duration(span) + " reached"
    }

    static func duration(_ seconds: TimeInterval) -> String {
        let whole = Int(seconds.rounded())
        if whole >= 3_600, whole % 3_600 == 0 { return "\(whole / 3_600) h" }
        if whole >= 60, whole % 60 == 0 { return "\(whole / 60) min" }
        return "\(whole) s"
    }
}
