import Foundation

/// The backend's own words for one tool call — Claude Code's "doing X" line.
///
/// Only allowlisted fields the model wrote to describe a call are read: a Bash
/// or Agent `description`, a file path, a search pattern or query, a URL with
/// its credentials, query and fragment removed, a todo's `activeForm`, Codex
/// command actions, a changed file's path, an MCP server/tool name. A raw
/// command is shown only when no description exists (Claude Code does the
/// same) and only after `redact`. Never read here: tool results or outputs,
/// thinking, file contents, Edit/Write strings, Agent/WebFetch prompts, MCP
/// arguments, Codex aggregated output or diffs.
///
/// OS-1 adds no claim of its own: the `verb` is a fixed code tied to the tool's
/// identity ("read" for Read), rendered by the app; it never says "done".
public enum NativeStepLabel {
    public static let maximumCharacters = 160
    public static let maximumBytes = 480

    public enum Verb: String, CaseIterable, Sendable {
        case run, read, edit, write, add, delete, search, find, list, fetch, webSearch, agent, mcp
    }

    public struct Extract: Equatable, Sendable {
        public let verb: String?
        public let label: String?
        public init(verb: Verb?, label: String?) {
            self.verb = label == nil ? nil : verb?.rawValue
            self.label = label
        }
    }

    // MARK: Redaction

    /// Normalise, mask secrets, cap. Runs before anything is written to disk
    /// and again when the app decodes a step. Idempotent: a redacted label
    /// redacts to itself. nil when nothing displayable remains.
    public static func redact(_ raw: String) -> String? {
        // Only the first 160 characters are ever shown; bound the regex work
        // for a multi-megabyte heredoc command.
        let bounded = raw.utf8.count > 16_384 ? String(raw.prefix(4_096)) : raw
        var text = normalize(bounded)
        guard !text.isEmpty else { return nil }
        text = cap(mask(text))
        // A cut can leave a fragment that only now looks like a secret; settle
        // so that decoding a stored label never changes it again.
        for _ in 0..<3 {
            let again = cap(mask(text))
            if again == text { break }
            text = again
        }
        let visible = text.trimmingCharacters(in: CharacterSet(charactersIn: "… ").union(.whitespaces))
        return visible.isEmpty ? nil : text
    }

    private static func mask(_ text: String) -> String {
        maskLongRuns(maskRules.reduce(text) { $1.apply($0) })
    }

    /// Shape check for a decoded label: one line, capped, no control or bidi
    /// override characters.
    public static func isDisplayable(_ label: String) -> Bool {
        !label.isEmpty && label.count <= maximumCharacters && label.utf8.count <= maximumBytes &&
            label.unicodeScalars.allSatisfy { !isHidden($0) } && label == label.trimmingCharacters(in: .whitespaces)
    }

    private static func isHidden(_ scalar: Unicode.Scalar) -> Bool {
        let v = scalar.value
        return v < 0x20 || (0x7F...0x9F).contains(v) || (0x202A...0x202E).contains(v) ||
            (0x2066...0x2069).contains(v) || v == 0x200E || v == 0x200F || v == 0x061C ||
            v == 0x2028 || v == 0x2029
    }

    private static func normalize(_ raw: String) -> String {
        var out = String.UnicodeScalarView()
        var pendingSpace = false
        for scalar in raw.unicodeScalars {
            if isHidden(scalar) || CharacterSet.whitespacesAndNewlines.contains(scalar) {
                // Newlines and tabs become one space; invisible direction
                // overrides are removed so a label cannot reorder its display.
                if CharacterSet.whitespacesAndNewlines.contains(scalar) || scalar.value < 0x20 { pendingSpace = true }
                continue
            }
            if pendingSpace, !out.isEmpty { out.append(" ") }
            pendingSpace = false
            out.append(scalar)
        }
        return String(out)
    }

    private struct MaskRule {
        let regex: NSRegularExpression
        let template: String
        func apply(_ text: String) -> String {
            regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
        }
    }

    private static func rule(_ pattern: String, _ template: String, _ options: NSRegularExpression.Options = []) -> MaskRule {
        // Patterns are compile-time constants; a failure is a programming error.
        MaskRule(regex: try! NSRegularExpression(pattern: pattern, options: options), template: template)
    }

