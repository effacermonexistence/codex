import Foundation

/// A failed Codex turn that the provider rejected for a rate limit or usage
/// limit, and whether the app-server's own evidence places that rejection
/// BEFORE any model or tool work. Pure: callers pass the turn object of
/// `turn/completed` and what the notification stream of that turn showed.
///
/// The limit class reads the turn error's `codexErrorInfo` (camelCase on the
/// app-server wire; a rollout spells it snake_case): `usageLimitExceeded`,
/// `rateLimitExceeded`, or a request-level failure that carries HTTP 429
/// (`responseTooManyFailedAttempts`: Codex retried and every request was
/// refused; `httpConnectionFailed`; `responseStreamConnectionFailed`). A
/// response stream that DISCONNECTED mid-turn is never one: output may have
/// streamed before it. Only when no structured class is given (absent or
/// `other`) may the error message itself name HTTP 429 or a usage limit; it
/// is the provider's own error for this turn, never model text.
///
/// The no-work proof (`rejectedBeforeExecution`) needs all of: the turn
/// failed with a limit class; every turn item is the owner's input (no agent
/// message, reasoning, plan, tool call, file change or compaction); the turn
/// carries its full item list; and the stream showed no work of its own
/// (`WorkEvidence`): every turn error it streamed was itself a limit
/// rejection (an earlier mid-turn disconnect means a request was accepted),
/// and no token count grew past the thread's usage before the turn.
/// `os1 rcc-execute` adds the read-only scope and the workspace evidence
/// (`RCCNativeAttemptOutcome.failure`).
public enum CodexTurnRejection {
    /// Turn items that are the request itself, not work done for it.
    public static let inputItemTypes: Set<String> = ["userMessage", "hookPrompt"]
    /// Turn-scoped notifications that are not work: lifecycle, hooks the
    /// owner configured, and diagnostics. A turn `error` is quiet only when
    /// it is itself a limit rejection (`WorkEvidence`). Every other
    /// turn-scoped message (deltas, items other than the input, plans, diffs,
    /// token usage that grew, compaction, any server request) is work.
    static let quietMethods: Set<String> = ["turn/started", "turn/completed", "warning",
        "hook/started", "hook/completed", "model/verification", "deprecationNotice", "configWarning"]
    /// Request-level failures whose HTTP status 429 is a limit rejection.
    static let requestFailures: [String: String] = [
        "responsetoomanyfailedattempts": "response_too_many_failed_attempts_429",
        "httpconnectionfailed": "http_connection_failed_429",
        "responsestreamconnectionfailed": "response_stream_connection_failed_429"]

    static func normalized(_ text: String) -> String {
        text.lowercased().replacingOccurrences(of: "_", with: "")
    }
    static func info(_ error: [String: Any]) -> Any? { error["codexErrorInfo"] ?? error["codex_error_info"] }
    static func status(_ value: Any?) -> Int? {
        guard let details = value as? [String: Any] else { return nil }
        return (details["httpStatusCode"] ?? details["http_status_code"]) as? Int
    }

    /// The limit class of a failed turn's structured error, or nil when it is
    /// no rate-limit / usage-limit rejection.
    public static func limitClass(error: [String: Any]) -> String? {
        switch info(error) {
        case let tag as String:
            switch normalized(tag) {
            case "usagelimitexceeded": return "usage_limit_exceeded"
            case "ratelimitexceeded": return "rate_limit_exceeded"
            case "other", "": break
            default: return nil
            }
        case let object as [String: Any]:
            for (key, value) in object {
                if let name = requestFailures[normalized(key)], status(value) == 429 { return name }
            }
            return nil
        case nil, is NSNull: break
        default: return nil
        }
        let message = (error["message"] as? String ?? "").lowercased()
        if ["429 too many requests", "status: 429", "status 429", "status code 429", "http 429"].contains(where: message.contains) {
            return "http_429"
        }
        if ["usage limit", "rate limit exceeded", "rate_limit_exceeded"].contains(where: message.contains) {
            return "usage_limit_message"
        }
        return nil
    }

    /// What the notification stream of ONE turn showed: whether any work of
    /// that turn was observed. Messages of another thread or turn, and
    /// thread- or account-level notifications, are not about this turn.
    public struct WorkEvidence: Equatable, Sendable {
        public private(set) var observed = false
        /// The thread's total token count before this turn started (a
        /// resumed thread's last persisted usage, `rolloutTotalTokens`, or
        /// the last update seen on the same connection); nil when unknown.
        public let baselineTotalTokens: Int?
        public init(baselineTotalTokens: Int? = nil) { self.baselineTotalTokens = baselineTotalTokens }
        public mutating func observe(_ message: [String: Any], threadID: String, turnID: String) {
            guard let params = message["params"] as? [String: Any], params["turnId"] as? String == turnID else { return }
            if let thread = params["threadId"] as? String, thread != threadID { return }
            // A server request scoped to this turn (an approval, an MCP
            // elicitation) means the model proposed work.
            if message["id"] != nil { observed = true; return }
            let method = message["method"] as? String ?? ""
            if CodexTurnRejection.quietMethods.contains(method) { return }
            switch method {
            case "item/started", "item/completed":
                let type = (params["item"] as? [String: Any])?["type"] as? String ?? ""
                if !CodexTurnRejection.inputItemTypes.contains(type) { observed = true }
            case "error":
                // A retry notice for a request refused with a limit (HTTP
                // 429, a usage limit) before any stream opened is not work.
                // Any other turn error is: a response stream that
                // disconnected mid-turn means a request was accepted and may
                // already have been processed and billed.
                if CodexTurnRejection.limitClass(error: params["error"] as? [String: Any] ?? [:]) == nil { observed = true }
            case "thread/tokenUsage/updated":
                // A usage-limit refusal on a resumed thread replays the
                // thread's previous usage with no model call (2026-08-20 and
                // 2026-09-07 rollouts: one token_count whose total and last
                // equal the previous turn's): a total that did not grow past
                // the baseline is no work.
                let usage = params["tokenUsage"] as? [String: Any]
                if let baselineTotalTokens, let total = (usage?["total"] as? [String: Any])?["totalTokens"] as? Int,
                   total == baselineTotalTokens { return }
                // Otherwise tokens counted for this turn are a model call
                // that ran; an unreadable count is treated as one.
                let last = usage?["last"] as? [String: Any]
                if (last?["totalTokens"] as? Int).map({ $0 > 0 }) ?? true { observed = true }
            default: observed = true
            }
        }
    }

