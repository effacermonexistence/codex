import Foundation
import Darwin

/// A change to OS-1 itself that an owner request still needs (build 327).
///
/// A HOME request runs confined from OS-1's source and hands its OS-1 part
/// back; OS-1 then makes that part as its own repair. That repair used to
/// live only inside the CLI process that ran the draft: a staging failure, a
/// restart or a killed process dropped it, and the owner's next "고치라니까"
/// started over from the confined session that never knew the repair's
/// commit. This record is the durable half of that chain. It is written before
/// the repair starts, updated as it progresses, and removed when the repair's
/// completion writes the install intent or the owner cancels it.
///
/// API for the app (one JSON file per conversation, `0600`, in a `0700`
/// folder; production root `~/Library/Application Support/OS-1/pending-os1-repairs`):
/// - `PendingOS1RepairStore().list()` — every record, newest first.
/// - `PendingOS1RepairStore().load(id:)` — one record; the id is the
///   conversation id (lowercased UUID) when the run had one, else the submission id.
/// - `PendingOS1RepairStore().reconcileInterrupted()` — call at app launch:
///   a `running` record whose process is gone becomes `interrupted`.
/// - `PendingOS1RepairStore().remove(id:)` — the owner cancelled the repair.
/// A record in `staging_failed`, `interrupted` or `failed` is retried by the
/// CLI on the conversation's next write request (`retryable`).
public struct PendingOS1Repair: Codable, Equatable, Sendable {
    public enum State: String, Codable, Sendable {
        case running
        case stagingFailed = "staging_failed"
        case interrupted
        case failed
    }

    /// Automatic retries stop after this many attempts, so an unrelated later
    /// request in the same conversation is not bound to OS-1 forever. The
    /// record stays for the app to show; the owner can retry or cancel.
    public static let maximumAutomaticAttempts = 3
    /// Text fields are bounded: the record is state, not a transcript.
    public static let reportLimit = 12_000

    public var schema = 1
    public var id: String
    public var conversationID: String?
    public var submissionID: String?
    /// The owner's own request that needed the OS-1 change.
    public var ownerRequest: String
    /// Corrections the first run took in, then every later owner message
    /// that retried this repair.
    public var corrections: [String]
    /// The confined first run's report (what it did and what OS-1 needs).
    public var draftReport: String
    public var sourceRoot: String?
    /// OS-1's source HEAD before the repair ran.
    public var startCommit: String?
    public var state: State
    public var attempts: Int
    public var lastError: String?
    /// The completion gate that failed (`app-self-test-parallel`, `release-build`, …).
    public var failedGate: String?
    /// HEAD after the repair, when the repair committed its change.
    public var repairCommit: String?
    public var repairBranch: String?
    public var repairPushed: Bool?
    /// The repair's own answer, when it produced one.
    public var repairReport: String?
    public var createdAt: Date
    public var updatedAt: Date
    /// The CLI process running (or last running) the repair.
    public var pid: Int32
    /// Set once the app resumed this record by itself after a restart
    /// (build 327): an interrupted repair is resumed automatically at most once.
    public var autoResumeAttempted: Bool?

    public init(id: String, conversationID: String?, submissionID: String?, ownerRequest: String,
                corrections: [String], draftReport: String, sourceRoot: String?, startCommit: String?,
                now: Date = Date(), pid: Int32 = getpid()) {
        self.id = id; self.conversationID = conversationID; self.submissionID = submissionID
        self.ownerRequest = PendingOS1Repair.bounded(ownerRequest)
        self.corrections = corrections.map { PendingOS1Repair.bounded($0) }
        self.draftReport = PendingOS1Repair.bounded(draftReport)
        self.sourceRoot = sourceRoot; self.startCommit = startCommit
        state = .running; attempts = 1
        createdAt = now; updatedAt = now; self.pid = pid
    }

    /// The record id of a run: its conversation when the app passed one, so a
    /// follow-up in that conversation finds it; else its submission.
    public static func recordID(conversationID: String?, submissionID: String?) -> String? {
        for value in [conversationID, submissionID] {
            if let value, let uuid = UUID(uuidString: value) { return uuid.uuidString.lowercased() }
        }
        return nil
    }

    /// Head and tail kept, the middle elided.
    public static func bounded(_ text: String, limit: Int = reportLimit) -> String {
        guard text.count > limit else { return text }
        let half = limit / 2
        return String(text.prefix(half)) + "\n…\n" + String(text.suffix(half))
    }

    /// The process that wrote `running` is gone: the repair was interrupted.
    public func effectiveState(isAlive: (Int32) -> Bool = PendingOS1Repair.processAlive) -> State {
        state == .running && !isAlive(pid) ? .interrupted : state
    }

