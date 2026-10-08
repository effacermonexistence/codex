import Foundation
import CryptoKit
import OS1Context
import Darwin

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
    private let partialRegression: PythonRegressionSnapshot?
    var frozenRegressionSnapshot: PythonRegressionSnapshot? { partialRegression }

    init(envelope: Envelope, checkerBytes: Data, referencePolicySHA256: String,
         partialRegression: PythonRegressionSnapshot? = nil) {
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
                workspacePaths: snapshot.allowedRoots), checkerBytes: checker,
                referencePolicySHA256: referencePolicySHA256, partialRegression: snapshot)
        }
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
            candidate = try frozenCandidate(workspace: workspace, paths: paths.filter { !$0.hasPrefix("tests/") },
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
        let launch: (String, [String])
        if partialRegression == nil { launch = ("/usr/bin/python3", [checker.path, input.path]) }
        else { launch = try copiedPythonRegressionLaunch(runRoot: runRoot, checker: checker, input: input) }
        let result = try commandOutput(launch.0, launch.1,
            timeout: envelope.timeoutSeconds, currentDirectory: runRoot.path,
            environmentOverrides: ["HOME": runRoot.path, "TMPDIR": runRoot.path, "PYTHONNOUSERSITE": "1", "PATH": "/usr/bin:/bin"],
            removingEnvironment: Set(ProcessInfo.processInfo.environment.keys.filter {
                let key = $0.uppercased()
                return key.contains("TOKEN") || key.contains("KEY") || key.contains("SECRET") || key.contains("AUTH") || key.contains("PASSWORD")
            }), captureDirectory: runRoot)
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
        return assessment
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
struct PythonRegressionSnapshot {
    let allowedRoots: [String]
    let originalTests: [String: Data]
    let recipeSHA256: String

    static func acquire(workspace: String) throws -> Self? {
        let fm = FileManager.default, root = URL(fileURLWithPath: workspace).standardizedFileURL
        guard root.resolvingSymlinksInPath() != fm.homeDirectoryForCurrentUser.resolvingSymlinksInPath(),
              !root.path.lowercased().contains("handy"),
              (try? fm.attributesOfItem(atPath: root.path)[.type] as? FileAttributeType) == .typeDirectory else { return nil }
        let readme = root.appendingPathComponent("README.md")
        guard let attr = try? fm.attributesOfItem(atPath: readme.path), attr[.type] as? FileAttributeType == .typeRegular,
              (attr[.size] as? NSNumber)?.intValue ?? Int.max <= 128_000,
              let bytes = try? Data(contentsOf: readme), let text = String(data: bytes, encoding: .utf8),
              text.range(of: #"(?m)^\s*python3 -m unittest(?: -v)?\s*$"#, options: .regularExpression) != nil else { return nil }
        let children = try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        var roots: [String] = []
        for child in children {
            let name = child.lastPathComponent
            guard !name.lowercased().contains("handy"), !["venv", "node_modules", "auth", "oauth", "credentials", "keychain", "logs", "sessions"].contains(name.lowercased()) else { continue }
            let attrs = try fm.attributesOfItem(atPath: child.path)
            if name.range(of: #"^[A-Za-z_][A-Za-z0-9_]{0,63}\.py$"#, options: .regularExpression) != nil {
                guard attrs[.type] as? FileAttributeType == .typeRegular else { return nil }
                roots.append(name)
            } else if name.range(of: #"^[A-Za-z_][A-Za-z0-9_]{0,63}$"#, options: .regularExpression) != nil,
                      name == "tests" || fm.fileExists(atPath: child.appendingPathComponent("__init__.py").path) {
                guard attrs[.type] as? FileAttributeType == .typeDirectory else { return nil }
                roots.append(name)
            }
        }
        guard roots.contains("tests"), roots.count <= 16 else { return nil }
        let paths = try pythonPaths(workspace: workspace, allowedRoots: roots)
        guard paths.contains("tests/__init__.py"),
              paths.contains(where: { $0.hasPrefix("tests/test_") && $0.hasSuffix(".py") }) else { return nil }
        var tests: [String: Data] = [:]
        for path in paths where path.hasPrefix("tests/") { tests[path] = try Data(contentsOf: root.appendingPathComponent(path)) }
        return Self(allowedRoots: roots.sorted(), originalTests: tests, recipeSHA256: TaskQualityEvidence.digest(bytes))
    }

    func candidatePaths(workspace: String) throws -> [String] {
        try Self.pythonPaths(workspace: workspace, allowedRoots: allowedRoots)
    }

    private static func pythonPaths(workspace: String, allowedRoots: [String]) throws -> [String] {
        let fm = FileManager.default, root = URL(fileURLWithPath: workspace).standardizedFileURL
        var paths: [String] = [], total = 0
        func visit(_ url: URL, depth: Int) throws {
            guard depth <= 4 else { throw OS1Error.message("Partial unittest source exceeds depth bound") }
            let attrs = try fm.attributesOfItem(atPath: url.path), type = attrs[.type] as? FileAttributeType
            guard type == .typeRegular || type == .typeDirectory,
                  url.resolvingSymlinksInPath().path.hasPrefix(root.resolvingSymlinksInPath().path + "/") else {
                throw OS1Error.message("Partial unittest source contains a symlink or non-project artifact")
            }
            if type == .typeDirectory {
                for child in try fm.contentsOfDirectory(at: url, includingPropertiesForKeys: nil) {
                    let name = child.lastPathComponent
                    guard !name.hasPrefix("."), !name.lowercased().contains("handy"),
                          !["__pycache__", "node_modules", "venv", "auth", "oauth", "credentials", "keychain", "logs", "sessions"].contains(name.lowercased()) else { continue }
                    if child.pathExtension == "py" || (try? fm.attributesOfItem(atPath: child.path)[.type] as? FileAttributeType) == .typeDirectory {
                        try visit(child, depth: depth + 1)
                    }
                }
            } else if url.pathExtension == "py" {
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
        return Data((preamble + runner).utf8)
    }
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
    let selected = String(decoding: discovery.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    let resolved = URL(fileURLWithPath: selected).standardizedFileURL.resolvingSymlinksInPath().path
    guard [selected, resolved].allSatisfy({
        $0.hasPrefix("/Applications/Xcode.app/Contents/Developer/") || $0.hasPrefix("/Library/Developer/CommandLineTools/")
    }), FileManager.default.isExecutableFile(atPath: resolved) else {
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
    guard python.hasPrefix("/Applications/Xcode.app/Contents/Developer/") || python.hasPrefix("/Library/Developer/CommandLineTools/") else {
        throw OS1Error.message("Native partial unittest interpreter escaped its approved SDK")
    }
    let scratch = runRoot.path
    let readable = [scratch, "/System", "/usr/bin", "/usr/lib", "/usr/share", "/Applications/Xcode.app", "/Library/Developer", "/private/etc", "/dev"]
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
    try Data("import missing_os1_fixture_dependency\n".utf8).write(to: originalTest)
    let missingDependency = try pythonAssessment()
    guard missingDependency.state == .unverified, missingDependency.failedCheckIDs.isEmpty else {
        throw OS1Error.message("Unittest import/setup uncertainty fabricated a task mismatch")
    }
    try originalBytes.write(to: originalTest)
    print("OS-1 task-quality runtime: copied-artifact pass/fail, raw preservation, no fabricated parity, current/legacy summary roundtrip PASS; model calls 0")
    print("OS-1 partial unittest runtime: frozen-original + actual candidate suites, added-failure veto, weakened/deleted-test + retry-custody preservation, partial-pass/setup unverified PASS; model calls 0")
}
