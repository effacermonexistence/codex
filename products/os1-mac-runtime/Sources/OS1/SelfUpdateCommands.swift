import Foundation
import OS1Context
import OS1HookSupport

/// `os1 self-update stage --source <root>`: build, verify and hand a new
/// OS-1 build to the running app. `os1 self-update apply [--root <root>]`:
/// install a staged build through the verified local installer (the app
/// launches this detached when idle). `os1 self-update status` and `check-in`: read-only.
func selfUpdateCommand(_ arguments: [String]) async throws -> Bool {
    guard arguments.first == "self-update" else { return false }
    let subcommand = arguments.count > 1 ? arguments[1] : "status"
    var options: [String: String] = [:]
    var index = 2
    while index < arguments.count {
        let key = arguments[index]
        guard key.hasPrefix("--"), index + 1 < arguments.count else {
            throw OS1Error.message("self-update: unknown argument \(key)")
        }
        options[String(key.dropFirst(2))] = arguments[index + 1]
        index += 2
    }
    switch subcommand {
    case "stage": try stageSelfUpdate(source: options["source"])
    case "apply": try applySelfUpdate(root: options["root"])
    case "status": try printSelfUpdateStatus(root: options["root"])
    // The card a check-in question is answered from, exactly as the backend sees it.
    case "check-in": print(statusCheckInCard())
    case "sync-live": try syncLiveOS1Source()
    default: throw OS1Error.message("self-update: expected stage, apply, status, check-in or sync-live")
    }
    return true
}

/// `os1 self-repair complete --source <checkout>`: run OS-1's own completion
/// pipeline on a tree a backend left half-done (bump, build, tests, stage,
/// secret scan, commit, push). The same code the runtime runs at the end of
/// every write task on its own source; here it is the operator's hand.
func selfRepairCommand(_ arguments: [String]) async throws -> Bool {
    guard arguments.first == "self-repair" else { return false }
    // No implicit default: a bare `os1 self-repair` must never bump, build
    // and commit the checkout it happens to be run from.
    guard arguments.count > 1 else {
        throw OS1Error.message("self-repair: usage: os1 self-repair complete --source <OS-1 checkout> [--objective <text>] | os1 self-repair route --prompt <text> [--workspace <folder>]")
    }
    let subcommand = arguments[1]
    var options: [String: String] = [:]
    var index = 2
    while index < arguments.count {
        let key = arguments[index]
        guard key.hasPrefix("--"), index + 1 < arguments.count else { throw OS1Error.message("self-repair: unknown argument \(key)") }
        options[String(key.dropFirst(2))] = arguments[index + 1]
        index += 2
    }
    if subcommand == "route" {
        // Read-only: which source tree OS-1 would work in for this request.
        guard let prompt = options["prompt"] else { throw OS1Error.message("self-repair route: --prompt is required") }
        let workspace = options["workspace"] ?? FileManager.default.homeDirectoryForCurrentUser.path
        let binding = localProjectBinding(request: prompt, workspace: workspace,
            namedProjectID: PreparationIntent.detect(prompt)?.projectID, boundProjectID: nil, readOnly: false)
        var target = workspace
        if let projectID = binding.projectID, LocalProjectWorkspace.root(containing: workspace, projectID: projectID) == nil {
            target = resolveLocalProjectWorkspace(projectID: projectID, requested: workspace)?.workspace ?? workspace
        }
        let report: [String: Any] = [
            "project": binding.projectID ?? NSNull(), "inferred": binding.inferred,
            "signals": binding.inference?.signals ?? [], "blockedBy": binding.inference?.blockedBy ?? NSNull(),
            "workspace": target, "selfRepair": LocalProjectWorkspace.root(containing: target, projectID: "os1-clodex") != nil,
        ]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys, .withoutEscapingSlashes])
        print(String(decoding: data, as: UTF8.self))
        return true
    }
    guard subcommand == "complete" else { throw OS1Error.message("self-repair: expected complete or route") }
    let requested = options["source"] ?? FileManager.default.currentDirectoryPath
    guard let root = LocalProjectWorkspace.root(containing: requested, projectID: "os1-clodex") else {
        throw OS1Error.message("self-repair: \(requested) is not inside an OS-1 source tree")
    }
    let lease = try acquireOS1SourceWriteLease(root: root)
    defer { withExtendedLifetime(lease) {} }
    let objective = options["objective"] ?? "manual completion of a backend-left source change"
    switch completeOS1SelfRepair(root: root, objective: objective, startedAt: .distantPast) {
    case .notApplicable(let reason):
        print("OS-1 self-repair: nothing to complete — \(reason)")
    case .staged(_, let note):
        print(note)
    case .failed(let diagnostic):
        throw OS1Error.message(selfRepairFailurePrefixText + diagnostic)
    }
    return true
}

/// Shared with the runtime hook in main.swift.
let selfRepairFailurePrefixText = "OS-1 self-repair could not complete: "

let os1RuntimeVersionString = "OS-1 Runtime 0.9.278 (parallel-inspector-build344)"

/// Where the source leases live. A fixture binds a scratch folder so its
/// real flock leases on a temporary tree never leave lock files in the owner's
/// `~/.os1/self-update` (every release build ran `os1 self-test`, review of
/// c687b9b, 2026-10-05).
enum OS1SourceLeaseDirectory {
    @TaskLocal static var override: URL?
}

func os1SourceWriteLeaseURL(root: String) throws -> URL {
    let directory = OS1SourceLeaseDirectory.override
        ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/self-update", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let canonical = URL(fileURLWithPath: root).resolvingSymlinksInPath().standardizedFileURL.path
    return directory.appendingPathComponent("source-write-" + sha256Hex(Data(canonical.utf8)).prefix(16) + ".lock")
}

/// A queued source writer closes reader admission while existing readers
/// drain. Keep this separate from the source lease: no lock is stolen and an
/// interrupted writer releases its intent through descriptor lifetime.
func os1SourceWriterIntentURL(root: String) throws -> URL {
    try os1SourceWriteLeaseURL(root: root).appendingPathExtension("writer-intent")
}

/// The source-write lease if no other OS-1 writer holds it right now.
func tryAcquireOS1SourceWriteLease(root: String) throws -> ExclusiveHookLease? {
    guard let intent = try ExclusiveHookLease.tryAcquire(at: os1SourceWriterIntentURL(root: root)) else { return nil }
    defer { withExtendedLifetime(intent) {} }
    return try ExclusiveHookLease.tryAcquire(at: os1SourceWriteLeaseURL(root: root))
}

/// Readers may share the source only when no writer already owns admission.
/// Taking both in this order closes the check/acquire race with a new writer.
func tryAcquireOS1SourceSharedLease(root: String) throws -> ExclusiveHookLease? {
    guard let intent = try ExclusiveHookLease.tryAcquire(at: os1SourceWriterIntentURL(root: root), shared: true) else { return nil }
    defer { withExtendedLifetime(intent) {} }
    return try ExclusiveHookLease.tryAcquire(at: os1SourceWriteLeaseURL(root: root), shared: true)
}

/// Serialize source edits without dropping a queued request after three minutes.
/// flock ownership, not a stale lock-file timestamp, determines availability.
func acquireOS1SourceWriteLease(root: String, timeoutSeconds: Int? = nil) throws -> ExclusiveHookLease {
    let lock = try os1SourceWriteLeaseURL(root: root)
    let deadline = timeoutSeconds.map { Date().addingTimeInterval(TimeInterval($0)) }
    var lastNotice = Date.distantPast
    let checkCancellation = {
        if ExecutionCancellation.isCancelled { throw OS1Error.backendBlocked(.cancelled) }
        if let deadline, Date() >= deadline {
            throw OS1Error.message("OS-1 source-write wait deadline reached; no source edits were dispatched.")
        }
    }
    let notice = {
        if Date().timeIntervalSince(lastNotice) >= 10 {
            lastNotice = Date()
            RuntimeActivity.emit(.waitingForSource, publicText: os1Tr(
                "OS-1 소스 쓰기 차례를 기다리는 중 · 백엔드는 아직 시작하지 않았습니다. 기존 작업이 끝나면 자동으로 이어갑니다.",
                "Waiting for the OS-1 source writer · backend not started. This request continues automatically when the writer releases it."))
        }
    }
    // Continuous HOME traffic used to win fresh shared leases while this
    // repair waited indefinitely. A pending writer now prevents new readers.
    let intent = try ExclusiveHookLease.acquireWaiting(at: os1SourceWriterIntentURL(root: root),
        beforeAttempt: checkCancellation, onContention: notice)
    defer { withExtendedLifetime(intent) {} }
    return try ExclusiveHookLease.acquireWaiting(at: lock,
        beforeAttempt: checkCancellation, onContention: notice)
}

