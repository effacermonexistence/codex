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
            let issuedMS = contract.issuedAt.timeIntervalSince1970 * 1000
            let untilMS = contract.validUntil.timeIntervalSince1970 * 1000
            // A future or inverted grant is not current scope authority,
            // even before the later quality evaluator checks its dates.
            guard contract.schema == 1,
                  [issuedMS, untilMS].allSatisfy({ $0.isFinite && (0...9_007_199_254_740_991).contains($0) }),
                  contract.issuedAt <= now, contract.issuedAt < contract.validUntil,
                  contract.validUntil > now else { return nil }
            let isolatedBoundary = prepared.envelope.localEffectsOnly && source == nil && host.codexSessionID == nil &&
                (request.nativeSessions == nil || request.nativeSessions?.isEmpty == true) &&
                OS1SourceWatch.containedRoot(workspace: host.workspace) == nil &&
                LocalProjectWorkspace.root(containing: host.workspace, projectID: "os1-clodex") == nil
                ? (try? RCCOperationalQuality.localEffectsBoundary(request: request, rootURL: rootURL)) : nil
            let staged = isolatedBoundary.flatMap { boundary in
                try? RCCStagedWriterTransaction.catalogBinding(prepared: prepared, workspace: host.workspace, boundary: boundary, now: now)
            }
            return .init(coverage: contract.fullCoverage ? .full : .partial, scope: scope == .readOnly ? .readOnly : .workspaceWrite,
                objectiveSHA256: objectiveSHA, contractSHA256: contract.sha256, contextSHA256: context, sourceSHA256: source,
                startTreeSHA256: tree, referencePolicySHA256: request.policySHA256,
                validUntilMS: Int64(untilMS.rounded(.down)),
                executionIsolation: isolatedBoundary == nil ? nil : "codex_fresh_local_effects_v1",
                executionIsolationSHA256: isolatedBoundary?.envelopeSHA256,
                stagedWriterEnvelopeSHA256: staged?.envelopeSHA256, stagedWriterBaseSHA256: staged?.baseSHA256,
                ownerCollection: isolatedBoundary == nil ? nil : try? RCCOwnerCollection.fact(request: request, prepared: prepared, now: now,
                    rootURL: rootURL, startTree: startTree))
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
    func request(_ text: String, context: String? = nil, materials: [String] = [], codexSession: String? = nil) throws -> C.Request {
        let host = C.HostContext(workspace: root.path, context: context, providerPreference: "auto", codexSessionID: codexSession,
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
              policy contractPolicy: String? = nil, issued: Date = Date(), schema: Int = 1,
              until: Date = Date().addingTimeInterval(600), localEffectsOnly: Bool = false) throws {
        var contract = TaskQualityEvidence.Contract(basis: .declaredTrustedContract, objectiveSHA256: req.requestSHA256,
            contextSHA256: context ?? C.digest(Data((req.hostContext?.context ?? "").utf8)), sourceSHA256: nil,
            startTreeSHA256: tree, scope: scope, verifierCodeSHA256: checkerSHA, referencePolicySHA256: contractPolicy ?? policy,
            requiredCheckIDs: ["owner.full"], fullCoverage: full, referenceProfiles: [], reference: nil,
            issuedAt: issued, validUntil: until)
        contract.schema = schema
        let envelope = PreparedTaskQuality.Envelope(contract: contract, checkerSHA256: checkerSHA, timeoutSeconds: 30, workspacePaths: [], localEffectsOnly: localEffectsOnly)
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
    let clock = Date(timeIntervalSince1970: 1_800_000_000)
    try save(lookup, scope: .workspaceWrite, full: false,
             issued: clock.addingTimeInterval(1), until: clock.addingTimeInterval(600))
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, now: clock, startTree: { _ in tree }) == nil,
              "future issuance cannot authorize a current write")
    try save(lookup, issued: clock, until: clock)
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, now: clock, startTree: { _ in tree }) == nil,
              "equal issuance and expiry is not a grant")
    try save(lookup, issued: clock.addingTimeInterval(500), until: clock.addingTimeInterval(400))
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, now: clock, startTree: { _ in tree }) == nil,
              "inverted validity cannot authorize scope")
    try save(lookup, scope: .workspaceWrite, full: false, issued: clock, until: clock.addingTimeInterval(600))
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, now: clock, startTree: { _ in tree })?.scope == .workspaceWrite,
              "a current bound partial grant remains usable without becoming full quality proof")
    try save(lookup, issued: clock, schema: 2, until: clock.addingTimeInterval(600))
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, now: clock, startTree: { _ in tree }) == nil,
              "an unsupported contract schema is not scope authority")
    try save(lookup, issued: clock, until: Date(timeIntervalSince1970: 1e16))
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, now: clock, startTree: { _ in tree }) == nil,
              "an out-of-range expiry is rejected before integer conversion")

    // Pool sharing is a capability from the exact rechecked envelope, never
    // inferred from a route label, model output, or a requested write hint.
    try save(lookup, full: false, localEffectsOnly: true)
    guard let isolated = RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in tree }) else {
        throw OS1Error.message("Missing isolated catalog fixture")
    }
    try check(isolated.executionIsolation == "codex_fresh_local_effects_v1" && isolated.executionIsolationSHA256 != nil && isolated.coverage == .partial,
              "exact fresh local-effects boundary advertises isolation, never full quality")
    var catalog = C.Catalog(taskID: lookup.taskID, requestSHA256: lookup.requestSHA256, candidates: [],
        exclusions: [.init(provider: "codex", reason: "explicit_constraint_unavailable", count: 1)],
        ownerScope: .readOnly, chatLaneEligible: false, requestClass: .readonlyLookup, taskContract: isolated)
    try check(try C.decodeCatalog(C.encode(catalog), request: lookup).taskContract?.executionIsolation == isolated.executionIsolation,
              "optional isolation field round-trips strict wire validation")
    func invalidIsolation(_ value: String?, source: String? = nil, checked: Bool = true) throws -> Bool {
        var c = isolated; c.executionIsolation = value; if value == nil { c.executionIsolationSHA256 = nil }; c.sourceSHA256 = source; c.bindingsChecked = checked
        catalog.taskContract = c
        do { _ = try C.decodeCatalog(C.encode(catalog), request: lookup); return false } catch { return true }
    }
    try check(try invalidIsolation("invented"), "unknown isolation class is rejected")
    try check(try invalidIsolation("codex_fresh_local_effects_v1", source: tree), "source-bound fact cannot claim fresh local isolation")
    try check(try invalidIsolation("codex_fresh_local_effects_v1", checked: false), "unchecked fact is not isolation authority")
    var missingPair = isolated; missingPair.executionIsolationSHA256 = nil; catalog.taskContract = missingPair
    do { _ = try C.decodeCatalog(C.encode(catalog), request: lookup); throw OS1Error.message("Isolation missing hash was accepted") }
    catch let error as C.Rejection { _ = error; checks += 1 }
    var malformedPair = isolated; malformedPair.executionIsolationSHA256 = "not-a-hash"; catalog.taskContract = malformedPair
    do { _ = try C.decodeCatalog(C.encode(catalog), request: lookup); throw OS1Error.message("Isolation malformed hash was accepted") }
    catch let error as C.Rejection { _ = error; checks += 1 }
    catalog.taskContract = fact
    try check(try C.decodeCatalog(C.encode(catalog), request: lookup).taskContract?.executionIsolation == nil,
              "old fact without capability stays wire-compatible and exclusive")
    try save(lookup, localEffectsOnly: false)
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in tree })?.executionIsolation == nil,
              "ordinary contract does not invent local-effects capability")
    let resumed = try request(lookup.request, codexSession: UUID().uuidString.lowercased())
    try save(resumed, localEffectsOnly: true)
    try check(RCCCatalogFacts.taskContract(resumed, rootURL: root, startTree: { _ in tree })?.executionIsolation == nil,
              "resumed host session cannot claim fresh native isolation")
    var legacySessions = try request(lookup.request)
    legacySessions.nativeSessions = ["codex": UUID().uuidString.lowercased()]
    try save(legacySessions, localEffectsOnly: true)
    try check(RCCCatalogFacts.taskContract(legacySessions, rootURL: root, startTree: { _ in tree })?.executionIsolation == nil,
              "legacy native session metadata omits isolation rather than making an invalid shared catalog")
    try save(lookup, until: Date().addingTimeInterval(-1), localEffectsOnly: true)
    try check(RCCCatalogFacts.taskContract(lookup, rootURL: root, startTree: { _ in tree }) == nil,
              "expired local-effects boundary cannot enable sharing")

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
