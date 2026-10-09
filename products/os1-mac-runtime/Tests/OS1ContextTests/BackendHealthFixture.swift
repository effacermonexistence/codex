import Foundation
import OS1Context

/// Backend health is the evidence behind self-repair: classification from
/// catalog notes, an honest cache (stale = unknown), the repair order, and the
/// public wording that the app and the fleet rely on.
func runBackendHealthFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Backend health: " + message); count += 1
    }
    let reset = Date(timeIntervalSince1970: 1_789_851_075) // 2026-09-19T20:51:15Z
    let now = Date(timeIntervalSince1970: 1_789_300_000)

    // Classification from the Codex catalog's exclusion notes.
    let quota = BackendHealth.codexBackend(modelCount: 0,
        source: "native account model/list · Codex 사용량 한도 도달로 3개 모델 제외, 리셋 2026-09-19 20:51 GMT; 계정 기본 지시문(839KB)을 담지 못하는 모델 제외: gpt-5.1-codex-mini",
        resetsAt: reset, executablePresent: true)
    check(quota.state == .quotaExhausted && quota.recoversAt == reset, "quota exhaustion wins over the context-budget note and keeps the reset")
    check(BackendHealth.codexBackend(modelCount: 0, source: "x · 계정 기본 지시문(839KB)을 담지 못하는 모델 제외: a", resetsAt: nil, executablePresent: true).state == .contextBudget,
          "context-budget-only exclusion")
    // The same notes written by a probe that ran in the English interface.
    check(BackendHealth.codexBackend(modelCount: 0,
            source: "native account model/list · Codex usage limit reached: excluded 3 model(s), resets 2026-09-19 20:51 GMT",
            resetsAt: reset, executablePresent: true).state == .quotaExhausted
          && BackendHealth.codexBackend(modelCount: 0,
            source: "x · Excluded models that cannot hold the account's base instructions (839KB): a",
            resetsAt: nil, executablePresent: true).state == .contextBudget,
          "English catalog notes classify the same way")
    check(BackendHealth.codexBackend(modelCount: 0, source: "native account metadata unavailable", resetsAt: nil, executablePresent: false).state == .missing,
          "missing executable")
    check(BackendHealth.codexBackend(modelCount: 0, source: "native account metadata unavailable", resetsAt: nil, executablePresent: true).state == .probeFailed,
          "unexplained empty catalog is a failed probe, not a guess")
    check(BackendHealth.codexBackend(modelCount: 1, source: "Codex 사용량 한도 도달로 2개 모델 제외", resetsAt: reset, executablePresent: true).usable,
          "a surviving model keeps Codex usable despite partial exclusion")
    let off = BackendHealth.codexBackend(modelCount: 0, source: BackendHealth.disabledCatalogSource, resetsAt: nil, executablePresent: true)
    check(off.state == .disabled && !off.usable, "settings-disabled Codex is its own state, not a failure")
    check(BackendHealth(claude: BackendHealth.Backend(state: .usable), codex: off, checkedAt: now).repairSteps.isEmpty,
          "a disabled backend produces no repair step")

    // Repair order and public wording.
    let dead = BackendHealth(claude: BackendHealth.Backend(state: .loggedOut, detail: "OAuth 세션 만료"),
                             codex: quota, checkedAt: now)
    check(!dead.anyUsable && dead.repairSteps == [.reconnectClaude, .waitCodexQuota], "repair order: login first, then wait for quota")
    check(dead.earliestRecovery == reset, "earliest recovery is the Codex reset")
    // The reset renders in the machine's zone: 2026-09-19 20:51Z is the 19th
    // west of UTC+3 and the 20th from UTC+4 eastwards.
    check(dead.diagnosisLines.count == 2 && dead.diagnosisLines[0].contains("CLI 로그인 미확인") && dead.diagnosisLines[1].contains("한도 소진")
          && (dead.diagnosisLines[1].contains("9월 19일") || dead.diagnosisLines[1].contains("9월 20일")) && dead.diagnosisLines[1].contains("에 복구"),
          "diagnosis names both causes and the reset day: \(dead.diagnosisLines)")
    check(dead.publicSummary.hasPrefix("사용 가능한 백엔드가 없습니다.") && dead.publicSummary.contains("공식 Claude 로그인")
          && dead.publicSummary.contains("Codex 한도 복구"), "public summary announces the login repair and the quota wait")
    let hold = dead.holdMessage(repairNote: "공식 Claude 로그인이 완료되지 않았습니다.")
    check(hold.contains("요청은 보존했습니다") && hold.contains("- Claude:") && hold.contains("- Codex:")
          && hold.contains("자가 복구 결과: 공식 Claude 로그인이 완료되지 않았습니다.") && hold.contains("자동으로 이어서 실행합니다"),
          "hold message carries diagnosis, repair result and the automatic replay promise")
    check(dead.waitingStatus.contains("Claude 로그인 승인") && dead.waitingStatus.contains("Codex 한도 복구"), "waiting status names both triggers")
    let alive = BackendHealth(claude: BackendHealth.Backend(state: .usable), codex: BackendHealth.Backend(state: .usable), checkedAt: now)
    check(alive.anyUsable && alive.repairSteps.isEmpty && alive.repairPlanText.contains("없습니다"), "usable backends need no repair")
    let onlyCodex = BackendHealth(claude: BackendHealth.Backend(state: .missing), codex: BackendHealth.Backend(state: .usable), checkedAt: now)
    check(onlyCodex.anyUsable && onlyCodex.repairSteps.isEmpty, "a missing Claude binary is not a repairable login")

    let codexFallback = BackendHealth(claude: BackendHealth.Backend(state: .loggedOut), codex: BackendHealth.Backend(state: .usable), checkedAt: now)
    check(codexFallback.repairSteps.isEmpty, "usable Codex must never start a destructive Claude login")
    let quotaFallback = BackendHealth(claude: BackendHealth.Backend(state: .quotaExhausted), codex: BackendHealth.Backend(state: .usable), checkedAt: now)
    check(quotaFallback.repairSteps.isEmpty, "quota is not an authentication repair")

    // Native plan metadata is separate from the configured 30/100 capacity mix.
    let formatter = ISO8601DateFormatter()
    let quotaReset = now.addingTimeInterval(600)
    func window(_ kind: String, _ percent: Any, model: String? = nil, active: Bool = false,
                reset: Date? = quotaReset) -> [String: Any] {
        ["kind": kind, "percent": percent, "severity": "normal", "is_active": active,
         "resets_at": reset.map { formatter.string(from: $0) as Any } ?? NSNull(),
         "scope": model.map { ["model": ["display_name": $0], "surface": NSNull()] as Any } ?? NSNull()]
    }
    func usage(_ rows: [[String: Any]]) -> [String: Any] {
        ["rate_limits_available": true, "rate_limits": ["limits": rows]]
    }
    let nativeQuota = BackendHealth.QuotaSnapshot.claudeUsage(usage([
        window("session", 14), window("weekly_all", 99, active: true),
        window("weekly_scoped", 6, model: "Fable")]), accountID: "claude.default", observedAt: now)!
    check(nativeQuota.source == .claudeNative && nativeQuota.windows.count == 3, "native server windows preserved")
    check(nativeQuota.effectiveRemaining(accountID: "claude.default", model: "claude-fable-5-1[1m]", now: now) == 1,
          "global weekly 1% constrains Fable's separate 94%, never replaced by model headroom")
    check(nativeQuota.effectiveRemaining(accountID: "claude.default", now: now) == 1 &&
          nativeQuota.limitingReset(accountID: "claude.default", now: now) == quotaReset, "provider summary uses all general windows")
    check(nativeQuota.isFresh(accountID: "claude.default", now: now.addingTimeInterval(120)), "snapshot bounded to 120 seconds")
    check(nativeQuota.effectiveRemaining(accountID: "claude.default", now: now.addingTimeInterval(121)) == nil,
          "stale quota is unknown, not full or exhausted")
    check(nativeQuota.effectiveRemaining(accountID: "another-account", now: now) == nil, "account selection binds the observation")
    check(!nativeQuota.isFresh(accountID: "claude.default", now: now.addingTimeInterval(-1)), "future quota timestamp is unknown")
    let scopedQuota = BackendHealth.QuotaSnapshot.claudeUsage(usage([
        window("weekly_all", 20), window("weekly_scoped", 100, model: "Fable")]), accountID: "claude.default", observedAt: now)!
    check(scopedQuota.effectiveRemaining(accountID: "claude.default", model: "fable", now: now) == 0,
          "matching model exhaustion is hard, even when general quota remains")
    check(scopedQuota.effectiveRemaining(accountID: "claude.default", model: "opus", now: now) == 80,
          "other model's scoped limit does not block Opus")
    let nonHeadline = BackendHealth.QuotaSnapshot.claudeUsage(usage([
        window("session", 100, active: false), window("weekly_all", 20, active: true)]), accountID: "claude.default", observedAt: now)!
    check(nonHeadline.effectiveRemaining(accountID: "claude.default", now: now) == 0,
          "is_active is display metadata, not permission to ignore another general limit")
    let soon = BackendHealth.QuotaSnapshot.claudeUsage(usage([
        window("session", 99, reset: now.addingTimeInterval(1))]), accountID: "claude.default", observedAt: now)!
    check(soon.effectiveRemaining(accountID: "claude.default", now: now.addingTimeInterval(1)) == nil,
          "reset crossing invalidates quota; no inferred replenishment")
    let noReset = BackendHealth.QuotaSnapshot.claudeUsage(usage([window("session", 0, reset: nil)]),
        accountID: "claude.default", observedAt: now)!
    check(noReset.effectiveRemaining(accountID: "claude.default", now: now) == 100 &&
          noReset.limitingReset(accountID: "claude.default", now: now) == nil, "observed zero usage differs from unknown reset")
    check(BackendHealth.QuotaSnapshot.claudeUsage(["rate_limits_available": true,
        "rate_limits": ["five_hour": ["utilization": 14]]], accountID: "claude.default", observedAt: now) == nil,
          "legacy utilization bars without live rows are not fresh quota evidence")
    check(BackendHealth.QuotaSnapshot.claudeUsage(["rate_limits_available": false,
        "rate_limits": ["limits": [window("session", 14)]]], accountID: "claude.default", observedAt: now) == nil,
          "API-key/non-plan lane is unknown")
    check(BackendHealth.QuotaSnapshot.claudeUsage(usage([]), accountID: "claude.default", observedAt: now) == nil,
          "empty rows do not mean 100% available")
    for value in [true, 101, -1, "99", NSNull()] as [Any] {
        check(BackendHealth.QuotaSnapshot.claudeUsage(usage([window("session", value)]), accountID: "claude.default", observedAt: now) == nil,
              "invalid percent cannot enter a quota snapshot")
    }
    var unknownScope = window("weekly_scoped", 100)
    unknownScope["scope"] = ["unrecognized": "future surface"]
    check(BackendHealth.QuotaSnapshot.claudeUsage(usage([unknownScope]), accountID: "claude.default", observedAt: now) == nil,
          "unknown scope cannot be widened to all models")
    var badDate = window("session", 99); badDate["resets_at"] = "not-a-date"
    check(BackendHealth.QuotaSnapshot.claudeUsage(usage([badDate]), accountID: "claude.default", observedAt: now) == nil,
          "invalid reset remains unknown")
    check(BackendHealth.QuotaSnapshot.claudeUsage(usage(Array(repeating: window("session", 0), count: 65)),
        accountID: "claude.default", observedAt: now) == nil, "bounded native quota rows")
    var quotaBackend = BackendHealth.Backend(state: .usable); quotaBackend.quota = nativeQuota
    let quotaHealth = BackendHealth(claude: quotaBackend, codex: .init(state: .usable), checkedAt: now)
    let roundTrip = try JSONDecoder().decode(BackendHealth.self, from: JSONEncoder().encode(quotaHealth))
    check(roundTrip == quotaHealth, "public optional quota metadata round-trips without credentials")
    var crossingBackend = BackendHealth.Backend(state: .usable); crossingBackend.quota = soon
    check(BackendHealth(claude: crossingBackend, codex: .init(state: .usable), checkedAt: now).resetCrossed(at: now.addingTimeInterval(1)),
          "native quota reset also triggers health refresh")
    check(CapacityMix.defaultCodex == 30 && CapacityMix.defaultClaude == 100 &&
          nativeQuota.effectiveRemaining(accountID: "claude.default", now: now) == 1,
          "configured capacity remains distinct from measured remaining quota")
    let codexBody: [String: Any] = ["rateLimitsByLimitId": [
        "codex": ["primary": ["usedPercent": 90, "resetsAt": quotaReset.timeIntervalSince1970],
                  "secondary": ["usedPercent": 39, "resetsAt": now.addingTimeInterval(2_000).timeIntervalSince1970]],
        "exact-model": ["limitName": "gpt-test", "primary": ["usedPercent": 100, "resetsAt": quotaReset.timeIntervalSince1970]],
        "unknown-label": ["limitName": "Friendly model name", "primary": ["usedPercent": 100, "resetsAt": quotaReset.timeIntervalSince1970]]]]
    let codexQuota = BackendHealth.QuotaSnapshot.codexRateLimits(codexBody, accountID: "codex.default",
        models: ["gpt-test"], observedAt: now)!
    check(codexQuota.windows.count == 3 && codexQuota.effectiveRemaining(accountID: "codex.default", now: now) == 10,
          "shorter Codex 10% window constrains longer 61%; unknown friendly label never becomes general")
    check(codexQuota.effectiveRemaining(accountID: "codex.default", model: "gpt-test", now: now) == 0 &&
          codexQuota.effectiveRemaining(accountID: "codex.default", model: "other-model", now: now) == 10,
          "Codex scoped bucket requires exact native model slug")
    let legacyQuota = BackendHealth.QuotaSnapshot.codexRateLimits(["rateLimits": ["limitId": "codex",
        "primary": ["usedPercent": 39, "resetsAt": quotaReset.timeIntervalSince1970]]],
        accountID: "codex.default", models: [], observedAt: now)
    check(legacyQuota?.effectiveRemaining(accountID: "codex.default", now: now) == 61, "native legacy single bucket remains supported")
    check(BackendHealth.QuotaSnapshot.codexRateLimits(["rateLimitsByLimitId": [:]], accountID: "codex.default",
        models: [], observedAt: now) == nil, "missing Codex windows remain unknown")
    check(BackendHealth.QuotaSnapshot.codexRateLimits(["rateLimitsByLimitId": ["codex": ["primary": ["usedPercent": true]]]],
        accountID: "codex.default", models: [], observedAt: now) == nil, "Codex boolean cannot become a percentage")
    check(BackendHealth.QuotaSnapshot.codexRateLimits(["rateLimitsByLimitId": ["codex": ["primary": [
        "usedPercent": 100, "resetsAt": now.addingTimeInterval(-1).timeIntervalSince1970]]]],
        accountID: "codex.default", models: [], observedAt: now) == nil, "reset windows are not renewed by inference")

    // Cache: round trip, staleness, future timestamps, oversize and garbage.
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-backend-health-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("backend-health.json")
    try dead.save(to: url)
    check((try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "record is private")
    let loaded = BackendHealth.load(from: url, maxAge: 120, now: now.addingTimeInterval(60))
    check(loaded != nil && loaded!.codex.recoversAt.map { abs($0.timeIntervalSince(reset)) < 1 } == true
          && loaded!.claude.state == .loggedOut && loaded!.claude.detail == "OAuth 세션 만료", "round trip keeps states, detail and reset")
    check(BackendHealth.load(from: url, maxAge: 120, now: now.addingTimeInterval(121)) == nil, "stale record reads as unknown")
    check(BackendHealth.load(from: url, maxAge: 120, now: now.addingTimeInterval(-60)) == nil, "future-dated record reads as unknown")
    check(BackendHealth.load(from: root.appendingPathComponent("absent.json"), maxAge: 120, now: now) == nil, "absent record reads as unknown")
    try Data("{\"claude\":".utf8).write(to: url)
    check(BackendHealth.load(from: url, maxAge: 120, now: now) == nil, "garbage reads as unknown")
    try Data(repeating: 32, count: 20_000).write(to: url)
    check(BackendHealth.load(from: url, maxAge: 120, now: now) == nil, "oversize record reads as unknown")
    let backoffURL = root.appendingPathComponent("quota.json")
    check(ClaudeQuotaBackoff.active(at: backoffURL, now: now) == nil, "no invented cooldown")
    try ClaudeQuotaBackoff.record(at: backoffURL, now: now)
    check(ClaudeQuotaBackoff.active(at: backoffURL, now: now.addingTimeInterval(299)) != nil, "real rejection suppresses metadata-only availability")
    check(ClaudeQuotaBackoff.active(at: backoffURL, now: now.addingTimeInterval(300)) == nil, "bounded cooldown expires")
    check(ClaudeQuotaBackoff.active(at: backoffURL, now: now.addingTimeInterval(-1)) == nil, "future rejection rejected")
    check((try FileManager.default.attributesOfItem(atPath: backoffURL.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "quota receipt private")
    try ClaudeQuotaBackoff.record(at: backoffURL, now: now.addingTimeInterval(250))
    check(ClaudeQuotaBackoff.active(at: backoffURL, now: now.addingTimeInterval(400)) != nil, "new rejection renews cooldown")
    try Data("not-json".utf8).write(to: backoffURL)
    check(ClaudeQuotaBackoff.active(at: backoffURL, now: now) == nil, "corrupt receipt not adopted")
    // Per-model receipts: separate files, 1 h cooldown, legacy account file unchanged.
    let legacyURL = root.appendingPathComponent("legacy-quota.json")
    try Data(#"{"observedAt":811898883.695509,"retryAfter":811899183.695509}"#.utf8).write(to: legacyURL)
    check(ClaudeQuotaBackoff.active(at: legacyURL, now: Date(timeIntervalSinceReferenceDate: 811_898_900)) != nil, "legacy account receipt still decodes")
    try ClaudeQuotaBackoff.record(at: backoffURL, now: now)
    check(!String(decoding: try Data(contentsOf: backoffURL), as: UTF8.self).contains("model"), "account receipt format unchanged")
    let modelDirectory = root.appendingPathComponent("model-backoff", isDirectory: true)
    check(ClaudeQuotaBackoff.activeModels(directory: modelDirectory, now: now).isEmpty, "no invented model cooldown")
    try ClaudeQuotaBackoff.record(model: "fable", directory: modelDirectory, now: now)
    check(ClaudeQuotaBackoff.active(model: "fable", directory: modelDirectory, now: now.addingTimeInterval(3_599)) != nil, "model cooldown active")
    check(ClaudeQuotaBackoff.active(model: "fable", directory: modelDirectory, now: now.addingTimeInterval(3_600)) == nil, "model cooldown expires after 1 h")
    check(ClaudeQuotaBackoff.active(model: "fable", directory: modelDirectory, now: now.addingTimeInterval(-1)) == nil, "future model rejection rejected")
    check(ClaudeQuotaBackoff.active(model: "opus", directory: modelDirectory, now: now) == nil, "other models unaffected")
    check(ClaudeQuotaBackoff.activeModels(directory: modelDirectory, now: now) == ["fable"], "active model list")
    check(ClaudeQuotaBackoff.activeModels(directory: modelDirectory, now: now.addingTimeInterval(3_600)).isEmpty, "expired model not listed")
    let fableURL = ClaudeQuotaBackoff.modelURL("fable", directory: modelDirectory)!
    check(ClaudeQuotaBackoff.active(at: fableURL, now: now) == nil, "model receipt never read as account receipt")
    check(ClaudeQuotaBackoff.active(at: modelDirectory.appendingPathComponent("claude-quota-backoff.json"), now: now) == nil, "model receipt does not create an account receipt")
    check((try FileManager.default.attributesOfItem(atPath: fableURL.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600, "model receipt private")
    try Data(#"{"observedAt":0,"retryAfter":3600}"#.utf8).write(to: ClaudeQuotaBackoff.modelURL("opus", directory: modelDirectory)!)
    check(ClaudeQuotaBackoff.active(model: "opus", directory: modelDirectory, now: Date(timeIntervalSinceReferenceDate: 10)) == nil, "account-shaped file is not a model receipt")
    for bad in ["../x", "Fable", String(repeating: "a", count: 33), ""] {
        try ClaudeQuotaBackoff.record(model: bad, directory: modelDirectory, now: now)
    }
    check(try FileManager.default.contentsOfDirectory(atPath: modelDirectory.path).sorted() ==
          ["claude-quota-backoff.model-fable.json", "claude-quota-backoff.model-opus.json"], "invalid family writes nothing")
    let crossed = BackendHealth(claude: .init(state: .quotaExhausted, recoversAt: now.addingTimeInterval(10)),
                                codex: .init(state: .usable), checkedAt: now)
    check(!crossed.resetCrossed(at: now), "future reset not crossed")
    check(crossed.resetCrossed(at: now.addingTimeInterval(10)), "reset crossing detected even with Codex usable")
    check(BackendHealth.shouldProbe(lastStartedAt: nil, inFlight: false, health: nil, now: now), "startup probe")
    check(BackendHealth.shouldProbe(lastStartedAt: now, inFlight: false, health: crossed, now: now.addingTimeInterval(10)), "reset triggers probe")
    check(!BackendHealth.shouldProbe(lastStartedAt: nil, inFlight: true, health: crossed, now: now), "no overlapping probes")
    check(!BackendHealth.shouldProbe(lastStartedAt: now, inFlight: false, health: nil, now: now.addingTimeInterval(59)), "bounded polling")
    check(BackendHealth.shouldProbe(lastStartedAt: now, inFlight: false, health: nil, now: now.addingTimeInterval(60)), "poll without waiting jobs")
    let crossedURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: crossedURL) }
    try crossed.save(to: crossedURL)
    check(BackendHealth.load(from: crossedURL, maxAge: 90, now: now.addingTimeInterval(11)) == nil, "reset invalidates old cache, not permission to run")
    check(BackendRecovery.quotaRecoveryPreference(requested: "auto", failed: "codex", codexAvailable: true, claudeAvailable: true) == "claude", "quota failure prefers other usable provider")
    check(BackendRecovery.quotaRecoveryPreference(requested: "auto", failed: "codex", codexAvailable: true, claudeAvailable: false) == "codex", "remaining Codex model if Claude unavailable")
    check(BackendRecovery.undispatchedAttemptLimit(requested: "auto", stage: .notDispatched, blocker: .capabilityUnavailable, step: 1, limit: 1, alreadyExtended: false, alternateAvailable: true) == 2, "undispatched transport failure gets alternate")
    check(BackendRecovery.undispatchedAttemptLimit(requested: "auto", stage: .dispatched, blocker: .capabilityUnavailable, step: 1, limit: 1, alreadyExtended: false, alternateAvailable: true) == 1, "started work never replayed")
    check(BackendRecovery.undispatchedAttemptLimit(requested: "auto", stage: .notDispatched, blocker: .capabilityUnavailable, step: 2, limit: 2, alreadyExtended: true, alternateAvailable: true) == 2, "alternate bounded once")
    print("Backend health: \(count) checks passed; classification, repair order, wording, private cache and staleness")
}
