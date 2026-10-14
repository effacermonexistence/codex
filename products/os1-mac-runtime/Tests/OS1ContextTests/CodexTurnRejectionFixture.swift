import Foundation
import OS1Context

/// The Codex rate/usage-limit classification table, the no-work proof of a
/// rejected turn, the bounded model cooldown it leaves for the next catalog,
/// and the sanitized cause an interrupted attempt persists. Pure
/// observations plus one private temporary directory: no provider, account,
/// model, gateway or live state is touched.
func runCodexTurnRejectionFixtures() throws {
    typealias R = CodexTurnRejection
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "CodexTurnRejectionFixture", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    // The incident's own error (2026-10-14 08:38 UTC, gpt-6-astra/max): Codex
    // retried, every request was refused with HTTP 429, no output.
    let incidentMessage = "exceeded retry limit, last status: 429 Too Many Requests"
    let incident: [String: Any] = ["message": incidentMessage,
        "codexErrorInfo": ["responseTooManyFailedAttempts": ["httpStatusCode": 429]]]

    // ---- Classification table ---------------------------------------------
    let table: [(String, [String: Any], String?)] = [
        ("incident: retries exhausted on 429", incident, "response_too_many_failed_attempts_429"),
        ("rollout spelling of the same class", ["message": incidentMessage,
            "codex_error_info": ["response_too_many_failed_attempts": ["http_status_code": 429]]],
            "response_too_many_failed_attempts_429"),
        ("retries exhausted on 500 is not a limit", ["message": "exceeded retry limit, last status: 500",
            "codexErrorInfo": ["responseTooManyFailedAttempts": ["httpStatusCode": 500]]], nil),
        ("retries exhausted without a status is not a limit", ["message": incidentMessage,
            "codexErrorInfo": ["responseTooManyFailedAttempts": ["httpStatusCode": NSNull()]]], nil),
        ("connection refused with 429", ["message": "x",
            "codexErrorInfo": ["httpConnectionFailed": ["httpStatusCode": 429]]], "http_connection_failed_429"),
        ("stream connection refused with 429", ["message": "x",
            "codexErrorInfo": ["responseStreamConnectionFailed": ["httpStatusCode": 429]]],
            "response_stream_connection_failed_429"),
        ("a stream that disconnected mid-turn may have streamed", ["message": "429",
            "codexErrorInfo": ["responseStreamDisconnected": ["httpStatusCode": 429]]], nil),
        ("usage limit", ["message": "You've hit your usage limit.", "codexErrorInfo": "usageLimitExceeded"],
            "usage_limit_exceeded"),
        ("usage limit, legacy capitalisation", ["codexErrorInfo": "UsageLimitExceeded"], "usage_limit_exceeded"),
        ("usage limit, snake case", ["codexErrorInfo": "usage_limit_exceeded"], "usage_limit_exceeded"),
        ("rate limit", ["message": "Rate limit reached", "codexErrorInfo": "rateLimitExceeded"], "rate_limit_exceeded"),
        ("overloaded is no limit", ["message": "429", "codexErrorInfo": "serverOverloaded"], nil),
        ("internal error is no limit", ["codexErrorInfo": "internalServerError"], nil),
        ("context overflow is no limit", ["codexErrorInfo": "contextWindowExceeded"], nil),
        ("authentication is no limit", ["codexErrorInfo": "unauthorized"], nil),
        ("a non-steerable turn is no limit", ["codexErrorInfo": ["activeTurnNotSteerable": ["turnKind": "review"]]], nil),
        ("no structured class: the provider's message names 429", ["message": incidentMessage], "http_429"),
        ("class other: the provider's message names a usage limit", ["message": "You've hit your usage limit",
            "codexErrorInfo": "other"], "usage_limit_message"),
        ("no structured class and no limit words", ["message": "stream disconnected before completion"], nil),
        ("null class falls back to the message", ["message": "status code 429", "codexErrorInfo": NSNull()], "http_429"),
    ]
    for (label, error, expected) in table {
        try check(R.limitClass(error: error) == expected, "classification: \(label): \(String(describing: R.limitClass(error: error)))")
    }

    // ---- No-work proof ------------------------------------------------------
    let user: [String: Any] = ["type": "userMessage", "id": "u", "content": []]
    func turn(status: String = "failed", error: [String: Any]? = incident, items: [[String: Any]] = [user],
              view: String? = nil) -> [String: Any] {
        var value: [String: Any] = ["id": "turn-1", "status": status, "items": items]
        if let error { value["error"] = error }
        if let view { value["itemsView"] = view }
        return value
    }
    func evidence(_ messages: [[String: Any]]) -> R.WorkEvidence {
        var work = R.WorkEvidence()
        for message in messages { work.observe(message, threadID: "thread-1", turnID: "turn-1") }
        return work
    }
    func note(_ method: String, _ params: [String: Any] = [:], turn: String = "turn-1", thread: String = "thread-1",
              id: Int? = nil) -> [String: Any] {
        var all = params; all["turnId"] = turn; all["threadId"] = thread
        var value: [String: Any] = ["jsonrpc": "2.0", "method": method, "params": all]
        if let id { value["id"] = id }
        return value
    }
    // What the incident's turn streamed: its own input, Codex's retry
    // notices, and the failure. No work.
    let quiet = evidence([note("turn/started"), note("item/started", ["item": user]), note("item/completed", ["item": user]),
        note("error", ["error": incident, "willRetry": true]), note("hook/started"), note("hook/completed"),
        note("warning", ["message": "w"]), note("thread/tokenUsage/updated",
            ["tokenUsage": ["last": ["totalTokens": 0], "total": ["totalTokens": 9]]]),
        ["jsonrpc": "2.0", "method": "account/rateLimits/updated", "params": ["rateLimits": [:]]],
        note("item/agentMessage/delta", ["delta": "other turn"], turn: "turn-0"),
        note("item/agentMessage/delta", ["delta": "other thread"], thread: "thread-0"),
        note("turn/completed", ["turn": turn()])])
    try check(!quiet.observed, "the incident's stream shows no work of its own")
    try check(R.rejectedBeforeExecution(turn: turn(), evidence: quiet), "the incident shape is a pre-execution rejection")
    for (label, message) in [
        ("an agent message delta", note("item/agentMessage/delta", ["delta": "Sure"])),
        ("a reasoning item", note("item/started", ["item": ["type": "reasoning", "id": "r"]])),
        ("a reasoning delta", note("item/reasoning/textDelta", ["delta": "hm"])),
        ("a plan", note("turn/plan/updated", ["plan": []])),
        ("a tool call", note("item/started", ["item": ["type": "mcpToolCall", "id": "t"]])),
        ("a command output", note("item/commandExecution/outputDelta", ["delta": "x"])),
        ("a diff", note("turn/diff/updated", ["diff": ""])),
        ("a compaction", note("thread/compacted")),
        ("tokens counted for this turn", note("thread/tokenUsage/updated", ["tokenUsage": ["last": ["totalTokens": 12]]])),
        ("an unreadable token count", note("thread/tokenUsage/updated")),
        ("an approval request (the model proposed work)", note("item/commandExecution/requestApproval", id: 7)),
        ("an unknown turn-scoped notification", note("item/somethingNew/delta")),
    ] {
        let work = evidence([message])
        try check(work.observed, "work: \(label)")
        try check(!R.rejectedBeforeExecution(turn: turn(), evidence: work), "\(label) is never a no-work rejection")
    }
    // ---- Turn errors streamed before the final one (review, 2026-10-14) ----
    // A response stream that DISCONNECTED mid-turn means a request was
    // accepted (it may have been processed and billed) even when every later
    // retry got HTTP 429: never a pre-execution rejection.
    let disconnect: [String: Any] = ["message": "stream disconnected before completion",
        "codexErrorInfo": ["responseStreamDisconnected": ["httpStatusCode": NSNull()]]]
    let disconnected = evidence([note("item/started", ["item": user]), note("error", ["error": disconnect, "willRetry": true]),
        note("error", ["error": incident, "willRetry": true]), note("error", ["error": incident, "willRetry": false]),
        note("turn/completed", ["turn": turn()])])
    try check(disconnected.observed && !R.rejectedBeforeExecution(turn: turn(), evidence: disconnected),
              "a mid-turn disconnect before the 429 retries is work")
    for (label, params) in [
        ("an overloaded server", ["error": ["message": "429", "codexErrorInfo": "serverOverloaded"], "willRetry": true]),
        ("a 500 that was retried", ["error": ["message": "x", "codexErrorInfo": ["responseStreamConnectionFailed":
            ["httpStatusCode": 500]]], "willRetry": true]),
        ("an error without limit words", ["error": ["message": "stream error"], "willRetry": true]),
        ("an error notification without its error", ["willRetry": true]),
    ] as [(String, [String: Any])] {
        try check(evidence([note("error", params)]).observed, "work: a turn error that is no limit rejection: \(label)")
    }
    // Retry notices that are themselves limit rejections stay quiet.
    let refusals = evidence([note("error", ["error": ["message": "x", "codexErrorInfo": ["responseStreamConnectionFailed":
            ["httpStatusCode": 429]]], "willRetry": true]),
        note("error", ["error": ["message": "Reconnecting... 2/5 (429 Too Many Requests)"], "willRetry": true]),
        note("error", ["error": incident, "willRetry": false])])
    try check(!refusals.observed && R.rejectedBeforeExecution(turn: turn(), evidence: refusals),
              "limit refusals while Codex retries are no work")

    // ---- A resumed thread's stale usage replay (review, 2026-10-14) -------
    // On a thread with usage, a usage-limit refusal still emits one usage
    // update that replays the previous turn's numbers (2026-09-07 rollout,
    // turn ...1fceea: total 904229078, last 119644; 2026-08-20 rollout, six
    // turns: total 2128549997, last 169744). No total growth is no work.
    let usageLimit: [String: Any] = ["message": "You've hit your usage limit.", "codexErrorInfo": "usageLimitExceeded"]
    func replayed(_ total: Int, _ last: Int) -> [String: Any] {
        note("thread/tokenUsage/updated", ["tokenUsage": ["total": ["totalTokens": total], "last": ["totalTokens": last]]])
    }
    func measured(_ baseline: Int?, _ messages: [[String: Any]]) -> R.WorkEvidence {
        var work = R.WorkEvidence(baselineTotalTokens: baseline)
        for message in messages { work.observe(message, threadID: "thread-1", turnID: "turn-1") }
        return work
    }
    for (total, last) in [(904_229_078, 119_644), (2_128_549_997, 169_744)] {
        let replay = measured(total, [note("item/started", ["item": user]), note("item/completed", ["item": user]),
            replayed(total, last), note("error", ["error": usageLimit, "willRetry": false])])
        try check(!replay.observed && R.rejectedBeforeExecution(turn: turn(error: usageLimit), evidence: replay),
                  "a stale usage replay on a resumed thread is no work: \(total)")
        try check(measured(nil, [replayed(total, last)]).observed, "no baseline: nonzero usage stays work (\(total))")
        try check(measured(total - 1, [replayed(total, last)]).observed, "usage that grew past the baseline is work (\(total))")
    }
    try check(measured(904_229_078, [note("thread/tokenUsage/updated", ["tokenUsage": ["last": ["totalTokens": 119_644]]])]).observed,
              "an unreadable total stays work even with a baseline")
    // The baseline of a resumed thread: its rollout's last token_count.
    let rollouts = FileManager.default.temporaryDirectory.appendingPathComponent("os1-codex-rollout-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: rollouts, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: rollouts) }
    func rollout(_ name: String, _ lines: [String]) throws -> String {
        let url = rollouts.appendingPathComponent(name)
        try Data((lines.joined(separator: "\n") + "\n").utf8).write(to: url)
        return url.path
    }
    let count = #"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"total_tokens":904229078},"last_token_usage":{"total_tokens":119644}}}}"#
    let resumed = try rollout("resumed.jsonl", [#"{"type":"session_meta","payload":{"id":"t"}}"#,
        #"{"type":"event_msg","payload":{"type":"token_count","info":null}}"#, count,
        #"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"token_count"}]}}"#,
        #"{"type":"event_msg","payload":{"type":"task_complete"}}"#])
    try check(R.rolloutTotalTokens(path: resumed) == 904_229_078, "the last token_count is the baseline")
    let early = try rollout("early.jsonl", [count, String(repeating: "x", count: 4_096)])
    try check(R.rolloutTotalTokens(path: early, tailBytes: 1_024) == nil && R.rolloutTotalTokens(path: early) == 904_229_078,
              "only the bounded tail is read; outside it the baseline is unknown")
    try check(R.rolloutTotalTokens(path: rollouts.appendingPathComponent("missing.jsonl").path) == nil &&
              R.rolloutTotalTokens(path: try rollout("fresh.jsonl", [#"{"type":"session_meta","payload":{}}"#])) == nil,
              "no rollout or no usage yet: unknown")

    let none = R.WorkEvidence()
    for (label, value) in [
        ("an agent message item", turn(items: [user, ["type": "agentMessage", "id": "a", "text": ""]])),
        ("a reasoning item", turn(items: [user, ["type": "reasoning", "id": "r"]])),
        ("a command item", turn(items: [user, ["type": "commandExecution", "id": "c", "status": "failed"]])),
        ("items not loaded", turn(items: [], view: "notLoaded")),
        ("a summary item view", turn(items: [user], view: "summary")),
        ("an interrupted turn", turn(status: "interrupted")),
        ("a completed turn", turn(status: "completed", error: nil)),
        ("a non-limit failure", turn(error: ["message": "boom", "codexErrorInfo": "internalServerError"])),
        ("no error", turn(error: nil)),
    ] {
        try check(!R.rejectedBeforeExecution(turn: value, evidence: none), "not before execution: \(label)")
    }
    var missingItems = turn(); missingItems.removeValue(forKey: "items")
    try check(!R.rejectedBeforeExecution(turn: missingItems, evidence: none), "a turn without items proves nothing")
    try check(R.rejectedBeforeExecution(turn: turn(view: "full"), evidence: none) &&
              R.rejectedBeforeExecution(turn: turn(items: []), evidence: none) &&
              R.rejectedBeforeExecution(turn: turn(items: [user, ["type": "hookPrompt", "id": "h"]]), evidence: none),
              "a full item list of only the owner's input qualifies")

    // ---- Retry hint and the provider's own words ---------------------------
    for (text, expected) in [("Please try again in 45 seconds.", 45.0 as Double?), ("Try again in 2 minutes", 120),
                             ("retry after 3h", 10_800), ("Retry-After: 30", 30), ("try again in 1.5m", 90),
                             ("try again in 2 days", 172_800), (incidentMessage, nil)] {
        try check(R.retryAfter(error: ["message": text]) == expected, "retry hint: \(text)")
    }
    try check(R.retryAfter(error: ["message": "x", "additionalDetails": "try again in 10 s"]) == 10,
              "the hint may sit in additionalDetails")
    let summary = R.failureSummary(turn: turn())
    try check(summary == "codex turn failed: response_too_many_failed_attempts_429: " + incidentMessage,
              "the incident's provider statement: \(summary)")
    try check(R.failureSummary(turn: turn(error: ["message": "boom", "codexErrorInfo": ["responseStreamDisconnected":
        ["httpStatusCode": 502]]])) == "codex turn failed: responseStreamDisconnected(502): boom", "another class keeps its name")

    // ---- Bounded model cooldown --------------------------------------------
    typealias Q = CodexQuotaBackoff
    try check(Q.cooldown(retryAfter: nil) == 600 && Q.cooldown(retryAfter: 5) == 30 && Q.cooldown(retryAfter: 120) == 120 &&
              Q.cooldown(retryAfter: 3_600) == 600 && Q.cooldown(retryAfter: .infinity) == 600,
              "cooldown = min(retry hint, 10 min), at least 30 s")
    try check(Q.validModel("gpt-6-astra") && Q.validModel("gpt-6.1-sol") && !Q.validModel("../astra") &&
              !Q.validModel("GPT") && !Q.validModel("") && !Q.validModel(String(repeating: "a", count: 65)),
              "only a plain model slug names a receipt file")
    let now = Date(timeIntervalSince1970: 1_791_967_117)
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("os1-codex-backoff-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    try check(Q.activeModels(directory: directory, now: now).isEmpty, "no receipt, no cooldown")
    try RCCNativeAttemptOutcome.recordCodexBackoff(model: "gpt-6-astra", retryAfter: nil, directory: directory, now: now)
    try check(Q.activeModels(directory: directory, now: now) == ["gpt-6-astra"], "the rejected model is cooled")
    try check(Q.activeModels(directory: directory, now: now.addingTimeInterval(599)) == ["gpt-6-astra"] &&
              Q.activeModels(directory: directory, now: now.addingTimeInterval(600)).isEmpty,
              "the cooldown expires by itself after ten minutes")
    try RCCNativeAttemptOutcome.recordCodexBackoff(model: "gpt-6-luna", retryAfter: 45, directory: directory, now: now)
    try check(Q.active(model: "gpt-6-luna", directory: directory, now: now.addingTimeInterval(44)) != nil &&
              Q.active(model: "gpt-6-luna", directory: directory, now: now.addingTimeInterval(45)) == nil,
              "a shorter provider retry hint is honoured")
    try Q.record(model: "../escape", directory: directory, now: now)
    try check(Q.activeModels(directory: directory, now: now) == ["gpt-6-astra", "gpt-6-luna"],
              "an invalid slug writes nothing")
    // A receipt whose window is not a valid cooldown is ignored.
    // JSONEncoder's default Date encoding: seconds since the reference date.
    func forge(_ model: String, window: TimeInterval) throws {
        let fields: [String: Any] = ["observedAt": now.timeIntervalSinceReferenceDate,
            "retryAfter": now.addingTimeInterval(window).timeIntervalSinceReferenceDate, "model": model]
        try JSONSerialization.data(withJSONObject: fields).write(to: Q.modelURL(model, directory: directory)!)
    }
    try forge("gpt-6.1-sol", window: 86_400)
    try check(Q.active(model: "gpt-6.1-sol", directory: directory, now: now) == nil, "a day-long forged window is ignored")
    try check(RCCNativeAttemptOutcome.codexBackoffModel(provider: "codex", quotaExhausted: true, model: "gpt-6-astra") == "gpt-6-astra" &&
              RCCNativeAttemptOutcome.codexBackoffModel(provider: "codex", quotaExhausted: false, model: "gpt-6-astra") == nil &&
              RCCNativeAttemptOutcome.codexBackoffModel(provider: "claude", quotaExhausted: true, model: "gpt-6-astra") == nil &&
              RCCNativeAttemptOutcome.codexBackoffModel(provider: "codex", quotaExhausted: true, model: "../x") == nil,
              "only a classified Codex limit rejection cools, and only its dispatched model")

    // ---- The next catalog excludes the cooled model ------------------------
    typealias B = RCCNativeCatalogBuilder
    typealias C = RCCRuntimeContract
    let request = "야 원플러스원 해봐."
    func input(_ cooled: Set<String>) -> B.Input {
        var value = B.Input(taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8)), request: request,
            providerPreference: "auto", requireReadOnly: true, hasMaterialRefs: false, capacityPlan: nil,
            executorContractSHA256: String(repeating: "c", count: 64), now: now, showCodex: true,
            chatLaneEligible: false, profiles: [
                .init(action: "cx_6astra_max", provider: "codex", model: "gpt-6-astra", effort: "max"),
                .init(action: "cx_6luna_low", provider: "codex", model: "gpt-6-luna", effort: "low"),
                .init(action: "claude_fable_max", provider: "claude", model: "claude-fable-5-1", effort: "max")])
        value.codexModels = [.init(slug: "gpt-6-astra", supportedEfforts: ["max"], priority: 0),
                             .init(slug: "gpt-6-luna", supportedEfforts: ["low"], priority: 1)]
        value.claudeModels = [.init(model: "claude-fable-5-1", supportedEfforts: ["max"])]
        value.auth = ["codex": .subscription, "claude": .subscription]
        value.accountIDs = ["codex": "codex.default", "claude": "acct-claude"]
        value.codexQuotaBackoffModels = cooled
        return value
    }
    func models(_ output: B.Output) -> Set<String> { Set(output.candidates.map { "\($0["model"]!)" }) }
    func reasons(_ output: B.Output) -> [String] { output.exclusions.map { "\($0.provider):\($0.reason):\($0.count)" } }
    let warm = try B.build(input([]))
    try check(models(warm) == ["gpt-6-astra", "gpt-6-luna", "claude-fable-5-1"] && warm.exclusions.isEmpty,
              "no cooldown: \(models(warm)) \(reasons(warm))")
    let cooled = try B.build(input(Set(Q.activeModels(directory: directory, now: now))))
    try check(models(cooled) == ["claude-fable-5-1"] && reasons(cooled) == ["codex:quota_backoff:2"],
              "both cooled Codex models are quota_backoff: \(reasons(cooled))")
    let frontierOnly = try B.build(input(["gpt-6-astra"]))
    try check(models(frontierOnly) == ["gpt-6-luna", "claude-fable-5-1"] &&
              reasons(frontierOnly) == ["codex:quota_backoff:1", "codex:reference_unavailable:1"],
              "a cooled astra keeps luna for trivial work but never as Codex's reference: \(reasons(frontierOnly))")
    try check(B.providersToProbe(input(["gpt-6-astra"])) == ["claude", "codex"], "the other Codex model is still probed")
    let bytes = try B.catalogData(frontierOnly, taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8)))
    try check((try C.decodeCatalog(bytes).exclusions ?? []).map(\.reason) == ["quota_backoff", "reference_unavailable"],
              "the strict catalog decoder accepts the Codex cooldown exclusions")

    // ---- The sanitized cause an interrupted attempt persists --------------
    typealias O = RCCNativeAttemptOutcome
    let cause = O.failureCause(kind: "OS1Error.backendBlocked(quota_exhausted)", message: summary)
    try check(cause == "OS1Error.backendBlocked(quota_exhausted): " + summary, "the incident cause is kept whole: \(cause)")
    let pathy = O.failureCause(kind: "OS1Error.message",
        message: "receipt /Users/owner/.os1/rcc-runtime/native-receipts/x.json and ~/.codex/auth.json and file:///Users/owner/a unreadable")
    try check(!pathy.contains("/Users") && !pathy.contains(".codex") && !pathy.contains("owner") &&
              pathy.contains("<path>") && pathy.hasPrefix("OS1Error.message: receipt "), "paths never persist: \(pathy)")
    let web = O.failureCause(kind: "OS1Error.message", message: "POST https://api.example.com/v1/responses?key=hunter2 failed")
    try check(!web.contains("hunter2") && web.contains("api.example.com"), "a URL keeps its host, never its query: \(web)")
    // A synthetic header value (no provider key format): masked as a credential.
    let secret = O.failureCause(kind: "OS1Error.message", message: "Authorization: Bearer fixtureCredentialQ7w9Zr2Lk5Vx8Pm3 rejected")
    try check(!secret.contains("fixtureCredentialQ7w9Zr2Lk5Vx8Pm3"), "credentials are masked: \(secret)")
    let long = O.failureCause(kind: "OS1Error.message", message: String(repeating: "word ", count: 400))
    try check(long.count <= "OS1Error.message: ".count + NativeStepLabel.maximumCharacters, "the message is bounded")
    try check(O.failureCause(kind: "Swift<script>Error\n", message: "") == "SwiftscriptError" &&
              O.failureCause(kind: "", message: "") == "unknown", "the class keeps only plain identifier characters")

    print("Codex turn rejection: \(checks) checks OK; model calls 0")
}
