import Foundation

/// The motion a running conversation shows in the task list, so the owner can
/// tell where a run went from the animation alone (owner, 2026-10-05: "사용자가
/// 이게 코덱스에 갔는지 클로드 코드로 갔는지 … 애니메이션만 보고"). OS-1's own
/// bars until a route is recorded, Claude's working dots on an Anthropic lane
/// (Claude Code, Claude chat), the Codex app's working ring on an OpenAI lane
/// (Codex, GPT chat). All three keep OS-1's pink. Only the recorded executed
/// route decides it, never a requested route or a model name: routing and
/// recovery carry the vendor being asked for (a Claude reroute, the Codex burn
/// notice, a recovery's alternate backend) before any ticket exists, so they
/// keep the bars until the next attempt records its executed route.
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
    public var tick: TimeInterval { self == .os1 ? 0.12 : ClaudeWorkingDots.frameDuration }
}

/// Claude's working mark, as the Claude desktop app draws it beside the
/// elapsed seconds of a running Code session (claude.ai bundle, `WorkingMark`,
/// default loop; read from the app's cache 2026-10-05). The source is a sprite
/// strip of 48-unit frames shown at 20 points, 40 frames at 30 fps (1.333 s):
/// the outer dots slide in and shrink while the middle one grows, hold, then
/// return. The positions and diameters below were measured from the frames'
/// alpha (source units); nothing is scaled or eased on top of them.
public enum ClaudeWorkingDots {
    public static let frameDuration: TimeInterval = 1.0 / 30
    /// Side of one source frame, and the points it is drawn at.
    public static let sourceUnit = 48.0
    public static let box = 20.0
    /// The loop's still frame (Reduce Motion): big, small, big.
    public static let restFrame = 38
    public static let middleX = 23.83
    public static let centerY = 24.15

    static let leftX: [Double] = [7.56, 7.60, 7.69, 7.84, 8.03, 8.32, 8.72, 9.25, 9.92, 10.75, 11.39, 11.83, 12.12, 12.32,
        12.52, 12.61, 12.68, 12.71, 12.74, 12.60, 12.59, 12.58, 12.54, 12.48, 12.44, 12.33, 12.16, 11.93, 11.56, 11.12,
        10.31, 9.51, 8.89, 8.46, 8.08, 7.86, 7.72, 7.61, 7.58, 7.63]
    static let rightX: [Double] = [40.19, 40.14, 40.06, 39.91, 39.66, 39.37, 38.98, 38.45, 37.79, 36.96, 36.36, 35.91, 35.62,
        35.42, 35.29, 35.19, 35.14, 35.12, 35.09, 35.10, 35.10, 35.10, 35.15, 35.21, 35.25, 35.36, 35.55, 35.79, 36.17,
        36.80, 37.61, 38.40, 39.01, 39.43, 39.60, 39.81, 39.94, 40.05, 40.09, 40.10]
    static let leftDiameter: [Double] = [8.34, 8.31, 8.26, 8.19, 8.11, 7.97, 7.75, 7.48, 7.14, 6.84, 6.52, 6.28, 6.12, 6.02,
        5.81, 5.76, 5.73, 5.71, 5.70, 5.85, 5.86, 5.87, 5.89, 5.90, 5.78, 5.85, 5.93, 6.04, 6.25, 6.60, 6.99, 7.39, 7.68,
        7.91, 8.17, 8.29, 8.33, 8.39, 8.42, 8.46]
    static let middleDiameter: [Double] = [5.79, 5.80, 5.84, 5.85, 5.86, 5.93, 6.08, 6.23, 6.52, 6.65, 7.00, 7.32, 7.54, 7.71,
        7.88, 7.98, 8.05, 8.10, 8.11, 8.27, 8.27, 8.25, 8.21, 8.17, 8.04, 7.94, 7.79, 7.60, 7.34, 7.01, 6.59, 6.27, 6.05,
        5.93, 5.93, 5.87, 5.85, 5.82, 5.80, 5.53]
    static let rightDiameter: [Double] = [8.29, 8.25, 8.21, 8.13, 8.27, 8.11, 7.92, 7.66, 7.29, 6.78, 6.45, 6.22, 6.06, 5.95,
        5.80, 5.75, 5.71, 5.70, 5.67, 5.69, 5.68, 5.70, 5.73, 5.73, 5.79, 5.83, 5.91, 6.04, 6.23, 6.50, 6.95, 7.40, 7.74,
        7.96, 8.20, 8.31, 8.37, 8.43, 8.46, 8.49]

    public static var frameCount: Int { leftX.count }
    public static var period: TimeInterval { Double(frameCount) * frameDuration }

    public struct Dot: Equatable, Sendable {
        /// Center and diameter in source units (0...48, center line at `centerY`).
        public let x: Double
        public let diameter: Double
    }

    /// The frame shown at `time` seconds of a shared clock; held, never blended.
    public static func frame(at time: TimeInterval) -> Int {
        let index = Int((time / frameDuration).rounded(.down)) % frameCount
        return index < 0 ? index + frameCount : index
    }

    /// Left, middle and right dot of a frame.
    public static func dots(frame: Int) -> [Dot] {
        let index = ((frame % frameCount) + frameCount) % frameCount
        return [Dot(x: leftX[index], diameter: leftDiameter[index]),
                Dot(x: middleX, diameter: middleDiameter[index]),
                Dot(x: rightX[index], diameter: rightDiameter[index])]
    }
}

/// The Codex app's working ring beside a running thread in its sidebar
/// (ChatGPT.app, com.openai.codex 26.930.61225: `Dpo` → `Ti`, glyph `Qci`,
/// `animate-spin` = `spin 2s steps(60, end) infinite`). A 270° band over a
/// full track at 30% of the band's opacity, flat ends, a 16-point glyph from a
/// 24-unit viewBox (radii 6 to 8), the gap at 9 to 12 o'clock at rest. It
/// turns clockwise once every two seconds in sixty 6° steps, and every ring
/// shares one clock.
public enum CodexWorkingRing {
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
