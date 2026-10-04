import Foundation
import CoreFoundation

/// Only public assistant text and tool lifecycle names are admitted. Thinking,
/// system messages, hooks, tool arguments and tool results never enter the UI.
public final class ExecutionStream {
    private var buffer = Data()
    private var items: [(String, String)] = []
    private var activeMessage = ""
    private var claudeExecutionObserved = false
    private var claudeStreamDamaged = false
    private var quotaRejectionSession: String?
    private let expectedClaudeSessionID: String?
    private let invalidClaudeBinding: Bool
    private let observedTime: () -> Date
    private struct ToolState { let name: String; let scope: String; var returned = false }
    private var toolStates: [String: ToolState] = [:]
    private var mainToolOrder: [String] = []
    private var lifecycleIDs = Set<String>()
    private var toolProgressValues: [String: Double] = [:]
    private var lastProcessingObservation: [String: Date] = [:]
    private var codexSnapshotIdentity: String?
    private var toolsRequested = 0, toolsReturned = 0
    public private(set) var progress: NativeExecutionProgress?

    /// Protocol attestation, not an inference from empty UI output or unchanged files.
    public func claudeQuotaRejectedBeforeExecution(sessionID: String) -> Bool {
        guard !claudeExecutionObserved, !claudeStreamDamaged, resultCount == 1,
              quotaRejectionSession == sessionID, let result,
              let o = try? JSONSerialization.jsonObject(with: result) as? [String: Any],
              o["session_id"] as? String == sessionID,
              o["terminal_reason"] as? String == "api_error",
              o["api_error_status"] as? Int == 429,
              o["num_turns"] as? Int == 1,
              Self.zeroClaudeUsage(o["usage"]),
              UnifiedExecution.claudeTerminalBlocker(status: 1, object: o) == .quotaExhausted else { return false }
        return true
    }
    private static func zeroClaudeUsage(_ value: Any?) -> Bool {
        guard let usage = value as? [String: Any] else { return false }
        return ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].allSatisfy {
            (usage[$0] as? Int) == 0
        }
    }
    public private(set) var result: Data?
    public private(set) var eventCount = 0
    public private(set) var tool: String?
    /// Completed Claude turns in this run (a steered run has several).
    public private(set) var resultCount = 0
    /// True while an assistant turn is streaming; a correction sent now is
    /// queued by the CLI for the turn after the current one.
    public private(set) var turnOpen = false
    public var text: String { String(items.map(\.1).joined(separator: "\n\n").suffix(24_000)) }
    public init(claudeSessionID: String? = nil, observedTime: @escaping () -> Date = { Date() }) {
        expectedClaudeSessionID = claudeSessionID.flatMap { UUID(uuidString: $0)?.uuidString.lowercased() }
        invalidClaudeBinding = claudeSessionID != nil && expectedClaudeSessionID == nil
        self.observedTime = observedTime
    }

    private static func safeID(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{1,160}$"#, options: .regularExpression) != nil
    }
    private func observe(_ kind: NativeExecutionProgress.Kind, tool name: String? = nil, scope: String = "main") {
        let sequence = (progress?.sequence ?? 0) + 1
        guard sequence <= 1_000_000 else { return }
        let date = observedTime()
        var events = progress?.events ?? []
        events.append(.init(sequence: sequence, kind: kind, tool: name, scope: scope, observedAt: date))
        if events.count > 12 { events.removeFirst(events.count - 12) }
        let candidate = NativeExecutionProgress(sequence: sequence, kind: kind, tool: name, scope: scope,
            toolsRequested: toolsRequested, toolsReturned: toolsReturned, activeTools: toolsRequested - toolsReturned,
            observedAt: date, events: events)
        guard candidate.isValid else { return }
        progress = candidate; eventCount += 1
    }
    private func observeOnce(_ identity: String, kind: NativeExecutionProgress.Kind, scope: String, tool: String? = nil) {
        guard lifecycleIDs.count < 50_000, lifecycleIDs.insert(identity).inserted else { return }
        observe(kind, tool: tool, scope: scope)
    }
    private func processingObservation(scope: String) {
        let now = observedTime()
        guard lastProcessingObservation[scope].map({ now.timeIntervalSince($0) >= 1 }) ?? true else { return }
        lastProcessingObservation[scope] = now
        observe(.processing, scope: scope)
    }
    private func toolRequest(id: String?, name: String, scope: String, provider: String) {
        guard Self.safeTool(name) else { return }
        guard let id else {
            // Legacy source shapes may identify a tool but not its request.
            // Keep the category; do not invent a deduplicated request count.
            if scope == "main" { tool = name }
            observe(.toolWorking, tool: name, scope: scope); return
        }
        guard Self.safeID(id) else { return }
        let key = provider + ":" + scope + ":" + id
        guard toolStates[key] == nil, toolStates.count < 50_000 else { return }
        toolStates[key] = ToolState(name: name, scope: scope)
        toolsRequested += 1
        if scope == "main" { mainToolOrder.append(key); tool = name }
        observe(.toolStarted, tool: name, scope: scope)
    }
    private func toolReturn(id: String, scope: String, provider: String, failed: Bool = false) {
        guard Self.safeID(id) else { return }
        let key = provider + ":" + scope + ":" + id
        guard var state = toolStates[key], !state.returned else { return }
        state.returned = true; toolStates[key] = state; toolsReturned += 1
        if scope == "main" {
            mainToolOrder.removeAll { $0 == key }
            tool = mainToolOrder.last.flatMap { toolStates[$0]?.name }
        }
        observe(failed ? .toolFailed : .toolReturned, tool: state.name, scope: scope)
    }
    /// Consume each bound successful public result once. A retained result from
    /// the previous steered turn must not mask a later turn's text deltas.
    public func takeClaudePublicFinal(sessionID: String, after cursor: inout Int) -> String? {
        guard resultCount > cursor else { return nil }
        cursor = resultCount
        guard let result, let object = try? JSONSerialization.jsonObject(with: result) as? [String: Any],
              object["session_id"] as? String == sessionID, object["is_error"] as? Bool == false,
              let text = object["result"] as? String, !text.isEmpty else { return nil }
        return text
    }
    private func update(_ id: String, text: String, append: Bool) {
        guard !id.isEmpty, !text.isEmpty else { return }
        if let i = items.firstIndex(where: { $0.0 == id }) {
            items[i].1 = String((append ? items[i].1 + text : text).suffix(24_000))
        } else { items.append((id, String(text.suffix(24_000)))) }
        if items.count > 32 { items.removeFirst(items.count - 32) }
        eventCount += 1
    }
    public func ingestClaude(_ bytes: Data) {
        buffer.append(bytes)
        while let end = buffer.firstIndex(of: 10) {
            let line = buffer[..<end]; buffer.removeSubrange(...end)
            guard let object = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { if !line.isEmpty { claudeStreamDamaged = true }; continue }
            ingestClaudeObject(object)
        }
        if buffer.count > 2_000_000 { claudeStreamDamaged = true; buffer.removeAll() }
    }
    public func finishClaude() {
        if !buffer.isEmpty {
            if let object = try? JSONSerialization.jsonObject(with: buffer) as? [String: Any] { ingestClaudeObject(object) }
            else { claudeStreamDamaged = true }
        }
        buffer.removeAll()
    }
    private func ingestClaudeObject(_ o: [String: Any]) {
        // A known execution binds every supplied session identity. Missing
        // identities in native metadata stay on this owned transport; an
        // explicitly foreign session cannot affect text, counters or finals.
        guard !invalidClaudeBinding else { return }
        if let value = o["session_id"], !(value is String), !(value is NSNull) { claudeStreamDamaged = true; return }
        if let value = o["parent_tool_use_id"], !(value is String), !(value is NSNull) { claudeStreamDamaged = true; return }
        let parent = o["parent_tool_use_id"] as? String
        if let expectedClaudeSessionID, let raw = o["session_id"] as? String,
           UUID(uuidString: raw)?.uuidString.lowercased() != expectedClaudeSessionID {
            // A separate child session is eligible for metadata only when its
            // parent request identity was already observed on this transport.
            // It never makes foreign/root text or a foreign final admissible.
            guard UUID(uuidString: raw) != nil, let parent, Self.safeID(parent),
                  toolStates.contains(where: { $0.key.hasPrefix("claude:") && $0.key.hasSuffix(":" + parent) }) else { return }
        }
        let scope: String
        if let parent {
            guard Self.safeID(parent) else { claudeStreamDamaged = true; return }
            scope = "subagent:" + String(CompletionFeedbackScope.digest(Data(parent.utf8)).prefix(12))
        } else { scope = "main" }
        let type = o["type"] as? String ?? ""
        if type == "system", let subtype = o["subtype"] as? String {
            if subtype == "init" { observeOnce("claude:" + scope + ":init", kind: .ready, scope: scope) }
            if subtype == "api_retry", let number = o["attempt"] as? NSNumber,
               CFGetTypeID(number) != CFBooleanGetTypeID(),
               let attempt = Int(exactly: number.doubleValue), (1...1_000).contains(attempt) {
                observeOnce("claude:" + scope + ":retry:" + String(attempt) + ":" + activeMessage,
                    kind: .retrying, scope: scope)
            }
        }
        if type == "tool_progress", let id = o["tool_use_id"] as? String, Self.safeID(id) {
            let key = "claude:" + scope + ":" + id
            if let state = toolStates[key], !state.returned,
               let number = o["elapsed_time_seconds"] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
               number.doubleValue.isFinite, number.doubleValue >= 0,
               toolProgressValues[key].map({ number.doubleValue > $0 }) ?? true {
                toolProgressValues[key] = number.doubleValue
                observe(.toolWorking, tool: state.name, scope: scope)
            }
        }
        if let content = (o["message"] as? [String: Any])?["content"] as? [[String: Any]] {
            if type == "assistant", content.contains(where: { $0["type"] as? String == "thinking" }) {
                processingObservation(scope: scope) // Never read/store the thinking body.
            }
            for block in content {
                if type == "assistant", ["tool_use", "server_tool_use"].contains(block["type"] as? String ?? ""),
                   let name = block["name"] as? String {
                    toolRequest(id: block["id"] as? String, name: name, scope: scope, provider: "claude")
                } else if type == "user", block["type"] as? String == "tool_result", let id = block["tool_use_id"] as? String {
                    let failureFlag = block["is_error"] as? NSNumber
                    let failed = failureFlag.map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false
                    toolReturn(id: id, scope: scope, provider: "claude", failed: failed)
                }
            }
        }
        if type == "stream_event", let event = o["event"] as? [String: Any] {
            switch event["type"] as? String {
            case "message_start":
                if let id = (event["message"] as? [String: Any])?["id"] as? String, Self.safeID(id) {
                    observeOnce("claude:" + scope + ":start:" + id, kind: .responseStarted, scope: scope)
                }
            case "content_block_start":
                if let block = event["content_block"] as? [String: Any],
                   ["tool_use", "server_tool_use"].contains(block["type"] as? String ?? ""), let name = block["name"] as? String {
                    toolRequest(id: block["id"] as? String, name: name, scope: scope, provider: "claude")
                }
            case "message_stop":
                if scope == "main", !activeMessage.isEmpty {
                    observeOnce("claude:main:stop:" + activeMessage, kind: .responseBoundary, scope: scope)
                }
            case "content_block_delta":
                if let delta = event["delta"] as? [String: Any],
                   ["thinking_delta", "signature_delta"].contains(delta["type"] as? String ?? "") {
                    processingObservation(scope: scope) // Frame presence only; no payload inspection.
                }
            default: break
            }
        }
        // Inspect all tool/subagent events before the UI privacy filter.
        if let m = o["message"] as? [String: Any], o["type"] as? String == "assistant" {
            if o["is_api_error_message"] as? Bool == true, o["error"] as? String == "rate_limit",
               m["model"] as? String == "<synthetic>", Self.zeroClaudeUsage(m["usage"]) {
                quotaRejectionSession = o["session_id"] as? String
            } else { claudeExecutionObserved = true }
        }
        if o["type"] as? String == "stream_event" { claudeExecutionObserved = true }
        if let content = (o["message"] as? [String: Any])?["content"] as? [[String: Any]],
           content.contains(where: { ["tool_use", "tool_result", "server_tool_use"].contains($0["type"] as? String ?? "") }) {
            claudeExecutionObserved = true
        }
        guard o["parent_tool_use_id"] == nil || o["parent_tool_use_id"] is NSNull else { return }
        if type == "result" {
            result = try? JSONSerialization.data(withJSONObject: o)
            resultCount += 1
            turnOpen = false
            return
        }
        if type == "assistant", let m = o["message"] as? [String: Any], let id = m["id"] as? String {
            turnOpen = true
            let content = m["content"] as? [[String: Any]] ?? []
            let text = content.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined(separator: "\n")
            update(id, text: text, append: false)
            return
        }
        guard type == "stream_event", let e = o["event"] as? [String: Any] else { return }
        switch e["type"] as? String {
        case "message_start":
            activeMessage = (e["message"] as? [String: Any])?["id"] as? String ?? ""
            turnOpen = true
        case "content_block_delta":
            if let d = e["delta"] as? [String: Any], d["type"] as? String == "text_delta", let t = d["text"] as? String {
                update(activeMessage, text: t, append: true)
            }
        case "content_block_start":
            break // Content-free metadata was admitted above, with identity deduplication.
        default: break
        }
    }
    public func ingestCodex(_ message: [String: Any], threadID: String, turnID: String) {
        guard let p = message["params"] as? [String: Any], p["threadId"] as? String == threadID,
              p["turnId"] as? String == turnID else { return }
        switch message["method"] as? String {
        case "item/agentMessage/delta":
            if let id = p["itemId"] as? String, let text = p["delta"] as? String { update(id, text: text, append: true) }
        case "item/completed":
            if let i = p["item"] as? [String: Any], i["type"] as? String == "agentMessage",
               let id = i["id"] as? String, let text = i["text"] as? String { update(id, text: text, append: false) }
            if let i = p["item"] as? [String: Any], let name = i["type"] as? String,
               ["commandExecution", "fileChange", "mcpToolCall", "webSearch"].contains(name), let id = i["id"] as? String {
                toolReturn(id: id, scope: "main", provider: "codex", failed: i["status"] as? String == "failed")
            }
        case "item/started":
            if let i = p["item"] as? [String: Any], let name = i["type"] as? String,
               ["commandExecution", "fileChange", "mcpToolCall", "webSearch"].contains(name) {
                toolRequest(id: i["id"] as? String, name: name, scope: "main", provider: "codex")
            }
        default: break
        }
    }

    /// Desktop transport exposes verified turn-item snapshots instead of the
    /// app-server notification stream. Observe actual identity/status changes;
    /// repeating an unchanged poll creates no activity event. A completed item
    /// first seen here creates one returned observation, not a fabricated start.
    public func ingestCodexTurnSnapshot(items snapshot: [[String: Any]], status: String,
                                        threadID: String, turnID: String) {
        guard Self.safeID(threadID), Self.safeID(turnID),
              ["inProgress", "in_progress", "completed", "failed", "interrupted"].contains(status) else { return }
        let identity = threadID + ":" + turnID
        if let bound = codexSnapshotIdentity, bound != identity { return }
        codexSnapshotIdentity = identity
        if ["inProgress", "in_progress"].contains(status) {
            observeOnce("codex:" + identity + ":start", kind: .responseStarted, scope: "main")
        }
        for item in snapshot {
            guard let id = item["id"] as? String, Self.safeID(id), let type = item["type"] as? String else { continue }
            if type == "agentMessage", let text = item["text"] as? String,
               items.first(where: { $0.0 == id })?.1 != text {
                update(id, text: text, append: false)
            }
            guard ["commandExecution", "fileChange", "mcpToolCall", "webSearch"].contains(type) else { continue }
            let itemStatus = item["status"] as? String
            let returned = ["completed", "failed", "declined"].contains(itemStatus ?? "")
            let key = "codex:main:" + id
            if returned, toolStates[key] == nil, toolStates.count < 50_000 {
                toolStates[key] = ToolState(name: type, scope: "main", returned: true)
                toolsRequested += 1; toolsReturned += 1
                observe(itemStatus == "failed" ? .toolFailed : .toolReturned, tool: type)
            } else if returned {
                toolReturn(id: id, scope: "main", provider: "codex", failed: itemStatus == "failed")
            } else if ["inProgress", "in_progress"].contains(itemStatus ?? "") {
                toolRequest(id: id, name: type, scope: "main", provider: "codex")
            } else if itemStatus == nil {
                // Some snapshot tool variants expose an item identity without
                // a lifecycle status. Preserve observed presence only; no
                // requested/returned count or running state is invented.
                observeOnce("codex:" + identity + ":item:" + id, kind: .toolWorking, scope: "main", tool: type)
            }
        }
        if ["completed", "failed", "interrupted"].contains(status) {
            observeOnce("codex:" + identity + ":boundary:" + status, kind: .responseBoundary, scope: "main")
        }
    }
    private static func safeTool(_ name: String) -> Bool {
        NativeExecutionProgress.safeToolName(name)
    }
}
