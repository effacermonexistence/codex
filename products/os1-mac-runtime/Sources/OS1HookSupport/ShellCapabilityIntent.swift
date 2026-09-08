import Foundation

/// Classification only: never rewrite the user's execution prompt or grant a
/// tool/permission. A mentioned artifact ("test evidence") is not an imperative.
public enum ShellCapabilityIntent {
    public static func classificationText(_ prompt: String) -> String {
        let text = prompt.precomposedStringWithCanonicalMapping.lowercased()
        // Keep independent positive clauses: "Do not deploy, but run tests".
        // Removing a prohibition only permits the existing read-only lane; it
        // never grants that lane Bash or any other additional capability.
        let prohibition = #"\b(?:do\s+not|don't|don’t|never)\s+(?:run|execute|install|build|test|deploy|upload|download|commit|merge|sync|setup|set\s+up|modify|change|edit|write|create|delete|read|access|use)\b[^.!?;\n]*?(?=\b(?:but|however|instead|then)\b|[.!?;\n]|$)"#
        return text.replacingOccurrences(of: prohibition, with: "", options: .regularExpression)
    }

    public static func hasEnglishImperative(_ text: String) -> Bool {
        let requestPosition = #"(?:^|[.!?;\n,]|\b(?:and|then|please|now|also|first|next|but|however|instead)|\b(?:can|could|would)\s+you|\b(?:want|need|ask)\s+you\s+to|\b(?:remember|do\s+not\s+forget|don't\s+forget)\s+to)\s*"#
        let action = #"(?:run|execute|install|build|test|deploy|upload|download|commit|merge|sync|setup|set\s+up)\b"#
        return text.range(of: requestPosition + action, options: .regularExpression) != nil
    }
}
