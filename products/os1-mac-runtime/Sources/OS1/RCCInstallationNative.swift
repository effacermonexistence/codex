import Foundation
import OS1Context

private func rccInstallationObject(_ data: Data, keys: Set<String>) throws -> [String: Any] {
    guard data.count <= RCCRuntimeContract.maximumWireBytes,
          case let object = try RCCRuntimeContract.checkedObject(data), Set(object.keys) == keys else {
        throw OS1Error.message("RCC installation input shape rejected")
    }
    return object
}

private func rccInstallationReceipt(_ path: String) throws -> Data {
    let root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime/native-receipts")
        .resolvingSymlinksInPath().path
    guard (path as NSString).deletingLastPathComponent == root,
          URL(fileURLWithPath: path).resolvingSymlinksInPath().path == path else {
        throw OS1Error.message("RCC installation receipt outside private custody")
    }
    return try rccPrivateInput(path)
}

private func rccStagedReceiptPath(_ id: String) -> String {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime/native-receipts/" + id + ".stage.json").path
}

private struct RCCStagePreflightRefusal: Error {
    let reason: String
    let parentRecordSHA256: String
}
func rccStageOperation(_ data: Data) throws -> Data {
    do { return try RCCRuntimeContract.encode(rccStageSelfUpdate(data)) }
    catch let refusal as RCCStagePreflightRefusal {
        return try RCCCanonicalJSON.encode(["schema": 1, "status": "not_dispatched", "reason": refusal.reason,
                                             "parent_record_sha256": refusal.parentRecordSHA256])
    }
}

/// One mechanical callback of the original core task, not another planner or
/// self-repair CLI loop. It never bumps/commits/pushes unreviewed user changes.
func rccStageSelfUpdate(_ data: Data) throws -> RCCRuntimeContract.InstallHandoff {
    typealias C = RCCRuntimeContract
    let wire = try rccInstallationObject(data, keys: ["ticket", "parent_record_path", "parent_record_sha256"])
    let ticket = try C.decodeTicket(RCCCanonicalJSON.encode(wire["ticket"]!))
    guard let path = wire["parent_record_path"] as? String, let expected = wire["parent_record_sha256"] as? String else {
        throw OS1Error.message("RCC staging parent identity absent")
    }
    let raw = try rccInstallationReceipt(path)
    guard sha256Hex(raw) == expected else { throw OS1Error.message("RCC staging parent changed") }
    let record = try C.decodeRecord(raw, ticket: ticket)
    guard record.nativeReceipt == path, let source = record.repairSource, source.sourceBeforeClean,
          record.executionVerified, record.taskQuality != .failed, let host = ticket.hostContext,
          !host.requireReadOnly, ticket.selectedConfig.scope == .workspaceWrite,
          let root = LocalProjectWorkspace.root(containing: host.workspace, projectID: "os1-clodex"),
          LocalProjectWorkspace.executionPath(root) == source.sourceRoot,
          let conversation = host.conversationID, let submission = host.submissionID,
          UUID(uuidString: conversation) != nil, UUID(uuidString: submission) != nil else {
        throw RCCStagePreflightRefusal(reason: "source_authority_missing", parentRecordSHA256: expected)
    }
    let sourceLease = try acquireOS1SourceWriteLease(root: root)
    defer { withExtendedLifetime(sourceLease) {} }
    guard let intentLease = try SelfUpdate.IntentLease.tryAcquire(root: root) else {
        throw RCCStagePreflightRefusal(reason: "staging_intent_busy", parentRecordSHA256: expected)
    }
    defer { withExtendedLifetime(intentLease) {} }
    guard !ExecutionCancellation.isCancelled, gitHead(root) == source.sourceHead,
          OS1SourceWatch.fingerprint(root: root) == source.protectedSourceSHA256,
          rccSourceIsVerifiedClean(root), SelfUpdate.loadIntent(root: root) == nil else {
        throw RCCStagePreflightRefusal(reason: "source_changed_or_uncommitted", parentRecordSHA256: expected)
    }
    // Existing installer/checker must not be changed by the same repair it
    // judges. Such a proposal is preserved for separate authority/review.
    let protected = ["Sources/OS1/main.swift", "Sources/OS1/RCCInstallationNative.swift",
                     "Sources/OS1/RCCRuntimeGatewayClient.swift", "Sources/OS1Context/RCCRuntimeContract.swift",
                     "Sources/OS1Context/SelfUpdate.swift"]
    guard !source.changedPaths.contains(where: { changed in
        protected.contains { changed == CPath($0) } || changed.hasPrefix(CPath("Tests/")) ||
        changed.hasPrefix(CPath("scripts/")) || changed.hasPrefix(CPath("Config/")) ||
        changed.hasPrefix(CPath("Resources/openclaw-os1-bridge/")) ||
        (changed == CPath("Sources/OS1/SelfUpdateCommands.swift") && !rccOnlyVersionLiteralChanged(root: root, before: source.sourceBeforeHead))
    }) else {
        throw RCCStagePreflightRefusal(reason: "protected_gate_changed", parentRecordSHA256: expected)
    }
    var intent = try stageSelfUpdateRelease(root: root, persistIntent: false)
    guard !ExecutionCancellation.isCancelled, gitHead(root) == source.sourceHead,
          OS1SourceWatch.fingerprint(root: root) == source.protectedSourceSHA256 else {
        throw OS1Error.message("RCC staged source changed or cancelled; intent not activated")
    }
    intent = SelfUpdate.Intent(build: intent.build, version: intent.version, sourceRoot: root, sourceCommit: source.sourceHead,
        stagedAppSHA256: intent.stagedAppSHA256, stagedCLISHA256: intent.stagedCLISHA256, stagedAt: intent.stagedAt,
        conversationID: conversation, submissionID: submission, checks: intent.checks)
    let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601; encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let body: [String: Any] = ["schema": 1, "task_id": ticket.taskID, "request_sha256": ticket.requestSHA256,
        "node_id": ticket.nodeID, "parent_attempt_id": ticket.attemptID, "source_fingerprint": ticket.sourceFingerprint,
        "source": try JSONSerialization.jsonObject(with: C.encode(source)), "parent_record_sha256": expected,
        "intent": String(decoding: try encoder.encode(intent), as: UTF8.self)]
    let bytes = try RCCCanonicalJSON.encode(body), id = sha256Hex(bytes), receiptPath = rccStagedReceiptPath(id)
    try bytes.write(to: URL(fileURLWithPath: receiptPath), options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptPath)
    guard try rccInstallationReceipt(receiptPath) == bytes else { throw OS1Error.message("RCC staged receipt readback failed") }
    intent.originalTaskID = ticket.taskID; intent.requestSHA256 = ticket.requestSHA256
    intent.stagedIntentID = id; intent.stagedReceiptSHA256 = id
    try SelfUpdate.save(intent, root: root)
    guard SelfUpdate.loadIntent(root: root)?.stagedIntentID == id else { throw OS1Error.message("RCC staged intent readback failed") }
    return C.InstallHandoff(taskID: ticket.taskID, requestSHA256: ticket.requestSHA256, nodeID: ticket.nodeID,
        parentAttemptID: ticket.attemptID, sourceFingerprint: ticket.sourceFingerprint, sourceRoot: root,
        sourceHead: source.sourceHead, protectedSourceSHA256: source.protectedSourceSHA256,
        stagedIntentID: id, stagedReceiptSHA256: id, state: .staged)
}

