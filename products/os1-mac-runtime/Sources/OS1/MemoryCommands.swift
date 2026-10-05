import Foundation
import OS1Context

/// Read-only memory-page fault server. Transport is the same MCP stdio shape
/// as the existing checkout server; this server has no write/control tools.
enum MemoryMCP {
    static func respond(_ message: [String: Any], executionID: String?, root: URL = MemoryPaging.defaultRoot) -> [String: Any]? {
        guard let id = message["id"] else { return nil }
        func result(_ value: [String: Any]) -> [String: Any] { ["jsonrpc": "2.0", "id": id, "result": value] }
        switch message["method"] as? String {
        case "initialize":
            return result(["protocolVersion": "2024-11-05", "capabilities": ["tools": [:]], "serverInfo": ["name": "os1-memory", "version": "1.0"]])
        case "ping": return result([:])
        case "tools/list":
            let fields: [String: Any] = [
                "kind": ["type": "string", "enum": EpisodicMemoryQueryKind.allCases.map(\.rawValue)],
                "query": ["type": "string", "maxLength": 2000],
                "conversation_id": ["type": "string", "description": "OS-1 thread_id. Not the provider-native source_session_id."], "source_message_id": ["type": "string"],
                "artifact_id": ["type": "string"], "object_id": ["type": "string"], "entity_id": ["type": "string"],
                "as_of": ["type": "string", "description": "ISO8601 timestamp; required for HISTORICAL_STATE"]]
            return result(["tools": [["name": "memory_query", "description": "MEMORY_PAGE_FAULT: retrieve exact immutable evidence, not a summary. Current state needs exact object identity; conflicts and missing evidence remain UNKNOWN. Scope and total budget are enforced by OS-1.",
                "inputSchema": ["type": "object", "properties": fields, "required": ["kind"], "additionalProperties": false],
                "annotations": ["readOnlyHint": true, "destructiveHint": false, "openWorldHint": false]]]])
        case "tools/call":
            do {
                guard let executionID, let params = message["params"] as? [String: Any], params["name"] as? String == "memory_query",
                      let args = params["arguments"] as? [String: Any],
                      Set(args.keys).isSubset(of: ["kind", "query", "conversation_id", "source_message_id", "artifact_id", "object_id", "entity_id", "as_of"]),
                      let raw = args["kind"] as? String, let kind = EpisodicMemoryQueryKind(rawValue: raw),
                      args.values.allSatisfy({ $0 is String }),
                      args.values.allSatisfy({ ($0 as? String)?.utf8.count ?? Int.max <= 8000 }) else { throw MemoryPagingError.invalidCapability }
                let url = try MemoryPaging.manifestURL(executionID: executionID, root: root)
                guard url.resolvingSymlinksInPath() == url.standardizedFileURL else { throw MemoryPagingError.invalidCapability }
                let manifest = try JSONDecoder().decode(MemoryExecutionManifest.self, from: Data(contentsOf: url))
                guard manifest.executionID == executionID else { throw MemoryPagingError.invalidCapability }
                let asOf = (args["as_of"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }
                guard args["as_of"] == nil || asOf != nil else { throw MemoryPagingError.invalidCapability }
                let found = try MemoryPaging.retrieve(manifest, kind: kind, text: args["query"] as? String,
                    sessionID: args["conversation_id"] as? String, objectID: args["object_id"] as? String,
                    entityID: args["entity_id"] as? String, messageID: args["source_message_id"] as? String,
                    artifactID: args["artifact_id"] as? String, asOf: asOf, root: root)
                let receipt = String(decoding: try JSONEncoder().encode(found.receiptReference), as: UTF8.self)
                let conflicts = found.receipt.conflicts.prefix(3).map { $0.code }.joined(separator: ", ")
                let boundary = "Coverage: \(found.hits.count) exact page(s), \(found.receipt.omissions.count) omitted range(s), conflicts: \(conflicts.isEmpty ? "none detected in retrieved scope" : conflicts). Missing/conflicting state remains UNKNOWN.\n"
                return result(["content": [["type": "text", "text": "Memory retrieval receipt: \(receipt)\n" + boundary + found.injectionText]], "isError": found.unknown || !found.receipt.conflicts.isEmpty])
            } catch {
                return result(["content": [["type": "text", "text": "UNKNOWN: memory retrieval failed or reached its bound. \(error.localizedDescription)"]], "isError": true])
            }
        default: return ["jsonrpc": "2.0", "id": id, "error": ["code": -32601, "message": "Method not found"]]
        }
    }
}

func memoryMCPCommand() -> Never {
    let id = ProcessInfo.processInfo.environment["OS1_MEMORY_EXECUTION_ID"]
    while let line = readLine(strippingNewline: true) {
        guard line.utf8.count <= 64_000, let data = line.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let response = MemoryMCP.respond(object, executionID: id),
              var output = try? JSONSerialization.data(withJSONObject: response) else { continue }
        output.append(10); FileHandle.standardOutput.write(output)
    }
    exit(0)
}

/// Exercises the actual RPC handler and page-in continuation, not a surrogate
/// summary function. No provider calls or live store are used.
func memoryMCPSelfTest() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("os1-memory-rpc-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let conversation = UUID().uuidString.lowercased(), execution = UUID().uuidString.lowercased()
    let workspace = root.appendingPathComponent("workspace").path
    try MemoryPaging.recordMessage(sessionID: conversation, messageID: "exact-message", speaker: "user",
        text: "DO NOT SEND. baseline=92/128; final=60/128", timestamp: Date(), workspace: workspace, root: root)
    let reference = try MemoryPaging.archiveConversation(raw: Data("original envelope".utf8), sessionID: conversation,
        workspace: workspace, messageCount: 1, allowedSessionIDs: [conversation], root: root)
    let manifest = try MemoryPaging.prepare(reference: reference, executionID: execution, root: root)
    func rpc(_ method: String, _ params: [String: Any] = [:]) throws -> [String: Any] {
        guard let reply = MemoryMCP.respond(["jsonrpc": "2.0", "id": 1, "method": method, "params": params],
                executionID: execution, root: root),
              let result = reply["result"] as? [String: Any] else { throw MemoryPagingError.invalidCapability }
        _ = try JSONSerialization.data(withJSONObject: reply)
        return result
    }
    guard try rpc("initialize")["serverInfo"] != nil,
          (try rpc("tools/list")["tools"] as? [[String: Any]])?.count == 1 else { throw MemoryPagingError.invalidCapability }
    let page = try rpc("tools/call", ["name": "memory_query", "arguments": ["kind": "EXACT_QUOTE", "source_message_id": "exact-message"]])
    let content = (page["content"] as? [[String: Any]])?.first?["text"] as? String ?? ""
    guard page["isError"] as? Bool == false, content.contains("DO NOT SEND."), content.contains("92/128"),
          content.contains("60/128"), content.contains("exact-message"), content.contains("Memory retrieval receipt:") else { throw MemoryPagingError.invalidCapability }
    let missing = try rpc("tools/call", ["name": "memory_query", "arguments": ["kind": "LATEST_STATE", "object_id": "absent"]])
    let forbidden = try rpc("tools/call", ["name": "memory_query", "arguments": ["kind": "THREAD", "conversation_id": UUID().uuidString]])
    guard missing["isError"] as? Bool == true, forbidden["isError"] as? Bool == true,
          manifest.allowedSessionIDs == [conversation] else { throw MemoryPagingError.invalidCapability }
    print("OS-1 memory MCP initialize/list/page-in/UNKNOWN/scope/receipt: OK (6 checks, zero provider calls)")
}
