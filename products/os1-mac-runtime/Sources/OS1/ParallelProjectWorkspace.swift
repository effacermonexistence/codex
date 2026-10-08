import Foundation
import Darwin
import OS1Context
import OS1HookSupport

/// A runtime-produced capability for one isolated writer. This is not a
/// planner field or an authorization to touch the parent checkout.
struct ParallelProjectWriteGrant: Codable, Sendable {
    let schema: Int
    let parentPID: Int32
    let parentSubmissionID: UUID
    let parentConversationID: UUID
    let childSubmissionID: UUID
    let nodeID: UUID
    let planID: UUID
    let parentRequestSHA256: String
    let instructionSHA256: String
    let sourceRoot: String
    let workspace: String
    let baseCommit: String
    let ownedPaths: [String]
    let binarySHA256: String
    let createdAt: Date
}

/// Separate Git worktrees + a single parent merge boundary. Children may
/// produce candidate edits; only this parent checks/applies their aggregate.
/// Failed/abandoned worktrees and patches are retained as private recovery
/// evidence. No push, installation, credential copy or session replay occurs.
final class ParallelProjectWorkspace: @unchecked Sendable {
    let sourceRoot: String
    let baseCommit: String
    let custody: URL
    let plan: ParallelAgentTask.Plan
    let leaseRoot: String
    let leaseURL: URL
    private let lease: ExclusiveHookLease
    private var workspaces: [UUID: String] = [:]

    private init(sourceRoot: String, baseCommit: String, custody: URL,
                 plan: ParallelAgentTask.Plan, leaseRoot: String, leaseURL: URL, lease: ExclusiveHookLease) {
        self.sourceRoot = sourceRoot; self.baseCommit = baseCommit
        self.custody = custody; self.plan = plan; self.leaseRoot = leaseRoot; self.leaseURL = leaseURL; self.lease = lease
    }

