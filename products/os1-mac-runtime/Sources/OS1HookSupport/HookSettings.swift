import Foundation

public enum HookSettingsError: Error { case invalid }

public enum HookSettings {
    /// Replace only our leaf command, retaining other events, matchers, sibling
    /// hooks and unrelated settings. Deterministic output makes install a no-op
    /// when the public command is already correct.
    public static func merging(_ document: [String: Any], command: String, replacement: [String: Any]) throws -> [String: Any] {
        var result = document
        guard document["hooks"] == nil || document["hooks"] is [String: Any] else { throw HookSettingsError.invalid }
        var hooks = document["hooks"] as? [String: Any] ?? [:]
        guard hooks["UserPromptSubmit"] == nil || hooks["UserPromptSubmit"] is [[String: Any]] else { throw HookSettingsError.invalid }
        var entries: [[String: Any]] = []
        for var entry in hooks["UserPromptSubmit"] as? [[String: Any]] ?? [] {
            guard let nested = entry["hooks"] as? [[String: Any]] else { throw HookSettingsError.invalid }
            let retained = nested.filter { leaf in
                guard let existing = leaf["command"] as? String else { return true }
                return !existing.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix(" " + command)
            }
            if !retained.isEmpty { entry["hooks"] = retained; entries.append(entry) }
        }
        entries.append(["hooks": [replacement]])
        hooks["UserPromptSubmit"] = entries
        result["hooks"] = hooks
        return result
    }
}
