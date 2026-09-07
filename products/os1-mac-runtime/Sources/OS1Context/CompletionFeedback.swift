import CryptoKit
import CoreFoundation
import Darwin
import Foundation
import OS1System

// Preserve flock's C ABI across SDK import/name changes. Do not declare a
// libc function with @_silgen_name (which gives it a thin Swift convention).
private func completionFeedbackFlock(_ descriptor: Int32, _ operation: Int32) -> Int32 {
    os1_flock(descriptor, operation)
}

public enum CompletionOutcome: String, Codable, Sendable {
    case adopted
    case qualityFailure = "quality_failure"
    case timeout
    case capabilityFailure = "capability_failure"
    case verificationUnavailable = "verification_unavailable"
    case quotaExhausted = "quota_exhausted"
}

public enum CompletionUsageFormat: String, Codable, Sendable {
    case claudeResultJSON = "claude_result_json"
    case claudeJSONL = "claude_jsonl"
    case codexRolloutJSONL = "codex_rollout_jsonl"
}

public enum CompletionFeedbackError: LocalizedError {
    case invalid
    case lockUnavailable

    public var errorDescription: String? {
        switch self {
        case .invalid: "OS-1 completion feedback failed local integrity validation."
        case .lockUnavailable: "OS-1 completion feedback could not acquire its bounded local lock."
        }
    }
}

/// Exact hashes bind feedback to one objective, source, execution contract and
/// assembled provider input. Only `objectiveSHA256` leaves the local ledger.
public struct CompletionFeedbackScope: Codable, Equatable, Sendable {
    /// Calibration is valid only under the validator/accounting that produced it.
    /// Changing these contracts starts new feedback, without deleting old ledgers.
    public static let validationRevision = "human-output-5/native-usage-2/execution-lease-1/quota-1"

    public static func inputDigest(assembledInput: String, codexSessionID: String?,
                                   claudeSessionID: String?,
                                   workspace: String? = nil,
                                   revision: String = validationRevision) -> String {
        let workspaceIdentity = workspace.map {
            URL(fileURLWithPath: $0).standardizedFileURL.resolvingSymlinksInPath().path
        } ?? "unspecified-workspace"
        return Self.digest(Data(["completion-input-v3", revision, workspaceIdentity, assembledInput,
                          codexSessionID ?? "none", claudeSessionID ?? "none"]
            .joined(separator: "\u{0}").utf8))
    }

    public let objectiveSHA256: String
    public let sourceSHA256: String?
    public let executorContractSHA256: String
    public let assembledInputSHA256: String

    enum CodingKeys: String, CodingKey {
        case objectiveSHA256 = "objective_sha256"
        case sourceSHA256 = "source_sha256"
        case executorContractSHA256 = "executor_contract_sha256"
        case assembledInputSHA256 = "assembled_input_sha256"
    }

    public init(
        objectiveSHA256: String,
        sourceSHA256: String?,
        executorContractSHA256: String,
        assembledInputSHA256: String
    ) {
        self.objectiveSHA256 = objectiveSHA256
        self.sourceSHA256 = sourceSHA256
        self.executorContractSHA256 = executorContractSHA256
        self.assembledInputSHA256 = assembledInputSHA256
    }

    public var bindingSHA256: String {
        Self.digest(Data([
            "os1-completion-feedback-scope-v1",
            objectiveSHA256,
            sourceSHA256 ?? "none",
            executorContractSHA256,
            assembledInputSHA256,
        ].joined(separator: "\n").utf8))
    }

    public func validate() throws {
        guard Self.isDigest(objectiveSHA256),
              sourceSHA256.map(Self.isDigest) ?? true,
              Self.isDigest(executorContractSHA256),
              Self.isDigest(assembledInputSHA256) else {
            throw CompletionFeedbackError.invalid
        }
    }

    static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func isDigest(_ value: String) -> Bool {
        value.count == 64 && value.unicodeScalars.allSatisfy {
            (48...57).contains($0.value) || (97...102).contains($0.value)
        }
    }
}

/// Content-free metadata for the native record from which usage was measured.
public struct CompletionUsageResourceMetadata: Codable, Equatable, Sendable {
    public let format: CompletionUsageFormat
    public let byteCount: Int
    public let sha256: String
    public let usageRecordCount: Int
    public let accountingVersion: Int?

    enum CodingKeys: String, CodingKey {
        case format
        case byteCount = "byte_count"
        case sha256
        case usageRecordCount = "usage_record_count"
        case accountingVersion = "accounting_version"
    }

