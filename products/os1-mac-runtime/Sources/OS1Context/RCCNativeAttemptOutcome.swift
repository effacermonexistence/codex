import Foundation

/// How `os1 rcc-execute` reports a native attempt that did not return a
/// finished, adopted candidate. Pure: the adapter supplies what it observed.
///
/// One failure is narrower than "dispatched": the Claude CLI started, but its
/// own stream proves the quota rejection came before any model or tool work
/// (`ExecutionStream.claudeQuotaRejectedBeforeExecution`). For a read-only
/// attempt whose workspace evidence holds (`workspaceEvidenceHolds`) nothing
/// could have happened, so the attempt is reported `not_dispatched` with side
/// effects `none` and the typed reason `provider_quota_rejected_before_execution`.
/// OpenClaw Core then treats it as a pre-dispatch failure and re-resolves the
/// node to the other quota pool. A write attempt keeps the existing report
/// (effects uncertain): a write is never re-dispatched on a provider's word.
public enum RCCNativeAttemptOutcome {
    public static let providerQuotaRejectedBeforeExecution = RCCRuntimeContract.providerQuotaRejectedBeforeExecution
    public static let outcomeUncertain = "native_outcome_uncertain_preserved"
    public static let configurationUnavailable = "native_configuration_or_authorization_unavailable"
    /// Recorded beside a finished read-only attempt whose native stream
    /// reported at least one failed tool call of the model's own.
    public static let nativeToolFailed = "native_tool_failed"

    public struct Report: Equatable, Sendable {
        public var status: RCCRuntimeContract.ExecutionStatus
        public var dispatchStage: RCCRuntimeContract.DispatchStage
        public var sideEffects: RCCRuntimeContract.SideEffects
        public var error: String
        public init(status: RCCRuntimeContract.ExecutionStatus, dispatchStage: RCCRuntimeContract.DispatchStage,
                    sideEffects: RCCRuntimeContract.SideEffects, error: String) {
            self.status = status; self.dispatchStage = dispatchStage; self.sideEffects = sideEffects; self.error = error
        }
    }

    /// - knownFinishedCandidate: the rejected execution still has a verified,
    ///   finished native answer (a post-check refusal, never relabelled).
    /// - dispatched: the backend's dispatch callback fired.
    /// - quotaRejectedBeforeExecution: a classified quota failure whose stream
    ///   proves no model or tool work ran before the rejection.
    /// - workspaceUnchanged: the workspace part of the no-effect proof holds
    ///   for this attempt (`workspaceEvidenceHolds`; false when not observed).
    public static func failure(knownFinishedCandidate: Bool, dispatched: Bool, scope: RCCRuntimeContract.Scope,
                               quotaRejectedBeforeExecution: Bool, workspaceUnchanged: Bool) -> Report {
        if quotaRejectedBeforeExecution, !knownFinishedCandidate, scope == .readOnly, workspaceUnchanged {
            return .init(status: .failed, dispatchStage: .notDispatched, sideEffects: .none,
                         error: providerQuotaRejectedBeforeExecution)
        }
        let uncertainWrite = dispatched && scope == .workspaceWrite
        return .init(status: knownFinishedCandidate ? .succeeded : uncertainWrite ? .effectsUncertain : .failed,
                     dispatchStage: dispatched ? .dispatched : .notDispatched,
                     sideEffects: uncertainWrite ? .possible : .none,
                     error: dispatched ? outcomeUncertain : configurationUnavailable)
    }

    /// The typed error a FINISHED attempt carries beside its answer when the
    /// model's own tool calls failed (`ExecutionStream.mainToolsFailed`):
    /// `native_tool_failed` for a verified read-only attempt, else nil. The
    /// answer is still delivered as is on any route; OpenClaw Core reads the
    /// error as a REVAS failure signal only for a read-only node bound below
    /// its reference tier, which then re-runs once at the reference. A write
    /// keeps its own report (writes are never escalated); an attempt that did
    /// not finish already reports its failure.
    public static func toolFailureError(verified: Bool, scope: RCCRuntimeContract.Scope, mainToolsFailed: Int) -> String? {
        verified && scope == .readOnly && mainToolsFailed > 0 ? nativeToolFailed : nil
    }

    /// Whether the workspace part of the no-effect proof is about THIS
    /// attempt. An isolated workspace (the chat lane's private answer
    /// workspace) belongs to the attempt alone: its hash must be unchanged
    /// (and observed). The shared workspace does not: Core runs a read-only
    /// node beside a writer of the same workspace (another node or another
    /// task), so a whole-workspace hash taken around this attempt also sees
    /// that writer's edits and proves nothing about this attempt. There the
    /// proof is the stream attestation (no model or tool work, zero usage)
    /// under the read-only permission profile, which `failure` requires.
    public static func workspaceEvidenceHolds(isolatedWorkspace: Bool, before: String?, after: String?) -> Bool {
        !isolatedWorkspace || (before != nil && before == after)
    }

    /// The Claude cooldown a classified quota failure leaves for the next
    /// catalog, mirroring the legacy runner: a CLI sentence that names the
    /// dispatched family cools only that family; unknown or mixed evidence
    /// cools the account. nil for any other provider or failure.
    public static func claudeBackoffScope(provider: String, quotaExhausted: Bool,
                                          scope: ClaudeQuotaScope?) -> ClaudeQuotaScope? {
        provider == "claude" && quotaExhausted ? (scope ?? .account) : nil
    }

    /// Writes that cooldown receipt. `directory` is injectable for fixtures;
    /// the default is the same directory `ModelAvailability` reads.
    public static func recordClaudeBackoff(_ scope: ClaudeQuotaScope,
                                           directory: URL = ClaudeQuotaBackoff.defaultDirectory,
                                           now: Date = Date()) throws {
        switch scope {
        case .model(let family): try ClaudeQuotaBackoff.record(model: family, directory: directory, now: now)
        case .account:
            try ClaudeQuotaBackoff.record(at: directory.appendingPathComponent(ClaudeQuotaBackoff.defaultURL.lastPathComponent), now: now)
        }
    }
}
