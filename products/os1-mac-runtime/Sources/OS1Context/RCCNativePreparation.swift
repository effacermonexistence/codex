import Darwin
import Foundation

/// An already selected native attempt needs only its own provider's metadata.
/// This helper never selects a provider, substitutes a route, or authorizes a
/// capability. The caller still validates the observed inventory and ticket.
public enum RCCNativePreparation {
    public enum Failure: Error { case unknownProvider, invalidTimingBinding, timingCustody, timingWrite }

    public struct Observations<Codex, Claude> {
        public let codex: Codex?
        public let claude: Claude?
    }

    public static func collect<Codex, Claude>(provider: String,
        codex: () throws -> Codex, claude: () throws -> Claude) throws -> Observations<Codex, Claude> {
        switch provider {
        case "codex": return try Observations(codex: codex(), claude: nil)
        case "claude": return try Observations(codex: nil, claude: claude())
        default: throw Failure.unknownProvider
        }
    }
}

/// Private, attempt-bound diagnostic timings only. No prompt, output, auth
/// material, native session contents, or authorization decision is recorded.
/// A missing/failed timing write never changes the execution's own outcome.
public final class RCCNativePreparationTiming: @unchecked Sendable {
    public enum Phase: String, Codable, Sendable {
        case adapterEntered = "adapter_entered"
        case inventoryStarted = "inventory_started", inventoryReady = "inventory_ready"
        case authorizationStarted = "authorization_started", authorizationReady = "authorization_ready"
        case workspaceHashStarted = "workspace_hash_started", workspaceHashReady = "workspace_hash_ready"
        case executeStarted = "execute_started", executeReturned = "execute_returned"
        case attemptFailed = "attempt_failed"
        case receiptPersistStarted = "receipt_persist_started", receiptPersisted = "receipt_persisted"
        case receiptPersistFailed = "receipt_persist_failed"
    }
    public struct Mark: Codable, Sendable {
        public let phase: Phase
        public let elapsedMS: Int64
        enum CodingKeys: String, CodingKey { case phase, elapsedMS = "elapsed_ms" }
    }
    public struct Record: Codable, Sendable {
        public let schema: Int
        public let taskID: String, nodeID: String, attemptID: String
        public let configurationSHA256: String, sourceFingerprint: String, provider: String
        public let startedAt: Date, receiptPersisted: Bool, executionStatus: String, executionVerified: Bool
        public let marks: [Mark]
        enum CodingKeys: String, CodingKey {
            case schema, provider, marks
            case taskID = "task_id", nodeID = "node_id", attemptID = "attempt_id"
            case configurationSHA256 = "configuration_sha256", sourceFingerprint = "source_fingerprint"
            case startedAt = "started_at", receiptPersisted = "receipt_persisted"
            case executionStatus = "execution_status", executionVerified = "execution_verified"
        }
    }
    private let lock = NSLock()
    private let taskID: String, nodeID: String, attemptID: String
    private let configurationSHA256: String, sourceFingerprint: String, provider: String
    private let startedAt: Date, startedUptime: TimeInterval
    private var marks: [Mark] = []

