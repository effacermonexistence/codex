import Darwin
import Foundation
import OS1Context

/// Injected metadata readers and isolated timing directories only. No live
/// account, native CLI, model, credential, or HOME store is inspected.
func runRCCNativePreparationFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) throws {
        guard value else { throw NSError(domain: "RCCNativePreparationFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: label]) }
        checks += 1
    }
    func rejects(_ label: String, _ operation: () throws -> Void) throws {
        do { try operation() } catch { checks += 1; return }
        throw NSError(domain: "RCCNativePreparationFixture", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "not rejected: " + label])
    }
    enum ProbeFailure: Error { case selectedReaderFailed }
    var codexReads = 0, claudeReads = 0, claudeQuotaReads = 0
    let codex = try RCCNativePreparation.collect(provider: "codex", codex: {
        codexReads += 1; return "fresh-codex-catalog-and-quota"
    }, claude: {
        claudeReads += 1; claudeQuotaReads += 1
        return (models: "fresh-claude-catalog", quota: "fresh-claude-quota")
    })
    try check(codexReads == 1 && claudeReads == 0 && claudeQuotaReads == 0,
              "selected Codex never probes unrelated Claude inventory or quota")
    try check(codex.codex == "fresh-codex-catalog-and-quota" && codex.claude == nil,
              "selected Codex observation retained unchanged; unselected provider remains absent")
    codexReads = 0; claudeReads = 0; claudeQuotaReads = 0
    let claude = try RCCNativePreparation.collect(provider: "claude", codex: {
        codexReads += 1; return "fresh-codex-catalog-and-quota"
    }, claude: {
        claudeReads += 1; claudeQuotaReads += 1
        return (models: "fresh-claude-catalog", quota: "fresh-claude-quota")
    })
    try check(codexReads == 0 && claudeReads == 1 && claudeQuotaReads == 1,
              "selected Claude never probes unrelated Codex inventory or quota")
    try check(claude.codex == nil && claude.claude?.models == "fresh-claude-catalog" &&
              claude.claude?.quota == "fresh-claude-quota", "selected Claude observations retained unchanged")
    for provider in ["auto", "local", "chatgpt", "", "Codex"] {
        var reads = 0
        try rejects("unknown provider has no metadata authority: " + provider) {
            _ = try RCCNativePreparation.collect(provider: provider,
                codex: { reads += 1; return 1 }, claude: { reads += 1; return 2 })
        }
        try check(reads == 0, "invalid provider dispatches no metadata reader")
    }
    for selected in ["codex", "claude"] {
        var otherReads = 0
        do {
            _ = try RCCNativePreparation.collect(provider: selected, codex: { () throws -> Int in
                if selected == "codex" { throw ProbeFailure.selectedReaderFailed }
                otherReads += 1; return 1
            }, claude: { () throws -> Int in
                if selected == "claude" { throw ProbeFailure.selectedReaderFailed }
                otherReads += 1; return 2
            })
            throw NSError(domain: "RCCNativePreparationFixture", code: 3)
        } catch ProbeFailure.selectedReaderFailed {
            try check(otherReads == 0, "selected provider failure is preserved, never substituted")
        }
    }

    let base = FileManager.default.temporaryDirectory.appendingPathComponent("os1-native-preparation-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true,
                                            attributes: [.posixPermissions: 0o700])
    let root = base.resolvingSymlinksInPath().standardizedFileURL
    defer { try? FileManager.default.removeItem(at: root) }
    let taskID = UUID().uuidString.lowercased(), configuration = String(repeating: "a", count: 64)
    func timing(attempt: String = UUID().uuidString.lowercased(), node: String = "worker_1") throws -> RCCNativePreparationTiming {
        try RCCNativePreparationTiming(taskID: taskID, nodeID: node, attemptID: attempt,
            configurationSHA256: configuration, sourceFingerprint: String(repeating: "b", count: 64), provider: "codex")
    }
    func privateDirectory(_ name: String) throws -> URL {
        let target = root.appendingPathComponent(name)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        return target
    }
    let valid = try timing()
    for phase in [RCCNativePreparationTiming.Phase.inventoryStarted, .inventoryReady, .authorizationStarted,
                  .authorizationReady, .workspaceHashStarted, .workspaceHashReady, .executeStarted,
                  .executeReturned, .receiptPersistStarted, .receiptPersisted] { valid.mark(phase) }
    let file = try valid.persist(root: root, receiptPersisted: true, executionStatus: "succeeded", executionVerified: true)
    let data = try Data(contentsOf: file), json = try JSONSerialization.jsonObject(with: data) as! [String: Any]
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
    let record = try decoder.decode(RCCNativePreparationTiming.Record.self, from: data)
    try check(record.taskID == taskID && record.nodeID == "worker_1" && record.configurationSHA256 == configuration &&
              record.sourceFingerprint == String(repeating: "b", count: 64) && record.provider == "codex",
              "timing record has exact task/node/attempt/config/source/provider binding")
    try check(Set(json.keys) == ["schema", "task_id", "node_id", "attempt_id", "configuration_sha256", "source_fingerprint",
        "provider", "started_at", "receipt_persisted", "execution_status", "execution_verified", "marks"],
        "timing record contains no prompt, output, auth value, or arbitrary field")
    try check(record.receiptPersisted && record.executionStatus == "succeeded" && record.executionVerified &&
              record.marks.count == 11 && zip(record.marks, record.marks.dropFirst()).allSatisfy { $0.elapsedMS <= $1.elapsedMS },
              "phases are bounded monotonic diagnostics, separate from execution authority")
    let fileMode = (try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as! NSNumber).intValue
    let directoryMode = (try FileManager.default.attributesOfItem(atPath: file.deletingLastPathComponent().path)[.posixPermissions] as! NSNumber).intValue
    try check(fileMode == 0o600 && directoryMode == 0o700, "private timing file and directory modes")
    try rejects("duplicate attempt cannot overwrite earlier timing") {
        _ = try valid.persist(root: root, receiptPersisted: false, executionStatus: "failed", executionVerified: false)
    }
    try check(try Data(contentsOf: file) == data, "duplicate write preserves original bytes")
    let failed = try timing()
    failed.mark(.inventoryStarted); failed.mark(.attemptFailed); failed.mark(.receiptPersistStarted)
    let failedFile = try failed.persist(root: root, receiptPersisted: false, executionStatus: "failed", executionVerified: false)
    let failedRecord = try decoder.decode(RCCNativePreparationTiming.Record.self, from: Data(contentsOf: failedFile))
    try check(!failedRecord.receiptPersisted && failedRecord.executionStatus == "failed" && !failedRecord.executionVerified &&
              failedRecord.marks.contains { $0.phase == .attemptFailed }, "failed native preparation remains failed in timings")
    let uncertainFile = try timing().persist(root: root, receiptPersisted: true,
        executionStatus: "effects_uncertain", executionVerified: false)
    let uncertainRecord = try decoder.decode(RCCNativePreparationTiming.Record.self, from: Data(contentsOf: uncertainFile))
    try check(uncertainRecord.executionStatus == "effects_uncertain" && !uncertainRecord.executionVerified,
              "uncertain native outcome stays uncertain, not invented failure or success")
    let bounded = try timing()
    for _ in 0..<100 { bounded.mark(.inventoryStarted) }
    let boundedFile = try bounded.persist(root: root, receiptPersisted: false, executionStatus: "failed", executionVerified: false)
    try check(try decoder.decode(RCCNativePreparationTiming.Record.self, from: Data(contentsOf: boundedFile)).marks.count == 32,
              "diagnostic mark count cannot grow unbounded")
    try rejects("invalid node path rejected before timing file creation") { _ = try timing(node: "../secret") }
    try rejects("invalid status cannot become arbitrary diagnostic text") {
        _ = try timing().persist(root: root, receiptPersisted: false, executionStatus: "arbitrary-secret", executionVerified: false)
    }
    let openRoot = try privateDirectory("world-readable")
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: openRoot.path)
    try rejects("world-readable root rejected rather than silently fixed") {
        _ = try timing().persist(root: openRoot, receiptPersisted: false, executionStatus: "failed", executionVerified: false)
    }
    let alias = root.appendingPathComponent("alias")
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: root)
    try rejects("root alias rejected") {
        _ = try timing().persist(root: alias, receiptPersisted: false, executionStatus: "failed", executionVerified: false)
    }
    let diverted = try privateDirectory("diverted"), other = try privateDirectory("other")
    try FileManager.default.createSymbolicLink(at: diverted.appendingPathComponent("native-timings"), withDestinationURL: other)
    try rejects("timing directory alias rejected") {
        _ = try timing().persist(root: diverted, receiptPersisted: false, executionStatus: "failed", executionVerified: false)
    }
    try check(try FileManager.default.contentsOfDirectory(atPath: other.path).isEmpty, "no write through directory alias")
    let occupiedAttempt = UUID().uuidString.lowercased(), occupied = root.appendingPathComponent("native-timings/" + occupiedAttempt + ".json")
    try FileManager.default.createSymbolicLink(at: occupied, withDestinationURL: file)
    try rejects("existing attempt-file alias rejected") {
        _ = try timing(attempt: occupiedAttempt).persist(root: root, receiptPersisted: true,
            executionStatus: "succeeded", executionVerified: true)
    }
    try check(try Data(contentsOf: file) == data, "file alias target remains unchanged")
    print("RCC selected native preparation/timing: \(checks) checks PASS; native/provider/model calls 0")
}
