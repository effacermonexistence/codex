import Foundation

/// Owner-visible backend sign-ins (owner order 2026-09-24: "코덱스 로그인,
/// 클로드 로그인 … 여러 계정 로그인 가능하도록").
///
/// OS-1 never reads, stores, copies or forwards a provider credential. An
/// account here is a label plus the home directory that the provider's own
/// CLI writes its login into — `CODEX_HOME` for Codex, `CLAUDE_CONFIG_DIR`
/// for Claude Code. The secret stays wherever that CLI puts it (file or
/// Keychain); OS-1 only decides which home a run is launched against.
///
/// The first account of each provider is the CLI's own default home, so a
/// Mac that never touches this feature behaves exactly as before.
public struct BackendAccount: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let provider: String
    public var label: String
    /// nil = the provider CLI's own default home (`~/.codex`, `~/.claude`).
    public var homePath: String?
    /// What the provider's own status command printed (an email, a plan name).
    /// Never a token, and never parsed into one.
    public var signedIn: Bool
    public var signedInAs: String?
    public var verifiedAt: Date?

    public init(id: String, provider: String, label: String, homePath: String? = nil,
                signedIn: Bool = false, signedInAs: String? = nil, verifiedAt: Date? = nil) {
        self.id = id
        self.provider = provider
        self.label = label
        self.homePath = homePath
        self.signedIn = signedIn
        self.signedInAs = signedInAs
        self.verifiedAt = verifiedAt
    }

    public var isDefault: Bool { homePath == nil }
}

public struct BackendAccountBook: Codable, Equatable, Sendable {
    public var accounts: [BackendAccount]
    /// provider → account id.
    public var active: [String: String]

    public init(accounts: [BackendAccount] = [], active: [String: String] = [:]) {
        self.accounts = accounts
        self.active = active
    }
}

public enum BackendAccounts {
    public static let providers = ["codex", "claude"]
    public static let labelLimit = 48

    /// Files a provider CLI keeps its credential in. A new account home is
    /// seeded with configuration only; these are never copied, and the seed
    /// refuses to run if one would be.
    public static let credentialFileNames: Set<String> = [
        "auth.json", ".credentials.json", "credentials.json", ".claude.json", "auth.jsonc",
    ]

    /// Configuration worth carrying into a second account so it behaves like
    /// the first. Nothing here is a secret.
    public static func seedFileNames(provider: String) -> [String] {
        switch provider {
        case "codex": return ["config.toml", "AGENTS.md"]
        case "claude": return ["CLAUDE.md", "settings.json"]
        default: return []
        }
    }

    public static func defaultHome(provider: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home.appendingPathComponent(provider == "claude" ? ".claude" : ".codex", isDirectory: true)
    }

    public static func environmentKey(provider: String) -> String? {
        switch provider {
        case "codex": return "CODEX_HOME"
        case "claude": return "CLAUDE_CONFIG_DIR"
        default: return nil
        }
    }

    public static func defaultID(provider: String) -> String { provider + ".default" }

    public static func defaultLabel(provider: String) -> String {
        provider == "claude" ? "기본 Claude 로그인" : "기본 Codex 로그인"
    }

