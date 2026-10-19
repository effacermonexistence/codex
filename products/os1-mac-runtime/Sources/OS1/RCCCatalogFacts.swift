import Foundation
import OS1Context

/// Build 407-a/f host facts. The catalog carries what the Core admission law
/// reads (R0, R2); the adapter tolerates an owner contract whose bindings no
/// longer hold as "no contract". Nothing here selects a model or a row.
enum RCCCatalogFacts {
    typealias C = RCCRuntimeContract

    /// R2: the owner request runs read-only (affirmative only), from the same
    /// predicate the native path uses; attached material counts as a source.
    static func ownerScope(_ request: C.Request) -> C.Scope {
        ownerRequestRunsReadOnly(request.request, attachedSource: !request.materialRefs.isEmpty) ? .readOnly : .workspaceWrite
    }

    /// R0(a): the owner contract for exactly this request text, re-checked now
    /// with the bindings the adapter will use for a host-built node whose
    /// instruction is the request: context, source, start tree (the host
    /// workspace's current state) and reference policy, plus validity, through
    /// the same `PreparedTaskQuality.prepare` predicate. A read-only lookup:
    /// no regression acquisition, no checker run, and no workspace hash when
    /// no contract file exists. Absence, expiry or any throw omits it.
    static func taskContract(_ request: C.Request, rootURL: URL = PreparedTaskQuality.root, now: Date = Date(),
                             startTree: (String) -> String = workspaceHash) -> C.TaskContractFact? {
        guard let host = request.hostContext else { return nil }
        let objectiveSHA = C.digest(Data(request.request.utf8))
        let file = rootURL.appendingPathComponent("contracts", isDirectory: true).appendingPathComponent(objectiveSHA + ".json")
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let context = C.digest(Data((host.context ?? "").utf8))
        let source = (try? SessionHandoff.decode(host.context)).flatMap { $0.source?.sha256 }
        let tree = startTree(host.workspace)
        for scope in [TaskContext.Scope.readOnly, .workspaceWrite] {
            guard let prepared = try? PreparedTaskQuality.prepare(objective: request.request, contextSHA256: context,
                sourceSHA256: source, startTreeSHA256: tree, scope: scope, referencePolicySHA256: request.policySHA256,
                workspace: nil, allowRegressionAcquisition: false, rootURL: rootURL) else { continue }
            let contract = prepared.envelope.contract
            guard contract.validUntil > now else { return nil }
            return .init(coverage: contract.fullCoverage ? .full : .partial, scope: scope == .readOnly ? .readOnly : .workspaceWrite,
                objectiveSHA256: objectiveSHA, contractSHA256: contract.sha256, contextSHA256: context, sourceSHA256: source,
                startTreeSHA256: tree, referencePolicySHA256: request.policySHA256,
                validUntilMS: Int64((contract.validUntil.timeIntervalSince1970 * 1000).rounded(.down)))
        }
        return nil
    }

    /// The exact error `PreparedTaskQuality.prepare` throws when a contract
    /// file exists for the objective but its context, source, start tree,
    /// scope or reference policy differs (the self-test pins this coupling).
    static let contractBindingMismatchText = "Task-quality contract does not match this exact request/source/reference scope"

    /// 407-f: only that binding mismatch is "no contract" at dispatch. Custody
    /// failures (non-canonical, foreign-owned, oversize, a changed checker)
    /// still stop the attempt before any model call.
    static func contractBindingMismatch(_ error: Error) -> Bool {
        guard case OS1Error.message(let text)? = error as? OS1Error else { return false }
        return text == contractBindingMismatchText
    }
}

