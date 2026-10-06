import Foundation

/// Display-only public native output. Never used as a result, verifier input,
/// routing prompt, conversation handoff or proof of task completion.
public struct NativePublicRunLog: Codable, Equatable, Sendable {
    public enum Origin: String, Codable, Sendable { case nativeAssistant, nativeUI, legacyUnattributed }
    public enum Kind: String, Codable, Sendable { case commentary, candidate, action }
    public struct Entry: Codable, Equatable, Sendable, Identifiable {
        public let id: UUID
        public let provider: String
        public let surface: String?
        public let stream: String
        public let origin: Origin
        public let kind: Kind
        public let actionID: String?
        public var text: String
        public let receivedAt: Date
        /// An action's fixed verb code (`NativeStepLabel.Verb`), so the
        /// transcript can fold a run of calls into "read 3 · run 2". Absent on
        /// prose and on actions recorded by earlier builds.
        public var verb: String? = nil
        /// The action is a subagent's call, not the main turn's.
        public var nested: Bool? = nil
        /// The action's latest state is a returned error, so a folded run of
        /// calls can still say that one failed. Absent on prose and on actions
        /// recorded by earlier builds (their line still says so).
        public var failed: Bool? = nil
    }
    public let conversationID: UUID
    public let submissionID: UUID
    public let requestSHA256: String
    public private(set) var entries: [Entry] = []
    private var snapshots: [String: String] = [:]
    private struct StreamIdentity: Codable, Equatable, Sendable {
        var namespace: String
        var lastObserved: String?
    }
    private var streamIdentities: [String: StreamIdentity] = [:]
    private var boundary = 0
    public private(set) var revision = 0
    /// Each action id's latest entry, so a progress update that re-offers a
    /// long run's every step (1,692 transitions in a real run) costs one
    /// lookup per step, not a scan of the feed. Derived: never stored, and
    /// rebuilt after a saved feed is loaded.
    private var latestAction = ActionIndex()
    private struct ActionIndex: Equatable, Sendable {
        var position: [String: Int] = [:]
        var indexed = 0
        /// Derived from `entries`; two logs with the same entries are equal.
        static func == (lhs: ActionIndex, rhs: ActionIndex) -> Bool { true }
    }
    private enum CodingKeys: String, CodingKey {
        case conversationID, submissionID, requestSHA256, entries, snapshots, streamIdentities, boundary, revision
    }
    public init(conversationID: UUID, submissionID: UUID, requestSHA256: String) {
        self.conversationID = conversationID; self.submissionID = submissionID; self.requestSHA256 = requestSHA256
    }
    public mutating func checkpoint() { boundary += 1 }
    /// Missing/invalid optional progress must not give the same producer two
    /// text namespaces. Bind its first observed stream to its existing session
    /// fallback; only a change between two known streams starts a new segment.
    public mutating func resolveStream(provider: String, nativeSessionID: String?, observedStream: String?) -> String {
        guard ["codex", "claude"].contains(provider) else { return provider + "-unattributed" }
        let anchor = provider + "|" + (nativeSessionID ?? "legacy")
        let fallback = nativeSessionID ?? provider + "-legacy"
        guard let old = streamIdentities[anchor] else {
            let next = StreamIdentity(namespace: observedStream ?? fallback, lastObserved: observedStream)
            streamIdentities[anchor] = next; revision += 1
            return anchor + "|" + next.namespace
        }
        var next = old
        if let observedStream {
            if let previous = old.lastObserved, previous != observedStream { next.namespace = observedStream }
            next.lastObserved = observedStream
        }
        if next != old { streamIdentities[anchor] = next; revision += 1 }
        return anchor + "|" + next.namespace
    }
    @discardableResult public mutating func observe(provider: String, surface: String? = nil, stream: String, text: String,
        candidate: Bool, origin: Origin, receivedAt: Date) -> Bool {
        guard ["codex", "claude"].contains(provider), !stream.isEmpty, stream.utf8.count <= 256,
              !text.isEmpty, text.utf8.count <= 4_000_000,
              receivedAt.timeIntervalSince1970.isFinite else { return false }
        let kind: Kind = candidate ? .candidate : .commentary
        let key = [provider, stream, kind.rawValue].joined(separator: "|")
        let previous = snapshots[key] ?? ""
        guard previous != text else { return false }
        if !candidate, !previous.isEmpty, previous.hasPrefix(text) {
            // A shorter exact public snapshot contains no new bytes. Native
            // partial/full normalization can trim a tail without a new message.
            // Keep already observed history and advance the snapshot cursor so
            // the next delta cannot re-append the entire contracted body.
            snapshots[key] = text
            return false
        }
        var delta = text
        if !candidate, !previous.isEmpty {
            if text.hasPrefix(previous) { delta = String(text.dropFirst(previous.count)) }
            else {
                // The native stream keeps a 24k tail. Match only exact public
                // bytes; no inferred continuation or generated narration.
                let tail = String(previous.suffix(64))
                if tail.count == 64, let found = text.range(of: tail) { delta = String(text[found.upperBound...]) }
            }
        }
        snapshots[key] = text
        guard !delta.isEmpty else { return false }
        // Group adjacent deltas, but never merge through an owner steering
        // checkpoint, a native stream change or a candidate boundary.
        let group = key + "|" + String(boundary)
        if !candidate, let last = entries.last, last.kind == kind,
           last.provider == provider, last.stream == group, last.origin == origin {
            entries[entries.count - 1].text += delta
        } else {
            entries.append(Entry(id: UUID(), provider: provider, surface: surface, stream: group, origin: origin,
                kind: kind, actionID: nil, text: delta, receivedAt: receivedAt))
        }
        revision += 1
        return true
    }
    @discardableResult public mutating func observeAction(id: String, provider: String, surface: String?, text: String,
                                                        verb: String? = nil, nested: Bool = false, failed: Bool = false,
                                                        receivedAt: Date) -> Bool {
        guard !id.isEmpty, id.utf8.count <= 256, !text.isEmpty, text.utf8.count <= 16_384,
              receivedAt.timeIntervalSince1970.isFinite, ["codex", "claude"].contains(provider) else { return false }
        // Append actual state transitions rather than rewriting earlier lines:
        // owner steering anchors must remain exact prefixes of this feed.
        // Bring the index up to the entries (a loaded feed starts unindexed).
        for position in latestAction.indexed..<entries.count where entries[position].kind == .action {
            if let action = entries[position].actionID { latestAction.position[action] = position }
        }
        latestAction.indexed = entries.count
        if let previous = latestAction.position[id], entries[previous].text == text { return false }
        checkpoint()
        latestAction.position[id] = entries.count
        latestAction.indexed = entries.count + 1
        entries.append(Entry(id: UUID(), provider: provider, surface: surface, stream: id, origin: .nativeUI,
            kind: .action, actionID: id, text: text, receivedAt: receivedAt,
            verb: verb.flatMap { Self.isVerbCode($0) ? $0 : nil }, nested: nested ? true : nil, failed: failed ? true : nil))
        revision += 1; return true
    }
    /// Opens and closes each entry's heading in `displayText`. Unicode
    /// noncharacters are reserved for internal use and dropped from every
    /// entry's text there, so model output cannot forge a heading, and any
    /// prefix of the text (a steering anchor is one) still says which entry
    /// each part of it belongs to. (Swift rejects them in string literals.)
    static let headingOpen = Unicode.Scalar(0xFDD0 as UInt32)!
    static let headingClose = Unicode.Scalar(0xFDD1 as UInt32)!
    static let fieldSeparator = Unicode.Scalar(0x1F as UInt8)

