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
    let emptyUpdate = store.snapshotIfChanged(after: nil, legacyRoot: nil)!
    check(emptyUpdate.snapshot.tasks.isEmpty, "initial revision poll returns the empty snapshot")
    check(store.snapshotIfChanged(after: emptyUpdate.revision, legacyRoot: nil) == nil,
          "unchanged directory skips full JSON snapshot rebuild")
    let t1 = UUID().uuidString.lowercased(), r1 = UUID().uuidString.lowercased()
    try store.begin(id: t1, now: start)
    let firstReceiptUpdate = store.snapshotIfChanged(after: emptyUpdate.revision, legacyRoot: nil)
    check(firstReceiptUpdate?.snapshot.tasks.count == 1, "atomic receipt mutation invalidates the cheap revision token")

    let incrementalStore = GovernanceActivityStore(root: root.appendingPathComponent("incremental"))
    let incrementalCache = GovernanceActivityIncrementalCache(store: incrementalStore, legacyRoot: nil)
    check(incrementalCache.snapshotIfChanged()?.decodedFiles == 0, "incremental cache initializes without fabricated reads")
    check(incrementalCache.snapshotIfChanged() == nil, "incremental cache unchanged poll is empty")
    let incrementalID = UUID().uuidString.lowercased()
    let incrementalRemote = UUID().uuidString.lowercased()
    try incrementalStore.begin(id: incrementalID, now: start)
    let incrementalBegin = incrementalCache.snapshotIfChanged()
    check(incrementalBegin?.decodedFiles == 1 && incrementalBegin?.snapshot.tasks.count == 1,
          "incremental cache decodes only the added receipt")
    let incrementalObservation = CompletionFeedbackObservation(executionID: incrementalRemote, sequence: 1,
        provider: "codex", model: "incremental", effort: "low", outcome: .adopted,
        usage: usage(20, 5), durationMS: 200)
    try incrementalStore.attempt(id: incrementalID, executionID: incrementalRemote, sequence: 1, scope: scope,
        provider: "codex", model: "incremental", effort: "low", startedAt: start.addingTimeInterval(0.1),
        observation: incrementalObservation)
    try incrementalStore.finish(id: incrementalID, adopted: true, now: start.addingTimeInterval(1))
    let incrementalFinish = incrementalCache.snapshotIfChanged()
    check(incrementalFinish?.decodedFiles == 1 && incrementalFinish?.snapshot.tasks.first?.isAdopted == true,
          "incremental cache reparses only the replaced receipt")
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

    var history = GovernanceDeltaHistory(capacity: 4)
    history.append(at:start,tokenSavings:nil,taskCompletionDelta:nil)
    check(history.points.isEmpty,"missing deltas do not become zero-valued chart points")
    for index in 0..<7 {
        history.append(at:start.addingTimeInterval(Double(index)),tokenSavings:Double(index)/100,
                       taskCompletionDelta:Double(-index)/100)
    }
    check(history.points.count == 4 && history.points.first?.tokenSavings == 0.03,
          "delta chart history remains bounded and retains newest exact samples")
    history.reset(at:start.addingTimeInterval(10),tokenSavings:0.5,taskCompletionDelta:0)
    check(history.points.count == 1 && history.points.first?.tokenSavings == 0.5 && history.points.first?.taskCompletionDelta == 0,
          "filter context reset removes stale graph points before reseeding")

    let dashboardStore = GovernanceActivityStore(root:root.appendingPathComponent("dashboard"))
    func dashboardTask(_ model:String, adopted:Bool, input:Int, output:Int, offset:Double,
                       bound: CompletionFeedbackScope = scope) throws {
        let id = UUID().uuidString.lowercased(), remote = UUID().uuidString.lowercased()
        try dashboardStore.begin(id:id,now:start.addingTimeInterval(offset))
        let observation = CompletionFeedbackObservation(executionID:remote,sequence:1,provider:"codex",model:model,effort:"low",
            outcome:adopted ? .adopted : .qualityFailure,usage:usage(input,output),durationMS:1000)
        try dashboardStore.attempt(id:id,executionID:remote,sequence:1,scope:bound,provider:"codex",model:model,effort:"low",
            startedAt:start.addingTimeInterval(offset+0.1),observation:observation)
        try dashboardStore.finish(id:id,adopted:adopted,now:start.addingTimeInterval(offset+1))
    }
    try dashboardTask("dashboard-base",adopted:true,input:160,output:40,offset:100)
    try dashboardTask("dashboard-candidate",adopted:true,input:40,output:10,offset:110)
    try dashboardTask("dashboard-candidate",adopted:false,input:40,output:10,offset:120)
    let dashboard = dashboardStore.snapshot(legacyRoot:nil)
    let dashboardComparison = dashboard.comparisons(baseline:"codex / dashboard-base / low",since:nil,includeHistorical:false)
        .first { $0.id == "codex / dashboard-candidate / low" }!
    check(dashboardComparison.tokenSavings == 0.5,"token reduction includes every retry and failure in the matched scope")
    check(dashboardComparison.taskCompletionDelta == 0,"task completion delta uses the same matched scope as token reduction")
    check(dashboardComparison.baselineTaskCompletionRate == 1 && dashboardComparison.candidateTaskCompletionRate == 1,
          "matched completion rates expose the exact comparison cohort")
    check(dashboardComparison.completionEfficiencyDelta == 1,"overall efficiency combines completions with all measured task cost")
    try dashboardTask("dashboard-candidate",adopted:false,input:400,output:100,offset:130,bound:otherScope)
    let unrelatedFailureComparison = dashboardStore.snapshot(legacyRoot:nil)
        .comparisons(baseline:"codex / dashboard-base / low",since:nil,includeHistorical:false)
        .first { $0.id == "codex / dashboard-candidate / low" }!
    check(unrelatedFailureComparison.tokenSavings == dashboardComparison.tokenSavings &&
          unrelatedFailureComparison.taskCompletionDelta == dashboardComparison.taskCompletionDelta &&
          unrelatedFailureComparison.completionEfficiencyDelta == dashboardComparison.completionEfficiencyDelta,
          "unmatched route failure cannot change any matched-cohort dashboard delta")
    let projection = dashboard.dashboardProjection(provider:"codex",since:nil,includeHistorical:false,now:start.addingTimeInterval(200))
    check(projection.tasks.count == 3 && projection.rows.count == 2 &&
          projection.comparisonsByBaseline["codex / dashboard-base / low"]?.count == 1,
          "dashboard projection precomputes one coherent filtered aggregate off the UI actor")
    // Live activity strip: a fixed window anchored to the tick, zero-filled,
    // with absolute buckets so samples slide instead of re-bucketing.
    let runningID = UUID().uuidString.lowercased()
    try dashboardStore.begin(id:runningID,now:start.addingTimeInterval(150))
    let stripTasks = dashboardStore.snapshot(legacyRoot:nil).tasks
    check(stripTasks.count == 5, "strip fixture has four finished tasks and one running task")
    let stripEnd = start.addingTimeInterval(200)
    let strip = GovernanceActivityStrip.build(tasks:stripTasks,until:stripEnd,span:1_800,bucketSeconds:10)
    check(strip.start == start.addingTimeInterval(-1_600) && strip.end == stripEnd && strip.bucketSeconds == 10,
          "activity strip keeps the requested window and bucket")
    check(strip.points.count == 182 && strip.points.first?.id == strip.start && strip.points.last?.id == strip.end,
          "activity strip is dense over the whole window and pinned to both edges")
    check(zip(strip.points, strip.points.dropFirst()).allSatisfy { $0.id < $1.id }, "activity strip samples strictly increase")
    check(strip.startedTotal == 5 && strip.finishedTotal == 4, "activity strip counts every start and finish receipt in the window once")
    let firstBucket = strip.points.first { $0.id == start.addingTimeInterval(105) }
    check(firstBucket?.started == 1 && firstBucket?.finished == 1, "receipts land in the absolute bucket containing their time")
    let runningBucket = strip.points.first { $0.id == start.addingTimeInterval(155) }
    check(runningBucket?.started == 1 && runningBucket?.finished == 0, "a running task counts as started, not finished")
    check(strip.points.filter { $0.started == 0 && $0.finished == 0 }.count == strip.points.count - 5,
          "every bucket without a receipt is a measured zero, not a gap")
    let slid = GovernanceActivityStrip.build(tasks:stripTasks,until:stripEnd.addingTimeInterval(1),span:1_800,bucketSeconds:10)
    check(slid.start == strip.start.addingTimeInterval(1) && slid.end == strip.end.addingTimeInterval(1) &&
          slid.points.first { $0.id == start.addingTimeInterval(105) }?.started == 1,
          "advancing one second slides the window while interior samples keep their time")
    let idle = GovernanceActivityStrip.build(tasks:stripTasks,until:start.addingTimeInterval(10_000),span:1_800,bucketSeconds:10)
    check(idle.points.count == 182 && idle.maxValue == 0 && idle.points.first?.id == start.addingTimeInterval(8_200) &&
          idle.points.last?.id == start.addingTimeInterval(10_000),
          "with no receipts in the window the strip still flows at zero across the full width")
    let head = GovernanceActivityStrip.build(tasks:stripTasks,until:start.addingTimeInterval(150),span:1_800,bucketSeconds:10)
    check(head.points.last?.id == start.addingTimeInterval(150) && head.points.last?.started == 1,
          "a receipt written this second appears at the right edge immediately")
    let coarse = GovernanceActivityStrip.build(tasks:stripTasks,until:stripEnd,span:604_800,bucketSeconds:1)
    check(coarse.points.count <= GovernanceActivityStrip.maximumBuckets + 3 && coarse.bucketSeconds >= 302 &&
          coarse.points.last?.id == stripEnd && coarse.startedTotal == 5,
          "pathological bucket sizes are coarsened, never truncated")
    check(GovernanceActivityStrip.build(tasks:stripTasks,until:stripEnd,span:0,bucketSeconds:10).points.isEmpty,
          "an empty window yields no fabricated samples")
    let utc = TimeZone(identifier: "UTC")!
    let ticks = GovernanceActivityStrip.axisTicks(from: strip.start, to: strip.end, every: 300, edgeMargin: 72, timeZone: utc)
    check(ticks.count == 6 && ticks.first == start.addingTimeInterval(-1_400) && ticks.last == start.addingTimeInterval(100) &&
          ticks.allSatisfy { $0.timeIntervalSince1970.truncatingRemainder(dividingBy: 300) == 0 } &&
          ticks.allSatisfy { $0 >= strip.start.addingTimeInterval(72) && $0 <= strip.end.addingTimeInterval(-72) },
          "axis ticks are nice multiples kept a margin inside both plot edges")
    let shifted = TimeZone(secondsFromGMT: 3_600)!
    let dayTicks = GovernanceActivityStrip.axisTicks(from: start.addingTimeInterval(-604_800), to: start, every: 86_400,
                                                     edgeMargin: 600, timeZone: shifted)
    check(dayTicks.count == 7 && dayTicks.allSatisfy { ($0.timeIntervalSince1970 + 3_600).truncatingRemainder(dividingBy: 86_400) == 0 },
          "day ticks fall on local midnight in the given time zone")
    check(GovernanceActivityStrip.axisTicks(from: strip.end, to: strip.start, every: 300, edgeMargin: 0, timeZone: utc).isEmpty &&
          GovernanceActivityStrip.axisTicks(from: strip.start, to: strip.end, every: 0, edgeMargin: 0, timeZone: utc).isEmpty &&
          GovernanceActivityStrip.axisTicks(from: strip.start, to: strip.end, every: 1, edgeMargin: 0, timeZone: utc).count == 64,
          "axis ticks reject an inverted or zero-interval window and stay bounded")
    print("Governance activity: \(checks) checks PASS; paid calls=0; fixtures isolated")
}
