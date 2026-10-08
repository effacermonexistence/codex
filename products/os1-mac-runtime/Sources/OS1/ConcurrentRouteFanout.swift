import Foundation
import Darwin
import OS1Context
import OS1System

/// Only deterministic fixtures can replace this transport. No CLI/env flag
/// may select it; production still runs the signed native executor contract.
struct ConcurrentRouteFanoutFixtureHooks: Sendable {
    let root: URL
    let executable: URL
    let arguments: @Sendable (Int, RouteFanout.Target, URL) -> [String]
}

enum ConcurrentRouteFanoutRuntime {
    @TaskLocal static var fixtureHooks: ConcurrentRouteFanoutFixtureHooks?
    @TaskLocal static var child = false
    @TaskLocal static var expectedSurface: ProviderSurface?

    static func childArguments(target: RouteFanout.Target, workspace: String) -> [String] {
        ["run", "--workspace", workspace, "--prompt", target.payload,
         "--provider", target.surface.rawValue, "--codex-capacity", "100", "--claude-capacity", "100",
         "--output-format", "json", "--desktop-reveal", "never", "--parallel-fanout-child"]
    }
}

private func verifiedFanoutAnswer(_ result: ParallelChildResult, target: RouteFanout.Target) throws -> (RunSummary, RunStepSummary) {
    guard result.launched, !result.cancelled, result.status == 0 else {
        throw OS1Error.message(result.failure ?? "Provider fan-out child cancelled or failed")
    }
    let summary = try JSONDecoder().decode(RunSummary.self, from: result.data)
    guard summary.status == "complete", let step = summary.steps.last(where: { $0.revasDisposition == "adopted" }),
          step.exitCode == 0, step.permissionProfile == "read_only", UUID(uuidString: step.sessionID) != nil,
          step.provider == target.surface.gatewayPreference,
          ProviderSurface.resolveExecuted(rawSurface: step.surface, provider: step.provider) == target.surface,
          let native = step.nativeRecord, native.isVerified, let path = native.recordPath,
          let attrs = try? FileManager.default.attributesOfItem(atPath: path),
          attrs[.type] as? FileAttributeType == .typeRegular else {
        throw OS1Error.message("The requested surface has no matching verified read-only native result")
    }
    return (summary, step)
}

