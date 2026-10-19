import Foundation

/// What one native attempt spent, read from the provider's own records, also
/// when the attempt ends held, interrupted, rejected or not returned.
///
/// Audit 2026-10-19 (routing ledger): four Codex attempts whose rollouts hold
/// 384,131 input tokens were recorded with no usage (each one's answer was
/// rejected after the turn, so the usage the turn produced never reached the
/// receipt), and the auto-review ("guardian") threads Codex starts beside an
/// OS-1 thread (60,781 input tokens on two of them) were never counted. Codex
/// writes those threads, and any sub-agent thread, as their own rollouts whose
/// `session_meta` names the thread they serve as `parent_thread_id`.
public enum NativeAttemptUsage {
    /// Bytes read from one record (CompletionUsageParser's own bound).
    public static let maximumRecordBytes = 64_000_000
    static let maximumChildRollouts = 64
    static let maximumDepth = 3
    static let sessionMetaHeadBytes = 16_384

    /// One Codex attempt: its turn on its own thread (`turnID`; unknown, each
    /// response from `since` on, codexWindowed) plus each response from
    /// `since` on of the threads started under it (auto-review and sub-agent
    /// threads, down to `maximumDepth`; a child turn already running at
    /// `since` counts only its later responses). With no child usage the parent's measurement
    /// is returned unchanged. Nil when no usage record exists: a turn the
    /// provider refused before any model call records none (or only replays
    /// the thread's earlier total, droppingReplayedTotals), and none is
    /// invented.
    public static func codex(parentRollout: URL, parentThreadID: String, turnID: String?, since: Date,
                             now: Date = Date()) -> CompletionMeasuredUsage? {
        guard let parentData = boundedRead(parentRollout) else { return nil }
        return codex(parentData: parentData, parentRollout: parentRollout, parentThreadID: parentThreadID,
                     turnID: turnID, since: since, now: now)
    }

    /// `codex(parentRollout:…)` for a parent rollout already read.
    public static func codex(parentData: Data, parentRollout: URL, parentThreadID: String, turnID: String?,
                             since: Date, now: Date = Date()) -> CompletionMeasuredUsage? {
        let own = droppingReplayedTotals(parentData, turnID: turnID, since: since)
        let parent = turnID.map { CompletionUsageParser.parseCodexJSONL(own, turnID: $0) } ?? codexWindowed(own, since: since)
        var parts = parent.map { [$0] } ?? []
        for child in codexChildRollouts(of: parentThreadID, beside: parentRollout, since: since, now: now) {
            if let data = boundedRead(child),
               let usage = codexWindowed(droppingReplayedTotals(data, turnID: nil, since: since), since: since) { parts.append(usage) }
        }
        return combined(parts)
    }

    /// Codex replays a resumed thread's previous usage when it refuses a turn
    /// before any model call (CodexTurnRejection.WorkEvidence: a token_count
    /// whose total equals the thread's total before the turn). That record is
    /// no spend of this attempt, so token_count lines in scope (the turn; with
    /// no turn, records from `since`) whose total equals the last total before
    /// the scope are dropped. With none dropped the bytes are returned as is.
    static func droppingReplayedTotals(_ data: Data, turnID: String?, since: Date) -> Data {
        let markers = ["token_count", "task_started", "task_complete"].map { Data($0.utf8) }
        let parser = TimestampParser()
        let lines = data.split(separator: 0x0A, omittingEmptySubsequences: false)
        var baseline: Int?
        var scopeStarted = false
        var activeTurn: String?
        var dropped = Set<Int>()
        for (index, line) in lines.enumerated() where markers.contains(where: { line.range(of: $0) != nil }) {
            guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  object["type"] as? String == "event_msg", let payload = object["payload"] as? [String: Any] else { continue }
            switch payload["type"] as? String {
            case "task_started": activeTurn = payload["turn_id"] as? String
            case "task_complete": if payload["turn_id"] as? String == activeTurn { activeTurn = nil }
            case "token_count":
                guard let total = ((payload["info"] as? [String: Any])?["total_token_usage"] as? [String: Any])?["total_tokens"] as? Int
                else { continue }
                let inScope = turnID.map { $0 == activeTurn }
                    ?? ((object["timestamp"] as? String).flatMap(parser.date).map { $0 >= since } ?? false)
                if inScope {
                    scopeStarted = true
                    if total == baseline { dropped.insert(index) }
                } else if !scopeStarted { baseline = total }
            default: continue
            }
        }
        guard !dropped.isEmpty else { return data }
        return Data(lines.enumerated().filter { !dropped.contains($0.offset) }.map(\.element).joined(separator: Data([0x0A])))
    }

