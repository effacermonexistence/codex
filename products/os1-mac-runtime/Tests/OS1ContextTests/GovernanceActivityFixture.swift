import Foundation
import OS1Context

func runGovernanceActivityFixtures() throws {
    runGovernanceStatisticsFixtures()
    try runGovernanceRuntimeFixtures()
    let fm = FileManager.default
    let root = fm.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("governance-fixture-\(UUID())")
    try fm.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: root) }
    let store = GovernanceActivityStore(root: root.appendingPathComponent("new"))
    let legacy = CompletionFeedbackStore(root: root.appendingPathComponent("legacy"))
    let start = Date(timeIntervalSince1970: 1_700_000_000)
    let scope = CompletionFeedbackScope(objectiveSHA256: String(repeating: "a", count: 64), sourceSHA256: nil,
        executorContractSHA256: String(repeating: "b", count: 64), assembledInputSHA256: String(repeating: "c", count: 64))
    let otherScope = CompletionFeedbackScope(objectiveSHA256: String(repeating: "d", count: 64), sourceSHA256: nil,
        executorContractSHA256: String(repeating: "b", count: 64), assembledInputSHA256: String(repeating: "c", count: 64))
    func usage(_ input: Int, _ output: Int, cache: Int = 0, provider: String = "codex", version: Int? = 2) -> CompletionMeasuredUsage {
        CompletionMeasuredUsage(inputTokens: input, outputTokens: output, cacheTokens: cache,
            resource: CompletionUsageResourceMetadata(format: provider == "codex" ? .codexRolloutJSONL : .claudeResultJSON,
                byteCount: 100, sha256: String(repeating: "e", count: 64), usageRecordCount: 1, accountingVersion: version))
    }
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ label: String) { precondition(value(), label); checks += 1 }
    func rejects(_ label: String, _ body: () throws -> Void) { do { try body(); fatalError(label) } catch { checks += 1 } }
    func add(_ id: String, _ remote: String, _ seq: Int, _ model: String, _ outcome: CompletionOutcome,
             _ measured: CompletionMeasuredUsage?, provider: String = "codex", bound: CompletionFeedbackScope? = nil) throws -> CompletionFeedbackObservation {
        let o = CompletionFeedbackObservation(executionID: remote, sequence: seq, provider: provider, model: model, effort: "low",
            outcome: outcome, usage: measured, durationMS: 2000)
        try store.attempt(id: id, executionID: remote, sequence: seq, scope: bound ?? scope, provider: provider,
            model: model, effort: "low", startedAt: start.addingTimeInterval(Double(seq)), observation: o)
        return o
    }
    let t1 = UUID().uuidString.lowercased(), r1 = UUID().uuidString.lowercased()
    try store.begin(id: t1, now: start)
    let failed = try add(t1, r1, 1, "cheap", .qualityFailure, usage(80,20,cache:60))
    let good = try add(t1, r1, 2, "strong", .adopted, usage(200,50))
    try store.finish(id: t1, adopted: true, now: start.addingTimeInterval(9))
    let s1 = store.snapshot(legacyRoot: nil)
    check(s1.tasks[0].verifiedCompletion == nil, "delivery adoption is not objective completion")
    check(s1.quality(since:nil).rate == nil && s1.quality(since:nil).unknown == 1, "no invented quality from delivery receipt")
    check(s1.quality(since:nil).bounds == 0...1, "unknown quality has identification bounds, not fabricated point estimate")
    check(GovernanceSnapshot().observedTaskHours(now:start,since:start.addingTimeInterval(-86400)) == 0, "empty lookback never invents observed coverage")
    check(s1.observedTaskHours(now:start.addingTimeInterval(1800),since:start.addingTimeInterval(-86400)) == 0.5, "fresh telemetry does not imply 24 hour coverage")
    check(s1.observedTaskHours(now:start.addingTimeInterval(7200),since:start.addingTimeInterval(3600)) == 1, "observed coverage capped by selected period")
    check(s1.observedTaskHours(now:start.addingTimeInterval(7200),since:nil) == 2, "all time coverage uses real task start")
    check(s1.observedTaskHours(now:start.addingTimeInterval(-1),since:nil) == 0, "future task time cannot produce negative coverage")
    check(s1.tasks.count == 1 && s1.tasks[0].tokens == 350, "retry cost preserved and cache not added twice")
    check(s1.tasks[0].route == "mixed / recovery / multiple", "no cheap-route success credit")
    check(s1.routes(since: nil, includeHistorical: false).first { $0.id.hasPrefix("mixed") }?.completionRate == 1, "task completion != attempt adoption")
    check(s1.samples(since: nil, includeHistorical: false).count == 2, "two attempts one task")
    let mixed = s1.routes(since: nil, includeHistorical: false).first { $0.id.hasPrefix("mixed") }!
    check(abs(mixed.completionsPerMillionTokens! - 1_000_000/350) < 0.001, "retry efficiency denominator")
    check(mixed.tokensPerCompletedTask == 350, "completed-task token cost uses adopted tasks, not direct-only completions")
    try legacy.record(scope: scope, observation: failed); try legacy.record(scope: scope, observation: good)
    check(store.snapshot(legacyRoot: legacy.root).samples(since: nil, includeHistorical: true).count == 2, "legacy duplicate excluded")
    check(store.snapshot(legacyRoot: legacy.root).samples(since: start.addingTimeInterval(100), includeHistorical: true).isEmpty, "old duplicate cannot reenter filtered period")
    try store.attempt(id: t1, executionID: r1, sequence: 2, scope: scope, provider: "codex", model: "strong", effort: "low", startedAt: start.addingTimeInterval(2))
    check(store.snapshot(legacyRoot: nil).tasks[0].tokens == 350, "duplicate start never erases final usage")
    let comparison = s1.comparisons(baseline: "codex / cheap / low", since: nil, includeHistorical: false).first!
    check(comparison.tokenSavings == -1.5 && comparison.adoptionDelta == 1, "negative saving and positive quality shown together")
    check(comparison.baselineMeanTokens == 100 && comparison.candidateMeanTokens == 250, "complete matched usage exposes observed absolute means")
    check(comparison.matchedScopes == 1 && comparison.baselineAttempts == 1, "matched denominator")
    let t2 = UUID().uuidString.lowercased(), r2 = UUID().uuidString.lowercased()
    try store.begin(id: t2, now: start)
    _ = try add(t2, r2, 1, "strong", .qualityFailure, nil)
    try store.finish(id: t2, adopted: false, now: start.addingTimeInterval(5))
    let s2 = store.snapshot(legacyRoot: nil)
    check(s2.tasks.first { $0.id == t2 }?.tokens == nil, "missing tokens not zero")
    check(s2.routes(since: nil, includeHistorical: false).first { $0.id == "codex / strong / low" }?.completionsPerMillionTokens == nil, "unknown failed cost disables efficiency")
    let partialComparison = s2.comparisons(baseline: "codex / cheap / low", since: nil, includeHistorical: false).first
    check(partialComparison != nil, "matched route remains visible when usage is incomplete")
    check(partialComparison?.tokenSavings == nil, "partial usage disables estimate")
    check(partialComparison?.baselineMeanTokens == nil && partialComparison?.candidateMeanTokens == nil, "partial matched usage hides both absolute means")
    let t3 = UUID().uuidString.lowercased()
    try store.begin(id: t3, now: start)
    _ = try add(t3, UUID().uuidString.lowercased(), 1, "foreign", .adopted, usage(1,1,provider:"claude",version:1), provider:"claude")
    try store.finish(id: t3, adopted: true, now: start.addingTimeInterval(5))
    check(!store.snapshot(legacyRoot:nil).comparisons(baseline:"codex / cheap / low",since:nil,includeHistorical:false).contains { $0.id.hasPrefix("claude") }, "cross tokenizer estimate blocked")
    let t4 = UUID().uuidString.lowercased()
    try store.begin(id: t4, now: start)
    _ = try add(t4, UUID().uuidString.lowercased(), 1, "unmatched", .adopted, usage(1,1), bound:otherScope)
    try store.finish(id:t4,adopted:true,now:start.addingTimeInterval(5))
    check(!store.snapshot(legacyRoot:nil).comparisons(baseline:"codex / cheap / low",since:nil,includeHistorical:false).contains { $0.id.contains("unmatched") }, "different scope not a matched pair")
    let pending = UUID().uuidString.lowercased()
    try store.begin(id:pending,now:start)
    check(store.snapshot(legacyRoot:nil).tasks.filter { !$0.isTerminal }.count == 1, "interrupted pending is not completed")
    try store.markOwnerRetry(id:t1,now:start.addingTimeInterval(15))
    try store.markOwnerRetry(id:t1,now:start.addingTimeInterval(16))
    check(store.snapshot(legacyRoot:nil).tasks.first { $0.id == t1 }?.ownerRetryAt == start.addingTimeInterval(15), "owner retry marker is idempotent")
    let timeline = store.snapshot(legacyRoot:nil).timeline(since:start,until:start.addingTimeInterval(30),bucketSeconds:60)
    check(timeline.reduce(0) { $0+$1.completions } == 3, "task not attempt completion timeline")
    check(timeline.reduce(0) { $0+$1.firstPassCompletions } == 2, "timeline separates one-pass completions")
    check(timeline.reduce(0) { $0+$1.ownerAssistedCompletions } == 1, "timeline exposes adopted work with owner assistance")
    check(timeline.reduce(0) { $0+$1.firstPassCompletions+$1.ownerAssistedCompletions } == timeline.reduce(0) { $0+$1.completions }, "completion subtypes reconcile")
    check(timeline.reduce(0) { $0+$1.nonAdopted } == 1, "failures remain visible")
    check(store.snapshot(legacyRoot:nil).quality(since:nil).eligible == 4, "quality denominator excludes pending, includes terminal failure")
    let preparation = UUID().uuidString.lowercased()
    try store.begin(id:preparation,now:start)
    try store.finish(id:preparation,adopted:false,now:start.addingTimeInterval(3))
    check(store.snapshot(legacyRoot:nil).quality(since:nil).eligible == 5, "preparation failure cannot disappear from quality denominator")
    check(timeline.reduce(0) { $0+$1.tokens } == 354, "all metered attempts including failure")
    check(s1.timeline(since:start,until:start,bucketSeconds:0).isEmpty, "invalid bucket rejected")
    let old = CompletionFeedbackObservation(executionID:UUID().uuidString.lowercased(),sequence:1,provider:"codex",model:"old",effort:"low",outcome:.adopted,usage:usage(10,10,version:nil),durationMS:1000)
    check(GovernanceSnapshot.tokens(old) == nil,"old accounting not silently trusted")
    try legacy.record(scope:scope,observation:old)
    let all = store.snapshot(legacyRoot:legacy.root)
    check(all.historical.count == 3 && all.tasks.count == 6,"legacy is read-only sample lane")
    check(all.selectedTasks(since:start.addingTimeInterval(1)).isEmpty,"legacy dates never invented")
    try Data("not JSON".utf8).write(to:store.root.appendingPathComponent("bad.json"))
    check(store.snapshot(legacyRoot:nil).rejectedRecords == 1,"malformed record reported")
    try fm.createSymbolicLink(at:store.root.appendingPathComponent("link.json"),withDestinationURL:store.root.appendingPathComponent(t1+".json"))
    check(store.snapshot(legacyRoot:nil).rejectedRecords == 2,"symlink rejected")
    rejects("path escape rejected") { try store.begin(id:"../escape",now:start) }
    rejects("existing task not overwritten") { try store.begin(id:t1,now:start) }
    rejects("invalid time rejected") { try store.finish(id:pending,adopted:true,now:start.addingTimeInterval(-1)) }
    try store.deliveryAdopted(executionID:r2,sequence:1,now:start.addingTimeInterval(20))
    let recovered = store.snapshot(legacyRoot:nil).tasks.first { $0.id == t2 }!
    check(recovered.isAdopted && recovered.initialDisposition == "not_adopted" && recovered.initialEndedAt == start.addingTimeInterval(5), "recovery preserves prior termination")
    check(recovered.attempts.count == 1 && recovered.tokens == nil, "recovery never duplicates calls or invents usage")
    try store.deliveryAdopted(executionID:r2,sequence:1,now:start.addingTimeInterval(25))
    check(store.snapshot(legacyRoot:nil).tasks.first { $0.id == t2 }?.recoveredAt == start.addingTimeInterval(20), "recovery idempotency")
    rejects("unknown recovery cannot create task") { try store.deliveryAdopted(executionID:UUID().uuidString,sequence:1) }
    let serialized = String(data:try Data(contentsOf:store.root.appendingPathComponent(t1+".json")),encoding:.utf8)!
    check(!serialized.contains("prompt") && !serialized.contains("/Users/") && !serialized.contains("api_key"),"content free metadata")
    print("Governance activity: \(checks) checks PASS; paid calls=0; fixtures isolated")
}
