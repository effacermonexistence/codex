import Foundation

/// Files the owner attached to a request. The app appends them to the text
/// as a quoted-path block (`참조 파일 경로:` + one JSON string per line) so the
/// request stays a plain string everywhere; the runtime turns the image
/// entries back into real image inputs for the backend, and the app draws
/// them inline. Paths are data: nothing here reads or executes them.
public enum PromptAttachments {
    public static let marker = "참조 파일 경로:"
    public static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "tif", "bmp"]

    /// Absolute file paths quoted in the reference block, in order.
    public static func paths(in text: String) -> [String] {
        guard let range = text.range(of: marker) else { return [] }
        var found: [String] = []
        for rawLine in text[range.upperBound...].split(separator: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("\""), line.hasSuffix("\""),
                  let path = try? JSONDecoder().decode(String.self, from: Data(line.utf8)),
                  path.hasPrefix("/"), path.count <= 1_024 else { continue }
            if !found.contains(path) { found.append(path) }
        }
        return found
    }

    public static func isImagePath(_ path: String) -> Bool {
        imageExtensions.contains(URL(fileURLWithPath: path).pathExtension.lowercased())
    }

    public static func imagePaths(in text: String) -> [String] {
        paths(in: text).filter(isImagePath)
    }

    /// The owner's words without the reference block (for display beside the
    /// inline previews; the block itself stays in the stored message).
    public static func textWithoutReferences(_ text: String) -> String {
        guard let range = text.range(of: marker) else { return text }
        return String(text[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
