import Foundation
import OS1Context

/// How `os1 rcc-execute` reports an attempt that hit a provider quota, and
/// the cooldown that keeps the next catalog off the rejected family. Pure
/// observations plus one private temporary directory; no provider, account,
/// model, gateway or live state is touched.
func runRCCNativeAttemptOutcomeFixtures() throws {
    typealias O = RCCNativeAttemptOutcome
    typealias C = RCCRuntimeContract
    typealias B = RCCNativeCatalogBuilder
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "RCCNativeAttemptOutcomeFixture", code: 1,
                                        userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }

    // ---- Classification ---------------------------------------------------
    // The adapter's former inline formula, verbatim: every input outside the
    // new pre-execution quota case must keep exactly this report.
    func former(known: Bool, dispatched: Bool, scope: C.Scope) -> O.Report {
        .init(status: known ? .succeeded : dispatched && scope == .workspaceWrite ? .effectsUncertain : .failed,
              dispatchStage: dispatched ? .dispatched : .notDispatched,
              sideEffects: dispatched && scope == .workspaceWrite ? .possible : .none,
              error: dispatched ? "native_outcome_uncertain_preserved" : "native_configuration_or_authorization_unavailable")
    }
    let noEffect = O.Report(status: .failed, dispatchStage: .notDispatched, sideEffects: .none,
                            error: "provider_quota_rejected_before_execution")
    try check(O.providerQuotaRejectedBeforeExecution == C.providerQuotaRejectedBeforeExecution &&
              C.providerQuotaRejectedBeforeExecution == "provider_quota_rejected_before_execution", "one shared reason string")
    for known in [false, true] { for dispatched in [false, true] { for scope in [C.Scope.readOnly, .workspaceWrite] {
        for quota in [false, true] { for unchanged in [false, true] {
            let report = O.failure(knownFinishedCandidate: known, dispatched: dispatched, scope: scope,
                                   quotaRejectedBeforeExecution: quota, workspaceUnchanged: unchanged)
            let moves = quota && !known && scope == .readOnly && unchanged
            try check(report == (moves ? noEffect : former(known: known, dispatched: dispatched, scope: scope)),
                      "classification known=\(known) dispatched=\(dispatched) scope=\(scope) quota=\(quota) unchanged=\(unchanged)")
        }}
    }}}
    // The cases that matter, named.
    try check(O.failure(knownFinishedCandidate: false, dispatched: true, scope: .readOnly,
                        quotaRejectedBeforeExecution: true, workspaceUnchanged: true) == noEffect,
              "a started read-only CLI rejected for quota before any work is a verified no-effect attempt")
    try check(O.failure(knownFinishedCandidate: false, dispatched: true, scope: .workspaceWrite,
                        quotaRejectedBeforeExecution: true, workspaceUnchanged: true) ==
              .init(status: .effectsUncertain, dispatchStage: .dispatched, sideEffects: .possible, error: "native_outcome_uncertain_preserved"),
              "a dispatched write stays effects-uncertain even with the same quota evidence")
    try check(O.failure(knownFinishedCandidate: false, dispatched: true, scope: .readOnly,
                        quotaRejectedBeforeExecution: true, workspaceUnchanged: false).error == "native_outcome_uncertain_preserved",
              "a changed workspace never becomes a no-effect report")
    try check(O.failure(knownFinishedCandidate: false, dispatched: true, scope: .readOnly,
                        quotaRejectedBeforeExecution: false, workspaceUnchanged: true).dispatchStage == .dispatched,
              "a quota failure after work started stays dispatched")
    try check(O.failure(knownFinishedCandidate: true, dispatched: true, scope: .readOnly,
                        quotaRejectedBeforeExecution: true, workspaceUnchanged: true).status == .succeeded,
              "a known finished candidate is never relabelled as not dispatched")

    // ---- The workspace evidence is about THIS attempt ---------------------
    // Core runs a read-only node beside a writer of the same workspace (a
    // sibling spread to the other pool, or another task). That writer's edit
    // changes the whole-workspace hash during this attempt; it must not turn a
    // verified pre-execution quota rejection into effects_uncertain.
    try check(O.workspaceEvidenceHolds(isolatedWorkspace: false, before: "before", after: nil) &&
              O.workspaceEvidenceHolds(isolatedWorkspace: false, before: "before", after: "after-writer") &&
              O.workspaceEvidenceHolds(isolatedWorkspace: false, before: nil, after: nil),
              "a shared workspace's hash is not evidence about this attempt")
    try check(O.workspaceEvidenceHolds(isolatedWorkspace: true, before: "before", after: "before") &&
              !O.workspaceEvidenceHolds(isolatedWorkspace: true, before: "before", after: "after") &&
              !O.workspaceEvidenceHolds(isolatedWorkspace: true, before: nil, after: nil),
              "the attempt's own isolated workspace must be observed unchanged")
    let concurrentWriter = O.failure(knownFinishedCandidate: false, dispatched: true, scope: .readOnly,
        quotaRejectedBeforeExecution: true,
        workspaceUnchanged: O.workspaceEvidenceHolds(isolatedWorkspace: false, before: "before", after: "after-writer"))
    try check(concurrentWriter == noEffect,
              "an attested read-only rejection beside a concurrent writer still moves to the other pool")
    try check(O.failure(knownFinishedCandidate: false, dispatched: true, scope: .workspaceWrite,
                        quotaRejectedBeforeExecution: true,
                        workspaceUnchanged: O.workspaceEvidenceHolds(isolatedWorkspace: false, before: "a", after: "a")).status == .effectsUncertain,
              "a write is never relabelled, whatever the workspace evidence")

    // ---- Contract: the reason is valid only on the no-effect read-only report
    let hash = C.digest(Data("fixture".utf8))
    func config(_ scope: C.Scope) -> C.ExactConfig {
        .init(surface: .claude, transport: .claudeCLI, accountID: "acct-claude", model: "claude-opus-5-5", effort: .medium,
              tools: scope == .readOnly ? ["read", "execute"] : ["read", "write", "execute"], scope: scope, permissionProfile: scope,
              quotaPool: .anthropicShared, allowedPaths: scope == .readOnly ? [] : ["**"], configurationSHA256: hash)
    }
    func record(_ report: O.Report, scope: C.Scope, receipt: String? = "/private/fixture/receipt.json") -> C.ExecutionRecord {
        .init(taskID: "task-fixture", nodeID: "n", attemptID: "attempt-1", candidateID: "cfg-fixture",
              configurationSHA256: hash, selectedConfig: config(scope), acknowledgedConfig: config(scope), observedConfig: nil,
              status: report.status, output: "You've hit your weekly limit", executionVerified: false, taskVerified: false,
              taskQuality: .failed, parityState: .unverified, nativeReceipt: receipt, sideEffects: report.sideEffects,
              usage: nil, error: report.error, dispatchStage: report.dispatchStage)
    }
    let valid = record(noEffect, scope: .readOnly)
    try C.validate(valid); checks += 1
    try check(try C.decodeRecord(C.encode(valid)) == valid, "the no-effect report round-trips through the strict decoder")
    for dispatched in [false, true] { for scope in [C.Scope.readOnly, .workspaceWrite] {
        let report = former(known: false, dispatched: dispatched, scope: scope)
        try C.validate(record(report, scope: scope)); checks += 1
    }}
    var invalid: [C.ExecutionRecord] = [record(noEffect, scope: .workspaceWrite), record(noEffect, scope: .readOnly, receipt: nil)]
    var dispatchedClaim = valid; dispatchedClaim.dispatchStage = .dispatched; invalid.append(dispatchedClaim)
    var uncertainClaim = valid; uncertainClaim.status = .effectsUncertain; uncertainClaim.sideEffects = .possible
    uncertainClaim.dispatchStage = .dispatched; invalid.append(uncertainClaim)
    var unknownClaim = valid; unknownClaim.dispatchStage = .unknown; invalid.append(unknownClaim)
    for value in invalid {
        do { try C.validate(value); try check(false, "a laundering use of the quota reason was accepted") }
        catch C.Rejection.invalidExecutionRecord { checks += 1 }
    }

    // ---- The routing server refused the exact tuple (review 2026-10-15) ----
    // A client whose signed profiles are newer than the server's policy is
    // refused before any ticket or process exists: a not-dispatched, no-effect
    // report in either scope, never a relabelled dispatch or finished answer.
    let refused = O.Report(status: .failed, dispatchStage: .notDispatched, sideEffects: .none,
                           error: "native_authorization_refused")
    try check(O.authorizationRefused == C.nativeAuthorizationRefused &&
              C.nativeAuthorizationRefused == "native_authorization_refused", "one shared refusal string")
    for scope in [C.Scope.readOnly, .workspaceWrite] {
        try check(O.failure(knownFinishedCandidate: false, dispatched: false, scope: scope,
                            quotaRejectedBeforeExecution: false, workspaceUnchanged: false, authorizationRefused: true) == refused,
                  "a refused \(scope) authorization is a not-dispatched, no-effect attempt")
        try check(O.failure(knownFinishedCandidate: false, dispatched: true, scope: scope,
                            quotaRejectedBeforeExecution: false, workspaceUnchanged: false, authorizationRefused: true) ==
                  former(known: false, dispatched: true, scope: scope),
                  "a dispatched \(scope) attempt is never relabelled as refused")
        try check(O.failure(knownFinishedCandidate: false, dispatched: false, scope: scope,
                            quotaRejectedBeforeExecution: false, workspaceUnchanged: false) ==
                  former(known: false, dispatched: false, scope: scope),
                  "any other pre-dispatch \(scope) failure keeps the charged configuration report")
        let accepted = record(refused, scope: scope)
        try C.validate(accepted); checks += 1
        try check(try C.decodeRecord(C.encode(accepted)) == accepted, "the \(scope) refusal round-trips through the strict decoder")
        var claimed = accepted; claimed.dispatchStage = .dispatched
        var effected = accepted; effected.status = .effectsUncertain; effected.sideEffects = .possible
        effected.dispatchStage = .dispatched
        for value in [claimed, effected, record(refused, scope: scope, receipt: nil)] {
            do { try C.validate(value); try check(false, "a laundering use of the refusal reason was accepted") }
            catch C.Rejection.invalidExecutionRecord { checks += 1 }
        }
    }
    try check(O.failure(knownFinishedCandidate: true, dispatched: false, scope: .readOnly,
                        quotaRejectedBeforeExecution: false, workspaceUnchanged: false, authorizationRefused: true).status == .succeeded,
              "a known finished candidate is never relabelled as refused")

    // ---- A finished read-only answer whose own tool call broke down ---------
    // The adapter records `native_tool_failed` beside the finished answer (a
    // REVAS failure signal for a cheaper tier route) only for a call that
    // broke down and was never recovered; nothing else changes.
    try check(O.nativeToolFailed == "native_tool_failed", "one typed tool-failure reason")
    try check(O.toolFailureError(verified: true, scope: .readOnly, unrecoveredBreakdowns: 1) == "native_tool_failed",
              "a verified read-only attempt with an unrecovered breakdown records the typed error")
    try check(O.toolFailureError(verified: true, scope: .readOnly, unrecoveredBreakdowns: 0) == nil,
              "no unrecovered breakdown: no error")
    try check(O.toolFailureError(verified: true, scope: .workspaceWrite, unrecoveredBreakdowns: 3) == nil,
              "a write keeps its own report (writes are never escalated)")
    try check(O.toolFailureError(verified: false, scope: .readOnly, unrecoveredBreakdowns: 2) == nil,
              "an unfinished attempt already reports its failure")
    // The record the adapter then writes is a valid finished record: the
    // answer stays deliverable, with the error beside it.
    var toolFailed = C.ExecutionRecord(taskID: "task-fixture", nodeID: "n", attemptID: "attempt-1", candidateID: "cfg-fixture",
        configurationSHA256: hash, selectedConfig: config(.readOnly), acknowledgedConfig: config(.readOnly), observedConfig: nil,
        status: .succeeded, output: "The search tool failed, so I could not check; the answer is probably 2.",
        executionVerified: true, taskVerified: false,
        taskQuality: .executionOnly, parityState: .unverified, nativeReceipt: "/private/fixture/receipt.json", sideEffects: .none,
        usage: nil, error: nil, dispatchStage: .dispatched)
    toolFailed.error = O.toolFailureError(verified: toolFailed.executionVerified, scope: .readOnly, unrecoveredBreakdowns: 1)
    try C.validate(toolFailed); checks += 1
    try check(try C.decodeRecord(C.encode(toolFailed)).error == "native_tool_failed",
              "the tool-failed finished record round-trips with its typed error")
    // The transport observation it is computed from: main-scope calls only,
    // each once. Ordinary exploration (a missing file, a command that exits
    // non-zero, `rg` with no match, a refused write) is never a breakdown, and
    // a later successful call recovers an earlier breakdown.
    let claudeSession = UUID().uuidString.lowercased()
    let claudeStream = ExecutionStream(claudeSessionID: claudeSession, workspace: "/fixture/ws")
    func claude(_ row: [String: Any]) throws {
        var object = row; object["session_id"] = claudeSession
        claudeStream.ingestClaude(try JSONSerialization.data(withJSONObject: object) + Data([10]))
    }
    try claude(["type": "system", "subtype": "init"])
    try claude(["type": "assistant", "message": ["id": "m1", "content": [["type": "tool_use", "id": "read-1", "name": "Read",
        "input": ["file_path": "/fixture/ws/missing.txt"]]]]])
    try claude(["type": "user", "message": ["content": [["type": "tool_result", "tool_use_id": "read-1", "is_error": true,
        "content": "PRIVATE: file does not exist"]]]])
    try claude(["type": "user", "message": ["content": [["type": "tool_result", "tool_use_id": "read-1", "is_error": true]]]])
    try check(claudeStream.mainToolsFailed == 1 && claudeStream.mainToolBreakdownsUnrecovered == 0,
              "a Claude tool error counts once as a failed call, never as a breakdown")
    try claude(["type": "assistant", "message": ["id": "m2", "content": [["type": "tool_use", "id": "read-2", "name": "Read",
        "input": ["file_path": "/fixture/ws/present.txt"]]]]])
    try claude(["type": "user", "message": ["content": [["type": "tool_result", "tool_use_id": "read-2", "is_error": false,
        "content": "PRIVATE"]]]])
    try check(claudeStream.mainToolsFailed == 1, "a duplicate result and a success do not count as failures")
    // Regression (review 2026-10-14): a failed Read, then a successful Read and
    // a correct answer, is a recovered miss: the cheaper answer is delivered.
    try check(O.toolFailureError(verified: true, scope: .readOnly,
                                 unrecoveredBreakdowns: claudeStream.mainToolBreakdownsUnrecovered) == nil,
              "a recovered Claude miss records no tool-failure error")
    func codexStream(_ items: [(String, String, String?)]) -> ExecutionStream {
        let stream = ExecutionStream(workspace: "/fixture/ws")
        for (id, type, status) in items {
            stream.ingestCodex(["method": "item/started", "params": ["threadId": "t", "turnId": "u",
                "item": ["id": id, "type": type, "command": "probe"]]], threadID: "t", turnID: "u")
            var item: [String: Any] = ["id": id, "type": type]
            if let status { item["status"] = status }
            stream.ingestCodex(["method": "item/completed", "params": ["threadId": "t", "turnId": "u", "item": item]],
                               threadID: "t", turnID: "u")
        }
        return stream
    }
    let explored = codexStream([("cat", "commandExecution", "failed"), ("ls", "commandExecution", "completed")])
    try check(explored.mainToolsFailed == 1 && explored.mainToolBreakdownsUnrecovered == 0,
              "a failed Codex command counts once as a failed call; a completed one does not")
    // Regression: `rg TODO file` exits 1 (no match) as the ONLY call, and the
    // answer "no TODO" is correct: never escalated.
    let noMatch = codexStream([("rg", "commandExecution", "failed")])
    try check(noMatch.mainToolsFailed == 1 && noMatch.mainToolBreakdownsUnrecovered == 0 &&
              O.toolFailureError(verified: true, scope: .readOnly, unrecoveredBreakdowns: noMatch.mainToolBreakdownsUnrecovered) == nil,
              "a command that ran and exited non-zero is exploration, never a breakdown")
    let refusedWrite = codexStream([("patch", "fileChange", "failed")])
    try check(refusedWrite.mainToolBreakdownsUnrecovered == 0, "a write the read-only bound refused is not a breakdown")
    let brokeTool = codexStream([("search", "mcpToolCall", "failed")])
    try check(brokeTool.mainToolBreakdownsUnrecovered == 1 &&
              O.toolFailureError(verified: true, scope: .readOnly, unrecoveredBreakdowns: brokeTool.mainToolBreakdownsUnrecovered) == "native_tool_failed",
              "a failed tool call with nothing after it is an unrecovered breakdown")
    let declined = codexStream([("ask", "dynamicToolCall", "declined")])
    try check(declined.mainToolBreakdownsUnrecovered == 1, "a call the transport declined never ran: a breakdown")
    let recovered = codexStream([("search", "mcpToolCall", "failed"), ("ls", "commandExecution", "completed")])
    try check(recovered.mainToolsFailed == 1 && recovered.mainToolBreakdownsUnrecovered == 0,
              "a later successful call recovers an earlier breakdown")
    let again = codexStream([("ls", "commandExecution", "completed"), ("search", "mcpToolCall", "failed")])
    try check(again.mainToolBreakdownsUnrecovered == 1, "a breakdown after the last success stays unrecovered")
    try check(ExecutionStream(workspace: nil).mainToolsFailed == 0 &&
              ExecutionStream(workspace: nil).mainToolBreakdownsUnrecovered == 0, "a new stream starts at zero")

    // ---- A fresh session beside the conversation's own thread --------------
    let ownerThread = UUID().uuidString
    try check(O.nativeSessionDetached(resumedSessionID: nil, conversationSessionID: ownerThread, chatLane: false),
              "a cheaper REVAS attempt that ran fresh beside the owner's thread is detached")
    try check(!O.nativeSessionDetached(resumedSessionID: ownerThread, conversationSessionID: ownerThread, chatLane: false),
              "an attempt that resumed the owner's thread is the conversation's")
    try check(!O.nativeSessionDetached(resumedSessionID: nil, conversationSessionID: nil, chatLane: false),
              "with no thread bound yet the fresh session becomes the conversation's")
    try check(!O.nativeSessionDetached(resumedSessionID: nil, conversationSessionID: ownerThread, chatLane: true),
              "a chat lane is never the conversation's agent session (its own rule)")
    // Only a host that sends a context or a session id can resume a session:
    // Fleet (Fleet.swift: context nil, both session ids nil) and a bare
    // `os1 run` send none of them; the App always sends a SessionHandoff.
    try check(!O.hostResumesNativeSessions(context: nil, claudeSessionID: nil, codexSessionID: nil),
              "the Fleet / bare os1 run host (no context, no session id) never resumes a native session")
    try check(O.hostResumesNativeSessions(context: "x", claudeSessionID: nil, codexSessionID: nil),
              "a host context (the App's SessionHandoff) can resume")
    try check(O.hostResumesNativeSessions(context: nil, claudeSessionID: ownerThread, codexSessionID: nil),
              "a host Claude session id can be resumed")
    try check(O.hostResumesNativeSessions(context: nil, claudeSessionID: nil, codexSessionID: ownerThread),
              "a host Codex session id counts as a resuming host")

    // ---- Cooldown left for the next catalog ---------------------------------
    try check(O.claudeBackoffScope(provider: "claude", quotaExhausted: true, scope: nil) == .account,
              "unclassified Claude quota evidence cools the account (legacy rule)")
    try check(O.claudeBackoffScope(provider: "claude", quotaExhausted: true, scope: .model("fable")) == .model("fable"),
              "a sentence naming the dispatched family cools only that family")
    try check(O.claudeBackoffScope(provider: "claude", quotaExhausted: false, scope: .model("fable")) == nil,
              "no cooldown without a classified quota failure")
    try check(O.claudeBackoffScope(provider: "codex", quotaExhausted: true, scope: nil) == nil,
              "Codex has no Claude cooldown")

    let now = Date(timeIntervalSince1970: 1_790_000_000)
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("os1-rcc-attempt-outcome-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let profiles: [B.Profile] = [
        .init(action: "claude_fable_low", provider: "claude", model: "fable", effort: "low"),
        .init(action: "claude_opus_xhigh", provider: "claude", model: "claude-opus-5-5", effort: "xhigh"),
        .init(action: "codex_astra_low", provider: "codex", model: "gpt-6-astra", effort: "low"),
    ]
    let request = "Explain the login function"
    func input(preference: String = "auto") -> B.Input {
        var value = B.Input(taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8)), request: request,
            providerPreference: preference, requireReadOnly: true, hasMaterialRefs: false, capacityPlan: nil,
            executorContractSHA256: String(repeating: "c", count: 64), now: now, showCodex: true,
            chatLaneEligible: false, profiles: profiles)
        value.codexModels = [.init(slug: "gpt-6-astra", supportedEfforts: ["low"], priority: 0)]
        value.claudeModels = [.init(model: "fable", supportedEfforts: ["low"]),
                              .init(model: "claude-opus-5-5", supportedEfforts: ["xhigh"])]
        value.auth = ["codex": .subscription, "claude": .subscription]
        value.accountIDs = ["codex": "acct-codex", "claude": "acct-claude"]
        // What `os1 rcc-catalog` reads: only the fixture directory's receipts.
        value.claudeAccountQuotaBackoff = ClaudeQuotaBackoff.active(
            at: directory.appendingPathComponent(ClaudeQuotaBackoff.defaultURL.lastPathComponent), now: now) != nil
        value.claudeQuotaBackoffFamilies = Set(ClaudeQuotaBackoff.activeModels(directory: directory, now: now))
        return value
    }
    func models(_ output: B.Output) -> [String] { output.candidates.map { "\($0["model"]!)" } }
    func reasons(_ output: B.Output) -> [String] { output.exclusions.map { "\($0.provider):\($0.reason):\($0.count)" } }

    let warm = try B.build(input())
    try check(Set(models(warm)) == ["fable", "claude-opus-5-5", "gpt-6-astra"] && warm.exclusions.isEmpty,
              "no receipt, no cooldown: \(models(warm)) \(reasons(warm))")
    try O.recordClaudeBackoff(.model("fable"), directory: directory, now: now)
    let family = try B.build(input())
    // fable is the pool's frontier (reference) model: with it cooled the
    // Claude pool keeps its lower tier for trivial and standard work, but
    // says reference_unavailable, so no deep work or escalation runs there
    // and claude-opus-5-5 never stands in as its reference (build 378).
    try check(Set(models(family)) == ["claude-opus-5-5", "gpt-6-astra"] &&
              reasons(family) == ["claude:quota_backoff:1", "claude:reference_unavailable:1"],
              "a model-scoped rejection of the frontier family leaves no Claude reference: \(models(family)) \(reasons(family))")
    try check(B.providersToProbe(input()) == ["claude", "codex"], "other Claude families are still probed")
    try O.recordClaudeBackoff(.account, directory: directory, now: now)
    let account = try B.build(input())
    try check(Set(models(account)) == ["gpt-6-astra"] && reasons(account) == ["claude:quota_backoff:2"],
              "an account-wide rejection removes every Claude row: \(models(account)) \(reasons(account))")
    try check(B.providersToProbe(input()) == ["codex"], "a cooled account is not probed")
    let named = try B.build(input(preference: "claude"))
    try check(named.candidates.isEmpty && reasons(named) == ["claude:quota_backoff:2"],
              "an owner-named Claude choice is not offered a cooled account; the hold says why")
    let bytes = try B.catalogData(named, taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8)))
    try check(try C.decodeCatalog(bytes).exclusions == [.init(provider: "claude", reason: "quota_backoff", count: 2)],
              "the strict Swift catalog decoder accepts quota_backoff")
    try check(C.Exclusion.reasons.contains("quota_backoff") && C.Exclusion.reasons.contains("reference_unavailable") &&
              C.Exclusion.reasons.contains("unclassified_model") && C.Exclusion.informational == ["unclassified_model"],
              "quota_backoff, reference_unavailable and the informational unclassified_model (K14) are contract reasons")
    try check(ClaudeQuotaBackoff.activeModels(directory: directory, now: now.addingTimeInterval(ClaudeQuotaBackoff.modelCooldown)).isEmpty &&
              ClaudeQuotaBackoff.active(at: directory.appendingPathComponent(ClaudeQuotaBackoff.defaultURL.lastPathComponent),
                                        now: now.addingTimeInterval(ClaudeQuotaBackoff.cooldown)) == nil,
              "both cooldowns are bounded and expire")

    let roBefore = C.digest(Data("RO before".utf8)), roAfter = C.digest(Data("RO changed".utf8))
    let delta = O.readOnlyWorkspaceChange(scope: .readOnly, before: roBefore, after: roAfter)
    try check(delta == .init(status: .effectsUncertain, dispatchStage: .dispatched, sideEffects: .confirmed,
                            error: O.readOnlyWorkspaceChanged), "a positive bounded RO delta holds without attributing its cause")
    try check(O.readOnlyWorkspaceChange(scope: .workspaceWrite, before: roBefore, after: roAfter) == nil,
              "writer classification is unchanged")
    try check(O.readOnlyWorkspaceChange(scope: .readOnly, before: roBefore, after: roBefore) == nil &&
              O.workspaceFingerprintObservation(before: roBefore, after: roBefore) == "bounded_fingerprint_equal_not_complete_proof",
              "bounded equality is not upgraded to complete/global no-effect proof")
    for pair in [(nil, nil), (roBefore, nil), (C.digest(Data()), roAfter), ("partial", roAfter)] as [(String?, String?)] {
        try check(O.readOnlyWorkspaceChange(scope: .readOnly, before: pair.0, after: pair.1) == nil &&
                  O.workspaceFingerprintObservation(before: pair.0, after: pair.1) == "unknown_or_unreliable",
                  "unknown/partial/sentinel hashes remain unknown without permanently rejecting valid RO")
    }
    if let delta {
        let held = record(delta, scope: .readOnly)
        try C.validate(held); checks += 1
        try check(try C.decodeRecord(C.encode(held)) == held, "RO confirmed-effect HOLD survives strict record encoding")
    }
    print("RCC native attempt outcome: \(checks) checks OK; model calls 0")
}
