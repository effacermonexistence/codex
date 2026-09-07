import Foundation
import SQLite3

struct NativePinState: Equatable, Sendable {
    let pinned: Bool
    let position: Int?
}

/// Read-only adapters. Never write SQLite, app global state, or Claude metadata.
enum NativeSidebar {
    static let codexPinnedSection = "01984de2-8f74-7c91-a3b2-5c5e937cf318"

    static func read(_ provider: String, home: URL = FileManager.default.homeDirectoryForCurrentUser) throws -> [String: NativePinState] {
        if provider == "codex" {
            var db: OpaquePointer?
            let code = sqlite3_open_v2(home.appendingPathComponent(".codex/state_5.sqlite").path,
                &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_FULLMUTEX, nil)
            defer { if let db { sqlite3_close(db) } }
            guard code == SQLITE_OK, let db else { throw failure("Codex 핀 목록을 읽을 수 없습니다.") }
            var stmt: OpaquePointer?
            let query = "SELECT id, thread_section_id, section_position FROM threads WHERE archived = 0"
            guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK, let stmt else {
                throw failure("이 Codex 버전의 사이드바 형식을 지원하지 않습니다.")
            }
            defer { sqlite3_finalize(stmt) }
            func string(_ column: Int32) -> String { sqlite3_column_text(stmt, column).map { String(cString: $0) } ?? "" }
            var result: [String: NativePinState] = [:]
            var step = sqlite3_step(stmt)
            while step == SQLITE_ROW {
                let pinned = string(1) == codexPinnedSection
                result[string(0)] = NativePinState(pinned: pinned,
                    position: pinned && sqlite3_column_type(stmt, 2) != SQLITE_NULL ? Int(sqlite3_column_int64(stmt, 2)) : nil)
                step = sqlite3_step(stmt)
            }
            guard step == SQLITE_DONE else { throw failure("Codex 핀 목록 읽기가 중단됐습니다.") }
            return result
        }
        guard provider == "claude" else { return [:] }
        let root = home.appendingPathComponent("Library/Application Support/Claude/claude-code-sessions")
        guard FileManager.default.fileExists(atPath: root.path),
              let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.fileSizeKey], options: [.skipsHiddenFiles]) else {
            throw failure("Claude 앱의 핀 정보를 아직 읽을 수 없습니다.")
        }
        var result: [String: NativePinState] = [:]
        for case let url as URL in files where url.lastPathComponent.hasPrefix("local_") && url.pathExtension == "json" {
            guard let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
                  let size = values.fileSize, size > 0, size < 4_194_304,
                  let data = try? Data(contentsOf: url),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = json["cliSessionId"] as? String, UUID(uuidString: id) != nil,
                  json["isArchived"] as? Bool != true else { continue }
            // Desktop persists membership, not its manual pinned display order.
            // nil rank means unknown, not an invented index or confirmation.
            result[id] = NativePinState(pinned: json["isStarred"] as? Bool == true, position: nil)
        }
        return result
    }

    static func failure(_ text: String) -> NSError { NSError(domain: "OS1.Sidebar", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
}
