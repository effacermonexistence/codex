import AppKit
import Foundation

/// Native attributed text, never HTML/web content. One text storage keeps selection
/// continuous across answers, questions, code, and execution details.
enum TranscriptMarkdown {
    static let ink = NSColor.white.withAlphaComponent(0.94)
    static let accent = NSColor(calibratedRed: 0.93, green: 0.70, blue: 0.80, alpha: 1)
    static let separator = "\n"

    static func render(_ source: String, key: String, expanded: Set<String> = [], expandAll: Bool = false) -> NSAttributedString {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        let result = NSMutableAttributedString()
        var index = 0, block = 0
        func append(_ value: NSAttributedString, before: CGFloat = 0, after: CGFloat = 5, indent: CGFloat = 0) {
            let paragraph = NSMutableParagraphStyle()
            paragraph.lineSpacing = 4
            paragraph.paragraphSpacingBefore = before
            paragraph.paragraphSpacing = after
            paragraph.headIndent = indent
            let text = NSMutableAttributedString(attributedString: value)
            text.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: text.length))
            result.append(text)
            result.append(NSAttributedString(string: separator, attributes: [
                .font: value.length > 0 ? (value.attribute(.font, at: value.length - 1, effectiveRange: nil) as? NSFont ?? .systemFont(ofSize: 14)) : NSFont.systemFont(ofSize: 7),
                .paragraphStyle: paragraph
            ]))
        }
        while index < lines.count {
            let line = lines[index], trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed == "$$" || trimmed == #"\["# {
                let close = trimmed == "$$" ? "$$" : #"\]"#
                if let end = ((index + 1)..<lines.count).first(where: { lines[$0].trimmingCharacters(in: .whitespaces) == close }) {
                    append(MathTypesetter.render(lines[index...end].joined(separator: "\n"), display: true))
                    index = end + 1; continue
                }
            }
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                let fence = String(trimmed.prefix(3)), language = String(trimmed.dropFirst(3))
                index += 1
                var code: [String] = []
                while index < lines.count && !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
                    code.append(lines[index]); index += 1
                }
                let token = "\(key)-code-\(block)"; block += 1
                let long = code.count > 12 || code.joined().count > 1800
                let show = expandAll || expanded.contains(token) || !long
                let label = language.isEmpty ? "코드" : language.uppercased()
                append(long ? detailLink("\(label) · \(code.count)줄 · \(show ? "접기" : "펼쳐보기")", key: token)
                    : NSAttributedString(string: label, attributes: [.font: NSFont.systemFont(ofSize: 10, weight: .semibold), .foregroundColor: accent]))
                if show {
                    append(NSAttributedString(string: code.joined(separator: separator), attributes: [
                        .font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular),
                        .foregroundColor: ink, .backgroundColor: NSColor.white.withAlphaComponent(0.065)
                    ]))
                }
                index += 1; continue
            }
            // A real text table stays in the same selectable text storage.
            if trimmed.hasPrefix("|"), index + 1 < lines.count,
               lines[index + 1].range(of: #"^\s*\|?\s*:?-{3,}"#, options: .regularExpression) != nil {
                var rows: [[String]] = []
                while index < lines.count && lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("|") {
                    if lines[index].range(of: #"^\s*\|[\s:|\-]+\|?\s*$"#, options: .regularExpression) == nil {
                        rows.append(lines[index].trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "|")).components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) })
                    }
                    index += 1
                }
                result.append(table(rows))
                append(NSAttributedString(string: ""))
                continue
            }
            if let range = trimmed.range(of: #"^#{1,6}\s+"#, options: .regularExpression) {
                let level = trimmed[range].filter { $0 == "#" }.count
                append(inline(String(trimmed[range.upperBound...]), font: .systemFont(ofSize: level <= 2 ? 18 : 16, weight: .semibold)), before: 10, after: 7)
            } else if ["---", "***", "___"].contains(trimmed) {
                append(NSAttributedString(string: "────────────────────", attributes: [.foregroundColor: NSColor.white.withAlphaComponent(0.2)]))
            } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") || trimmed.hasPrefix("+ ") {
                append(inline("• " + String(trimmed.dropFirst(2))), after: 3, indent: 15)
            } else if trimmed.hasPrefix("> ") {
                append(inline("│ " + String(trimmed.dropFirst(2))))
            } else if trimmed.isEmpty {
                // Keep the newline in the selectable document (including
                // partial-copy), but not a full-height body-text blank row.
                let space = NSMutableParagraphStyle()
                space.minimumLineHeight = 3; space.maximumLineHeight = 3
                result.append(NSAttributedString(string: "\n", attributes: [
                    .font: NSFont.systemFont(ofSize: 3), .paragraphStyle: space
                ]))
            } else {
                let numbered = trimmed.range(of: #"^\d+[.)]\s"#, options: .regularExpression) != nil
                append(inline(line), after: numbered ? 4 : 5, indent: numbered ? 20 : 0)
            }
            index += 1
        }
        if result.length > 0 { result.deleteCharacters(in: NSRange(location: result.length - 1, length: 1)) }
        return result
    }

    private static func table(_ rows: [[String]]) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let columns = rows.map(\.count).max() ?? 0
        guard columns > 0 else { return result }
        // Dense schema matrices are unreadable as four tiny columns on a
        // laptop. Keep every cell, but present each record with its column
        // labels in the same selectable text document. Ordinary comparison
        // tables retain their real table layout.
        let identifiers = rows.flatMap { $0 }.filter { $0.range(of: #"[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){2,}"#, options: .regularExpression) != nil }.count
        if columns >= 4, rows.count >= 5, identifiers >= rows.count {
            for row in rows.dropFirst() {
                for column in 0..<columns {
                    let value = column < row.count ? row[column] : ""
                    let heading = column < rows[0].count ? rows[0][column] : "항목 \(column + 1)"
                    let label = column == 0 ? "" : "\(heading): "
                    let cell = NSMutableAttributedString(attributedString: inline(label + value,
                        font: .systemFont(ofSize: column == 0 ? 14 : 13, weight: column == 0 ? .semibold : .regular)))
                    cell.removeAttribute(.backgroundColor, range: NSRange(location: 0, length: cell.length))
                    cell.append(NSAttributedString(string: "\n"))
                    let style = NSMutableParagraphStyle()
                    style.lineSpacing = 3
                    style.paragraphSpacingBefore = column == 0 ? 12 : 0
                    style.paragraphSpacing = column == columns - 1 ? 8 : 3
                    cell.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: cell.length))
                    result.append(cell)
                }
            }
            return result
        }
        let table = NSTextTable()
        table.numberOfColumns = columns
        table.layoutAlgorithm = .fixedLayoutAlgorithm
        table.collapsesBorders = true
        // Keep the outer half-point border inside the text container's clip.
        table.setContentWidth(99.5, type: .percentageValueType)
        for (rowIndex, row) in rows.enumerated() {
            for column in 0..<columns {
                let cell = NSTextTableBlock(table: table, startingRow: rowIndex, rowSpan: 1, startingColumn: column, columnSpan: 1)
                cell.setContentWidth(100 / CGFloat(columns), type: .percentageValueType)
                cell.setWidth(8, type: .absoluteValueType, for: .padding)
                cell.setWidth(0, type: .absoluteValueType, for: .margin)
                cell.setWidth(0.5, type: .absoluteValueType, for: .border)
                cell.setBorderColor(NSColor.white.withAlphaComponent(0.12))
                cell.backgroundColor = rowIndex == 0 ? NSColor(white: 0.055, alpha: 1) : .black
                cell.verticalAlignment = .topAlignment
                let paragraph = NSMutableParagraphStyle()
                paragraph.textBlocks = [cell]
                paragraph.lineSpacing = 3
                paragraph.paragraphSpacing = 0
                paragraph.paragraphSpacingBefore = 0
                let font = NSFont.systemFont(ofSize: 13, weight: rowIndex == 0 ? .semibold : .regular)
                let content = NSMutableAttributedString(attributedString: inline(column < row.count ? row[column] : "", font: font))
                // The table already groups code identifiers. Painting another
                // background behind every wrapped token creates a noisy grid.
                content.removeAttribute(.backgroundColor, range: NSRange(location: 0, length: content.length))
                content.append(NSAttributedString(string: "\n", attributes: [.font: font]))
                content.addAttribute(.paragraphStyle, value: paragraph, range: NSRange(location: 0, length: content.length))
                result.append(content)
            }
        }
        return result
    }

    static func detailLink(_ label: String, key: String) -> NSAttributedString {
        NSAttributedString(string: label, attributes: [
            .font: NSFont.systemFont(ofSize: 11, weight: .medium), .foregroundColor: accent,
            .link: URL(string: "os1-detail://toggle/\(key)")!
        ])
    }

    static func inline(_ text: String, font: NSFont = .systemFont(ofSize: 14)) -> NSAttributedString {
        let ns = text as NSString
        // Protect math before parsing Markdown; code spans remain literal and
        // emphasis may span code/math without splitting the parser's context.
        let regex = try! NSRegularExpression(pattern: #"`[^`]*`|(?<!\\)\$\$[^$]+\$\$|(?<![\\$])\$(?!\s)(?:\\.|[^$\n])+?(?<!\s)\$(?!\$)|\\\(.+?\\\)|\\\[.+?\\\]"#)
        let protected = NSMutableString(string: text)
        var formulas: [(String, String)] = []
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).reversed() {
            let token = ns.substring(with: match.range)
            if token.hasPrefix("`") { continue }
            let placeholder = "OS1MATH\(nonce)X\(formulas.count)END"
            protected.replaceCharacters(in: match.range, with: placeholder)
            formulas.append((placeholder, token))
        }
        let output = NSMutableAttributedString(attributedString: formattedInline(protected as String, font: font))
        for (placeholder, token) in formulas {
            let range = (output.string as NSString).range(of: placeholder)
            if range.location != NSNotFound {
                output.replaceCharacters(in: range, with: MathTypesetter.render(token, display: token.hasPrefix("$$") || token.hasPrefix(#"\["#)))
            }
        }
        return output
    }

    private static func formattedInline(_ text: String, font: NSFont) -> NSAttributedString {
        let result = NSMutableAttributedString()
        let base: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: ink]
        // Model output often closes bold quotes immediately before a Korean
        // particle (**"결론"**입니다). Make delimiter boundaries unambiguous
        // without adding visible spaces or changing literal code/source bytes.
        let boundary = ["\u{2009}", "\u{2002}", "\u{2003}"].first { !text.contains($0) }
        let prepared = NSMutableString(string: text)
        if let boundary {
            let bold = try! NSRegularExpression(pattern: #"`[^`]*`|\*\*[^\n]+?\*\*"#)
            for match in bold.matches(in: text, range: NSRange(location: 0, length: prepared.length)).reversed() {
                let token = (text as NSString).substring(with: match.range)
                if token.hasPrefix("**") { prepared.replaceCharacters(in: match.range, with: boundary + token + boundary) }
            }
        }
        guard let parsed = try? AttributedString(markdown: prepared as String, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) else {
            return NSAttributedString(string: text, attributes: base)
        }
        for run in parsed.runs {
            var attributes = base
            let intent = run.inlinePresentationIntent ?? []
            let bold = intent.contains(.stronglyEmphasized)
            var runFont = bold ? NSFont.systemFont(ofSize: font.pointSize, weight: .semibold) : font
            if intent.contains(.code) {
                runFont = NSFont.monospacedSystemFont(ofSize: max(11, font.pointSize - 1), weight: bold ? .semibold : .regular)
                attributes[.backgroundColor] = NSColor.white.withAlphaComponent(0.075)
            }
            if intent.contains(.emphasized) { runFont = NSFontManager.shared.convert(runFont, toHaveTrait: .italicFontMask) }
            attributes[.font] = runFont
            if intent.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
            if let url = run.link, ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                attributes[.link] = url; attributes[.foregroundColor] = accent
            }
            let value = String(parsed[run.range].characters)
            result.append(NSAttributedString(string: boundary.map { value.replacingOccurrences(of: $0, with: "") } ?? value, attributes: attributes))
        }
        return result
    }
}
