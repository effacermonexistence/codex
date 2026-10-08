import Foundation
import CryptoKit
import OS1Context

/// The existing execution flow consumes an owner-custodied task checker, not
/// a second benchmark service or a model-authored 'tests passed' assertion.
/// A missing contract is an explicit unresolved quality state.
struct PreparedTaskQuality {
    struct Envelope: Codable {
        let contract: TaskQualityEvidence.Contract
        let checkerSHA256: String
        let timeoutSeconds: Int
        /// Exact owner-declared candidate paths; an empty list is output-only.
        let workspacePaths: [String]
    }
    let envelope: Envelope
    let checkerBytes: Data
    let referencePolicySHA256: String

    static var root: URL {
        SourceContextStore().root.appendingPathComponent("source-snapshots/task-quality", isDirectory: true)
    }
    static func prepare(objective: String, contextSHA256: String, sourceSHA256: String?,
                        startTreeSHA256: String, scope: TaskContext.Scope,
                        referencePolicySHA256: String, rootURL: URL = Self.root) throws -> PreparedTaskQuality? {
        let objectiveSHA = TaskQualityEvidence.digest(Data(objective.utf8))
        let path = rootURL.appendingPathComponent("contracts", isDirectory: true).appendingPathComponent(objectiveSHA + ".json")
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        let attrs = try FileManager.default.attributesOfItem(atPath: path.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular,
              (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 128_000 else { throw OS1Error.message("Task-quality contract is not a bounded regular file") }
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
        let envelope = try decoder.decode(Envelope.self, from: Data(contentsOf: path))
        let c = envelope.contract
        guard c.objectiveSHA256 == objectiveSHA, c.contextSHA256 == contextSHA256,
              c.sourceSHA256 == sourceSHA256, c.startTreeSHA256 == startTreeSHA256, c.scope == scope,
              c.referencePolicySHA256 == referencePolicySHA256,
              envelope.checkerSHA256 == c.verifierCodeSHA256, (1...300).contains(envelope.timeoutSeconds),
              envelope.checkerSHA256.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
            throw OS1Error.message("Task-quality contract does not match this exact request/source/reference scope")
        }
        let checker = rootURL.appendingPathComponent("checkers", isDirectory: true).appendingPathComponent(envelope.checkerSHA256 + ".py")
        let checkerAttrs = try FileManager.default.attributesOfItem(atPath: checker.path)
        guard checkerAttrs[.type] as? FileAttributeType == .typeRegular,
              (checkerAttrs[.size] as? NSNumber)?.intValue ?? Int.max <= 256_000 else { throw OS1Error.message("Task-quality checker is not a bounded regular file") }
        let bytes = try Data(contentsOf: checker)
        guard TaskQualityEvidence.digest(bytes) == envelope.checkerSHA256 else { throw OS1Error.message("Frozen task-quality checker identity mismatch") }
        return Self(envelope: envelope, checkerBytes: bytes, referencePolicySHA256: referencePolicySHA256)
    }

    func evaluate(artifact: Artifact, artifactSHA256: String, contextSHA256: String,
                  workspace: String, executionID: String, runsRoot: URL = Self.root) throws -> TaskQualityEvidence.Evaluation {
        let c = envelope.contract
        if !envelope.workspacePaths.isEmpty, observedStateHash(workspace) != artifact.workspaceAfterHash {
            throw OS1Error.message("Task-quality candidate changed after the execution artifact was captured")
        }
        let binding = TaskQualityEvidence.Binding(objectiveSHA256: c.objectiveSHA256, contextSHA256: contextSHA256,
            sourceSHA256: c.sourceSHA256, startTreeSHA256: artifact.workspaceBeforeHash, scope: c.scope,
            executionID: executionID, turnID: artifact.nativeRecord.turnID ?? "unverified",
            outputSHA256: TaskQualityEvidence.digest(Data(artifact.output.utf8)),
            workspaceAfterSHA256: artifact.workspaceAfterHash, artifactSHA256: artifactSHA256)
        let observed = TaskQualityEvidence.ObservedArtifact(binding: binding,
            executionVerified: artifact.exitCode == 0 && artifact.nativeRecord.isVerified)
        let runRoot = runsRoot.appendingPathComponent("runs", isDirectory: true).appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: runRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let checker = runRoot.appendingPathComponent("checker.py")
        try checkerBytes.write(to: checker, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: checker.path)
        // Input and code are frozen before invocation. This checker protocol
        // emits check observations only; it cannot assert its own parity state.
        let input = runRoot.appendingPathComponent("input.json")
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; encoder.dateEncodingStrategy = .millisecondsSince1970
        let candidate = try frozenCandidate(workspace: workspace, paths: envelope.workspacePaths, into: runRoot)
        let payload = TaskQualityCheckerInput(contract: c, binding: binding, workspace: candidate.path,
                                              output: artifact.output)
        try encoder.encode(payload).write(to: input, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: input.path)
        let result = try commandOutput("/usr/bin/python3", [checker.path, input.path],
            timeout: envelope.timeoutSeconds, currentDirectory: runRoot.path,
            environmentOverrides: ["HOME": runRoot.path, "TMPDIR": runRoot.path, "PYTHONNOUSERSITE": "1", "PATH": "/usr/bin:/bin"],
            removingEnvironment: Set(ProcessInfo.processInfo.environment.keys.filter {
                let key = $0.uppercased()
                return key.contains("TOKEN") || key.contains("KEY") || key.contains("SECRET") || key.contains("AUTH") || key.contains("PASSWORD")
            }))
        try result.1.write(to: runRoot.appendingPathComponent("stdout.json"), options: .atomic)
        try result.2.write(to: runRoot.appendingPathComponent("stderr.txt"), options: .atomic)
        if !envelope.workspacePaths.isEmpty, observedStateHash(workspace) != artifact.workspaceAfterHash {
            throw OS1Error.message("Task-quality live candidate changed during the copied-artifact check")
        }
        let receiptSHA = TaskQualityEvidence.digest(result.1)
        let rawChecks = result.0 == 0 && result.1.count <= 128_000
            ? try? JSONDecoder().decode([TaskQualityEvidence.Check].self, from: result.1) : nil
        let checks = rawChecks?.map { TaskQualityEvidence.Check(checkID: $0.checkID, status: $0.status,
            score: $0.score, observedReceiptSHA256: receiptSHA) }
        let receipt = checks.map { TaskQualityEvidence.Receipt(basis: .observedCheckerReceipt,
            contractSHA256: c.sha256, binding: binding, checkerIdentitySHA256: TaskQualityEvidence.digest(checkerBytes),
            observedReceiptSHA256: TaskQualityEvidence.digest(result.1), checks: $0, observedAt: Date()) }
        let assessment = TaskQualityEvidence.evaluate(contract: c, receipt: receipt, artifact: observed,
            currentReferencePolicySHA256: referencePolicySHA256, now: Date())
        try encoder.encode(assessment).write(to: runRoot.appendingPathComponent("assessment.json"), options: .atomic)
        for name in ["stdout.json", "stderr.txt", "assessment.json"] {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: runRoot.appendingPathComponent(name).path)
        }
        return assessment
    }
}

