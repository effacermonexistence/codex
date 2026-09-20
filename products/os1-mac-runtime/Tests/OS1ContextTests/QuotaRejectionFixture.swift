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
    var added = 0
    for (requested, stage, step, limit, used, expected) in [
        ("auto", BackendDispatchStage.rejectedBeforeExecution, 1, 1, false, 2),
        ("auto", .dispatched, 1, 1, false, 1),
        ("auto", .rejectedBeforeExecution, 2, 2, true, 2),
        ("claude", .rejectedBeforeExecution, 1, 1, false, 1),
        ("auto", .rejectedBeforeExecution, 1, 3, false, 3),
        ("auto", .notDispatched, 1, 1, false, 1)
    ] {
        precondition(BackendRecovery.quotaAttemptLimit(requested: requested, stage: stage,
            step: step, limit: limit, alreadyExtended: used) == expected); added += 1
    }
    // Drive the same bounded loop: rejected Claude dispatch then exactly one
    // Codex write attempt. A second rejection cannot grow the budget again.
    var limit = 1, step = 0, extended = false
    var routed: [String] = []
    var provider = "claude"
    while step < limit {
        step += 1; routed.append(provider)
        let nextLimit = BackendRecovery.quotaAttemptLimit(requested: "auto", stage: .rejectedBeforeExecution,
            step: step, limit: limit, alreadyExtended: extended)
        extended = extended || nextLimit > limit; limit = nextLimit
        if step < limit {
            provider = BackendRecovery.quotaRecoveryPreference(requested: "auto", failed: provider,
                codexAvailable: true, claudeAvailable: false)!
        }
    }
    precondition(routed == ["claude", "codex"] && step == 2 && limit == 2); added += 1
    for text in ["You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.",
                 "You've reached your Fable 5 limit. Run /usage-credits to continue or switch models with /model.",
                 "You’ve reached your Opus limit · resets tomorrow"] {
        var r = result; r["result"] = text
        var a = assistant
        var message = a["message"] as! [String: Any]
        message["content"] = [["type": "text", "text": text]]; a["message"] = message
        precondition(UnifiedExecution.claudeTerminalBlocker(status: 0, object: r) == .quotaExhausted); added += 1
        let parsed = try stream([a, r])
        precondition(parsed.claudeQuotaRejectedBeforeExecution(sessionID: "test")); added += 1
        r["is_error"] = false
        precondition(!BackendRecovery.claudeQuotaFailure(status: 0, object: r)); added += 1
        r["is_error"] = true; r["permission_denials"] = ["denied"]
        precondition(!BackendRecovery.claudeQuotaFailure(status: 1, object: r)); added += 1
    }
    for text in ["The file says: You've reached your Fable limit.", "Your business limit is 10", "OAuth authentication failed"] {
        var r = result; r["result"] = text
        precondition(!BackendRecovery.claudeQuotaFailure(status: 1, object: r)); added += 1
    }
    precondition(BackendRecovery.quotaRecoveryPreference(requested: "claude", failed: "claude", codexAvailable: true, claudeAvailable: true) == nil); added += 1
    print("Quota pre-execution rejection: \(17 + added) checks passed")
}
