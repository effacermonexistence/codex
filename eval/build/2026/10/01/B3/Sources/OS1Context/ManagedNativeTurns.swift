import Foundation

/// Transport role `user` is not authorship. This local ledger records which
/// turns OS1 started, independently of final-result adoption or retry success.
public struct ManagedNativeTurns: Sendable {
    public struct Entry: Codable, Sendable {
        public let submissionID: UUID
        public let threadID: String
        public let turnID: String
    }
    public let root: URL
    public init(root: URL? = nil) {
        self.root = root ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/OS-1/managed-native-turns")
    }
    private func directory(_ threadID: String) -> URL {
        root.appendingPathComponent(NativeIngestion.digestOf(threadID), isDirectory: true)
    }
    public func record(submissionID: UUID, threadID: String, turnID: String) throws {
        guard !threadID.isEmpty, !turnID.isEmpty, threadID.utf8.count < 256, turnID.utf8.count < 256 else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        let dir = directory(threadID)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        let url = dir.appendingPathComponent(NativeIngestion.digestOf(turnID) + ".json")
        let bytes = try JSONEncoder().encode(Entry(submissionID: submissionID, threadID: threadID, turnID: turnID))
        try bytes.write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
    public func ownedTurns(threadID: String) -> Set<String> {
        let files = (try? FileManager.default.contentsOfDirectory(at: directory(threadID), includingPropertiesForKeys: nil)) ?? []
        return Set(files.compactMap { url -> String? in
            guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                  attrs[.type] as? FileAttributeType == .typeRegular,
                  (attrs[.size] as? NSNumber)?.intValue ?? Int.max < 4096,
                  let bytes = try? Data(contentsOf: url), let entry = try? JSONDecoder().decode(Entry.self, from: bytes),
                  entry.threadID == threadID,
                  url.lastPathComponent == NativeIngestion.digestOf(entry.turnID) + ".json" else { return nil }
            return entry.turnID
        })
    }
    /// Backfill only independently verified private outbox records, never a
    /// prompt prefix, echoed receipt, native role, or unverified model claim.
    public func recoverLegacy(threadID: String, outbox: DeliveryOutbox = DeliveryOutbox()) -> Set<String> {
        var owned = ownedTurns(threadID: threadID)
        let files = (try? FileManager.default.contentsOfDirectory(at: outbox.root, includingPropertiesForKeys: nil)) ?? []
        for file in files where file.pathExtension == "json" {
            guard let delivery = try? outbox.read(file.deletingPathExtension().lastPathComponent),
                  let submission = delivery.submissionID.flatMap(UUID.init(uuidString:)),
                  let step = try? JSONSerialization.jsonObject(with: delivery.step) as? [String: Any],
                  step["provider"] as? String == "codex", step["session_id"] as? String == threadID,
                  let native = step["native_record"] as? [String: Any], let turn = native["turn_id"] as? String,
                  !owned.contains(turn), SavedResultEvidence.codexRecordVerified(delivery) else { continue }
            // Even if persistence is temporarily unavailable, this verified
            // ownership must be honored in the current readback.
            owned.insert(turn)
            try? record(submissionID: submission, threadID: threadID, turnID: turn)
        }
        return owned
    }
}
