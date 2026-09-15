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

let os1RuntimeVersionString = "OS-1 Runtime 0.9.76 (receipt-schema-build142)"

/// One writer at a time in OS-1's own checkout: the same RCC discipline the
/// runtime enforces elsewhere, applied to itself. Waits briefly for the other
/// writer, then preserves the request instead of interleaving edits.
func acquireOS1SourceWriteLease(root: String, timeoutSeconds: Int = 180) throws -> ExclusiveHookLease {
    let directory = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".os1/self-update", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let lock = directory.appendingPathComponent("source-write-" + sha256Hex(Data(root.utf8)).prefix(16) + ".lock")
    let deadline = Date().addingTimeInterval(TimeInterval(timeoutSeconds))
    var announced = false
    while true {
        if let lease = try ExclusiveHookLease.tryAcquire(at: lock) { return lease }
        if ExecutionCancellation.isCancelled { throw OS1Error.backendBlocked(.cancelled) }
        guard Date() < deadline else {
            throw OS1Error.message(os1Tr(
                "OS-1 소스 체크아웃(\(root))에 다른 쓰기 작업이 진행 중이라 이 요청을 보존했습니다. 진행 중인 작업이 끝나면 다시 보내세요. 같은 트리에 동시 편집은 허용하지 않습니다.",
                "Another write task is running in the OS-1 source checkout (\(root)); this request is preserved. Send it again after that task finishes — concurrent edits in the same tree are not allowed."))
        }
        if !announced {
            announced = true
            RuntimeActivity.emit(.preparing, publicText: os1Tr(
                "OS-1 소스에 다른 쓰기 작업이 진행 중입니다. 끝날 때까지 대기 후 이 요청을 이어갑니다.",
                "Another write task holds the OS-1 source. Waiting for it to finish, then continuing this request."))
        }
        Thread.sleep(forTimeInterval: 2)
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
    let runtime = URL(fileURLWithPath: root).appendingPathComponent(SelfUpdate.runtimeRelativePath).path
    let installed = installedOS1Build()
    let plist = runtime + "/Resources/Info.plist"
    guard let build = Int(plistValue(plist, "CFBundleVersion") as? String ?? ""),
          let version = plistValue(plist, "CFBundleShortVersionString") as? String else {
        throw OS1Error.message("self-update stage: Resources/Info.plist has no readable CFBundleVersion/CFBundleShortVersionString")
    }
    guard build > installed else {
        throw OS1Error.message("self-update stage: Resources/Info.plist CFBundleVersion is \(build) but build \(installed) is installed; bump CFBundleVersion (and the version string in Sources/OS1/main.swift) first")
    }
    // Staging builds and rewrites release/ inside the checkout — take the
    // same source-write lease as any other OS-1 self-write.
    let lease = try acquireOS1SourceWriteLease(root: root)
    defer { withExtendedLifetime(lease) {} }
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
        throw OS1Error.message("self-update stage: the `version` string in Sources/OS1/main.swift must name build\(build) (staged CLI printed: \(String(decoding: versionOutput.1, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)))")
    }
    var checks = ["release-build: PASS", "version-string: PASS"]
    var overrides: [String: String] = [:]
    let config = installedAppURL.appendingPathComponent("Contents/Resources/config.json").path
    if FileManager.default.fileExists(atPath: config) { overrides["OS1_CONFIG"] = config }
    for (label, executable, args) in [
        ("runtime-self-test", cli, ["self-test"]),
        ("fleet-self-test", cli, ["fleet-self-test"]),
        ("app-self-test", app + "/Contents/MacOS/OS1App", ["--self-test"]),
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
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    print(String(decoding: try encoder.encode(intent), as: UTF8.self))
    print("OS-1 self-update staged: build \(build) (\(version)) from \(root); checks \(checks.joined(separator: ", ")). OS-1 installs it by itself as soon as no task is in flight and reports the receipt; do not run the installer or restart OS-1.")
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
    let transient = ["leave the installation unchanged", "Fleet work/claim unresolved", "queue changed during installation"]
        .contains(where: text.contains)
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
