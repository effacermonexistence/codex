import Foundation

/// OS-1 sends backends a bounded projection of the owner's policy instead of
/// the whole original (LeanBackendInstructions). The projection cannot carry
/// every locally defined term, and a backend asked about one tends to answer
/// from the generic meaning or call the term undefined, even with a pointer
/// to the original (2026-09-30 evaluation, request "P1"). This quotes the
/// original's own definition of each owner term the request uses and the
/// projection does not cover. Nothing is attached for a request without such
/// a term, so ordinary tasks pay nothing.
public enum OwnerTermDefinitions {
    public static let excerptCharacters = 5_000
    public static let maximumCharacters = 12_000
    public static let maximumExcerpts = 3
    /// How far above a definition its section heading is looked for.
    static let headingSearchLines = 2_000

    public struct Excerpt: Equatable, Sendable {
        public let heading: String
        public let line: Int
        public let terms: [String]
        public let text: String
    }

    /// The instruction block for `prompt`, or "" when it uses no uncovered owner term.
    public static func directive(prompt: String, source: String, covered: String) -> String {
        let found = excerpts(prompt: prompt, source: source, covered: covered)
        guard !found.isEmpty else { return "" }
        let blocks = found.map { excerpt in
            "[EXACT SOURCE EXCERPT: \(excerpt.heading); source line \(excerpt.line); terms: \(excerpt.terms.joined(separator: ", "))]\n\(excerpt.text)"
        }
        return """

        Owner definitions for terms in this request (exact excerpts from the owner's original policy). \
        These local meanings outrank generic or textbook usage of the same words; answer with them, \
        and do not describe these terms as undefined:
        \(blocks.joined(separator: "\n\n"))
        """
    }

    public static func excerpts(prompt: String, source: String, covered: String) -> [Excerpt] {
        let terms = candidateTerms(in: prompt).filter { !containsWord($0, in: covered) }
        guard !terms.isEmpty else { return [] }
        let lines = source.components(separatedBy: "\n")
        let index = SourceIndex(source)
        // `label` is the section heading when the excerpt starts at it,
        // otherwise the defining line itself (never a heading far above).
        var picked: [(label: Int, start: Int, end: Int, terms: [String], text: String)] = []
        var used = 0
        for term in terms {
            guard let position = firstDefiningLine(of: term, lines: lines, index: index) else { continue }
            if let index = picked.firstIndex(where: { $0.start <= position && position < $0.end }) {
                picked[index].terms.append(term)
                continue
            }
            guard picked.count < maximumExcerpts else { continue }
            let (heading, start, end, text) = excerpt(around: position, lines: lines)
            guard used + text.count <= maximumCharacters else { continue }
            used += text.count
            picked.append((heading == start ? heading : position, start, end, [term], text))
        }
        return picked.map { entry in
            Excerpt(heading: String(lines[entry.label].trimmingCharacters(in: .whitespaces).prefix(120)),
                    line: entry.start + 1, terms: entry.terms, text: entry.text)
        }
    }