    public init(format: CompletionUsageFormat, byteCount: Int, sha256: String, usageRecordCount: Int,
                accountingVersion: Int? = nil) {
        self.format = format
        self.byteCount = byteCount
        self.sha256 = sha256
        self.usageRecordCount = usageRecordCount
        self.accountingVersion = accountingVersion
    }
}

public struct CompletionMeasuredUsage: Codable, Equatable, Sendable {
    public let inputTokens: Int?
    public let outputTokens: Int?
    public let cacheTokens: Int?
    public let resource: CompletionUsageResourceMetadata

    enum CodingKeys: String, CodingKey {
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case cacheTokens = "cache_tokens"
        case resource
    }

    public init(
        inputTokens: Int?,
        outputTokens: Int?,
        cacheTokens: Int?,
        resource: CompletionUsageResourceMetadata
    ) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.cacheTokens = cacheTokens
        self.resource = resource
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        if let inputTokens { try values.encode(inputTokens, forKey: .inputTokens) }
        else { try values.encodeNil(forKey: .inputTokens) }
        if let outputTokens { try values.encode(outputTokens, forKey: .outputTokens) }
        else { try values.encodeNil(forKey: .outputTokens) }
        if let cacheTokens { try values.encode(cacheTokens, forKey: .cacheTokens) }
        else { try values.encodeNil(forKey: .cacheTokens) }
        try values.encode(resource, forKey: .resource)
    }
}

public struct CompletionFeedbackObservation: Codable, Equatable, Sendable {
    public let executionID: String
    public let sequence: Int
    public let provider: String
    public let model: String
    public let effort: String
    public let outcome: CompletionOutcome
    public let inputTokens: Int?
    public let outputTokens: Int?
    public let cacheTokens: Int?
    public let durationMS: Int
    public let usageResource: CompletionUsageResourceMetadata?

    enum CodingKeys: String, CodingKey {
        case executionID = "execution_id"
        case sequence, provider, model, effort, outcome
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case cacheTokens = "cache_tokens"
        case durationMS = "duration_ms"
        case usageResource = "usage_resource"
    }

    public init(
        executionID: String,
        sequence: Int,
        provider: String,
        model: String,
        effort: String,
        outcome: CompletionOutcome,
        usage: CompletionMeasuredUsage?,
        durationMS: Int
    ) {
        self.executionID = executionID.lowercased()
        self.sequence = sequence
        self.provider = provider
        self.model = model
        self.effort = effort
        self.outcome = outcome
        self.inputTokens = usage?.inputTokens
        self.outputTokens = usage?.outputTokens
        self.cacheTokens = usage?.cacheTokens
        self.durationMS = durationMS
        self.usageResource = usage?.resource
    }

    public func validate() throws {
        let safeIdentifier = /^[A-Za-z0-9._-]{1,96}$/
        guard UUID(uuidString: executionID) != nil,
              (1...16).contains(sequence),
              ["local", "codex", "claude"].contains(provider),
              model.wholeMatch(of: safeIdentifier) != nil,
              effort.wholeMatch(of: safeIdentifier) != nil,
              (0...3_600_000).contains(durationMS),
              [inputTokens, outputTokens, cacheTokens].allSatisfy({ $0.map { (0...2_000_000_000).contains($0) } ?? true }),
              usageResource.map({
                  $0.byteCount > 0 && $0.byteCount <= 64_000_000 &&
                      CompletionFeedbackScope.isDigest($0.sha256) &&
                      (1...10_000).contains($0.usageRecordCount)
              }) ?? true else {
            throw CompletionFeedbackError.invalid
        }
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(executionID, forKey: .executionID)
        try values.encode(sequence, forKey: .sequence)
        try values.encode(provider, forKey: .provider)
        try values.encode(model, forKey: .model)
        try values.encode(effort, forKey: .effort)
        try values.encode(outcome, forKey: .outcome)
        if let inputTokens { try values.encode(inputTokens, forKey: .inputTokens) }
        else { try values.encodeNil(forKey: .inputTokens) }
        if let outputTokens { try values.encode(outputTokens, forKey: .outputTokens) }
        else { try values.encodeNil(forKey: .outputTokens) }
        if let cacheTokens { try values.encode(cacheTokens, forKey: .cacheTokens) }
        else { try values.encodeNil(forKey: .cacheTokens) }
        try values.encode(durationMS, forKey: .durationMS)
        if let usageResource { try values.encode(usageResource, forKey: .usageResource) }
        else { try values.encodeNil(forKey: .usageResource) }
    }
}

public struct CompletionFeedbackLedger: Codable, Equatable, Sendable {
    public let schema: Int
    public let scope: CompletionFeedbackScope
    public private(set) var observations: [CompletionFeedbackObservation]

