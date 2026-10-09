import Foundation
import CryptoKit
import OS1Context

/// OS-1 repairing OS-1: the intent left by `self-update stage`, the app's
/// apply decision, the outcome record it reports, and the contract wording
/// handed to the backend.
func runSelfUpdateFixtures() throws {
    try runSourceWriteAdmissionFixtures()
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Self-update: " + message); count += 1
    }
    let now = Date(timeIntervalSince1970: 1_789_800_000)
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-self-update-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let home = root.appendingPathComponent("home", isDirectory: true)
    let installed = SelfUpdate.installedAppURL(home: home)
    try FileManager.default.createDirectory(at: installed.appendingPathComponent("Contents"), withIntermediateDirectories: true)
    try PropertyListSerialization.data(fromPropertyList: ["CFBundleVersion": "199"], format: .xml, options: 0)
        .write(to: installed.appendingPathComponent("Contents/Info.plist"))
    check(SelfUpdate.installedBuild(home: home) == 199, "read actual installed build, not staged caller build200")
    check(SelfUpdate.isInstalledApp(installed, home: home), "installed GUI owns store")
    check(!SelfUpdate.isInstalledApp(root.appendingPathComponent("stage/OS-1 CLODEX.app"), home: home), "staged GUI must not own store")
    let alias = root.appendingPathComponent("alias.app")
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: installed)
    check(SelfUpdate.isInstalledApp(alias, home: home), "canonical symlink identity")
    let first = try OS1LiveStoreLease(home: home)
    check(first.tryAcquire(), "first GUI acquires ownership")
    let second = try OS1LiveStoreLease(home: home)
    check(!second.tryAcquire(), "second GUI cannot open shared store")
    check(SelfUpdate.installedBuild(home: root.appendingPathComponent("missing")) == 0, "missing installation is not a completed install")
    for message in ["active task did not drain; leave installation unchanged", "active user task; leave the installation unchanged", "another installer owns maintenance lease", "non-installed OS1 writer is running"] {
        check(SelfUpdate.isTransientInstallFailure(message), "busy must preserve staged intent: " + message)
    }
    check(!SelfUpdate.isTransientInstallFailure("signature mismatch"), "signature error is not a transient busy state")
    // A requested checkout is not authoritative merely because its marker exists.
    // Apply the installed-source floor to every candidate, including a sole candidate.
    let workspaceHome = root.appendingPathComponent("workspace-home", isDirectory: true)
    let stale = workspaceHome.appendingPathComponent("stale", isDirectory: true)
    let current = workspaceHome.appendingPathComponent("current", isDirectory: true)
    for checkout in [stale, current] {
        let marker = checkout.appendingPathComponent("products/os1-mac-runtime/Package.swift")
        try FileManager.default.createDirectory(at: marker.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("// fixture".utf8).write(to: marker)
    }
    let config = workspaceHome.appendingPathComponent(".codex/config.toml")
    try FileManager.default.createDirectory(at: config.deletingLastPathComponent(), withIntermediateDirectories: true)
    let currentPath = current.standardizedFileURL.resolvingSymlinksInPath().path
    let stalePath = stale.standardizedFileURL.resolvingSymlinksInPath().path
    try Data("[projects.\(String(reflecting: current.path))]\ntrust_level = \"trusted\"\n".utf8).write(to: config)
    let resolved = LocalProjectWorkspace.resolve(projectID: "os1-clodex", requested: stale.path, home: workspaceHome, isCurrent: { $0 == currentPath })
    check(resolved?.workspace == currentPath, "stale requested checkout falls back to current registered checkout")
    check(resolved?.fromRequestedWorkspace == false, "fallback does not claim requested-source identity")
    check(LocalProjectWorkspace.resolve(projectID: "os1-clodex", requested: stale.path, home: workspaceHome, isCurrent: { _ in false }) == nil, "all stale candidates fail closed")
    check(LocalProjectWorkspace.resolve(projectID: "os1-clodex", requested: stale.path, home: workspaceHome)?.workspace == stalePath, "without a floor the valid requested checkout remains preferred")
    check(LocalProjectWorkspace.resolve(projectID: "os1-clodex", requested: current.path, home: workspaceHome, isCurrent: { $0 == currentPath })?.fromRequestedWorkspace == true, "current requested checkout retains authority")
    let workspaceAlias = workspaceHome.appendingPathComponent("current-alias")
    try FileManager.default.createSymbolicLink(at: workspaceAlias, withDestinationURL: current)
    let aliased = LocalProjectWorkspace.resolve(projectID: "os1-clodex", requested: workspaceAlias.path, home: workspaceHome, isCurrent: { $0 == currentPath })
    check(aliased?.workspace == currentPath && aliased?.alternates.isEmpty == true, "symlink and registered source deduplicate by canonical identity")
    try Data().write(to: config)
    check(LocalProjectWorkspace.resolve(projectID: "os1-clodex", requested: stale.path, home: workspaceHome, isCurrent: { _ in false }) == nil, "sole stale requested checkout cannot bypass installed-source floor")

    // Exact activated source is discoverable even without a Codex trust entry.
    // Every app, repository, outcome and HOME below is a disposable fixture.
    let activationHome = URL(fileURLWithPath: LocalProjectWorkspace.executionPath(root.appendingPathComponent("activation-home").path))
    let activeSource = activationHome.appendingPathComponent("Documents/current-source")
    let activatedApp = SelfUpdate.installedAppURL(home: activationHome)
    let activeMarker = activeSource.appendingPathComponent(SelfUpdate.runtimeRelativePath + "/Package.swift")
    try FileManager.default.createDirectory(at: activeMarker.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("// fixture activation source\n".utf8).write(to: activeMarker)
    func fixtureGit(_ arguments: [String]) throws -> String {
        let process = Process(), pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", activeSource.path] + arguments
        process.environment = ["HOME": activationHome.path, "PATH": "/usr/bin:/bin", "LC_ALL": "C",
                               "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"]
        process.standardInput = FileHandle.nullDevice; process.standardOutput = pipe; process.standardError = FileHandle.nullDevice
        try process.run(); let data = pipe.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw CocoaError(.fileReadUnknown) }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    _ = try fixtureGit(["init", "-q"])
    _ = try fixtureGit(["add", "-A"])
    _ = try fixtureGit(["-c", "user.name=OS1 Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "activation source"])
    _ = try fixtureGit(["remote", "add", "origin", "https://github.com/effacermonexistence/codex.git"])
    let activatedCommit = try fixtureGit(["rev-parse", "HEAD"])
    for directory in ["Contents/MacOS", "Contents/Resources"] {
        try FileManager.default.createDirectory(at: activatedApp.appendingPathComponent(directory), withIntermediateDirectories: true)
    }
    let appBytes = Data("fixture installed GUI\n".utf8), cliBytes = Data("fixture installed CLI\n".utf8)
    let activatedAppExecutable = activatedApp.appendingPathComponent("Contents/MacOS/OS1App")
    let activatedCLI = activatedApp.appendingPathComponent("Contents/Resources/os1")
    try appBytes.write(to: activatedAppExecutable); try cliBytes.write(to: activatedCLI)
    func writeActivatedBuild(_ build: Int) throws {
        try PropertyListSerialization.data(fromPropertyList: ["CFBundleVersion": String(build)], format: .xml, options: 0)
            .write(to: activatedApp.appendingPathComponent("Contents/Info.plist"))
    }
    try writeActivatedBuild(354)
    func digest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    let appHash = digest(appBytes), cliHash = digest(cliBytes)
    func saveActivated(build: Int = 354, source: String? = nil, commit: String? = activatedCommit,
                       app: String? = nil, cli: String? = nil, success: Bool = true) throws {
        let intent = SelfUpdate.Intent(build: build, version: "fixture", sourceRoot: source ?? activeSource.path,
            sourceCommit: commit, stagedAppSHA256: app ?? appHash, stagedCLISHA256: cli ?? cliHash,
            stagedAt: now, conversationID: nil, submissionID: nil, checks: [])
        try SelfUpdate.saveOutcome(SelfUpdate.Outcome(id: "activated-fixture", intent: intent, success: success,
            receiptPath: nil, error: success ? nil : "fixture install failed", summary: "fixture", completedAt: now), home: activationHome)
    }
    func hasActivated() -> Bool { LocalProjectWorkspace.candidates(projectID: "os1-clodex", home: activationHome).contains(activeSource.path) }
    try saveActivated()
    check(LocalProjectWorkspace.registeredRoots(home: activationHome).isEmpty && hasActivated(),
          "exact successfully activated source is a candidate without a Codex trust registration")
    check(!FileManager.default.fileExists(atPath: activationHome.appendingPathComponent(".codex/config.toml").path),
          "activation discovery never creates Codex config or trust")
    check(LocalProjectWorkspace.candidates(projectID: "unrelated-project", home: activationHome).isEmpty,
          "activation receipt never contributes roots for another project")
    check(LocalProjectWorkspace.resolve(projectID: "os1-clodex", requested: activationHome.path, home: activationHome,
        isCurrent: { $0 == activeSource.path })?.workspace == activeSource.path, "HOME resolves the exact activated source through its existing current-state gate")
    check(LocalProjectWorkspace.resolve(projectID: "os1-clodex", requested: activationHome.path, home: activationHome,
        isCurrent: { _ in false }) == nil, "activation candidate never bypasses downstream source floor")
    for (label, mutate) in [
        ("wrong installed build", { try saveActivated(build: 353) }),
        ("wrong installed app hash", { try saveActivated(app: String(repeating: "0", count: 64)) }),
        ("wrong embedded CLI hash", { try saveActivated(cli: String(repeating: "0", count: 64)) }),
        ("failed outcome", { try saveActivated(success: false) }),
        ("missing source commit", { try saveActivated(commit: nil) }),
        ("nonexistent source commit", { try saveActivated(commit: String(repeating: "0", count: 40)) }),
        ("malformed source commit", { try saveActivated(commit: "HEAD") }),
        ("relative source root", { try saveActivated(source: "Documents/current-source") }),
        ("noncanonical source root", { try saveActivated(source: activeSource.path + "/../current-source") }),
        ("source outside fixture HOME", { try saveActivated(source: stale.path) }),
        ("fleet job source", { try saveActivated(source: activationHome.appendingPathComponent(".os1/fleet/jobs/source").path) }),
        ("temporary source", { try saveActivated(source: activationHome.appendingPathComponent("tmp/source").path) }),
    ] as [(String, () throws -> Void)] {
        try mutate(); check(!hasActivated(), label + " cannot supply an activated source")
    }
    try saveActivated()
    _ = try fixtureGit(["remote", "set-url", "origin", "https://github.com/foreign/codex.git"])
    check(!hasActivated(), "foreign repository cannot supply the activated source")
    _ = try fixtureGit(["remote", "set-url", "origin", "https://github.com/effacermonexistence/codex.git"])
    try FileManager.default.removeItem(at: activeMarker)
    check(!hasActivated(), "missing OS-1 marker blocks activation source")
    try Data("// fixture activation source\n".utf8).write(to: activeMarker)
    try Data("fixture newer commit\n".utf8).write(to: activeSource.appendingPathComponent("new.txt"))
    _ = try fixtureGit(["add", "-A"])
    _ = try fixtureGit(["-c", "user.name=OS1 Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "newer"])
    check(hasActivated(), "recorded producing commit may be an ancestor of the current source HEAD")
    let detachedCommit = try fixtureGit(["rev-parse", "HEAD"])
    _ = try fixtureGit(["reset", "--hard", activatedCommit])
    try saveActivated(commit: detachedCommit)
    check(!hasActivated(), "a producing commit absent from source HEAD ancestry is stale")
    try saveActivated()
    try Data("different installed GUI\n".utf8).write(to: activatedAppExecutable)
    check(!hasActivated(), "changed physical installed binary invalidates the outcome binding")
    try appBytes.write(to: activatedAppExecutable)
    try writeActivatedBuild(355)
    check(!hasActivated(), "old activated receipt does not describe a newer installation")
    try writeActivatedBuild(354)
    check(hasActivated(), "only the matching current installed build and binaries re-admit its source")
    let activationConfig = activationHome.appendingPathComponent(".codex/config.toml")
    try FileManager.default.createDirectory(at: activationConfig.deletingLastPathComponent(), withIntermediateDirectories: true)
    let registeredBytes = Data("[projects.\(String(reflecting: activeSource.path))]\ntrust_level = \"trusted\"\n".utf8)
    try registeredBytes.write(to: activationConfig)
    check(LocalProjectWorkspace.registeredRoots(home: activationHome) == [activeSource.path],
          "registeredRoots remains exactly the existing Codex project table")
    check(LocalProjectWorkspace.candidates(projectID: "os1-clodex", home: activationHome) == [activeSource.path],
          "the activated root and a matching registered root are deduplicated")
    check(try Data(contentsOf: activationConfig) == registeredBytes, "discovery never rewrites an existing Codex trust entry")

    let checkoutA = root.appendingPathComponent("a").path
    let checkoutB = root.appendingPathComponent("b").path

    // Intent round trip inside the checkout; a foreign or oversized file is ignored.
    let conversation = UUID().uuidString
    let intentA = SelfUpdate.Intent(build: 126, version: "0.9.60", sourceRoot: checkoutA, sourceCommit: String(repeating: "c", count: 40),
        stagedAppSHA256: "app-hash", stagedCLISHA256: "cli-hash", stagedAt: now, conversationID: conversation.lowercased(),
        submissionID: "not-a-uuid", checks: ["release-build: PASS"])
    try SelfUpdate.save(intentA, root: checkoutA)
    check((try FileManager.default.attributesOfItem(atPath: SelfUpdate.intentURL(root: checkoutA).path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "intent is private")
    let loaded = SelfUpdate.loadIntent(root: checkoutA)
    check(loaded?.build == 126 && loaded?.conversationID == conversation && loaded?.submissionID == nil
          && loaded?.checks == ["release-build: PASS"] && loaded?.state == "pending", "intent round trip normalises ids and keeps checks")
    check(SelfUpdate.loadIntent(root: checkoutB) == nil, "absent intent is nil")
    try FileManager.default.createDirectory(at: SelfUpdate.intentURL(root: checkoutB).deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("{\"schema\":2,\"build\":1}".utf8).write(to: SelfUpdate.intentURL(root: checkoutB))
    check(SelfUpdate.loadIntent(root: checkoutB) == nil, "unknown schema is ignored")
    try SelfUpdate.save(SelfUpdate.Intent(build: 127, version: "0.9.61", sourceRoot: checkoutB, sourceCommit: nil, stagedAppSHA256: "x",
        stagedCLISHA256: "y", stagedAt: now, conversationID: nil, submissionID: nil, checks: []), root: checkoutB)
    let pending = SelfUpdate.pendingIntents(roots: [checkoutA, checkoutB, root.appendingPathComponent("none").path])
    check(pending.map(\.intent.build) == [127, 126] && pending[0].root == checkoutB, "newest build first, roots without intents skipped")
    SelfUpdate.removeIntent(root: checkoutB)
    check(SelfUpdate.loadIntent(root: checkoutB) == nil, "intent removal")

    // Apply decision matrix.
    func variant(_ mutate: (inout SelfUpdate.Intent) -> Void) -> SelfUpdate.Intent { var value = intentA; mutate(&value); return value }
    check(SelfUpdate.decision(intent: intentA, installedBuild: 125, busy: false, now: now) == .apply, "newer + idle applies")
    check(SelfUpdate.decision(intent: intentA, installedBuild: 125, busy: true, now: now) == .waitBusy, "busy waits")
    check(SelfUpdate.decision(intent: intentA, installedBuild: 126, busy: false, now: now) == .notNewer, "same build is not applied")
    check(SelfUpdate.decision(intent: intentA, installedBuild: 125, busy: false, now: now.addingTimeInterval(SelfUpdate.intentMaxAge + 1)) == .stale, "old intent is stale")
    check(SelfUpdate.decision(intent: variant { $0.applyAttempts = SelfUpdate.maximumApplyAttempts }, installedBuild: 125, busy: false, now: now) == .exhausted, "attempt budget")
    check(SelfUpdate.decision(intent: variant { $0.state = "applying"; $0.lastAttemptAt = now.addingTimeInterval(-60) }, installedBuild: 125, busy: false, now: now) == .applying, "in-progress apply is not duplicated")
    check(SelfUpdate.decision(intent: variant { $0.state = "applying"; $0.lastAttemptAt = now.addingTimeInterval(-SelfUpdate.applyingStaleAfter - 1) }, installedBuild: 125, busy: false, now: now) == .apply, "a stuck apply mark is retried")

    // Install hold (2026-10-02: build 298 "이거는 지워" waited behind five
    // back-to-back tasks and never reached the screen). A newer build waiting
    // for running work holds new work until it installs, bounded.
    check(SelfUpdate.holdsNewWork(intent: intentA, installedBuild: 125, since: nil, now: now), "a newer staged build holds new work")
    check(SelfUpdate.holdsNewWork(intent: intentA, installedBuild: 125, since: now.addingTimeInterval(-60), now: now), "the hold lasts while work drains")
    check(!SelfUpdate.holdsNewWork(intent: intentA, installedBuild: 125, since: now.addingTimeInterval(-SelfUpdate.holdNewWorkLimit), now: now),
          "a hung run cannot freeze OS-1: the hold ends at the limit")
    check(SelfUpdate.holdsNewWork(intent: variant { $0.state = "applying"; $0.lastAttemptAt = now.addingTimeInterval(-30) }, installedBuild: 125, since: nil, now: now),
          "nothing new starts while the installer runs")
    check(!SelfUpdate.holdsNewWork(intent: intentA, installedBuild: 126, since: nil, now: now), "an installed build holds nothing")
    check(!SelfUpdate.holdsNewWork(intent: variant { $0.applyAttempts = SelfUpdate.maximumApplyAttempts }, installedBuild: 125, since: nil, now: now),
          "an exhausted install holds nothing")
    check(!SelfUpdate.holdsNewWork(intent: intentA, installedBuild: 125, since: nil, now: now.addingTimeInterval(SelfUpdate.intentMaxAge + 1)),
          "a stale intent holds nothing")
    check(SelfUpdate.activeHold(home: home, now: now) == nil, "no marker, no hold")
    try SelfUpdate.saveHold(SelfUpdate.Hold(build: 126, since: now), home: home)
    check((try FileManager.default.attributesOfItem(atPath: SelfUpdate.holdURL(home: home).path)[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          "hold marker is private")
    check(SelfUpdate.activeHold(home: home, now: now.addingTimeInterval(60))?.build == 126, "the fleet sees the hold")
    check(SelfUpdate.activeHold(home: home, now: now.addingTimeInterval(SelfUpdate.holdNewWorkLimit)) == nil,
          "a marker left by a crashed app expires at the limit")
    try JSONSerialization.data(withJSONObject: ["build": 126, "since": "2026-09-19T06:00:00Z", "expiresAt": "2099-01-01T00:00:00Z"])
        .write(to: SelfUpdate.holdURL(home: home))
    check(SelfUpdate.activeHold(home: home, now: now) == nil, "a marker claiming more than the limit holds nothing")
    SelfUpdate.clearHold(home: home)
    check(SelfUpdate.activeHold(home: home, now: now) == nil, "cleared hold")

    // Outcomes: private, ordered, reported once.
    let success = SelfUpdate.Outcome(id: "one", intent: intentA, success: true, receiptPath: "/tmp/r.json", error: nil,
        summary: SelfUpdate.summary(success: true, intent: intentA, checks: Array(repeating: "x: PASS", count: 9), sessionsBefore: 83, sessionsAfter: 83, receiptPath: "/tmp/r.json", error: nil),
        completedAt: now)
    let failure = SelfUpdate.Outcome(id: "two", intent: intentA, success: false, receiptPath: nil, error: "installer failed: app did not quit",
        summary: SelfUpdate.summary(success: false, intent: intentA, checks: [], sessionsBefore: nil, sessionsAfter: nil, receiptPath: nil, error: "installer failed: app did not quit"),
        completedAt: now.addingTimeInterval(10))
    try SelfUpdate.saveOutcome(failure, home: home)
    try SelfUpdate.saveOutcome(success, home: home)
    check((try FileManager.default.attributesOfItem(atPath: SelfUpdate.outcomesDirectory(home: home).path)[.posixPermissions] as? NSNumber)?.intValue == 0o700, "outcome directory is private")
    check(SelfUpdate.unreportedOutcomes(home: home).map(\.id) == ["one", "two"], "outcomes ordered by completion, all unreported")
    try SelfUpdate.markReported(success, home: home)
    check(SelfUpdate.unreportedOutcomes(home: home).map(\.id) == ["two"], "reported outcome leaves the queue")
    check(success.summary.contains("build 126 (0.9.60)") && success.summary.contains("검사 9개 PASS") && success.summary.contains("세션 83→83") && success.summary.contains("커밋 ccccccc"),
          "success summary names build, checks, sessions and commit: \(success.summary)")
    check(failure.summary.contains("설치 실패") && failure.summary.contains("이전 빌드를 유지") && failure.summary.contains("app did not quit"), "failure summary keeps the cause")

    // Contract wording.
    let card = SelfUpdate.capabilityCard(root: checkoutA, installedVersion: "OS-1 Runtime 0.9.59 (self-update-build125)", installedBuild: 125,
        sourceCommit: "0123456789abcdef", scope: "readOnly", os1Executable: "/Users/x/.local/bin/os1")
    check(card.contains("OS-1 itself bumps the build past 125") && card.contains("do NOT run scripts/install-local-verified.mjs")
          && card.contains("do NOT run `self-update stage`") && card.contains("commits the change on the current branch, pushes it")
          && card.contains("0123456789ab") && card.contains("Task scope: readOnly")
          && card.contains("never say OS-1 can only be partially self-repaired"), "contract keeps the mechanical tail with OS-1, forbids manual installs, names build floor and scope")
    // A read question about OS-1's code is not a change report (2026-10-01:
    // "파일 수정이나 테스트 실행은 하지 않았습니다" cost a short answer its focus).
    check(card.contains("If you changed files, report what you changed") && card.contains("If the request only needed reading")
          && !card.contains("4. Report what you changed"), "only a change is reported")
    // 2026-10-01: "한 줄만 말하면 그대로 작업이 돼" overpromised; a bare "메뉴바 바꿔"
    // is not bound to OS-1's source. Capability answers carry the conditions.
    check(card.contains("with the conditions the source imposes") && card.contains("rather than an unconditional promise"),
          "capability answers keep the source's conditions")

    // The release link is re-pointed by every release build in any checkout
    // (2026-09-23: a fleet self-repair committed a link into its job cache).
    check(SelfUpdate.sourceChanges(["products/os1-mac-runtime/release"]).isEmpty,
          "re-pointed release link alone is not a source change")
    check(SelfUpdate.sourceChanges(["products/os1-mac-runtime/release", "products/os1-mac-runtime/Sources/OS1App/OS1App.swift", ""])
          == ["products/os1-mac-runtime/Sources/OS1App/OS1App.swift"], "real source changes survive, the link and blanks do not")
    check(SelfUpdate.sourceChanges(["products/os1-mac-runtime/release/self-update-intent.json", "products/os1-mac-runtime/releases"]).count == 2,
          "only the exact link path is excluded")
    print("Self-update: \(count) checks passed; intent/outcome custody, apply decision matrix, contract wording, release link")
}
