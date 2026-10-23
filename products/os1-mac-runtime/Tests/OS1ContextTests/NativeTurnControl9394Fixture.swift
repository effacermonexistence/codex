import Foundation
import OS1Context

/// Synthetic protocol tests only; no provider, task grading or live sources.
func nativeTurnControl9394Fixture() throws {
    typealias N = NativeTurnControl
    let thread = "fixture-thread", turn = "fixture-turn", source = "synthetic native input", answer = "synthetic final"
    func binding(_ t: String = "fixture-thread", _ h: String? = nil, _ n: Int? = nil,
                 _ model: String = "fixture-model", _ effort: String = "low") -> N.CurrentBinding {
        .init(threadID: t, providerInputSHA256: h ?? SourceContextStore.digest(Data(source.utf8)),
              providerInputUTF8Bytes: n ?? source.utf8.count, model: model, effort: effort)
    }
    let worlds = ["agents_md", "apps_instructions", "collaboration_mode", "context_window_guidance", "environments", "environments_instructions", "git_attribution", "host_skills", "managed_developer_instructions", "model", "model_catalog", "multi_agent_mode", "multi_agent_usage_hint", "permissions", "persistent_mode", "plugins_instructions", "realtime", "skills"]
    func message(_ role: String, _ id: String, _ text: String, _ kinds: [String], phase: String? = nil) -> [String: Any] {
        var payload: [String: Any] = ["type": "message", "id": id, "role": role,
            "content": [["type": role == "assistant" ? "output_text" : "input_text", "text": text]],
            "internal_chat_message_metadata_passthrough": ["turn_id": turn, "content_item_kinds": kinds]]
        if let phase { payload["phase"] = phase }
        return ["type": "response_item", "payload": payload]
    }
    func event(_ item: [String: Any]) -> [String: Any] {
        ["type": "event_msg", "payload": ["type": "item_completed", "thread_id": thread, "turn_id": turn, "item": item]]
    }
    let base: [[String: Any]] = [
        ["type": "session_meta", "payload": ["id": thread, "cli_version": "0.163.0-alpha.11.1", "model_provider": "openai"]],
        ["type": "event_msg", "payload": ["type": "task_started", "turn_id": turn]],
        message("developer", "context", "context only", ["generic.developer_instructions"]),
        ["type": "world_state", "payload": ["full": true, "state": Dictionary(uniqueKeysWithValues: worlds.map { ($0, NSNull()) })]],
        ["type": "turn_context", "payload": ["turn_id": turn, "model": "fixture-model", "effort": "low"]],
        ["type": "event_msg", "payload": ["type": "thread_settings_applied", "thread_id": thread,
            "thread_settings": ["model": "fixture-model", "model_provider_id": "openai", "reasoning_effort": "low"]]],
        message("user", "raw-user", source, ["user.text"]),
        event(["type": "UserMessage", "id": "echo-user", "content": [["type": "text", "text": source, "text_elements": []]]]),
        event(["type": "Reasoning", "id": "reason", "summary_text": ["PRIVATE_REASONING_SENTINEL"], "raw_content": []]),
        ["type": "response_item", "payload": ["type": "reasoning", "id": "reason", "summary": [], "encrypted_content": "PRIVATE_REASONING_SENTINEL",
            "internal_chat_message_metadata_passthrough": ["turn_id": turn]]],
        event(["type": "AgentMessage", "id": "final", "phase": "final_answer", "content": [["type": "Text", "text": answer]]]),
        message("assistant", "final", answer, ["unknown"], phase: "final_answer"),
        ["type": "token_usage_record", "payload": ["thread_id": thread, "turn_id": turn]],
        ["type": "event_msg", "payload": ["type": "task_complete", "turn_id": turn, "root_turn_id": turn, "last_agent_message": answer]],
    ]
    func bytes(_ rows: [[String: Any]]) throws -> Data {
        var out = Data()
        for row in rows { out.append(try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys])); out.append(10) }
        return out
    }
    func accepted(_ rows: [[String: Any]], _ b: N.CurrentBinding? = binding(), output: String = "synthetic final") -> Bool {
        do { _ = try N.inspect(bytes(rows), provider: "codex", turnID: turn, finalOutput: output, binding: b); return true }
        catch { return false }
    }
    var count = 0
    func check(_ ok: Bool, _ why: String) throws { count += 1; guard ok else { throw NSError(domain: "NativeTurnControl9394", code: count, userInfo: [NSLocalizedDescriptionKey: why]) } }
    try check(accepted(base), "typed current source is accepted with explicit native input binding")
    try check(!accepted(base, nil), "no current binding is HOLD")
    for b in [binding("other"), binding(thread, String(repeating: "0", count: 64)), binding(thread, nil, source.utf8.count + 1),
              binding(thread, nil, nil, "other-model"), binding(thread, nil, nil, "fixture-model", "ultra")] {
        try check(!accepted(base, b), "all explicit coherence axes bind")
    }
    func edit(_ index: Int, _ transform: (inout [String: Any]) -> Void) -> [[String: Any]] {
        var rows = base; var p = rows[index]["payload"] as! [String: Any]; transform(&p); rows[index]["payload"] = p; return rows
    }
    for rows in [edit(0, { $0["cli_version"] = "unknown-next-version" }), edit(0, { $0["id"] = "foreign" }),
                 edit(4, { $0["model"] = "foreign" }), edit(4, { $0["effort"] = "ultra" }),
                 edit(4, { $0["turn_id"] = "foreign" }), edit(5, { $0["thread_id"] = "foreign" }),
                 edit(5, { var s = $0["thread_settings"] as! [String: Any]; s["model"] = "foreign"; $0["thread_settings"] = s }),
                 edit(5, { var s = $0["thread_settings"] as! [String: Any]; s["reasoning_effort"] = "ultra"; $0["thread_settings"] = s }),
                 edit(3, { $0["full"] = 1 }), edit(3, { $0["full"] = false }),
                 edit(3, { var s = $0["state"] as! [String: Any]; s["tool_calls"] = []; $0["state"] = s }),
                 edit(6, { $0["content"] = [["type": "input_text", "text": "other user"]] }),
                 edit(7, { var i = $0["item"] as! [String: Any]; i["content"] = [["type": "text", "text": "other user", "text_elements": []]]; $0["item"] = i }),
                 edit(10, { var i = $0["item"] as! [String: Any]; i["future_action"] = [:]; $0["item"] = i }),
                 edit(10, { var i = $0["item"] as! [String: Any]; i["content"] = []; $0["item"] = i }),
                 edit(11, { $0["content"] = []; var m = $0["internal_chat_message_metadata_passthrough"] as! [String: Any]; m["content_item_kinds"] = []; $0["internal_chat_message_metadata_passthrough"] = m }),
                 edit(11, { $0["future_action"] = [:] }),
                 edit(13, { $0["last_agent_message"] = "other" }), edit(13, { $0["root_turn_id"] = "other" }),
                 edit(13, { $0["future_action"] = [:] })] {
        try check(!accepted(rows), "wrong version, thread, input, tuple or unknown action cannot become zero tools")
    }
    for kind in ["CommandExecution", "DynamicToolCall", "CollabAgentToolCall", "McpToolCall", "WebSearch", "FutureAction"] {
        try check(!accepted(edit(8, { var i = $0["item"] as! [String: Any]; i["type"] = kind; $0["item"] = i })), "typed tool/delegation rejects: " + kind)
    }
    for index in [3, 6, 7, 8, 10, 11, 13] {
        var rows = base; rows.insert(base[index], at: index)
        try check(!accepted(rows), "duplicate lifecycle/data cannot become complete")
        rows = base; rows.remove(at: index)
        try check(!accepted(rows), "missing lifecycle/data cannot become complete")
    }
    var extra = base; extra.insert(message("user", "extra-user", source, ["user.text"]), at: 7)
    try check(!accepted(extra), "second exact same user text is still another user")
    var unknown = base; unknown.insert(["type": "future_record", "payload": [:]], at: 9)
    try check(!accepted(unknown), "unknown top-level type is not ignored")
    let observed = try N.inspect(bytes(base), provider: "codex", turnID: turn, finalOutput: answer, binding: binding())
    let publicBytes = try JSONEncoder().encode(observed)
    try check(!String(decoding: publicBytes, as: UTF8.self).contains("PRIVATE_REASONING_SENTINEL"), "reasoning never escapes")
    var noNewline = try bytes(base); noNewline.removeLast()
    var rejected = false
    do { _ = try N.inspect(noNewline, provider: "codex", turnID: turn, finalOutput: answer, binding: binding()) } catch { rejected = true }
    try check(rejected, "incomplete current source rejects")
    let duplicate = String(decoding: try bytes(base), as: UTF8.self).replacingOccurrences(of: "\"full\":true", with: "\"full\":true,\"full\":true")
    rejected = false
    do { _ = try N.inspect(Data(duplicate.utf8), provider: "codex", turnID: turn, finalOutput: answer, binding: binding()) } catch { rejected = true }
    try check(rejected, "current duplicate keys reject instead of last-key adoption")
    // Optional session-level settings are metadata only. Preserve the public
    // fixture stdout protocol; these additional assertions throw on failure.
    var preStartCount = 0
    func preCheck(_ ok: Bool, _ why: String) throws {
        preStartCount += 1
        guard ok else { throw NSError(domain: "NativeTurnControl9394Preturn", code: preStartCount,
            userInfo: [NSLocalizedDescriptionKey: why]) }
    }
    let sessionSettings = base[5]
    func withPreStart(_ row: [String: Any] = sessionSettings) -> [[String: Any]] {
        var rows = base; rows.insert(row, at: 1); return rows
    }
    func preEdit(_ transform: (inout [String: Any]) -> Void) -> [[String: Any]] {
        var row = sessionSettings, p = row["payload"] as! [String: Any]
        transform(&p); row["payload"] = p; return withPreStart(row)
    }
    try preCheck(accepted(withPreStart()), "one exact session settings snapshot before start is metadata")
    try preCheck(!accepted(withPreStart(), nil), "pre-start metadata cannot replace explicit input binding")
    var preRows = withPreStart(); preRows.insert(sessionSettings, at: 1)
    try preCheck(!accepted(preRows), "duplicate pre-start settings reject")
    for index in [0, 2, 4, 5, 6, 7, 13, 14] {
        preRows = base; preRows.insert(sessionSettings, at: index)
        try preCheck(!accepted(preRows), "settings at an unsupported lifecycle position reject")
    }
    preRows = withPreStart(); preRows.remove(at: 6)
    try preCheck(!accepted(preRows), "pre-start settings never satisfy mandatory in-turn settings")
    for rows in [
        preEdit({ $0["thread_id"] = "foreign" }),
        preEdit({ $0.removeValue(forKey: "thread_id") }),
        preEdit({ $0["turn_id"] = turn }),
        preEdit({ $0["future_action"] = [:] }),
        preEdit({ $0["type"] = "future_event" }),
        preEdit({ $0["type"] = "exec_command_begin" }),
        preEdit({ $0["thread_settings"] = NSNull() }),
        preEdit({ $0["thread_settings"] = [] }),
        preEdit({ $0.removeValue(forKey: "thread_settings") }),
        preEdit({ var s = $0["thread_settings"] as! [String: Any]; s["model"] = "foreign"; $0["thread_settings"] = s }),
        preEdit({ var s = $0["thread_settings"] as! [String: Any]; s["reasoning_effort"] = "ultra"; $0["thread_settings"] = s }),
        preEdit({ var s = $0["thread_settings"] as! [String: Any]; s["model_provider_id"] = "other"; $0["thread_settings"] = s }),
        preEdit({ var s = $0["thread_settings"] as! [String: Any]; s["future_action"] = [:]; $0["thread_settings"] = s }),
        preEdit({ var s = $0["thread_settings"] as! [String: Any]; s.removeValue(forKey: "model"); $0["thread_settings"] = s }),
        preEdit({ var s = $0["thread_settings"] as! [String: Any]; s.removeValue(forKey: "reasoning_effort"); $0["thread_settings"] = s }),
        preEdit({ var s = $0["thread_settings"] as! [String: Any]; s.removeValue(forKey: "model_provider_id"); $0["thread_settings"] = s })
    ] {
        try preCheck(!accepted(rows), "pre-start unknown, foreign, malformed or wrong tuple rejects")
    }
    preRows = withPreStart(); preRows.insert(message("user", "extra-user", source, ["user.text"]), at: 8)
    try preCheck(!accepted(preRows), "pre-start metadata cannot authorize a second user request")
    preRows = withPreStart(); preRows.insert(["type": "response_item", "payload": ["type": "function_call"]], at: 2)
    try preCheck(!accepted(preRows), "pre-start tool remains rejected")
    try preCheck(!accepted(withPreStart(), output: "different"), "pre-start metadata cannot substitute final output")
    for b in [binding("foreign"), binding(thread, String(repeating: "0", count: 64)),
              binding(thread, nil, source.utf8.count + 1), binding(thread, nil, nil, "foreign"),
              binding(thread, nil, nil, "fixture-model", "ultra")] {
        try preCheck(!accepted(withPreStart(), b), "all original native-input/tuple anchors remain mandatory")
    }
    preRows = withPreStart(); var meta = preRows[0]["payload"] as! [String: Any]
    meta["cli_version"] = "future"; preRows[0]["payload"] = meta
    try preCheck(!accepted(preRows), "pre-start variant is not a future-version adapter")
    preRows = withPreStart(); preRows[1]["future_action"] = [:]
    try preCheck(!accepted(preRows), "pre-start snapshot unknown outer keys reject")
    preRows = withPreStart(); preRows[1]["timestamp"] = 123
    try preCheck(!accepted(preRows), "pre-start snapshot malformed outer timestamp rejects")
    preRows = withPreStart(); preRows[1]["ordinal"] = 1; preRows[1]["timestamp"] = "2026-10-23T00:00:00Z"
    try preCheck(accepted(preRows), "known typed ordinal/timestamp metadata is accepted")
    let badOrdinals: [Any] = [0, true, NSNull(), "1", 1.25, 2]
    for ordinal in badOrdinals {
        preRows = withPreStart(); preRows[1]["ordinal"] = ordinal
        try preCheck(!accepted(preRows), "optional ordinal must be the exact non-boolean integer row index")
    }
    try preCheck(preStartCount == 46, "bounded pre-start regression count")
    print("Native current9394 turn control: \(count) synthetic binding/grammar checks PASS; provider/model calls 0")
}
