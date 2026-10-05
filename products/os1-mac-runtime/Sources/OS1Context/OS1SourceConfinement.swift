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

    /// File-writing tools a Claude `Edit(...)` rule governs. A denial of one of
    /// these on a protected path is the confinement doing its job.
    static let fileWriteTools: Set<String> = ["Edit", "Write", "MultiEdit", "NotebookEdit"]

    static let machLookup = ["com.apple.trustd", "com.apple.trustd.agent", "com.apple.SecurityServer", "com.apple.securityd.xpc"]

    /// What a confined task may not write: the live tree itself, plus — when
    /// the live tree is a git worktree (`.git` is a "gitdir: …" file) — that
    /// worktree's own admin directory outside it (its HEAD and index). Never
    /// the common git directory: other worktrees of the same repository,
    /// including the task's own checkouts, share it. Empty when the root does
    /// not exist, so the caller falls back to the lease rather than launching
    /// a backend with nothing protected.
    public static func protectedPaths(root: String) -> [String] {
        guard let canonicalRoot = realPath(root) else { return [] }
        var paths = [canonicalRoot]
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
                if let admin = realPath(absolute), !contains(canonicalRoot, admin) { paths.append(admin) }
            }
        }
        return paths
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
    public static func instructions(protectedPaths: [String]) -> String {
        let list = protectedPaths.joined(separator: ", ")
        return """

        OS-1 SOURCE PROTECTION: OS-1's own source at \(list) is protected in this task; writes there are blocked. Work everywhere else as usual. Do not try to work around this protection (no other tool, copy, link, alternate path or git command that would change it). If the request genuinely needs a change to OS-1 itself, do not attempt it: say briefly what must change in OS-1, end the answer with this exact line on its own, and stop:
        \(changeRequiredMarker)
        OS-1 소스 보호: 이 작업에서는 OS-1 자체 소스(\(list))가 보호되어 쓸 수 없습니다. 다른 폴더에서는 평소대로 작업하세요. 이 보호를 우회하려 하지 마세요(다른 도구, 복사, 링크, 다른 경로, 이를 바꾸는 git 명령 모두 금지). 요청이 정말 OS-1 자체를 바꿔야 하는 경우에는 시도하지 말고, OS-1에서 무엇을 바꿔야 하는지 짧게 말한 뒤 마지막 줄에 위 표식 한 줄을 그대로 적고 멈추세요. 그러면 OS-1이 그 요청을 OS-1 수리로 이어서 진행합니다.

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
    public static func attemptGuard(provider: String, permissionProfile: String, sharedLeaseRoot: String?,
                                    protectedPaths: (String) -> [String] = { protectedPaths(root: $0) }) -> AttemptGuard {
        guard permissionProfile == "workspace_write", let root = sharedLeaseRoot else { return .unguarded }
        if provider == "claude" {
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

    /// The answer without the marker. `partialTail` also drops a trailing,
    /// still-streaming prefix of it ("…\n[OS1_CH") so live progress never
    /// flashes it either.
    public static func strippingMarker(_ text: String, partialTail: Bool = false) -> String {
        guard containsMarker(text) || partialTail else { return text }
        var lines = text.components(separatedBy: "\n").compactMap { line -> String? in
            guard line.contains(changeRequiredMarker) else { return line }
            let rest = line.replacingOccurrences(of: changeRequiredMarker, with: "")
            return rest.trimmingCharacters(in: .whitespaces).isEmpty ? nil : rest
        }
        if partialTail, let last = lines.last {
            let tail = last.trimmingCharacters(in: .whitespaces)
            if tail.count >= 3, changeRequiredMarker.hasPrefix(tail) { lines.removeLast() }
        }
        let joined = lines.joined(separator: "\n")
        guard containsMarker(text) || joined != text else { return text }
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
            return protectedPaths.contains { command.contains($0) }
        }
        return false
    }

    // MARK: Helpers

    static func contains(_ root: String, _ path: String) -> Bool {
        path == root || path.hasPrefix(root == "/" ? "/" : root + "/")
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
