import Foundation

/// A real execution rejection temporarily outranks a metadata-only model list.
/// This is a retry cooldown, NOT a claim about an account's reset or login time.
/// One atomic file per provider avoids read/modify/write races with health probes.
/// A model-scoped limit gets its own file, so it never blocks the other models.
public struct ClaudeQuotaBackoff: Codable, Equatable {
    public let observedAt: Date
    public let retryAfter: Date
    /// Nil for the account-wide receipt (field omitted: legacy files decode unchanged).
    public var model: String? = nil
    public static let cooldown: TimeInterval = 300
    /// A named-model limit carries no reset time and has lasted days. Probe it at
    /// most hourly instead of every 5 minutes; the run itself re-routes meanwhile.
    public static let modelCooldown: TimeInterval = 3_600
    private static let modelPrefix = "claude-quota-backoff.model-"
    public static var defaultURL: URL {
        BackendHealth.defaultURL.deletingLastPathComponent().appendingPathComponent("claude-quota-backoff.json")
    }
    public static var defaultDirectory: URL { defaultURL.deletingLastPathComponent() }
    public static func record(at url: URL = defaultURL, now: Date = Date()) throws {
        try write(Self(observedAt: now, retryAfter: now.addingTimeInterval(cooldown)), to: url)
    }
    public static func active(at url: URL = defaultURL, now: Date = Date()) -> Self? {
        guard let value = read(url), value.model == nil,
              value.observedAt <= now, value.retryAfter > now,
              value.retryAfter.timeIntervalSince(value.observedAt) == cooldown else { return nil }
        return value
    }
    /// A family that can name its own receipt file: 1–32 of [a-z0-9._-], starting alphanumeric.
    /// Checked per scalar, so no regex anchor can let a trailing newline through.
    public static func validFamily(_ family: String) -> Bool {
        let head = "abcdefghijklmnopqrstuvwxyz0123456789".unicodeScalars, body = "abcdefghijklmnopqrstuvwxyz0123456789._-".unicodeScalars
        guard let first = family.unicodeScalars.first, head.contains(first), family.unicodeScalars.count <= 32 else { return false }
        return family.unicodeScalars.allSatisfy { body.contains($0) }
    }
    public static func modelURL(_ family: String, directory: URL = defaultDirectory) -> URL? {
        guard validFamily(family) else { return nil }
        return directory.appendingPathComponent(modelPrefix + family + ".json")
    }
    public static func record(model family: String, directory: URL = defaultDirectory, now: Date = Date()) throws {
        guard let url = modelURL(family, directory: directory) else { return }
        try write(Self(observedAt: now, retryAfter: now.addingTimeInterval(modelCooldown), model: family), to: url)
    }
    public static func active(model family: String, directory: URL = defaultDirectory, now: Date = Date()) -> Self? {
        guard let url = modelURL(family, directory: directory), let value = read(url), value.model == family,
              value.observedAt <= now, value.retryAfter > now,
              value.retryAfter.timeIntervalSince(value.observedAt) == modelCooldown else { return nil }
        return value
    }
    /// Model families whose own receipt is active now, sorted.
    public static func activeModels(directory: URL = defaultDirectory, now: Date = Date()) -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? [])
            .filter { $0.hasPrefix(modelPrefix) && $0.hasSuffix(".json") }
            .map { String($0.dropFirst(modelPrefix.count).dropLast(5)) }
            .filter { active(model: $0, directory: directory, now: now) != nil }
            .sorted()
    }
    private static func write(_ value: Self, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    private static func read(_ url: URL) -> Self? {
        guard let data = try? Data(contentsOf: url), data.count < 1024 else { return nil }
        return try? JSONDecoder().decode(Self.self, from: data)
    }
}
