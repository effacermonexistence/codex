import AppKit
import Foundation

@main struct ComposerViewportMetricsFixture {
    static func main() throws {
        var checks = 0
        func check(_ value: @autoclosure () -> Bool, _ label: String) throws {
            guard value() else { throw NSError(domain: "ComposerViewportFixture", code: checks, userInfo: [NSLocalizedDescriptionKey: label]) }
            checks += 1
        }
        func legacyHeight(_ text: String, _ width: CGFloat) -> CGFloat {
            let bounds = ((text + " ") as NSString).boundingRect(
                with: NSSize(width: max(40, width - 16), height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: [.font: NSFont.systemFont(ofSize: 14, weight: .medium)])
            return min(160, max(48, ceil(bounds.height) + 24))
        }
        let short = ["", "hello", "one\ntwo\n", "one\r\ntwo", "작업을 계속해.\n원래 자료를 보존해.",
            "👩‍👩‍👧‍👦 and 🎉", "e\u{0301}" + String(repeating: "\u{0301}", count: 32),
            "مرحبا بالعالم", "שלום עולם", "a\u{2028}b\u{2029}c", "\t\tindented", "nul\0value",
            String(repeating: " ", count: 128) + ".", String(repeating: "line\n", count: 30),
            String(repeating: "word ", count: 100)]
        for text in short {
            let original = Array(text.utf8)
            let measured = ComposerViewportMetrics.boundedMeasurementText(text)
            try check(measured != nil, "short input remains fully measured")
            try check(Array(measured!.utf8) == original + [32], "full short bytes plus original padding, no normalization")
            for width: CGFloat in [0, 40, 120, 560, 1_200] {
                try check(ComposerViewportMetrics.height(for: text, editorWidth: width) == legacyHeight(text, width),
                    "short text retains original height")
            }
            try check(Array(text.utf8) == original, "height computation never edits draft bytes")
        }
        let exactly = String(repeating: "x", count: ComposerViewportMetrics.measurementUTF8Limit)
        try check(ComposerViewportMetrics.boundedMeasurementText(exactly) != nil, "exact byte budget retains complete measurement")
        try check(ComposerViewportMetrics.boundedMeasurementText(exactly + "x") == nil, "one byte beyond budget avoids CoreText")
        let multiExact = String(repeating: "é", count: 1_024)
        try check(ComposerViewportMetrics.boundedMeasurementText(multiExact) != nil, "UTF8 budget, not character count")
        try check(ComposerViewportMetrics.boundedMeasurementText(multiExact + "é") == nil, "multibyte overflow never creates partial replacement text")
        let long = [String(repeating: " ", count: 8_623) + ".", String(repeating: "line\n", count: 3_312),
            String(repeating: "abcdefgh", count: 12_000), "a" + String(repeating: "\u{0301}", count: 200_000),
            String(repeating: "👩‍👩‍👧‍👦", count: 8_000), String(repeating: "x", count: 1_000_000)]
        for text in long {
            let original = Array(text.utf8)
            try check(ComposerViewportMetrics.boundedMeasurementText(text) == nil, "long draft has no CoreText measurement payload")
            for width: CGFloat in [40, 560, 1_200] {
                try check(ComposerViewportMetrics.height(for: text, editorWidth: width) == 160, "long input uses maximum viewport height")
            }
            try check(Array(text.utf8) == original, "long draft content remains byte-identical")
        }
        print("{\"status\":\"PASS\",\"checks\":\(checks),\"actual_drafts_read\":0,\"user_defaults_writes\":0,\"models\":0}")
    }
}