/// A write task whose folder contains OS-1's live tree (HOME) may change it
/// without being an OS-1 repair. It runs beside other such tasks, but never
/// beside an OS-1 repair or staging, which hold the lease exclusively: on
/// 2026-09-30 a HOME task edited main.swift while the profile-menu repair held
/// the lease, and that repair's build failed on the half-written code.
func acquireOS1SourceSharedLease(root: String) throws -> ExclusiveHookLease {
    var lastNotice = Date.distantPast
    while true {
        if ExecutionCancellation.isCancelled { throw OS1Error.backendBlocked(.cancelled) }
        if let lease = try tryAcquireOS1SourceSharedLease(root: root) { return lease }
        if Date().timeIntervalSince(lastNotice) >= 10 {
            lastNotice = Date()
            RuntimeActivity.emit(.waitingForSource, publicText: os1Tr(
                "OS-1 소스 접근 순서를 기다립니다 · 이 작업 폴더에 OS-1 소스가 있어 수리와 겹치지 않도록 보호합니다. 백엔드는 아직 시작하지 않았고, 소스 접근이 가능해지면 자동으로 이어갑니다.",
                "Waiting for OS-1 source access · this folder contains OS-1's source and must not overlap a repair. Backend not started; this request continues automatically when source access is available."))
        }
        Thread.sleep(forTimeInterval: 0.25)
    }
}

private var installedAppURL: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/OS-1 CLODEX.app")
}

private func plistValue(_ path: String, _ key: String) -> Any? {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)), data.count <= 200_000,
          let object = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { return nil }
    return object[key]
}

/// Build number of the app installed in ~/Applications; 0 when absent.
func installedOS1Build() -> Int {
    Int(plistValue(installedAppURL.appendingPathComponent("Contents/Info.plist").path, "CFBundleVersion") as? String ?? "") ?? 0
}

/// The CLI a backend should call for staging: the stable ~/.local/bin copy
/// when present, otherwise the running executable.
func currentOS1Executable() -> String {
    let stable = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin/os1").path
    if FileManager.default.isExecutableFile(atPath: stable) { return stable }
    return URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path
}

func gitHead(_ root: String) -> String? {
    guard let git = try? findExecutable("git"),
          let result = try? commandOutput(git, ["-C", root, "rev-parse", "HEAD"], timeout: 20), result.0 == 0 else { return nil }
    let text = String(decoding: result.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    return text.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil ? text : nil
}

/// The install state a check-in is answered from (see `StatusCheckIn`).
func statusCheckInCard() -> String {
    let installed = installedOS1Build()
    let registered = Set(LocalProjectWorkspace.candidates(projectID: "os1-clodex").map { URL(fileURLWithPath: $0).standardizedFileURL.path })
    func subject(_ root: String?, _ commit: String?) -> String? {
        guard let commit, let git = try? findExecutable("git") else { return nil }
        for candidate in [root].compactMap({ $0 }) + Array(registered) where FileManager.default.fileExists(atPath: candidate) {
            if let result = try? commandOutput(git, ["-C", candidate, "log", "-1", "--format=%s", commit], timeout: 5), result.0 == 0 {
                let text = String(decoding: result.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty { return text }
            }
        }
        return nil
    }
    let outcomes = SelfUpdate.outcomes()
    let installedOutcome = outcomes.last { $0.success && $0.intent.build == installed }
    let staged = StatusCheckIn.stagedIntents(installedBuild: installed).map { intent in
        StatusCheckIn.Staged(intent: intent, automatic: registered.contains(URL(fileURLWithPath: intent.sourceRoot).standardizedFileURL.path),
                             subject: subject(intent.sourceRoot, intent.sourceCommit))
    }
    // The installed app's own version: this CLI may be a staged or debug build.
    let version = plistValue(installedAppURL.appendingPathComponent("Contents/Info.plist").path, "CFBundleShortVersionString") as? String
    return StatusCheckIn.card(installedVersion: "OS-1 \(version ?? "unknown version")", installedBuild: installed,
        installedSubject: installedOutcome.flatMap { subject($0.intent.sourceRoot, $0.intent.sourceCommit) },
        staged: staged, outcomes: outcomes, hold: SelfUpdate.activeHold())
}

private func outputTail(_ result: (Int32, Data, Data), limit: Int = 3_000) -> String {
    String(String(decoding: result.1 + result.2, as: UTF8.self).suffix(limit))
}

private func fileSHA256(_ path: String) throws -> String {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)) else {
        throw OS1Error.message("self-update: cannot read \(path)")
    }
    return sha256Hex(data)
}

private func stageSelfUpdate(source: String?) throws {
    let requested = source ?? FileManager.default.currentDirectoryPath
    guard let root = LocalProjectWorkspace.root(containing: requested, projectID: "os1-clodex") else {
        throw OS1Error.message("self-update stage: \(requested) is not inside an OS-1 source tree (marker \(LocalProjectWorkspace.marker(for: "os1-clodex") ?? ""))")
    }
    // A backend that stages its own uncommitted edit installs code that is in
    // neither git nor the R2 backup (builds 244/245, 2026-09-24). The
    // self-repair tail stages, commits and pushes on its own; this command is
    // for committed trees.
    if let dirty = uncommittedOS1SourceDiagnostic(root: root) { throw OS1Error.message(dirty) }
    // Staging builds and rewrites release/ inside the checkout — take the
    // same source-write lease as any other OS-1 self-write.
    let lease = try acquireOS1SourceWriteLease(root: root)
    defer { withExtendedLifetime(lease) {} }
    let intent = try stageSelfUpdateRelease(root: root)
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    print(String(decoding: try encoder.encode(intent), as: UTF8.self))
    let registered = LocalProjectWorkspace.candidates(projectID: "os1-clodex").map(LocalProjectWorkspace.executionPath)
        .contains(LocalProjectWorkspace.executionPath(root))
    let installNote = registered
        ? "OS-1 installs it by itself as soon as no task is in flight and reports the receipt; do not run the installer or restart OS-1."
        : "\(root) is not a registered OS-1 source, so OS-1 does not install it by itself: run `os1 self-update apply --root '\(root)'` when no task is in flight. The apply brings the registered live tree up to this build when it can; otherwise run `os1 self-update sync-live`."
    print("OS-1 self-update staged: build \(intent.build) (\(intent.version)) from \(root); checks \(intent.checks.joined(separator: ", ")). " + installNote)
}

/// How staging launches every self-test child. On the staged bundle's own
/// config: the children used to get the installed app's config, so a staged
/// config change was validated against the old one (build-release.sh already
/// used the staged copy). And detached from the live run doing the staging:
/// build 326's staged suites inherited the conversation's run variables and
/// wrote fixture activity into the owner's run journal.
func stagedChildEnvironment(stagedApp app: String) throws -> (overrides: [String: String], removing: Set<String>) {
    let config = app + "/Contents/Resources/config.json"
    guard FileManager.default.fileExists(atPath: config) else {
        throw OS1Error.message("self-update stage: the staged app carries no Contents/Resources/config.json")
    }
    return (["OS1_CONFIG": config], LiveRunEnvironment.variables)
}