    /// A new write request in this conversation continues this repair.
    public func retryable(isAlive: (Int32) -> Bool = PendingOS1Repair.processAlive) -> Bool {
        [.stagingFailed, .interrupted, .failed].contains(effectiveState(isAlive: isAlive))
            && attempts < Self.maximumAutomaticAttempts
    }

    public static func processAlive(_ pid: Int32) -> Bool {
        pid > 0 && (kill(pid, 0) == 0 || errno == EPERM)
    }

    /// The process that wrote this record is still running. A pid alone is
    /// not enough after a restart: the number is reused, so a live process
    /// that started after the record was written is someone else.
    public static func writerAlive(_ record: PendingOS1Repair) -> Bool {
        guard processAlive(record.pid) else { return false }
        guard let started = processStartTime(record.pid) else { return true }
        return started <= record.updatedAt.addingTimeInterval(2)
    }

    public static func processStartTime(_ pid: Int32) -> Date? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0, info.kp_proc.p_pid == pid else { return nil }
        let start = info.kp_proc.p_un.__p_starttime
        return Date(timeIntervalSince1970: TimeInterval(start.tv_sec) + TimeInterval(start.tv_usec) / 1_000_000)
    }

    /// The follow-up the app sends to resume an interrupted repair. It is a
    /// write request, so the CLI's pending-repair path takes it (build 327).
    public static let resumeRequestKorean = "중단된 OS-1 자체 수정을 이어서 마무리해"
    public static let resumeRequestEnglish = "Finish the interrupted change to OS-1 itself"
    public static var resumeRequest: String { os1Tr(resumeRequestKorean, resumeRequestEnglish) }
}

public struct PendingOS1RepairStore: Sendable {
    public let root: URL

    /// `OS1_PENDING_OS1_REPAIRS_ROOT` redirects it (fixtures, staged self-tests).
    public static var defaultRoot: URL {
        if let override = ProcessInfo.processInfo.environment["OS1_PENDING_OS1_REPAIRS_ROOT"], override.hasPrefix("/") {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/pending-os1-repairs", isDirectory: true)
    }

    public init(root: URL = PendingOS1RepairStore.defaultRoot) { self.root = root }

    public func url(id: String) -> URL? {
        guard let uuid = UUID(uuidString: id) else { return nil }
        return root.appendingPathComponent(uuid.uuidString.lowercased() + ".json")
    }

    public func save(_ record: PendingOS1Repair) throws {
        guard let url = url(id: record.id) else { throw CocoaError(.fileWriteInvalidFileName) }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try Self.encoder.encode(record).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    public func load(id: String) -> PendingOS1Repair? {
        guard let url = url(id: id), let data = try? Data(contentsOf: url), data.count <= 1_000_000,
              let record = try? Self.decoder.decode(PendingOS1Repair.self, from: data), record.schema == 1 else { return nil }
        return record
    }

    /// Newest first.
    public func list() -> [PendingOS1Repair] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: root.path) else { return [] }
        return names.filter { $0.hasSuffix(".json") }
            .compactMap { load(id: String($0.dropLast(".json".count))) }
            .sorted { $0.updatedAt > $1.updatedAt }
    }

    /// Applies `change` to the stored record and saves it with a new
    /// `updatedAt`; nil when there is no record.
    @discardableResult
    public func update(id: String, now: Date = Date(), _ change: (inout PendingOS1Repair) -> Void) -> PendingOS1Repair? {
        guard var record = load(id: id) else { return nil }
        change(&record)
        record.updatedAt = now
        return (try? save(record)) == nil ? nil : record
    }

    public func remove(id: String) {
        guard let url = url(id: id) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    /// App launch: a `running` record whose process is gone is `interrupted`.
    @discardableResult
    public func reconcileInterrupted(isAlive: (Int32) -> Bool = PendingOS1Repair.processAlive, now: Date = Date()) -> [PendingOS1Repair] {
        list().filter { $0.state == .running && !isAlive($0.pid) }.compactMap { record in
            update(id: record.id, now: now) { $0.state = .interrupted }
        }
    }

    private static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .prettyPrinted]
        return encoder
    }

    private static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

/// The pending record a running OS-1 repair updates. `runTask` binds it
/// around the repair, so OS-1's own completion (`completeOS1SelfRepair`, deep
/// inside that run) records a staging failure or removes the record once the
/// install intent is written. Unbound for every other run.
public enum PendingOS1RepairContext {
    public struct Binding: Sendable {
        public let store: PendingOS1RepairStore
        public let id: String
        public init(store: PendingOS1RepairStore, id: String) { self.store = store; self.id = id }
    }
    @TaskLocal public static var current: Binding?
}
