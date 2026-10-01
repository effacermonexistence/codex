import Foundation
import OS1Context

/// Backend accounts (owner order 2026-09-24): sign in to Codex and Claude from
/// OS-1, with several accounts each. These checks pin the two properties that
/// make the feature safe — the default account changes nothing about how a
/// backend is launched, and no credential is ever stored or copied.
func runBackendAccountsFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) {
        precondition(value, "Backend accounts: " + label); checks += 1
    }

    // A Mac that never touched this feature: one default account per provider,
    // both active, and an empty environment — the launch path of build 246.
    let fresh = BackendAccounts.normalized(BackendAccountBook())
    check(fresh.accounts.count == BackendAccounts.providers.count, "one default account per provider")
    check(fresh.accounts.allSatisfy { $0.isDefault }, "defaults keep the CLI's own home")
    for provider in BackendAccounts.providers {
        check(fresh.active[provider] == BackendAccounts.defaultID(provider: provider), "\(provider) default is active")
        check(BackendAccounts.environment(provider: provider, in: fresh).isEmpty,
                  "\(provider) default injects no environment")
    }
    check(BackendAccounts.home(provider: "claude", in: fresh, userHome: URL(fileURLWithPath: "/u")).path == "/u/.claude",
              "claude default home")
    check(BackendAccounts.home(provider: "codex", in: fresh, userHome: URL(fileURLWithPath: "/u")).path == "/u/.codex",
              "codex default home")

    // A second account moves that provider's home, its records, and nothing else.
    let id = UUID().uuidString.lowercased()
    let home = BackendAccounts.accountsRoot().appendingPathComponent("claude/\(id)").path
    var book = fresh
    book.accounts.append(BackendAccount(id: id, provider: "claude", label: "회사 계정", homePath: home, signedIn: true))
    book.active["claude"] = id
    let second = BackendAccounts.normalized(book)
    check(second.accounts.count == 3, "second account kept")
    check(BackendAccounts.environment(provider: "claude", in: second) == ["CLAUDE_CONFIG_DIR": home],
              "the run uses the chosen account's home")
    check(BackendAccounts.claudeProjectsRoot(in: second).path == home + "/projects",
              "native records are read from the account that ran")
    check(BackendAccounts.environment(provider: "codex", in: second).isEmpty,
              "switching one provider leaves the other alone")
    check(BackendAccounts.active(provider: "claude", in: second).label == "회사 계정", "active account resolves")

    // An entry pointing outside OS-1's own accounts directory is refused, and
    // the active id falls back instead of launching against a foreign home.
    var hostile = fresh
    let escape = UUID().uuidString.lowercased()
    hostile.accounts.append(BackendAccount(id: escape, provider: "claude", label: "x", homePath: "/etc"))
    hostile.active["claude"] = escape
    let cleaned = BackendAccounts.normalized(hostile)
    check(cleaned.accounts.count == 2, "a home outside the accounts directory is dropped")
    check(cleaned.active["claude"] == BackendAccounts.defaultID(provider: "claude"), "active falls back to the default")
    check(BackendAccounts.environment(provider: "claude", in: cleaned).isEmpty, "a dropped account cannot be launched")

    // A malformed id cannot smuggle an account in.
    var malformed = fresh
    malformed.accounts.append(BackendAccount(id: "../escape", provider: "claude", label: "x",
        homePath: BackendAccounts.accountsRoot().appendingPathComponent("claude/../escape").path))
    check(BackendAccounts.normalized(malformed).accounts.count == 2, "a non-UUID account id is dropped")

    check(BackendAccounts.validLabel("  회사  ") == "회사", "label is trimmed")
    check(BackendAccounts.validLabel("") == nil, "an empty label is refused")
    check(BackendAccounts.validLabel("a\nb") == nil, "a multi-line label is refused")
    check(BackendAccounts.validLabel(String(repeating: "가", count: BackendAccounts.labelLimit + 1)) == nil,
              "an over-long label is refused")

    // Seeding a new account home carries configuration, never a credential.
    for provider in BackendAccounts.providers {
        check(Set(BackendAccounts.seedFileNames(provider: provider))
                    .isDisjoint(with: BackendAccounts.credentialFileNames),
                  "\(provider) seeding excludes credential files")
    }
    let source = FileManager.default.temporaryDirectory.appendingPathComponent("os1-account-seed-\(UUID().uuidString)")
    let support = FileManager.default.temporaryDirectory.appendingPathComponent("os1-account-support-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: source); try? FileManager.default.removeItem(at: support) }
    try Data("model = 'x'".utf8).write(to: source.appendingPathComponent("config.toml"))
    try Data("secret".utf8).write(to: source.appendingPathComponent("auth.json"))
    let prepared = try BackendAccounts.prepareHome(provider: "codex", id: UUID().uuidString.lowercased(),
                                                   from: source, support: support)
    check(FileManager.default.fileExists(atPath: prepared.appendingPathComponent("config.toml").path),
              "configuration is carried into a new account")
    for name in BackendAccounts.credentialFileNames {
        check(!FileManager.default.fileExists(atPath: prepared.appendingPathComponent(name).path),
                  "a new account never receives \(name)")
    }

    // The store round-trips, stays owner-only, and holds nothing secret.
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-accounts-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("accounts.json")
    try BackendAccounts.save(second, to: url)
    check(BackendAccounts.load(from: url) == second, "the account file round-trips")
    // A verified account must survive the next read: writing the timestamp one
    // way and reading it another dropped every added account back to the
    // provider default, so the owner's second account vanished after one list.
    var verified = second
    for position in verified.accounts.indices {
        verified.accounts[position].signedIn = true
        verified.accounts[position].verifiedAt = Date(timeIntervalSince1970: 1_790_000_000)
    }
    try BackendAccounts.save(verified, to: url)
    let reread = BackendAccounts.load(from: url)
    check(reread == verified, "a verified account survives the round trip")
    check(reread.accounts.contains { !$0.isDefault }, "the added account is still there after a refresh")
    check(reread.active["claude"] == second.active["claude"], "the active account survives the round trip")
    let mode = (try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.int16Value
    check(mode == 0o600, "the account file is owner-only")
    let text = try String(contentsOf: url, encoding: .utf8).lowercased()
    for forbidden in ["token", "secret", "password", "apikey", "api_key", "refresh"] {
        check(!text.contains(forbidden), "the account file has no \(forbidden) field")
    }
    // A missing or corrupt file falls back to the default book instead of
    // leaving a run without a backend home.
    try Data("{".utf8).write(to: url)
    check(BackendAccounts.load(from: url) == fresh, "a corrupt account file falls back to the defaults")

    print("Backend accounts: \(checks) checks passed; default launch unchanged, no credential stored")
}
