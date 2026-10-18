import Darwin
import Foundation
import OS1Context

// Only synthetic data in caller-owned temporary roots; no live history/model.
func memoryWriteTransactionChildIfRequested() throws -> Bool {
    guard CommandLine.arguments.contains("--memory-write-transaction-child") else { return false }
    guard CommandLine.arguments.count == 4 else { throw EpisodicMemoryError.invalidMetadata }
    let root = URL(fileURLWithPath: CommandLine.arguments[2]), marker = URL(fileURLWithPath: CommandLine.arguments[3])
    guard root.path.hasPrefix(NSTemporaryDirectory()), marker.path.hasPrefix(root.path + "/") else { throw EpisodicMemoryError.unsafePath }
    let lock = root.appendingPathComponent("episodic-memory/.lock")
    let fd = open(lock.path, O_RDWR | O_NOFOLLOW | O_CLOEXEC)
    guard fd >= 0 else { throw EpisodicMemoryError.unsafePath }; defer { close(fd) }
    guard flock(fd, LOCK_EX | LOCK_NB) != 0 && errno == EWOULDBLOCK else { throw EpisodicMemoryError.invalidWriteTransaction }
    try Data("blocked".utf8).write(to: marker)
    _ = try EpisodicMemoryStore(root: root).record(text: "external writer exact", metadata: .init(sourceSessionID: "other", sourceMessageID: "external", speaker: "user", scope: .init(threadID: "other"), kind: .userMessage))
    try Data("done".utf8).write(to: marker.appendingPathExtension("done"))
    return true
}

