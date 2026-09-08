import AppKit
@preconcurrency import AVFoundation
import CryptoKit
import Foundation
import OS1Context
import SQLite3
@preconcurrency import Speech
import SwiftUI
import UniformTypeIdentifiers

private enum ProviderChoice: String, CaseIterable, Codable, Identifiable, Sendable {
    case auto
    case codex
    case claude

    var id: String { rawValue }
    var title: String {
        switch self {
        case .auto: return "Auto"
        case .codex: return "Codex"
        case .claude: return "Claude"
        }
    }
    var subtitle: String {
        switch self {
        case .auto: return "RCC chooses"
        case .codex: return "Build & edit"
        case .claude: return "Analyze & review"
        }
    }
    var symbol: String {
        switch self {
        case .auto: return "sparkles"
        case .codex: return "chevron.left.forwardslash.chevron.right"
        case .claude: return "sun.max.fill"
        }
    }
    var tint: Color {
        switch self {
        case .auto: return Color(red: 0.38, green: 0.86, blue: 0.58)
        case .codex: return Color(red: 0.95, green: 0.64, blue: 0.80)
        case .claude: return Color(red: 0.98, green: 0.53, blue: 0.68)
        }
    }
}

private func explicitlyRequestedProvider(in request: String) -> ProviderChoice? {
    let value = request
        .lowercased()
        .replacingOccurrences(of: "[\\p{P}\\p{S}]+", with: " ", options: .regularExpression)
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)

    // Voice dictation frequently turns 코덱스 into 코덱세/코덱센트/코덱선트.
    // This recognizes only directed backend requests; merely discussing a
    // provider keeps the private RCC auto route in control.
    let codexPatterns = [
        #"코덱(?:스|세|센트|선트)?\s*(?:(?:한테|에게|로|으로)(?:\s|\S){0,24}(?:시켜|시키|맡겨|보내|돌려|실행|해|하게|말|부탁)|(?:가|이)?\s*(?:뭐\s*)?(?:시켜|시키|맡겨|보내|돌려|실행|해|하게|말|부탁))"#,
        #"(?:시켜|시키|맡겨|보내|돌려|실행|부탁)(?:\s|\S){0,18}코덱(?:스|세|센트|선트)?"#,
        #"(?:use|ask|route|send|run|delegate)(?:\s+\w+){0,3}\s+codex\b"#,
        #"\bcodex\b(?:\s+\w+){0,3}\s+(?:do|run|handle|execute)\b"#,
    ]
    let claudePatterns = [
        #"클(?:로드|로더)\s*(?:코드)?\s*(?:(?:한테|에게|로|으로)(?:\s|\S){0,24}(?:시켜|시키|맡겨|보내|돌려|실행|해|하게|말|부탁)|(?:가|이)?\s*(?:뭐\s*)?(?:시켜|시키|맡겨|보내|돌려|실행|해|하게|말|부탁))"#,
        #"(?:시켜|시키|맡겨|보내|돌려|실행|부탁)(?:\s|\S){0,18}클(?:로드|로더)(?:\s*코드)?"#,
        #"(?:use|ask|route|send|run|delegate)(?:\s+\w+){0,3}\s+claude(?:\s+code)?\b"#,
        #"\bclaude(?:\s+code)?\b(?:\s+\w+){0,3}\s+(?:do|run|handle|execute)\b"#,
    ]
    func lastMatch(in patterns: [String]) -> String.Index? {
        patterns.compactMap { pattern in
            value.range(of: pattern, options: .regularExpression)?.lowerBound
        }.max()
    }
    let codex = lastMatch(in: codexPatterns)
    let claude = lastMatch(in: claudePatterns)
    switch (codex, claude) {
    case (.some(let codexIndex), .some(let claudeIndex)):
        return codexIndex > claudeIndex ? .codex : .claude
    case (.some, .none): return .codex
    case (.none, .some): return .claude
    case (.none, .none): return nil
    }
}

private func providerDisplayName(_ provider: String?) -> String {
    provider == "local" ? "OS-1" : (provider ?? "OS-1").uppercased()
}

/// Backend records created by OS-1 contain a bounded execution envelope. The
/// native inspector shows the user's request, never that control/source blob.
private func visibleBackendUserRequest(_ value: String) -> String? {
    let marker = "--- CURRENT USER REQUEST ---"
    if let range = value.range(of: marker, options: .backwards) {
        let request = value[range.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
        return request.isEmpty ? nil : request.precomposedStringWithCanonicalMapping
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    let lower = trimmed.lowercased()
    guard !lower.hasPrefix("continue the same user-selected work session."),
          !lower.hasPrefix("os-1 executor contract ") else { return nil }
    return trimmed.precomposedStringWithCanonicalMapping
}

private func nativeSessionURL(provider: ProviderChoice, sessionID: String?) -> URL? {
    guard provider != .auto, let sessionID,
          UUID(uuidString: sessionID) != nil else { return nil }
    switch provider {
    case .codex:
        return URL(string: "codex://threads/\(sessionID)")
    case .claude:
        var components = URLComponents()
        components.scheme = "claude"
        components.host = "resume"
        components.queryItems = [URLQueryItem(name: "session", value: sessionID)]
        return components.url
    case .auto:
        return nil
    }
}

private func visibleAdoptedSteps(_ steps: [AppRunStep]) -> [AppRunStep] {
    steps.filter {
        $0.revasDisposition == "adopted" || $0.revasDisposition == "control_verified"
    }
}

@MainActor
private func taskContextSelfTest() throws {
    // v3 handoff carries the OS-1 task context through the session codec.
    var session = ConversationSession(workspace: "/tmp")
    var context = TaskContext.migrated(conversationID: session.id, request: "야 인스타그램 수정 좀 하자 준비해", workspace: "/tmp",
        sourceContext: nil, codexSessionID: nil, claudeSessionID: nil)
    context.decideSemantic("Node 20.20.2 only")
    session.taskContext = context
    session.messages = [ChatMessage(role: .user, text: "야 인스타그램 수정 좀 하자 준비해")]
    let restored = try JSONDecoder().decode(ConversationSession.self, from: JSONEncoder().encode(session))
    let handoff = try SessionHandoff.decode(sessionHandoff(restored))
    guard handoff.format == SessionHandoff.currentFormat, handoff.taskContext?.conversationID == session.id,
          handoff.taskContext?.activeDecisions.map(\.text) == ["Node 20.20.2 only"] else {
        throw RunnerError.message("OS-1 v3 handoff lost the task context")
    }
    var ingested = restored
    ingested.messages.append(ChatMessage(role: .assistant, text: "native answer", provider: "codex", nativeIngestedID: "codex:abc"))
    guard try SessionHandoff.decode(sessionHandoff(ingested)).transcript.contains("[native session, outside OS-1]") else {
        throw RunnerError.message("Native-ingested turns must be labeled in the handoff")
    }
    // Adoption against the handed revision.
    var runtime = context
    runtime.bind(provider: "codex", nativeSessionID: UUID().uuidString)
    let handed = context.contextRevision
    guard context.adopting(runtime, handedRevision: handed).bindings.count == 1 else {
        throw RunnerError.message("Unchanged context must adopt the runtime result")
    }
    var changed = context
    changed.setObjective(TaskContext.Objective(requestText: "다른 요청"))
    let merged = changed.adopting(runtime, handedRevision: handed)
    guard merged.objective.requestText == "다른 요청", merged.bindings.count == 1, !changed.acceptsLateResult(fromRevision: handed) else {
        throw RunnerError.message("Changed context must keep its objective and treat the handed revision as late")
    }
    // Legacy and partially unreadable envelopes.
    let good = "{\"id\":\"\(UUID().uuidString)\",\"title\":\"t\",\"workspace\":\"/tmp\",\"provider\":\"auto\",\"messages\":[],\"updatedAt\":0}"
    let legacy = try JSONDecoder().decode(SessionEnvelope.self, from: Data("{\"schema\":4,\"sessions\":[\(good)]}".utf8))
    guard legacy.sessions.count == 1, legacy.sessions[0].taskContext == nil,
          migratedTaskContext(legacy.sessions[0], sourceContext: nil).conversationID == legacy.sessions[0].id else {
        throw RunnerError.message("Legacy envelope migration failed")
    }
    let broken = Data("{\"schema\":4,\"sessions\":[{\"id\":\"not-a-uuid\"},\(good)]}".utf8)
    guard (try? JSONDecoder().decode(SessionEnvelope.self, from: broken)) == nil,
          try JSONDecoder().decode(LenientSessionEnvelope.self, from: broken).sessions.compactMap(\.value).count == 1 else {
        throw RunnerError.message("Lenient envelope must keep the readable conversation")
    }
    guard TaskContext.explicitDecisions(in: "결정: Node 20으로 간다\n그리고 수정해") == ["Node 20으로 간다"] else {
        throw RunnerError.message("Explicit decision capture failed")
    }
}

@MainActor
private func providerIntentSelfTest() throws {
    let sourceRef = SourceReference(kind: .snapshot, id: UUID(), sha256: String(repeating: "b", count: 64))
    var sourceSession = ConversationSession(workspace: "/tmp")
    sourceSession.sourceContext = sourceRef
    sourceSession.messages = (0..<42).map { index in
        ChatMessage(role: index.isMultiple(of: 2) ? .user : .assistant,
            text: "다음 요청 \(index)\n\n거기서 가져왔던 자료를 계속 사용합니다.",
            provider: index.isMultiple(of: 2) ? nil : "claude")
    }
    let restoredSession = try JSONDecoder().decode(ConversationSession.self, from: JSONEncoder().encode(sourceSession))
    let actualHandoff = try SessionHandoff.decode(sessionHandoff(restoredSession))
    guard actualHandoff.source == sourceRef,
          actualHandoff.transcript.contains("다음 요청 0\n"),
          actualHandoff.transcript.contains("다음 요청 41\n"),
          migratedSourceReference(ConversationSession(workspace: "/tmp")) == nil else {
        throw RunnerError.message("OS-1 persisted conversation source handoff failed")
    }
    var pendingSession = ConversationSession(workspace: "/tmp")
    pendingSession.messages = [ChatMessage(role: .assistant, text: "provisional fixture", provider: "claude", nativeRecordVerified: false)]
    guard try SessionHandoff.decode(sessionHandoff(pendingSession)).transcript.contains("UNVERIFIED BACKEND OUTPUT") else {
        throw RunnerError.message("Pending output lost its verification boundary in context")
    }
    let codexRequests = [
        "코덱스한테 말시켜봐",
        "코덱세한테 뭐 시켜봐",
        "1 더하기 1 코덱선트 시켜라니까",
        "코덱센트 시켜서 확인해",
        "ask Codex to run the tests",
        "use Codex for this task",
    ]
    let claudeRequests = [
        "클로드한테 레드팀 시켜",
        "이거 클로더 코드로 해",
        "ask Claude Code to review this",
        "use Claude for this task",
    ]
    let autoRequests = [
        "코덱스 사용량과 클로드 사용량을 비교해줘",
        "Codex and Claude are both backends",
        "이 버그를 고치고 테스트해",
    ]
    let failures = codexRequests.filter { explicitlyRequestedProvider(in: $0) != .codex }
        + claudeRequests.filter { explicitlyRequestedProvider(in: $0) != .claude }
        + autoRequests.filter { explicitlyRequestedProvider(in: $0) != nil }
        + (explicitlyRequestedProvider(in: "코덱스한테 시키지 말고 클로드한테 시켜") == .claude
            ? [] : ["last directed provider"])
    guard failures.isEmpty else {
        throw RunnerError.message("OS-1 provider intent self-test failed: \(failures.joined(separator: " | "))")
    }

    let codexSessionID = "01a060ab-f53b-71c3-a38e-e77b1b98ea74"
    let claudeSessionID = "bae5987c-3fd1-4d08-a85c-6d9c18d41e86"
    let manualSessionID = "17db0272-fc3c-402b-9f09-2cda62056a9a"
    let wrappedBackendPrompt = """
    Continue the same user-selected work session.
    --- PRIOR SESSION ---
    USER:
    hidden history
    --- CURRENT USER REQUEST ---
    실제 사용자 요청
    """
    guard nativeSessionURL(provider: .codex, sessionID: codexSessionID)?.absoluteString
            == "codex://threads/\(codexSessionID)",
          nativeSessionURL(provider: .claude, sessionID: claudeSessionID)?.absoluteString
            == "claude://resume?session=\(claudeSessionID)",
          nativeSessionURL(provider: .auto, sessionID: claudeSessionID) == nil,
          nativeSessionURL(provider: .codex, sessionID: "not-a-session") == nil,
          visibleBackendUserRequest(wrappedBackendPrompt) == "실제 사용자 요청",
          visibleBackendUserRequest("Continue the same user-selected work session.") == nil,
          visibleBackendUserRequest("OS-1 executor contract internal control") == nil,
          visibleBackendUserRequest("직접 연 백엔드 질문") == "직접 연 백엔드 질문",
          resolvedNativeSessionID(recordedID: codexSessionID, currentID: manualSessionID,
            preservingCurrent: false, availableIDs: [codexSessionID, manualSessionID]) == codexSessionID,
          resolvedNativeSessionID(recordedID: nil, currentID: manualSessionID,
            preservingCurrent: false, availableIDs: [manualSessionID]) == nil,
          resolvedNativeSessionID(recordedID: nil, currentID: manualSessionID,
            preservingCurrent: true, availableIDs: [manualSessionID]) == manualSessionID,
          resolvedNativeSessionID(recordedID: codexSessionID, currentID: nil,
            preservingCurrent: false, availableIDs: [manualSessionID]) == nil,
          backendInspectorRefreshInterval == .seconds(2),
          shouldRefreshActiveLinkedNativeTranscript(surface: .codex, provider: .codex,
            runningProvider: .codex, recordedID: codexSessionID, selectedID: codexSessionID,
            selectionAvailable: true, isLoading: false),
          !shouldRefreshActiveLinkedNativeTranscript(surface: .codex, provider: .codex,
            runningProvider: .claude, recordedID: codexSessionID, selectedID: codexSessionID,
            selectionAvailable: true, isLoading: false),
          !shouldRefreshActiveLinkedNativeTranscript(surface: .codex, provider: .codex,
            runningProvider: .codex, recordedID: codexSessionID, selectedID: codexSessionID,
            selectionAvailable: false, isLoading: false),
          !shouldRefreshActiveLinkedNativeTranscript(surface: .codex, provider: .codex,
            runningProvider: .codex, recordedID: codexSessionID, selectedID: manualSessionID,
            selectionAvailable: true, isLoading: false) else {
        throw RunnerError.message("OS-1 provider-session inspector contract failed.")
    }

    guard providerDisplayName("local") == "OS-1",
          providerDisplayName("codex") == "CODEX" else {
        throw RunnerError.message("OS-1 provider display-name self-test failed.")
    }

    guard composerReturnAction(shiftPressed: false) == .send,
          composerReturnAction(shiftPressed: true) == .newline else {
        throw RunnerError.message("OS-1 composer keyboard self-test failed.")
    }

    var queue = ["first", "second", "third"]
    let drained = [queue.removeFirst(), queue.removeFirst(), queue.removeFirst()]
    guard drained == ["first", "second", "third"], queue.isEmpty else {
        throw RunnerError.message("OS-1 queued submission FIFO self-test failed.")
    }

    guard composerText(base: "", dictated: "안녕하세요") == "안녕하세요",
          composerText(base: "기존 작업", dictated: "계속해") == "기존 작업 계속해",
          composerText(base: "first line\n", dictated: "둘째 줄") == "first line\n둘째 줄",
          dictationText(committed: "첫 문장.", current: "둘째 문장") == "첫 문장. 둘째 문장",
          composerText(
            base: "이미 적은 내용",
            dictated: dictationText(committed: "첫 구간", current: "둘째 구간")
          ) == "이미 적은 내용 첫 구간 둘째 구간" else {
        throw RunnerError.message("OS-1 voice dictation composer merge self-test failed.")
    }

    let localStep = AppRunStep(
        sequence: 1,
        provider: "local",
        action: "deterministic_compute",
        model: "local-deterministic",
        effort: "none",
        revasDisposition: "adopted",
        sessionID: "8eaa48c6-af59-4f4c-a2be-9a0ec3b6fc21",
        permissionProfile: "read_only",
        exitCode: 0,
        output: "2",
        stderr: "",
        durationMS: 1,
        nativeRecord: AppNativeRecord(
            turnID: "rcc-local-8eaa48c6af594f4ca2be9a0ec3b6fc21",
            recordPath: "/tmp/exact.json",
            persistence: "verified",
            desktopVisibility: "local_only"
        )
    )
    guard backendTierLabel(action: localStep.action, provider: localStep.provider) == "OS-1",
          nativeRecordReceipt(localStep).contains("local exact receipt persisted") else {
        throw RunnerError.message("OS-1 local exact execution UI self-test failed.")
    }

    let rejectedStep = AppRunStep(
        sequence: 1,
        provider: "claude",
        action: "cl_standard",
        model: "sonnet",
        effort: "medium",
        revasDisposition: "retry",
        sessionID: "8eaa48c6-af59-4f4c-a2be-9a0ec3b6fc22",
        permissionProfile: "read_only",
        exitCode: 0,
        output: "R2 tools are unavailable.",
        stderr: "",
        durationMS: 1,
        nativeRecord: nil
    )
    let controlStep = AppRunStep(
        sequence: 2,
        provider: "local",
        action: "r2_retrieval",
        model: "os1-evidence-resolver",
        effort: "none",
        revasDisposition: "control_verified",
        sessionID: "8eaa48c6-af59-4f4c-a2be-9a0ec3b6fc23",
        permissionProfile: "local_control",
        exitCode: 0,
        output: "verified source",
        stderr: "",
        durationMS: 1,
        nativeRecord: nil
    )
    let sourceStatusID = "8eaa48c6-af59-4f4c-a2be-9a0ec3b6fc24"
    let sourceStatusOutput = "OS-1 source status verified"
    let receiptRoot = FileManager.default.temporaryDirectory
        .appendingPathComponent("os1-app-source-status-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: receiptRoot, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: receiptRoot) }
    let receiptURL = receiptRoot.appendingPathComponent("source-status.json")
    let sourceStatusReceipt: [String: Any] = [
        "schema": 1,
        "operation_id": sourceStatusID,
        "operation": "source_status",
        "github_repository": "effacermonexistence/codex",
        "github_main_sha": String(repeating: "a", count: 40),
        "r2_bucket": "omar-private-archive",
        "r2_repository_sha": String(repeating: "b", count: 40),
        "r2_bundle_sha256": String(repeating: "c", count: 64),
        "public_release_sha256": String(repeating: "d", count: 64),
        "model_invoked": false,
        "result_sha256": appSHA256Hex(sourceStatusOutput),
    ]
    try JSONSerialization.data(withJSONObject: sourceStatusReceipt, options: [.sortedKeys])
        .write(to: receiptURL, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receiptURL.path)
    let sourceStatusStep = AppRunStep(
        sequence: 1,
        provider: "local",
        action: "source_status",
        model: "os1-control",
        effort: "none",
        revasDisposition: "control_verified",
        sessionID: sourceStatusID,
        permissionProfile: "local_control",
        exitCode: 0,
        output: sourceStatusOutput,
        stderr: "",
        durationMS: 1,
        nativeRecord: AppNativeRecord(
            turnID: sourceStatusID,
            recordPath: receiptURL.path,
            persistence: "verified",
            desktopVisibility: "control_only"
        )
    )
    let tamperedSourceStatusStep = AppRunStep(
        sequence: sourceStatusStep.sequence,
        provider: sourceStatusStep.provider,
        action: sourceStatusStep.action,
        model: sourceStatusStep.model,
        effort: sourceStatusStep.effort,
        revasDisposition: sourceStatusStep.revasDisposition,
        sessionID: sourceStatusStep.sessionID,
        permissionProfile: sourceStatusStep.permissionProfile,
        exitCode: sourceStatusStep.exitCode,
        output: "tampered",
        stderr: sourceStatusStep.stderr,
        durationMS: sourceStatusStep.durationMS,
        nativeRecord: sourceStatusStep.nativeRecord
    )
    let qmGRRetrievalID = "8eaa48c6-af59-4f4c-a2be-9a0ec3b6fc25"
    let qmGRRetrievalOutput = "R2 QMGR objective v1 verified"
    let qmGRReceiptURL = receiptRoot.appendingPathComponent("qmgr-retrieval.json")
    let qmGRSource: [String: Any] = [
        "repository": "private-r2/qmgr-objective-v1",
        "object_key": "os1-clodex/research/qmgr-objective/v1/evidence/" + String(repeating: "a", count: 12),
        "source_path": "docs/QMGR_OBJECTIVE.md",
        "retrieved_content_sha256": String(repeating: "a", count: 64),
        "object_size": "123",
        "transport_object_key": "transport-fixture",
        "transport_sha256": String(repeating: "b", count: 64),
        "base_repository": "effacermonexistence/orthogonal-projection-term-benchmarks",
        "base_repository_sha": String(repeating: "c", count: 40),
        "base_bundle_key": "bundle-fixture",
        "base_bundle_sha256": String(repeating: "d", count: 64),
    ]
    let qmGRReceipt: [String: Any] = [
        "schema": 1,
        "operation_id": qmGRRetrievalID,
        "operation": "r2_retrieval",
        "issued_at": "2026-09-04T00:00:00Z",
        "bucket": "omar-private-archive",
        "verification_mode": "live-content-addressed-r2-readback+base-bundle",
        "r2_verified": true,
        "model_invoked": false,
        "source_count": 8,
        "sources": Array(repeating: qmGRSource, count: 8),
        "evidence_sha256": String(repeating: "e", count: 64),
        "request_sha256": String(repeating: "f", count: 64),
        "result_sha256": appSHA256Hex(qmGRRetrievalOutput),
    ]
    try JSONSerialization.data(withJSONObject: qmGRReceipt, options: [.sortedKeys])
        .write(to: qmGRReceiptURL, options: [.atomic])
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: qmGRReceiptURL.path)
    let qmGRRetrievalStep = AppRunStep(
        sequence: 1,
        provider: "local",
        action: "r2_retrieval",
        model: "os1-evidence-resolver",
        effort: "none",
        revasDisposition: "control_verified",
        sessionID: qmGRRetrievalID,
        permissionProfile: "local_control",
        exitCode: 0,
        output: qmGRRetrievalOutput,
        stderr: "",
        durationMS: 1,
        nativeRecord: AppNativeRecord(
            turnID: qmGRRetrievalID,
            recordPath: qmGRReceiptURL.path,
            persistence: "verified",
            desktopVisibility: "control_only"
        )
    )
    guard visibleAdoptedSteps([rejectedStep, localStep, controlStep]).map(\.output) == ["2", "verified source"],
          stepRecordIsVerified(sourceStatusStep),
          stepRecordIsVerified(qmGRRetrievalStep),
          !stepRecordIsVerified(tamperedSourceStatusStep) else {
        throw RunnerError.message("OS-1 adopted-only UI barrier self-test failed.")
    }

    let selectableDocument = timelineAttributedDocument(
        messages: [
            ChatMessage(role: .user, text: "drag-question"),
            ChatMessage(
                role: .assistant,
                text: "drag-answer",
                provider: "codex",
                permissionProfile: "read_only"
            ),
            ChatMessage(
                role: .receipt,
                text: "route-receipt",
                nativeRecordVerified: true
            ),
            ChatMessage(role: .user, text: "next-question"),
        ],
        queuedSubmissions: [],
        isRunning: false,
        workspace: "/tmp",
        expandAll: true
    )
    let selectableTranscript = selectableDocument.string
    let selectionTokens = [
        "drag-question",
        "CODEX · read only",
        "drag-answer",
        "실행 기록 확인됨",
        "route-receipt",
        "next-question",
    ]
    var selectionCursor = selectableTranscript.startIndex
    for token in selectionTokens {
        guard let range = selectableTranscript.range(
            of: token,
            range: selectionCursor..<selectableTranscript.endIndex
        ) else {
            throw RunnerError.message("OS-1 continuous transcript selection self-test failed.")
        }
        selectionCursor = range.upperBound
    }
    let selectableTextView = ContinuousTranscriptTextView(
        frame: NSRect(x: 0, y: 0, width: 1_000, height: 700)
    )
    selectableTextView.isEditable = false
    selectableTextView.isSelectable = true
    selectableTextView.textStorage?.setAttributedString(selectableDocument)
    let firstToken = (selectableTranscript as NSString).range(of: selectionTokens[0])
    let lastToken = (selectableTranscript as NSString).range(of: selectionTokens.last!)
    let crossMessageRange = NSRange(
        location: firstToken.location,
        length: NSMaxRange(lastToken) - firstToken.location
    )
    selectableTextView.setSelectedRange(crossMessageRange)
    guard let selectedText = selectableTextView.normalizedSelectedText(),
          selectionTokens.allSatisfy({ selectedText.contains($0) }) else {
        throw RunnerError.message("OS-1 cross-message native selection self-test failed.")
    }
    let markdown = TranscriptMarkdown.render("## 결과\n\n**강조**와 `code`, [문서](https://example.com)\n- 목록\n\n| 단계 | 설명 |\n| --- | --- |\n| 첫째 | 확인 |", key: "test")
    guard markdown.string.contains("결과"), !markdown.string.contains("##"),
          !markdown.string.contains("**"), !markdown.string.contains("| ---"),
          markdown.string.contains("첫째\n확인"),
          (markdown.attribute(.paragraphStyle, at: (markdown.string as NSString).range(of: "확인").location, effectiveRange: nil) as? NSParagraphStyle)?.textBlocks.first is NSTextTableBlock,
          (markdown.attribute(.font, at: 0, effectiveRange: nil) as? NSFont)?.pointSize == 18 else {
        throw RunnerError.message("OS-1 native Markdown rendering failed")
    }
    let nested = TranscriptMarkdown.inline("*출처: 문서 `file.json`* 및 **\"결론\"**입니다. `**literal**` [위험](javascript:alert)")
    guard nested.string == "출처: 문서 file.json 및 \"결론\"입니다. **literal** 위험",
          (nested.attribute(.font, at: 0, effectiveRange: nil) as? NSFont)?.fontDescriptor.symbolicTraits.contains(.italic) == true,
          nested.attribute(.link, at: nested.length - 1, effectiveRange: nil) == nil else {
        throw RunnerError.message("OS-1 nested Markdown / Korean boundary / safe link failed")
    }
    let longCode = "```json\n" + (0..<20).map { "code line \($0)" }.joined(separator: "\n") + "\n```"
    let folded = TranscriptMarkdown.render(longCode, key: "test")
    let unfolded = TranscriptMarkdown.render(longCode, key: "test", expanded: ["test-code-0"])
    guard folded.string.contains("펼쳐보기"), !folded.string.contains("code line 19"),
          unfolded.string.contains("code line 19"), unfolded.string.contains("접기") else {
        throw RunnerError.message("OS-1 code disclosure failed")
    }
    let receipt = ChatMessage(role: .receipt, text: "private execution detail", nativeRecordVerified: nil)
    let compact = timelineAttributedDocument(messages: [receipt], queuedSubmissions: [], isRunning: false, workspace: "/tmp")
    guard !compact.string.contains("private execution detail"), compact.string.contains("미확인"),
          !compact.string.contains("VERIFIED") else { throw RunnerError.message("OS-1 receipt scope failed") }

    // Exercise the same receipt-bound renderer used for old persisted turns.
    let retrievalOutput = "R2에서 관련 자료를 검증해 회수했습니다.\n- SHA: hidden-transport-digest\n\n### `project/design.md`\n\n# 연구 원문\n\nunchanged-source-body"
    let displayStore = SourceContextStore(root: receiptRoot)
    let displayID = UUID()
    let displayReceiptURL = displayStore.url(for: SourceReference(kind: .receipt, id: displayID, sha256: ""))
    try FileManager.default.createDirectory(at: displayReceiptURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    let displayReceipt: [String: Any] = ["operation": "r2_retrieval", "operation_id": displayID.uuidString.lowercased(),
        "bucket": "omar-private-archive", "r2_verified": true, "model_invoked": false,
        "source_count": 1, "sources": [["source_path": "project/design.md"]],
        "result_sha256": appSHA256Hex(retrievalOutput)]
    try JSONSerialization.data(withJSONObject: displayReceipt).write(to: displayReceiptURL)
    let answerMessage = ChatMessage(role: .assistant, text: retrievalOutput, provider: "local")
    let receiptMessage = ChatMessage(role: .receipt, text: "\(displayID.uuidString.lowercased()).json", provider: "local", nativeRecordVerified: true)
    let displayMessages = [ChatMessage(role: .user, text: "R2 자료 가져와"), answerMessage, receiptMessage,
                           ChatMessage(role: .user, text: "다음 질문")]
    func renderRetrieval(_ messages: [ChatMessage], expanded: Set<String> = [], all: Bool = false) -> NSAttributedString {
        timelineAttributedDocument(messages: messages, queuedSubmissions: [], isRunning: false,
            workspace: "/tmp", expanded: expanded, expandAll: all, sourceStore: displayStore)
    }
    let display = renderRetrieval(displayMessages)
    let expandedDisplay = renderRetrieval(displayMessages, all: true)
    guard display.string.contains("관련 자료 1개"), display.string.contains("출처·검증 정보"),
          !display.string.contains("hidden-transport-digest"), !display.string.contains("unchanged-source-body"),
          expandedDisplay.string.contains("hidden-transport-digest"), expandedDisplay.string.contains("unchanged-source-body"),
          completeTranscriptText(displayMessages).contains(retrievalOutput) else {
        throw RunnerError.message("OS-1 retrieval default/expanded/full-copy presentation failed")
    }
    let sourceOnly = renderRetrieval(displayMessages, expanded: [answerMessage.id.uuidString + "-source"])
    let evidenceOnly = renderRetrieval(displayMessages, expanded: [answerMessage.id.uuidString + "-evidence"])
    guard sourceOnly.string.contains("unchanged-source-body"), !sourceOnly.string.contains("hidden-transport-digest"),
          evidenceOnly.string.contains("hidden-transport-digest"), !evidenceOnly.string.contains("unchanged-source-body") else {
        throw RunnerError.message("OS-1 independent retrieval disclosure failed")
    }
    let originalRequest = [ChatMessage(role: .user, text: "원문 그대로 보여줘"), answerMessage, receiptMessage]
    guard renderRetrieval(originalRequest).string.contains("unchanged-source-body"),
          !renderRetrieval(originalRequest, expanded: [answerMessage.id.uuidString + "-source"]).string.contains("unchanged-source-body") else {
        throw RunnerError.message("OS-1 explicit original-text display failed")
    }
    selectableTextView.textStorage?.setAttributedString(expandedDisplay)
    selectableTextView.setSelectedRange(NSRange(location: 0, length: expandedDisplay.length))
    guard let selected = selectableTextView.normalizedSelectedText(),
          ["R2 자료 가져와", "unchanged-source-body", "hidden-transport-digest", "다음 질문"].allSatisfy(selected.contains) else {
        throw RunnerError.message("OS-1 retrieval cross-message selection failed")
    }
    var links: [String] = []
    display.enumerateAttribute(.link, in: NSRange(location: 0, length: display.length)) { value, _, _ in
        if let url = value as? URL { links.append(url.absoluteString) }
    }
    guard links.contains(where: { $0.contains(answerMessage.id.uuidString + "-source") }),
          links.contains(where: { $0.contains(answerMessage.id.uuidString + "-evidence") }) else {
        throw RunnerError.message("OS-1 retrieval links are not clickable")
    }
    let altered = ChatMessage(role: .assistant, text: retrievalOutput + " modified", provider: "local")
    guard retrievalPresentation(messages: [altered, receiptMessage], index: 0, sourceStore: displayStore) == nil else {
        throw RunnerError.message("OS-1 retrieval tampered output accepted")
    }
    try FileManager.default.removeItem(at: displayReceiptURL)
    guard retrievalPresentation(messages: displayMessages, index: 1, sourceStore: displayStore) == nil else {
        throw RunnerError.message("OS-1 retrieval presentation trusted prose without a receipt")
    }
}

@MainActor
private func interactionSelfTest() throws {
    func check(_ condition: Bool, _ message: String) throws {
        if !condition { throw RunnerError.message("OS-1 interaction: " + message) }
    }
    let formulas = [#"$U_a$"#, #"$\mathcal E(\varrho)=(1-f)\varrho+f\sum_a p_a U_a\varrho U_a^\dagger$"#,
        #"$\sqrt{1-f}\,I$"#, #"$L\Phi=\rho_Q-\bar\rho_Q$"#, #"$J_{\mathrm{exec}}=\max_i r_i/\tau_i$"#,
        #"$\nabla_\mu T^{\mu\nu}=0$"#, #"\[\frac{1}{3}+\sqrt{x^2}\]"#,
        #"$$\operatorname{diag}\mathcal E_{f,p}(\varrho)=(1-f)q+f(p*q),$$"#,
        #"$\operatorname{Tr}(\rho)+\operatorname{rank}(A)$"#]
    for formula in formulas {
        let result = MathTypesetter.render(formula)
        try check(result.attribute(.attachment, at: 0, effectiveRange: nil) is NSTextAttachment, "formula not rendered: \(formula)")
        try check(MathTypesetter.copyable(result) == formula, "formula copy changed source")
    }
    let text = "질문\n\n" + formulas.joined(separator: " 그리고 ") + "\n\n다음 질문"
    let rendered = TranscriptMarkdown.render(text, key: "math-test")
    try check(MathTypesetter.copyable(rendered) == text, "cross-message formula copy")
    let view = ContinuousTranscriptTextView()
    view.textStorage?.setAttributedString(rendered)
    view.setSelectedRange(NSRange(location: 0, length: rendered.length))
    try check(view.normalizedSelectedText() == text, "native math selection")
    let stableMessage = ChatMessage(role: .assistant, text: text, provider: "claude")
    let stableID = UUID()
    let input = TranscriptRenderInput(sessionID: stableID, messages: [stableMessage], queued: [], isRunning: false, workspace: "/tmp")
    let copy = try JSONDecoder().decode(ChatMessage.self, from: JSONEncoder().encode(stableMessage))
    try check(input == TranscriptRenderInput(sessionID: stableID, messages: [copy], queued: [], isRunning: false, workspace: "/tmp"), "same transcript must not reset selection")
    try check(input != TranscriptRenderInput(sessionID: stableID, messages: [copy], queued: [], isRunning: true, workspace: "/tmp"), "progress transition must update transcript")
    let code = TranscriptMarkdown.render("```tex\n$U_a$\n```\n`$x_1$`\n가격 $5 또는 $10\nPASS\\_WEAK", key: "code")
    var attachments = 0
    code.enumerateAttribute(.attachment, in: NSRange(location: 0, length: code.length)) { value, _, _ in if value != nil { attachments += 1 } }
    try check(attachments == 0 && code.string.contains("$U_a$") && code.string.contains("PASS_WEAK"), "code/currency/escape preservation")
    for unsupported in [#"$\notarealcommand{x}$"#, "$" + String(repeating: "x", count: 5000) + "$", #"${x$"#] {
        try check(MathTypesetter.copyable(MathTypesetter.render(unsupported)) == unsupported, "unsupported math source lost")
    }
    let block = "$$\n\\frac{1}{3}\n$$"
    try check(MathTypesetter.copyable(TranscriptMarkdown.render(block, key: "block")) == block, "display math copy")
    let multilingual = #"\[J\le1,\quad\text{모든 정확 게이트 통과},\quad\text{독립 재현 통과}.\]"#
    let mixedMath = MathTypesetter.render(multilingual, display: true)
    try check(mixedMath.string.contains("모든 정확 게이트 통과") && mixedMath.string.contains("독립 재현 통과"),
        "Korean conditions disappeared inside math")
    try check(MathTypesetter.copyable(mixedMath) == multilingual, "multilingual math copy changed source")
    let mixedScripts = #"$$J_{\text{exec}}=\max_i\frac{r_i}{\tau_i},\qquad\text{모든 게이트 통과}\iff J_{\text{exec}}\le1$$"#
    let mixedScriptsRendered = MathTypesetter.render(mixedScripts, display:true)
    try check(mixedScriptsRendered.string.contains("모든 게이트 통과") &&
        mixedScriptsRendered.attribute(.os1MathSource, at:0, effectiveRange:nil) as? String == mixedScripts &&
        MathTypesetter.copyable(mixedScriptsRendered) == mixedScripts, "ASCII scripts must not disable CJK top-level typesetting")
    let nestedCJK = #"$\frac{\text{한글}}{2}$"#
    let freshMixed = "\\[\n\\text{양자 채널}\n\\rightarrow\n\\text{정적 뉴턴 중력원}\n\\quad\\color{gray}{\\dashrightarrow}\\quad\n\\text{공변적 GR 이론}\n\\]"
    let freshMixedRendered = MathTypesetter.render(freshMixed, display: true)
    try check(!freshMixedRendered.string.contains("\\") && !freshMixedRendered.string.contains("$") &&
        !freshMixedRendered.string.contains("\n") && freshMixedRendered.string.contains("공변적 GR 이론"),
        "fresh multiline CJK/color/dashed arrow leaks raw TeX")
    try check(MathTypesetter.copyable(freshMixedRendered) == freshMixed, "fresh multilingual copy source changed")
    for formula in [#"$\color{gray}{\dashrightarrow}$"#, #"$\textcolor{blue}{\dashleftarrow}$"#] {
        let output = MathTypesetter.render(formula)
        try check(output.attribute(.attachment, at: 0, effectiveRange: nil) is NSTextAttachment &&
            MathTypesetter.copyable(output) == formula, "standard colored/dashed symbol unsupported")
    }
    try check(MathTypesetter.render(nestedCJK).string.contains("한글") &&
        MathTypesetter.copyable(MathTypesetter.render(nestedCJK)) == nestedCJK, "nested CJK must remain visible")

    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-interaction-test-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    var fixtures = (0..<35).map { number in
        var session = ConversationSession(workspace: "/tmp")
        session.title = "Fixture \(number)"
        session.updatedAt = Date(timeIntervalSince1970: Double(number + 1))
        session.messages = (0..<45).map { ChatMessage(role: .assistant, text: "Body \(number)-\($0)") }
        session.sourceContextVersion = 2
        return session
    }
    fixtures[0].messages[0] = ChatMessage(role: .assistant, text: String(repeating: "x", count: 121_000))
    try JSONEncoder().encode(SessionEnvelope(schema: 4, sessions: fixtures)).write(to: root.appendingPathComponent("sessions.json"))
    var openedBackendURLs: [URL] = []
    let store = SessionStore(storageRoot: root, nativeSessionOpener: { url in
        openedBackendURLs.append(url)
        return url.scheme == "claude"
    })
    let first = fixtures[0].id, second = fixtures[1].id
    try check(store.sessions.count == 35 && store.sessions.allSatisfy { $0.messages.count == 45 }, "old history truncated")
    store.select(first)
    let backendIndex = store.sessions.firstIndex(where: { $0.id == first })!
    store.sessions[backendIndex].provider = .claude
    let backendMessages = store.sessions[backendIndex].messages
    let backendProvider = store.sessions[backendIndex].provider
    let backendUpdatedAt = store.sessions[backendIndex].updatedAt
    store.surface = .codex
    store.showClodexHome()
    try check(store.surface == .auto && store.sessions[backendIndex].provider == backendProvider &&
        store.sessions[backendIndex].messages == backendMessages && store.sessions[backendIndex].updatedAt == backendUpdatedAt,
        "returning from backend inspection changed routing or conversation history")
    store.openInCodexDesktop()
    try check(openedBackendURLs.isEmpty, "unlinked rail opened an unrelated Codex session")
    store.alertMessage = nil
    store.sessions[backendIndex].claudeSessionID = "bae5987c-3fd1-4d08-a85c-6d9c18d41e86"
    store.openInClaudeDesktop()
    try check(openedBackendURLs.last?.absoluteString == "claude://resume?session=bae5987c-3fd1-4d08-a85c-6d9c18d41e86",
        "linked Claude rail did not open the recorded session")
    store.sessions[backendIndex].codexSessionID = "01a060ab-f53b-71c3-a38e-e77b1b98ea74"
    store.openInCodexDesktop()
    try check(openedBackendURLs.last?.absoluteString == "codex://threads/01a060ab-f53b-71c3-a38e-e77b1b98ea74" &&
        store.alertMessage != nil, "native open failure was not surfaced")
    try check(store.surface == .auto && store.sessions[backendIndex].provider == backendProvider &&
        store.sessions[backendIndex].messages == backendMessages && store.sessions[backendIndex].updatedAt == backendUpdatedAt,
        "backend inspection mutated routing or conversation history")
    store.alertMessage = nil
    store.togglePin(first)
    try check(store.filteredSessions.first?.id == first, "pin ordering")
    store.rename(first, title: "Renamed")
    store.setArchived(first, true)
    try check(!store.filteredSessions.contains { $0.id == first }, "archived still active")
    store.showArchived = true
    try check(store.filteredSessions.count == 1 && store.filteredSessions.first?.id == first, "archive lookup")
    store.setArchived(first, false); store.showArchived = false
    store.select(first); store.composer = "unsent draft"
    store.select(second); store.composer = "second draft"
    store.select(first)
    try check(store.composer == "unsent draft", "draft switch")
    store.togglePin(second) // persist both drafts synchronously
    let reloaded = SessionStore(storageRoot: root)
    try check(reloaded.sessions.count == 35 && reloaded.sessions.first(where: { $0.id == first })?.messages[0].text.count == 121_000,
        "save truncated history")
    reloaded.select(first)
    try check(reloaded.composer == "unsent draft" && reloaded.selectedSession?.title == "Renamed" && reloaded.selectedSession?.pinnedAt != nil,
        "metadata/draft restart")
    reloaded.search = "Body 2-44"
    try check(reloaded.filteredSessions.count == 1, "body search")
    reloaded.search = ""; reloaded.composer = ""
    reloaded.activeRuns[first] = .init(submissionID: UUID(), started: Date(), activity: RuntimeActivity(.preparing))
    reloaded.composer = "queued one"; reloaded.send()
    reloaded.composer = "queued two"; reloaded.send()
    try check(reloaded.queuedSubmissions.count == 2, "queue submission")
    let one = reloaded.queuedSubmissions[0].id, two = reloaded.queuedSubmissions[1].id
    let queuedReload = SessionStore(storageRoot: root)
    try check(!queuedReload.isRunning && queuedReload.queuedSubmissions.count == 2, "queue restart must await explicit resume")
    reloaded.prioritizeQueued(two)
    try check(reloaded.queuedSubmissions.first?.id == two, "queue ordering")
    reloaded.editQueued(one)
    try check(reloaded.composer == "queued one" && reloaded.queuedSubmissions.count == 1, "queue edit")
    reloaded.editQueued(two)
    try check(reloaded.composer == "queued one" && reloaded.queuedSubmissions.count == 1, "queue overwrote draft")
    reloaded.removeQueued(two)
    try check(reloaded.queuedSubmissions.isEmpty, "queue remove")
    let activity = RuntimeActivity(.executing, provider: "claude", model: "fixture", effort: "low")
    let activityData = try JSONEncoder().encode(activity)
    try check(try JSONDecoder().decode(RuntimeActivity.self, from: activityData) == activity, "activity serialization")
    let keys = Set((try JSONSerialization.jsonObject(with: activityData) as! [String: Any]).keys)
    try check(keys == ["phase", "provider", "model", "effort", "timestamp"], "activity schema disclosure")
    let process = Process()
    process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    process.arguments = ["--activity-fixture"]
    let activityURL = root.appendingPathComponent("activity.json")
    var env = ProcessInfo.processInfo.environment; env["OS1_ACTIVITY_FILE"] = activityURL.path
    process.environment = env
    try process.run()
    var phases: [RuntimeActivity.Phase] = []
    OS1Runner.observeActivity(process, at: activityURL) { phases.append($0.phase) }
    try check(process.terminationStatus == 0 && phases == [.source, .executing, .verifying], "real child-process activity observation")
}

private enum ComposerReturnAction: Equatable {
    case send
    case newline
}

/// Real asynchronous SessionStore scheduling, with isolated child-process
/// fixtures instead of paid model calls. Nothing is written to user sessions.
@MainActor
private func parallelInteractionSelfTest() async throws {
    var checks = 0
    func check(_ value: @autoclosure () -> Bool, _ message: String) throws {
        if !value() { throw RunnerError.message(message) }
        checks += 1
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-parallel-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    var started: [String: Date] = [:], ended: [String: Date] = [:], contexts: [String: String] = [:]
    var childIDs = Set<Int32>()
    var peak = 0, current = 0, failures = 0
    let store = SessionStore(storageRoot: root, runOperation: { submission, context, _, _, onActivity in
        let name = submission.request
        started[name] = Date(); contexts[name] = context
        current += 1; peak = max(peak, current)
        onActivity(RuntimeActivity(.executing, provider: name == "A1" ? "claude" : "codex"))
        let pid = try await Task.detached { () throws -> Int32 in
            let child = Process(); child.executableURL = URL(fileURLWithPath: "/bin/sleep")
            child.arguments = [name == "A1" ? "1.2" : "0.6"]
            try child.run(); child.waitUntilExit()
            guard child.terminationStatus == 0 else { throw RunnerError.message("fixture child failed") }
            return child.processIdentifier
        }.value
        childIDs.insert(pid); current -= 1; ended[name] = Date()
        if name == "FAIL", failures == 0 {
            failures += 1
            throw RunnerError.message("fixture failure retained in its conversation")
        }
        return AppRunSummary(status: "complete", steps: [AppRunStep(sequence: 1, provider: "codex",
            action: "test", model: "fixture", effort: "low", revasDisposition: "adopted", sessionID: UUID().uuidString,
            permissionProfile: "read_only", exitCode: 0, output: "answer " + name, stderr: "", durationMS: 600,
            nativeRecord: nil)])
    })
    let a = store.selectedSessionID!
    store.composer = "A1"; store.send()
    store.composer = "A2"; store.send()
    store.createSession(); let b = store.selectedSessionID!
    store.composer = "B1"; store.send()
    try check(store.activeRuns.count == 2 && store.queuedSubmissions.count == 1, "A2 must queue while B1 starts")
    try await Task.sleep(for: .milliseconds(180))
    try check(store.pendingProvider == .codex, "selected B activity leaked A provider")
    store.select(a)
    try check(store.pendingProvider == .claude, "switch must restore A activity")
    store.createSession(); let idle = store.selectedSessionID!
    store.composer = "preserve unsent draft"
    let idleStatus = store.statusText
    let deadline = Date().addingTimeInterval(12)
    while !store.activeRuns.isEmpty && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
    try check(store.activeRuns.isEmpty && store.queuedSubmissions.isEmpty, "scheduler did not drain")
    try check(peak >= 2 && childIDs.count == 3, "different sessions must overlap real child processes")
    try check(started["B1"]! < ended["A1"]! && started["A2"]! >= ended["A1"]!, "FIFO/overlap interval invariant")
    // Compare conversational text, not the serialized envelope: a random UUID
    // legitimately contains "A1" and used to make this assertion flaky.
    let aContext = try SessionHandoff.decode(contexts["A2"])
    let bContext = try SessionHandoff.decode(contexts["B1"])
    let coincidentID = try SessionHandoff(transcript: "USER:\nB1", source: SourceReference(kind: .snapshot,
        id: UUID(uuidString: "00000000-0000-4000-8000-0000000000A1")!, sha256: String(repeating: "b", count: 64))).encoded()
    let coincidentTranscript = try SessionHandoff.decode(coincidentID).transcript
    try check(aContext.transcript.contains("answer A1") && !bContext.transcript.contains("A1") &&
        coincidentID.contains("A1") && !coincidentTranscript.contains("A1"), "cross-session context or stale FIFO handoff")
    try check(store.selectedSessionID == idle && store.composer == "preserve unsent draft" && store.statusText == idleStatus,
        "background completion overwrote foreground state")
    store.select(b); store.composer = "FAIL"; store.send()
    store.select(a); store.composer = "A3"; store.send()
    while !store.activeRuns.isEmpty && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
    try check(store.sessions.first(where: { $0.id == b })!.messages.last!.text.contains("fixture failure"), "error lost")
    try check(store.sessions.first(where: { $0.id == a })!.messages.contains(where: { $0.text == "answer A3" }), "failure blocked other session")
    try check(!store.statusText.contains("attention"), "background failure overwrote active result status")
    store.select(b)
    let failedUserCount = store.selectedSession!.messages.filter { $0.role == .user }.count
    try check(store.selectedSession!.lastFailure?.request == "FAIL", "failed request must be retryable inside OS-1")
    store.retrySelectedFailure()
    while !store.activeRuns.isEmpty && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
    try check(store.selectedSession!.lastFailure == nil && store.selectedSession!.messages.contains(where: { $0.text == "answer FAIL" }) &&
        store.selectedSession!.messages.filter { $0.role == .user }.count == failedUserCount, "explicit retry duplicated the user turn or lost result")
    let reloaded = SessionStore(storageRoot: root)
    try check(reloaded.sessions.count == 3 && reloaded.activeRuns.isEmpty, "restart state changed")
    // Admission limit and fairness: fifth distinct conversation queues, not
    // lost or prematurely launched, and starts after any running one finishes.
    for n in 0..<5 { store.createSession(); store.composer = "limit-\(n)"; store.send() }
    try check(store.activeRuns.count == 4 && store.queuedSubmissions.count == 1, "unbounded parallel admission")
    let restartRoot = root.appendingPathComponent("restart")
    try FileManager.default.createDirectory(at: restartRoot, withIntermediateDirectories: true)
    try FileManager.default.copyItem(at: root.appendingPathComponent("sessions.json"), to: restartRoot.appendingPathComponent("sessions.json"))
    let restarted = SessionStore(storageRoot: restartRoot, runOperation: { submission, _, _, _, _ in
        try await Task.sleep(for: .milliseconds(100))
        throw RunnerError.message("restart fixture")
    })
    let suspendedID = restarted.queuedSubmissions.first!.id
    restarted.createSession(); restarted.composer = "unrelated new work"; restarted.send()
    try await Task.sleep(for: .milliseconds(250))
    try check(restarted.activeRuns.isEmpty && restarted.queuedSubmissions.map(\.id) == [suspendedID],
        "new work must not implicitly resume an old persisted queue")
    restarted.removeQueued(suspendedID)
    try check(restarted.queuedSubmissions.isEmpty, "cancelled persisted task remains queued")
    while !store.activeRuns.isEmpty && Date() < deadline { try await Task.sleep(for: .milliseconds(100)) }
    try check(peak == 4 && ended["limit-4"] != nil && store.queuedSubmissions.isEmpty, "bounded queue starvation")
    // A provider may have changed remote state before timing out. Preserve its
    // identity, pause this session's dependents, and never map Retry to replay.
    let recoveryRoot = root.appendingPathComponent("recovery")
    let recoverySource = try SourceContextStore(root: recoveryRoot).write(Data("fixture source survives interruption".utf8))
    var recoveryRequests: [PendingSubmission] = []
    let interruptedID = UUID().uuidString.lowercased()
    let recoveryStore = SessionStore(storageRoot: recoveryRoot, runOperation: { submission, context, _, claudeID, _ in
        recoveryRequests.append(submission)
        try await Task.sleep(for: .milliseconds(120))
        if submission.request == "DEPLOY" {
            throw RunnerError.backend(BackendFailureNotice(provider: "claude", sessionID: interruptedID,
                blocker: .effectsUncertain, dispatchStage: .dispatched, source: recoverySource,
                permissionProfile: "workspace_write", publicProgress: "step one recorded; remote outcome unknown"))
        }
        if submission.readOnlyReconciliation == true {
            try check(claudeID == interruptedID && context.contains("DEPLOY") && context.contains("step one recorded"), "readback lost interrupted session, objective or progress")
        }
        var returnedContext = try SessionHandoff.decode(context).taskContext
        if submission.readOnlyReconciliation == true {
            returnedContext?.setObjective(TaskContext.Objective(requestText: submission.request, kind: .explain, scope: .readOnly))
        }
        return AppRunSummary(status: "complete", steps: [AppRunStep(sequence: 1, provider: "codex",
            action: "test", model: "fixture", effort: "low", revasDisposition: "adopted", sessionID: UUID().uuidString,
            permissionProfile: "read_only", exitCode: 0, output: "verified readback only", stderr: "", durationMS: 120, nativeRecord: nil)],
            taskContext: returnedContext)
    })
    let recoveryID = recoveryStore.selectedSessionID!
    recoveryStore.composer = "DEPLOY"; recoveryStore.send()
    let originalObjectiveID = recoveryStore.selectedSession!.taskContext!.objectiveID
    recoveryStore.composer = "AFTER DEPLOY"; recoveryStore.send()
    recoveryStore.createSession(); recoveryStore.composer = "INDEPENDENT"; recoveryStore.send()
    while !recoveryStore.activeRuns.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
    recoveryStore.select(recoveryID)
    try check(recoveryStore.selectedSession!.claudeSessionID == interruptedID, "failed native session must remain inspectable")
    try check(recoveryStore.selectedSession!.lastBackendFailure?.requiresReadback == true, "typed blocker lost")
    try check(recoveryStore.selectedSession!.sourceContext == recoverySource, "interrupted source snapshot lost")
    try check(recoveryRequests.count == 3 && recoveryRequests.filter { $0.readOnlyReconciliation == true }.count == 1 &&
        recoveryRequests.contains(where: { $0.request == "INDEPENDENT" }), "automatic recovery absent, replayed dependent or blocked independent work")
    try check(recoveryStore.selectedSession!.taskContext!.objectiveID == originalObjectiveID &&
        recoveryStore.selectedSession!.taskContext!.objective.requestText == "DEPLOY", "internal recovery replaced original objective")
    try check(recoveryStore.selectedSession!.messages.filter { $0.role == .user }.map(\.text) == ["DEPLOY"], "synthetic user turn leaked")
    try check(recoveryStore.selectedSession!.lastFailure?.request == "DEPLOY" &&
        recoveryStore.selectedSession!.lastFailure?.recoveryAttempted == true && recoveryStore.statusText.contains("미완료"), "readback falsely completed original work")
    recoveryStore.resumeQueue()
    try check(recoveryStore.activeRuns.isEmpty && recoveryStore.queuedSubmissions.count == 1, "resume-all bypassed unresolved failure")
    let recoveredStore = SessionStore(storageRoot: recoveryRoot)
    try check(recoveredStore.sessions.first(where: { $0.id == recoveryID })?.lastBackendFailure?.sessionID == interruptedID,
        "restart lost failure custody")
    recoveryStore.retrySelectedFailure()
    while !recoveryStore.activeRuns.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
    try check(recoveryRequests.count == 4 && recoveryRequests.last?.readOnlyReconciliation == true,
        "retry must request a read-only assessment instead of replay")
    try check(recoveryRequests.last?.provider == .auto && recoveryRequests.last?.request.contains("DEPLOY") == true,
        "readback lost routing or objective")
    try check(recoveryRequests.filter { $0.request == "DEPLOY" }.count == 1 && recoveryStore.queuedSubmissions.count == 1,
        "assessment replayed the original action or implicitly resumed dependents")
    let savedReadback = try JSONDecoder().decode(PendingSubmission.self, from: JSONEncoder().encode(recoveryRequests.last!))
    try check(savedReadback.readOnlyReconciliation == true && savedReadback.recoveryParentID != nil, "read-only and original-request boundary must survive persistence")
    let reviewCrashRoot = root.appendingPathComponent("review-crash")
    try FileManager.default.createDirectory(at: reviewCrashRoot, withIntermediateDirectories: true)
    var interruptedEnvelope = try JSONSerialization.jsonObject(with: Data(contentsOf: recoveryRoot.appendingPathComponent("sessions.json"))) as! [String: Any]
    interruptedEnvelope["inFlight"] = [try JSONSerialization.jsonObject(with: JSONEncoder().encode(savedReadback))]
    try JSONSerialization.data(withJSONObject: interruptedEnvelope).write(to: reviewCrashRoot.appendingPathComponent("sessions.json"))
    let reviewCrashStore = SessionStore(storageRoot: reviewCrashRoot)
    let crashSession = reviewCrashStore.sessions.first { $0.id == recoveryID }!
    try check(crashSession.lastFailure?.request == "DEPLOY" && crashSession.taskContext?.objectiveID == originalObjectiveID &&
        crashSession.lastFailure?.recoveryAttempted == true && reviewCrashStore.activeRuns.isEmpty,
        "crash during readback replaced original objective or automatically restarted")
    // Automatic inspection can also fail. Preserve the same original request,
    // never recursively inspect an inspection or silently open another writer.
    var failedReviewCalls = 0
    let failedReviewRoot = root.appendingPathComponent("failed-review")
    let failedReviewStore = SessionStore(storageRoot: failedReviewRoot, runOperation: { submission, _, _, _, _ in
        failedReviewCalls += 1
        try await Task.sleep(for: .milliseconds(50))
        throw RunnerError.backend(BackendFailureNotice(provider: "claude", sessionID: interruptedID,
            blocker: .effectsUncertain, dispatchStage: .dispatched, permissionProfile: "workspace_write"))
    })
    failedReviewStore.composer = "DEPLOY ONCE"; failedReviewStore.send()
    while !failedReviewStore.activeRuns.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
    try check(failedReviewCalls == 2 && failedReviewStore.selectedSession!.lastFailure?.request == "DEPLOY ONCE",
        "failed reconciliation recursed or replaced original work")
    let failedReviewReload = SessionStore(storageRoot: failedReviewRoot)
    try check(failedReviewReload.selectedSession!.lastFailure?.recoveryAttempted == true &&
        failedReviewReload.selectedSession!.taskContext?.objective.requestText == "DEPLOY ONCE", "restart forgot recovery budget or objective")
    // A stop can race with a previously emitted effects-uncertain notice.
    var cancelledCalls = 0
    let cancelledStore = SessionStore(storageRoot: root.appendingPathComponent("cancel-review"), runOperation: { _, _, _, _, _ in
        cancelledCalls += 1
        try await Task.sleep(for: .milliseconds(150))
        throw RunnerError.backend(BackendFailureNotice(provider: "claude", sessionID: interruptedID,
            blocker: .effectsUncertain, dispatchStage: .dispatched, permissionProfile: "workspace_write"))
    })
    cancelledStore.composer = "CANCEL THIS WRITE"; cancelledStore.send()
    let cancelledSubmission = cancelledStore.activeRuns[cancelledStore.selectedSessionID!]!.submissionID
    cancelledStore.cancelSelectedRun()
    while !cancelledStore.activeRuns.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
    try check(cancelledCalls == 1 && cancelledStore.selectedSession!.lastFailure?.recoveryAttempted != true,
        "cancellation raced into automatic recovery")
    try? FileManager.default.removeItem(at: ExecutionCancellation.url(submissionID: cancelledSubmission))
    // The preparation boundary precedes model dispatch, but must still return
    // its observation and unfinished objective to this same manager.
    let sourceRoot = root.appendingPathComponent("source-pending"), registrationRoot = root.appendingPathComponent("registry")
    let manifestHash = String(repeating: "c", count: 64)
    let liveData = try JSONSerialization.data(withJSONObject: ["ok": true, "release": ["ok": true, "mode": "production",
        "release_phase": "active", "phase_ready": true, "release_id": "scv-instagram-single-20260907-v161",
        "content_fingerprint_sha256": String(repeating: "b", count: 64), "release_manifest_sha256": manifestHash]])
    let live = try SCVLiveRelease(data: liveData)
    var preparationCalls = 0
    let sourceStore = SessionStore(storageRoot: sourceRoot, runOperation: { submission, context, _, _, _ in
        preparationCalls += 1
        var state = try SessionHandoff.decode(context).taskContext!
        state.sourcePreparation = SourcePreparationState(live: live, reason: "publication pending")
        state.touch()
        return AppRunSummary(status: "source_pending", steps: [AppRunStep(sequence: 1, provider: "local",
            action: "source_preparation_pending", model: nil, effort: "none", revasDisposition: "pending",
            sessionID: UUID().uuidString, permissionProfile: "local_control", exitCode: 0,
            output: "fixture exact source not acquired; original objective retained", stderr: "", durationMS: 1, nativeRecord: nil)], taskContext: state)
    })
    let prepareRequest = "야 인스타그램 오토메이션 수정해야 되니까 준비해라"
    sourceStore.composer = prepareRequest; sourceStore.send()
    while !sourceStore.activeRuns.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
    let sourceID = sourceStore.selectedSessionID!, originalID = sourceStore.selectedSession!.taskContext!.objectiveID
    try check(sourceStore.selectedSession!.taskContext?.sourcePreparation?.manifestSHA256 == manifestHash &&
        sourceStore.selectedSession!.lastFailure?.request == prepareRequest &&
        sourceStore.selectedSession!.taskContext?.objective.scope == .readOnly,
        "preflight lost source identity/objective or granted writes to a preparation-only request")
    let pendingReload = SessionStore(storageRoot: sourceRoot)
    try check(pendingReload.selectedSession!.taskContext?.sourcePreparation?.releaseID == live.id &&
        pendingReload.selectedSession!.taskContext?.objectiveID == originalID, "pending source lost at restart")
    sourceStore.resumeRegisteredSourcePreparations(root: registrationRoot)
    try check(preparationCalls == 1, "source polling must not retry without new evidence")
    let incoming = registrationRoot.appendingPathComponent(manifestHash).appendingPathComponent("source.tar.gz")
    try FileManager.default.createDirectory(at: incoming.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("fixture registration arrival; verifier mocked here, real archive checked in context tests".utf8).write(to: incoming)
    sourceStore.createSession(); let foregroundID = sourceStore.selectedSessionID!
    sourceStore.composer = "untouched draft"
    sourceStore.resumeRegisteredSourcePreparations(root: registrationRoot)
    while !sourceStore.activeRuns.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
    sourceStore.resumeRegisteredSourcePreparations(root: registrationRoot)
    try check(preparationCalls == 2 && sourceStore.activeRuns.isEmpty, "pending preparation spun indefinitely on the same artifact")
    let retriedSession = sourceStore.sessions.first { $0.id == sourceID }!
    try check(retriedSession.messages.filter { $0.role == .user }.map(\.text) == [prepareRequest] &&
        retriedSession.taskContext?.objectiveID == originalID, "automatic preparation recovery duplicated or replaced user objective")
    try check(sourceStore.selectedSessionID == foregroundID && sourceStore.composer == "untouched draft", "background acquisition stole foreground/draft")
    let retryReload = SessionStore(storageRoot: sourceRoot)
    try check(retryReload.sessions.first { $0.id == sourceID }?.lastFailure?.sourceRetryIdentity == manifestHash,
        "source retry budget not persisted")
    print("Parallel sessions: \(checks) checks passed; real child-process overlap, per-session FIFO/context/status, explicit retry, four-session limit, paused restart/cancellation")
}

/// Exercise the actual manager, not a stand-alone Array FIFO. Runner gates
/// make edit/completion races reproducible without model tokens or live writes.
@MainActor
private func queueForkInteractionSelfTest() async throws {
    var checks = 0
    func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else { throw RunnerError.message("Queue/fork: " + message) }; checks += 1
    }
    func eventually(_ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(8)
        while !condition(), Date() < deadline { try await Task.sleep(for: .milliseconds(10)) }
        try check(condition(), "asynchronous scheduler deadline")
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-queue-fork-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    var starts: [PendingSubmission] = [], contexts: [String: SessionHandoff] = [:]
    var gates: [String: CheckedContinuation<Void, Never>] = [:]
    var failures = 0, opens = 0
    let store = SessionStore(storageRoot: root, runOperation: { submission, encoded, codex, claude, _ in
        starts.append(submission); contexts[submission.request] = try SessionHandoff.decode(encoded)
        await withCheckedContinuation { gates[submission.request] = $0 }
        if submission.request == "FAIL", failures == 0 {
            failures += 1; throw RunnerError.message("controlled preflight failure")
        }
        if submission.request == "CHILD" { try check(codex == nil && claude == nil, "fork reused a native writer") }
        return AppRunSummary(status: "complete", steps: [AppRunStep(sequence: 1,
            provider: submission.provider == .claude ? "claude" : "codex", action: "fixture", model: "fixture", effort: "none",
            revasDisposition: "adopted", sessionID: UUID().uuidString, permissionProfile: "read_only", exitCode: 0,
            output: "answer " + submission.request, stderr: "", durationMS: 0, nativeRecord: nil)])
    }, nativeSessionOpener: { _ in opens += 1; return false })
    func finish(_ name: String) async throws {
        try await eventually { gates[name] != nil }
        gates.removeValue(forKey: name)!.resume()
    }
    let parent = store.selectedSessionID!
    let source = try SourceContextStore(root: root).write(Data("verified fixture source".utf8))
    store.sessions[0].messages = [ChatMessage(role: .user, text: "seed"), ChatMessage(role: .assistant, text: "seed answer")]
    store.sessions[0].sourceContext = source
    store.sessions[0].codexSessionID = UUID().uuidString
    store.sessions[0].claudeSessionID = UUID().uuidString
    store.sessions[0].taskContext = migratedTaskContext(store.sessions[0], sourceContext: source)
    store.sessions[0].taskContext?.decideSemantic("keep the verified source")
    // A completed native ingestion or source/decision edit can be newer than
    // the last OS1 execution checkpoint. Fork must capture that current state.
    store.sessions[0].completedForkCheckpoint = ConversationForkCheckpoint(
        throughMessageID: nil, source: nil, context: nil)
    let parentSeed = store.sessions[0].messages
    store.composer = "A"; store.send()
    let revision = store.selectedSession!.taskContext!.contextRevision
    store.composer = "B"; store.send(); store.composer = "C"; store.send()
    try check(store.activeRuns.count == 1 && store.queuedSubmissions.map(\.request) == ["B", "C"], "rapid inputs did not queue")
    try check(store.selectedSession!.taskContext!.contextRevision == revision, "queued input changed active objective")
    try check(store.queueReason(parent).contains("자동 실행"), "normal wait reason absent")
    let b = store.queuedSubmissions[0], c = store.queuedSubmissions[1]
    try check(store.beginQueueEdit(b.id), "edit lease unavailable")
    store.composer = "draft kept in parent"
    try check(store.updateQueued(b.id, request: "B edited"), "in-place queue update")
    try check(store.queuedSubmissions[0].id == b.id && store.queuedSubmissions[0].userMessageID == b.userMessageID &&
        store.queuedSubmissions[0].workspace == b.workspace && store.queuedSubmissions[0].codexCapacity == b.codexCapacity &&
        store.composer == "draft kept in parent", "edit changed identity/position/preferences/draft")
    try check(!store.updateQueued(b.id, request: " \n "), "empty queue update accepted")
    let child = store.forkSession(parent)!
    try check(child != parent && store.selectedSession!.messages == parentSeed, "fork included active/queued/partial messages")
    try check(store.selectedSession!.sourceContext == source && store.selectedSession!.taskContext?.sources.first?.reference == source,
        "fork source lost")
    try check(store.selectedSession!.taskContext?.conversationID == child && store.selectedSession!.taskContext?.bindings.isEmpty == true &&
        store.selectedSession!.taskContext?.executions.isEmpty == true && store.selectedSession!.codexSessionID == nil &&
        store.selectedSession!.claudeSessionID == nil, "fork identity or execution ownership shared")
    try check(store.selectedSession!.taskContext?.decisions.first?.text == "keep the verified source", "fork decision lost")
    try check(store.selectedSession!.forkedFrom?.conversationID == parent && store.activeRuns.count == 1 &&
        store.queuedSubmissions.count == 2 && store.sessions.first { $0.id == parent }?.draft == "draft kept in parent",
        "fork changed parent queue/run/draft")
    store.composer = "CHILD"; store.send()
    try await eventually { starts.count == 2 }
    try check(store.activeRuns.count == 2, "fork cannot run independently")
    try await finish("A")
    try await eventually { !store.isSessionRunning(parent) }
    try check(starts.map(\.request).sorted() == ["A", "CHILD"], "editing item or successor ran early")
    store.select(parent)
    try check(store.queueReason(parent).contains("編") == false && store.queueReason(parent).contains("편집"), "edit wait reason absent")
    store.pauseQueue(parent); store.endQueueEdit(b.id)
    try check(store.canResumeQueue(parent) && store.queueReason(parent).contains("일시정지"), "manual pause absent")
    store.shiftQueued(c.id, down: false)
    try check(store.queuedSubmissions.map(\.id) == [c.id, b.id], "move up failed")
    store.shiftQueued(c.id, down: true)
    try check(store.queuedSubmissions.map(\.id) == [b.id, c.id], "move down failed")
    store.removeQueued(c.id)
    try check(store.queuedSubmissions.map(\.id) == [b.id], "queue cancel lost another input")
    store.resumeQueue(parent)
    try await eventually { starts.contains { $0.request == "B edited" } }
    try check(contexts["B edited"]!.transcript.contains("answer A") && !contexts["B edited"]!.transcript.contains("CHILD"),
        "queue used stale/cross-fork context")
    try check(contexts["B edited"]!.source == source, "queue lost source")
    try await finish("B edited"); try await finish("CHILD")
    try await eventually { store.activeRuns.isEmpty }
    try check(store.queuedSubmissions.isEmpty && starts.filter { $0.id == b.id }.count == 1 && !starts.contains { $0.id == c.id },
        "duplicate dispatch or cancelled input executed")
    try check(store.composer == "draft kept in parent" && opens == 0, "background completion stole draft or opened backend")
    // Generic errors previously drained dependent inputs; a successful retry
    // must unblock these, unlike manual/restart holds or uncertain write review.
    store.composer = "FAIL"; store.send(); store.composer = "AFTER"; store.send()
    try await finish("FAIL"); try await eventually { store.activeRuns.isEmpty }
    try check(store.queuedSubmissions.count == 1 && !starts.contains { $0.request == "AFTER" } &&
        store.queueReason(parent).contains("이전 작업"), "generic failure executed dependents")
    store.resumeQueue(parent)
    try check(store.activeRuns.isEmpty, "resume bypassed failure")
    store.retrySelectedFailure(); try await finish("FAIL")
    try await eventually { starts.contains { $0.request == "AFTER" } }
    try await finish("AFTER"); try await eventually { store.activeRuns.isEmpty }
    try check(store.queuedSubmissions.isEmpty && store.selectedSession!.messages.filter { $0.role == .user && $0.text == "FAIL" }.count == 1,
        "successful recovery left queue stuck or duplicated user")
    // Pause/restart/resume is local to the selected conversation, never global.
    store.pauseQueue(parent); store.composer = "P1"; store.send()
    store.select(child); store.pauseQueue(child); store.composer = "P2"; store.send()
    store.flushPendingState()
    var resumed: [String] = []
    let reloaded = SessionStore(storageRoot: root, runOperation: { submission, _, _, _, _ in
        resumed.append(submission.request); throw RunnerError.message("restart fixture")
    })
    try check(reloaded.activeRuns.isEmpty && reloaded.queuedSubmissions.count == 2 &&
        reloaded.sessions.first { $0.id == child }?.forkedFrom?.conversationID == parent, "restart lost queues/fork origin")
    reloaded.select(parent); reloaded.resumeQueue()
    try await eventually { resumed.count == 1 && reloaded.activeRuns.isEmpty }
    try check(resumed == ["P1"] && reloaded.queuedSubmissions.map(\.request) == ["P2"], "local resume ran another chat")
    // Check queue editor Return guard (actual key dispatch is also UI-tested).
    try check(composerReturnAction(shiftPressed: false) == .send && composerReturnAction(shiftPressed: true) == .newline,
        "Enter/Shift+Enter regression")
    print("Queue/fork interactions: \(checks) checks passed; model calls 0; native opens \(opens); real SessionStore FIFO/edit/reorder/pause/recovery/fork/context/restart")
}

@MainActor
private func steeringInteractionSelfTest() async throws {
    var checks = 0
    func check(_ condition: Bool, _ message: String) throws {
        guard condition else { throw RunnerError.message("Steering: " + message) }; checks += 1
    }
    func eventually(_ condition: () -> Bool) async throws {
        let end = Date().addingTimeInterval(8)
        while !condition(), Date() < end { try await Task.sleep(for: .milliseconds(10)) }
        try check(condition(), "scheduler deadline")
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-steering-ui-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let mailbox = ExecutionSteering(root: root.appendingPathComponent("run-steering"))
    var starts: [PendingSubmission] = []
    var gates: [UUID: CheckedContinuation<Void, Never>] = [:]
    let store = SessionStore(storageRoot: root, runOperation: { submission, _, _, _, _ in
        starts.append(submission)
        await withCheckedContinuation { gates[submission.sessionID] = $0 }
        return AppRunSummary(status: "complete", steps: [AppRunStep(sequence: 1, provider: "codex",
            action: "fixture", model: "fixture", effort: "none", revasDisposition: "adopted",
            sessionID: UUID().uuidString, permissionProfile: "workspace_write", exitCode: 0,
            output: "정정을 적용한 fixture 답변", stderr: "", durationMS: 0, nativeRecord: nil)],
            persistedCorrectionIDs: mailbox.persistedIDs(submission.id))
    })
    let original = "테스트 파일을 수정해. 운영 배포 금지."
    let correction = "그 말이 아니라, 다시 물어보지 말고 문맥상 명백한 오타를 처리해."
    let parent = store.selectedSessionID!
    store.composer = original; store.send()
    try await eventually { gates[parent] != nil }
    let active = store.activeRuns[parent]!, objective = store.selectedSession!.taskContext!.objectiveID
    let scope = store.selectedSession!.taskContext!.objective.scope
    store.composer = correction; store.send()
    try check(store.queuedSubmissions.count == 1 && store.queuedSubmissions[0].executionRequest.contains(original), "cold amendment lost original task")
    store.activeRuns[parent]?.provider = .codex
    store.activeRuns[parent]?.activity = RuntimeActivity(.executing, provider: "codex")
    try mailbox.open(submissionID: active.submissionID, threadID: "fixture-thread", turnID: "fixture-turn")
    try await eventually { store.queuedSubmissions.isEmpty && mailbox.inputs(active.submissionID).count == 1 }
    try check(store.selectedSession!.messages.filter { $0.text == correction }.count == 1 &&
        store.selectedSession!.taskContext!.objectiveID == objective && store.selectedSession!.taskContext!.objective.scope == scope,
        "promotion duplicated input or replaced authorized objective")
    try check(store.correctionDeliveryLabel!.contains("확인 중"), "premature accepted label")
    let first = mailbox.inputs(active.submissionID)[0]
    try mailbox.record(first, state: .sending, threadID: "fixture-thread", turnID: "fixture-turn")
    try mailbox.record(first, state: .accepted, threadID: "fixture-thread", turnID: "fixture-turn")
    try check(store.correctionDeliveryLabel!.contains("전달됨"), "ack not visible")
    store.composer = "추가 정정 두 번째"; store.sendCorrectionToCurrentRun()
    try check(mailbox.inputs(active.submissionID).count == 2 && starts.count == 1 && !store.isStopping, "explicit action restarted task")
    store.composer = "일반 후속 질문"; store.send()
    try check(store.queuedSubmissions.map(\.request) == ["일반 후속 질문"], "ordinary input not FIFO")
    let queued = store.queuedSubmissions[0]
    try check(store.canSteerQueued(queued), "queue steering unavailable on live turn")
    try check(store.beginQueueEdit(queued.id) && !store.canSteerQueued(queued), "editing input may be delivered")
    store.endQueueEdit(queued.id)
    store.steerQueued(queued.id); store.steerQueued(queued.id)
    try check(store.queuedSubmissions.isEmpty && mailbox.inputs(active.submissionID).count == 3 && starts.count == 1,
        "queue steering duplicated delivery or started another turn")
    try check(store.selectedSession!.messages.filter { $0.id == queued.userMessageID }.count == 1,
        "queue-to-steer duplicated user bubble")
    try check(ExecutionSteering.isDirectCorrection(correction.decomposedStringWithCanonicalMapping), "NFD correction not recognized")
    store.composer = "순서를 기다릴 후속 질문"; store.send()
    store.flushPendingState()
    let disk = try JSONDecoder().decode(SessionEnvelope.self, from: Data(contentsOf: root.appendingPathComponent("sessions.json")))
    try check(disk.inFlight?.first?.liveCorrections?.count == 3, "on-disk amendments absent: \(String(describing: store.alertMessage))")
    let reloaded = SessionStore(storageRoot: root)
    try check(reloaded.activeRuns.isEmpty, "restart replayed work")
    try check(reloaded.sessions.first { $0.id == parent }?.lastFailure?.liveCorrections?.count == 3,
        "restart lost corrections: \(String(describing: reloaded.sessions.first { $0.id == parent }?.lastFailure?.liveCorrections))")
    try check(reloaded.sessions.first { $0.id == parent }?.lastFailure?.executionRequest.contains(original) == true,
        "restart lost original")
    store.createSession(); let other = store.selectedSessionID!
    store.composer = "두 번째 독립 작업"; store.send()
    try await eventually { gates[other] != nil }
    try check(!store.canSteerSelectedRun && mailbox.inputs(store.activeRuns[other]!.submissionID).isEmpty, "cross-session delivery")
    store.select(parent); store.pauseQueue(parent)
    for input in mailbox.inputs(active.submissionID) {
        try mailbox.record(input, state: .persisted, threadID: "fixture-thread", turnID: "fixture-turn")
    }
    gates.removeValue(forKey: parent)!.resume()
    try await eventually { !store.isSessionRunning(parent) }
    try check(store.selectedSession!.lastFailure == nil && store.selectedSession!.messages.contains { $0.text.contains("정정 3건") } && starts.count == 2,
        "verified current-turn correction rejected or extra turn started")
    store.composer = "그 말이 아니라, 조건을 바꿔"; store.send()
    try check(store.queuedSubmissions.last!.amendedRequest?.contains(original) == true, "late correction became standalone")
    store.select(other)
    let second = store.activeRuns[other]!.submissionID
    store.activeRuns[other]?.provider = .codex
    store.activeRuns[other]?.activity = RuntimeActivity(.executing, provider: "codex")
    try mailbox.open(submissionID: second, threadID: "other", turnID: "other-turn")
    store.composer = correction; store.send()
    let denied = mailbox.inputs(second)[0]
    try mailbox.record(denied, state: .rejected, threadID: "other", turnID: "other-turn")
    try check(store.correctionDeliveryLabel!.contains("거절"), "denial not visible")
    gates.removeValue(forKey: other)!.resume()
    try await eventually { !store.isSessionRunning(other) }
    try check(store.selectedSession!.lastFailure?.liveCorrections == [correction] && starts.count == 2 &&
        store.selectedSession!.messages.contains { $0.role == .assistant && $0.nativeRecordVerified == false },
        "unconfirmed correction adopted or replayed")
    store.sessions[store.selectedIndex!].lastBackendFailure = BackendFailureNotice(provider: "codex", sessionID: nil,
        blocker: .effectsUncertain, dispatchStage: .dispatched)
    store.reconcileSelectedFailure()
    try await eventually { gates[other] != nil }
    let recovery = store.activeRuns[other]!.submissionID
    store.activeRuns[other]?.provider = .codex
    store.activeRuns[other]?.activity = RuntimeActivity(.executing, provider: "codex")
    try mailbox.open(submissionID: recovery, threadID: "recovery", turnID: "read-only-turn")
    store.composer = "이 요청으로 지금 파일을 고쳐"; store.send()
    try check(!store.canSteerSelectedRun && !store.canSteerQueued(store.queuedSubmissions.last!) && mailbox.inputs(recovery).isEmpty,
        "read-only reconciliation was redirected into a mutation")
    store.pauseQueue(other)
    gates.removeValue(forKey: other)!.resume()
    try await eventually { !store.isSessionRunning(other) }
    print("Live corrections: \(checks) checks passed; model calls 0; same-task/ACK/persistence/FIFO/isolation/restart/stale-result")
}

@MainActor
private func replacementInteractionSelfTest() async throws {
    var checks = 0
    func check(_ value: Bool, _ reason: String) throws {
        guard value else { throw RunnerError.message("Replacement: " + reason) }; checks += 1
    }
    func eventually(_ value: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(6)
        while !value(), Date() < deadline { try await Task.sleep(for: .milliseconds(10)) }
        try check(value(), "scheduler deadline")
    }
    let replacement = "아 그거 하지 말고 R2에 있는 QMGR 통합하는거 가져와봐"
    try check(ExecutionSteering.isTaskReplacement(replacement.decomposedStringWithCanonicalMapping), "NFD task replacement")
    try check(ExecutionSteering.isIndependentRead(replacement), "read-only retrieval admission")
    for write in [replacement + " 그리고 배포해", "R2 자료 가져와서 파일을 수정해", "fetch source and deploy it"] {
        try check(!ExecutionSteering.isIndependentRead(write), "mixed mutation admitted as read")
    }
    for quote in ["> " + replacement, "```\n" + replacement + "\n```", "문서에 ‘그거 하지 말고’라고 써 있어"] {
        try check(!ExecutionSteering.isTaskReplacement(quote), "quoted replacement was executed")
    }
    for scenario in ["claude", "terminal-failure", "recovery"] {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-replacement-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var starts: [PendingSubmission] = []
        var gates: [UUID: CheckedContinuation<Void, Never>] = [:]
        let store = SessionStore(storageRoot: root, runOperation: { submission, _, _, _, _ in
            starts.append(submission)
            await withCheckedContinuation { gates[submission.id] = $0 }
            if scenario == "claude" && submission.request == "기존 Instagram 작업" {
                throw RunnerError.backend(BackendFailureNotice(provider: "claude", sessionID: nil,
                    blocker: .effectsUncertain, dispatchStage: .dispatched, permissionProfile: "workspace_write"))
            }
            return AppRunSummary(status: "complete", steps: [AppRunStep(sequence: 1, provider: "codex",
                action: "fixture", model: "fixture", effort: "none", revasDisposition: "adopted",
                sessionID: UUID().uuidString, permissionProfile: "read_only", exitCode: 0,
                output: "새 목표 자료 fixture", stderr: "", durationMS: 0, nativeRecord: nil)])
        })
        let id = store.selectedSessionID!
        let original = PendingSubmission(sessionID: id, userMessageID: UUID(), request: "기존 Instagram 작업",
            provider: .auto, workspace: root.path, codexCapacity: 30, claudeCapacity: 100)
        store.sessions[0].workspace = root.path
        if scenario == "claude" {
            store.composer = original.request; store.send()
            try await eventually { !gates.isEmpty }
            store.activeRuns[id]?.provider = .claude
        } else {
            store.sessions[0].lastFailure = original
            store.sessions[0].lastBackendFailure = BackendFailureNotice(provider: "codex", sessionID: nil,
                blocker: .effectsUncertain, dispatchStage: .dispatched, permissionProfile: "workspace_write")
            if scenario == "recovery" {
                store.reconcileSelectedFailure()
                try await eventually { !gates.isEmpty }
            }
        }
        let oldActive = store.activeRuns[id]?.submissionID
        let oldStarts = starts.count
        if oldActive != nil { store.composer = "OLD FOLLOWUP"; store.send() }
        store.sessions[0].codexSessionID = UUID().uuidString
        if scenario == "terminal-failure" {
            // Reproduce build95's persisted ordinary queue entry, including an
            // edit hold. The new action must work without rewriting its bytes.
            store.composer = "R2에 있는 QMGR 통합하는거 가져와봐"; store.send()
            let item = store.queuedSubmissions[0]
            try check(store.beginQueueEdit(item.id) && !store.canAdvanceQueued(item), "editing hold")
            try check(store.updateQueued(item.id, request: replacement), "legacy queue edit")
            store.endQueueEdit(item.id); store.advanceQueued(item.id)
        } else {
            store.composer = replacement; store.send()
        }
        if let oldActive {
            try check(starts.count == oldStarts && store.activeRuns[id]?.cancellationRequested == true,
                "new execution before old run ended: " + scenario)
            let queued = store.queuedSubmissions.first { $0.request == replacement }!
            store.advanceQueued(queued.id)
            try check(store.queuedSubmissions.count == 2 && starts.count == oldStarts, "double action duplicated task")
            store.flushPendingState()
            let restarted = SessionStore(storageRoot: root)
            try check(!restarted.isRunning && restarted.queuedSubmissions.contains { $0.id == queued.id && $0.startNextRequested == true },
                "restart lost explicit intent or replayed an active run")
            gates.removeValue(forKey: oldActive)!.resume()
        }
        try await eventually { starts.count == oldStarts + 1 && gates[starts.last!.id] != nil }
        let newRequest = starts.last!
        try check(newRequest.request == replacement && newRequest.amendedRequest == nil && !newRequest.executionRequest.contains(original.request),
            "abandoned objective leaked into replacement")
        try check(store.sessions[0].lastFailure == nil && store.sessions[0].preservedTasks?.count == 1,
            "old failure not durably preserved")
        try check(store.sessions[0].taskContext?.objective.requestText == replacement && store.sessions[0].codexSessionID == nil,
            "old objective/backend retained")
        try check(store.sessions[0].messages.filter { $0.id == newRequest.userMessageID }.count == 1, "duplicate user bubble")
        store.flushPendingState()
        let envelope = try JSONDecoder().decode(SessionEnvelope.self, from: Data(contentsOf: root.appendingPathComponent("sessions.json")))
        try check(envelope.sessions[0].preservedTasks?.count == 1, "restart lost prior failure")
        gates.removeValue(forKey: newRequest.id)!.resume()
        try await eventually { !store.isRunning }
        if oldActive != nil {
            try check(!starts.contains { $0.request == "OLD FOLLOWUP" } && store.queuedSubmissions.count == 1,
                "abandoned objective follow-up was executed under new context")
            store.removeQueued(store.queuedSubmissions[0].id)
        }
        // Explicit queue action cannot bypass unknown-effect safeguards for a
        // write, even if the text says "instead".
        store.sessions[0].lastFailure = original
        store.sessions[0].lastBackendFailure = BackendFailureNotice(provider: "codex", sessionID: nil,
            blocker: .effectsUncertain, dispatchStage: .dispatched)
        store.composer = "아 그거 하지 말고 프로덕션을 지금 배포해"; store.send()
        try check(!store.isRunning && store.queuedSubmissions.count == 1 && !store.canAdvanceQueued(store.queuedSubmissions[0]),
            "unknown previous mutation bypassed")
    }
    print("Task replacement: \(checks) checks PASS; terminal/Claude/recovery/NFD/provenance/duplicate/edit/permission; model calls 0")
}

@MainActor
private func composerInteractionSelfTest() async throws {
    var checks = 0
    func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        guard condition() else { throw RunnerError.message("Composer: " + message) }; checks += 1
    }
    let fixtures: [(String, Bool, Bool, VoiceDictationPhase, ComposerPrimaryAction)] = [
        ("", false, false, .idle, .disabledSend), (" \n", false, false, .idle, .disabledSend),
        ("draft", false, false, .idle, .send), ("", true, false, .idle, .stop),
        ("draft", true, false, .idle, .queue), ("", true, true, .idle, .stopping),
        ("draft", true, true, .idle, .queue), ("", false, false, .listening, .send),
        ("", true, false, .listening, .queue), ("draft", true, true, .listening, .queue),
        ("draft", true, false, .authorizing, .finalizing),
        ("draft", true, false, .finalizing, .finalizing),
        ("", true, false, .transcribing, .finalizing)
    ]
    for (draft, running, stopping, voice, expected) in fixtures {
        try check(ComposerPrimaryAction.resolve(draft: draft, running: running, stopping: stopping, voice: voice) == expected,
            "state mismatch: \(expected.rawValue)")
    }
    try check(!ComposerPrimaryAction.disabledSend.enabled && !ComposerPrimaryAction.stopping.enabled &&
        !ComposerPrimaryAction.finalizing.enabled, "pending controls must be disabled")
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-composer-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    var starts = 0
    var gate: CheckedContinuation<Void, Never>?
    let store = SessionStore(storageRoot: root, runOperation: { _, _, _, _, _ in
        starts += 1
        await withCheckedContinuation { gate = $0 }
        throw RunnerError.message("controlled cancellation fixture")
    })
    let parent = store.selectedSessionID!, instant = Date()
    store.composer = "FIRST"; store.performPrimaryAction(now: instant)
    let submission = store.activeRuns[parent]!.submissionID
    let marker = ExecutionCancellation.url(submissionID: submission)
    defer { try? FileManager.default.removeItem(at: marker) }
    try check(store.primaryAction == .stop && store.composer.isEmpty, "send did not become stop")
    store.performPrimaryAction(now: instant.addingTimeInterval(0.02))
    try check(!store.isStopping && !FileManager.default.fileExists(atPath: marker.path), "double click cancelled new run")
    store.send(); store.send()
    try check(!store.isStopping && store.queuedSubmissions.isEmpty, "empty Return cancelled or duplicated input")
    store.composer = "FOLLOW UP"; store.performPrimaryAction(now: instant.addingTimeInterval(1))
    try check(store.queuedSubmissions.map(\.request) == ["FOLLOW UP"] && store.activeRuns[parent]?.submissionID == submission,
        "follow-up restarted or replaced active task")
    store.performPrimaryAction(now: instant.addingTimeInterval(1.02))
    try check(!store.isStopping, "double queue click cancelled active run")
    store.createSession(); let other = store.selectedSessionID!
    let otherSubmission = UUID()
    store.activeRuns[other] = .init(submissionID: otherSubmission, started: instant,
        activity: RuntimeActivity(.executing, provider: "claude"), provider: .claude)
    store.select(parent); store.composer = "saved draft"
    store.cancelSelectedRun() // Explicit stop remains available even with a draft.
    let before = try FileManager.default.attributesOfItem(atPath: marker.path)[.modificationDate] as? Date
    store.cancelSelectedRun()
    let after = try FileManager.default.attributesOfItem(atPath: marker.path)[.modificationDate] as? Date
    try check(store.isStopping && before == after, "repeated stop rewrote cancellation")
    try check(store.composer == "saved draft" && store.queuedSubmissions.map(\.request) == ["FOLLOW UP"] &&
        store.activeRuns[other]?.cancellationRequested == false &&
        !FileManager.default.fileExists(atPath: ExecutionCancellation.url(submissionID: otherSubmission).path),
        "stop damaged draft, queue or another session")
    store.performPrimaryAction(now: instant.addingTimeInterval(2))
    try check(store.queuedSubmissions.map(\.request) == ["FOLLOW UP", "saved draft"] && store.primaryAction == .stopping,
        "stopping lost follow-up input or allowed duplicate stop")
    store.select(other)
    let otherMarker = ExecutionCancellation.url(submissionID: otherSubmission)
    defer { try? FileManager.default.removeItem(at: otherMarker) }
    try check(store.primaryAction == .stop, "independent running session should offer Stop")
    store.performPrimaryAction(now: instant.addingTimeInterval(3 + NSEvent.doubleClickInterval))
    try check(store.isStopping && FileManager.default.fileExists(atPath: otherMarker.path), "normal primary Stop did not execute")
    store.performPrimaryAction(now: instant.addingTimeInterval(4 + NSEvent.doubleClickInterval))
    try check(store.primaryAction == .stopping && store.queuedSubmissions.count == 2, "repeated primary Stop changed queue")
    store.select(parent)
    let deadline = Date().addingTimeInterval(8)
    while gate == nil && Date() < deadline { try await Task.sleep(for: .milliseconds(10)) }
    try check(gate != nil && starts == 1, "unexpected provider dispatch count")
    gate?.resume(); gate = nil
    while store.isSessionRunning(parent) && Date() < deadline { try await Task.sleep(for: .milliseconds(10)) }
    try check(!store.isSessionRunning(parent) && starts == 1 && store.queuedSubmissions.count == 2,
        "cancel/failure did not hold dependents")
    store.activeRuns.removeValue(forKey: other)
    try check(composerReturnAction(shiftPressed: false) == .send && composerReturnAction(shiftPressed: true) == .newline,
        "Return/Shift Return changed")
    print("Unified composer: \(checks) checks passed; model calls 0; state/voice/double-click/FIFO/targeted-stop/draft/holds")
}

private func composerReturnAction(shiftPressed: Bool) -> ComposerReturnAction {
    shiftPressed ? .newline : .send
}

private func composerText(base: String, dictated transcript: String) -> String {
    guard !transcript.isEmpty else { return base }
    guard !base.isEmpty else { return transcript }
    guard let last = base.last, !last.isWhitespace else { return base + transcript }
    return base + " " + transcript
}

private func dictationText(committed: String, current: String) -> String {
    composerText(base: committed, dictated: current)
}

private enum VoiceDictationPhase: Equatable {
    case idle
    case authorizing
    case listening
    case finalizing
    case transcribing
}

private enum ComposerPrimaryAction: String, CaseIterable {
    case disabledSend, send, queue, steer, stop, stopping, finalizing

    static func resolve(draft: String, running: Bool, stopping: Bool, voice: VoiceDictationPhase) -> Self {
        if [.authorizing, .finalizing, .transcribing].contains(voice) { return .finalizing }
        if voice == .listening || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return running ? .queue : .send
        }
        return running ? (stopping ? .stopping : .stop) : .disabledSend
    }
    var enabled: Bool { [.send, .queue, .steer, .stop].contains(self) }
    var icon: String {
        switch self {
        case .stop, .stopping: return "stop.fill"
        case .queue: return "text.line.last.and.arrowtriangle.forward"
        case .finalizing: return "ellipsis"
        case .send, .disabledSend, .steer: return "arrow.up"
        }
    }
    var label: String {
        switch self {
        case .send, .disabledSend: return "작업 보내기"
        case .queue: return "대기열에 추가"
        case .steer: return "현재 작업에 정정 전달"
        case .stop: return "작업 중지"
        case .stopping: return "작업 중지 확인 중"
        case .finalizing: return "음성 입력 처리 중"
        }
    }
    var help: String {
        switch self {
        case .send, .disabledSend: return "Send task"
        case .queue: return "Add this task to the queue"
        case .steer: return "현재 턴에 정정 전달 · 같은 목표와 권한 유지"
        case .stop: return "현재 대화의 작업 중지 · ⌘."
        case .stopping: return "중지 확인을 기다립니다 · 입력과 대기열은 보존됩니다"
        case .finalizing: return "음성 입력을 마무리하고 있습니다"
        }
    }
}

private struct LocalWhisperConfiguration: Sendable {
    let executableURL: URL
    let modelID: String
}

private struct LocalWhisperResult: Decodable {
    let text: String
}

/// AVAudioEngine calls its tap on a realtime queue. This explicitly Sendable
/// bridge owns either the live Speech request or the local recording file and
/// prevents the controller's MainActor isolation from leaking into that queue.
private final class SpeechAudioBufferSink: @unchecked Sendable {
    private let request: SFSpeechAudioBufferRecognitionRequest?
    private let audioFile: AVAudioFile?
    private let onLevel: @Sendable (CGFloat) -> Void
    private var lastLevelUpdate = Date.distantPast

    init(
        request: SFSpeechAudioBufferRecognitionRequest? = nil,
        audioFile: AVAudioFile? = nil,
        onLevel: @escaping @Sendable (CGFloat) -> Void
    ) {
        self.request = request
        self.audioFile = audioFile
        self.onLevel = onLevel
    }

    nonisolated func append(_ buffer: AVAudioPCMBuffer) {
        request?.append(buffer)
        try? audioFile?.write(from: buffer)
        guard Date().timeIntervalSince(lastLevelUpdate) >= 0.075,
              let samples = buffer.floatChannelData?[0] else { return }
        lastLevelUpdate = Date()
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return }
        var sum: Float = 0
        for index in 0..<frameCount {
            let sample = samples[index]
            sum += sample * sample
        }
        let rms = sqrt(sum / Float(frameCount))
        let decibels = 20 * log10(max(rms, 0.000_01))
        let normalized = CGFloat(max(0, min(1, (decibels + 52) / 52)))
        onLevel(normalized)
    }
}

@MainActor
private final class VoiceDictationController: ObservableObject {
    @Published private(set) var phase: VoiceDictationPhase = .idle
    @Published private(set) var level: CGFloat = 0
    @Published private(set) var elapsedSeconds = 0

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var audioBufferSink: SpeechAudioBufferSink?
    private var elapsedTimer: Timer?
    private var finishTimeoutTask: Task<Void, Never>?
    private var restartTask: Task<Void, Never>?
    private var localTranscriptionTask: Task<Void, Never>?
    private var localProcessCancellation: VoiceProcessCancellation?
    private var localWhisper: LocalWhisperConfiguration?
    private var localRecordingURL: URL?
    private var baseText = ""
    private var committedTranscript = ""
    private var currentTranscript = ""
    private var lastPublishedText = ""
    private var lastDictatedText = ""
    private var onReadComposer: (() -> String)?
    private var onTranscript: ((String) -> Void)?
    private var onFailure: ((String) -> Void)?
    private var onFinish: (() -> Void)?
    private var tapInstalled = false
    private var wantsRecording = false
    private var recognitionGeneration = 0
    private var consecutiveRecoveryCount = 0

    var isActive: Bool { phase != .idle }
    var isRecording: Bool { phase == .listening }
    var isAuthorizing: Bool { phase == .authorizing }
    var isFinalizing: Bool { phase == .finalizing || phase == .transcribing }
    var engineLabel: String { localWhisper == nil ? "Apple speech" : "Local Whisper" }
    var statusLabel: String {
        switch phase {
        case .idle: return "Voice"
        case .authorizing: return "Starting…"
        case .listening: return "Listening"
        case .finalizing: return "Finishing…"
        case .transcribing: return "Transcribing…"
        }
    }
    var elapsedLabel: String {
        String(format: "%d:%02d", elapsedSeconds / 60, elapsedSeconds % 60)
    }

    func toggle(
        initialText: String,
        readComposer: (() -> String)? = nil,
        onTranscript: @escaping (String) -> Void,
        onFailure: @escaping (String) -> Void
    ) {
        if isActive {
            finish()
            return
        }
        baseText = initialText
        lastPublishedText = initialText
        lastDictatedText = ""
        onReadComposer = readComposer
        committedTranscript = ""
        currentTranscript = ""
        localWhisper = localWhisperConfiguration()
        localRecordingURL = nil
        self.onTranscript = onTranscript
        self.onFailure = onFailure
        self.onFinish = nil
        wantsRecording = true
        phase = .authorizing
        elapsedSeconds = 0
        startElapsedTimer()
        recognitionGeneration += 1
        let generation = recognitionGeneration
        Task { await authorizeAndStart(generation: generation) }
    }

    /// Finish keeps the recognition task alive briefly so the final spoken
    /// words reach the composer. This is deliberately different from cancel.
    func finish(onComplete: (() -> Void)? = nil) {
        if let onComplete { onFinish = onComplete }
        guard isActive, !isFinalizing else { return }
        wantsRecording = false
        if let configuration = localWhisper, let recordingURL = localRecordingURL {
            phase = .transcribing
            stopAudioCapture()
            transcribeLocally(configuration: configuration, recordingURL: recordingURL)
            return
        }
        phase = .finalizing
        stopAudioCapture()
        let generation = recognitionGeneration
        finishTimeoutTask?.cancel()
        finishTimeoutTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 900_000_000)
            guard !Task.isCancelled, let self,
                  self.phase == .finalizing,
                  self.recognitionGeneration == generation else { return }
            self.completeFinalization()
        }
    }

    /// Cancel is lossless: it restores the exact text that existed before the
    /// microphone was started.
    func cancel() {
        guard isActive else { return }
        let current = onReadComposer?() ?? lastPublishedText
        let restore = DictationDraft.replacing(current: current, previous: lastPublishedText,
            dictated: lastDictatedText, replacement: "", initial: baseText) ?? current
        let transcriptHandler = onTranscript
        resetRecognition(cancelTask: true)
        phase = .idle
        level = 0
        elapsedSeconds = 0
        transcriptHandler?(restore)
        clearCallbacks()
    }

    /// Session changes and view teardown use cancellation so a late Speech
    /// callback can never write into a different composer.
    func stop() {
        cancel()
    }

    private func stopAudioCapture() {
        if audioEngine.isRunning { audioEngine.stop() }
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        recognitionRequest?.endAudio()
        audioBufferSink = nil
    }

    private func resetRecognition(cancelTask: Bool) {
        wantsRecording = false
        recognitionGeneration += 1
        restartTask?.cancel()
        restartTask = nil
        finishTimeoutTask?.cancel()
        finishTimeoutTask = nil
        localTranscriptionTask?.cancel()
        localTranscriptionTask = nil
        localProcessCancellation?.cancel()
        localProcessCancellation = nil
        stopAudioCapture()
        if cancelTask { recognitionTask?.cancel() }
        recognitionTask = nil
        recognitionRequest = nil
        audioBufferSink = nil
        elapsedTimer?.invalidate()
        elapsedTimer = nil
        removeLocalRecording()
    }

    private func authorizeAndStart(generation: Int) async {
        let microphoneGranted: Bool
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .notDetermined:
            microphoneGranted = await AVCaptureDevice.requestAccess(for: .audio)
        case .authorized:
            microphoneGranted = true
        default:
            microphoneGranted = false
        }
        guard phase == .authorizing, wantsRecording, recognitionGeneration == generation else { return }
        guard microphoneGranted else {
            fail("Microphone access is off. Allow OS-1 CLODEX in System Settings → Privacy & Security → Microphone.")
            return
        }

        if let configuration = localWhisper ?? localWhisperConfiguration() {
            do {
                localWhisper = configuration
                try startLocalWhisperCapture()
                return
            } catch {
                stopAudioCapture()
                localWhisper = nil
                removeLocalRecording()
            }
        }

        let speechStatus: SFSpeechRecognizerAuthorizationStatus
        switch SFSpeechRecognizer.authorizationStatus() {
        case .notDetermined:
            speechStatus = await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { status in
                    continuation.resume(returning: status)
                }
            }
        case let existing:
            speechStatus = existing
        }
        guard phase == .authorizing, wantsRecording, recognitionGeneration == generation else { return }
        guard speechStatus == .authorized else {
            fail("Local Whisper is unavailable and Speech Recognition access is off. Install Handy or allow OS-1 CLODEX in System Settings → Privacy & Security → Speech Recognition.")
            return
        }

        do {
            try startRecognition()
        } catch {
            fail("Voice input could not start: \(error.localizedDescription)")
        }
    }

    private func localWhisperConfiguration() -> LocalWhisperConfiguration? {
        let fileManager = FileManager.default
        let home = fileManager.homeDirectoryForCurrentUser
        let executableCandidates = [
            URL(fileURLWithPath: "/Applications/Handy.app/Contents/MacOS/handy"),
            home.appendingPathComponent("Applications/Handy.app/Contents/MacOS/handy"),
        ]
        guard let executableURL = executableCandidates.first(where: {
            fileManager.isExecutableFile(atPath: $0.path)
        }) else { return nil }

        let support = home.appendingPathComponent("Library/Application Support/com.pais.handy")
        let settingsURL = support.appendingPathComponent("settings_store.json")
        guard let data = try? Data(contentsOf: settingsURL),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let settings = root["settings"] as? [String: Any],
              let modelID = settings["selected_model"] as? String,
              !modelID.isEmpty else { return nil }
        let modelURL = support.appendingPathComponent("models").appendingPathComponent(
            URL(fileURLWithPath: modelID).lastPathComponent
        )
        guard fileManager.fileExists(atPath: modelURL.path) else { return nil }
        return LocalWhisperConfiguration(executableURL: executableURL, modelID: modelID)
    }

    private func startLocalWhisperCapture() throws {
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw RunnerError.message("No microphone audio format is available.")
        }
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("os1-dictation-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let recordingURL = directory.appendingPathComponent("recording.caf")
        let audioFile = try AVAudioFile(forWriting: recordingURL, settings: format.settings)
        localRecordingURL = recordingURL
        let bufferSink = SpeechAudioBufferSink(audioFile: audioFile) { @Sendable [weak self] value in
            Task { @MainActor [weak self] in
                guard let self, self.phase == .listening else { return }
                self.level = max(value, self.level * 0.62)
            }
        }
        audioBufferSink = bufferSink
        inputNode.installTap(
            onBus: 0,
            bufferSize: 1_024,
            format: format,
            block: { @Sendable [bufferSink] buffer, _ in
                bufferSink.append(buffer)
            }
        )
        tapInstalled = true
        audioEngine.prepare()
        try audioEngine.start()
        phase = .listening
        recognitionGeneration += 1
    }

    private func startRecognition() throws {
        let locale = preferredDictationLocale()
        guard let recognizer = SFSpeechRecognizer(locale: locale),
              recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else {
            throw RunnerError.message("이 언어의 기기 내 받아쓰기를 사용할 수 없습니다. 로컬 Whisper 모델을 준비해 주세요. 녹음은 외부 서버로 보내지 않았습니다.")
        }

        recognitionTask?.cancel()
        recognitionTask = nil
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.contextualStrings = [
            "OS-1", "OmarAGI", "Codex", "Claude Code", "RCC", "REVAS",
            "Luna", "Terra", "Sol", "GitHub", "Cloudflare", "레바스", "코덱스", "클로드"
        ]
        if #available(macOS 13.0, *) {
            request.addsPunctuation = true
        }
        recognitionRequest = request
        let bufferSink = SpeechAudioBufferSink(request: request) { @Sendable [weak self] value in
            Task { @MainActor [weak self] in
                guard let self, self.phase == .listening else { return }
                self.level = max(value, self.level * 0.62)
            }
        }
        audioBufferSink = bufferSink

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw RunnerError.message("No microphone audio format is available.")
        }
        inputNode.installTap(
            onBus: 0,
            bufferSize: 1_024,
            format: format,
            block: { @Sendable [bufferSink] buffer, _ in
                bufferSink.append(buffer)
            }
        )
        tapInstalled = true
        audioEngine.prepare()
        try audioEngine.start()
        phase = .listening

        recognitionGeneration += 1
        let generation = recognitionGeneration
        recognitionTask = recognizer.recognitionTask(with: request) { @Sendable [weak self] result, error in
            let transcript = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            let errorMessage = error?.localizedDescription
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard self.phase != .idle,
                      self.recognitionGeneration == generation else { return }
                if let transcript, !transcript.isEmpty {
                    self.currentTranscript = transcript
                    self.consecutiveRecoveryCount = 0
                    self.publishTranscript()
                }
                if isFinal {
                    self.commitCurrentSegment()
                    if self.wantsRecording {
                        self.restartAfterFinalResult()
                    } else {
                        self.completeFinalization()
                    }
                } else if let errorMessage {
                    if self.wantsRecording, self.consecutiveRecoveryCount < 3 {
                        self.consecutiveRecoveryCount += 1
                        self.commitCurrentSegment()
                        self.restartAfterFinalResult(delayNanoseconds: 220_000_000)
                    } else if self.phase == .finalizing {
                        self.completeFinalization()
                    } else {
                        self.fail("Voice input stopped: \(errorMessage)")
                    }
                }
            }
        }
    }

    /// Speech may finalize a segment after a pause. Keep the microphone UI and
    /// user intent active while transparently rolling into a fresh segment.
    private func restartAfterFinalResult(delayNanoseconds: UInt64 = 120_000_000) {
        guard wantsRecording else { return }
        recognitionGeneration += 1
        stopAudioCapture()
        recognitionTask = nil
        recognitionRequest = nil
        phase = .listening
        restartTask?.cancel()
        restartTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: delayNanoseconds)
            guard !Task.isCancelled, let self, self.wantsRecording else { return }
            do {
                try self.startRecognition()
            } catch {
                self.fail("Voice input could not continue: \(error.localizedDescription)")
            }
        }
    }

    private func transcribeLocally(
        configuration: LocalWhisperConfiguration,
        recordingURL: URL
    ) {
        let generation = recognitionGeneration
        localTranscriptionTask?.cancel()
        localProcessCancellation?.cancel()
        let cancellation = VoiceProcessCancellation()
        localProcessCancellation = cancellation
        localTranscriptionTask = Task { [weak self] in
            do {
                let transcript = try await Task.detached(priority: .userInitiated) {
                    try Self.performLocalWhisperTranscription(
                        configuration: configuration,
                        recordingURL: recordingURL,
                        cancellation: cancellation
                    )
                }.value
                guard !Task.isCancelled, let self,
                      self.phase == .transcribing,
                      self.recognitionGeneration == generation else { return }
                self.currentTranscript = transcript
                self.publishTranscript()
                self.completeFinalization()
            } catch {
                guard !Task.isCancelled, let self,
                      self.phase == .transcribing,
                      self.recognitionGeneration == generation else { return }
                self.fail("Local Whisper could not transcribe this recording: \(error.localizedDescription)")
            }
        }
    }

    nonisolated private static func performLocalWhisperTranscription(
        configuration: LocalWhisperConfiguration,
        recordingURL: URL,
        cancellation: VoiceProcessCancellation
    ) throws -> String {
        let waveURL = recordingURL.deletingLastPathComponent().appendingPathComponent("recording.wav")
        defer { try? FileManager.default.removeItem(at: recordingURL.deletingLastPathComponent()) }

        _ = try VoiceProcess.run(
            executable: URL(fileURLWithPath: "/usr/bin/afconvert"),
            arguments: [
                "-f", "WAVE", "-d", "LEI16@16000", "-c", "1",
                recordingURL.path, waveURL.path,
            ], cancellation: cancellation, timeout: 30
        )
        let output = try VoiceProcess.run(
            executable: configuration.executableURL,
            arguments: [
                "--transcribe-file", waveURL.path,
                "--model", configuration.modelID,
                "--json",
            ], cancellation: cancellation
        )
        let decoder = JSONDecoder()
        let result: LocalWhisperResult
        if let decoded = try? decoder.decode(LocalWhisperResult.self, from: output) {
            result = decoded
        } else if let line = String(data: output, encoding: .utf8)?
            .split(separator: "\n")
            .reversed()
            .first(where: { $0.first == "{" }),
            let data = String(line).data(using: .utf8) {
            result = try decoder.decode(LocalWhisperResult.self, from: data)
        } else {
            throw RunnerError.message("Handy returned an unreadable transcription result.")
        }
        let transcript = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !transcript.isEmpty else {
            throw RunnerError.message("No speech was detected.")
        }
        return transcript
    }

    private func removeLocalRecording() {
        guard let localRecordingURL else { return }
        try? FileManager.default.removeItem(at: localRecordingURL.deletingLastPathComponent())
        self.localRecordingURL = nil
    }

    private func preferredDictationLocale() -> Locale {
        let preferred = Locale.preferredLanguages
        if let korean = preferred.first(where: { $0.lowercased().hasPrefix("ko") }) {
            return Locale(identifier: korean)
        }
        return Locale.current
    }

    private func publishTranscript() {
        let dictated = dictationText(committed: committedTranscript, current: currentTranscript)
        let current = onReadComposer?() ?? lastPublishedText
        guard let merged = DictationDraft.replacing(current: current, previous: lastPublishedText,
            dictated: lastDictatedText, replacement: dictated, initial: baseText) else {
            // A user edited the owned dictation span. User input wins; stop
            // rather than overwrite it with a late recognition callback.
            let failure = onFailure
            resetRecognition(cancelTask: true)
            phase = .idle; level = 0
            clearCallbacks()
            failure?("직접 수정한 입력을 보존하고 받아쓰기를 멈췄습니다.")
            return
        }
        lastPublishedText = merged
        lastDictatedText = dictated
        onTranscript?(merged)
    }

    private func commitCurrentSegment() {
        guard !currentTranscript.isEmpty else { return }
        committedTranscript = dictationText(committed: committedTranscript, current: currentTranscript)
        currentTranscript = ""
        publishTranscript()
    }

    private func completeFinalization() {
        guard phase != .idle else { return }
        commitCurrentSegment()
        let completion = onFinish
        resetRecognition(cancelTask: true)
        phase = .idle
        level = 0
        clearCallbacks()
        completion?()
    }

    private func startElapsedTimer() {
        elapsedTimer?.invalidate()
        elapsedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self, self.phase != .idle else { return }
                self.elapsedSeconds += 1
                if self.elapsedSeconds >= 300 && self.phase == .listening { self.finish() }
            }
        }
    }

    private func clearCallbacks() {
        onTranscript = nil
        onReadComposer = nil
        lastPublishedText = ""
        lastDictatedText = ""
        onFailure = nil
        onFinish = nil
        baseText = ""
        committedTranscript = ""
        currentTranscript = ""
        localWhisper = nil
        consecutiveRecoveryCount = 0
    }

    private func fail(_ message: String) {
        commitCurrentSegment()
        let failure = onFailure
        resetRecognition(cancelTask: true)
        phase = .idle
        level = 0
        clearCallbacks()
        failure?(message)
    }
}

private struct NativeSessionSummary: Identifiable, Sendable {
    let id: String
    let provider: ProviderChoice
    let title: String
    let workspace: String
    let workspaceLabel: String?
    let updatedAt: Date
    let sourcePath: String?
    var linkedTitle: String?
    var isPinned = false
    var pinPosition: Int?
    var pinSyncNote: String?

    var displayTitle: String {
        let value = (linkedTitle ?? title).trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? "Untitled session" : value
    }

    var displayWorkspace: String {
        if let workspaceLabel, !workspaceLabel.isEmpty { return workspaceLabel }
        let value = URL(fileURLWithPath: workspace).lastPathComponent
        return value.isEmpty ? "No workspace" : value
    }
}

private func resolvedNativeSessionID(
    recordedID: String?,
    currentID: String?,
    preservingCurrent: Bool,
    availableIDs: Set<String>
) -> String? {
    let candidates = preservingCurrent ? [currentID, recordedID] : [recordedID]
    return candidates.compactMap { $0 }.first(where: availableIDs.contains)
}

private let backendInspectorRefreshInterval: Duration = .seconds(2)

private func shouldRefreshActiveLinkedNativeTranscript(
    surface: ProviderChoice,
    provider: ProviderChoice,
    runningProvider: ProviderChoice?,
    recordedID: String?,
    selectedID: String?,
    selectionAvailable: Bool,
    isLoading: Bool
) -> Bool {
    guard provider != .auto, surface == provider, runningProvider == provider,
          let recordedID, selectedID == recordedID else { return false }
    return selectionAvailable && !isLoading
}

private struct NativeSessionMessage: Identifiable, Sendable {
    let id: String
    let role: MessageRole
    let text: String
    let timestamp: Date?
    var ordinal: Int? = nil
    var complete: Bool = true
    var turnID: String? = nil
}

private func sidebarNativeLess(_ lhs: NativeSessionSummary, _ rhs: NativeSessionSummary) -> Bool {
    if lhs.isPinned != rhs.isPinned { return lhs.isPinned }
    if lhs.isPinned, lhs.pinPosition != rhs.pinPosition {
        return (lhs.pinPosition ?? Int.max) < (rhs.pinPosition ?? Int.max)
    }
    if lhs.updatedAt != rhs.updatedAt { return lhs.updatedAt > rhs.updatedAt }
    return lhs.id < rhs.id
}

private func transcriptStableID(_ value: String) -> UUID {
    let hex = SHA256.hash(data: Data(value.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    let parts = [0..<8, 8..<12, 12..<16, 16..<20, 20..<32].map { range in
        String(hex[hex.index(hex.startIndex, offsetBy: range.lowerBound)..<hex.index(hex.startIndex, offsetBy: range.upperBound)])
    }
    return UUID(uuidString: parts.joined(separator: "-"))!
}

private enum NativeSessionReader {
    nonisolated(unsafe) private static let iso8601 = ISO8601DateFormatter()

    private struct ClaudeDesktopMetadata {
        let title: String
        let workspace: String
        let lastActivityAt: Date?
        let isArchived: Bool
    }

    static func sessions(
        for provider: ProviderChoice,
        including recordedSessionID: String? = nil
    ) throws -> [NativeSessionSummary] {
        var result: [NativeSessionSummary]
        switch provider {
        case .codex:
            result = try codexSessions()
            if let recordedSessionID,
               !result.contains(where: { $0.id == recordedSessionID }),
               let exact = try codexSession(sessionID: recordedSessionID) {
                result.append(exact)
            }
        case .claude:
            result = try claudeSessions(including: recordedSessionID)
        case .auto:
            return []
        }
        let pinReadback = try? NativeSidebar.read(provider.rawValue)
        let pins = pinReadback ?? [:]
        if provider == .codex {
            // Pins must not disappear behind the recent-session page bound.
            let loaded = Set(result.map(\.id))
            for (id, pin) in pins where pin.pinned && !loaded.contains(id) {
                if let session = try codexSession(sessionID: id) { result.append(session) }
            }
        }
        var seen = Set<String>()
        return result.filter { seen.insert($0.id).inserted }.map { session in
            var value = session
            value.isPinned = pins[value.id]?.pinned ?? false
            value.pinPosition = pins[value.id]?.position
            if pinReadback == nil { value.pinSyncNote = "백엔드 핀 상태 미확인" }
            return value
        }.sorted(by: sidebarNativeLess)
    }

    static func transcript(for session: NativeSessionSummary, forIngestion: Bool = false) throws -> [NativeSessionMessage] {
        switch session.provider {
        case .codex: return try codexTranscript(sessionID: session.id, forIngestion: forIngestion)
        case .claude: return try claudeTranscript(session: session, forIngestion: forIngestion)
        case .auto: return []
        }
    }

    private static func codexSessions() throws -> [NativeSessionSummary] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let path = "\(home)/.codex/state_5.sqlite"
        var database: OpaquePointer?
        guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
              let database else {
            throw RunnerError.message("Codex session index could not be opened.")
        }
        defer { sqlite3_close(database) }
        let query = """
        SELECT id,
               COALESCE(NULLIF(name, ''), NULLIF(title, ''), NULLIF(first_user_message, ''), 'Untitled session'),
               cwd,
               COALESCE(NULLIF(recency_at_ms, 0), NULLIF(updated_at_ms, 0), updated_at * 1000)
        FROM threads
        WHERE archived = 0 AND preview <> ''
        ORDER BY recency_at_ms DESC, updated_at_ms DESC
        LIMIT 500
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw RunnerError.message("Codex session index could not be read.")
        }
        defer { sqlite3_finalize(statement) }
        var result: [NativeSessionSummary] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let id = columnText(statement, 0)
            guard !id.isEmpty else { continue }
            let rawTitle = columnText(statement, 1)
            let title = visibleBackendUserRequest(rawTitle).map(firstLine) ?? "Codex session"
            result.append(NativeSessionSummary(
                id: id,
                provider: .codex,
                title: title,
                workspace: columnText(statement, 2),
                workspaceLabel: nil,
                updatedAt: Date(timeIntervalSince1970: Double(sqlite3_column_int64(statement, 3)) / 1_000),
                sourcePath: nil,
                linkedTitle: nil
            ))
        }
        return result
    }

    /// The browse list is intentionally bounded, but the OS-1-linked record
    /// must remain addressable even when it is older, archived, or previewless.
    private static func codexSession(sessionID: String) throws -> NativeSessionSummary? {
        let path = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".codex/state_5.sqlite").path
        var database: OpaquePointer?
        guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
              let database else {
            throw RunnerError.message("Codex session index could not be opened.")
        }
        defer { sqlite3_close(database) }
        let query = """
        SELECT id,
               COALESCE(NULLIF(name, ''), NULLIF(title, ''), NULLIF(first_user_message, ''), 'Untitled session'),
               cwd,
               COALESCE(NULLIF(recency_at_ms, 0), NULLIF(updated_at_ms, 0), updated_at * 1000)
        FROM threads
        WHERE id = ?
        LIMIT 1
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw RunnerError.message("Recorded Codex session could not be read.")
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, sessionID, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        guard sqlite3_step(statement) == SQLITE_ROW else { return nil }
        let rawTitle = columnText(statement, 1)
        return NativeSessionSummary(
            id: columnText(statement, 0),
            provider: .codex,
            title: visibleBackendUserRequest(rawTitle).map(firstLine) ?? "Codex session",
            workspace: columnText(statement, 2),
            workspaceLabel: nil,
            updatedAt: Date(timeIntervalSince1970: Double(sqlite3_column_int64(statement, 3)) / 1_000),
            sourcePath: nil,
            linkedTitle: nil
        )
    }

    private static func codexTranscript(sessionID: String, forIngestion: Bool) throws -> [NativeSessionMessage] {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let path = "\(home)/.codex/thread_history_1.sqlite"
        var database: OpaquePointer?
        guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
              let database else {
            throw RunnerError.message("Codex transcript database could not be opened.")
        }
        defer { sqlite3_close(database) }
        let query = """
        SELECT item_type, item_json, created_at_ms, rollout_ordinal, turn_status, turn_id
        FROM (
          SELECT i.rollout_ordinal, i.item_type, i.item_json, i.created_at_ms, t.status AS turn_status, i.turn_id
          FROM thread_items i LEFT JOIN thread_turns t ON i.thread_id = t.thread_id AND i.turn_id = t.turn_id
          WHERE i.thread_id = ? AND i.item_type IN ('userMessage', 'agentMessage')
          ORDER BY i.rollout_ordinal DESC
          \(forIngestion ? "" : "LIMIT 400")
        )
        ORDER BY rollout_ordinal ASC
        """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK,
              let statement else {
            throw RunnerError.message("Codex transcript could not be read.")
        }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, sessionID, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        var result: [NativeSessionMessage] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let type = columnText(statement, 0)
            let json = columnText(statement, 1)
            guard let data = json.data(using: .utf8),
                  let item = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            let text: String
            let role: MessageRole
            if type == "userMessage" {
                role = .user
                guard let visible = visibleBackendUserRequest(textContent(item["content"])) else { continue }
                text = visible
            } else {
                role = .assistant
                if forIngestion, ["failed", "interrupted"].contains(columnText(statement, 4)) { continue }
                text = item["text"] as? String ?? ""
            }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            result.append(NativeSessionMessage(
                id: (item["id"] as? String) ?? "codex-\(result.count)",
                role: role,
                text: trimmed,
                timestamp: Date(timeIntervalSince1970: Double(sqlite3_column_int64(statement, 2)) / 1_000),
                ordinal: Int(sqlite3_column_int64(statement, 3)),
                complete: role == .user || columnText(statement, 4) == "completed",
                turnID: columnText(statement, 5)
            ))
        }
        return result
    }

    private static func claudeSessions(including recordedSessionID: String?) throws -> [NativeSessionSummary] {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude/projects", isDirectory: true)
        let desktopMetadata = claudeDesktopSessionMetadata()
        let repositoryLabels = claudeRepositoryLabels()
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }
        var files: [(URL, Date)] = []
        for case let url as URL in enumerator where url.pathExtension == "jsonl" {
            guard SidebarOrder.claudeConversationID(file: url, projectsRoot: root) != nil else { continue }
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey])
            guard values?.isRegularFile == true else { continue }
            files.append((url, values?.contentModificationDate ?? .distantPast))
        }
        files.sort { $0.1 > $1.1 }
        return files.compactMap { url, modifiedAt in
            guard let records = try? readJSONLines(url, maximumBytes: 768 * 1_024), !records.isEmpty else { return nil }
            let id = url.deletingPathExtension().lastPathComponent
            var workspace = ""
            var timestamp: Date?
            var title = ""
            var hasVisibleConversation = false
            for record in records {
                // Copied historical turns and child logs cannot rename this file's identity.
                if let value = record["cwd"] as? String, !value.isEmpty { workspace = value }
                if let value = record["timestamp"] as? String, let date = iso8601.date(from: value) {
                    timestamp = timestamp.map { max($0, date) } ?? date
                }
                let type = record["type"] as? String
                if type == "user" || type == "assistant",
                   let message = record["message"] as? [String: Any] {
                    let raw = textContent(message["content"])
                    let text: String? = type == "user"
                        ? visibleBackendUserRequest(raw)
                        : raw.trimmingCharacters(in: .whitespacesAndNewlines)
                    if let text, !text.isEmpty {
                        hasVisibleConversation = true
                        if title.isEmpty, type == "user" { title = firstLine(text) }
                    }
                }
            }
            // Claude Code print-mode sessions are genuine persistent backend
            // sessions but do not carry Claude Desktop's `bridge-session`
            // marker. The previous marker gate hid every session created or
            // resumed by OS-1 even though its JSONL transcript existed. Show
            // every persistent Claude conversation with visible user/assistant
            // turns so the backend surface mirrors Claude Code itself.
            guard hasVisibleConversation else { return nil }
            if let metadata = desktopMetadata[id] {
                guard !metadata.isArchived || id == recordedSessionID else { return nil }
                if let visibleTitle = visibleBackendUserRequest(metadata.title) {
                    title = firstLine(visibleTitle)
                }
                if workspace.isEmpty, !metadata.workspace.isEmpty { workspace = metadata.workspace }
                if let activity = metadata.lastActivityAt { timestamp = activity }
            }
            return NativeSessionSummary(
                id: id,
                provider: .claude,
                title: title,
                workspace: workspace,
                workspaceLabel: claudeProjectLabel(workspace, repositoryLabels: repositoryLabels),
                updatedAt: timestamp ?? modifiedAt,
                sourcePath: url.path,
                linkedTitle: nil
            )
        }.sorted { $0.updatedAt > $1.updatedAt }
    }

    private static func claudeDesktopSessionMetadata() -> [String: ClaudeDesktopMetadata] {
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Claude/claude-code-sessions", isDirectory: true)
        guard let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else { return [:] }
        var result: [String: ClaudeDesktopMetadata] = [:]
        for case let url as URL in enumerator where url.pathExtension == "json" && url.lastPathComponent.hasPrefix("local_") {
            guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]),
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let cliSessionID = value["cliSessionId"] as? String,
                  !cliSessionID.isEmpty else { continue }
            let milliseconds = value["lastActivityAt"] as? Double
                ?? (value["lastActivityAt"] as? NSNumber)?.doubleValue
            result[cliSessionID] = ClaudeDesktopMetadata(
                title: value["title"] as? String ?? "",
                workspace: value["originCwd"] as? String ?? value["cwd"] as? String ?? "",
                lastActivityAt: milliseconds.map { Date(timeIntervalSince1970: $0 / 1_000) },
                isArchived: value["isArchived"] as? Bool ?? false
            )
        }
        return result
    }

    private static func claudeProjectLabel(_ workspace: String, repositoryLabels: [String: String]) -> String {
        guard !workspace.isEmpty else { return "No folder" }
        if workspace.contains("/Library/Application Support/Claude/scratch-workspaces/") {
            return "No folder"
        }
        if let label = repositoryLabels[workspace], !label.isEmpty { return label }
        let name = URL(fileURLWithPath: workspace).lastPathComponent
        return name.isEmpty ? "No folder" : name
    }

    private static func claudeRepositoryLabels() -> [String: String] {
        let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude.json")
        guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let repositories = root["githubRepoPaths"] as? [String: Any] else { return [:] }
        var result: [String: String] = [:]
        for (repository, rawPaths) in repositories {
            guard let paths = rawPaths as? [String] else { continue }
            let label = repository.split(separator: "/").last.map(String.init) ?? repository
            for path in paths { result[path] = label }
        }
        return result
    }

    private static func claudeTranscript(session: NativeSessionSummary, forIngestion: Bool) throws -> [NativeSessionMessage] {
        guard let sourcePath = session.sourcePath else { return [] }
        let records = try readJSONLines(URL(fileURLWithPath: sourcePath), maximumBytes: forIngestion ? nil : 4 * 1_024 * 1_024)
        var result: [NativeSessionMessage] = []
        for (ordinal, record) in records.enumerated() {
            guard let type = record["type"] as? String, type == "user" || type == "assistant",
                  let message = record["message"] as? [String: Any] else { continue }
            let raw = textContent(message["content"])
            guard let text = type == "user"
                ? visibleBackendUserRequest(raw)
                : Optional(raw.trimmingCharacters(in: .whitespacesAndNewlines)),
                !text.isEmpty else { continue }
            let timestamp = (record["timestamp"] as? String).flatMap(iso8601.date(from:))
            result.append(NativeSessionMessage(
                id: (record["uuid"] as? String) ?? "claude-\(result.count)",
                role: type == "user" ? .user : .assistant,
                text: text,
                timestamp: timestamp,
                ordinal: ordinal
            ))
        }
        return forIngestion ? result : Array(result.suffix(400))
    }

    private static func columnText(_ statement: OpaquePointer, _ index: Int32) -> String {
        guard let value = sqlite3_column_text(statement, index) else { return "" }
        return String(cString: value)
    }

    private static func readJSONLines(_ url: URL, maximumBytes: Int?) throws -> [[String: Any]] {
        let data: Data
        if let maximumBytes {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let fileSize = try handle.seekToEnd()
            if fileSize <= UInt64(maximumBytes) {
                try handle.seek(toOffset: 0)
                data = try handle.readToEnd() ?? Data()
            } else {
                // Keep session identity/title context from the beginning and
                // current activity from the end. Reading only the first bytes
                // made long-running Claude sessions look stale after resume.
                let headBytes = max(64 * 1_024, maximumBytes / 4)
                let tailBytes = max(64 * 1_024, maximumBytes - headBytes)
                try handle.seek(toOffset: 0)
                let head = try handle.read(upToCount: headBytes) ?? Data()
                try handle.seek(toOffset: fileSize - UInt64(tailBytes))
                var tail = try handle.readToEnd() ?? Data()
                if let newline = tail.firstIndex(of: 0x0A) {
                    tail = Data(tail[tail.index(after: newline)...])
                }
                data = head + Data("\n".utf8) + tail
            }
        } else {
            data = try Data(contentsOf: url, options: [.mappedIfSafe])
        }
        return String(decoding: data, as: UTF8.self).split(separator: "\n").compactMap { line in
            guard let lineData = String(line).data(using: .utf8) else { return nil }
            return (try? JSONSerialization.jsonObject(with: lineData)) as? [String: Any]
        }
    }

    private static func textContent(_ value: Any?) -> String {
        if let value = value as? String { return value }
        guard let values = value as? [[String: Any]] else { return "" }
        return values.compactMap { item -> String? in
            guard item["type"] as? String == "text" || item["type"] as? String == "input_text" || item["type"] as? String == "output_text" else { return nil }
            return item["text"] as? String
        }.joined(separator: "\n\n")
    }

    private static func firstLine(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return String((trimmed.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? trimmed).prefix(90))
    }
}

private enum MessageRole: String, Codable, Sendable {
    case user
    case assistant
    case receipt
    case system
}

private struct ChatMessage: Codable, Identifiable, Equatable, Sendable {
    let id: UUID
    let role: MessageRole
    let text: String
    let provider: String?
    let permissionProfile: String?
    let timestamp: Date
    /// Receipts record native readback; false on an assistant message marks
    /// provisional custody only. Absent on historical adopted messages.
    let nativeRecordVerified: Bool?
    /// Set when the message was read back from a bound native session rather
    /// than sent or adopted through OS-1 (provider:recordID).
    let nativeIngestedID: String?
    /// A corrected import, retained byte-for-byte for audit but not authored by
    /// the user. Never render or hand this managed transport row to a model.
    var nativeManagedTurnID: String? = nil

    init(
        id: UUID = UUID(),
        role: MessageRole,
        text: String,
        provider: String? = nil,
        permissionProfile: String? = nil,
        timestamp: Date = Date(),
        nativeRecordVerified: Bool? = nil,
        nativeIngestedID: String? = nil
    ) {
        self.id = id
        self.role = role
        self.text = text
        self.provider = provider
        self.permissionProfile = permissionProfile
        self.timestamp = timestamp
        self.nativeRecordVerified = nativeRecordVerified
        self.nativeIngestedID = nativeIngestedID
    }
}

private struct ConversationSession: Codable, Identifiable, Sendable {
    let id: UUID
    var title: String
    var workspace: String
    var provider: ProviderChoice
    var messages: [ChatMessage]
    var codexSessionID: String?
    var claudeSessionID: String?
    var lastProvider: String?
    var sourceContext: SourceReference?
    var sourceContextVersion: Int?
    var codexCapacity: Int?
    var claudeCapacity: Int?
    var pinnedAt: Date?
    var sidebarPosition: Int?
    var archived: Bool?
    var draft: String?
    var lastFailure: PendingSubmission?
    var lastBackendFailure: BackendFailureNotice?
    var preservedTasks: [PreservedTask]? = nil
    /// OS-1 owned shared task state (objective, decisions, project baseline,
    /// bound sources, backend bindings, executions). Migrated on load.
    var taskContext: TaskContext?
    var queuePaused: Bool?
    var forkedFrom: ConversationForkOrigin?
    var completedForkCheckpoint: ConversationForkCheckpoint?
    var ownedCodexTurnIDs: [String]? = nil
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        title: String = "New session pair",
        workspace: String,
        provider: ProviderChoice = .auto,
        messages: [ChatMessage] = [],
        codexSessionID: String? = nil,
        claudeSessionID: String? = nil,
        lastProvider: String? = nil,
        codexCapacity: Int = 30,
        claudeCapacity: Int = 100,
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.title = title
        self.workspace = workspace
        self.provider = provider
        self.messages = messages
        self.codexSessionID = codexSessionID
        self.claudeSessionID = claudeSessionID
        self.lastProvider = lastProvider
        self.sourceContext = nil
        self.sourceContextVersion = 2
        self.codexCapacity = codexCapacity
        self.claudeCapacity = claudeCapacity
        self.updatedAt = updatedAt
    }

    var effectiveCodexCapacity: Int { codexCapacity ?? 30 }
    var effectiveClaudeCapacity: Int { claudeCapacity ?? 100 }
    var visibleMessages: [ChatMessage] { messages.filter { $0.nativeManagedTurnID == nil } }
}

/// A user may leave an unfinished objective, but its evidence is never erased
/// or upgraded to completion to let another request run.
private struct PreservedTask: Codable, Sendable {
    let request: PendingSubmission?
    let failure: BackendFailureNotice?
    let context: TaskContext?
    let source: SourceReference?
    let timestamp: Date
}

private struct ConversationForkOrigin: Codable, Sendable {
    let conversationID: UUID
    let throughMessageID: UUID?
}

/// A completed-history boundary, not a second copy of the transcript or a live
/// native writer. Keep its source/context together when later turns are active.
private struct ConversationForkCheckpoint: Codable, Sendable {
    let throughMessageID: UUID?
    let source: SourceReference?
    let context: TaskContext?
}

private struct SessionEnvelope: Codable {
    let schema: Int
    let sessions: [ConversationSession]
    var queued: [PendingSubmission]? = nil
    var inFlight: [PendingSubmission]? = nil
    var sidebarIntents: [String: SidebarPinIntent]? = nil
    var nativePinnedOrders: [String: [String]]? = nil
}

/// One unreadable conversation must not hide every other one.
private struct LossyDecodable<Value: Decodable>: Decodable {
    let value: Value?
    init(from decoder: Decoder) throws { value = try? Value(from: decoder) }
}

private struct LenientSessionEnvelope: Decodable {
    let schema: Int
    let sessions: [LossyDecodable<ConversationSession>]
    var queued: [PendingSubmission]? = nil
    var inFlight: [PendingSubmission]? = nil
    var sidebarIntents: [String: SidebarPinIntent]? = nil
    var nativePinnedOrders: [String: [String]]? = nil
}

private func migratedTaskContext(_ session: ConversationSession, sourceContext: SourceReference?) -> TaskContext {
    session.taskContext ?? TaskContext.migrated(conversationID: session.id,
        request: session.visibleMessages.last(where: { $0.role == .user })?.text ?? "", workspace: session.workspace,
        sourceContext: sourceContext, codexSessionID: session.codexSessionID, claudeSessionID: session.claudeSessionID,
        now: session.updatedAt)
}

private func migratedSourceReference(_ session: ConversationSession, store: SourceContextStore = SourceContextStore()) -> SourceReference? {
    if session.sourceContextVersion == 2 { return session.sourceContext }
    let messages = session.visibleMessages
    for index in messages.indices.reversed() {
        let message = messages[index]
        if message.role == .user, detachesConversationSource(message.text) { return nil }
        guard index > 0, message.role == .receipt, message.provider == "local",
              messages[index - 1].role == .assistant, messages[index - 1].provider == "local",
              let match = message.text.range(of: #"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}\.json\b"#, options: .regularExpression),
              let id = UUID(uuidString: String(message.text[match].dropLast(5))) else { continue }
        if let reference = store.legacyReference(id: id, output: messages[index - 1].text) { return reference }
    }
    return nil
}

private func sessionHandoff(_ session: ConversationSession, before userMessageID: UUID? = nil) throws -> String {
    let bounded: ArraySlice<ChatMessage>
    if let id = userMessageID, let index = session.messages.firstIndex(where: { $0.id == id }) {
        bounded = session.messages[..<index]
    } else { bounded = session.messages[...] }
    // Retain all available turns up to the transport's UTF-8 byte budget,
    // instead of discarding a decision solely because it is 17 messages old.
    let text = bounded.filter { $0.nativeManagedTurnID == nil && ($0.role == .user || $0.role == .assistant) }.map { message in
        var speaker = message.role == .user ? "USER" : providerDisplayName(message.provider)
        if message.nativeIngestedID != nil { speaker += " [native session, outside OS-1]" }
        var content = message.text
        if message.role == .assistant, message.nativeRecordVerified == false {
            content = "[UNVERIFIED BACKEND OUTPUT — saved locally, not adopted or completed]\n" + content
        }
        for marker in ["USER", "OS-1", "CLAUDE", "CODEX"] {
            content = content.replacingOccurrences(of: "\n\n\(marker):\n", with: "\n\n[quoted \(marker)]:\n")
        }
        return "\(speaker):\n\(content)"
    }.joined(separator: "\n\n")
    var sourceSession = session
    if session.sourceContextVersion != 2 { sourceSession.messages = Array(bounded) }
    return try SessionHandoff(transcript: text, source: migratedSourceReference(sourceSession),
                              taskContext: session.taskContext).encoded()
}

private struct PendingSubmission: Identifiable, Codable, Equatable, Sendable {
    let id: UUID
    let sessionID: UUID
    let userMessageID: UUID
    var request: String
    var provider: ProviderChoice
    let workspace: String
    let codexCapacity: Int
    let claudeCapacity: Int
    let readOnlyReconciliation: Bool?
    var deliveryID: String? = nil
    var savedResultNeedsReview: Bool? = nil
    var preflightOnly: Bool? = true
    // Internal recovery is a phase of the original request, never a synthetic
    // user turn or a replacement objective. Optional for older session stores.
    var recoveryParentID: UUID? = nil
    var recoveryAttempted: Bool? = nil
    var sourceRetryIdentity: String? = nil
    /// Routing preference before an explicit provider name in the queued text.
    /// Absent in legacy stores; retain that item's original provider on edit.
    var configuredProvider: ProviderChoice? = nil
    var correctionIDs: [UUID]? = nil
    var liveCorrections: [String]? = nil
    var amendedRequest: String? = nil
    var startNextRequested: Bool? = nil
    var replacesSubmissionID: UUID? = nil
    var replacesObjective: Bool? = nil
    var executionRequest: String {
        (liveCorrections ?? []).reduce(amendedRequest.map {
            ExecutionSteering.continuation(original: $0, correction: request)
        } ?? request) { ExecutionSteering.continuation(original: $0, correction: $1) }
    }

    init(
        id: UUID = UUID(),
        sessionID: UUID,
        userMessageID: UUID,
        request: String,
        provider: ProviderChoice,
        workspace: String,
        codexCapacity: Int,
        claudeCapacity: Int,
        readOnlyReconciliation: Bool? = nil
    ) {
        self.id = id
        self.sessionID = sessionID
        self.userMessageID = userMessageID
        self.request = request
        self.provider = provider
        self.workspace = workspace
        self.codexCapacity = codexCapacity
        self.claudeCapacity = claudeCapacity
        self.readOnlyReconciliation = readOnlyReconciliation
    }
}

private struct AppNativeRecord: Decodable, Sendable {
    let turnID: String?
    let recordPath: String?
    let persistence: String
    let desktopVisibility: String

    enum CodingKeys: String, CodingKey {
        case turnID = "turn_id"
        case recordPath = "record_path"
        case persistence
        case desktopVisibility = "desktop_visibility"
    }

    var isVerified: Bool { persistence == "verified" }
}

private struct AppRunStep: Decodable, Sendable {
    let sequence: Int
    let provider: String
    let action: String
    let model: String?
    let effort: String
    let revasDisposition: String
    let sessionID: String
    let permissionProfile: String
    let exitCode: Int32
    let output: String
    let stderr: String
    let durationMS: Int64
    let nativeRecord: AppNativeRecord?

    enum CodingKeys: String, CodingKey {
        case sequence, provider, action, model, effort, output, stderr
        case revasDisposition = "revas_disposition"
        case sessionID = "session_id"
        case permissionProfile = "permission_profile"
        case exitCode = "exit_code"
        case durationMS = "duration_ms"
        case nativeRecord = "native_record"
    }
}

private func appSHA256Hex(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

private func stepRecordIsVerified(_ step: AppRunStep) -> Bool {
    guard let record = step.nativeRecord, record.isVerified else { return false }
    guard step.revasDisposition == "control_verified" else { return true }
    guard let path = record.recordPath,
          let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
          data.count <= 1_000_000,
          let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          receipt["operation_id"] as? String == step.sessionID,
          receipt["result_sha256"] as? String == appSHA256Hex(step.output),
          let attributes = try? FileManager.default.attributesOfItem(atPath: path),
          (attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600 else { return false }
    switch step.action {
    case "registered_source_retrieval":
        guard receipt["operation"] as? String == "registered_source_retrieval",
              receipt["verification_mode"] as? String == RegisteredProjectSource.verificationMode,
              receipt["registered_source_verified"] as? Bool == true,
              receipt["r2_verified"] as? Bool == false, receipt["bucket"] is NSNull,
              receipt["model_invoked"] as? Bool == false,
              receipt["source_count"] as? Int == 5,
              let sources = receipt["sources"] as? [[String: String]], sources.count == 5,
              Set(sources.compactMap { $0["source_path"] }) == Set(RegisteredProjectSource.selectedPaths + ["source-inventory.txt"]),
              sources.allSatisfy(RegisteredProjectSource.validSourceRecord) else { return false }
        return ProjectMaterialObject.validSHA(receipt["evidence_sha256"] as? String ?? "") &&
            ProjectMaterialObject.validSHA(receipt["request_sha256"] as? String ?? "")
    case "r2_retrieval":
        guard receipt["operation"] as? String == "r2_retrieval",
              receipt["bucket"] as? String == "omar-private-archive",
              let verificationMode = receipt["verification_mode"] as? String,
              [
                  "live-manifest-verified-cache-readback",
                  "live-content-addressed-r2-readback+base-bundle",
                  "live-r2-opt-research-map+separate-qmgr-v1",
                  SCVProjectMaterials.verificationMode,
              ].contains(verificationMode),
              receipt["r2_verified"] as? Bool == true,
              receipt["model_invoked"] as? Bool == false,
              let sourceCount = (receipt["source_count"] as? NSNumber)?.intValue, sourceCount > 0,
              let sources = receipt["sources"] as? [[String: Any]], sources.count == sourceCount,
              (receipt["evidence_sha256"] as? String)?.count == 64,
              (receipt["request_sha256"] as? String)?.count == 64,
              receipt["issued_at"] as? String != nil else { return false }
        func validSupplement(_ source: [String: Any]) -> Bool {
                source["repository"] as? String == "private-r2/qmgr-objective-v1" &&
                    (source["object_key"] as? String)?.hasPrefix(
                        "os1-clodex/research/qmgr-objective/v1/evidence/"
                    ) == true &&
                    (source["source_path"] as? String)?.isEmpty == false &&
                    (source["retrieved_content_sha256"] as? String)?.count == 64 &&
                    Int(source["object_size"] as? String ?? "") != nil &&
                    (source["transport_object_key"] as? String)?.isEmpty == false &&
                    (source["transport_sha256"] as? String)?.count == 64 &&
                    source["base_repository"] as? String ==
                        "effacermonexistence/orthogonal-projection-term-benchmarks" &&
                    (source["base_repository_sha"] as? String)?.count == 40 &&
                    (source["base_bundle_key"] as? String)?.isEmpty == false &&
                    (source["base_bundle_sha256"] as? String)?.count == 64
        }
        func validBundle(_ source: [String: Any]) -> Bool {
            (source["repository"] as? String)?.isEmpty == false &&
                (source["object_key"] as? String)?.isEmpty == false &&
                (source["repository_sha"] as? String)?.count == 40 &&
                (source["bundle_sha256"] as? String)?.count == 64 &&
                Int(source["object_size"] as? String ?? "") != nil &&
                (source["source_path"] as? String)?.isEmpty == false &&
                ((source["retrieved_content_sha256"] as? String)?.count == 64 ||
                    (source["source_content_sha256"] as? String)?.count == 64)
        }
        if verificationMode == SCVProjectMaterials.verificationMode {
            let typed = sources.compactMap { $0 as? [String: String] }
            let paths = Set(typed.compactMap { $0["source_path"] })
            return sourceCount == 5 && typed.count == 5 &&
                paths == Set(["Dockerfile", "package.json", "SCV_DESIGN_INTENT_LOCK.md", "scv-structured-state-schema.js", "source-inventory.txt"]) &&
                typed.allSatisfy(SCVProjectMaterials.validSourceRecord)
        }
        if verificationMode == "live-content-addressed-r2-readback+base-bundle" {
            return sourceCount == 8 && sources.allSatisfy(validSupplement)
        }
        if verificationMode == "live-r2-opt-research-map+separate-qmgr-v1" {
            let originals = sources.filter { $0["repository"] as? String == "effacermonexistence/orthogonal-projection-term-benchmarks" }
            let supplements = sources.filter { $0["repository"] as? String == "private-r2/qmgr-objective-v1" }
            let paths = Set(originals.compactMap { $0["source_path"] as? String })
            return sourceCount == 16 && originals.count == 8 && supplements.count == 8 &&
                paths.count == 8 && ["docs/CONCEPTUAL_ORIGIN.md", "docs/OPERATOR.md", "docs/EQUATION_INSERTIONS.md"].allSatisfy(paths.contains) &&
                originals.allSatisfy(validBundle) && supplements.allSatisfy(validSupplement)
        }
        return sources.allSatisfy(validBundle)
    case "connection_check":
        return receipt["operation"] as? String == "connection_check" &&
            (receipt["github_verified"] as? Bool == true || receipt["r2_verified"] as? Bool == true)
    case "source_status":
        return receipt["operation"] as? String == "source_status" &&
            receipt["github_repository"] as? String == "effacermonexistence/codex" &&
            (receipt["github_main_sha"] as? String)?.count == 40 &&
            receipt["r2_bucket"] as? String == "omar-private-archive" &&
            (receipt["r2_repository_sha"] as? String)?.count == 40 &&
            (receipt["r2_bundle_sha256"] as? String)?.count == 64 &&
            (receipt["public_release_sha256"] as? String)?.count == 64 &&
            receipt["model_invoked"] as? Bool == false
    case "protected_material_guard":
        return receipt["operation"] as? String == "protected_route_material_guard" &&
            receipt["model_egress_blocked"] as? Bool == true
    case "work_preparation":
        return receipt["operation"] as? String == "work_preparation" &&
            (receipt["project_id"] as? String)?.isEmpty == false &&
            (receipt["workspace"] as? String)?.isEmpty == false &&
            (receipt["workspace_manifest_sha256"] as? String)?.count == 64 &&
            receipt["model_invoked"] as? Bool == false
    default:
        return false
    }
}

/// Receipt wording is derived from evidence the runtime actually gathered, so
/// the receipt never says more than what was read back from the backend.
private func nativeRecordReceipt(_ step: AppRunStep) -> String {
    guard let record = step.nativeRecord else { return "native session linked (unverified)" }
    var parts: [String] = []
    if record.isVerified {
        let file = record.recordPath.map { URL(fileURLWithPath: $0).lastPathComponent } ?? "record"
        parts.append("native record verified · \(file)")
    } else {
        parts.append("native record \(record.persistence)")
    }
    switch record.desktopVisibility {
    case "local_only": parts.append("local exact receipt persisted")
    case "control_only": parts.append("local control receipt persisted")
    case "revealed": parts.append("Codex Desktop: synced and opened")
    case "claude_revealed": parts.append("Claude Desktop: synced and opened")
    case "registered_in_background": parts.append("Codex Desktop: synced in background")
    case "claude_registered_in_background": parts.append("Claude Desktop: synced in background")
    case "native_record_only": parts.append("native session saved · external app not opened")
    case "not_revealed": parts.append("\(step.provider == "claude" ? "Claude" : "Codex") Desktop: kept in background")
    case "desktop_not_running": parts.append("Codex Desktop: lists on launch")
    case let value where value.hasPrefix("reveal_failed"): parts.append("Codex Desktop: open failed")
    case let value where value.hasPrefix("claude_reveal_failed"): parts.append("Claude Desktop: sync failed")
    default: break
    }
    return parts.joined(separator: " · ")
}

private func savedResultReceipt(_ result: DeliveryRecord, id: UUID = UUID(), timestamp: Date = Date()) -> ChatMessage {
    let step = try? JSONDecoder().decode(AppRunStep.self, from: result.step)
    let verified = SavedResultEvidence.codexRecordVerified(result)
    let verdict = result.response.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["status"] as? String
    let review = result.localRejection != nil || (verdict != nil && verdict != "complete")
    let disposition = review ? "결과 검토 필요 · 과제 완료 판정 아님" : "서버 검증·전달 대기 · 과제 완료 판정 아님"
    var parts = [verified ? "백엔드 실행 기록·답변 원본 확인됨" : "답변 원본 보존됨 · 백엔드 실행 기록 미확인", disposition]
    if let step {
        parts += [step.provider, step.model ?? "provider default", step.effort + " reasoning",
                  "step \(step.sequence)", "\(step.durationMS / 1_000)s", "exit \(step.exitCode)"]
    }
    return ChatMessage(id: id, role: .receipt, text: parts.joined(separator: " · "),
        provider: step?.provider, permissionProfile: step?.permissionProfile, timestamp: timestamp, nativeRecordVerified: verified)
}

/// Refresh only the visible receipt for a saved failed attempt. Original chat
/// bytes, user messages, answer and unfinished objective remain untouched.
private func presentedMessages(_ session: ConversationSession) -> [ChatMessage] {
    var messages = session.visibleMessages
    guard let deliveryID = session.lastFailure?.deliveryID,
          let previewID = UUID(uuidString: String(deliveryID.prefix(36))),
          let index = messages.firstIndex(where: { $0.id == previewID && $0.role == .assistant }),
          index + 1 < messages.count, messages[index + 1].role == .receipt,
          let result = try? DeliveryOutbox().read(deliveryID), result.output == messages[index].text else { return messages }
    messages[index + 1] = savedResultReceipt(result, id: messages[index + 1].id, timestamp: messages[index + 1].timestamp)
    if messages[index + 1].nativeRecordVerified == true, index + 2 < messages.count,
       messages[index + 2].role == .system, messages[index + 2].text == BackendBlocker.unclassified.message {
        let old = messages[index + 2]
        messages[index + 2] = ChatMessage(id: old.id, role: old.role,
            text: "저장된 답변은 확인됐습니다. 다만 이 시도의 과제 완료 판정은 통과하지 못했습니다.", timestamp: old.timestamp)
    }
    return messages
}

private struct AppRunSummary: Decodable, Sendable {
    let status: String
    let steps: [AppRunStep]
    var sourceContext: SourceReference? = nil
    var taskContext: TaskContext? = nil
    var persistedCorrectionIDs: [UUID]? = nil
}

private struct NativeIngestionOutcome: Sendable {
    let binding: TaskContext.BackendBinding
    let records: [NativeRecord]
    let cursor: String?
    var managedRecords: [NativeRecord] = []
}

/// Repair only exact native IDs AND bytes from independently owned turns.
/// Preserve original messages; one projection serves UI, copy and handoff.
@discardableResult
private func repairManagedImports(_ session: inout ConversationSession, records: [NativeRecord]) -> Bool {
    let managed = Dictionary(records.compactMap { r -> (String, NativeRecord)? in
        r.turnID == nil ? nil : (r.id, r)
    }, uniquingKeysWith: { first, _ in first })
    var changed = false
    var batch: [Int] = []
    for i in session.messages.indices {
        let message = session.messages[i]
        if let nativeID = message.nativeIngestedID {
            batch.append(i)
            if let record = managed[nativeID], record.text == message.text,
               record.role == message.role.rawValue, message.nativeManagedTurnID != record.turnID {
                session.messages[i].nativeManagedTurnID = record.turnID
                changed = true
            }
        } else {
            if message.role == .receipt, message.text.contains("OS-1 외부 작업, 채택 판정 아님"),
               !batch.isEmpty, batch.allSatisfy({ session.messages[$0].nativeManagedTurnID != nil }),
               message.nativeManagedTurnID == nil {
                session.messages[i].nativeManagedTurnID = session.messages[batch[0]].nativeManagedTurnID
                changed = true
            }
            batch = []
        }
    }
    return changed
}

private func nativeProvenanceSelfTest() throws {
    func check(_ value: Bool, _ name: String) throws {
        guard value else { throw RunnerError.message("Native provenance: " + name) }
    }
    let objective = "인스타그램 세팅을 좀 해봐. 수정 준비해"
    let internalText = BackendRecovery.readbackPrompt(objective: objective)
    var session = ConversationSession(workspace: "/tmp/fixture")
    let genuine = ChatMessage(role: .user, text: objective)
    let final = ChatMessage(role: .assistant, text: "상태 확인 결과", provider: "codex")
    let rows = [NativeRecord(id: "codex:readback", ordinal: 1, role: "user", text: internalText, complete: true, turnID: "managed-retry"),
                NativeRecord(id: "codex:progress", ordinal: 2, role: "assistant", text: "상태 확인 중", complete: true, turnID: "managed-retry")]
    session.messages = [genuine, final] + rows.map {
        ChatMessage(role: $0.role == "user" ? .user : .assistant, text: $0.text, provider: "codex", nativeIngestedID: $0.id)
    } + [ChatMessage(role: .receipt, text: "CODEX 기록 2건 · OS-1 외부 작업, 채택 판정 아님")]
    let outside = ChatMessage(role: .user, text: internalText, provider: "codex", nativeIngestedID: "codex:genuine-quote")
    session.messages.append(outside)
    let originals = session.messages
    try check(repairManagedImports(&session, records: rows), "incident not repaired")
    try check(session.visibleMessages.map(\.id) == [genuine.id, final.id, outside.id], "external quote or adopted final lost")
    try check(!repairManagedImports(&session, records: rows), "migration not idempotent")
    for (old, new) in zip(originals, session.messages) {
        var restored = new; restored.nativeManagedTurnID = nil
        try check(restored == old, "original bytes/ID/role/time altered")
    }
    session.messages.removeLast() // the legitimate user quote is intentionally absent in this context assertion
    let handoff = try sessionHandoff(session)
    try check(!handoff.contains("중단된 작업의 현재 상태만"), "internal instructions leaked into provider context")
    try check(presentedMessages(session).map(\.id) == [genuine.id, final.id], "UI/copy projection differs")
    let outsideRecord = NativeRecord(id: "codex:later-user-quote", ordinal: 20, role: "user", text: internalText,
        complete: true, turnID: "external-turn")
    let held = Set(session.visibleMessages.map { NativeIngestion.digestOf($0.text) })
    try check(NativeIngestion.newRecords([outsideRecord], after: nil, sentByOS1: held, seen: []).records == [outsideRecord],
        "archived internal text suppressed a later genuine user quote")
    let roundtrip = try JSONDecoder().decode(ConversationSession.self, from: JSONEncoder().encode(session))
    try check(roundtrip.visibleMessages == session.visibleMessages, "restart lost provenance")
    var altered = ConversationSession(workspace: "/tmp/fixture")
    altered.messages = [ChatMessage(role: .user, text: internalText + " THIS IS MY QUOTE", nativeIngestedID: rows[0].id)]
    try check(!repairManagedImports(&altered, records: rows), "matched ID with different bytes hidden")
    print("Native provenance: exact managed rows hidden from UI/copy/context; originals, external quote, restart and idempotency PASS; model calls 0")
}

private enum RunnerError: LocalizedError {
    case message(String)
    case backend(BackendFailureNotice)

    var errorDescription: String? {
        switch self {
        case .message(let value): return value
        case .backend(let notice): return notice.blocker.message
        }
    }
}

private func backendTierLabel(action: String, provider: String) -> String {
    if provider == "local" || action == "deterministic_compute" || action == "os1_exact" {
        return "OS-1"
    }
    let engine = provider == "codex" ? "Codex" : "Claude"
    switch action {
    case "agent_run_efficient": return "Efficient \(engine) backend"
    case "agent_run_deep": return "Deep \(engine) backend"
    default: return "Standard \(engine) backend"
    }
}

private func compactSessionAge(_ date: Date) -> String {
    let seconds = max(0, Int(Date().timeIntervalSince(date)))
    if seconds < 60 { return "now" }
    if seconds < 3_600 { return "\(seconds / 60)m" }
    if seconds < 86_400 { return "\(seconds / 3_600)h" }
    if seconds < 2_592_000 { return "\(seconds / 86_400)d" }
    return date.formatted(date: .abbreviated, time: .omitted)
}

private enum OS1Runner {
    static func pinNativeSession(id: String, pinned: Bool, before: String?) async throws {
        try await Task.detached(priority: .userInitiated) {
            let process = Process(), output = Pipe()
            process.executableURL = URL(fileURLWithPath: try executable())
            process.arguments = ["sidebar-pin", "codex", id, String(pinned)] + (before.map { [$0] } ?? [])
            process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser
            process.standardOutput = output
            process.standardError = FileHandle.nullDevice
            try process.run()
            let deadline = Date().addingTimeInterval(40)
            while process.isRunning && Date() < deadline { try await Task.sleep(for: .milliseconds(50)) }
            if process.isRunning { process.terminate(); throw RunnerError.message("Codex 핀 변경 확인 시간이 초과됐습니다. 상태를 새로 확인하세요.") }
            process.waitUntilExit()
            let text = String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
            guard process.terminationStatus == 0, text.contains("OS1_SIDEBAR_VERIFIED") else {
                throw RunnerError.message("Codex 핀 변경을 확인하지 못했습니다. OS1에만 저장된 상태입니다.")
            }
        }.value
    }
    static func observeActivity(_ process: Process, at url: URL, onActivity: (RuntimeActivity) -> Void) {
        var lastActivity: RuntimeActivity?
        func readLatest() {
            if let data = try? Data(contentsOf: url), data.count <= 150_000,
               let activity = try? JSONDecoder().decode(RuntimeActivity.self, from: data), activity != lastActivity {
                lastActivity = activity; onActivity(activity)
            }
        }
        while process.isRunning { readLatest(); Thread.sleep(forTimeInterval: 0.1) }
        process.waitUntilExit(); readLatest()
    }
    static func run(
        workspace: String,
        prompt: String,
        provider: ProviderChoice,
        context: String,
        codexSessionID: String?,
        claudeSessionID: String?,
        codexCapacity: Int,
        claudeCapacity: Int,
        requireReadOnly: Bool = false,
        deliveryID: String? = nil,
        submissionID: UUID? = nil,
        onActivity: @escaping @Sendable (RuntimeActivity) -> Void = { _ in }
    ) async throws -> AppRunSummary {
        try await Task.detached(priority: .userInitiated) {
            try runBlocking(
                workspace: workspace,
                prompt: prompt,
                provider: provider,
                context: context,
                codexSessionID: codexSessionID,
                claudeSessionID: claudeSessionID,
                codexCapacity: codexCapacity,
                claudeCapacity: claudeCapacity,
                requireReadOnly: requireReadOnly,
                deliveryID: deliveryID,
                submissionID: submissionID,
                onActivity: onActivity
            )
        }.value
    }

    private static func executable() throws -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let bundled = Bundle.main.resourceURL?.appendingPathComponent("os1").path
        let candidates = [bundled].compactMap { $0 } + [
            "\(home)/.local/bin/os1",
            "/usr/local/bin/os1",
            "/opt/homebrew/bin/os1",
        ]
        guard let path = candidates.first(where: FileManager.default.isExecutableFile) else {
            throw RunnerError.message("OS-1 runtime is missing. Reinstall OS-1, then try again.")
        }
        return path
    }

    private static func runBlocking(
        workspace: String,
        prompt: String,
        provider: ProviderChoice,
        context: String,
        codexSessionID: String?,
        claudeSessionID: String?,
        codexCapacity: Int,
        claudeCapacity: Int,
        requireReadOnly: Bool,
        deliveryID: String?,
        submissionID: UUID?,
        onActivity: @escaping @Sendable (RuntimeActivity) -> Void
    ) throws -> AppRunSummary {
        let fileManager = FileManager.default
        let temporary = fileManager.temporaryDirectory
            .appendingPathComponent("os1-app-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(
            at: temporary,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        defer { try? fileManager.removeItem(at: temporary) }

        let stdoutURL = temporary.appendingPathComponent("stdout.json")
        let stderrURL = temporary.appendingPathComponent("stderr.txt")
        fileManager.createFile(atPath: stdoutURL.path, contents: nil)
        fileManager.createFile(atPath: stderrURL.path, contents: nil)
        let stdout = try FileHandle(forWritingTo: stdoutURL)
        let stderr = try FileHandle(forWritingTo: stderrURL)

        var arguments = [
            "run",
            "--workspace", workspace,
            "--prompt", prompt,
            "--provider", provider.rawValue,
            "--output-format", "json",
        ]
        if !context.isEmpty {
            let contextURL = temporary.appendingPathComponent("session-context.txt")
            try Data(context.utf8).write(
                to: contextURL,
                options: [.atomic, .completeFileProtectionUnlessOpen]
            )
            try fileManager.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: contextURL.path
            )
            arguments += ["--context-file", contextURL.path]
        }
        if let codexSessionID { arguments += ["--codex-session-id", codexSessionID] }
        if let claudeSessionID { arguments += ["--claude-session-id", claudeSessionID] }
        if requireReadOnly { arguments.append("--read-only-reconciliation") }
        arguments += [
            "--codex-capacity", String(codexCapacity),
            "--claude-capacity", String(claudeCapacity),
            // Record-only: keep native history available to OS-1's inspector,
            // without delivering URLs that can activate the external app.
            "--desktop-reveal", "background",
        ]
        let savedResult = submissionID.flatMap { DeliveryOutbox().forSubmission($0.uuidString) }
        if let storedID = deliveryID ?? savedResult?.id { arguments = ["resume-delivery", storedID] }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: try executable())
        process.arguments = arguments
        process.standardOutput = stdout
        process.standardError = stderr
        var environment = ProcessInfo.processInfo.environment
        let home = fileManager.homeDirectoryForCurrentUser.path
        let preferredPath = [
            "\(home)/.local/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            environment["PATH"] ?? "",
        ].joined(separator: ":")
        environment["PATH"] = preferredPath
        // Finder and terminal launches can leave a stale PWD pointing into a
        // protected folder. Keep the actual cwd and advertised cwd consistent.
        process.currentDirectoryURL = URL(fileURLWithPath: workspace, isDirectory: true)
        environment["PWD"] = workspace
        let activityURL = temporary.appendingPathComponent("activity.json")
        environment["OS1_ACTIVITY_FILE"] = activityURL.path
        let failureURL = temporary.appendingPathComponent("backend-failure.json")
        environment["OS1_FAILURE_FILE"] = failureURL.path
        if let submissionID { environment["OS1_SUBMISSION_ID"] = submissionID.uuidString }
        let journalRoot = fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/run-journals")
        try fileManager.createDirectory(at:journalRoot,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
        let journal = journalRoot.appendingPathComponent((submissionID?.uuidString ?? UUID().uuidString) + ".jsonl")
        if !fileManager.fileExists(atPath:journal.path) { fileManager.createFile(atPath:journal.path,contents:nil,attributes:[.posixPermissions:0o600]) }
        environment["OS1_EVENT_JOURNAL"] = journal.path
        environment["OS1_ALLOW_AUTHENTICATION"] = "1"
        if let submissionID { environment["OS1_CANCEL_FILE"] = ExecutionCancellation.url(submissionID: submissionID).path }
        process.environment = environment

        do {
            try process.run()
            observeActivity(process, at: activityURL, onActivity: onActivity)
            try stdout.close()
            try stderr.close()
        } catch {
            try? stdout.close()
            try? stderr.close()
            throw RunnerError.message("OS-1 could not start: \(error.localizedDescription)")
        }

        let outputData = try Data(contentsOf: stdoutURL)
        let errorText = String(decoding: try Data(contentsOf: stderrURL), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard process.terminationStatus == 0 else {
            if let data = try? Data(contentsOf: failureURL), data.count < 4096,
               let notice = try? JSONDecoder().decode(BackendFailureNotice.self, from: data),
               ["claude", "codex", "local"].contains(notice.provider) {
                throw RunnerError.backend(notice)
            }
            let fallback = String(decoding: outputData, as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw RunnerError.message(errorText.isEmpty ? fallback : errorText)
        }
        do {
            return try JSONDecoder().decode(AppRunSummary.self, from: outputData)
        } catch {
            throw RunnerError.message("OS-1 returned an unreadable result.")
        }
    }
}

@MainActor
private final class SessionStore: ObservableObject {
    struct ActiveRun {
        let submissionID: UUID
        let started: Date
        var activity: RuntimeActivity
        var provider: ProviderChoice?
        /// Task-context revision handed to this run; a result is adopted only
        /// if no objective/decision change happened after it.
        var handedRevision: Int? = nil
        var forkCheckpoint: ConversationForkCheckpoint? = nil
        var cancellationRequested = false
        var correctionRevision: Int? = nil
        var steeringReady = false
    }
    typealias RunOperation = @MainActor (PendingSubmission, String, String?, String?,
        @escaping @Sendable (RuntimeActivity) -> Void) async throws -> AppRunSummary
    typealias NativeSessionOpener = (URL) -> Bool
    typealias NativePinOperation = @MainActor (String, Bool, String?) async throws -> Void
    // Admission is global; ownership, sequencing, context and display are not.
    static let maximumConcurrentSessions = 4
    @Published var activeRuns: [UUID: ActiveRun] = [:]
    private var primarySubmissionTimes: [UUID: Date] = [:]
    private var inFlightSubmissions: [UUID: PendingSubmission] = [:]
    private var sessionStatuses: [UUID: String] = [:]
    private let runOperation: RunOperation
    @Published var sessions: [ConversationSession] = []
    @Published var selectedSessionID: UUID?
    @Published var surface: ProviderChoice = .auto
    @Published var composer = "" {
        didSet {
            if let index = selectedIndex { sessions[index].draft = composer }
            draftSaveTask?.cancel()
            draftSaveTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(350))
                guard !Task.isCancelled else { return }
                self?.save()
            }
        }
    }
    @Published var search = ""
    @Published var nativeSearch = ""
    @Published var nativeSessions: [NativeSessionSummary] = []
    @Published var selectedNativeSessionID: String?
    @Published var nativeMessages: [NativeSessionMessage] = []
    @Published var isLoadingNativeSessions = false
    var isRunning: Bool { selectedSessionID.map(isSessionRunning) ?? false }
    var isStopping: Bool { selectedSessionID.flatMap { activeRuns[$0]?.cancellationRequested } ?? false }
    var activeSessionID: UUID? { isRunning ? selectedSessionID : nil }
    var pendingProvider: ProviderChoice? { selectedSessionID.flatMap { activeRuns[$0]?.provider } }
    @Published private(set) var queuedSubmissions: [PendingSubmission] = []
    private var pausedQueueIDs = Set<UUID>()
    private var editingQueueIDs = Set<UUID>()
    @Published var statusText = "Ready"
    @Published var alertMessage: String?
    @Published var showArchived = false
    var activeActivity: RuntimeActivity { selectedSessionID.flatMap { activeRuns[$0]?.activity } ?? RuntimeActivity(.preparing) }
    var runStartedAt: Date? { selectedSessionID.flatMap { activeRuns[$0]?.started } }
    private var draftSaveTask: Task<Void, Never>?
    private let customStorageRoot: URL?
    private let nativeSessionOpener: NativeSessionOpener
    private let nativePinOperation: NativePinOperation?
    private var nativeSyncRequestID: UUID?
    private var nativeTranscriptRequestID: UUID?
    @Published var sidebarSyncNotice: String?
    private var sidebarIntents: [String: SidebarPinIntent] = [:]
    private var nativePinnedOrders: [String: [String]] = [:]
    private var observedNativePins: [String: NativePinState] = [:]
    private var sidebarPollRunning = false
    private var sidebarMutationTask: Task<Void, Never>?

    let voiceDictation = VoiceDictationController()

    private let fileManager = FileManager.default

    init(
        storageRoot: URL? = nil,
        runOperation: RunOperation? = nil,
        nativePinOperation: NativePinOperation? = nil,
        nativeSessionOpener: @escaping NativeSessionOpener = { NSWorkspace.shared.open($0) }
    ) {
        customStorageRoot = storageRoot
        self.nativeSessionOpener = nativeSessionOpener
        self.nativePinOperation = nativePinOperation
        self.runOperation = runOperation ?? { submission, context, codexID, claudeID, onActivity in
            try await OS1Runner.run(workspace: submission.workspace, prompt: submission.executionRequest,
                provider: submission.provider, context: context, codexSessionID: codexID, claudeSessionID: claudeID,
                codexCapacity: submission.codexCapacity, claudeCapacity: submission.claudeCapacity,
                requireReadOnly: submission.readOnlyReconciliation == true, deliveryID: submission.deliveryID,
                submissionID: submission.id, onActivity: onActivity)
        }
        load()
        pausedQueueIDs = Set(queuedSubmissions.map(\.id))
        if sessions.isEmpty {
            createSession(provider: .auto)
        } else {
            selectedSessionID = sessions.first(where: { $0.archived != true })?.id ?? sessions.first?.id
            composer = selectedSession?.draft ?? ""
        }
    }

    var selectedIndex: Int? {
        sessions.firstIndex(where: { $0.id == selectedSessionID })
    }

    var selectedSession: ConversationSession? {
        guard let index = selectedIndex else { return nil }
        return sessions[index]
    }

    var selectedSessionQueueCount: Int {
        guard let selectedSessionID else { return 0 }
        return queuedSubmissions.lazy.filter { $0.sessionID == selectedSessionID }.count
    }

    func isSessionRunning(_ sessionID: UUID) -> Bool {
        activeRuns[sessionID] != nil
    }

    func queueReason(_ sessionID: UUID) -> String {
        guard let session = sessions.first(where: { $0.id == sessionID }) else { return "대화 없음" }
        if queuedSubmissions.contains(where: { $0.sessionID == sessionID && $0.startNextRequested == true }), isSessionRunning(sessionID) {
            return "현재 실행 종료 확인 중 · 확인 후 선택한 요청을 시작합니다"
        }
        if session.queuePaused == true { return "대기열 일시정지 · 실행 중 작업은 계속됩니다" }
        if session.lastBackendFailure?.requiresReadback == true { return "이전 작업의 변경 결과 확인 후 계속할 수 있습니다" }
        if session.taskContext?.sourcePreparation != nil { return "검증 원본 확보 대기 · 뒤의 요청은 보존됩니다" }
        if session.lastFailure != nil { return "이전 작업 확인 필요 · 뒤의 요청은 보존됩니다" }
        let items = queuedSubmissions.filter { $0.sessionID == sessionID }
        if items.contains(where: { pausedQueueIDs.contains($0.id) }) { return "앱 재시작 후 보존된 대기열 · 계속 실행을 눌러 주세요" }
        if items.contains(where: { editingQueueIDs.contains($0.id) }) { return "대기 요청 편집 중 · 저장 또는 취소 후 계속됩니다" }
        if isSessionRunning(sessionID) { return "현재 작업이 끝나면 순서대로 자동 실행됩니다" }
        if activeRuns.count >= Self.maximumConcurrentSessions { return "다른 작업의 실행 슬롯 대기 중" }
        return "순서대로 실행 준비 중"
    }

    func canResumeQueue(_ sessionID: UUID) -> Bool {
        guard let session = sessions.first(where: { $0.id == sessionID }),
              session.lastFailure == nil, session.lastBackendFailure == nil,
              session.taskContext?.sourcePreparation == nil else { return false }
        return session.queuePaused == true || queuedSubmissions.contains {
            $0.sessionID == sessionID && pausedQueueIDs.contains($0.id)
        }
    }

    func pauseQueue(_ sessionID: UUID) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
        sessions[index].queuePaused = true
        save()
    }

    private func queueEligible(_ next: PendingSubmission) -> Bool {
        guard let session = sessions.first(where: { $0.id == next.sessionID }) else { return false }
        return !isSessionRunning(next.sessionID) && session.queuePaused != true &&
            ((session.lastFailure == nil && session.lastBackendFailure == nil && session.taskContext?.sourcePreparation == nil) ||
             (next.startNextRequested == true && mayAdvancePastFailure(next, session: session))) &&
            !pausedQueueIDs.contains(next.id) && !editingQueueIDs.contains(next.id)
    }

    private func mayAdvancePastFailure(_ next: PendingSubmission, session: ConversationSession) -> Bool {
        if let failed = session.lastFailure, next.replacesSubmissionID != failed.id { return false }
        // A new read is independent of an uncertain previous write. A dependent
        // write must still reconcile; an action button never expands permission.
        if session.lastBackendFailure?.requiresReadback == true || session.lastFailure?.savedResultNeedsReview == true {
            return ExecutionSteering.isIndependentRead(next.request)
        }
        return true
    }

    private var orderedSessions: [ConversationSession] {
        sessions.sorted {
            if ($0.pinnedAt != nil) != ($1.pinnedAt != nil) { return $0.pinnedAt != nil }
            if let first = $0.pinnedAt, let second = $1.pinnedAt {
                if $0.sidebarPosition != $1.sidebarPosition { return ($0.sidebarPosition ?? Int.max) < ($1.sidebarPosition ?? Int.max) }
                if first != second { return first > second }
            }
            if $0.updatedAt != $1.updatedAt { return $0.updatedAt > $1.updatedAt }
            return $0.id.uuidString < $1.id.uuidString
        }
    }

    var filteredSessions: [ConversationSession] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return orderedSessions.filter {
            ($0.archived == true) == showArchived && (query.isEmpty ||
            $0.title.localizedCaseInsensitiveContains(query) || $0.workspace.localizedCaseInsensitiveContains(query) ||
            $0.messages.contains(where: { $0.text.localizedCaseInsensitiveContains(query) }))
        }
    }

    private var pinnedConversations: [ConversationSession] {
        orderedSessions.filter { $0.archived != true && $0.pinnedAt != nil }
    }

    private var orderedNativeSessions: [NativeSessionSummary] {
        nativeSessions.map { value in
            var row = value
            if let intent = sidebarIntents[SidebarOrder.key(provider: value.provider.rawValue, id: value.id)] {
                row.isPinned = intent.pinned; row.pinPosition = intent.position
                row.pinSyncNote = intent.status == "local_only" ? "OS1에만 저장 · Claude 앱 미반영" : "백엔드 반영 확인 중"
                if intent.status == "failed" { row.pinSyncNote = "백엔드 미확인 · 다시 시도" }
            }
            if row.isPinned, let rank = nativePinnedOrders[row.provider.rawValue]?.firstIndex(of: row.id) { row.pinPosition = rank }
            return row
        }.sorted(by: sidebarNativeLess)
    }

    var filteredNativeSessions: [NativeSessionSummary] {
        let query = nativeSearch.trimmingCharacters(in: .whitespacesAndNewlines)
        let ordered = orderedNativeSessions
        guard !query.isEmpty else { return ordered }
        return ordered.filter {
            $0.displayTitle.localizedCaseInsensitiveContains(query) ||
            $0.workspace.localizedCaseInsensitiveContains(query) ||
            $0.id.localizedCaseInsensitiveContains(query)
        }
    }

    var selectedNativeSession: NativeSessionSummary? {
        nativeSessions.first(where: { $0.id == selectedNativeSessionID })
    }

    func createSession(provider: ProviderChoice? = nil) {
        showArchived = false
        voiceDictation.stop()
        let inherited = provider ?? selectedSession?.provider ?? .auto
        let session = ConversationSession(
            workspace: fileManager.homeDirectoryForCurrentUser.path,
            provider: inherited
        )
        sessions.insert(session, at: 0)
        selectedSessionID = session.id
        composer = ""
        statusText = "Choose a workspace, then describe the task"
        save()
    }

    func select(_ id: UUID) {
        voiceDictation.stop()
        selectedSessionID = id
        composer = selectedSession?.draft ?? ""
        statusText = isSessionRunning(id) ? activeActivity.label : (sessionStatuses[id] ?? "Ready")
        ingestNativeRecords(conversationID: id)
    }

    func chooseProvider(_ provider: ProviderChoice) {
        guard let index = selectedIndex else { return }
        let previous = sessions[index].provider
        guard previous != provider else { return }
        sessions[index].provider = provider
        sessions[index].updatedAt = Date()
        if !sessions[index].messages.isEmpty {
            sessions[index].messages.append(ChatMessage(
                role: .system,
                text: provider == .auto
                    ? "RCC will choose and continue the matching native Codex or Claude session."
                    : "Next turn will create or resume the linked native \(provider.title) session.",
                provider: provider.rawValue
            ))
        }
        statusText = provider == .auto
            ? "RCC will choose the next engine"
            : "Next turn: \(provider.title)"
        save()
    }

    func showClodexHome() {
        surface = .auto
        let retainedProvider = selectedSession?.provider.title ?? "Auto"
        statusText = isRunning
            ? "Clodex home · a governed task is running"
            : (selectedSession?.provider == .auto
                ? "Clodex home · RCC auto routing"
                : "Clodex home · next turn remains \(retainedProvider)")
    }

    func linkedNativeSessionID(for provider: ProviderChoice) -> String? {
        switch provider {
        case .codex: return selectedSession?.codexSessionID
        case .claude: return selectedSession?.claudeSessionID
        case .auto: return nil
        }
    }

    func isShowingLinkedNativeSession(_ provider: ProviderChoice) -> Bool {
        guard let linkedID = linkedNativeSessionID(for: provider) else { return false }
        return surface == provider && selectedNativeSessionID == linkedID
    }

    func inspectBackend(_ provider: ProviderChoice) {
        guard provider != .auto else { return }
        synchronizeNativeSessions(provider, preservingCurrent: false, resetSearch: true)
    }

    private func synchronizeNativeSessions(
        _ provider: ProviderChoice,
        preservingCurrent: Bool,
        resetSearch: Bool
    ) {
        voiceDictation.stop()
        let previousSurface = surface
        let previousSelection = selectedNativeSessionID
        surface = provider
        if resetSearch { nativeSearch = "" }
        let recordedID = linkedNativeSessionID(for: provider)
        if previousSurface != provider || !preservingCurrent {
            nativeSessions = []
            selectedNativeSessionID = nil
            nativeMessages = []
        }
        statusText = "Syncing local \(provider.title) sessions…"
        isLoadingNativeSessions = true
        let requestID = UUID()
        nativeSyncRequestID = requestID
        nativeTranscriptRequestID = nil
        Task {
            do {
                let loaded = try await Task.detached(priority: .userInitiated) {
                    try NativeSessionReader.sessions(for: provider, including: recordedID)
                }.value
                guard surface == provider, nativeSyncRequestID == requestID else { return }
                var linkedTitles: [String: String] = [:]
                for session in sessions {
                    let id = provider == .codex ? session.codexSessionID : session.claudeSessionID
                    if let id { linkedTitles[id] = session.title }
                }
                nativeSessions = loaded.map { value in
                    var copy = value
                    copy.linkedTitle = linkedTitles[value.id]
                    return copy
                }
                selectedNativeSessionID = resolvedNativeSessionID(
                    recordedID: recordedID,
                    currentID: previousSelection,
                    preservingCurrent: preservingCurrent,
                    availableIDs: Set(nativeSessions.map(\.id)))
                isLoadingNativeSessions = false
                if let recordedID {
                    statusText = selectedNativeSessionID == recordedID
                        ? "Current \(provider.title) session · read-only synchronized"
                        : "Recorded \(provider.title) session is unavailable locally"
                } else if selectedNativeSessionID != nil {
                    statusText = "Browsing an unlinked local \(provider.title) session"
                } else {
                    statusText = "No \(provider.title) session recorded for this conversation"
                }
                loadSelectedNativeTranscript()
            } catch {
                guard surface == provider, nativeSyncRequestID == requestID else { return }
                isLoadingNativeSessions = false
                nativeSessions = []
                selectedNativeSessionID = nil
                nativeMessages = []
                alertMessage = error.localizedDescription
                statusText = "Native session sync needs attention"
            }
        }
    }

    func refreshNativeSessions() {
        guard surface != .auto else { return }
        synchronizeNativeSessions(surface, preservingCurrent: true, resetSearch: false)
    }

    func refreshActiveLinkedNativeTranscript(_ provider: ProviderChoice) {
        guard shouldRefreshActiveLinkedNativeTranscript(
            surface: surface,
            provider: provider,
            runningProvider: pendingProvider,
            recordedID: linkedNativeSessionID(for: provider),
            selectedID: selectedNativeSessionID,
            selectionAvailable: selectedNativeSession != nil,
            isLoading: isLoadingNativeSessions
        ) else { return }
        loadSelectedNativeTranscript()
    }

    func refreshVisibleNativeTranscript(_ provider: ProviderChoice) {
        // A completion transition must supersede a possibly in-flight polling
        // read so the final backend message cannot be missed by a timing race.
        guard surface == provider, selectedNativeSession != nil else { return }
        loadSelectedNativeTranscript()
    }

    /// The first-party `codex://threads/<id>` deep link makes Codex Desktop
    /// read the thread through its own app-server and open it, which is the
    /// only way a running Desktop lists a thread OS-1 persisted separately.
    /// If Desktop keeps the writer lock, the next OS-1 turn automatically
    /// forks the complete history and continues in a new visible thread.
    func openInCodexDesktop() {
        openLinkedNativeSession(.codex)
    }

    /// Claude Code transcripts remain synchronized in OS-1 without opening
    /// Claude Desktop. This explicit action imports and opens the linked CLI
    /// session only when the user asks to inspect the native backend.
    func openInClaudeDesktop() {
        openLinkedNativeSession(.claude)
    }

    private func openLinkedNativeSession(_ provider: ProviderChoice) {
        guard !isRunning else {
            alertMessage = "The current OS-1 task is still writing this backend record. You can inspect it here now and open the native app after the run finishes."
            return
        }
        guard let id = linkedNativeSessionID(for: provider),
              let url = nativeSessionURL(provider: provider, sessionID: id) else {
            alertMessage = "This OS-1 conversation has no recorded \(provider.title) session. No unrelated session was opened."
            return
        }
        guard nativeSessionOpener(url) else {
            alertMessage = "The recorded \(provider.title) session could not be opened in its native app. Its OS-1 history was not changed."
            return
        }
        statusText = "Opened the recorded \(provider.title) session in its native app"
    }

    func selectNativeSession(_ id: String) {
        guard nativeSessions.contains(where: { $0.id == id }) else { return }
        // Inspecting a known backend updates the shared selection, not routing.
        // An unrelated native record never borrows another conversation's draft.
        let owners = nativeOwnerIndices(surface, id: id)
        if owners.count == 1, let index = owners.first {
            select(sessions[index].id)
        }
        selectedNativeSessionID = id
        statusText = id == linkedNativeSessionID(for: surface)
            ? "Current \(surface.title) session · read-only synchronized"
            : "Browsing an unlinked local \(surface.title) session"
        loadSelectedNativeTranscript()
    }

    private func loadSelectedNativeTranscript() {
        guard let session = selectedNativeSession else {
            nativeMessages = []
            return
        }
        let expectedID = session.id
        let expectedProvider = session.provider
        let requestID = UUID()
        nativeTranscriptRequestID = requestID
        isLoadingNativeSessions = true
        Task {
            do {
                let messages = try await Task.detached(priority: .userInitiated) {
                    try NativeSessionReader.transcript(for: session)
                }.value
                guard surface == expectedProvider, selectedNativeSessionID == expectedID,
                      nativeTranscriptRequestID == requestID else { return }
                nativeMessages = messages
                isLoadingNativeSessions = false
            } catch {
                guard surface == expectedProvider, selectedNativeSessionID == expectedID,
                      nativeTranscriptRequestID == requestID else { return }
                nativeMessages = []
                isLoadingNativeSessions = false
                alertMessage = error.localizedDescription
            }
        }
    }

    func setCapacity(_ provider: ProviderChoice, value: Int) {
        guard let index = selectedIndex, [0, 10, 25, 50, 75, 100].contains(value) else { return }
        if provider == .codex { sessions[index].codexCapacity = value }
        if provider == .claude { sessions[index].claudeCapacity = value }
        if sessions[index].effectiveCodexCapacity + sessions[index].effectiveClaudeCapacity == 0 {
            if provider == .codex { sessions[index].claudeCapacity = 10 }
            if provider == .claude { sessions[index].codexCapacity = 10 }
        }
        sessions[index].provider = .auto
        sessions[index].updatedAt = Date()
        statusText = "RCC capacity mix updated"
        save()
    }

    func chooseWorkspace() {
        guard !isRunning, let index = selectedIndex else { return }
        let panel = NSOpenPanel()
        panel.title = "Choose the project folder OS-1 may work in"
        panel.prompt = "Use this folder"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.directoryURL = URL(fileURLWithPath: sessions[index].workspace, isDirectory: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let nextWorkspace = url.standardizedFileURL.path
        if sessions[index].workspace != nextWorkspace,
           sessions[index].codexSessionID != nil || sessions[index].claudeSessionID != nil {
            sessions[index].codexSessionID = nil
            sessions[index].claudeSessionID = nil
            sessions[index].lastProvider = nil
            sessions[index].messages.append(ChatMessage(
                role: .system,
                text: "Workspace changed. Native Codex and Claude links were reset so sessions cannot resume in the wrong project."
            ))
        }
        sessions[index].workspace = nextWorkspace
        sessions[index].updatedAt = Date()
        statusText = "Workspace connected"
        save()
    }

    func importArchiveMirror() {
        let panel = NSOpenPanel()
        panel.title = "검증된 R2 복구본 폴더 연결"
        panel.message = "verification-report.json과 repos 폴더가 있는 복구본을 선택하세요. 원본은 유지하고 앱 전용 캐시에 복사합니다."
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let source = panel.url else { return }
        statusText = "자료 인덱스 연결 중"
        Task {
            do {
                try await Task.detached {
                    let fm = FileManager.default
                    let scoped = source.startAccessingSecurityScopedResource()
                    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
                    let reportURL = source.appendingPathComponent("verification-report.json")
                    let report = try Data(contentsOf: reportURL)
                    guard report.count < 4_000_000,
                          let value = try JSONSerialization.jsonObject(with: report) as? [String: Any],
                          value["bucket"] as? String == "omar-private-archive",
                          ["all_git_bundles_verified", "all_objects_present", "all_sha256_recorded", "all_sizes_match"]
                            .allSatisfy({ value[$0] as? Bool == true }) else { throw RunnerError.message("검증 보고서가 유효하지 않습니다.") }
                    let root = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/r2-mirrors")
                    try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                    let destination = root.appendingPathComponent(source.lastPathComponent)
                    guard !fm.fileExists(atPath: destination.path) else { throw RunnerError.message("이미 연결된 복구본입니다. 기존 캐시를 덮어쓰지 않았습니다.") }
                    let stage = root.appendingPathComponent(".import-" + UUID().uuidString)
                    try fm.createDirectory(at: stage, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                    defer { try? fm.removeItem(at: stage) }
                    try fm.copyItem(at: source.appendingPathComponent("repos"), to: stage.appendingPathComponent("repos"))
                    try report.write(to: stage.appendingPathComponent("verification-report.json"), options: .atomic)
                    try fm.moveItem(at: stage, to: destination)
                    // Retrieval still verifies current remote manifest, object
                    // hash/size and actual repository commit before every use.
                }.value
                alertMessage = "자료 인덱스를 연결했습니다. 원본·인증 정보·운영 상태는 변경하지 않았습니다."
            } catch { alertMessage = error.localizedDescription }
        }
    }

    func useSuggestion(_ value: String) {
        composer = value
    }

    func toggleVoiceDictation() {
        voiceDictation.toggle(
            initialText: composer,
            readComposer: { [weak self] in self?.composer ?? "" },
            onTranscript: { [weak self] value in
                self?.composer = value
            },
            onFailure: { [weak self] message in
                self?.alertMessage = message
            }
        )
    }

    func finishVoiceDictation() {
        voiceDictation.finish()
    }

    @discardableResult
    func cancelVoiceDictation() -> Bool {
        guard voiceDictation.isActive else { return false }
        voiceDictation.cancel()
        return true
    }

    func stopVoiceDictation() {
        voiceDictation.stop()
    }

    func send() {
        // Match the disabled primary button while permission/transcription is
        // pending. Recording's existing finish callback invokes send once idle.
        guard ![VoiceDictationPhase.authorizing, .finalizing, .transcribing].contains(voiceDictation.phase) else { return }
        if voiceDictation.isActive {
            voiceDictation.finish { [weak self] in self?.send() }
            return
        }
        let request = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !request.isEmpty, let index = selectedIndex else { return }
        if !ExecutionSteering.isTaskReplacement(request), ExecutionSteering.isDirectCorrection(request), canSteerSelectedRun {
            sendCorrectionToCurrentRun()
            return
        }
        if !isRunning, ["자료 연결 해제", "detach source"].contains(request.precomposedStringWithCanonicalMapping.lowercased()) {
            sessions[index].sourceContext = nil
            sessions[index].sourceContextVersion = 2
            sessions[index].taskContext?.sources.removeAll()
            sessions[index].taskContext?.touch()
            sessions[index].messages.append(ChatMessage(role: .user, text: request))
            sessions[index].messages.append(ChatMessage(role: .system, text: "이 대화의 자료 연결을 해제했습니다."))
            sessions[index].updatedAt = Date()
            composer = ""
            statusText = "Source detached"
            save()
            return
        }
        var isDirectory: ObjCBool = false
        let workspace = sessions[index].workspace
        guard fileManager.fileExists(atPath: workspace, isDirectory: &isDirectory), isDirectory.boolValue else {
            alertMessage = "Choose an existing project folder before sending the task."
            return
        }

        let configuredProvider = sessions[index].provider
        let provider = configuredProvider == .auto
            ? (explicitlyRequestedProvider(in: request) ?? .auto)
            : configuredProvider
        if sessions[index].messages.isEmpty {
            sessions[index].title = title(for: request)
        }
        let userMessage = ChatMessage(role: .user, text: request)
        sessions[index].updatedAt = Date()
        composer = ""

        var submission = PendingSubmission(
            sessionID: sessions[index].id,
            userMessageID: userMessage.id,
            request: request,
            provider: provider,
            workspace: workspace,
            codexCapacity: sessions[index].effectiveCodexCapacity,
            claudeCapacity: sessions[index].effectiveClaudeCapacity
        )
        submission.configuredProvider = configuredProvider
        if ExecutionSteering.isTaskReplacement(request) {
            queuedSubmissions.append(submission)
            advanceQueued(submission.id)
            return
        }
        if ExecutionSteering.isDirectCorrection(request), let active = inFlightSubmissions[submission.sessionID] {
            // If the native turn is not accepting input yet/already finishing,
            // keep this as an amendment of that task, not a standalone query.
            submission.amendedRequest = active.executionRequest
        } else if ExecutionSteering.isDirectCorrection(request),
                  let objective = sessions[index].taskContext?.objective.requestText, !objective.isEmpty {
            submission.amendedRequest = objective
        }
        if isSessionRunning(submission.sessionID) || activeRuns.count >= Self.maximumConcurrentSessions ||
            sessions[index].lastFailure != nil || sessions[index].lastBackendFailure != nil ||
            sessions[index].queuePaused == true ||
            queuedSubmissions.contains(where: { $0.sessionID == submission.sessionID }) {
            queuedSubmissions.append(submission)
            statusText = submission.amendedRequest == nil
                ? "대기열에 추가됨 · 이 대화 \(selectedSessionQueueCount)개 대기"
                : "정정 보존됨 · 현재 턴이 입력을 받으면 전달하며, 불가능하면 같은 목표의 후속 작업으로 이어갑니다"
            save()
            runNextQueuedSubmissionIfNeeded()
            return
        }
        sessions[index].messages.append(userMessage)
        start(submission)
    }

    var primaryAction: ComposerPrimaryAction {
        let normal = ComposerPrimaryAction.resolve(draft: composer, running: isRunning, stopping: isStopping, voice: voiceDictation.phase)
        return normal == .queue && canSteerSelectedRun &&
            !ExecutionSteering.isTaskReplacement(composer) && ExecutionSteering.isDirectCorrection(composer) ? .steer : normal
    }

    private var steeringMailbox: ExecutionSteering {
        ExecutionSteering(root: customStorageRoot?.appendingPathComponent("run-steering"))
    }
    var canSteerSelectedRun: Bool {
        selectedSessionID.map(canSteer) ?? false
    }
    private func canSteer(_ id: UUID) -> Bool {
        guard let active = activeRuns[id], !active.cancellationRequested,
              inFlightSubmissions[id]?.readOnlyReconciliation != true,
              active.provider == .codex, steeringMailbox.active(active.submissionID) != nil,
              active.activity.phase == .executing,
              let context = sessions.first(where: { $0.id == id })?.taskContext else { return false }
        if let revision = active.correctionRevision { return revision == context.latestSemanticRevision }
        return active.handedRevision.map { context.acceptsLateResult(fromRevision: $0) } ?? false
    }
    func sendCorrectionToCurrentRun() {
        let text = composer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let session = selectedSession else { return }
        if !ExecutionSteering.isTaskReplacement(text), deliverCorrection(text, conversationID: session.id) {
            composer = ""; save(); return
        }
        var item = PendingSubmission(sessionID: session.id, userMessageID: UUID(), request: text,
            provider: session.provider == .auto ? (explicitlyRequestedProvider(in: text) ?? .auto) : session.provider,
            workspace: session.workspace, codexCapacity: session.effectiveCodexCapacity, claudeCapacity: session.effectiveClaudeCapacity)
        item.configuredProvider = session.provider
        if !ExecutionSteering.isTaskReplacement(text), let active = inFlightSubmissions[session.id], active.recoveryParentID == nil {
            item.amendedRequest = active.executionRequest
        }
        queuedSubmissions.append(item); composer = ""; save()
        advanceQueued(item.id)
    }
    func canSteerQueued(_ item: PendingSubmission) -> Bool {
        !ExecutionSteering.isTaskReplacement(item.request) && canSteer(item.sessionID) && !editingQueueIDs.contains(item.id) &&
            queuedSubmissions.contains(where: { $0.id == item.id }) &&
            (item.provider == .auto || item.provider == .codex)
    }
    func steerQueued(_ id: UUID) {
        guard let item = queuedSubmissions.first(where: { $0.id == id }), canSteerQueued(item) else { return }
        _ = deliverCorrection(item.request, conversationID: item.sessionID, inputID: item.userMessageID)
    }
    func canAdvanceQueued(_ item: PendingSubmission) -> Bool {
        guard !editingQueueIDs.contains(item.id),
              queuedSubmissions.contains(where: { $0.id == item.id }),
              let session = sessions.first(where: { $0.id == item.sessionID }) else { return false }
        if activeRuns[item.sessionID]?.cancellationRequested == true { return false }
        var candidate = item
        candidate.replacesSubmissionID = session.lastFailure?.id ?? activeRuns[item.sessionID]?.submissionID
        return mayAdvancePastFailure(candidate, session: session)
    }

    func queueActionLabel(_ item: PendingSubmission) -> String {
        if canSteerQueued(item) { return "현재 작업에 반영" }
        if activeRuns[item.sessionID]?.cancellationRequested == true { return "현재 실행 종료 확인 중" }
        if !canAdvanceQueued(item) { return "이전 변경 상태 확인 필요" }
        return isSessionRunning(item.sessionID) ? "현재 작업을 중지하고 이 요청부터 시작" : "이 요청부터 시작"
    }

    /// Explicit queue action; native steering where possible, otherwise a
    /// durable next-run intent. Cancellation is acknowledged by run termination,
    /// not by writing its marker. The existing admission remains held until then.
    func advanceQueued(_ id: UUID) {
        guard let item = queuedSubmissions.first(where: { $0.id == id }) else { return }
        if canSteerQueued(item) { steerQueued(id); return }
        guard canAdvanceQueued(item), let index = queuedSubmissions.firstIndex(where: { $0.id == id }),
              let sessionIndex = sessions.firstIndex(where: { $0.id == item.sessionID }) else {
            sessionStatuses[item.sessionID] = "이전 변경 확인 필요 · 새 요청은 대기열에 보존했습니다"
            save(); return
        }
        queuedSubmissions[index].startNextRequested = true
        queuedSubmissions[index].replacesSubmissionID = sessions[sessionIndex].lastFailure?.id ?? activeRuns[item.sessionID]?.submissionID
        queuedSubmissions[index].replacesObjective = ExecutionSteering.isTaskReplacement(item.request)
        if queuedSubmissions[index].replacesObjective == true {
            // Pending follow-ups belonged to the abandoned objective. Preserve
            // them for explicit review instead of running them under new context.
            pausedQueueIDs.formUnion(queuedSubmissions.filter { $0.sessionID == item.sessionID && $0.id != id }.map(\.id))
        }
        // An explicit action releases this item's hold, not another task's.
        pausedQueueIDs.remove(id)
        sessions[sessionIndex].queuePaused = false
        let next = queuedSubmissions.remove(at: index)
        let first = queuedSubmissions.firstIndex(where: { $0.sessionID == item.sessionID }) ?? queuedSubmissions.endIndex
        queuedSubmissions.insert(next, at: first)
        save()
        if activeRuns[item.sessionID] != nil { cancelRun(item.sessionID) }
        runNextQueuedSubmissionIfNeeded()
    }
    @discardableResult
    private func deliverCorrection(_ text: String, conversationID: UUID, inputID: UUID = UUID()) -> Bool {
        guard !text.isEmpty, canSteer(conversationID), let index = sessions.firstIndex(where: { $0.id == conversationID }),
              let active = activeRuns[conversationID] else { return false }
        let input = SteeringInput(id: inputID, submissionID: active.submissionID, text: text)
        do {
            try steeringMailbox.enqueue(input)
            let id = sessions[index].id
            if var pending = inFlightSubmissions[id] {
                pending.correctionIDs = (pending.correctionIDs ?? []) + [input.id]
                pending.liveCorrections = (pending.liveCorrections ?? []) + [text]
                inFlightSubmissions[id] = pending
            }
            sessions[index].messages.append(ChatMessage(id: input.id, role: .user, text: text))
            sessions[index].taskContext?.decideSemantic("User correction to current task: " + text)
            activeRuns[id]?.correctionRevision = sessions[index].taskContext?.latestSemanticRevision
            sessions[index].updatedAt = Date()
            // Commit queue removal and its replacement user message together.
            queuedSubmissions.removeAll { $0.sessionID == id && $0.userMessageID == input.id }
            sessionStatuses[id] = "정정 전달 확인 중 · 현재 작업에 연결했습니다"
            if selectedSessionID == id { statusText = sessionStatuses[id]! }
            appendTaskEvent(conversationID: id, kind: "correction_requested", summary: input.id.uuidString + " " + text)
            save()
            return true
        } catch { alertMessage = error.localizedDescription; return false }
    }
    private func promoteQueuedCorrections(_ id: UUID) {
        guard canSteer(id) else { return }
        for correction in queuedSubmissions.filter({ $0.sessionID == id && $0.amendedRequest != nil }) {
            guard !editingQueueIDs.contains(correction.id), !pausedQueueIDs.contains(correction.id),
                  sessions.first(where: { $0.id == id })?.queuePaused != true else { continue }
            _ = deliverCorrection(correction.request, conversationID: id, inputID: correction.userMessageID)
        }
    }

    var correctionDeliveryLabel: String? {
        guard let id = selectedSessionID, let active = activeRuns[id],
              let ids = inFlightSubmissions[id]?.correctionIDs, !ids.isEmpty else { return nil }
        let inputs = steeringMailbox.inputs(active.submissionID).filter { ids.contains($0.id) }
        let states = inputs.map { steeringMailbox.receipt($0)?.state }
        if states.contains(where: { $0 == .rejected }) { return "정정 전달 거절됨 · 원문 보존 · 완료로 처리하지 않습니다" }
        if states.count == ids.count && states.allSatisfy({ $0 == .accepted || $0 == .persisted }) {
            return "현재 작업에 정정 전달됨 · 이미 실행된 변경은 되돌리지 않습니다"
        }
        return "정정 전달 확인 중 · 현재 작업에 연결했습니다"
    }

    func performPrimaryAction(now: Date = Date()) {
        guard let id = selectedSessionID else { return }
        switch primaryAction {
        case .send, .queue, .steer:
            primarySubmissionTimes[id] = now
            // Dictation completion must call send(), never re-evaluate Stop.
            send()
        case .stop:
            // Send immediately becomes Stop. The second half of a double click
            // still belongs to Send, not to cancellation of the newly started run.
            if let submitted = primarySubmissionTimes[id],
               now.timeIntervalSince(submitted) < NSEvent.doubleClickInterval + 0.1 { return }
            cancelSelectedRun()
        case .disabledSend, .stopping, .finalizing: break
        }
    }

    private func start(_ submission: PendingSubmission) {
        guard !isSessionRunning(submission.sessionID), activeRuns.count < Self.maximumConcurrentSessions,
              let index = sessions.firstIndex(where: { $0.id == submission.sessionID }) else {
            return
        }
        if submission.startNextRequested == true {
            guard mayAdvancePastFailure(submission, session: sessions[index]) else { return }
            sessions[index].preservedTasks = (sessions[index].preservedTasks ?? []) + [PreservedTask(
                request: sessions[index].lastFailure, failure: sessions[index].lastBackendFailure,
                context: sessions[index].taskContext, source: sessions[index].sourceContext, timestamp: Date())]
            sessions[index].lastFailure = nil; sessions[index].lastBackendFailure = nil
            sessions[index].taskContext?.sourcePreparation = nil
            if submission.replacesObjective == true {
                sessions[index].sourceContext = nil; sessions[index].sourceContextVersion = 2
                sessions[index].codexSessionID = nil; sessions[index].claudeSessionID = nil
                sessions[index].taskContext = TaskContext.migrated(conversationID: submission.sessionID,
                    request: submission.request, workspace: submission.workspace,
                    sourceContext: nil, codexSessionID: nil, claudeSessionID: nil)
            }
            sessions[index].taskContext?.decideSemantic("The user selected a new request. Previous unfinished work is preserved, not completed. Do not replay previous actions; inspect actual state before any further mutation.")
            appendTaskEvent(conversationID: submission.sessionID, kind: "task_replaced", summary: submission.request)
            save()
        }
        // Only an admitted attempt owns this exact cancellation marker.
        try? FileManager.default.removeItem(at: ExecutionCancellation.url(submissionID: submission.id))
        let existingUserMessage = sessions[index].messages.contains { $0.id == submission.userMessageID }
        let checkpoint = sessions[index].lastFailure == nil ? ConversationForkCheckpoint(
                throughMessageID: sessions[index].messages.prefix(while: { $0.id != submission.userMessageID }).last?.id,
                source: sessions[index].sourceContext, context: sessions[index].taskContext)
            : sessions[index].completedForkCheckpoint
        if let checkpoint { sessions[index].completedForkCheckpoint = checkpoint }
        // The task context changes only when a run actually begins, so a
        // queued turn never invalidates the in-flight one.
        var taskContext = migratedTaskContext(sessions[index], sourceContext: sessions[index].sourceContext)
        if submission.recoveryParentID == nil && !(submission.sourceRetryIdentity != nil && existingUserMessage &&
            taskContext.objective.requestText == submission.request) {
        for decision in TaskContext.explicitDecisions(in: submission.executionRequest) { taskContext.decideSemantic(decision) }
        let resolution = ScopeResolution.resolve(submission.executionRequest)
        taskContext.setObjective(TaskContext.Objective(requestText: submission.executionRequest,
            kind: TaskContext.ObjectiveKind.classify(submission.executionRequest),
            scope: submission.amendedRequest != nil ? taskContext.objective.scope :
                (submission.readOnlyReconciliation == true || PreparationIntent.detect(submission.executionRequest)?.modifies == false ? .readOnly : resolution.scope),
            prohibitions: Array(Set(resolution.prohibitions + (submission.amendedRequest != nil ? taskContext.objective.prohibitions : []))).sorted()))
        sessions[index].taskContext = taskContext
        appendTaskEvent(conversationID: sessions[index].id, kind: "objective", summary: submission.request)
        }
        do {
            _ = try sessionHandoff(sessions[index], before: existingUserMessage && submission.recoveryParentID == nil ? submission.userMessageID : nil)
        } catch {
            if !existingUserMessage && submission.recoveryParentID == nil {
                sessions[index].messages.append(ChatMessage(id: submission.userMessageID, role: .user, text: submission.request))
            }
            if submission.recoveryParentID == nil { sessions[index].lastFailure = submission }
            sessions[index].messages.append(ChatMessage(role: .system, text: error.localizedDescription))
            sessionStatuses[submission.sessionID] = "Needs attention"
            if selectedSessionID == submission.sessionID { statusText = "Needs attention" }
            save()
            return
        }
        if !existingUserMessage && submission.recoveryParentID == nil {
            sessions[index].messages.append(ChatMessage(
                id: submission.userMessageID,
                role: .user,
                text: submission.request
            ))
            sessions[index].updatedAt = Date()
        }
        let codexSessionID = sessions[index].codexSessionID
        let claudeSessionID = sessions[index].claudeSessionID
        if submission.recoveryParentID == nil {
            sessions[index].lastFailure = nil
            sessions[index].lastBackendFailure = nil
        }
        inFlightSubmissions[submission.sessionID] = submission
        activeRuns[submission.sessionID] = ActiveRun(submissionID: submission.id, started: Date(),
            activity: RuntimeActivity(.preparing), provider: submission.provider == .auto ? nil : submission.provider,
            handedRevision: sessions[index].taskContext?.contextRevision, forkCheckpoint: checkpoint)
        let startingStatus = submission.recoveryParentID != nil ? "OS1이 중단된 작업 상태 확인 중" : "OS1 작업 준비 중"
        sessionStatuses[submission.sessionID] = startingStatus
        if selectedSessionID == submission.sessionID { statusText = startingStatus }
        save()

        Task { @MainActor [weak self] in
            while let self, self.activeRuns[submission.sessionID]?.submissionID == submission.id {
                let ready = self.canSteer(submission.sessionID)
                if self.activeRuns[submission.sessionID]?.steeringReady != ready {
                    self.activeRuns[submission.sessionID]?.steeringReady = ready
                }
                if self.queuedSubmissions.contains(where: { $0.sessionID == submission.sessionID && $0.amendedRequest != nil }) {
                    self.promoteQueuedCorrections(submission.sessionID)
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
        }

        Task {
            do {
                // Selection-triggered ingestion may still be reading when the
                // user presses Enter. Await the bound native history before
                // forming this attempt's handoff; never dispatch stale context.
                guard let currentIndex = sessions.firstIndex(where: { $0.id == submission.sessionID }) else { return }
                let bindings = sessions[currentIndex].taskContext?.bindings ?? []
                let held = Set(sessions[currentIndex].visibleMessages.filter { $0.role == .user || $0.role == .assistant }.map { NativeIngestion.digestOf($0.text) })
                let seen = Set(sessions[currentIndex].messages.compactMap(\.nativeIngestedID))
                let owned = Set(sessions[currentIndex].ownedCodexTurnIDs ?? [])
                if customStorageRoot == nil, !bindings.isEmpty {
                    let records = await Task.detached(priority: .utility) {
                        Self.readBoundNativeRecords(bindings, held: held, seen: seen, ownedCodexTurns: owned)
                    }.value
                    guard activeRuns[submission.sessionID]?.submissionID == submission.id else { return }
                    applyIngestedRecords(records, conversationID: submission.sessionID, preparingSubmission: submission.id)
                }
                guard let refreshed = sessions.firstIndex(where: { $0.id == submission.sessionID }) else { return }
                let refreshedContext = try sessionHandoff(sessions[refreshed], before: submission.recoveryParentID == nil ? submission.userMessageID : nil)
                activeRuns[submission.sessionID]?.handedRevision = sessions[refreshed].taskContext?.contextRevision
                let summary = try await runOperation(submission, refreshedContext, codexSessionID, claudeSessionID,
                    { [weak self] activity in
                        Task { @MainActor in
                            guard let self, self.activeRuns[submission.sessionID]?.submissionID == submission.id else { return }
                            self.activeRuns[submission.sessionID]?.activity = activity
                            self.activeRuns[submission.sessionID]?.provider = activity.provider.flatMap(ProviderChoice.init(rawValue:))
                            self.promoteQueuedCorrections(submission.sessionID)
                            if let nativeID = activity.nativeSessionID,
                               let provider = activity.provider.flatMap(ProviderChoice.init(rawValue:)) {
                                self.recordNativeSession(provider, id: nativeID, conversationID: submission.sessionID)
                            }
                            if [.executing, .verifying, .syncing, .recovering].contains(activity.phase),
                               self.inFlightSubmissions[submission.sessionID]?.preflightOnly == true {
                                self.inFlightSubmissions[submission.sessionID]?.preflightOnly = false
                                self.save()
                            }
                            if self.selectedSessionID == submission.sessionID {
                                self.statusText = self.isStopping ? "작업 중지 확인 중 · 입력과 대기열은 보존됩니다" : activity.label
                            }
                        }
                    }
                )
                guard let target = sessions.firstIndex(where: { $0.id == submission.sessionID }) else {
                    throw RunnerError.message("The queued OS-1 session no longer exists.")
                }
                let handedRevision = activeRuns[submission.sessionID]?.handedRevision
                let currentSubmission = activeRuns[submission.sessionID]?.submissionID == submission.id
                let corrections = inFlightSubmissions[submission.sessionID]?.correctionIDs ?? []
                let correctionsVerified = !corrections.isEmpty && Set(corrections) == Set(summary.persistedCorrectionIDs ?? []) &&
                    activeRuns[submission.sessionID]?.correctionRevision == sessions[target].taskContext?.latestSemanticRevision
                let semanticallyCurrent = corrections.isEmpty
                    ? (handedRevision.map { sessions[target].taskContext?.acceptsLateResult(fromRevision: $0) ?? true } ?? true)
                    : correctionsVerified
                if !currentSubmission || !semanticallyCurrent {
                    // A result arriving after a newer request or decision is
                    // preserved verbatim and never adopted as the current answer.
                    for step in visibleAdoptedSteps(summary.steps) {
                        let visibleOutput = step.output.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !visibleOutput.isEmpty else { continue }
                        sessions[target].messages.append(ChatMessage(role: .assistant, text: visibleOutput, provider: step.provider,
                            permissionProfile: step.permissionProfile, nativeRecordVerified: false))
                        sessions[target].messages.append(ChatMessage(role: .receipt,
                            text: "늦게 도착한 결과 · 이후 요청 또는 결정이 먼저 반영되어 채택하지 않음 · 기록은 보존됨",
                            provider: step.provider, permissionProfile: step.permissionProfile, nativeRecordVerified: false))
                    }
                    sessions[target].updatedAt = Date()
                    appendTaskEvent(conversationID: submission.sessionID, kind: "late_result_preserved",
                        summary: "submission \(submission.id.uuidString.lowercased()) handed revision \(handedRevision ?? -1)")
                    if currentSubmission { sessionStatuses[submission.sessionID] = "늦은 결과 보존 · 채택 안 함" }
                    if !corrections.isEmpty {
                        sessions[target].lastFailure = inFlightSubmissions[submission.sessionID]
                        sessions[target].messages.append(ChatMessage(role: .system,
                            text: "정정이 현재 작업에 전달됐는지 확인하지 못했습니다. 기존 결과와 정정을 보존했고 변경을 재실행하지 않았습니다."))
                    }
                } else {
                if summary.status == "source_pending", let result = summary.taskContext,
                   result.conversationID == submission.sessionID, result.sourcePreparation?.canLookForRegistration == true,
                   summary.steps.allSatisfy({ $0.provider == "local" && $0.action == "source_preparation_pending" }) {
                    sessions[target].taskContext = sessions[target].taskContext?.adopting(result, handedRevision: handedRevision) ?? result
                    appendTaskEvent(conversationID: submission.sessionID, kind: "source_pending",
                        summary: "Original objective retained; " + result.sourcePreparation!.releaseID + " source not acquired; no model dispatched")
                    throw RunnerError.message(summary.steps.first?.output ?? "운영 원본 확보 대기 중 · 준비 미완료")
                }
                if summary.status != "complete" {
                    throw RunnerError.message("OS-1 did not return a completed governed run.")
                }
                let visibleSteps = visibleAdoptedSteps(summary.steps)
                guard !visibleSteps.isEmpty else {
                    throw RunnerError.message("OS-1 did not produce a verified result.")
                }
                guard submission.readOnlyReconciliation != true || visibleSteps.allSatisfy({ $0.permissionProfile == "read_only" }) else {
                    throw RunnerError.message("상태 확인 요청에 변경 권한이 사용되어 결과를 채택하지 않았습니다.")
                }
                if submission.provider != .auto,
                   visibleSteps.contains(where: {
                       $0.provider != submission.provider.rawValue &&
                           !($0.provider == "local" && [
                               "protected_material_guard", "r2_retrieval", "registered_source_retrieval", "connection_check", "source_status", "work_preparation",
                           ].contains($0.action))
                   }) {
                    throw RunnerError.message("OS-1 rejected a backend mismatch. The request targeted \(submission.provider.title), but a different backend answered.")
                }
                if visibleSteps.contains(where: { UUID(uuidString: $0.sessionID) == nil }) {
                    throw RunnerError.message("OS-1 rejected an invalid native backend session link.")
                }
                // A run that returns no snapshot (protected-material control,
                // delivery resume) must not drop the conversation's attachment;
                // only an explicit detach in the request clears it.
                if let source = summary.sourceContext {
                    sessions[target].sourceContext = source
                } else if detachesConversationSource(submission.request) {
                    sessions[target].sourceContext = nil
                    sessions[target].taskContext?.sources.removeAll()
                }
                sessions[target].sourceContextVersion = 2
                if let result = summary.taskContext {
                    sessions[target].taskContext = sessions[target].taskContext?.adopting(result,
                        handedRevision: submission.recoveryParentID == nil ? handedRevision : nil) ?? result
                    appendTaskEvent(conversationID: submission.sessionID, kind: "adopted",
                        summary: visibleSteps.map { "\($0.provider) \($0.action)" }.joined(separator: ", "))
                }
                for step in visibleSteps {
                    if step.provider == "codex", let record = step.nativeRecord, record.isVerified,
                       let turn = record.turnID, UUID(uuidString: turn) != nil {
                        sessions[target].ownedCodexTurnIDs = Array(Set((sessions[target].ownedCodexTurnIDs ?? []) + [turn])).sorted()
                    }
                    if let provider = ProviderChoice(rawValue: step.provider) {
                        recordNativeSession(provider, id: step.sessionID, conversationID: submission.sessionID)
                    }
                }
                for step in visibleSteps {
                    sessions[target].lastProvider = step.provider
                    if let deliveryID = submission.deliveryID, let previewID = UUID(uuidString:String(deliveryID.prefix(36))) {
                        sessions[target].messages.removeAll { $0.id == previewID }
                    }
                    let visibleOutput = step.output.trimmingCharacters(in: .whitespacesAndNewlines)
                    let visibleError = step.stderr.trimmingCharacters(in: .whitespacesAndNewlines)
                    sessions[target].messages.append(ChatMessage(
                        role: .assistant,
                        text: visibleOutput.isEmpty
                            ? (visibleError.isEmpty ? "The engine finished without text output." : visibleError)
                            : visibleOutput,
                        provider: step.provider,
                        permissionProfile: step.permissionProfile
                    ))
                    sessions[target].messages.append(ChatMessage(
                        role: .receipt,
                        text: "\(backendTierLabel(action: step.action, provider: step.provider)) · \(step.model ?? "provider default") · \(step.effort) reasoning · \(step.revasDisposition == "control_verified" ? "OS-1 control verified" : "REVAS adopted") · \(nativeRecordReceipt(step)) · step \(step.sequence) · \(step.durationMS / 1_000)s · exit \(step.exitCode)" +
                            (step.provider != "local" && summary.sourceContext != nil
                                ? " · source snapshot delivered: \(summary.sourceContext!.sha256)" : ""),
                        provider: step.provider,
                        permissionProfile: step.permissionProfile,
                        nativeRecordVerified: stepRecordIsVerified(step) &&
                            (step.revasDisposition == "adopted" || step.provider == "local")
                    ))
                }
                sessions[target].updatedAt = Date()
                if correctionsVerified {
                    sessions[target].messages.append(ChatMessage(role: .system,
                        text: "정정 \(corrections.count)건의 현재 턴 전달과 백엔드 기록을 확인했습니다."))
                }
                let allVerified = !visibleSteps.isEmpty && visibleSteps.allSatisfy(stepRecordIsVerified)
                sessionStatuses[submission.sessionID] = allVerified
                    ? "답변 수신 · 실행 기록 확인됨"
                    : "답변 수신 · 실행 기록 미확인"
                if submission.recoveryParentID != nil {
                    sessionStatuses[submission.sessionID] = "상태 확인됨 · 원래 작업은 아직 미완료"
                    appendTaskEvent(conversationID: submission.sessionID, kind: "reconciled",
                        summary: "Read-only findings preserved; original objective and uncertain-effect boundary remain pending")
                } else {
                    sessions[target].completedForkCheckpoint = ConversationForkCheckpoint(
                        throughMessageID: sessions[target].messages.last?.id,
                        source: sessions[target].sourceContext, context: sessions[target].taskContext)
                }
                }
            } catch {
                if let target = sessions.firstIndex(where: { $0.id == submission.sessionID }) {
                    if submission.recoveryParentID == nil { sessions[target].lastFailure = inFlightSubmissions[submission.sessionID] ?? submission }
                    if submission.recoveryParentID == nil, let failure = error as? RunnerError, case .backend(let notice) = failure {
                        sessions[target].lastBackendFailure = notice
                        if notice.deliveryID == nil, let progress = notice.publicProgress, !progress.isEmpty {
                            sessions[target].messages.append(ChatMessage(role: .assistant, text: progress,
                                provider: notice.provider, permissionProfile: notice.permissionProfile, nativeRecordVerified: false))
                            sessions[target].messages.append(ChatMessage(role: .receipt,
                                text: "중단 전 받은 내용 · 검증·완료 미확인 · OS1에 보존됨", provider: notice.provider,
                                permissionProfile: notice.permissionProfile, nativeRecordVerified: false))
                        }
                        if let deliveryID = notice.deliveryID,
                           let result = try? DeliveryOutbox().read(deliveryID), !result.output.isEmpty {
                            sessions[target].lastFailure?.deliveryID = deliveryID
                            let verdict = result.response.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["status"] as? String
                            let needsReview = result.localRejection != nil || (verdict != nil && verdict != "complete")
                            sessions[target].lastFailure?.savedResultNeedsReview = needsReview
                            let previewID = UUID(uuidString:String(deliveryID.prefix(36)))!
                            if !sessions[target].messages.contains(where: { $0.id == previewID }) {
                                sessions[target].messages.append(ChatMessage(id:previewID, role: .assistant, text: result.output,
                                    provider: notice.provider, permissionProfile: notice.permissionProfile, nativeRecordVerified: false))
                                sessions[target].messages.append(savedResultReceipt(result))
                            }
                        }
                        if let source = notice.source,
                           (try? (customStorageRoot.map { SourceContextStore(root: $0) } ?? SourceContextStore()).read(source)) != nil {
                            sessions[target].sourceContext = source
                            sessions[target].sourceContextVersion = 2
                        }
                        if let id = notice.sessionID, UUID(uuidString: id) != nil {
                            if let provider = ProviderChoice(rawValue: notice.provider) {
                                recordNativeSession(provider, id: id, conversationID: submission.sessionID)
                            }
                        }
                        // Dependent turns cannot silently execute past a denied
                        // action or a write with an unknown external outcome.
                        // The scheduler derives this pause from the failure.
                        // Successful recovery clears it; manual/restart holds
                        // remain independent and are never implicitly cleared.
                    }
                    let description = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
                    sessions[target].messages.append(ChatMessage(
                        role: .system,
                        text: description.isEmpty ? "OS-1 작업이 중단되었습니다. 다시 시도해 주세요." : description
                    ))
                    sessions[target].updatedAt = Date()
                }
                sessionStatuses[submission.sessionID] = "Needs attention"
            }
            // A superseded attempt must not release the newer run's admission.
            guard activeRuns[submission.sessionID]?.submissionID == submission.id else { save(); return }
            activeRuns.removeValue(forKey: submission.sessionID)
            inFlightSubmissions.removeValue(forKey: submission.sessionID)
            if selectedSessionID == submission.sessionID { statusText = sessionStatuses[submission.sessionID] ?? "Ready" }
            save()
            if let target = sessions.firstIndex(where: { $0.id == submission.sessionID }),
               !queuedSubmissions.contains(where: { $0.sessionID == submission.sessionID && $0.startNextRequested == true }),
               UnifiedExecution.automaticallyReconcile(sessions[target].lastBackendFailure,
                    alreadyAttempted: sessions[target].lastFailure?.recoveryAttempted == true,
                    internalReview: submission.recoveryParentID != nil,
                    providerPreference: submission.provider.rawValue,
                    cancellationRequested: FileManager.default.fileExists(atPath: ExecutionCancellation.url(submissionID: submission.id).path)) {
                beginReconciliation(conversationID: submission.sessionID)
            }
            ingestNativeRecords(conversationID: submission.sessionID)
            runNextQueuedSubmissionIfNeeded()
        }
    }

    // MARK: - Shared task context bookkeeping

    private var taskEventLog: TaskEventLog {
        TaskEventLog(root: (customStorageRoot ?? fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1", isDirectory: true))
            .appendingPathComponent("task-events", isDirectory: true))
    }

    private func appendTaskEvent(conversationID: UUID, kind: String, summary: String) {
        let revision = sessions.first(where: { $0.id == conversationID })?.taskContext?.contextRevision ?? 0
        try? taskEventLog.append(TaskEvent(revision: revision, at: Date(), kind: kind, summary: String(summary.prefix(300))),
                                 conversationID: conversationID)
    }

    /// Incremental read-back of the native sessions bound to a conversation.
    /// Work the user did directly in the Codex/Claude app becomes part of the
    /// OS-1 record, labeled as outside work; what OS-1 itself sent or adopted
    /// is skipped by digest, and each binding keeps its own cursor.
    func ingestNativeRecords(conversationID: UUID) {
        guard customStorageRoot == nil, !isSessionRunning(conversationID),
              let index = sessions.firstIndex(where: { $0.id == conversationID }),
              let context = sessions[index].taskContext, !context.bindings.isEmpty else { return }
        let bindings = context.bindings
        let held = Set(sessions[index].visibleMessages.filter { $0.role == .user || $0.role == .assistant }.map { NativeIngestion.digestOf($0.text) })
        let seen = Set(sessions[index].messages.compactMap(\.nativeIngestedID))
        let owned = Set(sessions[index].ownedCodexTurnIDs ?? [])
        Task.detached(priority: .utility) { [bindings, held, seen, owned] in
            let finished = Self.readBoundNativeRecords(bindings, held: held, seen: seen, ownedCodexTurns: owned)
            await MainActor.run { self.applyIngestedRecords(finished, conversationID: conversationID) }
        }
    }

    nonisolated fileprivate static func readBoundNativeRecords(_ bindings: [TaskContext.BackendBinding], held: Set<String>, seen: Set<String>, ownedCodexTurns: Set<String>) -> [NativeIngestionOutcome] {
            var outcome: [NativeIngestionOutcome] = []
            for binding in bindings {
                guard let provider = ProviderChoice(rawValue: binding.provider), provider != .auto,
                      let summary = (try? NativeSessionReader.sessions(for: provider, including: binding.nativeSessionID))?
                        .first(where: { $0.id.lowercased() == binding.nativeSessionID.lowercased() }),
                      let transcript = try? NativeSessionReader.transcript(for: summary, forIngestion: true) else { continue }
                let all = transcript.enumerated().compactMap { item -> NativeRecord? in
                    guard item.element.role == .user || item.element.role == .assistant else { return nil }
                    return NativeRecord(id: "\(binding.provider):\(item.element.id)", ordinal: item.element.ordinal ?? item.offset,
                                        role: item.element.role.rawValue, text: item.element.text, complete: item.element.complete,
                                        turnID: item.element.turnID)
                }
                // Store the complete native history locally; the provider
                // handoff has its own byte budget. Do not silently lose the
                // original objective on the first synchronization.
                let owned = binding.provider == "codex" ? ownedCodexTurns.union(
                    ManagedNativeTurns().recoverLegacy(threadID: binding.nativeSessionID)) : []
                let fresh = NativeIngestion.newRecords(all, after: binding.lastIngestedCursor, sentByOS1: held, seen: seen,
                    ownedTurnIDs: owned)
                outcome.append(NativeIngestionOutcome(binding: binding, records: fresh.records, cursor: fresh.nextCursor,
                    managedRecords: all.filter { $0.turnID.map(owned.contains) == true }))
            }
            return outcome
    }

    private func applyIngestedRecords(_ outcome: [NativeIngestionOutcome], conversationID: UUID, preparingSubmission: UUID? = nil) {
        guard let index = sessions.firstIndex(where: { $0.id == conversationID }),
              !isSessionRunning(conversationID) || (preparingSubmission != nil && activeRuns[conversationID]?.submissionID == preparingSubmission && activeRuns[conversationID]?.activity.phase == .preparing) else { return }
        let beforeID = preparingSubmission == nil ? nil : inFlightSubmissions[conversationID]?.userMessageID
        var insertionIndex = beforeID.flatMap { id in sessions[index].messages.firstIndex(where: { $0.id == id }) } ?? sessions[index].messages.count
        var changed = false
        var ingestedCount = 0
        for item in outcome {
            guard let bindingIndex = sessions[index].taskContext?.bindings.firstIndex(where: {
                $0.provider == item.binding.provider && $0.nativeSessionID == item.binding.nativeSessionID
            }) else { continue }
            if repairManagedImports(&sessions[index], records: item.managedRecords) { changed = true }
            let known = Set(sessions[index].messages.compactMap(\.nativeIngestedID))
            let previousCount = ingestedCount
            for record in item.records where !known.contains(record.id) {
                if item.binding.provider == "codex", let turn = record.turnID,
                   sessions[index].ownedCodexTurnIDs?.contains(turn) == true { continue }
                sessions[index].messages.insert(ChatMessage(role: record.role == "user" ? .user : .assistant, text: record.text,
                    provider: item.binding.provider, nativeRecordVerified: record.role == "user" ? nil : false,
                    nativeIngestedID: record.id), at: insertionIndex)
                insertionIndex += 1
                ingestedCount += 1
                changed = true
            }
            let addedCount = ingestedCount - previousCount
            if addedCount > 0 {
                sessions[index].messages.insert(ChatMessage(role: .receipt,
                    text: "\(providerDisplayName(item.binding.provider)) 앱에서 직접 진행한 기록 \(addedCount)건을 이 대화에 흡수했습니다 · OS-1 외부 작업, 채택 판정 아님",
                    provider: item.binding.provider), at: insertionIndex)
                insertionIndex += 1
            }
            if let cursor = item.cursor, sessions[index].taskContext?.bindings[bindingIndex].lastIngestedCursor != cursor {
                sessions[index].taskContext?.bindings[bindingIndex].lastIngestedCursor = cursor
                sessions[index].taskContext?.touch()
                changed = true
            }
        }
        guard changed else { return }
        sessions[index].updatedAt = Date()
        if ingestedCount > 0 {
            appendTaskEvent(conversationID: conversationID, kind: "native_ingested", summary: "\(ingestedCount) records")
        }
        save()
    }

    private func runNextQueuedSubmissionIfNeeded() {
        // A queued turn in A must not block ready work in B. Within A the
        // first queued turn is the only eligible one, and context is built now.
        while activeRuns.count < Self.maximumConcurrentSessions,
              let index = queuedSubmissions.firstIndex(where: { next in
                  queueEligible(next) &&
                  !queuedSubmissions.prefix(while: { $0.id != next.id }).contains(where: { $0.sessionID == next.sessionID })
              }) {
            let next = queuedSubmissions.remove(at: index)
            if sessions.contains(where: { $0.id == next.sessionID }) { start(next) }
        }
        save()
    }

    func togglePin(_ id: UUID) {
        guard let index = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions[index].pinnedAt = sessions[index].pinnedAt == nil ? Date() : nil
        sessions[index].sidebarPosition = sessions[index].pinnedAt == nil ? nil : -1
        normalizePinnedOrder()
        syncPinForConversation(id)
        save()
    }

    private func normalizePinnedOrder() {
        for (rank, row) in pinnedConversations.enumerated() {
            if let index = sessions.firstIndex(where: { $0.id == row.id }) { sessions[index].sidebarPosition = rank }
        }
    }

    func movePinned(_ id: UUID, before target: UUID?) {
        let order = pinnedConversations.map { $0.id.uuidString }
        let moved = SidebarOrder.moving(id.uuidString, before: target?.uuidString, in: order)
        guard order != moved else { return }
        for (rank, key) in moved.enumerated() {
            if let index = sessions.firstIndex(where: { $0.id.uuidString == key }) { sessions[index].sidebarPosition = rank }
        }
        syncPinForConversation(id)
        save()
    }

    func shiftPinned(_ id: UUID, down: Bool) {
        let order = pinnedConversations.map(\.id)
        guard let index = order.firstIndex(of: id) else { return }
        if down, index + 1 < order.count { movePinned(id, before: index + 2 < order.count ? order[index + 2] : nil) }
        if !down, index > 0 { movePinned(id, before: order[index - 1]) }
    }

    private func syncPinForConversation(_ id: UUID, excluding: ProviderChoice? = nil, only: ProviderChoice? = nil) {
        guard let row = sessions.first(where: { $0.id == id }) else { return }
        let order = pinnedConversations
        for provider in [ProviderChoice.codex, .claude] where provider != excluding && (only == nil || provider == only) {
            let nativeID = provider == .codex ? row.codexSessionID : row.claudeSessionID
            guard let nativeID else { continue }
            guard nativeOwnerIndices(provider, id: nativeID).count == 1 else {
                sidebarSyncNotice = "같은 백엔드 기록에 여러 OS1 대화가 연결되어 핀 변경을 보류했습니다."
                continue
            }
            let nextID: String? = order.firstIndex(where: { $0.id == id }).flatMap { index in
                order.dropFirst(index + 1).compactMap { provider == .codex ? $0.codexSessionID : $0.claudeSessionID }.first
            }
            queueNativePin(provider, id: nativeID, pinned: row.pinnedAt != nil,
                position: row.sidebarPosition, before: nextID)
        }
    }

    private func nativeOwnerIndices(_ provider: ProviderChoice, id: String) -> [Int] {
        sessions.indices.filter { (provider == .codex ? sessions[$0].codexSessionID : sessions[$0].claudeSessionID) == id }
    }

    // A backend can first become known after the user pinned an OS1 conversation.
    // Bind only the exact reported ID, and propagate only to the newly linked peer.
    func recordNativeSession(_ provider: ProviderChoice, id: String, conversationID: UUID) {
        guard [.codex, .claude].contains(provider), UUID(uuidString: id) != nil,
              let index = sessions.firstIndex(where: { $0.id == conversationID }) else { return }
        let oldID = provider == .codex ? sessions[index].codexSessionID : sessions[index].claudeSessionID
        guard oldID != id else { return }
        if provider == .codex { sessions[index].codexSessionID = id }
        else { sessions[index].claudeSessionID = id }
        if sessions[index].pinnedAt != nil { syncPinForConversation(conversationID, only: provider) }
        save()
    }

    func toggleNativePin(_ id: String) {
        guard let row = orderedNativeSessions.first(where: { $0.id == id }) else { return }
        let owners = nativeOwnerIndices(surface, id: id)
        guard owners.count <= 1 else {
            sidebarSyncNotice = "같은 백엔드 기록에 여러 OS1 대화가 연결되어 핀 변경을 보류했습니다."
            return
        }
        if let ownerIndex = owners.first {
            let owner = sessions[ownerIndex]
            if let index = sessions.firstIndex(where: { $0.id == owner.id }) {
                sessions[index].pinnedAt = row.isPinned ? (sessions[index].pinnedAt ?? Date()) : nil
            }
            togglePin(owner.id)
        } else {
            let first = orderedNativeSessions.first(where: { $0.isPinned && $0.id != id })?.id
            queueNativePin(surface, id: id, pinned: !row.isPinned, position: -1, before: first)
            save()
        }
    }

    func moveNativePin(_ id: String, before target: String?) {
        let order = orderedNativeSessions.filter(\.isPinned).map(\.id)
        let moved = SidebarOrder.moving(id, before: target, in: order)
        guard moved != order, let rank = moved.firstIndex(of: id) else { return }
        // Reordering is scoped to this provider's real IDs. Other pins survive.
        for (index, nativeID) in moved.enumerated() {
            let key = SidebarOrder.key(provider: surface.rawValue, id: nativeID)
            if var intent = sidebarIntents[key] { intent.position = index; sidebarIntents[key] = intent }
            if let i = nativeSessions.firstIndex(where: { $0.id == nativeID }) { nativeSessions[i].pinPosition = index }
        }
        queueNativePin(surface, id: id, pinned: true, position: rank, before: target)
        applyNativeOrderToConversations(provider: surface, nativeIDs: moved)
        let owners = nativeOwnerIndices(surface, id: id)
        if owners.count == 1, let index = owners.first {
            syncPinForConversation(sessions[index].id, excluding: surface)
        }
        save()
    }

    func shiftNativePin(_ id: String, down: Bool) {
        let order = orderedNativeSessions.filter(\.isPinned).map(\.id)
        guard let index = order.firstIndex(of: id) else { return }
        if down, index + 1 < order.count { moveNativePin(id, before: index + 2 < order.count ? order[index + 2] : nil) }
        if !down, index > 0 { moveNativePin(id, before: order[index - 1]) }
    }

    func retryNativePin(_ id: String) {
        guard surface == .codex, let row = orderedNativeSessions.first(where: { $0.id == id }) else { return }
        let pinnedIDs = orderedNativeSessions.filter(\.isPinned).map(\.id)
        let next = pinnedIDs.firstIndex(of: id).flatMap { $0 + 1 < pinnedIDs.count ? pinnedIDs[$0 + 1] : nil }
        queueNativePin(.codex, id: id, pinned: row.isPinned, position: row.pinPosition, before: next)
        save()
    }

    private func queueNativePin(_ provider: ProviderChoice, id: String, pinned: Bool, position: Int?, before: String?) {
        let key = SidebarOrder.key(provider: provider.rawValue, id: id)
        if nativePinnedOrders[provider.rawValue] == nil {
            let observed = customStorageRoot == nil ? (try? NativeSidebar.read(provider.rawValue)) : nil
            nativePinnedOrders[provider.rawValue] = observed?.filter { $0.value.pinned }
                .sorted { ($0.value.position ?? Int.max, $0.key) < ($1.value.position ?? Int.max, $1.key) }.map(\.key)
                ?? nativeSessions.filter { $0.provider == provider && $0.isPinned }.sorted(by: sidebarNativeLess).map(\.id)
        }
        var order = nativePinnedOrders[provider.rawValue] ?? []
        if pinned {
            if !order.contains(id) { order.append(id) }
            order = SidebarOrder.moving(id, before: before, in: order)
        } else { order.removeAll { $0 == id } }
        nativePinnedOrders[provider.rawValue] = order
        let intent = SidebarPinIntent(pinned: pinned, position: position, status: provider == .claude ? "local_only" : "pending")
        sidebarIntents[key] = intent
        if provider == .claude {
            sidebarSyncNotice = "OS1에 저장됨 · Claude 앱의 핀/순서 변경 연결은 아직 지원되지 않습니다."
            return
        }
        guard customStorageRoot == nil || nativePinOperation != nil else { return }
        let previous = sidebarMutationTask
        sidebarMutationTask = Task { [weak self] in
            await previous?.value
            guard let self else { return }
            // Preserve dependency order: pin B before A requires the preceding
            // pin-A operation even if a later move-A superseded A's UI intent.
            // Revision guards below suppress stale acknowledgements, not writes.
            do {
                if let operation = self.nativePinOperation { try await operation(id, pinned, before) }
                else { try await OS1Runner.pinNativeSession(id: id, pinned: pinned, before: before) }
                guard self.sidebarIntents[key]?.revision == intent.revision else { return }
                self.sidebarIntents.removeValue(forKey: key)
                if self.sidebarIntents.isEmpty { self.sidebarSyncNotice = nil }
                await self.refreshSidebarMetadata()
            } catch {
                guard self.sidebarIntents[key]?.revision == intent.revision else { return }
                self.sidebarIntents[key]?.status = "failed"
                self.sidebarSyncNotice = error.localizedDescription
            }
            self.save()
        }
    }

    func awaitSidebarMutations() async { await sidebarMutationTask?.value }

    private func applyNativeOrderToConversations(provider: ProviderChoice, nativeIDs: [String]) {
        let current = pinnedConversations.map { $0.id.uuidString }
        let linked = nativeIDs.compactMap { nativeID -> String? in
            let owners = nativeOwnerIndices(provider, id: nativeID)
            guard owners.count == 1, let index = owners.first, sessions[index].pinnedAt != nil else { return nil }
            return sessions[index].id.uuidString
        }
        let reordered = SidebarOrder.replacingSubset(linked, in: current)
        for (rank, id) in reordered.enumerated() {
            if let index = sessions.firstIndex(where: { $0.id.uuidString == id }) { sessions[index].sidebarPosition = rank }
        }
    }

    func refreshSidebarMetadata() async {
        guard customStorageRoot == nil, !sidebarPollRunning else { return }
        resumeRegisteredSourcePreparations()
        sidebarPollRunning = true
        defer { sidebarPollRunning = false }
        for provider in [ProviderChoice.codex, .claude] {
            do {
                let pins = try await Task.detached(priority: .utility) { try NativeSidebar.read(provider.rawValue) }.value
                applySidebarSnapshot(provider, pins: pins)
            } catch {
                if surface == provider { sidebarSyncNotice = error.localizedDescription }
            }
        }
    }

    func applySidebarSnapshot(_ provider: ProviderChoice, pins: [String: NativePinState]) {
        if !sidebarIntents.keys.contains(where: { $0.hasPrefix(provider.rawValue + ":") }) {
            if provider == .codex {
                nativePinnedOrders[provider.rawValue] = pins.filter { $0.value.pinned }
                    .sorted { ($0.value.position ?? Int.max, $0.key) < ($1.value.position ?? Int.max, $1.key) }.map(\.key)
            } else {
                // No authoritative manual order is persisted by Claude. Let
                // the catalog's recency sort apply, not a fabricated rank.
                nativePinnedOrders.removeValue(forKey: provider.rawValue)
            }
        }
        var changed = false
        var propagate: Set<UUID> = []
        for (id, pin) in pins {
            let key = SidebarOrder.key(provider: provider.rawValue, id: id)
            let old = observedNativePins.updateValue(pin, forKey: key)
            if surface == provider, let index = nativeSessions.firstIndex(where: { $0.id == id }) {
                nativeSessions[index].isPinned = pin.pinned; nativeSessions[index].pinPosition = pin.position
            }
            let owners = nativeOwnerIndices(provider, id: id)
            guard sidebarIntents[key] == nil, old != pin,
                  owners.count == 1, let index = owners.first else { continue }
            let other = provider == .codex ? sessions[index].claudeSessionID : sessions[index].codexSessionID
            let otherProvider = provider == .codex ? "claude" : "codex"
            // Do not let a stale unavailable peer undo an explicit local intent.
            if let other, let intent = sidebarIntents[SidebarOrder.key(provider: otherProvider, id: other)],
               intent.status != "local_only" { continue }
            if old != nil || pin.pinned {
                sessions[index].pinnedAt = pin.pinned ? (sessions[index].pinnedAt ?? Date()) : nil
                sessions[index].sidebarPosition = pin.position
                changed = true
                if old != nil { propagate.insert(sessions[index].id) }
            }
        }
        if changed {
            if provider == .codex {
                let ids = pins.filter { $0.value.pinned }
                    .sorted { ($0.value.position ?? Int.max, $0.key) < ($1.value.position ?? Int.max, $1.key) }.map(\.key)
                applyNativeOrderToConversations(provider: provider, nativeIDs: ids)
            }
            for id in propagate { syncPinForConversation(id, excluding: provider) }
            save()
        }
    }
    func setArchived(_ id: UUID, _ archived: Bool) {
        guard !isSessionRunning(id), !queuedSubmissions.contains(where: { $0.sessionID == id }),
              let index = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions[index].archived = archived; save()
        if selectedSessionID == id, let next = filteredSessions.first { select(next.id) }
    }
    func rename(_ id: UUID, title: String) {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, let index = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions[index].title = String(title.prefix(200)); save()
    }
    func promptRename(_ id: UUID) {
        guard let session = sessions.first(where: { $0.id == id }) else { return }
        let alert = NSAlert(); alert.messageText = "대화 이름 변경"
        alert.addButton(withTitle: "저장"); alert.addButton(withTitle: "취소")
        let field = NSTextField(string: session.title); field.frame = NSRect(x: 0, y: 0, width: 350, height: 28)
        alert.accessoryView = field; alert.window.initialFirstResponder = field
        if alert.runModal() == .alertFirstButtonReturn { rename(id, title: field.stringValue) }
    }
    func copyConversation(_ id: UUID) {
        guard let session = sessions.first(where: { $0.id == id }) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(completeTranscriptText(presentedMessages(session)), forType: .string)
    }
    func exportConversation(_ id: UUID) {
        guard let session = sessions.first(where: { $0.id == id }) else { return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "OS-1 conversation.md"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do { try completeTranscriptText(presentedMessages(session)).write(to: url, atomically: true, encoding: .utf8) }
        catch { alertMessage = error.localizedDescription }
    }
    func resumeQueue(_ sessionID: UUID? = nil) {
        guard let id = sessionID ?? selectedSessionID,
              let index = sessions.firstIndex(where: { $0.id == id }),
              sessions[index].lastFailure == nil, sessions[index].lastBackendFailure == nil,
              sessions[index].taskContext?.sourcePreparation == nil else { return }
        sessions[index].queuePaused = false
        pausedQueueIDs.subtract(queuedSubmissions.filter { $0.sessionID == id }.map(\.id))
        runNextQueuedSubmissionIfNeeded()
    }
    /// A new registered artifact is an external-state change, not a reason to
    /// rerun a failed model. One preflight-only preparation retry per identity;
    /// no automatic mutation, login, remote-source substitution or UI reveal.
    func resumeRegisteredSourcePreparations(root: URL = RegisteredProjectSource.defaultRoot) {
        for session in sessions {
            guard activeRuns.count < Self.maximumConcurrentSessions,
                  !isSessionRunning(session.id), session.lastBackendFailure == nil,
                  let pending = session.taskContext?.sourcePreparation, pending.canLookForRegistration,
                  let failed = session.lastFailure, failed.preflightOnly == true,
                  failed.sourceRetryIdentity != pending.manifestSHA256,
                  let intent = PreparationIntent.detect(failed.request), !intent.modifies,
                  intent.kind != .explainFromContext,
                  RegisteredProjectSource.mayUseForPreparation(failed.request),
                  !FileManager.default.fileExists(atPath: ExecutionCancellation.url(submissionID: failed.id).path),
                  FileManager.default.fileExists(atPath: root.appendingPathComponent(pending.manifestSHA256).appendingPathComponent("source.tar.gz").path),
                  let index = sessions.firstIndex(where: { $0.id == session.id }) else { continue }
            var retry = failed
            retry.sourceRetryIdentity = pending.manifestSHA256
            sessions[index].lastFailure = retry
            save() // persist the budget before dispatch; survives app restart
            appendTaskEvent(conversationID: session.id, kind: "source_recovery",
                summary: "Registered source arrived; revalidating the original preparation without a backend handoff")
            start(retry)
        }
    }
    func retrySelectedFailure() {
        guard !isRunning, let failed = selectedSession?.lastFailure,
              activeRuns.count < Self.maximumConcurrentSessions else { return }
        if failed.savedResultNeedsReview == true { reconcileSelectedFailure(); return }
        if failed.deliveryID != nil { start(failed); return }
        guard selectedSession?.lastBackendFailure?.requiresReadback != true else {
            reconcileSelectedFailure(); return
        }
        // An explicit retry stays in OS-1 and keeps the original user turn
        // and source. Never automatically replay an uncertain write.
        start(failed)
    }

    func cancelSelectedRun() {
        guard let id = selectedSessionID else { return }
        cancelRun(id)
    }
    private func cancelRun(_ id: UUID) {
        guard let active = activeRuns[id], !active.cancellationRequested else { return }
        do {
            try ExecutionCancellation.request(submissionID: active.submissionID)
            activeRuns[id]?.cancellationRequested = true
            sessionStatuses[id] = "작업 중지 중 · 실행된 변경은 보존합니다"
            if selectedSessionID == id { statusText = sessionStatuses[id]! }
        } catch { alertMessage = "작업 중지 요청을 저장하지 못했습니다." }
    }
    func reconcileSelectedFailure() {
        guard !isRunning, let failed = selectedSession?.lastFailure,
              (selectedSession?.lastBackendFailure?.requiresReadback == true || failed.savedResultNeedsReview == true),
              activeRuns.count < Self.maximumConcurrentSessions else { return }
        beginReconciliation(conversationID: failed.sessionID)
    }
    private func beginReconciliation(conversationID: UUID) {
        guard !isSessionRunning(conversationID), activeRuns.count < Self.maximumConcurrentSessions,
              let index = sessions.firstIndex(where: { $0.id == conversationID }),
              let failed = sessions[index].lastFailure else { return }
        let request = BackendRecovery.readbackPrompt(objective: failed.request)
        var readback = PendingSubmission(sessionID: failed.sessionID, userMessageID: failed.userMessageID,
            request: request, provider: .auto, workspace: failed.workspace,
            codexCapacity: failed.codexCapacity, claudeCapacity: failed.claudeCapacity,
            readOnlyReconciliation: true)
        readback.recoveryParentID = failed.id
        sessions[index].lastFailure?.recoveryAttempted = true
        appendTaskEvent(conversationID: conversationID, kind: "reconciling", summary: "OS1 owns bounded read-only recovery of the original request")
        save() // persist the one-review budget before dispatch, including a crash
        start(readback)
    }
    func flushPendingState() { draftSaveTask?.cancel(); save() }
    func removeQueued(_ id: UUID) {
        queuedSubmissions.removeAll { $0.id == id }
        pausedQueueIDs.remove(id); editingQueueIDs.remove(id)
        save()
        runNextQueuedSubmissionIfNeeded()
    }
    func beginQueueEdit(_ id: UUID) -> Bool {
        guard queuedSubmissions.contains(where: { $0.id == id }) else { return false }
        editingQueueIDs.insert(id)
        objectWillChange.send()
        return true
    }
    func updateQueued(_ id: UUID, request: String) -> Bool {
        let request = request.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !request.isEmpty, editingQueueIDs.contains(id),
              let index = queuedSubmissions.firstIndex(where: { $0.id == id }) else { return false }
        queuedSubmissions[index].request = request
        if let preference = queuedSubmissions[index].configuredProvider {
            queuedSubmissions[index].provider = preference == .auto ? (explicitlyRequestedProvider(in: request) ?? .auto) : preference
        }
        save()
        return true
    }
    func endQueueEdit(_ id: UUID) {
        editingQueueIDs.remove(id)
        objectWillChange.send()
        runNextQueuedSubmissionIfNeeded()
    }
    func editQueued(_ id: UUID) {
        guard composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let queued = queuedSubmissions.first(where: { $0.id == id }),
              sessions.first(where: { $0.id == queued.sessionID })?.draft?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false else { return }
        select(queued.sessionID); composer = queued.request; removeQueued(id)
    }
    func prioritizeQueued(_ id: UUID) {
        guard let item = queuedSubmissions.first(where: { $0.id == id }),
              let first = queuedSubmissions.first(where: { $0.sessionID == item.sessionID }) else { return }
        moveQueued(id, before: first.id)
    }
    func moveQueued(_ id: UUID, before targetID: UUID) {
        guard id != targetID,
              let index = queuedSubmissions.firstIndex(where: { $0.id == id }),
              let target = queuedSubmissions.first(where: { $0.id == targetID }),
              queuedSubmissions[index].sessionID == target.sessionID else { return }
        let item = queuedSubmissions.remove(at: index)
        queuedSubmissions.insert(item, at: queuedSubmissions.firstIndex(where: { $0.id == targetID })!)
        save(); runNextQueuedSubmissionIfNeeded()
    }
    func shiftQueued(_ id: UUID, down: Bool) {
        guard let item = queuedSubmissions.first(where: { $0.id == id }) else { return }
        let indices = queuedSubmissions.indices.filter { queuedSubmissions[$0].sessionID == item.sessionID }
        guard let rank = indices.firstIndex(where: { queuedSubmissions[$0].id == id }) else { return }
        let other = rank + (down ? 1 : -1)
        guard indices.indices.contains(other) else { return }
        queuedSubmissions.swapAt(indices[rank], indices[other])
        save(); runNextQueuedSubmissionIfNeeded()
    }

    private func forkCheckpoint(_ id: UUID) -> ConversationForkCheckpoint? {
        guard let session = sessions.first(where: { $0.id == id }) else { return nil }
        if let active = activeRuns[id] { return active.forkCheckpoint }
        if session.lastFailure != nil { return session.completedForkCheckpoint }
        return ConversationForkCheckpoint(throughMessageID: session.messages.last?.id,
            source: session.sourceContext, context: session.taskContext)
    }
    func canForkSession(_ id: UUID) -> Bool { forkCheckpoint(id) != nil }

    @discardableResult
    func forkSession(_ id: UUID) -> UUID? {
        guard let parent = sessions.first(where: { $0.id == id }),
              let checkpoint = forkCheckpoint(id) else { return nil }
        let messages: [ChatMessage]
        if let boundary = checkpoint.throughMessageID {
            guard let index = parent.messages.firstIndex(where: { $0.id == boundary }) else { return nil }
            messages = Array(parent.messages[...index])
        } else { messages = [] }
        var child = ConversationSession(title: String((parent.title + " · 포크").prefix(200)),
            workspace: parent.workspace, provider: parent.provider, messages: messages,
            codexCapacity: parent.effectiveCodexCapacity, claudeCapacity: parent.effectiveClaudeCapacity)
        child.sourceContext = checkpoint.source
        var context = checkpoint.context ?? TaskContext.migrated(conversationID: child.id,
            request: messages.last(where: { $0.role == .user && $0.nativeManagedTurnID == nil })?.text ?? "", workspace: parent.workspace,
            sourceContext: checkpoint.source, codexSessionID: nil, claudeSessionID: nil)
        context.conversationID = child.id; context.objectiveID = UUID()
        context.contextRevision = 1; context.createdAt = Date(); context.updatedAt = Date()
        context.bindings = []; context.executions = []; context.sourcePreparation = nil
        child.taskContext = context
        child.forkedFrom = ConversationForkOrigin(conversationID: id, throughMessageID: checkpoint.throughMessageID)
        child.completedForkCheckpoint = ConversationForkCheckpoint(throughMessageID: checkpoint.throughMessageID,
            source: checkpoint.source, context: context)
        sessions.insert(child, at: 0)
        showArchived = false; search = ""; surface = .auto
        select(child.id)
        statusText = "완료된 대화에서 분기됨 · 원본 작업과 대기열은 그대로 유지됩니다"
        save()
        return child.id
    }

    private func title(for request: String) -> String {
        let firstLine = request.split(separator: "\n", maxSplits: 1).first.map(String.init) ?? request
        return String(firstLine.prefix(48))
    }

    private var storageURL: URL {
        (customStorageRoot ?? fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1", isDirectory: true))
            .appendingPathComponent("sessions.json", isDirectory: false)
    }

    private func load() {
        guard let data = try? Data(contentsOf: storageURL) else { return }
        let envelope: SessionEnvelope
        if let strict = try? JSONDecoder().decode(SessionEnvelope.self, from: data) {
            envelope = strict
        } else if let lenient = try? JSONDecoder().decode(LenientSessionEnvelope.self, from: data) {
            // Keep every readable conversation and preserve the original file
            // before anything is written back; nothing is deleted.
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let preserved = storageURL.deletingLastPathComponent().appendingPathComponent("sessions.unreadable-\(stamp).json")
            try? data.write(to: preserved, options: [.atomic])
            let readable = lenient.sessions.compactMap(\.value)
            envelope = SessionEnvelope(schema: lenient.schema, sessions: readable, queued: lenient.queued,
                inFlight: lenient.inFlight, sidebarIntents: lenient.sidebarIntents, nativePinnedOrders: lenient.nativePinnedOrders)
            alertMessage = "대화 \(lenient.sessions.count - readable.count)개를 읽지 못했습니다. 원본 파일을 \(preserved.lastPathComponent)으로 보존했고 나머지 대화는 그대로 불러왔습니다."
        } else { return }
        guard [1, 2, 3, 4].contains(envelope.schema) else { return }
        var provenanceRepaired = false
        sessions = envelope.sessions
            .sorted { $0.updatedAt > $1.updatedAt }
            .map { session in
                var bounded = session
                if customStorageRoot == nil, session.messages.contains(where: { $0.nativeIngestedID != nil && $0.nativeManagedTurnID == nil }) {
                    let outcomes = Self.readBoundNativeRecords(session.taskContext?.bindings ?? [],
                        held: Set(session.visibleMessages.map { NativeIngestion.digestOf($0.text) }),
                        seen: Set(session.messages.compactMap(\.nativeIngestedID)),
                        ownedCodexTurns: Set(session.ownedCodexTurnIDs ?? []))
                    for outcome in outcomes {
                        if repairManagedImports(&bounded, records: outcome.managedRecords) { provenanceRepaired = true }
                    }
                }
                bounded.sourceContext = migratedSourceReference(bounded)
                bounded.sourceContextVersion = 2
                bounded.taskContext = migratedTaskContext(bounded, sourceContext: bounded.sourceContext)
                return bounded
            }
        sidebarIntents = envelope.sidebarIntents ?? [:]
        for key in sidebarIntents.keys where sidebarIntents[key]?.status == "pending" {
            sidebarIntents[key]?.status = "failed" // crash means unknown, not an infinite spinner
        }
        if sidebarIntents.values.contains(where: { $0.status == "local_only" }) {
            sidebarSyncNotice = "OS1에 저장됨 · Claude 앱의 핀/순서 변경 연결은 아직 지원되지 않습니다."
        } else if !sidebarIntents.isEmpty { sidebarSyncNotice = "백엔드에 반영됐는지 확인되지 않은 핀 변경이 있습니다." }
        nativePinnedOrders = envelope.nativePinnedOrders ?? [:]
        // Persist waiting requests but never silently execute them on app launch.
        queuedSubmissions = (envelope.queued ?? []).filter { queued in sessions.contains { $0.id == queued.sessionID } }
        for pending in envelope.inFlight ?? [] {
            guard let index = sessions.firstIndex(where: { $0.id == pending.sessionID }) else { continue }
            if pending.recoveryParentID != nil, sessions[index].lastFailure != nil {
                sessions[index].lastFailure?.recoveryAttempted = true
                continue // retain original objective/blocker; never replay interrupted recovery on launch
            }
            var recovered = pending
            // Repair mailbox-before-UI crash window, without dispatch or replay.
            let corrections = steeringMailbox.inputs(pending.id)
            if !corrections.isEmpty {
                recovered.correctionIDs = corrections.map(\.id)
                recovered.liveCorrections = corrections.map(\.text)
                for correction in corrections where !sessions[index].messages.contains(where: { $0.id == correction.id }) {
                    sessions[index].messages.append(ChatMessage(id: correction.id, role: .user, text: correction.text))
                }
                queuedSubmissions.removeAll { $0.sessionID == pending.sessionID && corrections.map(\.id).contains($0.userMessageID) }
            }
            if let result = DeliveryOutbox().forSubmission(pending.id.uuidString) {
                recovered.deliveryID = result.id
                let verdict = result.response.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["status"] as? String
                recovered.savedResultNeedsReview = result.localRejection != nil || (verdict != nil && verdict != "complete")
                sessions[index].lastBackendFailure = BackendFailureNotice(provider:sessions[index].lastProvider ?? "codex",
                    sessionID:nil,blocker:.deliveryPending,dispatchStage:.dispatched,source:result.source,deliveryID:result.id)
            } else if pending.preflightOnly == true {
                sessions[index].lastBackendFailure = BackendFailureNotice(provider: "local",
                    sessionID: nil, blocker: .unclassified, dispatchStage: .notDispatched)
            } else {
                sessions[index].lastBackendFailure = BackendFailureNotice(provider:sessions[index].lastProvider ?? "codex",
                    sessionID:nil,blocker:.effectsUncertain,dispatchStage:.dispatched)
            }
            sessions[index].lastFailure = recovered
        }
        if provenanceRepaired { save() }
    }

    private func save() {
        let directory = storageURL.deletingLastPathComponent()
        do {
            try fileManager.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.posixPermissions: 0o700]
            )
            let bounded = sessions.sorted { $0.updatedAt > $1.updatedAt }
            let data = try JSONEncoder().encode(SessionEnvelope(schema: 4, sessions: bounded, queued: queuedSubmissions,
                inFlight:Array(inFlightSubmissions.values), sidebarIntents: sidebarIntents,
                nativePinnedOrders: nativePinnedOrders))
            try data.write(to: storageURL, options: [.atomic, .completeFileProtectionUnlessOpen])
            try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: storageURL.path)
        } catch {
            alertMessage = "Session history could not be saved: \(error.localizedDescription)"
        }
    }
}

private enum Theme {
    static let background = Color(red: 0.008, green: 0.008, blue: 0.011)
    static let panel = Color(red: 0.015, green: 0.014, blue: 0.017)
    static let panelRaised = Color(red: 0.035, green: 0.029, blue: 0.034)
    static let border = Color.white.opacity(0.14)
    static let borderStrong = Color.white.opacity(0.22)
    static let muted = Color.white.opacity(0.47)
    static let text = Color.white.opacity(0.95)
    static let pink = Color(red: 0.93, green: 0.70, blue: 0.80)
    static let pinkDeep = Color(red: 0.22, green: 0.10, blue: 0.16)
    static let green = Color(red: 0.28, green: 0.93, blue: 0.55)
    static let radiusShell: CGFloat = 22
    static let radiusPanel: CGFloat = 18
    static let radiusControl: CGFloat = 13
    static let radiusMessage: CGFloat = 16
    static let radiusComposer: CGFloat = 22
}

private struct OmarAGILogo: View {
    let size: CGFloat

    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: "OmarAGI", withExtension: "png"),
               let image = NSImage(contentsOf: url) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .antialiased(true)
                    .scaledToFit()
            } else {
                ZStack {
                    Circle().stroke(Theme.pink, lineWidth: max(4, size * 0.18))
                    Circle().fill(Color.white.opacity(0.94)).frame(width: max(4, size * 0.12))
                }
            }
        }
        .frame(width: size, height: size)
        .contentShape(Circle())
    }
}

private struct ProviderBrandIcon: View {
    let provider: ProviderChoice
    let size: CGFloat
    var filled = true

    private var resourceName: String {
        provider == .claude ? "ClaudeCode" : "Codex"
    }

    var body: some View {
        Group {
            if let url = Bundle.main.url(forResource: resourceName, withExtension: "png"),
               let image = NSImage(contentsOf: url) {
                Image(nsImage: image)
                    .resizable()
                    .interpolation(.high)
                    .antialiased(true)
                    .scaledToFit()
            } else {
                Image(systemName: provider == .claude ? "sun.max.fill" : "chevron.left.forwardslash.chevron.right")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(provider.tint)
                    .padding(size * 0.2)
            }
        }
        .frame(width: size, height: size)
        .opacity(filled ? 1 : 0.96)
        .accessibilityHidden(true)
    }
}

/// Synthetic, headless fixture for the provider rail/inspector states. It
/// never reads the user's session store or native backend indexes.
@MainActor
private func renderBackendInspectorPreview(to output: URL) throws {
    let fileManager = FileManager.default
    try fileManager.createDirectory(at: output, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700])
    let fixtureRoot = fileManager.temporaryDirectory
        .appendingPathComponent("os1-backend-inspector-" + UUID().uuidString, isDirectory: true)
    try fileManager.createDirectory(at: fixtureRoot, withIntermediateDirectories: true)
    defer { try? fileManager.removeItem(at: fixtureRoot) }

    let currentID = "01a060ab-f53b-71c3-a38e-e77b1b98ea74"
    let missingID = "bae5987c-3fd1-4d08-a85c-6d9c18d41e86"
    let unrelatedID = "17db0272-fc3c-402b-9f09-2cda62056a9a"
    var current = NativeSessionSummary(id: currentID, provider: .codex,
        title: "Current recorded backend", workspace: "/tmp/os1-fixture", workspaceLabel: nil,
        updatedAt: Date(), sourcePath: nil, linkedTitle: "Inspector fixture")
    current.isPinned = true; current.pinPosition = 1
    var unrelated = NativeSessionSummary(id: unrelatedID, provider: .codex,
        title: "Unlinked local record", workspace: "/tmp/unlinked", workspaceLabel: nil,
        updatedAt: Date().addingTimeInterval(-120), sourcePath: nil, linkedTitle: nil)
    unrelated.isPinned = true; unrelated.pinPosition = 0

    func makeStore(
        name: String,
        recordedID: String?,
        nativeSessions: [NativeSessionSummary],
        selectedID: String?,
        messages: [NativeSessionMessage]
    ) throws -> SessionStore {
        let root = fixtureRoot.appendingPathComponent(name, isDirectory: true)
        let store = SessionStore(storageRoot: root, nativeSessionOpener: { _ in false })
        guard let selectedIndex = store.selectedIndex else { throw SourceContextError.invalid }
        store.sessions[selectedIndex].title = "Inspector fixture"
        store.sessions[selectedIndex].codexSessionID = recordedID
        store.surface = .codex
        store.nativeSessions = nativeSessions
        store.selectedNativeSessionID = selectedID
        store.nativeMessages = messages
        return store
    }

    func render(_ name: String, store: SessionStore) throws {
        let content = NativeSessionBrowser(store: store, provider: .codex)
            .frame(width: 1_120, height: 760)
            .background(Theme.background)
            .environment(\.colorScheme, .dark)
        let view = NSHostingView(rootView: content)
        view.frame = NSRect(x: 0, y: 0, width: 1_120, height: 760)
        // SwiftUI installs glyph runs on the next main-loop pass. Capturing
        // synchronously can otherwise produce a partially painted text layer.
        RunLoop.main.run(until: Date().addingTimeInterval(0.05))
        view.layoutSubtreeIfNeeded()
        view.needsDisplay = true
        view.displayIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
            throw SourceContextError.invalid
        }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw SourceContextError.invalid
        }
        try data.write(to: output.appendingPathComponent(name), options: .atomic)
    }

    let currentStore = try makeStore(name: "current", recordedID: currentID,
        nativeSessions: [current, unrelated], selectedID: currentID, messages: [
        NativeSessionMessage(id: "fixture-user", role: .user,
            text: "현재 대화의 Codex 기록을 보여 줘.", timestamp: Date()),
        NativeSessionMessage(id: "fixture-assistant", role: .assistant,
            text: "이 패널은 현재 대화에 기록된 정확한 backend ID만 읽습니다.", timestamp: Date()),
    ])
    try render("backend-current.png", store: currentStore)

    let missingStore = try makeStore(name: "missing", recordedID: missingID,
        nativeSessions: [unrelated], selectedID: nil, messages: [])
    try render("backend-missing.png", store: missingStore)

    let noSessionStore = try makeStore(name: "no-session", recordedID: nil,
        nativeSessions: [unrelated], selectedID: nil, messages: [])
    try render("backend-no-session.png", store: noSessionStore)

    let manifest: [String: Any] = [
        "fixtureOnly": true,
        "provider": "codex",
        "refreshPolicy": [
            "intervalSeconds": 2,
            "decisionCoveredBy": "OS1App --self-test",
            "liveSwiftUITaskSchedulingCovered": false,
        ],
        "states": [
            ["image": "backend-current.png", "caption": "CURRENT RECORD · AVAILABLE", "selectedID": currentID],
            ["image": "backend-missing.png", "caption": "CURRENT RECORD · NOT FOUND", "recordedID": missingID],
            ["image": "backend-no-session.png", "caption": "THIS CONVERSATION · NO SESSION"],
        ],
    ]
    try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        .write(to: output.appendingPathComponent("backend-inspector-preview.json"), options: .atomic)
}

@MainActor
private func renderQueuePreview(to output: URL) throws {
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-queue-preview-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = SessionStore(storageRoot: root, runOperation: { _, _, _, _, _ in
        throw RunnerError.message("Preview cannot execute a backend")
    }, nativeSessionOpener: { _ in false })
    let id = store.selectedSessionID!
    store.sessions[0].title = "큐·포크 인터페이스 검증 — 실제 고객 작업 아님"
    store.sessions[0].taskContext = TaskContext(conversationID: id,
        objective: TaskContext.Objective(requestText: "격리된 스티어링 미리보기", kind: .other))
    store.activeRuns[id] = .init(submissionID: UUID(), started: Date().addingTimeInterval(-16),
        activity: RuntimeActivity(.executing, provider: "codex"), provider: .codex,
        handedRevision: store.sessions[0].taskContext!.contextRevision)
    try ExecutionSteering(root: root.appendingPathComponent("run-steering")).open(submissionID: store.activeRuns[id]!.submissionID,
        threadID: "preview-thread", turnID: "preview-turn")
    for text in ["첫 번째 결과를 바탕으로 문제 원인을 설명해 줘.", "그 다음 수정안을 검증하고 결과를 같은 대화에 정리해 줘.",
                 "마지막으로 남은 작업과 변경된 파일을 알려 줘. 먼저 보낸 요청의 결과를 기다려야 합니다."] {
        store.composer = text; store.send()
    }
    store.composer = "새 입력은 앞선 작업을 끊지 않고 대기열로 갑니다."
    for (name, width, paused) in [("queue-running.png", 960.0, false), ("queue-paused-compact.png", 660.0, true)] {
        store.sessions[0].queuePaused = paused
        let content = ComposerView(store: store, session: store.sessions[0])
            .frame(width: width, height: 470).background(Theme.background).environment(\.colorScheme, .dark)
        let view = NSHostingView(rootView: content)
        view.frame = NSRect(x: 0, y: 0, width: width, height: 470)
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        view.layoutSubtreeIfNeeded(); view.displayIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw SourceContextError.invalid }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw SourceContextError.invalid }
        try data.write(to: output.appendingPathComponent(name), options: .atomic)
    }
    print("Queue previews: running/paused compact; isolated fixture; model calls 0; live state unchanged")
}

@MainActor
private func renderComposerPreview(to output: URL) throws {
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    let fixtures: [(String, String, Bool, Bool, VoiceDictationPhase)] = [
        ("idle-empty", "", false, false, .idle), ("idle-draft", "요청을 보내 주세요", false, false, .idle),
        ("running-empty", "", true, false, .idle), ("running-draft", "이어서 결과를 설명해 줘", true, false, .idle),
        ("stopping-empty", "", true, true, .idle), ("stopping-draft", "이 입력은 보존됩니다", true, true, .idle),
        ("dictation-finalizing", "음성 입력 마무리 중", true, false, .finalizing)
    ]
    var report: [[String: Any]] = []
    for (name, draft, running, stopping, voice) in fixtures {
        let action = ComposerPrimaryAction.resolve(draft: draft, running: running, stopping: stopping, voice: voice)
        let content = VStack(alignment: .leading, spacing: 12) {
            Text(name).font(.system(size: 12)).foregroundStyle(Theme.muted)
            HStack(alignment: .bottom, spacing: 12) {
                Text(draft.isEmpty ? "OS-1에 작업을 요청하세요…" : draft)
                    .foregroundStyle(draft.isEmpty ? Theme.muted : Theme.text)
                    .frame(maxWidth: .infinity, minHeight: 70, alignment: .topLeading)
                Image(systemName: "mic").frame(width: 44, height: 44).foregroundStyle(Theme.text)
                ComposerPrimaryButton(action: action, activate: {})
            }.padding(12).background(Color.black.opacity(0.5))
                .overlay(RoundedRectangle(cornerRadius: Theme.radiusComposer).stroke(Theme.borderStrong))
            Text(action.label).font(.system(size: 12)).foregroundStyle(Theme.muted)
        }.padding(20).frame(width: 660, height: 190).background(Theme.background).environment(\.colorScheme, .dark)
        let view = NSHostingView(rootView: content)
        view.frame = NSRect(x: 0, y: 0, width: 660, height: 190)
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
        view.layoutSubtreeIfNeeded(); view.displayIfNeeded()
        guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw SourceContextError.invalid }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw SourceContextError.invalid }
        try data.write(to: output.appendingPathComponent(name + ".png"), options: .atomic)
        report.append(["fixture": name, "action": action.rawValue, "label": action.label, "enabled": action.enabled,
                       "primaryControlCount": 1, "controlSize": 44])
    }
    try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        .write(to: output.appendingPathComponent("states.json"), options: .atomic)
    print("Composer previews: 7 state fixtures; shared primary component; model calls 0")
}

@main
private struct OS1DesktopApp: App {
    @StateObject private var store: SessionStore

    init() {
        if CommandLine.arguments.contains("--audit-sidebar") {
            do {
                var report: [String: Any] = [:]
                for provider in [ProviderChoice.codex, .claude] {
                    let rows = try NativeSessionReader.sessions(for: provider)
                    let pins = rows.filter(\.isPinned)
                    report[provider.rawValue] = ["pinnedIDs": pins.map(\.id), "visibleCount": rows.count,
                        "manualOrderVerified": provider == .codex,
                        "nativeMutationSupported": provider == .codex]
                }
                print(String(decoding: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), as: UTF8.self))
                exit(EXIT_SUCCESS)
            } catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--audit-backend-record") {
            do {
                let args = CommandLine.arguments
                guard args.count == flag + 3,
                      let provider = ProviderChoice(rawValue: args[flag + 1]), provider != .auto,
                      UUID(uuidString: args[flag + 2]) != nil else { throw SourceContextError.invalid }
                // Exercise the same read-only reader as the inspector. Do not
                // initialize SessionStore, emit conversation text, or open apps.
                let requestedID = args[flag + 2]
                let records = try NativeSessionReader.sessions(for: provider, including: requestedID)
                let exact = records.first { $0.id == requestedID }
                let messages = try exact.map { try NativeSessionReader.transcript(for: $0) } ?? []
                let answer = messages.last(where: { $0.role == .assistant })?.text
                let report: [String: Any] = [
                    "provider": provider.rawValue, "requestedID": requestedID,
                    "matchedID": exact?.id as Any? ?? NSNull(), "recordAvailable": exact != nil,
                    "messageCount": messages.count,
                    "userMessageCount": messages.filter { $0.role == .user }.count,
                    "assistantMessageCount": messages.filter { $0.role == .assistant }.count,
                    "lastAnswerSHA256": answer.map { SHA256.hash(data: Data($0.utf8)).map { String(format: "%02x", $0) }.joined() } as Any? ?? NSNull(),
                ]
                let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
                print(String(decoding: data, as: UTF8.self))
                exit(EXIT_SUCCESS)
            } catch {
                fputs("Backend record audit failed: \(error.localizedDescription)\n", stderr)
                exit(EXIT_FAILURE)
            }
        }
        if CommandLine.arguments.contains("--self-test-parallel") {
            Task { @MainActor in
                do { try await parallelInteractionSelfTest(); exit(EXIT_SUCCESS) }
                catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
            }
            NSApplication.shared.run()
            exit(EXIT_FAILURE)
        }
        if CommandLine.arguments.contains("--self-test-composer") {
            Task { @MainActor in
                do { try await composerInteractionSelfTest(); exit(EXIT_SUCCESS) }
                catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
            }
            NSApplication.shared.run()
            exit(EXIT_FAILURE)
        }
        if CommandLine.arguments.contains("--self-test-steering") {
            Task { @MainActor in
                do { try await steeringInteractionSelfTest(); try await replacementInteractionSelfTest(); exit(EXIT_SUCCESS) }
                catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
            }
            NSApplication.shared.run()
            exit(EXIT_FAILURE)
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--render-composer-preview") {
            do {
                guard CommandLine.arguments.count == flag + 2 else { throw SourceContextError.invalid }
                try renderComposerPreview(to: URL(fileURLWithPath: CommandLine.arguments[flag + 1], isDirectory: true))
                exit(EXIT_SUCCESS)
            } catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
        }
        if CommandLine.arguments.contains("--self-test-queue-fork") {
            Task { @MainActor in
                do { try await queueForkInteractionSelfTest(); exit(EXIT_SUCCESS) }
                catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
            }
            NSApplication.shared.run()
            exit(EXIT_FAILURE)
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--render-queue-preview") {
            do {
                guard CommandLine.arguments.count == flag + 2 else { throw SourceContextError.invalid }
                try renderQueuePreview(to: URL(fileURLWithPath: CommandLine.arguments[flag + 1], isDirectory: true))
                exit(EXIT_SUCCESS)
            } catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
        }
        if CommandLine.arguments.contains("--self-test-sidebar-queue") {
            Task { @MainActor in
                do { try await sidebarQueueSelfTest(); exit(EXIT_SUCCESS) }
                catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
            }
            NSApplication.shared.run()
            exit(EXIT_FAILURE)
        }
        if CommandLine.arguments.contains("--activity-fixture") {
            for phase: RuntimeActivity.Phase in [.source, .executing, .verifying] {
                RuntimeActivity.emit(phase)
                Thread.sleep(forTimeInterval: 0.35)
            }
            exit(EXIT_SUCCESS)
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--render-backend-inspector-preview") {
            do {
                guard CommandLine.arguments.count > flag + 1 else { throw SourceContextError.invalid }
                let output = URL(fileURLWithPath: CommandLine.arguments[flag + 1], isDirectory: true)
                try renderBackendInspectorPreview(to: output)
                print(output.path)
                exit(EXIT_SUCCESS)
            } catch {
                fputs("\(error.localizedDescription)\n", stderr)
                exit(EXIT_FAILURE)
            }
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--render-activity-preview") {
            do {
                guard CommandLine.arguments.count > flag + 1 else { throw SourceContextError.invalid }
                let output = URL(fileURLWithPath: CommandLine.arguments[flag + 1], isDirectory: true)
                try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
                let started = Date(timeIntervalSinceReferenceDate: 1_000)
                for (index, elapsed) in [4.0, 4.3, 65.0].enumerated() {
                    let content = RunActivityBanner(activity: RuntimeActivity(.executing, provider: "claude", model: "fixture", effort: "low", timestamp: started),
                        started: started, previewTime: started.addingTimeInterval(elapsed))
                        .frame(width: 900, height: 74).background(Theme.background).environment(\.colorScheme, .dark)
                    let view = NSHostingView(rootView: content)
                    view.frame = NSRect(x: 0, y: 0, width: 900, height: 74)
                    view.layoutSubtreeIfNeeded()
                    guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw SourceContextError.invalid }
                    view.cacheDisplay(in: view.bounds, to: bitmap)
                    guard let data = bitmap.representation(using: .png, properties: [:]) else { throw SourceContextError.invalid }
                    try data.write(to: output.appendingPathComponent("activity-\(index).png"))
                    let rowContent = VStack(spacing: 4) {
                        SessionRow(session: ConversationSession(title: "연구 자료 분석", workspace: "/tmp"), selected: true,
                            activity: RuntimeActivity(.executing, provider: "claude"), queuedCount: 1,
                            previewTime: started.addingTimeInterval(elapsed), action: {})
                        SessionRow(session: ConversationSession(title: "자동화 복원 검토", workspace: "/tmp"), selected: false,
                            activity: RuntimeActivity(.executing, provider: "codex"),
                            previewTime: started.addingTimeInterval(elapsed), action: {})
                        SessionRow(session: ConversationSession(title: "완료한 대화", workspace: "/tmp"), selected: false, action: {})
                    }.frame(width: 290, height: 228).background(Theme.background).environment(\.colorScheme, .dark)
                    let rows = NSHostingView(rootView: rowContent)
                    rows.frame = NSRect(x: 0, y: 0, width: 290, height: 228); rows.layoutSubtreeIfNeeded()
                    guard let rowBitmap = rows.bitmapImageRepForCachingDisplay(in: rows.bounds) else { throw SourceContextError.invalid }
                    rows.cacheDisplay(in: rows.bounds, to: rowBitmap)
                    guard let rowPNG = rowBitmap.representation(using: .png, properties: [:]) else { throw SourceContextError.invalid }
                    try rowPNG.write(to: output.appendingPathComponent("sidebar-\(index).png"))
                }
                print(output.path); exit(EXIT_SUCCESS)
            } catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--render-session-transcript") ?? CommandLine.arguments.firstIndex(of: "--render-run-summary") {
            do {
                let args = CommandLine.arguments
                guard args.count > flag + 2 else { throw SourceContextError.invalid }
                let output = URL(fileURLWithPath: args[flag + 2])
                let session: ConversationSession
                if args[flag] == "--render-run-summary" {
                    let summary = try JSONDecoder().decode(AppRunSummary.self, from: Data(contentsOf: URL(fileURLWithPath: args[flag + 1])))
                    let steps = visibleAdoptedSteps(summary.steps)
                    guard summary.status == "complete", !steps.isEmpty, steps.allSatisfy(stepRecordIsVerified) else { throw SourceContextError.invalid }
                    let requestIndex = args.firstIndex(of: "--request")
                    let request = requestIndex.flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
                        ?? "R2에서 QM·GR과 Orthogonal Projection Term 원본을 가져와."
                    var preview = ConversationSession(id: summary.taskContext?.conversationID ?? UUID(), workspace: FileManager.default.homeDirectoryForCurrentUser.path,
                        messages: [ChatMessage(role: .user, text: request)])
                    preview.sourceContext = summary.sourceContext
                    preview.taskContext = summary.taskContext
                    for step in steps {
                        preview.messages.append(ChatMessage(role: .assistant, text: step.output, provider: step.provider,
                            permissionProfile: step.permissionProfile))
                        preview.messages.append(ChatMessage(role: .receipt,
                            text: "\(backendTierLabel(action: step.action, provider: step.provider)) · \(nativeRecordReceipt(step))",
                            provider: step.provider, nativeRecordVerified: stepRecordIsVerified(step)))
                    }
                    session = preview // in-memory only; never added to the user's sessions
                } else {
                    guard let id = UUID(uuidString: args[flag + 1]) else { throw SourceContextError.invalid }
                    let sessionsURL = FileManager.default.homeDirectoryForCurrentUser
                        .appendingPathComponent("Library/Application Support/OS-1/sessions.json")
                    let envelope = try JSONDecoder().decode(SessionEnvelope.self, from: Data(contentsOf: sessionsURL))
                    guard let existing = envelope.sessions.first(where: { $0.id == id }) else { throw SourceContextError.invalid }
                    session = existing
                }
                let widthIndex = args.firstIndex(of: "--width")
                let width = widthIndex.flatMap { $0 + 1 < args.count ? Double(args[$0 + 1]) : nil } ?? 1100
                guard (500...2400).contains(width) else { throw SourceContextError.invalid }
                let activityIndex = args.firstIndex(of: "--activity-file")
                let progress: RuntimeActivity? = try activityIndex.map {
                    guard $0 + 1 < args.count else { throw SourceContextError.invalid }
                    let data = try Data(contentsOf: URL(fileURLWithPath: args[$0 + 1]))
                    guard data.count < 150_000 else { throw SourceContextError.invalid }
                    return try JSONDecoder().decode(RuntimeActivity.self, from:data)
                }
                let waiting = args.contains("--waiting") || progress != nil
                let messages = waiting ? Array(presentedMessages(session).prefix(4)) : presentedMessages(session)
                let expanded = args.contains("--receipt-open")
                    ? Set(messages.filter { $0.role == .receipt }.map { $0.id.uuidString + "-receipt" }) : Set<String>()
                let document = timelineAttributedDocument(messages: messages, queuedSubmissions: [], isRunning: waiting,
                    workspace: session.workspace, expanded: expanded, expandAll: args.contains("--expanded"), publicProgress: progress?.publicText)
                let view = ContinuousTranscriptTextView(frame: NSRect(x: 0, y: 0, width: width, height: 1000))
                view.drawsBackground = false; view.backgroundColor = .black
                view.linkTextAttributes = [.foregroundColor: TimelinePalette.pink]
                view.isEditable = false; view.isSelectable = true
                view.isVerticallyResizable = true
                view.maxSize = NSSize(width: width, height: 100_000)
                view.textContainerInset = NSSize(width: 40, height: 34)
                view.textContainer?.lineFragmentPadding = 0
                view.textContainer?.heightTracksTextView = false
                view.textContainer?.widthTracksTextView = true
                view.textContainer?.containerSize = NSSize(width: width - 80, height: 100_000)
                view.layoutManager?.allowsNonContiguousLayout = false
                view.textStorage?.setAttributedString(document)
                view.setFrameSize(NSSize(width: width, height: 1000))
                view.layoutManager?.ensureLayout(forCharacterRange: NSRange(location: 0, length: document.length))
                let height = view.layoutManager!.usedRect(for: view.textContainer!).height + 100
                view.setFrameSize(NSSize(width: width, height: min(20_000, max(800, height))))
                let surface = TranscriptSnapshotSurface(frame: view.bounds)
                surface.addSubview(view)
                func numberOption(_ name: String) -> Double? {
                    args.firstIndex(of: name).flatMap { $0 + 1 < args.count ? Double(args[$0 + 1]) : nil }
                }
                let capture = NSRect(x: 0, y: numberOption("--viewport-top") ?? 0, width: width,
                    height: numberOption("--viewport-height") ?? surface.bounds.height).intersection(surface.bounds)
                guard !capture.isEmpty, let bitmap = surface.bitmapImageRepForCachingDisplay(in: capture) else { throw SourceContextError.invalid }
                surface.cacheDisplay(in: capture, to: bitmap)
                guard let data = bitmap.representation(using: .png, properties: [:]) else { throw SourceContextError.invalid }
                try data.write(to: output)
                let frames = view.timelineFrames()
                let pairs = zip(frames, frames.dropFirst()).map { previous, next in
                    ["from": previous.role, "to": next.role, "gapPoints": next.paint.minY - previous.paint.maxY,
                     "intersects": previous.paint.intersects(next.paint)] as [String: Any]
                }
                func box(_ rect: NSRect) -> [String: Double] {
                    ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
                }
                let layout: [String: Any] = ["widthPoints": width, "heightPoints": view.bounds.height, "pixelsPerPoint": Double(bitmap.pixelsWide) / width,
                    "frames": frames.map { ["role": $0.role, "content": box($0.content), "paint": box($0.paint)] }, "pairs": pairs,
                    "tableCells": view.tableFrames()]
                try JSONSerialization.data(withJSONObject: layout, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathExtension("layout.json"))
                if args.contains("--reflow-check") {
                    let coordinator = ContinuousTranscriptView.Coordinator()
                    coordinator.content = ContinuousTranscriptView(sessionID: session.id, messages: messages, queuedSubmissions: [], isRunning: waiting, workspace: session.workspace)
                    coordinator.expanded = expanded
                    view.delegate = coordinator
                    var samples: [[String: Any]] = []
                    for targetWidth in [660.0, 1100.0, 900.0, 660.0] {
                        view.setFrameSize(NSSize(width: targetWidth, height: 20_000))
                        // Exercise the actual disclosure delegate, not a parallel mock.
                        for key in expanded.sorted() + expanded.sorted() {
                            _ = coordinator.textView(view, clickedOnLink: URL(string: "os1-detail://toggle/\(key)")!, at: 0)
                            let frames = view.timelineFrames()
                            samples.append(["widthPoints": targetWidth, "toggle": key,
                                "minimumGap": zip(frames, frames.dropFirst()).map { $1.paint.minY - $0.paint.maxY }.min() ?? 0,
                                "intersections": zip(frames, frames.dropFirst()).filter { $0.paint.intersects($1.paint) }.count,
                                "tableCells": view.tableFrames()])
                        }
                    }
                    try JSONSerialization.data(withJSONObject: samples, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathExtension("reflow.json"))
                }
                try MathTypesetter.copyable(document).write(to: output.appendingPathExtension("txt"), atomically: true, encoding: .utf8)
                var math: [String] = []
                document.enumerateAttribute(.os1MathSource, in: NSRange(location: 0, length: document.length)) { value, _, _ in
                    if let source = value as? String { math.append(source) }
                }
                try JSONEncoder().encode(math).write(to: output.appendingPathExtension("math.json"))
                try completeTranscriptText(presentedMessages(session)).write(to: output.appendingPathExtension("copy.txt"), atomically: true, encoding: .utf8)
                try sessionHandoff(session).write(to: output.appendingPathExtension("context.json"), atomically: true, encoding: .utf8)
                print(output.path); exit(EXIT_SUCCESS)
            } catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--render-transcript-preview") {
            do {
                guard CommandLine.arguments.count > flag + 1 else { throw SourceContextError.invalid }
                let output = URL(fileURLWithPath: CommandLine.arguments[flag + 1])
                let messages = [
                    ChatMessage(role: .user, text: "가져온 자료를 기준으로 통합 아키텍처를 설명해 줘."),
                    ChatMessage(role: .assistant, text: "현재 자료에서 확인된 범위는 **약한 장의 검증**입니다. 전체 QM·GR 통합은 아직 미해결입니다.\n\n## 제안하는 구조\n\n1. 원본 자료와 검증된 결과를 분리해 보관합니다.\n2. 미해결 조건을 각각 독립적인 검증 단계로 둡니다.\n3. 모든 필수 조건을 통과한 뒤에만 채택합니다.\n\n| 구성 | 역할 |\n| --- | --- |\n| 원본 | 자료·출처 보존 |\n| 검증 | 필수 조건과 실제 결과 비교 |\n\n**다음 작업:** 아직 검증하지 않은 조건을 명시하고, 실행 가능한 첫 검증부터 진행합니다.\n\n```json\n" + (0..<18).map { "  \"stage_\($0)\": \"pending\", " }.joined(separator: "\n") + "\n```", provider: "claude", permissionProfile: "read_only"),
                    ChatMessage(role: .receipt, text: "Claude · sonnet · medium reasoning · native record verified · example receipt", nativeRecordVerified: true),
                    ChatMessage(role: .user, text: "좋아. 그다음 단계도 같은 자료로 설명해 줘."),
                ]
                let view = ContinuousTranscriptTextView(frame: NSRect(x: 0, y: 0, width: 1100, height: 900))
                view.drawsBackground = true; view.backgroundColor = .black
                view.linkTextAttributes = [.foregroundColor: TimelinePalette.pink]
                view.isEditable = false; view.isSelectable = true
                view.textContainerInset = NSSize(width: 50, height: 34)
                view.textContainer?.containerSize = NSSize(width: 1000, height: 10000)
                view.textStorage?.setAttributedString(timelineAttributedDocument(messages: messages, queuedSubmissions: [], isRunning: false, workspace: "/tmp"))
                view.layoutManager?.ensureLayout(for: view.textContainer!)
                guard let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw SourceContextError.invalid }
                view.cacheDisplay(in: view.bounds, to: bitmap)
                guard let data = bitmap.representation(using: .png, properties: [:]) else { throw SourceContextError.invalid }
                try data.write(to: output)
                print(output.path); exit(EXIT_SUCCESS)
            } catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--audit-native-provenance") {
            do {
                guard CommandLine.arguments.count == flag + 2, let id = UUID(uuidString: CommandLine.arguments[flag + 1]) else { throw SourceContextError.invalid }
                let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/OS-1/sessions.json")
                let envelope = try JSONDecoder().decode(SessionEnvelope.self, from: Data(contentsOf: url))
                guard var session = envelope.sessions.first(where: { $0.id == id }) else { throw SourceContextError.invalid }
                let before = session.visibleMessages.count
                let outcomes = SessionStore.readBoundNativeRecords(session.taskContext?.bindings ?? [],
                    held: Set(session.visibleMessages.map { NativeIngestion.digestOf($0.text) }),
                    seen: Set(session.messages.compactMap(\.nativeIngestedID)), ownedCodexTurns: Set(session.ownedCodexTurnIDs ?? []))
                for outcome in outcomes { repairManagedImports(&session, records: outcome.managedRecords) }
                let report: [String: Any] = ["conversationID": id.uuidString, "storedMessages": session.messages.count,
                    "visibleBefore": before, "visibleAfter": session.visibleMessages.count,
                    "managedNativeRows": outcomes.flatMap(\.managedRecords).count,
                    "archivedImports": session.messages.filter { $0.nativeManagedTurnID != nil }.map { ["id": $0.id.uuidString, "role": $0.role.rawValue, "turn": $0.nativeManagedTurnID!] },
                    "sessionFileWritten": false, "modelCalls": 0]
                print(String(decoding: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), as: UTF8.self))
                exit(EXIT_SUCCESS)
            } catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
        }
        if let flag = CommandLine.arguments.firstIndex(of: "--export-session-context") {
            do {
                let args = CommandLine.arguments
                guard args.count > flag + 1, let id = UUID(uuidString: args[flag + 1]) else { throw SourceContextError.invalid }
                let url = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent("Library/Application Support/OS-1/sessions.json")
                let envelope = try JSONDecoder().decode(SessionEnvelope.self, from: Data(contentsOf: url))
                guard let session = envelope.sessions.first(where: { $0.id == id }) else { throw SourceContextError.invalid }
                let before = args.count > flag + 2 ? UUID(uuidString: args[flag + 2]) : nil
                print(try sessionHandoff(session, before: before))
                exit(EXIT_SUCCESS)
            } catch {
                fputs("\(error.localizedDescription)\n", stderr)
                exit(EXIT_FAILURE)
            }
        }
        if CommandLine.arguments.contains("--self-test") {
            do {
                try nativeProvenanceSelfTest()
                try providerIntentSelfTest()
                try taskContextSelfTest()
                try interactionSelfTest()
                try sidebarSynchronizationSelfTest()
                print("OS-1 app provider intent, source continuity, voice, math, selection, pin/archive/drafts/queue self-test: OK")
                exit(EXIT_SUCCESS)
            } catch {
                fputs("\(error.localizedDescription)\n", stderr)
                exit(EXIT_FAILURE)
            }
        }
        // Misspelled/newer diagnostic switches must not fall through into a
        // second live session-store writer when an older executable is used.
        if CommandLine.arguments.dropFirst().contains(where: { $0.hasPrefix("--") }) {
            fputs("Unsupported OS1 diagnostic option; live sessions were not opened.\n", stderr)
            exit(EXIT_FAILURE)
        }
        _store = StateObject(wrappedValue: SessionStore())
    }

    var body: some Scene {
        WindowGroup("OS-1 CLODEX") {
            RootView(store: store)
                .preferredColorScheme(.dark)
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1360, height: 760)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New session pair") { store.createSession() }
                    .keyboardShortcut("n", modifiers: [.command])
                Button("대화 검색") { NotificationCenter.default.post(name: Notification.Name("os1.focusSearch"), object: nil) }
                    .keyboardShortcut("k", modifiers: [.command])
                Button("현재 대화 고정/해제") { if let id = store.selectedSessionID { store.togglePin(id) } }
                    .keyboardShortcut("p", modifiers: [.command, .shift])
                Button("현재 대화 전체 복사") { if let id = store.selectedSessionID { store.copyConversation(id) } }
                    .keyboardShortcut("c", modifiers: [.command, .shift])
                Button("완료된 대화에서 포크") { if let id = store.selectedSessionID { store.forkSession(id) } }
                    .keyboardShortcut("f", modifiers: [.command, .shift])
                    .disabled(store.selectedSessionID.map { !store.canForkSession($0) } ?? true)
                Button("현재 대기열 일시정지") { if let id = store.selectedSessionID { store.pauseQueue(id) } }
                    .disabled(store.selectedSessionQueueCount == 0)
                Button("현재 대기열 계속 실행") { store.resumeQueue() }
                    .disabled(store.selectedSessionID.map { !store.canResumeQueue($0) } ?? true)
                Button("현재 작업 중지") { store.cancelSelectedRun() }
                    .keyboardShortcut(".", modifiers: [.command])
                    .disabled(!store.isRunning || store.isStopping)
            }
            CommandMenu("권한") {
                Button("검증된 R2 복구본 폴더 연결…") { store.importArchiveMirror() }
                Divider()
                Button("파일·폴더 접근 설정…") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders") { NSWorkspace.shared.open(url) }
                }
                Button("전체 디스크 접근 설정…") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles") { NSWorkspace.shared.open(url) }
                }
                Button("설치된 OS-1 앱 표시") { NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL]) }
            }
            CommandMenu("Voice") {
                Button(store.voiceDictation.isActive ? "Finish Dictation" : "Start Dictation") {
                    store.toggleVoiceDictation()
                }
                .keyboardShortcut(.space, modifiers: [.command, .shift])

                Button("Cancel Dictation") {
                    _ = store.cancelVoiceDictation()
                }
                .keyboardShortcut(.escape, modifiers: [])
                .disabled(!store.voiceDictation.isActive)
            }
        }
    }
}

@MainActor
private func sidebarQueueSelfTest() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-sidebar-queue-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    var backend: [String] = []
    var calls = 0
    let store = SessionStore(storageRoot: root, nativePinOperation: { id, pinned, before in
        try await Task.sleep(for: .milliseconds(5))
        if let before, !backend.contains(before) { throw RunnerError.message("Missing move-before dependency") }
        if pinned {
            if !backend.contains(id) { backend.append(id) }
            backend = SidebarOrder.moving(id, before: before, in: backend)
        } else { backend.removeAll { $0 == id } }
        calls += 1
    })
    let aID = "00000000-0000-4000-8000-000000000011", bID = "00000000-0000-4000-8000-000000000012"
    let a = ConversationSession(title: "A", workspace: "/tmp", codexSessionID: aID)
    let b = ConversationSession(title: "B", workspace: "/tmp", codexSessionID: bID)
    store.sessions = [a, b]
    store.togglePin(a.id); store.togglePin(b.id); store.movePinned(a.id, before: b.id)
    await store.awaitSidebarMutations()
    guard backend == [aID, bID], calls == 3, store.sidebarSyncNotice == nil else {
        throw RunnerError.message("Sidebar queue: rapid pin/move dependency ordering failed")
    }
    store.togglePin(a.id); store.togglePin(a.id); store.movePinned(a.id, before: nil)
    await store.awaitSidebarMutations()
    guard backend == [bID, aID], calls == 6, store.sidebarSyncNotice == nil else {
        throw RunnerError.message("Sidebar queue: rapid unpin/repin/reorder failed")
    }
    let failed = SessionStore(storageRoot: root.appendingPathComponent("failed"), nativePinOperation: { _, _, _ in
        throw RunnerError.message("fixture backend unavailable")
    })
    failed.sessions = [a]; failed.togglePin(a.id)
    await failed.awaitSidebarMutations()
    guard failed.sidebarSyncNotice == "fixture backend unavailable", failed.sessions[0].pinnedAt != nil else {
        throw RunnerError.message("Sidebar queue: failure lost local intent or falsely confirmed")
    }
    let restarted = SessionStore(storageRoot: root.appendingPathComponent("failed"))
    guard restarted.sessions[0].pinnedAt != nil, restarted.sidebarSyncNotice != nil else {
        throw RunnerError.message("Sidebar queue: failed intent did not survive restart")
    }
    print("Sidebar queue: 4 checks passed; model calls 0; live backend writes 0")
}

@MainActor
private func sidebarSynchronizationSelfTest() throws {
    var checks = 0
    func check(_ value: Bool, _ label: String) throws {
        guard value else { throw RunnerError.message("Sidebar regression: " + label) }
        checks += 1
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-sidebar-test-" + UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = SessionStore(storageRoot: root)
    let codexA = "00000000-0000-4000-8000-000000000001", codexB = "00000000-0000-4000-8000-000000000002"
    let claudeA = "00000000-0000-4000-8000-000000000003", claudeB = "00000000-0000-4000-8000-000000000004"
    var a = ConversationSession(title: "A", workspace: "/tmp", codexSessionID: codexA, claudeSessionID: claudeA)
    var b = ConversationSession(title: "B", workspace: "/tmp", codexSessionID: codexB, claudeSessionID: claudeB)
    a.updatedAt = Date(timeIntervalSince1970: 10); b.updatedAt = a.updatedAt
    a.draft = "draft-a"; b.draft = "draft-b"
    store.sessions = [a, b]
    store.select(a.id); store.togglePin(a.id); store.togglePin(b.id)
    try check(store.filteredSessions.map(\.id) == [b.id, a.id], "new pin first")
    store.movePinned(a.id, before: b.id)
    try check(store.filteredSessions.map(\.id) == [a.id, b.id], "explicit move")
    store.select(b.id); store.showClodexHome()
    try check(store.filteredSessions.map(\.id) == [a.id, b.id], "selection cannot reorder")
    try check(store.composer == "draft-b", "draft ownership")
    store.flushPendingState()
    let reload = SessionStore(storageRoot: root)
    try check(reload.filteredSessions.map(\.id) == [a.id, b.id], "order survives restart")
    try check(reload.sessions.allSatisfy { $0.updatedAt == a.updatedAt && $0.messages.isEmpty }, "metadata only")
    func rows(_ provider: ProviderChoice, _ ids: [String]) -> [NativeSessionSummary] {
        ids.map { NativeSessionSummary(id: $0, provider: provider, title: $0, workspace: "/tmp",
            workspaceLabel: nil, updatedAt: Date(timeIntervalSince1970: 10), sourcePath: nil) }
    }
    reload.surface = .codex; reload.nativeSessions = rows(.codex, [codexB, codexA])
    try check(reload.filteredNativeSessions.map(\.id) == [codexA, codexB], "Codex projection matches pending OS1 order")
    reload.surface = .claude; reload.nativeSessions = rows(.claude, [claudeB, claudeA])
    try check(reload.filteredNativeSessions.map(\.id) == [claudeA, claudeB], "Claude local projection matches OS1 order")
    try check(reload.filteredNativeSessions.allSatisfy { $0.pinSyncNote?.contains("미반영") == true }, "unsupported Claude is not success")
    reload.toggleNativePin(claudeA)
    try check(reload.sessions.first(where: { $0.id == a.id })?.pinnedAt == nil, "native unpin updates linked OS1")
    reload.surface = .codex; reload.nativeSessions = rows(.codex, [codexB, codexA])
    try check(reload.filteredNativeSessions.first(where: { $0.id == codexA })?.isPinned == false, "unpin reaches other projection")
    reload.togglePin(a.id)
    reload.search = "A"
    reload.movePinned(a.id, before: nil)
    reload.search = ""
    try check(reload.filteredSessions.map(\.id) == [b.id, a.id], "OS1 search cannot erase hidden pin rank")
    reload.nativeSearch = codexA
    reload.moveNativePin(codexA, before: codexB)
    reload.nativeSearch = ""
    try check(reload.filteredNativeSessions.map(\.id) == [codexA, codexB], "native search preserves hidden pin rank")
    var late = ConversationSession(title: "Late", workspace: "/tmp")
    late.draft = "late-draft"
    reload.sessions.append(late)
    reload.togglePin(late.id)
    let lateID = "00000000-0000-4000-8000-000000000005"
    reload.recordNativeSession(.codex, id: lateID, conversationID: late.id)
    reload.nativeSessions.append(contentsOf: rows(.codex, [lateID]))
    try check(reload.filteredNativeSessions.first?.id == lateID && reload.filteredNativeSessions.first?.isPinned == true, "late backend binding inherits existing pin")
    reload.recordNativeSession(.codex, id: lateID, conversationID: late.id)
    try check(reload.filteredNativeSessions.first?.id == lateID && reload.sessions.first(where: { $0.id == late.id })?.draft == "late-draft", "duplicate binding preserves order and draft")
    reload.recordNativeSession(.codex, id: "not-a-uuid", conversationID: late.id)
    try check(reload.sessions.first(where: { $0.id == late.id })?.codexSessionID == lateID, "invalid native binding rejected")
    var duplicate = ConversationSession(title: "Duplicate", workspace: "/tmp", codexSessionID: codexA)
    duplicate.draft = "duplicate-draft"
    reload.sessions.append(duplicate)
    let oldPin = reload.sessions.first(where: { $0.id == a.id })?.pinnedAt
    reload.toggleNativePin(codexA)
    try check(reload.sessions.first(where: { $0.id == a.id })?.pinnedAt == oldPin && reload.sidebarSyncNotice?.contains("여러 OS1") == true, "ambiguous owner cannot mutate arbitrary conversation")
    let external = SessionStore(storageRoot: root.appendingPathComponent("external"))
    external.sessions = [a, b]
    external.applySidebarSnapshot(.codex, pins: [codexA: NativePinState(pinned: false, position: nil), codexB: NativePinState(pinned: false, position: nil)])
    external.applySidebarSnapshot(.codex, pins: [codexA: NativePinState(pinned: true, position: 1), codexB: NativePinState(pinned: true, position: 0)])
    try check(external.filteredSessions.map(\.id) == [b.id, a.id] && external.sessions.allSatisfy { $0.pinnedAt != nil }, "external Codex pins and order flow into OS1")
    external.surface = .claude; external.nativeSessions = rows(.claude, [claudeA, claudeB])
    try check(external.filteredNativeSessions.map(\.id) == [claudeB, claudeA], "external Codex order reaches Claude local projection")
    external.applySidebarSnapshot(.claude, pins: [claudeA: NativePinState(pinned: false, position: nil), claudeB: NativePinState(pinned: false, position: nil)])
    try check(external.sessions.allSatisfy { $0.pinnedAt != nil }, "stale Claude metadata cannot undo pending local presentation")
    external.applySidebarSnapshot(.codex, pins: [codexA: NativePinState(pinned: false, position: nil), codexB: NativePinState(pinned: true, position: 0)])
    try check(external.sessions.first(where: { $0.id == a.id })?.pinnedAt == nil && external.filteredNativeSessions.first(where: { $0.id == claudeA })?.isPinned == false, "new external Codex unpin supersedes old Claude local intent")
    try check(SidebarOrder.moving("a", before: "b", in: ["a", "b"]) == ["a", "b"], "move idempotence")
    try check(SidebarOrder.moving("a", before: "missing", in: ["a", "b"]) == ["a", "b"], "unknown target rejected")
    try check(SidebarOrder.moving("a", before: nil, in: ["a", "b"]) == ["b", "a"], "append")
    try check(SidebarOrder.replacingSubset(["b", "a"], in: ["x", "a", "y", "b"]) == ["x", "b", "y", "a"], "preserve unrelated pins")
    try check(SidebarOrder.key(provider: "claude", id: codexA) != SidebarOrder.key(provider: "codex", id: codexA), "provider isolation")
    let same = rows(.codex, [codexB, codexA]).sorted(by: sidebarNativeLess)
    try check(same.map(\.id) == [codexA, codexB], "stable tie order")
    // Exact native metadata schema: current Codex uses sections, not legacy is_pinned.
    let dbRoot = root.appendingPathComponent(".codex")
    try FileManager.default.createDirectory(at: dbRoot, withIntermediateDirectories: true)
    var db: OpaquePointer?
    guard sqlite3_open(dbRoot.appendingPathComponent("state_5.sqlite").path, &db) == SQLITE_OK else { throw SourceContextError.invalid }
    let sql = "CREATE TABLE threads (id TEXT, archived INTEGER, thread_section_id TEXT, section_position INTEGER);" +
        "INSERT INTO threads VALUES ('a',0,'\(NativeSidebar.codexPinnedSection)',2),('b',0,'\(NativeSidebar.codexPinnedSection)',1),('c',1,'\(NativeSidebar.codexPinnedSection)',0),('d',0,NULL,NULL);"
    guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { sqlite3_close(db); throw SourceContextError.invalid }
    sqlite3_close(db)
    let snapshot = try NativeSidebar.read("codex", home: root)
    try check(snapshot["a"]?.pinned == true && snapshot["b"]?.position == 1 && snapshot["c"] == nil && snapshot["d"]?.pinned == false, "authoritative pin schema / archived exclusion")
    let claudeRoot = root.appendingPathComponent("Library/Application Support/Claude/claude-code-sessions")
    try FileManager.default.createDirectory(at: claudeRoot, withIntermediateDirectories: true)
    try JSONSerialization.data(withJSONObject: ["cliSessionId": claudeA, "isStarred": true])
        .write(to: claudeRoot.appendingPathComponent("local_fixture.json"))
    let claude = try NativeSidebar.read("claude", home: root)
    try check(claude[claudeA]?.pinned == true && claude[claudeA]?.position == nil, "Claude order remains unknown")
    let projects = root.appendingPathComponent("projects")
    try check(SidebarOrder.claudeConversationID(file: projects.appendingPathComponent("project/\(claudeA).jsonl"), projectsRoot: projects) == claudeA, "canonical Claude session")
    try check(SidebarOrder.claudeConversationID(file: projects.appendingPathComponent("project/\(claudeA)/subagents/agent-1.jsonl"), projectsRoot: projects) == nil, "child logs are not duplicate parent sessions")
    try check(SidebarOrder.claudeConversationID(file: projects.appendingPathComponent("project/backup/\(claudeA).jsonl"), projectsRoot: projects) == nil, "backups are not conversations")
    try check(SidebarOrder.claudeConversationID(file: root.appendingPathComponent("elsewhere/\(claudeA).jsonl"), projectsRoot: projects) == nil, "source boundary")
    print("Sidebar synchronization: \(checks) checks passed; model calls 0; live backend writes 0")
}

private struct RootView: View {
    @ObservedObject var store: SessionStore

    var body: some View {
        HStack(spacing: 0) {
            ProviderRail(store: store)
            Rectangle().fill(Theme.border).frame(width: 1)
            if store.surface == .auto {
                SessionSidebar(store: store)
                Rectangle().fill(Theme.border).frame(width: 1)
                ConversationView(store: store)
            } else {
                NativeSessionBrowser(store: store, provider: store.surface)
            }
        }
        .frame(minWidth: 1_100, maxWidth: .infinity, minHeight: 680, maxHeight: .infinity)
        .background(Theme.background)
        .ignoresSafeArea()
        .task {
            while !Task.isCancelled {
                await store.refreshSidebarMetadata()
                try? await Task.sleep(for: .seconds(3))
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification)) { _ in store.flushPendingState() }
        .alert("OS-1 CLODEX", isPresented: Binding(
            get: { store.alertMessage != nil },
            set: { if !$0 { store.alertMessage = nil } }
        )) {
            Button("OK", role: .cancel) { store.alertMessage = nil }
        } message: {
            Text(store.alertMessage ?? "")
        }
    }
}

private struct ProviderRail: View {
    @ObservedObject var store: SessionStore

    var body: some View {
        VStack(spacing: 22) {
            Button { store.showClodexHome() } label: {
                OmarAGILogo(size: 48)
            }
            .buttonStyle(.plain)
            .help("Clodex home")
            .accessibilityLabel("Clodex home")
            .padding(.bottom, 8)

            ForEach([ProviderChoice.codex, ProviderChoice.claude]) { provider in
                BackendStatus(
                    provider: provider,
                    selected: store.surface == provider,
                    active: store.selectedSession?.lastProvider == provider.rawValue,
                    linked: provider == .codex
                        ? store.selectedSession?.codexSessionID != nil
                        : store.selectedSession?.claudeSessionID != nil,
                    disabled: false
                ) { store.inspectBackend(provider) }
            }

            Spacer()

            VStack(spacing: 6) {
                Circle().fill(Theme.green).frame(width: 9, height: 9)
                    .shadow(color: Theme.green.opacity(0.85), radius: 6)
                Text("RCC\nGOVERNED")
                    .font(.system(size: 7, weight: .bold, design: .rounded))
                    .tracking(0.7)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Theme.muted)
            }
        }
        .padding(.vertical, 24)
        .frame(width: 78)
        .background(Color.black.opacity(0.74))
    }
}

private struct BackendStatus: View {
    let provider: ProviderChoice
    let selected: Bool
    let active: Bool
    let linked: Bool
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 9) {
                ProviderBrandIcon(provider: provider, size: 28)
                Text(provider == .claude ? "CLAUDE" : "CODEX")
                    .font(.system(size: 7, weight: .bold, design: .rounded))
                    .tracking(1.1)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                HStack(spacing: 3) {
                    Circle().fill(linked ? Theme.green : Theme.muted).frame(width: 4, height: 4)
                    Text(linked ? "OPEN" : "NO SESSION")
                        .font(.system(size: 5.5, weight: .bold, design: .rounded))
                        .lineLimit(1)
                        .minimumScaleFactor(0.65)
                }
            }
            .foregroundStyle(linked ? (selected ? Theme.text : provider.tint) : Theme.muted)
            .frame(width: 58, height: 80)
            .background(linked ? provider.tint.opacity(selected ? 0.13 : (active ? 0.08 : 0.025)) : Color.black.opacity(0.25))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                    .stroke(linked ? provider.tint.opacity(selected || active ? 0.75 : 0.25) : Theme.border, lineWidth: selected ? 1.3 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help(linked
            ? "Show this conversation's recorded \(provider.title) session inside Clodex"
            : "No \(provider.title) session is recorded for this Clodex conversation")
        .accessibilityLabel(provider == .claude ? "Claude Code backend" : "Codex backend")
    }
}

private struct NativeSessionBrowser: View {
    @ObservedObject var store: SessionStore
    let provider: ProviderChoice

    private var recordedSessionID: String? {
        store.linkedNativeSessionID(for: provider)
    }

    private var recordedSessionIsAvailable: Bool {
        guard let recordedSessionID else { return false }
        return store.nativeSessions.contains(where: { $0.id == recordedSessionID })
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    Text("OS-1").foregroundStyle(Theme.pink)
                    Text("CLODEX").foregroundStyle(Theme.text)
                }
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .tracking(2.1)
                .padding(.horizontal, 24)
                .padding(.top, 34)
                .padding(.bottom, 24)

                VStack(alignment: .leading, spacing: 5) {
                    Text(provider == .claude ? "CLAUDE CODE SESSIONS" : "CODEX SESSIONS")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(1.2)
                        .foregroundStyle(provider.tint)
                    HStack(spacing: 6) {
                        Circle().fill(recordedSessionIsAvailable ? Theme.green : Theme.muted).frame(width: 6, height: 6)
                        Text(recordedSessionID == nil
                            ? "THIS CONVERSATION · NO SESSION"
                            : (recordedSessionIsAvailable ? "CURRENT RECORD · AVAILABLE" : "CURRENT RECORD · NOT FOUND"))
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .foregroundStyle(Theme.muted)
                    }
                    Text("LOCAL RECORDS · \(store.nativeSessions.count) · PIN MANAGEMENT")
                        .font(.system(size: 8, weight: .medium, design: .rounded))
                        .foregroundStyle(Theme.muted)
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                    TextField("Search \(provider.title) sessions", text: $store.nativeSearch)
                        .textFieldStyle(.plain)
                    Button { store.refreshNativeSessions() } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.plain)
                    .help("Refresh local sessions")
                    .accessibilityLabel("Refresh backend sessions")
                }
                .padding(.horizontal, 16)
                .frame(height: 48)
                .background(Color.black.opacity(0.24))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                        .stroke(Theme.borderStrong)
                )
                .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                .padding(.horizontal, 20)
                .padding(.bottom, 16)

                if store.isLoadingNativeSessions && store.nativeSessions.isEmpty {
                    Spacer()
                    ProgressView("Synchronizing local sessions…")
                        .controlSize(.small)
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                    Spacer()
                } else if store.filteredNativeSessions.isEmpty {
                    Spacer()
                    Text("No local sessions found")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity)
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 6) {
                            ForEach(store.filteredNativeSessions) { session in
                                if session.id == store.filteredNativeSessions.first?.id && session.isPinned {
                                    Text("PINNED").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.muted)
                                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 13)
                                }
                                NativeSessionRow(
                                    session: session,
                                    selected: store.selectedNativeSessionID == session.id,
                                    current: store.linkedNativeSessionID(for: provider) == session.id,
                                    tint: provider.tint
                                ) { store.selectNativeSession(session.id) }
                                .contextMenu {
                                    Button(session.isPinned ? "고정 해제" : "상단에 고정") { store.toggleNativePin(session.id) }
                                    if session.isPinned {
                                        Button("핀 순서 위로") { store.shiftNativePin(session.id, down: false) }
                                        Button("핀 순서 아래로") { store.shiftNativePin(session.id, down: true) }
                                    }
                                    if provider == .codex, session.pinSyncNote != nil {
                                        Button("백엔드에 다시 반영") { store.retryNativePin(session.id) }
                                    }
                                }
                                .onDrag { NSItemProvider(object: "\(provider.rawValue):\(session.id)" as NSString) }
                                .onDrop(of: [UTType.plainText], isTargeted: nil) { items in
                                    acceptSidebarDrop(items, prefix: provider.rawValue) { id in
                                        guard store.surface == provider, session.isPinned else { return }
                                        store.moveNativePin(id, before: session.id)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 12)
                    }
                }
                if let notice = store.sidebarSyncNotice {
                    Text(notice).font(.system(size: 10)).foregroundStyle(Theme.pink)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                } else if provider == .claude {
                    Text("Claude 앱의 핀 표시를 읽습니다. 앱 간 핀 변경·수동 순서는 아직 동기화되지 않습니다.")
                        .font(.system(size: 10)).foregroundStyle(Theme.muted).padding(12)
                }
            }
            .frame(width: 315)
            .background(Color.black.opacity(0.72))

            Rectangle().fill(Theme.border).frame(width: 1)

            NativeTranscriptView(store: store, provider: provider)
        }
        .onChange(of: store.linkedNativeSessionID(for: provider)) { _ in
            if store.surface == provider { store.inspectBackend(provider) }
        }
        .onChange(of: store.isRunning) { running in
            if !running, store.isShowingLinkedNativeSession(provider) {
                store.refreshVisibleNativeTranscript(provider)
            }
        }
        .task(id: provider) {
            while !Task.isCancelled {
                try? await Task.sleep(for: backendInspectorRefreshInterval)
                guard !Task.isCancelled else { return }
                store.refreshActiveLinkedNativeTranscript(provider)
            }
        }
    }
}

private struct NativeSessionRow: View {
    let session: NativeSessionSummary
    let selected: Bool
    let current: Bool
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    if session.isPinned { Image(systemName: "pin.fill").font(.system(size: 10)).foregroundStyle(tint) }
                    Circle().fill(current ? Theme.green : (session.linkedTitle == nil ? Theme.muted : tint))
                        .frame(width: 6, height: 6)
                    Text(session.displayTitle)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(2)
                    Spacer(minLength: 4)
                    if current || session.linkedTitle != nil {
                        Text(current ? "CURRENT" : "OS1")
                            .font(.system(size: 7, weight: .bold, design: .rounded))
                            .foregroundStyle(current ? Theme.green : tint)
                    }
                }
                HStack(spacing: 6) {
                    Text(session.displayWorkspace)
                        .lineLimit(1)
                    Spacer()
                    Text(compactSessionAge(session.updatedAt))
                        .lineLimit(1)
                }
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(Theme.muted)
                if let note = session.pinSyncNote { Text(note).font(.system(size: 9)).foregroundStyle(Theme.pink) }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Theme.panelRaised : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .stroke(selected ? tint.opacity(0.42) : Color.clear, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(session.displayTitle)
    }
}

private struct NativeTranscriptView: View {
    @ObservedObject var store: SessionStore
    let provider: ProviderChoice

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("\(provider == .claude ? "CLAUDE CODE" : "CODEX") · \(store.selectedNativeSession?.displayTitle ?? "SELECT A SESSION")")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                Spacer()
                if let session = store.selectedNativeSession, !session.workspace.isEmpty {
                    Text(session.displayWorkspace)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
                if store.isShowingLinkedNativeSession(provider) {
                    Button {
                        if provider == .claude { store.openInClaudeDesktop() }
                        else { store.openInCodexDesktop() }
                    } label: {
                        Label("Native app에서 열기", systemImage: "arrow.up.forward.square")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(provider.tint)
                    .disabled(store.isRunning)
                    .help(store.isRunning
                        ? "The backend record is still being written; inspect it here until the run finishes"
                        : "Open this exact recorded session in its native app")
                }
                Circle().fill(Theme.green).frame(width: 8, height: 8)
                    .shadow(color: Theme.green.opacity(0.75), radius: 5)
                Text("RCC governed")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 24)
            .frame(height: 66)
            .background(Color.black.opacity(0.72))

            Rectangle().fill(Theme.border).frame(height: 1)

            if store.selectedNativeSession == nil {
                Spacer()
                VStack(spacing: 10) {
                    if let id = store.linkedNativeSessionID(for: provider) {
                        Text("Recorded \(provider.title) session is not available in the local index")
                            .font(.system(size: 13, weight: .semibold))
                        Text(String(id.prefix(8)) + "… · Refresh the local index, or browse another record without linking it.")
                            .font(.system(size: 11, weight: .medium))
                    } else {
                        Text("This conversation has no recorded \(provider.title) session")
                            .font(.system(size: 13, weight: .semibold))
                        Text("The task may have used OS-1 local control or the other backend. Its execution history remains in Clodex Home. Local records on the left are browse-only and are never linked automatically.")
                            .font(.system(size: 11, weight: .medium))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 540)
                    }
                }
                .foregroundStyle(Theme.muted)
                Spacer()
            } else if store.isLoadingNativeSessions && store.nativeMessages.isEmpty {
                Spacer()
                ProgressView("Loading synchronized transcript…")
                    .controlSize(.small)
                    .foregroundStyle(Theme.muted)
                Spacer()
            } else {
                ContinuousTranscriptView(
                    sessionID: transcriptStableID(store.selectedNativeSession?.id ?? provider.rawValue),
                    messages: store.nativeMessages.map { message in
                        ChatMessage(id: transcriptStableID(message.id), role: message.role,
                            text: message.text, provider: provider.rawValue, timestamp: message.timestamp ?? .distantPast)
                    },
                    queuedSubmissions: [], isRunning: false,
                    workspace: store.selectedNativeSession?.workspace ?? ""
                )
            }

            Rectangle().fill(Theme.border).frame(height: 1)
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath")
                Text(store.isShowingLinkedNativeSession(provider)
                    ? "READ-ONLY CURRENT BACKEND · USE CLODEX HOME TO ROUTE THE NEXT TASK"
                    : "READ-ONLY LOCAL BROWSE · THIS DOES NOT LINK OR ROUTE THE CONVERSATION")
                Spacer()
                Text(provider == .claude ? "CLAUDE CODE" : "CODEX")
                    .foregroundStyle(provider.tint)
            }
            .font(.system(size: 9, weight: .semibold, design: .rounded))
            .foregroundStyle(Theme.muted)
            .padding(.horizontal, 14)
            .frame(height: 38)
            .background(Color.black.opacity(0.72))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard let id = store.nativeMessages.last?.id else { return }
        DispatchQueue.main.async { proxy.scrollTo(id, anchor: .bottom) }
    }
}

private struct NativeMessageCard: View {
    let message: NativeSessionMessage
    let provider: ProviderChoice

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 100) }
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    if message.role == .user {
                        Image(systemName: "person.crop.circle.fill")
                    } else {
                        ProviderBrandIcon(provider: provider, size: 14, filled: false)
                    }
                    Text(message.role == .user ? "YOU" : (provider == .claude ? "CLAUDE CODE" : "CODEX"))
                    Spacer()
                    if let timestamp = message.timestamp {
                        Text(timestamp, style: .time)
                    }
                }
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .foregroundStyle(message.role == .user ? Theme.muted : provider.tint)
                Text(message.text)
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundStyle(Theme.text)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(16)
            .background(message.role == .user ? Color.black.opacity(0.5) : provider.tint.opacity(0.025))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusMessage, style: .continuous)
                    .stroke(message.role == .user ? Theme.borderStrong : provider.tint.opacity(0.18))
            )
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusMessage, style: .continuous))
            if message.role != .user { Spacer(minLength: 60) }
        }
    }
}

private struct RailButton: View {
    let provider: ProviderChoice
    let selected: Bool
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 7) {
                ProviderBrandIcon(provider: provider, size: 24)
                Text(provider.title.uppercased())
                    .font(.system(size: 8, weight: .bold, design: .rounded))
            }
            .foregroundStyle(selected ? provider.tint : Theme.muted)
            .frame(width: 58, height: 58)
            .background(selected ? provider.tint.opacity(0.12) : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(selected ? provider.tint : Theme.border, lineWidth: selected ? 1.5 : 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help("Use \(provider.title) for the next turn")
    }
}

@MainActor
private func acceptSidebarDrop(_ items: [NSItemProvider], prefix: String, action: @escaping @MainActor (String) -> Void) -> Bool {
    guard let first = items.first, first.canLoadObject(ofClass: NSString.self) else { return false }
    _ = first.loadObject(ofClass: NSString.self) { object, _ in
        guard let value = object as? String, value.hasPrefix(prefix + ":") else { return }
        let id = String(value.dropFirst(prefix.count + 1))
        guard UUID(uuidString: id) != nil else { return }
        Task { @MainActor in action(id) }
    }
    return true
}

private struct SessionSidebar: View {
    @ObservedObject var store: SessionStore
    @FocusState private var searching: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text("OS-1")
                    .foregroundStyle(Theme.pink)
                Text("CLODEX")
                    .foregroundStyle(Theme.text)
            }
            .font(.system(size: 16, weight: .bold, design: .rounded))
            .tracking(2.1)
            .padding(.horizontal, 24)
            .padding(.top, 34)
            .padding(.bottom, 24)

            Button { store.createSession() } label: {
                Label("New governed task", systemImage: "pencil")
                    .font(.system(size: 14, weight: .semibold))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .frame(height: 54)
                    .background(Color.black.opacity(0.24))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                            .stroke(Theme.borderStrong)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.muted)
                TextField("Search sessions", text: $store.search)
                    .textFieldStyle(.plain)
                    .focused($searching)
            }
            .padding(.horizontal, 16)
            .frame(height: 48)
            .background(Color.black.opacity(0.24))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                    .stroke(Theme.borderStrong)
            )
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
            .padding(.horizontal, 20)
            .padding(.top, 12)

            HStack {
                Text(store.showArchived ? "ARCHIVED" : "SESSIONS")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .tracking(1.2)
                    .foregroundStyle(Theme.muted)
                Spacer()
                Button { store.showArchived.toggle() } label: {
                    Image(systemName: store.showArchived ? "tray.full.fill" : "archivebox")
                }.buttonStyle(.plain).help(store.showArchived ? "현재 대화 보기" : "보관한 대화 보기")
                Text("\(store.filteredSessions.count)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.muted)
            }
            .padding(.horizontal, 25)
            .padding(.top, 24)
            .padding(.bottom, 12)

            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(store.filteredSessions) { session in
                        if session.id == store.filteredSessions.first?.id && session.pinnedAt != nil {
                            Text("PINNED").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.muted)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 13)
                        }
                        SessionRow(
                            session: session,
                            selected: store.selectedSessionID == session.id,
                            activity: store.activeRuns[session.id]?.activity,
                            queuedCount: store.queuedSubmissions.filter { $0.sessionID == session.id }.count
                        ) { store.select(session.id) }
                        .contextMenu {
                            Button(session.pinnedAt == nil ? "상단에 고정" : "고정 해제") { store.togglePin(session.id) }
                            if session.pinnedAt != nil {
                                Button("핀 순서 위로") { store.shiftPinned(session.id, down: false) }
                                Button("핀 순서 아래로") { store.shiftPinned(session.id, down: true) }
                            }
                            Button("이름 변경…") { store.promptRename(session.id) }
                            Button("대화 전체 복사") { store.copyConversation(session.id) }
                            Button("대화 내보내기…") { store.exportConversation(session.id) }
                            Button("완료된 대화에서 포크") { store.forkSession(session.id) }
                                .disabled(!store.canForkSession(session.id))
                            Divider()
                            Button(session.archived == true ? "보관 해제" : "보관") { store.setArchived(session.id, session.archived != true) }
                                .disabled(store.isSessionRunning(session.id) || store.queuedSubmissions.contains(where: { $0.sessionID == session.id }))
                        }
                        .onDrag { NSItemProvider(object: "os1:\(session.id.uuidString)" as NSString) }
                        .onDrop(of: [UTType.plainText], isTargeted: nil) { items in
                            acceptSidebarDrop(items, prefix: "os1") { id in
                                guard let id = UUID(uuidString: id), session.pinnedAt != nil else { return }
                                store.movePinned(id, before: session.id)
                            }
                        }
                    }
                }
                .padding(.horizontal, 20)
            }

            Spacer(minLength: 0)
            if let notice = store.sidebarSyncNotice {
                Text(notice).font(.system(size: 10)).foregroundStyle(Theme.pink).padding(12)
            }
        }
        .frame(width: 315)
        .background(Color.black.opacity(0.72))
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("os1.focusSearch"))) { _ in searching = true }
    }
}

private struct SessionRow: View {
    let session: ConversationSession
    let selected: Bool
    var activity: RuntimeActivity? = nil
    var queuedCount = 0
    var previewTime: Date? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(spacing: 7) {
                    if activity != nil { RunningSessionIndicator(previewTime: previewTime) }
                    if session.pinnedAt != nil { Image(systemName: "pin.fill").font(.system(size: 10)).foregroundStyle(Theme.pink) }
                    Text(session.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                HStack(spacing: 6) {
                    Text(activity?.label ?? URL(fileURLWithPath: session.workspace).lastPathComponent)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if queuedCount > 0 { Text("대기 \(queuedCount)").font(.system(size: 10)).foregroundStyle(Theme.pink) }
                }
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? Theme.panelRaised : Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .stroke(selected ? Theme.border.opacity(0.45) : Color.clear)
            )
            .clipShape(RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(.plain)
    }
}

private struct RunningSessionIndicator: View {
    var previewTime: Date? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.periodic(from: .now, by: reduceMotion ? 1 : 0.12)) { context in
            let time = (previewTime ?? context.date).timeIntervalSinceReferenceDate
            HStack(spacing: 2) {
                ForEach(0..<3) { index in
                    Capsule().fill(Theme.pink).frame(width: 2,
                        height: reduceMotion ? 7 : 3 + 9 * (0.5 + 0.5 * sin(time * 5 - Double(index))))
                }
            }.frame(width: 13, height: 14).accessibilityLabel("작업 실행 중")
        }
    }
}

private struct NativeBadge: View {
    let label: String
    let linked: Bool
    let tint: Color

    var body: some View {
        Text(label)
            .font(.system(size: 8, weight: .bold, design: .rounded))
            .foregroundStyle(linked ? tint : Theme.muted.opacity(0.55))
            .frame(width: 17, height: 15)
            .background(linked ? tint.opacity(0.13) : Color.white.opacity(0.025))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(linked ? tint.opacity(0.45) : Theme.border))
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

private struct ConversationView: View {
    @ObservedObject var store: SessionStore

    var body: some View {
        VStack(spacing: 0) {
            ConversationHeader(store: store)
            Rectangle().fill(Theme.border).frame(height: 1)
            if let session = store.selectedSession {
                if session.messages.isEmpty {
                    WelcomeView(store: store, session: session)
                } else {
                    MessageTimeline(
                        session: session,
                        isRunning: store.isSessionRunning(session.id),
                        queuedSubmissions: store.queuedSubmissions.filter { $0.sessionID == session.id },
                        publicProgress: store.activeRuns[session.id]?.activity.publicText
                    )
                }
                ComposerView(store: store, session: session)
            }
        }
        .background(Theme.background)
    }
}

private struct ConversationHeader: View {
    @ObservedObject var store: SessionStore

    private var providerLabel: String {
        let value: String
        if store.activeSessionID == store.selectedSessionID {
            value = store.pendingProvider?.rawValue ?? store.selectedSession?.lastProvider ?? "RCC"
        } else {
            value = store.selectedSession?.lastProvider ?? "RCC"
        }
        return providerDisplayName(value)
    }

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(providerLabel) · \(store.selectedSession?.title ?? "OS-1 CLODEX")")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let id = store.selectedSessionID, store.isSessionRunning(id) {
                        ProgressView().controlSize(.mini)
                    } else { Circle().fill(Theme.green).frame(width: 6, height: 6) }
                    Text(store.statusText)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Theme.muted)
                        .lineLimit(1)
                }
            }
            Spacer()

            if let session = store.selectedSession {
                Circle().fill(Theme.green).frame(width: 8, height: 8)
                    .shadow(color: Theme.green.opacity(0.75), radius: 5)
                Text("RCC governed")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.muted)

                Menu {
                    Button("Auto routing") { store.chooseProvider(.auto) }
                    Divider()
                    Menu("Codex capacity · \(session.effectiveCodexCapacity)%") {
                        ForEach([0, 10, 25, 50, 75, 100], id: \.self) { value in
                            Button("\(value)%") { store.setCapacity(.codex, value: value) }
                        }
                    }
                    Menu("Claude capacity · \(session.effectiveClaudeCapacity)%") {
                        ForEach([0, 10, 25, 50, 75, 100], id: \.self) { value in
                            Button("\(value)%") { store.setCapacity(.claude, value: value) }
                        }
                    }
                    Divider()
                    Button("Force Codex next turn") { store.chooseProvider(.codex) }
                    Button("Force Claude next turn") { store.chooseProvider(.claude) }
                    Divider()
                    Button("Inspect Codex backend") { store.inspectBackend(.codex) }
                        .disabled(session.codexSessionID == nil)
                    Button("Open in Codex Desktop") { store.openInCodexDesktop() }
                        .disabled(session.codexSessionID == nil)
                    Button("Inspect Claude backend") { store.inspectBackend(.claude) }
                        .disabled(session.claudeSessionID == nil)
                    Button("Open in Claude Desktop") { store.openInClaudeDesktop() }
                        .disabled(session.claudeSessionID == nil)
                } label: {
                    Label(
                        session.provider == .auto
                            ? "Auto mix · C\(session.effectiveCodexCapacity) A\(session.effectiveClaudeCapacity)"
                            : "Override · \(session.provider.title)",
                        systemImage: "slider.horizontal.3"
                    )
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(Theme.green)
                    .padding(.horizontal, 10)
                    .frame(height: 35)
                    .background(Color.black.opacity(0.3))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                            .stroke(Theme.border)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .disabled(store.isRunning)

                Menu {
                    Button(session.pinnedAt == nil ? "상단에 고정" : "고정 해제") { store.togglePin(session.id) }
                    Button("이름 변경…") { store.promptRename(session.id) }
                    Button("대화 전체 복사") { store.copyConversation(session.id) }
                    Button("대화 내보내기…") { store.exportConversation(session.id) }
                    Button("완료된 대화에서 포크") { store.forkSession(session.id) }
                        .disabled(!store.canForkSession(session.id))
                    if let origin = session.forkedFrom {
                        Button("원본 대화로 이동") { store.select(origin.conversationID) }
                            .disabled(!store.sessions.contains(where: { $0.id == origin.conversationID }))
                    }
                    Divider()
                    Button(session.archived == true ? "보관 해제" : "보관") { store.setArchived(session.id, session.archived != true) }
                        .disabled(store.isSessionRunning(session.id) || store.queuedSubmissions.contains(where: { $0.sessionID == session.id }))
                } label: { Image(systemName: "ellipsis").foregroundStyle(Theme.muted) }
                    .menuStyle(.borderlessButton).fixedSize().help("대화 관리")

                Button { store.chooseWorkspace() } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "folder")
                        Text(URL(fileURLWithPath: session.workspace).lastPathComponent)
                            .lineLimit(1)
                    }
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.text)
                    .padding(.horizontal, 11)
                    .frame(height: 35)
                    .background(Color.black.opacity(0.3))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                            .stroke(Theme.border)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                }
                .buttonStyle(.plain)
                .disabled(store.isRunning)
                .help(session.workspace)
            }
        }
        .padding(.horizontal, 24)
        .frame(height: 66)
        .background(Color.black.opacity(0.72))
    }
}

private struct WelcomeView: View {
    @ObservedObject var store: SessionStore
    let session: ConversationSession

    private let suggestions = [
        "Inspect this project and explain the safest next step.",
        "Find the current bug, fix it, and verify the result.",
        "Review the repository and make the smallest production-ready improvement.",
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Spacer(minLength: 34)
                HStack(spacing: 12) {
                    Image(systemName: "diamond")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(Theme.pink)
                        .frame(width: 34, height: 34)
                        .background(Theme.pinkDeep)
                        .clipShape(Circle())
                    Text("Routing, model execution, token control, and receipts stay on one governed path.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.muted)
                }
                Text("Start a governed task.")
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .foregroundStyle(Theme.text)
                Text("Choose the project once. RCC routes each turn to Codex or Claude Code with the model tier, reasoning effort, token budget, and workspace authority kept on the same governed path.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.white.opacity(0.62))
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 12) {
                    WelcomeStep(number: "1", title: "Choose folder", detail: "The project OS-1 may inspect or edit")
                    WelcomeStep(number: "2", title: "Set capacity", detail: "Default mix conserves scarce Codex usage")
                    WelcomeStep(number: "3", title: "Use OS-1", detail: "RCC selects backend, model, and effort")
                }

                VStack(alignment: .leading, spacing: 9) {
                    Text("TRY ONE")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(1.4)
                        .foregroundStyle(Theme.muted)
                    ForEach(suggestions, id: \.self) { suggestion in
                        Button { store.useSuggestion(suggestion) } label: {
                            HStack {
                                Text(suggestion)
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.text)
                                Spacer()
                                Image(systemName: "arrow.up.left")
                                    .font(.system(size: 10))
                                    .foregroundStyle(Theme.muted)
                            }
                            .padding(.horizontal, 14)
                            .frame(height: 46)
                            .background(Color.black.opacity(0.3))
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous)
                                    .stroke(Theme.border)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusControl, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                Spacer(minLength: 20)
            }
            .padding(.horizontal, 52)
            .frame(maxWidth: 850, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
    }
}

private struct WelcomeStep: View {
    let number: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(number)
                .font(.system(size: 10, weight: .bold, design: .monospaced))
                .foregroundStyle(Theme.green)
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.text)
            Text(detail)
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 108, alignment: .topLeading)
        .background(Color.black.opacity(0.3))
        .overlay(
            RoundedRectangle(cornerRadius: Theme.radiusPanel, style: .continuous)
                .stroke(Theme.border)
        )
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusPanel, style: .continuous))
    }
}

private extension NSAttributedString.Key {
    static let os1TimelineRole = NSAttributedString.Key("com.omaragi.os1.timeline-role")
}

private enum TimelinePalette {
    static let text = NSColor.white.withAlphaComponent(0.95)
    static let muted = NSColor.white.withAlphaComponent(0.47)
    static let borderStrong = NSColor.white.withAlphaComponent(0.22)
    static let panelRaised = NSColor(
        calibratedRed: 0.035,
        green: 0.029,
        blue: 0.034,
        alpha: 0.72
    )
    static let pink = NSColor(calibratedRed: 0.93, green: 0.70, blue: 0.80, alpha: 1)
    static let green = NSColor(calibratedRed: 0.28, green: 0.93, blue: 0.55, alpha: 1)
    static let codex = NSColor(calibratedRed: 0.95, green: 0.64, blue: 0.80, alpha: 1)
    static let claude = NSColor(calibratedRed: 0.98, green: 0.53, blue: 0.68, alpha: 1)
}

private func timelineNormalizedText(_ value: String) -> String {
    value
        .replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\r", with: "\n")
        // A line separator keeps one visual message in one TextKit paragraph.
        // ContinuousTranscriptTextView.copy converts it back to a regular LF.
        .replacingOccurrences(of: "\n", with: "\u{2028}")
}

private func retrievalPresentation(messages: [ChatMessage], index: Int, sourceStore: SourceContextStore) -> RetrievedAnswer? {
    let message = messages[index]
    guard message.role == .assistant, message.provider == "local",
          (message.text.hasPrefix("R2에서") || message.text.hasPrefix("등록 원본에서")),
          index + 1 < messages.count else { return nil }
    let receipt = messages[index + 1]
    guard receipt.role == .receipt, receipt.provider == "local", receipt.nativeRecordVerified == true,
          let match = receipt.text.range(of: #"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}\.json\b"#, options: .regularExpression),
          let id = UUID(uuidString: String(receipt.text[match].dropLast(5))),
          let reference = sourceStore.legacyReference(id: id, output: message.text),
          let data = try? sourceStore.read(reference),
          let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let sources = value["sources"] as? [[String: Any]] else { return nil }
    return RetrievedAnswer.fromEvidence(output: message.text, sourcePaths: sources.compactMap { $0["source_path"] as? String })
}

private func assistantDisplayText(messages: [ChatMessage], index: Int, expanded: Set<String>, expandAll: Bool,
                                  sourceStore: SourceContextStore) -> NSAttributedString {
    let message = messages[index], key = message.id.uuidString
    guard let answer = retrievalPresentation(messages: messages, index: index, sourceStore: sourceStore) else {
        return TranscriptMarkdown.render(message.text, key: key, expanded: expanded, expandAll: expandAll)
    }
    let content = NSMutableAttributedString(attributedString: TranscriptMarkdown.render(answer.overview, key: key))
    let request = messages[..<index].last(where: { $0.role == .user })?.text.lowercased() ?? ""
    let originalRequested = ["원문 그대로", "원문 전체", "전체 원문", "verbatim"].contains(where: request.contains)
    for (suffix, label, text, initiallyOpen) in [
        ("source", "자료 원문", answer.original, originalRequested),
        ("evidence", "출처·검증 정보", answer.technical, false),
    ] {
        let detailKey = "\(key)-\(suffix)"
        let open = expandAll || (initiallyOpen != expanded.contains(detailKey))
        content.append(NSAttributedString(string: "\u{2028}\u{2028}"))
        content.append(TranscriptMarkdown.detailLink("\(label) · \(open ? "접기" : "펼쳐보기")", key: detailKey))
        if open {
            content.append(NSAttributedString(string: "\u{2028}\u{2028}"))
            content.append(TranscriptMarkdown.render(text, key: detailKey, expanded: expanded, expandAll: expandAll))
        }
    }
    return content
}

private func timelineAttributedDocument(
    messages: [ChatMessage],
    queuedSubmissions: [PendingSubmission],
    isRunning: Bool,
    workspace: String,
    expanded: Set<String> = [],
    expandAll: Bool = false,
    sourceStore: SourceContextStore = SourceContextStore(),
    publicProgress: String? = nil
) -> NSAttributedString {
    let document = NSMutableAttributedString()

    func appendBlock(
        role: String,
        alignment: NSTextAlignment = .left,
        minimumHeadIndent: CGFloat = 0,
        components: [(String, NSFont, NSColor)],
        richContent: NSAttributedString? = nil
    ) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.headIndent = minimumHeadIndent
        paragraph.firstLineHeadIndent = minimumHeadIndent
        paragraph.lineSpacing = 3
        // Borders extend 12–13 points past glyphs on BOTH neighboring messages.
        // Reserve that paint in text layout, not only in draw(_:).
        paragraph.paragraphSpacing = 0
        let start = document.length
        for component in components {
            document.append(NSAttributedString(
                string: component.0,
                attributes: [
                    .font: component.1,
                    .foregroundColor: component.2,
                ]
            ))
        }
        if let richContent { document.append(richContent) }
        let contentRange = NSRange(location: start, length: document.length - start)
        // Do not erase Markdown paragraph styles or native table cell blocks.
        document.enumerateAttribute(.paragraphStyle, in: contentRange) { style, range, _ in
            if style == nil { document.addAttribute(.paragraphStyle, value: paragraph, range: range) }
        }
        document.addAttribute(.os1TimelineRole, value: role as NSString, range: contentRange)
        let endingStyle = document.string.hasSuffix("\n") ? paragraph
            : ((document.attribute(.paragraphStyle, at: max(start, document.length - 1), effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? paragraph)
        document.append(NSAttributedString(string: "\n", attributes: [
            .font: NSFont.systemFont(ofSize: 4),
            .paragraphStyle: endingStyle,
        ]))
        let lastParagraph = (document.string as NSString).paragraphRange(for: NSRange(location: document.length - 1, length: 1))
        let finalStyle = endingStyle.mutableCopy() as! NSMutableParagraphStyle
        finalStyle.paragraphSpacing = 40
        document.addAttribute(.paragraphStyle, value: finalStyle, range: lastParagraph)
    }

    for (index, message) in messages.enumerated() {
        switch message.role {
        case .user:
            appendBlock(
                role: MessageRole.user.rawValue,
                alignment: .right,
                minimumHeadIndent: 100,
                components: [(
                    timelineNormalizedText(message.text),
                    NSFont.systemFont(ofSize: 14, weight: .medium),
                    TimelinePalette.text
                )]
            )
        case .assistant:
            let provider = providerDisplayName(message.provider)
            let permission = message.permissionProfile.map {
                " · \($0.replacingOccurrences(of: "_", with: " "))"
            } ?? ""
            let providerColor = message.provider == "local"
                ? TimelinePalette.green
                : (message.provider == "claude" ? TimelinePalette.claude : TimelinePalette.codex)
            appendBlock(
                role: MessageRole.assistant.rawValue,
                components: [
                    ("◉  \(provider)\(permission)", NSFont.systemFont(ofSize: 10, weight: .bold), providerColor),
                    ("\n\n", NSFont.systemFont(ofSize: 6), TimelinePalette.muted),
                ],
                richContent: assistantDisplayText(messages: messages, index: index, expanded: expanded, expandAll: expandAll, sourceStore: sourceStore)
            )
        case .receipt:
            let key = "\(message.id.uuidString)-receipt"
            let show = expandAll || expanded.contains(key)
            let status = message.nativeRecordVerified == true ? "실행 기록 확인됨" : "실행 기록 미확인"
            let details = NSMutableAttributedString(attributedString: TranscriptMarkdown.detailLink(
                "\(status) · \(show ? "세부 정보 접기" : "세부 정보 보기")", key: key))
            if show {
                details.append(NSAttributedString(string: "\u{2028}백엔드 실행 기록의 확인 여부입니다. 답변의 정확성이나 과제 완수를 보증하지 않습니다.\u{2028}", attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: TimelinePalette.muted]))
                details.append(NSAttributedString(string: timelineNormalizedText(message.text), attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular), .foregroundColor: TimelinePalette.muted]))
            }
            appendBlock(
                role: MessageRole.receipt.rawValue,
                components: [], richContent: details
            )
        case .system:
            appendBlock(
                role: MessageRole.system.rawValue,
                components: [
                    ("◇  ", NSFont.systemFont(ofSize: 12, weight: .bold), TimelinePalette.pink),
                    (
                        timelineNormalizedText(message.text),
                        NSFont.systemFont(ofSize: 12, weight: .medium),
                        TimelinePalette.muted
                    ),
                ]
            )
        }
    }

    for submission in queuedSubmissions {
        appendBlock(
            role: "queued",
            alignment: .right,
            minimumHeadIndent: 100,
            components: [
                (
                    timelineNormalizedText(submission.request),
                    NSFont.systemFont(ofSize: 13, weight: .medium),
                    TimelinePalette.text.withAlphaComponent(0.72)
                ),
                (submission.amendedRequest == nil ? "\u{2028}QUEUED" : "\u{2028}정정 보존 · 현재 턴 전달 대기 / 불가 시 같은 목표로 이어가기",
                 NSFont.systemFont(ofSize: 9, weight: .bold), TimelinePalette.pink),
            ]
        )
    }

    if isRunning {
        if let publicProgress, !publicProgress.isEmpty {
            appendBlock(role: "assistant", components: [("진행 중 · 아직 검증되지 않은 출력\n\n", NSFont.systemFont(ofSize: 11), TimelinePalette.muted)],
                richContent: TranscriptMarkdown.render(publicProgress, key: "live-progress"))
        }
        let queued = queuedSubmissions.isEmpty ? "" : " · \(queuedSubmissions.count) queued"
        appendBlock(
            role: "running",
            components: [(
                "작업 진행 중 · \(timelineNormalizedText(workspace))\(queued)",
                NSFont.systemFont(ofSize: 12),
                TimelinePalette.muted
            )]
        )
    }

    return document.copy() as! NSAttributedString
}

private func completeTranscriptText(_ messages: [ChatMessage]) -> String {
    messages.map { message in
        let title = message.role == .user ? "USER" : message.role == .receipt ? "실행 기록 (정확성 보증 아님)" : providerDisplayName(message.provider)
        return "\(title)\n\(message.text)"
    }.joined(separator: "\n\n")
}

private final class TranscriptSnapshotSurface: NSView {
    override var isFlipped: Bool { true }
    override var isOpaque: Bool { true }
    override func draw(_ dirtyRect: NSRect) { NSColor.black.setFill(); dirtyRect.fill() }
}

private final class ContinuousTranscriptTextView: NSTextView {
    var completeTranscript = ""

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event) ?? NSMenu()
        menu.addItem(.separator())
        let item = NSMenuItem(title: "대화 전체 복사 (코드·실행 기록 포함)", action: #selector(copyCompleteTranscript), keyEquivalent: "")
        item.target = self
        menu.addItem(item)
        return menu
    }

    @objc func copyCompleteTranscript(_ sender: Any?) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(completeTranscript, forType: .string)
    }
    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        let centeredInset = max(40, ((newSize.width - 1_020) / 2) + 40)
        if abs(textContainerInset.width - centeredInset) > 0.5 {
            textContainerInset = NSSize(width: centeredInset, height: 34)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        drawMessageBackgrounds(in: dirtyRect)
        super.draw(dirtyRect)
    }

    override func copy(_ sender: Any?) {
        guard let selected = normalizedSelectedText() else {
            super.copy(sender)
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(selected, forType: .string)
    }

    func normalizedSelectedText() -> String? {
        let range = selectedRange()
        guard range.location != NSNotFound,
              range.length > 0,
              NSMaxRange(range) <= (string as NSString).length else { return nil }
        return MathTypesetter.copyable(attributedString().attributedSubstring(from: range))
    }

    func timelineFrames() -> [(role: String, content: NSRect, paint: NSRect)] {
        guard let textStorage,
              let layoutManager,
              let textContainer,
              textStorage.length > 0 else { return [] }
        var frames: [(role: String, content: NSRect, paint: NSRect)] = []
        layoutManager.ensureLayout(for: textContainer)
        let origin = textContainerOrigin
        let fullRange = NSRange(location: 0, length: textStorage.length)
        textStorage.enumerateAttribute(.os1TimelineRole, in: fullRange) { value, range, _ in
            guard let role = value as? String else { return }
            let glyphRange = layoutManager.glyphRange(
                forCharacterRange: range,
                actualCharacterRange: nil
            )
            var rect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)
            rect.origin.x += origin.x
            rect.origin.y += origin.y
            let contentRect = rect
            switch role {
            case MessageRole.user.rawValue:
                rect = rect.insetBy(dx: -18, dy: -13)
            case MessageRole.receipt.rawValue:
                rect.origin.x = origin.x
                rect.size.width = max(0, textContainer.size.width)
                rect = rect.insetBy(dx: -16, dy: -12)
            case "queued":
                rect = rect.insetBy(dx: -16, dy: -12)
            default:
                break
            }
            frames.append((role, contentRect, rect))
        }
        return frames
    }

    func tableFrames() -> [[String: Any]] {
        guard let textStorage, let layoutManager, let textContainer else { return [] }
        layoutManager.ensureLayout(for: textContainer)
        var cells: [[String: Any]] = []
        textStorage.enumerateAttribute(.paragraphStyle, in: NSRange(location: 0, length: textStorage.length)) { value, range, _ in
            guard let cell = (value as? NSParagraphStyle)?.textBlocks.first as? NSTextTableBlock else { return }
            let glyphs = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            let rect = layoutManager.boundsRect(for: cell, glyphRange: glyphs).offsetBy(dx: self.textContainerOrigin.x, dy: self.textContainerOrigin.y)
            cells.append(["row": cell.startingRow, "column": cell.startingColumn,
                "text": textStorage.attributedSubstring(from: range).string,
                "x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height])
        }
        return cells
    }

    private func drawMessageBackgrounds(in dirtyRect: NSRect) {
        for frame in timelineFrames() {
            switch frame.role {
            case MessageRole.user.rawValue:
                drawRoundedBackground(frame.paint, fill: NSColor.black.withAlphaComponent(0.28), stroke: TimelinePalette.borderStrong, dirtyRect: dirtyRect)
            case MessageRole.receipt.rawValue:
                drawRoundedBackground(frame.paint, fill: NSColor.black.withAlphaComponent(0.36), stroke: TimelinePalette.borderStrong, dirtyRect: dirtyRect)
            case "queued":
                drawRoundedBackground(frame.paint, fill: TimelinePalette.panelRaised, stroke: TimelinePalette.pink.withAlphaComponent(0.24), dirtyRect: dirtyRect)
            default: break
            }
        }
    }

    private func drawRoundedBackground(
        _ rect: NSRect,
        fill: NSColor,
        stroke: NSColor,
        dirtyRect: NSRect
    ) {
        guard rect.intersects(dirtyRect), rect.width > 0, rect.height > 0 else { return }
        let path = NSBezierPath(roundedRect: rect, xRadius: 16, yRadius: 16)
        fill.setFill()
        path.fill()
        stroke.setStroke()
        path.lineWidth = 1
        path.stroke()
    }
}

private struct TranscriptRenderInput: Equatable {
    let sessionID: UUID
    let messages: [ChatMessage]
    let queued: [PendingSubmission]
    let isRunning: Bool
    let workspace: String
    var publicProgress: String? = nil
}

private final class TranscriptClipView: NSClipView {
    override func scroll(to newOrigin: NSPoint) {
        super.scroll(to: newOrigin)
        // AppKit can otherwise reuse partial rows from a transparent table
        // during live scrolling. Invalidate the visible region, not the entire
        // transcript, and never alter the selection or text storage.
        documentView?.setNeedsDisplay(documentVisibleRect)
    }
}

private struct ContinuousTranscriptView: NSViewRepresentable {
    let sessionID: UUID
    let messages: [ChatMessage]
    let queuedSubmissions: [PendingSubmission]
    let isRunning: Bool
    let workspace: String
    var publicProgress: String? = nil

    final class Coordinator: NSObject, NSTextViewDelegate {
        var renderedSessionID: UUID?
        var hasRendered = false
        var expanded = Set<String>()
        var content: ContinuousTranscriptView?
        var lastInput: TranscriptRenderInput?

        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            guard let url = link as? URL, url.scheme == "os1-detail", let content else { return false }
            let key = url.lastPathComponent
            if expanded.contains(key) { expanded.remove(key) } else { expanded.insert(key) }
            let scroll = textView.enclosingScrollView
            let origin = scroll?.contentView.bounds.origin
            let document = timelineAttributedDocument(messages: content.messages, queuedSubmissions: content.queuedSubmissions,
                isRunning: content.isRunning, workspace: content.workspace, expanded: expanded, publicProgress: content.publicProgress)
            textView.textStorage?.setAttributedString(document)
            textView.needsDisplay = true
            if let origin { scroll?.contentView.scroll(to: origin) }
            return true
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.contentView = TranscriptClipView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder

        let textView = ContinuousTranscriptTextView(frame: scrollView.contentView.bounds)
        textView.delegate = context.coordinator
        textView.linkTextAttributes = [.foregroundColor: TimelinePalette.pink, .cursor: NSCursor.pointingHand]
        textView.drawsBackground = false
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = true
        textView.importsGraphics = false
        textView.allowsUndo = false
        textView.usesFindPanel = true
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.usesFontPanel = false
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.minSize = NSSize(width: 0, height: scrollView.contentSize.height)
        textView.maxSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.textContainerInset = NSSize(width: 40, height: 34)
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.layoutManager?.allowsNonContiguousLayout = false
        textView.textContainer?.containerSize = NSSize(
            width: scrollView.contentSize.width,
            height: CGFloat.greatestFiniteMagnitude
        )
        textView.setAccessibilityLabel("OS-1 conversation transcript")
        scrollView.documentView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? ContinuousTranscriptTextView else { return }
        let changingSession = context.coordinator.renderedSessionID != sessionID
        if changingSession { context.coordinator.expanded.removeAll() }
        context.coordinator.content = self
        let input = TranscriptRenderInput(sessionID: sessionID, messages: messages,
            queued: queuedSubmissions, isRunning: isRunning, workspace: workspace, publicProgress: publicProgress)
        // Math attachments have object identity. Comparing freshly rendered
        // attributed strings would rewrite the text storage on every keystroke.
        guard context.coordinator.lastInput != input else { return }
        context.coordinator.lastInput = input
        textView.completeTranscript = completeTranscriptText(messages)
        let document = timelineAttributedDocument(
            messages: messages,
            queuedSubmissions: queuedSubmissions,
            isRunning: isRunning,
            workspace: workspace,
            expanded: context.coordinator.expanded,
            publicProgress: publicProgress
        )
        guard !textView.attributedString().isEqual(to: document) else { return }

        let selection = textView.selectedRange()
        let distanceFromBottom = max(0, textView.bounds.height - scrollView.contentView.bounds.maxY)
        let shouldFollowBottom = !context.coordinator.hasRendered || changingSession || distanceFromBottom < 80
        textView.textStorage?.setAttributedString(document)
        textView.needsDisplay = true
        if !changingSession, selection.location != NSNotFound {
            let boundedLocation = min(selection.location, document.length)
            let boundedLength = min(selection.length, document.length - boundedLocation)
            textView.setSelectedRange(NSRange(location: boundedLocation, length: boundedLength))
        }
        context.coordinator.renderedSessionID = sessionID
        context.coordinator.hasRendered = true
        if shouldFollowBottom, selection.length == 0 {
            DispatchQueue.main.async {
                textView.scrollToEndOfDocument(nil)
            }
        }
    }
}

private struct MessageTimeline: View {
    let session: ConversationSession
    let isRunning: Bool
    let queuedSubmissions: [PendingSubmission]
    var publicProgress: String? = nil

    var body: some View {
        ContinuousTranscriptView(
            sessionID: session.id,
            messages: presentedMessages(session),
            queuedSubmissions: queuedSubmissions,
            isRunning: isRunning,
            workspace: session.workspace,
            publicProgress: publicProgress
        )
    }
}

/// Keeps SwiftUI's native focus, accessibility, undo, and IME behavior while
/// applying Codex's Return-to-send convention only to the focused composer.
@MainActor
private final class ComposerKeyMonitor: ObservableObject {
    var isFocused = false
    var submit: (() -> Void)?
    var cancelVoice: (() -> Bool)?
    private var eventMonitor: Any?

    func start() {
        guard eventMonitor == nil else { return }
        eventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.isFocused else { return event }
            // A queue editor is a separate sheet. Return there edits text and
            // must never submit the unrelated main composer behind the sheet.
            guard NSApp.keyWindow?.sheetParent == nil, NSApp.modalWindow == nil else { return event }
            if event.keyCode == 53, self.cancelVoice?() == true {
                return nil
            }
            let isReturn = event.keyCode == 36 || event.keyCode == 76
            guard isReturn,
                  composerReturnAction(shiftPressed: event.modifierFlags.contains(.shift)) == .send else {
                return event
            }
            if let textView = NSApp.keyWindow?.firstResponder as? NSTextView,
               textView.hasMarkedText() {
                return event
            }
            self.submit?()
            return nil
        }
    }

    func stop() {
        if let eventMonitor { NSEvent.removeMonitor(eventMonitor) }
        eventMonitor = nil
    }

}

private struct ClodexComposerEditor: View {
    @Binding var text: String
    let onSubmit: () -> Void
    let onCancelVoice: () -> Bool
    @StateObject private var keyMonitor = ComposerKeyMonitor()
    @FocusState private var isFocused: Bool

    var body: some View {
        TextEditor(text: $text)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(Theme.text)
            .scrollContentBackground(.hidden)
            .focused($isFocused)
            .onAppear {
                keyMonitor.submit = onSubmit
                keyMonitor.cancelVoice = onCancelVoice
                isFocused = true
                keyMonitor.isFocused = true
                keyMonitor.start()
            }
            .onChange(of: isFocused) { focused in
                keyMonitor.isFocused = focused
            }
            .onDisappear {
                keyMonitor.isFocused = false
                keyMonitor.stop()
            }
    }
}

private struct VoiceWaveform: View {
    let level: CGFloat

    private let weights: [CGFloat] = [0.44, 0.72, 1, 0.62, 0.86]

    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(Array(weights.enumerated()), id: \.offset) { _, weight in
                Capsule()
                    .fill(Theme.pink)
                    .frame(width: 3, height: 6 + (max(0.12, level) * 17 * weight))
            }
        }
        .frame(width: 28, height: 28)
        .animation(.easeOut(duration: 0.09), value: level)
        .accessibilityHidden(true)
    }
}

private struct VoiceDictationControl: View {
    @ObservedObject var controller: VoiceDictationController
    let start: () -> Void
    let finish: () -> Void
    let cancel: () -> Void

    var body: some View {
        Group {
            if controller.isActive {
                HStack(spacing: 6) {
                    Button(action: cancel) {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .bold))
                            .frame(width: 30, height: 30)
                            .foregroundStyle(Theme.muted)
                    }
                    .buttonStyle(.plain)
                    .help("Cancel and restore the previous text (Esc)")
                    .accessibilityLabel("Cancel voice input")

                    if controller.isAuthorizing || controller.isFinalizing {
                        ProgressView()
                            .controlSize(.small)
                            .tint(Theme.pink)
                            .frame(width: 28, height: 28)
                    } else {
                        VoiceWaveform(level: controller.level)
                    }

                    VStack(alignment: .leading, spacing: 1) {
                        Text(controller.statusLabel)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Theme.text)
                        Text("\(controller.engineLabel) · \(controller.elapsedLabel)")
                            .font(.system(size: 9, weight: .medium, design: .rounded))
                            .foregroundStyle(Theme.muted)
                            .fixedSize()
                    }
                    .frame(minWidth: 52, alignment: .leading)

                    Button(action: finish) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.black.opacity(0.86))
                            .frame(width: 32, height: 32)
                            .background(Theme.pink)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(controller.isFinalizing)
                    .help("Use this transcript")
                    .accessibilityLabel("Finish voice input")
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 5)
                .background(Theme.panelRaised)
                .overlay(
                    Capsule().stroke(Theme.pink.opacity(0.56), lineWidth: 1)
                )
                .clipShape(Capsule())
                .transition(.opacity.combined(with: .scale(scale: 0.94)))
            } else {
                Button(action: start) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .frame(width: 44, height: 44)
                        .background(Theme.panelRaised)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(Theme.borderStrong))
                }
                .buttonStyle(.plain)
                .help("Dictate task (⌘⇧Space)")
                .accessibilityLabel("Start voice input")
            }
        }
        .animation(.easeInOut(duration: 0.16), value: controller.isActive)
    }
}

private struct RunActivityBanner: View {
    let activity: RuntimeActivity
    let started: Date
    var previewTime: Date? = nil
    var stopping = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.periodic(from: .now, by: reduceMotion ? 1 : 0.12)) { context in
            let now = previewTime ?? context.date
            let seconds = max(0, Int(now.timeIntervalSince(started)))
            let quiet = max(0, Int(now.timeIntervalSince(activity.timestamp)))
            HStack(spacing: 12) {
                HStack(alignment: .center, spacing: 3) {
                    ForEach(0..<4) { index in
                        Capsule().fill(Theme.pink)
                            .frame(width: 3, height: reduceMotion ? 8 : 5 + 12 * (0.5 + 0.5 * sin(now.timeIntervalSinceReferenceDate * 5 - Double(index))))
                    }
                }.frame(width: 24, height: 20).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(stopping ? "작업 중지 확인 중" : activity.label).font(.system(size: 12, weight: .semibold))
                        if let model = activity.model { Text(model).font(.system(size: 10)).foregroundStyle(Theme.muted) }
                        if let effort = activity.effort { Text(effort).font(.system(size: 10)).foregroundStyle(Theme.muted) }
                        if let tool = activity.tool { Text(tool).font(.system(size: 10)).foregroundStyle(Theme.muted) }
                    }
                    if quiet >= 30 {
                        Text("마지막 단계 업데이트 \(quiet)초 전 · 실행은 열려 있지만 새 진행 신호를 기다리고 있습니다.")
                            .font(.system(size: 10)).foregroundStyle(Theme.muted)
                    }
                }
                Spacer()
                Text("\(seconds / 60):\(String(format: "%02d", seconds % 60)) 경과")
                    .font(.system(size: 11, design: .monospaced)).foregroundStyle(Theme.muted)
            }
            .foregroundStyle(Theme.text).padding(.horizontal, 8).padding(.vertical, 5)
            .accessibilityElement(children: .combine)
        }
    }
}

private struct QueueEditSheet: View {
    @ObservedObject var store: SessionStore
    let submission: PendingSubmission
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    init(store: SessionStore, submission: PendingSubmission) {
        self.store = store; self.submission = submission
        _text = State(initialValue: submission.request)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("대기 요청 편집").font(.headline)
            Text("대기 순서와 입력 중인 초안은 그대로 유지됩니다. 현재 작업은 중단하지 않습니다.")
                .font(.caption).foregroundStyle(Theme.muted)
            TextEditor(text: $text).font(.body).frame(minWidth: 440, minHeight: 140)
                .accessibilityLabel("대기 요청 내용")
            HStack {
                Spacer()
                Button("취소") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("대기열에 저장") {
                    if store.updateQueued(submission.id, request: text) { dismiss() }
                }.keyboardShortcut(.defaultAction)
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }.padding(20)
    }
}

private struct ConversationQueueView: View {
    @ObservedObject var store: SessionStore
    let session: ConversationSession
    @State private var editing: PendingSubmission?
    @State private var editLease: UUID?
    private var items: [PendingSubmission] { store.queuedSubmissions.filter { $0.sessionID == session.id } }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(session.queuePaused == true ? "대기열 멈춤 · \(items.count)" : "대기 중 · \(items.count)")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.muted)
                Spacer()
                Menu {
                    if store.canResumeQueue(session.id) {
                        Button("대기열 계속 실행") { store.resumeQueue(session.id) }
                    } else if session.queuePaused != true {
                        Button("대기열 일시정지") { store.pauseQueue(session.id) }
                    }
                    Text(store.queueReason(session.id))
                } label: { Image(systemName: "ellipsis").frame(width: 26, height: 22) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .help(store.queueReason(session.id)).accessibilityLabel("대기열 옵션")
            }
            if store.activeRuns[session.id]?.cancellationRequested == true || session.lastFailure != nil {
                Text(store.activeRuns[session.id]?.cancellationRequested == true
                    ? "실행이 끝나는 대로 선택한 요청을 시작합니다"
                    : "이전 작업은 보존됐습니다. 새 요청은 오른쪽 화살표로 시작하세요.")
                    .font(.system(size: 11)).foregroundStyle(Theme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ScrollView {
                VStack(spacing: 2) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { rank, item in
                        HStack(alignment: .center, spacing: 6) {
                            Text(item.request).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                                .help(item.request)
                            Button { store.advanceQueued(item.id) } label: {
                                Image(systemName: "arrow.up").frame(width: 26, height: 26)
                            }.buttonStyle(.plain)
                                .disabled(!store.canSteerQueued(item) && !store.canAdvanceQueued(item))
                                .help(store.queueActionLabel(item))
                                .accessibilityLabel("대기 요청 \(rank + 1) · \(store.queueActionLabel(item))")
                                .accessibilityIdentifier("os1.queue.steer.\(item.id)")
                            Button {
                                if store.beginQueueEdit(item.id) { editLease = item.id; editing = item }
                            } label: { Image(systemName: "pencil").frame(width: 26, height: 26) }
                                .buttonStyle(.plain).help("대기 요청 편집 · 순서 유지")
                                .accessibilityLabel("대기 요청 \(rank + 1) 편집")
                            Button { store.removeQueued(item.id) } label: { Image(systemName: "xmark").frame(width: 26, height: 26) }
                                .buttonStyle(.plain).help("이 대기 요청만 취소").accessibilityLabel("대기 요청 \(rank + 1) 취소")
                        }.font(.system(size: 12)).padding(.horizontal, 6).padding(.vertical, 4)
                            .contentShape(Rectangle())
                            .contextMenu {
                                Button("위로 이동") { store.shiftQueued(item.id, down: false) }.disabled(rank == 0)
                                Button("아래로 이동") { store.shiftQueued(item.id, down: true) }.disabled(rank == items.count - 1)
                                Button("다음 차례로 이동") { store.prioritizeQueued(item.id) }.disabled(rank == 0)
                                Button("입력창으로 가져오기") { store.editQueued(item.id) }
                                    .disabled(!store.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                            .onDrag { NSItemProvider(object: "os1-queue:\(item.id.uuidString)" as NSString) }
                            .onDrop(of: [UTType.plainText], isTargeted: nil) { providers in
                                acceptSidebarDrop(providers, prefix: "os1-queue") { value in
                                    if let id = UUID(uuidString: value) { store.moveQueued(id, before: item.id) }
                                }
                            }
                    }
                }
            }.frame(height: min(132, CGFloat(items.count) * 42))
        }.padding(.horizontal, 10).padding(.vertical, 6).foregroundStyle(Theme.text)
            .background(Theme.panel, in: RoundedRectangle(cornerRadius: 12))
            .sheet(item: $editing, onDismiss: {
                if let id = editLease { store.endQueueEdit(id) }; editLease = nil
            }) { item in QueueEditSheet(store: store, submission: item) }
            .onDisappear { if let id = editLease { store.endQueueEdit(id) }; editLease = nil }
    }
}

private struct ComposerPrimaryButton: View {
    let action: ComposerPrimaryAction
    let activate: () -> Void
    var body: some View {
        Button(action: activate) {
            Image(systemName: action.icon)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color.black.opacity(0.86))
                .frame(width: 44, height: 44)
                .background(Theme.pink.opacity(action.enabled ? 1 : 0.45))
                .clipShape(Circle())
        }
        .buttonStyle(.plain).disabled(!action.enabled)
        .help(action.help).accessibilityLabel(action.label)
        .accessibilityIdentifier("os1.composer.primary")
    }
}

private struct ComposerView: View {
    @ObservedObject var store: SessionStore
    @ObservedObject private var dictation: VoiceDictationController
    let session: ConversationSession

    init(store: SessionStore, session: ConversationSession) {
        self.store = store
        self.dictation = store.voiceDictation
        self.session = session
    }

    var body: some View {
        VStack(spacing: 10) {
            if store.isSessionRunning(session.id), let started = store.runStartedAt {
                RunActivityBanner(activity: store.activeActivity, started: started, stopping: store.isStopping)
            }
            if !store.isSessionRunning(session.id), session.lastFailure != nil {
                if let failure = session.lastBackendFailure {
                    Text(failure.blocker.message)
                        .font(.system(size: 12)).foregroundStyle(Theme.muted)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
                Button(session.lastFailure?.savedResultNeedsReview == true ? "저장된 결과·현재 상태 검토 · 변경 재실행 없음" : session.lastFailure?.deliveryID != nil ? "저장된 결과 전달 · 모델 재실행 없음" : session.lastBackendFailure?.requiresReadback == true
                    ? "현재 상태 확인 · 재실행하지 않음" : "OS-1에서 다시 확인하고 시도") { store.retrySelectedFailure() }
                    .font(.system(size: 12, weight: .medium))
                    .disabled(store.activeRuns.count >= SessionStore.maximumConcurrentSessions)
            }
            if store.selectedSessionQueueCount > 0 || session.queuePaused == true {
                ConversationQueueView(store: store, session: session)
            }
            if store.isRunning {
                TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                    if let label = store.correctionDeliveryLabel {
                        Text(label).font(.system(size: 12)).foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity, alignment: .leading).textSelection(.enabled)
                    }
                }
            }
            HStack(alignment: .bottom, spacing: 12) {
                ClodexComposerEditor(
                    text: $store.composer,
                    onSubmit: store.send,
                    onCancelVoice: store.cancelVoiceDictation
                )
                    .frame(minHeight: 70, maxHeight: 130)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .overlay(alignment: .topLeading) {
                        if store.composer.isEmpty {
                            Text(store.isRunning ? "추가 지시를 입력하세요…" : "OS-1에 작업을 요청하세요…")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.3))
                                .padding(.horizontal, 13)
                                .padding(.vertical, 14)
                                .allowsHitTesting(false)
                        }
                    }

                VoiceDictationControl(
                    controller: store.voiceDictation,
                    start: store.toggleVoiceDictation,
                    finish: store.finishVoiceDictation,
                    cancel: { _ = store.cancelVoiceDictation() }
                )

                if store.isRunning, !store.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Button { store.sendCorrectionToCurrentRun() } label: {
                        Image(systemName: "arrow.turn.up.right").font(.system(size: 14)).frame(width: 30, height: 36)
                    }.buttonStyle(.plain).disabled(store.isStopping)
                        .help(store.canSteerSelectedRun ? "현재 작업에 반영" : "현재 작업을 중지하고 추가 지시로 이어가기")
                        .accessibilityLabel(store.canSteerSelectedRun ? "현재 작업에 반영" : "중지 후 추가 지시로 이어가기")
                        .accessibilityIdentifier("os1.composer.steer")
                }

                ComposerPrimaryButton(action: store.primaryAction) { store.performPrimaryAction() }
                    .contextMenu {
                        Button(store.canSteerSelectedRun ? "현재 작업에 반영" : "중지 후 추가 지시로 이어가기") { store.sendCorrectionToCurrentRun() }
                            .disabled(!store.isRunning || store.isStopping || store.composer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Button("현재 작업 중지 · ⌘.") { store.cancelSelectedRun() }
                            .disabled(!store.isRunning || store.isStopping)
                    }
            }
            .padding(12)
            .background(Color.black.opacity(0.5))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.radiusComposer, style: .continuous)
                    .stroke(Theme.borderStrong)
            )
            .clipShape(RoundedRectangle(cornerRadius: Theme.radiusComposer, style: .continuous))
            .shadow(color: Color.black.opacity(0.32), radius: 16, y: 8)

            HStack {
                Label(URL(fileURLWithPath: session.workspace).lastPathComponent, systemImage: "folder")
                Text("·")
                Text("OS-1 · RCC governed")
                Text("·")
                Text("capacity C\(session.effectiveCodexCapacity) / A\(session.effectiveClaudeCapacity)")
                Text("·")
                Text("Codex \(session.codexSessionID == nil ? "not linked" : "linked")")
                Text("·")
                Text("Claude \(session.claudeSessionID == nil ? "not linked" : "linked")")
                if let source = session.sourceContext {
                    Text("·")
                    Label("Source attached", systemImage: "paperclip")
                        .foregroundStyle(Theme.pink)
                        .help("이 대화의 다음 요청에 같은 검증 자료를 전달합니다. 새 주제로 바꾸려면 ‘자료 연결 해제’라고 요청하세요. SHA-256: \(source.sha256)")
                }
                if store.selectedSessionQueueCount > 0 {
                    Text("·")
                    Label("\(store.selectedSessionQueueCount) queued", systemImage: "text.line.last.and.arrowtriangle.forward")
                        .foregroundStyle(Theme.pink)
                }
                if store.voiceDictation.isActive {
                    Text("·")
                    Label(
                        "\(store.voiceDictation.statusLabel) · \(store.voiceDictation.engineLabel) · \(store.voiceDictation.elapsedLabel)",
                        systemImage: "waveform"
                    )
                        .foregroundStyle(Theme.pink)
                }
                Spacer()
                Text(store.isRunning ? "↩ 대기열에 추가 · ⇧↩ 줄바꿈" : "⌘⇧Space 음성 · ↩ 보내기 · ⇧↩ 줄바꿈")
            }
            .font(.system(size: 9, weight: .medium, design: .rounded))
            .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 38)
        .padding(.top, 12)
        .padding(.bottom, 18)
        .background(Theme.background)
        .onDisappear { store.stopVoiceDictation() }
    }
}