    public init(taskID: String, nodeID: String, attemptID: String,
                configurationSHA256: String, sourceFingerprint: String, provider: String) throws {
        let digest = { (value: String) in value.count == 64 && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0)
        } }
        guard UUID(uuidString: taskID) != nil, UUID(uuidString: attemptID) != nil,
              !nodeID.isEmpty, nodeID.utf8.count <= 128,
              nodeID.utf8.allSatisfy({ (48...57).contains($0) || (65...90).contains($0) ||
                  (97...122).contains($0) || $0 == 45 || $0 == 95 }),
              digest(configurationSHA256), digest(sourceFingerprint), ["codex", "claude"].contains(provider) else {
            throw RCCNativePreparation.Failure.invalidTimingBinding
        }
        self.taskID = taskID; self.nodeID = nodeID; self.attemptID = attemptID
        self.configurationSHA256 = configurationSHA256; self.sourceFingerprint = sourceFingerprint
        self.provider = provider; startedAt = Date(); startedUptime = ProcessInfo.processInfo.systemUptime
        mark(.adapterEntered)
    }

    public func mark(_ phase: Phase) {
        lock.lock(); defer { lock.unlock() }
        guard marks.count < 32 else { return }
        let milliseconds = max(0, (ProcessInfo.processInfo.systemUptime - startedUptime) * 1_000)
        guard milliseconds.isFinite, milliseconds <= Double(Int64.max) else { return }
        marks.append(Mark(phase: phase, elapsedMS: Int64(milliseconds.rounded())))
    }

    /// The existing private runtime root is required. Never follow a directory
    /// alias or overwrite a previous attempt's timing record. Root/directory
    /// descriptors, O_NOFOLLOW and O_EXCL keep diagnostics out of live data.
    @discardableResult
    public func persist(root: URL, receiptPersisted: Bool, executionStatus: String,
                        executionVerified: Bool) throws -> URL {
        guard ["succeeded", "failed", "effects_uncertain"].contains(executionStatus),
              root.standardizedFileURL.path == root.resolvingSymlinksInPath().standardizedFileURL.path else {
            throw RCCNativePreparation.Failure.timingCustody
        }
        func privateDirectory(_ fd: Int32) -> Bool {
            var info = stat()
            return fd >= 0 && fstat(fd, &info) == 0 && (info.st_mode & S_IFMT) == S_IFDIR &&
                info.st_uid == geteuid() && (info.st_mode & 0o077) == 0
        }
        let rootFD = Darwin.open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard privateDirectory(rootFD) else {
            if rootFD >= 0 { Darwin.close(rootFD) }
            throw RCCNativePreparation.Failure.timingCustody
        }
        defer { Darwin.close(rootFD) }
        if mkdirat(rootFD, "native-timings", 0o700) != 0 && errno != EEXIST {
            throw RCCNativePreparation.Failure.timingCustody
        }
        let directoryFD = openat(rootFD, "native-timings", O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
        guard privateDirectory(directoryFD) else {
            if directoryFD >= 0 { Darwin.close(directoryFD) }
            throw RCCNativePreparation.Failure.timingCustody
        }
        defer { Darwin.close(directoryFD) }
        lock.lock()
        let record = Record(schema: 1, taskID: taskID, nodeID: nodeID, attemptID: attemptID,
            configurationSHA256: configurationSHA256, sourceFingerprint: sourceFingerprint, provider: provider,
            startedAt: startedAt, receiptPersisted: receiptPersisted, executionStatus: executionStatus,
            executionVerified: executionVerified, marks: marks)
        lock.unlock()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(record)
        guard data.count <= 8_192 else { throw RCCNativePreparation.Failure.timingWrite }
        let name = attemptID.lowercased() + ".json"
        let fd = openat(directoryFD, name, O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
        guard fd >= 0 else { throw RCCNativePreparation.Failure.timingCustody }
        defer { Darwin.close(fd) }
        var offset = 0
        while offset < data.count {
            let written = data.withUnsafeBytes { Darwin.write(fd, $0.baseAddress!.advanced(by: offset), data.count - offset) }
            guard written > 0 else { throw RCCNativePreparation.Failure.timingWrite }
            offset += written
        }
        var info = stat()
        guard fsync(fd) == 0, fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG,
              info.st_uid == geteuid(), info.st_nlink == 1, (info.st_mode & 0o077) == 0,
              info.st_size == data.count, lseek(fd, 0, SEEK_SET) == 0 else {
            throw RCCNativePreparation.Failure.timingCustody
        }
        var readBack = Data(count: data.count); offset = 0
        while offset < readBack.count {
            let remaining = readBack.count - offset
            let received = readBack.withUnsafeMutableBytes {
                Darwin.read(fd, $0.baseAddress!.advanced(by: offset), remaining)
            }
            guard received > 0 else { throw RCCNativePreparation.Failure.timingWrite }
            offset += received
        }
        guard readBack == data else { throw RCCNativePreparation.Failure.timingWrite }
        return root.appendingPathComponent("native-timings", isDirectory: true).appendingPathComponent(name)
    }
}
