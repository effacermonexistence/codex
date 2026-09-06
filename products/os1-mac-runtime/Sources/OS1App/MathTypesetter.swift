import AppKit
import SwiftMath

extension NSAttributedString.Key {
    static let os1MathSource = NSAttributedString.Key("os1.math.source")
}

/// Offline TeX typesetting inside the single, selectable native transcript.
enum MathTypesetter {
    nonisolated(unsafe) private static let cache: NSCache<NSString, NSImage> = {
        let result = NSCache<NSString, NSImage>(); result.countLimit = 256
        result.totalCostLimit = 32 * 1024 * 1024; return result
    }()

    static func render(_ source: String, display: Bool = false) -> NSAttributedString {
        let trim = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let delimiters = [("$$", "$$"), (#"\["#, #"\]"#), (#"\("#, #"\)"#), ("$", "$")]
        guard let pair = delimiters.first(where: { trim.hasPrefix($0.0) && trim.hasSuffix($0.1) }),
              trim.count > pair.0.count + pair.1.count else { return fallback(source) }
        let latex = String(trim.dropFirst(pair.0.count).dropLast(pair.1.count))
        // The renderer is data-only. Limit work/depth and preserve unsupported input.
        guard latex.utf8.count <= 4096 else { return fallback(source) }
        var depth = 0
        for c in latex {
            if c == "{" { depth += 1 }; if c == "}" { depth -= 1 }
            if depth > 24 || depth < 0 { return fallback(source) }
        }
        guard depth == 0 else { return fallback(source) }
        if containsCJK(latex) { return multilingual(latex, source: source, display: display) }
        // SwiftMath 1.7 does not parse LaTeX's standard \operatorname command.
        // Normalize bounded plain names only; copyable text remains bound to
        // `source` below and therefore preserves the original TeX.
        let renderLatex = latex.replacingOccurrences(
            of: #"\\operatorname\{([A-Za-z]{1,64})\}"#,
            with: #"\\mathrm{$1}"#,
            options: .regularExpression)
        let size: CGFloat = display ? 18 : 15
        let key = "\(size):\(renderLatex)" as NSString
        let image: NSImage
        if let cached = cache.object(forKey: key) { image = cached }
        else {
            let result = MTMathImage(latex: renderLatex, fontSize: size, textColor: .white,
                labelMode: display ? .display : .text, textAlignment: .left).asImage()
            guard result.0 == nil, let rendered = result.1, rendered.size.width.isFinite,
                  rendered.size.height.isFinite, rendered.size.width > 0, rendered.size.width < 6000,
                  rendered.size.height > 0, rendered.size.height < 1500 else { return fallback(source) }
            image = rendered; cache.setObject(image, forKey: key, cost: Int(image.size.width * image.size.height * 16))
        }
        let attachment = NSTextAttachment()
        attachment.image = image
        let ratio = min(1, 850 / image.size.width)
        attachment.bounds = NSRect(x: 0, y: -3, width: image.size.width * ratio, height: image.size.height * ratio)
        let output = NSMutableAttributedString(attachment: attachment)
        output.addAttribute(.os1MathSource, value: source, range: NSRange(location: 0, length: output.length))
        output.addAttribute(.toolTip, value: source, range: NSRange(location: 0, length: output.length))
        return output
    }

    private static func containsCJK(_ value: String) -> Bool {
        value.range(of: "[\\u1100-\\u11ff\\u2e80-\\ua4cf\\uac00-\\ud7af\\uf900-\\ufaff]", options: .regularExpression) != nil
    }

    /// The bundled math font has no Korean/CJK glyphs. Keep top-level TeX text
    /// in the system font instead of accepting a successful but blank image.
    private static func multilingual(_ latex: String, source: String, display: Bool) -> NSAttributedString {
        guard latex.range(of: #"\\(?:begin|end|left|right)\b"#, options: .regularExpression) == nil else {
            return fallback(source)
        }
        let text = latex as NSString
        let expression = try! NSRegularExpression(pattern: #"\\(?:text|textrm|mbox)\{([^{}]*)\}"#)
        // ASCII text inside scripts remains with SwiftMath. Only split CJK
        // text; an earlier J_{\text{exec}} must not block a later Korean label.
        let matches = expression.matches(in: latex, range: NSRange(location: 0, length: text.length))
            .filter { containsCJK(text.substring(with: $0.range(at: 1))) }
        guard !matches.isEmpty else { return fallback(source) }
        let braces = try! NSRegularExpression(pattern: #"(?<!\\)[{}]"#)
        let output = NSMutableAttributedString()
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: display ? 18 : 15), .foregroundColor: NSColor.white,
        ]
        func appendMath(_ range: NSRange) -> Bool {
            let chunk = text.substring(with: range)
            guard !containsCJK(chunk) else { return false }
            let nonSpacing = chunk.replacingOccurrences(of: #"\\(?:qquad|quad|,|;|!| )"#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if nonSpacing.isEmpty {
                if !chunk.isEmpty { output.append(NSAttributedString(string: "  ", attributes: attributes)) }
            } else { output.append(render("$" + chunk + "$", display: display)) }
            return true
        }
        var offset = 0
        for match in matches {
            let depth = braces.matches(in: latex, range: NSRange(location: 0, length: match.range.location))
                .reduce(0) { $0 + (text.substring(with: $1.range) == "{" ? 1 : -1) }
            // Splitting inside fractions/scripts would change the expression.
            let preceding = text.substring(to: match.range.location).trimmingCharacters(in: .whitespacesAndNewlines).last
            guard depth == 0, preceding != "^", preceding != "_",
                  appendMath(NSRange(location: offset, length: match.range.location - offset)) else {
                return fallback(source)
            }
            output.append(NSAttributedString(string: text.substring(with: match.range(at: 1)), attributes: attributes))
            offset = NSMaxRange(match.range)
        }
        guard appendMath(NSRange(location: offset, length: text.length - offset)) else { return fallback(source) }
        output.addAttribute(.os1MathSource, value: source, range: NSRange(location: 0, length: output.length))
        output.addAttribute(.toolTip, value: source, range: NSRange(location: 0, length: output.length))
        return output
    }

    static func fallback(_ source: String) -> NSAttributedString {
        NSAttributedString(string: source, attributes: [.font: NSFont.monospacedSystemFont(ofSize: 13, weight: .regular),
            .foregroundColor: NSColor.white, .toolTip: "지원되지 않는 수식 형식입니다. 원문을 그대로 보존했습니다."])
    }

    static func copyable(_ value: NSAttributedString) -> String {
        let copy = NSMutableAttributedString(attributedString: value)
        value.enumerateAttribute(.os1MathSource, in: NSRange(location: 0, length: value.length), options: .reverse) { source, range, _ in
            if let source = source as? String { copy.replaceCharacters(in: range, with: source) }
        }
        return copy.string.replacingOccurrences(of: "\u{2028}", with: "\n")
    }
}
