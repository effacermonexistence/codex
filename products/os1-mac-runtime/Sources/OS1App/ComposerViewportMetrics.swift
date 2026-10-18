import AppKit

/// The draft remains authoritative and untouched. This helper sizes only the
/// visible editor viewport, whose height already saturates at 160 points.
/// Iterate a fixed UTF-8 budget, never Character/count/full-string layout.
enum ComposerViewportMetrics {
    static let minimumHeight: CGFloat = 48
    static let maximumHeight: CGFloat = 160
    static let measurementUTF8Limit = 2_048

    static func boundedMeasurementText(_ draft: String) -> String? {
        var iterator = draft.utf8.makeIterator()
        var bytes: [UInt8] = []
        bytes.reserveCapacity(measurementUTF8Limit)
        for _ in 0..<measurementUTF8Limit {
            guard let byte = iterator.next() else {
                return String(decoding: bytes, as: UTF8.self) + " "
            }
            bytes.append(byte)
        }
        guard iterator.next() == nil else { return nil }
        return String(decoding: bytes, as: UTF8.self) + " "
    }

    static func height(for draft: String, editorWidth: CGFloat) -> CGFloat {
        guard let text = boundedMeasurementText(draft) else { return maximumHeight }
        let bounds = (text as NSString).boundingRect(
            with: NSSize(width: max(40, editorWidth - 16), height: maximumHeight - 24),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: NSFont.systemFont(ofSize: 14, weight: .medium)])
        return min(maximumHeight, max(minimumHeight, ceil(bounds.height) + 24))
    }
}
