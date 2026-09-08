import Foundation

/// OS1-owned user input, never model output, instructions from a document, or
/// authority to change a running turn's model/workspace/sandbox. Separate files
/// keep the UI's immutable requests independent of the runtime's receipts.
public struct SteeringInput: Codable, Equatable, Sendable, Identifiable {
    public let id: UUID
    public let submissionID: UUID
    public let text: String
    public let createdAt: Date
    public init(id: UUID = UUID(), submissionID: UUID, text: String, createdAt: Date = Date()) {
        self.id = id; self.submissionID = submissionID; self.text = text; self.createdAt = createdAt
    }
}

public struct SteeringReceipt: Codable, Equatable, Sendable {
    public enum State: String, Codable, Sendable { case sending, accepted, rejected, persisted }
    public let inputID: UUID
    public let submissionID: UUID
    public let state: State
    public let threadID: String
    public let turnID: String
}

public struct SteeringLease: Codable, Sendable {
    public let submissionID: UUID
    public let threadID: String
    public let turnID: String
}

public struct ExecutionSteering: Sendable {
    public let root: URL
    public init(root: URL? = nil) {
        self.root = root ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/run-steering")
    }
    public static var currentSubmission: UUID? {
        ProcessInfo.processInfo.environment["OS1_SUBMISSION_ID"].flatMap(UUID.init(uuidString:))
    }
    private func directory(_ id: UUID) -> URL { root.appendingPathComponent(id.uuidString, isDirectory: true) }
    private func path(_ id: UUID, _ name: String) -> URL { directory(id).appendingPathComponent(name) }
    private func encode<T: Encodable>(_ value: T, at url: URL, exclusive: Bool = false) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(value)
        try data.write(to: url, options: exclusive ? .withoutOverwriting : .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    private func decode<T: Decodable>(_ type: T.Type, at url: URL) -> T? {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              attrs[.type] as? FileAttributeType == .typeRegular,
              let size = attrs[.size] as? NSNumber, size.intValue <= 80_000,
              let bytes = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(type, from: bytes)
    }
    public func open(submissionID: UUID, threadID: String, turnID: String) throws {
        try encode(SteeringLease(submissionID: submissionID, threadID: threadID, turnID: turnID),
            at: path(submissionID, "active.json"))
    }
    public func close(_ submissionID: UUID) { try? FileManager.default.removeItem(at: path(submissionID, "active.json")) }
    public func active(_ submissionID: UUID) -> SteeringLease? {
        let lease = decode(SteeringLease.self, at: path(submissionID, "active.json"))
        return lease?.submissionID == submissionID ? lease : nil
    }
    public func enqueue(_ input: SteeringInput) throws {
        guard !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              input.text.utf8.count <= 16_000, inputs(input.submissionID).count < 32 else {
            throw NSError(domain: "OS1Steering", code: 1, userInfo: [NSLocalizedDescriptionKey: "정정 입력은 16KB·32개 이내여야 합니다. 입력을 보존했습니다."])
        }
        try encode(input, at: path(input.submissionID, input.id.uuidString + ".input.json"), exclusive: true)
    }
    public func inputs(_ submissionID: UUID) -> [SteeringInput] {
        let urls = (try? FileManager.default.contentsOfDirectory(at: directory(submissionID), includingPropertiesForKeys: nil)) ?? []
        return urls.filter { $0.lastPathComponent.hasSuffix(".input.json") }.compactMap { url in
            guard let input = decode(SteeringInput.self, at: url), input.submissionID == submissionID,
                  url.lastPathComponent == input.id.uuidString + ".input.json", input.text.utf8.count <= 16_000 else { return nil }
            return input
        }.sorted { $0.createdAt == $1.createdAt ? $0.id.uuidString < $1.id.uuidString : $0.createdAt < $1.createdAt }
    }
    public func receipt(_ input: SteeringInput) -> SteeringReceipt? {
        guard let value = decode(SteeringReceipt.self, at: path(input.submissionID, input.id.uuidString + ".receipt.json")),
              value.inputID == input.id, value.submissionID == input.submissionID else { return nil }
        return value
    }
    public func record(_ input: SteeringInput, state: SteeringReceipt.State, threadID: String, turnID: String) throws {
        try encode(SteeringReceipt(inputID: input.id, submissionID: input.submissionID, state: state,
            threadID: threadID, turnID: turnID), at: path(input.submissionID, input.id.uuidString + ".receipt.json"),
            exclusive: state == .sending)
    }
    public func persistedIDs(_ id: UUID) -> [UUID] {
        inputs(id).filter { receipt($0)?.state == .persisted }.map(\.id)
    }
    public static func isDirectCorrection(_ text: String) -> Bool {
        let value = text.precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !value.hasPrefix(">"), !value.contains("```"), !value.contains("◉") else { return false }
        return ["그 말이 아니라", "그게 아니라", "아니 그게 아니라", "아니, 그게 아니라", "정정할게", "정정:",
            "수정 방향은", "잠깐,", "잠깐만,", "actually,", "correction:", "instead,"].contains { value.hasPrefix($0) }
    }
    public static func continuation(original: String, correction: String) -> String {
        """
Continue the user's existing task with the latest correction below. This is an amendment, not a new standalone explanation request. Retain the original authorized scope and prohibitions; do not repeat already executed changes. Inspect actual state before further changes, and do not treat an older source snapshot as proof of the current deployed release.

ORIGINAL USER REQUEST:
\(original)

LATEST USER CORRECTION (takes precedence where it changes the requested behavior):
\(correction)
"""
    }
}
