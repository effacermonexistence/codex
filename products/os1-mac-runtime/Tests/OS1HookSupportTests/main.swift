import Foundation
import OS1HookSupport

enum TestFailure: Error, CustomStringConvertible {
    case assertion(String)

    var description: String {
        switch self {
        case .assertion(let message): return message
        }
    }
}

func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    guard try condition() else { throw TestFailure.assertion(message) }
}

func temporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("os1-hook-tests-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

func testExclusiveLease() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let lockURL = directory.appendingPathComponent("hook.lock")

    var first = try ExclusiveHookLease.tryAcquire(at: lockURL)
    try expect(first != nil, "first hook did not acquire the lease")
    try expect(try ExclusiveHookLease.tryAcquire(at: lockURL) == nil, "concurrent hook acquired the lease")
    first = nil
    try expect(try ExclusiveHookLease.tryAcquire(at: lockURL) != nil, "lease was not released")
}

func testCircuitBreaker() throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let stateURL = directory.appendingPathComponent("circuit-open-until")
    let breaker = HookCircuitBreaker(stateURL: stateURL, cooldownSeconds: 60)
    let failureTime = Date(timeIntervalSince1970: 1_000)

    try expect(breaker.allowsAttempt(now: failureTime), "clean circuit did not allow an attempt")
    try breaker.recordFailure(now: failureTime)
    try expect(!breaker.allowsAttempt(now: Date(timeIntervalSince1970: 1_059)), "circuit ignored its cooldown")
    try expect(breaker.allowsAttempt(now: Date(timeIntervalSince1970: 1_060)), "circuit stayed open past its cooldown")
    try breaker.recordSuccess()
    try expect(breaker.allowsAttempt(now: Date(timeIntervalSince1970: 1_001)), "success did not close the circuit")
}

func testTimeoutHeadroom() throws {
    try expect(ClaudeEXOHookPolicy.operationTimeoutSeconds == 60, "EXO operation budget regressed")
    try expect(ClaudeEXOHookPolicy.commandTimeoutSeconds == 65, "prompt hook timeout is not encoded in seconds")
    try expect(
        Double(ClaudeEXOHookPolicy.commandTimeoutSeconds) - ClaudeEXOHookPolicy.operationTimeoutSeconds >= 5,
        "host process timeout does not leave five seconds of cleanup headroom"
    )
}

func testAutomaticFleetExecutorBypass() throws {
    try expect(
        AutomaticFleetHookPolicy.isExecutorWorkspace(
            cwd: "/Users/test/.os1/fleet/jobs/11111111-1111-4111-8111-111111111111/repository",
            homeDirectory: "/Users/test"
        ),
        "fleet executor checkout did not bypass recursive routing"
    )
    try expect(
        !AutomaticFleetHookPolicy.isExecutorWorkspace(
            cwd: "/Users/test/work/project",
            homeDirectory: "/Users/test"
        ),
        "ordinary workspace was mistaken for a fleet executor checkout"
    )
    try expect(
        AutomaticFleetHookPolicy.shouldBypass(
            cwd: "/Users/test/work/project",
            homeDirectory: "/Users/test",
            environment: [AutomaticFleetHookPolicy.internalProviderEnvironmentKey: "1"]
        ),
        "OS-1 internal provider execution did not bypass recursive routing"
    )
    try expect(
        !AutomaticFleetHookPolicy.shouldBypass(
            cwd: "/Users/test/work/project",
            homeDirectory: "/Users/test",
            environment: [:]
        ),
        "ordinary provider prompt unexpectedly bypassed automatic routing"
    )
    try expect(AutomaticFleetHookPolicy.minimumMemoryMiB == 2_048, "automatic fleet memory floor drifted")
    try expect(AutomaticFleetHookPolicy.cpuWeight == 50, "automatic fleet CPU weight drifted")
}

func testSettingsPreservation() throws {
    let other: [String: Any] = ["type": "command", "command": "unrelated-audit-hook"]
    let document: [String: Any] = ["preferences": ["retained": true], "hooks": [
        "Stop": [["hooks": [other]]],
        "UserPromptSubmit": [["matcher": "", "hooks": [other,
          ["command": "'/old/os1-fleet' exo-codex-hook", "type": "command"]]]]
    ]]
    let replacement: [String: Any] = ["command": "'/new/os1' exo-codex-hook", "type": "command", "timeout": 65]
    let merged = try HookSettings.merging(document, command: "exo-codex-hook", replacement: replacement)
    let again = try HookSettings.merging(merged, command: "exo-codex-hook", replacement: replacement)
    try expect(try JSONSerialization.data(withJSONObject: merged, options: [.sortedKeys]) ==
        JSONSerialization.data(withJSONObject: again, options: [.sortedKeys]), "hook install is not idempotent")
    let hooks = merged["hooks"] as! [String: Any]
    let entries = hooks["UserPromptSubmit"] as! [[String: Any]]
    try expect(entries.count == 2, "unrelated sibling hook was dropped")
    try expect((entries[0]["hooks"] as? [[String: Any]])?.first?["command"] as? String == "unrelated-audit-hook", "sibling command changed")
    try expect(hooks["Stop"] != nil && merged["preferences"] != nil, "unrelated settings were dropped")
    do {
        _ = try HookSettings.merging(["hooks": ["UserPromptSubmit": "malformed"]], command: "exo-codex-hook", replacement: replacement)
        throw TestFailure.assertion("malformed settings were overwritten")
    } catch HookSettingsError.invalid { }
}