    static func git(_ root: String, _ arguments: [String], input: Data? = nil,
                    environment: [String: String] = [:]) throws -> Data {
        let (status, output, _) = try commandOutput("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", root] + arguments,
            input: input, timeout: 45, currentDirectory: root, environmentOverrides: environment)
        guard status == 0 else { throw OS1Error.message("Isolated project Git gate failed: " + arguments.prefix(2).joined(separator: " ")) }
        return output
    }
    static func text(_ data: Data) -> String { String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) }

    /// A repository and all its worktrees share a canonical Git common-dir
    /// identity. Ordinary writers and a parallel parent therefore meet at
    /// exactly the same gate; isolated granted children deliberately skip it.
    static func projectLeaseRoot(workspace: String) throws -> String? {
        let canonical = URL(fileURLWithPath: workspace).standardizedFileURL.resolvingSymlinksInPath().path
        let (status, raw, diagnostic) = try commandOutput("/usr/bin/git",
            ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", canonical, "rev-parse", "--git-common-dir"],
            timeout: 45, currentDirectory: canonical)
        if status != 0 {
            if text(diagnostic).lowercased().contains("not a git repository") { return nil }
            throw OS1Error.message("Project writer lease repository identity is unavailable; no unleased dispatch authorized")
        }
        let common = text(raw)
        guard !common.isEmpty else { throw ParallelAgentTask.Failure.bindingMismatch }
        return (common.hasPrefix("/") ? URL(fileURLWithPath: common) : URL(fileURLWithPath: canonical).appendingPathComponent(common))
            .standardizedFileURL.resolvingSymlinksInPath().path
    }
    static func originalProjectLeaseURL(root: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> URL {
        let directory = home.appendingPathComponent(".os1/parallel-project-leases", isDirectory: true)
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard directory.resolvingSymlinksInPath() == directory.standardizedFileURL else { throw ParallelAgentTask.Failure.unsafePath }
        var directoryInfo = stat()
        guard lstat(directory.path, &directoryInfo) == 0, (directoryInfo.st_mode & S_IFMT) == S_IFDIR,
              directoryInfo.st_uid == getuid(), (directoryInfo.st_mode & 0o077) == 0 else { throw ParallelAgentTask.Failure.unsafePath }
        let url = directory.appendingPathComponent(sha256Hex(Data(root.utf8)) + ".lock")
        var info = stat()
        if lstat(url.path, &info) == 0 {
            guard (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == getuid(), info.st_nlink == 1,
                  (info.st_mode & 0o077) == 0 else { throw ParallelAgentTask.Failure.unsafePath }
        } else if errno != ENOENT { throw ParallelAgentTask.Failure.unsafePath }
        return url
    }
    static func acquireOriginalProjectLease(workspace: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws
        -> (root: String, lease: ExclusiveHookLease)? {
        guard let root = try projectLeaseRoot(workspace: workspace) else { return nil }
        let url = try originalProjectLeaseURL(root: root, home: home)
        var lastNotice = Date.distantPast
        let lease = try ExclusiveHookLease.acquireWaiting(at: url, beforeAttempt: {
            if Task.isCancelled || ExecutionCancellation.isCancelled { throw OS1Error.backendBlocked(.cancelled) }
        }, onContention: {
            if Date().timeIntervalSince(lastNotice) >= 10 {
                lastNotice = Date()
                RuntimeActivity.emit(.preparing, publicText: "Waiting for this project's writer · backend not started", publicTextOrigin: .systemStatus)
            }
        })
        return (root, lease)
    }

    /// The planner can propose writes, never grant them. The owner scope,
    /// clean original repository and disjoint path ownership are required.
    static func prepare(plan: ParallelAgentTask.Plan, custody: URL, leaseHome: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> ParallelProjectWorkspace {
        _ = try plan.validated()
        let fm = FileManager.default
        let root = URL(fileURLWithPath: plan.workspace).standardizedFileURL.resolvingSymlinksInPath().path
        guard plan.scope == .workspaceWrite else { throw OS1Error.message("Parallel writer owner scope is not workspace_write; original execution preserved") }
        guard root == plan.workspace else { throw OS1Error.message("Parallel writer workspace is not canonical; original execution preserved") }
        guard root != fm.homeDirectoryForCurrentUser.path, !root.lowercased().contains("handy") else {
            throw OS1Error.message("Parallel writer target is outside the independent project boundary; original execution preserved")
        }
        let gitRoot = text(try git(root, ["rev-parse", "--show-toplevel"]))
        // macOS Git prints /private/var while Foundation canonicalizes that
        // same physical alias to /var. Compare using one path resolver.
        guard URL(fileURLWithPath: gitRoot).standardizedFileURL.resolvingSymlinksInPath().path == root else {
            throw OS1Error.message("Parallel writer target is not the exact Git project root; original execution preserved")
        }
        guard (try git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).isEmpty else {
            throw OS1Error.message("Parallel writer project has existing changes; original execution preserved")
        }
        let writers = plan.workers.filter { $0.scope == .workspaceWrite }
        guard !writers.isEmpty, writers.allSatisfy({ $0.dependencies.isEmpty }),
              ParallelAgentTask.disjointOwnership(writers.map(\.ownedPaths)),
              !text(try git(root, ["ls-files", "--stage"])).contains("160000 ")
        else { throw OS1Error.message("Parallel write ownership/dependency gate refused; original execution preserved") }
        let trackedPaths = String(decoding: try git(root, ["ls-files", "-z"]), as: UTF8.self).split(separator: "\0").map(String.init)
        for worker in writers {
            for path in worker.ownedPaths {
                try noSymlinkAncestors(root: root, relative: path)
                guard trackedPaths.filter({ $0 == path || $0.hasPrefix(path + "/") }).allSatisfy(ParallelAgentTask.relativeOwnedPath)
                else { throw OS1Error.message("Parallel ownership includes protected policy/verification/install paths; original single-writer execution preserved") }
            }
        }
        let base = text(try git(root, ["rev-parse", "HEAD"]))
        guard base.range(of: "^[0-9a-f]{40,64}$", options: .regularExpression) != nil else { throw ParallelAgentTask.Failure.invalidPlan }
        guard let sharedLease = try acquireOriginalProjectLease(workspace: root, home: leaseHome) else { throw ParallelAgentTask.Failure.invalidPlan }
        let leaseURL = try originalProjectLeaseURL(root: sharedLease.root, home: leaseHome)
        try fm.createDirectory(at: custody.appendingPathComponent("workspaces"), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        guard text(try git(root, ["rev-parse", "HEAD"])) == base,
              (try git(root, ["status", "--porcelain=v1", "--untracked-files=all"])).isEmpty else {
            throw OS1Error.message("Original project changed before parallel lease acquisition")
        }
        return ParallelProjectWorkspace(sourceRoot: root, baseCommit: base, custody: custody, plan: plan,
            leaseRoot: sharedLease.root, leaseURL: leaseURL, lease: sharedLease.lease)
    }

    func makeWorkspace(for worker: ParallelAgentTask.WorkerSpec) throws -> String {
        guard worker.scope == .workspaceWrite, plan.workers.contains(where: { $0 == worker }) else { throw ParallelAgentTask.Failure.invalidPlan }
        if let existing = workspaces[worker.id] { return existing }
        try verifyOriginal()
        let target = custody.appendingPathComponent("workspaces").appendingPathComponent(worker.id.uuidString, isDirectory: true)
        guard !FileManager.default.fileExists(atPath: target.path) else { throw ParallelAgentTask.Failure.unsafePath }
        _ = try Self.git(sourceRoot, ["worktree", "add", "--quiet", "--detach", target.path, baseCommit])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: target.path)
        workspaces[worker.id] = target.path
        return target.path
    }

    func writeGrant(worker: ParallelAgentTask.WorkerSpec, instruction: String, childSubmissionID: UUID,
                    executable: URL, directory: URL) throws -> URL {
        guard let workspace = workspaces[worker.id] else { throw ParallelAgentTask.Failure.invalidPlan }
        let grant = ParallelProjectWriteGrant(schema: 1, parentPID: getpid(),
            parentSubmissionID: plan.submissionID, parentConversationID: plan.conversationID,
            childSubmissionID: childSubmissionID, nodeID: worker.id, planID: plan.planID,
            parentRequestSHA256: plan.requestSHA256, instructionSHA256: sha256Hex(Data(instruction.utf8)),
            sourceRoot: sourceRoot, workspace: workspace, baseCommit: baseCommit, ownedPaths: worker.ownedPaths,
            binarySHA256: sha256Hex(try Data(contentsOf: executable)), createdAt: Date())
        let path = directory.appendingPathComponent("write-grant.json")
        try JSONEncoder().encode(grant).write(to: path, options: .withoutOverwriting)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        return path
    }

    /// Called before native dispatch. No environment-selected permission or
    /// model-produced JSON can replace this private parent capability.
    static func validateChildGrant(path: String, workspace: String, instruction: String) throws -> ParallelProjectWriteGrant {
        let fm = FileManager.default
        let url = URL(fileURLWithPath: path).standardizedFileURL
        guard url.resolvingSymlinksInPath() == url else { throw ParallelAgentTask.Failure.unsafePath }
        let fd = Darwin.open(url.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw ParallelAgentTask.Failure.unsafePath }
        defer { Darwin.close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == getuid(),
              info.st_nlink == 1, (info.st_mode & 0o077) == 0, info.st_size <= 16_384 else { throw ParallelAgentTask.Failure.unsafePath }
        let grant = try JSONDecoder().decode(ParallelProjectWriteGrant.self, from: Data(contentsOf: url))
        let parentRoot = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/agent-tasks")
            .appendingPathComponent(grant.parentSubmissionID.uuidString + "-private").appendingPathComponent(grant.planID.uuidString)
        let expectedGrant = parentRoot.appendingPathComponent(grant.nodeID.uuidString).appendingPathComponent("write-grant.json")
        let expectedWorkspace = parentRoot.appendingPathComponent("workspaces").appendingPathComponent(grant.nodeID.uuidString)
        let graphPath = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/agent-tasks")
            .appendingPathComponent(grant.parentSubmissionID.uuidString + ".json")
        guard let graph = try ParallelAgentTask.loadBound(path: graphPath.path, conversationID: grant.parentConversationID,
                  submissionID: grant.parentSubmissionID, requestSHA256: grant.parentRequestSHA256),
              graph.planID == grant.planID,
              let node = graph.nodes.first(where: { $0.id == grant.nodeID }), node.role == .worker,
              node.scope == .workspaceWrite, node.workspace == workspace, node.ownedPaths == grant.ownedPaths,
              !node.state.isTerminal, node.workerSubmissionID.map({ $0 == grant.childSubmissionID }) ?? true
        else { throw OS1Error.message("Isolated writer grant has no matching parent-owned project graph") }
        guard grant.schema == 1, expectedGrant.path == url.path, expectedWorkspace.path == workspace,
              grant.workspace == workspace, grant.sourceRoot != workspace,
              grant.parentPID > 1, getppid() == grant.parentPID, kill(grant.parentPID, 0) == 0,
              ProcessInfo.processInfo.environment["OS1_AGENT_PARENT_PID"] == String(grant.parentPID),
              ProcessInfo.processInfo.environment["OS1_SUBMISSION_ID"] == grant.childSubmissionID.uuidString,
              grant.instructionSHA256 == sha256Hex(Data(instruction.utf8)),
              grant.binarySHA256 == sha256Hex(try Data(contentsOf: Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0]))),
              Date().timeIntervalSince(grant.createdAt) >= -5, Date().timeIntervalSince(grant.createdAt) <= 120,
              !grant.ownedPaths.isEmpty, grant.ownedPaths.allSatisfy(ParallelAgentTask.relativeOwnedPath),
              text(try git(workspace, ["rev-parse", "HEAD"])) == grant.baseCommit,
              (try git(workspace, ["status", "--porcelain=v1", "--untracked-files=all"])).isEmpty
        else { throw OS1Error.message("Isolated project writer capability does not match this child execution") }
        for relative in grant.ownedPaths { try noSymlinkAncestors(root: workspace, relative: relative) }
        return grant
    }

    func verifyOriginal() throws {
        guard Self.text(try Self.git(sourceRoot, ["rev-parse", "HEAD"])) == baseCommit,
              (try Self.git(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"])).isEmpty
        else { throw OS1Error.message("Original project changed during parallel execution; candidates preserved and not applied") }
    }

    /// Includes committed, staged, unstaged and untracked deltas against the
    /// exact base. An alternate index never changes the worker's own index.
    func candidatePatch(worker: ParallelAgentTask.WorkerSpec) throws -> Data {
        guard let workspace = workspaces[worker.id] else { throw ParallelAgentTask.Failure.invalidPlan }
        let index = custody.appendingPathComponent(worker.id.uuidString + ".candidate-index")
        let env = ["GIT_INDEX_FILE": index.path]
        defer { try? FileManager.default.removeItem(at: index) }
        _ = try Self.git(workspace, ["read-tree", baseCommit], environment: env)
        _ = try Self.git(workspace, ["add", "-A", "--", "."], environment: env)
        let names = try Self.git(workspace, ["diff", "--cached", "--name-only", "-z", baseCommit], environment: env)
        let paths = String(decoding: names, as: UTF8.self).split(separator: "\0").map(String.init)
        guard paths.allSatisfy({ path in ParallelAgentTask.relativeOwnedPath(path) &&
            worker.ownedPaths.contains(where: { path == $0 || path.hasPrefix($0 + "/") }) })
        else { throw OS1Error.message("Worker changed an unowned/protected path; candidate retained, original untouched") }
        for path in paths { try Self.noSymlinkAncestors(root: workspace, relative: path) }
        let raw = Self.text(try Self.git(workspace, ["diff", "--cached", "--raw", baseCommit], environment: env))
        guard !raw.contains("120000"), !raw.contains("160000") else { throw OS1Error.message("Symlink/submodule write candidate rejected") }
        let patch = try Self.git(workspace, ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", baseCommit], environment: env)
        guard patch.count <= 8_000_000 else { throw OS1Error.message("Parallel candidate patch exceeded bounded custody") }
        let path = custody.appendingPathComponent(worker.id.uuidString + ".candidate.patch")
        try patch.write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        return patch
    }

    /// Parent-only merge. Reject a mixed/partial writer set, check all patches
    /// in a disposable integration worktree, recheck the original, then apply
    /// once. The existing primary executor verifies/completes the objective.
    func reconcile(_ candidates: [(ParallelAgentTask.WorkerSpec, Data)]) throws -> [String] {
        let writers = plan.workers.filter { $0.scope == .workspaceWrite }
        guard Set(candidates.map { $0.0.id }) == Set(writers.map(\.id)),
              candidates.count == writers.count else { throw OS1Error.message("Not every isolated writer produced an adopted candidate; original untouched") }
        try verifyOriginal()
        let aggregate = custody.appendingPathComponent("integration", isDirectory: true)
        _ = try Self.git(sourceRoot, ["worktree", "add", "--quiet", "--detach", aggregate.path, baseCommit])
        for (_, patch) in candidates where !patch.isEmpty {
            _ = try Self.git(aggregate.path, ["apply", "--check", "--binary", "-"], input: patch)
            _ = try Self.git(aggregate.path, ["apply", "--index", "--binary", "-"], input: patch)
        }
        let merged = try Self.git(aggregate.path, ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", baseCommit])
        let appliedPaths = Self.text(try Self.git(aggregate.path, ["diff", "--cached", "--name-only", baseCommit])).split(separator: "\n").map(String.init)
        let path = custody.appendingPathComponent("parent-integration.patch")
        try merged.write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        try verifyOriginal()
        if !merged.isEmpty {
            _ = try Self.git(sourceRoot, ["apply", "--check", "--binary", "-"], input: merged)
            try verifyOriginal()
            _ = try Self.git(sourceRoot, ["apply", "--binary", "-"], input: merged)
        }
        return appliedPaths
    }

    private static func noSymlinkAncestors(root: String, relative: String) throws {
        guard ParallelAgentTask.relativeOwnedPath(relative) else { throw ParallelAgentTask.Failure.invalidPlan }
        var path = URL(fileURLWithPath: root)
        for part in relative.split(separator: "/") {
            path.appendPathComponent(String(part))
            var info = stat()
            if lstat(path.path, &info) == 0 {
                guard (info.st_mode & S_IFMT) != S_IFLNK else { throw OS1Error.message("Parallel write ownership crosses a symlink") }
            } else if errno != ENOENT { throw ParallelAgentTask.Failure.unsafePath }
        }
    }
}

/// No account, model, network, live checkout or installer is used. Two real
/// subprocesses write disjoint detached worktrees; one commits its candidate
/// to prove that diff-against-HEAD cannot lose committed worker work.
func parallelProjectWorkspaceSelfTest(root: URL) async throws -> Int {
    let fm = FileManager.default
    let fixture = root.appendingPathComponent("isolated-project-writes", isDirectory: true)
    try fm.createDirectory(at: fixture, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var checks = 0
    func check(_ value: Bool, _ label: String) throws {
        checks += 1
        if !value { throw OS1Error.message("Parallel project fixture: " + label) }
    }
    func repository(_ name: String) throws -> String {
        let path = fixture.appendingPathComponent(name, isDirectory: true)
        try fm.createDirectory(at: path, withIntermediateDirectories: true)
        _ = try ParallelProjectWorkspace.git(path.path, ["init", "--quiet"])
        _ = try ParallelProjectWorkspace.git(path.path, ["config", "user.name", "OS1 fixture"])
        _ = try ParallelProjectWorkspace.git(path.path, ["config", "user.email", "fixture@invalid.example"])
        try Data("A baseline\n".utf8).write(to: path.appendingPathComponent("a.txt"))
        try Data("B baseline\n".utf8).write(to: path.appendingPathComponent("b.txt"))
        _ = try ParallelProjectWorkspace.git(path.path, ["add", "a.txt", "b.txt"])
        _ = try ParallelProjectWorkspace.git(path.path, ["commit", "--quiet", "-m", "baseline"])
        return path.resolvingSymlinksInPath().path
    }
    func plan(_ workspace: String) throws -> ParallelAgentTask.Plan {
        try ParallelAgentTask.Plan(conversationID: UUID(), submissionID: UUID(), requestSHA256: String(repeating: "a", count: 64),
            originalInstruction: "Implement two independent files and verify combined behavior", workspace: workspace,
            workers: [.init(slug: "a", title: "Implement A", instruction: "Modify only a.txt", scope: .workspaceWrite, ownedPaths: ["a.txt"]),
                      .init(slug: "b", title: "Implement B", instruction: "Modify only b.txt", scope: .workspaceWrite, ownedPaths: ["b.txt", "new.txt"])],
            scope: .workspaceWrite).validated()
    }
    let old = Data("{\"tasks\":[{\"id\":\"a\",\"title\":\"A\",\"instruction\":\"Inspect A\",\"dependencies\":[]},{\"id\":\"b\",\"title\":\"B\",\"instruction\":\"Inspect B\",\"dependencies\":[]}] }".utf8)
    let legacy = try JSONDecoder().decode(ParallelAgentTask.Draft.self, from: old)
    try check(legacy.tasks.allSatisfy { $0.scope == .readOnly && $0.ownedPaths.isEmpty }, "legacy plans decode as read-only, never implicit writes")
    try check(!ParallelAgentTask.relativeOwnedPath("../other") && !ParallelAgentTask.relativeOwnedPath(".claude/settings.json") &&
        !ParallelAgentTask.relativeOwnedPath("Sources/OS1/main.swift") && !ParallelAgentTask.relativeOwnedPath("scripts/install.sh"), "protected and traversal ownership refused")
    try check(ParallelAgentTask.relativeOwnedPath("products/os1-mac-runtime/Sources/OS1App/Widget.swift"), "independent OS1 implementation component remains eligible")
    try check(!ParallelAgentTask.disjointOwnership([["src"], ["src/widget.swift"]]), "directory/file ownership collision refused")
    let repo = try repository("source")
    let validated = try plan(repo)
    let project = try ParallelProjectWorkspace.prepare(plan: validated, custody: fixture.appendingPathComponent("custody"), leaseHome: fixture)
    let spaces = try validated.workers.map { try project.makeWorkspace(for: $0) }
    try check(Set(spaces).count == 2 && !spaces.contains(repo), "each implementation worker owns a distinct private worktree")
    try check((try ExclusiveHookLease.tryAcquire(at: project.leaseURL)) == nil,
        "ordinary project writer cannot enter while parallel parent owns original project")
    try check(try ParallelProjectWorkspace.projectLeaseRoot(workspace: spaces[0]) == project.leaseRoot,
        "original checkout and isolated worktree resolve to one canonical repository lease")
    let barrier = fixture.appendingPathComponent("barrier", isDirectory: true)
    try fm.createDirectory(at: barrier, withIntermediateDirectories: true)
    let script = fixture.appendingPathComponent("writer.py")
    try Data("""
    import os,sys,time
    workspace,name,barrier=sys.argv[1:]
    open(os.path.join(barrier,name+'.started'),'x').write(str(time.time()))
    deadline=time.time()+8
    while len([x for x in os.listdir(barrier) if x.endswith('.started')])<2:
      if time.time()>deadline: sys.exit(9)
      time.sleep(.02)
    open(os.path.join(workspace,name+'.txt'),'w').write(name+' implemented\\n')
    if name=='b': open(os.path.join(workspace,'new.txt'),'w').write('new implementation\\n')
    time.sleep(.15)
    open(os.path.join(barrier,name+'.finished'),'x').write(str(time.time()))
    """.utf8).write(to: script)
    let statuses = await withTaskGroup(of: Int32.self, returning: [Int32].self) { group in
        for (i, space) in spaces.enumerated() {
            let name = i == 0 ? "a" : "b"
            group.addTask {
                (try? commandOutput("/usr/bin/python3", [script.path, space, name, barrier.path], timeout: 12,
                    currentDirectory: space).0) ?? 70
            }
        }
        var result: [Int32] = []; for await status in group { result.append(status) }; return result
    }
    try check(statuses.count == 2 && statuses.allSatisfy { $0 == 0 }, "actual disjoint implementation subprocesses executed")
    let starts = try ["a", "b"].map { Double(try String(contentsOf: barrier.appendingPathComponent($0 + ".started"), encoding: .utf8))! }
    let finishes = try ["a", "b"].map { Double(try String(contentsOf: barrier.appendingPathComponent($0 + ".finished"), encoding: .utf8))! }
    try check(starts.max()! < finishes.min()!, "real write subprocesses overlapped")
    try project.verifyOriginal()
    try check(try String(contentsOf: URL(fileURLWithPath: repo + "/a.txt"), encoding: .utf8) == "A baseline\n", "parallel candidates never modify original before parent integration")
    _ = try ParallelProjectWorkspace.git(spaces[0], ["add", "a.txt"])
    _ = try ParallelProjectWorkspace.git(spaces[0], ["commit", "--quiet", "-m", "worker candidate"])
    let aPatch = try project.candidatePatch(worker: validated.workers[0])
    let bPatch = try project.candidatePatch(worker: validated.workers[1])
    try check(!aPatch.isEmpty && String(decoding: aPatch, as: UTF8.self).contains("a implemented"), "committed worker delta retained against exact base")
    try check(String(decoding: bPatch, as: UTF8.self).contains("new.txt"), "untracked implementation included without mutating worker index")
    let applied = try project.reconcile([(validated.workers[0], aPatch), (validated.workers[1], bPatch)])
    try check(Set(applied) == Set(["a.txt", "b.txt", "new.txt"]), "single parent aggregate contains exactly owned paths")
    try check(try String(contentsOf: URL(fileURLWithPath: repo + "/a.txt"), encoding: .utf8) == "a implemented\n" &&
        String(contentsOf: URL(fileURLWithPath: repo + "/b.txt"), encoding: .utf8) == "b implemented\n", "combined implementation applied after disposable integration checks")
    try check(ParallelProjectWorkspace.text(try ParallelProjectWorkspace.git(repo, ["rev-parse", "HEAD"])) == project.baseCommit,
        "parent source is not auto committed or pushed")

    let boundedRepo = try repository("bounds")
    let bounds = try plan(boundedRepo)
    let bounded = try ParallelProjectWorkspace.prepare(plan: bounds, custody: fixture.appendingPathComponent("bounds-custody"), leaseHome: fixture)
    let first = try bounded.makeWorkspace(for: bounds.workers[0])
    let grantDirectory = fixture.appendingPathComponent("grant", isDirectory: true)
    try fm.createDirectory(at: grantDirectory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let child = UUID()
    let grantPath = try bounded.writeGrant(worker: bounds.workers[0], instruction: "fixture writer", childSubmissionID: child,
        executable: URL(fileURLWithPath: "/usr/bin/python3"), directory: grantDirectory)
    let recordedGrant = try JSONDecoder().decode(ParallelProjectWriteGrant.self, from: Data(contentsOf: grantPath))
    try check(recordedGrant.childSubmissionID == child && recordedGrant.parentSubmissionID == bounds.submissionID && recordedGrant.workspace == first,
        "runtime capability binds actual parent, child, workspace and original request")
    try Data("unowned candidate\n".utf8).write(to: URL(fileURLWithPath: first + "/b.txt"))
    var rejected = false
    do { _ = try bounded.candidatePatch(worker: bounds.workers[0]) } catch { rejected = true }
    try check(rejected, "out-of-owned-path worker delta rejected")
    try bounded.verifyOriginal()
    try check(true, "unowned failure preserves original checkout and candidate workspace")
    try Data("external owner change\n".utf8).write(to: URL(fileURLWithPath: boundedRepo + "/a.txt"))
    rejected = false
    do { try bounded.verifyOriginal() } catch { rejected = true }
    try check(rejected, "concurrent original modification blocks integration/replay")
    rejected = false
    do { _ = try ParallelProjectWorkspace.prepare(plan: bounds, custody: fixture.appendingPathComponent("dirty-custody"), leaseHome: fixture) } catch { rejected = true }
    try check(rejected, "dirty original never authorizes isolated writer mode")
    var dependent = bounds
    dependent.workers[1].scope = .readOnly; dependent.workers[1].ownedPaths = []; dependent.workers[1].dependencies = [dependent.workers[0].id]
    try check((try? dependent.validated()) == nil, "dependent write/read pipeline cannot fake access to unmerged candidate")
    let releaseRepo = try repository("lease-release")
    let releasePlan = try plan(releaseRepo)
    var parent: ParallelProjectWorkspace? = try ParallelProjectWorkspace.prepare(plan: releasePlan,
        custody: fixture.appendingPathComponent("lease-release-custody"), leaseHome: fixture)
    let sameLock = parent!.leaseURL
    try check((try ExclusiveHookLease.tryAcquire(at: sameLock)) == nil, "ordinary writer remains blocked by held parent lease")
    parent = nil
    let ordinary = try ParallelProjectWorkspace.acquireOriginalProjectLease(workspace: releaseRepo, home: fixture)
    try check(ordinary != nil && (try ExclusiveHookLease.tryAcquire(at: sameLock)) == nil,
        "ordinary writer reacquires identical gate after parent release")
    withExtendedLifetime(ordinary) {}
    let unsafeGrant = fixture.appendingPathComponent("unbound-grant.json")
    try Data("{}".utf8).write(to: unsafeGrant)
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: unsafeGrant.path)
    try check((try? ParallelProjectWorkspace.validateChildGrant(path: unsafeGrant.path, workspace: first, instruction: "write")) == nil,
        "unbound CLI grant cannot enable workspace writes")
    return checks
}