    private static let maskRules: [MaskRule] = [
        // Credentials embedded in a URL authority, then any URL query string.
        rule(#"\b([A-Za-z][A-Za-z0-9+.-]*://)[^/\s@]+@"#, "$1…@"),
        rule(#"\b([A-Za-z][A-Za-z0-9+.-]*://[^\s?#]*)[?#][^\s'"]*"#, "$1?…"),
        // Well-known token shapes.
        rule(#"\bsk-[A-Za-z0-9_-]{16,}"#, "…"),
        rule(#"\bgh[pousr]_[A-Za-z0-9_]{8,}"#, "…"),
        rule(#"\bgithub_pat_[A-Za-z0-9_]{8,}"#, "…"),
        rule(#"\bxox[abposr]-[^\s'"]+"#, "…"),
        rule(#"\bAKIA[0-9A-Z]{16}\b"#, "…"),
        rule(#"\bAIza[0-9A-Za-z_-]{35}"#, "…"),
        rule(#"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"#, "…"),
        rule(#"\b(Bearer)\s+[^\s'"]+"#, "$1 …", [.caseInsensitive]),
        rule(#"\b(Basic)\s+(?=[A-Za-z0-9+/=]*[0-9+/=])[A-Za-z0-9+/=]{8,}"#, "$1 …"),
        // Secret-named flags and key/value pairs keep the name, lose the value.
        rule(#"(--?[A-Za-z0-9_-]*(?:password|passwd|token|secret|api[_-]?key|apikey|auth|credential|cookie)[A-Za-z0-9_-]*)(=|\s+)("[^"]*"|'[^']*'|[^\s'"]+)"#,
             "$1$2…", [.caseInsensitive]),
        rule(#"\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|token|secret|api[_-]?key|apikey|authorization|credential|cookie|private[_-]?key)[A-Za-z0-9_.-]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s'"]+)"#,
             "$1$2…", [.caseInsensitive]),
        // Environment assignments: NAME=value keeps NAME.
        rule(#"\b([A-Z_][A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s'"]+)"#, "$1=…"),
    ]

    private static let hexRun = try! NSRegularExpression(pattern: #"\b[0-9A-Fa-f]{32,}\b"#)
    private static let tokenRun = try! NSRegularExpression(pattern: #"[A-Za-z0-9+/_=.-]{24,}"#)

    /// Long hex, and random-looking token pieces. A path or identifier is
    /// words with few letter/digit/case changes; a generated secret changes
    /// character class at almost every position. Only the `/`-separated piece
    /// that looks random is masked, so the rest of a path stays readable.
    private static func maskLongRuns(_ text: String) -> String {
        let source = hexRun.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "…")
        var masked: [Range<String.Index>] = []
        for match in tokenRun.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
            guard let range = Range(match.range, in: source) else { continue }
            var start = range.lowerBound
            for index in source[range].indices where source[index] == "/" {
                if start < index, looksRandom(source[start..<index]) { masked.append(start..<index) }
                start = source.index(after: index)
            }
            if start < range.upperBound, looksRandom(source[start..<range.upperBound]) { masked.append(start..<range.upperBound) }
        }
        guard !masked.isEmpty else { return source }
        // Rebuild from the unmodified source so no index is used after a mutation.
        var result = ""
        var cursor = source.startIndex
        for range in masked {
            result += source[cursor..<range.lowerBound]
            result += "…"
            cursor = range.upperBound
        }
        result += source[cursor...]
        return result
    }

    static func looksRandom(_ piece: Substring) -> Bool {
        guard piece.count >= 24 else { return false }
        let alnum = piece.filter { $0.isASCII && ($0.isLetter || $0.isNumber) }
        guard alnum.contains(where: \.isNumber), alnum.contains(where: \.isLetter) else { return false }
        // Padded or `+` base64 is a payload, not a name.
        if piece.count >= 32, piece.contains("+") || piece.hasSuffix("=") { return true }
        func kind(_ c: Character) -> Int { c.isNumber ? 0 : c.isUppercase ? 1 : 2 }
        var changes = 0
        var previous: Character?
        for c in alnum {
            if let previous, kind(previous) != kind(c) { changes += 1 }
            previous = c
        }
        return alnum.count >= 24 && Double(changes) / Double(alnum.count - 1) >= 0.4
    }

    private static func cap(_ text: String) -> String {
        guard text.count > maximumCharacters || text.utf8.count > maximumBytes else { return text }
        var out = ""
        var bytes = 0
        for character in text {
            let size = String(character).utf8.count
            if out.count >= maximumCharacters - 1 || bytes + size > maximumBytes - 3 { break }
            out.append(character); bytes += size
        }
        return out.trimmingCharacters(in: .whitespaces) + "…"
    }

    // MARK: Field extraction

    static func string(_ value: Any?) -> String? {
        guard let text = value as? String else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// Workspace-relative, then `~/`-relative. A `file://` URI is reduced to its path.
    public static func displayPath(_ raw: String, workspace: String?,
                                   home: String = FileManager.default.homeDirectoryForCurrentUser.path) -> String {
        var path = raw
        if path.hasPrefix("file://") { path = URL(string: path)?.path ?? String(path.dropFirst(7)) }
        func trimmed(_ root: String) -> String {
            root.count > 1 && root.hasSuffix("/") ? String(root.dropLast()) : root
        }
        if let workspace, !workspace.isEmpty {
            let root = trimmed(workspace)
            if path == root { return "." }
            if root != "/", path.hasPrefix(root + "/") { return String(path.dropFirst(root.count + 1)) }
        }
        let homeRoot = trimmed(home)
        if homeRoot.count > 1, path.hasPrefix(homeRoot + "/") { return "~/" + path.dropFirst(homeRoot.count + 1) }
        return path
    }

    /// Scheme, host, port and path only: userinfo, query and fragment go.
    static func displayURL(_ raw: String) -> String {
        guard var components = URLComponents(string: raw), components.scheme != nil, components.host != nil else { return raw }
        components.user = nil; components.password = nil; components.query = nil; components.fragment = nil
        return components.string ?? raw
    }

    /// The script inside a `zsh -lc '…'` wrapper, as Codex's own UI shows it.
    static func displayCommand(_ value: Any?) -> String? {
        let shells: Set<String> = ["sh", "bash", "zsh", "dash", "fish"]
        if let parts = value as? [String], !parts.isEmpty {
            if parts.count >= 3, shells.contains(URL(fileURLWithPath: parts[0]).lastPathComponent),
               ["-c", "-lc", "-cl"].contains(parts[1]) {
                return string(parts[2...].joined(separator: " "))
            }
            return string(parts.joined(separator: " "))
        }
        guard var text = string(value) else { return nil }
        if let wrapper = text.range(of: #"^(?:\S*/)?(?:ba|z|da|fi)?sh\s+-(?:l?c|cl)\s+"#, options: .regularExpression) {
            text = String(text[wrapper.upperBound...])
            if let first = text.first, first == "'" || first == "\"", text.count >= 2, text.last == first {
                text = String(text.dropFirst().dropLast())
            }
        }
        return string(text)
    }

    private static func make(_ verb: Verb?, _ text: String?) -> Extract? {
        guard let text, let label = redact(text) else { return nil }
        return Extract(verb: verb, label: label)
    }

    private static func joined(_ parts: [String?]) -> String? {
        let present = parts.compactMap { $0 }
        return present.isEmpty ? nil : present.joined(separator: " · ")
    }

    /// The verb a backend-written description takes for a tool (Agent/Task
    /// descriptions are a subagent's; a Bash description stands alone).
    public static func descriptionVerb(tool: String) -> Verb? {
        ["Agent", "Task"].contains(tool) ? .agent : nil
    }

    /// Claude Code tool_use input. `input` may be the partial `{}` of a
    /// content_block_start; that yields nil and the full block labels later.
    public static func claude(tool: String, input: [String: Any]?, workspace: String?) -> Extract? {
        if tool.hasPrefix("mcp__") {
            let body = tool.dropFirst(5)
            guard let split = body.range(of: "__") else { return nil }
            let server = body[..<split.lowerBound], name = body[split.upperBound...]
            guard !server.isEmpty, !name.isEmpty else { return nil }
            return make(.mcp, server + "." + name)
        }
        guard let input else { return nil }
        func path(_ key: String) -> String? { string(input[key]).map { displayPath($0, workspace: workspace) } }
        switch tool {
        case "Bash":
            if let description = string(input["description"]) { return make(nil, description) }
            // Owner decision: without a description, Claude Code shows the
            // command itself; so does OS-1, redacted and capped.
            return make(.run, displayCommand(input["command"]))
        case "Read", "NotebookRead": return make(.read, path("file_path") ?? path("notebook_path"))
        case "Edit", "MultiEdit", "NotebookEdit": return make(.edit, path("file_path") ?? path("notebook_path"))
        case "Write": return make(.write, path("file_path"))
        case "Grep": return make(.search, joined([string(input["pattern"]), path("path")]))
        case "Glob": return make(.find, joined([string(input["pattern"]), path("path")]))
        case "LS": return make(.list, path("path"))
        case "WebSearch", "web_search": return make(.webSearch, string(input["query"]))
        case "WebFetch", "web_fetch": return make(.fetch, string(input["url"]).map(displayURL))
        case "Agent", "Task": return make(.agent, string(input["description"]))
        case "TodoWrite":
            let todos = input["todos"] as? [[String: Any]] ?? []
            let active = todos.first { string($0["status"]) == "in_progress" }
            return make(nil, active.flatMap { string($0["activeForm"]) ?? string($0["content"]) })
        case "TaskCreate", "TaskUpdate":
            return make(nil, string(input["activeForm"]) ?? string(input["subject"]))
        default: return nil
        }
    }

    /// Codex app-server/Desktop ThreadItem of the four tool types. Never reads
    /// `aggregatedOutput`, `arguments`, `result`, diffs or per-action raw commands.
    public static func codex(item: [String: Any], workspace: String?) -> Extract? {
        switch item["type"] as? String {
        case "commandExecution":
            let cwd = string(item["cwd"]).map { $0.hasPrefix("file://") ? (URL(string: $0)?.path ?? $0) : $0 }
            if let actions = commandActionLabel(item["commandActions"] as? [[String: Any]] ?? [],
                                                 workspace: workspace, cwd: cwd) {
                return actions
            }
            return make(.run, displayCommand(item["command"]))
        case "fileChange":
            let changes = item["changes"] as? [[String: Any]] ?? []
            guard let first = changes.first, let raw = string(first["path"]) else { return nil }
            let kind = string((first["kind"] as? [String: Any])?["type"]) ?? string(first["kind"]) ?? string(first["type"])
            let verb: Verb = kind == "add" ? .add : kind == "delete" ? .delete : .edit
            let more = changes.count > 1 ? " (+\(changes.count - 1))" : ""
            return make(verb, displayPath(raw, workspace: workspace) + more)
        case "mcpToolCall":
            guard let server = string(item["server"]), let tool = string(item["tool"]) else { return nil }
            return make(.mcp, server + "." + tool)
        case "webSearch":
            let action = item["action"] as? [String: Any]
            if let query = string(item["query"]) ?? string(action?["query"]) { return make(.webSearch, query) }
            return make(.fetch, string(action?["url"]).map(displayURL))
        default: return nil
        }
    }

    /// Codex's parsed command actions: shown only when every action is a read,
    /// search or listing. Their `command` strings are never read.
    private static func commandActionLabel(_ actions: [[String: Any]], workspace: String?, cwd: String?) -> Extract? {
        guard let first = actions.first else { return nil }
        let types = actions.map { string($0["type"]) ?? "" }
        guard types.allSatisfy({ ["read", "search", "listFiles", "list_files"].contains($0) }) else { return nil }
        func path(_ action: [String: Any]) -> String? {
            guard let raw = string(action["path"]) else { return nil }
            if raw.hasPrefix("/") || raw.hasPrefix("file://") { return displayPath(raw, workspace: workspace) }
            if let cwd, cwd.hasPrefix("/") {
                return displayPath(cwd + "/" + raw, workspace: workspace)
            }
            return raw
        }
        let more = actions.count > 1 ? " (+\(actions.count - 1))" : ""
        let extract: Extract?
        switch types[0] {
        case "read": extract = make(.read, (string(first["name"]) ?? path(first)).map { $0 + more })
        case "search": extract = make(.search, joined([string(first["query"]), path(first)]).map { $0 + more })
        default: extract = make(.list, (path(first) ?? ".") + more)
        }
        return extract
    }
}
