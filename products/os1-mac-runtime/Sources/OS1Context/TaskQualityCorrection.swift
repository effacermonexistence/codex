import Foundation

/// A known checker failure may authorize a correction of its completed local
/// candidate. It never authorizes replay of an unknown or interrupted writer.
public enum TaskQualityCorrection {
    public enum Action: String, Codable, Sendable {
        case none, correct, escalateReference, hold
    }
    public struct Boundary: Equatable, Sendable {
        public let ownerObjective: String
        public let workspace: String
        public let scope: TaskContext.Scope
        public let sourceSHA256: String?
        public let referencePolicySHA256: String
        public init(ownerObjective: String, workspace: String, scope: TaskContext.Scope,
                    sourceSHA256: String?, referencePolicySHA256: String) {
            self.ownerObjective = ownerObjective; self.workspace = workspace; self.scope = scope
            self.sourceSHA256 = sourceSHA256; self.referencePolicySHA256 = referencePolicySHA256
        }
    }
    public struct Budget: Codable, Equatable, Sendable {
        public var correctiveAttempts: Int
        public var referenceEscalations: Int
        public var lastFailureArtifactSHA256: String?
        public var lastFailureWorkspaceSHA256: String?
        public init(correctiveAttempts: Int = 0, referenceEscalations: Int = 0,
                    lastFailureArtifactSHA256: String? = nil, lastFailureWorkspaceSHA256: String? = nil) {
            self.correctiveAttempts = correctiveAttempts; self.referenceEscalations = referenceEscalations
            self.lastFailureArtifactSHA256 = lastFailureArtifactSHA256
            self.lastFailureWorkspaceSHA256 = lastFailureWorkspaceSHA256
        }
    }
    public struct Decision: Equatable, Sendable {
        public let action: Action
        public let reason: String
        public let failedCheckIDs: [String]
        public let failedArtifactSHA256: String
        public let nextBudget: Budget
        /// The caller must retain the immutable rejected artifact and receipt.
        public var preservesFailedArtifact: Bool { true }
        /// A correction decision is not a completion or a reference certificate.
        public var grantsReferenceParity: Bool { false }
    }

    public static func decide(contract: TaskQualityEvidence.Contract?, receipt: TaskQualityEvidence.Receipt?,
                              artifact: TaskQualityEvidence.ObservedArtifact, evaluation: TaskQualityEvidence.Evaluation,
                              boundary: Boundary, currentWorkspace: String, currentWorkspaceSHA256: String,
                              currentSourceSHA256: String?, exitCode: Int32, cancelled: Bool,
                              budget: Budget = .init(), referenceAllowed: Bool = false,
                              referenceAvailable: Bool = false, now: Date = Date()) -> Decision {
        func result(_ action: Action, _ reason: String, _ next: Budget? = nil) -> Decision {
            Decision(action: action, reason: reason, failedCheckIDs: evaluation.failedCheckIDs,
                failedArtifactSHA256: artifact.binding.artifactSHA256, nextBudget: next ?? budget)
        }
        guard evaluation.state == .mismatch else { return result(.none, "no_known_task_check_failure") }
        guard !cancelled else { return result(.hold, "owner_cancelled_no_correction") }
        guard boundary.scope == .workspaceWrite, artifact.binding.scope == boundary.scope,
              exitCode == 0, artifact.executionVerified else {
            return result(.hold, "writer_not_known_completed_in_workspace")
        }
        let objectiveSHA = TaskQualityEvidence.digest(Data(boundary.ownerObjective.utf8))
        guard !boundary.ownerObjective.isEmpty, boundary.workspace.hasPrefix("/"),
              currentWorkspace == boundary.workspace,
              artifact.binding.objectiveSHA256 == objectiveSHA,
              artifact.binding.sourceSHA256 == boundary.sourceSHA256,
              currentSourceSHA256 == boundary.sourceSHA256,
              currentWorkspaceSHA256 == artifact.binding.workspaceAfterSHA256 else {
            return result(.hold, "owner_workspace_source_or_candidate_changed")
        }
        guard let contract, let receipt else { return result(.hold, "frozen_checker_receipt_missing") }
        let verified = TaskQualityEvidence.evaluate(contract: contract, receipt: receipt, artifact: artifact,
            currentReferencePolicySHA256: boundary.referencePolicySHA256, now: now)
        guard verified.state == .mismatch, verified == evaluation,
              !verified.failedCheckIDs.isEmpty else {
            return result(.hold, "failure_not_bound_to_actual_frozen_checker")
        }
        guard (0...1).contains(budget.correctiveAttempts), (0...1).contains(budget.referenceEscalations),
              budget.referenceEscalations <= budget.correctiveAttempts,
              (budget.correctiveAttempts == 0) == (budget.lastFailureArtifactSHA256 == nil),
              (budget.correctiveAttempts == 0) == (budget.lastFailureWorkspaceSHA256 == nil) else {
            return result(.hold, "invalid_correction_budget")
        }
        if budget.correctiveAttempts > 0 {
            guard budget.lastFailureArtifactSHA256 != artifact.binding.artifactSHA256,
                  budget.lastFailureWorkspaceSHA256 == artifact.binding.startTreeSHA256 else {
                return result(.hold, "no_distinct_bound_corrective_execution")
            }
        }
        var next = budget
        next.lastFailureArtifactSHA256 = artifact.binding.artifactSHA256
        next.lastFailureWorkspaceSHA256 = artifact.binding.workspaceAfterSHA256
        if budget.correctiveAttempts == 0 {
            next.correctiveAttempts = 1
            return result(.correct, "one_bound_local_candidate_correction", next)
        }
        guard budget.referenceEscalations == 0 else { return result(.hold, "correction_and_reference_budget_exhausted") }
        guard referenceAllowed, referenceAvailable else {
            return result(.hold, referenceAllowed ? "reference_execution_unavailable" : "owner_constraints_do_not_allow_reference_escalation")
        }
        next.referenceEscalations = 1
        return result(.escalateReference, "one_owner_allowed_reference_correction", next)
    }

    public static func prompt(objective: String, failedCheckIDs: [String], artifactSHA256: String,
                              escalation: Bool = false) -> String {
        """
        OS-1 TASK QUALITY \(escalation ? "REFERENCE CORRECTION" : "BOUNDED CORRECTION") — NOT A REPLAY
        Owner objective (preserve verbatim):
        \(objective)

        Completed candidate artifact: \(artifactSHA256)
        Actual frozen checker failed these exact IDs: \(failedCheckIDs.joined(separator: ", "))

        Continue from the already completed candidate and inspect its current effects before changing anything.
        Correct only the identified defects within the original authorized workspace, scope and source.
        Do not repeat already completed stages, replay the original writer, perform external actions,
        delete rejected results, replace frozen original tests, or weaken acceptance criteria.
        Preserve unrelated and uncommitted work. Re-run the same frozen checks against the corrected candidate.
        A partial test pass is not full task completeness or latest-model reference parity.
        Return the exact changes, observed checks and unresolved limitations; do not manufacture completion.
        """
    }
}
