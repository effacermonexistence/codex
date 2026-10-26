import Foundation
import Darwin

/// Presentation adoption only. This file is not a session database: it never
/// deletes, archives, replays, edits or starts a conversation or queued request.
/// A historical outcome is not silently recorded as having been reviewed.
public struct SimulationPresentationState: Codable, Equatable, Sendable {
    public static let filename = "simulation-presentation.json"
    public static let maximumBytes = 256 * 1_024
    public static let maximumEntries = 4_096
    public static let maximumRevisionBytes = 512

    public private(set) var baselineAt: Date
    public private(set) var reviewed: [String: String]
    public private(set) var deployedIDs: Set<String>

    public enum Failure: Error, Equatable, Sendable {
        case invalidState, unsafePath, tooLarge, io(Int32)
    }

    public init(baselineAt: Date = Date(), reviewed: [String: String] = [:], deployedIDs: Set<String> = []) {
        self.baselineAt = baselineAt.timeIntervalSince1970.isFinite ? baselineAt : Date()
        self.reviewed = [:]
        for (rawID, revision) in reviewed.prefix(Self.maximumEntries) {
            if let id = Self.identity(rawID), Self.validRevision(revision) { self.reviewed[id] = revision }
        }
        self.deployedIDs = Set(deployedIDs.prefix(Self.maximumEntries).compactMap(Self.identity))
    }

    public func hasReviewed(sessionID: String, revision: String?) -> Bool {
        guard let id = Self.identity(sessionID), let revision, Self.validRevision(revision) else { return false }
        return reviewed[id] == revision
    }

    /// The host supplies the revision of the result actually displayed. A
    /// selection, old result or in-flight/queued run cannot acknowledge a result.
    /// Repeated acknowledgement of the same result is successful and idempotent.
    @discardableResult
    public mutating func review(sessionID: String, revision: String?, inspectedRevision: String?,
                                isRunning: Bool, isQueued: Bool) -> Bool {
        guard !isRunning, !isQueued, let id = Self.identity(sessionID),
              let revision, Self.validRevision(revision), inspectedRevision == revision,
              reviewed[id] != nil || reviewed.count < Self.maximumEntries else { return false }
        let old = self
        reviewed[id] = revision
        deployedIDs.remove(id)
        guard (try? Self.encoded(self).count).map({ $0 <= Self.maximumBytes }) == true else { self = old; return false }
        return true
    }

    /// Explicitly bringing a session onto the field is UI state, not native
    /// task execution. Selecting/deploying it does not clear its review receipt.
    @discardableResult
    public mutating func deploy(sessionID: String) -> Bool {
        guard let id = Self.identity(sessionID), deployedIDs.contains(id) || deployedIDs.count < Self.maximumEntries else { return false }
        let old = self
        deployedIDs.insert(id)
        guard (try? Self.encoded(self).count).map({ $0 <= Self.maximumBytes }) == true else { self = old; return false }
        return true
    }

    /// Only an explicit reassignment path may choose to clear a review receipt.
    @discardableResult
    public mutating func clearReview(sessionID: String) -> Bool {
        guard let id = Self.identity(sessionID) else { return false }
        return reviewed.removeValue(forKey: id) != nil
    }

    public func isFeatured(id rawID: String, revision: String?, hasResult: Bool, resultAt: Date?,
                           isRunning: Bool, isQueued: Bool, isNewEmpty: Bool, isSelected: Bool) -> Bool {
        guard let id = Self.identity(rawID) else { return false }
        if isRunning || isQueued { return true }
        if hasReviewed(sessionID: id, revision: revision) { return false }
        if deployedIDs.contains(id) || isSelected || isNewEmpty { return true }
        guard hasResult, let resultAt, resultAt.timeIntervalSince1970.isFinite else { return false }
        return resultAt >= baselineAt
    }

