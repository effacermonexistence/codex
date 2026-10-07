import AppKit
import OS1Context
import SwiftUI

@MainActor
private final class IdentityFixtureStorage: OS1IdentityStorage {
    var saved: OS1IdentityCredential?
    var writes = 0, removes = 0
    var rejectWrites = false
    func read() throws -> OS1IdentityCredential? { saved }
    func write(_ credential: OS1IdentityCredential) throws {
        if rejectWrites { throw AppIdentityError.storage }
        saved = credential; writes += 1
    }
    func remove() throws { saved = nil; removes += 1 }
}

@MainActor
private final class IdentityFixtureAuthenticator: OS1IdentityAuthenticating {
    var result = OS1IdentityCredential(profile: AppIdentityProfile(provider: .google, subject: "fixture-1", name: "Demo User", email: "demo@example.invalid"))
    var failure: Error?
    var calls = 0
    var suspend = false
    var pending: CheckedContinuation<OS1IdentityCredential, any Error>?
    func signIn(_ provider: AppIdentityProvider) async throws -> OS1IdentityCredential {
        calls += 1
        if let failure { throw failure }
        if suspend { return try await withCheckedThrowingContinuation { pending = $0 } }
        return result
    }
    func restore(_ credential: OS1IdentityCredential) async throws -> OS1IdentityCredential {
        try await signIn(credential.profile.provider)
    }
    func cancel() {} // Deliberately deliver a late success to test the model's generation guard.
}

