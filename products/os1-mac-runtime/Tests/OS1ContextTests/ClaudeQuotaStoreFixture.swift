import Foundation
import OS1Context

/// The shared Claude quota observation (2026-10-19). Fixture values only: no
/// provider, account, probe process or live OS-1 state is touched; every
/// file lives in a private temporary directory.
///
/// Source incident (2026-10-19, build 405): Anthropic's usage endpoint
/// refused about every second refresh with HTTP 429, the CLI answered with a
/// fallback body without live rows, every writer replaced the health record's
/// Claude quota with nothing, and the catalog held the Claude pool as unknown
/// quota, so a standard task bound Codex at 10% remaining while Claude had 97%.
func runClaudeQuotaStoreFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Claude quota store: " + message); count += 1
    }
    let now = Date(timeIntervalSince1970: 1_792_300_000)
    let account = "claude.default"
    let weeklyReset = now.addingTimeInterval(5 * 86_400)
    func snapshot(observedAt: Date, session: Double = 9, weekly: Double = 3, account: String = account,
                  sessionReset: Date? = nil) -> BackendHealth.QuotaSnapshot {
        .init(accountID: account, observedAt: observedAt, source: .claudeNative, windows: [
            .init(bucket: "session", usedPercent: session, resetsAt: sessionReset ?? now.addingTimeInterval(3 * 3600)),
            .init(bucket: "weekly_all", usedPercent: weekly, resetsAt: weeklyReset)])
    }

    // ---- Estimate: fresh unchanged, retained discounted, floor, resets -----
    let fresh = snapshot(observedAt: now.addingTimeInterval(-30))
    let freshEstimate = fresh.estimate(accountID: account, now: now)
    check(freshEstimate?.basis == .fresh && freshEstimate?.remainingPercent == 91 &&
          freshEstimate?.validUntil == fresh.observedAt.addingTimeInterval(120),
          "a fresh observation is evidence exactly as before: observed share, valid 120 s")
    let retained = snapshot(observedAt: now.addingTimeInterval(-245))
    let retainedEstimate = retained.estimate(accountID: account, now: now)
    let discounted = 91 - 2 * 245.0 / 60
    check(retainedEstimate?.basis == .retainedEstimate &&
          abs((retainedEstimate?.remainingPercent ?? 0) - discounted) < 1e-9 &&
          retainedEstimate?.observedAt == retained.observedAt &&
          retainedEstimate?.validUntil == retained.observedAt.addingTimeInterval(600) &&
          (retainedEstimate?.validUntil ?? now) > now,
          "a 245 s old observation is a discounted estimate with its true observedAt, still valid: \(String(describing: retainedEstimate))")
    check(retained.effectiveRemaining(accountID: account, now: now) == nil && !retained.isFresh(accountID: account, now: now),
          "fresh-only readers (authorization quota context) still see a retained observation as unknown")
    let nearlyOut = snapshot(observedAt: now.addingTimeInterval(-300), session: 91)
    check(nearlyOut.estimate(accountID: account, now: now) == nil,
          "9% left, 5 minutes old, at 2 points/minute is at or below the floor: unknown, never dispatched")
    let exhausted = snapshot(observedAt: now.addingTimeInterval(-400), session: 100)
    check(exhausted.estimate(accountID: account, now: now)?.remainingPercent == 0,
          "an observed exhausted window stays exhausted until it resets (usage never falls inside a window)")
    check(retained.estimate(accountID: account, now: now.addingTimeInterval(400)) == nil,
          "older than ten minutes is unknown")
    let crossing = snapshot(observedAt: now.addingTimeInterval(-200), sessionReset: now.addingTimeInterval(-1))
    check(crossing.estimate(accountID: account, now: now) == nil && !crossing.isRetainable(accountID: account, now: now),
          "a passed reset drops the observation; no inferred replenishment")
    let soonReset = snapshot(observedAt: now.addingTimeInterval(-200), sessionReset: now.addingTimeInterval(60))
    check(soonReset.estimate(accountID: account, now: now)?.validUntil == now.addingTimeInterval(60),
          "a retained estimate is never valid past the earliest applicable reset")
    check(retained.estimate(accountID: "claude.second", now: now) == nil, "an account switch drops the observation")
    check(snapshot(observedAt: now.addingTimeInterval(10)).estimate(accountID: account, now: now) == nil,
          "a future observation is unknown")

    // ---- Classifying a get_usage body ---------------------------------------
    let formatter = ISO8601DateFormatter()
    let rows: [[String: Any]] = [
        ["kind": "session", "percent": 11, "severity": "normal", "is_active": true,
         "resets_at": formatter.string(from: now.addingTimeInterval(3 * 3600)), "scope": NSNull()],
        ["kind": "weekly_all", "percent": 3, "severity": "normal", "is_active": false,
         "resets_at": formatter.string(from: weeklyReset), "scope": NSNull()]]
    let liveBody: [String: Any] = ["rate_limits_available": true, "rate_limits": [
        "limits": rows, "seven_day_breakdown": ["as_of": "2026-10-19T05:55:06.310000+00:00"]]]
    let seededBody: [String: Any] = ["rate_limits_available": true, "rate_limits": [
        "five_hour": ["utilization": 11], "seven_day": ["utilization": 3]]]
    let observedAt = BackendHealth.QuotaSnapshot.claudeObservedAt(liveBody, receivedAt: Date(timeIntervalSince1970: 1_792_389_320))
    check(abs(observedAt.timeIntervalSince1970 - 1_792_389_306.31) < 0.001,
          "observedAt is the server's as_of (microsecond RFC 3339), not the receipt time: \(observedAt.timeIntervalSince1970)")
    let receipt = now
    check(BackendHealth.QuotaSnapshot.claudeObservedAt(seededBody, receivedAt: receipt) == receipt.addingTimeInterval(-60),
          "without as_of the observation may be the CLI's 60 s snapshot: stamped 60 s before receipt")
    let futureAsOf: [String: Any] = ["rate_limits": ["seven_day_breakdown": ["as_of": formatter.string(from: receipt.addingTimeInterval(30))]]]
    check(BackendHealth.QuotaSnapshot.claudeObservedAt(futureAsOf, receivedAt: receipt) == receipt, "as_of never later than receipt")
    let live = BackendHealth.QuotaSnapshot.claudeUsageOutcome(liveBody, accountID: account, observedAt: now)
    check(live.outcome == .ok && live.snapshot?.effectiveRemaining(accountID: account, now: now) == 89, "live rows are adopted")
    let seeded = BackendHealth.QuotaSnapshot.claudeUsageOutcome(seededBody, accountID: account, observedAt: now)
    check(seeded.outcome == .usageEndpointFallback && seeded.snapshot == nil,
          "the CLI's post-429 fallback body is named and never adopted")
    check(BackendHealth.QuotaSnapshot.claudeUsageOutcome(["rate_limits_available": true, "rate_limits": NSNull()],
            accountID: account, observedAt: now).outcome == .usageUnavailable &&
          BackendHealth.QuotaSnapshot.claudeUsageOutcome(["rate_limits_available": false], accountID: account, observedAt: now).outcome == .notApplicable &&
          BackendHealth.QuotaSnapshot.claudeUsageOutcome(["rate_limits": [:]], accountID: account, observedAt: now).outcome == .malformed &&
          BackendHealth.QuotaSnapshot.claudeUsageOutcome(["rate_limits_available": true, "rate_limits": ["limits": [["kind": "session"]]]],
            accountID: account, observedAt: now).outcome == .malformed,
          "unavailable, non-plan and malformed bodies are each named, none adopted")

    // ---- Health record: a failed writer never erases the observation ------
    var good = BackendHealth.Backend(state: .usable)
    good.quota = fresh; good.windowUsedPercent = 9
    good.quotaProbe = .init(outcome: .ok, attemptedAt: fresh.observedAt, nextEligibleAt: fresh.observedAt.addingTimeInterval(125))
    let previous = BackendHealth(claude: good, codex: .init(state: .usable), checkedAt: now.addingTimeInterval(-30))
    var failedClaude = BackendHealth.Backend(state: .usable)
    failedClaude.quotaProbe = .init(outcome: .usageEndpointFallback, attemptedAt: now, nextEligibleAt: now.addingTimeInterval(125))
    let accounts = ["claude": account, "codex": "codex.default"]
    let merged = BackendHealth(claude: failedClaude, codex: .init(state: .usable), checkedAt: now)
        .retainingQuota(from: previous, accountIDs: accounts, now: now)
    check(merged.claude.quota == fresh && merged.claude.quota?.observedAt == fresh.observedAt &&
          merged.claude.quotaProbe?.outcome == .usageEndpointFallback && merged.claude.windowUsedPercent == 9,
          "a failed probe after a good one keeps the quota with its original observedAt and names the failure")
    let skipped = BackendHealth(claude: .init(state: .usable), codex: .init(state: .usable), checkedAt: now)
        .retainingQuota(from: previous, accountIDs: accounts, now: now)
    check(skipped.claude.quotaProbe?.outcome == .ok && skipped.claude.quota == fresh,
          "a writer that skipped the probe keeps the observation and its last outcome")
    check(BackendHealth(claude: .init(state: .loggedOut), codex: .init(state: .usable), checkedAt: now)
            .retainingQuota(from: previous, accountIDs: accounts, now: now).claude.quota == nil &&
          BackendHealth(claude: .init(state: .usable), codex: .init(state: .usable), checkedAt: now)
            .retainingQuota(from: previous, accountIDs: ["claude": "claude.second"], now: now).claude.quota == nil &&
          BackendHealth(claude: .init(state: .usable), codex: .init(state: .usable), checkedAt: now.addingTimeInterval(700))
            .retainingQuota(from: previous, accountIDs: accounts, now: now.addingTimeInterval(700)).claude.quota == nil,
          "sign-out, account switch and age beyond ten minutes drop the observation")
    var newer = BackendHealth.Backend(state: .usable); newer.quota = retained
    check(BackendHealth(claude: newer, codex: .init(state: .usable), checkedAt: now)
            .retainingQuota(from: previous, accountIDs: accounts, now: now).claude.quota == retained,
          "a writer's own observation is never replaced by the previous one")
    var exhaustedBackend = BackendHealth.Backend(state: .usable); exhaustedBackend.quota = exhausted
    let stillExhausted = BackendHealth(claude: .init(state: .usable), codex: .init(state: .usable), checkedAt: now)
        .retainingQuota(from: BackendHealth(claude: exhaustedBackend, codex: .init(state: .usable), checkedAt: now.addingTimeInterval(-300)),
                        accountIDs: accounts, now: now)
    check(stillExhausted.claude.state == .quotaExhausted && stillExhausted.claude.recoversAt != nil,
          "a retained exhausted window keeps the backend exhausted until its reset")
    let encoded = try JSONEncoder().encode(merged)
    let decoded = try JSONDecoder().decode(BackendHealth.self, from: encoded)
    check(decoded == merged, "the probe outcome round-trips")
    let legacy = try JSONDecoder().decode(BackendHealth.self, from: Data(#"{"claude":{"state":"usable"},"codex":{"state":"usable"},"checkedAt":0}"#.utf8))
    check(legacy.claude.quotaProbe == nil, "an older record without the probe outcome still decodes")
    let futureOutcome = try JSONDecoder().decode(BackendHealth.QuotaProbe.self,
        from: Data(#"{"outcome":"a_later_reason","attemptedAt":0,"nextEligibleAt":125}"#.utf8))
    check(futureOutcome.outcome == .unrecognized, "an outcome spelled by a newer build decodes as unrecognized, not a failure")

    // ---- Send, provider observation and receipt are different instants ----
    let sentAt = now, receivedAt = now.addingTimeInterval(2)
    let observedDuringProbe = snapshot(observedAt: now.addingTimeInterval(1))
    let empty = ClaudeQuotaStore(accountID: account)
    let receivedLive = empty.recording(.ok, snapshot: observedDuringProbe,
                                      attemptedAt: sentAt, receivedAt: receivedAt)
    check(receivedLive.snapshot == observedDuringProbe &&
          receivedLive.snapshot?.observedAt != sentAt && receivedLive.snapshot?.observedAt != receivedAt,
          "an observation after send but before receipt is retained with its original provider time")
    check(receivedLive.probe?.attemptedAt == sentAt &&
          receivedLive.probe?.nextEligibleAt == sentAt.addingTimeInterval(125),
          "receipt validation never moves the attempt/next-eligible timestamps")
    let trulyFuture = snapshot(observedAt: receivedAt.addingTimeInterval(1))
    check(empty.recording(.ok, snapshot: trulyFuture, attemptedAt: sentAt, receivedAt: receivedAt).snapshot == nil,
          "an observation actually after receipt remains unknown, never clamped to now")
    let oldGood = snapshot(observedAt: now.addingTimeInterval(-30))
    let withOld = ClaudeQuotaStore(accountID: account, snapshot: oldGood)
    check(withOld.recording(.ok, snapshot: trulyFuture, attemptedAt: sentAt, receivedAt: receivedAt).snapshot == oldGood,
          "rejecting an invalid new observation preserves the last valid observation")
    check(empty.recording(.ok, snapshot: snapshot(observedAt: now.addingTimeInterval(-601)),
                          attemptedAt: sentAt, receivedAt: receivedAt).snapshot == nil,
          "stale observations remain rejected at receipt time")
    check(empty.recording(.ok, snapshot: snapshot(observedAt: now, account: "claude.other"),
                          attemptedAt: sentAt, receivedAt: receivedAt).snapshot == nil,
          "a different account never gains authority from receipt timing")
    check(empty.recording(.ok, snapshot: snapshot(observedAt: now.addingTimeInterval(-1), sessionReset: now.addingTimeInterval(1)),
                          attemptedAt: sentAt, receivedAt: receivedAt).snapshot == nil,
          "a reset crossed during the round trip invalidates the old window")
    for interrupted in [BackendHealth.QuotaProbe.Outcome.timeoutOrNoReply, .exitNonzero] {
        let kept = withOld.recording(interrupted, snapshot: nil, attemptedAt: sentAt, receivedAt: receivedAt)
        check(kept.snapshot == oldGood && kept.probe?.attemptedAt == sentAt &&
              kept.probe?.nextEligibleAt == sentAt.addingTimeInterval(125) && kept.probe?.outcome == interrupted,
              "an interrupted/cancelled metadata attempt retains its original spacing and observation")
    }

    // ---- Store: spacing, one fetcher, retention -----------------------------
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-claude-quota-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let storeURL = root.appendingPathComponent("claude-quota.json"), lockURL = root.appendingPathComponent("claude-quota.lock")
    final class Counter: @unchecked Sendable {
        private let lock = NSLock(); private var value = 0
        func next() -> Int { lock.lock(); defer { lock.unlock() }; value += 1; return value }
        var current: Int { lock.lock(); defer { lock.unlock() }; return value }
    }
    let spawns = Counter()

    // The real shared-store entry point must validate AFTER the callback,
    // not merely offer the fixed direct recording helper above.
    let lateURL = root.appendingPathComponent("late-observation.json")
    var lateClock = sentAt
    let lateSpawns = Counter()
    let late = ClaudeQuotaStore.observe(accountID: account, storeURL: lateURL, lockURL: lockURL,
                                        now: { lateClock }) {
        _ = lateSpawns.next(); lateClock = receivedAt
        return (.ok, observedDuringProbe)
    }
    check(late.probed && late.snapshot == observedDuringProbe && lateSpawns.current == 1,
          "a native observation newer than send survives observe's post-probe validation")
    let savedLate = ClaudeQuotaStore.load(from: lateURL)
    check(savedLate?.snapshot?.observedAt == observedDuringProbe.observedAt &&
          savedLate?.probe?.attemptedAt == sentAt && savedLate?.probe?.nextEligibleAt == sentAt.addingTimeInterval(125),
          "persisted receipt preserves distinct observation/send times without substituting receipt time")
    check(!ClaudeQuotaStore.needsProbe(savedLate, accountID: account, other: nil, now: sentAt.addingTimeInterval(124)),
          "post-send observation does not permit a retry before the existing spacing")
    lateClock = sentAt.addingTimeInterval(126)
    let interruptedStart = lateClock
    let interrupted = ClaudeQuotaStore.observe(accountID: account, storeURL: lateURL, lockURL: lockURL,
                                               now: { lateClock }) {
        _ = lateSpawns.next(); lateClock = interruptedStart.addingTimeInterval(2)
        return (.timeoutOrNoReply, nil)
    }
    check(interrupted.probed && interrupted.snapshot == observedDuringProbe && lateSpawns.current == 2 &&
          interrupted.probe?.nextEligibleAt == interruptedStart.addingTimeInterval(125),
          "an interrupted round trip uses start-based spacing, not receipt-based spacing")
    check(!ClaudeQuotaStore.needsProbe(ClaudeQuotaStore.load(from: lateURL), accountID: account, other: nil,
                                      now: interruptedStart.addingTimeInterval(124)) &&
          ClaudeQuotaStore.needsProbe(ClaudeQuotaStore.load(from: lateURL), accountID: account, other: nil,
                                     now: interruptedStart.addingTimeInterval(125)),
          "cancellation/timeout spacing still opens at the existing boundary")
    let expiring = ClaudeQuotaStore(accountID: account, snapshot: snapshot(observedAt: sentAt.addingTimeInterval(-599)))
    check(expiring.recording(.timeoutOrNoReply, snapshot: nil, attemptedAt: sentAt, receivedAt: receivedAt).snapshot == nil,
          "an observation that expires in flight is not retained using the older send timestamp")

    var clock = now
    func observe(_ outcome: BackendHealth.QuotaProbe.Outcome, _ observation: BackendHealth.QuotaSnapshot?,
                 other: BackendHealth.QuotaSnapshot? = nil) -> ClaudeQuotaStore.Observation {
        ClaudeQuotaStore.observe(accountID: account, storeURL: storeURL, lockURL: lockURL, other: other, now: { clock }) {
            _ = spawns.next(); return (outcome, observation)
        }
    }
    let first = observe(.ok, snapshot(observedAt: clock.addingTimeInterval(-1)))
    check(first.probed && spawns.current == 1 && first.snapshot?.observedAt == clock.addingTimeInterval(-1) && first.probe?.outcome == .ok,
          "no store: probe once and keep the live observation")
    check((try FileManager.default.attributesOfItem(atPath: storeURL.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600,
          "the store is private")
    clock = now.addingTimeInterval(62)
    let second = observe(.ok, snapshot(observedAt: clock))
    check(!second.probed && spawns.current == 1 && second.snapshot?.observedAt == now.addingTimeInterval(-1),
          "62 s later (the poll that got HTTP 429 on build 405) does not probe: same observation reused")
    clock = now.addingTimeInterval(126)
    let third = observe(.usageEndpointFallback, nil)
    check(third.probed && spawns.current == 2 && third.probe?.outcome == .usageEndpointFallback &&
          third.snapshot?.observedAt == now.addingTimeInterval(-1),
          "a refused refresh keeps the last good observation with its own observedAt and names the outcome")
    check(ClaudeQuotaStore.load(from: storeURL)?.probe?.nextEligibleAt == now.addingTimeInterval(126 + 125),
          "no retry inside the spacing after a refused refresh")
    clock = now.addingTimeInterval(200)
    check(!observe(.ok, snapshot(observedAt: clock)).probed && spawns.current == 2, "a refused attempt also counts toward the spacing")
    clock = now.addingTimeInterval(251)
    let fourth = observe(.ok, snapshot(observedAt: clock.addingTimeInterval(-1)))
    check(fourth.probed && fourth.snapshot?.observedAt == clock.addingTimeInterval(-1) && fourth.probe?.outcome == .ok,
          "after the spacing a live observation replaces the old one")
    let foreign = snapshot(observedAt: clock.addingTimeInterval(100))
    clock = now.addingTimeInterval(390)
    check(!observe(.ok, nil, other: foreign).probed && spawns.current == 3,
          "another writer's recent observation (an older build's health record) counts as an attempt")
    // The foreign observation above was adopted (observed at +351 s).
    clock = now.addingTimeInterval(351 + 700)
    let tooOld = observe(.timeoutOrNoReply, nil)
    check(tooOld.probed && tooOld.snapshot == nil && tooOld.probe?.outcome == .timeoutOrNoReply,
          "an observation older than ten minutes is not kept as evidence")

    // Another writer's newer observation is adopted under the lock, so an
    // older build that later replaces its record with nothing cannot erase it.
    let adoptURL = root.appendingPathComponent("adopt.json")
    let byOther = snapshot(observedAt: now.addingTimeInterval(-20))
    let adoptSpawns = Counter()
    let viaOther = ClaudeQuotaStore.observe(accountID: account, storeURL: adoptURL, lockURL: lockURL, other: byOther,
                                            now: { now }) { _ = adoptSpawns.next(); return (.ok, nil) }
    check(!viaOther.probed && adoptSpawns.current == 0 && viaOther.snapshot == byOther &&
          ClaudeQuotaStore.load(from: adoptURL)?.snapshot?.observedAt == byOther.observedAt,
          "another writer's recent observation is used without a probe and kept in the shared store")
    let erased = ClaudeQuotaStore.observe(accountID: account, storeURL: adoptURL, lockURL: lockURL, other: nil,
                                          now: { now.addingTimeInterval(60) }) { _ = adoptSpawns.next(); return (.ok, nil) }
    check(!erased.probed && adoptSpawns.current == 0 && erased.snapshot?.observedAt == byOther.observedAt,
          "a writer that later erased its record cannot erase the adopted observation")
    check(ClaudeQuotaStore.adopting(ClaudeQuotaStore(accountID: account, snapshot: snapshot(observedAt: now.addingTimeInterval(-10))), other: byOther, accountID: account, now: now) == nil &&
          ClaudeQuotaStore.adopting(nil, other: snapshot(observedAt: now, account: "claude.second"), accountID: account, now: now) == nil,
          "an older or foreign observation is never adopted over the store's own")

    // Two concurrent callers: one spawn; the waiter reads the winner's result.
    let concurrentURL = root.appendingPathComponent("concurrent.json"), concurrentLock = root.appendingPathComponent("concurrent.lock")
    let concurrentSpawns = Counter()
    final class Results: @unchecked Sendable {
        private let lock = NSLock(); private var values: [ClaudeQuotaStore.Observation] = []
        func add(_ value: ClaudeQuotaStore.Observation) { lock.lock(); values.append(value); lock.unlock() }
        var all: [ClaudeQuotaStore.Observation] { lock.lock(); defer { lock.unlock() }; return values }
    }
    let results = Results()
    let live2 = snapshot(observedAt: now.addingTimeInterval(-2))
    let group = DispatchGroup()
    for _ in 0..<2 {
        group.enter()
        DispatchQueue.global().async {
            results.add(ClaudeQuotaStore.observe(accountID: account, storeURL: concurrentURL, lockURL: concurrentLock,
                                                 now: { now }) {
                _ = concurrentSpawns.next(); Thread.sleep(forTimeInterval: 0.3); return (.ok, live2)
            })
            group.leave()
        }
    }
    group.wait()
    check(concurrentSpawns.current == 1 && results.all.count == 2 && results.all.allSatisfy { $0.snapshot == live2 } &&
          results.all.filter(\.probed).count == 1,
          "two concurrent callers produce one probe and the same observation")
    // A lock another holder keeps past the bound: the caller returns what it
    // has instead of probing in parallel.
    let blocked = ClaudeQuotaStore.withExclusiveLock(concurrentLock, wait: 5) { () -> ClaudeQuotaStore.Observation in
        ClaudeQuotaStore.observe(accountID: account, storeURL: root.appendingPathComponent("blocked.json"),
                                 lockURL: concurrentLock, lockWait: 0.2, now: { now }) {
            _ = concurrentSpawns.next(); return (.ok, live2)
        }
    }
    check(blocked?.probed == false && blocked?.snapshot == nil && concurrentSpawns.current == 1,
          "a caller that cannot take the lock never probes alongside the holder")
    let line = ClaudeQuotaStore.Observation(snapshot: retained, probe: .init(outcome: .usageEndpointFallback,
        attemptedAt: now.addingTimeInterval(-10), nextEligibleAt: now.addingTimeInterval(115)), probed: false)
        .publicLine(accountID: account, now: now)
    check(line.contains("basis=retained_estimate") && line.contains("observed_age_s=245") &&
          line.contains("probe=usage_endpoint_fallback") && line.contains("probed_now=0"),
          "the catalog receipt names the basis and the refused refresh: \(line)")
    check(ClaudeQuotaStore.Observation(snapshot: nil, probe: nil, probed: false).publicLine(accountID: account, now: now)
            .contains("basis=unknown"), "no observation is named unknown")
    // ---- A real quota refusal supersedes earlier observations --------------
    // Review finding (2026-10-19): the account-wide cooldown after a real
    // Claude quota refusal is 300 s, a retained observation lives 600 s. A
    // good observation 60 s before the refusal was still offered 301 s after
    // it (cooldown over) as a 48% retained estimate, so the next catalog
    // re-offered the pool the run had just been refused from. Build 405 held
    // it as unknown (older than 120 s).
    let receipts = root.appendingPathComponent("receipts", isDirectory: true)
    try FileManager.default.createDirectory(at: receipts, withIntermediateDirectories: true)
    let accountReceipt = receipts.appendingPathComponent("claude-quota-backoff.json")
    check(ClaudeQuotaBackoff.lastAccountRejection(at: accountReceipt, now: now) == nil, "no receipt, no rejection time")
    let refusedAt = now.addingTimeInterval(-301)
    try ClaudeQuotaBackoff.record(at: accountReceipt, now: refusedAt)
    check(ClaudeQuotaBackoff.active(at: accountReceipt, now: now) == nil &&
          ClaudeQuotaBackoff.lastAccountRejection(at: accountReceipt, now: now) == refusedAt,
          "the refusal time outlives its 300 s cooldown")
    check(ClaudeQuotaBackoff.lastAccountRejection(at: accountReceipt, now: refusedAt.addingTimeInterval(-60)) == nil,
          "a receipt from the future is not evidence")
    try ClaudeQuotaBackoff.record(model: "fable", directory: receipts, now: refusedAt)
    check(ClaudeQuotaBackoff.lastAccountRejection(at: ClaudeQuotaBackoff.modelURL("fable", directory: receipts)!, now: now) == nil,
          "a model-scoped receipt is not an account-wide refusal (its own 1 h cooldown covers that family)")
    let preRefusal = snapshot(observedAt: refusedAt.addingTimeInterval(-60), session: 40)
    check(preRefusal.estimate(accountID: account, now: now)?.basis == .retainedEstimate,
          "the pre-refusal observation is still retainable on its own (the case this guards)")
    let refusalStore = ClaudeQuotaStore(accountID: account, snapshot: preRefusal, probe: .init(outcome: .usageEndpointFallback,
        attemptedAt: now.addingTimeInterval(-1), nextEligibleAt: now.addingTimeInterval(124)))
    let superseded = ClaudeQuotaStore.view(refusalStore, accountID: account, other: preRefusal, now: now, probed: false,
                                           rejectedAt: refusedAt)
    check(superseded.snapshot == nil && superseded.supersededByRejection &&
          superseded.publicLine(accountID: account, now: now).contains("basis=unknown") &&
          superseded.publicLine(accountID: account, now: now).contains("superseded_by_quota_rejection=1"),
          "an observation made before the latest account-wide refusal is not offered, and the receipt says why")
    let postRefusal = snapshot(observedAt: refusedAt.addingTimeInterval(20), session: 100)
    let afterRefusal = ClaudeQuotaStore.view(refusalStore, accountID: account, other: postRefusal, now: now, probed: false,
                                             rejectedAt: refusedAt)
    check(afterRefusal.snapshot == postRefusal && !afterRefusal.supersededByRejection &&
          afterRefusal.snapshot?.estimate(accountID: account, now: now)?.remainingPercent == 0,
          "an observation made after the refusal is the evidence (here: exhausted, quota_zero)")
    check(ClaudeQuotaStore.view(refusalStore, accountID: account, other: nil, now: now, probed: false).snapshot == preRefusal,
          "without a refusal the retained observation is offered as before")
    let refusalURL = root.appendingPathComponent("refusal.json")
    try refusalStore.save(to: refusalURL)
    let refusalSpawns = Counter()
    let observedAfterRefusal = ClaudeQuotaStore.observe(accountID: account, storeURL: refusalURL, lockURL: lockURL,
        rejectedAt: refusedAt, now: { now }) { _ = refusalSpawns.next(); return (.usageEndpointFallback, nil) }
    check(observedAfterRefusal.snapshot == nil && observedAfterRefusal.supersededByRejection && refusalSpawns.current == 0,
          "the shared entry point applies the refusal (no probe inside the spacing)")
    var preRefusalBackend = BackendHealth.Backend(state: .usable); preRefusalBackend.quota = preRefusal
    let carried = BackendHealth(claude: .init(state: .usable), codex: .init(state: .usable), checkedAt: now)
        .retainingQuota(from: BackendHealth(claude: preRefusalBackend, codex: .init(state: .usable), checkedAt: now.addingTimeInterval(-60)),
                        accountIDs: accounts, supersededAt: ["claude": refusedAt], now: now)
    check(carried.claude.quota == nil && carried.claude.windowUsedPercent == nil,
          "the health record does not carry a pre-refusal observation forward")

    print("Claude quota store: \(count) checks OK — a refused refresh keeps the observation, one fetcher, 125 s spacing")
}
