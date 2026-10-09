import Foundation
import OS1Context

func runTaskQualityCorrectionFixtures() throws {
    typealias Q = TaskQualityEvidence
    typealias C = TaskQualityCorrection
    var count = 0
    func check(_ value: Bool, _ label: String) throws {
        guard value else { throw NSError(domain: "TaskQualityCorrectionFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: label]) }; count += 1
    }
    func h(_ value: String) -> String { Q.digest(Data(value.utf8)) }
    let objective = "Fix the existing package and run its regression tests."
    let workspace = "/fixture/workspace", stamp = Date(timeIntervalSince1970: 1_790_000_000)
    let now = stamp.addingTimeInterval(10), policy = h("reference-policy"), source = h("frozen-owner-source")
    let boundary = C.Boundary(ownerObjective: objective, workspace: workspace, scope: .workspaceWrite,
        sourceSHA256: source, referencePolicySHA256: policy)
    struct Sample {
        var contract: Q.Contract
        var receipt: Q.Receipt
        var artifact: Q.ObservedArtifact
        var evaluation: Q.Evaluation
    }
    func sample(_ index: Int, before: String) -> Sample {
        let contract = Q.Contract(basis: .declaredTrustedContract, objectiveSHA256: h(objective),
            contextSHA256: h("context-\(index)"), sourceSHA256: source, startTreeSHA256: before,
            scope: .workspaceWrite, verifierCodeSHA256: h("frozen-checker"), referencePolicySHA256: policy,
            requiredCheckIDs: ["partial.original_unittest", "partial.candidate_unittest"], fullCoverage: false,
            referenceProfiles: [], reference: nil, issuedAt: stamp, validUntil: stamp.addingTimeInterval(300))
        let binding = Q.Binding(objectiveSHA256: h(objective), contextSHA256: contract.contextSHA256,
            sourceSHA256: source, startTreeSHA256: before, scope: .workspaceWrite,
            executionID: "fixture-execution-\(index)", turnID: "fixture-turn-\(index)",
            outputSHA256: h("candidate-output-\(index)"), workspaceAfterSHA256: h("after-\(index)"),
            artifactSHA256: h("immutable-artifact-\(index)"))
        let artifact = Q.ObservedArtifact(binding: binding, executionVerified: true)
        let raw = h("observed-checker-stdout-\(index)")
        let receipt = Q.Receipt(basis: .observedCheckerReceipt, contractSHA256: contract.sha256, binding: binding,
            checkerIdentitySHA256: contract.verifierCodeSHA256, observedReceiptSHA256: raw,
            checks: [.init(checkID: "partial.original_unittest", status: .passed, score: nil, observedReceiptSHA256: raw),
                     .init(checkID: "partial.candidate_unittest", status: .failed, score: nil, observedReceiptSHA256: raw)],
            observedAt: now)
        return Sample(contract: contract, receipt: receipt, artifact: artifact,
            evaluation: Q.evaluate(contract: contract, receipt: receipt, artifact: artifact,
                currentReferencePolicySHA256: policy, now: now))
    }
    func decide(_ s: Sample, budget: C.Budget = .init(), allowed: Bool = false, available: Bool = false,
                exit: Int32 = 0, cancelled: Bool = false, currentWorkspace: String = workspace,
                currentHash: String? = nil, currentSource: String? = source, lock: C.Boundary = boundary,
                receipt: Q.Receipt? = nil, missingReceipt: Bool = false, at: Date = now) -> C.Decision {
        C.decide(contract: s.contract, receipt: missingReceipt ? nil : (receipt ?? s.receipt),
            artifact: s.artifact, evaluation: s.evaluation, boundary: lock,
            currentWorkspace: currentWorkspace, currentWorkspaceSHA256: currentHash ?? s.artifact.binding.workspaceAfterSHA256,
            currentSourceSHA256: currentSource, exitCode: exit, cancelled: cancelled, budget: budget,
            referenceAllowed: allowed, referenceAvailable: available, now: at)
    }
    let initial = sample(1, before: h("initial-tree")), correction = decide(initial)
    try check(initial.evaluation.state == .mismatch && correction.action == .correct,
        "actual completed partial-check failure authorizes one correction")
    try check(correction.nextBudget.correctiveAttempts == 1 && correction.nextBudget.referenceEscalations == 0,
        "correction budget consumed before dispatch")
    try check(correction.preservesFailedArtifact && !correction.grantsReferenceParity,
        "failed artifact stays visible and no parity is invented")
    try check(correction.failedCheckIDs == ["partial.candidate_unittest"] &&
        correction.failedArtifactSHA256 == initial.artifact.binding.artifactSHA256, "exact failed IDs and artifact binding")
    try check(decide(initial, budget: correction.nextBudget, allowed: true, available: true).action == .hold,
        "the same old artifact cannot masquerade as a new corrective attempt")
    let repairedFailure = sample(2, before: initial.artifact.binding.workspaceAfterSHA256)
    try check(decide(repairedFailure, budget: correction.nextBudget).action == .hold,
        "explicit owner model constraint forbids silent frontier escalation")
    try check(decide(repairedFailure, budget: correction.nextBudget, allowed: true).action == .hold,
        "missing reference capacity does not authorize a cheaper substitute")
    let escalated = decide(repairedFailure, budget: correction.nextBudget, allowed: true, available: true)
    try check(escalated.action == .escalateReference && escalated.nextBudget.referenceEscalations == 1,
        "one distinct checker-confirmed correction failure may escalate when owner allows")
    let lastFailure = sample(3, before: repairedFailure.artifact.binding.workspaceAfterSHA256)
    try check(decide(lastFailure, budget: escalated.nextBudget, allowed: true, available: true).action == .hold,
        "no third correction or repeated reference execution")
    try check(decide(sample(2, before: h("foreign-start-tree")), budget: correction.nextBudget,
        allowed: true, available: true).action == .hold, "candidate continuity must bind the previous completed effects")
    try check(decide(initial, cancelled: true).action == .hold, "cancellation forbids correction")
    try check(decide(initial, exit: 1).action == .hold, "failed native exit is not a completed writer")
    var unverified = initial; unverified.artifact.executionVerified = false
    try check(decide(unverified).action == .hold, "unverified native persistence cannot authorize writing")
    try check(decide(initial, currentWorkspace: "/foreign/workspace").action == .hold, "workspace cannot change")
    try check(decide(initial, currentHash: h("concurrent-change")).action == .hold, "changed candidate held rather than replayed")
    try check(decide(initial, currentSource: h("new-source")).action == .hold, "owner source cannot change")
    try check(decide(initial, missingReceipt: true).action == .hold, "mismatch prose without checker receipt has no authority")
    var wrong = initial.receipt; wrong.checkerIdentitySHA256 = h("model-authored-checker")
    try check(decide(initial, receipt: wrong).action == .hold, "checker identity cannot be replaced")
    wrong = initial.receipt; wrong.binding.artifactSHA256 = h("another-artifact")
    try check(decide(initial, receipt: wrong).action == .hold, "foreign receipt cannot authorize a correction")
    wrong = initial.receipt; wrong.checks[1].checkID = "partial.candidate_unittest.extra"
    try check(decide(initial, receipt: wrong).action == .hold, "required-check prefix cannot replace exact ID")
    try check(decide(initial, at: stamp.addingTimeInterval(301)).action == .hold, "stale contract held")
    let otherPolicy = C.Boundary(ownerObjective: objective, workspace: workspace, scope: .workspaceWrite,
        sourceSHA256: source, referencePolicySHA256: h("new-policy"))
    try check(decide(initial, lock: otherPolicy).action == .hold, "reference policy rollover invalidates the failure bridge")
    let differentObjective = C.Boundary(ownerObjective: objective + " and deploy", workspace: workspace,
        scope: .workspaceWrite, sourceSHA256: source, referencePolicySHA256: policy)
    try check(decide(initial, lock: differentObjective).action == .hold, "owner objective cannot expand")
    var readOnly = initial; readOnly.artifact.binding.scope = .readOnly
    try check(decide(readOnly).action == .hold, "read-only output cannot become a writer")
    try check(decide(initial, budget: .init(correctiveAttempts: 2)).action == .hold, "invalid unlimited budget rejected")
    var pass = initial; pass.receipt.checks[1].status = .passed
    pass.evaluation = Q.evaluate(contract: pass.contract, receipt: pass.receipt, artifact: pass.artifact,
        currentReferencePolicySHA256: policy, now: now)
    try check(pass.evaluation.state == .unverified && decide(pass).action == .none &&
        !decide(pass).grantsReferenceParity, "partial pass neither repeats work nor creates reference parity")
    let prompt = C.prompt(objective: objective, failedCheckIDs: correction.failedCheckIDs,
        artifactSHA256: correction.failedArtifactSHA256)
    try check(prompt.contains(objective) && prompt.contains("partial.candidate_unittest") &&
        prompt.contains(correction.failedArtifactSHA256) && prompt.contains("NOT A REPLAY") &&
        prompt.contains("Do not repeat"), "bounded prompt preserves owner and prohibits original-stage replay")
    print("Task quality correction: \(count) checks PASS; frozen failure custody, one correction/reference maximum, no model calls")
}
