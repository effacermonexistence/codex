import Foundation
import Darwin
import OS1Context
import OS1HookSupport

/// One bounded speculative workspace transaction. Core remains the only retry
/// owner. Native code sees candidate + native scratch, never original/custody.
/// This first capability deliberately excludes Git, links, HOME and sources.
enum RCCStagedWriterTransaction {
    typealias C = RCCRuntimeContract
    typealias Manifest = RCCOperationalQuality.ContentManifest
    enum Failure: Error { case ineligible, changed, unsettled, scope, swap, rollback, receipt }
    struct Binding { let envelopeSHA256: String; let baseSHA256: String }
    static var receiptRoot: URL { RCCOperationalQuality.root.deletingLastPathComponent().appendingPathComponent("staged-writer-receipts") }

    static func eligible(_ p: PreparedTaskQuality, workspace: String, envelopeSHA256: String, now: Date = Date()) throws -> Manifest {
        let c = p.envelope.contract
        guard c.schema == 1, c.scope == .workspaceWrite, c.fullCoverage, p.envelope.localEffectsOnly,
            p.frozenRegressionSnapshot == nil, p.envelope.publicRegressionSnapshot == nil,
            !p.envelope.workspacePaths.isEmpty, p.envelope.workspacePaths.count <= 128,
            p.envelope.workspacePaths.allSatisfy(relativePath), !c.requiredCheckIDs.isEmpty,
            c.verifierCodeSHA256 == C.digest(p.checkerBytes), c.issuedAt <= now, now < c.validUntil,
            C.isHash(envelopeSHA256), c.startTreeSHA256 == workspaceHash(workspace),
            OS1SourceWatch.containedRoot(workspace: workspace) == nil,
            LocalProjectWorkspace.root(containing: workspace, projectID: "os1-clodex") == nil else { throw Failure.ineligible }
        let root = URL(fileURLWithPath: workspace).standardizedFileURL
        guard root.path == workspace, root.resolvingSymlinksInPath() == root,
            root.path != FileManager.default.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path,
            root.path != "/", !root.path.lowercased().contains("handy") else { throw Failure.ineligible }
        try ownedDirectory(root); try ownedDirectory(root.deletingLastPathComponent())
        var ancestor = root
        while ancestor.path != "/" {
            var git = stat()
            if lstat(ancestor.appendingPathComponent(".git").path, &git) == 0 { throw Failure.ineligible }
            ancestor = ancestor.deletingLastPathComponent()
        }
        let manifest = try Manifest.capture(workspace: workspace)
        guard p.envelope.stagedWriterBaseSHA256.map(C.isHash) == true,
            p.envelope.stagedWriterBaseSHA256 == manifest.sha256 else { throw Failure.changed }
        try ownedEntries(manifest, root: root)
        return manifest
    }
    private static func ownedEntries(_ manifest: Manifest, root: URL) throws {
        for e in manifest.entries {
            guard e.path.isEmpty || relativePath(e.path) else { throw Failure.scope }
            let path = root.appendingPathComponent(e.path)
            var s = stat()
            guard lstat(path.path, &s) == 0, s.st_uid == getuid(), s.st_mode & 0o022 == 0,
                (e.kind == "directory" && s.st_mode & S_IFMT == S_IFDIR) ||
                (e.kind == "file" && s.st_mode & S_IFMT == S_IFREG && s.st_nlink == 1) else { throw Failure.ineligible }
        }
    }
    static func catalogBinding(prepared: PreparedTaskQuality, workspace: String,
        boundary: RCCOperationalQuality.LocalEffectsBoundary, now: Date = Date()) throws -> Binding {
        let m = try eligible(prepared, workspace: workspace, envelopeSHA256: boundary.envelopeSHA256, now: now)
        return .init(envelopeSHA256: boundary.envelopeSHA256, baseSHA256: m.sha256)
    }
    private static func relativePath(_ path: String) -> Bool {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        return !path.hasPrefix("/") && !path.contains("\\") && !parts.isEmpty && parts.allSatisfy {
            !$0.isEmpty && $0 != "." && $0 != ".." &&
            ![".git", ".os1", ".codex", ".claude", ".ssh", ".gnupg", "keychains"].contains($0.lowercased()) &&
            !$0.lowercased().hasPrefix(".env")
        }
    }
    private static func ownedDirectory(_ path: URL) throws {
        var s = stat()
        guard path.standardizedFileURL == path.resolvingSymlinksInPath(), lstat(path.path, &s) == 0,
            s.st_mode & S_IFMT == S_IFDIR, s.st_uid == getuid(), s.st_mode & 0o022 == 0 else { throw Failure.ineligible }
    }
    private static func write(_ bytes: Data, to path: URL) throws {
        let fd = open(path.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw Failure.receipt }
        defer { close(fd) }
        try bytes.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = Darwin.write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                guard n > 0 else { throw Failure.receipt }; offset += n
            }
        }
        guard fsync(fd) == 0 else { throw Failure.receipt }
    }
    private static func privateDirectory(_ path: URL) throws {
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try ownedDirectory(path)
        var s = stat(); guard lstat(path.path, &s) == 0, s.st_mode & 0o077 == 0 else { throw Failure.receipt }
    }
    private static func copy(_ manifest: Manifest, from source: URL, to target: URL) throws {
        let fm = FileManager.default
        for e in manifest.entries {
            let dest = e.path.isEmpty ? target : target.appendingPathComponent(e.path)
            if e.kind == "directory" {
                try fm.createDirectory(at: dest, withIntermediateDirectories: false, attributes: [.posixPermissions: Int(e.mode)])
            } else {
                let origin = source.appendingPathComponent(e.path)
                let fd = open(origin.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
                guard fd >= 0 else { throw Failure.changed }; defer { close(fd) }
                var s = stat(); guard fstat(fd, &s) == 0, s.st_mode & S_IFMT == S_IFREG,
                    s.st_uid == getuid(), s.st_nlink == 1, s.st_size == e.bytes else { throw Failure.changed }
                let data = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).readToEnd() ?? Data()
                guard data.count == e.bytes, C.digest(data) == e.sha256 else { throw Failure.changed }
                try data.write(to: dest, options: .withoutOverwriting)
                try fm.setAttributes([.posixPermissions: Int(e.mode)], ofItemAtPath: dest.path)
            }
        }
        guard try Manifest.capture(workspace: target.path) == manifest,
            try Manifest.capture(workspace: source.path) == manifest else { throw Failure.changed }
    }
    private static func swap(_ a: URL, _ b: URL) throws {
        guard renameatx_np(AT_FDCWD, a.path, AT_FDCWD, b.path, UInt32(RENAME_SWAP)) == 0 else { throw Failure.swap }
    }
    static func prepare(ticket t: C.ExecutionTicket, preparation p: RCCOperationalQuality.Preparation?,
        boundary: RCCOperationalQuality.LocalEffectsBoundary?, root: URL = receiptRoot,
        leaseHome: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> Transaction? {
        if t.stagedWriterEnvelopeSHA256 == nil && t.stagedWriterBaseSHA256 == nil { return nil }
        guard let envelope = t.stagedWriterEnvelopeSHA256, let base = t.stagedWriterBaseSHA256,
            let h = t.hostContext, let p, let boundary, boundary.envelopeSHA256 == envelope,
            t.executionIsolation == "codex_fresh_local_effects_v1", t.executionIsolationSHA256 == envelope,
            t.selectedConfig.surface == .codex, t.selectedConfig.transport == .codexAppServer,
            t.selectedConfig.scope == .workspaceWrite, !h.requireReadOnly, h.codexSessionID == nil,
            t.nativeResumeSessionID == nil, t.continuation == nil, t.qualityContinuation == nil,
            h.explicitRoutes == nil, t.originalRequest == t.instruction,
            p.prepared.envelope.contract.objectiveSHA256 == t.requestSHA256 else { throw Failure.ineligible }
        let lock = try ParallelProjectWorkspace.originalProjectLeaseURL(root: h.workspace, home: leaseHome)
        let lease = try ExclusiveHookLease.acquireWaiting(at: lock, beforeAttempt: {
            if Task.isCancelled || ExecutionCancellation.isCancelled { throw Failure.unsettled }
        })
        let manifest = try eligible(p.prepared, workspace: h.workspace, envelopeSHA256: envelope)
        guard manifest.sha256 == base else { throw Failure.changed }
        try privateDirectory(root)
        let original = URL(fileURLWithPath: h.workspace)
        let custody = original.deletingLastPathComponent().appendingPathComponent(".os1-staged-writer-" + UUID().uuidString.lowercased())
        try FileManager.default.createDirectory(at: custody, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        let stage = custody.appendingPathComponent("candidate")
        try copy(manifest, from: original, to: stage)
        let tx = Transaction(ticket: t, original: original, stage: stage, custody: custody,
            before: manifest, originalPreparation: p, root: root, lease: lease)
        try tx.persistPhase("prepared")
        return tx
    }

    final class Transaction {
        let ticket: C.ExecutionTicket
        let original: URL
        let stage: URL
        let custody: URL
        let before: Manifest
        private(set) var originalPreparation: RCCOperationalQuality.Preparation
        let root: URL
        private let lease: ExclusiveHookLease
        private(set) var swapped = false
        private var final: C.StagedWriter?
        private var stageAfter: Manifest?
        private var stageArtifactSHA: String?
        private var mappedArtifactSHA: String?
        private var stagedCheckContractSHA: String?
        private var stagedCheckReceiptSHA: String?
        private var stagedChecksPassed = false
        private var nativeIsolationVerified = false
        private var nativeProfileSHA256: String?
        private var nativeEnded = false
        func observeNative(terminated: Bool, localOnlyVerified: Bool, profileSHA256: String?) {
            nativeEnded = terminated
            nativeIsolationVerified = terminated && localOnlyVerified && profileSHA256.map(C.isHash) == true
            nativeProfileSHA256 = profileSHA256
            originalPreparation.localOnlyVerified = nativeIsolationVerified
            originalPreparation.nativeProfileSHA256 = profileSHA256
        }
        init(ticket: C.ExecutionTicket, original: URL, stage: URL, custody: URL, before: Manifest,
             originalPreparation: RCCOperationalQuality.Preparation, root: URL, lease: ExclusiveHookLease) {
            self.ticket = ticket; self.original = original; self.stage = stage; self.custody = custody
            self.before = before; self.originalPreparation = originalPreparation; self.root = root; self.lease = lease
        }
        var directive: String {
            "\nHOST-OWNED STAGED WRITER: your executable workspace is this private candidate: \(stage.path). Original project path \(original.path) is reference context only and is NOT accessible. Apply original-relative paths only inside the candidate. Run file-relative tests from their actual containing directory, not an assumed or placeholder cwd. Prefer inline commands for temporary helpers; shared /tmp and /private/tmp are denied. Only when the original task permits temporary helper files may you use the native private $TMPDIR, never a shared temporary pathname. A writable scratch capability does not expand the original task scope. Do not access the original, its parent, custody or sibling paths; do not install, contact network, create Git state, or change verification rules. The host alone verifies and atomically adopts a passing candidate. Do not claim that you applied the original project.\n"
        }
        func unchanged() -> Bool { (try? Manifest.capture(workspace: original.path)) == before }
        private func changes(_ after: Manifest) -> [String] {
            let a = Dictionary(uniqueKeysWithValues: before.entries.map { ($0.path, $0) })
            let b = Dictionary(uniqueKeysWithValues: after.entries.map { ($0.path, $0) })
            return Set(a.keys).union(b.keys).filter { a[$0] != b[$0] }.sorted()
        }
        private func object(state: String, phase: String, terminated: Bool, checks: Bool) -> [String: Any] {
            ["schema": 1, "task_id": ticket.taskID, "node_id": ticket.nodeID, "attempt_id": ticket.attemptID,
             "configuration_sha256": ticket.configurationSHA256, "state": state, "phase": phase,
             "envelope_sha256": ticket.stagedWriterEnvelopeSHA256!, "base_sha256": before.sha256,
             "original_unchanged": unchanged(), "native_turn_terminated": terminated, "checks_passed": checks,
             "local_only_verified": nativeIsolationVerified, "native_profile_sha256": nativeProfileSHA256 ?? NSNull(),
             "original_workspace": original.path, "staged_workspace": stage.path,
             "original_contract_sha256": originalPreparation.prepared.envelope.contract.sha256,
             "checker_sha256": C.digest(originalPreparation.prepared.checkerBytes),
             "staged_check_contract_sha256": stagedCheckContractSHA ?? NSNull(),
             "staged_check_receipt_sha256": stagedCheckReceiptSHA ?? NSNull(),
             "raw_staged_artifact_sha256": stageArtifactSHA ?? NSNull(),
             "mapped_final_artifact_sha256": mappedArtifactSHA ?? NSNull(),
             "staged_after_sha256": stageAfter?.sha256 ?? NSNull(),
             "changed_paths": stageAfter.map(changes) ?? [], "observed_at_ms": Int64(Date().timeIntervalSince1970 * 1000)]
        }
        func persistPhase(_ phase: String) throws {
            let data = try JSONSerialization.data(withJSONObject: object(state: "held", phase: phase, terminated: false, checks: false), options: [.sortedKeys])
            try write(data, to: custody.appendingPathComponent(phase + ".json"))
        }
        func stageAssessment(artifact: Artifact) throws -> PreparedTaskQuality.Witness {
            guard unchanged() else { throw Failure.changed }
            stageArtifactSHA = C.digest(try RCCOperationalQuality.encoded(artifact))
            stageAfter = try Manifest.capture(workspace: stage.path)
            try ownedEntries(stageAfter!, root: stage)
            let modes = Dictionary(uniqueKeysWithValues: before.entries.map { ($0.path, $0.mode) })
            guard stageAfter!.entries.allSatisfy({ entry in modes[entry.path].map { $0 == entry.mode } ?? true }) else { throw Failure.scope }
            guard changes(stageAfter!).allSatisfy({ path in
                !path.isEmpty && originalPreparation.prepared.envelope.workspacePaths.contains { path == $0 || path.hasPrefix($0 + "/") }
            }) else { throw Failure.scope }
            let derived = originalPreparation.prepared.reboundForContinuation(
                contextSHA256: RCCOperationalQuality.contextSHA(ticket), startTreeSHA256: artifact.workspaceBeforeHash)
            stagedCheckContractSHA = derived.envelope.contract.sha256
            let witness = try derived.evaluateWithWitness(artifact: artifact, artifactSHA256: stageArtifactSHA!,
                contextSHA256: RCCOperationalQuality.contextSHA(ticket), workspace: stage.path,
                executionID: ticket.attemptID, runsRoot: root.appendingPathComponent("checks"))
            stagedCheckReceiptSHA = witness.receipt?.observedReceiptSHA256
            stagedChecksPassed = witness.assessment.taskCompletionVerified && witness.contract.fullCoverage
            try write(try RCCOperationalQuality.encoded(witness.contract), to: custody.appendingPathComponent("staged-check-contract.json"))
            return witness
        }
        func mappedArtifact(_ a: Artifact) -> Artifact {
            Artifact(provider: a.provider, action: a.action, permissionProfile: a.permissionProfile, model: a.model,
                effort: a.effort, executorContractVersion: a.executorContractVersion, executorContractSHA256: a.executorContractSHA256,
                exitCode: a.exitCode, output: a.output, stderr: a.stderr, durationMS: a.durationMS,
                workspaceBeforeHash: originalPreparation.prepared.envelope.contract.startTreeSHA256,
                workspaceAfterHash: observedStateHash(original.path), nativeRecord: a.nativeRecord)
        }
        func commit<T>(terminated: Bool, cancelled: @autoclosure () -> Bool, verifyApplied: () throws -> T) throws -> (T, C.StagedWriter) {
            guard terminated, nativeEnded, nativeIsolationVerified, !cancelled(), stagedChecksPassed, unchanged(), let after = stageAfter,
                try Manifest.capture(workspace: stage.path) == after else { throw Failure.unsettled }
            try persistPhase("before-swap")
            try swap(original, stage); swapped = true
            do {
                guard try Manifest.capture(workspace: stage.path) == before,
                    try Manifest.capture(workspace: original.path) == after else { throw Failure.changed }
                let result = try verifyApplied()
                guard !cancelled() else { throw Failure.unsettled }
                guard try Manifest.capture(workspace: stage.path) == before,
                    try Manifest.capture(workspace: original.path) == after else { throw Failure.changed }
                let descriptor = try settle(.applied, terminated: true, checks: true)
                return (result, descriptor)
            } catch {
                // The old original remains at stage, so one atomic reversal
                // preserves the exact prior bytes, never a per-file repair.
                // Never move a new external edit out of the visible project.
                // Rollback is authorized only while BOTH roots remain exactly
                // the two trees owned by this swap. Otherwise hold in place.
                guard (try? Manifest.capture(workspace: stage.path)) == before,
                    (try? Manifest.capture(workspace: original.path)) == after else { throw Failure.rollback }
                do { try swap(original, stage); swapped = false; guard unchanged() else { throw Failure.rollback } }
                catch { throw Failure.rollback }
                throw error
            }
        }
        func mapped(_ artifact: Artifact) throws -> Artifact {
            let value = mappedArtifact(artifact)
            mappedArtifactSHA = C.digest(try RCCOperationalQuality.encoded(value)); return value
        }
        func settle(_ state: C.StagedWriter.State, terminated: Bool, checks: Bool = false) throws -> C.StagedWriter {
            if let final { return final }
            if state == .discarded { guard terminated, nativeEnded, nativeIsolationVerified, !swapped, unchanged() else { throw Failure.unsettled } }
            if state == .applied { guard terminated, swapped, checks else { throw Failure.unsettled } }
            let data = try JSONSerialization.data(withJSONObject: object(state: state.rawValue, phase: state.rawValue,
                terminated: terminated, checks: checks), options: [.sortedKeys])
            let path = root.appendingPathComponent(ticket.attemptID + ".json")
            try write(data, to: path)
            let readback = try Data(contentsOf: path)
            guard readback == data else { throw Failure.receipt }
            let descriptor = C.StagedWriter(state: state, receiptPath: path.path, receiptSHA256: C.digest(data))
            final = descriptor; return descriptor
        }
    }
}

/// Actual filesystem/checker/swap fixtures only, with synthetic native evidence.
/// No account, provider, model, live worktree or production registry is touched.
func rccStagedWriterTransactionSelfTest() throws {
    typealias T = RCCStagedWriterTransaction
    typealias C = RCCRuntimeContract
    let fm = FileManager.default
    let base = fm.temporaryDirectory.appendingPathComponent("os1-staged-write-" + UUID().uuidString).resolvingSymlinksInPath()
    try fm.createDirectory(at: base, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: base) }
    let receipts = base.appendingPathComponent("receipts"), witnesses = base.appendingPathComponent("witnesses")
    try fm.createDirectory(at: witnesses, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    let hash = C.digest(Data("fixture-not-native-proof".utf8))
    var count = 0
    func check(_ pass: @autoclosure () throws -> Bool, _ text: String) throws {
        guard try pass() else { throw OS1Error.message("Staged writer fixture: " + text) }; count += 1
    }
    func rejects(_ text: String, _ body: () throws -> Void) throws {
        do { try body() } catch { count += 1; return }
        throw OS1Error.message("Staged writer fixture accepted " + text)
    }
    let checker = Data("""
import json,pathlib,sys
x=json.loads(pathlib.Path(sys.argv[1]).read_text())
p=pathlib.Path(x['workspace'])/'module.py'
ok=p.read_text()=='VALUE = 2\\n'
print(json.dumps([{'checkID':'exact.module','status':'passed' if ok else 'failed','score':1 if ok else 0}]))
""".utf8)
    func make(_ name: String) throws -> (C.ExecutionTicket, RCCOperationalQuality.Preparation, RCCOperationalQuality.LocalEffectsBoundary) {
        let ws = base.appendingPathComponent(name)
        try fm.createDirectory(at: ws, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        try Data("VALUE = 1\n".utf8).write(to: ws.appendingPathComponent("module.py"))
        try Data("frozen owner material\n".utf8).write(to: ws.appendingPathComponent("README.md"))
        for file in ["module.py", "README.md"] { try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: ws.appendingPathComponent(file).path) }
        let objective = "Implement the bounded module in \(name) according to its exact immutable specification."
        let objectiveSHA = C.digest(Data(objective.utf8)), now = Date()
        let contract = TaskQualityEvidence.Contract(basis: .declaredTrustedContract,
            objectiveSHA256: objectiveSHA, contextSHA256: C.digest(Data()), sourceSHA256: nil,
            startTreeSHA256: workspaceHash(ws.path), scope: .workspaceWrite, verifierCodeSHA256: C.digest(checker),
            referencePolicySHA256: hash, requiredCheckIDs: ["exact.module"], fullCoverage: true,
            referenceProfiles: [], reference: nil, issuedAt: now.addingTimeInterval(-10), validUntil: now.addingTimeInterval(600))
        let envelope = PreparedTaskQuality.Envelope(contract: contract, checkerSHA256: C.digest(checker), timeoutSeconds: 10,
            workspacePaths: ["module.py"], localEffectsOnly: true,
            stagedWriterBaseSHA256: try T.Manifest.capture(workspace: ws.path).sha256)
        let prepared = PreparedTaskQuality(envelope: envelope, checkerBytes: checker, referencePolicySHA256: hash)
        let envelopeSHA = C.digest(try RCCOperationalQuality.encoded(envelope))
        let boundary = RCCOperationalQuality.LocalEffectsBoundary(envelopeSHA256: envelopeSHA,
            originalObjectiveSHA256: objectiveSHA, scope: .workspaceWrite)
        let binding = try T.catalogBinding(prepared: prepared, workspace: ws.path, boundary: boundary)
        let config = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture",
            model: "fixture", effort: .low, tools: ["shell"], scope: .workspaceWrite,
            permissionProfile: .workspaceWrite, quotaPool: .openAICodex, allowedPaths: ["**"], configurationSHA256: hash)
        let host = C.HostContext(workspace: ws.path, context: nil, providerPreference: "auto", codexSessionID: nil,
            claudeSessionID: nil, requireReadOnly: false, ownerPolicy: nil)
        let ticket = C.ExecutionTicket(taskID: "fixture-" + name, nodeID: "node", attemptID: "attempt-" + name,
            candidateID: "cheap", requestSHA256: objectiveSHA, policySHA256: hash, policySourceSHA256: hash,
            sourceFingerprint: C.digest(try C.encode(host)), configurationSHA256: hash, selectedConfig: config,
            objective: objective, instruction: objective, contextRefs: [], ownedPaths: ["**"],
            originalRequest: objective, originalObjective: objective, hostContext: host,
            executionIsolation: "codex_fresh_local_effects_v1", executionIsolationSHA256: envelopeSHA,
            stagedWriterEnvelopeSHA256: binding.envelopeSHA256, stagedWriterBaseSHA256: binding.baseSHA256)
        let p = RCCOperationalQuality.Preparation(prepared: prepared, before: try T.Manifest.capture(workspace: ws.path),
            correctiveAttempts: 0, budget: .init(), localOnlyVerified: false, nativeProfileSHA256: nil, correctionPrompt: nil)
        return (ticket, p, boundary)
    }
    func start(_ f: (C.ExecutionTicket, RCCOperationalQuality.Preparation, RCCOperationalQuality.LocalEffectsBoundary)) throws -> T.Transaction {
        guard let tx = try T.prepare(ticket: f.0, preparation: f.1, boundary: f.2, root: receipts, leaseHome: base) else { throw T.Failure.ineligible }
        tx.observeNative(terminated: true, localOnlyVerified: true, profileSHA256: hash)
        return tx
    }
    func artifact(_ tx: T.Transaction, before: String) -> Artifact {
        .init(provider: "codex", action: "fixture", permissionProfile: "workspace_write", model: "fixture", effort: "low",
            executorContractVersion: "fixture", executorContractSHA256: hash, exitCode: 0, output: "Bounded implementation candidate.",
            stderr: "", durationMS: 1, workspaceBeforeHash: before, workspaceAfterHash: observedStateHash(tx.stage.path),
            nativeRecord: .init(turnID: "fixture-turn", recordPath: base.appendingPathComponent("synthetic-native.jsonl").path,
                persistence: "verified", desktopVisibility: "not_revealed"))
    }
    func pass(_ tx: T.Transaction) throws -> Artifact {
        let before = workspaceHash(tx.stage.path)
        try Data("VALUE = 2\n".utf8).write(to: tx.stage.appendingPathComponent("module.py"))
        let a = artifact(tx, before: before), w = try tx.stageAssessment(artifact: a)
        try check(w.assessment.taskCompletionVerified, "actual staged checker passed")
        return a
    }
    let successful = try make("success")
    do {
        let tx = try start(successful)
        try check(tx.stage.path != tx.original.path && tx.unchanged(), "isolated clone does not mutate original")
        let a = try pass(tx)
        let applied = try tx.commit(terminated: true, cancelled: false) {
            let mapped = try tx.mapped(a)
            let checked = try RCCOperationalQuality.finish(tx.originalPreparation, ticket: successful.0,
                artifact: mapped, artifactSHA256: C.digest(try RCCOperationalQuality.encoded(mapped)),
                workspace: tx.original.path, root: witnesses)
            guard checked.assessment.taskCompletionVerified else { throw T.Failure.scope }
            return checked
        }
        try check(applied.1.state == .applied && applied.0.descriptor?.coverage == .full,
            "original contract verified after actual atomic swap")
        try check(try String(contentsOf: tx.original.appendingPathComponent("module.py"), encoding: .utf8) == "VALUE = 2\n", "original receives candidate once")
        try check(try String(contentsOf: tx.stage.appendingPathComponent("module.py"), encoding: .utf8) == "VALUE = 1\n", "old original retained as rollback source")
        let bytes = try Data(contentsOf: URL(fileURLWithPath: applied.1.receiptPath))
        let receipt = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
        try check(C.digest(bytes) == applied.1.receiptSHA256 && receipt["state"] as? String == "applied" &&
            receipt["original_contract_sha256"] as? String == successful.1.prepared.envelope.contract.sha256,
            "canonical receipt binds original identity and exact bytes")
    }
    do {
        let f = try make("rollback"), tx = try start(f); _ = try pass(tx)
        try rejects("post-swap check failure") { _ = try tx.commit(terminated: true, cancelled: false) { () throws -> Bool in throw T.Failure.scope } }
        try check(tx.unchanged() && !tx.swapped, "post-swap failure atomically restores original")
        let d = try tx.settle(.discarded, terminated: true)
        try check(d.state == .discarded && fm.fileExists(atPath: tx.stage.path), "failed candidate retained with verified discard")
    }
    do {
        let f = try make("external-after-swap"), tx = try start(f); _ = try pass(tx)
        try rejects("external edit during applied verification") {
            _ = try tx.commit(terminated: true, cancelled: false) { () throws -> Bool in
                try Data("external visible edit\n".utf8).write(to: tx.original.appendingPathComponent("module.py"))
                throw T.Failure.changed
            }
        }
        try check(try String(contentsOf: tx.original.appendingPathComponent("module.py"), encoding: .utf8) == "external visible edit\n",
            "external live edit is never swapped into hidden custody")
        try check(tx.swapped && fm.fileExists(atPath: tx.stage.appendingPathComponent("module.py").path), "unknown swap keeps both trees")
        try rejects("external edit cannot mint discard or replay") { _ = try tx.settle(.discarded, terminated: true) }
        try check(try tx.settle(.held, terminated: true).state == .held, "external change held without replay")
    }
    let failed = try make("failed")
    do {
        let tx = try start(failed), before = workspaceHash(tx.stage.path)
        try Data("VALUE = 3\n".utf8).write(to: tx.stage.appendingPathComponent("module.py"))
        let w = try tx.stageAssessment(artifact: artifact(tx, before: before))
        try check(w.assessment.state == .mismatch && tx.unchanged(), "failed checker leaves original untouched")
        try rejects("failed staged check cannot commit") { _ = try tx.commit(terminated: true, cancelled: false) { true } }
        _ = try tx.settle(.discarded, terminated: true)
    }
    do {
        var next = failed.0; next.attemptID = "reference-after-failed"
        guard let clean = try T.prepare(ticket: next, preparation: failed.1, boundary: failed.2, root: receipts, leaseHome: base) else { throw T.Failure.ineligible }
        try check(try String(contentsOf: clean.stage.appendingPathComponent("module.py"), encoding: .utf8) == "VALUE = 1\n", "reference begins from clean original not dirty cheap candidate")
    }
    do {
        let f = try make("owned"), tx = try start(f), before = workspaceHash(tx.stage.path)
        try Data("changed protected material\n".utf8).write(to: tx.stage.appendingPathComponent("README.md"))
        try rejects("unowned staged edit") { _ = try tx.stageAssessment(artifact: artifact(tx, before: before)) }
        try check(tx.unchanged(), "unowned candidate never reaches original")
    }
    do {
        let f = try make("cancel-before"), tx = try start(f); _ = try pass(tx)
        try rejects("cancel before swap") { _ = try tx.commit(terminated: true, cancelled: true) { true } }
        try check(tx.unchanged(), "cancelled candidate leaves original")
    }
    do {
        let f = try make("cancel-during"), tx = try start(f); _ = try pass(tx); var cancelled = false
        try rejects("cancel while validating applied tree") { _ = try tx.commit(terminated: true, cancelled: cancelled) { cancelled = true; return true } }
        try check(tx.unchanged() && !tx.swapped, "late cancellation rolls back actual swap")
    }
    do {
        let f = try make("concurrent"), tx = try start(f); _ = try pass(tx)
        try Data("external edit\n".utf8).write(to: tx.original.appendingPathComponent("module.py"))
        try rejects("original changed after clone") { _ = try tx.commit(terminated: true, cancelled: false) { true } }
        try rejects("changed original cannot mint safe discard") { _ = try tx.settle(.discarded, terminated: true) }
        try check(try String(contentsOf: tx.original.appendingPathComponent("module.py"), encoding: .utf8) == "external edit\n", "foreign original edit preserved")
    }
    do {
        let f = try make("unsettled"), tx = try start(f); _ = try pass(tx)
        tx.observeNative(terminated: false, localOnlyVerified: false, profileSHA256: nil)
        try rejects("unsettled native cannot apply") { _ = try tx.commit(terminated: false, cancelled: false) { true } }
        try rejects("unsettled native cannot authorize replay") { _ = try tx.settle(.discarded, terminated: false) }
        try check(try tx.settle(.held, terminated: false).state == .held, "uncertain native held")
    }
    do {
        let f = try make("permissions"), tx = try start(f), before = workspaceHash(tx.stage.path)
        try Data("VALUE = 2\n".utf8).write(to: tx.stage.appendingPathComponent("module.py"))
        try fm.setAttributes([.posixPermissions: 0o666], ofItemAtPath: tx.stage.appendingPathComponent("module.py").path)
        try rejects("candidate chmod cannot widen original permissions") { _ = try tx.stageAssessment(artifact: artifact(tx, before: before)) }
        try check(tx.unchanged(), "permission-changing candidate preserved without apply")
    }
    let denied = try make("eligibility")
    func altered(full: Bool? = nil, local: Bool? = nil, paths: [String]? = nil, dropBase: Bool = false) -> PreparedTaskQuality {
        let e = denied.1.prepared.envelope; var c = e.contract
        if let full { c.fullCoverage = full }
        let changed = PreparedTaskQuality.Envelope(contract: c, checkerSHA256: e.checkerSHA256,
            timeoutSeconds: e.timeoutSeconds, workspacePaths: paths ?? e.workspacePaths,
            localEffectsOnly: local ?? e.localEffectsOnly,
            stagedWriterBaseSHA256: dropBase ? nil : e.stagedWriterBaseSHA256)
        return .init(envelope: changed, checkerBytes: denied.1.prepared.checkerBytes, referencePolicySHA256: hash)
    }
    let preserved = denied.1.prepared.reboundForContinuation(contextSHA256: hash, startTreeSHA256: hash)
    try check(preserved.envelope.stagedWriterBaseSHA256 == denied.1.prepared.envelope.stagedWriterBaseSHA256,
        "explicit staged base survives derived checker mapping")
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970
    let decoded = try decoder.decode(PreparedTaskQuality.Envelope.self, from: RCCOperationalQuality.encoded(denied.1.prepared.envelope))
    try check(decoded.stagedWriterBaseSHA256 == denied.1.prepared.envelope.stagedWriterBaseSHA256,
        "owner exact-content base survives envelope roundtrip")
    var p = altered(dropBase: true)
    try rejects("legacy full contract without exact owner base cannot descend") { _ = try T.catalogBinding(prepared: p, workspace: denied.0.hostContext!.workspace, boundary: denied.2) }
    p = altered(full: false)
    try rejects("partial contract") { _ = try T.catalogBinding(prepared: p, workspace: denied.0.hostContext!.workspace, boundary: denied.2) }
    p = altered(local: false)
    try rejects("external effects contract") { _ = try T.catalogBinding(prepared: p, workspace: denied.0.hostContext!.workspace, boundary: denied.2) }
    p = altered(paths: [])
    try rejects("empty artifact ownership") { _ = try T.catalogBinding(prepared: p, workspace: denied.0.hostContext!.workspace, boundary: denied.2) }
    p = altered(paths: ["../outside"])
    try rejects("escaping ownership") { _ = try T.catalogBinding(prepared: p, workspace: denied.0.hostContext!.workspace, boundary: denied.2) }
    var changed = denied.0; changed.stagedWriterBaseSHA256 = String(repeating: "0", count: 64)
    try rejects("stale catalog base") { _ = try T.prepare(ticket: changed, preparation: denied.1, boundary: denied.2, root: receipts, leaseHome: base) }
    changed = denied.0; changed.nativeResumeSessionID = "existing-thread"
    try rejects("resumed native") { _ = try T.prepare(ticket: changed, preparation: denied.1, boundary: denied.2, root: receipts, leaseHome: base) }
    changed = denied.0; changed.stagedWriterEnvelopeSHA256 = String(repeating: "0", count: 64)
    try rejects("changed envelope") { _ = try T.prepare(ticket: changed, preparation: denied.1, boundary: denied.2, root: receipts, leaseHome: base) }
    let ws = URL(fileURLWithPath: denied.0.hostContext!.workspace)
    let sourceFile = ws.appendingPathComponent("module.py")
    let time = try fm.attributesOfItem(atPath: sourceFile.path)[.modificationDate] as! Date
    let weakTree = workspaceHash(ws.path)
    try Data("VALUE = 9\n".utf8).write(to: sourceFile)
    try fm.setAttributes([.modificationDate: time], ofItemAtPath: sourceFile.path)
    try check(workspaceHash(ws.path) == weakTree, "fixture actually preserves legacy size/mtime observation")
    try rejects("same-size same-mtime mutation BEFORE catalog invalidates exact owner base") {
        _ = try T.catalogBinding(prepared: denied.1.prepared, workspace: ws.path, boundary: denied.2)
    }
    try Data("VALUE = 1\n".utf8).write(to: sourceFile)
    try fm.setAttributes([.modificationDate: time], ofItemAtPath: sourceFile.path)
    try check(try T.catalogBinding(prepared: denied.1.prepared, workspace: ws.path, boundary: denied.2).baseSHA256 == denied.0.stagedWriterBaseSHA256,
        "unchanged exact original remains eligible after byte-accurate restore")
    try fm.createSymbolicLink(at: ws.appendingPathComponent("link"), withDestinationURL: ws.appendingPathComponent("module.py"))
    try rejects("symlink workspace") { _ = try T.catalogBinding(prepared: denied.1.prepared, workspace: ws.path, boundary: denied.2) }
    try fm.removeItem(at: ws.appendingPathComponent("link"))
    try fm.createDirectory(at: ws.appendingPathComponent(".git"), withIntermediateDirectories: false)
    try rejects("Git workspace") { _ = try T.catalogBinding(prepared: denied.1.prepared, workspace: ws.path, boundary: denied.2) }
    print("RCC staged writer transaction: \(count) checks PASS; actual clone/check/swap/rollback/discard; synthetic native only; model calls 0")
}
