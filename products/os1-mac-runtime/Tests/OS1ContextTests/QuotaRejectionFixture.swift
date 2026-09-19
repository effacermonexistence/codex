import Foundation
import OS1Context

func runQuotaRejectionFixtures() throws {
    let usage: [String: Any] = ["input_tokens": 0, "output_tokens": 0,
        "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0]
    let assistant: [String: Any] = ["type": "assistant", "session_id": "test",
        "is_api_error_message": true, "error": "rate_limit",
        "message": ["id": "quota", "model": "<synthetic>", "usage": usage,
                    "content": [["type": "text", "text": "You've hit your weekly limit"]]]]
    let result: [String: Any] = ["type": "result", "session_id": "test", "is_error": true,
        "terminal_reason": "api_error", "api_error_status": 429, "num_turns": 1,
        "permission_denials": [], "usage": usage, "result": "You've hit your weekly limit"]
    func stream(_ events: [[String: Any]], damaged: Bool = false) throws -> ExecutionStream {
        let s = ExecutionStream()
        for e in events { s.ingestClaude(try JSONSerialization.data(withJSONObject: e) + Data([10])) }
        if damaged { s.ingestClaude(Data("not-json\n".utf8)) }
        s.finishClaude(); return s
    }
    precondition(UnifiedExecution.claudeTerminalBlocker(status: 0, object: result) == .quotaExhausted)
    var success = result; success["is_error"] = false
    precondition(UnifiedExecution.claudeTerminalBlocker(status: 0, object: success) == nil)
    let clean = try stream([assistant, result])
    precondition(clean.claudeQuotaRejectedBeforeExecution(sessionID: "test"))
    precondition(!clean.claudeQuotaRejectedBeforeExecution(sessionID: "other"))
    let tool: [String: Any] = ["type": "assistant", "parent_tool_use_id": "nested",
        "message": ["content": [["type": "tool_use", "name": "Bash"]]]]
    for events in [[tool, assistant, result], [assistant, result, result], [result]] {
        let s = try stream(events); precondition(!s.claudeQuotaRejectedBeforeExecution(sessionID: "test"))
    }
    let damaged = try stream([assistant, result], damaged: true)
    precondition(!damaged.claudeQuotaRejectedBeforeExecution(sessionID: "test"))
    for (key, value) in [("num_turns", 2 as Any), ("api_error_status", 500 as Any),
                         ("usage", ["input_tokens": 1] as Any), ("permission_denials", ["denied"] as Any)] {
        var changed = result; changed[key] = value
        let s = try stream([assistant, changed]); precondition(!s.claudeQuotaRejectedBeforeExecution(sessionID: "test"))
    }
    precondition(BackendRecovery.permitsAutomaticReplay(permission: "workspace_write", stage: .rejectedBeforeExecution))
    precondition(!BackendRecovery.permitsAutomaticReplay(permission: "workspace_write", stage: .dispatched))
    precondition(BackendRecovery.classifiedBlocker(.quotaExhausted, permission: "workspace_write", stage: .rejectedBeforeExecution, workspaceChanged: true) == .effectsUncertain)
    precondition(BackendRecovery.quotaRecoveryPreference(requested: "auto", failed: "claude", codexAvailable: true, claudeAvailable: true) == "codex")
    precondition(BackendRecovery.quotaRecoveryPreference(requested: "auto", failed: "claude", codexAvailable: false, claudeAvailable: true) == nil)
    print("Quota pre-execution rejection: 17 checks passed")
}
