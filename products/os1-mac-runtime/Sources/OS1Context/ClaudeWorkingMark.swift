import Foundation

/// Claude's working mark, the clay shape beside the elapsed seconds of a
/// running turn (claude.ai bundle, `TurnStatusClayMark` → `WorkingMark`; read
/// from the Claude desktop app's cache 2026-10-06). Build 332 drew only the
/// default loop, in pink; the owner saw it was not the same ("비슷하지만 똑같진
/// 않잖아 … 애니메이션이 다르잖아"). The real mark is a small stage machine over
/// sprite sheets: it grows out of a dot, then plays an enter → loop → exit body
/// chosen by what the turn is doing (thinking, reading, searching, running
/// code, writing), and switches body only at a loop's end or a seam.
///
/// Every frame below is measured geometry, not the sprite itself: each 48-unit
/// frame is the union of the ellipses fitted to its alpha (worst fit 0.39 alpha
/// at an edge pixel), shown at 20 points, 30 frames a second, held, never
/// blended. Claude's quill (a compose variant behind a flag) and blocked
/// sheets are not drawn: a compose turn plays write, as Claude does without
/// the flag, and OS-1 shows no blocked state on the mark.
public enum ClaudeWorkingMark {
    /// Claude's clay, `#D97757`.
    public static let clay: UInt32 = 0xD97757
    public static let frameDuration: TimeInterval = 1.0 / 30
    /// Side of one source frame, and the points it is drawn at.
    public static let sourceUnit = 48.0
    public static let box = 20.0
    /// Claude shows a still dot this wide (0.35 of the box) before the first
    /// frame; grow's first frame is that dot.
    public static let dotDiameter = 0.35 * box
    /// A mark drawn again within this long continues where it was instead of
    /// growing from the dot again.
    public static let resumeWindow: TimeInterval = 0.5

    public enum Body: String, CaseIterable, Sendable {
        case `default`, think, read, search, code, write
    }

    public enum Stage: Hashable, Sendable {
        case grow
        case enter(Body)
        case loop(Body)
        case exit(Body)

        public var sheetName: String {
            switch self {
            case .grow: return "grow"
            case .enter(let body): return body.rawValue + ".in"
            case .loop(let body): return body.rawValue + ".loop"
            case .exit(let body): return body.rawValue + ".out"
            }
        }
    }

    public struct Ellipse: Equatable, Sendable {
        /// Center and radii in source units, y down.
        public let x, y, rx, ry: Double
    }

    public struct Sheet: Sendable {
        public let frames: [[Ellipse]]
        /// The loop's still frame (Reduce Motion).
        public let rest: Int?
        /// Loop frames where an unwanted body may leave before the loop ends.
        public let seams: [Int]
        public var count: Int { frames.count }
        public var duration: TimeInterval { Double(frames.count) * ClaudeWorkingMark.frameDuration }
    }

    public struct Frame: Equatable, Sendable {
        public let stage: Stage
        public let index: Int
        public var ellipses: [Ellipse] { ClaudeWorkingMark.sheet(stage).frames[index] }

        /// A frame of the stage's sheet; an index past either end is its end.
        public init(stage: Stage, index: Int) {
            self.stage = stage
            self.index = min(max(0, index), ClaudeWorkingMark.sheet(stage).count - 1)
        }
    }

    /// Loop rest frames and seams, from the source's sheet table.
    static let loopTiming: [Body: (rest: Int, seams: [Int])] = [
        .default: (38, []), .think: (95, [54]), .read: (44, []),
        .search: (4, []), .code: (74, [18, 37, 56]), .write: (36, []),
    ]

