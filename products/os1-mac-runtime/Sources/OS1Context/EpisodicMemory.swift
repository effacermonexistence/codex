import Darwin
import Foundation

/// Persistent evidence is OS-1-owned and separate from provider context. The
/// original bytes and metadata revisions are content-addressed, never summaries.
public enum EpisodicMemoryQueryKind: String, Codable, CaseIterable, Sendable {
    case latestState = "LATEST_STATE", exactQuote = "EXACT_QUOTE", historicalState = "HISTORICAL_STATE"
    case decisionHistory = "DECISION_HISTORY", correctionHistory = "CORRECTION_HISTORY", artifact = "ARTIFACT"
    case numericResult = "NUMERIC_RESULT", entityRelation = "ENTITY_RELATION", thread = "THREAD"
    case openQuestion = "OPEN_QUESTION", rejectedPath = "REJECTED_PATH", currentObjectState = "CURRENT_OBJECT_STATE"
}

public enum EpisodicMemoryRecordKind: String, Codable, Sendable {
    case userMessage, assistantMessage, toolCall, toolResult, artifact, decision, correction, rejectedPath
    case numericResult, entityRelation, openQuestion, state, derivedCache, opaqueArchive
}

/// Identity labels are exact keys, not similarity or automatic alias matching.
public struct EpisodicMemoryScope: Codable, Equatable, Hashable, Sendable {
    public var threadID: String
    public var projectID: String?
    public var entityID: String?
    public var objectID: String?
    public init(threadID: String, projectID: String? = nil, entityID: String? = nil, objectID: String? = nil) {
        self.threadID = threadID; self.projectID = projectID; self.entityID = entityID; self.objectID = objectID
    }
}

/// Assertion values are captured verbatim by the caller. The store does not
/// invent predicates, infer contradictions from prose, or infer correction authority.
public struct EpisodicMemoryAssertion: Codable, Equatable, Sendable {
    public var field: String
    public var value: String
    public init(field: String, value: String) { self.field = field; self.value = value }
}

public struct EpisodicMemoryCorrection: Codable, Equatable, Sendable {
    public enum Authority: String, Codable, Sendable { case explicitUser, authorizedDocument, executedReceipt }
    /// Immutable version IDs, not names or logical message IDs.
    public var supersedes: [String]
    public var authority: Authority
    /// Must bind to this record's actual message/artifact ID, not another source.
    public var evidenceID: String
    public init(supersedes: [String], authority: Authority, evidenceID: String) {
        self.supersedes = supersedes; self.authority = authority; self.evidenceID = evidenceID
    }
}

public struct EpisodicMemoryMetadata: Codable, Equatable, Sendable {
    public var sourceSessionID: String
    public var sourceMessageID: String?
    public var artifactID: String?
    public var timestamp: Date?
    public var speaker: String
    public var scope: EpisodicMemoryScope
    public var kind: EpisodicMemoryRecordKind
    public var exact: Bool
    public var assertion: EpisodicMemoryAssertion?
    public var correction: EpisodicMemoryCorrection?
    public var derivedFrom: [String]
    public var confidence: String?
    /// Existing TaskContext provenance is reused for repository/commit/path.
    public var provenance: TaskContext.Provenance
    public init(sourceSessionID: String, sourceMessageID: String? = nil, artifactID: String? = nil,
                timestamp: Date? = nil, speaker: String, scope: EpisodicMemoryScope,
                kind: EpisodicMemoryRecordKind, exact: Bool = true,
                assertion: EpisodicMemoryAssertion? = nil, correction: EpisodicMemoryCorrection? = nil,
                derivedFrom: [String] = [], confidence: String? = nil,
                provenance: TaskContext.Provenance = .init()) {
        self.sourceSessionID = sourceSessionID; self.sourceMessageID = sourceMessageID; self.artifactID = artifactID
        self.timestamp = timestamp; self.speaker = speaker; self.scope = scope; self.kind = kind; self.exact = exact
        self.assertion = assertion; self.correction = correction; self.derivedFrom = derivedFrom
        self.confidence = confidence; self.provenance = provenance
    }
}

public struct EpisodicMemoryItem: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let versionID: String
    public let logicalID: String
    public let rawSHA256: String
    public let rawBytes: Int
    public let metadata: EpisodicMemoryMetadata
    public let capturedAt: Date
}

