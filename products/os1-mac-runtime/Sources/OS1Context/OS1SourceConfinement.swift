import CryptoKit
import Darwin
import Foundation

/// A write task whose folder contains OS-1's live source tree (HOME) but which
/// is not an OS-1 repair used to hold OS-1's shared source lease for its whole
/// run, so one OS-1 repair plus one long HOME task blocked every other HOME
/// write task, whatever each one actually edited ("야 이거 왜 병렬로 실행이
/// 안 되는데", 2026-10-04). The lease only stood in for "this task might write
/// OS-1"; nothing stopped it from doing so. A Claude backend can instead be
/// confined so it cannot write the live tree at all, which keeps the owner's
/// rule ("동일 소스에 동시에 수정하지 마라") by enforcement instead of by
/// waiting: such a task needs no lease and runs beside an OS-1 repair.
///
/// Verified on Claude Code 2.1.286 (live probes, 2026-10-04): under
/// `--permission-mode bypassPermissions` these settings block the Write/Edit
/// tools, Bash redirections, python writes and `dangerouslyDisableSandbox`
/// retries into the protected paths, while writes elsewhere, network (curl,
/// credentialed `git push --dry-run`, `railway whoami`), `gh` and localhost
/// binding keep working. The four Mach services are what `gh`/Go TLS needs
/// inside the sandbox. No excluded commands: each would be a hole.
public enum OS1SourceConfinement {
    /// The line a confined backend ends its answer with when the request
    /// genuinely needs a change to OS-1 itself. OS-1 then reruns the request
    /// as its own repair; the owner never sees this line.
    public static let changeRequiredMarker = "[OS1_CHANGE_REQUIRED]"
    public static let fullAccessRequiredMarker = "[OS1_FULL_ACCESS_REQUIRED]"

