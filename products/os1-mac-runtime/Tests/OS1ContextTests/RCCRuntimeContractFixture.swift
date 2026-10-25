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
    // K12: the result contract version is an optional request field. Absent
    // (nil) encodes no key at all, so a v1 host's request bytes are unchanged.
    try check(!String(decoding: try C.encode(request), as: UTF8.self).contains("result_contract_version") &&
              request.resultContractVersion == nil, "a v1 request carries no result_contract_version key")
    for version in [1, 2] {
        var versioned = request; versioned.resultContractVersion = version
        let decoded = try C.decodeRequest(C.encode(versioned))
        try check(decoded == versioned && decoded.resultContractVersion == version,
                  "result contract v\(version) request roundtrips")
    }
    for version in [0, 3, -1] {
        var versioned = request; versioned.resultContractVersion = version
        try reject("result contract version \(version) is not negotiable") { _ = try C.decodeRequest(C.encode(versioned)) }
    }
    var versionObject = try JSONSerialization.jsonObject(with: C.encode(request)) as! [String: Any]
    versionObject["result_contract_version"] = "2"
    try reject("a string result contract version is rejected") {
        _ = try C.decodeRequest(JSONSerialization.data(withJSONObject: versionObject))
    }
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
    var writing = C.Plan(taskID: request.taskID, requestSHA256: request.requestSHA256, nodes: [writeA, writeB],
                         finalNodeID: .collection)
    try reject("concurrent write overlap") { try C.validate(writing, catalog: writerCatalog) }
    writing.nodes[1].dependencies = [writeA.id]
    writing.finalNodeID = .node(writeB.id)
    try C.validate(writing, catalog: writerCatalog); checks += 1
    writing.nodes[1].ownedPaths = ["../Outside.swift"]
    try reject("scope traversal is not authorized") { try C.validate(writing, catalog: writerCatalog) }

    // Presence-aware final ownership: no omitted/null collapse and no guessed
    // sink. Caller-only host contexts do not exist in untrusted plan JSON.
    let legacyPlanObject = try JSONSerialization.jsonObject(with: C.encode(plan)) as! [String: Any]
    try check(plan.finalNodeID == .absent && legacyPlanObject["final_node_id"] == nil,
              "legacy initializer and encoding omit final ownership")
    var independent = second; independent.dependencies = []
    let collection = C.Plan(taskID: request.taskID, requestSHA256: request.requestSHA256,
        nodes: [node, independent], finalNodeID: .collection)
    let collectionBytes = try C.encode(collection)
    let collectionObject = try JSONSerialization.jsonObject(with: collectionBytes) as! [String: Any]
    try check(collectionObject["final_node_id"] is NSNull &&
              C.decodePlan(collectionBytes, catalog: catalog) == collection,
              "explicit collection null survives decode and encode")
    var merger = node; merger.id = "final-merge"; merger.dependencies = [node.id, independent.id]
    let finalPlan = C.Plan(taskID: request.taskID, requestSHA256: request.requestSHA256,
        nodes: [node, independent, merger], finalNodeID: .node(merger.id))
    try check(try C.decodePlan(C.encode(finalPlan), catalog: catalog) == finalPlan,
              "named final ancestor closure owns every node")
    var oneCollection = plan; oneCollection.finalNodeID = .collection
    try check(try C.decodePlan(C.encode(oneCollection), catalog: catalog) == oneCollection && oneCollection != plan,
              "even one-node explicit null is not absent")
    var malformedFinal = collection; malformedFinal.finalNodeID = .absent
    try reject("multi-node omission has no inferred collection") { try C.validate(malformedFinal, catalog: catalog) }
    malformedFinal.nodes[1].dependencies = [node.id]
    try reject("unique sink does not infer final ownership") { try C.validate(malformedFinal, catalog: catalog, context: .hostBound) }
    malformedFinal = collection; malformedFinal.nodes[1].dependencies = [node.id]
    try reject("authored collection must be independent") { try C.validate(malformedFinal, catalog: catalog) }
    try check(try C.decodePlan(C.encode(malformedFinal), catalog: catalog, context: .hostBound) == malformedFinal,
              "caller-bound collection preserves host safety ordering")
    malformedFinal = finalPlan; malformedFinal.finalNodeID = .node("unknown-final")
    try reject("unknown final ID") { try C.validate(malformedFinal, catalog: catalog) }
    malformedFinal.finalNodeID = .node("outside/final")
    try reject("invalid final ID syntax") { try C.validate(malformedFinal, catalog: catalog) }
    malformedFinal = finalPlan; malformedFinal.finalNodeID = .node(node.id)
    try reject("final ancestor closure cannot omit other workers") { try C.validate(malformedFinal, catalog: catalog) }
    malformedFinal = finalPlan; malformedFinal.nodes[0].dependencies = [merger.id]
    try reject("named final never hides a cycle") { try C.validate(malformedFinal, catalog: catalog, context: .hostBound) }
    malformedFinal = collection; malformedFinal.nodes[0].dependencies = ["missing"]
    try reject("bound collection never hides missing dependencies") { try C.validate(malformedFinal, catalog: catalog, context: .hostBound) }
    malformedFinal = collection; malformedFinal.nodes[0].dependencies = [independent.id]
    malformedFinal.nodes[1].dependencies = [node.id]
    try reject("bound collection never hides a cycle") { try C.validate(malformedFinal, catalog: catalog, context: .hostBound) }
    let wrongFinalValues: [Any] = [true, 7, [String](), ["node": node.id]]
    for wrongFinal in wrongFinalValues {
        var value = legacyPlanObject; value["final_node_id"] = wrongFinal
        try reject("final ownership wire type must be null or string") {
            _ = try C.decodePlan(JSONSerialization.data(withJSONObject: value), catalog: catalog)
        }
    }
    var wrongPlanObject = collectionObject; wrongPlanObject["validation_context"] = "hostBound"
    try reject("wire cannot assert trusted bound context") { _ = try C.decodePlan(JSONSerialization.data(withJSONObject: wrongPlanObject)) }
    var duplicateFinal = String(decoding: collectionBytes, as: UTF8.self)
    duplicateFinal = duplicateFinal.replacingOccurrences(of: "\"final_node_id\":null",
        with: "\"final_node_id\":null,\"final_node_id\":null")
    try reject("duplicate final ownership key is rejected") { _ = try C.decodePlan(Data(duplicateFinal.utf8)) }
    var legacyExplicit = collection; legacyExplicit.finalNodeID = .absent
    try check(try C.decodePlan(C.encode(legacyExplicit), catalog: catalog, context: .hostBoundExplicitRoutes) == legacyExplicit,
              "trusted original explicit mode preserves legacy omitted multi-route collection")
    try reject("ordinary host context is not explicit-routing authority") { try C.validate(legacyExplicit, catalog: catalog, context: .hostBound) }
    legacyExplicit.nodes[1].dependencies = [node.id]
    try reject("legacy explicit routes cannot acquire dependencies") { try C.validate(legacyExplicit, catalog: catalog, context: .hostBoundExplicitRoutes) }
    try reject("explicit routes cannot choose one final and discard other results") { try C.validate(finalPlan, catalog: catalog, context: .hostBoundExplicitRoutes) }
    var orderedWriters = writing; orderedWriters.nodes[1].ownedPaths = ["Sources"]
    orderedWriters.finalNodeID = .collection
    try check(try C.decodePlan(C.encode(orderedWriters), catalog: writerCatalog, context: .hostBound) == orderedWriters,
              "host-serialized overlapping writers keep collection null")
    try reject("writer safety ordering is not an authored collection") { try C.validate(orderedWriters, catalog: writerCatalog) }
    orderedWriters.nodes[1].dependencies = []
    try reject("host-bound context does not remove writer exclusivity") { try C.validate(orderedWriters, catalog: writerCatalog, context: .hostBound) }

    // Actual Node Core emits each ownership form and today's legacy explicit
    // fan-out. Swift preserves the bytes' semantic shape, then the actual JS
    // ownership validator accepts the Swift-encoded result. No Core runtime,
    // SQLite store, executor, native account or model is constructed here.
    func purePlanJS(_ script: String, _ bytes: Data) throws -> Data {
        let p = Process(), i = Pipe(), o = Pipe(), e = Pipe()
        p.executableURL = process.executableURL
        p.arguments = (p.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
            ["--input-type=module", "-e", script, runtimeModule.path]
        p.standardInput = i; p.standardOutput = o; p.standardError = e
        try p.run(); try i.fileHandleForWriting.write(contentsOf: bytes); try i.fileHandleForWriting.close()
        let result = o.fileHandleForReading.readDataToEndOfFile()
        let error = e.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
        try check(p.terminationStatus == 0 && result.count < 128_000,
                  "REAL Node plan wire vector (error bytes \(error.count))")
        return result
    }
    var wireOrdered = writing; wireOrdered.nodes[1].ownedPaths = ["Sources"]; wireOrdered.finalNodeID = .collection
    var explicitVectorConfig = config; explicitVectorConfig.surface = .codex
    let explicitVectorCandidate = C.Candidate(id: "codex-wire-fixture", config: explicitVectorConfig,
        quotaRemainingFraction: nil, quotaObservedAtMS: nil, quotaValidUntilMS: nil,
        qualityState: .policyAdmitted, estimatedCostUnits: nil, availability: .unknown,
        availabilityObservedAtMS: nil, availabilityValidUntilMS: nil)
    let explicitVectorCatalog = C.Catalog(taskID: request.taskID, requestSHA256: request.requestSHA256,
                                        candidates: [explicitVectorCandidate])
    let nodeObject = try JSONSerialization.jsonObject(with: C.encode(node))
    let orderedObject = try JSONSerialization.jsonObject(with: C.encode(wireOrdered))
    let wireInput = try JSONSerialization.data(withJSONObject: ["task_id": request.taskID,
        "request_sha256": request.requestSHA256, "node": nodeObject, "ordered": orderedObject,
        "explicit_candidate_id": explicitVectorCandidate.id])
    let vectorScript = """
    import{pathToFileURL}from'node:url';import{readFileSync}from'node:fs';
    const{assertFinalOutputOwnership,hostPlan}=await import(pathToFileURL(process.argv[1]).href);
    const x=JSON.parse(readFileSync(0,'utf8')),a=x.node,b={...a,id:'js-second',dependencies:[]};
    const base={schema:1,task_id:x.task_id,request_sha256:x.request_sha256};
    const task={...base,mode:'explicit_routing_test',material_refs:[],host_context:{require_read_only:true,
      explicit_routes:[{surface:'codex',instruction:'First independent fixture'},{surface:'codex',instruction:'Second independent fixture'}]}};
    const old=hostPlan(task,{model_tiers:{'gpt-6-astra':'frontier'}});
    // Sole synthetic catalog row binding, not model-authored rights.
    old.nodes=old.nodes.map(n=>({...n,candidate_id:x.explicit_candidate_id}));
    const rows=[{name:'legacy',mode:'auto',plan:{...base,nodes:[a]}},
      {name:'collection',mode:'auto',plan:{...base,nodes:[a,b],final_node_id:null}},
      {name:'named',mode:'auto',plan:{...base,nodes:[a,b,{...a,id:'js-final',dependencies:[a.id,b.id]}],final_node_id:'js-final'}},
      {name:'host-ordered',mode:'auto',plan:x.ordered},{name:'legacy-explicit',mode:'explicit_routing_test',plan:old}];
    for(const r of rows)assertFinalOutputOwnership(r.plan,{mode:r.mode},{collectionMayBeOrdered:r.name==='host-ordered'});
    console.log(JSON.stringify(rows));
    """
    let vectorBytes = try purePlanJS(vectorScript, wireInput)
    let vectors = try JSONSerialization.jsonObject(with: vectorBytes) as! [[String: Any]]
    var returnedVectors: [[String: Any]] = []
    for vector in vectors {
        let name = vector["name"] as! String
        let context: C.PlanValidationContext = name == "host-ordered" ? .hostBound :
            name == "legacy-explicit" ? .hostBoundExplicitRoutes : .authored
        let rowCatalog = name == "host-ordered" ? writerCatalog :
            name == "legacy-explicit" ? explicitVectorCatalog : catalog
        let decoded = try C.decodePlan(JSONSerialization.data(withJSONObject: vector["plan"]!), catalog: rowCatalog, context: context)
        let encoded = try JSONSerialization.jsonObject(with: C.encode(decoded)) as! [String: Any]
        let original = vector["plan"] as! [String: Any]
        try check((original["final_node_id"] == nil) == (encoded["final_node_id"] == nil) &&
                  (original["final_node_id"] is NSNull) == (encoded["final_node_id"] is NSNull),
                  "JS/Swift presence preserved for " + name)
        returnedVectors.append(["name": name, "mode": vector["mode"]!, "plan": encoded])
    }
    let reverseScript = """
    import{pathToFileURL}from'node:url';import{readFileSync}from'node:fs';import assert from'node:assert/strict';
    const{assertFinalOutputOwnership}=await import(pathToFileURL(process.argv[1]).href);
    const x=JSON.parse(readFileSync(0,'utf8'));assert.equal(x.rows.length,x.original.length);
    for(let i=0;i<x.rows.length;i++){const r=x.rows[i];assert.deepEqual(r,x.original[i]);
      assertFinalOutputOwnership(r.plan,{mode:r.mode},{collectionMayBeOrdered:r.name==='host-ordered'});}
    console.log(JSON.stringify({vectors:x.rows.length,passed:true}));
    """
    let reverseBytes = try purePlanJS(reverseScript,
        JSONSerialization.data(withJSONObject: ["rows": returnedVectors, "original": vectors]))
    let reverse = try JSONSerialization.jsonObject(with: reverseBytes) as! [String: Any]
    try check(reverse["passed"] as? Bool == true && reverse["vectors"] as? Int == 5,
              "REAL JS-to-Swift-to-JS ownership vectors retain legacy/null/string/host ordering/explicit routes")

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
    // K12 partial result v2: a failed, held or cancelled task carries a result
    // only as a typed partial bound to this task and to its children.
    try check(!String(decoding: try C.encode(snapshot), as: UTF8.self).contains("\"partial\"") &&
              (try C.decodeSnapshot(C.encode(snapshot))).result?.partial == nil,
              "a whole answer has no partial key and decodes with partial nil (legacy snapshots too)")
    let partialChildren: [C.ChildSnapshot] = [
        .init(id: "n1", state: .completed, attemptID: "attempt-n1", candidateID: candidate.id),
        .init(id: "n2", state: .failed, attemptID: "attempt-n2", candidateID: candidate.id)]
    let typedPartial = C.Partial(coverage: .init(completedNodeIDs: ["n1"], unresolvedNodeIDs: ["n2"]),
        parent: .init(taskID: request.taskID, requestSHA256: request.requestSHA256, revision: 7),
        nodes: [.init(nodeID: "n1", attemptID: "attempt-n1", outputSHA256: C.digest(Data("2".utf8)))])
    let partialFailed = C.Snapshot(taskID: request.taskID, requestSHA256: request.requestSHA256, state: .failed,
        revision: 8, children: partialChildren, result: .init(output: "n1: 2", executionVerified: true,
            taskVerified: false, parityState: .unverified, nativeReceipt: "/private/fixture/aggregate.json",
            taskQuality: .executionOnly, partial: typedPartial), error: "verified_not_dispatched_retry_exhausted")
    for state in [C.State.failed, .held, .cancelled, .returnedUnverified] {
        var typed = partialFailed; typed.state = state
        try check(try C.decodeSnapshot(C.encode(typed)) == typed, "a v2 partial on \(state.rawValue) roundtrips")
    }
    var heldWithRetained = partialFailed; heldWithRetained.state = .returnedUnverified
    heldWithRetained.children[1].state = .held
    heldWithRetained.result?.partial?.nodes.append(.init(nodeID: "n2", attemptID: "attempt-n2",
        outputSHA256: C.digest(Data("4".utf8)), nativeReceiptSHA256: C.digest(Data("receipt".utf8))))
    try check(try C.decodeSnapshot(C.encode(heldWithRetained)) == heldWithRetained,
              "a held child's retained output is carried and still unresolved")
    try check(!C.negotiated(partialFailed, resultContractVersion: nil) && !C.negotiated(partialFailed, resultContractVersion: 1) &&
              C.negotiated(partialFailed, resultContractVersion: 2) && C.negotiated(snapshot, resultContractVersion: nil) &&
              C.negotiated(snapshot, resultContractVersion: 2),
              "negotiation: a typed partial answers only a v2 request; a whole answer answers any")
    try check(typedPartial.coverage.label().contains("1/2") && typedPartial.coverage.label().hasSuffix("n2") &&
              C.PartialCoverage(completedNodeIDs: [], unresolvedNodeIDs: (1...10).map { "u\($0)" }).label(maximumIDs: 8)
                .hasSuffix("u8 +2"), "the coverage label names counts and at most eight unresolved ids")
    var unversioned = partialFailed; unversioned.result?.partial = nil
    try reject("negotiation absent: a failed task with a v1 result is rejected") { try C.validate(unversioned) }
    unversioned.state = .held
    try reject("negotiation absent: a held task with a v1 result is rejected") { try C.validate(unversioned) }
    unversioned.state = .returnedUnverified
    try C.validate(unversioned); checks += 1
    func rejectPartial(_ label: String, _ change: (inout C.Snapshot) -> Void) throws {
        var bad = partialFailed; change(&bad)
        try reject(label) { try C.validate(bad) }
    }
    for state in [C.State.running, .planning, .queued, .waiting, .cancelling, .completed, .effectsUncertain, .awaitingInstall] {
        try rejectPartial("a partial whose parent has not ended (\(state.rawValue))") { $0.state = state }
    }
    try rejectPartial("unknown id in coverage") { $0.result?.partial?.coverage.completedNodeIDs = ["n1", "n9"] }
    try rejectPartial("an id both completed and unresolved") { $0.result?.partial?.coverage.unresolvedNodeIDs = ["n1", "n2"] }
    try rejectPartial("coverage misses a child") {
        $0.children.append(.init(id: "n3", state: .queued, attemptID: nil, candidateID: nil))
    }
    try rejectPartial("a duplicate coverage id") { $0.result?.partial?.coverage.unresolvedNodeIDs = ["n2", "n2"] }
    try rejectPartial("nothing unresolved is not a partial") {
        $0.children[1].state = .completed
        $0.result?.partial?.coverage = .init(completedNodeIDs: ["n1", "n2"], unresolvedNodeIDs: [])
        $0.result?.partial?.nodes.append(.init(nodeID: "n2", attemptID: "attempt-n2", outputSHA256: C.digest(Data("4".utf8))))
    }
    try rejectPartial("a completed id names an unfinished child") {
        $0.result?.partial?.coverage = .init(completedNodeIDs: ["n2"], unresolvedNodeIDs: ["n1"])
    }
    try rejectPartial("an unresolved id names a completed child") { $0.children[1].state = .completed }
    try rejectPartial("a completed node is not carried") { $0.result?.partial?.nodes = [] }
    try rejectPartial("a duplicate carried node") { let first = $0.result!.partial!.nodes[0]; $0.result?.partial?.nodes.append(first) }
    try rejectPartial("a carried node is not a child") {
        $0.result?.partial?.nodes.append(.init(nodeID: "n9", attemptID: "attempt-n9", outputSHA256: C.digest(Data("9".utf8))))
    }
    try rejectPartial("a carried node from another attempt") { $0.result?.partial?.nodes[0].attemptID = "attempt-other" }
    try rejectPartial("a carried node whose child has no attempt") { $0.children[0].attemptID = nil; $0.children[0].candidateID = nil }
    // A completed deterministic node runs on the host-computed exact local
    // row with no attempt: it alone is carried with no attempt id.
    var localExact = config
    localExact.surface = .local; localExact.transport = .local; localExact.quotaPool = .none
    localExact.model = "exact"; localExact.effort = .none
    var deterministicPartial = partialFailed
    deterministicPartial.children[0].selectedConfig = config
    deterministicPartial.children.insert(.init(id: "d", state: .completed, attemptID: nil, candidateID: "local",
        selectedConfig: localExact), at: 0)
    deterministicPartial.result?.partial?.coverage.completedNodeIDs = ["d", "n1"]
    deterministicPartial.result?.partial?.nodes.insert(.init(nodeID: "d", attemptID: nil,
        outputSHA256: C.digest(Data("2".utf8))), at: 0)
    try check(try C.decodeSnapshot(C.encode(deterministicPartial)) == deterministicPartial,
              "a completed deterministic node is carried with no attempt id")
    func rejectDeterministic(_ label: String, _ change: (inout C.Snapshot) -> Void) throws {
        var bad = deterministicPartial; change(&bad)
        try reject(label) { try C.validate(bad) }
    }
    try rejectDeterministic("a model-backed carried node without an attempt id") {
        $0.children[1].attemptID = nil; $0.result?.partial?.nodes[1].attemptID = nil
    }
    try rejectDeterministic("an attempt-less entry for a child that ran an attempt") { $0.children[0].attemptID = "attempt-d" }
    try rejectDeterministic("an attempt-less entry for a child with no selected row") { $0.children[0].selectedConfig = nil }
    try rejectDeterministic("the local worker model is not a host-computed exact row") {
        $0.children[0].selectedConfig?.model = RCCNativeCatalogBuilder.localWorkerModel
    }
    try rejectDeterministic("an attempt-less entry for an unresolved child") {
        $0.children[0].state = .held
        $0.result?.partial?.coverage = .init(completedNodeIDs: ["n1"], unresolvedNodeIDs: ["d", "n2"])
    }
    try rejectPartial("a foreign parent task") { $0.result?.partial?.parent.taskID = "task-foreign" }
    try rejectPartial("a foreign parent request") { $0.result?.partial?.parent.requestSHA256 = C.digest(Data("other".utf8)) }
    try rejectPartial("a parent revision this task has not reached") { $0.result?.partial?.parent.revision = 9 }
    try rejectPartial("a parent revision of zero") { $0.result?.partial?.parent.revision = 0 }
    try rejectPartial("an output digest that is not a hash") { $0.result?.partial?.nodes[0].outputSHA256 = "2" }
    try rejectPartial("a receipt digest that is not a hash") { $0.result?.partial?.nodes[0].nativeReceiptSHA256 = "receipt" }
    try rejectPartial("a partial is never task-verified") { $0.state = .returnedUnverified; $0.result?.taskVerified = true }
    try rejectPartial("a partial never claims parity") { $0.result?.parityState = .mismatch }
    try rejectPartial("a partial is never a failed-quality answer") { $0.result?.taskQuality = .failed }
    try rejectPartial("a partial never rides an install handoff") {
        $0.installHandoff = .init(taskID: request.taskID, requestSHA256: request.requestSHA256, nodeID: "n1",
            parentAttemptID: "attempt-n1", sourceFingerprint: hash, sourceRoot: "/tmp/rcc-fixture",
            sourceHead: String(repeating: "a", count: 40), protectedSourceSHA256: hash, stagedIntentID: "intent-fixture",
            stagedReceiptSHA256: hash, state: .staged)
    }
    var partialObject = try JSONSerialization.jsonObject(with: C.encode(partialFailed)) as! [String: Any]
    var partialResultObject = partialObject["result"] as! [String: Any]
    for (label, path) in [("partial", [String]()), ("partial.coverage", ["coverage"]), ("partial.parent", ["parent"]),
                          ("partial.nodes[0]", ["nodes"])] {
        var partialBody = partialResultObject["partial"] as! [String: Any]
        switch path.first {
        case nil: partialBody["quality_claim"] = "invented"
        case "nodes"?:
            var entries = partialBody["nodes"] as! [[String: Any]]; entries[0]["model"] = "invented"
            partialBody["nodes"] = entries
        case let key?:
            var nested = partialBody[key] as! [String: Any]; nested["extra"] = "invented"; partialBody[key] = nested
        }
        var resultCopy = partialResultObject; resultCopy["partial"] = partialBody
        var objectCopy = partialObject; objectCopy["result"] = resultCopy
        try reject("\(label) rejects an unknown field") {
            _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: objectCopy))
        }
    }
    partialResultObject["partial"] = NSNull(); partialObject["result"] = partialResultObject
    try reject("a null partial on a failed task is still no partial") {
        _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: partialObject))
    }
    // K14: the reference review notice reads the public reason token of a
    // DELIVERED model-backed child only (a whole answer's completed children,
    // or the children a typed partial carries); the exact segment, never a
    // prefix; never a local row, a held task without a result, or no child.
    func reviewed(_ reason: String, state: C.ChildState = .completed, transport: C.Transport = .codexAppServer)
        -> C.ChildSnapshot {
        var selected = config; selected.transport = transport
        return .init(id: "n1", state: state, attemptID: "attempt-n1", candidateID: candidate.id, selectedConfig: selected,
            routingDecision: .init(routeClass: "deep", resolvedCandidateID: candidate.id, surface: config.surface,
                model: config.model, effort: config.effort, quotaPool: config.quotaPool, reason: reason,
                quotaRemainingFraction: nil))
    }
    let reviewReason = "resolver;route_reference;pool_rank_0;" + C.referenceReviewToken
    let reviewedCompleted = C.Snapshot(taskID: request.taskID, requestSHA256: request.requestSHA256, state: .completed,
        revision: 3, children: [reviewed(reviewReason)], result: .init(output: "4", executionVerified: true,
            taskVerified: true, parityState: .unverified, nativeReceipt: "/private/fixture/receipt.json",
            taskQuality: .taskVerified), error: nil)
    try check(C.referenceReviewToken == "reference_review_required" &&
              (try C.decodeSnapshot(C.encode(reviewedCompleted))) == reviewedCompleted &&
              C.referenceReviewNotice(reviewedCompleted)?.isEmpty == false,
              "a completed model-backed delivery with the exact token carries the reference review notice")
    var reviewedUnverified = reviewedCompleted; reviewedUnverified.state = .returnedUnverified
    reviewedUnverified.result?.taskVerified = false; reviewedUnverified.result?.taskQuality = .executionOnly
    reviewedUnverified.children = [reviewed(reviewReason, state: .succeeded)]
    try check(C.referenceReviewNotice(reviewedUnverified) != nil, "a returned_unverified delivery carries it too")
    var reviewedHeld = reviewedCompleted; reviewedHeld.state = .held; reviewedHeld.result = nil
    var reviewedPrefix = reviewedCompleted; reviewedPrefix.children = [reviewed(reviewReason + "X")]
    var reviewedLocal = reviewedCompleted; reviewedLocal.children = [reviewed(reviewReason, transport: .local)]
    var reviewedEmpty = reviewedCompleted; reviewedEmpty.children = []
    var reviewedFailedChild = reviewedCompleted; reviewedFailedChild.children = [reviewed(reviewReason, state: .failed)]
    var reviewedPlain = reviewedCompleted; reviewedPlain.children = [reviewed("resolver;route_reference;pool_rank_0")]
    for (label, value) in [("a held task without a result", reviewedHeld), ("a token prefix", reviewedPrefix),
                           ("a local row", reviewedLocal), ("no children", reviewedEmpty),
                           ("an undelivered child", reviewedFailedChild), ("no token", reviewedPlain)] {
        try check(C.referenceReviewNotice(value) == nil, "no reference review notice for \(label)")
    }
    // A typed partial: only the children it carries are delivered.
    var reviewedPartial = partialFailed
    reviewedPartial.children[0] = reviewed(reviewReason)
    try check(C.referenceReviewNotice(reviewedPartial) != nil, "a carried partial node carries the notice")
    reviewedPartial.children[0] = reviewed("resolver;route_reference")
    var unresolvedOnly = reviewed(reviewReason, state: .failed); unresolvedOnly.id = "n2"; unresolvedOnly.attemptID = "attempt-n2"
    reviewedPartial.children[1] = unresolvedOnly
    try check(C.referenceReviewNotice(reviewedPartial) == nil, "an unresolved, uncarried child never carries the notice")
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
    try check(legacySnapshot.resourceUsage == nil, "legacy missing resource data remains unknown, not zero")
    var meteredObject = try JSONSerialization.jsonObject(with: C.encode(deterministic)) as! [String: Any]
    var resourceObject: [String: Any] = ["schema": 1, "accounting_complete": true,
        "total_tokens_observed": 121, "local_tokens_observed": 16, "native_tokens_observed": 105,
        "local_calls_started": 1, "local_calls_settled": 1, "local_worker_attempts": 0,
        "native_attempts": 1, "plan_model_calls": 0, "issues": [String](),
        "quota_savings": "not_measured", "cash_cost": "not_measured",
        "accounting_scope": "observed_attempts_as_of_snapshot_not_future_cost"]
    meteredObject["resource_usage"] = resourceObject
    let metered = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: meteredObject))
    try check(metered.resourceUsage?.totalTokensObserved == 121 && metered.resourceUsage?.accountingComplete == true,
              "Core resource metadata decodes without changing the answer")
    try check(try C.decodeSnapshot(C.encode(metered)) == metered, "resource usage roundtrip")
    // The public Core reducer includes both intent and actual local planner
    // operations in local_calls_started/settled. plan_model_calls is a subset,
    // not a promise that all planning is forever model-free. Synthetic closed
    // event fixture: intent16 + plan21 + native105 = total142 tokens.
    var plannerResources = resourceObject
    plannerResources["local_calls_started"] = 2; plannerResources["local_calls_settled"] = 2
    plannerResources["plan_model_calls"] = 1; plannerResources["local_tokens_observed"] = 37
    plannerResources["total_tokens_observed"] = 142
    meteredObject["resource_usage"] = plannerResources
    let plannerMetered = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: meteredObject))
    try check(plannerMetered.resourceUsage?.accountingComplete == true &&
              plannerMetered.resourceUsage?.planModelCalls == 1 &&
              plannerMetered.resourceUsage?.localCallsStarted == 2 &&
              plannerMetered.resourceUsage?.localCallsSettled == 2 &&
              plannerMetered.resourceUsage?.totalTokensObserved == 142,
              "complete resource accounting accepts observed settled local planner calls")
    try check(try C.decodeSnapshot(C.encode(plannerMetered)) == plannerMetered,
              "observed local planner resource summary roundtrips without becoming zero")
    for (name, key, replacement) in [("plan exceeds local calls", "plan_model_calls", 3 as Any),
                                     ("complete plan count unknown", "plan_model_calls", NSNull() as Any),
                                     ("complete local operation unsettled", "local_calls_settled", 1 as Any)] {
        var bad = plannerResources; bad[key] = replacement; meteredObject["resource_usage"] = bad
        try reject(name) { _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: meteredObject)) }
    }
    var activePlannerResources = plannerResources
    activePlannerResources["accounting_complete"] = false
    activePlannerResources["total_tokens_observed"] = NSNull()
    activePlannerResources["local_tokens_observed"] = NSNull()
    activePlannerResources["local_calls_settled"] = 1
    meteredObject["resource_usage"] = activePlannerResources
    let activePlanner = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: meteredObject))
    try check(activePlanner.resourceUsage?.planModelCalls == 1 &&
              activePlanner.resourceUsage?.accountingComplete == false &&
              activePlanner.resourceUsage?.totalTokensObserved == nil,
              "started local planner remains counted while unsettled accounting stays unknown")
    activePlannerResources["plan_model_calls"] = 3
    meteredObject["resource_usage"] = activePlannerResources
    try reject("partial plan count still cannot exceed local operations") {
        _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: meteredObject))
    }
    for (key, value) in [("local_calls_started", -1), ("local_calls_settled", 2), ("total_tokens_observed", 120)] {
        var bad = resourceObject; bad[key] = value; meteredObject["resource_usage"] = bad
        try reject("invalid resource counter or sum: " + key) {
            _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: meteredObject))
        }
    }
    resourceObject["accounting_complete"] = false
    resourceObject["total_tokens_observed"] = NSNull()
    resourceObject["local_tokens_observed"] = NSNull()
    resourceObject["plan_model_calls"] = NSNull()
    resourceObject["issues"] = ["local_usage_unknown"]
    meteredObject["resource_usage"] = resourceObject
    let partialResources = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: meteredObject))
    try check(partialResources.resourceUsage?.totalTokensObserved == nil && partialResources.resourceUsage?.accountingComplete == false,
              "missing local usage does not become zero tokens")
    var inventedBilling = resourceObject; inventedBilling["cash_cost"] = "0 dollars"
    meteredObject["resource_usage"] = inventedBilling
    try reject("resource tokens do not authorize an invented bill") {
        _ = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: meteredObject))
    }
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
    async function produce(verified,count,graded=false,ladder=false,tiered=false,disclosed=false){
      const host={workspace:root,context:null,provider_preference:'auto',codex_session_id:'native-codex-fixture',
        claude_session_id:null,require_read_only:true,owner_policy:null,explicit_routes:null};
      const request='Exercise the fixture adapter through the real durable runtime.';
      const task={schema:1,task_id:disclosed?'task-node-disclosed':tiered?'task-node-tiered':ladder?'task-node-ladder':graded?'task-node-graded':verified?'task-node-verified':'task-node-unverified',request,
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
      // A two-effort fixture adds the reference row (same model at max): build
      // 407 binds it; no ledger history or same-model ladder lowers it.
      const candidates=ladder?[candidate,{...candidate,id:'fake-codex-max',effort:'max',configuration_sha256:sha('fixture config max')}]:[candidate];
      // A tier fixture: the frontier reference and a fast model in one pool; a
      // registered sound_full node verifier certifies the fast descent (R0 (b),
      // K4); its first answer is empty, so it escalates once to the reference (R9).
      if(tiered)candidates.splice(0,candidates.length,
        {...candidate,id:'fake-astra-max',model:'gpt-6-astra',effort:'max',configuration_sha256:sha('fixture astra max')},
        {...candidate,id:'fake-luna-low',model:'gpt-6-luna',effort:'low',configuration_sha256:sha('fixture luna low')});
      // A graded node carries route_class (ignored by R0); the real core binds the row.
      const nodes=Array.from({length:count},(_,i)=>({id:'n'+(i+1),instruction:'Return '+(2*(i+1)),
        dependencies:[],kind:'agent',...(tiered?{route_class:'trivial'}:graded?{route_class:'standard'}:{candidate_id:candidate.id}),
        scope:'read_only',owned_paths:[],context_refs:[]}));
      // A disclosed fixture (R6): the registered verifier fails every answer,
      // so the descent escalates once and the reference's own answer, which
      // the verifier also rejects, is delivered with its disclosure.
      const runtime=await createRCCRuntime({stateDir:join(root,disclosed?'disclosed':ladder?'ladder':graded?'graded':verified?'verified':'unverified'),
        ...(tiered?{verifierRegistry:new Map([['fixture-sound',{id:'fixture-sound',scope:'read_only',surfaces:['agent','chat'],
          soundness:'sound_full',applies:()=>true,refutations:[{instruction:'Return 2',output:'3'}],
          verify:async input=>({passed:!disclosed&&input.output===String(2*Number(input.node_id.slice(1))),reason:'fixture'})}]])}:{}),
        catalog:async()=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,candidates,
          ...(tiered?{model_tiers:{'gpt-6-astra':'frontier','gpt-6-luna':'fast'}}:{})}),
        plan:async()=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,nodes,
          ...(count > 1 ? {final_node_id:null} : {})}),
        execute:async ticket=>{emittedTickets.push(ticket);return ({schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,
          candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,
          selected_config:ticket.selected_config,acknowledged_config:ticket.selected_config,observed_config:null,
          status:'succeeded',dispatch_stage:'dispatched',side_effects:'none',
          output:tiered&&!disclosed&&ticket.selected_config.model==='gpt-6-luna'?' ':String(2*Number(ticket.node_id.slice(1))),
          ...(disclosed?{native_turn_terminated:true}:{}),
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
      tiered:await produce(false,1,true,false,true),disclosed:await produce(false,1,true,false,true,true),
      tickets:emittedTickets}));}
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
    try check(actualTickets.count == 11, "REAL Node execution tickets all pass the strict Swift schema")
    // Host routing receipts (2026-10-13): the real core's graded and
    // adapter-bound decisions decode under the strict child shape.
    let nativeGraded = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["graded"]!))
    let gradedDecision = nativeGraded.children.first?.routingDecision
    try check(nativeGraded.state == .returnedUnverified && gradedDecision?.routeClass == "deep" &&
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
    // Build 407: a model's two efforts never form a same-model ladder; the
    // node binds the reference effort.
    let nativeLaddered = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["laddered"]!))
    let nativeLadderDecision = nativeLaddered.children.first?.routingDecision
    try check(nativeLaddered.state == .returnedUnverified && nativeLadderDecision?.effort == .max &&
              nativeLadderDecision?.ladder == nil && nativeLadderDecision?.routeClass == "deep" &&
              nativeLadderDecision?.reason.hasPrefix("resolver;route_reference;") == true &&
              nativeLaddered.children.first?.selectedConfig?.effort == .max,
              "REAL Node two-effort catalog binds the reference effort, never a ledger ladder")
    // Build 378/407: the real core's certified tier route, its failure signal
    // and its one escalation (R9) decode under the strict Swift shapes.
    let nativeTiered = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["tiered"]!))
    let tierDecision = nativeTiered.children.first?.routingDecision
    try check(nativeTiered.state == .returnedUnverified && tierDecision?.routeClass == "trivial" &&
              tierDecision?.model == "gpt-6-astra" && tierDecision?.effort == .max && tierDecision?.tier == "frontier" &&
              tierDecision?.ladder == C.RoutingDecision.Ladder(cheapEffort: .low, referenceEffort: .max,
                  cheapModel: "gpt-6-luna", referenceModel: "gpt-6-astra") &&
              tierDecision?.reason.hasPrefix("tier_escalated_after_failure_signal;route_reference;admitted_reference_escalation;tier_frontier;") == true &&
              nativeTiered.result?.output == "2",
              "REAL Node tier route escalated once to its reference decodes under the strict child shape")
    let tierTickets = actualTickets.filter { $0.taskID == "task-node-tiered" }
    try check(tierTickets.map { "\($0.selectedConfig.model)/\($0.selectedConfig.effort.rawValue)" } ==
              ["gpt-6-luna/low", "gpt-6-astra/max"] && tierTickets[0].nativeResumeSessionID == nil &&
              tierTickets[1].nativeResumeSessionID == "native-codex-fixture",
              "REAL Node tier tickets: the discardable fast attempt in a fresh native session, then the reference resuming the untouched owner thread")
    try check(try C.decodeSnapshot(C.encode(nativeTiered)) == nativeTiered, "a tier routing decision roundtrips through Swift")
    // Build 407 (R6) across the boundary: a registered node verifier that
    // rejects the escalated reference's own answer delivers it with the
    // Core's disclosure, and that snapshot decodes under the strict Swift shape.
    let nativeDisclosed = try C.decodeSnapshot(JSONSerialization.data(withJSONObject: nativeSnapshots["disclosed"]!))
    try check(nativeDisclosed.state == .returnedUnverified && nativeDisclosed.result?.output == "2" &&
              nativeDisclosed.result?.taskVerified == false &&
              nativeDisclosed.children.first?.state == .completed &&
              nativeDisclosed.children.first?.selectedConfig?.model == "gpt-6-astra" &&
              nativeDisclosed.children.first?.qualityDisclosure == C.QualityDisclosure(coverage: nil,
                  failedCheckIDs: ["node_verifier"], witnessSHA256: nil, checker: nil),
              "REAL Node node-verifier failure on the reference decodes with its disclosure and delivers the reference answer")
    try check(actualTickets.filter { $0.taskID == "task-node-disclosed" }
                .map { "\($0.selectedConfig.model)/\($0.selectedConfig.effort.rawValue)" } == ["gpt-6-luna/low", "gpt-6-astra/max"],
              "REAL Node disclosed fixture: the failed descent escalates exactly once to the reference")
    try check(try C.decodeSnapshot(C.encode(nativeDisclosed)) == nativeDisclosed, "a node-verifier disclosure roundtrips through Swift")
    // K12 across the boundary: the REAL Core's failed and held outcomes for a
    // v1 host and for a Swift-encoded result contract v2 request decode under
    // the strict Swift contract (the failed v1 task is a typed failure with no
    // result on the wire; the v2 partial is typed and bound to its children).
    var partialRequest = request; partialRequest.taskID = "task-node-partial-v2"
    partialRequest.resultContractVersion = 2; partialRequest.budget.maxAttempts = 1
    let partialWireScript = """
    import {pathToFileURL} from 'node:url';
    import {readFileSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    import {mkdtemp,rm} from 'node:fs/promises';
    import {tmpdir} from 'node:os';
    import {join} from 'node:path';
    const {createRCCRuntime}=await import(pathToFileURL(process.argv[1]).href);
    const root=await mkdtemp(join(tmpdir(),'rcc-swift-node-partial-'));
    const sha=s=>createHash('sha256').update(s).digest('hex');
    const swiftV2=JSON.parse(readFileSync(0,'utf8'));
    async function produce(name,task,error,det=false){
      const now=Date.now();
      const row=id=>({id,surface:'codex',transport:'codex_app_server',account_id:'fixture-account',model:'fixture-model',
        effort:'low',tools:[],scope:'read_only',permission_profile:'read_only',quota_pool:'openai_codex',allowed_paths:[],
        configuration_sha256:sha('fixture config '+id),availability:'available',availability_observed_at_ms:now-100,
        availability_valid_until_ms:now+30000,quota_remaining_fraction:0.7,quota_observed_at_ms:now-100,
        quota_valid_until_ms:now+30000,quality_state:'policy_admitted',estimated_cost_units:1});
      const node=(id,candidate,dependencies)=>({id,instruction:'Return '+(id==='n1'?2:4),dependencies,kind:'agent',
        candidate_id:candidate,scope:'read_only',owned_paths:[],context_refs:[]});
      const local={...row('local-exact'),surface:'local',transport:'local',model:'exact',effort:'none',quota_pool:'none',
        quota_remaining_fraction:null,quota_observed_at_ms:null,quota_valid_until_ms:null};
      const nodes=det?[{...node('d','local-exact',[]),kind:'deterministic',instruction:'1+1'},node('n1','fake-a',[]),
        node('n2','fake-b',['d','n1'])]:[node('n1','fake-a',[]),node('n2','fake-b',['n1'])];
      const runtime=await createRCCRuntime({stateDir:join(root,name),
        catalog:async()=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,
          candidates:det?[row('fake-a'),row('fake-b'),local]:[row('fake-a'),row('fake-b')]}),
        plan:async()=>({schema:1,task_id:task.task_id,request_sha256:task.request_sha256,nodes,final_node_id:'n2'}),
        execute:async ticket=>({schema:1,task_id:ticket.task_id,node_id:ticket.node_id,attempt_id:ticket.attempt_id,
          candidate_id:ticket.candidate_id,configuration_sha256:ticket.configuration_sha256,selected_config:ticket.selected_config,
          acknowledged_config:ticket.selected_config,observed_config:null,side_effects:'none',parity_state:'unverified',
          native_receipt:join(root,'synthetic-native-'+ticket.attempt_id),usage:{input_tokens:4,output_tokens:2},
          ...(ticket.node_id==='n1'?{status:'succeeded',dispatch_stage:'dispatched',output:'2',execution_verified:true,
            task_verified:false,task_quality:'execution_only',native_summary:JSON.stringify({node:'n1'})}:
           {status:'failed',dispatch_stage:'not_dispatched',output:null,error,execution_verified:false,
            task_verified:false,task_quality:'failed',native_summary:null})}),
        verifyTask:async()=>{throw Error('a partial task never requests parent adoption');}});
      try{
        let snapshot=await runtime.submit(task);const deadline=Date.now()+5000;
        while(!['completed','returned_unverified','failed','held','effects_uncertain'].includes(snapshot.state)){
          if(Date.now()>deadline)throw Error('fixture runtime timeout');
          await new Promise(resolve=>setTimeout(resolve,5));snapshot=runtime.status({schema:1,task_id:task.task_id});
        }
        const stored=runtime._load(task.task_id);
        return {snapshot,stored_version:stored.task.result_contract_version??null,durable_output:stored.result?.output??null};
      }finally{await runtime.close();}
    }
    const v1=structuredClone(swiftV2);delete v1.result_contract_version;
    const out={};
    for(const [name,task,error,det] of [['failedV1',{...v1,task_id:'task-node-partial-v1'},'synthetic_outage'],
      ['failedV2',swiftV2,'synthetic_outage'],['heldV1',{...v1,task_id:'task-node-held-v1'},'native_pre_dispatch_failed'],
      ['heldV2',{...swiftV2,task_id:'task-node-held-v2'},'native_pre_dispatch_failed'],
      ['failedV2Det',{...swiftV2,task_id:'task-node-partial-v2-det'},'synthetic_outage',true],
      ['heldV2Det',{...swiftV2,task_id:'task-node-held-v2-det'},'native_pre_dispatch_failed',true]])
      out[name]=await produce(name,task,error,det);
    try{process.stdout.write(JSON.stringify(out));}finally{await rm(root,{recursive:true,force:true});}
    """
    let partialProcess = Process(), partialInput = Pipe(), partialOutput = Pipe(), partialErrors = Pipe()
    partialProcess.executableURL = process.executableURL
    partialProcess.arguments = (partialProcess.executableURL?.path == "/usr/bin/env" ? ["node"] : []) +
        ["--input-type=module", "-e", partialWireScript, runtimeModule.path]
    partialProcess.standardInput = partialInput; partialProcess.standardOutput = partialOutput
    partialProcess.standardError = partialErrors
    try partialProcess.run()
    try partialInput.fileHandleForWriting.write(contentsOf: C.encode(partialRequest))
    try partialInput.fileHandleForWriting.close()
    let partialWire = partialOutput.fileHandleForReading.readDataToEndOfFile()
    let partialWireErrors = partialErrors.fileHandleForReading.readDataToEndOfFile(); partialProcess.waitUntilExit()
    try check(partialProcess.terminationStatus == 0,
              "real Node partial producer exited successfully (error bytes \(partialWireErrors.count))")
    let partialRuns = try JSONSerialization.jsonObject(with: partialWire) as! [String: [String: Any]]
    func partialRun(_ name: String) throws -> (C.Snapshot, Any?, Any?) {
        let run = partialRuns[name]!
        return (try C.decodeSnapshot(JSONSerialization.data(withJSONObject: run["snapshot"]!)),
                run["stored_version"], run["durable_output"])
    }
    let (failedV1, failedV1Version, failedV1Durable) = try partialRun("failedV1")
    try check(failedV1.state == .failed && failedV1.result == nil &&
              failedV1.error == "verified_not_dispatched_retry_exhausted" && failedV1Version is NSNull &&
              failedV1Durable as? String == "n1: 2",
              "REAL Node v1 failed task: a typed failure with no wire result; its partial stays durable")
    let (failedV2, failedV2Version, _) = try partialRun("failedV2")
    let wirePartial = failedV2.result?.partial
    try check(failedV2.state == .failed && failedV2Version as? Int == 2 && failedV2.result?.output == "n1: 2" &&
              wirePartial?.coverage == C.PartialCoverage(completedNodeIDs: ["n1"], unresolvedNodeIDs: ["n2"]) &&
              wirePartial?.parent.taskID == partialRequest.taskID &&
              wirePartial?.parent.requestSHA256 == partialRequest.requestSHA256 &&
              (wirePartial?.parent.revision ?? .max) <= failedV2.revision &&
              wirePartial?.nodes.count == 1 && wirePartial?.nodes.first?.nodeID == "n1" &&
              wirePartial?.nodes.first?.attemptID == failedV2.children.first(where: { $0.id == "n1" })?.attemptID &&
              wirePartial?.nodes.first?.outputSHA256 == C.digest(Data("2".utf8)) &&
              wirePartial?.nodes.first?.nativeReceiptSHA256 == nil,
              "REAL Node v2 failed partial from a Swift-encoded v2 request decodes typed and bound")
    try check(try C.decodeSnapshot(C.encode(failedV2)) == failedV2, "a REAL Node v2 partial roundtrips through Swift")
    let (heldV1, _, _) = try partialRun("heldV1")
    try check(heldV1.state == .returnedUnverified && heldV1.result?.output == "n1: 2" && heldV1.result?.partial == nil,
              "REAL Node v1 held-with-retained-output task is unchanged: returned_unverified, no partial")
    let (heldV2, _, _) = try partialRun("heldV2")
    try check(heldV2.state == .returnedUnverified && heldV2.result?.output == "n1: 2" &&
              heldV2.result?.partial?.coverage.unresolvedNodeIDs == ["n2"] &&
              heldV2.result?.partial?.parent.taskID == "task-node-held-v2",
              "REAL Node v2 held outcome types the same answer as a partial")
    // A deterministic node (host-computed exact local row, no attempt) beside
    // model-backed nodes: both v2 paths keep the answer and type it.
    for (name, state, error) in [("failedV2Det", C.State.failed, "verified_not_dispatched_retry_exhausted"),
                                 ("heldV2Det", .returnedUnverified, "native_pre_dispatch_failed")] {
        let (outcome, _, _) = try partialRun(name)
        let typed = outcome.result?.partial
        try check(outcome.state == state && outcome.error == error && outcome.result?.output == "d: 2\n\nn1: 2" &&
                  typed?.coverage == C.PartialCoverage(completedNodeIDs: ["d", "n1"], unresolvedNodeIDs: ["n2"]) &&
                  typed?.nodes.map(\.nodeID) == ["d", "n1"] && typed?.nodes[0].attemptID == nil &&
                  outcome.children.first(where: { $0.id == "d" })?.attemptID == nil &&
                  typed?.nodes[1].attemptID == outcome.children.first(where: { $0.id == "n1" })?.attemptID &&
                  typed?.nodes[1].attemptID != nil,
                  "REAL Node \(name): a deterministic node is carried with no attempt; the reason and answer stand")
        try check(try C.decodeSnapshot(C.encode(outcome)) == outcome, "a REAL Node \(name) partial roundtrips through Swift")
    }
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
    // 413: a staging capability is a paired host fact, not a writer hint.
    var stagedTicket = ticket
    stagedTicket.selectedConfig.scope = .workspaceWrite
    stagedTicket.selectedConfig.permissionProfile = .workspaceWrite
    stagedTicket.selectedConfig.allowedPaths = ["**"]
    stagedTicket.selectedConfig.surface = .codex
    stagedTicket.selectedConfig.transport = .codexAppServer
    stagedTicket.selectedConfig.quotaPool = .openAICodex
    stagedTicket.configurationSHA256 = stagedTicket.selectedConfig.configurationSHA256
    stagedTicket.ownedPaths = ["**"]
    stagedTicket.nativeResumeSessionID = nil
    stagedTicket.continuation = nil; stagedTicket.qualityContinuation = nil
    stagedTicket.hostContext = nil
    stagedTicket.executionIsolation = "codex_fresh_local_effects_v1"
    stagedTicket.executionIsolationSHA256 = hash
    stagedTicket.stagedWriterEnvelopeSHA256 = hash
    stagedTicket.stagedWriterBaseSHA256 = policyHash
    try check(try C.decodeTicket(C.encode(stagedTicket)).stagedWriterBaseSHA256 == policyHash,
              "staged writer exact envelope/base pair survives strict wire")
    var invalidStaging = stagedTicket; invalidStaging.stagedWriterBaseSHA256 = nil
    try reject("missing staging base cannot gain transactional authority") { try C.validate(invalidStaging) }
    invalidStaging = stagedTicket; invalidStaging.stagedWriterEnvelopeSHA256 = policyHash
    try reject("staging and actual isolation must name identical envelope bytes") { try C.validate(invalidStaging) }
    invalidStaging = stagedTicket; invalidStaging.selectedConfig.scope = .readOnly
    invalidStaging.selectedConfig.permissionProfile = .readOnly; invalidStaging.selectedConfig.allowedPaths = []
    invalidStaging.ownedPaths = []; invalidStaging.configurationSHA256 = invalidStaging.selectedConfig.configurationSHA256
    try reject("read-only task cannot smuggle writer apply rights") { try C.validate(invalidStaging) }
    invalidStaging = stagedTicket; invalidStaging.nativeResumeSessionID = "prior-session"
    try reject("staged candidates cannot resume dirty native history") { try C.validate(invalidStaging) }
    invalidStaging = stagedTicket; invalidStaging.executionIsolation = nil; invalidStaging.executionIsolationSHA256 = nil
    try reject("staging needs independent native local effect isolation") { try C.validate(invalidStaging) }
    // New intent version is immutable task data, not an edit to request SHA.
    var newRequest = request; newRequest.routingIntentPolicyVersion = C.RoutingIntentV2.version
    try check(try C.decodeRequest(C.encode(newRequest)) == newRequest && newRequest != request &&
              newRequest.requestSHA256 == request.requestSHA256, "intent version binds equality without rehashing original")
    var unknownVersion = request; unknownVersion.routingIntentPolicyVersion = "unreviewed-v99"
    try reject("unknown intent version") { try C.validate(unknownVersion) }
    unknownVersion = explicitRequest; unknownVersion.routingIntentPolicyVersion = C.RoutingIntentV2.version
    try reject("v2 ordinary-auto migration cannot reinterpret fanout") { try C.validate(unknownVersion) }
    var newCatalog = catalog; newCatalog.routingIntentV2 = C.RoutingIntentV2()
    newCatalog.modelTiers = [candidate.model: "frontier"]
    newCatalog.nativeReferenceEfforts = ["codex": [candidate.model: candidate.effort.rawValue]]
    try check(try C.decodeCatalog(C.encode(newCatalog), request: newRequest) == newCatalog, "strict v2 catalog roundtrip")
    try reject("legacy task cannot inherit new host semantics") { try C.validate(newCatalog, request: request) }
    try reject("new task cannot reuse legacy catalog") { try C.validate(catalog, request: newRequest) }
    var malformedV2 = newCatalog; malformedV2.routingIntentV2?.qualityTarget = "gold_proven"
    try reject("reference descriptor cannot become quality proof") { try C.validate(malformedV2, request: newRequest) }
    malformedV2 = newCatalog; malformedV2.routingIntentV2?.allowedSurfaces = ["chatgpt"]
    try reject("dropped surface denied") { try C.validate(malformedV2, request: newRequest) }
    malformedV2 = newCatalog; malformedV2.routingIntentV2?.state = "unresolved"
    try reject("unresolved parser cannot execute") { try C.validate(malformedV2, request: newRequest) }
    malformedV2 = newCatalog; malformedV2.routingIntentV2?.effort = "high"; malformedV2.routingIntentV2?.requireNativeCeiling = true
    try reject("ceiling and exact effort contradictory") { try C.validate(malformedV2, request: newRequest) }
    var objectV2 = try JSONSerialization.jsonObject(with: C.encode(newCatalog)) as! [String: Any]
    var intentObjectV2 = objectV2["routing_intent_v2"] as! [String: Any]
    intentObjectV2.removeValue(forKey: "exact_model"); objectV2["routing_intent_v2"] = intentObjectV2
    try reject("required nullable key cannot disappear") { _ = try C.decodeCatalog(JSONSerialization.data(withJSONObject: objectV2), request: newRequest) }
    var explicitNullV2 = try JSONSerialization.jsonObject(with: C.encode(catalog)) as! [String: Any]
    explicitNullV2["routing_intent_v2"] = NSNull()
    try reject("explicit null catalog version is not an absent legacy field") { _ = try C.decodeCatalog(JSONSerialization.data(withJSONObject: explicitNullV2), request: request) }
    intentObjectV2["exact_model"] = NSNull(); intentObjectV2["authority"] = "self-certified"; objectV2["routing_intent_v2"] = intentObjectV2
    try reject("unknown v2 authority field") { _ = try C.decodeCatalog(JSONSerialization.data(withJSONObject: objectV2), request: newRequest) }
    print("RCC Runtime contract: \(checks) offline identity/schema/config/DAG/state checks PASS; provider calls 0")
}
