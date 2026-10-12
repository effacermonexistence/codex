import CryptoKit
import Darwin
import Foundation

/// Local durability only. This record never confers native-host permission,
/// dispatches a request, or turns a relay assertion into a ChatGPT response.
public struct DesktopRelayBinding: Codable, Equatable, Sendable {
    public let requestID: String
    public let taskID: String
    public let requestSHA256: String
    public let relayThreadID: String
    public let clientUserMessageID: String
    public let targetThreadID: String
    public let nonce: String

    public init(requestID: String, taskID: String, requestSHA256: String,
                relayThreadID: String, clientUserMessageID: String,
                targetThreadID: String, nonce: String) throws {
        self.requestID = requestID; self.taskID = taskID; self.requestSHA256 = requestSHA256
        self.relayThreadID = relayThreadID.lowercased(); self.clientUserMessageID = clientUserMessageID.lowercased()
        self.targetThreadID = targetThreadID.lowercased(); self.nonce = nonce
        try validate()
    }
    fileprivate func validate() throws {
        guard Self.identifier(requestID), Self.identifier(taskID), Self.identifier(nonce),
              requestSHA256.count == 64, requestSHA256.allSatisfy({ "0123456789abcdef".contains($0) }),
              UUID(uuidString: relayThreadID) != nil, UUID(uuidString: clientUserMessageID) != nil,
              UUID(uuidString: targetThreadID) != nil, UUID(uuidString: relayThreadID) != UUID(uuidString: targetThreadID),
              relayThreadID == relayThreadID.lowercased(), clientUserMessageID == clientUserMessageID.lowercased(),
              targetThreadID == targetThreadID.lowercased()
        else { throw DesktopRelayCheckpointError.invalidBinding }
    }
    fileprivate static func identifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 160 && value.allSatisfy {
            $0.isASCII && ($0.isLetter || $0.isNumber || "._-".contains($0))
        }
    }
}

public enum DesktopRelayCheckpointError: Error, Equatable {
    case invalidBinding, unsafePath, oversized, invalidRecord, bindingMismatch
    case alreadyExists, missingIntent, invalidTransition, evidenceRejected
}
public enum DesktopRelayCheckpointStatus: String, Codable, Sendable {
    case dispatchIntent, acknowledged, pending, observerCompleted, completed
    case blockedAuthorization, cancelled, rejected
    public var isTerminal: Bool {
        [.completed, .blockedAuthorization, .cancelled, .rejected].contains(self)
    }
}
public enum DesktopRelayPendingReason: String, Codable, Sendable {
    case deadline, disconnected, observationUnavailable
}
public enum DesktopRelayResponseSource: String, Codable, Sendable {
    case officialThreadRead, relayAssertion, selfComputed
}
public enum DesktopRelayCodexUsage: String, Codable, Sendable {
    case unknown, nonzero // Never represent a dispatched Codex relay as free.
}
public struct DesktopRelayObserverCompletion: Codable, Equatable, Sendable {
    public let turnID: String
    public let rawOutput: String
    public let nativeRecordID: String
}
public struct DesktopRelayTargetSend: Codable, Equatable, Sendable {
    public let targetUserMessageID: String
    public let previousAssistantMessageID: String?
}
public struct DesktopRelayChatResponse: Codable, Equatable, Sendable {
    public let targetThreadID: String
    public let targetUserMessageID: String
    public let assistantMessageID: String
    public let rawResponse: String
    public let source: DesktopRelayResponseSource
}
public struct DesktopRelayCheckpoint: Codable, Equatable, Sendable {
    public let schema: Int
    public let binding: DesktopRelayBinding
    public fileprivate(set) var revision: Int
    public fileprivate(set) var status: DesktopRelayCheckpointStatus
    public fileprivate(set) var turnID: String?
    public let createdAt: Date
    public fileprivate(set) var updatedAt: Date
    public fileprivate(set) var pendingReason: DesktopRelayPendingReason?
    public fileprivate(set) var failureReason: String?
    public fileprivate(set) var observerCompletion: DesktopRelayObserverCompletion?
    public fileprivate(set) var targetSend: DesktopRelayTargetSend?
    public fileprivate(set) var response: DesktopRelayChatResponse?
    public fileprivate(set) var codexRelayUsage: DesktopRelayCodexUsage
    public let chatGPTQuotaDebit: String // Unknown is not a zero-quota claim.
    public var replayPermitted: Bool { false }