    static let sheets: [String: Sheet] = {
        var sheets: [String: Sheet] = [:]
        for (name, text) in measuredFrames {
            let frames = text.split(separator: "\n").map { line -> [Ellipse] in
                let values = line.split(separator: " ").compactMap { Double($0) }
                return stride(from: 0, to: values.count - 3, by: 4).map {
                    Ellipse(x: values[$0], y: values[$0 + 1], rx: values[$0 + 2], ry: values[$0 + 3])
                }
            }
            let timing = name.hasSuffix(".loop") ? Body(rawValue: String(name.dropLast(5))).flatMap { loopTiming[$0] } : nil
            sheets[name] = Sheet(frames: frames, rest: timing?.rest, seams: timing?.seams ?? [])
        }
        return sheets
    }()

    public static func sheet(_ stage: Stage) -> Sheet { sheets[stage.sheetName]! }

    /// Reduce Motion: the wanted body's loop, held at its rest frame.
    public static func still(_ body: Body) -> Frame {
        let sheet = sheet(.loop(body))
        return Frame(stage: .loop(body), index: sheet.rest ?? sheet.count / 3)
    }

    /// The stage after one finishes (`Bj`): grow and exit enter the wanted
    /// body; enter always plays its loop; a loop repeats while wanted.
    static func next(after stage: Stage, wanted: Body) -> Stage {
        switch stage {
        case .grow, .exit: return .enter(wanted)
        case .enter(let body): return .loop(body)
        case .loop(let body): return body == wanted ? stage : .exit(body)
        }
    }

    /// One mark's playhead (`Vj`). Times are seconds on the caller's clock;
    /// a clock that runs backwards holds the frame.
    public struct Player: Equatable, Sendable {
        public private(set) var stage: Stage = .grow
        /// When frame 0 of the current stage was shown.
        private var since: TimeInterval
        private var clock: TimeInterval
        private var wanted: Body
        /// When an unwanted loop leaves at its next seam.
        private var seamExit: TimeInterval?

        public init(at time: TimeInterval, wanted: Body) {
            // On the 30 fps grid, so held frames change exactly at redraws.
            since = (time / ClaudeWorkingMark.frameDuration + 1e-3).rounded(.down) * ClaudeWorkingMark.frameDuration
            clock = time
            self.wanted = wanted
        }

        public mutating func frame(at time: TimeInterval, wanted body: Body) -> Frame {
            advance(to: max(clock, time))
            if body != wanted {
                wanted = body
                watchSeams(at: clock)
            }
            let sheet = ClaudeWorkingMark.sheet(stage)
            return Frame(stage: stage, index: min(sheet.count - 1, max(0, Int(position(at: clock).rounded(.down)))))
        }

        /// Frames into the current stage, with slack so a redraw exactly on
        /// a frame boundary is never read as the frame before it.
        private func position(at time: TimeInterval) -> Double {
            (time - since) / ClaudeWorkingMark.frameDuration + 1e-3
        }

        private mutating func advance(to time: TimeInterval) {
            clock = time
            while true {
                if let exit = seamExit, position(at: time) >= (exit - since) / ClaudeWorkingMark.frameDuration {
                    seamExit = nil
                    if case .loop(let body) = stage, body != wanted { begin(.exit(body), at: exit); continue }
                }
                let sheet = ClaudeWorkingMark.sheet(stage)
                let position = position(at: time)
                guard position >= Double(sheet.count) else { return }
                let next = ClaudeWorkingMark.next(after: stage, wanted: wanted)
                if next == stage {
                    // A loop restarts in place; its seams are not watched again.
                    since += (position / Double(sheet.count)).rounded(.down) * sheet.duration
                } else {
                    begin(next, at: since + sheet.duration)
                }
            }
        }

        private mutating func begin(_ next: Stage, at start: TimeInterval) {
            stage = next
            since = start
            watchSeams(at: start)
        }

