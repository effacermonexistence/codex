import Foundation
import OS1Context

private enum ParallelAgentFixtureError: Error { case failed(String) }

/// Pure scheduling/state and private temporary-file fixtures. Actual native
/// process concurrency remains a separate runtime-adapter verification gate.
func runParallelAgentTaskFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) throws {
        guard value else { throw ParallelAgentFixtureError.failed(label) }; checks += 1
    }
    func rejects(_ label: String, _ body: () throws -> Void) throws {
        do { try body() } catch { checks += 1; return }
        throw ParallelAgentFixtureError.failed("not rejected: " + label)
    }
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let parent = UUID(), conversation = UUID(), rootID = UUID(), plannerID = UUID(), primaryID = UUID()
    let objective = "Inspect two independent source areas, then implement the owner request."
    let requestHash = SourceContextStore.digest(Data(objective.utf8))
    let workers = [
        ParallelAgentTask.WorkerSpec(slug: "source", title: "Inspect source", instruction: "Read bounded source only."),
        ParallelAgentTask.WorkerSpec(slug: "tests", title: "Inspect tests", instruction: "Read bounded tests only."),
        ParallelAgentTask.WorkerSpec(slug: "contracts", title: "Inspect contracts", instruction: "Read the contract only.")
    ]
    let plan = ParallelAgentTask.Plan(conversationID: conversation, submissionID: parent, requestSHA256: requestHash,
        rootNodeID: rootID, plannerNodeID: plannerID, primaryNodeID: primaryID, originalInstruction: objective,
        workspace: "/fixture/workspace", workers: workers, maxParallelism: 2)
    _ = try plan.validated(); checks += 1
    let draft = ParallelAgentTask.Draft(tasks: [
        .init(id: "source", title: "Read source", instruction: "Inspect source only."),
        .init(id: "tests", title: "Read tests", instruction: "Inspect tests only.", dependencies: ["source"])
    ])
    try check(try draft.validated() == draft, "bounded acyclic draft")
    try check(try JSONDecoder().decode(ParallelAgentTask.Draft.self, from: JSONEncoder().encode(draft)) == draft, "draft roundtrip")
    for count in [0, 1, 4] {
        try rejects("draft worker count \(count)") { _ = try ParallelAgentTask.Draft(tasks: (0..<count).map {
            .init(id: "task\($0)", title: "Task", instruction: "Read only") }).validated() }
    }
    var invalidDraft = draft; invalidDraft.tasks[1].id = "source"
    try rejects("duplicate slug") { _ = try invalidDraft.validated() }
    invalidDraft = draft; invalidDraft.tasks[0].dependencies = ["tests"]
    try rejects("cyclic draft") { _ = try invalidDraft.validated() }
    invalidDraft = draft; invalidDraft.tasks[0].dependencies = ["missing"]
    try rejects("unknown dependency") { _ = try invalidDraft.validated() }
    invalidDraft = draft; invalidDraft.tasks[0].dependencies = ["source"]
    try rejects("self dependency") { _ = try invalidDraft.validated() }
    invalidDraft = draft; invalidDraft.tasks[0].id = "../escape"
    try rejects("unsafe slug") { _ = try invalidDraft.validated() }
    invalidDraft = draft; invalidDraft.tasks[0].instruction = String(repeating: "a", count: 6_001)
    try rejects("draft instruction budget") { _ = try invalidDraft.validated() }
    let grantedJSON = Data(#"{"tasks":[{"id":"a","title":"A","instruction":"Read","scope":"workspace_write"},{"id":"b","title":"B","instruction":"Read"}]}"#.utf8)
    try rejects("planner cannot mint scope/provider/path grants") { _ = try JSONDecoder().decode(ParallelAgentTask.Draft.self, from: grantedJSON) }
    var invalidPlan = plan; invalidPlan.workers[0].scope = .workspaceWrite
    try rejects("worker write scope") { _ = try invalidPlan.validated() }
    invalidPlan = plan; invalidPlan.scope = .fullAccess
    try rejects("unsupported full access") { _ = try invalidPlan.validated() }
    invalidPlan = plan; invalidPlan.workers[0].dependencies = [workers[1].id]; invalidPlan.workers[1].dependencies = [workers[0].id]
    try rejects("plan cycle") { _ = try invalidPlan.validated() }
    invalidPlan = plan; invalidPlan.workspace = "/fixture/../foreign"
    try rejects("workspace traversal") { _ = try invalidPlan.validated() }
    invalidPlan = plan; invalidPlan.maxParallelism = 4
    try rejects("cap above three") { _ = try invalidPlan.validated() }

    var snapshot = try ParallelAgentTask.Snapshot.fromPlan(plan, createdAt: now)
    try check(snapshot.nodes.count == 6 && snapshot.nodes.allSatisfy({ $0.state == .pending }), "factory does not invent execution")
    try check(!String(decoding: try snapshot.encoded(), as: UTF8.self).contains("Read bounded source only"), "public snapshot excludes private instructions")
    try check(try ParallelAgentTask.readyWorkerIDs(in: snapshot).isEmpty, "unstarted coordinator cannot dispatch")
    try snapshot.transition(nodeID: rootID, to: .running, at: now)
    try check(try ParallelAgentTask.readyWorkerIDs(in: snapshot).isEmpty, "planner dependency not yet complete")
    try snapshot.transition(nodeID: plannerID, to: .running, at: now)
    try snapshot.transition(nodeID: plannerID, to: .succeeded, at: now.addingTimeInterval(1))
    try check(try ParallelAgentTask.readyWorkerIDs(in: snapshot) == workers.prefix(2).map(\.id), "ready selector uses bounded worker cap")
    try snapshot.transition(nodeID: workers[0].id, to: .running, at: now.addingTimeInterval(1))
    try snapshot.transition(nodeID: workers[1].id, to: .running, at: now.addingTimeInterval(1))
    try check(try ParallelAgentTask.readyWorkerIDs(in: snapshot).isEmpty, "two active workers fill configured cap")
    try rejects("third worker cannot start before a slot frees") { try snapshot.transition(nodeID: workers[2].id, to: .running, at: now.addingTimeInterval(1)) }
    try snapshot.transition(nodeID: workers[0].id, to: .succeeded, at: now.addingTimeInterval(2))
    try check(try ParallelAgentTask.readyWorkerIDs(in: snapshot) == [workers[2].id], "one freed slot admits one remaining worker")
    try rejects("primary cannot start before all worker dependencies succeed") { try snapshot.transition(nodeID: primaryID, to: .running, at: now.addingTimeInterval(2)) }
    try snapshot.transition(nodeID: workers[2].id, to: .running, at: now.addingTimeInterval(2))
    try snapshot.transition(nodeID: workers[1].id, to: .succeeded, at: now.addingTimeInterval(3))
    try snapshot.transition(nodeID: workers[2].id, to: .succeeded, at: now.addingTimeInterval(3))
    try snapshot.transition(nodeID: primaryID, to: .running, at: now.addingTimeInterval(3))
    try snapshot.transition(nodeID: primaryID, to: .succeeded, at: now.addingTimeInterval(4))
    try snapshot.transition(nodeID: rootID, to: .succeeded, at: now.addingTimeInterval(4))
    try check(snapshot.nodes.allSatisfy({ $0.state == .succeeded && $0.finishedAt != nil }), "truthful terminal lifecycle")
    try rejects("terminal success cannot flip or replay") { try snapshot.transition(nodeID: workers[0].id, to: .running, at: now.addingTimeInterval(5)) }
    try check(try ParallelAgentTask.Snapshot.decode(snapshot.encoded(), conversationID: conversation, submissionID: parent, requestSHA256: requestHash) == snapshot, "bound snapshot roundtrip")
    try rejects("foreign conversation") { _ = try snapshot.validated(conversationID: UUID()) }
    try rejects("foreign submission") { _ = try snapshot.validated(submissionID: UUID()) }
    try rejects("foreign request") { _ = try snapshot.validated(requestSHA256: String(repeating: "b", count: 64)) }

    var failedPlan = plan; failedPlan.workers[1].dependencies = [workers[0].id]; failedPlan.workers[2].dependencies = [workers[1].id]
    var failed = try ParallelAgentTask.Snapshot.fromPlan(failedPlan, createdAt: now)
    try failed.transition(nodeID: rootID, to: .running, at: now)
    try failed.transition(nodeID: plannerID, to: .running, at: now)
    try failed.transition(nodeID: plannerID, to: .succeeded, at: now)
    try check(try ParallelAgentTask.readyWorkerIDs(in: failed) == [workers[0].id], "DAG starts only dependency-ready worker")
    try failed.transition(nodeID: workers[0].id, to: .running, at: now)
    try failed.transition(nodeID: workers[0].id, to: .failed, at: now.addingTimeInterval(1))
    failed.blockFailedDependencies(at: now.addingTimeInterval(1))
    try check(failed.nodes.filter({ $0.role == .worker }).map(\.state) == [.failed, .blocked, .blocked], "failed dependency cascades blocked state")
    try check(failed.nodes.first(where: { $0.role == .primary })?.state == .blocked, "failed preparation blocks primary")
    try check(try ParallelAgentTask.readyWorkerIDs(in: failed).isEmpty, "blocked tasks never launch")
    var fallback = failed
    let fallbackID = UUID()
    fallback.nodes.append(.init(id: fallbackID, parentID: rootID, title: "Original-task fallback", role: .primary))
    try check(try fallback.validated().nodes.filter({ $0.role == .primary }).count == 2, "distinct fallback preserves blocked join")
    try fallback.transition(nodeID: fallbackID, to: .running, at: now.addingTimeInterval(1))
    try check(fallback.nodes.first(where: { $0.id == primaryID })?.state == .blocked, "fallback never launders failed-dependency join")
    var falseFallback = snapshot
    falseFallback.nodes.append(.init(parentID: rootID, title: "Unjustified duplicate", role: .primary))
    try rejects("second primary requires original blocked join") { _ = try falseFallback.validated() }
    var interrupted = try ParallelAgentTask.Snapshot.fromPlan(plan, createdAt: now)
    try interrupted.transition(nodeID: rootID, to: .running, at: now)
    try interrupted.transition(nodeID: plannerID, to: .running, at: now)
    interrupted.reconcileAfterRestart(at: now.addingTimeInterval(1))
    try check(interrupted.nodes.first(where: { $0.role == .coordinator })?.state == .interrupted && interrupted.nodes.first(where: { $0.role == .planner })?.state == .interrupted, "restart does not invent terminal success")
    try check(try ParallelAgentTask.readyWorkerIDs(in: interrupted).isEmpty, "restart cannot silently replay")
    var cancelled = try ParallelAgentTask.Snapshot.fromPlan(plan, createdAt: now)
    try cancelled.transition(nodeID: rootID, to: .cancelled, at: now)
    try check(try ParallelAgentTask.readyWorkerIDs(in: cancelled).isEmpty, "cancelled coordinator cannot dispatch")

    var invalid = snapshot; invalid.nodes[0].id = UUID()
    try rejects("wrong root identity") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes[2].parentID = workers[1].id
    try rejects("parent relation cannot become dependency relation") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes[2].dependencies = [workers[1].id]; invalid.nodes[3].dependencies = [workers[0].id]
    try rejects("public dependency cycle") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes.append(snapshot.nodes[0])
    try rejects("duplicate node id") { _ = try invalid.validated() }
    invalid = snapshot; invalid.schema = 2
    try rejects("unknown schema") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes[2].workerSubmissionID = parent
    try rejects("worker cannot reuse root submission") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes[2].workerSubmissionID = UUID(); invalid.nodes[3].workerSubmissionID = invalid.nodes[2].workerSubmissionID
    try rejects("workers cannot share submission custody") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes[2].nativeSessionID = "not-a-uuid"
    try rejects("invalid native session") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes[2].resultSummary = String(repeating: "a", count: 1_001)
    try rejects("summary read budget") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes[2].dependencies = [workers[1].id]; invalid.nodes[3].state = .failed
    try rejects("running/succeeded node cannot depend on failed state") { _ = try invalid.validated() }
    invalid = snapshot; invalid.nodes[2].title = "token=\"fixture-private-credential\""
    let redacted = try invalid.validated()
    try check(!String(decoding: try redacted.encoded(), as: UTF8.self).contains("fixture-private-credential"), "public text redaction")
    var raw = try JSONSerialization.jsonObject(with: snapshot.encoded()) as! [String: Any]
    raw["instruction"] = "PRIVATE INPUT"
    try rejects("raw instruction cannot enter public schema") { _ = try ParallelAgentTask.Snapshot.decode(JSONSerialization.data(withJSONObject: raw)) }
    try rejects("encoded byte budget") { _ = try ParallelAgentTask.Snapshot.decode(Data(repeating: 32, count: ParallelAgentTask.maximumSnapshotBytes + 1)) }

    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("os1-agent-task-fixture-" + UUID().uuidString).resolvingSymlinksInPath()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: directory) }
    let file = directory.appendingPathComponent(parent.uuidString.lowercased() + ".json")
    try check(try ParallelAgentTask.loadBound(path: file.path, conversationID: conversation, submissionID: parent) == nil, "missing graph remains missing")
    try ParallelAgentTask.saveBound(snapshot, path: file.path)
    try check(try ParallelAgentTask.loadBound(path: file.path, conversationID: conversation, submissionID: parent, requestSHA256: requestHash) == snapshot, "private bounded store/readback")
    try rejects("store foreign parent") { _ = try ParallelAgentTask.loadBound(path: file.path, conversationID: conversation, submissionID: UUID()) }
    let link = directory.appendingPathComponent("link.json")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
    try rejects("graph symlink read") { _ = try ParallelAgentTask.loadBound(path: link.path, conversationID: conversation, submissionID: parent) }
    try rejects("graph symlink overwrite") { try ParallelAgentTask.saveBound(snapshot, path: link.path) }
    let oversize = directory.appendingPathComponent("oversize.json")
    try Data(repeating: 32, count: ParallelAgentTask.maximumSnapshotBytes + 1).write(to: oversize)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: oversize.path)
    try rejects("file budget before decode") { _ = try ParallelAgentTask.loadBound(path: oversize.path, conversationID: conversation, submissionID: parent) }
    try rejects("parent traversal") { _ = try ParallelAgentTask.loadBound(path: directory.path + "/../" + file.lastPathComponent, conversationID: conversation, submissionID: parent) }
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
    try rejects("non-private file") { _ = try ParallelAgentTask.loadBound(path: file.path, conversationID: conversation, submissionID: parent) }
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)

    let activity = RuntimeActivity(.executing, timestamp: now, publicText: "Public progress", agentTask: snapshot)
    try check(try JSONDecoder().decode(RuntimeActivity.self, from: JSONEncoder().encode(activity)).agentTask == snapshot, "optional activity graph roundtrip")
    var legacy = try JSONSerialization.jsonObject(with: JSONEncoder().encode(activity)) as! [String: Any]
    legacy.removeValue(forKey: "agentTask")
    let decodedLegacy = try JSONDecoder().decode(RuntimeActivity.self, from: JSONSerialization.data(withJSONObject: legacy))
    try check(decodedLegacy.agentTask == nil && decodedLegacy.publicText == "Public progress", "legacy activity no graph remains valid")
    legacy["agentTask"] = ["schema": 999]
    let malformed = try JSONDecoder().decode(RuntimeActivity.self, from: JSONSerialization.data(withJSONObject: legacy))
    try check(malformed.agentTask == nil && malformed.publicText == "Public progress", "malformed optional graph does not suppress public prose")
    let keys = ["OS1_ACTIVITY_FILE", "OS1_AGENT_TASK_FILE", "OS1_CONVERSATION_ID", "OS1_SUBMISSION_ID", "OS1_EVENT_JOURNAL"]
    let environment = ProcessInfo.processInfo.environment
    defer { for key in keys { if let old = environment[key] { setenv(key, old, 1) } else { unsetenv(key) } } }
    let activityFile = directory.appendingPathComponent("activity.json")
    setenv("OS1_ACTIVITY_FILE", activityFile.path, 1); setenv("OS1_AGENT_TASK_FILE", file.path, 1)
    setenv("OS1_CONVERSATION_ID", conversation.uuidString, 1); setenv("OS1_SUBMISSION_ID", parent.uuidString, 1)
    unsetenv("OS1_EVENT_JOURNAL")
    RuntimeActivity.emit(.executing, publicText: "Parent public activity")
    let parentActivity = try JSONDecoder().decode(RuntimeActivity.self, from: Data(contentsOf: activityFile))
    try check(parentActivity.agentTask?.submissionID == parent, "parent emit reads exact bound graph")
    setenv("OS1_SUBMISSION_ID", UUID().uuidString, 1)
    RuntimeActivity.emit(.executing, publicText: "Child public activity")
    let childActivity = try JSONDecoder().decode(RuntimeActivity.self, from: Data(contentsOf: activityFile))
    try check(childActivity.agentTask == nil && childActivity.publicText == "Child public activity", "child cannot inherit parent graph")
    unsetenv("OS1_AGENT_TASK_FILE")
    RuntimeActivity.emit(.executing, publicText: "No graph")
    let absentActivity = try JSONDecoder().decode(RuntimeActivity.self, from: Data(contentsOf: activityFile))
    try check(absentActivity.agentTask == nil, "absent graph path keeps fast path")
    print("OS-1 parallel agent task graph: \(checks) deterministic checks passed; provider calls 0; live stores untouched")
}