private func CPath(_ relative: String) -> String { "products/os1-mac-runtime/" + relative }

/// Unknown git/status is NOT clean. The generated release pointer is an
/// artifact, not an executable-source edit.
func rccSourceIsVerifiedClean(_ root: String) -> Bool {
    guard let git = try? findExecutable("git"),
          let result = try? commandOutput(git, ["--no-optional-locks", "-C", root, "status", "--porcelain=v1", "-uall",
            "--", ".", ":(exclude)" + SelfUpdate.releaseEntryRelativePath], timeout: 30),
          result.0 == 0 else { return false }
    return result.1.isEmpty
}

private func rccOnlyVersionLiteralChanged(root: String, before: String) -> Bool {
    let path = CPath("Sources/OS1/SelfUpdateCommands.swift")
    guard let git = try? findExecutable("git"), let original = try? commandOutput(git, ["-C", root, "show", before + ":" + path], timeout: 30),
          original.0 == 0, let current = try? Data(contentsOf: URL(fileURLWithPath: root).appendingPathComponent(path)),
          let old = String(data: original.1, encoding: .utf8), let new = String(data: current, encoding: .utf8) else { return false }
    let pattern = #"(?m)^let os1RuntimeVersionString = \"[^\"\n]+\"$"#
    guard let regex = try? NSRegularExpression(pattern: pattern),
          regex.numberOfMatches(in: old, range: NSRange(old.startIndex..., in: old)) == 1,
          regex.numberOfMatches(in: new, range: NSRange(new.startIndex..., in: new)) == 1 else { return false }
    return regex.stringByReplacingMatches(in: old, range: NSRange(old.startIndex..., in: old), withTemplate: "VERSION_LITERAL") ==
        regex.stringByReplacingMatches(in: new, range: NSRange(new.startIndex..., in: new), withTemplate: "VERSION_LITERAL")
}

