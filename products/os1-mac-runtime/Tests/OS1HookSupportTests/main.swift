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

do {
    try testExclusiveLease()
    try testCircuitBreaker()
    try testTimeoutHeadroom()
    try testAutomaticFleetExecutorBypass()
    try testSettingsPreservation()
    print("OS1HookSupportTests: PASS (5 test groups)")
} catch {
    fputs("OS1HookSupportTests: FAIL: \(error)\n", stderr)
    exit(1)
}
