import CryptoKit
import Foundation

/// OS-1 identity is deliberately independent of provider CLI accounts and the
/// macOS user's name. Neither a connected backend nor a filename identifies it.
public enum AppIdentityProvider: String, Codable, CaseIterable, Sendable {
    case google, apple
    public var title: String { self == .google ? "Google" : "Apple" }
}

public struct AppIdentityProfile: Codable, Equatable, Sendable {
    public var provider: AppIdentityProvider
    public var subject: String
    public var name: String
    public var email: String?
    public var verifiedAt: Date
    public init(provider: AppIdentityProvider, subject: String, name: String, email: String?, verifiedAt: Date = Date()) {
        self.provider = provider; self.subject = subject; self.name = name
        self.email = email; self.verifiedAt = verifiedAt
    }
    public var displayName: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? (email ?? provider.title) : trimmed
    }
    public var initials: String {
        let parts = displayName.split(whereSeparator: \.isWhitespace)
        return (parts.count > 1 ? parts.prefix(2).map { String($0.prefix(1)) }.joined()
                : String(displayName.prefix(2))).uppercased()
    }
}

public enum AppIdentityError: Error, Equatable {
    case configuration, invalidCallback, cancelled, invalidResponse, expired, storage
}

/// Public app-registration metadata, never a client secret or a provider login.
public struct GoogleIdentityConfiguration: Equatable, Sendable {
    public let clientID: String
    public var callbackScheme: String { clientID.split(separator: ".").reversed().joined(separator: ".") }
    public var redirectURI: String { callbackScheme + ":/oauthredirect" }

    public init(clientID: String, registeredSchemes: [String]) throws {
        guard clientID.hasSuffix(".apps.googleusercontent.com"),
              clientID.count > ".apps.googleusercontent.com".count,
              clientID.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-").contains($0) }) else {
            throw AppIdentityError.configuration
        }
        self.clientID = clientID
        guard registeredSchemes.contains(callbackScheme) else { throw AppIdentityError.configuration }
    }
}

/// A single browser transaction. Its state and verifier never enter logs/files.
public struct GoogleIdentityRequest: Sendable {
    public let configuration: GoogleIdentityConfiguration
    public let state: String
    public let verifier: String
    public init(configuration: GoogleIdentityConfiguration, state: String, verifier: String) {
        self.configuration = configuration; self.state = state; self.verifier = verifier
    }
    public var challenge: String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    public var authorizationURL: URL {
        var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        url.queryItems = [
            .init(name: "client_id", value: configuration.clientID),
            .init(name: "redirect_uri", value: configuration.redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: "openid email profile"),
            .init(name: "state", value: state),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "access_type", value: "offline"),
            .init(name: "prompt", value: "select_account consent")
        ]
        return url.url!
    }
    public func authorizationCode(from callback: URL) throws -> String {
        guard let url = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              url.scheme == configuration.callbackScheme, url.host == nil,
              url.path == "/oauthredirect", url.fragment == nil, url.user == nil,
              url.password == nil, url.port == nil else { throw AppIdentityError.invalidCallback }
        let items = url.queryItems ?? []
        func values(_ key: String) -> [String] { items.filter { $0.name == key }.compactMap(\.value) }
        guard items.filter({ $0.name == "state" }).count == 1,
              items.filter({ $0.name == "code" }).count <= 1,
              items.filter({ $0.name == "error" }).count <= 1,
              values("state") == [state] else { throw AppIdentityError.invalidCallback }
        if values("error") == ["access_denied"], values("code").isEmpty { throw AppIdentityError.cancelled }
        guard !items.contains(where: { $0.name == "error" }), values("code").count == 1,
              let code = values("code").first, !code.isEmpty else { throw AppIdentityError.invalidCallback }
        return code
    }
    public func tokenBody(code: String) -> Data {
        Self.form(["client_id": configuration.clientID, "code": code, "code_verifier": verifier,
                   "redirect_uri": configuration.redirectURI, "grant_type": "authorization_code"])
    }
    public static func form(_ values: [String: String]) -> Data {
        let safe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
        return Data(values.keys.sorted().map {
            $0.addingPercentEncoding(withAllowedCharacters: safe)! + "=" + values[$0]!.addingPercentEncoding(withAllowedCharacters: safe)!
        }.joined(separator: "&").utf8)
    }
}

/// Counts recorded usage only. Missing measurements stay missing; this is not
/// a subscription quota, a billing total, or an account-scoped cloud history.
public struct AppUsageDay: Identifiable, Sendable {
    public var id: Date
    public var tokens: Int
    public var tasks: Int
    public var unmeteredTasks: Int
    public var measuredAttempts: Int
}

public struct AppUsageSummary: Sendable {
    public let days: [AppUsageDay]
    public var tokens: Int { days.reduce(0) { $0 + $1.tokens } }
    public var tasks: Int { days.reduce(0) { $0 + $1.tasks } }
    public var unmeteredTasks: Int { days.reduce(0) { $0 + $1.unmeteredTasks } }
    public var measuredAttempts: Int { days.reduce(0) { $0 + $1.measuredAttempts } }

    public init(snapshot: GovernanceSnapshot, provider: String? = nil, now: Date = Date(), calendar: Calendar = .current) {
        let today = calendar.startOfDay(for: now)
        days = (-6...0).map { offset in
            let start = calendar.date(byAdding: .day, value: offset, to: today)!
            let end = calendar.date(byAdding: .day, value: 1, to: start)!
            let tasks = snapshot.tasks.filter { task in
                task.startedAt >= start && task.startedAt < end && task.startedAt <= now
                && (provider == nil || task.attempts.contains { $0.provider == provider })
            }
            var tokens = 0, missing = 0, measured = 0
            for task in tasks {
                let attempts = task.attempts.filter { provider == nil || $0.provider == provider }
                let values = attempts.compactMap { $0.observation.flatMap(GovernanceSnapshot.tokens) }
                tokens += values.reduce(0, +)
                measured += values.count
                if values.count < attempts.count || attempts.isEmpty { missing += 1 }
            }
            return AppUsageDay(id: start, tokens: tokens, tasks: tasks.count, unmeteredTasks: missing, measuredAttempts: measured)
        }
    }
}