/// Builds the signed release for the tree at `root`, runs the release
/// self-tests and writes the intent. The caller holds the source-write lease.
func stageSelfUpdateRelease(root: String) throws -> SelfUpdate.Intent {
    let runtime = URL(fileURLWithPath: root).appendingPathComponent(SelfUpdate.runtimeRelativePath).path
    let installed = installedOS1Build()
    let plist = runtime + "/Resources/Info.plist"
    guard let build = Int(plistValue(plist, "CFBundleVersion") as? String ?? ""),
          let version = plistValue(plist, "CFBundleShortVersionString") as? String else {
        throw OS1Error.message("self-update stage: Resources/Info.plist has no readable CFBundleVersion/CFBundleShortVersionString")
    }
    guard build > installed else {
        throw OS1Error.message("self-update stage: Resources/Info.plist CFBundleVersion is \(build) but build \(installed) is installed; bump CFBundleVersion (and the version string in Sources/OS1/SelfUpdateCommands.swift) first")
    }
    RuntimeActivity.emit(.verifying, publicText: os1Tr("OS-1 자체 업데이트 build \(build) 릴리스 빌드 중 · 서명·유니버설",
        "Building the OS-1 self-update release for build \(build) · signed, universal"))
    // The release script cross-checks its own OS1_VERSION against the bundle's
    // short version and refuses to package when they differ; hand it the
    // version this build actually carries. It also runs app self-tests, so,
    // like every child below, it runs detached from the live run staging it.
    let built = try commandOutput("/bin/bash", [runtime + "/scripts/build-release.sh"], timeout: 1_800,
        currentDirectory: runtime, environmentOverrides: ["OS1_VERSION": version],
        removingEnvironment: LiveRunEnvironment.variables)
    guard built.0 == 0 else { throw OS1Error.message("self-update stage: release build failed\n" + outputTail(built)) }
    let app = SelfUpdate.stagedAppURL(root: root).path
    let cli = app + "/Contents/Resources/os1"
    guard Int(plistValue(app + "/Contents/Info.plist", "CFBundleVersion") as? String ?? "") == build else {
        throw OS1Error.message("self-update stage: staged app does not carry build \(build)")
    }
    let versionOutput = try commandOutput(cli, ["version"], timeout: 30, removingEnvironment: LiveRunEnvironment.variables)
    guard versionOutput.0 == 0, String(decoding: versionOutput.1, as: UTF8.self).contains("build\(build)") else {
        throw OS1Error.message("self-update stage: the `version` string in Sources/OS1/SelfUpdateCommands.swift must name build\(build) (staged CLI printed: \(String(decoding: versionOutput.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)))")
    }
    var checks = ["release-build: PASS", "version-string: PASS"]
    let child = try stagedChildEnvironment(stagedApp: app)
    // Every app suite that guards owner-facing behaviour runs on the staged
    // binary itself. The shell suite was missing here (and from the manual
    // routine) — which is how a composer that re-accepted file drops could
    // have shipped with green checks.
    for (label, executable, args) in [
        ("runtime-self-test", cli, ["self-test"]),
        ("fleet-self-test", cli, ["fleet-self-test"]),
        ("app-self-test", app + "/Contents/MacOS/OS1App", ["--self-test"]),
        ("app-self-test-shell", app + "/Contents/MacOS/OS1App", ["--self-test-shell"]),
        ("app-self-test-composer", app + "/Contents/MacOS/OS1App", ["--self-test-composer"]),
        ("app-self-test-steering", app + "/Contents/MacOS/OS1App", ["--self-test-steering"]),
        ("app-self-test-sidebar-queue", app + "/Contents/MacOS/OS1App", ["--self-test-sidebar-queue"]),
        ("app-self-test-queue-fork", app + "/Contents/MacOS/OS1App", ["--self-test-queue-fork"]),
        ("app-self-test-parallel", app + "/Contents/MacOS/OS1App", ["--self-test-parallel"]),
    ] {
        RuntimeActivity.emit(.verifying, publicText: os1Tr("OS-1 자체 업데이트 build \(build) 검증 중 · \(label)",
                                                           "Verifying the OS-1 self-update for build \(build) · \(label)"))
        let result = try commandOutput(executable, args, timeout: 600, currentDirectory: runtime,
            environmentOverrides: child.overrides, removingEnvironment: child.removing)
        guard result.0 == 0 else { throw OS1Error.message("self-update stage: \(label) failed\n" + outputTail(result)) }
        checks.append("\(label): PASS")
    }
    let environment = ProcessInfo.processInfo.environment
    let intent = SelfUpdate.Intent(build: build, version: version, sourceRoot: root, sourceCommit: gitHead(root),
        stagedAppSHA256: try fileSHA256(app + "/Contents/MacOS/OS1App"), stagedCLISHA256: try fileSHA256(cli),
        conversationID: environment["OS1_CONVERSATION_ID"], submissionID: environment["OS1_SUBMISSION_ID"], checks: checks)
    try SelfUpdate.save(intent, root: root)
    RuntimeActivity.emit(.verifying, publicText: os1Tr("OS-1 자체 업데이트 build \(build) 준비 완료 · 이 작업이 끝나면 OS-1이 스스로 설치하고 영수증을 이 대화에 남깁니다",
                                                       "The OS-1 self-update for build \(build) is ready · when this task ends, OS-1 installs it by itself and leaves the receipt in this conversation"))
    return intent
}

// MARK: OS-1 completes its own repair

/// Short version of the app installed in ~/Applications; "0.0.0" when absent.
func installedOS1Version() -> String {
    plistValue(installedAppURL.appendingPathComponent("Contents/Info.plist").path, "CFBundleShortVersionString") as? String ?? "0.0.0"
}

/// The version-identity line the release script cross-checks. Public so a
/// self-test can inspect the rewrite.
let os1RuntimeVersionPattern = #"let os1RuntimeVersionString = "OS-1 Runtime ([^" ]+) \(([a-z0-9-]*)build([0-9]+)\)""#

/// Makes the tree carry a build newer than the installed one, with the
/// runtime version string matching the bundle — the two mechanical facts
/// every backend kept getting wrong. Returns the (build, version) the tree
/// now carries. Rewrites nothing when the tree is already consistent and
/// newer than the installed build.
@discardableResult
func ensureSelfUpdateVersion(runtime: String, installed: Int, installedVersion: String) throws -> (build: Int, version: String) {
    let plist = runtime + "/Resources/Info.plist"
    let commands = runtime + "/Sources/OS1/SelfUpdateCommands.swift"
    guard let treeBuild = Int(plistValue(plist, "CFBundleVersion") as? String ?? ""),
          let treeVersion = plistValue(plist, "CFBundleShortVersionString") as? String else {
        throw OS1Error.message("self-repair: Resources/Info.plist has no readable CFBundleVersion/CFBundleShortVersionString")
    }
    guard var source = try? String(contentsOfFile: commands, encoding: .utf8),
          let regex = try? NSRegularExpression(pattern: os1RuntimeVersionPattern) else {
        throw OS1Error.message("self-repair: cannot read \(commands)")
    }
    let whole = NSRange(source.startIndex..., in: source)
    let match = regex.firstMatch(in: source, range: whole)
    let stringVersion = match.flatMap { Range($0.range(at: 1), in: source) }.map { String(source[$0]) }
    let stringBuild = match.flatMap { Range($0.range(at: 3), in: source) }.flatMap { Int(source[$0]) }
    if treeBuild > installed, stringVersion == treeVersion, stringBuild == treeBuild {
        return (treeBuild, treeVersion)
    }
    // Bump only what is stale. A tree the backend already moved past the
    // installed build keeps its numbers; only the identity line is repaired.
    var build = treeBuild, version = treeVersion
    if treeBuild <= installed {
        build = installed + 1
        var parts = installedVersion.split(separator: ".").map(String.init)
        if let last = parts.last, let patch = Int(last) { parts[parts.count - 1] = String(patch + 1) } else { parts.append("1") }
        version = parts.joined(separator: ".")
        for (key, value) in [("CFBundleVersion", String(build)), ("CFBundleShortVersionString", version)] {
            let result = try commandOutput("/usr/bin/plutil", ["-replace", key, "-string", value, plist], timeout: 30)
            guard result.0 == 0 else { throw OS1Error.message("self-repair: plutil could not set \(key)\n" + outputTail(result)) }
        }
    }
    let line = "let os1RuntimeVersionString = \"OS-1 Runtime \(version) (self-repair-build\(build))\""
    if let match {
        source = (source as NSString).replacingCharacters(in: match.range, with: line)
    } else {
        throw OS1Error.message("self-repair: \(commands) has no os1RuntimeVersionString line to rewrite")
    }
    try source.write(toFile: commands, atomically: true, encoding: .utf8)
    return (build, version)
}

/// Outcome of OS-1 finishing its own repair after a write task on its source.
enum SelfRepairCompletion: Equatable {
    case notApplicable(String)
    case staged(build: Int, note: String)
    case failed(String)
}


