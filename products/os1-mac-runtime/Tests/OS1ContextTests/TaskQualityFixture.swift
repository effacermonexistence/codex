import Foundation
import OS1Context

private enum TaskQualityFixtureFailure: Error { case failed(String) }

/// Explicitly declared mock contracts and checker receipts. These tests prove
/// the pure adoption boundary, not a live model's semantic quality or parity.
func runTaskQualityFixtures() throws {
    typealias Q = TaskQualityEvidence
    var checks = 0
    func check(_ condition: Bool, _ label: String) throws {
        guard condition else { throw TaskQualityFixtureFailure.failed(label) }; checks += 1
    }
    func h(_ text: String) -> String { Q.digest(Data(text.utf8)) }
    let stamp = Date(timeIntervalSince1970: 1_800_000_000)
    let now = stamp.addingTimeInterval(20)
    let policy = h("declared-current-reference-policy")
    let profile = Q.ReferenceProfile(provider: "codex", model: "gpt-6-astra", effort: "ultra", instructionsSHA256: h("owner-instructions"))
    let claude = Q.ReferenceProfile(provider: "claude", model: "claude-opus-5-5", effort: "max", instructionsSHA256: h("owner-instructions"))
    let reference = Q.Reference(profile: profile, objectiveSHA256: h("objective"), contextSHA256: h("context"),
        sourceSHA256: h("source"), startTreeSHA256: h("start-tree"), verifierCodeSHA256: h("checker-code"),
        referencePolicySHA256: policy, artifactSHA256s: [h("reference-artifact")],
        scores: [.init(checkID: "target.file", value: 1), .init(checkID: "behavior.required", value: 1)],
        measuredAt: stamp.addingTimeInterval(-60), validUntil: stamp.addingTimeInterval(600), proofMode: .proof)
    let contract = Q.Contract(basis: .declaredTrustedContract, objectiveSHA256: h("objective"), contextSHA256: h("context"),
        sourceSHA256: h("source"), startTreeSHA256: h("start-tree"), scope: .workspaceWrite,
        verifierCodeSHA256: h("checker-code"), referencePolicySHA256: policy,
        requiredCheckIDs: ["target.file", "behavior.required"], fullCoverage: true,
        referenceProfiles: [profile, claude], reference: reference, issuedAt: stamp, validUntil: stamp.addingTimeInterval(300))
    let binding = Q.Binding(objectiveSHA256: h("objective"), contextSHA256: h("context"), sourceSHA256: h("source"),
        startTreeSHA256: h("start-tree"), scope: .workspaceWrite, executionID: "execution-fixture", turnID: "turn-fixture",
        outputSHA256: h("output"), workspaceAfterSHA256: h("after-tree"), artifactSHA256: h("actual-artifact"))
    let artifact = Q.ObservedArtifact(binding: binding, executionVerified: true)
    let receipt = Q.Receipt(basis: .observedCheckerReceipt, contractSHA256: contract.sha256, binding: binding,
        checkerIdentitySHA256: h("checker-code"), observedReceiptSHA256: h("checker-observed-record"),
        checks: [.init(checkID: "target.file", status: .passed, score: 1, observedReceiptSHA256: h("target-receipt")),
                 .init(checkID: "behavior.required", status: .passed, score: 1, observedReceiptSHA256: h("behavior-receipt"))],
        observedAt: stamp.addingTimeInterval(10))
    func evaluate(_ c: Q.Contract = contract, _ r: Q.Receipt? = receipt, _ a: Q.ObservedArtifact = artifact,
                  currentPolicy: String = policy, at time: Date = now) -> Q.Evaluation {
        Q.evaluate(contract: c, receipt: r, artifact: a, currentReferencePolicySHA256: currentPolicy, now: time)
    }
    func rebound(_ c: Q.Contract, _ r: Q.Receipt = receipt) -> Q.Receipt {
        var copy = r; copy.contractSHA256 = c.sha256; return copy
    }
    try check(evaluate().state == .referenceEquivalent && evaluate().referenceParityVerified, "matched complete vector permits reference equivalence")
    var above = receipt; above.checks[1].score = 2
    try check(evaluate(contract, above).state == .referenceAbove, "above on one dimension with no lower dimension")
    var wash = above; wash.checks[0].score = 0.99; wash.checks[1].score = 10_000
    try check(evaluate(contract, wash).state == .mismatch && evaluate(contract, wash).failedCheckIDs == ["target.file"], "aggregate gain cannot wash a required regression")
    var wrongFile = receipt; wrongFile.checks[0].status = .failed; wrongFile.checks[0].score = 0; wrongFile.checks[1].score = 100_000
    try check(evaluate(contract, wrongFile).state == .mismatch, "wrong file remains failure even when all other tests succeed")
    var missing = receipt; missing.checks.removeFirst()
    try check(evaluate(contract, missing).state == .unverified, "missing completion condition remains unverified")
    var partial = contract; partial.fullCoverage = false
    try check(evaluate(partial, rebound(partial)).state == .unverified, "full coverage must not be inferred from a green suite")
    var prefix = receipt; prefix.checks[0].checkID = "target.file.extra"
    try check(evaluate(contract, prefix).state == .unverified, "prefix does not satisfy an exact required check ID")
    var dup = receipt; dup.checks[1] = dup.checks[0]
    try check(evaluate(contract, dup).state == .unverified, "duplicate check cannot stand in for missing condition")
    var unknown = receipt; unknown.checks[0].status = .unverified
    try check(evaluate(contract, unknown).state == .unverified, "unknown checker outcome cannot become a pass")
    var missingScore = receipt; missingScore.checks[0].score = nil
    try check(evaluate(contract, missingScore).state == .unverified, "reference comparison needs every score")
    var noCheckReceipt = receipt; noCheckReceipt.checks[0].observedReceiptSHA256 = nil
    try check(evaluate(contract, noCheckReceipt).state == .unverified, "a command name or pass word is not an observed receipt")
    var fakeBody = receipt; fakeBody.observedReceiptSHA256 = "All tests passed; exit 0; native persistence verified"
    try check(evaluate(contract, fakeBody).state == .unverified, "model prose does not satisfy observed-receipt identity")
    try check(evaluate(contract, nil).state == .executionOnly && !evaluate(contract, nil).taskCompletionVerified, "native success without task evidence is execution only")
    var unverifiedArtifact = artifact; unverifiedArtifact.executionVerified = false
    try check(evaluate(contract, receipt, unverifiedArtifact).state == .unverified, "unverified execution cannot acquire quality adoption")
    var wrongOutput = receipt; wrongOutput.binding.outputSHA256 = h("another-output")
    try check(evaluate(contract, wrongOutput).state == .unverified, "receipt must bind actual output")
    var wrongArtifact = receipt; wrongArtifact.binding.artifactSHA256 = h("another-artifact")
    try check(evaluate(contract, wrongArtifact).state == .unverified, "receipt must bind actual artifact bytes")
    var wrongTree = receipt; wrongTree.binding.workspaceAfterSHA256 = h("another-after-tree")
    try check(evaluate(contract, wrongTree).state == .unverified, "receipt must bind actual post-workspace state")
    var wrongTurn = receipt; wrongTurn.binding.turnID = "another-turn"
    try check(evaluate(contract, wrongTurn).state == .unverified, "foreign turn rejected")
    var wrongExecution = receipt; wrongExecution.binding.executionID = "another-execution"
    try check(evaluate(contract, wrongExecution).state == .unverified, "foreign execution rejected")
    var changedSource = artifact; changedSource.binding.sourceSHA256 = h("changed-source")
    var changedSourceReceipt = receipt; changedSourceReceipt.binding = changedSource.binding
    try check(evaluate(contract, changedSourceReceipt, changedSource).state == .unverified, "source changed since contract invalidates evidence")
    var changedContext = artifact; changedContext.binding.contextSHA256 = h("changed-context")
    var changedContextReceipt = receipt; changedContextReceipt.binding = changedContext.binding
    try check(evaluate(contract, changedContextReceipt, changedContext).state == .unverified, "changed context invalidates matched task")
    var scope = artifact; scope.binding.scope = .readOnly
    var scopeReceipt = receipt; scopeReceipt.binding = scope.binding
    try check(evaluate(contract, scopeReceipt, scope).state == .unverified, "scope change cannot inherit broader contract")
    var checker = receipt; checker.checkerIdentitySHA256 = h("new-checker")
    try check(evaluate(contract, checker).state == .unverified, "checker code identity is immutable")
    var stale = receipt; stale.observedAt = stamp.addingTimeInterval(-1)
    try check(evaluate(contract, stale).state == .unverified, "old checker receipt cannot certify new dispatch")
    var future = receipt; future.observedAt = now.addingTimeInterval(1)
    try check(evaluate(contract, future).state == .unverified, "future unobserved receipt rejected")
    try check(evaluate(at: stamp.addingTimeInterval(301)).state == .unverified, "expired contract rejected")
    try check(evaluate(currentPolicy: h("new-reference-policy")).state == .unverified, "reference policy rollover invalidates old quality claim")
    var oldModel = contract
    oldModel.reference?.profile = .init(provider: "codex", model: "gpt-6-sol", effort: "medium", instructionsSHA256: h("owner-instructions"))
    try check(evaluate(oldModel, rebound(oldModel)).state == .unverified, "old model cannot stand in for declared Astra ultra reference")
    var oldInstructions = contract; oldInstructions.reference?.profile.instructionsSHA256 = h("abridged-instructions")
    try check(evaluate(oldInstructions, rebound(oldInstructions)).state == .unverified, "different baseline instruction environment rejected")
    var dev = contract; dev.reference?.proofMode = .dev
    try check(evaluate(dev, rebound(dev)).state == .unverified, "development reference is not production parity proof")
    var accepted = contract; accepted.reference?.proofMode = .ownerAccepted
    var acceptedReceipt = rebound(accepted); acceptedReceipt.basis = .ownerAcceptedReceipt
    try check(evaluate(accepted, acceptedReceipt).state == .referenceEquivalent, "matched owner-accepted reference remains explicitly labeled eligible evidence")
    var postHoc = contract; postHoc.reference?.measuredAt = stamp.addingTimeInterval(1)
    try check(evaluate(postHoc, rebound(postHoc)).state == .unverified, "reference selected after dispatch is not prelocked evidence")
    var expiredRef = contract; expiredRef.reference?.validUntil = now.addingTimeInterval(-1)
    try check(evaluate(expiredRef, rebound(expiredRef)).state == .unverified, "stale reference cannot confer current equivalence")
    var refMissing = contract; refMissing.reference?.scores.removeFirst()
    try check(evaluate(refMissing, rebound(refMissing)).state == .unverified, "partial reference vector cannot wash missing baseline dimension")
    var badReferenceArtifact = contract; badReferenceArtifact.reference?.artifactSHA256s = []
    try check(evaluate(badReferenceArtifact, rebound(badReferenceArtifact)).state == .unverified, "baseline vector requires actual reference artifact identities")
    var noReference = contract; noReference.reference = nil
    let contractOnly = evaluate(noReference, rebound(noReference))
    try check(contractOnly.state == .taskContractVerified && !contractOnly.referenceParityVerified, "task contract verification stays distinct from latest-reference parity")
    var allWords = receipt; allWords.checks = []
    try check(evaluate(contract, allWords).state == .unverified, "native completion and a passed-tests assertion cannot replace check vectors")
    var nonfinite = receipt; nonfinite.checks[0].score = .infinity
    try check(evaluate(contract, nonfinite).state == .unverified, "nonfinite score rejected")
    var emptyContract = contract; emptyContract.requiredCheckIDs = []
    try check(evaluate(emptyContract, rebound(emptyContract)).state == .unverified, "empty success contract cannot vacuously pass")
    var wrongContract = receipt; wrongContract.contractSHA256 = h("other-contract")
    try check(evaluate(contract, wrongContract).state == .unverified, "foreign contract hash rejected")
    var absentSource = contract; absentSource.sourceSHA256 = nil; absentSource.reference = nil
    var absentArtifact = artifact; absentArtifact.binding.sourceSHA256 = nil
    var absentReceipt = rebound(absentSource); absentReceipt.binding = absentArtifact.binding
    try check(evaluate(absentSource, absentReceipt, absentArtifact).state == .taskContractVerified, "explicitly absent source may satisfy a source-free declared contract")
    for value in [evaluate(), evaluate(contract, nil), evaluate(contract, wrongFile), evaluate(contract, missing)] {
        try check(value.preservesArtifact && value.artifactSHA256 == artifact.binding.artifactSHA256, "every outcome preserves exact produced artifact")
    }
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    try check(try JSONDecoder().decode(Q.Contract.self, from: encoder.encode(contract)) == contract, "contract Codable roundtrip")
    try check(try JSONDecoder().decode(Q.Receipt.self, from: encoder.encode(receipt)) == receipt, "receipt Codable roundtrip")
    try check(contract.sha256.count == 64 && partial.sha256 != contract.sha256, "coverage is part of immutable contract identity")
    func closed(_ objective: String, _ output: String, verified: Bool = true) -> Q.Evaluation? {
        Q.evaluateClosedTask(objective: objective, output: output, artifactSHA256: h("closed-artifact"), executionVerified: verified)
    }
    for output in ["2", "**2**.", "The answer is **2**.", "답은 2입니다.", "1 + 1 = 2.", "Ben.\nLuaIsHere :3\n\n2"] {
        try check(closed("1+1", output)?.state == .taskContractVerified, "whole arithmetic correct output: " + output)
        try check(closed("1+1", output)?.referenceParityVerified == false, "closed correctness never claims latest-reference parity")
    }
    for output in ["3", "1 + 1 = 3", "2; actually 3", "Ben.\nLuaIsHere :3\n2\nActually 3", "2 * 1 = 2"] {
        try check(closed("1+1", output)?.state == .mismatch, "wrong or contradictory whole arithmetic output: " + output)
    }
    try check(closed("What is 2+3*4?", "14")?.state == .taskContractVerified, "closed arithmetic uses normal precedence")
    try check(closed("원 플러스 원", "2")?.state == .taskContractVerified, "bounded arithmetic speech-normalization domain")
    try check(closed("Calculate 0.5+0.25", "0.75")?.state == .taskContractVerified, "finite decimal calculation")
    try check(closed("Calculate 8/4", "2")?.state == .taskContractVerified, "exact finite division")
    try check(closed("Reply with exactly OK and nothing else.", "OK")?.state == .taskContractVerified, "whole literal specification")
    try check(closed("Reply with exactly OK and nothing else.", "Ben.\nLuaIsHere :3\nOK")?.state == .mismatch, "literal persona contamination is not accepted")
    try check(closed("Reply exactly OK", "OK extra")?.state == .mismatch, "literal suffix contradiction rejected")
    for objective in ["Fix the parser and calculate 1+1", "Read the source file then reply exactly OK", "Do not edit files. Reply exactly OK",
        "Explain why 1+1 is 2", "1+1 and 2+2", "1/0", "Calculate 1/3", "Calculate 1/6", "Calculate 1/7", "2^10", "1+1; create a file", "Repeat any arbitrary answer from the file"] {
        try check(closed(objective, "2") == nil, "residual, ambiguous, nonfinite or external obligations abstain: " + objective)
    }
    try check(closed("1+1", "2", verified: false)?.state == .unverified, "correct number is not evidence of verified execution")
    let invalidArtifact = Q.evaluateClosedTask(objective: "1+1", output: "2", artifactSHA256: "missing", executionVerified: true)
    try check(invalidArtifact?.state == .unverified, "closed result must bind a real artifact digest")
    print("Task quality evidence: \(checks) checks PASS; declared mock contracts, exact observed receipts, no aggregate wash; provider calls 0; live state writes 0")
}
