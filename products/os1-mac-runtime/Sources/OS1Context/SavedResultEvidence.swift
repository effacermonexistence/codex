import Foundation
import CryptoKit

/// Custody is independent of objective adoption. Read back the exact completed
/// Codex turn; neither exit zero nor the word "verified" in prose is evidence.
public enum SavedResultEvidence {
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