    public init(scope: CompletionFeedbackScope, observations: [CompletionFeedbackObservation] = []) {
        schema = 1
        self.scope = scope
        self.observations = observations
    }

    public mutating func append(_ observation: CompletionFeedbackObservation) throws -> Bool {
        try validate()
        try observation.validate()
        if observations.contains(where: {
            $0.executionID.caseInsensitiveCompare(observation.executionID) == .orderedSame &&
                $0.sequence == observation.sequence
        }) { return false }
        observations.append(observation)
        // Feedback must never block the user's task. Keep a bounded rolling
        // window and discard the oldest observation only after a new unique
        // attempt has been validated and appended.
        if observations.count > 16 { observations.removeFirst(observations.count - 16) }
        return true
    }

    public func validate() throws {
        try scope.validate()
        guard schema == 1, observations.count <= 16 else { throw CompletionFeedbackError.invalid }
        var keys = Set<String>()
        for observation in observations {
            try observation.validate()
            guard keys.insert(observation.executionID.lowercased() + ":" + String(observation.sequence)).inserted else {
                throw CompletionFeedbackError.invalid
            }
        }
    }

    public func publicFeedback() throws -> PublicCompletionFeedback {
        try validate()
        return PublicCompletionFeedback(
            objectiveSHA256: scope.objectiveSHA256,
            observations: observations
                .filter {
                    ($0.provider == "codex" || $0.provider == "claude") &&
                        $0.outcome != .verificationUnavailable && $0.outcome != .quotaExhausted
                }
                .map(PublicCompletionObservation.init)
        )
    }
}

public struct PublicCompletionFeedback: Codable, Equatable, Sendable {
    public let schema: Int
    public let objectiveSHA256: String
    public let observations: [PublicCompletionObservation]

    enum CodingKeys: String, CodingKey {
        case schema
        case objectiveSHA256 = "objective_sha256"
        case observations
    }

    public init(objectiveSHA256: String, observations: [PublicCompletionObservation]) {
        schema = 1
        self.objectiveSHA256 = objectiveSHA256
        self.observations = observations
    }
}

public struct PublicCompletionObservation: Codable, Equatable, Sendable {
    public let provider: String
    public let model: String
    public let effort: String
    public let outcome: CompletionOutcome
    public let inputTokens: Int?
    public let outputTokens: Int?
    public let durationMS: Int?

    enum CodingKeys: String, CodingKey {
        case provider, model, effort, outcome
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case durationMS = "duration_ms"
    }

    public init(_ observation: CompletionFeedbackObservation) {
        provider = observation.provider
        model = observation.model
        effort = observation.effort
        outcome = observation.outcome
        // Keep historical evidence intact, but never optimize using old Codex
        // counts produced before mirrored-usage deduplication was implemented.
        let trustedUsage = observation.provider != "codex" ||
            (observation.usageResource?.format == .codexRolloutJSONL &&
             observation.usageResource?.accountingVersion == 2)
        inputTokens = trustedUsage ? observation.inputTokens : nil
        outputTokens = trustedUsage ? observation.outputTokens : nil
        durationMS = observation.durationMS
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(provider, forKey: .provider)
        try values.encode(model, forKey: .model)
        try values.encode(effort, forKey: .effort)
        try values.encode(outcome, forKey: .outcome)
        if let inputTokens { try values.encode(inputTokens, forKey: .inputTokens) }
        else { try values.encodeNil(forKey: .inputTokens) }
        if let outputTokens { try values.encode(outputTokens, forKey: .outputTokens) }
        else { try values.encodeNil(forKey: .outputTokens) }
        if let durationMS { try values.encode(durationMS, forKey: .durationMS) }
        else { try values.encodeNil(forKey: .durationMS) }
    }
}

public struct CompletionFeedbackStore: Sendable {
    public let root: URL

    public init(root: URL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/OS-1/completion-feedback", isDirectory: true)) {
        self.root = root.resolvingSymlinksInPath().standardizedFileURL
    }

    public func url(for scope: CompletionFeedbackScope) -> URL {
        root.appendingPathComponent(scope.bindingSHA256 + ".json")
    }

    public func load(scope: CompletionFeedbackScope) throws -> CompletionFeedbackLedger? {
        try scope.validate()
        let path = url(for: scope)
        guard FileManager.default.fileExists(atPath: path.path) else { return nil }
        guard path.resolvingSymlinksInPath() == path.standardizedFileURL,
              let attributes = try? FileManager.default.attributesOfItem(atPath: path.path),
              attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber, size.intValue > 0, size.intValue <= 512_000,
              let data = try? Data(contentsOf: path),
              let ledger = try? JSONDecoder().decode(CompletionFeedbackLedger.self, from: data),
              ledger.scope == scope else { throw CompletionFeedbackError.invalid }
        try ledger.validate()
        return ledger
    }

