import Foundation

/// Bounded control evidence for the new source-bound collection family only.
/// This is not the permissive UI progress parser: an unknown protocol cannot
/// certify absence of tools. No reasoning text, tool args or results escape.
public enum NativeTurnControl {
    /// Mechanical coherence anchors from the actual pre-dispatch channel and
    /// native session receipt. They grant no execution/quality authority.
    public struct CurrentBinding: Sendable {
        public let threadID: String, providerInputSHA256: String, model: String, effort: String
        public let providerInputUTF8Bytes: Int
        public init(threadID: String, providerInputSHA256: String, providerInputUTF8Bytes: Int, model: String, effort: String) {
            self.threadID = threadID; self.providerInputSHA256 = providerInputSHA256
            self.providerInputUTF8Bytes = providerInputUTF8Bytes; self.model = model; self.effort = effort
        }
    }
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
    public static func inspect(_ data: Data, provider: String, turnID: String?, finalOutput: String,
                               binding: CurrentBinding? = nil) throws -> Observation {
        guard provider == "codex" else { throw Failure.unsupportedProvider }
        guard let turnID, !turnID.isEmpty, turnID.utf8.count <= 160,
            !data.isEmpty, data.count <= 64_000_000, data.last == 10 else { throw Failure.incomplete }
        let rows = data.split(separator: 10, omittingEmptySubsequences: true)
        guard !rows.isEmpty, rows.count <= 100_000 else { throw Failure.malformed }
        // Discriminate typed container tags, not words inside source/prompt text.
        let current = rows.contains { line in
            guard let x = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else { return false }
            return x["type"] as? String == "world_state" ||
                (x["type"] as? String == "event_msg" && ["thread_settings_applied", "item_completed"].contains((x["payload"] as? [String: Any])?["type"] as? String ?? ""))
        }
        if current { return try inspectCurrent(rows, data: data, turnID: turnID, finalOutput: finalOutput, binding: binding) }
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

    /// Explicit bounded adapter for the observed 9394 / 0.163.0-alpha.11.1
    /// persistence grammar. World/context snapshots are data, never actions.
    /// New tags/roles/kinds still fail closed; this is not a model-quality test.
    private static func inspectCurrent(_ rows: [Data.SubSequence], data: Data, turnID: String, finalOutput: String,
                                       binding: CurrentBinding?) throws -> Observation {
        guard let b = binding, !b.threadID.isEmpty, b.threadID.utf8.count <= 160,
            b.providerInputSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
            (1...8_388_608).contains(b.providerInputUTF8Bytes), !b.model.isEmpty, b.model.utf8.count <= 256,
            ["minimal", "low", "medium", "high", "max", "ultra", "xhigh"].contains(b.effort) else { throw Failure.binding }
        var session = 0, preStartSettings = 0, starts = 0, finishes = 0, worlds = 0, contexts = 0, settings = 0, rawUsers = 0, users = 0
        var active = false, ended = false
        var rawReasoning = Set<String>(), eventReasoning = Set<String>()
        var rawAgents: [String: String] = [:], eventAgents: [String: String] = [:]
        var rawFinal: [String] = [], eventFinal: [String] = []
        let worldKeys: Set<String> = ["agents_md", "apps_instructions", "collaboration_mode", "context_window_guidance", "environments", "environments_instructions", "git_attribution", "host_skills", "managed_developer_instructions", "model", "model_catalog", "multi_agent_mode", "multi_agent_usage_hint", "permissions", "persistent_mode", "plugins_instructions", "realtime", "skills"]
        let settingsKeys: Set<String> = ["model", "model_provider_id", "service_tier", "approval_policy", "approvals_reviewer", "permission_profile", "active_permission_profile", "cwd", "runtime_workspace_roots", "reasoning_effort", "reasoning_summary", "personality", "collaboration_mode", "disabled_plugin_ids"]
        let developerKinds: Set<String> = ["generic.developer_instructions", "host_skills.instructions", "permissions.instructions", "collaboration_mode.instructions", "multi_agent.role_instructions", "multi_agent.mode_instructions"]
        func text(_ content: Any?, kind: String) throws -> String {
            guard let blocks = content as? [[String: Any]], !blocks.isEmpty, blocks.count <= 256 else { throw Failure.malformed }
            var value = ""
            for block in blocks {
                let allowed: Set<String> = kind == "output_text" ? ["type", "text", "annotations", "logprobs"] : ["type", "text"]
                guard Set(block.keys).isSubset(of: allowed), block["type"] as? String == kind,
                    let part = block["text"] as? String else { throw Failure.unknownFormat }
                for key in ["annotations", "logprobs"] where block[key] != nil {
                    guard block[key] is [Any] else { throw Failure.unknownFormat }
                }
                value += part
            }
            return value
        }
        func input(_ value: String) throws {
            guard value.utf8.count == b.providerInputUTF8Bytes,
                SourceContextStore.digest(Data(value.utf8)) == b.providerInputSHA256 else { throw Failure.binding }
        }
        for (index, line) in rows.enumerated() {
            guard line.count <= 4_000_000 else { throw Failure.malformed }
            var scanner = UniqueJSON(Data(line)); try scanner.scan()
            guard let x = try JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                let type = x["type"] as? String, let p = x["payload"] as? [String: Any] else { throw Failure.malformed }
            if type == "session_meta" {
                guard index == 0, session == 0, p["id"] as? String == b.threadID,
                    p["cli_version"] as? String == "0.163.0-alpha.11.1", p["model_provider"] as? String == "openai" else { throw Failure.binding }
                session += 1; continue
            }
            guard session == 1, !ended else { throw Failure.binding }
            // The same current CLI may persist one session-settings snapshot
            // immediately after session_meta, before any turn starts. It is
            // typed metadata, not a turn/action; never satisfy `settings` with
            // it. The bound in-turn snapshot below remains mandatory.
            if !active, starts == 0, type == "event_msg", p["type"] as? String == "thread_settings_applied" {
                guard index == 1, preStartSettings == 0,
                    Set(x.keys).isSubset(of: ["timestamp", "ordinal", "type", "payload"]),
                    x["timestamp"] == nil || x["timestamp"] is String,
                    Set(p.keys) == ["type", "thread_id", "thread_settings"], p["thread_id"] as? String == b.threadID,
                    let s = p["thread_settings"] as? [String: Any], Set(s.keys).isSubset(of: settingsKeys),
                    s["model"] as? String == b.model, s["reasoning_effort"] as? String == b.effort,
                    s["model_provider_id"] as? String == "openai" else { throw Failure.binding }
                if let ordinal = x["ordinal"] {
                    guard let n = ordinal as? NSNumber, ["i", "q"].contains(String(cString: n.objCType)),
                        n.int64Value == Int64(index) else { throw Failure.binding }
                }
                preStartSettings += 1; continue
            }
            if type == "event_msg", p["type"] as? String == "task_started" {
                guard !active, starts == 0, p["turn_id"] as? String == turnID,
                    p["root_turn_id"] == nil || p["root_turn_id"] as? String == turnID else { throw Failure.binding }
                active = true; starts += 1; continue
            }
            guard active else { throw Failure.binding }
            switch type {
            case "world_state":
                guard worlds == 0, contexts == 0, Set(p.keys) == ["full", "state"],
                    let full = p["full"] as? NSNumber, String(cString: full.objCType) == "c", full.boolValue,
                    let state = p["state"] as? [String: Any], Set(state.keys) == worldKeys else { throw Failure.unknownFormat }
                worlds += 1
            case "turn_context":
                guard worlds == 1, contexts == 0, p["turn_id"] as? String == turnID,
                    p["root_turn_id"] == nil || p["root_turn_id"] as? String == turnID,
                    p["model"] as? String == b.model, p["effort"] as? String == b.effort else { throw Failure.binding }
                contexts += 1
            case "token_usage_record":
                guard p["thread_id"] as? String == b.threadID, p["turn_id"] as? String == turnID else { throw Failure.binding }
            case "response_item":
                guard let item = p["type"] as? String, let id = p["id"] as? String, !id.isEmpty else { throw Failure.malformed }
                if item == "reasoning" {
                    guard rawUsers == 1, rawReasoning.insert(id).inserted,
                        Set(p.keys).isSubset(of: ["type", "id", "summary", "content", "encrypted_content", "internal_chat_message_metadata_passthrough"]),
                        let metadata = p["internal_chat_message_metadata_passthrough"] as? [String: Any],
                        metadata["turn_id"] as? String == turnID else { throw Failure.binding }
                    // Private reasoning/encrypted content is opaque and never emitted.
                    continue
                }
                guard item == "message", Set(p.keys).isSubset(of: ["type", "id", "role", "content", "phase", "status", "internal_chat_message_metadata_passthrough"]), let role = p["role"] as? String,
                    let metadata = p["internal_chat_message_metadata_passthrough"] as? [String: Any],
                    metadata["turn_id"] as? String == turnID,
                    let kinds = metadata["content_item_kinds"] as? [String],
                    let blocks = p["content"] as? [[String: Any]], kinds.count == blocks.count else { throw Failure.unknownFormat }
                if role == "developer" {
                    guard worlds == 0, !kinds.isEmpty, kinds.allSatisfy(developerKinds.contains) else { throw Failure.unknownFormat }
                    _ = try text(blocks, kind: "input_text")
                } else if role == "user", kinds == ["agents_md.instructions", "environments.environment_context"] {
                    guard worlds == 0 else { throw Failure.binding }
                    _ = try text(blocks, kind: "input_text")
                } else if role == "user", kinds == ["user.text"] {
                    guard worlds == 1, contexts == 1, settings == 1, rawUsers == 0, blocks.count == 1 else { throw Failure.binding }
                    try input(text(blocks, kind: "input_text")); rawUsers += 1
                } else if role == "assistant" {
                    guard rawUsers == 1, !kinds.isEmpty, kinds.allSatisfy({ $0 == "unknown" }), rawAgents[id] == nil,
                        let phase = p["phase"] as? String, ["commentary", "partial_answer", "final_answer"].contains(phase) else { throw Failure.unknownFormat }
                    let value = try text(blocks, kind: "output_text"); rawAgents[id] = value
                    if phase == "final_answer" { rawFinal.append(id) }
                } else { throw Failure.unknownFormat }
            case "event_msg":
                guard let event = p["type"] as? String else { throw Failure.malformed }
                switch event {
                case "thread_settings_applied":
                    guard contexts == 1, settings == 0, p["thread_id"] as? String == b.threadID,
                        let s = p["thread_settings"] as? [String: Any], Set(s.keys).isSubset(of: settingsKeys),
                        s["model"] as? String == b.model, s["reasoning_effort"] as? String == b.effort,
                        s["model_provider_id"] as? String == "openai" else { throw Failure.binding }
                    settings += 1
                case "item_completed":
                    guard rawUsers == 1, p["thread_id"] as? String == b.threadID, p["turn_id"] as? String == turnID,
                        Set(p.keys).isSubset(of: ["type", "thread_id", "turn_id", "item", "started_at_ms", "completed_at_ms"]),
                        let i = p["item"] as? [String: Any], let kind = i["type"] as? String,
                        let id = i["id"] as? String, !id.isEmpty else { throw Failure.binding }
                    switch kind {
                    case "UserMessage":
                        guard users == 0, Set(i.keys).isSubset(of: ["type", "id", "client_id", "content"]),
                            let content = i["content"] as? [[String: Any]], content.count == 1,
                            Set(content[0].keys) == ["type", "text", "text_elements"], content[0]["type"] as? String == "text",
                            let value = content[0]["text"] as? String, let elements = content[0]["text_elements"] as? [Any], elements.isEmpty else { throw Failure.binding }
                        try input(value); users += 1
                    case "Reasoning":
                        guard eventReasoning.insert(id).inserted, Set(i.keys).isSubset(of: ["type", "id", "summary_text", "raw_content"]) else { throw Failure.binding }
                    case "AgentMessage":
                        guard eventAgents[id] == nil, Set(i.keys) == ["type", "id", "content", "phase"], let phase = i["phase"] as? String,
                            ["commentary", "partial_answer", "final_answer"].contains(phase) else { throw Failure.unknownFormat }
                        eventAgents[id] = try text(i["content"], kind: "Text")
                        if phase == "final_answer" { eventFinal.append(id) }
                    default: throw Failure.toolObserved
                    }
                case "token_count": break
                case "task_complete":
                    guard p["turn_id"] as? String == turnID, finishes == 0,
                        Set(p.keys).isSubset(of: ["type", "root_turn_id", "turn_id", "last_agent_message", "started_at", "completed_at", "duration_ms", "time_to_first_token_ms"]) else { throw Failure.binding }
                    if let root = p["root_turn_id"], !(root is NSNull) { guard root as? String == turnID else { throw Failure.binding } }
                    if let last = p["last_agent_message"], !(last is NSNull) { guard last as? String == finalOutput else { throw Failure.binding } }
                    finishes += 1; active = false; ended = true
                default: throw Failure.unknownFormat
                }
            default: throw Failure.unknownFormat
            }
        }
        guard starts == 1, finishes == 1, worlds == 1, contexts == 1, settings == 1, rawUsers == 1, users == 1,
            rawReasoning == eventReasoning, rawAgents == eventAgents, rawFinal.count == 1, eventFinal == rawFinal,
            rawAgents[rawFinal[0]] == finalOutput else { throw Failure.incomplete }
        return Observation(schema: 1, sourceKind: "codex_owned_turn_rollout_9394_v1", sourceSHA256: SourceContextStore.digest(data),
            turnID: turnID, observedRows: rows.count - 1, completed: true, toolRequests: 0)
    }
}