    /// Rollouts of threads Codex started under `parentThreadID` (and under
    /// those, to `maximumDepth`), written at/after `since`: same sessions
    /// tree as the parent (`<CODEX_HOME>/sessions/YYYY/MM/DD/`). Reads only
    /// each candidate's first `sessionMetaHeadBytes`.
    public static func codexChildRollouts(of parentThreadID: String, beside parentRollout: URL, since: Date,
                                          now: Date = Date()) -> [URL] {
        let sessions = parentRollout.deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
        guard sessions.lastPathComponent == "sessions" else { return [] }
        let parentPath = parentRollout.standardizedFileURL.path
        var identities: [(file: URL, id: String, parent: String)] = []
        for file in rolloutFiles(in: sessions, since: since, now: now) where file.standardizedFileURL.path != parentPath {
            if let identity = sessionMetaIdentity(file) { identities.append((file, identity.id, identity.parent)) }
        }
        var found: [URL] = []
        var known: Set<String> = [parentThreadID.lowercased()]
        var frontier = known
        for _ in 0..<maximumDepth where !frontier.isEmpty {
            var next: Set<String> = []
            for row in identities where frontier.contains(row.parent) && !known.contains(row.id) {
                found.append(row.file)
                next.insert(row.id)
                if found.count >= maximumChildRollouts { return found }
            }
            known.formUnion(next)
            frontier = next
        }
        return found
    }

    /// The rollout of `threadID` under `<CODEX_HOME>/sessions`, written at/after
    /// `since` (a thread started for this attempt whose path was not reported).
    public static func codexRollout(threadID: String, sessions: URL, since: Date, now: Date = Date()) -> URL? {
        let suffix = "-" + threadID.lowercased() + ".jsonl"
        return rolloutFiles(in: sessions, since: since, now: now).first { $0.lastPathComponent.lowercased().hasSuffix(suffix) }
    }