    fileprivate init(binding: DesktopRelayBinding, now: Date) {
        self.schema = 1; self.binding = binding; self.revision = 0; self.status = .dispatchIntent
        self.createdAt = now; self.updatedAt = now; self.codexRelayUsage = .unknown
        self.chatGPTQuotaDebit = "UNKNOWN"
    }
    fileprivate func validate() throws {
        try binding.validate()
        guard schema == 1, revision >= 0, createdAt.timeIntervalSince1970.isFinite,
              updatedAt.timeIntervalSince1970.isFinite, updatedAt >= createdAt,
              chatGPTQuotaDebit == "UNKNOWN", turnID.map({ UUID(uuidString: $0) != nil }) ?? true,
              failureReason.map({ !$0.isEmpty && $0.utf8.count <= 2_048 }) ?? true
        else { throw DesktopRelayCheckpointError.invalidRecord }
        if let observation = observerCompletion {
            guard observation.turnID == turnID, Self.output(observation.rawOutput),
                  DesktopRelayBinding.identifier(observation.nativeRecordID)
            else { throw DesktopRelayCheckpointError.invalidRecord }
        }
        if let send = targetSend {
            guard UUID(uuidString: send.targetUserMessageID) != nil,
                  send.previousAssistantMessageID.map({ UUID(uuidString: $0) != nil }) ?? true
            else { throw DesktopRelayCheckpointError.invalidRecord }
        }
        if let response {
            guard response.source == .officialThreadRead, response.targetThreadID == binding.targetThreadID,
                  response.targetUserMessageID == targetSend?.targetUserMessageID,
                  UUID(uuidString: response.assistantMessageID) != nil,
                  response.assistantMessageID != targetSend?.previousAssistantMessageID,
                  response.assistantMessageID != response.targetUserMessageID,
                  response.assistantMessageID != binding.clientUserMessageID,
                  Self.output(response.rawResponse), response.rawResponse.contains(binding.nonce)
            else { throw DesktopRelayCheckpointError.invalidRecord }
        }
        switch status {
        case .dispatchIntent:
            guard turnID == nil, observerCompletion == nil, targetSend == nil, response == nil,
                  pendingReason == nil, failureReason == nil else { throw DesktopRelayCheckpointError.invalidRecord }
        case .acknowledged:
            guard turnID != nil, observerCompletion == nil, response == nil,
                  pendingReason == nil, failureReason == nil else { throw DesktopRelayCheckpointError.invalidRecord }
        case .pending:
            guard pendingReason != nil, failureReason == nil, response == nil
            else { throw DesktopRelayCheckpointError.invalidRecord }
        case .observerCompleted:
            guard observerCompletion != nil, response == nil, pendingReason == nil, failureReason == nil
            else { throw DesktopRelayCheckpointError.invalidRecord }
        case .completed:
            guard observerCompletion != nil, response != nil, pendingReason == nil, failureReason == nil
            else { throw DesktopRelayCheckpointError.invalidRecord }
        case .blockedAuthorization, .rejected:
            guard failureReason != nil, pendingReason == nil, response == nil
            else { throw DesktopRelayCheckpointError.invalidRecord }
        case .cancelled:
            guard response == nil, pendingReason == nil else { throw DesktopRelayCheckpointError.invalidRecord }
        }
    }
    fileprivate static func output(_ value: String) -> Bool {
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf8.count <= 1_048_576
    }
}

/// A dedicated private directory with locked, atomic records. It never modifies
/// parent permissions, live sessions, queues, configurations or credentials.
public struct DesktopRelayCheckpointStore: Sendable {
    public let rootURL: URL
    private static let maximumBytes = 2_200_000

