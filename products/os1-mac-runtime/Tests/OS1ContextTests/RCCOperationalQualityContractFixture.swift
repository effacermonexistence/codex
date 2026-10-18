import Foundation
import OS1Context

/// Pure optional wire compatibility/authority fixtures; no live state/models.
func runRCCOperationalQualityContractFixtures() throws {
    typealias C = RCCRuntimeContract
    var count = 0
    func check(_ value: @autoclosure () throws -> Bool, _ label: String) throws {
        guard try value() else { throw NSError(domain: "RCCOperationalQualityWire", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }; count += 1
    }
    func reject(_ label: String, _ body: () throws -> Void) throws {
        do { try body() } catch { count += 1; return }
        throw NSError(domain: "RCCOperationalQualityWire", code: 2, userInfo: [NSLocalizedDescriptionKey: label])
    }
    let hash = C.digest(Data("fixture hash".utf8)), instruction = "Implement the bounded project change and run its local tests."
    let policy = "Candidates and operational test passes are not reference parity."
    let host = C.HostContext(workspace: "/tmp/operational-wire", context: nil, providerPreference: "auto", codexSessionID: nil,
        claudeSessionID: nil, requireReadOnly: false, ownerPolicy: nil)
    let config = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture-account", model: "fixture-model", effort: .low,
        tools: ["Bash"], scope: .workspaceWrite, permissionProfile: .workspaceWrite, quotaPool: .openAICodex,
        allowedPaths: ["**"], configurationSHA256: hash)
    let request = C.Request(taskID: "task-quality", request: instruction, requestSHA256: C.digest(Data(instruction.utf8)),
        objective: instruction, policySHA256: C.digest(Data(policy.utf8)), sourceFingerprint: C.digest(try C.encode(host)), mode: .auto,
        materialRefs: [], budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 60_000),
        policy: .init(sourceSHA256: hash, projectionSHA256: C.digest(Data(policy.utf8)), text: policy), hostContext: host)
    let oldBytes = try C.encode(request), oldObject = try JSONSerialization.jsonObject(with: oldBytes) as! [String: Any]
    try check((oldObject["budget"] as? [String: Any])?["max_native_dispatches"] == nil, "legacy nil dispatch budget encoding has no new key")
    try check(try C.decodeRequest(oldBytes).budget.maxNativeDispatches == nil, "legacy request still decodes unbounded optional dispatch budget")
    var bounded = request; bounded.budget.maxNativeDispatches = 4
    try check(try C.decodeRequest(C.encode(bounded)).budget.maxNativeDispatches == 4, "explicit adapter-admission budget round trips")
    bounded.budget.maxNativeDispatches = 0; try reject("zero bound is invalid") { _ = try C.decodeRequest(C.encode(bounded)) }
    bounded.budget.maxNativeDispatches = 65; try reject("over64 bound is invalid") { _ = try C.decodeRequest(C.encode(bounded)) }
    var nullObject = oldObject, budget = oldObject["budget"] as! [String: Any]; budget["max_native_dispatches"] = NSNull(); nullObject["budget"] = budget
    try check(try C.decodeRequest(JSONSerialization.data(withJSONObject: nullObject)).budget.maxNativeDispatches == nil, "JSONnull retains legacy unbounded meaning")
    budget["max_native_dispatches"] = "4"; nullObject["budget"] = budget
    try reject("string budget cannot become authority") { _ = try C.decodeRequest(JSONSerialization.data(withJSONObject: nullObject)) }
    var ticket = C.ExecutionTicket(taskID: request.taskID, nodeID: "node", attemptID: "attempt-one", candidateID: "candidate",
        requestSHA256: request.requestSHA256, policySHA256: request.policySHA256, policySourceSHA256: hash,
        sourceFingerprint: request.sourceFingerprint, configurationSHA256: hash, selectedConfig: config,
        objective: instruction, instruction: instruction, contextRefs: [], ownedPaths: ["**"], originalRequest: instruction,
        originalObjective: instruction, hostContext: host)
    let oldTicketBytes = try C.encode(ticket)
    try check(try C.decodeTicket(oldTicketBytes).qualityContinuation == nil, "historical native ticket stays valid")
    try check((try JSONSerialization.jsonObject(with: oldTicketBytes) as! [String: Any])["quality_continuation"] == nil, "optional quality continuation is omitted on ordinary tickets")
    let continuation = C.QualityContinuation(parentAttemptID: "parent", parentNativeReceipt: "/tmp/native-receipts/parent.json",
        parentNativeReceiptSHA256: hash, witnessPath: "/tmp/quality-witnesses/parent.json", witnessSHA256: hash,
        expectedWorkspaceAfterSHA256: hash, originalInstructionSHA256: request.requestSHA256)
    ticket.qualityContinuation = continuation
    try check(try C.decodeTicket(C.encode(ticket)).qualityContinuation == continuation, "distinct quality continuation round trips")
    var wrong = ticket; wrong.qualityContinuation?.originalInstructionSHA256 = hash
    try reject("changed instruction SHA rejected before execution") { _ = try C.decodeTicket(C.encode(wrong)) }
    wrong = ticket; wrong.qualityContinuation?.correctiveAttempts = 2
    try reject("no second correction or implicit third attempt") { _ = try C.decodeTicket(C.encode(wrong)) }
    wrong = ticket; wrong.nativeResumeSessionID = "fixture-native"
    try reject("quality continuation cannot acquire permission/native-resume handback authority") { _ = try C.decodeTicket(C.encode(wrong)) }
    var q = C.OperationalQuality(coverage: .partial, assessmentState: .mismatch, contractSHA256: hash,
        witnessPath: "/tmp/quality-witnesses/parent.json", witnessSHA256: hash, artifactSHA256: hash,
        workspaceAfterSHA256: hash, failedCheckIDs: ["partial.original_unittest"], correctiveAttempts: 0, localOnlyVerified: false)
    var record = C.ExecutionRecord(taskID: request.taskID, nodeID: "node", attemptID: ticket.attemptID, candidateID: "candidate",
        configurationSHA256: hash, selectedConfig: config, acknowledgedConfig: config, observedConfig: nil,
        status: .succeeded, output: "Candidate output preserved", executionVerified: true, taskVerified: false,
        taskQuality: .failed, parityState: .unverified, nativeReceipt: "/tmp/native-receipts/parent.json", sideEffects: .confirmed,
        usage: nil, dispatchStage: .dispatched, nativeTurnTerminated: true, operationalQuality: q)
    try check(try C.decodeRecord(C.encode(record)).operationalQuality == q, "known finished failing operational witness is preserved")
    var inconsistent = record; inconsistent.parityState = .mismatch
    try reject("operational mismatch cannot launder reference parity state") { _ = try C.decodeRecord(C.encode(inconsistent)) }
    inconsistent = record; inconsistent.taskQuality = .executionOnly
    try reject("known check mismatch cannot be relabeled execution-only") { _ = try C.decodeRecord(C.encode(inconsistent)) }
    q.assessmentState = .unverified; q.failedCheckIDs = []; record.operationalQuality = q; record.taskQuality = .executionOnly
    try check(try C.decodeRecord(C.encode(record)).taskVerified == false, "partial pass/unverified cannot promote task or parity")
    record.operationalQuality?.assessmentState = .taskContractVerified
    try reject("partial coverage cannot claim full operational verification") { _ = try C.decodeRecord(C.encode(record)) }
    record.operationalQuality = q; record.operationalQuality?.coverage = .full; record.operationalQuality?.assessmentState = .referenceEquivalent
    try reject("operational descriptor cannot mint reference parity even with full coverage") { _ = try C.decodeRecord(C.encode(record)) }
    record.operationalQuality = q; record.nativeTurnTerminated = false
    try reject("unknown native termination cannot authorize quality continuation") { _ = try C.decodeRecord(C.encode(record)) }
    record.nativeTurnTerminated = true
    var object = try JSONSerialization.jsonObject(with: C.encode(record)) as! [String: Any]
    var injected = object["operational_quality"] as! [String: Any]; injected["grant_full_access"] = true; object["operational_quality"] = injected
    try reject("unknown authority keys remain rejected") { _ = try C.decodeRecord(JSONSerialization.data(withJSONObject: object)) }
    print("RCC operational quality wire: \(count) checks PASS; model calls0")
}
