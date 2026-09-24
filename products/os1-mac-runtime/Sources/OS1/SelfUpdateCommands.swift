import Foundation
import OS1Context
import OS1HookSupport

/// `os1 self-update stage --source <root>`: build, verify and hand a new
/// OS-1 build to the running app. `os1 self-update apply [--root <root>]`:
/// install a staged build through the verified local installer (the app
/// launches this detached when idle). `os1 self-update status`: read-only.
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
    default: throw OS1Error.message("self-update: expected stage, apply or status")
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
        throw OS1Error.message("self-repair: usage: os1 self-repair complete --source <OS-1 checkout> [--objective <text>]")
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
    guard subcommand == "complete" else { throw OS1Error.message("self-repair: expected complete") }
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

let os1RuntimeVersionString = "OS-1 Runtime 0.9.164 (self-repair-build230)"

/// Serialize source edits without dropping a queued request after three minutes.
/// flock ownership, not a stale lock-file timestamp, determines availability.
func acquireOS1SourceWriteLease(root: String, timeoutSeconds: Int? = nil) throws -> ExclusiveHookLease {
    let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/self-update", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let canonical = URL(fileURLWithPath: root).resolvingSymlinksInPath().standardizedFileURL.path
    let lock = directory.appendingPathComponent("source-write-" + sha256Hex(Data(canonical.utf8)).prefix(16) + ".lock")
    let deadline = timeoutSeconds.map { Date().addingTimeInterval(TimeInterval($0)) }
    var lastNotice = Date.distantPast
    return try ExclusiveHookLease.acquireWaiting(at: lock, beforeAttempt: {
        if ExecutionCancellation.isCancelled { throw OS1Error.backendBlocked(.cancelled) }
        if let deadline, Date() >= deadline {
            throw OS1Error.message("OS-1 source-write wait deadline reached; no source edits were dispatched.")
        }
    }, onContention: {
        if Date().timeIntervalSince(lastNotice) >= 10 {
            lastNotice = Date()
            RuntimeActivity.emit(.preparing, publicText: os1Tr(
                "OS-1 소스 쓰기 차례를 기다리는 중 · 백엔드는 아직 시작하지 않았습니다. 기존 작업이 끝나면 자동으로 이어갑니다.",
                "Waiting for the OS-1 source writer · backend not started. This request continues automatically when the writer releases it."))
        }
    })
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
    // Staging builds and rewrites release/ inside the checkout — take the
    // same source-write lease as any other OS-1 self-write.
    let lease = try acquireOS1SourceWriteLease(root: root)
    defer { withExtendedLifetime(lease) {} }
    let intent = try stageSelfUpdateRelease(root: root)
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    print(String(decoding: try encoder.encode(intent), as: UTF8.self))
    print("OS-1 self-update staged: build \(intent.build) (\(intent.version)) from \(root); checks \(intent.checks.joined(separator: ", ")). OS-1 installs it by itself as soon as no task is in flight and reports the receipt; do not run the installer or restart OS-1.")
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
    // version this build actually carries.
    let built = try commandOutput("/bin/bash", [runtime + "/scripts/build-release.sh"], timeout: 1_800,
        currentDirectory: runtime, environmentOverrides: ["OS1_VERSION": version])
    guard built.0 == 0 else { throw OS1Error.message("self-update stage: release build failed\n" + outputTail(built)) }
    let app = SelfUpdate.stagedAppURL(root: root).path
    let cli = app + "/Contents/Resources/os1"
    guard Int(plistValue(app + "/Contents/Info.plist", "CFBundleVersion") as? String ?? "") == build else {
        throw OS1Error.message("self-update stage: staged app does not carry build \(build)")
    }
    let versionOutput = try commandOutput(cli, ["version"], timeout: 30)
    guard versionOutput.0 == 0, String(decoding: versionOutput.1, as: UTF8.self).contains("build\(build)") else {
        throw OS1Error.message("self-update stage: the `version` string in Sources/OS1/SelfUpdateCommands.swift must name build\(build) (staged CLI printed: \(String(decoding: versionOutput.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)))")
    }
    var checks = ["release-build: PASS", "version-string: PASS"]
    var overrides: [String: String] = [:]
    let config = installedAppURL.appendingPathComponent("Contents/Resources/config.json").path
    if FileManager.default.fileExists(atPath: config) { overrides["OS1_CONFIG"] = config }
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
        RuntimeActivity.emit(.verifying, publicText: "OS-1 자체 업데이트 build \(build) 검증 중 · \(label)")
        let result = try commandOutput(executable, args, timeout: 600, currentDirectory: runtime, environmentOverrides: overrides)
        guard result.0 == 0 else { throw OS1Error.message("self-update stage: \(label) failed\n" + outputTail(result)) }
        checks.append("\(label): PASS")
    }
    let environment = ProcessInfo.processInfo.environment
    let intent = SelfUpdate.Intent(build: build, version: version, sourceRoot: root, sourceCommit: gitHead(root),
        stagedAppSHA256: try fileSHA256(app + "/Contents/MacOS/OS1App"), stagedCLISHA256: try fileSHA256(cli),
        conversationID: environment["OS1_CONVERSATION_ID"], submissionID: environment["OS1_SUBMISSION_ID"], checks: checks)
    try SelfUpdate.save(intent, root: root)
    RuntimeActivity.emit(.verifying, publicText: "OS-1 자체 업데이트 build \(build) 준비 완료 · 이 작업이 끝나면 OS-1이 스스로 설치하고 영수증을 이 대화에 남깁니다")
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

