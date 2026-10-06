import Foundation

/// The motion a running conversation shows in the task list, so the owner can
/// tell where a run went from the animation alone (owner, 2026-10-05: "사용자가
/// 이게 코덱스에 갔는지 클로드 코드로 갔는지 … 애니메이션만 보고"). OS-1's own
/// pink bars until a route is recorded, Claude's clay working mark on an
/// Anthropic lane (Claude Code, Claude chat), the Codex app's gray working ring
/// on an OpenAI lane (Codex, GPT chat), each in its own app's color. Only the
/// recorded executed route decides it, never a requested route or a model
/// name: routing and recovery carry the vendor being asked for (a Claude
/// reroute, the Codex burn notice, a recovery's alternate backend) before any
/// ticket exists, so they keep the bars until the next attempt records its
/// executed route.
public enum RunningRouteMotion: String, Equatable, Sendable, CaseIterable {
    case os1, claude, codex

    public init(activity: RuntimeActivity?) {
        guard let activity, ![.waitingForSource, .routing, .recovering].contains(activity.phase),
              let backend = ProviderSurface.resolveExecuted(rawSurface: activity.surface, provider: activity.provider)?.backend
        else { self = .os1; return }
        switch backend {
        case .anthropic: self = .claude
        case .openAI: self = .codex
        }
    }

    /// Seconds between redraws: both vendor marks advance in 1/30 s steps.
    public var tick: TimeInterval { self == .os1 ? 0.12 : ClaudeWorkingMark.frameDuration }
}

/// The Codex app's working ring beside a running thread in its sidebar
/// (ChatGPT.app, com.openai.codex 26.930.61225: `Dpo` → `Ti`, glyph `Qci`,
/// `animate-spin` = `spin 2s steps(60, end) infinite`). A 270° band over a
/// full track at 30% of the band's opacity, flat ends, a 16-point glyph from a
/// 24-unit viewBox (radii 6 to 8), the gap at 9 to 12 o'clock at rest. It
/// turns clockwise once every two seconds in sixty 6° steps, and every ring
/// shares one clock.
public enum CodexWorkingRing {
    /// The ring's gray, `#BABABA`.
    public static let gray: UInt32 = 0xBABABA
    public static let period: TimeInterval = 2
    public static let steps = 60
    public static let glyph = 16.0
    public static let outerRadius = glyph / 24 * 8
    public static let innerRadius = glyph / 24 * 6
    public static var bandWidth: Double { outerRadius - innerRadius }
    public static var centerRadius: Double { (outerRadius + innerRadius) / 2 }
    /// The band covers this much of the circle, starting at 12 o'clock.
    public static let arcFraction = 0.75
    public static let trackOpacity = 0.3

    /// Clockwise degrees from rest at `time` seconds of a shared clock.
    public static func angle(at time: TimeInterval) -> Double {
        let step = Int((time / (period / Double(steps))).rounded(.down)) % steps
        return Double(step < 0 ? step + steps : step) * (360 / Double(steps))
    }
}