/// Read-only receipt reconciliation (cancel writes only the matching pending
/// intent under the same lease used by apply). No submit/provider/write replay.
func rccObserveInstallation(_ data: Data, cancel: Bool) throws -> RCCRuntimeContract.InstallHandoff {
    typealias C = RCCRuntimeContract
    let wire = try rccInstallationObject(data, keys: ["schema", "task_id", "request_sha256", "install_handoff"])
    let handoff = try JSONDecoder().decode(C.InstallHandoff.self, from: RCCCanonicalJSON.encode(wire["install_handoff"]!))
    try C.validate(handoff)
    guard wire["schema"] as? Int == 1, wire["task_id"] as? String == handoff.taskID,
          wire["request_sha256"] as? String == handoff.requestSHA256 else { throw OS1Error.message("RCC install task binding rejected") }
    let bytes = try rccInstallationReceipt(rccStagedReceiptPath(handoff.stagedIntentID))
    guard sha256Hex(bytes) == handoff.stagedReceiptSHA256,
          let body = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
          body["task_id"] as? String == handoff.taskID, body["request_sha256"] as? String == handoff.requestSHA256,
          body["node_id"] as? String == handoff.nodeID, body["parent_attempt_id"] as? String == handoff.parentAttemptID,
          body["source_fingerprint"] as? String == handoff.sourceFingerprint,
          let sourceObject = body["source"] as? [String: Any], sourceObject["source_root"] as? String == handoff.sourceRoot,
          sourceObject["source_head"] as? String == handoff.sourceHead,
          sourceObject["protected_source_sha256"] as? String == handoff.protectedSourceSHA256,
          let intentText = body["intent"] as? String else { throw OS1Error.message("RCC staged receipt semantic binding rejected") }
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
    let staged = try decoder.decode(SelfUpdate.Intent.self, from: Data(intentText.utf8))
    func matches(_ intent: SelfUpdate.Intent) -> Bool {
        intent.originalTaskID == handoff.taskID && intent.requestSHA256 == handoff.requestSHA256 &&
        intent.stagedIntentID == handoff.stagedIntentID && intent.stagedReceiptSHA256 == handoff.stagedReceiptSHA256 &&
        intent.sourceRoot == handoff.sourceRoot && intent.sourceCommit == handoff.sourceHead && intent.build == staged.build &&
        intent.stagedAppSHA256 == staged.stagedAppSHA256 && intent.stagedCLISHA256 == staged.stagedCLISHA256
    }
    var result = handoff
    if let outcome = SelfUpdate.outcomes().last(where: { matches($0.intent) }) {
        if outcome.success, let path = outcome.receiptPath,
           path.hasPrefix(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/recovery/").path),
           let receipt = try? JSONSerialization.jsonObject(with: rccPrivateInput(path)) as? [String: Any],
           receipt["build"] as? Int == staged.build, receipt["error"] == nil,
           receipt["completedAt"] as? String != nil,
           receipt["stagedAppHash"] as? String == staged.stagedAppSHA256,
           receipt["stagedCLIHash"] as? String == staged.stagedCLISHA256,
           let checks = receipt["checks"] as? [String], !checks.isEmpty, checks.allSatisfy({ $0.contains("PASS") }) {
            result.state = .installed; result.installedReceipt = path; return result
        }
        result.state = outcome.intent.state == "cancelled" ? .cancelled : outcome.success ? .effectsUncertain : .failed
        result.installedReceipt = nil; return result
    }
    guard var current = SelfUpdate.loadIntent(root: handoff.sourceRoot), matches(current) else {
        result.state = .effectsUncertain; result.installedReceipt = nil; return result
    }
    if current.state == "cancelled" { result.state = .cancelled; return result }
    if cancel {
        guard let lease = try SelfUpdate.IntentLease.tryAcquire(root: handoff.sourceRoot) else {
            result.state = .staged; return result // apply owns it; keep observing, not falsely cancelled
        }
        defer { withExtendedLifetime(lease) {} }
        guard let reloaded = SelfUpdate.loadIntent(root: handoff.sourceRoot), reloaded == current,
              current.state == "pending" else { result.state = .staged; return result }
        current.state = "cancelled"; try SelfUpdate.save(current, root: handoff.sourceRoot)
        guard SelfUpdate.loadIntent(root: handoff.sourceRoot)?.state == "cancelled" else {
            result.state = .effectsUncertain; return result
        }
        result.state = .cancelled
    } else { result.state = .staged }
    result.installedReceipt = nil; return result
}