private struct TaskQualityCheckerInput: Codable {
    let contract: TaskQualityEvidence.Contract
    let binding: TaskQualityEvidence.Binding
    let workspace: String
    let output: String
}

func unresolvedTaskQuality(artifactSHA256: String) -> TaskQualityEvidence.Evaluation {
    .init(state: .executionOnly, reason: "No exact pre-dispatch task/reference checker is registered; native execution is not quality parity",
          contractSHA256: "", artifactSHA256: artifactSHA256, requiredCheckIDs: [], failedCheckIDs: [])
}

/// Checkers receive a bounded disposable artifact copy, never the live worktree
/// or HOME. The pre-dispatch contract declares exactly which files are involved.
private func frozenCandidate(workspace: String, paths: [String], into runRoot: URL) throws -> URL {
    let fm = FileManager.default
    let original = URL(fileURLWithPath: workspace).resolvingSymlinksInPath().standardizedFileURL
    let home = fm.homeDirectoryForCurrentUser.resolvingSymlinksInPath().standardizedFileURL
    guard paths.count <= 128, paths.isEmpty || original != home else {
        throw OS1Error.message("Task-quality artifact scope is not a bounded project; live HOME was not copied")
    }
    let copy = runRoot.appendingPathComponent("candidate", isDirectory: true)
    try fm.createDirectory(at: copy, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var count = 0, bytes = 0
    func copyFile(_ source: URL, relative: String) throws {
        let attrs = try fm.attributesOfItem(atPath: source.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular else { throw OS1Error.message("Task-quality scope contains a symlink or special file") }
        let size = (attrs[.size] as? NSNumber)?.intValue ?? Int.max
        guard size >= 0, size <= 64_000_000, bytes <= 64_000_000 - size else { throw OS1Error.message("Task-quality candidate exceeds the declared bounded artifact budget") }
        count += 1; bytes += size
        guard count <= 3_000 else { throw OS1Error.message("Task-quality candidate exceeds the declared bounded artifact budget") }
        let target = copy.appendingPathComponent(relative)
        try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try fm.copyItem(at: source, to: target)
    }
    for path in paths {
        let pieces = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.hasPrefix("/"), !pieces.isEmpty, !pieces.contains(".."), !pieces.contains(""),
              !pieces.contains(where: { [".git", ".codex", ".claude", ".os1", "node_modules"].contains(String($0)) }) else {
            throw OS1Error.message("Task-quality scope is not an exact relative artifact path")
        }
        let source = original.appendingPathComponent(path).standardizedFileURL
        guard source.resolvingSymlinksInPath().path.hasPrefix(original.path + "/") else { throw OS1Error.message("Task-quality scope escapes the project") }
        let attrs = try fm.attributesOfItem(atPath: source.path)
        if attrs[.type] as? FileAttributeType == .typeDirectory {
            guard let enumerator = fm.enumerator(at: source, includingPropertiesForKeys: nil) else { throw OS1Error.message("Task-quality artifact could not be enumerated") }
            for case let entry as URL in enumerator {
                let attrs = try fm.attributesOfItem(atPath: entry.path)
                if attrs[.type] as? FileAttributeType == .typeDirectory { continue }
                try copyFile(entry, relative: String(entry.path.dropFirst(original.path.count + 1)))
            }
        } else { try copyFile(source, relative: path) }
    }
    return copy
}

func taskQualityReferencePolicySHA256(config: RuntimeConfig) -> String {
    // Declared reference identities, not a name-based claim of automatic future
    // frontier discovery. Any model/effort/instruction-contract change expires
    // matching prior evidence. No comparison is synthesized from this declaration.
    let fields = ["os1-task-quality-reference-v1", "codex:gpt-6-astra:ultra", "claude:claude-opus-5-5:max",
                  config.executorContract.sha256, OwnerPolicyContext.snapshot?.sourceSHA256 ?? "no-owner-policy",
                  OwnerPolicyContext.snapshot?.projectionSHA256 ?? "no-owner-projection"]
    return TaskQualityEvidence.digest(Data(fields.joined(separator: "\n").utf8))
}

/// Existing os1 self-test coverage. Local deterministic fixtures only: no model,
/// network, live registry, account credential or user worktree is involved.
func taskQualityRuntimeSelfTest() throws {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("os1-quality-fixture-" + UUID().uuidString, isDirectory: true)
    try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: root) }
    let workspace = root.appendingPathComponent("project", isDirectory: true)
    try fm.createDirectory(at: workspace, withIntermediateDirectories: true)
    let file = workspace.appendingPathComponent("answer.txt")
    try Data("2".utf8).write(to: file)
    let checker = Data("""
    import json,sys,pathlib
    x=json.load(open(sys.argv[1]))
    w=pathlib.Path(x['workspace'])
    ok=(w/'answer.txt').read_text() == '2'
    (w/'checker-only-marker').write_text('isolated')
    print(json.dumps([{'checkID':'exact.answer','status':'passed' if ok else 'failed','score':1 if ok else 0}]))
    """.utf8)
    let h = TaskQualityEvidence.digest(Data("fixture-context".utf8)), objective = "Fixture: exact answer file contains 2"
    let tree = observedStateHash(workspace.path), checkerSHA = TaskQualityEvidence.digest(checker)
    let c = TaskQualityEvidence.Contract(basis: .declaredTrustedContract,
        objectiveSHA256: TaskQualityEvidence.digest(Data(objective.utf8)), contextSHA256: h, sourceSHA256: nil,
        startTreeSHA256: tree, scope: .workspaceWrite, verifierCodeSHA256: checkerSHA,
        referencePolicySHA256: h, requiredCheckIDs: ["exact.answer"], fullCoverage: true,
        referenceProfiles: [], reference: nil, issuedAt: Date().addingTimeInterval(-10), validUntil: Date().addingTimeInterval(60))
    let contractDir = root.appendingPathComponent("contracts"), checkerDir = root.appendingPathComponent("checkers")
    try fm.createDirectory(at: contractDir, withIntermediateDirectories: true)
    try fm.createDirectory(at: checkerDir, withIntermediateDirectories: true)
    let envelope = PreparedTaskQuality.Envelope(contract: c, checkerSHA256: checkerSHA, timeoutSeconds: 10, workspacePaths: ["answer.txt"])
    let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .millisecondsSince1970
    try encoder.encode(envelope).write(to: contractDir.appendingPathComponent(c.objectiveSHA256 + ".json"))
    try checker.write(to: checkerDir.appendingPathComponent(checkerSHA + ".py"))
    guard let prepared = try PreparedTaskQuality.prepare(objective: objective, contextSHA256: h, sourceSHA256: nil,
        startTreeSHA256: tree, scope: .workspaceWrite, referencePolicySHA256: h, rootURL: root) else {
        throw OS1Error.message("Task-quality fixture contract was not acquired")
    }
    func candidateArtifact() -> Artifact { Artifact(provider: "codex", action: "fixture", permissionProfile: "workspace_write", model: "fixture",
        effort: "low", executorContractVersion: "fixture", executorContractSHA256: h,
        exitCode: 0, output: "Model prose is not the check", stderr: "", durationMS: 1,
        workspaceBeforeHash: tree, workspaceAfterHash: observedStateHash(workspace.path),
        nativeRecord: NativeRecordEvidence(turnID: UUID().uuidString, recordPath: nil, persistence: "verified", desktopVisibility: "fixture")) }
    let artifact = candidateArtifact()
    let artifactSHA = TaskQualityEvidence.digest(try encoder.encode(artifact))
    let good = try prepared.evaluate(artifact: artifact, artifactSHA256: artifactSHA, contextSHA256: h,
        workspace: workspace.path, executionID: UUID().uuidString, runsRoot: root)
    guard good.state == .taskContractVerified, !good.referenceParityVerified,
          try Data(contentsOf: file) == Data("2".utf8), !fm.fileExists(atPath: workspace.appendingPathComponent("checker-only-marker").path) else {
        throw OS1Error.message("Task-quality checker did not verify the exact copied artifact or mutated original")
    }
    try Data("wrong".utf8).write(to: file)
    let failedArtifact = candidateArtifact()
    let bad = try prepared.evaluate(artifact: failedArtifact, artifactSHA256: TaskQualityEvidence.digest(try encoder.encode(failedArtifact)), contextSHA256: h,
        workspace: workspace.path, executionID: UUID().uuidString, runsRoot: root)
    guard bad.state == .mismatch, bad.preservesArtifact else { throw OS1Error.message("Task-quality mismatch was not preserved/rejected") }
    let step = RunStepSummary(sequence: 1, provider: "codex", action: "fixture", model: "fixture", effort: "low",
        revasDisposition: "verification_pending", sessionID: "fixture", permissionProfile: "workspace_write", exitCode: 0,
        output: artifact.output, stderr: "", durationMS: 1, nativeRecord: artifact.nativeRecord, taskQuality: good)
    let restored = try JSONDecoder().decode(RunStepSummary.self, from: JSONEncoder().encode(step))
    guard restored.taskQuality == good else { throw OS1Error.message("Quality state lost in actual run summary") }
    let legacy = try JSONSerialization.jsonObject(with: JSONEncoder().encode(step)) as! [String: Any]
    var old = legacy; old.removeValue(forKey: "task_quality")
    guard try JSONDecoder().decode(RunStepSummary.self, from: JSONSerialization.data(withJSONObject: old)).taskQuality == nil else {
        throw OS1Error.message("Legacy run summary acquired unsupported quality state")
    }
    print("OS-1 task-quality runtime: copied-artifact pass/fail, raw preservation, no fabricated parity, current/legacy summary roundtrip PASS; model calls 0")
}
