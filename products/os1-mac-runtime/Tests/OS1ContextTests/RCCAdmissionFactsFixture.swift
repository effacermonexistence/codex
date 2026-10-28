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

    // ---- Signed class table (build 440): ONE owner-decision certificate,
    // chat_explanatory only, pinned, identical to the resource.
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()
    let resource = root.appendingPathComponent("Resources/rcc-class-table.json")
    try check(try Data(contentsOf: resource) == T.frozenBytes, "the compiled-in table is byte-identical to Resources/rcc-class-table.json")
    try check(C.digest(T.frozenBytes) == T.pinnedSHA256, "the compiled-in table carries its pinned hash")
    typealias D = RCCClassOwnerDecision
    let ownerCertificate = C.ClassCertificate(certificateID: "owner-chat-fast-20261027", provider: "codex", model: "gpt-6-luna",
                                              effort: .low, formatCheck: "nonempty_text", measurementSHA256: D.pinnedSHA256)
    try check(try T.decode(T.frozenBytes) == T(classCertificates: ["chat_explanatory": ownerCertificate], classProviderPins: [:]) &&
              T.frozen == (try T.decode(T.frozenBytes)),
              "the shipped table certifies chat_explanatory for (codex, gpt-6-luna, low, nonempty_text) by the owner decision and pins nothing")
    try check(C.RequestClass.allCases.filter { T.frozen.certificate(for: $0) != nil } == [.chatExplanatory] &&
              C.RequestClass.allCases.allSatisfy { T.frozen.providerPin(for: $0) == nil },
              "exactly ONE class is certified (not text_operation, lookup, material, writer or explicit_route)")
    // The owner decision the certificate names: compiled bytes, pinned hash,
    // byte-identical reviewable resource, the date, the owner's words, the one
    // class and the exact tuple.
    try check(try Data(contentsOf: root.appendingPathComponent("Resources/rcc-class-owner-decision.json")) == D.frozenBytes,
              "the compiled owner decision is byte-identical to Resources/rcc-class-owner-decision.json")
    try check(C.digest(D.frozenBytes) == D.pinnedSHA256 && D.requestClass == .chatExplanatory,
              "the compiled owner decision carries its pinned hash and certifies chat_explanatory only")
    let decisionObject = try JSONSerialization.jsonObject(with: D.frozenBytes) as! [String: Any]
    try check(decisionObject["kind"] as? String == "os1_rcc_class_owner_decision_v1" &&
              decisionObject["decided_on"] as? String == "2026-10-27" &&
              decisionObject["request_class"] as? String == "chat_explanatory" &&
              decisionObject["tuple"] as? [String: String] == ["provider": "codex", "model": "gpt-6-luna", "effort": "low"] &&
              decisionObject["format_check"] as? String == "nonempty_text" &&
              (decisionObject["owner_words"] as? [String])?.contains("왜 이게 안 고쳐지는데") == true,
              "the owner decision names the date, the owner's words, the one class and the exact tuple")
    var unsigned = T.frozenBytes; unsigned.insert(0x20, at: 0)
    try reject("bytes that differ from the pin are never a table") { _ = try T.decode(unsigned) }
    func signed(_ value: [String: Any]) throws -> (Data, String) { let bytes = try json(value); return (bytes, C.digest(bytes)) }
    // K11: the certificate names its D4 measurement artifact by hash. The
    // artifact is scoped to the certificate, the fixture pool's reference
    // (codex gpt-6-astra at its native ceiling ultra), the executor contract
    // and a fixture harness, inside a validity window around `now`.
    let contractSHA = String(repeating: "c", count: 64)
    let harness = "h0-fixture"
    let measurementArtifact: [String: Any] = ["schema": 1, "kind": "os1_rcc_class_measurement_v1",
        "certificate_id": "cert-chat-1", "request_class": "chat_explanatory",
        "tuple": ["provider": "codex", "model": "gpt-6-luna", "effort": "low"], "format_check": "nonempty_text",
        "reference": ["provider": "codex", "model": "gpt-6-astra", "effort": "ultra"],
        "executor_contract_sha256": contractSHA, "harness_scope": harness,
        "issued_at_ms": Int64(1_789_000_000_000), "valid_until_ms": Int64(1_791_000_000_000),
        "result": ["verdict": "pass", "n": 60, "accepted_b": 0, "hard_check_regressions": 0,
                   "tier_disagreement": 2, "reference_aa_disagreement": 3],
        "evidence_sha256": C.digest(Data("frozen held-out measurement".utf8))]
    let artifactBytes = try json(measurementArtifact)
    let measurement = C.digest(artifactBytes)
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
                                 "class_certificates", "class_provider_pins", "request_profile"]
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
    question.classMeasurements = [measurement: artifactBytes]
    question.harnessProfile = harness
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

    // ---- K11: a table certificate loads only with its verified D4 artifact --
    typealias M = RCCClassMeasurement
    // The chat question with the certified tuple's own row offered (luna low);
    // `reference: false` drops the frontier profile, so codex records
    // reference_unavailable and has no current reference.
    func k11(_ table: T, _ artifacts: [String: Data], harness profile: String? = harness, at: Date = now,
             reference: Bool = true) -> B.Input {
        var value = input(questionText, owner: .readOnly, chat: true)
        value.taskContract = fact
        value.profiles.append(.init(action: "c_luna_low", provider: "codex", model: "gpt-6-luna", effort: "low"))
        value.codexModels.append(.init(slug: "gpt-6-luna", supportedEfforts: ["low"], priority: 1))
        if !reference { value.profiles.removeAll { $0.model == "gpt-6-astra" } }
        value.classTable = table; value.classMeasurements = artifacts; value.harnessProfile = profile; value.now = at
        return value
    }
    // A changed artifact with its own re-signed, re-pinned table: the
    // certificate names exactly that artifact, so only the changed check fails.
    func measured(_ change: (inout [String: Any]) -> Void, raw: ((Data) -> Data)? = nil) throws -> (T, [String: Data]) {
        var value = measurementArtifact; change(&value)
        var bytes = try json(value)
        if let raw { bytes = raw(bytes) }
        let hash = C.digest(bytes)
        let (tableBytes, pin) = try signed(["schema": 1, "class_provider_pins": ["writer": "claude"],
            "class_certificates": ["chat_explanatory": certificate.merging(["measurement_sha256": hash]) { $1 }]])
        return (try T.decode(tableBytes, pinnedSHA256: pin), [hash: bytes])
    }
    func field(_ key: String, _ value: Any?) -> (inout [String: Any]) -> Void { { $0[key] = value } }
    func inner(_ key: String, _ name: String, _ value: Any?) -> (inout [String: Any]) -> Void {
        { artifact in var nested = artifact[key] as! [String: Any]; nested[name] = value; artifact[key] = nested }
    }
    func facts(_ value: B.Input) throws -> B.AdmissionFacts { let output = try B.build(value); return output.admission! }
    func outcome(_ value: B.Input) throws -> M.Rejection? {
        let found = try facts(value)
        return found.classCertificate == nil ? found.classCertificateRejection : nil
    }
    func expect(_ reason: M.Rejection?, _ label: String, _ change: @escaping (inout [String: Any]) -> Void,
                raw: ((Data) -> Data)? = nil, at: Date = now) throws {
        let (table, artifacts) = try measured(change, raw: raw)
        let got = try outcome(k11(table, artifacts, at: at))
        try check(got == reason, "K11 \(label): \(reason?.rawValue ?? "loaded"), got \(got?.rawValue ?? "loaded")")
    }
    let signedCertificate = filled.certificate(for: .chatExplanatory)!
    try check(Set(M.Rejection.allCases.map(\.rawValue)) == ["artifact_absent", "hash_mismatch", "malformed", "scope_mismatch",
        "reference_mismatch", "executor_mismatch", "harness_mismatch", "not_yet_valid", "expired", "result_not_pass"],
        "K11 names every rejection by a stable reason")
    try check(M.harnessScope(HarnessProfile.current) == "H1@1",
              "K11 binds the shipped harness by id AND version (a new descriptor never inherits a measurement)")

    // K11-a valid: loaded, and the wire is exactly today's certificate emission.
    let valid = k11(filled, [measurement: artifactBytes])
    let validFacts = try facts(valid)
    try check(validFacts.classCertificate == signedCertificate && validFacts.classCertificateRejection == nil,
              "K11-a: a verified artifact loads the class certificate")
    let validBytes = try catalog(valid)
    var bare = valid; bare.classTable = .empty
    var expected = try object(catalog(bare)); expected["class_certificates"] = ["chat_explanatory": certificate]
    try check(try json(object(validBytes)) == json(expected) && validBytes == (try json(expected)),
              "K11-a: the catalog wire is unchanged (the same certificate object, no new key)")
    try check(try C.decodeCatalog(validBytes, request: questionRequest).classCertificates == ["chat_explanatory": signedCertificate],
              "K11-a: Core's contract accepts the emitted certificate")

    // K11-b the shipped table (build 440: its one owner-decision
    // certificate): no custody artifact changes a catalog byte. "co가 무슨
    // 뜻이야?" is a knowledge question, outside the decision's state-only
    // scope (440-d), so the certificate drops; a custody file cannot bring it
    // back. The scope's own loads are 440-a and 440-d.
    var shipped = valid; shipped.classTable = .frozen
    var shippedBare = shipped; shippedBare.classMeasurements = [:]
    var shippedForged = shipped; shippedForged.classMeasurements = [D.pinnedSHA256: artifactBytes]
    let shippedFacts = try facts(shipped)
    try check(shippedFacts.classCertificate == nil && shippedFacts.classCertificateRejection == .scopeMismatch &&
              (try catalog(shipped)) == (try catalog(shippedBare)) && (try catalog(shipped)) == (try catalog(shippedForged)),
              "K11-b: with the shipped table a custody artifact changes no catalog byte")

    // K11-c absent artifact: only the certificate drops; every other fact stays.
    let absent = k11(filled, [:])
    try check(try outcome(absent) == .artifactAbsent, "K11-c: no artifact, no certificate")
    var absentBare = absent; absentBare.classTable = .empty
    let absentObject = try object(catalog(absent))
    try check((try catalog(absent)) == (try catalog(absentBare)) && absentObject["owner_scope"] as? String == "read_only" &&
              absentObject["request_class"] as? String == "chat_explanatory" && absentObject["chat_lane_eligible"] as? Bool == true &&
              absentObject["task_contract"] != nil && absentObject["class_certificates"] == nil,
              "K11-c: owner scope, class, chat flag and contract are emitted unchanged")
    var pinnedChat = absent
    pinnedChat.classTable = RCCClassTable(classCertificates: filled.classCertificates, classProviderPins: ["chat_explanatory": "claude"])
    let pinnedFacts = try facts(pinnedChat)
    try check(pinnedFacts.classProviderPin == "claude" && pinnedFacts.classCertificate == nil,
              "K11-c: a class pin is not a quality descent and stays when the certificate drops")

    // K11-d hash binding.
    var appended = artifactBytes; appended.append(0x20)
    try check(try outcome(k11(filled, [measurement: appended])) == .hashMismatch, "K11-d: one appended byte is another artifact")
    let other = try json(measurementArtifact.merging(["result": ["verdict": "pass", "n": 61, "accepted_b": 0,
        "hard_check_regressions": 0, "tier_disagreement": 2, "reference_aa_disagreement": 3]]) { $1 })
    try check(try outcome(k11(filled, [measurement: other])) == .hashMismatch,
              "K11-d: a different (even passing) artifact under the named hash is refused")

    // K11-e validity window (now = 1_790_000_000_000 ms).
    try expect(.expired, "valid_until == now", field("valid_until_ms", Int64(1_790_000_000_000)))
    try expect(nil, "valid_until == now + 1 ms", field("valid_until_ms", Int64(1_790_000_000_001)))
    try expect(.notYetValid, "issued_at == now + 1 ms", field("issued_at_ms", Int64(1_790_000_000_001)))
    try expect(nil, "issued_at == now", field("issued_at_ms", Int64(1_790_000_000_000)))
    try check(try outcome(k11(filled, [measurement: artifactBytes], at: Date(timeIntervalSince1970: 1_791_000_000))) == .expired &&
              outcome(k11(filled, [measurement: artifactBytes], at: Date(timeIntervalSince1970: 1_788_000_000))) == .notYetValid,
              "K11-e: the host clock at catalog build decides the window")

    // K11-f scope: the artifact must be this certificate's own measurement.
    try expect(.scopeMismatch, "another request class", field("request_class", "text_operation"))
    try expect(.scopeMismatch, "another tuple model", inner("tuple", "model", "gpt-6.1-sol"))
    try expect(.scopeMismatch, "another tuple effort", inner("tuple", "effort", "medium"))
    try expect(.scopeMismatch, "another tuple provider", inner("tuple", "provider", "claude"))
    try expect(.scopeMismatch, "another format check", field("format_check", "exact_json"))
    try expect(.scopeMismatch, "another certificate id", field("certificate_id", "other"))

    // K11-g reference: measured against the pool's CURRENT frontier ceiling.
    try expect(.referenceMismatch, "a reference below the native ceiling", inner("reference", "effort", "max"))
    try expect(.referenceMismatch, "a workhorse reference", inner("reference", "model", "gpt-6.1-sol"))
    try expect(.referenceMismatch, "another pool's reference",
               field("reference", ["provider": "claude", "model": "claude-fable-5-1", "effort": "max"]))
    let held = k11(filled, [measurement: artifactBytes], reference: false)
    try check(try B.build(held).exclusions.contains { $0.provider == "codex" && $0.reason == "reference_unavailable" } &&
              outcome(held) == .referenceMismatch, "K11-g: a pool without a current reference loads no certificate")

    // K11-h executor contract and harness profile.
    try expect(.executorMismatch, "another executor contract", field("executor_contract_sha256", String(repeating: "d", count: 64)))
    try check(try outcome(k11(filled, [measurement: artifactBytes], harness: nil)) == .harnessMismatch,
              "K11-h: no harness profile, no certificate")
    try check(try outcome(k11(filled, [measurement: artifactBytes], harness: "h1")) == .harnessMismatch,
              "K11-h: a measurement under another harness does not load")
    // One encoding: the scope travels as `harness_scope` (id@version, the
    // pre-dispatch receipt's key), never as the receipt's bare-id key.
    try expect(.malformed, "the harness under the receipt's bare-id key",
               { artifact in let scope = artifact.removeValue(forKey: "harness_scope"); artifact["harness_profile"] = scope })

    // K11-i the measurement must PASS the class law.
    try expect(.resultNotPass, "verdict fail", inner("result", "verdict", "fail"))
    try expect(.resultNotPass, "59 cases", inner("result", "n", 59))
    try expect(.resultNotPass, "an accepted_B", inner("result", "accepted_b", 1))
    try expect(.resultNotPass, "a hard-check regression", inner("result", "hard_check_regressions", 1))
    try expect(.resultNotPass, "tier disagreement above the reference's A/A", inner("result", "tier_disagreement", 4))
    try expect(.resultNotPass, "a negative disagreement", inner("result", "tier_disagreement", -1))
    try expect(.resultNotPass, "A/A disagreement above n", inner("result", "reference_aa_disagreement", 61))
    try expect(.resultNotPass, "an evidence pointer that is not a hash", field("evidence_sha256", "evidence"))

    // K11-j strict shape.
    try expect(.malformed, "an extra top-level key", field("note", "x"))
    try expect(.malformed, "a missing key", field("evidence_sha256", nil))
    try expect(.malformed, "an extra result key", inner("result", "score", 1))
    try expect(.malformed, "an extra reference key", inner("reference", "scope", "read_only"))
    try expect(.malformed, "schema 2", field("schema", 2))
    try expect(.malformed, "an unknown kind", field("kind", "os1_rcc_class_measurement_v2"))
    try expect(.malformed, "a bool for an integer", field("issued_at_ms", true))
    try expect(.malformed, "a fraction for an integer", field("issued_at_ms", 1.5))
    try expect(.malformed, "a string for an integer", inner("result", "n", "60"))
    try expect(.malformed, "an executor contract that is not a hash", field("executor_contract_sha256", "contract"))
    try expect(.malformed, "a duplicate key", { _ in }, raw: { Data(("{\"schema\":1," + String(decoding: $0.dropFirst(), as: UTF8.self)).utf8) })
    try expect(.malformed, "not JSON", { _ in }, raw: { _ in Data("measurement".utf8) })

    // K11-k a direct caller that computed no reference never gets a certificate.
    let direct = B.admissionFacts(valid)
    try check(direct?.classCertificate == nil && direct?.classCertificateRejection == .referenceMismatch,
              "K11-k: admissionFacts without references fails closed")

    // K11-l host custody path.
    let home = URL(fileURLWithPath: "/Users/fixture", isDirectory: true)
    try check(M.custodyPath(home: home, sha256: measurement)?.path ==
              "/Users/fixture/.os1/rcc-runtime/class-measurements/\(measurement).json",
              "K11-l: the artifact lives under the host's class-measurements directory by its hash")
    try check(M.custodyPath(home: home, sha256: "../" + measurement.dropLast(3)) == nil &&
              M.custodyPath(home: home, sha256: measurement.uppercased()) == nil && M.custodyPath(home: home, sha256: "") == nil,
              "K11-l: only a lowercase SHA-256 names a custody file")

    // ---- Build 440: the owner-decision certificate (owner order 2026-10-27) --
    // Production-like observations: the signed Codex profiles of the reference
    // (astra ultra), the certified tuple (luna low) and Claude's reference
    // (fable max), both pools signed in with fresh quota, the shipped harness.
    let invitationText = "자 이제 네가 얼마나 잘 되는지 보자"
    try check(StatusCheckIn.answersFromCard(invitationText) && !ClaudeChatLane.selfContainedTextOperation(invitationText),
              "440: the owner's test invitation is a card check-in, not a text operation (the chat_explanatory class)")
    let shippedHarness = M.harnessScope(HarnessProfile.current)
    func live(_ text: String, owner scope: C.Scope = .readOnly, chat: Bool = false, readOnly: Bool = false,
              explicit: [String]? = nil, table: T = .frozen, harness profile: String? = shippedHarness,
              reference: Bool = true) -> B.Input {
        var value = input(text, owner: scope, chat: chat, readOnly: readOnly)
        value.profiles = [.init(action: "cx_6astra_ultra", provider: "codex", model: "gpt-6-astra", effort: "ultra"),
                          .init(action: "cx_6luna_low", provider: "codex", model: "gpt-6-luna", effort: "low"),
                          .init(action: "cl_fable_max", provider: "claude", model: "claude-fable-5-1", effort: "max")]
        if !reference { value.profiles.removeAll { $0.model == "gpt-6-astra" } }
        value.codexModels = [.init(slug: "gpt-6-astra", supportedEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"], priority: 0),
                             .init(slug: "gpt-6-luna", supportedEfforts: ["low", "medium", "high", "xhigh", "max"], priority: 1)]
        value.codexQuota = .init(accountID: "acct-codex", observedAt: now, source: .codexNative,
                                 windows: [.init(bucket: "weekly", usedPercent: 40, resetsAt: now.addingTimeInterval(3600))])
        value.claudeQuota = .init(accountID: "acct-claude", observedAt: now, source: .claudeNative,
                                  windows: [.init(bucket: "weekly_all", usedPercent: 40, resetsAt: now.addingTimeInterval(3600))])
        value.explicitRouteSurfaces = explicit
        value.classTable = table; value.harnessProfile = profile
        return value
    }
    // (a) chat_explanatory with the shipped table: the certificate loads with
    // no custody artifact, and the catalog offers the certified tuple's own
    // read-only Codex row (the Codex agent row that runs as GPT chat).
    let chatLive = live(invitationText, chat: true)
    let chatFacts = try facts(chatLive)
    try check(chatFacts.requestClass == .chatExplanatory && chatFacts.classCertificate == ownerCertificate &&
              chatFacts.classCertificateRejection == nil, "440-a: chat_explanatory loads the owner-decision certificate")
    let chatLiveBytes = try catalog(chatLive)
    let chatLiveCatalog = try C.decodeCatalog(chatLiveBytes, request: try request(invitationText))
    try check(chatLiveCatalog.classCertificates == ["chat_explanatory": ownerCertificate] && chatLiveCatalog.classProviderPins == nil,
              "440-a: the catalog carries only the chat_explanatory certificate and Core's contract accepts it")
    try check((try object(chatLiveBytes))["candidates"].flatMap { $0 as? [[String: Any]] }?.contains {
                  $0["surface"] as? String == "codex" && $0["model"] as? String == "gpt-6-luna" &&
                  $0["effort"] as? String == "low" && $0["scope"] as? String == "read_only" &&
                  ($0["quota_remaining_fraction"] as? Double ?? 0) > 0 } == true,
              "440-a: the catalog offers a dispatchable read-only (codex, gpt-6-luna, low) row")
    // (b) every other class: no certificate, the same bytes as an empty table.
    let lookupLiveText = "What does the interval rule in this workspace mean?"
    let textOperationText = "다음 문장을 영문으로 번역해줘: 내일 회의를 오후 3시로 옮겨도 될까요?"
    let others: [(String, C.RequestClass, B.Input)] = [
        ("readonly_lookup", .readonlyLookup, live(lookupLiveText)),
        ("text_operation", .textOperation, live(textOperationText, chat: true)),
        ("writer", .writer, live(writeText, owner: .workspaceWrite)),
        ("explicit_route", .explicitRoute, live("1+1 Codex한테", owner: .readOnly, explicit: ["codex"]))]
    for (label, expectedClass, value) in others {
        var emptyTable = value; emptyTable.classTable = .empty
        let found = try facts(value)
        try check(found.requestClass == expectedClass && found.classCertificate == nil && found.classCertificateRejection == nil &&
                  (try catalog(value)) == (try catalog(emptyTable)),
                  "440-b: \(label) carries no certificate: the same catalog bytes as an empty table")
    }
    // (c) tampering fails closed to the reference (the certificate drops; no
    // other fact changes).
    func dropsOwner(_ value: B.Input, _ reason: M.Rejection, _ label: String) throws {
        var emptyTable = value; emptyTable.classTable = .empty
        let found = try facts(value)
        try check(found.classCertificate == nil && found.classCertificateRejection == reason &&
                  (try catalog(value)) == (try catalog(emptyTable)), "440-c: \(label): \(reason.rawValue), reference")
    }
    // (d) lead narrowing: inside chat_explanatory only a state-only check-in
    // carries the certificate; a knowledge, current-fact, code or rider
    // question on the chat lane drops it to the reference (scope_mismatch).
    for text in ["너 되냐?", "설치됐어?", "다 끝났어? 너 되냐?", "자, 이제 네가 얼마나 잘 되는지 보자"] {
        let found = try facts(live(text, chat: true))
        try check(found.requestClass == .chatExplanatory && found.classCertificate == ownerCertificate &&
                  found.classCertificateRejection == nil, "440-d: a state-only check-in loads the owner decision: \(text)")
    }
    for text in ["최신 아이폰 가격 얼마니? 너 되냐?", "이 함수 왜 에러 나니? 너 잘 되냐", "Swift에서 actor reentrancy가 왜 생겨?",
                 "RCC 라우팅에서 쿼터 계산은 어떤 식으로 하니? 너 되냐?", "co가 무슨 뜻이야?", "그게 왜 그래?"] {
        let value = live(text, chat: true)
        try check((try facts(value)).requestClass == .chatExplanatory, "440-d: chat-lane question stays chat_explanatory: \(text)")
        try dropsOwner(value, .scopeMismatch, "a chat-lane question that is not state only keeps the reference: \(text)")
    }
    func ownerTable(_ certificate: C.ClassCertificate, as requestClass: String = "chat_explanatory") throws -> T {
        let fields = try object(C.encode(certificate))
        let (bytes, pin) = try signed(["schema": 1, "class_certificates": [requestClass: fields], "class_provider_pins": [:]])
        return try T.decode(bytes, pinnedSHA256: pin)
    }
    var widened = ownerCertificate; widened.model = "gpt-6-astra"
    try dropsOwner(live(invitationText, chat: true, table: try ownerTable(widened)), .scopeMismatch,
                   "a re-signed table naming the decision for another model")
    var effortChanged = ownerCertificate; effortChanged.effort = .medium
    try dropsOwner(live(invitationText, chat: true, table: try ownerTable(effortChanged)), .scopeMismatch,
                   "a re-signed table naming the decision for another effort")
    var otherProvider = ownerCertificate; otherProvider.provider = "claude"; otherProvider.model = "claude-haiku-4-5-20251001"
    try dropsOwner(live(invitationText, chat: true, table: try ownerTable(otherProvider)), .scopeMismatch,
                   "a re-signed table naming the decision for Claude haiku")
    var otherCheck = ownerCertificate; otherCheck.formatCheck = "exact_json"
    try dropsOwner(live(invitationText, chat: true, table: try ownerTable(otherCheck)), .scopeMismatch,
                   "a re-signed table naming the decision with another format check")
    var otherID = ownerCertificate; otherID.certificateID = "owner-chat-fast-other"
    try dropsOwner(live(invitationText, chat: true, table: try ownerTable(otherID)), .scopeMismatch,
                   "a re-signed table naming the decision under another certificate id")
    try dropsOwner(live(textOperationText, chat: true, table: try ownerTable(ownerCertificate, as: "text_operation")),
                   .scopeMismatch, "a re-signed table naming the decision for text_operation")
    try dropsOwner(live(lookupLiveText, table: try ownerTable(ownerCertificate, as: "readonly_lookup")),
                   .scopeMismatch, "a re-signed table naming the decision for readonly_lookup")
    var tamperedDecision = D.frozenBytes; tamperedDecision.insert(0x20, at: 0)
    var forgedDecision = ownerCertificate; forgedDecision.measurementSHA256 = C.digest(tamperedDecision)
    var heldForgery = live(invitationText, chat: true, table: try ownerTable(forgedDecision))
    heldForgery.classMeasurements = [C.digest(tamperedDecision): tamperedDecision]
    try dropsOwner(heldForgery, .malformed, "a re-signed table naming a changed decision held in custody")
    try dropsOwner(live(invitationText, chat: true, table: try ownerTable(forgedDecision)), .artifactAbsent,
                   "a re-signed table naming a changed decision nobody holds")
    try dropsOwner(live(invitationText, chat: true, harness: nil), .harnessMismatch, "no attested harness")
    try dropsOwner(live(invitationText, chat: true, reference: false), .referenceMismatch,
                   "a Codex pool without a current reference")
    try check(B.admissionFacts(chatLive)?.classCertificateRejection == .referenceMismatch,
              "440-c: admissionFacts without references fails closed")
    // The compiled bytes themselves: one changed byte is not the decision.
    try check(D.verified(ownerCertificate, requestClass: .chatExplanatory, harnessProfile: shippedHarness,
                         reference: .init(provider: "codex", model: "gpt-6-astra", effort: "ultra")) == .success(ownerCertificate) &&
              D.verified(ownerCertificate, requestClass: .chatExplanatory, harnessProfile: shippedHarness,
                         reference: .init(provider: "codex", model: "gpt-6-astra", effort: "ultra"),
                         bytes: tamperedDecision) == .failure(.hashMismatch) &&
              D.verified(ownerCertificate, requestClass: .chatExplanatory, harnessProfile: shippedHarness,
                         reference: .init(provider: "codex", model: "gpt-6-astra", effort: "ultra"),
                         bytes: tamperedDecision, pinned: C.digest(tamperedDecision)) == .failure(.hashMismatch) &&
              D.verified(ownerCertificate, requestClass: .textOperation, harnessProfile: shippedHarness,
                         reference: .init(provider: "codex", model: "gpt-6-astra", effort: "ultra")) == .failure(.scopeMismatch),
              "440-c: a changed decision byte or a re-pinned changed decision is refused; the decision certifies chat only")
    var tamperedTable = T.frozenBytes; tamperedTable.insert(0x20, at: 0)
    try reject("440-c: a changed shipped table is unsigned (the runtime then falls back to the empty table)") {
        _ = try T.decode(tamperedTable)
    }
    // Another current reference does not lapse the decision (it names none),
    // where a D4 measurement taken against astra ultra would be refused.
    var otherReference = chatLive
    otherReference.profiles[0] = .init(action: "cx_6astra_max", provider: "codex", model: "gpt-6-astra", effort: "max")
    otherReference.codexModels[0].supportedEfforts = ["low", "medium", "high", "xhigh", "max"]
    try check(try facts(otherReference).classCertificate == ownerCertificate,
              "440: the owner decision binds the class and tuple, never one reference tuple")

    // (a)/(b) end to end: Core binds the Swift-built catalogs. chat_explanatory
    // descends to luna low admitted by the class certificate (delivery basis
    // certified:class:<id>, its one escalation the reference); every other
    // class binds the reference exactly as before.
    let routes = try coreRoutes([
        (invitationText, try object(chatLiveBytes), false),
        (lookupLiveText, try object(catalog(others[0].2)), false),
        (textOperationText, try object(catalog(others[1].2)), false),
        (writeText, try object(catalog(others[2].2)), true)], now: now,
        runtime: root.appendingPathComponent("Resources/openclaw-os1-bridge/rcc-runtime.mjs"))
    try check(routes.count == 4, "440: Core resolved every Swift-built catalog (\(routes.count)): \(routes)")
    let chatRoute = routes[0]
    try check(chatRoute["model"] as? String == "gpt-6-luna" && chatRoute["effort"] as? String == "low" &&
              chatRoute["surface"] as? String == "codex" && chatRoute["kind"] as? String == "tier" &&
              chatRoute["admitted_by"] as? String == "class" &&
              chatRoute["certificate_id"] as? String == "owner-chat-fast-20261027" &&
              chatRoute["format_check"] as? String == "nonempty_text" &&
              chatRoute["reference_model"] as? String == "gpt-6-astra" && chatRoute["reference_effort"] as? String == "ultra" &&
              chatRoute["basis"] as? String == "certified:class:owner-chat-fast-20261027" &&
              (chatRoute["reason"] as? String)?.hasPrefix("resolver;route_tier;admitted_certified_class:owner-chat-fast-20261027;") == true,
              "440-a: Core binds chat_explanatory to codex gpt-6-luna low, ladder admitted_by class: \(chatRoute)")
    for (label, route) in zip(["readonly_lookup", "text_operation", "writer"], routes.dropFirst()) {
        try check(route["model"] as? String == "gpt-6-astra" && route["effort"] as? String == "ultra" &&
                  route["kind"] as? String == "reference" && route["admitted_by"] is NSNull &&
                  route["basis"] as? String == "reference" &&
                  (route["reason"] as? String)?.contains(";admitted_reference_uncertified;") == true,
                  "440-b: Core binds \(label) to the reference astra ultra: \(route)")
    }

    // ---- Build 441 (owner order, 2026-10-27): graded admission, end to end.
    // The host's deterministic request profile rides the Swift-built catalog;
    // Core's own resolver binds a general explanation to the standard grade
    // (never the top model at its ceiling because nothing certifies it),
    // stable across phrasing, and keeps the reference or the owner's tuple for
    // deep, tool, file, current-fact, prior-artifact and owner-worded work.
    // The host facts the OS1 executable computes (promptRequiresShellCapability,
    // ownerRequestRunsReadOnly, the RCC chat-lane formula) are fixed here as
    // they are for these texts; `os1 self-test` pins those functions.
    func profiled(_ text: String, shell: Bool = false, v2: Bool = true) -> B.Input {
        let found = RequestProfile.classify(text, shellNeed: shell, hasMaterial: false)
        let chat = found.answersWithoutTools || ClaudeChatLane.conversationalQuestion(text)
        var value = live(text, owner: chat ? .readOnly : .workspaceWrite, chat: chat)
        value.profiles += [.init(action: "cx_6astra_max", provider: "codex", model: "gpt-6-astra", effort: "max"),
                           .init(action: "cx_61sol_low", provider: "codex", model: "gpt-6.1-sol", effort: "low"),
                           .init(action: "cx_61sol_medium", provider: "codex", model: "gpt-6.1-sol", effort: "medium"),
                           .init(action: "cx_61sol_high", provider: "codex", model: "gpt-6.1-sol", effort: "high"),
                           .init(action: "cl_opus55_medium", provider: "claude", model: "claude-opus-5-5", effort: "medium"),
                           .init(action: "cl_haiku45", provider: "claude", model: "claude-haiku-4-5-20251001", effort: "none")]
        value.codexModels.insert(.init(slug: "gpt-6.1-sol", supportedEfforts: ["low", "medium", "high"], priority: 1), at: 1)
        value.codexModels[2].priority = 2
        value.claudeModels = [.init(model: "claude-fable-5-1", supportedEfforts: ["max"], nativeRank: 0),
                              .init(model: "claude-opus-5-5", supportedEfforts: ["medium"], nativeRank: 1),
                              .init(model: "claude-haiku-4-5-20251001", supportedEfforts: ["none"], nativeRank: 2)]
        value.requestProfile = found
        if v2 {
            value.enableRoutingIntentV2 = true
            value.routingIntentPolicyVersion = C.RoutingIntentV2.version
        }
        return value
    }
    let explanations = ["슈뢰딩거 방정식 설명해봐", "야, 쇼레든거 방조식 설명해봐", "뉴턴 운동법칙 쉽게 설명해줘",
                        "뉴턴 운동법칙 쉽게 설명해 주세요", "뉴턴 운동법칙 쉽게 설명해줄래?", "뉴턴 운동법칙 쉽게 설명해",
                        "뉴턴 운동법칙 쉽게 설명해봐", "뉴턴 운동법칙 쉽게 설명 좀 해줘", "파이썬 list와 tuple 차이 설명해봐"]
    let kept: [(String, Bool, String)] = [
        ("슈뢰딩거 방정식을 엄밀하게 유도해줘", false, "deep derivation"), ("피타고라스 정리를 증명해봐", false, "deep proof"),
        ("로그인 화면 아키텍처 설계해줘", false, "design"), ("README.md 설명해줘", false, "a named file"),
        ("빌드해줘", true, "a build"), ("배포해봐", true, "a deploy"), ("오늘 환율 설명해줘", false, "current facts"),
        ("이 함수 설명해봐", false, "a prior artifact"), ("아까 그거 설명해줘", false, "a prior artifact"),
        ("그럼 실제로 해봐", false, "a bare pro-verb")]
    var gradedCases: [(request: String, catalog: [String: Any], write: Bool)] = []
    for text in explanations {
        let value = profiled(text)
        let built = try catalog(value)
        var v2Request = try request(text, mode: .auto)
        v2Request.routingIntentPolicyVersion = C.RoutingIntentV2.version
        let facts = try C.decodeCatalog(built, request: v2Request)
        try check(facts.requestClass == .chatExplanatory && facts.ownerScope == .readOnly && facts.chatLaneEligible == true &&
                  facts.requestProfile?.gradable == true && facts.requestProfile?.difficulty == .standard &&
                  facts.classCertificates == nil && facts.routingIntentV2?.allowedSurfaces.isEmpty == true,
                  "441: an explanation is chat_explanatory, read-only, standard-gradable, uncertified: \(text)")
        try check((try object(built))["candidates"].flatMap { $0 as? [[String: Any]] }?.contains {
                      $0["surface"] as? String == "claude-chat" } == true, "441: the chat lane offers claude-chat rows: \(text)")
        gradedCases.append((text, try object(built), false))
    }
    for (text, shell, _) in kept { gradedCases.append((text, try object(catalog(profiled(text, shell: shell))), false)) }
    let ownerWords = ["최대 리즈닝으로 슈뢰딩거 방정식 설명해봐", "gpt-6-astra로 슈뢰딩거 방정식 설명해봐"]
    for text in ownerWords { gradedCases.append((text, try object(catalog(profiled(text))), false)) }
    let lightText = "슈뢰딩거 방정식이 뭐야?"
    gradedCases.append((lightText, try object(catalog(profiled(lightText))), false))
    let gradedRoutes = try coreRoutes(gradedCases, now: now,
        runtime: root.appendingPathComponent("Resources/openclaw-os1-bridge/rcc-runtime.mjs"))
    try check(gradedRoutes.count == gradedCases.count, "441: Core resolved every Swift-built catalog")
    var models = Set<String>(), efforts = Set<String>()
    for (index, text) in explanations.enumerated() {
        let route = gradedRoutes[index]
        try check(route["model"] as? String == "gpt-6.1-sol" && route["effort"] as? String == "medium" &&
                  route["surface"] as? String == "codex" && route["kind"] as? String == "graded" &&
                  route["route_class"] as? String == "standard" && route["admitted_by"] as? String == "host_profile" &&
                  route["grade"] as? String == "standard" && route["certificate_id"] is NSNull &&
                  route["reference_model"] as? String == "gpt-6-astra" && route["reference_effort"] as? String == "ultra" &&
                  route["basis"] as? String == "graded:standard" &&
                  (route["reason"] as? String)?.hasPrefix("resolver;route_graded;admitted_graded_standard;graded_list_0;") == true &&
                  (route["reason"] as? String)?.contains("certified") == false,
                  "441: Core binds the standard grade (sol medium, astra ultra its escalation), never certified: \(text): \(route)")
        models.insert(route["model"] as? String ?? ""); efforts.insert(route["effort"] as? String ?? "")
    }
    try check(Set(gradedRoutes.prefix(explanations.count).map { "\($0["model"] ?? "")/\($0["effort"] ?? "")" }).count == 1,
              "441: every phrasing of the same explanation binds the same tuple")
    for (offset, (text, _, label)) in kept.enumerated() {
        let route = gradedRoutes[explanations.count + offset]
        try check(route["model"] as? String == "gpt-6-astra" && route["effort"] as? String == "ultra" &&
                  route["kind"] as? String == "reference" && route["basis"] as? String == "reference" &&
                  route["admitted_by"] is NSNull &&
                  (route["reason"] as? String)?.hasPrefix("resolver;route_reference;admitted_reference_uncertified;") == true,
                  "441: \(label) keeps the reference (no owner words, not owner_words): \(text): \(route)")
        models.insert(route["model"] as? String ?? ""); efforts.insert(route["effort"] as? String ?? "")
    }
    for (offset, text) in ownerWords.enumerated() {
        let route = gradedRoutes[explanations.count + kept.count + offset]
        try check(route["model"] as? String == "gpt-6-astra" && route["kind"] as? String == "explicit" &&
                  route["basis"] as? String == "owner_words" && route["admitted_by"] is NSNull &&
                  (route["reason"] as? String)?.hasPrefix("resolver;route_explicit;") == true,
                  "441: the owner's model or ceiling words keep the owner's tuple: \(text): \(route)")
    }
    let lightRoute = gradedRoutes[explanations.count + kept.count + ownerWords.count]
    try check(lightRoute["model"] as? String == "gpt-6-luna" && lightRoute["effort"] as? String == "low" &&
              lightRoute["kind"] as? String == "graded" && lightRoute["basis"] as? String == "graded:light",
              "441: a short definitional question binds the light grade: \(lightRoute)")
    models.insert(lightRoute["model"] as? String ?? ""); efforts.insert(lightRoute["effort"] as? String ?? "")
    try check(models.count == 3 && efforts.count == 3 && efforts.contains("low") && efforts.contains("medium") &&
              efforts.contains("ultra"), "441: not always luna, not always low, not always the ceiling: \(models) \(efforts)")

    // ---- Build 441 part 2 (owner order, 2026-10-27): the local classifier's
    // reading combined under the keyword rails, list prices on every row, and
    // Core's price-aware choice, end to end on Swift-built catalogs. The local
    // readings are fixed here (fake transport: LocalRequestClassifierFixture);
    // the host's owner scope and chat-lane fact for a combined profile are
    // computed as `ownerRequestRunsReadOnly(profile:)` / `rccChatLaneEligible`
    // compute them for these texts (`os1 self-test` pins those functions).
    typealias LA = LocalRequestClassifier.Answer
    func combinedInput(_ text: String, _ local: LA?, shell: Bool = false, codexUsed: Double = 40, claudeUsed: Double = 40,
                       sonnet: Bool = true, codexExhausted: Bool = false) -> B.Input {
        let keyword = RequestProfile.classify(text, shellNeed: shell, hasMaterial: false)
        let consulted = RequestProfile.railsDecide(keyword, request: text) ? nil : local
        let combined = RequestProfile.combine(keyword: keyword, request: text, local: consulted,
                                              model: consulted == nil ? nil : "qwen3.5:9b")
        let readOnly = !shell && (combined.answersReadOnly || ClaudeChatLane.conversationalQuestion(text))
        let chat = readOnly && combined.answersWithoutTools && ClaudeChatLane.answerNeedsNoLookup(text)
        var value = live(text, owner: readOnly ? .readOnly : .workspaceWrite, chat: chat)
        value.profiles += [.init(action: "cx_61sol_medium", provider: "codex", model: "gpt-6.1-sol", effort: "medium"),
                           .init(action: "cl_opus55_medium", provider: "claude", model: "claude-opus-5-5", effort: "medium"),
                           .init(action: "cl_haiku45", provider: "claude", model: "claude-haiku-4-5-20251001", effort: "none")]
        if sonnet { value.profiles.append(.init(action: "cl_sonnet55_medium", provider: "claude", model: "claude-sonnet-5-5", effort: "medium")) }
        value.codexModels.insert(.init(slug: "gpt-6.1-sol", supportedEfforts: ["low", "medium", "high"], priority: 1), at: 1)
        value.codexModels[2].priority = 2
        value.claudeModels = [.init(model: "claude-fable-5-1", supportedEfforts: ["max"], nativeRank: 0),
                              .init(model: "claude-opus-5-5", supportedEfforts: ["medium"], nativeRank: 1),
                              .init(model: "claude-sonnet-5-5", supportedEfforts: ["medium"], nativeRank: 2),
                              .init(model: "claude-haiku-4-5-20251001", supportedEfforts: ["none"], nativeRank: 3)]
        value.codexQuota = .init(accountID: "acct-codex", observedAt: now, source: .codexNative,
                                 windows: [.init(bucket: "weekly", usedPercent: codexUsed, resetsAt: now.addingTimeInterval(3600))])
        value.claudeQuota = .init(accountID: "acct-claude", observedAt: now, source: .claudeNative,
                                  windows: [.init(bucket: "weekly_all", usedPercent: claudeUsed, resetsAt: now.addingTimeInterval(3600))])
        if codexExhausted { value.codexQuotaExhaustedModels = ["gpt-6.1-sol", "gpt-6-luna"] }
        value.requestProfile = combined
        value.priceTable = .compiled
        value.enableRoutingIntentV2 = true
        value.routingIntentPolicyVersion = C.RoutingIntentV2.version
        if B.autoLocalRowEligible(value) { value.localModel = .init(ready: true, at: now) }
        return value
    }
    let explainStandard = LA(taskType: .explain, difficulty: .standard, needsTools: .none)
    let chatLight = LA(taskType: .chat, difficulty: .light, needsTools: .none)
    let explainLight = LA(taskType: .explain, difficulty: .light, needsTools: .none)
    let part2: [(label: String, text: String, input: B.Input, expect: String, basis: String)] = [
        ("the owner's ASR explanation", "쉐딩과 방정식 설명해 봐봐", combinedInput("쉐딩과 방정식 설명해 봐봐", explainStandard),
         "codex:gpt-6.1-sol/medium", "graded:standard"),
        ("very easy chat: the local model", "안녕! 좋은 아침이야", combinedInput("안녕! 좋은 아침이야", chatLight),
         "local:qwen3.5:4b/none", "graded:light"),
        ("current facts: an agent surface", "오늘 원달러 환율 설명해줘", combinedInput("오늘 원달러 환율 설명해줘", explainStandard),
         "codex:gpt-6.1-sol/medium", "graded:standard"),
        ("rail: a named file", "README.md 설명해줘", combinedInput("README.md 설명해줘", explainStandard),
         "codex:gpt-6-astra/ultra", "reference"),
        ("rail: a placement order", "슈뢰딩거 방정식 설명 정리해서 노션에 올려줘",
         combinedInput("슈뢰딩거 방정식 설명 정리해서 노션에 올려줘", explainStandard), "codex:gpt-6-astra/ultra", "reference"),
        ("rail: a build", "빌드해줘", combinedInput("빌드해줘", chatLight, shell: true), "codex:gpt-6-astra/ultra", "reference"),
        ("LLM down: keyword fallback", "안녕! 좋은 아침이야", combinedInput("안녕! 좋은 아침이야", nil),
         "codex:gpt-6.1-sol/medium", "graded:standard"),
        ("price: sol over opus at one tier (Claude ranked first)", "쉐딩과 방정식 설명해 봐봐",
         combinedInput("쉐딩과 방정식 설명해 봐봐", explainStandard, codexUsed: 90, claudeUsed: 10, sonnet: false),
         "codex:gpt-6.1-sol/medium", "graded:standard"),
        ("price: luna over haiku 4.5 (Claude ranked first)", "엔트로피가 뭐야?",
         combinedInput("엔트로피가 뭐야?", explainLight, codexUsed: 90, claudeUsed: 10), "codex:gpt-6-luna/low", "graded:light"),
        ("price: Codex quota exhausted binds sonnet, not opus", "쉐딩과 방정식 설명해 봐봐",
         combinedInput("쉐딩과 방정식 설명해 봐봐", explainStandard, codexExhausted: true),
         "claude-chat:claude-sonnet-5-5/medium", "graded:standard")]
    var part2Cases: [(request: String, catalog: [String: Any], write: Bool)] = []
    for item in part2 {
        let built = try catalog(item.input)
        var v2Request = try request(item.text, mode: .auto)
        v2Request.routingIntentPolicyVersion = C.RoutingIntentV2.version
        let decoded = try C.decodeCatalog(built, request: v2Request)
        try check(decoded.requestProfile == item.input.requestProfile && decoded.requestProfile?.valid == true &&
                  decoded.candidates.allSatisfy { $0.estimatedCostUnits != nil },
                  "part 2: the Swift contract accepts the combined profile and every row is priced: \(item.label)")
        part2Cases.append((item.text, try object(built), item.input.ownerScope == .workspaceWrite))
    }
    let localBuilt = try object(catalog(part2[1].input))
    try check((localBuilt["candidates"] as? [[String: Any]])?.contains { $0["surface"] as? String == "local" &&
                  $0["estimated_cost_units"] as? Double == 0 && $0["model"] as? String == B.localWorkerModel } == true &&
              (try object(catalog(part2[0].input))["candidates"] as? [[String: Any]])?.contains { $0["surface"] as? String == "local" } == false,
              "part 2: Auto offers the local row only for very easy chat, priced 0")
    let pricedRow = (try object(catalog(part2[0].input))["candidates"] as? [[String: Any]])?.first { $0["model"] as? String == "gpt-6-astra" }
    try check(pricedRow?["estimated_cost_units"] as? Double == 0.195, "part 2: astra's typical call is $0.195 on the wire")
    let part2Routes = try coreRoutes(part2Cases, now: now,
        runtime: root.appendingPathComponent("Resources/openclaw-os1-bridge/rcc-runtime.mjs"))
    try check(part2Routes.count == part2.count, "part 2: Core resolved every Swift-built catalog")
    for (item, route) in zip(part2, part2Routes) {
        let tuple = "\(route["surface"] as? String ?? ""):\(route["model"] as? String ?? "")/\(route["effort"] as? String ?? "")"
        try check(tuple == item.expect && route["basis"] as? String == item.basis &&
                  (item.basis == "reference" || (route["reason"] as? String)?.contains(";cheap_first;") == true),
                  "part 2: \(item.label): \(tuple) \(route["basis"] ?? "") \(route["reason"] ?? "")")
    }
    try check((part2Routes[0]["reason"] as? String)?.contains(";classifier_local_llm;") == true &&
              (part2Routes[6]["reason"] as? String)?.contains(";classifier_keyword;") == true &&
              (part2Routes[1]["reason"] as? String)?.contains(";graded_profile_chat_light;") == true &&
              (part2Routes[2]["reason"] as? String)?.contains(";graded_profile_current_facts;") == true,
              "part 2: the reason names the classifier and the profile list")

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

    print("RCC admission facts (407-a/f, K11): \(checks) table/class/measurement/catalog/ticket/disclosure checks PASS; provider calls 0")
}

