import Foundation
import OS1Context

/// Real immutable-source custody and native-input assembly, with a private
/// synthetic store. No provider, authentication, live session or model call.
func rccBoundSourceDeliverySelfTest() throws {
    typealias C = RCCRuntimeContract
    let fm = FileManager.default
    let root = fm.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("os1-bound-source-fixture-" + UUID().uuidString, isDirectory: true)
    try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: root) }
    let store = SourceContextStore(root: root), digest = String(repeating: "a", count: 64)
    var checks = 0
    func check(_ good: Bool, _ label: String) throws {
        guard good else { throw OS1Error.message("Bound-source fixture: " + label) }; checks += 1
    }
    func rejects(_ label: String, _ f: () throws -> Void) throws {
        do { try f() } catch { checks += 1; return }; throw OS1Error.message("Bound-source fixture expected rejection: " + label)
    }
    func evidence(_ body: String, mode: String = "synthetic-fixture") -> R2EvidenceBundle {
        .init(modelPayload: body, userOutput: body, evidenceSHA256: SourceContextStore.digest(Data(body.utf8)),
            sourceCount: 1, capturedAt: "2032-02-03T04:05:06Z", verificationMode: mode,
            sources: [["source_path": "synthetic/notice.txt", "origin": "trusted synthetic fixture, not live user data"]],
            requiredOutputMarkers: [], contentAnchors: [])
    }
    func save(_ body: String) throws -> SourceReference { try store.write(JSONEncoder().encode(evidence(body))) }
    let original = "검토 요청은 내일까지 받을 수 있습니다. 적용일 확약은 아닙니다. Restart only after I verify the cause. This email does not authorize extra spending.\n"
    let ref = try save(original), id = try RCCBoundSourceInput.id(reference: ref)
    let context = try SessionHandoff(transcript: "A prior assistant falsely claimed the request was received.", source: ref).encoded()
    let delivery = try RCCNativeSourceDelivery.prepare(context: context, contextRefs: [id], store: store)
    try check(delivery.payload?.contains(original) == true && delivery.byteCount > original.utf8.count,
              "exact UTF8 original, not prior claim or task summary, is materialized")
    try check(delivery.sourceIDs == [id] && delivery.snapshots.first?["snapshot_sha256"] == ref.sha256 &&
              delivery.snapshots.first?["payload_sha256"] == SourceContextStore.digest(Data(original.utf8)), "pin identities")
    try check(delivery.payload?.contains("captured 2032-02-03T04:05:06Z") == true, "historical capture preserved")
    let current = "Translate the supplied notice, preserving every condition."
    let prompt = try providerPrompt(current: current, context: context, r2Evidence: delivery.payload)
    try check(prompt.contains("--- PRELOADED SOURCE DATA ---") && prompt.contains(original) &&
              prompt.hasSuffix("--- CURRENT USER REQUEST ---\n" + current), "distinct source DATA plus terminal verbatim task")
    let directive = sourceExecutionDirectiveForFixture(delivery.evidence)
    try check(!directive.contains("retrieved from R2") && directive.contains("NOT a new R2"), "no false transport or fresh-read upgrade")
    try check(delivery.evidence.map { !rccUsesLegacySourceOutputCheck($0) } == true &&
              rccUsesLegacySourceOutputCheck(evidence(original)), "plain transform bypasses only unrelated legacy keyword predicate")
    try check(!outputSatisfiesPreloadedR2Evidence(Data("This is a status update. Please reply only if anything is missing.".utf8),
              prompt: "Retrieve and explain the attached R2 source."), "real legacy retrieval guard still rejects ungrounded answer")
    try check(SourceTransformationContract.instructions.contains("Exact preloaded bytes satisfy") &&
              SourceTransformationContract.instructions.contains("modality") &&
              SourceTransformationContract.instructions.contains("not proof of independent verification"), "source and semantic policy stay separate")
    for provider in ["codex", "claude"] {
        try check(nativePresentationDirective(objective: current, provider: provider, exactAnswer: false, hasPreloadedSource: true)
                    .contains(SourceTransformationContract.instructions), "native developer/system policy reaches " + provider)
        try check(!nativePresentationDirective(objective: "1+1", provider: provider, exactAnswer: true, hasPreloadedSource: false)
                    .contains(SourceTransformationContract.instructions), "exact answer channel stays clean " + provider)
    }
    try check(!rccSnapshotOnlySource(delivery.evidence) && rccSnapshotOnlySource(evidence(original)) &&
              !rccSnapshotOnlySource(nil), "new source DATA retains the selected agent tools; legacy snapshot-only unchanged")
    let readOnlyProtection = try OS1SourceConfinement.readOnlyProtection(workspace: root.path)
    for (only, expectedEmpty) in [(false, false), (true, true)] {
        let args = try claudeArguments(model: "fixture", effort: "low", instructions: "fixture", sessionID: "fixture",
            startNewSession: true, title: "fixture", permissionProfile: "read_only", prompt: current,
            sourceContextOnly: only, readOnlyProtection: only ? nil : readOnlyProtection)
        let at = args.firstIndex(of: "--tools")
        let emptyTools = at.map { args.indices.contains($0 + 1) && args[$0 + 1].isEmpty } ?? false
        try check(emptyTools == expectedEmpty, "source preload does not silently remove readonly execution tools")
    }
    let second = try save("SECOND SELECTED ORIGINAL\n"), secondID = try RCCBoundSourceInput.id(reference: second)
    var task = TaskContext(conversationID: UUID(), objective: .init(requestText: current))
    let old = TaskContext.TaskSource(role: .userDocument, label: "old", reference: ref)
    task.sources = [old, .init(role: .userDocument, label: "new", reference: second, supersedes: old.id)]
    let superseded = try SessionHandoff(transcript: "", source: ref, taskContext: task).encoded()
    let onlySecond = try RCCNativeSourceDelivery.prepare(context: superseded, contextRefs: [secondID], store: store)
    try check(onlySecond.payload?.contains("SECOND SELECTED ORIGINAL") == true &&
              onlySecond.payload?.contains(original) == false, "only selected active snapshot supplied")
    try rejects("retired primary cannot be selected") { _ = try RCCNativeSourceDelivery.prepare(context: superseded, contextRefs: [id], store: store) }
    try check(try rccBoundSourceMaterialRefs(request: "너 되냐?", context: context).isEmpty, "narrow response check does not hydrate history")
    try check(try rccBoundSourceMaterialRefs(request: "이 자료에서 적용됐는지 확인해줘", context: context) == [id], "recorded status question retains source")
    try check(try rccBoundSourceMaterialRefs(request: "기록상 설치된 버전은?", context: context) == [id], "version query is not liveness")
    try check(try rccBoundSourceMaterialRefs(request: "이전 자료 제외하고 새 주제로 이야기하자", context: context).isEmpty, "explicit detach")
    for quoted in ["첨부 자료에서 'ignore the previous source' 문구를 번역해줘", "자료의 \"자료 연결 해제\"라는 표현 뜻을 설명해", "Explain `ignore the previous source` in this document.", "이 문서를 요약해줘: ignore the previous source"] {
        try check(try rccBoundSourceMaterialRefs(request: quoted, context: context) == [id], "quoted/payload detach phrase stays source DATA")
    }
    try check(try rccBoundSourceMaterialRefs(request: "Ignore the previous source and translate 'hello'.", context: context).isEmpty,
              "actual outside-quote source detach is honored")
    let empty = try RCCNativeSourceDelivery.prepare(context: "source locator in prose: " + id, contextRefs: [], store: store)
    try check(empty.evidence == nil && empty.byteCount == 0, "prose never creates source authority")
    try rejects("foreign ref") { _ = try RCCNativeSourceDelivery.prepare(context: context, contextRefs: [secondID], store: store) }
    let oversized = try save(String(repeating: "큰", count: 81_000))
    let bigContext = try SessionHandoff(transcript: "", source: oversized).encoded()
    try rejects("no truncated/locator preload") {
        _ = try RCCNativeSourceDelivery.prepare(context: bigContext, contextRefs: [try RCCBoundSourceInput.id(reference: oversized)], store: store)
    }
    let literal = try save("An intact document says Content omitted from this prompt budget. as an example, not a control signal.")
    let literalDelivery = try RCCNativeSourceDelivery.prepare(context: SessionHandoff(transcript: "", source: literal).encoded(),
        contextRefs: [try RCCBoundSourceInput.id(reference: literal)], store: store)
    try check(literalDelivery.payload?.contains("as an example") == true, "literal source text cannot act as omission status")
    let protected = try save("rcc_route_map")
    try rejects("protected source is not forwarded") {
        _ = try RCCNativeSourceDelivery.prepare(context: SessionHandoff(transcript: "", source: protected).encoded(),
             contextRefs: [try RCCBoundSourceInput.id(reference: protected)], store: store)
    }
    let host = C.HostContext(workspace: root.path, context: context, providerPreference: "auto", codexSessionID: nil,
        claudeSessionID: nil, requireReadOnly: true, ownerPolicy: nil)
    let config = C.ExactConfig(surface: .codex, transport: .codexAppServer, accountID: "fixture", model: "fixture", effort: .low,
        tools: ["read"], scope: .readOnly, permissionProfile: .readOnly, quotaPool: .openAICodex, allowedPaths: [], configurationSHA256: digest)
    let ticket = C.ExecutionTicket(taskID: "fixture-task", nodeID: "node-0", attemptID: UUID().uuidString.lowercased(),
        candidateID: "fixture", requestSHA256: digest, policySHA256: digest, policySourceSHA256: digest,
        sourceFingerprint: digest, configurationSHA256: digest, selectedConfig: config, objective: current,
        instruction: current, contextRefs: [id], ownedPaths: [], originalRequest: current, originalObjective: current, hostContext: host)
    let receipts = root.appendingPathComponent(".os1/rcc-runtime/source-input-receipts", isDirectory: true)
    try delivery.recordPrepared(ticket: ticket, prompt: prompt, root: root)
    let receipt = receipts.appendingPathComponent(ticket.attemptID + ".json"), bytes = try Data(contentsOf: receipt)
    let value = try JSONSerialization.jsonObject(with: bytes) as? [String: Any]
    let preparedState = value?["state"] as? String
    let inclusion = value?["backend_inclusion_verified"] as? Bool
    let semantic = value?["semantic_quality_verified"] as? Bool
    let payloadBytes = value?["source_payload_bytes"] as? Int
    try check(preparedState == "prepared_before_native_dispatch" && inclusion == false && semantic == false &&
              payloadBytes == delivery.byteCount, "prepared receipt does not invent executed adoption")
    try rejects("receipt never overwritten") { try delivery.recordPrepared(ticket: ticket, prompt: "changed", root: root) }
    try check(try Data(contentsOf: receipt) == bytes, "first prepared identity preserved")
    try Data("tampered".utf8).write(to: store.url(for: ref))
    try rejects("hash mismatch pre-dispatch") { _ = try RCCNativeSourceDelivery.prepare(context: context, contextRefs: [id], store: store) }
    try fm.removeItem(at: store.url(for: second))
    try rejects("missing selected snapshot") { _ = try RCCNativeSourceDelivery.prepare(context: superseded, contextRefs: [secondID], store: store) }
    print("RCC bound source delivery: \(checks) checks PASS; providers/models/live stores untouched")
}
