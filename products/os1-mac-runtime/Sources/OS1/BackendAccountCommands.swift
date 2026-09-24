import Foundation
import OS1Context

/// The active account book, re-read at most once a second. Every backend
/// child asks for it, and a run launches dozens of them.
final class BackendAccountState: @unchecked Sendable {
    static let shared = BackendAccountState()
    private let lock = NSLock()
    private var entry: (at: Date, book: BackendAccountBook)?

    func book(now: Date = Date()) -> BackendAccountBook {
        lock.lock()
        if let entry, now.timeIntervalSince(entry.at) >= 0, now.timeIntervalSince(entry.at) < 1 {
            defer { lock.unlock() }
            return entry.book
        }
        lock.unlock()
        let loaded = BackendAccounts.load()
        lock.lock(); entry = (now, loaded); lock.unlock()
        return loaded
    }

    func invalidate() { lock.lock(); entry = nil; lock.unlock() }
}

/// What a `codex`/`claude` child needs so it uses the account the owner chose.
/// Empty for the default account, so a Mac that never added one is launched
/// exactly as before accounts existed.
func backendAccountEnvironment(_ provider: String) -> [String: String] {
    BackendAccounts.environment(provider: provider, in: BackendAccountState.shared.book())
}

/// Claude writes its native transcript under the active config directory.
func claudeProjectsRoot() -> URL {
    BackendAccounts.claudeProjectsRoot(in: BackendAccountState.shared.book())
}

/// `os1 accounts …` — the owner signs in to Codex and Claude Code from OS-1
/// itself, with more than one account per provider.
///
/// OS-1 never sees a credential. Each account is a home directory
/// (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`); the provider's own CLI performs the
/// browser sign-in and writes its own secret there. OS-1 records only the
/// label, the home path and what the provider's status command printed.
enum BackendAccountCommands {
    static let usage = """
    os1 accounts list [--json]
    os1 accounts login --provider codex|claude [--id <account>] [--new] [--label <name>]
    os1 accounts use --provider codex|claude --id <account>
    os1 accounts logout --provider codex|claude [--id <account>]
    os1 accounts forget --provider codex|claude --id <account>
    """

    static func run(_ arguments: [String]) throws {
        let subcommand = arguments.count > 1 ? arguments[1] : "list"
        var options: [String: String] = [:]
        var flags = Set<String>()
        var index = 2
        while index < arguments.count {
            let token = arguments[index]
            guard token.hasPrefix("--") else { throw OS1Error.message("accounts: " + usage) }
            let name = String(token.dropFirst(2))
            if ["json", "new"].contains(name) {
                flags.insert(name)
                index += 1
                continue
            }
            guard index + 1 < arguments.count else { throw OS1Error.message("accounts: " + usage) }
            options[name] = arguments[index + 1]
            index += 2
        }

        switch subcommand {
        case "list": try list(json: flags.contains("json"))
        case "login": try login(provider: try provider(options), id: options["id"],
                                label: options["label"], forceNew: flags.contains("new"))
        case "use": try use(provider: try provider(options), id: try required(options, "id"))
        case "logout": try logout(provider: try provider(options), id: options["id"])
        case "forget": try forget(provider: try provider(options), id: try required(options, "id"))
        default: throw OS1Error.message("accounts: " + usage)
        }
    }

    private static func provider(_ options: [String: String]) throws -> String {
        let value = try required(options, "provider")
        guard BackendAccounts.providers.contains(value) else {
            throw OS1Error.message(BackendAccountError.unknownProvider(value).description)
        }
        return value
    }

    private static func required(_ options: [String: String], _ name: String) throws -> String {
        guard let value = options[name], !value.isEmpty else { throw OS1Error.message("accounts: " + usage) }
        return value
    }

    // MARK: - Reading