/// A conservative scan of what would be committed. Returns a description of
/// the first hit, or nil.
func selfRepairSecretHit(root: String, git: String, since startHead: String? = nil) -> String? {
    let runtime = SelfUpdate.runtimeRelativePath
    var corpus: [(String, String)] = []
    // Worktree AND index against HEAD: a file the backend already `git add`-ed
    // must not slip past the scan into `git add -A`.
    if let diff = try? commandOutput(git, ["-C", root, "diff", "HEAD", "--", runtime], timeout: 60), diff.0 == 0 {
        corpus.append(("tracked diff", String(decoding: diff.1, as: UTF8.self)))
    }
    // Commits the backend made during the task (a Claude backend commits and
    // pushes under the owner's remote-completion contract).
    if let startHead, let head = gitHead(root), head != startHead,
       let committed = try? commandOutput(git, ["-C", root, "diff", startHead, head, "--", runtime], timeout: 60), committed.0 == 0 {
        corpus.append(("commits since task start", String(decoding: committed.1, as: UTF8.self)))
    }
    if let untracked = try? commandOutput(git, ["-C", root, "ls-files", "--others", "--exclude-standard", "--", runtime], timeout: 60), untracked.0 == 0 {
        for file in String(decoding: untracked.1, as: UTF8.self).split(separator: "\n") {
            let path = root + "/" + file
            if let data = try? Data(contentsOf: URL(fileURLWithPath: path)), data.count <= 2_000_000,
               let text = String(data: data, encoding: .utf8) {
                corpus.append((String(file), text))
            }
        }
    }
    for (label, text) in corpus {
        if let pattern = SelfUpdate.secretPatternHit(text) {
            return "\(label) matches \(pattern)"
        }
    }
    return nil
}

/// What OS-1's own completion reads from and does to this Mac outside the
/// tree. Production uses the installed app, the real release build and the
/// registered roots; the fixture replaces them so it never builds a release
/// or reads the owner's state.
struct SelfRepairHost {
    var installedBuild: () -> Int = { installedOS1Build() }
    var installedVersion: () -> String = { installedOS1Version() }
    var staleDiagnostic: (String) -> String? = { staleOS1SourceDiagnostic(root: $0) }
    var stage: (String) throws -> SelfUpdate.Intent = { try stageSelfUpdateRelease(root: $0) }
    var isRegistered: (String) -> Bool = { root in
        LocalProjectWorkspace.candidates(projectID: "os1-clodex").map(LocalProjectWorkspace.executionPath)
            .contains(LocalProjectWorkspace.executionPath(root))
    }
}

/// The staging gate a `stageSelfUpdateRelease` error names: the self-test
/// label ("app-self-test-parallel"), "release-build", "version-string",
/// "staged-build", else "staging".
func selfRepairStagingGate(_ error: Error) -> String {
    let text = String(describing: error)
    if let range = text.range(of: #"self-update stage: ([a-z0-9-]+) failed"#, options: .regularExpression) {
        let match = String(text[range])
        return String(match.dropFirst("self-update stage: ".count).dropLast(" failed".count))
    }
    if text.contains("release build failed") { return "release-build" }
    if text.contains("must name build") { return "version-string" }
    if text.contains("staged app does not carry build") { return "staged-build" }
    return "staging"
}

/// A self-test gate can fail on timing alone (the parallel suite's restart
/// check); a release build or version mismatch cannot pass by running again.
func selfRepairGateIsSelfTest(_ gate: String) -> Bool { gate.hasSuffix("self-test") || gate.contains("self-test-") }