    /// Markers are presentation labels, not model-authored sentences. The
    /// native bytes themselves stay unchanged and the scored final is separate.
    /// Each entry is a heading (role, route, label, action id, verb, nesting, error)
    /// and its text; `displaySegments` reads it back for the transcript.
    public var displayText: String { displayText(entries: entries.indices) }
    /// The entries in `range` as `displayText` writes them: one attempt of a
    /// retried submission, whose saved feed also holds the earlier attempts.
    public func displayText(entries range: Range<Int>) -> String {
        let range = range.clamped(to: entries.indices)
        return entries[range].map { entry in
            let name = ProviderSurface.resolveExecuted(rawSurface: entry.surface, provider: entry.provider)?.routeTitle
                ?? (entry.provider == "claude" ? "Anthropic" : "OpenAI")
            let label = entry.origin == .legacyUnattributed ? os1Tr("출처 미확인 공개 출력 · 미채택", "Public output of unconfirmed origin · not adopted")
                : entry.kind == .candidate ? os1Tr("수신 후보 출력 · 미채택", "Received candidate output · not adopted")
                : (entry.kind == .action ? os1Tr("네이티브 동작", "Native action") : os1Tr("공개 진행 출력", "Public progress output"))
            let role = entry.origin == .legacyUnattributed ? "u" : entry.kind == .candidate ? "c" : entry.kind == .action ? "a" : "p"
            let fields = [role, name, label, entry.actionID ?? "", entry.verb ?? "", entry.nested == true ? "1" : "",
                          entry.failed == true ? "1" : ""]
            var heading = String.UnicodeScalarView([Self.headingOpen])
            for (index, field) in fields.enumerated() {
                if index > 0 { heading.append(Self.fieldSeparator) }
                heading.append(contentsOf: field.unicodeScalars.filter { !Self.isStructural($0) && $0 != Self.fieldSeparator })
            }
            heading.append(Self.headingClose)
            return String(heading) + Self.withoutHeadings(entry.text)
        }.joined(separator: "\n\n")
    }

