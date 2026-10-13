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
        .init(action: "codex_sol_low", provider: "codex", model: "gpt-6-sol", effort: "low"),
    ]
    let request = "Explain the login function"
    func input(preference: String = "auto") -> B.Input {
        var value = B.Input(taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8)), request: request,
            providerPreference: preference, requireReadOnly: true, hasMaterialRefs: false, capacityPlan: nil,
            executorContractSHA256: String(repeating: "c", count: 64), now: now, showCodex: true,
            chatLaneEligible: false, profiles: profiles)
        value.codexModels = [.init(slug: "gpt-6-sol", supportedEfforts: ["low"], priority: 0)]
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
    try check(Set(models(warm)) == ["fable", "claude-opus-5-5", "gpt-6-sol"] && warm.exclusions.isEmpty,
              "no receipt, no cooldown: \(models(warm)) \(reasons(warm))")
    try O.recordClaudeBackoff(.model("fable"), directory: directory, now: now)
    let family = try B.build(input())
    try check(!models(family).contains("fable") && models(family).contains("claude-opus-5-5") &&
              reasons(family) == ["claude:quota_backoff:1"],
              "a model-scoped rejection removes only that family, with quota_backoff: \(models(family)) \(reasons(family))")
    try check(B.providersToProbe(input()) == ["claude", "codex"], "other Claude families are still probed")
    try O.recordClaudeBackoff(.account, directory: directory, now: now)
    let account = try B.build(input())
    try check(Set(models(account)) == ["gpt-6-sol"] && reasons(account) == ["claude:quota_backoff:2"],
              "an account-wide rejection removes every Claude row: \(models(account)) \(reasons(account))")
    try check(B.providersToProbe(input()) == ["codex"], "a cooled account is not probed")
    let named = try B.build(input(preference: "claude"))
    try check(named.candidates.isEmpty && reasons(named) == ["claude:quota_backoff:2"],
              "an owner-named Claude choice is not offered a cooled account; the hold says why")
    let bytes = try B.catalogData(named, taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8)))
    try check(try C.decodeCatalog(bytes).exclusions == [.init(provider: "claude", reason: "quota_backoff", count: 2)],
              "the strict Swift catalog decoder accepts quota_backoff")
    try check(C.Exclusion.reasons.contains("quota_backoff"), "quota_backoff is a contract reason")
    try check(ClaudeQuotaBackoff.activeModels(directory: directory, now: now.addingTimeInterval(ClaudeQuotaBackoff.modelCooldown)).isEmpty &&
              ClaudeQuotaBackoff.active(at: directory.appendingPathComponent(ClaudeQuotaBackoff.defaultURL.lastPathComponent),
                                        now: now.addingTimeInterval(ClaudeQuotaBackoff.cooldown)) == nil,
              "both cooldowns are bounded and expire")

    print("RCC native attempt outcome: \(checks) checks OK; model calls 0")
}
