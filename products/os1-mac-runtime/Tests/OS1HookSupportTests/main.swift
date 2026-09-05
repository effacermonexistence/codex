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

do {
    try testExclusiveLease()
    try testCircuitBreaker()
    try testTimeoutHeadroom()
    print("OS1HookSupportTests: PASS (3 tests)")
} catch {
    fputs("OS1HookSupportTests: FAIL: \(error)\n", stderr)
    exit(1)
}