    public static func accountsRoot(support: URL? = nil) -> URL {
        (support ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1", isDirectory: true))
            .appendingPathComponent("accounts", isDirectory: true)
    }

    public static func storeURL(support: URL? = nil) -> URL {
        (support ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1", isDirectory: true))
            .appendingPathComponent("accounts.json")
    }

    public static func validLabel(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).precomposedStringWithCanonicalMapping
        guard !trimmed.isEmpty, trimmed.count <= labelLimit,
              trimmed.rangeOfCharacter(from: .controlCharacters) == nil else { return nil }
        return trimmed
    }

    /// Every read goes through this: it guarantees one default account per
    /// provider, a valid active id, and no duplicate or malformed entries.
    public static func normalized(_ book: BackendAccountBook) -> BackendAccountBook {
        var accounts: [BackendAccount] = []
        var seen = Set<String>()
        for provider in providers {
            let id = defaultID(provider: provider)
            let stored = book.accounts.first { $0.id == id && $0.provider == provider }
            accounts.append(BackendAccount(
                id: id, provider: provider,
                label: stored.flatMap { validLabel($0.label) } ?? defaultLabel(provider: provider),
                homePath: nil,
                signedIn: stored?.signedIn ?? false,
                signedInAs: stored?.signedInAs,
                verifiedAt: stored?.verifiedAt))
            seen.insert(id)
        }
        for account in book.accounts {
            guard providers.contains(account.provider), !seen.contains(account.id),
                  UUID(uuidString: account.id) != nil,
                  let label = validLabel(account.label),
                  let home = account.homePath, !home.isEmpty,
                  home.hasPrefix(accountsRoot().path + "/") else { continue }
            seen.insert(account.id)
            accounts.append(BackendAccount(id: account.id, provider: account.provider, label: label,
                                           homePath: home, signedIn: account.signedIn,
                                           signedInAs: account.signedInAs, verifiedAt: account.verifiedAt))
        }
        var active: [String: String] = [:]
        for provider in providers {
            let candidate = book.active[provider]
            active[provider] = accounts.contains { $0.id == candidate && $0.provider == provider }
                ? candidate! : defaultID(provider: provider)
        }
        return BackendAccountBook(accounts: accounts, active: active)
    }

    public static func load(from url: URL? = nil) -> BackendAccountBook {
        let target = url ?? storeURL()
        let decoder = JSONDecoder()
        // Must match `save`: with the default strategy an ISO-8601
        // `verifiedAt` fails to decode and every added account is silently
        // dropped back to the provider defaults.
        decoder.dateDecodingStrategy = .iso8601
        guard let data = try? Data(contentsOf: target),
              let decoded = try? decoder.decode(BackendAccountBook.self, from: data) else {
            return normalized(BackendAccountBook())
        }
        return normalized(decoded)
    }

    public static func save(_ book: BackendAccountBook, to url: URL? = nil) throws {
        let target = url ?? storeURL()
        try FileManager.default.createDirectory(at: target.deletingLastPathComponent(),
                                                withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(normalized(book))
        try data.write(to: target, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
    }

    public static func accounts(provider: String, in book: BackendAccountBook) -> [BackendAccount] {
        normalized(book).accounts.filter { $0.provider == provider }
    }

    public static func active(provider: String, in book: BackendAccountBook) -> BackendAccount {
        let normalizedBook = normalized(book)
        let id = normalizedBook.active[provider] ?? defaultID(provider: provider)
        return normalizedBook.accounts.first { $0.id == id }
            ?? BackendAccount(id: defaultID(provider: provider), provider: provider,
                              label: defaultLabel(provider: provider))
    }

    /// The only thing a run needs: what to add to the child environment so the
    /// provider CLI uses this account's own login.
    public static func environment(provider: String, in book: BackendAccountBook) -> [String: String] {
        let account = active(provider: provider, in: book)
        guard let home = account.homePath, let key = environmentKey(provider: provider) else { return [:] }
        return [key: home]
    }

    public static func home(provider: String, in book: BackendAccountBook,
                            userHome: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        let account = active(provider: provider, in: book)
        guard let path = account.homePath else { return defaultHome(provider: provider, home: userHome) }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    /// Claude writes its native transcripts under the active config directory,
    /// so a second account's records must be read from that account's home.
    public static func claudeProjectsRoot(in book: BackendAccountBook,
                                          userHome: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        home(provider: "claude", in: book, userHome: userHome)
            .appendingPathComponent("projects", isDirectory: true)
    }

    public static func homeURL(for account: BackendAccount,
                               userHome: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL {
        guard let path = account.homePath else { return defaultHome(provider: account.provider, home: userHome) }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    /// A second account is a fresh home: its own login, this Mac's
    /// configuration, and none of the first account's credentials.
    public static func prepareHome(provider: String, id: String, from source: URL,
                                   support: URL? = nil) throws -> URL {
        let target = accountsRoot(support: support)
            .appendingPathComponent(provider, isDirectory: true)
            .appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        for name in seedFileNames(provider: provider) {
            guard !credentialFileNames.contains(name) else {
                throw BackendAccountError.credentialSeed(name)
            }
            let origin = source.appendingPathComponent(name)
            let destination = target.appendingPathComponent(name)
            guard FileManager.default.fileExists(atPath: origin.path),
                  !FileManager.default.fileExists(atPath: destination.path) else { continue }
            try? FileManager.default.copyItem(at: origin, to: destination)
        }
        return target
    }
}

public enum BackendAccountError: Error, CustomStringConvertible, Equatable {
    case credentialSeed(String)
    case unknownProvider(String)
    case unknownAccount(String)
    case invalidLabel
    case defaultAccountRemoval

    public var description: String {
        switch self {
        case .credentialSeed(let name):
            return "OS-1은 계정 자격 증명을 복사하지 않습니다(\(name))."
        case .unknownProvider(let value):
            return "지원하지 않는 백엔드입니다: \(value)"
        case .unknownAccount(let value):
            return "그런 계정이 없습니다: \(value)"
        case .invalidLabel:
            return "계정 이름은 1~\(BackendAccounts.labelLimit)자여야 하고 줄바꿈이나 제어문자를 쓸 수 없습니다."
        case .defaultAccountRemoval:
            return "기본 로그인은 삭제할 수 없습니다. 로그아웃만 가능합니다."
        }
    }
}
