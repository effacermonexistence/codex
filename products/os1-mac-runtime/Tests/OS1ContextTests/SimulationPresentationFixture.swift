import Foundation
import OS1Context

/// Synthetic presentation receipts only. No live session, queue, provider,
/// account, model, native application or approval state is changed.
func runSimulationPresentationFixtures() throws {
    typealias P = SimulationPresentationState
    var count = 0
    func check(_ value: Bool, _ label: String) {
        precondition(value, "Simulation presentation: " + label); count += 1
    }
    let now = Date(timeIntervalSince1970: 1_792_987_200)
    let a = "AAAAAAAA-0000-4000-8000-000000000001"
    let b = "BBBBBBBB-0000-4000-8000-000000000002"
    let rev = "assistant-message-1:terminal-revision-1"
    var state = P(baselineAt: now)
    func featured(_ value: P, id: String = a, revision: String? = rev, hasResult: Bool = true,
                  resultAt: Date? = nil, running: Bool = false, queued: Bool = false,
                  empty: Bool = false, selected: Bool = false) -> Bool {
        value.isFeatured(id: id, revision: revision, hasResult: hasResult, resultAt: resultAt,
                         isRunning: running, isQueued: queued, isNewEmpty: empty, isSelected: selected)
    }
    check(state.reviewed.isEmpty && state.deployedIDs.isEmpty && state.baselineAt == now,
          "first feature visibility creates a baseline, not invented review history")
    check(!featured(state, resultAt: now.addingTimeInterval(-1)), "historical outcome is not featured by default")
    check(!state.hasReviewed(sessionID: a, revision: rev), "hidden historical outcome is not falsely reviewed")
    check(featured(state, resultAt: now), "real result at the baseline is featured")
    check(featured(state, resultAt: now.addingTimeInterval(1)), "new outcome remains available for review")
    check(!featured(state, hasResult: false, resultAt: now), "timestamp alone cannot invent a result")
    check(!featured(state, resultAt: nil), "missing result timestamp does not become recent")
    check(featured(state, running: true) && featured(state, queued: true), "active and queued sessions always enter field")
    check(featured(state, hasResult: false, empty: true), "new empty native session is available for an order")
    check(featured(state, selected: true), "explicitly selected historical session may be inspected")
    check(!featured(state, id: "not-a-uuid", running: true), "invalid identity cannot enter field")
    check(!state.review(sessionID: a, revision: rev, inspectedRevision: nil, isRunning: false, isQueued: false),
          "selection alone cannot acknowledge a result")
    check(!state.review(sessionID: a, revision: rev, inspectedRevision: "old-result", isRunning: false, isQueued: false),
          "stale displayed result cannot acknowledge a new revision")
    check(!state.review(sessionID: a, revision: rev, inspectedRevision: rev, isRunning: true, isQueued: false),
          "in-flight session cannot be retired")
    check(!state.review(sessionID: a, revision: rev, inspectedRevision: rev, isRunning: false, isQueued: true),
          "queued session cannot be retired")
    check(!state.review(sessionID: "not-a-uuid", revision: rev, inspectedRevision: rev, isRunning: false, isQueued: false),
          "review requires valid native UUID")
    check(!state.review(sessionID: a, revision: " ", inspectedRevision: " ", isRunning: false, isQueued: false),
          "blank revision rejected")
    let oversizedRevision = String(repeating: "x", count: P.maximumRevisionBytes + 1)
    check(!state.review(sessionID: a, revision: oversizedRevision, inspectedRevision: oversizedRevision, isRunning: false, isQueued: false),
          "unbounded revision rejected")
    check(!state.review(sessionID: a, revision: "x\ny", inspectedRevision: "x\ny", isRunning: false, isQueued: false),
          "control characters cannot enter revision key")
    check(state.deploy(sessionID: a.lowercased()) && state.deployedIDs == [a], "deployment normalizes native UUID")
    check(featured(state), "explicit deployment is presentation-only field inclusion")
    check(state.review(sessionID: a, revision: rev, inspectedRevision: rev, isRunning: false, isQueued: false),
          "displayed matching terminal result may be acknowledged")
    check(state.hasReviewed(sessionID: a.lowercased(), revision: rev) && !state.hasReviewed(sessionID: a, revision: "next-result"),
          "receipt belongs to exact UUID and result revision")
    check(!state.deployedIDs.contains(a), "acknowledgement removes presentation deployment only")
    check(!featured(state, resultAt: now.addingTimeInterval(10), selected: true), "acknowledged terminal stays hidden even if selected")
    let acknowledged = state
    check(state.review(sessionID: a, revision: rev, inspectedRevision: rev, isRunning: false, isQueued: false) && state == acknowledged,
          "duplicate acknowledgement is idempotent")
    check(state.deploy(sessionID: a) && state.hasReviewed(sessionID: a, revision: rev), "deployment does not clear review history")
    check(!featured(state), "mere deployment of reviewed result does not resurrect it")
    check(featured(state, running: true) && featured(state, queued: true), "same UUID resumes or queues without duplicate worker")
    check(featured(state, revision: "next-result", resultAt: now.addingTimeInterval(100)), "new result revision naturally re-enters field")
    check(state.clearReview(sessionID: a) && !state.hasReviewed(sessionID: a, revision: rev), "explicit reassignment may clear receipt")
    check(!state.clearReview(sessionID: a) && !state.clearReview(sessionID: "invalid"), "repeat/invalid clear is harmless")
    check(!state.deploy(sessionID: "invalid"), "invalid deployment rejected")
    check(state.review(sessionID: a, revision: rev, inspectedRevision: rev, isRunning: false, isQueued: false), "re-establish fixture receipt")
    check(state.deploy(sessionID: b), "independent session may be deployed")

    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-simulation-presentation-" + UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }
    let file = root.appendingPathComponent(P.filename)
    check(P.load(from: file, now: now) == P(baselineAt: now), "absent file restores no history")
    try state.save(to: file)
    check(P.load(from: file, now: now) == state, "restart preserves baseline, exact review and deployment")
    let permissions = (try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? NSNumber)?.intValue
    check(permissions == 0o600, "durable presentation file is private 0600")
    try state.save(to: file)
    check(P.load(from: file, now: now) == state, "same-directory atomic replacement preserves state")
    check(try FileManager.default.contentsOfDirectory(atPath: root.path).allSatisfy({ !$0.hasSuffix(".tmp") }), "atomic write leaves no temporary file")
    let protected = root.appendingPathComponent("sessions.json")
    let original = Data("unaltered native session and queue fixture".utf8)
    try original.write(to: protected)
    do { try state.save(to: protected); preconditionFailure("wrong persistence leaf accepted") } catch {}
    check(try Data(contentsOf: protected) == original, "passing session-store path never writes session bytes")
    let link = root.appendingPathComponent("linked")
    try FileManager.default.createDirectory(at: link, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    let symlink = link.appendingPathComponent(P.filename)
    try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: protected)
    check(P.load(from: symlink, now: now).reviewed.isEmpty, "symlink does not supply review receipts")
    do { try state.save(to: symlink); preconditionFailure("symlink target accepted") } catch {}
    check(try Data(contentsOf: protected) == original, "symlink cannot redirect presentation write")
    let directoryAlias = root.appendingPathComponent("alias")
    try FileManager.default.createSymbolicLink(at: directoryAlias, withDestinationURL: link)
    do { try state.save(to: directoryAlias.appendingPathComponent(P.filename)); preconditionFailure("symlink directory accepted") } catch {}
    check(P.load(from: directoryAlias.appendingPathComponent(P.filename), now: now).reviewed.isEmpty, "symlink directory rejected on load")
    try Data("{bad".utf8).write(to: file)
    check(P.load(from: file, now: now) == P(baselineAt: now), "malformed JSON falls back without fake review")
    func writeJSON(_ object: [String: Any]) throws {
        try JSONSerialization.data(withJSONObject: object).write(to: file)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
    }
    let date = now.timeIntervalSinceReferenceDate
    try writeJSON(["schema": 2, "baselineAt": date, "reviewed": [a: rev], "deployedIDs": []])
    check(P.load(from: file, now: now).reviewed.isEmpty, "future schema does not become review authority")
    try writeJSON(["schema": 1, "baselineAt": date, "reviewed": [a: true], "deployedIDs": []])
    check(P.load(from: file, now: now).reviewed.isEmpty, "wrong field type rejected")
    try writeJSON(["schema": 1, "baselineAt": date, "reviewed": ["invalid": rev], "deployedIDs": []])
    check(P.load(from: file, now: now).reviewed.isEmpty, "invalid persisted UUID rejected")
    try writeJSON(["schema": 1, "baselineAt": date, "reviewed": [a: oversizedRevision], "deployedIDs": []])
    check(P.load(from: file, now: now).reviewed.isEmpty, "persisted revision bound enforced")
    try writeJSON(["schema": 1, "baselineAt": date + 100, "reviewed": [a: rev], "deployedIDs": []])
    check(P.load(from: file, now: now) == P(baselineAt: now), "future baseline cannot suppress genuine current result")
    try Data(repeating: 32, count: P.maximumBytes + 1).write(to: file)
    check(P.load(from: file, now: now).reviewed.isEmpty, "oversized presentation file ignored within bound")
    try state.save(to: file)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: file.path)
    check(P.load(from: file, now: now).reviewed.isEmpty, "non-private persisted receipt not adopted")
    do { try state.save(to: file); preconditionFailure("non-private target accepted") } catch {}
    check(try Data(contentsOf: protected) == original, "all rejection cases preserve unrelated session and queue bytes")
    print("Simulation presentation fixtures PASS (\(count) checks; synthetic, zero provider/session/queue actions)")
}
