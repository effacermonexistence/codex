import Foundation
import OS1Context

/// Core-owned intent admission, no config, HOME mutation, model or provider.
func runRCCCoreRoutingCompilerFixtures() throws {
    typealias C = RCCRuntimeContract
    typealias I = RCCCoreRoutingCompiler
    var count = 0
    func check(_ value: Bool, _ label: String) throws {
        guard value else { throw NSError(domain: "RCCCoreRoutingCompiler", code: 1,
            userInfo: [NSLocalizedDescriptionKey: label]) }; count += 1
    }
    func rejects(_ label: String, _ action: () throws -> Void) throws {
        do { try action() } catch { count += 1; return }
        throw NSError(domain: "RCCCoreRoutingCompiler", code: 2, userInfo: [NSLocalizedDescriptionKey: label])
    }
    let hash = C.digest(Data("fixture-policy".utf8))
    func task(_ text: String) throws -> C.Request {
        let host = C.HostContext(workspace: "/tmp/os1-core-intent-fixture", context: nil,
            providerPreference: "claude", codexSessionID: nil, claudeSessionID: nil,
            requireReadOnly: false, ownerPolicy: nil, capacityPlan: .init(codex: 0, claude: 100))
        return .init(taskID: "core-intent-fixture", request: text, requestSHA256: C.digest(Data(text.utf8)),
            objective: text, policySHA256: hash, sourceFingerprint: C.digest(try C.encode(host)), mode: .auto,
            materialRefs: [], budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 60_000), hostContext: host)
    }
    let order = try task("다 라우팅 해봐 1+1 2+2")
    let compiled = try I.compile(order)
    try check(compiled.kind == .routes && compiled.bestEffort, "all routes compiled inside task")
    try check(compiled.routes.map(\.surface) == [.local, .codex, .claude, .claudeChat], "all intended surfaces retained without availability filtering")
    try check(compiled.routes.map(\.instruction) == ["1+1", "2+2", "1+1", "2+2"], "exact source arithmetic preserved")
    try check(compiled.sourceFingerprint == order.sourceFingerprint && order.hostContext?.explicitRoutes == nil, "original source remains immutable")
    let named = try I.compile(task("1+1 코덱스한테. 2+2 로컬한테."))
    try check(named.kind == .routes && !named.bestEffort && named.routes.map(\.surface) == [.codex, .local], "named local routes exact and mandatory")
    let dropped = try I.compile(task("1+1 GPT한테. 2+2 코덱스한테."))
    try check(dropped.kind == .routes && dropped.routes.map(\.surface) == [.codex] && !dropped.notices.isEmpty, "GPT dropped visibly, not reintroduced")
    let allDropped = try I.compile(task("1+1 GPT한테. 2+2 ChatGPT한테."))
    try check(allDropped.kind == .hold && allDropped.routes.isEmpty && !allDropped.notices.isEmpty, "all GPT parts held visibly before catalog")
    let held = try I.compile(task("다 라우팅 해봐 아까 거"))
    try check(held.kind == .hold && held.routes.isEmpty, "pointed content held, not defaulted")
    let ordinary = try I.compile(task("이 파일 버그를 수정해"))
    try check(ordinary.kind == .ordinary && ordinary.routes.isEmpty, "ordinary work unchanged")
    let negative = try I.compile(task("엄마 아빠한테 다 보내봐 1+1"))
    try check(negative.kind != .routes && negative.kind != .needsModel, "human recipients do not become AI routes")
    var attached = order; attached.materialRefs = ["fixture-attachment"]
    try check(try I.compile(attached).kind == .ordinary, "material refs prevent arithmetic-only interpretation")
    let interpretation = try task("다 넘겨봐 1+1")
    let probe = try I.compile(interpretation)
    try check(probe.kind == .needsModel && probe.modelPrompt == RoutingOrderInterpreter.systemPrompt && probe.modelInput == "다 넘겨봐 1+1", "Core gets exact existing model prompt and canonical input")
    let wire = try probe.wireObject()
    try check(wire["model_schema_json"] as? String == RoutingOrderInterpreter.schemaJSON, "original schema property order survives canonical wire encoding")
    try check(NSDictionary(dictionary: wire["model_schema"] as! [String: Any]).isEqual(to: JSONSerialization.jsonObject(with: Data(RoutingOrderInterpreter.schemaJSON.utf8)) as! [String: Any]), "exact existing schema exported")
    let yes = #"{"kind":"route_all","expressions":["1+1"],"named":[],"excluded":[],"other_instruction":false,"sends_pointed_content":false}"#
    let admitted = try I.compile(interpretation, modelAnswer: yes)
    try check(admitted.kind == .routes && admitted.routes.count == 4, "canned local proposal admitted only through existing verifier")
    let invented = yes.replacingOccurrences(of: "1+1", with: "9+9")
    try check(try I.compile(interpretation, modelAnswer: invented).kind == .hold, "invented arithmetic rejected")
    try check(try I.compile(interpretation, modelAnswer: "not JSON").kind == .hold, "invalid model schema held")
    let envelope: [String: Any] = ["schema": 1, "task": try C.checkedObject(C.encode(interpretation)), "answer": yes]
    let output = try C.checkedObject(I.compileEnvelope(JSONSerialization.data(withJSONObject: envelope)))
    try check(output["kind"] as? String == "routes" && output["task_id"] as? String == interpretation.taskID, "bound native envelope")
    var badEnvelope = envelope; badEnvelope["extra"] = true
    try rejects("unknown envelope key rejected") { _ = try I.compileEnvelope(JSONSerialization.data(withJSONObject: badEnvelope)) }
    badEnvelope = envelope; badEnvelope["answer"] = NSNull()
    try rejects("answer must be an actual string when supplied") { _ = try I.compileEnvelope(JSONSerialization.data(withJSONObject: badEnvelope)) }
    badEnvelope = envelope; badEnvelope["schema"] = true
    try rejects("boolean schema rejected") { _ = try I.compileEnvelope(JSONSerialization.data(withJSONObject: badEnvelope)) }

    // The native side reconstructs and independently recompiles the source.
    var effective = interpretation
    effective.mode = .explicitRoutingTest
    effective.hostContext?.providerPreference = "auto"; effective.hostContext?.requireReadOnly = true
    effective.hostContext?.explicitRoutes = admitted.routes; effective.hostContext?.explicitRoutesBestEffort = true
    effective.sourceFingerprint = C.digest(try C.encode(effective.hostContext!))
    effective.coreRouting = .init(originalSourceFingerprint: interpretation.sourceFingerprint, originalMode: .auto,
        originalProviderPreference: interpretation.hostContext!.providerPreference,
        originalRequireReadOnly: interpretation.hostContext!.requireReadOnly,
        resolutionSHA256: try admitted.resolutionSHA256(modelAnswer: yes), modelAnswer: yes)
    try check(try C.decodeRequest(C.encode(effective)) == effective, "derived request revalidated and roundtripped")
    let config = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture-account",
        model: "fixture-model", effort: .low, tools: [], scope: .readOnly, permissionProfile: .readOnly,
        quotaPool: .openAICodex, allowedPaths: [], configurationSHA256: hash)
    var ticket = C.ExecutionTicket(taskID: effective.taskID, nodeID: "requested-2", attemptID: "fixture-attempt",
        candidateID: "fixture-candidate", requestSHA256: effective.requestSHA256, policySHA256: hash,
        policySourceSHA256: hash, sourceFingerprint: effective.sourceFingerprint,
        configurationSHA256: hash, selectedConfig: config, objective: "1+1", instruction: "1+1",
        contextRefs: [], ownedPaths: [], originalRequest: effective.request, originalObjective: effective.objective,
        hostContext: effective.hostContext, coreRouting: effective.coreRouting)
    try check(try C.decodeTicket(C.encode(ticket), request: effective) == ticket, "derived native ticket independently recompiled")
    ticket.instruction = "8+8"
    try rejects("ticket cannot replace derived payload") { try C.validate(ticket) }
    var wrong = effective; wrong.coreRouting?.resolutionSHA256 = String(repeating: "0", count: 64)
    try rejects("fabricated resolution hash rejected") { try C.validate(wrong) }
    wrong = effective; wrong.coreRouting?.modelAnswer = invented
    try rejects("changed proposal rejected") { try C.validate(wrong) }
    wrong = effective; wrong.hostContext?.workspace = "/tmp/other"; wrong.sourceFingerprint = C.digest(try C.encode(wrong.hostContext!))
    try rejects("changed workspace rejected by original host binding") { try C.validate(wrong) }
    wrong = effective; wrong.hostContext?.explicitRoutes?[0].instruction = "7+7"; wrong.sourceFingerprint = C.digest(try C.encode(wrong.hostContext!))
    try rejects("changed derived payload rejected by compiler") { try C.validate(wrong) }
    wrong = effective; wrong.hostContext?.requireReadOnly = false; wrong.sourceFingerprint = C.digest(try C.encode(wrong.hostContext!))
    try rejects("derived write scope forbidden") { try C.validate(wrong) }
    wrong = effective; wrong.coreRouting?.originalProviderPreference = "codex"
    try rejects("wrong original UI preference rejected") { try C.validate(wrong) }
    wrong = effective; wrong.coreRouting?.originalMode = .explicitRoutingTest
    try rejects("existing explicit contract cannot be silently reinterpreted") { try C.validate(wrong) }
    var raw = try C.checkedObject(C.encode(effective))
    var core = raw["core_routing"] as! [String: Any]; core["unchecked"] = true; raw["core_routing"] = core
    try rejects("unknown derivation field rejected") { _ = try C.decodeRequest(JSONSerialization.data(withJSONObject: raw)) }
    let summary = C.RoutingIntentSummary(state: .resolving, notices: [], reason: nil)
    let snap = C.Snapshot(taskID: interpretation.taskID, requestSHA256: interpretation.requestSHA256, state: .planning,
        revision: 1, children: [], result: nil, error: nil, routingIntent: summary)
    try check(try C.decodeSnapshot(C.encode(snap)).routingIntent == summary, "public intent progress decodes without model/raw source")
    var legacy = snap; legacy.routingIntent = nil
    try check(try C.decodeSnapshot(C.encode(legacy)).routingIntent == nil, "legacy snapshots still decode")
    print("RCC Core routing compiler: \(count) checks PASS; model/provider calls 0")
}
