import Foundation
import OS1Context

/// Actual pure Swift renderer + typed record encode/decode; synthetic data only.
func runRCCConfiguredInputObservationFixtures() throws {
    typealias C = RCCRuntimeContract
    var checks = 0
    func check(_ value: Bool, _ message: String) throws {
        guard value else { throw NSError(domain: "ConfiguredInputFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }; checks += 1
    }
    func reject(_ message: String, _ body: () throws -> Void) throws {
        do { try body() } catch { checks += 1; return }
        throw NSError(domain: "ConfiguredInputFixture", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
    }
    let hash = String(repeating: "a", count: 64), original = "Translate this defined source without adding a claim."
    let config = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture-account", model: "fixture-model", effort: .low,
        tools: ["read"], scope: .readOnly, permissionProfile: .readOnly, quotaPool: .openAICodex, allowedPaths: [], configurationSHA256: hash)
    let ticket = C.ExecutionTicket(taskID: UUID().uuidString.lowercased(), nodeID: "node-0", attemptID: UUID().uuidString.lowercased(), candidateID: "fixture",
        requestSHA256: C.digest(Data(original.utf8)), policySHA256: hash, policySourceSHA256: hash, sourceFingerprint: hash,
        configurationSHA256: hash, selectedConfig: config, objective: original, instruction: original, contextRefs: [], ownedPaths: [], originalRequest: original)
    let delegated = RCCDelegatedEnvelope.prompt(instruction: original, ownerRequest: original, continuation: nil, answerOnly: false,
        surface: config.surface, scope: config.scope, sourceCompletion: "", taskID: ticket.taskID, nodeID: ticket.nodeID, attemptID: ticket.attemptID)
    func observation(_ ticket: C.ExecutionTicket = ticket, input: String = "PRELOADED SOURCE + final delegated prompt", at: Int64 = 900,
                     catalogAt: Int64 = 800, channel: String = "codex_developer") throws -> RCCConfiguredInputObservation {
        try .init(ticket: ticket, delegatedInput: delegated, providerInput: input, instructions: "Actual synthetic developer instructions",
            baseInstructions: "Actual synthetic base projection", channel: channel, sessionState: "new", harnessSHA256: hash,
            launchEntrySHA256: hash, executionConfigurationSHA256: hash, catalogSHA256: hash, catalogObservedAtMS: catalogAt, preparedAtMS: at)
    }
    let prepared = try observation(), raw = try C.encode(prepared)
    let decoded = try JSONDecoder().decode(RCCConfiguredInputObservation.self, from: raw)
    try check(decoded == prepared, "pure observation roundtrip")
    try decoded.validate(ticket: ticket)
    let obj = try JSONSerialization.jsonObject(with: raw) as! [String: Any]
    try check(obj["model_answer"] == nil, "source identity does not masquerade as CoreRouting and inject model_answer")
    for key in ["input_tokens", "context_window_tokens", "tokenizer_id", "family", "capacity_upper_bound", "native_binary_sha256"] {
        try check(obj[key] is NSNull, "unknown stays explicit null: " + key)
    }
    try check(prepared.delegatedInput.sha256 == C.digest(Data(delegated.utf8)) && prepared.delegatedInput.utf8Bytes == delegated.utf8.count,
        "actual delegated UTF8 input, including fresh IDs, stays bound")
    try check(!String(decoding: raw, as: UTF8.self).contains(original) && !String(decoding: raw, as: UTF8.self).contains("Actual synthetic"), "no raw request/instructions copied")
    try check(!prepared.backendInclusionVerified && !prepared.qualityCertified && !prepared.executionAuthorized, "preparation is not delivery/quality/admission")
    let changed = try observation(input: "Changed actual providerPrompt body")
    try check(changed.providerInput != prepared.providerInput && changed.delegatedInput == prepared.delegatedInput, "channel identities remain separate")
    var foreign = ticket; foreign.taskID = UUID().uuidString.lowercased()
    try reject("foreign task") { try prepared.validate(ticket: foreign) }
    foreign = ticket; foreign.attemptID = UUID().uuidString.lowercased()
    try reject("foreign attempt") { try prepared.validate(ticket: foreign) }
    foreign = ticket; foreign.selectedConfig.effort = .high
    try reject("different tuple") { try prepared.validate(ticket: foreign) }
    try reject("catalog after preparation") { _ = try observation(at: 800, catalogAt: 900) }
    try reject("wrong native channel") { _ = try observation(channel: "claude_append_system") }
    foreign = ticket; foreign.originalRequest = "invented request"
    try reject("original request independently hashed") { _ = try observation(foreign) }
    for (key, value) in [("input_tokens", 100 as Any), ("context_window_tokens", 272000 as Any), ("family", "summary" as Any),
                         ("native_binary_sha256", hash as Any), ("tokenizer_id", "assumed" as Any), ("capacity_upper_bound", 42 as Any),
                         ("quality_certified", true as Any), ("backend_inclusion_verified", true as Any), ("execution_authorized", true as Any)] {
        var modified = obj; modified[key] = value
        try reject("no invented hidden state " + key) { _ = try JSONDecoder().decode(RCCConfiguredInputObservation.self,
            from: JSONSerialization.data(withJSONObject: modified)) }
    }
    var record = C.ExecutionRecord(taskID: ticket.taskID, nodeID: ticket.nodeID, attemptID: ticket.attemptID, candidateID: ticket.candidateID,
        configurationSHA256: hash, selectedConfig: config, acknowledgedConfig: nil, observedConfig: nil, status: .failed, output: nil,
        executionVerified: false, taskVerified: false, taskQuality: .unverified, parityState: .unverified, nativeReceipt: nil, sideEffects: .none, usage: nil,
        dispatchStage: .notDispatched, configuredInputObservation: prepared)
    let recordRaw = try C.encode(record), read = try C.decodeRecord(recordRaw, ticket: ticket)
    try check(read.configuredInputObservation == prepared && !read.executionVerified && !read.taskVerified, "real ExecutionRecord preserves failed-attempt metadata")
    var mutated = try JSONSerialization.jsonObject(with: recordRaw) as! [String: Any]
    var nested = mutated["configured_input_observation"] as! [String: Any]
    nested["provider_input"] = ["sha256": hash, "utf8_bytes": 2, "raw": "FORBIDDEN"]
    mutated["configured_input_observation"] = nested
    try reject("strict nested shape rejects raw text") { _ = try C.decodeRecord(JSONSerialization.data(withJSONObject: mutated), ticket: ticket) }
    record.configuredInputObservation = nil
    let legacy = try JSONSerialization.jsonObject(with: C.encode(record)) as! [String: Any]
    try check(legacy["configured_input_observation"] == nil, "missing legacy optional field stays omitted")
    print("RCC configured-input observation: \(checks) checks PASS; model/native calls 0; no token/quality/route claims")
}