    /// The provider's own status command, run against one account's home.
    /// Read-only: it starts no login and makes no model call.
    static func probe(provider: String, home: URL) -> (signedIn: Bool, detail: String?) {
        let environment = BackendAccounts.environmentKey(provider: provider).map { [$0: home.path] } ?? [:]
        if provider == "claude" {
            guard let executable = try? findExecutable("claude"),
                  let output = try? commandOutput(executable, ["auth", "status", "--json"], timeout: 12,
                                                  environmentOverrides: environment),
                  let status = (try? JSONSerialization.jsonObject(with: output.1)) as? [String: Any],
                  let loggedIn = status["loggedIn"] as? Bool else { return (false, nil) }
            let account = (status["email"] as? String) ?? (status["subscriptionType"] as? String)
            return (loggedIn, loggedIn ? account : nil)
        }
        guard let executable = try? findExecutable("codex"),
              let output = try? commandOutput(executable, ["login", "status"], timeout: 12,
                                              environmentOverrides: environment) else { return (false, nil) }
        let text = String(decoding: output.1 + output.2, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        let signedIn = output.0 == 0 && text.lowercased().contains("logged in")
        return (signedIn, signedIn ? text.components(separatedBy: .newlines).first : nil)
    }

    /// Refreshes every account's sign-in state from the provider CLIs.
    static func refreshed(_ book: BackendAccountBook) -> BackendAccountBook {
        var updated = BackendAccounts.normalized(book)
        for position in updated.accounts.indices {
            let account = updated.accounts[position]
            let result = probe(provider: account.provider, home: BackendAccounts.homeURL(for: account))
            updated.accounts[position].signedIn = result.signedIn
            updated.accounts[position].signedInAs = result.detail
            updated.accounts[position].verifiedAt = Date()
        }
        return updated
    }

    private static func list(json: Bool) throws {
        let book = refreshed(BackendAccounts.load())
        try BackendAccounts.save(book)
        if json {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            encoder.dateEncodingStrategy = .iso8601
            print(String(decoding: try encoder.encode(book), as: UTF8.self))
            return
        }
        for provider in BackendAccounts.providers {
            print(provider == "claude" ? "Claude Code" : "Codex")
            for account in BackendAccounts.accounts(provider: provider, in: book) {
                let active = book.active[provider] == account.id ? "*" : " "
                let state = account.signedIn ? "로그인됨" : "로그아웃"
                let who = account.signedInAs.map { " · \($0)" } ?? ""
                print("  \(active) \(account.label) [\(account.id)] — \(state)\(who)")
            }
        }
    }

    // MARK: - Writing

    private static func use(provider: String, id: String) throws {
        var book = BackendAccounts.load()
        guard book.accounts.contains(where: { $0.id == id && $0.provider == provider }) else {
            throw OS1Error.message(BackendAccountError.unknownAccount(id).description)
        }
        book.active[provider] = id
        try BackendAccounts.save(book)
        BackendAccountState.shared.invalidate()
        print("OS1_ACCOUNT_ACTIVE \(provider) \(id)")
    }

    private static func forget(provider: String, id: String) throws {
        guard id != BackendAccounts.defaultID(provider: provider) else {
            throw OS1Error.message(BackendAccountError.defaultAccountRemoval.description)
        }
        var book = BackendAccounts.load()
        guard let account = book.accounts.first(where: { $0.id == id && $0.provider == provider }) else {
            throw OS1Error.message(BackendAccountError.unknownAccount(id).description)
        }
        // Only this account's own home is removed. A provider may keep its
        // credential outside that home (the Claude CLI uses the macOS
        // Keychain), where signing out would take the other accounts with it;
        // removing the home makes exactly this account unusable.
        if let home = account.homePath, home.hasPrefix(BackendAccounts.accountsRoot().path + "/") {
            try? FileManager.default.removeItem(atPath: home)
        }
        book.accounts.removeAll { $0.id == id }
        if book.active[provider] == id { book.active[provider] = BackendAccounts.defaultID(provider: provider) }
        try BackendAccounts.save(book)
        BackendAccountState.shared.invalidate()
        print("OS1_ACCOUNT_FORGOTTEN \(provider) \(id)")
    }

    private static func logout(provider: String, id: String?) throws {
        var book = BackendAccounts.load()
        let target = id ?? book.active[provider] ?? BackendAccounts.defaultID(provider: provider)
        guard let position = book.accounts.firstIndex(where: { $0.id == target && $0.provider == provider }) else {
            throw OS1Error.message(BackendAccountError.unknownAccount(target).description)
        }
        let home = BackendAccounts.homeURL(for: book.accounts[position])
        let others = book.accounts.filter { $0.provider == provider && $0.id != target && $0.signedIn }
        let result = try signOut(provider: provider, home: home)
        // A provider may hold one credential for every account on this Mac.
        // Re-probe the others instead of reporting a sign-out that also took them.
        let refreshedBook = refreshed(BackendAccounts.load())
        try BackendAccounts.save(refreshedBook)
        BackendAccountState.shared.invalidate()
        let alsoSignedOut = others.filter { other in
            refreshedBook.accounts.first { $0.id == other.id }?.signedIn == false
        }
        print(result ? "OS1_ACCOUNT_SIGNED_OUT \(provider) \(target)"
                     : "OS1_ACCOUNT_SIGNED_OUT_UNVERIFIED \(provider) \(target)")
        if !alsoSignedOut.isEmpty {
            print("OS1_ACCOUNT_SHARED_CREDENTIAL \(provider) " + alsoSignedOut.map(\.label).joined(separator: ", "))
            throw OS1Error.message("이 Mac은 \(provider == "claude" ? "Claude Code" : "Codex") 자격 증명을 계정끼리 공유합니다. 로그아웃하면서 다음 계정도 함께 로그아웃됐습니다: "
                + alsoSignedOut.map(\.label).joined(separator: ", "))
        }
    }

    private static func signOut(provider: String, home: URL) throws -> Bool {
        let environment = BackendAccounts.environmentKey(provider: provider).map { [$0: home.path] } ?? [:]
        let executable = try findExecutable(provider)
        let arguments = provider == "claude" ? ["auth", "logout"] : ["logout"]
        let output = try? commandOutput(executable, arguments, timeout: 30, environmentOverrides: environment)
        return probe(provider: provider, home: home).signedIn == false && (output?.0 == 0 || output == nil)
    }

    /// Runs the provider's own browser sign-in against one account's home and
    /// waits for it to finish. Codex completes through its own local callback;
    /// Claude uses OS-1's existing dialog, which feeds the browser's code
    /// straight into the waiting CLI. Either way OS-1 passes no credential in
    /// and reads none out — it only reports what the status command says after.
    private static func login(provider: String, id: String?, label: String?, forceNew: Bool) throws {
        var book = BackendAccounts.load()
        let account: BackendAccount
        if forceNew || (id == nil && label != nil) {
            guard let requested = BackendAccounts.validLabel(label ?? "") else {
                throw OS1Error.message(BackendAccountError.invalidLabel.description)
            }
            let newID = UUID().uuidString.lowercased()
            let home = try BackendAccounts.prepareHome(provider: provider, id: newID,
                from: BackendAccounts.defaultHome(provider: provider))
            account = BackendAccount(id: newID, provider: provider, label: requested, homePath: home.path)
            book.accounts.append(account)
            try BackendAccounts.save(book)
            BackendAccountState.shared.invalidate()
        } else {
            let target = id ?? book.active[provider] ?? BackendAccounts.defaultID(provider: provider)
            guard let existing = book.accounts.first(where: { $0.id == target && $0.provider == provider }) else {
                throw OS1Error.message(BackendAccountError.unknownAccount(target).description)
            }
            account = existing
        }

        let home = BackendAccounts.homeURL(for: account)
        if account.homePath != nil {
            try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
        }
        print("OS1_ACCOUNT_LOGIN_STARTED \(provider) \(account.id)")
        fflush(stdout)

        let signInHome: URL? = account.homePath == nil ? nil : home
        let outcome: Result<Void, Error>
        do {
            _ = provider == "claude"
                ? try runClaudeLoginInTerminal(home: signInHome)
                : try runCodexLogin(home: signInHome)
            outcome = .success(())
        } catch {
            outcome = .failure(error)
        }

        let state = probe(provider: provider, home: home)
        var updated = BackendAccounts.load()
        if let position = updated.accounts.firstIndex(where: { $0.id == account.id }) {
            updated.accounts[position].signedIn = state.signedIn
            updated.accounts[position].signedInAs = state.detail
            updated.accounts[position].verifiedAt = Date()
        }
        if state.signedIn { updated.active[provider] = account.id }
        try BackendAccounts.save(updated)
        BackendAccountState.shared.invalidate()
        guard state.signedIn else {
            if case .failure(let error) = outcome, !(error is ConnectionFailure) { throw error }
            throw OS1Error.message("\(provider == "claude" ? "Claude Code" : "Codex") 로그인이 확인되지 않았습니다. 브라우저에서 승인을 마쳤는지 확인하고 다시 시도하세요.")
        }
        print("OS1_ACCOUNT_SIGNED_IN \(provider) \(account.id)")
    }

    static func signInURL(in text: String) -> String? {
        for line in text.components(separatedBy: .newlines) {
            guard let range = line.range(of: "https://", options: .caseInsensitive) else { continue }
            let candidate = String(line[range.lowerBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
            guard candidate.count <= 2_000, let url = URL(string: candidate), url.host != nil,
                  ["auth.openai.com", "claude.com", "claude.ai", "platform.claude.com", "console.anthropic.com"]
                    .contains(url.host ?? "") else { continue }
            return candidate
        }
        return nil
    }
}