/// Pure fixture: temporary contract files only; no provider, gateway, model,
/// checker process or live workspace is touched.
func rccCatalogFactsSelfTest() throws {
    typealias C = RCCRuntimeContract
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("os1-catalog-facts-" + UUID().uuidString).resolvingSymlinksInPath()
    try fm.createDirectory(at: root.appendingPathComponent("contracts"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try fm.createDirectory(at: root.appendingPathComponent("checkers"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: root) }
    var checks = 0
    func check(_ pass: @autoclosure () throws -> Bool, _ label: String) throws {
        guard try pass() else { throw OS1Error.message("RCC catalog facts fixture: " + label) }; checks += 1
    }
    let policy = C.digest(Data("fixture policy".utf8)), tree = C.digest(Data("fixture tree".utf8))
    func request(_ text: String, context: String? = nil, materials: [String] = []) throws -> C.Request {
        let host = C.HostContext(workspace: root.path, context: context, providerPreference: "auto", codexSessionID: nil,
                                 claudeSessionID: nil, requireReadOnly: false, ownerPolicy: nil)
        return C.Request(taskID: "fixture-facts", request: text, requestSHA256: C.digest(Data(text.utf8)), objective: text,
            policySHA256: policy, sourceFingerprint: C.digest(try C.encode(host)), mode: .auto, materialRefs: materials,
            budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 20_000), hostContext: host)
    }

    // R2 owner scope: affirmative read-only only.
    try check(RCCCatalogFacts.ownerScope(try request("co가 무슨 뜻이야?")) == .readOnly, "conversational question runs read-only")
    try check(RCCCatalogFacts.ownerScope(try request("Fix the login bug in Sources/App.swift")) == .workspaceWrite,
              "a change request is a writer")

    // No contract file: omitted, and the workspace is never hashed for it.
    let lookup = try request("Summarize the interval rules in this workspace.")
    var hashed = 0
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in hashed += 1; return tree }) == nil && hashed == 0,
              "no contract file means no fact and no workspace hash")

    // A full read-only owner contract bound to exactly this request.
    let checker = Data("print('fixture')\n".utf8), checkerSHA = C.digest(checker)
    try checker.write(to: root.appendingPathComponent("checkers/\(checkerSHA).py"))
    func save(_ req: C.Request, scope: TaskContext.Scope = .readOnly, full: Bool = true, context: String? = nil,
              policy contractPolicy: String? = nil, until: Date = Date().addingTimeInterval(600)) throws {
        let contract = TaskQualityEvidence.Contract(basis: .declaredTrustedContract, objectiveSHA256: req.requestSHA256,
            contextSHA256: context ?? C.digest(Data((req.hostContext?.context ?? "").utf8)), sourceSHA256: nil,
            startTreeSHA256: tree, scope: scope, verifierCodeSHA256: checkerSHA, referencePolicySHA256: contractPolicy ?? policy,
            requiredCheckIDs: ["owner.full"], fullCoverage: full, referenceProfiles: [], reference: nil,
            issuedAt: Date(), validUntil: until)
        let envelope = PreparedTaskQuality.Envelope(contract: contract, checkerSHA256: checkerSHA, timeoutSeconds: 30, workspacePaths: [])
        let path = root.appendingPathComponent("contracts/\(req.requestSHA256).json")
        try? fm.removeItem(at: path)
        try RCCOperationalQuality.encoded(envelope).write(to: path)
    }
    try save(lookup)
    guard let fact = RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in tree }) else {
        throw OS1Error.message("RCC catalog facts fixture: a bound full contract was omitted")
    }
    try check(fact.coverage == .full && fact.scope == .readOnly && fact.bindingsChecked &&
              fact.objectiveSHA256 == lookup.requestSHA256 && fact.startTreeSHA256 == tree &&
              fact.referencePolicySHA256 == policy && fact.sourceSHA256 == nil &&
              fact.contextSHA256 == C.digest(Data("".utf8)) && fact.validUntilMS > Int64(Date().timeIntervalSince1970 * 1000),
              "the fact carries the full bindings it was re-checked with")
    try save(lookup, scope: .workspaceWrite, full: false)
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in tree }).map {
        $0.scope == .workspaceWrite && $0.coverage == .partial } == true, "a writer contract keeps its own scope and coverage")
    // Stale bindings and expiry omit the fact (the Core then binds the reference).
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in C.digest(Data("moved".utf8)) }) == nil,
              "a changed start tree is not a contract")
    try save(lookup, context: C.digest(Data("other context".utf8)))
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in tree }) == nil, "a foreign context is not a contract")
    try save(lookup, policy: C.digest(Data("other policy".utf8)))
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in tree }) == nil, "another reference policy is not a contract")
    try save(lookup, until: Date().addingTimeInterval(-1))
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in tree }) == nil, "an expired contract is not a contract")

    // 407-f: the adapter tolerates exactly the binding mismatch prepare throws.
    try save(lookup)
    do {
        _ = try PreparedTaskQuality.prepare(objective: lookup.request, contextSHA256: C.digest(Data("".utf8)), sourceSHA256: nil,
            startTreeSHA256: C.digest(Data("moved".utf8)), scope: .readOnly, referencePolicySHA256: policy,
            workspace: nil, allowRegressionAcquisition: false, rootURL: root)
        throw OS1Error.message("RCC catalog facts fixture: a moved start tree was accepted by prepare")
    } catch let error where RCCCatalogFacts.contractBindingMismatch(error) { checks += 1 }
    try fm.removeItem(at: root.appendingPathComponent("checkers/\(checkerSHA).py"))
    var custodyFailure: Error?
    do {
        _ = try PreparedTaskQuality.prepare(objective: lookup.request, contextSHA256: C.digest(Data("".utf8)), sourceSHA256: nil,
            startTreeSHA256: tree, scope: .readOnly, referencePolicySHA256: policy,
            workspace: nil, allowRegressionAcquisition: false, rootURL: root)
    } catch { custodyFailure = error }
    try check(custodyFailure.map { !RCCCatalogFacts.contractBindingMismatch($0) } == true,
              "a custody failure (missing checker) is never tolerated as no contract")
    try check(!RCCCatalogFacts.contractBindingMismatch(OS1Error.message("Task-quality checker is not a bounded regular file")),
              "only the exact binding mismatch is tolerated")
    print("RCC catalog facts (407-a/f): \(checks) checks PASS; provider/model/checker calls 0")
}
