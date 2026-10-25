import Foundation
import OS1Context

/// Build 407-a/f wire facts: the signed (empty) class table, the deterministic
/// request class, the catalog's admission facts, the ticket's delegation flag
/// and the child quality disclosure. Pure: no provider, model, gateway or
/// live state; fixture observations only.
func runRCCAdmissionFactsFixtures() throws {
    typealias B = RCCNativeCatalogBuilder
    typealias C = RCCRuntimeContract
    typealias T = RCCClassTable
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "RCCAdmissionFactsFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    func reject(_ label: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { checks += 1; return }
        throw NSError(domain: "RCCAdmissionFactsFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: label])
    }
    func object(_ data: Data) throws -> [String: Any] { try JSONSerialization.jsonObject(with: data) as! [String: Any] }
    func json(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    // ---- Signed class table: ships empty, pinned, identical to the resource.
    let resource = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().appendingPathComponent("Resources/rcc-class-table.json")
    try check(try Data(contentsOf: resource) == T.frozenBytes, "the compiled-in table is byte-identical to Resources/rcc-class-table.json")
    try check(C.digest(T.frozenBytes) == T.pinnedSHA256, "the compiled-in table carries its pinned hash")
    try check(try T.decode(T.frozenBytes) == .empty && T.frozen == .empty, "the shipped table is empty: no class is certified or pinned")
    var unsigned = T.frozenBytes; unsigned.insert(0x20, at: 0)
    try reject("bytes that differ from the pin are never a table") { _ = try T.decode(unsigned) }
    func signed(_ value: [String: Any]) throws -> (Data, String) { let bytes = try json(value); return (bytes, C.digest(bytes)) }
    let measurement = C.digest(Data("frozen held-out measurement".utf8))
    let certificate: [String: Any] = ["certificate_id": "cert-chat-1", "provider": "codex", "model": "gpt-6-luna",
                                      "effort": "low", "format_check": "nonempty_text", "measurement_sha256": measurement]
    let (filledBytes, filledPin) = try signed(["schema": 1, "class_certificates": ["chat_explanatory": certificate],
                                               "class_provider_pins": ["writer": "claude"]])
    let filled = try T.decode(filledBytes, pinnedSHA256: filledPin)
    try check(filled.certificate(for: .chatExplanatory)?.model == "gpt-6-luna" && filled.certificate(for: .readonlyLookup) == nil &&
              filled.providerPin(for: .writer) == "claude" && filled.providerPin(for: .explicitRoute) == nil,
              "a signed table keys certificates and pins by request class")
    for (label, value) in [
        ("a writer certificate", ["schema": 1, "class_certificates": ["writer": certificate], "class_provider_pins": [:]]),
        ("an explicit-route pin", ["schema": 1, "class_certificates": [:], "class_provider_pins": ["explicit_route": "codex"]]),
        ("an unknown class", ["schema": 1, "class_certificates": ["deep": certificate], "class_provider_pins": [:]]),
        ("an extra table field", ["schema": 1, "class_certificates": [:], "class_provider_pins": [:], "note": "x"]),
        ("an extra certificate field", ["schema": 1, "class_certificates": ["chat_explanatory": certificate.merging(["score": 1]) { $1 }],
                                        "class_provider_pins": [:]]),
        ("a certificate at effort none", ["schema": 1, "class_certificates": ["chat_explanatory": certificate.merging(["effort": "none"]) { $1 }],
                                          "class_provider_pins": [:]]),
        ("schema 2", ["schema": 2, "class_certificates": [:], "class_provider_pins": [:]]),
    ] as [(String, [String: Any])] {
        let (bytes, pin) = try signed(value)
        try reject("a signed but malformed table is refused: \(label)") { _ = try T.decode(bytes, pinnedSHA256: pin) }
    }

    // ---- The deterministic request class (R0/R2) ---------------------------
    func cls(explicit: Bool = false, required: Bool = false, owner: C.Scope, chat: Bool = false, text: Bool = false,
             material: Bool = false) -> C.RequestClass {
        B.requestClass(explicitRoute: explicit, catalogReadOnly: required, ownerScope: owner, chatLaneEligible: chat,
                       textOperation: text, hasMaterial: material)
    }
    try check(cls(explicit: true, owner: .workspaceWrite) == .explicitRoute, "an explicit route test is its own class")
    try check(cls(owner: .workspaceWrite) == .writer, "no read-only signal: a writer (when unsure, a writer)")
    try check(cls(owner: .workspaceWrite, chat: true, text: true) == .textOperation, "a self-contained text operation")
    try check(cls(owner: .readOnly, chat: true) == .chatExplanatory, "a chat-lane question")
    try check(cls(owner: .readOnly, material: true) == .readonlyMaterial, "read-only work over attached material")
    try check(cls(owner: .readOnly) == .readonlyLookup && cls(required: true, owner: .workspaceWrite) == .readonlyLookup,
              "other read-only work is a lookup, including a host-required read-only task")
    try check(C.RequestClass.allCases.filter(\.certifiable) == [.chatExplanatory, .textOperation, .readonlyLookup, .readonlyMaterial],
              "only read-only classes can be certified")

    // ---- Catalog emission ------------------------------------------------
    let now = Date(timeIntervalSince1970: 1_790_000_000)
    let contractSHA = String(repeating: "c", count: 64)
    let policy = C.digest(Data("fixture policy".utf8))
    func input(_ request: String, owner: C.Scope?, chat: Bool = false, readOnly: Bool = false, material: Bool = false) -> B.Input {
        var value = B.Input(taskID: "task-fixture", requestSHA256: C.digest(Data(request.utf8)), request: request,
            providerPreference: "auto", requireReadOnly: readOnly, hasMaterialRefs: material, capacityPlan: nil,
            executorContractSHA256: contractSHA, now: now, showCodex: true, chatLaneEligible: chat,
            profiles: [.init(action: "a_astra_ultra", provider: "codex", model: "gpt-6-astra", effort: "ultra"),
                       .init(action: "b_fable_max", provider: "claude", model: "claude-fable-5-1", effort: "max")])
        value.codexModels = [.init(slug: "gpt-6-astra", supportedEfforts: ["ultra"], priority: 0)]
        value.claudeModels = [.init(model: "claude-fable-5-1", supportedEfforts: ["max"], nativeRank: 0)]
        value.auth = ["codex": .subscription, "claude": .subscription]
        value.accountIDs = ["codex": "acct-codex", "claude": "acct-claude"]
        value.ownerScope = owner
        return value
    }
    func request(_ text: String, readOnly: Bool = false, context: String? = nil, materials: [String] = [],
                 mode: C.Mode = .auto) throws -> C.Request {
        let host = C.HostContext(workspace: "/tmp/rcc-admission-fixture", context: context, providerPreference: "auto",
            codexSessionID: nil, claudeSessionID: nil, requireReadOnly: readOnly, ownerPolicy: nil)
        return C.Request(taskID: "task-fixture", request: text, requestSHA256: C.digest(Data(text.utf8)), objective: text,
            policySHA256: policy, sourceFingerprint: C.digest(try C.encode(host)), mode: mode, materialRefs: materials,
            budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 20_000), hostContext: host)
    }
    func catalog(_ value: B.Input) throws -> Data {
        try B.catalogData(B.build(value), taskID: value.taskID, requestSHA256: value.requestSHA256)
    }
    let factKeys: Set<String> = ["owner_scope", "chat_lane_eligible", "request_class", "task_contract",
                                 "class_certificates", "class_provider_pins"]
    let writeText = "Fix the login bug in Sources/App.swift"
    let legacy = try object(catalog(input(writeText, owner: nil)))
    try check(factKeys.isDisjoint(with: legacy.keys), "a host without an owner scope (before 407) emits no admission facts")
    let writerBytes = try catalog(input(writeText, owner: .workspaceWrite))
    let writer = try object(writerBytes)
    try check(writer["owner_scope"] as? String == "workspace_write" && writer["chat_lane_eligible"] as? Bool == false &&
              writer["request_class"] as? String == "writer" && writer["task_contract"] == nil &&
              writer["class_certificates"] == nil && writer["class_provider_pins"] == nil,
              "a writer catalog carries its facts and no contract, certificate or pin")
    try check(try json(writer.filter { !factKeys.contains($0.key) }) == json(legacy),
              "facts never add, remove or reorder a row or another catalog field")
    let writerCatalog = try C.decodeCatalog(writerBytes, request: try request(writeText))
    try check(writerCatalog.requestClass == .writer && writerCatalog.ownerScope == .workspaceWrite &&
              (try C.decodeCatalog(C.encode(writerCatalog))) == writerCatalog, "the facts decode and re-encode unchanged")

    let questionText = "co가 무슨 뜻이야?"
    var question = input(questionText, owner: .readOnly, chat: true)
    let questionRequest = try request(questionText, context: "prior turn")
    let fact = C.TaskContractFact(coverage: .full, scope: .readOnly, objectiveSHA256: questionRequest.requestSHA256,
        contractSHA256: C.digest(Data("contract".utf8)), contextSHA256: C.digest(Data("prior turn".utf8)), sourceSHA256: nil,
        startTreeSHA256: C.digest(Data("tree".utf8)), referencePolicySHA256: policy, validUntilMS: 1_790_000_600_000)
    question.taskContract = fact
    question.classTable = filled
    let questionBytes = try catalog(question)
    let questionCatalog = try C.decodeCatalog(questionBytes, request: questionRequest)
    try check(questionCatalog.requestClass == .chatExplanatory && questionCatalog.chatLaneEligible == true &&
              questionCatalog.taskContract == fact && questionCatalog.classCertificates?.keys.sorted() == ["chat_explanatory"] &&
              questionCatalog.classProviderPins == nil,
              "a chat question carries its contract and only its own class certificate (the writer pin stays in the table)")
    let contractObject = try object(questionBytes)["task_contract"] as! [String: Any]
    try check(contractObject["bindings_checked"] as? Bool == true && contractObject["source_sha256"] == nil &&
              contractObject["valid_until_ms"] as? Int64 == 1_790_000_600_000, "the contract travels with its full bindings")
    var pinnedWriter = input(writeText, owner: .workspaceWrite); pinnedWriter.classTable = filled
    let pinned = try C.decodeCatalog(catalog(pinnedWriter), request: try request(writeText))
    try check(pinned.classProviderPins == ["writer": "claude"] && pinned.classCertificates == nil,
              "a writer gets its class pin but never a certificate")
    try check(B.admissionFacts(input(writeText, owner: .workspaceWrite, readOnly: true))?.requestClass == .readonlyLookup,
              "a host-required read-only task is never a writer")
    // A request whose own resolved scope is read-only gets no writer row, so
    // it is never a writer class either, whatever the owner-scope verdict.
    let fencedText = "Explain the login function. 파일 수정, 테스트 실행, 배포는 하지 마."
    let fenced = input(fencedText, owner: .workspaceWrite)
    try check(ScopeResolution.resolve(fencedText).scope == .readOnly &&
              (try B.build(fenced)).candidates.allSatisfy { $0["scope"] as? String == "read_only" } &&
              B.admissionFacts(fenced)?.requestClass == .readonlyLookup,
              "a writer class always has writer rows to bind")
    let attachedText = "Summarize the attached notes."
    try check(try C.decodeCatalog(catalog(input(attachedText, owner: .readOnly, material: true)),
                                  request: try request(attachedText, materials: ["material-1"])).requestClass == .readonlyMaterial,
              "attached material makes a read-only material class")

    // ---- Catalog rejections (strict wire and agreement) --------------------
    let base = try object(questionBytes)
    func rejectCatalog(_ label: String, against: C.Request? = nil, _ change: (inout [String: Any]) -> Void) throws {
        var value = base; change(&value)
        let bytes = try json(value)
        try reject("catalog: \(label)") { _ = try C.decodeCatalog(bytes, request: against) }
    }
    try rejectCatalog("facts not together") { $0.removeValue(forKey: "chat_lane_eligible") }
    try rejectCatalog("a contract without facts") {
        for key in ["owner_scope", "chat_lane_eligible", "request_class", "class_certificates"] { $0.removeValue(forKey: key) }
    }
    try rejectCatalog("an unknown class") { $0["request_class"] = "deep" }
    try rejectCatalog("a writer that is chat-eligible") { $0["request_class"] = "writer"; $0["owner_scope"] = "workspace_write"
        $0.removeValue(forKey: "class_certificates") }
    try rejectCatalog("a chat class that is not chat-eligible") { $0["chat_lane_eligible"] = false }
    try rejectCatalog("explicit_route outside an explicit route test", against: questionRequest) {
        $0["request_class"] = "explicit_route"; $0.removeValue(forKey: "class_certificates")
    }
    try rejectCatalog("material class without material", against: questionRequest) {
        $0["request_class"] = "readonly_material"; $0["chat_lane_eligible"] = false
        $0["class_certificates"] = ["readonly_material": certificate]
    }
    func contractChange(_ key: String, _ value: Any?) -> (inout [String: Any]) -> Void {
        { catalog in var c = catalog["task_contract"] as! [String: Any]; c[key] = value; catalog["task_contract"] = c }
    }
    try rejectCatalog("a contract for another objective", contractChange("objective_sha256", C.digest(Data("x".utf8))))
    try rejectCatalog("a contract not re-checked", contractChange("bindings_checked", false))
    try rejectCatalog("a contract with an extra field", contractChange("local_only", true))
    try rejectCatalog("a contract with a malformed hash", contractChange("start_tree_sha256", "tree"))
    try rejectCatalog("a contract under another policy", against: questionRequest,
                      contractChange("reference_policy_sha256", C.digest(Data("p".utf8))))
    try rejectCatalog("a contract bound to another context", against: questionRequest,
                      contractChange("context_sha256", C.digest(Data("".utf8))))
    try rejectCatalog("a certificate keyed by another class") { $0["class_certificates"] = ["readonly_lookup": certificate] }
    try rejectCatalog("a certificate with an extra field") {
        $0["class_certificates"] = ["chat_explanatory": certificate.merging(["score": 1]) { $1 }]
    }
    try rejectCatalog("two certificates") { $0["class_certificates"] = ["chat_explanatory": certificate, "text_operation": certificate] }
    try rejectCatalog("a pin keyed by another class") { $0["class_provider_pins"] = ["writer": "codex"] }
    try rejectCatalog("a pin to an unknown pool") { $0["class_provider_pins"] = ["chat_explanatory": "gpt"] }

    // ---- Ticket delegation flag (K13: reserved, refused, always managed) ----
    let host = questionRequest.hostContext!
    let config = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "acct-codex", model: "gpt-6-astra",
        effort: .ultra, tools: ["read", "execute"], scope: .readOnly, permissionProfile: .readOnly, quotaPool: .openAICodex,
        allowedPaths: [], configurationSHA256: C.digest(Data("config".utf8)))
    var ticket = C.ExecutionTicket(taskID: questionRequest.taskID, nodeID: "n", attemptID: "attempt-1", candidateID: "cfg-1",
        requestSHA256: questionRequest.requestSHA256, policySHA256: policy, policySourceSHA256: policy,
        sourceFingerprint: questionRequest.sourceFingerprint, configurationSHA256: config.configurationSHA256,
        selectedConfig: config, objective: questionText, instruction: questionText, contextRefs: [], ownedPaths: [],
        originalRequest: questionText, originalObjective: questionText, hostContext: host)
    let legacyTicket = try C.decodeTicket(C.encode(ticket))
    try check(legacyTicket.allowNativeSubagents == nil &&
              (try object(C.encode(ticket)))["allow_native_subagents"] == nil, "a ticket without the flag stays managed")
    ticket.allowNativeSubagents = false
    try check(try C.decodeTicket(C.encode(ticket)).allowNativeSubagents == false, "an explicit false flag decodes and stays managed")
    try C.validate(ticket); checks += 1
    ticket.allowNativeSubagents = true
    try reject("no native adapter enforces delegation before dispatch (K13): decode refuses the flag") {
        _ = try C.decodeTicket(C.encode(ticket))
    }
    try reject("no native adapter enforces delegation before dispatch (K13): validate refuses the flag") { try C.validate(ticket) }
    var chatTicket = ticket; chatTicket.selectedConfig.surface = .claudeChat; chatTicket.selectedConfig.transport = .claudeCLI
    chatTicket.selectedConfig.quotaPool = .anthropicShared; chatTicket.selectedConfig.tools = []
    var chatManaged = chatTicket; chatManaged.allowNativeSubagents = nil
    try C.validate(chatManaged); checks += 1
    try reject("a tool-free chat lane has no sub-agents to allow") { try C.validate(chatTicket) }
    var mistyped = try object(C.encode(ticket)); mistyped["allow_native_subagents"] = "yes"
    try reject("the flag is never coerced from a string") { _ = try C.decodeTicket(json(mistyped)) }

    // ---- Child quality disclosure (R6) --------------------------------------
    let disclosure = C.QualityDisclosure(coverage: .partial, failedCheckIDs: ["partial.candidate_unittest"],
                                         witnessSHA256: C.digest(Data("witness".utf8)))
    let result = C.Result(output: "answer", executionVerified: true, taskVerified: false, parityState: .unverified,
                          nativeReceipt: "/private/fixture/receipt")
    let snapshot = C.Snapshot(taskID: questionRequest.taskID, requestSHA256: questionRequest.requestSHA256,
        state: .returnedUnverified, revision: 3,
        children: [.init(id: "n", state: .completed, attemptID: "attempt-1", candidateID: "cfg-1", qualityDisclosure: disclosure)],
        result: result, error: nil)
    try check(try C.decodeSnapshot(C.encode(snapshot)) == snapshot, "a delivered output carries its disclosure")
    var unavailable = snapshot
    unavailable.children[0].qualityDisclosure = .init(coverage: nil, failedCheckIDs: [], checker: .unavailable)
    try check(try C.decodeSnapshot(C.encode(unavailable)) == unavailable, "an unavailable checker is disclosed, not held")
    var verifierFailed = snapshot
    verifierFailed.children[0].qualityDisclosure = .init(coverage: nil, failedCheckIDs: ["node_verifier"])
    try check(try C.decodeSnapshot(C.encode(verifierFailed)) == verifierFailed,
              "a failed node verifier with no operational check is disclosed by its failed check id")
    var bad = snapshot; bad.children[0].state = .held
    try reject("a held child carries no disclosure") { try C.validate(bad) }
    bad = snapshot; bad.children[0].qualityDisclosure = .init(coverage: nil, failedCheckIDs: [])
    try reject("a disclosure names a coverage, a checker state or a failed check") { try C.validate(bad) }
    bad = snapshot; bad.children[0].qualityDisclosure?.witnessSHA256 = "witness"
    try reject("a disclosure witness is a hash") { try C.validate(bad) }
    bad = snapshot; bad.children[0].qualityDisclosure?.failedCheckIDs = ["a", "a"]
    try reject("failed check ids are unique") { try C.validate(bad) }
    var verified = snapshot; verified.state = .completed; verified.result?.taskVerified = true
    verified.result?.taskQuality = .taskVerified
    try reject("a task-verified (completed) task carries no disclosure") { try C.validate(verified) }
    var extra = try object(C.encode(snapshot))
    var children = extra["children"] as! [[String: Any]]
    var disclosed = children[0]["quality_disclosure"] as! [String: Any]; disclosed["verdict"] = "pass"
    children[0]["quality_disclosure"] = disclosed; extra["children"] = children
    try reject("a disclosure has no extra field") { _ = try C.decodeSnapshot(json(extra)) }

    print("RCC admission facts (407-a/f): \(checks) table/class/catalog/ticket/disclosure checks PASS; provider calls 0")
}