    /// One entry of `displayText` as the transcript lays it out — the
    /// backend's prose, a received candidate or one of its tool actions — or
    /// the part of that entry inside a slice of the text.
    public struct DisplaySegment: Equatable, Sendable {
        public enum Role: String, Sendable { case commentary, candidate, unattributed, action, unmarked }
        public let role: Role
        /// The executed route's title; nil for text without headings.
        public let source: String?
        public let actionID: String?
        public let verb: String?
        public let nested: Bool
        /// The action returned an error (by its recorded state or, in records
        /// from earlier builds, by the state its line was received with).
        public let failed: Bool
        /// Unicode-scalar offset of the entry's heading in the whole text.
        /// The feed only appends, so it stays put while the feed grows.
        public let offset: Int
        public let text: String
    }

    /// The entries inside `slice`, read from the headings `displayText`
    /// writes. A slice that starts inside an entry — the output after a
    /// steering anchor — keeps that entry's role; text without headings
    /// (a backend's raw public text) is one unmarked segment.
    public static func displaySegments(_ slice: Substring) -> [DisplaySegment] {
        let scalars = slice.base.unicodeScalars
        var headings: [(start: String.Index, body: String.Index, offset: Int, fields: [String])] = []
        var open: (index: String.Index, offset: Int)?
        var offset = 0, index = scalars.startIndex
        while index < scalars.endIndex {
            let next = scalars.index(after: index)
            if scalars[index] == headingOpen {
                open = (index, offset)
            } else if scalars[index] == headingClose, let start = open {
                let fields = scalars[scalars.index(after: start.index)..<index]
                    .split(separator: fieldSeparator, omittingEmptySubsequences: false)
                    .map { String(String.UnicodeScalarView($0)) }
                headings.append((start.index, next, start.offset, fields))
                open = nil
            }
            offset += 1
            index = next
        }
        func text(_ from: String.Index, _ to: String.Index) -> String? {
            let start = max(from, slice.startIndex), end = min(to, slice.endIndex)
            guard start < end else { return nil }
            let value = String(String.UnicodeScalarView(scalars[start..<end]))
            return value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : value
        }
        var segments: [DisplaySegment] = []
        if let lead = text(scalars.startIndex, headings.first?.start ?? scalars.endIndex) {
            segments.append(DisplaySegment(role: .unmarked, source: nil, actionID: nil, verb: nil, nested: false, failed: false,
                offset: 0, text: lead))
        }
        for (position, heading) in headings.enumerated() {
            var end = position + 1 < headings.count ? headings[position + 1].start : scalars.endIndex
            if position + 1 < headings.count {
                // The "\n\n" between two entries belongs to neither.
                let joiner = scalars.index(end, offsetBy: -2, limitedBy: heading.body)
                if let joiner, scalars[joiner..<end].elementsEqual("\n\n".unicodeScalars) { end = joiner }
            }
            guard let body = text(heading.body, end) else { continue }
            func field(_ index: Int) -> String? {
                index < heading.fields.count && !heading.fields[index].isEmpty ? heading.fields[index] : nil
            }
            let role: DisplaySegment.Role
            switch field(0) {
            case "p": role = .commentary
            case "c": role = .candidate
            case "u": role = .unattributed
            case "a": role = .action
            default: role = .unmarked
            }
            segments.append(DisplaySegment(role: role, source: field(1), actionID: role == .action ? field(3) : nil,
                verb: role == .action ? field(4) : nil, nested: role == .action && field(5) == "1",
                // A record with the error field is authoritative; only one
                // from an earlier build (six fields) is read from its line.
                failed: role == .action && (heading.fields.count < 7
                    ? Self.saysFailed(body.trimmingCharacters(in: .whitespacesAndNewlines)) : field(6) == "1"),
                offset: heading.offset, text: body))
        }
        return segments
    }