    @discardableResult
    public func record(scope: CompletionFeedbackScope, observation: CompletionFeedbackObservation) throws -> Bool {
        try scope.validate()
        try observation.validate()
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        return try withScopeLock(scope: scope) {
            var ledger = try load(scope: scope) ?? CompletionFeedbackLedger(scope: scope)
            guard try ledger.append(observation) else { return false }
            let path = url(for: scope)
            guard path.resolvingSymlinksInPath() == path.standardizedFileURL else {
                throw CompletionFeedbackError.invalid
            }
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            let data = try encoder.encode(ledger)
            guard data.count <= 512_000 else { throw CompletionFeedbackError.invalid }
            try data.write(to: path, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
            guard try load(scope: scope) == ledger else { throw CompletionFeedbackError.invalid }
            return true
        }
    }

    private func withScopeLock<T>(scope: CompletionFeedbackScope, _ body: () throws -> T) throws -> T {
        let lockURL = root.appendingPathComponent(scope.bindingSHA256 + ".lock")
        guard lockURL.resolvingSymlinksInPath() == lockURL.standardizedFileURL else {
            throw CompletionFeedbackError.invalid
        }
        let descriptor = lockURL.path.withCString {
            Darwin.open($0, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, mode_t(0o600))
        }
        guard descriptor >= 0 else { throw CompletionFeedbackError.lockUnavailable }
        defer { Darwin.close(descriptor) }
        _ = Darwin.fchmod(descriptor, mode_t(0o600))

        var acquired = false
        for attempt in 0..<200 {
            if completionFeedbackFlock(descriptor, LOCK_EX | LOCK_NB) == 0 {
                acquired = true
                break
            }
            guard errno == EWOULDBLOCK || errno == EAGAIN else {
                throw CompletionFeedbackError.lockUnavailable
            }
            if attempt < 199 { usleep(10_000) }
        }
        guard acquired else { throw CompletionFeedbackError.lockUnavailable }
        defer { _ = completionFeedbackFlock(descriptor, LOCK_UN) }
        return try body()
    }
}

/// Extracts usage dictionaries only. Message content, thinking, prompts and
/// tool payloads are never copied into the returned value or local ledger.
public enum CompletionUsageParser {
    public static func parse(_ data: Data, format: CompletionUsageFormat) -> CompletionMeasuredUsage? {
        switch format {
        case .claudeResultJSON: return parseClaudeResult(data)
        case .claudeJSONL: return parseClaudeJSONL(data)
        case .codexRolloutJSONL: return parseCodexJSONL(data, turnID: nil)
        }
    }

    public static func parseClaudeResult(_ data: Data) -> CompletionMeasuredUsage? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        let records: [[String: Any]]
        if let usage = object["usage"] as? [String: Any] {
            records = [usage]
        } else if let models = object["modelUsage"] as? [String: Any] {
            records = models.keys.sorted().compactMap { key in
                guard let value = models[key] as? [String: Any] else { return nil }
                return [
                    "input_tokens": value["inputTokens"] as Any,
                    "output_tokens": value["outputTokens"] as Any,
                    "cache_creation_input_tokens": value["cacheCreationInputTokens"] as Any,
                    "cache_read_input_tokens": value["cacheReadInputTokens"] as Any,
                ]
            }
        } else {
            return nil
        }
        return measuredUsage(records: records, data: data, format: .claudeResultJSON, claudeNormalization: true)
    }

    public static func parseClaudeJSONL(_ data: Data) -> CompletionMeasuredUsage? {
        var records: [[String: Any]] = []
        var identities = Set<String>()
        for line in data.split(separator: 0x0A) {
            guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else { continue }
            guard object["type"] as? String == "assistant",
                  let message = object["message"] as? [String: Any],
                  let identity = (message["id"] as? String) ?? (object["uuid"] as? String),
                  identities.insert(identity).inserted,
                  let usage = message["usage"] as? [String: Any] else { continue }
            records.append(usage)
        }
        return measuredUsage(records: records, data: data, format: .claudeJSONL, claudeNormalization: true)
    }

