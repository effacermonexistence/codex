import AppKit
import CryptoKit
import OS1Context

/// Local clock/length telemetry only. No prompt, output, commands or credentials.
/// Receipt and actual AppKit draw are distinct events; neither grants adoption.
@MainActor enum ActivityDisplayTiming {
    private struct Receipt {
        let source: Date
        let received: Date
        let fingerprint: String
        let submission: UUID
    }
    private static var receipts: [UUID: Receipt] = [:]
    private static var drawn: [UUID: Date] = [:]
    private static let writer = DispatchQueue(label: "os1.display-timing", qos: .utility)

    static func receive(session: UUID, submission: UUID, activity: RuntimeActivity) {
        guard let text = activity.publicText, !text.isEmpty else { return }
        let now = Date()
        receipts[session] = Receipt(source: activity.timestamp, received: now,
            fingerprint: digest(text), submission: submission)
        write(submission: submission, event: "ui_received", source: activity.timestamp,
              now: now, workMS: nil)
    }
    static func applied(session: UUID, text: String?, started: Date) {
        guard let text, let receipt = receipts[session], receipt.fingerprint == digest(text) else { return }
        write(submission: receipt.submission, event: "ui_applied", source: receipt.source,
              now: Date(), workMS: Date().timeIntervalSince(started) * 1_000)
    }
    static func didDraw(session: UUID, text: String?) {
        guard let text, let receipt = receipts[session], receipt.fingerprint == digest(text),
              drawn[session] != receipt.source else { return }
        drawn[session] = receipt.source
        write(submission: receipt.submission, event: "screen_drawn", source: receipt.source, now: Date(), workMS: nil)
    }
    private static func digest(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private static func write(submission: UUID, event: String, source: Date, now: Date, workMS: Double?) {
        let lag = now.timeIntervalSince(source) * 1_000
        guard lag >= 0, lag < 3_600_000 else { return }
        var body: [String: Any] = ["schema": 1, "event": event, "source_time": source.timeIntervalSince1970,
            "observed_time": now.timeIntervalSince1970, "source_to_ui_ms": lag]
        if let workMS { body["render_work_ms"] = workMS }
        guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else { return }
        writer.async {
            let root = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/OS-1/diagnostics", isDirectory: true)
            try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let url = root.appendingPathComponent("display-latency-\(submission.uuidString.lowercased()).jsonl")
            if !FileManager.default.fileExists(atPath: url.path) {
                FileManager.default.createFile(atPath: url.path, contents: nil, attributes: [.posixPermissions: 0o600])
            }
            guard ((try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) < 2_000_000,
                  let handle = try? FileHandle(forWritingTo: url) else { return }
            defer { try? handle.close() }
            _ = try? handle.seekToEnd(); try? handle.write(contentsOf: data + Data([10]))
        }
    }
}
