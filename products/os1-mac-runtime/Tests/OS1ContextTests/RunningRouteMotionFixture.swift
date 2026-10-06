import Foundation
import OS1Context

/// The running mark tells the executed route by motion alone: OS-1's pink
/// bars, Claude's clay working mark, the Codex app's gray working ring.
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
    // asked for, then the clay mark once its attempt records the route. Never
    // the clay mark before a Claude ticket, never ring-clay-ring flicker.
    let recovery = [RuntimeActivity(.verifying, provider: "codex", surface: "codex"), RuntimeActivity(.recovering, provider: "claude"),
                    RuntimeActivity(.routing, provider: "codex"), RuntimeActivity(.preparing, provider: "claude", surface: "claude"),
                    RuntimeActivity(.executing, provider: "claude", surface: "claude")].map(RunningRouteMotion.init(activity:))
    check(recovery == [.codex, .os1, .os1, .claude, .claude], "a recovery shows ring, bars, then the clay mark: \(recovery)")
    check(RunningRouteMotion.claude.tick == 1.0 / 30 && RunningRouteMotion.codex.tick == 1.0 / 30
          && RunningRouteMotion.os1.tick == 0.12, "vendor marks redraw at their 30 fps step")

    // Claude: the clay mark's stage machine over measured sheets.
    let mark = ClaudeWorkingMark.self
    let epsilon = 1e-6
    check(mark.clay == 0xD97757 && CodexWorkingRing.gray == 0xBABABA, "Claude draws clay, Codex gray")
    typealias Body = ClaudeWorkingMark.Body
    let table: [(Body, enter: Int, loop: Int, exit: Int, rest: Int, seams: [Int])] = [
        (.default, 16, 40, 14, 38, []), (.think, 16, 110, 15, 95, [54]), (.read, 21, 60, 19, 44, []),
        (.search, 16, 20, 14, 4, []), (.code, 16, 75, 9, 74, [18, 37, 56]), (.write, 31, 60, 14, 36, []),
    ]
    check(mark.sheet(.grow).count == 10, "grow is 10 frames")
    for row in table {
        let loop = mark.sheet(.loop(row.0))
        check(mark.sheet(.enter(row.0)).count == row.enter && loop.count == row.loop && mark.sheet(.exit(row.0)).count == row.exit,
              "\(row.0) plays \(row.enter)/\(row.loop)/\(row.exit) frames")
        check(loop.rest == row.rest && loop.seams == row.seams, "\(row.0) rests at \(row.rest), seams \(row.seams)")
        let still = mark.still(row.0)
        check(still.stage == .loop(row.0) && still.index == row.rest, "Reduce Motion holds \(row.0) at its rest frame")
    }
    let stages = [ClaudeWorkingMark.Stage.grow] + Body.allCases.flatMap { [.enter($0), .loop($0), .exit($0)] }
    for stage in stages {
        let sheet = mark.sheet(stage)
        check(sheet.frames.allSatisfy { frame in
            !frame.isEmpty && frame.allSatisfy { $0.rx > 0 && $0.ry > 0 && $0.x - $0.rx >= 0 && $0.x + $0.rx <= 48
                && $0.y - $0.ry >= 0 && $0.y + $0.ry <= 48 }
        }, "\(stage.sheetName) stays inside its 48-unit frame")
    }
    let dot = mark.sheet(.grow).frames[0]
    check(dot.count == 1 && abs(dot[0].rx * 2 * mark.box / mark.sourceUnit - mark.dotDiameter) < 0.05,
          "grow opens on Claude's 7-point dot")
    check(mark.sheet(.grow).frames[9][0].rx < dot[0].rx / 2, "grow shrinks the dot into the body's first frame")

    // The player: grow, enter, loop while wanted; frames held for 1/30 s.
    let frame = mark.frameDuration
    let start = 1_000.0
    func at(_ frames: Double) -> TimeInterval { start + frames * frame }
    func plays(_ player: inout ClaudeWorkingMark.Player, _ frames: ClosedRange<Int>, wanted: Body)
        -> [(ClaudeWorkingMark.Stage, Int)] {
        frames.map { let shown = player.frame(at: at(Double($0)), wanted: wanted); return (shown.stage, shown.index) }
    }
    var player = ClaudeWorkingMark.Player(at: start, wanted: .think)
    let opening = plays(&player, 0...140, wanted: .think)
    check(opening[0] == (.grow, 0) && opening[9] == (.grow, 9), "a new mark grows for 10 frames")
    check(opening[10] == (.enter(.think), 0) && opening[25] == (.enter(.think), 15), "then enters the wanted body")
    check(opening[26] == (.loop(.think), 0) && opening[135] == (.loop(.think), 109) && opening[136] == (.loop(.think), 0),
          "and loops it while it stays wanted")
    check(zip(opening, opening.dropFirst()).allSatisfy {
        $0.0 != $1.0 || $1.1 == $0.1 + 1 || ($1.1 == 0 && $0.1 == mark.sheet($0.0).count - 1)
    }, "one frame per redraw, none skipped")
    var held = ClaudeWorkingMark.Player(at: start, wanted: .think)
    _ = held.frame(at: at(5.5), wanted: .think)
    let back = held.frame(at: at(2), wanted: .think)
    check(back.stage == .grow && back.index == 5, "a clock that runs backwards holds the frame")
    check(held.frame(at: at(5.9), wanted: .think).index == 5 && held.frame(at: at(6) + epsilon, wanted: .think).index == 6,
          "frames change on the 1/30 s grid")

    // Think leaves at its seam (frame 54) when it is no longer wanted, if the
    // seam is more than 50 ms ahead; otherwise it finishes its loop.
    var think = ClaudeWorkingMark.Player(at: start, wanted: .think)
    _ = plays(&think, 0...36, wanted: .think)  // loop frame 10
    let seam = plays(&think, 37...200, wanted: .read)
    check(seam[0] == (.loop(.think), 11) && seam[79 - 37] == (.loop(.think), 53) && seam[80 - 37] == (.exit(.think), 0),
          "think exits at seam 54 for a new body")
    let readEnter = 26 + 54 + 15
    check(seam[readEnter - 37] == (.enter(.read), 0) && seam[readEnter + 21 - 37] == (.loop(.read), 0),
          "after its exit, the new body enters and loops")
    var late = ClaudeWorkingMark.Player(at: start, wanted: .think)
    _ = plays(&late, 0...(26 + 52), wanted: .think)
    let finish = plays(&late, (26 + 53)...(26 + 111), wanted: .read)  // at frame 53 the seam is 33 ms ahead
    check(finish[0] == (.loop(.think), 53) && finish[56] == (.loop(.think), 109) && finish[57] == (.exit(.think), 0),
          "a seam under 50 ms ahead is skipped and the loop finishes")
    var back2 = ClaudeWorkingMark.Player(at: start, wanted: .think)
    _ = plays(&back2, 0...30, wanted: .think)
    _ = plays(&back2, 31...40, wanted: .read)
    let stays = plays(&back2, 41...140, wanted: .think)
    check(stays.allSatisfy { $0.0 == .loop(.think) }, "wanted again before the seam, think keeps looping")

    // Code has three seams; the first one more than 50 ms ahead is taken.
    var code = ClaudeWorkingMark.Player(at: start, wanted: .code)
    _ = plays(&code, 0...(26 + 20), wanted: .code)  // loop frame 20
    let codeSeam = plays(&code, (26 + 21)...(26 + 40), wanted: .write)
    check(codeSeam[15] == (.loop(.code), 36) && codeSeam[16] == (.exit(.code), 0), "code exits at seam 37")
    var codeLate = ClaudeWorkingMark.Player(at: start, wanted: .code)
    _ = plays(&codeLate, 0...(26 + 57), wanted: .code)
    let codeEnd = plays(&codeLate, (26 + 58)...(26 + 76), wanted: .read)
    check(codeEnd[16] == (.loop(.code), 74) && codeEnd[17] == (.exit(.code), 0), "past the last seam, code finishes its loop")

    // Default, read, search and write have no seams: they finish the loop.
    for (body, enter, loop) in [(Body.default, 16, 40), (.read, 21, 60), (.search, 16, 20), (.write, 31, 60)] {
        var waits = ClaudeWorkingMark.Player(at: start, wanted: body)
        let loopStart = 10 + enter
        _ = plays(&waits, 0...(loopStart + 1), wanted: body)
        let rest = plays(&waits, (loopStart + 2)...(loopStart + loop), wanted: .think)
        check(rest[loop - 3] == (.loop(body), loop - 1) && rest[loop - 2] == (.exit(body), 0),
              "\(body) finishes its loop before leaving")
    }
    // A body changing during grow or an enter is picked up when it ends.
    var early = ClaudeWorkingMark.Player(at: start, wanted: .think)
    let switched = plays(&early, 0...30, wanted: .search)
    check(switched[10] == (.enter(.search), 0), "grow enters the body wanted when it ends")
    var entering = ClaudeWorkingMark.Player(at: start, wanted: .think)
    _ = plays(&entering, 0...12, wanted: .think)
    let enterThenLeave = plays(&entering, 13...(26 + 54), wanted: .read)
    check(enterThenLeave[26 - 13] == (.loop(.think), 0) && enterThenLeave[26 + 54 - 13] == (.exit(.think), 0),
          "an enter always plays its loop, which then leaves at its seam")
    // Skipping draws (an occluded window) catches up through whole loops.
    var gap = ClaudeWorkingMark.Player(at: start, wanted: .think)
    _ = gap.frame(at: at(30), wanted: .think)
    let caughtUp = gap.frame(at: at(26 + 110 * 7 + 3) + epsilon, wanted: .think)
    check(caughtUp.stage == .loop(.think) && caughtUp.index == 3, "a long gap keeps the loop's phase")

    // One playhead per conversation: resumed within 0.5 s, regrown after.
    var players = ClaudeWorkingMark.Players<String>()
    _ = players.frame("a", at: at(0), wanted: .think)
    players.mount("a", at: at(0))
    players.mount("a", at: at(1))  // the live row and the task list
    check(players.frame("a", at: at(6), wanted: .think).index == 6, "both places share one playhead")
    players.unmount("a", at: at(7))
    check(players.frame("a", at: at(8), wanted: .think).index == 8, "one place still draws it")
    players.unmount("a", at: at(9))
    players.mount("a", at: at(9 + 12))  // 0.4 s later
    let resumed = players.frame("a", at: at(30), wanted: .think)
    check(resumed.stage == .loop(.think) && resumed.index == 30 - 26, "drawn again within 0.5 s, it continues")
    check(players.frame("a", at: at(30 + 900), wanted: .think).stage != .grow, "not drawing (occluded) never regrows it")
    players.unmount("a", at: at(1_000))
    players.mount("a", at: at(1_000 + 16))  // 0.53 s later
    let regrown = players.frame("a", at: at(1_016), wanted: .think)
    check(regrown.stage == .grow && regrown.index == 0, "after 0.5 s away, it grows from the dot again")
    _ = players.frame("b", at: at(1_020), wanted: .code)
    players.mount("b", at: at(1_020))
    players.unmount("b", at: at(1_021))
    check(players.count == 2, "a mark that just left is kept for its resume window")
    _ = players.frame("a", at: at(1_040), wanted: .think)
    check(players.count == 1, "a mark gone longer than 0.5 s is dropped")

    // Which body: Claude's classifier for each tool call.
    let bodies: [(String, String?, Body)] = [
        ("Read", nil, .read), ("Edit", nil, .write), ("MultiEdit", nil, .write), ("Write", nil, .write),
        ("NotebookEdit", nil, .write), ("Grep", nil, .read), ("Glob", nil, .read), ("LS", nil, .read),
        ("NotebookRead", nil, .read), ("WebSearch", nil, .search), ("WebFetch", nil, .search),
        ("Bash", nil, .code), ("Bash", "List files in the package", .read), ("Bash", "Searching for the config", .read),
        ("Bash", "Creates the release notes", .write), ("Bash", "Build the package", .code),
        ("Bash", "Running tests", .code), ("Bash", "Copies files", .code), ("Bash", "  update the lockfile", .write),
        ("Bash", "<cc-memory filenames=\"notes.md\">Read the notes</cc-memory>", .read), ("Bash", "123 files", .code),
        ("BashOutput", nil, .code), ("KillShell", nil, .code), ("Task", nil, .default), ("Agent", nil, .default),
        ("SendMessage", nil, .default), ("TodoWrite", nil, .write), ("ExitPlanMode", nil, .default),
        ("Skill", nil, .default), ("ToolSearch", nil, .default), ("AskUserQuestion", nil, .default),
        ("TaskCreate", nil, .write), ("TaskUpdate", nil, .write), ("TaskList", nil, .read), ("TaskGet", nil, .read),
        ("mcp__x__search_threads", nil, .read), ("mcp__os1_memory__memory_query", nil, .write),
        ("mcp__os1_memory__memory_search", nil, .read), ("mcp__claude-in-chrome__read_page", nil, .default),
        ("mcp__cowork__present_files", nil, .read), ("mcp__x__present_files", nil, .default),
        ("mcp__x__run_query", nil, .code), ("launch_extended_search_task", nil, .search),
    ]
    for (tool, description, body) in bodies {
        check(mark.body(tool: tool, description: description) == body, "\(tool) \(description ?? "") plays \(body)")
    }
    check(mark.body(tool: "Read", description: "Creates") == .read, "only Bash reads its description")

    // Which body: the run's latest progress, as Claude reads a turn's blocks.
    let moment = Date(timeIntervalSinceReferenceDate: 812_955_869)
    func step(_ sequence: Int, _ tool: String, _ state: NativeExecutionProgress.Step.State, scope: String = "main",
              verb: String? = nil, label: String? = nil) -> NativeExecutionProgress.Step {
        NativeExecutionProgress.Step(id: String(format: "%012x", sequence), sequence: sequence, tool: tool, scope: scope,
            verb: verb, label: label, state: state, startedAt: moment,
            endedAt: [.observed, .requested].contains(state) ? nil : moment)
    }
    func progress(_ steps: [NativeExecutionProgress.Step], thinking: [Int] = [], subagentThinking: [Int] = [])
        -> NativeExecutionProgress {
        let events = (thinking.map { ($0, "main") } + subagentThinking.map { ($0, "subagent:0123456789ab") })
            .sorted { $0.0 < $1.0 }
            .map { NativeExecutionProgress.Event(sequence: $0.0, kind: .processing, tool: nil, scope: $0.1, observedAt: moment) }
        let last = max(events.last?.sequence ?? 0, steps.last?.sequence ?? 0, 1)
        return NativeExecutionProgress(sequence: last, kind: .processing, tool: nil, scope: "main", toolsRequested: 0,
            toolsReturned: 0, activeTools: 0, observedAt: moment, events: events, steps: steps)
    }
    check(mark.body(progress: nil) == .think && mark.body(progress: progress([], thinking: [1])) == .think,
          "before any tool call, Claude is thinking")
    check(mark.body(progress: progress([step(2, "Read", .returned), step(3, "Bash", .requested, verb: "run", label: "swift build")],
                                       thinking: [5])) == .code, "a call still waiting for its result wins")
    check(mark.body(progress: progress([step(2, "Bash", .requested, label: "List files"), step(3, "Edit", .returned)],
                                       thinking: [4])) == .read, "the newest waiting call wins, by its description")
    check(mark.body(progress: progress([step(2, "Read", .returned)], thinking: [4])) == .think, "thinking after a call plays think")
    check(mark.body(progress: progress([step(4, "Grep", .returned)], thinking: [2])) == .read, "a finished call keeps its body")
    check(mark.body(progress: progress([step(4, "WebSearch", .failed)])) == .search, "a failed call keeps its body")
    check(mark.body(progress: progress([step(2, "Glob", .returned), step(3, "Edit", .requested, scope: "subagent:0123456789ab")],
                                       subagentThinking: [5])) == .read, "a subagent's calls and thinking do not count")

    // Codex: a 270° band over a 30% track, one clockwise turn per 2 s in 6° steps.
    let ring = CodexWorkingRing.self
    let anchor = 812_955_869.25
    check(abs(ring.outerRadius - 16.0 / 3) < 1e-9 && abs(ring.innerRadius - 4) < 1e-9 && abs(ring.bandWidth - 4.0 / 3) < 1e-9,
          "16-point glyph with radii 4 to 5.33")
    check(ring.arcFraction == 0.75 && ring.trackOpacity == 0.3, "three-quarter band over a 30% track")
    check(ring.angle(at: 0) == 0 && ring.angle(at: 1.0 / 30 + epsilon) == 6 && ring.angle(at: 1.0 + epsilon) == 180
          && ring.angle(at: 1.99) == 354 && ring.angle(at: 2.0 + epsilon) == 0, "steps(60): 6° every 1/30 s, clockwise, 2 s a turn")
    check(ring.angle(at: 0.02) == 0, "no motion between steps")
    check(ring.angle(at: -0.01) == 354, "a clock before zero still lands on a step")
    check(ring.angle(at: anchor) == ring.angle(at: anchor + 2), "every ring shares one 2 s clock")
    print("Running route motion: \(checks) checks; OS-1 bars until routed, Claude's clay mark and the gray Codex ring from measured source")
}
