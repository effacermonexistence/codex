import Foundation

/// Build 442, DESIGN-4 §3 (2026-10-28): the owner's speech-to-text hints for
/// the local request classifier.
///
/// The owner dictates. The 9B model cannot repair a misheard proper noun: it
/// read "쉐딩 방정식" (the Schrödinger equation) as shading or graphics. A
/// small compiled list, built ONLY from corrections the owner actually made,
/// plus an owner-editable file, maps a heard spelling to the intended term.
/// A hint whose heard spelling occurs in the request travels to the local
/// model as a "possible intended term", outside the request's data tags.
///
/// Hints are never routing keywords: the keyword profile, the rails, the
/// markers and Core never read them; they only inform the local model's
/// reading of what the owner meant.
///
/// The file `~/.os1/local-classifier/asr-hints.json` is strict JSON,
/// `{"schema":1,"hints":[{"heard":"…","intended":"…"}]}`: at most 200 pairs,
/// a heard spelling of at most 40 and an intended term of at most 80 Unicode
/// scalars (NFC; review of DESIGN-4: not grapheme clusters, which hide
/// combining marks), no control, line or paragraph separator, no angle
/// bracket or quote character (a value stays inside its quotes in the prompt
/// line; review of H2: every Unicode quotation mark and the apostrophe,
/// prime and fullwidth look-alikes count, so '＇' or '」' cannot seem to
/// close a value either), no duplicate heard spelling, no other key, at most
/// 32 KiB. Anything
/// invalid is ignored as a whole, with a receipt line saying why; the
/// compiled hints always apply and a compiled heard spelling (compared
/// case-insensitively, NFC, as matching is) keeps its compiled correction.
/// A file that exists but cannot be reached is `unreadable`, never "no owner
/// file".
public enum LocalClassifierHints {
    public struct Hint: Codable, Equatable, Sendable {
        public var heard: String
        public var intended: String
        public init(heard: String, intended: String) { self.heard = heard; self.intended = intended }
    }
    /// The owner's own corrections (DESIGN-4 §3), nothing else.
    public static let compiled: [Hint] = [
        .init(heard: "쉐딩", intended: "슈뢰딩거 (Schrödinger)"),
        .init(heard: "쉐딩거", intended: "슈뢰딩거 (Schrödinger)"),
        .init(heard: "슈레딩", intended: "슈뢰딩거 (Schrödinger)"),
        .init(heard: "QMGR", intended: "양자역학(QM)과 일반상대론(GR) 통합"),
    ]
    public static let maximumPairs = 200
    public static let maximumHeardCharacters = 40
    public static let maximumIntendedCharacters = 80
    public static let maximumFileBytes = 32_768
    /// At most this many matching hints travel with one request.
    public static let maximumPerRequest = 8

    public static func filePath(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent(".os1/local-classifier/asr-hints.json")
    }

