import Foundation

/// Shared research identity, not fuzzy search or a rewrite of the user's prompt.
public enum ResearchMaterialIntent {
    public static func usesPairedGRDictationAlias(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        let qm = #"(?<![a-z0-9])(?:q\s*\.?\s*(?:o\s*\.?\s*)?m|qaam|quantum\s+mechanics|양자역학)(?![a-z0-9])\.?"#
        let gar = #"(?<![a-z0-9])g\s*\.?\s*a\s*\.?\s*r(?![a-z0-9])\.?"#
        let join = #"(?:\s*(?:이랑|랑|과|와|하고|and|&|/|·|[-–—+])\s*|\s+)"#
        return value.range(of: "(?:" + qm + join + gar + "|" + gar + join + qm + ")",
                           options: .regularExpression) != nil
    }

    public static func qmGR(_ prompt: String) -> Bool {
        let value = prompt.precomposedStringWithCanonicalMapping.lowercased()
        if value.range(of: #"(?<![a-z0-9])q(?:o)?m\s*[-–—]?\s*gr(?![a-z0-9])"#, options: .regularExpression) != nil {
            return true
        }
        let mentionsQM = value.range(of: #"(?<![a-z0-9])q\s*\.?\s*(?:o\s*\.?\s*)?m(?![a-z0-9])"#, options: .regularExpression) != nil ||
            value.contains("양자역학") || value.contains("quantum mechanics") ||
            value.range(of: #"\bqaam\b"#, options: .regularExpression) != nil
        let mentionsGR = value.range(of: #"(?<![a-z0-9])g\s*\.?\s*r(?![a-z0-9])"#, options: .regularExpression) != nil ||
            value.contains("일반상대") || value.contains("general relativity") ||
            ["주암", "주아", "지알", "쥐알"].contains(where: value.contains)
        return mentionsQM && mentionsGR || usesPairedGRDictationAlias(prompt) ||
            value.contains("orthogonal projection") || value.contains("orthogonal-projection-term")
    }
}
