import Foundation
import OS1Context

/// Build 329 governance monitor, review round 2: selection bias is flagged in
/// both directions of a pair, a stale reason is not stated as fact, a Δ chart
/// header goes through the same stale / too-few gate as the cards, an empty
/// chart agrees with its card (legacy evidence, loading), and the evidence
/// axis labels the evidence dates once each while giving the series the width.
/// Every check runs before any failure is reported, so one run lists them all.
func runGovernanceMonitorRound2Fixtures() throws {
    let fm = FileManager.default
    let root = fm.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("governance-round2-\(UUID())")
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    var checks = 0
    var failures: [String] = []
    func check(_ value: @autoclosure () -> Bool, _ label: String) {
        checks += 1
        if !value() { failures.append(label) }
    }
    func scope(_ fill: Character) -> CompletionFeedbackScope {
        CompletionFeedbackScope(objectiveSHA256: String(repeating: fill, count: 64), sourceSHA256: nil,
            executorContractSHA256: String(repeating: "b", count: 64), assembledInputSHA256: String(repeating: "c", count: 64))
    }
    func task(_ store: GovernanceActivityStore, _ bound: CompletionFeedbackScope, _ effort: String, adopted: Bool,
              tokens: Int?, at: Date) throws {
        let id = UUID().uuidString.lowercased(), remote = UUID().uuidString.lowercased()
        try store.begin(id: id, now: at)
        let usage = tokens.map {
            CompletionMeasuredUsage(inputTokens: $0, outputTokens: 0, cacheTokens: 0,
                resource: CompletionUsageResourceMetadata(format: .codexRolloutJSONL, byteCount: 100,
                    sha256: String(repeating: "e", count: 64), usageRecordCount: 1, accountingVersion: 2))
        }
        let observation = CompletionFeedbackObservation(executionID: remote, sequence: 1, provider: "codex", model: "gpt-test",
            effort: effort, outcome: adopted ? .adopted : .qualityFailure, usage: usage, durationMS: 1_000)
        try store.attempt(id: id, executionID: remote, sequence: 1, scope: bound, provider: "codex", model: "gpt-test",
            effort: effort, startedAt: at.addingTimeInterval(0.1), observation: observation)
        try store.finish(id: id, adopted: adopted, now: at.addingTimeInterval(2))
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    func date(_ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
    }

    // 1. Selection bias is symmetric: low always ran first and failed, then
    //    medium. Viewed as low → medium or as medium → low, it is biased.
    let escalation = GovernanceActivityStore(root: root.appendingPathComponent("escalation"))
    let t = date(9, 20, 11, 0)
    for (index, fill) in ["1", "2", "3", "4", "5"].enumerated() {
        let at = t.addingTimeInterval(Double(index) * 600)
        try task(escalation, scope(Character(fill)), "low", adopted: false, tokens: 700_000, at: at)
        try task(escalation, scope(Character(fill)), "medium", adopted: index != 0, tokens: 200_000, at: at.addingTimeInterval(120))
    }
    let snapshot = escalation.snapshot(legacyRoot: nil)
    let forward = snapshot.comparisons(baseline: "codex / gpt-test / low", since: nil, includeHistorical: false).first!
    let mirror = snapshot.comparisons(baseline: "codex / gpt-test / medium", since: nil, includeHistorical: false).first!
    check(forward.selectionBias == .candidateAfterBaselineFailure && forward.completionDeltaIsSelectionBiased,
          "low → medium: medium only ran after low failed")
    check(mirror.selectionBias == .baselineAfterCandidateFailure && mirror.completionDeltaIsSelectionBiased,
          "medium → low (the mirror pair of the same scopes) is flagged too")
    let forwardLabel = GovernanceMonitorText.selectionBiasSummary(forward)
    let mirrorLabel = GovernanceMonitorText.selectionBiasSummary(mirror)
    check(forwardLabel != nil && mirrorLabel != nil && forwardLabel?.title == mirrorLabel?.title
          && forwardLabel?.value == mirrorLabel?.value && forwardLabel?.value.contains("4/5") == true,
          "both directions name the same rescue: medium after low failed, 4/5 succeeded")
    // A scope where the second route ran after the first *succeeded* is not
    // a rescue, so one such scope removes the flag in either direction.
    let real = GovernanceActivityStore(root: root.appendingPathComponent("real"))
    try task(real, scope("1"), "low", adopted: false, tokens: 10, at: t)
    try task(real, scope("1"), "medium", adopted: true, tokens: 10, at: t.addingTimeInterval(60))
    try task(real, scope("2"), "medium", adopted: true, tokens: 10, at: t.addingTimeInterval(120))
    try task(real, scope("2"), "low", adopted: true, tokens: 10, at: t.addingTimeInterval(180))
    let realSnapshot = real.snapshot(legacyRoot: nil)
    let realForward = realSnapshot.comparisons(baseline: "codex / gpt-test / low", since: nil, includeHistorical: false).first!
    let realMirror = realSnapshot.comparisons(baseline: "codex / gpt-test / medium", since: nil, includeHistorical: false).first!
    check(realForward.selectionBias == .none && realMirror.selectionBias == .none
          && GovernanceMonitorText.selectionBiasSummary(realMirror) == nil,
          "a scope that ran the second route after a success is a real comparison in both directions")
    // Mixed: one scope low-first-failed, one medium-first-failed.
    let mixed = GovernanceActivityStore(root: root.appendingPathComponent("mixed"))
    try task(mixed, scope("1"), "low", adopted: false, tokens: 10, at: t)
    try task(mixed, scope("1"), "medium", adopted: true, tokens: 10, at: t.addingTimeInterval(60))
    try task(mixed, scope("2"), "medium", adopted: false, tokens: 10, at: t.addingTimeInterval(120))
    try task(mixed, scope("2"), "low", adopted: true, tokens: 10, at: t.addingTimeInterval(180))
    let mixedPair = mixed.snapshot(legacyRoot: nil).comparisons(baseline: "codex / gpt-test / low", since: nil, includeHistorical: false).first!
    check(mixedPair.selectionBias == .mixed && mixedPair.completionDeltaIsSelectionBiased,
          "every scope a rescue, in both directions, is still selection-biased")

    // 2. A stale reason names what is known and marks the cause as likely.
    let reason = GovernanceMonitorText.staleReason(since: date(9, 21, 16, 29))
    check(reason.contains("9/21") && (reason.contains("likely") || reason.contains("추정")),
          "stale reason: 'no comparison receipts since 9/21' plus a likely cause, not a fact: \(reason)")

    // 3. Chart header gate (the same enum the cards use).
    let tokenFormat: (Double?) -> String = { GovernanceMonitorText.tokenChange(savings: $0) }
    let stale = GovernanceMonitorText.headlineDisplay(.stale(since: date(9, 20, 11, 56)), lastValue: 0.696,
                                                      lastEvidence: date(9, 20, 11, 56), format: tokenFormat)
    check(!stale.prominent && stale.text.contains("\u{2212}69.6%") && stale.text.contains("9/20")
          && (stale.text.contains("last") || stale.text.contains("마지막")),
          "stale chart header is small: 'last −69.6% · 9/20' (\(stale.text))")
    let thin = GovernanceMonitorText.headlineDisplay(.tooFew(scopes: 3), lastValue: 0.667, lastEvidence: date(10, 4, 0, 0),
                                                     format: tokenFormat)
    check(!thin.prominent && thin.text == GovernanceMonitorText.tooFew(scopes: 3),
          "n=3 chart header reads 'too few', not −66.7% (\(thin.text))")
    let shown = GovernanceMonitorText.headlineDisplay(.value(0.5), lastValue: 0.5, lastEvidence: date(10, 4, 0, 0), format: tokenFormat)
    check(shown.prominent && shown.text == "\u{2212}50.0%", "a fresh value over enough scopes is the headline")
    let legacy = GovernanceMonitorText.headlineDisplay(.stale(since: nil), lastValue: 0.2, lastEvidence: nil, format: tokenFormat)
    check(!legacy.prominent && legacy.text.contains("\u{2212}20.0%"), "untimestamped evidence is small and still shows its value")

    // 4. An empty chart agrees with its card.
    var legacyOnly = forward
    legacyOnly.completionEvidence = []
    legacyOnly.tokenEvidence = []
    let noScope = GovernanceMonitorText.evidenceEmptyText(nil, series: .completion, loading: false)
    let legacyCompletion = GovernanceMonitorText.evidenceEmptyText(legacyOnly, series: .completion, loading: false)
    let legacyToken = GovernanceMonitorText.evidenceEmptyText(legacyOnly, series: .token, loading: false)
    check(legacyCompletion != noScope && legacyCompletion.contains("n=5"),
          "a legacy-only comparison does not say 'no scope ran on two routes' (\(legacyCompletion))")
    check(legacyToken != GovernanceMonitorText.evidenceEmptyText(nil, series: .token, loading: false)
          && !legacyToken.contains("No scope has tokens") && legacyToken.contains("n=5"),
          "a legacy-only measured cohort does not say 'no tokens measured' (\(legacyToken))")
    let loading = GovernanceMonitorText.evidenceEmptyText(nil, series: .completion, loading: true)
    check(loading != noScope, "while a provider change is computed the chart says it is loading")

    // 5. Evidence axis: the live luna shape (9/20 11:56 → 9/21 16:29, now 10/5).
    let lunaPoints = (0..<51).map { date(9, 20, 11, 56).addingTimeInterval(Double($0) * 1_812) }
    let now = date(10, 5, 14, 0)
    let luna = GovernanceEvidenceTimeAxis(evidence: lunaPoints, now: now, calendar: calendar)
    let labels = luna.ticks.map(\.label)
    check(Set(labels).count == labels.count, "axis labels never repeat: \(labels)")
    check(labels.contains { $0.hasPrefix("9/20") } && labels.contains { $0.hasPrefix("9/21") },
          "the evidence dates 9/20 and 9/21 are labelled: \(labels)")
    check(luna.position(lunaPoints.last!) - luna.position(lunaPoints.first!) >= 0.6,
          "the evidence series gets most of the width, not ~8%: \(luna.position(lunaPoints.last!) - luna.position(lunaPoints.first!))")
    check(luna.breakRange != nil && luna.gapLabel?.contains("14") == true,
          "the empty two weeks are a labelled break, not hidden: \(luna.gapLabel ?? "nil")")
    check(abs(luna.position(now) - 1) < 1e-9 && luna.ticks.last.map { abs($0.position - 1) < 1e-9 } == true,
          "now is the right edge and is marked")
    check(zip(luna.ticks, luna.ticks.dropFirst()).allSatisfy { $0.position < $1.position }
          && zip(lunaPoints, lunaPoints.dropFirst()).allSatisfy { luna.position($0) < luna.position($1) },
          "positions keep time order")
    // A 2-day spread close to now (the reviewer's 10/3 10/3 10/4 10/4 case).
    let shortPoints = (0..<6).map { date(10, 3, 9, 0).addingTimeInterval(Double($0) * 30_000) }
    let short = GovernanceEvidenceTimeAxis(evidence: shortPoints, now: date(10, 5, 14, 0), calendar: calendar)
    let shortLabels = short.ticks.map(\.label)
    check(Set(shortLabels).count == shortLabels.count && shortLabels.contains { $0.hasPrefix("10/3") },
          "a 1–4 day span labels each date once: \(shortLabels)")
    // Twenty days of evidence up to now: day ticks, unique, not crowded.
    let longPoints = (0..<40).map { date(9, 15, 8, 0).addingTimeInterval(Double($0) * 43_000) }
    let long = GovernanceEvidenceTimeAxis(evidence: longPoints, now: date(10, 5, 14, 0), calendar: calendar)
    let longLabels = long.ticks.map(\.label)
    check(Set(longLabels).count == longLabels.count && longLabels.count <= 9 && long.breakRange == nil,
          "a long fresh series is linear with at most 9 unique ticks: \(longLabels)")
    // Evidence within the last hours: no break, unique hour labels.
    let recentPoints = (0..<5).map { now.addingTimeInterval(-18_000 + Double($0) * 3_600) }
    let recent = GovernanceEvidenceTimeAxis(evidence: recentPoints, now: now, calendar: calendar)
    let recentLabels = recent.ticks.map(\.label)
    check(recent.breakRange == nil && Set(recentLabels).count == recentLabels.count && recentLabels.count >= 2,
          "a same-day series is linear with unique hour labels: \(recentLabels)")

    guard failures.isEmpty else {
        let list = failures.map { "  FAIL " + $0 }.joined(separator: "\n")
        fputs("Governance monitor round 2: \(failures.count)/\(checks) checks FAIL\n\(list)\n", stderr)
        preconditionFailure("governance monitor round 2 fixtures failed")
    }
    print("Governance monitor round 2: \(checks) checks PASS; paid calls=0; fixtures isolated")
}
