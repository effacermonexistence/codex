import Foundation
import OS1Context

/// Uses only a caller-owned private fixture directory, never live provider or
/// unrelated application data. These are actual deterministic store round trips.
func runEpisodicMemoryFixtures(root: URL) throws {
    let fixture = root.appendingPathComponent("episodic-fixtures-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: fixture) }
    let store = EpisodicMemoryStore(root: fixture)
    let scope = EpisodicMemoryScope(threadID: "thread-A", projectID: "project-A", entityID: "Sébastien", objectID: "decision-A")
    let t1 = Date(timeIntervalSince1970: 1_800_000_000), t2 = t1.addingTimeInterval(10), t3 = t2.addingTimeInterval(10)
    var checks = 0
    func check(_ value: @autoclosure () throws -> Bool, _ description: String) throws {
        guard try value() else { throw NSError(domain: "EpisodicMemoryFixture", code: 1,
                                               userInfo: [NSLocalizedDescriptionKey: description]) }
        checks += 1
    }
    func fails(_ description: String, _ body: () throws -> Void) throws {
        do { try body() } catch { checks += 1; return }
        throw NSError(domain: "EpisodicMemoryFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: description])
    }
    func metadata(_ id: String, at: Date = t1, scope override: EpisodicMemoryScope? = nil,
                  kind: EpisodicMemoryRecordKind = .state, value: String? = nil,
                  correction: EpisodicMemoryCorrection? = nil, exact: Bool = true,
                  parents: [String] = [], speaker: String = "user") -> EpisodicMemoryMetadata {
        EpisodicMemoryMetadata(sourceSessionID: "session-A", sourceMessageID: id, timestamp: at,
            speaker: speaker, scope: override ?? scope, kind: kind, exact: exact,
            assertion: value.map { EpisodicMemoryAssertion(field: "choice", value: $0) }, correction: correction,
            derivedFrom: parents, confidence: exact ? nil : "derived-not-evidence")
    }
    let aText = "Original A. Exact quote: \"do not send\".\r\n  Preserve whitespace.\n"
    let a = try store.record(text: aText, metadata: metadata("message-A", value: "A"), now: t1)
    let bText = "Correction B: keep private. 92/128 → 60/128."
    let b = try store.record(text: bText, metadata: metadata("message-B", at: t2, kind: .correction, value: "B",
        correction: .init(supersedes: [a.versionID], authority: .explicitUser, evidenceID: "message-B")), now: t2)

    // TEST 1 / 4: explicit correction wins before lexical similarity. The old
    // source repeats the search term; B does not and still remains the latest.
    let latest = try store.query(.init(kind: .latestState, scope: scope, text: "Original A"), now: t3)
    try check(latest.hits.map(\.item.versionID) == [b.versionID], "current state must page B, not high-similarity A")
    try check(latest.hits.first?.text == bText && latest.hits.first?.current == true, "B is exact current evidence")
    try check(try store.read(a) == Data(aText.utf8), "supersession never deletes A")

    // TEST 2: historical replay at T1 has an independent time-bound state.
    let historical = try store.query(.init(kind: .historicalState, scope: scope, asOf: t1), now: t3)
    try check(historical.hits.map(\.item.versionID) == [a.versionID], "historical query restores A at T1")
    let allHistory = try store.query(.init(kind: .historicalState, scope: scope), now: t3)
    try check(allHistory.hits.map(\.item.versionID) == [a.versionID, b.versionID], "full history retains temporal order")
    try check(allHistory.hits.first?.supersededBy == [b.versionID], "historical A reports exact superseding source")

    // TEST 3: quotes preserve literal source bytes including CRLF and spaces.
    let quote = try store.query(.init(kind: .exactQuote, scope: scope, sourceMessageID: "message-A"), now: t3)
    try check(quote.hits.first?.text == aText, "exact quote cannot be a summary")
    try check(quote.hits.first?.item.rawSHA256 == SourceContextStore.digest(Data(aText.utf8)), "quote provenance is hash-bound")

    // TEST 5: a separately stored numeric result survives summary/cache creation.
    let numericScope = EpisodicMemoryScope(threadID: scope.threadID, projectID: scope.projectID,
                                          entityID: scope.entityID, objectID: "benchmark-utility")
    let numericText = "baseline=92/128; final=60/128; delta=-32; commit=0123456789abcdef0123456789abcdef01234567; permission=NOT APPROVED"
    let numeric = try store.record(text: numericText,
        metadata: metadata("numeric-A", scope: numericScope, kind: .numericResult), now: t1)
    _ = try store.record(text: "Utility decreased", metadata: metadata("numeric-cache", at: t2, scope: numericScope,
        kind: .derivedCache, exact: false, parents: [numeric.versionID]), now: t2)
    let numberResult = try store.query(.init(kind: .numericResult, scope: numericScope), now: t3)
    try check(numberResult.hits.first?.text == numericText, "exact numeric state remains independently retrievable")
    try check(numberResult.hits.allSatisfy(\.item.metadata.exact), "derived text never replaces raw numeric evidence")

    // TEST 6: deterministic page-in at a missing dependency. Real execution
    // continuation/MCP coverage is wired by the runtime integration fixtures.
    var working: [String: String] = [:], pageFault = false, resumed = false
    if working["decision-A"] == nil {
        pageFault = true
        let page = try store.query(.init(kind: .latestState, scope: scope), now: t3)
        if !page.unknown { working["decision-A"] = page.hits.first?.text; resumed = true }
    }
    try check(pageFault && resumed && working["decision-A"] == bText, "missing dependency pages exact source then continues")

    // TEST 7: failed retrieval produces UNKNOWN, never a predicted source.
    let absentScope = EpisodicMemoryScope(threadID: scope.threadID, projectID: scope.projectID,
                                         entityID: scope.entityID, objectID: "absent-object")
    let missing = try store.query(.init(kind: .latestState, scope: absentScope), now: t3)
    try check(missing.unknown && missing.hits.isEmpty && missing.injectionText == "UNKNOWN", "missing source stays UNKNOWN")

    // TEST 8: same human name in another thread/object is not an alias bridge.
    let otherScope = EpisodicMemoryScope(threadID: "thread-B", projectID: scope.projectID,
                                        entityID: scope.entityID, objectID: scope.objectID)
    _ = try store.record(text: "Other thread: disclose", metadata: metadata("other-thread", at: t3, scope: otherScope), now: t3)
    let anotherObject = EpisodicMemoryScope(threadID: scope.threadID, projectID: scope.projectID,
                                           entityID: scope.entityID, objectID: "decision-B")
    _ = try store.record(text: "Other object: disclose", metadata: metadata("other-object", at: t3, scope: anotherObject), now: t3)
    let isolated = try store.query(.init(kind: .latestState, scope: scope), now: t3)
    try check(isolated.hits.map(\.item.versionID) == [b.versionID], "thread/object identities cannot mix")
    try fails("cross-object correction must fail") {
        _ = try store.record(text: "Cross-scope correction", metadata: metadata("cross-correction", at: t3, scope: anotherObject,
            correction: .init(supersedes: [b.versionID], authority: .explicitUser, evidenceID: "cross-correction")))
    }
    try fails("assistant output cannot claim explicit user correction authority") {
        _ = try store.record(text: "I correct user", metadata: metadata("fake-correction", at: t3,
            correction: .init(supersedes: [b.versionID], authority: .explicitUser, evidenceID: "fake-correction"), speaker: "assistant"))
    }
    try fails("same timestamp cannot manufacture ordering") {
        _ = try store.record(text: "Unknown order", metadata: metadata("same-time", at: t2,
            correction: .init(supersedes: [b.versionID], authority: .explicitUser, evidenceID: "same-time")))
    }

    // TEST 9: old massive context is archived whole and kept outside injection.
    let longScope = EpisodicMemoryScope(threadID: scope.threadID, projectID: scope.projectID, objectID: "long-tool-result")
    let massive = String(repeating: "irrelevant παρελθόν 과거\n", count: 80_000)
    let huge = try store.record(text: massive, metadata: metadata("huge", scope: longScope, kind: .toolResult), now: t1)
    try check(try store.read(huge) == Data(massive.utf8), "large old original losslessly survives")
    let bounded = try store.query(.init(kind: .currentObjectState, scope: scope, budgetTokens: 2_000, budgetBytes: 2_000), now: t3)
    try check(bounded.injectionText.utf8.count <= 2_000 && bounded.receipt.tokenUpperBound <= 2_000, "inclusive evidence budget enforced")
    try check(bounded.hits.first?.item.versionID == b.versionID, "small relevant evidence fits without bringing old context")
    try check(!bounded.injectionText.contains("παρελθόν"), "irrelevant historical original never fills current context")
    let chunks = try store.query(.init(kind: .exactQuote, scope: longScope, text: "παρελθόν", budgetTokens: 6_000, budgetBytes: 6_000, maximumHits: 1), now: t3)
    try check(chunks.hits.count == 1 && chunks.receipt.omissions.contains(where: { $0.reason == "context_budget" }), "long exact source pages whole ranges with omission pointers")
    let chunk = chunks.hits[0]
    try check(Data(chunk.text.utf8) == Data(massive.utf8).subdata(in: chunk.byteStart..<chunk.byteEnd), "chunk preserves exact original byte range")
    let boundaryScope = EpisodicMemoryScope(threadID: scope.threadID, projectID: scope.projectID, objectID: "boundary")
    let boundaryText = String(repeating: "x", count: EpisodicMemoryStore.chunkBytes - 4) + "boundary needle" + String(repeating: "y", count: 20)
    _ = try store.record(text: boundaryText, metadata: metadata("boundary", scope: boundaryScope, kind: .toolResult))
    let boundary = try store.query(.init(kind: .exactQuote, scope: boundaryScope, text: "boundary needle", budgetTokens: 12_000, budgetBytes: 12_000))
    try check(boundary.hits.count == 2 && boundary.hits.map(\.text).joined() == boundaryText,
              "search term crossing pages does not create a false UNKNOWN")
    let genericNumericScope = EpisodicMemoryScope(threadID: scope.threadID, projectID: scope.projectID, objectID: "untyped-tool-numbers")
    _ = try store.record(text: "Exact result 92/128 -> 60/128", metadata: metadata("tool-numbers", scope: genericNumericScope, kind: .toolResult))
    try check(try store.query(.init(kind: .numericResult, scope: genericNumericScope)).hits.first?.text == "Exact result 92/128 -> 60/128",
              "numbers in a raw tool result do not require lossy summary reclassification")

    // TEST 10: a wrong summary cannot override raw B; audit cache mismatch.
    _ = try store.record(text: "Summary wrongly says A", metadata: metadata("wrong-cache", at: t3, kind: .derivedCache,
        value: "A", exact: false, parents: [a.versionID]), now: t3)
    let reconstructed = try store.query(.init(kind: .latestState, scope: scope), now: t3)
    try check(reconstructed.hits.map(\.item.versionID) == [b.versionID], "raw latest correction reconstructs authoritative state")
    try check(reconstructed.receipt.conflicts.contains(where: { $0.code == "derived_cache_rollback" }), "cache rollback has explicit receipt")

    // Replay is locked to earlier exact evidence even after a new correction.
    let c = try store.record(text: "Correction C", metadata: metadata("message-C", at: t3, kind: .correction, value: "C",
        correction: .init(supersedes: [b.versionID], authority: .explicitUser, evidenceID: "message-C")), now: t3)
    try check(try store.replay(latest.receiptReference).injectionText == latest.injectionText, "historical receipt replays B, not current C")
    try check(try store.query(.init(kind: .latestState, scope: scope)).hits.first?.item.versionID == c.versionID, "fresh query follows chained correction")

    // New bytes under an existing source identity append a conflict version.
    let revised = try store.record(text: "Different bytes under C ID", metadata: metadata("message-C", at: t3, value: "not-C"), now: t3)
    try check(revised.versionID != c.versionID && (try store.read(c)) == Data("Correction C".utf8), "same-ID change preserves immutable originals")
    let revisionConflict = try store.query(.init(kind: .latestState, scope: scope))
    try check(revisionConflict.unknown && revisionConflict.receipt.conflicts.contains(where: { $0.code == "immutable_identity_revision_conflict" }), "ambiguous revision cannot become latest authority")

    // Unknown chronology is never silently assigned capture time.
    let undatedScope = EpisodicMemoryScope(threadID: "undated", objectID: "item")
    _ = try store.record(text: "undated", metadata: .init(sourceSessionID: "s", sourceMessageID: "m", speaker: "user", scope: undatedScope, kind: .state))
    try check(try store.query(.init(kind: .latestState, scope: undatedScope)).unknown, "UNKNOWN event timestamp cannot rank as latest")

    // Private opaque source is archived but never exposed to a query.
    let opaqueScope = EpisodicMemoryScope(threadID: "opaque", objectID: "native")
    let opaque = try store.record(text: "PRIVATE HIDDEN REASONING", metadata: metadata("opaque", scope: opaqueScope, kind: .opaqueArchive))
    try check(try store.read(opaque) == Data("PRIVATE HIDDEN REASONING".utf8), "opaque native original remains private evidence")
    try check(try store.query(.init(kind: .thread, scope: opaqueScope)).unknown, "opaque native hidden material cannot be paged into model")

    // Provenance validation and no stale resurrection after corrupt correction.
    let damageScope = EpisodicMemoryScope(threadID: "damage", objectID: "state")
    let original = try store.record(text: "Old state", metadata: metadata("damage-A", scope: damageScope, value: "A"))
    let corrected = try store.record(text: "New state", metadata: metadata("damage-B", at: t2, scope: damageScope,
        kind: .correction, value: "B", correction: .init(supersedes: [original.versionID], authority: .explicitUser, evidenceID: "damage-B")))
    try Data("Corrupted".utf8).write(to: store.originalURL(for: corrected))
    try fails("mismatched hash read must fail") { _ = try store.read(corrected) }
    let damaged = try store.query(.init(kind: .latestState, scope: damageScope))
    try check(damaged.unknown && damaged.receipt.omissions.contains(where: { $0.reason == "provenance_failure" }), "corrupt correction cannot resurrect stale A")
    try fails("replay must reject damaged original") { _ = try store.replay(chunks.receiptReference).hits.map { try store.read($0.item) }; try Data("bad".utf8).write(to: store.originalURL(for: huge)); _ = try store.replay(chunks.receiptReference) }

    // Whole-byte storage validates declared original provenance at capture.
    var wrongHash = metadata("wrong-hash")
    wrongHash.provenance.sha256 = String(repeating: "0", count: 64)
    try fails("declared provenance mismatch cannot be captured") { _ = try store.record(text: "raw", metadata: wrongHash) }
    let reopened = EpisodicMemoryStore(root: fixture)
    try check(try reopened.inventory().contains(where: { $0.versionID == a.versionID }), "new store/session resolves persistent evidence")
    let batchScope = EpisodicMemoryScope(threadID: "batch-thread", objectID: "batch-object")
    let batchInputs = (0..<200).map { index in
        (raw: Data("Exact batch message \(index)\n".utf8), metadata: metadata("batch-\(index)", scope: batchScope, kind: .userMessage))
    }
    let batch = try reopened.recordBatch(batchInputs, now: t1)
    let batchReplay = try reopened.recordBatch(batchInputs, now: t3)
    try check(batch.count == 200 && batchReplay == batch, "batch capture is idempotent and does not alter capture time")
    try check(try reopened.inventory().filter { $0.metadata.scope == batchScope }.count == 200,
              "one verified batch appends each distinct immutable record once")
    try check(try reopened.recordBatch([]).isEmpty, "empty batch does not invent records")
    let batchCorrection = try reopened.recordBatch([(raw: Data("Batch correction".utf8), metadata: metadata("batch-corrected", at: t2,
        scope: batchScope, kind: .correction, correction: .init(supersedes: [batch[0].versionID], authority: .explicitUser, evidenceID: "batch-corrected")))])
    try check(batchCorrection.count == 1 && (try reopened.read(batch[0])) == batchInputs[0].raw,
              "batch correction retains the same exact authority and provenance gates")
    var badBatchMetadata = metadata("bad-batch", at: t3, scope: batchScope)
    badBatchMetadata.correction = .init(supersedes: [batch[1].versionID], authority: .explicitUser, evidenceID: "wrong-source-id")
    try fails("batch cannot weaken evidence-ID binding") {
        _ = try reopened.recordBatch([(raw: Data("bad".utf8), metadata: badBatchMetadata)])
    }
    let literalScope = EpisodicMemoryScope(threadID: "literal-history", objectID: "record")
    _ = try reopened.record(text: "Alice introduced Bob. Rejected path Z remains an open question?",
        metadata: metadata("literal-record", scope: literalScope, kind: .userMessage))
    for kind: EpisodicMemoryQueryKind in [.entityRelation, .rejectedPath, .openQuestion] {
        let empty = try reopened.query(.init(kind: kind, scope: literalScope))
        try check(empty.unknown, "untyped \(kind.rawValue) cannot invent semantic authority without explicit text")
        let literal = try reopened.query(.init(kind: kind, scope: literalScope, text: "Bob"))
        try check(literal.hits.count == 1 && literal.hits[0].item.metadata.kind == .userMessage && !literal.hits[0].current,
                  "literal fallback preserves historical source classification for \(kind.rawValue)")
        try check(literal.hits[0].retrievalReason.contains("UNCLASSIFIED_HISTORICAL_LITERAL_MATCH"),
                  "literal fallback must not imply typed relation/rejection/open-question status")
    }
    let lineageScope = EpisodicMemoryScope(threadID: "lineage-history", objectID: "native")
    let lineageParent = try reopened.record(text: "PRIVATE_PARENT_BODY", metadata: metadata("lineage-parent", at: t3, scope: lineageScope, kind: .opaqueArchive))
    let lineageChild = try reopened.record(text: "VISIBLE_EXACT_CHILD 60/128",
        metadata: metadata("lineage-child", at: t2, scope: lineageScope, kind: .toolResult, parents: [lineageParent.versionID]))
    let lineagePage = try reopened.query(.init(kind: .exactQuote, scope: lineageScope, sourceMessageID: "lineage-child", asOf: t2))
    try check(lineagePage.hits.count == 1 && !lineagePage.injectionText.contains("PRIVATE_PARENT_BODY"),
              "later-collected private ancestry authenticates earlier event without time projection or hidden-body injection")
    try Data("CORRUPTED_PARENT".utf8).write(to: reopened.originalURL(for: lineageParent))
    try check(try reopened.read(lineageChild) == Data("VISIBLE_EXACT_CHILD 60/128".utf8),
              "corrupt ancestry never destroys an independently preserved child original")
    let brokenLineage = try reopened.query(.init(kind: .exactQuote, scope: lineageScope, sourceMessageID: "lineage-child"))
    try check(brokenLineage.unknown && brokenLineage.receipt.omissions.contains(where: {
        $0.versionID == lineageChild.versionID && $0.reason == "provenance_lineage_failure"
    }), "exact descendant cannot be adopted after its required parent is corrupt")
    try fails("replay rejects a formerly valid page when required parent provenance breaks") {
        _ = try reopened.replay(lineagePage.receiptReference)
    }
    try fails("capture cannot mint a phantom/self ancestor instead of an existing immutable version") {
        _ = try reopened.record(text: "phantom parent", metadata: metadata("phantom-lineage", scope: lineageScope,
            kind: .toolResult, parents: [String(repeating: "f", count: 64)]))
    }
    let missingStore = EpisodicMemoryStore(root: fixture.appendingPathComponent("missing-parent"))
    let missingScope = EpisodicMemoryScope(threadID: "missing-parent", objectID: "native")
    let removableParent = try missingStore.record(text: "private", metadata: metadata("missing-parent", scope: missingScope, kind: .opaqueArchive))
    let orphan = try missingStore.record(text: "orphan exact source", metadata: metadata("orphan", at: t2, scope: missingScope,
        kind: .toolResult, parents: [removableParent.versionID]))
    // Model a partial restored ledger: files exist, but parent authority is not
    // in its checked inventory. No filesystem search may invent that relation.
    let ledger = try Data(contentsOf: missingStore.indexURL)
    var restoredLedger = Data()
    for line in ledger.split(separator: 10) {
        let entry = try JSONSerialization.jsonObject(with: Data(line)) as! [String: Any]
        if entry["versionID"] as? String != removableParent.versionID { restoredLedger += Data(line); restoredLedger.append(10) }
    }
    try restoredLedger.write(to: missingStore.indexURL)
    let orphanPage = try missingStore.query(.init(kind: .exactQuote, scope: missingScope, sourceMessageID: "orphan"))
    try check(orphanPage.unknown && orphanPage.receipt.omissions.contains(where: { $0.versionID == orphan.versionID }),
              "missing indexed ancestor quarantines the exact descendant without private file discovery")
    let deepScope = EpisodicMemoryScope(threadID: "bounded-lineage", objectID: "record")
    var ancestor = try reopened.record(text: "private root", metadata: metadata("deep-0", scope: deepScope, kind: .opaqueArchive))
    for index in 1...(EpisodicMemoryStore.maximumLineageDepth + 1) {
        ancestor = try reopened.record(text: "exact node \(index)", metadata: metadata("deep-\(index)", scope: deepScope,
            kind: .toolResult, parents: [ancestor.versionID]))
    }
    try check(try reopened.query(.init(kind: .exactQuote, scope: deepScope,
        sourceMessageID: "deep-\(EpisodicMemoryStore.maximumLineageDepth + 1)")).unknown,
              "ancestry traversal is bounded rather than recursively trusting arbitrarily deep lineage")
    for kind in EpisodicMemoryQueryKind.allCases {
        let result = try reopened.query(.init(kind: kind, scope: scope, budgetTokens: 8_000, budgetBytes: 8_000))
        try check(result.receipt.query.kind == kind && result.injectionText.utf8.count <= 8_000, "typed query \(kind.rawValue) has bounded receipt")
    }
    print("PASS Episodic memory: \(checks) deterministic checks")
}
