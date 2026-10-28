import Foundation
import OS1Context

/// Deterministic command/projection fixtures only: no SessionStore, HOME,
/// provider, native process, model call or user task is opened or changed.
func runSimulationSessionControlFixtures() throws {
    typealias C = SimulationSessionControl
    var checks = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Simulation session control: " + message); checks += 1
    }
    let first = UUID(uuidString: "10000000-0000-4000-8000-000000000001")!
    let second = UUID(uuidString: "10000000-0000-4000-8000-000000000002")!
    let commandID = "20000000-0000-4000-8000-000000000001"
    let command = C.Command.parse(commandID: commandID, action: "order", sessionID: first.uuidString, text: "  1+1\n")!
    check(command.text == "  1+1\n", "exact prompt bytes survive validation")
    check(C.Command.parse(commandID: "bad", action: "stop", sessionID: first.uuidString, text: nil) == nil,
        "invalid command UUID rejected")
    check(C.Command.parse(commandID: commandID, action: "stop", sessionID: "bad", text: nil) == nil,
        "invalid session UUID rejected")
    check(C.Command.parse(commandID: commandID, action: "deleteEverything", sessionID: first.uuidString, text: nil) == nil,
        "unknown action rejected")
    check(C.Command.parse(commandID: commandID, action: "stop", sessionID: nil, text: nil) == nil,
        "session-scoped command requires an exact UUID")
    check(C.Command.parse(commandID: commandID, action: "order", sessionID: first.uuidString, text: " \n ") == nil,
        "empty order rejected")
    check(C.Command.parse(commandID: commandID, action: "order", sessionID: first.uuidString, text: "x\0y") == nil,
        "NUL prompt rejected")
    check(C.Command.parse(commandID: commandID, action: "stop", sessionID: first.uuidString, text: "hidden prompt") == nil,
        "prompt cannot hide in a stop action")
    check(C.Command.parse(commandID: commandID, action: "order", sessionID: first.uuidString,
        text: String(repeating: "x", count: C.maximumTextBytes)) != nil, "exact text byte bound accepted")
    check(C.Command.parse(commandID: commandID, action: "order", sessionID: first.uuidString,
        text: String(repeating: "x", count: C.maximumTextBytes + 1)) == nil, "one byte over bound rejected")
    check(C.Command.parse(commandID: commandID, action: "order", sessionID: first.uuidString,
        text: String(repeating: "é", count: C.maximumTextBytes / 2)) != nil, "exact multibyte text bound accepted")
    check(C.Command.parse(commandID: commandID, action: "order", sessionID: first.uuidString,
        text: String(repeating: "é", count: C.maximumTextBytes / 2 + 1)) == nil, "bound measures UTF8 bytes, not characters")

    var ledger = C.Deduplicator()
    check(ledger.begin(command) == .execute, "fresh command dispatches once")
    if case .reject(let pending) = ledger.begin(command) {
        check(!pending.accepted && pending.commandID == command.commandID, "pending duplicate has no second action")
    } else { preconditionFailure("pending command was repeated") }
    let submission = UUID(uuidString: "30000000-0000-4000-8000-000000000001")!
    let outcome = C.ControlOutcome(accepted: true, sessionID: first, submissionID: submission, message: "Queued.")
    let receipt = ledger.record(command, outcome: outcome)
    check(receipt.commandID == command.commandID && receipt.action == .order && receipt.sessionID == first &&
        receipt.submissionID == submission && receipt.accepted, "receipt retains exact identities")
    check(ledger.begin(command) == .replay(receipt), "same command/payload replays its original receipt")
    check(ledger.record(command, outcome: C.ControlOutcome(accepted: false, message: "Late replacement.")) == receipt,
        "double completion cannot rewrite the accepted receipt")
    let changedText = C.Command.parse(commandID: commandID, action: "order", sessionID: first.uuidString, text: "2+2")!
    let changedSession = C.Command.parse(commandID: commandID, action: "order", sessionID: second.uuidString, text: command.text)!
    let changedAction = C.Command.parse(commandID: commandID, action: "stop", sessionID: first.uuidString, text: nil)!
    for changed in [changedText, changedSession, changedAction] {
        if case .reject(let rejection) = ledger.begin(changed) {
            check(!rejection.accepted, "same ID with changed payload rejected")
        } else { preconditionFailure("changed payload reused an existing command ID") }
    }
    check(ledger.begin(command) == .replay(receipt), "conflict leaves the original receipt intact")
    let canonicalAlias = C.Command.parse(commandID: commandID.lowercased(), action: "order",
        sessionID: first.uuidString.lowercased(), text: command.text)!
    check(ledger.begin(canonicalAlias) == .replay(receipt), "UUID spelling does not duplicate a logical command")
    let encoded = try JSONEncoder().encode(receipt)
    check(try JSONDecoder().decode(C.CommandReceipt.self, from: encoded) == receipt, "receipt Codable round trip")
    let keys = Set((try JSONSerialization.jsonObject(with: encoded) as! [String: Any]).keys)
    check(keys == ["commandID", "action", "sessionID", "accepted", "submissionID", "message"],
        "receipt has only the exact public command fields")

    var bounded = C.Deduplicator(capacity: 2)
    let stop = C.Command.parse(commandID: UUID().uuidString, action: "stop", sessionID: first.uuidString, text: nil)!
    check(bounded.begin(stop) == .execute, "stop can be reserved")
    let stopReceipt = bounded.record(stop, outcome: C.ControlOutcome(accepted: true, sessionID: first,
        message: "Cancellation requested; native stop not yet confirmed."))
    let create = C.Command.parse(commandID: UUID().uuidString, action: "new", sessionID: nil, text: nil)!
    check(bounded.begin(create) == .execute, "create is distinct from an order")
    let createReceipt = bounded.record(create, outcome: C.ControlOutcome(accepted: true, sessionID: second, message: "Created."))
    check(createReceipt.sessionID == second, "new session receipt reports the actual created session")
    let third = C.Command.parse(commandID: UUID().uuidString, action: "open", sessionID: first.uuidString, text: nil)!
    check(bounded.begin(third) == .execute, "full receipt cache does not block a fresh command")
    check(bounded.begin(stop) == .replay(stopReceipt), "pending new command does not evict a completed receipt")
    _ = bounded.record(third, outcome: C.ControlOutcome(accepted: true, sessionID: first, message: "Opened."))
    check(bounded.receiptCount == 2 && bounded.count == 3, "small receipt cache and larger identity set are distinct")
    if case .reject(let expired) = bounded.begin(stop) {
        check(!expired.accepted && expired.message.contains("already completed"),
            "expired receipt identity remains a non-executable tombstone")
    } else { preconditionFailure("expired command became executable") }
    check(bounded.begin(create) == .replay(createReceipt), "recent original receipt is still replayed exactly")
    let unseen = C.Command.parse(commandID: UUID().uuidString, action: "open", sessionID: first.uuidString, text: nil)!
    let unreserved = bounded.record(unseen, outcome: outcome)
    check(!unreserved.accepted && bounded.count == 3, "unreserved completion cannot forge acceptance")

    var full = C.Deduplicator()
    var oldest: C.Command?
    for index in 0..<(C.maximumRememberedCommands + 12) {
        let item = C.Command.parse(commandID: UUID().uuidString, action: "new", sessionID: nil, text: nil)!
        if index == 0 { oldest = item }
        check(full.begin(item) == .execute, "fresh commands remain usable beyond 128 completed commands")
        _ = full.record(item, outcome: C.ControlOutcome(accepted: true, sessionID: second, message: "Created."))
    }
    check(full.receiptCount == 128 && full.count == 140, "completed receipt payload cache remains bounded at 128")
    let laterStop = C.Command.parse(commandID: UUID().uuidString, action: "stop", sessionID: first.uuidString, text: nil)!
    check(full.begin(laterStop) == .execute, "stop remains usable after more than 128 commands")
    _ = full.record(laterStop, outcome: C.ControlOutcome(accepted: true, sessionID: first, message: "Cancellation requested."))
    if case .reject(let expired) = full.begin(oldest!) {
        check(!expired.accepted && expired.message.contains("already completed"), "oldest command never executes again")
    } else { preconditionFailure("oldest completed identity was lost") }
    let changedOldest = C.Command.parse(commandID: oldest!.commandID.uuidString, action: "stop",
        sessionID: first.uuidString, text: nil)!
    if case .reject(let conflict) = full.begin(changedOldest) {
        check(!conflict.accepted && conflict.message.contains("different payload"),
            "retired identity still detects payload mutation")
    } else { preconditionFailure("retired identity accepted a changed payload") }
    check(!full.record(oldest!, outcome: outcome).accepted,
        "a late completion cannot recreate or overwrite an expired receipt")

    var limited = C.Deduplicator(capacity: 1, maximumIdentities: 2)
    let pending = C.Command.parse(commandID: UUID().uuidString, action: "order", sessionID: first.uuidString, text: "pending")!
    check(limited.begin(pending) == .execute, "pending command consumes one bounded identity")
    check(limited.begin(create) == .execute, "second identity is permitted")
    _ = limited.record(create, outcome: C.ControlOutcome(accepted: true, sessionID: second, message: "Created."))
    if case .reject(let waiting) = limited.begin(pending) {
        check(!waiting.accepted && waiting.message.contains("pending"), "pending duplicate is never retired or repeated")
    } else { preconditionFailure("pending identity was forgotten") }
    if case .reject(let identityLimit) = limited.begin(laterStop) {
        check(!identityLimit.accepted && limited.count == 2 && identityLimit.message.contains("explicitly restart"),
            "true identity bound fails closed with explicit restart guidance")
    } else { preconditionFailure("true identity bound exceeded") }
    _ = limited.record(pending, outcome: C.ControlOutcome(accepted: true, sessionID: first, message: "Queued."))
    check(limited.receiptCount == 1 && limited.count == 2, "completion retires only old receipt payload, not identity")
    if case .reject(let expired) = limited.begin(create) {
        check(!expired.accepted && expired.message.contains("already completed"), "evicted receipt cannot make a new session twice")
    } else { preconditionFailure("evicted create was replayed as a new action") }

    var mismatch = C.Deduplicator()
    check(mismatch.begin(stop) == .execute, "mismatch fixture is initially admitted")
    let mismatched = mismatch.record(stop, outcome: C.ControlOutcome(accepted: true, sessionID: second, message: "Wrong."))
    check(!mismatched.accepted && mismatched.sessionID == first && mismatched.submissionID == nil,
        "a callback for another session cannot produce an accepted receipt")

    func state(_ active: Bool, _ cancel: Bool, _ pause: Bool, _ queued: Int = 0,
               _ failed: Bool = false, _ completed: Bool = false) -> C.Status {
        C.status(active: active, cancellationRequested: cancel, queuePaused: pause,
            queuedCount: queued, failed: failed, completed: completed)
    }
    check(state(true, false, true, 2) == .working, "queue pause alone does not stop the active task")
    check(state(true, true, true, 2) == .stopping, "cancellation remains stopping while the task is active")
    check(state(true, true, false) == .stopping, "cancellation outranks working even without queue pause")
    check(state(false, true, true, 2) == .paused, "paused appears only after the active task terminates")
    check(state(false, false, false, 1, true, true) == .queued, "queued work is not reported as an old terminal result")
    check(state(false, false, false, 0, true, true) == .failed, "failure outranks stale completed evidence")
    check(state(false, false, false, 0, false, true) == .completed, "completed uses actual terminal evidence")
    check(state(false, false, false) == .idle, "no work is idle")
    check(state(false, false, true) == .paused, "queue pause is visible with no queued work")
    print("Simulation session control: \(checks) checks OK; deterministic fixtures; model calls 0")
}
