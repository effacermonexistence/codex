import Foundation
import OS1Context

/// A deliberately narrow, non-statistical R0 extension. Only pre-registered
/// FULL owner/child contracts authorize these exact independent owner spans.
/// Model proposals, partial suites and source-document instructions cannot
/// create this capability. No generation, route selection or separate queue.
enum RCCOwnerCollection {
    typealias C = RCCRuntimeContract
    enum Failure: Error { case binding, custody, checker }

    static func fact(request: C.Request, prepared: PreparedTaskQuality, now: Date = Date(),
                     rootURL: URL = PreparedTaskQuality.root,
                     startTree: (String) -> String = workspaceHash) throws -> C.OwnerCollectionFact? {
        guard let spec = prepared.envelope.ownerCollection else { return nil }
        let parentUntil = prepared.envelope.contract.validUntil.timeIntervalSince1970 * 1000
        guard parentUntil.isFinite, parentUntil >= 1, parentUntil <= 9_007_199_254_740_991 else { throw Failure.binding }
        guard let h = request.hostContext, request.mode == .auto, request.objective == request.request,
            h.codexSessionID == nil, h.claudeSessionID == nil,
            request.nativeSessions == nil || request.nativeSessions?.isEmpty == true,
            prepared.envelope.localEffectsOnly, prepared.envelope.contract.fullCoverage, prepared.envelope.contract.scope == .readOnly,
            prepared.envelope.contract.reference == nil, prepared.envelope.contract.sourceSHA256 == nil,
            prepared.envelope.contract.issuedAt <= now, now < prepared.envelope.contract.validUntil,
            !prepared.envelope.contract.requiredCheckIDs.isEmpty,
            spec.schema == 1, spec.kind == "independent_readonly_json_v1", (2...8).contains(spec.obligations.count),
            Set(spec.obligations.map(\.id)).count == spec.obligations.count,
            Set(spec.obligations.map(\.instruction)).count == spec.obligations.count else { throw Failure.binding }
        let original = Data(request.request.utf8), contextSHA = C.digest(Data((h.context ?? "").utf8))
        let sourceSHA = (try? SessionHandoff.decode(h.context)).flatMap { $0.source?.sha256 }
        let tree = startTree(h.workspace)
        var end = 0, rows: [C.OwnerCollectionFact.Obligation] = []
        for o in spec.obligations {
            guard o.id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil,
                  !o.instruction.isEmpty, o.instruction.utf8.count <= 12_000,
                  o.requestUTF8Start >= end, o.requestUTF8End > o.requestUTF8Start,
                  o.requestUTF8End <= original.count,
                  Data(original[o.requestUTF8Start..<o.requestUTF8End]) == Data(o.instruction.utf8),
                  !o.sourcePaths.isEmpty, o.sourcePaths.count <= 128,
                  o.sourcePaths.count == o.sourceSHA256s.count,
                  Set(o.sourcePaths).count == o.sourcePaths.count else { throw Failure.binding }
            try verifySources(o.sourcePaths, hashes: o.sourceSHA256s, workspace: h.workspace)
            guard let child = try PreparedTaskQuality.prepare(objective: o.instruction, contextSHA256: contextSHA,
                sourceSHA256: sourceSHA, startTreeSHA256: tree, scope: .readOnly,
                referencePolicySHA256: request.policySHA256, workspace: nil,
                allowRegressionAcquisition: false, rootURL: rootURL),
                child.envelope.ownerCollection == nil, child.envelope.contract.fullCoverage,
                child.envelope.contract.reference == nil, !child.envelope.contract.requiredCheckIDs.isEmpty,
                Set(child.envelope.contract.requiredCheckIDs).count == child.envelope.contract.requiredCheckIDs.count,
                child.envelope.contract.issuedAt <= now, now < child.envelope.contract.validUntil else { throw Failure.binding }
            let c = child.envelope.contract
            let untilMS = c.validUntil.timeIntervalSince1970 * 1000
            guard untilMS.isFinite, untilMS >= 1, untilMS <= 9_007_199_254_740_991 else { throw Failure.binding }
            rows.append(.init(id: o.id, instruction: o.instruction, requestUTF8Start: o.requestUTF8Start,
                requestUTF8End: o.requestUTF8End, sourcePaths: o.sourcePaths, sourceSHA256s: o.sourceSHA256s,
                contractSHA256: c.sha256, verifierSHA256: c.verifierCodeSHA256,
                requiredCheckIDs: c.requiredCheckIDs, validUntilMS: Int64(untilMS.rounded(.down))))
            end = o.requestUTF8End
        }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return .init(manifestSHA256: C.digest(try encoder.encode(spec)), obligations: rows)
    }

