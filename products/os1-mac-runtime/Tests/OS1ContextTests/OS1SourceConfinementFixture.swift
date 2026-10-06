import Darwin
import Foundation
import OS1Context

/// A HOME write task confined from OS-1's live source instead of holding its
/// shared lease (build 320): the exact Claude settings, the protected paths of
/// a worktree checkout, the per-attempt state and escalation markers. Full
/// access resumes remove the broad sandbox without removing source protection.
func runOS1SourceConfinementFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) {
        precondition(condition, "Source confinement: " + message); checks += 1
    }
    // The exact shape verified by the live Claude Code 2.1.286 probes.
    let plain = OS1SourceConfinement.claudeSettings(protectedPaths: ["/Users/LUA/x"])
    check(plain == #"{"permissions":{"deny":["Edit(//Users/LUA/x/**)"]},"sandbox":{"allowUnsandboxedCommands":false,"enabled":true,"failIfUnavailable":true,"filesystem":{"denyWrite":["/Users/LUA/x"]},"network":{"allowedDomains":["*"],"allowLocalBinding":true,"allowMachLookup":["com.apple.trustd","com.apple.trustd.agent","com.apple.SecurityServer","com.apple.securityd.xpc"]}}}"#,
        "settings JSON matches the probed shape: \(plain)")
    check(!plain.contains("excludedCommands"), "no command escapes the sandbox")

    // The live tree's git admin directory sits under "Documents - MacBook Air (2)".
    let spaced = "/Users/LUA/Documents/Documents - MacBook Air (2)/Codex/repo/.git/worktrees/live"
    check(OS1SourceConfinement.editDenyRule(path: spaced) ==
        #"Edit(//Users/LUA/Documents/Documents - MacBook Air \\\(2\\\)/Codex/repo/.git/worktrees/live/**)"#,
        "a folder with spaces and parentheses gets Claude's own escaped rule spelling")
    check(OS1SourceConfinement.editDenyRule(path: "/a/b*c[d]") == #"Edit(//a/b\\*c\\[d\\]/**)"#, "glob characters in a folder name stay literal")
    let two = OS1SourceConfinement.claudeSettings(protectedPaths: ["/Users/LUA/live tree", spaced])
    guard let object = try JSONSerialization.jsonObject(with: Data(two.utf8)) as? [String: Any],
          let permissions = object["permissions"] as? [String: Any], let deny = permissions["deny"] as? [String],
          let sandbox = object["sandbox"] as? [String: Any], let filesystem = sandbox["filesystem"] as? [String: Any],
          let denyWrite = filesystem["denyWrite"] as? [String] else { fatalError("confinement settings are not JSON") }
    check(deny == ["Edit(//Users/LUA/live tree/**)", OS1SourceConfinement.editDenyRule(path: spaced)],
        "one Edit deny rule per protected path, in order")
    check(denyWrite == ["/Users/LUA/live tree", spaced], "sandbox denyWrite lists every protected path unescaped")

    // Protected paths of a worktree checkout whose admin dir is outside it.
    let base = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("os1-confinement " + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: base) }
    let common = base.appendingPathComponent("main repo (2)/.git")
    let admin = common.appendingPathComponent("worktrees/live")
    let live = base.appendingPathComponent("live tree")
    for folder in [admin, live] { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
    try Data("gitdir: \(admin.path)\n".utf8).write(to: live.appendingPathComponent(".git"))
    // realpath(3), not URL.resolvingSymlinksInPath (which drops /private).
    func real(_ url: URL) -> String {
        guard let resolved = realpath(url.path, nil) else { return url.path }
        defer { free(resolved) }
        return String(cString: resolved)
    }
    let realLive = real(live), realAdmin = real(admin)
    let fixtureHome = base.appendingPathComponent("home")
    let dataVolume = "/System/Volumes/Data"
    func primary(_ paths: [String]) -> [String] { paths.filter { !$0.hasPrefix(dataVolume + "/") } }
    let protected = OS1SourceConfinement.protectedPaths(root: live.path, home: fixtureHome)
    check(primary(protected) == [realLive, realAdmin], "worktree admin dir is protected with the tree: \(protected)")
    check(!protected.contains(real(common)),
        "the common git dir other worktrees share is never protected")
    // /Users/… is also /System/Volumes/Data/Users/… (same inode, a second
    // spelling realpath keeps): each protected path is protected under both.
    for path in protected where path.hasPrefix(dataVolume + "/") {
        check(primary(protected).contains(String(path.dropFirst(dataVolume.count))), "an alias names a protected path: \(path)")
    }
    if FileManager.default.fileExists(atPath: dataVolume + realLive) {
        check(protected.contains(dataVolume + realLive) && protected.contains(dataVolume + realAdmin),
            "the data-volume spelling of every protected path is protected too")
    }
    // A relative gitdir is resolved against the worktree root.
    let relative = base.appendingPathComponent("relative tree")
    try FileManager.default.createDirectory(at: relative, withIntermediateDirectories: true)
    try Data("gitdir: ../main repo (2)/.git/worktrees/live\n".utf8).write(to: relative.appendingPathComponent(".git"))
    check(primary(OS1SourceConfinement.protectedPaths(root: relative.path, home: fixtureHome)).last == realAdmin,
        "relative gitdir resolves from the tree")
    // A normal checkout (.git directory inside the tree) adds nothing.
    let plainRepo = base.appendingPathComponent("plain")
    try FileManager.default.createDirectory(at: plainRepo.appendingPathComponent(".git"), withIntermediateDirectories: true)
    check(primary(OS1SourceConfinement.protectedPaths(root: plainRepo.path, home: fixtureHome)).count == 1,
        "an in-tree .git dir is covered by the tree")
    check(OS1SourceConfinement.protectedPaths(root: base.appendingPathComponent("missing").path).isEmpty,
        "a missing root protects nothing, so the caller keeps the lease")

    // The release output build-release.sh keeps outside the tree: the link's
    // target, and the cache directory derived from the runtime folder even
    // before (or while rebuilding) the link exists.
    check(OS1SourceConfinement.releaseCacheKey(runtimeRoot: "/Users/LUA/Documents/Codex/OS1-queue-slot-visibility-build224/products/os1-mac-runtime")
        == "26ddf870ec0dbc107d5f", "cache key is build-release.sh's `printf %s | shasum -a 256 | cut -c1-20`")
    let releaseTree = base.appendingPathComponent("release tree")
    let runtime = releaseTree.appendingPathComponent(SelfUpdate.runtimeRelativePath)
    try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: true)
    let cache = fixtureHome.appendingPathComponent("Library/Caches/OS-1/releases")
        .appendingPathComponent(OS1SourceConfinement.releaseCacheKey(runtimeRoot: real(runtime)))
    let elsewhere = base.appendingPathComponent("override output")
    for folder in [cache, elsewhere] { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
    try FileManager.default.createSymbolicLink(at: releaseTree.appendingPathComponent(SelfUpdate.releaseEntryRelativePath),
        withDestinationURL: elsewhere)
    let withRelease = primary(OS1SourceConfinement.protectedPaths(root: releaseTree.path, home: fixtureHome))
    check(withRelease == [real(releaseTree), real(elsewhere), real(cache)],
        "the release link's target and the derived cache directory are protected: \(withRelease)")
    try FileManager.default.removeItem(at: releaseTree.appendingPathComponent(SelfUpdate.releaseEntryRelativePath))
    check(primary(OS1SourceConfinement.protectedPaths(root: releaseTree.path, home: fixtureHome)) == [real(releaseTree), real(cache)],
        "the cache directory is protected while the link is being recreated")
    try FileManager.default.removeItem(at: cache)
    check(primary(OS1SourceConfinement.protectedPaths(root: releaseTree.path, home: fixtureHome)) == [real(releaseTree)],
        "a release directory that does not exist is not handed to the sandbox")

    // Per-attempt state.
    OS1SourceConfinement.activeRoots = protected
    check(OS1SourceConfinement.activeRoots == protected, "the runtime sets this attempt's protected paths")
    OS1SourceConfinement.activeRoots = []
    check(OS1SourceConfinement.activeRoots.isEmpty, "an unconfined attempt clears them")

    // Denials the confinement produced vs real policy denials.
    func denial(_ tool: String, _ input: [String: Any]) -> [String: Any] {
        ["tool_name": tool, "tool_use_id": "toolu_fixture", "tool_input": input]
    }
    check(OS1SourceConfinement.isProtectedWriteDenial(denial("Edit", ["file_path": realLive + "/Sources/a.swift"]), protectedPaths: protected),
        "an Edit inside the live tree is the confinement")
    check(OS1SourceConfinement.isProtectedWriteDenial(denial("Write", ["file_path": live.path + "/new/b.swift"]), protectedPaths: protected),
        "a Write that would create a file is compared in canonical spelling")
    check(!OS1SourceConfinement.isProtectedWriteDenial(denial("Write", ["file_path": base.path + "/elsewhere.txt"]), protectedPaths: protected),
        "a denial outside the protected paths is a real policy denial")
    check(!OS1SourceConfinement.isProtectedWriteDenial(denial("Write", ["file_path": realLive + " copy/x"]), protectedPaths: protected),
        "a sibling folder with the same prefix is not protected")
    check(OS1SourceConfinement.isProtectedWriteDenial(denial("Bash", ["command": "echo x > '\(realLive)/f'"]), protectedPaths: protected),
        "a shell write naming the live tree is the confinement")
    check(!OS1SourceConfinement.isProtectedWriteDenial(denial("Bash", ["command": "echo x > '\(realLive)-copy/f'"]), protectedPaths: protected),
        "a shell command naming only a same-prefix sibling is a real denial")
    check(!OS1SourceConfinement.isProtectedWriteDenial(denial("Bash", ["command": "cp a /mirror\(realLive)/f"]), protectedPaths: protected),
        "a longer path that merely ends with the tree's path is a real denial")
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    check(OS1SourceConfinement.isProtectedWriteDenial(denial("Bash", ["command": "touch $HOME/os1-live/x"]), protectedPaths: [home + "/os1-live"])
        && OS1SourceConfinement.isProtectedWriteDenial(denial("Bash", ["command": "touch ~/os1-live/x"]), protectedPaths: [home + "/os1-live"]),
        "a shell command naming the tree through $HOME or ~ is the confinement")
    check(!OS1SourceConfinement.isProtectedWriteDenial(denial("WebFetch", ["url": realLive]), protectedPaths: protected),
        "other tools stay real denials")
    check(!OS1SourceConfinement.isProtectedWriteDenial(denial("Edit", ["file_path": realLive + "/x"]), protectedPaths: []),
        "an unconfined attempt classifies nothing as confinement")

    // Marker.
    let marker = OS1SourceConfinement.changeRequiredMarker
    check(marker == "[OS1_CHANGE_REQUIRED]", "marker constant")
    let answer = "OS-1의 Sources/OS1App/OS1App.swift를 고쳐야 합니다.\n\n" + marker + "\n"
    check(OS1SourceConfinement.containsMarker(answer), "marker detected")
    check(OS1SourceConfinement.strippingMarker(answer) == "OS-1의 Sources/OS1App/OS1App.swift를 고쳐야 합니다.", "marker line removed")
    check(OS1SourceConfinement.strippingMarker("done " + marker + " now") == "done  now", "an inline marker is removed, text kept")
    check(OS1SourceConfinement.strippingMarker("no marker here\n") == "no marker here\n", "text without the marker is unchanged")
    check(OS1SourceConfinement.strippingMarker("work\n[OS1_CH", partialTail: true) == "work", "a streaming prefix never shows")
    check(OS1SourceConfinement.strippingMarker("a list\n[1]", partialTail: true) == "a list\n[1]", "an ordinary bracket line stays")
    check(OS1SourceConfinement.instructions(protectedPaths: protected).contains(marker) &&
        OS1SourceConfinement.instructions(protectedPaths: protected).contains(realLive) &&
        OS1SourceConfinement.instructions(protectedPaths: protected).contains("OS-1 소스 보호"),
        "backend instruction names the paths and the marker in both languages")
    check(!OS1SourceConfinement.instructions(protectedPaths: protected).contains(dataVolume + "/"),
        "the instruction lists each path once, not its data-volume spelling")
    check(OS1SourceConfinement.instructions(protectedPaths: protected).contains("do every other part"),
        "the backend does the rest of the request, so a repair never replays it")
    check(!OS1SourceConfinement.instructions(protectedPaths: protected, escalates: false).contains(marker),
        "without a repair to continue it (a workflow stage) no marker is asked for")
    // Only the explicit marker hands an OS-1 change back.
    check(OS1SourceConfinement.confinedAnswer(answer, confined: true) == ("OS-1의 Sources/OS1App/OS1App.swift를 고쳐야 합니다.", true),
        "a confined answer with the marker hands back, stripped")
    check(OS1SourceConfinement.confinedAnswer("다 했습니다.", confined: true) == ("다 했습니다.", false),
        "a confined answer without the marker is an ordinary answer")
    check(OS1SourceConfinement.confinedAnswer(answer, confined: false) == (answer, false),
        "an unconfined answer is never read for the marker")

    // A sandbox-blocked non-OS-1 step has a different hand-back signal. An
    // inline quotation is not a request to escalate a session's permissions.
    let fullMarker = OS1SourceConfinement.fullAccessRequiredMarker
    check(fullMarker == "[OS1_FULL_ACCESS_REQUIRED]", "full-access marker constant")
    let blocked = "Plugin files are ready; the sandbox blocked the IDE launch.\n" + fullMarker + "\n"
    check(OS1SourceConfinement.containsFullAccessMarker(blocked), "standalone full-access marker detected")
    check(OS1SourceConfinement.containsFullAccessMarker("blocked\n  " + fullMarker + " \r\n"),
        "whitespace and CRLF surrounding the marker do not change the signal")
    check(!OS1SourceConfinement.containsFullAccessMarker("the marker is " + fullMarker + " in the docs"),
        "an inline quoted marker cannot request full access")
    check(!OS1SourceConfinement.containsFullAccessMarker("[OS1_FULL_ACCESS_REQUIRED_OTHER]"),
        "a similar token cannot request full access")
    let protectedBlocked = OS1SourceConfinement.handBackAnswer(blocked, protected: true)
    check(protectedBlocked.text == "Plugin files are ready; the sandbox blocked the IDE launch."
        && !protectedBlocked.changeRequired && protectedBlocked.fullAccessRequired,
        "a protected answer preserves the blocked step and requests full access, not source repair")
    let unprotectedBlocked = OS1SourceConfinement.handBackAnswer(blocked, protected: false)
    check(unprotectedBlocked.text == blocked && !unprotectedBlocked.changeRequired && !unprotectedBlocked.fullAccessRequired,
        "a backend without source protection cannot manufacture a full-access hand-back")
    let inlineBlocked = OS1SourceConfinement.handBackAnswer("quoted " + fullMarker, protected: true)
    check(!inlineBlocked.fullAccessRequired, "inline text is never a full-access request")
    for markers in [[fullMarker, marker], [marker, fullMarker]] {
        let both = "Already installed the files; app launch and OS-1 repair remain.\n" + markers.joined(separator: "\n") + "\n"
        let handled = OS1SourceConfinement.handBackAnswer(both, protected: true)
        check(handled.text == "Already installed the files; app launch and OS-1 repair remain."
            && handled.fullAccessRequired && handled.changeRequired,
            "both signals survive parsing regardless of their line order")
        check(!OS1SourceConfinement.strippingMarker(both).contains("[OS1_"),
            "neither internal marker reaches the owner")
    }
    check(OS1SourceConfinement.strippingMarker("done " + fullMarker + " now") == "done  now",
        "inline full-access text is hidden without becoming an escalation")
    for token in [marker, fullMarker] {
        for length in 3..<token.count {
            check(OS1SourceConfinement.strippingMarker("work\n" + String(token.prefix(length)), partialTail: true) == "work",
                "every streaming marker prefix is hidden: \(token.prefix(length))")
        }
    }
    check(OS1SourceConfinement.strippingMarker("list\n[OS1_other]", partialTail: true) == "list\n[OS1_other]",
        "unrelated bracket text is not swallowed by full-access partial-tail handling")

    let instructions = OS1SourceConfinement.instructions(protectedPaths: protected)
    check(instructions.contains(fullMarker) && instructions.contains(marker),
        "the confined instruction advertises both hand-back routes")
    check(instructions.contains("sandbox") && instructions.contains("샌드박스")
        && instructions.contains("OS-1") && instructions.contains("소유자"),
        "the blocked non-OS-1 path is explained in English and Korean")
    check(!OS1SourceConfinement.instructions(protectedPaths: protected, escalates: false).contains(fullMarker),
        "a workflow without a continuation cannot ask for full-access hand-back")
    let resumedInstructions = OS1SourceConfinement.fullAccessInstructions(protectedPaths: protected)
    check(resumedInstructions.contains("Continue ONLY the previously sandbox-blocked non-OS-1 steps")
        && resumedInstructions.contains("샌드박스에 막혔던 비-OS-1 단계만"),
        "the resumed session is restricted to the blocked steps in both languages")
    check(resumedInstructions.contains("Do not repeat completed edits, sends, payments, installs, mounts, deployments or pushes")
        && resumedInstructions.contains("반복하지 말고 부분 실행 여부부터 확인"),
        "the continuation must inspect side effects instead of replaying completed work")
    check(resumedInstructions.contains("shared source lease") && resumedInstructions.contains("source-only launch guard")
        && resumedInstructions.contains("Existing owner approval/auth/terms requirements remain binding"),
        "continuation instructions preserve the source lease, source protection and owner approvals")
    check(resumedInstructions.contains(marker) && !resumedInstructions.contains(fullMarker)
        && resumedInstructions.contains("never request another full-access continuation"),
        "a resumed session may hand back source repair but cannot escalate full access again")

    // The full-access launch removes broad Claude sandbox restrictions, but
    // keeps tool-level denial and a source-only OS guard for arbitrary shell
    // subprocesses. It must not silently turn into unprotected source access.
    let fullSettings = OS1SourceConfinement.claudeFullAccessSettings(protectedPaths: protected)
    guard let fullObject = try JSONSerialization.jsonObject(with: Data(fullSettings.utf8)) as? [String: Any],
          let fullSandbox = fullObject["sandbox"] as? [String: Any],
          let fullPermissions = fullObject["permissions"] as? [String: Any],
          let fullDeny = fullPermissions["deny"] as? [String] else { fatalError("full-access settings are not JSON") }
    check(fullSandbox["enabled"] as? Bool == false, "the full-access continuation disables Claude's broad sandbox")
    check(fullSandbox["filesystem"] == nil && fullSandbox["network"] == nil,
        "full-access settings do not pretend disabled sandbox filesystem/network rules are protection")
    check(fullDeny == protected.map(OS1SourceConfinement.editDenyRule),
        "full-access retains every OS-1 tool write denial")
    check(OS1SourceConfinement.attemptGuard(provider: "claude", permissionProfile: "workspace_write",
        sharedLeaseRoot: realLive, fullAccess: true, protectedPaths: { _ in protected }) == .sharedLease,
        "the resumed full-access Claude attempt must hold a shared source lease")
    check(OS1SourceConfinement.attemptGuard(provider: "claude", permissionProfile: "read_only",
        sharedLeaseRoot: realLive, fullAccess: true, protectedPaths: { _ in protected }) == .unguarded,
        "full-access flag never upgrades a read-only ticket")

    let special = base.appendingPathComponent("protected \"quote\" \\ path (2)")
    let plugins = base.appendingPathComponent("outside/.claude/plugins")
    for folder in [special, plugins] { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true) }
    let guardPaths = protected + [real(special)]
    let profile = try OS1SourceConfinement.sourceWriteGuardProfile(protectedPaths: guardPaths)
    check(profile.contains("(allow default)") && profile.contains("(deny file-write*"),
        "source-only OS guard allows other system operations and denies protected writes")
    check(profile.contains("\\\"quote\\\"") && profile.contains("\\\\ path"),
        "SBPL literal quoting preserves quotes and backslashes in real paths")
    do {
        _ = try OS1SourceConfinement.sourceWriteGuardProfile(protectedPaths: [])
        preconditionFailure("Source confinement: a source-only guard cannot launch without protected paths")
    } catch { checks += 1 }
    for unsafePath in ["relative/path", realLive + "\n(invalid)", realLive + "\u{0}suffix"] {
        do {
            _ = try OS1SourceConfinement.sourceWriteGuardProfile(protectedPaths: [unsafePath])
            preconditionFailure("Source confinement: an invalid path cannot alter the source-only guard profile")
        } catch { checks += 1 }
    }

    // Real temporary subprocesses, not a paid model: prove the guard reaches
    // shell writes while plugin-style work outside the source remains usable.
    func guarded(_ script: String, path: String) throws -> (status: Int32, output: String) {
        let process = Process(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/sandbox-exec")
        process.arguments = ["-p", profile, "/bin/sh", "-c", script, "fixture", path]
        process.standardOutput = output
        process.standardError = output
        try process.run()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self))
    }
    let pluginFile = plugins.appendingPathComponent("installed.txt")
    let outsideWrite = try guarded("printf plugin-ready > \"$1\"", path: pluginFile.path)
    let pluginContent = try String(contentsOf: pluginFile, encoding: .utf8)
    check(outsideWrite.status == 0 && pluginContent == "plugin-ready",
        "source-only guard permits non-OS-1 plugin installation writes: \(outsideWrite.output)")
    for folder in [live, admin, special] {
        let existing = folder.appendingPathComponent("guard-existing.txt")
        let created = folder.appendingPathComponent("guard-new.txt")
        try Data("preserved".utf8).write(to: existing)
        let write = try guarded("printf overwritten > \"$1\"", path: existing.path)
        let create = try guarded("printf created > \"$1\"", path: created.path)
        let remove = try guarded("/bin/rm \"$1\"", path: existing.path)
        let preserved = try String(contentsOf: existing, encoding: .utf8)
        check(write.status != 0 && preserved == "preserved",
            "source-only guard denies overwriting protected content: \(folder.lastPathComponent)")
        check(create.status != 0 && !FileManager.default.fileExists(atPath: created.path),
            "source-only guard denies creating protected content: \(folder.lastPathComponent)")
        check(remove.status != 0 && FileManager.default.fileExists(atPath: existing.path),
            "source-only guard denies deleting protected content: \(folder.lastPathComponent)")
    }
    let alias = base.appendingPathComponent("source-alias")
    try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: live)
    let aliasTarget = alias.appendingPathComponent("guard-alias.txt")
    let aliasWrite = try guarded("printf bypass > \"$1\"", path: aliasTarget.path)
    check(aliasWrite.status != 0 && !FileManager.default.fileExists(atPath: aliasTarget.path),
        "source-only guard denies writes through a symlink into the source")
    print("Source confinement fixtures: \(checks) checks; model calls 0")
    try runPendingOS1RepairFixtures()
}
