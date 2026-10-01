import Foundation

/// Browser navigation never grants tool, shell, file or deployment authority.
public enum BrowserNavigation {
    public static func url(_ text: String) -> URL? {
        guard let parts = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil else { return nil }
        return parts.url
    }
}
