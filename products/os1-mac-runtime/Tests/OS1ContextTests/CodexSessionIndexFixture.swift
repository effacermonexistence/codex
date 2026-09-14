import Foundation
import OS1Context
import SQLite3

/// Reproduces the "Codex session index could not be read" incident: Codex
/// Desktop holding the state database's file lock while OS-1 browses. The
/// reader must fall back to an immutable snapshot instead of failing.
func runCodexSessionIndexFixtures() throws {
    var count = 0
    func check(_ value: Bool, _ message: String) {
        precondition(value, "Codex session index: " + message); count += 1
    }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-codex-index-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let path = root.appendingPathComponent("state_5.sqlite").path

    var writer: OpaquePointer?
    precondition(sqlite3_open_v2(path, &writer, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK)
    func execute(_ sql: String) {
        precondition(sqlite3_exec(writer, sql, nil, nil, nil) == SQLITE_OK,
                     "fixture SQL failed: \(sql) — \(String(cString: sqlite3_errmsg(writer)))")
    }
    execute("PRAGMA journal_mode=WAL")
    execute("""
    CREATE TABLE threads (
        id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '',
        first_user_message TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '',
        recency_at_ms INTEGER NOT NULL DEFAULT 0, updated_at_ms INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
        preview TEXT NOT NULL DEFAULT '')
    """)
    execute("INSERT INTO threads (id, name, cwd, recency_at_ms, preview) VALUES ('newer', '이름', '/tmp/a', 2000, 'p')")
    execute("INSERT INTO threads (id, title, first_user_message, cwd, updated_at, preview) VALUES ('older', '', '첫 메시지', '/tmp/b', 1, 'p')")
    execute("INSERT INTO threads (id, name, cwd, recency_at_ms, preview) VALUES ('archived', 'x', '/tmp/c', 3000, 'p')")
    execute("UPDATE threads SET archived = 1 WHERE id = 'archived'")
    execute("INSERT INTO threads (id, name, cwd, recency_at_ms, preview) VALUES ('previewless', 'x', '/tmp/d', 4000, '')")

    let plain = try CodexSessionIndex.rows(path: path, busyTimeoutMS: 50, attempts: 2)
    check(plain.map(\.id) == ["newer", "older"], "list filters archived/previewless and orders by recency")
    check(plain[0].title == "이름" && plain[1].title == "첫 메시지", "title coalesces name over first message")
    check(plain[1].updatedAtMS == 1000, "seconds-only timestamp is scaled to milliseconds")
    check(try CodexSessionIndex.row(path: path, id: "archived")?.title == "x",
          "single lookup still addresses archived records")
    check(try CodexSessionIndex.row(path: path, id: "missing") == nil, "missing id is nil, not an error")

    // The immutable fallback reads only the main database file, so data still
    // sitting in the WAL is invisible to it. Codex's real index is far past
    // its first checkpoint; make the fixture match that steady state.
    execute("PRAGMA wal_checkpoint(TRUNCATE)")

    // Codex holding the file lock: exclusive locking mode keeps the shared
    // lock after commit, so a plain reader gets SQLITE_BUSY indefinitely.
    execute("PRAGMA locking_mode=EXCLUSIVE")
    execute("BEGIN IMMEDIATE")
    execute("UPDATE threads SET preview = 'p2' WHERE id = 'newer'")
    execute("COMMIT")
    var blockedProbe: OpaquePointer?
    precondition(sqlite3_open_v2(path, &blockedProbe, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK)
    var probeStatement: OpaquePointer?
    let probeRC = sqlite3_prepare_v2(blockedProbe, "SELECT count(*) FROM threads", -1, &probeStatement, nil)
    sqlite3_finalize(probeStatement)
    sqlite3_close(blockedProbe)
    check(probeRC != SQLITE_OK, "fixture actually reproduces the reader lockout")

    let locked = try CodexSessionIndex.rows(path: path, busyTimeoutMS: 50, attempts: 2)
    check(locked.map(\.id) == ["newer", "older"], "locked index still answers through the immutable snapshot")
    check(try CodexSessionIndex.row(path: path, id: "older", busyTimeoutMS: 50, attempts: 2)?.cwd == "/tmp/b",
          "single lookup also survives the lockout")

    sqlite3_close(writer)
    let released = try CodexSessionIndex.rows(path: path, busyTimeoutMS: 50, attempts: 2)
    check(released.count == 2, "release returns to the plain read path")

    do {
        _ = try CodexSessionIndex.rows(path: root.appendingPathComponent("absent.sqlite").path, busyTimeoutMS: 50, attempts: 2)
        precondition(false, "missing database must throw")
    } catch { count += 1 }
    print("Codex session index: \(count) checks passed; lockout answered via immutable snapshot")
}