    /// Owner-coined identifiers: snake_case, hyphenated compounds and
    /// capitalized acronyms or phrases. Ordinary words never qualify.
    public static func candidateTerms(in prompt: String) -> [String] {
        let range = NSRange(prompt.startIndex..., in: prompt)
        var terms: [String] = []
        var phraseRanges: [NSRange] = []
        func add(_ pattern: String, skipInsidePhrases: Bool = false, isPhrase: Bool = false) {
            guard let expression = try? NSRegularExpression(pattern: pattern) else { return }
            for match in expression.matches(in: prompt, range: range) {
                if skipInsidePhrases, phraseRanges.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) { continue }
                guard let found = Range(match.range, in: prompt) else { continue }
                let term = String(prompt[found]).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                if isPhrase { phraseRanges.append(match.range) }
                if !terms.contains(where: { $0.caseInsensitiveCompare(term) == .orderedSame }) { terms.append(term) }
            }
        }
        add(#"(?<![A-Za-z0-9_])[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?![A-Za-z0-9_])"#)
        add(#"(?<![A-Za-z0-9-])[A-Za-z]{2,}(?:-[A-Za-z]{2,})+(?![A-Za-z0-9-])"#)
        add(#"(?<![A-Za-z0-9])[A-Z][A-Z0-9]{2,}(?:[ \t]+[A-Z][A-Z0-9]{2,}){1,5}(?![A-Za-z0-9])"#, isPhrase: true)
        add(#"(?<![A-Za-z0-9])[A-Z][A-Z0-9]{2,9}(?![A-Za-z0-9])"#, skipInsidePhrases: true)
        return terms
    }

    /// Case-insensitive ASCII occurrence search over the original's bytes.
    struct SourceIndex {
        let bytes: [UInt8]
        let lineStarts: [Int]
        init(_ source: String) {
            bytes = Array(source.utf8)
            var starts = [0]
            for (offset, byte) in bytes.enumerated() where byte == 10 { starts.append(offset + 1) }
            lineStarts = starts
        }
        static func folded(_ byte: UInt8) -> UInt8 { byte >= 65 && byte <= 90 ? byte + 32 : byte }
        static func isWordByte(_ byte: UInt8) -> Bool {
            byte == 95 || (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)
        }
        /// Lines holding `term` as a whole word, in source order.
        func lines(containing term: String) -> [Int] {
            let needle = Array(term.utf8).map(Self.folded)
            guard let first = needle.first, needle.count <= bytes.count else { return [] }
            var found: [Int] = []
            var offset = 0
            let last = bytes.count - needle.count
            while offset <= last {
                if Self.folded(bytes[offset]) == first {
                    var matched = true
                    for step in 1..<max(needle.count, 1) where Self.folded(bytes[offset + step]) != needle[step] { matched = false; break }
                    let before = offset == 0 ? nil : bytes[offset - 1]
                    let after = offset + needle.count < bytes.count ? bytes[offset + needle.count] : nil
                    if matched, !(before.map(Self.isWordByte) ?? false), !(after.map(Self.isWordByte) ?? false) {
                        var low = 0, high = lineStarts.count - 1
                        while low < high {
                            let middle = (low + high + 1) / 2
                            if lineStarts[middle] <= offset { low = middle } else { high = middle - 1 }
                        }
                        if found.last != low { found.append(low) }
                    }
                }
                offset += 1
            }
            return found
        }
    }

    /// The earliest line that defines `term`: a heading naming it, a label
    /// line such as "term:", "term = …" or "Term law:", or the term alone on
    /// a line followed by its "Definition:".
    static func firstDefiningLine(of term: String, lines: [String], index: SourceIndex) -> Int? {
        for line in index.lines(containing: term) where line < lines.count {
            if isDefinitionLabel(lines[line], term: term) || isHeading(line, lines: lines)
                || introducesDefinition(line, term: term, lines: lines) { return line }
        }
        return nil
    }

    static func introducesDefinition(_ index: Int, term: String, lines: [String]) -> Bool {
        guard lines[index].trimmingCharacters(in: .whitespaces).caseInsensitiveCompare(term) == .orderedSame else { return false }
        let following = lines[(index + 1)...].prefix(4).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return following.first?.lowercased().hasPrefix("definition") == true
    }

    static func isDefinitionLabel(_ line: String, term: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.count <= 200, let found = trimmed.range(of: term, options: [.caseInsensitive, .anchored]) else { return false }
        let rest = String(trimmed[found.upperBound...])
        if let next = rest.unicodeScalars.first, isWordScalar(next) { return false }
        return rest.range(of: #"^(\s*\([^)]{0,80}\))?(\s+[A-Za-z][A-Za-z0-9-]*){0,3}\s*(:|=|—|–|\s-\s)"#,
                          options: .regularExpression) != nil
    }

    static func isSeparator(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return trimmed.count >= 10 && trimmed.allSatisfy { "=-─━_".contains($0) }
    }

    static func isHeading(_ index: Int, lines: [String]) -> Bool {
        let trimmed = lines[index].trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.count <= 120, !isSeparator(trimmed) else { return false }
        let letters = trimmed.unicodeScalars.filter { $0.isASCII && CharacterSet.letters.contains($0) }
        let upper = letters.isEmpty ? 0 : Double(letters.filter { CharacterSet.uppercaseLetters.contains($0) }.count) / Double(letters.count)
        // A title between or above rule lines; a section's last sentence
        // before the next title's rule line is not a heading.
        if (index > 0 && isSeparator(lines[index - 1])) || (index + 1 < lines.count && isSeparator(lines[index + 1])) {
            return upper >= 0.6
        }
        if trimmed.range(of: #"^(PART|ADDENDUM)\s+[0-9IVX]+[A-Z]?\b"#, options: .regularExpression) != nil { return upper >= 0.6 }
        if trimmed.count >= 8, trimmed.range(of: #"^\d+(\.\d+)*\.?\s+[A-Z]"#, options: .regularExpression) != nil { return upper >= 0.8 }
        return false
    }

    /// The defining section from its heading to the next heading, bounded to
    /// `excerptCharacters` and ending on a whole line. A definition deep inside
    /// a long section is quoted from a few lines above itself instead.
    static func excerpt(around position: Int, lines: [String]) -> (heading: Int, start: Int, end: Int, text: String) {
        var heading = position
        var probe = position
        while probe >= 0 && position - probe < headingSearchLines {
            if isHeading(probe, lines: lines) { heading = probe; break }
            probe -= 1
        }
        var start = heading
        let offset = lines[heading..<position].reduce(0) { $0 + $1.count + 1 }
        if offset > excerptCharacters - 1_500 { start = max(heading, position - 15) }
        var end = start, size = 0
        while end < lines.count, size + lines[end].count + 1 <= excerptCharacters {
            if end > max(start, position), isHeading(end, lines: lines) { break }
            size += lines[end].count + 1
            end += 1
        }
        if end <= position { end = min(lines.count, position + 1) }
        var kept = Array(lines[start..<end])
        while let last = kept.last, kept.count > 1,
              last.trimmingCharacters(in: .whitespaces).isEmpty || isSeparator(last) { kept.removeLast() }
        let text = kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return (heading, start, end, String(text.prefix(excerptCharacters)))
    }

    static func containsWord(_ term: String, in text: String) -> Bool {
        var searchRange = text.startIndex..<text.endIndex
        while let found = text.range(of: term, options: .caseInsensitive, range: searchRange) {
            let before = found.lowerBound == text.startIndex ? nil : text.unicodeScalars[text.unicodeScalars.index(before: found.lowerBound)]
            let after = found.upperBound == text.endIndex ? nil : text.unicodeScalars[found.upperBound]
            if !(before.map(isWordScalar) ?? false) && !(after.map(isWordScalar) ?? false) { return true }
            searchRange = found.upperBound..<text.endIndex
        }
        return false
    }

    static func isWordScalar(_ scalar: Unicode.Scalar) -> Bool {
        scalar == "_" || (scalar.isASCII && CharacterSet.alphanumerics.contains(scalar))
    }
}