func runMemoryWriteTransactionFixtures(largeBenchmark: Bool = false) throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-memory-writer-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }
    var checks = 0
    func check(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try value() else { throw NSError(domain: "MemoryWriteTransaction", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }; checks += 1
    }
    func fails(_ message: String, _ body: () throws -> Void) throws {
        do { try body() } catch { checks += 1; return }
        throw NSError(domain: "MemoryWriteTransaction", code: 2, userInfo: [NSLocalizedDescriptionKey: message])
    }
    let time = Date(timeIntervalSince1970: 1_800_000_000)
    func meta(_ id: String, parents: [String] = [], exact: Bool = true) -> EpisodicMemoryMetadata {
        .init(sourceSessionID: "session", sourceMessageID: id, timestamp: time, speaker: exact ? "user" : "OS-1 derived state",
              scope: .init(threadID: "session", projectID: "project"), kind: exact ? .userMessage : .derivedCache,
              exact: exact, derivedFrom: parents)
    }
    let store = EpisodicMemoryStore(root: root.appendingPathComponent("lifetime"))
    var escaped: EpisodicMemoryStore.WriteTransaction?
    try store.withWriteTransaction(now: time) { writer in
        escaped = writer
        try check(writer.statistics.inventoryLoads == 1 && writer.statistics.validatedInventoryItems == 0, "actual empty inventory load is observed")
        let a = try writer.record(text: "exact A\r\n  keep whitespace\n", metadata: meta("A"))
        let b = try writer.record(text: "derived", metadata: meta("B", parents: [a.versionID], exact: false))
        try check(b.metadata.derivedFrom == [a.versionID], "same-transaction parent is available without rescanning")
    }
    try fails("escaped writer must be revoked after normal return") { _ = try escaped!.record(text: "forbidden", metadata: meta("escaped")) }
    try fails("throwing callback preserves rejection") {
        try store.withWriteTransaction(now: time) { writer in
            escaped = writer
            _ = try writer.record(text: "durable before error", metadata: meta("partial"))
            _ = try writer.record(text: "missing parent", metadata: meta("bad", parents: [String(repeating: "0", count: 64)], exact: false))
        }
    }
    try fails("escaped writer must be revoked after throw") { _ = try escaped!.record(text: "forbidden", metadata: meta("escaped-throw")) }
    try check(try store.inventory().contains { $0.metadata.sourceMessageID == "partial" }, "earlier fsynced write survives later invalid item")
    try check(try store.inventory().allSatisfy { $0.metadata.sourceMessageID != "bad" }, "invalid child is never appended")
    final class CrossThread: @unchecked Sendable {
        var writer: EpisodicMemoryStore.WriteTransaction?
        let finished = DispatchSemaphore(value: 0)
        var rejected = false
    }
    let cross = CrossThread()
    try store.withWriteTransaction { writer in
        cross.writer = writer
        Thread.detachNewThread {
            defer { cross.finished.signal() }
            do { _ = try cross.writer!.record(text: "wrong thread", metadata: .init(sourceSessionID: "x", sourceMessageID: "x", speaker: "user", scope: .init(threadID: "x"), kind: .userMessage)) }
            catch EpisodicMemoryError.invalidWriteTransaction { cross.rejected = true }
            catch { }
        }
        try check(cross.finished.wait(timeout: .now() + 5) == .success && cross.rejected, "cross-thread writer is rejected before access")
    }
    try store.withWriteTransaction { _ in
        try fails("public reentrant record is rejected rather than deadlocking") { _ = try store.record(text: "nested", metadata: meta("nested")) }
        try fails("public reentrant inventory is rejected rather than deadlocking") { _ = try store.inventory() }
        let independent = EpisodicMemoryStore(root: root.appendingPathComponent("different-root"))
        _ = try independent.record(text: "separate exact root", metadata: meta("separate"))
        try check(try independent.inventory().count == 1, "different root remains usable inside lexical callback")
    }
    // Corruption cannot be washed by an in-transaction dedup hit.
    let rawStore = EpisodicMemoryStore(root: root.appendingPathComponent("raw-corrupt"))
    let rawItem = try rawStore.record(text: "original", metadata: meta("raw"))
    try fails("dedup still checks exact touched raw bytes") {
        try rawStore.withWriteTransaction { writer in
            try Data("corrupt!".utf8).write(to: rawStore.originalURL(for: rawItem))
            _ = try writer.record(text: "original", metadata: meta("raw"))
        }
    }
    let corrupt = EpisodicMemoryStore(root: root.appendingPathComponent("metadata-corrupt"))
    let item = try corrupt.record(text: "item", metadata: meta("metadata"))
    try Data("{}".utf8).write(to: corrupt.recordURL(versionID: item.versionID))
    try fails("complete metadata inventory verification remains mandatory") { try corrupt.withWriteTransaction { _ in } }
    let duplicate = EpisodicMemoryStore(root: root.appendingPathComponent("duplicate-corrupt"))
    let d = try duplicate.record(text: "duplicate", metadata: meta("duplicate"))
    let badDuplicate = try JSONSerialization.data(withJSONObject: ["versionID": d.versionID, "recordSHA256": String(repeating: "0", count: 64)]) + Data([10])
    let append = try FileHandle(forWritingTo: duplicate.indexURL); try append.seekToEnd(); try append.write(contentsOf: badDuplicate); try append.close()
    try fails("even duplicate metadata rows are verified before dedup") { try duplicate.withWriteTransaction { _ in } }
    let positiveDuplicate = EpisodicMemoryStore(root: root.appendingPathComponent("duplicate-valid"))
    _ = try positiveDuplicate.record(text: "duplicate", metadata: meta("duplicate"))
    let duplicateLine = try Data(contentsOf: positiveDuplicate.indexURL)
    let duplicateAppend = try FileHandle(forWritingTo: positiveDuplicate.indexURL); try duplicateAppend.seekToEnd(); try duplicateAppend.write(contentsOf: duplicateLine); try duplicateAppend.close()
    try positiveDuplicate.withWriteTransaction { writer in
        try check(writer.statistics.inventoryLoads == 1 && writer.statistics.validatedInventoryItems == 2, "real metadata counter counts both valid duplicate ledger lines before dedup")
    }
    let truncated = EpisodicMemoryStore(root: root.appendingPathComponent("truncated-index"))
    _ = try truncated.record(text: "entry", metadata: meta("entry"))
    var incomplete = try Data(contentsOf: truncated.indexURL); incomplete.removeLast(); try incomplete.write(to: truncated.indexURL)
    try fails("truncated ledger fails before writer is offered") { try truncated.withWriteTransaction { _ in } }
    let symlink = EpisodicMemoryStore(root: root.appendingPathComponent("symlink"))
    let linked = try symlink.record(text: "link", metadata: meta("link"))
    let outside = root.appendingPathComponent("outside.raw"); try Data("link".utf8).write(to: outside)
    try FileManager.default.removeItem(at: symlink.originalURL(for: linked)); try FileManager.default.createSymbolicLink(at: symlink.originalURL(for: linked), withDestinationURL: outside)
    try fails("same-transaction write cannot adopt symlinked raw") { try symlink.withWriteTransaction { writer in _ = try writer.record(text: "link", metadata: meta("link")) } }

    // An actual second process proves the existing flock remains the only
    // writer boundary. It first proves EWOULDBLOCK, then waits in public record.
    let sharedRoot = root.appendingPathComponent("cross-process"), shared = EpisodicMemoryStore(root: sharedRoot)
    let marker = sharedRoot.appendingPathComponent("child-blocked"), child = Process()
    child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    child.arguments = ["--memory-write-transaction-child", sharedRoot.path, marker.path]
    child.standardOutput = FileHandle.nullDevice; child.standardError = FileHandle.nullDevice
    try shared.withWriteTransaction { writer in
        _ = try writer.record(text: "parent before child", metadata: meta("parent"))
        try child.run()
        let deadline = Date().addingTimeInterval(10)
        while !FileManager.default.fileExists(atPath: marker.path) && child.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
        try check(FileManager.default.fileExists(atPath: marker.path) && child.isRunning && !FileManager.default.fileExists(atPath: marker.appendingPathExtension("done").path), "external process proves blocked on original flock")
        _ = try writer.record(text: "parent after blocked", metadata: meta("parent-2"))
    }
    let childDeadline = Date().addingTimeInterval(10)
    while child.isRunning && Date() < childDeadline { Thread.sleep(forTimeInterval: 0.01) }
    if child.isRunning { child.terminate(); child.waitUntilExit() }
    try check(child.terminationStatus == 0 && FileManager.default.fileExists(atPath: marker.appendingPathExtension("done").path), "external writer finishes only after original transaction ends")
    try shared.withWriteTransaction { writer in
        try check(writer.statistics.validatedInventoryItems == 3, "next transaction includes external process's committed record")
    }

    // Exact operation sequence: four old independent inventories per handoff
    // versus one lexical inventory; raw/metadata/version/parent identities match.
    let oldStore = EpisodicMemoryStore(root: root.appendingPathComponent("old-sequence"))
    let newStore = EpisodicMemoryStore(root: root.appendingPathComponent("new-sequence"))
    var oldLoads = 0, newLoads = 0, oldIDs: [String] = [], newIDs: [String] = []
    for _ in 0..<2 {
        func oldRecord(_ text: String, _ metadata: EpisodicMemoryMetadata) throws -> EpisodicMemoryItem {
            try oldStore.withWriteTransaction(now: time) { writer in oldLoads += writer.statistics.inventoryLoads; return try writer.record(text: text, metadata: metadata) }
        }
        let a = try oldRecord("original A", meta("a")); let b = try oldRecord("exact envelope", meta("envelope"))
        let c = try oldRecord("state", meta("state")); let d = try oldRecord("state", meta("cache", parents: [c.versionID], exact: false))
        oldIDs += [a,b,c,d].map(\.versionID)
        try newStore.withWriteTransaction(now: time) { writer in
            newLoads += writer.statistics.inventoryLoads
            let a = try writer.record(text: "original A", metadata: meta("a")); let b = try writer.record(text: "exact envelope", metadata: meta("envelope"))
            let c = try writer.record(text: "state", metadata: meta("state")); let d = try writer.record(text: "state", metadata: meta("cache", parents: [c.versionID], exact: false))
            newIDs += [a,b,c,d].map(\.versionID)
        }
    }
    try check(oldLoads == 8 && newLoads == 2, "measured inventory entry counters reduce 8 to 2 across two unchanged handoffs")
    try check(oldIDs == newIDs, "same raw/metadata inputs keep exact version and parent identities")
    let oldItems = try oldStore.inventory(), newItems = try newStore.inventory()
    try check(oldItems == newItems, "same capturedAt, metadata, provenance, lineage and hashes survive batching")
    for (old,new) in zip(oldItems,newItems) { try check(try oldStore.read(old) == newStore.read(new), "immutable raw bytes are identical") }

    let combinedRoot = root.appendingPathComponent("combined"), sessionID = UUID(), session = sessionID.uuidString.lowercased(), peer = UUID().uuidString.lowercased()
    let workspace = root.appendingPathComponent("workspace").path
    var task = TaskContext.migrated(conversationID: sessionID, request: "Keep UNKNOWN; do not send.", workspace: workspace, sourceContext: nil, codexSessionID: nil, claudeSessionID: nil)
    task.decideSemantic("decision: mode=A"); task.decideSemantic("correction: mode=B")
    let owners: [MemoryPagingOwnerMessage] = [.init(id: "owner-A", text: "decision: mode=A", timestamp: time), .init(id: "owner-B", text: "correction: mode=B", timestamp: time.addingTimeInterval(10))]
    let captures = owners.map { MemoryPaging.Capture(sessionID: session, messageID: $0.id, speaker: "user", raw: Data($0.text.utf8), timestamp: $0.timestamp) }
    let envelope = Data("{\"messages\":[\"EXACT\"],\"secret\":\"not model evidence\"}".utf8)
    var combinedLoads = 0
    for _ in 0..<2 {
        let ref = try MemoryPaging.captureHandoff(captures, conversationRaw: envelope, sessionID: session, workspace: workspace, messageCount: owners.count,
            allowedSessionIDs: [session,peer], context: task, ownerMessages: owners, root: combinedRoot) { combinedLoads += $0.inventoryLoads }
        try check(ref.allowedSessionIDs == [session,peer] && ref.archivedMessages == 2, "capability membership and original message count remain exact")
        let manifest = try MemoryPaging.prepare(reference: ref, executionID: UUID().uuidString, root: combinedRoot)
        try check(manifest.allowedSessionIDs == [session,peer], "produced receipt authenticates same original scope")
    }
    try check(combinedLoads == 2, "real combined MemoryPaging API opens one fresh inventory per invocation")
    let combined = MemoryPaging.store(root: combinedRoot)
    let current = try combined.query(.init(kind: .latestState, scope: .init(threadID: session, projectID: MemoryPaging.projectID(workspace: workspace), objectID: "decision-field:mode")))
    try check(current.hits.first?.text == owners[1].text && current.hits.first?.item.metadata.sourceMessageID == "owner-B", "explicit correction source and supersession remain queryable")
    let derived = try combined.inventory().filter { $0.metadata.kind == .derivedCache }
    try check(!derived.isEmpty && derived.allSatisfy { !$0.metadata.exact && !$0.metadata.derivedFrom.isEmpty }, "task state remains derived and linked, not promoted to original evidence")
    try check(try combined.inventory().contains { $0.metadata.kind == .opaqueArchive && (try? combined.read($0)) == envelope }, "complete original envelope is preserved")

    if largeBenchmark {
        let big = EpisodicMemoryStore(root: root.appendingPathComponent("synthetic-10k"))
        let seed = (0..<10_000).map { (raw: Data("synthetic exact source".utf8), metadata: meta("seed-\($0)")) }
        let started = Date(); _ = try big.recordBatch(seed, now: time)
        let seedSeconds = Date().timeIntervalSince(started)
        var oldPasses = 0, newPasses = 0
        let oldStart = Date()
        for i in 0..<8 { try big.withWriteTransaction { writer in oldPasses += writer.statistics.inventoryLoads; _ = try writer.record(text: "synthetic exact source", metadata: meta("seed-\(i)")) } }
        let oldSeconds = Date().timeIntervalSince(oldStart), newStart = Date()
        for wave in 0..<2 { try big.withWriteTransaction { writer in
            newPasses += writer.statistics.inventoryLoads
            for i in 0..<4 { _ = try writer.record(text: "synthetic exact source", metadata: meta("seed-\(wave*4+i)")) }
        } }
        let newSeconds = Date().timeIntervalSince(newStart)
        try check(oldPasses == 8 && newPasses == 2 && (try big.inventory()).count == 10_000, "10k synthetic ledger remains complete with measured 8-to-2 inventory loads")
        print("MEMORY_WRITE_BENCHMARK " + String(decoding: try JSONSerialization.data(withJSONObject: ["synthetic_records":10_000,"seed_seconds":seedSeconds,"old_inventory_loads":oldPasses,"new_inventory_loads":newPasses,"old_seconds":oldSeconds,"new_seconds":newSeconds], options:[.sortedKeys]), as: UTF8.self))
    }
    print("OS-1 lexical memory write transaction: \(checks) checks PASS; no live corpus or model calls")
}
