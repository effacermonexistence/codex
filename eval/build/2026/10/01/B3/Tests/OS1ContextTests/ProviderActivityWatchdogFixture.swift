import Foundation
import OS1Context

/// A provider attempt stops for silence or at its hard ceiling, never merely
/// for being long (2026-09-24: seven owner tasks were cut at exactly 30 min
/// while their backends were still streaming).
func runProviderActivityWatchdogFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Provider watchdog: " + message); count += 1
    }
    let start = Date(timeIntervalSince1970: 1_790_000_000)
    let fourHours = start.addingTimeInterval(14_400)

    // A backend that keeps producing events runs past the old 30-minute cap.
    var busy = ProviderActivityWatchdog(ceiling: fourHours, idle: 1_800, now: start)
    for minute in stride(from: 5, through: 235, by: 5) {
        let now = start.addingTimeInterval(TimeInterval(minute * 60))
        check(!busy.expired(at: now), "active backend at \(minute) min is not stopped")
        busy.observeActivity(at: now)
    }
    check(busy.deadline == fourHours, "an active backend's deadline is the ceiling")
    check(busy.expired(at: fourHours), "the ceiling still stops an always-active backend")
    check(busy.expiryReason(at: fourHours).hasPrefix(ProviderActivityWatchdog.timeoutText), "ceiling reason keeps the timeout classifier text")
    check(busy.expiryReason(at: fourHours).contains("attempt ceiling of 4 h"), "ceiling reason names the ceiling")

    // Silence stops the attempt at the idle limit, measured from the last event.
    var quiet = ProviderActivityWatchdog(ceiling: fourHours, idle: 1_800, now: start)
    quiet.observeActivity(at: start.addingTimeInterval(600))
    check(!quiet.expired(at: start.addingTimeInterval(2_399)), "quiet for 29:59 is not stopped")
    check(quiet.expired(at: start.addingTimeInterval(2_400)), "quiet for 30 min is stopped")
    check(quiet.expiryReason(at: start.addingTimeInterval(2_400)) == ProviderActivityWatchdog.timeoutText + ": no backend activity for 30 min",
          "idle reason names the silence")

    // No regression: anything the old 30-minute total cap allowed is allowed.
    let oldCap = start.addingTimeInterval(1_800)
    let untouched = ProviderActivityWatchdog(ceiling: fourHours, idle: 1_800, now: start)
    check(!untouched.expired(at: oldCap.addingTimeInterval(-1)), "a silent attempt keeps the old 30-minute allowance")

    // A lease shorter than the idle limit wins (old server: 30-minute lease).
    let shortLease = ProviderActivityWatchdog(ceiling: oldCap, idle: 1_800, now: start)
    check(shortLease.deadline == oldCap && shortLease.expiryReason(at: oldCap).contains("attempt ceiling of 30 min"),
          "the server lease bounds the attempt even while active")

    // Without an idle limit the historical single deadline applies.
    var legacy = ProviderActivityWatchdog(ceiling: oldCap, idle: nil, now: start)
    legacy.observeActivity(at: start.addingTimeInterval(1_700))
    check(legacy.deadline == oldCap && !legacy.expired(at: oldCap.addingTimeInterval(-0.1)) && legacy.expired(at: oldCap),
          "idle == nil keeps the fixed deadline")

    // Activity never moves backwards or past the ceiling.
    var ordered = ProviderActivityWatchdog(ceiling: fourHours, idle: 60, now: start)
    ordered.observeActivity(at: start.addingTimeInterval(120))
    ordered.observeActivity(at: start.addingTimeInterval(30))
    check(ordered.lastActivity == start.addingTimeInterval(120), "an older observation does not rewind activity")
    ordered.observeActivity(at: fourHours.addingTimeInterval(-10))
    check(ordered.deadline == fourHours, "the idle window never extends past the ceiling")
    print("Provider activity watchdog: \(count) checks passed; active runs outlive the old cap, silence and the ceiling still stop them")
}
