import Foundation

public struct MemoryContextStatus: Codable, Equatable, Sendable {
    public let conversationID: String
    public let executionID: String
    public let provider: String
    public let model: String
    public let nativeSessionID: String?
    public let previousSessionID: String?
    public let decision: ContextBudgetReceipt
    public var latestRequest: ContextInputUsage?
    public let rotated: Bool
    public let rotationReason: String?
    public let observedAt: Date
    public init(conversationID: String, executionID: String, provider: String, model: String,
                nativeSessionID: String?, previousSessionID: String?, decision: ContextBudgetReceipt,
                latestRequest: ContextInputUsage?, rotated: Bool, rotationReason: String?, observedAt: Date) {
        self.conversationID = conversationID; self.executionID = executionID; self.provider = provider; self.model = model
        self.nativeSessionID = nativeSessionID; self.previousSessionID = previousSessionID; self.decision = decision
        self.latestRequest = latestRequest; self.rotated = rotated; self.rotationReason = rotationReason; self.observedAt = observedAt
    }
    public var publicLine: String {
        let count = latestRequest?.inputTokens ?? decision.preflightEstimate?.inputTokens
        let countLabel = latestRequest == nil ? os1Tr("텍스트 추정", "Text estimate") : os1Tr("실제 요청 입력", "Measured request input")
        let meter = count.map { "\(countLabel) \($0.formatted()) / \(decision.softLimitTokens.formatted())" } ?? os1Tr("컨텍스트 미측정", "Context unmeasured")
        let api = decision.pricingRule?.pricingThresholdTokens.map {
            "API >\($0.formatted()): input ×\(decision.pricingRule!.inputMultiplier), output ×\(decision.pricingRule!.outputMultiplier)"
        } ?? os1Tr("추가 과금 구간 미확인/없음", "No verified premium threshold for this model")
        return meter + " · " + api + " · " + os1Tr("구독 실제 청구와 별개", "API reference, not a subscription bill")
    }
}

public enum MemoryContextMeter {
    public static func nativeURL(provider: String, id: String, root: URL = MemoryPaging.defaultRoot) throws -> URL {
        guard ["codex", "claude"].contains(provider), UUID(uuidString: id) != nil else { throw MemoryPagingError.invalidCapability }
        let dir = root.appendingPathComponent("memory-paging/context")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard dir.resolvingSymlinksInPath() == dir.standardizedFileURL else { throw MemoryPagingError.invalidCapability }
        return dir.appendingPathComponent(provider + "-" + id.lowercased() + ".json")
    }
    public static func readNative(provider: String, id: String?, root: URL = MemoryPaging.defaultRoot) -> ContextInputUsage? {
        guard let id, let url = try? nativeURL(provider: provider, id: id, root: root),
              url.resolvingSymlinksInPath() == url.standardizedFileURL,
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(ContextInputUsage.self, from: data)
    }
    public static func saveNative(_ usage: ContextInputUsage, provider: String, id: String, root: URL = MemoryPaging.defaultRoot) throws {
        let url = try nativeURL(provider: provider, id: id, root: root)
        try JSONEncoder().encode(usage).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    public static func statusURL(conversationID: String, root: URL = MemoryPaging.defaultRoot) throws -> URL {
        guard UUID(uuidString: conversationID) != nil else { throw MemoryPagingError.invalidCapability }
        let dir = root.appendingPathComponent("memory-paging/status")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        guard dir.resolvingSymlinksInPath() == dir.standardizedFileURL else { throw MemoryPagingError.invalidCapability }
        return dir.appendingPathComponent(conversationID.lowercased() + ".json")
    }
    public static func requestFresh(conversationID: String, root: URL = MemoryPaging.defaultRoot) throws {
        let path = try statusURL(conversationID: conversationID, root: root).appendingPathExtension("fresh")
        guard path.resolvingSymlinksInPath() == path.standardizedFileURL else { throw MemoryPagingError.invalidCapability }
        try Data("fresh-context-next-request".utf8).write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
    }
    public static func wantsFresh(conversationID: String, root: URL = MemoryPaging.defaultRoot) -> Bool {
        guard let path = try? statusURL(conversationID: conversationID, root: root).appendingPathExtension("fresh"),
              path.resolvingSymlinksInPath() == path.standardizedFileURL else { return false }
        return (try? Data(contentsOf: path)) == Data("fresh-context-next-request".utf8)
    }
    public static func consumeFresh(conversationID: String, root: URL = MemoryPaging.defaultRoot) throws {
        let path = try statusURL(conversationID: conversationID, root: root).appendingPathExtension("fresh")
        if FileManager.default.fileExists(atPath: path.path) { try FileManager.default.removeItem(at: path) }
    }
    public static func readStatus(conversationID: String, root: URL = MemoryPaging.defaultRoot) -> MemoryContextStatus? {
        guard let path = try? statusURL(conversationID: conversationID, root: root),
              path.resolvingSymlinksInPath() == path.standardizedFileURL,
              let data = try? Data(contentsOf: path) else { return nil }
        return try? JSONDecoder().decode(MemoryContextStatus.self, from: data)
    }
    public static func save(_ status: MemoryContextStatus, root: URL = MemoryPaging.defaultRoot) throws {
        let path = try statusURL(conversationID: status.conversationID, root: root)
        let data = try JSONEncoder().encode(status)
        try data.write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        // Append-only audit per execution, no prompts/policy/secret content.
        let dir = path.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("decisions")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let digest = SourceContextStore.digest(data)
        let receipt = dir.appendingPathComponent(status.executionID + "-" + digest + ".json")
        if !FileManager.default.fileExists(atPath: receipt.path) {
            try data.write(to: receipt, options: .withoutOverwriting)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: receipt.path)
        }
    }
}