/// OS-1 finishes its own repair. A backend's job ends when the source is
/// changed and builds; the mechanical tail — version bump, signed release,
/// self-tests, staging, commit, push — is OS-1's own, so completion never
/// depends on a backend following instructions. The caller holds the
/// source-write lease. Never throws: the outcome is part of the task's result.
func completeOS1SelfRepair(root: String, objective: String, startedAt: Date, startHead: String? = nil, verifiedSourceReady: Bool = false) -> SelfRepairCompletion {
    let runtime = URL(fileURLWithPath: root).appendingPathComponent(SelfUpdate.runtimeRelativePath).path
    let installed = installedOS1Build()
    guard let git = try? findExecutable("git") else { return .failed("git is not available") }
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
    RuntimeActivity.emit(.verifying, publicText: os1Tr("OS-1 자체 수리 마무리 · 변경 \(changed.count)개 파일 · 버전 올리고 빌드·검증·스테이징·커밋까지 OS-1이 직접 합니다",
        "OS-1 finishing its own repair · \(changed.count) changed file(s) · version bump, build, tests, staging and commit are OS-1's own"))
    let build: Int, version: String
    do {
        (build, version) = try ensureSelfUpdateVersion(runtime: runtime, installed: installed, installedVersion: installedOS1Version())
    } catch { return .failed(String(describing: error)) }
    let intent: SelfUpdate.Intent
    do { intent = try stageSelfUpdateRelease(root: root) } catch {
        return .failed("build \(build) (\(version)) did not pass staging — the source change stays in the working tree, nothing was installed. " + String(describing: error))
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
    var pushNote: String
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let path = "\(home)/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    if let push = try? commandOutput(git, ["-C", root, "push", "-q", "origin", "HEAD:" + branch], timeout: 240,
                                     environmentOverrides: ["PATH": path]), push.0 == 0 {
        pushNote = "pushed to origin/\(branch)"
    } else {
        pushNote = "commit is local only — push to origin/\(branch) did not succeed"
    }
    let note = "OS-1 self-repair: staged build \(build) (\(version)) · " + intent.checks.joined(separator: ", ") +
        " · commit \(head.prefix(7)) on \(branch) · \(pushNote) · OS-1 installs this build by itself when no task is running and posts the receipt here."
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
