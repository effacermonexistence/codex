import Foundation
import OS1Context

/// NativeAttemptUsage: an attempt's spend from the provider's own records,
/// its auto-review / sub-agent threads included. Fixture rollouts only; no
/// real ~/.codex or ~/.claude is read and no model is called.
func runNativeAttemptUsageFixtures() throws {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-attempt-usage-" + UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let since = formatter.date(from: "2026-10-15T08:00:00.000Z")!
    let now = since.addingTimeInterval(120)
    func stamp(_ offset: TimeInterval) -> String { formatter.string(from: since.addingTimeInterval(offset)) }
    let parentID = "01a13e97-0000-7000-8000-000000000001"
    let guardianID = "01a13e97-0000-7000-8000-000000000002"
    let grandchildID = "01a13e97-0000-7000-8000-000000000003"
    let reusedID = "01a13e97-0000-7000-8000-000000000004"
    let unrelatedID = "01a13e97-0000-7000-8000-000000000005"
    let otherParentID = "01a13e97-0000-7000-8000-000000000006"
    let day = root.appendingPathComponent("codex/sessions/2026/10/15", isDirectory: true)
    try FileManager.default.createDirectory(at: day, withIntermediateDirectories: true)
    func meta(_ id: String, parent: String?, at offset: TimeInterval) -> String {
        let parentField = parent.map { #","parent_thread_id":"\#($0)""# } ?? ""
        return #"{"timestamp":"\#(stamp(offset))","type":"session_meta","payload":{"session_id":"\#(parent ?? id)","id":"\#(id)"\#(parentField),"timestamp":"\#(stamp(offset))","base_instructions":{"text":"\#(String(repeating: "x", count: 20_000))"}}}"#
    }
    func tokens(_ offset: TimeInterval, input: Int, cached: Int, output: Int, total: Int) -> String {
        #"{"timestamp":"\#(stamp(offset))","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":\#(total)},"last_token_usage":{"input_tokens":\#(input),"cached_input_tokens":\#(cached),"cache_write_input_tokens":0,"output_tokens":\#(output)}}}}"#
    }
    func task(_ kind: String, _ turn: String, _ offset: TimeInterval) -> String {
        #"{"timestamp":"\#(stamp(offset))","type":"event_msg","payload":{"type":"\#(kind)","turn_id":"\#(turn)"}}"#
    }
    func write(_ id: String, _ lines: [String]) throws -> URL {
        let file = day.appendingPathComponent("rollout-2026-10-15T01-00-00-\(id).jsonl")
        try Data(lines.joined(separator: "\n").utf8).write(to: file)
        return file
    }
    // The parent: an earlier turn before the attempt, then the attempt's turn.
    let parentLines = [meta(parentID, parent: nil, at: -3_600),
        task("task_started", "t-old", -3_500), tokens(-3_490, input: 9_999, cached: 0, output: 99, total: 10_098),
        task("task_complete", "t-old", -3_480),
        task("task_started", "t-new", 1), tokens(30, input: 1_000, cached: 400, output: 50, total: 11_148),
        task("task_complete", "t-new", 60)]
    let parent = try write(parentID, parentLines)
    let parentData = try Data(contentsOf: parent)
    // Auto-review thread started during the attempt; its own sub-agent.
    _ = try write(guardianID, [meta(guardianID, parent: parentID, at: 10), task("task_started", "g1", 11),
        tokens(12, input: 300, cached: 100, output: 20, total: 320), tokens(14, input: 200, cached: 0, output: 10, total: 530),
        task("task_complete", "g1", 15)])
    _ = try write(grandchildID, [meta(grandchildID, parent: guardianID, at: 20), task("task_started", "s1", 21),
        tokens(22, input: 50, cached: 0, output: 5, total: 55), task("task_complete", "s1", 23)])
    // A child reused from before the attempt: only its records since count.
    _ = try write(reusedID, [meta(reusedID, parent: parentID, at: -3_000), task("task_started", "r0", -2_999),
        tokens(-2_998, input: 7_777, cached: 0, output: 77, total: 7_854), task("task_complete", "r0", -2_997),
        task("task_started", "r1", 40), tokens(41, input: 70, cached: 0, output: 7, total: 7_931), task("task_complete", "r1", 42)])
    // Another thread's child is not this attempt's.
    _ = try write(unrelatedID, [meta(unrelatedID, parent: otherParentID, at: 5), task("task_started", "u1", 6),
        tokens(7, input: 123_456, cached: 0, output: 1, total: 123_457), task("task_complete", "u1", 8)])

    let sessions = root.appendingPathComponent("codex/sessions", isDirectory: true)
    check(NativeAttemptUsage.codexRollout(threadID: parentID.uppercased(), sessions: sessions, since: since, now: now)?.lastPathComponent
          == parent.lastPathComponent, "a started thread's unreported rollout is found by its id")
    check(NativeAttemptUsage.codexRollout(threadID: otherParentID, sessions: sessions, since: since, now: now) == nil,
          "a thread with no rollout has none")
    let parentOnly = CompletionUsageParser.parseCodexJSONL(parentData, turnID: "t-new")
    check(parentOnly?.inputTokens == 1_000, "the parent turn alone, as today's parser measures it")
    let children = Set(NativeAttemptUsage.codexChildRollouts(of: parentID, beside: parent, since: since, now: now).map(\.lastPathComponent))
    check(children == Set([guardianID, grandchildID, reusedID].map { "rollout-2026-10-15T01-00-00-\($0).jsonl" }),
          "auto-review, its sub-agent and a reused child are found; another thread's child and the parent are not")
    let attempt = NativeAttemptUsage.codex(parentData: parentData, parentRollout: parent, parentThreadID: parentID,
                                           turnID: "t-new", since: since, now: now)
    check(attempt?.inputTokens == 1_620 && attempt?.outputTokens == 92, "turn + child threads since the attempt began")
    check(attempt?.cacheTokens == 500 && attempt?.cacheWriteTokens == 0, "cached input sums across the threads")
    check(attempt?.resource.format == .codexRolloutJSONL && attempt?.resource.accountingVersion == 2 &&
          attempt?.resource.usageRecordCount == 5, "trusted Codex accounting, every record counted once")
    check(NativeAttemptUsage.codex(parentRollout: parent, parentThreadID: parentID, turnID: "t-new", since: since, now: now) == attempt,
          "reading the rollout itself gives the same measurement")
    // No acknowledged turn (the attempt ended before turn/start returned): the window.
    let windowed = NativeAttemptUsage.codex(parentData: parentData, parentRollout: parent, parentThreadID: parentID,
                                            turnID: nil, since: since, now: now)
    check(windowed?.inputTokens == 1_620, "an unknown turn is measured from the attempt's window, earlier turns excluded")
    check(NativeAttemptUsage.codexWindowed(parentData, since: since)?.inputTokens == 1_000, "the parent's window holds only the new turn")

    // No child: the parent's measurement is returned byte-for-byte.
    let lonelyRoot = root.appendingPathComponent("lonely/sessions/2026/10/15", isDirectory: true)
    try FileManager.default.createDirectory(at: lonelyRoot, withIntermediateDirectories: true)
    let lonely = lonelyRoot.appendingPathComponent("rollout-2026-10-15T01-00-00-\(parentID).jsonl")
    try parentData.write(to: lonely)
    check(NativeAttemptUsage.codex(parentData: parentData, parentRollout: lonely, parentThreadID: parentID,
                                   turnID: "t-new", since: since, now: now) == parentOnly,
          "without auto-review or sub-agent threads the measurement is unchanged")
    // A parent outside a sessions tree never scans for children.
    let loose = root.appendingPathComponent("loose-\(parentID).jsonl"); try parentData.write(to: loose)
    check(NativeAttemptUsage.codexChildRollouts(of: parentID, beside: loose, since: since, now: now).isEmpty, "no sessions tree, no children")
    // A turn the provider refused before any model call recorded no usage: nil, never an invented zero.
    let refused = Data([meta(parentID, parent: nil, at: 0), task("task_started", "t-429", 1), task("task_complete", "t-429", 2)]
        .joined(separator: "\n").utf8)
    check(NativeAttemptUsage.codex(parentData: refused, parentRollout: lonely, parentThreadID: parentID,
                                   turnID: "t-429", since: since, now: now) == nil, "no usage record, no usage")

    // A usage-limit refusal on a resumed thread replays the thread's previous
    // total with no model call: no spend. A turn that replays and then works
    // counts only its growth.
    let replayed = Data((parentLines + [task("task_started", "t-replay", 70),
        tokens(71, input: 1_000, cached: 400, output: 50, total: 11_148), task("task_complete", "t-replay", 72),
        task("task_started", "t-grew", 80), tokens(81, input: 1_000, cached: 400, output: 50, total: 11_148),
        tokens(85, input: 2_000, cached: 0, output: 10, total: 13_158), task("task_complete", "t-grew", 90)])
        .joined(separator: "\n").utf8)
    check(NativeAttemptUsage.codex(parentData: replayed, parentRollout: lonely, parentThreadID: parentID,
                                   turnID: "t-replay", since: since.addingTimeInterval(65), now: now) == nil,
          "a refused turn that only replays the thread's earlier total spent nothing")
    check(NativeAttemptUsage.codex(parentData: replayed, parentRollout: lonely, parentThreadID: parentID,
                                   turnID: "t-grew", since: since.addingTimeInterval(75), now: now)?.inputTokens == 2_000,
          "only usage that grew the thread's total is this turn's")
    check(NativeAttemptUsage.codex(parentData: replayed, parentRollout: lonely, parentThreadID: parentID,
                                   turnID: nil, since: since.addingTimeInterval(65), now: now)?.inputTokens == 2_000,
          "the window drops the replay the same way")

    // Codex 0.162 records: each response's usage beside running totals
    // (turn_token_usage, thread_token_usage), and a token_count repeating
    // most responses. A child turn already running when the attempt began
    // counts only its responses from `since` on, each once.
    func record(_ offset: TimeInterval, _ turn: String, _ response: String, _ usage: (Int, Int, Int),
                turnTotal: (Int, Int, Int), threadTotal: (Int, Int, Int)) -> String {
        func amounts(_ value: (Int, Int, Int)) -> String {
            #"{"input_tokens":\#(value.0),"cached_input_tokens":\#(value.1),"cache_write_input_tokens":0,"output_tokens":\#(value.2),"reasoning_output_tokens":0,"total_tokens":\#(value.0 + value.2)}"#
        }
        return #"{"timestamp":"\#(stamp(offset))","type":"token_usage_record","payload":{"turn_id":"\#(turn)","response_id":"\#(response)","usage":\#(amounts(usage)),"turn_token_usage":\#(amounts(turnTotal)),"thread_token_usage":\#(amounts(threadTotal))}}"#
    }
    let midTurnID = "01a13e97-0000-7000-8000-000000000007"
    let unrecordedID = "01a13e97-0000-7000-8000-000000000008"
    let midDay = root.appendingPathComponent("midturn/sessions/2026/10/15", isDirectory: true)
    try FileManager.default.createDirectory(at: midDay, withIntermediateDirectories: true)
    let midParent = midDay.appendingPathComponent("rollout-2026-10-15T01-00-00-\(parentID).jsonl")
    try parentData.write(to: midParent)
    let midTurnLines = [meta(midTurnID, parent: parentID, at: -600), task("task_started", "m1", -500),
        record(-400, "m1", "r1", (1_000, 0, 10), turnTotal: (1_000, 0, 10), threadTotal: (1_000, 0, 10)),
        tokens(-399, input: 1_000, cached: 0, output: 10, total: 1_010),
        record(5, "m1", "r2", (300, 100, 20), turnTotal: (1_300, 100, 30), threadTotal: (1_300, 100, 30)),
        tokens(5.5, input: 300, cached: 100, output: 20, total: 1_330),
        record(6, "m1", "r3", (200, 50, 5), turnTotal: (1_500, 150, 35), threadTotal: (1_500, 150, 35)),
        task("task_complete", "m1", 7), task("task_started", "m2", 8),
        record(9, "m2", "r4", (400, 0, 4), turnTotal: (400, 0, 4), threadTotal: (1_900, 150, 39)),
        tokens(9.5, input: 400, cached: 0, output: 4, total: 1_939), task("task_complete", "m2", 10)]
    let midTurn = midDay.appendingPathComponent("rollout-2026-10-15T01-00-00-\(midTurnID).jsonl")
    try Data(midTurnLines.joined(separator: "\n").utf8).write(to: midTurn)
    let midTurnData = try Data(contentsOf: midTurn)
    let midWindow = NativeAttemptUsage.codexWindowed(midTurnData, since: since)
    check(midWindow?.inputTokens == 900 && midWindow?.cacheTokens == 150 && midWindow?.outputTokens == 29,
          "a turn running across `since` counts its responses from `since` on, each once, never its running total")
    check(midWindow?.resource.usageRecordCount == 3, "r2 and r3 per response, the turn inside the window as its final total")
    check(NativeAttemptUsage.codexWindowed(midTurnData, since: since.addingTimeInterval(5.8))?.inputTokens == 600,
          "a window opening between two responses of a running turn keeps only the later one")
    check(NativeAttemptUsage.codexWindowed(midTurnData, since: since.addingTimeInterval(-3_600))?.inputTokens == 1_900,
          "a window holding the whole thread measures its records once, token_count repeats excluded")
    // A turn without records still counts its token_count lines from `since` on, keyed to that turn.
    _ = try Data([meta(unrecordedID, parent: parentID, at: -200), task("task_started", "n1", -100),
        tokens(-90, input: 50, cached: 0, output: 5, total: 55), tokens(3, input: 70, cached: 0, output: 7, total: 132),
        task("task_complete", "n1", 4)].joined(separator: "\n").utf8)
        .write(to: midDay.appendingPathComponent("rollout-2026-10-15T01-00-00-\(unrecordedID).jsonl"))
    let midAttempt = NativeAttemptUsage.codex(parentData: parentData, parentRollout: midParent, parentThreadID: parentID,
                                              turnID: "t-new", since: since, now: now)
    check(midAttempt?.inputTokens == 1_970 && midAttempt?.cacheTokens == 550 && midAttempt?.outputTokens == 86,
          "the attempt: its turn, the running child's responses since, and an unrecorded child's later exchange")

    // Claude: a run stopped before its result event, from its transcript.
    let transcript = Data([
        #"{"type":"assistant","timestamp":"\#(stamp(-60))","message":{"id":"m0","usage":{"input_tokens":900,"output_tokens":90,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}"#,
        #"{"type":"user","timestamp":"\#(stamp(1))","message":{"content":"input_tokens 999999"}}"#,
        #"{"type":"assistant","timestamp":"\#(stamp(5))","message":{"id":"m1","usage":{"input_tokens":2,"output_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":20}}}"#,
        #"{"type":"assistant","timestamp":"\#(stamp(6))","message":{"id":"m1","usage":{"input_tokens":2,"output_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":20}}}"#,
        #"{"type":"assistant","timestamp":"\#(stamp(9))","message":{"id":"m2","usage":{"input_tokens":3,"output_tokens":7,"cache_creation_input_tokens":0,"cache_read_input_tokens":30}}}"#,
    ].joined(separator: "\n").utf8)
    let claude = NativeAttemptUsage.claudeTranscript(transcript, since: since)
    check(claude?.inputTokens == 155 && claude?.outputTokens == 17 && claude?.cacheWriteTokens == 100 &&
          claude?.resource.format == .claudeJSONL && claude?.resource.accountingVersion == 1,
          "a Claude transcript's assistant usage since the attempt, each message once")
    check(NativeAttemptUsage.claudeTranscript(transcript, since: since.addingTimeInterval(3_600)) == nil, "nothing since, nothing measured")

    // Combining: a field is known only when every part knows it.
    let known = CompletionMeasuredUsage(inputTokens: 10, outputTokens: 1, cacheTokens: 4, cacheWriteTokens: 1,
        resource: .init(format: .codexRolloutJSONL, byteCount: 10, sha256: String(repeating: "a", count: 64), usageRecordCount: 1, accountingVersion: 2))
    let partial = CompletionMeasuredUsage(inputTokens: 5, outputTokens: 2, cacheTokens: nil,
        resource: .init(format: .codexRolloutJSONL, byteCount: 5, sha256: String(repeating: "b", count: 64), usageRecordCount: 2, accountingVersion: 2))
    check(NativeAttemptUsage.combined([known]) == known && NativeAttemptUsage.combined([]) == nil, "one part unchanged, none nil")
    let mixed = NativeAttemptUsage.combined([known, partial])
    check(mixed?.inputTokens == 15 && mixed?.outputTokens == 3 && mixed?.cacheTokens == nil && mixed?.cacheWriteTokens == nil &&
          mixed?.resource.usageRecordCount == 3 && mixed?.resource.byteCount == 15, "unknown cache stays unknown; counts sum")
    print("Native attempt usage: \(checks) checks passed (turn + auto-review/sub-agent threads, windowed failures, Claude transcript)")
}
