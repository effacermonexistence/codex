import Foundation
import CoreFoundation
import CryptoKit
import Darwin
import OS1System

/// Native CLI metadata, not an execution capability or model-call result.
public enum BackendSetupState: String, Codable, Equatable, Sendable {
    case missing, signedIn, signedOut, unverified
}

public struct BackendSetupProvider: Codable, Equatable, Sendable, Identifiable {
    public var id: String { provider }
    public let provider: String
    public let executablePath: String?
    public let state: BackendSetupState
    public let checkedAt: Date
    public let accountID: String
    public let signedInAs: String?
    public let authMethod: String?
    public let detail: String?
    public let installURL: String

    public init(provider: String, executablePath: String?, state: BackendSetupState,
                checkedAt: Date, accountID: String, signedInAs: String? = nil,
                authMethod: String? = nil, detail: String? = nil) {
        self.provider = provider; self.executablePath = executablePath; self.state = state
        self.checkedAt = checkedAt; self.accountID = accountID; self.signedInAs = signedInAs
        self.authMethod = authMethod; self.detail = detail
        self.installURL = provider == "claude" ? "https://code.claude.com/docs/en/setup"
            : "https://developers.openai.com/codex/cli"
    }
}

public struct BackendSetupSnapshot: Codable, Equatable, Sendable {
    public let book: BackendAccountBook
    public let providers: [BackendSetupProvider]
    public let checkedAt: Date
    public init(book: BackendAccountBook, providers: [BackendSetupProvider], checkedAt: Date) {
        self.book = book; self.providers = providers; self.checkedAt = checkedAt
    }
}

/// Pure parsing and metadata updates make setup fixtures independent of the
/// owner's auth files, native login process, and paid model execution.
public enum BackendSetup {
    public static func parseStatus(provider: String, executablePath: String,
                                   accountID: String, exitCode: Int32,
                                   stdout: Data, stderr: Data, checkedAt: Date = Date()) -> BackendSetupProvider {
        func result(_ state: BackendSetupState, name: String? = nil, method: String? = nil,
                    detail: String? = nil) -> BackendSetupProvider {
            BackendSetupProvider(provider: provider, executablePath: executablePath, state: state,
                checkedAt: checkedAt, accountID: accountID, signedInAs: name, authMethod: method, detail: detail)
        }
        guard stdout.count + stderr.count <= 65_536 else {
            return result(.unverified, detail: "The native sign-in status could not be verified.")
        }
        if provider == "claude" {
            guard let status = (try? JSONSerialization.jsonObject(with: stdout)) as? [String: Any],
                  let rawLoggedIn = status["loggedIn"] as? NSNumber,
                  CFGetTypeID(rawLoggedIn) == CFBooleanGetTypeID() else {
                return result(.unverified, detail: "The native sign-in status could not be verified.")
            }
            let loggedIn = rawLoggedIn.boolValue
            if !loggedIn { return result(.signedOut) }
            guard exitCode == 0 else { return result(.unverified, detail: "The native sign-in status could not be verified.") }
            // Only documented, bounded account descriptors are surfaced. Raw
            // output, auth URLs and credential-shaped values never reach UI.
            let email = safeAccountLabel(status["email"] as? String)
            let plan = safeAccountLabel(status["subscriptionType"] as? String)
            let nativeMethod = (status["authMethod"] as? String)?.lowercased()
            let methods: Set<String> = ["claude.ai", "claudeai", "oauth", "oauth_token", "api_key", "api_key_helper", "third_party", "api", "console"]
            return result(.signedIn, name: email ?? plan,
                          method: nativeMethod.flatMap { methods.contains($0) ? $0 : nil })
        }
        if provider == "codex" {
            let text = String(decoding: stdout + stderr, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let lines = text.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            let loginLines = lines.filter { $0 == "logged in" || $0.hasPrefix("logged in using ") }
            let logoutLines = lines.filter { $0 == "not logged in" || $0 == "not logged in." }
            if exitCode == 0 && loginLines.count == 1 && logoutLines.isEmpty {
                // `login status` can print the API key after its label. Never
                // retain that line; record only the authentication mode.
                let method = loginLines[0].contains("chatgpt") ? "chatgpt" : loginLines[0].contains("api key") ? "api_key" : "unknown"
                return result(.signedIn, name: method == "chatgpt" ? "ChatGPT" : method == "api_key" ? "API key" : nil,
                              method: method)
            }
            if exitCode != 0 && logoutLines.count == 1 && loginLines.isEmpty {
                return result(.signedOut)
            }
        }
        return result(.unverified, detail: "The native sign-in status could not be verified.")
    }

    private static func safeAccountLabel(_ text: String?) -> String? {
        guard let text else { return nil }
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 160,
              !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              !value.lowercased().contains("sk-"), !value.contains("://") else { return nil }
        return value
    }

    /// Missing/failed status is not evidence of logout. Update only a native
    /// status that directly established signed-in or signed-out for that ID.
    public static func applying(_ checks: [BackendSetupProvider], to book: BackendAccountBook) -> BackendAccountBook {
        var updated = BackendAccounts.normalized(book)
        for check in checks where check.state == .signedIn || check.state == .signedOut {
            guard let index = updated.accounts.firstIndex(where: { $0.id == check.accountID && $0.provider == check.provider }) else { continue }
            updated.accounts[index].signedIn = check.state == .signedIn
            updated.accounts[index].signedInAs = check.state == .signedIn ? check.signedInAs : nil
            updated.accounts[index].verifiedAt = check.checkedAt
        }
        return updated
    }

    /// GUI applications may live in either the system or per-user Applications
    /// folder. Detect their officially bundled CLI before asking for an install.
    public static func providerExecutableCandidates(provider: String, homePath: String) -> [String] {
        guard BackendAccounts.providers.contains(provider) else { return [] }
        var candidates = ["\(homePath)/.local/bin/\(provider)", "/opt/homebrew/bin/\(provider)", "/usr/local/bin/\(provider)"]
        if provider == "codex" {
            for root in ["/Applications", "\(homePath)/Applications"] {
                for app in ["Codex.app", "ChatGPT.app"] {
                    candidates += ["\(root)/\(app)/Contents/Resources/codex-cli/bin/codex",
                                   "\(root)/\(app)/Contents/Resources/codex"]
                }
            }
        }
        return candidates
    }
}

/// Setup can be opened from several OS-1 windows. One account-specific
/// cross-process lease prevents those windows from stacking official logins.
/// The lock contains no credential and is independent of execution/session state.
public final class BackendLoginLease {
    private let descriptor: Int32
    public init(root: URL, provider: String, accountIdentity: String) throws {
        guard BackendAccounts.providers.contains(provider) else { throw ConnectionFailure.unavailable }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let identity = SHA256.hash(data: Data(accountIdentity.utf8)).map { String(format: "%02x", $0) }.joined()
        descriptor = Darwin.open(root.appendingPathComponent("provider-\(provider)-\(identity).lock").path,
                                O_CREAT | O_RDWR | O_NOFOLLOW, 0o600)
        guard descriptor >= 0 else { throw ConnectionFailure.unavailable }
    }
    public func tryAcquire() -> Bool { os1_flock(descriptor, LOCK_EX | LOCK_NB) == 0 }
    deinit { _ = os1_flock(descriptor, LOCK_UN); Darwin.close(descriptor) }
}
