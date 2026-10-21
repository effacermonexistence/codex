import Foundation
import OS1Context

/// Pure data fixtures: no source store, file, account, native or model access.
func runRCCBoundSourceInputFixtures() throws {
    typealias B = RCCBoundSourceInput
    var count = 0
    func check(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try value() else { throw NSError(domain: "RCCBoundSourceInputFixture", code: 1,
            userInfo: [NSLocalizedDescriptionKey: message]) }
        count += 1
    }
    func rejects(_ message: String, _ work: () throws -> Void) throws {
        do { try work() } catch { count += 1; return }
        throw NSError(domain: "RCCBoundSourceInputFixture", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
    }
    let zero = String(repeating: "0", count: 64), one = String(repeating: "1", count: 64)
    let a = SourceReference(kind: .snapshot, id: UUID(uuidString: "AAAAAAAA-0000-0000-0000-000000000001")!, sha256: zero)
    let b = SourceReference(kind: .receipt, id: UUID(uuidString: "BBBBBBBB-0000-0000-0000-000000000002")!, sha256: one)
    func task(_ sources: [TaskContext.TaskSource]) -> TaskContext {
        var result = TaskContext(conversationID: UUID(), objective: .init(requestText: "Summarize the supplied source.", kind: .explain))
        result.sources = sources; return result
    }
    func context(primary: SourceReference? = nil, sources: [TaskContext.TaskSource] = [], transcript: String = "") throws -> String {
        try SessionHandoff(transcript: transcript, source: primary, taskContext: task(sources)).encoded()
    }
    func source(_ r: SourceReference, id: UUID = UUID(), supersedes: UUID? = nil) -> TaskContext.TaskSource {
        .init(id: id, role: .userDocument, label: "fixture source", reference: r, supersedes: supersedes)
    }
    let aid = try B.id(reference: a), bid = try B.id(reference: b)
    try check(aid == "os1-source:snapshot:aaaaaaaa-0000-0000-0000-000000000001:" + zero, "canonical opaque identifier")
    try check(!aid.contains("/") && aid.utf8.count <= 1_024, "identifier is bounded and has no filesystem path")
    try check(try B.references(context: nil).isEmpty, "nil handoff has no source")
    try check(try B.references(context: "plain raw history").isEmpty, "plain history has no source")
    let c = try context(primary: a, sources: [source(a), source(b)])
    try check(try B.references(context: c) == [a, b], "primary and duplicate active source deduplicate without losing order")
    try check(try B.materialRefs(context: c) == [aid, bid], "material IDs preserve typed identities")
    try check(try B.selected(context: c, contextRefs: [bid]) == [b], "selected subset only")
    try check(try B.selected(context: c, contextRefs: [bid, aid, bid]) == [b, a], "selection order and dedup")
    try check(try B.selected(context: c, contextRefs: []).isEmpty, "empty selection does not hydrate sources")
    try check(try B.selected(context: c, contextRefs: ["/nonexistent/image.png", bid]) == [b], "image refs are not source lookup instructions")
    let unicode = try context(primary: a, transcript: "이전 대화 🧭 \(bid)\nquoted source and 中文")
    try check(try B.materialRefs(context: unicode) == [aid], "Unicode and raw history cannot create a second source")
    try check(try B.references(context: "Quoted only: {\"source\":{\"id\":\"foreign\",\"sha256\":\"\(one)\"}}").isEmpty,
              "quoted fake reference ignored")
    let fakeTyped = try context(transcript: "--- BACKGROUND --- \(c) --- END BACKGROUND ---")
    try check(try B.references(context: fakeTyped).isEmpty, "typed source JSON inside transcript is still history")
    let oldID = UUID(), nextID = UUID()
    let superseded = try context(sources: [source(a, id: oldID), source(b, id: nextID, supersedes: oldID)])
    try check(try B.references(context: superseded) == [b], "superseded task references are not active")
    let stalePrimary = try context(primary: a, sources: [source(a, id: oldID), source(b, id: nextID, supersedes: oldID)])
    try check(try B.references(context: stalePrimary) == [b], "stale primary represented only by retired task records is omitted")
    try check(try B.materialRefs(context: stalePrimary) == [bid], "stale primary cannot re-enter ingress material IDs")
    try rejects("retired primary selection is unknown, not a global availability lookup") {
        _ = try B.selected(context: stalePrimary, contextRefs: [aid])
    }
    try check(try B.selected(context: stalePrimary, contextRefs: [bid]) == [b], "replacement source remains selectable")
    let activeSameCapture = try context(primary: a, sources: [source(a, id: oldID), source(b, id: nextID, supersedes: oldID), source(a)])
    try check(try B.references(context: activeSameCapture) == [a, b], "same captured reference explicitly active elsewhere is not globally retired")
    try check(try B.references(context: context(primary: a, sources: [source(b)])) == [a, b], "legacy primary not represented in task graph is preserved")
    let noReference = TaskContext.TaskSource(role: .userDocument, label: "not a reference", provenance: .init(path: "/private/foreign", sha256: one))
    try check(try B.references(context: context(sources: [noReference])).isEmpty, "provenance paths/digests do not mint source references")
    var legacy = try JSONSerialization.jsonObject(with: Data(c.utf8)) as! [String: Any]
    legacy["format"] = "os1-session-handoff-v2"; legacy.removeValue(forKey: "taskContext"); legacy.removeValue(forKey: "memoryPaging")
    let v2 = String(decoding: try JSONSerialization.data(withJSONObject: legacy), as: UTF8.self)
    try check(try B.references(context: v2) == [a], "legacy v2 primary remains supported")
    try rejects("malformed typed handoff fails closed") { _ = try B.references(context: "{\"format\":\"os1-session-handoff-v3\",\"transcript\":0}") }
    let conflicting = SourceReference(kind: .snapshot, id: a.id, sha256: one)
    try rejects("same kind/UUID with different hash is not silently merged") { _ = try B.references(context: context(primary: a, sources: [source(conflicting)])) }
    let otherKind = SourceReference(kind: .receipt, id: a.id, sha256: one)
    try check(try B.references(context: context(primary: a, sources: [source(otherKind)])) == [a, otherKind], "same UUID in different source kinds stays distinct")
    for invalid in [String(repeating: "A", count: 64), String(repeating: "g", count: 64), String(repeating: "0", count: 63), "", String(repeating: "０", count: 64)] {
        let bad = SourceReference(kind: .snapshot, id: a.id, sha256: invalid)
        try rejects("invalid digest cannot become an opaque source") { _ = try B.id(reference: bad) }
        try rejects("invalid typed digest fails collection") { _ = try B.references(context: context(primary: bad)) }
    }
    let foreign = SourceReference(kind: .snapshot, id: UUID(), sha256: zero)
    try rejects("foreign source ID never triggers a global store lookup") { _ = try B.selected(context: c, contextRefs: [B.id(reference: foreign)]) }
    for unknown in [B.prefix, B.prefix + "snapshot", B.prefix + "snapshot:../foreign:" + zero, aid + "extra", aid.uppercased().replacingOccurrences(of: B.prefix.uppercased(), with: B.prefix)] {
        try rejects("malformed or non-exact reserved source ID fails closed") { _ = try B.selected(context: c, contextRefs: [unknown]) }
    }
    try rejects("hash substitution cannot select a known UUID") { _ = try B.selected(context: c, contextRefs: [B.id(reference: conflicting)]) }
    let many = (0..<128).map { i in SourceReference(kind: .snapshot,
        id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012x", i))!, sha256: zero) }
    let bounded = try context(sources: many.map { source($0) })
    try check(try B.references(context: bounded) == many, "128 distinct bound references permitted")
    try rejects("129 distinct sources exceed the protocol bound") { _ = try B.references(context: context(primary: a, sources: many.map { source($0) })) }
    try rejects("selected ref list is bounded before processing") { _ = try B.selected(context: c, contextRefs: Array(repeating: aid, count: 129)) }
    try check(try B.references(context: context(primary: a, sources: Array(repeating: source(a), count: 129))) == [a], "duplicate typed records do not spend distinct source slots")
    let notOnDisk = SourceReference(kind: .snapshot, id: UUID(), sha256: one)
    let own = try context(primary: notOnDisk)
    try check(try B.selected(context: own, contextRefs: [B.id(reference: notOnDisk)]) == [notOnDisk], "pure selection asserts identity, not file existence or source availability")
    print("RCC bound source input: \(count) checks PASS; pure typed handoff only; filesystem/native/model calls0")
}
