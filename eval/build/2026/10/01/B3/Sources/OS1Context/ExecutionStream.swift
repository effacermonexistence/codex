import Foundation

/// Only public assistant text and tool lifecycle names are admitted. Thinking,
/// system messages, hooks, tool arguments and tool results never enter the UI.
public final class ExecutionStream {
    private var buffer = Data()
    private var items: [(String, String)] = []
    private var activeMessage = ""
    private var claudeExecutionObserved = false
    private var claudeStreamDamaged = false
    private var quotaRejectionSession: String?

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
    public init() {}
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
        let type = o["type"] as? String ?? ""
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
            if let block = e["content_block"] as? [String: Any], block["type"] as? String == "tool_use",
               let name = block["name"] as? String, Self.safeTool(name) { tool = name; eventCount += 1 }
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
        case "item/started":
            if let i = p["item"] as? [String: Any], let name = i["type"] as? String,
               ["commandExecution", "fileChange", "mcpToolCall", "webSearch"].contains(name) { tool = name; eventCount += 1 }
        default: break
        }
    }
    private static func safeTool(_ name: String) -> Bool {
        name.count <= 80 && name.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) || "_-".unicodeScalars.contains($0) }
    }
}