    static func verifySources(_ paths: [String], hashes: [String], workspace: String) throws {
        let root = URL(fileURLWithPath: workspace).standardizedFileURL
        guard root.resolvingSymlinksInPath().path == root.path, paths.count == hashes.count else { throw Failure.custody }
        for (path, hash) in zip(paths, hashes) {
            let parts = path.split(separator: "/", omittingEmptySubsequences: false)
            guard !parts.isEmpty, !parts.contains(""), !parts.contains("."), !parts.contains(".."),
                !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"),
                hash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.custody }
            let target = root.appendingPathComponent(path).standardizedFileURL
            guard target.path.hasPrefix(root.path + "/"), target.resolvingSymlinksInPath().path == target.path else { throw Failure.custody }
            let before = try FileManager.default.attributesOfItem(atPath: target.path)
            guard before[.type] as? FileAttributeType == .typeRegular,
                (before[.size] as? NSNumber)?.intValue ?? Int.max <= 2_000_000 else { throw Failure.custody }
            let bytes = try Data(contentsOf: target, options: .mappedIfSafe)
            let after = try FileManager.default.attributesOfItem(atPath: target.path)
            guard C.digest(bytes) == hash, before[.systemFileNumber] as? NSNumber == after[.systemFileNumber] as? NSNumber,
                before[.size] as? NSNumber == after[.size] as? NSNumber,
                before[.modificationDate] as? Date == after[.modificationDate] as? Date,
                target.resolvingSymlinksInPath().path == target.path else { throw Failure.custody }
        }
    }

    static func observeControl(record r: C.ExecutionRecord, witness: RCCOperationalQuality.StoredWitness) throws -> NativeTurnControl.Observation {
    guard r.selectedConfig.surface == .codex, witness.ticket.nativeResumeSessionID == nil,
        let rawSummary = r.nativeSummary,
        let summaryData = rawSummary.data(using: .utf8), summaryData.count <= 1_048_576,
        let summary = try? JSONDecoder().decode(RunSummary.self, from: summaryData), summary.steps.count == 1,
        let native = summary.steps[0].nativeRecord, native.isVerified,
        native.recordPath == witness.artifact.nativeRecord.recordPath, native.turnID == witness.artifact.nativeRecord.turnID,
        let path = native.recordPath,
        codexRolloutPathTrusted(path, threadID: summary.steps[0].sessionID) else { throw Failure.binding }
    let logURL = URL(fileURLWithPath: path).standardizedFileURL
    guard logURL.path == path, logURL.resolvingSymlinksInPath().path == path else { throw Failure.custody }
    let before = try FileManager.default.attributesOfItem(atPath: path)
    guard before[.type] as? FileAttributeType == .typeRegular,
        (before[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
        (before[.size] as? NSNumber)?.intValue ?? Int.max <= 64_000_000 else { throw Failure.custody }
    let log = try Data(contentsOf: logURL)
    let control = try NativeTurnControl.inspect(log, provider: "codex", turnID: native.turnID, finalOutput: r.output ?? "")
    let after = try FileManager.default.attributesOfItem(atPath: path)
    guard before[.systemFileNumber] as? NSNumber == after[.systemFileNumber] as? NSNumber,
        before[.size] as? NSNumber == after[.size] as? NSNumber,
        before[.modificationDate] as? Date == after[.modificationDate] as? Date,
        logURL.resolvingSymlinksInPath().path == path else { throw Failure.custody }
        return control
    }

    /// This returns before Core adopts a child. An unknown control protocol
    /// is not a quality failure and never authorizes reference replay.
    static func verifyChildControl(_ data: Data) throws -> Data {
        guard let x = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(x.keys) == ["ticket", "record"], let rawTicket = x["ticket"], let rawRecord = x["record"] else { throw Failure.binding }
        let ticket = try C.decodeTicket(JSONSerialization.data(withJSONObject: rawTicket, options: [.sortedKeys]))
        let record = try C.decodeRecord(JSONSerialization.data(withJSONObject: rawRecord, options: [.sortedKeys]), ticket: ticket)
        guard ticket.nodeID.range(of: "^owner_[0-7]$", options: .regularExpression) != nil,
            ticket.selectedConfig.surface == .codex, ticket.selectedConfig.scope == .readOnly,
            ticket.nativeResumeSessionID == nil, record.status == .succeeded, record.executionVerified,
            record.sideEffects == .none, record.nativeTurnTerminated == true,
            let path = record.nativeReceipt,
            URL(fileURLWithPath: path).deletingLastPathComponent().standardizedFileURL.path ==
                FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime/native-receipts").standardizedFileURL.path
            else { throw Failure.binding }
        let stored = try C.decodeRecord(rccPrivateInput(path), ticket: ticket)
        guard stored == record, let q = stored.operationalQuality, q.localOnlyVerified,
            URL(fileURLWithPath: q.witnessPath).deletingLastPathComponent().standardizedFileURL.path == RCCOperationalQuality.root.standardizedFileURL.path
            else { throw Failure.custody }
        let bytes = try rccPrivateInput(q.witnessPath)
        guard C.digest(bytes) == q.witnessSHA256 else { throw Failure.custody }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
        let w = try decoder.decode(RCCOperationalQuality.StoredWitness.self, from: bytes)
        guard w.ticket == ticket, w.localOnlyVerified, w.nativeProfileSHA256 != nil,
            w.artifact.output == stored.output else { throw Failure.binding }
        let control = try observeControl(record: stored, witness: w)
        let root = RCCOperationalQuality.root.appendingPathComponent("control-receipts", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard root.resolvingSymlinksInPath().path == root.standardizedFileURL.path else { throw Failure.custody }
        let reply: [String: Any] = ["schema": 1, "task_id": ticket.taskID, "node_id": ticket.nodeID,
            "attempt_id": ticket.attemptID, "request_sha256": ticket.requestSHA256,
            "output_sha256": C.digest(Data((stored.output ?? "").utf8)), "control_verified": true,
            "observation": try JSONSerialization.jsonObject(with: JSONEncoder().encode(control))]
        let result = try JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])
        let file = root.appendingPathComponent(ticket.attemptID + ".json")
        guard !FileManager.default.fileExists(atPath: file.path) else { throw Failure.custody }
        try result.write(to: file, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        return result
    }

    /// Parent checker observes a Core collection, NOT a fabricated native turn.
    /// Every child is independently read back from its existing private native
    /// receipt and FULL operational witness before external checker invocation.
    static func verify(_ data: Data, rootURL: URL = PreparedTaskQuality.root,
                       receiptRoot: URL? = nil, startTree: (String) -> String = workspaceHash) throws -> Data {
        guard let x = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(x.keys) == ["task", "plan", "children"],
            let taskObject = x["task"], let planObject = x["plan"], let children = x["children"] as? [[String: Any]] else { throw Failure.binding }
        let task = try C.decodeRequest(JSONSerialization.data(withJSONObject: taskObject, options: [.sortedKeys]))
        guard let h = task.hostContext else { throw Failure.binding }
        let activePolicy = try OwnerPolicySnapshot.load(root: OwnerPolicySnapshot.defaultRoot)
        guard h.ownerPolicy.map({ activePolicy?.sourceSHA256 == $0.sourceSHA256 &&
            activePolicy?.projectionSHA256 == $0.projectionSHA256 }) ?? (activePolicy == nil) else { throw Failure.binding }
        guard let planMap = planObject as? [String: Any],
            planMap["final_node_id"] is NSNull else { throw Failure.binding }
        let plan = try C.decodePlan(JSONSerialization.data(withJSONObject: planObject, options: [.sortedKeys]))
        let context = C.digest(Data((h.context ?? "").utf8)), source = (try? SessionHandoff.decode(h.context)).flatMap { $0.source?.sha256 }
        let tree = startTree(h.workspace)
        guard let prepared = try PreparedTaskQuality.prepare(objective: task.request, contextSHA256: context,
            sourceSHA256: source, startTreeSHA256: tree, scope: .readOnly, referencePolicySHA256: task.policySHA256,
            workspace: nil, allowRegressionAcquisition: false, rootURL: rootURL),
            let collection = try fact(request: task, prepared: prepared, rootURL: rootURL, startTree: startTree),
            plan.taskID == task.taskID, plan.requestSHA256 == task.requestSHA256,
            plan.nodes.count == collection.obligations.count, children.count == plan.nodes.count,
            Set(children.compactMap { $0["id"] as? String }).count == children.count else { throw Failure.binding }
        let recordsRoot = (receiptRoot ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".os1/rcc-runtime/native-receipts")).resolvingSymlinksInPath().standardizedFileURL
        var objects: [[String: Any]] = [], receiptHashes: [String] = [], controls: [[String: Any]] = []
        for (i, o) in collection.obligations.enumerated() {
            let n = plan.nodes[i], id = "owner_\(i)"
            guard n.id == id, n.instruction == o.instruction, n.kind == .agent, n.scope == .readOnly,
                n.dependencies.isEmpty, n.ownedPaths.isEmpty, n.contextRefs == task.materialRefs,
                let child = children.first(where: { $0["id"] as? String == id }),
                child["state"] as? String == "completed", child["candidate_id"] as? String == n.candidateID,
                child["instruction"] as? String == n.instruction,
                let receiptPath = child["native_receipt"] as? String,
                URL(fileURLWithPath: receiptPath).deletingLastPathComponent().path == recordsRoot.path else { throw Failure.binding }
            let bytes = try rccPrivateInput(receiptPath), r = try C.decodeRecord(bytes)
            guard BackendAccounts.active(provider: r.selectedConfig.surface == .codex ? "codex" : "claude",
                in: BackendAccounts.load()).id == r.selectedConfig.accountID else { throw Failure.binding }
            guard r.taskID == task.taskID, r.nodeID == id, r.attemptID == child["attempt_id"] as? String,
                r.candidateID == n.candidateID, r.nativeReceipt == receiptPath,
                r.status == .succeeded, r.dispatchStage == .dispatched, r.executionVerified,
                r.sideEffects == .none, r.taskVerified, r.taskQuality == .taskVerified,
                r.selectedConfig.scope == .readOnly, r.selectedConfig == r.acknowledgedConfig,
                r.operationalQuality?.coverage == .full,
                r.operationalQuality?.assessmentState == .taskContractVerified,
                r.operationalQuality?.contractSHA256 == o.contractSHA256,
                let output = r.output, output == child["output"] as? String,
                let object = try JSONSerialization.jsonObject(with: Data(output.utf8)) as? [String: Any] else { throw Failure.binding }
            guard let q = r.operationalQuality, q.localOnlyVerified,
                URL(fileURLWithPath: q.witnessPath).deletingLastPathComponent().standardizedFileURL.path == RCCOperationalQuality.root.standardizedFileURL.path else { throw Failure.custody }
            let witnessBytes = try rccPrivateInput(q.witnessPath)
            guard C.digest(witnessBytes) == q.witnessSHA256 else { throw Failure.custody }
            let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
            let w = try decoder.decode(RCCOperationalQuality.StoredWitness.self, from: witnessBytes)
            guard w.ticket.taskID == task.taskID, w.ticket.nodeID == id, w.ticket.attemptID == r.attemptID,
                w.ticket.instruction == o.instruction, w.ticket.requestSHA256 == task.requestSHA256,
                w.ticket.sourceFingerprint == task.sourceFingerprint, w.ticket.policySHA256 == task.policySHA256,
                w.ticket.originalRequest == task.request, w.ticket.originalObjective == task.objective,
                w.ticket.selectedConfig == r.selectedConfig, w.contract.sha256 == o.contractSHA256,
                w.contract.verifierCodeSHA256 == o.verifierSHA256, w.contract.fullCoverage,
                w.localOnlyVerified, w.nativeProfileSHA256?.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
                w.contract.requiredCheckIDs == o.requiredCheckIDs,
                w.artifact.output == output, w.observedArtifact.binding.outputSHA256 == C.digest(Data(output.utf8)),
                TaskQualityEvidence.evaluate(contract: w.contract, receipt: w.receipt,
                    artifact: w.observedArtifact, currentReferencePolicySHA256: task.policySHA256, now: Date()).taskCompletionVerified
            else { throw Failure.binding }
            let control = try observeControl(record: r, witness: w)
            controls.append(try JSONSerialization.jsonObject(with: JSONEncoder().encode(control)) as! [String: Any])
            objects.append(object); receiptHashes.append(C.digest(bytes))
        }
        let output = String(decoding: try JSONSerialization.data(withJSONObject: objects, options: [.sortedKeys, .withoutEscapingSlashes]), as: UTF8.self)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; encoder.dateEncodingStrategy = .millisecondsSince1970
        let root = rootURL.appendingPathComponent("collection-runs/" + UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let checker = root.appendingPathComponent("checker.py"), input = root.appendingPathComponent("input.json")
        try prepared.checkerBytes.write(to: checker, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: checker.path)
        // Same existing output/check protocol; this distinct binding truthfully
        // identifies the Core collection and all independently observed receipts.
        let binding: [String: Any] = ["kind": "core_owner_collection_v1", "task_id": task.taskID,
            "request_sha256": task.requestSHA256, "source_fingerprint": task.sourceFingerprint,
            "collection_manifest_sha256": collection.manifestSHA256, "child_receipt_sha256s": receiptHashes, "native_control_observations": controls,
            "output_sha256": C.digest(Data(output.utf8)), "start_tree_sha256": tree]
        let payload: [String: Any] = ["contract": try JSONSerialization.jsonObject(with: encoder.encode(prepared.envelope.contract)),
            "binding": binding, "workspace": root.path, "output": output]
        try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]).write(to: input, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: input.path)
        let result = try commandOutput("/usr/bin/python3", [checker.path, input.path],
            timeout: prepared.envelope.timeoutSeconds, currentDirectory: root.path,
            environmentOverrides: ["HOME": root.path, "TMPDIR": root.path, "PYTHONNOUSERSITE": "1", "PATH": "/usr/bin:/bin"],
            removingEnvironment: Set(ProcessInfo.processInfo.environment.keys.filter {
                let k = $0.uppercased(); return k.contains("TOKEN") || k.contains("KEY") || k.contains("SECRET") || k.contains("AUTH") || k.contains("PASSWORD")
            }), captureDirectory: root)
        try result.1.write(to: root.appendingPathComponent("stdout.json")); try result.2.write(to: root.appendingPathComponent("stderr.txt"))
        for name in ["stdout.json", "stderr.txt"] {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: root.appendingPathComponent(name).path)
        }
        let checks = result.0 == 0 && result.1.count <= 128_000 ? try? JSONDecoder().decode([TaskQualityEvidence.Check].self, from: result.1) : nil
        let required = prepared.envelope.contract.requiredCheckIDs
        let passed = checks.map { checks in Set(checks.map(\.checkID)).count == checks.count &&
            Set(checks.map(\.checkID)) == Set(required) && checks.allSatisfy { $0.status == .passed } } ?? false
        // Recheck mutable authority/source after awaited external execution.
        guard startTree(h.workspace) == tree,
            let fresh = try PreparedTaskQuality.prepare(objective: task.request, contextSHA256: context,
                sourceSHA256: source, startTreeSHA256: tree, scope: .readOnly,
                referencePolicySHA256: task.policySHA256, workspace: nil, allowRegressionAcquisition: false, rootURL: rootURL),
            try encoder.encode(fresh.envelope) == encoder.encode(prepared.envelope),
            fresh.checkerBytes == prepared.checkerBytes,
            try fact(request: task, prepared: fresh, rootURL: rootURL, startTree: startTree) == collection else { throw Failure.binding }
        let receipt: [String: Any] = ["schema": 1, "kind": "core_owner_collection_checker_v1", "task_id": task.taskID,
            "binding": binding, "checker_sha256": C.digest(prepared.checkerBytes),
            "checker_stdout_sha256": C.digest(result.1), "passed": passed, "native_generation_calls": 0]
        try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys]).write(to: root.appendingPathComponent("receipt.json"))
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: root.appendingPathComponent("receipt.json").path)
        return try JSONSerialization.data(withJSONObject: ["schema": 1, "task_id": task.taskID,
            "task_verified": passed, "output": output, "parity_state": "unverified",
            "reason": passed ? "owner_collection_full_parent_checker_verified" : "owner_collection_parent_checker_failed"], options: [.sortedKeys])
    }
}