/// A remote-tracking ref already contains `commit` (read-only, no index lock).
func gitCommitIsPushed(_ commit: String, root: String) -> Bool {
    guard let git = try? findExecutable("git"),
          let remote = try? commandOutput(git, ["--no-optional-locks", "-C", root, "branch", "-r", "--contains", commit], timeout: 20),
          remote.0 == 0 else { return false }
    return !String(decoding: remote.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

/// Where a repair's change actually is: committed since `startHead` (and
/// whether a remote-tracking ref already contains it), or left uncommitted.
struct OS1RepairSourceState: Equatable {
    var head: String?
    var branch: String?
    /// HEAD moved past the start commit: the repair committed its change.
    var committed: Bool
    var pushed: Bool
    var uncommittedFiles: Int

    static func read(root: String, startHead: String?) -> OS1RepairSourceState {
        let head = gitHead(root)
        guard let git = try? findExecutable("git") else {
            return OS1RepairSourceState(head: head, branch: nil, committed: false, pushed: false, uncommittedFiles: 0)
        }
        // Read-only and lease-free (the repair's lease is already released):
        // a plain `git status` would rewrite the index under index.lock and
        // could fail another repair's `git add`/`git commit` beside it.
        let branch = (try? commandOutput(git, ["--no-optional-locks", "-C", root, "symbolic-ref", "--short", "-q", "HEAD"], timeout: 20))
            .flatMap { $0.0 == 0 ? String(decoding: $0.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) : nil }
            .flatMap { $0.isEmpty ? nil : $0 }
        let committed = head != nil && startHead != nil && head != startHead
        let pushed = committed && head.map { gitCommitIsPushed($0, root: root) } == true
        let status = (try? commandOutput(git, ["--no-optional-locks", "-C", root, "status", "--porcelain", "--", SelfUpdate.runtimeRelativePath], timeout: 60))
            .flatMap { $0.0 == 0 ? String(decoding: $0.1, as: UTF8.self) : nil } ?? ""
        let uncommitted = SelfUpdate.sourceChanges(status.split(separator: "\n").map { String($0.dropFirst(3)) }).count
        return OS1RepairSourceState(head: head, branch: branch, committed: committed, pushed: pushed, uncommittedFiles: uncommitted)
    }

    /// One sentence, in the diagnostic's language (English, like every
    /// completion diagnostic; the owner-facing note is built from the record).
    func description(root: String) -> String {
        var parts: [String] = []
        if committed, let head {
            parts.append("the repair's change is committed as \(head.prefix(7)) on \(branch ?? "a detached HEAD")"
                + (pushed ? " and pushed" : " (local only, not pushed)"))
        }
        if uncommittedFiles > 0 {
            parts.append("\(uncommittedFiles) source file(s) are still uncommitted in \(root)")
        }
        if parts.isEmpty { parts.append("no committed or uncommitted change of the repair remains in \(root)") }
        return parts.joined(separator: "; ")
    }
}

/// The start commit of the pending repair this run is bound to, when it is
/// still an ancestor of HEAD in `root` (nil when unbound or unrelated).
func os1PendingRepairStartHead(root: String, binding: PendingOS1RepairContext.Binding? = PendingOS1RepairContext.current) -> String? {
    guard let binding, let start = binding.store.load(id: binding.id)?.startCommit,
          gitCommit(start, isContainedIn: root) else { return nil }
    return start
}

/// OS-1 finishes its own repair. A backend's job ends when the source is
/// changed and builds; the mechanical tail — version bump, signed release,
/// self-tests, staging, commit, push — is OS-1's own, so completion never
/// depends on a backend following instructions. The caller holds the
/// source-write lease. Never throws: the outcome is part of the task's result.
/// A repair run binds its pending record (`PendingOS1RepairContext`): a
/// staging failure is recorded there for a model-free retry, and the record is
/// removed once the install intent is written.
func completeOS1SelfRepair(root: String, objective: String, startedAt: Date, startHead runStartHead: String? = nil, verifiedSourceReady: Bool = false,
                           host: SelfRepairHost = SelfRepairHost()) -> SelfRepairCompletion {
    let runtime = URL(fileURLWithPath: root).appendingPathComponent(SelfUpdate.runtimeRelativePath).path
    let installed = host.installedBuild()
    guard let git = try? findExecutable("git") else { return .failed("git is not available") }
    // A bound repair measures its change from the record's start, not from
    // this run's HEAD: a retried repair whose earlier attempt already
    // committed the change (then stopped before staging) finishes that
    // commit instead of reporting "no source change" (build 327).
    let startHead = os1PendingRepairStartHead(root: root) ?? runStartHead
    if let intent = SelfUpdate.loadIntent(root: root), intent.build > installed, intent.stagedAt >= startedAt {
        return .notApplicable("the task staged build \(intent.build) itself")
    }
    guard let status = try? commandOutput(git, ["-C", root, "status", "--porcelain", "--", SelfUpdate.runtimeRelativePath], timeout: 60),
          status.0 == 0 else { return .failed("git status failed under \(root)") }
    var changed = SelfUpdate.sourceChanges(String(decoding: status.1, as: UTF8.self).split(separator: "\n").map { String($0.dropFirst(3)) })
    // A backend that commits its own work (Claude does, under the owner's
    // remote-completion contract) leaves a clean tree; the change is then
    // the commits made since the task started, not the dirt in the tree.
    let head = gitHead(root)
    if let startHead, let head, head != startHead,
       let committed = try? commandOutput(git, ["-C", root, "diff", "--name-only", startHead, head, "--", SelfUpdate.runtimeRelativePath], timeout: 60),
       committed.0 == 0 {
        changed += SelfUpdate.sourceChanges(String(decoding: committed.1, as: UTF8.self).split(separator: "\n").map(String.init))
    }
    guard !changed.isEmpty || verifiedSourceReady else { return .notApplicable("no source change under \(SelfUpdate.runtimeRelativePath)") }
    if let hit = selfRepairSecretHit(root: root, git: git, since: startHead) {
        return .failed("refusing to commit or stage: possible credential in the change (\(hit))")
    }
    if let stale = host.staleDiagnostic(root) { return .failed(stale) }
    RuntimeActivity.emit(.verifying, publicText: os1Tr("OS-1 자체 수리 마무리 · 변경 \(changed.count)개 파일 · 버전 올리고 빌드·검증·스테이징·커밋까지 OS-1이 직접 합니다",
        "OS-1 finishing its own repair · \(changed.count) changed file(s) · version bump, build, tests, staging and commit are OS-1's own"))
    // The bump is OS-1's own edit: a staging failure takes it back, so a
    // failed build never leaves a dirty identity behind that blocks later
    // staging and the live-tree catch-up (2026-10-05, build 326).
    let versionFiles = [runtime + "/Resources/Info.plist", runtime + "/Sources/OS1/SelfUpdateCommands.swift"]
    let beforeBump = versionFiles.map { try? Data(contentsOf: URL(fileURLWithPath: $0)) }
    let build: Int, version: String
    do {
        (build, version) = try ensureSelfUpdateVersion(runtime: runtime, installed: installed, installedVersion: host.installedVersion())
    } catch { return .failed(String(describing: error)) }
    var staged: SelfUpdate.Intent?
    var stageFailure: Error?
    var gate = "staging"
    for attempt in 1...2 {
        do { staged = try host.stage(root); break } catch {
            stageFailure = error
            gate = selfRepairStagingGate(error)
            // One automatic re-run, no model call: a self-test can fail on
            // timing alone. A failed build or identity check cannot pass so.
            guard attempt == 1, selfRepairGateIsSelfTest(gate) else { break }
            RuntimeActivity.emit(.verifying, publicText: os1Tr(
                "OS-1 자체 업데이트 build \(build) 검증 \(gate) 실패 · 모델 호출 없이 스테이징을 한 번 더 실행합니다",
                "OS-1 self-update build \(build) failed \(gate) · running staging once more, without a model call"))
        }
    }
    guard let intent = staged else {
        for (path, data) in zip(versionFiles, beforeBump) {
            if let data { try? data.write(to: URL(fileURLWithPath: path), options: .atomic) }
        }
        let state = OS1RepairSourceState.read(root: root, startHead: startHead)
        let failureText = stageFailure.map { String(describing: $0) } ?? "staging failed"
        let binding = PendingOS1RepairContext.current
        if let binding {
            binding.store.update(id: binding.id) { record in
                record.state = .stagingFailed
                record.failedGate = gate
                record.lastError = String(failureText.prefix(2_000))
                record.repairCommit = state.committed ? state.head : nil
                record.repairBranch = state.branch
                record.repairPushed = state.committed ? state.pushed : nil
                record.sourceRoot = root
                if record.startCommit == nil { record.startCommit = startHead }
            }
        }
        let retried = selfRepairGateIsSelfTest(gate) ? " (run twice)" : ""
        let retry = binding == nil ? "" : " OS-1 retries staging without a model call on the next request in this conversation."
        return .failed("build \(build) (\(version)) did not pass staging at \(gate)\(retried) — nothing was installed; "
            + state.description(root: root) + "; the version bump was reverted." + retry + " " + failureText)
    }
    // Commit on the current branch (a dedicated branch when on main or
    // detached), then re-record the intent against that commit.
    var branch = (try? commandOutput(git, ["-C", root, "symbolic-ref", "--short", "-q", "HEAD"], timeout: 20))
        .flatMap { $0.0 == 0 ? String(decoding: $0.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines) : nil } ?? ""
    if branch.isEmpty || branch == "main" || branch == "master" {
        branch = "os1/self-repair-build\(build)"
        _ = try? commandOutput(git, ["-C", root, "checkout", "-q", "-B", branch], timeout: 60)
    }
    let firstLine = objective.split(whereSeparator: \.isNewline).first.map(String.init) ?? "self-repair"
    let subject = "os1: self-repair build \(build) — " + String(firstLine.prefix(64))
    let body = "Objective (owner request):\n" + String(objective.prefix(1_500)) + "\n\nStaged by OS-1 self-repair · " +
        intent.checks.joined(separator: ", ") + " · OS-1 installs this build by itself."
    let add = try? commandOutput(git, ["-C", root, "add", "-A", "--", SelfUpdate.runtimeRelativePath,
                                        ":(exclude)" + SelfUpdate.releaseEntryRelativePath], timeout: 60)
    guard add?.0 == 0 else { return .failed("git add failed: " + (add.map { outputTail($0) } ?? "")) }
    let commit = try? commandOutput(git, ["-C", root, "commit", "-q", "-m", subject, "-m", body], timeout: 120)
    guard commit?.0 == 0, let head = gitHead(root) else {
        return .failed("git commit failed: " + (commit.map { outputTail($0) } ?? ""))
    }
    let recorded = SelfUpdate.Intent(build: intent.build, version: intent.version, sourceRoot: root, sourceCommit: head,
        stagedAppSHA256: intent.stagedAppSHA256, stagedCLISHA256: intent.stagedCLISHA256, stagedAt: intent.stagedAt,
        conversationID: intent.conversationID, submissionID: intent.submissionID, checks: intent.checks)
    try? SelfUpdate.save(recorded, root: root)
    // The install intent exists: the pending repair is done (the app's
    // install receipt reports the rest).
    if let binding = PendingOS1RepairContext.current, SelfUpdate.loadIntent(root: root) != nil {
        binding.store.remove(id: binding.id)
    }
    var pushNote: String
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let path = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    if let push = try? commandOutput(git, ["-C", root, "push", "-q", "origin", "HEAD:" + branch], timeout: 240,
                                     environmentOverrides: ["PATH": path]), push.0 == 0 {
        pushNote = "pushed to origin/\(branch)"
    } else {
        pushNote = "commit is local only — push to origin/\(branch) did not succeed"
    }
    // Only registered roots are installed automatically; a fleet clone or
    // another checkout must not promise an install that will not happen.
    let registered = host.isRegistered(root)
    let installNote = registered ? "OS-1 installs this build by itself when no task is running and posts the receipt here."
        : "This checkout is not a registered OS-1 source, so OS-1 does not install it by itself; merge the pushed commit into the live source to ship it."
    let note = "OS-1 self-repair: staged build \(build) (\(version)) · " + intent.checks.joined(separator: ", ") +
        " · commit \(head.prefix(7)) on \(branch) · \(pushNote) · " + installNote
    return .staged(build: build, note: note)
}

private func applySelfUpdate(root requested: String?) throws {
    let roots = requested.map { [$0] } ?? LocalProjectWorkspace.candidates(projectID: "os1-clodex")
    guard let pending = SelfUpdate.pendingIntents(roots: roots).first else {
        throw OS1Error.message("self-update apply: no staged build (no \(SelfUpdate.intentRelativePath) under \(roots.isEmpty ? "any registered OS-1 root" : roots.joined(separator: ", ")))")
    }
    let root = pending.root
    var intent = pending.intent
    let installed = installedOS1Build()
    let home = FileManager.default.homeDirectoryForCurrentUser
    func fail(_ error: String) throws -> Never {
        let outcome = SelfUpdate.Outcome(intent: intent, success: false, receiptPath: nil, error: error,
            summary: SelfUpdate.summary(success: false, intent: intent, checks: [], sessionsBefore: nil, sessionsAfter: nil, receiptPath: nil, error: error))
        try SelfUpdate.saveOutcome(outcome, home: home)
        SelfUpdate.removeIntent(root: root)
        throw OS1Error.message("self-update apply: " + error)
    }
    switch SelfUpdate.decision(intent: intent, installedBuild: installed, busy: false) {
    case .notNewer:
        SelfUpdate.removeIntent(root: root)
        print("self-update apply: build \(intent.build) is not newer than the installed build \(installed); intent discarded")
        return
    case .stale: try fail("staged more than 24 hours ago; stage again")
    case .exhausted: try fail("gave up after \(intent.applyAttempts) install attempts: \(intent.lastError ?? "unknown")")
    case .apply, .applying, .waitBusy: break
    }
    intent.state = "applying"
    intent.applyAttempts += 1
    intent.lastAttemptAt = Date()
    try SelfUpdate.save(intent, root: root)

    // Private copy: later edits in the checkout cannot change what gets installed.
    let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "")
    let staging = home.appendingPathComponent(".os1/self-update/staging/\(intent.build)-\(stamp)", isDirectory: true)
    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: staging) }
    let app = staging.appendingPathComponent("OS-1 CLODEX.app").path
    let copied = try commandOutput("/usr/bin/ditto", [SelfUpdate.stagedAppURL(root: root).path, app], timeout: 300)
    guard copied.0 == 0 else { try fail("could not copy the staged app: " + outputTail(copied)) }
    guard try fileSHA256(app + "/Contents/MacOS/OS1App") == intent.stagedAppSHA256,
          try fileSHA256(app + "/Contents/Resources/os1") == intent.stagedCLISHA256 else {
        try fail("the staged app changed after staging; stage again")
    }
    let installerSource = URL(fileURLWithPath: root).appendingPathComponent(SelfUpdate.installerRelativePath)
    let installer = staging.appendingPathComponent("install-local-verified.mjs")
    try FileManager.default.copyItem(at: installerSource, to: installer)
    let recovery = home.appendingPathComponent(".os1/recovery/self-update-build\(intent.build)-\(stamp)").path
    let node = try findExecutable("node")
    let result = try commandOutput(node, [installer.path, app, recovery, String(intent.build), "--preserve-queue"], timeout: 900)
    let text = outputTail(result, limit: 6_000)
    if result.0 == 0 {
        let receipt = (try? JSONSerialization.jsonObject(with: result.1)) as? [String: Any]
        let checks = receipt?["checks"] as? [String] ?? []
        let receiptPath = recovery + "/install-receipt.json"
        let summary = SelfUpdate.summary(success: true, intent: intent, checks: checks,
            sessionsBefore: receipt?["sessionCountBefore"] as? Int, sessionsAfter: receipt?["sessionCountAfter"] as? Int,
            receiptPath: receiptPath, error: nil)
        try SelfUpdate.saveOutcome(SelfUpdate.Outcome(intent: intent, success: true, receiptPath: receiptPath, error: nil, summary: summary), home: home)
        SelfUpdate.removeIntent(root: root)
        print(summary)
        // Installed from a side worktree: keep the registered live tree current,
        // or OS-1's next repair finds no source (see advanceOS1LiveTrees).
        if let installedCommit = intent.sourceCommit {
            let live = advanceOS1LiveTrees(installedCommit: installedCommit, history: installedOS1SourceHistory())
            for (liveRoot, outcome) in live where outcome != .alreadyCurrent && outcome != .notLiveTree {
                print("self-update apply: live OS-1 source \(liveRoot): \(outcome.reason)")
            }
            if !live.contains(where: { $0.result == .advanced || $0.result == .alreadyCurrent }) {
                print("self-update apply: no registered OS-1 source folder holds build \(intent.build)'s commit \(installedCommit.prefix(7)); OS-1 brings it up before its next repair, or run `os1 self-update sync-live`")
            }
        }
        return
    }
    let transient = SelfUpdate.isTransientInstallFailure(text)
    if transient {
        // Busy is not failure: an active user task or a running fleet job
        // must never consume the install budget. The intent simply stays
        // pending (its 24-hour freshness cap still applies).
        intent.state = "pending"
        intent.applyAttempts = max(0, intent.applyAttempts - 1)
        intent.lastError = String(text.suffix(600))
        try SelfUpdate.save(intent, root: root)
        print("self-update apply: OS-1 was busy; the staged build stays pending")
        return
    }
    try fail("installer failed: " + String(text.suffix(1_200)))
}