public struct EpisodicMemoryQuery: Codable, Equatable, Sendable {
    public var kind: EpisodicMemoryQueryKind
    public var scope: EpisodicMemoryScope
    public var text: String?
    public var sourceMessageID: String?
    public var artifactID: String?
    public var asOf: Date?
    public var budgetTokens: Int
    public var budgetBytes: Int
    public var maximumHits: Int
    public init(kind: EpisodicMemoryQueryKind, scope: EpisodicMemoryScope, text: String? = nil,
                sourceMessageID: String? = nil, artifactID: String? = nil, asOf: Date? = nil,
                budgetTokens: Int = 8_000, budgetBytes: Int = 32_000, maximumHits: Int = 20) {
        self.kind = kind; self.scope = scope; self.text = text; self.sourceMessageID = sourceMessageID
        self.artifactID = artifactID; self.asOf = asOf; self.budgetTokens = budgetTokens
        self.budgetBytes = budgetBytes; self.maximumHits = maximumHits
    }
}

public struct EpisodicMemoryHit: Codable, Equatable, Sendable {
    public let item: EpisodicMemoryItem
    public let byteStart: Int
    public let byteEnd: Int
    public let chunkSHA256: String
    public let text: String
    public let retrievalReason: String
    public let current: Bool
    public let supersededBy: [String]
}

public struct EpisodicMemoryOmission: Codable, Equatable, Sendable {
    public let versionID: String
    public let rawSHA256: String
    public let byteStart: Int?
    public let byteEnd: Int?
    public let reason: String
}

public struct EpisodicMemoryConflict: Codable, Equatable, Sendable {
    public let code: String
    public let versionIDs: [String]
}

public struct EpisodicMemoryReceipt: Codable, Equatable, Sendable {
    public let format: String
    public let query: EpisodicMemoryQuery
    public let createdAt: Date
    public let indexSHA256: String
    public let hits: [EpisodicMemoryHit]
    public let omissions: [EpisodicMemoryOmission]
    public let conflicts: [EpisodicMemoryConflict]
    public let unknown: Bool
    public let injectionSHA256: String
    public let injectionBytes: Int
    /// UTF-8 bytes are a deliberately conservative upper bound, not a claim
    /// about a hidden provider tokenizer or billable token count.
    public let tokenUpperBound: Int
}

public struct EpisodicMemoryRetrieval: Sendable {
    public let hits: [EpisodicMemoryHit]
    public let injectionText: String
    public let receipt: EpisodicMemoryReceipt
    public let receiptReference: SourceReference
    public var unknown: Bool { receipt.unknown }
}

public enum EpisodicMemoryError: Error, LocalizedError {
    case invalidMetadata, invalidCorrection, invalidProvenance, unsafePath, corruptIndex, invalidReceipt
    public var errorDescription: String? {
        switch self {
        case .invalidMetadata: return "OS-1 episodic memory metadata is incomplete or invalid."
        case .invalidCorrection: return "OS-1 correction lacks exact scope, time, or explicit source authority."
        case .invalidProvenance: return "OS-1 immutable memory hash or byte count mismatch."
        case .unsafePath: return "OS-1 episodic memory path is not a private regular file."
        case .corruptIndex: return "OS-1 episodic memory ledger is corrupt; no guessed state was adopted."
        case .invalidReceipt: return "OS-1 episodic replay does not match the recorded exact evidence."
        }
    }
}

public struct EpisodicMemoryStore: Sendable {
    public static let format = "os1-episodic-memory-v1"
    public static let maximumOriginalBytes = 64 * 1_024 * 1_024
    public static let chunkBytes = 4_096
    public static let maximumLineageDepth = 64
    public static let maximumLineageNodes = 4_096
    public let root: URL
    public init(root: URL = SourceContextStore().root) {
        self.root = root.standardizedFileURL.resolvingSymlinksInPath().appendingPathComponent("episodic-memory")
    }
    public var indexURL: URL { root.appendingPathComponent("index.jsonl") }
    public func originalURL(for item: EpisodicMemoryItem) -> URL { root.appendingPathComponent("originals/" + item.rawSHA256 + ".raw") }
    public func recordURL(versionID: String) -> URL { root.appendingPathComponent("records/" + versionID + ".json") }
    private var sourceStore: SourceContextStore { SourceContextStore(root: root) }