    private enum CodingKeys: String, CodingKey { case schema, baselineAt, reviewed, deployedIDs }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard try c.decode(Int.self, forKey: .schema) == 1 else { throw Failure.invalidState }
        let date = try c.decode(Date.self, forKey: .baselineAt)
        let receipts = try c.decode([String: String].self, forKey: .reviewed)
        let deployed = try c.decode(Set<String>.self, forKey: .deployedIDs)
        guard date.timeIntervalSince1970.isFinite,
              receipts.count <= Self.maximumEntries, deployed.count <= Self.maximumEntries,
              receipts.allSatisfy({ Self.identity($0.key) == $0.key && Self.validRevision($0.value) }),
              deployed.allSatisfy({ Self.identity($0) == $0 }) else { throw Failure.invalidState }
        baselineAt = date; reviewed = receipts; deployedIDs = deployed
    }

    public func encode(to encoder: Encoder) throws {
        guard baselineAt.timeIntervalSince1970.isFinite,
              reviewed.count <= Self.maximumEntries, deployedIDs.count <= Self.maximumEntries,
              reviewed.allSatisfy({ Self.identity($0.key) == $0.key && Self.validRevision($0.value) }),
              deployedIDs.allSatisfy({ Self.identity($0) == $0 }) else { throw Failure.invalidState }
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(1, forKey: .schema); try c.encode(baselineAt, forKey: .baselineAt)
        try c.encode(reviewed, forKey: .reviewed); try c.encode(deployedIDs, forKey: .deployedIDs)
    }

    /// A missing, malformed, oversized, future-version or unsafe file restores
    /// no review claims. The fresh baseline suppresses historical map clutter;
    /// it does not assert that the historical results were read or accepted.
    public static func load(from url: URL, now: Date = Date()) -> Self {
        let fallback = Self(baselineAt: now)
        guard let directory = try? openDirectory(for: url) else { return fallback }
        defer { close(directory) }
        let fd = openat(directory, filename, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return fallback }
        defer { close(fd) }
        var info = stat()
        guard fstat(fd, &info) == 0, safeRegular(info), info.st_size >= 0,
              info.st_size <= maximumBytes else { return fallback }
        var bytes = Data(), buffer = [UInt8](repeating: 0, count: 8_192)
        while true {
            let count = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if count == 0 { break }
            if count < 0 { if errno == EINTR { continue }; return fallback }
            bytes.append(contentsOf: buffer.prefix(count))
            if bytes.count > maximumBytes { return fallback }
        }
        guard let decoded = try? JSONDecoder().decode(Self.self, from: bytes),
              decoded.baselineAt <= now else { return fallback }
        return decoded
    }

    /// Private same-directory atomic replacement. The only writable leaf is
    /// the presentation file; passing sessions.json or a symlink is rejected.
    /// The caller owns creation of the existing private application directory.
    public func save(to url: URL) throws {
        let bytes = try Self.encoded(self)
        guard bytes.count <= Self.maximumBytes else { throw Failure.tooLarge }
        let directory = try Self.openDirectory(for: url)
        defer { close(directory) }
        var old = stat()
        if fstatat(directory, Self.filename, &old, AT_SYMLINK_NOFOLLOW) == 0 {
            guard Self.safeRegular(old) else { throw Failure.unsafePath }
        } else if errno != ENOENT { throw Failure.io(errno) }
        let temporary = ".simulation-presentation-" + UUID().uuidString + ".tmp"
        let fd = openat(directory, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw Failure.io(errno) }
        var renamed = false
        defer { close(fd); if !renamed { _ = unlinkat(directory, temporary, 0) } }
        try bytes.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let count = write(fd, raw.baseAddress!.advanced(by: offset), raw.count - offset)
                if count < 0 { if errno == EINTR { continue }; throw Failure.io(errno) }
                guard count > 0 else { throw Failure.io(EIO) }
                offset += count
            }
        }
        guard fsync(fd) == 0 else { throw Failure.io(errno) }
        guard renameat(directory, temporary, directory, Self.filename) == 0 else { throw Failure.io(errno) }
        renamed = true
        _ = fsync(directory)
    }

    private static func identity(_ value: String) -> String? { UUID(uuidString: value)?.uuidString }
    private static func validRevision(_ value: String) -> Bool {
        !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && value.utf8.count <= maximumRevisionBytes &&
            !value.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    }
    private static func encoded(_ value: Self) throws -> Data {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }
    private static func safeRegular(_ info: stat) -> Bool {
        (info.st_mode & S_IFMT) == S_IFREG && info.st_uid == geteuid() && info.st_nlink == 1 && (info.st_mode & 0o077) == 0
    }
    private static func openDirectory(for url: URL) throws -> Int32 {
        guard url.isFileURL, url.lastPathComponent == filename else { throw Failure.unsafePath }
        let directory = open(url.deletingLastPathComponent().path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard directory >= 0 else { throw Failure.unsafePath }
        var info = stat()
        guard fstat(directory, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
              info.st_uid == geteuid(), (info.st_mode & 0o022) == 0 else { close(directory); throw Failure.unsafePath }
        return directory
    }
}
