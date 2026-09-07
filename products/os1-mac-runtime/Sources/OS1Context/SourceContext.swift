import CryptoKit
import Foundation

/// A local source reference, never instructions inferred from assistant prose.
public struct SourceReference: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case snapshot, receipt }
    public let kind: Kind
    public let id: UUID
    public let sha256: String

    public init(kind: Kind, id: UUID, sha256: String) {
        self.kind = kind; self.id = id; self.sha256 = sha256
    }
}

public struct SessionHandoff: Codable, Sendable {
    public static let currentFormat = "os1-session-handoff-v3"
    public static let acceptedFormats: Set<String> = ["os1-session-handoff-v2", currentFormat]

    public let format: String
    public let transcript: String
    public let source: SourceReference?
    /// v3: the OS1-owned task state (objective, decisions, project baseline,
    /// all bound sources, bindings, executions). Absent on v2 handoffs.
    public let taskContext: TaskContext?

    public init(transcript: String, source: SourceReference?, taskContext: TaskContext? = nil) {
        format = Self.currentFormat
        // Budget bytes, not Swift characters: Korean can consume 3+ bytes each.
        var bytes = Data(transcript.utf8).suffix(150_000)
        while !bytes.isEmpty && String(data: bytes, encoding: .utf8) == nil { bytes = bytes.dropFirst() }
        self.transcript = String(data: bytes, encoding: .utf8) ?? ""
        self.source = source
        self.taskContext = taskContext
    }

    public func encoded() throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        var bounded = self
        while true {
            let data = try encoder.encode(bounded)
            if data.count <= 190_000 { return String(decoding: data, as: UTF8.self) }
            // The task context is the part that must survive; only the
            // transcript shrinks.
            guard !bounded.transcript.isEmpty else { throw SourceContextError.invalid }
            bounded = SessionHandoff(transcript: String(bounded.transcript.suffix(bounded.transcript.count / 2)),
                                     source: source, taskContext: taskContext)
        }
    }

    public static func decode(_ value: String?) throws -> SessionHandoff {
        guard let value else { return SessionHandoff(transcript: "", source: nil) }
        guard value.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") else {
            return SessionHandoff(transcript: value, source: nil)
        }
        // Legacy text may itself be JSON. Only the exact transport discriminator
        // opts in; malformed v2/v3 must fail rather than silently drop attachments.
        if value.contains("os1-session-handoff-") {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let result = try decoder.decode(Self.self, from: Data(value.utf8))
            guard acceptedFormats.contains(result.format) else { throw SourceContextError.invalid }
            return result
        }
        return SessionHandoff(transcript: value, source: nil)
    }
}

public enum SourceContextError: LocalizedError {
    case invalid
    public var errorDescription: String? {
        "OS-1 연결 자료를 검증할 수 없습니다. 원문을 다시 가져와 주세요. 자료 없이 계속하지 않았습니다."
    }
}

public struct SourceContextStore: Sendable {
    public let root: URL
    public init(root: URL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/OS-1")) { self.root = root.resolvingSymlinksInPath().standardizedFileURL }

    public static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    public func url(for reference: SourceReference) -> URL {
        root.appendingPathComponent(reference.kind == .snapshot ? "source-snapshots" : "control-receipts")
            .appendingPathComponent(reference.id.uuidString.lowercased() + ".json")
    }

    public func read(_ reference: SourceReference) throws -> Data {
        let path = url(for: reference)
        guard reference.sha256.count == 64,
              path.resolvingSymlinksInPath() == path.standardizedFileURL,
              let attrs = try? FileManager.default.attributesOfItem(atPath: path.path),
              attrs[.type] as? FileAttributeType == .typeRegular,
              let size = attrs[.size] as? NSNumber, size.intValue <= 2_000_000,
              let data = try? Data(contentsOf: path),
              Self.digest(data) == reference.sha256 else { throw SourceContextError.invalid }
        return data
    }

    public func write(_ data: Data) throws -> SourceReference {
        guard !data.isEmpty, data.count <= 2_000_000 else { throw SourceContextError.invalid }
        let reference = SourceReference(kind: .snapshot, id: UUID(), sha256: Self.digest(data))
        let path = url(for: reference)
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try data.write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        _ = try read(reference)
        return reference
    }

    /// Migration is permitted only for an actual receipt bound to the displayed
    /// retrieval output. A filename/"verified" sentence alone is insufficient.
    public func legacyReference(id: UUID, output: String) -> SourceReference? {
        let candidate = SourceReference(kind: .receipt, id: id, sha256: "")
        let path = url(for: candidate)
        guard path.resolvingSymlinksInPath() == path.standardizedFileURL,
              let attrs = try? FileManager.default.attributesOfItem(atPath: path.path),
              attrs[.type] as? FileAttributeType == .typeRegular,
              let size = attrs[.size] as? NSNumber, size.intValue <= 1_000_000,
              let data = try? Data(contentsOf: path),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["operation"] as? String == "r2_retrieval",
              value["operation_id"] as? String == id.uuidString.lowercased(),
              value["bucket"] as? String == "omar-private-archive",
              value["r2_verified"] as? Bool == true,
              value["model_invoked"] as? Bool == false,
              // Old UI trimmed terminal newlines before persisting display
              // text. Reconstruct only that known serialization difference;
              // no fuzzy matching or content normalization is accepted.
              [output, output + "\n", output + "\r\n"].contains(where: {
                  Self.digest(Data($0.utf8)) == value["result_sha256"] as? String
              }),
              let count = value["source_count"] as? Int, count > 0,
              let sources = value["sources"] as? [[String: Any]], sources.count == count else { return nil }
        let result = SourceReference(kind: .receipt, id: id, sha256: Self.digest(data))
        return (try? read(result)) == nil ? nil : result
    }
}

/// Explicit attachment lifecycle, not a topic classifier. Normal follow-ups do
/// not need any recognized pronoun, source name or schema spelling.
public func detachesConversationSource(_ prompt: String) -> Bool {
    let text = prompt.precomposedStringWithCanonicalMapping.lowercased()
    if ["새 주제", "다른 주제", "이전 자료 제외", "그 자료 쓰지", "이 자료 쓰지", "자료 연결 해제",
            "r2 말고", "r2는 제외", "new topic", "detach source", "without the previous source",
            "ignore the previous source"].contains(where: text.contains) { return true }
    // Explicitly choosing another data store replaces the active R2 context.
    return !text.contains("r2") && ["github에서", "github 에서", "기탑에서", "기타브에서",
        "구글 드라이브에서", "from github", "from google drive", "로컬 파일에서"].contains(where: text.contains)
}