        /// An unwanted think or code loop leaves at the first seam more than
        /// 50 ms ahead; other loops, and a loop past its last seam, finish.
        private mutating func watchSeams(at time: TimeInterval) {
            seamExit = nil
            guard case .loop(let body) = stage, body != wanted, body != .default else { return }
            let elapsed = time - since
            if let seam = ClaudeWorkingMark.sheet(stage).seams.first(where: {
                Double($0) * ClaudeWorkingMark.frameDuration > elapsed + 0.05
            }) {
                seamExit = since + Double(seam) * ClaudeWorkingMark.frameDuration
            }
        }
    }

    /// One playhead per running conversation, shared by every place that
    /// draws its mark, so the task list and the live row show the same frame.
    /// A mark grows from the dot when it first appears and continues when it
    /// is drawn again within `resumeWindow` of disappearing. Not drawing (an
    /// occluded window) does not restart it; disappearing does.
    public struct Players<Key: Hashable & Sendable>: Sendable {
        private struct Entry: Sendable {
            var player: Player?
            var mounts = 0
            var leftAt: TimeInterval?
        }
        private var entries: [Key: Entry] = [:]

        public init() {}

        public mutating func mount(_ key: Key, at time: TimeInterval) {
            var entry = entries[key] ?? Entry()
            if entry.mounts == 0, let leftAt = entry.leftAt, time - leftAt > resumeWindow { entry.player = nil }
            entry.mounts += 1
            entry.leftAt = nil
            entries[key] = entry
        }

        public mutating func unmount(_ key: Key, at time: TimeInterval) {
            guard var entry = entries[key], entry.mounts > 0 else { return }
            entry.mounts -= 1
            if entry.mounts == 0 { entry.leftAt = time }
            entries[key] = entry
        }

        public mutating func frame(_ key: Key, at time: TimeInterval, wanted: Body) -> Frame {
            entries = entries.filter { $0.key == key || $0.value.mounts > 0 || time - ($0.value.leftAt ?? time) <= resumeWindow }
            var entry = entries[key] ?? Entry()
            if entry.mounts == 0 {
                // Drawn before (or without) appearing: stay only while drawn.
                if let leftAt = entry.leftAt, time - leftAt > resumeWindow { entry.player = nil }
                entry.leftAt = time
            }
            var player = entry.player ?? Player(at: time, wanted: wanted)
            let frame = player.frame(at: time, wanted: wanted)
            entry.player = player
            entries[key] = entry
            return frame
        }

        public var count: Int { entries.count }
    }

    // MARK: - Which body the mark plays

    /// The body for a run's latest native progress, as Claude picks it from a
    /// turn's blocks (`rE`): the newest tool call still waiting for its
    /// result; else the newer of the last tool call and the last thinking;
    /// else think. Text is ignored, and only the main conversation counts.
    public static func body(progress: NativeExecutionProgress?) -> Body {
        let steps = (progress?.steps ?? []).filter { $0.scope == "main" }
        if let running = steps.last(where: { $0.state == .requested }) { return body(step: running) }
        guard let last = steps.last else { return .think }
        let thought = progress?.events.last(where: { $0.scope == "main" && $0.kind == .processing })?.sequence ?? 0
        return thought > last.sequence ? .think : body(step: last)
    }

    /// A Bash step's label is its description unless it carries a verb (the
    /// command itself).
    static func body(step: NativeExecutionProgress.Step) -> Body {
        body(tool: step.tool, description: step.verb == nil ? step.label : nil)
    }

    /// Claude's body for one tool call (`QT` → `eE`): the tool's kind when it
    /// has one (a Bash call by its description's first word), else the words
    /// of its name.
    public static func body(tool: String, description: String? = nil) -> Body {
        if let kind = tool == "SendMessage" ? "task" : toolKind(tool) {
            return (kind == "bash" ? bashBody(description) : nil) ?? kindBodies[kind] ?? .default
        }
        let name = snakeName(tool)
        if ["image_search", "launch_extended_search_task"].contains(name) { return .search }
        if name.hasPrefix("memory_") {
            return ["memory_read", "memory_list", "memory_search", "memory_view"].contains(name) ? .read : .write
        }
        for word in name.split(whereSeparator: { $0.isWhitespace || ":_-".contains($0) }).map(String.init) {
            if writeWords.contains(word) { return .write }
            if codeWords.contains(word) { return .code }
            if readWords.contains(word) { return .read }
        }
        return .default
    }

