import Foundation

/// Bounded control evidence for the new source-bound collection family only.
/// This is not the permissive UI progress parser: an unknown protocol cannot
/// certify absence of tools. No reasoning text, tool args or results escape.
public enum NativeTurnControl {
    public enum Failure: String, Error { case unsupportedProvider, malformed, unknownFormat, binding, incomplete, toolObserved }
    public struct Observation: Codable, Equatable, Sendable {
        public let schema: Int
        public let sourceKind: String
        public let sourceSHA256: String
        public let turnID: String
        public let observedRows: Int
        public let completed: Bool
        public let toolRequests: Int
    }
    private struct UniqueJSON {
        let bytes: [UInt8]
        var i = 0
        var count = 0
        init(_ data: Data) { bytes = Array(data) }
        mutating func ws() { while i < bytes.count && [9, 10, 13, 32].contains(bytes[i]) { i += 1 } }
        mutating func string() throws -> String {
            let start = i; guard i < bytes.count && bytes[i] == 34 else { throw Failure.malformed }; i += 1
            while i < bytes.count {
                let c = bytes[i]; i += 1
                if c == 92 { guard i < bytes.count else { throw Failure.malformed }; i += 1 }
                else if c == 34 {
                    guard let result = try JSONSerialization.jsonObject(with: Data(bytes[start..<i]), options: [.fragmentsAllowed]) as? String else { throw Failure.malformed }
                    return result
                }
            }
            throw Failure.malformed
        }
        mutating func value(_ depth: Int) throws {
            count += 1; guard depth <= 32, count <= 300_000 else { throw Failure.malformed }; ws()
            guard i < bytes.count else { throw Failure.malformed }
            if bytes[i] == 34 { _ = try string(); return }
            if bytes[i] == 123 {
                i += 1; ws(); var keys = Set<String>()
                if i < bytes.count && bytes[i] == 125 { i += 1; return }
                while true {
                    ws(); let key = try string(); guard keys.insert(key).inserted else { throw Failure.malformed }
                    ws(); guard i < bytes.count && bytes[i] == 58 else { throw Failure.malformed }; i += 1
                    try value(depth + 1); ws(); guard i < bytes.count else { throw Failure.malformed }
                    let c = bytes[i]; i += 1; if c == 125 { return }; guard c == 44 else { throw Failure.malformed }
                }
            }
            if bytes[i] == 91 {
                i += 1; ws(); if i < bytes.count && bytes[i] == 93 { i += 1; return }
                while true {
                    try value(depth + 1); ws(); guard i < bytes.count else { throw Failure.malformed }
                    let c = bytes[i]; i += 1; if c == 93 { return }; guard c == 44 else { throw Failure.malformed }
                }
            }
            let start = i
            while i < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[i]) { i += 1 }
            guard i > start else { throw Failure.malformed }
        }
        mutating func scan() throws { try value(0); ws(); guard i == bytes.count else { throw Failure.malformed } }
    }
    public static func inspect(_ data: Data, provider: String, turnID: String?, finalOutput: String) throws -> Observation {
        guard provider == "codex" else { throw Failure.unsupportedProvider }
        guard let turnID, !turnID.isEmpty, turnID.utf8.count <= 160,
            !data.isEmpty, data.count <= 64_000_000, data.last == 10 else { throw Failure.incomplete }
        let rows = data.split(separator: 10, omittingEmptySubsequences: true)
        guard !rows.isEmpty, rows.count <= 100_000 else { throw Failure.malformed }
        var active: String?, starts = 0, finishes = 0, observed = 0, finalMessages: [String] = []
        let types: Set<String> = ["session_meta", "turn_context", "event_msg", "response_item", "token_usage_record"]
        let events: Set<String> = ["task_started", "task_complete", "token_count", "agent_message", "agent_reasoning", "user_message"]
        for line in rows {
            guard line.count <= 4_000_000 else { throw Failure.malformed }
            var scanner = UniqueJSON(Data(line)); try scanner.scan()
            guard let object = try JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                let type = object["type"] as? String, types.contains(type), let payload = object["payload"] as? [String: Any]
            else { throw Failure.unknownFormat }
            if type == "event_msg" {
                guard let event = payload["type"] as? String else { throw Failure.malformed }
                if event == "task_started" {
                    guard let id = payload["turn_id"] as? String, active == nil else { throw Failure.binding }
                    if id == turnID { starts += 1; guard starts == 1 && finishes == 0 else { throw Failure.binding } }
                    active = id; continue
                }
                if event == "task_complete" {
                    guard let id = payload["turn_id"] as? String, id == active else { throw Failure.binding }
                    if id == turnID { finishes += 1; guard finishes == 1 else { throw Failure.binding } }
                    active = nil; continue
                }
                if active == turnID {
                    guard events.contains(event) else {
                        if event.contains("tool") || event.contains("exec") || event.contains("agent") || event.contains("search") { throw Failure.toolObserved }
                        throw Failure.unknownFormat
                    }
                    observed += 1
                }
            } else if type == "response_item", active == nil {
                // An unframed tool item cannot be dismissed as another turn.
                guard let item = payload["type"] as? String,
                    ["message", "reasoning"].contains(item) else { throw Failure.binding }
            } else if type == "response_item", active == turnID {
                observed += 1
                guard let item = payload["type"] as? String else { throw Failure.malformed }
                switch item {
                case "function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output", "web_search_call", "tool_use", "tool_result":
                    throw Failure.toolObserved
                case "reasoning": break // Presence only; never inspect its private body.
                case "message":
                    guard let role = payload["role"] as? String, ["user", "assistant", "developer", "system"].contains(role),
                        let content = payload["content"] as? [[String: Any]], content.count <= 256 else { throw Failure.malformed }
                    if role == "assistant" {
                        var text = ""
                        for block in content {
                            guard block["type"] as? String == "output_text", let value = block["text"] as? String else { throw Failure.unknownFormat }
                            text += value
                        }
                        if payload["phase"] as? String == "final_answer" { finalMessages.append(text) }
                        else if payload["phase"] == nil { finalMessages.append(text) }
                        else if payload["phase"] as? String != "commentary" { throw Failure.unknownFormat }
                    }
                default: throw Failure.unknownFormat
                }
            } else if type == "turn_context", active == turnID {
                if let id = payload["turn_id"] as? String, id != turnID { throw Failure.binding }
            } else if type == "token_usage_record", active == turnID {
                guard payload["turn_id"] as? String == turnID else { throw Failure.binding }
            } else if type == "session_meta", active == turnID { throw Failure.unknownFormat }
        }
        guard starts == 1, finishes == 1, active != turnID, observed > 0,
            finalMessages.last == finalOutput else { throw Failure.incomplete }
        return Observation(schema: 1, sourceKind: "codex_owned_turn_rollout_v1", sourceSHA256: SourceContextStore.digest(data),
            turnID: turnID, observedRows: observed, completed: true, toolRequests: 0)
    }
}