/// Synthetic custody/coverage regressions only. No live contract, provider,
/// generation or quality-comparison claim is produced by these fixtures.
func rccOwnerCollectionSelfTest() throws {
    typealias C = RCCRuntimeContract
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("os1-owner-collection-fixture-" + UUID().uuidString).resolvingSymlinksInPath()
    let workspace = root.appendingPathComponent("sources"), contracts = root.appendingPathComponent("contracts")
    for p in [root, workspace, contracts, root.appendingPathComponent("checkers")] {
        try fm.createDirectory(at: p, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }
    defer { try? fm.removeItem(at: root) }
    let sourceA = Data("SOURCE_A: awaiting a recorded written approval.\n".utf8)
    let sourceB = Data("SOURCE_B: visible notification at T; internal change time unspecified.\n".utf8)
    try sourceA.write(to: workspace.appendingPathComponent("a.txt")); try sourceB.write(to: workspace.appendingPathComponent("b.txt"))
    let instructions = ["Return the declared state and source of a.txt as one JSON object.", "Return the visible time and unknown internal time of b.txt as one JSON object."]
    let requestText = "Return these independent obligations as a JSON array, in this exact order.\n\n" + instructions.joined(separator: "\n\n")
    let h = C.HostContext(workspace: workspace.path, context: nil, providerPreference: "auto", codexSessionID: nil,
        claudeSessionID: nil, requireReadOnly: true, ownerPolicy: nil)
    let policy = C.digest(Data("synthetic fixed policy".utf8)), tree = C.digest(Data("synthetic start tree".utf8))
    let request = C.Request(taskID: "fixture-owner-collection", request: requestText, requestSHA256: C.digest(Data(requestText.utf8)),
        objective: requestText, policySHA256: policy, sourceFingerprint: C.digest(try C.encode(h)), mode: .auto,
        materialRefs: [], budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 30_000), hostContext: h)
    let checker = Data("import json\nprint(json.dumps([]))\n".utf8), checkerSHA = C.digest(checker)
    try checker.write(to: root.appendingPathComponent("checkers/" + checkerSHA + ".py"))
    let now = Date(), context = C.digest(Data()), hashes = [C.digest(sourceA), C.digest(sourceB)]
    func prepared(_ text: String, full: Bool = true, collection: TaskQualityEvidence.OwnerCollection? = nil,
                  issued: Date? = nil, until: Date? = nil) throws -> PreparedTaskQuality {
        let contract = TaskQualityEvidence.Contract(basis: .declaredTrustedContract,
            objectiveSHA256: C.digest(Data(text.utf8)), contextSHA256: context, sourceSHA256: nil, startTreeSHA256: tree,
            scope: .readOnly, verifierCodeSHA256: checkerSHA, referencePolicySHA256: policy,
            requiredCheckIDs: ["synthetic.required"], fullCoverage: full, referenceProfiles: [], reference: nil,
            issuedAt: issued ?? now.addingTimeInterval(-10), validUntil: until ?? now.addingTimeInterval(600))
        let envelope = PreparedTaskQuality.Envelope(contract: contract, checkerSHA256: checkerSHA, timeoutSeconds: 10,
            workspacePaths: [], localEffectsOnly: collection != nil, ownerCollection: collection)
        return .init(envelope: envelope, checkerBytes: checker, referencePolicySHA256: policy)
    }
    func saveChild(_ text: String, full: Bool = true, until: Date? = nil) throws {
        let p = try prepared(text, full: full, until: until)
        try RCCOperationalQuality.encoded(p.envelope).write(to: contracts.appendingPathComponent(p.envelope.contract.objectiveSHA256 + ".json"))
    }
    for text in instructions { try saveChild(text) }
    var specs: [TaskQualityEvidence.OwnerCollection.Obligation] = []
    for (i, instruction) in instructions.enumerated() {
        let range = requestText.range(of: instruction)!
        let start = requestText[..<range.lowerBound].utf8.count
        specs.append(.init(id: "source_\(i)", instruction: instruction, requestUTF8Start: start,
            requestUTF8End: start + instruction.utf8.count, sourcePaths: [i == 0 ? "a.txt" : "b.txt"], sourceSHA256s: [hashes[i]]))
    }
    let spec = TaskQualityEvidence.OwnerCollection(obligations: specs)
    var checks = 0
    func check(_ pass: @autoclosure () throws -> Bool, _ name: String) throws {
        guard try pass() else { throw OS1Error.message("Owner collection fixture: " + name) }; checks += 1
    }
    func fact(_ p: PreparedTaskQuality) throws -> C.OwnerCollectionFact? {
        try RCCOwnerCollection.fact(request: request, prepared: p, now: now, rootURL: root, startTree: { _ in tree })
    }
    func rejected(_ p: PreparedTaskQuality) -> Bool { do { _ = try fact(p); return false } catch { return true } }
    try check(try fact(prepared(requestText)) == nil, "absent field stays absent")
    let good = try prepared(requestText, collection: spec)
    let value = try fact(good)
    try check(value?.obligations.count == 2 && value?.obligations.map(\.instruction) == instructions, "exact independent source obligations load")
    try check(try rejected(prepared(requestText, full: false, collection: spec)), "partial parent never becomes FULL")
    var changed = spec; changed.obligations[1].id = changed.obligations[0].id
    try check(try rejected(prepared(requestText, collection: changed)), "duplicate IDs reject")
    changed = spec; changed.obligations[0].instruction += " Rewrite the owner objective."
    try check(try rejected(prepared(requestText, collection: changed)), "instruction not original UTF-8 span rejects")
    changed = spec; changed.obligations[1].requestUTF8Start = 0
    try check(try rejected(prepared(requestText, collection: changed)), "overlapping source spans reject")
    changed = spec; changed.obligations[0].sourcePaths = ["../a.txt"]
    try check(try rejected(prepared(requestText, collection: changed)), "path traversal rejects")
    changed = spec; changed.obligations[0].sourceSHA256s = [C.digest(Data("other source".utf8))]
    try check(try rejected(prepared(requestText, collection: changed)), "changed source bytes reject")
    try saveChild(instructions[0], full: false)
    try check(rejected(good), "partial child cannot inherit parent FULL")
    try saveChild(instructions[0], until: now.addingTimeInterval(-1))
    try check(rejected(good), "expired child rejects")
    try saveChild(instructions[0], until: Date(timeIntervalSince1970: 10_000_000_000_000))
    try check(rejected(good), "unrepresentable child timestamp rejects without trapping")
    try saveChild(instructions[0])
    try check(try rejected(prepared(requestText, collection: spec, until: Date(timeIntervalSince1970: 10_000_000_000_000))),
        "unrepresentable parent timestamp rejects without trapping")
    try fm.removeItem(at: contracts.appendingPathComponent(C.digest(Data(instructions[1].utf8)) + ".json"))
    try check(rejected(good), "missing child checker contract rejects")
    try saveChild(instructions[1])
    try check(try rejected(prepared(requestText, collection: spec, issued: now.addingTimeInterval(60))), "future parent grant rejects")
    try check(try fact(good) == value, "all rejected mutations preserve original valid source")
    print("RCC owner collection: \(checks) synthetic source custody checks PASS; provider/model calls 0")
}
