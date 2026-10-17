import Foundation
import OS1Context

/// Pure wire/identity/DAG checks. No model, provider, browser, state-store or
/// live installation is invoked by this fixture.
func runRCCRuntimeContractFixture() throws {
    typealias C = RCCRuntimeContract
    var checks = 0
    func check(_ pass: Bool, _ label: String) throws {
        guard pass else { throw NSError(domain: "RCCRuntimeContractFixture", code: 1,
                                       userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    func reject(_ label: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { checks += 1; return }
        throw NSError(domain: "RCCRuntimeContractFixture", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: label])
    }
    let requestText = "Translate good morning into Korean."
    let policyText = "Preserve task identity. A candidate is not task quality proof."
    let hash = C.digest(Data("fixture-source".utf8))
    let policyHash = C.digest(Data(policyText.utf8))
    let host = C.HostContext(workspace: "/tmp/rcc-fixture", context: nil, providerPreference: "auto",
        codexSessionID: "native-fixture", claudeSessionID: nil, requireReadOnly: true, ownerPolicy: nil)
    let hostBytes = try C.encode(host)
    let hostObject = try JSONSerialization.jsonObject(with: hostBytes) as! [String: Any]
    try check(hostObject["context"] is NSNull && hostObject["owner_policy"] is NSNull && hostObject["claude_session_id"] is NSNull,
              "host canonical JSON retains null instead of inventing state")
    let fixtureRouting = "Preserve fixture objective.", fixtureProjection = "Return supported state only."
    let ownerBytes = try JSONSerialization.data(withJSONObject: ["schema": 1,
        "sourceSHA256": hash, "sourceFile": hash + ".txt", "sourceID": "fixture-source-id",
        "sourceModified": "2026-10-10T00:00:00Z", "checkedAt": 1_786_119_441.1234567,
        "routing": fixtureRouting, "projection": fixtureProjection,
        "projectionSHA256": C.digest(Data((fixtureRouting + "\n" + fixtureProjection).utf8))], options: [.sortedKeys])
    let owner = try JSONDecoder().decode(OwnerPolicySnapshot.self, from: ownerBytes)
    var hostWithOwner = host; hostWithOwner.ownerPolicy = owner; hostWithOwner.context = "Korean context: 안녕 / line\n2"
    try C.validate(hostWithOwner)
    let canonicalOwnerHost = try C.encode(hostWithOwner)
    // An actual cross-language pure hash check, not an independent claim that
    // the live Gateway or local model executed this task. Importing the module
    // does not create the SQLite runtime or invoke an adapter/provider.
    let runtimeModule = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources/openclaw-os1-bridge/rcc-runtime.mjs")
    let pinnedNode = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/node-v24.20.0/bin/node")
    let nodeOverride = ProcessInfo.processInfo.environment["OS1_RCC_CONTRACT_NODE"]
    let process = Process(), input = Pipe(), output = Pipe(), errors = Pipe()
    if let nodeOverride { process.executableURL = URL(fileURLWithPath: nodeOverride) }
    else if FileManager.default.isExecutableFile(atPath: pinnedNode.path) { process.executableURL = pinnedNode }
    else { process.executableURL = URL(fileURLWithPath: "/usr/bin/env") }
    let script = """
    import {pathToFileURL} from 'node:url';
    import {readFileSync} from 'node:fs';
    const {hostContextFingerprint}=await import(pathToFileURL(process.argv[1]).href);
    process.stdout.write(hostContextFingerprint(JSON.parse(readFileSync(0,'utf8'))));
    """
    process.arguments = (process.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", script, runtimeModule.path]
    process.standardInput = input; process.standardOutput = output; process.standardError = errors
    try process.run(); try input.fileHandleForWriting.write(contentsOf: canonicalOwnerHost); try input.fileHandleForWriting.close()
    let jsDigest = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    let jsErrors = errors.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
    try check(process.terminationStatus == 0 && jsDigest == C.digest(canonicalOwnerHost),
              "actual Swift/JS canonical HostContext fingerprint including Double and Unicode (Node error bytes \(jsErrors.count))")
    let request = C.Request(taskID: "task-fixture", request: requestText,
        requestSHA256: C.digest(Data(requestText.utf8)), objective: requestText,
        policySHA256: policyHash, sourceFingerprint: C.digest(hostBytes), mode: .auto,
        materialRefs: [], budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 60_000),
        policy: .init(sourceSHA256: hash, projectionSHA256: policyHash, text: policyText), hostContext: host)
    try check(try C.decodeRequest(C.encode(request)) == request, "request round trip")
    var fourHost = host
    fourHost.explicitRoutes = [.init(surface: .chatgpt, instruction: "1+1"), .init(surface: .codex, instruction: "2+2"),
        .init(surface: .claude, instruction: "3+3"), .init(surface: .claudeChat, instruction: "4+4")]
    try C.validate(fourHost)
    var explicitRequest = request; explicitRequest.mode = .explicitRoutingTest; explicitRequest.hostContext = fourHost
    explicitRequest.sourceFingerprint = C.digest(try C.encode(fourHost))
    let decodedExplicit = try C.decodeRequest(C.encode(explicitRequest))
    try check(decodedExplicit.hostContext?.explicitRoutes == fourHost.explicitRoutes &&
              decodedExplicit.hostContext?.explicitRoutes?.first?.surface == .chatgpt,
              "immutable four user targets preserve payloads and ordinary ChatGPT identity")
    var alteredExplicit = explicitRequest; alteredExplicit.hostContext?.explicitRoutes?[0].surface = .gptChat
    try reject("model cannot relabel ordinary GPT as Codex-funded chat") { try C.validate(alteredExplicit) }
    var badExplicitHost = fourHost; badExplicitHost.explicitRoutes?.append(fourHost.explicitRoutes![0])
    try reject("duplicate exact surface/instruction binding") { try C.validate(badExplicitHost) }
    badExplicitHost = fourHost; badExplicitHost.explicitRoutes = (0..<9).map { .init(surface: .codex, instruction: "Task \($0)") }
    try reject("explicit route budget is bounded") { try C.validate(badExplicitHost) }
    badExplicitHost = fourHost; badExplicitHost.explicitRoutes?[0].instruction = " "
    try reject("empty explicit delegated objective") { try C.validate(badExplicitHost) }
    badExplicitHost = host; badExplicitHost.explicitRoutes = [.init(surface: .codex, instruction: "1+1"), .init(surface: .codex, instruction: "2+2")]
    try C.validate(badExplicitHost); checks += 1
    var explicitObject = try JSONSerialization.jsonObject(with: C.encode(explicitRequest)) as! [String: Any]
    var explicitHostObject = explicitObject["host_context"] as! [String: Any]
    var routeObjects = explicitHostObject["explicit_routes"] as! [[String: Any]]
    routeObjects[0]["model"] = "model-must-not-author-user-target"; explicitHostObject["explicit_routes"] = routeObjects
    explicitObject["host_context"] = explicitHostObject
    try reject("nested model-authored target field is rejected") { _ = try C.decodeRequest(JSONSerialization.data(withJSONObject: explicitObject)) }
    var invalidRequest = request; invalidRequest.schema = 2
    try reject("unsupported schema") { _ = try C.decodeRequest(C.encode(invalidRequest)) }
    invalidRequest = request; invalidRequest.request = "a different task"
    try reject("request payload/hash mismatch") { try C.validate(invalidRequest) }
    invalidRequest = request; invalidRequest.hostContext?.providerPreference = "other-account"
    try reject("host context mutation") { try C.validate(invalidRequest) }
    var object = try JSONSerialization.jsonObject(with: C.encode(request)) as! [String: Any]
    object["fallback_model"] = "strongest-model"
    try reject("no implicit fallback schema") { _ = try C.decodeRequest(JSONSerialization.data(withJSONObject: object)) }
    object = try JSONSerialization.jsonObject(with: C.encode(request)) as! [String: Any]
    var budget = object["budget"] as! [String: Any]; budget["api_key"] = "fixture-not-a-real-secret"; object["budget"] = budget
    try reject("nested extra field rejection") { _ = try C.decodeRequest(JSONSerialization.data(withJSONObject: object)) }
    let encodedText = String(decoding: try C.encode(request), as: UTF8.self)
    let duplicate = encodedText.replacingOccurrences(of: "\"schema\":1", with: "\"schema\":1,\"schema\":1")
    try reject("duplicate object keys") { _ = try C.decodeRequest(Data(duplicate.utf8)) }
    let escapedDuplicate = encodedText.replacingOccurrences(of: "\"schema\":1", with: "\"schema\":1,\"sch\\u0065ma\":1")
    try reject("escaped duplicate object keys") { _ = try C.decodeRequest(Data(escapedDuplicate.utf8)) }

    let config = C.ExactConfig(surface: .gptChat, transport: .codexAppServer, accountID: "account-fixture",
        model: "gpt-fixture-low", effort: .low, tools: [], scope: .readOnly, permissionProfile: .readOnly,
        quotaPool: .openAICodex, allowedPaths: [], configurationSHA256: hash)
    let candidate = C.Candidate(id: "candidate-fixture", config: config, quotaRemainingFraction: nil,
        quotaObservedAtMS: nil, quotaValidUntilMS: nil, qualityState: .policyAdmitted,
        estimatedCostUnits: nil, availability: .unknown, availabilityObservedAtMS: nil, availabilityValidUntilMS: nil)
    let catalog = C.Catalog(taskID: request.taskID, requestSHA256: request.requestSHA256, candidates: [candidate])
    try check(try C.decodeCatalog(C.encode(catalog), request: request) == catalog, "unknown candidate metadata remains unknown")
    let catalogObject = try JSONSerialization.jsonObject(with: C.encode(catalog)) as! [String: Any]
    let candidateObject = (catalogObject["candidates"] as! [[String: Any]])[0]
    try check(candidateObject["quota_remaining_fraction"] is NSNull && candidateObject["estimated_cost_units"] is NSNull,
              "null quota and cost, not free/full quota")
    var wrongConfig = config; wrongConfig.quotaPool = .openAIChat
    try reject("Codex cannot become consumer ChatGPT quota") { try C.validate(wrongConfig) }
    wrongConfig = config; wrongConfig.surface = .chatgpt
    try reject("wrong consumer transport") { try C.validate(wrongConfig) }
    wrongConfig = config; wrongConfig.tools = ["shell"]
    try reject("bounded chat cannot obtain tools") { try C.validate(wrongConfig) }
    var wrongCatalog = catalog; wrongCatalog.candidates.append(candidate)
    try reject("duplicate catalog IDs") { try C.validate(wrongCatalog) }
    var badCandidate = candidate; badCandidate.quotaRemainingFraction = 1
    try reject("quota value without observation") { try C.validate(badCandidate) }
    badCandidate = candidate; badCandidate.quotaRemainingFraction = -1
    try reject("negative quota") { try C.validate(badCandidate) }

    let node = C.PlanNode(id: "node-fixture", instruction: "Return the translation only.", dependencies: [],
        kind: .agent, candidateID: candidate.id, scope: .readOnly, ownedPaths: [], contextRefs: [])
    let plan = C.Plan(taskID: request.taskID, requestSHA256: request.requestSHA256, nodes: [node])
    try check(try C.decodePlan(C.encode(plan), catalog: catalog) == plan, "single node remains a recorded plan")
    var badPlan = plan; badPlan.nodes[0].dependencies = ["missing"]
    try reject("missing parent dependency") { try C.validate(badPlan, catalog: catalog) }
    badPlan = plan; badPlan.nodes[0].candidateID = "unlisted"
    try reject("planner cannot invent candidate") { try C.validate(badPlan, catalog: catalog) }
    badPlan = plan; badPlan.nodes[0].ownedPaths = ["/tmp/owned"]
    try reject("read-only ownership upgrade") { try C.validate(badPlan, catalog: catalog) }
    var second = node; second.id = "second"; second.dependencies = [node.id]
    badPlan = plan; badPlan.nodes[0].dependencies = [second.id]; badPlan.nodes.append(second)
    try reject("DAG cycle") { try C.validate(badPlan, catalog: catalog) }
    var writerConfig = config; writerConfig.surface = .codex; writerConfig.scope = .workspaceWrite
    writerConfig.permissionProfile = .workspaceWrite; writerConfig.tools = ["write"]; writerConfig.allowedPaths = ["Sources"]
    let writer = C.Candidate(id: "writer-fixture", config: writerConfig, quotaRemainingFraction: nil,
        quotaObservedAtMS: nil, quotaValidUntilMS: nil, qualityState: .policyAdmitted, estimatedCostUnits: nil,
        availability: .unknown, availabilityObservedAtMS: nil, availabilityValidUntilMS: nil)
    let writerCatalog = C.Catalog(taskID: request.taskID, requestSHA256: request.requestSHA256, candidates: [writer])
    var writeA = node; writeA.candidateID = writer.id; writeA.scope = .workspaceWrite; writeA.ownedPaths = ["Sources/A.swift"]
    var writeB = writeA; writeB.id = "writer-second"; writeB.ownedPaths = ["Sources"]
    var writing = C.Plan(taskID: request.taskID, requestSHA256: request.requestSHA256, nodes: [writeA, writeB])
    try reject("concurrent write overlap") { try C.validate(writing, catalog: writerCatalog) }
    writing.nodes[1].dependencies = [writeA.id]
    try C.validate(writing, catalog: writerCatalog); checks += 1
    writing.nodes[1].ownedPaths = ["../Outside.swift"]
    try reject("scope traversal is not authorized") { try C.validate(writing, catalog: writerCatalog) }

    let ticket = C.ExecutionTicket(taskID: request.taskID, nodeID: node.id, attemptID: "attempt-fixture",
        candidateID: candidate.id, requestSHA256: request.requestSHA256, policySHA256: request.policySHA256,
        policySourceSHA256: hash, sourceFingerprint: request.sourceFingerprint, configurationSHA256: hash,
        selectedConfig: config, objective: request.objective, instruction: node.instruction,
        contextRefs: [], ownedPaths: [], originalRequest: request.request, originalObjective: request.objective, hostContext: host)
    try check(try C.decodeTicket(C.encode(ticket), candidate: candidate, request: request) == ticket,
              "ticket binds original task and exact selected configuration")
    var legacyTicketObject = try JSONSerialization.jsonObject(with: C.encode(ticket)) as! [String: Any]
    try check(legacyTicketObject["native_resume_session_id"] is NSNull,
              "no session continuity is explicitly null, never guessed")
    legacyTicketObject.removeValue(forKey: "native_resume_session_id")
    try check(try C.decodeTicket(JSONSerialization.data(withJSONObject: legacyTicketObject)) == ticket,
              "older tickets without a native resume field remain valid")
    var codexResume = ticket
    codexResume.selectedConfig.surface = .codex
    codexResume.nativeResumeSessionID = host.codexSessionID
    try check(try C.decodeTicket(C.encode(codexResume), request: request) == codexResume,
              "full Codex may resume only its exact immutable host session")
    var claudeResume = ticket
    var claudeHost = host; claudeHost.claudeSessionID = "11111111-2222-4333-8444-555555555555"
    claudeResume.hostContext = claudeHost
    claudeResume.sourceFingerprint = C.digest(try C.encode(claudeHost))
    claudeResume.selectedConfig.surface = .claude
    claudeResume.selectedConfig.transport = .claudeCLI
    claudeResume.selectedConfig.quotaPool = .anthropicShared
    claudeResume.selectedConfig.model = "claude-fixture-low"
    claudeResume.nativeResumeSessionID = claudeHost.claudeSessionID
    try check(try C.decodeTicket(C.encode(claudeResume)) == claudeResume,
              "full Claude may resume its exact UUID host session, without inferring account ownership")
    for malformedID in ["", " ", "../native-fixture", "session/id", "session\nother", "세션", String(repeating: "s", count: 129)] {
        var malformed = codexResume; malformed.nativeResumeSessionID = malformedID
        try reject("malformed native resume ID is not an executable session: \(malformedID.utf8.count) bytes") {
            _ = try C.decodeTicket(C.encode(malformed))
        }
    }
    var badResume = codexResume; badResume.nativeResumeSessionID = claudeHost.claudeSessionID
    try reject("Claude ID cannot become the Codex session") { try C.validate(badResume) }
    badResume = claudeResume; badResume.nativeResumeSessionID = host.codexSessionID
    try reject("Codex ID cannot become the Claude session") { try C.validate(badResume) }
    badResume = codexResume; badResume.hostContext = nil
    try reject("resume without immutable host context") { try C.validate(badResume) }
    badResume = codexResume; badResume.hostContext?.codexSessionID = nil
    badResume.sourceFingerprint = C.digest(try C.encode(badResume.hostContext!))
    try reject("missing matching provider session cannot be invented") { try C.validate(badResume) }
    badResume = ticket; badResume.nativeResumeSessionID = host.codexSessionID
    try reject("bounded GPT chat must not borrow a full Codex session") { try C.validate(badResume) }
    badResume = claudeResume; badResume.selectedConfig.surface = .claudeChat
    try reject("bounded Claude chat must not borrow a full Claude session") { try C.validate(badResume) }
    badResume = codexResume; badResume.selectedConfig.surface = .chatgpt
    badResume.selectedConfig.transport = .chatGPTService; badResume.selectedConfig.quotaPool = .openAIChat
    try reject("ordinary ChatGPT cannot borrow either native agent session") { try C.validate(badResume) }
    var mistypedResumeObject = try JSONSerialization.jsonObject(with: C.encode(codexResume)) as! [String: Any]
    mistypedResumeObject["native_resume_session_id"] = true
    try reject("resume field is never coerced from a non-string") {
        _ = try C.decodeTicket(JSONSerialization.data(withJSONObject: mistypedResumeObject))
    }
    var badTicket = ticket; badTicket.selectedConfig.effort = .max
    try reject("adapter cannot raise or lower effort") { try C.validate(badTicket, candidate: candidate, request: request) }
    badTicket = ticket; badTicket.originalRequest = "New task"
    try reject("delegation cannot replace original objective") { try C.validate(badTicket, candidate: candidate, request: request) }
    let record = C.ExecutionRecord(taskID: ticket.taskID, nodeID: ticket.nodeID, attemptID: ticket.attemptID,
        candidateID: ticket.candidateID, configurationSHA256: hash, selectedConfig: config,
        acknowledgedConfig: config, observedConfig: config, status: .succeeded, output: "좋은 아침입니다.",
        executionVerified: true, taskVerified: false, taskQuality: .executionOnly, parityState: .unverified,
        nativeReceipt: "/private/fixture/receipt.json", sideEffects: .none,
        usage: .init(inputTokens: 10, outputTokens: 5, providerCalls: 1), dispatchStage: .dispatched)
    try check(try C.decodeRecord(C.encode(record), ticket: ticket) == record,
              "execution proof does not become task proof or parity")
    var largerNativeRecord = record; largerNativeRecord.nativeSummary = String(repeating: "native fixture summary;", count: 1_000)
    try check(try C.decodeRecord(C.encode(largerNativeRecord), ticket: ticket).nativeSummary == largerNativeRecord.nativeSummary,
              "native summary larger than 16KB survives unchanged")
    // The turn attestation (2026-10-14): optional, a boolean both ways, and
    // absent on an older adapter's record, which still decodes.
    for value in [true, false] {
        var attested = record; attested.nativeTurnTerminated = value
        let bytes = try C.encode(attested)
        try check(String(decoding: bytes, as: UTF8.self).contains("\"native_turn_terminated\":\(value)") &&
                  (try C.decodeRecord(bytes, ticket: ticket).nativeTurnTerminated) == value,
                  "the native turn attestation round-trips: \(value)")
    }
    let olderBytes = try C.encode(record)
    try check(!String(decoding: olderBytes, as: UTF8.self).contains("native_turn_terminated") &&
              (try C.decodeRecord(olderBytes, ticket: ticket).nativeTurnTerminated) == nil,
              "an older adapter's record (no attestation) still decodes")
    var mistypedAttestation = try JSONSerialization.jsonObject(with: olderBytes) as! [String: Any]
    mistypedAttestation["native_turn_terminated"] = "yes"
    try reject("the turn attestation is never coerced from a non-boolean") {
        _ = try C.decodeRecord(JSONSerialization.data(withJSONObject: mistypedAttestation), ticket: ticket)
    }
    try check(RCCNativeAttemptOutcome.turnTerminated(dispatched: false, transportAttested: false) &&
              RCCNativeAttemptOutcome.turnTerminated(dispatched: true, transportAttested: true) &&
              !RCCNativeAttemptOutcome.turnTerminated(dispatched: true, transportAttested: false),
              "a dispatched turn is attested ended only by its transport")
    var badRecord = record; badRecord.observedConfig = nil
    try check(try C.decodeRecord(C.encode(badRecord), ticket: ticket).observedConfig == nil,
              "unexposed provider settings remain unknown while execution receipt is verified")
    badRecord.acknowledgedConfig = nil
    try reject("unacknowledged/unobserved configuration cannot be verified") { try C.validate(badRecord, ticket: ticket) }
    badRecord = record; badRecord.parityState = .referenceEquivalent
    try reject("execution-only is not parity") { try C.validate(badRecord) }
    badRecord = record; badRecord.taskVerified = true
    try reject("task quality labels match evidence status") { try C.validate(badRecord) }
    badRecord = record; badRecord.attemptID = "another-attempt"
    try reject("returned record matches exact attempt") { try C.validate(badRecord, ticket: ticket) }
    badRecord = record; badRecord.dispatchStage = .notDispatched
    try reject("not dispatched cannot be executed") { try C.validate(badRecord) }
    badRecord = record; badRecord.usage?.costUnits = 10
    try reject("cost metric must be explicit") { try C.validate(badRecord) }

    let result = C.Result(output: record.output!, executionVerified: true, taskVerified: false,
        parityState: .unverified, nativeReceipt: record.nativeReceipt)
    let snapshot = C.Snapshot(taskID: request.taskID, requestSHA256: request.requestSHA256, state: .returnedUnverified,
        revision: 2, children: [.init(id: node.id, state: .succeeded, attemptID: ticket.attemptID, candidateID: candidate.id)],
        result: result, error: nil)
    try check(try C.decodeSnapshot(C.encode(snapshot)) == snapshot, "unverified candidate remains visible")
    var parallelSummaries = snapshot
    parallelSummaries.result?.nativeSummaries = (0..<4).map { index in String(repeating: "native-\(index);", count: 55_000) }
    try check(try C.decodeSnapshot(C.encode(parallelSummaries)) == parallelSummaries,
              "four bounded native summaries survive a larger-than-1MB snapshot without truncation")
    var badSnapshot = snapshot; badSnapshot.result?.taskVerified = true
    try reject("returned_unverified cannot quietly mean complete") { try C.validate(badSnapshot) }
    badSnapshot = snapshot; badSnapshot.state = .running
    try reject("result cannot attach to running state") { try C.validate(badSnapshot) }
    let deterministic = C.Snapshot(taskID: request.taskID, requestSHA256: request.requestSHA256, state: .completed,
        revision: 2, children: [], result: .init(output: "2", executionVerified: true, taskVerified: true,
            parityState: .unverified, nativeReceipt: nil, taskQuality: .taskVerified), error: nil)
    try check(try C.decodeSnapshot(C.encode(deterministic)) == deterministic,
              "exact local completion has no fabricated native provider receipt")
    let uncertain = C.Snapshot(taskID: request.taskID, requestSHA256: request.requestSHA256, state: .effectsUncertain,
        revision: 3, children: [.init(id: node.id, state: .effectsUncertain, attemptID: ticket.attemptID,
            candidateID: candidate.id, selectedConfig: config, outputSummary: nil)], result: nil, error: "Transport outcome unknown")
    try check(try C.decodeSnapshot(C.encode(uncertain)) == uncertain,
              "uncertain executed effect is preserved, not implicitly retried")
    var requestedOnly = uncertain
    requestedOnly.state = .held
    requestedOnly.children = [.init(id: "requested-1", state: .held, attemptID: nil, candidateID: nil,
        instruction: "1+1", requestedSurface: .chatgpt)]
    try check(try C.decodeSnapshot(C.encode(requestedOnly)) == requestedOnly,
              "held ordinary ChatGPT requested surface roundtrips without execution identity")
    var legacySnapshotObject = try JSONSerialization.jsonObject(with: C.encode(requestedOnly)) as! [String: Any]
    var legacyChildren = legacySnapshotObject["children"] as! [[String: Any]]
    legacyChildren[0].removeValue(forKey: "requested_surface")
    legacySnapshotObject["children"] = legacyChildren
    let legacySnapshot = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: legacySnapshotObject))
    try check(legacySnapshot.children.first?.requestedSurface == nil,
              "legacy child missing requested surface remains decodable and unknown")
    try check(legacySnapshot.children.first?.routingDecision == nil,
              "snapshot written before host routing decisions remains decodable")
    let decision = C.RoutingDecision(routeClass: "deep", resolvedCandidateID: candidate.id, surface: config.surface,
        model: config.model, effort: config.effort, quotaPool: config.quotaPool,
        reason: "resolver;pool_rank_0;effort_exact", quotaRemainingFraction: 0.4)
    var routed = uncertain; routed.children[0].routingDecision = decision
    try check(try C.decodeSnapshot(C.encode(routed)) == routed, "host routing decision roundtrips with its child")
    var badRouted = routed; badRouted.children[0].routingDecision?.resolvedCandidateID = "another-row"
    try reject("routing decision must name the child's exact row") { try C.validate(badRouted) }
    badRouted = routed; badRouted.children[0].routingDecision?.routeClass = "flagship"
    try reject("route class is one of trivial/standard/deep") { try C.validate(badRouted) }
    badRouted = routed; badRouted.children[0].routingDecision?.effort = .max
    try reject("routing decision cannot disagree with the dispatched config") { try C.validate(badRouted) }
    badRouted = routed; badRouted.children[0].routingDecision?.quotaRemainingFraction = 1.5
    try reject("quota fraction stays within 0...1") { try C.validate(badRouted) }
    // A REVAS ladder route (2026-10-13): optional, graded only, strictly below
    // the reference, and the child runs the cheap effort or the reference.
    try check(!String(decoding: try C.encode(routed), as: UTF8.self).contains("ladder"),
              "a decision without a ladder keeps its former wire shape")
    var laddered = routed
    laddered.children[0].routingDecision?.ladder = .init(cheapEffort: config.effort, referenceEffort: .max)
    try check(try C.decodeSnapshot(C.encode(laddered)) == laddered, "a ladder decision roundtrips with its child")
    var escalated = laddered; escalated.children[0].selectedConfig = nil
    escalated.children[0].routingDecision?.effort = .max
    try C.validate(escalated); checks += 1
    badRouted = laddered; badRouted.children[0].routingDecision?.ladder = .init(cheapEffort: .max, referenceEffort: config.effort)
    try reject("a ladder effort must be below its reference") { try C.validate(badRouted) }
    badRouted = laddered; badRouted.children[0].routingDecision?.routeClass = nil
    try reject("only a graded node is laddered") { try C.validate(badRouted) }
    badRouted = escalated; badRouted.children[0].routingDecision?.effort = .ultra
    try reject("a laddered child runs only the cheap or the reference effort") { try C.validate(badRouted) }
    // Build 378 tier routing: an optional tier, and a two-model ladder whose
    // cheap tuple is a lower tier and whose reference is a frontier model.
    try check(!String(decoding: try C.encode(routed), as: UTF8.self).contains("\"tier\""),
              "a decision without a tier keeps its former wire shape")
    var tierRouted = routed
    tierRouted.children[0].routingDecision?.tier = "fast"
    tierRouted.children[0].routingDecision?.ladder = .init(cheapEffort: config.effort, referenceEffort: .max,
        cheapModel: config.model, referenceModel: "frontier-fixture")
    try check(try C.decodeSnapshot(C.encode(tierRouted)) == tierRouted, "a tier decision with a two-model ladder roundtrips")
    var tierEscalated = tierRouted; tierEscalated.children[0].selectedConfig = nil
    tierEscalated.children[0].routingDecision?.model = "frontier-fixture"
    tierEscalated.children[0].routingDecision?.effort = .max; tierEscalated.children[0].routingDecision?.tier = "frontier"
    try C.validate(tierEscalated); checks += 1
    // An explicit max on a lower tier escalates on the model alone.
    var sameEffort = tierRouted; sameEffort.children[0].selectedConfig = nil
    sameEffort.children[0].routingDecision?.effort = .max
    sameEffort.children[0].routingDecision?.ladder = .init(cheapEffort: .max, referenceEffort: .max,
        cheapModel: config.model, referenceModel: "frontier-fixture")
    try C.validate(sameEffort); checks += 1
    var badTier = tierRouted; badTier.children[0].routingDecision?.tier = "flagship"
    try reject("a tier is one of frontier/workhorse/efficient/fast") { try C.validate(badTier) }
    badTier = tierRouted; badTier.children[0].routingDecision?.ladder?.referenceModel = nil
    try reject("a tier ladder names both models") { try C.validate(badTier) }
    badTier = tierEscalated; badTier.children[0].routingDecision?.model = "another-model"
    try reject("a tier ladder runs only its cheap or its reference tuple") { try C.validate(badTier) }
    badTier = tierRouted; badTier.children[0].routingDecision?.ladder = .init(cheapEffort: config.effort,
        referenceEffort: config.effort, cheapModel: config.model, referenceModel: config.model)
    try reject("a tier ladder's two tuples differ") { try C.validate(badTier) }
    var ladderObject = try JSONSerialization.jsonObject(with: C.encode(laddered)) as! [String: Any]
    var ladderChildren = ladderObject["children"] as! [[String: Any]]
    var ladderDecision = ladderChildren[0]["routing_decision"] as! [String: Any]
    ladderDecision["ladder"] = ["cheap_effort": config.effort.rawValue, "reference_effort": "max", "evidence": 20]
    ladderChildren[0]["routing_decision"] = ladderDecision; ladderObject["children"] = ladderChildren
    try reject("a ladder rejects an unknown field") {
        _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: ladderObject))
    }
    var routedObject = try JSONSerialization.jsonObject(with: C.encode(routed)) as! [String: Any]
    var routedChildren = routedObject["children"] as! [[String: Any]]
    var routedDecision = routedChildren[0]["routing_decision"] as! [String: Any]
    routedDecision["route_class"] = NSNull(); routedDecision["quota_remaining_fraction"] = NSNull()
    routedChildren[0]["routing_decision"] = routedDecision; routedObject["children"] = routedChildren
    try check(try C.decodeSnapshot(JSONSerialization.data(withJSONObject: routedObject)).children[0].routingDecision?.routeClass == nil,
              "adapter-bound decision with null route class and unknown quota decodes")
    routedDecision["planner_pick"] = "invented"; routedChildren[0]["routing_decision"] = routedDecision
    routedObject["children"] = routedChildren
    try reject("routing decision rejects an unknown field") {
        _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: routedObject))
    }
    var aliasedSnapshot = requestedOnly; aliasedSnapshot.children[0].selectedConfig = config
    try reject("ordinary ChatGPT requested surface cannot alias Codex-funded gpt-chat selection") {
        try C.validate(aliasedSnapshot)
    }
    legacyChildren[0]["requested_surface"] = "unknown-provider"
    legacySnapshotObject["children"] = legacyChildren
    try reject("requested surface must be a known typed surface") {
        _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: legacySnapshotObject))
    }
    let event = C.Event(taskID: request.taskID, revision: snapshot.revision, type: .snapshot,
        nodeID: node.id, attemptID: ticket.attemptID, observedAtMS: 1_000, snapshot: snapshot)
    try check(try C.decodeEvent(C.encode(event)) == event, "UI event carries same task revision")
    var badEvent = event; badEvent.revision += 1
    try reject("snapshot revision cannot drift") { try C.validate(badEvent) }
    let nativeWireScript = """
    import {pathToFileURL} from 'node:url';
    import {createHash} from 'node:crypto';
    import {mkdtemp,rm} from 'node:fs/promises';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    const {createRCCRuntime,hostContextFingerprint}=await import(pathToFileURL(process.argv[1]).href);
    const root=await mkdtemp(join(tmpdir(),'rcc-swift-node-wire-'));
    const sha=s=>createHash('sha256').update(s).digest('hex');
    const emittedTickets=[];
    async function produce(verified,count,graded=false,ladder=false,tiered=false){
      const host={workspace:root,context:null,provider_preference:'auto',codex_session_id:'native-codex-fixture',
        claude_session_id:null,require_read_only:true,owner_policy:null,explicit_routes:null};
      const request='Exercise the fixture adapter through the real durable runtime.';
      const task={schema:1,task_id:tiered?'task-node-tiered':ladder?'task-node-ladder':graded?'task-node-graded':verified?'task-node-verified':'task-node-unverified',request,
        request_sha256:sha(request),objective:request,policy_sha256:sha('fixture policy'),
        source_fingerprint:hostContextFingerprint(host),mode:'auto',material_refs:[],
        budget:{max_attempts:2,max_parallel:4,max_cost_units:null,max_duration_ms:60000},host_context:host,
        policy:{source_sha256:sha('fixture source'),projection_sha256:sha('fixture policy'),text:'fixture policy'}};
      const now=Date.now();
      const candidate={id:'fake-codex',surface:'codex',transport:'codex_app_server',account_id:'fixture-account',
        model:'fixture-model',effort:'low',tools:[],scope:'read_only',permission_profile:'read_only',
        quota_pool:'openai_codex',allowed_paths:[],configuration_sha256:sha('fixture config'),
        availability:'available',availability_observed_at_ms:now-100,availability_valid_until_ms:now+30000,
        quota_remaining_fraction:0.7,quota_observed_at_ms:now-100,quota_valid_until_ms:now+30000,
        quality_state:'policy_admitted',estimated_cost_units:1};
      // A ladder fixture adds the reference row (same model at max); a fake
      // verifier registry and explicitly reference-bound fake ledger parity
      // admit the cheaper low row. Unbound summaries are not parity evidence.
      const candidates=ladder?[candidate,{...candidate,id:'fake-codex-max',effort:'max',configuration_sha256:sha('fixture config max')}]:[candidate];
      // A tier fixture (build 378): the frontier reference and a fast model in
      // one pool; the first fast answer is empty, so REVAS escalates once.
      if(tiered)candidates.splice(0,candidates.length,
        {...candidate,id:'fake-astra-max',model:'gpt-6-astra',effort:'max',configuration_sha256:sha('fixture astra max')},
        {...candidate,id:'fake-luna-low',model:'gpt-6-luna',effort:'low',configuration_sha256:sha('fixture luna low')});
      // A graded node carries route_class; the real core binds the row.
      const nodes=Array.from({length:count},(_,i)=>({id:'n'+(i+1),instruction:'Return '+(2*(i+1)),
        dependencies:[],kind:'agent',...(tiered?{route_class:'trivial'}:graded?{route_class:'standard'}:{candidate_id:candidate.id}),
        scope:'read_only',owned_paths:[],context_refs:[]}));
      const runtime=await createRCCRuntime({stateDir:join(root,ladder?'ladder':graded?'graded':verified?'verified':'unverified'),
        ...(ladder?{verifierRegistry:new Map([['standard:read_only:agent',async()=>({passed:true,reason:'fixture'})]]),
          ledgerStats:(_family,model,_effort,referenceEffort)=>({verified_passes:20,verifier_failures:0,
            reference_model:model,reference_effort:referenceEffort})}:{}),
        catalog:async()=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,candidates,
          ...(tiered?{model_tiers:{'gpt-6-astra':'frontier','gpt-6-luna':'fast'}}:{})}),
        plan:async()=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,nodes}),
        execute:async ticket=>{emittedTickets.push(ticket);return ({schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,
          candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,
          selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,observed_config:null,
          status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',
          output:tiered&&ticket.selected_config.model==='gpt-6-luna'?' ':String(2*Number(ticket.node_id.slice(1))),
          execution_verified:true,task_verified:verified,task_quality:verified?'task_verified':'execution_only',
          parity_state:'unverified',native_receipt:join(root,'synthetic-native-'+ticket.attempt_id),
          usage:{input_tokens:4,output_tokens:2},native_summary:verified?JSON.stringify({node:ticket.node_id}):'x'.repeat(20000)});},
        ...(verified?{verifyTask:async({children})=>({schema:1,task_id:task.task_id,
          task_verified:children.every(c=>c.output===String(2*Number(c.id.slice(1)))),
          output:children.map(c=>c.output).join(','),parity_state:'unverified',reason:'Exact fixture output checks'})}:{})});
      try{
        let snapshot=await runtime.submit(task);const deadline=Date.now()+5000;
        while(!['completed','returned_unverified','failed','held','effects_uncertain'].includes(snapshot.state)){
          if(Date.now()>deadline)throw Error('fixture runtime timeout');
          await new Promise(resolve=>setTimeout(resolve,5));snapshot=runtime.status({schema:1,task_id:task.task_id});
        }
        return snapshot;
      }finally{await runtime.close();}
    }
    try{process.stdout.write(JSON.stringify({completed:await produce(true,4),unverified:await produce(false,1),
      graded:await produce(false,1,true),laddered:await produce(false,1,true,true),
      tiered:await produce(false,1,true,false,true),tickets:emittedTickets}));}
    finally{await rm(root,{recursive:true,force:true});}
    """
    let wireProcess = Process(), wireOutput = Pipe(), wireErrors = Pipe()
    wireProcess.executableURL = process.executableURL
    wireProcess.arguments = (wireProcess.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", nativeWireScript, runtimeModule.path]
    wireProcess.standardOutput = wireOutput; wireProcess.standardError = wireErrors
    try wireProcess.run()
    let actualWire = wireOutput.fileHandleForReading.readDataToEndOfFile()
    let actualErrors = wireErrors.fileHandleForReading.readDataToEndOfFile(); wireProcess.waitUntilExit()
    try check(wireProcess.terminationStatus == 0, "real Node snapshot producer exited successfully (error bytes \(actualErrors.count))")
    let nativeSnapshots = try JSONSerialization.jsonObject(with: actualWire) as! [String: Any]
    let nativeCompleted = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["completed"]!))
    try check(nativeCompleted.state == .completed && nativeCompleted.children.count == 4 && nativeCompleted.result?.output == "2,4,6,8",
              "REAL Node-produced completed four-child snapshot decodes without semantic loss")
    let nativeUnverified = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["unverified"]!))
    try check(nativeUnverified.state == .returnedUnverified && nativeUnverified.result?.taskVerified == false &&
              nativeUnverified.result?.nativeSummaries?.first?.utf8.count == 20_000,
              "REAL Node-produced 20KB native summary remains visible and unverified")
    let actualTickets = try (nativeSnapshots["tickets"] as! [[String: Any]]).map {
        try C.decodeTicket(JSONSerialization.data(withJSONObject: $0))
    }
    try check(actualTickets.count == 9, "REAL Node execution tickets all pass the strict Swift schema")
    // Host routing receipts (2026-10-13): the real core's graded and
    // adapter-bound decisions decode under the strict child shape.
    let nativeGraded = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["graded"]!))
    let gradedDecision = nativeGraded.children.first?.routingDecision
    try check(nativeGraded.state == .returnedUnverified && gradedDecision?.routeClass == "standard" &&
              gradedDecision?.resolvedCandidateID == "fake-codex" && gradedDecision?.effort == .low &&
              gradedDecision?.reason.hasPrefix("resolver;") == true && gradedDecision?.quotaRemainingFraction == 0.7,
              "REAL Node graded node is bound by the host and its routing decision is public")
    try check(nativeCompleted.children.allSatisfy { $0.routingDecision?.routeClass == nil && $0.routingDecision?.reason == "adapter_bound" },
              "REAL Node adapter-bound rows are recorded as bound, not graded")
    try check(try C.decodeSnapshot(C.encode(nativeGraded)) == nativeGraded, "routing decision roundtrips through Swift")
    // The planner's "Return 2" for this one indivisible node is replaced by
    // the owner's request (lockIndivisibleInstruction), and the decision says so.
    try check(gradedDecision?.reason == "resolver;route_reference;pool_rank_0;effort_low;agent_surface;instruction_host_locked" &&
              gradedDecision?.ladder == nil,
              "REAL Node reference decision names its route, pool, surface and the host instruction lock")
    let gradedTickets = actualTickets.filter { $0.taskID == "task-node-graded" }
    try check(gradedTickets.count == 1 && gradedTickets[0].instruction == "Exercise the fixture adapter through the real durable runtime." &&
              gradedTickets[0].objective == gradedTickets[0].instruction && nativeGraded.children.first?.instruction == gradedTickets[0].instruction,
              "REAL Node single-node ticket runs the owner's request, never the planner's paraphrase")
    try check(actualTickets.filter { $0.taskID == "task-node-verified" }.map(\.instruction).sorted() ==
              ["Return 2", "Return 4", "Return 6", "Return 8"],
              "REAL Node four-node decomposition keeps the planner's instructions")
    let nativeLaddered = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["laddered"]!))
    let nativeLadderDecision = nativeLaddered.children.first?.routingDecision
    try check(nativeLaddered.state == .returnedUnverified && nativeLadderDecision?.effort == .low &&
              nativeLadderDecision?.ladder == C.RoutingDecision.Ladder(cheapEffort: .low, referenceEffort: .max) &&
              nativeLadderDecision?.reason.hasPrefix("resolver;route_ladder;") == true &&
              nativeLaddered.children.first?.selectedConfig?.effort == .low,
              "REAL Node ladder decision (fake registry and parity) decodes under the strict child shape")
    // Build 378: the real core's tier route, its failure signal and its one
    // REVAS escalation decode under the strict Swift shapes.
    let nativeTiered = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["tiered"]!))
    let tierDecision = nativeTiered.children.first?.routingDecision
    try check(nativeTiered.state == .returnedUnverified && tierDecision?.routeClass == "trivial" &&
              tierDecision?.model == "gpt-6-astra" && tierDecision?.effort == .max && tierDecision?.tier == "frontier" &&
              tierDecision?.ladder == C.RoutingDecision.Ladder(cheapEffort: .low, referenceEffort: .max,
                  cheapModel: "gpt-6-luna", referenceModel: "gpt-6-astra") &&
              tierDecision?.reason.hasPrefix("tier_escalated_after_failure_signal;route_reference;tier_frontier;") == true &&
              nativeTiered.result?.output == "2",
              "REAL Node tier route escalated once to its reference decodes under the strict child shape")
    let tierTickets = actualTickets.filter { $0.taskID == "task-node-tiered" }
    try check(tierTickets.map { "\($0.selectedConfig.model)/\($0.selectedConfig.effort.rawValue)" } ==
              ["gpt-6-luna/low", "gpt-6-astra/max"] && tierTickets[0].nativeResumeSessionID == nil &&
              tierTickets[1].nativeResumeSessionID == "native-codex-fixture",
              "REAL Node tier tickets: the discardable fast attempt in a fresh native session, then the reference resuming the untouched owner thread")
    try check(try C.decodeSnapshot(C.encode(nativeTiered)) == nativeTiered, "a tier routing decision roundtrips through Swift")
    let soloTickets = actualTickets.filter { $0.taskID == "task-node-unverified" }
    try check(soloTickets.count == 1 && soloTickets[0].nativeResumeSessionID == "native-codex-fixture",
              "REAL core-issued single full-agent ticket retains its exact host session")
    let parallelTickets = actualTickets.filter { $0.taskID == "task-node-verified" }
    try check(parallelTickets.count == 4 && parallelTickets.allSatisfy { $0.nativeResumeSessionID == nil },
              "REAL four-agent tickets never share the existing native session")
    // Native handback is a typed receipt transition, not permission from prose.
    var writeHost = host; writeHost.requireReadOnly = false; writeHost.codexSessionID = nil
    var writeConfig = record.selectedConfig
    writeConfig.surface = .claude; writeConfig.transport = .claudeCLI; writeConfig.quotaPool = .anthropicShared
    writeConfig.scope = .workspaceWrite; writeConfig.permissionProfile = .workspaceWrite; writeConfig.allowedPaths = ["**"]
    var parentRecord = record
    parentRecord.selectedConfig = writeConfig; parentRecord.acknowledgedConfig = writeConfig
    parentRecord.observedConfig = nil; parentRecord.nativeSummary = "{\"fixture\":true}"
    parentRecord.handback = .init(kind: .fullAccessRequired, nativeSessionID: "native-claude-parent",
        protectedRoot: "/tmp/os1-source-fixture", sourceHead: String(repeating: "a", count: 40),
        protectedSourceSHA256: hash, sourceFingerprint: C.digest(try C.encode(writeHost)),
        requestSHA256: ticket.requestSHA256, parentAttemptID: parentRecord.attemptID)
    try check(try C.decodeRecord(C.encode(parentRecord)).handback == parentRecord.handback,
              "native handback preserves every source/session/attempt field")
    var badHandback = parentRecord; badHandback.handback?.cancelled = true
    try reject("cancelled receipt cannot request continuation") { try C.validate(badHandback) }
    badHandback = parentRecord; badHandback.handback?.parentAttemptID = "wrong-attempt"
    try reject("handback cannot change parent attempt") { try C.validate(badHandback) }
    badHandback = parentRecord; badHandback.selectedConfig = record.selectedConfig
    try reject("read-only/chat cannot acquire write through handback") { try C.validate(badHandback) }
    badHandback = parentRecord; badHandback.handback?.exitCode = 1
    try reject("nonzero native exit cannot resume as handback") { try C.validate(badHandback) }
    var continued = ticket
    continued.hostContext = writeHost; continued.sourceFingerprint = C.digest(try C.encode(writeHost))
    continued.selectedConfig = writeConfig; continued.attemptID = "second-native-attempt"
    continued.nativeResumeSessionID = "native-claude-parent"
    continued.continuation = .init(kind: .fullAccessRequired, parentAttemptID: parentRecord.attemptID,
        parentNativeReceipt: "/tmp/private-parent-receipt.json", parentNativeReceiptSHA256: hash,
        nativeSessionID: "native-claude-parent", protectedRoot: "/tmp/os1-source-fixture",
        sourceHead: String(repeating: "a", count: 40), protectedSourceSHA256: hash,
        sourceFingerprint: continued.sourceFingerprint, requestSHA256: continued.requestSHA256)
    try check(try C.decodeTicket(C.encode(continued)).continuation == continued.continuation,
              "same-task continuation can carry executed parent session, not a host identity claim")
    var badContinuation = continued; badContinuation.continuation?.sourceFingerprint = hash
    try reject("continuation must retain immutable host source") { try C.validate(badContinuation) }
    badContinuation = continued; badContinuation.nativeResumeSessionID = "different-session"
    try reject("full-access must resume exact verified parent session") { try C.validate(badContinuation) }
    badContinuation = continued; badContinuation.continuation?.kind = .both
    try reject("both phases cannot dispatch as one unverified transition") { try C.validate(badContinuation) }
    badContinuation = continued; badContinuation.continuation?.parentAttemptID = continued.attemptID
    try reject("continuation cannot depend on itself") { try C.validate(badContinuation) }
    var repair = continued; repair.continuation?.kind = .os1ChangeRequired; repair.nativeResumeSessionID = nil
    try check(try C.decodeTicket(C.encode(repair)).nativeResumeSessionID == nil,
              "OS-1 repair starts fresh; parent non-OS-1 writes are never replayed")
    // Returned execution can be rejected by the adoption gate without erasure.
    parentRecord.handback?.adoption = .rejected; parentRecord.taskQuality = .failed
    try check(try C.decodeRecord(C.encode(parentRecord)).handback?.adoption == .rejected,
              "known executed rejected output remains handback evidence, not quality proof")
    print("RCC Runtime contract: \(checks) offline identity/schema/config/DAG/state checks PASS; provider calls 0")
}
