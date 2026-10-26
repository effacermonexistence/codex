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
    // Fleet job f0b9ee10: an implement request that the scope classifier read
    // as read-only, so the catalog offered only read_only rows. It binds
    // writer rows now; a host-required read-only task still never does.
    let implementText = "그럼 그 구조로 아키텍처 동결하고 구현 시작해"
    var fleetImplement = input(implementText, owner: .workspaceWrite)
    fleetImplement.providerPreference = "claude"  // the recorded fleet envelope
    for implement in [input(implementText, owner: .workspaceWrite), fleetImplement] {
        try check((try B.build(implement)).candidates.contains { $0["scope"] as? String == "workspace_write" } &&
                  B.admissionFacts(implement)?.requestClass == .writer,
                  "an implement request worded '구현 시작해' binds writer rows (\(implement.providerPreference))")
    }
    try check(B.admissionFacts(input(implementText, owner: .workspaceWrite, readOnly: true))?.requestClass == .readonlyLookup,
              "a host-required read-only implement request is still never a writer")
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
    try check(M.harnessScope(HarnessProfile.current) == "H0@1",
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

    // K11-b the shipped (empty) table: inert whatever artifact is on disk.
    var shipped = valid; shipped.classTable = .frozen
    var shippedBare = shipped; shippedBare.classMeasurements = [:]; shippedBare.harnessProfile = nil
    let shippedFacts = try facts(shipped)
    try check(shippedFacts.classCertificate == nil && shippedFacts.classCertificateRejection == nil &&
              (try catalog(shipped)) == (try catalog(shippedBare)),
              "K11-b: with the shipped table an artifact changes no catalog byte")

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