    /// The usage a Codex rollout records from `since` on: each response
    /// stamped at/after `since`, once.
    ///
    /// Turns are read over the whole rollout, not only the window. A turn
    /// that started before `since` and still ran inside it counts only its
    /// responses from `since` on: its records' running totals
    /// (`turn_token_usage`, `thread_token_usage`) also hold the responses
    /// before `since`, so each of its records counts by its own `usage`
    /// (one per `response_id`). A turn wholly inside the window keeps its
    /// final running total; on every recorded turn on disk (1,404 turns,
    /// 2026-10-19) the per-response amounts sum to it exactly. A turn with
    /// token_usage_record lines is measured from those records only: its
    /// token_count lines repeat the same responses (and miss some on 117
    /// of those turns). A turn without records is measured from its
    /// token_count lines keyed to that turn (its task_started line is kept
    /// even when it precedes `since`), never as un-turned usage. A
    /// token_count outside every turn counts only in a rollout that has
    /// no turns at all. Nil when nothing in the window can be measured,
    /// or when a record of a turn started before `since` has no
    /// per-response usage to count.
    public static func codexWindowed(_ data: Data, since: Date) -> CompletionMeasuredUsage? {
        enum Kind { case started, completed, record, count }
        let markers = ["token_count", "token_usage_record", "task_started", "task_complete"].map { Data($0.utf8) }
        let parser = TimestampParser()
        var entries: [(line: Data, object: [String: Any], kind: Kind, turn: String?, inWindow: Bool)] = []
        var startLine: [String: Data] = [:]
        var startedInWindow = Set<String>()
        var hasUsageBefore = Set<String>() // started, or recorded usage, before `since`
        var recordedTurns = Set<String>()
        var rolloutHasTurns = false
        var activeTurn: String?
        for line in data.split(separator: 0x0A) where markers.contains(where: { line.range(of: $0) != nil }) {
            guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let payload = object["payload"] as? [String: Any] else { continue }
            let inWindow = (object["timestamp"] as? String).flatMap(parser.date).map { $0 >= since } ?? false
            let kind: Kind
            var turn: String?
            switch (object["type"] as? String, payload["type"] as? String) {
            case ("token_usage_record", _):
                guard let id = payload["turn_id"] as? String else { continue }
                kind = .record; turn = id
                recordedTurns.insert(id)
                if !inWindow { hasUsageBefore.insert(id) }
            case ("event_msg", "task_started"?):
                guard let id = payload["turn_id"] as? String else { continue }
                kind = .started; turn = id
                activeTurn = id; rolloutHasTurns = true
                if startLine[id] == nil { startLine[id] = Data(line) }
                if inWindow { startedInWindow.insert(id) } else { hasUsageBefore.insert(id) }
            case ("event_msg", "task_complete"?):
                guard let id = payload["turn_id"] as? String else { continue }
                kind = .completed; turn = id
                if id == activeTurn { activeTurn = nil }
            case ("event_msg", "token_count"?):
                kind = .count; turn = activeTurn
            default: continue
            }
            entries.append((Data(line), object, kind, turn, inWindow))
        }
        var kept: [Data] = []
        var keyedTurns = Set<String>()
        for entry in entries where entry.inWindow {
            switch entry.kind {
            case .started:
                kept.append(entry.line)
                if let turn = entry.turn { keyedTurns.insert(turn) }
            case .completed:
                kept.append(entry.line)
            case .record:
                guard let turn = entry.turn else { continue }
                if startedInWindow.contains(turn) && !hasUsageBefore.contains(turn) {
                    kept.append(entry.line)
                    continue
                }
                var object = entry.object
                guard var payload = object["payload"] as? [String: Any], payload["usage"] is [String: Any],
                      payload["response_id"] is String else { return nil }
                payload["turn_token_usage"] = nil
                payload["thread_token_usage"] = nil
                object["payload"] = payload
                guard let line = try? JSONSerialization.data(withJSONObject: object) else { return nil }
                kept.append(line)
            case .count:
                guard let turn = entry.turn else {
                    if !rolloutHasTurns { kept.append(entry.line) }
                    continue
                }
                guard !recordedTurns.contains(turn) else { continue }
                if !keyedTurns.contains(turn), let start = startLine[turn] {
                    kept.append(start)
                    keyedTurns.insert(turn)
                }
                kept.append(entry.line)
            }
        }
        guard !kept.isEmpty else { return nil }
        return CompletionUsageParser.parseCodexJSONL(Data(kept.joined(separator: Data([0x0A]))), turnID: nil)
    }

    /// A Claude session transcript's assistant usage stamped at/after `since`
    /// (CompletionUsageParser.parseClaudeJSONL on that window): the record a
    /// run that ended before its `result` event still left.
    public static func claudeTranscript(_ data: Data, since: Date) -> CompletionMeasuredUsage? {
        let marker = Data("\"assistant\"".utf8)
        let parser = TimestampParser()
        var kept: [Data] = []
        for line in data.split(separator: 0x0A) where line.range(of: marker) != nil {
            guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  object["type"] as? String == "assistant",
                  let stamp = (object["timestamp"] as? String).flatMap(parser.date), stamp >= since else { continue }
            kept.append(Data(line))
        }
        guard !kept.isEmpty else { return nil }
        return CompletionUsageParser.parseClaudeJSONL(Data(kept.joined(separator: Data([0x0A]))))
    }