    /// The provider rejected this turn for a rate or usage limit before any
    /// model or tool work (see the type comment). `turn` is the
    /// `turn/completed` turn object of the exact turn the evidence observed.
    public static func rejectedBeforeExecution(turn: [String: Any], evidence: WorkEvidence) -> Bool {
        guard !evidence.observed, turn["status"] as? String == "failed",
              let error = turn["error"] as? [String: Any], limitClass(error: error) != nil,
              (turn["itemsView"] as? String).map({ $0 == "full" }) ?? true,
              let items = turn["items"] as? [[String: Any]] else { return false }
        return items.allSatisfy { inputItemTypes.contains($0["type"] as? String ?? "") }
    }

    /// A resumed thread's total token count before its next turn: the last
    /// `token_count` event of its rollout (`info.total_token_usage
    /// .total_tokens`, the counter the app-server reports as
    /// `tokenUsage.total.totalTokens`). Reads at most the file's final
    /// `tailBytes`; nil when the file is unreadable or no such event is
    /// there (the evidence then counts any nonzero usage as work).
    public static func rolloutTotalTokens(path: String, tailBytes: Int = 4_000_000) -> Int? {
        guard let handle = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? handle.close() }
        guard let end = try? handle.seekToEnd() else { return nil }
        let start = end > UInt64(tailBytes) ? end - UInt64(tailBytes) : 0
        guard (try? handle.seek(toOffset: start)) != nil, let data = try? handle.read(upToCount: tailBytes) else { return nil }
        let marker = Data("token_count".utf8)
        for line in data.split(separator: UInt8(ascii: "\n")).reversed() where line.range(of: marker) != nil {
            guard let event = (try? JSONSerialization.jsonObject(with: Data(line))) as? [String: Any],
                  event["type"] as? String == "event_msg",
                  let payload = event["payload"] as? [String: Any], payload["type"] as? String == "token_count",
                  let info = payload["info"] as? [String: Any],
                  let total = (info["total_token_usage"] as? [String: Any])?["total_tokens"] as? Int,
                  total >= 0 else { continue }
            return total
        }
        return nil
    }

    /// A retry hint the provider gave in its own error ("try again in 30
    /// seconds", "retry after 2m", "Retry-After: 45"), in seconds; nil when
    /// none. Callers bound it (`CodexQuotaBackoff.cooldown`).
    public static func retryAfter(error: [String: Any]) -> TimeInterval? {
        let text = [error["message"], error["additionalDetails"], error["additional_details"]]
            .compactMap { $0 as? String }.joined(separator: " ")
        guard !text.isEmpty, let expression = try? NSRegularExpression(
            pattern: #"(?:try again in|retry after|retry-after:?)\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)?\b"#,
            options: [.caseInsensitive]),
            let match = expression.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
            let numberRange = Range(match.range(at: 1), in: text), let value = Double(text[numberRange]),
            value.isFinite, value >= 0 else { return nil }
        let unit = Range(match.range(at: 2), in: text).map { text[$0].lowercased() } ?? "s"
        let scale: Double = unit.hasPrefix("d") ? 86_400 : unit.hasPrefix("h") ? 3_600 : unit.hasPrefix("m") ? 60 : 1
        return value * scale
    }

    /// The turn's failure as the provider stated it, for the attempt's
    /// diagnosis ("codex turn failed: response_too_many_failed_attempts_429:
    /// exceeded retry limit, ..."). Unsanitized: the RCC adapter sanitizes it
    /// before anything is written (`RCCNativeAttemptOutcome.failureCause`).
    public static func failureSummary(turn: [String: Any]) -> String {
        var parts = ["codex turn " + String((turn["status"] as? String ?? "unknown").prefix(32))]
        if let error = turn["error"] as? [String: Any] {
            if let limit = limitClass(error: error) { parts.append(limit) }
            else if let tag = info(error) as? String { parts.append(String(tag.prefix(64))) }
            else if let object = info(error) as? [String: Any], let key = object.keys.sorted().first {
                parts.append(String(key.prefix(64)) + (status(object[key]).map { "(\($0))" } ?? ""))
            }
            if let message = error["message"] as? String, !message.isEmpty { parts.append(String(message.prefix(600))) }
        }
        return parts.joined(separator: ": ")
    }
}
