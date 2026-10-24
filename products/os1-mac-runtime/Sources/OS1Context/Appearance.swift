import Foundation

/// Presentation-only palette. Never participates in routing or permissions.
public enum OS1AccentPalette {
    public static let pink = "#EDB3CC" // Existing OS1 pink: .93, .70, .80.
    public static let presets: [(id: String, english: String, korean: String, hex: String)] = [
        ("pink", "OS1 Pink", "OS1 핑크", pink),
        ("purple", "Purple", "퍼플", "#B9A2FF"),
        ("blue", "Blue", "블루", "#72B7FF"),
        ("green", "Green", "그린", "#8BD3AD"),
        ("yellow", "Yellow", "옐로", "#E8D58F"),
        ("orange", "Orange", "오렌지", "#F3B48F"),
        ("red", "Red", "레드", "#ED929C"),
        ("gray", "Graphite", "그래파이트", "#B9BEC9")
    ]
    public static func normalized(_ raw: String?) -> String {
        guard let raw else { return pink }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard value.range(of: "^#[0-9A-F]{6}$", options: .regularExpression) != nil else { return pink }
        return value
    }
    public static func rgb(_ raw: String?) -> (Double, Double, Double) {
        let n = UInt32(normalized(raw).dropFirst(), radix: 16)!
        return (Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255)
    }
}