func testFirstPromptIdentity() throws {
    let root = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    let transcript = root.appendingPathComponent("first.jsonl")
    let initial = PromptEventIdentity.claudeTranscript(path: transcript.path, projectsRoot: root)
    try expect(initial?.hasSuffix(":initial") == true, "first native prompt has no stable identity")
    try expect(initial == PromptEventIdentity.claudeTranscript(path: transcript.path, projectsRoot: root), "first prompt retry identity drifted")
    try Data("first user turn\n".utf8).write(to: transcript)
    let next = PromptEventIdentity.claudeTranscript(path: transcript.path, projectsRoot: root)
    try expect(next != nil && next != initial, "later prompt reused first event identity")
    try expect(next == PromptEventIdentity.claudeTranscript(path: transcript.path, projectsRoot: root), "transcript position is not stable")
    try expect(PromptEventIdentity.claudeTranscript(path: root.deletingLastPathComponent().appendingPathComponent("outside.jsonl").path, projectsRoot: root) == nil, "outside transcript accepted")
    try expect(PromptEventIdentity.claudeTranscript(path: root.path, projectsRoot: root) == nil, "directory accepted as transcript")
    let link = root.appendingPathComponent("escape.jsonl")
    try FileManager.default.createSymbolicLink(atPath: link.path, withDestinationPath: "/private/tmp/escaped.jsonl")
    try expect(PromptEventIdentity.claudeTranscript(path: link.path, projectsRoot: root) == nil, "symlink escape accepted")
}

func testPromptIntentPolicy() throws {
    // Exact text that the Claude Code harness passed through the prompt channel
    // on 2026-09-06 and that OS1 dispatched as Fleet job 3d1eeb4f (failed:
    // "Fleet revision fetch failed"). It must never be dispatched again.
    let harness = """
    <task-notification>
    <task-id>b8okh0shh</task-id>
    <status>failed</status>
    <summary>Background command "Retry the SwiftPM build" failed with exit code 1</summary>
    </task-notification>
    """
    try expect(PromptIntentPolicy.decision(for: harness) == .harnessGenerated, "task-notification block was treated as a user request")
    for block in ["<system-reminder>\nx\n</system-reminder>", "<command-message>foo</command-message>\n<command-name>foo</command-name>",
                  "<<autonomous-loop-dynamic>>", "[SYSTEM NOTIFICATION - NOT USER INPUT]\nsomething", "<ci-monitor-event>x</ci-monitor-event>"] {
        try expect(PromptIntentPolicy.decision(for: block) == .harnessGenerated, "harness block dispatched: \(block.prefix(24))")
    }
    for phrase in ["계속 진행해", "계속해줘", "  continue  ", "ok", "네", "go on", "다시 해봐", "Proceed."] {
        try expect(PromptIntentPolicy.decision(for: phrase) == .notStandalone, "continuation phrase dispatched: \(phrase)")
    }
    for deictic in ["그거 설명해 봐 조금 더 자세히 부탁해", "이거 고쳐줘 아까 말한 대로 진행하면 돼", "that one, explain it again in more detail please"] {
        try expect(PromptIntentPolicy.decision(for: deictic) == .notStandalone, "context-dependent prompt dispatched: \(deictic)")
    }
    try expect(PromptIntentPolicy.decision(for: "1 플러스 1") == .notStandalone, "tiny prompt dispatched as a remote job")
    for task in ["R2에서 QMGR 통합 연구 자료를 가져와서 OPT benchmark와 매핑해 줘",
                 "products/os1-mac-runtime 에서 swift build 를 실행하고 실패한 테스트를 고쳐라",
                 "Read-only cross-Mac Fleet check. Do not modify files or use tools. Reply with exactly AIR_OK",
                 "이 저장소의 products/os1-route-core 라우팅 코드를 검토해서 정적 티어 규칙을 찾아 보고서를 써 줘"] {
        try expect(PromptIntentPolicy.decision(for: task) == .dispatch, "standalone task blocked: \(task.prefix(30))")
    }
    // A long prompt that merely contains the word "this" in the middle is fine.
    try expect(PromptIntentPolicy.decision(for: "Audit the Fleet agent retry loop in Sources/OS1/Fleet.swift and explain why this loop repeats") == .dispatch,
        "mid-sentence deictic word blocked a standalone task")
}