/// Explicit answer-only routing has no planner and never inherits a writer or
/// resumes the parent native conversation. Every surface gets one process,
/// private I/O/activity/cancel files, and a fresh native session. Concurrency
/// cannot share the runtime's mutable provider/lane globals.
func runConcurrentRouteFanout(_ plan: RouteFanout, originalPrompt: String, workspace: String,
                             context: String?, progress: Bool, desktopReveal: DesktopRevealMode) async throws -> RunSummary {
    let environment = ProcessInfo.processInfo.environment
    guard let conversationID = environment["OS1_CONVERSATION_ID"].flatMap(UUID.init(uuidString:)),
          let submissionID = environment["OS1_SUBMISSION_ID"].flatMap(UUID.init(uuidString:)),
          plan.targets.count >= 2, plan.targets.count <= RouteFanout.maximumTargets,
          RouteFanout.plan(originalPrompt) == plan else { throw ParallelAgentTask.Failure.bindingMismatch }
    // Inputs are self-contained by the parser. Unrelated history is not sent
    // merely because this parent conversation has a context file.
    _ = context; _ = progress; _ = desktopReveal
    let signalCancellation = ParallelSignalCancellation(submissionID: submissionID)
    defer { withExtendedLifetime(signalCancellation) {} }
    let fm = FileManager.default, hooks = ConcurrentRouteFanoutRuntime.fixtureHooks
    let root = hooks?.root ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/agent-tasks", isDirectory: true)
    try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let graphPath = root.appendingPathComponent(submissionID.uuidString + ".json").path
    let lock = Darwin.open(root.appendingPathComponent(submissionID.uuidString + ".lock").path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, 0o600)
    guard lock >= 0 else { throw ParallelAgentTask.Failure.unsafePath }
    defer { _ = os1_flock(lock, LOCK_UN); Darwin.close(lock) }
    var info = stat()
    guard fstat(lock, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_uid == getuid(),
          info.st_nlink == 1, (info.st_mode & 0o077) == 0, os1_flock(lock, LOCK_EX | LOCK_NB) == 0 else {
        throw OS1Error.message("This provider fan-out submission is already owned; no duplicate dispatch started.")
    }
    let started = Date(), planID = UUID(), rootID = UUID(), ids = plan.targets.map { _ in UUID() }
    let privateRoot = root.appendingPathComponent(submissionID.uuidString + "-private", isDirectory: true)
    try fm.createDirectory(at: privateRoot, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let custody = privateRoot.appendingPathComponent(planID.uuidString, isDirectory: true)
    try fm.createDirectory(at: custody, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    if let prior = try ParallelAgentTask.loadBound(path: graphPath, conversationID: conversationID, submissionID: submissionID) {
        try ParallelAgentTask.saveBound(prior, path: custody.appendingPathComponent("previous-public-snapshot.json").path)
    }
    let requestSHA = sha256Hex(Data(originalPrompt.utf8))
    try Data(originalPrompt.utf8).write(to: custody.appendingPathComponent("original-request.txt"), options: .withoutOverwriting)
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: custody.appendingPathComponent("original-request.txt").path)
    let snapshot = ParallelAgentTask.Snapshot(planID: planID, conversationID: conversationID, submissionID: submissionID,
        requestSHA256: requestSHA, rootNodeID: rootID, objective: ParallelAgentTask.publicText(originalPrompt, maximum: 500) ?? "Provider fan-out",
        createdAt: started, updatedAt: started, maxParallelism: plan.targets.count,
        nodes: [.init(id: rootID, title: "Explicit parallel provider request", role: .coordinator)] +
            zip(ids, plan.targets).map { id, target in .init(id: id, parentID: rootID,
                title: target.surface.routeTitle, role: .worker, scope: .readOnly, workspace: workspace) })
    let graph = ParallelGraphJournal(snapshot: snapshot, path: graphPath)
    let previousGraph = environment["OS1_AGENT_TASK_FILE"]
    setenv("OS1_AGENT_TASK_FILE", graphPath, 1)
    defer { if let previousGraph { setenv("OS1_AGENT_TASK_FILE", previousGraph, 1) } else { unsetenv("OS1_AGENT_TASK_FILE") } }
    try await graph.start(rootID)
    let executable = hooks?.executable ?? (Bundle.main.executableURL ?? URL(fileURLWithPath: CommandLine.arguments[0])).resolvingSymlinksInPath()
    let cancellation: @Sendable () -> Bool = { signalCancellation.requested || ExecutionCancellation.isCancelled }
    var outcomes: [RouteFanoutOutcome] = [], captured: [Int: [RunStepSummary]] = [:]
    await withTaskGroup(of: (Int, ParallelChildResult).self) { group in
        for index in plan.targets.indices {
            let target = plan.targets[index], id = ids[index], directory = custody.appendingPathComponent("target-\(index + 1)", isDirectory: true)
            let arguments = hooks?.arguments(index, target, directory) ?? ConcurrentRouteFanoutRuntime.childArguments(target: target, workspace: workspace)
            group.addTask {
                let result = await executeParallelChild(id: id, executable: executable, arguments: arguments, workspace: workspace,
                    directory: directory, cancellation: cancellation, observed: { workerSubmission, activity in
                        try? await graph.observe(id, submission: workerSubmission, activity: activity)
                    })
                return (index, result)
            }
        }
        for await (index, result) in group {
            let target = plan.targets[index]
            var outcome = RouteFanoutOutcome(index: index, target: target, executionIndex: index + 1)
            if let decoded = try? JSONDecoder().decode(RunSummary.self, from: result.data) {
                outcome.attempts = decoded.steps.map(routeFanoutAttemptEvidence)
                captured[index] = decoded.steps
            }
            if result.cancelled || cancellation() {
                outcome.failure = "Cancelled; this target is not a completed result."
                try? await graph.finish(ids[index], state: .cancelled, failure: outcome.failure)
            } else if target.surface == .chatgpt {
                let handedOff = (try? JSONDecoder().decode(RunSummary.self, from: result.data))?.status == "handoff" && result.status == 0
                outcome.failure = handedOff ? "Sent to external ChatGPT handoff; answer is unobserved." : "External ChatGPT handoff failed; no observed answer."
                try? await graph.describe(ids[index], surface: "chatgpt", resultSummary: "Handoff only; external answer is unobserved.")
                try? await graph.finish(ids[index], state: .blocked, failure: outcome.failure)
            } else {
                do {
                    let (_, step) = try verifiedFanoutAnswer(result, target: target)
                    outcome.adopted = step
                    try await graph.finish(ids[index], state: .succeeded, step: step)
                    // The parent already verified the exact native surface,
                    // custody and adoption. Inspector details expose only a
                    // bounded/redacted excerpt of that returned public answer,
                    // never an expected answer reconstructed from the request.
                    try await graph.describe(ids[index], resultSummary: step.output)
                } catch {
                    outcome.failure = "No matching verified answer for the requested surface."
                    try? await graph.finish(ids[index], state: .failed, failure: outcome.failure)
                }
            }
            outcomes.append(outcome)
        }
    }
    outcomes.sort { $0.index < $1.index }
    let allAnswered = outcomes.count == plan.targets.count && outcomes.allSatisfy { $0.adopted != nil && $0.failure == nil }
    try await graph.finish(rootID, state: cancellation() ? .cancelled : (allAnswered ? .succeeded : .failed),
                           failure: allAnswered ? nil : "One or more requested surfaces have no verified answer.")
    let output = routeFanoutSummary(plan: plan, outcomes: outcomes)
    let operationID = UUID().uuidString.lowercased(), receiptURL = custody.appendingPathComponent("fanout-receipt.json")
    let routeEvidence = outcomes.map(routeFanoutRouteEvidence)
    let receipt = RouteFanoutRecord(operationID: operationID, operation: "concurrent_route_fanout",
        checkedAt: ISO8601DateFormatter().string(from: Date()), modelInvoked: RouteFanoutRecord.observedNativeInvocation(in: routeEvidence), frame: plan.frame,
        resultSHA256: sha256Hex(Data(output.utf8)), routes: routeEvidence)
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    let bytes = try encoder.encode(receipt)
    try bytes.write(to: receiptURL, options: .withoutOverwriting)
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptURL.path)
    guard try Data(contentsOf: receiptURL) == bytes else { throw OS1Error.message("Parallel routing receipt readback failed") }
    var steps = plan.targets.indices.flatMap { captured[$0] ?? [] }
    for index in steps.indices { steps[index].workflowStage = "parallel route" }
    steps.append(RunStepSummary(sequence: steps.count + 1, provider: "local", action: "route_fanout", model: "os1-control", effort: "none",
        revasDisposition: "control_verified", sessionID: operationID, permissionProfile: "local_control", exitCode: 0,
        output: output, stderr: "", durationMS: Int64(Date().timeIntervalSince(started) * 1_000),
        nativeRecord: NativeRecordEvidence(turnID: operationID, recordPath: receiptURL.path, persistence: "verified", desktopVisibility: "control_only")))
    return RunSummary(status: cancellation() ? "cancelled" : (allAnswered ? "complete" : "partial"), steps: steps, agentTask: await graph.read())
}

/// Production scheduler and process custody with a deterministic fake child:
/// no vendor calls, auth probes, installations, or live session-store writes.
func concurrentRouteFanoutSelfTest() async throws {
    let fm = FileManager.default
    let folder = fm.temporaryDirectory.appendingPathComponent("os1-concurrent-fanout-" + UUID().uuidString, isDirectory: true)
    try fm.createDirectory(at: folder, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: folder) }
    let script = folder.appendingPathComponent("child.py")
    let source = #"""
    import os,sys,time,json,uuid,hashlib
    directory,index,surface,mode,barrier=sys.argv[1:]
    os.setpgid(0,0)
    submission=os.environ['OS1_SUBMISSION_ID']
    ready={'submissionID':submission,'pid':os.getpid(),'pgid':os.getpgrp(),'binarySHA256':hashlib.sha256(open('/usr/bin/python3','rb').read()).hexdigest()}
    open(os.environ['OS1_AGENT_CHILD_READY_FILE'],'w').write(json.dumps(ready))
    open(os.path.join(barrier,index+'.started'),'w').write(str(time.time()))
    deadline=time.time()+5
    while len([p for p in os.listdir(barrier) if p.endswith('.started')])<4 and time.time()<deadline: time.sleep(.01)
    if mode=='cancel':
      while not os.path.exists(os.environ['OS1_CANCEL_FILE']) and time.time()<deadline: time.sleep(.01)
      sys.exit(130)
    time.sleep((4-int(index))*.04)
    native=str(uuid.uuid4()); record=os.path.join(directory,'native.json')
    open(record,'w').write(json.dumps({'session':native,'surface':surface,'submission':submission}));os.chmod(record,0o600)
    provider='codex' if surface in ['codex','gpt-chat'] else 'claude'
    step={'sequence':1,'provider':provider,'action':'fixture_read','model':'fixture-'+surface,'effort':'none','revas_disposition':'adopted',
      'session_id':native,'permission_profile':'read_only','exit_code':0,'output':index+' result','stderr':'','duration_ms':100,'surface':surface,
      'native_record':{'turn_id':str(uuid.uuid4()) if provider=='codex' else None,'record_path':record,'persistence':'verified','desktop_visibility':'not_revealed'}}
    if mode=='native_rejected': step['revas_disposition']='rejected'
    if mode=='no_native': step['revas_disposition']='rejected';step['native_record']=None
    if mode=='bounded_answer': step['output']='public answer ghp_'+('s'*40)+' '+('x'*2500)
    open(os.path.join(barrier,index+'.finished'),'w').write(str(time.time()))
    print(json.dumps({'status':'partial' if mode in ['native_rejected','no_native'] else 'complete','steps':[step]}))
    """#
    try Data(source.utf8).write(to: script)
    let keys = ["OS1_SUBMISSION_ID", "OS1_CONVERSATION_ID", "OS1_CANCEL_FILE", "OS1_ACTIVITY_FILE", "OS1_EVENT_JOURNAL", "OS1_AGENT_TASK_FILE"]
    let old = ProcessInfo.processInfo.environment
    defer { for key in keys { if let value = old[key] { setenv(key, value, 1) } else { unsetenv(key) } } }
    let prompt = "GPT랑 코덱스랑 클로드 코드랑 클로드 병렬로 1+1, 2+2 돌려봐"
    guard let plan = RouteFanout.plan(prompt) else { throw OS1Error.message("Concurrent fanout fixture parse failed") }
    var count = 0
    func check(_ value: Bool, _ reason: String) throws {
        guard value else { throw OS1Error.message("Concurrent route fanout: " + reason) }; count += 1
    }
    let args = ConcurrentRouteFanoutRuntime.childArguments(target: plan.targets[0], workspace: folder.path)
    try check(args.contains("--parallel-fanout-child") && !args.contains("--codex-session-id") && !args.contains("--claude-session-id"), "fresh subprocess has recursion guard and no resume")
    func run(_ mode: String) async throws -> (RunSummary, UUID, UUID, URL) {
        let root = folder.appendingPathComponent(mode, isDirectory: true)
        let barrier = root.appendingPathComponent("barrier", isDirectory: true)
        try fm.createDirectory(at: barrier, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let submission = UUID(), conversation = UUID(), cancel = root.appendingPathComponent("parent.cancel")
        setenv("OS1_SUBMISSION_ID", submission.uuidString, 1); setenv("OS1_CONVERSATION_ID", conversation.uuidString, 1)
        setenv("OS1_CANCEL_FILE", cancel.path, 1)
        setenv("OS1_ACTIVITY_FILE", root.appendingPathComponent("activity.json").path, 1)
        setenv("OS1_EVENT_JOURNAL", root.appendingPathComponent("events.jsonl").path, 1)
        let hooks = ConcurrentRouteFanoutFixtureHooks(root: root.appendingPathComponent("graphs"), executable: URL(fileURLWithPath: "/usr/bin/python3"),
            arguments: { index, target, directory in [script.path, directory.path, String(index), target.surface.rawValue, mode, barrier.path] })
        let canceller: Task<Void, Never>? = mode == "cancel" ? Task {
            let deadline = Date().addingTimeInterval(6)
            while (try? FileManager.default.contentsOfDirectory(atPath: barrier.path).filter { $0.hasSuffix(".started") }.count) != 4 && Date() < deadline {
                try? await Task.sleep(nanoseconds: 20_000_000)
            }
            try? Data("cancel\n".utf8).write(to: cancel)
        } : nil
        defer { canceller?.cancel() }
        let result = try await ConcurrentRouteFanoutRuntime.$fixtureHooks.withValue(hooks) {
            try await runConcurrentRouteFanout(plan, originalPrompt: prompt, workspace: folder.path, context: "unrelated context is never sent",
                                               progress: false, desktopReveal: .never)
        }
        return (result, submission, conversation, root)
    }
    let (success, submission, conversation, successRoot) = try await run("success")
    guard let graph = success.agentTask else { throw OS1Error.message("Concurrent route graph missing") }
    try check(success.status == "complete", "four verified exact surfaces complete")
    try check(graph.conversationID == conversation && graph.submissionID == submission && graph.requestSHA256 == sha256Hex(Data(prompt.utf8)), "graph bound to actual parent identities and exact request")
    let workers = graph.nodes.filter { $0.role == .worker }
    try check(workers.count == 4 && workers.allSatisfy { $0.state == .succeeded }, "all real dispatched child nodes terminal")
    try check(Set(workers.compactMap(\.workerSubmissionID)).count == 4 && Set(workers.compactMap(\.nativeSessionID)).count == 4, "no child/native identity reuse")
    try check(workers.compactMap(\.surface) == plan.targets.map { $0.surface.rawValue }, "actual surfaces retained in stable target order")
    try check(workers.map(\.resultSummary) == ["0 result", "1 result", "2 result", "3 result"], "clickable child graph preserves actual verified answers instead of generic custody captions")
    func receiptModelInvoked(_ root: URL) throws -> Bool {
        guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else { throw OS1Error.message("Fanout receipt enumeration failed") }
        let receipts = files.compactMap { $0 as? URL }.filter { $0.lastPathComponent == "fanout-receipt.json" }
        guard receipts.count == 1 else { throw OS1Error.message("Fanout receipt custody not unique") }
        return try JSONDecoder().decode(RouteFanoutRecord.self, from: Data(contentsOf: receipts[0])).modelInvoked
    }
    try check(try receiptModelInvoked(successRoot), "verified Codex and genuine Claude nil-turn transcripts prove model invocation")

    try check(success.steps.filter { $0.provider != "local" }.map(\.output) == ["0 result", "1 result", "2 result", "3 result"], "completion order cannot reorder requested results")
    let barrier = successRoot.appendingPathComponent("barrier")
    let starts = try (0..<4).map { Double(try String(contentsOf: barrier.appendingPathComponent("\($0).started"), encoding: .utf8))! }
    let finishes = try (0..<4).map { Double(try String(contentsOf: barrier.appendingPathComponent("\($0).finished"), encoding: .utf8))! }
    try check(starts.max()! < finishes.min()!, "four child processes actually overlap")
    let path = successRoot.appendingPathComponent("graphs/" + submission.uuidString + ".json").path
    try check(try ParallelAgentTask.loadBound(path: path, conversationID: conversation, submissionID: submission, requestSHA256: graph.requestSHA256) == graph, "persisted graph exact readback")
    try check((try? ParallelAgentTask.loadBound(path: path, conversationID: UUID(), submissionID: submission)) == nil, "foreign conversation cannot adopt graph")
    let (rejectedNative, _, _, rejectedRoot) = try await run("native_rejected")
    try check(rejectedNative.status == "partial" && rejectedNative.agentTask?.nodes.filter { $0.role == .worker }.allSatisfy { $0.state == .failed } == true,
              "returned rejected native answers do not become succeeded graph nodes")
    try check(try receiptModelInvoked(rejectedRoot), "all-rejected but verified native attempts still count invocation")
    let (noNative, _, _, noNativeRoot) = try await run("no_native")
    let noNativeObserved = try receiptModelInvoked(noNativeRoot)
    try check(noNative.status == "partial" && !noNativeObserved, "launched processes and session IDs without native proof never imply model invocation")
    let (boundedAnswer, _, _, _) = try await run("bounded_answer")
    let excerpts = boundedAnswer.agentTask?.nodes.filter { $0.role == .worker }.compactMap(\.resultSummary) ?? []
    try check(excerpts.count == 4 && excerpts.allSatisfy { $0.count <= 1_000 && $0.hasPrefix("public answer") }, "public result excerpts remain bounded through existing graph redaction")
    try check(excerpts.allSatisfy { !$0.contains("ghp_" + String(repeating: "s", count: 40)) }, "existing public redaction removes token-like content from child result details")
    let (cancelled, _, _, _) = try await run("cancel")
    try check(cancelled.status == "cancelled" && cancelled.agentTask?.nodes.allSatisfy(\.state.isTerminal) == true,
              "cancellation drains every owned process and graph node")
    print("Concurrent route fan-out: \(count) checks passed")
}
