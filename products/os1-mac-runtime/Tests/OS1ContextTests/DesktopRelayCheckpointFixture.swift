import Darwin
import Foundation
import OS1Context

private final class DesktopRelayFixtureCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var counts = (created: 0, duplicate: 0, unexpected: 0)
    func add(_ result: Int) {
        lock.lock(); defer { lock.unlock() }
        if result == 0 { counts.created += 1 }
        else if result == 1 { counts.duplicate += 1 }
        else { counts.unexpected += 1 }
    }
    func read() -> (created: Int, duplicate: Int, unexpected: Int) {
        lock.lock(); defer { lock.unlock() }; return counts
    }
}

/// Fake records only; every write is scoped to a fresh temporary directory.
func runDesktopRelayCheckpointFixtures() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
    func rejects(_ label: String, _ work: () throws -> Void) {
        do { try work(); preconditionFailure(label) } catch { checks += 1 }
    }
    let temporary = FileManager.default.temporaryDirectory.resolvingSymlinksInPath()
        .appendingPathComponent("os1-desktop-relay-fixture-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: temporary) }
    let store = try DesktopRelayCheckpointStore(rootURL: temporary.appendingPathComponent("records"))
    let relay = UUID().uuidString.lowercased(), target = UUID().uuidString.lowercased(), client = UUID().uuidString.lowercased()
    let turn = UUID().uuidString.lowercased(), sent = UUID().uuidString.lowercased(), previous = UUID().uuidString.lowercased(), answer = UUID().uuidString.lowercased()
    func binding(_ id: String = UUID().uuidString, hash: String = String(repeating: "a", count: 64),
                 targetID: String? = nil) throws -> DesktopRelayBinding {
        try DesktopRelayBinding(requestID: id, taskID: "task-fixture", requestSHA256: hash,
            relayThreadID: relay, clientUserMessageID: client, targetThreadID: targetID ?? target,
            nonce: "OS1_DESKTOP_RELAY_FIXTURE")
    }
    rejects("same thread different UUID casing is not a valid target") {
        _ = try DesktopRelayBinding(requestID: "same-thread", taskID: "task", requestSHA256: String(repeating: "a", count: 64),
            relayThreadID: relay, clientUserMessageID: client, targetThreadID: relay.uppercased(), nonce: "nonce")
    }
    let identity = try binding()
    let intent = try store.createIntent(binding: identity)
    check(intent.status == .dispatchIntent && intent.turnID == nil && !intent.replayPermitted,
          "intent persisted before any dispatch; no implicit retry")
    check(intent.codexRelayUsage == .unknown && intent.chatGPTQuotaDebit == "UNKNOWN", "unknown usage is not zero")
    rejects("existing intent is never dispatched again") { _ = try store.createIntent(binding: identity) }
    let wrongHash = try binding(identity.requestID, hash: String(repeating: "b", count: 64))
    rejects("same request ID with a changed hash rejects") { _ = try store.load(binding: wrongHash) }
    let wrongTarget = try binding(identity.requestID, targetID: UUID().uuidString)
    rejects("same request ID with a changed target rejects") { _ = try store.load(binding: wrongTarget) }
    rejects("acknowledgement requires pre-dispatch intent") { _ = try store.acknowledge(binding: binding(), turnID: turn) }
    _ = try store.markPending(binding: identity, reason: .disconnected)
    check(try store.load(binding: identity)?.status == .pending, "ambiguous disconnect retains pending identity")
    _ = try store.acknowledge(binding: identity, turnID: turn)
    let ack = try store.acknowledge(binding: identity, turnID: turn)
    check(ack.revision == 2, "exact duplicate acknowledgement is idempotent")
    rejects("another acknowledged turn cannot overwrite binding") { _ = try store.acknowledge(binding: identity, turnID: UUID().uuidString) }
    _ = try store.markPending(binding: identity, reason: .deadline)
    check(try store.load(binding: identity)?.replayPermitted == false, "deadline never permits resend")
    rejects("wrong late turn is rejected") {
        _ = try store.recordObserverCompletion(binding: identity, turnID: UUID().uuidString,
            rawOutput: "OS1_DESKTOP_RELAY_FIXTURE=7", nativeRecordID: "native-fixture.jsonl")
    }
    rejects("empty observer output is not completion") {
        _ = try store.recordObserverCompletion(binding: identity, turnID: turn, rawOutput: " ", nativeRecordID: "native-fixture.jsonl")
    }
    _ = try store.recordObserverCompletion(binding: identity, turnID: turn,
        rawOutput: "REPLY=OS1_DESKTOP_RELAY_FIXTURE=7\nTURN=\(answer)", nativeRecordID: "native-fixture.jsonl")
    check(try store.load(binding: identity)?.status == .observerCompleted, "late exact turn is recovered without send")
    check(try store.load(binding: identity)?.response == nil, "relay prose is not ChatGPT provenance")
    rejects("response without target send provenance is rejected") {
        _ = try store.adoptResponse(binding: identity, targetUserMessageID: sent, assistantMessageID: answer,
            rawResponse: "OS1_DESKTOP_RELAY_FIXTURE=7", source: .officialThreadRead)
    }
    _ = try store.recordTargetSend(binding: identity, targetUserMessageID: sent, previousAssistantMessageID: previous)
    rejects("self-computed answer is not adopted") {
        _ = try store.adoptResponse(binding: identity, targetUserMessageID: sent, assistantMessageID: answer,
            rawResponse: "OS1_DESKTOP_RELAY_FIXTURE=7", source: .selfComputed)
    }
    rejects("relay assertion is not independent read") {
        _ = try store.adoptResponse(binding: identity, targetUserMessageID: sent, assistantMessageID: answer,
            rawResponse: "OS1_DESKTOP_RELAY_FIXTURE=7", source: .relayAssertion)
    }
    rejects("wrong target user message is rejected") {
        _ = try store.adoptResponse(binding: identity, targetUserMessageID: UUID().uuidString, assistantMessageID: answer,
            rawResponse: "OS1_DESKTOP_RELAY_FIXTURE=7", source: .officialThreadRead)
    }
    rejects("stale assistant message is rejected") {
        _ = try store.adoptResponse(binding: identity, targetUserMessageID: sent, assistantMessageID: previous,
            rawResponse: "OS1_DESKTOP_RELAY_FIXTURE=7", source: .officialThreadRead)
    }
    rejects("missing nonce is rejected") {
        _ = try store.adoptResponse(binding: identity, targetUserMessageID: sent, assistantMessageID: answer,
            rawResponse: "7", source: .officialThreadRead)
    }
    let completed = try store.adoptResponse(binding: identity, targetUserMessageID: sent, assistantMessageID: answer,
        rawResponse: "OS1_DESKTOP_RELAY_FIXTURE=7", source: .officialThreadRead)
    check(completed.status == .completed && completed.response?.assistantMessageID == answer, "exact response and message ID preserved")
    rejects("completed request cannot revert to pending") { _ = try store.markPending(binding: identity, reason: .deadline) }
    _ = try store.recordNonzeroCodexUsage(binding: identity)
    check(try store.load(binding: identity)?.codexRelayUsage == .nonzero, "observed relay usage never zero-labelled")

    let denied = try binding()
    _ = try store.createIntent(binding: denied)
    _ = try store.acknowledge(binding: denied, turnID: turn)
    _ = try store.markBlockedAuthorization(binding: denied, reason: "Official send tool denied this action")
    rejects("authorization denial must not become pending/replay") { _ = try store.markPending(binding: denied, reason: .deadline) }
    rejects("authorization denial cannot adopt late result") {
        _ = try store.recordObserverCompletion(binding: denied, turnID: turn, rawOutput: "done", nativeRecordID: "native-fixture.jsonl")
    }
    check(try store.load(binding: denied)?.status == .blockedAuthorization, "denied state remains terminal")
    let cancelled = try binding()
    _ = try store.createIntent(binding: cancelled); _ = try store.acknowledge(binding: cancelled, turnID: turn)
    _ = try store.cancel(binding: cancelled)
    rejects("cancelled task cannot adopt late answer") {
        _ = try store.recordObserverCompletion(binding: cancelled, turnID: turn,
            rawOutput: "OS1_DESKTOP_RELAY_FIXTURE=7", nativeRecordID: "native-fixture.jsonl")
    }
    let deniedURL = try store.fileURL(binding: denied)
    var edited = try JSONSerialization.jsonObject(with: Data(contentsOf: deniedURL)) as! [String: Any]
    edited["status"] = "pending"; edited["pendingReason"] = "deadline"
    try JSONSerialization.data(withJSONObject: edited).write(to: deniedURL)
    rejects("blocked-send record mislabeled pending is invalid") { _ = try store.load(binding: denied) }

    let concurrent = try binding()
    let counter = DesktopRelayFixtureCounter()
    DispatchQueue.concurrentPerform(iterations: 8) { _ in
        do { _ = try store.createIntent(binding: concurrent); counter.add(0) }
        catch DesktopRelayCheckpointError.alreadyExists { counter.add(1) }
        catch { counter.add(2) }
    }
    let counts = counter.read()
    check(counts.created == 1 && counts.duplicate == 7 && counts.unexpected == 0,
          "cross-writer lock permits one intent only")

    var permissions = stat()
    check(lstat(try store.fileURL(binding: identity).path, &permissions) == 0 && permissions.st_mode & 0o077 == 0,
          "receipt owner-only")
    let foreign = try binding()
    let foreignURL = try store.fileURL(binding: foreign)
    let protectedFile = temporary.appendingPathComponent("protected-state")
    try Data("do-not-change".utf8).write(to: protectedFile)
    try FileManager.default.createSymbolicLink(at: foreignURL, withDestinationURL: protectedFile)
    rejects("receipt symlink cannot overwrite protected file") { _ = try store.createIntent(binding: foreign) }
    check(try String(contentsOf: protectedFile, encoding: .utf8) == "do-not-change", "protected state untouched")
    let rootLink = temporary.appendingPathComponent("linked-root")
    try FileManager.default.createSymbolicLink(at: rootLink, withDestinationURL: store.rootURL)
    rejects("symlink storage root rejected") { _ = try DesktopRelayCheckpointStore(rootURL: rootLink) }
    let loose = temporary.appendingPathComponent("loose")
    try FileManager.default.createDirectory(at: loose, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o755])
    rejects("existing nonprivate root rejected rather than chmodded") { _ = try DesktopRelayCheckpointStore(rootURL: loose) }
    let hard = try binding()
    let hardURL = try store.fileURL(binding: hard)
    check(link(try store.fileURL(binding: identity).path, hardURL.path) == 0, "fixture hardlink created")
    rejects("hardlink receipt rejected") { _ = try store.load(binding: hard) }
    check(try FileManager.default.contentsOfDirectory(atPath: store.rootURL.path).allSatisfy { !$0.hasPrefix(".checkpoint-") },
          "atomic-write temporary files cleaned")
    print("DesktopRelayCheckpoint fixtures: \(checks) checks PASS (fake records; provider calls 0)")
}