private func printSelfUpdateStatus(root: String?) throws {
    let roots = root.map { [$0] } ?? LocalProjectWorkspace.candidates(projectID: "os1-clodex")
    struct Status: Encodable {
        let installedBuild: Int
        let installedVersion: String
        let pending: [SelfUpdate.Intent]
        let outcomes: [SelfUpdate.Outcome]
    }
    let status = Status(installedBuild: installedOS1Build(), installedVersion: os1RuntimeVersionString,
        pending: SelfUpdate.pendingIntents(roots: roots).map(\.intent), outcomes: Array(SelfUpdate.outcomes().suffix(5)))
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes, .prettyPrinted]
    print(String(decoding: try encoder.encode(status), as: UTF8.self))
}

// MARK: Requests about OS-1 work in OS-1's live source tree

/// The registered local project a turn works in. A named or already bound
/// project wins; otherwise a request about OS-1 itself binds OS-1 (see
/// `OS1SelfReference`). Another named or bound registered project is never
/// overridden, and read-only work is never inferred.
struct LocalProjectBinding: Equatable {
    let projectID: String?
    let inference: OS1SelfReference.Inference?
    var inferred: Bool { projectID == "os1-clodex" && inference?.bound == true }
}

func localProjectBinding(request: String, workspace: String, namedProjectID: String?, boundProjectID: String?,
                         readOnly: Bool, os1Roots: [String]? = nil) -> LocalProjectBinding {
    for id in [namedProjectID, boundProjectID].compactMap({ $0 }) where ProjectAdapterRegistry.kind(for: id) == .localWorkspace {
        return LocalProjectBinding(projectID: id, inference: nil)
    }
    let otherProject = namedProjectID != nil || boundProjectID.map { ProjectAdapterRegistry.kind(for: $0) != nil } == true
    guard !otherProject, !readOnly else { return LocalProjectBinding(projectID: nil, inference: nil) }
    let inference = OS1SelfReference.infer(request: request, projectless: OS1SelfReference.isProjectless(workspace),
        os1Roots: os1Roots ?? LocalProjectWorkspace.candidates(projectID: "os1-clodex"))
    return LocalProjectBinding(projectID: inference.bound ? "os1-clodex" : nil, inference: inference)
}

/// Source commit of the installed build, when OS-1 installed it itself.
func installedOS1SourceCommit() -> String? {
    let installed = installedOS1Build()
    return SelfUpdate.outcomes().last(where: { $0.success && $0.intent.build == installed })?.intent.sourceCommit
}

/// A registered root is current when it already contains the installed
/// build's source commit, so a stale clone never outranks the live tree just
/// because its index was touched more recently.
func resolveLocalProjectWorkspace(projectID: String, requested: String) -> LocalProjectWorkspace.Resolution? {
    guard projectID == "os1-clodex", let commit = installedOS1SourceCommit(), let git = try? findExecutable("git") else {
        return LocalProjectWorkspace.resolve(projectID: projectID, requested: requested)
    }
    return LocalProjectWorkspace.resolve(projectID: projectID, requested: requested) { root in
        (try? commandOutput(git, ["-C", root, "merge-base", "--is-ancestor", commit, "HEAD"], timeout: 10))?.0 == 0
    }
}

/// Source commits OS-1 installed itself, newest first, without repeats.
func installedOS1SourceHistory() -> [String] {
    var seen = Set<String>()
    return SelfUpdate.outcomes().reversed().compactMap { $0.success ? $0.intent.sourceCommit : nil }.filter { seen.insert($0).inserted }
}

/// What `advanceOS1LiveTrees` found for one registered OS-1 tree.
enum OS1LiveTreeAdvance: Equatable {
    case advanced, alreadyCurrent, notLiveTree, diverged, detached, missingCommit, busy
    case dirty(String)
    case failed(String)

