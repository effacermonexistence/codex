import Foundation
import SQLite3

/// Read-only access to Codex Desktop's thread index (`~/.codex/state_5.sqlite`).
/// Codex writes that WAL database continuously, and a checkpoint or an
/// exclusive-mode writer can hold the file lock at the moment OS-1 reads it.
/// A transient SQLITE_BUSY must never surface as "index could not be read":
/// reads take a bounded busy timeout with short retries, then fall back to an
/// immutable snapshot open, which may trail the newest writes by moments but
/// always answers. Nothing here ever writes to the database.
public enum CodexSessionIndex {
    public struct Row: Equatable, Sendable {
        public let id: String
        public let title: String
        public let cwd: String
        public let updatedAtMS: Int64
        public init(id: String, title: String, cwd: String, updatedAtMS: Int64) {
            self.id = id; self.title = title; self.cwd = cwd; self.updatedAtMS = updatedAtMS
        }
    }

    public enum Failure: Error, CustomStringConvertible {
        case unreadable(String)
        public var description: String {
            if case .unreadable(let detail) = self { return detail }
            return "unreadable"
        }
    }

    static let listQuery = """
    SELECT id,
           COALESCE(NULLIF(name, ''), NULLIF(title, ''), NULLIF(first_user_message, ''), 'Untitled session'),
           cwd,
           COALESCE(NULLIF(recency_at_ms, 0), NULLIF(updated_at_ms, 0), updated_at * 1000)
    FROM threads
    WHERE archived = 0 AND preview <> ''
    ORDER BY recency_at_ms DESC, updated_at_ms DESC
    LIMIT 500
    """

    static let singleQuery = """
    SELECT id,
           COALESCE(NULLIF(name, ''), NULLIF(title, ''), NULLIF(first_user_message, ''), 'Untitled session'),
           cwd,
           COALESCE(NULLIF(recency_at_ms, 0), NULLIF(updated_at_ms, 0), updated_at * 1000)
    FROM threads
    WHERE id = ?
    LIMIT 1
    """

    public static func defaultPath(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> String {
        home.appendingPathComponent(".codex/state_5.sqlite").path
    }

    public static func rows(path: String, busyTimeoutMS: Int32 = 1_500, attempts: Int = 3) throws -> [Row] {
        try read(path: path, query: listQuery, bindID: nil, busyTimeoutMS: busyTimeoutMS, attempts: attempts)
    }

    public static func row(path: String, id: String, busyTimeoutMS: Int32 = 1_500, attempts: Int = 3) throws -> Row? {
        try read(path: path, query: singleQuery, bindID: id, busyTimeoutMS: busyTimeoutMS, attempts: attempts).first
    }

    private static func read(path: String, query: String, bindID: String?,
                             busyTimeoutMS: Int32, attempts: Int) throws -> [Row] {
        var lastDetail = "unknown"
        for attempt in 0..<max(1, attempts) {
            do {
                return try readOnce(path: path, uri: false, query: query, bindID: bindID, busyTimeoutMS: busyTimeoutMS)
            } catch Failure.unreadable(let detail) {
                lastDetail = detail
                // Retry only contention; a corrupt or missing database will not
                // improve, and the immutable fallback below still gets its turn.
                let transient = ["database is locked", "database is busy", "unable to open database file", "disk i/o error"]
                    .contains { detail.lowercased().contains($0) }
                if !transient { break }
                if attempt + 1 < attempts { usleep(120_000) }
            }
        }
        // Snapshot read: ignores WAL locks entirely. The file is only appended
        // to by Codex through the WAL, so a momentary stale view is safe for a
        // session browse list; the caller refreshes on the next open.
        let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
        do {
            return try readOnce(path: "file:\(encoded)?immutable=1", uri: true, query: query, bindID: bindID, busyTimeoutMS: 0)
        } catch Failure.unreadable(let immutableDetail) {
            throw Failure.unreadable("\(lastDetail); immutable fallback: \(immutableDetail)")
        }
    }

    private static func readOnce(path: String, uri: Bool, query: String, bindID: String?,
                                 busyTimeoutMS: Int32) throws -> [Row] {
        var database: OpaquePointer?
        let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX | (uri ? SQLITE_OPEN_URI : 0)
        guard sqlite3_open_v2(path, &database, flags, nil) == SQLITE_OK, let database else {
            let detail = database.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            sqlite3_close(database)
            throw Failure.unreadable(detail)
        }
        defer { sqlite3_close(database) }
        if busyTimeoutMS > 0 { sqlite3_busy_timeout(database, busyTimeoutMS) }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, query, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw Failure.unreadable(String(cString: sqlite3_errmsg(database)))
        }
        defer { sqlite3_finalize(statement) }
        if let bindID {
            let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
            guard sqlite3_bind_text(statement, 1, bindID, -1, transient) == SQLITE_OK else {
                throw Failure.unreadable(String(cString: sqlite3_errmsg(database)))
            }
        }
        var result: [Row] = []
        while true {
            let rc = sqlite3_step(statement)
            if rc == SQLITE_ROW {
                func text(_ index: Int32) -> String {
                    sqlite3_column_text(statement, index).map { String(cString: $0) } ?? ""
                }
                let id = text(0)
                guard !id.isEmpty else { continue }
                result.append(Row(id: id, title: text(1), cwd: text(2), updatedAtMS: sqlite3_column_int64(statement, 3)))
                continue
            }
            if rc == SQLITE_DONE { return result }
            throw Failure.unreadable(String(cString: sqlite3_errmsg(database)))
        }
    }
}
