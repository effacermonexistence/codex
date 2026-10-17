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
    // Every limit sentence the Claude CLI 2.1.263 prints (oO/zSo/upn templates).
    let cliLimitTexts = [
        "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue.",
        "You've reached your Fable 5 limit. Run /usage-credits to continue or switch models with /model.",
        "You’ve reached your Opus limit · resets tomorrow",
        "You've hit your Opus limit · resets Sep 30 at 5pm (America/Los_Angeles)",
        "You've hit your Sonnet limit · resets Sep 30 at 5pm (America/Los_Angeles) · progress saved",
        "You've hit your Fable limit · resets Sep 30 at 5pm (America/Los_Angeles)",
        "You've hit your usage limit · resets 4pm",
        "You've hit your limit · resets 4pm",
        "You've hit your monthly spend limit. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.",
        "You've hit your monthly spend limit · raise it at claude.ai/settings/usage",
        "Fable 5 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.",
        "You're out of usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.",
        "You're out of usage credits · resets 5pm",
        "You're out of extra usage",
        "Your org is out of usage · add funds to continue",
        "Your seat type doesn't include usage credits",
        "Your usage allocation has been disabled by your admin · ask your admin for a higher limit",
        "Your group's usage limit is set to $0 · ask your admin for a higher limit",
        "This service is disabled for your org",
    ]
    for text in cliLimitTexts {
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
    for text in ["The file says: You've reached your Fable limit.", "Your business limit is 10", "OAuth authentication failed",
                 "Note: Fable 5 requires usage credits.", "Your organization chart is out of date", "You've hit your stride today"] {
        var r = result; r["result"] = text
        precondition(!BackendRecovery.claudeQuotaFailure(status: 1, object: r)); added += 1
    }
    precondition(BackendRecovery.quotaRecoveryPreference(requested: "claude", failed: "claude", codexAvailable: true, claudeAvailable: true) == nil); added += 1
    // Scope: only the CLI's own named-model sentence for the dispatched family is model-scoped.
    let fableText = "You've reached your Fable limit. Switch to another model, or manage usage credits at claude.ai/settings/usage?from=cc_cli_limit_message, to continue."
    func scope(_ text: String, _ model: String?, errors: [String] = []) -> ClaudeQuotaScope? {
        var r = result; r["result"] = text
        if !errors.isEmpty { r["errors"] = errors }
        return BackendRecovery.claudeQuotaScope(status: 1, object: r, dispatchedModel: model)
    }
    let scopes: [(String, String?, ClaudeQuotaScope?)] = [
        (fableText, "fable", .model("fable")),
        (fableText, "claude-fable-5-1[1m]", .model("fable")),
        ("OS1 재확인합니다.\n\n" + fableText, "fable", .model("fable")),
        ("You've reached your Fable 5 limit. Run /usage-credits to continue or switch models with /model.", "claude-fable-5-20260801", .model("fable")),
        ("You’ve reached your Opus limit · resets tomorrow", "opus[1m]", .model("opus")),
        ("You've reached your Claude Sonnet limit.", "sonnet", .model("sonnet")),
        (fableText, "opus", .account),
        (fableText, nil, .account),
        ("You've hit your session limit · resets 4:40pm (America/Los_Angeles)", "fable", .account),
        ("You've hit your weekly limit · resets Sep 20 at 5pm (America/Los_Angeles)", "fable", .account),
        ("You've reached your weekly limit.", "fable", .account),
        ("You've reached your usage limit.", "fable", .account),
        ("You've reached your Fable weekly limit.", "fable", .account),
        (fableText + "\nYou've hit your session limit · resets 4:40pm (America/Los_Angeles)", "fable", .account),
        ("rate_limit_error", "fable", .account),
        ("The file says: You've reached your Fable limit.", "fable", nil),
        ("You've hit your Opus limit · resets Sep 30 at 5pm (America/Los_Angeles)", "opus[1m]", .model("opus")),
        ("You've hit your Sonnet limit · resets Sep 30 at 5pm (America/Los_Angeles) · progress saved", "sonnet", .model("sonnet")),
        ("You've hit your Fable limit · resets Sep 30 at 5pm (America/Los_Angeles)", "fable", .model("fable")),
        ("You've hit your Opus limit · resets Sep 30 at 5pm (America/Los_Angeles)", "sonnet", .account),
        ("Fable 5 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.", "fable", .model("fable")),
        ("Fable 5 requires usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.", "opus", .account),
        ("You're out of usage credits. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.", "fable", .model("fable")),
        ("You've hit your monthly spend limit. Switch to another model, or manage usage credits at claude.ai/settings/usage, to continue.", "claude-fable-5-1[1m]", .model("fable")),
        ("You're out of usage credits · resets 5pm", "fable", .account),
        ("You've hit your monthly spend limit · raise it at claude.ai/settings/usage", "fable", .account),
        ("You've hit your usage limit · resets 4pm", "fable", .account),
        ("You've hit your limit · resets 4pm", "fable", .account),
        ("You've hit your usage credit limit", "fable", .account),
        ("Your org is out of usage · add funds to continue", "fable", .account),
        ("Your seat type doesn't include usage credits", "fable", .account),
        ("Your usage allocation has been disabled by your admin", "fable", .account),
        ("This service is disabled for your org", "fable", .account),
        ("You've reached your Fable 5.1 limit.", "fable", .model("fable")),
        ("You've reached your Fable five hour limit.", "fable", .account),
        ("You've reached your Fable 4h limit.", "fable", .account),
        ("You've reached your Fable Max limit.", "fable", .account),
        ("You've reached your Fable Team limit.", "fable", .account),
        ("You've reached your Fable limit.\r\nSwitch to another model, or manage usage credits at claude.ai/settings/usage, to continue.", "fable", .model("fable")),
        (fableText + "\nYou've reached your weekly limit.", "fable", .account),
        (fableText + "\nYou've reached your 5-hour limit.", "fable", .account),
        (fableText + "\nYou've hit your usage limit · resets 4pm", "fable", .account),
        (fableText + "\nYour org is out of usage · contact your admin", "fable", .account),
        (fableText + "\nYou're out of usage credits · resets 5pm", "fable", .account),
        (fableText + "\nYou've hit your monthly spend limit · raise it at claude.ai/settings/usage", "fable", .account),
        ("You're out of usage credits · resets 5pm\nSwitch to another model, or manage usage credits at claude.ai/settings/usage, to continue.", "fable", .account),
        (fableText + "\nNote: you've hit your weekly limit", "fable", .account),
        (fableText, "../x", .account),
        (fableText, "Fable", .model("fable")),
    ]
    for (text, model, expected) in scopes {
        precondition(scope(text, model) == expected, "quota scope: \(text) / \(model ?? "nil")"); added += 1
    }
    precondition(scope(fableText, "fable", errors: ["insufficient_quota"]) == .account); added += 1
    precondition(scope(fableText, "fable", errors: ["rate_limit_error"]) == .model("fable")); added += 1
    precondition(scope(fableText, "fable", errors: ["You've reached your weekly limit."]) == .account); added += 1
    precondition(scope(fableText, "fable", errors: [fableText]) == .model("fable")); added += 1
    // A family that could not name its own receipt file is never model-scoped.
    for (family, valid) in [("fable", true), ("opus", true), ("gpt-5.6", true), ("fable\n", false), ("../x", false),
                            ("", false), ("Fable", false), ("-x", false), (String(repeating: "a", count: 33), false)] {
        precondition(ClaudeQuotaBackoff.validFamily(family) == valid, "family \(family.debugDescription)"); added += 1
    }
    var answered = result; answered["result"] = fableText; answered["is_error"] = false
    precondition(BackendRecovery.claudeQuotaScope(status: 0, object: answered, dispatchedModel: "fable") == nil); added += 1
    var denied = result; denied["result"] = fableText; denied["permission_denials"] = ["denied"]
    precondition(BackendRecovery.claudeQuotaScope(status: 1, object: denied, dispatchedModel: "fable") == nil); added += 1
    for (model, family) in [("fable", "fable"), ("fable[1m]", "fable"), ("claude-fable-5-1[1m]", "fable"),
                            ("claude-opus-5[1m]", "opus"), ("Sonnet", "sonnet")] {
        precondition(BackendRecovery.claudeModelFamily(model) == family); added += 1
    }
    // A model-scoped limit keeps the remaining Claude catalog routable; account limits are unchanged.
    for (scoped, codex, claude, requested, expected) in [
        (true, true, true, "auto", "auto" as String?), (true, false, true, "auto", "claude"),
        (true, true, false, "auto", "codex"), (true, false, false, "auto", nil),
        (false, true, true, "auto", "codex"), (true, true, true, "claude", "claude"),
        (true, false, true, "claude", "claude"), (true, true, false, "claude", nil), (false, true, true, "claude", nil)
    ] {
        precondition(BackendRecovery.quotaRecoveryPreference(requested: requested, failed: "claude", modelScoped: scoped,
            codexAvailable: codex, claudeAvailable: claude) == expected); added += 1
    }
    // A pinned Claude run gets the extra slot only for a model-scoped limit.
    for (scoped, expected) in [(true, 2), (false, 1)] {
        precondition(BackendRecovery.quotaAttemptLimit(requested: "claude", stage: .rejectedBeforeExecution,
            step: 1, limit: 1, alreadyExtended: false, modelScoped: scoped) == expected); added += 1
    }
    precondition(BackendRecovery.quotaAttemptLimit(requested: "claude", stage: .dispatched,
        step: 1, limit: 1, alreadyExtended: false, modelScoped: true) == 1); added += 1
    precondition(BackendRecovery.quotaAttemptLimit(requested: "codex", stage: .rejectedBeforeExecution,
        step: 1, limit: 1, alreadyExtended: false, modelScoped: true) == 1); added += 1
    // The run's real decision after one rejection (main.swift applies it verbatim).
    let all = ["fable", "opus", "sonnet"]
    let rerouteCases: [(String, ClaudeQuotaScope?, String, [String], Bool, Set<String>, QuotaReroute)] = [
        ("claude", .model("fable"), "auto", all, true, [],
         QuotaReroute(claudeModels: ["opus", "sonnet"], unavailable: [], nextPreference: "auto")),
        ("claude", .model("fable"), "auto", all, false, [],
         QuotaReroute(claudeModels: ["opus", "sonnet"], unavailable: [], nextPreference: "claude")),
        ("claude", .model("fable"), "claude", all, true, [],
         QuotaReroute(claudeModels: ["opus", "sonnet"], unavailable: [], nextPreference: "claude")),
        ("claude", .model("fable"), "auto", ["claude-fable-5-1[1m]", "opus"], true, [],
         QuotaReroute(claudeModels: ["opus"], unavailable: [], nextPreference: "auto")),
        ("claude", .model("fable"), "auto", ["fable"], true, [],
         QuotaReroute(claudeModels: [], unavailable: ["claude"], nextPreference: "codex")),
        ("claude", .model("fable"), "claude", ["fable"], true, [],
         QuotaReroute(claudeModels: [], unavailable: ["claude"], nextPreference: nil)),
        ("claude", .account, "auto", all, true, [],
         QuotaReroute(claudeModels: [], unavailable: ["claude"], nextPreference: "codex")),
        ("claude", .account, "auto", all, false, [],
         QuotaReroute(claudeModels: [], unavailable: ["claude"], nextPreference: nil)),
        ("claude", .account, "claude", all, true, [],
         QuotaReroute(claudeModels: [], unavailable: ["claude"], nextPreference: nil)),
        ("claude", nil, "auto", all, true, [],
         QuotaReroute(claudeModels: [], unavailable: ["claude"], nextPreference: "codex")),
        ("codex", nil, "auto", all, false, ["codex"],
         QuotaReroute(claudeModels: all, unavailable: ["codex"], nextPreference: "claude")),
        ("codex", nil, "codex", all, true, [],
         QuotaReroute(claudeModels: all, unavailable: [], nextPreference: nil)),
    ]
    for (failed, scope, requested, models, codex, unavailable, expected) in rerouteCases {
        let decided = BackendRecovery.quotaReroute(failed: failed, scope: scope, requested: requested, claudeModels: models,
            codexAvailable: codex, claudeExecutable: true, unavailable: unavailable)
        precondition(decided == expected, "reroute \(failed)/\(String(describing: scope))/\(requested)"); added += 1
    }
    // Drive the loop with the same decision for Auto and for a pinned Claude run:
    // one Fable rejection before execution gets one extra slot and re-routes over
    // the remaining Claude models, never back to Fable; a pinned run never to Codex.
    for requested in ["auto", "claude"] {
        var fableResult = result; fableResult["result"] = fableText
        var catalog = all, routedModels: [String] = [], unavailable = Set<String>()
        var limit = 1, step = 0, extended = false, dispatched = "fable", preference = requested
        while step < limit {
            step += 1; routedModels.append(dispatched)
            guard dispatched == "fable" else { break } // the re-routed model runs
            let scope = BackendRecovery.claudeQuotaScope(status: 1, object: fableResult, dispatchedModel: dispatched)
            let next = BackendRecovery.quotaAttemptLimit(requested: requested, stage: .rejectedBeforeExecution,
                step: step, limit: limit, alreadyExtended: extended, modelScoped: scope.map { $0 != .account } ?? false)
            extended = extended || next > limit; limit = next
            let decided = BackendRecovery.quotaReroute(failed: "claude", scope: scope, requested: requested,
                claudeModels: catalog, codexAvailable: true, claudeExecutable: true, unavailable: unavailable)
            catalog = decided.claudeModels; unavailable = decided.unavailable
            guard step < limit, let nextPreference = decided.nextPreference else { break }
            preference = nextPreference
            dispatched = catalog[0] // any tuple the router may still be offered
        }
        precondition(routedModels == ["fable", "opus"] && limit == 2 && catalog == ["opus", "sonnet"]
            && preference == (requested == "auto" ? "auto" : "claude") && unavailable.isEmpty, "loop \(requested)"); added += 1
    }
    print("Quota pre-execution rejection: \(17 + added) checks passed")
}