    public init(rootURL: URL) throws {
        guard rootURL.isFileURL, rootURL.path.hasPrefix("/"), rootURL.path != "/",
              rootURL == rootURL.standardizedFileURL,
              rootURL.resolvingSymlinksInPath() == rootURL.standardizedFileURL
        else { throw DesktopRelayCheckpointError.unsafePath }
        self.rootURL = rootURL
        let fd = try openRoot(create: true); Darwin.close(fd)
    }
    public func fileURL(binding: DesktopRelayBinding) throws -> URL {
        try binding.validate()
        // Request identity owns one slot. Changing its content/target must fail,
        // not silently create a second dispatch under the same request ID.
        return rootURL.appendingPathComponent(Self.key(binding.requestID) + ".json")
    }
    public func load(binding: DesktopRelayBinding) throws -> DesktopRelayCheckpoint? {
        try withLock { root in try read(binding: binding, root: root) }
    }
    @discardableResult public func createIntent(binding: DesktopRelayBinding, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        try binding.validate()
        return try withLock { root in
            guard try read(binding: binding, root: root) == nil else { throw DesktopRelayCheckpointError.alreadyExists }
            let record = DesktopRelayCheckpoint(binding: binding, now: now)
            try write(record, root: root); return record
        }
    }
    @discardableResult public func acknowledge(binding: DesktopRelayBinding, turnID: String, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        let turnID = turnID.lowercased()
        return try mutate(binding: binding, now: now) { record in
            guard UUID(uuidString: turnID) != nil else { throw DesktopRelayCheckpointError.invalidBinding }
            if record.turnID == turnID { return }
            guard record.turnID == nil, !record.status.isTerminal,
                  [.dispatchIntent, .pending].contains(record.status)
            else { throw DesktopRelayCheckpointError.invalidTransition }
            record.turnID = turnID; record.status = .acknowledged; record.pendingReason = nil
        }
    }
    @discardableResult public func markPending(binding: DesktopRelayBinding, reason: DesktopRelayPendingReason, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        try mutate(binding: binding, now: now) { record in
            guard !record.status.isTerminal, record.observerCompletion == nil else { throw DesktopRelayCheckpointError.invalidTransition }
            record.status = .pending; record.pendingReason = reason
        }
    }
    @discardableResult public func markBlockedAuthorization(binding: DesktopRelayBinding, reason: String, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        try fail(binding: binding, status: .blockedAuthorization, reason: reason, now: now)
    }
    @discardableResult public func markRejected(binding: DesktopRelayBinding, reason: String, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        try fail(binding: binding, status: .rejected, reason: reason, now: now)
    }
    @discardableResult public func cancel(binding: DesktopRelayBinding, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        try mutate(binding: binding, now: now) { record in
            guard !record.status.isTerminal else { throw DesktopRelayCheckpointError.invalidTransition }
            record.status = .cancelled; record.pendingReason = nil
        }
    }
    @discardableResult public func recordObserverCompletion(binding: DesktopRelayBinding, turnID: String, rawOutput: String,
                                                           nativeRecordID: String, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        let turnID = turnID.lowercased()
        return try mutate(binding: binding, now: now) { record in
            let observation = DesktopRelayObserverCompletion(turnID: turnID, rawOutput: rawOutput, nativeRecordID: nativeRecordID)
            if record.observerCompletion == observation { return }
            guard !record.status.isTerminal, record.turnID == turnID, record.observerCompletion == nil,
                  DesktopRelayCheckpoint.output(rawOutput), DesktopRelayBinding.identifier(nativeRecordID)
            else { throw DesktopRelayCheckpointError.evidenceRejected }
            record.observerCompletion = observation; record.status = .observerCompleted; record.pendingReason = nil
        }
    }
    @discardableResult public func recordTargetSend(binding: DesktopRelayBinding, targetUserMessageID: String,
                                                   previousAssistantMessageID: String?, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        let targetUserMessageID = targetUserMessageID.lowercased()
        let previousAssistantMessageID = previousAssistantMessageID?.lowercased()
        return try mutate(binding: binding, now: now) { record in
            let send = DesktopRelayTargetSend(targetUserMessageID: targetUserMessageID, previousAssistantMessageID: previousAssistantMessageID)
            if record.targetSend == send { return }
            guard !record.status.isTerminal, record.turnID != nil, record.targetSend == nil,
                  UUID(uuidString: targetUserMessageID) != nil,
                  previousAssistantMessageID.map({ UUID(uuidString: $0) != nil }) ?? true
            else { throw DesktopRelayCheckpointError.evidenceRejected }
            record.targetSend = send
        }
    }
    @discardableResult public func adoptResponse(binding: DesktopRelayBinding, targetUserMessageID: String, assistantMessageID: String,
                                                rawResponse: String, source: DesktopRelayResponseSource,
                                                now: Date = Date()) throws -> DesktopRelayCheckpoint {
        let targetUserMessageID = targetUserMessageID.lowercased()
        let assistantMessageID = assistantMessageID.lowercased()
        return try mutate(binding: binding, now: now) { record in
            guard record.status == .observerCompleted, source == .officialThreadRead,
                  record.targetSend?.targetUserMessageID == targetUserMessageID
            else { throw DesktopRelayCheckpointError.evidenceRejected }
            record.response = DesktopRelayChatResponse(targetThreadID: binding.targetThreadID,
                targetUserMessageID: targetUserMessageID, assistantMessageID: assistantMessageID,
                rawResponse: rawResponse, source: source)
            record.status = .completed
        }
    }
    @discardableResult public func recordNonzeroCodexUsage(binding: DesktopRelayBinding, now: Date = Date()) throws -> DesktopRelayCheckpoint {
        try mutate(binding: binding, now: now) { $0.codexRelayUsage = .nonzero }
    }
    private func fail(binding: DesktopRelayBinding, status: DesktopRelayCheckpointStatus, reason: String, now: Date) throws -> DesktopRelayCheckpoint {
        try mutate(binding: binding, now: now) { record in
            guard !record.status.isTerminal, !reason.isEmpty, reason.utf8.count <= 2_048
            else { throw DesktopRelayCheckpointError.invalidTransition }
            record.status = status; record.failureReason = reason; record.pendingReason = nil
        }
    }
    private func mutate(binding: DesktopRelayBinding, now: Date, _ body: (inout DesktopRelayCheckpoint) throws -> Void) throws -> DesktopRelayCheckpoint {
        try withLock { root in
            guard var record = try read(binding: binding, root: root) else { throw DesktopRelayCheckpointError.missingIntent }
            guard now.timeIntervalSince1970.isFinite, now >= record.updatedAt else { throw DesktopRelayCheckpointError.invalidRecord }
            let original = record; try body(&record)
            if record == original { return original }
            record.revision += 1; record.updatedAt = now
            try write(record, root: root); return record
        }
    }
    private static func key(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func openRoot(create: Bool) throws -> Int32 {
        guard rootURL.resolvingSymlinksInPath() == rootURL.standardizedFileURL else { throw DesktopRelayCheckpointError.unsafePath }
        let parent = rootURL.deletingLastPathComponent()
        guard parent.resolvingSymlinksInPath() == parent.standardizedFileURL else { throw DesktopRelayCheckpointError.unsafePath }
        let parentFD = Darwin.open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard parentFD >= 0 else { throw DesktopRelayCheckpointError.unsafePath }
        defer { Darwin.close(parentFD) }
        if create, mkdirat(parentFD, rootURL.lastPathComponent, 0o700) != 0, errno != EEXIST { throw DesktopRelayCheckpointError.unsafePath }
        let fd = openat(parentFD, rootURL.lastPathComponent, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw DesktopRelayCheckpointError.unsafePath }
        var info = stat()
        guard fstat(fd, &info) == 0, info.st_uid == getuid(), (info.st_mode & 0o077) == 0 else {
            Darwin.close(fd); throw DesktopRelayCheckpointError.unsafePath
        }
        return fd
    }
    private func withLock<T>(_ body: (Int32) throws -> T) throws -> T {
        let root = try openRoot(create: false); defer { Darwin.close(root) }
        let lock = openat(root, ".checkpoint.lock", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard lock >= 0 else { throw DesktopRelayCheckpointError.unsafePath }
        defer { Darwin.close(lock) }
        try checkFile(lock)
        guard flock(lock, LOCK_EX) == 0 else { throw DesktopRelayCheckpointError.unsafePath }
        defer { _ = flock(lock, LOCK_UN) }
        return try body(root)
    }
    private func checkFile(_ fd: Int32) throws {
        var info = stat()
        guard fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG, info.st_nlink == 1,
              info.st_uid == getuid(), (info.st_mode & 0o077) == 0, info.st_size >= 0,
              info.st_size <= Self.maximumBytes else { throw DesktopRelayCheckpointError.unsafePath }
    }
    private func read(binding: DesktopRelayBinding, root: Int32) throws -> DesktopRelayCheckpoint? {
        let name = try fileURL(binding: binding).lastPathComponent
        let fd = openat(root, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard fd >= 0 else { if errno == ENOENT { return nil }; throw DesktopRelayCheckpointError.unsafePath }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true); defer { try? handle.close() }
        try checkFile(fd)
        let data = try handle.read(upToCount: Self.maximumBytes + 1) ?? Data()
        guard data.count <= Self.maximumBytes else { throw DesktopRelayCheckpointError.oversized }
        let record = try JSONDecoder().decode(DesktopRelayCheckpoint.self, from: data)
        try record.validate()
        guard record.binding == binding else { throw DesktopRelayCheckpointError.bindingMismatch }
        return record
    }
    private func write(_ record: DesktopRelayCheckpoint, root: Int32) throws {
        try record.validate()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(record)
        guard data.count <= Self.maximumBytes else { throw DesktopRelayCheckpointError.oversized }
        let name = try fileURL(binding: record.binding).lastPathComponent
        // Never replace a foreign inode, symlink or more-permissive file.
        let existing = openat(root, name, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        if existing >= 0 { defer { Darwin.close(existing) }; try checkFile(existing) }
        else if errno != ENOENT { throw DesktopRelayCheckpointError.unsafePath }
        let temporary = ".checkpoint-" + UUID().uuidString.lowercased()
        let fd = openat(root, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw DesktopRelayCheckpointError.unsafePath }
        defer { _ = unlinkat(root, temporary, 0) }
        let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: true)
        do { try handle.write(contentsOf: data); try handle.synchronize(); try handle.close() }
        catch { try? handle.close(); throw error }
        guard renameat(root, temporary, root, name) == 0, fsync(root) == 0 else { throw DesktopRelayCheckpointError.unsafePath }
        guard let saved = try read(binding: record.binding, root: root), saved == record else { throw DesktopRelayCheckpointError.invalidRecord }
    }
}
