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
