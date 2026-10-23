import Foundation
import OS1Context

func nativeTurnControlFixture() throws {
    let turn = "fixture-owned-turn"
    func rows(_ values: [[String: Any]]) throws -> Data {
        var out = Data()
        for x in values { out.append(try JSONSerialization.data(withJSONObject: x, options: [.sortedKeys])); out.append(10) }
        return out
    }
    let start: [String: Any] = ["type": "event_msg", "payload": ["type": "task_started", "turn_id": turn]]
    let final: [String: Any] = ["type": "response_item", "payload": ["type": "message", "role": "assistant", "phase": "final_answer", "content": [["type": "output_text", "text": "{\"source\":\"fixture\"}"]]]]
    let finish: [String: Any] = ["type": "event_msg", "payload": ["type": "task_complete", "turn_id": turn]]
    func accepts(_ values: [[String: Any]], provider: String = "codex", id: String? = turn, output: String = "{\"source\":\"fixture\"}") -> Bool {
        do { _ = try NativeTurnControl.inspect(rows(values), provider: provider, turnID: id, finalOutput: output); return true } catch { return false }
    }
    var count = 0
    func check(_ value: Bool, _ name: String) throws { guard value else { throw NSError(domain: "NativeTurnControlFixture", code: count, userInfo: [NSLocalizedDescriptionKey: name]) }; count += 1 }
    try check(accepts([start, final, finish]), "owned complete zero-tool turn")
    try check(!accepts([start, final]), "EOF is not a terminal event")
    try check(!accepts([final, finish]), "missing start is unresolved")
    try check(!accepts([start, final, finish], id: "foreign"), "foreign turn not evidence")
    try check(!accepts([start, final, finish], output: "different"), "final bytes must match")
    try check(!accepts([start, final, finish], provider: "claude"), "unsupported nil-turn Claude transcript not zero-tools")
    try check(!accepts([start, start, final, finish]), "nested/repeated turn start")
    try check(!accepts([start, final, finish, finish]), "duplicate finish")
    for kind in ["function_call", "custom_tool_call", "function_call_output", "web_search_call", "tool_use", "collab_agent_call", "unknown-new-type"] {
        let tool: [String: Any] = ["type": "response_item", "payload": ["type": kind]]
        try check(!accepts([start, tool, final, finish]), "tool/unknown item rejects: " + kind)
    }
    for kind in ["exec_command_begin", "mcp_tool_call_begin", "agent_spawn", "unknown_event"] {
        let event: [String: Any] = ["type": "event_msg", "payload": ["type": kind]]
        try check(!accepts([start, event, final, finish]), "tool/unknown event rejects: " + kind)
    }
    let reasoning: [String: Any] = ["type": "response_item", "payload": ["type": "reasoning", "summary": []]]
    try check(accepts([start, reasoning, final, finish]), "reasoning body is not inspected or exposed")
    let foreignStart: [String: Any] = ["type": "event_msg", "payload": ["type": "task_started", "turn_id": "prior"]]
    let foreignEnd: [String: Any] = ["type": "event_msg", "payload": ["type": "task_complete", "turn_id": "prior"]]
    let oldTool: [String: Any] = ["type": "response_item", "payload": ["type": "function_call"]]
    try check(accepts([foreignStart, oldTool, foreignEnd, start, final, finish]), "other bounded turn is not attributed to current turn")
    try check(!accepts([oldTool, start, final, finish]), "unframed tool item cannot silently become zero")
    for malformed in [
        "{\"type\":\"event_msg\",\"type\":\"session_meta\",\"payload\":{}}\n",
        "{\"type\":\"event_msg\",\"payload\":{\"type\":\"task_started\",\"type\":\"token_count\"}}\n",
        "not json\n", "{} trailing\n"] {
        var rejected = false
        do { _ = try NativeTurnControl.inspect(Data(malformed.utf8), provider: "codex", turnID: turn, finalOutput: "fixture") }
        catch { rejected = true }
        try check(rejected, "malformed/duplicate JSON must reject")
    }
    print("Native turn control: \(count) synthetic grammar checks PASS; model/provider calls 0")
}