    var reason: String {
        switch self {
        case .advanced: return os1Tr("설치된 build의 소스로 맞췄습니다", "brought up to the installed build's source")
        case .alreadyCurrent: return os1Tr("이미 설치된 build의 소스를 담고 있습니다", "already contains the installed build's source")
        case .notLiveTree: return os1Tr("OS-1이 마지막으로 쓰던 소스 폴더가 아니라 건드리지 않았습니다", "is not the source folder OS-1 last worked in; left alone")
        case .diverged: return os1Tr("설치된 커밋에 없는 로컬 커밋이 있어 자동으로 맞추지 않았습니다", "has local commits the installed commit lacks; not moved automatically")
        case .detached: return os1Tr("브랜치가 아닌 커밋에 있어 자동으로 맞추지 않았습니다", "is on a detached commit, not a branch; not moved automatically")
        case .missingCommit: return os1Tr("이 저장소에 설치된 커밋이 없습니다", "does not have the installed commit in its repository")
        case .busy: return os1Tr("다른 OS-1 작업이 이 소스를 쓰는 중이라 지금은 맞추지 않았습니다", "another OS-1 writer holds this source; not moved now")
        case .dirty: return os1Tr("커밋되지 않은 OS-1 소스 변경이 있어 자동으로 맞추지 않았습니다", "has uncommitted OS-1 source changes; not moved automatically")
        case .failed(let detail): return os1Tr("맞추지 못했습니다: \(detail)", "could not be moved: \(detail)")
        }
    }
}

