import Foundation
import OS1Context

/// End-to-end OS-1 storage/capability/working-state integration. No live account,
/// provider call, original application directory, or authentication file is used.
func runMemoryPagingIntegrationFixtures(root: URL) throws {
    let base = root.appendingPathComponent("memory-paging-integration-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: base) }
    let privateRoot = base.appendingPathComponent("private-os1")
    let workspace = base.appendingPathComponent("workspace").path
    try FileManager.default.createDirectory(at: privateRoot, withIntermediateDirectories: true)
    let conversation = UUID(), session = conversation.uuidString.lowercased(), peer = UUID().uuidString.lowercased()
    let execution = UUID().uuidString.lowercased(), nativeClaude = UUID().uuidString.lowercased(), nativeCodex = UUID().uuidString.lowercased()
    let t1 = Date(timeIntervalSince1970: 1_800_000_000), t2 = t1.addingTimeInterval(10), t3 = t2.addingTimeInterval(10)
    var count = 0
    func check(_ value: @autoclosure () throws -> Bool, _ description: String) throws {
        guard try value() else { throw NSError(domain: "MemoryPagingIntegration", code: 1,
                                               userInfo: [NSLocalizedDescriptionKey: description]) }
        count += 1
    }
    func fails(_ description: String, _ body: () throws -> Void) throws {
        do { try body() } catch { count += 1; return }
        throw NSError(domain: "MemoryPagingIntegration", code: 1, userInfo: [NSLocalizedDescriptionKey: description])
    }
    func writeConfiguration(retrieval: Int) throws {
        let config = ContextBudgetConfiguration(softContextLimitTokens: 24_000, hardContextLimitTokens: 32_000,
            retrievalBudgetTokens: retrieval, activeStateBudgetTokens: 8_000, safetyMarginTokens: 1_000,
            minimumHandoffSavingsTokens: 1_000)
        try config.validate()
        try JSONEncoder().encode(config).write(to: privateRoot.appendingPathComponent("context-budget.json"))
    }
    try writeConfiguration(retrieval: 24_000)
    let originalEnvelope = Data("{\"messages\":[\"EXACT_UI_ENVELOPE\"],\"opaque\":\"PRIVATE_ENVELOPE_SENTINEL\"}".utf8)
    let reference = try MemoryPaging.archiveConversation(raw: originalEnvelope, sessionID: session, workspace: workspace,
        messageCount: 2, allowedSessionIDs: [session, peer], root: privateRoot)
    let manifest = try MemoryPaging.prepare(reference: reference, executionID: execution, root: privateRoot)
    try check(manifest.conversationID == session && manifest.projectID == MemoryPaging.projectID(workspace: workspace),
              "archive and preparation bind exact conversation/project identity")
    try check(manifest.allowedSessionIDs == [session, peer] && manifest.retrievalBudgetTokens == 24_000,
              "capability allowlist and configurable execution budget are preserved")
    let memory = MemoryPaging.store(root: privateRoot)
    let envelope = try memory.inventory().first { $0.metadata.artifactID?.hasPrefix("conversation-envelope:") == true }!
    try check(try memory.read(envelope) == originalEnvelope, "complete conversation envelope is immutable original evidence")
    try check(try memory.query(.init(kind: .thread, scope: .init(threadID: session), text: "PRIVATE_ENVELOPE_SENTINEL")).unknown,
              "private envelope cannot become model-visible transcript evidence")

    // References cannot widen scope by changing a presentation-only property.
    let fakeProject = MemoryPagingReference(conversationID: session, projectID: "workspace:wrong", archivedMessages: 2,
        snapshot: reference.snapshot, allowedSessionIDs: [session, peer])
    try fails("tampered project cannot mint a memory capability") {
        _ = try MemoryPaging.prepare(reference: fakeProject, executionID: UUID().uuidString, root: privateRoot)
    }
    let fakeAllowlist = MemoryPagingReference(conversationID: session, projectID: reference.projectID, archivedMessages: 2,
        snapshot: reference.snapshot, allowedSessionIDs: [session, peer, UUID().uuidString.lowercased()])
    try fails("tampered eligible conversation set cannot broaden private access") {
        _ = try MemoryPaging.prepare(reference: fakeAllowlist, executionID: UUID().uuidString, root: privateRoot)
    }
    try fails("outside conversation rejected before query or budget use") {
        _ = try MemoryPaging.retrieve(manifest, kind: .thread, text: nil, sessionID: UUID().uuidString.lowercased(), root: privateRoot)
    }
    var forgedObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(manifest)) as! [String: Any]
    forgedObject["retrievalBudgetTokens"] = 1_000_000
    let forged = try JSONDecoder().decode(MemoryExecutionManifest.self, from: JSONSerialization.data(withJSONObject: forgedObject))
    try fails("execution manifest mismatch cannot override persisted budget") {
        _ = try MemoryPaging.retrieve(forged, kind: .thread, text: nil, root: privateRoot)
    }
    let codexConfig = MemoryPaging.codexOverrides(manifest, executable: "/tmp/fixture-os1")
    try check(codexConfig.contains(where: { $0.contains("os1_memory") }) && codexConfig.contains(where: { $0.contains(execution) }),
              "Codex MCP launch carries bound execution, not a model-selected root")
    let claudeConfig = try MemoryPaging.claudeConfiguration(manifest, executable: "/tmp/fixture-os1")
    try check(claudeConfig.contains("memory-mcp") && claudeConfig.contains(execution), "Claude MCP uses the same bound execution capability")
    try check(MemoryPaging.capabilityCard(manifest).contains("MEMORY_PAGE_FAULT"), "execution receives explicit on-demand page-fault route")

    // The raw source turns and TaskContext remain intact. Literal assignment
    // corrections bridge the exact field, not an inferred broad topic.
    let ownerA = MemoryPagingOwnerMessage(id: UUID().uuidString.lowercased(), text: "decision: field=A", timestamp: t1)
    let ownerB = MemoryPagingOwnerMessage(id: UUID().uuidString.lowercased(), text: "correction: field=B", timestamp: t2)
    let quoteID = UUID().uuidString.lowercased(), numericID = UUID().uuidString.lowercased()
    let quoteText = "Sent exactly: \"do not approve\".\r\n  Spaces remain."
    let numericText = "baseline=92/128; final=60/128; accepted_B=0; version=324; NOT APPROVED"
    try MemoryPaging.recordBatch([
        .init(sessionID: session, messageID: ownerA.id, speaker: "user", raw: Data(ownerA.text.utf8), timestamp: t1),
        .init(sessionID: session, messageID: ownerB.id, speaker: "user", raw: Data(ownerB.text.utf8), timestamp: t2),
        .init(sessionID: session, messageID: quoteID, speaker: "assistant", raw: Data(quoteText.utf8), timestamp: t1),
        .init(sessionID: session, messageID: numericID, speaker: "user", raw: Data(numericText.utf8), timestamp: t3)
    ], workspace: workspace, root: privateRoot)
    var task = TaskContext(conversationID: conversation,
        objective: .init(requestText: "CURRENT_REQUEST_UNIQUE_TOKEN", completionConditions: ["verified receipt"],
                         scope: .workspaceWrite, prohibitions: ["NOT APPROVED: external send"]), now: t1)
    task.decideSemantic("field=A", now: t1)
    task.nextSteps = ["UNKNOWN: which checksum is authoritative?"]
    task.blockers = ["No credentials requested or supplied"]
    let taskBefore = task
    try MemoryPaging.archiveTaskState(task, workspace: workspace, ownerMessages: [ownerA, ownerB], root: privateRoot)
    try check(task == taskBefore, "archival cannot mutate the original TaskContext")
    let fieldScope = EpisodicMemoryScope(threadID: session, projectID: reference.projectID, objectID: "decision-field:field")
    let current = try memory.query(.init(kind: .latestState, scope: fieldScope))
    try check(current.hits.count == 1 && current.hits[0].text == ownerB.text && current.hits[0].item.metadata.assertion?.value == "B",
              "latest field state uses the explicit original correction B")
    try check(current.hits[0].item.metadata.sourceMessageID == ownerB.id && current.hits[0].current,
              "current field evidence retains the exact original owner message ID")
    let historical = try memory.query(.init(kind: .historicalState, scope: fieldScope, asOf: t1))
    try check(historical.hits.count == 1 && historical.hits[0].text == ownerA.text && !historical.hits[0].current,
              "historical field query returns original A without current-state promotion")
    let hot = try MemoryPaging.activeBlock(task, budgetTokens: 8_000, currentRequest: task.objective.requestText, root: privateRoot)
    try check(hot.contains(ownerB.text) && !hot.contains("field=A"), "hot derived state rolls back stale A and reconstructs B from raw provenance")
    try check(!hot.contains(task.objective.requestText) && hot.contains("exact current request appears below"),
              "irreducible current request is not duplicated in working-state carry")
    try check(hot.contains("NOT APPROVED: external send") && hot.contains("UNKNOWN:"), "hot state preserves exact negation and unknowns")
    try check(task == taskBefore, "derived hot reconstruction never rewrites old raw task state")
    try fails("essential carry is not truncated if it exceeds active budget") {
        _ = try MemoryPaging.activeBlock(task, budgetTokens: 20, currentRequest: task.objective.requestText, root: privateRoot)
    }
    let exact = try MemoryPaging.retrieve(manifest, kind: .exactQuote, text: nil, messageID: quoteID, root: privateRoot)
    try check(exact.hits.count == 1 && exact.hits[0].text == quoteText, "actual capability retrieval yields exact textual source")
    let numbers = try MemoryPaging.retrieve(manifest, kind: .numericResult, text: "92/128", messageID: numericID, root: privateRoot)
    try check(numbers.hits.count == 1 && numbers.hits[0].text == numericText, "raw numbers and negation survive independent runtime retrieval")
    try check(try memory.replay(numbers.receiptReference).injectionText == numbers.injectionText, "runtime retrieval has replayable exact receipt")

    // Healed execution checkout is not authority to widen the evidence project.
    let healedRoot = privateRoot.appendingPathComponent("healed-scope")
    let healedWorkspace = workspace + "/resolved-source"
    let oldProject = MemoryPaging.projectID(workspace: workspace)
    let movedProject = MemoryPaging.projectID(workspace: healedWorkspace)
    let nativeLine = "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"HEALED_NATIVE_TOOL_EVIDENCE=92/128\"}]}}"
    try MemoryPaging.archiveNative(data: Data(nativeLine.utf8), provider: "codex", nativeSessionID: UUID().uuidString,
        conversationID: session, workspace: healedWorkspace, root: healedRoot, boundProjectID: oldProject)
    let healedPage = try MemoryPaging.store(root: healedRoot).query(.init(kind: .thread,
        scope: .init(threadID: session, projectID: oldProject), text: "HEALED_NATIVE_TOOL_EVIDENCE"))
    try check(healedPage.hits.first?.text == "HEALED_NATIVE_TOOL_EVIDENCE=92/128", "healed checkout native pages retain original evidence project")
    let oldOwner = MemoryPagingOwnerMessage(id: UUID().uuidString.lowercased(), text: "decision: choice=A", timestamp: t1)
    let newOwner = MemoryPagingOwnerMessage(id: UUID().uuidString.lowercased(), text: "decision: choice=B", timestamp: t2)
    try MemoryPaging.archiveTaskState(task, workspace: workspace, ownerMessages: [oldOwner], root: healedRoot)
    try MemoryPaging.archiveTaskState(task, workspace: healedWorkspace, ownerMessages: [newOwner], root: healedRoot)
    let movedHot = try MemoryPaging.activeBlock(task, budgetTokens: 8000, root: healedRoot, boundProjectID: movedProject)
    try check(movedHot.contains("choice=B") && !movedHot.contains("choice=A"), "hot reconstruction cannot import old project decision after same-conversation move")

    // One preserved owner message may contain several independent assertions.
    // Source identity remains the original message; typed field views must not
    // collide with one another or with the complete source message.
    let multi = MemoryPagingOwnerMessage(id: UUID().uuidString.lowercased(),
        text: "decision: mode=private\ndecision: threshold=64", timestamp: t3)
    try MemoryPaging.recordMessage(sessionID: session, messageID: multi.id, speaker: "user", text: multi.text,
        timestamp: multi.timestamp, workspace: workspace, root: privateRoot)
    try MemoryPaging.archiveTaskState(task, workspace: workspace, ownerMessages: [ownerA, ownerB, multi], root: privateRoot)
    for (field, value) in [("mode", "private"), ("threshold", "64")] {
        let scope = EpisodicMemoryScope(threadID: session, projectID: reference.projectID, objectID: "decision-field:" + field)
        let page = try memory.query(.init(kind: .latestState, scope: scope))
        try check(page.hits.count == 1 && page.hits[0].item.metadata.sourceMessageID == multi.id &&
                  page.hits[0].item.metadata.assertion?.value == value && page.receipt.conflicts.isEmpty,
                  "multi-field source preserves independent latest assertion and exact owner identity: \(field)")
    }
    let multiThread = try memory.query(.init(kind: .thread, scope: .init(threadID: session, projectID: reference.projectID),
        text: "threshold=64"))
    try check(!multiThread.unknown && !multiThread.receipt.conflicts.contains(where: { $0.code == "immutable_identity_revision_conflict" }),
              "full thread query does not invent revision conflicts between typed views of one source")

    // Real native wire formats: mixed thinking/text, nested Claude tools,
    // and Codex input_text/output_text blocks. Private parent survives whole.
    let claudeRows: [[String: Any]] = [
        ["type": "assistant", "timestamp": "2026-10-04T10:00:00.125Z", "message": ["role": "assistant", "content": [
            ["type": "thinking", "thinking": "PRIVATE_THINKING_SENTINEL"],
            ["type": "text", "text": "VISIBLE_CLAUDE_EXACT\n60/128"],
            ["type": "tool_use", "id": "call-1", "name": "fixture_tool", "input": ["query": "exact query"]]]]],
        ["type": "user", "timestamp": "2026-10-04T10:00:01Z", "message": ["role": "user", "content": [
            ["type": "tool_result", "tool_use_id": "call-1", "content": "TOOL_RESULT_STRING_EXACT 92/128"],
            ["type": "tool_result", "tool_use_id": "call-2", "content": [["type": "text", "text": "TOOL_RESULT_NESTED_EXACT -32"]]]]]]
    ]
    func jsonl(_ rows: [[String: Any]]) throws -> Data {
        var data = Data()
        for row in rows { data += try JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]); data.append(10) }
        return data
    }
    let claudeRaw = try jsonl(claudeRows)
    try MemoryPaging.archiveNative(data: claudeRaw, provider: "claude", nativeSessionID: nativeClaude,
        conversationID: session, workspace: workspace, root: privateRoot)
    let codexRaw = try jsonl([
        ["type": "response_item", "timestamp": "2026-10-04T10:00:02Z", "payload": ["type": "message", "role": "user", "content": [["type": "input_text", "text": "CODEX_INPUT_TEXT_EXACT"]]]],
        ["type": "response_item", "timestamp": "2026-10-04T10:00:03Z", "payload": ["type": "message", "role": "assistant", "content": [["type": "output_text", "text": "CODEX_OUTPUT_TEXT_EXACT"]]]],
        ["type": "response_item", "timestamp": "2026-10-04T10:00:04Z", "payload": ["type": "reasoning", "role": "assistant", "summary": "PRIVATE_CODEX_REASONING_SENTINEL"]],
        ["type": "response_item", "timestamp": "2026-10-04T10:00:05Z", "payload": ["type": "function_call_output", "call_id": "call-codex", "output": "CODEX_TOOL_RESULT_EXACT 7/9"]]
    ])
    try MemoryPaging.archiveNative(data: codexRaw, provider: "codex", nativeSessionID: nativeCodex,
        conversationID: session, workspace: workspace, root: privateRoot)
    let nativeScope = EpisodicMemoryScope(threadID: session, projectID: reference.projectID)
    for sentinel in ["VISIBLE_CLAUDE_EXACT", "TOOL_RESULT_STRING_EXACT", "TOOL_RESULT_NESTED_EXACT", "CODEX_INPUT_TEXT_EXACT", "CODEX_OUTPUT_TEXT_EXACT", "CODEX_TOOL_RESULT_EXACT"] {
        let page = try memory.query(.init(kind: .exactQuote, scope: nativeScope, text: sentinel))
        try check(!page.unknown && page.hits.allSatisfy { $0.item.metadata.exact && !$0.item.metadata.derivedFrom.isEmpty },
                  "native exact source is paged with immutable parent lineage: \(sentinel)")
    }
    for secret in ["PRIVATE_THINKING_SENTINEL", "PRIVATE_CODEX_REASONING_SENTINEL"] {
        try check(try memory.query(.init(kind: .thread, scope: nativeScope, text: secret)).unknown,
                  "native hidden reasoning remains opaque, never model-injectable")
    }
    let opaqueNative = try memory.inventory().filter { $0.metadata.kind == .opaqueArchive && [$0.metadata.sourceSessionID].contains(nativeClaude) }
    try check(opaqueNative.count == 1 && (try memory.read(opaqueNative[0])) == claudeRaw, "lossless native archive is not a progress-stream projection")

    // Attached originals stay immutable even if the external file changes.
    let attachment = base.appendingPathComponent("attached-result.txt")
    let attachedOriginal = Data("ATTACHMENT_ORIGINAL_EXACT 424/500\n".utf8)
    try attachedOriginal.write(to: attachment)
    let sensitiveDirectory = base.appendingPathComponent("synthetic-sensitive/.ssh")
    try FileManager.default.createDirectory(at: sensitiveDirectory, withIntermediateDirectories: true)
    let sensitive = sensitiveDirectory.appendingPathComponent("dummy-fixture.txt")
    try Data("DUMMY_SENSITIVE_NOT_REAL_SECRET".utf8).write(to: sensitive)
    let attachmentRequest = "Inspect fixture attachments\n" + PromptAttachments.marker + "\n" +
        String(decoding: try JSONEncoder().encode(attachment.path), as: UTF8.self) + "\n" +
        String(decoding: try JSONEncoder().encode(sensitive.path), as: UTF8.self)
    let attachmentMessage = UUID().uuidString.lowercased()
    try MemoryPaging.archiveAttachments(in: attachmentRequest, conversationID: session, messageID: attachmentMessage,
        workspace: workspace, root: privateRoot)
    try Data("EXTERNAL_FILE_CHANGED".utf8).write(to: attachment)
    let attachmentScope = EpisodicMemoryScope(threadID: session, projectID: reference.projectID, objectID: "attachment:" + attachmentMessage)
    let attached = try memory.query(.init(kind: .artifact, scope: attachmentScope))
    try check(attached.hits.count == 1 && attached.hits[0].text == String(decoding: attachedOriginal, as: UTF8.self),
              "later external file change cannot mutate the captured attachment")
    try check(attached.hits[0].item.metadata.provenance.sha256 == SourceContextStore.digest(attachedOriginal),
              "attachment identity includes original raw digest")
    try check(try memory.query(.init(kind: .thread, scope: nativeScope, text: "DUMMY_SENSITIVE_NOT_REAL_SECRET")).unknown,
              "sensitive attachment content is excluded rather than archived or exposed")
    try check(try memory.inventory().contains(where: { $0.metadata.artifactID?.hasPrefix("attachment-omission:") == true }),
              "sensitive/unavailable attachment preserves an explicit UNKNOWN capture locator")

    // Retrieval allowance is durable per execution; reconstructing the
    // manifest/store does not reset bytes or calls after a process restart.
    try writeConfiguration(retrieval: 5_000)
    let budgetExecution = UUID().uuidString.lowercased()
    let budgetManifest = try MemoryPaging.prepare(reference: reference, executionID: budgetExecution, root: privateRoot)
    let firstBudgetPage = try MemoryPaging.retrieve(budgetManifest, kind: .exactQuote, text: nil, messageID: quoteID, root: privateRoot)
    try check(!firstBudgetPage.unknown, "first execution-budget page is actual evidence")
    let budgetURL = try MemoryPaging.manifestURL(executionID: budgetExecution, root: privateRoot).appendingPathExtension("budget.json")
    let initialLedger = try JSONSerialization.jsonObject(with: Data(contentsOf: budgetURL)) as! [String: Any]
    let recreated = try MemoryPaging.prepare(reference: reference, executionID: budgetExecution, root: privateRoot)
    try check(recreated == budgetManifest, "execution re-preparation preserves immutable budget manifest")
    let afterRestart = try JSONSerialization.jsonObject(with: Data(contentsOf: budgetURL)) as! [String: Any]
    try check((initialLedger["bytes"] as? Int) == (afterRestart["bytes"] as? Int) && (afterRestart["calls"] as? Int) == 1,
              "process restart does not erase already exposed context")
    var exposed = firstBudgetPage.injectionText.utf8.count + 1_024, calls = 1, exhausted = false
    for _ in 0..<20 {
        do {
            let next = try MemoryPaging.retrieve(recreated, kind: .exactQuote, text: nil, messageID: quoteID, root: privateRoot)
            exposed += next.injectionText.utf8.count + 1_024; calls += 1
        } catch MemoryPagingError.budgetExceeded { exhausted = true; break }
    }
    try check(exhausted && exposed <= budgetManifest.retrievalBudgetTokens, "inclusive execution-wide exposure budget reaches terminal exhaustion")
    let finalLedger = try JSONSerialization.jsonObject(with: Data(contentsOf: budgetURL)) as! [String: Any]
    try check((finalLedger["bytes"] as? Int) == exposed && (finalLedger["calls"] as? Int) == calls,
              "persisted ledger matches every returned source page and fixed protocol reserve")
    try fails("another preparation of the exhausted execution cannot restore allowance") {
        let restartAgain = try MemoryPaging.prepare(reference: reference, executionID: budgetExecution, root: privateRoot)
        _ = try MemoryPaging.retrieve(restartAgain, kind: .exactQuote, text: nil, messageID: quoteID, root: privateRoot)
    }

    // Context meter: actual last-request input is separate from estimate and
    // cumulative billing, while a fresh-context request is a consumable signal.
    let measured = ContextInputUsage(provider: .openAI, model: "fixture-model", inputTokens: 1_234,
        cachedInputTokens: 1_000, outputTokens: 50, contextWindowTokens: 32_000, responseID: "fixture-response",
        observedAt: "2026-10-04T10:00:00Z", source: "fixture_last_request_not_cumulative")
    try MemoryContextMeter.saveNative(measured, provider: "codex", id: nativeCodex, root: privateRoot)
    try check(MemoryContextMeter.readNative(provider: "codex", id: nativeCodex, root: privateRoot) == measured,
              "native meter persists the actual request identity and count")
    try check(MemoryContextMeter.readNative(provider: "codex", id: UUID().uuidString, root: privateRoot) == nil,
              "another native session cannot inherit old measured occupancy")
    try fails("native meter rejects a non-UUID path selector") {
        _ = try MemoryContextMeter.nativeURL(provider: "codex", id: "../wrong", root: privateRoot)
    }
    try check(!MemoryContextMeter.wantsFresh(conversationID: session, root: privateRoot), "no implicit fresh-context action")
    try MemoryContextMeter.requestFresh(conversationID: session, root: privateRoot)
    try check(MemoryContextMeter.wantsFresh(conversationID: session, root: privateRoot), "fresh-context button records next-request intent")
    try MemoryContextMeter.consumeFresh(conversationID: session, root: privateRoot)
    try check(!MemoryContextMeter.wantsFresh(conversationID: session, root: privateRoot), "verified fresh action consumes only its own signal")
    let estimate = ContextTokenEstimate.utf8(texts: ["fixture estimated payload"], structuralOverheadTokens: 100)
    let decision = ContextBudgetPolicy.evaluate(provider: .openAI, model: "fixture-model", estimate: estimate,
        freshSessionEstimateTokens: 100, resumable: true)
    let status = MemoryContextStatus(conversationID: session, executionID: UUID().uuidString.lowercased(), provider: "codex",
        model: "fixture-model", nativeSessionID: nativeCodex, previousSessionID: nil, decision: decision,
        latestRequest: measured, rotated: false, rotationReason: nil, observedAt: t3)
    try MemoryContextMeter.save(status, root: privateRoot)
    try check(MemoryContextMeter.readStatus(conversationID: session, root: privateRoot) == status,
              "UI status stores measured-vs-estimated evidence and exact native identity")
    try check(status.publicLine.contains(measured.inputTokens.formatted()) &&
              (status.publicLine.contains("subscription bill") || status.publicLine.contains("구독 실제 청구와 별개")),
              "UI public meter exposes request count with pricing-reference boundary")
    let receiptFolder = privateRoot.appendingPathComponent("memory-paging/decisions")
    let audits = try FileManager.default.contentsOfDirectory(at: receiptFolder, includingPropertiesForKeys: nil)
    try check(audits.count == 1 && !String(decoding: try Data(contentsOf: audits[0]), as: UTF8.self).contains(task.objective.requestText),
              "content-free context decision audit never contains the request text")

    // An altered private snapshot is not rescued by a matching filename/ID.
    try Data("corrupt-capability".utf8).write(to: SourceContextStore(root: privateRoot).url(for: reference.snapshot))
    try fails("capability snapshot hash mismatch fails closed") {
        _ = try MemoryPaging.prepare(reference: reference, executionID: UUID().uuidString, root: privateRoot)
    }
    print("PASS Memory paging integration: \(count) deterministic checks")
}