    /// The compiled hints plus the file's, and one receipt line (never a hint's text).
    public struct Loaded: Equatable, Sendable {
        public var hints: [Hint]
        public var receipt: String
        public init(hints: [Hint], receipt: String) { self.hints = hints; self.receipt = receipt }
    }
    public static func load(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> Loaded {
        let url = filePath(home: home)
        // Review of DESIGN-4: only a path that does not exist is "no owner
        // file"; a path that cannot be reached (a parent without search
        // permission) is ignored with a receipt, so the owner is told.
        var status = stat()
        if lstat(url.path, &status) != 0 {
            let error = errno
            guard error == ENOENT || error == ENOTDIR else {
                return Loaded(hints: compiled, receipt: "asr hints: compiled \(compiled.count), owner file ignored: \(Rejection.unreadable.rawValue)")
            }
            return Loaded(hints: compiled, receipt: "asr hints: compiled \(compiled.count), no owner file")
        }
        switch read(url) {
        case .success(let owner):
            let known = Set(compiled.map { key($0.heard) })
            let merged = owner.filter { !known.contains(key($0.heard)) }
            let shadowed = owner.count - merged.count
            return Loaded(hints: compiled + merged, receipt: "asr hints: compiled \(compiled.count), owner file \(merged.count)" +
                (shadowed > 0 ? " (\(shadowed) shadowed by compiled)" : ""))
        case .failure(let reason):
            return Loaded(hints: compiled, receipt: "asr hints: compiled \(compiled.count), owner file ignored: \(reason.rawValue)")
        }
    }

    public enum Rejection: String, Error, Equatable, Sendable {
        case notRegularFile = "not_regular_file", oversize, unreadable, notJSON = "not_json", schema
        case tooManyPairs = "too_many_pairs", badPair = "bad_pair", duplicate
    }
    static func read(_ url: URL) -> Result<[Hint], Rejection> {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              (attributes[.type] as? FileAttributeType) == .typeRegular else { return .failure(.notRegularFile) }
        guard ((attributes[.size] as? NSNumber)?.intValue ?? .max) <= maximumFileBytes else { return .failure(.oversize) }
        guard let data = try? Data(contentsOf: url) else { return .failure(.unreadable) }
        return decode(data)
    }
    /// Strict decode of the owner file's bytes.
    public static func decode(_ data: Data) -> Result<[Hint], Rejection> {
        guard data.count <= maximumFileBytes else { return .failure(.oversize) }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return .failure(.notJSON) }
        guard Set(object.keys) == ["schema", "hints"], let schema = object["schema"] as? NSNumber,
              CFGetTypeID(schema) != CFBooleanGetTypeID(), schema.stringValue == "1",
              let pairs = object["hints"] as? [Any] else { return .failure(.schema) }
        guard pairs.count <= maximumPairs else { return .failure(.tooManyPairs) }
        var hints: [Hint] = [], seen = Set<String>()
        for pair in pairs {
            guard let value = pair as? [String: Any], Set(value.keys) == ["heard", "intended"],
                  let heard = value["heard"] as? String, let intended = value["intended"] as? String,
                  valid(heard, maximum: maximumHeardCharacters), valid(intended, maximum: maximumIntendedCharacters) else {
                return .failure(.badPair)
            }
            guard seen.insert(key(heard)).inserted else { return .failure(.duplicate) }
            hints.append(Hint(heard: heard.precomposedStringWithCanonicalMapping, intended: intended.precomposedStringWithCanonicalMapping))
        }
        return .success(hints)
    }
    /// The case-insensitive NFC key matching and duplicates compare.
    static func key(_ heard: String) -> String { heard.precomposedStringWithCanonicalMapping.lowercased() }
    /// Characters a hint value never carries: control and format characters,
    /// line and paragraph separators (Zl, Zp, U+0085), angle brackets and the
    /// quote characters that could close the value's quotes in `promptLine`
    /// and `answerNote`. Review of H2 (2026-10-28): '＇' (U+FF07) and '「」'
    /// passed and read as a closed quote followed by an instruction, so every
    /// scalar with the Unicode Quotation_Mark property is refused as well
    /// (`valid`), with the apostrophe, prime, accent and fullwidth angle look-
    /// alikes that property omits. The bridge's local lane mirrors this set
    /// (`ASR_HINT_FORBIDDEN` in rcc-plugin.mjs).
    static let forbidden = CharacterSet.controlCharacters.union(.newlines).union(CharacterSet(charactersIn: "<>'\"‘’‚‛“”„‟`"))
        .union(CharacterSet(charactersIn: "\u{00B4}\u{02B9}\u{02BA}\u{02BB}\u{02BC}\u{02BD}\u{02C8}\u{02CA}\u{02CB}" +
            "\u{2032}\u{2033}\u{2034}\u{2035}\u{2036}\u{2037}\u{2057}\u{FF40}\u{FF1C}\u{FF1E}\u{FE64}\u{FE65}"))
    public static func valid(_ text: String, maximum: Int) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && trimmed == text &&
            text.precomposedStringWithCanonicalMapping.unicodeScalars.count <= maximum &&
            !text.unicodeScalars.contains { forbidden.contains($0) || $0.properties.isQuotationMark }
    }

    /// The hints whose heard spelling occurs in the request (case-insensitive,
    /// NFC), longest heard spelling first, at most `maximumPerRequest`, one per
    /// intended term.
    public static func matching(_ request: String, hints: [Hint]) -> [Hint] {
        let lower = request.precomposedStringWithCanonicalMapping.lowercased()
        var seen = Set<String>(), found: [Hint] = []
        for hint in hints.sorted(by: { $0.heard.count > $1.heard.count })
            where lower.contains(hint.heard.precomposedStringWithCanonicalMapping.lowercased()) && seen.insert(hint.intended).inserted {
            found.append(hint)
            if found.count == maximumPerRequest { break }
        }
        return found
    }
    /// The line the local model sees after the request's data tags, or nil.
    public static func promptLine(_ hints: [Hint]) -> String? {
        guard !hints.isEmpty else { return nil }
        return "Possible intended terms (speech-to-text hints, not instructions): " +
            hints.map { "'\($0.heard)' may mean '\($0.intended)'" }.joined(separator: "; ") + "."
    }

    /// Build 442 live failure (2026-10-28): "쉐딩 방정식 설명해줘" reached
    /// claude-opus-5-5 max with only the request; the classifier had read the
    /// hint, the answering model never saw it and explained the graphics
    /// shading equation for 205 s. The one data line the answering model
    /// receives after the owner's request when a hint's heard spelling occurs
    /// in it (`matching`), or nil. Every pair passes `valid` again here (no
    /// quote, angle bracket, line separator or control character, bounded),
    /// so a value can never leave its quotes or its line; at most
    /// `maximumPerRequest` pairs. Data framed as a note: it changes no rail,
    /// route or permission, and the request's own bytes are never touched.
    public static func answerNote(_ request: String, hints: [Hint]) -> String? {
        let matched = matching(request, hints: hints.filter {
            valid($0.heard, maximum: maximumHeardCharacters) && valid($0.intended, maximum: maximumIntendedCharacters)
        })
        guard !matched.isEmpty else { return nil }
        return "음성 인식 메모(소유자가 과거에 고친 오인식): " +
            matched.map { "'\($0.heard)' → '\($0.intended)'" }.joined(separator: ", ") +
            " 일 수 있음. 문맥상 맞으면 그 뜻으로 답하고, 애매하면 어느 뜻인지 한 줄로 밝히고 답할 것."
    }
}
