import Foundation

/// A short cooldown on one Codex model after a real execution rejection for
/// a rate or usage limit (`CodexTurnRejection.limitClass`). The next RCC
/// catalog excludes that model with `quota_backoff` instead of offering it
/// again; when it is the pool's frontier model the pool reports
/// `reference_unavailable`. This is a retry cooldown, NOT a claim about an
/// account's reset time: it is bounded (`cooldown`) and expires by itself.
/// One atomic file per model, beside the Claude cooldown receipts.
public struct CodexQuotaBackoff: Codable, Equatable {
    public let observedAt: Date
    public let retryAfter: Date
    public let model: String
    /// The default and upper bound of one cooldown: a provider retry hint
    /// shorter than this is honoured, a longer one (or none) is capped here,
    /// so a stale rejection never withholds a model for long.
    public static let maximumCooldown: TimeInterval = 600
    /// A retry hint of a few seconds still avoids an immediate repeat.
    public static let minimumCooldown: TimeInterval = 30
    private static let prefix = "codex-quota-backoff.model-"
    public static var defaultDirectory: URL { ClaudeQuotaBackoff.defaultDirectory }

    /// min(retry hint, maximumCooldown), at least minimumCooldown.
    public static func cooldown(retryAfter: TimeInterval?) -> TimeInterval {
        guard let hint = retryAfter, hint.isFinite else { return maximumCooldown }
        return min(max(hint, minimumCooldown), maximumCooldown)
    }
    /// A model slug that can name its own receipt file: 1–64 of
    /// [a-z0-9._-], starting alphanumeric. Checked per scalar.
    public static func validModel(_ model: String) -> Bool {
        let head = "abcdefghijklmnopqrstuvwxyz0123456789".unicodeScalars, body = "abcdefghijklmnopqrstuvwxyz0123456789._-".unicodeScalars
        guard let first = model.unicodeScalars.first, head.contains(first), model.unicodeScalars.count <= 64 else { return false }
        return model.unicodeScalars.allSatisfy { body.contains($0) }
    }
    public static func modelURL(_ model: String, directory: URL = defaultDirectory) -> URL? {
        guard validModel(model) else { return nil }
        return directory.appendingPathComponent(prefix + model + ".json")
    }
    public static func record(model: String, retryAfter hint: TimeInterval? = nil,
                              directory: URL = defaultDirectory, now: Date = Date()) throws {
        guard let url = modelURL(model, directory: directory) else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let value = Self(observedAt: now, retryAfter: now.addingTimeInterval(cooldown(retryAfter: hint)), model: model)
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    /// The model's receipt while it is active; a receipt whose window is not
    /// a valid cooldown (tampered, future, too long) is ignored.
    public static func active(model: String, directory: URL = defaultDirectory, now: Date = Date()) -> Self? {
        guard let url = modelURL(model, directory: directory), let data = try? Data(contentsOf: url), data.count < 1024,
              let value = try? JSONDecoder().decode(Self.self, from: data), value.model == model,
              value.observedAt <= now, value.retryAfter > now else { return nil }
        let window = value.retryAfter.timeIntervalSince(value.observedAt)
        return window >= minimumCooldown && window <= maximumCooldown ? value : nil
    }
    /// Models whose own receipt is active now, sorted.
    public static func activeModels(directory: URL = defaultDirectory, now: Date = Date()) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [])
            .filter { $0.hasPrefix(prefix) && $0.hasSuffix(".json") }
            .map { String($0.dropFirst(prefix.count).dropLast(5)) }
            .filter { active(model: $0, directory: directory, now: now) != nil }
            .sorted()
    }
}