    /// A feed line ends "— returned an error" (or "— 오류 반환"), possibly
    /// followed by its child-call count; earlier records carry no flag.
    private static func saysFailed(_ line: String) -> Bool {
        line.range(of: #"— (오류 반환|returned an error)( · (하위 도구|child tool calls) [0-9]+)?$"#, options: .regularExpression) != nil
    }
    private static func isStructural(_ scalar: Unicode.Scalar) -> Bool { scalar == headingOpen || scalar == headingClose }
    private static func withoutHeadings(_ text: String) -> String {
        guard text.unicodeScalars.contains(where: isStructural) else { return text }
        return String(String.UnicodeScalarView(text.unicodeScalars.filter { !isStructural($0) }))
    }
    private static func isVerbCode(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z]{1,24}$"#, options: .regularExpression) != nil
    }
    public func belongs(conversationID: UUID, submissionID: UUID, requestSHA256: String) -> Bool {
        self.conversationID == conversationID && self.submissionID == submissionID && self.requestSHA256 == requestSHA256
    }
    public var isValid: Bool {
        requestSHA256.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil && boundary >= 0 && revision >= 0 &&
        entries.allSatisfy { entry in
            ["codex", "claude"].contains(entry.provider) && !entry.stream.isEmpty && entry.stream.utf8.count <= 512 &&
            !entry.text.isEmpty && entry.text.utf8.count <= 16_000_000 && entry.receivedAt.timeIntervalSince1970.isFinite &&
            (entry.kind == .action ? entry.origin == .nativeUI && entry.actionID != nil
                : entry.origin != .nativeUI && entry.actionID == nil && entry.verb == nil && entry.nested == nil && entry.failed == nil) &&
            (entry.verb.map(Self.isVerbCode) ?? true)
        } && snapshots.allSatisfy { !$0.key.isEmpty && $0.key.utf8.count <= 512 && $0.value.utf8.count <= 4_000_000 } &&
        streamIdentities.count <= 1_024 && streamIdentities.allSatisfy {
            !$0.key.isEmpty && $0.key.utf8.count <= 256 && !$0.value.namespace.isEmpty && $0.value.namespace.utf8.count <= 256 &&
            ($0.value.lastObserved.map { !$0.isEmpty && $0.utf8.count <= 256 } ?? true)
        }
    }
}

