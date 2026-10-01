import Foundation

/// "Burn it before it resets": unused quota in a Codex window is lost at the
/// reset, so when the window is about to close and enough is left, work that
/// would otherwise route automatically goes to Codex. Account data only —
/// the frontier news monitor stays informational.
public enum QuotaWindowPolicy {
    public struct Settings: Equatable, Sendable {
        public var enabled: Bool
        public var leadHours: Double
        public var minimumRemainingPercent: Double
        public init(enabled: Bool = true, leadHours: Double = 12, minimumRemainingPercent: Double = 15) {
            self.enabled = enabled; self.leadHours = max(1, min(168, leadHours)); self.minimumRemainingPercent = max(1, min(99, minimumRemainingPercent))
        }
    }

    public enum Decision: Equatable, Sendable {
        case burn(remainingPercent: Double, hoursLeft: Double)
        case idle(reason: String)
    }

    public static func decision(window: CodexQuotaWindow?, settings: Settings, now: Date = Date()) -> Decision {
        guard settings.enabled else { return .idle(reason: "disabled") }
        guard let window else { return .idle(reason: "no window") }
        let hoursLeft = window.resetsAt.timeIntervalSince(now) / 3_600
        guard hoursLeft > 0 else { return .idle(reason: "window reset") }
        let remaining = 100 - window.usedPercent
        guard remaining >= settings.minimumRemainingPercent else { return .idle(reason: "quota nearly spent") }
        guard hoursLeft <= settings.leadHours else { return .idle(reason: "window not closing yet") }
        return .burn(remainingPercent: remaining, hoursLeft: hoursLeft)
    }

    /// Owner-facing line for a burn decision; nil when idle.
    public static func notice(_ decision: Decision) -> String? {
        guard case .burn(let remaining, let hours) = decision else { return nil }
        let h = hours < 1 ? String(format: "%.0f분", hours * 60) : String(format: "%.1f시간", hours)
        let hEn = hours < 1 ? String(format: "%.0f min", hours * 60) : String(format: "%.1f h", hours)
        return os1Tr("Codex 한도 창 마감 \(h) 전 · 남은 \(Int(remaining.rounded()))% · 리셋 전에 소진하도록 Codex로 보냅니다",
                     "Codex quota window closes in \(hEn) · \(Int(remaining.rounded()))% left · routing to Codex to use it before the reset")
    }
}

/// The owner's own signal that a "completed" task was not complete: a
/// retry or correction sent shortly after the answer. Cost per completed
/// task is measured against this, not against tokens.
public enum OwnerRetry {
    /// How long after a completion a follow-up still counts as "had to ask again".
    public static let window: TimeInterval = 45 * 60

    static let markers = [
        "다시", "아직", "안 됐", "안됐", "안 돼", "안돼", "안 되", "안되", "안 고쳐", "안고쳐", "여전히", "그대로",
        "제대로", "또 ", "똑같", "안 나와", "안나와", "안 보여", "안보여", "안 됨", "안됨",
        "not fixed", "still ", "again", "didn't work", "did not work", "doesn't work", "does not work",
        "not working", "same problem", "no change", "nothing changed",
    ]

    public static func isRetry(_ text: String) -> Bool {
        let value = text.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !value.isEmpty, !value.hasPrefix(">"), !value.contains("```") else { return false }
        if ExecutionSteering.isDirectCorrection(value) { return true }
        return markers.contains { value.contains($0) }
    }
}
