import Foundation

/// A real execution rejection temporarily outranks a metadata-only model list.
/// This is a retry cooldown, NOT a claim about an account's reset or login time.
/// One atomic file per provider avoids read/modify/write races with health probes.
public struct ClaudeQuotaBackoff: Codable, Equatable {
    public let observedAt: Date
    public let retryAfter: Date
    public static let cooldown: TimeInterval = 300
    public static var defaultURL: URL {
        BackendHealth.defaultURL.deletingLastPathComponent().appendingPathComponent("claude-quota-backoff.json")
    }
    public static func record(at url: URL = defaultURL, now: Date = Date()) throws {
        let value = Self(observedAt: now, retryAfter: now.addingTimeInterval(cooldown))
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    public static func active(at url: URL = defaultURL, now: Date = Date()) -> Self? {
        guard let data = try? Data(contentsOf: url), data.count < 1024,
              let value = try? JSONDecoder().decode(Self.self, from: data),
              value.observedAt <= now, value.retryAfter > now,
              value.retryAfter.timeIntervalSince(value.observedAt) == cooldown else { return nil }
        return value
    }
}
