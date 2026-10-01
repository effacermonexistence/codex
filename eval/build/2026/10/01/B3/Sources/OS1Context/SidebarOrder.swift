import Foundation

/// Presentation order is independent of activity/selection. Never use titles as IDs.
public enum SidebarOrder {
    public static func moving(_ id: String, before target: String?, in ids: [String]) -> [String] {
        guard ids.contains(id), target != id,
              target == nil || ids.contains(target!) else { return ids }
        var result = ids.filter { $0 != id }
        let index = target.flatMap { result.firstIndex(of: $0) } ?? result.count
        result.insert(id, at: index)
        return result
    }

    /// Put a subset in a new order without displacing any unrelated backend pins.
    public static func replacingSubset(_ ids: [String], in original: [String]) -> [String] {
        let set = Set(ids)
        var iterator = ids.makeIterator()
        return original.map { set.contains($0) ? (iterator.next() ?? $0) : $0 }
    }

    public static func key(provider: String, id: String) -> String { provider + ":" + id }

    /// Claude helper logs carry their parent's sessionId. Only the canonical
    /// projects/<project>/<UUID>.jsonl file is a sidebar conversation.
    public static func claudeConversationID(file: URL, projectsRoot: URL) -> String? {
        let base = projectsRoot.standardizedFileURL.path + "/"
        let path = file.standardizedFileURL.path
        guard path.hasPrefix(base) else { return nil }
        let parts = path.dropFirst(base.count).split(separator: "/")
        guard parts.count == 2, file.pathExtension == "jsonl" else { return nil }
        let id = file.deletingPathExtension().lastPathComponent
        return UUID(uuidString: id) != nil ? id : nil
    }
}

public struct SidebarPinIntent: Codable, Equatable, Sendable {
    public var pinned: Bool
    public var position: Int?
    public var revision: UUID
    public var status: String

    public init(pinned: Bool, position: Int? = nil, status: String = "pending") {
        self.pinned = pinned; self.position = position
        self.revision = UUID(); self.status = status
    }
}
