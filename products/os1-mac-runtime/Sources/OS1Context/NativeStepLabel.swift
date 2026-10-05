import Foundation

/// The backend's own words for one tool call — Claude Code's "doing X" line.
///
/// Only allowlisted fields the model wrote to describe a call are read: a Bash
/// or Agent `description`, a file path, a search pattern or query, a URL with
/// its credentials, query and fragment removed, a todo's `activeForm`, Codex
/// command actions, a changed file's path, an MCP server/tool name. A raw
/// command is shown only when no description exists (Claude Code does the
/// same) or Codex reports no read/search/list action, and only after
/// `redact`, whose masking is heuristic. Never read here: tool results or outputs,
/// thinking, file contents, Edit/Write strings, Agent/WebFetch prompts, MCP
/// arguments, Codex aggregated output or diffs.
///
/// OS-1 adds no claim of its own: the `verb` is a fixed code tied to the tool's
/// identity ("read" for Read), rendered by the app; it never says "done".
public enum NativeStepLabel {
    public static let maximumCharacters = 160
    public static let maximumBytes = 480

    public enum Verb: String, CaseIterable, Sendable {
        case run, read, edit, write, add, delete, search, find, list, fetch, webSearch, agent, mcp, plan, view
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

    /// Characters examined by the mask passes. Only 160 are shown, but a masked
    /// run shrinks to "…", so a margin is kept; the bound keeps every pass
    /// linear and small however long a heredoc command is.
    static let maskWindow = 2_048

    /// Normalise, mask secrets, cap. Runs before anything is written to disk
    /// and again when the app decodes a step. Idempotent: a redacted label
    /// redacts to itself. nil when nothing displayable remains.
    ///
    /// Masking is heuristic: known token shapes, credential-bearing flags,
    /// headers and key/value pairs, credential arguments of common CLIs, values
    /// fed to secret-setting CLIs, private-key bodies and random-looking runs.
    /// A short, word-like secret passed as a plain positional argument to an
    /// unknown program can still be shown.
    public static func redact(_ raw: String) -> String? {
        // Every decode re-redacts every label, and each activity snapshot
        // repeats the same labels; a bounded memo keeps that off the per-event
        // path. Huge inputs are not kept as keys.
        let cacheable = raw.utf8.count <= 4_096
        if cacheable, let hit = cache.lookup(raw) { return hit }
        let result = computeRedaction(raw)
        if cacheable { cache.store(raw, result) }
        return result
    }