/// Build 440: runs Core's own host plan and route resolver
/// (`hostPlan` -> `resolveRoutePlan`, then `deliveryBasisOf`) in Node on
/// Swift-built catalogs, one Auto task per catalog at the catalog's own clock.
/// Importing the module starts no runtime; no model, provider or network call.
private func coreRoutes(_ cases: [(request: String, catalog: [String: Any], write: Bool)], now: Date,
                        runtime: URL) throws -> [[String: Any]] {
    let script = #"""
    import {readFileSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    import {pathToFileURL} from 'node:url';
    const {hostPlan, resolveRoutePlan, deliveryBasisOf, hostContextFingerprint} =
      await import(pathToFileURL(process.argv[1]).href);
    const sha = text => createHash('sha256').update(text).digest('hex');
    const {now, cases} = JSON.parse(readFileSync(0, 'utf8'));
    const policyText = 'owner-decision fixture policy';
    process.stdout.write(JSON.stringify(cases.map(({request, catalog, write}) => {
      const host = {workspace: '/tmp/os1-owner-decision-fixture', context: null, provider_preference: 'auto',
        codex_session_id: null, claude_session_id: null, require_read_only: !write, owner_policy: null};
      const task = {schema: 1, task_id: catalog.task_id, request, request_sha256: catalog.request_sha256, objective: request,
        policy_sha256: sha(policyText), source_fingerprint: hostContextFingerprint(host), mode: 'auto', material_refs: [],
        budget: {max_attempts: 2, max_parallel: 4, max_cost_units: null, max_duration_ms: 60000, max_native_dispatches: 16},
        host_context: host,
        policy: {source_sha256: sha('fixture source'), projection_sha256: sha(policyText), text: policyText},
        ...(catalog.routing_intent_v2 === undefined ? {} : {routing_intent_policy_version: catalog.routing_intent_v2.version})};
      const {decisions, routes} = resolveRoutePlan(hostPlan(task, catalog), task, catalog, now);
      const decision = decisions.node_0, route = routes.node_0, ladder = route.ladder ?? null;
      return {surface: decision.surface, model: decision.model, effort: decision.effort, reason: decision.reason,
        route_class: decision.route_class, grade: ladder?.grade ?? null,
        kind: route.kind, admitted_by: ladder?.admitted_by ?? null, certificate_id: ladder?.certificate_id ?? null,
        format_check: ladder?.format_check ?? null, reference_model: ladder?.reference_model ?? null,
        reference_effort: ladder?.reference_effort ?? null,
        basis: deliveryBasisOf({routeClass: decision.route_class, routeKind: route.kind, ladder, reason: decision.reason})};
    })));
    """#
    let pinnedNode = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
    if let override = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"] { process.executableURL = URL(fileURLWithPath: override) }
    else if FileManager.default.isExecutableFile(atPath: pinnedNode.path) { process.executableURL = pinnedNode }
    else { process.executableURL = URL(fileURLWithPath: "/usr/bin/env") }
    process.arguments = (process.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", script, runtime.path]
    process.standardInput = input; process.standardOutput = output; process.standardError = errors
    try process.run()
    let payload: [String: Any] = ["now": Int64(now.timeIntervalSince1970 * 1000),
        "cases": cases.map { ["request": $0.request, "catalog": $0.catalog, "write": $0.write] as [String: Any] }]
    try input.fileHandleForWriting.write(contentsOf: JSONSerialization.data(withJSONObject: payload))
    try input.fileHandleForWriting.close()
    let bytes = output.fileHandleForReading.readDataToEndOfFile()
    let failure = String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    process.waitUntilExit()
    guard process.terminationStatus == 0,
          let routes = (try? JSONSerialization.jsonObject(with: bytes)) as? [[String: Any]] else {
        throw NSError(domain: "RCCAdmissionFactsFixture", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "440: Core route resolution failed: " + String(failure.suffix(2000))])
    }
    return routes
}
