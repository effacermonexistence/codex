import Foundation
import OS1Context

private final class LockedFailureCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0

    func increment() {
        lock.lock(); defer { lock.unlock() }
        value += 1
    }

    var count: Int {
        lock.lock(); defer { lock.unlock() }
        return value
    }
}

func runCompletionFeedbackFixtures() throws {
    let claude = Data("""
    {"type":"assistant","uuid":"u1","message":{"id":"m1","content":"ignored","usage":{"input_tokens":2,"output_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":20}}}
    {"type":"assistant","uuid":"duplicate","message":{"id":"m1","usage":{"input_tokens":999,"output_tokens":999,"cache_creation_input_tokens":999,"cache_read_input_tokens":999}}}
    {"type":"user","message":{"content":"input_tokens: 999999"}}
    {"type":"assistant","uuid":"u2","message":{"id":"m2","usage":{"input_tokens":3,"output_tokens":7,"cache_creation_input_tokens":0,"cache_read_input_tokens":30}}}
    """.utf8)
    let claudeUsage = CompletionUsageParser.parse(claude, format: .claudeJSONL)
    precondition(claudeUsage?.inputTokens == 155)
    precondition(claudeUsage?.outputTokens == 17)
    precondition(claudeUsage?.cacheTokens == 150)
    precondition(claudeUsage?.resource.usageRecordCount == 2)

    let claudeResult = Data("""
    {"type":"result","result":"ignored","usage":{"input_tokens":2,"output_tokens":9,"cache_creation_input_tokens":40,"cache_read_input_tokens":8}}
    """.utf8)
    let resultUsage = CompletionUsageParser.parseClaudeResult(claudeResult)
    precondition(resultUsage?.inputTokens == 50)
    precondition(resultUsage?.outputTokens == 9)
    precondition(resultUsage?.cacheTokens == 48)
    precondition(resultUsage?.resource.format == .claudeResultJSON)

    let unknown = Data("""
    {"type":"assistant","message":{"id":"m3","usage":{"input_tokens":2,"output_tokens":5,"cache_creation_input_tokens":4}}}
    """.utf8)
    let unknownUsage = CompletionUsageParser.parse(unknown, format: .claudeJSONL)
    precondition(unknownUsage?.inputTokens == nil)
    precondition(unknownUsage?.outputTokens == 5)
    precondition(unknownUsage?.cacheTokens == nil)
    precondition(CompletionUsageParser.parse(Data("{\"type\":\"user\"}".utf8), format: .claudeJSONL) == nil)

    let codex = Data("""
    {"type":"event_msg","payload":{"type":"task_started","turn_id":"t1"}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"cache_write_input_tokens":3,"output_tokens":11},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"cache_write_input_tokens":3,"output_tokens":11}},"content":"ignored"}}
    {"type":"response_item","payload":{"type":"message","content":"never inspect me"}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":250,"cached_input_tokens":50,"cache_write_input_tokens":7,"output_tokens":18},"last_token_usage":{"input_tokens":150,"cached_input_tokens":30,"cache_write_input_tokens":4,"output_tokens":7}}}}
    {"type":"event_msg","payload":{"type":"task_complete","turn_id":"t1"}}
    {"type":"event_msg","payload":{"type":"task_started","turn_id":"t2"}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"cached_input_tokens":60,"cache_write_input_tokens":7,"output_tokens":25},"last_token_usage":{"input_tokens":50,"cached_input_tokens":10,"cache_write_input_tokens":0,"output_tokens":7}}}}
    {"type":"event_msg","payload":{"type":"task_complete","turn_id":"t2"}}
    """.utf8)
    let codexUsage = CompletionUsageParser.parse(codex, format: .codexRolloutJSONL)
    precondition(codexUsage?.inputTokens == 300)
    precondition(codexUsage?.outputTokens == 25)
    precondition(codexUsage?.cacheTokens == 67)
    precondition(codexUsage?.resource.usageRecordCount == 3)
    let firstTurnUsage = CompletionUsageParser.parseCodexJSONL(codex, turnID: "t1")
    precondition(firstTurnUsage?.inputTokens == 250)
    precondition(firstTurnUsage?.outputTokens == 18)
    precondition(firstTurnUsage?.cacheTokens == 57)
    precondition(firstTurnUsage?.resource.usageRecordCount == 2)
    let secondTurnUsage = CompletionUsageParser.parseCodexJSONL(codex, turnID: "t2")
    precondition(secondTurnUsage?.inputTokens == 50)
    precondition(secondTurnUsage?.outputTokens == 7)
    precondition(secondTurnUsage?.cacheTokens == 10)

    // Current native Codex emits both cumulative explicit usage and mirrored
    // token_count updates. These are two representations, not extra calls.
    let mixedCodex = Data("""
    {"type":"event_msg","payload":{"type":"task_started","turn_id":"mixed-1"}}
    {"type":"token_usage_record","payload":{"turn_id":"mixed-1","response_id":"r1","turn_token_usage":{"input_tokens":100,"cached_input_tokens":20,"cache_write_input_tokens":0,"output_tokens":11}}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100},"last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"cache_write_input_tokens":0,"output_tokens":11}}}}
    {"type":"token_usage_record","payload":{"turn_id":"mixed-1","response_id":"r2","turn_token_usage":{"input_tokens":250,"cached_input_tokens":50,"cache_write_input_tokens":0,"output_tokens":18}}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":250},"last_token_usage":{"input_tokens":150,"cached_input_tokens":30,"cache_write_input_tokens":0,"output_tokens":7}}}}
    {"type":"event_msg","payload":{"type":"task_complete","turn_id":"mixed-1"}}
    {"type":"event_msg","payload":{"type":"task_started","turn_id":"mixed-2"}}
    {"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300},"last_token_usage":{"input_tokens":50,"cached_input_tokens":10,"cache_write_input_tokens":0,"output_tokens":7}}}}
    {"type":"event_msg","payload":{"type":"task_complete","turn_id":"mixed-2"}}
    """.utf8)
    let mixedFirst = CompletionUsageParser.parseCodexJSONL(mixedCodex, turnID: "mixed-1")
    precondition(mixedFirst?.inputTokens == 250, "mirrored Codex usage must not be added to cumulative usage")
    precondition(mixedFirst?.outputTokens == 18 && mixedFirst?.cacheTokens == 50)
    precondition(mixedFirst?.resource.usageRecordCount == 1)
    let mixedAll = CompletionUsageParser.parseCodexJSONL(mixedCodex, turnID: nil)
    precondition(mixedAll?.inputTokens == 300 && mixedAll?.outputTokens == 25)
    precondition(mixedAll?.cacheTokens == 60 && mixedAll?.resource.usageRecordCount == 2)
    precondition(CompletionUsageParser.parseCodexJSONL(mixedCodex, turnID: "missing") == nil)

    let explicitResponses = Data("""
    {"type":"token_usage_record","payload":{"turn_id":"t","response_id":"a","usage":{"input_tokens":100,"cached_input_tokens":5,"cache_write_input_tokens":0,"output_tokens":10}}}
    {"type":"token_usage_record","payload":{"turn_id":"t","response_id":"a","usage":{"input_tokens":100,"cached_input_tokens":5,"cache_write_input_tokens":0,"output_tokens":10}}}
    {"type":"token_usage_record","payload":{"turn_id":"t","response_id":"b","usage":{"input_tokens":150,"cached_input_tokens":10,"cache_write_input_tokens":0,"output_tokens":20}}}
    """.utf8)
    let responseUsage = CompletionUsageParser.parseCodexJSONL(explicitResponses, turnID: "t")
    precondition(responseUsage?.inputTokens == 250 && responseUsage?.outputTokens == 30)
    precondition(responseUsage?.resource.usageRecordCount == 2)

    let duplicateEvents = Data("""
    {"timestamp":"a","type":"event_msg","payload":{"type":"task_started","turn_id":"t"}}
    {"timestamp":"b","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10},"last_token_usage":{"input_tokens":100,"cached_input_tokens":5,"cache_write_input_tokens":0,"output_tokens":10}}}}
    {"timestamp":"c","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10},"last_token_usage":{"input_tokens":100,"cached_input_tokens":5,"cache_write_input_tokens":0,"output_tokens":10}}}}
    """.utf8)
    precondition(CompletionUsageParser.parseCodexJSONL(duplicateEvents, turnID: "t")?.inputTokens == 100)

    let incompleteCodex = Data("""
    {"type":"token_usage_record","payload":{"turn_id":"t","turn_token_usage":{"input_tokens":100,"output_tokens":10,"cached_input_tokens":5}}}
    """.utf8)
    precondition(CompletionUsageParser.parseCodexJSONL(incompleteCodex, turnID: "t")?.cacheTokens == nil)
    let currentCodex = CompletionFeedbackObservation(executionID: UUID().uuidString, sequence: 1,
        provider: "codex", model: "fixture", effort: "low", outcome: .adopted,
        usage: mixedFirst, durationMS: 1)
    precondition(PublicCompletionObservation(currentCodex).inputTokens == 250)
    var legacyObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(currentCodex)) as! [String: Any]
    var legacyResource = legacyObject["usage_resource"] as! [String: Any]
    legacyResource.removeValue(forKey: "accounting_version")
    legacyObject["usage_resource"] = legacyResource
    let legacyCodex = try JSONDecoder().decode(CompletionFeedbackObservation.self,
        from: JSONSerialization.data(withJSONObject: legacyObject))
    precondition(legacyCodex.inputTokens == 250, "historical audit data remains intact")
    precondition(PublicCompletionObservation(legacyCodex).inputTokens == nil)
    precondition(PublicCompletionObservation(legacyCodex).outputTokens == nil)
    precondition(PublicCompletionObservation(legacyCodex).outcome == .adopted)

    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-feedback-test-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = CompletionFeedbackStore(root: root)
    func digest(_ character: Character) -> String { String(repeating: character, count: 64) }
    let scope = CompletionFeedbackScope(
        objectiveSHA256: digest("a"),
        sourceSHA256: digest("b"),
        executorContractSHA256: digest("c"),
        assembledInputSHA256: digest("d")
    )
    let execution = UUID().uuidString
    let first = CompletionFeedbackObservation(
        executionID: execution,
        sequence: 1,
        provider: "claude",
        model: "opus",
        effort: "xhigh",
        outcome: .qualityFailure,
        usage: claudeUsage,
        durationMS: 1_234
    )
    let insertedFirst = try store.record(scope: scope, observation: first)
    precondition(insertedFirst)
    let duplicate = CompletionFeedbackObservation(
        executionID: execution,
        sequence: 1,
        provider: "claude",
        model: "sonnet",
        effort: "low",
        outcome: .adopted,
        usage: nil,
        durationMS: 1
    )
    let insertedDuplicate = try store.record(scope: scope, observation: duplicate)
    precondition(!insertedDuplicate)
    let afterDuplicate = try store.load(scope: scope)
    precondition(afterDuplicate?.observations == [first])

    let unavailable = CompletionFeedbackObservation(
        executionID: execution,
        sequence: 2,
        provider: "codex",
        model: "gpt-5.6-luna",
        effort: "low",
        outcome: .timeout,
        usage: nil,
        durationMS: 120_000
    )
    let insertedUnavailable = try store.record(scope: scope, observation: unavailable)
    precondition(insertedUnavailable)
    let ledger = try store.load(scope: scope)!
    let localData = try JSONEncoder().encode(ledger)
    let localText = String(decoding: localData, as: UTF8.self)
    precondition(localText.contains("\"cache_tokens\":null"))
    precondition(localText.contains("\"usage_resource\":null"))

    let publicData = try JSONEncoder().encode(ledger.publicFeedback())
    let publicText = String(decoding: publicData, as: UTF8.self)
    precondition(publicText.contains("\"input_tokens\":null"))
    precondition(publicText.contains("\"output_tokens\":null"))
    precondition(!publicText.contains("execution_id"))
    precondition(!publicText.contains("cache_tokens"))
    precondition(!publicText.contains("source_sha256"))
    precondition(!publicText.contains("assembled_input_sha256"))
    precondition(!publicText.contains("executor_contract_sha256"))

    var localLedger = ledger
    let localObservation = CompletionFeedbackObservation(
        executionID: UUID().uuidString,
        sequence: 1,
        provider: "local",
        model: "deterministic",
        effort: "none",
        outcome: .adopted,
        usage: nil,
        durationMS: 2
    )
    let insertedLocal = try localLedger.append(localObservation)
    precondition(insertedLocal)
    precondition(localLedger.observations.contains(where: { $0.provider == "local" }))
    let unavailableVerification = CompletionFeedbackObservation(
        executionID: UUID().uuidString,
        sequence: 1,
        provider: "claude",
        model: "sonnet",
        effort: "medium",
        outcome: .verificationUnavailable,
        usage: claudeUsage,
        durationMS: 3
    )
    let insertedUnavailableVerification = try localLedger.append(unavailableVerification)
    precondition(insertedUnavailableVerification)
    precondition(localLedger.observations.contains(where: { $0.outcome == .verificationUnavailable }))
    let localPublic = try localLedger.publicFeedback()
    precondition(localPublic.observations.allSatisfy { $0.provider != "local" })
    precondition(localPublic.observations.allSatisfy { $0.outcome != .verificationUnavailable })

    let otherScope = CompletionFeedbackScope(
        objectiveSHA256: digest("a"),
        sourceSHA256: digest("b"),
        executorContractSHA256: digest("c"),
        assembledInputSHA256: digest("e")
    )
    precondition(scope.bindingSHA256 != otherScope.bindingSHA256)
    let otherLedger = try store.load(scope: otherScope)
    precondition(otherLedger == nil)

    func revisionScope(_ revision: String) -> CompletionFeedbackScope {
        CompletionFeedbackScope(objectiveSHA256: digest("a"), sourceSHA256: digest("b"),
            executorContractSHA256: digest("c"), assembledInputSHA256:
                CompletionFeedbackScope.inputDigest(assembledInput: "same objective and evidence",
                    codexSessionID: nil, claudeSessionID: nil, revision: revision))
    }
    let priorValidation = revisionScope("human-output-1/native-usage-1")
    let currentValidation = revisionScope(CompletionFeedbackScope.validationRevision)
    precondition(priorValidation.bindingSHA256 != currentValidation.bindingSHA256)
    let priorInserted = try store.record(scope: priorValidation, observation: first)
    precondition(priorInserted)
    let priorBytes = try Data(contentsOf: store.url(for: priorValidation))
    let cleanCalibration = try store.load(scope: currentValidation)
    precondition(cleanCalibration == nil, "old validator mistakes must not penalize current routes")
    let currentInserted = try store.record(scope: currentValidation, observation: duplicate)
    precondition(currentInserted)
    let currentCalibration = try store.load(scope: currentValidation)
    precondition(currentCalibration?.observations == [duplicate])
    let retainedPriorBytes = try Data(contentsOf: store.url(for: priorValidation))
    precondition(retainedPriorBytes == priorBytes, "migration must preserve original audit and costs")
    let defaultInput = CompletionFeedbackScope.inputDigest(assembledInput: "same objective and evidence",
        codexSessionID: nil, claudeSessionID: nil)
    precondition(defaultInput == currentValidation.assembledInputSHA256)
    precondition(defaultInput != CompletionFeedbackScope.inputDigest(assembledInput: "different evidence",
        codexSessionID: nil, claudeSessionID: nil))
    precondition(defaultInput != CompletionFeedbackScope.inputDigest(assembledInput: "same objective and evidence",
        codexSessionID: "different-native-session", claudeSessionID: nil))
    let firstWorkspace = CompletionFeedbackScope.inputDigest(assembledInput: "pwd",
        codexSessionID: nil, claudeSessionID: nil, workspace: "/private/tmp/workspace-a")
    precondition(firstWorkspace != CompletionFeedbackScope.inputDigest(assembledInput: "pwd",
        codexSessionID: nil, claudeSessionID: nil, workspace: "/private/tmp/workspace-b"),
        "Different execution workspaces must never share completion calibration")
    precondition(firstWorkspace == CompletionFeedbackScope.inputDigest(assembledInput: "pwd",
        codexSessionID: nil, claudeSessionID: nil, workspace: "/private/tmp/workspace-a/./"))
    precondition(firstWorkspace != CompletionFeedbackScope.inputDigest(assembledInput: "pwd",
        codexSessionID: nil, claudeSessionID: nil), "Legacy unbound scope must not match a bound workspace")

    var bounded = CompletionFeedbackLedger(scope: otherScope)
    var inserted = [CompletionFeedbackObservation]()
    for sequence in 1...17 {
        let observation = CompletionFeedbackObservation(
            executionID: UUID().uuidString,
            sequence: ((sequence - 1) % 16) + 1,
            provider: "claude",
            model: "sonnet",
            effort: "medium",
            outcome: .capabilityFailure,
            usage: unknownUsage,
            durationMS: sequence
        )
        let appended = try bounded.append(observation)
        precondition(appended)
        inserted.append(observation)
    }
    precondition(bounded.observations.count == 16)
    precondition(bounded.observations == Array(inserted.suffix(16)))
    let appendedDuplicate = try bounded.append(inserted.last!)
    precondition(!appendedDuplicate)
    precondition(bounded.observations == Array(inserted.suffix(16)))

    let concurrentScope = CompletionFeedbackScope(
        objectiveSHA256: digest("f"),
        sourceSHA256: digest("b"),
        executorContractSHA256: digest("c"),
        assembledInputSHA256: digest("d")
    )
    let concurrentObservations = (0..<32).map { index in
        CompletionFeedbackObservation(
            executionID: UUID().uuidString,
            sequence: (index % 16) + 1,
            provider: index.isMultiple(of: 2) ? "codex" : "claude",
            model: "parallel",
            effort: "low",
            outcome: .qualityFailure,
            usage: nil,
            durationMS: index
        )
    }
    let group = DispatchGroup()
    let parallelFailures = LockedFailureCounter()
    for observation in concurrentObservations {
        group.enter()
        DispatchQueue.global().async {
            defer { group.leave() }
            do {
                if try !store.record(scope: concurrentScope, observation: observation) {
                    parallelFailures.increment()
                }
            } catch {
                parallelFailures.increment()
            }
        }
    }
    precondition(group.wait(timeout: .now() + 10) == .success)
    precondition(parallelFailures.count == 0)
    let concurrentLedger = try store.load(scope: concurrentScope)!
    precondition(concurrentLedger.observations.count == 16)
    let retainedKeys = Set(concurrentLedger.observations.map { $0.executionID + ":" + String($0.sequence) })
    let submittedKeys = Set(concurrentObservations.map { $0.executionID + ":" + String($0.sequence) })
    precondition(retainedKeys.count == 16 && retainedKeys.isSubset(of: submittedKeys))
    let duplicateConcurrent = try store.record(
        scope: concurrentScope,
        observation: concurrentLedger.observations.last!
    )
    precondition(!duplicateConcurrent)
}