    /// Only the explicit standalone control line requests continuation. Quoted
    /// examples and permission denials alone do not authorize broader access.
    public static func containsFullAccessMarker(_ text: String) -> Bool {
        text.components(separatedBy: .newlines).contains { $0.trimmingCharacters(in: .whitespaces) == fullAccessRequiredMarker }
    }
    public static func handBackAnswer(_ raw: String, protected: Bool) -> (text: String, changeRequired: Bool, fullAccessRequired: Bool) {
        guard protected else { return (raw, false, false) }
        return (strippingMarker(raw), containsMarker(raw), containsFullAccessMarker(raw))
    }
    /// Claude's broad sandbox is OFF only for the bounded resumed attempt.
    /// Tool denies remain; shell source protection is a separate OS-level
    /// source-only launch guard, never a disabled denyWrite setting.
    public static func claudeFullAccessSettings(protectedPaths: [String]) -> String {
        let settings: [String: Any] = ["permissions": ["deny": protectedPaths.map(editDenyRule)],
                                      "sandbox": ["enabled": false]]
        return String(decoding: try! JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys]), as: UTF8.self)
    }
    public enum SourceGuardError: Error { case invalidPaths, unavailable }
    /// Covers the wrapped process and inheriting children, not arbitrary
    /// pre-existing LaunchServices/XPC services. No-workaround instructions
    /// and the source watch remain necessary; never claim global immunity.
    public static func sourceWriteGuardProfile(protectedPaths: [String]) throws -> String {
        guard !protectedPaths.isEmpty, protectedPaths.allSatisfy({ $0.hasPrefix("/") && !$0.contains("\u{0}") && !$0.contains("\n") }) else { throw SourceGuardError.invalidPaths }
        func quoted(_ text: String) -> String { "\"" + text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") + "\"" }
        return "(version 1) (allow default) " + protectedPaths.map { "(deny file-write* (subpath " + quoted($0) + "))" }.joined(separator: " ")
    }
    public static func fullAccessInstructions(protectedPaths: [String]) -> String {
        let list = protectedPaths.filter { !$0.hasPrefix(dataVolume + "/") }.joined(separator: ", ")
        return """

        FULL-ACCESS CONTINUATION: Claude's broad task sandbox is disabled for this same-session continuation. Only OS-1 source/admin/release paths (\(list)) remain write-protected by the source-only launch guard and file-tool deny rules. The shared source lease excludes OS-1 repairs, not unrelated user authorizations. Continue ONLY the previously sandbox-blocked non-OS-1 steps. Do not repeat completed edits, sends, payments, installs, mounts, deployments or pushes. Inspect partial state before retrying; unknown side effects are not permission to replay. Never use another path/process/service to bypass OS-1 source protection. If OS-1 itself needs changing, finish unrelated blocked steps then use [OS1_CHANGE_REQUIRED]; never request another full-access continuation. Existing owner approval/auth/terms requirements remain binding.
        전체 권한 이어가기: 같은 Claude 세션에서 넓은 작업 샌드박스만 해제됐습니다. OS-1 소스·git 관리·릴리스 경로는 좁은 쓰기 가드로 계속 보호되고 공유 리스를 보유합니다. 샌드박스에 막혔던 비-OS-1 단계만 이어서 하세요. 이미 완료된 편집·전송·결제·설치·마운트·배포·푸시는 반복하지 말고 부분 실행 여부부터 확인하세요. 다른 경로·프로세스·서비스로 OS-1 보호를 우회하지 마세요. OS-1 수정이 필요하면 나머지 단계 뒤 [OS1_CHANGE_REQUIRED]로 넘기세요. 로그인·승인·약관 동의는 기존 소유자 권한 범위를 그대로 지키세요.
        """
    }

    /// File-writing tools a Claude `Edit(...)` rule governs. A denial of one of
    /// these on a protected path is the confinement doing its job.
    static let fileWriteTools: Set<String> = ["Edit", "Write", "MultiEdit", "NotebookEdit"]

    static let machLookup = ["com.apple.trustd", "com.apple.trustd.agent", "com.apple.SecurityServer", "com.apple.securityd.xpc"]

    /// The data volume behind macOS's firmlinks: `/Users/x` is also reachable
    /// as `/System/Volumes/Data/Users/x` — the same inode under a second
    /// spelling that realpath(3) keeps. A path rule written for one spelling
    /// does not match the other, so both are protected.
    static let dataVolume = "/System/Volumes/Data"

    /// What a confined task may not write: the live tree itself, plus — when
    /// the live tree is a git worktree (`.git` is a "gitdir: …" file) — that
    /// worktree's own admin directory outside it (its HEAD and index), plus
    /// the tree's release output, which build-release.sh keeps outside it
    /// (`release` links to `~/Library/Caches/OS-1/releases/<key>`): a repair's
    /// build, staged app and self-update intent live there, and a HOME task
    /// that deleted or rewrote them would break or silently drop the repair's
    /// install. Each of those also under its data-volume spelling. Never the
    /// common git directory: other worktrees of the same repository,
    /// including the task's own checkouts, share it. Empty when the root does
    /// not exist, so the caller falls back to the lease rather than launching
    /// a backend with nothing protected.
    public static func protectedPaths(root: String,
                                      home: URL = FileManager.default.homeDirectoryForCurrentUser) -> [String] {
        guard let canonicalRoot = realPath(root) else { return [] }
        var paths = [canonicalRoot]
        func add(_ path: String?) {
            guard let path, !paths.contains(where: { contains($0, path) }) else { return }
            paths.append(path)
        }
        let dotGit = URL(fileURLWithPath: canonicalRoot).appendingPathComponent(".git")
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath: dotGit.path, isDirectory: &isDirectory), !isDirectory.boolValue,
           let text = try? String(contentsOf: dotGit, encoding: .utf8),
           let line = text.split(whereSeparator: \.isNewline).first(where: { $0.hasPrefix("gitdir:") }) {
            let value = line.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespaces)
            if !value.isEmpty {
                // git writes a relative gitdir relative to the worktree root.
                let absolute = value.hasPrefix("/") ? value
                    : URL(fileURLWithPath: canonicalRoot).appendingPathComponent(value).standardizedFileURL.path
                add(realPath(absolute))
            }
        }
        // The link's current target, and the cache directory build-release.sh
        // derives from the runtime folder (`pwd -P | shasum -a 256 | cut
        // -c1-20`), which it deletes and recreates on every build. Only an
        // existing directory: a sandbox rule is given real paths.
        let runtime = URL(fileURLWithPath: canonicalRoot).appendingPathComponent(SelfUpdate.runtimeRelativePath).path
        add(realPath(URL(fileURLWithPath: canonicalRoot).appendingPathComponent(SelfUpdate.releaseEntryRelativePath).path))
        if let realRuntime = realPath(runtime) {
            add(realPath(home.appendingPathComponent("Library/Caches/OS-1/releases")
                .appendingPathComponent(releaseCacheKey(runtimeRoot: realRuntime)).path))
        }
        for path in paths where !path.hasPrefix(dataVolume + "/") {
            let alias = dataVolume + path
            if sameFile(alias, path) { add(alias) }
        }
        return paths
    }

    /// build-release.sh's `source_key` for a runtime folder.
    public static func releaseCacheKey(runtimeRoot: String) -> String {
        String(SHA256.hash(data: Data(runtimeRoot.utf8)).map { String(format: "%02x", $0) }.joined().prefix(20))
    }

    /// `--settings` JSON for a confined Claude workspace-write run: one
    /// `Edit` deny rule per protected path (the rule also governs Write,
    /// MultiEdit and NotebookEdit) and a strict sandbox that denies Bash
    /// writes there and refuses to run unsandboxed.
    public static func claudeSettings(protectedPaths: [String]) -> String {
        let settings: [String: Any] = [
            "permissions": ["deny": protectedPaths.map(editDenyRule)],
            "sandbox": [
                "enabled": true,
                "failIfUnavailable": true,
                "allowUnsandboxedCommands": false,
                "filesystem": ["denyWrite": protectedPaths],
                "network": [
                    "allowedDomains": ["*"],
                    "allowLocalBinding": true,
                    "allowMachLookup": machLookup,
                ],
            ],
        ]
        let data = (try? JSONSerialization.data(withJSONObject: settings, options: [.sortedKeys, .withoutEscapingSlashes]))
            ?? Data("{}".utf8)
        return String(decoding: data, as: UTF8.self)
    }

    /// Claude's own spelling of a directory rule for an absolute path, as it
    /// writes one itself ("always allow edits in …"): `//` marks an absolute
    /// path; the path is escaped as a pattern (so `[`, `(`, `*` … in a folder
    /// name are literal) and the rule content is escaped once more for the
    /// `Tool(content)` syntax. The live tree's git admin directory lives under
    /// "Documents - MacBook Air (2)", so the parentheses are real.
    public static func editDenyRule(path: String) -> String {
        "Edit(" + escapedRuleContent("/" + escapedPattern(path) + "/**") + ")"
    }

    /// Appended to the confined backend's system prompt, both languages.
    /// `escalates`: OS-1 will continue a handed-back OS-1 change as its own
    /// repair (an owner request; a workflow stage cannot). The backend does
    /// the rest of the request itself, so that repair only has the OS-1 part
    /// left and never replays a deploy, push or edit the first run made.
    public static func instructions(protectedPaths: [String], escalates: Bool = true) -> String {
        let list = protectedPaths.filter { !$0.hasPrefix(dataVolume + "/") }.joined(separator: ", ")
        let english = escalates
            ? "If the request also needs a change to OS-1 itself, do every other part of it as usual but not the OS-1 part: report what you did, say briefly what must change in OS-1, then end the answer with the marker line shown below, on its own, and stop. OS-1 then makes only that OS-1 change as its own repair, so do not ask the owner to do it."
            : "If the request also needs a change to OS-1 itself, do every other part of it as usual but not the OS-1 part, and say briefly what must change in OS-1 so the owner can ask for it as an OS-1 repair."
        let korean = escalates
            ? "요청에 OS-1 자체 수정도 필요하면, OS-1 부분만 빼고 나머지는 평소대로 하세요. 한 일을 보고하고 OS-1에서 무엇을 바꿔야 하는지 짧게 말한 뒤, 마지막 줄에 아래 표식 한 줄을 그대로 적고 멈추세요. 그러면 OS-1이 그 OS-1 변경만 OS-1 수리로 이어서 진행하므로, 소유자에게 대신 하라고 하지 마세요."
            : "요청에 OS-1 자체 수정도 필요하면, OS-1 부분만 빼고 나머지는 평소대로 하고, 소유자가 OS-1 수리로 요청할 수 있게 OS-1에서 무엇을 바꿔야 하는지 짧게 말하세요."
        return """

        OS-1 SOURCE PROTECTION: OS-1's own source and release output at \(list) are protected in this task; writes there are blocked. Work everywhere else as usual. Do not try to work around this protection (no other tool, copy, link, alternate path or git command that would change it). \(english)
        OS-1 소스 보호: 이 작업에서는 OS-1 자체 소스와 릴리스 출력(\(list))이 보호되어 쓸 수 없습니다. 다른 폴더에서는 평소대로 작업하세요. 이 보호를 우회하려 하지 마세요(다른 도구, 복사, 링크, 다른 경로, 이를 바꾸는 git 명령 모두 금지). \(korean)
        \(escalates ? "If a normal NON-OS-1 step is blocked by this broad sandbox (for example plugin/settings installation, DMG mount, app/IDE launch or a CLI), report completed steps and the exact blocked operation, end with [OS1_FULL_ACCESS_REQUIRED] on its own line, then stop. OS-1 resumes this same Claude session under a shared source lease without the broad sandbox, continuing only blocked steps. This marker does not authorize OS-1 edits, a policy-denied action or bypassing owner approval. If both hand-backs are needed, emit both marker lines.\n정상적인 비-OS-1 단계가 이 샌드박스 때문에 막히면 완료한 단계와 정확한 차단 작업을 보고하고 [OS1_FULL_ACCESS_REQUIRED] 한 줄을 적고 멈추세요. OS-1이 공유 소스 리스 아래 같은 세션에서 막힌 단계만 이어갑니다. OS-1 편집·실제 정책 거부 우회·소유자 승인 대체는 허용되지 않습니다. 두 이어가기가 모두 필요하면 두 표식을 각각 적으세요.\n" : "")
        \(escalates ? changeRequiredMarker + "\n" : "")
        """
    }

    // MARK: Per-attempt state

    /// How one backend attempt keeps off OS-1's live source.
    public enum AttemptGuard: Equatable, Sendable {
        /// Nothing to guard: read-only, or the task's folder does not contain
        /// the live tree, or the caller already holds the source lease.
        case unguarded
        /// The backend cannot write these paths; no lease is taken.
        case confined([String])
        /// No reliable confinement (Codex has no subtree exclusion yet, or the
        /// tree could not be resolved): hold the shared lease as before.
        case sharedLease
    }

    /// The decision for one attempt of a task whose folder contains the live
    /// tree at `sharedLeaseRoot`. Only a Claude workspace-write attempt is
    /// confined, and only when its protected paths resolve; anything unsure
    /// keeps the lease.
    public static func attemptGuard(provider: String, permissionProfile: String, sharedLeaseRoot: String?, fullAccess: Bool = false,
                                    protectedPaths: (String) -> [String] = { protectedPaths(root: $0) }) -> AttemptGuard {
        guard permissionProfile == "workspace_write", let root = sharedLeaseRoot else { return .unguarded }
        if provider == "claude" && !fullAccess {
            let paths = protectedPaths(root)
            if !paths.isEmpty { return .confined(paths) }
        }
        return .sharedLease
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var roots: [String] = []

    /// Paths the current attempt's backend may not write. Set per attempt by
    /// the runtime (empty for an unconfined attempt), read when the Claude
    /// backend is launched; attempts in one process run one at a time.
    public static var activeRoots: [String] {
        get { lock.withLock { roots } }
        set { lock.withLock { roots = newValue } }
    }

    // MARK: Marker

    public static func containsMarker(_ text: String) -> Bool { text.contains(changeRequiredMarker) }

    /// A confined backend's final answer as the owner sees it, and whether it
    /// handed the request back as a change to OS-1 itself. Only the explicit
    /// marker hands back: a write into OS-1's source that the confinement
    /// denied is the protection working, not proof that the request needs an
    /// OS-1 change, and rerunning a whole request on that alone could replay
    /// the work the first run already did.
    public static func confinedAnswer(_ raw: String, confined: Bool) -> (text: String, changeRequired: Bool) {
        guard confined else { return (raw, false) }
        return (strippingMarker(raw), containsMarker(raw))
    }

    /// The answer without the marker. `partialTail` also drops a trailing,
    /// still-streaming prefix of it ("…\n[OS1_CH") so live progress never
    /// flashes it either.
    public static func strippingMarker(_ text: String, partialTail: Bool = false) -> String {
        guard containsMarker(text) || text.contains(fullAccessRequiredMarker) || partialTail else { return text }
        var lines = text.components(separatedBy: "\n").compactMap { line -> String? in
            guard line.contains(changeRequiredMarker) || line.contains(fullAccessRequiredMarker) else { return line }
            let rest = line.replacingOccurrences(of: changeRequiredMarker, with: "").replacingOccurrences(of: fullAccessRequiredMarker, with: "")
            return rest.trimmingCharacters(in: .whitespaces).isEmpty ? nil : rest
        }
        if partialTail, let last = lines.last {
            let tail = last.trimmingCharacters(in: .whitespaces)
            if tail.count >= 3, changeRequiredMarker.hasPrefix(tail) || fullAccessRequiredMarker.hasPrefix(tail) { lines.removeLast() }
        }
        let joined = lines.joined(separator: "\n")
        guard containsMarker(text) || text.contains(fullAccessRequiredMarker) || joined != text else { return text }
        return String(joined.reversed().drop(while: { $0.isWhitespace }).reversed())
    }

    /// A Claude `permission_denials` entry produced by the confinement: a file
    /// write tool on a protected path, or a shell command naming one. Anything
    /// else stays a real policy denial.
    public static func isProtectedWriteDenial(_ denial: [String: Any], protectedPaths: [String]) -> Bool {
        guard !protectedPaths.isEmpty, let tool = denial["tool_name"] as? String,
              let input = denial["tool_input"] as? [String: Any] else { return false }
        if fileWriteTools.contains(tool) {
            guard let path = (input["file_path"] ?? input["notebook_path"]) as? String, path.hasPrefix("/") else { return false }
            let target = canonicalTarget(path)
            return protectedPaths.contains { contains($0, target) }
        }
        if tool == "Bash", let command = input["command"] as? String {
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            let expanded = command.replacingOccurrences(of: "${HOME}", with: home)
                .replacingOccurrences(of: "$HOME", with: home)
                .replacingOccurrences(of: " ~/", with: " " + home + "/")
            return protectedPaths.contains { namesPath(expanded, $0) }
        }
        return false
    }

    /// The command names `path` itself or something inside it — not a sibling
    /// that merely starts with the same characters (`…build224-copy`) and not
    /// a longer path that ends with it.
    static func namesPath(_ command: String, _ path: String) -> Bool {
        let continuing = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-~/"))
        var searchRange = command.startIndex..<command.endIndex
        while let found = command.range(of: path, range: searchRange) {
            let before = found.lowerBound == command.startIndex ? nil : command[command.index(before: found.lowerBound)]
            let after = found.upperBound == command.endIndex ? nil : command[found.upperBound]
            let startsHere = before.map { !$0.unicodeScalars.allSatisfy(continuing.contains) } ?? true
            let endsHere = after.map { $0 == "/" || !$0.unicodeScalars.allSatisfy(continuing.contains) } ?? true
            if startsHere && endsHere { return true }
            searchRange = found.upperBound..<command.endIndex
        }
        return false
    }

    // MARK: Helpers

    static func contains(_ root: String, _ path: String) -> Bool {
        path == root || path.hasPrefix(root == "/" ? "/" : root + "/")
    }

    /// Two existing spellings of one file (device and inode).
    static func sameFile(_ a: String, _ b: String) -> Bool {
        var first = stat(), second = stat()
        guard stat(a, &first) == 0, stat(b, &second) == 0 else { return false }
        return first.st_dev == second.st_dev && first.st_ino == second.st_ino
    }

    static func realPath(_ path: String) -> String? {
        guard let resolved = Darwin.realpath(path, nil) else { return nil }
        defer { free(resolved) }
        return String(cString: resolved)
    }

    /// realpath(3) of the deepest existing ancestor plus the rest, so a file
    /// a tool was about to create is compared in the same spelling as the
    /// protected roots (/var → /private/var, symlinked folders).
    static func canonicalTarget(_ path: String) -> String {
        var url = URL(fileURLWithPath: path).standardizedFileURL
        var rest: [String] = []
        while url.path != "/" {
            if let real = realPath(url.path) {
                return rest.reversed().reduce(real) { ($0 == "/" ? "" : $0) + "/" + $1 }
            }
            rest.append(url.lastPathComponent)
            url.deleteLastPathComponent()
        }
        return "/" + rest.reversed().joined(separator: "/")
    }

    /// Claude's pattern escape for a literal path (its `escapeGlobs` form).
    static func escapedPattern(_ path: String) -> String {
        var out = ""
        for character in path {
            switch character {
            case "\\": out += "\\\\"
            case "[", "]", "(", ")", "|", "+", "^", "$", "*": out += "\\" + String(character)
            default: out.append(character)
            }
        }
        // Trailing whitespace is significant only when escaped.
        var trailing = ""
        while let last = out.last, last.isWhitespace {
            trailing = "\\" + String(last) + trailing
            out.removeLast()
        }
        return out + trailing
    }

    /// The `Tool(content)` layer: backslashes and parentheses are escaped.
    static func escapedRuleContent(_ content: String) -> String {
        content.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "(", with: "\\(")
            .replacingOccurrences(of: ")", with: "\\)")
    }
}