    static let kindBodies: [String: Body] = [
        "web": .search, "web_fetch": .search, "read": .read, "view": .read, "glob": .read, "grep": .read,
        "past_chats": .read, "project_knowledge": .read, "drive_search": .read, "share": .read,
        "write": .write, "edit": .write, "notebook_edit": .write, "delete_file": .write, "todo": .write, "plan": .write,
        "bash": .code, "code": .code, "kill_bash": .code, "tmux": .code,
    ]
    static let readWords: Set<String> = ["read", "view", "get", "list", "fetch", "search", "find", "query", "retrieve",
                                         "lookup", "load", "open", "ls"]
    static let writeWords: Set<String> = ["write", "edit", "create", "update", "delete", "remove", "append", "insert",
                                          "replace", "patch", "send", "post", "add", "save", "upload", "comment", "artifacts"]
    static let codeWords: Set<String> = ["bash", "exec", "execute", "run", "shell", "python", "repl", "script", "eval",
                                         "javascript"]

    /// Claude's tool kinds (`Cu`), by snake-cased short name.
    static let toolKinds: [String: String] = {
        var kinds = [
            "read": "read", "view": "view", "write": "write", "create_file": "write", "edit": "edit", "multi_edit": "edit",
            "str_replace": "edit", "str_replace_editor": "edit", "update_file": "edit", "open_file": "read",
            "close_file": "read", "delete_file": "delete_file", "file_search": "glob", "present_files": "share",
            "send_user_file": "share", "notebook_edit": "notebook_edit", "repl": "code", "java_script": "code",
            "glob": "glob", "grep": "grep", "recent_chats": "past_chats", "conversation_search": "past_chats",
            "project_knowledge_search": "project_knowledge", "drive_search": "drive_search", "web_fetch": "web_fetch",
            "web_search": "web", "web_search_fast": "web", "bash": "bash", "bash_tool": "bash", "power_shell": "bash",
            "task": "task", "agent": "task", "skill": "skill", "todo_write": "plan", "kill_bash": "kill_bash",
            "tmux": "tmux", "exit_plan_mode": "exit_plan_mode", "tool_search": "tool_search",
        ]
        for action in ["start", "stop", "list", "screenshot", "snapshot", "click", "type", "fill", "scroll", "select",
                       "eval", "resize", "logs", "console_logs", "network", "inspect"] {
            kinds["preview_" + action] = "preview"
        }
        return kinds
    }()
    /// Kinds that belong to Claude's own tools only, not a same-named MCP tool.
    static let nativeOnlyKinds: Set<String> = ["tool_search", "present_files", "send_user_file", "repl", "java_script",
        "recent_chats", "conversation_search", "project_knowledge_search", "drive_search", "skill"]
    static let firstPartyServers: Set<String> = ["cowork", "skills", "plugins", "mcp-registry", "cowork-onboarding",
                                                 "computer-use", "Claude_Browser"]

    /// `ku`: the kind of a tool name, or nil when it has none.
    static func toolKind(_ tool: String) -> String? {
        let name = snakeName(tool)
        if let kind = toolKinds[name] {
            let wrapped = tool.hasPrefix("mcp__") || shortName(tool) != tool || tool.contains(":")
            let firstPartyShare = name == "present_files" && isFirstPartyServer(tool)
            return nativeOnlyKinds.contains(name) && !firstPartyShare && wrapped ? nil : kind
        }
        if tool.contains("__claude-in-chrome__") || tool.contains("__Claude_in_Chrome__") { return "browser" }
        if name.contains("screenshot") && (tool.contains("computer-use") || tool.contains("remote-devices__computer_")) {
            return "screenshot"
        }
        return nil
    }