public struct NativePublicRunLogStore: Sendable {
    public let root: URL
    public init(root: URL? = nil) {
        self.root = root ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/public-run-progress", isDirectory: true)
    }
    /// One feed per submission and request: a steered retry runs the same
    /// submission under a new request, and must neither drop its own entries
    /// nor overwrite the feed an earlier attempt's work line opens.
    public func file(submissionID: UUID, requestSHA256: String) -> URL {
        root.appendingPathComponent(submissionID.uuidString.lowercased() + "-" + requestSHA256 + ".json")
    }
    /// The file a feed is read from: its own, or one saved by an earlier
    /// build under the submission alone (read only if its request matches).
    public func readableFile(submissionID: UUID, requestSHA256: String) -> URL {
        let own = file(submissionID: submissionID, requestSHA256: requestSHA256)
        guard !FileManager.default.fileExists(atPath: own.path) else { return own }
        return root.appendingPathComponent(submissionID.uuidString.lowercased() + ".json")
    }
    public func load(conversationID: UUID, submissionID: UUID, requestSHA256: String) -> NativePublicRunLog {
        let fresh = NativePublicRunLog(conversationID: conversationID, submissionID: submissionID, requestSHA256: requestSHA256)
        guard requestSHA256.range(of: #"^[0-9a-f]{64}$"#, options: .regularExpression) != nil else { return fresh }
        let file = readableFile(submissionID: submissionID, requestSHA256: requestSHA256)
        guard !root.isSymbolicLink, !file.isSymbolicLink,
              let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
              attrs[.type] as? FileAttributeType == .typeRegular,
              (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 16_000_000,
              let bytes = try? Data(contentsOf: file),
              let value = try? JSONDecoder().decode(NativePublicRunLog.self, from: bytes),
              value.isValid,
              value.belongs(conversationID: conversationID, submissionID: submissionID, requestSHA256: requestSHA256) else { return fresh }
        return value
    }
    public func save(_ value: NativePublicRunLog) throws {
        guard value.isValid, !root.isSymbolicLink else { throw CocoaError(.fileWriteInvalidFileName) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let file = file(submissionID: value.submissionID, requestSHA256: value.requestSHA256)
        guard !file.isSymbolicLink else { throw CocoaError(.fileWriteInvalidFileName) }
        let bytes = try JSONEncoder().encode(value)
        guard bytes.count <= 16_000_000 else { throw CocoaError(.fileWriteOutOfSpace) }
        try bytes.write(to: file, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
}

/// Ordered off-UI persistence. Multiple native deltas coalesce; stale queued
/// snapshots can never overwrite a newer revision of the same feed (one
/// submission's request: each attempt under a new request has its own).
public actor NativePublicRunLogWriter {
    private struct Feed: Hashable { let submissionID: UUID; let requestSHA256: String }
    private var pending: [Feed: (NativePublicRunLog, NativePublicRunLogStore)] = [:]
    private var persisted: [Feed: Int] = [:]
    private var timer: Task<Void, Never>?
    public init() {}
    public func enqueue(_ log: NativePublicRunLog, store: NativePublicRunLogStore) {
        let feed = Feed(submissionID: log.submissionID, requestSHA256: log.requestSHA256)
        guard log.revision > (persisted[feed] ?? -1),
              log.revision >= (pending[feed]?.0.revision ?? -1) else { return }
        pending[feed] = (log, store)
        if timer == nil {
            timer = Task { try? await Task.sleep(for: .milliseconds(250)); flushAll() }
        }
    }
    public func flush(_ submissionID: UUID, requestSHA256: String) {
        flush(Feed(submissionID: submissionID, requestSHA256: requestSHA256))
    }
    private func flush(_ feed: Feed) {
        guard let (log, store) = pending.removeValue(forKey: feed) else { return }
        do { try store.save(log); persisted[feed] = log.revision } catch { }
    }
    private func flushAll() {
        timer = nil
        for feed in Array(pending.keys) { flush(feed) }
    }
}

private extension URL {
    var isSymbolicLink: Bool { (try? resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true }
}
