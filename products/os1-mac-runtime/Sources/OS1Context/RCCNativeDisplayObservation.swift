import Darwin
import Foundation

/// Optional, content-free observation of ONE owned native attempt. It is not
/// a dispatch, route ACK, liveness assertion, or execution/quality certificate.
public struct RCCNativeDisplayObservation: Codable, Equatable, Sendable {
    public var schema = 1
    public let taskID: String, requestSHA256: String, nodeID: String, attemptID: String, candidateID: String
    public let configurationSHA256: String, nativeReceipt: String, provider: String, surface: String
    public var sessionID: String?
    public var turnID: String?
    public var observedAt: Date
    public let attemptStartedAt: Date
    public var model: String?
    public var effort: String?
    public var settingsBasis: String?
    public var settingsSourceSHA256: String?
    public var settingsOutputSHA256: String?
    /// Actual host process cwd; ownedPaths are the ticket's DECLARED scope,
    /// not a claim that these files were changed or that output was adopted.
    public let workspace: String
    public let ownedPaths: [String]?
    public var progress: NativeExecutionProgress?
    public var receiptSHA256: String?

    public init(ticket: RCCRuntimeContract.ExecutionTicket, nativeReceipt: String, workspace: String, observedAt: Date) {
        taskID = ticket.taskID; requestSHA256 = ticket.requestSHA256; nodeID = ticket.nodeID
        attemptID = ticket.attemptID; candidateID = ticket.candidateID
        configurationSHA256 = ticket.configurationSHA256; self.nativeReceipt = nativeReceipt
        provider = ticket.selectedConfig.transport == .codexAppServer ? "codex" : "claude"
        surface = ticket.selectedConfig.surface.rawValue; self.workspace = workspace
        // Unsupported/private ownership syntax is unknown, not an invented
        // empty declaration or a truncated claim of the full write scope.
        ownedPaths = ticket.ownedPaths.count <= 12 && ticket.ownedPaths.allSatisfy(ParallelAgentTask.relativeOwnedPath)
            ? ticket.ownedPaths : nil
        self.observedAt = observedAt; attemptStartedAt = observedAt
    }
    public static func key(_ attempt: String) -> String { "native-display:" + attempt.lowercased() }
    private static func hash(_ s: String) -> Bool { s.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil }
    private static func token(_ s: String, maximum: Int) -> Bool {
        !s.isEmpty && s.utf8.count <= maximum && s.range(of: "^[A-Za-z0-9._:-]+$", options: .regularExpression) != nil
    }
    private static func absolute(_ s: String) -> Bool {
        s.hasPrefix("/") && s.utf8.count <= 4096 && !s.contains("\\") &&
            !s.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) &&
            URL(fileURLWithPath: s).standardizedFileURL.path == s
    }
    public var isValid: Bool {
        schema == 1 && [taskID, nodeID, candidateID].allSatisfy { Self.token($0, maximum: 160) } &&
        UUID(uuidString: attemptID) != nil && Self.hash(requestSHA256) && Self.hash(configurationSHA256) &&
        Self.absolute(nativeReceipt) && UUID(uuidString: URL(fileURLWithPath: nativeReceipt).deletingPathExtension().lastPathComponent) != nil &&
        URL(fileURLWithPath: nativeReceipt).pathExtension == "json" && ["codex", "claude"].contains(provider) &&
        ((provider == "codex" && ["codex", "gpt-chat"].contains(surface)) ||
         (provider == "claude" && ["claude", "claude-chat"].contains(surface))) &&
        (sessionID.map { UUID(uuidString: $0) != nil } ?? true) &&
        (turnID.map { UUID(uuidString: $0) != nil } ?? true) && observedAt.timeIntervalSince1970.isFinite &&
        attemptStartedAt.timeIntervalSince1970.isFinite && attemptStartedAt <= observedAt &&
        Self.absolute(workspace) && (ownedPaths.map { $0.count <= 12 && Set($0).count == $0.count &&
            $0.allSatisfy(ParallelAgentTask.relativeOwnedPath) } ?? true) &&
        (progress.map { $0.isValid && $0.observedAt >= attemptStartedAt && $0.observedAt <= observedAt } ?? true) &&
        (receiptSHA256.map(Self.hash) ?? true) &&
        ((model == nil && effort == nil && settingsBasis == nil && settingsSourceSHA256 == nil && settingsOutputSHA256 == nil) ||
         (sessionID != nil && (provider != "codex" || turnID != nil) &&
          model.map { Self.token($0, maximum: 128) } == true &&
          (effort.map { RCCRuntimeContract.Effort(rawValue: $0) != nil } ?? true) &&
          settingsSourceSHA256.map(Self.hash) == true &&
          (provider == "codex" ? settingsBasis == "native_turn_context" && settingsOutputSHA256 == nil :
            settingsBasis == "native_assistant_model" && settingsOutputSHA256.map(Self.hash) == true)))
    }
    public static func decode(_ data: Data) -> Self? {
        guard data.count <= 64_000, let object = try? RCCRuntimeContract.checkedObject(data),
              Set(object.keys).isSubset(of: ["schema", "taskID", "requestSHA256", "nodeID", "attemptID", "candidateID",
                "configurationSHA256", "nativeReceipt", "provider", "surface", "sessionID", "turnID", "observedAt", "attemptStartedAt",
                "model", "effort", "settingsBasis", "settingsSourceSHA256", "settingsOutputSHA256", "workspace", "ownedPaths", "progress", "receiptSHA256"]),
              let value = try? JSONDecoder().decode(Self.self, from: data), value.isValid else { return nil }
        return value
    }

    /// Parse settings metadata; for Claude hash only visible text to bind its
    /// assistant row to the exact output. Never expose text, reasoning or tool
    /// bodies. Unsupported/conflicting metadata stays unknown; ACK isn't readback.
    public static func observedSettings(_ data: Data, provider: String, sessionID: String, turnID: String?, finalOutputSHA256: String? = nil,
                                        notBefore: Date? = nil, notAfter: Date? = nil)
        -> (model: String, effort: String?, basis: String, sourceSHA256: String, outputSHA256: String?)? {
        guard !data.isEmpty, data.count <= 16_000_000, data.last == 10 else { return nil }
        let rows = data.split(separator: 10); guard rows.count <= 50_000 else { return nil }
        var settings: [(String, String?)] = [], sessionMatches = false
        for line in rows {
            guard line.count <= 1_048_576, let o = try? RCCRuntimeContract.checkedObject(Data(line)) else { return nil }
            if provider == "codex" {
                guard let p = o["payload"] as? [String: Any] else { continue }
                if o["type"] as? String == "session_meta" { sessionMatches = p["id"] as? String == sessionID }
                if o["type"] as? String == "turn_context", let turnID, p["turn_id"] as? String == turnID,
                   let model = p["model"] as? String, let effort = p["effort"] as? String {
                    settings.append((model, effort))
                }
            } else if provider == "claude", o["type"] as? String == "assistant",
                o["sessionId"] as? String == sessionID,
                let message = o["message"] as? [String: Any], let model = message["model"] as? String,
                let expected = finalOutputSHA256, Self.hash(expected),
                let start = notBefore, let finish = notAfter, start <= finish,
                let timestamp = o["timestamp"] as? String,
                let time = timestampDate(timestamp), time >= start, time <= finish,
                let content = message["content"] as? [[String: Any]] {
                // Claude may persist effort metadata on the assistant envelope;
                // absent/unsupported/conflicting metadata stays unknown. Only ONE own
                // assistant whose text hashes to this exact receipt output is
                // a current-attempt witness; last-in-session is insufficient.
                let text = content.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined()
                if !text.isEmpty && RCCRuntimeContract.digest(Data(text.utf8)) == expected {
                    sessionMatches = true; settings.append((model, claudeObservedEffort(o)))
                }
            }
        }
        guard sessionMatches, let value = settings.first, settings.allSatisfy({ $0.0 == value.0 && $0.1 == value.1 }),
              provider != "claude" || settings.count == 1,
              Self.token(value.0, maximum: 128), value.1.map({ RCCRuntimeContract.Effort(rawValue: $0) != nil }) ?? true else { return nil }
        return (value.0, value.1, provider == "codex" ? "native_turn_context" : "native_assistant_model", RCCRuntimeContract.digest(data), provider == "claude" ? finalOutputSHA256 : nil)
    }
    private static func claudeObservedEffort(_ row: [String: Any]) -> String? {
        // These are provider-native root metadata, not message content, ACK,
        // requested settings, or a value inferred from a different assistant.
        // Both fields, when present, must independently support the same value.
        let fields = ["effort", "perTurnEffort"].filter { row.keys.contains($0) }
        guard !fields.isEmpty else { return nil }
        var values: [String] = []
        for field in fields {
            guard let value = row[field] as? String,
                  ["low", "medium", "high", "max"].contains(value) else { return nil }
            values.append(value)
        }
        guard let first = values.first, values.allSatisfy({ $0 == first }) else { return nil }
        return first
    }
    private static func timestampDate(_ text: String) -> Date? {
        guard text.utf8.count <= 64 else { return nil }
        let precise = ISO8601DateFormatter(); precise.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return precise.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}