    /// `ri`: an MCP tool served by one of Claude's own servers.
    static func isFirstPartyServer(_ tool: String) -> Bool {
        guard tool.hasPrefix("mcp__") else { return false }
        let rest = tool.dropFirst(5)
        guard let split = rest.range(of: "__"), split.lowerBound > rest.startIndex else { return false }
        return firstPartyServers.contains(String(rest[..<split.lowerBound]))
    }

    /// `ur`: the tool part of `mcp__server__tool`.
    static func mcpToolName(_ tool: String) -> String? {
        guard tool.hasPrefix("mcp__") else { return nil }
        let rest = trimming(String(tool.dropFirst(5)), leading: false, trailing: true)
        guard let split = rest.range(of: "__", options: .backwards), split.lowerBound > rest.startIndex else { return nil }
        let name = String(rest[split.upperBound...])
        let server = trimming(String(rest[..<split.lowerBound]), leading: true, trailing: true)
        return name.isEmpty || server.isEmpty ? nil : name
    }

    /// `fr`: a tool's own name without its server or namespace.
    static func shortName(_ tool: String) -> String {
        let name = mcpToolName(tool)
            ?? trimming(tool, leading: false, trailing: true).components(separatedBy: "__").last(where: { !$0.isEmpty })
            ?? tool
        let stripped = trimming(name, leading: true, trailing: false)
        return stripped.isEmpty ? name : stripped
    }

    /// `xa`: the short name in snake case ("NotebookEdit" → "notebook_edit").
    static func snakeName(_ tool: String) -> String {
        let name = shortName(tool)
        var result = ""
        var previous: Character?
        for character in name {
            if let previous, previous.isASCII, previous.isLowercase, character.isASCII, character.isUppercase {
                result.append("_")
            }
            result.append(character)
            previous = character
        }
        return result.lowercased()
    }

    private static func trimming(_ text: String, leading: Bool, trailing: Bool) -> String {
        var slice = Substring(text)
        if leading { slice = slice.drop(while: { $0 == "_" }) }
        if trailing { while slice.last == "_" { slice = slice.dropLast() } }
        return String(slice)
    }

    /// `KT`: a Bash call that says it reads or writes by its description's
    /// first word ("List files", "Creates the config"); nil leaves it code.
    static func bashBody(_ description: String?) -> Body? {
        guard let description else { return nil }
        for word in descriptionWords(withoutMemoryTags(description)) {
            if writeWords.contains(word) { return .write }
            if readWords.contains(word) { return .read }
        }
        return nil
    }

    /// `GT`: the first word and its likely stems ("searching" → "search").
    static func descriptionWords(_ text: String) -> [String] {
        let word = text.drop(while: { $0.isWhitespace }).prefix(while: { $0.isASCII && $0.isLetter }).lowercased()
        guard !word.isEmpty else { return [] }
        if word.hasSuffix("ing") && word.count > 5 {
            let stem = String(word.dropLast(3))
            var undoubled = stem
            if let last = stem.last, stem.dropLast().last == last, "bcdfghjklmnpqrstvwxyz".contains(last) {
                undoubled = String(stem.dropLast())
            }
            return [word, stem, stem + "e", undoubled]
        }
        if word.hasSuffix("ies") { return [word, String(word.dropLast(3)) + "y"] }
        if word.hasSuffix("s") && !word.hasSuffix("ss") && word.count > 3 {
            return [word, String(word.dropLast()), String(word.dropLast(2))]
        }
        return [word]
    }

    /// Claude Code's memory tags never count as the first word.
    static func withoutMemoryTags(_ text: String) -> String {
        guard text.contains("<") else { return text }
        return text.replacingOccurrences(of: #"(?:<cc-memory(?:\s+filenames="[^"<>]*")?\s*>|</cc-memory\s*>)+"#,
                                         with: "", options: .regularExpression)
    }
}
