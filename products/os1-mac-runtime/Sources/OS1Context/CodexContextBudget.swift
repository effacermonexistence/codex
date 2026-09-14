import Foundation

/// Public capacity arithmetic only, never a model ranking: a model whose
/// context window cannot hold the account's configured base instructions plus
/// a bounded request margin is not an executable route for this client, so it
/// is not advertised. Unknown sizes never exclude anything.
public enum CodexContextBudget {
    /// Measured 2026-09-14 on this account: 859,674 bytes of instructions
    /// were reported as 198,728 input tokens (≈4.3 bytes per token).
    public static let bytesPerToken = 4.0
    public static let requestMarginTokens = 24_000

    public static func requiredTokens(baseInstructionBytes: Int) -> Int {
        Int(Double(baseInstructionBytes) / bytesPerToken) + requestMarginTokens
    }

    public static func excluded(models: [(slug: String, contextWindow: Int?)], baseInstructionBytes: Int?) -> Set<String> {
        guard let bytes = baseInstructionBytes, bytes > 0 else { return [] }
        let needed = requiredTokens(baseInstructionBytes: bytes)
        return Set(models.compactMap { model -> String? in
            guard let window = model.contextWindow, window > 0, window < needed else { return nil }
            return model.slug
        })
    }

    /// Size of the `model_instructions_file` named in ~/.codex/config.toml.
    /// Only that one key is read; the file contents are never loaded.
    public static func configuredBaseInstructionBytes(
        codexHome: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex")
    ) -> Int? {
        guard let text = try? String(contentsOf: codexHome.appendingPathComponent("config.toml"), encoding: .utf8),
              let regex = try? NSRegularExpression(pattern: #"(?m)^\s*model_instructions_file\s*=\s*"([^"]+)""#),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text) else { return nil }
        let path = (String(text[range]) as NSString).expandingTildeInPath
        guard let size = (try? FileManager.default.attributesOfItem(atPath: path))?[.size] as? NSNumber else { return nil }
        return size.intValue
    }

    /// Context windows published in ~/.codex/models_cache.json, by slug.
    public static func cachedContextWindows(
        codexHome: URL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".codex")
    ) -> [String: Int] {
        guard let data = try? Data(contentsOf: codexHome.appendingPathComponent("models_cache.json")),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = object["models"] as? [[String: Any]] else { return [:] }
        var windows: [String: Int] = [:]
        for model in models {
            if let slug = model["slug"] as? String, let window = model["context_window"] as? Int, window > 0 {
                windows[slug] = window
            }
        }
        return windows
    }
}
