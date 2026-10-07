import Foundation
import OS1Context

/// No CLI, account file, provider call, browser, or owner-home access.
func runBackendSetupFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) {
        precondition(value, "Backend setup: " + label); checks += 1
    }
    let time = Date(timeIntervalSince1970: 1_790_000_000)
    let codexID = BackendAccounts.defaultID(provider: "codex")
    let claudeID = BackendAccounts.defaultID(provider: "claude")
    func status(_ provider: String, _ stdout: String, stderr: String = "", exit: Int32 = 0) -> BackendSetupProvider {
        BackendSetup.parseStatus(provider: provider, executablePath: "/fixture/\(provider)",
            accountID: provider == "codex" ? codexID : claudeID, exitCode: exit,
            stdout: Data(stdout.utf8), stderr: Data(stderr.utf8), checkedAt: time)
    }
    let claude = status("claude", #"{"loggedIn":true,"email":"fixture@example.test","authMethod":"claude.ai"}"#)
    check(claude.state == .signedIn && claude.signedInAs == "fixture@example.test", "native Claude signed-in state")
    check(claude.authMethod == "claude.ai", "native subscription auth method retained")
    check(status("claude", #"{"loggedIn":false}"#, exit: 1).state == .signedOut,
          "native false is signed out even when status exits nonzero")
    for invalid in ["", "not JSON", "{}", #"{"loggedIn":"true"}"#, #"{"loggedIn":1}"#] {
        check(status("claude", invalid).state == .unverified, "malformed native status remains unverified")
    }
    check(status("claude", #"{"loggedIn":true}"#, exit: 1).state == .unverified, "unsuccessful true response is unverified")
    let apiClaude = status("claude", #"{"loggedIn":true,"email":"sk-fake-never-display","authMethod":"api_key"}"#)
    check(apiClaude.signedInAs == nil && apiClaude.authMethod == "api_key", "credential-shaped native descriptors are omitted")
    check(status("claude", #"{"loggedIn":true,"authMethod":"untrusted-secret"}"#).authMethod == nil,
          "unrecognized auth method is not echoed")
    let codex = status("codex", "", stderr: "Logged in using ChatGPT\n")
    check(codex.state == .signedIn && codex.authMethod == "chatgpt", "Codex status on stderr is recognized")
    check(status("codex", "Warning: configuration notice\n", stderr: "Logged in using ChatGPT\n").state == .signedIn,
          "unrelated CLI notices do not hide exact native status line")
    check(status("codex", "Logged in using ChatGPT\nNot logged in").state == .unverified,
          "conflicting native status lines remain unverified")
    check(status("codex", "Logged in using an API key - sk-private-example").signedInAs == "API key",
          "API key status retains only safe mode label")
    let secretStatus = status("codex", "Logged in using an API key - sk-private-example")
    check(!String(decoding: try JSONEncoder().encode(secretStatus), as: UTF8.self).contains("sk-private"), "no raw key in setup JSON")
    check(status("codex", "", stderr: "Not logged in\n", exit: 1).state == .signedOut, "confirmed Codex logout")
    check(status("codex", "Failed to connect while checking login", exit: 1).state == .unverified,
          "transport failure is not logout")
    check(status("codex", "Not logged in", exit: 0).state == .unverified, "contradictory Codex status stays unverified")
    check(status("codex", "Warning: logged in user maybe unknown", exit: 0).state == .unverified,
          "incidental words do not establish sign-in")

    var book = BackendAccounts.normalized(BackendAccountBook())
    for index in book.accounts.indices {
        book.accounts[index].signedIn = true
        book.accounts[index].signedInAs = "Previous account"
        book.accounts[index].verifiedAt = time.addingTimeInterval(-30)
    }
    let missing = BackendSetupProvider(provider: "codex", executablePath: nil, state: .missing,
                                       checkedAt: time, accountID: codexID)
    check(BackendSetup.applying([missing, status("claude", "")], to: book) == book,
          "missing executable and failed probe preserve prior account state")
    let refreshed = BackendSetup.applying([codex], to: book)
    check(refreshed.accounts.first { $0.provider == "codex" }?.signedInAs == "ChatGPT", "confirmed metadata is refreshed")
    check(refreshed.accounts.first { $0.provider == "claude" } == book.accounts.first { $0.provider == "claude" },
          "unprobed provider untouched")
    let logout = BackendSetup.applying([status("claude", #"{"loggedIn":false}"#, exit: 1)], to: book)
    check(logout.accounts.first { $0.provider == "claude" }?.signedIn == false,
          "verified native logout updates cached account")
    check(logout.active == book.active, "status checking never switches account")
    let unknownAccount = BackendSetupProvider(provider: "codex", executablePath: "/fixture", state: .signedOut,
                                              checkedAt: time, accountID: UUID().uuidString)
    check(BackendSetup.applying([unknownAccount], to: book) == book, "removed account not recreated")

    let candidates = BackendSetup.providerExecutableCandidates(provider: "codex", homePath: "/fixture/user")
    for root in ["/Applications", "/fixture/user/Applications"] {
        for app in ["Codex.app", "ChatGPT.app"] {
            check(candidates.contains("\(root)/\(app)/Contents/Resources/codex-cli/bin/codex"), "modern bundled CLI detected")
            check(candidates.contains("\(root)/\(app)/Contents/Resources/codex"), "legacy bundled CLI detected")
        }
    }
    check(BackendSetup.providerExecutableCandidates(provider: "other", homePath: "/fixture").isEmpty,
          "provider-specific discovery does not extend unrelated commands")
    let snapshot = BackendSetupSnapshot(book: refreshed, providers: [codex, claude], checkedAt: time)
    let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
    let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .iso8601
    check(try decoder.decode(BackendSetupSnapshot.self, from: encoder.encode(snapshot)) == snapshot,
          "typed discovery schema round-trips")
    check(codex.installURL == "https://developers.openai.com/codex/cli" &&
          claude.installURL == "https://code.claude.com/docs/en/setup", "installer destinations are official guides")

    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-login-lease-fixture-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    var first: BackendLoginLease? = try BackendLoginLease(root: root, provider: "codex", accountIdentity: "fixture-default")
    check(first!.tryAcquire(), "first setup login owns lease")
    let second = try BackendLoginLease(root: root, provider: "codex", accountIdentity: "fixture-default")
    check(!second.tryAcquire(), "second setup login cannot overlap")
    let another = try BackendLoginLease(root: root, provider: "claude", accountIdentity: "fixture-default")
    check(another.tryAcquire(), "unrelated provider setup independent")
    first = nil
    check(second.tryAcquire(), "lease is recoverable after owner releases")
    print("Backend setup: \(checks) checks passed; native discovery preserves unknown auth and credential boundaries")
}
