import Foundation
import OS1Context

func runRunAdmissionFixtures() throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) {
        precondition(condition, "Run admission: " + message); checks += 1
    }
    let limits: [Int?] = [nil, 1, 4, 64]
    for limit in limits {
        let label = limit.map(String.init) ?? "unlimited"
        let boundary = limit ?? 128
        let below = RunAdmission.decide(limit: limit, activeRuns: boundary - 1, memoryPressure: .normal)
        check(below.admitted && below.reason == nil, "\(label) admits below its ceiling")
        let full = RunAdmission.decide(limit: limit, activeRuns: boundary, memoryPressure: .normal)
        check(full.admitted == (limit == nil), "\(label) boundary decision")
        check(full.reason == (limit == nil ? nil : .slotLimit), "\(label) boundary reason")
        let waiter = RunAdmission.decide(limit: limit, activeRuns: boundary + 1,
            waitingForSourceRuns: 2, memoryPressure: .normal)
        check(waiter.admitted && waiter.occupiedCount == boundary - 1,
            "\(label) excludes source-lease waiters, freeing a slot for another conversation")
        for pressure: RunAdmission.MemoryPressure in [.warning, .critical] {
            for active in [0, boundary, boundary + 8] {
                let decision = RunAdmission.decide(limit: limit, activeRuns: active,
                    waitingForSourceRuns: active, memoryPressure: pressure)
                check(!decision.admitted, "\(label) \(pressure) holds new work even with no occupied slots")
                check(decision.occupiedCount == 0, "\(label) pressure does not change source-waiter accounting")
                check(decision.reason == (pressure == .warning ? .memoryWarning : .memoryCritical),
                    "\(label) pressure reason is exposed")
            }
        }
        let unavailable = RunAdmission.decide(limit: limit, activeRuns: boundary - 1, memoryPressure: .unknown)
        check(unavailable.admitted, "\(label) missing telemetry does not permanently strand new work")
        let recovered = RunAdmission.decide(limit: limit, activeRuns: boundary - 1, memoryPressure: .normal)
        check(recovered.admitted, "\(label) normal pressure resumes admission without deleting existing runs")
    }
    check(RunAdmission.decide(limit: nil, activeRuns: 10_000, memoryPressure: .normal).admitted,
        "unlimited has no hidden 64-run cap")
    check(RunAdmission.occupiedCount(activeRuns: 6, waitingForSourceRuns: 2) == 4, "only executing runs occupy slots")
    check(RunAdmission.occupiedCount(activeRuns: 2, waitingForSourceRuns: 8) == 0, "invalid waiter count cannot make occupancy negative")
    check(RunAdmission.occupiedCount(activeRuns: -2, waitingForSourceRuns: -8) == 0, "invalid counts are bounded")
    check(RunAdmission.decide(limit: 0, activeRuns: 1, memoryPressure: .normal).reason == .slotLimit,
        "explicit malformed zero cap clamps to one")
    check(RunAdmission.decide(limit: 100, activeRuns: 64, memoryPressure: .normal).reason == .slotLimit,
        "explicit malformed high cap clamps to 64")

    for (raw, expected): (UInt32, RunAdmission.MemoryPressure) in [(1, .normal), (2, .warning), (4, .critical)] {
        check(RunMemoryPressure.sample(readLevel: { raw }) == expected, "sysctl dispatch value \(raw) is not an internal enum or percentage")
    }
    for raw: UInt32 in [0, 3, 5, 100, UInt32.max] {
        check(RunMemoryPressure.sample(readLevel: { raw }) == .unknown, "unrecognized sysctl value \(raw) remains unknown")
    }
    check(RunMemoryPressure.sample(readLevel: { nil }) == .unknown, "sysctl read failure remains explicit")
    for reason: RunAdmission.HoldReason in [.slotLimit, .memoryWarning, .memoryCritical] {
        check(!reason.message(interfaceLanguage: "en").isEmpty, "English reason exists")
        check(reason.message(interfaceLanguage: "en") != reason.message(interfaceLanguage: "ko"), "Korean reason is localized")
    }
    print("Run-admission fixtures: \(checks) checks; model calls 0; owner settings reads 0")
}