/// Exact attempt-indexed, nofollow private custody. Missing/malformed display
/// evidence has no effect on native execution, scheduling, replay or adoption.
public enum RCCNativeDisplayStore {
    public static func load(_ snapshot: RCCRuntimeContract.Snapshot, homeDirectory: URL) -> [String: Data] {
        guard (try? RCCRuntimeContract.validate(snapshot)) != nil,
              let dir = directory(homeDirectory, create: false) else { return [:] }
        defer { close(dir) }
        var result: [String: Data] = [:]
        for child in snapshot.children {
            guard let attempt = child.attemptID.flatMap(UUID.init(uuidString:)),
                  let data = read(attempt.uuidString.lowercased() + ".json", directory: dir, maximum: 64_000) else { continue }
            result[RCCNativeDisplayObservation.key(attempt.uuidString)] = data
        }
        return result
    }
    static func directory(_ home: URL, create: Bool) -> Int32? {
        guard home.isFileURL, home.standardizedFileURL.path == home.path,
              home.resolvingSymlinksInPath().path == home.path else { return nil }
        var fd = open(home.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return nil }
        for name in [".os1", "rcc-runtime", "native-display"] {
            if create, mkdirat(fd, name, 0o700) != 0 && errno != EEXIST { close(fd); return nil }
            let next = openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            close(fd); guard next >= 0 else { return nil }
            var s = stat()
            guard fstat(next, &s) == 0, s.st_uid == getuid(), s.st_mode & 0o077 == 0 else { close(next); return nil }
            fd = next
        }
        return fd
    }
    static func read(_ name: String, directory: Int32, maximum: Int) -> Data? {
        let fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard fd >= 0 else { return nil }; defer { close(fd) }
        var a = stat(); guard fstat(fd, &a) == 0, a.st_mode & S_IFMT == S_IFREG, a.st_uid == getuid(),
            a.st_nlink == 1, a.st_mode & 0o077 == 0, a.st_size > 0, a.st_size <= maximum else { return nil }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 16384)
        while true {
            let n = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if n < 0 { if errno == EINTR { continue }; return nil }; if n == 0 { break }
            guard data.count + n <= maximum else { return nil }; data.append(contentsOf: buffer.prefix(n))
        }
        var b = stat(), named = stat()
        guard fstat(fd, &b) == 0, fstatat(directory, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
            named.st_dev == a.st_dev, named.st_ino == a.st_ino, named.st_mode & S_IFMT == S_IFREG,
            named.st_nlink == 1, named.st_uid == a.st_uid, named.st_mode & 0o077 == 0,
            a.st_size == data.count, a.st_size == b.st_size,
            a.st_mtimespec.tv_sec == b.st_mtimespec.tv_sec, a.st_mtimespec.tv_nsec == b.st_mtimespec.tv_nsec,
            a.st_ctimespec.tv_sec == b.st_ctimespec.tv_sec, a.st_ctimespec.tv_nsec == b.st_ctimespec.tv_nsec else { return nil }
        return data
    }
    // Provider-owned native logs can legitimately be0644. They are not OS-1
    // sidecars/receipts, whose separate read() custody remains owner-only0600.
    // This predicate grants no path or backend authority; callers still bind
    // the transport-verified exact source to one session/turn/receipt below.
    private static func nativeMetadataFileIsSafe(_ value: stat, maximum: Int64, expectedUID: uid_t) -> Bool {
        value.st_mode & S_IFMT == S_IFREG && value.st_uid == expectedUID && value.st_nlink == 1 &&
        value.st_mode & 0o022 == 0 && value.st_mode & 0o111 == 0 && value.st_mode & 0o7000 == 0 &&
        value.st_size > 0 && value.st_size <= maximum
    }
    private static func readOwnedNativeMetadata(_ name: String, directory: Int32, maximum: Int) -> Data? {
        let fd = openat(directory, name, O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC)
        guard fd >= 0 else { return nil }; defer { close(fd) }
        var before = stat()
        guard fstat(fd, &before) == 0,
              nativeMetadataFileIsSafe(before, maximum: Int64(maximum), expectedUID: getuid()) else { return nil }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 16384)
        while true {
            let n = buffer.withUnsafeMutableBytes { Darwin.read(fd, $0.baseAddress, $0.count) }
            if n < 0 { if errno == EINTR { continue }; return nil }; if n == 0 { break }
            guard data.count + n <= maximum else { return nil }; data.append(contentsOf: buffer.prefix(n))
        }
        var after = stat(), named = stat()
        guard fstat(fd, &after) == 0, fstatat(directory, name, &named, AT_SYMLINK_NOFOLLOW) == 0,
              nativeMetadataFileIsSafe(after, maximum: Int64(maximum), expectedUID: getuid()),
              nativeMetadataFileIsSafe(named, maximum: Int64(maximum), expectedUID: getuid()),
              before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_dev == named.st_dev, before.st_ino == named.st_ino,
              before.st_mode == after.st_mode, before.st_mode == named.st_mode,
              before.st_size == data.count, before.st_size == after.st_size, before.st_size == named.st_size,
              before.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec, before.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec,
              before.st_mtimespec.tv_sec == named.st_mtimespec.tv_sec, before.st_mtimespec.tv_nsec == named.st_mtimespec.tv_nsec,
              before.st_ctimespec.tv_sec == named.st_ctimespec.tv_sec, before.st_ctimespec.tv_nsec == named.st_ctimespec.tv_nsec else { return nil }
        return data
    }
    /// Only the exact persistence path already verified by the native transport.
    /// Read-only provider metadata policy allows0600/0644, never foreign-owned,
    /// writable-by-others, linked, special, aliased or changed source. It does
    /// not mutate provider files or weaken private OS-1 receipt/sidecar custody.
    public static func readNativeMetadata(_ path: String) -> Data? {
        let url = URL(fileURLWithPath: path), parent = url.deletingLastPathComponent()
        guard url.standardizedFileURL.path == path, url.resolvingSymlinksInPath().path == path else { return nil }
        let fd = open(parent.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { return nil }; defer { close(fd) }
        var before = stat()
        guard fstat(fd, &before) == 0, before.st_mode & S_IFMT == S_IFDIR,
              before.st_uid == getuid(), before.st_mode & 0o022 == 0,
              let data = readOwnedNativeMetadata(url.lastPathComponent, directory: fd, maximum: 16_000_000) else { return nil }
        var after = stat(), named = stat()
        guard fstat(fd, &after) == 0, lstat(parent.path, &named) == 0,
              before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_dev == named.st_dev, before.st_ino == named.st_ino,
              before.st_mode == after.st_mode, before.st_mode == named.st_mode,
              before.st_uid == after.st_uid, before.st_uid == named.st_uid,
              url.resolvingSymlinksInPath().path == path else { return nil }
        return data
    }

    public final class Publisher: @unchecked Sendable {
        private let lock = NSLock()
        private let home: URL
        private var value: RCCNativeDisplayObservation
        private var lastPersistedUptime: TimeInterval?
        public init(ticket: RCCRuntimeContract.ExecutionTicket, nativeReceipt: String, workspace: String,
                    homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser, now: Date = Date()) {
            home = homeDirectory
            value = .init(ticket: ticket, nativeReceipt: nativeReceipt, workspace: workspace, observedAt: now)
        }
        public func session(_ session: String?) {
            guard let session, UUID(uuidString: session) != nil else { return }
            lock.lock(); defer { lock.unlock() }
            guard value.sessionID == nil || value.sessionID == session.lowercased() else { return }
            value.sessionID = session.lowercased(); value.observedAt = Date(); persist()
        }
        public func activity(_ activity: RuntimeActivity) {
            lock.lock(); defer { lock.unlock() }
            guard activity.provider == value.provider, value.sessionID != nil,
                activity.nativeSessionID == nil || activity.nativeSessionID == value.sessionID,
                activity.timestamp >= value.observedAt,
                let progress = activity.progress, progress.isValid, progress.observedAt <= activity.timestamp,
                value.progress.map({ progress.observedAt >= $0.observedAt &&
                    (progress.stream != $0.stream || progress.sequence >= $0.sequence) }) ?? true else { return }
            let firstProgress = value.progress == nil
            value.progress = progress; value.observedAt = activity.timestamp; persist(force: firstProgress)
        }
        public func finish(sessionID: String, turnID: String?, nativePath: String?, persistence: String, receipt: Data, finalOutputSHA256: String? = nil) {
            lock.lock(); defer { lock.unlock() }
            guard value.sessionID == sessionID.lowercased(), UUID(uuidString: sessionID) != nil else { return }
            value.turnID = turnID; value.observedAt = Date(); value.receiptSHA256 = RCCRuntimeContract.digest(receipt)
            if persistence == "verified", let nativePath, let bytes = RCCNativeDisplayStore.readNativeMetadata(nativePath),
               let settings = RCCNativeDisplayObservation.observedSettings(bytes, provider: value.provider, sessionID: sessionID, turnID: turnID, finalOutputSHA256: finalOutputSHA256,
                    notBefore: value.attemptStartedAt, notAfter: value.observedAt) {
                value.model = settings.model; value.effort = settings.effort
                value.settingsBasis = settings.basis; value.settingsSourceSHA256 = settings.sourceSHA256
                value.settingsOutputSHA256 = settings.outputSHA256
            }
            persist()
        }
        private func persist(force: Bool = true) {
            let uptime = ProcessInfo.processInfo.systemUptime
            // Optional display I/O must not fsync once per native token/tool
            // event. Keep latest in memory; first progress and final seal flush.
            if !force, let lastPersistedUptime, uptime - lastPersistedUptime < 0.5 { return }
            guard value.isValid, let data = try? JSONEncoder().encode(value), data.count <= 64_000,
                  let id = UUID(uuidString: value.attemptID), let dir = directory(home, create: true) else { return }
            defer { close(dir) }
            let name = id.uuidString.lowercased() + ".json", temporary = "." + UUID().uuidString.lowercased()
            var existing = stat()
            if fstatat(dir, name, &existing, AT_SYMLINK_NOFOLLOW) == 0 {
                guard existing.st_mode & S_IFMT == S_IFREG, existing.st_uid == getuid(), existing.st_nlink == 1,
                    existing.st_mode & 0o077 == 0 else { return }
            } else if errno != ENOENT { return }
            let fd = openat(dir, temporary, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0o600)
            guard fd >= 0 else { return }; defer { close(fd); unlinkat(dir, temporary, 0) }
            var offset = 0
            while offset < data.count {
                let n = data.withUnsafeBytes { Darwin.write(fd, $0.baseAddress!.advanced(by: offset), data.count - offset) }
                if n < 0 && errno == EINTR { continue }; guard n > 0 else { return }; offset += n
            }
            guard fsync(fd) == 0, renameat(dir, temporary, dir, name) == 0 else { return }
            lastPersistedUptime = uptime
        }
    }
}