func testEXODraftPolicy() throws {
    // Verbatim low-value drafts injected on 2026-09-06.
    try expect(!EXODraftPolicy.isUseful("안녕하세요! 감사합니다. 이 질문에 답변해 드릴 수 있습니다."), "greeting-only draft accepted")
    try expect(!EXODraftPolicy.isUseful("네, 코덱스한테 안줘도 되겠다는 말이 니가 해라 니가 해라 니가 고쳐 왜냐면"), "echo draft under the minimum accepted")
    try expect(!EXODraftPolicy.isUseful(""), "empty draft accepted")
    try expect(!EXODraftPolicy.isUseful("I'm sorry, as an AI I cannot help with that request at this time."), "refusal boilerplate accepted")
    let substantive = """
    The failing step is fleetWorkspaceIdentity: it validates a GitHub origin but never checks that HEAD exists on origin, \
    so a local-only commit is dispatched and the executor's `git fetch origin <sha>` fails. Add a for-each-ref --contains guard.
    """
    try expect(EXODraftPolicy.isUseful(substantive), "substantive draft rejected")
}

private enum MaintenanceFixtureError: Error { case transient }

private actor MaintenanceProbe {
    var heartbeats = 0
    var mirrors = 0
    var activeMirrors = 0
    var maximumActiveMirrors = 0

    func heartbeat() -> Int { heartbeats += 1; return heartbeats }
    func startMirror() -> Int {
        mirrors += 1
        activeMirrors += 1
        maximumActiveMirrors = max(maximumActiveMirrors, activeMirrors)
        return mirrors
    }
    func finishMirror() { activeMirrors -= 1 }
    func snapshot() -> (Int, Int, Int, Int) {
        (heartbeats, mirrors, activeMirrors, maximumActiveMirrors)
    }
}

func testFleetMaintenanceIsolation() async throws {
    let probe = MaintenanceProbe()
    let task = Task {
        await FleetMaintenance.run(
            heartbeatInterval: .milliseconds(10), mirrorInterval: .milliseconds(10),
            heartbeat: {
                if await probe.heartbeat() == 1 { throw MaintenanceFixtureError.transient }
            },
            mirror: {
                let attempt = await probe.startMirror()
                do {
                    if attempt == 1 { throw MaintenanceFixtureError.transient }
                    // Simulate a slow status batch while the heartbeat continues.
                    try await Task.sleep(for: .seconds(2))
                    await probe.finishMirror()
                } catch {
                    await probe.finishMirror()
                    throw error
                }
            }
        )
    }
    defer { task.cancel() }
    let deadline = ContinuousClock.now.advanced(by: .seconds(1))
    while ContinuousClock.now < deadline {
        let state = await probe.snapshot()
        if state.0 >= 8 && state.1 == 2 && state.2 == 1 { break }
        try await Task.sleep(for: .milliseconds(5))
    }
    let during = await probe.snapshot()
    try expect(during.0 >= 8, "slow result mirror starved the heartbeat or heartbeat error stopped retries")
    try expect(during.1 == 2 && during.2 == 1, "mirror did not recover independently from its first failure")
    try expect(during.3 == 1, "result mirror batches overlapped")
    task.cancel()
    await task.value
    let stopped = await probe.snapshot()
    try expect(stopped.2 == 0, "cancellation did not drain the active mirror")
    try await Task.sleep(for: .milliseconds(40))
    let later = await probe.snapshot()
    try expect(later.0 == stopped.0 && later.1 == stopped.1, "maintenance outlived its owner cancellation")
}

func testShellCapabilityIntent() throws {
    for prompt in [
        "Read the existing private temporary test evidence. Do not execute the diagnostic again.",
        "Read the build results and report test markers. Never run commands.",
        "Describe the install log and the previous run output.",
        "Read the saved test artifacts. Do not run commands or modify files.",
    ] {
        try expect(!ShellCapabilityIntent.hasEnglishImperative(ShellCapabilityIntent.classificationText(prompt)),
                   "artifact noun/prohibition mistaken for shell imperative: \(prompt)")
    }
    for prompt in ["Run the tests.", "Test the application.", "Please build the project.",
                   "Read manifest.json and then run tests.", "Could you execute the script?",
                   "Do not deploy, but run tests.", "Do not install tools. Build the application.",
                   "Never change settings; run the tests.", "I need you to install the dependency.",
                   "Never mind, run the tests.", "Do not forget to run tests."] {
        try expect(ShellCapabilityIntent.hasEnglishImperative(ShellCapabilityIntent.classificationText(prompt)),
                   "positive execution clause was removed: \(prompt)")
    }
    let source = "Read manifest.json. Do not run Bash or shell commands."
    let classified = ShellCapabilityIntent.classificationText(source)
    try expect(!classified.contains("bash") && !classified.contains("shell"), "prohibited tool names retained")
    try expect(source.contains("Do not run Bash"), "classification mutated source")
}

do {
    try testExclusiveLease()
    try testCircuitBreaker()
    try testTimeoutHeadroom()
    try testAutomaticFleetExecutorBypass()
    try testSettingsPreservation()
    try testFirstPromptIdentity()
    try testPromptIntentPolicy()
    try testEXODraftPolicy()
    try await testFleetMaintenanceIsolation()
    try testShellCapabilityIntent()
    print("OS1HookSupportTests: PASS (10 test groups)")
} catch {
    fputs("OS1HookSupportTests: FAIL: \(error)\n", stderr)
    exit(1)
}