    private struct Payload: Codable { let format: String; let rawSHA256: String; let rawBytes: Int; let metadata: EpisodicMemoryMetadata }
    private struct IndexEntry: Codable { let versionID: String; let recordSHA256: String }
    private static func encoded<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        // Default Date encoding retains subsecond precision; ISO8601 would drop it.
        return try encoder.encode(value)
    }
    private static func key(_ values: [String]) throws -> String { SourceContextStore.digest(try encoded(values)) }
    private func prepare() throws {
        for path in [root, root.appendingPathComponent("originals"), root.appendingPathComponent("records")] {
            try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            guard path.resolvingSymlinksInPath() == path.standardizedFileURL else { throw EpisodicMemoryError.unsafePath }
            try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: path.path)
        }
    }
    private func locked<T>(_ body: () throws -> T) throws -> T {
        try prepare()
        let fd = open(root.appendingPathComponent(".lock").path, O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw EpisodicMemoryError.unsafePath }
        defer { close(fd) }
        guard flock(fd, LOCK_EX) == 0 else { throw EpisodicMemoryError.unsafePath }
        defer { flock(fd, LOCK_UN) }
        return try body()
    }
    private func safeRead(_ path: URL, maximum: Int) throws -> Data {
        guard path.standardizedFileURL.path.hasPrefix(root.path + "/"),
              path.resolvingSymlinksInPath() == path.standardizedFileURL else { throw EpisodicMemoryError.unsafePath }
        let fd = open(path.path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw EpisodicMemoryError.unsafePath }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true); defer { try? handle.close() }
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_size >= 0, info.st_size <= maximum else { throw EpisodicMemoryError.unsafePath }
        let data = try handle.readToEnd() ?? Data()
        guard data.count == Int(info.st_size) else { throw EpisodicMemoryError.invalidProvenance }
        return data
    }
    private func immutableWrite(_ data: Data, to path: URL) throws {
        if FileManager.default.fileExists(atPath: path.path) {
            guard try safeRead(path, maximum: max(data.count, 1)) == data else { throw EpisodicMemoryError.invalidProvenance }
            return
        }
        let fd = open(path.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw EpisodicMemoryError.unsafePath }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true); defer { try? handle.close() }
        try handle.write(contentsOf: data); try handle.synchronize()
    }

    @discardableResult public func record(text: String, metadata: EpisodicMemoryMetadata, now: Date = Date()) throws -> EpisodicMemoryItem {
        try record(raw: Data(text.utf8), metadata: metadata, now: now)
    }
    @discardableResult public func record(raw: Data, metadata: EpisodicMemoryMetadata, now: Date = Date()) throws -> EpisodicMemoryItem {
        try recordBatch([(raw: raw, metadata: metadata)], now: now)[0]
    }

    /// One inventory/metadata verification and one process lock for a capture
    /// batch. Identical items are idempotent, with dictionary version lookup.
    /// A later invalid item does not erase earlier durably recorded evidence.
    @discardableResult public func recordBatch(_ inputs: [(raw: Data, metadata: EpisodicMemoryMetadata)],
                                              now: Date = Date()) throws -> [EpisodicMemoryItem] {
        guard !inputs.isEmpty else { return [] }
        return try locked {
            let existing = try inventoryUnlocked()
            var byVersion = Dictionary(uniqueKeysWithValues: existing.map { ($0.versionID, $0) })
            var verified = Set<String>(), output: [EpisodicMemoryItem] = []
            for input in inputs {
                let item = try appendUnlocked(raw: input.raw, metadata: input.metadata, now: now,
                                               byVersion: &byVersion, verified: &verified)
                output.append(item)
            }
            return output
        }
    }
    private func verifyOnce(_ item: EpisodicMemoryItem, verified: inout Set<String>) throws {
        if !verified.contains(item.versionID) { _ = try read(item); verified.insert(item.versionID) }
    }
    private func appendUnlocked(raw: Data, metadata: EpisodicMemoryMetadata, now: Date,
                                byVersion: inout [String: EpisodicMemoryItem], verified: inout Set<String>) throws -> EpisodicMemoryItem {
            guard !raw.isEmpty, raw.count <= Self.maximumOriginalBytes,
                  !metadata.sourceSessionID.isEmpty, !metadata.scope.threadID.isEmpty, !metadata.speaker.isEmpty,
                  metadata.sourceMessageID?.isEmpty == false || metadata.artifactID?.isEmpty == false,
                  metadata.exact ? metadata.confidence == nil : !metadata.derivedFrom.isEmpty,
                  metadata.exact || metadata.correction == nil,
                  metadata.kind != .derivedCache || !metadata.exact else { throw EpisodicMemoryError.invalidMetadata }
            let rawHash = SourceContextStore.digest(raw)
            if let declared = metadata.provenance.sha256, declared != rawHash { throw EpisodicMemoryError.invalidProvenance }
            if let bytes = metadata.provenance.bytes, bytes != raw.count { throw EpisodicMemoryError.invalidProvenance }
            if let correction = metadata.correction {
                guard metadata.kind == .correction || metadata.kind == .decision || metadata.kind == .state,
                      metadata.scope.objectID?.isEmpty == false, !correction.supersedes.isEmpty,
                      Set(correction.supersedes).count == correction.supersedes.count,
                      let time = metadata.timestamp,
                      correction.evidenceID == metadata.sourceMessageID || correction.evidenceID == metadata.artifactID,
                      correction.authority != .explicitUser || (metadata.speaker == "user" && correction.evidenceID == metadata.sourceMessageID),
                      correction.authority == .explicitUser || correction.evidenceID == metadata.artifactID else {
                    throw EpisodicMemoryError.invalidCorrection
                }
                for id in correction.supersedes {
                    guard let target = byVersion[id], target.metadata.exact,
                          target.metadata.scope == metadata.scope, let before = target.metadata.timestamp, before < time,
                          target.metadata.assertion?.field == metadata.assertion?.field else { throw EpisodicMemoryError.invalidCorrection }
                    try verifyOnce(target, verified: &verified)
                }
            }
            for parentID in metadata.derivedFrom {
                guard let parent = byVersion[parentID], parent.metadata.exact,
                      parent.metadata.scope == metadata.scope else { throw EpisodicMemoryError.invalidProvenance }
                try verifyOnce(parent, verified: &verified)
            }
            let versionID = SourceContextStore.digest(try Self.encoded(Payload(format: Self.format, rawSHA256: rawHash, rawBytes: raw.count, metadata: metadata)))
            if let same = byVersion[versionID] { try verifyOnce(same, verified: &verified); return same }
            let logicalID = try Self.key([metadata.scope.threadID, metadata.sourceSessionID,
                                          metadata.sourceMessageID ?? "", metadata.artifactID ?? ""])
            let item = EpisodicMemoryItem(schemaVersion: 1, versionID: versionID, logicalID: logicalID,
                                         rawSHA256: rawHash, rawBytes: raw.count, metadata: metadata, capturedAt: now)
            try immutableWrite(raw, to: originalURL(for: item))
            let encoded = try Self.encoded(item)
            try immutableWrite(encoded, to: recordURL(versionID: versionID))
            let line = try Self.encoded(IndexEntry(versionID: versionID, recordSHA256: SourceContextStore.digest(encoded))) + Data([10])
            let fd = open(indexURL.path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard fd >= 0 else { throw EpisodicMemoryError.unsafePath }
            let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true); defer { try? handle.close() }
            try handle.write(contentsOf: line); try handle.synchronize()
            _ = try read(item)
            byVersion[versionID] = item; verified.insert(versionID)
            return item
    }

    public func read(_ item: EpisodicMemoryItem) throws -> Data {
        guard item.schemaVersion == 1, ProjectMaterialObject.validSHA(item.versionID), ProjectMaterialObject.validSHA(item.rawSHA256),
              item.rawBytes > 0, item.rawBytes <= Self.maximumOriginalBytes,
              item.logicalID == (try Self.key([item.metadata.scope.threadID, item.metadata.sourceSessionID,
                                              item.metadata.sourceMessageID ?? "", item.metadata.artifactID ?? ""])),
              item.versionID == SourceContextStore.digest(try Self.encoded(Payload(format: Self.format, rawSHA256: item.rawSHA256,
                                                                                 rawBytes: item.rawBytes, metadata: item.metadata))) else {
            throw EpisodicMemoryError.invalidProvenance
        }
        let raw = try safeRead(originalURL(for: item), maximum: Self.maximumOriginalBytes)
        guard raw.count == item.rawBytes, SourceContextStore.digest(raw) == item.rawSHA256 else { throw EpisodicMemoryError.invalidProvenance }
        return raw
    }
    public func inventory() throws -> [EpisodicMemoryItem] { try locked { try inventoryUnlocked() } }

    /// Provenance ancestry is evidence, not another page to inject. Validate
    /// exact parents against the full immutable inventory, independent of the
    /// requested event-time cut. A later-collected container can authenticate
    /// an earlier event without becoming part of that event's working context.
    private func validLineage(_ item: EpisodicMemoryItem, byID: [String: EpisodicMemoryItem],
                              depths: inout [String: Int], rawStatus: inout [String: Bool],
                              visiting: inout Set<String>, visited: inout Int, traversalDepth: Int = 0) -> Bool {
        guard traversalDepth <= Self.maximumLineageDepth, visited < Self.maximumLineageNodes,
              !visiting.contains(item.versionID) else { return false }
        visited += 1
        if let cachedDepth = depths[item.versionID] {
            return cachedDepth <= Self.maximumLineageDepth - traversalDepth
        }
        if rawStatus[item.versionID] == nil {
            rawStatus[item.versionID] = (try? read(item)) != nil
        }
        guard rawStatus[item.versionID] == true else { return false }
        visiting.insert(item.versionID); defer { visiting.remove(item.versionID) }
        var deepest = 0
        for id in item.metadata.derivedFrom {
            guard let parent = byID[id], parent.metadata.exact, parent.metadata.scope == item.metadata.scope,
                  validLineage(parent, byID: byID, depths: &depths, rawStatus: &rawStatus,
                               visiting: &visiting, visited: &visited, traversalDepth: traversalDepth + 1),
                  let parentDepth = depths[id] else { return false }
            deepest = max(deepest, parentDepth + 1)
        }
        guard deepest <= Self.maximumLineageDepth - traversalDepth else { return false }
        // Failed traversal bounds do not poison independently valid ancestors.
        depths[item.versionID] = deepest
        return true
    }
    private func inventoryUnlocked() throws -> [EpisodicMemoryItem] {
        guard FileManager.default.fileExists(atPath: indexURL.path) else { return [] }
        let index = try safeRead(indexURL, maximum: 128 * 1_024 * 1_024)
        guard index.last == 10 else { throw EpisodicMemoryError.corruptIndex }
        var seen = Set<String>(), output: [EpisodicMemoryItem] = []
        for line in index.split(separator: 10) {
            guard let entry = try? JSONDecoder().decode(IndexEntry.self, from: Data(line)),
                  ProjectMaterialObject.validSHA(entry.versionID), ProjectMaterialObject.validSHA(entry.recordSHA256) else {
                throw EpisodicMemoryError.corruptIndex
            }
            let raw = try safeRead(recordURL(versionID: entry.versionID), maximum: 2_000_000)
            guard SourceContextStore.digest(raw) == entry.recordSHA256,
                  let item = try? JSONDecoder().decode(EpisodicMemoryItem.self, from: raw), item.versionID == entry.versionID else {
                throw EpisodicMemoryError.corruptIndex
            }
            if seen.insert(item.versionID).inserted { output.append(item) }
        }
        return output
    }

    private static func matches(_ actual: EpisodicMemoryScope, _ query: EpisodicMemoryScope) -> Bool {
        actual.threadID == query.threadID && (query.projectID == nil || actual.projectID == query.projectID) &&
        (query.entityID == nil || actual.entityID == query.entityID) && (query.objectID == nil || actual.objectID == query.objectID)
    }
    private static func chunks(_ data: Data) -> [(Int, Int, String)] {
        guard String(data: data, encoding: .utf8) != nil else { return [] }
        var output: [(Int, Int, String)] = [], start = 0
        while start < data.count {
            var end = min(start + chunkBytes, data.count)
            // Never cut a UTF-8 code point or normalize original text.
            while end > start && String(data: data.subdata(in: start..<end), encoding: .utf8) == nil { end -= 1 }
            guard end > start else { return [] }
            output.append((start, end, String(data: data.subdata(in: start..<end), encoding: .utf8)!)); start = end
        }
        return output
    }
    private static func block(_ hit: EpisodicMemoryHit) -> String {
        let m = hit.item.metadata
        let timeFormatter = ISO8601DateFormatter(); timeFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let time = m.timestamp.map { timeFormatter.string(from: $0) } ?? "UNKNOWN"
        // Metadata is JSON encoded to prevent identifiers/newlines creating a fake
        // source boundary. Source text remains untrusted evidence, never instructions.
        let attrs: [String: String] = ["version_id": hit.item.versionID, "source_session_id": m.sourceSessionID,
            "source_message_id": m.sourceMessageID ?? "UNKNOWN", "artifact_id": m.artifactID ?? "UNKNOWN",
            "timestamp": time, "timestamp_epoch_seconds": m.timestamp.map { String($0.timeIntervalSince1970) } ?? "UNKNOWN",
            "speaker": m.speaker, "thread_id": m.scope.threadID,
            "project_id": m.scope.projectID ?? "UNKNOWN", "entity_id": m.scope.entityID ?? "UNKNOWN",
            "object_id": m.scope.objectID ?? "UNKNOWN", "exact_or_derived": m.exact ? "exact" : "derived",
            "source_record_kind": m.kind.rawValue,
            "current_or_historical": hit.current ? "current" : "historical", "raw_sha256": hit.item.rawSHA256,
            "chunk_sha256": hit.chunkSHA256, "byte_range": "\(hit.byteStart)..<\(hit.byteEnd)",
            "retrieval_reason": hit.retrievalReason, "superseded_by": hit.supersededBy.joined(separator: ",")]
        let metadata = String(data: try! encoded(attrs), encoding: .utf8)!
        return "\nOS1_MEMORY_EXACT_CHUNK \(metadata)\n\(hit.text)\nOS1_MEMORY_CHUNK_END\n"
    }

    public func query(_ query: EpisodicMemoryQuery, now: Date = Date()) throws -> EpisodicMemoryRetrieval {
        try locked {
            guard !query.scope.threadID.isEmpty, query.budgetTokens >= 0, query.budgetBytes >= 0, query.maximumHits >= 0,
                  (query.kind != .latestState && query.kind != .currentObjectState) || query.scope.objectID?.isEmpty == false else {
                throw EpisodicMemoryError.invalidMetadata
            }
            let inventory = try inventoryUnlocked()
            let byID = Dictionary(uniqueKeysWithValues: inventory.map { ($0.versionID, $0) })
            let matching = inventory.filter { Self.matches($0.metadata.scope, query.scope) &&
                (query.sourceMessageID == nil || $0.metadata.sourceMessageID == query.sourceMessageID) &&
                (query.artifactID == nil || $0.metadata.artifactID == query.artifactID) &&
                (query.asOf == nil || ($0.metadata.timestamp != nil && $0.metadata.timestamp! <= query.asOf!)) }
            let timeScoped = inventory.filter { Self.matches($0.metadata.scope, query.scope) &&
                (query.asOf == nil || ($0.metadata.timestamp != nil && $0.metadata.timestamp! <= query.asOf!)) }
            var valid: [EpisodicMemoryItem] = [], omissions: [EpisodicMemoryOmission] = [], conflicts: [EpisodicMemoryConflict] = []
            var lineageDepths: [String: Int] = [:], lineageRawStatus: [String: Bool] = [:]
            for item in timeScoped {
                var visiting = Set<String>(), visited = 0
                if validLineage(item, byID: byID, depths: &lineageDepths, rawStatus: &lineageRawStatus,
                                visiting: &visiting, visited: &visited) {
                    valid.append(item)
                } else {
                    omissions.append(.init(versionID: item.versionID, rawSHA256: item.rawSHA256, byteStart: nil, byteEnd: nil,
                        reason: lineageRawStatus[item.versionID] == false ? "provenance_failure" : "provenance_lineage_failure"))
                }
            }
            var superseded: [String: [String]] = [:], invalidCorrections = Set<String>()
            for item in valid where item.metadata.exact {
                guard let correction = item.metadata.correction else { continue }
                // Revalidate corrections during reads, even if a record was imported.
                let targets = correction.supersedes.compactMap { id in valid.first { $0.versionID == id } }
                guard targets.count == correction.supersedes.count,
                      correction.evidenceID == item.metadata.sourceMessageID || correction.evidenceID == item.metadata.artifactID,
                      correction.authority != .explicitUser || item.metadata.speaker == "user",
                      targets.allSatisfy({ $0.metadata.scope == item.metadata.scope && $0.metadata.timestamp != nil &&
                          item.metadata.timestamp != nil && $0.metadata.timestamp! < item.metadata.timestamp! &&
                          $0.metadata.assertion?.field == item.metadata.assertion?.field }) else {
                    invalidCorrections.insert(item.versionID)
                    conflicts.append(.init(code: "invalid_correction", versionIDs: [item.versionID])); continue
                }
                for target in targets { superseded[target.versionID, default: []].append(item.versionID) }
            }
            // A damaged newer source must not resurrect its superseded state.
            // Its immutable metadata still proves there was an unresolved newer
            // dependency even though its payload cannot be adopted.
            var damagedDependencies = Set<String>()
            for item in timeScoped where !valid.contains(where: { $0.versionID == item.versionID }) {
                damagedDependencies.formUnion(item.metadata.correction?.supersedes ?? [])
            }
            let exact = valid.filter { $0.metadata.exact && $0.metadata.kind != .opaqueArchive }
            let active = exact.filter { superseded[$0.versionID] == nil }
            var blocked = damagedDependencies.union(invalidCorrections)
            if !damagedDependencies.isEmpty {
                conflicts.append(.init(code: "damaged_correction_dependency", versionIDs: damagedDependencies.sorted()))
            }
            for group in Dictionary(grouping: active, by: \.logicalID).values where group.count > 1 {
                let ids = group.map(\.versionID).sorted(); blocked.formUnion(ids)
                conflicts.append(.init(code: "immutable_identity_revision_conflict", versionIDs: ids))
            }
            let assertions = active.filter { $0.metadata.assertion != nil }
            let assertionGroups = Dictionary(grouping: assertions) { item in
                try! Self.key([item.metadata.scope.threadID, item.metadata.scope.projectID ?? "", item.metadata.scope.entityID ?? "",
                               item.metadata.scope.objectID ?? "", item.metadata.assertion!.field])
            }
            for group in assertionGroups.values where Set(group.map { $0.metadata.assertion!.value }).count > 1 {
                let ids = group.map(\.versionID).sorted(); blocked.formUnion(ids)
                conflicts.append(.init(code: "unresolved_assertion_contradiction", versionIDs: ids))
            }
            let currentRequest = query.kind == .latestState || query.kind == .currentObjectState || query.kind == .openQuestion
            func literalFallback(_ item: EpisodicMemoryItem) -> Bool {
                guard query.text?.isEmpty == false,
                      [.userMessage, .assistantMessage, .toolCall, .toolResult].contains(item.metadata.kind) else { return false }
                return query.kind == .entityRelation || query.kind == .rejectedPath || query.kind == .openQuestion
            }
            var candidates = exact.filter { item in
                guard matching.contains(where: { $0.versionID == item.versionID }) else { return false }
                if currentRequest && !literalFallback(item) && (superseded[item.versionID] != nil || blocked.contains(item.versionID) || item.metadata.timestamp == nil) { return false }
                switch query.kind {
                case .decisionHistory: return item.metadata.kind == .decision
                case .correctionHistory: return item.metadata.correction != nil || item.metadata.kind == .correction
                case .artifact: return item.metadata.kind == .artifact
                // Numerical evidence can be embedded in a raw user/tool record;
                // it need not have been reclassified or summarized at capture.
                case .numericResult: return true
                case .entityRelation: return item.metadata.kind == .entityRelation || literalFallback(item)
                case .openQuestion: return item.metadata.kind == .openQuestion || literalFallback(item)
                case .rejectedPath: return item.metadata.kind == .rejectedPath || literalFallback(item)
                default: return true
                }
            }
            // Latest resolves identity/time/supersession BEFORE lexical matching;
            // a lower-similarity explicit correction cannot lose to stale text.
            candidates.sort {
                if $0.metadata.timestamp != $1.metadata.timestamp { return ($0.metadata.timestamp ?? .distantPast) > ($1.metadata.timestamp ?? .distantPast) }
                return $0.versionID < $1.versionID
            }
            if query.kind == .latestState, let latest = candidates.first { candidates = [latest] }
            if query.kind == .historicalState || query.kind == .decisionHistory || query.kind == .correctionHistory {
                candidates.reverse()
            }
            var selected: [EpisodicMemoryHit] = [], injection = ""
            let ceiling = min(query.budgetBytes, query.budgetTokens) // one byte/token conservative admission bound
            for item in candidates {
                let raw = try read(item), chunks = Self.chunks(raw)
                if chunks.isEmpty { omissions.append(.init(versionID: item.versionID, rawSHA256: item.rawSHA256, byteStart: 0, byteEnd: raw.count, reason: "binary_source_external_read_required")); continue }
                let matchingRanges: [(Int, Int)]
                if let needle = query.text, !needle.isEmpty, (!currentRequest || query.kind == .openQuestion),
                   let fullText = String(data: raw, encoding: .utf8) {
                    var ranges: [(Int, Int)] = [], search = fullText.startIndex..<fullText.endIndex
                    while let range = fullText.range(of: needle, options: .caseInsensitive, range: search) {
                        ranges.append((fullText[..<range.lowerBound].utf8.count, fullText[..<range.upperBound].utf8.count))
                        guard range.upperBound < fullText.endIndex else { break }
                        search = range.upperBound..<fullText.endIndex
                    }
                    matchingRanges = ranges
                } else { matchingRanges = [(0, raw.count)] }
                for (start, end, text) in chunks {
                    // An exact search term can straddle a fixed page boundary.
                    // Page both intersecting ranges, rather than falsely UNKNOWN.
                    guard matchingRanges.contains(where: { $0.0 < end && $0.1 > start }) else { continue }
                    if query.kind == .numericResult && text.range(of: #"[-+]?\d+(?:\.\d+)?(?:/\d+)?%?"#,
                                                                 options: .regularExpression) == nil { continue }
                    let hit = EpisodicMemoryHit(item: item, byteStart: start, byteEnd: end,
                        chunkSHA256: SourceContextStore.digest(raw.subdata(in: start..<end)), text: text,
                        retrievalReason: query.kind.rawValue + (literalFallback(item) ? ":UNCLASSIFIED_HISTORICAL_LITERAL_MATCH" : ""),
                        current: currentRequest && !literalFallback(item) && item.metadata.timestamp != nil &&
                            superseded[item.versionID] == nil && !blocked.contains(item.versionID),
                        supersededBy: (superseded[item.versionID] ?? []).sorted())
                    let block = Self.block(hit)
                    if selected.count >= query.maximumHits || injection.utf8.count + block.utf8.count > ceiling {
                        omissions.append(.init(versionID: item.versionID, rawSHA256: item.rawSHA256, byteStart: start, byteEnd: end, reason: "context_budget")); continue
                    }
                    selected.append(hit); injection += block
                }
            }
            // Derived caches are never evidence. Disagreement is audited, then
            // reconstructed from originals; a cache cannot supersede raw history.
            for cache in valid where !cache.metadata.exact {
                if let assertion = cache.metadata.assertion {
                    let sourceMatches = active.filter { $0.metadata.scope == cache.metadata.scope && $0.metadata.assertion?.field == assertion.field }
                    if !sourceMatches.isEmpty && !sourceMatches.allSatisfy({ $0.metadata.assertion?.value == assertion.value }) {
                        conflicts.append(.init(code: "derived_cache_rollback", versionIDs: [cache.versionID] + sourceMatches.map(\.versionID).sorted()))
                    }
                }
                omissions.append(.init(versionID: cache.versionID, rawSHA256: cache.rawSHA256, byteStart: nil, byteEnd: nil, reason: "derived_cache_not_evidence"))
            }
            if selected.isEmpty, ceiling >= 7 { injection = "UNKNOWN" }
            let indexData = FileManager.default.fileExists(atPath: indexURL.path) ? try safeRead(indexURL, maximum: 128 * 1_024 * 1_024) : Data()
            let receipt = EpisodicMemoryReceipt(format: Self.format, query: query, createdAt: now,
                indexSHA256: SourceContextStore.digest(indexData), hits: selected, omissions: omissions,
                conflicts: conflicts, unknown: selected.isEmpty, injectionSHA256: SourceContextStore.digest(Data(injection.utf8)),
                injectionBytes: injection.utf8.count, tokenUpperBound: injection.utf8.count)
            let receiptRef = try sourceStore.write(try Self.encoded(receipt))
            return EpisodicMemoryRetrieval(hits: selected, injectionText: injection, receipt: receipt, receiptReference: receiptRef)
        }
    }

    /// Replay the exact historical page, not a fresh query whose latest state
    /// might have changed. Every referenced original and byte range is checked.
    public func replay(_ reference: SourceReference) throws -> EpisodicMemoryRetrieval {
        try locked {
            let receipt = try JSONDecoder().decode(EpisodicMemoryReceipt.self, from: sourceStore.read(reference))
            guard receipt.format == Self.format else { throw EpisodicMemoryError.invalidReceipt }
            let inventory = try inventoryUnlocked()
            let byID = Dictionary(uniqueKeysWithValues: inventory.map { ($0.versionID, $0) })
            var lineageDepths: [String: Int] = [:], lineageRawStatus: [String: Bool] = [:]
            var injection = ""
            for hit in receipt.hits {
                guard inventory.contains(hit.item) else { throw EpisodicMemoryError.invalidReceipt }
                var visiting = Set<String>(), visited = 0
                guard validLineage(hit.item, byID: byID, depths: &lineageDepths, rawStatus: &lineageRawStatus,
                                   visiting: &visiting, visited: &visited) else { throw EpisodicMemoryError.invalidProvenance }
                let raw = try read(hit.item)
                guard hit.byteStart >= 0, hit.byteEnd > hit.byteStart, hit.byteEnd <= raw.count else { throw EpisodicMemoryError.invalidReceipt }
                let chunk = raw.subdata(in: hit.byteStart..<hit.byteEnd)
                guard SourceContextStore.digest(chunk) == hit.chunkSHA256, Data(hit.text.utf8) == chunk else { throw EpisodicMemoryError.invalidReceipt }
                injection += Self.block(hit)
            }
            if receipt.hits.isEmpty, min(receipt.query.budgetBytes, receipt.query.budgetTokens) >= 7 { injection = "UNKNOWN" }
            guard injection.utf8.count == receipt.injectionBytes, receipt.tokenUpperBound == injection.utf8.count,
                  injection.utf8.count <= min(receipt.query.budgetBytes, receipt.query.budgetTokens),
                  SourceContextStore.digest(Data(injection.utf8)) == receipt.injectionSHA256 else { throw EpisodicMemoryError.invalidReceipt }
            return EpisodicMemoryRetrieval(hits: receipt.hits, injectionText: injection, receipt: receipt, receiptReference: reference)
        }
    }
}
