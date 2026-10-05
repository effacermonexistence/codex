import Foundation
import OS1Context

/// Build 329 governance monitor: the Δ figures are drawn on evidence time,
/// the default pair is the most recent comparison, stale or thin evidence is
/// never a headline number, the token change reads with the right sign, the
/// goal card never shows "0/N", a candidate that only ran after the baseline
/// failed is labelled as such, and orphaned "running" receipts are found.
func runGovernanceEvidenceFixtures() throws {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("governance-evidence-\(UUID())")
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    func scope(_ fill: Character) -> CompletionFeedbackScope {
        CompletionFeedbackScope(objectiveSHA256: String(repeating: fill, count: 64), sourceSHA256: nil,
            executorContractSHA256: String(repeating: "b", count: 64), assembledInputSHA256: String(repeating: "c", count: 64))
    }
    func usage(_ input: Int, _ output: Int) -> CompletionMeasuredUsage {
        CompletionMeasuredUsage(inputTokens: input, outputTokens: output, cacheTokens: 0,
            resource: CompletionUsageResourceMetadata(format: .codexRolloutJSONL, byteCount: 100,
                sha256: String(repeating: "e", count: 64), usageRecordCount: 1, accountingVersion: 2))
    }
    /// One task, one attempt on `model` in `bound`, starting at `at`.
    func task(_ store: GovernanceActivityStore, _ bound: CompletionFeedbackScope, _ model: String, adopted: Bool,
              tokens: (Int, Int)?, at: Date, durationMS: Int = 1_000, taskEnd: TimeInterval = 1) throws {
        let id = UUID().uuidString.lowercased(), remote = UUID().uuidString.lowercased()
        try store.begin(id: id, now: at)
        let observation = CompletionFeedbackObservation(executionID: remote, sequence: 1, provider: "codex", model: model,
            effort: "low", outcome: adopted ? .adopted : .qualityFailure, usage: tokens.map { usage($0.0, $0.1) },
            durationMS: durationMS)
        try store.attempt(id: id, executionID: remote, sequence: 1, scope: bound, provider: "codex", model: model,
            effort: "low", startedAt: at.addingTimeInterval(0.1), observation: observation)
        try store.finish(id: id, adopted: adopted, now: at.addingTimeInterval(taskEnd))
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = .current
    let t = calendar.date(from: DateComponents(year: 2026, month: 9, day: 20, hour: 11, minute: 0))!

    // 1. Evidence series on receipt time.
    let series = GovernanceActivityStore(root: root.appendingPathComponent("series"))
    try task(series, scope("1"), "low", adopted: false, tokens: (900_000, 95_861), at: t)
    try task(series, scope("1"), "medium", adopted: true, tokens: (100_000, 23_965), at: t.addingTimeInterval(600))
    try task(series, scope("2"), "low", adopted: false, tokens: nil, at: t.addingTimeInterval(1_200))
    try task(series, scope("2"), "medium", adopted: false, tokens: (10, 10), at: t.addingTimeInterval(1_800))
    try task(series, scope("3"), "low", adopted: false, tokens: (300_000, 100_000), at: t.addingTimeInterval(86_400))
    try task(series, scope("3"), "medium", adopted: true, tokens: (200_000, 100_000), at: t.addingTimeInterval(90_000))
    let seriesSnapshot = series.snapshot(legacyRoot: nil)
    let pair = seriesSnapshot.comparisons(baseline: "codex / low / low", since: nil, includeHistorical: false)
        .first { $0.id == "codex / medium / low" }!
    check(pair.matchedScopes == 3 && pair.measuredScopes == 2, "fixture cohort: 3 matched, 2 measured")
    check(pair.completionEvidence.count == 3 && pair.tokenEvidence.count == 2,
          "one completion point per matched scope, one token point per measured scope")
    check(zip(pair.completionEvidence, pair.completionEvidence.dropFirst()).allSatisfy { $0.id < $1.id } &&
          zip(pair.tokenEvidence, pair.tokenEvidence.dropFirst()).allSatisfy { $0.id < $1.id },
          "evidence times strictly increase")
    check(pair.completionEvidence.last?.value == pair.taskCompletionDelta && pair.tokenEvidence.last?.value == pair.tokenSavings,
          "the last evidence point is exactly the headline value")
    check(pair.completionEvidence.last?.id == pair.latestEvidenceAt && pair.tokenEvidence.last?.id == pair.latestMeasuredEvidenceAt,
          "the series ends at the newest receipt behind the value")
    check(pair.completionEvidence.first?.id == t.addingTimeInterval(601.1) && pair.completionEvidence.first?.value == 1,
          "a point sits at the scope's last attempt end with the cumulative value then")
    check(pair.completionEvidence.map(\.scopes) == [1, 2, 3] && pair.tokenEvidence.map(\.scopes) == [1, 2],
          "each point carries its cumulative cohort size")
    check(pair.baselineMeasuredTokens == 1_395_861 && pair.candidateMeasuredTokens == 423_965,
          "measured totals are the savings numerator and denominator")

    // 2. Signed token change and the cohort note.
    check(GovernanceMonitorText.tokenChange(savings: 0.696) == "\u{2212}69.6%", "a token cut reads as minus")
    check(GovernanceMonitorText.tokenChange(savings: -0.2) == "+20.0%", "a token increase reads as plus")
    check(GovernanceMonitorText.tokenChange(savings: 0) == "±0.0%" && GovernanceMonitorText.tokenChange(savings: nil) == "—",
          "no change and undefined are explicit")
    check(GovernanceMonitorText.percentagePoints(0.373) == "+37.3pp" && GovernanceMonitorText.percentagePoints(-0.05) == "\u{2212}5.0pp",
          "percentage points keep their sign")
    check(GovernanceMonitorText.shortDate(t, calendar: calendar) == "9/20", "evidence dates are month/day")
    // Measured scope 3 is newer than scope 1; the note names the newest one.
    let cohort = GovernanceMonitorText.tokenCohort(pair)
    check(cohort.hasPrefix("1.40M → 0.42M · n=2 · ") && cohort.hasSuffix(GovernanceMonitorText.shortDate(pair.latestMeasuredEvidenceAt!)),
          "token note shows totals, n and the evidence date: \(cohort)")

    // 3. Headline gate: stale, too few, value.
    let now = t.addingTimeInterval(15 * 86_400)
    let weekAgo = now.addingTimeInterval(-7 * 86_400)
    check(GovernanceDeltaHeadline.evaluate(value: 0.696, scopes: 2, latestEvidence: t, freshAfter: weekAgo) == .stale(since: t),
          "14-day-old evidence is stale, never a current headline")
    check(GovernanceDeltaHeadline.evaluate(value: 0.373, scopes: 51, latestEvidence: t, freshAfter: weekAgo) == .stale(since: t),
          "a large but old cohort is still stale")
    check(GovernanceDeltaHeadline.evaluate(value: 0.696, scopes: 2, latestEvidence: now, freshAfter: weekAgo) == .tooFew(scopes: 2),
          "fresh evidence over n=2 is too few to compare")
    check(GovernanceDeltaHeadline.evaluate(value: 0.4, scopes: 5, latestEvidence: now, freshAfter: weekAgo) == .value(0.4),
          "fresh evidence over the minimum shows its value")
    check(GovernanceDeltaHeadline.evaluate(value: nil, scopes: 9, latestEvidence: now, freshAfter: weekAgo) == .unavailable &&
          GovernanceDeltaHeadline.evaluate(value: 0.1, scopes: 9, latestEvidence: nil, freshAfter: weekAgo) == .stale(since: nil),
          "undefined is unavailable and untimestamped evidence is never current")
    check(GovernanceMonitorText.tooFew(scopes: 2).contains("n=2"), "too-few text names n")
    check(GovernanceMonitorText.staleTitle(since: t).contains("9/20"), "stale title names the last evidence date")

    // 4. Default pair: recency first, then measured scopes; never token volume.
    let pairs = GovernanceActivityStore(root: root.appendingPathComponent("pairs"))
    for (index, fill) in ["a", "b", "c", "d", "e", "f"].enumerated() {
        let at = t.addingTimeInterval(Double(index) * 60)
        try task(pairs, scope(Character(fill)), "old-base", adopted: false, tokens: (5_000_000, 0), at: at)
        try task(pairs, scope(Character(fill)), "old-cand", adopted: true, tokens: (4_000_000, 0), at: at.addingTimeInterval(10))
    }
    let recent = t.addingTimeInterval(10 * 86_400)
    try task(pairs, scope("9"), "new-base", adopted: false, tokens: (10, 10), at: recent)
    try task(pairs, scope("9"), "new-cand", adopted: true, tokens: (5, 5), at: recent.addingTimeInterval(10))
    let pairProjection = pairs.snapshot(legacyRoot: nil).dashboardProjection(provider: nil, since: nil, includeHistorical: false, now: now)
    let chosen = pairProjection.defaultComparison()
    check(chosen?.id == "codex / new-cand / low" && chosen?.baseline == "codex / new-base / low",
          "the newest small pair beats an old large pair")
    check(pairProjection.rows.first?.id == "codex / old-base / low", "the old pair still leads by token volume (the old rule)")
    if let chosen {
        check(GovernanceDeltaHeadline.evaluate(value: chosen.tokenSavings, scopes: chosen.measuredScopes,
                                               latestEvidence: chosen.latestMeasuredEvidenceAt, freshAfter: weekAgo) == .tooFew(scopes: 1),
              "the chosen n=1 pair shows no headline value")
    }
    let tie = series.snapshot(legacyRoot: nil).dashboardProjection(provider: nil, since: nil, includeHistorical: false, now: now)
        .defaultComparison()
    check(tie?.baseline == "codex / low / low" && tie?.id == "codex / medium / low",
          "a mirrored pair keeps the baseline that leads the route table")

    // 5. Selection bias: the candidate only ever ran after the baseline failed.
    check(pair.candidateAfterBaselineFailureScopes == 3 && pair.completionDeltaIsSelectionBiased,
          "baseline-first failures in every scope mark the completion Δ as selection-biased")
    let mixed = GovernanceActivityStore(root: root.appendingPathComponent("mixed"))
    try task(mixed, scope("1"), "low", adopted: false, tokens: (10, 10), at: t)
    try task(mixed, scope("1"), "medium", adopted: true, tokens: (10, 10), at: t.addingTimeInterval(60))
    try task(mixed, scope("2"), "medium", adopted: true, tokens: (10, 10), at: t.addingTimeInterval(120))
    try task(mixed, scope("2"), "low", adopted: true, tokens: (10, 10), at: t.addingTimeInterval(180))
    // Scope 3 re-ran both routes later (low → medium → low → medium), the
    // live data's effort-escalation shape: still candidate-after-failure.
    try task(mixed, scope("3"), "low", adopted: false, tokens: (10, 10), at: t.addingTimeInterval(240))
    try task(mixed, scope("3"), "medium", adopted: false, tokens: (10, 10), at: t.addingTimeInterval(300))
    try task(mixed, scope("3"), "low", adopted: false, tokens: (10, 10), at: t.addingTimeInterval(360))
    try task(mixed, scope("3"), "medium", adopted: true, tokens: (10, 10), at: t.addingTimeInterval(420))
    let unbiased = mixed.snapshot(legacyRoot: nil).comparisons(baseline: "codex / low / low", since: nil, includeHistorical: false).first!
    check(unbiased.candidateAfterBaselineFailureScopes == 2 && !unbiased.completionDeltaIsSelectionBiased,
          "a scope where the candidate ran first is a real comparison")
    check(GovernanceMonitorText.sideNames(baseline: "codex / gpt-5.6-luna / low", candidate: "codex / gpt-5.6-luna / medium") == ("low", "medium"),
          "an effort-escalation pair is named by its efforts")

    // 6. Goal card never shows a ratio while no verdict writer exists.
    let quality = seriesSnapshot.quality(since: nil)
    let goal = GovernanceMonitorText.goalValue(quality)
    check(quality.eligible == 6 && quality.rate == nil && (goal == "Not connected" || goal == "미연결") && !goal.contains("0/"),
          "all-nil verdicts read as not connected, never 0/N")
    check(GovernanceMonitorText.goalValue(GovernanceQualitySummary(outcomes: [true, false], tokens: [1, 1])) == "50.0%",
          "a connected verdict stream shows its rate")

    // 7. Recorded time is not capped at one hour for the task's last attempt.
    let long = GovernanceActivityStore(root: root.appendingPathComponent("long"))
    try task(long, scope("1"), "low", adopted: true, tokens: (1, 1), at: t,
             durationMS: GovernanceSnapshot.recordedDurationCapMS, taskEnd: 7_200)
    let recordedAt = long.snapshot(legacyRoot: nil).attemptRecordedAt()
    check(recordedAt.values.first == t.addingTimeInterval(7_200), "a capped duration uses the task's real end")
    check(seriesSnapshot.attemptRecordedAt().values.contains(t.addingTimeInterval(601.1)),
          "uncapped attempts keep start plus duration")

    // 8. Orphaned "running" receipts: no live process, or a reused PID.
    let orphanStore = GovernanceActivityStore(root: root.appendingPathComponent("orphans"))
    let orphanID = UUID().uuidString.lowercased()
    try orphanStore.begin(id: orphanID, now: t)
    let running = orphanStore.snapshot(legacyRoot: nil).tasks
    check(GovernanceProcessLiveness.orphaned(running, startTime: { _ in nil }).count == 1, "dead PID is unfinished, not running")
    check(GovernanceProcessLiveness.orphaned(running, startTime: { _ in t.addingTimeInterval(-60) }).isEmpty,
          "a live process that started before the task keeps it running")
    check(GovernanceProcessLiveness.orphaned(running, startTime: { _ in t.addingTimeInterval(3_600) }).count == 1,
          "a PID now owned by a later process is a reused PID, not the task")
    let me = getpid()
    check(GovernanceProcessLiveness.isAlive(pid: me, taskStartedAt: Date()) &&
          !GovernanceProcessLiveness.isAlive(pid: me, taskStartedAt: Date(timeIntervalSince1970: 1_000)),
          "the real process table: own PID is alive now and too new for an old task")
    let child = Process()
    child.executableURL = URL(fileURLWithPath: "/usr/bin/true")
    try child.run(); child.waitUntilExit()
    check(GovernanceProcessLiveness.startTime(pid: child.processIdentifier) == nil, "an exited process has no start time")
    print("Governance evidence: \(checks) checks PASS; paid calls=0; fixtures isolated")
}
