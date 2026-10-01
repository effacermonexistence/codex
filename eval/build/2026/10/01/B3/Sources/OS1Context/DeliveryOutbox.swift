import Foundation
import CryptoKit

/// Private local custody. No credentials; identity and API origin bind replay.
public struct DeliveryRecord: Codable, Sendable {
    public let id: String
    public let apiURL: String
    public let deviceID: String
    public let resultSHA256: String
    public let artifact: Data
    public let upload: Data
    public let submission: Data
    public let step: Data
    public let source: SourceReference?
    public let output: String
    public let submissionID: String?
    public let localRejection: String?
    public let driftApplication: DriftApplication?
    public let driftSteered: Bool?
    public var response: Data?
    public init(id: String, apiURL: String, deviceID: String, resultSHA256: String,
                artifact: Data, upload: Data, submission: Data, step: Data, source: SourceReference?, output: String,
                localRejection: String? = nil, driftApplication: DriftApplication? = nil, driftSteered: Bool? = nil) {
        self.id = id; self.apiURL = apiURL; self.deviceID = deviceID; self.resultSHA256 = resultSHA256
        self.artifact = artifact; self.upload = upload; self.submission = submission
        self.step = step; self.source = source; self.output = output
        self.localRejection = localRejection
        self.driftApplication = driftApplication; self.driftSteered = driftSteered
        submissionID = ProcessInfo.processInfo.environment["OS1_SUBMISSION_ID"].flatMap { UUID(uuidString:$0)?.uuidString }
    }
}
public struct DeliveryOutbox {
    public let root: URL
    public init(root: URL? = nil) {
        self.root = root ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/execution-outbox", isDirectory: true)
    }
    private func path(_ id: String) throws -> URL {
        guard id.range(of: "^[0-9a-fA-F-]{36}-[0-9]{1,3}$", options: .regularExpression) != nil,
              UUID(uuidString: String(id.prefix(36))) != nil else { throw CocoaError(.fileReadInvalidFileName) }
        return root.appendingPathComponent(id + ".json")
    }
    public func save(_ value: DeliveryRecord) throws {
        let url = try path(value.id)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(value)
        guard data.count <= 8_000_000 else { throw CocoaError(.fileWriteOutOfSpace) }
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        if let submissionID = value.submissionID, UUID(uuidString:submissionID) != nil {
            let index = root.appendingPathComponent("submission-" + submissionID + ".ref")
            try Data(value.id.utf8).write(to:index,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:index.path)
        }
    }
    public func forSubmission(_ submissionID: String) -> DeliveryRecord? {
        guard let uuid = UUID(uuidString:submissionID) else { return nil }
        let index = root.appendingPathComponent("submission-" + uuid.uuidString + ".ref")
        guard let data = try? Data(contentsOf:index), data.count < 100,
              let id = String(data:data,encoding:.utf8), let record = try? read(id), record.submissionID == uuid.uuidString else { return nil }
        return record
    }
    public func read(_ id: String) throws -> DeliveryRecord {
        let url = try path(id)
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        guard attrs[.type] as? FileAttributeType == .typeRegular,
              (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 8_000_000 else { throw CocoaError(.fileReadCorruptFile) }
        let value = try JSONDecoder().decode(DeliveryRecord.self, from: Data(contentsOf: url))
        let hash = SHA256.hash(data: value.artifact).map { String(format: "%02x", $0) }.joined()
        guard value.id == id, hash == value.resultSHA256 else { throw CocoaError(.fileReadCorruptFile) }
        return value
    }
}
