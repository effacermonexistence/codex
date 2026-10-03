import Foundation

/// A native MCP approval travels to the owning OS-1 GUI, never to an
/// automatic yes or to a replacement browser driver. Session-only consent.
public enum NativeAppApproval {
    public struct Request: Codable, Identifiable, Sendable {
        public let id: UUID
        public let submissionID: UUID
        public let threadID: String
        public let appIdentifier: String?
        public let message: String
        public let expiresAt: Date
    }
    public struct Response: Codable, Sendable {
        public let id: UUID
        public let submissionID: UUID
        public let approved: Bool
    }
    public static var defaultRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/native-app-approvals")
    }
    public static func observe(params: [String: Any]) {
        let meta = params["_meta"] as? [String: Any] ?? [:]
        let row: [String: Any] = ["observedAt": ISO8601DateFormatter().string(from: Date()),
            "server": params["serverName"] as? String ?? "unknown", "mode": params["mode"] as? String ?? "unknown",
            "parameterKeys": params.keys.sorted(), "metadataKeys": meta.keys.sorted()]
        try? FileManager.default.createDirectory(at: defaultRoot, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        let url = defaultRoot.appendingPathComponent("request-shapes.jsonl")
        guard let data = try? JSONSerialization.data(withJSONObject: row, options: [.sortedKeys]) else { return }
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
        }
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile(); handle.write(data + Data([10])); try? handle.close()
        }
    }
    public static func request(params: [String: Any], submission: UUID, thread: String,
                               deadline: Date) -> Request? {
        guard params["serverName"] as? String == "cua_repl",
              params["threadId"] as? String == thread,
              ["form", "openai/form", "openaiForm"].contains(params["mode"] as? String ?? ""),
              let meta = params["_meta"] as? [String: Any],
              meta["connector_id"] as? String == "computer-use",
              meta["codex_approval_kind"] as? String == "mcp_tool_call",
              let message = params["message"] as? String,
              message.hasPrefix("Allow Computer Use to use "), message.count < 1_000,
              deadline > Date() else { return nil }
        let app = (meta["tool_params"] as? [String: Any])?["app"] as? String
        return Request(id: UUID(), submissionID: submission, threadID: thread, appIdentifier: app,
                       message: message, expiresAt: min(deadline, Date().addingTimeInterval(180)))
    }
    private static func file(_ request: Request, response: Bool, root: URL) -> URL {
        root.appendingPathComponent(request.id.uuidString + (response ? ".response.json" : ".request.json"))
    }
    public static func publish(_ request: Request, root: URL = defaultRoot) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        let path = file(request, response: false, root: root)
        try JSONEncoder().encode(request).write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
    public static func pending(submissions: Set<UUID>, root: URL = defaultRoot) -> Request? {
        let paths = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        return paths.filter { $0.lastPathComponent.hasSuffix(".request.json") }.compactMap {
            try? JSONDecoder().decode(Request.self, from: Data(contentsOf: $0))
        }.filter { submissions.contains($0.submissionID) && $0.expiresAt > Date()
            && !FileManager.default.fileExists(atPath: file($0, response: true, root: root).path) }
            .sorted { $0.expiresAt < $1.expiresAt }.first
    }
    /// Only the GUI's real owner button invokes this; models do not supply it.
    public static func respond(_ request: Request, approved: Bool, root: URL = defaultRoot) throws {
        guard request.expiresAt > Date(),
              let stored = try? JSONDecoder().decode(Request.self, from: Data(contentsOf: file(request, response: false, root: root))),
              stored.id == request.id, stored.submissionID == request.submissionID,
              stored.threadID == request.threadID else { return }
        let response = Response(id: request.id, submissionID: request.submissionID, approved: approved)
        let path = file(request, response: true, root: root)
        guard !FileManager.default.fileExists(atPath: path.path) else { return }
        try JSONEncoder().encode(response).write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
    public static func decision(_ request: Request, root: URL = defaultRoot) -> Bool? {
        guard request.expiresAt > Date(),
              let reply = try? JSONDecoder().decode(Response.self, from: Data(contentsOf: file(request, response: true, root: root))),
              reply.id == request.id, reply.submissionID == request.submissionID else { return nil }
        return reply.approved
    }
    public static func remove(_ request: Request, root: URL = defaultRoot) {
        for response in [false, true] { try? FileManager.default.removeItem(at: file(request, response: response, root: root)) }
    }
    public static func rpcResult(approved: Bool) -> [String: Any] {
        ["action": approved ? "accept" : "decline", "content": [:] as [String: Any],
         "_meta": ["persist": "session"]]
    }
}
