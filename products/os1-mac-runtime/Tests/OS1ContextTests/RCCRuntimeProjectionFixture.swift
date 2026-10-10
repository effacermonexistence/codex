import Foundation
import OS1Context

private enum RCCRuntimeProjectionFixtureError: Error { case failed(String) }
func runRCCRuntimeProjectionFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ name: String) throws {
        guard condition else { throw RCCRuntimeProjectionFixtureError.failed(name) }; checks += 1
    }
    func rejects(_ name: String, _ body: () throws -> Void) throws {
        do { try body() } catch { checks += 1; return }
        throw RCCRuntimeProjectionFixtureError.failed("accepted invalid: " + name)
    }
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let conversation = UUID(), submission = UUID()
    let request = "Inspect the requested project only."
    let hash = SourceContextStore.digest(Data(request.utf8))
    func project(_ core: RCCRuntimeContract.Snapshot, at: Date = now, previous: ParallelAgentTask.Snapshot? = nil) throws -> ParallelAgentTask.Snapshot {
        try RCCRuntimeProjection.project(core, conversationID: conversation, submissionID: submission,
            objective: request, observedAt: at, firstObservedAt: now, maxParallelism: 4,
            expectedRequestSHA256: hash, previous: previous)
    }
    var core = RCCRuntimeContract.Snapshot(taskID: "task", requestSHA256: hash, state: .queued, revision: 1,
        children: [], result: nil, error: nil)
    let queued = try project(core)
    try check(queued.nodes.count == 1 && queued.nodes[0].state == .pending, "no fabricated children before plan")
    core.state = .running
    core.children = [.init(id: "one", state: .running, attemptID: "attempt", candidateID: "candidate")]
    let single = try project(core)
    try check(single.nodes.count == 2 && single.nodes.filter { $0.role == .worker }.count == 1, "one actual child visible")
    try check(single.nodes.allSatisfy { $0.model == nil && $0.effort == nil && $0.provider == nil }, "unknown execution configuration not invented")
    try check(single.nodes.last?.progressText?.contains("first observation") == true, "missing native timestamp stays labelled observation")
    let later = try project(core, at: now.addingTimeInterval(2), previous: single)
    try check(single.planID == later.planID && single.nodes.map(\.id) == later.nodes.map(\.id), "stable display identities")
    try check(single.nodes.last?.startedAt == later.nodes.last?.startedAt, "observer clock does not reset on each poll")
    core.children = (0..<4).map { .init(id: "node\($0)", state: .running, attemptID: "attempt\($0)", candidateID: "candidate\($0)",
                                    startedAtMS: Int64(now.timeIntervalSince1970 * 1000)) }
    let four = try project(core)
    try check(four.nodes.filter { $0.role == .worker && $0.state == .running }.count == 4, "four real parallel children")
    core.children[1].dependencies = ["node0"]
    try rejects("running before dependency succeeds") { _ = try project(core) }
    core.children[0].state = .succeeded
    core.children[0].finishedAtMS = Int64(now.timeIntervalSince1970 * 1000)
    _ = try project(core); checks += 1
    core.children[1].state = .effectsUncertain
    core.children[1].dependencies = nil
    let uncertain = try project(core)
    try check(uncertain.nodes.first { $0.id == four.nodes[2].id }?.state == .interrupted, "uncertain effect never success")
    core.children = [.init(id: "one", state: .succeeded, attemptID: "attempt", candidateID: "candidate", startedAtMS: 1_800_000_000_000,
                           finishedAtMS: 1_800_000_000_000)]
    core.state = .returnedUnverified
    core.result = .init(output: "Private raw result must not enter public graph", executionVerified: true,
                        taskVerified: false, parityState: .unverified, nativeReceipt: "private-record")
    let candidate = try project(core)
    try check(candidate.nodes[0].state != .succeeded, "unverified return not task success")
    try check(!String(decoding: try candidate.encoded(), as: UTF8.self).contains("Private raw result"), "raw output not leaked to public graph")
    core.state = .completed; core.result?.taskVerified = true
    let complete = try project(core)
    try check(complete.nodes[0].state == .succeeded, "task-verified completion represented faithfully")
    var foreign = core; foreign.requestSHA256 = String(repeating: "b", count: 64)
    try rejects("request binding") { _ = try project(foreign) }
    var overflow = core; overflow.children = (0..<9).map { .init(id: "n\($0)", state: .pending, attemptID: nil, candidateID: nil) }
    try rejects("do not silently omit extra children") { _ = try project(overflow) }
    var future = core; future.children[0].startedAtMS = 1_800_000_001_000
    try rejects("future timestamp") { _ = try project(future) }
    try check(try ParallelAgentTask.Snapshot.decode(complete.encoded(), conversationID: conversation,
        submissionID: submission, requestSHA256: hash).isValid, "existing UI wire roundtrip")
    print("RCC Runtime UI projection: \(checks) deterministic checks PASS; no scheduling/provider/model calls")
}
