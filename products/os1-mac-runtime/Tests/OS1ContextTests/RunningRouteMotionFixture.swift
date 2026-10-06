import Foundation
import OS1Context

/// The running mark tells the executed route by motion alone (build 332):
/// OS-1 bars, Claude's working dots, the Codex working ring.
func runRunningRouteMotionFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) {
        precondition(condition, "Running route motion: " + message); checks += 1
    }
    // Only the recorded executed vendor picks the motion.
    let routed: [(RuntimeActivity, RunningRouteMotion)] = [
        (RuntimeActivity(.executing, provider: "claude"), .claude),
        (RuntimeActivity(.executing, provider: "claude", surface: "claude-chat"), .claude),
        (RuntimeActivity(.verifying, provider: " Claude \n", model: "claude-opus-5-5"), .claude),
        (RuntimeActivity(.executing, provider: "codex", model: "gpt-6.1-sol"), .codex),
        (RuntimeActivity(.executing, provider: "codex", surface: "gpt-chat"), .codex),
        (RuntimeActivity(.preparing, provider: "CODEX", surface: "codex"), .codex),
        (RuntimeActivity(.syncing, provider: "claude", surface: "claude"), .claude),
    ]
    for (activity, motion) in routed {
        check(RunningRouteMotion(activity: activity) == motion, "\(activity.provider ?? "-")/\(activity.surface ?? "-") draws \(motion)")
    }
    let unrouted: [RuntimeActivity?] = [nil, RuntimeActivity(.routing), RuntimeActivity(.preparing),
        RuntimeActivity(.executing, provider: "local"), RuntimeActivity(.executing, provider: "routing"),
        RuntimeActivity(.waitingForSource, provider: "claude"), RuntimeActivity(.executing, model: "claude-opus-5-5"),
        RuntimeActivity(.executing, model: "gpt-6.1-sol"), RuntimeActivity(.executing, provider: "exo"),
        // Requested, not executed: a Claude reroute, the Codex burn notice, a
        // recovery's alternate backend before its ticket (review of b332).
        RuntimeActivity(.routing, provider: "claude"), RuntimeActivity(.routing, provider: "codex", publicText: "burn window"),
        RuntimeActivity(.recovering, provider: "claude"), RuntimeActivity(.recovering, provider: "codex", surface: "codex")]
    for activity in unrouted {
        check(RunningRouteMotion(activity: activity) == .os1,
              "an unrecorded route keeps OS-1's bars: \(String(describing: activity?.phase))/\(String(describing: activity?.provider))")
    }
    // A Codex run recovering onto Claude: ring, bars while Claude is only
    // asked for, then dots once its attempt records the route. Never Claude
    // dots before a Claude ticket, never ring-dots-ring-dots flicker.
    let recovery = [RuntimeActivity(.verifying, provider: "codex", surface: "codex"), RuntimeActivity(.recovering, provider: "claude"),
                    RuntimeActivity(.routing, provider: "codex"), RuntimeActivity(.preparing, provider: "claude", surface: "claude"),
                    RuntimeActivity(.executing, provider: "claude", surface: "claude")].map(RunningRouteMotion.init(activity:))
    check(recovery == [.codex, .os1, .os1, .claude, .claude], "a recovery shows ring, bars, then dots: \(recovery)")
    check(RunningRouteMotion.claude.tick == 1.0 / 30 && RunningRouteMotion.codex.tick == 1.0 / 30
          && RunningRouteMotion.os1.tick == 0.12, "vendor marks redraw at their 30 fps step")

    // Claude: 40 held frames at 30 fps, measured from the source sprite.
    let dots = ClaudeWorkingDots.self
    check(dots.frameCount == 40 && abs(dots.period - 40.0 / 30) < 1e-9, "one loop is 40 frames, 1.333 s")
    let epsilon = 1e-6
    check(dots.frame(at: 0) == 0 && dots.frame(at: dots.frameDuration + epsilon) == 1
          && dots.frame(at: 39 * dots.frameDuration + epsilon) == 39 && dots.frame(at: dots.period + epsilon) == 0,
          "frames advance every 1/30 s and wrap")
    check(dots.frame(at: -dots.frameDuration / 2) == 39, "a clock before zero still lands on a frame")
    let anchor = 812_955_869.25
    check((0..<200).allSatisfy { step in (0..<dots.frameCount).contains(dots.frame(at: anchor + Double(step) / 97)) },
          "a wall-clock time always maps to a frame")
    let rest = dots.dots(frame: 0)
    check(rest.count == 3 && rest[0].diameter > rest[1].diameter * 1.35 && rest[2].diameter > rest[1].diameter * 1.35,
          "the loop opens big, small, big")
    check(rest[0].x < rest[1].x && rest[1].x < rest[2].x && abs(rest[1].x - 24) < 0.5, "left, middle, right in a row")
    let gathered = dots.dots(frame: 18)
    check(gathered[1].diameter > gathered[0].diameter * 1.35 && gathered[1].diameter > gathered[2].diameter * 1.35,
          "halfway, the middle dot is the big one")
    check(gathered[0].x > rest[0].x + 4 && gathered[2].x < rest[2].x - 4, "the outer dots slide in")
    let still = dots.dots(frame: dots.restFrame)
    check(still[0].diameter > still[1].diameter && still[2].diameter > still[1].diameter, "Reduce Motion holds a big-small-big frame")
    for frame in 0..<dots.frameCount {
        let row = dots.dots(frame: frame)
        check(abs((row[0].x + row[2].x) / 2 - 23.85) < 0.6, "frame \(frame) stays centered")
        check(row.allSatisfy { $0.diameter > 5 && $0.diameter < 9 }, "frame \(frame) keeps measured sizes")
        check(row[1].x - row[0].x > row[0].diameter / 2 + row[1].diameter / 2, "frame \(frame) keeps the dots apart")
    }
    check(dots.dots(frame: 40) == dots.dots(frame: 0) && dots.dots(frame: -1) == dots.dots(frame: 39), "frame indices wrap")
    check(abs(dots.box / dots.sourceUnit * rest[0].diameter - 3.475) < 0.01, "the 48-unit frame is drawn in 20 points")

    // Codex: a 270° band over a 30% track, one clockwise turn per 2 s in 6° steps.
    let ring = CodexWorkingRing.self
    check(abs(ring.outerRadius - 16.0 / 3) < 1e-9 && abs(ring.innerRadius - 4) < 1e-9 && abs(ring.bandWidth - 4.0 / 3) < 1e-9,
          "16-point glyph with radii 4 to 5.33")
    check(ring.arcFraction == 0.75 && ring.trackOpacity == 0.3, "three-quarter band over a 30% track")
    check(ring.angle(at: 0) == 0 && ring.angle(at: 1.0 / 30 + epsilon) == 6 && ring.angle(at: 1.0 + epsilon) == 180
          && ring.angle(at: 1.99) == 354 && ring.angle(at: 2.0 + epsilon) == 0, "steps(60): 6° every 1/30 s, clockwise, 2 s a turn")
    check(ring.angle(at: 0.02) == 0, "no motion between steps")
    check(ring.angle(at: -0.01) == 354, "a clock before zero still lands on a step")
    check(ring.angle(at: anchor) == ring.angle(at: anchor + 2), "every ring shares one 2 s clock")
    print("Running route motion: \(checks) checks; OS-1 bars until routed, Claude dots and Codex ring from measured source")
}
