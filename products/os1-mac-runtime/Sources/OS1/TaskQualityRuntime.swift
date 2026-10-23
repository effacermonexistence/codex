import Foundation
import CryptoKit
import CoreFoundation
import OS1Context
import Darwin

/// The existing execution flow consumes an owner-custodied task checker, not
/// a second benchmark service or a model-authored 'tests passed' assertion.
/// A missing contract is an explicit unresolved quality state.
struct PreparedTaskQuality {
    struct Witness {
        let assessment: TaskQualityEvidence.Evaluation
        let contract: TaskQualityEvidence.Contract
        let receipt: TaskQualityEvidence.Receipt?
        let artifact: TaskQualityEvidence.ObservedArtifact
        let failureDiagnostic: String
    }
    struct Envelope: Codable {
        let contract: TaskQualityEvidence.Contract
        let checkerSHA256: String
        let timeoutSeconds: Int
        /// Exact owner-declared candidate paths; an empty list is output-only.
        let workspacePaths: [String]
        /// Only a trusted pre-dispatch owner contract may narrow this job to
        /// local model-controlled effects. Automatic test discovery never does.
        let localEffectsOnly: Bool
        let publicRegressionSnapshot: PythonRegressionSnapshot?
        /// Optional exact content base declared by the owner BEFORE routing.
        /// Absence retains legacy checks but never admits speculative writers.
        let stagedWriterBaseSHA256: String?
        let ownerCollection: TaskQualityEvidence.OwnerCollection?
        init(contract: TaskQualityEvidence.Contract, checkerSHA256: String, timeoutSeconds: Int, workspacePaths: [String], localEffectsOnly: Bool = false, publicRegressionSnapshot: PythonRegressionSnapshot? = nil, stagedWriterBaseSHA256: String? = nil, ownerCollection: TaskQualityEvidence.OwnerCollection? = nil) {
            self.ownerCollection = ownerCollection
            self.contract = contract; self.checkerSHA256 = checkerSHA256; self.timeoutSeconds = timeoutSeconds
            self.workspacePaths = workspacePaths; self.localEffectsOnly = localEffectsOnly; self.publicRegressionSnapshot = publicRegressionSnapshot
            self.stagedWriterBaseSHA256 = stagedWriterBaseSHA256
        }
        enum CodingKeys: String, CodingKey { case contract, checkerSHA256, timeoutSeconds, workspacePaths, localEffectsOnly, publicRegressionSnapshot, stagedWriterBaseSHA256, ownerCollection }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            contract = try c.decode(TaskQualityEvidence.Contract.self, forKey: .contract)
            checkerSHA256 = try c.decode(String.self, forKey: .checkerSHA256); timeoutSeconds = try c.decode(Int.self, forKey: .timeoutSeconds)
            workspacePaths = try c.decode([String].self, forKey: .workspacePaths)
            localEffectsOnly = try c.decodeIfPresent(Bool.self, forKey: .localEffectsOnly) ?? false
            publicRegressionSnapshot = try c.decodeIfPresent(PythonRegressionSnapshot.self, forKey: .publicRegressionSnapshot)
            stagedWriterBaseSHA256 = try c.decodeIfPresent(String.self, forKey: .stagedWriterBaseSHA256)
            ownerCollection = try c.decodeIfPresent(TaskQualityEvidence.OwnerCollection.self, forKey: .ownerCollection)
        }
    }
    let envelope: Envelope
    let checkerBytes: Data
    let referencePolicySHA256: String
    private let partialRegression: PythonRegressionSnapshot?
    let resourceScheduleSnapshot: ResourceScheduleSupplement.Snapshot?
    var frozenRegressionSnapshot: PythonRegressionSnapshot? { partialRegression }

    init(envelope: Envelope, checkerBytes: Data, referencePolicySHA256: String,
         partialRegression: PythonRegressionSnapshot? = nil, resourceScheduleSnapshot: ResourceScheduleSupplement.Snapshot? = nil) {
        self.resourceScheduleSnapshot = resourceScheduleSnapshot
        self.envelope = envelope; self.checkerBytes = checkerBytes
        self.referencePolicySHA256 = referencePolicySHA256; self.partialRegression = partialRegression
    }

    static var root: URL {
        SourceContextStore().root.appendingPathComponent("source-snapshots/task-quality", isDirectory: true)
    }
    static func prepare(objective: String, contextSHA256: String, sourceSHA256: String?,
                        startTreeSHA256: String, scope: TaskContext.Scope,
                        referencePolicySHA256: String, workspace: String? = nil,
                        frozenRegression: PythonRegressionSnapshot? = nil, allowRegressionAcquisition: Bool = true,
                        rootURL: URL = Self.root) throws -> PreparedTaskQuality? {
        let objectiveSHA = TaskQualityEvidence.digest(Data(objective.utf8))
        let path = rootURL.appendingPathComponent("contracts", isDirectory: true).appendingPathComponent(objectiveSHA + ".json")
        guard FileManager.default.fileExists(atPath: path.path) else {
            if scope == .readOnly {
                return try ResourceScheduleSupplement.attach(nil, objective: objective, contextSHA256: contextSHA256,
                    sourceSHA256: sourceSHA256, startTreeSHA256: startTreeSHA256, scope: scope,
                    referencePolicySHA256: referencePolicySHA256, workspace: workspace)
            }
            guard let workspace, scope != .readOnly,
                  objective.range(of: #"\b(?:tests?|regressions?|unittest)\b|테스트|회귀"#, options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
            let acquired: PythonRegressionSnapshot?
            if let frozenRegression { acquired = frozenRegression }
            else if allowRegressionAcquisition { acquired = try PythonRegressionSnapshot.acquire(workspace: workspace) }
            else { acquired = nil }
            guard let snapshot = acquired else { return nil }
            let checker = try snapshot.checkerBytes()
            let checkerSHA = TaskQualityEvidence.digest(checker), now = Date()
            let contract = TaskQualityEvidence.Contract(basis: .declaredTrustedContract,
                objectiveSHA256: objectiveSHA, contextSHA256: contextSHA256, sourceSHA256: sourceSHA256,
                startTreeSHA256: startTreeSHA256, scope: scope, verifierCodeSHA256: checkerSHA,
                referencePolicySHA256: referencePolicySHA256,
                requiredCheckIDs: ["partial.original_unittest", "partial.candidate_unittest"], fullCoverage: false,
                referenceProfiles: [], reference: nil, issuedAt: now, validUntil: now.addingTimeInterval(86_400))
            return Self(envelope: Envelope(contract: contract, checkerSHA256: checkerSHA, timeoutSeconds: 90,
                workspacePaths: snapshot.allowedRoots, publicRegressionSnapshot: snapshot), checkerBytes: checker,
                referencePolicySHA256: referencePolicySHA256, partialRegression: snapshot)
        }
        guard path.resolvingSymlinksInPath().path == path.standardizedFileURL.path else { throw OS1Error.message("Task-quality contract source is not canonical") }
        let attrs = try FileManager.default.attributesOfItem(atPath: path.path)
        guard (attrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(), ((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0,
              attrs[.type] as? FileAttributeType == .typeRegular,
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
        guard checker.resolvingSymlinksInPath().path == checker.standardizedFileURL.path else { throw OS1Error.message("Task-quality checker source is not canonical") }
        let checkerAttrs = try FileManager.default.attributesOfItem(atPath: checker.path)
        guard (checkerAttrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(), ((checkerAttrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0,
              checkerAttrs[.type] as? FileAttributeType == .typeRegular,
              (checkerAttrs[.size] as? NSNumber)?.intValue ?? Int.max <= 256_000 else { throw OS1Error.message("Task-quality checker is not a bounded regular file") }
        let bytes = try Data(contentsOf: checker)
        guard TaskQualityEvidence.digest(bytes) == envelope.checkerSHA256 else { throw OS1Error.message("Frozen task-quality checker identity mismatch") }
        if let snapshot = envelope.publicRegressionSnapshot {
            guard snapshot.allowedRoots == envelope.workspacePaths, try snapshot.checkerBytes() == bytes,
                !envelope.contract.fullCoverage, envelope.contract.reference == nil else { throw OS1Error.message("Public partial suite identity/coverage changed") }
        }
        let prepared = Self(envelope: envelope, checkerBytes: bytes, referencePolicySHA256: referencePolicySHA256, partialRegression: envelope.publicRegressionSnapshot)
        return try ResourceScheduleSupplement.attach(prepared, objective: objective, contextSHA256: contextSHA256,
            sourceSHA256: sourceSHA256, startTreeSHA256: startTreeSHA256, scope: scope,
            referencePolicySHA256: referencePolicySHA256, workspace: workspace)
    }

    func evaluate(artifact: Artifact, artifactSHA256: String, contextSHA256: String,
                  workspace: String, executionID: String, runsRoot: URL = Self.root) throws -> TaskQualityEvidence.Evaluation {
        try evaluateWithWitness(artifact: artifact, artifactSHA256: artifactSHA256, contextSHA256: contextSHA256,
            workspace: workspace, executionID: executionID, runsRoot: runsRoot).assessment
    }

    /// Rebind only the host's continuation input/tree. The original checker,
    /// required obligations, coverage and reference evidence are immutable.
    /// A changed comparison context cannot manufacture reference parity.
    func reboundForContinuation(contextSHA256: String, startTreeSHA256: String) -> Self {
        var contract = envelope.contract
        contract.contextSHA256 = contextSHA256
        contract.startTreeSHA256 = startTreeSHA256
        return Self(envelope: Envelope(contract: contract, checkerSHA256: envelope.checkerSHA256,
            timeoutSeconds: envelope.timeoutSeconds, workspacePaths: envelope.workspacePaths, localEffectsOnly: envelope.localEffectsOnly, publicRegressionSnapshot: envelope.publicRegressionSnapshot,
            stagedWriterBaseSHA256: envelope.stagedWriterBaseSHA256, ownerCollection: envelope.ownerCollection),
            checkerBytes: checkerBytes, referencePolicySHA256: referencePolicySHA256, partialRegression: partialRegression, resourceScheduleSnapshot: resourceScheduleSnapshot)
    }

    func evaluateWithWitness(artifact: Artifact, artifactSHA256: String, contextSHA256: String,
                  workspace: String, executionID: String, runsRoot: URL = Self.root) throws -> Witness {
        let c = envelope.contract
        if let snapshot = resourceScheduleSnapshot { try ResourceScheduleSupplement.revalidate(snapshot, workspace: workspace) }
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
        let runDirectory = runsRoot.appendingPathComponent("runs", isDirectory: true).appendingPathComponent(UUID().uuidString.lowercased(), isDirectory: true)
        try FileManager.default.createDirectory(at: runDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        // Foundation can retain /var while the sandbox kernel observes
        // /private/var. One real directory identity supplies copy, argv and ACL.
        guard let physical = realpath(runDirectory.path, nil) else { throw OS1Error.message("Task-quality scratch directory identity unavailable") }
        let runRoot = URL(fileURLWithPath: String(cString: physical), isDirectory: true)
        free(physical)
        let checker = runRoot.appendingPathComponent("checker.py")
        try checkerBytes.write(to: checker, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: checker.path)
        // Input and code are frozen before invocation. This checker protocol
        // emits check observations only; it cannot assert its own parity state.
        let input = runRoot.appendingPathComponent("input.json")
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]; encoder.dateEncodingStrategy = .millisecondsSince1970
        let candidate: URL
        var candidateSuite: URL?
        if let snapshot = partialRegression {
            let paths = try snapshot.candidatePaths(workspace: workspace)
            candidate = try frozenCandidate(workspace: workspace, paths: paths.filter { !snapshot.isTestSource($0) },
                into: runRoot.appendingPathComponent("frozen-original-suite"))
            for (path, bytes) in snapshot.originalTests {
                let target = candidate.appendingPathComponent(path)
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true,
                    attributes: [.posixPermissions: 0o700])
                try bytes.write(to: target, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
            }
            candidateSuite = try frozenCandidate(workspace: workspace, paths: paths,
                into: runRoot.appendingPathComponent("candidate-suite"))
            let identity = ["originalRecipeSHA256": snapshot.recipeSHA256,
                "originalTests": snapshot.originalTests.mapValues { TaskQualityEvidence.digest($0) },
                "candidateFiles": try paths.reduce(into: [String: String]()) {
                    $0[$1] = TaskQualityEvidence.digest(try Data(contentsOf: candidateSuite!.appendingPathComponent($1)))
                }] as [String: Any]
            try JSONSerialization.data(withJSONObject: identity, options: [.sortedKeys])
                .write(to: runRoot.appendingPathComponent("regression-source-identity.json"), options: .atomic)
        } else {
            candidate = try frozenCandidate(workspace: workspace, paths: envelope.workspacePaths, into: runRoot)
        }
        let payload = TaskQualityCheckerInput(contract: c, binding: binding, workspace: candidate.path,
                                              output: artifact.output, candidateWorkspace: candidateSuite?.path)
        try encoder.encode(payload).write(to: input, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: input.path)
        let result: (Int32, Data, Data)
        do {
            let launch: (String, [String])
            if partialRegression == nil { launch = ("/usr/bin/python3", [checker.path, input.path]) }
            else { launch = try copiedPythonRegressionLaunch(runRoot: runRoot, checker: checker, input: input) }
            result = try commandOutput(launch.0, launch.1,
                timeout: envelope.timeoutSeconds, currentDirectory: runRoot.path,
                environmentOverrides: ["HOME": runRoot.path, "TMPDIR": runRoot.path, "PYTHONNOUSERSITE": "1", "PATH": "/usr/bin:/bin"],
                removingEnvironment: Set(ProcessInfo.processInfo.environment.keys.filter {
                    let key = $0.uppercased()
                    return key.contains("TOKEN") || key.contains("KEY") || key.contains("SECRET") || key.contains("AUTH") || key.contains("PASSWORD")
                }), captureDirectory: runRoot)
        } catch {
            guard partialRegression != nil else { throw error }
            // A runner without an approved Apple interpreter/sandbox has no
            // authority to execute copied project tests. Preserve a typed
            // infrastructure-unverified receipt rather than aborting the
            // whole self-test or silently running a different Python.
            result = (127, Data(), Data("Partial unittest infrastructure unavailable before execution: \(error)\n".utf8))
        }
        try result.1.write(to: runRoot.appendingPathComponent("stdout.json"), options: .atomic)
        try result.2.write(to: runRoot.appendingPathComponent("stderr.txt"), options: .atomic)
        if !envelope.workspacePaths.isEmpty, observedStateHash(workspace) != artifact.workspaceAfterHash {
            throw OS1Error.message("Task-quality live candidate changed during the copied-artifact check")
        }
        if let snapshot = resourceScheduleSnapshot { try ResourceScheduleSupplement.revalidate(snapshot, workspace: workspace) }
        let receiptSHA = TaskQualityEvidence.digest(result.1)
        let rawChecks = result.0 == 0 && result.1.count <= 128_000
            ? try? JSONDecoder().decode([TaskQualityEvidence.Check].self, from: result.1) : nil
        let checks = rawChecks?.map { TaskQualityEvidence.Check(checkID: $0.checkID, status: $0.status,
            score: $0.score, observedReceiptSHA256: receiptSHA) }
        let receipt = checks.map { TaskQualityEvidence.Receipt(basis: .observedCheckerReceipt,
            contractSHA256: c.sha256, binding: binding, checkerIdentitySHA256: TaskQualityEvidence.digest(checkerBytes),
            observedReceiptSHA256: TaskQualityEvidence.digest(result.1), checks: $0, observedAt: Date()) }
        let assessment: TaskQualityEvidence.Evaluation
        if partialRegression != nil && receipt == nil {
            assessment = .init(state: .unverified,
                reason: "Partial unittest checker infrastructure/receipt unavailable (exit \(result.0)); raw stdout/stderr retained",
                contractSHA256: c.sha256, artifactSHA256: artifactSHA256,
                requiredCheckIDs: c.requiredCheckIDs, failedCheckIDs: [])
        } else {
            assessment = TaskQualityEvidence.evaluate(contract: c, receipt: receipt, artifact: observed,
                currentReferencePolicySHA256: referencePolicySHA256, now: Date())
        }
        try encoder.encode(assessment).write(to: runRoot.appendingPathComponent("assessment.json"), options: .atomic)
        for name in ["stdout.json", "stderr.txt", "assessment.json"] {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: runRoot.appendingPathComponent(name).path)
        }
        let rawRows = (try? JSONSerialization.jsonObject(with: result.1)) as? [[String: Any]] ?? []
        let failedIDs = Set(assessment.failedCheckIDs)
        let diagnostic = rawRows.filter { row in
            (row["checkID"] as? String).map(failedIDs.contains) ?? false
        }.prefix(4).map { row in
            let stderr = String((row["stderr"] as? String ?? "").suffix(4_000))
            let lines = stderr.split(separator: "\n").suffix(12).compactMap { NativeStepLabel.redact(String($0)) }
            return (row["checkID"] as? String ?? "failed_check") + ":\n" + lines.joined(separator: "\n")
        }.joined(separator: "\n")
        return Witness(assessment: assessment, contract: c, receipt: receipt, artifact: observed,
            failureDiagnostic: String(diagnostic.prefix(8_000)))
    }
}

/// A fixed, source-custodied partial feasibility checker. It never executes
/// project code, guesses an output, infers full coverage, or changes routing.
enum ResourceScheduleSupplement {
    struct Snapshot: Codable, Equatable { let file: String; let workspace: String; let sha256: String; let custodySHA256: String }
    static let ids = ["partial.schedule.source", "partial.schedule.shape", "partial.schedule.identity",
        "partial.schedule.tasks", "partial.schedule.release", "partial.schedule.deadline",
        "partial.schedule.dependencies", "partial.schedule.capacity"]
    static func selectedFile(_ objective: String) -> String? {
        guard objective.utf8.count <= 65_536 else { return nil }
        let owner = OwnerIntentText.authorityText(objective)
        let pattern = #"^\s*read\s+([A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.json)\s+and\s+(?:return|produce|provide)\s+(?:one|a)\s+feasible\s+non-preemptive\s+schedule\s*(?:[.!]|\n|$)"#
        guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
            let m = re.firstMatch(in: owner, range: NSRange(owner.startIndex..., in: owner)),
            let range = Range(m.range(at: 1), in: owner) else { return nil }
        let file = String(owner[range])
        // A feasible schedule does not itself authorize a particular output
        // representation. Require the explicit closed JSON template, not a
        // mere mention of JSON, quoted example, or a prose/array override.
        let output = #"(?:^|[.!?\n]\s*)return\s+exactly\s+\{\s*(?-i:"project")\s*:\s*<[^>\r\n]{1,80}>\s*,\s*(?-i:"version")\s*:\s*<[^>\r\n]{1,80}>\s*,\s*(?-i:"schedule")\s*:\s*\[\s*\{\s*(?-i:"task_id")\s*:\s*<[^>\r\n]{1,80}>\s*,\s*(?-i:"start")\s*:\s*<(?:built-in\s+JSON\s+|nonnegative\s+)?integer>\s*\}\s*,\s*(?:\.\.\.|…)\s*\]\s*\}(?=\s*(?:[.!](?:\s|$)|\n|$))"#
        guard let format = owner.range(of: output, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let prefix = String(owner[..<format.lowerBound])
        guard prefix.range(of: #"\b(?:example|illustration|quoted(?:\s+template)?)\s*:\s*$"#, options: [.regularExpression, .caseInsensitive]) == nil,
            ownerSpan(prefix) else { return nil }
        let presentations = try? NSRegularExpression(pattern: #"(?:^|[.!?;\n]\s*)(?:(?:please|also|then|instead)\s+)?(?:you\s+(?:must|should|shall)\s+)?(explain|write|return|output|use|provide|produce|format|send)\b([^.!?\n]*)"#, options: [.caseInsensitive])
        for m in presentations?.matches(in: owner, range: NSRange(owner.startIndex..., in: owner)) ?? [] {
            guard let verbRange = Range(m.range(at: 1), in: owner), let bodyRange = Range(m.range(at: 2), in: owner) else { return nil }
            let verb = owner[verbRange].lowercased(), body = String(owner[bodyRange]).trimmingCharacters(in: .whitespaces)
            guard verb == "return", body.range(of: #"^(?:exactly\s*\{|JSON\s+only\b)"#, options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
        }
        let denies = try? NSRegularExpression(pattern: #"\b(?:(?:do|must|shall|should|may|can)\s+not|cannot|can't|don't|never)\s+(?:read|open|access|inspect)\b(.*?)(?=;|!|\n|\.(?:\s|$)|$)"#, options: [.caseInsensitive])
        let denied = (denies?.matches(in: owner, range: NSRange(owner.startIndex..., in: owner)) ?? []).contains { m in
            guard let r = Range(m.range(at: 1), in: owner) else { return true }
            let clause = String(owner[r])
            return clause.range(of: NSRegularExpression.escapedPattern(for: file), options: [.regularExpression, .caseInsensitive]) != nil ||
                clause.range(of: #"^\s*(?:(?:any|all|the)\s+)?(?:files?|source(?:\s+files?)?)(?:\s|$)"#, options: [.regularExpression, .caseInsensitive]) != nil
        }
        guard !denied, !file.contains(".."), !file.hasPrefix("."),
            owner.range(of: #"\b(?:ignore|omit|relax|override|change|adjust)\b[^.\n]*(?:resource|capacit(?:y|ies)|constraint|dependenc|deadline|release|duration|horizon|preempt)|\b(?:do\s+not|don't|never|without)\s+(?:enforce|check|satisfy|consider|respect|use)\b[^.\n]*(?:resource|capacit(?:y|ies)|constraint|dependenc|deadline|release|duration|horizon|preempt)"#,
                options: [.regularExpression, .caseInsensitive]) == nil,
            owner.range(of: #"\b(?:allow|enable|use)\s+preempt(?:ion|ive)\b"#, options: [.regularExpression, .caseInsensitive]) == nil else { return nil }
        return file
    }
    /// Inspect only the prefix before the format directive. JSON property
    /// quotes after it remain intact; a period inside quoted data cannot
    /// create a new owner instruction. Ambiguous escaped quotes abstain.
    static func ownerSpan(_ prefix: String) -> Bool {
        let scalars = Array(prefix.unicodeScalars.map(\.value))
        var quote: UInt32? = nil, escape = false
        func word(_ x: UInt32) -> Bool { (48...57).contains(x) || (65...90).contains(x) || (97...122).contains(x) }
        for i in scalars.indices {
            let c = scalars[i], apostrophe = c == 39 && i > 0 && i + 1 < scalars.count && word(scalars[i-1]) && word(scalars[i+1])
            if escape { if [34,39,96,0x2018,0x2019,0x201c,0x201d].contains(c) { return false }; escape = false; continue }
            if c == 92 { escape = true; continue }
            if apostrophe { continue }
            if let end = quote { if c == end { quote = nil }; continue }
            switch c {
            case 34,39,96: quote = c
            case 0x2018: quote = 0x2019
            case 0x201c: quote = 0x201d
            case 0x2019,0x201d: return false
            default: break
            }
        }
        return quote == nil && !escape
    }
    static func source(_ file: String, workspace: String) throws -> (Data, Snapshot) {
        guard file.range(of: #"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\.json$"#, options: [.regularExpression]) != nil,
            !file.contains(".."), !file.hasPrefix(".") else { throw OS1Error.message("Schedule source is not a closed relative leaf") }
        let requested = URL(fileURLWithPath: workspace).standardizedFileURL
        var originalRoot = stat(); guard lstat(requested.path, &originalRoot) == 0,
            originalRoot.st_mode & S_IFMT == S_IFDIR else { throw OS1Error.message("Schedule root is not a real directory") }
        let root = requested.resolvingSymlinksInPath()
        guard root.path == requested.path || (requested.path.hasPrefix("/var/") && root.path == "/private" + requested.path) else { throw OS1Error.message("Schedule root is not canonical") }
        var rs = stat(); guard lstat(root.path, &rs) == 0, rs.st_mode & S_IFMT == S_IFDIR,
            rs.st_uid == getuid(), rs.st_mode & 0o022 == 0 else { throw OS1Error.message("Schedule source root custody unavailable") }
        let path = root.appendingPathComponent(file).path
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { throw OS1Error.message("Schedule source unavailable") }; defer { close(fd) }
        var a = stat(); guard fstat(fd, &a) == 0, a.st_mode & S_IFMT == S_IFREG, a.st_uid == getuid(),
            a.st_nlink == 1, a.st_mode & 0o022 == 0, a.st_size > 0, a.st_size <= 65_536 else { throw OS1Error.message("Schedule source custody unavailable") }
        var data = Data(); var buffer = [UInt8](repeating: 0, count: 8192)
        while true { let n = Darwin.read(fd, &buffer, buffer.count); guard n >= 0 else { throw OS1Error.message("Schedule source read failed") }; if n == 0 { break }; data.append(contentsOf: buffer.prefix(n)); guard data.count <= 65_536 else { throw OS1Error.message("Schedule source oversized") } }
        var z = stat(), pathState = stat()
        guard fstat(fd, &z) == 0, lstat(path, &pathState) == 0,
            a.st_dev == z.st_dev, a.st_ino == z.st_ino, a.st_size == z.st_size,
            a.st_mtimespec.tv_sec == z.st_mtimespec.tv_sec, a.st_mtimespec.tv_nsec == z.st_mtimespec.tv_nsec,
            a.st_ctimespec.tv_sec == z.st_ctimespec.tv_sec, a.st_ctimespec.tv_nsec == z.st_ctimespec.tv_nsec,
            a.st_dev == pathState.st_dev, a.st_ino == pathState.st_ino, a.st_size == pathState.st_size,
            a.st_mtimespec.tv_sec == pathState.st_mtimespec.tv_sec, a.st_mtimespec.tv_nsec == pathState.st_mtimespec.tv_nsec,
            a.st_ctimespec.tv_sec == pathState.st_ctimespec.tv_sec, a.st_ctimespec.tv_nsec == pathState.st_ctimespec.tv_nsec else { throw OS1Error.message("Schedule source changed during capture") }
        try validate(data)
        let identity = [String(rs.st_dev), String(rs.st_ino), String(rs.st_mode), String(rs.st_uid), String(a.st_dev), String(a.st_ino), String(a.st_mode), String(a.st_uid), String(a.st_nlink),
            String(a.st_size), String(a.st_mtimespec.tv_sec), String(a.st_mtimespec.tv_nsec),
            String(a.st_ctimespec.tv_sec), String(a.st_ctimespec.tv_nsec)].joined(separator: "\n")
        return (data, Snapshot(file: file, workspace: root.path, sha256: TaskQualityEvidence.digest(data),
            custodySHA256: TaskQualityEvidence.digest(Data(identity.utf8))))
    }
    static func revalidate(_ frozen: Snapshot, workspace: String) throws {
        let (_, now) = try source(frozen.file, workspace: workspace)
        guard now == frozen else { throw OS1Error.message("Schedule source changed after preparation") }
    }
    static func validate(_ data: Data) throws {
        func fail() throws -> Never { throw OS1Error.message("Unsupported bounded resource schedule source") }
        func integer(_ value: Any?, _ range: ClosedRange<Int>) -> Int? {
            guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
                !["f", "d"].contains(String(cString: n.objCType)), range.contains(n.intValue) else { return nil }; return n.intValue
        }
        func identifier(_ x: Any?) -> String? { guard let x = x as? String, !x.isEmpty, x.utf8.count <= 128,
            x.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }; return x }
        // Foundation may normalize 1.0 to an integral NSNumber. This closed
        // schema permits only integer numeric tokens outside JSON strings.
        let raw = Array(data); var i = 0, quoted = false, escaped = false
        while i < raw.count {
            let b = raw[i]
            if quoted { if escaped { escaped = false } else if b == 92 { escaped = true } else if b == 34 { quoted = false }; i += 1; continue }
            if b == 34 { quoted = true; i += 1; continue }
            if b == 45 || (48...57).contains(b) {
                var end = i + 1
                while end < raw.count && ((48...57).contains(raw[end]) || [45, 43, 46, 101, 69].contains(raw[end])) { end += 1 }
                guard !raw[i..<end].contains(where: { [46, 101, 69].contains($0) }) else { try fail() }; i = end
            } else { i += 1 }
        }
        guard let root = try? RCCRuntimeContract.checkedObject(data),
            (Set(root.keys) == ["project", "version", "horizon", "resources", "tasks"] ||
             (Set(root.keys) == ["schema", "project", "version", "horizon", "resources", "tasks"] && integer(root["schema"], 1...1) == 1)), identifier(root["project"]) != nil,
            identifier(root["version"]) != nil, let horizon = integer(root["horizon"], 1...4096),
            let resources = root["resources"] as? [String: Any], (1...16).contains(resources.count),
            resources.allSatisfy({ identifier($0.key) != nil && integer($0.value, 0...1_000_000) != nil }),
            let tasks = root["tasks"] as? [[String: Any]], (1...32).contains(tasks.count) else { try fail() }
        var keys = Set<String>(), dependencies: [String: [String]] = [:]
        for t in tasks {
            guard Set(t.keys) == ["id", "duration", "release", "deadline", "requires", "depends"],
                let id = identifier(t["id"]), keys.insert(id).inserted,
                integer(t["duration"], 1...horizon) != nil, let release = integer(t["release"], 0...horizon),
                let deadline = integer(t["deadline"], 0...horizon), release <= deadline,
                let needs = t["requires"] as? [String: Any], Set(needs.keys).isSubset(of: Set(resources.keys)),
                needs.allSatisfy({ integer($0.value, 0...1_000_000) != nil }),
                let deps = t["depends"] as? [String], deps.allSatisfy({ identifier($0) != nil }),
                Set(deps).count == deps.count, !deps.contains(id), deps.count <= 31 else { try fail() }
            dependencies[id] = deps
        }
        guard dependencies.values.allSatisfy({ Set($0).isSubset(of: keys) }) else { try fail() }
        var remaining = keys, finished = Set<String>()
        while !remaining.isEmpty { let ready = remaining.filter { Set(dependencies[$0]!).isSubset(of: finished) }; guard !ready.isEmpty else { try fail() }; remaining.subtract(ready); finished.formUnion(ready) }
    }
    static func attach(_ prepared: PreparedTaskQuality?, objective: String, contextSHA256: String, sourceSHA256: String?,
        startTreeSHA256: String, scope: TaskContext.Scope, referencePolicySHA256: String, workspace: String?) throws -> PreparedTaskQuality? {
        guard scope == .readOnly, let file = selectedFile(objective), let workspace else { return prepared }
        // Never rewrite a full/reference-bearing owner contract or a copied
        // project test suite. No source family is inferred from their code.
        if let p = prepared, p.envelope.contract.fullCoverage || p.envelope.contract.reference != nil || p.frozenRegressionSnapshot != nil { return p }
        let (bytes, snapshot) = try source(file, workspace: workspace), sourceHash = TaskQualityEvidence.digest(bytes)
        let prior = prepared?.checkerBytes ?? Data(), priorIDs = prepared?.envelope.contract.requiredCheckIDs ?? []
        guard Set(priorIDs).isDisjoint(with: Set(ids)), priorIDs.count + ids.count <= 128 else { throw OS1Error.message("Schedule checker obligation collision") }
        let checker = Data(program(file: file, source: bytes, sourceSHA256: sourceHash, prior: prior).utf8)
        guard checker.count <= 256_000 else { throw OS1Error.message("Schedule checker composition oversized") }
        let now = Date(), hash = TaskQualityEvidence.digest(checker)
        var c = prepared?.envelope.contract ?? TaskQualityEvidence.Contract(basis: .declaredTrustedContract,
            objectiveSHA256: TaskQualityEvidence.digest(Data(objective.utf8)), contextSHA256: contextSHA256,
            sourceSHA256: sourceSHA256, startTreeSHA256: startTreeSHA256, scope: .readOnly, verifierCodeSHA256: hash,
            referencePolicySHA256: referencePolicySHA256, requiredCheckIDs: [], fullCoverage: false,
            referenceProfiles: [], reference: nil, issuedAt: now, validUntil: now.addingTimeInterval(86_400))
        c.verifierCodeSHA256 = hash; c.requiredCheckIDs = priorIDs + ids
        let envelope = PreparedTaskQuality.Envelope(contract: c, checkerSHA256: hash,
            timeoutSeconds: prepared?.envelope.timeoutSeconds ?? 10,
            workspacePaths: Array(Set((prepared?.envelope.workspacePaths ?? []) + [file])).sorted(),
            localEffectsOnly: prepared?.envelope.localEffectsOnly ?? false)
        return PreparedTaskQuality(envelope: envelope, checkerBytes: checker, referencePolicySHA256: referencePolicySHA256, resourceScheduleSnapshot: snapshot)
    }
    static func program(file: String, source: Data, sourceSHA256: String, prior: Data) -> String {
        // Values are encoded, never interpolated as Python code/instructions.
        let path64 = Data(file.utf8).base64EncodedString(), source64 = source.base64EncodedString(), prior64 = prior.base64EncodedString()
        return #"""
# os1-source-bound-resource-schedule-partial-v1
import base64,contextlib,hashlib,io,json,pathlib,sys
SOURCE=base64.b64decode('\#(source64)')
SOURCE_SHA='\#(sourceSHA256)'
FILE=base64.b64decode('\#(path64)').decode('utf8')
PRIOR=base64.b64decode('\#(prior64)')
def pairs(xs):
 d={}
 for k,v in xs:
  if k in d:raise ValueError('duplicate key')
  d[k]=v
 return d
def parsed(s):return json.loads(s,object_pairs_hook=pairs)
payload=parsed(pathlib.Path(sys.argv[1]).read_text(encoding='utf8'))
rows=[]
if PRIOR:
 capture=io.StringIO()
 try:
  with contextlib.redirect_stdout(capture):
   exec(compile(PRIOR,'frozen-owner-checker','exec'),{'__name__':'__main__','__file__':'frozen-owner-checker'})
 except SystemExit as e:
  if e.code not in (None,0):raise
 text=capture.getvalue()
 if len(text.encode())>128000:raise ValueError('owner checker output oversized')
 rows=parsed(text)
 if type(rows)is not list or any(type(r)is not dict or r.get('status')not in ['passed','failed']for r in rows):raise ValueError('owner checker receipt unavailable')
def add(suffix,value):rows.append({'checkID':'partial.schedule.'+suffix,'status':'passed'if value else'failed','score':1.0 if value else 0.0,'observedReceiptSHA256':None})
p=parsed(SOURCE)
f=pathlib.Path(payload['workspace'])/FILE
source_ok=f.is_file()and not f.is_symlink()and f.stat().st_nlink==1 and hashlib.sha256(f.read_bytes()).hexdigest()==SOURCE_SHA
if not source_ok:raise ValueError('frozen schedule source identity changed')
add('source',True)
try:
 text=payload['output']
 a=parsed(text)if type(text)is str and len(text.encode())<=65536 else None
 shape=type(a)is dict and set(a)=={'project','version','schedule'}
except Exception:a=None;shape=False
add('shape',shape)
add('identity',shape and a['project']==p['project']and a['version']==p['version'])
ts={t['id']:t for t in p['tasks']}
rs=a['schedule']if shape else None
valid=type(rs)is list and len(rs)==len(ts)and all(type(r)is dict and set(r)=={'task_id','start'}and type(r['task_id'])is str and r['task_id']in ts and type(r['start'])is int and 0<=r['start']<=p['horizon']for r in rs)
valid=valid and len({r['task_id']for r in rs})==len(ts)
add('tasks',valid)
starts={r['task_id']:r['start']for r in rs}if valid else{}
add('release',valid and all(starts[k]>=t['release']for k,t in ts.items()))
add('deadline',valid and all(starts[k]+t['duration']<=min(t['deadline'],p['horizon'])for k,t in ts.items()))
add('dependencies',valid and all(starts[d]+ts[d]['duration']<=starts[k]for k,t in ts.items()for d in t['depends']))
# Independent event sweep: end events precede start events at the same time.
capacity=valid
if valid:
 for resource,cap in p['resources'].items():
  events=[]
  for key,t in ts.items():
   amount=t['requires'].get(resource,0);events.extend([(starts[key],1,amount),(starts[key]+t['duration'],0,-amount)])
  used=0
  for _,_,delta in sorted(events):
   used+=delta
   if used>cap:capacity=False
add('capacity',capacity)
print(json.dumps(rows,separators=(',',':')))
"""#
    }
}

private struct TaskQualityCheckerInput: Codable {
    let contract: TaskQualityEvidence.Contract
    let binding: TaskQualityEvidence.Binding
    let workspace: String
    let output: String
    let candidateWorkspace: String?
}

/// A narrow existing-recipe acquisition, not inferred full task coverage.
/// Only Python source in already present package roots plus tests is copied.
struct PythonRegressionSnapshot: Codable {
    let allowedRoots: [String]
    let originalTests: [String: Data]
    let recipeSHA256: String
    /// Nil decodes the exact historical package-only copy/discovery policy.
    let discoveryVersion: Int?
    init(allowedRoots: [String], originalTests: [String: Data], recipeSHA256: String, discoveryVersion: Int? = nil) {
        self.allowedRoots = allowedRoots; self.originalTests = originalTests
        self.recipeSHA256 = recipeSHA256; self.discoveryVersion = discoveryVersion
    }

    static func acquire(workspace: String) throws -> Self? {
        let fm = FileManager.default, root = URL(fileURLWithPath: workspace).standardizedFileURL
        guard root.resolvingSymlinksInPath() != fm.homeDirectoryForCurrentUser.resolvingSymlinksInPath(),
              !root.path.lowercased().contains("handy"),
              let rootAttrs = try? fm.attributesOfItem(atPath: root.path),
              rootAttrs[.type] as? FileAttributeType == .typeDirectory,
              (rootAttrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              ((rootAttrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0 else { return nil }
        let readme = root.appendingPathComponent("README.md")
        guard let attr = try? fm.attributesOfItem(atPath: readme.path), attr[.type] as? FileAttributeType == .typeRegular,
              (attr[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              ((attr[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0,
              (attr[.referenceCount] as? NSNumber)?.intValue == 1,
              (attr[.size] as? NSNumber)?.intValue ?? Int.max <= 128_000,
              let bytes = try? Data(contentsOf: readme), let text = String(data: bytes, encoding: .utf8),
              text.range(of: #"(?m)^\s*python3 -m unittest(?: -v)?\s*$"#, options: .regularExpression) != nil else { return nil }
        let children = try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        var roots: [String] = []
        for child in children {
            let name = child.lastPathComponent
            guard !name.lowercased().contains("handy"), !["venv", "node_modules", "auth", "oauth", "credentials", "keychain", "logs", "sessions"].contains(name.lowercased()) else { continue }
            let attrs = try fm.attributesOfItem(atPath: child.path)
            if name.hasPrefix("test"), name.hasSuffix(".py"),
               name.range(of: #"^test[A-Za-z0-9_]{0,60}\.py$"#, options: .regularExpression) == nil { return nil }
            if name.range(of: #"^[A-Za-z_][A-Za-z0-9_]{0,63}\.py$"#, options: .regularExpression) != nil {
                guard attrs[.type] as? FileAttributeType == .typeRegular else { return nil }
                roots.append(name)
            } else if name.range(of: #"^[A-Za-z_][A-Za-z0-9_]{0,63}$"#, options: .regularExpression) != nil,
                      name == "tests" || fm.fileExists(atPath: child.appendingPathComponent("__init__.py").path) {
                guard attrs[.type] as? FileAttributeType == .typeDirectory else { return nil }
                roots.append(name)
            }
        }
        guard !roots.isEmpty, roots.count <= 16 else { return nil }
        let paths = try pythonPaths(workspace: workspace, allowedRoots: roots, strictCustody: true)
        let sourcePaths = Set(paths), discovered = paths.filter(isDiscoveryTest)
        guard !discovered.isEmpty,
              discovered.allSatisfy({ !$0.contains("/") || $0.hasPrefix("tests/") }) else { return nil }
        // Standard unittest discovery recurses importable packages, not an
        // arbitrary directory tree. Do not silently ignore a mixed suite.
        for path in discovered {
            let components = path.split(separator: "/").dropLast()
            var prefix: [Substring] = []
            for part in components {
                prefix.append(part)
                guard sourcePaths.contains(prefix.joined(separator: "/") + "/__init__.py") else { return nil }
            }
        }
        var tests: [String: Data] = [:]
        for path in paths where isTestSourcePath(path) { tests[path] = try Data(contentsOf: root.appendingPathComponent(path)) }
        return Self(allowedRoots: roots.sorted(), originalTests: tests, recipeSHA256: TaskQualityEvidence.digest(bytes), discoveryVersion: 1)
    }

    private static func isDiscoveryTest(_ path: String) -> Bool {
        let name = URL(fileURLWithPath: path).lastPathComponent
        return name.hasPrefix("test") && name.hasSuffix(".py")
    }
    private static func isTestSourcePath(_ path: String) -> Bool {
        path.hasPrefix("tests/") || isDiscoveryTest(path)
    }
    func isTestSource(_ path: String) -> Bool {
        discoveryVersion == nil ? path.hasPrefix("tests/") : Self.isTestSourcePath(path)
    }

    func candidatePaths(workspace: String) throws -> [String] {
        if discoveryVersion == nil { return try Self.pythonPaths(workspace: workspace, allowedRoots: allowedRoots) }
        guard discoveryVersion == 1 else { throw OS1Error.message("Unsupported partial unittest discovery policy") }
        let root = URL(fileURLWithPath: workspace).standardizedFileURL
        // The fixed standard-discovery pattern declares this candidate-only
        // expansion before dispatch; candidate tests never become originals.
        let addedTests = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil).map(\.lastPathComponent).filter {
            $0.hasPrefix("test") && $0.hasSuffix(".py")
        }
        guard addedTests.allSatisfy({ $0.range(of: #"^test[A-Za-z0-9_]{0,60}\.py$"#, options: .regularExpression) != nil }) else {
            throw OS1Error.message("Partial unittest candidate has an unsupported test module name")
        }
        let roots = Set(allowedRoots + addedTests).sorted()
        guard roots.count <= 16 else { throw OS1Error.message("Partial unittest candidate exceeds bounded project-root budget") }
        return try Self.pythonPaths(workspace: workspace, allowedRoots: roots, strictCustody: true)
    }

    private static func pythonPaths(workspace: String, allowedRoots: [String], strictCustody: Bool = false) throws -> [String] {
        let fm = FileManager.default, root = URL(fileURLWithPath: workspace).standardizedFileURL
        if strictCustody {
            let rootAttrs = try fm.attributesOfItem(atPath: root.path)
            guard rootAttrs[.type] as? FileAttributeType == .typeDirectory,
                  (rootAttrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
                  ((rootAttrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0 else {
                throw OS1Error.message("Partial unittest project-root custody is unavailable")
            }
        }
        var paths: [String] = [], total = 0
        func visit(_ url: URL, depth: Int) throws {
            guard depth <= 4 else { throw OS1Error.message("Partial unittest source exceeds depth bound") }
            let attrs = try fm.attributesOfItem(atPath: url.path), type = attrs[.type] as? FileAttributeType
            guard type == .typeRegular || type == .typeDirectory,
                  url.resolvingSymlinksInPath().path.hasPrefix(root.resolvingSymlinksInPath().path + "/") else {
                throw OS1Error.message("Partial unittest source contains a symlink or non-project artifact")
            }
            if type == .typeDirectory {
                guard !strictCustody || ((attrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() &&
                      ((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0) else {
                    throw OS1Error.message("Partial unittest source directory custody is unavailable")
                }
                for child in try fm.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) {
                    let name = child.lastPathComponent
                    guard !name.hasPrefix("."), !name.lowercased().contains("handy"),
                          !["__pycache__", "node_modules", "venv", "auth", "oauth", "credentials", "keychain", "logs", "sessions"].contains(name.lowercased()) else { continue }
                    if child.pathExtension == "py" || (try? fm.attributesOfItem(atPath: child.path)[.type] as? FileAttributeType) == .typeDirectory {
                        try visit(child, depth: depth + 1)
                    }
                }
            } else if url.pathExtension == "py" {
                guard !strictCustody || ((attrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid() &&
                      ((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0 &&
                      (attrs[.referenceCount] as? NSNumber)?.intValue == 1) else {
                    throw OS1Error.message("Partial unittest source ownership or link custody is unavailable")
                }
                let size = (attrs[.size] as? NSNumber)?.intValue ?? Int.max
                guard size >= 0, size <= 256_000, total <= 2_000_000 - size, paths.count < 128 else {
                    throw OS1Error.message("Partial unittest source exceeds bounded Python-file budget")
                }
                total += size
                // FM may spell a child /private/var while root is /var. Use
                // the same normalized path that passed the containment guard.
                paths.append(String(url.resolvingSymlinksInPath().path.dropFirst(root.resolvingSymlinksInPath().path.count + 1)))
            }
        }
        for path in allowedRoots {
            let source = root.appendingPathComponent(path)
            if fm.fileExists(atPath: source.path) { try visit(source, depth: 0) }
        }
        return paths.sorted()
    }

    func checkerBytes() throws -> Data {
        guard discoveryVersion == nil || discoveryVersion == 1 else { throw OS1Error.message("Unsupported partial unittest discovery policy") }
        let policy = discoveryVersion == 1 ? "FROZEN_DISCOVERY_POLICY = 'canonical-tests-package-and-flat-test-modules-v1'\n" : ""
        let hashes = originalTests.mapValues { TaskQualityEvidence.digest($0) }
        let encoded = try JSONSerialization.data(withJSONObject: hashes, options: [.sortedKeys, .withoutEscapingSlashes])
        let preamble = "FROZEN_TEST_SHA256 = " + String(decoding: encoded, as: UTF8.self) + "\nFROZEN_RECIPE_SHA256 = '" + recipeSHA256 + "'\n"
        let runner = #"""
import hashlib,json,pathlib,re,subprocess,sys
x=json.load(open(sys.argv[1]))
def suite(check_id,workspace,original=False):
    w=pathlib.Path(workspace)
    identities={str(p.relative_to(w)):hashlib.sha256(p.read_bytes()).hexdigest() for p in w.rglob('*.py')}
    if original and any(identities.get(p)!=h for p,h in FROZEN_TEST_SHA256.items()):
        return {'checkID':check_id,'status':'unverified','score':None,'reason':'frozen_original_test_identity_mismatch','files':identities}
    r=subprocess.run([sys.executable,'-I','-m','unittest','-v'],cwd=w,capture_output=True,text=True,timeout=35)
    summary=re.findall(r'(?m)^Ran (\d+) tests? in [0-9.]+s\s*$',r.stderr)
    count=int(summary[-1]) if summary else 0
    failures=re.findall(r'(?m)^FAILED \([^\n]*failures=(\d+)[^\n]*\)\s*$',r.stderr)
    setup=('_FailedTest' in r.stderr or 'Failed to import test module' in r.stderr or 'ModuleNotFoundError' in r.stderr)
    if r.returncode==1 and count>0 and failures and int(failures[-1])>0:
        status='failed'; reason='observed_unittest_assertion_failure'
    elif r.returncode==0 and count>0 and re.search(r'(?m)^OK(?: \([^\n]*\))?\s*$',r.stderr) and not setup:
        status='passed'; reason='observed_partial_unittest_pass_not_full_task_or_reference_proof'
    else:
        status='unverified'; reason='unittest_setup_import_missing_tests_or_nonstandard_result'
    return {'checkID':check_id,'status':status,'score':None,'reason':reason,'testsRun':count,'exitCode':r.returncode,
        'files':identities,'originalRecipeSHA256':FROZEN_RECIPE_SHA256,'stdout':r.stdout[-12000:],'stderr':r.stderr[-24000:]}
results=[]
for check_id,workspace,original in [('partial.original_unittest',x['workspace'],True),('partial.candidate_unittest',x['candidateWorkspace'],False)]:
    try: results.append(suite(check_id,workspace,original))
    except Exception as e: results.append({'checkID':check_id,'status':'unverified','score':None,'reason':'bounded_unittest_unavailable','error':str(e)[:2000]})
print(json.dumps(results))
"""#
        return Data((policy + preamble + runner).utf8)
    }
}

/// Xcode's hosted macOS runners use versioned app names. The selected
/// developer directory is the authority; a matching path under some other
/// Xcode installation is not. Resolve symlinks before approving the tool.
private func approvedDeveloperPythonRoot(developer: String, selected: String, resolved: String) -> String? {
    let rawRoot = URL(fileURLWithPath: developer).standardizedFileURL.path
    let canonicalRoot = URL(fileURLWithPath: rawRoot).resolvingSymlinksInPath().standardizedFileURL.path
    let xcodeRoot = #"^/Applications/Xcode(?:_[0-9]+(?:\.[0-9]+){0,3})?\.app/Contents/Developer$"#
    let approved = { (path: String) in
        path == "/Library/Developer/CommandLineTools" || path.range(of: xcodeRoot, options: .regularExpression) != nil
    }
    guard approved(rawRoot), approved(canonicalRoot) else { return nil }
    let selectedPath = URL(fileURLWithPath: selected).standardizedFileURL.path
    guard selectedPath == rawRoot + "/usr/bin/python3" || selectedPath == canonicalRoot + "/usr/bin/python3" else { return nil }
    let actualSelected = URL(fileURLWithPath: selectedPath).resolvingSymlinksInPath().standardizedFileURL.path
    guard actualSelected == resolved, resolved.hasPrefix(canonicalRoot + "/") else { return nil }
    return canonicalRoot
}

private func copiedPythonRegressionLaunch(runRoot: URL, checker: URL, input: URL) throws -> (String, [String]) {
    guard FileManager.default.isExecutableFile(atPath: "/usr/bin/sandbox-exec") else {
        throw OS1Error.message("Partial unittest copied-artifact isolation is unavailable")
    }
    func quote(_ value: String) -> String { "\"" + value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }
    // /usr/bin/python3 is an Apple shim. Its selected-tool lookup was observed
    // denied at /var/select/developer_dir; resolve that fixed tool before the
    // sandbox instead of exposing selection caches or HOME to project code.
    let discovery = try commandOutput("/usr/bin/xcrun", ["--find", "python3"], timeout: 15)
    guard discovery.0 == 0 else { throw OS1Error.message("Approved system Python metadata is unavailable") }
    let developerDiscovery = try commandOutput("/usr/bin/xcode-select", ["-p"], timeout: 15)
    guard developerDiscovery.0 == 0 else { throw OS1Error.message("Selected Apple developer directory is unavailable") }
    let developer = String(decoding: developerDiscovery.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let selected = String(decoding: discovery.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let resolved = URL(fileURLWithPath: selected).standardizedFileURL.resolvingSymlinksInPath().path
    guard let developerRoot = approvedDeveloperPythonRoot(developer: developer, selected: selected, resolved: resolved),
          FileManager.default.isExecutableFile(atPath: resolved) else {
        throw OS1Error.message("Partial unittest interpreter is not the approved system/developer Python")
    }
    // The approved bin/python launcher itself performs a denied realpath/
    // re-exec. The same SDK's native interpreter was measured inside this
    // strict profile (not a new backend or a wider filesystem allowance).
    let native = URL(fileURLWithPath: resolved).deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("Resources/Python.app/Contents/MacOS/Python")
    let python: String
    if resolved.contains("/Python3.framework/Versions/"), FileManager.default.isExecutableFile(atPath: native.path) {
        python = native.standardizedFileURL.resolvingSymlinksInPath().path
    } else { python = resolved }
    guard python.hasPrefix(developerRoot + "/") else {
        throw OS1Error.message("Native partial unittest interpreter escaped its approved SDK")
    }
    let scratch = runRoot.path
    let selectedSDK = developerRoot == "/Library/Developer/CommandLineTools"
        ? "/Library/Developer/CommandLineTools"
        : URL(fileURLWithPath: developerRoot).deletingLastPathComponent().deletingLastPathComponent().path
    let readable = [scratch, "/System", "/usr/bin", "/usr/lib", "/usr/share", selectedSDK, "/Library/Developer", "/private/etc", "/dev"]
    // realpath needs metadata on known ancestors (observed Xcode/bin EPERM).
    // Literals reveal no sibling/HOME contents and grant no directory data.
    var ancestorMetadata = Set<String>()
    for known in [selected, python, scratch] {
        var parent = URL(fileURLWithPath: known).deletingLastPathComponent()
        while parent.path != "/" && !parent.path.isEmpty {
            ancestorMetadata.insert(parent.path); parent.deleteLastPathComponent()
        }
    }
    let profile = "(version 1) (deny default) (allow process-fork) (allow sysctl-read) "
        // Observed dyld CacheFinder directory-open dependency (PID 86869).
        // Exact / directory only: no subpath, HOME, network or write grant.
        + "(allow file-read-data (literal \"/\")) "
        + "(allow file-read-metadata " + ancestorMetadata.sorted().map { "(literal " + quote($0) + ")" }.joined(separator: " ") + ") "
        + "(allow process-exec (literal " + quote(python) + ")) "
        + "(allow file-read* " + readable.map { "(subpath " + quote($0) + ")" }.joined(separator: " ") + ") "
        + "(allow file-write* (subpath " + quote(scratch) + ") (literal \"/dev/null\"))"
    return ("/usr/bin/sandbox-exec", ["-p", profile, python, "-I", checker.path, input.path])
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
    let fields = ["os1-task-quality-reference-v1", "codex:gpt-6-astra:ultra", "claude:claude-fable-5-1:max",
                  config.executorContract.sha256, OwnerPolicyContext.snapshot?.sourceSHA256 ?? "no-owner-policy",
                  OwnerPolicyContext.snapshot?.projectionSHA256 ?? "no-owner-projection"]
    return TaskQualityEvidence.digest(Data(fields.joined(separator: "\n").utf8))
}

/// Existing os1 self-test coverage. Local deterministic fixtures only: no model,
/// network, live registry, account credential or user worktree is involved.
func taskQualityRuntimeSelfTest() throws {
    try resourceScheduleSupplementSelfTest()
    try resourceScheduleOwnerCompositionSelfTest()
    try pythonRegressionLayoutSelfTest()
    let fm = FileManager.default
    let versionedDeveloper = "/Applications/Xcode_16.4.app/Contents/Developer"
    let canonicalVersionedDeveloper = URL(fileURLWithPath: versionedDeveloper).resolvingSymlinksInPath().standardizedFileURL.path
    let versionedTool = versionedDeveloper + "/usr/bin/python3"
    let versionedResolved = URL(fileURLWithPath: versionedTool).resolvingSymlinksInPath().standardizedFileURL.path
    guard approvedDeveloperPythonRoot(developer: versionedDeveloper, selected: versionedTool,
                                      resolved: versionedResolved) == canonicalVersionedDeveloper,
          approvedDeveloperPythonRoot(developer: versionedDeveloper, selected: "/usr/bin/python3",
                                      resolved: "/usr/bin/python3") == nil,
          approvedDeveloperPythonRoot(developer: versionedDeveloper, selected: versionedTool,
                                      resolved: "/opt/homebrew/bin/python3") == nil,
          approvedDeveloperPythonRoot(developer: "/Applications/XcodeFake.app/Contents/Developer",
                                      selected: "/Applications/XcodeFake.app/Contents/Developer/usr/bin/python3",
                                      resolved: "/Applications/XcodeFake.app/Contents/Developer/usr/bin/python3") == nil else {
        throw OS1Error.message("Partial unittest selected-developer interpreter identity regression")
    }
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
    // The production fallback acquires a real pre-existing stdlib recipe and
    // freezes the original checks before a simulated candidate changes them.
    let python = root.appendingPathComponent("python-project")
    try fm.createDirectory(at: python.appendingPathComponent("sample"), withIntermediateDirectories: true)
    try fm.createDirectory(at: python.appendingPathComponent("tests"), withIntermediateDirectories: true)
    let module = python.appendingPathComponent("sample/__init__.py")
    let originalTest = python.appendingPathComponent("tests/test_original.py")
    let addedTest = python.appendingPathComponent("tests/test_added.py")
    try Data("```sh\npython3 -m unittest -v\n```\n".utf8).write(to: python.appendingPathComponent("README.md"))
    try Data("value = 2\n".utf8).write(to: module)
    try Data().write(to: python.appendingPathComponent("tests/__init__.py"))
    let originalBytes = Data("import unittest\nfrom sample import value\nclass Original(unittest.TestCase):\n def test_value(self): self.assertEqual(value,2)\n".utf8)
    try originalBytes.write(to: originalTest)
    let pythonObjective = "Implement the requested change and run the regression tests."
    let pythonTree = observedStateHash(python.path)
    guard let partial = try PreparedTaskQuality.prepare(objective: pythonObjective, contextSHA256: h,
        sourceSHA256: nil, startTreeSHA256: pythonTree, scope: .workspaceWrite, referencePolicySHA256: h,
        workspace: python.path, rootURL: root.appendingPathComponent("no-registered-contract")),
        !partial.envelope.contract.fullCoverage, partial.envelope.contract.reference == nil else {
        throw OS1Error.message("Partial existing unittest recipe was not acquired or invented full coverage")
    }
    func pythonAssessment() throws -> TaskQualityEvidence.Evaluation {
        let candidate = Artifact(provider: "codex", action: "fixture", permissionProfile: "workspace_write", model: "fixture",
            effort: "low", executorContractVersion: "fixture", executorContractSHA256: h,
            exitCode: 0, output: "Native completion and a claimed test pass cannot certify this task.", stderr: "", durationMS: 1,
            workspaceBeforeHash: pythonTree, workspaceAfterHash: observedStateHash(python.path),
            nativeRecord: NativeRecordEvidence(turnID: UUID().uuidString, recordPath: nil, persistence: "verified", desktopVisibility: "fixture"))
        let evaluation = try partial.evaluate(artifact: candidate, artifactSHA256: TaskQualityEvidence.digest(try encoder.encode(candidate)),
            contextSHA256: h, workspace: python.path, executionID: UUID().uuidString, runsRoot: root)
        if evaluation.reason.contains("infrastructure/receipt unavailable") {
            let runs = try fm.contentsOfDirectory(at: root.appendingPathComponent("runs"), includingPropertiesForKeys: nil)
            let latest = runs.max { lhs, rhs in
                let a = (try? fm.attributesOfItem(atPath: lhs.path)[.creationDate] as? Date) ?? .distantPast
                let b = (try? fm.attributesOfItem(atPath: rhs.path)[.creationDate] as? Date) ?? .distantPast
                return a < b
            }
            if let latest {
                let retained = fm.temporaryDirectory.appendingPathComponent("os1-quality-infrastructure-" + UUID().uuidString)
                try fm.copyItem(at: latest, to: retained)
                print("Partial unittest fixture raw infrastructure receipt retained: \(retained.path)")
            }
        }
        return evaluation
    }
    // Original tests pass, but a newly delivered candidate regression fails.
    try Data("import unittest\nclass Added(unittest.TestCase):\n def test_new(self): self.assertEqual(1,2)\n".utf8).write(to: addedTest)
    let addedFailure = try pythonAssessment()
    if addedFailure.reason.contains("infrastructure/receipt unavailable") {
        guard addedFailure.state == .unverified, addedFailure.failedCheckIDs.isEmpty,
              addedFailure.preservesArtifact, !addedFailure.referenceParityVerified else {
            throw OS1Error.message("Unavailable copied checker fabricated mismatch, deletion, or parity")
        }
        print("OS-1 partial unittest infrastructure: launcher unavailable in this parent environment; raw receipt retained, typed unverified PASS; actual copied-suite failure veto NOT VERIFIED")
        return
    }
    guard addedFailure.state == .mismatch, addedFailure.failedCheckIDs == ["partial.candidate_unittest"] else {
        throw OS1Error.message("Original-suite pass washed a delivered candidate-suite failure: \(addedFailure)")
    }
    try fm.removeItem(at: addedTest)
    // Model weakens the visible assertion; the frozen original still rejects.
    try Data("value = 3\n".utf8).write(to: module)
    try Data("import unittest\nfrom sample import value\nclass Original(unittest.TestCase):\n def test_value(self): self.assertEqual(value,3)\n".utf8).write(to: originalTest)
    let weakened = try pythonAssessment()
    guard weakened.state == .mismatch, weakened.failedCheckIDs == ["partial.original_unittest"],
          try Data(contentsOf: module) == Data("value = 3\n".utf8) else {
        throw OS1Error.message("Model-updated tests replaced original checker authority or original workspace changed")
    }
    // Retry binds its new context/tree but cannot promote model-rewritten
    // tests to original authority. The host carries one read-only snapshot.
    let retryTree = observedStateHash(python.path)
    guard let retried = try PreparedTaskQuality.prepare(objective: pythonObjective, contextSHA256: h,
        sourceSHA256: nil, startTreeSHA256: retryTree, scope: .workspaceWrite, referencePolicySHA256: h,
        workspace: python.path, frozenRegression: partial.frozenRegressionSnapshot, allowRegressionAcquisition: false,
        rootURL: root.appendingPathComponent("no-registered-contract")) else {
        throw OS1Error.message("Retry lost first original-test custody")
    }
    let retryArtifact = Artifact(provider: "codex", action: "fixture", permissionProfile: "workspace_write", model: "fixture",
        effort: "low", executorContractVersion: "fixture", executorContractSHA256: h, exitCode: 0,
        output: "Retry prose cannot change checker provenance", stderr: "", durationMS: 1,
        workspaceBeforeHash: retryTree, workspaceAfterHash: observedStateHash(python.path),
        nativeRecord: NativeRecordEvidence(turnID: UUID().uuidString, recordPath: nil, persistence: "verified", desktopVisibility: "fixture"))
    let retryFailure = try retried.evaluate(artifact: retryArtifact,
        artifactSHA256: TaskQualityEvidence.digest(try encoder.encode(retryArtifact)), contextSHA256: h,
        workspace: python.path, executionID: UUID().uuidString, runsRoot: root)
    guard retryFailure.state == .mismatch, retryFailure.failedCheckIDs == ["partial.original_unittest"],
          try PreparedTaskQuality.prepare(objective: pythonObjective, contextSHA256: h, sourceSHA256: nil,
              startTreeSHA256: retryTree, scope: .workspaceWrite, referencePolicySHA256: h, workspace: python.path,
              allowRegressionAcquisition: false, rootURL: root.appendingPathComponent("no-registered-contract")) == nil else {
        throw OS1Error.message("Retry reacquired model-authored tests as original authority")
    }
    try fm.removeItem(at: originalTest)
    guard try pythonAssessment().state == .mismatch else { throw OS1Error.message("Deleted visible tests bypassed frozen-original failure") }
    try Data("value = 2\n".utf8).write(to: module); try originalBytes.write(to: originalTest)
    let partialPass = try pythonAssessment()
    guard partialPass.state == .unverified, !partialPass.referenceParityVerified else {
        throw OS1Error.message("Partial suite pass fabricated complete task coverage or reference parity")
    }
    // An actually failed copied-suite witness authorizes one continuation of
    // the completed candidate, not a replay or a model-authored acceptance test.
    let sourcePath = python.appendingPathComponent("README.md")
    let sourceBytes = try Data(contentsOf: sourcePath)
    let sourceSHA = TaskQualityEvidence.digest(sourceBytes)
    let correctionStartTree = observedStateHash(python.path)
    guard let correctionPrepared = try PreparedTaskQuality.prepare(objective: pythonObjective,
        contextSHA256: h, sourceSHA256: sourceSHA, startTreeSHA256: correctionStartTree,
        scope: .workspaceWrite, referencePolicySHA256: h, workspace: python.path,
        frozenRegression: partial.frozenRegressionSnapshot, allowRegressionAcquisition: false,
        rootURL: root.appendingPathComponent("no-registered-contract")) else {
        throw OS1Error.message("Correction lost original frozen unittest custody")
    }
    let rejectedSourceBytes = Data("value = 3\n".utf8)
    try rejectedSourceBytes.write(to: module)
    let failedWriter = Artifact(provider: "codex", action: "fixture_completed_writer", permissionProfile: "workspace_write",
        model: "fixture", effort: "low", executorContractVersion: "fixture", executorContractSHA256: h,
        exitCode: 0, output: "Completed local candidate; checker must decide, not this prose.", stderr: "", durationMS: 1,
        workspaceBeforeHash: correctionStartTree, workspaceAfterHash: observedStateHash(python.path),
        nativeRecord: NativeRecordEvidence(turnID: UUID().uuidString, recordPath: nil, persistence: "verified", desktopVisibility: "fixture"))
    let failedWriterBytes = try encoder.encode(failedWriter)
    let failedWriterSHA = TaskQualityEvidence.digest(failedWriterBytes)
    let failedWriterPath = root.appendingPathComponent("correction-rejected-artifact.json")
    let failedSourcePath = root.appendingPathComponent("correction-rejected-module.py")
    try failedWriterBytes.write(to: failedWriterPath, options: .withoutOverwriting)
    try rejectedSourceBytes.write(to: failedSourcePath, options: .withoutOverwriting)
    for path in [failedWriterPath, failedSourcePath] {
        try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
    let failedWitness = try correctionPrepared.evaluateWithWitness(artifact: failedWriter, artifactSHA256: failedWriterSHA,
        contextSHA256: h, workspace: python.path, executionID: UUID().uuidString, runsRoot: root)
    let boundary = TaskQualityCorrection.Boundary(ownerObjective: pythonObjective, workspace: python.path,
        scope: .workspaceWrite, sourceSHA256: sourceSHA, referencePolicySHA256: h)
    let correction = TaskQualityCorrection.decide(contract: failedWitness.contract, receipt: failedWitness.receipt,
        artifact: failedWitness.artifact, evaluation: failedWitness.assessment, boundary: boundary,
        currentWorkspace: python.path, currentWorkspaceSHA256: observedStateHash(python.path),
        currentSourceSHA256: TaskQualityEvidence.digest(try Data(contentsOf: sourcePath)), exitCode: 0, cancelled: false)
    guard failedWitness.assessment.state == .mismatch,
          failedWitness.assessment.failedCheckIDs == ["partial.original_unittest", "partial.candidate_unittest"],
          correction.action == .correct, correction.nextBudget.correctiveAttempts == 1,
          correction.failedArtifactSHA256 == failedWriterSHA, correction.preservesFailedArtifact,
          !correction.grantsReferenceParity else {
        throw OS1Error.message("Actual failed writer witness did not authorize exactly one bounded preserved correction")
    }
    let correctionInput = TaskQualityCorrection.prompt(objective: pythonObjective,
        failedCheckIDs: correction.failedCheckIDs, artifactSHA256: failedWriterSHA)
    let continuationSHA = TaskQualityEvidence.digest(Data(("fixture-context\n" + correctionInput).utf8))
    let continuation = correctionPrepared.reboundForContinuation(contextSHA256: continuationSHA,
        startTreeSHA256: failedWriter.workspaceAfterHash)
    guard continuation.envelope.contract.objectiveSHA256 == failedWitness.contract.objectiveSHA256,
          continuation.envelope.contract.sourceSHA256 == sourceSHA,
          continuation.envelope.contract.contextSHA256 == continuationSHA,
          continuation.envelope.contract.startTreeSHA256 == failedWriter.workspaceAfterHash,
          continuation.envelope.contract.requiredCheckIDs == failedWitness.contract.requiredCheckIDs,
          continuation.envelope.contract.verifierCodeSHA256 == failedWitness.contract.verifierCodeSHA256,
          continuation.checkerBytes == correctionPrepared.checkerBytes,
          continuation.frozenRegressionSnapshot?.originalTests == correctionPrepared.frozenRegressionSnapshot?.originalTests,
          !continuation.envelope.contract.fullCoverage, continuation.envelope.contract.reference == nil else {
        throw OS1Error.message("Continuation rebind changed frozen checker, original source, coverage or reference authority")
    }
    try Data("value = 2\n".utf8).write(to: module)
    let correctedWriter = Artifact(provider: "codex", action: "fixture_corrective_continuation", permissionProfile: "workspace_write",
        model: "fixture", effort: "low", executorContractVersion: "fixture", executorContractSHA256: h,
        exitCode: 0, output: "Corrected only the known failed module; original tests unchanged.", stderr: "", durationMS: 1,
        workspaceBeforeHash: failedWriter.workspaceAfterHash, workspaceAfterHash: observedStateHash(python.path),
        nativeRecord: NativeRecordEvidence(turnID: UUID().uuidString, recordPath: nil, persistence: "verified", desktopVisibility: "fixture"))
    let correctedWriterSHA = TaskQualityEvidence.digest(try encoder.encode(correctedWriter))
    let correctedWitness = try continuation.evaluateWithWitness(artifact: correctedWriter, artifactSHA256: correctedWriterSHA,
        contextSHA256: continuationSHA, workspace: python.path, executionID: UUID().uuidString, runsRoot: root)
    let terminalCorrection = TaskQualityCorrection.decide(contract: correctedWitness.contract, receipt: correctedWitness.receipt,
        artifact: correctedWitness.artifact, evaluation: correctedWitness.assessment, boundary: boundary,
        currentWorkspace: python.path, currentWorkspaceSHA256: observedStateHash(python.path), currentSourceSHA256: sourceSHA,
        exitCode: 0, cancelled: false, budget: correction.nextBudget)
    guard correctedWitness.receipt?.checks.allSatisfy({ $0.status == .passed }) == true,
          Set(correctedWitness.receipt?.checks.map(\.checkID) ?? []) == Set(continuation.envelope.contract.requiredCheckIDs),
          correctedWitness.receipt?.binding.contextSHA256 == continuationSHA,
          correctedWitness.receipt?.binding.sourceSHA256 == sourceSHA,
          correctedWitness.receipt?.contractSHA256 == continuation.envelope.contract.sha256,
          correctedWitness.assessment.state == .unverified, correctedWitness.assessment.failedCheckIDs.isEmpty,
          !correctedWitness.assessment.referenceParityVerified, terminalCorrection.action == .none,
          correctedWriterSHA != failedWriterSHA,
          try Data(contentsOf: originalTest) == originalBytes, try Data(contentsOf: sourcePath) == sourceBytes,
          try Data(contentsOf: failedWriterPath) == failedWriterBytes,
          try Data(contentsOf: failedSourcePath) == rejectedSourceBytes else {
        throw OS1Error.message("Bounded correction lost failed custody, weakened original tests, or promoted a partial pass to reference parity")
    }
    try Data("import missing_os1_fixture_dependency\n".utf8).write(to: originalTest)
    let missingDependency = try pythonAssessment()
    guard missingDependency.state == .unverified, missingDependency.failedCheckIDs.isEmpty else {
        throw OS1Error.message("Unittest import/setup uncertainty fabricated a task mismatch")
    }
    try originalBytes.write(to: originalTest)
    print("OS-1 task-quality runtime: copied-artifact pass/fail, raw preservation, no fabricated parity, current/legacy summary roundtrip PASS; model calls 0")
    print("OS-1 partial unittest runtime: frozen-original + actual candidate suites, added-failure veto, weakened/deleted-test + retry-custody preservation, partial-pass/setup unverified PASS; model calls 0")
    print("OS-1 quality continuation: actual failed writer witness → one correction → frozen checker/context-tree rebind → real partial-suite pass; rejected artifact preserved, no reference parity; model calls 0")
}

/// Synthetic standard-discovery layouts only; no provider or evaluation gold.
private func pythonRegressionLayoutSelfTest() throws {
    let fm = FileManager.default
    let base = fm.temporaryDirectory.appendingPathComponent("os1-unittest-layout-" + UUID().uuidString).resolvingSymlinksInPath()
    try fm.createDirectory(at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var succeeded = false, checks = 0
    defer { if succeeded { try? fm.removeItem(at: base) } else { print("Flat unittest fixture evidence retained: \(base.path)") } }
    func check(_ value: @autoclosure () throws -> Bool, _ label: String) throws {
        guard try value() else { throw OS1Error.message("Unittest layout fixture: " + label) }; checks += 1
    }
    func rejects(_ label: String, _ action: () throws -> Void) throws {
        do { try action() } catch { checks += 1; return }; throw OS1Error.message("Unittest layout fixture: " + label)
    }
    func put(_ workspace: URL, _ path: String, _ text: String) throws {
        let file = workspace.appendingPathComponent(path)
        try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Data(text.utf8).write(to: file)
    }
    let workspace = base.appendingPathComponent("flat"), contractRoot = base.appendingPathComponent("contracts-unregistered")
    try put(workspace, "README.md", "Public fixture recipe:\npython3 -m unittest -v\n")
    try put(workspace, "module.py", "VALUE = 2\n")
    try check(PythonRegressionSnapshot.acquire(workspace: workspace.path) == nil, "README without tests cannot invent a suite")
    let original = "import unittest, module\nclass T(unittest.TestCase):\n def test_value(self): self.assertEqual(module.VALUE, 2)\n"
    try put(workspace, "test_public.py", original)
    guard let flat = try PythonRegressionSnapshot.acquire(workspace: workspace.path) else { throw OS1Error.message("Unittest layout fixture: flat suite was not acquired") }
    try check(Set(flat.originalTests.keys) == ["test_public.py"] && flat.discoveryVersion == 1, "flat original exact test bytes and discovery policy frozen")
    let legacy = PythonRegressionSnapshot(allowedRoots: flat.allowedRoots, originalTests: flat.originalTests, recipeSHA256: flat.recipeSHA256)
    let legacyBytes = try JSONEncoder().encode(legacy)
    try check((try JSONSerialization.jsonObject(with: legacyBytes) as? [String: Any])?["discoveryVersion"] == nil && (try JSONDecoder().decode(PythonRegressionSnapshot.self, from: legacyBytes)).discoveryVersion == nil, "legacy nil version is omitted, not null, and decodes without upgrade")
    try check(!legacy.isTestSource("test_added.py") && legacy.isTestSource("tests/test_old.py"), "legacy original-copy filter remains tests-only")
    try check(!(try legacy.checkerBytes()).starts(with: Data("FROZEN_DISCOVERY_POLICY".utf8)) && (try flat.checkerBytes()).starts(with: Data("FROZEN_DISCOVERY_POLICY".utf8)), "new checker hash binds policy while old checker bytes have no marker")
    let byteFixture = PythonRegressionSnapshot(allowedRoots: ["tests"], originalTests: ["tests/test_old.py": Data("import unittest\n".utf8)], recipeSHA256: String(repeating: "a", count: 64))
    try check(TaskQualityEvidence.digest(try byteFixture.checkerBytes()) == "07f23156718be10aded21768ff66477367b5e94c63220acfc276fa6344877e59", "legacy checker bytes equal pre-change synthetic fixture, not merely equivalent Python")
    let unknown = PythonRegressionSnapshot(allowedRoots: flat.allowedRoots, originalTests: flat.originalTests, recipeSHA256: flat.recipeSHA256, discoveryVersion: 2)
    try rejects("unknown version rejected before copy") { _ = try unknown.candidatePaths(workspace: workspace.path) }
    try rejects("unknown version rejected before checker execution") { _ = try unknown.checkerBytes() }
    let h = TaskQualityEvidence.digest(Data("layout fixture".utf8)), objective = "Modify module.py and run the existing public regression tests."
    func prepare(_ workspace: URL) throws -> PreparedTaskQuality {
        guard let value = try PreparedTaskQuality.prepare(objective: objective, contextSHA256: h, sourceSHA256: nil,
            startTreeSHA256: observedStateHash(workspace.path), scope: .workspaceWrite, referencePolicySHA256: h,
            workspace: workspace.path, rootURL: contractRoot) else { throw OS1Error.message("Unittest layout fixture: public partial contract unavailable") }
        try check(!value.envelope.contract.fullCoverage && value.envelope.contract.reference == nil, "public suite never becomes full/reference proof")
        return value
    }
    let prepared = try prepare(workspace)
    func observe(_ prepared: PreparedTaskQuality, _ workspace: URL, _ label: String) throws -> (PreparedTaskQuality.Witness, [[String: Any]]) {
        let root = base.appendingPathComponent("observed-" + label)
        let tree = observedStateHash(workspace.path)
        let artifact = Artifact(provider: "codex", action: "synthetic-layout-fixture", permissionProfile: "workspace_write", model: "fixture",
            effort: "low", executorContractVersion: "fixture", executorContractSHA256: h, exitCode: 0,
            output: "Synthetic candidate only", stderr: "", durationMS: 1,
            workspaceBeforeHash: prepared.envelope.contract.startTreeSHA256, workspaceAfterHash: tree,
            nativeRecord: NativeRecordEvidence(turnID: "fixture", recordPath: nil, persistence: "verified", desktopVisibility: "fixture"))
        let witness = try prepared.evaluateWithWitness(artifact: artifact, artifactSHA256: TaskQualityEvidence.digest(try JSONEncoder().encode(artifact)),
            contextSHA256: h, workspace: workspace.path, executionID: UUID().uuidString, runsRoot: root)
        let runs = try fm.contentsOfDirectory(at: root.appendingPathComponent("runs"), includingPropertiesForKeys: nil)
        guard runs.count == 1 else { throw OS1Error.message("Unittest layout fixture: exact checker run identity unavailable") }
        let bytes = try Data(contentsOf: runs[0].appendingPathComponent("stdout.json"))
        return (witness, (try? JSONSerialization.jsonObject(with: bytes)) as? [[String: Any]] ?? [])
    }
    let baseline = try observe(prepared, workspace, "flat-baseline")
    if baseline.0.assessment.reason.contains("infrastructure/receipt unavailable") {
        try check(baseline.0.assessment.state == .unverified && baseline.0.assessment.failedCheckIDs.isEmpty, "infrastructure uncertainty is not known failure")
        print("Unittest layouts: acquisition \(checks) checks PASS; copied checker infrastructure unavailable; actual flat failure veto NOT VERIFIED")
        return
    }
    try check(baseline.0.assessment.state == .unverified && !baseline.0.assessment.referenceParityVerified, "flat pass stays partial/unverified")
    try check(baseline.1.count == 2 && baseline.1.allSatisfy { $0["testsRun"] as? Int == 1 && $0["status"] as? String == "passed" }, "actual standard discovery ran one original and one candidate test")
    try put(workspace, "test_added.py", "import unittest\nclass Added(unittest.TestCase):\n def test_added(self): self.assertTrue(False)\n")
    try check(try flat.candidatePaths(workspace: workspace.path).contains("test_added.py"), "candidate-added flat test captured by fixed bounded pattern")
    try check(flat.originalTests["test_added.py"] == nil, "candidate-added flat test never becomes original authority")
    try check(!(try legacy.candidatePaths(workspace: workspace.path)).contains("test_added.py"), "legacy candidate-path enumeration does not auto-upgrade")
    try check(prepared.reboundForContinuation(contextSHA256: h, startTreeSHA256: h).frozenRegressionSnapshot?.discoveryVersion == 1, "correction preserves frozen discovery policy")
    let added = try observe(prepared, workspace, "flat-added-failure")
    try check(added.0.assessment.state == .mismatch && added.0.assessment.failedCheckIDs == ["partial.candidate_unittest"], "candidate-added flat failure veto remains separate from original suite")
    try check(added.1.first { $0["checkID"] as? String == "partial.original_unittest" }?["testsRun"] as? Int == 1 && added.1.first { $0["checkID"] as? String == "partial.candidate_unittest" }?["testsRun"] as? Int == 2, "original/candidate discovery counts preserved")
    try fm.removeItem(at: workspace.appendingPathComponent("test_added.py"))
    try put(workspace, "module.py", "VALUE = 3\n")
    try put(workspace, "test_public.py", original.replacingOccurrences(of: "VALUE, 2", with: "VALUE, 3"))
    let weakened = try observe(prepared, workspace, "flat-weakened")
    try check(weakened.0.assessment.state == .mismatch && weakened.0.assessment.failedCheckIDs == ["partial.original_unittest"], "weakened flat tests cannot wash original failure")
    try fm.removeItem(at: workspace.appendingPathComponent("test_public.py"))
    let deleted = try observe(prepared, workspace, "flat-deleted")
    try check(deleted.0.assessment.state == .mismatch && deleted.0.assessment.failedCheckIDs == ["partial.original_unittest"], "deleted flat tests cannot bypass frozen original suite")
    try put(workspace, "module.py", "VALUE = 2\n"); try put(workspace, "test_public.py", original)
    try put(workspace, "tests/__init__.py", "")
    try put(workspace, "tests/test_nested.py", "import unittest\nclass Nested(unittest.TestCase):\n def test_nested(self): self.assertTrue(True)\n")
    guard let mixed = try PythonRegressionSnapshot.acquire(workspace: workspace.path) else { throw OS1Error.message("Unittest layout fixture: mixed suite unavailable") }
    try check(Set(mixed.originalTests.keys) == ["test_public.py", "tests/__init__.py", "tests/test_nested.py"], "flat and canonical original suites both frozen")
    let mixedResult = try observe(prepare(workspace), workspace, "mixed")
    try check(mixedResult.1.count == 2 && mixedResult.1.allSatisfy { $0["testsRun"] as? Int == 2 && $0["status"] as? String == "passed" }, "mixed suites both actually discovered")
    try fm.removeItem(at: workspace.appendingPathComponent("tests/__init__.py"))
    try check(PythonRegressionSnapshot.acquire(workspace: workspace.path) == nil, "unimportable mixed test package not silently ignored")
    try put(workspace, "tests/__init__.py", "")
    try put(workspace, "ordinary/__init__.py", "VALUE = 2\n")
    try check(PythonRegressionSnapshot.acquire(workspace: workspace.path) != nil, "ordinary implementation package is allowed without freezing its init")
    try put(workspace, "ordinary/test_other.py", "import unittest\nclass Other(unittest.TestCase):\n def test_other(self): self.assertTrue(True)\n")
    try check(PythonRegressionSnapshot.acquire(workspace: workspace.path) == nil, "initial noncanonical nested test authority is unavailable")
    try fm.removeItem(at: workspace.appendingPathComponent("ordinary/test_other.py"))
    let beforeAddedNested = try prepare(workspace)
    try put(workspace, "ordinary/test_added.py", "import unittest\nclass Added(unittest.TestCase):\n def test_added(self): self.assertTrue(False)\n")
    let nestedAdded = try observe(beforeAddedNested, workspace, "candidate-nested-added")
    try check(nestedAdded.0.assessment.failedCheckIDs == ["partial.candidate_unittest"] && beforeAddedNested.frozenRegressionSnapshot?.originalTests["ordinary/test_added.py"] == nil && beforeAddedNested.frozenRegressionSnapshot?.originalTests["ordinary/__init__.py"] == nil, "candidate-added package test is a candidate-only failure, not original loader authority")
    try fm.removeItem(at: workspace.appendingPathComponent("ordinary/test_added.py"))
    let empty = base.appendingPathComponent("empty")
    try put(empty, "README.md", "python3 -m unittest\n"); try put(empty, "test_empty.py", "")
    let emptyResult = try observe(prepare(empty), empty, "zero-tests")
    try check(emptyResult.0.assessment.state == .unverified && emptyResult.0.assessment.failedCheckIDs.isEmpty && emptyResult.1.allSatisfy { $0["testsRun"] as? Int == 0 && $0["status"] as? String == "unverified" }, "zero tests remain unverified")
    try put(empty, "test_empty.py", "import missing_os1_layout_fixture_dependency\n")
    let setup = try observe(prepare(empty), empty, "setup-error")
    try check(setup.0.assessment.state == .unverified && setup.0.assessment.failedCheckIDs.isEmpty, "import/setup error is not assertion failure")
    let link = workspace.appendingPathComponent("test_link.py")
    try fm.createSymbolicLink(at: link, withDestinationURL: workspace.appendingPathComponent("test_public.py"))
    try check(PythonRegressionSnapshot.acquire(workspace: workspace.path) == nil, "symlink flat source rejected before freezing")
    try rejects("candidate-added symlink rejected") { _ = try flat.candidatePaths(workspace: workspace.path) }
    try fm.removeItem(at: link)
    try fm.linkItem(at: workspace.appendingPathComponent("test_public.py"), to: link)
    try rejects("hardlinked test source rejected") { _ = try PythonRegressionSnapshot.acquire(workspace: workspace.path) }
    try fm.removeItem(at: link)
    try fm.setAttributes([.posixPermissions: 0o666], ofItemAtPath: workspace.appendingPathComponent("test_public.py").path)
    try rejects("others-writable source rejected") { _ = try PythonRegressionSnapshot.acquire(workspace: workspace.path) }
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: workspace.appendingPathComponent("test_public.py").path)
    try fm.setAttributes([.posixPermissions: 0o777], ofItemAtPath: workspace.path)
    try check(PythonRegressionSnapshot.acquire(workspace: workspace.path) == nil, "others-writable project root rejected")
    try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: workspace.path)
    try put(workspace, "test_oversize.py", String(repeating: "x", count: 256_001))
    try rejects("Python-file byte bound retained") { _ = try flat.candidatePaths(workspace: workspace.path) }
    try fm.removeItem(at: workspace.appendingPathComponent("test_oversize.py"))
    for i in 0..<17 { try put(workspace, "test_bound_\(i).py", "") }
    try check(PythonRegressionSnapshot.acquire(workspace: workspace.path) == nil, "sixteen-root acquisition bound retained")
    try rejects("sixteen-root candidate bound retained") { _ = try flat.candidatePaths(workspace: workspace.path) }
    succeeded = true
    print("OS-1 flat/mixed unittest layouts: \(checks) checks PASS; actual counts, added-failure veto, frozen-original weak/delete, setup/zero/symlink/custody/bounds; model calls 0")
}

/// Existing operational checker execution in the CURRENT native adapter.
/// It is not a hidden evaluation scorer, reference selector or retry owner.
enum RCCOperationalQuality {
    typealias C = RCCRuntimeContract
    enum Failure: Error { case custody, binding, unavailable, localEffectsCapabilityUnavailable }
    struct ContentManifest: Codable, Equatable {
        struct Entry: Codable, Equatable { let path: String; let kind: String; let bytes: Int64; let sha256: String; let mode: UInt16 }
        let entries: [Entry]
        var sha256: String { (try? encoded(self)).map(TaskQualityEvidence.digest) ?? "" }
        /// A bounded exact data-fork/content identity, not the old path/size/
        /// integer-mtime observation hash. Refuse unknown/sensitive objects.
        static func capture(workspace: String) throws -> Self {
            let fm = FileManager.default, root = URL(fileURLWithPath: workspace).standardizedFileURL
            guard root.path.hasPrefix("/"), root.resolvingSymlinksInPath().path == root.path,
                  root.path != fm.homeDirectoryForCurrentUser.resolvingSymlinksInPath().path else { throw Failure.custody }
            var rows: [Entry] = [], total: Int64 = 0, directories: [(String, stat)] = []
            func same(_ a: stat, _ b: stat) -> Bool {
                a.st_dev == b.st_dev && a.st_ino == b.st_ino && a.st_mode == b.st_mode && a.st_uid == b.st_uid &&
                a.st_gid == b.st_gid && a.st_size == b.st_size && a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec &&
                a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec && a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec &&
                a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec
            }
            func visit(_ path: URL, relative: String, depth: Int) throws {
                let component = path.lastPathComponent.lowercased()
                guard depth <= 8, rows.count < 512, !component.contains("handy"),
                      ![".ssh", ".gnupg", "keychains", "auth.json", "credentials.json", ".claude", ".codex"].contains(component),
                      !component.hasPrefix(".env") else { throw Failure.custody }
                var before = stat()
                guard lstat(path.path, &before) == 0 else { throw Failure.custody }
                let type = before.st_mode & S_IFMT
                if type == S_IFDIR {
                    directories.append((path.path, before))
                    rows.append(.init(path: relative, kind: "directory", bytes: 0, sha256: "", mode: UInt16(before.st_mode & 0o777)))
                    for name in try fm.contentsOfDirectory(atPath: path.path).sorted() {
                        // Git's administrative object graph is not a source
                        // artifact. Its identity is independently bound below.
                        if relative.isEmpty && name == ".git" { continue }
                        try visit(path.appendingPathComponent(name), relative: relative.isEmpty ? name : relative + "/" + name, depth: depth + 1)
                    }
                } else if type == S_IFREG {
                    guard before.st_nlink == 1, before.st_size >= 0, before.st_size <= 2_000_000,
                          total <= 32_000_000 - before.st_size else { throw Failure.custody }
                    let fd = open(path.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
                    guard fd >= 0 else { throw Failure.custody }; defer { close(fd) }
                    var opened = stat(); guard fstat(fd, &opened) == 0, same(before, opened) else { throw Failure.custody }
                    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false), data = try handle.readToEnd() ?? Data()
                    var after = stat(), named = stat()
                    guard fstat(fd, &after) == 0, lstat(path.path, &named) == 0,
                          data.count == before.st_size, same(before, after), same(before, named) else { throw Failure.custody }
                    total += before.st_size
                    rows.append(.init(path: relative, kind: "file", bytes: before.st_size,
                        sha256: TaskQualityEvidence.digest(data), mode: UInt16(before.st_mode & 0o777)))
                } else { throw Failure.custody }
            }
            try visit(root, relative: "", depth: 0)
            for (path, before) in directories {
                var after = stat(); guard lstat(path, &after) == 0, same(before, after) else { throw Failure.custody }
            }
            let git = root.appendingPathComponent(".git")
            if fm.fileExists(atPath: git.path) {
                // No automatic local-write replay in Git workspaces until a
                // bounded full administrative identity is supported. Ordinary
                // checking can still return partial evidence without it.
                throw Failure.unavailable
            }
            return .init(entries: rows)
        }
    }
    struct FrozenPrepared: Codable {
        let envelope: PreparedTaskQuality.Envelope
        let checkerBytes: Data
        let referencePolicySHA256: String
        let partialRegression: PythonRegressionSnapshot?
        let resourceScheduleSnapshot: ResourceScheduleSupplement.Snapshot?
        init(_ value: PreparedTaskQuality) {
            envelope = value.envelope; checkerBytes = value.checkerBytes; referencePolicySHA256 = value.referencePolicySHA256
            partialRegression = value.frozenRegressionSnapshot
            resourceScheduleSnapshot = value.resourceScheduleSnapshot
        }
        var prepared: PreparedTaskQuality {
            .init(envelope: envelope, checkerBytes: checkerBytes, referencePolicySHA256: referencePolicySHA256, partialRegression: partialRegression, resourceScheduleSnapshot: resourceScheduleSnapshot)
        }
    }
    struct Preparation {
        let prepared: PreparedTaskQuality
        let before: ContentManifest?
        let correctiveAttempts: Int
        let budget: TaskQualityCorrection.Budget
        /// Attested ONLY after actual native local-only capability application.
        var localOnlyVerified = false
        var nativeProfileSHA256: String? = nil
        let correctionPrompt: String?
    }
    struct StoredWitness: Codable {
        let schema: Int
        let ticket: C.ExecutionTicket
        let originalInstructionSHA256: String
        let originalRequestSHA256: String
        let originalObjectiveSHA256: String
        let prepared: FrozenPrepared
        let artifact: Artifact
        let assessment: TaskQualityEvidence.Evaluation
        let contract: TaskQualityEvidence.Contract
        let receipt: TaskQualityEvidence.Receipt?
        let observedArtifact: TaskQualityEvidence.ObservedArtifact
        let failureDiagnostic: String
        let before: ContentManifest?
        let after: ContentManifest?
        let correctiveAttempts: Int
        let localOnlyVerified: Bool
        let nativeProfileSHA256: String?
        let lastFailureArtifactSHA256: String?
        let lastFailureWorkspaceSHA256: String?
        var budget: TaskQualityCorrection.Budget {
            .init(correctiveAttempts: correctiveAttempts, referenceEscalations: 0,
                lastFailureArtifactSHA256: lastFailureArtifactSHA256, lastFailureWorkspaceSHA256: lastFailureWorkspaceSHA256)
        }
    }
    struct Authority {
        let accountMatches: (C.ExecutionTicket) -> Bool
        let policyMatches: (C.ExecutionTicket) throws -> Bool
        let nativeProfileMatches: (StoredWitness) throws -> Bool
        init(accountMatches: @escaping (C.ExecutionTicket) -> Bool, policyMatches: @escaping (C.ExecutionTicket) throws -> Bool,
             nativeProfileMatches: @escaping (StoredWitness) throws -> Bool = { _ in false }) {
            self.accountMatches = accountMatches; self.policyMatches = policyMatches; self.nativeProfileMatches = nativeProfileMatches
        }
        static var production: Authority { Authority(accountMatches: { ticket in
            BackendAccounts.active(provider: ticket.selectedConfig.surface == .codex ? "codex" : "claude", in: BackendAccounts.load()).id == ticket.selectedConfig.accountID
        }, policyMatches: { ticket in
            let active = try OwnerPolicySnapshot.load(root: OwnerPolicySnapshot.defaultRoot)
            return ticket.hostContext?.ownerPolicy.map { active?.sourceSHA256 == $0.sourceSHA256 && active?.projectionSHA256 == $0.projectionSHA256 } ?? (active == nil)
        }, nativeProfileMatches: { stored in try RCCOperationalQuality.verifyNativeProfile(stored) }) }
    }
    struct Finished { let assessment: TaskQualityEvidence.Evaluation; let descriptor: C.OperationalQuality?; let checkerReceiptAvailable: Bool }
    static var root: URL { FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/rcc-runtime/quality-witnesses") }
    static func encoded<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]; encoder.dateEncodingStrategy = .millisecondsSince1970
        return try encoder.encode(value)
    }
    private static func decode<T: Decodable>(_ value: T.Type, _ data: Data) throws -> T {
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .millisecondsSince1970; return try decoder.decode(value, from: data)
    }
    private static func directory(_ root: URL) throws {
        guard root.path.hasPrefix("/"), root.standardizedFileURL.path == root.path, root.resolvingSymlinksInPath().path == root.path else { throw Failure.custody }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var st = stat(); guard lstat(root.path, &st) == 0, st.st_mode & S_IFMT == S_IFDIR,
            st.st_uid == getuid(), st.st_mode & 0o077 == 0 else { throw Failure.custody }
    }
    private static func read(_ path: String, root: URL, sha: String) throws -> Data {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.deletingLastPathComponent().path == root.path, url.resolvingSymlinksInPath().path == url.path,
              sha.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw Failure.custody }
        let fd = open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { throw Failure.custody }; defer { close(fd) }
        var before = stat(); guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
            before.st_uid == getuid(), before.st_mode & 0o077 == 0, before.st_nlink == 1,
            before.st_size > 0, before.st_size <= 8_000_000 else { throw Failure.custody }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false), bytes = try handle.readToEnd() ?? Data()
        var after = stat(), named = stat()
        guard fstat(fd, &after) == 0, lstat(url.path, &named) == 0,
            before.st_dev == after.st_dev, before.st_ino == after.st_ino, before.st_size == after.st_size,
            before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
            before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec, before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec,
            after.st_dev == named.st_dev, after.st_ino == named.st_ino, bytes.count == before.st_size,
            TaskQualityEvidence.digest(bytes) == sha else { throw Failure.custody }
        return bytes
    }
    private static func write(_ bytes: Data, path: URL, root: URL) throws {
        try directory(root)
        guard path.deletingLastPathComponent().path == root.path, !bytes.isEmpty, bytes.count <= 8_000_000 else { throw Failure.custody }
        let fd = open(path.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw Failure.custody }; defer { close(fd) }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
        try handle.write(contentsOf: bytes); try handle.synchronize()
        guard try read(path.path, root: root, sha: TaskQualityEvidence.digest(bytes)) == bytes else { throw Failure.custody }
    }
    static func contextSHA(_ ticket: C.ExecutionTicket) -> String { C.digest(Data((ticket.hostContext?.context ?? "").utf8)) }
    static func sourceSHA(_ ticket: C.ExecutionTicket) -> String? {
        (try? SessionHandoff.decode(ticket.hostContext?.context)).flatMap { $0.source?.sha256 }
    }
    struct LocalEffectsBoundary {
        let envelopeSHA256: String
        let originalObjectiveSHA256: String
        let scope: TaskContext.Scope
    }
    /// The original owner's local-effect restriction may narrow a child even
    /// without a matching child checker. It grants no test coverage or task
    /// verification, and never upgrades a read-only parent to a writer.
    private static func originalLocalEffectsBoundary(original: String, objective: String, host: C.HostContext,
        requestSHA256: String, sourceFingerprint: String, policySHA256: String,
        rootURL: URL) throws -> LocalEffectsBoundary? {
        guard C.digest(Data(original.utf8)) == requestSHA256, !objective.isEmpty,
            C.digest(try C.encode(host)) == sourceFingerprint else { throw Failure.binding }
        let objectiveSHA = C.digest(Data(original.utf8))
        let path = rootURL.appendingPathComponent("contracts", isDirectory: true).appendingPathComponent(objectiveSHA + ".json")
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        let canonical = path.standardizedFileURL
        guard canonical.resolvingSymlinksInPath().path == canonical.path else { throw Failure.custody }
        let attrs = try FileManager.default.attributesOfItem(atPath: path.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular,
            (attrs[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(), ((attrs[.posixPermissions] as? NSNumber)?.intValue ?? 0o777) & 0o022 == 0,
            (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 128_000 else { throw Failure.custody }
        let data = try Data(contentsOf: path), envelope = try decode(PreparedTaskQuality.Envelope.self, data), c = envelope.contract
        guard envelope.localEffectsOnly else { return nil }
        let source = (try? SessionHandoff.decode(host.context)).flatMap { $0.source?.sha256 }
        guard c.objectiveSHA256 == objectiveSHA, c.contextSHA256 == C.digest(Data((host.context ?? "").utf8)),
            c.sourceSHA256 == source, c.referencePolicySHA256 == policySHA256, c.validUntil > Date(),
            [.readOnly, .workspaceWrite].contains(c.scope) else { throw Failure.binding }
        return .init(envelopeSHA256: C.digest(data), originalObjectiveSHA256: C.digest(Data(objective.utf8)), scope: c.scope)
    }
    static func localEffectsBoundary(ticket: C.ExecutionTicket, rootURL: URL = PreparedTaskQuality.root) throws -> LocalEffectsBoundary? {
        guard let original = ticket.originalRequest, let objective = ticket.originalObjective, let host = ticket.hostContext else { throw Failure.binding }
        guard let boundary = try originalLocalEffectsBoundary(original: original, objective: objective, host: host,
            requestSHA256: ticket.requestSHA256, sourceFingerprint: ticket.sourceFingerprint, policySHA256: ticket.policySHA256, rootURL: rootURL) else { return nil }
        let scope: TaskContext.Scope = ticket.selectedConfig.scope == .readOnly ? .readOnly : .workspaceWrite
        guard boundary.scope == scope || (boundary.scope == .workspaceWrite && scope == .readOnly) else { throw Failure.binding }
        return boundary
    }
    static func localEffectsBoundary(request: C.Request, rootURL: URL = PreparedTaskQuality.root) throws -> LocalEffectsBoundary? {
        guard let host = request.hostContext else { throw Failure.binding }
        return try originalLocalEffectsBoundary(original: request.request, objective: request.objective, host: host,
            requestSHA256: request.requestSHA256, sourceFingerprint: request.sourceFingerprint, policySHA256: request.policySHA256, rootURL: rootURL)
    }
    /// Capability predicate only: no model/tier/effort selection or new rights.
    static func supportsLocalEffects(config: C.ExactConfig, sourceBound: Bool, nativeResume: Bool, permissionContinuation: Bool) -> Bool {
        config.surface == .codex && config.transport == .codexAppServer && !sourceBound && !nativeResume && !permissionContinuation
    }
    static func enforceLocalEffectsAdmission(declared: Bool, profileAvailable: Bool) throws {
        guard !declared || profileAvailable else { throw Failure.localEffectsCapabilityUnavailable }
    }
    /// A shared reservation cannot become an ordinary unrestricted attempt if
    /// its catalog-time boundary is removed or changed before dispatch. Bind
    /// the requirement to the exact original envelope bytes, then enforce the
    /// actual native profile as usual. Legacy exclusive tickets stay unchanged.
    static func enforceRequiredExecutionIsolation(required: String?, envelopeSHA256: String?,
        boundary: LocalEffectsBoundary?, config: C.ExactConfig, sourceBound: Bool,
        nativeResume: Bool, permissionContinuation: Bool) throws {
        if required == nil && envelopeSHA256 == nil { return }
        guard required == "codex_fresh_local_effects_v1", let envelopeSHA256,
              let boundary, boundary.envelopeSHA256 == envelopeSHA256,
              supportsLocalEffects(config: config, sourceBound: sourceBound,
                nativeResume: nativeResume, permissionContinuation: permissionContinuation) else {
            throw Failure.localEffectsCapabilityUnavailable
        }
    }
    /// Admission closure for the same owner boundary before the local planner.
    /// Legacy/undeclared catalogs return byte-identically, not a new catalog.
    static func constrainCatalogData(_ data: Data, request: C.Request, sourceBound: Bool,
        rootURL: URL = PreparedTaskQuality.root) throws -> Data {
        guard let boundary = try localEffectsBoundary(request: request, rootURL: rootURL) else { return data }
        var catalog = try C.decodeCatalog(data, request: request)
        var removed: [String: Int] = [:]
        catalog.candidates = catalog.candidates.filter { row in
            let scopeAllowed = (boundary.scope == .workspaceWrite && request.hostContext?.requireReadOnly != true) || row.scope == .readOnly
            let keep = scopeAllowed && supportsLocalEffects(config: row.exactConfig, sourceBound: sourceBound,
                nativeResume: false, permissionContinuation: false)
            if !keep {
                let provider = row.quotaPool == .anthropicShared ? "claude" : row.quotaPool == .openAICodex ? "codex" : nil
                if let provider { removed[provider, default: 0] += 1 }
            }
            return keep
        }
        var exclusions = catalog.exclusions ?? []
        for provider in removed.keys.sorted() {
            if let index = exclusions.firstIndex(where: { $0.provider == provider && $0.reason == "explicit_constraint_unavailable" }) {
                exclusions[index].count += removed[provider]!
            } else { exclusions.append(.init(provider: provider, reason: "explicit_constraint_unavailable", count: removed[provider]!)) }
        }
        if catalog.candidates.isEmpty && removed.isEmpty && exclusions.isEmpty {
            // An unsupported non-native row has no honest provider name in
            // the existing exclusion enum. Hold rather than invent one.
            throw Failure.localEffectsCapabilityUnavailable
        }
        catalog.exclusions = exclusions.isEmpty ? nil : exclusions
        let models = Set(catalog.candidates.map(\.model))
        catalog.modelTiers = catalog.modelTiers.map { $0.filter { models.contains($0.key) } }
        catalog.quotaScores = catalog.quotaScores.map { $0.filter { models.contains($0.key) } }
        if let native = catalog.nativeReferenceEfforts {
            var filtered: [String: [String: String]] = [:]
            for provider in ["codex", "claude"] {
                let pool: C.QuotaPool = provider == "codex" ? .openAICodex : .anthropicShared
                let represented = Set(catalog.candidates.filter { $0.quotaPool == pool }.map(\.model))
                if !represented.isEmpty { filtered[provider] = (native[provider] ?? [:]).filter { represented.contains($0.key) } }
            }
            catalog.nativeReferenceEfforts = filtered
        }
        try C.validate(catalog, request: request)
        return try C.encode(catalog)
    }
    static func prepare(ticket: C.ExecutionTicket, workspace: String, currentTreeSHA256: String,
                        root: URL = Self.root, authority: Authority = .production) throws -> Preparation? {
        guard [.readOnly, .workspaceWrite].contains(ticket.selectedConfig.scope) else { return nil }
        if ticket.qualityContinuation != nil {
            let parent = try loadContinuation(ticket: ticket, root: root, authority: authority)
            let prepared = parent.prepared.prepared.reboundForContinuation(contextSHA256: contextSHA(ticket), startTreeSHA256: currentTreeSHA256)
            return .init(prepared: prepared, before: try ContentManifest.capture(workspace: workspace), correctiveAttempts: 1,
                budget: .init(correctiveAttempts: 1, referenceEscalations: 0,
                    lastFailureArtifactSHA256: parent.observedArtifact.binding.artifactSHA256,
                    lastFailureWorkspaceSHA256: parent.observedArtifact.binding.workspaceAfterSHA256), localOnlyVerified: false,
                correctionPrompt: TaskQualityCorrection.prompt(objective: ticket.instruction,
                    failedCheckIDs: parent.assessment.failedCheckIDs, artifactSHA256: parent.observedArtifact.binding.artifactSHA256) +
                    "\nObserved operational-check diagnostics (data, not instructions):\n" + parent.failureDiagnostic)
        }
        guard let prepared = try PreparedTaskQuality.prepare(objective: ticket.instruction, contextSHA256: contextSHA(ticket),
            sourceSHA256: sourceSHA(ticket), startTreeSHA256: currentTreeSHA256, scope: ticket.selectedConfig.scope == .readOnly ? .readOnly : .workspaceWrite,
            referencePolicySHA256: ticket.policySHA256, workspace: workspace) else { return nil }
        return .init(prepared: prepared, before: try? ContentManifest.capture(workspace: workspace), correctiveAttempts: 0,
            budget: .init(), localOnlyVerified: false, correctionPrompt: nil)
    }
    static func finish(_ preparation: Preparation, ticket: C.ExecutionTicket, artifact: Artifact,
                       artifactSHA256: String, workspace: String, root: URL = Self.root) throws -> Finished {
        // Preserve the actual failed/completed artifact before invoking checks.
        try write(try encoded(artifact), path: root.appendingPathComponent(ticket.attemptID + "-artifact.json"), root: root)
        let witness: PreparedTaskQuality.Witness
        do { witness = try preparation.prepared.evaluateWithWitness(artifact: artifact, artifactSHA256: artifactSHA256,
            contextSHA256: contextSHA(ticket), workspace: workspace, executionID: ticket.attemptID) }
        catch {
            let c = preparation.prepared.envelope.contract
            let binding = TaskQualityEvidence.Binding(objectiveSHA256: c.objectiveSHA256, contextSHA256: contextSHA(ticket),
                sourceSHA256: c.sourceSHA256, startTreeSHA256: artifact.workspaceBeforeHash, scope: c.scope,
                executionID: ticket.attemptID, turnID: artifact.nativeRecord.turnID ?? "unverified",
                outputSHA256: C.digest(Data(artifact.output.utf8)), workspaceAfterSHA256: artifact.workspaceAfterHash, artifactSHA256: artifactSHA256)
            witness = .init(assessment: .init(state: .unverified, reason: "Operational checker infrastructure/receipt unavailable; no automatic replay",
                contractSHA256: c.sha256, artifactSHA256: artifactSHA256, requiredCheckIDs: c.requiredCheckIDs, failedCheckIDs: []),
                contract: c, receipt: nil, artifact: .init(binding: binding, executionVerified: true), failureDiagnostic: "")
        }
        let after = try? ContentManifest.capture(workspace: workspace)
        var assessment = operationalAssessment(witness.assessment)
        // Full promotion requires exact content custody as well as tests.
        if preparation.before == nil || after == nil, assessment.state != .mismatch {
            assessment = .init(state: .unverified, reason: "Operational checks observed, exact bounded workspace custody unavailable",
                contractSHA256: assessment.contractSHA256, artifactSHA256: artifactSHA256,
                requiredCheckIDs: assessment.requiredCheckIDs, failedCheckIDs: [])
        }
        let stored = StoredWitness(schema: 1, ticket: ticket, originalInstructionSHA256: C.digest(Data(ticket.instruction.utf8)),
            originalRequestSHA256: ticket.requestSHA256, originalObjectiveSHA256: C.digest(Data((ticket.originalObjective ?? ticket.objective).utf8)),
            prepared: FrozenPrepared(preparation.prepared), artifact: artifact, assessment: assessment, contract: witness.contract,
            receipt: witness.receipt, observedArtifact: witness.artifact, failureDiagnostic: witness.failureDiagnostic,
            before: preparation.before, after: after, correctiveAttempts: preparation.correctiveAttempts,
            localOnlyVerified: preparation.localOnlyVerified, nativeProfileSHA256: preparation.nativeProfileSHA256, lastFailureArtifactSHA256: preparation.budget.lastFailureArtifactSHA256,
            lastFailureWorkspaceSHA256: preparation.budget.lastFailureWorkspaceSHA256)
        let bytes = try encoded(stored), path = root.appendingPathComponent(ticket.attemptID + ".json")
        try write(bytes, path: path, root: root)
        let descriptor = after.map { C.OperationalQuality(coverage: witness.contract.fullCoverage ? .full : .partial,
            assessmentState: assessment.state, contractSHA256: witness.contract.sha256, witnessPath: path.path,
            witnessSHA256: C.digest(bytes), artifactSHA256: artifactSHA256, workspaceAfterSHA256: $0.sha256,
            failedCheckIDs: assessment.failedCheckIDs, correctiveAttempts: preparation.correctiveAttempts,
            localOnlyVerified: preparation.localOnlyVerified && preparation.before != nil) }
        return .init(assessment: assessment, descriptor: descriptor, checkerReceiptAvailable: witness.receipt != nil)
    }
    private static func loadContinuation(ticket: C.ExecutionTicket, root: URL, authority: Authority) throws -> StoredWitness {
        guard let c = ticket.qualityContinuation, authority.accountMatches(ticket), try authority.policyMatches(ticket) else { throw Failure.binding }
        let parentRecordRoot = root.deletingLastPathComponent().appendingPathComponent("native-receipts")
        let parentBytes = try read(c.parentNativeReceipt, root: parentRecordRoot, sha: c.parentNativeReceiptSHA256)
        let record = try C.decodeRecord(parentBytes)
        guard let quality = record.operationalQuality, quality.witnessPath == c.witnessPath, quality.witnessSHA256 == c.witnessSHA256,
              quality.workspaceAfterSHA256 == c.expectedWorkspaceAfterSHA256, record.attemptID == c.parentAttemptID,
              record.taskID == ticket.taskID, record.nodeID == ticket.nodeID, record.candidateID == ticket.candidateID,
              record.configurationSHA256 == ticket.configurationSHA256, record.selectedConfig == ticket.selectedConfig,
              record.nativeTurnTerminated == true, record.executionVerified, record.handback == nil, record.repairSource == nil,
              quality.assessmentState == .mismatch, quality.correctiveAttempts == 0, quality.localOnlyVerified else { throw Failure.binding }
        let stored = try decode(StoredWitness.self, read(c.witnessPath, root: root, sha: c.witnessSHA256))
        try validate(stored, record: record)
        guard try authority.nativeProfileMatches(stored) else { throw Failure.binding }
        let prior = stored.ticket
        guard prior.requestSHA256 == ticket.requestSHA256, prior.originalRequest == ticket.originalRequest,
              prior.originalObjective == ticket.originalObjective, prior.instruction == ticket.instruction,
              prior.hostContext == ticket.hostContext, prior.contextRefs == ticket.contextRefs, prior.ownedPaths == ticket.ownedPaths,
              prior.policySHA256 == ticket.policySHA256, prior.policySourceSHA256 == ticket.policySourceSHA256,
              prior.sourceFingerprint == ticket.sourceFingerprint, c.originalInstructionSHA256 == stored.originalInstructionSHA256,
              ticket.hostContext.flatMap({ try? ContentManifest.capture(workspace: $0.workspace).sha256 }) == c.expectedWorkspaceAfterSHA256 else { throw Failure.binding }
        return stored
    }
    private static func validate(_ stored: StoredWitness, record: C.ExecutionRecord) throws {
        let t = stored.ticket
        guard stored.schema == 1, t.taskID == record.taskID, t.nodeID == record.nodeID, t.attemptID == record.attemptID,
              t.candidateID == record.candidateID, t.selectedConfig == record.selectedConfig,
              t.configurationSHA256 == record.configurationSHA256,
              stored.originalInstructionSHA256 == C.digest(Data(t.instruction.utf8)), stored.originalRequestSHA256 == t.requestSHA256,
              stored.originalObjectiveSHA256 == C.digest(Data((t.originalObjective ?? t.objective).utf8)),
              stored.artifact.output == record.output, stored.artifact.model == t.selectedConfig.model,
              stored.artifact.effort == t.selectedConfig.effort.rawValue,
              C.digest(try encoded(stored.artifact)) == record.operationalQuality?.artifactSHA256,
              stored.prepared.envelope.contract == stored.contract,
              C.digest(stored.prepared.checkerBytes) == stored.contract.verifierCodeSHA256,
              stored.assessment == stored.prepared.prepared.evaluateAssessment(stored: stored),
              stored.after?.sha256 == record.operationalQuality?.workspaceAfterSHA256,
              record.operationalQuality?.assessmentState == stored.assessment.state,
              record.operationalQuality?.contractSHA256 == stored.contract.sha256,
              record.operationalQuality?.failedCheckIDs == stored.assessment.failedCheckIDs,
              record.operationalQuality?.correctiveAttempts == stored.correctiveAttempts,
              record.operationalQuality?.localOnlyVerified == (stored.localOnlyVerified && stored.before != nil),
              record.operationalQuality?.coverage == (stored.contract.fullCoverage ? .full : .partial),
              stored.prepared.checkerBytes.count <= 256_000,
              stored.prepared.referencePolicySHA256 == t.policySHA256,
              stored.contract.objectiveSHA256 == stored.originalInstructionSHA256,
              stored.contract.contextSHA256 == contextSHA(t), stored.contract.sourceSHA256 == sourceSHA(t),
              stored.contract.startTreeSHA256 == stored.artifact.workspaceBeforeHash,
              stored.observedArtifact.binding.artifactSHA256 == record.operationalQuality?.artifactSHA256,
              stored.observedArtifact.binding.outputSHA256 == C.digest(Data(stored.artifact.output.utf8))
              else { throw Failure.binding }
    }
    static func operationalAssessment(_ observed: TaskQualityEvidence.Evaluation) -> TaskQualityEvidence.Evaluation {
        guard [.referenceEquivalent, .referenceAbove].contains(observed.state) else { return observed }
        return .init(state: .taskContractVerified,
            reason: "Trusted operational contract verified; no current both-provider reference comparison",
            contractSHA256: observed.contractSHA256, artifactSHA256: observed.artifactSHA256,
            requiredCheckIDs: observed.requiredCheckIDs, failedCheckIDs: [])
    }
    static func verifyNativeProfile(_ stored: StoredWitness) throws -> Bool {
        guard stored.localOnlyVerified, let hash = stored.nativeProfileSHA256, C.isHash(hash) else { return false }
        let folder = root.deletingLastPathComponent().appendingPathComponent("local-quality-profiles")
        let data = try read(folder.appendingPathComponent(stored.ticket.attemptID + ".json").path, root: folder, sha: hash)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            object["schema"] as? Int == 1, object["task_id"] as? String == stored.ticket.taskID,
            object["node_id"] as? String == stored.ticket.nodeID, object["attempt_id"] as? String == stored.ticket.attemptID,
            object["configuration_sha256"] as? String == stored.ticket.configurationSHA256,
            object["source_fingerprint"] as? String == stored.ticket.sourceFingerprint,
            object["policy_sha256"] as? String == stored.ticket.policySHA256,
            object["workspace"] as? String == stored.ticket.hostContext?.workspace,
            object["profile"] as? String == RCCNativeLocalQualityProfile.profileID,
            object["local_only_attestation"] as? Bool == true,
            let sources = object["source_hashes"] as? [String: String], !sources.isEmpty, sources.count <= 256 else { return false }
        for (path, digest) in sources {
            let url = URL(fileURLWithPath: path).standardizedFileURL
            guard url.path == path, url.resolvingSymlinksInPath().path == path, C.isHash(digest) else { return false }
            var a = stat(); guard lstat(path, &a) == 0, a.st_mode & S_IFMT == S_IFREG, a.st_size > 0, a.st_size <= 256_000_000 else { return false }
            let bytes = try Data(contentsOf: url, options: [.mappedIfSafe])
            var b = stat(); guard lstat(path, &b) == 0, a.st_dev == b.st_dev, a.st_ino == b.st_ino,
                a.st_size == b.st_size, a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec,
                a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec, C.digest(bytes) == digest else { return false }
        }
        return true
    }
    static func publicContractDraft(ticket: C.ExecutionTicket) throws -> Data {
        guard let host = ticket.hostContext, let original = ticket.originalRequest, original == ticket.instruction,
            C.digest(Data(original.utf8)) == ticket.requestSHA256,
            C.digest(try C.encode(host)) == ticket.sourceFingerprint, ticket.selectedConfig.scope == .workspaceWrite else { throw Failure.binding }
        try host.ownerPolicy?.verifyOriginal()
        // A unique nonexistent registry lookup forces the existing public
        // acquisition branch; no reference/checker from another job is read.
        let noRegistry = FileManager.default.temporaryDirectory.appendingPathComponent("os1-public-draft-" + UUID().uuidString)
        guard let draft = try PreparedTaskQuality.prepare(objective: original, contextSHA256: contextSHA(ticket), sourceSHA256: sourceSHA(ticket),
            startTreeSHA256: workspaceHash(host.workspace), scope: .workspaceWrite, referencePolicySHA256: ticket.policySHA256,
            workspace: host.workspace, rootURL: noRegistry), draft.envelope.contract.fullCoverage == false,
            draft.envelope.contract.reference == nil, draft.frozenRegressionSnapshot != nil else { throw Failure.unavailable }
        return try JSONSerialization.data(withJSONObject: ["schema": 1, "task_id": ticket.taskID,
            "request_sha256": ticket.requestSHA256, "source_fingerprint": ticket.sourceFingerprint,
            "envelope": JSONSerialization.jsonObject(with: encoded(draft.envelope)),
            "checker_bytes_base64": draft.checkerBytes.base64EncodedString(),
            "status": "unregistered_public_partial_draft_not_owner_authority"], options: [.sortedKeys])
    }
    static func claimCorrection(ticket: C.ExecutionTicket, root: URL = Self.root, authority: Authority = .production) throws {
        guard let continuation = ticket.qualityContinuation else { return }
        let parent = try loadContinuation(ticket: ticket, root: root, authority: authority)
        guard parent.correctiveAttempts == 0, parent.localOnlyVerified else { throw Failure.binding }
        let name = "claim-" + C.digest(Data((continuation.parentAttemptID + "\0" + continuation.witnessSHA256).utf8)) + ".json"
        let claim = try JSONSerialization.data(withJSONObject: ["schema": 1, "task_id": ticket.taskID,
            "node_id": ticket.nodeID, "parent_attempt_id": continuation.parentAttemptID,
            "attempt_id": ticket.attemptID, "witness_sha256": continuation.witnessSHA256], options: [.sortedKeys])
        // O_EXCL is a conservative one-use pre-dispatch claim. A later opaque
        // failure never refunds it or authorizes another native execution.
        try write(claim, path: root.appendingPathComponent(name), root: root)
    }
    static func decision(_ input: Data, root: URL = Self.root, cancelled: Bool = false, authority: Authority = .production) throws -> Data {
        guard let object = try JSONSerialization.jsonObject(with: input) as? [String: Any],
              Set(object.keys) == ["schema", "parent_ticket", "parent_native_receipt", "parent_native_receipt_sha256"],
              object["schema"] as? Int == 1, let raw = object["parent_ticket"],
              let path = object["parent_native_receipt"] as? String, let hash = object["parent_native_receipt_sha256"] as? String else { throw Failure.binding }
        let ticket = try C.decodeTicket(JSONSerialization.data(withJSONObject: raw, options: [.sortedKeys]))
        let record = try C.decodeRecord(read(path, root: root.deletingLastPathComponent().appendingPathComponent("native-receipts"), sha: hash), ticket: ticket)
        guard record.nativeReceipt == path, let quality = record.operationalQuality else { throw Failure.binding }
        let witness = try decode(StoredWitness.self, read(quality.witnessPath, root: root, sha: quality.witnessSHA256))
        try validate(witness, record: record)
        var action = "hold", reason = "operational_quality_not_safe_for_correction", next: C.QualityContinuation?
        if !cancelled, record.nativeTurnTerminated == true, record.executionVerified, quality.localOnlyVerified,
           witness.localOnlyVerified, witness.correctiveAttempts == 0, witness.before != nil,
           let host = ticket.hostContext, let after = witness.after,
           try ContentManifest.capture(workspace: host.workspace) == after {
            if authority.accountMatches(ticket), try authority.policyMatches(ticket), try authority.nativeProfileMatches(witness) {
                let verdict = TaskQualityCorrection.decide(contract: witness.contract, receipt: witness.receipt,
                    artifact: witness.observedArtifact, evaluation: witness.assessment,
                    boundary: .init(ownerObjective: ticket.instruction, workspace: host.workspace, scope: .workspaceWrite,
                        sourceSHA256: sourceSHA(ticket), referencePolicySHA256: ticket.policySHA256),
                    currentWorkspace: host.workspace, currentWorkspaceSHA256: observedStateHash(host.workspace),
                    currentSourceSHA256: sourceSHA(ticket), exitCode: witness.artifact.exitCode, cancelled: cancelled,
                    budget: witness.budget, referenceAllowed: false, referenceAvailable: false)
                action = verdict.action == .correct ? "correct" : verdict.action == .none ? "none" : "hold"; reason = verdict.reason
                if action == "correct" { next = .init(parentAttemptID: ticket.attemptID, parentNativeReceipt: path,
                    parentNativeReceiptSHA256: hash, witnessPath: quality.witnessPath, witnessSHA256: quality.witnessSHA256,
                    expectedWorkspaceAfterSHA256: after.sha256, originalInstructionSHA256: witness.originalInstructionSHA256) }
            }
        }
        let output: [String: Any] = ["schema": 1, "task_id": ticket.taskID, "node_id": ticket.nodeID,
            "parent_attempt_id": ticket.attemptID, "action": action, "reason": reason,
            "quality_continuation": try next.map { try JSONSerialization.jsonObject(with: C.encode($0)) } ?? NSNull()]
        return try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
    }
}

private extension PreparedTaskQuality {
    /// Re-evaluation of a stored actual receipt, not execution of the checker.
    func evaluateAssessment(stored: RCCOperationalQuality.StoredWitness) -> TaskQualityEvidence.Evaluation {
        RCCOperationalQuality.operationalAssessment(TaskQualityEvidence.evaluate(contract: stored.contract, receipt: stored.receipt, artifact: stored.observedArtifact,
            currentReferencePolicySHA256: referencePolicySHA256, now: stored.receipt?.observedAt ?? stored.contract.issuedAt))
    }
}

/// Pure exact-content and typed budget checks. No live records/auth/provider.
func rccOperationalQualitySelfTest() throws {
    let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent("os1-operational-quality-" + UUID().uuidString).resolvingSymlinksInPath()
    try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: root) }
    var count = 0
    func check(_ pass: @autoclosure () throws -> Bool, _ text: String) throws {
        guard try pass() else { throw OS1Error.message("Operational quality fixture: " + text) }; count += 1
    }
    func rejects(_ text: String, _ body: () throws -> Void) throws {
        do { try body() } catch { count += 1; return }; throw OS1Error.message("Operational quality fixture: " + text)
    }
    let file = root.appendingPathComponent("module.py")
    try Data("answer=1\n".utf8).write(to: file)
    let before = try RCCOperationalQuality.ContentManifest.capture(workspace: root.path)
    let oldDate = try fm.attributesOfItem(atPath: file.path)[.modificationDate] as! Date
    try Data("answer=2\n".utf8).write(to: file); try fm.setAttributes([.modificationDate: oldDate], ofItemAtPath: file.path)
    let after = try RCCOperationalQuality.ContentManifest.capture(workspace: root.path)
    try check(before.sha256 != after.sha256, "same-size same-mtime mutation is detected by exact content")
    try check(try RCCOperationalQuality.ContentManifest.capture(workspace: root.path) == after, "unchanged exact bounded content is stable")
    let outside = root.deletingLastPathComponent().appendingPathComponent("os1-quality-outside-" + UUID().uuidString)
    defer { try? fm.removeItem(at: outside) }
    try Data("not copied".utf8).write(to: outside)
    let link = root.appendingPathComponent("linked.py"); try fm.createSymbolicLink(at: link, withDestinationURL: outside)
    try rejects("symlink source cannot mint exact local custody") { _ = try RCCOperationalQuality.ContentManifest.capture(workspace: root.path) }
    try fm.removeItem(at: link)
    let sensitive = root.appendingPathComponent("credentials.json"); try Data("fixture only".utf8).write(to: sensitive)
    try rejects("sensitive node makes manifest unavailable without reading it") { _ = try RCCOperationalQuality.ContentManifest.capture(workspace: root.path) }
    try fm.removeItem(at: sensitive)
    try fm.createDirectory(at: root.appendingPathComponent(".git"), withIntermediateDirectories: false)
    try rejects("unsupported Git administrative identity does not acquire automatic replay authority") { _ = try RCCOperationalQuality.ContentManifest.capture(workspace: root.path) }
    print("RCC operational exact-content custody: \(count) checks PASS; provider/auth calls 0")
    try rccStagedWriterTransactionSelfTest()
}

/// Current-path checker/witness/correction fixture with a public original suite.
/// Synthetic native records only: no provider, account, authentication or user data.
func rccOperationalQualityWitnessSelfTest() throws {
    typealias Q = RCCOperationalQuality
    typealias C = RCCRuntimeContract
    let fm = FileManager.default, base = fm.temporaryDirectory.appendingPathComponent("os1-quality-witness-" + UUID().uuidString).resolvingSymlinksInPath()
    let workspace = base.appendingPathComponent("workspace"), witnesses = base.appendingPathComponent("quality-witnesses"), receipts = base.appendingPathComponent("native-receipts")
    try fm.createDirectory(at: workspace.appendingPathComponent("tests"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try fm.createDirectory(at: receipts, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: base) }
    func put(_ name: String, _ value: String) throws { try Data(value.utf8).write(to: workspace.appendingPathComponent(name)) }
    try put("README.md", "Fixture public local recipe:\npython3 -m unittest\n")
    try put("module.py", "VALUE = 0\n")
    try put("tests/__init__.py", "")
    try put("tests/test_module.py", "import unittest, module\nclass T(unittest.TestCase):\n def test_value(self): self.assertEqual(module.VALUE, 2)\n")
    var checks = 0
    func check(_ pass: @autoclosure () throws -> Bool, _ text: String) throws {
        guard try pass() else { throw OS1Error.message("Operational quality witness fixture: " + text) }; checks += 1
    }
    func reject(_ text: String, _ body: () throws -> Void) throws {
        do { try body() } catch { checks += 1; return }; throw OS1Error.message("Operational quality witness fixture: " + text)
    }
    let hash = C.digest(Data("fixture".utf8)), original = "Modify module.py and run the public tests locally. Do not deploy, send, or access the network."
    let host = C.HostContext(workspace: workspace.path, context: nil, providerPreference: "auto", codexSessionID: nil,
        claudeSessionID: nil, requireReadOnly: false, ownerPolicy: nil)
    let selected = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture-only", model: "fixture", effort: .low,
        tools: ["Bash"], scope: .workspaceWrite, permissionProfile: .workspaceWrite, quotaPool: .openAICodex,
        allowedPaths: ["**"], configurationSHA256: hash)
    var ticket = C.ExecutionTicket(taskID: "task-fixture", nodeID: "node-fixture", attemptID: "attempt-first", candidateID: "candidate-fixture",
        requestSHA256: C.digest(Data(original.utf8)), policySHA256: hash, policySourceSHA256: hash,
        sourceFingerprint: C.digest(try C.encode(host)), configurationSHA256: hash, selectedConfig: selected,
        objective: original, instruction: original, contextRefs: [], ownedPaths: ["**"], originalRequest: original,
        originalObjective: original, hostContext: host)
    let authority = Q.Authority(accountMatches: { _ in true }, policyMatches: { _ in true }, nativeProfileMatches: { _ in true })
    let weakBefore = workspaceHash(workspace.path)
    guard var prepared = try Q.prepare(ticket: ticket, workspace: workspace.path, currentTreeSHA256: weakBefore, root: witnesses, authority: authority) else {
        throw OS1Error.message("Operational quality fixture did not prepare the public original suite")
    }
    try check(prepared.prepared.envelope.contract.fullCoverage == false && prepared.prepared.envelope.contract.reference == nil,
        "public Python regression is partial and carries no hidden reference scores")
    let registry = base.appendingPathComponent("owner-registry")
    try fm.createDirectory(at: registry.appendingPathComponent("contracts"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try fm.createDirectory(at: registry.appendingPathComponent("checkers"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let trustedEnvelope = PreparedTaskQuality.Envelope(contract: prepared.prepared.envelope.contract,
        checkerSHA256: prepared.prepared.envelope.checkerSHA256, timeoutSeconds: prepared.prepared.envelope.timeoutSeconds,
        workspacePaths: prepared.prepared.envelope.workspacePaths, localEffectsOnly: true,
        publicRegressionSnapshot: prepared.prepared.frozenRegressionSnapshot)
    try Q.encoded(trustedEnvelope).write(to: registry.appendingPathComponent("contracts/" + ticket.requestSHA256 + ".json"))
    try prepared.prepared.checkerBytes.write(to: registry.appendingPathComponent("checkers/" + trustedEnvelope.checkerSHA256 + ".py"))
    let loaded = try PreparedTaskQuality.prepare(objective: original, contextSHA256: Q.contextSHA(ticket), sourceSHA256: Q.sourceSHA(ticket),
        startTreeSHA256: weakBefore, scope: .workspaceWrite, referencePolicySHA256: ticket.policySHA256, workspace: workspace.path, rootURL: registry)
    try check(loaded?.frozenRegressionSnapshot?.originalTests == prepared.prepared.frozenRegressionSnapshot?.originalTests && loaded?.envelope.localEffectsOnly == true,
        "owner registration preserves original public suite and copied-checker isolation instead of losing its snapshot")
    try check(loaded?.reboundForContinuation(contextSHA256: Q.contextSHA(ticket), startTreeSHA256: weakBefore).envelope.localEffectsOnly == true,
        "registered local-effects declaration survives correction")
    let boundary = try Q.localEffectsBoundary(ticket: ticket, rootURL: registry)
    try check(boundary?.envelopeSHA256 == C.digest(try Q.encoded(trustedEnvelope)), "capability fence has exact original owner envelope provenance")
    // Synthetic fixture capability attestation; production may set this only
    // after exact actual native local-only policy/config verification.
    prepared.localOnlyVerified = true
    try put("module.py", "VALUE = 1\n")
    let native = NativeRecordEvidence(turnID: "fixture-turn", recordPath: "/tmp/fixture-native.jsonl", persistence: "verified", desktopVisibility: "fixture")
    func artifact(_ before: String) -> Artifact {
        .init(provider: "codex", action: "execute", permissionProfile: "workspace_write", model: "fixture", effort: "low",
            executorContractVersion: "fixture", executorContractSHA256: hash, exitCode: 0, output: "Synthetic candidate preserved", stderr: "",
            durationMS: 1, workspaceBeforeHash: before, workspaceAfterHash: workspaceHash(workspace.path), nativeRecord: native)
    }
    let first = artifact(weakBefore), firstHash = C.digest(try Q.encoded(first))
    let result = try Q.finish(prepared, ticket: ticket, artifact: first, artifactSHA256: firstHash, workspace: workspace.path, root: witnesses)
    // A platform without the existing approved copied-Python runner must
    // preserve infrastructure unknown rather than counterfeit a known fail.
    if result.assessment.state != .mismatch {
        try check(result.assessment.state == .unverified, "checker infrastructure absence is unverified, never guessed failure")
        print("RCC operational witness: \(checks) checks PASS; actual checker failure continuation SKIP (approved Python infrastructure unavailable), model calls0")
        return
    }
    try check(result.descriptor?.coverage == .partial && result.descriptor?.failedCheckIDs.contains("partial.original_unittest") == true,
        "actual original-suite failure is bound and stays partial")
    func record(_ ticket: C.ExecutionTicket, _ checked: Q.Finished) -> C.ExecutionRecord {
        .init(taskID: ticket.taskID, nodeID: ticket.nodeID, attemptID: ticket.attemptID, candidateID: ticket.candidateID,
            configurationSHA256: hash, selectedConfig: selected, acknowledgedConfig: selected, observedConfig: nil, status: .succeeded,
            output: "Synthetic candidate preserved", executionVerified: true, taskVerified: false,
            taskQuality: checked.assessment.state == .mismatch ? .failed : .executionOnly, parityState: .unverified,
            nativeReceipt: receipts.appendingPathComponent(ticket.attemptID + ".json").path, sideEffects: .confirmed, usage: nil,
            dispatchStage: .dispatched, nativeTurnTerminated: true, operationalQuality: checked.descriptor)
    }
    let firstRecord = record(ticket, result), recordBytes = try C.encode(firstRecord), recordPath = firstRecord.nativeReceipt!
    try recordBytes.write(to: URL(fileURLWithPath: recordPath)); try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: recordPath)
    func input(_ t: C.ExecutionTicket, _ path: String, _ bytes: Data) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["schema": 1, "parent_ticket": JSONSerialization.jsonObject(with: C.encode(t)),
            "parent_native_receipt": path, "parent_native_receipt_sha256": C.digest(bytes)], options: [.sortedKeys])
    }
    let decisionInput = try input(ticket, recordPath, recordBytes)
    func action(_ data: Data) throws -> [String: Any] { try JSONSerialization.jsonObject(with: data) as! [String: Any] }
    let decided = try action(Q.decision(decisionInput, root: witnesses, authority: authority))
    try check(decided["action"] as? String == "correct", "actual completed local writer mismatch authorizes one existing-policy correction")
    try check(try Q.decision(decisionInput, root: witnesses, authority: authority) == Q.decision(decisionInput, root: witnesses, authority: authority), "decision is read-only and idempotent")
    try check(try action(Q.decision(decisionInput, root: witnesses, cancelled: true, authority: authority))["action"] as? String == "hold", "cancelled parent never corrects")
    try check(try action(Q.decision(decisionInput, root: witnesses, authority: .init(accountMatches: { _ in false }, policyMatches: { _ in true })))["action"] as? String == "hold", "changed active account cannot correct")
    try check(try action(Q.decision(decisionInput, root: witnesses, authority: .init(accountMatches: { _ in true }, policyMatches: { _ in false })))["action"] as? String == "hold", "changed policy cannot correct")
    let continuationBytes = try JSONSerialization.data(withJSONObject: decided["quality_continuation"]!)
    ticket.qualityContinuation = try JSONDecoder().decode(C.QualityContinuation.self, from: continuationBytes); ticket.attemptID = "attempt-correction"
    let date = try fm.attributesOfItem(atPath: workspace.appendingPathComponent("module.py").path)[.modificationDate] as! Date
    try put("module.py", "VALUE = 3\n"); try fm.setAttributes([.modificationDate: date], ofItemAtPath: workspace.appendingPathComponent("module.py").path)
    try reject("same-size same-time changed after-tree cannot consume correction") { try Q.claimCorrection(ticket: ticket, root: witnesses, authority: authority) }
    try put("module.py", "VALUE = 1\n"); try fm.setAttributes([.modificationDate: date], ofItemAtPath: workspace.appendingPathComponent("module.py").path)
    try Q.claimCorrection(ticket: ticket, root: witnesses, authority: authority)
    var second = ticket; second.attemptID = "attempt-duplicate"
    try reject("different attempt ID cannot reuse the same parent witness claim") { try Q.claimCorrection(ticket: second, root: witnesses, authority: authority) }
    guard var corrective = try Q.prepare(ticket: ticket, workspace: workspace.path, currentTreeSHA256: workspaceHash(workspace.path), root: witnesses, authority: authority) else {
        throw OS1Error.message("Operational corrective context missing")
    }
    corrective.localOnlyVerified = true
    try check(corrective.correctiveAttempts == 1 && corrective.prepared.frozenRegressionSnapshot?.originalTests == prepared.prepared.frozenRegressionSnapshot?.originalTests,
        "corrective context reuses immutable original suite and persisted one-attempt budget")
    try check(corrective.correctionPrompt?.contains(original) == true, "correction carries original instruction verbatim")
    // A second actual failed correction is held; no reference/third call.
    let failedAgain = artifact(workspaceHash(workspace.path)), againHash = C.digest(try Q.encoded(failedAgain))
    let checkedAgain = try Q.finish(corrective, ticket: ticket, artifact: failedAgain, artifactSHA256: againHash, workspace: workspace.path, root: witnesses)
    let againRecord = record(ticket, checkedAgain), againBytes = try C.encode(againRecord), againPath = againRecord.nativeReceipt!
    try againBytes.write(to: URL(fileURLWithPath: againPath)); try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: againPath)
    try check(try action(Q.decision(input(ticket, againPath, againBytes), root: witnesses, authority: authority))["action"] as? String == "hold", "failed corrective attempt cannot authorize a third/reference native call")
    try check(result.assessment.preservesArtifact && checkedAgain.assessment.preservesArtifact, "both failed actual artifacts remain preserved")
    print("RCC operational original-suite/witness/one-use correction: \(checks) checks PASS; actual local checker calls only, provider/auth calls0")
}

/// Per-attempt native permission capability, not another task coordinator.
/// It confines model-controlled tools; provider/auth/logging and audited native
/// lifecycle cleanup remain the explicitly identified maintenance TCB.
final class RCCNativeLocalQualityProfile: @unchecked Sendable {
    enum Context { @TaskLocal static var current: RCCNativeLocalQualityProfile? }
    static let profileID = "os1-local-quality"
    let ticket: RCCRuntimeContract.ExecutionTicket
    let workspace: String
    let scratch: String
    let boundary: RCCOperationalQuality.LocalEffectsBoundary?
    private(set) var verified = false
    private(set) var attestationEligible = true
    var localOnlyVerified: Bool { verified && attestationEligible }
    private var trustStateDigest: String?
    private var unresolvedPluginIDs: [String] = []
    private var sourceHashes: [String: String] = [:]
    private var hooksDigest: String?
    private var nativeExecutable: String?
    private(set) var receiptSHA256: String?
    init(ticket: RCCRuntimeContract.ExecutionTicket, workspace: String, boundary: RCCOperationalQuality.LocalEffectsBoundary? = nil) throws {
        let fm = FileManager.default, root = URL(fileURLWithPath: workspace).standardizedFileURL
        guard root.resolvingSymlinksInPath().path == root.path, root.path != fm.homeDirectoryForCurrentUser.path else { throw RCCOperationalQuality.Failure.custody }
        // Darwin's per-user directory is authority; an inherited TMPDIR is
        // not. macOS may render this same directory as /var or /private/var.
        let length = confstr(_CS_DARWIN_USER_TEMP_DIR, nil, 0)
        guard length > 1, length <= 4096 else { throw RCCOperationalQuality.Failure.custody }
        var buffer = [CChar](repeating: 0, count: length)
        guard confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, length) == length else { throw RCCOperationalQuality.Failure.custody }
        let temporary = URL(fileURLWithPath: String(cString: buffer), isDirectory: true).resolvingSymlinksInPath()
        var parent = stat()
        guard temporary.path.hasPrefix("/"), temporary.lastPathComponent == "T", lstat(temporary.path, &parent) == 0,
            parent.st_mode & S_IFMT == S_IFDIR, parent.st_uid == getuid(), parent.st_mode & 0o022 == 0 else { throw RCCOperationalQuality.Failure.custody }
        let child = temporary.appendingPathComponent("os1-local-quality-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: child, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        self.ticket = ticket; self.workspace = root.path; self.scratch = child.path; self.boundary = boundary
    }
    var environment: [String: String] { ["TMPDIR": scratch] }
    static func key(_ s: String) -> Bool { !s.isEmpty && s.utf8.count <= 256 && s.utf8.allSatisfy { (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45,95,64].contains($0) } }
    static func toml(_ s: String) -> String { String(decoding: try! JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed, .withoutEscapingSlashes]), as: UTF8.self) }
    // Native 0.163 command/exec canary: :minimal alone still permits shared
    // /tmp. Deny that implicit alias explicitly; exact workspace/scratch paths
    // retain their declared access (the native policy gives narrower paths priority).
    // Public contract: https://learn.chatgpt.com/docs/permissions
    var fixedOverrides: [String] {
        ["default_permissions=\(Self.toml(Self.profileID))",
         "permissions.\(Self.profileID).filesystem={\":minimal\"=\"read\",\":slash_tmp\"=\"deny\",\(Self.toml(workspace))=\(Self.toml(ticket.selectedConfig.scope == .readOnly ? "read" : "write")),\(Self.toml(scratch))=\"write\"}",
         "permissions.\(Self.profileID).network.enabled=false",
         "features.apps=false", "features.browser_use=false", "features.browser_use_external=false", "features.computer_use=false",
         "features.js_repl=false", "features.remote_control=false", "features.memories=false", "web_search=\"disabled\"", "tools.web_search=false"]
    }
    static func rowsEmpty(_ value: Any?) -> Bool {
        if value == nil || value is NSNull { return true }
        if let a = value as? [Any] { return a.isEmpty }; if let a = value as? [String: Any] { return a.isEmpty }; return false
    }
    func bindFile(_ path: String, expected: String? = nil, expectedAny: Set<String>? = nil) throws {
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.path == path, url.resolvingSymlinksInPath() == url else { throw RCCOperationalQuality.Failure.custody }
        var before = stat(); guard lstat(path, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
            before.st_size > 0, before.st_size < 256_000_000 else { throw RCCOperationalQuality.Failure.custody }
        let fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); guard fd >= 0 else { throw RCCOperationalQuality.Failure.custody }; defer { close(fd) }
        let data = try FileHandle(fileDescriptor: fd, closeOnDealloc: false).readToEnd() ?? Data()
        var after = stat(), named = stat()
        guard fstat(fd, &after) == 0, lstat(path, &named) == 0,
            before.st_dev == after.st_dev, before.st_ino == after.st_ino, before.st_size == data.count,
            before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
            before.st_ino == named.st_ino, before.st_size == named.st_size else { throw RCCOperationalQuality.Failure.custody }
        let hash = TaskQualityEvidence.digest(data)
        guard expected.map({ $0 == hash }) ?? true, expectedAny.map({ $0.contains(hash) }) ?? true,
            sourceHashes[path].map({ $0 == hash }) ?? true else { throw RCCOperationalQuality.Failure.custody }
        sourceHashes[path] = hash
    }
    /// Exact audited commands are either early-bypassed or inactive under the
    /// actual marked native environment; no unknown command is assumed inert.
    func validateHooks(_ result: [String: Any], environment: [String: String]) throws {
        guard let entries = result["data"] as? [[String: Any]], entries.count == 1,
            entries[0]["cwd"] as? String == workspace, Self.rowsEmpty(entries[0]["errors"]),
            let hooks = entries[0]["hooks"] as? [[String: Any]], hooks.count <= 128 else { throw RCCOperationalQuality.Failure.unavailable }
        let exo = "610e48709d7747ed30109dcfa1c81e736db8748f938345a3d05d5f2e1f9cc00c"
        let superset = "f6e82c5a662c338cac8a5fd43a98b364c2df0175dffb95408e69e2454d73e0bc"
        let emdash = Set(["dd12748c47c371e16e29b7ac99c17c0021d98df00e6ed36f6a5d3014b00ffa2a", "685483cc63e594ebb518b3d67380b8baeba2b898174f945acdcefaef727012ce", "1c67a66cf60e0d8c2dd28cc96b8726e1d0515121bc7aed6894ecae8e3014c0b4"])
        for row in hooks {
            guard row["enabled"] as? Bool == true, row["trustStatus"] as? String == "trusted",
                row["handlerType"] as? String == "command", row["async"] as? Bool == false,
                row["isManaged"] as? Bool == false,
                let command = row["command"] as? String, command.utf8.count <= 16_384,
                let path = row["sourcePath"] as? String else { throw RCCOperationalQuality.Failure.unavailable }
            let hash = TaskQualityEvidence.digest(Data(command.utf8))
            if hash == exo {
                guard environment["OS1_INTERNAL_PROVIDER_EXECUTION"] == "1", let executing = Bundle.main.executableURL else { throw RCCOperationalQuality.Failure.unavailable }
                let hook = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/os1").resolvingSymlinksInPath()
                let current = executing.resolvingSymlinksInPath()
                try bindFile(current.path); let expected = sourceHashes[current.path]!
                try bindFile(hook.path, expected: expected)
                let bundled = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/OS-1 CLODEX.app/Contents/Resources/os1")
                if FileManager.default.fileExists(atPath: bundled.path) { try bindFile(bundled.path, expected: expected) }
            }
            else if hash == superset { guard environment["SUPERSET_HOME_DIR"] == nil else { throw RCCOperationalQuality.Failure.unavailable } }
            else if emdash.contains(hash) { guard !environment.keys.contains(where: { $0.hasPrefix("EMDASH_") }) else { throw RCCOperationalQuality.Failure.unavailable } }
            else { throw RCCOperationalQuality.Failure.unavailable }
            try bindFile(path)
        }
        let data = try JSONSerialization.data(withJSONObject: hooks, options: [.sortedKeys])
        let digest = TaskQualityEvidence.digest(data)
        guard hooksDigest.map({ $0 == digest }) ?? true else { throw RCCOperationalQuality.Failure.custody }
        hooksDigest = digest
    }
    // Closed, per-name reviewed manifest bytes. Both generations contain only
    // the same fixed native turn_ended cleanup handlers. Unknown future bytes
    // still fail; neither a vendor name nor a version string grants authority.
    // Provenance: docs/NATIVE_CLEANUP_MANIFESTS.md.
    static let cleanupManifestHashes: [String: Set<String>] = [
        "browser": ["188f075c18e33ff9ac5ea55bc5ac463ff385cbdf283b8afd5a45015586c8859f", "dc57e56fe6d9377479e2cfc8e3898908682a543ffb323b04fd1622a355f4005a"],
        "chrome": ["4c985d7ed75fdffab590c59fa1da639595381a1c9327a4b9cd9d09e003eb8656", "249fd81494e73350cfbc30b788c63c43e47076387e3ed56f6d3c21e792ae241e"],
        "unified-computer-use": ["39d5b863cc3ba6705b65ba5177bca8929e789ee6203a5e50dffcd331367a4abd", "4de0b181599745fdf004bb38a7804fb60f0a631937c03ccd9bce03f3eb31851a"],
    ]
    func pluginOverrides(_ plugins: [[String: Any]], mcp: [[String: Any]], config: [String: Any]) throws -> [String] {
        var overrides = Set<String>()
        if let roots = config["mcp_servers"] as? [String: Any] {
            for name in roots.keys { guard Self.key(name) else { throw RCCOperationalQuality.Failure.unavailable }; overrides.insert("mcp_servers.\(name).enabled=false") }
        }
        for row in mcp {
            guard let name = row["name"] as? String, Self.key(name) else { throw RCCOperationalQuality.Failure.unavailable }
            if let id = row["pluginId"] as? String {
                guard Self.key(id) else { throw RCCOperationalQuality.Failure.unavailable }
                overrides.insert("plugins.\(id).mcp_servers.\(name).enabled=false")
            } else { overrides.insert("mcp_servers.\(name).enabled=false") }
        }
        guard plugins.count <= 128 else { throw RCCOperationalQuality.Failure.unavailable }
        for plugin in plugins {
            guard let summary = plugin["summary"] as? [String: Any], let id = summary["id"] as? String, Self.key(id) else { throw RCCOperationalQuality.Failure.unavailable }
            if plugin["unavailable"] as? Bool == true {
                guard let source = summary["source"] as? [String: Any], source["type"] as? String == "remote",
                    id.hasPrefix("app-") || id.hasPrefix("dev-") else { throw RCCOperationalQuality.Failure.unavailable }
                attestationEligible = false; unresolvedPluginIDs.append(id); continue
            }
            guard let hooks = plugin["hooks"] as? [[String: Any]],
                let servers = plugin["mcpServers"] as? [String], servers.count <= 128 else { throw RCCOperationalQuality.Failure.unavailable }
            for server in servers { guard Self.key(server) else { throw RCCOperationalQuality.Failure.unavailable }; overrides.insert("plugins.\(id).mcp_servers.\(server).enabled=false") }
            if !hooks.isEmpty {
                guard hooks.count == 3, let name = summary["name"] as? String, let expected = Self.cleanupManifestHashes[name],
                    let source = summary["source"] as? [String: Any], source["type"] as? String == "local",
                    let root = source["path"] as? String,
                    Set(hooks.compactMap { $0["eventName"] as? String }) == Set(["stop", "interrupt", "subagentStop"]) else { throw RCCOperationalQuality.Failure.unavailable }
                let base = URL(fileURLWithPath: root).standardizedFileURL
                guard base.path == root, base.resolvingSymlinksInPath().path == base.path else { throw RCCOperationalQuality.Failure.custody }
                let manifest = base.appendingPathComponent(".codex-plugin/plugin.json")
                try bindFile(manifest.path, expectedAny: expected)
            }
        }
        return overrides.sorted()
    }
    func bindTrustState(_ config: [String: Any]) throws {
        guard let hooks = config["hooks"] as? [String: Any], let state = hooks["state"] as? [String: Any], state.count <= 1024 else { throw RCCOperationalQuality.Failure.unavailable }
        for (key, value) in state {
            guard key.utf8.count <= 4096, let row = value as? [String: Any], row.count == 1,
                let hash = row["trusted_hash"] as? String, hash.utf8.count <= 128 else { throw RCCOperationalQuality.Failure.unavailable }
        }
        let digest = TaskQualityEvidence.digest(try JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]))
        guard trustStateDigest.map({ $0 == digest }) ?? true else { throw RCCOperationalQuality.Failure.custody }; trustStateDigest = digest
        // Official native plugin_hook_key_source + hook_key namespaces and
        // actual native keys match pluginID + ':'. Unavailable definitions are
        // not called empty; without a trust grant their executable hooks are
        // held by the native trust gate. Managed/unknown active hooks above
        // remain rejected; no bypass-hook-trust flag is ever supplied.
        guard unresolvedPluginIDs.allSatisfy({ id in !id.contains(":") && !state.keys.contains(where: { $0.hasPrefix(id + ":") }) }) else { throw RCCOperationalQuality.Failure.unavailable }
        if !unresolvedPluginIDs.isEmpty { attestationEligible = true }
    }
    func verifyConfiguration(_ config: [String: Any]) throws {
        try bindTrustState(config)
        try verifyMaintenanceNotify(config)
        guard config["default_permissions"] as? String == Self.profileID,
            config["bypass_hook_trust"] as? Bool != true,
            config["web_search"] as? String == "disabled", let features = config["features"] as? [String: Any],
            features["hooks"] as? Bool == true,
            ["apps", "browser_use", "browser_use_external", "computer_use", "js_repl", "remote_control", "memories"].allSatisfy({ features[$0] as? Bool == false }),
            let permissions = config["permissions"] as? [String: Any], let profile = permissions[Self.profileID] as? [String: Any],
            Self.rowsEmpty(profile["extends"]), let network = profile["network"] as? [String: Any], network["enabled"] as? Bool == false,
            network.allSatisfy({ $0.key == "enabled" || Self.rowsEmpty($0.value) }), Self.rowsEmpty(profile["workspace_roots"]),
            let filesystem = profile["filesystem"] as? [String: Any], Set(filesystem.keys).isSubset(of: [":minimal", ":slash_tmp", workspace, scratch, "glob_scan_max_depth"]),
            Self.rowsEmpty(filesystem["glob_scan_max_depth"]), filesystem[":minimal"] as? String == "read",
            filesystem[":slash_tmp"] as? String == "deny",
            filesystem[workspace] as? String == (ticket.selectedConfig.scope == .readOnly ? "read" : "write"),
            filesystem[scratch] as? String == "write" else { throw RCCOperationalQuality.Failure.unavailable }
    }
    func verifyThread(_ result: [String: Any], mcp: [[String: Any]]) throws {
        guard let permission = result["activePermissionProfile"] as? [String: Any], permission["id"] as? String == Self.profileID,
            Self.rowsEmpty(permission["extends"]), result["approvalPolicy"] as? String == "never",
            result["runtimeWorkspaceRoots"] as? [String] == [workspace, scratch],
            mcp.count <= 256, mcp.allSatisfy({ row in
                row["runtimeStatus"] as? String == "disabled" && Self.rowsEmpty(row["tools"]) && Self.rowsEmpty(row["resources"]) &&
                Self.rowsEmpty(row["resourceTemplates"]) && Self.rowsEmpty(row["toolsError"])
            }) else { throw RCCOperationalQuality.Failure.unavailable }
    }
    func finishObservation() {
        do { for (path, hash) in sourceHashes { try bindFile(path, expected: hash) } }
        catch { verified = false }
    }
    func beforeDispatch() throws {
        guard !ExecutionCancellation.isCancelled, verified, ticket.qualityContinuation == nil || localOnlyVerified else { throw RCCOperationalQuality.Failure.unavailable }
        for (path, hash) in sourceHashes { try bindFile(path, expected: hash) }
        // Read-only decisions do not spend this capability. Claim only at the
        // actual native turn boundary; a crash/opaque failure never refunds it.
        if ticket.qualityContinuation != nil { try RCCOperationalQuality.claimCorrection(ticket: ticket) }
    }
    // Qualified by actual writer/read-only named-profile canaries, with host
    // positive controls and no model turns. This is one exact compatibility
    // tuple, not permission to trust arbitrary future signed SDKs.
    static let qualifiedNativeLauncherSHA256 = "50ab38ba21d0d9f8346f32f41848382f15b556190f3c7a07e885a4fb73e379c8"
    static let qualifiedNativeBackendSHA256 = "1afb28c01d7d49e892bd75f11076b10f1451e34e0ee308a95e5ab7f69f9c84fe"
    // Exact subsequent tuple independently exercised by the same zero-model
    // command/exec read/write canary, including actual network/outside-read
    // negative controls. See docs/NATIVE_LOCAL_QUALIFICATION.md. This does not
    // qualify other binaries, LLM tools, current plugin state or task quality.
    static let qualifiedCurrentNativeBackendSHA256 = "9394a943e3fce54f998ecc150eb0b7d6e22ce0da48e5063c59b4883e80aeaecd"
    static func qualifiedNativeVersion(launcherSHA256: String, backendSHA256: String) -> String? {
        guard launcherSHA256 == qualifiedNativeLauncherSHA256 else { return nil }
        switch backendSHA256 {
        case qualifiedNativeBackendSHA256: return "codex-cli 0.163.0-alpha.10.2"
        case qualifiedCurrentNativeBackendSHA256: return "codex-cli 0.163.0-alpha.11.1"
        default: return nil
        }
    }
    func bindNative(executable: String) throws {
        let wrapper = URL(fileURLWithPath: executable).resolvingSymlinksInPath().standardizedFileURL
        // The installed official launcher is itself a tiny pinned source
        // whose exact bytes resolve this signed native binary. Future unknown
        // binaries must be revalidated, not silently inherit this canary.
        try bindFile(wrapper.path, expected: Self.qualifiedNativeLauncherSHA256)
        let binary = wrapper.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("CodexCLI.app/Contents/MacOS/codex")
        try bindFile(binary.path)
        guard let launcherHash = sourceHashes[wrapper.path], let backendHash = sourceHashes[binary.path],
            Self.qualifiedNativeVersion(launcherSHA256: launcherHash, backendSHA256: backendHash) != nil else {
            throw RCCOperationalQuality.Failure.unavailable
        }
        nativeExecutable = binary.path
    }
    func verifyRunningNative(pid: Int32) throws {
        var bytes = [CChar](repeating: 0, count: 4096)
        guard pid > 0, pid != getpid(), proc_pidpath(pid, &bytes, UInt32(bytes.count)) > 0,
            let expected = nativeExecutable,
            URL(fileURLWithPath: String(cString: bytes)).resolvingSymlinksInPath().path == expected else { throw RCCOperationalQuality.Failure.custody }
    }
    // Exact compatibility proposal; vendor-source review and a fresh zero-turn
    // native metadata preflight are required before release adoption. A name,
    // signature or arbitrary future notification binary is not sufficient.
    static let maintenanceNotifyHashes: Set<String> = [
        "4861d29eb73f6f71a5a82dc94fc7c696d34e8cd6493f1932f6ba7b51f6448cf5",
        "2f8ac721dcadb98745c545b6fd0d37f38d48e892d929a7a3b41476838d6a66d5",
    ]
    func verifyMaintenanceNotify(_ config: [String: Any]) throws {
        if Self.rowsEmpty(config["notify"]) { return }
        guard let values = config["notify"] as? [String], values.count == 2, values[1] == "turn-ended",
            values[0].hasSuffix("/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient") else { throw RCCOperationalQuality.Failure.unavailable }
        try bindFile(values[0], expectedAny: Self.maintenanceNotifyHashes)
    }
    func recordVerified(executable: String) throws {
        try bindNative(executable: executable)
        let wrapper = URL(fileURLWithPath: executable).resolvingSymlinksInPath().standardizedFileURL.path
        guard let hooksDigest, let nativeExecutable,
            let launcherHash = sourceHashes[wrapper], let backendHash = sourceHashes[nativeExecutable],
            let nativeVersion = Self.qualifiedNativeVersion(launcherSHA256: launcherHash, backendSHA256: backendHash)
            else { throw RCCOperationalQuality.Failure.unavailable }
        let payload: [String: Any] = ["schema": 1, "task_id": ticket.taskID, "node_id": ticket.nodeID, "attempt_id": ticket.attemptID,
            "configuration_sha256": ticket.configurationSHA256, "source_fingerprint": ticket.sourceFingerprint,
            "policy_sha256": ticket.policySHA256, "workspace": workspace, "scratch": scratch,
            "profile": Self.profileID, "native_version": nativeVersion, "source_hashes": sourceHashes, "hooks_sha256": hooksDigest,
            "unresolved_plugin_ids": unresolvedPluginIDs, "local_only_attestation": attestationEligible,
            "native_hook_trust_state_sha256": trustStateDigest ?? "",
            "original_owner_boundary_envelope_sha256": boundary?.envelopeSHA256 ?? "",
            "original_owner_boundary_objective_sha256": boundary?.originalObjectiveSHA256 ?? "",
            "maintenance_tcb": "native provider/auth/rollout and audited fixed lifecycle cleanup; not zero OS IPC"]
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let folder = RCCOperationalQuality.root.deletingLastPathComponent().appendingPathComponent("local-quality-profiles")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = folder.appendingPathComponent(ticket.attemptID + ".json")
        let fd = open(file.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw RCCOperationalQuality.Failure.custody }; defer { close(fd) }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false); try handle.write(contentsOf: data); try handle.synchronize()
        receiptSHA256 = TaskQualityEvidence.digest(data); verified = true
    }
}

func rccNativeLocalQualityProfileSelfTest() throws {
    typealias C = RCCRuntimeContract
    let fm = FileManager.default, workspace = fm.temporaryDirectory.appendingPathComponent("os1-profile-fixture-" + UUID().uuidString).resolvingSymlinksInPath()
    try fm.createDirectory(at: workspace, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: workspace) }
    let h = C.digest(Data("fixture".utf8)), instruction = "Run only the declared local public checks."
    let host = C.HostContext(workspace: workspace.path, context: nil, providerPreference: "auto", codexSessionID: nil, claudeSessionID: nil, requireReadOnly: false, ownerPolicy: nil)
    let config = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture", model: "fixture", effort: .low,
        tools: ["Bash"], scope: .workspaceWrite, permissionProfile: .workspaceWrite, quotaPool: .openAICodex, allowedPaths: ["**"], configurationSHA256: h)
    var ticket = C.ExecutionTicket(taskID: "task", nodeID: "node", attemptID: "attempt", candidateID: "candidate", requestSHA256: C.digest(Data(instruction.utf8)),
        policySHA256: h, policySourceSHA256: h, sourceFingerprint: C.digest(try C.encode(host)), configurationSHA256: h, selectedConfig: config,
        objective: instruction, instruction: instruction, contextRefs: [], ownedPaths: ["**"], originalRequest: instruction, originalObjective: instruction, hostContext: host)
    let profile: RCCNativeLocalQualityProfile
    do { profile = try RCCNativeLocalQualityProfile(ticket: ticket, workspace: workspace.path) }
    catch { throw OS1Error.message("Native local profile fixture initial canonical workspace/scratch: \(error)") }
    defer { try? fm.removeItem(atPath: profile.scratch) }
    var checks = 0
    func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws { guard try condition() else { throw OS1Error.message("Native local profile fixture: " + message) }; checks += 1 }
    func reject(_ message: String, _ body: () throws -> Void) throws { do { try body() } catch { checks += 1; return }; throw OS1Error.message("Native local profile fixture: " + message) }
    let launcherHash = RCCNativeLocalQualityProfile.qualifiedNativeLauncherSHA256
    let backendHash = RCCNativeLocalQualityProfile.qualifiedNativeBackendSHA256
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: launcherHash, backendSHA256: backendHash) == "codex-cli 0.163.0-alpha.10.2", "qualified exact tuple has truthful version")
    let currentBackendHash = RCCNativeLocalQualityProfile.qualifiedCurrentNativeBackendSHA256
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: launcherHash, backendSHA256: currentBackendHash) == "codex-cli 0.163.0-alpha.11.1", "subsequent measured tuple has its own truthful version")
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: launcherHash, backendSHA256: currentBackendHash) != "codex-cli 0.163.0-alpha.10.2", "new tuple cannot claim old measured version")
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: launcherHash, backendSHA256: backendHash) != "codex-cli 0.163.0-alpha.11.1", "old tuple cannot claim new measured version")
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: currentBackendHash, backendSHA256: launcherHash) == nil, "subsequent tuple cannot be reversed")
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: backendHash, backendSHA256: launcherHash) == nil, "swapped tuple is not equivalent")
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: h, backendSHA256: backendHash) == nil, "unknown launcher cannot inherit qualification")
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: launcherHash, backendSHA256: h) == nil, "unknown backend cannot inherit qualification")
    try check(RCCNativeLocalQualityProfile.qualifiedNativeVersion(launcherSHA256: launcherHash, backendSHA256: "0d5ac7aae20c4eda6242428d5e218c55ba96d8763fda2a271088ff37104b9d28") == nil, "old SDK cannot claim new version canary")
    let unknownLauncher = workspace.appendingPathComponent("unknown-native-launcher")
    try Data("#!/bin/sh\nexit 0\n".utf8).write(to: unknownLauncher)
    try reject("unqualified executable fails binding without a process") { try profile.bindNative(executable: unknownLauncher.path) }
    var effective: [String: Any] = ["default_permissions": RCCNativeLocalQualityProfile.profileID, "web_search": "disabled", "bypass_hook_trust": false,
        "features": ["hooks": true, "apps": false, "browser_use": false, "browser_use_external": false, "computer_use": false, "js_repl": false, "remote_control": false, "memories": false],
        "hooks": ["state": [:]], "permissions": [RCCNativeLocalQualityProfile.profileID: ["extends": NSNull(), "workspace_roots": NSNull(),
            "filesystem": [":minimal": "read", ":slash_tmp": "deny", workspace.path: "write", profile.scratch: "write", "glob_scan_max_depth": NSNull()],
            "network": ["enabled": false, "unix_sockets": NSNull(), "allow_local_binding": NSNull()]]]]
    do { try profile.verifyConfiguration(effective) }
    catch { throw OS1Error.message("Native local profile fixture normalized effective config: \(error)") }
    checks += 1
    try check(!RCCNativeLocalQualityProfile.toml(workspace.path).contains("\\/"), "TOML path serialization must not emit JSON-only slash escapes")
    try check(profile.fixedOverrides.contains(where: { $0.contains(RCCNativeLocalQualityProfile.toml(workspace.path)) && $0.contains(RCCNativeLocalQualityProfile.toml(profile.scratch)) }), "exact roots, not dynamic cwd or broad tmp grant")
    try check(profile.fixedOverrides.contains(where: { $0.contains("\":slash_tmp\"=\"deny\"") }), "shared slash-tmp deny is explicit in process profile")
    try check(!profile.fixedOverrides.contains("bypass_hook_trust=false"), "ignored process hook-trust key is omitted; owned thread binding remains false")
    // Actual native canary qualified this exact deny while workspace and
    // private scratch still wrote successfully. A missing/rewritten token
    // cannot inherit that observation just because other fields look safe.
    for invalid: Any in ["read", "write", true, NSNull(), [".": "deny"]] {
        var ps = effective["permissions"] as! [String: Any], entry = ps[RCCNativeLocalQualityProfile.profileID] as! [String: Any]
        var fs = entry["filesystem"] as! [String: Any]; fs[":slash_tmp"] = invalid
        entry["filesystem"] = fs; ps[RCCNativeLocalQualityProfile.profileID] = entry
        var changed = effective; changed["permissions"] = ps
        try reject("slash-tmp deny must be exact native string, not weaker/unknown/structured access") { try profile.verifyConfiguration(changed) }
    }
    do {
        var ps = effective["permissions"] as! [String: Any], entry = ps[RCCNativeLocalQualityProfile.profileID] as! [String: Any]
        var fs = entry["filesystem"] as! [String: Any]; fs.removeValue(forKey: ":slash_tmp")
        entry["filesystem"] = fs; ps[RCCNativeLocalQualityProfile.profileID] = entry
        var changed = effective; changed["permissions"] = ps
        try reject("missing shared slash-tmp deny cannot pass a local-only profile") { try profile.verifyConfiguration(changed) }
    }
    try check(profile.fixedOverrides.contains(where: { $0.contains(RCCNativeLocalQualityProfile.toml(workspace.path) + "=\"write\"") && $0.contains(RCCNativeLocalQualityProfile.toml(profile.scratch) + "=\"write\"") }), "writer workspace and exact private scratch remain writable")
    var profiles = effective["permissions"] as! [String: Any], row = profiles[RCCNativeLocalQualityProfile.profileID] as! [String: Any]
    var files = row["filesystem"] as! [String: Any]; files["/tmp"] = "write"; row["filesystem"] = files; profiles[RCCNativeLocalQualityProfile.profileID] = row
    var bad = effective; bad["permissions"] = profiles
    try reject("merged extra filesystem grant") { try profile.verifyConfiguration(bad) }
    profiles = effective["permissions"] as! [String: Any]; row = profiles[RCCNativeLocalQualityProfile.profileID] as! [String: Any]
    row["network"] = ["enabled": false, "dangerously_allow_all_unix_sockets": true]; profiles[RCCNativeLocalQualityProfile.profileID] = row; bad = effective; bad["permissions"] = profiles
    try reject("network false does not wash active unix-socket exception") { try profile.verifyConfiguration(bad) }
    bad = effective; bad["bypass_hook_trust"] = true
    try reject("exposed hook-trust bypass rejected") { try profile.verifyConfiguration(bad) }
    bad = effective; bad.removeValue(forKey: "bypass_hook_trust")
    try profile.verifyConfiguration(bad); checks += 1 // hidden field is not falsely called observed; owned thread request supplies false.
    try reject("unknown active hook handler cannot be guessed safe") { try profile.validateHooks(["data": [["cwd": workspace.path, "errors": [], "hooks": [["enabled": true, "trustStatus": "trusted", "handlerType": "agent", "async": false, "isManaged": false, "command": "unknown", "sourcePath": workspace.path]]]]], environment: [:]) }
    try profile.validateHooks(["data": [["cwd": workspace.path, "errors": [], "hooks": []]]], environment: [:]); checks += 1
    let ack: [String: Any] = ["activePermissionProfile": ["id": RCCNativeLocalQualityProfile.profileID, "extends": NSNull()], "approvalPolicy": "never", "runtimeWorkspaceRoots": [workspace.path, profile.scratch]]
    let mcp: [[String: Any]] = [["name": "fixture", "runtimeStatus": "disabled", "tools": [:], "resources": [], "resourceTemplates": [], "toolsError": NSNull()]]
    try profile.verifyThread(ack, mcp: mcp); checks += 1
    var live = mcp; live[0]["tools"] = ["danger": [:]]
    try reject("disabled label cannot wash active MCP tools") { try profile.verifyThread(ack, mcp: live) }
    var foreign = ack; foreign["runtimeWorkspaceRoots"] = [workspace.path, "/tmp"]
    try reject("foreign scratch in actual ACK") { try profile.verifyThread(foreign, mcp: mcp) }
    let remote = ["summary": ["id": "app-fixture@remote", "source": ["type": "remote"]], "unavailable": true] as [String: Any]
    _ = try profile.pluginOverrides([remote], mcp: [], config: [:])
    try check(!profile.attestationEligible, "remote404 is unresolved, not called an empty hook definition")
    var granted = effective; granted["hooks"] = ["state": ["app-fixture@remote:plugin.json#hooks[0]:stop:0:0": ["trusted_hash": "sha256:" + h]]]
    try reject("unknown remote trusted namespace cannot become inert") { try profile.bindTrustState(granted) }
    let local = ["summary": ["id": "browser@openai-bundled", "source": ["type": "local", "path": workspace.path]], "unavailable": true] as [String: Any]
    try reject("local/builtin failed definition cannot use remote exception") { _ = try profile.pluginOverrides([local], mcp: [], config: [:]) }
    func cleanupPlugin(_ name: String, _ bytes: Data,
                       events: [String] = ["stop", "interrupt", "subagentStop"]) throws -> [String: Any] {
        let root = workspace.appendingPathComponent("cleanup-fixture-" + UUID().uuidString)
        try fm.createDirectory(at: root.appendingPathComponent(".codex-plugin"), withIntermediateDirectories: true,
                              attributes: [.posixPermissions: 0o700])
        try bytes.write(to: root.appendingPathComponent(".codex-plugin/plugin.json"))
        return ["summary": ["id": name + "@openai-bundled", "name": name,
                            "source": ["type": "local", "path": root.path]],
                "hooks": events.map { ["eventName": $0] },
                "mcpServers": name == "unified-computer-use" ? ["cua_repl"] : []]
    }
    try check(Set(RCCNativeLocalQualityProfile.cleanupManifestHashes.keys) == Set(["browser", "chrome", "unified-computer-use"]) &&
              RCCNativeLocalQualityProfile.cleanupManifestHashes.values.allSatisfy({ $0.count == 2 }),
              "only the two exact reviewed generations of three cleanup manifests are eligible")
    for (name, current) in NativeCleanupManifestFixtures.reviewed.sorted(by: { $0.key < $1.key }) {
        let currentText = String(decoding: current, as: UTF8.self)
        for version in ["26.1013.40934", "26.1016.61520"] {
            let bytes = Data(currentText.replacingOccurrences(of: "26.1016.61520", with: version).utf8)
            try check(RCCNativeLocalQualityProfile.cleanupManifestHashes[name]?.contains(TaskQualityEvidence.digest(bytes)) == true,
                      "exact reconstructed/actual \(name) \(version) fixture SHA is pinned")
            let manifest = try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
            let hooks = (manifest["hooks"] as! [String: Any])["hooks"] as! [String: [[String: Any]]]
            try check(Set(hooks.keys) == Set(["Stop", "Interrupt", "SubagentStop"]), "fixed cleanup events only")
            for (event, rows) in hooks {
                guard rows.count == 1, let items = rows[0]["hooks"] as? [[String: Any]], items.count == 1 else {
                    throw OS1Error.message("Native cleanup fixture has unexpected handler count")
                }
                let handler = items[0], input = handler["input"] as? [String: String]
                try check(Set(handler.keys) == Set(["type", "server", "tool", "input"]) &&
                          handler["type"] as? String == "mcp_tool" && handler["tool"] as? String == "turn_ended" &&
                          handler["server"] as? String == (name == "unified-computer-use" ? "cua_repl" : "node_repl") &&
                          input == ["hook_event_name": "${hook_event_name}", "session_id": event == "SubagentStop" ? "${agent_id}" : "${session_id}", "turn_id": "${turn_id}"],
                          "only the fixed native cleanup call is present, not a command hook")
            }
            let overrides = try profile.pluginOverrides([cleanupPlugin(name, bytes)], mcp: [], config: [:])
            try check(name == "unified-computer-use" ? overrides == ["plugins.unified-computer-use@openai-bundled.mcp_servers.cua_repl.enabled=false"] : overrides.isEmpty,
                      "reviewed manifest does not grant tools or disable hooks")
        }
        for malformed in ["", "not-a-hash", String(repeating: "a", count: 63), String(repeating: "A", count: 64)] {
            try check(RCCNativeLocalQualityProfile.cleanupManifestHashes[name]?.contains(malformed) == false,
                      "malformed hash is never a version/name fallback")
        }
        let future = Data(currentText.replacingOccurrences(of: "26.1016.61520", with: "99.0.0").utf8)
        try reject("unreviewed future bytes remain rejected") { _ = try profile.pluginOverrides([cleanupPlugin(name, future)], mcp: [], config: [:]) }
        try reject("same semantic JSON with changed bytes is not approved") { _ = try profile.pluginOverrides([cleanupPlugin(name, current + Data([10]))], mcp: [], config: [:]) }
        let other = name == "browser" ? "chrome" : "browser"
        try reject("another reviewed name cannot borrow this manifest hash") { _ = try profile.pluginOverrides([cleanupPlugin(other, current)], mcp: [], config: [:]) }
        try reject("approved bytes do not wash unsupported hook events") { _ = try profile.pluginOverrides([cleanupPlugin(name, current, events: ["stop", "interrupt", "unknown"])], mcp: [], config: [:]) }
    }
    try reject("unknown cleanup name cannot inherit a known vendor hash") {
        _ = try profile.pluginOverrides([cleanupPlugin("unknown-cleanup", NativeCleanupManifestFixtures.reviewed["browser"]!)], mcp: [], config: [:])
    }
    try check(!profile.localOnlyVerified, "manifest eligibility alone does not attest a native execution profile")
    ticket.selectedConfig.scope = .readOnly; ticket.selectedConfig.permissionProfile = .readOnly
    let read = try RCCNativeLocalQualityProfile(ticket: ticket, workspace: workspace.path)
    defer { try? fm.removeItem(atPath: read.scratch) }
    try check(read.fixedOverrides.contains(where: { $0.contains(RCCNativeLocalQualityProfile.toml(workspace.path) + "=\"read\"") }), "read-only child cannot inherit write grant")
    do {
        var ps = effective["permissions"] as! [String: Any], entry = ps[RCCNativeLocalQualityProfile.profileID] as! [String: Any]
        entry["filesystem"] = [":minimal": "read", ":slash_tmp": "deny", workspace.path: "read", read.scratch: "write"]
        ps[RCCNativeLocalQualityProfile.profileID] = entry
        var validRead = effective; validRead["permissions"] = ps
        try read.verifyConfiguration(validRead); checks += 1
        try check(read.fixedOverrides.contains(where: { $0.contains("\":slash_tmp\"=\"deny\"") && $0.contains(RCCNativeLocalQualityProfile.toml(read.scratch) + "=\"write\"") }), "read-only profile keeps shared-temp denied and only exact private scratch writable")
    }
    let c = TaskQualityEvidence.Contract(basis: .declaredTrustedContract, objectiveSHA256: h, contextSHA256: h, sourceSHA256: nil, startTreeSHA256: h,
        scope: .workspaceWrite, verifierCodeSHA256: h, referencePolicySHA256: h, requiredCheckIDs: ["check"], fullCoverage: false,
        referenceProfiles: [], reference: nil, issuedAt: Date(), validUntil: Date().addingTimeInterval(60))
    let env = PreparedTaskQuality.Envelope(contract: c, checkerSHA256: h, timeoutSeconds: 1, workspacePaths: [], localEffectsOnly: true)
    let prepared = PreparedTaskQuality(envelope: env, checkerBytes: Data(), referencePolicySHA256: h)
    try check(prepared.reboundForContinuation(contextSHA256: h, startTreeSHA256: h).envelope.localEffectsOnly, "correction preserves trusted local restriction")
    var legacy = try JSONSerialization.jsonObject(with: RCCOperationalQuality.encoded(env)) as! [String: Any]; legacy.removeValue(forKey: "localEffectsOnly")
    let d = JSONDecoder(); d.dateDecodingStrategy = .millisecondsSince1970
    try check(try d.decode(PreparedTaskQuality.Envelope.self, from: JSONSerialization.data(withJSONObject: legacy)).localEffectsOnly == false, "old contracts never acquire confinement declaration by default")
    print("RCC native local permission profile: \(checks) checks PASS; synthetic metadata only, native/model calls0")
}

func rccLocalEffectsAdmissionSelfTest() throws {
    typealias Q = RCCOperationalQuality
    typealias C = RCCRuntimeContract
    let fm = FileManager.default, base = fm.temporaryDirectory.appendingPathComponent("os1-boundary-admission-" + UUID().uuidString).resolvingSymlinksInPath()
    try fm.createDirectory(at: base.appendingPathComponent("contracts"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: base) }
    let hash = C.digest(Data("boundary fixture".utf8)), original = "Complete only this public local fixture task."
    let host = C.HostContext(workspace: base.path, context: nil, providerPreference: "auto", codexSessionID: nil, claudeSessionID: nil, requireReadOnly: false, ownerPolicy: nil)
    let request = C.Request(taskID: "fixture-parent", request: original, requestSHA256: C.digest(Data(original.utf8)), objective: original,
        policySHA256: hash, sourceFingerprint: C.digest(try C.encode(host)), mode: .auto, materialRefs: [],
        budget: .init(maxAttempts: 2, maxParallel: 4, maxCostUnits: nil, maxDurationMS: 20000), hostContext: host)
    let now = Int64(Date().timeIntervalSince1970 * 1000)
    func row(_ id: String, _ surface: C.Surface, _ model: String, _ scope: C.Scope = .readOnly) -> C.Candidate {
        let codex = surface == .codex
        let config = C.ExactConfig(surface: surface, transport: codex ? .codexAppServer : .claudeCLI,
            accountID: "fixture", model: model, effort: .low, tools: [], scope: scope, permissionProfile: scope,
            quotaPool: codex ? .openAICodex : .anthropicShared, allowedPaths: scope == .readOnly ? [] : ["**"], configurationSHA256: C.digest(Data(id.utf8)))
        return .init(id: id, config: config, quotaRemainingFraction: 0.8, quotaObservedAtMS: now-1, quotaValidUntilMS: now+60000,
            qualityState: .policyAdmitted, estimatedCostUnits: nil, availability: .available, availabilityObservedAtMS: now-1, availabilityValidUntilMS: now+60000)
    }
    let cheap = row("cheap", .codex, "fixture-cheap"), frontier = row("frontier", .codex, "fixture-frontier"), claude = row("claude", .claude, "fixture-claude"), writer = row("writer", .codex, "fixture-cheap", .workspaceWrite)
    let catalog = C.Catalog(taskID: request.taskID, requestSHA256: request.requestSHA256, candidates: [cheap, frontier, claude, writer],
        modelTiers: [cheap.model: "fast", frontier.model: "frontier", claude.model: "frontier"],
        quotaScores: [cheap.model: 2, frontier.model: 1, claude.model: 3],
        nativeReferenceEfforts: ["codex": [cheap.model: "max", frontier.model: "ultra"], "claude": [claude.model: "max"]])
    let bytes = try C.encode(catalog)
    var count = 0
    func check(_ condition: @autoclosure () throws -> Bool, _ label: String) throws {
        guard try condition() else { throw OS1Error.message("Local boundary admission fixture: " + label) }; count += 1
    }
    func reject(_ label: String, _ body: () throws -> Void) throws {
        do { try body() } catch { count += 1; return }; throw OS1Error.message("Local boundary admission fixture: " + label)
    }
    try check(try Q.constrainCatalogData(bytes, request: request, sourceBound: false, rootURL: base) == bytes, "undeclared catalog remains byte-identical")
    try Q.enforceLocalEffectsAdmission(declared: false, profileAvailable: false); count += 1
    try Q.enforceLocalEffectsAdmission(declared: true, profileAvailable: true); count += 1
    try reject("declared boundary never permits missing actual profile") { try Q.enforceLocalEffectsAdmission(declared: true, profileAvailable: false) }
    try check(Q.supportsLocalEffects(config: cheap.exactConfig, sourceBound: false, nativeResume: false, permissionContinuation: false), "fresh supported Codex path")
    try check(!Q.supportsLocalEffects(config: claude.exactConfig, sourceBound: false, nativeResume: false, permissionContinuation: false), "Claude has no invented local-effects capability")
    for flags in [(true,false,false),(false,true,false),(false,false,true)] {
        try check(!Q.supportsLocalEffects(config: cheap.exactConfig, sourceBound: flags.0, nativeResume: flags.1, permissionContinuation: flags.2), "source/resume/permission handback cannot bypass profile")
    }
    func envelope(scope: TaskContext.Scope, expires: Date = Date().addingTimeInterval(60), context: String? = nil) -> PreparedTaskQuality.Envelope {
        let c = TaskQualityEvidence.Contract(basis: .declaredTrustedContract, objectiveSHA256: request.requestSHA256,
            contextSHA256: context ?? C.digest(Data((host.context ?? "").utf8)), sourceSHA256: nil,
            startTreeSHA256: hash, scope: scope, verifierCodeSHA256: hash, referencePolicySHA256: hash, requiredCheckIDs: ["public.shape"],
            fullCoverage: false, referenceProfiles: [], reference: nil, issuedAt: Date(), validUntil: expires)
        return .init(contract: c, checkerSHA256: hash, timeoutSeconds: 1, workspacePaths: [], localEffectsOnly: true)
    }
    let path = base.appendingPathComponent("contracts/" + request.requestSHA256 + ".json")
    func save(_ env: PreparedTaskQuality.Envelope) throws { try Q.encoded(env).write(to: path) }
    try save(envelope(scope: .workspaceWrite))
    let readTicket = C.ExecutionTicket(taskID: request.taskID, nodeID: "read-child", attemptID: "read-attempt", candidateID: cheap.id,
        requestSHA256: request.requestSHA256, policySHA256: hash, policySourceSHA256: hash, sourceFingerprint: request.sourceFingerprint,
        configurationSHA256: cheap.configurationSHA256, selectedConfig: cheap.exactConfig, objective: original,
        instruction: "Read one part of the original local task", contextRefs: [], ownedPaths: [], originalRequest: original, originalObjective: original, hostContext: host)
    guard let inherited = try Q.localEffectsBoundary(ticket: readTicket, rootURL: base) else { throw OS1Error.message("Missing original owner writer ceiling") }
    try check(inherited.scope == .workspaceWrite, "inherited boundary preserves original owner ceiling as provenance")
    let frozenEnvelope = try Data(contentsOf: path)
    func required(_ boundary: Q.LocalEffectsBoundary?, kind: String? = "codex_fresh_local_effects_v1",
                  digest: String? = inherited.envelopeSHA256, config: C.ExactConfig? = nil,
                  source: Bool = false, resumed: Bool = false, continuation: Bool = false) throws {
        try Q.enforceRequiredExecutionIsolation(required: kind, envelopeSHA256: digest,
            boundary: boundary, config: config ?? cheap.exactConfig, sourceBound: source,
            nativeResume: resumed, permissionContinuation: continuation)
    }
    try required(inherited); count += 1
    try required(nil, kind: nil, digest: nil); count += 1 // Old exclusive tickets retain their semantics.
    try reject("required shared boundary cannot disappear") { try required(nil) }
    try reject("required isolation pair cannot lose its hash") { try required(inherited, digest: nil) }
    try reject("orphan isolation hash cannot create authority") { try required(inherited, kind: nil) }
    try reject("unknown isolation class cannot create authority") { try required(inherited, kind: "unbounded") }
    try reject("different envelope cannot inherit a shared slot") { try required(inherited, digest: hash) }
    try reject("shared capability cannot move to Claude") { try required(inherited, config: claude.exactConfig) }
    try reject("shared capability cannot widen to source custody") { try required(inherited, source: true) }
    try reject("shared capability cannot become a resumed session") { try required(inherited, resumed: true) }
    try reject("shared capability cannot become a permission handback") { try required(inherited, continuation: true) }
    // Actual file changes after catalog-time capture: absence/toggle/valid
    // replacement all fail before a native process/model can be started.
    try fm.removeItem(at: path)
    let removedBoundary = try Q.localEffectsBoundary(ticket: readTicket, rootURL: base)
    try check(removedBoundary == nil, "removed declaration is absent, not a default local restriction")
    try reject("removed declaration cannot silently become an ordinary shared attempt") { try required(removedBoundary) }
    var toggled = try JSONSerialization.jsonObject(with: frozenEnvelope) as! [String: Any]
    toggled["localEffectsOnly"] = false
    try JSONSerialization.data(withJSONObject: toggled, options: [.sortedKeys]).write(to: path)
    let toggledBoundary = try Q.localEffectsBoundary(ticket: readTicket, rootURL: base)
    try check(toggledBoundary == nil, "false local-effects declaration is not a capability")
    try reject("toggled declaration cannot silently widen a shared attempt") { try required(toggledBoundary) }
    toggled["localEffectsOnly"] = true; toggled["timeoutSeconds"] = 2
    try JSONSerialization.data(withJSONObject: toggled, options: [.sortedKeys]).write(to: path)
    let changedBoundary = try Q.localEffectsBoundary(ticket: readTicket, rootURL: base)
    try check(changedBoundary?.envelopeSHA256 != inherited.envelopeSHA256, "raw envelope change has a new identity")
    try reject("a different valid envelope cannot reuse the frozen shared admission") { try required(changedBoundary) }
    try frozenEnvelope.write(to: path)
    try required(Q.localEffectsBoundary(ticket: readTicket, rootURL: base)); count += 1
    let childProfile = try RCCNativeLocalQualityProfile(ticket: readTicket, workspace: base.path, boundary: inherited)
    defer { try? fm.removeItem(atPath: childProfile.scratch) }
    try check(childProfile.fixedOverrides.contains(where: { $0.contains(RCCNativeLocalQualityProfile.toml(base.path) + "=\"read\"") }) &&
        !childProfile.fixedOverrides.contains(where: { $0.contains(RCCNativeLocalQualityProfile.toml(base.path) + "=\"write\"") }),
        "writer parent boundary cannot upgrade actual read-only child business permissions")
    let constrained = try C.decodeCatalog(Q.constrainCatalogData(bytes, request: request, sourceBound: false, rootURL: base))
    try check(constrained.candidates == [cheap, frontier, writer], "only unsupported provider removed; cheap/frontier and efforts unchanged")
    try check(constrained.exclusions?.contains(.init(provider: "claude", reason: "explicit_constraint_unavailable", count: 1)) == true, "capability constraint is not model/quota failure")
    try check(constrained.modelTiers?[claude.model] == nil && constrained.quotaScores?[claude.model] == nil && constrained.nativeReferenceEfforts?["claude"] == nil, "metadata closes over surviving models")
    let held = try C.decodeCatalog(Q.constrainCatalogData(bytes, request: request, sourceBound: true, rootURL: base))
    try check(held.candidates.isEmpty && held.exclusions?.contains(where: { $0.reason == "explicit_constraint_unavailable" }) == true, "unsupported source-bound workspace yields explained empty hold")
    try save(envelope(scope: .readOnly))
    let read = try C.decodeCatalog(Q.constrainCatalogData(bytes, request: request, sourceBound: false, rootURL: base))
    try check(read.candidates == [cheap, frontier], "parent read ceiling never offers writer")
    // R10 needs the same validated Request at BOTH admission decodes. Neither
    // the local-effect filter nor the final host decode may drop its identity.
    var r10Request = request; r10Request.routingIntentPolicyVersion = C.RoutingIntentV2.version
    var r10Catalog = catalog; r10Catalog.routingIntentV2 = C.RoutingIntentV2()
    let r10Bytes = try C.encode(r10Catalog)
    func r10Admit(_ data: Data, _ input: C.Request) throws -> C.Catalog {
        let boundRequest = try C.decodeRequest(C.encode(input))
        let admitted = try Q.constrainCatalogData(data, request: boundRequest, sourceBound: false, rootURL: base)
        return try C.decodeCatalog(admitted, request: boundRequest)
    }
    let r10Read = try r10Admit(r10Bytes, r10Request)
    try check(r10Read.candidates == [cheap, frontier] && r10Read.routingIntentV2 == r10Catalog.routingIntentV2,
        "R10 request survives filter and final decode without widening read scope")
    try save(envelope(scope: .workspaceWrite))
    try check(try r10Admit(r10Bytes, r10Request).candidates == [cheap, frontier, writer],
        "R10 retains eligible Codex rows and existing writer ceiling")
    try reject("R10 catalog still rejects missing request") { _ = try C.decodeCatalog(r10Bytes) }
    try reject("R10 catalog cannot inherit legacy request") { _ = try r10Admit(r10Bytes, request) }
    try reject("R10 request cannot inherit legacy catalog") { _ = try r10Admit(bytes, r10Request) }
    var wrongR10 = r10Request; wrongR10.taskID = "foreign-task"
    try reject("R10 rejects wrong task identity") { _ = try r10Admit(r10Bytes, wrongR10) }
    wrongR10 = r10Request; wrongR10.policySHA256 = C.digest(Data("foreign policy".utf8))
    try reject("R10 keeps original owner policy boundary") { _ = try r10Admit(r10Bytes, wrongR10) }
    var badR10Catalog = r10Catalog; badR10Catalog.requestSHA256 = C.digest(Data("foreign request".utf8))
    try reject("R10 rejects wrong catalog request hash") { _ = try r10Admit(C.encode(badR10Catalog), r10Request) }
    badR10Catalog = r10Catalog; badR10Catalog.candidates.append(cheap)
    try reject("R10 rejects duplicate candidate identity") { _ = try r10Admit(C.encode(badR10Catalog), r10Request) }
    badR10Catalog = r10Catalog; badR10Catalog.candidates[0].permissionProfile = .workspaceWrite
    try reject("R10 cannot turn request propagation into a scope bypass") { _ = try r10Admit(C.encode(badR10Catalog), r10Request) }
    wrongR10 = r10Request; wrongR10.routingIntentPolicyVersion = "unreviewed-v99"
    try reject("R10 rejects unknown policy version") { _ = try r10Admit(r10Bytes, wrongR10) }
    try save(envelope(scope: .workspaceWrite, expires: Date().addingTimeInterval(-1)))
    try reject("expired declaration is not silently omitted") { _ = try Q.constrainCatalogData(bytes, request: request, sourceBound: false, rootURL: base) }
    try save(envelope(scope: .workspaceWrite, context: hash))
    try reject("foreign context declaration is not applied") { _ = try Q.constrainCatalogData(bytes, request: request, sourceBound: false, rootURL: base) }
    print("RCC hard local-effects admission: \(count) checks PASS; provider/native/model calls0")
}

/// Independent fresh generic examples, not benchmark answers or source IDs.
func resourceScheduleSupplementSelfTest() throws {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("os1-resource-check-" + UUID().uuidString).resolvingSymlinksInPath()
    try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]); defer { try? fm.removeItem(at: root) }
    let ws = root.appendingPathComponent("workspace"), registry = root.appendingPathComponent("registry")
    try fm.createDirectory(at: ws, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var count = 0
    func check(_ value: @autoclosure () throws -> Bool, _ name: String) throws { guard try value() else { throw OS1Error.message("Resource schedule fixture: " + name) }; count += 1 }
    func rejects(_ name: String, _ fn: () throws -> Void) throws { do { try fn() } catch { count += 1; return }; throw OS1Error.message("Resource schedule fixture accepted " + name) }
    let spec = #"{"project":"fresh-work","version":"s1","horizon":12,"resources":{"beam":1,"analyst":2},"tasks":[{"id":"cut","duration":2,"release":0,"deadline":6,"requires":{"beam":1},"depends":[]},{"id":"seal","duration":2,"release":0,"deadline":8,"requires":{"beam":1},"depends":[]},{"id":"review","duration":1,"release":0,"deadline":12,"requires":{"analyst":1},"depends":["cut","seal"]}]}"#
    let objective = #"Read workload.json and return one feasible non-preemptive schedule. Return EXACTLY {"project":<project ID>,"version":<version>,"schedule":[{"task_id":<ID>,"start":<integer>}, ...]}. Return JSON only."#
    let source = ws.appendingPathComponent("workload.json")
    func put(_ text: String) throws { try Data(text.utf8).write(to: source); try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: source.path) }
    try put(spec)
    let hash = String(repeating: "a", count: 64)
    func prepare(_ request: String = objective, _ scope: TaskContext.Scope = .readOnly) throws -> PreparedTaskQuality? {
        try PreparedTaskQuality.prepare(objective: request, contextSHA256: hash, sourceSHA256: nil,
            startTreeSHA256: workspaceHash(ws.path), scope: scope, referencePolicySHA256: hash, workspace: ws.path, rootURL: registry)
    }
    guard var p = try prepare() else { throw OS1Error.message("Fresh schedule acquisition absent") }
    try check(!p.envelope.contract.fullCoverage && p.envelope.contract.reference == nil, "partial/no reference")
    try check(p.envelope.workspacePaths == ["workload.json"] && !p.envelope.localEffectsOnly, "no new capability")
    try check(p.envelope.contract.requiredCheckIDs == ResourceScheduleSupplement.ids, "fixed obligations")
    func witness(_ prepared: PreparedTaskQuality, _ output: String) throws -> PreparedTaskQuality.Witness {
        let native = NativeRecordEvidence(turnID: "fixture-turn", recordPath: "/fixture/native", persistence: "verified", desktopVisibility: "fixture")
        let a = Artifact(provider: "codex", action: "execute", permissionProfile: "read_only", model: "fixture", effort: "low",
            executorContractVersion: "fixture", executorContractSHA256: hash, exitCode: 0, output: output, stderr: "", durationMS: 1,
            workspaceBeforeHash: prepared.envelope.contract.startTreeSHA256, workspaceAfterHash: workspaceHash(ws.path), nativeRecord: native)
        return try prepared.evaluateWithWitness(artifact: a, artifactSHA256: TaskQualityEvidence.digest(try RCCOperationalQuality.encoded(a)),
            contextSHA256: hash, workspace: ws.path, executionID: UUID().uuidString.lowercased(), runsRoot: root)
    }
    let valid = #"{"project":"fresh-work","version":"s1","schedule":[{"task_id":"cut","start":0},{"task_id":"seal","start":2},{"task_id":"review","start":4}]}"#
    let alternate = #"{"project":"fresh-work","version":"s1","schedule":[{"task_id":"review","start":6},{"task_id":"seal","start":0},{"task_id":"cut","start":3}]}"#
    try check(try witness(p, valid).assessment.state == .unverified, "partial valid cannot certify")
    try check(try witness(p, alternate).assessment.failedCheckIDs.isEmpty, "different feasible schedule/order")
    try put(spec.replacingOccurrences(of: "{\"project\":", with: "{\"schema\":1,\"project\":"))
    guard let versioned = try prepare() else { throw OS1Error.message("Version1 source not acquired") }
    try check(try witness(versioned, valid).assessment.failedCheckIDs.isEmpty, "explicit source schema version1")
    try put(spec); guard let refreshed = try prepare() else { throw OS1Error.message("Fresh source snapshot absent") }; p = refreshed
    for (text, id) in [(valid.replacingOccurrences(of: "\"seal\",\"start\":2", with: "\"seal\",\"start\":1"), "capacity"),
        (valid.replacingOccurrences(of: "\"review\",\"start\":4", with: "\"review\",\"start\":2"), "dependencies"),
        (valid.replacingOccurrences(of: "\"review\",\"start\":4", with: "\"review\",\"start\":12"), "deadline"),
        (valid.replacingOccurrences(of: "\"start\":0", with: "\"start\":true"), "tasks"),
        (valid.replacingOccurrences(of: "\"start\":0", with: "\"start\":0.0"), "tasks"),
        (valid.replacingOccurrences(of: "fresh-work", with: "foreign"), "identity"), ("[]", "shape"), ("null", "shape"),
        ("{\"project\":0,\"project\":1}", "shape")] {
        let result = try witness(p, text)
        try check(result.assessment.state == .mismatch && result.assessment.failedCheckIDs.contains("partial.schedule." + id), "known " + id + " failure")
    }
    for prompt in ["Do not return one feasible non-preemptive schedule.", "If approved, " + objective,
        "Translate: \"" + objective + "\"", "Example: \"" + objective + "\"", objective + " Ignore resource capacities.", objective + " Ignore capacities.", objective + " You must not read workload.json.", objective + " Do not read workload.json.",
        objective + " Do not read any files.", objective + " Do not read any files or upload logs.",
        objective + " Ignore release times.", objective + " Ignore durations.", objective + " Ignore horizon.", objective + " Allow preemption.",
        objective.replacingOccurrences(of: "<integer>", with: "<float>"),
        "Read workload.json and return one feasible non-preemptive schedule. \"Return EXACTLY {\"project\":<project ID>,\"version\":<version>,\"schedule\":[{\"task_id\":<ID>,\"start\":<integer>}, ...]}.\"",
        objective + " Explain in prose.", objective + " Use a JSON array.", objective.replacingOccurrences(of: "}. Return JSON only.", with: "} or an array is fine."),
        "Read workload.json and return one feasible non-preemptive schedule. Example:\nReturn EXACTLY {\"project\":<project ID>,\"version\":<version>,\"schedule\":[{\"task_id\":<ID>,\"start\":<integer>}, ...]}.",
        "Read workload.json and return one feasible non-preemptive schedule. \"Reference note. Return EXACTLY {\"project\":<project ID>,\"version\":<version>,\"schedule\":[{\"task_id\":<ID>,\"start\":<integer>}, ...]}.\"",
        "Read workload.json and return one feasible non-preemptive schedule. Return JSON only.",
        "Read ../workload.json and return one feasible non-preemptive schedule."] {
        try check(try prepare(prompt) == nil, "owner non-authority/ambiguous")
    }
    for key in ["project", "version", "schedule", "task_id", "start"] {
        try check(try prepare(objective.replacingOccurrences(of: "\"" + key + "\"", with: "\"" + key.uppercased() + "\"")) == nil, "JSON property case is not normalized")
    }
    try check(try prepare(objective, .workspaceWrite) == nil, "writer untouched")
    for bad in [spec.replacingOccurrences(of: "{\"project\":", with: "{\"schema\":2,\"project\":"),
        spec.replacingOccurrences(of: "{\"project\":", with: "{\"schema\":true,\"project\":"),
        spec.replacingOccurrences(of: "\"horizon\":12", with: "\"horizon\":true"),
        spec.replacingOccurrences(of: "\"horizon\":12", with: "\"horizon\":4097"),
        spec.replacingOccurrences(of: "\"horizon\":12", with: "\"horizon\":12.5"),
        spec.replacingOccurrences(of: "\"horizon\":12", with: "\"horizon\":12.0"),
        spec.replacingOccurrences(of: "\"horizon\":12", with: "\"horizon\":12e0"),
        spec.replacingOccurrences(of: "\"horizon\":12", with: "\"horizon\":12,\"horizon\":10"),
        spec.replacingOccurrences(of: "\"project\":", with: "\"unknown\":1,\"project\":"),
        spec.replacingOccurrences(of: "\"depends\":[]", with: "\"depends\":[\"review\"]"),
        spec.replacingOccurrences(of: "\"depends\":[\"cut\",\"seal\"]", with: "\"depends\":[\"absent\"]")] {
        try put(bad); try rejects("unsupported schema/bounds/cycle") { _ = try prepare() }
    }
    try put(spec); try fm.removeItem(at: source)
    let outside = root.appendingPathComponent("outside.json"); try Data(spec.utf8).write(to: outside)
    try fm.createSymbolicLink(at: source, withDestinationURL: outside); try rejects("symlink") { _ = try prepare() }; try fm.removeItem(at: source)
    try fm.linkItem(at: outside, to: source); try rejects("hardlink") { _ = try prepare() }; try fm.removeItem(at: source)
    try put(spec); try fm.setAttributes([.posixPermissions: 0o666], ofItemAtPath: source.path); try rejects("writable source") { _ = try prepare() }; try put(spec)
    // A changed source is infrastructure/binding unknown, never a fabricated
    // candidate constraint failure authorizing a replay.
    try put(spec.replacingOccurrences(of: "\"beam\":1", with: "\"beam\":2"))
    try rejects("changed source cannot reuse frozen checker") { _ = try witness(p, valid) }
    print("RCC resource schedule supplement: \(count) checks PASS; model/provider calls 0")
}

func resourceScheduleOwnerCompositionSelfTest() throws {
    let fm = FileManager.default, hash = String(repeating: "b", count: 64)
    let root = fm.temporaryDirectory.appendingPathComponent("os1-resource-owner-" + UUID().uuidString).resolvingSymlinksInPath()
    let ws = root.appendingPathComponent("workspace"), registry = root.appendingPathComponent("registry")
    try fm.createDirectory(at: ws, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try fm.createDirectory(at: registry.appendingPathComponent("contracts"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    try fm.createDirectory(at: registry.appendingPathComponent("checkers"), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: root) }
    let objective = #"Read jobs.json and return a feasible non-preemptive schedule. Return EXACTLY {"project":<project ID>,"version":<version>,"schedule":[{"task_id":<ID>,"start":<integer>}, ...]}."#
    let source = #"{"project":"owner-example","version":"a","horizon":8,"resources":{"machine":1},"tasks":[{"id":"red","duration":2,"release":0,"deadline":8,"requires":{"machine":1},"depends":[]},{"id":"blue","duration":2,"release":0,"deadline":8,"requires":{"machine":1},"depends":[]}]}"#
    let sourceURL = ws.appendingPathComponent("jobs.json"); try Data(source.utf8).write(to: sourceURL)
    let valid = #"{"project":"owner-example","version":"a","schedule":[{"task_id":"red","start":0},{"task_id":"blue","start":2}]}"#
    let invalid = valid.replacingOccurrences(of: "\"blue\",\"start\":2", with: "\"blue\",\"start\":1")
    var checks = 0
    func check(_ test: @autoclosure () throws -> Bool, _ name: String) throws { guard try test() else { throw OS1Error.message("Resource owner fixture: " + name) }; checks += 1 }
    func putOwner(_ status: String, full: Bool = false, exit: Int = 0) throws -> (Data, Data) {
        let code = Data("import json,sys\nprint(json.dumps([{'checkID':'partial.owner','status':'\(status)','score':None,'observedReceiptSHA256':None}]))\nsys.exit(\(exit))\n".utf8), codeSHA = TaskQualityEvidence.digest(code)
        let c = TaskQualityEvidence.Contract(basis: .declaredTrustedContract, objectiveSHA256: TaskQualityEvidence.digest(Data(objective.utf8)),
            contextSHA256: hash, sourceSHA256: nil, startTreeSHA256: workspaceHash(ws.path), scope: .readOnly,
            verifierCodeSHA256: codeSHA, referencePolicySHA256: hash, requiredCheckIDs: ["partial.owner"], fullCoverage: full,
            referenceProfiles: [], reference: nil, issuedAt: Date(), validUntil: Date().addingTimeInterval(1000))
        let env = PreparedTaskQuality.Envelope(contract: c, checkerSHA256: codeSHA, timeoutSeconds: 10, workspacePaths: [], localEffectsOnly: true)
        let bytes = try RCCOperationalQuality.encoded(env)
        try bytes.write(to: registry.appendingPathComponent("contracts/" + c.objectiveSHA256 + ".json")); try code.write(to: registry.appendingPathComponent("checkers/" + codeSHA + ".py"))
        return (bytes, code)
    }
    func load() throws -> PreparedTaskQuality {
        guard let p = try PreparedTaskQuality.prepare(objective: objective, contextSHA256: hash, sourceSHA256: nil,
            startTreeSHA256: workspaceHash(ws.path), scope: .readOnly, referencePolicySHA256: hash, workspace: ws.path, rootURL: registry) else { throw OS1Error.message("Missing owner fixture") }; return p
    }
    func artifact(_ p: PreparedTaskQuality, _ output: String) -> Artifact {
        .init(provider: "codex", action: "execute", permissionProfile: "read_only", model: "fixture", effort: "low", executorContractVersion: "fixture", executorContractSHA256: hash,
            exitCode: 0, output: output, stderr: "", durationMS: 1, workspaceBeforeHash: p.envelope.contract.startTreeSHA256,
            workspaceAfterHash: workspaceHash(ws.path), nativeRecord: .init(turnID: "fixture-turn", recordPath: "/fixture/native", persistence: "verified", desktopVisibility: "fixture"))
    }
    func evaluate(_ p: PreparedTaskQuality, _ out: String) throws -> PreparedTaskQuality.Witness {
        let a = artifact(p, out)
        return try p.evaluateWithWitness(artifact: a, artifactSHA256: TaskQualityEvidence.digest(try RCCOperationalQuality.encoded(a)), contextSHA256: hash,
            workspace: ws.path, executionID: UUID().uuidString.lowercased(), runsRoot: root)
    }
    let original = try putOwner("passed"), p = try load()
    try check(p.envelope.contract.requiredCheckIDs == ["partial.owner"] + ResourceScheduleSupplement.ids, "owner obligations retained")
    try check(!p.envelope.contract.fullCoverage && p.envelope.localEffectsOnly && p.envelope.contract.reference == nil, "coverage/capability unchanged")
    try check(try evaluate(p, valid).receipt?.checks.count == 9, "normal owner zero exit still runs supplement")
    try check(try evaluate(p, invalid).assessment.failedCheckIDs == ["partial.schedule.capacity"], "capacity fail alongside owner pass")
    let ownerPath = registry.appendingPathComponent("contracts/" + p.envelope.contract.objectiveSHA256 + ".json")
    try check(try Data(contentsOf: ownerPath) == original.0, "owner registry not overwritten")
    try check(try Data(contentsOf: registry.appendingPathComponent("checkers/" + TaskQualityEvidence.digest(original.1) + ".py")) == original.1, "owner code unchanged")
    _ = try putOwner("failed"); try check(try evaluate(load(), valid).assessment.failedCheckIDs == ["partial.owner"], "owner failure preserved")
    _ = try putOwner("unverified"); try check(try evaluate(load(), valid).receipt == nil, "owner unknown remains infrastructure unknown")
    _ = try putOwner("passed", exit: 1); try check(try evaluate(load(), valid).receipt == nil, "nonzero owner never candidate failure")
    let full = try putOwner("passed", full: true), fullPrepared = try load()
    try check(fullPrepared.checkerBytes == full.1 && fullPrepared.envelope.contract.requiredCheckIDs == ["partial.owner"] && fullPrepared.resourceScheduleSnapshot == nil, "full owner not replaced")
    _ = try putOwner("passed"); let bound = try load()
    let sameBytes = try Data(contentsOf: sourceURL), oldDate = (try fm.attributesOfItem(atPath: sourceURL.path))[.modificationDate] as! Date
    try fm.removeItem(at: sourceURL); try sameBytes.write(to: sourceURL); try fm.setAttributes([.modificationDate: oldDate], ofItemAtPath: sourceURL.path)
    let selected = RCCRuntimeContract.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture", model: "fixture", effort: .low, tools: [], scope: .readOnly, permissionProfile: .readOnly, quotaPool: .openAICodex, allowedPaths: [], configurationSHA256: hash)
    let host = RCCRuntimeContract.HostContext(workspace: ws.path, context: nil, providerPreference: "auto", codexSessionID: nil, claudeSessionID: nil, requireReadOnly: true, ownerPolicy: nil)
    let ticket = RCCRuntimeContract.ExecutionTicket(taskID: UUID().uuidString.lowercased(), nodeID: "schedule", attemptID: UUID().uuidString.lowercased(), candidateID: "fixture", requestSHA256: TaskQualityEvidence.digest(Data(objective.utf8)), policySHA256: hash, policySourceSHA256: hash, sourceFingerprint: RCCRuntimeContract.digest(try RCCRuntimeContract.encode(host)), configurationSHA256: hash, selectedConfig: selected, objective: objective, instruction: objective, contextRefs: [], ownedPaths: [], originalRequest: objective, originalObjective: objective, hostContext: host)
    let prep = RCCOperationalQuality.Preparation(prepared: bound, before: try RCCOperationalQuality.ContentManifest.capture(workspace: ws.path), correctiveAttempts: 0, budget: .init(), correctionPrompt: nil)
    let a = artifact(bound, valid)
    let finished = try RCCOperationalQuality.finish(prep, ticket: ticket, artifact: a, artifactSHA256: TaskQualityEvidence.digest(try RCCOperationalQuality.encoded(a)), workspace: ws.path, root: root.appendingPathComponent("witnesses"))
    try check(finished.assessment.state == .unverified && !finished.checkerReceiptAvailable && finished.assessment.failedCheckIDs.isEmpty, "same-byte replaced source custody returns UNVERIFIED not mismatch/pass")
    var rejectedTraversal = false
    do { _ = try ResourceScheduleSupplement.source("../outside.json", workspace: ws.path) } catch { rejectedTraversal = true }
    try check(rejectedTraversal, "decoded snapshot traversal rejected at read boundary")
    let alias = root.appendingPathComponent("alias"); try fm.createSymbolicLink(at: alias, withDestinationURL: ws)
    var rejectedRoot = false
    do { _ = try ResourceScheduleSupplement.source("jobs.json", workspace: alias.path) } catch { rejectedRoot = true }
    try check(rejectedRoot, "symlink source root rejected before read")
    print("RCC resource owner composition/custody: \(checks) checks PASS; model/provider calls 0")
}
