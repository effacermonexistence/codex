import Foundation

/// OS-1 already hands every backend the owner-policy projection, with a
/// pointer to the full original for rules it does not cover. The backends'
/// own defaults ALSO load the whole owner engine on every turn:
/// `~/.claude/CLAUDE.md` (910 KB) and Codex's `model_instructions_file`
/// (860 KB). In the 2026-09-30 blind evaluation of ten owner requests on
/// gpt-6-astra at ultra, that full load cost 13.7 M input tokens against 1.8 M
/// with the projection alone, and the judges scored the answers level
/// (~/.os1/recovery/pareto-eval-20260930). OS-1 runs therefore replace the
/// whole-engine default with the projection. `OS1_FULL_BACKEND_INSTRUCTIONS=1`
/// restores the backends' own defaults.
public enum LeanBackendInstructions {
    public static let killSwitch = "OS1_FULL_BACKEND_INSTRUCTIONS"
    /// Claude Code's switch that skips every CLAUDE.md (user and project).
    public static let claudeDisableVariable = "CLAUDE_CODE_DISABLE_CLAUDE_MDS"
    /// The owner's CLAUDE.md is an operating header followed by the engine.
    public static let engineMarker = "\n# OMAR / LUA / RCC ENGINE"
    public static let maximumContextBytes = 24_000

    public static func enabled(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
        environment[killSwitch] != "1"
    }

    /// Codex's lean payload is measured (above). Claude's is built the same
    /// way but stays off until a blind Claude comparison has passed; the Claude
    /// CLI was signed out on 2026-09-30, so it could not be measured yet.
    /// `OS1_LEAN_CLAUDE=1` turns it on for that measurement.
    public static let claudeLeanVerified = false

    public static func claudeEnabled(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
        enabled(environment) && (claudeLeanVerified || environment["OS1_LEAN_CLAUDE"] == "1")
    }

    public static var defaultRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/backend-instructions", isDirectory: true)
    }

    /// Content-addressed base-instructions file for Codex holding `text`.
    public static func codexInstructionsFile(_ text: String, root: URL = defaultRoot) throws -> URL {
        let data = Data(text.utf8)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let file = root.appendingPathComponent("codex-" + OwnerPolicySnapshot.digest(data).prefix(16) + ".md")
        if (try? Data(contentsOf: file)) != data { try data.write(to: file, options: .atomic) }
        return file
    }

    /// `-c` override that points Codex's base instructions at `file`.
    public static func codexOverride(file: URL) -> String {
        var quoted = "\""
        for scalar in file.path.unicodeScalars {
            switch scalar {
            case "\\": quoted += "\\\\"
            case "\"": quoted += "\\\""
            default: quoted.unicodeScalars.append(scalar)
            }
        }
        return "model_instructions_file=" + quoted + "\""
    }

    /// With CLAUDE.md skipped, Claude still needs the operating rules the owner
    /// keeps above the engine (GitHub/R2, completion contract) and the
    /// workspace's own CLAUDE.md. Both are bounded; the engine never is sent.
    public static func claudeWorkspaceContext(home: URL, workspace: String) -> String {
        var blocks: [String] = []
        if let header = operatingHeader(of: home.appendingPathComponent(".claude/CLAUDE.md")) {
            blocks.append("User instructions (operating rules; the reasoning engine is summarized in the owner policy above):\n" + header)
        }
        let project = URL(fileURLWithPath: workspace, isDirectory: true).appendingPathComponent("CLAUDE.md")
        if let text = operatingHeader(of: project), !blocks.contains(where: { $0.hasSuffix(text) }) {
            blocks.append("Workspace CLAUDE.md:\n" + text)
        }
        return blocks.isEmpty ? "" : "\n\n" + blocks.joined(separator: "\n\n")
    }

    /// The file's text before the engine marker, trimmed and size-bounded: a
    /// longer file keeps its first lines and says where the rest is.
    public static func operatingHeader(of file: URL) -> String? {
        guard let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
              values.isRegularFile == true, (values.fileSize ?? 0) <= 4_000_000,
              let data = try? Data(contentsOf: file) else { return nil }
        let text = String(decoding: data, as: UTF8.self)
        let head = text.range(of: engineMarker).map { String(text[..<$0.lowerBound]) } ?? text
        let trimmed = head.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        guard trimmed.utf8.count > maximumContextBytes else { return trimmed }
        var kept = "", size = 0
        for line in trimmed.split(separator: "\n", omittingEmptySubsequences: false) {
            size += line.utf8.count + 1
            if size > maximumContextBytes { break }
            kept += line + "\n"
        }
        return kept + "[truncated — read \(file.path) for the rest when it matters to the task]"
    }
}
