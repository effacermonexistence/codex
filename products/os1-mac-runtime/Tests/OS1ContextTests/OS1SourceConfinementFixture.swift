import Darwin
import Foundation
import OS1Context

/// A HOME write task confined from OS-1's live source instead of holding its
/// shared lease (build 319): the exact Claude settings, the protected paths of
/// a worktree checkout, the per-attempt state and the escalation marker.
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
    print("Source confinement fixtures: \(checks) checks; model calls 0")
}
