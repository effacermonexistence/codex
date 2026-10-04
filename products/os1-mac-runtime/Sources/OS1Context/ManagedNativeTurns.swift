import Foundation
import CryptoKit

public struct LegacyOwnershipReadDiagnostics: Sendable {
    public var bytesRead: Int = 0
    public var fullHashes: Int = 0
    public var decodedSnapshots: Int = 0
    public var metadataHits: Int = 0
}

/// Cache only verified outbox metadata, never outputs, credentials, negative
/// verification results or native-record claims. Each query captures and hashes
/// EVERY admitted current file before lookup. A same-size/mtime replacement is
/// therefore a miss. Native proof remains freshly checked for unowned turns.
private final class LegacyOwnershipMetadataCache: @unchecked Sendable {
    static let shared = LegacyOwnershipMetadataCache()
    private struct Key: Hashable { let root: String; let filename: String }
    struct Metadata {
        let provider: String?
        let sessionID: String?
        let submissionID: UUID?
        let turnID: String?
    }
    private struct Entry { let sha: Data; let metadata: Metadata; var used: UInt64 }
    private let lock = NSLock()
    private var entries: [Key: Entry] = [:]
    private var statistics: [String: LegacyOwnershipReadDiagnostics] = [:]
    private var clock: UInt64 = 0
    private let capacity = 4096
    func root(_ outbox: DeliveryOutbox) -> String { outbox.root.resolvingSymlinksInPath().standardizedFileURL.path }
    func diagnostics(_ root: String) -> LegacyOwnershipReadDiagnostics {
        lock.lock(); defer { lock.unlock() }; return statistics[root] ?? LegacyOwnershipReadDiagnostics()
    }
    func prune(root: String, filenames: Set<String>) {
        lock.lock(); defer { lock.unlock() }
        entries = entries.filter { $0.key.root != root || filenames.contains($0.key.filename) }
        if statistics[root] == nil, statistics.count >= 16 { statistics.removeValue(forKey: statistics.keys.sorted().first!) }
    }
    func invalidate(root: String, filename: String) {
        lock.lock(); defer { lock.unlock() }; entries.removeValue(forKey: Key(root: root, filename: filename))
    }
    func metadata(file: URL, outbox: DeliveryOutbox) throws -> (Metadata, DeliveryRecord?, Data) {
        let namespace = root(outbox), key = Key(root: namespace, filename: file.lastPathComponent)
        do {
            let attrs = try FileManager.default.attributesOfItem(atPath: file.path)
            guard attrs[.type] as? FileAttributeType == .typeRegular,
                  (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 8_000_000 else {
                throw CocoaError(.fileReadCorruptFile)
            }
            let bytes = try Data(contentsOf: file)
            guard bytes.count <= 8_000_000 else { throw CocoaError(.fileReadCorruptFile) }
            let sha = Data(SHA256.hash(data: bytes))
            lock.lock()
            var stats = statistics[namespace] ?? LegacyOwnershipReadDiagnostics()
            stats.bytesRead += bytes.count; stats.fullHashes += 1
            clock &+= 1
            if var entry = entries[key], entry.sha == sha {
                entry.used = clock; entries[key] = entry; stats.metadataHits += 1; statistics[namespace] = stats
                lock.unlock()
                return (entry.metadata, nil, bytes)
            }
            stats.decodedSnapshots += 1; statistics[namespace] = stats
            lock.unlock()
            // The decoder and old artifact/identity verifier receive EXACTLY
            // the byte snapshot whose complete SHA forms this cache key.
            let delivery = try outbox.verifiedSnapshot(file.deletingPathExtension().lastPathComponent, bytes: bytes)
            let step = try JSONSerialization.jsonObject(with: delivery.step) as? [String: Any]
            let native = step?["native_record"] as? [String: Any]
            let value = Metadata(provider: step?["provider"] as? String,
                sessionID: step?["session_id"] as? String,
                submissionID: delivery.submissionID.flatMap(UUID.init(uuidString:)), turnID: native?["turn_id"] as? String)
            lock.lock(); clock &+= 1
            if entries[key] == nil, entries.count >= capacity,
               let oldest = entries.min(by: { $0.value.used < $1.value.used })?.key { entries.removeValue(forKey: oldest) }
            entries[key] = Entry(sha: sha, metadata: value, used: clock); lock.unlock()
            return (value, delivery, bytes)
        } catch {
            invalidate(root: namespace, filename: file.lastPathComponent)
            throw error
        }
    }
}

/// Transport role `user` is not authorship. This local ledger records which
/// turns OS1 started, independently of final-result adoption or retry success.
public struct ManagedNativeTurns: Sendable {
    public struct Entry: Codable, Sendable {
        public let submissionID: UUID
        public let threadID: String
        public let turnID: String
    }
    public let root: URL
    public init(root: URL? = nil) {
        self.root = root ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/managed-native-turns")
    }
    private func directory(_ threadID: String) -> URL {
        root.appendingPathComponent(NativeIngestion.digestOf(threadID), isDirectory: true)
    }
    public func record(submissionID: UUID, threadID: String, turnID: String) throws {
        guard !threadID.isEmpty, !turnID.isEmpty, threadID.utf8.count < 256, turnID.utf8.count < 256 else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        let dir = directory(threadID)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let url = dir.appendingPathComponent(NativeIngestion.digestOf(turnID) + ".json")
        let bytes = try JSONEncoder().encode(Entry(submissionID: submissionID, threadID: threadID, turnID: turnID))
        try bytes.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    public func ownedTurns(threadID: String) -> Set<String> {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory(threadID), includingPropertiesForKeys: nil)) ?? []
        return Set(files.compactMap { url -> String? in
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                  attrs[.type] as? FileAttributeType == .typeRegular,
                  (attrs[.size] as? NSNumber)?.intValue ?? Int.max < 4096,
                  let bytes = try? Data(contentsOf: url), let entry = try? JSONDecoder().decode(Entry.self, from: bytes),
                  entry.threadID == threadID,
                  url.lastPathComponent == NativeIngestion.digestOf(entry.turnID) + ".json" else { return nil }
            return entry.turnID
        })
    }
    /// Backfill only independently verified private outbox records, never a
    /// prompt prefix, echoed receipt, native role, or unverified model claim.
    public func recoverLegacy(threadID: String, outbox: DeliveryOutbox = DeliveryOutbox(), persistRecovered: Bool = true) -> Set<String> {
        var owned = ownedTurns(threadID: threadID)
        let files = (try? FileManager.default.contentsOfDirectory(at: outbox.root, includingPropertiesForKeys: nil)) ?? []
        let cache = LegacyOwnershipMetadataCache.shared
        cache.prune(root: cache.root(outbox), filenames: Set(files.filter { $0.pathExtension == "json" }.map(\.lastPathComponent)))
        for file in files where file.pathExtension == "json" {
            guard let (metadata, captured, bytes) = try? cache.metadata(file: file, outbox: outbox),
                  let submission = metadata.submissionID,
                  metadata.provider == "codex", metadata.sessionID == threadID,
                  let turn = metadata.turnID, !owned.contains(turn) else { continue }
            // A hit cached IDs, not a native-proof verdict. Preserve the full
            // old verifier for every newly recovered ownership candidate.
            guard let delivery = captured ?? (try? outbox.verifiedSnapshot(file.deletingPathExtension().lastPathComponent, bytes: bytes)),
                  SavedResultEvidence.codexRecordVerified(delivery) else { continue }
            // Even if persistence is temporarily unavailable, this verified
            // ownership must be honored in the current readback.
            owned.insert(turn)
            if persistRecovered { try? record(submissionID: submission, threadID: threadID, turnID: turn) }
        }
        return owned
    }
    public func legacyReadDiagnostics(outbox: DeliveryOutbox = DeliveryOutbox()) -> LegacyOwnershipReadDiagnostics {
        let cache = LegacyOwnershipMetadataCache.shared
        return cache.diagnostics(cache.root(outbox))
    }
}
