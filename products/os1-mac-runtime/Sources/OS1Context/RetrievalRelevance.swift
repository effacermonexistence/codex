import Foundation

/// Deterministic lexical relevance for generic archive retrieval.
///
/// This component deliberately does not guess synonyms or assign a semantic
/// score. `terms` removes bounded request grammar, and `accepts` requires every
/// remaining topic group to occur on an exact lexical boundary. Callers may
/// rank only candidates that pass this non-compensating gate.
public enum RetrievalRelevance {
    public static let maximumTerms = 16

    private static let latinStopWords: Set<String> = [
        "a", "about", "an", "and", "archive", "archives", "at", "bucket", "buckets",
        "check", "content", "contents", "data", "document", "documents", "fetch", "file", "files",
        "find", "for", "from", "get", "in", "item", "items", "latest", "load", "material", "materials",
        "object", "objects", "of", "omar", "on", "open", "or", "please", "private", "r2", "read",
        "retrieve", "search", "show", "source", "sources", "that", "the", "then", "there", "these",
        "this", "those", "to", "with",
    ]

    private static let koreanStopWords: Set<String> = [
        "가져", "가져오기", "가져온", "가져와", "가져와봐", "가져와줘", "검색", "검색해", "검색해봐", "검색해줘",
        "관련", "그러면", "그거", "그곳", "그럼", "거기", "거기서", "거기에서", "저기서", "꺼내", "꺼내줘", "내용", "다시", "대한", "대해서",
        "문서", "문서들", "버킷", "보여", "보여줘", "불러", "불러와", "불러줘", "비교", "비교해", "설명",
        "설명해", "설명해봐", "설명해줘", "소스", "아카이브", "알츠", "알투", "어디", "어디까지", "여기",
        "요약", "요약한", "요약해", "요약해줘", "원문", "있는", "자료", "자료들", "저기", "정리", "정리한", "정리해", "좀",
        "진행", "진행되는데", "찾아", "찾아봐", "찾아줘", "최신", "최신판", "통합하는", "파일", "파일들",
        "분석한", "비교한", "설명한",
        "확인", "확인해", "확인해줘", "해봐", "해줘",
    ]

    // Longest first. At most two suffixes are removed, and only when at least
    // two Hangul syllables remain. This handles ordinary case particles without
    // turning substring matching into an unbounded Korean stemmer.
    private static let koreanSuffixes = [
        "으로부터", "에서부터", "에게서", "한테서", "이라고", "이라고는", "이라도", "이랑", "으로", "에서",
        "에게", "한테", "부터", "까지", "처럼", "보다", "하고", "이며", "이고", "라고", "들", "은", "는",
        "이", "가", "을", "를", "과", "와", "랑", "도", "만", "의", "로",
    ]

    private static let spacedAcronymRegex = try! NSRegularExpression(
        pattern: #"(?<![A-Za-z0-9])(?:[A-Z][.\s]+){1,7}[A-Z]\.?(?![A-Za-z0-9])"#
    )
    private static let lexicalRegex = try! NSRegularExpression(pattern: #"[A-Za-z0-9]+|[가-힣]+"#)

    /// Extract bounded, ordered topic groups from a natural-language request.
    /// An overlong query fails closed with no terms rather than silently
    /// dropping a required topic.
    public static func terms(prompt: String) -> [String] {
        let folded = foldSpacedAcronyms(prompt.precomposedStringWithCanonicalMapping)
        let ns = folded as NSString
        let matches = lexicalRegex.matches(in: folded, range: NSRange(location: 0, length: ns.length))
        var result: [String] = []
        var seen = Set<String>()

        for match in matches {
            let raw = ns.substring(with: match.range)
            let term: String?
            if raw.unicodeScalars.allSatisfy({ isHangul($0) }) {
                let original = raw.lowercased()
                let normalized = normalizeHangul(original)
                term = !koreanStopWords.contains(original) &&
                    !koreanStopWords.contains(normalized) &&
                    !koreanSuffixes.contains(normalized) &&
                    normalized.count >= 2 ? normalized : nil
            } else {
                let normalized = raw.lowercased()
                let meaningful = normalized.count >= 2 &&
                    normalized.rangeOfCharacter(from: .letters) != nil &&
                    !latinStopWords.contains(normalized)
                term = meaningful ? normalized : nil
            }
            if let term, seen.insert(term).inserted { result.append(term) }
        }

        return result.count <= maximumTerms ? result : []
    }

    /// True only when every supplied topic group is present in the path or
    /// content. A frequent term cannot compensate for a missing term.
    public static func accepts(path: String, text: String, terms: [String]) -> Bool {
        guard !terms.isEmpty, terms.count <= maximumTerms else { return false }
        let haystack = lexemes(in: path + "\n" + text)
        guard !haystack.isEmpty else { return false }
        return terms.allSatisfy { term in
            let required = lexemes(in: term)
            return !required.isEmpty && contains(required, in: haystack)
        }
    }

    /// Apply this after excerpt construction. A candidate may be relevant as a
    /// whole while a short excerpt omits one required topic; such an excerpt is
    /// not adequate evidence and must not be selected.
    public static func snippetCoversAll(_ snippet: String, terms: [String]) -> Bool {
        accepts(path: "", text: snippet, terms: terms)
    }

    /// Boundary-aware helper for a single token or a contiguous multiword
    /// phrase. For example, `gr` matches `GR` but not `program`, and
    /// `general relativity` matches the same phrase across punctuation.
    public static func matches(term: String, in value: String) -> Bool {
        let required = lexemes(in: term)
        return !required.isEmpty && contains(required, in: lexemes(in: value))
    }

    private static func foldSpacedAcronyms(_ value: String) -> String {
        let mutable = NSMutableString(string: value)
        let matches = spacedAcronymRegex.matches(
            in: value,
            range: NSRange(location: 0, length: (value as NSString).length)
        )
        for match in matches.reversed() {
            let original = mutable.substring(with: match.range)
            let compact = original.unicodeScalars.filter { scalar in
                (65...90).contains(scalar.value)
            }.map(String.init).joined().lowercased()
            mutable.replaceCharacters(in: match.range, with: compact)
        }
        return mutable as String
    }

    private static func lexemes(in value: String) -> [String] {
        let normalized = foldSpacedAcronyms(value.precomposedStringWithCanonicalMapping)
        let ns = normalized as NSString
        return lexicalRegex.matches(
            in: normalized,
            range: NSRange(location: 0, length: ns.length)
        ).compactMap { match in
            let raw = ns.substring(with: match.range)
            if raw.unicodeScalars.allSatisfy({ isHangul($0) }) {
                let token = normalizeHangul(raw)
                return token.isEmpty ? nil : token
            }
            return raw.lowercased()
        }
    }

    private static func contains(_ required: [String], in haystack: [String]) -> Bool {
        guard !required.isEmpty, required.count <= haystack.count else { return false }
        if required.count == 1 { return haystack.contains(required[0]) }
        for start in 0...(haystack.count - required.count) {
            if Array(haystack[start..<(start + required.count)]) == required { return true }
        }
        return false
    }

    private static func normalizeHangul(_ value: String) -> String {
        var result = value.lowercased()
        for _ in 0..<2 {
            guard let suffix = koreanSuffixes.first(where: { candidate in
                guard result.hasSuffix(candidate) else { return false }
                let stem = result.dropLast(candidate.count)
                return stem.count >= 2
            }) else { break }
            result.removeLast(suffix.count)
        }
        return result
    }

    private static func isHangul(_ scalar: UnicodeScalar) -> Bool {
        (0xAC00...0xD7A3).contains(scalar.value)
    }
}