    /// One measurement of several records of one attempt. A token field is
    /// known only when every part knows it; the resource keeps the first
    /// part's format and accounting version, and digests the parts' digests.
    /// A single part is returned unchanged.
    public static func combined(_ parts: [CompletionMeasuredUsage]) -> CompletionMeasuredUsage? {
        guard let first = parts.first else { return nil }
        guard parts.count > 1 else { return first }
        func total(_ field: (CompletionMeasuredUsage) -> Int?) -> Int? {
            var sum = 0
            for part in parts {
                guard let value = field(part) else { return nil }
                let next = sum.addingReportingOverflow(value)
                guard !next.overflow, next.partialValue <= 2_000_000_000 else { return nil }
                sum = next.partialValue
            }
            return sum
        }
        let cache = total(\.cacheTokens)
        let resource = CompletionUsageResourceMetadata(
            format: first.resource.format,
            byteCount: max(1, min(maximumRecordBytes, parts.reduce(0) { $0 + $1.resource.byteCount })),
            sha256: CompletionFeedbackScope.digest(Data(parts.map(\.resource.sha256).joined(separator: "\n").utf8)),
            usageRecordCount: max(1, min(10_000, parts.reduce(0) { $0 + $1.resource.usageRecordCount })),
            accountingVersion: first.resource.accountingVersion)
        return CompletionMeasuredUsage(inputTokens: total(\.inputTokens), outputTokens: total(\.outputTokens),
            cacheTokens: cache, cacheWriteTokens: cache == nil ? nil : total(\.cacheWriteTokens), resource: resource)
    }

    /// A regular file of at most `maximumRecordBytes`, or nil.
    public static func boundedRead(_ file: URL) -> Data? {
        guard let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
              values.isRegularFile == true, (values.fileSize ?? Int.max) <= maximumRecordBytes else { return nil }
        return try? Data(contentsOf: file)
    }

    /// `rollout-*.jsonl` files modified at/after `since` in the day folders
    /// that can hold a thread started between `since` and `now` (local and
    /// UTC dates, one day of margin each side, at most eight days back).
    static func rolloutFiles(in sessions: URL, since: Date, now: Date) -> [URL] {
        let start = max(since, now.addingTimeInterval(-7 * 86_400)).addingTimeInterval(-86_400)
        var folders: [String] = []
        for zone in [TimeZone.current, TimeZone(identifier: "UTC")!] {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = zone
            var day = calendar.startOfDay(for: start)
            while day <= now.addingTimeInterval(86_400) {
                let parts = calendar.dateComponents([.year, .month, .day], from: day)
                if let year = parts.year, let month = parts.month, let date = parts.day {
                    let folder = String(format: "%04d/%02d/%02d", year, month, date)
                    if !folders.contains(folder) { folders.append(folder) }
                }
                guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
                day = next
            }
        }
        let earliest = since.addingTimeInterval(-5)
        var files: [URL] = []
        for folder in folders {
            let directory = sessions.appendingPathComponent(folder, isDirectory: true)
            guard let entries = try? FileManager.default.contentsOfDirectory(at: directory,
                includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey], options: [.skipsHiddenFiles]) else { continue }
            for entry in entries where entry.lastPathComponent.hasPrefix("rollout-") && entry.pathExtension == "jsonl" {
                guard let values = try? entry.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey]),
                      values.isRegularFile == true, (values.contentModificationDate ?? .distantPast) >= earliest else { continue }
                files.append(entry)
            }
        }
        return files.sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    /// The thread id and `parent_thread_id` a rollout's `session_meta` line
    /// names (lower-cased), from the head of that line only.
    static func sessionMetaIdentity(_ file: URL) -> (id: String, parent: String)? {
        guard let handle = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? handle.close() }
        guard let bytes = try? handle.read(upToCount: sessionMetaHeadBytes) else { return nil }
        let head = String(decoding: bytes.prefix { $0 != 0x0A }, as: UTF8.self)
        guard head.contains("\"session_meta\"") else { return nil }
        func value(_ key: String) -> String? {
            guard let expression = try? NSRegularExpression(pattern: "\"" + key + "\"\\s*:\\s*\"([0-9A-Fa-f-]{36})\""),
                  let match = expression.firstMatch(in: head, range: NSRange(head.startIndex..., in: head)),
                  let range = Range(match.range(at: 1), in: head) else { return nil }
            return head[range].lowercased()
        }
        guard let id = value("id"), let parent = value("parent_thread_id"), id != parent else { return nil }
        return (id, parent)
    }

    /// Provider records stamp ISO 8601 UTC, with or without fractions.
    struct TimestampParser {
        let fractional: ISO8601DateFormatter = {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return formatter
        }()
        let whole = ISO8601DateFormatter()
        func date(_ text: String) -> Date? { fractional.date(from: text) ?? whole.date(from: text) }
    }
}
