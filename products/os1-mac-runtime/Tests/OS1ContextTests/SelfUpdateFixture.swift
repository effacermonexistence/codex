import Foundation
import OS1Context

/// OS-1 repairing OS-1: the intent left by `self-update stage`, the app's
/// apply decision, the outcome record it reports, and the contract wording
/// handed to the backend.
func runSelfUpdateFixtures() throws {
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
