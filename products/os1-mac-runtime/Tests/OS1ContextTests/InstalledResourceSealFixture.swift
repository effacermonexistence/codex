import Foundation
import OS1Context

func runInstalledResourceSealFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) {
        precondition(condition, "Installed resource seal: " + message); checks += 1
    }
    let app = URL(fileURLWithPath: "/offline-fixture/OS-1 CLODEX.app")
    var now: TimeInterval = 100
    var calls = 0
    func verify(elapsed: TimeInterval, status: Int32) throws {
        try InstalledResourceSeal.verify(app: app, uptime: { now }) { executable, arguments, budget in
            calls += 1
            check(executable == "/usr/bin/codesign", "official signature verifier retained")
            check(arguments == ["--verify", "--deep", "--strict", app.path], "strict/deep verification flags retained")
            check(budget == 60, "signature observer timeout is bounded independently at60seconds")
            now += elapsed; return status
        }
    }
    func rejected(_ expected: InstalledResourceSeal.Failure, _ body: () throws -> Void) throws {
        do { try body(); preconditionFailure("Invalid/expired resource seal accepted") }
        catch let failure as InstalledResourceSeal.Failure { check(failure == expected, "correct rejection state preserved") }
    }
    try verify(elapsed: 38.841, status: 0)
    check(calls == 1, "valid slow verification makes exactly one bounded observation")
    try verify(elapsed: 0.02, status: 0)
    try rejected(.rejected) { try verify(elapsed: 38.841, status: 1) }
    try rejected(.timeout) { try verify(elapsed: 60, status: 0) }
    try rejected(.timeout) { try verify(elapsed: 61, status: 0) }
    try rejected(.timeout) { try verify(elapsed: -1, status: 0) }
    now = .infinity
    let beforeInvalidClock = calls
    try rejected(.timeout) { try verify(elapsed: 0, status: 0) }
    check(calls == beforeInvalidClock, "invalid timing state did not invoke executor")
    check(InstalledResourceSeal.verificationTimeout == 60, "signature observer has finite60second ceiling")
    print("Installed resource seal fixtures: \(checks) checks PASS; slow valid signature accepted; invalid/expired signature rejected; simulated clock/executor only; subprocess/model/HOME access0")
}