    public static func parseCodexJSONL(_ data: Data, turnID: String?) -> CompletionMeasuredUsage? {
        // A native turn can emit the same usage through both explicit records
        // and token_count notifications. Select one representation PER TURN.
        var cumulative: [String: [String: Any]] = [:]
        var responses: [String: [String: [String: Any]]] = [:]
        var exchanges: [String: [[String: Any]]] = [:]
        var identities = Set<String>()
        var turnOrder: [String] = []
        var activeTurn: String?
        var sawTaskBoundary = false
        func remember(_ key: String) {
            if !turnOrder.contains(key) { turnOrder.append(key) }
        }
        for line in data.split(separator: 0x0A) {
            let lineData = Data(line)
            guard let object = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                  let type = object["type"] as? String else { continue }

            if type == "event_msg", let payload = object["payload"] as? [String: Any],
               let eventType = payload["type"] as? String {
                if eventType == "task_started", let startedID = payload["turn_id"] as? String {
                    activeTurn = startedID
                    sawTaskBoundary = true
                    continue
                }
                if eventType == "task_complete", let completedID = payload["turn_id"] as? String,
                   completedID == activeTurn {
                    activeTurn = nil
                    continue
                }
                if eventType == "token_count",
                   let key = activeTurn ?? (!sawTaskBoundary && turnID == nil ? "legacy-unscoped" : nil),
                   turnID.map({ $0 == key }) ?? true,
                   let info = payload["info"] as? [String: Any],
                   let usage = info["last_token_usage"] as? [String: Any] {
                    // Cumulative totals distinguish equal-sized real exchanges
                    // and ignore duplicate notifications with new timestamps.
                    let identityBytes = (info["total_token_usage"] as? [String: Any]).flatMap {
                        try? JSONSerialization.data(withJSONObject: $0, options: [.sortedKeys])
                    } ?? lineData
                    let identity = key + ":" + CompletionFeedbackScope.digest(identityBytes)
                    if identities.insert(identity).inserted {
                        remember(key)
                        exchanges[key, default: []].append(usage)
                    }
                    continue
                }
            }

            if type == "token_usage_record",
               let payload = object["payload"] as? [String: Any],
               let recordTurnID = payload["turn_id"] as? String,
               turnID.map({ $0 == recordTurnID }) ?? true {
                if let usage = payload["turn_token_usage"] as? [String: Any] {
                    remember(recordTurnID)
                    cumulative[recordTurnID] = usage // final cumulative snapshot, never a sum
                } else if let usage = payload["usage"] as? [String: Any] {
                    remember(recordTurnID)
                    let responseID = payload["response_id"] as? String ?? "legacy-turn-record"
                    responses[recordTurnID, default: [:]][responseID] = usage
                }
            }
        }
        let records = turnOrder.flatMap { key -> [[String: Any]] in
            if let usage = cumulative[key] { return [usage] }
            if let records = responses[key], !records.isEmpty {
                return records.keys.sorted().compactMap { records[$0] }
            }
            return exchanges[key] ?? []
        }
        return measuredUsage(records: records, data: data, format: .codexRolloutJSONL, claudeNormalization: false)
    }

    private static func measuredUsage(
        records: [[String: Any]],
        data: Data,
        format: CompletionUsageFormat,
        claudeNormalization: Bool
    ) -> CompletionMeasuredUsage? {
        guard !records.isEmpty else { return nil }
        let input: Int?
        let output = sum(records, keys: ["output_tokens"])
        let cache: Int?
        if claudeNormalization {
            input = sum(records, keys: ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"])
            cache = sum(records, keys: ["cache_creation_input_tokens", "cache_read_input_tokens"])
        } else {
            // Codex input_tokens already includes its cached-input subset.
            input = sum(records, keys: ["input_tokens"])
            cache = sum(records, keys: ["cached_input_tokens", "cache_write_input_tokens"])
        }
        let resource = CompletionUsageResourceMetadata(
            format: format,
            byteCount: data.count,
            sha256: CompletionFeedbackScope.digest(data),
            usageRecordCount: records.count,
            accountingVersion: format == .codexRolloutJSONL ? 2 : 1
        )
        return CompletionMeasuredUsage(inputTokens: input, outputTokens: output, cacheTokens: cache, resource: resource)
    }

    private static func sum(_ records: [[String: Any]], keys: [String]) -> Int? {
        var result = 0
        for record in records {
            for key in keys {
                guard let value = integer(record[key]) else { return nil }
                let addition = result.addingReportingOverflow(value)
                guard !addition.overflow, addition.partialValue <= 2_000_000_000 else { return nil }
                result = addition.partialValue
            }
        }
        return result
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber,
              CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let integer = number.intValue
        return integer >= 0 && NSNumber(value: integer) == number ? integer : nil
    }
}