private func profileCheck(_ value: Bool, _ label: String) throws {
    if !value { throw NSError(domain: "ProfileMenuTests", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
}

@MainActor
func profileMenuSelfTest() async throws {
    try await backendSetupSurfaceSelfTest()
    var checks = 0
    func check(_ value: Bool, _ label: String) throws { try profileCheck(value, label); checks += 1 }
    func rejects(_ label: String, _ body: () throws -> Void) throws {
        do { try body() } catch { checks += 1; return }
        try profileCheck(false, label)
    }
    let clientID = "123-fixture.apps.googleusercontent.com"
    let scheme = "com.googleusercontent.apps.123-fixture"
    let config = try GoogleIdentityConfiguration(clientID: clientID, registeredSchemes: [scheme])
    try rejects("missing registration must fail closed") { _ = try GoogleIdentityConfiguration(clientID: clientID, registeredSchemes: []) }
    try rejects("arbitrary client URL denied") { _ = try GoogleIdentityConfiguration(clientID: "https://example.invalid", registeredSchemes: []) }
    let transaction = GoogleIdentityRequest(configuration: config, state: "fixture-state",
        verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
    try check(transaction.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "RFC 7636 PKCE vector")
    let items = URLComponents(url: transaction.authorizationURL, resolvingAgainstBaseURL: false)!.queryItems!
    try check(items.first { $0.name == "scope" }?.value == "openid email profile", "identity-only scopes")
    try check(!transaction.authorizationURL.absoluteString.contains(transaction.verifier), "verifier not leaked into authorize URL")
    try check(try transaction.authorizationCode(from: URL(string: scheme + ":/oauthredirect?state=fixture-state&code=example-code")!) == "example-code", "exact callback accepted")
    for bad in [
        "other:/oauthredirect?state=fixture-state&code=c",
        scheme + "://foreign/oauthredirect?state=fixture-state&code=c",
        scheme + ":/wrong?state=fixture-state&code=c",
        scheme + ":/oauthredirect?state=wrong&code=c",
        scheme + ":/oauthredirect?code=c",
        scheme + ":/oauthredirect?state=fixture-state&state=fixture-state&code=c",
        scheme + ":/oauthredirect?state=fixture-state&state&code=c",
        scheme + ":/oauthredirect?state=fixture-state&code=c&code=d",
        scheme + ":/oauthredirect?state=fixture-state&code=c&error=denied",
        scheme + ":/oauthredirect?state=fixture-state&code=c&error",
        scheme + ":/oauthredirect?state=fixture-state&error=access_denied",
        scheme + ":/oauthredirect?state=fixture-state&code=c#fragment"
    ] { try rejects("malformed, duplicate, error or mismatched callbacks rejected") { _ = try transaction.authorizationCode(from: URL(string: bad)!) } }
    let encoded = String(decoding: transaction.tokenBody(code: "a+b&c="), as: UTF8.self)
    try check(encoded.contains("code=a%2Bb%26c%3D") && encoded.contains("code_verifier="), "token body encoding and PKCE")
    try check(AppIdentityProfile(provider: .apple, subject: "a", name: "  Ada Lovelace  ", email: nil).initials == "AL", "profile initials")
    try check(AppIdentityProfile(provider: .google, subject: "g", name: "", email: nil).displayName == "Google", "no host-user identity inference")

    let registered = OS1IdentityConfiguration(google: config, appleEnabled: true)
    let storage = IdentityFixtureStorage(), driver = IdentityFixtureAuthenticator()
    let model = OS1IdentityModel(configuration: registered, storage: storage, authenticator: driver)
    try check(model.profile == nil && storage.writes == 0, "construction performs no authentication or keychain read")
    await model.signIn(.google)
    try check(model.profile == driver.result.profile && storage.writes == 1 && !model.busy, "verified sign-in adopted after storage")
    model.signOut()
    try check(model.profile == nil && storage.saved == nil && storage.removes == 1, "logout removes only injected OS1 identity")
    let unconfigured = OS1IdentityModel(configuration: .init(google: nil, appleEnabled: false), storage: storage, authenticator: driver)
    let calls = driver.calls
    await unconfigured.signIn(.google); await unconfigured.signIn(.apple)
    try check(driver.calls == calls && unconfigured.profile == nil && unconfigured.notice != nil, "unconfigured providers make no network call")

    storage.rejectWrites = true
    await model.signIn(.google)
    try check(model.profile == nil && storage.saved == nil && !model.busy, "failed keychain write cannot imply sign-in")
    storage.rejectWrites = false
    driver.failure = AppIdentityError.cancelled
    await model.signIn(.google)
    try check(model.profile == nil && !model.busy && model.notice != nil, "cancel leaves guest and permits retry")
    driver.failure = nil; driver.suspend = true
    let pending = Task { await model.signIn(.google) }
    await Task.yield()
    try check(model.busy, "pending auth is busy")
    let pendingCalls = driver.calls
    await model.signIn(.google)
    try check(driver.calls == pendingCalls, "duplicate sign-in rejected")
    model.cancel()
    driver.pending?.resume(returning: driver.result); driver.pending = nil
    await pending.value
    try check(model.profile == nil && storage.saved == nil, "late success after cancellation cannot restore login")
    driver.suspend = false

    storage.saved = driver.result
    driver.failure = AppIdentityError.expired
    await model.restoreIfNeeded(force: true)
    try check(model.profile == nil && storage.saved == nil, "revoked/expired session is discarded")
    storage.saved = driver.result
    driver.failure = NSError(domain: "token=DO_NOT_DISPLAY", code: 1)
    await model.restoreIfNeeded(force: true)
    try check(model.profile == nil && storage.saved != nil && model.notice?.contains("DO_NOT_DISPLAY") != true, "network error preserves cache but not signed-in claim; raw errors hidden")
    driver.failure = nil
    await model.restoreIfNeeded(force: true)
    try check(model.profile == driver.result.profile, "restoration requires provider verification")
    storage.saved = nil
    await model.restoreIfNeeded(force: true)
    try check(model.profile == nil, "logout in another window clears a previously displayed identity on refresh")
    storage.saved = driver.result
    driver.result.profile.subject = "wrong-subject"
    await model.restoreIfNeeded(force: true)
    try check(model.profile == nil && storage.saved?.profile.subject == "fixture-1", "restored subject mismatch rejected")
    driver.result.profile = AppIdentityProfile(provider: .apple, subject: "apple-1", name: "", email: nil)
    storage.saved = OS1IdentityCredential(profile: .init(provider: .apple, subject: "apple-1", name: "Apple Demo", email: "relay@example.invalid"))
    await model.signIn(.apple)
    try check(model.profile?.name == "Apple Demo" && model.profile?.email == "relay@example.invalid", "Apple first-consent fields preserved for same subject")
    driver.result.profile.subject = "apple-2"
    await model.signIn(.apple)
    try check(model.profile?.name == "" && model.profile?.email == nil, "Apple different subject never inherits previous name or email")

    let now = Date()
    let snapshot = try profileUsageFixture(now: now)
    let summary = AppUsageSummary(snapshot: snapshot, now: now)
    try check(summary.days.count == 7 && summary.tasks == 8, "seven-day calendar buckets and task counts")
    try check(summary.tokens == 73_900 && summary.measuredAttempts == 8, "measured usage includes retry/mixed provider cost once")
    try check(summary.unmeteredTasks == 1, "missing measurement preserved")
    try check(AppUsageSummary(snapshot: snapshot, provider: "codex", now: now).tokens == 73_100, "Codex filter")
    try check(AppUsageSummary(snapshot: snapshot, provider: "claude", now: now).tokens == 800, "Claude filter does not include Codex cost")
    try check(AppUsageSummary(snapshot: GovernanceSnapshot(), now: now).measuredAttempts == 0, "empty measurement is unknown, not a quota percentage")
    var expanded = snapshot
    var future = snapshot.tasks[0]; future.startedAt = now.addingTimeInterval(86_400)
    var old = snapshot.tasks[0]; old.startedAt = now.addingTimeInterval(-864_000)
    expanded.tasks += [future, old]
    try check(AppUsageSummary(snapshot: expanded, now: now).tokens == summary.tokens, "future and out-of-window tasks excluded")
    try check(Set(ProfileDestination.allCases) == Set([.account, .usage, .governance, .backends, .settings]), "all requested menu destinations present")
    var navigation = ProfileNavigationState()
    for destination in [ProfileDestination.account, .usage, .settings, .backends] {
        navigation.select(destination)
        try check(navigation.sheet == destination && !navigation.governanceOpen, "menu destination opens the matching sheet")
    }
    navigation.select(.governance)
    try check(navigation.sheet == nil && navigation.governanceOpen, "monitor opens outside the sheet")
    navigation.select(.settings); navigation.select(.backends)
    try check(navigation.sheet == .backends && navigation.governanceOpen, "settings-to-backends stays in one sheet without losing the underlying page")
    navigation.sheet = nil; navigation.governanceOpen = false
    try check(navigation == ProfileNavigationState(), "dismiss restores navigation")
    print("Profile/account: \(checks) checks passed; mock authentication only; provider calls 0; live keychain writes 0")
}

/// Synthetic, privacy-safe chart data. Never used by the production model.
func profileUsageFixture(now: Date = Date()) throws -> GovernanceSnapshot {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-profile-fixture-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = GovernanceActivityStore(root: root)
    let scope = CompletionFeedbackScope(objectiveSHA256: String(repeating: "a", count: 64), sourceSHA256: nil,
        executorContractSHA256: String(repeating: "b", count: 64), assembledInputSHA256: String(repeating: "c", count: 64))
    for (index, tokens) in [3_000, 8_400, 5_400, 12_800, 9_700, 18_600, 15_200].enumerated() {
        let id = UUID().uuidString.lowercased()
        let date = Calendar.current.date(byAdding: .day, value: index - 6, to: now)!
        try store.begin(id: id, now: date)
        for (provider, amount) in index == 6 ? [("codex", tokens), ("claude", 800)] : [("codex", tokens)] {
            let executionID = UUID().uuidString.lowercased()
            let usage = CompletionMeasuredUsage(inputTokens: amount - 200, outputTokens: 200, cacheTokens: 100,
                resource: CompletionUsageResourceMetadata(format: provider == "codex" ? .codexRolloutJSONL : .claudeResultJSON,
                    byteCount: 100, sha256: String(repeating: "d", count: 64), usageRecordCount: 1, accountingVersion: provider == "codex" ? 2 : 1))
            let observation = CompletionFeedbackObservation(executionID: executionID, sequence: 1,
                provider: provider, model: "fixture", effort: "fixture", outcome: .adopted, usage: usage, durationMS: 1_000)
            try store.attempt(id: id, executionID: executionID, sequence: 1, scope: scope, provider: provider,
                model: "fixture", effort: "fixture", startedAt: date, observation: observation)
            try store.finish(id: id, adopted: true, now: date)
        }
    }
    try store.begin(id: UUID().uuidString.lowercased(), now: now)
    return store.snapshot(legacyRoot: nil)
}

@MainActor
func renderProfilePreviews(to output: URL) throws {
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    let fixture = try profileUsageFixture()
    let profile = AppIdentityProfile(provider: .google, subject: "fixture", name: "Demo User", email: "demo@example.invalid")
    var metrics: [[String: Any]] = []
    func render<V: View>(_ name: String, _ content: V, width: CGFloat, height: CGFloat? = nil) throws {
        let view = NSHostingView(rootView: content.environment(\.colorScheme, .dark))
        view.frame = NSRect(x: 0, y: 0, width: width, height: height ?? view.fittingSize.height)
        view.layoutSubtreeIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw AppIdentityError.invalidResponse }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw AppIdentityError.invalidResponse }
        try png.write(to: output.appendingPathComponent(name + ".png"))
        var lightPixels = 0, accentPixels = 0
        for y in 0..<bitmap.pixelsHigh {
            for x in 0..<bitmap.pixelsWide {
                guard let c = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                if c.redComponent > 0.65 && c.greenComponent > 0.65 && c.blueComponent > 0.65 { lightPixels += 1 }
                if c.greenComponent > c.redComponent + 0.12 && c.greenComponent > 0.35 { accentPixels += 1 }
            }
        }
        try profileCheck(lightPixels > 200, "rendered content missing: " + name)
        if name == "menu-signed-in" || name == "usage" { try profileCheck(accentPixels > 200, "rendered accent/chart missing: " + name) }
        metrics.append(["file": name + ".png", "widthPoints": view.frame.width, "heightPoints": view.frame.height,
                        "widthPixels": bitmap.pixelsWide, "heightPixels": bitmap.pixelsHigh,
                        "lightPixels": lightPixels, "accentPixels": accentPixels])
    }
    for language in ["ko", "en"] {
        setenv("OS1_INTERFACE_LANGUAGE", language, 1); OS1Localization.invalidate()
        try render("menu-guest-" + language, ProfileMenuView(profile: nil, select: { _ in }, signOut: {}), width: ProfileStyle.width)
    }
    setenv("OS1_INTERFACE_LANGUAGE", "ko", 1); OS1Localization.invalidate()
    try render("menu-signed-in", ProfileMenuView(profile: profile, usage: AppUsageSummary(snapshot: fixture), select: { _ in }, signOut: {}), width: ProfileStyle.width)
    let model = OS1IdentityModel(configuration: .init(google: nil, appleEnabled: false),
        storage: IdentityFixtureStorage(), authenticator: IdentityFixtureAuthenticator())
    try render("account", OS1IdentityPanel(model: model), width: 560, height: 550)
    try render("usage", ProfileUsageView(model: ProfileUsageModel(snapshot: fixture), preview: true), width: 640, height: 510)
    try render("usage-empty", ProfileUsageView(model: ProfileUsageModel(snapshot: GovernanceSnapshot()), preview: true), width: 640, height: 510)
    let record: [String: Any] = ["syntheticFixturesOnly": true, "providerCalls": 0, "keychainWrites": 0, "renders": metrics]
    try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys])
        .write(to: output.appendingPathComponent("render-metrics.json"))
    print("Profile previews: \(metrics.count) renders, pixel checks passed; synthetic fixture; model calls 0; keychain writes 0")
}
