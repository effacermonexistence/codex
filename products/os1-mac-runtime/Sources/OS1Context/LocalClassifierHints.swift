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
/// a heard spelling of at most 40 characters and an intended term of at most
/// 80, no control character, no angle bracket, no duplicate heard spelling,
/// no other key, at most 32 KiB. Anything invalid is ignored as a whole, with
/// a receipt line saying why; the compiled hints always apply.
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
        guard FileManager.default.fileExists(atPath: url.path) else {
            return Loaded(hints: compiled, receipt: "asr hints: compiled \(compiled.count), no owner file")
        }
        switch read(url) {
        case .success(let owner):
            let known = Set(compiled.map(\.heard))
            let merged = compiled + owner.filter { !known.contains($0.heard) }
            return Loaded(hints: merged, receipt: "asr hints: compiled \(compiled.count), owner file \(owner.count)")
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
            let key = heard.precomposedStringWithCanonicalMapping.lowercased()
            guard seen.insert(key).inserted else { return .failure(.duplicate) }
            hints.append(Hint(heard: heard.precomposedStringWithCanonicalMapping, intended: intended.precomposedStringWithCanonicalMapping))
        }
        return .success(hints)
    }
    public static func valid(_ text: String, maximum: Int) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        return !trimmed.isEmpty && trimmed == text && text.count <= maximum &&
            !text.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) || $0 == "<" || $0 == ">" }
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
}