    private static func computeRedaction(_ raw: String) -> String? {
        var text = window(normalize(raw.utf8.count > 4 * maskWindow ? String(raw.prefix(2 * maskWindow)) : raw))
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

    /// Two-generation memo: lookups hit the current or previous generation,
    /// so memory stays bounded without a per-entry recency list.
    private final class RedactionCache: @unchecked Sendable {
        private let lock = NSLock()
        private var current: [String: String?] = [:]
        private var previous: [String: String?] = [:]
        private let generation = 512
        func lookup(_ key: String) -> String?? {
            lock.lock(); defer { lock.unlock() }
            if let hit = current[key] { return .some(hit) }
            if let hit = previous[key] { insert(key, hit); return .some(hit) }
            return nil
        }
        func store(_ key: String, _ value: String?) {
            lock.lock(); defer { lock.unlock() }
            insert(key, value)
        }
        private func insert(_ key: String, _ value: String?) {
            if current.count >= generation { previous = current; current = [:] }
            current[key] = .some(value)
        }
    }
    private static let cache = RedactionCache()

    private static func mask(_ text: String) -> String {
        maskLongRuns(maskRules.reduce(maskCommandWords(text)) { $1.apply($0) })
    }

    /// At most `maskWindow` characters, ending on a word boundary when one is
    /// near so no part of a token is kept; " …" marks the cut.
    private static func window(_ text: String) -> String {
        guard text.count > maskWindow else { return text }
        var cut = text.prefix(maskWindow)
        if let space = cut.lastIndex(of: " "), cut.distance(from: space, to: cut.endIndex) <= 256 { cut = cut[..<space] }
        return String(cut) + " …"
    }

    /// Shape check for a decoded label: one line, capped, no control, bidi or
    /// invisible format characters.
    public static func isDisplayable(_ label: String) -> Bool {
        !label.isEmpty && label.count <= maximumCharacters && label.utf8.count <= maximumBytes &&
            label.unicodeScalars.allSatisfy { !isHidden($0) } && label == label.trimmingCharacters(in: .whitespaces)
    }

    /// Controls, bidi controls, line/paragraph separators, every Unicode
    /// format character (zero-width joiners, word joiner, BOM, soft hyphen,
    /// tags) and invisible fillers. A zero-width character inside a token
    /// would otherwise split it past the masks and render invisibly.
    private static func isHidden(_ scalar: Unicode.Scalar) -> Bool {
        let v = scalar.value
        if v < 0x20 || (0x7F...0x9F).contains(v) || v == 0x2028 || v == 0x2029 { return true }
        if [0x034F, 0x115F, 0x1160, 0x180E, 0x3164, 0xFFA0].contains(v) { return true }
        return scalar.properties.generalCategory == .format
    }

    private static func normalize(_ raw: String) -> String {
        var out = String.UnicodeScalarView()
        var pendingSpace = false
        for scalar in raw.unicodeScalars {
            let v = scalar.value
            // Newlines, tabs and line separators become one space. Other
            // invisible characters are removed outright, checked before the
            // whitespace set (which holds U+200B) so a zero-width character
            // cannot split a token into pieces the masks miss.
            if v < 0x20 || v == 0x85 || v == 0x2028 || v == 0x2029 { pendingSpace = true; continue }
            if isHidden(scalar) { continue }
            if CharacterSet.whitespacesAndNewlines.contains(scalar) { pendingSpace = true; continue }
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

    /// Every repetition that precedes another element is bounded and every
    /// key/flag rule starts only where a word starts: unbounded `[…]*` before
    /// an alternation backtracked quadratically on long `-`/`.`-joined runs.
    private static let maskRules: [MaskRule] = [
        // A private-key body, from its armour line to its end line (or the end).
        rule(#"(-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z ]{0,12}-----).*?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY[A-Z ]{0,12}-----|$)"#, "$1 …"),
        // Credentials in a URL authority (the password may hold `/` or one
        // space), then any URL query string.
        rule(#"\b([A-Za-z][A-Za-z0-9+.-]{0,30}://)(?:[^\s/?#@:]{0,256}:[^\s@]{0,256}(?: [^\s@/:]{1,64})?|[^\s/?#@:]{1,256})@"#, "$1…@"),
        rule(#"\b([A-Za-z][A-Za-z0-9+.-]{0,30}://[^\s?#]{0,2048})[?#][^\s'"]{0,4096}"#, "$1?…"),
        // Well-known token shapes.
        rule(#"\bsk-[A-Za-z0-9_-]{16,}"#, "…"),
        rule(#"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}"#, "…"),
        rule(#"\bgh[pousr]_[A-Za-z0-9_]{8,}"#, "…"),
        rule(#"\bgithub_pat_[A-Za-z0-9_]{8,}"#, "…"),
        rule(#"\bglpat-[A-Za-z0-9_-]{16,}"#, "…"),
        rule(#"\b(?:npm|hf|gsk|whsec)_[A-Za-z0-9]{16,}"#, "…"),
        rule(#"\bya29\.[A-Za-z0-9_-]{16,}"#, "…"),
        rule(#"\bx(?:ox[abposre]|app)-[^\s'"]+"#, "…"),
        rule(#"\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[0-9A-Z]{16}\b"#, "…"),
        rule(#"\bAIza[0-9A-Za-z_-]{35}"#, "…"),
        rule(#"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"#, "…"),
        // UUIDs: some API keys are UUID-shaped; masked always, not by chance.
        rule(#"(?<![0-9A-Fa-f])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f])"#, "…"),
        // A quoted header (curl -H, git extraheader, fetch options) keeps its
        // name and loses its whole value, whatever the auth scheme or however
        // many cookie pairs it carries.
        rule(#"(['"])((?:proxy-)?authorization|(?:set-)?cookie|x-[A-Za-z0-9-]{0,40}|[A-Za-z0-9-]{0,24}(?:api[-_]?key|token|secret|auth|session|signature|password|credential)[A-Za-z0-9-]{0,24})(\s*:\s*)[^'"]{0,2048}"#,
             "$1$2$3…", [.caseInsensitive]),
        rule(#"\b(Bearer)\s+[^\s'"]+"#, "$1 …", [.caseInsensitive]),
        rule(#"\b(Basic)\s+(?=[A-Za-z0-9+/=]*[0-9+/=])[A-Za-z0-9+/=]{8,}"#, "$1 …"),
        // Secret-named flags keep the name, lose the value. A flag starts a
        // word: `add-generic-password` is a subcommand, not a flag; a
        // `--password-stdin` switch takes no value.
        rule(#"(?<![\w-])(--?[A-Za-z0-9_-]{0,40}?(?:password|passwd|passphrase|pass|pwd|token|secret|api[_-]?key|apikey|auth|credential|cookie)[A-Za-z0-9_-]{0,40})(?<!-stdin)(=|\s+)(?![-…])("[^"]{0,512}"|'[^']{0,512}'|[^\s'"]+)"#,
             "$1$2…", [.caseInsensitive]),
        // Secret-named keys, bare or quoted (JSON, dicts, `os.environ['…']`),
        // with `=` or `:`; an auth scheme word before the value goes with it.
        // A `{`/`[` value is a structure or a pattern, not a credential.
        rule(#"(?<![\w.-])([A-Za-z0-9_.-]{0,48}?(?:password|passwd|passphrase|pwd|token|secret|api[_-]?key|apikey|authorization|credential|cookie|private[_-]?key|access[_-]?key|session[_-]?id)[A-Za-z0-9_.-]{0,48})(["']?\]?\s*[=:]\s*)(?![…{\[])("[^"]{0,512}"|'[^']{0,512}'|(?:(?:Bearer|Basic|Token|Digest|Negotiate|ApiKey|SSWS)\s+)?[^\s'",;}\]]+)"#,
             "$1$2…", [.caseInsensitive]),
        // netrc lines and OpenSSL `pass:` arguments.
        rule(#"\b(login\s+[^\s'"]{1,256}\s+password)\s+(?!…)[^\s'"]{1,512}"#, "$1 …", [.caseInsensitive]),
        rule(#"\b(pass):(?![…\s])[^\s'"]{1,512}"#, "$1:…"),
        // Environment assignments: NAME=value keeps NAME.
        rule(#"(?<!\w)([A-Z_][A-Z0-9_]{0,127})=(?!…)("[^"]{0,512}"|'[^']{0,512}'|[^\s'"]+)"#, "$1=…"),
    ]

    private static let hexRun = try! NSRegularExpression(pattern: #"(?<![0-9A-Fa-f])[0-9A-Fa-f]{32,}(?![0-9A-Fa-f])"#)
    private static let tokenRun = try! NSRegularExpression(pattern: #"[A-Za-z0-9+/_=.-]{16,}"#)

    /// Long hex, base64 payloads and random-looking runs. A path keeps its
    /// readable pieces and loses only a random one; any other run is judged
    /// whole, so a `/` inside a base64 secret cannot split it into pieces
    /// that each look too short to mask.
    private static func maskLongRuns(_ text: String) -> String {
        let source = hexRun.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "…")
        var masked: [Range<String.Index>] = []
        for match in tokenRun.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
            guard let range = Range(match.range, in: source) else { continue }
            let run = source[range]
            var pieces: [Range<String.Index>] = []
            var start = range.lowerBound
            for index in run.indices where source[index] == "/" {
                pieces.append(start..<index); start = source.index(after: index)
            }
            pieces.append(start..<range.upperBound)
            let afterTilde = range.lowerBound > source.startIndex && source[source.index(before: range.lowerBound)] == "~"
            if isPathLike(run, pieces: pieces.map { source[$0] }, afterTilde: afterTilde) {
                let random = pieces.indices.filter { looksRandom(source[pieces[$0]]) }
                for index in pieces.indices {
                    // A mixed-class piece beside a masked one may be the rest
                    // of the same secret split at a `/`.
                    let beside = random.contains(index - 1) || random.contains(index + 1)
                    let shape = Shape(source[pieces[index]])
                    if random.contains(index) || (beside && shape.length >= 4 && shape.changeRatio >= 0.5) {
                        masked.append(pieces[index])
                    }
                }
            } else if looksLikePayload(run) || looksRandom(run) {
                masked.append(range)
            }
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

    /// A file path or URL path: rooted, home- or dot-relative, a host first,
    /// or a file name last — and at least half its pieces (two or more) read
    /// as names. A base64 secret that happens to start with `/` does not.
    static func isPathLike(_ run: Substring, pieces: [Substring], afterTilde: Bool) -> Bool {
        guard pieces.count > 1 else { return false }
        let rooted = run.hasPrefix("/") || run.hasPrefix("./") || run.hasPrefix("../") || afterTilde
        let hosted = pieces.first { !$0.isEmpty }.map { $0.contains(".") } ?? false
        let filed = pieces.last.map { $0.range(of: #"\.[A-Za-z][A-Za-z0-9]{0,7}$"#, options: .regularExpression) != nil } ?? false
        guard rooted || hosted || filed else { return false }
        var named = 0, other = 0
        for piece in pieces {
            let shape = Shape(piece)
            guard shape.length > 0 else { continue }
            // A short piece that mixes classes but is too short to judge
            // random counts double: base64 split at several `/` is made of them.
            if shape.isNameLike { named += 1 } else { other += !shape.isRandom && shape.score >= 3 ? 2 : 1 }
        }
        return named >= other && (named >= 2 || other == 0)
    }

    /// Padded or `+`-joined base64 is a payload, not a name.
    static func looksLikePayload(_ run: Substring) -> Bool {
        guard run.count >= 24, run.contains(where: \.isNumber), run.contains(where: \.isLetter) else { return false }
        if run.hasSuffix("=") { return true }
        func alphanumeric(_ c: Character) -> Bool { c.isASCII && (c.isLetter || c.isNumber) }
        let characters = Array(run)
        return characters.indices.contains { index in
            characters[index] == "+" && index > 0 && index + 1 < characters.count &&
                alphanumeric(characters[index - 1]) && alphanumeric(characters[index + 1])
        }
    }

    /// Character-class statistics of a run. A generated secret changes
    /// between letters and digits, flips case in short runs, or strings
    /// consonants together far more often than a name, path or identifier.
    /// Counted inside `-_.+=/`-separated segments so `2026-10-04` or a path
    /// does not score. Pure-hex segments under 25 characters (commit ids,
    /// message ids, content hashes in file names) do not score either; longer
    /// hex is masked by its own rule.
    struct Shape {
        /// ASCII letters and digits.
        private(set) var length = 0
        private(set) var letters = 0
        /// Letter/digit transitions, lowercase runs of one or two letters
        /// between capitals, and lowercase consonant clusters of 4+ (6+ counts twice).
        private(set) var score = 0
        private(set) var digits = 0
        /// Digit/upper/lower class changes per adjacent pair inside scored segments.
        private(set) var changeRatio = 0.0

        private enum Kind { case digit, upper, lower }

        init<S: StringProtocol>(_ text: S) {
            func kind(_ c: Character) -> Kind? {
                guard c.isASCII else { return nil }
                return c.isNumber ? .digit : c.isUppercase ? .upper : c.isLowercase ? .lower : nil
            }
            var changes = 0, pairs = 0
            var segmentScore = 0, segmentLength = 0, segmentHex = true, segmentChanges = 0, segmentPairs = 0
            var previous: Kind?, lowerRun = 0, lowerAfterUpper = false, consonants = 0
            func closeCluster() {
                if consonants >= 4 { segmentScore += consonants >= 6 ? 2 : 1 }
                consonants = 0
            }
            func closeSegment() {
                closeCluster()
                if !(segmentHex && segmentLength <= 24) {
                    score += segmentScore; changes += segmentChanges; pairs += segmentPairs
                }
                segmentScore = 0; segmentLength = 0; segmentHex = true; segmentChanges = 0; segmentPairs = 0
                previous = nil; lowerRun = 0; lowerAfterUpper = false
            }
            for c in text {
                guard let k = kind(c) else { closeSegment(); continue }
                length += 1; segmentLength += 1
                if k == .digit { digits += 1 } else { letters += 1 }
                if !c.isHexDigit { segmentHex = false }
                if let p = previous {
                    segmentPairs += 1
                    if p != k { segmentChanges += 1 }
                    if (p == .digit) != (k == .digit) { segmentScore += 1 }
                    if k == .upper, p == .lower, lowerAfterUpper, lowerRun <= 2 { segmentScore += 1 }
                }
                if k == .lower {
                    if previous == .lower { lowerRun += 1 } else { lowerRun = 1; lowerAfterUpper = previous == .upper }
                    if "aeiouy".contains(c) { closeCluster() } else { consonants += 1 }
                } else {
                    closeCluster()
                }
                previous = k
            }
            closeSegment()
            changeRatio = pairs > 0 ? Double(changes) / Double(pairs) : 0
        }

        /// The class-change ratio needs a digit: camelCase built from short
        /// words (`isNewEditAfterReadOnlyTask`) changes case just as often.
        var isRandom: Bool {
            guard length >= 16, letters > 0 else { return false }
            if score >= 5 { return true }
            guard digits > 0 else { return false }
            return (length >= 20 && changeRatio >= 0.45) || (length >= 24 && changeRatio >= 0.4)
        }
        var isNameLike: Bool { score <= 2 && (length <= 7 || changeRatio < 0.4) }
    }

    static func looksRandom<S: StringProtocol>(_ piece: S) -> Bool { Shape(piece).isRandom }

    // MARK: Command arguments

    /// One shell word or operator, with its range in the normalised text.
    private struct ShellWord {
        let range: Range<String.Index>
        let op: String?
    }

    /// Splits a one-line command into words and operators (`|`, `||`, `&&`,
    /// `;`, `&`, `(`, `)`, `<<<`), keeping quoted strings and redirections
    /// such as `2>&1` inside their word.
    private static func shellWords(_ text: String) -> [ShellWord] {
        var words: [ShellWord] = []
        let end = text.endIndex
        func after(_ j: String.Index) -> String.Index { text.index(after: j) }
        var i = text.startIndex
        while i < end {
            let c = text[i]
            if c == " " { i = after(i); continue }
            if text[i...].hasPrefix("<<<") {
                let j = text.index(i, offsetBy: 3)
                words.append(.init(range: i..<j, op: "<<<")); i = j; continue
            }
            let next: Character? = after(i) < end ? text[after(i)] : nil
            if c == "|" || c == ";" || c == "(" || c == ")" || (c == "&" && next != ">") {
                var j = after(i)
                if c == "|" || c == "&", next == c { j = after(j) }
                words.append(.init(range: i..<j, op: String(text[i..<j]))); i = j; continue
            }
            var j = i
            var quote: Character?
            while j < end {
                let d = text[j]
                if let q = quote {
                    if d == "\\", q == "\"", after(j) < end { j = after(after(j)); continue }
                    if d == q { quote = nil }
                    j = after(j); continue
                }
                if d == "\\", after(j) < end { j = after(after(j)); continue }
                if d == "'" || d == "\"" { quote = d; j = after(j); continue }
                if d == " " || d == "|" || d == ";" || d == "(" || d == ")" { break }
                if d == "&", j > i {
                    // `2>&1` and `>&2` are redirections, not separators.
                    let prior = text[text.index(before: j)]
                    if prior != ">" && prior != "<" { break }
                }
                if d == "<", text[j...].hasPrefix("<<<") { break }
                j = after(j)
            }
            if j == i { j = after(i) }
            words.append(.init(range: i..<j, op: nil)); i = j
        }
        return words
    }

    private static func unquoted(_ word: Substring) -> Substring {
        guard let first = word.first, first == "'" || first == "\"" else { return word }
        if word.count >= 2, word.last == first { return word.dropFirst().dropLast() }
        return word.dropFirst()
    }

    private enum ValueMask { case all, afterColon, afterEquals }

    /// Credential arguments of common CLIs, and values handed to
    /// secret-setting CLIs (`gh secret set`, `wrangler secret put`, `kubectl
    /// create secret`, `docker login --password-stdin`, `sudo -S` …), including
    /// an `echo`/`printf` piped into them or a `<<<` here-string.
    private static func maskCommandWords(_ text: String) -> String {
        let words = shellWords(text)
        guard words.count > 1 else { return text }
        let bare = words.map { unquoted(text[$0.range]) }
        let names = bare.map { word -> String in
            String(word.split(separator: "/", omittingEmptySubsequences: false).last ?? word).lowercased()
        }
        // Word index -> the part of it that is masked.
        var cuts: [Int: Range<String.Index>] = [:]
        func cut(_ index: Int, from start: String.Index? = nil) {
            guard words.indices.contains(index), words[index].op == nil else { return }
            let range = words[index].range
            let lower = start ?? range.lowerBound
            var upper = range.upperBound
            // A tail cut inside a quoted value keeps the closing quote, so the
            // next pass does not read an unclosed quote running to the end.
            let kept = text[range.lowerBound..<lower]
            if let close = text[range].last, close == "'" || close == "\"",
               kept.filter({ $0 == close }).count % 2 == 1, lower < text.index(before: upper) {
                upper = text.index(before: upper)
            }
            guard lower < upper else { return }
            // An already masked value stays as it is: redaction must settle.
            guard !text[lower..<upper].allSatisfy({ "…'\"".contains($0) }) else { return }
            if let existing = cuts[index], existing.lowerBound <= lower { return }
            cuts[index] = lower..<upper
        }
        func cutValue(_ index: Int, _ mode: ValueMask) {
            guard words.indices.contains(index) else { return }
            let raw = text[words[index].range]
            switch mode {
            case .all: cut(index)
            case .afterColon: if let colon = raw.firstIndex(of: ":") { cut(index, from: raw.index(after: colon)) }
            case .afterEquals: if let equals = raw.firstIndex(of: "=") { cut(index, from: raw.index(after: equals)) }
            }
        }
        var segments: [[Int]] = [[]]
        var pipedIn = [false]
        for (index, word) in words.enumerated() {
            if let op = word.op, op != "<<<" {
                segments.append([]); pipedIn.append(op == "|")
            } else {
                segments[segments.count - 1].append(index)
            }
        }
        for (number, segment) in segments.enumerated() where !segment.isEmpty {
            let segmentNames = segment.map { names[$0] }
            func has(_ name: String) -> Bool { segmentNames.contains(name) }
            func position(_ name: String) -> Int? { segmentNames.firstIndex(of: name) }
            func isFlag(_ k: Int) -> Bool { bare[segment[k]].hasPrefix("-") }
            /// The value of `flags` (separate word, `--flag=value`, or a short
            /// flag with its value attached), from segment position `from`.
            func flag(_ flags: Set<String>, attached: [String] = [], from: Int = 0, _ mode: ValueMask = .all) {
                guard from < segment.count else { return }
                for k in from..<segment.count {
                    let word = bare[segment[k]], raw = text[words[segment[k]].range]
                    if flags.contains(String(word)) {
                        if k + 1 < segment.count, !isFlag(k + 1), words[segment[k + 1]].op == nil {
                            cutValue(segment[k + 1], mode)
                        }
                    } else if let equals = word.firstIndex(of: "="), flags.contains(String(word[..<equals])),
                              let rawEquals = raw.firstIndex(of: "=") {
                        let value = raw[raw.index(after: rawEquals)...]
                        switch mode {
                        case .all: cut(segment[k], from: value.startIndex)
                        case .afterColon:
                            if let colon = value.firstIndex(of: ":") { cut(segment[k], from: raw.index(after: colon)) }
                        case .afterEquals:
                            if let inner = value.firstIndex(of: "=") { cut(segment[k], from: raw.index(after: inner)) }
                        }
                    } else if !word.hasPrefix("--") {
                        for short in attached where word.hasPrefix(short) && word.count > short.count {
                            guard let found = raw.range(of: short) else { continue }
                            if mode == .afterColon {
                                if let colon = raw[found.upperBound...].firstIndex(of: ":") { cut(segment[k], from: raw.index(after: colon)) }
                            } else {
                                cut(segment[k], from: found.upperBound)
                            }
                        }
                    }
                }
            }
            /// Every `key=value` operand after `from` keeps its key.
            func keyValues(from: Int) {
                guard from < segment.count else { return }
                for k in from..<segment.count where !isFlag(k) && bare[segment[k]].contains("=") { cutValue(segment[k], .afterEquals) }
            }
            func operand(after k: Int, skipping: Int = 0) -> Int? {
                var remaining = skipping, index = k + 1
                while index < segment.count {
                    if !isFlag(index) { if remaining == 0 { return index }; remaining -= 1 }
                    index += 1
                }
                return nil
            }
            var readsSecret = false
            if has("curl") {
                flag(["-u", "--user", "-U", "--proxy-user"], attached: ["-u", "-U"], .afterColon)
                flag(["-b", "--cookie", "--oauth2-bearer"], attached: ["-b"])
            }
            if segmentNames.contains(where: { ["mysql", "mariadb", "mysqldump", "mysqladmin", "mysqlimport", "mysqlcheck", "mysqlsh"].contains($0) }) {
                flag([], attached: ["-p"])
            }
            if has("sshpass") { flag(["-p"], attached: ["-p"]) }
            if has("login"), segmentNames.contains(where: { ["docker", "podman", "nerdctl", "buildah", "skopeo", "oras", "helm", "crane", "regctl"].contains($0) }) {
                flag(["-p", "--password"], attached: ["-p"])
                if segment.contains(where: { bare[$0] == "--password-stdin" }) { readsSecret = true }
            }
            if segmentNames.contains(where: { ["redis-cli", "valkey-cli", "keydb-cli"].contains($0) }) {
                flag(["-a", "--pass", "--password"], attached: ["-a"])
            }
            if segmentNames.contains(where: { ["zip", "unzip", "zipcloak", "funzip"].contains($0) }) { flag(["-P", "--password"]) }
            if segmentNames.contains(where: { ["7z", "7za", "7zr", "7zz"].contains($0) }) { flag([], attached: ["-p"]) }
            if has("openssl") { flag(["-k", "-K", "-pass", "-passin", "-passout"]) }
            if has("security") { flag(["-w", "-p", "-P"]) }
            if has("htpasswd"), segment.indices.contains(where: { isFlag($0) && !bare[segment[$0]].hasPrefix("--") && bare[segment[$0]].contains("b") }),
               let last = segment.indices.last(where: { !isFlag($0) }), last > 0 {
                cut(segment[last])
            }
            if has("aws"), let configure = position("configure"), let set = segmentNames[configure...].firstIndex(of: "set"),
               let value = operand(after: set, skipping: 1) {
                cut(segment[value])
            }
            if has("gh"), let set = position("set"), set > 0, ["secret", "variable"].contains(segmentNames[set - 1]) {
                let body = segment[set...].contains { k in
                    let word = bare[k]
                    return word == "--body" || word.hasPrefix("--body=") || (word.hasPrefix("-b") && !word.hasPrefix("--"))
                }
                if body { flag(["--body", "-b"], attached: ["-b"], from: set) } else { readsSecret = true }
            }
            if has("gh"), has("auth"), has("login"), segment.contains(where: { bare[$0] == "--with-token" }) { readsSecret = true }
            if segmentNames.contains(where: { $0 == "wrangler" || $0.hasPrefix("wrangler@") }), has("secret"), has("put") || has("bulk") {
                readsSecret = true
            }
            if has("kubectl") || has("oc"), has("create"), has("secret") {
                flag(["--from-literal"], .afterEquals)
            }
            if has("vercel"), has("env"), has("add") { readsSecret = true }
            if has("fly") || has("flyctl") || has("doppler") || has("supabase"), has("secrets"), let set = position("set") ?? position("import") {
                keyValues(from: set + 1); readsSecret = true
            }
            if has("heroku"), let set = position("config:set") { keyValues(from: set + 1) }
            if has("railway") { flag(["--set"], .afterEquals) }
            if has("netlify"), let set = position("env:set"), let value = operand(after: set, skipping: 1) { cut(segment[value]) }
            if segmentNames.contains(where: { $0.hasSuffix("secrets:set") }) { readsSecret = true }
            if has("chpasswd") || (has("passwd") && segment.contains(where: { bare[$0] == "--stdin" })) { readsSecret = true }
            if let sudo = position("sudo"),
               segment[(sudo + 1)...].prefix(while: { bare[$0].hasPrefix("-") }).contains(where: {
                   bare[$0] == "--stdin" || (!bare[$0].hasPrefix("--") && bare[$0].contains("S"))
               }) {
                readsSecret = true
            }
            guard readsSecret else { continue }
            // The value arrives on standard input: a here-string, or an
            // echo/printf piped in from the previous segment.
            for k in segment.indices where words[segment[k]].op == "<<<" { cut(segment[k] + 1) }
            if pipedIn[number], number > 0 {
                let source = segments[number - 1]
                if let echo = source.firstIndex(where: { ["echo", "printf", "print"].contains(names[$0]) }) {
                    let operands = source[(echo + 1)...].filter { !bare[$0].hasPrefix("-") }
                    let isPrintf = names[source[echo]] == "printf"
                    for (offset, index) in operands.enumerated() {
                        // printf's format (`%s`) is not the value.
                        if isPrintf, offset == 0, operands.count > 1, bare[index].contains("%") { continue }
                        cut(index)
                    }
                }
            }
        }
        guard !cuts.isEmpty else { return text }
        // Rebuild from the unmodified text so no index is used after a mutation.
        var result = ""
        var cursor = text.startIndex
        for (_, range) in cuts.sorted(by: { $0.key < $1.key }) {
            result += text[cursor..<range.lowerBound]
            result += "…"
            cursor = range.upperBound
        }
        result += text[cursor...]
        return result
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

    /// Public Codex app-server/Desktop items. Never reads
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
            if let queries = action?["queries"] as? [String], !queries.isEmpty {
                return make(.webSearch, queries.prefix(3).joined(separator: "; "))
            }
            return make(.fetch, string(action?["url"]).map(displayURL))
        case "collabToolCall", "collabAgentToolCall":
            // The operation and any provider-supplied nickname are public
            // metadata. Delegated prompts and child output stay private.
            return make(.agent, joined([string(item["tool"]), string(item["agentNickname"]) ?? string(item["agentName"])]))
        case "dynamicToolCall":
            return make(.mcp, string(item["tool"])) // Never arguments/contentItems.
        case "plan":
            return make(.plan, string(item["text"])) // Native public proposed plan, not reasoning.
        case "imageView":
            return make(.view, string(item["path"]).map { displayPath($0, workspace: workspace) })
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