/// A build installed from a checkout that is not registered (a side worktree)
/// leaves the registered live tree behind, and OS-1 then finds no current
/// source for its own repairs: builds 320 and 322 on 2026-10-04 each left
/// "OS-1 CLODEX 소스 폴더를 찾지 못했습니다" until someone fast-forwarded the
/// live tree by hand. Only when no registered tree holds `installedCommit`,
/// fast-forward exactly one tree: of the trees holding the newest earlier
/// build any registered tree still holds (`history`, newest first), the one
/// whose git index changed last. So a tree several side installs behind still
/// heals and a second registered checkout on its own branch is not moved. That
/// tree must sit strictly behind `installedCommit` on a branch, with a clean
/// runtime subtree and a free OS-1 writer lease. Never merges, rebases,
/// resets, fetches or waits for a lease.
func advanceOS1LiveTrees(installedCommit: String, history: [String],
                         candidates: [String] = LocalProjectWorkspace.candidates(projectID: "os1-clodex"))
    -> [(root: String, result: OS1LiveTreeAdvance)] {
    guard let git = try? findExecutable("git") else { return [] }
    func succeeds(_ root: String, _ arguments: [String]) -> Bool {
        (try? commandOutput(git, ["-C", root] + arguments, timeout: 20))?.0 == 0
    }
    var seen = Set<String>()
    let roots = candidates.map(LocalProjectWorkspace.executionPath).filter { seen.insert($0).inserted }
    let current = roots.filter { succeeds($0, ["merge-base", "--is-ancestor", installedCommit, "HEAD"]) }
    guard current.isEmpty else { return current.map { ($0, .alreadyCurrent) } }
    // Most recently changed first, read from each tree's own index: for a
    // linked worktree (the live tree is one) `<root>/.git` is a file and the
    // index lives under the common git dir, so ask git for its path.
    func changedAt(_ root: String) -> Date {
        var path = root
        if let result = try? commandOutput(git, ["-C", root, "rev-parse", "--path-format=absolute", "--git-path", "index"], timeout: 20),
           result.0 == 0 {
            let index = String(decoding: result.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
            if FileManager.default.fileExists(atPath: index) { path = index }
        }
        return (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date ?? .distantPast
    }
    // A plain loop: each tree is probed once per commit (a lazy compactMap
    // would re-run the probes and trap if the second run disagreed).
    var live: String?
    for commit in history where commit != installedCommit {
        let holders = roots.filter { succeeds($0, ["merge-base", "--is-ancestor", commit, "HEAD"]) }
        guard !holders.isEmpty else { continue }
        var newest: (root: String, changed: Date)?
        for root in holders {
            let changed = changedAt(root)
            // Ties go to the lexically first root, as in LocalProjectWorkspace.resolve.
            if let best = newest, changed < best.changed || (changed == best.changed && root > best.root) { continue }
            newest = (root, changed)
        }
        live = newest?.root
        break
    }
    func outcome(_ root: String) -> OS1LiveTreeAdvance {
        guard succeeds(root, ["cat-file", "-e", installedCommit + "^{commit}"]) else { return .missingCommit }
        guard succeeds(root, ["merge-base", "--is-ancestor", "HEAD", installedCommit]) else { return .diverged }
        guard succeeds(root, ["symbolic-ref", "-q", "HEAD"]) else { return .detached }
        // Non-blocking: a repair, a stage or this very process may hold it.
        guard let lease = try? tryAcquireOS1SourceWriteLease(root: root) else { return .busy }
        defer { withExtendedLifetime(lease) {} }
        if let dirty = uncommittedOS1SourceDiagnostic(root: root) { return .dirty(dirty) }
        // Not through commandOutput: the owner's stop button (OS1_CANCEL_FILE)
        // or a short timeout killing git mid-checkout would leave the tree
        // half-updated and then refused as dirty. A fast-forward is seconds.
        let merge = Process()
        merge.executableURL = URL(fileURLWithPath: git)
        merge.arguments = ["-C", root, "merge", "--ff-only", "-q", installedCommit]
        let errors = Pipe()
        merge.standardOutput = FileHandle.nullDevice
        merge.standardError = errors
        do { try merge.run() } catch { return .failed("git merge did not run: \(error.localizedDescription)") }
        let detail = errors.fileHandleForReading.readDataToEndOfFile()
        merge.waitUntilExit()
        guard merge.terminationStatus == 0, succeeds(root, ["merge-base", "--is-ancestor", installedCommit, "HEAD"]) else {
            return .failed(String(decoding: detail.suffix(400), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return .advanced
    }
    return roots.map { root in (root, root == live ? outcome(root) : .notLiveTree) }
}

/// Why no registered tree holds the installed build's source, per tree.
func os1SourceNotFoundDiagnostic(requestedWorkspace: String, installedCommit: String?,
                                 results: [(root: String, result: OS1LiveTreeAdvance)]) -> String {
    let build = installedOS1Build()
    let installedSource = SelfUpdate.outcomes().last(where: { $0.success && $0.intent.build == build })?.intent.sourceRoot
    let marker = LocalProjectWorkspace.marker(for: "os1-clodex") ?? "products/os1-mac-runtime/Package.swift"
    let commit = installedCommit.map { String($0.prefix(7)) } ?? os1Tr("(기록 없음)", "(not recorded)")
    let trees = results.isEmpty
        ? os1Tr("등록된 OS-1 소스 폴더가 없습니다", "no registered OS-1 source folder")
        : results.map { "\($0.root) — \($0.result.reason)" }.joined(separator: "; ")
    let source = installedSource.map { os1Tr(" 설치에 쓰인 소스: \($0).", " Installed from: \($0).") } ?? ""
    return os1Tr(
        "OS-1 CLODEX 소스 폴더를 찾지 못했습니다. 대화 폴더 \(requestedWorkspace)에는 \(marker)이(가) 없고, 등록된 OS-1 소스 폴더 중 설치된 build \(build)의 소스 커밋 \(commit)을 담은 곳이 없습니다.\(source) 등록된 폴더: \(trees). 그 폴더를 설치된 커밋까지 맞추거나(os1 self-update sync-live), 설치된 build의 소스 폴더를 이 대화의 작업 폴더로 선택한 뒤 다시 요청하세요.",
        "OS-1 CLODEX source folder not found. The conversation folder \(requestedWorkspace) has no \(marker), and no registered OS-1 source folder contains the installed build \(build)'s source commit \(commit).\(source) Registered folders: \(trees). Bring that folder up to the installed commit (os1 self-update sync-live), or choose the installed build's source folder as this conversation's working folder, then ask again.")
}

/// `resolveLocalProjectWorkspace` for a request about to write OS-1's source:
/// when no registered tree holds the installed build's source, first bring the
/// tree OS-1 last worked in up to it. Read-only callers keep the plain
/// resolver, which never changes a tree.
func resolveLocalProjectWorkspaceHealing(projectID: String, requested: String)
    -> (resolution: LocalProjectWorkspace.Resolution?, healed: [String], diagnostic: String?) {
    if let resolved = resolveLocalProjectWorkspace(projectID: projectID, requested: requested) { return (resolved, [], nil) }
    guard projectID == "os1-clodex" else { return (nil, [], nil) }
    let installedCommit = installedOS1SourceCommit()
    let results = installedCommit.map { advanceOS1LiveTrees(installedCommit: $0, history: installedOS1SourceHistory()) } ?? []
    let healed = results.filter { $0.result == .advanced }.map(\.root)
    // Re-resolve even when this call moved nothing: a writer that held the
    // lease may just have brought the tree up itself.
    if let resolved = resolveLocalProjectWorkspace(projectID: projectID, requested: requested) { return (resolved, healed, nil) }
    return (nil, healed, os1SourceNotFoundDiagnostic(requestedWorkspace: requested, installedCommit: installedCommit, results: results))
}

/// `os1 self-update sync-live`: the same fast-forward, run by hand after
/// installing from a side worktree.
private func syncLiveOS1Source() throws {
    guard let installedCommit = installedOS1SourceCommit() else {
        throw OS1Error.message("self-update sync-live: the installed build \(installedOS1Build()) has no recorded source commit")
    }
    let results = advanceOS1LiveTrees(installedCommit: installedCommit, history: installedOS1SourceHistory())
    for (root, result) in results { print("\(root): \(result.reason)") }
    guard results.contains(where: { $0.result == .advanced || $0.result == .alreadyCurrent }) else {
        throw OS1Error.message("self-update sync-live: no registered OS-1 source folder holds build \(installedOS1Build())'s commit \(installedCommit.prefix(7))")
    }
}

/// A write task whose folder contains the live OS-1 tree (usually HOME) but
/// which was not bound to it. If its backend changed OS-1's source anyway,
/// OS-1 still finishes that repair, or says plainly why it did not.
struct OS1SourceWatch: Equatable {
    let root: String
    let head: String?
    let fingerprint: String?

    /// Status, tracked diff and untracked contents of the runtime subtree.
    /// Read-only on the tree: `--no-optional-locks` keeps `git status` from
    /// refreshing the index under index.lock, which would fail a repair's
    /// own `git add`/`commit` running at the same moment (build 320: a HOME
    /// task's watch no longer always holds the shared lease).
    static func fingerprint(root: String) -> String? {
        guard let git = try? findExecutable("git") else { return nil }
        let runtime = SelfUpdate.runtimeRelativePath
        guard let status = try? commandOutput(git, ["--no-optional-locks", "-C", root, "status", "--porcelain=v1", "-uall", "--", runtime], timeout: 20),
              status.0 == 0, status.1.count <= 4_000_000,
              let diff = try? commandOutput(git, ["--no-optional-locks", "-C", root, "diff", "HEAD", "--", runtime], timeout: 30), diff.0 == 0 else { return nil }
        var data = status.1 + diff.1
        for line in String(decoding: status.1, as: UTF8.self).split(separator: "\n").prefix(500) where line.hasPrefix("?? ") {
            let url = URL(fileURLWithPath: root).appendingPathComponent(String(line.dropFirst(3)))
            if let bytes = try? Data(contentsOf: url), bytes.count <= 2_000_000 { data += bytes }
        }
        return sha256Hex(data)
    }

    /// OS-1's live tree when `workspace` contains it without being inside it.
    static func containedRoot(workspace: String) -> String? {
        let folder = LocalProjectWorkspace.executionPath(workspace)
        guard LocalProjectWorkspace.root(containing: folder, projectID: "os1-clodex") == nil,
              let live = resolveLocalProjectWorkspace(projectID: "os1-clodex", requested: folder)?.workspace else { return nil }
        let root = LocalProjectWorkspace.executionPath(live)
        return root.hasPrefix(folder == "/" ? "/" : folder + "/") ? root : nil
    }

    static func capture(workspace: String) -> OS1SourceWatch? {
        containedRoot(workspace: workspace).map { OS1SourceWatch(root: $0, head: gitHead($0), fingerprint: fingerprint(root: $0)) }
    }

    func changed() -> Bool {
        gitHead(root) != head || OS1SourceWatch.fingerprint(root: root) != fingerprint
    }
}

/// Finish an OS-1 source change made by a task that was not bound to OS-1.
/// Never waits for another writer: its build would include this change.
func finishUnboundOS1Change(_ watch: OS1SourceWatch, objective: String, startedAt: Date) -> String {
    // The watch sees the tree, not who wrote it: another HOME task running
    // at the same time may have made the change. Say so instead of claiming
    // it (2026-10-02, a domain-name answer said "this task changed OS-1's
    // source" while another conversation's repair was editing it).
    let busy = os1Tr("OS-1 자체 수리 대기: 이 작업이 진행되는 동안 OS-1 소스(\(watch.root))가 바뀌었습니다. 이 작업이 바꾼 것인지 같은 시간에 돈 다른 작업이 바꾼 것인지는 구분하지 않았습니다. 다른 작업이 같은 소스를 쓰고 있어 지금 빌드하지 않았고, 변경은 작업 트리에 그대로 두어 다음 자체 수리 빌드에 함께 빌드·설치됩니다.",
        "OS-1 self-repair pending: OS-1's source (\(watch.root)) changed while this task ran — by this task or by another one running at the same time. Another task is using the same source, so it was not built now; the change stays in the working tree and is built and installed with the next repair.")
    guard let lease = try? tryAcquireOS1SourceWriteLease(root: watch.root) else { return busy }
    defer { withExtendedLifetime(lease) {} }
    // Commits OS-1 itself made meanwhile belong to another repair.
    if let start = watch.head, let head = gitHead(watch.root), head != start, let git = try? findExecutable("git"),
       let log = try? commandOutput(git, ["-C", watch.root, "log", "--format=%s", "\(start)..\(head)"], timeout: 20), log.0 == 0,
       String(decoding: log.1, as: UTF8.self).split(separator: "\n").contains(where: {
           $0.hasPrefix("os1: self-repair build") || $0.hasPrefix("OS-1 build")
       }) {
        return busy
    }
    switch completeOS1SelfRepair(root: watch.root, objective: objective, startedAt: startedAt, startHead: watch.head) {
    case .notApplicable: return ""
    case .staged(_, let note): return note
    case .failed(let diagnostic): return selfRepairFailurePrefixText + diagnostic
    }
}

/// `os1 self-update stage` refuses a tree with uncommitted OS-1 source: the
/// installed build must be reproducible from git (and so from R2).
func uncommittedOS1SourceDiagnostic(root: String) -> String? {
    guard let git = try? findExecutable("git"),
          let status = try? commandOutput(git, ["-C", root, "status", "--porcelain", "--", SelfUpdate.runtimeRelativePath], timeout: 60),
          status.0 == 0 else { return nil }
    let changed = String(decoding: status.1, as: UTF8.self).split(separator: "\n").filter {
        // The release link is rewritten by every build; it is not source.
        !$0.hasSuffix(SelfUpdate.runtimeRelativePath + "/release")
    }
    guard !changed.isEmpty else { return nil }
    return "self-update stage: \(root) has \(changed.count) uncommitted OS-1 source file(s). Commit them first, so the installed build exists in git and the R2 backup. When a task changes OS-1's own source, OS-1 commits, builds, installs and pushes it itself after the turn; do not stage it from inside the task."
}

/// Staging a checkout that lacks the installed build's source commit would
/// install older code under a newer build number (a stale copy such as a
/// dated folder, or a tree behind the build that is running).
func staleOS1SourceDiagnostic(root: String, installedCommit: String? = installedOS1SourceCommit()) -> String? {
    guard let installedCommit, let git = try? findExecutable("git"),
          let result = try? commandOutput(git, ["-C", root, "merge-base", "--is-ancestor", installedCommit, "HEAD"], timeout: 20),
          result.0 != 0 else { return nil }
    return "refusing to stage \(root): it does not contain the installed build's source commit \(installedCommit.prefix(7)), so its build would bring back older code. The change stays in the working tree; work in the live OS-1 source or bring this checkout up to date first."
}
