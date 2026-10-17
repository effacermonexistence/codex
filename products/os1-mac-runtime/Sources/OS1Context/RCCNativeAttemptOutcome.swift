import Foundation

/// How `os1 rcc-execute` reports a native attempt that did not return a
/// finished, adopted candidate. Pure: the adapter supplies what it observed.
///
/// One failure is narrower than "dispatched": the Claude CLI started, but its
/// own stream proves the quota rejection came before any model or tool work
/// (`ExecutionStream.claudeQuotaRejectedBeforeExecution`), or a Codex turn
/// failed for a rate or usage limit (HTTP 429 included) with no agent
/// message, reasoning or tool work in its items or stream
/// (`CodexTurnRejection.rejectedBeforeExecution`). For a read-only
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
    /// A successfully observed provider catalog no longer admits the exact
    /// selected tuple. Never apply this label to old combined-error receipts.
    public static let verifiedConfigurationUnavailable = "native_configuration_unavailable"
    /// No backend was dispatched, but the failure does not establish model
    /// incompatibility. Credential, transport, authorization and ticket checks
    /// hold the chosen route rather than sending the task to another model.
    public static let preDispatchFailed = "native_pre_dispatch_failed"
    /// Historical opaque routing-server refusal before dispatch. Its HTTP400
    /// does not prove model incompatibility; current Core holds this legacy
    /// reason without changing candidates. The new adapter uses preDispatchFailed.
    public static let authorizationRefused = RCCRuntimeContract.nativeAuthorizationRefused
    /// Recorded beside a finished read-only attempt whose native stream
    /// reported a tool call of the model's own that broke down and was never
    /// recovered (`ExecutionStream.mainToolBreakdownsUnrecovered`).
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
    /// - authorizationRefused: legacy routing-server rejection before dispatch.
    ///   This preserves the historical wire label, not proof of a model-specific
    ///   cause or authority to choose another candidate. Current adapter/
    ///   Core classification holds opaque authentication/authorization failures.
    public static func failure(knownFinishedCandidate: Bool, dispatched: Bool, scope: RCCRuntimeContract.Scope,
                               quotaRejectedBeforeExecution: Bool, workspaceUnchanged: Bool,
                               authorizationRefused: Bool = false) -> Report {
        if quotaRejectedBeforeExecution, !knownFinishedCandidate, scope == .readOnly, workspaceUnchanged {
            return .init(status: .failed, dispatchStage: .notDispatched, sideEffects: .none,
                         error: providerQuotaRejectedBeforeExecution)
        }
        if authorizationRefused, !dispatched, !knownFinishedCandidate {
            return .init(status: .failed, dispatchStage: .notDispatched, sideEffects: .none,
                         error: Self.authorizationRefused)
        }
        let uncertainWrite = dispatched && scope == .workspaceWrite
        return .init(status: knownFinishedCandidate ? .succeeded : uncertainWrite ? .effectsUncertain : .failed,
                     dispatchStage: dispatched ? .dispatched : .notDispatched,
                     sideEffects: uncertainWrite ? .possible : .none,
                     error: dispatched ? outcomeUncertain : configurationUnavailable)
    }

    /// Whether the adapter may attest that the native turn ENDED
    /// (`ExecutionRecord.nativeTurnTerminated`), which lets OpenClaw Core
    /// release a settled read-only attempt's quota-pool lease: nothing was
    /// dispatched, or the transport itself proved it (OS-1 closed the
    /// provider process it owned, the Codex app-server writer or the Claude
    /// CLI; or Codex Desktop reported a terminal status for the turn). A
    /// returned record alone proves nothing about a turn still running
    /// elsewhere: a Codex Desktop turn whose observation failed, or whose
    /// interrupt was only best effort, keeps its pool (shared pool peak 1).
    public static func turnTerminated(dispatched: Bool, transportAttested: Bool) -> Bool {
        !dispatched || transportAttested
    }

    /// The typed error a FINISHED attempt carries beside its answer when a
    /// tool call of the model's own broke down and was never recovered
    /// (`ExecutionStream.mainToolBreakdownsUnrecovered`: declined, or a
    /// non-command tool error, with no later successful call):
    /// `native_tool_failed` for a verified read-only attempt, else nil. An
    /// ordinary failed command (`rg` with no match, a test that fails, a
    /// missing file) is exploration, never this error: escalating it would
    /// pay for the cheaper attempt AND the reference. The answer is still
    /// delivered as is on any route; OpenClaw Core reads the error as a REVAS
    /// failure signal only for a read-only node bound below its reference
    /// tier, which then re-runs once at the reference. A write keeps its own
    /// report (writes are never escalated); an attempt that did not finish
    /// already reports its failure.
    public static func toolFailureError(verified: Bool, scope: RCCRuntimeContract.Scope,
                                        unrecoveredBreakdowns: Int) -> String? {
        verified && scope == .readOnly && unrecoveredBreakdowns > 0 ? nativeToolFailed : nil
    }

    /// Whether a finished attempt ran in a fresh native session BESIDE the
    /// conversation's own thread of its provider: Core did not resume that
    /// thread (`native_resume_session_id` null) although the host supplied one.
    /// That is a REVAS-routed cheaper attempt whose answer may still be
    /// discarded (so it never writes into the owner's thread), or one part of
    /// a multi-part plan. Its session must not replace the conversation's
    /// thread: the next turn resumes the thread that holds the whole
    /// conversation, not a one-turn side session. A chat lane is already
    /// never the conversation's agent session.
    public static func nativeSessionDetached(resumedSessionID: String?, conversationSessionID: String?,
                                             chatLane: Bool) -> Bool {
        resumedSessionID == nil && conversationSessionID != nil && !chatLane
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

    /// The Codex model a classified rate-limit or usage-limit rejection
    /// (`CodexTurnRejection.limitClass`, reported as `quotaExhausted`) cools
    /// for the next catalog: always the dispatched model, never the account
    /// (the native rate-limit snapshot already covers an exhausted account).
    /// nil for any other provider or failure.
    public static func codexBackoffModel(provider: String, quotaExhausted: Bool, model: String) -> String? {
        provider == "codex" && quotaExhausted && CodexQuotaBackoff.validModel(model) ? model : nil
    }

    /// Writes that Codex cooldown (`CodexQuotaBackoff`, bounded by the
    /// provider's retry hint and ten minutes).
    public static func recordCodexBackoff(model: String, retryAfter: TimeInterval?,
                                          directory: URL = CodexQuotaBackoff.defaultDirectory,
                                          now: Date = Date()) throws {
        try CodexQuotaBackoff.record(model: model, retryAfter: retryAfter, directory: directory, now: now)
    }

    /// The cause of an interrupted native execution, safe to persist in its
    /// receipt's native summary: the error class (letters, digits and
    /// `._()-:` only, at most 96) and a short message with every path
    /// replaced by `<path>` and credentials masked (`NativeStepLabel.redact`,
    /// at most 160 characters). Never the raw error text.
    public static func failureCause(kind: String, message: String) -> String {
        // ASCII ranges, not a spelled-out alphabet literal: the release
        // artifact scanner rejects a 62-character alphabet constant as a
        // high-entropy token (the build 275 and build 379 release gates).
        func allowed(_ scalar: Unicode.Scalar) -> Bool {
            ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) || ("0"..."9").contains(scalar) ||
                "._()-:".unicodeScalars.contains(scalar)
        }
        var safeKind = String(String.UnicodeScalarView(kind.unicodeScalars.filter(allowed).prefix(96)))
        if safeKind.isEmpty { safeKind = "unknown" }
        guard let text = NativeStepLabel.redact(pathsRemoved(message)), !text.isEmpty else { return safeKind }
        return safeKind + ": " + text
    }

    /// Absolute and home-relative paths (and file URLs) become `<path>`; a
    /// web URL keeps its host (NativeStepLabel drops its credentials, query
    /// and fragment).
    static func pathsRemoved(_ text: String) -> String {
        guard let expression = try? NSRegularExpression(
            pattern: #"file://[^\s'"<>()\[\]{},;]*|(?<![\w:/.~-])(?:~/|/)[^\s'"<>()\[\]{},;]*"#, options: [.caseInsensitive])
        else { return "" }
        return expression.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text),
                                                   withTemplate: "<path>")
    }
}
