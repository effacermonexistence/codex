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
    try expect(AutomaticFleetHookPolicy.minimumMemoryMiB == 2_048, "automatic fleet memory floor drifted")
    try expect(AutomaticFleetHookPolicy.cpuWeight == 50, "automatic fleet CPU weight drifted")
    try expect(
        AutomaticFleetHookPolicy.providerProfile(configuredProfile: nil, turnID: "turn-1") == "codex",
        "trusted compatibility hook did not identify a Codex turn"
    )
    try expect(
        AutomaticFleetHookPolicy.providerProfile(configuredProfile: nil, turnID: nil) == "claude",
        "trusted compatibility hook did not identify a Claude turn"
    )
}

func testProviderReadinessRequiresExecution() throws {
    try expect(
        !ProviderReadinessPolicy.canAdvertise(
            executableExists: true,
            exitCode: 1,
            observedOutput: "login required",
            expectedOutput: "READY"
        ),
        "binary presence incorrectly advertised a failed provider"
    )
    try expect(
        !ProviderReadinessPolicy.canAdvertise(
            executableExists: true,
            exitCode: 0,
            observedOutput: "wrong",
            expectedOutput: "READY"
        ),
        "unexpected provider output was accepted"
    )
    try expect(
        ProviderReadinessPolicy.canAdvertise(
            executableExists: true,
            exitCode: 0,
            observedOutput: "READY\n",
            expectedOutput: "READY"
        ),
        "successful exact provider probe was rejected"
    )
}

func testCodexExecJSONLParser() throws {
    let session = "01a07483-b424-7b81-a4a4-3a056c9bcf3e"
    let transcript = Data("""
    {"type":"thread.started","thread_id":"\(session)"}
    {"type":"turn.started"}
    {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"READY"}}
    {"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}
    """.utf8)
    let parsed = parseCodexExecJSONL(transcript)
    try expect(parsed?.threadID == session, "Codex exec thread identity was not parsed")
    try expect(parsed?.output == "READY", "Codex exec final answer was not parsed")
    try expect(parsed?.completed == true, "Codex exec completion was not verified")
    try expect(
        parseCodexExecJSONL(Data("{\"type\":\"thread.started\",\"thread_id\":\"\(session)\"}".utf8)) == nil,
        "incomplete Codex exec stream was accepted"
    )
}

func testCodexFleetArgumentsDoNotConflict() throws {
    let arguments = CodexFleetCLIArguments.execution(
        model: "gpt-5.6-luna",
        effort: "low",
        workspace: "/tmp/project",
        prompt: "task"
    )
    try expect(arguments.contains("--approve-for-me"), "Codex Fleet automatic review was not enabled")
    try expect(!arguments.contains("--sandbox"), "Codex Fleet passed mutually exclusive sandbox flags")
    try expect(arguments.contains("--ignore-user-config"), "Codex Fleet recursion isolation was not enabled")
}

do {
    try testExclusiveLease()
    try testCircuitBreaker()
    try testTimeoutHeadroom()
    try testAutomaticFleetExecutorBypass()
    try testProviderReadinessRequiresExecution()
    try testCodexExecJSONLParser()
    try testCodexFleetArgumentsDoNotConflict()
    print("OS1HookSupportTests: PASS (7 tests)")
} catch {
    fputs("OS1HookSupportTests: FAIL: \(error)\n", stderr)
    exit(1)
}
