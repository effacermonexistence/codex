import Foundation
import CryptoKit

/// Custody is independent of objective adoption. Read back the exact completed
/// Codex turn; neither exit zero nor the word "verified" in prose is evidence.
public enum SavedResultEvidence {
    /// Bind a cached public answer to the exact failed submission before showing
    /// it. Custody is not scientific/task adoption and does not clear write holds.
    public static func previewMatches(_ delivery: DeliveryRecord, submissionID: UUID) -> Bool {
        let digest = SHA256.hash(data: delivery.artifact).map { String(format: "%02x", $0) }.joined()
        guard delivery.submissionID.flatMap(UUID.init(uuidString:)) == submissionID,
              UUID(uuidString: String(delivery.id.prefix(36))) != nil,
              delivery.id.range(of: "^[0-9a-fA-F-]{36}-[0-9]{1,3}$", options: .regularExpression) != nil,
              digest == delivery.resultSHA256, !delivery.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let artifact = try? JSONSerialization.jsonObject(with: delivery.artifact) as? [String: Any],
              let step = try? JSONSerialization.jsonObject(with: delivery.step) as? [String: Any],
              artifact["output"] as? String == delivery.output, step["output"] as? String == delivery.output,
              let provider = artifact["provider"] as? String, ["codex", "claude"].contains(provider),
              step["provider"] as? String == provider,
              let permission = artifact["permission_profile"] as? String,
              ["read_only", "workspace_write"].contains(permission), step["permission_profile"] as? String == permission,
              artifact["exit_code"] as? Int == 0, step["exit_code"] as? Int == 0 else { return false }
        return true
    }

    public static func codexRecordVerified(_ delivery: DeliveryRecord) -> Bool {
        let digest = SHA256.hash(data: delivery.artifact).map { String(format: "%02x", $0) }.joined()
        guard digest == delivery.resultSHA256,
              let artifact = try? JSONSerialization.jsonObject(with: delivery.artifact) as? [String: Any],
              let step = try? JSONSerialization.jsonObject(with: delivery.step) as? [String: Any],
              artifact["provider"] as? String == "codex", step["provider"] as? String == "codex",
              artifact["output"] as? String == delivery.output, step["output"] as? String == delivery.output,
              let native = artifact["native_record"] as? [String: Any],
              let stepNative = step["native_record"] as? [String: Any],
              NSDictionary(dictionary: native).isEqual(to: stepNative),
              native["persistence"] as? String == "verified",
              let turn = native["turn_id"] as? String, UUID(uuidString: turn) != nil,
              let session = step["session_id"] as? String, UUID(uuidString: session) != nil,
              let path = native["record_path"] as? String, path.hasPrefix("/"), path.hasSuffix(".jsonl"),
              let attrs = try? FileManager.default.attributesOfItem(atPath: path),
              attrs[.type] as? FileAttributeType == .typeRegular,
              (attrs[.size] as? NSNumber)?.intValue ?? Int.max <= 64_000_000,
              let handle = FileHandle(forReadingAtPath: path) else { return false }
        defer { try? handle.close() }
        guard let bytes = try? handle.read(upToCount: 64_000_001), bytes.count <= 64_000_000 else { return false }
        var matchedSession = false, matchedTurn = false
        for line in bytes.split(separator: 10) {
            guard let row = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let payload = row["payload"] as? [String: Any] else { continue }
            if row["type"] as? String == "session_meta" {
                guard (payload["id"] as? String ?? payload["session_id"] as? String)?.lowercased() == session.lowercased() else { return false }
                matchedSession = true
            }
            if row["type"] as? String == "event_msg", payload["turn_id"] as? String == turn,
               payload["type"] as? String == "task_complete" {
                matchedTurn = payload["last_agent_message"] as? String == delivery.output
            }
        }
        return matchedSession && matchedTurn
    }
}
